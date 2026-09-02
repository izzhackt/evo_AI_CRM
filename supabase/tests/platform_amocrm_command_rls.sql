\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5C assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS p5c_org_a,
  membership.id AS p5c_admin_membership,
  profile.id AS p5c_admin_profile,
  profile.access_version AS p5c_admin_access_version,
  membership.current_bundle_id AS p5c_admin_bundle,
  bundle.version AS p5c_admin_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS p5c_sales_org,
  membership.id AS p5c_sales_membership,
  profile.id AS p5c_sales_profile,
  profile.access_version AS p5c_sales_access_version,
  membership.current_bundle_id AS p5c_sales_bundle,
  bundle.version AS p5c_sales_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
  AND membership.organization_id = :'p5c_org_a'
\gset

SELECT
  membership.organization_id AS p5c_curator_org,
  membership.id AS p5c_curator_membership,
  profile.id AS p5c_curator_profile,
  profile.access_version AS p5c_curator_access_version,
  membership.current_bundle_id AS p5c_curator_bundle,
  bundle.version AS p5c_curator_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
  AND membership.organization_id = :'p5c_org_a'
\gset

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES
  (
    '92000000-0000-4000-8000-000000000101',
    :'p5c_org_a',
    'P5C Client A',
    'p5c client a'
  ),
  (
    '92000000-0000-4000-8000-000000000121',
    :'p5c_org_a',
    'P5C Client B',
    'p5c client b'
  );

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state
) VALUES
  (
    '92000000-0000-4000-8000-000000000102',
    :'p5c_org_a',
    '92000000-0000-4000-8000-000000000101',
    :'p5c_sales_membership',
    'qualified',
    'p5c',
    'open'
  ),
  (
    '92000000-0000-4000-8000-000000000122',
    :'p5c_org_a',
    '92000000-0000-4000-8000-000000000121',
    :'p5c_sales_membership',
    'qualified',
    'p5c',
    'open'
  );

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES (
  '92000000-0000-4000-8000-000000000104',
  :'p5c_org_a',
  'student_case',
  '92000000-0000-4000-8000-000000000103',
  1
);

INSERT INTO platform.student_cases (
  id,
  organization_id,
  student_membership_id,
  responsible_sales_membership_id,
  current_curator_membership_id,
  source_key,
  contract_confirmation_ref,
  contract_confirmed_at,
  student_display_name,
  target_country,
  target_degree,
  route_approval_status,
  operational_stage,
  state,
  next_action,
  current_scope_id,
  current_scope_version,
  canonical_client_id,
  canonical_lead_id
) VALUES (
  '92000000-0000-4000-8000-000000000103',
  :'p5c_org_a',
  NULL,
  :'p5c_sales_membership',
  NULL,
  'canonical-lead:92000000-0000-4000-8000-000000000102',
  NULL,
  NULL,
  'P5C Student',
  NULL,
  NULL,
  'draft',
  'sales_handoff_pending',
  'pending',
  'P5C admissions active',
  '92000000-0000-4000-8000-000000000104',
  1,
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000102'
);

SELECT pg_temp.assert_true(
  to_regclass('platform_private.amocrm_command_receipts') IS NOT NULL
  AND to_regclass('platform_private.amocrm_command_attempts') IS NOT NULL
  AND to_regclass('platform_private.amocrm_contact_bindings') IS NOT NULL
  AND to_regclass('platform_private.amocrm_lead_bindings') IS NOT NULL,
  'P5C durable amoCRM runtime tables are missing'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
      'platform_private.amocrm_command_attempts'::REGCLASS
      AND attribute.attname = 'provider_dispatched_at'
      AND NOT attribute.attisdropped
  ),
  'P5C attempts must durably record the irreversible provider dispatch boundary'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid IN (
      'platform_private.amocrm_command_receipts'::REGCLASS,
      'platform_private.amocrm_command_attempts'::REGCLASS,
      'platform_private.amocrm_contact_bindings'::REGCLASS,
      'platform_private.amocrm_lead_bindings'::REGCLASS
    )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ),
  'P5C private amoCRM runtime tables must force RLS'
);

SELECT
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('{"id":700001}'::JSONB::TEXT, 'UTF8')
    ),
    'hex'
  ) AS p5c_lead_readback_sha256,
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('{"id":800001}'::JSONB::TEXT, 'UTF8')
    ),
    'hex'
  ) AS p5c_contact_readback_sha256
\gset

SET ROLE authenticated;
SELECT format(
  '{"sub":"%s","role":"authenticated","platform_role":"sales","platform_organization_id":"%s","platform_membership_id":"%s","platform_access_version":"%s","platform_bundle_id":"%s","platform_bundle_version":"%s"}',
  '4b500000-0000-4000-8000-000000000003',
  :'p5c_org_a',
  :'p5c_sales_membership',
  :'p5c_sales_access_version',
  :'p5c_sales_bundle',
  :'p5c_sales_bundle_version'
) AS p5c_sales_claims
\gset
SET request.jwt.claims TO :'p5c_sales_claims';

SELECT
  auth_user_id::TEXT AS p5c_sales_actor_user,
  profile_id::TEXT AS p5c_sales_actor_profile,
  membership_id::TEXT AS p5c_sales_actor_membership,
  organization_id::TEXT AS p5c_sales_actor_org,
  display_name AS p5c_sales_actor_name,
  platform_role::TEXT AS p5c_sales_actor_role,
  platform_access_version::TEXT AS p5c_sales_actor_access_version
FROM platform.current_actor_authority()
\gset

SELECT pg_temp.assert_true(
  :'p5c_sales_actor_user' = '4b500000-0000-4000-8000-000000000003'
  AND :'p5c_sales_actor_membership' = :'p5c_sales_membership'
  AND :'p5c_sales_actor_org' = :'p5c_org_a'
  AND :'p5c_sales_actor_role' = 'sales',
  'P5C sales claims must resolve one current actor authority before prepare'
);

SELECT pg_temp.assert_true(
  private.platform_has_permission(:'p5c_org_a', 'lead.read'),
  'P5C sales actor must hold lead.read before prepare'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    WHERE lead.organization_id = :'p5c_org_a'
      AND lead.id = '92000000-0000-4000-8000-000000000102'
      AND lead.current_owner_membership_id = :'p5c_sales_membership'
  ),
  'P5C synthetic lead must be owned by the acting sales membership'
);

SELECT pg_temp.assert_true(
  private.platform_can_read_canonical_lead(
    :'p5c_org_a',
    '92000000-0000-4000-8000-000000000102'
  ),
  'P5C sales actor must be able to read the canonical lead before prepare'
);

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_create',
  'p5c:lead-create:1',
  NULL,
  NULL,
  '{"name":"P5C Lead A"}'::JSONB
) AS p5c_prepare_first
\gset

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_create',
  'p5c:lead-create:1',
  NULL,
  NULL,
  '{"name":"P5C Lead A"}'::JSONB
) AS p5c_prepare_replay
\gset

SELECT pg_temp.assert_true(
  :'p5c_prepare_first'::JSONB ->> 'kind' = 'prepared'
  AND :'p5c_prepare_replay'::JSONB ->> 'kind' = 'replay',
  'P5C prepare must be idempotent'
);

SAVEPOINT expect_p5c_idempotency_shape_conflict;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_create',
  'p5c:lead-create:1',
  NULL,
  NULL,
  '{"name":"changed under reused idempotency key"}'::JSONB
);
\set p5c_idempotency_shape_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_idempotency_shape_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_idempotency_shape_conflict;

SELECT pg_temp.assert_true(
  :'p5c_idempotency_shape_conflict_state' = '23505',
  'P5C idempotency replay must reject any changed request shape'
);

SAVEPOINT expect_p5c_wrong_lead_target;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000122',
  'lead_note_create',
  'p5c:wrong-lead-target',
  NULL,
  '700002',
  '{"note_text":"must not cross the authorized workflow"}'::JSONB
);
\set p5c_wrong_lead_target_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_wrong_lead_target;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_wrong_lead_target;

SAVEPOINT expect_p5c_wrong_person_target;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_create',
  'p5c:wrong-person-target',
  NULL,
  NULL,
  '{"name":"must not cross the authorized workflow"}'::JSONB
);
\set p5c_wrong_person_target_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_wrong_person_target;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_wrong_person_target;

SAVEPOINT expect_p5c_wrong_person_binding_read;
\set ON_ERROR_STOP off
SELECT platform.read_staff_amocrm_bindings(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  '92000000-0000-4000-8000-000000000102'
);
\set p5c_wrong_person_binding_read_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_wrong_person_binding_read;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_wrong_person_binding_read;

SELECT pg_temp.assert_true(
  :'p5c_wrong_lead_target_state' = '42501'
  AND :'p5c_wrong_person_target_state' = '42501'
  AND :'p5c_wrong_person_binding_read_state' = '42501',
  'P5C command objects and binding reads must belong to the exact authorized canonical workflow'
);

SELECT pg_temp.assert_true(
  platform.read_staff_amocrm_bindings(
    :'p5c_org_a',
    jsonb_build_object(
      'actor_role', 'sales',
      'workflow_scope', 'sales_pre_handoff',
      'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
      'student_case_id', NULL
    ),
    NULL,
    '92000000-0000-4000-8000-000000000102'
  ) = '{"contact_id": null, "lead_id": null}'::JSONB,
  'P5C bindings should be empty before settlement'
);

\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'admissions_post_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', '92000000-0000-4000-8000-000000000103'
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_note_create',
  'p5c:forbidden',
  NULL,
  '700001',
  '{"note_text":"forbidden"}'::JSONB
);
\set p5c_forbidden_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p5c_forbidden_state' = '42501',
  'P5C sales staff must not prepare admissions-only commands'
);

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT pg_temp.assert_true(
  :'p5c_prepare_first'::JSONB -> 'attempt' ->> 'attempt_id'
    = :'p5c_prepare_replay'::JSONB -> 'attempt' ->> 'attempt_id'
  AND :'p5c_prepare_first'::JSONB -> 'attempt' ->> 'command_receipt_id'
    = :'p5c_prepare_replay'::JSONB -> 'attempt' ->> 'command_receipt_id',
  'P5C replay must return the original attempt and receipt'
);

SELECT
  (
    :'p5c_prepare_first'::JSONB -> 'attempt' ->> 'attempt_id'
  )::UUID AS p5c_attempt_id
\gset

SELECT platform.read_amocrm_command_for_reconciliation(
  :'p5c_org_a',
  :'p5c_attempt_id'
) AS p5c_reconciliation_preclaim
\gset

SAVEPOINT expect_p5c_reconciliation_wrong_org;
\set ON_ERROR_STOP off
SELECT platform.read_amocrm_command_for_reconciliation(
  '92000000-0000-4000-8000-000000000999',
  :'p5c_attempt_id'
);
\set p5c_reconciliation_wrong_org_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_reconciliation_wrong_org;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_reconciliation_wrong_org;

SAVEPOINT expect_p5c_reconciliation_missing_attempt;
\set ON_ERROR_STOP off
SELECT platform.read_amocrm_command_for_reconciliation(
  :'p5c_org_a',
  '92000000-0000-4000-8000-000000000999'
);
\set p5c_reconciliation_missing_attempt_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_reconciliation_missing_attempt;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_reconciliation_missing_attempt;

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_sales_claims';
SAVEPOINT expect_p5c_staff_reconciliation_read_denied;
\set ON_ERROR_STOP off
SELECT platform.read_amocrm_command_for_reconciliation(
  :'p5c_org_a',
  :'p5c_attempt_id'
);
\set p5c_staff_reconciliation_read_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_staff_reconciliation_read_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_staff_reconciliation_read_denied;

RESET ROLE;
SET ROLE anon;
SET request.jwt.claims = '{"role":"anon"}';
SAVEPOINT expect_p5c_anon_reconciliation_read_denied;
\set ON_ERROR_STOP off
SELECT platform.read_amocrm_command_for_reconciliation(
  :'p5c_org_a',
  :'p5c_attempt_id'
);
\set p5c_anon_reconciliation_read_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_anon_reconciliation_read_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_anon_reconciliation_read_denied;

RESET ROLE;
SELECT pg_temp.assert_true(
  :'p5c_reconciliation_preclaim'::JSONB -> 'payload'
    = '{"name":"P5C Lead A"}'::JSONB
  AND :'p5c_reconciliation_preclaim'::JSONB ->> 'status' = 'prepared'
  AND :'p5c_reconciliation_preclaim'::JSONB ? 'dispatch_request_id'
  AND NOT (:'p5c_prepare_first'::JSONB -> 'attempt' ? 'payload')
  AND :'p5c_reconciliation_wrong_org_state' = '02000'
  AND :'p5c_reconciliation_missing_attempt_state' = '02000'
  AND :'p5c_staff_reconciliation_read_state' = '42501'
  AND :'p5c_anon_reconciliation_read_state' = '42501'
  AND has_function_privilege(
    'service_role',
    'platform.read_amocrm_command_for_reconciliation(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.read_amocrm_command_for_reconciliation(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.read_amocrm_command_for_reconciliation(uuid,uuid)',
    'EXECUTE'
  ),
  'P5C reconciliation input must be exact-organization, service-only, and preserve the original private payload'
);

SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000110',
  'p5c-worker',
  120
) AS p5c_claimed
\gset

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000110',
  'p5c-worker',
  120
) AS p5c_claim_replay
\gset

SAVEPOINT expect_p5c_claim_request_conflict;
\set ON_ERROR_STOP off
SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000110',
  'changed-worker',
  120
);
\set p5c_claim_request_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_claim_request_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_claim_request_conflict;

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000111',
  'p5c-worker',
  120
) AS p5c_claim_blocked
\gset

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_sales_claims';

SELECT platform.read_staff_blocking_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102'
) AS p5c_claim_blocking_attempt
\gset

SAVEPOINT expect_p5c_claimed_target_blocked;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_create',
  'p5c:lead-create:after-claim',
  NULL,
  NULL,
  '{"name":"P5C Lead A duplicate"}'::JSONB
);
\set p5c_claimed_target_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_claimed_target_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_claimed_target_blocked;

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT pg_temp.assert_true(
  :'p5c_claimed'::JSONB ->> 'kind' = 'claimed'
  AND :'p5c_claimed'::JSONB -> 'attempt' ->> 'status' = 'unknown'
  AND :'p5c_claimed'::JSONB -> 'attempt' ->> 'provider_dispatched_at' IS NOT NULL
  AND :'p5c_claim_replay'::JSONB ->> 'kind' = 'replay'
  AND :'p5c_claim_request_conflict_state' = '23505'
  AND :'p5c_claim_blocked'::JSONB ->> 'kind' = 'blocked'
  AND :'p5c_claim_blocking_attempt'::JSONB ->> 'attempt_id' = :'p5c_attempt_id'
  AND :'p5c_claim_blocking_attempt'::JSONB ->> 'status' = 'unknown'
  AND :'p5c_claimed_target_blocked_state' = '55000',
  'P5C claim must atomically become blocking ambiguity and only exact same-request replay is safe'
);

SELECT pg_temp.assert_true(
  platform.read_amocrm_command_for_reconciliation(
    :'p5c_org_a',
    :'p5c_attempt_id'
  ) -> 'payload' = '{"name":"P5C Lead A"}'::JSONB
  AND platform.read_amocrm_command_for_reconciliation(
    :'p5c_org_a',
    :'p5c_attempt_id'
  ) ->> 'dispatch_request_id'
    = '92000000-0000-4000-8000-000000000110',
  'P5C reconciliation read must preserve the originally dispatched command and claim evidence'
);

RESET ROLE;
UPDATE platform_private.amocrm_command_attempts
SET
  dispatch_claimed_at = statement_timestamp() - INTERVAL '2 minutes',
  provider_dispatched_at = statement_timestamp() - INTERVAL '2 minutes',
  dispatch_lease_expires_at = statement_timestamp() - INTERVAL '1 minute'
WHERE organization_id = :'p5c_org_a'
  AND id = :'p5c_attempt_id';
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000114',
  'p5c-worker-after-expiry',
  120
) AS p5c_expired_claim_blocked
\gset

SELECT pg_temp.assert_true(
  :'p5c_expired_claim_blocked'::JSONB ->> 'kind' = 'blocked',
  'P5C lease expiry must never reopen an irreversible provider dispatch'
);

SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000112',
  'unknown',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'provider_timeout'
) AS p5c_unknown_finish
\gset

SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000112',
  'unknown',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'provider_timeout'
) AS p5c_finish_replay
\gset

SAVEPOINT expect_p5c_finish_request_conflict;
\set ON_ERROR_STOP off
SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000112',
  'unknown',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'changed_failure'
);
\set p5c_finish_request_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_finish_request_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_finish_request_conflict;

SAVEPOINT expect_p5c_second_finish_blocked;
\set ON_ERROR_STOP off
SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000115',
  'rejected',
  'provider-request-1',
  400,
  NULL,
  statement_timestamp(),
  NULL,
  NULL,
  'provider_rejected'
);
\set p5c_second_finish_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_second_finish_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_second_finish_blocked;

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000116',
  'p5c-worker-after-unknown',
  120
) AS p5c_unknown_claim_blocked
\gset

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000110',
  'p5c-worker',
  120
) AS p5c_terminal_claim_replay
\gset

SELECT pg_temp.assert_true(
  :'p5c_unknown_finish'::JSONB -> 'attempt' ->> 'status' = 'unknown'
  AND :'p5c_finish_replay'::JSONB ->> 'kind' = 'replay'
  AND :'p5c_finish_request_conflict_state' = '23505'
  AND :'p5c_second_finish_blocked_state' = '55000'
  AND :'p5c_unknown_claim_blocked'::JSONB ->> 'kind' = 'blocked'
  AND :'p5c_terminal_claim_replay'::JSONB ->> 'kind' = 'replay',
  'P5C finish and claim transitions must stay one-way after unknown'
);

RESET ROLE;
SET ROLE authenticated;
SELECT format(
  '{"sub":"%s","role":"authenticated","platform_role":"admin","platform_organization_id":"%s","platform_membership_id":"%s","platform_access_version":"%s","platform_bundle_id":"%s","platform_bundle_version":"%s"}',
  '10000000-0000-4000-8000-000000000001',
  :'p5c_org_a',
  :'p5c_admin_membership',
  :'p5c_admin_access_version',
  :'p5c_admin_bundle',
  :'p5c_admin_bundle_version'
) AS p5c_admin_claims
\gset
SET request.jwt.claims TO :'p5c_admin_claims';

SELECT platform.read_staff_blocking_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'admissions',
    'workflow_scope', 'admissions_post_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', '92000000-0000-4000-8000-000000000103'
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102'
) AS p5c_blocking_attempt
\gset

SELECT pg_temp.assert_true(
  :'p5c_blocking_attempt'::JSONB ->> 'attempt_id' = :'p5c_attempt_id'
  AND :'p5c_blocking_attempt'::JSONB ->> 'status' = 'unknown',
  'P5C admissions read should surface the latest blocking attempt'
);

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT
  statement_timestamp()::TEXT AS p5c_provider_responded_at,
  statement_timestamp()::TEXT AS p5c_provider_readback_at
\gset

SAVEPOINT expect_p5c_invalid_reconcile_result;
\set ON_ERROR_STOP off
SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000117',
  'accepted',
  '{"id":700001}'::JSONB,
  :'p5c_provider_readback_at'::TIMESTAMPTZ,
  :'p5c_provider_responded_at'::TIMESTAMPTZ,
  '800001',
  '700001',
  NULL
);
\set p5c_invalid_reconcile_result_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_invalid_reconcile_result;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_invalid_reconcile_result;

SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000113',
  'accepted',
  '{"id":700001}'::JSONB,
  :'p5c_provider_readback_at'::TIMESTAMPTZ + INTERVAL '1 second',
  :'p5c_provider_responded_at'::TIMESTAMPTZ + INTERVAL '1 second',
  NULL,
  '700001',
  NULL
) AS p5c_reconciled
\gset

SELECT pg_temp.assert_true(
  :'p5c_invalid_reconcile_result_state' = '22023'
  AND :'p5c_reconciled'::JSONB -> 'attempt' ->> 'status' = 'accepted'
  AND platform.read_amocrm_command_for_reconciliation(
    :'p5c_org_a',
    :'p5c_attempt_id'
  ) ->> 'provider_readback_sha256' = :'p5c_lead_readback_sha256',
  'P5C reconcile must validate result shape and derive its readback hash before resolving ambiguity'
);

SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000113',
  'accepted',
  '{"id":700001}'::JSONB,
  :'p5c_provider_readback_at'::TIMESTAMPTZ,
  :'p5c_provider_responded_at'::TIMESTAMPTZ,
  NULL,
  '700001',
  NULL
) AS p5c_reconcile_replay
\gset

SAVEPOINT expect_p5c_reconcile_request_conflict;
\set ON_ERROR_STOP off
SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000113',
  'accepted',
  '{"id":700001,"changed":true}'::JSONB,
  :'p5c_provider_readback_at'::TIMESTAMPTZ,
  :'p5c_provider_responded_at'::TIMESTAMPTZ,
  NULL,
  '700001',
  NULL
);
\set p5c_reconcile_request_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_reconcile_request_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_reconcile_request_conflict;

SAVEPOINT expect_p5c_terminal_reconcile_blocked;
\set ON_ERROR_STOP off
SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_attempt_id',
  '92000000-0000-4000-8000-000000000118',
  'unchanged',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'still_unknown'
);
\set p5c_terminal_reconcile_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_terminal_reconcile_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_terminal_reconcile_blocked;

SELECT pg_temp.assert_true(
  :'p5c_reconcile_replay'::JSONB ->> 'kind' = 'replay'
  AND :'p5c_reconcile_request_conflict_state' = '23505'
  AND :'p5c_terminal_reconcile_blocked_state' = '55000',
  'P5C reconciliation must replay the same semantic result despite fresh observation timestamps and never reopen a terminal attempt'
);

SELECT pg_temp.assert_true(
  platform.read_amocrm_command_by_idempotency_key(
    :'p5c_org_a',
    'p5c:lead-create:1'
  ) ->> 'result_lead_id' = '700001',
  'P5C service replay lookup must return the settled attempt'
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_admin_claims';

SELECT pg_temp.assert_true(
  platform.read_staff_amocrm_bindings(
    :'p5c_org_a',
    jsonb_build_object(
      'actor_role', 'admissions',
      'workflow_scope', 'admissions_post_handoff',
      'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
      'student_case_id', '92000000-0000-4000-8000-000000000103'
    ),
    NULL,
    '92000000-0000-4000-8000-000000000102'
  ) ->> 'lead_id' = '700001',
  'P5C accepted lead operations must surface the provider binding to staff'
);

SAVEPOINT expect_p5c_existing_lead_create_conflict;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_create',
  'p5c:existing-lead-create',
  NULL,
  NULL,
  '{"name":"must not replace an existing lead binding"}'::JSONB
);
\set p5c_existing_lead_create_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_existing_lead_create_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_existing_lead_create_conflict;

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_note_create',
  'p5c:lead-note:local-rejection',
  NULL,
  '700001',
  '{"note_text":"must not leave the server without a token"}'::JSONB
) AS p5c_local_rejection_prepare
\gset

SELECT (
  :'p5c_local_rejection_prepare'::JSONB -> 'attempt' ->> 'attempt_id'
)::UUID AS p5c_local_rejection_attempt_id
\gset

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_local_rejection_attempt_id',
  '92000000-0000-4000-8000-000000000130',
  'p5c-local-rejection-worker',
  120
) AS p5c_local_rejection_claim
\gset

SAVEPOINT expect_p5c_http_5xx_rejected_invalid;
\set ON_ERROR_STOP off
SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_local_rejection_attempt_id',
  '92000000-0000-4000-8000-000000000131',
  'rejected',
  'provider-request-5xx',
  503,
  NULL,
  statement_timestamp(),
  NULL,
  NULL,
  'provider_5xx'
);
\set p5c_http_5xx_rejected_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_http_5xx_rejected_invalid;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_http_5xx_rejected_invalid;

SAVEPOINT expect_p5c_unsafe_local_rejection_invalid;
\set ON_ERROR_STOP off
SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_local_rejection_attempt_id',
  '92000000-0000-4000-8000-000000000133',
  'rejected',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'provider_unavailable'
);
\set p5c_unsafe_local_rejection_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_unsafe_local_rejection_invalid;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_unsafe_local_rejection_invalid;

SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_local_rejection_attempt_id',
  '92000000-0000-4000-8000-000000000132',
  'rejected',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'token_unavailable'
) AS p5c_local_rejection_finished
\gset

SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_local_rejection_attempt_id',
  '92000000-0000-4000-8000-000000000132',
  'rejected',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'token_unavailable'
) AS p5c_local_rejection_replay
\gset

SELECT pg_temp.assert_true(
  :'p5c_http_5xx_rejected_state' = '22023'
  AND :'p5c_unsafe_local_rejection_state' = '22023'
  AND :'p5c_local_rejection_claim'::JSONB ->> 'kind' = 'claimed'
  AND :'p5c_local_rejection_finished'::JSONB -> 'attempt' ->> 'status'
    = 'rejected'
  AND :'p5c_local_rejection_replay'::JSONB ->> 'kind' = 'replay'
  AND platform.read_amocrm_command_for_reconciliation(
    :'p5c_org_a',
    :'p5c_local_rejection_attempt_id'
  ) @> '{
    "status":"rejected",
    "provider_request_id":null,
    "provider_http_status":null,
    "provider_readback":null,
    "provider_responded_at":null,
    "result_contact_id":null,
    "result_lead_id":null,
    "failure_code":"token_unavailable"
  }'::JSONB,
  'P5C local pre-transport rejection must settle deterministically while provider 5xx remains unknown-only'
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_admin_claims';

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_create',
  'p5c:contact-create:1',
  NULL,
  NULL,
  '{"name":"P5C Client B"}'::JSONB
) AS p5c_contact_prepare
\gset

SELECT (
  :'p5c_contact_prepare'::JSONB -> 'attempt' ->> 'attempt_id'
)::UUID AS p5c_contact_attempt_id
\gset

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SAVEPOINT expect_p5c_unclaimed_finish_blocked;
\set ON_ERROR_STOP off
SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_attempt_id',
  '92000000-0000-4000-8000-000000000123',
  'accepted',
  'provider-request-contact-create',
  200,
  '{"id":800001}'::JSONB,
  statement_timestamp(),
  '800001',
  NULL,
  NULL
);
\set p5c_unclaimed_finish_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_unclaimed_finish_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_unclaimed_finish_blocked;

SAVEPOINT expect_p5c_prepared_reconcile_blocked;
\set ON_ERROR_STOP off
SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_attempt_id',
  '92000000-0000-4000-8000-000000000124',
  'unchanged',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'not_unknown'
);
\set p5c_prepared_reconcile_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_prepared_reconcile_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_prepared_reconcile_blocked;

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_attempt_id',
  '92000000-0000-4000-8000-000000000125',
  'p5c-contact-worker',
  120
) AS p5c_contact_claim
\gset

SELECT statement_timestamp()::TEXT AS p5c_contact_responded_at
\gset

SELECT platform.finish_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_attempt_id',
  '92000000-0000-4000-8000-000000000126',
  'accepted',
  'provider-request-contact-create',
  200,
  '{"id":800001}'::JSONB,
  :'p5c_contact_responded_at'::TIMESTAMPTZ,
  '800001',
  NULL,
  NULL
) AS p5c_contact_finished
\gset

SELECT pg_temp.assert_true(
  :'p5c_existing_lead_create_conflict_state' = '23505'
  AND :'p5c_unclaimed_finish_blocked_state' = '55000'
  AND :'p5c_prepared_reconcile_blocked_state' = '55000'
  AND :'p5c_contact_claim'::JSONB ->> 'kind' = 'claimed'
  AND :'p5c_contact_finished'::JSONB -> 'attempt' ->> 'status' = 'accepted'
  AND platform.read_amocrm_command_for_reconciliation(
    :'p5c_org_a',
    :'p5c_contact_attempt_id'
  ) ->> 'provider_readback_sha256' = :'p5c_contact_readback_sha256',
  'P5C create bindings, lifecycle transitions, and database-derived readback hashes must fail closed'
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_admin_claims';

SAVEPOINT expect_p5c_existing_contact_create_conflict;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_create',
  'p5c:existing-contact-create',
  NULL,
  NULL,
  '{"name":"must not replace an existing contact binding"}'::JSONB
);
\set p5c_existing_contact_create_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_existing_contact_create_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_existing_contact_create_conflict;

SAVEPOINT expect_p5c_wrong_contact_binding;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_update',
  'p5c:wrong-contact-binding',
  '800002',
  NULL,
  '{"name":"wrong provider identity"}'::JSONB
);
\set p5c_wrong_contact_binding_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_wrong_contact_binding;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_wrong_contact_binding;

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_update',
  'p5c:contact-update:1',
  '800001',
  NULL,
  '{"name":"P5C Client B Updated"}'::JSONB
) AS p5c_contact_update_prepare
\gset

SAVEPOINT expect_p5c_unresolved_contact_conflict;
\set ON_ERROR_STOP off
SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  NULL,
  'contact_update',
  'p5c:contact-update:while-unresolved',
  '800001',
  NULL,
  '{"name":"must wait"}'::JSONB
);
\set p5c_unresolved_contact_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_unresolved_contact_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_unresolved_contact_conflict;

SELECT (
  :'p5c_contact_update_prepare'::JSONB -> 'attempt' ->> 'attempt_id'
)::UUID AS p5c_contact_update_attempt_id
\gset

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SELECT platform.claim_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_update_attempt_id',
  '92000000-0000-4000-8000-000000000127',
  'p5c-contact-update-worker',
  120
) AS p5c_contact_update_claim
\gset

SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_update_attempt_id',
  '92000000-0000-4000-8000-000000000129',
  'unchanged',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'dispatch_state_unknown'
) AS p5c_claimed_prepare_reconciled_unknown
\gset

RESET ROLE;
UPDATE platform_private.amocrm_contact_bindings
SET contact_id = '800002'
WHERE organization_id = :'p5c_org_a'
  AND person_id = '92000000-0000-4000-8000-000000000121';
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';

SAVEPOINT expect_p5c_binding_remap_blocked;
\set ON_ERROR_STOP off
SELECT platform.reconcile_unknown_amocrm_command(
  :'p5c_org_a',
  :'p5c_contact_update_attempt_id',
  '92000000-0000-4000-8000-000000000128',
  'accepted',
  '{"id":800001}'::JSONB,
  statement_timestamp(),
  statement_timestamp(),
  '800001',
  NULL,
  NULL
);
\set p5c_binding_remap_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_binding_remap_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_binding_remap_blocked;

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_sales_claims';
SELECT pg_temp.assert_true(
  :'p5c_existing_contact_create_conflict_state' = '23505'
  AND :'p5c_wrong_contact_binding_state' = '23505'
  AND :'p5c_unresolved_contact_conflict_state' = '55000'
  AND :'p5c_contact_update_claim'::JSONB ->> 'kind' = 'claimed'
  AND :'p5c_claimed_prepare_reconciled_unknown'::JSONB
    -> 'attempt' ->> 'status' = 'unknown'
  AND :'p5c_binding_remap_blocked_state' = '23505'
  AND platform.read_staff_amocrm_bindings(
    :'p5c_org_a',
    jsonb_build_object(
      'actor_role', 'sales',
      'workflow_scope', 'sales_pre_handoff',
      'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
      'student_case_id', NULL
    ),
    '92000000-0000-4000-8000-000000000121',
    '92000000-0000-4000-8000-000000000122'
  ) ->> 'contact_id' = '800002'
  ,
  'P5C accepted settlement must never remap an established provider identity for staff reads'
);

RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims = '{"role":"service_role"}';
SELECT pg_temp.assert_true(
  platform.read_amocrm_command_by_idempotency_key(
    :'p5c_org_a',
    'p5c:contact-update:1'
  ) ->> 'status' = 'unknown',
  'P5C failed accepted reconciliation must leave the command attempt unknown'
);

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims TO :'p5c_admin_claims';

SAVEPOINT expect_p5c_dispatched_release_blocked;
\set ON_ERROR_STOP off
SELECT platform.release_prepared_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000122',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000121',
  '92000000-0000-4000-8000-000000000122',
  :'p5c_contact_update_attempt_id',
  '92000000-0000-4000-8000-000000000149'
);
\set p5c_dispatched_release_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_dispatched_release_blocked;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_dispatched_release_blocked;

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_update',
  'p5c:prepared-release:1',
  NULL,
  '700001',
  '{"name":"P5C prepared release"}'::JSONB
) AS p5c_release_prepare
\gset

SELECT
  (:'p5c_release_prepare'::JSONB -> 'attempt' ->> 'attempt_id')::UUID
    AS p5c_release_attempt_id
\gset

SELECT platform.read_staff_blocking_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000102'
) AS p5c_prepared_blocking_attempt
\gset

SELECT platform.release_prepared_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000102',
  :'p5c_release_attempt_id',
  '92000000-0000-4000-8000-000000000150'
) AS p5c_prepared_released
\gset

SELECT platform.release_prepared_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000102',
  :'p5c_release_attempt_id',
  '92000000-0000-4000-8000-000000000150'
) AS p5c_prepared_release_replay
\gset

SAVEPOINT expect_p5c_prepared_release_terminal_conflict;
\set ON_ERROR_STOP off
SELECT platform.release_prepared_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000102',
  :'p5c_release_attempt_id',
  '92000000-0000-4000-8000-000000000151'
);
\set p5c_prepared_release_terminal_conflict_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_prepared_release_terminal_conflict;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_prepared_release_terminal_conflict;

SELECT
  platform.read_staff_blocking_amocrm_command(
    :'p5c_org_a',
    jsonb_build_object(
      'actor_role', 'sales',
      'workflow_scope', 'sales_pre_handoff',
      'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
      'student_case_id', NULL
    ),
    '92000000-0000-4000-8000-000000000101',
    '92000000-0000-4000-8000-000000000102'
  ) IS NULL AS p5c_prepared_release_cleared
\gset

SELECT platform.prepare_amocrm_command(
  :'p5c_org_a',
  jsonb_build_object(
    'actor_role', 'sales',
    'workflow_scope', 'sales_pre_handoff',
    'workflow_lead_id', '92000000-0000-4000-8000-000000000102',
    'student_case_id', NULL
  ),
  NULL,
  '92000000-0000-4000-8000-000000000102',
  'lead_update',
  'p5c:prepared-release:followup',
  NULL,
  '700001',
  '{"name":"P5C command after release"}'::JSONB
) AS p5c_prepare_after_release
\gset

SELECT pg_temp.assert_true(
  :'p5c_dispatched_release_blocked_state' = '55000'
  AND :'p5c_prepared_blocking_attempt'::JSONB ->> 'status' = 'prepared'
  AND :'p5c_prepared_blocking_attempt'::JSONB ->> 'provider_dispatched_at' IS NULL
  AND :'p5c_prepared_released'::JSONB ->> 'kind' = 'released'
  AND :'p5c_prepared_released'::JSONB -> 'attempt' ->> 'status' = 'rejected'
  AND :'p5c_prepared_released'::JSONB -> 'attempt' ->> 'provider_dispatched_at' IS NULL
  AND :'p5c_prepared_released'::JSONB -> 'attempt' ->> 'failure_code'
    = 'operator_released_before_dispatch'
  AND :'p5c_prepared_release_replay'::JSONB ->> 'kind' = 'replay'
  AND :'p5c_prepared_release_terminal_conflict_state' = '55000'
  AND :'p5c_prepared_release_cleared'::BOOLEAN
  AND :'p5c_prepare_after_release'::JSONB ->> 'kind' = 'prepared'
  AND has_function_privilege(
    'authenticated',
    'platform.release_prepared_amocrm_command(uuid,jsonb,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.release_prepared_amocrm_command(uuid,jsonb,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'P5C staff must see and exactly release only an unclaimed prepared blocker, never a dispatched attempt'
);

RESET ROLE;
SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'service_role',
    'platform_private.amocrm_command_receipts',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.amocrm_command_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'P5C runtime roles must not mutate or read private command receipts directly'
);

RESET ROLE;
SAVEPOINT expect_p5c_receipt_append_only;
\set ON_ERROR_STOP off
UPDATE platform_private.amocrm_command_receipts
SET idempotency_key = 'mutated'
WHERE organization_id = :'p5c_org_a'
  AND id = (
    SELECT (:'p5c_prepare_first'::JSONB -> 'attempt' ->> 'command_receipt_id')::UUID
  );
\set p5c_immutable_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p5c_receipt_append_only;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p5c_receipt_append_only;

SELECT pg_temp.assert_true(
  :'p5c_immutable_state' = '55000',
  'P5C receipts must remain append-only'
);

ROLLBACK;
