-- 101_platform_exact_manual_send_queue_shape.sql
-- Align the exact manual-send claim with the four-field canonical pointer
-- emitted by the authenticated enqueue path. Malformed queue heads stop the
-- lane instead of being skipped or routed through a fallback claimant.

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.claim_next_manual_whatsapp_send_internal(
  p_organization_id UUID,
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
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
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  conversation_row platform.communication_conversations%ROWTYPE;
  source_message_row platform.communication_messages%ROWTYPE;
  chat_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  reply_binding platform_private.waha_message_bindings%ROWTYPE;
  sender_membership platform.organization_memberships%ROWTYPE;
  sender_participant platform.conversation_participants%ROWTYPE;
  created_attempt_id UUID := gen_random_uuid();
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR btrim(p_worker_ref) = ''
    OR char_length(btrim(p_worker_ref)) > 200
  THEN
    RAISE EXCEPTION
      'Organization, visibility timeout and worker reference are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'visibility_timeout_seconds', p_visibility_timeout_seconds,
          'worker_ref', btrim(p_worker_ref),
          'lane', 'manual_whatsapp_send'
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
    -- A claim result is an authorization to perform one irreversible provider
    -- call. Replaying the signed worker request must therefore never replay a
    -- prior `claimed=true` response, even while the original lease is active.
    -- The original attempt remains the sole owner and reconciliation handles
    -- any response ambiguity.
    RETURN jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1'
    );
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT queue_row.msg_id
    FROM pgmq.q_platform_work_v1 AS queue_row
    JOIN platform_private.durable_work_items AS item
      ON item.queue_message_id = queue_row.msg_id
     AND item.id::TEXT = queue_row.message ->> 'work_item_id'
    WHERE queue_row.vt <= clock_timestamp()
      AND item.organization_id = p_organization_id
      AND item.kind = 'manual_whatsapp_send'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND item.max_attempts = 1
      AND jsonb_typeof(queue_row.message) = 'object'
      AND queue_row.message ?& ARRAY['v', 'organization_id', 'work_item_id', 'kind']
      AND queue_row.message - ARRAY['v', 'organization_id', 'work_item_id', 'kind'] = '{}'::JSONB
      AND queue_row.message ->> 'v' = '1'
      AND queue_row.message ->> 'organization_id' = p_organization_id::TEXT
      AND queue_row.message ->> 'kind' = 'manual_whatsapp_send'
    ORDER BY queue_row.msg_id ASC
    LIMIT 1
    FOR UPDATE OF queue_row SKIP LOCKED
  ), leased AS (
    UPDATE pgmq.q_platform_work_v1 AS queue_row
    SET
      vt = clock_timestamp()
        + make_interval(secs => p_visibility_timeout_seconds),
      read_ct = queue_row.read_ct + 1
    FROM candidate
    WHERE queue_row.msg_id = candidate.msg_id
    RETURNING
      queue_row.msg_id,
      queue_row.read_ct,
      queue_row.vt,
      queue_row.message
  )
  SELECT *
  INTO queue_message
  FROM leased;

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

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = (queue_message.message ->> 'work_item_id')::UUID
    AND item.queue_message_id = queue_message.msg_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.max_attempts = 1
  FOR UPDATE;

  IF NOT FOUND OR work_item.state NOT IN ('queued', 'leased', 'retry_wait') THEN
    RAISE EXCEPTION
      'PGMQ pointer does not identify eligible manual-send work'
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
        'PGMQ returned manual-send work whose lease is active'
        USING ERRCODE = '55000';
    END IF;

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
    RETURN result;
  END IF;

  IF work_item.attempt_count >= work_item.max_attempts THEN
    RAISE EXCEPTION
      'Manual-send work exhausted its single attempt without reconciliation'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO authorization_row
  FROM platform.manual_send_authorizations AS authz
  WHERE authz.organization_id = work_item.organization_id
    AND authz.id = work_item.manual_send_authorization_id;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = work_item.organization_id
    AND conversation.id = authorization_row.conversation_id;

  SELECT *
  INTO source_message_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = work_item.organization_id
    AND message.id = authorization_row.source_message_id
    AND message.conversation_id = authorization_row.conversation_id
    AND message.direction = 'inbound';

  SELECT *
  INTO chat_binding
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = work_item.organization_id
    AND binding.conversation_id = authorization_row.conversation_id
    AND binding.waha_session_name = 'evo-inbox';

  SELECT *
  INTO reply_binding
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = work_item.organization_id
    AND binding.communication_message_id = source_message_row.id
    AND binding.waha_session_name = 'evo-inbox';

  IF authorization_row.id IS NULL
    OR conversation_row.id IS NULL
    OR conversation_row.waha_session_name <> 'evo-inbox'
    OR source_message_row.id IS NULL
    OR chat_binding.id IS NULL
    OR reply_binding.id IS NULL
    OR authorization_row.final_text_sha256 <>
      encode(sha256(convert_to(btrim(authorization_row.final_text), 'UTF8')), 'hex')
  THEN
    RAISE EXCEPTION
      'Manual-send authorization and private provider bindings do not match'
      USING ERRCODE = '42501';
  END IF;

  SELECT membership.*
  INTO sender_membership
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
   AND profile.status = 'active'
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
   AND organization.status = 'active'
  WHERE membership.organization_id = work_item.organization_id
    AND membership.id = authorization_row.authorized_by_membership_id
    AND membership.status = 'active'
    AND membership.current_role IN ('admin', 'sales', 'curator');

  IF sender_membership.id IS NULL THEN
    RAISE EXCEPTION
      'Manual-send author is no longer an active staff member'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO sender_participant
  FROM platform.conversation_participants AS participant
  WHERE participant.organization_id = work_item.organization_id
    AND participant.conversation_id = authorization_row.conversation_id
    AND participant.membership_id = sender_membership.id
    AND participant.participant_kind::TEXT = sender_membership.current_role::TEXT
  ORDER BY participant.created_at DESC, participant.id DESC
  LIMIT 1;

  IF sender_participant.id IS NULL THEN
    PERFORM platform.record_conversation_participant(
      work_item.organization_id,
      authorization_row.conversation_id,
      sender_membership.current_role::TEXT::platform.conversation_participant_kind,
      sender_membership.id,
      NULL,
      source_message_row.source_webhook_event_id,
      platform_private.p3c_request_child_id(
        p_request_id,
        'ensure-manual-sender-participant'
      )
    );

    SELECT *
    INTO sender_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = work_item.organization_id
      AND participant.conversation_id = authorization_row.conversation_id
      AND participant.membership_id = sender_membership.id
      AND participant.participant_kind::TEXT = sender_membership.current_role::TEXT
    ORDER BY participant.created_at DESC, participant.id DESC
    LIMIT 1;
  END IF;

  IF sender_participant.id IS NULL THEN
    RAISE EXCEPTION
      'Manual-send author participant could not be resolved'
      USING ERRCODE = '42501';
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
  ) VALUES (
    created_attempt_id,
    work_item.organization_id,
    work_item.id,
    1,
    work_item.queue_message_id,
    queue_message.read_ct,
    btrim(p_worker_ref),
    queue_message.vt
  );

  UPDATE platform_private.durable_work_items
  SET
    state = 'leased',
    attempt_count = 1,
    available_at = queue_message.vt,
    leased_until = queue_message.vt
  WHERE id = work_item.id;

  result := jsonb_build_object(
    'claimed', TRUE,
    'organization_id', work_item.organization_id,
    'work_item_id', work_item.id,
    'attempt_id', created_attempt_id,
    'kind', 'manual_whatsapp_send',
    'manual_send_authorization_id', authorization_row.id,
    'conversation_id', authorization_row.conversation_id,
    'source_message_id', authorization_row.source_message_id,
    'waha_session_name', 'evo-inbox',
    'raw_chat_id', chat_binding.normalized_chat_id,
    'raw_reply_to', reply_binding.raw_message_id,
    'final_text', authorization_row.final_text,
    'final_text_sha256', authorization_row.final_text_sha256,
    'attempt_number', 1,
    'max_attempts', 1,
    'lease_expires_at', queue_message.vt,
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
  ) VALUES (
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

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.claim_manual_whatsapp_send_item(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_queue RECORD;
  exact_worker_ref TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_work_item_id IS NULL
    OR p_request_id IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR pg_catalog.btrim(p_worker_ref) = ''
    OR pg_catalog.char_length(pg_catalog.btrim(p_worker_ref)) > 160
    OR pg_catalog.btrim(p_worker_ref) ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Organization, work item, visibility timeout, worker and request are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5b:manual-whatsapp-exact-claim:' || p_organization_id::TEXT,
      0
    )
  );

  -- Find the true per-organization queue head from the durable binding first.
  -- Validate its PGMQ pointer afterwards so a malformed head cannot be skipped
  -- in favor of a later item.
  SELECT
    item.id AS work_item_id,
    queue_row.message AS queue_payload
  INTO next_queue
  FROM pgmq.q_platform_work_v1 AS queue_row
  JOIN platform_private.durable_work_items AS item
    ON item.queue_message_id = queue_row.msg_id
  WHERE queue_row.vt <= pg_catalog.clock_timestamp()
    AND item.organization_id = p_organization_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.state IN ('queued', 'leased', 'retry_wait')
    AND item.max_attempts = 1
  ORDER BY queue_row.msg_id ASC
  LIMIT 1;

  IF next_queue.work_item_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1',
      'requested_work_item_id', p_work_item_id
    );
  END IF;

  IF pg_catalog.jsonb_typeof(next_queue.queue_payload) <> 'object'
    OR NOT (
      next_queue.queue_payload
        ?& ARRAY['v', 'organization_id', 'work_item_id', 'kind']
    )
    OR next_queue.queue_payload
      - ARRAY['v', 'organization_id', 'work_item_id', 'kind'] <> '{}'::JSONB
    OR next_queue.queue_payload ->> 'v' <> '1'
    OR next_queue.queue_payload ->> 'organization_id'
      <> p_organization_id::TEXT
    OR next_queue.queue_payload ->> 'work_item_id'
      <> next_queue.work_item_id::TEXT
    OR next_queue.queue_payload ->> 'kind' <> 'manual_whatsapp_send'
  THEN
    RAISE EXCEPTION
      'Next manual-send queue pointer is not canonical for organization'
      USING ERRCODE = '55000';
  END IF;

  IF next_queue.work_item_id <> p_work_item_id THEN
    RAISE EXCEPTION
      'Requested manual-send work is not the next eligible item'
      USING ERRCODE = '55000';
  END IF;

  exact_worker_ref := pg_catalog.btrim(p_worker_ref)
    || ':'
    || p_work_item_id::TEXT;

  result := platform_private.claim_next_manual_whatsapp_send_internal(
    p_organization_id,
    p_visibility_timeout_seconds,
    exact_worker_ref,
    p_request_id
  );

  IF COALESCE((result ->> 'claimed')::BOOLEAN, FALSE)
    AND result ->> 'work_item_id' <> p_work_item_id::TEXT
  THEN
    RAISE EXCEPTION
      'Manual-send claim returned a different work item'
      USING ERRCODE = '55000';
  END IF;

  RETURN result || pg_catalog.jsonb_build_object(
    'requested_work_item_id', p_work_item_id
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.claim_next_manual_whatsapp_send_internal(
    UUID,
    INTEGER,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) TO service_role;

COMMENT ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) IS
  'Claims exactly the next four-field canonical manual WhatsApp pointer for one organization; malformed or different queue heads fail closed.';

COMMIT;
