\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 126. Provider calls are outside
-- this suite: every Auth row and delivery result is synthetic SQL evidence.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The lightweight authorization bootstrap intentionally models only the Auth
-- columns used before E1. Managed Supabase Auth owns these real columns; add
-- them transaction-locally so the focused suite can exercise invite evidence.
ALTER TABLE auth.users
  ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION pg_temp.p126_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 126 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p126_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_stale_outcome(
  p_receipt_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.record_student_portal_invite_failure(
    p_receipt_id, p_attempt_id, 2, 1, 'provider_timeout'
  );
  RAISE EXCEPTION 'stale terminal outcome was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'stale_invite_attempt' THEN RAISE; END IF;
END
$$;

REVOKE ALL ON FUNCTION pg_temp.p126_expect_stale_outcome(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION pg_temp.p126_expect_stale_outcome(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_claim_fence(
  p_receipt_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.claim_student_portal_invite(
    p_receipt_id, p_attempt_id, 2, 1
  );
  RAISE EXCEPTION 'second active claim was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_authority_not_ready' THEN RAISE; END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_stale_claim_replay(
  p_receipt_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.claim_student_portal_invite(
    p_receipt_id, p_attempt_id, 3, 1
  );
  RAISE EXCEPTION 'superseded claim replay was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'stale_invite_attempt' THEN RAISE; END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_stale_generation(
  p_receipt_id UUID,
  p_attempt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.record_student_portal_invite_success(
    p_receipt_id, p_attempt_id, 2, 0,
    '61260000-0000-4000-8000-000000000040', 3600
  );
  RAISE EXCEPTION 'stale invite generation was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'stale_invite_generation' THEN RAISE; END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_finalizer_identity_conflict(
  p_receipt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.finalize_student_portal_authority(
    p_receipt_id, p_expected_receipt_version, p_expected_invite_generation
  );
  RAISE EXCEPTION 'finalizer identity conflict was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_identity_conflict' THEN RAISE; END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_staff_profile_conflict(
  p_organization_id UUID,
  p_member_auth_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.provision_pilot_staff_member(
    p_organization_id, p_member_auth_user_id, 'P126 Student', 'sales',
    'Migration 126 legacy profile conflict',
    '61260000-0000-4000-8000-000000000055'
  );
  RAISE EXCEPTION 'legacy profile conflict was accepted';
EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM <> 'Existing Platform profile is blocked or has a different display name' THEN
    RAISE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_staff_membership_conflict(
  p_organization_id UUID,
  p_member_auth_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.provision_pilot_staff_member(
    p_organization_id, p_member_auth_user_id, 'P126 Student', 'sales',
    'Migration 126 legacy membership conflict',
    '61260000-0000-4000-8000-000000000056'
  );
  RAISE EXCEPTION 'legacy membership conflict was accepted';
EXCEPTION WHEN SQLSTATE '23505' THEN
  IF SQLERRM <> 'A membership for this profile and organization already exists' THEN
    RAISE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_uncovered_no_issuance(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT,
  p_auth_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.reconcile_student_portal_invite(
    p_receipt_id, p_attempt_id,
    p_expected_receipt_version, p_expected_invite_generation,
    p_auth_user_id, 3600, TRUE,
    statement_timestamp() - INTERVAL '1 day',
    'provider_no_issuance'
  );
  RAISE EXCEPTION 'pre-claim provider upper bound was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_invite_no_issuance_unproven' THEN RAISE; END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p126_expect_late_invite_failure(
  p_receipt_id UUID,
  p_attempt_id UUID,
  p_expected_receipt_version BIGINT,
  p_expected_invite_generation BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM platform.record_student_portal_invite_failure(
    p_receipt_id, p_attempt_id,
    p_expected_receipt_version, p_expected_invite_generation,
    'provider_rejected'
  );
  RAISE EXCEPTION 'late invite failure was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'stale_invite_attempt' THEN RAISE; END IF;
END
$$;

REVOKE ALL ON FUNCTION
  pg_temp.p126_expect_claim_fence(UUID, UUID),
  pg_temp.p126_expect_stale_claim_replay(UUID, UUID),
  pg_temp.p126_expect_stale_generation(UUID, UUID),
  pg_temp.p126_expect_finalizer_identity_conflict(UUID, BIGINT, BIGINT),
  pg_temp.p126_expect_staff_profile_conflict(UUID, UUID),
  pg_temp.p126_expect_staff_membership_conflict(UUID, UUID),
  pg_temp.p126_expect_uncovered_no_issuance(UUID, UUID, BIGINT, BIGINT, UUID),
  pg_temp.p126_expect_late_invite_failure(UUID, UUID, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  pg_temp.p126_expect_claim_fence(UUID, UUID),
  pg_temp.p126_expect_stale_claim_replay(UUID, UUID),
  pg_temp.p126_expect_stale_generation(UUID, UUID),
  pg_temp.p126_expect_finalizer_identity_conflict(UUID, BIGINT, BIGINT),
  pg_temp.p126_expect_uncovered_no_issuance(UUID, UUID, BIGINT, BIGINT, UUID),
  pg_temp.p126_expect_late_invite_failure(UUID, UUID, BIGINT, BIGINT)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  pg_temp.p126_expect_staff_profile_conflict(UUID, UUID),
  pg_temp.p126_expect_staff_membership_conflict(UUID, UUID)
  TO authenticated;

-- The provider-facing durable state remains private even from authenticated
-- staff and the Auth hook role. All mutation is through narrow RPC grants.
DO $catalog_contract$
DECLARE
  function_name TEXT;
  function_oid OID;
  authenticated_functions TEXT[] := ARRAY[
    'provision_pilot_staff_member(uuid,uuid,text,platform.business_role,text,uuid)',
    'assign_organization_scope(uuid,uuid,text,uuid)',
    'assign_student_case_curator(uuid,uuid,uuid,text,uuid)',
    'prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)',
    'authorize_student_portal_invite_reissue(uuid,bigint,bigint,uuid,text)'
  ];
  service_functions TEXT[] := ARRAY[
    'claim_student_portal_invite(uuid,uuid,bigint,bigint)',
    'claim_student_portal_invite_reissue(uuid,uuid,uuid,bigint,bigint)',
    'record_student_portal_invite_success(uuid,uuid,bigint,bigint,uuid,integer)',
    'record_student_portal_invite_failure(uuid,uuid,bigint,bigint,text)',
    'record_student_portal_invite_unknown(uuid,uuid,bigint,bigint,text)',
    'reconcile_student_portal_invite(uuid,uuid,bigint,bigint,uuid,integer,boolean,timestamp with time zone,text)',
    'finalize_student_portal_authority(uuid,bigint,bigint)',
    'record_student_portal_invite_accepted(uuid,bigint,bigint)',
    'resolve_student_portal_invite_identity(uuid,text,boolean)'
  ];
  blocked_functions TEXT[] := ARRAY[
    'platform.provision_member(uuid,uuid,text,platform.business_role,text,uuid)',
    'platform_private.provision_member_authorized_e1(uuid,uuid,text,platform.business_role,text,uuid,uuid,uuid)',
    'platform_private.assign_organization_scope_authorized_e1(uuid,uuid,text,uuid,uuid,uuid)',
    'platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)',
    'platform_private.accept_student_portal_invite_e1(uuid,timestamp with time zone)'
  ];
BEGIN
  IF NOT (
    SELECT pg_catalog.bool_and(
      class.relrowsecurity
      AND class.relforcerowsecurity
      AND NOT pg_catalog.has_table_privilege('anon', class.oid, 'SELECT')
      AND NOT pg_catalog.has_table_privilege('authenticated', class.oid, 'SELECT')
      AND NOT pg_catalog.has_table_privilege('service_role', class.oid, 'SELECT')
      AND NOT pg_catalog.has_table_privilege('supabase_auth_admin', class.oid, 'SELECT')
    )
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND class.relname IN (
        'student_portal_provisioning_receipts',
        'student_portal_invite_attempts'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 126 private table RLS or ACL drifted';
  END IF;

  FOREACH function_name IN ARRAY authenticated_functions LOOP
    function_oid := pg_catalog.to_regprocedure('platform.' || function_name)::OID;
    IF function_oid IS NULL
      OR NOT pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('supabase_auth_admin', function_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'Migration 126 authenticated RPC grant drifted: %', function_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY blocked_functions LOOP
    function_oid := pg_catalog.to_regprocedure(function_name)::OID;
    IF function_oid IS NULL
      OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('supabase_auth_admin', function_oid, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS routine,
             pg_catalog.aclexplode(
               COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
             ) AS privilege
        WHERE routine.oid = function_oid
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'Migration 126 blocked routine grant drifted: %', function_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY service_functions LOOP
    function_oid := pg_catalog.to_regprocedure('platform.' || function_name)::OID;
    IF function_oid IS NULL
      OR NOT pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('supabase_auth_admin', function_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'Migration 126 service RPC grant drifted: %', function_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname IN ('platform', 'platform_private')
      AND (
        routine.proname LIKE '%student_portal%'
        OR routine.proname IN (
          'provision_member_authorized_e1',
          'assign_organization_scope_authorized_e1',
          'assign_student_case_curator_authorized_e1'
        )
      )
      AND (
        routine.prosecdef IS FALSE
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION 'Migration 126 SECURITY DEFINER hardening drifted';
  END IF;
END
$catalog_contract$;

\set p126_org 61260000-0000-4000-8000-000000000001
\set p126_org_scope 61260000-0000-4000-8000-000000000002
\set p126_case 61260000-0000-4000-8000-000000000003
\set p126_case_scope 61260000-0000-4000-8000-000000000004
\set p126_case_two 61260000-0000-4000-8000-000000000005
\set p126_case_two_scope 61260000-0000-4000-8000-000000000006
\set p126_case_three 61260000-0000-4000-8000-000000000007
\set p126_case_three_scope 61260000-0000-4000-8000-000000000008
\set p126_admin_user 61260000-0000-4000-8000-000000000010
\set p126_admin_profile 61260000-0000-4000-8000-000000000011
\set p126_admin_membership 61260000-0000-4000-8000-000000000012
\set p126_sales_user 61260000-0000-4000-8000-000000000020
\set p126_sales_profile 61260000-0000-4000-8000-000000000021
\set p126_sales_membership 61260000-0000-4000-8000-000000000022
\set p126_curator_user 61260000-0000-4000-8000-000000000030
\set p126_curator_profile 61260000-0000-4000-8000-000000000031
\set p126_curator_membership 61260000-0000-4000-8000-000000000032
\set p126_student_user 61260000-0000-4000-8000-000000000040
\set p126_request 61260000-0000-4000-8000-000000000050
\set p126_attempt 61260000-0000-4000-8000-000000000051
\set p126_attempt_two 61260000-0000-4000-8000-000000000052
\set p126_student_profile_seed 61260000-0000-4000-8000-000000000053
\set p126_student_membership_seed 61260000-0000-4000-8000-000000000054
\set p126_admin_scope_event 61260000-0000-4000-8000-000000000060
\set p126_admin_scope_request 61260000-0000-4000-8000-000000000061

SELECT bundle.id AS p126_admin_bundle, bundle.version AS p126_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'membership.provision', 'scope.manage', 'case.curator.assign'
    ]::TEXT[]) AS required(permission_key)
    WHERE NOT EXISTS (
      SELECT 1 FROM platform.role_bundle_permissions AS permission
      WHERE permission.bundle_id = bundle.id
        AND permission.bundle_role = bundle.role
        AND permission.permission_key = required.permission_key
    )
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p126_sales_bundle, bundle.version AS p126_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p126_curator_bundle, bundle.version AS p126_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p126_student_bundle, bundle.version AS p126_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES (:'p126_org', 'Migration 126 synthetic organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p126_org_scope', :'p126_org', 'organization', :'p126_org', 1),
  (:'p126_case_scope', :'p126_org', 'student_case', :'p126_case', 1),
  (:'p126_case_two_scope', :'p126_org', 'student_case', :'p126_case_two', 1),
  (:'p126_case_three_scope', :'p126_org', 'student_case', :'p126_case_three', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p126_admin_user', 'p126-admin@example.invalid', '{}'::JSONB),
  (:'p126_sales_user', 'p126-sales@example.invalid', '{}'::JSONB),
  (:'p126_curator_user', 'p126-curator@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p126_admin_profile', :'p126_admin_user', 'P126 Admin', 'active', 1),
  (:'p126_sales_profile', :'p126_sales_user', 'P126 Sales', 'active', 1),
  (:'p126_curator_profile', :'p126_curator_user', 'P126 Curator', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (
    :'p126_admin_membership', :'p126_org', :'p126_admin_profile',
    'active', 'admin', :'p126_admin_bundle'
  ),
  (
    :'p126_sales_membership', :'p126_org', :'p126_sales_profile',
    'active', 'sales', :'p126_sales_bundle'
  ),
  (
    :'p126_curator_membership', :'p126_org', :'p126_curator_profile',
    'active', 'curator', :'p126_curator_bundle'
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  :'p126_admin_scope_event', :'p126_org', :'p126_admin_membership',
  :'p126_org_scope', 1, 1, TRUE, 'system', NULL,
  'Migration 126 Admin organization scope', :'p126_admin_scope_request'
);

-- U6 normally creates this shape through its own proven handoff coordinator.
-- The E1 suite isolates migration 126, so it bypasses only the insert-time
-- transition trigger while preserving every table constraint.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, closed_at, next_action,
  current_scope_id, current_scope_version
) VALUES
  (
    :'p126_case', :'p126_org', NULL,
    :'p126_sales_membership', :'p126_curator_membership',
    'synthetic:p126:case', 'contract:p126', statement_timestamp(),
    'P126 Student', 'United Kingdom', 'Bachelor', 'Business', '2027',
    'approved', 'admissions_active', 'active', statement_timestamp(),
    NULL, NULL, 'Provision portal', :'p126_case_scope', 1
  ),
  (
    :'p126_case_two', :'p126_org', NULL,
    :'p126_sales_membership', :'p126_curator_membership',
    'synthetic:p126:case-two', 'contract:p126:two', statement_timestamp(),
    'P126 Student Two', 'Canada', 'Master', 'Engineering', '2027',
    'approved', 'admissions_active', 'active', statement_timestamp(),
    NULL, NULL, 'Provision portal', :'p126_case_two_scope', 1
  ),
  (
    :'p126_case_three', :'p126_org', NULL,
    :'p126_sales_membership', :'p126_curator_membership',
    'synthetic:p126:case-three', 'contract:p126:three', statement_timestamp(),
    'P126 Acceptance Student', 'Germany', 'Master', 'Data Science', '2027',
    'approved', 'admissions_active', 'active', statement_timestamp(),
    NULL, NULL, 'Provision portal', :'p126_case_three_scope', 1
  );
SET LOCAL session_replication_role = origin;

SELECT jsonb_build_object(
  'sub', :'p126_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p126_org',
  'platform_membership_id', :'p126_admin_membership',
  'platform_bundle_id', :'p126_admin_bundle',
  'platform_bundle_version', :'p126_admin_version'::INTEGER
)::TEXT AS p126_admin_claims
\gset

SELECT jsonb_build_object(
  'sub', :'p126_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p126_org',
  'platform_membership_id', :'p126_sales_membership',
  'platform_bundle_id', :'p126_sales_bundle',
  'platform_bundle_version', :'p126_sales_version'::INTEGER
)::TEXT AS p126_sales_claims
\gset

SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;

SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_case', ' P126-STUDENT@Example.Invalid ',
  ' P126 Student ', 'normal_u6', NULL,
  'Migration 126 initial preparation', :'p126_request'
)::TEXT AS p126_prepared
\gset

SELECT pg_temp.p126_assert(
  :'p126_prepared'::JSONB ->> 'provisioning_state' = 'prepared'
  AND :'p126_prepared'::JSONB ->> 'receipt_version' = '1'
  AND :'p126_prepared'::JSONB ->> 'invite_generation' = '0'
  AND :'p126_prepared'::JSONB ->> 'replayed' = 'false',
  'prepare did not create the expected initial receipt'
);
SELECT pg_temp.p126_assert(
  NOT (:'p126_prepared'::JSONB ? 'normalized_email')
  AND NOT (:'p126_prepared'::JSONB ? 'fingerprint_sha256')
  AND NOT (:'p126_prepared'::JSONB ? 'authorizing_auth_user_id'),
  'authenticated preparation leaked private or PII fields'
);

SELECT (:'p126_prepared'::JSONB ->> 'receipt_id') AS p126_receipt
\gset

SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_case', 'p126-student@example.invalid',
  'P126 Student', 'normal_u6', NULL,
  'Migration 126 initial preparation', :'p126_request'
)::TEXT AS p126_prepare_replay
\gset

SELECT pg_temp.p126_assert(
  :'p126_prepare_replay'::JSONB ->> 'replayed' = 'true'
  AND :'p126_prepare_replay'::JSONB ->> 'receipt_id' = :'p126_receipt',
  'same-request prepare did not replay the durable result'
);

DO $prepare_conflict$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    '61260000-0000-4000-8000-000000000001',
    '61260000-0000-4000-8000-000000000003',
    'p126-student@example.invalid',
    'Different shape', 'normal_u6', NULL,
    'Migration 126 initial preparation',
    '61260000-0000-4000-8000-000000000050'
  );
  RAISE EXCEPTION 'prepare conflict was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'request_replay_conflict' THEN RAISE; END IF;
END
$prepare_conflict$;

RESET ROLE;
SET request.jwt.claims TO :'p126_sales_claims';
SET ROLE authenticated;
DO $non_admin_denied$
BEGIN
  PERFORM platform.prepare_student_portal_provisioning(
    '61260000-0000-4000-8000-000000000001',
    '61260000-0000-4000-8000-000000000005',
    'p126-denied@example.invalid',
    'Denied Student', 'normal_u6', NULL,
    'Migration 126 non-Admin denial', gen_random_uuid()
  );
  RAISE EXCEPTION 'non-Admin preparation was accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$non_admin_denied$;

RESET ROLE;
SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p126_receipt', :'p126_attempt', 1, 0
)::TEXT AS p126_claimed
\gset

SELECT pg_temp.p126_assert(
  :'p126_claimed'::JSONB ->> 'provisioning_state' = 'dispatching'
  AND :'p126_claimed'::JSONB ->> 'receipt_version' = '2'
  AND :'p126_claimed'::JSONB ->> 'invite_generation' = '1'
  AND :'p126_claimed'::JSONB ->> 'normalized_email'
    = 'p126-student@example.invalid',
  'service claim did not return its fenced dispatch envelope'
);

SELECT platform.claim_student_portal_invite(
  :'p126_receipt', :'p126_attempt', 1, 0
)::TEXT AS p126_claim_replay
\gset
SELECT pg_temp.p126_assert(
  :'p126_claim_replay'::JSONB ->> 'replayed' = 'true',
  'same-attempt claim did not replay'
);
SELECT pg_temp.p126_expect_claim_fence(
  :'p126_receipt', :'p126_attempt_two'
);
SELECT pg_temp.p126_expect_stale_generation(:'p126_receipt', :'p126_attempt');

SELECT platform.record_student_portal_invite_failure(
  :'p126_receipt', :'p126_attempt', 2, 1, 'provider_rejected'
);
SELECT platform.claim_student_portal_invite(
  :'p126_receipt', :'p126_attempt_two', 3, 1
)::TEXT AS p126_second_claim
\gset
SELECT pg_temp.p126_expect_stale_claim_replay(
  :'p126_receipt', :'p126_attempt'
);
SELECT pg_temp.p126_assert(
  :'p126_second_claim'::JSONB ->> 'attempt_id' = :'p126_attempt_two'
  AND :'p126_second_claim'::JSONB ->> 'receipt_version' = '4'
  AND :'p126_second_claim'::JSONB ->> 'invite_generation' = '2',
  'definite initial failure did not fence a new attempt'
);

RESET ROLE;
INSERT INTO auth.users (
  id, email, raw_user_meta_data, confirmation_sent_at
)
VALUES (
  :'p126_student_user', 'p126-student@example.invalid', '{}'::JSONB,
  statement_timestamp()
);

SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p126_receipt', :'p126_attempt_two', 4, 2, :'p126_student_user', 3600
)::TEXT AS p126_succeeded
\gset
SELECT pg_temp.p126_assert(
  :'p126_succeeded'::JSONB ->> 'provisioning_state' = 'invite_succeeded'
  AND :'p126_succeeded'::JSONB ->> 'receipt_version' = '5',
  'invite success did not advance the fenced receipt'
);

SELECT pg_temp.p126_expect_stale_outcome(:'p126_receipt', :'p126_attempt');

-- The shared core preserves the existing staff-wrapper SQLSTATE/messages,
-- while the receipt finalizer translates the same data conflicts to E1's
-- bounded portal_identity_conflict contract.
RESET ROLE;
INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES (
  :'p126_student_profile_seed', :'p126_student_user',
  'P126 Conflicting Name', 'active', 1
);
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p126_expect_staff_profile_conflict(
  :'p126_org', :'p126_student_user'
);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p126_expect_finalizer_identity_conflict(
  :'p126_receipt', 5, 2
);
RESET ROLE;
UPDATE platform.profiles
SET display_name = 'P126 Student'
WHERE id = :'p126_student_profile_seed';
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES (
  :'p126_student_membership_seed', :'p126_org', :'p126_student_profile_seed',
  'active', 'student', :'p126_student_bundle'
);
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p126_expect_staff_membership_conflict(
  :'p126_org', :'p126_student_user'
);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.p126_expect_finalizer_identity_conflict(
  :'p126_receipt', 5, 2
);
RESET ROLE;
DELETE FROM platform.organization_memberships
WHERE id = :'p126_student_membership_seed';
DELETE FROM platform.profiles
WHERE id = :'p126_student_profile_seed';
SET ROLE service_role;

SELECT platform.finalize_student_portal_authority(
  :'p126_receipt', 5, 2
)::TEXT AS p126_finalized
\gset
SELECT pg_temp.p126_assert(
  :'p126_finalized'::JSONB ->> 'provisioning_state' = 'authority_activated'
  AND :'p126_finalized'::JSONB ->> 'authority_activated' = 'true'
  AND :'p126_finalized'::JSONB ->> 'replayed' = 'false',
  'finalizer did not activate Student authority'
);

SELECT platform.finalize_student_portal_authority(
  :'p126_receipt', 5, 2
)::TEXT AS p126_finalize_replay
\gset
SELECT pg_temp.p126_assert(
  :'p126_finalize_replay'::JSONB ->> 'replayed' = 'true'
  AND :'p126_finalize_replay'::JSONB ->> 'student_membership_id'
    = :'p126_finalized'::JSONB ->> 'student_membership_id',
  'same receipt/generation finalizer replay was not durable'
);

SET ROLE service_role;
SELECT platform.resolve_student_portal_invite_identity(
  :'p126_student_user', ' P126-STUDENT@example.invalid ', FALSE
)::TEXT AS p126_resolved_identity
\gset
SELECT pg_temp.p126_assert(
  (SELECT pg_catalog.count(*) = 7
   FROM jsonb_object_keys(:'p126_resolved_identity'::JSONB))
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_object_keys(:'p126_resolved_identity'::JSONB) AS result(key)
    WHERE result.key <> ALL (ARRAY[
      'receipt_id', 'provisioning_state', 'invite_delivery_status',
      'receipt_version', 'invite_generation', 'authority_activated',
      'account_pending'
    ]::TEXT[])
  )
  AND :'p126_resolved_identity'::JSONB ->> 'receipt_id' = :'p126_receipt'
  AND :'p126_resolved_identity'::JSONB ->> 'authority_activated' = 'true'
  AND :'p126_resolved_identity'::JSONB ->> 'account_pending' = 'false',
  'identity resolver response exceeded its bounded contract'
);
RESET ROLE;

RESET ROLE;

SELECT pg_temp.p126_assert(
  (
    SELECT student_membership_id IS NOT NULL
      AND portal_activated_at IS NOT NULL
    FROM platform.student_cases WHERE id = :'p126_case'
  ),
  'finalizer did not bind the Student membership to the case'
);
SELECT pg_temp.p126_assert(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform.audit_events
    WHERE action = 'student.portal.authority.activate'
      AND resource_id = :'p126_case'
  ),
  'finalizer did not emit exactly one safe activation audit'
);
SELECT pg_temp.p126_assert(
  (
    SELECT pg_catalog.count(*) = 2
    FROM platform.membership_scope_assignments
    WHERE membership_id = (:'p126_finalized'::JSONB ->> 'student_membership_id')::UUID
  )
  AND (
    SELECT access_version = 3
    FROM platform.profiles
    WHERE id = (:'p126_finalized'::JSONB ->> 'student_profile_id')::UUID
  )
  AND NOT EXISTS (
    SELECT request_id
    FROM platform.audit_events
    WHERE request_id = ANY (ARRAY[
      platform_private.student_portal_child_request_id(
        :'p126_request', '01-membership-provision'
      ),
      platform_private.student_portal_child_request_id(
        :'p126_request', '02-organization-scope'
      ),
      platform_private.student_portal_child_request_id(
        :'p126_request', '03-student-case-scope'
      ),
      platform_private.student_portal_child_request_id(
        :'p126_request', '05-student-portal-audit'
      )
    ]::UUID[])
    GROUP BY request_id
    HAVING pg_catalog.count(*) <> 1
  ),
  'finalizer replay duplicated scope/audit rows or access-version bumps'
);
SELECT pg_temp.p126_assert(
  NOT EXISTS (
    SELECT 1 FROM platform.audit_events
    WHERE request_id = platform_private.student_portal_child_request_id(
      :'p126_request', '05-student-portal-audit'
    )
      AND (
        after_state ? 'normalized_email'
        OR after_state ? 'fingerprint_sha256'
        OR after_state::TEXT LIKE '%p126-student@example.invalid%'
      )
  ),
  'activation audit leaked email or private receipt evidence'
);

DO $identity_immutable$
BEGIN
  UPDATE platform.student_cases SET student_membership_id = NULL
  WHERE id = '61260000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'Student identity unbind was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_identity_conflict' THEN RAISE; END IF;
END
$identity_immutable$;

DO $identity_rebind_immutable$
BEGIN
  UPDATE platform.student_cases
  SET student_membership_id = '61260000-0000-4000-8000-000000000012'
  WHERE id = '61260000-0000-4000-8000-000000000003';
  RAISE EXCEPTION 'Student identity rebind was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_identity_conflict' THEN RAISE; END IF;
END
$identity_rebind_immutable$;

DO $identity_unreserved_bind_denied$
BEGIN
  UPDATE platform.student_cases
  SET student_membership_id = '61260000-0000-4000-8000-000000000032'
  WHERE id = '61260000-0000-4000-8000-000000000005';
  RAISE EXCEPTION 'Unreserved Student identity bind was accepted';
EXCEPTION WHEN SQLSTATE '40001' THEN
  IF SQLERRM <> 'portal_identity_conflict' THEN RAISE; END IF;
END
$identity_unreserved_bind_denied$;

-- A forced error after prepare proves no half-prepared receipt survives the
-- PostgreSQL subtransaction.
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
DO $rollback_atomicity$
BEGIN
  BEGIN
    PERFORM platform.prepare_student_portal_provisioning(
      '61260000-0000-4000-8000-000000000001',
      '61260000-0000-4000-8000-000000000005',
      'p126-rollback@example.invalid',
      'Rollback Student', 'normal_u6', NULL,
      'Migration 126 rollback proof',
      '61260000-0000-4000-8000-000000000070'
    );
    RAISE EXCEPTION 'p126_forced_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'p126_forced_rollback' THEN RAISE; END IF;
  END;
END
$rollback_atomicity$;
RESET ROLE;

SELECT pg_temp.p126_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_provisioning_receipts
    WHERE request_id = '61260000-0000-4000-8000-000000000070'
  ),
  'failed preparation left a partial receipt'
);

-- Reissue is a separately Admin-authorized generation. An unknown provider
-- outcome stays fenced until later Auth evidence proves the newer issuance.
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_case_two', 'p126-reissue@example.invalid',
  'P126 Reissue Student', 'normal_u6', NULL,
  'Migration 126 reissue preparation',
  '61260000-0000-4000-8000-000000000080'
)::TEXT AS p126_reissue_prepared
\gset
RESET ROLE;
SELECT :'p126_reissue_prepared'::JSONB ->> 'receipt_id' AS p126_reissue_receipt
\gset

SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000081', 1, 0
);
RESET ROLE;
INSERT INTO auth.users (
  id, email, raw_user_meta_data, confirmation_sent_at
) VALUES (
  '61260000-0000-4000-8000-000000000082',
  'p126-reissue@example.invalid', '{}'::JSONB, statement_timestamp()
);
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000081', 2, 1,
  '61260000-0000-4000-8000-000000000082', 3600
);
RESET ROLE;
UPDATE platform_private.student_portal_provisioning_receipts
SET invite_issued_at = statement_timestamp() - INTERVAL '2 hours',
    invite_expires_at = statement_timestamp() - INTERVAL '1 hour'
WHERE id = :'p126_reissue_receipt';

SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT platform.authorize_student_portal_invite_reissue(
  :'p126_reissue_receipt', 3, 1,
  '61260000-0000-4000-8000-000000000083',
  'Migration 126 expired invite reissue'
)::TEXT AS p126_reissue_authorized
\gset
SELECT platform.authorize_student_portal_invite_reissue(
  :'p126_reissue_receipt', 3, 1,
  '61260000-0000-4000-8000-000000000083',
  'Migration 126 expired invite reissue'
)::TEXT AS p126_reissue_authorized_replay
\gset
SELECT pg_temp.p126_assert(
  :'p126_reissue_authorized'::JSONB ->> 'receipt_version' = '4'
  AND :'p126_reissue_authorized'::JSONB ->> 'reissue_request_id'
    = '61260000-0000-4000-8000-000000000083'
  AND :'p126_reissue_authorized_replay'::JSONB ->> 'replayed' = 'true',
  'reissue authorization did not preserve same-request replay'
);
RESET ROLE;

SET ROLE service_role;
SELECT platform.claim_student_portal_invite_reissue(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000083',
  '61260000-0000-4000-8000-000000000084', 4, 1
)::TEXT AS p126_reissue_claimed
\gset
SELECT platform.record_student_portal_invite_failure(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000084', 5, 2,
  'provider_rejected'
)::TEXT AS p126_reissue_failed
\gset
SELECT platform.claim_student_portal_invite_reissue(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000083',
  '61260000-0000-4000-8000-000000000085', 6, 2
)::TEXT AS p126_reissue_retry_claimed
\gset
SELECT platform.record_student_portal_invite_unknown(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000085', 7, 3,
  'provider_outcome_unknown'
)::TEXT AS p126_reissue_unknown
\gset
SELECT pg_temp.p126_expect_uncovered_no_issuance(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000085', 8, 3,
  '61260000-0000-4000-8000-000000000082'
);
RESET ROLE;
UPDATE auth.users
SET confirmation_sent_at = confirmation_sent_at + INTERVAL '1 minute'
WHERE id = '61260000-0000-4000-8000-000000000082';
SET ROLE service_role;
SELECT platform.reconcile_student_portal_invite(
  :'p126_reissue_receipt',
  '61260000-0000-4000-8000-000000000085', 8, 3,
  '61260000-0000-4000-8000-000000000082', 3600,
  FALSE, NULL, NULL
)::TEXT AS p126_reissue_reconciled
\gset
SELECT pg_temp.p126_assert(
  :'p126_reissue_claimed'::JSONB ->> 'invite_generation' = '2'
  AND :'p126_reissue_failed'::JSONB ->> 'invite_delivery_status'
    = 'reissue_failed'
  AND :'p126_reissue_retry_claimed'::JSONB ->> 'invite_generation' = '3'
  AND :'p126_reissue_unknown'::JSONB ->> 'invite_delivery_status'
    = 'reissue_unknown'
  AND :'p126_reissue_reconciled'::JSONB ->> 'provisioning_state'
    = 'invite_succeeded'
  AND :'p126_reissue_reconciled'::JSONB ->> 'receipt_version' = '9',
  'unknown reissue outcome did not recover from newer Auth evidence'
);
RESET ROLE;
SELECT pg_temp.p126_assert(
  (
    SELECT pg_catalog.count(*) = 2
    FROM platform_private.student_portal_invite_attempts
    WHERE receipt_id = :'p126_reissue_receipt'
      AND reissue_request_id = '61260000-0000-4000-8000-000000000083'
  ),
  'definite reissue failure did not preserve same-authorization retry history'
);

-- Auth confirmation may arrive from an older valid token while a reissue is
-- dispatching. Acceptance settles and fences the active attempt atomically;
-- a late provider result is stale and finalization remains possible.
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_case_three', 'p126-acceptance@example.invalid',
  'P126 Acceptance Student', 'normal_u6', NULL,
  'Migration 126 concurrent acceptance preparation',
  '61260000-0000-4000-8000-000000000090'
)::TEXT AS p126_acceptance_prepared
\gset
RESET ROLE;
SELECT :'p126_acceptance_prepared'::JSONB ->> 'receipt_id'
  AS p126_acceptance_receipt
\gset
SET ROLE service_role;
SELECT platform.claim_student_portal_invite(
  :'p126_acceptance_receipt',
  '61260000-0000-4000-8000-000000000091', 1, 0
);
RESET ROLE;
INSERT INTO auth.users (
  id, email, raw_user_meta_data, confirmation_sent_at
) VALUES (
  '61260000-0000-4000-8000-000000000092',
  'p126-acceptance@example.invalid', '{}'::JSONB, statement_timestamp()
);
SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(
  :'p126_acceptance_receipt',
  '61260000-0000-4000-8000-000000000091', 2, 1,
  '61260000-0000-4000-8000-000000000092', 3600
);
RESET ROLE;
UPDATE platform_private.student_portal_provisioning_receipts
SET invite_issued_at = statement_timestamp() - INTERVAL '2 hours',
    invite_expires_at = statement_timestamp() - INTERVAL '1 hour'
WHERE id = :'p126_acceptance_receipt';
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT platform.authorize_student_portal_invite_reissue(
  :'p126_acceptance_receipt', 3, 1,
  '61260000-0000-4000-8000-000000000093',
  'Migration 126 concurrent acceptance reissue'
);
RESET ROLE;
SET ROLE service_role;
SELECT platform.claim_student_portal_invite_reissue(
  :'p126_acceptance_receipt',
  '61260000-0000-4000-8000-000000000093',
  '61260000-0000-4000-8000-000000000094', 4, 1
);
RESET ROLE;
UPDATE auth.users
SET email_confirmed_at = statement_timestamp()
WHERE id = '61260000-0000-4000-8000-000000000092';
SET ROLE service_role;
SELECT platform.resolve_student_portal_invite_identity(
  '61260000-0000-4000-8000-000000000092',
  'p126-acceptance@example.invalid', TRUE
)::TEXT AS p126_acceptance_resolved
\gset
SELECT pg_temp.p126_expect_late_invite_failure(
  :'p126_acceptance_receipt',
  '61260000-0000-4000-8000-000000000094', 5, 2
);
RESET ROLE;
SELECT pg_temp.p126_assert(
  :'p126_acceptance_resolved'::JSONB ->> 'invite_delivery_status' = 'accepted'
  AND :'p126_acceptance_resolved'::JSONB ->> 'receipt_version' = '6'
  AND (SELECT active_attempt_id IS NULL
       FROM platform_private.student_portal_provisioning_receipts
       WHERE id = :'p126_acceptance_receipt')
  AND (SELECT attempt_state = 'succeeded'
       FROM platform_private.student_portal_invite_attempts
       WHERE id = '61260000-0000-4000-8000-000000000094'),
  'acceptance did not atomically settle the active reissue attempt'
);
SET ROLE service_role;
SELECT platform.finalize_student_portal_authority(
  :'p126_acceptance_receipt', 6, 2
)::TEXT AS p126_acceptance_finalized
\gset
SELECT pg_temp.p126_assert(
  :'p126_acceptance_finalized'::JSONB ->> 'provisioning_state'
    = 'authority_activated',
  'confirmed acceptance did not remain finalizable'
);
RESET ROLE;

COMMIT;

-- -------------------------------------------------------------------------
-- Real two-session serialization probes. These fixtures are committed only
-- so independent dblink sessions can observe them; exact-row cleanup follows.
-- -------------------------------------------------------------------------
BEGIN;

\set p126_org_two 61260000-0000-4000-8000-000000000100
\set p126_org_two_scope 61260000-0000-4000-8000-000000000101
\set p126_admin_two_user 61260000-0000-4000-8000-000000000110
\set p126_admin_two_profile 61260000-0000-4000-8000-000000000111
\set p126_admin_two_membership 61260000-0000-4000-8000-000000000112
\set p126_sales_two_user 61260000-0000-4000-8000-000000000120
\set p126_sales_two_profile 61260000-0000-4000-8000-000000000121
\set p126_sales_two_membership 61260000-0000-4000-8000-000000000122
\set p126_curator_two_user 61260000-0000-4000-8000-000000000130
\set p126_curator_two_profile 61260000-0000-4000-8000-000000000131
\set p126_curator_two_membership 61260000-0000-4000-8000-000000000132
\set p126_observer_user 61260000-0000-4000-8000-000000000140
\set p126_observer_profile 61260000-0000-4000-8000-000000000141
\set p126_observer_membership 61260000-0000-4000-8000-000000000142

\set p126_legacy_a_case 61260000-0000-4000-8000-000000000200
\set p126_legacy_a_scope 61260000-0000-4000-8000-000000000201
\set p126_legacy_a_request 61260000-0000-4000-8000-000000000210
\set p126_legacy_a_attempt 61260000-0000-4000-8000-000000000211
\set p126_legacy_a_student 61260000-0000-4000-8000-000000000212
\set p126_legacy_b_case 61260000-0000-4000-8000-000000000220
\set p126_legacy_b_scope 61260000-0000-4000-8000-000000000221
\set p126_legacy_b_request 61260000-0000-4000-8000-000000000230
\set p126_legacy_b_attempt 61260000-0000-4000-8000-000000000231
\set p126_legacy_b_student 61260000-0000-4000-8000-000000000232
\set p126_scope_case 61260000-0000-4000-8000-000000000240
\set p126_scope_case_scope 61260000-0000-4000-8000-000000000241
\set p126_scope_request 61260000-0000-4000-8000-000000000250
\set p126_scope_attempt 61260000-0000-4000-8000-000000000251
\set p126_scope_student 61260000-0000-4000-8000-000000000252
\set p126_email_case_one 61260000-0000-4000-8000-000000000260
\set p126_email_scope_one 61260000-0000-4000-8000-000000000261
\set p126_email_case_two 61260000-0000-4000-8000-000000000270
\set p126_email_scope_two 61260000-0000-4000-8000-000000000271

INSERT INTO platform.organizations (id, name)
VALUES (:'p126_org_two', 'Migration 126 second synthetic organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p126_org_two_scope', :'p126_org_two', 'organization', :'p126_org_two', 1),
  (:'p126_legacy_a_scope', :'p126_org', 'student_case', :'p126_legacy_a_case', 1),
  (:'p126_legacy_b_scope', :'p126_org', 'student_case', :'p126_legacy_b_case', 1),
  (:'p126_scope_case_scope', :'p126_org', 'student_case', :'p126_scope_case', 1),
  (:'p126_email_scope_one', :'p126_org', 'student_case', :'p126_email_case_one', 1),
  (:'p126_email_scope_two', :'p126_org_two', 'student_case', :'p126_email_case_two', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p126_admin_two_user', 'p126-admin-two@example.invalid', '{}'::JSONB),
  (:'p126_sales_two_user', 'p126-sales-two@example.invalid', '{}'::JSONB),
  (:'p126_curator_two_user', 'p126-curator-two@example.invalid', '{}'::JSONB),
  (:'p126_observer_user', 'p126-observer@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p126_admin_two_profile', :'p126_admin_two_user', 'P126 Admin Two', 'active', 1),
  (:'p126_sales_two_profile', :'p126_sales_two_user', 'P126 Sales Two', 'active', 1),
  (:'p126_curator_two_profile', :'p126_curator_two_user', 'P126 Curator Two', 'active', 1),
  (:'p126_observer_profile', :'p126_observer_user', 'P126 Observer', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p126_admin_two_membership', :'p126_org_two', :'p126_admin_two_profile', 'active', 'admin', :'p126_admin_bundle'),
  (:'p126_sales_two_membership', :'p126_org_two', :'p126_sales_two_profile', 'active', 'sales', :'p126_sales_bundle'),
  (:'p126_curator_two_membership', :'p126_org_two', :'p126_curator_two_profile', 'active', 'curator', :'p126_curator_bundle'),
  (:'p126_observer_membership', :'p126_org', :'p126_observer_profile', 'active', 'sales', :'p126_sales_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  '61260000-0000-4000-8000-000000000150', :'p126_org_two',
  :'p126_admin_two_membership', :'p126_org_two_scope', 1, 1, TRUE,
  'system', NULL, 'Migration 126 second Admin scope',
  '61260000-0000-4000-8000-000000000151'
);

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, closed_at, next_action,
  current_scope_id, current_scope_version
) VALUES
  (:'p126_legacy_a_case', :'p126_org', NULL, :'p126_sales_membership', NULL,
   'synthetic:p126:legacy-a', 'contract:p126:legacy-a', statement_timestamp(),
   'P126 Legacy A', 'United Kingdom', 'Bachelor', 'Business', '2027',
   'approved', 'contract_confirmed', 'pending', NULL, NULL, NULL,
   'Provision legacy portal A', :'p126_legacy_a_scope', 1),
  (:'p126_legacy_b_case', :'p126_org', NULL, :'p126_sales_membership', NULL,
   'synthetic:p126:legacy-b', 'contract:p126:legacy-b', statement_timestamp(),
   'P126 Legacy B', 'United Kingdom', 'Bachelor', 'Business', '2027',
   'approved', 'contract_confirmed', 'pending', NULL, NULL, NULL,
   'Provision legacy portal B', :'p126_legacy_b_scope', 1),
  (:'p126_scope_case', :'p126_org', NULL, :'p126_sales_membership', :'p126_curator_membership',
   'synthetic:p126:scope-race', 'contract:p126:scope-race', statement_timestamp(),
   'P126 Scope Race', 'United Kingdom', 'Bachelor', 'Business', '2027',
   'approved', 'admissions_active', 'active', statement_timestamp(), NULL, NULL,
   'Provision scope race', :'p126_scope_case_scope', 1),
  (:'p126_email_case_one', :'p126_org', NULL, :'p126_sales_membership', :'p126_curator_membership',
   'synthetic:p126:email-one', 'contract:p126:email-one', statement_timestamp(),
   'P126 Email One', 'United Kingdom', 'Bachelor', 'Business', '2027',
   'approved', 'admissions_active', 'active', statement_timestamp(), NULL, NULL,
   'Reserve global email', :'p126_email_scope_one', 1),
  (:'p126_email_case_two', :'p126_org_two', NULL, :'p126_sales_two_membership', :'p126_curator_two_membership',
   'synthetic:p126:email-two', 'contract:p126:email-two', statement_timestamp(),
   'P126 Email Two', 'Canada', 'Master', 'Engineering', '2027',
   'approved', 'admissions_active', 'active', statement_timestamp(), NULL, NULL,
   'Reserve global email', :'p126_email_scope_two', 1);
SET LOCAL session_replication_role = origin;

SELECT jsonb_build_object(
  'sub', :'p126_admin_two_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p126_org_two',
  'platform_membership_id', :'p126_admin_two_membership',
  'platform_bundle_id', :'p126_admin_bundle',
  'platform_bundle_version', :'p126_admin_version'::INTEGER
)::TEXT AS p126_admin_two_claims
\gset

-- Prepare three receipts that the race probes will finalize.
SET request.jwt.claims TO :'p126_admin_claims';
SET ROLE authenticated;
SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_legacy_a_case', 'p126-legacy-a@example.invalid',
  'P126 Legacy A', 'legacy_pending', :'p126_curator_membership',
  'Migration 126 legacy race A', :'p126_legacy_a_request'
)::TEXT AS p126_legacy_a_prepared
\gset
SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_legacy_b_case', 'p126-legacy-b@example.invalid',
  'P126 Legacy B', 'legacy_pending', :'p126_curator_membership',
  'Migration 126 legacy race B', :'p126_legacy_b_request'
)::TEXT AS p126_legacy_b_prepared
\gset
SELECT platform.prepare_student_portal_provisioning(
  :'p126_org', :'p126_scope_case', 'p126-scope-race@example.invalid',
  'P126 Scope Race', 'normal_u6', NULL,
  'Migration 126 scope race', :'p126_scope_request'
)::TEXT AS p126_scope_prepared
\gset
RESET ROLE;

SELECT :'p126_legacy_a_prepared'::JSONB ->> 'receipt_id' AS p126_legacy_a_receipt
\gset
SELECT :'p126_legacy_b_prepared'::JSONB ->> 'receipt_id' AS p126_legacy_b_receipt
\gset
SELECT :'p126_scope_prepared'::JSONB ->> 'receipt_id' AS p126_scope_receipt
\gset

SET ROLE service_role;
SELECT platform.claim_student_portal_invite(:'p126_legacy_a_receipt', :'p126_legacy_a_attempt', 1, 0);
SELECT platform.claim_student_portal_invite(:'p126_legacy_b_receipt', :'p126_legacy_b_attempt', 1, 0);
SELECT platform.claim_student_portal_invite(:'p126_scope_receipt', :'p126_scope_attempt', 1, 0);
RESET ROLE;

INSERT INTO auth.users (
  id, email, raw_user_meta_data, confirmation_sent_at
) VALUES
  (:'p126_legacy_a_student', 'p126-legacy-a@example.invalid', '{}'::JSONB, statement_timestamp()),
  (:'p126_legacy_b_student', 'p126-legacy-b@example.invalid', '{}'::JSONB, statement_timestamp()),
  (:'p126_scope_student', 'p126-scope-race@example.invalid', '{}'::JSONB, statement_timestamp());

SET ROLE service_role;
SELECT platform.record_student_portal_invite_success(:'p126_legacy_a_receipt', :'p126_legacy_a_attempt', 2, 1, :'p126_legacy_a_student', 3600);
SELECT platform.record_student_portal_invite_success(:'p126_legacy_b_receipt', :'p126_legacy_b_attempt', 2, 1, :'p126_legacy_b_student', 3600);
SELECT platform.record_student_portal_invite_success(:'p126_scope_receipt', :'p126_scope_attempt', 2, 1, :'p126_scope_student', 3600);
RESET ROLE;
COMMIT;

DROP SCHEMA IF EXISTS p126_test_extensions CASCADE;
CREATE SCHEMA p126_test_extensions;
CREATE EXTENSION dblink WITH SCHEMA p126_test_extensions;

SET ROLE supabase_admin;
SELECT p126_test_extensions.dblink_connect(
  'p126_a', 'host=127.0.0.1 dbname=' || current_database() || ' user=postgres'
);
SELECT p126_test_extensions.dblink_connect(
  'p126_b', 'host=127.0.0.1 dbname=' || current_database() || ' user=postgres'
);
SELECT p126_test_extensions.dblink_exec(
  'p126_a', 'SET lock_timeout = ''5s'''
);
SELECT p126_test_extensions.dblink_exec(
  'p126_a', 'SET statement_timeout = ''15s'''
);
SELECT p126_test_extensions.dblink_exec(
  'p126_b', 'SET lock_timeout = ''5s'''
);
SELECT p126_test_extensions.dblink_exec(
  'p126_b', 'SET statement_timeout = ''15s'''
);
RESET ROLE;

CREATE TEMP TABLE p126_race_results (
  race_name TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  result JSONB
);

-- Finalizer wins the organization domain lock; the direct curator mutation
-- then observes the already-finalized case instead of interleaving.
SELECT p126_test_extensions.dblink_send_query(
  'p126_a',
  format($sql$
    WITH locked AS MATERIALIZED (
      SELECT platform_private.lock_student_case_note_assignment_domain(%L::UUID)
    ), paused AS MATERIALIZED (
      SELECT pg_catalog.pg_sleep(0.4) FROM locked
    )
    SELECT platform.finalize_student_portal_authority(%L::UUID, 3, 1)
    FROM paused
  $sql$, :'p126_org', :'p126_legacy_a_receipt')
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT p126_test_extensions.dblink_send_query(
  'p126_b',
  format($sql$
    WITH configured AS MATERIALIZED (
      SELECT pg_catalog.set_config('request.jwt.claims', %L, TRUE)
    )
    SELECT platform.assign_student_case_curator(
      %L::UUID, %L::UUID, %L::UUID,
      'Migration 126 direct curator after finalizer', %L::UUID
    ) FROM configured
  $sql$, :'p126_admin_claims', :'p126_org', :'p126_legacy_a_case',
    :'p126_curator_membership', '61260000-0000-4000-8000-000000000280')
);
INSERT INTO p126_race_results
SELECT 'finalizer_first', 'finalizer', outcome
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_a') AS p126_finalizer_first_a_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
INSERT INTO p126_race_results
SELECT 'finalizer_first', 'curator', outcome
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_b') AS p126_finalizer_first_b_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);

SELECT pg_temp.p126_assert(
  (SELECT pg_catalog.count(*) = 1 FROM p126_race_results WHERE race_name = 'finalizer_first' AND worker_name = 'finalizer')
  AND :'p126_finalizer_first_a_error' = 'OK'
  AND :'p126_finalizer_first_b_error' <> 'OK'
  AND (SELECT provisioning_state = 'authority_activated' FROM platform_private.student_portal_provisioning_receipts WHERE id = :'p126_legacy_a_receipt'),
  'finalizer-first curator race did not serialize fail-closed'
);

-- Direct curator takes the lock first. Its attempt cannot activate a portal
-- without the Student membership, rolls back, and the waiting finalizer wins.
SELECT p126_test_extensions.dblink_send_query(
  'p126_a',
  format($sql$
    WITH configured AS MATERIALIZED (
      SELECT pg_catalog.set_config('request.jwt.claims', %L, TRUE)
    ), locked AS MATERIALIZED (
      SELECT platform_private.lock_student_case_note_assignment_domain(%L::UUID)
      FROM configured
    ), paused AS MATERIALIZED (
      SELECT pg_catalog.pg_sleep(0.4) FROM locked
    )
    SELECT platform.assign_student_case_curator(
      %L::UUID, %L::UUID, %L::UUID,
      'Migration 126 direct curator before finalizer', %L::UUID
    ) FROM paused
  $sql$, :'p126_admin_claims', :'p126_org', :'p126_org', :'p126_legacy_b_case',
    :'p126_curator_membership', '61260000-0000-4000-8000-000000000281')
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT p126_test_extensions.dblink_send_query(
  'p126_b',
  format(
    'SELECT platform.finalize_student_portal_authority(%L::UUID, 3, 1)',
    :'p126_legacy_b_receipt'
  )
);
INSERT INTO p126_race_results
SELECT 'curator_first', 'curator', outcome
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_a') AS p126_curator_first_a_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
INSERT INTO p126_race_results
SELECT 'curator_first', 'finalizer', outcome
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_b') AS p126_curator_first_b_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);

SELECT pg_temp.p126_assert(
  :'p126_curator_first_a_error' <> 'OK'
  AND :'p126_curator_first_b_error' = 'OK'
  AND (SELECT provisioning_state = 'authority_activated' FROM platform_private.student_portal_provisioning_receipts WHERE id = :'p126_legacy_b_receipt'),
  'curator-first finalizer race did not roll back and serialize'
);

-- An unrelated direct organization-scope mutation shares the same domain
-- lock. Both serialized operations succeed without a deadlock or lost bump.
SELECT p126_test_extensions.dblink_send_query(
  'p126_a',
  format($sql$
    WITH locked AS MATERIALIZED (
      SELECT platform_private.lock_student_case_note_assignment_domain(%L::UUID)
    ), paused AS MATERIALIZED (
      SELECT pg_catalog.pg_sleep(0.4) FROM locked
    )
    SELECT platform.finalize_student_portal_authority(%L::UUID, 3, 1)
    FROM paused
  $sql$, :'p126_org', :'p126_scope_receipt')
);
SELECT pg_catalog.pg_sleep(0.1);
SELECT p126_test_extensions.dblink_send_query(
  'p126_b',
  format($sql$
    WITH configured AS MATERIALIZED (
      SELECT pg_catalog.set_config('request.jwt.claims', %L, TRUE)
    )
    SELECT platform.assign_organization_scope(
      %L::UUID, %L::UUID,
      'Migration 126 direct scope race', %L::UUID
    ) FROM configured
  $sql$, :'p126_admin_claims', :'p126_org', :'p126_observer_membership',
    '61260000-0000-4000-8000-000000000282')
);
INSERT INTO p126_race_results
SELECT 'scope', 'finalizer', outcome
FROM p126_test_extensions.dblink_get_result('p126_a') AS result(outcome JSONB);
INSERT INTO p126_race_results
SELECT 'scope', 'scope', outcome
FROM p126_test_extensions.dblink_get_result('p126_b') AS result(outcome JSONB);
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);

SELECT pg_temp.p126_assert(
  (SELECT pg_catalog.count(*) = 2 FROM p126_race_results WHERE race_name = 'scope')
  AND (SELECT provisioning_state = 'authority_activated' FROM platform_private.student_portal_provisioning_receipts WHERE id = :'p126_scope_receipt')
  AND (
    SELECT assignment.granted
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.membership_id = :'p126_observer_membership'
      AND assignment.scope_id = :'p126_org_scope'
    ORDER BY assignment.assignment_version DESC LIMIT 1
  ),
  'finalizer/direct-scope race deadlocked or lost authority'
);

-- Two organizations race for one normalized email. The global unique
-- reservation permits exactly one receipt and returns a safe conflict to the
-- loser; it never creates two cross-organization identities.
SELECT p126_test_extensions.dblink_send_query(
  'p126_a',
  format($sql$
    WITH configured AS MATERIALIZED (
      SELECT pg_catalog.set_config('request.jwt.claims', %L, TRUE)
    )
    SELECT platform.prepare_student_portal_provisioning(
      %L::UUID, %L::UUID, 'p126-global-race@example.invalid',
      'P126 Email One', 'normal_u6', NULL,
      'Migration 126 global email race', %L::UUID
    ) FROM configured
  $sql$, :'p126_admin_claims', :'p126_org', :'p126_email_case_one',
    '61260000-0000-4000-8000-000000000290')
);
SELECT p126_test_extensions.dblink_send_query(
  'p126_b',
  format($sql$
    WITH configured AS MATERIALIZED (
      SELECT pg_catalog.set_config('request.jwt.claims', %L, TRUE)
    )
    SELECT platform.prepare_student_portal_provisioning(
      %L::UUID, %L::UUID, 'P126-GLOBAL-RACE@example.invalid',
      'P126 Email Two', 'normal_u6', NULL,
      'Migration 126 global email race', %L::UUID
    ) FROM configured
  $sql$, :'p126_admin_two_claims', :'p126_org_two', :'p126_email_case_two',
    '61260000-0000-4000-8000-000000000291')
);
INSERT INTO p126_race_results
SELECT 'email', 'org_one', outcome
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_a') AS p126_email_a_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_a', FALSE)
  AS result(outcome JSONB);
INSERT INTO p126_race_results
SELECT 'email', 'org_two', outcome
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);
SELECT p126_test_extensions.dblink_error_message('p126_b') AS p126_email_b_error
\gset
SELECT pg_catalog.count(*)
FROM p126_test_extensions.dblink_get_result('p126_b', FALSE)
  AS result(outcome JSONB);

SELECT pg_temp.p126_assert(
  (SELECT pg_catalog.count(*) = 1 FROM p126_race_results WHERE race_name = 'email')
  AND (SELECT pg_catalog.count(*) = 1 FROM platform_private.student_portal_provisioning_receipts WHERE normalized_email = 'p126-global-race@example.invalid')
  AND ((:'p126_email_a_error' = 'OK') <> (:'p126_email_b_error' = 'OK')),
  'cross-organization normalized-email race did not select one winner'
);

SELECT p126_test_extensions.dblink_disconnect('p126_a');
SELECT p126_test_extensions.dblink_disconnect('p126_b');
DROP EXTENSION dblink;
DROP SCHEMA p126_test_extensions;

-- Remove only the committed migration-126 fixtures. The disposable harness
-- must expose the same empty boundary to the remaining authorization suites.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM platform_private.student_portal_invite_attempts
WHERE receipt_id IN (
  SELECT id FROM platform_private.student_portal_provisioning_receipts
  WHERE organization_id IN (:'p126_org', :'p126_org_two')
);
DELETE FROM platform_private.student_portal_provisioning_receipts
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.audit_events
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.student_case_assignment_events
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.student_case_lifecycle_events
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.membership_scope_assignments
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.membership_role_history
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.student_cases
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.organization_memberships
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.record_scopes
WHERE organization_id IN (:'p126_org', :'p126_org_two');
DELETE FROM platform.profiles
WHERE auth_user_id::TEXT LIKE '61260000-0000-4000-8000-%';
DELETE FROM auth.users
WHERE id::TEXT LIKE '61260000-0000-4000-8000-%';
DELETE FROM platform.organizations
WHERE id IN (:'p126_org', :'p126_org_two');
SELECT pg_temp.p126_assert(
  NOT EXISTS (
    SELECT 1 FROM platform_private.student_portal_provisioning_receipts
    WHERE organization_id IN (:'p126_org', :'p126_org_two')
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.membership_role_history
    WHERE organization_id IN (:'p126_org', :'p126_org_two')
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.organization_memberships
    WHERE organization_id IN (:'p126_org', :'p126_org_two')
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.profiles
    WHERE auth_user_id::TEXT LIKE '61260000-0000-4000-8000-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id::TEXT LIKE '61260000-0000-4000-8000-%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.organizations
    WHERE id IN (:'p126_org', :'p126_org_two')
  ),
  'committed migration-126 fixtures were not cleaned exactly'
);
SET LOCAL session_replication_role = origin;
ALTER TABLE auth.users
  DROP COLUMN confirmation_sent_at,
  DROP COLUMN email_confirmed_at,
  DROP COLUMN confirmed_at;
COMMIT;
