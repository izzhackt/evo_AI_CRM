\set ON_ERROR_STOP on

-- Migration 100 acceptance is synthetic and transactional. It exercises the
-- same service-only signed session-status RPC used by the canonical webhook;
-- no provider, managed project or customer data is contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5B WAHA readiness assertion failed: %', p_message;
  END IF;
END
$$;

DO $$
DECLARE
  status_routine CONSTANT REGPROCEDURE :=
    'platform.sync_lead_agent_session_status(uuid,uuid,uuid)'::REGPROCEDURE;
  routine_record RECORD;
  forbidden_role TEXT;
BEGIN
  SELECT
    owner_role.rolname AS owner_name,
    routine.prosecdef,
    routine.provolatile,
    routine.proconfig,
    pg_catalog.pg_get_functiondef(routine.oid) AS definition
  INTO routine_record
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = routine.proowner
  WHERE routine.oid = status_routine::OID;

  IF routine_record.owner_name <> 'postgres'
    OR NOT routine_record.prosecdef
    OR routine_record.provolatile <> 'v'
    OR NOT routine_record.proconfig @> ARRAY['search_path=""']::TEXT[]
    OR routine_record.definition NOT LIKE
      '%platform_private.messaging_integration_health_events%'
    OR routine_record.definition NOT LIKE
      '%source_event.provider_occurred_at%'
    OR routine_record.definition NOT LIKE
      '%WHEN session_status = ''WORKING''%'
    OR routine_record.definition NOT LIKE
      '%ELSE ''blocked''::platform.messaging_integration_readiness%'
  THEN
    RAISE EXCEPTION
      'signed session-status RPC lost its bounded readiness bridge: %',
      routine_record;
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role', status_routine, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role cannot execute the signed status RPC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS privilege_routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        privilege_routine.proacl,
        pg_catalog.acldefault('f', privilege_routine.proowner)
      )
    ) AS privilege
    WHERE privilege_routine.oid = status_routine::OID
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC can execute the signed status RPC';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'supabase_auth_admin'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role, status_routine, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'forbidden role % can execute the signed status RPC',
        forbidden_role;
    END IF;
  END LOOP;

  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_table_privilege(
      forbidden_role,
      'platform_private.messaging_integration_health_events',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    ) THEN
      RAISE EXCEPTION
        'forbidden role % has direct readiness-ledger access',
        forbidden_role;
    END IF;
  END LOOP;
END
$$;

INSERT INTO platform.organizations (id, name)
VALUES
  (
    'a1000000-0000-4000-8000-000000000001',
    'P5B fresh WAHA readiness acceptance'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'P5B stale WAHA readiness acceptance'
  );

-- A pre-existing Gemini row proves that the WAHA bridge neither appends nor
-- changes AI readiness.
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
  'a1000000-0000-4000-8000-000000000010',
  'a1000000-0000-4000-8000-000000000001',
  'ai',
  'configured_unverified',
  'configuration_check',
  'Synthetic Gemini baseline',
  'synthetic:p5b:gemini-baseline',
  'a1000000-0000-4000-8000-000000000011',
  statement_timestamp() - INTERVAL '1 minute'
);

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
VALUES
  (
    'a1000000-0000-4000-8000-000000000101',
    'a1000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p5b-session-stopped', 'evo-inbox',
    'p5b-session-stopped', 'session.status',
    statement_timestamp() - INTERVAL '30 seconds',
    'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"STOPPED"}}',
    '{"hmac_verified":true}',
    'synthetic:p5b:session-stopped',
    repeat('11', 32),
    'a1000000-0000-4000-8000-000000000111'
  ),
  (
    'a1000000-0000-4000-8000-000000000102',
    'a1000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p5b-session-working', 'evo-inbox',
    'p5b-session-working', 'session.status',
    statement_timestamp() - INTERVAL '5 seconds',
    'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING"}}',
    '{"hmac_verified":true}',
    'synthetic:p5b:session-working',
    repeat('22', 32),
    'a1000000-0000-4000-8000-000000000112'
  ),
  (
    'a1000000-0000-4000-8000-000000000103',
    'a1000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p5b-session-older-starting', 'evo-inbox',
    'p5b-session-older-starting', 'session.status',
    statement_timestamp() - INTERVAL '20 seconds',
    'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"STARTING"}}',
    '{"hmac_verified":true}',
    'synthetic:p5b:session-older-starting',
    repeat('33', 32),
    'a1000000-0000-4000-8000-000000000113'
  ),
  (
    'a1000000-0000-4000-8000-000000000104',
    'a1000000-0000-4000-8000-000000000001',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p5b-session-unverified', 'evo-inbox',
    'p5b-session-unverified', 'session.status',
    statement_timestamp() - INTERVAL '2 seconds',
    'rejected',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING"}}',
    '{"hmac_verified":false}',
    'synthetic:p5b:session-unverified',
    repeat('44', 32),
    'a1000000-0000-4000-8000-000000000114'
  ),
  (
    'a1000000-0000-4000-8000-000000000201',
    'a1000000-0000-4000-8000-000000000002',
    'waha', 'waha:evo-inbox', NULL, NULL,
    'p5b-session-stale-working', 'evo-inbox',
    'p5b-session-stale-working', 'session.status',
    statement_timestamp() - INTERVAL '10 minutes',
    'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING"}}',
    '{"hmac_verified":true}',
    'synthetic:p5b:session-stale-working',
    repeat('55', 32),
    'a1000000-0000-4000-8000-000000000211'
  );

SELECT pg_temp.assert_true(
  NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_session_observations AS observation
      WHERE observation.organization_id =
        'a1000000-0000-4000-8000-000000000001'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.messaging_integration_health_events AS health
      WHERE health.organization_id =
          'a1000000-0000-4000-8000-000000000001'
        AND health.target = 'waha'
    ),
  'WAHA readiness evidence existed before the service-only signed call'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;

SELECT platform.sync_lead_agent_session_status(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000101',
  'a1000000-0000-4000-8000-000000000302'
)::TEXT AS p5b_stopped_result
\gset

RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5b_stopped_result'::JSONB ->> 'status' = 'STOPPED'
    AND :'p5b_stopped_result'::JSONB ->> 'deduplicated' = 'false'
    AND (
      SELECT health.readiness = 'blocked'
        AND health.evidence_kind = 'provider_observed'
        AND health.observed_at = source_event.provider_occurred_at
      FROM platform_private.current_messaging_integration_health(
        'a1000000-0000-4000-8000-000000000001',
        'waha'
      ) AS health
      CROSS JOIN platform_private.provider_webhook_events AS source_event
      WHERE source_event.id =
        'a1000000-0000-4000-8000-000000000101'
    ),
  'non-WORKING signed status did not map to provider-observed blocked'
);

SET LOCAL ROLE service_role;

SELECT platform.sync_lead_agent_session_status(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000303'
)::TEXT AS p5b_working_result
\gset

SELECT platform.sync_lead_agent_session_status(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000304'
)::TEXT AS p5b_working_replay
\gset

-- This is processed after WORKING but carries an older provider timestamp.
SELECT platform.sync_lead_agent_session_status(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000103',
  'a1000000-0000-4000-8000-000000000305'
)::TEXT AS p5b_older_result
\gset

SELECT platform.sync_lead_agent_session_status(
  'a1000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000201',
  'a1000000-0000-4000-8000-000000000306'
)::TEXT AS p5b_stale_result
\gset

DO $$
BEGIN
  BEGIN
    PERFORM platform.sync_lead_agent_session_status(
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000104',
      'a1000000-0000-4000-8000-000000000307'
    );
    RAISE EXCEPTION 'unverified session evidence was accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM platform.sync_lead_agent_session_status(
      'a1000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000102',
      'a1000000-0000-4000-8000-000000000308'
    );
    RAISE EXCEPTION 'cross-tenant session evidence was accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;

RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5b_working_result'::JSONB ->> 'status' = 'WORKING'
    AND :'p5b_working_result'::JSONB ->> 'deduplicated' = 'false'
    AND :'p5b_working_replay'::JSONB ->> 'status' = 'WORKING'
    AND :'p5b_working_replay'::JSONB ->> 'deduplicated' = 'true'
    AND :'p5b_older_result'::JSONB ->> 'status' = 'STARTING'
    AND :'p5b_stale_result'::JSONB ->> 'status' = 'WORKING',
  'signed status result or exact source replay disposition drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 3
      AND pg_catalog.count(*) FILTER (
        WHERE health.readiness = 'ready'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE health.readiness = 'blocked'
      ) = 2
      AND pg_catalog.bool_and(
        health.evidence_kind = 'provider_observed'
      )
      AND pg_catalog.count(DISTINCT health.request_id) = 3
    FROM platform_private.messaging_integration_health_events AS health
    WHERE health.organization_id =
        'a1000000-0000-4000-8000-000000000001'
      AND health.target = 'waha'
  ),
  'WAHA readiness history is not append-only and source-deduplicated'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform_private.messaging_integration_health_events AS health
    WHERE health.evidence_ref =
      'waha-session-status:a1000000-0000-4000-8000-000000000102'
  ),
  'replaying one signed provider event duplicated its readiness evidence'
);

SELECT pg_temp.assert_true(
  (
    SELECT health.readiness = 'ready'
      AND health.evidence_kind = 'provider_observed'
      AND health.observed_at = source_event.provider_occurred_at
    FROM platform_private.current_messaging_integration_health(
      'a1000000-0000-4000-8000-000000000001',
      'waha'
    ) AS health
    CROSS JOIN platform_private.provider_webhook_events AS source_event
    WHERE source_event.id =
      'a1000000-0000-4000-8000-000000000102'
  ),
  'later processing of older evidence replaced current WORKING readiness'
);

SELECT readiness::TEXT AS p5b_gate_readiness,
       evidence_kind::TEXT AS p5b_gate_evidence_kind
FROM platform_private.require_ready_messaging_integration(
  'a1000000-0000-4000-8000-000000000001',
  'waha'
)
\gset

SELECT pg_temp.assert_true(
  :'p5b_gate_readiness' = 'ready'
    AND :'p5b_gate_evidence_kind' = 'provider_observed',
  'manual-send readiness gate did not accept fresh WORKING provider evidence'
);

SELECT pg_temp.assert_true(
  (
    SELECT signals ->> 'waha_readiness' = 'ready'
      AND signals ->> 'waha_evidence_kind' = 'provider_observed'
    FROM (
      SELECT platform.platform_operational_signals_v1(
        'a1000000-0000-4000-8000-000000000401'
      ) AS signals
    ) AS current_signals
  ),
  'provider-readiness projection did not expose WAHA as ready'
);

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM platform_private.require_ready_messaging_integration(
      'a1000000-0000-4000-8000-000000000002',
      'waha'
    );
    RAISE EXCEPTION 'stale WORKING evidence passed the manual-send gate';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE platform_private.messaging_integration_health_events
    SET reason = 'forbidden rewrite'
    WHERE evidence_ref =
      'waha-session-status:a1000000-0000-4000-8000-000000000102';
    RAISE EXCEPTION 'readiness evidence allowed an in-place update';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$$;

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
      AND pg_catalog.bool_and(
        health.readiness = 'configured_unverified'
        AND health.evidence_kind = 'configuration_check'
        AND health.reason = 'Synthetic Gemini baseline'
        AND health.evidence_ref = 'synthetic:p5b:gemini-baseline'
      )
    FROM platform_private.messaging_integration_health_events AS health
    WHERE health.organization_id =
        'a1000000-0000-4000-8000-000000000001'
      AND health.target = 'ai'
  ),
  'WAHA session readiness bridge changed Gemini readiness'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 4
      AND pg_catalog.count(DISTINCT audit.request_id) = 4
      AND pg_catalog.bool_and(
        audit.action = 'messaging.integration.health.record'
        AND audit.resource_type = 'messaging_integration_health_event'
        AND audit.actor_principal = 'service:evo-lead-agent'
      )
    FROM platform.audit_events AS audit
    WHERE audit.actor_principal = 'service:evo-lead-agent'
      AND audit.action = 'messaging.integration.health.record'
      AND audit.organization_id IN (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
  ),
  'readiness evidence did not retain one exact audit per signed source event'
);

ROLLBACK;

SELECT 'platform migration 100 WAHA session readiness contract passed' AS result;
