-- ============================================================
-- 063_platform_waha_ack_session_realtime.sql
--
-- P5E: extend the verified WAHA projection lane to delivery ACK and session
-- observations, then emit private organization-scoped Realtime invalidations.
-- Raw provider identifiers and payloads remain in platform_private.
-- ============================================================

BEGIN;

ALTER TABLE platform.communication_messages
  ADD COLUMN waha_ack_name TEXT,
  ADD COLUMN waha_ack_observed_at TIMESTAMPTZ,
  ADD CONSTRAINT communication_messages_waha_ack_shape_check CHECK (
    (
      waha_ack_name IS NULL
      AND waha_ack_observed_at IS NULL
    )
    OR (
      direction = 'outbound'
      AND waha_ack_name IN (
        'ERROR',
        'PENDING',
        'SERVER',
        'DEVICE',
        'READ',
        'PLAYED'
      )
      AND waha_ack_observed_at IS NOT NULL
    )
  );

-- This exposed-schema table contains only the bounded current health tuple.
-- Provider payload data, passkeys, account identity and source-event IDs are
-- intentionally absent and are available only through private evidence.
CREATE TABLE platform.waha_session_health (
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  waha_session_name TEXT NOT NULL DEFAULT 'evo-inbox' CHECK (
    waha_session_name = 'evo-inbox'
  ),
  status TEXT NOT NULL CHECK (
    char_length(status) BETWEEN 1 AND 64
    AND status ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, waha_session_name)
);

CREATE TABLE platform_private.waha_ack_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_webhook_event_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (
    waha_session_name = 'evo-inbox'
  ),
  raw_message_id TEXT NOT NULL CHECK (btrim(raw_message_id) <> ''),
  from_me BOOLEAN NOT NULL CHECK (from_me),
  ack_code INTEGER NOT NULL CHECK (ack_code BETWEEN -1 AND 4),
  ack_name TEXT NOT NULL CHECK (
    (ack_code = -1 AND ack_name = 'ERROR')
    OR (ack_code = 0 AND ack_name = 'PENDING')
    OR (ack_code = 1 AND ack_name = 'SERVER')
    OR (ack_code = 2 AND ack_name = 'DEVICE')
    OR (ack_code = 3 AND ack_name = 'READ')
    OR (ack_code = 4 AND ack_name = 'PLAYED')
  ),
  observed_at TIMESTAMPTZ NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_ack_observations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_ack_observations_source_key
    UNIQUE (organization_id, source_webhook_event_id),
  CONSTRAINT waha_ack_observations_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_ack_observations_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_ack_observations_message_idx
  ON platform_private.waha_ack_observations (
    organization_id,
    communication_message_id,
    observed_at DESC
  );

CREATE TABLE platform_private.waha_session_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_webhook_event_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (
    waha_session_name = 'evo-inbox'
  ),
  status TEXT NOT NULL CHECK (
    char_length(status) BETWEEN 1 AND 64
    AND status ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  observed_at TIMESTAMPTZ NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_session_observations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_session_observations_source_key
    UNIQUE (organization_id, source_webhook_event_id),
  CONSTRAINT waha_session_observations_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_session_observations_latest_idx
  ON platform_private.waha_session_observations (
    organization_id,
    waha_session_name,
    observed_at DESC
  );

-- Retryable outcomes are retained in the request ledger but never become a
-- terminal effect. A fresh attempt/request can therefore succeed after a
-- late outbound binding appears.
CREATE TABLE platform_private.waha_event_projection_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  source_webhook_event_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('message.ack', 'session.status')
  ),
  communication_message_id UUID,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('succeeded', 'terminal_error')
  ),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  request_id UUID NOT NULL UNIQUE,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_event_projection_effects_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_event_projection_effects_work_key
    UNIQUE (organization_id, work_item_id),
  CONSTRAINT waha_event_projection_effects_work_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_event_projection_effects_source_fkey
    FOREIGN KEY (organization_id, source_webhook_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_event_projection_effects_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_event_projection_effects_shape_check CHECK (
    (
      event_type = 'message.ack'
      AND disposition = 'succeeded'
      AND communication_message_id IS NOT NULL
    )
    OR (
      event_type = 'message.ack'
      AND disposition = 'terminal_error'
    )
    OR (
      event_type = 'session.status'
      AND communication_message_id IS NULL
    )
  )
);

CREATE TABLE platform_private.waha_event_projection_requests (
  request_id UUID PRIMARY KEY,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  organization_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  intake_sales_membership_id UUID NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_event_projection_requests_work_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_event_projection_requests_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_event_projection_requests_sales_fkey
    FOREIGN KEY (organization_id, intake_sales_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_event_projection_requests_attempt_idx
  ON platform_private.waha_event_projection_requests (
    organization_id,
    work_item_id,
    attempt_id
  );

ALTER TABLE platform.waha_session_health
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.waha_session_health
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_ack_observations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_ack_observations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_session_observations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_session_observations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_event_projection_effects
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_event_projection_effects
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_event_projection_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_event_projection_requests
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER waha_ack_observations_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_ack_observations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_ack_observations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_ack_observations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_session_observations_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_session_observations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_session_observations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_session_observations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_event_projection_effects_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_event_projection_effects
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_event_projection_effects_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_event_projection_effects
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_event_projection_requests_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_event_projection_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_event_projection_requests_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_event_projection_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.p5e_store_projection_result(
  p_organization_id UUID,
  p_work_item_id UUID,
  p_attempt_id UUID,
  p_source_webhook_event_id UUID,
  p_event_type TEXT,
  p_communication_message_id UUID,
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
  IF p_event_type NOT IN ('message.ack', 'session.status')
    OR disposition NOT IN (
      'succeeded',
      'retryable_error',
      'terminal_error'
    )
    OR evidence_ref IS NULL
    OR btrim(evidence_ref) = ''
    OR (p_result ->> 'organization_id') IS DISTINCT FROM
      p_organization_id::TEXT
    OR (p_result ->> 'work_item_id') IS DISTINCT FROM
      p_work_item_id::TEXT
    OR (p_result ->> 'attempt_id') IS DISTINCT FROM p_attempt_id::TEXT
  THEN
    RAISE EXCEPTION
      'P5E projection result violates the bounded response contract'
      USING ERRCODE = '22023';
  END IF;

  IF p_persist_effect THEN
    IF disposition = 'retryable_error' THEN
      RAISE EXCEPTION
        'Retryable P5E results cannot become terminal effects'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO platform_private.waha_event_projection_effects (
      organization_id,
      work_item_id,
      source_webhook_event_id,
      event_type,
      communication_message_id,
      disposition,
      evidence_ref,
      result,
      request_id
    )
    VALUES (
      p_organization_id,
      p_work_item_id,
      p_source_webhook_event_id,
      p_event_type,
      p_communication_message_id,
      disposition,
      evidence_ref,
      p_result,
      p_request_id
    );
  END IF;

  INSERT INTO platform_private.waha_event_projection_requests (
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
    'service:platform-waha-event-projector',
    CASE
      WHEN disposition = 'retryable_error' THEN
        'communication.waha.project.retry'
      ELSE 'communication.waha.project'
    END,
    'durable_work_item',
    p_work_item_id,
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'event_type', p_event_type
    ),
    p_result,
    'Project verified WAHA ACK/session work without provider calls',
    p_request_id
  );

  RETURN p_result;
END
$$;

-- Preserve the P5B claim envelope and PGMQ lease semantics while widening
-- only the verified exact-session event filter.
CREATE OR REPLACE FUNCTION platform.claim_waha_event_projection(
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
      AND source_event.event_type IN (
        'message',
        'message.any',
        'message.ack',
        'session.status'
      )
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
      'service:platform-waha-event-projector',
      'work.dead.letter',
      'durable_work_item',
      work_item.id,
      jsonb_build_object(
        'state', work_item.state,
        'attempt_count', work_item.attempt_count
      ),
      result,
      'WAHA event projection retry budget exhausted',
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
    'service:platform-waha-event-projector',
    'work.claim',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count
    ),
    result,
    'Tenant-specific WAHA event claim with PGMQ visibility timeout',
    p_request_id
  );

  RETURN result;
END
$$;

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
  attempt platform_private.durable_work_attempts%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_request platform_private.waha_event_projection_requests%ROWTYPE;
  prior_effect platform_private.waha_event_projection_effects%ROWTYPE;
  message_binding platform_private.waha_message_bindings%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  payload JSONB;
  source_event_type TEXT;
  input_sha256 TEXT;
  result JSONB;
  evidence_ref TEXT;
  error_code TEXT;
  persist_effect BOOLEAN := TRUE;
  ack_raw_message_id TEXT;
  ack_code_text TEXT;
  ack_code INTEGER;
  ack_name TEXT;
  expected_ack_name TEXT;
  session_status TEXT;
  current_session_health platform.waha_session_health%ROWTYPE;
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

  -- P5B remains the single implementation of message/message.any projection.
  -- This wrapper only dispatches after resolving the exact tenant work source.
  SELECT event.event_type
  INTO source_event_type
  FROM platform_private.durable_work_items AS item
  JOIN platform_private.provider_webhook_events AS event
    ON event.organization_id = item.organization_id
   AND event.id = item.source_webhook_event_id
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id;

  IF source_event_type IN ('message', 'message.any') THEN
    RETURN platform.project_claimed_waha_event(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      p_intake_sales_membership_id,
      p_request_id
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5e:projection-request:' || p_request_id::TEXT, 0)
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
    OR source_event.event_type NOT IN ('message.ack', 'session.status')
  THEN
    RAISE EXCEPTION
      'Verified tenant-matched WAHA ACK/session evidence is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.require_waha_history_sales(
    p_organization_id,
    p_intake_sales_membership_id
  );

  SELECT *
  INTO prior_effect
  FROM platform_private.waha_event_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.work_item_id = p_work_item_id;

  IF prior_effect.id IS NOT NULL THEN
    result := prior_effect.result || jsonb_build_object(
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

  <<project_observation>>
  BEGIN
    IF jsonb_typeof(source_event.raw_payload) <> 'object'
      OR jsonb_typeof(payload) <> 'object'
      OR source_event.raw_payload ->> 'event' IS DISTINCT FROM
        source_event.event_type
      OR source_event.raw_payload ->> 'session' IS DISTINCT FROM
        source_event.waha_session_name
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
      EXIT project_observation;
    END IF;

    IF source_event.event_type = 'message.ack' THEN
      ack_raw_message_id := NULLIF(btrim(payload ->> 'id'), '');
      ack_code_text := payload ->> 'ack';
      ack_name := payload ->> 'ackName';

      IF jsonb_typeof(payload -> 'id') IS DISTINCT FROM 'string'
        OR ack_raw_message_id IS NULL
        OR jsonb_typeof(payload -> 'fromMe') IS DISTINCT FROM 'boolean'
        OR payload ->> 'fromMe' IS DISTINCT FROM 'true'
        OR jsonb_typeof(payload -> 'ack') IS DISTINCT FROM 'number'
        OR ack_code_text NOT IN ('-1', '0', '1', '2', '3', '4')
        OR jsonb_typeof(payload -> 'ackName') IS DISTINCT FROM 'string'
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
        EXIT project_observation;
      END IF;

      -- Timestamp-less message.ack deliveries deliberately use a local,
      -- body-bound delivery id so HTTP retries can persist as distinct source
      -- deliveries while sharing one durable processing identity. The raw WAHA
      -- message id remains payload.id and is the only value used for binding.
      IF source_event.payload_id IS DISTINCT FROM ack_raw_message_id
        AND NOT (
          source_event.payload_id ~
            '^local-message-ack-delivery:[0-9a-f]{64}:[0-9a-f]{64}$'
          AND split_part(source_event.payload_id, ':', 2) =
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
        EXIT project_observation;
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
        OR lower(btrim(source_event.provider_event_variant_ref))
          IS DISTINCT FROM lower(expected_ack_name)
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
        EXIT project_observation;
      END IF;

      SELECT binding.*
      INTO message_binding
      FROM platform_private.waha_message_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.waha_session_name = source_event.waha_session_name
        AND binding.raw_message_id = ack_raw_message_id;

      IF message_binding.id IS NULL THEN
        error_code := 'waha_ack_binding_pending';
        evidence_ref := 'waha-observation:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id,
          p_work_item_id,
          p_attempt_id,
          'retryable_error',
          evidence_ref,
          error_code
        );
        persist_effect := FALSE;
        EXIT project_observation;
      END IF;

      SELECT message.*
      INTO message_row
      FROM platform.communication_messages AS message
      WHERE message.organization_id = p_organization_id
        AND message.id = message_binding.communication_message_id;

      IF message_row.id IS NULL
        OR message_row.direction <> 'outbound'
        OR message_row.message_identity_source NOT IN (
          'private_waha_binding',
          'private_waha_history_binding'
        )
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
        EXIT project_observation;
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
      )
      VALUES (
        p_organization_id,
        source_event.id,
        message_row.id,
        source_event.waha_session_name,
        ack_raw_message_id,
        TRUE,
        ack_code,
        expected_ack_name,
        source_event.provider_occurred_at,
        p_request_id
      );

      UPDATE platform.communication_messages AS message
      SET
        waha_ack_name = expected_ack_name,
        waha_ack_observed_at = source_event.provider_occurred_at
      WHERE message.organization_id = p_organization_id
        AND message.id = message_row.id
        AND (
          message.waha_ack_name IS NULL
          OR (
            message.waha_ack_name = expected_ack_name
            AND source_event.provider_occurred_at >
              message.waha_ack_observed_at
          )
          OR (
            message.waha_ack_name = 'PENDING'
            AND expected_ack_name <> 'PENDING'
          )
          OR (
            message.waha_ack_name IN ('SERVER', 'DEVICE', 'READ', 'PLAYED')
            AND expected_ack_name IN ('SERVER', 'DEVICE', 'READ', 'PLAYED')
            AND ack_code > CASE message.waha_ack_name
              WHEN 'SERVER' THEN 1
              WHEN 'DEVICE' THEN 2
              WHEN 'READ' THEN 3
              WHEN 'PLAYED' THEN 4
            END
          )
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
      ) || jsonb_build_object(
        'communication_message_id', message_row.id,
        'waha_ack_name', expected_ack_name,
        'waha_ack_observed_at', source_event.provider_occurred_at,
        'current_state_updated', changed_rows = 1
      );
    ELSE
      session_status := payload ->> 'status';

      IF jsonb_typeof(payload -> 'status') IS DISTINCT FROM 'string'
        OR session_status IS NULL
        OR session_status IS DISTINCT FROM btrim(session_status)
        OR char_length(session_status) NOT BETWEEN 1 AND 64
        OR session_status !~ '^[A-Z][A-Z0-9_]{0,63}$'
        OR (
          payload ? 'name'
          AND (
            jsonb_typeof(payload -> 'name') IS DISTINCT FROM 'string'
            OR payload ->> 'name' IS DISTINCT FROM 'evo-inbox'
          )
        )
      THEN
        error_code := 'waha_session_status_invalid';
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
        EXIT project_observation;
      END IF;

      INSERT INTO platform_private.waha_session_observations (
        organization_id,
        source_webhook_event_id,
        waha_session_name,
        status,
        observed_at,
        request_id
      )
      VALUES (
        p_organization_id,
        source_event.id,
        source_event.waha_session_name,
        session_status,
        source_event.provider_occurred_at,
        p_request_id
      );

      -- A missing health row cannot be locked with SELECT ... FOR UPDATE.
      -- Serialize the first observation for this exact tenant/session so two
      -- equal-time, different-status deliveries cannot both observe absence
      -- and let the losing UPSERT incorrectly report success.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'platform:waha-session-health:'
            || p_organization_id::TEXT
            || ':'
            || source_event.waha_session_name,
          0
        )
      );

      SELECT health.*
      INTO current_session_health
      FROM platform.waha_session_health AS health
      WHERE health.organization_id = p_organization_id
        AND health.waha_session_name = source_event.waha_session_name
      FOR UPDATE;

      IF current_session_health.organization_id IS NOT NULL
        AND current_session_health.observed_at =
          source_event.provider_occurred_at
        AND current_session_health.status IS DISTINCT FROM session_status
      THEN
        error_code := 'waha_session_status_conflict';
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
        EXIT project_observation;
      END IF;

      INSERT INTO platform.waha_session_health (
        organization_id,
        waha_session_name,
        status,
        observed_at
      )
      VALUES (
        p_organization_id,
        source_event.waha_session_name,
        session_status,
        source_event.provider_occurred_at
      )
      ON CONFLICT (organization_id, waha_session_name)
      DO UPDATE SET
        status = EXCLUDED.status,
        observed_at = EXCLUDED.observed_at
      WHERE EXCLUDED.observed_at >
        platform.waha_session_health.observed_at;
      GET DIAGNOSTICS changed_rows = ROW_COUNT;

      evidence_ref := 'waha-observation:' || source_event.id::TEXT
        || ':session-status';
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'succeeded',
        evidence_ref,
        NULL
      ) || jsonb_build_object(
        'waha_session_name', source_event.waha_session_name,
        'status', session_status,
        'observed_at', source_event.provider_occurred_at,
        'current_state_updated', changed_rows = 1
      );
    END IF;
  END project_observation;

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
    persist_effect
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_waha_event_projection(
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
  source_event_type TEXT;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  SELECT source_event.event_type
  INTO source_event_type
  FROM platform_private.durable_work_items AS item
  JOIN platform_private.provider_webhook_events AS source_event
    ON source_event.organization_id = item.organization_id
   AND source_event.id = item.source_webhook_event_id
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id;

  IF source_event_type IN ('message', 'message.any') THEN
    RETURN platform.finish_waha_webhook_work(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      p_outcome,
      p_error_code,
      p_evidence_ref,
      p_retry_delay_seconds,
      p_request_id
    );
  END IF;

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
        AND source_event.event_type IN ('message.ack', 'session.status')
        AND EXISTS (
          SELECT 1
          FROM platform_private.waha_event_projection_requests AS projection
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
      'Only tenant-matched verified WAHA event work can be finished here'
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
      'Durable finish returned an invalid WAHA event envelope'
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

-- Preserve the accepted media array and authority checks. Delivery fields are
-- appended after media so existing positional consumers retain their prefix.
DROP FUNCTION platform.staff_conversation_messages(UUID, UUID);

CREATE FUNCTION platform.staff_conversation_messages(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  message_id UUID,
  conversation_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  language platform.communication_message_language,
  student_visible BOOLEAN,
  waha_session_name TEXT,
  waha_message_id TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  kommo_message_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  media JSONB,
  waha_ack_name TEXT,
  waha_ack_observed_at TIMESTAMPTZ
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

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    message.conversation_id,
    message.direction,
    message.body_text,
    message.language,
    message.student_visible,
    message.waha_session_name,
    message.waha_message_id,
    message.kommo_account_id,
    message.kommo_conversation_id,
    message.kommo_message_id,
    message.amocrm_account_id,
    message.amocrm_lead_id,
    message.amocrm_contact_id,
    message.created_at,
    COALESCE(media_rows.media, '[]'::JSONB),
    message.waha_ack_name,
    message.waha_ack_observed_at
  FROM platform.communication_messages AS message
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bounded_media.id,
        'ordinal', bounded_media.ordinal,
        'media_kind', bounded_media.media_kind,
        'mime_type', bounded_media.mime_type,
        'file_name', bounded_media.file_name,
        'file_size_bytes', bounded_media.file_size_bytes,
        'archival_status', bounded_media.archival_status,
        'created_at', bounded_media.created_at,
        'archived_at', bounded_media.archived_at
      )
      ORDER BY bounded_media.ordinal, bounded_media.id
    ) AS media
    FROM (
      SELECT media_row.*
      FROM platform.communication_message_media AS media_row
      WHERE media_row.organization_id = message.organization_id
        AND media_row.communication_message_id = message.id
      ORDER BY media_row.ordinal, media_row.id
      LIMIT 16
    ) AS bounded_media
  ) AS media_rows ON TRUE
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
  ORDER BY message.created_at, message.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_waha_session_health(
  p_organization_id UUID
)
RETURNS TABLE (
  waha_session_name TEXT,
  status TEXT,
  observed_at TIMESTAMPTZ
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

  IF NOT EXISTS (
    SELECT 1
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION
      'Active organization-scoped Platform authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    health.waha_session_name,
    health.status,
    health.observed_at
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'evo-inbox';
END
$$;

-- Supabase Realtime Broadcast authorization is evaluated at private channel
-- join time through realtime.topic(). Reuse the live actor/JWT authority and
-- permission helpers instead of trusting a topic string or stale JWT alone.
CREATE OR REPLACE FUNCTION platform_private.can_subscribe_platform_messaging(
  p_topic TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ (
      '^platform-messaging:'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) THEN EXISTS (
      SELECT 1
      FROM platform.current_actor_authority() AS authority
      WHERE authority.organization_id =
        substr(p_topic, char_length('platform-messaging:') + 1)::UUID
        AND private.platform_has_permission(
          authority.organization_id,
          'communication.read.full'
        )
    )
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.broadcast_platform_messaging_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_organization_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_organization_id := OLD.organization_id;
  ELSE
    target_organization_id := NEW.organization_id;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('resource', TG_ARGV[0]),
    'invalidate',
    'platform-messaging:' || target_organization_id::TEXT,
    TRUE
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER communication_conversations_realtime_invalidate
  AFTER INSERT OR UPDATE OR DELETE
  ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_platform_messaging_invalidation('conversation');

CREATE TRIGGER communication_messages_realtime_invalidate
  AFTER INSERT OR UPDATE OR DELETE
  ON platform.communication_messages
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_platform_messaging_invalidation('message');

CREATE TRIGGER communication_message_media_realtime_invalidate
  AFTER INSERT OR UPDATE OR DELETE
  ON platform.communication_message_media
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_platform_messaging_invalidation('media');

CREATE TRIGGER waha_session_health_realtime_invalidate
  AFTER INSERT OR UPDATE OR DELETE
  ON platform.waha_session_health
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_platform_messaging_invalidation('session');

CREATE POLICY platform_messaging_broadcast_read
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND realtime.messages.topic = (SELECT realtime.topic())
  AND (
    SELECT platform_private.can_subscribe_platform_messaging(
      (SELECT realtime.topic())
    )
  )
);

-- Receiving the private invalidation is the only client capability. There is
-- deliberately no INSERT policy and no authenticated table write grant.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE realtime.messages
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE realtime.messages FROM anon;
GRANT SELECT ON TABLE realtime.messages TO authenticated;
REVOKE ALL ON FUNCTION realtime.send(JSONB, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE
  platform.waha_session_health,
  platform_private.waha_ack_observations,
  platform_private.waha_session_observations,
  platform_private.waha_event_projection_effects,
  platform_private.waha_event_projection_requests
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.p5e_store_projection_result(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    UUID,
    UUID,
    UUID,
    TEXT,
    JSONB,
    BOOLEAN
  ),
  platform_private.can_subscribe_platform_messaging(TEXT),
  platform_private.broadcast_platform_messaging_invalidation()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.claim_waha_event_projection(UUID, INTEGER, TEXT, UUID),
  platform.project_claimed_waha_observation(UUID, UUID, UUID, UUID, UUID),
  platform.finish_waha_event_projection(
    UUID,
    UUID,
    UUID,
    platform.durable_work_finish_outcome,
    TEXT,
    TEXT,
    INTEGER,
    UUID
  ),
  platform.staff_conversation_messages(UUID, UUID),
  platform.staff_waha_session_health(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.claim_waha_event_projection(UUID, INTEGER, TEXT, UUID),
  platform.project_claimed_waha_observation(UUID, UUID, UUID, UUID, UUID),
  platform.finish_waha_event_projection(
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

GRANT EXECUTE ON FUNCTION
  platform.staff_conversation_messages(UUID, UUID),
  platform.staff_waha_session_health(UUID),
  platform_private.can_subscribe_platform_messaging(TEXT)
TO authenticated;

COMMENT ON COLUMN platform.communication_messages.waha_ack_name IS
  'Latest non-regressed exact WAHA ACK name; raw provider message identity remains private.';
COMMENT ON COLUMN platform.communication_messages.waha_ack_observed_at IS
  'Provider observation time corresponding to waha_ack_name.';
COMMENT ON TABLE platform.waha_session_health IS
  'Safe current exact evo-inbox status tuple; raw WAHA payload data and passkeys are never stored here.';
COMMENT ON TABLE platform_private.waha_ack_observations IS
  'Append-only exact ACK evidence, including the raw provider message identifier, available only inside the database trust boundary.';
COMMENT ON TABLE platform_private.waha_session_observations IS
  'Append-only exact-session status evidence; raw source payload remains in the verified webhook ledger.';
COMMENT ON TABLE platform_private.waha_event_projection_effects IS
  'Append-only succeeded/terminal effects for generalized WAHA ACK/session projection.';
COMMENT ON TABLE platform_private.waha_event_projection_requests IS
  'Append-only idempotent request/response receipts for generalized WAHA ACK/session projection.';
COMMENT ON FUNCTION platform.claim_waha_event_projection(
  UUID,
  INTEGER,
  TEXT,
  UUID
) IS
  'Claims verified exact-session message, message.any, message.ack or session.status work with the accepted P5B lease envelope.';
COMMENT ON FUNCTION platform.project_claimed_waha_observation(
  UUID,
  UUID,
  UUID,
  UUID,
  UUID
) IS
  'Delegates message projection to P5B and projects exact ACK/session evidence without exposing raw provider identity.';
COMMENT ON FUNCTION platform.staff_waha_session_health(UUID) IS
  'Returns only evo-inbox session name, bounded status and observation time to a live full-read Platform actor.';

COMMIT;
