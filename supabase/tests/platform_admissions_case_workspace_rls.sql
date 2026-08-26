\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U7 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u7_attempt_task_workspace(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  result := platform.staff_student_case_task_workspace(p_student_case_id);
  RETURN jsonb_build_object('ok', TRUE, 'result', result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u7_attempt_task_workspace(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.u7_attempt_activity(
  p_student_case_id UUID,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  result JSONB;
BEGIN
  result := platform.staff_student_case_activity(p_student_case_id, p_limit);
  RETURN jsonb_build_object('ok', TRUE, 'result', result);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.u7_attempt_activity(UUID, INTEGER) TO authenticated;

SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'platform.staff_student_case_task_workspace(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_student_case_activity(uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_student_case_task_workspace(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_student_case_activity(uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_student_case_task_workspace(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.staff_student_case_activity(uuid,integer)',
    'EXECUTE'
  ),
  'U7 RPC grants must remain authenticated-only'
);

SELECT pg_temp.assert_true(
  (
    SELECT bool_and(
      pg_get_userbyid(routine.proowner) = 'postgres'
      AND routine.prosecdef
      AND array_to_string(routine.proconfig, ',') = 'search_path=""'
    )
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN (
        'staff_student_case_task_workspace',
        'staff_student_case_activity'
      )
  ),
  'U7 RPC owner/security/search-path posture drifted'
);

SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.current_curator_membership_id AS curator_a_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.current_curator_membership_id AS curator_b_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.organization_id AS org_b_id,
  student_case.id AS org_b_case_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT
  membership.id AS admin_a_membership_id,
  membership.current_bundle_id AS admin_a_bundle_id,
  bundle.version AS admin_a_bundle_version,
  profile.id AS admin_a_profile_id,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.id AS admin_b_membership_id,
  membership.current_bundle_id AS admin_b_bundle_id,
  bundle.version AS admin_b_bundle_version,
  profile.auth_user_id AS admin_b_user_id,
  profile.access_version AS admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_b_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS curator_a_user_id,
  profile.access_version AS curator_a_access_version,
  membership.current_bundle_id AS curator_a_bundle_id,
  bundle.version AS curator_a_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_a_membership_id'
\gset

SELECT
  profile.auth_user_id AS curator_b_user_id,
  profile.access_version AS curator_b_access_version,
  membership.current_bundle_id AS curator_b_bundle_id,
  bundle.version AS curator_b_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'curator_b_membership_id'
\gset

SELECT
  membership.id AS previous_curator_membership_id,
  membership.current_bundle_id AS previous_curator_bundle_id,
  bundle.version AS previous_curator_bundle_version,
  profile.auth_user_id AS previous_curator_user_id,
  profile.access_version AS previous_curator_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset

SELECT
  membership.id AS finance_a_membership_id,
  profile.auth_user_id AS finance_a_user_id,
  profile.access_version AS finance_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'finance'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  membership.id AS sales_a_membership_id,
  membership.current_bundle_id AS sales_a_bundle_id,
  bundle.version AS sales_a_bundle_version,
  profile.auth_user_id AS sales_a_user_id,
  profile.access_version AS sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE membership.organization_id = :'org_a_id'
  AND profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT application.id AS application_a_id
FROM platform.university_applications AS application
WHERE application.organization_id = :'org_a_id'
  AND application.student_case_id = :'case_a_id'
ORDER BY application.id
LIMIT 1
\gset

SELECT visa.id AS visa_a_id
FROM platform.visa_cases AS visa
WHERE visa.organization_id = :'org_a_id'
  AND visa.student_case_id = :'case_a_id'
ORDER BY visa.id
LIMIT 1
\gset

\set u7_inactive_user '89000000-0000-4000-8000-000000000101'
\set u7_inactive_profile '89000000-0000-4000-8000-000000000201'
\set u7_inactive_membership '89000000-0000-4000-8000-000000000301'
\set u7_update_id '89000000-0000-4000-8000-000000000401'
\set u7_task_a_id '89000000-0000-4000-8000-000000000402'
\set u7_task_b_id '89000000-0000-4000-8000-000000000403'
\set u7_update_request '89000000-0000-4000-8000-000000000501'
\set u7_task_a_request '89000000-0000-4000-8000-000000000502'
\set u7_task_b_request '89000000-0000-4000-8000-000000000503'
\set u7_app_audit_request '89000000-0000-4000-8000-000000000504'
\set u7_visa_audit_request '89000000-0000-4000-8000-000000000505'
\set u7_review_request '89000000-0000-4000-8000-000000000506'
\set u7_sales_task_request '89000000-0000-4000-8000-000000000507'
\set u7_sales_app_request '89000000-0000-4000-8000-000000000508'
\set u7_sales_visa_request '89000000-0000-4000-8000-000000000509'
\set u7_sales_review_request '89000000-0000-4000-8000-00000000050a'
\set u7_curator_no_case_bundle '89000000-0000-4000-8000-000000000601'
\set u7_document_requirement '89000000-0000-4000-8000-000000000701'
\set u7_document_slot '89000000-0000-4000-8000-000000000702'
\set version_a_id '89000000-0000-4000-8000-000000000703'

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'u7_inactive_user',
  'u7-inactive-curator@example.invalid',
  '{}'
);

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES (
  :'u7_inactive_profile',
  :'u7_inactive_user',
  'U7 Inactive Curator',
  'active',
  1
);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES (
  :'u7_inactive_membership',
  :'org_a_id',
  :'u7_inactive_profile',
  'inactive',
  'curator',
  '00000000-0000-4000-8000-000000001303'
);

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
) VALUES (
  :'u7_document_requirement',
  :'org_a_id',
  'U7 synthetic country',
  'U7 synthetic degree',
  'U7 synthetic program',
  890001,
  'u7.synthetic.review',
  'U7 synthetic review document',
  'Synthetic local-only document for the U7 base review proof.',
  'active',
  :'admin_a_membership_id'
);

INSERT INTO platform.document_slots (
  id,
  organization_id,
  student_case_id,
  requirement_id,
  status,
  created_by_membership_id
) VALUES (
  :'u7_document_slot',
  :'org_a_id',
  :'case_a_id',
  :'u7_document_requirement',
  'required',
  :'admin_a_membership_id'
);

INSERT INTO platform.document_versions (
  id,
  organization_id,
  student_case_id,
  document_slot_id,
  version_no,
  original_filename,
  declared_mime_type,
  byte_size,
  sha256_hex,
  ingest_evidence_ref,
  submitted_by_membership_id
) VALUES (
  :'version_a_id',
  :'org_a_id',
  :'case_a_id',
  :'u7_document_slot',
  1,
  'u7-synthetic-review.pdf',
  'application/pdf',
  1024,
  repeat('7', 64),
  'synthetic:u7:document-review',
  :'curator_a_membership_id'
);

UPDATE platform.document_slots
SET
  status = 'submitted',
  current_version_id = :'version_a_id',
  current_version_no = 1
WHERE id = :'u7_document_slot';

INSERT INTO platform.student_case_updates (
  id,
  organization_id,
  student_case_id,
  author_membership_id,
  source,
  body,
  student_visible,
  occurred_at,
  request_id
) VALUES (
  :'u7_update_id',
  :'org_a_id',
  :'case_a_id',
  :'curator_a_membership_id',
  'u7.synthetic',
  'Synthetic U7 case update',
  FALSE,
  statement_timestamp(),
  :'u7_update_request'
);

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
  created_by_membership_id,
  created_at,
  updated_at
) VALUES (
  :'u7_task_a_id',
  :'org_a_id',
  :'case_a_id',
  'u7.synthetic.case-a',
  'Synthetic U7 workspace task A',
  :'curator_a_membership_id',
  'high',
  statement_timestamp() + interval '2 days',
  'open',
  FALSE,
  :'admin_a_membership_id',
  statement_timestamp(),
  statement_timestamp()
), (
  :'u7_task_b_id',
  :'org_a_id',
  :'case_b_id',
  'u7.synthetic.case-b',
  'Synthetic U7 workspace task B',
  :'curator_b_membership_id',
  'normal',
  statement_timestamp() + interval '3 days',
  'open',
  FALSE,
  :'admin_a_membership_id',
  statement_timestamp(),
  statement_timestamp()
);

INSERT INTO platform.audit_events (
  organization_id,
  actor_kind,
  actor_profile_id,
  actor_principal,
  action,
  resource_type,
  resource_id,
  before_state,
  after_state,
  reason,
  request_id,
  actor_membership_id
) VALUES
(
  :'org_a_id',
  'user',
  :'admin_a_profile_id',
  'auth:' || :'admin_a_user_id',
  'task.create',
  'case_task',
  :'u7_task_a_id',
  NULL,
  jsonb_build_object(
    'student_case_id', :'case_a_id',
    'title', 'Synthetic U7 workspace task A',
    'status', 'open',
    'priority', 'high',
    'assignee_membership_id', :'curator_a_membership_id',
    'student_visible', FALSE
  ),
  'Synthetic U7 task create',
  :'u7_task_a_request',
  :'admin_a_membership_id'
),
(
  :'org_a_id',
  'user',
  :'admin_a_profile_id',
  'auth:' || :'admin_a_user_id',
  'task.create',
  'case_task',
  :'u7_task_b_id',
  NULL,
  jsonb_build_object(
    'student_case_id', :'case_b_id',
    'title', 'Synthetic U7 workspace task B',
    'status', 'open',
    'priority', 'normal',
    'assignee_membership_id', :'curator_b_membership_id',
    'student_visible', FALSE
  ),
  'Synthetic U7 task create',
  :'u7_task_b_request',
  :'admin_a_membership_id'
),
(
  :'org_a_id',
  'user',
  :'admin_a_profile_id',
  'auth:' || :'admin_a_user_id',
  'application.status.change',
  'university_application',
  :'application_a_id',
  jsonb_build_object('status', 'ready'),
  jsonb_build_object(
    'student_case_id', :'case_a_id',
    'status', 'submitted'
  ),
  'Synthetic U7 application status change',
  :'u7_app_audit_request',
  :'admin_a_membership_id'
),
(
  :'org_a_id',
  'user',
  :'admin_a_profile_id',
  'auth:' || :'admin_a_user_id',
  'visa.status.change',
  'visa_case',
  :'visa_a_id',
  jsonb_build_object('status', 'submitted'),
  jsonb_build_object(
    'student_case_id', :'case_a_id',
    'status', 'approved'
  ),
  'Synthetic U7 visa status change',
  :'u7_visa_audit_request',
  :'admin_a_membership_id'
);

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'admin_a_membership_id',
  'platform_bundle_id', :'admin_a_bundle_id',
  'platform_bundle_version', :'admin_a_bundle_version'::INTEGER
)::TEXT AS admin_a_claims,
jsonb_build_object(
  'sub', :'admin_b_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT,
  'platform_organization_id', :'org_b_id',
  'platform_membership_id', :'admin_b_membership_id',
  'platform_bundle_id', :'admin_b_bundle_id',
  'platform_bundle_version', :'admin_b_bundle_version'::INTEGER
)::TEXT AS admin_b_claims,
jsonb_build_object(
  'sub', :'curator_a_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'curator_a_membership_id',
  'platform_bundle_id', :'curator_a_bundle_id',
  'platform_bundle_version', :'curator_a_bundle_version'::INTEGER
)::TEXT AS curator_a_claims,
jsonb_build_object(
  'sub', :'curator_b_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_b_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'curator_b_membership_id',
  'platform_bundle_id', :'curator_b_bundle_id',
  'platform_bundle_version', :'curator_b_bundle_version'::INTEGER
)::TEXT AS curator_b_claims,
jsonb_build_object(
  'sub', :'previous_curator_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'previous_curator_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'previous_curator_membership_id',
  'platform_bundle_id', :'previous_curator_bundle_id',
  'platform_bundle_version', :'previous_curator_bundle_version'::INTEGER
)::TEXT AS previous_curator_claims,
jsonb_build_object(
  'sub', :'sales_a_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'sales_a_membership_id',
  'platform_bundle_id', :'sales_a_bundle_id',
  'platform_bundle_version', :'sales_a_bundle_version'::INTEGER
)::TEXT AS sales_a_claims,
jsonb_build_object(
  'sub', :'u7_inactive_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', 1,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'u7_inactive_membership',
  'platform_bundle_id', :'curator_a_bundle_id',
  'platform_bundle_version', :'curator_a_bundle_version'::INTEGER
)::TEXT AS inactive_curator_claims
\gset

SELECT count(*)::TEXT AS u7_projection_before
FROM platform.student_portal_notification_projection_v1
\gset

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.review_document_version(
  :'org_a_id',
  :'version_a_id',
  'rejected',
  'Synthetic U7 base review without portal notification.',
  :'u7_review_request'
) AS u7_review_result
\gset
RESET ROLE;

SELECT id AS u7_review_id
FROM platform.document_reviews
WHERE request_id = :'u7_review_request'
\gset

SELECT pg_temp.assert_true(
  :'u7_review_result'::JSONB ->> 'document_version_id' = :'version_a_id'
  AND (
    SELECT count(*)::TEXT
    FROM platform.student_portal_notification_projection_v1
  ) = :'u7_projection_before'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_notification_projection_v1 AS projection
    WHERE projection.source_record_id = :'u7_review_id'
  ),
  'base review_document_version must not create portal notification side effects'
);

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_admin_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_admin_activity \gset
SELECT pg_temp.u7_attempt_task_workspace(NULL) AS u7_null_case_attempt \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 0) AS u7_zero_limit_attempt \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 101) AS u7_large_limit_attempt \gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_curator_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_curator_activity \gset
RESET ROLE;

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label,
  published_at
) VALUES (
  :'u7_curator_no_case_bundle',
  'curator',
  890001,
  'draft',
  'U7 curator without case.read.full',
  NULL
);

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
) VALUES (
  :'u7_curator_no_case_bundle',
  'curator',
  'organization.read'
);

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE id = :'u7_curator_no_case_bundle';

UPDATE platform.organization_memberships
SET current_bundle_id = :'u7_curator_no_case_bundle'
WHERE id = :'curator_a_membership_id';

SELECT jsonb_build_object(
  'sub', :'curator_a_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT,
  'platform_organization_id', :'org_a_id',
  'platform_membership_id', :'curator_a_membership_id',
  'platform_bundle_id', :'u7_curator_no_case_bundle',
  'platform_bundle_version', 890001
)::TEXT AS curator_a_missing_case_permission_claims
\gset

SET request.jwt.claims TO :'curator_a_missing_case_permission_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_missing_permission_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_missing_permission_activity \gset
RESET ROLE;

UPDATE platform.organization_memberships
SET current_bundle_id = :'curator_a_bundle_id'
WHERE id = :'curator_a_membership_id';

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_sales_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_sales_activity \gset
SAVEPOINT expect_sales_task_denied;
\set ON_ERROR_STOP off
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'u7.sales.denied',
  'Denied Sales task mutation',
  :'curator_a_membership_id',
  'normal',
  NULL,
  'open',
  FALSE,
  :'u7_sales_task_request'
);
\set u7_sales_task_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_sales_task_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_sales_task_denied;

SAVEPOINT expect_sales_application_denied;
\set ON_ERROR_STOP off
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Denied Sales University',
  'Denied Sales Program',
  'preparation',
  NULL,
  NULL,
  :'u7_sales_app_request'
);
\set u7_sales_application_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_sales_application_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_sales_application_denied;

SAVEPOINT expect_sales_visa_denied;
\set ON_ERROR_STOP off
SELECT platform.create_visa_case(
  :'org_a_id',
  :'case_a_id',
  'not_started',
  NULL,
  NULL,
  :'u7_sales_visa_request'
);
\set u7_sales_visa_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_sales_visa_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_sales_visa_denied;

SAVEPOINT expect_sales_review_denied;
\set ON_ERROR_STOP off
SELECT platform.review_document_version(
  :'org_a_id',
  :'version_a_id',
  'approved',
  'Denied Sales review',
  :'u7_sales_review_request'
);
\set u7_sales_review_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_sales_review_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_sales_review_denied;
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_unrelated_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_unrelated_activity \gset
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_previous_curator_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_previous_curator_activity \gset
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_cross_org_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_cross_org_activity \gset
RESET ROLE;

SET request.jwt.claims TO :'inactive_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.u7_attempt_task_workspace(:'case_a_id') AS u7_inactive_task_workspace \gset
SELECT pg_temp.u7_attempt_activity(:'case_a_id', 100) AS u7_inactive_activity \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'u7_admin_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u7_admin_activity'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u7_curator_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u7_curator_activity'::JSONB ->> 'ok')::BOOLEAN,
  'admin and assigned curator must read both U7 RPCs'
);

SELECT pg_temp.assert_true(
  NOT (:'u7_missing_permission_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND NOT (:'u7_missing_permission_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_missing_permission_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND :'u7_missing_permission_activity'::JSONB ->> 'sqlstate' = '42501',
  'assigned curator without case.read.full must be denied by both U7 RPCs'
);

SELECT pg_temp.assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'assignees',
      'organization_id',
      'student_case_id',
      'tasks'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (:'u7_admin_task_workspace'::JSONB -> 'result')
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'assignee_display_name',
      'assignee_membership_id',
      'case_task_id',
      'created_at',
      'creator_display_name',
      'creator_membership_id',
      'due_at',
      'priority',
      'status',
      'student_visible',
      'task_type',
      'title',
      'updated_at'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (
        SELECT task
        FROM jsonb_array_elements(
          :'u7_admin_task_workspace'::JSONB -> 'result' -> 'tasks'
        ) AS task
        WHERE task ->> 'case_task_id' = :'u7_task_a_id'
        LIMIT 1
      )
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'display_name',
      'membership_id',
      'role'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (
        SELECT assignee
        FROM jsonb_array_elements(
          :'u7_admin_task_workspace'::JSONB -> 'result' -> 'assignees'
        ) AS assignee
        WHERE assignee ->> 'membership_id' = :'curator_a_membership_id'
        LIMIT 1
      )
    ) AS object_key(key)
  ),
  'task workspace DTO shape drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'audit',
      'organization_id',
      'student_case_id',
      'updates'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (:'u7_admin_activity'::JSONB -> 'result')
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'author_display_name',
      'author_membership_id',
      'body',
      'case_update_id',
      'created_at',
      'occurred_at',
      'source',
      'student_visible'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (
        SELECT update_row
        FROM jsonb_array_elements(
          :'u7_admin_activity'::JSONB -> 'result' -> 'updates'
        ) AS update_row
        WHERE update_row ->> 'case_update_id' = :'u7_update_id'
        LIMIT 1
      )
    ) AS object_key(key)
  )
  AND (
    SELECT array_agg(key ORDER BY key) = ARRAY[
      'action',
      'actor_display_name',
      'actor_kind',
      'audit_event_id',
      'change_summary',
      'changed_field_codes',
      'created_at',
      'reason_code',
      'request_id',
      'resource_id',
      'resource_type'
    ]::TEXT[]
    FROM jsonb_object_keys(
      (
        SELECT audit_row
        FROM jsonb_array_elements(
          :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
        ) AS audit_row
        WHERE audit_row ->> 'request_id' = :'u7_review_request'
        LIMIT 1
      )
    ) AS object_key(key)
  ),
  'activity DTO shape drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_task_workspace'::JSONB -> 'result' -> 'tasks'
    ) AS task
    WHERE task ->> 'case_task_id' = :'u7_task_a_id'
  )
  AND (
    SELECT count(*) = 0
    FROM jsonb_array_elements(
      :'u7_admin_task_workspace'::JSONB -> 'result' -> 'tasks'
    ) AS task
    WHERE task ->> 'case_task_id' = :'u7_task_b_id'
  )
  AND (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'updates'
    ) AS update_row
    WHERE update_row ->> 'case_update_id' = :'u7_update_id'
  )
  AND (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
    ) AS audit_row
    WHERE audit_row ->> 'request_id' = :'u7_task_a_request'
  )
  AND (
    SELECT count(*) = 0
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
    ) AS audit_row
    WHERE audit_row ->> 'request_id' = :'u7_task_b_request'
  ),
  'same-case task or audit isolation failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
    ) AS audit_row
    WHERE audit_row ->> 'request_id' = :'u7_app_audit_request'
      AND audit_row ->> 'reason_code' = 'application_status_changed'
  )
  AND (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
    ) AS audit_row
    WHERE audit_row ->> 'request_id' = :'u7_visa_audit_request'
      AND audit_row ->> 'reason_code' = 'visa_status_changed'
  )
  AND (
    SELECT count(*) = 1
    FROM jsonb_array_elements(
      :'u7_admin_activity'::JSONB -> 'result' -> 'audit'
    ) AS audit_row
    WHERE audit_row ->> 'request_id' = :'u7_review_request'
      AND audit_row ->> 'reason_code' = 'document_review_recorded'
  ),
  'U7 audit projection missed expected child-resource activity'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 0
    FROM jsonb_array_elements(
      :'u7_admin_task_workspace'::JSONB -> 'result' -> 'assignees'
    ) AS assignee
    WHERE assignee ->> 'membership_id' IN (
      :'u7_inactive_membership',
      :'finance_a_membership_id'
    )
  ),
  'assignee workspace exposed inactive or ineligible membership'
);

SELECT pg_temp.assert_true(
  NOT (:'u7_sales_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_sales_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_sales_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_sales_activity'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_unrelated_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_unrelated_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_unrelated_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_unrelated_activity'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_previous_curator_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_previous_curator_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_previous_curator_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_previous_curator_activity'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_cross_org_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_cross_org_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_cross_org_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_cross_org_activity'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_inactive_task_workspace'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_inactive_task_workspace'::JSONB ->> 'sqlstate' = '42501'
  AND NOT (:'u7_inactive_activity'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_inactive_activity'::JSONB ->> 'sqlstate' = '42501',
  'sales, unrelated, inactive or cross-org actors retained U7 read access'
);

SELECT pg_temp.assert_true(
  NOT (:'u7_null_case_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_null_case_attempt'::JSONB ->> 'sqlstate' = '22023'
  AND NOT (:'u7_zero_limit_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_zero_limit_attempt'::JSONB ->> 'sqlstate' = '22023'
  AND NOT (:'u7_large_limit_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u7_large_limit_attempt'::JSONB ->> 'sqlstate' = '22023',
  'null case or invalid activity limit must be rejected'
);

SELECT pg_temp.assert_true(
  :'u7_sales_task_state' = '42501'
  AND :'u7_sales_application_state' = '42501'
  AND :'u7_sales_visa_state' = '42501'
  AND :'u7_sales_review_state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      :'u7_sales_task_request',
      :'u7_sales_app_request',
      :'u7_sales_visa_request',
      :'u7_sales_review_request'
    )
  ),
  'post-handoff Sales mutations must stay denied and side-effect free'
);

ROLLBACK;
