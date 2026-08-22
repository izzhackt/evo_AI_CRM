\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 079. All evidence is synthetic
-- and local to the disposable PostgreSQL database; no WAHA, amoCRM, AI or
-- managed Supabase provider is contacted.
BEGIN;

DO $$
DECLARE
  sync_routine CONSTANT REGPROCEDURE :=
    'platform.sync_lead_agent_session_status(uuid,uuid,uuid)'::REGPROCEDURE;
  health_routine CONSTANT REGPROCEDURE :=
    'platform.staff_waha_session_health(uuid,text)'::REGPROCEDURE;
  routine_oid OID;
  forbidden_role TEXT;
BEGIN
  IF pg_catalog.to_regprocedure(
    'platform.staff_waha_session_health(uuid)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'Legacy ambiguous staff_waha_session_health(uuid) still exists';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = 'staff_waha_session_health'
  ) <> 1 THEN
    RAISE EXCEPTION
      'staff_waha_session_health must expose exactly one session-bound overload';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = 'sync_lead_agent_session_status'
  ) <> 1 THEN
    RAISE EXCEPTION
      'sync_lead_agent_session_status must expose exactly one overload';
  END IF;

  routine_oid := sync_routine::OID;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid
      AND routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND NOT routine.proretset
      AND routine.prorettype = 'jsonb'::REGTYPE
      AND routine.pronargdefaults = 0
      AND routine.proconfig
        @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION
      'Unified Lead-Agent session sync signature or hardened posture drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    routine_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'service_role lacks unified Lead-Agent session sync EXECUTE';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has unified Lead-Agent session sync EXECUTE',
        forbidden_role;
    END IF;
  END LOOP;

  routine_oid := health_routine::OID;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.prokind = 'f'
      AND routine.proretset
      AND routine.pronargdefaults = 0
      AND routine.proconfig
        @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION
      'Session-bound staff WAHA health signature or hardened posture drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    routine_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'authenticated lacks session-bound staff WAHA health EXECUTE';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has session-bound staff WAHA health EXECUTE',
        forbidden_role;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  constraint_contract RECORD;
  allowed_sessions TEXT[];
BEGIN
  FOR constraint_contract IN
    SELECT *
    FROM (
      VALUES
        (
          'platform.waha_session_health'::REGCLASS,
          'waha_session_health_session_name_check'
        ),
        (
          'platform_private.waha_session_observations'::REGCLASS,
          'waha_session_observations_session_name_check'
        )
    ) AS expected(relation_oid, constraint_name)
  LOOP
    SELECT pg_catalog.array_agg(
      literal_match[1]
      ORDER BY literal_match[1]
    )
    INTO allowed_sessions
    FROM pg_catalog.pg_constraint AS constraint_row
    CROSS JOIN LATERAL pg_catalog.regexp_matches(
      pg_catalog.pg_get_constraintdef(constraint_row.oid),
      '''([^'']+)''',
      'g'
    ) AS literal_match
    WHERE constraint_row.conrelid = constraint_contract.relation_oid
      AND constraint_row.conname = constraint_contract.constraint_name
      AND constraint_row.contype = 'c';

    IF allowed_sessions IS DISTINCT FROM ARRAY[
      'crm_primary',
      'evo-inbox'
    ]::TEXT[] THEN
      RAISE EXCEPTION
        'Unified WAHA session constraint % allows %, expected exactly crm_primary and evo-inbox',
        constraint_contract.constraint_name,
        allowed_sessions;
    END IF;
  END LOOP;
END
$$;

-- Exercise only fail-closed argument/evidence boundaries. No provider call or
-- durable fixture is required.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

DO $$
BEGIN
  BEGIN
    PERFORM platform.sync_lead_agent_session_status(NULL, NULL, NULL);
    RAISE EXCEPTION 'Lead-Agent sync accepted missing evidence identifiers';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM platform.sync_lead_agent_session_status(
      '79000000-0000-4000-8000-000000000001',
      '79000000-0000-4000-8000-000000000002',
      '79000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'Lead-Agent sync accepted absent signed session evidence';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"79000000-0000-4000-8000-000000000010"}',
  true
);

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM platform.staff_waha_session_health(
      '79000000-0000-4000-8000-000000000001',
      'legacy-default'
    );
    RAISE EXCEPTION 'Staff WAHA health accepted an unknown session';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_waha_session_health(
      '79000000-0000-4000-8000-000000000001',
      'crm_primary'
    );
    RAISE EXCEPTION 'Staff WAHA health bypassed organization authority';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;

RESET ROLE;
ROLLBACK;

SELECT 'platform migration 079 unified Lead-Agent contract passed' AS result;
