-- ============================================================
-- 064_platform_amocrm_canonical_context.sql
--
-- P4R1: private append-only amoCRM canonical-context observations plus a
-- private bounded current projection for the accepted staff conversation
-- thread. This slice stores only sanitized names/status labels publicly
-- exposed through RPCs; provider IDs, raw bodies and secrets stay private.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION
platform_private.amocrm_canonical_context_safe_text(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  normalized TEXT := pg_catalog.btrim(p_value);
BEGIN
  IF normalized = ''
    OR pg_catalog.char_length(normalized) > 255
    OR normalized ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Canonical amoCRM context text is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN normalized;
END
$$;

CREATE OR REPLACE FUNCTION
platform_private.amocrm_canonical_context_reason_is_valid(
  p_reason_code TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(p_reason_code) IN (
    'responsible_user_forbidden',
    'provider_auth_failed',
    'provider_binding_mismatch',
    'provider_http_error',
    'provider_invalid_response',
    'provider_rate_limited',
    'provider_timeout',
    'provider_unreachable'
  )
$$;

CREATE OR REPLACE FUNCTION
platform_private.amocrm_canonical_context_normalize_capabilities(
  p_state TEXT,
  p_responsible_user_resolution TEXT,
  p_observed_capabilities TEXT[]
)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  normalized TEXT[];
  expected TEXT[];
BEGIN
  normalized := ARRAY(
    SELECT DISTINCT pg_catalog.btrim(capability)
    FROM pg_catalog.unnest(COALESCE(p_observed_capabilities, ARRAY[]::TEXT[]))
      AS capability
    WHERE pg_catalog.btrim(capability) <> ''
    ORDER BY 1
  );

  IF p_state = 'failed' THEN
    IF pg_catalog.coalesce(pg_catalog.array_length(normalized, 1), 0) <> 0 THEN
      RAISE EXCEPTION
        'Failed canonical-context observations cannot declare capabilities'
        USING ERRCODE = '22023';
    END IF;

    RETURN ARRAY[]::TEXT[];
  END IF;

  expected := CASE
    WHEN p_responsible_user_resolution = 'resolved' THEN
      ARRAY[
        'account.read',
        'contact.read',
        'lead.read',
        'pipeline.read',
        'user.read'
      ]::TEXT[]
    ELSE
      ARRAY[
        'account.read',
        'contact.read',
        'lead.read',
        'pipeline.read'
      ]::TEXT[]
  END;

  IF normalized IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'Canonical-context capabilities violate the bounded contract'
      USING ERRCODE = '22023';
  END IF;

  RETURN normalized;
END
$$;

CREATE TABLE platform_private.amocrm_canonical_context_current (
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  amocrm_contact_id BIGINT NOT NULL CHECK (amocrm_contact_id > 0),
  amocrm_lead_id BIGINT NOT NULL CHECK (amocrm_lead_id > 0),
  responsible_user_id BIGINT CHECK (
    responsible_user_id IS NULL OR responsible_user_id > 0
  ),
  pipeline_id BIGINT CHECK (pipeline_id IS NULL OR pipeline_id > 0),
  status_id BIGINT CHECK (status_id IS NULL OR status_id > 0),
  observed_capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  state TEXT NOT NULL CHECK (
    state IN ('available', 'degraded', 'stale', 'unavailable')
  ),
  reason_code TEXT CHECK (
    reason_code IS NULL
    OR platform_private.amocrm_canonical_context_reason_is_valid(reason_code)
  ),
  contact_name TEXT,
  lead_name TEXT,
  responsible_user_name TEXT,
  responsible_user_active BOOLEAN,
  responsible_user_resolution TEXT CHECK (
    responsible_user_resolution IS NULL
    OR responsible_user_resolution IN (
      'resolved',
      'not_assigned',
      'permission_denied'
    )
  ),
  pipeline_name TEXT,
  status_name TEXT,
  provider_observed_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL,
  adapter_contract_version INTEGER CHECK (
    adapter_contract_version IS NULL
    OR adapter_contract_version = 1
  ),
  version BIGINT NOT NULL CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, conversation_id),
  CONSTRAINT amocrm_canonical_context_current_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT amocrm_canonical_context_current_available_shape_check CHECK (
    (
      state = 'available'
      AND reason_code IS NULL
      AND contact_name IS NOT NULL
      AND lead_name IS NOT NULL
      AND pipeline_name IS NOT NULL
      AND status_name IS NOT NULL
      AND pipeline_id IS NOT NULL
      AND status_id IS NOT NULL
      AND provider_observed_at IS NOT NULL
      AND adapter_contract_version = 1
      AND responsible_user_resolution IN ('resolved', 'not_assigned')
      AND (
        (
          responsible_user_resolution = 'resolved'
          AND responsible_user_id IS NOT NULL
          AND responsible_user_name IS NOT NULL
          AND responsible_user_active IS NOT NULL
          AND observed_capabilities = ARRAY[
            'account.read',
            'contact.read',
            'lead.read',
            'pipeline.read',
            'user.read'
          ]::TEXT[]
        )
        OR (
          responsible_user_resolution = 'not_assigned'
          AND responsible_user_id IS NULL
          AND responsible_user_name IS NULL
          AND responsible_user_active IS NULL
          AND observed_capabilities = ARRAY[
            'account.read',
            'contact.read',
            'lead.read',
            'pipeline.read'
          ]::TEXT[]
        )
      )
    )
    OR (
      state = 'degraded'
      AND reason_code = 'responsible_user_forbidden'
      AND contact_name IS NOT NULL
      AND lead_name IS NOT NULL
      AND pipeline_name IS NOT NULL
      AND status_name IS NOT NULL
      AND responsible_user_id IS NULL
      AND pipeline_id IS NOT NULL
      AND status_id IS NOT NULL
      AND provider_observed_at IS NOT NULL
      AND adapter_contract_version = 1
      AND responsible_user_resolution = 'permission_denied'
      AND responsible_user_name IS NULL
      AND responsible_user_active IS NULL
      AND observed_capabilities = ARRAY[
        'account.read',
        'contact.read',
        'lead.read',
        'pipeline.read'
      ]::TEXT[]
    )
    OR (
      state = 'stale'
      AND reason_code IS NOT NULL
      AND contact_name IS NOT NULL
      AND lead_name IS NOT NULL
      AND pipeline_name IS NOT NULL
      AND status_name IS NOT NULL
      AND pipeline_id IS NOT NULL
      AND status_id IS NOT NULL
      AND provider_observed_at IS NOT NULL
      AND adapter_contract_version = 1
      AND responsible_user_resolution IN (
        'resolved',
        'not_assigned',
        'permission_denied'
      )
      AND (
        (
          responsible_user_resolution = 'resolved'
          AND responsible_user_id IS NOT NULL
          AND responsible_user_name IS NOT NULL
          AND responsible_user_active IS NOT NULL
          AND observed_capabilities = ARRAY[
            'account.read',
            'contact.read',
            'lead.read',
            'pipeline.read',
            'user.read'
          ]::TEXT[]
        )
        OR (
          responsible_user_resolution = 'not_assigned'
          AND responsible_user_id IS NULL
          AND responsible_user_name IS NULL
          AND responsible_user_active IS NULL
          AND observed_capabilities = ARRAY[
            'account.read',
            'contact.read',
            'lead.read',
            'pipeline.read'
          ]::TEXT[]
        )
        OR (
          responsible_user_resolution = 'permission_denied'
          AND responsible_user_id IS NULL
          AND responsible_user_name IS NULL
          AND responsible_user_active IS NULL
          AND observed_capabilities = ARRAY[
            'account.read',
            'contact.read',
            'lead.read',
            'pipeline.read'
          ]::TEXT[]
        )
      )
    )
    OR (
      state = 'unavailable'
      AND reason_code IS NOT NULL
      AND contact_name IS NULL
      AND lead_name IS NULL
      AND responsible_user_name IS NULL
      AND responsible_user_active IS NULL
      AND responsible_user_resolution IS NULL
      AND pipeline_name IS NULL
      AND status_name IS NULL
      AND responsible_user_id IS NULL
      AND pipeline_id IS NULL
      AND status_id IS NULL
      AND observed_capabilities = ARRAY[]::TEXT[]
      AND provider_observed_at IS NULL
      AND adapter_contract_version = 1
    )
  )
);

CREATE TABLE platform_private.amocrm_canonical_context_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL CHECK (
    pg_catalog.lower(payload_sha256) ~ '^[0-9a-f]{64}$'
  ),
  observed_state TEXT NOT NULL CHECK (
    observed_state IN ('available', 'degraded', 'failed')
  ),
  reason_code TEXT CHECK (
    reason_code IS NULL
    OR platform_private.amocrm_canonical_context_reason_is_valid(reason_code)
  ),
  amocrm_account_id BIGINT NOT NULL CHECK (amocrm_account_id > 0),
  amocrm_contact_id BIGINT NOT NULL CHECK (amocrm_contact_id > 0),
  amocrm_lead_id BIGINT NOT NULL CHECK (amocrm_lead_id > 0),
  contact_name TEXT,
  lead_name TEXT,
  responsible_user_id BIGINT,
  responsible_user_name TEXT,
  responsible_user_active BOOLEAN,
  responsible_user_resolution TEXT CHECK (
    responsible_user_resolution IS NULL
    OR responsible_user_resolution IN (
      'resolved',
      'not_assigned',
      'permission_denied'
    )
  ),
  pipeline_id BIGINT,
  pipeline_name TEXT,
  status_id BIGINT,
  status_name TEXT,
  observed_capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  provider_observed_at TIMESTAMPTZ,
  adapter_contract_version INTEGER NOT NULL CHECK (
    adapter_contract_version = 1
  ),
  projected_state TEXT NOT NULL CHECK (
    projected_state IN ('available', 'degraded', 'stale', 'unavailable')
  ),
  projected_reason_code TEXT CHECK (
    projected_reason_code IS NULL
    OR platform_private.amocrm_canonical_context_reason_is_valid(
      projected_reason_code
    )
  ),
  projected_public_json JSONB NOT NULL,
  projected_version BIGINT NOT NULL CHECK (projected_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT amocrm_canonical_context_observations_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX amocrm_canonical_context_observations_conversation_idx
  ON platform_private.amocrm_canonical_context_observations (
    organization_id,
    conversation_id,
    created_at DESC
  );

ALTER TABLE platform_private.amocrm_canonical_context_current
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_canonical_context_current
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_canonical_context_observations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.amocrm_canonical_context_observations
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER amocrm_canonical_context_current_set_updated_at
  BEFORE UPDATE ON platform_private.amocrm_canonical_context_current
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE TRIGGER amocrm_canonical_context_observations_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.amocrm_canonical_context_observations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER amocrm_canonical_context_observations_no_truncate
  BEFORE TRUNCATE
  ON platform_private.amocrm_canonical_context_observations
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION
platform_private.amocrm_canonical_context_current_json(
  p_current platform_private.amocrm_canonical_context_current
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'state', p_current.state,
    'reason_code', p_current.reason_code,
    'contact_name', p_current.contact_name,
    'lead_name', p_current.lead_name,
    'responsible_user_name', p_current.responsible_user_name,
    'responsible_user_active', p_current.responsible_user_active,
    'responsible_user_resolution', p_current.responsible_user_resolution,
    'pipeline_name', p_current.pipeline_name,
    'status_name', p_current.status_name,
    'provider_observed_at', p_current.provider_observed_at,
    'last_attempt_at', p_current.last_attempt_at,
    'adapter_contract_version', p_current.adapter_contract_version,
    'version', p_current.version
  )
$$;

CREATE OR REPLACE FUNCTION
platform.record_amocrm_canonical_context_observation(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_request_id UUID,
  p_state TEXT,
  p_reason_code TEXT,
  p_amocrm_account_id BIGINT,
  p_amocrm_contact_id BIGINT,
  p_amocrm_lead_id BIGINT,
  p_contact_name TEXT,
  p_lead_name TEXT,
  p_responsible_user_id BIGINT,
  p_responsible_user_name TEXT,
  p_responsible_user_active BOOLEAN,
  p_responsible_user_resolution TEXT,
  p_pipeline_id BIGINT,
  p_pipeline_name TEXT,
  p_status_id BIGINT,
  p_status_name TEXT,
  p_observed_capabilities TEXT[],
  p_provider_observed_at TIMESTAMPTZ,
  p_adapter_contract_version INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  replay_row platform_private.amocrm_canonical_context_observations%ROWTYPE;
  current_row platform_private.amocrm_canonical_context_current%ROWTYPE;
  projection_row platform_private.amocrm_canonical_context_current%ROWTYPE;
  normalized_reason_code TEXT := NULLIF(pg_catalog.btrim(p_reason_code), '');
  normalized_capabilities TEXT[];
  payload_json JSONB;
  payload_sha TEXT;
  safe_contact_name TEXT;
  safe_lead_name TEXT;
  safe_responsible_user_name TEXT;
  safe_pipeline_name TEXT;
  safe_status_name TEXT;
  next_version BIGINT;
  has_prior_safe_projection BOOLEAN := FALSE;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_request_id IS NULL
    OR p_state IS NULL
    OR p_amocrm_account_id IS NULL
    OR p_amocrm_account_id <= 0
    OR p_amocrm_contact_id IS NULL
    OR p_amocrm_contact_id <= 0
    OR p_amocrm_lead_id IS NULL
    OR p_amocrm_lead_id <= 0
    OR p_adapter_contract_version IS DISTINCT FROM 1
    OR p_state NOT IN ('available', 'degraded', 'failed')
  THEN
    RAISE EXCEPTION
      'Complete canonical amoCRM context identity is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4r1:amocrm-context-request:' || p_request_id::TEXT,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p4r1:amocrm-context-conversation:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  payload_json := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'state', p_state,
    'reason_code', normalized_reason_code,
    'amocrm_account_id', p_amocrm_account_id,
    'amocrm_contact_id', p_amocrm_contact_id,
    'amocrm_lead_id', p_amocrm_lead_id,
    'contact_name', p_contact_name,
    'lead_name', p_lead_name,
    'responsible_user_id', p_responsible_user_id,
    'responsible_user_name', p_responsible_user_name,
    'responsible_user_active', p_responsible_user_active,
    'responsible_user_resolution', p_responsible_user_resolution,
    'pipeline_id', p_pipeline_id,
    'pipeline_name', p_pipeline_name,
    'status_id', p_status_id,
    'status_name', p_status_name,
    'observed_capabilities', COALESCE(p_observed_capabilities, ARRAY[]::TEXT[]),
    'provider_observed_at', p_provider_observed_at,
    'adapter_contract_version', p_adapter_contract_version
  );
  payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(payload_json::TEXT, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO replay_row
  FROM platform_private.amocrm_canonical_context_observations AS observation
  WHERE observation.request_id = p_request_id;

  IF FOUND THEN
    IF replay_row.organization_id IS DISTINCT FROM p_organization_id
      OR replay_row.conversation_id IS DISTINCT FROM p_conversation_id
      OR replay_row.payload_sha256 IS DISTINCT FROM payload_sha
    THEN
      RAISE EXCEPTION
        'request_id was already used with different canonical-context input'
        USING ERRCODE = '23505';
    END IF;

    RETURN replay_row.projected_public_json;
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
  FOR UPDATE;

  IF conversation_row.id IS NULL
    OR conversation_row.amocrm_account_id IS DISTINCT FROM p_amocrm_account_id
    OR conversation_row.amocrm_contact_id IS DISTINCT FROM p_amocrm_contact_id
    OR conversation_row.amocrm_lead_id IS DISTINCT FROM p_amocrm_lead_id
  THEN
    RAISE EXCEPTION
      'Canonical amoCRM context binding is unavailable'
      USING ERRCODE = '42501';
  END IF;

  normalized_capabilities :=
    platform_private.amocrm_canonical_context_normalize_capabilities(
      p_state,
      p_responsible_user_resolution,
      p_observed_capabilities
    );

  IF normalized_reason_code IS NOT NULL
    AND NOT platform_private.amocrm_canonical_context_reason_is_valid(
      normalized_reason_code
    )
  THEN
    RAISE EXCEPTION 'Canonical amoCRM context reason code is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO current_row
  FROM platform_private.amocrm_canonical_context_current AS current_projection
  WHERE current_projection.organization_id = p_organization_id
    AND current_projection.conversation_id = p_conversation_id
  FOR UPDATE;

  next_version := COALESCE(current_row.version, 0) + 1;
  has_prior_safe_projection := current_row.state IN (
    'available',
    'degraded',
    'stale'
  );

  IF p_state IN ('available', 'degraded') THEN
    safe_contact_name :=
      platform_private.amocrm_canonical_context_safe_text(p_contact_name);
    safe_lead_name :=
      platform_private.amocrm_canonical_context_safe_text(p_lead_name);
    safe_pipeline_name :=
      platform_private.amocrm_canonical_context_safe_text(p_pipeline_name);
    safe_status_name :=
      platform_private.amocrm_canonical_context_safe_text(p_status_name);

    IF p_pipeline_id IS NULL
      OR p_pipeline_id <= 0
      OR p_status_id IS NULL
      OR p_status_id <= 0
      OR p_provider_observed_at IS NULL
      OR p_responsible_user_resolution NOT IN (
        'resolved',
        'not_assigned',
        'permission_denied'
      )
    THEN
      RAISE EXCEPTION
        'Successful canonical-context observations require bounded provider fields'
        USING ERRCODE = '22023';
    END IF;

    IF p_responsible_user_resolution = 'resolved' THEN
      IF p_state <> 'available'
        OR normalized_reason_code IS NOT NULL
        OR p_responsible_user_id IS NULL
        OR p_responsible_user_id <= 0
        OR p_responsible_user_active IS NULL
      THEN
        RAISE EXCEPTION
          'Resolved responsible-user context must be fully available'
          USING ERRCODE = '22023';
      END IF;

      safe_responsible_user_name :=
        platform_private.amocrm_canonical_context_safe_text(
          p_responsible_user_name
        );
    ELSIF p_responsible_user_resolution = 'not_assigned' THEN
      IF p_state <> 'available'
        OR normalized_reason_code IS NOT NULL
        OR p_responsible_user_id IS NOT NULL
        OR p_responsible_user_name IS NOT NULL
        OR p_responsible_user_active IS NOT NULL
      THEN
        RAISE EXCEPTION
          'Unassigned responsible-user context must remain bounded and available'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      IF p_state <> 'degraded'
        OR normalized_reason_code IS DISTINCT FROM
          'responsible_user_forbidden'
        OR p_responsible_user_id IS NOT NULL
        OR p_responsible_user_name IS NOT NULL
        OR p_responsible_user_active IS NOT NULL
      THEN
        RAISE EXCEPTION
          'Permission-denied responsible-user context must degrade safely'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    projection_row.organization_id := p_organization_id;
    projection_row.conversation_id := p_conversation_id;
    projection_row.amocrm_account_id := p_amocrm_account_id;
    projection_row.amocrm_contact_id := p_amocrm_contact_id;
    projection_row.amocrm_lead_id := p_amocrm_lead_id;
    projection_row.responsible_user_id := p_responsible_user_id;
    projection_row.pipeline_id := p_pipeline_id;
    projection_row.status_id := p_status_id;
    projection_row.observed_capabilities := normalized_capabilities;
    projection_row.state := p_state;
    projection_row.reason_code := normalized_reason_code;
    projection_row.contact_name := safe_contact_name;
    projection_row.lead_name := safe_lead_name;
    projection_row.responsible_user_name := safe_responsible_user_name;
    projection_row.responsible_user_active := p_responsible_user_active;
    projection_row.responsible_user_resolution :=
      p_responsible_user_resolution;
    projection_row.pipeline_name := safe_pipeline_name;
    projection_row.status_name := safe_status_name;
    projection_row.provider_observed_at := p_provider_observed_at;
    projection_row.last_attempt_at := statement_timestamp();
    projection_row.adapter_contract_version := 1;
    projection_row.version := next_version;
  ELSE
    IF normalized_reason_code IS NULL
      OR normalized_reason_code = 'responsible_user_forbidden'
      OR p_contact_name IS NOT NULL
      OR p_lead_name IS NOT NULL
      OR p_responsible_user_id IS NOT NULL
      OR p_responsible_user_name IS NOT NULL
      OR p_responsible_user_active IS NOT NULL
      OR p_responsible_user_resolution IS NOT NULL
      OR p_pipeline_id IS NOT NULL
      OR p_pipeline_name IS NOT NULL
      OR p_status_id IS NOT NULL
      OR p_status_name IS NOT NULL
      OR p_provider_observed_at IS NOT NULL
    THEN
      RAISE EXCEPTION
        'Failed canonical-context observations must contain only allowlisted failure evidence'
        USING ERRCODE = '22023';
    END IF;

    projection_row.organization_id := p_organization_id;
    projection_row.conversation_id := p_conversation_id;
    projection_row.amocrm_account_id := p_amocrm_account_id;
    projection_row.amocrm_contact_id := p_amocrm_contact_id;
    projection_row.amocrm_lead_id := p_amocrm_lead_id;
    projection_row.reason_code := normalized_reason_code;
    projection_row.last_attempt_at := statement_timestamp();
    projection_row.version := next_version;

    IF has_prior_safe_projection THEN
      projection_row.state := 'stale';
      projection_row.responsible_user_id := current_row.responsible_user_id;
      projection_row.pipeline_id := current_row.pipeline_id;
      projection_row.status_id := current_row.status_id;
      projection_row.observed_capabilities := current_row.observed_capabilities;
      projection_row.contact_name := current_row.contact_name;
      projection_row.lead_name := current_row.lead_name;
      projection_row.responsible_user_name := current_row.responsible_user_name;
      projection_row.responsible_user_active := current_row.responsible_user_active;
      projection_row.responsible_user_resolution :=
        current_row.responsible_user_resolution;
      projection_row.pipeline_name := current_row.pipeline_name;
      projection_row.status_name := current_row.status_name;
      projection_row.provider_observed_at := current_row.provider_observed_at;
      projection_row.adapter_contract_version :=
        current_row.adapter_contract_version;
    ELSE
      projection_row.state := 'unavailable';
      projection_row.responsible_user_id := NULL;
      projection_row.pipeline_id := NULL;
      projection_row.status_id := NULL;
      projection_row.observed_capabilities := ARRAY[]::TEXT[];
      projection_row.contact_name := NULL;
      projection_row.lead_name := NULL;
      projection_row.responsible_user_name := NULL;
      projection_row.responsible_user_active := NULL;
      projection_row.responsible_user_resolution := NULL;
      projection_row.pipeline_name := NULL;
      projection_row.status_name := NULL;
      projection_row.provider_observed_at := NULL;
      projection_row.adapter_contract_version := 1;
    END IF;
  END IF;

  INSERT INTO platform_private.amocrm_canonical_context_current AS current_projection (
    organization_id,
    conversation_id,
    amocrm_account_id,
    amocrm_contact_id,
    amocrm_lead_id,
    responsible_user_id,
    pipeline_id,
    status_id,
    observed_capabilities,
    state,
    reason_code,
    contact_name,
    lead_name,
    responsible_user_name,
    responsible_user_active,
    responsible_user_resolution,
    pipeline_name,
    status_name,
    provider_observed_at,
    last_attempt_at,
    adapter_contract_version,
    version
  )
  VALUES (
    projection_row.organization_id,
    projection_row.conversation_id,
    projection_row.amocrm_account_id,
    projection_row.amocrm_contact_id,
    projection_row.amocrm_lead_id,
    projection_row.responsible_user_id,
    projection_row.pipeline_id,
    projection_row.status_id,
    projection_row.observed_capabilities,
    projection_row.state,
    projection_row.reason_code,
    projection_row.contact_name,
    projection_row.lead_name,
    projection_row.responsible_user_name,
    projection_row.responsible_user_active,
    projection_row.responsible_user_resolution,
    projection_row.pipeline_name,
    projection_row.status_name,
    projection_row.provider_observed_at,
    projection_row.last_attempt_at,
    projection_row.adapter_contract_version,
    projection_row.version
  )
  ON CONFLICT (organization_id, conversation_id) DO UPDATE
  SET amocrm_account_id = EXCLUDED.amocrm_account_id,
      amocrm_contact_id = EXCLUDED.amocrm_contact_id,
      amocrm_lead_id = EXCLUDED.amocrm_lead_id,
      responsible_user_id = EXCLUDED.responsible_user_id,
      pipeline_id = EXCLUDED.pipeline_id,
      status_id = EXCLUDED.status_id,
      observed_capabilities = EXCLUDED.observed_capabilities,
      state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      contact_name = EXCLUDED.contact_name,
      lead_name = EXCLUDED.lead_name,
      responsible_user_name = EXCLUDED.responsible_user_name,
      responsible_user_active = EXCLUDED.responsible_user_active,
      responsible_user_resolution = EXCLUDED.responsible_user_resolution,
      pipeline_name = EXCLUDED.pipeline_name,
      status_name = EXCLUDED.status_name,
      provider_observed_at = EXCLUDED.provider_observed_at,
      last_attempt_at = EXCLUDED.last_attempt_at,
      adapter_contract_version = EXCLUDED.adapter_contract_version,
      version = EXCLUDED.version;

  INSERT INTO platform_private.amocrm_canonical_context_observations (
    organization_id,
    conversation_id,
    request_id,
    payload_sha256,
    observed_state,
    reason_code,
    amocrm_account_id,
    amocrm_contact_id,
    amocrm_lead_id,
    contact_name,
    lead_name,
    responsible_user_id,
    responsible_user_name,
    responsible_user_active,
    responsible_user_resolution,
    pipeline_id,
    pipeline_name,
    status_id,
    status_name,
    observed_capabilities,
    provider_observed_at,
    adapter_contract_version,
    projected_state,
    projected_reason_code,
    projected_public_json,
    projected_version
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    p_request_id,
    payload_sha,
    p_state,
    normalized_reason_code,
    p_amocrm_account_id,
    p_amocrm_contact_id,
    p_amocrm_lead_id,
    safe_contact_name,
    safe_lead_name,
    p_responsible_user_id,
    safe_responsible_user_name,
    p_responsible_user_active,
    p_responsible_user_resolution,
    p_pipeline_id,
    safe_pipeline_name,
    p_status_id,
    safe_status_name,
    normalized_capabilities,
    p_provider_observed_at,
    1,
    projection_row.state,
    projection_row.reason_code,
    platform_private.amocrm_canonical_context_current_json(projection_row),
    projection_row.version
  );

  RETURN platform_private.amocrm_canonical_context_current_json(
    projection_row
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_amocrm_canonical_context(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  state TEXT,
  reason_code TEXT,
  contact_name TEXT,
  lead_name TEXT,
  responsible_user_name TEXT,
  responsible_user_active BOOLEAN,
  responsible_user_resolution TEXT,
  pipeline_name TEXT,
  status_name TEXT,
  provider_observed_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  adapter_contract_version INTEGER,
  version BIGINT
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
    current_projection.state,
    current_projection.reason_code,
    current_projection.contact_name,
    current_projection.lead_name,
    current_projection.responsible_user_name,
    current_projection.responsible_user_active,
    current_projection.responsible_user_resolution,
    current_projection.pipeline_name,
    current_projection.status_name,
    current_projection.provider_observed_at,
    current_projection.last_attempt_at,
    current_projection.adapter_contract_version,
    current_projection.version
  FROM platform_private.amocrm_canonical_context_current AS current_projection
  JOIN platform.communication_conversations AS conversation
    ON conversation.organization_id = current_projection.organization_id
   AND conversation.id = current_projection.conversation_id
   AND conversation.amocrm_account_id = current_projection.amocrm_account_id
   AND conversation.amocrm_contact_id = current_projection.amocrm_contact_id
   AND conversation.amocrm_lead_id = current_projection.amocrm_lead_id
  WHERE current_projection.organization_id = p_organization_id
    AND current_projection.conversation_id = p_conversation_id;
END
$$;

REVOKE ALL ON TABLE
  platform_private.amocrm_canonical_context_current,
  platform_private.amocrm_canonical_context_observations
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.amocrm_canonical_context_safe_text(TEXT),
  platform_private.amocrm_canonical_context_reason_is_valid(TEXT),
  platform_private.amocrm_canonical_context_normalize_capabilities(
    TEXT,
    TEXT,
    TEXT[]
  ),
  platform_private.amocrm_canonical_context_current_json(
    platform_private.amocrm_canonical_context_current
  ),
  platform.record_amocrm_canonical_context_observation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    BOOLEAN,
    TEXT,
    BIGINT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT[],
    TIMESTAMPTZ,
    INTEGER
  ),
  platform.staff_amocrm_canonical_context(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.record_amocrm_canonical_context_observation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    BIGINT,
    BIGINT,
    BIGINT,
    TEXT,
    TEXT,
    BIGINT,
    TEXT,
    BOOLEAN,
    TEXT,
    BIGINT,
    TEXT,
    BIGINT,
    TEXT,
    TEXT[],
    TIMESTAMPTZ,
    INTEGER
  )
TO service_role;

GRANT EXECUTE ON FUNCTION
  platform.staff_amocrm_canonical_context(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform_private.amocrm_canonical_context_current IS
  'Private bounded current amoCRM canonical-context projection for one organization conversation; no provider IDs are exposed through the staff RPC.';
COMMENT ON TABLE platform_private.amocrm_canonical_context_observations IS
  'Private append-only amoCRM canonical-context read observations; raw provider bodies and secrets are intentionally absent.';
COMMENT ON FUNCTION platform.record_amocrm_canonical_context_observation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  BIGINT,
  BIGINT,
  BIGINT,
  TEXT,
  TEXT,
  BIGINT,
  TEXT,
  BOOLEAN,
  TEXT,
  BIGINT,
  TEXT,
  BIGINT,
  TEXT,
  TEXT[],
  TIMESTAMPTZ,
  INTEGER
) IS
  'Service-only append of one bounded amoCRM canonical-context observation with idempotent request replay and a private mutable current projection.';
COMMENT ON FUNCTION platform.staff_amocrm_canonical_context(UUID, UUID) IS
  'Live-authority staff read of one bounded amoCRM canonical-context projection for a visible communication conversation.';

COMMIT;
