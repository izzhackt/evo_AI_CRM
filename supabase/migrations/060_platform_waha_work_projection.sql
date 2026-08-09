-- ============================================================
-- 060_platform_waha_work_projection.sql
--
-- P5B: project already-verified WAHA webhook work into the greenfield
-- Platform communication model. This migration performs no provider call,
-- amoCRM/Kommo lookup, message send, queue finish or production action.
-- ============================================================

BEGIN;

-- The deferred amoCRM adapter must not be replaced with invented identifiers.
-- Existing provider-linked rows remain valid; new WAHA-only rows use all-null
-- Kommo/amoCRM tuples.
ALTER TABLE platform.communication_conversations
  ALTER COLUMN kommo_account_id DROP NOT NULL,
  ALTER COLUMN amocrm_account_id DROP NOT NULL,
  ALTER COLUMN amocrm_lead_id DROP NOT NULL,
  ALTER COLUMN amocrm_contact_id DROP NOT NULL;

ALTER TABLE platform.communication_conversations
  DROP CONSTRAINT communication_conversations_kommo_id_check;

ALTER TABLE platform.communication_conversations
  ADD CONSTRAINT communication_conversations_kommo_shape_check CHECK (
    (
      kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
    )
    OR (
      kommo_account_id IS NOT NULL
      AND (
        kommo_conversation_id IS NULL
        OR btrim(kommo_conversation_id) <> ''
      )
    )
  ),
  ADD CONSTRAINT communication_conversations_amocrm_shape_check CHECK (
    (
      amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      amocrm_account_id IS NOT NULL
      AND amocrm_lead_id IS NOT NULL
      AND amocrm_contact_id IS NOT NULL
    )
  );

-- The existing owner column remains the authorization join used by the
-- accepted communications model, but P5 must not present a Platform intake
-- assignment as amoCRM's canonical responsible Sales. Keep the provenance
-- explicit and immutable so deferred P4 can later perform one reviewed,
-- evidence-backed conversion instead of inferring ownership.
ALTER TABLE platform.communication_conversations
  ADD COLUMN sales_authority_source TEXT NOT NULL
    DEFAULT 'provider_linked',
  ADD CONSTRAINT communication_conversations_sales_authority_source_check
    CHECK (
      (
        sales_authority_source = 'provider_linked'
        AND amocrm_account_id IS NOT NULL
        AND amocrm_lead_id IS NOT NULL
        AND amocrm_contact_id IS NOT NULL
      )
      OR (
        sales_authority_source = 'platform_intake'
        AND student_case_id IS NULL
        AND queue = 'sales'
        AND current_curator_membership_id IS NULL
        AND kommo_account_id IS NULL
        AND kommo_conversation_id IS NULL
        AND amocrm_account_id IS NULL
        AND amocrm_lead_id IS NULL
        AND amocrm_contact_id IS NULL
      )
    );

DROP TRIGGER communication_conversations_identity_immutable
  ON platform.communication_conversations;
CREATE TRIGGER communication_conversations_identity_immutable
  BEFORE UPDATE ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_domain_identity(
    'id',
    'organization_id',
    'responsible_sales_membership_id',
    'sales_authority_source',
    'subject',
    'waha_session_name',
    'kommo_account_id',
    'kommo_conversation_id',
    'amocrm_account_id',
    'amocrm_lead_id',
    'amocrm_contact_id',
    'created_from_webhook_event_id',
    'created_at'
  );

ALTER TABLE platform.communication_messages
  ALTER COLUMN kommo_account_id DROP NOT NULL,
  ALTER COLUMN amocrm_account_id DROP NOT NULL,
  ALTER COLUMN amocrm_lead_id DROP NOT NULL,
  ALTER COLUMN amocrm_contact_id DROP NOT NULL;

ALTER TABLE platform.communication_messages
  ADD COLUMN message_identity_source TEXT NOT NULL
    DEFAULT 'public_provider_id';

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_kommo_shape_check;

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_kommo_shape_check CHECK (
    (
      kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
    )
    OR (
      kommo_account_id IS NOT NULL
      AND (
        (
          kommo_conversation_id IS NULL
          AND kommo_message_id IS NULL
        )
        OR (
          kommo_conversation_id IS NOT NULL
          AND btrim(kommo_conversation_id) <> ''
          AND kommo_message_id IS NOT NULL
          AND btrim(kommo_message_id) <> ''
        )
      )
    )
  ),
  ADD CONSTRAINT communication_messages_amocrm_shape_check CHECK (
    (
      amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      amocrm_account_id IS NOT NULL
      AND amocrm_lead_id IS NOT NULL
      AND amocrm_contact_id IS NOT NULL
    )
  );

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_provider_identity_check;
ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_provider_identity_check CHECK (
    (
      message_identity_source = 'public_provider_id'
      AND (
        waha_message_id IS NOT NULL
        OR kommo_message_id IS NOT NULL
      )
    )
    OR (
      message_identity_source = 'private_waha_binding'
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
  );

-- The full direct-chat identifier is deliberately private. Public Platform
-- participant rows receive only an opaque random reference, and the
-- conversation subject receives only a noncanonical last-four label.
CREATE TABLE platform_private.waha_direct_chat_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  waha_session_name TEXT NOT NULL CHECK (btrim(waha_session_name) <> ''),
  normalized_chat_id TEXT NOT NULL CHECK (
    normalized_chat_id ~ '^[0-9]+@c[.]us$'
  ),
  conversation_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_direct_chat_bindings_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_direct_chat_bindings_chat_key
    UNIQUE (organization_id, waha_session_name, normalized_chat_id),
  CONSTRAINT waha_direct_chat_bindings_conversation_key
    UNIQUE (organization_id, conversation_id),
  CONSTRAINT waha_direct_chat_bindings_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_direct_chat_bindings_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_direct_chat_bindings_source_idx
  ON platform_private.waha_direct_chat_bindings (
    organization_id,
    source_webhook_event_id
  );

-- WAHA message IDs can embed a full chat identifier. Keep the raw value in a
-- private append-only binding and expose no provider message identifier on the
-- Platform message row.
CREATE TABLE platform_private.waha_message_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  waha_session_name TEXT NOT NULL CHECK (btrim(waha_session_name) <> ''),
  raw_message_id TEXT NOT NULL CHECK (btrim(raw_message_id) <> ''),
  communication_message_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_message_bindings_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_message_bindings_provider_key
    UNIQUE (organization_id, waha_session_name, raw_message_id),
  CONSTRAINT waha_message_bindings_message_key
    UNIQUE (organization_id, communication_message_id),
  CONSTRAINT waha_message_bindings_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_message_bindings_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_message_bindings_source_idx
  ON platform_private.waha_message_bindings (
    organization_id,
    source_webhook_event_id
  );

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
        AND binding.waha_session_name = 'evo-inbox'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:evo-inbox'
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

-- One terminal projection effect may exist for an inbound durable work item.
CREATE TABLE platform_private.waha_work_projection_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('succeeded', 'terminal_error')
  ),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  request_id UUID NOT NULL UNIQUE,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_work_projection_effects_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_work_projection_effects_work_key
    UNIQUE (organization_id, work_item_id),
  CONSTRAINT waha_work_projection_effects_work_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_work_projection_effects_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.waha_work_projection_requests (
  request_id UUID PRIMARY KEY,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  intake_sales_membership_id UUID NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_work_projection_requests_work_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_work_projection_requests_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_work_projection_requests_sales_fkey
    FOREIGN KEY (organization_id, intake_sales_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE platform_private.waha_direct_chat_bindings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_direct_chat_bindings
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_message_bindings
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_message_bindings
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_work_projection_effects
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_work_projection_effects
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_work_projection_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_work_projection_requests
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER waha_direct_chat_bindings_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_direct_chat_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_direct_chat_bindings_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_direct_chat_bindings
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_message_bindings_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_message_bindings
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_message_bindings_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_message_bindings
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE CONSTRAINT TRIGGER communication_messages_private_waha_binding
  AFTER INSERT
  ON platform.communication_messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.require_private_waha_message_binding();

CREATE TRIGGER waha_work_projection_effects_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_work_projection_effects
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_work_projection_effects_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_work_projection_effects
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_work_projection_requests_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_work_projection_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_work_projection_requests_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_work_projection_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.normalize_waha_direct_chat_id(
  p_chat_id TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN lower(btrim(p_chat_id)) ~ '^[0-9]+@c[.]us$' THEN
      lower(btrim(p_chat_id))
    WHEN lower(btrim(p_chat_id)) ~ '^[0-9]+@s[.]whatsapp[.]net$' THEN
      regexp_replace(
        lower(btrim(p_chat_id)),
        '@s[.]whatsapp[.]net$',
        '@c.us'
      )
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.p5b_projection_result(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_disposition TEXT,
  p_evidence_ref TEXT,
  p_error_code TEXT
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'disposition', p_disposition,
    'evidence_ref', p_evidence_ref,
    'error_code', p_error_code
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.p5b_store_projection_result(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_source_webhook_event_id UUID,
  p_intake_sales_membership_id UUID,
  p_request_id UUID,
  p_input_sha256 TEXT,
  p_result JSONB,
  p_persist_effect BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  disposition TEXT := p_result ->> 'disposition';
  evidence_ref TEXT := p_result ->> 'evidence_ref';
BEGIN
  IF disposition NOT IN ('succeeded', 'retryable_error', 'terminal_error')
    OR evidence_ref IS NULL
    OR btrim(evidence_ref) = ''
    OR (p_result ->> 'organization_id') IS DISTINCT FROM
      p_organization_id::TEXT
    OR (p_result ->> 'work_item_id') IS DISTINCT FROM
      p_work_item_id::TEXT
    OR (p_result ->> 'attempt_id') IS DISTINCT FROM p_attempt_id::TEXT
  THEN
    RAISE EXCEPTION
      'Projection result violates the bounded response contract'
      USING ERRCODE = '22023';
  END IF;

  IF p_persist_effect THEN
    IF disposition = 'retryable_error' THEN
      RAISE EXCEPTION
        'Retryable projection results cannot become terminal effects'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO platform_private.waha_work_projection_effects (
      organization_id,
      work_item_id,
      source_webhook_event_id,
      disposition,
      evidence_ref,
      result,
      request_id
    )
    VALUES (
      p_organization_id,
      p_work_item_id,
      p_source_webhook_event_id,
      disposition,
      evidence_ref,
      p_result,
      p_request_id
    );
  END IF;

  INSERT INTO platform_private.waha_work_projection_requests (
    request_id,
    input_sha256,
    organization_id,
    work_item_id,
    attempt_id,
    intake_sales_membership_id,
    response
  )
  VALUES (
    p_request_id,
    p_input_sha256,
    p_organization_id,
    p_work_item_id,
    p_attempt_id,
    p_intake_sales_membership_id,
    p_result
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
    p_organization_id,
    'service',
    NULL,
    'service:platform-waha-projector',
    CASE
      WHEN disposition = 'retryable_error' THEN
        'communication.waha.project.retry'
      ELSE 'communication.waha.project'
    END,
    'durable_work_item',
    p_work_item_id,
    jsonb_build_object('attempt_id', p_attempt_id),
    p_result,
    'Project verified WAHA work without provider calls or identity fallback',
    p_request_id
  );

  RETURN p_result;
END
$$;

-- PGMQ's documented read implementation leases the oldest visible message
-- with vt <= clock_timestamp(), FOR UPDATE SKIP LOCKED, then updates vt and
-- read_ct. The generic pointer lacks organization_id, so this
-- tenant-specific wrapper mirrors those semantics while joining the private
-- ledger before leasing; it never touches another tenant or another work kind.
CREATE OR REPLACE FUNCTION platform.claim_waha_webhook_work(
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
  created_attempt_id UUID := gen_random_uuid();
  expiry_request_id UUID;
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
          'lane', 'provider_webhook_process'
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

  -- Claim tenant/session-scoped message work even when its stored raw envelope
  -- is malformed. The projector revalidates metadata, direction and source and
  -- records a terminal disposition, preventing poisoned verified rows from
  -- remaining visible in the queue forever.
  WITH candidate AS MATERIALIZED (
    SELECT queue_row.msg_id
    FROM pgmq.q_platform_work_v1 AS queue_row
    JOIN platform_private.durable_work_items AS item
      ON item.queue_message_id = queue_row.msg_id
     AND item.id::TEXT = queue_row.message ->> 'work_item_id'
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = item.organization_id
     AND source_event.id = item.source_webhook_event_id
    WHERE queue_row.vt <= clock_timestamp()
      AND item.organization_id = p_organization_id
      AND item.kind = 'provider_webhook_process'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:evo-inbox'
      AND source_event.waha_session_name = 'evo-inbox'
      AND source_event.verification_status = 'verified'
      AND source_event.event_type IN ('message', 'message.any')
      AND jsonb_typeof(queue_row.message) = 'object'
      AND queue_row.message ?& ARRAY['v', 'work_item_id', 'kind']
      AND queue_row.message - ARRAY['v', 'work_item_id', 'kind'] =
        '{}'::JSONB
      AND queue_row.message ->> 'v' = '1'
      AND queue_row.message ->> 'kind' = 'provider_webhook_process'
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
      queue_row.enqueued_at,
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
    AND item.kind = 'provider_webhook_process'
  FOR UPDATE;

  IF NOT FOUND
    OR work_item.state NOT IN ('queued', 'leased', 'retry_wait')
  THEN
    RAISE EXCEPTION
      'PGMQ pointer does not identify eligible tenant WAHA work'
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
      'queue', 'platform_work_v1',
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
      'service:platform-waha-projector',
      'work.dead.letter',
      'durable_work_item',
      work_item.id,
      jsonb_build_object(
        'state', work_item.state,
        'attempt_count', work_item.attempt_count
      ),
      result,
      'WAHA retry budget exhausted after visibility timeout',
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
    'kind', 'provider_webhook_process',
    'source_webhook_event_id', work_item.source_webhook_event_id,
    'queue', 'platform_work_v1',
    'queue_message_id', work_item.queue_message_id,
    'queue_read_count', queue_message.read_ct,
    'attempt_number', work_item.attempt_count + 1,
    'max_attempts', work_item.max_attempts,
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
    'service:platform-waha-projector',
    'work.claim',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count
    ),
    result,
    'Tenant-specific WAHA claim with PGMQ visibility timeout',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.project_claimed_waha_event(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_intake_sales_membership_id UUID,
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
  attempt platform_private.durable_work_attempts%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_request platform_private.waha_work_projection_requests%ROWTYPE;
  prior_effect platform_private.waha_work_projection_effects%ROWTYPE;
  binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  customer_participant platform.conversation_participants%ROWTYPE;
  sales_participant platform.conversation_participants%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  payload JSONB;
  input_sha256 TEXT;
  result JSONB;
  evidence_ref TEXT;
  error_code TEXT;
  persist_effect BOOLEAN := TRUE;
  chat_candidates TEXT[];
  chat_candidate TEXT;
  normalized_candidate TEXT;
  resolved_chat_id TEXT;
  customer_subject_ref TEXT;
  inbound_body_text TEXT;
  human_review_required BOOLEAN := FALSE;
  human_review_marker CONSTANT TEXT :=
    '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.';
  source_waha_message_id TEXT;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  created_customer_participant_id UUID := gen_random_uuid();
  created_sales_participant_id UUID := gen_random_uuid();
  created_message_id UUID := gen_random_uuid();
  handoff_event_id UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_work_item_id IS NULL
    OR p_attempt_id IS NULL
    OR p_intake_sales_membership_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Organization, work, attempt, intake Sales membership and request are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5b:projection-request:' || p_request_id::TEXT, 0)
  );

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'intake_sales_membership_id',
            p_intake_sales_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT *
  INTO prior_request
  FROM platform_private.waha_work_projection_requests AS request
  WHERE request.request_id = p_request_id;

  IF prior_request.request_id IS NOT NULL THEN
    IF prior_request.input_sha256 <> input_sha256 THEN
      RAISE EXCEPTION
        'request_id was already used for another WAHA projection'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior_request.response;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = p_request_id
  ) OR EXISTS (
    SELECT 1
    FROM platform_private.durable_work_idempotency AS idempotency
    WHERE idempotency.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION
      'request_id was already used for another mutation'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id
  FOR UPDATE;

  SELECT *
  INTO attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR attempt.id IS NULL
    OR work_item.kind <> 'provider_webhook_process'
    OR work_item.source_webhook_event_id IS NULL
  THEN
    RAISE EXCEPTION
      'The tenant work item and attempt do not identify WAHA webhook work'
      USING ERRCODE = '42501';
  END IF;

  IF work_item.state <> 'leased'
    OR attempt.finished_at IS NOT NULL
    OR attempt.attempt_number <> work_item.attempt_count
    OR attempt.lease_expires_at <= clock_timestamp()
    OR work_item.leased_until <= clock_timestamp()
  THEN
    RAISE EXCEPTION
      'Only the current non-expired WAHA claim can be projected'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = work_item.source_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:evo-inbox'
    OR source_event.waha_session_name <> 'evo-inbox'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
  THEN
    RAISE EXCEPTION
      'Verified tenant-matched inbound WAHA message evidence is required'
      USING ERRCODE = '42501';
  END IF;

  payload := source_event.raw_payload -> 'payload';

  -- Inbound conversation ownership always requires an active Sales member.
  IF source_event.event_type IN ('message', 'message.any')
    AND NOT EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
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
          p_organization_id,
          membership.id,
          'organization',
          p_organization_id
        )
        AND (
          SELECT count(DISTINCT permission.permission_key) = 2
          FROM platform.role_bundle_permissions AS permission
          WHERE permission.bundle_id = bundle.id
            AND permission.bundle_role = bundle.role
            AND permission.permission_key IN (
              'organization.read',
              'communication.read.full'
            )
        )
    )
  THEN
    RAISE EXCEPTION
      'An authorized tenant intake Sales membership is required for inbound projection'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO prior_effect
  FROM platform_private.waha_work_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.work_item_id = p_work_item_id;

  IF prior_effect.id IS NOT NULL THEN
    result := prior_effect.result || jsonb_build_object(
      'attempt_id', p_attempt_id,
      'deduplicated', TRUE
    );

    RETURN platform_private.p5b_store_projection_result(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      source_event.id,
      p_intake_sales_membership_id,
      p_request_id,
      input_sha256,
      result,
      FALSE
    );
  END IF;

  <<project_event>>
  BEGIN
    IF jsonb_typeof(source_event.raw_payload) <> 'object'
      OR jsonb_typeof(payload) <> 'object'
      OR source_event.raw_payload ->> 'event' IS DISTINCT FROM
        source_event.event_type
      OR source_event.raw_payload ->> 'session' IS DISTINCT FROM
        source_event.waha_session_name
    THEN
      error_code := 'waha_event_metadata_mismatch';
      evidence_ref := 'waha-projection:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_event;
    END IF;

    IF source_event.event_type IN ('message', 'message.any') THEN
      IF payload -> 'fromMe' = 'true'::JSONB THEN
        error_code := 'waha_inbound_from_me';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      ELSIF payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB THEN
        error_code := 'waha_inbound_direction_unverified';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      IF lower(COALESCE(btrim(payload ->> 'source'), '')) = 'api' THEN
        error_code := 'waha_inbound_api_source';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      source_waha_message_id := NULLIF(btrim(payload ->> 'id'), '');
      IF source_waha_message_id IS NULL
        OR source_waha_message_id IS DISTINCT FROM source_event.payload_id
      THEN
        error_code := 'waha_inbound_message_id_invalid';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      inbound_body_text := NULLIF(btrim(payload ->> 'body'), '');
      human_review_required :=
        jsonb_typeof(payload -> 'body') IS DISTINCT FROM 'string'
        OR inbound_body_text IS NULL;

      IF human_review_required THEN
        -- The accepted communications contract requires non-empty body_text,
        -- while P5B does not yet download or interpret media. Preserve the raw
        -- event and exact private provider identity, expose only this fixed
        -- non-customer marker, and create a durable staff handoff below.
        inbound_body_text := human_review_marker;
      END IF;

      chat_candidates := ARRAY[
        NULLIF(btrim(payload ->> 'from'), ''),
        NULLIF(btrim(payload ->> 'chatId'), ''),
        NULLIF(btrim(payload #>> '{_data,from}'), ''),
        NULLIF(btrim(payload #>> '{_data,id,remote}'), '')
      ];

      FOREACH chat_candidate IN ARRAY chat_candidates LOOP
        IF chat_candidate IS NOT NULL THEN
          normalized_candidate :=
            platform_private.normalize_waha_direct_chat_id(chat_candidate);
          IF normalized_candidate IS NULL THEN
            error_code := 'waha_inbound_unsupported_chat';
            evidence_ref := 'waha-projection:' || source_event.id::TEXT
              || ':' || error_code;
            result := platform_private.p5b_projection_result(
              p_organization_id, p_work_item_id, p_attempt_id,
              'terminal_error', evidence_ref, error_code
            );
            EXIT project_event;
          END IF;

          IF resolved_chat_id IS NULL THEN
            resolved_chat_id := normalized_candidate;
          ELSIF resolved_chat_id <> normalized_candidate THEN
            error_code := 'waha_inbound_chat_conflict';
            evidence_ref := 'waha-projection:' || source_event.id::TEXT
              || ':' || error_code;
            result := platform_private.p5b_projection_result(
              p_organization_id, p_work_item_id, p_attempt_id,
              'terminal_error', evidence_ref, error_code
            );
            EXIT project_event;
          END IF;
        END IF;
      END LOOP;

      IF result IS NOT NULL THEN
        EXIT project_event;
      END IF;

      IF resolved_chat_id IS NULL THEN
        error_code := 'waha_inbound_chat_required';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          'evo:p5b:waha-chat:' || p_organization_id::TEXT || ':'
            || source_event.waha_session_name || ':' || resolved_chat_id,
          0
        )
      );

      SELECT *
      INTO binding
      FROM platform_private.waha_direct_chat_bindings AS candidate
      WHERE candidate.organization_id = p_organization_id
        AND candidate.waha_session_name = source_event.waha_session_name
        AND candidate.normalized_chat_id = resolved_chat_id;

      IF binding.id IS NULL THEN
        -- Public rows receive an opaque random reference. The private binding
        -- remains the only place that maps it back to the WAHA chat id.
        customer_subject_ref :=
          'waha-participant:' || created_customer_participant_id::TEXT;

        INSERT INTO platform.record_scopes (
          id,
          organization_id,
          scope_kind,
          scope_key,
          scope_version,
          is_active
        )
        VALUES (
          created_scope_id,
          p_organization_id,
          'conversation',
          created_conversation_id,
          1,
          TRUE
        );

        INSERT INTO platform.membership_scope_assignments (
          organization_id,
          membership_id,
          scope_id,
          scope_version,
          assignment_version,
          granted,
          actor_kind,
          actor_profile_id,
          reason,
          request_id
        )
        VALUES (
          p_organization_id,
          p_intake_sales_membership_id,
          created_scope_id,
          1,
          1,
          TRUE,
          'service',
          NULL,
          'Grant Sales access to one WAHA-only conversation',
          p_request_id
        );

        -- This is an additive, live-checked record-scope grant. Changing the
        -- profile access_version here would invalidate the operator's JWT on
        -- every new inbound chat even though no coarse role or revocation
        -- changed. Revocation/reassignment paths still rotate access_version.

        INSERT INTO platform.communication_conversations (
          id,
          organization_id,
          student_case_id,
          responsible_sales_membership_id,
          sales_authority_source,
          current_curator_membership_id,
          queue,
          status,
          subject,
          waha_session_name,
          kommo_account_id,
          kommo_conversation_id,
          amocrm_account_id,
          amocrm_lead_id,
          amocrm_contact_id,
          current_scope_id,
          current_scope_version,
          created_from_webhook_event_id
        )
        VALUES (
          created_conversation_id,
          p_organization_id,
          NULL,
          p_intake_sales_membership_id,
          'platform_intake',
          NULL,
          'sales',
          'open',
          'WhatsApp ••••' || right(
            split_part(resolved_chat_id, '@', 1),
            4
          ),
          source_event.waha_session_name,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          created_scope_id,
          1,
          source_event.id
        );

        INSERT INTO platform.conversation_participants (
          id,
          organization_id,
          conversation_id,
          participant_kind,
          membership_id,
          external_subject_ref,
          source_webhook_event_id
        )
        VALUES
          (
            created_customer_participant_id,
            p_organization_id,
            created_conversation_id,
            'customer',
            NULL,
            customer_subject_ref,
            source_event.id
          ),
          (
            created_sales_participant_id,
            p_organization_id,
            created_conversation_id,
            'sales',
            p_intake_sales_membership_id,
            NULL,
            source_event.id
          );

        INSERT INTO platform_private.waha_direct_chat_bindings (
          organization_id,
          waha_session_name,
          normalized_chat_id,
          conversation_id,
          source_webhook_event_id
        )
        VALUES (
          p_organization_id,
          source_event.waha_session_name,
          resolved_chat_id,
          created_conversation_id,
          source_event.id
        );

        conversation.id := created_conversation_id;
        conversation.organization_id := p_organization_id;
        conversation.responsible_sales_membership_id :=
          p_intake_sales_membership_id;
        conversation.waha_session_name := source_event.waha_session_name;
        customer_participant.id := created_customer_participant_id;
        sales_participant.id := created_sales_participant_id;
      ELSE
        SELECT *
        INTO conversation
        FROM platform.communication_conversations AS candidate
        WHERE candidate.organization_id = p_organization_id
          AND candidate.id = binding.conversation_id;

        IF conversation.id IS NULL
          OR conversation.waha_session_name <>
            source_event.waha_session_name
          OR conversation.sales_authority_source <> 'platform_intake'
          OR conversation.queue <> 'sales'
          OR conversation.student_case_id IS NOT NULL
          OR conversation.current_curator_membership_id IS NOT NULL
        THEN
          RAISE EXCEPTION
            'A WAHA direct-chat binding cannot be reassigned or inferred'
            USING ERRCODE = '55000';
        END IF;

        SELECT *
        INTO customer_participant
        FROM platform.conversation_participants AS participant
        WHERE participant.organization_id = p_organization_id
          AND participant.conversation_id = conversation.id
          AND participant.participant_kind = 'customer'
        ORDER BY participant.created_at, participant.id
        LIMIT 1;

        SELECT *
        INTO sales_participant
        FROM platform.conversation_participants AS participant
        WHERE participant.organization_id = p_organization_id
          AND participant.conversation_id = conversation.id
          AND participant.participant_kind = 'sales'
          AND participant.membership_id =
            conversation.responsible_sales_membership_id
        ORDER BY participant.created_at, participant.id
        LIMIT 1;

        IF customer_participant.id IS NULL OR sales_participant.id IS NULL THEN
          RAISE EXCEPTION
            'Bound WAHA conversation participants are incomplete'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      SELECT message.*
      INTO message_row
      FROM platform_private.waha_message_bindings AS message_binding
      JOIN platform.communication_messages AS message
        ON message.organization_id = message_binding.organization_id
       AND message.id = message_binding.communication_message_id
      WHERE message_binding.organization_id = p_organization_id
        AND message_binding.waha_session_name =
          source_event.waha_session_name
        AND message_binding.raw_message_id = source_waha_message_id;

      IF message_row.id IS NOT NULL THEN
        IF message_row.conversation_id <> conversation.id
          OR message_row.direction <> 'inbound'
          OR message_row.sender_participant_id <> customer_participant.id
          OR message_row.body_text <> inbound_body_text
        THEN
          error_code := 'waha_inbound_message_conflict';
          evidence_ref := 'waha-projection:' || source_event.id::TEXT
            || ':' || error_code;
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'terminal_error', evidence_ref, error_code
          );
          EXIT project_event;
        END IF;
      ELSE
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
          created_at
        )
        VALUES (
          created_message_id,
          p_organization_id,
          conversation.id,
          NULL,
          customer_participant.id,
          'inbound',
          inbound_body_text,
          'undetermined',
          FALSE,
          'private_waha_binding',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          source_event.id,
          NULL,
          source_event.provider_occurred_at
        );
        message_row.id := created_message_id;

        INSERT INTO platform_private.waha_message_bindings (
          organization_id,
          waha_session_name,
          raw_message_id,
          communication_message_id,
          source_webhook_event_id
        )
        VALUES (
          p_organization_id,
          source_event.waha_session_name,
          source_waha_message_id,
          created_message_id,
          source_event.id
        );

        -- Queue activity is derived from the append-only message history below.
        -- Do not weaken the reviewed link/handoff/close transition guard merely
        -- to touch the parent conversation timestamp.
      END IF;

      IF human_review_required THEN
        INSERT INTO platform.conversation_handoff_events (
          organization_id,
          conversation_id,
          previous_student_case_id,
          new_student_case_id,
          previous_queue,
          new_queue,
          previous_owner_membership_id,
          new_owner_membership_id,
          source_webhook_event_id,
          student_case_assignment_event_id,
          reason,
          request_id
        )
        VALUES (
          p_organization_id,
          conversation.id,
          NULL,
          NULL,
          CASE
            WHEN binding.id IS NULL THEN NULL
            ELSE 'sales'::platform.communication_queue
          END,
          'sales',
          CASE
            WHEN binding.id IS NULL THEN NULL
            ELSE conversation.responsible_sales_membership_id
          END,
          conversation.responsible_sales_membership_id,
          source_event.id,
          NULL,
          'Inbound WAHA content without text requires staff review',
          source_event.id
        )
        RETURNING id INTO handoff_event_id;
      END IF;

      evidence_ref := CASE
        WHEN human_review_required
          THEN 'waha-inbound-human-review:' || source_event.id::TEXT
        ELSE 'waha-inbound-projected:' || source_event.id::TEXT
      END;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'succeeded',
        evidence_ref,
        NULL
      ) || jsonb_build_object(
        'communication_conversation_id', conversation.id,
        'communication_message_id', message_row.id,
        'customer_participant_id', customer_participant.id,
        'sales_participant_id', sales_participant.id,
        'human_review_required', human_review_required,
        'handoff_event_id', handoff_event_id
      );
    ELSE
      error_code := 'waha_event_type_unsupported';
      evidence_ref := 'waha-projection:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id, p_work_item_id, p_attempt_id,
        'terminal_error', evidence_ref, error_code
      );
    END IF;
  END project_event;

  RETURN platform_private.p5b_store_projection_result(
    p_organization_id,
    p_work_item_id,
    p_attempt_id,
    source_event.id,
    p_intake_sales_membership_id,
    p_request_id,
    input_sha256,
    result,
    persist_effect
  );
END
$$;

-- Bind the generic durable-work finish envelope back to the tenant and the
-- verified inbound WAHA lane. The generic terminal/dead-letter branch predates
-- P5B and omits organization_id, which is too weak for the server response
-- validator even though the mutation succeeds. This wrapper adds no new work
-- outcome; it only validates and returns a stable org-bound envelope.
CREATE OR REPLACE FUNCTION platform.finish_waha_webhook_work(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_outcome platform.durable_work_finish_outcome,
  p_error_code TEXT,
  p_evidence_ref TEXT,
  p_retry_delay_seconds INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_outcome NOT IN (
      'succeeded',
      'retryable_error',
      'terminal_error'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM platform_private.durable_work_items AS item
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = item.organization_id
       AND source_event.id = item.source_webhook_event_id
      WHERE item.organization_id = p_organization_id
        AND item.id = p_work_item_id
        AND item.kind = 'provider_webhook_process'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:evo-inbox'
        AND source_event.waha_session_name = 'evo-inbox'
        AND source_event.verification_status = 'verified'
        AND source_event.event_type IN ('message', 'message.any')
        AND EXISTS (
          SELECT 1
          FROM platform_private.waha_work_projection_requests AS projection
          WHERE projection.organization_id = p_organization_id
            AND projection.work_item_id = p_work_item_id
            AND projection.attempt_id = p_attempt_id
            AND projection.response ->> 'disposition' = p_outcome::TEXT
            AND projection.response ->> 'evidence_ref' IS NOT DISTINCT FROM
              p_evidence_ref
            AND projection.response ->> 'error_code' IS NOT DISTINCT FROM
              p_error_code
        )
    )
  THEN
    RAISE EXCEPTION
      'Only tenant-matched verified inbound WAHA work can be finished here'
      USING ERRCODE = '42501';
  END IF;

  result := platform.finish_durable_work(
    p_work_item_id,
    p_attempt_id,
    p_outcome,
    p_error_code,
    p_evidence_ref,
    p_retry_delay_seconds,
    p_request_id
  );

  IF result ->> 'work_item_id' IS DISTINCT FROM p_work_item_id::TEXT
    OR result ->> 'attempt_id' IS DISTINCT FROM p_attempt_id::TEXT
    OR result ->> 'outcome' IS DISTINCT FROM p_outcome::TEXT
    OR NULLIF(btrim(result ->> 'state'), '') IS NULL
  THEN
    RAISE EXCEPTION
      'Durable finish returned an invalid WAHA work envelope'
      USING ERRCODE = '55000';
  END IF;

  RETURN result || jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', p_work_item_id,
    'attempt_id', p_attempt_id,
    'outcome', p_outcome
  );
END
$$;

-- Keep the accepted staff queue ordered by real observation time without
-- mutating the guarded conversation parent for each inbound message. Message
-- chronology still uses the provider-signed occurrence time; the append-only
-- webhook receipt supplies the separate arrival clock used for staff work.
-- The RPC's authorization and return shape remain unchanged.
CREATE OR REPLACE FUNCTION platform.staff_communication_queue(
  p_organization_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at
  FROM platform.communication_conversations AS conversation
  LEFT JOIN LATERAL (
    SELECT source_event.received_at AS observed_at
    FROM platform.communication_messages AS message
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = message.organization_id
     AND source_event.id = message.source_webhook_event_id
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND source_event.verification_status = 'verified'
    ORDER BY source_event.received_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_observation ON TRUE
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
  ORDER BY GREATEST(conversation.updated_at, COALESCE(latest_observation.observed_at, conversation.updated_at)) DESC, conversation.id;
END
$$;

REVOKE ALL ON TABLE
  platform_private.waha_direct_chat_bindings,
  platform_private.waha_message_bindings,
  platform_private.waha_work_projection_effects,
  platform_private.waha_work_projection_requests
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.normalize_waha_direct_chat_id(TEXT),
  platform_private.require_private_waha_message_binding(),
  platform_private.p5b_projection_result(UUID, UUID, UUID, TEXT, TEXT, TEXT),
  platform_private.p5b_store_projection_result(
    UUID,
    UUID,
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    JSONB,
    BOOLEAN
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.claim_waha_webhook_work(UUID, INTEGER, TEXT, UUID),
  platform.project_claimed_waha_event(UUID, UUID, UUID, UUID, UUID),
  platform.finish_waha_webhook_work(
    UUID,
    UUID,
    UUID,
    platform.durable_work_finish_outcome,
    TEXT,
    TEXT,
    INTEGER,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.claim_waha_webhook_work(UUID, INTEGER, TEXT, UUID),
  platform.project_claimed_waha_event(UUID, UUID, UUID, UUID, UUID),
  platform.finish_waha_webhook_work(
    UUID,
    UUID,
    UUID,
    platform.durable_work_finish_outcome,
    TEXT,
    TEXT,
    INTEGER,
    UUID
  )
TO service_role;

COMMENT ON TABLE platform_private.waha_direct_chat_bindings IS
  'Private immutable tenant/session/direct-chat binding; full WAHA chat IDs never enter public projections.';
COMMENT ON TABLE platform_private.waha_message_bindings IS
  'Private immutable tenant/session/raw-message binding; WAHA message IDs never enter public projections.';
COMMENT ON COLUMN platform.communication_messages.message_identity_source IS
  'Immutable provenance: public provider identity or an exact private WAHA binding enforced at commit.';
COMMENT ON TABLE platform_private.waha_work_projection_effects IS
  'One append-only succeeded/terminal WAHA projection effect per durable work item.';
COMMENT ON TABLE platform_private.waha_work_projection_requests IS
  'Append-only request replay ledger for claimed WAHA projection attempts.';
COMMENT ON FUNCTION platform.claim_waha_webhook_work(
  UUID,
  INTEGER,
  TEXT,
  UUID
) IS
  'Claims only visible provider_webhook_process work for one tenant while mirroring PGMQ read lease semantics.';
COMMENT ON FUNCTION platform.project_claimed_waha_event(
  UUID,
  UUID,
  UUID,
  UUID,
  UUID
) IS
  'Projects one current verified inbound WAHA message into scoped messaging without finishing the queue.';
COMMENT ON FUNCTION platform.finish_waha_webhook_work(
  UUID,
  UUID,
  UUID,
  platform.durable_work_finish_outcome,
  TEXT,
  TEXT,
  INTEGER,
  UUID
) IS
  'Finishes only tenant-matched verified inbound WAHA work with a matching persisted projection receipt and returns an organization-bound response envelope.';

COMMIT;
