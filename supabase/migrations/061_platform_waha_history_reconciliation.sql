-- ============================================================
-- 061_platform_waha_history_reconciliation.sql
--
-- P5C: additive, read-only WAHA history reconciliation for the exact private
-- `evo-inbox` session. The application keeps this lane disabled by default.
-- This migration performs no provider call, send, read-mark, session mutation,
-- amoCRM lookup/write or production action.
--
-- History API observations are deliberately NOT represented as verified
-- webhooks. Their private source envelopes use verification_status = missing
-- and explicit api_history/read_only provenance. Raw chat/message identifiers
-- and normalized provider payloads remain in platform_private.
-- ============================================================

BEGIN;

-- Historical outbound observations predate Platform manual-send
-- authorizations. Admit that narrow evidence case without weakening the rule
-- for any current or future outbound Platform send.
ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_direction_shape_check;

ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_direction_shape_check CHECK (
    (
      direction = 'inbound'
      AND manual_send_authorization_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND message_identity_source = 'private_waha_history_binding'
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
    OR (
      message_identity_source = 'private_waha_history_binding'
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
  );

CREATE TABLE platform_private.waha_history_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  waha_session_name TEXT NOT NULL CHECK (
    waha_session_name = 'evo-inbox'
  ),
  engine TEXT NOT NULL CHECK (engine IN ('NOWEB', 'GOWS', 'WEBJS')),
  intake_sales_membership_id UUID NOT NULL,
  source_provenance TEXT NOT NULL DEFAULT 'api_history' CHECK (
    source_provenance = 'api_history'
  ),
  start_request_id UUID NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_reconciliation_runs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_history_reconciliation_runs_sales_fkey
    FOREIGN KEY (organization_id, intake_sales_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_reconciliation_runs_latest_idx
  ON platform_private.waha_history_reconciliation_runs (
    organization_id,
    waha_session_name,
    started_at DESC,
    id DESC
  );

CREATE TABLE platform_private.waha_history_reconciliation_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  run_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'paused', 'completed')),
  request_id UUID NOT NULL UNIQUE,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_reconciliation_lifecycle_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_history_reconciliation_lifecycle_run_fkey
    FOREIGN KEY (organization_id, run_id)
    REFERENCES platform_private.waha_history_reconciliation_runs(
      organization_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_reconciliation_lifecycle_latest_idx
  ON platform_private.waha_history_reconciliation_lifecycle (
    organization_id,
    run_id,
    observed_at DESC,
    id DESC
  );

CREATE TABLE platform_private.waha_history_reconciliation_requests (
  request_id UUID PRIMARY KEY,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  operation TEXT NOT NULL CHECK (
    operation IN ('begin', 'project_page', 'finish')
  ),
  organization_id UUID NOT NULL,
  run_id UUID NOT NULL,
  response JSONB NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_reconciliation_requests_run_fkey
    FOREIGN KEY (organization_id, run_id)
    REFERENCES platform_private.waha_history_reconciliation_runs(
      organization_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_reconciliation_requests_run_idx
  ON platform_private.waha_history_reconciliation_requests (
    organization_id,
    run_id,
    created_at DESC
  );

-- One private observation binds one history envelope to the public message it
-- reconciled or created. Full provider identifiers never leave this relation.
CREATE TABLE platform_private.waha_history_message_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  run_id UUID NOT NULL,
  waha_session_name TEXT NOT NULL CHECK (
    waha_session_name = 'evo-inbox'
  ),
  normalized_chat_id TEXT NOT NULL CHECK (
    normalized_chat_id ~ '^[0-9]+@c[.]us$'
  ),
  raw_message_id TEXT NOT NULL CHECK (
    btrim(raw_message_id) <> '' AND char_length(raw_message_id) <= 1000
  ),
  direction platform.communication_direction NOT NULL,
  provider_occurred_at TIMESTAMPTZ NOT NULL,
  source_event_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  page_request_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_message_observations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_history_message_observations_run_source_key
    UNIQUE (organization_id, run_id, source_event_id),
  CONSTRAINT waha_history_message_observations_run_message_key
    UNIQUE (organization_id, run_id, communication_message_id),
  CONSTRAINT waha_history_message_observations_run_fkey
    FOREIGN KEY (organization_id, run_id)
    REFERENCES platform_private.waha_history_reconciliation_runs(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT waha_history_message_observations_source_fkey
    FOREIGN KEY (organization_id, source_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_history_message_observations_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_message_observations_provider_key_idx
  ON platform_private.waha_history_message_observations (
    organization_id,
    waha_session_name,
    raw_message_id
  );

CREATE INDEX waha_history_message_observations_page_idx
  ON platform_private.waha_history_message_observations (
    organization_id,
    run_id,
    page_request_id
  );

CREATE TABLE platform_private.waha_history_projection_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  run_id UUID NOT NULL,
  source_event_id UUID NOT NULL,
  communication_message_id UUID NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('projected', 'reconciled_existing')
  ),
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  page_request_id UUID NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_projection_effects_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_history_projection_effects_run_source_key
    UNIQUE (organization_id, run_id, source_event_id),
  CONSTRAINT waha_history_projection_effects_run_message_key
    UNIQUE (organization_id, run_id, communication_message_id),
  CONSTRAINT waha_history_projection_effects_run_fkey
    FOREIGN KEY (organization_id, run_id)
    REFERENCES platform_private.waha_history_reconciliation_runs(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT waha_history_projection_effects_source_fkey
    FOREIGN KEY (organization_id, source_event_id)
    REFERENCES platform_private.provider_webhook_events(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT waha_history_projection_effects_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_projection_effects_page_idx
  ON platform_private.waha_history_projection_effects (
    organization_id,
    run_id,
    page_request_id
  );

-- A checkpoint is inserted only after the complete page projected without a
-- conflict. This is the durable cursor and makes failed calls resumable.
CREATE TABLE platform_private.waha_history_reconciliation_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  run_id UUID NOT NULL,
  chat_offset INTEGER NOT NULL CHECK (chat_offset >= 0),
  message_offset INTEGER NOT NULL CHECK (message_offset >= 0),
  projected_count INTEGER NOT NULL CHECK (projected_count >= 0),
  page_request_id UUID NOT NULL UNIQUE,
  checkpointed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT waha_history_reconciliation_checkpoints_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT waha_history_reconciliation_checkpoints_cursor_key
    UNIQUE (organization_id, run_id, chat_offset, message_offset),
  CONSTRAINT waha_history_reconciliation_checkpoints_run_fkey
    FOREIGN KEY (organization_id, run_id)
    REFERENCES platform_private.waha_history_reconciliation_runs(
      organization_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX waha_history_reconciliation_checkpoints_latest_idx
  ON platform_private.waha_history_reconciliation_checkpoints (
    organization_id,
    run_id,
    checkpointed_at DESC,
    id DESC
  );

ALTER TABLE platform_private.waha_history_reconciliation_runs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_runs
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_lifecycle
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_lifecycle
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_requests
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_message_observations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_message_observations
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_projection_effects
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_projection_effects
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_checkpoints
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.waha_history_reconciliation_checkpoints
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER waha_history_reconciliation_runs_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_reconciliation_runs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_reconciliation_runs_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_reconciliation_runs
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_history_reconciliation_lifecycle_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_reconciliation_lifecycle
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_reconciliation_lifecycle_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_reconciliation_lifecycle
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_history_reconciliation_requests_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_reconciliation_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_reconciliation_requests_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_reconciliation_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_history_message_observations_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_message_observations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_message_observations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_message_observations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_history_projection_effects_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_projection_effects
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_projection_effects_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_projection_effects
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER waha_history_reconciliation_checkpoints_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.waha_history_reconciliation_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER waha_history_reconciliation_checkpoints_no_truncate
  BEFORE TRUNCATE
  ON platform_private.waha_history_reconciliation_checkpoints
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.require_waha_history_sales(
  p_organization_id UUID,
  p_membership_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
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
      AND membership.id = p_membership_id
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
  ) THEN
    RAISE EXCEPTION
      'An active tenant-scoped Sales intake membership is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.waha_history_replay_request(
  p_request_id UUID,
  p_operation TEXT,
  p_input_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior platform_private.waha_history_reconciliation_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO prior
  FROM platform_private.waha_history_reconciliation_requests AS request
  WHERE request.request_id = p_request_id;

  IF prior.request_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF prior.operation IS DISTINCT FROM p_operation
    OR prior.input_sha256 IS DISTINCT FROM p_input_sha256
  THEN
    RAISE EXCEPTION
      'request_id was already used with different history input'
      USING ERRCODE = '22023';
  END IF;

  RETURN prior.response;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.assert_waha_history_request_unused(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
END
$$;

-- Extend the deferred binding proof for explicit read-only history sources.
-- Existing signed-webhook behavior remains unchanged.
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

  IF NEW.message_identity_source = 'private_waha_history_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id
       AND source_event.id = binding.source_webhook_event_id
      JOIN platform_private.waha_history_message_observations AS observation
        ON observation.organization_id = binding.organization_id
       AND observation.source_event_id = binding.source_webhook_event_id
       AND observation.communication_message_id = binding.communication_message_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND binding.waha_session_name = 'evo-inbox'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:evo-inbox'
        AND source_event.waha_session_name = 'evo-inbox'
        AND source_event.event_type = 'history.message'
        AND source_event.payload_id = binding.raw_message_id
        AND source_event.verification_status = 'missing'
        AND source_event.verification_headers ->> 'provenance' = 'api_history'
        AND source_event.verification_headers -> 'webhook_verified' = 'false'::JSONB
        AND source_event.verification_headers -> 'read_only' = 'true'::JSONB
        AND observation.waha_session_name = binding.waha_session_name
        AND observation.raw_message_id = binding.raw_message_id
    )
  THEN
    RAISE EXCEPTION
      'A history WAHA message requires explicit read-only API provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform.begin_waha_history_reconciliation(
  p_organization_id UUID,
  p_waha_session_name TEXT,
  p_engine TEXT,
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
  normalized_engine TEXT := btrim(p_engine);
  input_sha256 TEXT;
  replayed JSONB;
  selected_run platform_private.waha_history_reconciliation_runs%ROWTYPE;
  selected_state TEXT;
  chat_offset INTEGER := 0;
  message_offset INTEGER := 0;
  response JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_waha_session_name IS DISTINCT FROM 'evo-inbox'
    OR normalized_engine NOT IN ('NOWEB', 'GOWS', 'WEBJS')
    OR p_intake_sales_membership_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid organization, exact evo-inbox session, engine, Sales intake and request are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'waha_session_name', p_waha_session_name,
          'engine', normalized_engine,
          'intake_sales_membership_id', p_intake_sales_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'begin',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);
  PERFORM platform_private.require_waha_history_sales(
    p_organization_id,
    p_intake_sales_membership_id
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p5c:history-run:' || p_organization_id::TEXT || ':evo-inbox',
      0
    )
  );

  SELECT run.*
  INTO selected_run
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.waha_session_name = 'evo-inbox'
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1;

  IF selected_run.id IS NOT NULL THEN
    SELECT lifecycle.state
    INTO selected_state
    FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = selected_run.organization_id
      AND lifecycle.run_id = selected_run.id
    ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
    LIMIT 1;

    IF selected_state IS NULL THEN
      RAISE EXCEPTION
        'WAHA history run is missing lifecycle evidence'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF selected_run.id IS NULL OR selected_state = 'completed' THEN
    selected_run.id := gen_random_uuid();
    selected_run.organization_id := p_organization_id;
    selected_run.waha_session_name := 'evo-inbox';
    selected_run.engine := normalized_engine;
    selected_run.intake_sales_membership_id :=
      p_intake_sales_membership_id;

    INSERT INTO platform_private.waha_history_reconciliation_runs (
      id,
      organization_id,
      waha_session_name,
      engine,
      intake_sales_membership_id,
      source_provenance,
      start_request_id
    )
    VALUES (
      selected_run.id,
      p_organization_id,
      'evo-inbox',
      normalized_engine,
      p_intake_sales_membership_id,
      'api_history',
      p_request_id
    );

    INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
      organization_id,
      run_id,
      state,
      request_id,
      evidence
    )
    VALUES (
      p_organization_id,
      selected_run.id,
      'running',
      p_request_id,
      jsonb_build_object(
        'provenance', 'api_history',
        'read_only', TRUE,
        'engine', normalized_engine
      )
    );
  ELSE
    IF selected_run.engine IS DISTINCT FROM normalized_engine
      OR selected_run.intake_sales_membership_id IS DISTINCT FROM
        p_intake_sales_membership_id
    THEN
      RAISE EXCEPTION
        'An active history run cannot change engine or intake assignment'
        USING ERRCODE = '22023';
    END IF;

    SELECT checkpoint.chat_offset, checkpoint.message_offset
    INTO chat_offset, message_offset
    FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
    WHERE checkpoint.organization_id = p_organization_id
      AND checkpoint.run_id = selected_run.id
    ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
    LIMIT 1;
    chat_offset := COALESCE(chat_offset, 0);
    message_offset := COALESCE(message_offset, 0);

    IF selected_state = 'paused' THEN
      INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
        organization_id,
        run_id,
        state,
        request_id,
        evidence
      )
      VALUES (
        p_organization_id,
        selected_run.id,
        'running',
        p_request_id,
        jsonb_build_object(
          'provenance', 'api_history',
          'read_only', TRUE,
          'resumed_from', 'paused'
        )
      );
    END IF;
  END IF;

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', selected_run.id,
    'state', 'running',
    'chat_offset', chat_offset,
    'message_offset', message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'begin',
    p_organization_id,
    selected_run.id,
    response
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
    'service:platform-waha-history',
    'communication.waha.history.begin',
    'waha_history_reconciliation_run',
    selected_run.id,
    NULL,
    response,
    'Begin or resume disabled-by-default read-only WAHA history reconciliation',
    p_request_id
  );

  RETURN response;
END
$$;

CREATE OR REPLACE FUNCTION platform.project_waha_history_page(
  p_organization_id UUID,
  p_run_id UUID,
  p_waha_session_name TEXT,
  p_raw_chat_id TEXT,
  p_messages JSONB,
  p_next_chat_offset INTEGER,
  p_next_message_offset INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row platform_private.waha_history_reconciliation_runs%ROWTYPE;
  run_state TEXT;
  normalized_chat_value TEXT;
  current_chat_offset INTEGER := 0;
  current_message_offset INTEGER := 0;
  input_sha256 TEXT;
  replayed JSONB;
  response JSONB;
  message_entry JSONB;
  normalized_message JSONB;
  raw_envelope JSONB;
  raw_message_value TEXT;
  message_direction platform.communication_direction;
  occurred_at_value TIMESTAMPTZ;
  body_text_value TEXT;
  has_media_value BOOLEAN;
  payload_sha256_value TEXT;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  existing_effect platform_private.waha_history_projection_effects%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  message_binding platform_private.waha_message_bindings%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  customer_participant platform.conversation_participants%ROWTYPE;
  sales_participant platform.conversation_participants%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  created_scope_id UUID;
  created_conversation_id UUID;
  created_customer_participant_id UUID;
  created_sales_participant_id UUID;
  created_message_id UUID;
  customer_subject_ref TEXT;
  page_projected_count INTEGER := 0;
  disposition_value TEXT;
  inbound_marker CONSTANT TEXT :=
    '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.';
  outbound_marker CONSTANT TEXT :=
    '[Системное уведомление] Историческое исходящее медиа или сообщение без текста. Требуется загрузка медиа.';
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_run_id IS NULL
    OR p_waha_session_name IS DISTINCT FROM 'evo-inbox'
    OR p_messages IS NULL
    OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_messages) > 500
    OR pg_column_size(p_messages) > 5242880
    OR p_next_chat_offset IS NULL
    OR p_next_chat_offset < 0
    OR p_next_message_offset IS NULL
    OR p_next_message_offset < 0
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid tenant run, exact session, bounded message page, offsets and request are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_raw_chat_id IS NOT NULL THEN
    normalized_chat_value :=
      platform_private.normalize_waha_direct_chat_id(p_raw_chat_id);
  END IF;
  IF jsonb_array_length(p_messages) > 0
    AND normalized_chat_value IS NULL
  THEN
    RAISE EXCEPTION
      'Only a direct WAHA chat is supported by history reconciliation'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_messages) = 0
    AND p_raw_chat_id IS NOT NULL
    AND normalized_chat_value IS NULL
  THEN
    RAISE EXCEPTION
      'Rejected non-direct chat identifiers must not be persisted'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_messages) AS item(value)
    GROUP BY item.value ->> 'raw_message_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'A history page cannot repeat a raw message identifier'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'run_id', p_run_id,
          'waha_session_name', p_waha_session_name,
          'raw_chat_id', p_raw_chat_id,
          'messages', p_messages,
          'next_chat_offset', p_next_chat_offset,
          'next_message_offset', p_next_message_offset
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'project_page',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);

  SELECT *
  INTO run_row
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.id = p_run_id
    AND run.waha_session_name = 'evo-inbox'
  FOR SHARE;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION
      'Tenant/session-matched history run is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-run-id:' || p_run_id::TEXT, 0)
  );

  SELECT lifecycle.state
  INTO run_state
  FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
  WHERE lifecycle.organization_id = p_organization_id
    AND lifecycle.run_id = p_run_id
  ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
  LIMIT 1;

  IF run_state IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION
      'Only a running history reconciliation can project a page'
      USING ERRCODE = '55000';
  END IF;

  PERFORM platform_private.require_waha_history_sales(
    p_organization_id,
    run_row.intake_sales_membership_id
  );

  SELECT checkpoint.chat_offset, checkpoint.message_offset
  INTO current_chat_offset, current_message_offset
  FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.organization_id = p_organization_id
    AND checkpoint.run_id = p_run_id
  ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
  LIMIT 1;
  current_chat_offset := COALESCE(current_chat_offset, 0);
  current_message_offset := COALESCE(current_message_offset, 0);

  IF NOT (
    p_next_chat_offset > current_chat_offset
    OR (
      p_next_chat_offset = current_chat_offset
      AND p_next_message_offset > current_message_offset
    )
  ) THEN
    RAISE EXCEPTION
      'History cursor must advance monotonically'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_chat_value IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p5c:waha-chat:' || p_organization_id::TEXT
          || ':evo-inbox:' || normalized_chat_value,
        0
      )
    );
  END IF;

  FOR message_entry IN
    SELECT item.value
    FROM jsonb_array_elements(p_messages) AS item(value)
  LOOP
    IF jsonb_typeof(message_entry) IS DISTINCT FROM 'object'
      OR jsonb_typeof(message_entry -> 'raw_message_id') IS DISTINCT FROM 'string'
      OR NULLIF(btrim(message_entry ->> 'raw_message_id'), '') IS NULL
      OR char_length(message_entry ->> 'raw_message_id') > 1000
      OR message_entry ->> 'direction' NOT IN ('inbound', 'outbound')
      OR jsonb_typeof(message_entry -> 'occurred_at') IS DISTINCT FROM 'string'
      OR NULLIF(btrim(message_entry ->> 'occurred_at'), '') IS NULL
      OR jsonb_typeof(message_entry -> 'body_text') IS DISTINCT FROM 'string'
      OR char_length(message_entry ->> 'body_text') > 100000
      OR jsonb_typeof(message_entry -> 'has_media') IS DISTINCT FROM 'boolean'
    THEN
      RAISE EXCEPTION
        'Every history message requires bounded id, direction, time, text and media flag'
        USING ERRCODE = '22023';
    END IF;

    raw_message_value := btrim(message_entry ->> 'raw_message_id');
    message_direction :=
      (message_entry ->> 'direction')::platform.communication_direction;
    BEGIN
      occurred_at_value := (message_entry ->> 'occurred_at')::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'Every history message occurred_at must be a valid timestamp'
        USING ERRCODE = '22007';
    END;
    body_text_value := NULLIF(btrim(message_entry ->> 'body_text'), '');
    has_media_value := (message_entry ->> 'has_media')::BOOLEAN;
    IF body_text_value IS NULL AND NOT has_media_value THEN
      RAISE EXCEPTION
        'A history message without text must contain media'
        USING ERRCODE = '22023';
    END IF;
    IF body_text_value IS NULL THEN
      body_text_value := CASE
        WHEN message_direction = 'inbound' THEN inbound_marker
        ELSE outbound_marker
      END;
    END IF;

    normalized_message := jsonb_build_object(
      'raw_message_id', raw_message_value,
      'direction', message_direction,
      'occurred_at', occurred_at_value,
      'body_text', COALESCE(NULLIF(btrim(message_entry ->> 'body_text'), ''), ''),
      'has_media', has_media_value
    );
    raw_envelope := jsonb_build_object(
      'provenance', 'api_history',
      'read_only', TRUE,
      'session', 'evo-inbox',
      'chat_id', normalized_chat_value,
      'message', normalized_message
    );
    payload_sha256_value := encode(
      sha256(convert_to(raw_envelope::TEXT, 'UTF8')),
      'hex'
    );

    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p5c:waha-message:' || p_organization_id::TEXT
          || ':evo-inbox:' || raw_message_value,
        0
      )
    );

    SELECT *
    INTO source_event
    FROM platform_private.provider_webhook_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.provider = 'waha'
      AND event.provider_account_ref = 'waha:evo-inbox'
      AND event.waha_session_name = 'evo-inbox'
      AND event.event_type = 'history.message'
      AND event.payload_id = raw_message_value;

    IF source_event.id IS NOT NULL
      AND (
        source_event.payload_sha256 IS DISTINCT FROM payload_sha256_value
        OR source_event.verification_status <> 'missing'
        OR source_event.verification_headers ->> 'provenance' <> 'api_history'
        OR source_event.verification_headers -> 'webhook_verified'
          IS DISTINCT FROM 'false'::JSONB
        OR source_event.verification_headers -> 'read_only'
          IS DISTINCT FROM 'true'::JSONB
      )
    THEN
      RAISE EXCEPTION
        'Conflicting history payload exists for a WAHA message identity'
        USING ERRCODE = '23505';
    END IF;

    IF source_event.id IS NULL THEN
      INSERT INTO platform_private.provider_webhook_events (
        id,
        organization_id,
        provider,
        provider_account_ref,
        provider_conversation_ref,
        provider_event_variant_ref,
        provider_request_id,
        waha_session_name,
        payload_id,
        event_type,
        provider_occurred_at,
        verification_status,
        raw_payload,
        verification_headers,
        verification_evidence_ref,
        payload_sha256,
        request_id
      )
      VALUES (
        gen_random_uuid(),
        p_organization_id,
        'waha',
        'waha:evo-inbox',
        NULL,
        NULL,
        'api-history:' || encode(
          sha256(
            convert_to(
              p_organization_id::TEXT || ':evo-inbox:' || raw_message_value,
              'UTF8'
            )
          ),
          'hex'
        ),
        'evo-inbox',
        raw_message_value,
        'history.message',
        occurred_at_value,
        'missing',
        raw_envelope,
        jsonb_build_object(
          'provenance', 'api_history',
          'webhook_verified', FALSE,
          'read_only', TRUE
        ),
        'api-history-read:' || p_run_id::TEXT,
        payload_sha256_value,
        gen_random_uuid()
      )
      RETURNING * INTO source_event;
    END IF;

    SELECT *
    INTO existing_effect
    FROM platform_private.waha_history_projection_effects AS effect
    WHERE effect.organization_id = p_organization_id
      AND effect.run_id = p_run_id
      AND effect.source_event_id = source_event.id;

    IF existing_effect.id IS NOT NULL THEN
      IF existing_effect.payload_sha256 IS DISTINCT FROM payload_sha256_value THEN
        RAISE EXCEPTION
          'History replay payload conflicts with its prior effect'
          USING ERRCODE = '23505';
      END IF;
      CONTINUE;
    END IF;

    IF direct_binding.id IS NULL THEN
      SELECT *
      INTO direct_binding
      FROM platform_private.waha_direct_chat_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.waha_session_name = 'evo-inbox'
        AND binding.normalized_chat_id = normalized_chat_value;

      IF direct_binding.id IS NULL THEN
        created_scope_id := gen_random_uuid();
        created_conversation_id := gen_random_uuid();
        created_customer_participant_id := gen_random_uuid();
        created_sales_participant_id := gen_random_uuid();
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
          run_row.intake_sales_membership_id,
          created_scope_id,
          1,
          1,
          TRUE,
          'service',
          NULL,
          'Grant Sales access to one read-only WAHA history conversation',
          p_request_id
        );

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
          run_row.intake_sales_membership_id,
          'platform_intake',
          NULL,
          'sales',
          'open',
          'WhatsApp ••••' || right(
            split_part(normalized_chat_value, '@', 1),
            4
          ),
          'evo-inbox',
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
            run_row.intake_sales_membership_id,
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
          'evo-inbox',
          normalized_chat_value,
          created_conversation_id,
          source_event.id
        )
        RETURNING * INTO direct_binding;
      END IF;
    END IF;

    SELECT *
    INTO conversation
    FROM platform.communication_conversations AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.id = direct_binding.conversation_id;

    IF conversation.id IS NULL
      OR conversation.waha_session_name <> 'evo-inbox'
    THEN
      RAISE EXCEPTION
        'A WAHA history chat binding cannot cross tenant or session'
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

    SELECT *
    INTO message_binding
    FROM platform_private.waha_message_bindings AS binding
    WHERE binding.organization_id = p_organization_id
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.raw_message_id = raw_message_value;

    IF message_binding.id IS NOT NULL THEN
      SELECT *
      INTO message_row
      FROM platform.communication_messages AS message
      WHERE message.organization_id = p_organization_id
        AND message.id = message_binding.communication_message_id;

      IF message_row.id IS NULL
        OR message_row.conversation_id <> conversation.id
        OR message_row.direction <> message_direction
        OR message_row.sender_participant_id <> (
          CASE
            WHEN message_direction = 'inbound' THEN customer_participant.id
            ELSE sales_participant.id
          END
        )
        OR message_row.body_text <> body_text_value
        OR message_row.created_at <> occurred_at_value
      THEN
        RAISE EXCEPTION
          'WAHA history message conflicts with an existing private binding'
          USING ERRCODE = '23505';
      END IF;
      disposition_value := 'reconciled_existing';
    ELSE
      created_message_id := gen_random_uuid();
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
        conversation.student_case_id,
        CASE
          WHEN message_direction = 'inbound' THEN customer_participant.id
          ELSE sales_participant.id
        END,
        message_direction,
        body_text_value,
        'undetermined',
        FALSE,
        'private_waha_history_binding',
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
        occurred_at_value
      );

      INSERT INTO platform_private.waha_message_bindings (
        organization_id,
        waha_session_name,
        raw_message_id,
        communication_message_id,
        source_webhook_event_id
      )
      VALUES (
        p_organization_id,
        'evo-inbox',
        raw_message_value,
        created_message_id,
        source_event.id
      )
      RETURNING * INTO message_binding;

      SELECT *
      INTO message_row
      FROM platform.communication_messages AS message
      WHERE message.organization_id = p_organization_id
        AND message.id = created_message_id;
      disposition_value := 'projected';
    END IF;

    INSERT INTO platform_private.waha_history_message_observations (
      organization_id,
      run_id,
      waha_session_name,
      normalized_chat_id,
      raw_message_id,
      direction,
      provider_occurred_at,
      source_event_id,
      communication_message_id,
      payload_sha256,
      page_request_id
    )
    VALUES (
      p_organization_id,
      p_run_id,
      'evo-inbox',
      normalized_chat_value,
      raw_message_value,
      message_direction,
      occurred_at_value,
      source_event.id,
      message_row.id,
      payload_sha256_value,
      p_request_id
    );

    INSERT INTO platform_private.waha_history_projection_effects (
      organization_id,
      run_id,
      source_event_id,
      communication_message_id,
      disposition,
      payload_sha256,
      page_request_id
    )
    VALUES (
      p_organization_id,
      p_run_id,
      source_event.id,
      message_row.id,
      disposition_value,
      payload_sha256_value,
      p_request_id
    );
    page_projected_count := page_projected_count + 1;
  END LOOP;

  INSERT INTO platform_private.waha_history_reconciliation_checkpoints (
    organization_id,
    run_id,
    chat_offset,
    message_offset,
    projected_count,
    page_request_id
  )
  VALUES (
    p_organization_id,
    p_run_id,
    p_next_chat_offset,
    p_next_message_offset,
    page_projected_count,
    p_request_id
  );

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', p_run_id,
    'state', 'running',
    'projected_count', page_projected_count,
    'chat_offset', p_next_chat_offset,
    'message_offset', p_next_message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'project_page',
    p_organization_id,
    p_run_id,
    response
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
    'service:platform-waha-history',
    'communication.waha.history.project',
    'waha_history_reconciliation_run',
    p_run_id,
    jsonb_build_object(
      'chat_offset', current_chat_offset,
      'message_offset', current_message_offset
    ),
    response,
    'Project one read-only WAHA API history page and advance its durable cursor atomically',
    p_request_id
  );

  RETURN response;
END
$$;

CREATE OR REPLACE FUNCTION platform.finish_waha_history_reconciliation(
  p_organization_id UUID,
  p_run_id UUID,
  p_outcome TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row platform_private.waha_history_reconciliation_runs%ROWTYPE;
  run_state TEXT;
  chat_offset INTEGER := 0;
  message_offset INTEGER := 0;
  projected_count INTEGER := 0;
  input_sha256 TEXT;
  replayed JSONB;
  response JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_run_id IS NULL
    OR p_outcome NOT IN ('completed', 'paused')
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid tenant run, completed/paused outcome and request are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'run_id', p_run_id,
          'outcome', p_outcome
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'finish',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-run-id:' || p_run_id::TEXT, 0)
  );

  SELECT *
  INTO run_row
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.id = p_run_id
    AND run.waha_session_name = 'evo-inbox';

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION
      'Tenant/session-matched history run is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT lifecycle.state
  INTO run_state
  FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
  WHERE lifecycle.organization_id = p_organization_id
    AND lifecycle.run_id = p_run_id
  ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
  LIMIT 1;

  IF run_state IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION
      'Only a running history reconciliation can be finished or paused'
      USING ERRCODE = '55000';
  END IF;

  SELECT checkpoint.chat_offset, checkpoint.message_offset
  INTO chat_offset, message_offset
  FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.organization_id = p_organization_id
    AND checkpoint.run_id = p_run_id
  ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
  LIMIT 1;
  chat_offset := COALESCE(chat_offset, 0);
  message_offset := COALESCE(message_offset, 0);

  SELECT count(*)::INTEGER
  INTO projected_count
  FROM platform_private.waha_history_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.run_id = p_run_id;

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', p_run_id,
    'state', p_outcome,
    'projected_count', projected_count,
    'chat_offset', chat_offset,
    'message_offset', message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
    organization_id,
    run_id,
    state,
    request_id,
    evidence
  )
  VALUES (
    p_organization_id,
    p_run_id,
    p_outcome,
    p_request_id,
    response || jsonb_build_object(
      'provenance', 'api_history',
      'read_only', TRUE
    )
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'finish',
    p_organization_id,
    p_run_id,
    response
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
    'service:platform-waha-history',
    CASE
      WHEN p_outcome = 'completed' THEN
        'communication.waha.history.complete'
      ELSE 'communication.waha.history.pause'
    END,
    'waha_history_reconciliation_run',
    p_run_id,
    jsonb_build_object('state', run_state),
    response,
    'Finish or pause read-only WAHA history reconciliation without provider mutation',
    p_request_id
  );

  RETURN response;
END
$$;

REVOKE ALL ON TABLE
  platform_private.waha_history_reconciliation_runs,
  platform_private.waha_history_reconciliation_lifecycle,
  platform_private.waha_history_reconciliation_requests,
  platform_private.waha_history_message_observations,
  platform_private.waha_history_projection_effects,
  platform_private.waha_history_reconciliation_checkpoints
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.require_waha_history_sales(UUID, UUID),
  platform_private.waha_history_replay_request(UUID, TEXT, TEXT),
  platform_private.assert_waha_history_request_unused(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.begin_waha_history_reconciliation(UUID, TEXT, TEXT, UUID, UUID),
  platform.project_waha_history_page(
    UUID,
    UUID,
    TEXT,
    TEXT,
    JSONB,
    INTEGER,
    INTEGER,
    UUID
  ),
  platform.finish_waha_history_reconciliation(UUID, UUID, TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.begin_waha_history_reconciliation(UUID, TEXT, TEXT, UUID, UUID),
  platform.project_waha_history_page(
    UUID,
    UUID,
    TEXT,
    TEXT,
    JSONB,
    INTEGER,
    INTEGER,
    UUID
  ),
  platform.finish_waha_history_reconciliation(UUID, UUID, TEXT, UUID)
TO service_role;

COMMENT ON TABLE platform_private.waha_history_reconciliation_runs IS
  'Append-only tenant/session-bound read-only WAHA history run identity; application enablement remains disabled by default.';
COMMENT ON TABLE platform_private.waha_history_reconciliation_lifecycle IS
  'Append-only running/paused/completed evidence for a WAHA history run.';
COMMENT ON TABLE platform_private.waha_history_message_observations IS
  'Private api_history observations containing raw WAHA chat/message identity and no verified-webhook claim.';
COMMENT ON TABLE platform_private.waha_history_projection_effects IS
  'Append-only projected/reconciled message effects for successful history pages.';
COMMENT ON TABLE platform_private.waha_history_reconciliation_checkpoints IS
  'Append-only cursor advanced only after an entire history page commits successfully.';
COMMENT ON COLUMN platform.communication_messages.message_identity_source IS
  'Immutable provenance: public provider identity, signed inbound private WAHA binding, or explicit read-only private WAHA history binding.';
COMMENT ON FUNCTION platform.begin_waha_history_reconciliation(
  UUID,
  TEXT,
  TEXT,
  UUID,
  UUID
) IS
  'Begins/resumes a disabled-by-default service-only read-only evo-inbox history run; creates a new run only after completion.';
COMMENT ON FUNCTION platform.project_waha_history_page(
  UUID,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  INTEGER,
  INTEGER,
  UUID
) IS
  'Atomically projects one bounded direct-chat API history page and advances its private cursor without provider or amoCRM mutation.';
COMMENT ON FUNCTION platform.finish_waha_history_reconciliation(
  UUID,
  UUID,
  TEXT,
  UUID
) IS
  'Persists completed/paused evidence and returns the last durable history cursor and total projected/reconciled effects.';

COMMIT;
