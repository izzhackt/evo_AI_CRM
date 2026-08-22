-- ============================================================
-- 079_platform_unified_lead_agent_sync.sql
--
-- Make the signed Lead-Agent forwarding route a Supabase-native module of the
-- single EVO Platform. crm_primary session observations reuse the canonical
-- WAHA health/evidence model; no legacy database or parallel health table is
-- introduced.
-- ============================================================

BEGIN;

ALTER TABLE platform.waha_session_health
  DROP CONSTRAINT waha_session_health_waha_session_name_check;
ALTER TABLE platform.waha_session_health
  ADD CONSTRAINT waha_session_health_session_name_check CHECK (
    waha_session_name IN ('evo-inbox', 'crm_primary')
  );

ALTER TABLE platform_private.waha_session_observations
  DROP CONSTRAINT waha_session_observations_waha_session_name_check;
ALTER TABLE platform_private.waha_session_observations
  ADD CONSTRAINT waha_session_observations_session_name_check CHECK (
    waha_session_name IN ('evo-inbox', 'crm_primary')
  );

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
  session_status TEXT;
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
      'evo:p8r2:lead-agent-session-source:'
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
    OR source_event.provider_account_ref <> 'waha:crm_primary'
    OR source_event.waha_session_name <> 'crm_primary'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type <> 'session.status'
    OR source_event.raw_payload ->> 'event' <> 'session.status'
    OR source_event.raw_payload ->> 'session' <> 'crm_primary'
    OR source_event.raw_payload #>> '{payload,name}' <> 'crm_primary'
  THEN
    RAISE EXCEPTION 'Exact signed crm_primary session evidence is required'
      USING ERRCODE = '42501';
  END IF;

  session_status := source_event.raw_payload #>> '{payload,status}';
  IF session_status IS NULL
    OR session_status IS DISTINCT FROM btrim(session_status)
    OR char_length(session_status) NOT BETWEEN 1 AND 64
    OR session_status !~ '^[A-Z][A-Z0-9_]{0,63}$'
  THEN
    RAISE EXCEPTION 'Signed Lead-Agent session status is malformed'
      USING ERRCODE = '22023';
  END IF;

  SELECT observation.*
  INTO prior_observation
  FROM platform_private.waha_session_observations AS observation
  WHERE observation.organization_id = p_organization_id
    AND observation.source_webhook_event_id = source_event.id;

  IF prior_observation.id IS NOT NULL THEN
    IF prior_observation.waha_session_name <> 'crm_primary'
      OR prior_observation.status <> session_status
      OR prior_observation.observed_at <> source_event.provider_occurred_at
    THEN
      RAISE EXCEPTION 'Session evidence conflicts with its prior projection'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'waha_session_name', prior_observation.waha_session_name,
      'status', prior_observation.status,
      'observed_at', prior_observation.observed_at,
      'current_state_updated', FALSE,
      'deduplicated', TRUE
    );
  END IF;

  -- Serialize the current health tuple for this tenant/session. The append-only
  -- observation remains evidence; only a strictly newer observation advances
  -- the bounded current state.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'platform:waha-session-health:'
        || p_organization_id::TEXT || ':crm_primary',
      0
    )
  );

  SELECT health.*
  INTO current_health
  FROM platform.waha_session_health AS health
  WHERE health.organization_id = p_organization_id
    AND health.waha_session_name = 'crm_primary'
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
    'crm_primary',
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
    'crm_primary',
    session_status,
    source_event.provider_occurred_at
  )
  ON CONFLICT (organization_id, waha_session_name)
  DO UPDATE SET
    status = EXCLUDED.status,
    observed_at = EXCLUDED.observed_at
  WHERE EXCLUDED.observed_at > platform.waha_session_health.observed_at;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  result := jsonb_build_object(
    'waha_session_name', 'crm_primary',
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
      ELSE jsonb_build_object(
        'waha_session_name', current_health.waha_session_name,
        'status', current_health.status,
        'observed_at', current_health.observed_at
      )
    END,
    result || jsonb_build_object(
      'source_webhook_event_id', source_event.id
    ),
    'Project signed Lead-Agent session health into the unified Platform',
    p_request_id
  );

  RETURN result;
END
$$;

DROP FUNCTION platform.staff_waha_session_health(UUID);

CREATE FUNCTION platform.staff_waha_session_health(
  p_organization_id UUID,
  p_waha_session_name TEXT
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
  IF p_waha_session_name IS NULL
    OR p_waha_session_name NOT IN ('evo-inbox', 'crm_primary')
  THEN
    RAISE EXCEPTION 'Exact Platform WAHA session is required'
      USING ERRCODE = '22023';
  END IF;

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
    AND health.waha_session_name = p_waha_session_name;
END
$$;

REVOKE ALL ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.staff_waha_session_health(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION platform.staff_waha_session_health(UUID, TEXT)
  TO authenticated;

COMMENT ON FUNCTION platform.sync_lead_agent_session_status(
  UUID, UUID, UUID
) IS
  'Projects one verified crm_primary session observation into the canonical Platform WAHA health model.';
COMMENT ON FUNCTION platform.staff_waha_session_health(UUID, TEXT) IS
  'Returns at most one canonical current WAHA health row for one exact unified Platform session visible to an authorized staff actor.';

COMMIT;
