\set ON_ERROR_STOP on

-- Durable synthetic fixture for the two-session migration 113 contention
-- proof. The disposable authorization database is discarded after the suite.
BEGIN;

\set p113c_org '59911399-0000-4000-8000-000000000001'
\set p113c_case '59911399-0000-4000-8000-000000000002'
\set p113c_org_scope '59911399-0000-4000-8000-000000000003'
\set p113c_case_scope '59911399-0000-4000-8000-000000000004'
\set p113c_case_scope_v2 '59911399-0000-4000-8000-000000000005'
\set p113c_sales_user '59911399-0000-4000-8000-000000000101'
\set p113c_curator_user '59911399-0000-4000-8000-000000000102'
\set p113c_student_user '59911399-0000-4000-8000-000000000103'
\set p113c_admin_user '59911399-0000-4000-8000-000000000104'
\set p113c_sales_profile '59911399-0000-4000-8000-000000000201'
\set p113c_curator_profile '59911399-0000-4000-8000-000000000202'
\set p113c_student_profile '59911399-0000-4000-8000-000000000203'
\set p113c_admin_profile '59911399-0000-4000-8000-000000000204'
\set p113c_sales_membership '59911399-0000-4000-8000-000000000301'
\set p113c_curator_membership '59911399-0000-4000-8000-000000000302'
\set p113c_student_membership '59911399-0000-4000-8000-000000000303'
\set p113c_admin_membership '59911399-0000-4000-8000-000000000304'
\set p113c_requirement '59911399-0000-4000-8000-000000000401'
\set p113c_slot '59911399-0000-4000-8000-000000000402'
\set p113c_application_a '59911399-0000-4000-8000-000000000501'
\set p113c_application_b '59911399-0000-4000-8000-000000000502'

SELECT bundle.id AS p113c_sales_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113c_curator_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113c_student_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p113c_admin_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES (:'p113c_org', 'Migration 113 concurrency organization');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p113c_sales_user', 'p113c-sales@example.invalid', '{}'),
  (:'p113c_curator_user', 'p113c-curator@example.invalid', '{}'),
  (:'p113c_student_user', 'p113c-student@example.invalid', '{}'),
  (:'p113c_admin_user', 'p113c-admin@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p113c_sales_profile', :'p113c_sales_user', 'P113C Sales', 'active', 1),
  (:'p113c_curator_profile', :'p113c_curator_user', 'P113C Admissions', 'active', 1),
  (:'p113c_student_profile', :'p113c_student_user', 'P113C Student', 'active', 1),
  (:'p113c_admin_profile', :'p113c_admin_user', 'P113C Admin', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (
    :'p113c_sales_membership', :'p113c_org', :'p113c_sales_profile',
    'active', 'sales', :'p113c_sales_bundle'
  ),
  (
    :'p113c_curator_membership', :'p113c_org', :'p113c_curator_profile',
    'active', 'curator', :'p113c_curator_bundle'
  ),
  (
    :'p113c_student_membership', :'p113c_org', :'p113c_student_profile',
    'active', 'student', :'p113c_student_bundle'
  ),
  (
    :'p113c_admin_membership', :'p113c_org', :'p113c_admin_profile',
    'active', 'admin', :'p113c_admin_bundle'
  );

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p113c_org_scope', :'p113c_org', 'organization', :'p113c_org', 1),
  (:'p113c_case_scope', :'p113c_org', 'student_case', :'p113c_case', 1);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59911399-0000-4000-8000-000000000601', :'p113c_org',
    :'p113c_curator_membership', :'p113c_org_scope', 1, 1, TRUE,
    'system', NULL, 'Migration 113 concurrency runtime scope',
    '59911399-0000-4000-8000-000000000701'
  ),
  (
    '59911399-0000-4000-8000-000000000602', :'p113c_org',
    :'p113c_curator_membership', :'p113c_case_scope', 1, 1, TRUE,
    'system', NULL, 'Migration 113 concurrency case scope',
    '59911399-0000-4000-8000-000000000702'
  ),
  (
    '59911399-0000-4000-8000-000000000604', :'p113c_org',
    :'p113c_admin_membership', :'p113c_org_scope', 1, 1, TRUE,
    'system', NULL, 'Migration 113 concurrency Admin scope',
    '59911399-0000-4000-8000-000000000704'
  );

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
)
VALUES (
  :'p113c_case', :'p113c_org', :'p113c_student_membership',
  :'p113c_sales_membership', NULL,
  'synthetic:p113c:case', 'synthetic:p113c:contract', statement_timestamp(),
  'P113C Student', 'United Kingdom', 'Bachelor', 'Business',
  '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
  NULL, 'Prepare handoff', :'p113c_case_scope', 1
);

UPDATE platform.record_scopes
SET is_active = FALSE
WHERE id = :'p113c_case_scope';

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES (
  :'p113c_case_scope_v2', :'p113c_org', 'student_case', :'p113c_case', 2
);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES (
  '59911399-0000-4000-8000-000000000603', :'p113c_org',
  :'p113c_curator_membership', :'p113c_case_scope_v2', 2, 1, TRUE,
  'system', NULL, 'Migration 113 concurrency active case scope',
  '59911399-0000-4000-8000-000000000703'
);

UPDATE platform.student_cases
SET
  current_curator_membership_id = :'p113c_curator_membership',
  operational_stage = 'documents',
  state = 'active',
  handoff_at = statement_timestamp(),
  portal_activated_at = statement_timestamp(),
  next_action = 'Collect documents',
  current_scope_id = :'p113c_case_scope_v2',
  current_scope_version = 2
WHERE id = :'p113c_case';

INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
)
VALUES (
  :'p113c_requirement', :'p113c_org', 'United Kingdom', 'Bachelor',
  'Business', 1, 'bank_statement', 'Bank statement',
  'Upload the current bank statement.', 'active', :'p113c_curator_membership'
);

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
)
VALUES (
  :'p113c_slot', :'p113c_org', :'p113c_case', :'p113c_requirement',
  'required', :'p113c_curator_membership'
);

INSERT INTO platform.university_applications (
  id, organization_id, student_case_id, institution_name, program_name,
  created_by_membership_id
)
VALUES
  (
    :'p113c_application_a', :'p113c_org', :'p113c_case',
    'P113C University A', 'Business Analytics', :'p113c_curator_membership'
  ),
  (
    :'p113c_application_b', :'p113c_org', :'p113c_case',
    'P113C University B', 'International Business', :'p113c_curator_membership'
  );

COMMIT;

SELECT 'platform migration 113 concurrency fixture ready' AS result;
