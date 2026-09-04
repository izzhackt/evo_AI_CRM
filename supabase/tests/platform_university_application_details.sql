\set ON_ERROR_STOP on

-- Focused current-boundary acceptance for migration 112. The synthetic organization,
-- identities and cases exist only inside this rolled-back transaction.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p112_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 112 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p112_capture_error(p_statement TEXT)
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

GRANT EXECUTE ON FUNCTION pg_temp.p112_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p112_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  routine_oid OID;
  routine_count INTEGER;
  forbidden_role TEXT;
  expected_signature TEXT;
  rpc_name TEXT;
  details_function_source TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'university_applications'
      AND column_name = 'is_primary'
      AND data_type = 'boolean'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'is_primary BOOLEAN NOT NULL DEFAULT FALSE is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'university_applications'
      AND column_name = 'university_deadline_on'
      AND data_type = 'date'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'university_applications'
      AND column_name = 'university_deadline'
  ) THEN
    RAISE EXCEPTION 'university deadline column or no-alias contract drifted';
  END IF;

  IF to_regclass(
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
        'p_organization_id uuid, p_student_case_id uuid, p_institution_name text, p_program_name text, p_status platform.application_status, p_evidence_reference text, p_note text, p_is_primary boolean, p_university_deadline_on date, p_expected_version bigint, p_request_id uuid'
      ),
      (
        'create_catalog_university_application',
        'p_organization_id uuid, p_student_case_id uuid, p_catalog_institution_id uuid, p_program_name text, p_status platform.application_status, p_evidence_reference text, p_note text, p_is_primary boolean, p_university_deadline_on date, p_expected_version bigint, p_request_id uuid'
      ),
      (
        'update_university_application_details',
        'p_organization_id uuid, p_university_application_id uuid, p_is_primary boolean, p_university_deadline_on date, p_expected_version bigint, p_request_id uuid'
      ),
      (
        'change_university_application',
        'p_organization_id uuid, p_application_id uuid, p_new_status platform.application_status, p_evidence_reference text, p_note text, p_expected_version bigint, p_request_id uuid'
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
      SELECT routine.prosecdef
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

    IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on platform.%', rpc_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes platform.%',
          forbidden_role, rpc_name;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'create_university_application',
        'create_catalog_university_application'
      )
      AND NOT (
        routine.proargnames @> ARRAY[
          'p_is_primary', 'p_university_deadline_on'
        ]::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION 'superseded create RPC signature survived migration 112';
  END IF;

  IF pg_catalog.has_table_privilege(
    'authenticated',
    'platform.university_applications',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'authenticated unexpectedly updates applications directly';
  END IF;

  IF NOT (
    'application.details.update' = ANY (
      platform_private.p7a_safe_audit_actions()
    )
  ) THEN
    RAISE EXCEPTION 'application details audit is absent from the Admin journal';
  END IF;

  SELECT routine.prosrc
  INTO details_function_source
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'platform'
    AND routine.proname = 'update_university_application_details';
  IF details_function_source LIKE '%university_application_events%' THEN
    RAISE EXCEPTION 'details command writes the status-event authority';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.parameters
    WHERE specific_schema = 'platform'
      AND specific_name LIKE 'staff_application_page_%'
      AND parameter_mode = 'OUT'
      AND parameter_name = 'is_primary'
      AND data_type = 'boolean'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.parameters
    WHERE specific_schema = 'platform'
      AND specific_name LIKE 'staff_application_snapshot_%'
      AND parameter_mode = 'OUT'
      AND parameter_name = 'university_deadline_on'
      AND data_type = 'date'
  ) THEN
    RAISE EXCEPTION 'staff application read projections lack migration 112 facts';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p112_admin_bundle, bundle.version AS p112_admin_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'admin'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset
SELECT bundle.id AS p112_sales_bundle, bundle.version AS p112_sales_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'sales'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset
SELECT bundle.id AS p112_curator_bundle, bundle.version AS p112_curator_version
FROM platform.role_bundle_versions AS bundle
JOIN platform.role_bundle_permissions AS permission
  ON permission.bundle_id = bundle.id
  AND permission.bundle_role = bundle.role
  AND permission.permission_key = 'application.manage'
WHERE bundle.role = 'curator'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset
SELECT bundle.id AS p112_student_bundle, bundle.version AS p112_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset

\set p112_org 59911200-0000-4000-8000-000000000001
\set p112_other_org 59911200-0000-4000-8000-000000000002
\set p112_org_scope 59911200-0000-4000-8000-000000000003
\set p112_case_scope 59911200-0000-4000-8000-000000000004
\set p112_case 59911200-0000-4000-8000-000000000005
\set p112_other_case_scope 59911200-0000-4000-8000-000000000006
\set p112_other_case 59911200-0000-4000-8000-000000000007
\set p112_admin_user 59911200-0000-4000-8000-000000000011
\set p112_sales_user 59911200-0000-4000-8000-000000000012
\set p112_curator_user 59911200-0000-4000-8000-000000000013
\set p112_student_user 59911200-0000-4000-8000-000000000014
\set p112_admin_profile 59911200-0000-4000-8000-000000000021
\set p112_sales_profile 59911200-0000-4000-8000-000000000022
\set p112_curator_profile 59911200-0000-4000-8000-000000000023
\set p112_student_profile 59911200-0000-4000-8000-000000000024
\set p112_admin_membership 59911200-0000-4000-8000-000000000031
\set p112_sales_membership 59911200-0000-4000-8000-000000000032
\set p112_curator_membership 59911200-0000-4000-8000-000000000033
\set p112_student_membership 59911200-0000-4000-8000-000000000034
\set p112_source_key src_59911200000040008000000000000001
\set p112_source_record_key rec_59911200000040008000000000000001

INSERT INTO platform.organizations (id, name) VALUES
  (:'p112_org', 'Migration 112 Organization'),
  (:'p112_other_org', 'Migration 112 Other Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p112_org_scope', :'p112_org', 'organization', :'p112_org', 1),
  (:'p112_case_scope', :'p112_org', 'student_case', :'p112_case', 1),
  (:'p112_other_case_scope', :'p112_org', 'student_case', :'p112_other_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p112_admin_user', 'p112-admin@example.invalid', '{}'::JSONB),
  (:'p112_sales_user', 'p112-sales@example.invalid', '{}'::JSONB),
  (:'p112_curator_user', 'p112-curator@example.invalid', '{}'::JSONB),
  (:'p112_student_user', 'p112-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p112_admin_profile', :'p112_admin_user', 'Migration 112 Admin', 'active', 1),
  (:'p112_sales_profile', :'p112_sales_user', 'Migration 112 Sales', 'active', 1),
  (:'p112_curator_profile', :'p112_curator_user', 'Migration 112 Curator', 'active', 1),
  (:'p112_student_profile', :'p112_student_user', 'Migration 112 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p112_admin_membership', :'p112_org', :'p112_admin_profile', 'active', 'admin', :'p112_admin_bundle'),
  (:'p112_sales_membership', :'p112_org', :'p112_sales_profile', 'active', 'sales', :'p112_sales_bundle'),
  (:'p112_curator_membership', :'p112_org', :'p112_curator_profile', 'active', 'curator', :'p112_curator_bundle'),
  (:'p112_student_membership', :'p112_org', :'p112_student_profile', 'active', 'student', :'p112_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911200-0000-4000-8000-000000000041', :'p112_org', :'p112_admin_membership', :'p112_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 Admin org scope', '59911200-0000-4000-8000-000000000141'),
  ('59911200-0000-4000-8000-000000000042', :'p112_org', :'p112_sales_membership', :'p112_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 Sales case scope', '59911200-0000-4000-8000-000000000142'),
  ('59911200-0000-4000-8000-000000000043', :'p112_org', :'p112_curator_membership', :'p112_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 Curator case scope', '59911200-0000-4000-8000-000000000143'),
  ('59911200-0000-4000-8000-000000000044', :'p112_org', :'p112_student_membership', :'p112_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 Student case scope', '59911200-0000-4000-8000-000000000144'),
  ('59911200-0000-4000-8000-000000000045', :'p112_org', :'p112_curator_membership', :'p112_other_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 cross-case scope', '59911200-0000-4000-8000-000000000145'),
  ('59911200-0000-4000-8000-000000000046', :'p112_org', :'p112_curator_membership', :'p112_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 112 Curator org scope', '59911200-0000-4000-8000-000000000146');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p112_case', :'p112_org', :'p112_student_membership',
  :'p112_sales_membership', NULL,
  'synthetic:p112:case', 'contract:p112', '2026-09-05T09:00:00Z',
  'Migration 112 Student', 'United Kingdom', 'Bachelor', 'Business',
  '2031', 'approved', 'contract_confirmed', 'pending', NULL, NULL,
  'Verify application priority', :'p112_case_scope', 1
), (
  :'p112_other_case', :'p112_org', :'p112_student_membership',
  :'p112_sales_membership', NULL,
  'synthetic:p112:other-case', 'contract:p112:other',
  '2026-09-05T09:05:00Z', 'Migration 112 Other Student',
  'Canada', 'Master', 'Analytics', '2032', 'approved',
  'contract_confirmed', 'pending', NULL, NULL,
  'Prove same-organization cross-case denial', :'p112_other_case_scope', 1
);

SELECT jsonb_build_object(
  'sub', :'p112_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p112_org',
  'platform_membership_id', :'p112_admin_membership',
  'platform_bundle_id', :'p112_admin_bundle',
  'platform_bundle_version', :'p112_admin_version'::INTEGER
)::TEXT AS p112_admin_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p112_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p112_org',
  'platform_membership_id', :'p112_sales_membership',
  'platform_bundle_id', :'p112_sales_bundle',
  'platform_bundle_version', :'p112_sales_version'::INTEGER
)::TEXT AS p112_sales_claims
\gset

-- Build an approved catalog institution through the real catalog workflow.
SET request.jwt.claims TO :'p112_admin_claims';
SET ROLE authenticated;

SELECT platform.register_workflow_source(
  :'p112_org', :'p112_source_key', 'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1P112CatalogSheetFixture000000001/edit',
  'p112revisioncatalog1', 'Register migration 112 catalog source',
  '59911200-0000-4000-8000-000000000151'
)::TEXT AS p112_source_id
\gset
SELECT platform.review_workflow_source(
  :'p112_org', :'p112_source_id', 'reviewed',
  'Review migration 112 catalog source',
  '59911200-0000-4000-8000-000000000152'
);
SELECT platform.create_catalog_import_batch(
  :'p112_org', :'p112_source_id', 'university',
  'Create migration 112 catalog batch',
  '59911200-0000-4000-8000-000000000153'
)::TEXT AS p112_catalog_batch
\gset
SELECT
  (:'p112_catalog_batch'::JSONB ->> 'catalog_import_batch_id')::UUID
    AS p112_catalog_import_batch
\gset
SELECT platform.stage_catalog_import_candidate(
  :'p112_org', :'p112_catalog_import_batch', :'p112_source_record_key',
  'Migration 112 University', 'GB', 'London',
  'Stage migration 112 catalog institution',
  '59911200-0000-4000-8000-000000000154'
);
SELECT platform.validate_catalog_import_batch(
  :'p112_org', :'p112_catalog_import_batch',
  'Validate migration 112 catalog batch',
  '59911200-0000-4000-8000-000000000155'
);
SELECT platform.review_catalog_import_batch(
  :'p112_org', :'p112_catalog_import_batch', 'approve',
  'Approve migration 112 catalog batch',
  '59911200-0000-4000-8000-000000000156'
);

RESET ROLE;
SELECT institution.id AS p112_catalog_institution
FROM platform.catalog_institutions AS institution
WHERE institution.organization_id = :'p112_org'
  AND institution.import_batch_id = :'p112_catalog_import_batch'
ORDER BY institution.id
LIMIT 1
\gset

-- Sales owns the pending case and can create/replay both application forms.
SET request.jwt.claims TO :'p112_sales_claims';
SET ROLE authenticated;

SELECT platform.create_university_application(
  p_organization_id => :'p112_org',
  p_student_case_id => :'p112_case',
  p_institution_name => 'First University',
  p_program_name => 'Economics',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Initial primary',
  p_is_primary => TRUE,
  p_university_deadline_on => '2031-10-09',
  p_expected_version => 0,
  p_request_id => '59911200-0000-4000-8000-000000000201'
)::TEXT AS p112_first_create
\gset
SELECT platform.create_university_application(
  :'p112_org', :'p112_case', 'First University', 'Economics',
  'preparation', NULL, 'Initial primary', TRUE, '2031-10-09', 0,
  '59911200-0000-4000-8000-000000000201'
)::TEXT AS p112_first_replay
\gset
SELECT :'p112_first_create'::JSONB ->> 'university_application_id'
  AS p112_first_application
\gset

SELECT platform.create_catalog_university_application(
  p_organization_id => :'p112_org',
  p_student_case_id => :'p112_case',
  p_catalog_institution_id => :'p112_catalog_institution',
  p_program_name => 'Data Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Catalog alternative',
  p_is_primary => FALSE,
  p_university_deadline_on => NULL,
  p_expected_version => 0,
  p_request_id => '59911200-0000-4000-8000-000000000202'
)::TEXT AS p112_catalog_create
\gset
SELECT platform.create_catalog_university_application(
  :'p112_org', :'p112_case', :'p112_catalog_institution', 'Data Science',
  'preparation', NULL, 'Catalog alternative', FALSE, NULL, 0,
  '59911200-0000-4000-8000-000000000202'
)::TEXT AS p112_catalog_replay
\gset
SELECT :'p112_catalog_create'::JSONB ->> 'university_application_id'
  AS p112_catalog_application
\gset

SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, %L, FALSE, %L::DATE, 0, %L::UUID)',
  :'p112_org', :'p112_case', 'Out of range University', 'History',
  'preparation', 'Reject out-of-range create deadline', '10000-01-01',
  '59911200-0000-4000-8000-000000000200'
))::TEXT AS p112_create_deadline_range_error
\gset

SELECT pg_temp.p112_assert(
  :'p112_first_create'::JSONB = :'p112_first_replay'::JSONB
    AND :'p112_catalog_create'::JSONB = :'p112_catalog_replay'::JSONB
    AND :'p112_first_create'::JSONB ->> 'is_primary' = 'true'
    AND :'p112_first_create'::JSONB ->> 'university_deadline_on' = '2031-10-09'
    AND :'p112_catalog_create'::JSONB ->> 'is_primary' = 'false'
    AND :'p112_catalog_create'::JSONB -> 'university_deadline_on' = 'null'::JSONB
    AND :'p112_create_deadline_range_error'::JSONB ->> 'sqlstate' = '22023',
  'direct/catalog create facts or idempotent replay drifted'
);

SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, %L, TRUE, %L::DATE, 0, %L::UUID)',
  :'p112_org', :'p112_case', 'First University', 'Economics', 'preparation',
  'Initial primary', '2031-10-10',
  '59911200-0000-4000-8000-000000000201'
))::TEXT AS p112_create_conflict
\gset

-- A primary create demotes the prior primary and advances its version.
SELECT platform.create_university_application(
  :'p112_org', :'p112_case', 'Third University', 'Law',
  'preparation', NULL, 'Switch through create', TRUE, '2031-11-01', 0,
  '59911200-0000-4000-8000-000000000203'
)::TEXT AS p112_third_create
\gset
SELECT :'p112_third_create'::JSONB ->> 'university_application_id'
  AS p112_third_application
\gset

SELECT pg_temp.p112_assert(
  :'p112_create_conflict'::JSONB ->> 'sqlstate' = '22023'
    AND :'p112_third_create'::JSONB ->> 'demoted_primary_application_id'
      = :'p112_first_application'
    AND :'p112_third_create'::JSONB ->> 'demoted_primary_application_version' = '2'
    AND (
      SELECT count(*)
      FROM platform.university_applications AS application
      WHERE application.organization_id = :'p112_org'
        AND application.student_case_id = :'p112_case'
        AND application.is_primary
    ) = 1
    AND (
      SELECT application.version = 2 AND NOT application.is_primary
      FROM platform.university_applications AS application
      WHERE application.id = :'p112_first_application'
    ),
  'create request conflict, demotion receipt or one-primary state drifted'
);

RESET ROLE;
SELECT pg_temp.p112_capture_error(format(
  'UPDATE platform.university_applications SET is_primary = TRUE WHERE id = %L::UUID',
  :'p112_catalog_application'
))::TEXT AS p112_unique_error
\gset
SELECT pg_temp.p112_assert(
  :'p112_unique_error'::JSONB ->> 'sqlstate' = '23505',
  'database invariant allowed a second primary application'
);

-- Activate the case, then prove Admissions can update details while Student
-- and a cross-organization request fail closed.
SET request.jwt.claims TO :'p112_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p112_org', :'p112_case', :'p112_curator_membership',
  'Activate migration 112 case',
  '59911200-0000-4000-8000-000000000204'
);

-- Admin remains the functional superset after handoff.
SELECT platform.create_university_application(
  :'p112_org', :'p112_case', 'Admin Alternative University', 'Finance',
  'preparation', NULL, 'Admin create after handoff', FALSE, NULL, 0,
  '59911200-0000-4000-8000-000000000220'
)::TEXT AS p112_admin_create
\gset
SELECT pg_temp.p112_assert(
  :'p112_admin_create'::JSONB ->> 'version' = '1'
    AND :'p112_admin_create'::JSONB ->> 'is_primary' = 'false',
  'Admin functional-superset create failed after Admissions handoff'
);

-- The former Sales owner must fail closed once the case is active.
RESET ROLE;
SET request.jwt.claims TO :'p112_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 1, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '2031-12-01',
  '59911200-0000-4000-8000-000000000221'
))::TEXT AS p112_active_sales_update_error
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, 0, %L::UUID)',
  :'p112_org', :'p112_case', 'Denied Sales University', 'History',
  'preparation', '59911200-0000-4000-8000-000000000222'
))::TEXT AS p112_active_sales_create_error
\gset
SELECT pg_temp.p112_assert(
  :'p112_active_sales_update_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p112_active_sales_create_error'::JSONB ->> 'sqlstate' = '42501',
  'Sales retained application mutation authority after Admissions handoff'
);

RESET ROLE;
SELECT jsonb_build_object(
  'sub', :'p112_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p112_org',
  'platform_membership_id', :'p112_curator_membership',
  'platform_bundle_id', :'p112_curator_bundle',
  'platform_bundle_version', :'p112_curator_version'::INTEGER
)::TEXT AS p112_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p112_curator_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p112_student_user', 'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p112_org',
  'platform_membership_id', :'p112_student_membership',
  'platform_bundle_id', :'p112_student_bundle',
  'platform_bundle_version', :'p112_student_version'::INTEGER
)::TEXT AS p112_student_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p112_student_profile'
\gset

SELECT count(*) AS p112_status_event_count_before
FROM platform.university_application_events
WHERE organization_id = :'p112_org'
  AND student_case_id = :'p112_case'
\gset

SET request.jwt.claims TO :'p112_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.create_university_application(%L::UUID, %L::UUID, %L, %L, '
    || '%L::platform.application_status, NULL, NULL, FALSE, NULL, 0, %L::UUID)',
  :'p112_org', :'p112_other_case', 'Cross-case University', 'Engineering',
  'preparation', '59911200-0000-4000-8000-000000000223'
))::TEXT AS p112_cross_case_error
\gset
SELECT platform.update_university_application_details(
  p_organization_id => :'p112_org',
  p_university_application_id => :'p112_catalog_application',
  p_is_primary => TRUE,
  p_university_deadline_on => '2031-12-15',
  p_expected_version => 1,
  p_request_id => '59911200-0000-4000-8000-000000000205'
)::TEXT AS p112_details_update
\gset
SELECT platform.update_university_application_details(
  :'p112_org', :'p112_catalog_application', TRUE, '2031-12-15', 1,
  '59911200-0000-4000-8000-000000000205'
)::TEXT AS p112_details_replay
\gset

SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 1, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '2031-12-16',
  '59911200-0000-4000-8000-000000000205'
))::TEXT AS p112_details_conflict
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'FALSE, NULL, 1, %L::UUID)',
  :'p112_org', :'p112_first_application',
  '59911200-0000-4000-8000-000000000206'
))::TEXT AS p112_stale_error
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 2, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '2031-12-15',
  '59911200-0000-4000-8000-000000000207'
))::TEXT AS p112_noop_error
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 2, %L::UUID)',
  :'p112_org', :'p112_catalog_application', 'infinity',
  '59911200-0000-4000-8000-000000000212'
))::TEXT AS p112_infinite_deadline_error
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 2, %L::UUID)',
  :'p112_other_org', :'p112_catalog_application', '2031-12-15',
  '59911200-0000-4000-8000-000000000208'
))::TEXT AS p112_cross_org_error
\gset
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 2, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '10000-01-01',
  '59911200-0000-4000-8000-000000000214'
))::TEXT AS p112_details_deadline_range_error
\gset

RESET ROLE;
SELECT pg_temp.p112_assert(
  :'p112_details_update'::JSONB = :'p112_details_replay'::JSONB
    AND :'p112_details_update'::JSONB ->> 'version' = '2'
    AND :'p112_details_update'::JSONB ->> 'demoted_primary_application_id'
      = :'p112_third_application'
    AND :'p112_details_update'::JSONB ->> 'demoted_primary_application_version' = '2'
    AND :'p112_details_conflict'::JSONB ->> 'sqlstate' = '22023'
    AND :'p112_stale_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p112_noop_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p112_infinite_deadline_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p112_cross_org_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p112_cross_case_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p112_details_deadline_range_error'::JSONB ->> 'sqlstate' = '22023',
  'details replay/conflict/stale/no-op/date-range/tenant/case contract drifted'
);

SELECT pg_temp.p112_assert(
  (
    SELECT count(*)
    FROM platform.university_application_events
    WHERE organization_id = :'p112_org'
      AND student_case_id = :'p112_case'
  ) = :'p112_status_event_count_before'::BIGINT,
  'details-only update fabricated a university status event'
);

SET ROLE authenticated;
SELECT pg_temp.p112_assert(
  EXISTS (
    SELECT 1
    FROM platform.staff_application_page(
      10, NULL, NULL, NULL, :'p112_case', NULL
    ) AS application
    WHERE application.university_application_id = :'p112_catalog_application'
      AND application.is_primary
      AND application.university_deadline_on = '2031-12-15'
      AND application.version = '2'
  ) AND EXISTS (
    SELECT 1
    FROM platform.staff_application_snapshot(
      :'p112_catalog_application'
    ) AS application
    WHERE application.is_primary
      AND application.university_deadline_on = '2031-12-15'
      AND application.version = '2'
  ),
  'staff application page/snapshot omitted priority or deadline facts'
);

RESET ROLE;
SET request.jwt.claims TO :'p112_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 1, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '2031-12-15',
  '59911200-0000-4000-8000-000000000205'
))::TEXT AS p112_unauthorized_replay_error
\gset
SELECT pg_temp.p112_assert(
  :'p112_unauthorized_replay_error'::JSONB ->> 'sqlstate' = '42501',
  'details replay bypassed current exact-case authorization'
);

RESET ROLE;
SET request.jwt.claims TO :'p112_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'FALSE, NULL, 2, %L::UUID)',
  :'p112_org', :'p112_catalog_application',
  '59911200-0000-4000-8000-000000000209'
))::TEXT AS p112_student_error
\gset
SELECT pg_temp.p112_assert(
  :'p112_student_error'::JSONB ->> 'sqlstate' = '42501',
  'student unexpectedly changed application priority/deadline'
);

-- A real status transition updates only the target status/version and does
-- not auto-select, clear or mutate any sibling's primary fact.
RESET ROLE;
SET request.jwt.claims TO :'p112_curator_claims';
SET ROLE authenticated;
SELECT platform.change_university_application(
  :'p112_org', :'p112_catalog_application', 'submitted',
  'evidence:p112:submission', 'Submitted without changing primary', 2,
  '59911200-0000-4000-8000-000000000210'
)::TEXT AS p112_status_change
\gset

RESET ROLE;
SELECT pg_temp.p112_assert(
  :'p112_status_change'::JSONB ->> 'version' = '3'
    AND (
      SELECT application.is_primary
        AND application.university_deadline_on = '2031-12-15'
      FROM platform.university_applications AS application
      WHERE application.id = :'p112_catalog_application'
    )
    AND (
      SELECT NOT application.is_primary AND application.version = 2
      FROM platform.university_applications AS application
      WHERE application.id = :'p112_third_application'
    ),
  'status transition changed primary/deadline or a sibling application'
);

-- Explicit clear is valid, chooses no replacement and remains details-only.
SELECT count(*) AS p112_status_event_count_before_clear
FROM platform.university_application_events
WHERE organization_id = :'p112_org'
  AND student_case_id = :'p112_case'
\gset
SET ROLE authenticated;
SELECT platform.update_university_application_details(
  :'p112_org', :'p112_catalog_application', FALSE, NULL, 3,
  '59911200-0000-4000-8000-000000000211'
)::TEXT AS p112_clear
\gset

RESET ROLE;
SELECT pg_temp.p112_assert(
  :'p112_clear'::JSONB ->> 'version' = '4'
    AND :'p112_clear'::JSONB ->> 'is_primary' = 'false'
    AND :'p112_clear'::JSONB -> 'university_deadline_on' = 'null'::JSONB
    AND NOT EXISTS (
      SELECT 1
      FROM platform.university_applications AS application
      WHERE application.organization_id = :'p112_org'
        AND application.student_case_id = :'p112_case'
        AND application.is_primary
    )
    AND (
      SELECT count(*)
      FROM platform.university_application_events
      WHERE organization_id = :'p112_org'
        AND student_case_id = :'p112_case'
    ) = :'p112_status_event_count_before_clear'::BIGINT,
  'explicit primary/deadline clear selected a replacement or wrote status history'
);

-- A sibling at BIGINT max cannot be demoted. The switch must abort before the
-- target changes and must not leave a receipt/audit behind.
UPDATE platform.university_applications
SET is_primary = TRUE,
    version = 9223372036854775807
WHERE id = :'p112_third_application';

SET ROLE authenticated;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, %L::DATE, 4, %L::UUID)',
  :'p112_org', :'p112_catalog_application', '2032-01-10',
  '59911200-0000-4000-8000-000000000224'
))::TEXT AS p112_max_sibling_error
\gset
RESET ROLE;

SELECT pg_temp.p112_assert(
  :'p112_max_sibling_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND (
      SELECT NOT application.is_primary
        AND application.university_deadline_on IS NULL
        AND application.version = 4
      FROM platform.university_applications AS application
      WHERE application.id = :'p112_catalog_application'
    )
    AND (
      SELECT application.is_primary
        AND application.version = 9223372036854775807
      FROM platform.university_applications AS application
      WHERE application.id = :'p112_third_application'
    )
    AND NOT EXISTS (
      SELECT 1 FROM platform.audit_events AS event
      WHERE event.request_id = '59911200-0000-4000-8000-000000000224'
    ),
  'max-version sibling conflict did not roll back the complete switch'
);

UPDATE platform.university_applications
SET is_primary = FALSE,
    version = 2
WHERE id = :'p112_third_application';

SELECT pg_temp.p112_assert(
  EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id = '59911200-0000-4000-8000-000000000205'
      AND event.action = 'application.details.update'
      AND event.resource_id = :'p112_catalog_application'
      AND event.before_state ->> 'demoted_primary_application_id'
        = :'p112_third_application'
      AND event.after_state ->> 'demoted_primary_application_version' = '2'
  ),
  'canonical details audit omitted primary switch metadata'
);

SET ROLE anon;
SELECT pg_temp.p112_capture_error(format(
  'SELECT platform.update_university_application_details(%L::UUID, %L::UUID, '
    || 'TRUE, NULL, 4, %L::UUID)',
  :'p112_org', :'p112_catalog_application',
  '59911200-0000-4000-8000-000000000225'
))::TEXT AS p112_anon_error
\gset
SELECT pg_temp.p112_assert(
  :'p112_anon_error'::JSONB ->> 'sqlstate' = '42501',
  'anon unexpectedly executed the application details command'
);
RESET ROLE;

RESET request.jwt.claims;
ROLLBACK;
