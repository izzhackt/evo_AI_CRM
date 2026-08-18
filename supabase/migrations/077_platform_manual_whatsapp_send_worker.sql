-- 077_platform_manual_whatsapp_send_worker.sql
-- Close the staff-authorized manual WhatsApp send lane without allowing the
-- generic worker to consume unrelated durable work.

CREATE TABLE platform_private.manual_send_provider_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  manual_send_authorization_id UUID NOT NULL,
  durable_work_item_id UUID NOT NULL,
  durable_work_attempt_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (waha_session_name = 'crm_primary'),
  raw_message_id TEXT NOT NULL CHECK (
    pg_catalog.char_length(raw_message_id) BETWEEN 1 AND 512
    AND raw_message_id ~ '^[ -~]+$'
  ),
  provider_observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT manual_send_provider_bindings_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT manual_send_provider_bindings_authorization_key
    UNIQUE (organization_id, manual_send_authorization_id),
  CONSTRAINT manual_send_provider_bindings_work_key
    UNIQUE (organization_id, durable_work_item_id),
  CONSTRAINT manual_send_provider_bindings_attempt_key
    UNIQUE (organization_id, durable_work_attempt_id),
  CONSTRAINT manual_send_provider_bindings_message_key
    UNIQUE (organization_id, communication_message_id),
  CONSTRAINT manual_send_provider_bindings_provider_key
    UNIQUE (organization_id, waha_session_name, raw_message_id),
  CONSTRAINT manual_send_provider_bindings_authorization_fkey
    FOREIGN KEY (organization_id, manual_send_authorization_id)
    REFERENCES platform.manual_send_authorizations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_send_provider_bindings_work_fkey
    FOREIGN KEY (organization_id, durable_work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_send_provider_bindings_attempt_fkey
    FOREIGN KEY (organization_id, durable_work_attempt_id)
    REFERENCES platform_private.durable_work_attempts(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_send_provider_bindings_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

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
        AND binding.waha_session_name = 'crm_primary'
    )
  THEN
    RAISE EXCEPTION
      'A private manual-send message requires its exact provider binding'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_provider_identity_check;

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_provider_identity_check CHECK (
    (
      message_identity_source = 'public_provider_id'
      AND autonomous_reply_intent_id IS NULL
      AND (waha_message_id IS NOT NULL OR kommo_message_id IS NOT NULL)
    )
    OR (
      message_identity_source = 'private_waha_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction = 'inbound'
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_waha_history_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction IN ('inbound', 'outbound')
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_autonomous_reply_binding'
      AND autonomous_reply_intent_id IS NOT NULL
      AND direction = 'outbound'
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_manual_send_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
  );

CREATE CONSTRAINT TRIGGER communication_messages_private_manual_send_binding
  AFTER INSERT OR UPDATE ON platform.communication_messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.require_private_manual_send_binding();

-- P8V preserves the Lead Agent as the sole crm_primary ingress owner. Its
-- signed internal sync stores the original verified provider event before
-- creating the same private WAHA binding used by the Platform conversation.
CREATE OR REPLACE FUNCTION platform_private.require_private_waha_message_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.message_identity_source = 'private_waha_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id
       AND source_event.id = binding.source_webhook_event_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND binding.waha_session_name IN ('evo-inbox', 'crm_primary')
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref =
          'waha:' || binding.waha_session_name
        AND source_event.waha_session_name = binding.waha_session_name
        AND source_event.payload_id = binding.raw_message_id
    )
  THEN
    RAISE EXCEPTION
      'A private WAHA message identity requires its exact immutable binding'
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
    AND binding.waha_session_name = 'crm_primary';

  SELECT *
  INTO reply_binding
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = work_item.organization_id
    AND binding.communication_message_id = source_message_row.id
    AND binding.waha_session_name = 'crm_primary';

  IF authorization_row.id IS NULL
    OR conversation_row.id IS NULL
    OR conversation_row.waha_session_name <> 'crm_primary'
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
    'waha_session_name', 'crm_primary',
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
    AND conversation.waha_session_name = 'crm_primary';

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
    AND participant.participant_kind = 'sales'
  ORDER BY participant.created_at, participant.id
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
      'crm_primary',
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

CREATE TABLE platform_private.lead_agent_sync_requests (
  request_id UUID PRIMARY KEY,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION platform.sync_lead_agent_whatsapp(
  p_organization_id UUID,
  p_provider_webhook_event_id UUID,
  p_intake_sales_membership_id UUID,
  p_amocrm_account_id BIGINT,
  p_amocrm_lead_id BIGINT,
  p_amocrm_contact_id BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_request platform_private.lead_agent_sync_requests%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  message_binding platform_private.waha_message_bindings%ROWTYPE;
  conversation_row platform.communication_conversations%ROWTYPE;
  customer_participant platform.conversation_participants%ROWTYPE;
  v_normalized_chat_id TEXT;
  v_inbound_body_text TEXT;
  v_raw_message_id TEXT;
  input_sha256 TEXT;
  result JSONB;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  created_customer_participant_id UUID := gen_random_uuid();
  created_sales_participant_id UUID := gen_random_uuid();
  created_message_id UUID := gen_random_uuid();
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL
    OR p_provider_webhook_event_id IS NULL
    OR p_intake_sales_membership_id IS NULL
    OR p_amocrm_account_id IS NULL OR p_amocrm_account_id <= 0
    OR p_amocrm_lead_id IS NULL OR p_amocrm_lead_id <= 0
    OR p_amocrm_contact_id IS NULL OR p_amocrm_contact_id <= 0
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Exact Lead-Agent sync identity is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p8v:lead-agent-sync-request:' || p_request_id::TEXT, 0)
  );
  input_sha256 := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id,
    'source_webhook_event_id', p_provider_webhook_event_id,
    'intake_sales_membership_id', p_intake_sales_membership_id,
    'amocrm_account_id', p_amocrm_account_id,
    'amocrm_lead_id', p_amocrm_lead_id,
    'amocrm_contact_id', p_amocrm_contact_id
  )::TEXT, 'UTF8')), 'hex');

  SELECT * INTO prior_request
  FROM platform_private.lead_agent_sync_requests AS request
  WHERE request.request_id = p_request_id;
  IF prior_request.request_id IS NOT NULL THEN
    IF prior_request.input_sha256 <> input_sha256 THEN
      RAISE EXCEPTION 'request_id was already used for another mutation'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior_request.response;
  END IF;

  SELECT * INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_provider_webhook_event_id;
  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:crm_primary'
    OR source_event.waha_session_name <> 'crm_primary'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'message.any'
    OR source_event.raw_payload ->> 'event' <> 'message.any'
    OR source_event.raw_payload ->> 'session' <> 'crm_primary'
    OR source_event.raw_payload #>> '{payload,fromMe}' <> 'false'
  THEN
    RAISE EXCEPTION 'Exact signed crm_primary source evidence is required'
      USING ERRCODE = '42501';
  END IF;

  v_raw_message_id := btrim(source_event.raw_payload #>> '{payload,id}');
  v_normalized_chat_id := platform_private.normalize_waha_direct_chat_id(
    source_event.raw_payload #>> '{payload,from}'
  );
  v_inbound_body_text := btrim(source_event.raw_payload #>> '{payload,body}');
  IF v_raw_message_id IS NULL OR v_raw_message_id = ''
    OR v_raw_message_id <> source_event.payload_id
    OR char_length(v_raw_message_id) > 256
    OR v_normalized_chat_id IS NULL
    OR v_inbound_body_text IS NULL OR v_inbound_body_text = ''
    OR char_length(v_inbound_body_text) > 4000
  THEN
    RAISE EXCEPTION 'Signed Lead-Agent message payload is malformed'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
     AND bundle.role = membership."current_role"
     AND bundle.status = 'published'
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_intake_sales_membership_id
      AND membership.status = 'active'
      AND membership."current_role" = 'sales'
      AND profile.status = 'active'
      AND organization.status = 'active'
      AND platform_private.membership_has_active_scope(
        p_organization_id, membership.id, 'organization', p_organization_id
      )
      AND (SELECT count(DISTINCT permission.permission_key) = 2
        FROM platform.role_bundle_permissions AS permission
        WHERE permission.bundle_id = bundle.id
          AND permission.bundle_role = bundle.role
          AND permission.permission_key IN (
            'organization.read', 'communication.read.full'
          ))
  ) THEN
    RAISE EXCEPTION 'Authorized intake Sales membership is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:p8v:crm-primary-chat:' || p_organization_id::TEXT || ':' ||
      v_normalized_chat_id, 0
  ));
  SELECT * INTO message_binding
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.waha_session_name = 'crm_primary'
    AND binding.raw_message_id = v_raw_message_id;

  IF message_binding.id IS NOT NULL THEN
    SELECT conversation.* INTO conversation_row
    FROM platform.communication_conversations AS conversation
    JOIN platform.communication_messages AS message
      ON message.organization_id = conversation.organization_id
     AND message.conversation_id = conversation.id
    WHERE conversation.organization_id = p_organization_id
      AND message.id = message_binding.communication_message_id;
    IF conversation_row.id IS NULL
      OR conversation_row.waha_session_name <> 'crm_primary'
      OR conversation_row.amocrm_account_id <> p_amocrm_account_id
      OR conversation_row.amocrm_lead_id <> p_amocrm_lead_id
      OR conversation_row.amocrm_contact_id <> p_amocrm_contact_id
    THEN
      RAISE EXCEPTION 'Duplicate message conflicts with canonical amoCRM identity'
        USING ERRCODE = '23505';
    END IF;
    created_conversation_id := conversation_row.id;
    created_message_id := message_binding.communication_message_id;
    result := jsonb_build_object(
      'conversation_id', created_conversation_id,
      'communication_message_id', created_message_id,
      'deduplicated', TRUE,
      'provider_identity_private', TRUE
    );
  ELSE
    SELECT * INTO direct_binding
    FROM platform_private.waha_direct_chat_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.waha_session_name = 'crm_primary'
      AND binding.normalized_chat_id = v_normalized_chat_id;
    IF direct_binding.id IS NULL THEN
      INSERT INTO platform.record_scopes (
        id, organization_id, scope_kind, scope_key, scope_version, is_active
      ) VALUES (
        created_scope_id, p_organization_id, 'conversation',
        created_conversation_id, 1, TRUE
      );
      INSERT INTO platform.membership_scope_assignments (
        organization_id, membership_id, scope_id, scope_version,
        assignment_version, granted, actor_kind, actor_profile_id,
        reason, request_id
      ) VALUES (
        p_organization_id, p_intake_sales_membership_id, created_scope_id, 1,
        1, TRUE, 'service', NULL,
        'Grant Sales access to one amoCRM-resolved crm_primary conversation',
        p_request_id
      );
      INSERT INTO platform.communication_conversations (
        id, organization_id, student_case_id,
        responsible_sales_membership_id, sales_authority_source,
        current_curator_membership_id, queue, status, subject,
        waha_session_name, kommo_account_id, kommo_conversation_id,
        amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
        current_scope_id, current_scope_version, created_from_webhook_event_id
      ) VALUES (
        created_conversation_id, p_organization_id, NULL,
        p_intake_sales_membership_id, 'provider_linked', NULL,
        'sales', 'open',
        'WhatsApp ••••' || right(split_part(v_normalized_chat_id, '@', 1), 4),
        'crm_primary', NULL, NULL,
        p_amocrm_account_id, p_amocrm_lead_id, p_amocrm_contact_id,
        created_scope_id, 1, source_event.id
      );
      INSERT INTO platform.conversation_participants (
        id, organization_id, conversation_id, participant_kind,
        membership_id, external_subject_ref, source_webhook_event_id
      ) VALUES
        (created_customer_participant_id, p_organization_id,
          created_conversation_id, 'customer', NULL,
          'waha-participant:' || created_customer_participant_id::TEXT,
          source_event.id),
        (created_sales_participant_id, p_organization_id,
          created_conversation_id, 'sales', p_intake_sales_membership_id,
          NULL, source_event.id);
      INSERT INTO platform_private.waha_direct_chat_bindings (
        organization_id, waha_session_name, normalized_chat_id,
        conversation_id, source_webhook_event_id
      ) VALUES (
        p_organization_id, 'crm_primary', v_normalized_chat_id,
        created_conversation_id, source_event.id
      );
      conversation_row.id := created_conversation_id;
    ELSE
      SELECT * INTO conversation_row
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = p_organization_id
        AND conversation.id = direct_binding.conversation_id;
      IF conversation_row.id IS NULL
        OR conversation_row.status <> 'open'
        OR conversation_row.waha_session_name <> 'crm_primary'
        OR conversation_row.sales_authority_source <> 'provider_linked'
        OR conversation_row.amocrm_account_id <> p_amocrm_account_id
        OR conversation_row.amocrm_lead_id <> p_amocrm_lead_id
        OR conversation_row.amocrm_contact_id <> p_amocrm_contact_id
      THEN
        RAISE EXCEPTION 'crm_primary chat binding conflicts with canonical identity'
          USING ERRCODE = '23505';
      END IF;
      SELECT * INTO customer_participant
      FROM platform.conversation_participants AS participant
      WHERE participant.organization_id = p_organization_id
        AND participant.conversation_id = conversation_row.id
        AND participant.participant_kind = 'customer'
      ORDER BY participant.created_at, participant.id
      LIMIT 1;
      IF customer_participant.id IS NULL THEN
        RAISE EXCEPTION 'Bound crm_primary conversation has no customer participant'
          USING ERRCODE = '55000';
      END IF;
      created_conversation_id := conversation_row.id;
      created_customer_participant_id := customer_participant.id;
    END IF;

    INSERT INTO platform.communication_messages (
      id, organization_id, conversation_id, student_case_id,
      sender_participant_id, direction, body_text, language,
      student_visible, message_identity_source,
      waha_session_name, waha_message_id,
      kommo_account_id, kommo_conversation_id, kommo_message_id,
      amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
      source_webhook_event_id, manual_send_authorization_id,
      autonomous_reply_intent_id, created_at
    ) VALUES (
      created_message_id, p_organization_id, created_conversation_id, NULL,
      created_customer_participant_id, 'inbound', v_inbound_body_text,
      'undetermined', FALSE, 'private_waha_binding',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      source_event.id, NULL, NULL, source_event.provider_occurred_at
    );
    INSERT INTO platform_private.waha_message_bindings (
      organization_id, waha_session_name, raw_message_id,
      communication_message_id, source_webhook_event_id
    ) VALUES (
      p_organization_id, 'crm_primary', v_raw_message_id,
      created_message_id, source_event.id
    );
    result := jsonb_build_object(
      'conversation_id', created_conversation_id,
      'communication_message_id', created_message_id,
      'deduplicated', FALSE,
      'provider_identity_private', TRUE
    );
  END IF;

  INSERT INTO platform_private.lead_agent_sync_requests (
    request_id, input_sha256, organization_id, source_webhook_event_id,
    conversation_id, communication_message_id, response
  ) VALUES (
    p_request_id, input_sha256, p_organization_id, source_event.id,
    created_conversation_id, created_message_id, result
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'service', NULL, 'service:evo-lead-agent',
    'communication.leadagent.sync', 'communication_message',
    created_message_id, NULL,
    jsonb_build_object(
      'conversation_id', created_conversation_id,
      'source_webhook_event_id', source_event.id,
      'deduplicated', result -> 'deduplicated'
    ),
    'Bind amoCRM-resolved signed Lead-Agent ingress to Platform',
    p_request_id
  );
  RETURN result;
END
$$;

ALTER TABLE platform_private.manual_send_provider_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.manual_send_provider_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_agent_sync_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.lead_agent_sync_requests FORCE ROW LEVEL SECURITY;

CREATE TRIGGER manual_send_provider_bindings_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.manual_send_provider_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER manual_send_provider_bindings_append_only_truncate
  BEFORE TRUNCATE ON platform_private.manual_send_provider_bindings
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER lead_agent_sync_requests_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.lead_agent_sync_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER lead_agent_sync_requests_append_only_truncate
  BEFORE TRUNCATE ON platform_private.lead_agent_sync_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON TABLE platform_private.manual_send_provider_bindings FROM PUBLIC;
REVOKE ALL ON TABLE platform_private.manual_send_provider_bindings FROM anon;
REVOKE ALL ON TABLE platform_private.manual_send_provider_bindings FROM authenticated;
REVOKE ALL ON TABLE platform_private.manual_send_provider_bindings FROM service_role;
REVOKE ALL ON TABLE platform_private.lead_agent_sync_requests FROM PUBLIC;
REVOKE ALL ON TABLE platform_private.lead_agent_sync_requests FROM anon;
REVOKE ALL ON TABLE platform_private.lead_agent_sync_requests FROM authenticated;
REVOKE ALL ON TABLE platform_private.lead_agent_sync_requests FROM service_role;

REVOKE ALL ON FUNCTION platform_private.require_private_manual_send_binding()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.claim_manual_whatsapp_send(
  UUID, INTEGER, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
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
GRANT EXECUTE ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
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

COMMENT ON TABLE platform_private.manual_send_provider_bindings IS
  'Private immutable provider identity for one staff-authorized manual WhatsApp send.';
COMMENT ON TABLE platform_private.lead_agent_sync_requests IS
  'Private idempotency receipts for amoCRM-resolved signed Lead-Agent ingress.';
COMMENT ON FUNCTION platform.sync_lead_agent_whatsapp(
  UUID, UUID, UUID, BIGINT, BIGINT, BIGINT, UUID
) IS
  'Projects one already-verified crm_primary Lead-Agent sync into Platform without creating a second WAHA ingress owner.';
COMMENT ON FUNCTION platform.claim_manual_whatsapp_send(
  UUID, INTEGER, TEXT, UUID
) IS
  'Claims only exact staff-authorized manual WhatsApp work and returns its private transport tuple to service_role.';
COMMENT ON FUNCTION platform.finish_manual_whatsapp_send(
  UUID,
  UUID,
  UUID,
  UUID,
  platform.durable_work_finish_outcome,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  UUID
) IS
  'Finishes one manual WhatsApp send and stores accepted provider identity only in private bindings.';
