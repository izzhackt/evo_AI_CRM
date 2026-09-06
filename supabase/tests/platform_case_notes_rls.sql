\set ON_ERROR_STOP on

-- Focused current-boundary acceptance for migration 117 (append-only case
-- notes). The synthetic organization, identities, leads and cases exist only
-- inside this rolled-back transaction.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p117_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 117 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p117_capture_error(p_statement TEXT)
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

GRANT EXECUTE ON FUNCTION pg_temp.p117_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p117_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  routine_oid OID;
  routine_count INTEGER;
  forbidden_role TEXT;
  expected_signature TEXT;
  rpc_name TEXT;
  api_role TEXT;
  table_privilege TEXT;
BEGIN
  IF to_regclass('platform.case_notes') IS NULL THEN
    RAISE EXCEPTION 'platform.case_notes is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'case_notes'
      AND column_name = 'body'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'case_notes'
      AND column_name = 'created_by_membership_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'case_notes body/author contract drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'case_notes'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'case_notes RLS is not enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'platform'
      AND policy.tablename = 'case_notes'
  ) THEN
    RAISE EXCEPTION
      'case_notes unexpectedly has an RLS policy; access is RPC-only';
  END IF;

  FOREACH api_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    FOREACH table_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(
        api_role,
        'platform.case_notes',
        table_privilege
      ) THEN
        RAISE EXCEPTION '% unexpectedly holds % on case_notes',
          api_role, table_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'platform.case_notes'::REGCLASS
      AND trigger_row.tgname = 'case_notes_append_only'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'case_notes append-only trigger is missing';
  END IF;

  FOR rpc_name, expected_signature IN
    SELECT * FROM (VALUES
      (
        'create_case_note',
        'p_organization_id uuid, p_lead_id uuid, p_student_case_id uuid, p_body text, p_request_id uuid'
      ),
      (
        'list_case_notes',
        'p_lead_id uuid, p_student_case_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_note_id uuid'
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
      RAISE EXCEPTION 'platform.% signature or single-path contract drifted',
        rpc_name;
    END IF;

    IF NOT COALESCE((
      SELECT routine.prosecdef
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
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

  IF NOT ('note.create' = ANY (platform_private.p7a_safe_audit_actions())) THEN
    RAISE EXCEPTION 'note.create is absent from the Admin audit journal';
  END IF;
  IF NOT ('lead' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR NOT (
      'student_case' = ANY (platform_private.p7a_safe_audit_resource_types())
    )
  THEN
    RAISE EXCEPTION 'note subject resource types left the Admin journal';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p117_admin_bundle, bundle.version AS p117_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'lead.sales.workflow.manage'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_sales_bundle, bundle.version AS p117_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'lead.sales.workflow.manage'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_curator_bundle, bundle.version AS p117_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_student_bundle, bundle.version AS p117_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p117_org 59911700-0000-4000-8000-000000000001
\set p117_other_org 59911700-0000-4000-8000-000000000002
\set p117_org_scope 59911700-0000-4000-8000-000000000003
\set p117_case_scope 59911700-0000-4000-8000-000000000004
\set p117_case 59911700-0000-4000-8000-000000000005
\set p117_admin_user 59911700-0000-4000-8000-000000000011
\set p117_sales_user 59911700-0000-4000-8000-000000000012
\set p117_sales_two_user 59911700-0000-4000-8000-000000000013
\set p117_curator_user 59911700-0000-4000-8000-000000000014
\set p117_student_user 59911700-0000-4000-8000-000000000015
\set p117_admin_profile 59911700-0000-4000-8000-000000000021
\set p117_sales_profile 59911700-0000-4000-8000-000000000022
\set p117_sales_two_profile 59911700-0000-4000-8000-000000000023
\set p117_curator_profile 59911700-0000-4000-8000-000000000024
\set p117_student_profile 59911700-0000-4000-8000-000000000025
\set p117_admin_membership 59911700-0000-4000-8000-000000000031
\set p117_sales_membership 59911700-0000-4000-8000-000000000032
\set p117_sales_two_membership 59911700-0000-4000-8000-000000000033
\set p117_curator_membership 59911700-0000-4000-8000-000000000034
\set p117_student_membership 59911700-0000-4000-8000-000000000035
\set p117_lead_owned 59911700-0000-4000-8000-000000000061
\set p117_lead_unowned 59911700-0000-4000-8000-000000000062
\set p117_lead_foreign_owner 59911700-0000-4000-8000-000000000063

INSERT INTO platform.organizations (id, name) VALUES
  (:'p117_org', 'Migration 117 Organization'),
  (:'p117_other_org', 'Migration 117 Other Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p117_org_scope', :'p117_org', 'organization', :'p117_org', 1),
  (:'p117_case_scope', :'p117_org', 'student_case', :'p117_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p117_admin_user', 'p117-admin@example.invalid', '{}'::JSONB),
  (:'p117_sales_user', 'p117-sales@example.invalid', '{}'::JSONB),
  (:'p117_sales_two_user', 'p117-sales-two@example.invalid', '{}'::JSONB),
  (:'p117_curator_user', 'p117-curator@example.invalid', '{}'::JSONB),
  (:'p117_student_user', 'p117-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p117_admin_profile', :'p117_admin_user', 'Migration 117 Admin', 'active', 1),
  (:'p117_sales_profile', :'p117_sales_user', 'Migration 117 Sales', 'active', 1),
  (:'p117_sales_two_profile', :'p117_sales_two_user', 'Migration 117 Second Sales', 'active', 1),
  (:'p117_curator_profile', :'p117_curator_user', 'Migration 117 Curator', 'active', 1),
  (:'p117_student_profile', :'p117_student_user', 'Migration 117 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p117_admin_membership', :'p117_org', :'p117_admin_profile', 'active', 'admin', :'p117_admin_bundle'),
  (:'p117_sales_membership', :'p117_org', :'p117_sales_profile', 'active', 'sales', :'p117_sales_bundle'),
  (:'p117_sales_two_membership', :'p117_org', :'p117_sales_two_profile', 'active', 'sales', :'p117_sales_bundle'),
  (:'p117_curator_membership', :'p117_org', :'p117_curator_profile', 'active', 'curator', :'p117_curator_bundle'),
  (:'p117_student_membership', :'p117_org', :'p117_student_profile', 'active', 'student', :'p117_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911700-0000-4000-8000-000000000041', :'p117_org', :'p117_admin_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Admin org scope', '59911700-0000-4000-8000-000000000141'),
  ('59911700-0000-4000-8000-000000000042', :'p117_org', :'p117_sales_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Sales org scope', '59911700-0000-4000-8000-000000000142'),
  ('59911700-0000-4000-8000-000000000043', :'p117_org', :'p117_sales_two_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Second Sales org scope', '59911700-0000-4000-8000-000000000143'),
  ('59911700-0000-4000-8000-000000000044', :'p117_org', :'p117_curator_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Curator org scope', '59911700-0000-4000-8000-000000000144'),
  ('59911700-0000-4000-8000-000000000045', :'p117_org', :'p117_sales_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Sales case scope', '59911700-0000-4000-8000-000000000145'),
  ('59911700-0000-4000-8000-000000000046', :'p117_org', :'p117_curator_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Curator case scope', '59911700-0000-4000-8000-000000000146'),
  ('59911700-0000-4000-8000-000000000047', :'p117_org', :'p117_student_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Student case scope', '59911700-0000-4000-8000-000000000147');

INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id,
  stage_key, source_key, lifecycle_state
) VALUES
  (:'p117_lead_owned', :'p117_org', NULL, :'p117_sales_membership', 'new', 'whatsapp', 'open'),
  (:'p117_lead_unowned', :'p117_org', NULL, NULL, 'new', 'whatsapp', 'open'),
  (:'p117_lead_foreign_owner', :'p117_org', NULL, :'p117_sales_two_membership', 'new', 'whatsapp', 'open');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p117_case', :'p117_org', :'p117_student_membership',
  :'p117_sales_membership', NULL,
  'synthetic:p117:case', 'contract:p117', '2026-09-05T09:00:00Z',
  'Migration 117 Student', 'United Kingdom', 'Bachelor', 'Business',
  '2031', 'approved', 'contract_confirmed', 'pending', NULL, NULL,
  'Record the first case note', :'p117_case_scope', 1
);

SELECT jsonb_build_object(
  'sub', :'p117_admin_user', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_admin_membership',
  'platform_bundle_id', :'p117_admin_bundle',
  'platform_bundle_version', :'p117_admin_version'::INTEGER
)::TEXT AS p117_admin_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_admin_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p117_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_sales_membership',
  'platform_bundle_id', :'p117_sales_bundle',
  'platform_bundle_version', :'p117_sales_version'::INTEGER
)::TEXT AS p117_sales_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_sales_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p117_student_user', 'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_student_membership',
  'platform_bundle_id', :'p117_student_bundle',
  'platform_bundle_version', :'p117_student_version'::INTEGER
)::TEXT AS p117_student_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_student_profile'
\gset

-- Sales writes and replays a note on an owned lead; the same request id with
-- a different body is a conflict, not a second note.
SET request.jwt.claims TO :'p117_sales_claims';
SET ROLE authenticated;

SELECT platform.create_case_note(
  p_organization_id => :'p117_org',
  p_lead_id => :'p117_lead_owned',
  p_student_case_id => NULL,
  p_body => E'First contact done.\nStudent asks about UK foundation year.',
  p_request_id => '59911700-0000-4000-8000-000000000201'
)::TEXT AS p117_lead_note_create
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL,
  E'First contact done.\nStudent asks about UK foundation year.',
  '59911700-0000-4000-8000-000000000201'
)::TEXT AS p117_lead_note_replay
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Different body, same request',
  '59911700-0000-4000-8000-000000000201'
))::TEXT AS p117_request_conflict_error
\gset

SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL, 'Second note on the owned lead.',
  '59911700-0000-4000-8000-000000000202'
)::TEXT AS p117_lead_note_two
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL, 'Third note on the owned lead.',
  '59911700-0000-4000-8000-000000000203'
)::TEXT AS p117_lead_note_three
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_unowned', NULL, 'Unowned leads accept sales notes.',
  '59911700-0000-4000-8000-000000000204'
)::TEXT AS p117_unowned_lead_note
\gset

-- Validation and authority failures stay closed.
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_foreign_owner', 'Not my lead',
  '59911700-0000-4000-8000-000000000205'
))::TEXT AS p117_foreign_owner_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', :'p117_case', 'Two subjects',
  '59911700-0000-4000-8000-000000000206'
))::TEXT AS p117_two_subjects_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, NULL, %L, %L::UUID)',
  :'p117_org', 'No subject',
  '59911700-0000-4000-8000-000000000207'
))::TEXT AS p117_no_subject_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', '   ',
  '59911700-0000-4000-8000-000000000208'
))::TEXT AS p117_blank_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', repeat('a', 4001),
  '59911700-0000-4000-8000-000000000209'
))::TEXT AS p117_long_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', E'bell\x07character',
  '59911700-0000-4000-8000-000000000210'
))::TEXT AS p117_control_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, NULL)',
  :'p117_org', :'p117_lead_owned', 'Missing request id'
))::TEXT AS p117_null_request_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_other_org', :'p117_lead_owned', 'Cross-organization write',
  '59911700-0000-4000-8000-000000000211'
))::TEXT AS p117_cross_org_error
\gset

-- Sales writes on the pending case it owns.
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Pending case note from Sales.',
  '59911700-0000-4000-8000-000000000212'
)::TEXT AS p117_case_note_sales
\gset

-- Direct table access is closed even for an authorized staff session.
SELECT pg_temp.p117_capture_error(
  'SELECT count(*) FROM platform.case_notes'
)::TEXT AS p117_direct_select_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'INSERT INTO platform.case_notes '
    || '(organization_id, lead_id, body, created_by_membership_id) '
    || 'VALUES (%L::UUID, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Direct insert',
  :'p117_sales_membership'
))::TEXT AS p117_direct_insert_error
\gset

RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_lead_note_create'::JSONB = :'p117_lead_note_replay'::JSONB
    AND :'p117_lead_note_create'::JSONB ->> 'lead_id' = :'p117_lead_owned'
    AND :'p117_lead_note_create'::JSONB -> 'student_case_id' = 'null'::JSONB
    AND :'p117_lead_note_create'::JSONB ->> 'created_by_membership_id'
      = :'p117_sales_membership'
    AND (:'p117_lead_note_create'::JSONB ->> 'body') LIKE E'%\n%'
    AND :'p117_request_conflict_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_foreign_owner_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_two_subjects_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_no_subject_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_blank_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_long_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_control_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_null_request_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_cross_org_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_direct_select_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_direct_insert_error'::JSONB ->> 'sqlstate' = '42501',
  'lead note create/replay/validation/tenancy/direct-access contract drifted'
);

SELECT pg_temp.p117_assert(
  (
    SELECT count(*)
    FROM platform.case_notes AS note
    WHERE note.organization_id = :'p117_org'
  ) = 5
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id = '59911700-0000-4000-8000-000000000201'
        AND event.action = 'note.create'
        AND event.resource_type = 'lead'
        AND event.resource_id = :'p117_lead_owned'
        AND event.before_state IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id = '59911700-0000-4000-8000-000000000212'
        AND event.action = 'note.create'
        AND event.resource_type = 'student_case'
        AND event.resource_id = :'p117_case'
    ),
  'note durable state or Admin-journal audit facts drifted'
);

-- Keyset listing: newest-first, complete cursor, no duplicates across pages.
SET ROLE authenticated;
SELECT pg_temp.p117_assert(
  (
    WITH full_page AS (
      SELECT
        page.case_note_id,
        page.created_at,
        page.author_display_name,
        row_number() OVER () AS position
      FROM platform.list_case_notes(:'p117_lead_owned', NULL, 101) AS page
    ),
    first_page AS (
      SELECT page.case_note_id, page.created_at,
        row_number() OVER () AS position
      FROM platform.list_case_notes(:'p117_lead_owned', NULL, 2) AS page
    ),
    cursor_row AS (
      SELECT * FROM first_page WHERE position = 2
    ),
    second_page AS (
      SELECT page.case_note_id
      FROM cursor_row
      CROSS JOIN LATERAL platform.list_case_notes(
        :'p117_lead_owned', NULL, 101,
        cursor_row.created_at, cursor_row.case_note_id
      ) AS page
    )
    SELECT (SELECT count(*) FROM full_page) = 3
      AND (SELECT count(*) FROM first_page) = 2
      AND (SELECT bool_and(author_display_name = 'Migration 117 Sales')
        FROM full_page)
      AND NOT EXISTS (
        SELECT 1
        FROM full_page AS later
        JOIN full_page AS earlier ON earlier.position = later.position + 1
        WHERE (earlier.created_at, earlier.case_note_id)
          > (later.created_at, later.case_note_id)
      )
      AND (SELECT array_agg(case_note_id ORDER BY position) FROM first_page)
        = (
          SELECT array_agg(case_note_id ORDER BY position)
          FROM full_page WHERE position <= 2
        )
      AND (SELECT array_agg(case_note_id) FROM second_page)
        = (
          SELECT array_agg(case_note_id ORDER BY position)
          FROM full_page WHERE position = 3
        )
  ),
  'lead note keyset pagination drifted'
);

SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 0)',
  :'p117_lead_owned'
))::TEXT AS p117_zero_limit_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 102)',
  :'p117_lead_owned'
))::TEXT AS p117_high_limit_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, %L::UUID, 10)',
  :'p117_lead_owned', :'p117_case'
))::TEXT AS p117_list_two_subjects_error
\gset
SELECT pg_temp.p117_capture_error(
  'SELECT count(*) FROM platform.list_case_notes(NULL, NULL, 10)'
)::TEXT AS p117_list_no_subject_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10, '
    || 'statement_timestamp(), NULL)',
  :'p117_lead_owned'
))::TEXT AS p117_half_cursor_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10)',
  :'p117_lead_foreign_owner'
))::TEXT AS p117_list_foreign_owner_error
\gset

RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_zero_limit_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_high_limit_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_two_subjects_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_no_subject_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_half_cursor_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_foreign_owner_error'::JSONB ->> 'sqlstate' = '42501',
  'list validation or lead visibility contract drifted'
);

-- The Student never reads or writes staff notes.
RESET request.jwt.claims;
SET request.jwt.claims TO :'p117_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Student note attempt',
  '59911700-0000-4000-8000-000000000213'
))::TEXT AS p117_student_create_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(NULL, %L::UUID, 10)',
  :'p117_case'
))::TEXT AS p117_student_list_error
\gset
RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_student_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_student_list_error'::JSONB ->> 'sqlstate' = '42501',
  'student unexpectedly touched staff case notes'
);

-- Handoff: curator fails before assignment, owns the case after it, and the
-- former Sales owner then fails closed while Admin remains the superset.
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_curator_membership',
  'platform_bundle_id', :'p117_curator_bundle',
  'platform_bundle_version', :'p117_curator_version'::INTEGER
)::TEXT AS p117_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_curator_profile'
\gset

SET request.jwt.claims TO :'p117_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Curator note before handoff',
  '59911700-0000-4000-8000-000000000214'
))::TEXT AS p117_curator_pending_error
\gset

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'p117_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p117_org', :'p117_case', :'p117_curator_membership',
  'Activate migration 117 case',
  '59911700-0000-4000-8000-000000000215'
);
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Admin note after handoff.',
  '59911700-0000-4000-8000-000000000216'
)::TEXT AS p117_case_note_admin
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_foreign_owner', NULL,
  'Admin can note every lead of the organization.',
  '59911700-0000-4000-8000-000000000217'
)::TEXT AS p117_admin_foreign_lead_note
\gset

RESET ROLE;
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_curator_membership',
  'platform_bundle_id', :'p117_curator_bundle',
  'platform_bundle_version', :'p117_curator_version'::INTEGER
)::TEXT AS p117_curator_claims_active
FROM platform.profiles AS profile
WHERE profile.id = :'p117_curator_profile'
\gset
SET request.jwt.claims TO :'p117_curator_claims_active';
SET ROLE authenticated;
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Curator note after handoff.',
  '59911700-0000-4000-8000-000000000218'
)::TEXT AS p117_case_note_curator
\gset
SELECT count(*) AS p117_curator_case_note_count
FROM platform.list_case_notes(NULL, :'p117_case', 101)
\gset

RESET ROLE;
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_sales_membership',
  'platform_bundle_id', :'p117_sales_bundle',
  'platform_bundle_version', :'p117_sales_version'::INTEGER
)::TEXT AS p117_sales_claims_after
FROM platform.profiles AS profile
WHERE profile.id = :'p117_sales_profile'
\gset
SET request.jwt.claims TO :'p117_sales_claims_after';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Sales after handoff',
  '59911700-0000-4000-8000-000000000219'
))::TEXT AS p117_sales_active_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(NULL, %L::UUID, 10)',
  :'p117_case'
))::TEXT AS p117_sales_active_list_error
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p117_assert(
  :'p117_curator_pending_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_case_note_admin'::JSONB ->> 'student_case_id' = :'p117_case'
    AND :'p117_admin_foreign_lead_note'::JSONB ->> 'lead_id'
      = :'p117_lead_foreign_owner'
    AND :'p117_case_note_curator'::JSONB ->> 'created_by_membership_id'
      = :'p117_curator_membership'
    AND :'p117_curator_case_note_count'::BIGINT = 3
    AND :'p117_sales_active_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_sales_active_list_error'::JSONB ->> 'sqlstate' = '42501',
  'handoff authority rotation for case notes drifted'
);

-- Notes are append-only facts even for privileged sessions.
SELECT pg_temp.p117_capture_error(format(
  'UPDATE platform.case_notes SET body = %L WHERE organization_id = %L::UUID',
  'Rewritten history', :'p117_org'
))::TEXT AS p117_update_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'DELETE FROM platform.case_notes WHERE organization_id = %L::UUID',
  :'p117_org'
))::TEXT AS p117_delete_error
\gset
SELECT pg_temp.p117_assert(
  :'p117_update_error'::JSONB ->> 'sqlstate' = '55000'
    AND :'p117_delete_error'::JSONB ->> 'sqlstate' = '55000',
  'case notes were not append-only'
);

-- anon holds no door at all.
SET ROLE anon;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Anonymous note',
  '59911700-0000-4000-8000-000000000220'
))::TEXT AS p117_anon_create_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10)',
  :'p117_lead_owned'
))::TEXT AS p117_anon_list_error
\gset
RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_anon_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_anon_list_error'::JSONB ->> 'sqlstate' = '42501',
  'anon unexpectedly reached case notes'
);

RESET request.jwt.claims;
ROLLBACK;
