\set ON_ERROR_STOP on

-- P2E acceptance uses only deterministic synthetic UUIDs and reserved
-- example.invalid identities in the disposable PostgreSQL authorization
-- container. It proves database contracts only: no Storage object, scanner,
-- Queue, WAHA, WhatsApp, or production provider is contacted.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2E assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

-- P2D must have left its two-organization/two-student fixtures at the exact
-- migration-042 boundary. Migration 043 then upgrades every live, inactive,
-- and blocked membership from its immutable v2 role bundle to v3 exactly once.
DO $$
DECLARE
  membership_count INTEGER;
  upgrade_audit_count INTEGER;
  upgrade_history_count INTEGER;
BEGIN
  SELECT count(*) INTO membership_count
  FROM platform.organization_memberships;

  IF membership_count <> 15 THEN
    RAISE EXCEPTION
      'Expected 15 P2D memberships before P2E fixtures, found %',
      membership_count;
  END IF;

  IF (
    SELECT count(*)
    FROM platform.organization_memberships
    WHERE status = 'inactive'
  ) <> 1 OR (
    SELECT count(*)
    FROM platform.organization_memberships
    WHERE status = 'blocked'
  ) <> 1 THEN
    RAISE EXCEPTION
      'P2D inactive and blocked memberships must survive migration 043';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE bundle.version <> 3
      OR bundle.status <> 'published'
      OR bundle.role <> membership."current_role"
  ) THEN
    RAISE EXCEPTION
      'Every P2D membership must point to its matching published v3 bundle';
  END IF;

  SELECT count(*)
  INTO upgrade_audit_count
  FROM platform.audit_events
  WHERE action = 'rbac.bundle.upgrade'
    AND actor_kind = 'system'
    AND actor_profile_id IS NULL
    AND actor_principal =
        'migration:043_platform_documents_finance_notifications'
    AND reason = 'P2E immutable RBAC bundle upgrade'
    AND (before_state ->> 'access_version')::BIGINT + 1 =
        (after_state ->> 'access_version')::BIGINT
    AND EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
      JOIN platform.role_bundle_versions AS previous_bundle
        ON previous_bundle.id =
            (platform.audit_events.before_state ->> 'bundle_id')::UUID
      JOIN platform.role_bundle_versions AS new_bundle
        ON new_bundle.id =
            (platform.audit_events.after_state ->> 'bundle_id')::UUID
      WHERE membership.organization_id =
          platform.audit_events.organization_id
        AND membership.id = platform.audit_events.resource_id
        AND profile.access_version =
            (platform.audit_events.after_state ->> 'access_version')::BIGINT
        AND previous_bundle.version = 2
        AND previous_bundle.status = 'published'
        AND new_bundle.version = 3
        AND new_bundle.status = 'published'
        AND membership.current_bundle_id = new_bundle.id
    );

  SELECT count(*)
  INTO upgrade_history_count
  FROM platform.membership_role_history AS history
  JOIN platform.role_bundle_versions AS previous_bundle
    ON previous_bundle.id = history.previous_bundle_id
  JOIN platform.role_bundle_versions AS new_bundle
    ON new_bundle.id = history.new_bundle_id
  WHERE history.actor_kind = 'system'
    AND history.actor_profile_id IS NULL
    AND history.reason = 'P2E immutable RBAC bundle upgrade'
    AND history.previous_role = history.new_role
    AND previous_bundle.version = 2
    AND previous_bundle.status = 'published'
    AND new_bundle.version = 3
    AND new_bundle.status = 'published';

  IF upgrade_audit_count <> membership_count
    OR upgrade_history_count <> membership_count
  THEN
    RAISE EXCEPTION
      'Expected one P2E audit/history row per membership; audit %, history %, memberships %',
      upgrade_audit_count,
      upgrade_history_count,
      membership_count;
  END IF;

  IF EXISTS (
    SELECT membership_id
    FROM platform.membership_role_history
    WHERE reason = 'P2E immutable RBAC bundle upgrade'
    GROUP BY membership_id
    HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT resource_id
    FROM platform.audit_events
    WHERE action = 'rbac.bundle.upgrade'
      AND actor_principal =
          'migration:043_platform_documents_finance_notifications'
    GROUP BY resource_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'A membership received duplicate P2E upgrade evidence';
  END IF;
END
$$;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS admin_a_membership_id,
  profile.id AS admin_a_profile_id,
  profile.access_version AS admin_a_access_version,
  (
    SELECT (audit.before_state ->> 'access_version')::BIGINT
    FROM platform.audit_events AS audit
    WHERE audit.action = 'rbac.bundle.upgrade'
      AND audit.resource_id = membership.id
      AND audit.actor_principal =
          'migration:043_platform_documents_finance_notifications'
  ) AS admin_a_stale_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS admin_b_membership_id,
  profile.id AS admin_b_profile_id,
  profile.access_version AS admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS case_a_id,
  student_case.student_membership_id AS student_a_membership_id,
  student_case.current_curator_membership_id AS curator_a_membership_id,
  student_case.target_country AS case_a_target_country,
  student_case.target_degree AS case_a_target_degree,
  student_case.program_direction AS case_a_program_direction
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.student_membership_id AS student_b_membership_id,
  student_case.current_curator_membership_id AS curator_b_membership_id,
  student_case.target_country AS case_b_target_country,
  student_case.target_degree AS case_b_target_degree,
  student_case.program_direction AS case_b_program_direction
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.id AS org_b_case_id,
  student_case.student_membership_id AS org_b_student_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_b_id'
  AND student_case.source_key =
      'synthetic:amocrm:lead:org-b'
\gset

SELECT
  membership.id AS student_a_membership_id,
  profile.id AS student_a_profile_id,
  profile.access_version AS student_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset

SELECT
  membership.id AS student_b_membership_id,
  profile.id AS student_b_profile_id,
  profile.access_version AS student_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.id AS curator_a_membership_id,
  profile.id AS curator_a_profile_id,
  profile.access_version AS curator_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS previous_curator_membership_id,
  profile.access_version AS previous_curator_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset

SELECT
  membership.id AS curator_b_membership_id,
  profile.access_version AS curator_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000004'
\gset

SELECT
  membership.id AS finance_a_membership_id,
  profile.id AS finance_a_profile_id,
  profile.access_version AS finance_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000005'
\gset

SELECT
  membership.id AS sales_a_membership_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_stale_access_version'::BIGINT
)::TEXT AS admin_a_stale_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_b_access_version'::BIGINT
)::TEXT AS student_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT
)::TEXT AS curator_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'previous_curator_access_version'::BIGINT
)::TEXT AS previous_curator_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000004',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_b_access_version'::BIGINT
)::TEXT AS curator_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_a_access_version'::BIGINT
)::TEXT AS finance_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS sales_a_claims
\gset

-- The v2 access-version claim is stale after migration 043. The fresh v3
-- claim carries the new permission but remains tied to live membership state.
SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT private.platform_has_permission(
    :'org_a_id',
    'document.manage'
  ),
  'stale v2 claim retained P2E authority'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  private.platform_has_permission(
    :'org_a_id',
    'document.manage'
  ),
  'fresh v3 Admin claim lacks document.manage'
);
RESET ROLE;

-- Provisioning after migration 043 must bind the latest published v3 bundle.
\set p2e_new_student_user_id '43000000-0000-4000-8000-000000000001'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'p2e_new_student_user_id',
  'p2e-new-student@example.invalid',
  '{"display_name":"P2E New Student"}'::JSONB
);

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.provision_member(
    :'org_a_id',
    :'p2e_new_student_user_id',
    'P2E New Student',
    'student',
    'P2E v3 provisioning acceptance',
    '43000000-0000-4000-8000-000000000101'
  ) ->> 'membership_id'
)::TEXT AS p2e_new_student_membership_id
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT bundle.version = 3
      AND bundle.status = 'published'
      AND bundle.role = 'student'
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership.id = :'p2e_new_student_membership_id'
      AND membership.organization_id = :'org_a_id'
  ),
  'post-043 provisioning did not use the published student v3 bundle'
);

-- Finance authority is organization-scoped. The P2D Finance fixture was
-- deliberately provisioned without that scope, so Admin grants it explicitly
-- through the audited P2C API before any finance operation.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.assign_organization_scope(
  :'org_a_id',
  :'finance_a_membership_id',
  'P2E synthetic Finance organization scope',
  '43000000-0000-4000-8000-000000000102'
) IS NOT NULL AS finance_scope_first
\gset
SELECT platform.assign_organization_scope(
  :'org_a_id',
  :'finance_a_membership_id',
  'P2E synthetic Finance organization scope',
  '43000000-0000-4000-8000-000000000102'
) IS NOT NULL AS finance_scope_replay
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'finance_scope_first' = 't'
    AND :'finance_scope_replay' = 't',
  'Finance organization-scope assignment/replay failed'
);

-- Scope assignment rotates the grantee's access version. Refresh only the
-- Finance fixture's synthetic claim before exercising its v3 authority.
SELECT profile.access_version AS finance_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000005'
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_a_access_version'::BIGINT
)::TEXT AS finance_a_claims
\gset

-- -------------------------------------------------------------------------
-- Documents: versioned checklist metadata, trusted validation, review and
-- rework. This creates metadata only; no binary object or scanner is claimed.
-- -------------------------------------------------------------------------

SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_document_requirement(
  :'org_a_id',
  :'case_a_target_country',
  :'case_a_target_degree',
  :'case_a_program_direction',
  1,
  'passport',
  'Passport',
  'Provide a legible passport scan',
  '43000000-0000-4000-8000-000000000110'
);
\set stale_document_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.create_document_requirement(
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    1,
    'passport',
    'Passport',
    'Provide a legible passport scan',
    '43000000-0000-4000-8000-000000000111'
  ) ->> 'document_requirement_id'
)::TEXT AS requirement_a_id
\gset
SELECT (
  platform.create_document_requirement(
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    :'case_a_program_direction',
    1,
    'passport',
    'Passport',
    'Provide a legible passport scan',
    '43000000-0000-4000-8000-000000000111'
  ) ->> 'document_requirement_id'
)::TEXT AS requirement_a_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.create_document_requirement(
  :'org_a_id',
  :'case_a_target_country',
  :'case_a_target_degree',
  :'case_a_program_direction',
  1,
  'passport',
  'Changed replay label',
  'Provide a legible passport scan',
  '43000000-0000-4000-8000-000000000111'
);
\set requirement_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.create_document_requirement(
    :'org_a_id',
    :'case_a_target_country',
    :'case_a_target_degree',
    'Mismatched Program',
    1,
    'route-mismatch',
    'Wrong route fixture',
    'This requirement must not attach to Case A',
    '43000000-0000-4000-8000-000000000112'
  ) ->> 'document_requirement_id'
)::TEXT AS requirement_mismatch_id
\gset

SELECT (
  platform.create_document_requirement(
    :'org_a_id',
    :'case_b_target_country',
    :'case_b_target_degree',
    :'case_b_program_direction',
    1,
    'passport',
    'Passport',
    'Provide a legible passport scan',
    '43000000-0000-4000-8000-000000000113'
  ) ->> 'document_requirement_id'
)::TEXT AS requirement_b_id
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'stale_document_rpc_state' <> '00000'
    AND :'requirement_a_id' = :'requirement_a_replay_id'
    AND :'requirement_replay_mismatch_state' <> '00000',
  'document requirement stale-claim/replay contract failed'
);

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT (
  platform.create_document_slot(
    :'org_a_id',
    :'case_a_id',
    :'requirement_a_id',
    '2026-08-15T00:00:00Z',
    'Submit the passport metadata',
    '43000000-0000-4000-8000-000000000114'
  ) ->> 'document_slot_id'
)::TEXT AS document_slot_a_id
\gset
\set ON_ERROR_STOP off
SELECT platform.create_document_slot(
  :'org_a_id',
  :'case_a_id',
  :'requirement_mismatch_id',
  NULL,
  'This route must be denied',
  '43000000-0000-4000-8000-000000000115'
);
\set document_route_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_document_slot(
  :'org_a_id',
  :'case_a_id',
  :'requirement_a_id',
  NULL,
  'Cross-student scope denial',
  '43000000-0000-4000-8000-000000000116'
);
\set document_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_document_slot(
  :'org_a_id',
  :'case_a_id',
  :'requirement_a_id',
  NULL,
  'Previous Curator must be denied',
  '43000000-0000-4000-8000-000000000117'
);
\set document_previous_curator_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_document_slot(
  :'org_a_id',
  :'case_a_id',
  :'requirement_a_id',
  NULL,
  'Student mutation denial',
  '43000000-0000-4000-8000-000000000118'
);
\set document_student_mutation_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_document_slot(
  :'org_b_id',
  :'org_b_case_id',
  :'requirement_a_id',
  NULL,
  'Cross-organization Admin denial',
  '43000000-0000-4000-8000-000000000119'
);
\set document_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'document_route_mismatch_state' <> '00000'
    AND :'document_cross_student_state' <> '00000'
    AND :'document_previous_curator_state' <> '00000'
    AND :'document_student_mutation_state' <> '00000'
    AND :'document_cross_org_state' <> '00000',
  'document route/role/object/tenant mutation denials failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.record_document_version_metadata(
  :'org_a_id',
  :'document_slot_a_id',
  :'student_a_membership_id',
  'oversize.pdf',
  'application/pdf',
  26214401,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'synthetic:document:ingest:oversize',
  '43000000-0000-4000-8000-000000000120'
);
\set document_oversize_state :SQLSTATE
SELECT platform.record_document_version_metadata(
  :'org_a_id',
  :'document_slot_a_id',
  :'student_a_membership_id',
  'malware.exe',
  'application/octet-stream',
  1024,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'synthetic:document:ingest:mime',
  '43000000-0000-4000-8000-000000000121'
);
\set document_mime_state :SQLSTATE
SELECT platform.record_document_version_metadata(
  :'org_a_id',
  :'document_slot_a_id',
  :'student_b_membership_id',
  'wrong-student.pdf',
  'application/pdf',
  1024,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'synthetic:document:ingest:wrong-student',
  '43000000-0000-4000-8000-000000000122'
);
\set document_wrong_submitter_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.record_document_version_metadata(
    :'org_a_id',
    :'document_slot_a_id',
    :'student_a_membership_id',
    'passport-v1.pdf',
    'application/pdf',
    2048,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'synthetic:document:ingest:v1',
    '43000000-0000-4000-8000-000000000123'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_id
\gset
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id',
    :'document_slot_a_id',
    :'student_a_membership_id',
    'passport-v1.pdf',
    'application/pdf',
    2048,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'synthetic:document:ingest:v1',
    '43000000-0000-4000-8000-000000000123'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.record_document_version_metadata(
  :'org_a_id',
  :'document_slot_a_id',
  :'student_a_membership_id',
  'changed-replay.pdf',
  'application/pdf',
  2048,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'synthetic:document:ingest:v1',
  '43000000-0000-4000-8000-000000000123'
);
\set document_version_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'document_oversize_state' <> '00000'
    AND :'document_mime_state' <> '00000'
    AND :'document_wrong_submitter_state' <> '00000'
    AND :'document_v1_id' = :'document_v1_replay_id'
    AND :'document_version_replay_mismatch_state' <> '00000',
  'document metadata validation/submitter/replay contract failed'
);

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_document_version(
  :'org_a_id',
  :'document_v1_id',
  'approved',
  NULL,
  '43000000-0000-4000-8000-000000000124'
);
\set document_unvalidated_approval_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT (
  platform.attest_document_validation(
    :'org_a_id',
    :'document_v1_id',
    'verified',
    'clean',
    'synthetic-scanner',
    'synthetic:document:validation:v1',
    '43000000-0000-4000-8000-000000000125'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_validated_id
\gset
SELECT (
  platform.attest_document_validation(
    :'org_a_id',
    :'document_v1_id',
    'verified',
    'clean',
    'synthetic-scanner',
    'synthetic:document:validation:v1',
    '43000000-0000-4000-8000-000000000125'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_validation_replay_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.set_own_notification_consent(
  :'org_a_id',
  'granted',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:admin-denied',
  '43000000-0000-4000-8000-000000000320'
);
\set consent_admin_denied_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.set_own_notification_consent(
  :'org_a_id',
  'granted',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:sales-denied',
  '43000000-0000-4000-8000-000000000321'
);
\set consent_sales_denied_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.set_own_notification_consent(
  :'org_a_id',
  'granted',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:curator-denied',
  '43000000-0000-4000-8000-000000000322'
);
\set consent_curator_denied_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.set_own_notification_consent(
  :'org_a_id',
  'granted',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:finance-denied',
  '43000000-0000-4000-8000-000000000323'
);
\set consent_finance_denied_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'consent_admin_denied_state' <> '00000'
    AND :'consent_sales_denied_state' <> '00000'
    AND :'consent_curator_denied_state' <> '00000'
    AND :'consent_finance_denied_state' <> '00000',
  'only the Student recipient may manage individual WhatsApp consent'
);

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT (
  platform.review_document_version(
    :'org_a_id',
    :'document_v1_id',
    'correction_required',
    'The synthetic scan must include all pages',
    '43000000-0000-4000-8000-000000000126'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_reviewed_id
\gset
SELECT (
  platform.review_document_version(
    :'org_a_id',
    :'document_v1_id',
    'correction_required',
    'The synthetic scan must include all pages',
    '43000000-0000-4000-8000-000000000126'
  ) ->> 'document_version_id'
)::TEXT AS document_v1_review_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.review_document_version(
  :'org_a_id',
  :'document_v1_id',
  'rejected',
  ' ',
  '43000000-0000-4000-8000-000000000127'
);
\set document_blank_rework_reason_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT (
  platform.record_document_version_metadata(
    :'org_a_id',
    :'document_slot_a_id',
    :'student_a_membership_id',
    'passport-v2.png',
    'image/png',
    4096,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'synthetic:document:ingest:v2',
    '43000000-0000-4000-8000-000000000128'
  ) ->> 'document_version_id'
)::TEXT AS document_v2_id
\gset
SELECT (
  platform.attest_document_validation(
    :'org_a_id',
    :'document_v2_id',
    'verified',
    'clean',
    'synthetic-scanner',
    'synthetic:document:validation:v2',
    '43000000-0000-4000-8000-000000000129'
  ) ->> 'document_version_id'
)::TEXT AS document_v2_validated_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_document_version(
  :'org_a_id',
  :'document_v1_id',
  'approved',
  NULL,
  '43000000-0000-4000-8000-000000000130'
);
\set document_stale_version_review_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT (
  platform.review_document_version(
    :'org_a_id',
    :'document_v2_id',
    'approved',
    NULL,
    '43000000-0000-4000-8000-000000000131'
  ) ->> 'document_version_id'
)::TEXT AS document_v2_reviewed_id
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.record_document_version_metadata(
  :'org_a_id',
  :'document_slot_a_id',
  :'student_a_membership_id',
  'passport-v3.jpg',
  'image/jpeg',
  4096,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'synthetic:document:ingest:v3',
  '43000000-0000-4000-8000-000000000132'
);
\set document_post_approval_version_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'document_unvalidated_approval_state' <> '00000'
    AND :'document_v1_validated_id' = :'document_v1_id'
    AND :'document_v1_validation_replay_id' = :'document_v1_id'
    AND :'document_v1_reviewed_id' = :'document_v1_id'
    AND :'document_v1_review_replay_id' = :'document_v1_id'
    AND :'document_blank_rework_reason_state' <> '00000'
    AND :'document_v2_validated_id' = :'document_v2_id'
    AND :'document_stale_version_review_state' <> '00000'
    AND :'document_v2_reviewed_id' = :'document_v2_id'
    AND :'document_post_approval_version_state' <> '00000',
  'document validation/review/rework workflow failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
      AND min(version_no) = 1
      AND max(version_no) = 2
    FROM platform.document_versions
    WHERE organization_id = :'org_a_id'
      AND document_slot_id = :'document_slot_a_id'
  )
    AND (
      SELECT status = 'approved'
        AND current_version_id = :'document_v2_id'
        AND current_version_no = 2
      FROM platform.document_slots
      WHERE organization_id = :'org_a_id'
        AND id = :'document_slot_a_id'
    )
    AND (
      SELECT count(*) = 2
      FROM platform.document_validation_events
      WHERE organization_id = :'org_a_id'
        AND document_slot_id = :'document_slot_a_id'
    )
    AND (
      SELECT count(*) = 2
      FROM platform.document_reviews
      WHERE organization_id = :'org_a_id'
        AND document_slot_id = :'document_slot_a_id'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.document_reviews
      WHERE organization_id = :'org_a_id'
        AND document_version_id = :'document_v1_id'
        AND decision = 'correction_required'
        AND reason = 'The synthetic scan must include all pages'
    ),
  'immutable document versions, current pointer, or rework history drifted'
);

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.document_versions
    WHERE organization_id = :'org_a_id'
  ),
  'organization-scoped Admin cannot read full document metadata'
);
\set ON_ERROR_STOP off
UPDATE platform.document_slots
SET next_action = 'Browser DML must not be allowed'
WHERE organization_id = :'org_a_id'
  AND id = :'document_slot_a_id';
\set document_browser_dml_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.document_versions
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
  ),
  'current Curator cannot read assigned document metadata'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
  ),
  'other-student Curator read Case A document metadata'
);
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
      AND student_case_id = :'case_a_id'
  ),
  'previous Curator retained Case A document metadata access'
);
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
  ),
  'Finance gained full document metadata access'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.student_portal_documents()
    WHERE case_id = :'case_a_id'
      AND document_slot_id = :'document_slot_a_id'
      AND (
        (version_no = 1 AND review_decision = 'correction_required')
        OR (version_no = 2 AND review_decision = 'approved')
      )
  ),
  'Student A base-table denial or self-only document projection failed'
);
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_documents()
    WHERE case_id = :'case_a_id'
  ),
  'Student B read Student A document projection'
);
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.sales_document_checklist()
    WHERE case_id = :'case_a_id'
  ),
  'Sales retained document checklist access after Curator handoff'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.document_slots
    WHERE organization_id = :'org_a_id'
  ),
  'organization-B Admin read organization-A document metadata'
);
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.document_versions LIMIT 1;
\set document_service_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT * FROM platform.student_portal_documents();
\set document_anon_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'document_browser_dml_state' <> '00000'
    AND :'document_service_read_state' <> '00000'
    AND :'document_anon_projection_state' <> '00000',
  'document browser/service/anonymous grant boundary failed'
);

-- -------------------------------------------------------------------------
-- Finance: manual evidence-backed obligations, exact-payment refunds, stop
-- factors and computed safe projections.
-- -------------------------------------------------------------------------

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_payment_obligation(
  :'org_a_id',
  :'case_a_id',
  'Student must not create finance state',
  'evo_service_fee',
  10000,
  'KGS',
  '2020-01-01T00:00:00Z',
  'Contact Finance',
  'Student mutation denial',
  '43000000-0000-4000-8000-000000000200'
);
\set finance_student_mutation_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_payment_obligation(
  :'org_a_id',
  :'case_a_id',
  'Invalid zero obligation',
  'evo_service_fee',
  0,
  'KGS',
  '2020-01-01T00:00:00Z',
  'Contact Finance',
  'Invalid amount acceptance',
  '43000000-0000-4000-8000-000000000201'
);
\set finance_zero_obligation_state :SQLSTATE
SELECT platform.create_payment_obligation(
  :'org_b_id',
  :'org_b_case_id',
  'Cross-organization obligation',
  'evo_service_fee',
  10000,
  'KGS',
  '2020-01-01T00:00:00Z',
  'Contact Finance',
  'Cross-organization denial',
  '43000000-0000-4000-8000-000000000202'
);
\set finance_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.create_payment_obligation(
    :'org_a_id',
    :'case_a_id',
    'EVO synthetic service fee',
    'evo_service_fee',
    10000,
    'KGS',
    '2020-01-01T00:00:00Z',
    'Contact Finance to clear the overdue balance',
    'Synthetic P2E obligation acceptance',
    '43000000-0000-4000-8000-000000000203'
  ) ->> 'payment_obligation_id'
)::TEXT AS obligation_a_id
\gset
SELECT (
  platform.create_payment_obligation(
    :'org_a_id',
    :'case_a_id',
    'EVO synthetic service fee',
    'evo_service_fee',
    10000,
    'KGS',
    '2020-01-01T00:00:00Z',
    'Contact Finance to clear the overdue balance',
    'Synthetic P2E obligation acceptance',
    '43000000-0000-4000-8000-000000000203'
  ) ->> 'payment_obligation_id'
)::TEXT AS obligation_a_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.create_payment_obligation(
  :'org_a_id',
  :'case_a_id',
  'Changed replay label',
  'evo_service_fee',
  10000,
  'KGS',
  '2020-01-01T00:00:00Z',
  'Contact Finance to clear the overdue balance',
  'Synthetic P2E obligation acceptance',
  '43000000-0000-4000-8000-000000000203'
);
\set finance_obligation_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.create_payment_obligation(
    :'org_a_id',
    :'case_b_id',
    'Synthetic third-party study cost',
    'third_party_cost',
    1000,
    'KGS',
    '2030-01-01T00:00:00Z',
    'Confirm the remaining study cost',
    'Synthetic cross-case finance fixture',
    '43000000-0000-4000-8000-000000000204'
  ) ->> 'payment_obligation_id'
)::TEXT AS obligation_b_id
\gset

SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'obligation_a_id',
    'payment',
    NULL,
    6000,
    'KGS',
    '2026-07-29T00:00:00Z',
    'synthetic:finance:payment:a1',
    'synthetic:finance:evidence:payment:a1',
    'Synthetic confirmed payment',
    '43000000-0000-4000-8000-000000000205'
  ) ->> 'payment_event_id'
)::TEXT AS payment_a1_id
\gset
SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'obligation_a_id',
    'payment',
    NULL,
    6000,
    'KGS',
    '2026-07-29T00:00:00Z',
    'synthetic:finance:payment:a1',
    'synthetic:finance:evidence:payment:a1',
    'Synthetic confirmed payment',
    '43000000-0000-4000-8000-000000000205'
  ) ->> 'payment_event_id'
)::TEXT AS payment_a1_replay_id
\gset

\set ON_ERROR_STOP off
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'payment',
  NULL,
  5000,
  'KGS',
  '2026-07-29T00:05:00Z',
  'synthetic:finance:payment:over',
  'synthetic:finance:evidence:payment:over',
  'Overpayment denial',
  '43000000-0000-4000-8000-000000000206'
);
\set finance_overpayment_state :SQLSTATE
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'payment',
  NULL,
  1000,
  'USD',
  '2026-07-29T00:06:00Z',
  'synthetic:finance:payment:currency',
  'synthetic:finance:evidence:payment:currency',
  'Currency mismatch denial',
  '43000000-0000-4000-8000-000000000207'
);
\set finance_currency_state :SQLSTATE
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'refund',
  NULL,
  1000,
  'KGS',
  '2026-07-29T00:07:00Z',
  'synthetic:finance:refund:no-parent',
  'synthetic:finance:evidence:refund:no-parent',
  'Exact payment reference required',
  '43000000-0000-4000-8000-000000000208'
);
\set finance_refund_without_parent_state :SQLSTATE
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'refund',
  :'payment_a1_id',
  1000,
  'USD',
  '2026-07-29T00:08:00Z',
  'synthetic:finance:refund:currency',
  'synthetic:finance:evidence:refund:currency',
  'Refund currency mismatch denial',
  '43000000-0000-4000-8000-000000000209'
);
\set finance_refund_currency_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'obligation_a_id',
    'refund',
    :'payment_a1_id',
    2000,
    'KGS',
    '2026-07-29T00:10:00Z',
    'synthetic:finance:refund:a1',
    'synthetic:finance:evidence:refund:a1',
    'Synthetic confirmed refund',
    '43000000-0000-4000-8000-000000000210'
  ) ->> 'payment_event_id'
)::TEXT AS refund_a1_id
\gset
SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'obligation_a_id',
    'refund',
    :'payment_a1_id',
    2000,
    'KGS',
    '2026-07-29T00:10:00Z',
    'synthetic:finance:refund:a1',
    'synthetic:finance:evidence:refund:a1',
    'Synthetic confirmed refund',
    '43000000-0000-4000-8000-000000000210'
  ) ->> 'payment_event_id'
)::TEXT AS refund_a1_replay_id
\gset

\set ON_ERROR_STOP off
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'refund',
  :'payment_a1_id',
  4500,
  'KGS',
  '2026-07-29T00:11:00Z',
  'synthetic:finance:refund:over-parent',
  'synthetic:finance:evidence:refund:over-parent',
  'Per-payment refund ceiling denial',
  '43000000-0000-4000-8000-000000000211'
);
\set finance_refund_parent_cap_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.record_payment_event(
    :'org_a_id',
    :'obligation_b_id',
    'payment',
    NULL,
    500,
    'KGS',
    '2026-07-29T00:12:00Z',
    'synthetic:finance:payment:b1',
    'synthetic:finance:evidence:payment:b1',
    'Synthetic Case B payment',
    '43000000-0000-4000-8000-000000000212'
  ) ->> 'payment_event_id'
)::TEXT AS payment_b1_id
\gset

\set ON_ERROR_STOP off
SELECT platform.record_payment_event(
  :'org_a_id',
  :'obligation_a_id',
  'refund',
  :'payment_b1_id',
  100,
  'KGS',
  '2026-07-29T00:13:00Z',
  'synthetic:finance:refund:cross-case',
  'synthetic:finance:evidence:refund:cross-case',
  'Cross-case exact-payment reference denial',
  '43000000-0000-4000-8000-000000000213'
);
\set finance_refund_cross_case_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  platform.create_stop_factor(
    :'org_a_id',
    :'case_a_id',
    :'obligation_a_id',
    :'finance_a_membership_id',
    'Synthetic overdue balance review',
    'document-release',
    'Confirm the evidence-backed balance',
    'synthetic:finance:evidence:stop:a1',
    '43000000-0000-4000-8000-000000000214'
  ) ->> 'stop_factor_id'
)::TEXT AS stop_factor_a1_id
\gset
\set ON_ERROR_STOP off
SELECT platform.create_stop_factor(
  :'org_a_id',
  :'case_b_id',
  :'obligation_a_id',
  :'finance_a_membership_id',
  'Cross-case stop factor denial',
  'document-release',
  'This must not persist',
  'synthetic:finance:evidence:stop:cross-case',
  '43000000-0000-4000-8000-000000000215'
);
\set stop_factor_cross_case_state :SQLSTATE
SELECT platform.resolve_stop_factor(
  :'org_a_id',
  :'stop_factor_a1_id',
  'payment_event',
  :'payment_b1_id',
  'Cross-case payment must not resolve the factor',
  NULL,
  '43000000-0000-4000-8000-000000000216'
);
\set stop_factor_cross_payment_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT (
  platform.resolve_stop_factor(
    :'org_a_id',
    :'stop_factor_a1_id',
    'payment_event',
    :'payment_a1_id',
    'Evidence-backed payment resolution',
    NULL,
    '43000000-0000-4000-8000-000000000217'
  ) ->> 'stop_factor_id'
)::TEXT AS stop_factor_a1_resolved_id
\gset
SELECT (
  platform.resolve_stop_factor(
    :'org_a_id',
    :'stop_factor_a1_id',
    'payment_event',
    :'payment_a1_id',
    'Evidence-backed payment resolution',
    NULL,
    '43000000-0000-4000-8000-000000000217'
  ) ->> 'stop_factor_id'
)::TEXT AS stop_factor_a1_replay_id
\gset

SELECT (
  platform.create_stop_factor(
    :'org_a_id',
    :'case_a_id',
    :'obligation_a_id',
    :'finance_a_membership_id',
    'Synthetic Admin override fixture',
    'application-submit',
    'Admin must review the manual exception',
    'synthetic:finance:evidence:stop:a2',
    '43000000-0000-4000-8000-000000000218'
  ) ->> 'stop_factor_id'
)::TEXT AS stop_factor_a2_id
\gset
\set ON_ERROR_STOP off
SELECT platform.resolve_stop_factor(
  :'org_a_id',
  :'stop_factor_a2_id',
  'admin_override',
  NULL,
  'Finance must not perform an Admin override',
  'synthetic:finance:evidence:override:finance',
  '43000000-0000-4000-8000-000000000219'
);
\set stop_factor_finance_override_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.resolve_stop_factor(
    :'org_a_id',
    :'stop_factor_a2_id',
    'admin_override',
    NULL,
    'Synthetic reviewed Admin exception',
    'synthetic:finance:evidence:override:admin',
    '43000000-0000-4000-8000-000000000220'
  ) ->> 'stop_factor_id'
)::TEXT AS stop_factor_a2_resolved_id
\gset
\set ON_ERROR_STOP off
UPDATE platform.payment_obligations
SET total_paid_minor = 10000
WHERE organization_id = :'org_a_id'
  AND id = :'obligation_a_id';
\set finance_browser_dml_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'finance_student_mutation_state' <> '00000'
    AND :'finance_zero_obligation_state' <> '00000'
    AND :'finance_cross_org_state' <> '00000'
    AND :'obligation_a_id' = :'obligation_a_replay_id'
    AND :'finance_obligation_replay_mismatch_state' <> '00000'
    AND :'payment_a1_id' = :'payment_a1_replay_id'
    AND :'finance_overpayment_state' <> '00000'
    AND :'finance_currency_state' <> '00000'
    AND :'finance_refund_without_parent_state' <> '00000'
    AND :'finance_refund_currency_state' <> '00000'
    AND :'refund_a1_id' = :'refund_a1_replay_id'
    AND :'finance_refund_parent_cap_state' <> '00000'
    AND :'finance_refund_cross_case_state' <> '00000'
    AND :'stop_factor_cross_case_state' <> '00000'
    AND :'stop_factor_cross_payment_state' <> '00000'
    AND :'stop_factor_a1_id' = :'stop_factor_a1_resolved_id'
    AND :'stop_factor_a1_id' = :'stop_factor_a1_replay_id'
    AND :'stop_factor_finance_override_state' <> '00000'
    AND :'stop_factor_a2_id' = :'stop_factor_a2_resolved_id'
    AND :'finance_browser_dml_state' <> '00000',
  'finance evidence/arithmetic/refund/stop-factor contract failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT total_paid_minor = 6000
      AND total_refunded_minor = 2000
    FROM platform.payment_obligations
    WHERE organization_id = :'org_a_id'
      AND id = :'obligation_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.payment_events
    WHERE organization_id = :'org_a_id'
      AND payment_obligation_id = :'obligation_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.payment_evidence
    WHERE organization_id = :'org_a_id'
      AND payment_obligation_id = :'obligation_a_id'
  ) AND (
    SELECT count(*) = 2
      AND bool_and(status = 'resolved')
    FROM platform.stop_factors
    WHERE organization_id = :'org_a_id'
      AND payment_obligation_id = :'obligation_a_id'
  ) AND (
    SELECT count(*) = 4
    FROM platform.stop_factor_events
    WHERE organization_id = :'org_a_id'
      AND payment_obligation_id = :'obligation_a_id'
  ),
  'finance immutable history or derived totals drifted'
);

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.student_portal_finance()
    WHERE case_id = :'case_a_id'
      AND payment_obligation_id = :'obligation_a_id'
      AND amount_minor = 10000
      AND currency = 'KGS'
      AND derived_status = 'overdue'
      AND overdue
      AND next_action =
          'Contact Finance to clear the overdue balance'
  ),
  'Student A overdue self-only projection is incorrect'
);
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_finance()
    WHERE case_id = :'case_a_id'
  ) AND (
    SELECT count(*) = 1
    FROM platform.student_portal_finance()
    WHERE case_id = :'case_b_id'
      AND payment_obligation_id = :'obligation_b_id'
      AND derived_status = 'partially_paid'
      AND NOT overdue
  ),
  'Student B finance isolation or self-only projection failed'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.case_finance_summaries()
    WHERE case_id = :'case_a_id'
      AND payment_obligation_id = :'obligation_a_id'
      AND derived_status = 'overdue'
      AND overdue
      AND NOT has_active_stop_factor
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform.case_finance_summaries()
    WHERE case_id = :'case_b_id'
  ),
  'Curator A safe finance summary or object scope failed'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.case_finance_summaries()
    WHERE case_id = :'case_b_id'
      AND payment_obligation_id = :'obligation_b_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform.case_finance_summaries()
    WHERE case_id = :'case_a_id'
  ),
  'Curator B finance object isolation failed'
);
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.case_finance_summaries()
    WHERE case_id IN (:'case_a_id', :'case_b_id')
  ),
  'Sales retained finance summary after Curator handoff'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.payment_obligations
    WHERE organization_id = :'org_a_id'
  ),
  'organization-B Admin read organization-A finance base records'
);
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.payment_events LIMIT 1;
\set finance_service_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT * FROM platform.student_portal_finance();
\set finance_anon_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'finance_service_read_state' <> '00000'
    AND :'finance_anon_projection_state' <> '00000',
  'finance service/anonymous grant boundary failed'
);

-- -------------------------------------------------------------------------
-- Notifications: one recipient, durable in-app state, consent-gated
-- individual-WhatsApp intent, dedupe/replay and self-only read state. P2E
-- never advances an intent to provider sent/delivered/ACK success.
-- -------------------------------------------------------------------------

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT (
  platform.set_own_notification_consent(
    :'org_a_id',
    'granted',
    'synthetic:notification-policy:v1',
    'synthetic:notification-consent:student-a:grant',
    '43000000-0000-4000-8000-000000000300'
  ) ->> 'notification_consent_id'
)::TEXT AS consent_a_id
\gset
SELECT (
  platform.set_own_notification_consent(
    :'org_a_id',
    'granted',
    'synthetic:notification-policy:v1',
    'synthetic:notification-consent:student-a:grant',
    '43000000-0000-4000-8000-000000000300'
  ) ->> 'notification_consent_id'
)::TEXT AS consent_a_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.set_own_notification_consent(
  :'org_a_id',
  'withdrawn',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:student-a:mismatch',
  '43000000-0000-4000-8000-000000000300'
);
\set consent_replay_mismatch_state :SQLSTATE
SELECT platform.set_own_notification_consent(
  :'org_b_id',
  'granted',
  'synthetic:notification-policy:v1',
  'synthetic:notification-consent:cross-org',
  '43000000-0000-4000-8000-000000000301'
);
\set consent_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Synthetic document review',
  'Your synthetic passport metadata was reviewed.',
  'synthetic:notification:case-a:document-review',
  '43000000-0000-4000-8000-000000000302'
)::TEXT AS notification_a1_result
\gset
SELECT (
  :'notification_a1_result'::JSONB ->> 'notification_id'
)::TEXT AS notification_a1_id,
(
  :'notification_a1_result'::JSONB ->> 'whatsapp_intent_id'
)::TEXT AS notification_a1_whatsapp_intent_id
\gset
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Synthetic document review',
  'Your synthetic passport metadata was reviewed.',
  'synthetic:notification:case-a:document-review',
  '43000000-0000-4000-8000-000000000302'
)::TEXT AS notification_a1_request_replay
\gset
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Synthetic document review',
  'Your synthetic passport metadata was reviewed.',
  'synthetic:notification:case-a:document-review',
  '43000000-0000-4000-8000-000000000303'
)::TEXT AS notification_a1_dedupe_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Changed dedupe payload',
  'The same business key must not accept another payload.',
  'synthetic:notification:case-a:document-review',
  '43000000-0000-4000-8000-000000000304'
);
\set notification_dedupe_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'consent_a_id' = :'consent_a_replay_id'
    AND :'consent_replay_mismatch_state' <> '00000'
    AND :'consent_cross_org_state' <> '00000'
    AND (
      :'notification_a1_result'::JSONB ->> 'notification_id'
    ) = (
      :'notification_a1_request_replay'::JSONB ->> 'notification_id'
    )
    AND (
      :'notification_a1_result'::JSONB ->> 'notification_id'
    ) = (
      :'notification_a1_dedupe_replay'::JSONB ->> 'notification_id'
    )
    AND (
      :'notification_a1_result'::JSONB ->> 'recipient_membership_id'
    ) = :'student_a_membership_id'
    AND (
      :'notification_a1_result'::JSONB ->> 'in_app_intent_status'
    ) = 'pending'
    AND (
      :'notification_a1_result'::JSONB ->> 'whatsapp_intent_status'
    ) = 'pending'
    AND (
      :'notification_a1_result'::JSONB ->> 'consent_status_snapshot'
    ) = 'granted'
    AND (
      :'notification_a1_result'::JSONB ->> 'delivery_proof'
    ) = 'false'
    AND (
      :'notification_a1_dedupe_replay'::JSONB ->> 'deduplicated'
    ) = 'true'
    AND :'notification_dedupe_mismatch_state' <> '00000',
  'notification consent/dedupe/pending-intent contract failed'
);

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT (
  platform.set_own_notification_consent(
    :'org_a_id',
    'withdrawn',
    'synthetic:notification-policy:v1',
    'synthetic:notification-consent:student-a:withdraw',
    '43000000-0000-4000-8000-000000000305'
  ) ->> 'notification_consent_id'
)::TEXT AS consent_a_withdrawn_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'finance',
  'Synthetic overdue notice',
  'Review the clear next action in your Portal.',
  'synthetic:notification:case-a:overdue',
  '43000000-0000-4000-8000-000000000306'
)::TEXT AS notification_a2_result
\gset
SELECT (
  :'notification_a2_result'::JSONB ->> 'notification_id'
)::TEXT AS notification_a2_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_b_id',
  'documents',
  'Synthetic Case B checklist',
  'Review your synthetic document checklist.',
  'synthetic:notification:case-b:checklist',
  '43000000-0000-4000-8000-000000000307'
)::TEXT AS notification_b1_result
\gset
SELECT (
  :'notification_b1_result'::JSONB ->> 'notification_id'
)::TEXT AS notification_b1_id
\gset
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Cross-student notification',
  'Curator B must not create this notification.',
  'synthetic:notification:cross-student',
  '43000000-0000-4000-8000-000000000308'
);
\set notification_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Post-handoff Sales denial',
  'Sales must not notify after handoff.',
  'synthetic:notification:post-handoff-sales',
  '43000000-0000-4000-8000-000000000309'
);
\set notification_post_handoff_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Finance category denial',
  'Finance may create only finance notifications.',
  'synthetic:notification:finance-category-denial',
  '43000000-0000-4000-8000-000000000310'
);
\set notification_finance_category_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Student create denial',
  'Students must not create notifications.',
  'synthetic:notification:student-create-denial',
  '43000000-0000-4000-8000-000000000311'
);
\set notification_student_create_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT (
  platform.mark_own_notification_read(
    :'org_a_id',
    :'notification_a1_id',
    '43000000-0000-4000-8000-000000000312'
  ) ->> 'notification_id'
)::TEXT AS notification_a1_read_id
\gset
SELECT (
  platform.mark_own_notification_read(
    :'org_a_id',
    :'notification_a1_id',
    '43000000-0000-4000-8000-000000000312'
  ) ->> 'notification_id'
)::TEXT AS notification_a1_read_replay_id
\gset
\set ON_ERROR_STOP off
SELECT platform.mark_own_notification_read(
  :'org_a_id',
  :'notification_a1_id',
  '43000000-0000-4000-8000-000000000313'
);
\set notification_second_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.mark_own_notification_read(
  :'org_a_id',
  :'notification_a1_id',
  '43000000-0000-4000-8000-000000000314'
);
\set notification_cross_recipient_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'consent_a_withdrawn_id' = :'consent_a_id'
    AND (
      :'notification_a2_result'::JSONB ->> 'recipient_membership_id'
    ) = :'student_a_membership_id'
    AND (
      :'notification_a2_result'::JSONB ->> 'in_app_intent_status'
    ) = 'pending'
    AND (
      :'notification_a2_result'::JSONB ->> 'whatsapp_intent_status'
    ) = 'consent_blocked'
    AND (
      :'notification_a2_result'::JSONB ->> 'consent_status_snapshot'
    ) = 'withdrawn'
    AND (
      :'notification_a2_result'::JSONB ->> 'delivery_proof'
    ) = 'false'
    AND (
      :'notification_b1_result'::JSONB ->> 'recipient_membership_id'
    ) = :'student_b_membership_id'
    AND (
      :'notification_b1_result'::JSONB ->> 'whatsapp_intent_status'
    ) = 'consent_blocked'
    AND (
      :'notification_b1_result'::JSONB ->> 'consent_status_snapshot'
    ) IS NULL
    AND :'notification_cross_student_state' <> '00000'
    AND :'notification_post_handoff_sales_state' <> '00000'
    AND :'notification_finance_category_state' <> '00000'
    AND :'notification_student_create_state' <> '00000'
    AND :'notification_a1_read_id' = :'notification_a1_id'
    AND :'notification_a1_read_replay_id' = :'notification_a1_id'
    AND :'notification_second_read_state' <> '00000'
    AND :'notification_cross_recipient_read_state' <> '00000',
  'notification consent withdrawal/role/read contract failed'
);

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
    FROM platform.my_notifications()
    WHERE student_case_id = :'case_a_id'
      AND notification_id IN (
        :'notification_a1_id',
        :'notification_a2_id'
      )
      AND in_app_status = 'pending'
      AND individual_whatsapp_status IN ('pending', 'consent_blocked')
  ),
  'Student A self-only notification projection failed'
);
\set ON_ERROR_STOP off
UPDATE platform.notifications
SET read_at = NULL
WHERE organization_id = :'org_a_id'
  AND id = :'notification_a1_id';
\set notification_browser_dml_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform.my_notifications()
    WHERE notification_id = :'notification_b1_id'
      AND student_case_id = :'case_b_id'
      AND in_app_status = 'pending'
      AND individual_whatsapp_status = 'consent_blocked'
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform.my_notifications()
    WHERE notification_id IN (
      :'notification_a1_id',
      :'notification_a2_id'
    )
  ),
  'Student B notification recipient isolation failed'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_individual_notification(
  :'org_a_id',
  :'case_a_id',
  'documents',
  'Cross-organization Admin denial',
  'Organization B Admin must not create this.',
  'synthetic:notification:cross-org-admin',
  '43000000-0000-4000-8000-000000000315'
);
\set notification_cross_org_admin_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.notification_delivery_intents LIMIT 1;
\set notification_service_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT * FROM platform.my_notifications();
\set notification_anon_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'notification_browser_dml_state' <> '00000'
    AND :'notification_cross_org_admin_state' <> '00000'
    AND :'notification_service_read_state' <> '00000'
    AND :'notification_anon_projection_state' <> '00000',
  'notification browser/tenant/service/anonymous boundary failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 3
    FROM platform.notifications
    WHERE organization_id = :'org_a_id'
  ) AND (
    SELECT count(*) = 6
      AND bool_and(
        status IN ('pending', 'consent_blocked')
      )
    FROM platform.notification_delivery_intents
    WHERE organization_id = :'org_a_id'
  ) AND (
    SELECT count(*) = 4
    FROM platform.notification_events
    WHERE organization_id = :'org_a_id'
  ) AND (
    SELECT count(*) = 2
    FROM platform.notification_consent_events
    WHERE organization_id = :'org_a_id'
      AND membership_id = :'student_a_membership_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform.notification_consents AS consent
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = consent.organization_id
      AND membership.id = consent.membership_id
    WHERE consent.organization_id = :'org_a_id'
      AND membership."current_role" <> 'student'
  ) AND (
    SELECT count(*) = 1
    FROM platform.notifications
    WHERE organization_id = :'org_a_id'
      AND recipient_membership_id = :'student_a_membership_id'
      AND dedupe_key =
          'synthetic:notification:case-a:document-review'
  ),
  'notification singular-recipient/dedupe/append-only history drifted'
);

\echo 'P2E documents, finance, notifications RLS acceptance passed'
