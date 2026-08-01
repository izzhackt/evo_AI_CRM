\set ON_ERROR_STOP on

-- BW3 catalog/ACL proof at the exact migration-053 boundary.
DO $$
DECLARE
  checked_table_name TEXT;
  relation REGCLASS;
  role_name TEXT;
  privilege_name TEXT;
  routine REGPROCEDURE;
  mutation_routines REGPROCEDURE[] := ARRAY[
    'platform.create_country_requirement_version(uuid,text,text,text,bigint,platform.student_profile_field[],text,uuid)'::REGPROCEDURE,
    'platform.link_country_requirement_version_source(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.approve_country_requirement_version(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.retire_country_requirement_version(uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.apply_country_requirement_version(uuid,uuid,uuid,text,uuid)'::REGPROCEDURE,
    'platform.upsert_student_profile(uuid,uuid,bigint,text,text,date,text,text,text,text,text,text,text,text[],platform.student_profile_consent_status,text,text,text,uuid)'::REGPROCEDURE
  ];
  read_routines REGPROCEDURE[] := ARRAY[
    'platform.staff_student_profile_snapshot(uuid)'::REGPROCEDURE,
    'platform.staff_student_case_documents(uuid)'::REGPROCEDURE,
    'platform.staff_country_requirement_versions_for_case(uuid)'::REGPROCEDURE,
    'platform.student_portal_profile()'::REGPROCEDURE
  ];
BEGIN
  FOREACH checked_table_name IN ARRAY ARRAY[
    'student_profiles',
    'country_requirement_versions',
    'country_requirement_version_sources'
  ] LOOP
    relation := format('platform.%I', checked_table_name)::REGCLASS;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS catalog_relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = catalog_relation.relnamespace
      JOIN pg_roles AS owner_role ON owner_role.oid = catalog_relation.relowner
      WHERE catalog_relation.oid = relation
        AND namespace.nspname = 'platform'
        AND catalog_relation.relkind = 'r'
        AND owner_role.rolname = 'postgres'
        AND catalog_relation.relrowsecurity
        AND catalog_relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION
        'BW3 table platform.% must be postgres-owned with forced RLS',
        checked_table_name;
    END IF;

    IF NOT has_table_privilege('authenticated', relation, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated lacks SELECT on platform.%',
        checked_table_name;
    END IF;

    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_table_privilege(role_name, relation, 'SELECT') THEN
        RAISE EXCEPTION '% unexpectedly has SELECT on platform.%',
          role_name, checked_table_name;
      END IF;
    END LOOP;

    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF has_table_privilege(role_name, relation, privilege_name) THEN
          RAISE EXCEPTION '% unexpectedly has % on platform.%',
            role_name, privilege_name, checked_table_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF (
    SELECT array_agg(policyname::TEXT ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'platform'
      AND tablename = 'student_profiles'
  ) IS DISTINCT FROM ARRAY['student_profiles_read']::TEXT[] THEN
    RAISE EXCEPTION 'BW3 Student Profile RLS policy inventory drifted';
  END IF;

  IF (
    SELECT array_agg(policyname::TEXT ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'platform'
      AND tablename = 'country_requirement_versions'
  ) IS DISTINCT FROM
    ARRAY['country_requirement_versions_admin_read']::TEXT[] THEN
    RAISE EXCEPTION 'BW3 country version RLS policy inventory drifted';
  END IF;

  IF (
    SELECT array_agg(policyname::TEXT ORDER BY policyname)
    FROM pg_policies
    WHERE schemaname = 'platform'
      AND tablename = 'country_requirement_version_sources'
  ) IS DISTINCT FROM
    ARRAY['country_requirement_version_sources_admin_read']::TEXT[] THEN
    RAISE EXCEPTION 'BW3 country source-link RLS policy inventory drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'student_cases'
      AND column_name = 'applied_country_requirement_version_id'
      AND is_nullable = 'YES'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION 'BW3 nullable case country requirement binding is missing';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel::TEXT ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'student_profile_consent_status'
  ) IS DISTINCT FROM ARRAY[
    'not_recorded', 'granted', 'withdrawn'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW3 consent enum drifted';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel::TEXT ORDER BY enum_value.enumsortorder)
    FROM pg_type AS enum_type
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    WHERE namespace.nspname = 'platform'
      AND enum_type.typname = 'student_profile_field'
  ) IS DISTINCT FROM ARRAY[
    'preferred_display_name',
    'legal_display_name',
    'communication_language',
    'date_of_birth',
    'citizenship_country',
    'residency_country',
    'current_education_summary',
    'academic_summary',
    'language_summary',
    'budget_band',
    'decision_participant_labels',
    'consent_status',
    'consent_evidence_ref',
    'next_step'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'BW3 Student Profile field enum drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'student_profiles'
      AND column_name = 'revision'
      AND is_nullable = 'NO'
      AND data_type = 'bigint'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'country_requirement_versions'
      AND column_name = 'required_profile_fields'
      AND is_nullable = 'NO'
      AND udt_name = '_student_profile_field'
  ) THEN
    RAISE EXCEPTION 'BW3 typed profile/version columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'platform.student_profiles'::REGCLASS
      AND conname = 'student_profiles_organization_case_key'
      AND contype = 'u'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'platform.country_requirement_versions'::REGCLASS
      AND conname = 'country_requirement_versions_route_version_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'BW3 case/route uniqueness contracts are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'platform.student_cases'::REGCLASS
      AND tgname = 'student_cases_country_requirement_binding_guard'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'platform.document_requirements'::REGCLASS
      AND tgname = 'document_requirements_approved_manifest_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'BW3 immutable binding/manifest guards are missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'private.platform_can_read_student_portal_case(uuid,uuid)'::REGPROCEDURE,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated cannot evaluate BW3 self-profile RLS';
  END IF;

  FOREACH routine IN ARRAY mutation_routines LOOP
    IF NOT has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks BW3 mutation EXECUTE on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly has BW3 mutation EXECUTE on %',
          role_name, routine;
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = routine::OID
        AND prosecdef
        AND provolatile = 'v'
        AND proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'BW3 mutation % lacks hardened volatile definer posture',
        routine;
    END IF;
  END LOOP;

  FOREACH routine IN ARRAY read_routines LOOP
    IF NOT has_function_privilege('authenticated', routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks BW3 read EXECUTE on %', routine;
    END IF;
    FOREACH role_name IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(role_name, routine, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly has BW3 read EXECUTE on %',
          role_name, routine;
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE oid = routine::OID
        AND prosecdef
        AND provolatile = 's'
        AND proconfig @> ARRAY['search_path=""']::TEXT[]
    ) THEN
      RAISE EXCEPTION 'BW3 read % lacks hardened stable definer posture',
        routine;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 8
      AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'BW3 must publish exactly five immutable v8 bundles';
  END IF;

  IF EXISTS (
    SELECT expected.role, expected.permission_key
    FROM (VALUES
      ('admin'::platform.business_role, 'profile.read.full'::TEXT),
      ('admin'::platform.business_role, 'profile.manage'::TEXT),
      ('admin'::platform.business_role, 'profile.read.self'::TEXT),
      ('admin'::platform.business_role, 'country.requirement.manage'::TEXT),
      ('sales'::platform.business_role, 'profile.read.full'::TEXT),
      ('sales'::platform.business_role, 'profile.manage'::TEXT),
      ('sales'::platform.business_role, 'profile.read.self'::TEXT),
      ('curator'::platform.business_role, 'profile.read.full'::TEXT),
      ('curator'::platform.business_role, 'profile.manage'::TEXT),
      ('curator'::platform.business_role, 'profile.read.self'::TEXT),
      ('finance'::platform.business_role, 'profile.read.self'::TEXT),
      ('student'::platform.business_role, 'profile.read.self'::TEXT)
    ) AS expected(role, permission_key)
    EXCEPT
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 8
  ) OR EXISTS (
    SELECT bundle.role, permission.permission_key
    FROM platform.role_bundle_versions AS bundle
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
    WHERE bundle.version = 8
      AND permission.permission_key IN (
        'profile.read.full',
        'profile.manage',
        'profile.read.self',
        'country.requirement.manage'
      )
    EXCEPT
    SELECT expected.role, expected.permission_key
    FROM (VALUES
      ('admin'::platform.business_role, 'profile.read.full'::TEXT),
      ('admin'::platform.business_role, 'profile.manage'::TEXT),
      ('admin'::platform.business_role, 'profile.read.self'::TEXT),
      ('admin'::platform.business_role, 'country.requirement.manage'::TEXT),
      ('sales'::platform.business_role, 'profile.read.full'::TEXT),
      ('sales'::platform.business_role, 'profile.manage'::TEXT),
      ('sales'::platform.business_role, 'profile.read.self'::TEXT),
      ('curator'::platform.business_role, 'profile.read.full'::TEXT),
      ('curator'::platform.business_role, 'profile.manage'::TEXT),
      ('curator'::platform.business_role, 'profile.read.self'::TEXT),
      ('finance'::platform.business_role, 'profile.read.self'::TEXT),
      ('student'::platform.business_role, 'profile.read.self'::TEXT)
    ) AS expected(role, permission_key)
  ) THEN
    RAISE EXCEPTION 'BW3 v8 effective permission matrix drifted';
  END IF;

  IF EXISTS (
    SELECT v8.role, permission.permission_key
    FROM platform.role_bundle_versions AS v8
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v8.id
      AND permission.bundle_role = v8.role
    WHERE v8.version = 8
      AND permission.permission_key NOT IN (
        'profile.read.full', 'profile.manage', 'profile.read.self',
        'country.requirement.manage'
      )
    EXCEPT
    SELECT v7.role, permission.permission_key
    FROM platform.role_bundle_versions AS v7
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v7.id
      AND permission.bundle_role = v7.role
    WHERE v7.version = 7
  ) OR EXISTS (
    SELECT v7.role, permission.permission_key
    FROM platform.role_bundle_versions AS v7
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v7.id
      AND permission.bundle_role = v7.role
    WHERE v7.version = 7
    EXCEPT
    SELECT v8.role, permission.permission_key
    FROM platform.role_bundle_versions AS v8
    JOIN platform.role_bundle_permissions AS permission
      ON permission.bundle_id = v8.id
      AND permission.bundle_role = v8.role
    WHERE v8.version = 8
  ) THEN
    RAISE EXCEPTION 'BW3 v8 bundles did not clone the complete v7 baseline';
  END IF;
END
$$;

SELECT 'platform Student Profile requirements inventory passed' AS result;
