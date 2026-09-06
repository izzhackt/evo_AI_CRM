\set ON_ERROR_STOP on

-- Focused current-boundary acceptance for migration 118. The synthetic
-- organization, identities and cases exist only inside this rolled-back
-- transaction.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p118_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 118 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p118_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p118_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p118_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  routine_oid OID;
  routine_count INTEGER;
  helper_oid OID;
  helper_count INTEGER;
  helper_name TEXT;
  forbidden_role TEXT;
  expected_signature TEXT;
  expected_defaults INTEGER;
  rpc_name TEXT;
  projection_name TEXT;
  geography_column TEXT;
BEGIN
  -- Both columns are nullable TEXT without defaults; the value dictionary
  -- lives in the interface wording layer, never as a schema enum.
  FOREACH geography_column IN ARRAY ARRAY['country', 'degree'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'platform'
        AND table_name = 'university_applications'
        AND column_name = geography_column
        AND data_type = 'text'
        AND is_nullable = 'YES'
        AND column_default IS NULL
    ) THEN
      RAISE EXCEPTION
        'university_applications.% TEXT NULL is missing', geography_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS custom_type
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = custom_type.typnamespace
    WHERE namespace.nspname = 'platform'
      AND custom_type.typname IN ('case_degree', 'application_degree')
  ) THEN
    RAISE EXCEPTION 'migration 118 introduced a second schema degree dictionary';
  END IF;

  IF pg_catalog.to_regclass(
    'platform.university_applications_one_primary_per_case_idx'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid =
      'platform.university_applications_one_primary_per_case_idx'::REGCLASS
      AND index_row.indisunique
      AND pg_catalog.pg_get_expr(
        index_row.indpred,
        index_row.indrelid
      ) = 'is_primary'
  ) THEN
    RAISE EXCEPTION 'one-primary partial unique index is missing';
  END IF;

  FOR rpc_name, expected_signature IN
    SELECT * FROM (VALUES
      (
        'create_university_application',
        'p_organization_id uuid, p_student_case_id uuid, p_institution_name text, p_program_name text, p_status platform.application_status, p_evidence_reference text, p_note text, p_is_primary boolean, p_university_deadline_on date, p_country text, p_degree text, p_expected_version bigint, p_request_id uuid'
      ),
      (
        'create_catalog_university_application',
        'p_organization_id uuid, p_student_case_id uuid, p_catalog_institution_id uuid, p_program_name text, p_status platform.application_status, p_evidence_reference text, p_note text, p_is_primary boolean, p_university_deadline_on date, p_country text, p_degree text, p_expected_version bigint, p_request_id uuid'
      ),
      (
        'update_university_application_details',
        'p_organization_id uuid, p_university_application_id uuid, p_is_primary boolean, p_university_deadline_on date, p_country text, p_degree text, p_expected_version bigint, p_request_id uuid'
      )
    ) AS expected(rpc_name, expected_signature)
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = rpc_name;

    IF routine_count <> 1
      OR routine_oid IS NULL
      OR pg_get_function_identity_arguments(routine_oid) <> expected_signature
    THEN
      RAISE EXCEPTION 'platform.% signature or single-path contract drifted', rpc_name;
    END IF;

    IF NOT COALESCE((
      SELECT NOT routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.prokind = 'f'
        AND NOT routine.proretset
        AND pg_get_function_result(routine.oid) = 'jsonb'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND routine.pronargdefaults = 0
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = routine_oid
    ), FALSE) THEN
      RAISE EXCEPTION 'platform.% execution contract drifted', rpc_name;
    END IF;

    helper_name := 'platform_' || rpc_name;
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO helper_count, helper_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = helper_name;

    IF helper_count <> 1
      OR helper_oid IS NULL
      OR pg_get_function_identity_arguments(helper_oid) <> expected_signature
    THEN
      RAISE EXCEPTION 'private.% signature or single-path contract drifted',
        helper_name;
    END IF;

    IF NOT COALESCE((
      SELECT routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.prokind = 'f'
        AND NOT routine.proretset
        AND pg_get_function_result(routine.oid) = 'jsonb'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND routine.pronargdefaults = 0
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = helper_oid
    ), FALSE) THEN
      RAISE EXCEPTION 'private.% execution contract drifted', helper_name;
    END IF;

    IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(routine_oid),
      'private.' || helper_name
    ) = 0 THEN
      RAISE EXCEPTION 'platform.% does not delegate to private.%',
        rpc_name, helper_name;
    END IF;

    IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(helper_oid),
      'ORDER BY application.id'
    ) = 0 OR pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(helper_oid),
      'FOR UPDATE'
    ) = 0 THEN
      RAISE EXCEPTION 'private.% lost deterministic primary-switch locking',
        helper_name;
    END IF;

    IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'authenticated lacks wrapper/helper EXECUTE for %', rpc_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes platform.%',
          forbidden_role, rpc_name;
      END IF;
      IF has_function_privilege(forbidden_role, helper_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes private.%',
          forbidden_role, helper_name;
      END IF;
    END LOOP;
  END LOOP;

  -- Both staff projections expose the exact application-level facts.
  FOR projection_name, expected_signature, expected_defaults IN
    SELECT * FROM (VALUES
      (
        'staff_application_page',
        'p_limit integer, p_before_updated_at timestamp with time zone, p_before_application_id uuid, p_status platform.application_status, p_student_case_id uuid, p_application_id uuid',
        5
      ),
      (
        'staff_application_snapshot',
        'p_university_application_id uuid',
        0
      )
    ) AS expected(projection_name, expected_signature, expected_defaults)
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = projection_name;

    helper_name := 'platform_' || projection_name;
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO helper_count, helper_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = helper_name;

    IF routine_count <> 1
      OR helper_count <> 1
      OR routine_oid IS NULL
      OR helper_oid IS NULL
      OR pg_get_function_identity_arguments(routine_oid) <> expected_signature
      OR pg_get_function_identity_arguments(helper_oid) <> expected_signature
    THEN
      RAISE EXCEPTION '% projection wrapper/helper signature drifted',
        projection_name;
    END IF;

    IF NOT COALESCE((
      SELECT NOT wrapper.prosecdef
        AND wrapper.provolatile = 's'
        AND wrapper.proretset
        AND wrapper.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND wrapper.pronargdefaults = expected_defaults
        AND helper.prosecdef
        AND helper.provolatile = 's'
        AND helper.proretset
        AND helper.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND helper.pronargdefaults = expected_defaults
      FROM pg_catalog.pg_proc AS wrapper
      JOIN pg_catalog.pg_proc AS helper ON helper.oid = helper_oid
      WHERE wrapper.oid = routine_oid
    ), FALSE) THEN
      RAISE EXCEPTION '% projection execution contract drifted', projection_name;
    END IF;

    IF pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(routine_oid),
      'private.' || helper_name
    ) = 0 THEN
      RAISE EXCEPTION 'platform.% does not delegate to private.%',
        projection_name, helper_name;
    END IF;

    IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'authenticated lacks projection wrapper/helper EXECUTE for %',
        projection_name;
    END IF;
    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE')
        OR has_function_privilege(forbidden_role, helper_oid, 'EXECUTE')
      THEN
        RAISE EXCEPTION '% unexpectedly executes % projection wrapper/helper',
          forbidden_role, projection_name;
      END IF;
    END LOOP;

    FOREACH geography_column IN ARRAY ARRAY['country', 'degree'] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.parameters
        WHERE specific_schema = 'platform'
          AND specific_name LIKE projection_name || '_%'
          AND parameter_mode = 'OUT'
          AND parameter_name = geography_column
          AND data_type = 'text'
      ) THEN
        RAISE EXCEPTION
          'platform.% lacks the migration 118 % fact',
          projection_name, geography_column;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.has_table_privilege(
    'authenticated',
    'platform.university_applications',
    'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'authenticated',
    'platform.university_applications',
    'INSERT'
  ) THEN
    RAISE EXCEPTION 'authenticated unexpectedly mutates applications directly';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('university_applications'),
      ('university_application_events'),
      ('audit_events')
    ) AS expected(table_name)
    LEFT JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = 'platform'
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.relnamespace = namespace.oid
      AND relation.relname = expected.table_name
    WHERE relation.oid IS NULL
      OR NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'application/audit tables lost ENABLE/FORCE RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('university_application_events', 'university_application_events_append_only'),
      ('university_application_events', 'university_application_events_no_truncate'),
      ('audit_events', 'audit_events_append_only_rows'),
      ('audit_events', 'audit_events_append_only_truncate')
    ) AS expected(table_name, trigger_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = expected.table_name
        AND trigger.tgname = expected.trigger_name
        AND NOT trigger.tgisinternal
        AND trigger.tgenabled <> 'D'
    )
  ) THEN
    RAISE EXCEPTION 'application/audit append-only trigger contract drifted';
  END IF;
END
$catalog_contract$;

-- Resolve the currently published bundles that carry application.manage.
SELECT bundle.id AS p118_admin_bundle, bundle.version AS p118_admin_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p118_sales_bundle, bundle.version AS p118_sales_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p118_curator_bundle, bundle.version AS p118_curator_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'curator'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p118_student_bundle, bundle.version AS p118_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p118_org 59911800-0000-4000-8000-000000000001
\set p118_other_org 59911800-0000-4000-8000-000000000002
\set p118_org_scope 59911800-0000-4000-8000-000000000003
\set p118_case_scope 59911800-0000-4000-8000-000000000004
\set p118_case 59911800-0000-4000-8000-000000000005
\set p118_case_scope_v2 59911800-0000-4000-8000-000000000006
\set p118_admin_user 59911800-0000-4000-8000-000000000011
\set p118_sales_user 59911800-0000-4000-8000-000000000012
\set p118_curator_user 59911800-0000-4000-8000-000000000013
\set p118_student_user 59911800-0000-4000-8000-000000000014
\set p118_admin_profile 59911800-0000-4000-8000-000000000021
\set p118_sales_profile 59911800-0000-4000-8000-000000000022
\set p118_curator_profile 59911800-0000-4000-8000-000000000023
\set p118_student_profile 59911800-0000-4000-8000-000000000024
\set p118_admin_membership 59911800-0000-4000-8000-000000000031
\set p118_sales_membership 59911800-0000-4000-8000-000000000032
\set p118_curator_membership 59911800-0000-4000-8000-000000000033
\set p118_student_membership 59911800-0000-4000-8000-000000000034
\set p118_source_key src_59911800000040008000000000000001
\set p118_source_record_key rec_59911800000040008000000000000001

INSERT INTO platform.organizations (id, name) VALUES
  (:'p118_org', 'Migration 118 Organization'),
  (:'p118_other_org', 'Migration 118 Other Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p118_org_scope', :'p118_org', 'organization', :'p118_org', 1),
  (:'p118_case_scope', :'p118_org', 'student_case', :'p118_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p118_admin_user', 'p118-admin@example.invalid', '{}'::JSONB),
  (:'p118_sales_user', 'p118-sales@example.invalid', '{}'::JSONB),
  (:'p118_curator_user', 'p118-curator@example.invalid', '{}'::JSONB),
  (:'p118_student_user', 'p118-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p118_admin_profile', :'p118_admin_user', 'Migration 118 Admin', 'active', 1),
  (:'p118_sales_profile', :'p118_sales_user', 'Migration 118 Sales', 'active', 1),
  (:'p118_curator_profile', :'p118_curator_user', 'Migration 118 Curator', 'active', 1),
  (:'p118_student_profile', :'p118_student_user', 'Migration 118 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p118_admin_membership', :'p118_org', :'p118_admin_profile', 'active', 'admin', :'p118_admin_bundle'),
  (:'p118_sales_membership', :'p118_org', :'p118_sales_profile', 'active', 'sales', :'p118_sales_bundle'),
  (:'p118_curator_membership', :'p118_org', :'p118_curator_profile', 'active', 'curator', :'p118_curator_bundle'),
  (:'p118_student_membership', :'p118_org', :'p118_student_profile', 'active', 'student', :'p118_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911800-0000-4000-8000-000000000041', :'p118_org', :'p118_admin_membership', :'p118_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 118 Admin org scope', '59911800-0000-4000-8000-000000000141'),
  ('59911800-0000-4000-8000-000000000043', :'p118_org', :'p118_sales_membership', :'p118_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 118 Sales org scope', '59911800-0000-4000-8000-000000000143'),
  ('59911800-0000-4000-8000-000000000042', :'p118_org', :'p118_sales_membership', :'p118_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 118 Sales case scope', '59911800-0000-4000-8000-000000000142'),
  ('59911800-0000-4000-8000-000000000045', :'p118_org', :'p118_curator_membership', :'p118_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 118 Curator org scope', '59911800-0000-4000-8000-000000000145'),
  ('59911800-0000-4000-8000-000000000044', :'p118_org', :'p118_student_membership', :'p118_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 118 Student case scope', '59911800-0000-4000-8000-000000000144');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p118_case', :'p118_org', :'p118_student_membership',
  :'p118_sales_membership', NULL,
  'synthetic:p118:case', 'contract:p118', '2026-09-06T09:00:00Z',
  'Migration 118 Student', 'Malaysia', 'Bachelor', 'Business',
  '2031', 'approved', 'contract_confirmed', 'pending', NULL, NULL,
  'Verify application geography', :'p118_case_scope', 1
);

-- The database invariant itself rejects malformed geography values even when
-- a privileged writer bypasses the RPCs.
SELECT pg_temp.p118_capture_error(format(
  'INSERT INTO platform.university_applications ('
    || 'organization_id, student_case_id, institution_name, program_name, '
    || 'status, created_by_membership_id, version, country'
    || ') VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
  :'p118_org', :'p118_case', 'Invariant University', 'History',
  'preparation', :'p118_sales_membership', 'my'
))::TEXT AS p118_lowercase_country_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'INSERT INTO platform.university_applications ('
    || 'organization_id, student_case_id, institution_name, program_name, '
    || 'status, created_by_membership_id, version, country'
    || ') VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
  :'p118_org', :'p118_case', 'Invariant University', 'History',
  'preparation', :'p118_sales_membership', 'MYS'
))::TEXT AS p118_long_country_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'INSERT INTO platform.university_applications ('
    || 'organization_id, student_case_id, institution_name, program_name, '
    || 'status, created_by_membership_id, version, country'
    || ') VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
  :'p118_org', :'p118_case', 'Invariant University', 'History',
  'preparation', :'p118_sales_membership', 'ZZ'
))::TEXT AS p118_unlisted_country_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'INSERT INTO platform.university_applications ('
    || 'organization_id, student_case_id, institution_name, program_name, '
    || 'status, created_by_membership_id, version, degree'
    || ') VALUES (%L, %L, %L, %L, %L, %L, 1, %L)',
  :'p118_org', :'p118_case', 'Invariant University', 'History',
  'preparation', :'p118_sales_membership', ' bachelor'
))::TEXT AS p118_padded_degree_error
\gset
SELECT pg_temp.p118_assert(
  :'p118_lowercase_country_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p118_long_country_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p118_unlisted_country_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p118_padded_degree_error'::JSONB ->> 'sqlstate' = '23514',
  'university_applications geography CHECK constraints drifted'
);

SELECT jsonb_build_object(
  'sub', :'p118_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p118_org',
  'platform_membership_id', :'p118_admin_membership',
  'platform_bundle_id', :'p118_admin_bundle',
  'platform_bundle_version', :'p118_admin_version'::INTEGER
)::TEXT AS p118_admin_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p118_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p118_org',
  'platform_membership_id', :'p118_sales_membership',
  'platform_bundle_id', :'p118_sales_bundle',
  'platform_bundle_version', :'p118_sales_version'::INTEGER
)::TEXT AS p118_sales_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p118_curator_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1,
  'platform_organization_id', :'p118_org',
  'platform_membership_id', :'p118_curator_membership',
  'platform_bundle_id', :'p118_curator_bundle',
  'platform_bundle_version', :'p118_curator_version'::INTEGER
)::TEXT AS p118_curator_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p118_student_user', 'role', 'authenticated',
  'platform_role', 'student', 'platform_access_version', 1,
  'platform_organization_id', :'p118_org',
  'platform_membership_id', :'p118_student_membership',
  'platform_bundle_id', :'p118_student_bundle',
  'platform_bundle_version', :'p118_student_version'::INTEGER
)::TEXT AS p118_student_claims
\gset

-- Build an approved catalog institution through the real catalog workflow.
SET request.jwt.claims TO :'p118_admin_claims';
SET ROLE authenticated;

SELECT platform.register_workflow_source(
  :'p118_org', :'p118_source_key', 'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1P118CatalogSheetFixture000000001/edit',
  'p118revisioncatalog1', 'Register migration 118 catalog source',
  '59911800-0000-4000-8000-000000000151'
)::TEXT AS p118_source_id
\gset
SELECT platform.review_workflow_source(
  :'p118_org', :'p118_source_id', 'reviewed',
  'Review migration 118 catalog source',
  '59911800-0000-4000-8000-000000000152'
);
SELECT platform.create_catalog_import_batch(
  :'p118_org', :'p118_source_id', 'university',
  'Create migration 118 catalog batch',
  '59911800-0000-4000-8000-000000000153'
)::TEXT AS p118_catalog_batch
\gset
SELECT
  (:'p118_catalog_batch'::JSONB ->> 'catalog_import_batch_id')::UUID
    AS p118_catalog_import_batch
\gset
SELECT platform.stage_catalog_import_candidate(
  :'p118_org', :'p118_catalog_import_batch', :'p118_source_record_key',
  'Migration 118 University', 'MY', 'Kuala Lumpur',
  'Stage migration 118 catalog institution',
  '59911800-0000-4000-8000-000000000154'
);
SELECT platform.validate_catalog_import_batch(
  :'p118_org', :'p118_catalog_import_batch',
  'Validate migration 118 catalog batch',
  '59911800-0000-4000-8000-000000000155'
);
SELECT platform.review_catalog_import_batch(
  :'p118_org', :'p118_catalog_import_batch', 'approve',
  'Approve migration 118 catalog batch',
  '59911800-0000-4000-8000-000000000156'
);

RESET ROLE;
SELECT institution.id AS p118_catalog_institution
FROM platform.catalog_institutions AS institution
WHERE institution.organization_id = :'p118_org'
  AND institution.import_batch_id = :'p118_catalog_import_batch'
ORDER BY institution.id
LIMIT 1
\gset

-- Sales owns the pending case: create with geography and replay exactly.
SET request.jwt.claims TO :'p118_sales_claims';
SET ROLE authenticated;

SELECT platform.create_university_application(
  p_organization_id => :'p118_org',
  p_student_case_id => :'p118_case',
  p_institution_name => 'Geography University',
  p_program_name => 'Economics',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Initial geography',
  p_is_primary => TRUE,
  p_university_deadline_on => '2031-10-09',
  p_country => 'MY',
  p_degree => 'bachelor',
  p_expected_version => 0,
  p_request_id => '59911800-0000-4000-8000-000000000201'
)::TEXT AS p118_first_create
\gset
SELECT platform.create_university_application(
  :'p118_org', :'p118_case', 'Geography University', 'Economics',
  'preparation', NULL, 'Initial geography', TRUE, '2031-10-09', 'MY',
  'bachelor', 0, '59911800-0000-4000-8000-000000000201'
)::TEXT AS p118_first_replay
\gset
SELECT :'p118_first_create'::JSONB ->> 'university_application_id'
  AS p118_first_application
\gset

-- Idempotency is actor-bound: an equally authorized Admin cannot claim the
-- Sales actor's successful manual-create receipt with the same request id.
SET request.jwt.claims TO :'p118_admin_claims';
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, %L, TRUE, %L::DATE, %L, %L, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Geography University', 'Economics',
  'preparation', 'Initial geography', '2031-10-09', 'MY', 'bachelor',
  '59911800-0000-4000-8000-000000000201'
))::TEXT AS p118_manual_create_cross_actor_error
\gset
SELECT pg_temp.p118_assert(
  :'p118_manual_create_cross_actor_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_manual_create_cross_actor_error'::JSONB ->> 'message'
      LIKE '%already used for another mutation%',
  'manual-create request replay crossed the authenticated actor boundary'
);
SET request.jwt.claims TO :'p118_sales_claims';

-- Whitespace-only geography normalizes to NULL exactly like other optional
-- text facts, and stays absent from the stored row.
SELECT platform.create_university_application(
  :'p118_org', :'p118_case', 'No Geography University', 'History',
  'preparation', NULL, 'Empty geography', FALSE, NULL, '  ', '  ', 0,
  '59911800-0000-4000-8000-000000000202'
)::TEXT AS p118_blank_create
\gset
SELECT :'p118_blank_create'::JSONB ->> 'university_application_id'
  AS p118_blank_application
\gset

SELECT platform.create_catalog_university_application(
  p_organization_id => :'p118_org',
  p_student_case_id => :'p118_case',
  p_catalog_institution_id => :'p118_catalog_institution',
  p_program_name => 'Data Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Catalog geography',
  p_is_primary => FALSE,
  p_university_deadline_on => NULL,
  p_country => 'CN',
  p_degree => 'master',
  p_expected_version => 0,
  p_request_id => '59911800-0000-4000-8000-000000000203'
)::TEXT AS p118_catalog_create
\gset
SELECT platform.create_catalog_university_application(
  :'p118_org', :'p118_case', :'p118_catalog_institution', 'Data Science',
  'preparation', NULL, 'Catalog geography', FALSE, NULL, 'CN', 'master', 0,
  '59911800-0000-4000-8000-000000000203'
)::TEXT AS p118_catalog_replay
\gset
SELECT :'p118_catalog_create'::JSONB ->> 'university_application_id'
  AS p118_catalog_application
\gset

-- A replay of the same request with different geography must conflict.
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, %L, TRUE, %L::DATE, %L, %L, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Geography University', 'Economics',
  'preparation', 'Initial geography', '2031-10-09', 'AE', 'bachelor',
  '59911800-0000-4000-8000-000000000201'
))::TEXT AS p118_replay_conflict
\gset

-- Malformed or unlisted country and degree values fail closed before any write.
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, %L, NULL, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Invalid Country University', 'History',
  'preparation', 'ZZ', '59911800-0000-4000-8000-000000000204'
))::TEXT AS p118_invalid_country_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, %L, NULL, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Invalid Country University', 'History',
  'preparation', 'my', '59911800-0000-4000-8000-000000000205'
))::TEXT AS p118_lowercase_rpc_country_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, NULL, %L, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Invalid Degree University', 'History',
  'preparation', repeat('d', 161), '59911800-0000-4000-8000-000000000206'
))::TEXT AS p118_long_degree_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_catalog_university_application(%L::UUID, %L::UUID, '
    || '%L::UUID, %L, %L::platform.application_status, NULL, NULL, FALSE, '
    || 'NULL, %L, NULL, 0, %L::UUID)',
  :'p118_org', :'p118_case', :'p118_catalog_institution', 'Analytics',
  'preparation', 'AA', '59911800-0000-4000-8000-000000000207'
))::TEXT AS p118_catalog_invalid_country_error
\gset

RESET ROLE;
SELECT pg_temp.p118_assert(
  :'p118_first_create'::JSONB = :'p118_first_replay'::JSONB
    AND :'p118_catalog_create'::JSONB = :'p118_catalog_replay'::JSONB
    AND :'p118_first_create'::JSONB ->> 'actor_membership_id'
      = :'p118_sales_membership'
    AND :'p118_first_create'::JSONB ->> 'country' = 'MY'
    AND :'p118_first_create'::JSONB ->> 'degree' = 'bachelor'
    AND :'p118_catalog_create'::JSONB ->> 'country' = 'CN'
    AND :'p118_catalog_create'::JSONB ->> 'degree' = 'master'
    AND :'p118_blank_create'::JSONB -> 'country' = 'null'::JSONB
    AND :'p118_blank_create'::JSONB -> 'degree' = 'null'::JSONB
    AND :'p118_replay_conflict'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_replay_conflict'::JSONB ->> 'message'
      LIKE '%already used for another mutation%'
    AND :'p118_invalid_country_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_lowercase_rpc_country_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_long_degree_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_catalog_invalid_country_error'::JSONB ->> 'sqlstate' = '22023',
  'create geography echo, normalization, replay or validation drifted'
);
SELECT pg_temp.p118_assert(
  (
    SELECT application.country = 'MY' AND application.degree = 'bachelor'
    FROM platform.university_applications AS application
    WHERE application.id = :'p118_first_application'
  ) AND (
    SELECT application.country IS NULL AND application.degree IS NULL
    FROM platform.university_applications AS application
    WHERE application.id = :'p118_blank_application'
  ) AND (
    SELECT application.country = 'CN' AND application.degree = 'master'
    FROM platform.university_applications AS application
    WHERE application.id = :'p118_catalog_application'
  ),
  'stored application geography drifted from the command echo'
);

-- Details command: geography-only change bumps the version, replays exactly,
-- and a same-values call is a rejected no-op.
SELECT count(*) AS p118_status_event_count_before
FROM platform.university_application_events
WHERE organization_id = :'p118_org'
  AND student_case_id = :'p118_case'
\gset

SET ROLE authenticated;
SELECT platform.update_university_application_details(
  p_organization_id => :'p118_org',
  p_university_application_id => :'p118_first_application',
  p_is_primary => TRUE,
  p_university_deadline_on => '2031-10-09',
  p_country => 'TR',
  p_degree => 'foundation',
  p_expected_version => 1,
  p_request_id => '59911800-0000-4000-8000-000000000208'
)::TEXT AS p118_details_update
\gset
SELECT platform.update_university_application_details(
  :'p118_org', :'p118_first_application', TRUE, '2031-10-09', 'TR',
  'foundation', 1, '59911800-0000-4000-8000-000000000208'
)::TEXT AS p118_details_replay
\gset

-- Details-update replay is actor-bound under the same request id as well.
SET request.jwt.claims TO :'p118_admin_claims';
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 1, %L::UUID)',
  :'p118_org', :'p118_first_application', '2031-10-09', 'TR', 'foundation',
  '59911800-0000-4000-8000-000000000208'
))::TEXT AS p118_details_cross_actor_error
\gset
SELECT pg_temp.p118_assert(
  :'p118_details_cross_actor_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_details_cross_actor_error'::JSONB ->> 'message'
      LIKE '%already used for another mutation%',
  'details-update request replay crossed the authenticated actor boundary'
);
SET request.jwt.claims TO :'p118_sales_claims';

SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 2, %L::UUID)',
  :'p118_org', :'p118_first_application', '2031-10-09', 'TR', 'foundation',
  '59911800-0000-4000-8000-000000000209'
))::TEXT AS p118_details_noop_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 1, %L::UUID)',
  :'p118_org', :'p118_first_application', '2031-10-09', 'AE', 'foundation',
  '59911800-0000-4000-8000-000000000210'
))::TEXT AS p118_details_stale_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 2, %L::UUID)',
  :'p118_org', :'p118_first_application', '2031-10-09', 'ZZ', 'foundation',
  '59911800-0000-4000-8000-000000000211'
))::TEXT AS p118_details_invalid_country_error
\gset

RESET ROLE;
SELECT pg_temp.p118_assert(
  :'p118_details_update'::JSONB = :'p118_details_replay'::JSONB
    AND :'p118_details_update'::JSONB ->> 'actor_membership_id'
      = :'p118_sales_membership'
    AND :'p118_details_update'::JSONB ->> 'version' = '2'
    AND :'p118_details_update'::JSONB ->> 'country' = 'TR'
    AND :'p118_details_update'::JSONB ->> 'degree' = 'foundation'
    AND :'p118_details_noop_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p118_details_stale_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p118_details_invalid_country_error'::JSONB ->> 'sqlstate' = '22023'
    AND (
      SELECT application.country = 'TR'
        AND application.degree = 'foundation'
        AND application.version = 2
      FROM platform.university_applications AS application
      WHERE application.id = :'p118_first_application'
    )
    AND (
      SELECT count(*)
      FROM platform.university_application_events
      WHERE organization_id = :'p118_org'
        AND student_case_id = :'p118_case'
    ) = :'p118_status_event_count_before'::BIGINT,
  'details geography update, replay, no-op or version contract drifted'
);

-- The details audit carries both the previous and the new geography facts.
SELECT pg_temp.p118_assert(
  EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = '59911800-0000-4000-8000-000000000208'
      AND event.action = 'application.details.update'
      AND event.resource_id = :'p118_first_application'
      AND event.before_state ->> 'country' = 'MY'
      AND event.before_state ->> 'degree' = 'bachelor'
      AND event.after_state ->> 'country' = 'TR'
      AND event.after_state ->> 'degree' = 'foundation'
  ),
  'canonical details audit omitted geography before/after facts'
);

-- Both staff projections expose the application-level geography, distinct
-- from the case-level free-text target facts.
SET ROLE authenticated;
SELECT pg_temp.p118_assert(
  EXISTS (
    SELECT 1
    FROM private.platform_staff_application_page(
      10, NULL, NULL, NULL, :'p118_case', NULL
    ) AS application
    WHERE application.university_application_id = :'p118_first_application'
      AND application.country = 'TR'
      AND application.degree = 'foundation'
      AND application.target_country = 'Malaysia'
      AND application.target_degree = 'Bachelor'
  ),
  'private staff application page helper omitted geography facts'
);
SELECT pg_temp.p118_assert(
  EXISTS (
    SELECT 1
    FROM platform.staff_application_page(
      10, NULL, NULL, NULL, :'p118_case', NULL
    ) AS application
    WHERE application.university_application_id = :'p118_first_application'
      AND application.country = 'TR'
      AND application.degree = 'foundation'
      AND application.target_country = 'Malaysia'
      AND application.target_degree = 'Bachelor'
  ),
  'staff application page omitted geography facts'
);
SELECT pg_temp.p118_assert(
  EXISTS (
    SELECT 1
    FROM platform.staff_application_snapshot(
      :'p118_blank_application'
    ) AS application
    WHERE application.country IS NULL
      AND application.degree IS NULL
  ),
  'staff application snapshot omitted geography facts'
);
RESET ROLE;

-- Tenant derivation is live: an otherwise valid admin cannot substitute a
-- different organization id for either the invoker wrapper or its helper.
SET request.jwt.claims TO :'p118_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 2, %L::UUID)',
  :'p118_other_org', :'p118_first_application', '2031-10-09', 'AE', 'master',
  '59911800-0000-4000-8000-000000000212'
))::TEXT AS p118_cross_org_details_error
\gset
RESET ROLE;

-- Students and anonymous callers stay locked out of the widened commands.
SET request.jwt.claims TO :'p118_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, %L, %L, 2, %L::UUID)',
  :'p118_org', :'p118_first_application', '2031-10-09', 'AE', 'master',
  '59911800-0000-4000-8000-000000000214'
))::TEXT AS p118_student_details_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, %L, %L, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Student University', 'History',
  'preparation', 'MY', 'bachelor', '59911800-0000-4000-8000-000000000215'
))::TEXT AS p118_student_create_error
\gset
SELECT pg_temp.p118_capture_error(format(
  'SELECT private.platform_create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, %L, %L, 0, %L::UUID)',
  :'p118_org', :'p118_case', 'Student Helper University', 'History',
  'preparation', 'MY', 'bachelor', '59911800-0000-4000-8000-000000000216'
))::TEXT AS p118_student_helper_create_error
\gset
RESET ROLE;

SET ROLE anon;
SELECT pg_temp.p118_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, NULL, %L, %L, 2, %L::UUID)',
  :'p118_org', :'p118_first_application', 'AE', 'master',
  '59911800-0000-4000-8000-000000000217'
))::TEXT AS p118_anon_details_error
\gset
RESET ROLE;

SELECT pg_temp.p118_assert(
  :'p118_cross_org_details_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p118_student_details_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p118_student_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p118_student_helper_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p118_anon_details_error'::JSONB ->> 'sqlstate' = '42501',
  'geography commands leaked past tenant, role or helper guard boundaries'
);

-- Admissions owns active assigned cases. Rotate the synthetic case into that
-- state, then exercise the post-118 details body and both read wrappers as a
-- real Curator authority rather than relying on the pre-118 migration proof.
UPDATE platform.record_scopes
SET is_active = FALSE
WHERE id = :'p118_case_scope';
INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES (
  :'p118_case_scope_v2', :'p118_org', 'student_case', :'p118_case', 2
);
INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  '59911800-0000-4000-8000-000000000046', :'p118_org',
  :'p118_curator_membership', :'p118_case_scope_v2', 2, 1, TRUE, 'system',
  NULL, 'Migration 118 Curator case scope',
  '59911800-0000-4000-8000-000000000146'
);
UPDATE platform.student_cases
SET
  current_curator_membership_id = :'p118_curator_membership',
  operational_stage = 'documents',
  state = 'active',
  handoff_at = statement_timestamp(),
  portal_activated_at = statement_timestamp(),
  next_action = 'Collect application documents',
  current_scope_id = :'p118_case_scope_v2',
  current_scope_version = 2
WHERE id = :'p118_case';

SET request.jwt.claims TO :'p118_curator_claims';
SET ROLE authenticated;
SELECT platform.update_university_application_details(
  :'p118_org', :'p118_first_application', TRUE, '2031-10-09', 'AE', 'master',
  2, '59911800-0000-4000-8000-000000000218'
)::TEXT AS p118_curator_details_update
\gset
SELECT pg_temp.p118_assert(
  :'p118_curator_details_update'::JSONB ->> 'student_case_id' = :'p118_case'
    AND :'p118_curator_details_update'::JSONB ->> 'version' = '3'
    AND :'p118_curator_details_update'::JSONB ->> 'country' = 'AE'
    AND :'p118_curator_details_update'::JSONB ->> 'degree' = 'master'
    AND EXISTS (
      SELECT 1
      FROM platform.staff_application_page(
        10, NULL, NULL, NULL, :'p118_case', NULL
      ) AS application
      WHERE application.university_application_id = :'p118_first_application'
        AND application.country = 'AE'
        AND application.degree = 'master'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.staff_application_snapshot(
        :'p118_first_application'
      ) AS application
      WHERE application.country = 'AE'
        AND application.degree = 'master'
    ),
  'Admissions geography update/read contract drifted after migration 118'
);

SELECT platform.update_university_application_details(
  :'p118_org', :'p118_blank_application', TRUE, NULL, 'IT', 'language',
  1, '59911800-0000-4000-8000-000000000219'
)::TEXT AS p118_curator_primary_switch
\gset
SELECT pg_temp.p118_assert(
  :'p118_curator_primary_switch'::JSONB
      ->> 'university_application_id' = :'p118_blank_application'
    AND :'p118_curator_primary_switch'::JSONB ->> 'version' = '2'
    AND :'p118_curator_primary_switch'::JSONB
      ->> 'demoted_primary_application_id' = :'p118_first_application'
    AND :'p118_curator_primary_switch'::JSONB
      ->> 'demoted_primary_application_version' = '4'
    AND (
      SELECT pg_catalog.count(*)
      FROM platform.university_applications AS application
      WHERE application.organization_id = :'p118_org'
        AND application.student_case_id = :'p118_case'
        AND application.is_primary
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.university_applications AS application
      WHERE application.id = :'p118_blank_application'
        AND application.is_primary
        AND application.country = 'IT'
        AND application.degree = 'language'
        AND application.version = 2
    )
    AND EXISTS (
      SELECT 1
      FROM platform.university_applications AS application
      WHERE application.id = :'p118_first_application'
        AND NOT application.is_primary
        AND application.version = 4
    ),
  'Admissions primary switch lost its deterministic one-primary result'
);
RESET ROLE;

RESET request.jwt.claims;
ROLLBACK;
