\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.e5ac_capture_claim(
  p_organization_id UUID,
  p_actor_auth_user_id UUID,
  p_admission_id UUID,
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.claim_student_document_upload_scan(
    p_organization_id,
    p_actor_auth_user_id,
    p_admission_id,
    p_request_id
  );
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

REVOKE ALL ON FUNCTION pg_temp.e5ac_capture_claim(UUID, UUID, UUID, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.e5ac_capture_claim(UUID, UUID, UUID, UUID)
  TO service_role;

SELECT
  admission.organization_id AS e5ac_org_id,
  admission.uploader_auth_user_id AS e5ac_student_user_id,
  admission.id AS e5ac_admission_id
FROM platform_private.student_document_scan_admissions AS admission
WHERE admission.request_id = :'e5ac_request_id'
  AND admission.document_slot_id =
    '58012891-0000-4000-8000-000000000001'
  AND admission.released_at IS NULL
\gset

BEGIN;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.e5ac_capture_claim(
  :'e5ac_org_id',
  :'e5ac_student_user_id',
  :'e5ac_admission_id',
  :'e5ac_request_id'
) AS e5ac_outcome
\gset

\echo E5AC_OUTCOME=:e5ac_outcome

\if :e5ac_hold_lock
\echo E5AC_SCAN_CLAIM_LOCK_HELD=1
SELECT pg_sleep(:'e5ac_hold_seconds'::DOUBLE PRECISION);
\endif

COMMIT;

\echo E5AC_WORKER=ok
