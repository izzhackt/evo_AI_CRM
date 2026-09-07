\set ON_ERROR_STOP on

-- Durable fixture for the two-session migration 128 current-version consume
-- race. The authorization database is disposable and removed after the suite.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.e5c_assert_true(
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
    RAISE EXCEPTION 'E5C setup assertion failed: %', p_message;
  END IF;
END
$$;

SELECT
  student_case.organization_id AS e5c_org_id,
  student_case.id AS e5c_case_id,
  student_case.student_membership_id AS e5c_student_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

-- Migration 083 removed the browser-facing membership lifecycle RPC. Restore
-- only the disposable P2H Student fixture as owner, then read fresh claims.
WITH changed_membership AS (
  UPDATE platform.organization_memberships
  SET status = 'active'
  WHERE organization_id = :'e5c_org_id'
    AND id = :'e5c_student_membership_id'
    AND status <> 'active'
  RETURNING profile_id
)
SELECT platform_private.bump_access_version(profile_id)
FROM changed_membership;

SELECT
  profile.auth_user_id AS e5c_student_user_id,
  profile.access_version AS e5c_student_access_version,
  membership.current_bundle_id AS e5c_student_bundle_id,
  bundle.version AS e5c_student_bundle_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
WHERE membership.organization_id = :'e5c_org_id'
  AND membership.id = :'e5c_student_membership_id'
  AND membership.status = 'active'
\gset

SELECT jsonb_build_object(
  'sub', :'e5c_student_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_organization_id', :'e5c_org_id',
  'platform_membership_id', :'e5c_student_membership_id',
  'platform_access_version', :'e5c_student_access_version'::BIGINT,
  'platform_bundle_id', :'e5c_student_bundle_id',
  'platform_bundle_version', :'e5c_student_bundle_version'::BIGINT
)::TEXT AS e5c_student_claims
\gset

-- Reuse the current finalized P2H version whose historical metadata migration
-- deliberately invalidated. Attach a real scanner attestation before granting.
SELECT
  slot.id AS e5c_slot_id,
  version.id AS e5c_original_version_id,
  version.sha256_hex AS e5c_original_sha256_hex
FROM platform.document_slots AS slot
JOIN platform.document_versions AS version
  ON version.organization_id = slot.organization_id
  AND version.student_case_id = slot.student_case_id
  AND version.document_slot_id = slot.id
  AND version.id = slot.current_version_id
JOIN platform_private.document_upload_finalizations AS finalization
  ON finalization.organization_id = version.organization_id
  AND finalization.document_version_id = version.id
WHERE slot.organization_id = :'e5c_org_id'
  AND slot.student_case_id = :'e5c_case_id'
  AND slot.removed_at IS NULL
  AND slot.status IN ('submitted', 'correction_required', 'rejected')
  AND version.integrity_status = 'verified'
  AND version.malware_status = 'error'
  AND version.malware_scan_attestation_id IS NULL
ORDER BY slot.id
LIMIT 1
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SELECT platform_private.attest_document_validation_step(
  :'e5c_org_id',
  :'e5c_original_version_id',
  'ClamAV',
  '1.5.4',
  '28001',
  'clamd-zinstream-v1',
  :'e5c_original_sha256_hex',
  statement_timestamp(),
  '58012890-0000-4000-8000-000000000002'
);
RESET request.jwt.claims;

-- Normalize only unconsumed live grants for this actor/version. Restore normal
-- trigger behavior before exercising the migration-128 public RPC.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.document_download_grants
SET expires_at = statement_timestamp()
WHERE organization_id = :'e5c_org_id'
  AND grantee_auth_user_id = :'e5c_student_user_id'
  AND document_version_id = :'e5c_original_version_id'
  AND expires_at > statement_timestamp()
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_download_consumptions AS consumption
    WHERE consumption.document_download_grant_id =
      platform_private.document_download_grants.id
  );
SET LOCAL session_replication_role = origin;

SET request.jwt.claims TO :'e5c_student_claims';
SET ROLE authenticated;
SELECT platform.grant_student_portal_document_download(
  :'e5c_org_id',
  :'e5c_original_version_id',
  '58012890-0000-4000-8000-000000000003'
);
RESET ROLE;
RESET request.jwt.claims;

SELECT COALESCE(MAX(version.version_no), 0) + 1 AS e5c_replacement_version_no
FROM platform.document_versions AS version
WHERE version.organization_id = :'e5c_org_id'
  AND version.document_slot_id = :'e5c_slot_id'
\gset

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
  submitted_by_membership_id,
  integrity_status,
  malware_status
)
VALUES (
  '58012890-0000-4000-8000-000000000004',
  :'e5c_org_id',
  :'e5c_case_id',
  :'e5c_slot_id',
  :'e5c_replacement_version_no',
  'replacement-e5c.pdf',
  'application/pdf',
  128,
  repeat('c', 64),
  'test:e5c:replacement-before-consume',
  :'e5c_student_membership_id',
  'pending',
  'pending'
);

SELECT pg_temp.e5c_assert_true(
  (
    SELECT count(*) = 1
      AND bool_and(
        grant_row.document_version_id = :'e5c_original_version_id'::UUID
        AND grant_row.grantee_role = 'student'
        AND grant_row.access_purpose = 'student_document_download'
        AND grant_row.expires_in_seconds = 60
      )
    FROM platform_private.document_download_grants AS grant_row
    WHERE grant_row.request_id =
      '58012890-0000-4000-8000-000000000003'
  ),
  'one live Student grant must target the original current version'
);

COMMIT;

SELECT 'platform migration 128 concurrency fixture ready' AS result;
