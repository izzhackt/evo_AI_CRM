\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P4R1 acceptance is synthetic and stays inside disposable PostgreSQL. It
-- proves grants, replay, append-only behavior and staff visibility without a
-- provider call, amoCRM write, Docker runtime or production secret.
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
    RAISE EXCEPTION 'P4R1 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS p4r1_org_a,
  membership.id AS p4r1_admin_a_membership,
  profile.access_version AS p4r1_admin_a_access_version,
  (
    SELECT (audit.before_state ->> 'access_version')::BIGINT
    FROM platform.audit_events AS audit
    WHERE audit.action = 'rbac.bundle.upgrade'
      AND audit.resource_id = membership.id
      AND audit.actor_principal =
        'migration:044_platform_communications_contracts'
  ) AS p4r1_admin_a_stale_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS p4r1_org_b,
  membership.id AS p4r1_admin_b_membership,
  profile.access_version AS p4r1_admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS p4r1_case_a_id,
  student_case.responsible_sales_membership_id AS p4r1_case_a_sales_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'p4r1_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.student_membership_id AS p4r1_case_b_student_membership_id,
  student_case.responsible_sales_membership_id AS p4r1_case_b_sales_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'p4r1_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.id AS p4r1_org_b_case_id,
  student_case.responsible_sales_membership_id
    AS p4r1_org_b_sales_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'p4r1_org_b'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT profile.access_version AS p4r1_curator_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset

SELECT profile.access_version AS p4r1_finance_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000005'
\gset

SELECT profile.access_version AS p4r1_student_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4r1_admin_a_access_version'::BIGINT
)::TEXT AS p4r1_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4r1_admin_a_stale_access_version'::BIGINT
)::TEXT AS p4r1_admin_a_stale_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4r1_admin_b_access_version'::BIGINT
)::TEXT AS p4r1_admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'p4r1_curator_a_access_version'::BIGINT
)::TEXT AS p4r1_curator_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'p4r1_finance_a_access_version'::BIGINT
)::TEXT AS p4r1_finance_a_claims
\gset
SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'p4r1_student_a_access_version'::BIGINT
)::TEXT AS p4r1_student_a_claims
\gset
SELECT '{"role":"service_role"}'::TEXT AS p4r1_service_claims \gset
SELECT '{"role":"anon"}'::TEXT AS p4r1_anon_claims \gset

SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'platform.record_amocrm_canonical_context_observation(uuid,uuid,uuid,text,text,bigint,bigint,bigint,text,text,bigint,text,boolean,text,bigint,text,bigint,text,text[],timestamp with time zone,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.record_amocrm_canonical_context_observation(uuid,uuid,uuid,text,text,bigint,bigint,bigint,text,text,bigint,text,boolean,text,bigint,text,bigint,text,text[],timestamp with time zone,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.record_amocrm_canonical_context_observation(uuid,uuid,uuid,text,text,bigint,bigint,bigint,text,text,bigint,text,boolean,text,bigint,text,bigint,text,text[],timestamp with time zone,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_amocrm_canonical_context(uuid,uuid)',
    'EXECUTE'
  ),
  'service and staff execute grants drifted'
);

SET request.jwt.claims TO :'p4r1_service_claims';
SET ROLE service_role;

-- The shared fixture's original Sales-B case may have advanced beyond the
-- pending Sales queue in earlier stateful acceptance suites. Create a fresh,
-- transaction-local pending case so this test proves positive Sales access
-- without weakening the production full-conversation authority predicate.
SELECT platform.create_pending_student_case(
  :'p4r1_org_a',
  :'p4r1_case_b_student_membership_id',
  :'p4r1_case_b_sales_membership_id',
  'synthetic:p4r1:amocrm:lead:sales-b',
  'synthetic:p4r1:contract:sales-b',
  '2026-08-10 08:55:00+06'::TIMESTAMPTZ,
  'Synthetic P4R1 Sales Student',
  'Synthetic Country',
  'Synthetic Degree',
  'Synthetic Program',
  '2027-P4R1',
  'RU',
  'synthetic-funded',
  'contract_confirmed',
  'Sales queue acceptance proof',
  '64000000-0000-4000-8000-000000000000'
)::TEXT AS p4r1_case_b
\gset

SELECT
  (:'p4r1_case_b'::JSONB ->> 'student_case_id')::UUID AS p4r1_case_b_id
\gset

-- Scope creation rotates the responsible Sales profile access version. Build
-- the positive-read JWT only after that rotation so the proof uses live
-- authority rather than a deliberately stale claim.
SELECT
  (:'p4r1_case_b'::JSONB ->> 'sales_access_version')::BIGINT
    AS p4r1_sales_b_access_version
\gset

SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p4r1_sales_b_access_version'::BIGINT
)::TEXT AS p4r1_sales_b_claims
\gset

SELECT platform.persist_provider_webhook_event(
  :'p4r1_org_a',
  'waha',
  'synthetic:p4r1:waha-account:a',
  NULL,
  NULL,
  'synthetic:p4r1:request:a',
  'evo-inbox-p4r1-a',
  'synthetic-p4r1-message-a',
  'message.any',
  '2026-08-10 09:00:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"p4r1-a"}'::JSONB,
  '{"x-webhook-hmac":"synthetic"}'::JSONB,
  'synthetic:p4r1:hmac:a',
  repeat('a', 64),
  '64000000-0000-4000-8000-000000000001'
)::TEXT AS p4r1_raw_event_a
\gset

SELECT platform.persist_provider_webhook_event(
  :'p4r1_org_a',
  'waha',
  'synthetic:p4r1:waha-account:b',
  NULL,
  NULL,
  'synthetic:p4r1:request:b',
  'evo-inbox-p4r1-b',
  'synthetic-p4r1-message-b',
  'message.any',
  '2026-08-10 09:05:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"p4r1-b"}'::JSONB,
  '{"x-webhook-hmac":"synthetic"}'::JSONB,
  'synthetic:p4r1:hmac:b',
  repeat('b', 64),
  '64000000-0000-4000-8000-000000000002'
)::TEXT AS p4r1_raw_event_b
\gset

SELECT platform.persist_provider_webhook_event(
  :'p4r1_org_b',
  'waha',
  'synthetic:p4r1:waha-account:org-b',
  NULL,
  NULL,
  'synthetic:p4r1:request:org-b',
  'evo-inbox-p4r1-org-b',
  'synthetic-p4r1-message-org-b',
  'message.any',
  '2026-08-10 09:06:00+06'::TIMESTAMPTZ,
  'verified',
  '{"event":"p4r1-org-b"}'::JSONB,
  '{"x-webhook-hmac":"synthetic"}'::JSONB,
  'synthetic:p4r1:hmac:org-b',
  repeat('c', 64),
  '64000000-0000-4000-8000-000000000003'
)::TEXT AS p4r1_raw_event_org_b
\gset

SELECT platform.create_communication_conversation(
  :'p4r1_org_a',
  :'p4r1_case_a_id',
  :'p4r1_case_a_sales_membership_id',
  'Synthetic P4R1 curator conversation',
  'evo-inbox-p4r1-a',
  2201,
  'synthetic-p4r1-kommo-a',
  3201,
  4201,
  5201,
  (:'p4r1_raw_event_a'::JSONB ->> 'provider_webhook_event_id')::UUID,
  '64000000-0000-4000-8000-000000000011'
)::TEXT AS p4r1_conversation_a
\gset

SELECT platform.create_communication_conversation(
  :'p4r1_org_a',
  :'p4r1_case_b_id',
  :'p4r1_case_b_sales_membership_id',
  'Synthetic P4R1 sales conversation',
  'evo-inbox-p4r1-b',
  2201,
  'synthetic-p4r1-kommo-b',
  3201,
  4202,
  5202,
  (:'p4r1_raw_event_b'::JSONB ->> 'provider_webhook_event_id')::UUID,
  '64000000-0000-4000-8000-000000000012'
)::TEXT AS p4r1_conversation_b
\gset

SELECT platform.create_communication_conversation(
  :'p4r1_org_b',
  :'p4r1_org_b_case_id',
  :'p4r1_org_b_sales_membership_id',
  'Synthetic P4R1 org-b conversation',
  'evo-inbox-p4r1-org-b',
  2202,
  'synthetic-p4r1-kommo-org-b',
  3202,
  4203,
  5203,
  (:'p4r1_raw_event_org_b'::JSONB ->> 'provider_webhook_event_id')::UUID,
  '64000000-0000-4000-8000-000000000013'
)::TEXT AS p4r1_conversation_org_b
\gset

SELECT
  (:'p4r1_conversation_a'::JSONB ->> 'communication_conversation_id')::UUID
    AS p4r1_conversation_a_id,
  (:'p4r1_conversation_b'::JSONB ->> 'communication_conversation_id')::UUID
    AS p4r1_conversation_b_id,
  (:'p4r1_conversation_org_b'::JSONB
    ->> 'communication_conversation_id')::UUID AS p4r1_conversation_org_b_id
\gset

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000101',
  'available',
  NULL,
  3201,
  5202,
  4202,
  'Synthetic Contact B',
  'Synthetic Lead B',
  NULL,
  NULL,
  NULL,
  'not_assigned',
  7101,
  'Synthetic Pipeline B',
  8101,
  'Synthetic Status B',
  ARRAY[
    'account.read',
    'contact.read',
    'lead.read',
    'pipeline.read'
  ]::TEXT[],
  '2026-08-10 09:10:00+06'::TIMESTAMPTZ,
  1
)::TEXT AS p4r1_available_b_first
\gset

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000101',
  'available',
  NULL,
  3201,
  5202,
  4202,
  'Synthetic Contact B',
  'Synthetic Lead B',
  NULL,
  NULL,
  NULL,
  'not_assigned',
  7101,
  'Synthetic Pipeline B',
  8101,
  'Synthetic Status B',
  ARRAY[
    'account.read',
    'contact.read',
    'lead.read',
    'pipeline.read'
  ]::TEXT[],
  '2026-08-10 09:10:00+06'::TIMESTAMPTZ,
  1
)::TEXT AS p4r1_available_b_replay
\gset

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_a_id',
  '64000000-0000-4000-8000-000000000102',
  'degraded',
  'responsible_user_forbidden',
  3201,
  5201,
  4201,
  'Synthetic Contact A',
  'Synthetic Lead A',
  NULL,
  NULL,
  NULL,
  'permission_denied',
  7102,
  'Synthetic Pipeline A',
  8102,
  'Synthetic Status A',
  ARRAY[
    'account.read',
    'contact.read',
    'lead.read',
    'pipeline.read'
  ]::TEXT[],
  '2026-08-10 09:11:00+06'::TIMESTAMPTZ,
  1
)::TEXT AS p4r1_degraded_a
\gset

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000103',
  'failed',
  'provider_timeout',
  3201,
  5202,
  4202,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  ARRAY[]::TEXT[],
  NULL,
  1
)::TEXT AS p4r1_stale_b
\gset

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_b',
  :'p4r1_conversation_org_b_id',
  '64000000-0000-4000-8000-000000000104',
  'failed',
  'provider_http_error',
  3202,
  5203,
  4203,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  ARRAY[]::TEXT[],
  NULL,
  1
)::TEXT AS p4r1_unavailable_org_b
\gset

\set ON_ERROR_STOP off
SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000101',
  'available',
  NULL,
  3201,
  5202,
  4202,
  'Changed Contact B',
  'Synthetic Lead B',
  NULL,
  NULL,
  NULL,
  'not_assigned',
  7101,
  'Synthetic Pipeline B',
  8101,
  'Synthetic Status B',
  ARRAY[
    'account.read',
    'contact.read',
    'lead.read',
    'pipeline.read'
  ]::TEXT[],
  '2026-08-10 09:10:00+06'::TIMESTAMPTZ,
  1
);
\set p4r1_replay_conflict_state :SQLSTATE

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000105',
  'available',
  NULL,
  9999,
  5202,
  4202,
  'Synthetic Contact B',
  'Synthetic Lead B',
  NULL,
  NULL,
  NULL,
  'not_assigned',
  7101,
  'Synthetic Pipeline B',
  8101,
  'Synthetic Status B',
  ARRAY[
    'account.read',
    'contact.read',
    'lead.read',
    'pipeline.read'
  ]::TEXT[],
  '2026-08-10 09:10:00+06'::TIMESTAMPTZ,
  1
);
\set p4r1_binding_mismatch_state :SQLSTATE

SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_b',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000106',
  'failed',
  'provider_unreachable',
  3201,
  5202,
  4202,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  ARRAY[]::TEXT[],
  NULL,
  1
);
\set p4r1_org_mismatch_state :SQLSTATE

SET request.jwt.claims TO :'p4r1_admin_a_claims';
SET ROLE authenticated;
SELECT platform.record_amocrm_canonical_context_observation(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id',
  '64000000-0000-4000-8000-000000000107',
  'failed',
  'provider_unreachable',
  3201,
  5202,
  4202,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  ARRAY[]::TEXT[],
  NULL,
  1
);
\set p4r1_authenticated_record_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4r1_replay_conflict_state' = '23505'
  AND :'p4r1_binding_mismatch_state' = '42501'
  AND :'p4r1_org_mismatch_state' = '42501'
  AND :'p4r1_authenticated_record_state' = '42501'
  AND :'p4r1_available_b_first' = :'p4r1_available_b_replay',
  'service replay/conflict/binding authorization drifted'
);

RESET ROLE;

SELECT pg_temp.assert_true(
  (
    :'p4r1_available_b_first'::JSONB ->> 'state'
  ) = 'available'
  AND (
    :'p4r1_available_b_first'::JSONB ->> 'responsible_user_resolution'
  ) = 'not_assigned'
  AND (
    :'p4r1_degraded_a'::JSONB ->> 'state'
  ) = 'degraded'
  AND (
    :'p4r1_degraded_a'::JSONB ->> 'reason_code'
  ) = 'responsible_user_forbidden'
  AND (
    :'p4r1_stale_b'::JSONB ->> 'state'
  ) = 'stale'
  AND (
    :'p4r1_stale_b'::JSONB ->> 'reason_code'
  ) = 'provider_timeout'
  AND (
    :'p4r1_stale_b'::JSONB ->> 'contact_name'
  ) = 'Synthetic Contact B'
  AND (
    :'p4r1_unavailable_org_b'::JSONB ->> 'state'
  ) = 'unavailable'
  AND (
    :'p4r1_unavailable_org_b'::JSONB ->> 'contact_name'
  ) IS NULL,
  'writer projection contract drifted'
);

SELECT
  current_projection.*
FROM platform_private.amocrm_canonical_context_current AS current_projection
WHERE current_projection.organization_id = :'p4r1_org_a'
  AND current_projection.conversation_id = :'p4r1_conversation_b_id'
\gset

SELECT pg_temp.assert_true(
  :'state' = 'stale'
  AND :'reason_code' = 'provider_timeout'
  AND :'contact_name' = 'Synthetic Contact B'
  AND :'provider_observed_at' = '2026-08-10 03:10:00+00'
  AND :'adapter_contract_version' = '1'
  AND :'amocrm_account_id' = '3201'
  AND :'amocrm_contact_id' = '5202'
  AND :'amocrm_lead_id' = '4202'
  AND :'pipeline_id' = '7101'
  AND :'status_id' = '8101'
  AND :'observed_capabilities' = '{account.read,contact.read,lead.read,pipeline.read}'
  AND :'version' = '2',
  'private current stale fallback lost provider relationship evidence'
);

SELECT observed_capabilities
FROM platform_private.amocrm_canonical_context_observations
WHERE request_id = '64000000-0000-4000-8000-000000000101'
\gset

SELECT pg_temp.assert_true(
  :'observed_capabilities' = '{account.read,contact.read,lead.read,pipeline.read}',
  'observed capabilities were not normalized exactly'
);

SET request.jwt.claims TO :'p4r1_admin_a_claims';
SET ROLE authenticated;
SELECT row_to_json(context_row)::JSONB AS p4r1_admin_sales_context
FROM platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
) AS context_row
\gset
SELECT row_to_json(context_row)::JSONB AS p4r1_admin_curator_context
FROM platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_a_id'
) AS context_row
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4r1_sales_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p4r1_sales_visible_count
FROM platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
)
\gset
\set ON_ERROR_STOP off
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_a_id'
);
\set p4r1_sales_curator_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_curator_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p4r1_curator_visible_count
FROM platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_a_id'
)
\gset
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_curator_sales_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_finance_a_claims';
SET ROLE authenticated;
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_finance_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_student_a_claims';
SET ROLE authenticated;
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_student_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_admin_a_stale_claims';
SET ROLE authenticated;
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_stale_admin_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_admin_b_claims';
SET ROLE authenticated;
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_cross_org_denied_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_anon_claims';
SET ROLE anon;
SELECT platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
);
\set p4r1_anon_denied_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4r1_sales_visible_count' = '1'
  AND :'p4r1_curator_visible_count' = '1'
  AND :'p4r1_sales_curator_denied_state' = '42501'
  AND :'p4r1_curator_sales_denied_state' = '42501'
  AND :'p4r1_finance_denied_state' = '42501'
  AND :'p4r1_student_denied_state' = '42501'
  AND :'p4r1_stale_admin_denied_state' = '42501'
  AND :'p4r1_cross_org_denied_state' = '42501'
  AND :'p4r1_anon_denied_state' = '42501',
  'staff canonical-context visibility matrix drifted'
);

SELECT pg_temp.assert_true(
  NOT (:'p4r1_admin_sales_context'::JSONB ? 'amocrm_account_id')
  AND NOT (:'p4r1_admin_sales_context'::JSONB ? 'amocrm_contact_id')
  AND NOT (:'p4r1_admin_sales_context'::JSONB ? 'amocrm_lead_id')
  AND NOT (:'p4r1_admin_sales_context'::JSONB ? 'observed_capabilities')
  AND (:'p4r1_admin_sales_context'::JSONB ? 'state')
  AND (:'p4r1_admin_sales_context'::JSONB ? 'version')
  AND (
    :'p4r1_admin_curator_context'::JSONB ->> 'reason_code'
  ) = 'responsible_user_forbidden',
  'staff RPC exposed unsafe canonical-context columns'
);

-- Correcting a provider binding invalidates the previous sanitized cache
-- immediately. The read RPC compares private binding evidence without ever
-- returning those identifiers to the staff client.
UPDATE platform.communication_conversations
SET amocrm_contact_id = 5299
WHERE organization_id = :'p4r1_org_a'
  AND id = :'p4r1_conversation_b_id';

SET request.jwt.claims TO :'p4r1_admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p4r1_rebound_stale_count
FROM platform.staff_amocrm_canonical_context(
  :'p4r1_org_a',
  :'p4r1_conversation_b_id'
)
\gset
RESET ROLE;

UPDATE platform.communication_conversations
SET amocrm_contact_id = 5202
WHERE organization_id = :'p4r1_org_a'
  AND id = :'p4r1_conversation_b_id';

SELECT pg_temp.assert_true(
  :'p4r1_rebound_stale_count' = '0',
  'staff read served canonical context from a previous provider binding'
);

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4r1_admin_a_claims';
SET ROLE authenticated;
SELECT count(*) FROM platform_private.amocrm_canonical_context_current;
\set p4r1_authenticated_private_current_state :SQLSTATE
SELECT count(*) FROM platform_private.amocrm_canonical_context_observations;
\set p4r1_authenticated_private_observations_state :SQLSTATE
RESET ROLE;

SET request.jwt.claims TO :'p4r1_service_claims';
SET ROLE service_role;
SELECT count(*) FROM platform_private.amocrm_canonical_context_current;
\set p4r1_service_private_current_state :SQLSTATE
SELECT count(*) FROM platform_private.amocrm_canonical_context_observations;
\set p4r1_service_private_observations_state :SQLSTATE

UPDATE platform_private.amocrm_canonical_context_observations
SET reason_code = 'provider_unreachable'
WHERE request_id = '64000000-0000-4000-8000-000000000101';
\set p4r1_service_update_state :SQLSTATE
RESET ROLE;

UPDATE platform_private.amocrm_canonical_context_observations
SET reason_code = 'provider_unreachable'
WHERE request_id = '64000000-0000-4000-8000-000000000101';
\set p4r1_update_state :SQLSTATE
DELETE FROM platform_private.amocrm_canonical_context_observations
WHERE request_id = '64000000-0000-4000-8000-000000000101';
\set p4r1_delete_state :SQLSTATE
TRUNCATE TABLE platform_private.amocrm_canonical_context_observations;
\set p4r1_truncate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4r1_authenticated_private_current_state' <> '00000'
  AND :'p4r1_authenticated_private_observations_state' <> '00000'
  AND :'p4r1_service_private_current_state' <> '00000'
  AND :'p4r1_service_private_observations_state' <> '00000'
  AND :'p4r1_service_update_state' = '42501'
  AND :'p4r1_update_state' = '55000'
  AND :'p4r1_delete_state' = '55000'
  AND :'p4r1_truncate_state' = '55000',
  'private table containment or append-only guards drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform amoCRM canonical context RLS passed' AS result;
