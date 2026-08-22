\set ON_ERROR_STOP on

-- BW2 catalog/ACL proof at the exact migration-052 boundary.
DO $$
DECLARE
  handoff_table CONSTANT REGCLASS :=
    'platform.student_case_op_handoffs'::REGCLASS;
  role_name TEXT;
  privilege_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
    WHERE relation.oid = handoff_table
      AND namespace.nspname = 'platform'
      AND relation.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'BW2 handoff table must be postgres-owned with forced RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'student_cases'
      AND column_name = 'applied_ozo_workflow_contract_version_id'
      AND is_nullable = 'YES'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BW2 nullable Student Case OZO binding is missing';
  END IF;

  IF (
    SELECT array_agg(policyname::TEXT ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'platform'
      AND tablename = 'student_case_op_handoffs'
  ) IS DISTINCT FROM ARRAY['student_case_op_handoffs_read']::TEXT[] THEN
    RAISE EXCEPTION 'BW2 handoff RLS policy inventory drifted';
  END IF;

  IF NOT has_table_privilege(
    'authenticated',
    handoff_table,
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated lacks handoff SELECT';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'service_role', 'supabase_auth_admin'
  ] LOOP
    IF has_table_privilege(role_name, handoff_table, 'SELECT') THEN
      RAISE EXCEPTION '% unexpectedly has handoff SELECT', role_name;
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ] LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege(role_name, handoff_table, privilege_name) THEN
        RAISE EXCEPTION '% unexpectedly has handoff %',
          role_name, privilege_name;
      END IF;
    END LOOP;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = handoff_table
      AND contype = 'f'
  ) <> 3 THEN
    RAISE EXCEPTION 'BW2 handoff must have three composite tenant FKs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = handoff_table
      AND contype = 'f'
      AND array_length(conkey, 1) < 3
  ) THEN
    RAISE EXCEPTION 'BW2 handoff has a non-composite domain FK';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'platform.student_cases'::REGCLASS
      AND conname = 'student_cases_applied_ozo_version_fkey'
      AND contype = 'f'
      AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'BW2 Student Case OZO tenant FK is missing';
  END IF;

  IF (
    SELECT array_agg(tgname::TEXT ORDER BY tgname)
    FROM pg_trigger
    WHERE tgrelid = handoff_table
      AND NOT tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'student_case_op_handoffs_append_only',
    'student_case_op_handoffs_insert_guard',
    'student_case_op_handoffs_no_truncate'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW2 handoff mutation trigger inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'platform.student_cases'::REGCLASS
      AND tgname = 'student_cases_ozo_binding_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'BW2 forward-only case binding guard is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relkind IN ('r', 'p', 'v', 'm')
      AND relation.relname IN (
        'leads', 'contacts', 'sales_pipeline', 'sales_pipelines',
        'pipeline_stages', 'amo_contacts', 'amo_leads'
      )
  ) THEN
    RAISE EXCEPTION 'BW2 introduced a forbidden local sales authority';
  END IF;
END
$$;

DO $$
DECLARE
  ingest CONSTANT REGPROCEDURE :=
    'platform.create_pending_student_case_with_handoff(uuid,uuid,uuid,text,text,timestamp with time zone,text,text,text,text,text,text,text,text,text,uuid,uuid,jsonb,jsonb,jsonb,text,timestamp with time zone,platform.business_role,uuid)'::REGPROCEDURE;
  projections CONSTANT REGPROCEDURE[] := ARRAY[
    'platform.staff_op_workflow_contract()'::REGPROCEDURE,
    'platform.staff_student_case_queue()'::REGPROCEDURE,
    'platform.staff_student_case_snapshot(uuid)'::REGPROCEDURE,
    'platform.staff_application_queue()'::REGPROCEDURE,
    'platform.staff_application_snapshot(uuid)'::REGPROCEDURE
  ];
  routine REGPROCEDURE;
  role_name TEXT;
BEGIN
  IF NOT has_function_privilege('service_role', ingest, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks BW2 ingest EXECUTE';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'supabase_auth_admin'
  ] LOOP
    IF has_function_privilege(role_name, ingest, 'EXECUTE') THEN
      RAISE EXCEPTION '% unexpectedly has BW2 ingest EXECUTE', role_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = ingest::OID
      AND prosecdef
      AND provolatile = 'v'
      AND proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'BW2 ingest lacks hardened volatile definer posture';
  END IF;

  FOREACH routine IN ARRAY projections LOOP
    IF NOT has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks BW2 projection EXECUTE on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly has BW2 projection EXECUTE on %',
          role_name, routine;
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = routine::OID
        AND prosecdef
        AND provolatile = 's'
        AND proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'BW2 projection % lacks hardened stable definer posture',
        routine;
    END IF;
  END LOOP;
END
$$;

SELECT 'platform workflow case bindings inventory passed' AS result;
