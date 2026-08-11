-- ============================================================
-- 067_platform_autonomous_inbound_replies.sql
--
-- P5F3: disabled-by-default deterministic autonomous replies to one exact
-- latest customer inbound. Policy/control/intent/attempt/provider identity
-- evidence is private and append-only. The exposed projection is safe staff
-- state only; it contains no WAHA identifiers, response bodies or hashes.
-- ============================================================

BEGIN;

-- Keep the accepted P5E implementation intact for inbound/history/session
-- observations. A narrow wrapper added below handles only ACKs whose raw
-- provider identity resolves through the new autonomous binding ledger.
ALTER FUNCTION platform.project_claimed_waha_observation(
  UUID,
  UUID,
  UUID,
  UUID,
  UUID
)
RENAME TO project_claimed_waha_observation_p5e;

CREATE TYPE platform.autonomy_control_state AS ENUM (
  'enabled',
  'paused',
  'staff_takeover',
  'opted_out'
);

CREATE TYPE platform.autonomous_reply_decision_state AS ENUM (
  'blocked',
  'queued'
);

CREATE TYPE platform.autonomous_reply_intent_state AS ENUM (
  'queued',
  'dispatching',
  'accepted',
  'rejected',
  'unknown',
  'manual_review'
);

CREATE TYPE platform.autonomous_reply_attempt_outcome AS ENUM (
  'accepted',
  'rejected',
  'unknown',
  'blocked'
);

CREATE OR REPLACE FUNCTION platform_private.p5f3_reason_is_valid(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_value = pg_catalog.btrim(p_value)
    AND pg_catalog.char_length(p_value) BETWEEN 3 AND 500,
    FALSE
  )
$$;

CREATE OR REPLACE FUNCTION
platform_private.p5f3_block_reason_is_valid(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(p_value IN (
    'autonomy_paused',
    'staff_takeover',
    'staff_outbound_after_enable',
    'opted_out',
    'conversation_closed',
    'source_not_latest',
    'source_not_inbound',
    'source_unsupported',
    'outside_reply_window',
    'outside_business_hours',
    'proposal_unavailable',
    'proposal_not_ready',
    'unsupported_language',
    'unsupported_intent',
    'low_confidence',
    'risk_not_low',
    'handoff_required',
    'handoff_reason_present',
    'approved_evidence_missing',
    'session_unhealthy',
    'cooldown_active',
    'rolling_rate_exhausted',
    'consecutive_limit_reached',
    'binding_unavailable',
    'mutable_gate_blocked'
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION
platform_private.p5f3_finish_error_code_is_valid(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(p_value IN (
    'provider_rejected',
    'provider_timeout',
    'provider_connection_lost',
    'provider_malformed_response',
    'provider_ambiguous_response',
    'provider_preflight_failed',
    'mutable_gate_blocked',
    'lease_expired'
  ), FALSE)
$$;

-- This private seam exists only so disposable local proof can pin policy-time
-- comparisons inside the approved business window. Audit, lease and provider
-- evidence always continue to use the real database clock.
CREATE OR REPLACE FUNCTION platform_private.p5f3_policy_now()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.statement_timestamp()
$$;

CREATE TABLE platform_private.conversation_autonomy_control_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  previous_state platform.autonomy_control_state NOT NULL,
  new_state platform.autonomy_control_state NOT NULL,
  recorded_by_membership_id UUID,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'service')),
  reason TEXT NOT NULL CHECK (
    platform_private.p5f3_reason_is_valid(reason)
  ),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  response JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT conversation_autonomy_control_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT conversation_autonomy_control_version_key
    UNIQUE (organization_id, conversation_id, version),
  CONSTRAINT conversation_autonomy_control_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_autonomy_control_actor_fkey
    FOREIGN KEY (organization_id, recorded_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_autonomy_control_actor_shape_check CHECK (
    (actor_kind = 'user' AND recorded_by_membership_id IS NOT NULL)
    OR (actor_kind = 'service' AND recorded_by_membership_id IS NULL)
  )
);

CREATE INDEX conversation_autonomy_control_latest_idx
  ON platform_private.conversation_autonomy_control_events (
    organization_id,
    conversation_id,
    version DESC
  );

CREATE TABLE platform_private.autonomous_reply_gate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  proposal_request_id UUID NOT NULL,
  decision_state platform.autonomous_reply_decision_state NOT NULL,
  reason_code TEXT,
  policy_version TEXT NOT NULL CHECK (policy_version = 'p5f3-v1'),
  control_version BIGINT NOT NULL CHECK (control_version >= 0),
  gate_snapshot JSONB NOT NULL CHECK (
    pg_catalog.jsonb_typeof(gate_snapshot) = 'object'
    AND pg_catalog.char_length(gate_snapshot::TEXT) <= 16384
  ),
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_gate_decisions_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_gate_decisions_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_gate_decisions_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_gate_decisions_proposal_fkey
    FOREIGN KEY (
      organization_id,
      proposal_request_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform_private.gemini_proposal_requests(
      organization_id,
      id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_gate_decisions_shape_check CHECK (
    (decision_state = 'queued' AND reason_code IS NULL)
    OR (
      decision_state = 'blocked'
      AND platform_private.p5f3_block_reason_is_valid(reason_code)
    )
  )
);

CREATE INDEX autonomous_reply_gate_decisions_latest_idx
  ON platform_private.autonomous_reply_gate_decisions (
    organization_id,
    conversation_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE platform_private.autonomous_reply_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  proposal_request_id UUID NOT NULL,
  gate_decision_id UUID NOT NULL,
  direct_chat_binding_id UUID NOT NULL,
  reply_to_message_binding_id UUID NOT NULL,
  policy_version TEXT NOT NULL CHECK (policy_version = 'p5f3-v1'),
  idempotency_key UUID NOT NULL UNIQUE,
  reply_text TEXT NOT NULL CHECK (
    reply_text = pg_catalog.btrim(reply_text)
    AND pg_catalog.char_length(reply_text) BETWEEN 1 AND 4096
  ),
  reply_sha256 TEXT NOT NULL CHECK (reply_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_intents_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_intents_proposal_source_key
    UNIQUE (organization_id, proposal_request_id, source_message_id),
  CONSTRAINT autonomous_reply_intents_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_intents_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_intents_gate_fkey
    FOREIGN KEY (organization_id, gate_decision_id)
    REFERENCES platform_private.autonomous_reply_gate_decisions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_intents_direct_chat_fkey
    FOREIGN KEY (organization_id, direct_chat_binding_id)
    REFERENCES platform_private.waha_direct_chat_bindings(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_intents_reply_to_fkey
    FOREIGN KEY (organization_id, reply_to_message_binding_id)
    REFERENCES platform_private.waha_message_bindings(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX autonomous_reply_intents_conversation_idx
  ON platform_private.autonomous_reply_intents (
    organization_id,
    conversation_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE platform_private.autonomous_reply_intent_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  intent_id UUID NOT NULL,
  state platform.autonomous_reply_intent_state NOT NULL,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_lifecycle_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_lifecycle_state_key
    UNIQUE (organization_id, intent_id, state),
  CONSTRAINT autonomous_reply_lifecycle_intent_fkey
    FOREIGN KEY (organization_id, intent_id)
    REFERENCES platform_private.autonomous_reply_intents(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_lifecycle_reason_shape_check CHECK (
    (state IN ('queued', 'dispatching', 'accepted') AND reason_code IS NULL)
    OR (state IN ('rejected', 'unknown', 'manual_review') AND reason_code IS NOT NULL)
  )
);

CREATE INDEX autonomous_reply_lifecycle_latest_idx
  ON platform_private.autonomous_reply_intent_lifecycle (
    organization_id,
    intent_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE platform_private.autonomous_reply_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  intent_id UUID NOT NULL,
  worker_ref TEXT NOT NULL CHECK (
    worker_ref = pg_catalog.btrim(worker_ref)
    AND worker_ref ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  response JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_attempts_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_attempts_org_id_intent_key
    UNIQUE (organization_id, id, intent_id),
  CONSTRAINT autonomous_reply_attempts_intent_key
    UNIQUE (organization_id, intent_id),
  CONSTRAINT autonomous_reply_attempts_intent_fkey
    FOREIGN KEY (organization_id, intent_id)
    REFERENCES platform_private.autonomous_reply_intents(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_attempts_lease_check CHECK (
    lease_expires_at > created_at
  )
);

CREATE TABLE platform_private.autonomous_reply_claim_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  response JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_claim_receipts_org_id_key
    UNIQUE (organization_id, request_id),
  CONSTRAINT autonomous_reply_claim_receipts_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES platform.organizations(id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.autonomous_reply_attempt_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  intent_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  outcome platform.autonomous_reply_attempt_outcome NOT NULL,
  error_code TEXT,
  provider_observed_at TIMESTAMPTZ,
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  response JSONB NOT NULL CHECK (pg_catalog.jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_attempt_results_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_attempt_results_attempt_key
    UNIQUE (organization_id, attempt_id),
  CONSTRAINT autonomous_reply_attempt_results_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id, intent_id)
    REFERENCES platform_private.autonomous_reply_attempts(
      organization_id,
      id,
      intent_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_attempt_results_shape_check CHECK (
    (outcome = 'accepted' AND error_code IS NULL AND provider_observed_at IS NOT NULL)
    OR (outcome <> 'accepted' AND error_code IS NOT NULL)
  )
);

CREATE TABLE platform_private.autonomous_reply_provider_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  intent_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (waha_session_name = 'evo-inbox'),
  raw_message_id TEXT NOT NULL CHECK (
    pg_catalog.char_length(raw_message_id) BETWEEN 1 AND 512
    AND raw_message_id ~ '^[ -~]+$'
  ),
  provider_observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT autonomous_reply_provider_bindings_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT autonomous_reply_provider_bindings_intent_key
    UNIQUE (organization_id, intent_id),
  CONSTRAINT autonomous_reply_provider_bindings_attempt_key
    UNIQUE (organization_id, attempt_id),
  CONSTRAINT autonomous_reply_provider_bindings_message_key
    UNIQUE (organization_id, communication_message_id),
  CONSTRAINT autonomous_reply_provider_bindings_provider_key
    UNIQUE (organization_id, waha_session_name, raw_message_id),
  CONSTRAINT autonomous_reply_provider_bindings_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id, intent_id)
    REFERENCES platform_private.autonomous_reply_attempts(
      organization_id,
      id,
      intent_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT autonomous_reply_provider_bindings_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.conversation_autonomous_reply_state (
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  control_state platform.autonomy_control_state NOT NULL DEFAULT 'paused',
  control_version BIGINT NOT NULL DEFAULT 0 CHECK (control_version >= 0),
  control_reason TEXT NOT NULL DEFAULT 'no_control_event',
  control_recorded_at TIMESTAMPTZ,
  decision_state platform.autonomous_reply_decision_state,
  decision_reason_code TEXT,
  policy_version TEXT CHECK (policy_version IS NULL OR policy_version = 'p5f3-v1'),
  proposal_request_id UUID,
  source_message_id UUID,
  intent_id UUID,
  intent_state platform.autonomous_reply_intent_state,
  attempt_outcome platform.autonomous_reply_attempt_outcome,
  communication_message_id UUID,
  ack_name TEXT CHECK (
    ack_name IS NULL OR ack_name IN (
      'ERROR', 'PENDING', 'SERVER', 'DEVICE', 'READ', 'PLAYED'
    )
  ),
  decided_at TIMESTAMPTZ,
  attempted_at TIMESTAMPTZ,
  autonomous_authority BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (organization_id, conversation_id),
  CONSTRAINT conversation_autonomous_reply_state_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT conversation_autonomous_reply_state_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER conversation_autonomous_reply_state_realtime_invalidate
  AFTER INSERT OR UPDATE OR DELETE
  ON platform.conversation_autonomous_reply_state
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_platform_messaging_invalidation(
      'autonomous_reply'
    );

CREATE OR REPLACE FUNCTION
platform_private.require_private_autonomous_reply_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.message_identity_source = 'private_autonomous_reply_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.autonomous_reply_provider_bindings AS binding
      JOIN platform_private.autonomous_reply_intents AS intent
        ON intent.organization_id = binding.organization_id
       AND intent.id = binding.intent_id
      JOIN platform_private.autonomous_reply_attempt_results AS result
        ON result.organization_id = binding.organization_id
       AND result.attempt_id = binding.attempt_id
       AND result.intent_id = binding.intent_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.intent_id = NEW.autonomous_reply_intent_id
        AND binding.waha_session_name = 'evo-inbox'
        AND result.outcome = 'accepted'
        AND intent.conversation_id = NEW.conversation_id
        AND intent.reply_text = NEW.body_text
    )
  THEN
    RAISE EXCEPTION
      'An autonomous outbound message requires its exact private binding'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER communication_messages_private_autonomous_binding
  AFTER INSERT OR UPDATE
  ON platform.communication_messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.require_private_autonomous_reply_binding();

CREATE OR REPLACE FUNCTION
platform_private.project_autonomous_reply_ack_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.conversation_autonomous_reply_state AS state
  SET ack_name = NEW.waha_ack_name
  WHERE state.organization_id = NEW.organization_id
    AND state.communication_message_id = NEW.communication_message_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER waha_message_ack_current_autonomous_projection
  AFTER INSERT OR UPDATE OF waha_ack_name
  ON platform.waha_message_ack_current
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.project_autonomous_reply_ack_state();

CREATE OR REPLACE FUNCTION platform.project_claimed_waha_observation(
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
  work_attempt platform_private.durable_work_attempts%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_request platform_private.waha_event_projection_requests%ROWTYPE;
  prior_effect platform_private.waha_event_projection_effects%ROWTYPE;
  autonomous_binding
    platform_private.autonomous_reply_provider_bindings%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  payload JSONB;
  ack_raw_message_id TEXT;
  ack_code_text TEXT;
  ack_code INTEGER;
  ack_name TEXT;
  expected_ack_name TEXT;
  input_sha256 TEXT;
  evidence_ref TEXT;
  error_code TEXT;
  result JSONB;
  observation_id UUID;
  changed_rows INTEGER := 0;
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

  SELECT item.*
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id;

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = work_item.source_webhook_event_id;

  payload := source_event.raw_payload -> 'payload';
  ack_raw_message_id := NULLIF(pg_catalog.btrim(payload ->> 'id'), '');

  IF source_event.event_type IS DISTINCT FROM 'message.ack'
    OR ack_raw_message_id IS NULL
  THEN
    RETURN platform.project_claimed_waha_observation_p5e(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      p_intake_sales_membership_id,
      p_request_id
    );
  END IF;

  SELECT binding.*
  INTO autonomous_binding
  FROM platform_private.autonomous_reply_provider_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.waha_session_name = source_event.waha_session_name
    AND binding.raw_message_id = ack_raw_message_id;

  IF autonomous_binding.id IS NULL THEN
    -- A provider ACK may race the accepted-send transaction before its
    -- autonomous binding becomes visible. The P5E projector deliberately
    -- returns waha_ack_binding_pending as a retryable result with no persisted
    -- projection effect when neither binding exists, so the durable work is
    -- retried and this wrapper can resolve the autonomous binding after commit.
    RETURN platform.project_claimed_waha_observation_p5e(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      p_intake_sales_membership_id,
      p_request_id
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5e:projection-request:' || p_request_id::TEXT,
      0
    )
  );

  input_sha256 := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'organization_id', p_organization_id,
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'intake_sales_membership_id', p_intake_sales_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT request.*
  INTO prior_request
  FROM platform_private.waha_event_projection_requests AS request
  WHERE request.request_id = p_request_id;

  IF prior_request.request_id IS NOT NULL THEN
    IF prior_request.input_sha256 <> input_sha256 THEN
      RAISE EXCEPTION
        'request_id was already used for another WAHA event projection'
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
  ) OR EXISTS (
    SELECT 1
    FROM platform_private.waha_work_projection_requests AS request
    WHERE request.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'request_id was already used for another mutation'
      USING ERRCODE = '22023';
  END IF;

  SELECT item.*
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id
  FOR UPDATE;

  SELECT candidate.*
  INTO work_attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR work_attempt.id IS NULL
    OR work_item.kind <> 'provider_webhook_process'
    OR work_item.source_webhook_event_id IS NULL
  THEN
    RAISE EXCEPTION
      'The tenant work item and attempt do not identify WAHA webhook work'
      USING ERRCODE = '42501';
  END IF;

  IF work_item.state <> 'leased'
    OR work_attempt.finished_at IS NOT NULL
    OR work_attempt.attempt_number <> work_item.attempt_count
    OR work_attempt.lease_expires_at <= pg_catalog.clock_timestamp()
    OR work_item.leased_until <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'Only the current non-expired WAHA claim can be projected'
      USING ERRCODE = '55000';
  END IF;

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = work_item.source_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:evo-inbox'
    OR source_event.waha_session_name <> 'evo-inbox'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'message.ack'
  THEN
    RAISE EXCEPTION
      'Verified tenant-matched WAHA ACK evidence is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.require_waha_history_sales(
    p_organization_id,
    p_intake_sales_membership_id
  );

  SELECT effect.*
  INTO prior_effect
  FROM platform_private.waha_event_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.work_item_id = p_work_item_id;

  IF prior_effect.id IS NOT NULL THEN
    result := prior_effect.result || pg_catalog.jsonb_build_object(
      'attempt_id', p_attempt_id,
      'deduplicated', TRUE
    );
    RETURN platform_private.p5e_store_projection_result(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      source_event.id,
      source_event.event_type,
      prior_effect.communication_message_id,
      p_intake_sales_membership_id,
      p_request_id,
      input_sha256,
      result,
      FALSE
    );
  END IF;

  payload := source_event.raw_payload -> 'payload';

  <<project_autonomous_ack>>
  BEGIN
    IF pg_catalog.jsonb_typeof(source_event.raw_payload) <> 'object'
      OR pg_catalog.jsonb_typeof(payload) <> 'object'
      OR source_event.raw_payload ->> 'event' IS DISTINCT FROM 'message.ack'
      OR source_event.raw_payload ->> 'session' IS DISTINCT FROM 'evo-inbox'
    THEN
      error_code := 'waha_observation_envelope_invalid';
      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_autonomous_ack;
    END IF;

    ack_raw_message_id := NULLIF(pg_catalog.btrim(payload ->> 'id'), '');
    ack_code_text := payload ->> 'ack';
    ack_name := payload ->> 'ackName';

    IF pg_catalog.jsonb_typeof(payload -> 'id') IS DISTINCT FROM 'string'
      OR ack_raw_message_id IS NULL
      OR pg_catalog.jsonb_typeof(payload -> 'fromMe') IS DISTINCT FROM 'boolean'
      OR payload ->> 'fromMe' IS DISTINCT FROM 'true'
      OR pg_catalog.jsonb_typeof(payload -> 'ack') IS DISTINCT FROM 'number'
      OR ack_code_text NOT IN ('-1', '0', '1', '2', '3', '4')
      OR pg_catalog.jsonb_typeof(payload -> 'ackName') IS DISTINCT FROM 'string'
    THEN
      error_code := 'waha_ack_payload_invalid';
      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_autonomous_ack;
    END IF;

    IF source_event.payload_id IS DISTINCT FROM ack_raw_message_id
      AND NOT (
        source_event.payload_id ~
          '^local-message-ack-delivery:[0-9a-f]{64}:[0-9a-f]{64}$'
        AND pg_catalog.split_part(source_event.payload_id, ':', 2) =
          source_event.payload_sha256
      )
    THEN
      error_code := 'waha_ack_identity_invalid';
      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_autonomous_ack;
    END IF;

    ack_code := ack_code_text::INTEGER;
    expected_ack_name := CASE ack_code
      WHEN -1 THEN 'ERROR'
      WHEN 0 THEN 'PENDING'
      WHEN 1 THEN 'SERVER'
      WHEN 2 THEN 'DEVICE'
      WHEN 3 THEN 'READ'
      WHEN 4 THEN 'PLAYED'
    END;

    IF ack_name IS DISTINCT FROM expected_ack_name
      OR source_event.provider_event_variant_ref IS NULL
      OR pg_catalog.lower(pg_catalog.btrim(
        source_event.provider_event_variant_ref
      )) IS DISTINCT FROM pg_catalog.lower(expected_ack_name)
    THEN
      error_code := 'waha_ack_pair_mismatch';
      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_autonomous_ack;
    END IF;

    SELECT binding.*
    INTO autonomous_binding
    FROM platform_private.autonomous_reply_provider_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.waha_session_name = source_event.waha_session_name
      AND binding.raw_message_id = ack_raw_message_id;

    SELECT message.*
    INTO message_row
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.id = autonomous_binding.communication_message_id;

    IF autonomous_binding.id IS NULL
      OR message_row.id IS NULL
      OR message_row.direction <> 'outbound'
      OR message_row.message_identity_source <>
        'private_autonomous_reply_binding'
      OR message_row.autonomous_reply_intent_id <>
        autonomous_binding.intent_id
      OR message_row.waha_message_id IS NOT NULL
    THEN
      error_code := 'waha_ack_message_mismatch';
      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_autonomous_ack;
    END IF;

    INSERT INTO platform_private.waha_ack_observations (
      organization_id,
      source_webhook_event_id,
      communication_message_id,
      waha_session_name,
      raw_message_id,
      from_me,
      ack_code,
      ack_name,
      observed_at,
      request_id
    ) VALUES (
      p_organization_id,
      source_event.id,
      message_row.id,
      'evo-inbox',
      ack_raw_message_id,
      TRUE,
      ack_code,
      expected_ack_name,
      source_event.provider_occurred_at,
      p_request_id
    ) RETURNING id INTO observation_id;

    INSERT INTO platform.waha_message_ack_current AS ack_current (
      organization_id,
      communication_message_id,
      waha_ack_name,
      waha_ack_observed_at,
      source_observation_id
    ) VALUES (
      p_organization_id,
      message_row.id,
      expected_ack_name,
      source_event.provider_occurred_at,
      observation_id
    )
    ON CONFLICT (organization_id, communication_message_id) DO UPDATE
    SET waha_ack_name = EXCLUDED.waha_ack_name,
        waha_ack_observed_at = EXCLUDED.waha_ack_observed_at,
        source_observation_id = EXCLUDED.source_observation_id
    WHERE ack_current.waha_ack_name IS NULL
      OR (
        ack_current.waha_ack_name = EXCLUDED.waha_ack_name
        AND EXCLUDED.waha_ack_observed_at > ack_current.waha_ack_observed_at
      )
      OR (
        ack_current.waha_ack_name = 'PENDING'
        AND EXCLUDED.waha_ack_name <> 'PENDING'
      )
      OR (
        ack_current.waha_ack_name IN ('SERVER', 'DEVICE', 'READ', 'PLAYED')
        AND EXCLUDED.waha_ack_name IN ('SERVER', 'DEVICE', 'READ', 'PLAYED')
        AND ack_code > CASE ack_current.waha_ack_name
          WHEN 'SERVER' THEN 1
          WHEN 'DEVICE' THEN 2
          WHEN 'READ' THEN 3
          WHEN 'PLAYED' THEN 4
        END
      );
    GET DIAGNOSTICS changed_rows = ROW_COUNT;

    evidence_ref := 'waha-observation:' || source_event.id::TEXT
      || ':message-ack';
    result := platform_private.p5b_projection_result(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      'succeeded',
      evidence_ref,
      NULL
    ) || pg_catalog.jsonb_build_object(
      'communication_message_id', message_row.id,
      'waha_ack_name', expected_ack_name,
      'waha_ack_observed_at', source_event.provider_occurred_at,
      'current_state_updated', changed_rows = 1
    );
  END project_autonomous_ack;

  RETURN platform_private.p5e_store_projection_result(
    p_organization_id,
    p_work_item_id,
    p_attempt_id,
    source_event.id,
    source_event.event_type,
    message_row.id,
    p_intake_sales_membership_id,
    p_request_id,
    input_sha256,
    result,
    TRUE
  );
END
$$;

ALTER TABLE platform.communication_messages
  ADD COLUMN autonomous_reply_intent_id UUID;

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_autonomous_reply_intent_fkey
  FOREIGN KEY (organization_id, autonomous_reply_intent_id)
  REFERENCES platform_private.autonomous_reply_intents(organization_id, id)
  ON DELETE RESTRICT;

COMMENT ON COLUMN platform.communication_messages.autonomous_reply_intent_id IS
  'For private autonomous replies, identifies the durable send intent. source_webhook_event_id remains the exact verified inbound trigger; transport and ACK evidence remain in private attempt and provider-binding records.';

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_direction_shape_check;

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_direction_shape_check CHECK (
    (
      direction = 'inbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
      AND autonomous_reply_intent_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NULL
      AND message_identity_source = 'private_waha_history_binding'
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NOT NULL
      AND message_identity_source = 'private_autonomous_reply_binding'
    )
  );

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
  );

ALTER TABLE platform_private.conversation_autonomy_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.conversation_autonomy_control_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_gate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_gate_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_intent_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_intent_lifecycle FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_claim_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_claim_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_attempt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_attempt_results FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_provider_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.autonomous_reply_provider_bindings FORCE ROW LEVEL SECURITY;

ALTER TABLE platform.conversation_autonomous_reply_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.conversation_autonomous_reply_state FORCE ROW LEVEL SECURITY;

CREATE POLICY conversation_autonomous_reply_state_read
ON platform.conversation_autonomous_reply_state
FOR SELECT
TO authenticated
USING (
  COALESCE(
    private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ),
    FALSE
  )
);

CREATE TRIGGER conversation_autonomy_control_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.conversation_autonomy_control_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER conversation_autonomy_control_events_append_only_truncate
  BEFORE TRUNCATE ON platform_private.conversation_autonomy_control_events
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_gate_decisions_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_gate_decisions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_gate_decisions_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_gate_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_intents_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_intents
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_intents_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_intents
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_intent_lifecycle_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_intent_lifecycle
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_intent_lifecycle_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_intent_lifecycle
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_attempts_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_attempts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_attempts_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_claim_receipts_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_claim_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_claim_receipts_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_claim_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_attempt_results_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_attempt_results
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_attempt_results_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_attempt_results
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_provider_bindings_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.autonomous_reply_provider_bindings
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER autonomous_reply_provider_bindings_append_only_truncate
  BEFORE TRUNCATE ON platform_private.autonomous_reply_provider_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.set_conversation_autonomy_control(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_expected_version BIGINT,
  p_state TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_state platform.autonomy_control_state;
  fixed_reason TEXT := pg_catalog.btrim(p_reason);
  prior platform_private.conversation_autonomy_control_events%ROWTYPE;
  previous_state platform.autonomy_control_state := 'paused';
  current_version BIGINT := 0;
  next_version BIGINT;
  request_fingerprint TEXT;
  recorded_at TIMESTAMPTZ := pg_catalog.statement_timestamp();
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version < 0
    OR p_request_id IS NULL
    OR p_state IS NULL
    OR p_state <> pg_catalog.btrim(p_state)
    OR p_state NOT IN ('enabled', 'paused', 'staff_takeover')
    OR NOT platform_private.p5f3_reason_is_valid(fixed_reason)
  THEN
    RAISE EXCEPTION 'Conversation autonomy control input is invalid'
      USING ERRCODE = '22023';
  END IF;

  normalized_state := p_state::platform.autonomy_control_state;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'expected_version', p_expected_version,
      'state', normalized_state::TEXT,
      'reason', fixed_reason
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:control-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT control.*
  INTO prior
  FROM platform_private.conversation_autonomy_control_events AS control
  WHERE control.request_id = p_request_id;

  IF FOUND THEN
    IF prior.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION
        'request_id was already used for another autonomy control operation'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior.response;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:conversation:'
        || p_organization_id::TEXT || ':' || p_conversation_id::TEXT,
      0
    )
  );

  SELECT control.version, control.new_state
  INTO current_version, previous_state
  FROM platform_private.conversation_autonomy_control_events AS control
  WHERE control.organization_id = p_organization_id
    AND control.conversation_id = p_conversation_id
  ORDER BY control.version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    current_version := 0;
    previous_state := 'paused';
  END IF;

  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION
      'Conversation autonomy control version conflict: expected %, current %',
      p_expected_version,
      current_version
      USING ERRCODE = '40001';
  END IF;

  next_version := current_version + 1;
  result := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'control_version', next_version::TEXT,
    'control_state', normalized_state::TEXT,
    'control_reason', fixed_reason,
    'control_recorded_at', recorded_at,
    'autonomous_authority', normalized_state = 'enabled'
  );

  INSERT INTO platform_private.conversation_autonomy_control_events (
    organization_id,
    conversation_id,
    version,
    previous_state,
    new_state,
    recorded_by_membership_id,
    actor_kind,
    reason,
    request_id,
    request_fingerprint,
    response,
    created_at
  ) VALUES (
    p_organization_id,
    p_conversation_id,
    next_version,
    previous_state,
    normalized_state,
    actor.actor_membership_id,
    'user',
    fixed_reason,
    p_request_id,
    request_fingerprint,
    result,
    recorded_at
  );

  INSERT INTO platform.conversation_autonomous_reply_state (
    organization_id,
    conversation_id,
    control_state,
    control_version,
    control_reason,
    control_recorded_at,
    autonomous_authority
  ) VALUES (
    p_organization_id,
    p_conversation_id,
    normalized_state,
    next_version,
    fixed_reason,
    recorded_at,
    normalized_state = 'enabled'
  )
  ON CONFLICT (organization_id, conversation_id) DO UPDATE
  SET control_state = EXCLUDED.control_state,
      control_version = EXCLUDED.control_version,
      control_reason = EXCLUDED.control_reason,
      control_recorded_at = EXCLUDED.control_recorded_at,
      autonomous_authority = EXCLUDED.autonomous_authority;

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
  ) VALUES (
    p_organization_id,
    'user',
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'autonomous.reply.control.set',
    'communication_conversation',
    p_conversation_id,
    pg_catalog.jsonb_build_object(
      'control_version', current_version,
      'control_state', previous_state::TEXT
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.claim_autonomous_reply(
  p_organization_id UUID,
  p_worker_ref TEXT,
  p_visibility_timeout_seconds INTEGER,
  p_policy_version TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  fixed_worker_ref TEXT := pg_catalog.btrim(p_worker_ref);
  fixed_policy_version TEXT := pg_catalog.btrim(p_policy_version);
  request_fingerprint TEXT;
  prior_receipt platform_private.autonomous_reply_claim_receipts%ROWTYPE;
  proposal_request platform_private.gemini_proposal_requests%ROWTYPE;
  proposal_result platform_private.gemini_proposal_results%ROWTYPE;
  latest_control platform_private.conversation_autonomy_control_events%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  source_message platform.communication_messages%ROWTYPE;
  autonomy_control platform_private.conversation_autonomy_control_events%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  reply_to_binding platform_private.waha_message_bindings%ROWTYPE;
  decision_id UUID;
  created_intent_id UUID;
  created_attempt_id UUID;
  block_reason TEXT;
  proposal_language TEXT;
  proposal_intent TEXT;
  proposal_confidence INTEGER;
  proposal_risk TEXT;
  proposal_handoff BOOLEAN;
  proposal_reply_text TEXT;
  accepted_24h_count INTEGER := 0;
  consecutive_count INTEGER := 0;
  last_accepted_at TIMESTAMPTZ;
  control_version BIGINT := 0;
  control_state platform.autonomy_control_state := 'paused';
  control_reason TEXT := 'no_control_event';
  control_recorded_at TIMESTAMPTZ;
  session_status TEXT;
  now_at TIMESTAMPTZ := pg_catalog.statement_timestamp();
  policy_now TIMESTAMPTZ := platform_private.p5f3_policy_now();
  lease_until TIMESTAMPTZ;
  result JSONB;
  next_control_version BIGINT;
  pause_reason TEXT;
  gate_snapshot JSONB;
  expired RECORD;
  expired_request_id UUID;
  expired_response JSONB;
  expired_control platform_private.conversation_autonomy_control_events%ROWTYPE;
  expired_control_version BIGINT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_request_id IS NULL
    OR fixed_worker_ref IS NULL
    OR fixed_worker_ref !~ '^[A-Za-z0-9._:-]{1,128}$'
    OR p_visibility_timeout_seconds IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 30 AND 900
    OR fixed_policy_version IS DISTINCT FROM 'p5f3-v1'
  THEN
    RAISE EXCEPTION 'Autonomous reply claim input is invalid'
      USING ERRCODE = '22023';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'worker_ref', fixed_worker_ref,
      'visibility_timeout_seconds', p_visibility_timeout_seconds,
      'policy_version', fixed_policy_version
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:claim-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.autonomous_reply_claim_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION
        'request_id was already used for another autonomous reply claim'
        USING ERRCODE = '22023';
    END IF;
    IF prior_receipt.response ->> 'state' = 'claimed' THEN
      RAISE EXCEPTION
        'A claimed autonomous reply request cannot be replayed'
        USING ERRCODE = '42501';
    END IF;
    RETURN prior_receipt.response;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:organization:' || p_organization_id::TEXT,
      0
    )
  );

  -- A dispatch lease is a one-way send boundary. If it expires without a
  -- durable finish, retain unknown/manual-review evidence and never reclaim it.
  FOR expired IN
    SELECT
      attempt.id AS attempt_id,
      attempt.intent_id,
      intent.conversation_id,
      intent.source_message_id,
      intent.proposal_request_id
    FROM platform_private.autonomous_reply_attempts AS attempt
    JOIN platform_private.autonomous_reply_intents AS intent
      ON intent.organization_id = attempt.organization_id
     AND intent.id = attempt.intent_id
    WHERE attempt.organization_id = p_organization_id
      AND attempt.lease_expires_at <= now_at
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.autonomous_reply_attempt_results AS finished
        WHERE finished.organization_id = attempt.organization_id
          AND finished.attempt_id = attempt.id
      )
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'evo:p5f3:conversation:' || p_organization_id::TEXT
          || ':' || expired.conversation_id::TEXT,
        0
      )
    );

    -- Finish takes the same conversation lock. If it committed while this
    -- expired candidate waited, its terminal evidence wins and must never be
    -- overwritten by a synthetic unknown/manual-review transition.
    IF EXISTS (
      SELECT 1
      FROM platform_private.autonomous_reply_attempt_results AS finished
      WHERE finished.organization_id = p_organization_id
        AND finished.attempt_id = expired.attempt_id
    ) THEN
      CONTINUE;
    END IF;

    expired_request_id := gen_random_uuid();
    expired_response := pg_catalog.jsonb_build_object(
      'state', 'unknown',
      'intent_id', expired.intent_id,
      'attempt_id', expired.attempt_id,
      'conversation_id', expired.conversation_id,
      'source_message_id', expired.source_message_id,
      'communication_message_id', NULL,
      'ack_name', NULL
    );

    INSERT INTO platform_private.autonomous_reply_attempt_results (
      organization_id,
      intent_id,
      attempt_id,
      outcome,
      error_code,
      provider_observed_at,
      request_id,
      request_fingerprint,
      response,
      created_at
    ) VALUES (
      p_organization_id,
      expired.intent_id,
      expired.attempt_id,
      'unknown',
      'lease_expired',
      NULL,
      expired_request_id,
      platform_private.ai_memory_json_sha256(
        pg_catalog.jsonb_build_object(
          'attempt_id', expired.attempt_id,
          'outcome', 'unknown',
          'error_code', 'lease_expired'
        )
      ),
      expired_response,
      now_at
    ) ON CONFLICT (organization_id, attempt_id) DO NOTHING;

    INSERT INTO platform_private.autonomous_reply_intent_lifecycle (
      organization_id,
      intent_id,
      state,
      reason_code,
      created_at
    ) VALUES (
      p_organization_id,
      expired.intent_id,
      'unknown',
      'lease_expired',
      now_at
    ) ON CONFLICT (organization_id, intent_id, state) DO NOTHING;

    SELECT control.*
    INTO expired_control
    FROM platform_private.conversation_autonomy_control_events AS control
    WHERE control.organization_id = p_organization_id
      AND control.conversation_id = expired.conversation_id
    ORDER BY control.version DESC
    LIMIT 1;

    IF expired_control.new_state IS DISTINCT FROM 'paused'
      OR expired_control.reason IS DISTINCT FROM
        'autonomous reply claim lease expired'
    THEN
      expired_control_version := COALESCE(expired_control.version, 0) + 1;
      INSERT INTO platform_private.conversation_autonomy_control_events (
        organization_id,
        conversation_id,
        version,
        previous_state,
        new_state,
        recorded_by_membership_id,
        actor_kind,
        reason,
        request_id,
        request_fingerprint,
        response,
        created_at
      ) VALUES (
        p_organization_id,
        expired.conversation_id,
        expired_control_version,
        COALESCE(expired_control.new_state, 'paused'),
        'paused',
        NULL,
        'service',
        'autonomous reply claim lease expired',
        expired_request_id,
        platform_private.ai_memory_json_sha256(
          pg_catalog.jsonb_build_object(
            'conversation_id', expired.conversation_id,
            'attempt_id', expired.attempt_id,
            'state', 'paused'
          )
        ),
        pg_catalog.jsonb_build_object(
          'organization_id', p_organization_id,
          'conversation_id', expired.conversation_id,
          'control_version', expired_control_version::TEXT,
          'control_state', 'paused',
          'control_reason', 'autonomous reply claim lease expired',
          'control_recorded_at', now_at,
          'autonomous_authority', FALSE
        ),
        now_at
      );
    ELSE
      expired_control_version := expired_control.version;
    END IF;

    UPDATE platform.conversation_autonomous_reply_state AS state
    SET intent_state = 'unknown',
        attempt_outcome = 'unknown',
        control_state = 'paused',
        control_version = expired_control_version,
        control_reason = 'autonomous reply claim lease expired',
        control_recorded_at = now_at,
        autonomous_authority = FALSE
    WHERE state.organization_id = p_organization_id
      AND state.intent_id = expired.intent_id;
  END LOOP;

  SELECT request.*
  INTO proposal_request
  FROM platform_private.gemini_proposal_requests AS request
  JOIN platform_private.gemini_proposal_results AS proposal
    ON proposal.organization_id = request.organization_id
   AND proposal.proposal_request_id = request.id
  WHERE request.organization_id = p_organization_id
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.autonomous_reply_intents AS intent
      WHERE intent.organization_id = request.organization_id
        AND intent.proposal_request_id = request.id
        AND intent.source_message_id = request.source_message_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.gemini_proposal_requests AS later
      WHERE later.organization_id = request.organization_id
        AND later.conversation_id = request.conversation_id
        AND (later.created_at, later.id) > (request.created_at, request.id)
    )
  ORDER BY request.created_at, request.id
  LIMIT 1;

  IF proposal_request.id IS NULL THEN
    result := pg_catalog.jsonb_build_object(
      'state', 'empty',
      'policy_version', fixed_policy_version
    );
    INSERT INTO platform_private.autonomous_reply_claim_receipts (
      request_id,
      organization_id,
      request_fingerprint,
      response
    ) VALUES (
      p_request_id,
      p_organization_id,
      request_fingerprint,
      result
    );
    RETURN result;
  END IF;

  -- Every control reader/writer for a conversation shares this lock with the
  -- authenticated staff control RPC. It makes explicit resume/pause and the
  -- service-owned opt-out/mutable recheck one total order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:conversation:' || p_organization_id::TEXT
        || ':' || proposal_request.conversation_id::TEXT,
      0
    )
  );

  SELECT proposal.*
  INTO proposal_result
  FROM platform_private.gemini_proposal_results AS proposal
  WHERE proposal.organization_id = p_organization_id
    AND proposal.proposal_request_id = proposal_request.id;

  SELECT conversation_row.*
  INTO conversation
  FROM platform.communication_conversations AS conversation_row
  WHERE conversation_row.organization_id = p_organization_id
    AND conversation_row.id = proposal_request.conversation_id;

  SELECT message.*
  INTO source_message
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = proposal_request.source_message_id
    AND message.conversation_id = proposal_request.conversation_id;

  SELECT control.*
  INTO autonomy_control
  FROM platform_private.conversation_autonomy_control_events AS control
  WHERE control.organization_id = p_organization_id
    AND control.conversation_id = proposal_request.conversation_id
  ORDER BY control.version DESC
  LIMIT 1;

  IF autonomy_control.id IS NOT NULL THEN
    control_version := autonomy_control.version;
    control_state := autonomy_control.new_state;
    control_reason := autonomy_control.reason;
    control_recorded_at := autonomy_control.created_at;
  END IF;

  SELECT binding.*
  INTO direct_binding
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.conversation_id = proposal_request.conversation_id
    AND binding.waha_session_name = 'evo-inbox';

  SELECT binding.*
  INTO reply_to_binding
  FROM platform_private.waha_message_bindings AS binding
  JOIN platform_private.provider_webhook_events AS source_event
    ON source_event.organization_id = binding.organization_id
   AND source_event.id = binding.source_webhook_event_id
  WHERE binding.organization_id = p_organization_id
    AND binding.communication_message_id = proposal_request.source_message_id
    AND binding.source_webhook_event_id = source_message.source_webhook_event_id
    AND binding.waha_session_name = 'evo-inbox'
    AND source_event.provider = 'waha'
    AND source_event.provider_account_ref = 'waha:evo-inbox'
    AND source_event.waha_session_name = 'evo-inbox'
    AND source_event.verification_status = 'verified'
    AND source_event.event_type IN ('message', 'message.any')
    AND source_event.payload_id = binding.raw_message_id;

  SELECT health.status
  INTO session_status
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'evo-inbox';

  IF proposal_result.outcome = 'proposal_ready' THEN
    proposal_language := proposal_result.private_response_json ->> 'language';
    proposal_intent := proposal_result.private_response_json ->> 'intent';
    proposal_confidence :=
      (proposal_result.private_response_json ->> 'confidence')::INTEGER;
    proposal_risk := proposal_result.private_response_json ->> 'risk';
    proposal_handoff :=
      (proposal_result.private_response_json ->> 'handoff_required')::BOOLEAN;
    proposal_reply_text := proposal_result.private_response_json ->> 'reply_text';
  END IF;

  SELECT
    pg_catalog.count(*) FILTER (
      WHERE finished.created_at >= now_at - INTERVAL '24 hours'
    )::INTEGER,
    pg_catalog.max(finished.created_at),
    pg_catalog.count(*) FILTER (
      WHERE control_recorded_at IS NOT NULL
        AND finished.created_at > control_recorded_at
    )::INTEGER
  INTO accepted_24h_count, last_accepted_at, consecutive_count
  FROM platform_private.autonomous_reply_attempt_results AS finished
  JOIN platform_private.autonomous_reply_intents AS prior_intent
    ON prior_intent.organization_id = finished.organization_id
   AND prior_intent.id = finished.intent_id
  WHERE finished.organization_id = p_organization_id
    AND prior_intent.conversation_id = proposal_request.conversation_id
    AND finished.outcome = 'accepted';

  IF conversation.id IS NULL OR conversation.status <> 'open' THEN
    block_reason := 'conversation_closed';
  ELSIF source_message.id IS NULL OR source_message.direction <> 'inbound' THEN
    block_reason := 'source_not_inbound';
  ELSIF EXISTS (
    SELECT 1
    FROM platform.communication_messages AS later
    WHERE later.organization_id = p_organization_id
      AND later.conversation_id = proposal_request.conversation_id
      AND (later.created_at, later.id) >
        (source_message.created_at, source_message.id)
  ) THEN
    block_reason := 'source_not_latest';
  ELSIF source_message.body_text IS NULL
    OR pg_catalog.btrim(source_message.body_text) = ''
  THEN
    block_reason := 'source_unsupported';
  ELSIF source_message.created_at > policy_now
    OR source_message.created_at < policy_now - INTERVAL '24 hours'
  THEN
    block_reason := 'outside_reply_window';
  ELSIF (policy_now AT TIME ZONE 'Asia/Bishkek')::TIME < TIME '09:00'
    OR (policy_now AT TIME ZONE 'Asia/Bishkek')::TIME >= TIME '21:00'
  THEN
    block_reason := 'outside_business_hours';
  ELSIF proposal_result.id IS NULL THEN
    block_reason := 'proposal_unavailable';
  ELSIF proposal_result.outcome <> 'proposal_ready' THEN
    block_reason := 'proposal_not_ready';
  ELSIF proposal_intent = 'opt_out' THEN
    block_reason := 'opted_out';
  ELSIF control_state = 'opted_out' THEN
    block_reason := 'opted_out';
  ELSIF control_state = 'staff_takeover' THEN
    block_reason := 'staff_takeover';
  ELSIF control_state <> 'enabled' THEN
    block_reason := 'autonomy_paused';
  ELSIF EXISTS (
    SELECT 1
    FROM platform_private.conversation_ai_control_events AS p5f1_control
    WHERE p5f1_control.organization_id = p_organization_id
      AND p5f1_control.conversation_id = proposal_request.conversation_id
      AND p5f1_control.created_at > control_recorded_at
  ) THEN
    block_reason := 'staff_takeover';
  ELSIF EXISTS (
    SELECT 1
    FROM platform.communication_messages AS staff_message
    WHERE staff_message.organization_id = p_organization_id
      AND staff_message.conversation_id = proposal_request.conversation_id
      AND staff_message.direction = 'outbound'
      AND staff_message.manual_send_authorization_id IS NOT NULL
      AND staff_message.created_at > control_recorded_at
  ) THEN
    block_reason := 'staff_outbound_after_enable';
  ELSIF proposal_language NOT IN ('ru', 'en') THEN
    block_reason := 'unsupported_language';
  ELSIF proposal_intent NOT IN (
    'greeting',
    'admissions_discovery',
    'program_or_country',
    'documents',
    'deadline'
  ) THEN
    block_reason := 'unsupported_intent';
  ELSIF proposal_confidence < 85 THEN
    block_reason := 'low_confidence';
  ELSIF proposal_risk IS DISTINCT FROM 'low' THEN
    block_reason := 'risk_not_low';
  ELSIF proposal_handoff IS DISTINCT FROM FALSE THEN
    block_reason := 'handoff_required';
  ELSIF pg_catalog.jsonb_array_length(
    proposal_result.private_response_json -> 'handoff_reasons'
  ) <> 0 THEN
    block_reason := 'handoff_reason_present';
  ELSIF proposal_intent IN ('program_or_country', 'documents', 'deadline')
    AND (
      pg_catalog.jsonb_array_length(
        proposal_result.private_response_json -> 'citations'
      ) = 0
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(
          proposal_result.private_response_json -> 'citations'
        ) AS citation(value)
        WHERE NOT COALESCE(
          proposal_request.private_context #> '{retrieval,evidence}',
          '[]'::JSONB
        ) @> pg_catalog.jsonb_build_array(citation.value)
      )
    )
  THEN
    block_reason := 'approved_evidence_missing';
  ELSIF session_status IS DISTINCT FROM 'WORKING' THEN
    block_reason := 'session_unhealthy';
  ELSIF last_accepted_at IS NOT NULL
    AND last_accepted_at > now_at - INTERVAL '60 seconds'
  THEN
    block_reason := 'cooldown_active';
  ELSIF accepted_24h_count >= 6 THEN
    block_reason := 'rolling_rate_exhausted';
  ELSIF consecutive_count >= 3 THEN
    block_reason := 'consecutive_limit_reached';
  ELSIF direct_binding.id IS NULL OR reply_to_binding.id IS NULL THEN
    block_reason := 'binding_unavailable';
  END IF;

  -- Opt-out is a durable service-recorded control. Only a later explicit
  -- authenticated staff `enabled` event can supersede it.
  IF proposal_intent = 'opt_out' AND control_state <> 'opted_out' THEN
    control_version := control_version + 1;
    control_state := 'opted_out';
    control_reason := 'customer opt out proposal';
    control_recorded_at := now_at;
    INSERT INTO platform_private.conversation_autonomy_control_events (
      organization_id,
      conversation_id,
      version,
      previous_state,
      new_state,
      recorded_by_membership_id,
      actor_kind,
      reason,
      request_id,
      request_fingerprint,
      response,
      created_at
    ) VALUES (
      p_organization_id,
      proposal_request.conversation_id,
      control_version,
      COALESCE(autonomy_control.new_state, 'paused'),
      'opted_out',
      NULL,
      'service',
      control_reason,
      p_request_id,
      request_fingerprint,
      pg_catalog.jsonb_build_object(
        'organization_id', p_organization_id,
        'conversation_id', proposal_request.conversation_id,
        'control_version', control_version::TEXT,
        'control_state', 'opted_out',
        'control_reason', control_reason,
        'control_recorded_at', control_recorded_at,
        'autonomous_authority', FALSE
      ),
      now_at
    );
  END IF;

  gate_snapshot := pg_catalog.jsonb_build_object(
    'same_conversation', conversation.id IS NOT NULL,
    'source_latest', block_reason IS DISTINCT FROM 'source_not_latest',
    'source_inbound', source_message.direction = 'inbound',
    'inside_reply_window', source_message.created_at BETWEEN
      policy_now - INTERVAL '24 hours' AND policy_now,
    'business_hours',
      (policy_now AT TIME ZONE 'Asia/Bishkek')::TIME >= TIME '09:00'
      AND (policy_now AT TIME ZONE 'Asia/Bishkek')::TIME < TIME '21:00',
    'control_state', control_state::TEXT,
    'control_version', control_version,
    'session_status', session_status,
    'accepted_24h_count', accepted_24h_count,
    'consecutive_count', consecutive_count,
    'last_accepted_at', last_accepted_at,
    'proposal_outcome', proposal_result.outcome::TEXT,
    'proposal_language', proposal_language,
    'proposal_intent', proposal_intent,
    'proposal_confidence', proposal_confidence,
    'proposal_risk', proposal_risk,
    'proposal_handoff_required', proposal_handoff
  );

  INSERT INTO platform_private.autonomous_reply_gate_decisions (
    organization_id,
    conversation_id,
    source_message_id,
    proposal_request_id,
    decision_state,
    reason_code,
    policy_version,
    control_version,
    gate_snapshot,
    request_id,
    request_fingerprint,
    created_at
  ) VALUES (
    p_organization_id,
    proposal_request.conversation_id,
    proposal_request.source_message_id,
    proposal_request.id,
    (CASE WHEN block_reason IS NULL THEN 'queued' ELSE 'blocked' END)
      ::platform.autonomous_reply_decision_state,
    block_reason,
    fixed_policy_version,
    control_version,
    gate_snapshot,
    p_request_id,
    request_fingerprint,
    now_at
  ) RETURNING id INTO decision_id;

  IF block_reason IS NOT NULL THEN
    result := pg_catalog.jsonb_build_object(
      'state', 'blocked',
      'decision_id', decision_id,
      'conversation_id', proposal_request.conversation_id,
      'source_message_id', proposal_request.source_message_id,
      'proposal_request_id', proposal_request.id,
      'intent_id', NULL,
      'reason_code', block_reason,
      'policy_version', fixed_policy_version
    );
    INSERT INTO platform_private.autonomous_reply_claim_receipts (
      request_id,
      organization_id,
      request_fingerprint,
      response
    ) VALUES (p_request_id, p_organization_id, request_fingerprint, result);

    INSERT INTO platform.conversation_autonomous_reply_state (
      organization_id,
      conversation_id,
      control_state,
      control_version,
      control_reason,
      control_recorded_at,
      decision_state,
      decision_reason_code,
      policy_version,
      proposal_request_id,
      source_message_id,
      decided_at,
      autonomous_authority
    ) VALUES (
      p_organization_id,
      proposal_request.conversation_id,
      control_state,
      control_version,
      control_reason,
      control_recorded_at,
      'blocked',
      block_reason,
      fixed_policy_version,
      proposal_request.id,
      proposal_request.source_message_id,
      now_at,
      FALSE
    )
    ON CONFLICT (organization_id, conversation_id) DO UPDATE
    SET control_state = EXCLUDED.control_state,
        control_version = EXCLUDED.control_version,
        control_reason = EXCLUDED.control_reason,
        control_recorded_at = EXCLUDED.control_recorded_at,
        decision_state = EXCLUDED.decision_state,
        decision_reason_code = EXCLUDED.decision_reason_code,
        policy_version = EXCLUDED.policy_version,
        proposal_request_id = EXCLUDED.proposal_request_id,
        source_message_id = EXCLUDED.source_message_id,
        decided_at = EXCLUDED.decided_at,
        autonomous_authority = FALSE;
    RETURN result;
  END IF;

  created_intent_id := gen_random_uuid();
  INSERT INTO platform_private.autonomous_reply_intents (
    id,
    organization_id,
    conversation_id,
    source_message_id,
    proposal_request_id,
    gate_decision_id,
    direct_chat_binding_id,
    reply_to_message_binding_id,
    policy_version,
    idempotency_key,
    reply_text,
    reply_sha256,
    created_at
  ) VALUES (
    created_intent_id,
    p_organization_id,
    proposal_request.conversation_id,
    proposal_request.source_message_id,
    proposal_request.id,
    decision_id,
    direct_binding.id,
    reply_to_binding.id,
    fixed_policy_version,
    p_request_id,
    proposal_reply_text,
    platform_private.ai_memory_text_sha256(proposal_reply_text),
    now_at
  );

  INSERT INTO platform_private.autonomous_reply_intent_lifecycle (
    organization_id,
    intent_id,
    state,
    reason_code,
    created_at
  ) VALUES (
    p_organization_id,
    created_intent_id,
    'queued',
    NULL,
    now_at
  );

  -- Re-check every mutable SQL-owned gate after persistence and immediately
  -- before the dispatch attempt becomes transport-authoritative.
  policy_now := platform_private.p5f3_policy_now();

  IF NOT EXISTS (
      SELECT 1
      FROM platform.communication_conversations AS current_conversation
      WHERE current_conversation.organization_id = p_organization_id
        AND current_conversation.id = proposal_request.conversation_id
        AND current_conversation.status = 'open'
    )
    OR source_message.created_at > policy_now
    OR source_message.created_at <
      policy_now - INTERVAL '24 hours'
    OR (
      policy_now AT TIME ZONE 'Asia/Bishkek'
    )::TIME < TIME '09:00'
    OR (
      policy_now AT TIME ZONE 'Asia/Bishkek'
    )::TIME >= TIME '21:00'
    OR EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later
      WHERE later.organization_id = p_organization_id
        AND later.conversation_id = proposal_request.conversation_id
        AND (later.created_at, later.id) >
          (source_message.created_at, source_message.id)
    )
    OR NOT EXISTS (
      SELECT 1
      FROM platform_private.conversation_autonomy_control_events AS current_control
      WHERE current_control.organization_id = p_organization_id
        AND current_control.conversation_id = proposal_request.conversation_id
        AND current_control.version = control_version
        AND current_control.new_state = 'enabled'
    )
    OR EXISTS (
      SELECT 1
      FROM platform_private.conversation_ai_control_events AS p5f1_control
      WHERE p5f1_control.organization_id = p_organization_id
        AND p5f1_control.conversation_id = proposal_request.conversation_id
        AND p5f1_control.created_at > control_recorded_at
    )
    OR EXISTS (
      SELECT 1
      FROM platform.communication_messages AS staff_message
      WHERE staff_message.organization_id = p_organization_id
        AND staff_message.conversation_id = proposal_request.conversation_id
        AND staff_message.direction = 'outbound'
        AND staff_message.manual_send_authorization_id IS NOT NULL
        AND staff_message.created_at > control_recorded_at
    )
    OR NOT EXISTS (
      SELECT 1
      FROM platform.waha_session_health AS health
      WHERE health.organization_id = p_organization_id
        AND health.waha_session_name = 'evo-inbox'
        AND health.status = 'WORKING'
    )
    OR EXISTS (
      SELECT 1
      FROM platform_private.autonomous_reply_attempt_results AS finished
      JOIN platform_private.autonomous_reply_intents AS prior_intent
        ON prior_intent.organization_id = finished.organization_id
       AND prior_intent.id = finished.intent_id
      WHERE finished.organization_id = p_organization_id
        AND prior_intent.conversation_id = proposal_request.conversation_id
        AND finished.outcome = 'accepted'
        AND finished.created_at >
          pg_catalog.clock_timestamp() - INTERVAL '60 seconds'
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM platform_private.autonomous_reply_attempt_results AS finished
      JOIN platform_private.autonomous_reply_intents AS prior_intent
        ON prior_intent.organization_id = finished.organization_id
       AND prior_intent.id = finished.intent_id
      WHERE finished.organization_id = p_organization_id
        AND prior_intent.conversation_id = proposal_request.conversation_id
        AND finished.outcome = 'accepted'
        AND finished.created_at >=
          pg_catalog.clock_timestamp() - INTERVAL '24 hours'
    ) >= 6
    OR (
      SELECT pg_catalog.count(*)
      FROM platform_private.autonomous_reply_attempt_results AS finished
      JOIN platform_private.autonomous_reply_intents AS prior_intent
        ON prior_intent.organization_id = finished.organization_id
       AND prior_intent.id = finished.intent_id
      WHERE finished.organization_id = p_organization_id
        AND prior_intent.conversation_id = proposal_request.conversation_id
        AND finished.outcome = 'accepted'
        AND finished.created_at > control_recorded_at
    ) >= 3
  THEN
    INSERT INTO platform_private.autonomous_reply_intent_lifecycle (
      organization_id,
      intent_id,
      state,
      reason_code,
      created_at
    ) VALUES (
      p_organization_id,
      created_intent_id,
      'manual_review',
      'mutable_gate_blocked',
      now_at
    );
    result := pg_catalog.jsonb_build_object(
      'state', 'blocked',
      'decision_id', decision_id,
      'conversation_id', proposal_request.conversation_id,
      'source_message_id', proposal_request.source_message_id,
      'proposal_request_id', proposal_request.id,
      'intent_id', created_intent_id,
      'reason_code', 'mutable_gate_blocked',
      'policy_version', fixed_policy_version
    );
    INSERT INTO platform_private.autonomous_reply_claim_receipts (
      request_id,
      organization_id,
      request_fingerprint,
      response
    ) VALUES (p_request_id, p_organization_id, request_fingerprint, result);

    INSERT INTO platform.conversation_autonomous_reply_state (
      organization_id,
      conversation_id,
      control_state,
      control_version,
      control_reason,
      control_recorded_at,
      decision_state,
      decision_reason_code,
      policy_version,
      proposal_request_id,
      source_message_id,
      intent_id,
      intent_state,
      attempt_outcome,
      communication_message_id,
      ack_name,
      decided_at,
      attempted_at,
      autonomous_authority
    ) VALUES (
      p_organization_id,
      proposal_request.conversation_id,
      control_state,
      control_version,
      control_reason,
      control_recorded_at,
      'blocked',
      'mutable_gate_blocked',
      fixed_policy_version,
      proposal_request.id,
      proposal_request.source_message_id,
      created_intent_id,
      'manual_review',
      NULL,
      NULL,
      NULL,
      now_at,
      now_at,
      FALSE
    )
    ON CONFLICT (organization_id, conversation_id) DO UPDATE
    SET control_state = EXCLUDED.control_state,
        control_version = EXCLUDED.control_version,
        control_reason = EXCLUDED.control_reason,
        control_recorded_at = EXCLUDED.control_recorded_at,
        decision_state = EXCLUDED.decision_state,
        decision_reason_code = EXCLUDED.decision_reason_code,
        policy_version = EXCLUDED.policy_version,
        proposal_request_id = EXCLUDED.proposal_request_id,
        source_message_id = EXCLUDED.source_message_id,
        intent_id = EXCLUDED.intent_id,
        intent_state = EXCLUDED.intent_state,
        attempt_outcome = NULL,
        communication_message_id = NULL,
        ack_name = NULL,
        decided_at = EXCLUDED.decided_at,
        attempted_at = EXCLUDED.attempted_at,
        autonomous_authority = FALSE;
    RETURN result;
  END IF;

  created_attempt_id := gen_random_uuid();
  lease_until := now_at
    + pg_catalog.make_interval(secs => p_visibility_timeout_seconds);
  result := pg_catalog.jsonb_build_object(
    'state', 'claimed',
    'decision_id', decision_id,
    'intent_id', created_intent_id,
    'attempt_id', created_attempt_id,
    'conversation_id', proposal_request.conversation_id,
    'source_message_id', proposal_request.source_message_id,
    'proposal_request_id', proposal_request.id,
    'policy_version', fixed_policy_version,
    'lease_expires_at', lease_until,
    'waha_session_name', 'evo-inbox',
    'reply_text', proposal_reply_text,
    'raw_chat_id', direct_binding.normalized_chat_id,
    'raw_reply_to', reply_to_binding.raw_message_id
  );

  INSERT INTO platform_private.autonomous_reply_attempts (
    id,
    organization_id,
    intent_id,
    worker_ref,
    lease_expires_at,
    request_id,
    request_fingerprint,
    response,
    created_at
  ) VALUES (
    created_attempt_id,
    p_organization_id,
    created_intent_id,
    fixed_worker_ref,
    lease_until,
    p_request_id,
    request_fingerprint,
    result,
    now_at
  );

  INSERT INTO platform_private.autonomous_reply_intent_lifecycle (
    organization_id,
    intent_id,
    state,
    reason_code,
    created_at
  ) VALUES (
    p_organization_id,
    created_intent_id,
    'dispatching',
    NULL,
    now_at
  );

  INSERT INTO platform_private.autonomous_reply_claim_receipts (
    request_id,
    organization_id,
    request_fingerprint,
    response
  ) VALUES (p_request_id, p_organization_id, request_fingerprint, result);

  INSERT INTO platform.conversation_autonomous_reply_state (
    organization_id,
    conversation_id,
    control_state,
    control_version,
    control_reason,
    control_recorded_at,
    decision_state,
    decision_reason_code,
    policy_version,
    proposal_request_id,
    source_message_id,
    intent_id,
    intent_state,
    attempt_outcome,
    communication_message_id,
    ack_name,
    decided_at,
    attempted_at,
    autonomous_authority
  ) VALUES (
    p_organization_id,
    proposal_request.conversation_id,
    control_state,
    control_version,
    control_reason,
    control_recorded_at,
    'queued',
    NULL,
    fixed_policy_version,
    proposal_request.id,
    proposal_request.source_message_id,
    created_intent_id,
    'dispatching',
    NULL,
    NULL,
    NULL,
    now_at,
    now_at,
    TRUE
  )
  ON CONFLICT (organization_id, conversation_id) DO UPDATE
  SET control_state = EXCLUDED.control_state,
      control_version = EXCLUDED.control_version,
      control_reason = EXCLUDED.control_reason,
      control_recorded_at = EXCLUDED.control_recorded_at,
      decision_state = EXCLUDED.decision_state,
      decision_reason_code = NULL,
      policy_version = EXCLUDED.policy_version,
      proposal_request_id = EXCLUDED.proposal_request_id,
      source_message_id = EXCLUDED.source_message_id,
      intent_id = EXCLUDED.intent_id,
      intent_state = EXCLUDED.intent_state,
      attempt_outcome = NULL,
      communication_message_id = NULL,
      ack_name = NULL,
      decided_at = EXCLUDED.decided_at,
      attempted_at = EXCLUDED.attempted_at,
      autonomous_authority = TRUE;

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_autonomous_reply(
  p_organization_id UUID,
  p_intent_id UUID,
  p_attempt_id UUID,
  p_outcome TEXT,
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
  normalized_outcome platform.autonomous_reply_attempt_outcome;
  fixed_error_code TEXT := NULLIF(pg_catalog.btrim(p_error_code), '');
  intent platform_private.autonomous_reply_intents%ROWTYPE;
  attempt platform_private.autonomous_reply_attempts%ROWTYPE;
  prior_by_request platform_private.autonomous_reply_attempt_results%ROWTYPE;
  prior_by_attempt platform_private.autonomous_reply_attempt_results%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  source_message platform.communication_messages%ROWTYPE;
  sales_participant platform.conversation_participants%ROWTYPE;
  proposal_result platform_private.gemini_proposal_results%ROWTYPE;
  latest_control platform_private.conversation_autonomy_control_events%ROWTYPE;
  request_fingerprint TEXT;
  public_state TEXT;
  created_message_id UUID;
  result JSONB;
  finished_at TIMESTAMPTZ := pg_catalog.statement_timestamp();
  next_control_version BIGINT;
  pause_reason TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_intent_id IS NULL
    OR p_attempt_id IS NULL
    OR p_request_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome <> pg_catalog.btrim(p_outcome)
    OR p_outcome NOT IN ('accepted', 'rejected', 'unknown', 'blocked')
    OR (
      p_outcome = 'accepted'
      AND (
        fixed_error_code IS NOT NULL
        OR p_provider_message_id IS NULL
        OR pg_catalog.char_length(p_provider_message_id) NOT BETWEEN 1 AND 512
        OR p_provider_message_id !~ '^[ -~]+$'
        OR p_provider_observed_at IS NULL
      )
    )
    OR (
      p_outcome <> 'accepted'
      AND (
        p_provider_message_id IS NOT NULL
        OR NOT platform_private.p5f3_finish_error_code_is_valid(
          fixed_error_code
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Autonomous reply finish input is invalid'
      USING ERRCODE = '22023';
  END IF;

  normalized_outcome := p_outcome::platform.autonomous_reply_attempt_outcome;
  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'intent_id', p_intent_id,
      'attempt_id', p_attempt_id,
      'outcome', normalized_outcome::TEXT,
      'error_code', fixed_error_code,
      'provider_message_id', p_provider_message_id,
      'provider_observed_at', p_provider_observed_at
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:finish-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT finished.*
  INTO prior_by_request
  FROM platform_private.autonomous_reply_attempt_results AS finished
  WHERE finished.request_id = p_request_id;

  IF FOUND THEN
    IF prior_by_request.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION
        'request_id was already used for another autonomous reply finish'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior_by_request.response;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:intent:'
        || p_organization_id::TEXT || ':' || p_intent_id::TEXT,
      0
    )
  );

  SELECT intent_row.*
  INTO intent
  FROM platform_private.autonomous_reply_intents AS intent_row
  WHERE intent_row.organization_id = p_organization_id
    AND intent_row.id = p_intent_id;

  SELECT attempt_row.*
  INTO attempt
  FROM platform_private.autonomous_reply_attempts AS attempt_row
  WHERE attempt_row.organization_id = p_organization_id
    AND attempt_row.id = p_attempt_id
    AND attempt_row.intent_id = p_intent_id;

  IF intent.id IS NULL OR attempt.id IS NULL THEN
    RAISE EXCEPTION 'Autonomous reply attempt is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5f3:conversation:' || p_organization_id::TEXT
        || ':' || intent.conversation_id::TEXT,
      0
    )
  );

  SELECT finished.*
  INTO prior_by_attempt
  FROM platform_private.autonomous_reply_attempt_results AS finished
  WHERE finished.organization_id = p_organization_id
    AND finished.attempt_id = p_attempt_id;

  IF prior_by_attempt.id IS NOT NULL THEN
    RAISE EXCEPTION 'Autonomous reply attempt is already terminal'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_outcome = 'accepted'
    AND (
      p_provider_observed_at < attempt.created_at - INTERVAL '5 minutes'
      OR p_provider_observed_at > finished_at + INTERVAL '5 minutes'
      OR p_provider_observed_at > attempt.lease_expires_at
    )
  THEN
    RAISE EXCEPTION 'Accepted provider evidence is outside the claim lease'
      USING ERRCODE = '22023';
  END IF;

  SELECT conversation_row.*
  INTO conversation
  FROM platform.communication_conversations AS conversation_row
  WHERE conversation_row.organization_id = p_organization_id
    AND conversation_row.id = intent.conversation_id;

  SELECT message.*
  INTO source_message
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = intent.source_message_id
    AND message.conversation_id = intent.conversation_id;

  IF conversation.id IS NULL
    OR source_message.id IS NULL
    OR source_message.direction <> 'inbound'
  THEN
    RAISE EXCEPTION 'Autonomous reply provenance is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF normalized_outcome = 'accepted'
    AND p_provider_observed_at < source_message.created_at
  THEN
    RAISE EXCEPTION
      'Accepted provider evidence predates the exact source inbound'
      USING ERRCODE = '22023';
  END IF;

  public_state := CASE normalized_outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'unknown' THEN 'unknown'
    WHEN 'blocked' THEN 'manual_review'
  END;

  IF normalized_outcome = 'accepted' THEN
    IF EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.waha_session_name = 'evo-inbox'
        AND binding.raw_message_id = p_provider_message_id
    ) OR EXISTS (
      SELECT 1
      FROM platform_private.autonomous_reply_provider_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.waha_session_name = 'evo-inbox'
        AND binding.raw_message_id = p_provider_message_id
    ) THEN
      RAISE EXCEPTION 'Provider message identity is already bound'
        USING ERRCODE = '23505';
    END IF;

    SELECT participant.*
    INTO sales_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = intent.conversation_id
      AND participant.participant_kind = 'sales'
      AND participant.membership_id =
        conversation.responsible_sales_membership_id
    ORDER BY participant.created_at, participant.id
    LIMIT 1;

    IF sales_participant.id IS NULL THEN
      RAISE EXCEPTION 'Bound Sales intake participant is unavailable'
        USING ERRCODE = '55000';
    END IF;

    SELECT proposal.*
    INTO proposal_result
    FROM platform_private.gemini_proposal_results AS proposal
    WHERE proposal.organization_id = p_organization_id
      AND proposal.proposal_request_id = intent.proposal_request_id
      AND proposal.outcome = 'proposal_ready';

    IF proposal_result.id IS NULL THEN
      RAISE EXCEPTION 'Autonomous proposal provenance is unavailable'
        USING ERRCODE = '55000';
    END IF;

    created_message_id := gen_random_uuid();
  END IF;

  result := pg_catalog.jsonb_build_object(
    'state', public_state,
    'intent_id', p_intent_id,
    'attempt_id', p_attempt_id,
    'conversation_id', intent.conversation_id,
    'source_message_id', intent.source_message_id,
    'communication_message_id', created_message_id,
    'ack_name', NULL
  );

  IF normalized_outcome = 'accepted' THEN
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
      intent.conversation_id,
      conversation.student_case_id,
      sales_participant.id,
      'outbound',
      intent.reply_text,
      (proposal_result.private_response_json ->> 'language')
        ::platform.communication_message_language,
      TRUE,
      'private_autonomous_reply_binding',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      source_message.source_webhook_event_id,
      NULL,
      p_intent_id,
      p_provider_observed_at
    );
  END IF;

  INSERT INTO platform_private.autonomous_reply_attempt_results (
    organization_id,
    intent_id,
    attempt_id,
    outcome,
    error_code,
    provider_observed_at,
    request_id,
    request_fingerprint,
    response,
    created_at
  ) VALUES (
    p_organization_id,
    p_intent_id,
    p_attempt_id,
    normalized_outcome,
    fixed_error_code,
    p_provider_observed_at,
    p_request_id,
    request_fingerprint,
    result,
    finished_at
  );

  IF normalized_outcome = 'accepted' THEN
    INSERT INTO platform_private.autonomous_reply_provider_bindings (
      organization_id,
      intent_id,
      attempt_id,
      communication_message_id,
      waha_session_name,
      raw_message_id,
      provider_observed_at,
      created_at
    ) VALUES (
      p_organization_id,
      p_intent_id,
      p_attempt_id,
      created_message_id,
      'evo-inbox',
      p_provider_message_id,
      p_provider_observed_at,
      finished_at
    );
  END IF;

  INSERT INTO platform_private.autonomous_reply_intent_lifecycle (
    organization_id,
    intent_id,
    state,
    reason_code,
    created_at
  ) VALUES (
    p_organization_id,
    p_intent_id,
    public_state::platform.autonomous_reply_intent_state,
    CASE WHEN normalized_outcome = 'accepted' THEN NULL ELSE fixed_error_code END,
    finished_at
  );

  IF normalized_outcome <> 'accepted' THEN
    SELECT control.*
    INTO latest_control
    FROM platform_private.conversation_autonomy_control_events AS control
    WHERE control.organization_id = p_organization_id
      AND control.conversation_id = intent.conversation_id
    ORDER BY control.version DESC
    LIMIT 1;

    next_control_version := COALESCE(latest_control.version, 0) + 1;
    pause_reason := CASE normalized_outcome
      WHEN 'rejected' THEN 'autonomous reply provider rejected'
      WHEN 'unknown' THEN 'autonomous reply provider outcome unknown'
      WHEN 'blocked' THEN 'autonomous reply blocked before transport'
    END;

    INSERT INTO platform_private.conversation_autonomy_control_events (
      organization_id,
      conversation_id,
      version,
      previous_state,
      new_state,
      recorded_by_membership_id,
      actor_kind,
      reason,
      request_id,
      request_fingerprint,
      response,
      created_at
    ) VALUES (
      p_organization_id,
      intent.conversation_id,
      next_control_version,
      COALESCE(latest_control.new_state, 'paused'),
      'paused',
      NULL,
      'service',
      pause_reason,
      p_request_id,
      request_fingerprint,
      pg_catalog.jsonb_build_object(
        'organization_id', p_organization_id,
        'conversation_id', intent.conversation_id,
        'control_version', next_control_version::TEXT,
        'control_state', 'paused',
        'control_reason', pause_reason,
        'control_recorded_at', finished_at,
        'autonomous_authority', FALSE
      ),
      finished_at
    );
  END IF;

  UPDATE platform.conversation_autonomous_reply_state AS state
  SET intent_state = public_state::platform.autonomous_reply_intent_state,
      attempt_outcome = normalized_outcome,
      communication_message_id = created_message_id,
      ack_name = NULL,
      attempted_at = finished_at,
      control_state = CASE
        WHEN normalized_outcome = 'accepted' THEN state.control_state
        ELSE 'paused'::platform.autonomy_control_state
      END,
      control_version = CASE
        WHEN normalized_outcome = 'accepted' THEN state.control_version
        ELSE next_control_version
      END,
      control_reason = CASE
        WHEN normalized_outcome = 'accepted' THEN state.control_reason
        ELSE pause_reason
      END,
      control_recorded_at = CASE
        WHEN normalized_outcome = 'accepted' THEN state.control_recorded_at
        ELSE finished_at
      END,
      autonomous_authority = CASE
        WHEN normalized_outcome = 'accepted' THEN state.autonomous_authority
        ELSE FALSE
      END
  WHERE state.organization_id = p_organization_id
    AND state.conversation_id = intent.conversation_id
    AND state.intent_id = p_intent_id;

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_conversation_autonomous_reply_state(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  control_state TEXT,
  control_version BIGINT,
  control_reason TEXT,
  control_recorded_at TIMESTAMPTZ,
  decision_state TEXT,
  decision_reason_code TEXT,
  policy_version TEXT,
  proposal_request_id UUID,
  source_message_id UUID,
  intent_id UUID,
  intent_state TEXT,
  attempt_outcome TEXT,
  communication_message_id UUID,
  ack_name TEXT,
  decided_at TIMESTAMPTZ,
  attempted_at TIMESTAMPTZ,
  autonomous_authority BOOLEAN
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
    'ai.draft.review'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(state.control_state, 'paused')::TEXT,
    COALESCE(state.control_version, 0::BIGINT),
    COALESCE(state.control_reason, 'no_control_event'),
    state.control_recorded_at,
    state.decision_state::TEXT,
    state.decision_reason_code,
    state.policy_version,
    state.proposal_request_id,
    state.source_message_id,
    state.intent_id,
    state.intent_state::TEXT,
    state.attempt_outcome::TEXT,
    state.communication_message_id,
    COALESCE(ack.waha_ack_name, state.ack_name),
    state.decided_at,
    state.attempted_at,
    COALESCE(state.autonomous_authority, FALSE)
      AND COALESCE(state.control_state = 'enabled', FALSE)
      AND NOT EXISTS (
        SELECT 1
        FROM platform.communication_messages AS staff_message
        WHERE staff_message.organization_id = p_organization_id
          AND staff_message.conversation_id = p_conversation_id
          AND staff_message.direction = 'outbound'
          AND staff_message.manual_send_authorization_id IS NOT NULL
          AND staff_message.created_at > state.control_recorded_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.conversation_ai_control_events AS p5f1_control
        WHERE p5f1_control.organization_id = p_organization_id
          AND p5f1_control.conversation_id = p_conversation_id
          AND p5f1_control.created_at > state.control_recorded_at
      )
  FROM platform.communication_conversations AS conversation
  LEFT JOIN platform.conversation_autonomous_reply_state AS state
    ON state.organization_id = conversation.organization_id
   AND state.conversation_id = conversation.id
  LEFT JOIN platform.waha_message_ack_current AS ack
    ON ack.organization_id = state.organization_id
   AND ack.communication_message_id = state.communication_message_id
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;
END
$$;

REVOKE ALL ON TABLE
  platform_private.conversation_autonomy_control_events,
  platform_private.autonomous_reply_gate_decisions,
  platform_private.autonomous_reply_intents,
  platform_private.autonomous_reply_intent_lifecycle,
  platform_private.autonomous_reply_attempts,
  platform_private.autonomous_reply_claim_receipts,
  platform_private.autonomous_reply_attempt_results,
  platform_private.autonomous_reply_provider_bindings
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TYPE
  platform.autonomy_control_state,
  platform.autonomous_reply_decision_state,
  platform.autonomous_reply_intent_state,
  platform.autonomous_reply_attempt_outcome
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TABLE platform.conversation_autonomous_reply_state
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE platform.conversation_autonomous_reply_state
TO authenticated;

REVOKE ALL ON FUNCTION
  platform_private.p5f3_policy_now()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.p5f3_reason_is_valid(TEXT),
  platform_private.p5f3_block_reason_is_valid(TEXT),
  platform_private.p5f3_finish_error_code_is_valid(TEXT),
  platform_private.require_private_autonomous_reply_binding(),
  platform_private.project_autonomous_reply_ack_state(),
  platform.project_claimed_waha_observation_p5e(UUID, UUID, UUID, UUID, UUID),
  platform.project_claimed_waha_observation(UUID, UUID, UUID, UUID, UUID),
  platform.set_conversation_autonomy_control(UUID, UUID, BIGINT, TEXT, TEXT, UUID),
  platform.claim_autonomous_reply(UUID, TEXT, INTEGER, TEXT, UUID),
  platform.finish_autonomous_reply(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID),
  platform.staff_conversation_autonomous_reply_state(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.set_conversation_autonomy_control(UUID, UUID, BIGINT, TEXT, TEXT, UUID),
  platform.staff_conversation_autonomous_reply_state(UUID, UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  platform.project_claimed_waha_observation(UUID, UUID, UUID, UUID, UUID),
  platform.claim_autonomous_reply(UUID, TEXT, INTEGER, TEXT, UUID),
  platform.finish_autonomous_reply(UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID)
TO service_role;

COMMIT;
