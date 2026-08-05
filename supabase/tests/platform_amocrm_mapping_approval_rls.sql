\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P4B stateful authorization, validation, replay, supersession and revocation
-- proof. All data is synthetic and rolled back. No provider is contacted.
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
    RAISE EXCEPTION 'P4B assertion failed: %', p_message;
  END IF;
END
$$;

SELECT
  membership.organization_id AS p4b_org_a,
  membership.id AS p4b_admin_a_membership,
  profile.id AS p4b_admin_a_profile,
  profile.auth_user_id AS p4b_admin_a_user,
  profile.access_version AS p4b_admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS p4b_org_b,
  membership.id AS p4b_admin_b_membership,
  profile.auth_user_id AS p4b_admin_b_user,
  profile.access_version AS p4b_admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.id AS p4b_sales_membership,
  profile.auth_user_id AS p4b_sales_user
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
  AND bundle.role = membership."current_role"
  AND bundle.status = 'published'
WHERE membership.organization_id = :'p4b_org_a'
  AND membership.status = 'active'
  AND membership."current_role" = 'sales'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS p4b_curator_user,
  profile.access_version AS p4b_curator_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4b_org_a'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000003'
\gset

SELECT
  membership."current_role"::TEXT AS p4b_inactive_role,
  profile.auth_user_id AS p4b_inactive_user,
  profile.access_version AS p4b_inactive_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4b_org_a'
  AND membership.status = 'inactive'
LIMIT 1
\gset

SELECT
  membership."current_role"::TEXT AS p4b_blocked_role,
  profile.auth_user_id AS p4b_blocked_user,
  profile.access_version AS p4b_blocked_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4b_org_a'
  AND membership.status = 'blocked'
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS p4b_student_user,
  profile.access_version AS p4b_student_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4b_org_a'
  AND membership."current_role" = 'student'
  AND membership.status = 'active'
LIMIT 1
\gset

SELECT pg_temp.assert_true(
  :'p4b_org_a' <> :'p4b_org_b'
  AND :'p4b_inactive_role' IS NOT NULL
  AND :'p4b_blocked_role' IS NOT NULL,
  'required identity/RBAC fixtures are unavailable'
);

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4b_admin_a_access_version'::BIGINT
)::TEXT AS p4b_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version',
    (:'p4b_admin_a_access_version'::BIGINT - 1)
)::TEXT AS p4b_stale_admin_a_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'p4b_admin_b_access_version'::BIGINT
)::TEXT AS p4b_admin_b_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_curator_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'p4b_curator_access_version'::BIGINT
)::TEXT AS p4b_curator_claims
\gset

-- Reuse the carried-forward admissions fixture to prove the positive Curator
-- object scope as well as the unassigned-Curator denial below.
SELECT
  student_case.id AS p4b_curator_case_id,
  student_case.responsible_sales_membership_id
    AS p4b_curator_case_sales_membership,
  curator_profile.auth_user_id AS p4b_assigned_curator_user,
  curator_profile.access_version AS p4b_assigned_curator_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS sales_membership
  ON sales_membership.organization_id = student_case.organization_id
  AND sales_membership.id = student_case.responsible_sales_membership_id
JOIN platform.role_bundle_versions AS sales_bundle
  ON sales_bundle.id = sales_membership.current_bundle_id
  AND sales_bundle.role = sales_membership."current_role"
  AND sales_bundle.status = 'published'
JOIN platform.organization_memberships AS curator_membership
  ON curator_membership.organization_id = student_case.organization_id
  AND curator_membership.id = student_case.current_curator_membership_id
JOIN platform.profiles AS curator_profile
  ON curator_profile.id = curator_membership.profile_id
WHERE student_case.organization_id = :'p4b_org_a'
  AND student_case.state IN ('active', 'closed')
  AND sales_membership.status = 'active'
  AND sales_membership."current_role" = 'sales'
  AND curator_membership.status = 'active'
  AND curator_membership."current_role" = 'curator'
ORDER BY student_case.id
LIMIT 1
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_assigned_curator_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'p4b_assigned_curator_access_version'::BIGINT
)::TEXT AS p4b_assigned_curator_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_student_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'p4b_student_access_version'::BIGINT
)::TEXT AS p4b_student_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_inactive_user',
  'role', 'authenticated',
  'platform_role', :'p4b_inactive_role',
  'platform_access_version', :'p4b_inactive_access_version'::BIGINT
)::TEXT AS p4b_inactive_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_blocked_user',
  'role', 'authenticated',
  'platform_role', :'p4b_blocked_role',
  'platform_access_version', :'p4b_blocked_access_version'::BIGINT
)::TEXT AS p4b_blocked_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000007',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1
)::TEXT AS p4b_auth_admin_without_authority_claims
\gset
\set p4b_service_claims '{"role":"service_role"}'

-- Add a second, active Finance identity so the role denial does not depend on
-- the deliberately inactive Finance fixture left by the P2C lifecycle test.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '59000000-0000-4000-8000-000000000050',
  'p4b-active-finance@example.invalid',
  '{"full_name":"P4B Active Finance"}'::JSONB
);

SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT platform.provision_member(
  :'p4b_org_a',
  '59000000-0000-4000-8000-000000000050',
  'P4B Active Finance',
  'finance',
  'P4B active Finance negative authorization fixture',
  '59000000-0000-4000-8000-000000000051'
) IS NOT NULL AS p4b_finance_provisioned
\gset
RESET ROLE;

SELECT
  profile.access_version AS p4b_active_finance_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'p4b_org_a'
  AND profile.auth_user_id =
    '59000000-0000-4000-8000-000000000050'
  AND membership.status = 'active'
  AND membership."current_role" = 'finance'
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', '59000000-0000-4000-8000-000000000050',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'p4b_active_finance_access_version'::BIGINT
)::TEXT AS p4b_active_finance_claims
\gset

-- Build one provider-free conversation seam through existing service-only
-- persistence RPCs. These calls store synthetic local evidence only.
SET request.jwt.claims TO :'p4b_service_claims';
SET ROLE service_role;
SELECT (
  platform.persist_provider_webhook_event(
    :'p4b_org_a',
    'waha',
    'synthetic:p4b:waha-account',
    NULL,
    NULL,
    'synthetic-p4b-request-001',
    'evo-inbox-p4b-synthetic',
    'synthetic-p4b-message-001',
    'message.any',
    TIMESTAMPTZ '2026-08-05 12:00:00+06',
    'verified',
    '{"event":"synthetic-p4b-inbound"}'::JSONB,
    '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
    'synthetic:p4b:hmac:verified',
    pg_catalog.repeat('9', 64),
    '59000000-0000-4000-8000-000000000010'
  ) ->> 'provider_webhook_event_id'
)::TEXT AS p4b_source_event_id
\gset

SELECT (
  platform.create_communication_conversation(
    :'p4b_org_a',
    NULL,
    :'p4b_sales_membership',
    'Synthetic P4B mapping conversation',
    'evo-inbox-p4b-synthetic',
    590010,
    'synthetic-p4b-kommo-conversation',
    590001,
    590011,
    590021,
    :'p4b_source_event_id',
    '59000000-0000-4000-8000-000000000011'
  ) ->> 'communication_conversation_id'
)::TEXT AS p4b_conversation_id
\gset

SELECT (
  platform.persist_provider_webhook_event(
    :'p4b_org_a',
    'waha',
    'synthetic:p4b:waha-account',
    NULL,
    NULL,
    'synthetic-p4b-request-002',
    'evo-inbox-p4b-synthetic',
    'synthetic-p4b-message-002',
    'message.any',
    TIMESTAMPTZ '2026-08-05 12:01:00+06',
    'verified',
    '{"event":"synthetic-p4b-curator-inbound"}'::JSONB,
    '{"x-webhook-hmac":"synthetic-valid"}'::JSONB,
    'synthetic:p4b:hmac:verified',
    pg_catalog.repeat('8', 64),
    '59000000-0000-4000-8000-000000000012'
  ) ->> 'provider_webhook_event_id'
)::TEXT AS p4b_curator_source_event_id
\gset

SELECT (
  platform.create_communication_conversation(
    :'p4b_org_a',
    :'p4b_curator_case_id',
    :'p4b_curator_case_sales_membership',
    'Synthetic P4B Curator mapping conversation',
    'evo-inbox-p4b-synthetic',
    590010,
    'synthetic-p4b-kommo-curator-conversation',
    590001,
    590012,
    590022,
    :'p4b_curator_source_event_id',
    '59000000-0000-4000-8000-000000000013'
  ) ->> 'communication_conversation_id'
)::TEXT AS p4b_curator_conversation_id
\gset
RESET ROLE;

SELECT profile.access_version AS p4b_sales_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'p4b_sales_user'
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p4b_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p4b_sales_access_version'::BIGINT
)::TEXT AS p4b_sales_claims
\gset

SELECT pg_catalog.jsonb_build_object(
  'schema_version', 1,
  'account', pg_catalog.jsonb_build_object(
    'id', '590001',
    'domain', 'synthetic-p4b.amocrm.ru',
    'subdomain', 'synthetic-p4b'
  ),
  'pipelines', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'id', '590101',
      'name', 'Synthetic Sales Pipeline A',
      'is_main', true,
      'is_archive', false,
      'statuses', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', '590111',
          'name', 'Synthetic Signed A',
          'sort', 10,
          'is_editable', true,
          'type', null
        )
      )
    ),
    pg_catalog.jsonb_build_object(
      'id', '590102',
      'name', 'Synthetic Sales Pipeline B',
      'is_main', false,
      'is_archive', false,
      'statuses', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', '590112',
          'name', 'Synthetic Signed B',
          'sort', 20,
          'is_editable', true,
          'type', null
        )
      )
    )
  ),
  'users', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'id', '590401',
      'name', 'Synthetic Active User',
      'is_active', true
    ),
    pg_catalog.jsonb_build_object(
      'id', '590402',
      'name', 'Synthetic Inactive User',
      'is_active', false
    )
  ),
  'lead_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'id', '590201',
      'name', 'Synthetic Lead External ID',
      'code', null,
      'type', 'text',
      'enums', pg_catalog.jsonb_build_array()
    ),
    pg_catalog.jsonb_build_object(
      'id', '590202',
      'name', 'Synthetic Lead Program',
      'code', null,
      'type', 'text',
      'enums', pg_catalog.jsonb_build_array()
    )
  ),
  'contact_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'id', '590301',
      'name', 'Synthetic Contact Locale',
      'code', null,
      'type', 'text',
      'enums', pg_catalog.jsonb_build_array()
    ),
    pg_catalog.jsonb_build_object(
      'id', '590302',
      'name', 'Synthetic Contact External ID',
      'code', null,
      'type', 'text',
      'enums', pg_catalog.jsonb_build_array()
    )
  )
)::TEXT AS p4b_snapshot
\gset

SELECT
  discovery.discovery_version_id::TEXT AS p4b_discovery_v1_id
FROM platform.persist_amocrm_mapping_discovery(
  :'p4b_org_a',
  590001,
  'synthetic-p4b.amocrm.ru',
  'synthetic-p4b',
  :'p4b_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4b:590001:v1',
  TIMESTAMPTZ '2026-08-05 06:05:00+00',
  '59000000-0000-4000-8000-000000000001'
) AS discovery
\gset

SELECT
  discovery.discovery_version_id::TEXT AS p4b_discovery_v2_id
FROM platform.persist_amocrm_mapping_discovery(
  :'p4b_org_a',
  590001,
  'synthetic-p4b.amocrm.ru',
  'synthetic-p4b',
  :'p4b_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4b:590001:v2',
  TIMESTAMPTZ '2026-08-05 06:06:00+00',
  '59000000-0000-4000-8000-000000000002'
) AS discovery
\gset

SELECT pg_catalog.jsonb_set(
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      :'p4b_snapshot'::JSONB,
      '{account,id}',
      '"590002"'::JSONB
    ),
    '{account,domain}',
    '"synthetic-p4b-other.amocrm.ru"'::JSONB
  ),
  '{account,subdomain}',
  '"synthetic-p4b-other"'::JSONB
)::TEXT AS p4b_other_account_snapshot
\gset
SELECT
  discovery.discovery_version_id::TEXT AS p4b_other_account_discovery_id
FROM platform.persist_amocrm_mapping_discovery(
  :'p4b_org_a',
  590002,
  'synthetic-p4b-other.amocrm.ru',
  'synthetic-p4b-other',
  :'p4b_other_account_snapshot'::JSONB,
  'local_non_provider',
  'local:test:p4b:590002:v1',
  TIMESTAMPTZ '2026-08-05 06:07:00+00',
  '59000000-0000-4000-8000-000000000003'
) AS discovery
\gset
RESET ROLE;

SELECT pg_catalog.jsonb_build_object(
  'pipeline_id', '590101',
  'signed_contract_status_id', '590111',
  'responsible_user_source', 'lead.responsible_user_id',
  'lead_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'binding_key', 'student.program',
      'field_id', '590202'
    ),
    pg_catalog.jsonb_build_object(
      'binding_key', 'student.external_id',
      'field_id', '590201'
    )
  ),
  'contact_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'binding_key', 'contact.locale',
      'field_id', '590301'
    ),
    pg_catalog.jsonb_build_object(
      'binding_key', 'contact.external_id',
      'field_id', '590302'
    )
  )
)::TEXT AS p4b_bindings_a
\gset

SELECT pg_catalog.jsonb_build_object(
  'pipeline_id', '590102',
  'signed_contract_status_id', '590112',
  'responsible_user_source', 'lead.responsible_user_id',
  'lead_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'binding_key', 'student.external_id',
      'field_id', '590201'
    ),
    pg_catalog.jsonb_build_object(
      'binding_key', 'student.program',
      'field_id', '590202'
    )
  ),
  'contact_custom_fields', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'binding_key', 'contact.external_id',
      'field_id', '590302'
    ),
    pg_catalog.jsonb_build_object(
      'binding_key', 'contact.locale',
      'field_id', '590301'
    )
  )
)::TEXT AS p4b_bindings_b
\gset

-- Before any decision, reads are truthful and the Admin workspace returns the
-- latest same-account discovery while retaining an explicit not-approved state.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT to_jsonb(state)::TEXT AS p4b_initial_state
FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a',
  :'p4b_conversation_id'
) AS state
\gset
SELECT to_jsonb(workspace)::TEXT AS p4b_initial_workspace
FROM platform.admin_amocrm_mapping_approval_workspace(
  :'p4b_org_a',
  :'p4b_conversation_id'
) AS workspace
\gset
SELECT to_jsonb(workspace)::TEXT AS p4b_missing_review_workspace
FROM platform.admin_amocrm_mapping_approval_workspace(
  :'p4b_org_a',
  :'p4b_conversation_id',
  '59000000-0000-4000-8000-000000009999'
) AS workspace
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4b_initial_state'::JSONB ->> 'mapping_state' = 'not_approved'
  AND (
    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    FROM pg_catalog.jsonb_object_keys(
      :'p4b_initial_state'::JSONB
    ) AS key_name
  ) = ARRAY[
    'conversation_id',
    'mapping_state',
    'mapping_use',
    'organization_id'
  ]::TEXT[]
  AND :'p4b_initial_workspace'::JSONB ->> 'review_discovery_version_id'
    = :'p4b_discovery_v2_id'
  AND (:'p4b_initial_workspace'::JSONB ->> 'review_discovery_version')::BIGINT
    = 2
  AND :'p4b_missing_review_workspace'::JSONB
    -> 'review_discovery_version_id' = 'null'::JSONB,
  'initial state/workspace failed closed or did not remain one-row bounded'
);

-- Scoped Sales may see only the bounded state. Unassigned Curator, Finance,
-- Student and cross-organization Admin cannot read this conversation state.
SET request.jwt.claims TO :'p4b_sales_claims';
SET ROLE authenticated;
SELECT to_jsonb(state)::TEXT AS p4b_sales_state
FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a',
  :'p4b_conversation_id'
) AS state
\gset
RESET ROLE;

SET request.jwt.claims TO :'p4b_assigned_curator_claims';
SET ROLE authenticated;
SELECT to_jsonb(state)::TEXT AS p4b_assigned_curator_state
FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a',
  :'p4b_curator_conversation_id'
) AS state
\gset
RESET ROLE;

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_curator_claims';
SET ROLE authenticated;
SELECT * FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a', :'p4b_conversation_id'
);
\set p4b_curator_read_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_active_finance_claims';
SET ROLE authenticated;
SELECT * FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a', :'p4b_conversation_id'
);
\set p4b_finance_read_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_student_claims';
SET ROLE authenticated;
SELECT * FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a', :'p4b_conversation_id'
);
\set p4b_student_read_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_admin_b_claims';
SET ROLE authenticated;
SELECT * FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a', :'p4b_conversation_id'
);
\set p4b_cross_org_read_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4b_sales_state'::JSONB ->> 'mapping_state' = 'not_approved'
  AND :'p4b_assigned_curator_state'::JSONB ->> 'mapping_state'
    = 'not_approved'
  AND (
    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    FROM pg_catalog.jsonb_object_keys(
      :'p4b_sales_state'::JSONB
    ) AS key_name
  ) = ARRAY[
    'conversation_id',
    'mapping_state',
    'mapping_use',
    'organization_id'
  ]::TEXT[]
  AND (
    SELECT pg_catalog.array_agg(key_name ORDER BY key_name)
    FROM pg_catalog.jsonb_object_keys(
      :'p4b_assigned_curator_state'::JSONB
    ) AS key_name
  ) = ARRAY[
    'conversation_id',
    'mapping_state',
    'mapping_use',
    'organization_id'
  ]::TEXT[]
  AND :'p4b_curator_read_state' = '42501'
  AND :'p4b_finance_read_state' = '42501'
  AND :'p4b_student_read_state' = '42501'
  AND :'p4b_cross_org_read_state' = '42501',
  'bounded staff read/object-scope contract drifted'
);

-- Every non-Admin/lapsed/forged authority fails before decision creation.
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_sales_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Sales must not approve mapping',
  '59000000-0000-4000-8000-000000000201'
);
\set p4b_sales_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_curator_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Curator must not approve mapping',
  '59000000-0000-4000-8000-000000000202'
);
\set p4b_curator_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_active_finance_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Finance must not approve mapping',
  '59000000-0000-4000-8000-000000000203'
);
\set p4b_finance_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_student_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Student must not approve mapping',
  '59000000-0000-4000-8000-000000000204'
);
\set p4b_student_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_admin_b_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Cross organization Admin must not approve mapping',
  '59000000-0000-4000-8000-000000000205'
);
\set p4b_cross_org_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_stale_admin_a_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Stale Admin must not approve mapping',
  '59000000-0000-4000-8000-000000000206'
);
\set p4b_stale_admin_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_inactive_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Inactive member must not approve mapping',
  '59000000-0000-4000-8000-000000000207'
);
\set p4b_inactive_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_blocked_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Blocked member must not approve mapping',
  '59000000-0000-4000-8000-000000000208'
);
\set p4b_blocked_mutate_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_auth_admin_without_authority_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Forged Auth Admin must not approve mapping',
  '59000000-0000-4000-8000-000000000209'
);
\set p4b_auth_admin_mutate_state :SQLSTATE
RESET ROLE;
SET ROLE anon;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Anon must not approve mapping',
  '59000000-0000-4000-8000-000000000210'
);
\set p4b_anon_mutate_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4b_sales_mutate_state' = '42501'
  AND :'p4b_curator_mutate_state' = '42501'
  AND :'p4b_finance_mutate_state' = '42501'
  AND :'p4b_student_mutate_state' = '42501'
  AND :'p4b_cross_org_mutate_state' = '42501'
  AND :'p4b_stale_admin_mutate_state' = '42501'
  AND :'p4b_inactive_mutate_state' = '42501'
  AND :'p4b_blocked_mutate_state' = '42501'
  AND :'p4b_auth_admin_mutate_state' = '42501'
  AND :'p4b_anon_mutate_state' = '42501'
  AND (
    SELECT count(*)
    FROM platform_private.amocrm_mapping_approval_events
  ) = 0,
  'non-Admin, cross-org, stale, inactive, blocked or forged authority wrote'
);

-- The global audit request collision remains hidden from unauthorized callers
-- and becomes a deterministic 22023 only after live Admin authority succeeds.
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_sales_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Unauthorized collision probe',
  '59000000-0000-4000-8000-000000000001'
);
\set p4b_unauthorized_collision_state :SQLSTATE
RESET ROLE;
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Authorized collision probe',
  '59000000-0000-4000-8000-000000000001'
);
\set p4b_global_collision_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'p4b_unauthorized_collision_state' = '42501'
  AND :'p4b_global_collision_state' = '22023',
  'request collision authorization/order contract drifted'
);

-- Invalid snapshot references and binding shapes fail before event creation.
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id',
  '59000000-0000-4000-8000-000000009998',
  :'p4b_bindings_a'::JSONB, NULL,
  'Unknown discovery must fail',
  '59000000-0000-4000-8000-000000000301'
);
\set p4b_unknown_discovery_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id',
  :'p4b_other_account_discovery_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Account mismatch must fail',
  '59000000-0000-4000-8000-000000000302'
);
\set p4b_account_mismatch_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{pipeline_id}',
    '"599999"'::JSONB
  ), NULL,
  'Unknown pipeline must fail',
  '59000000-0000-4000-8000-000000000303'
);
\set p4b_unknown_pipeline_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{signed_contract_status_id}',
    '"590112"'::JSONB
  ), NULL,
  'Status from another pipeline must fail',
  '59000000-0000-4000-8000-000000000304'
);
\set p4b_cross_pipeline_status_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{lead_custom_fields,0,field_id}',
    '"590301"'::JSONB
  ), NULL,
  'Wrong lead entity field must fail',
  '59000000-0000-4000-8000-000000000305'
);
\set p4b_wrong_lead_field_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{contact_custom_fields,0,field_id}',
    '"590201"'::JSONB
  ), NULL,
  'Wrong contact entity field must fail',
  '59000000-0000-4000-8000-000000000306'
);
\set p4b_wrong_contact_field_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{contact_custom_fields,0,binding_key}',
    '"student.program"'::JSONB
  ), NULL,
  'Duplicate semantic key must fail',
  '59000000-0000-4000-8000-000000000307'
);
\set p4b_duplicate_binding_state :SQLSTATE
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  pg_catalog.jsonb_set(
    :'p4b_bindings_a'::JSONB,
    '{responsible_user_source}',
    '"user.590402"'::JSONB
  ), NULL,
  'Inactive-user shortcut must fail',
  '59000000-0000-4000-8000-000000000308'
);
\set p4b_responsible_source_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4b_unknown_discovery_state' = '22023'
  AND :'p4b_account_mismatch_state' = '22023'
  AND :'p4b_unknown_pipeline_state' = '22023'
  AND :'p4b_cross_pipeline_status_state' = '22023'
  AND :'p4b_wrong_lead_field_state' = '22023'
  AND :'p4b_wrong_contact_field_state' = '22023'
  AND :'p4b_duplicate_binding_state' = '22023'
  AND :'p4b_responsible_source_state' = '22023'
  AND (
    SELECT count(*)
    FROM platform_private.amocrm_mapping_approval_events
  ) = 0,
  'invalid discovery/binding input was not rejected atomically'
);

-- Initial approval is replay-safe. Binding array order is canonicalized so an
-- equivalent retry returns the exact same immutable event.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT
  result.approval_event_id::TEXT AS p4b_event_1_id,
  result.event_version AS p4b_event_1_version,
  result.event_kind AS p4b_event_1_kind,
  result.mapping_state AS p4b_event_1_state,
  result.selected_bindings::TEXT AS p4b_event_1_bindings
FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB,
  NULL,
  'Approve synthetic messaging mapping v1',
  '59000000-0000-4000-8000-000000000101'
) AS result
\gset

SELECT result.approval_event_id::TEXT AS p4b_event_1_replay_id
FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_discovery_v1_id',
  pg_catalog.jsonb_build_object(
    'pipeline_id', '590101',
    'signed_contract_status_id', '590111',
    'responsible_user_source', 'lead.responsible_user_id',
    'lead_custom_fields', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'binding_key', 'student.external_id',
        'field_id', '590201'
      ),
      pg_catalog.jsonb_build_object(
        'binding_key', 'student.program',
        'field_id', '590202'
      )
    ),
    'contact_custom_fields', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'binding_key', 'contact.external_id',
        'field_id', '590302'
      ),
      pg_catalog.jsonb_build_object(
        'binding_key', 'contact.locale',
        'field_id', '590301'
      )
    )
  ),
  NULL,
  'Approve synthetic messaging mapping v1',
  '59000000-0000-4000-8000-000000000101'
) AS result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4b_event_1_id' = :'p4b_event_1_replay_id'
  AND :'p4b_event_1_version' = '1'
  AND :'p4b_event_1_kind' = 'approved'
  AND :'p4b_event_1_state' = 'approved_configured_unverified'
  AND (
    SELECT count(*)
    FROM platform_private.amocrm_mapping_approval_events
    WHERE request_id = '59000000-0000-4000-8000-000000000101'
  ) = 1
  AND (
    SELECT count(*)
    FROM platform.audit_events
    WHERE request_id = '59000000-0000-4000-8000-000000000101'
      AND action = 'integration.amocrm.mapping.approve'
  ) = 1,
  'initial approval replay/audit contract drifted'
);

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, NULL,
  'Changed replay reason must fail',
  '59000000-0000-4000-8000-000000000101'
);
\set p4b_changed_approve_replay_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

-- One exact-prior supersession succeeds; stale prior then fails with the
-- explicit conflict code used by the parallel PostgREST acceptance test.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT
  result.approval_event_id::TEXT AS p4b_event_2_id,
  result.event_version AS p4b_event_2_version,
  result.prior_event_id::TEXT AS p4b_event_2_prior
FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_discovery_v2_id',
  :'p4b_bindings_b'::JSONB,
  :'p4b_event_1_id',
  'Supersede with reviewed synthetic mapping v2',
  '59000000-0000-4000-8000-000000000102'
) AS result
\gset

\set ON_ERROR_STOP off
SELECT * FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB, :'p4b_event_1_id',
  'Stale supersession must fail',
  '59000000-0000-4000-8000-000000000103'
);
\set p4b_stale_prior_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4b_changed_approve_replay_state' = '22023'
  AND :'p4b_event_2_version' = '2'
  AND :'p4b_event_2_prior' = :'p4b_event_1_id'
  AND :'p4b_stale_prior_state' = 'PT409',
  'supersession/replay/stale-prior contract drifted'
);

-- Revoke appends a third immutable event. The latest-event projection becomes
-- empty; it must never fall back to the older approved event.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT
  result.approval_event_id::TEXT AS p4b_event_3_id,
  result.event_version AS p4b_event_3_version,
  result.event_kind AS p4b_event_3_kind,
  result.mapping_state AS p4b_event_3_state
FROM platform.revoke_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_event_2_id',
  'Revoke synthetic messaging mapping for review',
  '59000000-0000-4000-8000-000000000104'
) AS result
\gset
SELECT result.approval_event_id::TEXT AS p4b_event_3_replay_id
FROM platform.revoke_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_event_2_id',
  'Revoke synthetic messaging mapping for review',
  '59000000-0000-4000-8000-000000000104'
) AS result
\gset
SELECT to_jsonb(state)::TEXT AS p4b_revoked_state
FROM platform.amocrm_mapping_state_for_conversation(
  :'p4b_org_a', :'p4b_conversation_id'
) AS state
\gset
SELECT to_jsonb(workspace)::TEXT AS p4b_revoked_workspace
FROM platform.admin_amocrm_mapping_approval_workspace(
  :'p4b_org_a', :'p4b_conversation_id'
) AS workspace
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4b_event_3_id' = :'p4b_event_3_replay_id'
  AND :'p4b_event_3_version' = '3'
  AND :'p4b_event_3_kind' = 'revoked'
  AND :'p4b_event_3_state' = 'not_approved'
  AND (
    SELECT count(*)
    FROM platform_private.current_amocrm_mapping_selections
    WHERE organization_id = :'p4b_org_a'
      AND amocrm_account_id = 590001
      AND mapping_use = 'messaging'
  ) = 0
  AND :'p4b_revoked_state'::JSONB ->> 'mapping_state' = 'not_approved'
  AND :'p4b_revoked_workspace'::JSONB ->> 'current_event_kind' = 'revoked'
  AND :'p4b_revoked_workspace'::JSONB -> 'current_selected_bindings'
    IS NOT NULL,
  'revocation resurrected an older approval or lost immutable context'
);

\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT * FROM platform.revoke_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_event_2_id',
  'Changed revoke replay must fail',
  '59000000-0000-4000-8000-000000000104'
);
\set p4b_changed_revoke_replay_state :SQLSTATE
SELECT * FROM platform.revoke_amocrm_mapping_selection(
  :'p4b_org_a', :'p4b_conversation_id', :'p4b_event_3_id',
  'Second revoke without approval must fail',
  '59000000-0000-4000-8000-000000000106'
);
\set p4b_second_revoke_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on

-- Reapproval must name the latest revoked event, proving latest-event rather
-- than latest-approved optimistic concurrency.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
SELECT
  result.approval_event_id::TEXT AS p4b_event_4_id,
  result.event_version AS p4b_event_4_version,
  result.prior_event_id::TEXT AS p4b_event_4_prior
FROM platform.approve_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_discovery_v1_id',
  :'p4b_bindings_a'::JSONB,
  :'p4b_event_3_id',
  'Reapprove after explicit synthetic review',
  '59000000-0000-4000-8000-000000000105'
) AS result
\gset
SELECT
  result.approval_event_id::TEXT AS p4b_event_3_late_replay_id,
  result.mapping_state AS p4b_event_3_late_replay_state
FROM platform.revoke_amocrm_mapping_selection(
  :'p4b_org_a',
  :'p4b_conversation_id',
  :'p4b_event_2_id',
  'Revoke synthetic messaging mapping for review',
  '59000000-0000-4000-8000-000000000104'
) AS result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p4b_changed_revoke_replay_state' = '22023'
  AND :'p4b_second_revoke_state' = 'PT409'
  AND :'p4b_event_4_version' = '4'
  AND :'p4b_event_4_prior' = :'p4b_event_3_id'
  AND :'p4b_event_3_late_replay_id' = :'p4b_event_3_id'
  AND :'p4b_event_3_late_replay_state' =
    'approved_configured_unverified'
  AND (
    SELECT approval_event_id
    FROM platform_private.current_amocrm_mapping_selections
    WHERE organization_id = :'p4b_org_a'
      AND amocrm_account_id = 590001
      AND mapping_use = 'messaging'
  ) = :'p4b_event_4_id'::UUID,
  'reapproval did not require or project the latest revoked event'
);

SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.array_agg(event_version ORDER BY event_version)
    FROM platform_private.amocrm_mapping_approval_events
    WHERE organization_id = :'p4b_org_a'
      AND amocrm_account_id = 590001
  ) = ARRAY[1, 2, 3, 4]::BIGINT[]
  AND (
    SELECT count(*)
    FROM platform.audit_events
    WHERE organization_id = :'p4b_org_a'
      AND action IN (
        'integration.amocrm.mapping.approve',
        'integration.amocrm.mapping.revoke'
      )
      AND resource_type = 'amocrm_mapping_approval_event'
      AND reason <> ''
      AND after_state ? 'mapping_state'
      AND after_state ->> 'provider_proof' = 'false'
  ) = 4
  AND (
    SELECT before_state IS NULL
    FROM platform.audit_events
    WHERE request_id = '59000000-0000-4000-8000-000000000101'
  )
  AND (
    SELECT before_state ->> 'event_id' = :'p4b_event_3_id'
    FROM platform.audit_events
    WHERE request_id = '59000000-0000-4000-8000-000000000105'
  ),
  'append-only event chain or audit before/after evidence drifted'
);

-- Browser/Data API roles cannot bypass RPCs or directly mutate the private
-- ledger. Even the owner cannot rewrite/delete/truncate immutable history.
SET request.jwt.claims TO :'p4b_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.amocrm_mapping_approval_events;
\set p4b_authenticated_direct_select_state :SQLSTATE
UPDATE platform_private.amocrm_mapping_approval_events
SET reason = 'Forbidden browser rewrite';
\set p4b_authenticated_direct_update_state :SQLSTATE
RESET ROLE;
SET ROLE service_role;
SELECT count(*) FROM platform_private.amocrm_mapping_approval_events;
\set p4b_service_direct_select_state :SQLSTATE
RESET ROLE;
UPDATE platform_private.amocrm_mapping_approval_events
SET reason = 'Forbidden owner rewrite'
WHERE id = :'p4b_event_1_id';
\set p4b_owner_update_state :SQLSTATE
DELETE FROM platform_private.amocrm_mapping_approval_events
WHERE id = :'p4b_event_1_id';
\set p4b_owner_delete_state :SQLSTATE
TRUNCATE TABLE platform_private.amocrm_mapping_approval_events;
\set p4b_owner_truncate_state :SQLSTATE
UPDATE platform_private.amocrm_mapping_discovery_versions
SET evidence_ref = 'local:test:p4b:forbidden-rewrite'
WHERE id = :'p4b_discovery_v1_id';
\set p4b_discovery_update_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p4b_authenticated_direct_select_state' = '42501'
  AND :'p4b_authenticated_direct_update_state' = '42501'
  AND :'p4b_service_direct_select_state' = '42501'
  AND :'p4b_owner_update_state' = '55000'
  AND :'p4b_owner_delete_state' = '55000'
  AND :'p4b_owner_truncate_state' = '55000'
  AND :'p4b_discovery_update_state' = '55000',
  'private ACL or append-only runtime guards drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform amoCRM mapping approval RLS passed' AS result;
