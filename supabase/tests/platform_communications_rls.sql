\set ON_ERROR_STOP on

-- P2F acceptance uses only deterministic UUIDs, reserved example.invalid
-- identities and synthetic provider identifiers in a disposable PostgreSQL
-- container. It proves database authorization and state-transition contracts.
-- It does not contact WAHA, WhatsApp, Kommo, amoCRM, an AI provider or Queue,
-- and it does not claim provider delivery.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2F assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO service_role;

-- P2E leaves 16 memberships, including inactive and blocked identities.
-- Migration 044 must upgrade every membership from immutable v3 to v4 once,
-- rotate the owning profile's access version once, and preserve lifecycle
-- state and the complete immutable history.
DO $$
DECLARE
  membership_count INTEGER;
  upgrade_audit_count INTEGER;
  upgrade_history_count INTEGER;
BEGIN
  SELECT count(*) INTO membership_count
  FROM platform.organization_memberships;

  IF membership_count <> 16 THEN
    RAISE EXCEPTION
      'Expected 16 P2E memberships before P2F fixtures, found %',
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
      'P2E inactive and blocked memberships must survive migration 044';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE bundle.version <> 4
      OR bundle.status <> 'published'
      OR bundle.role <> membership."current_role"
  ) THEN
    RAISE EXCEPTION
      'Every P2E membership must point to its matching published v4 bundle';
  END IF;

  SELECT count(*)
  INTO upgrade_audit_count
  FROM platform.audit_events AS audit
  WHERE audit.action = 'rbac.bundle.upgrade'
    AND audit.actor_kind = 'system'
    AND audit.actor_profile_id IS NULL
    AND audit.actor_principal =
        'migration:044_platform_communications_contracts'
    AND audit.reason = 'P2F immutable RBAC bundle upgrade'
    AND (audit.before_state ->> 'access_version')::BIGINT + 1 =
        (audit.after_state ->> 'access_version')::BIGINT
    AND EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
      JOIN platform.role_bundle_versions AS previous_bundle
        ON previous_bundle.id =
            (audit.before_state ->> 'bundle_id')::UUID
      JOIN platform.role_bundle_versions AS new_bundle
        ON new_bundle.id =
            (audit.after_state ->> 'bundle_id')::UUID
      WHERE membership.organization_id = audit.organization_id
        AND membership.id = audit.resource_id
        AND profile.access_version =
            (audit.after_state ->> 'access_version')::BIGINT
        AND previous_bundle.version = 3
        AND previous_bundle.status = 'published'
        AND new_bundle.version = 4
        AND new_bundle.status = 'published'
        AND new_bundle.role = membership."current_role"
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
    AND history.reason = 'P2F immutable RBAC bundle upgrade'
    AND history.previous_role = history.new_role
    AND previous_bundle.version = 3
    AND previous_bundle.status = 'published'
    AND new_bundle.version = 4
    AND new_bundle.status = 'published';

  IF upgrade_audit_count <> membership_count
    OR upgrade_history_count <> membership_count
  THEN
    RAISE EXCEPTION
      'Expected one P2F audit/history row per membership; audit %, history %, memberships %',
      upgrade_audit_count,
      upgrade_history_count,
      membership_count;
  END IF;

  IF EXISTS (
    SELECT membership_id
    FROM platform.membership_role_history
    WHERE reason = 'P2F immutable RBAC bundle upgrade'
    GROUP BY membership_id
    HAVING count(*) <> 1
  ) OR EXISTS (
    SELECT resource_id
    FROM platform.audit_events
    WHERE action = 'rbac.bundle.upgrade'
      AND actor_principal =
          'migration:044_platform_communications_contracts'
    GROUP BY resource_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'A membership received duplicate P2F upgrade evidence';
  END IF;
END
$$;

-- Resolve all fixture identities from the persisted P2D/P2E state. No test
-- relies on session-local variables from an earlier suite.
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
          'migration:044_platform_communications_contracts'
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
  student_case.responsible_sales_membership_id
    AS case_a_sales_membership_id,
  student_case.current_curator_membership_id
    AS curator_a_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS case_b_id,
  student_case.student_membership_id AS student_b_membership_id,
  student_case.responsible_sales_membership_id
    AS case_b_sales_membership_id,
  student_case.current_curator_membership_id
    AS curator_b_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.id AS org_b_case_id,
  student_case.student_membership_id AS org_b_student_membership_id,
  student_case.responsible_sales_membership_id
    AS org_b_sales_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_b_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
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
  membership.id AS previous_curator_membership_id,
  profile.id AS previous_curator_profile_id,
  profile.access_version AS previous_curator_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
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
  membership.id AS curator_b_membership_id,
  profile.id AS curator_b_profile_id,
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
  profile.id AS sales_a_profile_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS org_b_sales_membership_id,
  profile.id AS org_b_sales_profile_id,
  profile.access_version AS org_b_sales_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000007'
\gset

SELECT
  membership.id AS org_b_student_membership_id,
  profile.id AS org_b_student_profile_id,
  profile.access_version AS org_b_student_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000006'
\gset

SELECT
  membership.id AS org_b_curator_membership_id,
  profile.id AS org_b_curator_profile_id,
  profile.access_version AS org_b_curator_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000008'
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
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000007',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'org_b_sales_access_version'::BIGINT
)::TEXT AS org_b_sales_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000006',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'org_b_student_access_version'::BIGINT
)::TEXT AS org_b_student_claims
\gset

SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  NOT private.platform_has_permission(
    :'org_a_id',
    'knowledge.manage'
  ),
  'stale v3 claim retained P2F authority'
);
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  private.platform_has_permission(
    :'org_a_id',
    'communication.read.full'
  )
    AND private.platform_has_permission(
      :'org_a_id',
      'knowledge.manage'
    )
    AND private.platform_has_permission(
      :'org_a_id',
      'ai.draft.request'
    )
    AND private.platform_has_permission(
      :'org_a_id',
      'ai.draft.review'
    )
    AND private.platform_has_permission(
      :'org_a_id',
      'communication.manual.send'
    ),
  'fresh v4 Admin claim lacks P2F authority'
);
RESET ROLE;

-- New identities provisioned after 044 must bind the newest published v4
-- bundle. This fixture is intentionally not attached to a student case.
\set p2f_new_student_user_id '44000000-0000-4000-8000-000000000001'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'p2f_new_student_user_id',
  'p2f-new-student@example.invalid',
  '{"display_name":"P2F New Student"}'::JSONB
);

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.provision_member(
    :'org_a_id',
    :'p2f_new_student_user_id',
    'P2F New Student',
    'student',
    'P2F v4 provisioning acceptance',
    '44000000-0000-4000-8000-000000000101'
  ) ->> 'membership_id'
)::TEXT AS p2f_new_student_membership_id
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT bundle.version = 4
      AND bundle.status = 'published'
      AND bundle.role = 'student'
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE membership.id = :'p2f_new_student_membership_id'
      AND membership.organization_id = :'org_a_id'
  ),
  'post-044 provisioning did not use the published student v4 bundle'
);

-- A second synthetic Curator in organization B is used later to prove that the
-- existing Admin assignment RPC atomically resynchronizes communication scope
-- on both initial assignment and reassignment.
\set p2f_org_b_second_curator_user_id '44000000-0000-4000-8000-000000000002'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'p2f_org_b_second_curator_user_id',
  'p2f-org-b-second-curator@example.invalid',
  '{"display_name":"P2F Org B Second Curator"}'::JSONB
);

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT (
  platform.provision_member(
    :'org_b_id',
    :'p2f_org_b_second_curator_user_id',
    'P2F Org B Second Curator',
    'curator',
    'P2F assignment synchronization acceptance',
    '44000000-0000-4000-8000-000000000102'
  ) ->> 'membership_id'
)::TEXT AS p2f_org_b_second_curator_membership_id
\gset
RESET ROLE;

SELECT
  profile.id AS p2f_org_b_second_curator_profile_id,
  profile.access_version
    AS p2f_org_b_second_curator_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'p2f_org_b_second_curator_user_id'
\gset

-- A deliberately inactive same-organization Admin proves that merely having
-- the Admin role/bundle cannot create an operator participant.
\set p2f_inactive_admin_user_id '44000000-0000-4000-8000-000000000003'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'p2f_inactive_admin_user_id',
  'p2f-inactive-admin@example.invalid',
  '{"display_name":"P2F Inactive Admin"}'::JSONB
);

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT (
  platform.provision_member(
    :'org_a_id',
    :'p2f_inactive_admin_user_id',
    'P2F Inactive Admin',
    'admin',
    'P2F inactive Admin participant denial fixture',
    '44000000-0000-4000-8000-000000000103'
  ) ->> 'membership_id'
)::TEXT AS p2f_inactive_admin_membership_id
\gset
SELECT platform.change_membership_status(
  :'org_a_id',
  :'p2f_inactive_admin_membership_id',
  'inactive',
  'P2F inactive Admin participant denial fixture',
  '44000000-0000-4000-8000-000000000104'
);
RESET ROLE;

-- -------------------------------------------------------------------------
-- Private provider ingress: raw evidence is persisted before any normalized
-- conversation/message. Transport-request replay and WAHA business-key replay
-- converge on one private row; changed evidence fails closed.
-- -------------------------------------------------------------------------

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  'message.any',
  '2026-07-29 00:01:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-inbound","body":"Synthetic RU inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a',
  repeat('a', 64),
  '44000000-0000-4000-8000-000000000201'
)::TEXT AS raw_event_a_first
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  'message.any',
  '2026-07-29 00:01:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-inbound","body":"Synthetic RU inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a',
  repeat('a', 64),
  '44000000-0000-4000-8000-000000000201'
)::TEXT AS raw_event_a_request_replay
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-002',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  'message.any',
  '2026-07-29 00:01:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-inbound","body":"Synthetic RU inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a',
  repeat('a', 64),
  '44000000-0000-4000-8000-000000000202'
)::TEXT AS raw_event_a_business_replay
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-002',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  'message.any',
  '2026-07-29 00:01:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-inbound","body":"Synthetic RU inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a',
  repeat('a', 64),
  '44000000-0000-4000-8000-000000000202'
)::TEXT AS raw_event_a_business_request_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  'message.any',
  '2026-07-29 00:01:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-inbound","body":"Changed evidence"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000201'
);
\set raw_event_a_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-b-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-b-inbound',
  'message.any',
  '2026-07-29 00:02:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-b-inbound","body":"Synthetic EN inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:b',
  repeat('b', 64),
  '44000000-0000-4000-8000-000000000203'
)::TEXT AS raw_event_b
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_b_id',
  'waha',
  'synthetic:waha-account:org-b',
  NULL,
  NULL,
  'synthetic-request-org-b-001',
  'evo-inbox-synthetic-org-b',
  'synthetic-waha-message-org-b-inbound',
  'message.any',
  '2026-07-29 00:03:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-org-b-inbound","body":"Synthetic sales inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:org-b',
  repeat('c', 64),
  '44000000-0000-4000-8000-000000000204'
)::TEXT AS raw_event_org_b
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-rejected-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-rejected',
  'message.any',
  '2026-07-29 00:04:00+06'::TIMESTAMPTZ,
  'rejected',
  '{"event":"synthetic-rejected","body":"Must not process"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-invalid"}'::JSONB,
  'synthetic:hmac:rejected',
  repeat('d', 64),
  '44000000-0000-4000-8000-000000000205'
)::TEXT AS raw_event_rejected
\gset

\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.provider_webhook_events;
\set raw_event_service_select_state :SQLSTATE
INSERT INTO platform_private.provider_webhook_events (
  organization_id,
  provider,
  provider_account_ref,
  provider_request_id,
  waha_session_name,
  payload_id,
  event_type,
  provider_occurred_at,
  verification_status,
  raw_payload,
  verification_headers,
  verification_evidence_ref,
  payload_sha256,
  request_id
)
VALUES (
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  'synthetic-direct-write',
  'evo-inbox-synthetic-a',
  'synthetic-direct-write',
  'message.any',
  '2026-07-29 00:05:00+06'::TIMESTAMPTZ,
  'verified',
  '{}'::JSONB,
  '{}'::JSONB,
  'synthetic:forbidden',
  repeat('e', 64),
  '44000000-0000-4000-8000-000000000206'
);
\set raw_event_service_insert_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'raw_event_a_first'::JSONB ->> 'provider_webhook_event_id')
    AS raw_event_a_id,
  (:'raw_event_b'::JSONB ->> 'provider_webhook_event_id')
    AS raw_event_b_id,
  (:'raw_event_org_b'::JSONB ->> 'provider_webhook_event_id')
    AS raw_event_org_b_id,
  (:'raw_event_rejected'::JSONB ->> 'provider_webhook_event_id')
    AS raw_event_rejected_id
\gset

SELECT pg_temp.assert_true(
  :'raw_event_a_id' =
      (:'raw_event_a_request_replay'::JSONB
        ->> 'provider_webhook_event_id')
    AND :'raw_event_a_id' =
      (:'raw_event_a_business_replay'::JSONB
        ->> 'provider_webhook_event_id')
    AND :'raw_event_a_id' =
      (:'raw_event_a_business_request_replay'::JSONB
        ->> 'provider_webhook_event_id')
    AND (:'raw_event_a_first'::JSONB ->> 'deduplicated')::BOOLEAN
      IS FALSE
    AND (
      :'raw_event_a_business_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
      IS TRUE
    AND (
      :'raw_event_a_first'::JSONB ->> 'persisted_before_processing'
    )::BOOLEAN
      IS TRUE
    AND :'raw_event_a_mismatch_state' <> '00000'
    AND :'raw_event_service_select_state' <> '00000'
    AND :'raw_event_service_insert_state' <> '00000',
  'private webhook persist/dedupe/containment contract failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 4
    FROM platform_private.provider_webhook_events
    WHERE id IN (
      :'raw_event_a_id',
      :'raw_event_b_id',
      :'raw_event_org_b_id',
      :'raw_event_rejected_id'
    )
  )
    AND NOT EXISTS (
      SELECT 1 FROM platform.communication_conversations
    )
    AND NOT EXISTS (
      SELECT 1 FROM platform.communication_messages
    ),
  'raw provider rows were not durably persisted before processing'
);

-- Verified raw evidence can create one tenant-qualified conversation. Queue
-- ownership is derived from the canonical case/handoff state: active assigned
-- cases go to Curator, while the pending pre-contract case stays with Sales.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'case_a_sales_membership_id',
  'Synthetic Case A conversation',
  'evo-inbox-synthetic-a',
  1001,
  'synthetic-kommo-conversation-a',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000301'
)::TEXT AS conversation_a_first
\gset

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'case_a_sales_membership_id',
  'Synthetic Case A conversation',
  'evo-inbox-synthetic-a',
  1001,
  'synthetic-kommo-conversation-a',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000301'
)::TEXT AS conversation_a_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'case_a_sales_membership_id',
  'Changed replay subject',
  'evo-inbox-synthetic-a',
  1001,
  'synthetic-kommo-conversation-a',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000301'
);
\set conversation_a_replay_mismatch_state :SQLSTATE

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'org_b_sales_membership_id',
  'Synthetic wrong-owner conversation',
  'evo-inbox-synthetic-a',
  1098,
  'synthetic-kommo-conversation-wrong-owner',
  2098,
  3098,
  4098,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000302'
);
\set conversation_wrong_sales_state :SQLSTATE

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'case_a_sales_membership_id',
  'Synthetic rejected-source conversation',
  'evo-inbox-synthetic-a',
  1099,
  'synthetic-kommo-conversation-rejected',
  2099,
  3099,
  4099,
  :'raw_event_rejected_id',
  '44000000-0000-4000-8000-000000000303'
);
\set conversation_rejected_source_state :SQLSTATE

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_a_id',
  :'case_a_sales_membership_id',
  'Synthetic cross-tenant-source conversation',
  'evo-inbox-synthetic-a',
  1097,
  'synthetic-kommo-conversation-cross-tenant',
  2097,
  3097,
  4097,
  :'raw_event_org_b_id',
  '44000000-0000-4000-8000-000000000304'
);
\set conversation_cross_tenant_source_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.create_communication_conversation(
  :'org_a_id',
  :'case_b_id',
  :'case_b_sales_membership_id',
  'Synthetic Case B conversation',
  'evo-inbox-synthetic-a',
  1001,
  'synthetic-kommo-conversation-b',
  2001,
  3002,
  4002,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000305'
)::TEXT AS conversation_b_first
\gset

SELECT platform.create_communication_conversation(
  :'org_b_id',
  :'org_b_case_id',
  :'org_b_sales_membership_id',
  'Synthetic Org B pre-contract conversation',
  'evo-inbox-synthetic-org-b',
  1002,
  'synthetic-kommo-conversation-org-b',
  2002,
  3001,
  4001,
  :'raw_event_org_b_id',
  '44000000-0000-4000-8000-000000000306'
)::TEXT AS conversation_org_b_first
\gset
RESET ROLE;

SELECT
  (:'conversation_a_first'::JSONB
    ->> 'communication_conversation_id') AS conversation_a_id,
  (:'conversation_b_first'::JSONB
    ->> 'communication_conversation_id') AS conversation_b_id,
  (:'conversation_org_b_first'::JSONB
    ->> 'communication_conversation_id') AS conversation_org_b_id
\gset

SELECT pg_temp.assert_true(
  :'conversation_a_id' =
      (:'conversation_a_replay'::JSONB
        ->> 'communication_conversation_id')
    AND :'conversation_a_replay_mismatch_state' <> '00000'
    AND :'conversation_wrong_sales_state' <> '00000'
    AND :'conversation_rejected_source_state' <> '00000'
    AND :'conversation_cross_tenant_source_state' <> '00000',
  'conversation replay/verified-source/tenant/owner guard failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT queue = 'curator'
      AND student_case_id = :'case_a_id'
      AND responsible_sales_membership_id =
          :'case_a_sales_membership_id'
      AND current_curator_membership_id =
          :'curator_a_membership_id'
      AND id::TEXT <> waha_session_name
      AND id::TEXT <> kommo_conversation_id
      AND id::TEXT <> amocrm_lead_id::TEXT
    FROM platform.communication_conversations
    WHERE organization_id = :'org_a_id'
      AND id = :'conversation_a_id'
  )
    AND (
      SELECT queue = 'curator'
        AND student_case_id = :'case_b_id'
        AND current_curator_membership_id =
            :'curator_b_membership_id'
      FROM platform.communication_conversations
      WHERE organization_id = :'org_a_id'
        AND id = :'conversation_b_id'
    )
    AND (
      SELECT queue = 'sales'
        AND student_case_id = :'org_b_case_id'
        AND responsible_sales_membership_id =
            :'org_b_sales_membership_id'
        AND current_curator_membership_id IS NULL
      FROM platform.communication_conversations
      WHERE organization_id = :'org_b_id'
        AND id = :'conversation_org_b_id'
    )
    AND (
      SELECT count(*) = 3
      FROM platform.conversation_handoff_events
      WHERE id IS NOT NULL
    ),
  'conversation queue/handoff/provider-identity contract failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'customer',
  :'student_a_membership_id',
  'synthetic:wa-customer:a',
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000311'
)::TEXT AS participant_customer_a_first
\gset

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'customer',
  :'student_a_membership_id',
  'synthetic:wa-customer:a',
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000311'
)::TEXT AS participant_customer_a_replay
\gset

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'curator',
  :'curator_a_membership_id',
  NULL,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000312'
)::TEXT AS participant_curator_a
\gset

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'customer',
  :'student_b_membership_id',
  'synthetic:wa-customer:b',
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000313'
)::TEXT AS participant_customer_b
\gset

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'curator',
  :'curator_b_membership_id',
  NULL,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000314'
)::TEXT AS participant_curator_b
\gset

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'admin',
  :'admin_a_membership_id',
  NULL,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000329'
)::TEXT AS participant_admin_a
\gset

SELECT platform.record_conversation_participant(
  :'org_b_id',
  :'conversation_org_b_id',
  'customer',
  :'org_b_student_membership_id',
  'synthetic:wa-customer:org-b',
  :'raw_event_org_b_id',
  '44000000-0000-4000-8000-000000000315'
)::TEXT AS participant_customer_org_b
\gset

SELECT platform.record_conversation_participant(
  :'org_b_id',
  :'conversation_org_b_id',
  'sales',
  :'org_b_sales_membership_id',
  NULL,
  :'raw_event_org_b_id',
  '44000000-0000-4000-8000-000000000316'
)::TEXT AS participant_sales_org_b
\gset

\set ON_ERROR_STOP off
SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'curator',
  :'previous_curator_membership_id',
  NULL,
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000317'
);
\set participant_previous_curator_state :SQLSTATE

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'customer',
  :'student_b_membership_id',
  'synthetic:wa-customer:cross-student',
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000318'
);
\set participant_cross_student_state :SQLSTATE

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'admin',
  :'sales_a_membership_id',
  NULL,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000330'
);
\set participant_forged_admin_state :SQLSTATE

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'admin',
  :'p2f_inactive_admin_membership_id',
  NULL,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000331'
);
\set participant_inactive_admin_state :SQLSTATE

SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_b_id',
  'admin',
  :'admin_b_membership_id',
  NULL,
  :'raw_event_b_id',
  '44000000-0000-4000-8000-000000000332'
);
\set participant_cross_org_admin_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'participant_customer_a_first'::JSONB
    ->> 'conversation_participant_id') AS participant_customer_a_id,
  (:'participant_curator_a'::JSONB
    ->> 'conversation_participant_id') AS participant_curator_a_id,
  (:'participant_customer_b'::JSONB
    ->> 'conversation_participant_id') AS participant_customer_b_id,
  (:'participant_curator_b'::JSONB
    ->> 'conversation_participant_id') AS participant_curator_b_id,
  (:'participant_admin_a'::JSONB
    ->> 'conversation_participant_id') AS participant_admin_a_id,
  (:'participant_customer_org_b'::JSONB
    ->> 'conversation_participant_id') AS participant_customer_org_b_id,
  (:'participant_sales_org_b'::JSONB
    ->> 'conversation_participant_id') AS participant_sales_org_b_id
\gset

SELECT pg_temp.assert_true(
  :'participant_customer_a_id' =
      (:'participant_customer_a_replay'::JSONB
        ->> 'conversation_participant_id')
    AND :'participant_previous_curator_state' <> '00000'
    AND :'participant_cross_student_state' <> '00000'
    AND :'participant_forged_admin_state' <> '00000'
    AND :'participant_inactive_admin_state' <> '00000'
    AND :'participant_cross_org_admin_state' <> '00000'
    AND :'participant_admin_a_id' IS NOT NULL
    AND (
      SELECT count(*) = 7
      FROM platform.conversation_participants
    ),
  'participant idempotency/current-owner/student-scope contract failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'customer',
  :'student_a_membership_id',
  'synthetic:wa-customer:a',
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000319'
)::TEXT AS participant_customer_a_business_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.record_conversation_participant(
  :'org_a_id',
  :'conversation_a_id',
  'customer',
  :'student_a_membership_id',
  'synthetic:wa-customer:a-conflict',
  :'raw_event_a_id',
  '44000000-0000-4000-8000-000000000320'
);
\set participant_customer_identity_conflict_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'participant_customer_a_id' =
      (:'participant_customer_a_business_replay'::JSONB
        ->> 'conversation_participant_id')
    AND (
      :'participant_customer_a_business_replay'::JSONB
        ->> 'deduplicated'
    )::BOOLEAN
      IS TRUE
    AND :'participant_customer_identity_conflict_state' <> '00000',
  'participant business replay or conflicting customer identity guard failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-staff-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-staff',
  'message.any',
  '2026-07-29 00:05:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-staff-only","body":"Synthetic staff-only inbound"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-staff',
  repeat('e', 64),
  '44000000-0000-4000-8000-000000000207'
)::TEXT AS raw_event_a_staff
\gset

SELECT (
  :'raw_event_a_staff'::JSONB ->> 'provider_webhook_event_id'
)::TEXT AS raw_event_a_staff_id
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-unrelated-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-unrelated',
  'message.any',
  '2026-07-29 00:05:01+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-unrelated","body":"Unrelated evidence"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-unrelated',
  repeat('9', 64),
  '44000000-0000-4000-8000-000000000208'
)::TEXT AS raw_event_a_unrelated
\gset

SELECT (
  :'raw_event_a_unrelated'::JSONB ->> 'provider_webhook_event_id'
)::TEXT AS raw_event_a_unrelated_id
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Привет, это синтетическое сообщение.',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-inbound',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  NULL,
  '44000000-0000-4000-8000-000000000321'
)::TEXT AS message_a_visible_first
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Привет, это синтетическое сообщение.',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-inbound',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  NULL,
  '44000000-0000-4000-8000-000000000321'
)::TEXT AS message_a_visible_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Changed replay body',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-inbound',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-inbound',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  NULL,
  '44000000-0000-4000-8000-000000000321'
);
\set message_a_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Synthetic sensitive customer context for staff only.',
  'ru',
  FALSE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-staff',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-staff',
  2001,
  3001,
  4001,
  :'raw_event_a_staff_id',
  NULL,
  '44000000-0000-4000-8000-000000000322'
)::TEXT AS message_a_staff
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_b_id',
  'inbound',
  'Synthetic message with uncertain language.',
  'undetermined',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-b-inbound',
  1001,
  'synthetic-kommo-conversation-b',
  'synthetic-kommo-message-b-inbound',
  2001,
  3002,
  4002,
  :'raw_event_b_id',
  NULL,
  '44000000-0000-4000-8000-000000000323'
)::TEXT AS message_b_visible
\gset

SELECT platform.record_communication_message(
  :'org_b_id',
  :'conversation_org_b_id',
  'inbound',
  'Synthetic pre-contract customer message.',
  'en',
  FALSE,
  'evo-inbox-synthetic-org-b',
  'synthetic-waha-message-org-b-inbound',
  1002,
  'synthetic-kommo-conversation-org-b',
  'synthetic-kommo-message-org-b-inbound',
  2002,
  3001,
  4001,
  :'raw_event_org_b_id',
  NULL,
  '44000000-0000-4000-8000-000000000324'
)::TEXT AS message_org_b
\gset

\set ON_ERROR_STOP off
SELECT platform.record_communication_message(
  :'org_b_id',
  :'conversation_org_b_id',
  'inbound',
  'Must not become student-visible before handoff.',
  'en',
  TRUE,
  'evo-inbox-synthetic-org-b',
  'synthetic-waha-message-org-b-visible-invalid',
  1002,
  'synthetic-kommo-conversation-org-b',
  'synthetic-kommo-message-org-b-visible-invalid',
  2002,
  3001,
  4001,
  :'raw_event_org_b_id',
  NULL,
  '44000000-0000-4000-8000-000000000325'
);
\set message_precontract_visible_state :SQLSTATE

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Must not process rejected evidence.',
  'en',
  FALSE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-rejected',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-rejected',
  2001,
  3001,
  4001,
  :'raw_event_rejected_id',
  NULL,
  '44000000-0000-4000-8000-000000000326'
);
\set message_rejected_source_state :SQLSTATE

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Must not cross provider accounts.',
  'en',
  FALSE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-wrong-account',
  9999,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-wrong-account',
  2001,
  3001,
  4001,
  :'raw_event_a_id',
  NULL,
  '44000000-0000-4000-8000-000000000327'
);
\set message_wrong_provider_identity_state :SQLSTATE

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'inbound',
  'Must not attach unrelated verified raw evidence.',
  'ru',
  FALSE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-staff',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-staff',
  2001,
  3001,
  4001,
  :'raw_event_a_unrelated_id',
  NULL,
  '44000000-0000-4000-8000-000000000328'
);
\set message_unrelated_verified_source_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'message_a_visible_first'::JSONB
    ->> 'communication_message_id') AS message_a_visible_id,
  (:'message_a_staff'::JSONB
    ->> 'communication_message_id') AS message_a_staff_id,
  (:'message_b_visible'::JSONB
    ->> 'communication_message_id') AS message_b_visible_id,
  (:'message_org_b'::JSONB
    ->> 'communication_message_id') AS message_org_b_id
\gset

SELECT pg_temp.assert_true(
  :'message_a_visible_id' =
      (:'message_a_visible_replay'::JSONB
        ->> 'communication_message_id')
    AND :'message_a_replay_mismatch_state' <> '00000'
    AND :'message_precontract_visible_state' <> '00000'
    AND :'message_rejected_source_state' <> '00000'
    AND :'message_wrong_provider_identity_state' <> '00000'
    AND :'message_unrelated_verified_source_state' <> '00000'
    AND (
      SELECT count(*) = 4
        AND count(DISTINCT id) = 4
        AND count(DISTINCT waha_message_id) = 4
        AND count(DISTINCT kommo_message_id) = 4
      FROM platform.communication_messages
    ),
  'message replay/provider-identity/visibility/source contract failed'
);

-- Full transcript base rows are RLS-readable only by an active organization
-- Admin, responsible Sales while the queue is pre-contract, or the currently
-- assigned Curator after handoff. Finance, Student, stale claims, previous
-- Curator, cross-student and cross-organization identities see zero rows.
SET request.jwt.claims TO :'admin_a_stale_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS stale_admin_conversation_count
FROM platform.communication_conversations
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS admin_a_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS admin_a_message_count
FROM platform.communication_messages
\gset
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.provider_webhook_events;
\set admin_a_private_raw_state :SQLSTATE
UPDATE platform.communication_messages
SET body_text = 'Forbidden browser rewrite'
WHERE id = :'message_a_visible_id';
\set admin_a_direct_message_update_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS admin_b_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS admin_b_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_a_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS curator_a_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_b_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS curator_b_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS previous_curator_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS previous_curator_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS post_handoff_sales_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS post_handoff_sales_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS precontract_sales_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS precontract_sales_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS finance_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS finance_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS student_a_base_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS student_a_base_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS student_b_base_conversation_count
FROM platform.communication_conversations
\gset
SELECT count(*)::TEXT AS student_b_base_message_count
FROM platform.communication_messages
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'stale_admin_conversation_count' = '0'
    AND :'admin_a_conversation_count' = '2'
    AND :'admin_a_message_count' = '3'
    AND :'admin_b_conversation_count' = '1'
    AND :'admin_b_message_count' = '1'
    AND :'curator_a_conversation_count' = '1'
    AND :'curator_a_message_count' = '2'
    AND :'curator_b_conversation_count' = '1'
    AND :'curator_b_message_count' = '1'
    AND :'previous_curator_conversation_count' = '0'
    AND :'previous_curator_message_count' = '0'
    AND :'post_handoff_sales_conversation_count' = '0'
    AND :'post_handoff_sales_message_count' = '0'
    AND :'precontract_sales_conversation_count' = '1'
    AND :'precontract_sales_message_count' = '1'
    AND :'finance_conversation_count' = '0'
    AND :'finance_message_count' = '0'
    AND :'student_a_base_conversation_count' = '0'
    AND :'student_a_base_message_count' = '0'
    AND :'student_b_base_conversation_count' = '0'
    AND :'student_b_base_message_count' = '0'
    AND :'admin_a_private_raw_state' <> '00000'
    AND :'admin_a_direct_message_update_state' <> '00000',
  'five-role transcript RLS/handoff/tenant/object-scope matrix failed'
);

-- Only organization-scoped Admin publishes or retires immutable, integrity-
-- checked knowledge versions. Draft generation later references only the
-- still-approved v2 row; retired v1 remains immutable historical evidence.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.publish_approved_knowledge_version(
  :'org_a_id',
  'synthetic.admissions.general',
  'Synthetic admissions knowledge',
  1,
  'Synthetic approved knowledge v1.',
  encode(
    sha256(convert_to('Synthetic approved knowledge v1.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:knowledge:v1',
  'Publish synthetic approved knowledge v1',
  '44000000-0000-4000-8000-000000000401'
)::TEXT AS knowledge_v1_first
\gset

SELECT platform.publish_approved_knowledge_version(
  :'org_a_id',
  'synthetic.admissions.general',
  'Synthetic admissions knowledge',
  1,
  'Synthetic approved knowledge v1.',
  encode(
    sha256(convert_to('Synthetic approved knowledge v1.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:knowledge:v1',
  'Publish synthetic approved knowledge v1',
  '44000000-0000-4000-8000-000000000401'
)::TEXT AS knowledge_v1_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_version(
  :'org_a_id',
  'synthetic.admissions.general',
  'Changed replay title',
  1,
  'Synthetic approved knowledge v1.',
  encode(
    sha256(convert_to('Synthetic approved knowledge v1.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:knowledge:v1',
  'Publish synthetic approved knowledge v1',
  '44000000-0000-4000-8000-000000000401'
);
\set knowledge_v1_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.publish_approved_knowledge_version(
  :'org_a_id',
  'synthetic.admissions.general',
  'Synthetic admissions knowledge',
  2,
  'Synthetic approved knowledge v2.',
  encode(
    sha256(convert_to('Synthetic approved knowledge v2.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:knowledge:v2',
  'Publish synthetic approved knowledge v2',
  '44000000-0000-4000-8000-000000000402'
)::TEXT AS knowledge_v2_first
\gset
RESET ROLE;

SELECT
  (:'knowledge_v1_first'::JSONB
    ->> 'approved_knowledge_version_id') AS knowledge_v1_id,
  (:'knowledge_v2_first'::JSONB
    ->> 'approved_knowledge_version_id') AS knowledge_v2_id
\gset

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_version(
  :'org_a_id',
  'synthetic.admissions.general',
  'Forbidden Curator knowledge',
  3,
  'Curator must not publish.',
  encode(
    sha256(convert_to('Curator must not publish.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:forbidden',
  'Curator must not manage knowledge',
  '44000000-0000-4000-8000-000000000403'
);
\set curator_knowledge_publish_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.publish_approved_knowledge_version(
  :'org_b_id',
  'synthetic.cross.org',
  'Forbidden cross-organization knowledge',
  1,
  'Admin A must not publish for organization B.',
  encode(
    sha256(
      convert_to(
        'Admin A must not publish for organization B.',
        'UTF8'
      )
    ),
    'hex'
  ),
  'synthetic:provenance:cross-org',
  'Cross-organization operation must fail',
  '44000000-0000-4000-8000-000000000404'
);
\set cross_org_knowledge_publish_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.retire_approved_knowledge_version(
  :'org_a_id',
  :'knowledge_v1_id',
  'Retire synthetic v1 after publishing v2',
  '44000000-0000-4000-8000-000000000405'
)::TEXT AS knowledge_v1_retired
\gset
RESET ROLE;

\set ON_ERROR_STOP off
UPDATE platform.approved_knowledge_versions
SET content_text = 'Forbidden immutable rewrite'
WHERE organization_id = :'org_a_id'
  AND id = :'knowledge_v1_id';
\set knowledge_content_rewrite_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'knowledge_v1_id' =
      (:'knowledge_v1_replay'::JSONB
        ->> 'approved_knowledge_version_id')
    AND :'knowledge_v1_replay_mismatch_state' <> '00000'
    AND :'curator_knowledge_publish_state' <> '00000'
    AND :'cross_org_knowledge_publish_state' <> '00000'
    AND :'knowledge_content_rewrite_state' <> '00000'
    AND (
      SELECT status = 'retired'
        AND content_text = 'Synthetic approved knowledge v1.'
        AND provenance_ref = 'synthetic:provenance:knowledge:v1'
      FROM platform.approved_knowledge_versions
      WHERE organization_id = :'org_a_id'
        AND id = :'knowledge_v1_id'
    )
    AND (
      SELECT status = 'approved'
        AND content_text = 'Synthetic approved knowledge v2.'
        AND provenance_ref = 'synthetic:provenance:knowledge:v2'
      FROM platform.approved_knowledge_versions
      WHERE organization_id = :'org_a_id'
        AND id = :'knowledge_v2_id'
    ),
  'approved knowledge integrity/version/admin/tenant contract failed'
);

-- A draft starts only from an explicit request by the conversation's current
-- staff owner. The request records source message, requested RU/EN choice,
-- actor, reason and idempotency before any provider/model evidence exists.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'ru',
  'Prepare a synthetic RU draft for manual review',
  '44000000-0000-4000-8000-000000000411'
)::TEXT AS draft_request_a_first
\gset

SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'ru',
  'Prepare a synthetic RU draft for manual review',
  '44000000-0000-4000-8000-000000000411'
)::TEXT AS draft_request_a_replay
\gset
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  'en',
  'Curator A must not request for Student B',
  '44000000-0000-4000-8000-000000000412'
);
\set draft_request_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  NULL,
  'Record uncertain language before manual selection',
  '44000000-0000-4000-8000-000000000413'
)::TEXT AS draft_request_b_first
\gset
RESET ROLE;

SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'ru',
  'Previous Curator must not request a draft',
  '44000000-0000-4000-8000-000000000414'
);
\set draft_request_previous_curator_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'ru',
  'Post-handoff Sales must not request a draft',
  '44000000-0000-4000-8000-000000000415'
);
\set draft_request_post_handoff_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'ru',
  'Finance must not request a customer draft',
  '44000000-0000-4000-8000-000000000416'
);
\set draft_request_finance_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT
  (:'draft_request_a_first'::JSONB
    ->> 'ai_draft_request_id') AS draft_request_a_id,
  (:'draft_request_b_first'::JSONB
    ->> 'ai_draft_request_id') AS draft_request_b_id
\gset

SELECT pg_temp.assert_true(
  :'draft_request_a_id' =
      (:'draft_request_a_replay'::JSONB
        ->> 'ai_draft_request_id')
    AND :'draft_request_cross_student_state' <> '00000'
    AND :'draft_request_previous_curator_state' <> '00000'
    AND :'draft_request_post_handoff_sales_state' <> '00000'
    AND :'draft_request_finance_state' <> '00000'
    AND (
      SELECT count(*) = 2
      FROM platform.ai_draft_requests
    ),
  'explicit draft request/current-owner/object-scope contract failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'confident',
  'ru',
  :'knowledge_v1_id',
  'Этот черновик не должен использовать retired knowledge.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  jsonb_build_object(
    'source_message_id', :'message_a_staff_id',
    'knowledge_version_ids', jsonb_build_array(:'knowledge_v1_id')
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_a_staff_id',
          'knowledge_version_ids', jsonb_build_array(:'knowledge_v1_id')
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000420'
);
\set draft_retired_knowledge_state :SQLSTATE

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'confident',
  CAST('ky' AS platform.ai_draft_language),
  :'knowledge_v2_id',
  'Forbidden Kyrgyz customer draft.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  '{}'::JSONB,
  encode(sha256(convert_to('{}', 'UTF8')), 'hex'),
  '44000000-0000-4000-8000-000000000421'
);
\set draft_kyrgyz_language_state :SQLSTATE

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  'confident',
  'en',
  :'knowledge_v2_id',
  'Must not generate before uncertain language selection.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  jsonb_build_object(
    'source_message_id', :'message_b_visible_id',
    'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_b_visible_id',
          'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000422'
);
\set draft_uncertain_confident_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'confident',
  'ru',
  :'knowledge_v2_id',
  'Синтетический черновик для ручной проверки.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  jsonb_build_object(
    'source_message_id', :'message_a_staff_id',
    'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_a_staff_id',
          'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000423'
)::TEXT AS draft_a_first
\gset

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_a_id',
  :'message_a_staff_id',
  'confident',
  'ru',
  :'knowledge_v2_id',
  'Синтетический черновик для ручной проверки.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  jsonb_build_object(
    'source_message_id', :'message_a_staff_id',
    'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_a_staff_id',
          'knowledge_version_ids', jsonb_build_array(:'knowledge_v2_id')
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000423'
)::TEXT AS draft_a_replay
\gset

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  'uncertain',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'source_message_id', :'message_b_visible_id',
    'language_detection', 'uncertain'
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_b_visible_id',
          'language_detection', 'uncertain'
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000424'
)::TEXT AS draft_b_uncertain
\gset
RESET ROLE;

SELECT
  (:'draft_a_first'::JSONB ->> 'ai_draft_id') AS draft_a_id,
  (:'draft_b_uncertain'::JSONB ->> 'ai_draft_id') AS draft_b_id
\gset

SELECT pg_temp.assert_true(
  :'draft_a_id' =
      (:'draft_a_replay'::JSONB ->> 'ai_draft_id')
    AND :'draft_retired_knowledge_state' <> '00000'
    AND :'draft_kyrgyz_language_state' <> '00000'
    AND :'draft_uncertain_confident_state' <> '00000'
    AND (
      SELECT detection_status = 'confident'
        AND selected_language = 'ru'
        AND state = 'review_required'
        AND knowledge_version_id = :'knowledge_v2_id'
        AND generated_text =
            'Синтетический черновик для ручной проверки.'
        AND provider_ref = 'synthetic:ai-provider'
        AND model_ref = 'synthetic:model:1'
        AND prompt_policy_version = 'synthetic:prompt-policy:v1'
        AND failure_outcome IS NULL
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_a_id'
    )
    AND (
      SELECT detection_status = 'uncertain'
        AND selected_language IS NULL
        AND state = 'awaiting_language_selection'
        AND knowledge_version_id IS NULL
        AND generated_text IS NULL
        AND provider_ref IS NULL
        AND model_ref IS NULL
        AND prompt_policy_version IS NULL
        AND failure_outcome = 'language_uncertain'
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_b_id'
    ),
  'RU/EN approved-knowledge draft and uncertain-language fail-closed contract failed'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.complete_ai_draft_generation(
  :'org_a_id',
  :'draft_b_id',
  :'knowledge_v2_id',
  'Synthetic EN draft before language selection.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  '44000000-0000-4000-8000-000000000430'
);
\set draft_complete_before_language_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_id',
  'en',
  FALSE,
  'Curator A must not resolve Student B language',
  '44000000-0000-4000-8000-000000000431'
);
\set draft_language_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_id',
  'en',
  TRUE,
  'Language and handoff are mutually exclusive',
  '44000000-0000-4000-8000-000000000432'
);
\set draft_language_invalid_handoff_shape_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_id',
  'en',
  FALSE,
  'Human selected English for synthetic message',
  '44000000-0000-4000-8000-000000000433'
)::TEXT AS draft_b_language_first
\gset

SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_id',
  'en',
  FALSE,
  'Human selected English for synthetic message',
  '44000000-0000-4000-8000-000000000433'
)::TEXT AS draft_b_language_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_id',
  'ru',
  FALSE,
  'Human selected English for synthetic message',
  '44000000-0000-4000-8000-000000000433'
);
\set draft_language_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.complete_ai_draft_generation(
  :'org_a_id',
  :'draft_b_id',
  :'knowledge_v1_id',
  'Synthetic EN draft with retired knowledge.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  '44000000-0000-4000-8000-000000000434'
);
\set draft_complete_retired_knowledge_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.complete_ai_draft_generation(
  :'org_a_id',
  :'draft_b_id',
  :'knowledge_v2_id',
  'Synthetic English draft for manual review.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  '44000000-0000-4000-8000-000000000435'
)::TEXT AS draft_b_complete_first
\gset

SELECT platform.complete_ai_draft_generation(
  :'org_a_id',
  :'draft_b_id',
  :'knowledge_v2_id',
  'Synthetic English draft for manual review.',
  'synthetic:ai-provider',
  'synthetic:model:1',
  'synthetic:prompt-policy:v1',
  '44000000-0000-4000-8000-000000000435'
)::TEXT AS draft_b_complete_replay
\gset
RESET ROLE;

\set ON_ERROR_STOP off
UPDATE platform.ai_drafts
SET generated_text = 'Forbidden generated-text rewrite'
WHERE organization_id = :'org_a_id'
  AND id = :'draft_a_id';
\set draft_generated_text_rewrite_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'draft_complete_before_language_state' <> '00000'
    AND :'draft_language_cross_student_state' <> '00000'
    AND :'draft_language_invalid_handoff_shape_state' <> '00000'
    AND :'draft_language_replay_mismatch_state' <> '00000'
    AND :'draft_b_id' =
      (:'draft_b_language_first'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_id' =
      (:'draft_b_language_replay'::JSONB ->> 'ai_draft_id')
    AND :'draft_complete_retired_knowledge_state' <> '00000'
    AND :'draft_b_id' =
      (:'draft_b_complete_first'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_id' =
      (:'draft_b_complete_replay'::JSONB ->> 'ai_draft_id')
    AND :'draft_generated_text_rewrite_state' <> '00000'
    AND (
      SELECT detection_status = 'uncertain'
        AND selected_language = 'en'
        AND knowledge_version_id = :'knowledge_v2_id'
        AND state = 'review_required'
        AND failure_outcome IS NULL
        AND generated_text =
            'Synthetic English draft for manual review.'
        AND provider_ref = 'synthetic:ai-provider'
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_b_id'
    )
    AND (
      SELECT count(*) = 2
      FROM platform.ai_draft_knowledge_citations
      WHERE organization_id = :'org_a_id'
        AND knowledge_version_id = :'knowledge_v2_id'
    ),
  'manual RU/EN selection/approved generation/immutable evidence contract failed'
);

-- Current Curator reviews and may edit the draft, but the original generated
-- text and provider/model/source evidence remain immutable. Former Sales,
-- previous Curator, Finance and cross-student Curator cannot review.
SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Previous Curator must not review',
  '44000000-0000-4000-8000-000000000441'
);
\set draft_review_previous_curator_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Post-handoff Sales must not review',
  '44000000-0000-4000-8000-000000000442'
);
\set draft_review_post_handoff_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Curator B must not review Student A',
  '44000000-0000-4000-8000-000000000443'
);
\set draft_review_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Finance must not review customer drafts',
  '44000000-0000-4000-8000-000000000444'
);
\set draft_review_finance_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'rework',
  'Rework must not accept reviewed text.',
  'Invalid rework input shape',
  '44000000-0000-4000-8000-000000000445'
);
\set draft_review_invalid_shape_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Curator reviewed and edited synthetic draft',
  '44000000-0000-4000-8000-000000000446'
)::TEXT AS draft_a_review_first
\gset

SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Синтетический отредактированный текст.',
  'Curator reviewed and edited synthetic draft',
  '44000000-0000-4000-8000-000000000446'
)::TEXT AS draft_a_review_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_a_id',
  'approved',
  'Changed text must not reuse a completed request id.',
  'Curator reviewed and edited synthetic draft',
  '44000000-0000-4000-8000-000000000446'
);
\set draft_review_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'draft_review_previous_curator_state' <> '00000'
    AND :'draft_review_post_handoff_sales_state' <> '00000'
    AND :'draft_review_cross_student_state' <> '00000'
    AND :'draft_review_finance_state' <> '00000'
    AND :'draft_review_invalid_shape_state' <> '00000'
    AND :'draft_review_replay_mismatch_state' <> '00000'
    AND :'draft_a_id' =
      (:'draft_a_review_first'::JSONB ->> 'ai_draft_id')
    AND :'draft_a_id' =
      (:'draft_a_review_replay'::JSONB ->> 'ai_draft_id')
    AND (
      SELECT state = 'ready_for_manual_send'
        AND generated_text =
            'Синтетический черновик для ручной проверки.'
        AND reviewed_text =
            'Синтетический отредактированный текст.'
        AND reviewed_by_membership_id =
            :'curator_a_membership_id'
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_a_id'
    ),
  'human review/edit/original-draft/current-owner contract failed'
);

-- Rework is terminal for the reviewed evidence row. A provider-side successor
-- is a new immutable draft linked through supersedes_ai_draft_id; the previous
-- generated text, context hash, provider metadata and citation remain intact.
SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_b_id',
  'rework',
  NULL,
  'Curator requests a new draft while preserving prior evidence',
  '44000000-0000-4000-8000-000000000463'
)::TEXT AS draft_b_rework_first
\gset

SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_b_id',
  'rework',
  NULL,
  'Curator requests a new draft while preserving prior evidence',
  '44000000-0000-4000-8000-000000000463'
)::TEXT AS draft_b_rework_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_b_id',
  'rework',
  NULL,
  'Changed rework reason must not reuse the completed request id',
  '44000000-0000-4000-8000-000000000463'
);
\set draft_b_rework_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  'uncertain',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'source_message_id', :'message_b_visible_id',
    'language_detection', 'uncertain',
    'rework_iteration', 2
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_b_visible_id',
          'language_detection', 'uncertain',
          'rework_iteration', 2
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000464'
)::TEXT AS draft_b_successor_first
\gset

SELECT platform.record_ai_draft(
  :'org_a_id',
  :'conversation_b_id',
  :'message_b_visible_id',
  'uncertain',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'source_message_id', :'message_b_visible_id',
    'language_detection', 'uncertain',
    'rework_iteration', 2
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_b_visible_id',
          'language_detection', 'uncertain',
          'rework_iteration', 2
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000464'
)::TEXT AS draft_b_successor_replay
\gset
RESET ROLE;

SELECT (
  :'draft_b_successor_first'::JSONB ->> 'ai_draft_id'
)::TEXT AS draft_b_successor_id
\gset

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT platform.resolve_ai_draft_language(
  :'org_a_id',
  :'draft_b_successor_id',
  'en',
  FALSE,
  'Curator confirms language again for the rework successor',
  '44000000-0000-4000-8000-000000000465'
)::TEXT AS draft_b_successor_language
\gset
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.complete_ai_draft_generation(
  :'org_a_id',
  :'draft_b_successor_id',
  :'knowledge_v2_id',
  'Synthetic English successor draft for manual review.',
  'synthetic:ai-provider',
  'synthetic:model:2',
  'synthetic:prompt-policy:v1',
  '44000000-0000-4000-8000-000000000466'
)::TEXT AS draft_b_successor_complete
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'draft_b_id' =
      (:'draft_b_rework_first'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_id' =
      (:'draft_b_rework_replay'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_rework_replay_mismatch_state' <> '00000'
    AND :'draft_b_successor_id' <>
      :'draft_b_id'
    AND :'draft_b_successor_id' =
      (:'draft_b_successor_replay'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_successor_id' =
      (:'draft_b_successor_language'::JSONB ->> 'ai_draft_id')
    AND :'draft_b_successor_id' =
      (:'draft_b_successor_complete'::JSONB ->> 'ai_draft_id')
    AND (
      SELECT state = 'rework_requested'
        AND generated_text =
            'Synthetic English draft for manual review.'
        AND provider_ref = 'synthetic:ai-provider'
        AND model_ref = 'synthetic:model:1'
        AND prompt_policy_version = 'synthetic:prompt-policy:v1'
        AND source_context = jsonb_build_object(
          'source_message_id', :'message_b_visible_id',
          'language_detection', 'uncertain'
        )
        AND source_context_sha256 = encode(
          sha256(
            convert_to(
              jsonb_build_object(
                'source_message_id', :'message_b_visible_id',
                'language_detection', 'uncertain'
              )::TEXT,
              'UTF8'
            )
          ),
          'hex'
        )
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_b_id'
    )
    AND (
      SELECT state = 'review_required'
        AND supersedes_ai_draft_id = :'draft_b_id'
        AND generated_text =
            'Synthetic English successor draft for manual review.'
        AND model_ref = 'synthetic:model:2'
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_b_successor_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform.ai_draft_knowledge_citations
      WHERE organization_id = :'org_a_id'
        AND ai_draft_id = :'draft_b_id'
        AND knowledge_version_id = :'knowledge_v2_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform.ai_draft_knowledge_citations
      WHERE organization_id = :'org_a_id'
        AND ai_draft_id = :'draft_b_successor_id'
        AND knowledge_version_id = :'knowledge_v2_id'
    ),
  'rework successor did not preserve immutable prior draft evidence'
);

-- Admin is an explicitly authorized human operator. A validated active Admin
-- participant can review, authorize and normalize one provider-observed
-- outbound message, while the exact authorization actor remains the sender.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.review_ai_draft(
  :'org_a_id',
  :'draft_b_successor_id',
  'approved',
  'Synthetic Admin-reviewed successor reply.',
  'Admin reviews the rework successor before manual send',
  '44000000-0000-4000-8000-000000000469'
)::TEXT AS admin_draft_review
\gset

SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_b_successor_id',
  'Synthetic Admin-reviewed successor reply.',
  'Admin explicitly authorizes the exact reviewed text',
  '44000000-0000-4000-8000-000000000470'
)::TEXT AS admin_manual_authorization_first
\gset

SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_b_successor_id',
  'Synthetic Admin-reviewed successor reply.',
  'Admin explicitly authorizes the exact reviewed text',
  '44000000-0000-4000-8000-000000000470'
)::TEXT AS admin_manual_authorization_replay
\gset
RESET ROLE;

SELECT (
  :'admin_manual_authorization_first'::JSONB
    ->> 'manual_send_authorization_id'
)::TEXT AS admin_manual_authorization_id
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-b-admin-outbound-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-b-admin-outbound',
  'message.any',
  '2026-07-29 00:05:30+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-b-admin-outbound-observed"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:b-admin-outbound',
  repeat('8', 64),
  '44000000-0000-4000-8000-000000000471'
)::TEXT AS raw_event_b_admin_outbound
\gset

SELECT (
  :'raw_event_b_admin_outbound'::JSONB
    ->> 'provider_webhook_event_id'
)::TEXT AS raw_event_b_admin_outbound_id
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_b_id',
  'outbound',
  'Synthetic Admin-reviewed successor reply.',
  'en',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-b-admin-outbound',
  1001,
  'synthetic-kommo-conversation-b',
  'synthetic-kommo-message-b-admin-outbound',
  2001,
  3002,
  4002,
  :'raw_event_b_admin_outbound_id',
  :'admin_manual_authorization_id',
  '44000000-0000-4000-8000-000000000472'
)::TEXT AS message_b_admin_outbound_first
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_b_id',
  'outbound',
  'Synthetic Admin-reviewed successor reply.',
  'en',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-b-admin-outbound',
  1001,
  'synthetic-kommo-conversation-b',
  'synthetic-kommo-message-b-admin-outbound',
  2001,
  3002,
  4002,
  :'raw_event_b_admin_outbound_id',
  :'admin_manual_authorization_id',
  '44000000-0000-4000-8000-000000000472'
)::TEXT AS message_b_admin_outbound_replay
\gset
RESET ROLE;

SELECT (
  :'message_b_admin_outbound_first'::JSONB
    ->> 'communication_message_id'
)::TEXT AS message_b_admin_outbound_id
\gset

SELECT pg_temp.assert_true(
  :'draft_b_successor_id' =
      (:'admin_draft_review'::JSONB ->> 'ai_draft_id')
    AND :'admin_manual_authorization_id' =
      (
        :'admin_manual_authorization_replay'::JSONB
          ->> 'manual_send_authorization_id'
      )
    AND :'message_b_admin_outbound_id' =
      (
        :'message_b_admin_outbound_replay'::JSONB
          ->> 'communication_message_id'
      )
    AND (
      SELECT manual_auth.ai_draft_id = :'draft_b_successor_id'
        AND manual_auth.final_text =
            'Synthetic Admin-reviewed successor reply.'
        AND manual_auth.authorized_by_membership_id =
            :'admin_a_membership_id'
      FROM platform.manual_send_authorizations AS manual_auth
      WHERE manual_auth.organization_id = :'org_a_id'
        AND manual_auth.id = :'admin_manual_authorization_id'
    )
    AND (
      SELECT message.sender_participant_id =
            :'participant_admin_a_id'
        AND message.manual_send_authorization_id =
            :'admin_manual_authorization_id'
        AND message.direction = 'outbound'
        AND message.student_visible
        AND message.body_text =
            'Synthetic Admin-reviewed successor reply.'
      FROM platform.communication_messages AS message
      WHERE message.organization_id = :'org_a_id'
        AND message.id = :'message_b_admin_outbound_id'
    ),
  'active Admin manual authorization could not normalize exact outbound evidence'
);

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_a_id',
  'Итоговый синтетический ответ после ручной проверки.',
  'Post-handoff Sales must not authorize',
  '44000000-0000-4000-8000-000000000447'
);
\set manual_authorization_post_handoff_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_a_id',
  'Итоговый синтетический ответ после ручной проверки.',
  'Curator B must not authorize Student A',
  '44000000-0000-4000-8000-000000000448'
);
\set manual_authorization_cross_student_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_a_id',
  'Итоговый синтетический ответ после ручной проверки.',
  'Curator explicitly authorizes one manual send',
  '44000000-0000-4000-8000-000000000449'
)::TEXT AS manual_authorization_a_first
\gset

SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_a_id',
  'Итоговый синтетический ответ после ручной проверки.',
  'Curator explicitly authorizes one manual send',
  '44000000-0000-4000-8000-000000000449'
)::TEXT AS manual_authorization_a_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.authorize_manual_send(
  :'org_a_id',
  :'draft_a_id',
  'Changed authorization text must not reuse the request id.',
  'Curator explicitly authorizes one manual send',
  '44000000-0000-4000-8000-000000000449'
);
\set manual_authorization_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT (
  :'manual_authorization_a_first'::JSONB
    ->> 'manual_send_authorization_id'
)::TEXT AS manual_authorization_a_id
\gset

SELECT pg_temp.assert_true(
  :'manual_authorization_post_handoff_sales_state' <> '00000'
    AND :'manual_authorization_cross_student_state' <> '00000'
    AND :'manual_authorization_replay_mismatch_state' <> '00000'
    AND :'manual_authorization_a_id' =
      (:'manual_authorization_a_replay'::JSONB
        ->> 'manual_send_authorization_id')
    AND (
      SELECT final_text =
          'Итоговый синтетический ответ после ручной проверки.'
        AND authorized_by_membership_id =
            :'curator_a_membership_id'
      FROM platform.manual_send_authorizations
      WHERE organization_id = :'org_a_id'
        AND id = :'manual_authorization_a_id'
    )
    AND (
      SELECT state = 'manual_send_authorized'
      FROM platform.ai_drafts
      WHERE organization_id = :'org_a_id'
        AND id = :'draft_a_id'
    ),
  'manual-send authorization exact-text/current-owner/replay contract failed'
);

-- Provider observation after manual authorization remains separate evidence:
-- one authorization can back at most one outbound message row. Unknown send
-- result records manual reconciliation with no message and never creates or
-- retries an outbound row by itself.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-outbound-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.any',
  '2026-07-29 00:06:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-outbound-observed"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-outbound',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000451'
)::TEXT AS raw_event_a_outbound
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-outbound-duplicate-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound-duplicate',
  'message.any',
  '2026-07-29 00:06:01+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-outbound-duplicate-attempt"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-outbound-duplicate',
  repeat('1', 64),
  '44000000-0000-4000-8000-000000000452'
)::TEXT AS raw_event_a_outbound_duplicate
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'read',
  'synthetic-request-a-ack-wrong-message-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound-wrong',
  'message.ack',
  '2026-07-29 00:06:02+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack-wrong-message","ack":"read"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack-wrong-message',
  repeat('2', 64),
  '44000000-0000-4000-8000-000000000453'
)::TEXT AS raw_event_a_ack_wrong_message
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'read',
  'synthetic-request-a-ack-wrong-session-001',
  'evo-inbox-synthetic-wrong',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:02.5+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack-wrong-session","ack":"read"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack-wrong-session',
  repeat('4', 64),
  '44000000-0000-4000-8000-000000000473'
)::TEXT AS raw_event_a_ack_wrong_session
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'read',
  'synthetic-request-a-ack-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:03+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack","ack":"read"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack',
  repeat('3', 64),
  '44000000-0000-4000-8000-000000000454'
)::TEXT AS raw_event_a_ack
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'read',
  'synthetic-request-a-ack-replay-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:03+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack","ack":"read"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack',
  repeat('3', 64),
  '44000000-0000-4000-8000-000000000474'
)::TEXT AS raw_event_a_ack_replay
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'played',
  'synthetic-request-a-ack-played-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:04+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack","ack":"played"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack-played',
  repeat('5', 64),
  '44000000-0000-4000-8000-000000000475'
)::TEXT AS raw_event_a_ack_played
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'played',
  'synthetic-request-a-ack-played-replay-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:04+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack","ack":"played"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack-played',
  repeat('5', 64),
  '44000000-0000-4000-8000-000000000476'
)::TEXT AS raw_event_a_ack_played_replay
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'future-provider-state',
  'synthetic-request-a-ack-future-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  'message.ack',
  '2026-07-29 00:06:05+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-a-ack","ack":"FUTURE_PROVIDER_STATE"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-ack-future',
  repeat('6', 64),
  '44000000-0000-4000-8000-000000000490'
)::TEXT AS raw_event_a_ack_future
\gset

\set ON_ERROR_STOP off
SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  'read',
  'synthetic-request-a-message-any-variant-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-invalid-variant',
  'message.any',
  '2026-07-29 00:06:06+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-invalid-message-any-variant"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-invalid-message-any-variant',
  repeat('7', 64),
  '44000000-0000-4000-8000-000000000494'
);
\set raw_message_any_variant_state :SQLSTATE

SELECT platform.persist_provider_webhook_event(
  :'org_a_id',
  'waha',
  'synthetic:waha-account:a',
  NULL,
  NULL,
  'synthetic-request-a-ack-null-variant-001',
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-invalid-null-variant',
  'message.ack',
  '2026-07-29 00:06:07+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"synthetic-invalid-ack-null-variant"}'::JSONB,
  '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
  'synthetic:hmac:verified:a-invalid-ack-null-variant',
  repeat('8', 64),
  '44000000-0000-4000-8000-000000000495'
);
\set raw_ack_null_variant_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT
  (:'raw_event_a_outbound'::JSONB
    ->> 'provider_webhook_event_id') AS raw_event_a_outbound_id,
  (:'raw_event_a_outbound_duplicate'::JSONB
    ->> 'provider_webhook_event_id')
      AS raw_event_a_outbound_duplicate_id,
  (:'raw_event_a_ack_wrong_message'::JSONB
    ->> 'provider_webhook_event_id')
      AS raw_event_a_ack_wrong_message_id,
  (:'raw_event_a_ack_wrong_session'::JSONB
    ->> 'provider_webhook_event_id')
      AS raw_event_a_ack_wrong_session_id,
  (:'raw_event_a_ack'::JSONB
    ->> 'provider_webhook_event_id') AS raw_event_a_ack_id,
  (:'raw_event_a_ack_played'::JSONB
    ->> 'provider_webhook_event_id') AS raw_event_a_ack_played_id,
  (:'raw_event_a_ack_future'::JSONB
    ->> 'provider_webhook_event_id') AS raw_event_a_ack_future_id
\gset

SELECT pg_temp.assert_true(
  (:'raw_event_a_ack'::JSONB ->> 'provider_webhook_event_id') =
      (
        :'raw_event_a_ack_replay'::JSONB
          ->> 'provider_webhook_event_id'
      )
    AND (
      :'raw_event_a_ack_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
    AND (:'raw_event_a_ack'::JSONB ->> 'provider_event_variant_ref') =
      'read'
    AND (:'raw_event_a_ack_played'::JSONB
      ->> 'provider_webhook_event_id') =
      (
        :'raw_event_a_ack_played_replay'::JSONB
          ->> 'provider_webhook_event_id'
      )
    AND (
      :'raw_event_a_ack_played_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
    AND (
      :'raw_event_a_ack_played'::JSONB
        ->> 'provider_webhook_event_id'
    ) <> (:'raw_event_a_ack'::JSONB ->> 'provider_webhook_event_id')
    AND (:'raw_event_a_ack_played'::JSONB
      ->> 'provider_event_variant_ref') = 'played'
    AND (:'raw_event_a_ack_future'::JSONB
      ->> 'provider_event_variant_ref') = 'future-provider-state'
    AND :'raw_message_any_variant_state' = '22023'
    AND :'raw_ack_null_variant_state' = '22023',
  'WAHA ACK variant persistence/replay contract failed'
);

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'outbound',
  'Итоговый синтетический ответ после ручной проверки.',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-outbound',
  2001,
  3001,
  4001,
  :'raw_event_a_outbound_id',
  :'manual_authorization_a_id',
  '44000000-0000-4000-8000-000000000455'
)::TEXT AS message_a_outbound_first
\gset

SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'outbound',
  'Итоговый синтетический ответ после ручной проверки.',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-outbound',
  2001,
  3001,
  4001,
  :'raw_event_a_outbound_id',
  :'manual_authorization_a_id',
  '44000000-0000-4000-8000-000000000455'
)::TEXT AS message_a_outbound_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.record_communication_message(
  :'org_a_id',
  :'conversation_a_id',
  'outbound',
  'Итоговый синтетический ответ после ручной проверки.',
  'ru',
  TRUE,
  'evo-inbox-synthetic-a',
  'synthetic-waha-message-a-outbound-duplicate',
  1001,
  'synthetic-kommo-conversation-a',
  'synthetic-kommo-message-a-outbound-duplicate',
  2001,
  3001,
  4001,
  :'raw_event_a_outbound_duplicate_id',
  :'manual_authorization_a_id',
  '44000000-0000-4000-8000-000000000456'
);
\set manual_authorization_second_message_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  NULL,
  :'manual_authorization_a_id',
  'unknown_result',
  'unknown',
  'synthetic:provider-result:unknown',
  '44000000-0000-4000-8000-000000000457'
)::TEXT AS reconciliation_unknown_first
\gset

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  NULL,
  :'manual_authorization_a_id',
  'unknown_result',
  'unknown',
  'synthetic:provider-result:unknown',
  '44000000-0000-4000-8000-000000000477'
)::TEXT AS reconciliation_unknown_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  NULL,
  :'manual_authorization_a_id',
  'unknown_result',
  'unknown',
  'synthetic:provider-result:unknown-mismatched',
  '44000000-0000-4000-8000-000000000478'
);
\set reconciliation_unknown_mismatch_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_b_id',
  :'message_b_admin_outbound_id',
  :'manual_authorization_a_id',
  'unknown_result',
  'unknown',
  'synthetic:provider-result:unknown',
  '44000000-0000-4000-8000-000000000493'
);
\set reconciliation_unknown_context_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  (
    :'message_a_outbound_first'::JSONB
      ->> 'communication_message_id'
  )::UUID,
  NULL,
  'ack_observed',
  'read',
  'synthetic:null-source:ack',
  '44000000-0000-4000-8000-000000000460'
);
\set reconciliation_null_source_ack_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  (
    :'message_a_outbound_first'::JSONB
      ->> 'communication_message_id'
  )::UUID,
  NULL,
  'message_observed',
  NULL,
  'synthetic:null-source:message',
  '44000000-0000-4000-8000-000000000461'
);
\set reconciliation_null_source_message_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  NULL,
  :'conversation_a_id',
  NULL,
  NULL,
  'link_resolved',
  NULL,
  'synthetic:null-source:link',
  '44000000-0000-4000-8000-000000000462'
);
\set reconciliation_null_source_link_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_a_id',
  NULL,
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:without-message',
  '44000000-0000-4000-8000-000000000458'
);
\set reconciliation_ack_without_message_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT (
  :'message_a_outbound_first'::JSONB
    ->> 'communication_message_id'
)::TEXT AS message_a_outbound_id
\gset

\set ON_ERROR_STOP off
SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_outbound_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:wrong-event-type',
  '44000000-0000-4000-8000-000000000479'
);
\set reconciliation_ack_wrong_event_type_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_wrong_message_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:wrong-message',
  '44000000-0000-4000-8000-000000000480'
);
\set reconciliation_ack_wrong_message_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_wrong_session_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:wrong-session',
  '44000000-0000-4000-8000-000000000481'
);
\set reconciliation_ack_wrong_session_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'played',
  'synthetic:provider-ack:wrong-variant',
  '44000000-0000-4000-8000-000000000482'
);
\set reconciliation_ack_wrong_variant_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_future_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:unknown-variant',
  '44000000-0000-4000-8000-000000000491'
);
\set reconciliation_ack_unknown_variant_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_b_id',
  :'message_b_admin_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:wrong-context',
  '44000000-0000-4000-8000-000000000492'
);
\set reconciliation_ack_wrong_context_state :SQLSTATE

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_outbound_duplicate_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'message_observed',
  NULL,
  'synthetic:provider-message:wrong-identity',
  '44000000-0000-4000-8000-000000000483'
);
\set reconciliation_message_wrong_identity_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_outbound_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'message_observed',
  NULL,
  'synthetic:provider-message:observed',
  '44000000-0000-4000-8000-000000000484'
)::TEXT AS reconciliation_message_first
\gset

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:read',
  '44000000-0000-4000-8000-000000000459'
)::TEXT AS reconciliation_ack_first
\gset

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:read',
  '44000000-0000-4000-8000-000000000485'
)::TEXT AS reconciliation_ack_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'read',
  'synthetic:provider-ack:read-mismatched',
  '44000000-0000-4000-8000-000000000486'
);
\set reconciliation_ack_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_played_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'played',
  'synthetic:provider-ack:played',
  '44000000-0000-4000-8000-000000000487'
)::TEXT AS reconciliation_ack_played_first
\gset

SELECT platform.append_provider_reconciliation_event(
  :'org_a_id',
  :'raw_event_a_ack_played_id',
  :'conversation_a_id',
  :'message_a_outbound_id',
  NULL,
  'ack_observed',
  'played',
  'synthetic:provider-ack:played',
  '44000000-0000-4000-8000-000000000488'
)::TEXT AS reconciliation_ack_played_replay
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'message_a_outbound_id' =
      (:'message_a_outbound_replay'::JSONB
        ->> 'communication_message_id')
    AND :'manual_authorization_second_message_state' <> '00000'
    AND :'reconciliation_ack_without_message_state' <> '00000'
    AND :'reconciliation_null_source_ack_state' <> '00000'
    AND :'reconciliation_null_source_message_state' <> '00000'
    AND :'reconciliation_null_source_link_state' <> '00000'
    AND :'reconciliation_unknown_mismatch_state' = '22023'
    AND :'reconciliation_unknown_context_state' = '42501'
    AND :'reconciliation_ack_wrong_event_type_state' = '42501'
    AND :'reconciliation_ack_wrong_message_state' = '42501'
    AND :'reconciliation_ack_wrong_session_state' = '42501'
    AND :'reconciliation_ack_wrong_variant_state' = '42501'
    AND :'reconciliation_ack_unknown_variant_state' = '42501'
    AND :'reconciliation_ack_wrong_context_state' = '42501'
    AND :'reconciliation_message_wrong_identity_state' = '42501'
    AND :'reconciliation_ack_mismatch_state' = '22023'
    AND (
      :'reconciliation_unknown_first'::JSONB
        ->> 'provider_reconciliation_event_id'
    ) = (
      :'reconciliation_unknown_replay'::JSONB
        ->> 'provider_reconciliation_event_id'
    )
    AND (
      :'reconciliation_unknown_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
    AND (
      SELECT count(*) = 1
      FROM platform_private.provider_reconciliation_events
      WHERE organization_id = :'org_a_id'
        AND manual_send_authorization_id =
            :'manual_authorization_a_id'
        AND observation_kind = 'unknown_result'
    )
    AND (
      :'reconciliation_ack_first'::JSONB
        ->> 'provider_reconciliation_event_id'
    ) = (
      :'reconciliation_ack_replay'::JSONB
        ->> 'provider_reconciliation_event_id'
    )
    AND (
      :'reconciliation_ack_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
    AND (
      :'reconciliation_ack_played_first'::JSONB
        ->> 'provider_reconciliation_event_id'
    ) = (
      :'reconciliation_ack_played_replay'::JSONB
        ->> 'provider_reconciliation_event_id'
    )
    AND (
      :'reconciliation_ack_played_replay'::JSONB ->> 'deduplicated'
    )::BOOLEAN
    AND (
      :'reconciliation_ack_played_first'::JSONB
        ->> 'provider_reconciliation_event_id'
    ) <> (
      :'reconciliation_ack_first'::JSONB
        ->> 'provider_reconciliation_event_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform_private.provider_reconciliation_events
      WHERE organization_id = :'org_a_id'
        AND source_webhook_event_id = :'raw_event_a_ack_id'
        AND communication_message_id = :'message_a_outbound_id'
        AND observation_kind = 'ack_observed'
        AND ack_state = 'read'
    )
    AND (
      SELECT count(*) = 1
      FROM platform_private.provider_reconciliation_events
      WHERE organization_id = :'org_a_id'
        AND source_webhook_event_id =
            :'raw_event_a_ack_played_id'
        AND communication_message_id = :'message_a_outbound_id'
        AND observation_kind = 'ack_observed'
        AND ack_state = 'played'
    )
    AND (
      SELECT count(*) = 3
      FROM platform.audit_events
      WHERE organization_id = :'org_a_id'
        AND action = 'communication.provider.observe'
        AND resource_type = 'provider_reconciliation_event'
        AND request_id IN (
          '44000000-0000-4000-8000-000000000477'::UUID,
          '44000000-0000-4000-8000-000000000485'::UUID,
          '44000000-0000-4000-8000-000000000488'::UUID
        )
        AND (after_state ->> 'deduplicated')::BOOLEAN
    )
    AND (
      SELECT communication_message_id = :'message_a_outbound_id'
        AND observation_kind = 'message_observed'
        AND ack_state IS NULL
      FROM platform_private.provider_reconciliation_events
      WHERE id = (
        :'reconciliation_message_first'::JSONB
          ->> 'provider_reconciliation_event_id'
      )::UUID
    )
    AND (
      SELECT count(*) = 1
      FROM platform.communication_messages
      WHERE organization_id = :'org_a_id'
        AND direction = 'outbound'
        AND manual_send_authorization_id =
            :'manual_authorization_a_id'
    )
    AND (
      SELECT requires_manual_review
        AND communication_message_id IS NULL
        AND manual_send_authorization_id =
            :'manual_authorization_a_id'
        AND ack_state = 'unknown'
      FROM platform_private.provider_reconciliation_events
      WHERE id = (
        :'reconciliation_unknown_first'::JSONB
          ->> 'provider_reconciliation_event_id'
      )::UUID
    )
    AND (
      SELECT NOT requires_manual_review
        AND communication_message_id =
            :'message_a_outbound_id'
        AND manual_send_authorization_id IS NULL
        AND ack_state = 'read'
      FROM platform_private.provider_reconciliation_events
      WHERE id = (
        :'reconciliation_ack_first'::JSONB
          ->> 'provider_reconciliation_event_id'
      )::UUID
    )
    AND (
      SELECT NOT requires_manual_review
        AND communication_message_id =
            :'message_a_outbound_id'
        AND manual_send_authorization_id IS NULL
        AND ack_state = 'played'
      FROM platform_private.provider_reconciliation_events
      WHERE id = (
        :'reconciliation_ack_played_first'::JSONB
          ->> 'provider_reconciliation_event_id'
      )::UUID
    ),
  'manual authorization/provider observation idempotency and correlation failed'
);

-- The existing Admin assignment command is the sole authority for admissions
-- ownership. Its assignment-event INSERT must atomically rescope every linked
-- conversation; no second communication synchronization RPC is allowed.
SELECT
  current_scope_id AS org_b_scope_before_assignment,
  current_scope_version::TEXT AS org_b_scope_version_before_assignment
FROM platform.student_cases
WHERE organization_id = :'org_b_id'
  AND id = :'org_b_case_id'
\gset

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'org_b_id',
  :'org_b_case_id',
  :'org_b_curator_membership_id',
  'Initial Curator assignment must atomically hand off communication',
  '44000000-0000-4000-8000-000000000467'
)::TEXT AS org_b_initial_assignment
\gset
RESET ROLE;

SELECT
  assignment.id AS org_b_initial_assignment_event_id,
  assignment.new_scope_id AS org_b_initial_assignment_scope_id,
  assignment.new_scope_version::TEXT
    AS org_b_initial_assignment_scope_version
FROM platform.student_case_assignment_events AS assignment
WHERE assignment.organization_id = :'org_b_id'
  AND assignment.request_id =
      '44000000-0000-4000-8000-000000000467'
\gset

SELECT
  profile.access_version AS org_b_sales_after_assignment_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id =
    '42000000-0000-4000-8000-000000000007'
\gset
SELECT
  profile.access_version AS org_b_curator_after_assignment_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id =
    '42000000-0000-4000-8000-000000000008'
\gset

SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000007',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version',
    :'org_b_sales_after_assignment_access_version'::BIGINT
)::TEXT AS org_b_sales_after_assignment_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version',
    :'org_b_curator_after_assignment_access_version'::BIGINT
)::TEXT AS org_b_curator_after_assignment_claims
\gset

SELECT pg_temp.assert_true(
  (
    SELECT case_row.state = 'active'
      AND case_row.portal_activated_at IS NOT NULL
      AND case_row.current_curator_membership_id =
          :'org_b_curator_membership_id'
      AND case_row.current_scope_id =
          :'org_b_initial_assignment_scope_id'
      AND case_row.current_scope_version =
          :'org_b_initial_assignment_scope_version'::BIGINT
      AND case_row.current_scope_id <>
          :'org_b_scope_before_assignment'
      AND case_row.current_scope_version >
          :'org_b_scope_version_before_assignment'::BIGINT
    FROM platform.student_cases AS case_row
    WHERE case_row.organization_id = :'org_b_id'
      AND case_row.id = :'org_b_case_id'
  )
    AND (
      SELECT conversation.queue = 'curator'
        AND conversation.student_case_id = :'org_b_case_id'
        AND conversation.current_curator_membership_id =
            :'org_b_curator_membership_id'
        AND conversation.current_scope_id =
            :'org_b_initial_assignment_scope_id'
        AND conversation.current_scope_version =
            :'org_b_initial_assignment_scope_version'::BIGINT
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = :'org_b_id'
        AND conversation.id = :'conversation_org_b_id'
    )
    AND (
      SELECT handoff.previous_queue = 'sales'
        AND handoff.new_queue = 'curator'
        AND handoff.previous_owner_membership_id =
            :'org_b_sales_membership_id'
        AND handoff.new_owner_membership_id =
            :'org_b_curator_membership_id'
        AND handoff.source_webhook_event_id IS NULL
        AND handoff.student_case_assignment_event_id =
            :'org_b_initial_assignment_event_id'
      FROM platform.conversation_handoff_events AS handoff
      WHERE handoff.organization_id = :'org_b_id'
        AND handoff.conversation_id = :'conversation_org_b_id'
        AND handoff.student_case_assignment_event_id =
            :'org_b_initial_assignment_event_id'
    ),
  'initial Admin assignment did not atomically rescope the conversation'
);

SET request.jwt.claims TO :'org_b_sales_after_assignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_sales_after_assignment_conversation_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
SELECT count(*)::TEXT AS org_b_sales_after_assignment_message_count
FROM platform.communication_messages
WHERE conversation_id = :'conversation_org_b_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_curator_after_assignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_curator_after_assignment_conversation_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
SELECT count(*)::TEXT AS org_b_curator_after_assignment_message_count
FROM platform.communication_messages
WHERE conversation_id = :'conversation_org_b_id'
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'org_b_sales_after_assignment_conversation_count'::INTEGER = 0
    AND :'org_b_sales_after_assignment_message_count'::INTEGER = 0
    AND :'org_b_curator_after_assignment_conversation_count'::INTEGER = 1
    AND :'org_b_curator_after_assignment_message_count'::INTEGER = 1,
  'initial assignment left Sales transcript access or denied the new Curator'
);

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'org_b_id',
  :'org_b_case_id',
  :'p2f_org_b_second_curator_membership_id',
  'Curator reassignment must atomically rotate communication ownership',
  '44000000-0000-4000-8000-000000000468'
)::TEXT AS org_b_reassignment
\gset
RESET ROLE;

SELECT
  assignment.id AS org_b_reassignment_event_id,
  assignment.previous_scope_id AS org_b_reassignment_previous_scope_id,
  assignment.new_scope_id AS org_b_reassignment_scope_id,
  assignment.new_scope_version::TEXT AS org_b_reassignment_scope_version
FROM platform.student_case_assignment_events AS assignment
WHERE assignment.organization_id = :'org_b_id'
  AND assignment.request_id =
      '44000000-0000-4000-8000-000000000468'
\gset

SELECT
  profile.access_version AS org_b_old_curator_after_reassignment_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id =
    '42000000-0000-4000-8000-000000000008'
\gset
SELECT
  profile.access_version AS org_b_new_curator_after_reassignment_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id =
    :'p2f_org_b_second_curator_user_id'
\gset

SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version',
    :'org_b_old_curator_after_reassignment_access_version'::BIGINT
)::TEXT AS org_b_old_curator_after_reassignment_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p2f_org_b_second_curator_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version',
    :'org_b_new_curator_after_reassignment_access_version'::BIGINT
)::TEXT AS org_b_new_curator_after_reassignment_claims
\gset
SELECT jsonb_build_object(
  'sub', :'p2f_org_b_second_curator_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version',
    :'p2f_org_b_second_curator_access_version'::BIGINT
)::TEXT AS org_b_new_curator_preassignment_claims
\gset

SET request.jwt.claims TO :'org_b_curator_after_assignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_old_curator_held_claim_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
RESET ROLE;
SET request.jwt.claims TO :'org_b_old_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_old_curator_fresh_claim_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
RESET ROLE;
SET request.jwt.claims TO :'org_b_new_curator_preassignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_new_curator_held_claim_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
RESET ROLE;
SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_new_curator_fresh_conversation_count
FROM platform.communication_conversations
WHERE id = :'conversation_org_b_id'
\gset
SELECT count(*)::TEXT AS org_b_new_curator_fresh_message_count
FROM platform.communication_messages
WHERE conversation_id = :'conversation_org_b_id'
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT case_row.current_curator_membership_id =
          :'p2f_org_b_second_curator_membership_id'
      AND case_row.current_scope_id =
          :'org_b_reassignment_scope_id'
      AND case_row.current_scope_version =
          :'org_b_reassignment_scope_version'::BIGINT
    FROM platform.student_cases AS case_row
    WHERE case_row.organization_id = :'org_b_id'
      AND case_row.id = :'org_b_case_id'
  )
    AND (
      SELECT conversation.queue = 'curator'
        AND conversation.current_curator_membership_id =
            :'p2f_org_b_second_curator_membership_id'
        AND conversation.current_scope_id =
            :'org_b_reassignment_scope_id'
        AND conversation.current_scope_version =
            :'org_b_reassignment_scope_version'::BIGINT
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = :'org_b_id'
        AND conversation.id = :'conversation_org_b_id'
    )
    AND :'org_b_reassignment_previous_scope_id' =
        :'org_b_initial_assignment_scope_id'
    AND (
      SELECT handoff.previous_queue = 'curator'
        AND handoff.new_queue = 'curator'
        AND handoff.previous_owner_membership_id =
            :'org_b_curator_membership_id'
        AND handoff.new_owner_membership_id =
            :'p2f_org_b_second_curator_membership_id'
        AND handoff.source_webhook_event_id IS NULL
        AND handoff.student_case_assignment_event_id =
            :'org_b_reassignment_event_id'
      FROM platform.conversation_handoff_events AS handoff
      WHERE handoff.organization_id = :'org_b_id'
        AND handoff.conversation_id = :'conversation_org_b_id'
        AND handoff.student_case_assignment_event_id =
            :'org_b_reassignment_event_id'
    )
    AND (
      SELECT count(*) = 2
      FROM platform.conversation_handoff_events AS handoff
      WHERE handoff.organization_id = :'org_b_id'
        AND handoff.conversation_id = :'conversation_org_b_id'
        AND handoff.student_case_assignment_event_id IS NOT NULL
    )
    AND :'org_b_old_curator_held_claim_count'::INTEGER = 0
    AND :'org_b_old_curator_fresh_claim_count'::INTEGER = 0
    AND :'org_b_new_curator_held_claim_count'::INTEGER = 0
    AND :'org_b_new_curator_fresh_conversation_count'::INTEGER = 1
    AND :'org_b_new_curator_fresh_message_count'::INTEGER = 1,
  'Admin reassignment did not atomically rotate communication scope'
);

-- Fixed projections expose only the role-appropriate contract. Staff receive
-- full rows only for current queue ownership, former Sales receive exactly the
-- nonsensitive case summary, Students receive their own visible Portal rows,
-- and approved knowledge excludes retired versions.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS admin_a_staff_queue_count
FROM platform.staff_communication_page(:'org_a_id', 101, NULL, NULL, NULL, NULL, NULL)
\gset
SELECT count(*)::TEXT AS admin_a_staff_message_a_count
FROM platform.staff_conversation_message_page(
  :'org_a_id',
  :'conversation_a_id',
  201,
  NULL,
  NULL
)
\gset
SELECT count(*)::TEXT AS admin_a_knowledge_catalog_count
FROM platform.approved_knowledge_catalog(:'org_a_id')
\gset
SELECT
  knowledge_version_id AS admin_a_catalog_knowledge_version_id,
  version::TEXT AS admin_a_catalog_version,
  provenance_ref AS admin_a_catalog_provenance_ref
FROM platform.approved_knowledge_catalog(:'org_a_id')
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_a_staff_queue_count
FROM platform.staff_communication_page(:'org_a_id', 101, NULL, NULL, NULL, NULL, NULL)
\gset
SELECT count(*)::TEXT AS curator_a_staff_message_a_count
FROM platform.staff_conversation_message_page(
  :'org_a_id',
  :'conversation_a_id',
  201,
  NULL,
  NULL
)
\gset
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_conversation_message_page(
  :'org_a_id',
  :'conversation_b_id',
  201,
  NULL,
  NULL
);
\set curator_a_cross_student_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_b_staff_queue_count
FROM platform.staff_communication_page(:'org_a_id', 101, NULL, NULL, NULL, NULL, NULL)
\gset
SELECT count(*)::TEXT AS curator_b_staff_message_b_count
FROM platform.staff_conversation_message_page(
  :'org_a_id',
  :'conversation_b_id',
  201,
  NULL,
  NULL
)
\gset
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS sales_a_staff_queue_after_handoff_count
FROM platform.staff_communication_page(:'org_a_id', 101, NULL, NULL, NULL, NULL, NULL)
\gset
SELECT count(*)::TEXT AS sales_a_former_summary_count
FROM platform.former_sales_case_summaries(:'org_a_id')
\gset
SELECT
  student_case_id AS sales_a_summary_case_id,
  (handoff_at IS NOT NULL)::TEXT AS sales_a_summary_has_handoff
FROM platform.former_sales_case_summaries(:'org_a_id')
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_sales_after_assignment_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS org_b_sales_former_summary_count
FROM platform.former_sales_case_summaries(:'org_b_id')
\gset
SELECT
  student_case_id AS org_b_sales_summary_case_id,
  (handoff_at IS NOT NULL)::TEXT AS org_b_sales_summary_has_handoff
FROM platform.former_sales_case_summaries(:'org_b_id')
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS student_a_portal_message_count
FROM platform.student_portal_messages(:'org_a_id')
\gset
SELECT count(*)::TEXT AS student_a_portal_sensitive_count
FROM platform.student_portal_messages(:'org_a_id')
WHERE body_text =
    'Synthetic sensitive customer context for staff only.'
\gset
SELECT count(*)::TEXT AS student_a_portal_cross_student_count
FROM platform.student_portal_messages(:'org_a_id')
WHERE student_case_id <> :'case_a_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS student_b_portal_message_count
FROM platform.student_portal_messages(:'org_a_id')
\gset
SELECT count(*)::TEXT AS student_b_portal_cross_student_count
FROM platform.student_portal_messages(:'org_a_id')
WHERE student_case_id <> :'case_b_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*)
FROM platform.staff_communication_page(:'org_a_id', 101, NULL, NULL, NULL, NULL, NULL);
\set finance_staff_queue_projection_state :SQLSTATE
SELECT count(*) FROM platform.former_sales_case_summaries(:'org_a_id');
\set finance_former_summary_projection_state :SQLSTATE
SELECT count(*) FROM platform.student_portal_messages(:'org_a_id');
\set finance_portal_projection_state :SQLSTATE
SELECT count(*) FROM platform.approved_knowledge_catalog(:'org_a_id');
\set finance_knowledge_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.approved_knowledge_catalog(:'org_a_id');
\set student_knowledge_projection_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'admin_a_staff_queue_count'::INTEGER = 2
    AND :'admin_a_staff_message_a_count'::INTEGER = 3
    AND :'curator_a_staff_queue_count'::INTEGER = 1
    AND :'curator_a_staff_message_a_count'::INTEGER = 3
    AND :'curator_a_cross_student_projection_state' <> '00000'
    AND :'curator_b_staff_queue_count'::INTEGER = 1
    AND :'curator_b_staff_message_b_count'::INTEGER = 2
    AND :'sales_a_staff_queue_after_handoff_count'::INTEGER = 0,
  'staff queue or transcript projection scope failed'
);

SELECT pg_temp.assert_true(
  :'sales_a_former_summary_count'::INTEGER = 1
    AND :'sales_a_summary_case_id' = :'case_a_id'
    AND :'sales_a_summary_has_handoff'::BOOLEAN
    AND :'org_b_sales_former_summary_count'::INTEGER = 1
    AND :'org_b_sales_summary_case_id' = :'org_b_case_id'
    AND :'org_b_sales_summary_has_handoff'::BOOLEAN,
  'former-Sales nonsensitive case summary projection failed'
);

SELECT pg_temp.assert_true(
  :'student_a_portal_message_count'::INTEGER = 2
    AND :'student_a_portal_sensitive_count'::INTEGER = 0
    AND :'student_a_portal_cross_student_count'::INTEGER = 0
    AND :'student_b_portal_message_count'::INTEGER = 2
    AND :'student_b_portal_cross_student_count'::INTEGER = 0,
  'Student Portal visible-message isolation projection failed'
);

SELECT pg_temp.assert_true(
  :'finance_staff_queue_projection_state' <> '00000'
    AND :'finance_former_summary_projection_state' <> '00000'
    AND :'finance_portal_projection_state' <> '00000'
    AND :'finance_knowledge_projection_state' <> '00000'
    AND :'student_knowledge_projection_state' <> '00000',
  'unauthorized role projection did not fail closed'
);

SELECT pg_temp.assert_true(
  :'admin_a_knowledge_catalog_count'::INTEGER = 1
    AND :'admin_a_catalog_knowledge_version_id' = :'knowledge_v2_id'
    AND :'admin_a_catalog_version'::BIGINT = 2
    AND :'admin_a_catalog_provenance_ref' =
        'synthetic:provenance:knowledge:v2',
  'approved-only knowledge catalog projection failed'
);

-- Base AI evidence is full-transcript scoped. Current Curators see only their
-- assigned Student evidence; Finance, Students, former Curators and Sales do
-- not inherit draft or manual-authorization rows.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS admin_a_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_a_ai_draft_count
FROM platform.ai_drafts
\gset
SELECT count(*)::TEXT AS curator_a_manual_authorization_count
FROM platform.manual_send_authorizations
\gset
RESET ROLE;
SET request.jwt.claims TO :'curator_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS curator_b_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;
SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS finance_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;
SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS student_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;
SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS sales_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;
SET request.jwt.claims TO :'previous_curator_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS previous_curator_ai_draft_count
FROM platform.ai_drafts
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'admin_a_ai_draft_count'::INTEGER = 3
    AND :'curator_a_ai_draft_count'::INTEGER = 1
    AND :'curator_a_manual_authorization_count'::INTEGER = 1
    AND :'curator_b_ai_draft_count'::INTEGER = 2
    AND :'finance_ai_draft_count'::INTEGER = 0
    AND :'student_ai_draft_count'::INTEGER = 0
    AND :'sales_ai_draft_count'::INTEGER = 0
    AND :'previous_curator_ai_draft_count'::INTEGER = 0,
  'AI draft/full-transcript RLS leaked across role or Student scope'
);

-- Ledger rows are immutable even to the database owner. Trigger-backed
-- UPDATE/DELETE/TRUNCATE denial complements the catalog trigger inventory.
\set ON_ERROR_STOP off
UPDATE platform.communication_messages
SET body_text = 'Forbidden owner rewrite'
WHERE id = :'message_a_visible_id';
\set owner_message_update_state :SQLSTATE
DELETE FROM platform.conversation_handoff_events
WHERE organization_id = :'org_b_id'
  AND student_case_assignment_event_id =
      :'org_b_initial_assignment_event_id';
\set owner_handoff_delete_state :SQLSTATE
UPDATE platform_private.provider_webhook_events
SET event_type = 'forbidden.rewrite'
WHERE id = :'raw_event_a_id';
\set owner_raw_update_state :SQLSTATE
DELETE FROM platform_private.provider_reconciliation_events
WHERE id = (
  :'reconciliation_ack_first'::JSONB
    ->> 'provider_reconciliation_event_id'
)::UUID;
\set owner_reconciliation_delete_state :SQLSTATE
UPDATE platform.ai_draft_events
SET reason = 'Forbidden owner rewrite'
WHERE ai_draft_id = :'draft_a_id';
\set owner_ai_event_update_state :SQLSTATE
DELETE FROM platform.manual_send_authorizations
WHERE id = :'manual_authorization_a_id';
\set owner_manual_authorization_delete_state :SQLSTATE
TRUNCATE TABLE platform.communication_messages CASCADE;
\set owner_message_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'owner_message_update_state' = '55000'
    AND :'owner_handoff_delete_state' = '55000'
    AND :'owner_raw_update_state' = '55000'
    AND :'owner_reconciliation_delete_state' = '55000'
    AND :'owner_ai_event_update_state' = '55000'
    AND :'owner_manual_authorization_delete_state' = '55000'
    AND :'owner_message_truncate_state' = '55000',
  'append-only P2F ledger mutation succeeded as owner'
);

\echo 'P2F communications/provider/draft-only RLS acceptance passed'
