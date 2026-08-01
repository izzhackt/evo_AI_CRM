\set ON_ERROR_STOP on

-- BW1 catalog/grant proof against the disposable migration-051 boundary.
DO $$
DECLARE
  expected_tables CONSTANT TEXT[] := ARRAY[
    'source_registry',
    'workflow_contract_version_sources',
    'workflow_contract_versions',
    'workflow_contracts'
  ];
  expected_policies CONSTANT TEXT[] := ARRAY[
    'source_registry_read',
    'workflow_contract_version_sources_read',
    'workflow_contract_versions_read',
    'workflow_contracts_read'
  ];
  actual TEXT[];
  violation TEXT;
  table_name TEXT;
  role_name TEXT;
  privilege_name TEXT;
BEGIN
  SELECT array_agg(t.table_name ORDER BY t.table_name)
  INTO actual
  FROM information_schema.tables AS t
  WHERE t.table_schema = 'platform'
    AND t.table_name = ANY (expected_tables)
    AND t.table_type = 'BASE TABLE';
  IF actual IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION 'BW1 table inventory mismatch: expected %, found %',
      expected_tables, actual;
  END IF;

  SELECT array_agg(policyname ORDER BY policyname)
  INTO actual
  FROM pg_policies
  WHERE schemaname = 'platform'
    AND tablename = ANY (expected_tables);
  IF actual IS DISTINCT FROM expected_policies THEN
    RAISE EXCEPTION 'BW1 policy inventory mismatch: expected %, found %',
      expected_policies, actual;
  END IF;

  SELECT string_agg(
    format('%I(owner=%I,rls=%s,forced=%s)', relation.relname,
      owner_role.rolname, relation.relrowsecurity, relation.relforcerowsecurity),
    ', ' ORDER BY relation.relname
  )
  INTO violation
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_roles AS owner_role ON owner_role.oid = relation.relowner
  WHERE namespace.nspname = 'platform'
    AND relation.relname = ANY (expected_tables)
    AND (
      owner_role.rolname <> 'postgres'
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    );
  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'BW1 tables must be postgres-owned with forced RLS: %',
      violation;
  END IF;

  FOREACH table_name IN ARRAY expected_tables LOOP
    IF NOT has_table_privilege('authenticated', 'platform.' || table_name, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated lacks SELECT on platform.%', table_name;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(role_name, 'platform.' || table_name, 'SELECT') THEN
        RAISE EXCEPTION '% unexpectedly has SELECT on platform.%',
          role_name, table_name;
      END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF has_table_privilege(
          role_name,
          'platform.' || table_name,
          privilege_name
        ) THEN
          RAISE EXCEPTION '% unexpectedly has % on platform.%',
            role_name, privilege_name, table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF (
    SELECT count(*) FROM platform.role_bundle_versions
    WHERE version = 7 AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'BW1 must publish exactly five immutable v7 bundles';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership."current_role" IS NOT NULL
      AND bundle.version <> 7
  ) THEN
    RAISE EXCEPTION 'Every extant authority must be upgraded to bundle v7';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 7
      AND bundle.role = 'student'
      AND permission.permission_key LIKE 'workflow.contract.%'
  ) OR (
    SELECT count(*)
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 7
      AND permission.permission_key = 'workflow.contract.read'
      AND bundle.role IN ('admin', 'sales', 'curator', 'finance')
  ) <> 4 OR NOT EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 7
      AND bundle.role = 'admin'
      AND permission.permission_key = 'workflow.contract.manage'
  ) THEN
    RAISE EXCEPTION 'BW1 v7 role permissions are not fail-closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'platform'
      AND column_info.table_name = 'student_cases'
      AND column_info.column_name = 'operational_stage'
      AND column_info.data_type = 'text'
      AND column_info.is_nullable = 'NO'
      AND column_info.column_default = '''contract_confirmed''::text'
  ) THEN
    RAISE EXCEPTION 'BW1 changed the existing student_cases operational_stage';
  END IF;

  IF NOT platform_private.is_safe_workflow_source_url(
    'google_document',
    'https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit'
  ) OR NOT platform_private.is_safe_workflow_source_url(
    'google_drive_file',
    'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view'
  ) OR platform_private.is_safe_workflow_source_url(
    'google_document',
    'https://person@example.com/document/d/1234567890'
  ) OR platform_private.is_safe_workflow_source_url(
    'google_document',
    'https://docs.google.com/document/d/1234567890/edit?token=secret'
  ) OR platform_private.is_safe_workflow_source_url(
    'google_document',
    'https://docs.google.com/document/d/1234567890/edit#person'
  ) OR platform_private.is_safe_workflow_source_url(
    'google_drive_file',
    'https://drive.google.com/drive/folders/customer-name'
  ) OR platform_private.is_safe_workflow_source_url(
    'repository_contract',
    'https://127.0.0.1/private'
  ) THEN
    RAISE EXCEPTION 'BW1 safe canonical source URL contract is incomplete';
  END IF;
END
$$;

DO $$
DECLARE
  routine REGPROCEDURE;
  role_name TEXT;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'platform.register_workflow_source(uuid,text,platform.workflow_source_kind,text,text,text,uuid)'::REGPROCEDURE,
    'platform.review_workflow_source(uuid,uuid,platform.workflow_source_review_status,text,uuid)'::REGPROCEDURE,
    'platform.retire_workflow_source(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.create_workflow_contract(uuid,text,platform.workflow_kind,text,uuid)'::REGPROCEDURE,
    'platform.create_workflow_contract_version(uuid,uuid,bigint,text[],text[],text[],text[],text,uuid)'::REGPROCEDURE,
    'platform.link_workflow_contract_version_source(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.approve_workflow_contract_version(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.retire_workflow_contract_version(uuid,uuid,text,uuid)'::REGPROCEDURE
  ] LOOP
    IF NOT has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly has EXECUTE on %', role_name, routine;
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = routine::OID
        AND prosecdef
        AND provolatile = 'v'
        AND proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'BW1 mutation RPC % lacks hardened definer posture', routine;
    END IF;
  END LOOP;
END
$$;

SELECT 'platform business workflow contract inventory passed' AS result;
