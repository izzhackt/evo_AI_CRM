\set ON_ERROR_STOP on

-- P3A exposes one narrow authenticated RPC. Its result contract and grants are
-- checked before behavior so an accidental broadening fails visibly.
DO $current_actor_authority_contract$
DECLARE
  routine_oid OID;
  routine_owner NAME;
  routine_security_definer BOOLEAN;
  routine_volatility "char";
  routine_search_path TEXT;
  routine_returns_set BOOLEAN;
  actual_columns TEXT[];
  expected_columns CONSTANT TEXT[] := ARRAY[
    'auth_user_id:uuid',
    'profile_id:uuid',
    'membership_id:uuid',
    'organization_id:uuid',
    'display_name:text',
    'platform_role:platform.business_role',
    'platform_access_version:bigint'
  ];
BEGIN
  routine_oid := to_regprocedure(
    'platform.current_actor_authority()'
  );

  IF routine_oid IS NULL THEN
    RAISE EXCEPTION
      'platform.current_actor_authority() is missing';
  END IF;

  SELECT
    pg_get_userbyid(routine.proowner),
    routine.prosecdef,
    routine.provolatile,
    array_to_string(routine.proconfig, ','),
    routine.proretset
  INTO
    routine_owner,
    routine_security_definer,
    routine_volatility,
    routine_search_path,
    routine_returns_set
  FROM pg_proc AS routine
  WHERE routine.oid = routine_oid;

  IF routine_owner <> 'postgres'
    OR routine_security_definer IS DISTINCT FROM TRUE
    OR routine_volatility <> 's'
    OR routine_search_path IS DISTINCT FROM 'search_path=""'
    OR routine_returns_set IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION
      'current actor RPC posture drifted: owner=%, definer=%, volatility=%, settings=%, set=%',
      routine_owner,
      routine_security_definer,
      routine_volatility,
      routine_search_path,
      routine_returns_set;
  END IF;

  SELECT array_agg(
    output_argument.argument_name
      || ':'
      || output_argument.type_oid::REGTYPE::TEXT
    ORDER BY output_argument.ordinality
  )
  INTO actual_columns
  FROM pg_proc AS routine
  CROSS JOIN LATERAL unnest(
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames
  ) WITH ORDINALITY AS output_argument(
    type_oid,
    argument_mode,
    argument_name,
    ordinality
  )
  WHERE routine.oid = routine_oid
    AND output_argument.argument_mode IN ('o', 't');

  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION
      'current actor RPC result changed: expected %, found %',
      expected_columns,
      actual_columns;
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    routine_oid,
    'EXECUTE'
  )
    OR has_function_privilege('anon', routine_oid, 'EXECUTE')
    OR has_function_privilege('service_role', routine_oid, 'EXECUTE')
    OR has_function_privilege(
      'supabase_auth_admin',
      routine_oid,
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION
      'current actor RPC must be executable only by authenticated';
  END IF;
END
$current_actor_authority_contract$;

BEGIN;

-- Create one disposable actor after the scoped-role backfill. Its legacy bundle
-- and organization scope establish no scoped business permissions. Active staff
-- identity and live business rights are deliberately checked separately.
\set p3a_actor_user_id 'f0470000-0000-4000-8000-000000000001'
\set p3a_actor_profile_id 'f0470000-0000-4000-8000-000000000002'
\set p3a_actor_membership_id 'f0470000-0000-4000-8000-000000000003'
\set p3a_actor_scope_event_id 'f0470000-0000-4000-8000-000000000004'
\set p3a_actor_scope_request_id 'f0470000-0000-4000-8000-000000000005'

SELECT
  scope.organization_id AS p3a_actor_organization_id,
  scope.id AS p3a_actor_scope_id,
  scope.scope_version AS p3a_actor_scope_version
FROM platform.record_scopes AS scope
JOIN platform.organizations AS organization
  ON organization.id = scope.organization_id
  AND organization.status = 'active'
WHERE scope.scope_kind = 'organization'
  AND scope.scope_key = scope.organization_id
  AND scope.is_active
ORDER BY scope.organization_id, scope.scope_version DESC
LIMIT 1
\gset

SELECT
  bundle.id AS p3a_actor_bundle_id,
  bundle.version AS p3a_actor_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO auth.users (
  id,
  email,
  raw_user_meta_data
)
VALUES (
  :'p3a_actor_user_id',
  'p3a-current-actor@example.invalid',
  '{"full_name":"P3A RPC Actor"}'::JSONB
);

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
)
VALUES (
  :'p3a_actor_profile_id',
  :'p3a_actor_user_id',
  'P3A RPC Actor',
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
)
VALUES (
  :'p3a_actor_membership_id',
  :'p3a_actor_organization_id',
  :'p3a_actor_profile_id',
  'active',
  'sales',
  :'p3a_actor_bundle_id'
);

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
VALUES (
  :'p3a_actor_scope_event_id',
  :'p3a_actor_organization_id',
  :'p3a_actor_membership_id',
  :'p3a_actor_scope_id',
  :'p3a_actor_scope_version',
  1,
  TRUE,
  'system',
  NULL,
  'P3A current actor SQL contract fixture',
  :'p3a_actor_scope_request_id'
);

SET CONSTRAINTS ALL IMMEDIATE;

SELECT jsonb_build_object(
  'sub', :'p3a_actor_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'p3a_actor_organization_id',
  'platform_membership_id', :'p3a_actor_membership_id',
  'platform_bundle_id', :'p3a_actor_bundle_id',
  'platform_bundle_version', :'p3a_actor_bundle_version'::BIGINT
)::TEXT AS p3a_actor_claims
\gset

SELECT jsonb_build_array(jsonb_build_object(
  'auth_user_id', :'p3a_actor_user_id',
  'profile_id', :'p3a_actor_profile_id',
  'membership_id', :'p3a_actor_membership_id',
  'organization_id', :'p3a_actor_organization_id',
  'display_name', 'P3A RPC Actor',
  'platform_role', 'sales',
  'platform_access_version', 1
))::TEXT AS p3a_expected_actor,
jsonb_build_object(
  'schemaVersion', 1,
  'authUserId', :'p3a_actor_user_id',
  'profileId', :'p3a_actor_profile_id',
  'membershipId', :'p3a_actor_membership_id',
  'organizationId', :'p3a_actor_organization_id',
  'displayName', 'P3A RPC Actor',
  'systemRole', 'staff',
  'accessVersion', 1,
  'assignments', '[]'::JSONB,
  'permissions', '[]'::JSONB
)::TEXT AS p3a_expected_empty_snapshot
\gset

SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT
  count(*) AS p3a_positive_rows,
  count(*) FILTER (
    WHERE auth_user_id = :'p3a_actor_user_id'
      AND profile_id = :'p3a_actor_profile_id'
      AND membership_id = :'p3a_actor_membership_id'
      AND organization_id = :'p3a_actor_organization_id'
      AND display_name = 'P3A RPC Actor'
      AND platform_role = 'sales'
      AND platform_access_version = 1
  ) AS p3a_positive_matching_rows
FROM platform.current_actor_authority()
\gset
SELECT platform.staff_access_snapshot() = :'p3a_expected_empty_snapshot'::JSONB
  AS p3a_positive_empty_permissions
\gset
RESET ROLE;

\if :{?p3a_positive_rows}
\else
  \echo 'FAIL: current actor positive result was not captured'
  SELECT 1 / 0;
\endif

SELECT
  :'p3a_positive_rows' = '1'
  AND :'p3a_positive_matching_rows' = '1'
  AND :'p3a_positive_empty_permissions'::BOOLEAN
  AS p3a_positive_contract_ok
\gset
\if :p3a_positive_contract_ok
\else
  \echo 'FAIL: current actor RPC did not return the one exact safe row'
  SELECT 1 / 0;
\endif

-- Subject and organization/membership routing still bind the caller. These
-- pre-existing legacy role/version cases must return only the exact LIVE staff
-- identity and empty scoped rights, never authority from the old JWT fields.
SELECT (
  :'p3a_actor_claims'::JSONB || jsonb_build_object(
    'sub', 'f0470000-0000-4000-8000-000000000099'
  )
)::TEXT AS p3a_wrong_subject_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p3a_actor_user_id',
  'role', 'authenticated'
)::TEXT AS p3a_missing_authority_claims
\gset
SELECT (
  :'p3a_actor_claims'::JSONB || jsonb_build_object('platform_role', 'admin')
)::TEXT AS p3a_wrong_role_claims
\gset
SELECT (
  :'p3a_actor_claims'::JSONB || jsonb_build_object('platform_access_version', 2)
)::TEXT AS p3a_stale_version_claims
\gset
SELECT (
  :'p3a_actor_claims'::JSONB
  || jsonb_build_object('platform_access_version', 'not-a-number')
)::TEXT AS p3a_malformed_version_claims
\gset

SET request.jwt.claims TO :'p3a_wrong_subject_claims';
SET ROLE authenticated;
SELECT count(*) AS p3a_wrong_subject_rows
FROM platform.current_actor_authority()
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_missing_authority_claims';
SET ROLE authenticated;
SELECT count(*) AS p3a_missing_authority_rows
FROM platform.current_actor_authority()
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_wrong_role_claims';
SET ROLE authenticated;
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = :'p3a_expected_actor'::JSONB
  AND platform.staff_access_snapshot() = :'p3a_expected_empty_snapshot'::JSONB
  AS p3a_wrong_role_live_contract_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_stale_version_claims';
SET ROLE authenticated;
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = :'p3a_expected_actor'::JSONB
  AND platform.staff_access_snapshot() = :'p3a_expected_empty_snapshot'::JSONB
  AS p3a_stale_version_live_contract_ok
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_malformed_version_claims';
SET ROLE authenticated;
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = :'p3a_expected_actor'::JSONB
  AND platform.staff_access_snapshot() = :'p3a_expected_empty_snapshot'::JSONB
  AS p3a_malformed_version_live_contract_ok
\gset
RESET ROLE;

SELECT
  :'p3a_wrong_subject_rows' = '0'
  AND :'p3a_missing_authority_rows' = '0'
  AND :'p3a_wrong_role_live_contract_ok'::BOOLEAN
  AND :'p3a_stale_version_live_contract_ok'::BOOLEAN
  AND :'p3a_malformed_version_live_contract_ok'::BOOLEAN
  AS p3a_claim_contract_ok
\gset
\if :p3a_claim_contract_ok
\else
  \echo 'FAIL: current actor caller binding or live staff rights changed'
  SELECT 1 / 0;
\endif

-- Every live-state input is re-read on each call. Each mutation is isolated by
-- a savepoint, and the final transaction rollback leaves no fixture behind.
SAVEPOINT p3a_profile_blocked;
UPDATE platform.profiles
SET status = 'blocked'
WHERE id = :'p3a_actor_profile_id';
SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT count(*) AS p3a_blocked_profile_rows
FROM platform.current_actor_authority()
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p3a_profile_blocked;
RELEASE SAVEPOINT p3a_profile_blocked;

SAVEPOINT p3a_membership_inactive;
UPDATE platform.organization_memberships
SET status = 'inactive'
WHERE id = :'p3a_actor_membership_id';
SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT count(*) AS p3a_inactive_membership_rows
FROM platform.current_actor_authority()
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p3a_membership_inactive;
RELEASE SAVEPOINT p3a_membership_inactive;

SAVEPOINT p3a_organization_suspended;
UPDATE platform.organizations
SET status = 'suspended'
WHERE id = :'p3a_actor_organization_id';
SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT count(*) AS p3a_suspended_organization_rows
FROM platform.current_actor_authority()
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p3a_organization_suspended;
RELEASE SAVEPOINT p3a_organization_suspended;

SAVEPOINT p3a_scope_revoked;
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
VALUES (
  'f0470000-0000-4000-8000-000000000008',
  :'p3a_actor_organization_id',
  :'p3a_actor_membership_id',
  :'p3a_actor_scope_id',
  :'p3a_actor_scope_version',
  2,
  FALSE,
  'system',
  NULL,
  'P3A current actor scope revocation probe',
  'f0470000-0000-4000-8000-000000000009'
);
SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = :'p3a_expected_actor'::JSONB
  AND platform.staff_access_snapshot() = :'p3a_expected_empty_snapshot'::JSONB
  AS p3a_revoked_scope_live_contract_ok
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p3a_scope_revoked;
RELEASE SAVEPOINT p3a_scope_revoked;

SELECT
  :'p3a_blocked_profile_rows' = '0'
  AND :'p3a_inactive_membership_rows' = '0'
  AND :'p3a_suspended_organization_rows' = '0'
  AND :'p3a_revoked_scope_live_contract_ok'::BOOLEAN
  AS p3a_live_state_contract_ok
\gset
\if :p3a_live_state_contract_ok
\else
  \echo 'FAIL: current actor live identity/status or legacy scope contract changed'
  SELECT 1 / 0;
\endif

-- Legacy bundle rewrites are frozen after S2. Replace those historical probes
-- with the ordinary Admin assignment command, using an existing published role
-- whose complete permission set supports organization scope. No role definition
-- or other member is changed; rollback removes this actor's assignments/audit.
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_organization_id', membership.organization_id,
  'platform_membership_id', membership.id
)::TEXT AS p3a_admin_claims
FROM platform.organization_memberships membership
JOIN platform.profiles profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p3a_actor_organization_id'
  AND membership.is_system_admin
  AND membership.status = 'active'
  AND profile.status = 'active'
ORDER BY membership.id
LIMIT 1
\gset

SELECT role.id AS p3a_scoped_role_id,
  jsonb_build_array(jsonb_build_object(
    'roleId', role.id, 'roleVersion', role.version,
    'bundleId', bundle.id, 'bundleVersion', bundle.version
  ))::TEXT AS p3a_scoped_role_bindings,
  jsonb_build_array(jsonb_build_object(
    'roleId', role.id,
    'scope', jsonb_build_object('kind', 'organization',
      'key', :'p3a_actor_organization_id', 'resourceKind', NULL)
  ))::TEXT AS p3a_scoped_assignments,
  jsonb_build_object(
    'roleId', role.id, 'label', role.label,
    'bundleId', bundle.id, 'bundleVersion', bundle.version,
    'scope', jsonb_build_object('kind', 'organization',
      'key', :'p3a_actor_organization_id', 'resourceKind', NULL)
  )::TEXT AS p3a_expected_assignment,
  jsonb_agg(permission.permission_key ORDER BY permission.permission_key)::TEXT
    AS p3a_expected_permissions
FROM platform.staff_role_definitions role
JOIN platform.staff_role_bundle_bindings binding
  ON binding.organization_id = role.organization_id
  AND binding.role_id = role.id AND binding.bundle_id = role.current_bundle_id
JOIN platform.role_bundle_versions bundle
  ON bundle.id = binding.bundle_id AND bundle.version = binding.bundle_version
JOIN platform.role_bundle_permissions permission ON permission.bundle_id = bundle.id
JOIN platform.permission_definitions definition
  ON definition.permission_key = permission.permission_key
WHERE role.organization_id = :'p3a_actor_organization_id'
  AND role.status = 'active' AND bundle.status = 'published'
GROUP BY role.id, bundle.id
HAVING bool_and('organization' = ANY(definition.staff_scope_kinds)
  AND cardinality(definition.staff_resource_kinds) > 0
  AND NOT definition.staff_sensitive AND NOT definition.staff_system_only)
ORDER BY role.id
LIMIT 1
\gset

\if :{?p3a_admin_claims}
\else
  \echo 'FAIL: current actor ordinary assignment Admin fixture is missing'
  SELECT 1 / 0;
\endif
\if :{?p3a_scoped_role_id}
\else
  \echo 'FAIL: current actor published organization-role fixture is missing'
  SELECT 1 / 0;
\endif

SET request.jwt.claims TO :'p3a_admin_claims';
SET ROLE authenticated;
SELECT platform.staff_role_assignments_save(
  :'p3a_actor_organization_id', :'p3a_actor_membership_id', 1,
  :'p3a_scoped_assignments'::JSONB, :'p3a_scoped_role_bindings'::JSONB,
  'P3A ordinary scoped role assignment', 'f0470000-0000-4000-8000-000000000010'
) = jsonb_build_object('status', 'applied', 'membershipId', :'p3a_actor_membership_id',
  'accessVersion', 2) AS p3a_assignment_applied
\gset
RESET ROLE;

-- Reuse the original staff claims (version 1). Both identity and business rights
-- must reflect live version 2, including exactly the one published assignment.
SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
WITH snapshot AS (SELECT platform.staff_access_snapshot() AS body)
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = jsonb_set(:'p3a_expected_actor'::JSONB, '{0,platform_access_version}', '2')
  AND body - 'assignments' = (:'p3a_expected_empty_snapshot'::JSONB - 'assignments')
    || jsonb_build_object('accessVersion', 2, 'permissions', :'p3a_expected_permissions'::JSONB)
  AND jsonb_array_length(body->'assignments') = 1
  AND (body #> '{assignments,0}') - 'id' = :'p3a_expected_assignment'::JSONB
  AND (body #>> '{assignments,0,id}')::UUID IS NOT NULL
  AS p3a_assignment_live_contract_ok
FROM snapshot
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_admin_claims';
SET ROLE authenticated;
SELECT platform.staff_role_assignments_save(
  :'p3a_actor_organization_id', :'p3a_actor_membership_id', 2, '[]', '[]',
  'P3A ordinary scoped role removal', 'f0470000-0000-4000-8000-000000000011'
) = jsonb_build_object('status', 'applied', 'membershipId', :'p3a_actor_membership_id',
  'accessVersion', 3) AS p3a_assignment_removed
\gset
RESET ROLE;

SET request.jwt.claims TO :'p3a_actor_claims';
SET ROLE authenticated;
SELECT
  (SELECT jsonb_agg(to_jsonb(actor)) FROM platform.current_actor_authority() actor)
    = jsonb_set(:'p3a_expected_actor'::JSONB, '{0,platform_access_version}', '3')
  AND platform.staff_access_snapshot()
    = jsonb_set(:'p3a_expected_empty_snapshot'::JSONB, '{accessVersion}', '3')
  AS p3a_removal_live_contract_ok
\gset
RESET ROLE;

SELECT :'p3a_assignment_applied'::BOOLEAN AND :'p3a_assignment_live_contract_ok'::BOOLEAN
  AND :'p3a_assignment_removed'::BOOLEAN AND :'p3a_removal_live_contract_ok'::BOOLEAN
  AS p3a_scoped_assignment_contract_ok
\gset
\if :p3a_scoped_assignment_contract_ok
\else
  \echo 'FAIL: current actor did not follow ordinary live scoped grant/removal'
  SELECT 1 / 0;
\endif

ROLLBACK;
