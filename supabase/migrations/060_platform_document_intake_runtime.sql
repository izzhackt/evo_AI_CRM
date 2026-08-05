-- The durable-work operation enum predates BW8B. PostgreSQL cannot use a
-- newly added enum value until the ALTER TYPE transaction commits, so keep
-- this additive value outside the explicit migration transaction.
ALTER TYPE platform.durable_work_operation
  ADD VALUE IF NOT EXISTS 'resolve_document_validation_input';

-- ============================================================
-- 060_platform_document_intake_runtime.sql
--
-- BW8B: forward-only runtime repair for the shared durable-work claim path
-- and one bounded service-only resolver for a finalized private document.
-- Queue messages remain pointer-only. This migration creates no second queue,
-- file ledger, scanner verdict, download artifact, provider call or browser access.
-- ============================================================

BEGIN;

-- Both the legacy unfiltered worker and the document-validation worker use
-- this one implementation. NULL preserves P2G's exact `{}` PGMQ condition;
-- the only supported filtered path uses PGMQ's atomic JSONB containment read.
CREATE OR REPLACE FUNCTION platform_private.claim_durable_work_shared(
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID,
  p_kind_filter platform.durable_work_kind
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queue_message RECORD;
  work_item platform_private.durable_work_items%ROWTYPE;
  prior_attempt platform_private.durable_work_attempts%ROWTYPE;
  created_attempt_id UUID := gen_random_uuid();
  expiry_request_id UUID;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR btrim(p_worker_ref) = ''
    OR char_length(btrim(p_worker_ref)) > 200
    OR (
      p_kind_filter IS NOT NULL
      AND p_kind_filter <> 'document_validation'
    )
  THEN
    RAISE EXCEPTION
      'Visibility timeout, worker reference or claim kind is invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Keep the exact legacy input object when no filter is requested so a
  -- pre-060 claim request replays the same durable result after this repair.
  input_sha256 := encode(
    sha256(
      convert_to(
        (
          jsonb_build_object(
            'visibility_timeout_seconds', p_visibility_timeout_seconds,
            'worker_ref', btrim(p_worker_ref)
          )
          || CASE
            WHEN p_kind_filter IS NULL THEN '{}'::JSONB
            ELSE jsonb_build_object('kind_filter', p_kind_filter)
          END
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'claim',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO queue_message
  FROM pgmq.read(
    'platform_work_v1',
    p_visibility_timeout_seconds,
    1,
    CASE
      WHEN p_kind_filter IS NULL THEN '{}'::JSONB
      ELSE jsonb_build_object('kind', p_kind_filter::TEXT)
    END
  );

  IF NOT FOUND THEN
    result := jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1'
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      'claim',
      input_sha256,
      NULL,
      NULL,
      NULL,
      result
    );

    RETURN result;
  END IF;

  IF jsonb_typeof(queue_message.message) <> 'object'
    OR NOT (queue_message.message ? 'v')
    OR NOT (queue_message.message ? 'work_item_id')
    OR NOT (queue_message.message ? 'kind')
    OR queue_message.message
      - ARRAY['v', 'work_item_id', 'kind'] <> '{}'::JSONB
    OR queue_message.message->>'v' <> '1'
    OR queue_message.message->>'work_item_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR queue_message.message->>'kind' NOT IN (
      'provider_webhook_process',
      'ai_draft_generate',
      'manual_whatsapp_send',
      'document_validation',
      'document_extraction',
      'student_profile_export'
    )
    OR (
      p_kind_filter IS NOT NULL
      AND queue_message.message->>'kind' <> p_kind_filter::TEXT
    )
  THEN
    RAISE EXCEPTION
      'PGMQ work payload violates the pointer-only claim contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.id = (queue_message.message->>'work_item_id')::UUID
    AND item.queue_message_id = queue_message.msg_id
  FOR UPDATE;

  IF NOT FOUND
    OR work_item.kind::TEXT <> queue_message.message->>'kind'
    OR work_item.state NOT IN ('queued', 'leased', 'retry_wait')
  THEN
    RAISE EXCEPTION
      'PGMQ pointer does not identify eligible durable work'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO prior_attempt
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = work_item.organization_id
    AND attempt.work_item_id = work_item.id
    AND attempt.finished_at IS NULL
  FOR UPDATE;

  IF prior_attempt.id IS NOT NULL THEN
    IF prior_attempt.lease_expires_at > clock_timestamp() THEN
      RAISE EXCEPTION
        'PGMQ returned work whose recorded lease is still active'
        USING ERRCODE = '55000';
    END IF;

    IF work_item.kind = 'manual_whatsapp_send' THEN
      result := platform_private.p2g_open_unknown_review(
        work_item.id,
        prior_attempt.id,
        'worker_lease_expired_before_result',
        'worker_lease_expired_before_result',
        p_request_id
      ) || jsonb_build_object(
        'claimed', FALSE,
        'lease_expired_without_result', TRUE
      );

      PERFORM platform_private.p2g_store_result(
        p_request_id,
        'claim',
        input_sha256,
        work_item.organization_id,
        work_item.id,
        prior_attempt.id,
        result
      );

      INSERT INTO platform.audit_events (
        organization_id,
        actor_kind,
        actor_profile_id,
        actor_principal,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        reason,
        request_id
      )
      VALUES (
        work_item.organization_id,
        'service',
        NULL,
        'service:platform-durable-work',
        'work.unknown.review',
        'durable_work_item',
        work_item.id,
        jsonb_build_object(
          'state', work_item.state,
          'attempt_id', prior_attempt.id,
          'lease_expires_at', prior_attempt.lease_expires_at
        ),
        result,
        'Manual-send worker lease expired before a result was recorded',
        p_request_id
      );

      RETURN result;
    END IF;

    expiry_request_id := gen_random_uuid();

    UPDATE platform_private.durable_work_attempts
    SET
      finished_at = statement_timestamp(),
      outcome = 'lease_expired',
      error_code = 'lease_expired',
      evidence_ref = 'pgmq-visibility-timeout',
      finish_request_id = expiry_request_id
    WHERE id = prior_attempt.id;

    INSERT INTO platform_private.durable_work_events (
      organization_id,
      work_item_id,
      attempt_id,
      event_type,
      previous_state,
      new_state,
      queue_message_id,
      evidence_ref,
      request_id
    )
    VALUES (
      work_item.organization_id,
      work_item.id,
      prior_attempt.id,
      'lease_expired',
      work_item.state,
      work_item.state,
      work_item.queue_message_id,
      'pgmq-visibility-timeout',
      expiry_request_id
    );
  END IF;

  IF work_item.attempt_count >= work_item.max_attempts THEN
    result := platform_private.p2g_dead_letter_work(
      work_item.id,
      prior_attempt.id,
      'retry_budget_exhausted',
      'pgmq-visibility-timeout',
      p_request_id
    ) || jsonb_build_object(
      'claimed', FALSE,
      'retry_budget_exhausted', TRUE
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      'claim',
      input_sha256,
      work_item.organization_id,
      work_item.id,
      prior_attempt.id,
      result
    );

    INSERT INTO platform.audit_events (
      organization_id,
      actor_kind,
      actor_profile_id,
      actor_principal,
      action,
      resource_type,
      resource_id,
      before_state,
      after_state,
      reason,
      request_id
    )
    VALUES (
      work_item.organization_id,
      'service',
      NULL,
      'service:platform-durable-work',
      'work.dead.letter',
      'durable_work_item',
      work_item.id,
      jsonb_build_object(
        'state', work_item.state,
        'attempt_count', work_item.attempt_count
      ),
      result,
      'Retry budget exhausted after a visibility timeout',
      p_request_id
    );

    RETURN result;
  END IF;

  INSERT INTO platform_private.durable_work_attempts (
    id,
    organization_id,
    work_item_id,
    attempt_number,
    queue_message_id,
    queue_read_count,
    worker_ref,
    lease_expires_at
  )
  VALUES (
    created_attempt_id,
    work_item.organization_id,
    work_item.id,
    work_item.attempt_count + 1,
    work_item.queue_message_id,
    queue_message.read_ct,
    btrim(p_worker_ref),
    queue_message.vt
  );

  UPDATE platform_private.durable_work_items
  SET
    state = 'leased',
    attempt_count = work_item.attempt_count + 1,
    available_at = queue_message.vt,
    leased_until = queue_message.vt
  WHERE id = work_item.id;

  result := jsonb_build_object(
    'claimed', TRUE,
    'organization_id', work_item.organization_id,
    'work_item_id', work_item.id,
    'attempt_id', created_attempt_id,
    'kind', work_item.kind,
    'queue', 'platform_work_v1',
    'queue_message_id', work_item.queue_message_id,
    'queue_read_count', queue_message.read_ct,
    'attempt_number', work_item.attempt_count + 1,
    'max_attempts', work_item.max_attempts,
    'lease_expires_at', queue_message.vt,
    'source_webhook_event_id', work_item.source_webhook_event_id,
    'ai_draft_request_id', work_item.ai_draft_request_id,
    'manual_send_authorization_id',
      work_item.manual_send_authorization_id,
    'document_version_id', work_item.source_document_version_id,
    'document_extraction_run_id', work_item.source_extraction_run_id,
    'student_profile_export_id', work_item.source_profile_export_id,
    'queue_payload_is_pointer_only', TRUE
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    attempt_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    work_item.organization_id,
    work_item.id,
    created_attempt_id,
    'claimed',
    work_item.state,
    'leased',
    work_item.queue_message_id,
    'worker:' || btrim(p_worker_ref),
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'claim',
    input_sha256,
    work_item.organization_id,
    work_item.id,
    created_attempt_id,
    result
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    work_item.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.claim',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count
    ),
    result,
    CASE
      WHEN p_kind_filter IS NULL
        THEN 'Claim via PGMQ visibility timeout'
      ELSE 'Claim via exact PGMQ document-validation kind filter'
    END,
    p_request_id
  );

  RETURN result;
END
$$;

-- Preserve the exact three-argument service contract and generic `{}` queue
-- read while delegating to the shared implementation above.
CREATE OR REPLACE FUNCTION platform.claim_durable_work(
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.claim_durable_work_shared(
    p_visibility_timeout_seconds,
    p_worker_ref,
    p_request_id,
    NULL
  )
$$;

-- This worker-specific claim cannot consume webhook, draft, send, extraction
-- or export work from the shared pointer-only queue.
CREATE OR REPLACE FUNCTION platform.claim_document_validation_work(
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.claim_durable_work_shared(
    p_visibility_timeout_seconds,
    p_worker_ref,
    p_request_id,
    'document_validation'
  )
$$;

-- Resolve only the opaque private-object coordinates and immutable metadata
-- required for integrity and malware validation. The response is persisted in
-- the existing private idempotency ledger, never in browser-readable audit
-- JSON, and is replayed only while the version remains current/finalized.
CREATE OR REPLACE FUNCTION platform.resolve_document_validation_input(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  case_row platform.student_cases%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  binding_row platform_private.document_storage_bindings%ROWTYPE;
  reservation_row platform_private.document_upload_reservations%ROWTYPE;
  finalization_row platform_private.document_upload_finalizations%ROWTYPE;
  validation_already_finalized BOOLEAN := FALSE;
  final_integrity_status platform.document_integrity_status := NULL;
  final_malware_status platform.document_malware_status := NULL;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL OR p_document_version_id IS NULL THEN
    RAISE EXCEPTION
      'Organization and document version are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'document_version_id', p_document_version_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  -- Validate request ownership immediately, but re-check the live current
  -- binding before returning a same-input replay.
  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'resolve_document_validation_input',
    input_sha256
  );

  -- Match the P2H organization -> case -> slot -> version lock order. SHARE
  -- locks keep the current-version relation stable for this transaction.
  PERFORM 1
  FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT version.*
  INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT student_case.*
  INTO case_row
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = version_row.organization_id
    AND student_case.id = version_row.student_case_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT slot.*
  INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = version_row.organization_id
    AND slot.id = version_row.document_slot_id
    AND slot.student_case_id = version_row.student_case_id
  FOR SHARE;

  IF NOT FOUND
    OR slot_row.current_version_id IS DISTINCT FROM version_row.id
    OR slot_row.current_version_no IS DISTINCT FROM version_row.version_no
    OR slot_row.status NOT IN ('submitted', 'approved')
  THEN
    RAISE EXCEPTION
      'Document validation input is unavailable or no longer current'
      USING ERRCODE = '42501';
  END IF;

  SELECT version.*
  INTO STRICT version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = slot_row.organization_id
    AND version.id = slot_row.current_version_id
    AND version.student_case_id = slot_row.student_case_id
    AND version.document_slot_id = slot_row.id
    AND version.version_no = slot_row.current_version_no
  FOR SHARE;

  IF version_row.integrity_status = 'pending'
    AND version_row.malware_status = 'pending'
  THEN
    validation_already_finalized := FALSE;
  ELSIF version_row.integrity_status = 'verified'
    AND version_row.malware_status IN ('clean', 'infected')
  THEN
    validation_already_finalized := TRUE;
    final_integrity_status := version_row.integrity_status;
    final_malware_status := version_row.malware_status;
  ELSIF version_row.integrity_status = 'failed'
    AND version_row.malware_status = 'error'
  THEN
    validation_already_finalized := TRUE;
    final_integrity_status := version_row.integrity_status;
    final_malware_status := version_row.malware_status;
  ELSE
    RAISE EXCEPTION
      'Document validation input is inconsistent'
      USING ERRCODE = '55000';
  END IF;

  SELECT binding.*
  INTO binding_row
  FROM platform_private.document_storage_bindings AS binding
  WHERE binding.organization_id = version_row.organization_id
    AND binding.document_version_id = version_row.id
    AND binding.student_case_id = version_row.student_case_id
    AND binding.document_slot_id = version_row.document_slot_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Finalized document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT reservation.*
  INTO reservation_row
  FROM platform_private.document_upload_reservations AS reservation
  WHERE reservation.organization_id = binding_row.organization_id
    AND reservation.id = binding_row.upload_reservation_id
    AND reservation.document_version_id = binding_row.document_version_id
    AND reservation.bucket_id = binding_row.bucket_id
    AND reservation.object_name = binding_row.object_name
    AND reservation.declared_mime_type = version_row.declared_mime_type
    AND reservation.byte_size = version_row.byte_size
    AND reservation.sha256_hex = version_row.sha256_hex
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Finalized document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT finalization.*
  INTO finalization_row
  FROM platform_private.document_upload_finalizations AS finalization
  WHERE finalization.organization_id = binding_row.organization_id
    AND finalization.upload_reservation_id = binding_row.upload_reservation_id
    AND finalization.student_case_id = binding_row.student_case_id
    AND finalization.document_version_id = binding_row.document_version_id
    AND finalization.document_slot_id = binding_row.document_slot_id
    AND finalization.bucket_id = binding_row.bucket_id
    AND finalization.object_name = binding_row.object_name
    AND finalization.published_version_no = version_row.version_no
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Finalized document validation input is unavailable'
      USING ERRCODE = '42501';
  END IF;

  result := jsonb_build_object(
    'organization_id', version_row.organization_id,
    'student_case_id', version_row.student_case_id,
    'document_slot_id', version_row.document_slot_id,
    'document_version_id', version_row.id,
    'document_version_no', version_row.version_no,
    'bucket_id', binding_row.bucket_id,
    'object_name', binding_row.object_name,
    'expected_original_filename', version_row.original_filename,
    'expected_mime_type', version_row.declared_mime_type,
    'expected_byte_size', version_row.byte_size,
    'expected_sha256_hex', version_row.sha256_hex,
    'validation_already_finalized', validation_already_finalized,
    'final_integrity_status', final_integrity_status,
    'final_malware_status', final_malware_status
  );

  IF replayed IS NOT NULL THEN
    IF replayed IS DISTINCT FROM result THEN
      RAISE EXCEPTION
        'Resolved document input changed for an existing request replay'
        USING ERRCODE = '55000';
    END IF;
    RETURN replayed;
  END IF;

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'resolve_document_validation_input',
    input_sha256,
    NULL,
    NULL,
    NULL,
    result
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform_private.claim_durable_work_shared(
  INTEGER, TEXT, UUID, platform.durable_work_kind
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.claim_durable_work(INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.claim_document_validation_work(
  INTEGER, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.resolve_document_validation_input(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.claim_durable_work(INTEGER, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION platform.claim_document_validation_work(
  INTEGER, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.resolve_document_validation_input(
  UUID, UUID, UUID
) TO service_role;

COMMENT ON FUNCTION platform_private.claim_durable_work_shared(
  INTEGER, TEXT, UUID, platform.durable_work_kind
) IS
  'Private shared PGMQ claim implementation. NULL preserves generic P2G behavior; document_validation uses one exact conditional JSONB queue read.';
COMMENT ON FUNCTION platform.claim_durable_work(INTEGER, TEXT, UUID) IS
  'Service-only generic durable-work claim with legacy replay semantics and corrected BW8 public pointer aliases.';
COMMENT ON FUNCTION platform.claim_document_validation_work(
  INTEGER, TEXT, UUID
) IS
  'Service-only durable-work claim restricted atomically to document_validation pointers in the shared queue.';
COMMENT ON FUNCTION platform.resolve_document_validation_input(
  UUID, UUID, UUID
) IS
  'Service-only replay-safe resolver for one current finalized private document object and its immutable expected validation metadata; returns metadata only.';

COMMIT;
