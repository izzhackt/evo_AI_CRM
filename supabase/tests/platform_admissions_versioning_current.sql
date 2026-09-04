\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 107. Build the complete synthetic
-- organization, authority, case and approved-catalog provenance in this
-- transaction so the proof is independent of every earlier SQL suite.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p107_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 107 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p107_capture_error(
  p_statement TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN pg_catalog.jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p107_assert(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p107_capture_error(TEXT)
  TO authenticated;

-- The replacement boundary exposes exactly the RPCs called by the V3 server
-- actions. PostgreSQL grants EXECUTE to PUBLIC by default, so checking anon
-- and service roles also proves every function was explicitly contained.
DO $catalog_contract$
DECLARE
  rpc_name TEXT;
  routine_oid OID;
  routine_count INTEGER;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  FOREACH rpc_name IN ARRAY ARRAY[
    'create_university_application',
    'create_catalog_university_application',
    'change_university_application',
    'create_visa_case',
    'change_visa_case',
    'create_case_task',
    'change_case_task',
    'assert_case_finance_stop_factor',
    'resolve_case_stop_factor'
  ]
  LOOP
    SELECT count(*), (pg_catalog.array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = rpc_name;

    IF routine_count <> 1 OR routine_oid IS NULL THEN
      RAISE EXCEPTION
        'Migration 107 must expose exactly one platform.% RPC, found %',
        rpc_name,
        routine_count;
    END IF;

    SELECT routine.*
    INTO STRICT routine_row
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> 'v'
      OR routine_row.prokind <> 'f'
      OR routine_row.proretset
      OR pg_catalog.pg_get_function_result(routine_oid) <> 'jsonb'
      OR NOT (
        routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
      OR routine_row.pronargdefaults <> 0
      OR NOT COALESCE(
        routine_row.proargnames @> ARRAY[
          'p_expected_version',
          'p_request_id'
        ]::TEXT[],
        FALSE
      )
    THEN
      RAISE EXCEPTION
        'Migration 107 RPC contract drifted for platform.%',
        rpc_name;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated',
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'authenticated lacks EXECUTE on platform.%',
        rpc_name;
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
          '% unexpectedly has EXECUTE on platform.%',
          forbidden_role,
          rpc_name;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN ('create_stop_factor', 'resolve_stop_factor')
  ) THEN
    RAISE EXCEPTION
      'Broad finance mutation RPC survived the case-bound replacement';
  END IF;
END
$catalog_contract$;

-- Build a fully isolated organization, role/scope authority and approved
-- catalog institution so this acceptance does not depend on suite order.
SELECT pg_temp.p107_assert(
  (
    SELECT count(*)
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.role IN ('admin', 'sales', 'curator', 'student')
      AND bundle.version = 13
      AND bundle.status = 'published'
  ) = 4,
  'Published v13 Admin, Sales, Curator and Student bundles are required'
);

SELECT
  bundle.id AS p107_admin_bundle,
  bundle.version AS p107_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset

SELECT
  bundle.id AS p107_sales_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset

SELECT
  bundle.id AS p107_curator_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset

SELECT
  bundle.id AS p107_student_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.version = 13
  AND bundle.status = 'published'
LIMIT 1
\gset

\set p107_org_id 59700000-0000-4000-8000-000000000001
\set p107_org_scope_id 59700000-0000-4000-8000-000000000002
\set p107_admin_user_id 59700000-0000-4000-8000-000000000003
\set p107_sales_user_id 59700000-0000-4000-8000-000000000004
\set p107_curator_user_id 59700000-0000-4000-8000-000000000005
\set p107_student_user_id 59700000-0000-4000-8000-000000000006
\set p107_admin_profile_id 59700000-0000-4000-8000-000000000007
\set p107_sales_profile_id 59700000-0000-4000-8000-000000000008
\set p107_curator_profile_id 59700000-0000-4000-8000-000000000009
\set p107_student_profile_id 59700000-0000-4000-8000-00000000000a
\set p107_admin_membership_id 59700000-0000-4000-8000-00000000000b
\set p107_sales_membership_id 59700000-0000-4000-8000-00000000000c
\set p107_curator_membership_id 59700000-0000-4000-8000-00000000000d
\set p107_student_membership_id 59700000-0000-4000-8000-00000000000e
\set p107_case_scope_id 59700000-0000-4000-8000-000000000010
\set p107_case_id 59700000-0000-4000-8000-000000000011
\set p107_source_key src_59700000000040008000000000000011
\set p107_source_record_key rec_59700000000040008000000000000011

INSERT INTO platform.organizations (id, name)
VALUES (:'p107_org_id', 'Migration 107 Organization');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES (
  :'p107_org_scope_id',
  :'p107_org_id',
  'organization',
  :'p107_org_id',
  1
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p107_admin_user_id', 'p107-admin@example.invalid', '{}'::jsonb),
  (:'p107_sales_user_id', 'p107-sales@example.invalid', '{}'::jsonb),
  (:'p107_curator_user_id', 'p107-curator@example.invalid', '{}'::jsonb),
  (:'p107_student_user_id', 'p107-student@example.invalid', '{}'::jsonb);

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES
  (:'p107_admin_profile_id', :'p107_admin_user_id', 'Migration 107 Admin', 'active', 1),
  (:'p107_sales_profile_id', :'p107_sales_user_id', 'Migration 107 Sales', 'active', 1),
  (:'p107_curator_profile_id', :'p107_curator_user_id', 'Migration 107 Curator', 'active', 1),
  (:'p107_student_profile_id', :'p107_student_user_id', 'Migration 107 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES
  (:'p107_admin_membership_id', :'p107_org_id', :'p107_admin_profile_id', 'active', 'admin', :'p107_admin_bundle'),
  (:'p107_sales_membership_id', :'p107_org_id', :'p107_sales_profile_id', 'active', 'sales', :'p107_sales_bundle'),
  (:'p107_curator_membership_id', :'p107_org_id', :'p107_curator_profile_id', 'active', 'curator', :'p107_curator_bundle'),
  (:'p107_student_membership_id', :'p107_org_id', :'p107_student_profile_id', 'active', 'student', :'p107_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id,
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
) VALUES
  ('59700000-0000-4000-8000-000000000012', :'p107_org_id', :'p107_admin_membership_id', :'p107_org_scope_id', 1, 1, TRUE, 'system', NULL, 'Migration 107 org scope', '59700000-0000-4000-8000-000000000112'),
  ('59700000-0000-4000-8000-000000000013', :'p107_org_id', :'p107_sales_membership_id', :'p107_org_scope_id', 1, 1, TRUE, 'system', NULL, 'Migration 107 org scope', '59700000-0000-4000-8000-000000000113'),
  ('59700000-0000-4000-8000-000000000014', :'p107_org_id', :'p107_curator_membership_id', :'p107_org_scope_id', 1, 1, TRUE, 'system', NULL, 'Migration 107 org scope', '59700000-0000-4000-8000-000000000114'),
  ('59700000-0000-4000-8000-000000000015', :'p107_org_id', :'p107_student_membership_id', :'p107_org_scope_id', 1, 1, TRUE, 'system', NULL, 'Migration 107 org scope', '59700000-0000-4000-8000-000000000115');

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p107_admin_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'p107_org_id',
  'platform_membership_id', :'p107_admin_membership_id',
  'platform_bundle_id', :'p107_admin_bundle',
  'platform_bundle_version', :'p107_admin_bundle_version'::INTEGER
)::TEXT AS p107_admin_claims
\gset

SET request.jwt.claims TO :'p107_admin_claims';
SET ROLE authenticated;

SELECT platform.register_workflow_source(
  :'p107_org_id',
  :'p107_source_key',
  'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1P107CatalogSheetFixture000000001/edit',
  'p107revisioncatalog1',
  'Register migration 107 catalog source',
  '59700000-0000-4000-8000-000000000116'
)::TEXT AS p107_source_id
\gset

SELECT platform.review_workflow_source(
  :'p107_org_id',
  :'p107_source_id',
  'reviewed',
  'Review migration 107 catalog source',
  '59700000-0000-4000-8000-000000000117'
);

SELECT platform.create_catalog_import_batch(
  :'p107_org_id',
  :'p107_source_id',
  'university',
  'Create migration 107 catalog batch',
  '59700000-0000-4000-8000-000000000118'
)::TEXT AS p107_catalog_batch
\gset

SELECT
  (:'p107_catalog_batch'::JSONB ->> 'catalog_import_batch_id')::UUID
    AS p107_catalog_import_batch_id
\gset

SELECT platform.stage_catalog_import_candidate(
  :'p107_org_id',
  :'p107_catalog_import_batch_id',
  :'p107_source_record_key',
  'Migration 107 University',
  'GB',
  'London',
  'Stage migration 107 catalog institution',
  '59700000-0000-4000-8000-000000000119'
);

SELECT platform.validate_catalog_import_batch(
  :'p107_org_id',
  :'p107_catalog_import_batch_id',
  'Validate migration 107 catalog batch',
  '59700000-0000-4000-8000-000000000120'
);

SELECT platform.review_catalog_import_batch(
  :'p107_org_id',
  :'p107_catalog_import_batch_id',
  'approve',
  'Approve migration 107 catalog batch',
  '59700000-0000-4000-8000-000000000121'
);

RESET ROLE;

SELECT pg_temp.p107_assert(
  EXISTS (
    SELECT 1
    FROM platform.catalog_institutions AS institution
    WHERE institution.organization_id = :'p107_org_id'
      AND institution.import_batch_id = :'p107_catalog_import_batch_id'
  ),
  'Migration 107 failed to create an approved catalog institution'
);

SELECT
  institution.id AS p107_catalog_institution_id
FROM platform.catalog_institutions AS institution
WHERE institution.organization_id = :'p107_org_id'
  AND institution.import_batch_id = :'p107_catalog_import_batch_id'
ORDER BY institution.id
LIMIT 1
\gset

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES (
  :'p107_case_scope_id',
  :'p107_org_id',
  'student_case',
  :'p107_case_id',
  1
);

INSERT INTO platform.student_cases (
  id,
  organization_id,
  student_membership_id,
  responsible_sales_membership_id,
  current_curator_membership_id,
  source_key,
  contract_confirmation_ref,
  contract_confirmed_at,
  student_display_name,
  target_country,
  target_degree,
  program_direction,
  intake,
  route_approval_status,
  operational_stage,
  state,
  handoff_at,
  portal_activated_at,
  closed_at,
  next_action,
  current_scope_id,
  current_scope_version
) VALUES (
  :'p107_case_id',
  :'p107_org_id',
  :'p107_student_membership_id',
  :'p107_sales_membership_id',
  NULL,
  'synthetic:p107:case',
  'contract:p107',
  '2026-09-04T09:00:00Z',
  'Migration 107 Student',
  'United Kingdom',
  'Bachelor',
  'Business',
  '2027',
  'approved',
  'admissions_active',
  'pending',
  NULL,
  NULL,
  NULL,
  'Verify migration 107 optimistic versions',
  :'p107_case_scope_id',
  1
);

SET request.jwt.claims TO :'p107_admin_claims';
SET ROLE authenticated;

SELECT platform.assign_student_case_curator(
  :'p107_org_id',
  :'p107_case_id',
  :'p107_curator_membership_id',
  'Activate the isolated migration 107 case through the real lifecycle',
  '59700000-0000-4000-8000-000000000122'
);

RESET ROLE;

SELECT pg_temp.p107_assert(
  EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'p107_org_id'
      AND student_case.id = :'p107_case_id'
      AND student_case.state = 'active'
      AND student_case.current_curator_membership_id =
        :'p107_curator_membership_id'
      AND student_case.handoff_at IS NOT NULL
      AND student_case.current_scope_version = 2
  ),
  'Migration 107 case did not complete the pending-to-active lifecycle'
);

INSERT INTO platform.payment_obligations (
  id,
  organization_id,
  student_case_id,
  label,
  category,
  amount_minor,
  currency,
  due_at,
  next_action,
  created_by_membership_id
)
VALUES (
  '59700000-0000-4000-8000-000000000001',
  :'p107_org_id',
  :'p107_case_id',
  'Migration 107 isolated obligation',
  'evo_service_fee',
  10000,
  'USD',
  '2027-09-04T12:00:00Z',
  'Verify the isolated finance-stop flow',
  :'p107_admin_membership_id'
);

SET request.jwt.claims TO :'p107_admin_claims';
SET ROLE authenticated;

-- Direct application: create at version zero, replay exactly, advance once,
-- replay the update, then reject a stale independent request.
SELECT platform.create_university_application(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_institution_name => 'Migration 107 Direct University',
  p_program_name => 'Computer Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Isolated direct application',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000101'
)::TEXT AS p107_direct_create
\gset
SELECT platform.create_university_application(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_institution_name => 'Migration 107 Direct University',
  p_program_name => 'Computer Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Isolated direct application',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000101'
)::TEXT AS p107_direct_create_replay
\gset

SELECT
  (:'p107_direct_create'::JSONB ->> 'university_application_id')::UUID
    AS p107_direct_application_id
\gset

SELECT pg_temp.p107_assert(
  :'p107_direct_create'::JSONB = :'p107_direct_create_replay'::JSONB
    AND :'p107_direct_create'::JSONB ->> 'expected_version' = '0'
    AND :'p107_direct_create'::JSONB ->> 'version' = '1'
    AND :'p107_direct_create'::JSONB ->> 'request_id'
      = '59700000-0000-4000-8000-000000000101'
    AND (
      SELECT count(*)
      FROM platform.university_applications AS application
      WHERE application.student_case_id = :'p107_case_id'
        AND application.institution_name = 'Migration 107 Direct University'
        AND application.program_name = 'Computer Science'
    ) = 1,
  'Direct application create/replay/version contract failed'
);

SELECT platform.change_university_application(
  p_organization_id => :'p107_org_id',
  p_application_id => :'p107_direct_application_id',
  p_new_status => 'ready',
  p_evidence_reference => NULL,
  p_note => 'Ready for submission',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000102'
)::TEXT AS p107_direct_change
\gset
SELECT platform.change_university_application(
  p_organization_id => :'p107_org_id',
  p_application_id => :'p107_direct_application_id',
  p_new_status => 'ready',
  p_evidence_reference => NULL,
  p_note => 'Ready for submission',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000102'
)::TEXT AS p107_direct_change_replay
\gset

SELECT pg_temp.p107_capture_error(pg_catalog.format(
  'SELECT platform.change_university_application('
    || 'p_organization_id => %L::UUID, p_application_id => %L::UUID, '
    || 'p_new_status => %L::platform.application_status, '
    || 'p_evidence_reference => %L, p_note => %L, '
    || 'p_expected_version => 1, p_request_id => %L::UUID)',
  :'p107_org_id',
  :'p107_direct_application_id',
  'submitted',
  'synthetic:application:stale',
  'Stale application write',
  '59700000-0000-4000-8000-000000000103'
))::TEXT AS p107_application_stale
\gset

SELECT pg_temp.p107_assert(
  :'p107_direct_change'::JSONB = :'p107_direct_change_replay'::JSONB
    AND :'p107_direct_change'::JSONB ->> 'expected_version' = '1'
    AND :'p107_direct_change'::JSONB ->> 'version' = '2'
    AND :'p107_application_stale'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p107_application_stale'::JSONB ->> 'message'
      = 'admissions_version_conflict'
    AND (
      SELECT application.version = 2 AND application.status = 'ready'
      FROM platform.university_applications AS application
      WHERE application.id = :'p107_direct_application_id'
    ),
  'Direct application update/replay/stale-write contract failed'
);

-- Catalog application uses the same canonical application table and optimistic
-- create contract without accepting a caller-supplied resource identifier.
SELECT platform.create_catalog_university_application(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_catalog_institution_id => :'p107_catalog_institution_id',
  p_program_name => 'Data Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Isolated catalog application',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000111'
)::TEXT AS p107_catalog_create
\gset
SELECT platform.create_catalog_university_application(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_catalog_institution_id => :'p107_catalog_institution_id',
  p_program_name => 'Data Science',
  p_status => 'preparation',
  p_evidence_reference => NULL,
  p_note => 'Isolated catalog application',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000111'
)::TEXT AS p107_catalog_create_replay
\gset

SELECT pg_temp.p107_assert(
  :'p107_catalog_create'::JSONB = :'p107_catalog_create_replay'::JSONB
    AND :'p107_catalog_create'::JSONB ->> 'catalog_institution_id'
      = :'p107_catalog_institution_id'
    AND :'p107_catalog_create'::JSONB ->> 'expected_version' = '0'
    AND :'p107_catalog_create'::JSONB ->> 'version' = '1'
    AND (
      SELECT count(*)
      FROM platform.university_applications AS application
      WHERE application.student_case_id = :'p107_case_id'
        AND application.catalog_institution_id = :'p107_catalog_institution_id'
        AND application.program_name = 'Data Science'
        AND application.version = 1
    ) = 1,
  'Catalog application create/replay/version contract failed'
);

-- Visa case: identical create and change requests replay exactly, while an
-- independent stale write maps to the error understood by the server action.
SELECT platform.create_visa_case(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_status => 'not_started',
  p_evidence_reference => 'synthetic:visa:create',
  p_note => 'Isolated visa case',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000201'
)::TEXT AS p107_visa_create
\gset
SELECT platform.create_visa_case(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_status => 'not_started',
  p_evidence_reference => 'synthetic:visa:create',
  p_note => 'Isolated visa case',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000201'
)::TEXT AS p107_visa_create_replay
\gset

SELECT (:'p107_visa_create'::JSONB ->> 'visa_case_id')::UUID
  AS p107_visa_case_id
\gset

SELECT platform.change_visa_case(
  p_organization_id => :'p107_org_id',
  p_visa_case_id => :'p107_visa_case_id',
  p_new_status => 'docs',
  p_evidence_reference => 'synthetic:visa:docs',
  p_note => 'Documents collected',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000202'
)::TEXT AS p107_visa_change
\gset
SELECT platform.change_visa_case(
  p_organization_id => :'p107_org_id',
  p_visa_case_id => :'p107_visa_case_id',
  p_new_status => 'docs',
  p_evidence_reference => 'synthetic:visa:docs',
  p_note => 'Documents collected',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000202'
)::TEXT AS p107_visa_change_replay
\gset

SELECT pg_temp.p107_capture_error(pg_catalog.format(
  'SELECT platform.change_visa_case('
    || 'p_organization_id => %L::UUID, p_visa_case_id => %L::UUID, '
    || 'p_new_status => %L::platform.visa_status, '
    || 'p_evidence_reference => %L, p_note => %L, '
    || 'p_expected_version => 1, p_request_id => %L::UUID)',
  :'p107_org_id',
  :'p107_visa_case_id',
  'appointment',
  'synthetic:visa:stale',
  'Stale visa write',
  '59700000-0000-4000-8000-000000000203'
))::TEXT AS p107_visa_stale
\gset

SELECT pg_temp.p107_assert(
  :'p107_visa_create'::JSONB = :'p107_visa_create_replay'::JSONB
    AND :'p107_visa_create'::JSONB ->> 'expected_version' = '0'
    AND :'p107_visa_create'::JSONB ->> 'version' = '1'
    AND :'p107_visa_change'::JSONB = :'p107_visa_change_replay'::JSONB
    AND :'p107_visa_change'::JSONB ->> 'expected_version' = '1'
    AND :'p107_visa_change'::JSONB ->> 'version' = '2'
    AND :'p107_visa_stale'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p107_visa_stale'::JSONB ->> 'message'
      = 'admissions_version_conflict'
    AND (
      SELECT visa.version = 2 AND visa.status = 'docs'
      FROM platform.visa_cases AS visa
      WHERE visa.id = :'p107_visa_case_id'
    )
    AND (
      SELECT count(*)
      FROM platform.visa_cases AS visa
      WHERE visa.student_case_id = :'p107_case_id'
        AND visa.id = :'p107_visa_case_id'
    ) = 1,
  'Visa create/change/replay/stale-write contract failed'
);

-- Admissions task: Admin assigns the existing case owner. The task action has
-- its own established conflict message, which this database contract retains.
SELECT platform.create_case_task(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_task_type => 'document_follow_up',
  p_title => 'Migration 107 isolated task',
  p_assignee_membership_id => :'p107_curator_membership_id',
  p_priority => 'normal',
  p_due_at => '2027-09-05T12:00:00Z',
  p_status => 'open',
  p_student_visible => FALSE,
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000301'
)::TEXT AS p107_task_create
\gset
SELECT platform.create_case_task(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_task_type => 'document_follow_up',
  p_title => 'Migration 107 isolated task',
  p_assignee_membership_id => :'p107_curator_membership_id',
  p_priority => 'normal',
  p_due_at => '2027-09-05T12:00:00Z',
  p_status => 'open',
  p_student_visible => FALSE,
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000301'
)::TEXT AS p107_task_create_replay
\gset

SELECT (:'p107_task_create'::JSONB ->> 'case_task_id')::UUID
  AS p107_case_task_id
\gset

SELECT platform.change_case_task(
  p_organization_id => :'p107_org_id',
  p_case_task_id => :'p107_case_task_id',
  p_new_status => 'in_progress',
  p_new_assignee_membership_id => :'p107_curator_membership_id',
  p_priority => 'high',
  p_due_at => '2027-09-06T12:00:00Z',
  p_student_visible => FALSE,
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000302'
)::TEXT AS p107_task_change
\gset
SELECT platform.change_case_task(
  p_organization_id => :'p107_org_id',
  p_case_task_id => :'p107_case_task_id',
  p_new_status => 'in_progress',
  p_new_assignee_membership_id => :'p107_curator_membership_id',
  p_priority => 'high',
  p_due_at => '2027-09-06T12:00:00Z',
  p_student_visible => FALSE,
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000302'
)::TEXT AS p107_task_change_replay
\gset

SELECT pg_temp.p107_capture_error(pg_catalog.format(
  'SELECT platform.change_case_task('
    || 'p_organization_id => %L::UUID, p_case_task_id => %L::UUID, '
    || 'p_new_status => %L::platform.case_task_status, '
    || 'p_new_assignee_membership_id => %L::UUID, '
    || 'p_priority => %L::platform.case_task_priority, '
    || 'p_due_at => %L::TIMESTAMPTZ, p_student_visible => FALSE, '
    || 'p_expected_version => 1, p_request_id => %L::UUID)',
  :'p107_org_id',
  :'p107_case_task_id',
  'done',
  :'p107_curator_membership_id',
  'high',
  '2027-09-06T12:00:00Z',
  '59700000-0000-4000-8000-000000000303'
))::TEXT AS p107_task_stale
\gset

SELECT pg_temp.p107_assert(
  :'p107_task_create'::JSONB = :'p107_task_create_replay'::JSONB
    AND :'p107_task_create'::JSONB ->> 'expected_version' = '0'
    AND :'p107_task_create'::JSONB ->> 'version' = '1'
    AND :'p107_task_change'::JSONB = :'p107_task_change_replay'::JSONB
    AND :'p107_task_change'::JSONB ->> 'expected_version' = '1'
    AND :'p107_task_change'::JSONB ->> 'version' = '2'
    AND :'p107_task_stale'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p107_task_stale'::JSONB ->> 'message'
      = 'case_task_version_conflict'
    AND (
      SELECT task.version = 2 AND task.status = 'in_progress'
      FROM platform.case_tasks AS task
      WHERE task.id = :'p107_case_task_id'
    )
    AND (
      SELECT count(*)
      FROM platform.case_tasks AS task
      WHERE task.student_case_id = :'p107_case_id'
        AND task.title = 'Migration 107 isolated task'
    ) = 1,
  'Task create/change/replay/stale-write contract failed'
);

-- Finance stop: the case-bound surface is the sole public authority. It
-- creates at version one, releases at version two, and fails stale requests
-- before any alternate or broad resolver can act.
SELECT platform.assert_case_finance_stop_factor(
  p_student_case_id => :'p107_case_id',
  p_payment_obligation_id => '59700000-0000-4000-8000-000000000001',
  p_reason => 'Migration 107 isolated finance hold',
  p_blocked_action => 'application.submit',
  p_next_action => 'Confirm the isolated payment',
  p_evidence_ref => 'synthetic:finance:hold',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000401'
)::TEXT AS p107_stop_create
\gset
SELECT platform.assert_case_finance_stop_factor(
  p_student_case_id => :'p107_case_id',
  p_payment_obligation_id => '59700000-0000-4000-8000-000000000001',
  p_reason => 'Migration 107 isolated finance hold',
  p_blocked_action => 'application.submit',
  p_next_action => 'Confirm the isolated payment',
  p_evidence_ref => 'synthetic:finance:hold',
  p_expected_version => 0,
  p_request_id => '59700000-0000-4000-8000-000000000401'
)::TEXT AS p107_stop_create_replay
\gset

SELECT (:'p107_stop_create'::JSONB ->> 'stop_factor_id')::UUID
  AS p107_stop_factor_id
\gset

SELECT platform.resolve_case_stop_factor(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_stop_factor_id => :'p107_stop_factor_id',
  p_resolution_kind => 'admin_override',
  p_payment_event_id => NULL,
  p_reason => 'Migration 107 isolated release',
  p_evidence_ref => 'synthetic:finance:release',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000402'
)::TEXT AS p107_stop_resolve
\gset
SELECT platform.resolve_case_stop_factor(
  p_organization_id => :'p107_org_id',
  p_student_case_id => :'p107_case_id',
  p_stop_factor_id => :'p107_stop_factor_id',
  p_resolution_kind => 'admin_override',
  p_payment_event_id => NULL,
  p_reason => 'Migration 107 isolated release',
  p_evidence_ref => 'synthetic:finance:release',
  p_expected_version => 1,
  p_request_id => '59700000-0000-4000-8000-000000000402'
)::TEXT AS p107_stop_resolve_replay
\gset

SELECT pg_temp.p107_capture_error(pg_catalog.format(
  'SELECT platform.resolve_case_stop_factor('
    || 'p_organization_id => %L::UUID, p_student_case_id => %L::UUID, '
    || 'p_stop_factor_id => %L::UUID, '
    || 'p_resolution_kind => %L::platform.stop_factor_resolution_kind, '
    || 'p_payment_event_id => NULL, p_reason => %L, p_evidence_ref => %L, '
    || 'p_expected_version => 1, p_request_id => %L::UUID)',
  :'p107_org_id',
  :'p107_case_id',
  :'p107_stop_factor_id',
  'admin_override',
  'Stale finance release',
  'synthetic:finance:stale',
  '59700000-0000-4000-8000-000000000403'
))::TEXT AS p107_stop_stale
\gset

SELECT pg_temp.p107_assert(
  :'p107_stop_create'::JSONB = :'p107_stop_create_replay'::JSONB
    AND :'p107_stop_create'::JSONB ->> 'expected_version' = '0'
    AND :'p107_stop_create'::JSONB ->> 'version' = '1'
    AND :'p107_stop_resolve'::JSONB = :'p107_stop_resolve_replay'::JSONB
    AND :'p107_stop_resolve'::JSONB ->> 'expected_version' = '1'
    AND :'p107_stop_resolve'::JSONB ->> 'version' = '2'
    AND :'p107_stop_stale'::JSONB ->> 'sqlstate' = 'PT409'
    AND :'p107_stop_stale'::JSONB ->> 'message'
      = 'admissions_version_conflict'
    AND (
      SELECT stop.version = 2 AND stop.status = 'resolved'
      FROM platform.stop_factors AS stop
      WHERE stop.id = :'p107_stop_factor_id'
    )
    AND (
      SELECT count(*)
      FROM platform.stop_factors AS stop
      WHERE stop.student_case_id = :'p107_case_id'
        AND stop.payment_obligation_id =
          '59700000-0000-4000-8000-000000000001'
        AND stop.reason = 'Migration 107 isolated finance hold'
    ) = 1,
  'Finance stop create/resolve/replay/stale-write contract failed'
);

-- Every successful unique request produces one audit event; exact replays do
-- not duplicate rows or change the returned command result.
RESET ROLE;
SELECT pg_temp.p107_assert(
  (
    SELECT count(*)
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '59700000-0000-4000-8000-000000000101',
      '59700000-0000-4000-8000-000000000102',
      '59700000-0000-4000-8000-000000000111',
      '59700000-0000-4000-8000-000000000201',
      '59700000-0000-4000-8000-000000000202',
      '59700000-0000-4000-8000-000000000301',
      '59700000-0000-4000-8000-000000000302',
      '59700000-0000-4000-8000-000000000401',
      '59700000-0000-4000-8000-000000000402'
    )
  ) = 9,
  'Successful command replay duplicated or omitted audit events'
);

RESET request.jwt.claims;
ROLLBACK;

SELECT 'platform migration 107 admissions versioning contract passed'
  AS result;
