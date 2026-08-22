\set ON_ERROR_STOP on

-- P2D acceptance uses only fixed synthetic UUIDs and reserved example.invalid
-- identities in the disposable PostgreSQL authorization container. It neither
-- reads nor mutates a provider or production system.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2D assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

-- The P2C suite must have run against the exact 041 boundary. Migration 042
-- must then advance every extant membership, including inactive and blocked
-- memberships, from its immutable v1 bundle to v2 with one access-version bump.
DO $$
DECLARE
  membership_count INTEGER;
  upgrade_audit_count INTEGER;
  upgrade_history_count INTEGER;
BEGIN
  SELECT count(*) INTO membership_count
  FROM platform.organization_memberships;

  IF membership_count <> 7 THEN
    RAISE EXCEPTION
      'Expected the seven P2C memberships before P2D fixtures, found %',
      membership_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.audit_events
    WHERE action = 'membership.status.change'
      AND request_id = '20000000-0000-4000-8000-000000000035'
  ) OR NOT EXISTS (
    SELECT 1
    FROM platform.audit_events
    WHERE action = 'membership.status.change'
      AND request_id = '20000000-0000-4000-8000-000000000036'
  ) THEN
    RAISE EXCEPTION
      'P2C inactive/blocked terminal fixtures were not present before 042';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE bundle.version <> 2
      OR bundle.status <> 'published'
      OR bundle.role <> membership."current_role"
  ) THEN
    RAISE EXCEPTION
      'Every existing membership must point at its matching published v2 bundle';
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
      'P2C inactive and blocked membership debt must survive the v2 upgrade';
  END IF;

  SELECT count(*) INTO upgrade_audit_count
  FROM platform.audit_events
  WHERE action = 'rbac.bundle.upgrade'
    AND reason = 'P2D immutable RBAC bundle upgrade'
    AND actor_principal = 'migration:042_platform_student_admissions'
    AND (after_state ->> 'access_version')::BIGINT =
      (before_state ->> 'access_version')::BIGINT + 1
    AND (after_state ->> 'role') = (before_state ->> 'role');

  SELECT count(*) INTO upgrade_history_count
  FROM platform.membership_role_history
  WHERE reason = 'P2D immutable RBAC bundle upgrade'
    AND previous_role = new_role;

  IF upgrade_audit_count <> membership_count
    OR upgrade_history_count <> membership_count
  THEN
    RAISE EXCEPTION
      'Expected one v2 audit/history row per membership; audit %, history %, memberships %',
      upgrade_audit_count,
      upgrade_history_count,
      membership_count;
  END IF;

  IF EXISTS (
    SELECT resource_id
    FROM platform.audit_events
    WHERE action = 'rbac.bundle.upgrade'
    GROUP BY resource_id
    HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT membership_id
    FROM platform.membership_role_history
    WHERE reason = 'P2D immutable RBAC bundle upgrade'
    GROUP BY membership_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'A membership received duplicate P2D upgrade evidence';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 1
      AND status = 'published'
  ) <> 5 OR (
    SELECT count(*)
    FROM platform.role_bundle_versions
    WHERE version = 2
      AND status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'Published v1 history and all five v2 bundles are required';
  END IF;
END
$$;

-- Fixed state inventories are part of the product contract.
DO $$
DECLARE
  actual_states TEXT[];
BEGIN
  SELECT array_agg(enumlabel::TEXT ORDER BY enumsortorder)
  INTO actual_states
  FROM pg_enum
  WHERE enumtypid = 'platform.visa_status'::regtype;

  IF actual_states IS DISTINCT FROM ARRAY[
    'not_required',
    'not_started',
    'docs',
    'appointment',
    'submitted',
    'approved',
    'rejected',
    'closed'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Unexpected visa states: %', actual_states;
  END IF;
END
$$;

-- Add the second student, two Sales owners, an unrelated Curator, an active
-- Finance user, and the minimum organization-B subjects. Existing P2C users
-- provide Student A plus the assigned and replacement Curators.
\set student_b_user_id '42000000-0000-4000-8000-000000000001'
\set sales_a_user_id '42000000-0000-4000-8000-000000000002'
\set sales_b_user_id '42000000-0000-4000-8000-000000000003'
\set curator_unrelated_user_id '42000000-0000-4000-8000-000000000004'
\set finance_active_user_id '42000000-0000-4000-8000-000000000005'
\set org_b_student_user_id '42000000-0000-4000-8000-000000000006'
\set org_b_sales_user_id '42000000-0000-4000-8000-000000000007'
\set org_b_curator_user_id '42000000-0000-4000-8000-000000000008'

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    :'student_b_user_id',
    'p2d-student-b@example.invalid',
    '{"display_name":"P2D Student B"}'::JSONB
  ),
  (
    :'sales_a_user_id',
    'p2d-sales-a@example.invalid',
    '{"display_name":"P2D Sales A"}'::JSONB
  ),
  (
    :'sales_b_user_id',
    'p2d-sales-b@example.invalid',
    '{"display_name":"P2D Sales B"}'::JSONB
  ),
  (
    :'curator_unrelated_user_id',
    'p2d-curator-unrelated@example.invalid',
    '{"display_name":"P2D Curator Unrelated"}'::JSONB
  ),
  (
    :'finance_active_user_id',
    'p2d-finance-active@example.invalid',
    '{"display_name":"P2D Finance Active"}'::JSONB
  ),
  (
    :'org_b_student_user_id',
    'p2d-org-b-student@example.invalid',
    '{"display_name":"P2D Org B Student"}'::JSONB
  ),
  (
    :'org_b_sales_user_id',
    'p2d-org-b-sales@example.invalid',
    '{"display_name":"P2D Org B Sales"}'::JSONB
  ),
  (
    :'org_b_curator_user_id',
    'p2d-org-b-curator@example.invalid',
    '{"display_name":"P2D Org B Curator"}'::JSONB
  );

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS admin_a_membership_id,
  profile.id AS admin_a_profile_id,
  profile.access_version AS admin_a_access_version
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

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_a_id',
    :'student_b_user_id',
    'P2D Student B',
    'student',
    'P2D synthetic admissions fixture',
    '42000000-0000-4000-8000-000000000101'
  ) IS NOT NULL,
  'Student B provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_a_id',
    :'sales_a_user_id',
    'P2D Sales A',
    'sales',
    'P2D synthetic admissions fixture',
    '42000000-0000-4000-8000-000000000102'
  ) IS NOT NULL,
  'Sales A provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_a_id',
    :'sales_b_user_id',
    'P2D Sales B',
    'sales',
    'P2D synthetic admissions fixture',
    '42000000-0000-4000-8000-000000000103'
  ) IS NOT NULL,
  'Sales B provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_a_id',
    :'curator_unrelated_user_id',
    'P2D Curator Unrelated',
    'curator',
    'P2D synthetic admissions fixture',
    '42000000-0000-4000-8000-000000000104'
  ) IS NOT NULL,
  'unrelated Curator provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_a_id',
    :'finance_active_user_id',
    'P2D Finance Active',
    'finance',
    'P2D synthetic admissions fixture',
    '42000000-0000-4000-8000-000000000105'
  ) IS NOT NULL,
  'active Finance provisioning failed'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_b_id',
    :'org_b_student_user_id',
    'P2D Org B Student',
    'student',
    'P2D synthetic cross-organization fixture',
    '42000000-0000-4000-8000-000000000106'
  ) IS NOT NULL,
  'organization-B Student provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_b_id',
    :'org_b_sales_user_id',
    'P2D Org B Sales',
    'sales',
    'P2D synthetic cross-organization fixture',
    '42000000-0000-4000-8000-000000000107'
  ) IS NOT NULL,
  'organization-B Sales provisioning failed'
);
SELECT pg_temp.assert_true(
  platform.provision_member(
    :'org_b_id',
    :'org_b_curator_user_id',
    'P2D Org B Curator',
    'curator',
    'P2D synthetic cross-organization fixture',
    '42000000-0000-4000-8000-000000000108'
  ) IS NOT NULL,
  'organization-B Curator provisioning failed'
);
RESET ROLE;

-- Resolve every fixture from its auth subject; no generated identifier is
-- assumed or copied between test files.
SELECT membership.id AS student_a_membership_id,
       profile.id AS student_a_profile_id,
       profile.access_version AS student_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset
SELECT membership.id AS student_b_membership_id,
       profile.id AS student_b_profile_id,
       profile.access_version AS student_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'student_b_user_id'
\gset
SELECT membership.id AS sales_a_membership_id,
       profile.id AS sales_a_profile_id,
       profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'sales_a_user_id'
\gset
SELECT membership.id AS sales_b_membership_id,
       profile.id AS sales_b_profile_id,
       profile.access_version AS sales_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'sales_b_user_id'
\gset
SELECT membership.id AS curator_one_membership_id,
       profile.id AS curator_one_profile_id,
       profile.access_version AS curator_one_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset
SELECT membership.id AS curator_two_membership_id,
       profile.id AS curator_two_profile_id,
       profile.access_version AS curator_two_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset
SELECT membership.id AS curator_unrelated_membership_id,
       profile.id AS curator_unrelated_profile_id,
       profile.access_version AS curator_unrelated_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'curator_unrelated_user_id'
\gset
SELECT membership.id AS finance_active_membership_id,
       profile.access_version AS finance_active_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'finance_active_user_id'
\gset
SELECT membership.id AS org_b_student_membership_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'org_b_student_user_id'
\gset
SELECT membership.id AS org_b_sales_membership_id,
       profile.access_version AS org_b_sales_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'org_b_sales_user_id'
\gset
SELECT membership.id AS org_b_curator_membership_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'org_b_curator_user_id'
\gset

SELECT jsonb_build_object(
  'role', 'service_role'
)::TEXT AS service_claims
\gset

-- Contract-confirmed ingestion is service-only and idempotent.
SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.create_pending_student_case(
  :'org_a_id',
  :'student_a_membership_id',
  :'sales_a_membership_id',
  'synthetic:amocrm:lead:a',
  'synthetic:contract:a',
  '2026-07-29T08:00:00Z',
  'Synthetic Student A',
  'Country A',
  'Degree A',
  'Program A',
  '2027-A',
  'EN',
  'self-funded',
  'contract_confirmed',
  'Admin must assign Curator',
  '42000000-0000-4000-8000-000000000201'
)::TEXT AS case_a_first
\gset
SELECT platform.create_pending_student_case(
  :'org_a_id',
  :'student_a_membership_id',
  :'sales_a_membership_id',
  'synthetic:amocrm:lead:a',
  'synthetic:contract:a',
  '2026-07-29T08:00:00Z',
  'Synthetic Student A',
  'Country A',
  'Degree A',
  'Program A',
  '2027-A',
  'EN',
  'self-funded',
  'contract_confirmed',
  'Admin must assign Curator',
  '42000000-0000-4000-8000-000000000201'
)::TEXT AS case_a_replay
\gset
SELECT platform.create_pending_student_case(
  :'org_a_id',
  :'student_b_membership_id',
  :'sales_b_membership_id',
  'synthetic:amocrm:lead:b',
  'synthetic:contract:b',
  '2026-07-29T08:05:00Z',
  'Synthetic Student B',
  'Country B',
  'Degree B',
  'Program B',
  '2027-B',
  'RU',
  'sponsored',
  'contract_confirmed',
  'Admin must assign Curator',
  '42000000-0000-4000-8000-000000000202'
)::TEXT AS case_b_first
\gset
SELECT platform.create_pending_student_case(
  :'org_b_id',
  :'org_b_student_membership_id',
  :'org_b_sales_membership_id',
  'synthetic:amocrm:lead:org-b',
  'synthetic:contract:org-b',
  '2026-07-29T08:10:00Z',
  'Synthetic Org B Student',
  'Country B2',
  'Degree B2',
  NULL,
  NULL,
  'EN',
  NULL,
  'contract_confirmed',
  'Admin must assign Curator',
  '42000000-0000-4000-8000-000000000203'
)::TEXT AS org_b_case_first
\gset

\set ON_ERROR_STOP off
SELECT platform.create_pending_student_case(
  :'org_a_id',
  :'student_a_membership_id',
  :'sales_a_membership_id',
  'synthetic:amocrm:lead:a',
  'synthetic:contract:a',
  '2026-07-29T08:00:00Z',
  'Changed replay payload',
  'Country A',
  'Degree A',
  'Program A',
  '2027-A',
  'EN',
  'self-funded',
  'contract_confirmed',
  'Admin must assign Curator',
  '42000000-0000-4000-8000-000000000201'
);
\set case_replay_mismatch_state :SQLSTATE
SELECT platform.create_pending_student_case(
  :'org_a_id',
  :'student_a_membership_id',
  :'sales_a_membership_id',
  'synthetic:amocrm:lead:a',
  'synthetic:contract:duplicate',
  '2026-07-29T08:20:00Z',
  'Synthetic Duplicate',
  'Country A',
  'Degree A',
  NULL,
  NULL,
  'EN',
  NULL,
  'contract_confirmed',
  NULL,
  '42000000-0000-4000-8000-000000000204'
);
\set duplicate_source_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'case_a_first'::JSONB ->> 'student_case_id')::UUID AS case_a_id,
  (:'case_a_first'::JSONB ->> 'scope_id')::UUID AS case_a_scope_v1_id,
  (:'case_b_first'::JSONB ->> 'student_case_id')::UUID AS case_b_id,
  (:'org_b_case_first'::JSONB ->> 'student_case_id')::UUID AS org_b_case_id
\gset

SELECT pg_temp.assert_true(
  :'case_a_first' = :'case_a_replay',
  'case creation replay changed its result'
);
SELECT pg_temp.assert_true(
  :'case_replay_mismatch_state' <> '00000'
    AND :'duplicate_source_state' <> '00000',
  'case replay mismatch or duplicate source was accepted'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases
   WHERE organization_id = :'org_a_id') = 2
    AND
  (SELECT count(*) FROM platform.student_cases
   WHERE organization_id = :'org_b_id') = 1
    AND
  (SELECT count(*) FROM platform.audit_events
   WHERE request_id = '42000000-0000-4000-8000-000000000201') = 1
    AND
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case') = 2,
  'case replay/mismatch left non-atomic rows'
);

-- Fresh pending-owner claims are created only after ingestion, because case
-- scope assignment intentionally invalidates the Sales token held beforehand.
SELECT profile.access_version AS sales_a_pending_version,
       jsonb_build_object(
         'sub', :'sales_a_user_id',
         'role', 'authenticated',
         'platform_role', 'sales',
         'platform_access_version', profile.access_version
       )::TEXT AS sales_a_pending_claims
FROM platform.profiles AS profile
WHERE profile.id = :'sales_a_profile_id'
\gset
SELECT profile.access_version AS sales_b_pending_version,
       jsonb_build_object(
         'sub', :'sales_b_user_id',
         'role', 'authenticated',
         'platform_role', 'sales',
         'platform_access_version', profile.access_version
       )::TEXT AS sales_b_pending_claims
FROM platform.profiles AS profile
WHERE profile.id = :'sales_b_profile_id'
\gset
SELECT jsonb_build_object(
  'sub', :'finance_active_user_id',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_active_access_version'::BIGINT
)::TEXT AS finance_active_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_pending_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_one_access_version'::BIGINT
)::TEXT AS curator_one_preassignment_claims
\gset
SELECT jsonb_build_object(
  'sub', :'curator_unrelated_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_unrelated_access_version'::BIGINT
)::TEXT AS curator_unrelated_claims
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT count(*) AS admin_pending_rows
FROM platform.student_cases
WHERE organization_id = :'org_a_id';
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 2,
  'Admin A did not see exactly the two organization-A cases'
);
RESET ROLE;

SET request.jwt.claims TO :'sales_a_pending_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_a_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_b_id'
    ),
  'responsible Sales A pending scope leaked or omitted a case'
);
\set ON_ERROR_STOP off
UPDATE platform.student_cases
SET next_action = 'Forbidden direct write'
WHERE id = :'case_a_id';
\set authenticated_direct_update_state :SQLSTATE
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_one_membership_id',
  'Forbidden Sales assignment',
  '42000000-0000-4000-8000-000000000205'
);
\set sales_assignment_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_b_pending_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_b_id'
    ),
  'unrelated Sales B did not remain isolated to case B'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_one_preassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'unassigned Curator saw a pending case'
);
RESET ROLE;

SET request.jwt.claims TO :'finance_active_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'Finance saw admissions base rows'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_pending_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0
    AND (SELECT count(*) FROM platform.student_portal_cases()) = 0,
  'pending Student received base or Portal access'
);
RESET ROLE;

SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.student_cases;
\set service_direct_read_state :SQLSTATE
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_one_membership_id',
  'Forbidden service assignment',
  '42000000-0000-4000-8000-000000000206'
);
\set service_assignment_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET ROLE anon;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.student_cases;
\set anon_direct_read_state :SQLSTATE
SELECT platform.student_portal_cases();
\set anon_portal_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'authenticated_direct_update_state' = '42501'
    AND :'sales_assignment_state' <> '00000'
    AND :'service_direct_read_state' = '42501'
    AND :'service_assignment_state' = '42501'
    AND :'anon_direct_read_state' = '42501'
    AND :'anon_portal_state' = '42501',
  'direct table/RPC privilege boundary did not fail closed'
);

-- Only Admin may perform initial assignment/reassignment. The assignment is a
-- handoff: pending -> active, Portal activation, and scope v1 -> v2.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'sales_a_membership_id',
  'Wrong target role',
  '42000000-0000-4000-8000-000000000207'
);
\set assignment_wrong_role_state :SQLSTATE
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'org_b_curator_membership_id',
  'Cross-organization target',
  '42000000-0000-4000-8000-000000000208'
);
\set assignment_cross_org_target_state :SQLSTATE
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_one_membership_id',
  '',
  '42000000-0000-4000-8000-000000000209'
);
\set assignment_blank_reason_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_one_membership_id',
  'Initial Curator assignment for Student A',
  '42000000-0000-4000-8000-000000000210'
)::TEXT AS assignment_a_first
\gset
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_one_membership_id',
  'Initial Curator assignment for Student A',
  '42000000-0000-4000-8000-000000000210'
)::TEXT AS assignment_a_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_two_membership_id',
  'Initial Curator assignment for Student A',
  '42000000-0000-4000-8000-000000000210'
);
\set assignment_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_b_id',
  :'curator_unrelated_membership_id',
  'Initial Curator assignment for Student B',
  '42000000-0000-4000-8000-000000000211'
)::TEXT AS assignment_b_first
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.assign_student_case_curator(
  :'org_b_id',
  :'org_b_case_id',
  :'org_b_curator_membership_id',
  'Cross-organization actor denial',
  '42000000-0000-4000-8000-000000000212'
);
\set assignment_cross_org_actor_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'assignment_wrong_role_state' <> '00000'
    AND :'assignment_cross_org_target_state' <> '00000'
    AND :'assignment_blank_reason_state' <> '00000'
    AND :'assignment_replay_mismatch_state' <> '00000'
    AND :'assignment_cross_org_actor_state' <> '00000',
  'assignment reason/target/replay/cross-organization denial failed'
);
SELECT pg_temp.assert_true(
  :'assignment_a_first' = :'assignment_a_replay',
  'assignment replay changed its result'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_case_assignment_events
   WHERE student_case_id = :'case_a_id') = 1
    AND
  (SELECT count(*) FROM platform.student_case_lifecycle_events
   WHERE student_case_id = :'case_a_id'
     AND event_type = 'activated') = 1
    AND
  (SELECT count(*) FROM platform.audit_events
   WHERE request_id = '42000000-0000-4000-8000-000000000210') = 1
    AND
  (SELECT state = 'active'
      AND current_scope_version = 2
      AND current_curator_membership_id = :'curator_one_membership_id'
      AND handoff_at IS NOT NULL
      AND portal_activated_at IS NOT NULL
   FROM platform.student_cases
   WHERE id = :'case_a_id'),
  'initial assignment was not atomic or did not activate the case'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case'
     AND scope_key = :'case_a_id'
     AND is_active) = 1
    AND
  (SELECT NOT is_active
   FROM platform.record_scopes
   WHERE id = :'case_a_scope_v1_id')
    AND
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case'
     AND scope_key = :'case_a_id') = 2,
  'case A scope v1 -> v2 rotation failed'
);

-- Tokens held before handoff are stale immediately for every affected subject.
SET request.jwt.claims TO :'sales_a_pending_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0
    AND (
      SELECT count(*)
      FROM platform.staff_student_case_page(101, NULL, NULL, NULL, NULL, NULL)
      WHERE access_mode = 'sales_summary'
    ) = 0,
  'held Sales token survived handoff'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_pending_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_cases()) = 0,
  'held Student token survived Portal activation'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_one_preassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'held Curator token survived initial assignment'
);
RESET ROLE;

SELECT profile.access_version AS sales_a_handoff_version,
       jsonb_build_object(
         'sub', :'sales_a_user_id',
         'role', 'authenticated',
         'platform_role', 'sales',
         'platform_access_version', profile.access_version
       )::TEXT AS sales_a_handoff_claims
FROM platform.profiles AS profile
WHERE profile.id = :'sales_a_profile_id'
\gset
SELECT profile.access_version AS student_a_handoff_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000005',
         'role', 'authenticated',
         'platform_role', 'student',
         'platform_access_version', profile.access_version
       )::TEXT AS student_a_handoff_claims
FROM platform.profiles AS profile
WHERE profile.id = :'student_a_profile_id'
\gset
SELECT profile.access_version AS curator_one_handoff_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000003',
         'role', 'authenticated',
         'platform_role', 'curator',
         'platform_access_version', profile.access_version
       )::TEXT AS curator_one_handoff_claims
FROM platform.profiles AS profile
WHERE profile.id = :'curator_one_profile_id'
\gset
SELECT profile.access_version AS student_b_handoff_version,
       jsonb_build_object(
         'sub', :'student_b_user_id',
         'role', 'authenticated',
         'platform_role', 'student',
         'platform_access_version', profile.access_version
       )::TEXT AS student_b_handoff_claims
FROM platform.profiles AS profile
WHERE profile.id = :'student_b_profile_id'
\gset
SELECT profile.access_version AS curator_b_handoff_version,
       jsonb_build_object(
         'sub', :'curator_unrelated_user_id',
         'role', 'authenticated',
         'platform_role', 'curator',
         'platform_access_version', profile.access_version
       )::TEXT AS curator_b_handoff_claims
FROM platform.profiles AS profile
WHERE profile.id = :'curator_unrelated_profile_id'
\gset

SET request.jwt.claims TO :'sales_a_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0
    AND (
      SELECT count(*)
      FROM platform.staff_student_case_page(101, NULL, NULL, NULL, NULL, NULL)
      WHERE access_mode = 'sales_summary'
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.staff_student_case_page(
        101, NULL, NULL, NULL, NULL, :'case_a_id'
      )
      WHERE access_mode = 'sales_summary'
        AND program_direction IS NULL
        AND responsible_sales_display_name IS NULL
        AND overdue_task_count IS NULL
    ),
  'post-handoff Sales did not receive only its safe summary'
);
RESET ROLE;

SET request.jwt.claims TO :'student_a_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0
    AND (SELECT count(*) FROM platform.student_portal_cases()) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_cases()
      WHERE case_id = :'case_a_id'
    ),
  'activated Student A did not receive only its Portal case'
);
SELECT array_agg(key ORDER BY key)::TEXT AS portal_case_keys
FROM (
  SELECT jsonb_object_keys(to_jsonb(portal_row)) AS key
  FROM (
    SELECT *
    FROM platform.student_portal_cases()
    WHERE case_id = :'case_a_id'
  ) AS portal_row
) AS keys
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'portal_case_keys' =
    '{case_id,case_state,intake,next_action,operational_stage,portal_activated_at,program_direction,route_approval_status,student_display_name,target_country,target_degree}',
  'Student Portal case projection columns widened'
);

SET request.jwt.claims TO :'curator_one_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_a_id'
    ),
  'assigned Curator A did not receive full case A'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_b_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_b_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_a_id'
    ),
  'assigned Curator B crossed the two-student boundary'
);
RESET ROLE;

SET request.jwt.claims TO :'student_b_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_cases()) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_cases()
      WHERE case_id = :'case_b_id'
    ),
  'Student B crossed the Student A Portal boundary'
);
RESET ROLE;

-- Reassignment rotates v2 -> v3, invalidates old/new Curator and Student
-- tokens, and leaves exactly one active scope that cannot be reactivated later.
SELECT profile.access_version AS curator_two_preassign_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000002',
         'role', 'authenticated',
         'platform_role', 'curator',
         'platform_access_version', profile.access_version
       )::TEXT AS curator_two_preassign_claims
FROM platform.profiles AS profile
WHERE profile.id = :'curator_two_profile_id'
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'org_a_id',
  :'case_a_id',
  :'curator_two_membership_id',
  'Student A Curator reassignment',
  '42000000-0000-4000-8000-000000000213'
)::TEXT AS reassignment_a_first
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_one_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'old Curator held token survived reassignment'
);
RESET ROLE;
SET request.jwt.claims TO :'curator_two_preassign_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'new Curator held token survived reassignment'
);
RESET ROLE;
SET request.jwt.claims TO :'student_a_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_cases()) = 0,
  'Student held token survived reassignment scope rotation'
);
RESET ROLE;

SELECT profile.access_version AS curator_one_after_reassign_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000003',
         'role', 'authenticated',
         'platform_role', 'curator',
         'platform_access_version', profile.access_version
       )::TEXT AS curator_one_after_reassign_claims
FROM platform.profiles AS profile
WHERE profile.id = :'curator_one_profile_id'
\gset
SELECT profile.access_version AS curator_two_assigned_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000002',
         'role', 'authenticated',
         'platform_role', 'curator',
         'platform_access_version', profile.access_version
       )::TEXT AS curator_two_assigned_claims
FROM platform.profiles AS profile
WHERE profile.id = :'curator_two_profile_id'
\gset
SELECT profile.access_version AS student_a_reassigned_version,
       jsonb_build_object(
         'sub', '10000000-0000-4000-8000-000000000005',
         'role', 'authenticated',
         'platform_role', 'student',
         'platform_access_version', profile.access_version
       )::TEXT AS student_a_reassigned_claims
FROM platform.profiles AS profile
WHERE profile.id = :'student_a_profile_id'
\gset

SET request.jwt.claims TO :'curator_one_after_reassign_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 0,
  'old Curator retained case A after refreshed reassignment token'
);
RESET ROLE;
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'case_a_id'
    ),
  'replacement Curator did not receive case A'
);
RESET ROLE;
SET request.jwt.claims TO :'student_a_reassigned_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_cases()) = 1
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_cases()
      WHERE case_id = :'case_a_id'
    ),
  'Student A did not regain Portal access after token refresh'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  (SELECT current_scope_version = 3
      AND current_curator_membership_id = :'curator_two_membership_id'
   FROM platform.student_cases
   WHERE id = :'case_a_id')
    AND
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case'
     AND scope_key = :'case_a_id') = 3
    AND
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case'
     AND scope_key = :'case_a_id'
     AND is_active) = 1
    AND
  (SELECT count(*) FROM platform.student_case_assignment_events
   WHERE student_case_id = :'case_a_id') = 2,
  'case A scope v2 -> v3 rotation or reassignment evidence failed'
);

\set ON_ERROR_STOP off
UPDATE platform.record_scopes
SET is_active = TRUE
WHERE id = :'case_a_scope_v1_id';
\set scope_reactivation_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'scope_reactivation_state' = '55000'
    AND
  (SELECT count(*) FROM platform.record_scopes
   WHERE organization_id = :'org_a_id'
     AND scope_kind = 'student_case'
     AND scope_key = :'case_a_id'
     AND is_active) = 1,
  'retired case scope was reactivated'
);

-- Curator/Admin lifecycle changes are exact and reasoned. No other transition
-- is accepted, and replay cannot add duplicate lifecycle/audit evidence.
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'closed',
  '',
  '42000000-0000-4000-8000-000000000214'
);
\set close_blank_reason_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'closed',
  'Student A operational case completed',
  '42000000-0000-4000-8000-000000000215'
)::TEXT AS close_a_first
\gset
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'closed',
  'Student A operational case completed',
  '42000000-0000-4000-8000-000000000215'
)::TEXT AS close_a_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'active',
  'Mismatched replay',
  '42000000-0000-4000-8000-000000000215'
);
\set close_replay_mismatch_state :SQLSTATE
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'closed',
  'Invalid closed to closed transition',
  '42000000-0000-4000-8000-000000000216'
);
\set close_same_state_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'active',
  'Student A case reopened for additional work',
  '42000000-0000-4000-8000-000000000217'
)::TEXT AS reopen_a_first
\gset
\set ON_ERROR_STOP off
SELECT platform.change_student_case_state(
  :'org_b_id',
  :'org_b_case_id',
  'closed',
  'Cross-organization denial',
  '42000000-0000-4000-8000-000000000218'
);
\set lifecycle_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_handoff_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_student_case_state(
  :'org_a_id',
  :'case_a_id',
  'closed',
  'Forbidden Sales lifecycle mutation',
  '42000000-0000-4000-8000-000000000219'
);
\set lifecycle_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'close_a_first' = :'close_a_replay'
    AND :'close_blank_reason_state' <> '00000'
    AND :'close_replay_mismatch_state' <> '00000'
    AND :'close_same_state_state' <> '00000'
    AND :'lifecycle_cross_org_state' <> '00000'
    AND :'lifecycle_sales_state' <> '00000',
  'close/reopen reason, transition, replay, role or tenant boundary failed'
);
SELECT pg_temp.assert_true(
  (SELECT state = 'active' AND closed_at IS NULL
   FROM platform.student_cases WHERE id = :'case_a_id')
    AND
  (SELECT count(*) FROM platform.student_case_lifecycle_events
   WHERE student_case_id = :'case_a_id') = 3
    AND
  (SELECT count(*) FROM platform.student_case_lifecycle_events
   WHERE student_case_id = :'case_a_id'
     AND event_type = 'closed') = 1
    AND
  (SELECT count(*) FROM platform.student_case_lifecycle_events
   WHERE student_case_id = :'case_a_id'
     AND event_type = 'reopened') = 1,
  'close/reopen exact transitions or evidence counts failed'
);

-- Route changes and updates follow the case owner, never an unrelated role or
-- object. Visible and internal updates are both durable but project differently.
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT platform.set_student_case_route(
  :'org_a_id',
  :'case_a_id',
  'Country A Updated',
  'Degree A Updated',
  'Program A Updated',
  '2027-A2',
  'EN',
  'self-funded',
  'approved',
  'applications',
  'Submit first application',
  'Approved route after manual review',
  '42000000-0000-4000-8000-000000000220'
) IS NOT NULL AS route_a_updated
\gset
SELECT platform.append_student_case_update(
  :'org_a_id',
  :'case_a_id',
  'Student-visible milestone',
  'operator',
  TRUE,
  '2026-07-29T09:00:00Z',
  '42000000-0000-4000-8000-000000000221'
)::TEXT AS visible_update_first
\gset
SELECT platform.append_student_case_update(
  :'org_a_id',
  :'case_a_id',
  'Internal-only operational note',
  'operator',
  FALSE,
  '2026-07-29T09:01:00Z',
  '42000000-0000-4000-8000-000000000222'
)::TEXT AS private_update_first
\gset
\set ON_ERROR_STOP off
SELECT platform.set_student_case_route(
  :'org_a_id',
  :'case_b_id',
  'Forbidden',
  'Forbidden',
  NULL,
  NULL,
  NULL,
  NULL,
  'draft',
  'forbidden',
  NULL,
  'Cross-student route denial',
  '42000000-0000-4000-8000-000000000223'
);
\set route_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_handoff_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.set_student_case_route(
  :'org_a_id',
  :'case_a_id',
  'Forbidden',
  'Forbidden',
  NULL,
  NULL,
  NULL,
  NULL,
  'draft',
  'forbidden',
  NULL,
  'Post-handoff Sales denial',
  '42000000-0000-4000-8000-000000000224'
);
\set route_post_handoff_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_active_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.append_student_case_update(
  :'org_a_id',
  :'case_a_id',
  'Forbidden Finance update',
  'operator',
  FALSE,
  '2026-07-29T09:02:00Z',
  '42000000-0000-4000-8000-000000000225'
);
\set update_finance_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'route_a_updated' = 't'
    AND :'route_cross_student_state' <> '00000'
    AND :'route_post_handoff_sales_state' <> '00000'
    AND :'update_finance_state' <> '00000'
    AND
  (SELECT target_country = 'Country A Updated'
      AND route_approval_status = 'approved'
      AND operational_stage = 'applications'
   FROM platform.student_cases
   WHERE id = :'case_a_id')
    AND
  (SELECT count(*) FROM platform.student_case_updates
   WHERE student_case_id = :'case_a_id') = 2,
  'route/update owner or persistence contract failed'
);

-- Multiple parallel applications are first-class. External statuses require
-- evidence, and failed transitions cannot leave parent or event rows.
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Evidence Missing University',
  'Evidence Missing Program',
  'submitted',
  NULL,
  NULL,
  '42000000-0000-4000-8000-000000000226'
);
\set application_create_evidence_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Synthetic University One',
  'Synthetic Program One',
  'preparation',
  NULL,
  'Initial preparation',
  '42000000-0000-4000-8000-000000000227'
)::TEXT AS application_one_first
\gset
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Synthetic University One',
  'Synthetic Program One',
  'preparation',
  NULL,
  'Initial preparation',
  '42000000-0000-4000-8000-000000000227'
)::TEXT AS application_one_replay
\gset
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Synthetic University Two',
  'Synthetic Program Two',
  'submitted',
  'synthetic:evidence:application-two',
  'Submitted with external evidence',
  '42000000-0000-4000-8000-000000000228'
)::TEXT AS application_two_first
\gset
\set ON_ERROR_STOP off
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_a_id',
  'Changed replay university',
  'Synthetic Program One',
  'preparation',
  NULL,
  'Initial preparation',
  '42000000-0000-4000-8000-000000000227'
);
\set application_create_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'application_one_first'::JSONB ->> 'university_application_id')::UUID
    AS application_one_id,
  (:'application_two_first'::JSONB ->> 'university_application_id')::UUID
    AS application_two_id
\gset

SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_university_application(
  :'org_a_id',
  :'application_one_id',
  'submitted',
  NULL,
  'Missing evidence probe',
  '42000000-0000-4000-8000-000000000229'
);
\set application_change_evidence_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.change_university_application(
  :'org_a_id',
  :'application_one_id',
  'submitted',
  'synthetic:evidence:application-one',
  'Submitted after evidence review',
  '42000000-0000-4000-8000-000000000230'
)::TEXT AS application_one_submitted
\gset
\set ON_ERROR_STOP off
SELECT platform.create_university_application(
  :'org_a_id',
  :'case_b_id',
  'Forbidden Cross Student',
  'Forbidden Program',
  'preparation',
  NULL,
  NULL,
  '42000000-0000-4000-8000-000000000231'
);
\set application_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'application_one_first' = :'application_one_replay'
    AND :'application_create_evidence_state' <> '00000'
    AND :'application_create_mismatch_state' <> '00000'
    AND :'application_change_evidence_state' <> '00000'
    AND :'application_cross_student_state' <> '00000'
    AND
  (SELECT count(*) FROM platform.university_applications
   WHERE student_case_id = :'case_a_id') = 2
    AND
  (SELECT count(*) FROM platform.university_application_events
   WHERE student_case_id = :'case_a_id') = 3
    AND
  (SELECT count(*) FROM platform.university_applications
   WHERE student_case_id = :'case_a_id'
     AND status = 'submitted'
     AND latest_evidence_reference IS NOT NULL) = 2,
  'multi-application, evidence, replay or isolation contract failed'
);

-- Visa is Curator-owned. Only external approval/rejection requires evidence;
-- Sales cannot mutate it and each case has at most one visa record.
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT platform.create_visa_case(
  :'org_a_id',
  :'case_a_id',
  'not_started',
  NULL,
  'Visa workflow initialized',
  '42000000-0000-4000-8000-000000000232'
)::TEXT AS visa_a_first
\gset
SELECT platform.create_visa_case(
  :'org_a_id',
  :'case_a_id',
  'not_started',
  NULL,
  'Visa workflow initialized',
  '42000000-0000-4000-8000-000000000232'
)::TEXT AS visa_a_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.create_visa_case(
  :'org_a_id',
  :'case_a_id',
  'docs',
  NULL,
  'Duplicate visa probe',
  '42000000-0000-4000-8000-000000000233'
);
\set visa_duplicate_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT (:'visa_a_first'::JSONB ->> 'visa_case_id')::UUID AS visa_a_id
\gset

SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_visa_case(
  :'org_a_id',
  :'visa_a_id',
  'approved',
  NULL,
  'Missing evidence probe',
  '42000000-0000-4000-8000-000000000234'
);
\set visa_approval_evidence_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.change_visa_case(
  :'org_a_id',
  :'visa_a_id',
  'approved',
  'synthetic:evidence:visa-approved',
  'External decision evidence recorded',
  '42000000-0000-4000-8000-000000000235'
)::TEXT AS visa_a_approved
\gset
RESET ROLE;

SET request.jwt.claims TO :'sales_a_handoff_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_visa_case(
  :'org_a_id',
  :'visa_a_id',
  'docs',
  NULL,
  'Forbidden Sales visa change',
  '42000000-0000-4000-8000-000000000236'
);
\set visa_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'visa_a_first' = :'visa_a_replay'
    AND :'visa_duplicate_state' <> '00000'
    AND :'visa_approval_evidence_state' <> '00000'
    AND :'visa_sales_state' <> '00000'
    AND
  (SELECT count(*) FROM platform.visa_cases
   WHERE student_case_id = :'case_a_id') = 1
    AND
  (SELECT status = 'approved'
      AND latest_evidence_reference = 'synthetic:evidence:visa-approved'
   FROM platform.visa_cases
   WHERE id = :'visa_a_id')
    AND
  (SELECT count(*) FROM platform.visa_case_events
   WHERE visa_case_id = :'visa_a_id') = 2,
  'visa owner, evidence, uniqueness or replay contract failed'
);

-- Tasks are owner-scoped. A non-Admin owner may assign only to self; even an
-- Admin may not target Finance/Student. Student visibility is explicit.
SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'document',
  'Upload synthetic document',
  :'curator_two_membership_id',
  'high',
  '2026-08-10T10:00:00Z',
  'open',
  TRUE,
  '42000000-0000-4000-8000-000000000237'
)::TEXT AS visible_task_first
\gset
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'internal_review',
  'Internal synthetic review',
  :'curator_two_membership_id',
  'normal',
  '2026-08-11T10:00:00Z',
  'open',
  FALSE,
  '42000000-0000-4000-8000-000000000238'
)::TEXT AS private_task_first
\gset
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'document',
  'Upload synthetic document',
  :'curator_two_membership_id',
  'high',
  '2026-08-10T10:00:00Z',
  'open',
  TRUE,
  '42000000-0000-4000-8000-000000000237'
)::TEXT AS visible_task_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'document',
  'Changed replay title',
  :'curator_two_membership_id',
  'high',
  '2026-08-10T10:00:00Z',
  'open',
  TRUE,
  '42000000-0000-4000-8000-000000000237'
);
\set task_create_mismatch_state :SQLSTATE
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'forbidden_assignment',
  'Forbidden assignment',
  :'curator_one_membership_id',
  'normal',
  NULL,
  'open',
  FALSE,
  '42000000-0000-4000-8000-000000000239'
);
\set task_non_admin_assignment_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'visible_task_first'::JSONB ->> 'case_task_id')::UUID AS visible_task_id,
  (:'private_task_first'::JSONB ->> 'case_task_id')::UUID AS private_task_id
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_case_task(
  :'org_a_id',
  :'case_a_id',
  'forbidden_student_target',
  'Forbidden Student target',
  :'student_a_membership_id',
  'normal',
  NULL,
  'open',
  TRUE,
  '42000000-0000-4000-8000-000000000240'
);
\set task_student_target_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT platform.change_case_task(
  :'org_a_id',
  :'visible_task_id',
  'done',
  :'curator_two_membership_id',
  'high',
  '2026-08-10T10:00:00Z',
  TRUE,
  '42000000-0000-4000-8000-000000000241'
)::TEXT AS visible_task_done
\gset
\set ON_ERROR_STOP off
SELECT platform.change_case_task(
  :'org_a_id',
  :'private_task_id',
  'in_progress',
  :'curator_one_membership_id',
  'normal',
  '2026-08-11T10:00:00Z',
  FALSE,
  '42000000-0000-4000-8000-000000000242'
);
\set task_change_assignment_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'visible_task_first' = :'visible_task_replay'
    AND :'task_create_mismatch_state' <> '00000'
    AND :'task_non_admin_assignment_state' <> '00000'
    AND :'task_student_target_state' <> '00000'
    AND :'task_change_assignment_state' <> '00000'
    AND
  (SELECT count(*) FROM platform.case_tasks
   WHERE student_case_id = :'case_a_id') = 2
    AND
  (SELECT count(*) FROM platform.case_task_events
   WHERE student_case_id = :'case_a_id') = 3
    AND
  (SELECT status = 'done'
   FROM platform.case_tasks WHERE id = :'visible_task_id'),
  'task owner/target/replay/atomic evidence contract failed'
);

-- Activated Portal projections include only Student A's explicitly safe and
-- visible children. Student B and every staff role remain object-scoped.
SET request.jwt.claims TO :'student_a_reassigned_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_applications()) = 2
    AND (SELECT count(*) FROM platform.student_portal_visa_cases()) = 1
    AND (SELECT count(*) FROM platform.student_portal_tasks()) = 1
    AND (SELECT count(*) FROM platform.student_portal_updates()) = 1,
  'Student A Portal child visibility did not filter private rows'
);
SELECT array_agg(key ORDER BY key)::TEXT AS portal_application_keys
FROM (
  SELECT jsonb_object_keys(to_jsonb(portal_row)) AS key
  FROM (SELECT * FROM platform.student_portal_applications() LIMIT 1) AS portal_row
) AS keys
\gset
SELECT array_agg(key ORDER BY key)::TEXT AS portal_visa_keys
FROM (
  SELECT jsonb_object_keys(to_jsonb(portal_row)) AS key
  FROM (SELECT * FROM platform.student_portal_visa_cases() LIMIT 1) AS portal_row
) AS keys
\gset
SELECT array_agg(key ORDER BY key)::TEXT AS portal_task_keys
FROM (
  SELECT jsonb_object_keys(to_jsonb(portal_row)) AS key
  FROM (SELECT * FROM platform.student_portal_tasks() LIMIT 1) AS portal_row
) AS keys
\gset
SELECT array_agg(key ORDER BY key)::TEXT AS portal_update_keys
FROM (
  SELECT jsonb_object_keys(to_jsonb(portal_row)) AS key
  FROM (SELECT * FROM platform.student_portal_updates() LIMIT 1) AS portal_row
) AS keys
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'portal_application_keys' =
    '{application_id,application_status,case_id,institution_name,program_name,updated_at}'
    AND :'portal_visa_keys' =
      '{case_id,updated_at,visa_case_id,visa_status}'
    AND :'portal_task_keys' =
      '{case_id,case_task_id,due_at,priority,task_status,task_type,title,updated_at}'
    AND :'portal_update_keys' =
      '{body,case_id,case_update_id,occurred_at,source}',
  'a fixed Student Portal projection widened its column set'
);

SET request.jwt.claims TO :'student_b_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_applications()) = 0
    AND (SELECT count(*) FROM platform.student_portal_visa_cases()) = 0
    AND (SELECT count(*) FROM platform.student_portal_tasks()) = 0
    AND (SELECT count(*) FROM platform.student_portal_updates()) = 0,
  'Student B saw Student A Portal children'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_two_assigned_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.university_applications) = 2
    AND (SELECT count(*) FROM platform.university_application_events) = 3
    AND (SELECT count(*) FROM platform.visa_cases) = 1
    AND (SELECT count(*) FROM platform.visa_case_events) = 2
    AND (SELECT count(*) FROM platform.case_tasks) = 2
    AND (SELECT count(*) FROM platform.case_task_events) = 3
    AND (SELECT count(*) FROM platform.student_case_updates) = 2,
  'assigned Curator did not receive full case child history'
);
RESET ROLE;

SET request.jwt.claims TO :'curator_b_handoff_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.university_applications) = 0
    AND (SELECT count(*) FROM platform.visa_cases) = 0
    AND (SELECT count(*) FROM platform.case_tasks) = 0
    AND (SELECT count(*) FROM platform.student_case_updates) = 0,
  'Curator B saw Student A child history'
);
RESET ROLE;

SET request.jwt.claims TO :'finance_active_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.university_applications) = 0
    AND (SELECT count(*) FROM platform.visa_cases) = 0
    AND (SELECT count(*) FROM platform.case_tasks) = 0
    AND (SELECT count(*) FROM platform.student_case_updates) = 0,
  'Finance saw admissions child history'
);
RESET ROLE;

-- Parent identity is immutable and evidence is append-only even for the
-- privileged migration owner. These probes intentionally use no customer data.
\set ON_ERROR_STOP off
UPDATE platform.student_cases
SET student_membership_id = :'student_b_membership_id'
WHERE id = :'case_a_id';
\set case_parent_immutable_state :SQLSTATE
UPDATE platform.university_applications
SET student_case_id = :'case_b_id'
WHERE id = :'application_one_id';
\set application_parent_immutable_state :SQLSTATE
UPDATE platform.visa_cases
SET student_case_id = :'case_b_id'
WHERE id = :'visa_a_id';
\set visa_parent_immutable_state :SQLSTATE
UPDATE platform.case_tasks
SET student_case_id = :'case_b_id'
WHERE id = :'visible_task_id';
\set task_parent_immutable_state :SQLSTATE
UPDATE platform.student_case_updates
SET body = 'Forbidden mutation'
WHERE request_id = '42000000-0000-4000-8000-000000000221';
\set update_append_only_state :SQLSTATE
UPDATE platform.student_case_assignment_events
SET reason = 'Forbidden mutation'
WHERE request_id = '42000000-0000-4000-8000-000000000210';
\set assignment_append_only_state :SQLSTATE
UPDATE platform.student_case_lifecycle_events
SET reason = 'Forbidden mutation'
WHERE request_id = '42000000-0000-4000-8000-000000000215';
\set lifecycle_append_only_state :SQLSTATE
UPDATE platform.university_application_events
SET note = 'Forbidden mutation'
WHERE request_id = '42000000-0000-4000-8000-000000000230';
\set application_event_append_only_state :SQLSTATE
UPDATE platform.visa_case_events
SET note = 'Forbidden mutation'
WHERE request_id = '42000000-0000-4000-8000-000000000235';
\set visa_event_append_only_state :SQLSTATE
UPDATE platform.case_task_events
SET new_status = 'cancelled'
WHERE request_id = '42000000-0000-4000-8000-000000000241';
\set task_event_append_only_state :SQLSTATE
DELETE FROM platform.student_cases WHERE id = :'case_a_id';
\set case_delete_state :SQLSTATE
TRUNCATE platform.student_case_updates;
\set update_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'case_parent_immutable_state' = '55000'
    AND :'application_parent_immutable_state' = '55000'
    AND :'visa_parent_immutable_state' = '55000'
    AND :'task_parent_immutable_state' = '55000'
    AND :'update_append_only_state' = '55000'
    AND :'assignment_append_only_state' = '55000'
    AND :'lifecycle_append_only_state' = '55000'
    AND :'application_event_append_only_state' = '55000'
    AND :'visa_event_append_only_state' = '55000'
    AND :'task_event_append_only_state' = '55000'
    AND :'case_delete_state' = '55000'
    AND :'update_truncate_state' = '55000',
  'domain parent or append-only evidence was mutable'
);

-- Final two-tenant sanity: Admin A cannot see organization B, while Admin B
-- sees its one still-pending case and no organization-A row.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 2
    AND NOT EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'org_b_case_id'
    ),
  'Admin A crossed the organization boundary'
);
RESET ROLE;
SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_cases) = 1
    AND EXISTS (
      SELECT 1 FROM platform.student_cases WHERE id = :'org_b_case_id'
    ),
  'Admin B did not remain isolated to its minimal case'
);
RESET ROLE;

\echo 'P2D admissions/RLS acceptance passed'
