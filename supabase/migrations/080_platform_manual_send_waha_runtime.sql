-- 080_platform_manual_send_waha_runtime.sql
-- Replace the last live manual-send SQLite seam with one private
-- organization-scoped Supabase/Vault runtime binding.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_provider_bindings AS binding
    WHERE binding.waha_session_name <> 'evo-inbox'
  ) THEN
    RAISE EXCEPTION
      'Manual-send provider history uses a non-target WAHA session; archive or resolve it before cutover'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    JOIN platform.manual_send_authorizations AS authorization_row
      ON authorization_row.organization_id = item.organization_id
     AND authorization_row.id = item.manual_send_authorization_id
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = authorization_row.organization_id
     AND conversation.id = authorization_row.conversation_id
    WHERE item.kind = 'manual_whatsapp_send'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND conversation.waha_session_name <> 'evo-inbox'
  ) THEN
    RAISE EXCEPTION
      'Live manual-send work uses a non-target WAHA session; reconcile it before cutover'
      USING ERRCODE = '55000';
  END IF;
END
$migration_guard$;

CREATE TABLE platform_private.manual_send_waha_runtime_bindings (
  organization_id UUID PRIMARY KEY
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  waha_session_name TEXT NOT NULL DEFAULT 'evo-inbox'
    CHECK (waha_session_name = 'evo-inbox'),
  waha_base_url TEXT NOT NULL DEFAULT 'http://evo-crm-waha:3000'
    CHECK (waha_base_url = 'http://evo-crm-waha:3000'),
  api_key_secret_id UUID NOT NULL
    REFERENCES vault.secrets (id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  binding_version BIGINT NOT NULL DEFAULT 1
    CHECK (binding_version BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT manual_send_waha_runtime_bindings_secret_key
    UNIQUE (api_key_secret_id),
  CONSTRAINT manual_send_waha_runtime_bindings_time_check
    CHECK (updated_at >= created_at)
);

ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.manual_send_waha_runtime_bindings
  FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform.resolve_manual_send_waha_runtime(
  p_organization_id UUID
)
RETURNS TABLE (
  waha_session_name TEXT,
  waha_base_url TEXT,
  waha_api_key TEXT,
  binding_version BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization id is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    binding.waha_session_name,
    binding.waha_base_url,
    secret.decrypted_secret,
    binding.binding_version
  FROM platform_private.manual_send_waha_runtime_bindings AS binding
  JOIN platform.organizations AS organization
    ON organization.id = binding.organization_id
   AND organization.status = 'active'
  JOIN vault.decrypted_secrets AS secret
    ON secret.id = binding.api_key_secret_id
  WHERE binding.organization_id = p_organization_id
    AND binding.enabled
    AND binding.waha_session_name = 'evo-inbox'
    AND binding.waha_base_url = 'http://evo-crm-waha:3000'
    AND secret.decrypted_secret IS NOT NULL
    AND secret.decrypted_secret = pg_catalog.btrim(secret.decrypted_secret)
    AND pg_catalog.octet_length(secret.decrypted_secret) BETWEEN 16 AND 4096
    AND pg_catalog.strpos(
      secret.decrypted_secret,
      pg_catalog.chr(10)
    ) = 0
    AND pg_catalog.strpos(
      secret.decrypted_secret,
      pg_catalog.chr(13)
    ) = 0;
END
$$;

REVOKE ALL ON TABLE
  platform_private.manual_send_waha_runtime_bindings
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.resolve_manual_send_waha_runtime(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.resolve_manual_send_waha_runtime(UUID)
  TO service_role;

ALTER TABLE platform_private.manual_send_provider_bindings
  DROP CONSTRAINT manual_send_provider_bindings_waha_session_name_check;
ALTER TABLE platform_private.manual_send_provider_bindings
  ADD CONSTRAINT manual_send_provider_bindings_waha_session_name_check
  CHECK (waha_session_name = 'evo-inbox');

CREATE OR REPLACE FUNCTION platform_private.require_private_manual_send_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.message_identity_source = 'private_manual_send_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.manual_send_provider_bindings AS binding
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.manual_send_authorization_id =
          NEW.manual_send_authorization_id
        AND binding.waha_session_name = 'evo-inbox'
    )
  THEN
    RAISE EXCEPTION
      'A private manual-send message requires its exact provider binding'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION platform.claim_manual_whatsapp_send(
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
      AND queue_row.message ?& ARRAY['v', 'work_item_id', 'kind']
      AND queue_row.message - ARRAY['v', 'work_item_id', 'kind'] = '{}'::JSONB
      AND queue_row.message ->> 'v' = '1'
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
CREATE OR REPLACE FUNCTION platform.finish_manual_whatsapp_send(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_authorization_id UUID,
  p_outcome platform.durable_work_finish_outcome,
  p_error_code TEXT,
  p_provider_message_id TEXT,
  p_provider_observed_at TIMESTAMPTZ,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt_row platform_private.durable_work_attempts%ROWTYPE;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  conversation_row platform.communication_conversations%ROWTYPE;
  source_message_row platform.communication_messages%ROWTYPE;
  sender_participant platform.conversation_participants%ROWTYPE;
  created_message_id UUID := gen_random_uuid();
  finish_result JSONB;
  evidence_ref TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  replay_binding platform_private.manual_send_provider_bindings%ROWTYPE;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_work_item_id IS NULL
    OR p_attempt_id IS NULL
    OR p_authorization_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome NOT IN ('succeeded', 'terminal_error', 'unknown_result')
    OR (
      p_outcome = 'succeeded'
      AND (
        p_error_code IS NOT NULL
        OR p_provider_message_id IS NULL
        OR btrim(p_provider_message_id) = ''
        OR char_length(btrim(p_provider_message_id)) > 512
        OR btrim(p_provider_message_id) !~ '^[ -~]+$'
        OR p_provider_observed_at IS NULL
      )
    )
    OR (
      p_outcome <> 'succeeded'
      AND (
        p_error_code IS NULL
        OR btrim(p_error_code) !~ '^[a-z][a-z0-9_]{1,63}$'
        OR p_provider_message_id IS NOT NULL
        OR p_provider_observed_at IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'Manual-send finish input is invalid'
      USING ERRCODE = '22023';
  END IF;

  evidence_ref := CASE p_outcome
    WHEN 'succeeded' THEN 'manual-send-provider-accepted'
    WHEN 'unknown_result' THEN 'manual-send-provider-ambiguous'
    ELSE 'manual-send-provider-rejected'
  END;

  -- The generic finish operation is request-id idempotent. This wrapper must
  -- honor that replay before requiring the original lease to remain live.
  PERFORM platform_private.lock_p2g_request(p_request_id);
  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'outcome', p_outcome,
          'error_code', CASE
            WHEN p_outcome = 'succeeded' THEN NULL
            ELSE btrim(p_error_code)
          END,
          'evidence_ref', evidence_ref,
          'retry_delay_seconds', NULL
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );
  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'finish',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    IF p_outcome = 'succeeded' THEN
      SELECT *
      INTO replay_binding
      FROM platform_private.manual_send_provider_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.manual_send_authorization_id = p_authorization_id
        AND binding.durable_work_item_id = p_work_item_id
        AND binding.durable_work_attempt_id = p_attempt_id;

      IF replay_binding.id IS NULL
        OR replay_binding.raw_message_id <> btrim(p_provider_message_id)
        OR replay_binding.provider_observed_at <> p_provider_observed_at
      THEN
        RAISE EXCEPTION 'Manual-send finish replay does not match provider binding'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    RETURN replayed || jsonb_build_object(
      'organization_id', p_organization_id,
      'work_item_id', p_work_item_id,
      'attempt_id', p_attempt_id,
      'outcome', p_outcome,
      'provider_identity_private', p_outcome = 'succeeded'
    );
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.manual_send_authorization_id = p_authorization_id
    AND item.state = 'leased'
  FOR UPDATE;

  SELECT *
  INTO attempt_row
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.id = p_attempt_id
    AND attempt.work_item_id = p_work_item_id
    AND attempt.attempt_number = 1
    AND attempt.finished_at IS NULL
  FOR UPDATE;

  SELECT *
  INTO authorization_row
  FROM platform.manual_send_authorizations AS authz
  WHERE authz.organization_id = p_organization_id
    AND authz.id = p_authorization_id;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = authorization_row.conversation_id
    AND conversation.waha_session_name = 'evo-inbox';

  SELECT *
  INTO source_message_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = authorization_row.source_message_id
    AND message.conversation_id = authorization_row.conversation_id
    AND message.direction = 'inbound';

  SELECT *
  INTO sender_participant
  FROM platform.conversation_participants AS participant
  WHERE participant.organization_id = p_organization_id
    AND participant.conversation_id = authorization_row.conversation_id
    AND participant.membership_id = authorization_row.authorized_by_membership_id
    AND participant.participant_kind IN ('admin', 'sales', 'curator')
  ORDER BY participant.created_at DESC, participant.id DESC
  LIMIT 1;

  IF work_item.id IS NULL
    OR attempt_row.id IS NULL
    OR authorization_row.id IS NULL
    OR conversation_row.id IS NULL
    OR source_message_row.id IS NULL
    OR sender_participant.id IS NULL
    OR authorization_row.final_text_sha256 <>
      encode(sha256(convert_to(btrim(authorization_row.final_text), 'UTF8')), 'hex')
  THEN
    RAISE EXCEPTION 'Manual-send finish identity does not match the live lease'
      USING ERRCODE = '42501';
  END IF;

  IF p_outcome = 'succeeded' THEN
    INSERT INTO platform.communication_messages (
      id,
      organization_id,
      conversation_id,
      student_case_id,
      sender_participant_id,
      direction,
      body_text,
      language,
      student_visible,
      message_identity_source,
      waha_session_name,
      waha_message_id,
      kommo_account_id,
      kommo_conversation_id,
      kommo_message_id,
      amocrm_account_id,
      amocrm_lead_id,
      amocrm_contact_id,
      source_webhook_event_id,
      manual_send_authorization_id,
      autonomous_reply_intent_id,
      created_at
    ) VALUES (
      created_message_id,
      p_organization_id,
      conversation_row.id,
      conversation_row.student_case_id,
      sender_participant.id,
      'outbound',
      authorization_row.final_text,
      source_message_row.language,
      TRUE,
      'private_manual_send_binding',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      source_message_row.source_webhook_event_id,
      authorization_row.id,
      NULL,
      p_provider_observed_at
    );

    INSERT INTO platform_private.manual_send_provider_bindings (
      organization_id,
      manual_send_authorization_id,
      durable_work_item_id,
      durable_work_attempt_id,
      communication_message_id,
      waha_session_name,
      raw_message_id,
      provider_observed_at
    ) VALUES (
      p_organization_id,
      authorization_row.id,
      work_item.id,
      attempt_row.id,
      created_message_id,
      'evo-inbox',
      btrim(p_provider_message_id),
      p_provider_observed_at
    );
  END IF;

  finish_result := platform.finish_durable_work(
    p_work_item_id,
    p_attempt_id,
    p_outcome,
    CASE WHEN p_outcome = 'succeeded' THEN NULL ELSE btrim(p_error_code) END,
    evidence_ref,
    NULL,
    p_request_id
  );

  RETURN finish_result || jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'outcome', p_outcome,
    'communication_message_id',
      CASE WHEN p_outcome = 'succeeded' THEN created_message_id ELSE NULL END,
    'provider_identity_private', TRUE
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_private_manual_send_binding()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.claim_manual_whatsapp_send(
  UUID, INTEGER, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.finish_manual_whatsapp_send(
  UUID,
  UUID,
  UUID,
  UUID,
  platform.durable_work_finish_outcome,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.claim_manual_whatsapp_send(
  UUID, INTEGER, TEXT, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.finish_manual_whatsapp_send(
  UUID,
  UUID,
  UUID,
  UUID,
  platform.durable_work_finish_outcome,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) TO service_role;
