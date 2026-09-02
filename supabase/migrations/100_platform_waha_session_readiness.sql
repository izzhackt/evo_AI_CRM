-- ============================================================
-- 100_platform_waha_session_readiness.sql
--
-- Bridge the verified evo-inbox session authority into the existing
-- messaging-integration readiness ledger. WAHA remains transport-only;
-- Gemini and every other integration target are unchanged.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.sync_lead_agent_session_status(
  p_organization_id UUID,
  p_provider_webhook_event_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_observation platform_private.waha_session_observations%ROWTYPE;
  current_health platform.waha_session_health%ROWTYPE;
  readiness_event platform_private.messaging_integration_health_events%ROWTYPE;
  readiness_audit platform.audit_events%ROWTYPE;
  session_status TEXT;
  readiness platform.messaging_integration_readiness;
  readiness_reason TEXT;
  readiness_evidence_ref TEXT;
  readiness_event_id UUID;
  readiness_request_id UUID;
  readiness_after_state JSONB;
  created_observation_id UUID := gen_random_uuid();
  changed_rows INTEGER := 0;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL
    OR p_provider_webhook_event_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION 'Exact Lead-Agent session evidence is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p8r6:lead-agent-session-source:'
        || p_organization_id::TEXT || ':'
        || p_provider_webhook_event_id::TEXT,
      0
    )
  );

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_provider_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:evo-inbox'
    OR source_event.waha_session_name <> 'evo-inbox'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'session.status'
    OR source_event.raw_payload ->> 'event' <> 'session.status'
    OR source_event.raw_payload ->> 'session' <> 'evo-inbox'
    OR source_event.raw_payload #>> '{payload,name}' <> 'evo-inbox'
  THEN
    RAISE EXCEPTION 'Exact signed evo-inbox session evidence is required'
      USING ERRCODE = '42501';
  END IF;

  session_status := source_event.raw_payload #>> '{payload,status}';
  IF session_status IS NULL
    OR session_status IS DISTINCT FROM pg_catalog.btrim(session_status)
    OR pg_catalog.char_length(session_status) NOT BETWEEN 1 AND 64
    OR session_status !~ '^[A-Z][A-Z0-9_]{0,63}$'
  THEN
    RAISE EXCEPTION 'Signed Lead-Agent session status is malformed'
      USING ERRCODE = '22023';
  END IF;

  readiness := CASE
    WHEN session_status = 'WORKING'
      THEN 'ready'::platform.messaging_integration_readiness
    ELSE 'blocked'::platform.messaging_integration_readiness
  END;
  readiness_reason := CASE
    WHEN session_status = 'WORKING'
      THEN 'Verified evo-inbox session status is WORKING'
    ELSE 'Verified evo-inbox session status is ' || session_status
  END;
  readiness_evidence_ref :=
    'waha-session-status:' || source_event.id::TEXT;
  readiness_event_id := platform_private.p3c_request_child_id(
    source_event.id,
    'p5b-waha-session-readiness-event'
  );
  readiness_request_id := platform_private.p3c_request_child_id(
    source_event.id,
    'p5b-waha-session-readiness-request'
  );
  readiness_after_state := pg_catalog.jsonb_build_object(
    'organization_id', p_organization_id,
    'messaging_integration_health_event_id', readiness_event_id,
    'target', 'waha',
    'readiness', readiness,
    'evidence_kind', 'provider_observed',
    'reason', readiness_reason,
    'evidence_ref', readiness_evidence_ref,
    'observed_at', source_event.provider_occurred_at
  );

  -- The provider event, rather than this invocation, is the idempotency and
  -- chronology authority. A delayed older webhook therefore stays historical
  -- and cannot replace a newer readiness row merely because it arrived later.
  INSERT INTO platform_private.messaging_integration_health_events (
    id,
    organization_id,
    target,
    readiness,
    evidence_kind,
    reason,
    evidence_ref,
    request_id,
    observed_at
  )
  VALUES (
    readiness_event_id,
    p_organization_id,
    'waha',
    readiness,
    'provider_observed',
    readiness_reason,
    readiness_evidence_ref,
    readiness_request_id,
    source_event.provider_occurred_at
  )
  ON CONFLICT (request_id) DO NOTHING;

  SELECT health.*
  INTO readiness_event
  FROM platform_private.messaging_integration_health_events AS health
  WHERE health.request_id = readiness_request_id;

  IF readiness_event.id IS DISTINCT FROM readiness_event_id
    OR readiness_event.organization_id IS DISTINCT FROM p_organization_id
    OR readiness_event.target IS DISTINCT FROM 'waha'
    OR readiness_event.readiness IS DISTINCT FROM readiness
    OR readiness_event.evidence_kind IS DISTINCT FROM 'provider_observed'
    OR readiness_event.reason IS DISTINCT FROM readiness_reason
    OR readiness_event.evidence_ref IS DISTINCT FROM readiness_evidence_ref
    OR readiness_event.observed_at IS DISTINCT FROM
      source_event.provider_occurred_at
  THEN
    RAISE EXCEPTION 'WAHA session readiness replay conflicts with prior evidence'
      USING ERRCODE = '23505';
  END IF;

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
    'service:evo-lead-agent',
    'messaging.integration.health.record',
    'messaging_integration_health_event',
    readiness_event_id,
    NULL,
    readiness_after_state,
    'Project signed evo-inbox session status into messaging readiness',
    readiness_request_id
  )
  ON CONFLICT (request_id) DO NOTHING;

  SELECT audit.*
  INTO readiness_audit
  FROM platform.audit_events AS audit
  WHERE audit.request_id = readiness_request_id;

  IF readiness_audit.organization_id IS DISTINCT FROM p_organization_id
    OR readiness_audit.actor_kind IS DISTINCT FROM 'service'
    OR readiness_audit.actor_profile_id IS NOT NULL
    OR readiness_audit.actor_principal IS DISTINCT FROM
      'service:evo-lead-agent'
    OR readiness_audit.action IS DISTINCT FROM
      'messaging.integration.health.record'
    OR readiness_audit.resource_type IS DISTINCT FROM
      'messaging_integration_health_event'
    OR readiness_audit.resource_id IS DISTINCT FROM readiness_event_id
    OR readiness_audit.before_state IS NOT NULL
    OR readiness_audit.after_state IS DISTINCT FROM readiness_after_state
    OR readiness_audit.reason IS DISTINCT FROM
      'Project signed evo-inbox session status into messaging readiness'
  THEN
    RAISE EXCEPTION 'WAHA session readiness replay conflicts with prior audit'
      USING ERRCODE = '23505';
  END IF;

  SELECT observation.*
  INTO prior_observation
  FROM platform_private.waha_session_observations AS observation
  WHERE observation.organization_id = p_organization_id
    AND observation.source_webhook_event_id = source_event.id;

  IF prior_observation.id IS NOT NULL THEN
    IF prior_observation.waha_session_name <> 'evo-inbox'
      OR prior_observation.status <> session_status
      OR prior_observation.observed_at <> source_event.provider_occurred_at
    THEN
      RAISE EXCEPTION 'Session evidence conflicts with its prior projection'
        USING ERRCODE = '23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'waha_session_name', prior_observation.waha_session_name,
      'status', prior_observation.status,
      'observed_at', prior_observation.observed_at,
      'current_state_updated', FALSE,
      'deduplicated', TRUE
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'platform:waha-session-health:'
        || p_organization_id::TEXT || ':evo-inbox',
      0
    )
  );

  SELECT health.*
  INTO current_health
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'evo-inbox'
  FOR UPDATE;

  IF current_health.organization_id IS NOT NULL
    AND current_health.observed_at = source_event.provider_occurred_at
    AND current_health.status IS DISTINCT FROM session_status
  THEN
    RAISE EXCEPTION 'Equal-time session observations conflict'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO platform_private.waha_session_observations (
    id,
    organization_id,
    source_webhook_event_id,
    waha_session_name,
    status,
    observed_at,
    request_id
  )
  VALUES (
    created_observation_id,
    p_organization_id,
    source_event.id,
    'evo-inbox',
    session_status,
    source_event.provider_occurred_at,
    p_request_id
  );

  INSERT INTO platform.waha_session_health (
    organization_id,
    waha_session_name,
    status,
    observed_at
  )
  VALUES (
    p_organization_id,
    'evo-inbox',
    session_status,
    source_event.provider_occurred_at
  )
  ON CONFLICT (organization_id, waha_session_name)
  DO UPDATE SET
    status = EXCLUDED.status,
    observed_at = EXCLUDED.observed_at
  WHERE EXCLUDED.observed_at > platform.waha_session_health.observed_at;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  result := pg_catalog.jsonb_build_object(
    'waha_session_name', 'evo-inbox',
    'status', session_status,
    'observed_at', source_event.provider_occurred_at,
    'current_state_updated', changed_rows = 1,
    'deduplicated', FALSE
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
    'service:evo-lead-agent',
    'communication.leadagent.sessionstatus',
    'waha_session_observation',
    created_observation_id,
    CASE
      WHEN current_health.organization_id IS NULL THEN NULL
      ELSE pg_catalog.jsonb_build_object(
        'waha_session_name', current_health.waha_session_name,
        'status', current_health.status,
        'observed_at', current_health.observed_at
      )
    END,
    result || pg_catalog.jsonb_build_object(
      'source_webhook_event_id', source_event.id
    ),
    'Project signed Lead-Agent session health into the unified Platform',
    p_request_id
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) TO service_role;

-- Preserve readiness across the forward migration when the canonical signed
-- status was already projected. Only the exact current evo-inbox tuple is
-- bridged; historical crm_primary and non-current observations remain solely
-- in their existing immutable evidence stores.
WITH current_signed_status AS MATERIALIZED (
  SELECT DISTINCT ON (observation.organization_id)
    observation.organization_id,
    observation.status,
    observation.observed_at,
    source_event.id AS source_event_id,
    platform_private.p3c_request_child_id(
      source_event.id,
      'p5b-waha-session-readiness-event'
    ) AS readiness_event_id,
    platform_private.p3c_request_child_id(
      source_event.id,
      'p5b-waha-session-readiness-request'
    ) AS readiness_request_id
  FROM platform_private.waha_session_observations AS observation
  JOIN platform.waha_session_health AS current_health
    ON current_health.organization_id = observation.organization_id
   AND current_health.waha_session_name = observation.waha_session_name
   AND current_health.status = observation.status
   AND current_health.observed_at = observation.observed_at
  JOIN platform_private.provider_webhook_events AS source_event
    ON source_event.organization_id = observation.organization_id
   AND source_event.id = observation.source_webhook_event_id
  WHERE observation.waha_session_name = 'evo-inbox'
    AND source_event.provider = 'waha'
    AND source_event.provider_account_ref = 'waha:evo-inbox'
    AND source_event.waha_session_name = 'evo-inbox'
    AND source_event.verification_status = 'verified'
    AND source_event.event_type = 'session.status'
    AND source_event.provider_occurred_at = observation.observed_at
    AND source_event.raw_payload ->> 'event' = 'session.status'
    AND source_event.raw_payload ->> 'session' = 'evo-inbox'
    AND source_event.raw_payload #>> '{payload,name}' = 'evo-inbox'
    AND source_event.raw_payload #>> '{payload,status}' = observation.status
  ORDER BY
    observation.organization_id,
    observation.created_at DESC,
    observation.id DESC
),
inserted_readiness AS (
  INSERT INTO platform_private.messaging_integration_health_events (
    id,
    organization_id,
    target,
    readiness,
    evidence_kind,
    reason,
    evidence_ref,
    request_id,
    observed_at
  )
  SELECT
    status.readiness_event_id,
    status.organization_id,
    'waha',
    CASE
      WHEN status.status = 'WORKING'
        THEN 'ready'::platform.messaging_integration_readiness
      ELSE 'blocked'::platform.messaging_integration_readiness
    END,
    'provider_observed',
    CASE
      WHEN status.status = 'WORKING'
        THEN 'Verified evo-inbox session status is WORKING'
      ELSE 'Verified evo-inbox session status is ' || status.status
    END,
    'waha-session-status:' || status.source_event_id::TEXT,
    status.readiness_request_id,
    status.observed_at
  FROM current_signed_status AS status
  ON CONFLICT (request_id) DO NOTHING
  RETURNING *
)
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
SELECT
  readiness_row.organization_id,
  'service',
  NULL,
  'service:evo-lead-agent',
  'messaging.integration.health.record',
  'messaging_integration_health_event',
  readiness_row.id,
  NULL,
  pg_catalog.jsonb_build_object(
    'organization_id', readiness_row.organization_id,
    'messaging_integration_health_event_id', readiness_row.id,
    'target', readiness_row.target,
    'readiness', readiness_row.readiness,
    'evidence_kind', readiness_row.evidence_kind,
    'reason', readiness_row.reason,
    'evidence_ref', readiness_row.evidence_ref,
    'observed_at', readiness_row.observed_at
  ),
  'Project signed evo-inbox session status into messaging readiness',
  readiness_row.request_id
FROM inserted_readiness AS readiness_row;

COMMENT ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) IS
  'Projects one verified evo-inbox session observation and its provider-time messaging readiness evidence into the canonical Platform authority.';

COMMIT;
