\set ON_ERROR_STOP on

-- Current-boundary contract for migration 106. It proves both the catalog
-- posture and the live actor-scoped authorization boundary against the
-- durable synthetic communication fixtures created by the earlier suites.
BEGIN;

DO $catalog_contract$
DECLARE
  routine_oid OID := pg_catalog.to_regprocedure(
    'platform.staff_communication_command_context(uuid,uuid)'
  )::OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  IF routine_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 106 communication command-context RPC signature is missing';
  END IF;

  SELECT routine.*
  INTO STRICT routine_row
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = routine_oid;

  IF NOT routine_row.prosecdef
    OR routine_row.provolatile <> 's'
    OR routine_row.prokind <> 'f'
    OR NOT routine_row.proretset
    OR NOT (
      routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
    )
    OR routine_row.pronargdefaults <> 0
    OR pg_catalog.pg_get_function_result(routine_oid)
      <> 'TABLE(conversation_id uuid, canonical_lead_id uuid, canonical_client_id uuid, student_case_id uuid)'
  THEN
    RAISE EXCEPTION 'Migration 106 command-context RPC contract drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    routine_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated lacks EXECUTE on migration 106 command-context RPC';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has EXECUTE on migration 106 command-context RPC',
        forbidden_role;
    END IF;
  END LOOP;

  IF pg_catalog.obj_description(routine_oid, 'pg_proc')
    NOT LIKE '%never infers scope from provider identifiers%'
  THEN
    RAISE EXCEPTION 'Migration 106 command-context RPC comment drifted';
  END IF;
END
$catalog_contract$;

CREATE OR REPLACE FUNCTION pg_temp.p6c_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P6C assertion failed: %', p_message;
  END IF;
END
$$;

-- Resolve active durable P2F actors from database truth and build the complete
-- post-083 JWT authority claims. Provider identifiers never participate in
-- this setup or in the command-context lookup.
SELECT
  membership.organization_id AS p6c_org_a,
  membership.id AS p6c_admin_membership,
  jsonb_build_object(
    'sub', profile.auth_user_id,
    'role', 'authenticated',
    'platform_role', membership."current_role",
    'platform_access_version', profile.access_version,
    'platform_organization_id', membership.organization_id,
    'platform_membership_id', membership.id,
    'platform_bundle_id', bundle.id,
    'platform_bundle_version', bundle.version
  )::TEXT AS p6c_admin_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
  AND profile.status = 'active'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
  AND bundle.status = 'published'
\gset

SELECT
  membership.id AS p6c_sales_membership,
  jsonb_build_object(
    'sub', profile.auth_user_id,
    'role', 'authenticated',
    'platform_role', membership."current_role",
    'platform_access_version', profile.access_version,
    'platform_organization_id', membership.organization_id,
    'platform_membership_id', membership.id,
    'platform_bundle_id', bundle.id,
    'platform_bundle_version', bundle.version
  )::TEXT AS p6c_sales_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
  AND membership.organization_id = :'p6c_org_a'
  AND profile.status = 'active'
  AND membership.status = 'active'
  AND membership."current_role" = 'sales'
  AND bundle.status = 'published'
\gset

SELECT membership.organization_id AS p6c_org_b
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
  AND profile.status = 'active'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
\gset

SELECT EXISTS (
  SELECT 1
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = :'p6c_org_a'
    AND conversation.queue = 'curator'
    AND conversation.student_case_id IS NOT NULL
) AS p6c_has_target
\gset
\if :p6c_has_target
\else
  \echo 'FAIL: migration 106 behavioral proof lacks a curator conversation fixture'
  SELECT 1 / 0;
\endif

SELECT
  conversation.id AS p6c_conversation,
  conversation.student_case_id AS p6c_student_case
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'p6c_org_a'
  AND conversation.queue = 'curator'
  AND conversation.student_case_id IS NOT NULL
ORDER BY conversation.id
LIMIT 1
\gset

\set p6c_client '10600000-0000-4000-8000-000000000101'
\set p6c_lead '10600000-0000-4000-8000-000000000102'

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES (
  :'p6c_client',
  :'p6c_org_a',
  'P6C Command Context Client',
  'p6c command context client'
);

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state
) VALUES (
  :'p6c_lead',
  :'p6c_org_a',
  :'p6c_client',
  :'p6c_sales_membership',
  'qualified',
  'p6c_command_context',
  'open'
);

UPDATE platform.communication_conversations
SET
  canonical_client_id = :'p6c_client',
  canonical_lead_id = :'p6c_lead'
WHERE organization_id = :'p6c_org_a'
  AND id = :'p6c_conversation';

SET request.jwt.claims TO :'p6c_admin_claims';
SET ROLE authenticated;
SELECT
  count(*)::TEXT AS p6c_visible_count,
  max(context.conversation_id::TEXT) AS p6c_visible_conversation,
  max(context.canonical_lead_id::TEXT) AS p6c_visible_lead,
  max(context.canonical_client_id::TEXT) AS p6c_visible_client,
  max(context.student_case_id::TEXT) AS p6c_visible_case
FROM platform.staff_communication_command_context(
  :'p6c_org_a',
  :'p6c_conversation'
) AS context
\gset
RESET ROLE;

SELECT pg_temp.p6c_assert(
  :'p6c_visible_count' = '1'
    AND :'p6c_visible_conversation' = :'p6c_conversation'
    AND :'p6c_visible_lead' = :'p6c_lead'
    AND :'p6c_visible_client' = :'p6c_client'
    AND :'p6c_visible_case' = :'p6c_student_case',
  'authorized Admin did not receive the one exact provider-free canonical context row'
);

-- A live Sales actor with communication.read.full still cannot read a Curator
-- conversation. This is the row-filter path: the RPC returns zero rows rather
-- than leaking identifiers or inventing a provider-derived binding.
SET request.jwt.claims TO :'p6c_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p6c_invisible_count
FROM platform.staff_communication_command_context(
  :'p6c_org_a',
  :'p6c_conversation'
)
\gset
RESET ROLE;

SELECT pg_temp.p6c_assert(
  :'p6c_invisible_count' = '0',
  'same-organization Sales actor received an unreadable Curator conversation context'
);

-- Organization mismatch and missing actor identity fail before row lookup.
SET request.jwt.claims TO :'p6c_admin_claims';
SET ROLE authenticated;
SAVEPOINT expect_p6c_foreign_org_denied;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_communication_command_context(
  :'p6c_org_b',
  :'p6c_conversation'
);
\set p6c_foreign_org_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p6c_foreign_org_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p6c_foreign_org_denied;
RESET ROLE;

SET request.jwt.claims = '{"role":"authenticated"}';
SET ROLE authenticated;
SAVEPOINT expect_p6c_missing_actor_denied;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_communication_command_context(
  :'p6c_org_a',
  :'p6c_conversation'
);
\set p6c_missing_actor_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p6c_missing_actor_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p6c_missing_actor_denied;
RESET ROLE;

-- The SQL grant boundary also denies an anonymous invocation outright.
SET request.jwt.claims = '{"role":"anon"}';
SET ROLE anon;
SAVEPOINT expect_p6c_anon_denied;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_communication_command_context(
  :'p6c_org_a',
  :'p6c_conversation'
);
\set p6c_anon_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p6c_anon_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p6c_anon_denied;
RESET ROLE;

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_p6c_service_denied;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_communication_command_context(
  :'p6c_org_a',
  :'p6c_conversation'
);
\set p6c_service_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p6c_service_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p6c_service_denied;
RESET ROLE;

SELECT pg_temp.p6c_assert(
  :'p6c_foreign_org_state' = '42501'
    AND :'p6c_missing_actor_state' = '42501'
    AND :'p6c_anon_state' = '42501'
    AND :'p6c_service_state' = '42501',
  'foreign-organization, missing-actor, anonymous, or service command-context access did not fail closed'
);

RESET request.jwt.claims;

ROLLBACK;

SELECT 'platform migration 106 communication command-context contract passed'
  AS result;
