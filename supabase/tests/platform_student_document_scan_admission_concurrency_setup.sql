\set ON_ERROR_STOP on

-- Durable fixture for a two-session scan-claim race. Two body/rate admissions
-- may coexist; only the service claim immediately before ClamAV is scarce.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5ac_assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'E5AC setup assertion failed: %', p_message;
  END IF;
END
$$;

SELECT
  student_case.organization_id AS e5ac_org_id,
  student_case.id AS e5ac_case_id,
  student_case.student_membership_id AS e5ac_student_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

WITH changed_membership AS (
  UPDATE platform.organization_memberships
  SET status = 'active'
  WHERE organization_id = :'e5ac_org_id'
    AND id = :'e5ac_student_membership_id'
    AND status <> 'active'
  RETURNING profile_id
)
SELECT platform_private.bump_access_version(profile_id)
FROM changed_membership;

SELECT
  profile.auth_user_id AS e5ac_student_user_id,
  profile.access_version AS e5ac_student_access_version,
  membership.current_bundle_id AS e5ac_student_bundle_id,
  bundle.version AS e5ac_student_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
WHERE membership.organization_id = :'e5ac_org_id'
  AND membership.id = :'e5ac_student_membership_id'
  AND membership.status = 'active'
\gset

SELECT jsonb_build_object(
  'sub', :'e5ac_student_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_organization_id', :'e5ac_org_id',
  'platform_membership_id', :'e5ac_student_membership_id',
  'platform_access_version', :'e5ac_student_access_version'::BIGINT,
  'platform_bundle_id', :'e5ac_student_bundle_id',
  'platform_bundle_version', :'e5ac_student_bundle_version'::BIGINT
)::TEXT AS e5ac_student_claims
\gset

INSERT INTO platform.document_slots (
  id,
  organization_id,
  student_case_id,
  requirement_id,
  status,
  created_by_membership_id,
  intent_kind,
  display_label,
  group_label
)
VALUES (
  '58012891-0000-4000-8000-000000000001',
  :'e5ac_org_id',
  :'e5ac_case_id',
  NULL,
  'required',
  :'e5ac_student_membership_id',
  'custom',
  'E5 serialized scan slot',
  'E5 concurrency proof'
);

SET request.jwt.claims TO :'e5ac_student_claims';
SET ROLE authenticated;
SELECT platform.admit_student_document_upload_scan(
  :'e5ac_org_id',
  '58012891-0000-4000-8000-000000000001',
  '58012891-0000-4000-8000-000000000002'
);
SELECT platform.admit_student_document_upload_scan(
  :'e5ac_org_id',
  '58012891-0000-4000-8000-000000000001',
  '58012891-0000-4000-8000-000000000003'
);
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.e5ac_assert_true(
  (
    SELECT count(*) = 1
    FROM platform.document_slots
    WHERE id = '58012891-0000-4000-8000-000000000001'
      AND organization_id = :'e5ac_org_id'
      AND student_case_id = :'e5ac_case_id'
      AND status = 'required'
      AND removed_at IS NULL
  ),
  'serialized scan slot fixture is unavailable'
);

SELECT pg_temp.e5ac_assert_true(
  (
    SELECT count(*) = 2
      AND bool_and(scan_claimed_at IS NULL)
      AND bool_and(released_at IS NULL)
    FROM platform_private.student_document_scan_admissions
    WHERE request_id IN (
      '58012891-0000-4000-8000-000000000002',
      '58012891-0000-4000-8000-000000000003'
    )
  ),
  'two pre-scan admissions must coexist without consuming capacity'
);

COMMIT;

SELECT 'platform migration 128 scan admission concurrency fixture ready'
  AS result;
