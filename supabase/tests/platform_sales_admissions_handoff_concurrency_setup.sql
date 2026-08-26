\set ON_ERROR_STOP on

BEGIN;

\set u6c_org '88100000-0000-4000-8000-000000000001'
\set u6c_scope '88100000-0000-4000-8000-000000000011'

\set u6c_admin_user '88100000-0000-4000-8000-000000000101'
\set u6c_sales_user '88100000-0000-4000-8000-000000000102'
\set u6c_curator_user '88100000-0000-4000-8000-000000000103'

\set u6c_admin_profile '88100000-0000-4000-8000-000000000201'
\set u6c_sales_profile '88100000-0000-4000-8000-000000000202'
\set u6c_curator_profile '88100000-0000-4000-8000-000000000203'

\set u6c_admin_membership '88100000-0000-4000-8000-000000000301'
\set u6c_sales_membership '88100000-0000-4000-8000-000000000302'
\set u6c_curator_membership '88100000-0000-4000-8000-000000000303'

\set u6c_client '88100000-0000-4000-8000-000000000401'
\set u6c_lead '88100000-0000-4000-8000-000000000501'

INSERT INTO platform.organizations (id, name)
VALUES (:'u6c_org', 'U6 concurrency organization');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES (
  :'u6c_scope',
  :'u6c_org',
  'organization',
  :'u6c_org',
  1
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'u6c_admin_user', 'u6c-admin@example.invalid', '{}'),
  (:'u6c_sales_user', 'u6c-sales@example.invalid', '{}'),
  (:'u6c_curator_user', 'u6c-curator@example.invalid', '{}');

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES
  (:'u6c_admin_profile', :'u6c_admin_user', 'U6 Concurrency Admin', 'active', 1),
  (:'u6c_sales_profile', :'u6c_sales_user', 'U6 Concurrency Sales', 'active', 1),
  (:'u6c_curator_profile', :'u6c_curator_user', 'U6 Concurrency Curator', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES
  (
    :'u6c_admin_membership',
    :'u6c_org',
    :'u6c_admin_profile',
    'active',
    'admin',
    '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'u6c_sales_membership',
    :'u6c_org',
    :'u6c_sales_profile',
    'active',
    'sales',
    '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u6c_curator_membership',
    :'u6c_org',
    :'u6c_curator_profile',
    'active',
    'curator',
    '00000000-0000-4000-8000-000000001303'
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
SELECT
  fixture.id,
  fixture.organization_id,
  fixture.membership_id,
  fixture.scope_id,
  1,
  1,
  TRUE,
  'system',
  NULL,
  'U6 concurrency scope fixture',
  fixture.request_id
FROM (VALUES
  (
    '88100000-0000-4000-8000-000000000601'::UUID,
    :'u6c_org'::UUID,
    :'u6c_admin_membership'::UUID,
    :'u6c_scope'::UUID,
    '88100000-0000-4000-8000-000000000611'::UUID
  ),
  (
    '88100000-0000-4000-8000-000000000602'::UUID,
    :'u6c_org'::UUID,
    :'u6c_sales_membership'::UUID,
    :'u6c_scope'::UUID,
    '88100000-0000-4000-8000-000000000612'::UUID
  ),
  (
    '88100000-0000-4000-8000-000000000603'::UUID,
    :'u6c_org'::UUID,
    :'u6c_curator_membership'::UUID,
    :'u6c_scope'::UUID,
    '88100000-0000-4000-8000-000000000613'::UUID
  )
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES (
  :'u6c_client',
  :'u6c_org',
  'U6 Concurrency Client',
  'u6 concurrency client'
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
  :'u6c_lead',
  :'u6c_org',
  :'u6c_client',
  :'u6c_sales_membership',
  'qualified',
  'u6_concurrency',
  'open'
);

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = TRUE,
  contract_confirmed_by_membership_id = :'u6c_admin_membership',
  contract_confirmed_by_profile_id = :'u6c_admin_profile',
  contract_confirmed_at = '2099-02-01T09:00:00Z',
  contract_evidence_reference = 'U6C-CONTRACT',
  first_payment_amount = 1200.00,
  first_payment_currency = 'USD',
  first_payment_due_date = DATE '2099-02-10',
  first_payment_received_date = DATE '2099-02-05',
  first_payment_confirmed_by_membership_id = :'u6c_admin_membership',
  first_payment_confirmed_by_profile_id = :'u6c_admin_profile',
  first_payment_confirmed_at = '2099-02-05T12:00:00Z',
  first_payment_evidence_reference = 'U6C-PAYMENT',
  gate_state = 'satisfied',
  gate_version = 2
WHERE organization_id = :'u6c_org'
  AND lead_id = :'u6c_lead';

COMMIT;

SELECT 'platform migration 088 U6 concurrency fixture ready' AS result;
