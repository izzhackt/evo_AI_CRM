\set ON_ERROR_STOP on

-- P2C uses only synthetic UUIDs and reserved example domains. This suite runs
-- after every canonical migration in an isolated disposable PostgreSQL
-- container; it never uses production identities or provider credentials.

DO $$
DECLARE
  actual_tables TEXT[];
  expected_tables CONSTANT TEXT[] := ARRAY[
    'audit_events',
    'membership_role_history',
    'membership_scope_assignments',
    'organization_memberships',
    'organizations',
    'permission_definitions',
    'profiles',
    'record_scopes',
    'role_bundle_permissions',
    'role_bundle_versions'
  ];
  actual_roles TEXT[];
  unprotected_table TEXT;
  unexpected_owner TEXT;
  unindexed_constraint TEXT;
  bootstrap_definition TEXT;
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO actual_tables
  FROM information_schema.tables
  WHERE table_schema = 'platform'
    AND table_type = 'BASE TABLE';

  IF actual_tables IS DISTINCT FROM expected_tables THEN
    RAISE EXCEPTION
      'P2C table inventory mismatch: expected %, found %',
      expected_tables,
      actual_tables;
  END IF;

  SELECT array_agg(enum_value ORDER BY enum_order)
  INTO actual_roles
  FROM (
    SELECT enumlabel::TEXT AS enum_value, enumsortorder AS enum_order
    FROM pg_enum
    WHERE enumtypid = 'platform.business_role'::regtype
  ) AS roles;

  IF actual_roles IS DISTINCT FROM ARRAY[
    'admin',
    'sales',
    'curator',
    'finance',
    'student'
  ]::TEXT[] THEN
    RAISE EXCEPTION
      'Platform business roles must be exactly admin/sales/curator/finance/student; found %',
      actual_roles;
  END IF;

  SELECT format('%I.%I', namespace.nspname, relation.relname)
  INTO unprotected_table
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'platform'
    AND relation.relkind IN ('r', 'p')
    AND (
      NOT relation.relrowsecurity
      OR NOT relation.relforcerowsecurity
    )
  ORDER BY relation.relname
  LIMIT 1;

  IF unprotected_table IS NOT NULL THEN
    RAISE EXCEPTION
      'Every Platform table must enable and force RLS; first violation: %',
      unprotected_table;
  END IF;

  SELECT format(
    '%I.%I owned by %I',
    namespace.nspname,
    object_entry.object_name,
    object_entry.owner_name
  )
  INTO unexpected_owner
  FROM (
    SELECT
      relation.relnamespace AS namespace_oid,
      relation.relname::TEXT AS object_name,
      pg_get_userbyid(relation.relowner)::TEXT AS owner_name
    FROM pg_class AS relation
    WHERE relation.relkind IN ('r', 'p', 'S', 'v', 'm')

    UNION ALL

    SELECT
      routine.pronamespace,
      routine.proname,
      pg_get_userbyid(routine.proowner)
    FROM pg_proc AS routine

    UNION ALL

    SELECT
      type_entry.typnamespace,
      type_entry.typname,
      pg_get_userbyid(type_entry.typowner)
    FROM pg_type AS type_entry
    WHERE type_entry.typtype IN ('e', 'd')
  ) AS object_entry
  JOIN pg_namespace AS namespace
    ON namespace.oid = object_entry.namespace_oid
  WHERE namespace.nspname IN ('platform', 'platform_private')
    AND object_entry.owner_name <> 'postgres'
  ORDER BY namespace.nspname, object_entry.object_name
  LIMIT 1;

  IF unexpected_owner IS NOT NULL THEN
    RAISE EXCEPTION
      'Platform identity objects must remain postgres-owned; first violation: %',
      unexpected_owner;
  END IF;

  SELECT constraint_entry.conname
  INTO unindexed_constraint
  FROM pg_constraint AS constraint_entry
  WHERE constraint_entry.contype = 'f'
    AND constraint_entry.connamespace = 'platform'::regnamespace
    AND NOT EXISTS (
      SELECT 1
      FROM pg_index AS index_entry
      WHERE index_entry.indrelid = constraint_entry.conrelid
        AND index_entry.indisvalid
        AND (
          SELECT array_agg(attribute_number ORDER BY ordinal_position)
          FROM unnest(index_entry.indkey)
            WITH ORDINALITY AS key_entry(attribute_number, ordinal_position)
          WHERE ordinal_position <= cardinality(constraint_entry.conkey)
        ) = constraint_entry.conkey
    )
  ORDER BY constraint_entry.conname
  LIMIT 1;

  IF unindexed_constraint IS NOT NULL THEN
    RAISE EXCEPTION
      'Every P2C foreign key needs a matching leading index; first violation: %',
      unindexed_constraint;
  END IF;

  SELECT pg_get_functiondef(
    'platform.bootstrap_organization_admin(text,uuid,text,text,uuid)'::regprocedure
  )
  INTO bootstrap_definition;

  IF bootstrap_definition NOT LIKE
    '%evo-platform:first-organization-bootstrap%'
  THEN
    RAISE EXCEPTION
      'First-organization bootstrap must serialize different request IDs';
  END IF;
END
$$;

\set admin_a_user_id '10000000-0000-4000-8000-000000000001'
\set sales_user_id '10000000-0000-4000-8000-000000000002'
\set curator_user_id '10000000-0000-4000-8000-000000000003'
\set finance_user_id '10000000-0000-4000-8000-000000000004'
\set student_user_id '10000000-0000-4000-8000-000000000005'
\set blocked_user_id '10000000-0000-4000-8000-000000000006'
\set no_membership_user_id '10000000-0000-4000-8000-000000000007'
\set admin_b_user_id '10000000-0000-4000-8000-000000000008'

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    :'admin_a_user_id',
    'admin-a@example.invalid',
    '{"full_name":"Synthetic Admin A"}'
  ),
  (
    :'sales_user_id',
    'sales@example.invalid',
    '{"full_name":"Synthetic Sales"}'
  ),
  (
    :'curator_user_id',
    'curator@example.invalid',
    '{"full_name":"Synthetic Curator"}'
  ),
  (
    :'finance_user_id',
    'finance@example.invalid',
    '{"full_name":"Synthetic Finance"}'
  ),
  (
    :'student_user_id',
    'student@example.invalid',
    '{"full_name":"Synthetic Student"}'
  ),
  (
    :'blocked_user_id',
    'blocked@example.invalid',
    '{"full_name":"Synthetic Blocked"}'
  ),
  (
    :'no_membership_user_id',
    'no-membership@example.invalid',
    '{"full_name":"Synthetic No Membership"}'
  ),
  (
    :'admin_b_user_id',
    'admin-b@example.invalid',
    '{"full_name":"Synthetic Admin B"}'
  );

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.bootstrap_organization_admin(
  'Synthetic Organization A',
  :'admin_a_user_id',
  'Synthetic Admin A',
  'P2C disposable authorization bootstrap',
  '20000000-0000-4000-8000-000000000001'
) IS NOT NULL AS bootstrap_a_ok \gset
RESET ROLE;

\if :bootstrap_a_ok
\else
  \echo 'FAIL: service bootstrap for Organization A returned null'
  SELECT 1 / 0;
\endif

-- bootstrap_organization_admin is deliberately one-shot. A second tenant is
-- inserted only as a privileged disposable fixture so cross-organization RLS
-- can be proven without inventing a production organization-creation API.
\set org_b_fixture_id '30000000-0000-4000-8000-000000000001'
\set admin_b_profile_fixture_id '30000000-0000-4000-8000-000000000002'
\set admin_b_membership_fixture_id '30000000-0000-4000-8000-000000000003'
\set org_b_scope_fixture_id '30000000-0000-4000-8000-000000000004'

BEGIN;
INSERT INTO platform.organizations (id, name)
VALUES (:'org_b_fixture_id', 'Synthetic Organization B');
INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name
)
VALUES (
  :'admin_b_profile_fixture_id',
  :'admin_b_user_id',
  'Synthetic Admin B'
);
INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
SELECT
  :'admin_b_membership_fixture_id',
  :'org_b_fixture_id',
  :'admin_b_profile_fixture_id',
  'active',
  'admin',
  bundle.id
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;
INSERT INTO platform.membership_role_history (
  organization_id,
  membership_id,
  profile_id,
  role_version,
  previous_role,
  new_role,
  previous_bundle_id,
  new_bundle_id,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
SELECT
  :'org_b_fixture_id',
  :'admin_b_membership_fixture_id',
  :'admin_b_profile_fixture_id',
  1,
  NULL,
  'admin',
  NULL,
  bundle.id,
  'system',
  NULL,
  'P2C disposable cross-organization fixture',
  '20000000-0000-4000-8000-000000000002'
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1;
INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key
)
VALUES (
  :'org_b_scope_fixture_id',
  :'org_b_fixture_id',
  'organization',
  :'org_b_fixture_id'
);
INSERT INTO platform.membership_scope_assignments (
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
VALUES (
  :'org_b_fixture_id',
  :'admin_b_membership_fixture_id',
  :'org_b_scope_fixture_id',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'P2C disposable cross-organization fixture',
  '20000000-0000-4000-8000-000000000003'
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
  request_id
)
VALUES (
  :'org_b_fixture_id',
  'system',
  NULL,
  'local-test-fixture',
  'organization.bootstrap',
  'organization',
  :'org_b_fixture_id',
  NULL,
  jsonb_build_object(
    'organization_id', :'org_b_fixture_id',
    'membership_id', :'admin_b_membership_fixture_id'
  ),
  'P2C disposable cross-organization fixture',
  '20000000-0000-4000-8000-000000000004'
);
COMMIT;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS admin_a_membership_id,
  profile.id AS admin_a_profile_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'admin_a_user_id'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS admin_b_membership_id,
  profile.id AS admin_b_profile_id,
  profile.access_version AS admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'admin_b_user_id'
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset

SELECT jsonb_build_object(
  'sub', :'admin_b_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.provision_member(
  :'org_a_id',
  :'sales_user_id',
  'Synthetic Sales',
  'sales',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000010'
)::TEXT AS sales_provision_first
\gset
SELECT platform.provision_member(
  :'org_a_id',
  :'sales_user_id',
  'Synthetic Sales',
  'sales',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000010'
)::TEXT AS sales_provision_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.provision_member(
  :'org_a_id',
  :'curator_user_id',
  'Synthetic Curator',
  'curator',
  'P2C replay mismatch probe',
  '20000000-0000-4000-8000-000000000010'
);
\set replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.provision_member(
  :'org_a_id',
  :'curator_user_id',
  'Synthetic Curator',
  'curator',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000011'
) IS NOT NULL AS curator_provision_ok
\gset
SELECT platform.provision_member(
  :'org_a_id',
  :'finance_user_id',
  'Synthetic Finance',
  'finance',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000012'
) IS NOT NULL AS finance_provision_ok
\gset
SELECT platform.provision_member(
  :'org_a_id',
  :'student_user_id',
  'Synthetic Student',
  'student',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000013'
) IS NOT NULL AS student_provision_ok
\gset
SELECT platform.provision_member(
  :'org_a_id',
  :'blocked_user_id',
  'Synthetic Blocked',
  'sales',
  'P2C disposable provision',
  '20000000-0000-4000-8000-000000000014'
) IS NOT NULL AS blocked_provision_ok
\gset
RESET ROLE;

SELECT
  :'sales_provision_first' = :'sales_provision_replay'
  AND :'replay_mismatch_state' <> '00000'
  AND :'curator_provision_ok' = 't'
  AND :'finance_provision_ok' = 't'
  AND :'student_provision_ok' = 't'
  AND :'blocked_provision_ok' = 't'
  AS provision_contract_ok
\gset
\if :provision_contract_ok
\else
  \echo 'FAIL: replay-safe member provisioning contract failed'
  SELECT 1 / 0;
\endif

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.assign_organization_scope(
  :'org_a_id',
  membership.id,
  'P2C disposable organization scope',
  '20000000-0000-4000-8000-000000000020'
) IS NOT NULL AS sales_scope_assigned
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'sales_user_id'
\gset
SELECT platform.assign_organization_scope(
  :'org_a_id',
  membership.id,
  'P2C disposable organization scope',
  '20000000-0000-4000-8000-000000000021'
) IS NOT NULL AS curator_scope_assigned
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'curator_user_id'
\gset
SELECT platform.assign_organization_scope(
  :'org_a_id',
  membership.id,
  'P2C disposable organization scope',
  '20000000-0000-4000-8000-000000000022'
) IS NOT NULL AS finance_scope_assigned
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'finance_user_id'
\gset
SELECT platform.assign_organization_scope(
  :'org_a_id',
  membership.id,
  'P2C disposable organization scope',
  '20000000-0000-4000-8000-000000000023'
) IS NOT NULL AS student_scope_assigned
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'student_user_id'
\gset
SELECT platform.assign_organization_scope(
  :'org_a_id',
  membership.id,
  'P2C disposable organization scope',
  '20000000-0000-4000-8000-000000000024'
) IS NOT NULL AS blocked_scope_assigned
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'blocked_user_id'
\gset
RESET ROLE;

SELECT
  :'sales_scope_assigned' = 't'
  AND :'curator_scope_assigned' = 't'
  AND :'finance_scope_assigned' = 't'
  AND :'student_scope_assigned' = 't'
  AND :'blocked_scope_assigned' = 't'
  AS scope_provision_ok
\gset
\if :scope_provision_ok
\else
  \echo 'FAIL: organization scope assignment failed'
  SELECT 1 / 0;
\endif

SELECT
  membership.id AS sales_membership_id,
  profile.id AS sales_profile_id,
  profile.access_version AS sales_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'sales_user_id'
\gset

SELECT
  membership.id AS curator_membership_id,
  profile.id AS curator_profile_id,
  profile.access_version AS curator_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'curator_user_id'
\gset

SELECT
  membership.id AS finance_membership_id,
  profile.id AS finance_profile_id,
  profile.access_version AS finance_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'finance_user_id'
\gset

SELECT
  membership.id AS student_membership_id,
  profile.id AS student_profile_id,
  profile.access_version AS student_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'student_user_id'
\gset

SELECT
  membership.id AS blocked_membership_id,
  profile.id AS blocked_profile_id,
  profile.access_version AS blocked_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'blocked_user_id'
\gset

SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_access_version'::BIGINT
)::TEXT AS sales_claims
\gset
SELECT jsonb_build_object(
  'sub', :'curator_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_access_version'::BIGINT
)::TEXT AS curator_claims
\gset
SELECT jsonb_build_object(
  'sub', :'finance_user_id',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'finance_access_version'::BIGINT
)::TEXT AS finance_claims
\gset
SELECT jsonb_build_object(
  'sub', :'student_user_id',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_access_version'::BIGINT
)::TEXT AS student_claims
\gset
SELECT jsonb_build_object(
  'sub', :'blocked_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'blocked_access_version'::BIGINT
)::TEXT AS blocked_claims
\gset

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS admin_a_org_count,
  (SELECT count(*) FROM platform.profiles) AS admin_a_profile_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS admin_a_membership_count,
  (SELECT count(*) FROM platform.audit_events) AS admin_a_audit_count,
  private.platform_has_permission(
    :'org_a_id',
    'membership.provision'
  ) AS admin_permission_ok,
  private.platform_has_scope(
    :'org_a_id',
    'organization',
    :'org_a_id'
  ) AS admin_scope_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS admin_b_org_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS admin_b_membership_count,
  (SELECT count(*)
   FROM platform.organization_memberships
   WHERE organization_id = :'org_a_id') AS admin_b_cross_org_count
\gset
RESET ROLE;

SET request.jwt.claims TO :'sales_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS sales_org_count,
  (SELECT count(*) FROM platform.profiles) AS sales_profile_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS sales_membership_count,
  (SELECT count(*) FROM platform.audit_events) AS sales_audit_count,
  private.platform_has_permission(
    :'org_a_id',
    'membership.read.self'
  ) AS sales_self_permission_ok,
  private.platform_has_permission(
    :'org_a_id',
    'membership.provision'
  ) AS sales_admin_permission_leak,
  private.platform_has_scope(
    :'org_a_id',
    'organization',
    :'org_a_id'
  ) AS sales_scope_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS curator_org_count,
  (SELECT count(*) FROM platform.profiles) AS curator_profile_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS curator_membership_count,
  private.platform_has_permission(
    :'org_a_id',
    'profile.read.self'
  ) AS curator_permission_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'finance_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS finance_org_count,
  (SELECT count(*) FROM platform.profiles) AS finance_profile_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS finance_membership_count,
  private.platform_has_permission(
    :'org_a_id',
    'scope.read.self'
  ) AS finance_permission_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organizations) AS student_org_count,
  (SELECT count(*) FROM platform.profiles) AS student_profile_count,
  (SELECT count(*) FROM platform.organization_memberships)
    AS student_membership_count,
  private.platform_has_permission(
    :'org_a_id',
    'organization.read'
  ) AS student_permission_ok
\gset
RESET ROLE;

SELECT
  :'admin_a_org_count' = '1'
  AND :'admin_a_profile_count' = '6'
  AND :'admin_a_membership_count' = '6'
  AND :'admin_a_audit_count'::INTEGER >= 11
  AND :'admin_permission_ok' = 't'
  AND :'admin_scope_ok' = 't'
  AND :'admin_b_org_count' = '1'
  AND :'admin_b_membership_count' = '1'
  AND :'admin_b_cross_org_count' = '0'
  AND :'sales_org_count' = '1'
  AND :'sales_profile_count' = '1'
  AND :'sales_membership_count' = '1'
  AND :'sales_audit_count' = '0'
  AND :'sales_self_permission_ok' = 't'
  AND :'sales_admin_permission_leak' = 'f'
  AND :'sales_scope_ok' = 't'
  AND :'curator_org_count' = '1'
  AND :'curator_profile_count' = '1'
  AND :'curator_membership_count' = '1'
  AND :'curator_permission_ok' = 't'
  AND :'finance_org_count' = '1'
  AND :'finance_profile_count' = '1'
  AND :'finance_membership_count' = '1'
  AND :'finance_permission_ok' = 't'
  AND :'student_org_count' = '1'
  AND :'student_profile_count' = '1'
  AND :'student_membership_count' = '1'
  AND :'student_permission_ok' = 't'
  AS five_role_matrix_ok
\gset
\if :five_role_matrix_ok
\else
  \echo 'FAIL: five-role positive/negative RLS matrix failed'
  SELECT 1 / 0;
\endif

-- Missing, forged and malformed custom claims are never an authorization
-- source. The same live Sales identity must see no rows for each invalid token.
SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated'
)::TEXT AS sales_missing_claims
\gset
SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'sales_access_version'::BIGINT
)::TEXT AS sales_forged_claims
\gset
SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 'not-a-number'
)::TEXT AS sales_malformed_claims
\gset

SET request.jwt.claims TO :'sales_missing_claims';
SET ROLE authenticated;
SELECT count(*) AS missing_claim_rows
FROM platform.organization_memberships
\gset
RESET ROLE;
SET request.jwt.claims TO :'sales_forged_claims';
SET ROLE authenticated;
SELECT count(*) AS forged_claim_rows
FROM platform.organization_memberships
\gset
RESET ROLE;
SET request.jwt.claims TO :'sales_malformed_claims';
SET ROLE authenticated;
SELECT count(*) AS malformed_claim_rows
FROM platform.organization_memberships
\gset
RESET ROLE;

SELECT
  :'missing_claim_rows' = '0'
  AND :'forged_claim_rows' = '0'
  AND :'malformed_claim_rows' = '0'
  AS invalid_claims_denied
\gset
\if :invalid_claims_denied
\else
  \echo 'FAIL: invalid or forged Platform claims received row access'
  SELECT 1 / 0;
\endif

DO $$
DECLARE
  hook_security_definer BOOLEAN;
  hook_volatility "char";
  hook_search_path TEXT;
  forbidden_role NAME;
  exposed_private_object TEXT;
  checked_table RECORD;
  actual_columns TEXT[];
BEGIN
  SELECT
    routine.prosecdef,
    routine.provolatile,
    array_to_string(routine.proconfig, ',')
  INTO
    hook_security_definer,
    hook_volatility,
    hook_search_path
  FROM pg_proc AS routine
  WHERE routine.oid =
    'platform_private.custom_access_token_hook(jsonb)'::regprocedure;

  IF hook_security_definer IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'custom access-token hook must be SECURITY INVOKER';
  END IF;
  IF hook_volatility <> 's' THEN
    RAISE EXCEPTION 'custom access-token hook must be STABLE';
  END IF;
  IF hook_search_path IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION
      'custom access-token hook must pin an empty search_path; found %',
      hook_search_path;
  END IF;

  IF NOT has_schema_privilege(
    'supabase_auth_admin',
    'platform_private',
    'USAGE'
  ) OR NOT has_function_privilege(
    'supabase_auth_admin',
    'platform_private.custom_access_token_hook(jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'supabase_auth_admin is missing the minimal hook invocation grants';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon'::NAME,
    'authenticated'::NAME,
    'service_role'::NAME
  ]
  LOOP
    IF has_function_privilege(
      forbidden_role,
      'platform_private.custom_access_token_hook(jsonb)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% must not invoke the custom access-token hook',
        forbidden_role;
    END IF;
  END LOOP;

  FOR checked_table IN
    SELECT *
    FROM (
      VALUES
        (
          'profiles'::TEXT,
          ARRAY['access_version', 'auth_user_id', 'id', 'status']::TEXT[]
        ),
        (
          'organization_memberships'::TEXT,
          ARRAY[
            'current_bundle_id',
            'current_role',
            'id',
            'organization_id',
            'profile_id',
            'status'
          ]::TEXT[]
        ),
        (
          'organizations'::TEXT,
          ARRAY['id', 'status']::TEXT[]
        ),
        (
          'role_bundle_versions'::TEXT,
          ARRAY['id', 'role', 'status']::TEXT[]
        )
    ) AS expected(table_name, column_names)
  LOOP
    IF has_table_privilege(
      'supabase_auth_admin',
      format('platform.%I', checked_table.table_name),
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'Auth hook must use column grants, not table SELECT, on platform.%',
        checked_table.table_name;
    END IF;

    SELECT array_agg(column_entry.attname::TEXT ORDER BY column_entry.attname)
    INTO actual_columns
    FROM pg_attribute AS column_entry
    WHERE column_entry.attrelid = format(
        'platform.%I',
        checked_table.table_name
      )::regclass
      AND column_entry.attnum > 0
      AND NOT column_entry.attisdropped
      AND has_column_privilege(
        'supabase_auth_admin',
        column_entry.attrelid,
        column_entry.attnum,
        'SELECT'
      );

    IF actual_columns IS DISTINCT FROM checked_table.column_names THEN
      RAISE EXCEPTION
        'Auth hook column grants mismatch on platform.%: expected %, found %',
        checked_table.table_name,
        checked_table.column_names,
        actual_columns;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS table_entry
    WHERE table_entry.relnamespace = 'platform'::regnamespace
      AND table_entry.relkind IN ('r', 'p')
      AND table_entry.relname NOT IN (
        'profiles',
        'organization_memberships',
        'organizations',
        'role_bundle_versions'
      )
      AND has_any_column_privilege(
        'supabase_auth_admin',
        table_entry.oid,
        'SELECT'
      )
  ) THEN
    RAISE EXCEPTION
      'supabase_auth_admin can read a Platform table not required by the hook';
  END IF;

  SELECT format('%I.%I', namespace.nspname, relation.relname)
  INTO exposed_private_object
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN unnest(ARRAY[
    'anon'::NAME,
    'authenticated'::NAME,
    'service_role'::NAME
  ]) AS checked_role(role_name)
  WHERE namespace.nspname = 'platform_private'
    AND relation.relkind IN ('r', 'p', 'v', 'm')
    AND has_any_column_privilege(
      checked_role.role_name,
      relation.oid,
      'SELECT,INSERT,UPDATE,REFERENCES'
    )
  ORDER BY relation.relname
  LIMIT 1;

  IF exposed_private_object IS NOT NULL THEN
    RAISE EXCEPTION
      'Private Platform object leaked to a browser/service role: %',
      exposed_private_object;
  END IF;
END
$$;

SET ROLE supabase_auth_admin;
SELECT platform_private.custom_access_token_hook(
  jsonb_build_object(
    'user_id', :'admin_a_user_id',
    'claims', jsonb_build_object(
      'sub', :'admin_a_user_id',
      'role', 'authenticated',
      'platform_role', 'finance',
      'platform_access_version', 999
    )
  )
)::TEXT AS admin_hook_result
\gset
SELECT platform_private.custom_access_token_hook(
  jsonb_build_object(
    'user_id', :'no_membership_user_id',
    'claims', jsonb_build_object(
      'sub', :'no_membership_user_id',
      'role', 'authenticated',
      'platform_role', 'admin',
      'platform_access_version', 999
    )
  )
)::TEXT AS no_membership_hook_result
\gset
RESET ROLE;

SELECT
  :'admin_hook_result'::JSONB #>> '{claims,platform_role}' = 'admin'
  AND (
    :'admin_hook_result'::JSONB #>> '{claims,platform_access_version}'
  )::BIGINT = :'admin_a_access_version'::BIGINT
  AND NOT (
    (:'no_membership_hook_result'::JSONB -> 'claims')
    ? 'platform_role'
  )
  AND NOT (
    (:'no_membership_hook_result'::JSONB -> 'claims')
    ? 'platform_access_version'
  )
  AS hook_claim_contract_ok
\gset
\if :hook_claim_contract_ok
\else
  \echo 'FAIL: custom access-token hook claim contract failed'
  SELECT 1 / 0;
\endif

DO $$
DECLARE
  relation_entry RECORD;
  forbidden_role NAME;
  default_acl_leak TEXT;
BEGIN
  FOR relation_entry IN
    SELECT relation.oid, relation.relname
    FROM pg_class AS relation
    WHERE relation.relnamespace = 'platform'::regnamespace
      AND relation.relkind IN ('r', 'p')
  LOOP
    IF NOT has_table_privilege(
      'authenticated',
      relation_entry.oid,
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'authenticated is missing reviewed SELECT on platform.%',
        relation_entry.relname;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon'::NAME,
      'authenticated'::NAME,
      'service_role'::NAME
    ]
    LOOP
      IF has_table_privilege(
        forbidden_role,
        relation_entry.oid,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      ) THEN
        RAISE EXCEPTION
          '% has forbidden direct DML on platform.%',
          forbidden_role,
          relation_entry.relname;
      END IF;
    END LOOP;
  END LOOP;

  SELECT format(
    '%s grants %s to %s',
    COALESCE(namespace.nspname, '<global>'),
    privilege_entry.privilege_type,
    COALESCE(grantee.rolname, 'PUBLIC')
  )
  INTO default_acl_leak
  FROM pg_default_acl AS default_entry
  LEFT JOIN pg_namespace AS namespace
    ON namespace.oid = default_entry.defaclnamespace
  CROSS JOIN LATERAL aclexplode(default_entry.defaclacl) AS privilege_entry
  LEFT JOIN pg_roles AS grantee
    ON grantee.oid = privilege_entry.grantee
  WHERE (
      namespace.nspname IN ('platform', 'platform_private')
      OR (
        default_entry.defaclnamespace = 0
        AND default_entry.defaclobjtype IN ('f', 'T')
      )
    )
    AND (
      privilege_entry.grantee = 0
      OR grantee.rolname IN (
        'anon',
        'authenticated',
        'service_role',
        'supabase_auth_admin'
      )
    )
  ORDER BY namespace.nspname NULLS FIRST, grantee.rolname NULLS FIRST
  LIMIT 1;

  IF default_acl_leak IS NOT NULL THEN
    RAISE EXCEPTION
      'P2C default privileges must be fail-closed; first leak: %',
      default_acl_leak;
  END IF;
END
$$;

-- No caller, including an authorized Admin or service_role, may bypass the
-- reviewed RPC boundary with direct identity or audit DML.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
UPDATE platform.organizations
SET name = 'Forbidden browser mutation'
WHERE id = :'org_a_id';
\set browser_dml_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET ROLE service_role;
\set ON_ERROR_STOP off
UPDATE platform.organizations
SET name = 'Forbidden service mutation'
WHERE id = :'org_a_id';
\set service_dml_state :SQLSTATE
SELECT platform_private.custom_access_token_hook(
  jsonb_build_object(
    'user_id', :'admin_a_user_id',
    'claims', '{}'::JSONB
  )
);
\set service_hook_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET ROLE anon;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.organizations;
\set anon_platform_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  :'browser_dml_state' = '42501'
  AND :'service_dml_state' = '42501'
  AND :'service_hook_state' = '42501'
  AND :'anon_platform_state' = '42501'
  AS direct_boundary_ok
\gset
\if :direct_boundary_ok
\else
  \echo 'FAIL: browser/service/anonymous direct boundary failed closed incorrectly'
  SELECT 1 / 0;
\endif

-- Database constraints protect the one-active-membership and structurally
-- role-matched bundle invariants even from a privileged migration connection.
SELECT id AS sales_bundle_id
FROM platform.role_bundle_versions
WHERE role = 'sales'
  AND status = 'published'
ORDER BY version DESC
LIMIT 1
\gset
SELECT id AS curator_bundle_id
FROM platform.role_bundle_versions
WHERE role = 'curator'
  AND status = 'published'
ORDER BY version DESC
LIMIT 1
\gset

\set ON_ERROR_STOP off
INSERT INTO platform.organization_memberships (
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
VALUES (
  :'org_b_id',
  :'sales_profile_id',
  'active',
  'sales',
  :'sales_bundle_id'
);
\set duplicate_active_membership_state :SQLSTATE

UPDATE platform.organization_memberships
SET current_bundle_id = :'curator_bundle_id'
WHERE id = :'sales_membership_id';
\set mismatched_bundle_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT
  :'duplicate_active_membership_state' = '23505'
  AND :'mismatched_bundle_state' = '23503'
  AS structural_constraints_ok
\gset
\if :structural_constraints_ok
\else
  \echo 'FAIL: active-membership or role/bundle structural constraint failed'
  SELECT 1 / 0;
\endif

-- Admin authority is organization-scoped and may not remove the last active,
-- organization-scoped Admin.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.change_membership_role(
  :'org_b_id',
  :'admin_b_membership_id',
  'sales',
  'P2C cross-organization denial probe',
  '20000000-0000-4000-8000-000000000030'
);
\set cross_org_rpc_state :SQLSTATE
SELECT platform.change_membership_status(
  :'org_a_id',
  :'admin_a_membership_id',
  'blocked',
  'P2C last Admin denial probe',
  '20000000-0000-4000-8000-000000000031'
);
\set last_admin_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  :'cross_org_rpc_state' <> '00000'
  AND :'last_admin_state' <> '00000'
  AS admin_safety_ok
\gset
\if :admin_safety_ok
\else
  \echo 'FAIL: cross-organization or last-Admin RPC protection failed'
  SELECT 1 / 0;
\endif

-- A role change increments access_version. The held JWT loses all rows before
-- refresh; only the new role/version pair restores the self-scoped view.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.change_membership_role(
  :'org_a_id',
  :'sales_membership_id',
  'curator',
  'P2C stale token role change',
  '20000000-0000-4000-8000-000000000032'
)::TEXT AS role_change_first
\gset
SELECT platform.change_membership_role(
  :'org_a_id',
  :'sales_membership_id',
  'curator',
  'P2C stale token role change',
  '20000000-0000-4000-8000-000000000032'
)::TEXT AS role_change_replay
\gset
RESET ROLE;

SELECT access_version AS sales_role_changed_version
FROM platform.profiles
WHERE id = :'sales_profile_id'
\gset

SET request.jwt.claims TO :'sales_claims';
SET ROLE authenticated;
SELECT count(*) AS stale_role_rows
FROM platform.organization_memberships
\gset
RESET ROLE;

SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'sales_role_changed_version'::BIGINT
)::TEXT AS sales_curator_claims
\gset
SET request.jwt.claims TO :'sales_curator_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organization_memberships)
    AS refreshed_role_membership_rows,
  (SELECT count(*) FROM platform.organizations)
    AS refreshed_role_organization_rows
\gset
RESET ROLE;

SELECT
  :'role_change_first' = :'role_change_replay'
  AND :'sales_role_changed_version'::BIGINT >
    :'sales_access_version'::BIGINT
  AND :'stale_role_rows' = '0'
  AND :'refreshed_role_membership_rows' = '1'
  AND :'refreshed_role_organization_rows' = '1'
  AS role_staleness_ok
\gset
\if :role_staleness_ok
\else
  \echo 'FAIL: role change replay or stale-token invalidation failed'
  SELECT 1 / 0;
\endif

-- Scope changes are append-only authority events and also invalidate held
-- tokens. Without live organization scope, the organization row disappears.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.revoke_organization_scope(
  :'org_a_id',
  :'sales_membership_id',
  'P2C scope revocation',
  '20000000-0000-4000-8000-000000000033'
) IS NOT NULL AS scope_revoked
\gset
RESET ROLE;

SELECT access_version AS sales_scope_revoked_version
FROM platform.profiles
WHERE id = :'sales_profile_id'
\gset

SET request.jwt.claims TO :'sales_curator_claims';
SET ROLE authenticated;
SELECT count(*) AS stale_scope_rows
FROM platform.organization_memberships
\gset
RESET ROLE;

SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'sales_scope_revoked_version'::BIGINT
)::TEXT AS sales_scope_revoked_claims
\gset
SET request.jwt.claims TO :'sales_scope_revoked_claims';
SET ROLE authenticated;
SELECT
  (SELECT count(*) FROM platform.organization_memberships)
    AS revoked_scope_membership_rows,
  (SELECT count(*) FROM platform.organizations)
    AS revoked_scope_organization_rows
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.assign_organization_scope(
  :'org_a_id',
  :'sales_membership_id',
  'P2C scope reassignment',
  '20000000-0000-4000-8000-000000000034'
) IS NOT NULL AS scope_reassigned
\gset
RESET ROLE;

SELECT access_version AS sales_scope_reassigned_version
FROM platform.profiles
WHERE id = :'sales_profile_id'
\gset
SELECT jsonb_build_object(
  'sub', :'sales_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'sales_scope_reassigned_version'::BIGINT
)::TEXT AS sales_scope_reassigned_claims
\gset
SET request.jwt.claims TO :'sales_scope_reassigned_claims';
SET ROLE authenticated;
SELECT
  private.platform_has_scope(
    :'org_a_id',
    'organization',
    :'org_a_id'
  ) AS reassigned_scope_live
\gset
RESET ROLE;

SELECT
  :'scope_revoked' = 't'
  AND :'sales_scope_revoked_version'::BIGINT >
    :'sales_role_changed_version'::BIGINT
  AND :'stale_scope_rows' = '0'
  AND :'revoked_scope_membership_rows' = '0'
  AND :'revoked_scope_organization_rows' = '0'
  AND :'scope_reassigned' = 't'
  AND :'sales_scope_reassigned_version'::BIGINT >
    :'sales_scope_revoked_version'::BIGINT
  AND :'reassigned_scope_live' = 't'
  AS scope_authority_ok
\gset
\if :scope_authority_ok
\else
  \echo 'FAIL: scope append/revoke/reassign or stale-token boundary failed'
  SELECT 1 / 0;
\endif

-- Both inactive and blocked memberships fail live RLS immediately. The hook
-- strips any stale coarse claims when a token is refreshed.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.change_membership_status(
  :'org_a_id',
  :'finance_membership_id',
  'inactive',
  'P2C inactive membership denial',
  '20000000-0000-4000-8000-000000000035'
) IS NOT NULL AS finance_inactivated
\gset
SELECT platform.change_membership_status(
  :'org_a_id',
  :'blocked_membership_id',
  'blocked',
  'P2C blocked membership denial',
  '20000000-0000-4000-8000-000000000036'
) IS NOT NULL AS member_blocked
\gset
RESET ROLE;

SET request.jwt.claims TO :'finance_claims';
SET ROLE authenticated;
SELECT count(*) AS inactive_held_rows
FROM platform.organization_memberships
\gset
RESET ROLE;
SET request.jwt.claims TO :'blocked_claims';
SET ROLE authenticated;
SELECT count(*) AS blocked_held_rows
FROM platform.organization_memberships
\gset
RESET ROLE;

SET ROLE supabase_auth_admin;
SELECT platform_private.custom_access_token_hook(
  jsonb_build_object(
    'user_id', :'finance_user_id',
    'claims', jsonb_build_object(
      'platform_role', 'finance',
      'platform_access_version', :'finance_access_version'::BIGINT
    )
  )
)::TEXT AS inactive_hook_result
\gset
SELECT platform_private.custom_access_token_hook(
  jsonb_build_object(
    'user_id', :'blocked_user_id',
    'claims', jsonb_build_object(
      'platform_role', 'sales',
      'platform_access_version', :'blocked_access_version'::BIGINT
    )
  )
)::TEXT AS blocked_hook_result
\gset
RESET ROLE;

SELECT
  :'finance_inactivated' = 't'
  AND :'member_blocked' = 't'
  AND :'inactive_held_rows' = '0'
  AND :'blocked_held_rows' = '0'
  AND NOT (:'inactive_hook_result'::JSONB -> 'claims' ? 'platform_role')
  AND NOT (
    :'inactive_hook_result'::JSONB -> 'claims'
    ? 'platform_access_version'
  )
  AND NOT (:'blocked_hook_result'::JSONB -> 'claims' ? 'platform_role')
  AND NOT (
    :'blocked_hook_result'::JSONB -> 'claims'
    ? 'platform_access_version'
  )
  AS inactive_blocked_ok
\gset
\if :inactive_blocked_ok
\else
  \echo 'FAIL: inactive/blocked RLS or refreshed-claim removal failed'
  SELECT 1 / 0;
\endif

-- Published RBAC and event evidence are forward-only.
\set ON_ERROR_STOP off
UPDATE platform.permission_definitions
SET description = 'Forbidden mutation'
WHERE permission_key = 'organization.read';
\set permission_immutable_state :SQLSTATE
UPDATE platform.role_bundle_versions
SET label = 'Forbidden mutation'
WHERE id = :'sales_bundle_id';
\set bundle_immutable_state :SQLSTATE
DELETE FROM platform.role_bundle_permissions
WHERE bundle_id = :'sales_bundle_id'
  AND permission_key = 'organization.read';
\set bundle_permission_immutable_state :SQLSTATE
UPDATE platform.membership_role_history
SET reason = 'Forbidden mutation'
WHERE membership_id = :'sales_membership_id';
\set role_history_immutable_state :SQLSTATE
UPDATE platform.membership_scope_assignments
SET reason = 'Forbidden mutation'
WHERE membership_id = :'sales_membership_id';
\set scope_history_immutable_state :SQLSTATE
UPDATE platform.audit_events
SET reason = 'Forbidden mutation'
WHERE organization_id = :'org_a_id';
\set audit_immutable_state :SQLSTATE
TRUNCATE platform.audit_events;
\set audit_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT
  :'permission_immutable_state' = '55000'
  AND :'bundle_immutable_state' = '55000'
  AND :'bundle_permission_immutable_state' = '55000'
  AND :'role_history_immutable_state' = '55000'
  AND :'scope_history_immutable_state' = '55000'
  AND :'audit_immutable_state' = '55000'
  AND :'audit_truncate_state' = '55000'
  AS append_only_evidence_ok
\gset
\if :append_only_evidence_ok
\else
  \echo 'FAIL: published RBAC or append-only evidence was mutable'
  SELECT 1 / 0;
\endif
