\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p113c_capture_link(
  p_target_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN jsonb_build_object(
    'outcome', 'ok',
    'receipt', platform.set_document_slot_case_link(
      '59911399-0000-4000-8000-000000000001',
      '59911399-0000-4000-8000-000000000002',
      '59911399-0000-4000-8000-000000000402',
      'university_application',
      p_target_id,
      TRUE,
      1,
      'Concurrent same-version document link proof',
      p_request_id
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'outcome', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p113c_capture_link(UUID, UUID)
  TO authenticated;

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', membership.organization_id,
  'platform_membership_id', membership.id,
  'platform_bundle_id', bundle.id,
  'platform_bundle_version', bundle.version
)::TEXT AS p113c_claims
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
WHERE membership.id = '59911399-0000-4000-8000-000000000302'
\gset

\if :p113c_hold_lock
-- Match the canonical command's lock order before pausing. This keeps the
-- overlap deterministic without introducing a test-only deadlock between the
-- actor, case and slot locks acquired by the real RPC.
SELECT membership.id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
JOIN platform.organizations AS organization
  ON organization.id = membership.organization_id
WHERE membership.id = '59911399-0000-4000-8000-000000000302'
FOR UPDATE OF profile, membership, organization;

SELECT student_case.id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = '59911399-0000-4000-8000-000000000001'
  AND student_case.id = '59911399-0000-4000-8000-000000000002'
FOR UPDATE;

SELECT 1
FROM platform.document_slots AS slot
WHERE slot.organization_id = '59911399-0000-4000-8000-000000000001'
  AND slot.id = '59911399-0000-4000-8000-000000000402'
FOR UPDATE;
\echo P113C_LOCK_HELD=1
SELECT pg_sleep(:'p113c_hold_seconds'::DOUBLE PRECISION);
\endif

SET request.jwt.claims TO :'p113c_claims';
SET ROLE authenticated;

SELECT (
  pg_temp.p113c_capture_link(
    :'p113c_target_id',
    :'p113c_request_id'
  ) ->> 'outcome'
) AS p113c_outcome
\gset

\echo P113C_OUTCOME=:p113c_outcome

RESET ROLE;
COMMIT;
