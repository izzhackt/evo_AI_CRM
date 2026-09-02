\set ON_ERROR_STOP on

-- P4 real-PostgreSQL proof for the authenticated Admissions queue, grouped
-- private-document history, case-bound finance assertion and Admin-only
-- release contracts. Every fixture is synthetic and transaction-local.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p4_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P4 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_task_queue(p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(queue_row)), '[]'::JSONB)
  INTO payload
  FROM platform.staff_case_task_queue(p_limit) AS queue_row;
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_visa_queue(p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(queue_row)), '[]'::JSONB)
  INTO payload
  FROM platform.staff_visa_queue(p_limit) AS queue_row;
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_document_queue(p_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(queue_row)), '[]'::JSONB)
  INTO payload
  FROM platform.staff_document_queue(p_limit) AS queue_row;
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_document_workspace(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := platform.staff_student_case_document_workspace(p_student_case_id);
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_assert_stop(
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := platform.assert_case_finance_stop_factor(
    p_student_case_id,
    p_payment_obligation_id,
    'Synthetic P4 finance stop',
    'application_submission',
    'Confirm the required payment evidence',
    'evidence:p4:finance-stop',
    p_request_id
  );
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p4_attempt_resolve_stop(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_stop_factor_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := platform.resolve_case_stop_factor(
    p_organization_id,
    p_student_case_id,
    p_stop_factor_id,
    'admin_override',
    NULL,
    'Synthetic P4 Admin release',
    'evidence:p4:admin-release',
    p_request_id
  );
  RETURN jsonb_build_object('ok', TRUE, 'result', payload);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p4_assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_task_queue(INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_visa_queue(INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_document_queue(INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_document_workspace(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_assert_stop(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.p4_attempt_resolve_stop(
  UUID,
  UUID,
  UUID,
  UUID
) TO authenticated;

SELECT pg_temp.p4_assert_true(
  has_function_privilege(
    'authenticated',
    'platform.staff_case_task_queue(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_visa_queue(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_document_queue(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_student_case_document_workspace(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_case_task_queue(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_student_case_document_workspace(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.assert_case_finance_stop_factor(uuid,uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'P4 staff RPC grants must be authenticated-cookie only'
);

SELECT pg_temp.p4_assert_true(
  (
    SELECT count(*) = 6
      AND bool_and(
        pg_get_userbyid(routine.proowner) = 'postgres'
        AND routine.prosecdef
        AND array_to_string(routine.proconfig, ',') = 'search_path=""'
        AND CASE
          WHEN routine.proname IN (
            'staff_case_task_queue',
            'staff_visa_queue',
            'staff_document_queue',
            'staff_student_case_document_workspace'
          ) THEN routine.provolatile = 's'
          ELSE routine.provolatile = 'v'
        END
      )
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'staff_case_task_queue',
        'staff_visa_queue',
        'staff_document_queue',
        'staff_student_case_document_workspace',
        'assert_case_finance_stop_factor',
        'resolve_case_stop_factor'
      )
  ),
  'P4 RPC owner, security, search-path or volatility posture drifted'
);

\set p4_org_a '95000000-0000-4000-8000-000000000001'
\set p4_org_b '95000000-0000-4000-8000-000000000002'
\set p4_org_scope_a '95000000-0000-4000-8000-000000000011'
\set p4_org_scope_b '95000000-0000-4000-8000-000000000012'
\set p4_case_scope_a '95000000-0000-4000-8000-000000000013'
\set p4_case_scope_b '95000000-0000-4000-8000-000000000014'
\set p4_case_a '95000000-0000-4000-8000-000000000021'
\set p4_case_b '95000000-0000-4000-8000-000000000022'

\set p4_admin_a_user '95000000-0000-4000-8000-000000000101'
\set p4_sales_a_user '95000000-0000-4000-8000-000000000102'
\set p4_curator_a_user '95000000-0000-4000-8000-000000000103'
\set p4_student_a_user '95000000-0000-4000-8000-000000000104'
\set p4_admin_b_user '95000000-0000-4000-8000-000000000105'
\set p4_sales_b_user '95000000-0000-4000-8000-000000000106'
\set p4_curator_b_user '95000000-0000-4000-8000-000000000107'
\set p4_student_b_user '95000000-0000-4000-8000-000000000108'

\set p4_admin_a_profile '95000000-0000-4000-8000-000000000201'
\set p4_sales_a_profile '95000000-0000-4000-8000-000000000202'
\set p4_curator_a_profile '95000000-0000-4000-8000-000000000203'
\set p4_student_a_profile '95000000-0000-4000-8000-000000000204'
\set p4_admin_b_profile '95000000-0000-4000-8000-000000000205'
\set p4_sales_b_profile '95000000-0000-4000-8000-000000000206'
\set p4_curator_b_profile '95000000-0000-4000-8000-000000000207'
\set p4_student_b_profile '95000000-0000-4000-8000-000000000208'

\set p4_admin_a_membership '95000000-0000-4000-8000-000000000301'
\set p4_sales_a_membership '95000000-0000-4000-8000-000000000302'
\set p4_curator_a_membership '95000000-0000-4000-8000-000000000303'
\set p4_student_a_membership '95000000-0000-4000-8000-000000000304'
\set p4_admin_b_membership '95000000-0000-4000-8000-000000000305'
\set p4_sales_b_membership '95000000-0000-4000-8000-000000000306'
\set p4_curator_b_membership '95000000-0000-4000-8000-000000000307'
\set p4_student_b_membership '95000000-0000-4000-8000-000000000308'

\set p4_task_a '95000000-0000-4000-8000-000000000401'
\set p4_task_b '95000000-0000-4000-8000-000000000402'
\set p4_visa_a '95000000-0000-4000-8000-000000000411'
\set p4_visa_b '95000000-0000-4000-8000-000000000412'
\set p4_requirement_a '95000000-0000-4000-8000-000000000421'
\set p4_requirement_b '95000000-0000-4000-8000-000000000422'
\set p4_slot_a '95000000-0000-4000-8000-000000000431'
\set p4_slot_b '95000000-0000-4000-8000-000000000432'
\set p4_obligation_a '95000000-0000-4000-8000-000000000441'
\set p4_obligation_b '95000000-0000-4000-8000-000000000442'

SELECT
  bundle.id AS p4_admin_bundle,
  bundle.version AS p4_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT
  bundle.id AS p4_sales_bundle,
  bundle.version AS p4_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT
  bundle.id AS p4_curator_bundle,
  bundle.version AS p4_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT
  bundle.id AS p4_student_bundle,
  bundle.version AS p4_student_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p4_org_a', 'P4 Organization A'),
  (:'p4_org_b', 'P4 Organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p4_admin_a_user', 'p4-admin-a@example.invalid', '{}'),
  (:'p4_sales_a_user', 'p4-sales-a@example.invalid', '{}'),
  (:'p4_curator_a_user', 'p4-curator-a@example.invalid', '{}'),
  (:'p4_student_a_user', 'p4-student-a@example.invalid', '{}'),
  (:'p4_admin_b_user', 'p4-admin-b@example.invalid', '{}'),
  (:'p4_sales_b_user', 'p4-sales-b@example.invalid', '{}'),
  (:'p4_curator_b_user', 'p4-curator-b@example.invalid', '{}'),
  (:'p4_student_b_user', 'p4-student-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
)
VALUES
  (:'p4_admin_a_profile', :'p4_admin_a_user', 'P4 Admin A', 'active', 1),
  (:'p4_sales_a_profile', :'p4_sales_a_user', 'P4 Sales A', 'active', 1),
  (:'p4_curator_a_profile', :'p4_curator_a_user', 'P4 Admissions A', 'active', 1),
  (:'p4_student_a_profile', :'p4_student_a_user', 'P4 Student A', 'active', 1),
  (:'p4_admin_b_profile', :'p4_admin_b_user', 'P4 Admin B', 'active', 1),
  (:'p4_sales_b_profile', :'p4_sales_b_user', 'P4 Sales B', 'active', 1),
  (:'p4_curator_b_profile', :'p4_curator_b_user', 'P4 Admissions B', 'active', 1),
  (:'p4_student_b_profile', :'p4_student_b_user', 'P4 Student B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
VALUES
  (:'p4_admin_a_membership', :'p4_org_a', :'p4_admin_a_profile', 'active', 'admin', :'p4_admin_bundle'),
  (:'p4_sales_a_membership', :'p4_org_a', :'p4_sales_a_profile', 'active', 'sales', :'p4_sales_bundle'),
  (:'p4_curator_a_membership', :'p4_org_a', :'p4_curator_a_profile', 'active', 'curator', :'p4_curator_bundle'),
  (:'p4_student_a_membership', :'p4_org_a', :'p4_student_a_profile', 'active', 'student', :'p4_student_bundle'),
  (:'p4_admin_b_membership', :'p4_org_b', :'p4_admin_b_profile', 'active', 'admin', :'p4_admin_bundle'),
  (:'p4_sales_b_membership', :'p4_org_b', :'p4_sales_b_profile', 'active', 'sales', :'p4_sales_bundle'),
  (:'p4_curator_b_membership', :'p4_org_b', :'p4_curator_b_profile', 'active', 'curator', :'p4_curator_bundle'),
  (:'p4_student_b_membership', :'p4_org_b', :'p4_student_b_profile', 'active', 'student', :'p4_student_bundle');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
)
VALUES
  (:'p4_org_scope_a', :'p4_org_a', 'organization', :'p4_org_a', 1),
  (:'p4_org_scope_b', :'p4_org_b', 'organization', :'p4_org_b', 1),
  (:'p4_case_scope_a', :'p4_org_a', 'student_case', :'p4_case_a', 1),
  (:'p4_case_scope_b', :'p4_org_b', 'student_case', :'p4_case_b', 1);

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
)
SELECT
  fixture.id,
  fixture.organization_id,
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'P4 runtime fixture scope',
  fixture.request_id
FROM (VALUES
  ('95000000-0000-4000-8000-000000000501'::UUID, :'p4_org_a'::UUID, :'p4_admin_a_membership'::UUID, :'p4_org_scope_a'::UUID, '95000000-0000-4000-8000-000000000601'::UUID),
  ('95000000-0000-4000-8000-000000000502'::UUID, :'p4_org_a'::UUID, :'p4_sales_a_membership'::UUID, :'p4_org_scope_a'::UUID, '95000000-0000-4000-8000-000000000602'::UUID),
  ('95000000-0000-4000-8000-000000000503'::UUID, :'p4_org_a'::UUID, :'p4_curator_a_membership'::UUID, :'p4_org_scope_a'::UUID, '95000000-0000-4000-8000-000000000603'::UUID),
  ('95000000-0000-4000-8000-000000000504'::UUID, :'p4_org_a'::UUID, :'p4_student_a_membership'::UUID, :'p4_org_scope_a'::UUID, '95000000-0000-4000-8000-000000000604'::UUID),
  ('95000000-0000-4000-8000-000000000505'::UUID, :'p4_org_b'::UUID, :'p4_admin_b_membership'::UUID, :'p4_org_scope_b'::UUID, '95000000-0000-4000-8000-000000000605'::UUID),
  ('95000000-0000-4000-8000-000000000506'::UUID, :'p4_org_b'::UUID, :'p4_sales_b_membership'::UUID, :'p4_org_scope_b'::UUID, '95000000-0000-4000-8000-000000000606'::UUID),
  ('95000000-0000-4000-8000-000000000507'::UUID, :'p4_org_b'::UUID, :'p4_curator_b_membership'::UUID, :'p4_org_scope_b'::UUID, '95000000-0000-4000-8000-000000000607'::UUID),
  ('95000000-0000-4000-8000-000000000508'::UUID, :'p4_org_b'::UUID, :'p4_student_b_membership'::UUID, :'p4_org_scope_b'::UUID, '95000000-0000-4000-8000-000000000608'::UUID)
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

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
  next_action,
  current_scope_id,
  current_scope_version
)
VALUES
  (
    :'p4_case_a', :'p4_org_a', :'p4_student_a_membership',
    :'p4_sales_a_membership', NULL,
    'synthetic:p4:case:a', 'contract:p4:a', statement_timestamp(),
    'P4 Student A', 'United Kingdom', 'Bachelor', 'Business', '2027',
    'approved', 'contract_confirmed', 'pending', NULL,
    NULL, 'Prepare Admissions handoff', :'p4_case_scope_a', 1
  ),
  (
    :'p4_case_b', :'p4_org_b', :'p4_student_b_membership',
    :'p4_sales_b_membership', NULL,
    'synthetic:p4:case:b', 'contract:p4:b', statement_timestamp(),
    'P4 Student B', 'Canada', 'Master', 'Computing', '2027',
    'approved', 'contract_confirmed', 'pending', NULL,
    NULL, 'Prepare Admissions handoff', :'p4_case_scope_b', 1
  );

SELECT jsonb_build_object(
  'sub', :'p4_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'p4_org_a',
  'platform_membership_id', :'p4_admin_a_membership',
  'platform_bundle_id', :'p4_admin_bundle',
  'platform_bundle_version', :'p4_admin_bundle_version'::INTEGER
)::TEXT AS p4_admin_a_initial_claims,
jsonb_build_object(
  'sub', :'p4_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'p4_org_b',
  'platform_membership_id', :'p4_admin_b_membership',
  'platform_bundle_id', :'p4_admin_bundle',
  'platform_bundle_version', :'p4_admin_bundle_version'::INTEGER
)::TEXT AS p4_admin_b_initial_claims
\gset

SET request.jwt.claims TO :'p4_admin_a_initial_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p4_org_a',
  :'p4_case_a',
  :'p4_curator_a_membership',
  'P4 synthetic Admissions handoff A',
  '95000000-0000-4000-8000-000000000621'
);
RESET ROLE;

SET request.jwt.claims TO :'p4_admin_b_initial_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p4_org_b',
  :'p4_case_b',
  :'p4_curator_b_membership',
  'P4 synthetic Admissions handoff B',
  '95000000-0000-4000-8000-000000000622'
);
RESET ROLE;

INSERT INTO platform.case_tasks (
  id,
  organization_id,
  student_case_id,
  task_type,
  title,
  assignee_membership_id,
  priority,
  due_at,
  status,
  student_visible,
  created_by_membership_id
)
VALUES
  (:'p4_task_a', :'p4_org_a', :'p4_case_a', 'document_check', 'Check P4 A document', :'p4_curator_a_membership', 'high', statement_timestamp() + INTERVAL '1 day', 'open', FALSE, :'p4_admin_a_membership'),
  (:'p4_task_b', :'p4_org_b', :'p4_case_b', 'document_check', 'Check P4 B document', :'p4_curator_b_membership', 'normal', statement_timestamp() + INTERVAL '2 days', 'open', FALSE, :'p4_admin_b_membership');

INSERT INTO platform.visa_cases (
  id,
  organization_id,
  student_case_id,
  status,
  latest_evidence_reference,
  created_by_membership_id
)
VALUES
  (:'p4_visa_a', :'p4_org_a', :'p4_case_a', 'docs', NULL, :'p4_curator_a_membership'),
  (:'p4_visa_b', :'p4_org_b', :'p4_case_b', 'appointment', NULL, :'p4_curator_b_membership');

INSERT INTO platform.document_requirements (
  id,
  organization_id,
  target_country,
  target_degree,
  program_direction,
  checklist_version,
  requirement_key,
  label,
  instructions,
  status,
  created_by_membership_id
)
VALUES
  (:'p4_requirement_a', :'p4_org_a', 'United Kingdom', 'Bachelor', 'Business', 1, 'passport', 'Passport', 'Upload a clear passport scan.', 'active', :'p4_admin_a_membership'),
  (:'p4_requirement_b', :'p4_org_b', 'Canada', 'Master', 'Computing', 1, 'passport', 'Passport', 'Upload a clear passport scan.', 'active', :'p4_admin_b_membership');

INSERT INTO platform.document_slots (
  id,
  organization_id,
  student_case_id,
  requirement_id,
  status,
  deadline,
  next_action,
  created_by_membership_id
)
VALUES
  (:'p4_slot_a', :'p4_org_a', :'p4_case_a', :'p4_requirement_a', 'required', statement_timestamp() + INTERVAL '3 days', 'Upload passport', :'p4_curator_a_membership'),
  (:'p4_slot_b', :'p4_org_b', :'p4_case_b', :'p4_requirement_b', 'required', statement_timestamp() + INTERVAL '4 days', 'Upload passport', :'p4_curator_b_membership');

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
VALUES
  (:'p4_obligation_a', :'p4_org_a', :'p4_case_a', 'First payment', 'evo_service_fee', 100000, 'USD', statement_timestamp() + INTERVAL '1 day', 'Confirm payment', :'p4_admin_a_membership'),
  (:'p4_obligation_b', :'p4_org_b', :'p4_case_b', 'First payment', 'evo_service_fee', 120000, 'USD', statement_timestamp() + INTERVAL '1 day', 'Confirm payment', :'p4_admin_b_membership');

SELECT
  jsonb_build_object(
    'sub', :'p4_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', (
      SELECT profile.access_version
      FROM platform.profiles AS profile
      WHERE profile.id = :'p4_admin_a_profile'
    ),
    'platform_organization_id', :'p4_org_a',
    'platform_membership_id', :'p4_admin_a_membership',
    'platform_bundle_id', :'p4_admin_bundle',
    'platform_bundle_version', :'p4_admin_bundle_version'::INTEGER
  )::TEXT AS p4_admin_a_claims,
  jsonb_build_object(
    'sub', :'p4_sales_a_user',
    'role', 'authenticated',
    'platform_role', 'sales',
    'platform_access_version', (
      SELECT profile.access_version
      FROM platform.profiles AS profile
      WHERE profile.id = :'p4_sales_a_profile'
    ),
    'platform_organization_id', :'p4_org_a',
    'platform_membership_id', :'p4_sales_a_membership',
    'platform_bundle_id', :'p4_sales_bundle',
    'platform_bundle_version', :'p4_sales_bundle_version'::INTEGER
  )::TEXT AS p4_sales_a_claims,
  jsonb_build_object(
    'sub', :'p4_curator_a_user',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', (
      SELECT profile.access_version
      FROM platform.profiles AS profile
      WHERE profile.id = :'p4_curator_a_profile'
    ),
    'platform_organization_id', :'p4_org_a',
    'platform_membership_id', :'p4_curator_a_membership',
    'platform_bundle_id', :'p4_curator_bundle',
    'platform_bundle_version', :'p4_curator_bundle_version'::INTEGER
  )::TEXT AS p4_curator_a_claims,
  jsonb_build_object(
    'sub', :'p4_admin_b_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', (
      SELECT profile.access_version
      FROM platform.profiles AS profile
      WHERE profile.id = :'p4_admin_b_profile'
    ),
    'platform_organization_id', :'p4_org_b',
    'platform_membership_id', :'p4_admin_b_membership',
    'platform_bundle_id', :'p4_admin_bundle',
    'platform_bundle_version', :'p4_admin_bundle_version'::INTEGER
  )::TEXT AS p4_admin_b_claims
\gset

-- Exercise the retained private Storage reservation/finalization path twice on
-- one slot so the new read proves real grouped resubmission history.
SET request.jwt.claims TO :'p4_curator_a_claims';
SET ROLE authenticated;
SELECT platform.reserve_document_upload(
  :'p4_org_a',
  :'p4_slot_a',
  'passport-v1.pdf',
  'application/pdf',
  1024,
  repeat('a', 64),
  '95000000-0000-4000-8000-000000000701'
) AS p4_reservation_one
\gset
RESET ROLE;

INSERT INTO storage.objects (bucket_id, name, created_at)
VALUES (
  :'p4_reservation_one'::JSONB ->> 'bucket_id',
  :'p4_reservation_one'::JSONB ->> 'object_name',
  statement_timestamp()
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finalize_document_upload(
  :'p4_org_a',
  (:'p4_reservation_one'::JSONB ->> 'upload_reservation_id')::UUID,
  '95000000-0000-4000-8000-000000000702'
) AS p4_finalization_one
\gset
SELECT platform.attest_document_validation(
  :'p4_org_a',
  (:'p4_reservation_one'::JSONB ->> 'document_version_id')::UUID,
  'verified',
  'clean',
  'synthetic-p4-validator',
  'evidence:p4:validation:v1',
  '95000000-0000-4000-8000-000000000703'
);
RESET ROLE;

SET request.jwt.claims TO :'p4_curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version(
  :'p4_org_a',
  (:'p4_reservation_one'::JSONB ->> 'document_version_id')::UUID,
  'correction_required',
  'Upload the complete passport page.',
  '95000000-0000-4000-8000-000000000704'
);
SELECT platform.reserve_document_upload(
  :'p4_org_a',
  :'p4_slot_a',
  'passport-v2.pdf',
  'application/pdf',
  2048,
  repeat('b', 64),
  '95000000-0000-4000-8000-000000000705'
) AS p4_reservation_two
\gset
RESET ROLE;

INSERT INTO storage.objects (bucket_id, name, created_at)
VALUES (
  :'p4_reservation_two'::JSONB ->> 'bucket_id',
  :'p4_reservation_two'::JSONB ->> 'object_name',
  statement_timestamp()
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.finalize_document_upload(
  :'p4_org_a',
  (:'p4_reservation_two'::JSONB ->> 'upload_reservation_id')::UUID,
  '95000000-0000-4000-8000-000000000706'
) AS p4_finalization_two
\gset
SELECT platform.attest_document_validation(
  :'p4_org_a',
  (:'p4_reservation_two'::JSONB ->> 'document_version_id')::UUID,
  'verified',
  'clean',
  'synthetic-p4-validator',
  'evidence:p4:validation:v2',
  '95000000-0000-4000-8000-000000000707'
);
RESET ROLE;

SET request.jwt.claims TO :'p4_curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version(
  :'p4_org_a',
  (:'p4_reservation_two'::JSONB ->> 'document_version_id')::UUID,
  'approved',
  NULL,
  '95000000-0000-4000-8000-000000000708'
);
RESET ROLE;

SET request.jwt.claims TO :'p4_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p4_attempt_task_queue(101) AS p4_admin_task_queue \gset
SELECT pg_temp.p4_attempt_visa_queue(101) AS p4_admin_visa_queue \gset
SELECT pg_temp.p4_attempt_document_queue(101) AS p4_admin_document_queue \gset
SELECT pg_temp.p4_attempt_document_workspace(:'p4_case_a') AS p4_admin_workspace \gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  NULL
) AS p4_admin_null_request_assert_stop
\gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  '95000000-0000-4000-8000-000000000801'
) AS p4_admin_assert_stop
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4_curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p4_attempt_task_queue(101) AS p4_curator_task_queue \gset
SELECT pg_temp.p4_attempt_visa_queue(101) AS p4_curator_visa_queue \gset
SELECT pg_temp.p4_attempt_document_queue(101) AS p4_curator_document_queue \gset
SELECT pg_temp.p4_attempt_document_workspace(:'p4_case_a') AS p4_curator_workspace \gset
SELECT pg_temp.p4_attempt_document_workspace(:'p4_case_b') AS p4_curator_cross_org_workspace \gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  '95000000-0000-4000-8000-000000000802'
) AS p4_curator_assert_stop
\gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  '95000000-0000-4000-8000-000000000802'
) AS p4_curator_assert_stop_replay
\gset
SELECT pg_temp.p4_attempt_resolve_stop(
  :'p4_org_a',
  :'p4_case_a',
  (:'p4_curator_assert_stop'::JSONB -> 'result' ->> 'stop_factor_id')::UUID,
  '95000000-0000-4000-8000-000000000803'
) AS p4_curator_release_attempt
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4_sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p4_attempt_task_queue(101) AS p4_sales_task_queue \gset
SELECT pg_temp.p4_attempt_visa_queue(101) AS p4_sales_visa_queue \gset
SELECT pg_temp.p4_attempt_document_queue(101) AS p4_sales_document_queue \gset
SELECT pg_temp.p4_attempt_document_workspace(:'p4_case_a') AS p4_sales_workspace \gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  '95000000-0000-4000-8000-000000000804'
) AS p4_sales_assert_stop
\gset
SELECT count(*)::TEXT AS p4_sales_direct_task_count
FROM platform.case_tasks
WHERE id = :'p4_task_a'
\gset
SELECT count(*)::TEXT AS p4_sales_direct_document_count
FROM platform.document_slots
WHERE id = :'p4_slot_a'
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.p4_attempt_task_queue(101) AS p4_admin_b_task_queue \gset
SELECT pg_temp.p4_attempt_document_workspace(:'p4_case_a') AS p4_admin_b_cross_org_workspace \gset
SELECT pg_temp.p4_attempt_assert_stop(
  :'p4_case_a',
  :'p4_obligation_a',
  '95000000-0000-4000-8000-000000000805'
) AS p4_admin_b_assert_stop
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.p4_attempt_resolve_stop(
  :'p4_org_a',
  :'p4_case_a',
  (:'p4_curator_assert_stop'::JSONB -> 'result' ->> 'stop_factor_id')::UUID,
  '95000000-0000-4000-8000-000000000806'
) AS p4_admin_release
\gset
SELECT pg_temp.p4_attempt_resolve_stop(
  :'p4_org_a',
  :'p4_case_a',
  (:'p4_curator_assert_stop'::JSONB -> 'result' ->> 'stop_factor_id')::UUID,
  '95000000-0000-4000-8000-000000000806'
) AS p4_admin_release_replay
\gset
RESET ROLE;

SELECT pg_temp.p4_assert_true(
  NOT (:'p4_admin_null_request_assert_stop'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_admin_null_request_assert_stop'::JSONB ->> 'sqlstate' = '22023',
  'finance assertion must reject a missing request id at its own boundary'
);

SELECT pg_temp.p4_assert_true(
  (:'p4_admin_task_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_admin_visa_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_admin_document_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_admin_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_curator_task_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_curator_visa_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_curator_document_queue'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_curator_workspace'::JSONB ->> 'ok')::BOOLEAN,
  'Admin and assigned Admissions must read all P4 projections'
);

SELECT pg_temp.p4_assert_true(
  jsonb_array_length(:'p4_admin_task_queue'::JSONB -> 'result') = 1
  AND :'p4_admin_task_queue'::JSONB -> 'result' -> 0 ->> 'case_task_id' = :'p4_task_a'
  AND jsonb_array_length(:'p4_curator_task_queue'::JSONB -> 'result') = 1
  AND :'p4_curator_task_queue'::JSONB -> 'result' -> 0 ->> 'case_task_id' = :'p4_task_a'
  AND jsonb_array_length(:'p4_admin_b_task_queue'::JSONB -> 'result') = 1
  AND :'p4_admin_b_task_queue'::JSONB -> 'result' -> 0 ->> 'case_task_id' = :'p4_task_b',
  'task queue must be deterministic, tenant-scoped and curator-assignment scoped'
);

SELECT pg_temp.p4_assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'assignee_display_name',
      'assignee_membership_id',
      'case_state',
      'case_task_id',
      'created_at',
      'due_at',
      'organization_id',
      'priority',
      'sort_at',
      'status',
      'student_case_id',
      'student_display_name',
      'student_visible',
      'task_type',
      'title',
      'updated_at'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_task_queue'::JSONB -> 'result' -> 0
    ) AS object_key(key)
  ),
  'task queue row shape must remain exact'
);

SELECT pg_temp.p4_assert_true(
  jsonb_array_length(:'p4_admin_visa_queue'::JSONB -> 'result') = 1
  AND :'p4_admin_visa_queue'::JSONB -> 'result' -> 0 ->> 'visa_case_id' = :'p4_visa_a'
  AND jsonb_array_length(:'p4_curator_visa_queue'::JSONB -> 'result') = 1
  AND :'p4_curator_visa_queue'::JSONB -> 'result' -> 0 ->> 'visa_case_id' = :'p4_visa_a'
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'case_state',
      'created_at',
      'created_by_display_name',
      'created_by_membership_id',
      'latest_evidence_reference',
      'organization_id',
      'sort_at',
      'status',
      'student_case_id',
      'student_display_name',
      'updated_at',
      'visa_case_id'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_visa_queue'::JSONB -> 'result' -> 0
    ) AS object_key(key)
  ),
  'visa queue must expose only the actor tenant and assigned Admissions cases'
);

SELECT pg_temp.p4_assert_true(
  jsonb_array_length(:'p4_admin_document_queue'::JSONB -> 'result') = 1
  AND :'p4_admin_document_queue'::JSONB -> 'result' -> 0 ->> 'document_slot_id' = :'p4_slot_a'
  AND :'p4_admin_document_queue'::JSONB -> 'result' -> 0 ->> 'current_version_no' = '2'
  AND :'p4_admin_document_queue'::JSONB -> 'result' -> 0 ->> 'current_byte_size' = '2048'
  AND (:'p4_admin_document_queue'::JSONB -> 'result' -> 0 ->> 'download_ready')::BOOLEAN
  AND jsonb_array_length(:'p4_curator_document_queue'::JSONB -> 'result') = 1
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'case_state',
      'created_at',
      'current_byte_size',
      'current_declared_mime_type',
      'current_integrity_status',
      'current_malware_status',
      'current_original_filename',
      'current_review_decision',
      'current_review_reason',
      'current_sha256_hex',
      'current_version_finalized_at',
      'current_version_id',
      'current_version_no',
      'deadline',
      'document_requirement_id',
      'document_slot_id',
      'download_ready',
      'next_action',
      'organization_id',
      'requirement_key',
      'requirement_label',
      'slot_status',
      'sort_at',
      'student_case_id',
      'student_display_name',
      'updated_at'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_document_queue'::JSONB -> 'result' -> 0
    ) AS object_key(key)
  ),
  'document queue must expose current finalized clean version as decimal strings'
);

SELECT pg_temp.p4_assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'case_state',
      'organization_id',
      'slots',
      'student_case_id'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_workspace'::JSONB -> 'result'
    ) AS object_key(key)
  )
  AND jsonb_array_length(
    :'p4_admin_workspace'::JSONB -> 'result' -> 'slots'
  ) = 1
  AND jsonb_array_length(
    :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0 -> 'versions'
  ) = 2
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'checklist_version',
      'created_at',
      'current_version_id',
      'current_version_no',
      'deadline',
      'document_requirement_id',
      'document_slot_id',
      'instructions',
      'next_action',
      'requirement_key',
      'requirement_label',
      'slot_status',
      'updated_at',
      'versions'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'byte_size',
      'created_at',
      'declared_mime_type',
      'document_version_id',
      'download_ready',
      'finalized_at',
      'integrity_status',
      'is_current',
      'latest_review',
      'malware_status',
      'original_filename',
      'sha256_hex',
      'storage_finalized',
      'submitted_by_display_name',
      'submitted_by_membership_id',
      'updated_at',
      'validation_updated_at',
      'version_no'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
        -> 'versions' -> 0
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'decision',
      'reason',
      'reviewed_at',
      'reviewer_display_name',
      'reviewer_membership_id'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
        -> 'versions' -> 0 -> 'latest_review'
    ) AS object_key(key)
  )
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    ->> 'current_version_no' = '2'
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 0 ->> 'version_no' = '2'
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 1 ->> 'version_no' = '1'
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 0 ->> 'sha256_hex' = repeat('b', 64)
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 1 ->> 'sha256_hex' = repeat('a', 64)
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 0 -> 'latest_review' ->> 'decision' = 'approved'
  AND :'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 1 -> 'latest_review' ->> 'decision' = 'correction_required'
  AND (:'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 0 ->> 'is_current')::BOOLEAN
  AND (:'p4_admin_workspace'::JSONB -> 'result' -> 'slots' -> 0
    -> 'versions' -> 0 ->> 'storage_finalized')::BOOLEAN,
  'document workspace must group ordered immutable resubmission history per slot'
);

SELECT pg_temp.p4_assert_true(
  NOT (:'p4_sales_task_queue'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_sales_task_queue'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'p4_sales_visa_queue'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_sales_visa_queue'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'p4_sales_document_queue'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_sales_document_queue'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'p4_sales_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_sales_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND :'p4_sales_direct_task_count'::INTEGER = 0
  AND :'p4_sales_direct_document_count'::INTEGER = 0,
  'Sales must be denied full Admissions projections and active-case base rows'
);

SELECT pg_temp.p4_assert_true(
  NOT (:'p4_curator_cross_org_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_curator_cross_org_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'p4_admin_b_cross_org_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_admin_b_cross_org_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'p4_admin_b_assert_stop'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_admin_b_assert_stop'::JSONB ->> 'sqlstate' = '42501',
  'cross-tenant exact-case reads and finance mutation must fail closed'
);

SELECT pg_temp.p4_assert_true(
  (:'p4_admin_assert_stop'::JSONB ->> 'ok')::BOOLEAN
  AND (:'p4_curator_assert_stop'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_curator_assert_stop'::JSONB = :'p4_curator_assert_stop_replay'::JSONB
  AND :'p4_curator_assert_stop'::JSONB -> 'result' ->> 'owner_membership_id' = :'p4_curator_a_membership'
  AND NOT (:'p4_sales_assert_stop'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_sales_assert_stop'::JSONB ->> 'sqlstate' = '42501'
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'blocked_action',
      'created_evidence_ref',
      'next_action',
      'organization_id',
      'owner_membership_id',
      'payment_obligation_id',
      'reason',
      'status',
      'stop_factor_id',
      'student_case_id'
    ]::TEXT[]
    FROM jsonb_object_keys(
      :'p4_curator_assert_stop'::JSONB -> 'result'
    ) AS object_key(key)
  ),
  'Admin and assigned Admissions may assert an idempotent stop; Sales may not'
);

SELECT pg_temp.p4_assert_true(
  NOT (:'p4_curator_release_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_curator_release_attempt'::JSONB ->> 'sqlstate' = '42501'
  AND (:'p4_admin_release'::JSONB ->> 'ok')::BOOLEAN
  AND :'p4_admin_release'::JSONB -> 'result' ->> 'status' = 'resolved'
  AND :'p4_admin_release'::JSONB = :'p4_admin_release_replay'::JSONB,
  'Admissions may assert a finance stop but only Admin may release it'
);

SELECT pg_temp.p4_assert_true(
  (
    SELECT count(*) = 1
    FROM platform.stop_factor_events AS event
    WHERE event.request_id = '95000000-0000-4000-8000-000000000802'
      AND event.new_status = 'active'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.audit_events AS event
    WHERE event.request_id = '95000000-0000-4000-8000-000000000802'
      AND event.action = 'finance.stop.create'
  ),
  'finance assertion replay must leave one immutable event and audit receipt'
);

ROLLBACK;
