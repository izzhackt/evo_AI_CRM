\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u5_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'U5 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_mutation(
  p_lead_id UUID,
  p_expected_gate_version BIGINT,
  p_request_id UUID,
  p_action TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_due_date DATE,
  p_received_date DATE,
  p_evidence_reference TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', TRUE,
    'result', platform.mutate_lead_admissions_gate(
      p_lead_id,
      p_expected_gate_version,
      p_request_id,
      p_action,
      p_amount,
      p_currency,
      p_due_date,
      p_received_date,
      p_evidence_reference,
      p_reason
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_permission_change(
  p_organization_id UUID,
  p_membership_id UUID,
  p_permission_key TEXT,
  p_granted BOOLEAN,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', TRUE,
    'result', platform.change_membership_permission(
      p_organization_id,
      p_membership_id,
      p_permission_key,
      p_granted,
      p_reason,
      p_request_id
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_handoff_assertion(
  p_organization_id UUID,
  p_lead_id UUID,
  p_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', TRUE,
    'state', platform_private.assert_lead_admissions_handoff_gate(
      p_organization_id,
      p_lead_id,
      p_mode
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_audit_update(
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE platform.audit_events
  SET reason = 'tampered'
  WHERE request_id = p_request_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_receipt_update(
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE platform_private.lead_admissions_gate_receipts
  SET requested_reason = 'tampered'
  WHERE request_id = p_request_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u5_attempt_direct_gate_update(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE platform.lead_admissions_gates
  SET gate_version = gate_version + 1
  WHERE organization_id = p_organization_id
    AND lead_id = p_lead_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.u5_assert(BOOLEAN, TEXT)
TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u5_attempt_mutation(
  UUID, BIGINT, UUID, TEXT, NUMERIC, TEXT, DATE, DATE, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u5_attempt_permission_change(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u5_attempt_direct_gate_update(UUID, UUID)
TO authenticated;

SELECT pg_temp.u5_assert(
  NOT EXISTS (SELECT 1 FROM platform.lead_admissions_gates),
  'migration 087 backfilled pre-pilot leads instead of preserving legacy isolation'
);

\set u5_org_a '87000000-0000-4000-8000-000000000001'
\set u5_org_b '87000000-0000-4000-8000-000000000002'
\set u5_scope_a '87000000-0000-4000-8000-000000000011'
\set u5_scope_b '87000000-0000-4000-8000-000000000012'

\set u5_admin_a_user '87000000-0000-4000-8000-000000000101'
\set u5_sales_a_user '87000000-0000-4000-8000-000000000102'
\set u5_inactive_sales_user '87000000-0000-4000-8000-000000000103'
\set u5_admin_b_user '87000000-0000-4000-8000-000000000104'

\set u5_admin_a_profile '87000000-0000-4000-8000-000000000201'
\set u5_sales_a_profile '87000000-0000-4000-8000-000000000202'
\set u5_inactive_sales_profile '87000000-0000-4000-8000-000000000203'
\set u5_admin_b_profile '87000000-0000-4000-8000-000000000204'

\set u5_admin_a_membership '87000000-0000-4000-8000-000000000301'
\set u5_sales_a_membership '87000000-0000-4000-8000-000000000302'
\set u5_inactive_sales_membership '87000000-0000-4000-8000-000000000303'
\set u5_admin_b_membership '87000000-0000-4000-8000-000000000304'

\set u5_client_paid '87000000-0000-4000-8000-000000000401'
\set u5_client_override '87000000-0000-4000-8000-000000000402'
\set u5_client_inactive '87000000-0000-4000-8000-000000000403'
\set u5_client_b '87000000-0000-4000-8000-000000000404'

\set u5_lead_paid '87000000-0000-4000-8000-000000000501'
\set u5_lead_override '87000000-0000-4000-8000-000000000502'
\set u5_lead_inactive '87000000-0000-4000-8000-000000000503'
\set u5_lead_b '87000000-0000-4000-8000-000000000504'

INSERT INTO platform.organizations (id, name)
VALUES
  (:'u5_org_a', 'U5 Organization A'),
  (:'u5_org_b', 'U5 Organization B');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES
  (:'u5_scope_a', :'u5_org_a', 'organization', :'u5_org_a', 1),
  (:'u5_scope_b', :'u5_org_b', 'organization', :'u5_org_b', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'u5_admin_a_user', 'u5-admin-a@example.invalid', '{}'),
  (:'u5_sales_a_user', 'u5-sales-a@example.invalid', '{}'),
  (:'u5_inactive_sales_user', 'u5-inactive@example.invalid', '{}'),
  (:'u5_admin_b_user', 'u5-admin-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES
  (:'u5_admin_a_profile', :'u5_admin_a_user', 'U5 Admin A', 'active', 1),
  (:'u5_sales_a_profile', :'u5_sales_a_user', 'U5 Sales A', 'active', 1),
  (
    :'u5_inactive_sales_profile',
    :'u5_inactive_sales_user',
    'U5 Inactive Sales',
    'active',
    1
  ),
  (:'u5_admin_b_profile', :'u5_admin_b_user', 'U5 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES
  (
    :'u5_admin_a_membership', :'u5_org_a', :'u5_admin_a_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
  ),
  (
    :'u5_sales_a_membership', :'u5_org_a', :'u5_sales_a_profile',
    'active', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u5_inactive_sales_membership', :'u5_org_a',
    :'u5_inactive_sales_profile',
    'inactive', 'sales', '00000000-0000-4000-8000-000000001302'
  ),
  (
    :'u5_admin_b_membership', :'u5_org_b', :'u5_admin_b_profile',
    'active', 'admin', '00000000-0000-4000-8000-000000001301'
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
  'U5 authorization fixture',
  fixture.request_id
FROM (VALUES
  (
    '87000000-0000-4000-8000-000000000601'::UUID,
    :'u5_org_a'::UUID,
    :'u5_admin_a_membership'::UUID,
    :'u5_scope_a'::UUID,
    '87000000-0000-4000-8000-000000000611'::UUID
  ),
  (
    '87000000-0000-4000-8000-000000000602'::UUID,
    :'u5_org_a'::UUID,
    :'u5_sales_a_membership'::UUID,
    :'u5_scope_a'::UUID,
    '87000000-0000-4000-8000-000000000612'::UUID
  ),
  (
    '87000000-0000-4000-8000-000000000603'::UUID,
    :'u5_org_a'::UUID,
    :'u5_inactive_sales_membership'::UUID,
    :'u5_scope_a'::UUID,
    '87000000-0000-4000-8000-000000000613'::UUID
  ),
  (
    '87000000-0000-4000-8000-000000000604'::UUID,
    :'u5_org_b'::UUID,
    :'u5_admin_b_membership'::UUID,
    :'u5_scope_b'::UUID,
    '87000000-0000-4000-8000-000000000614'::UUID
  )
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES
  (:'u5_client_paid', :'u5_org_a', 'U5 Paid Client', 'u5 paid client'),
  (
    :'u5_client_override', :'u5_org_a',
    'U5 Override Client', 'u5 override client'
  ),
  (
    :'u5_client_inactive', :'u5_org_a',
    'U5 Inactive Client', 'u5 inactive client'
  ),
  (:'u5_client_b', :'u5_org_b', 'U5 Client B', 'u5 client b');

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
    :'u5_lead_paid', :'u5_org_a', :'u5_client_paid',
    :'u5_sales_a_membership', 'qualified', 'u5_test', 'open'
  ),
  (
    :'u5_lead_override', :'u5_org_a', :'u5_client_override',
    :'u5_sales_a_membership', 'qualified', 'u5_test', 'open'
  ),
  (
    :'u5_lead_inactive', :'u5_org_a', :'u5_client_inactive',
    NULL, 'qualified', 'u5_test', 'open'
  ),
  (
    :'u5_lead_b', :'u5_org_b', :'u5_client_b',
    NULL, 'qualified', 'u5_test', 'open'
  );

SELECT jsonb_build_object(
  'sub', :'u5_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u5_org_a',
  'platform_membership_id', :'u5_admin_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u5_admin_a_claims_v1,
jsonb_build_object(
  'sub', :'u5_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u5_org_a',
  'platform_membership_id', :'u5_sales_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u5_sales_a_claims_v1,
jsonb_build_object(
  'sub', :'u5_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u5_org_b',
  'platform_membership_id', :'u5_admin_b_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u5_admin_b_claims_v1
\gset

SELECT pg_temp.u5_assert(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'platform.lead_admissions_gates'::REGCLASS
  )
  AND (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid =
      'platform_private.lead_admissions_gate_receipts'::REGCLASS
  ),
  'gate or receipt table is not forced-RLS'
);

SELECT pg_temp.u5_assert(
  has_table_privilege(
    'authenticated',
    'platform.lead_admissions_gates',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform.lead_admissions_gates',
    'INSERT,UPDATE,DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.lead_admissions_gate_receipts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_lead_admissions_gate(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.mutate_lead_admissions_gate(uuid,bigint,uuid,text,numeric,text,date,date,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_lead_admissions_gate(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.mutate_lead_admissions_gate(uuid,bigint,uuid,text,numeric,text,date,date,text,text)',
    'EXECUTE'
  ),
  'U5 least-grant boundary drifted'
);

SELECT pg_temp.u5_assert(
  (
    SELECT count(*) = 4
      AND min(gate_version) = 1
      AND max(gate_version) = 1
      AND bool_and(gate_state = 'blocked')
      AND NOT bool_or(contract_confirmed)
    FROM platform.lead_admissions_gates
    WHERE lead_id IN (
      :'u5_lead_paid', :'u5_lead_override',
      :'u5_lead_inactive', :'u5_lead_b'
    )
  ),
  'lead insert trigger did not create deterministic version-1 blocked gates'
);

SELECT pg_temp.u5_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions
    WHERE permission_key = 'admissions.handoff.gate.override'
  ),
  'override permission leaked into a job-title role bundle'
);

SET LOCAL request.jwt.claims TO :'u5_sales_a_claims_v1';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  (
    SELECT count(*) = 1
      AND bool_and(gate_state = 'blocked')
      AND bool_and(gate_version = 1)
      AND NOT bool_or(can_confirm_contract)
      AND NOT bool_or(can_confirm_first_payment)
      AND NOT bool_or(can_override_gate)
    FROM platform.staff_lead_admissions_gate(:'u5_lead_paid')
  ),
  'ungrafted Sales read did not expose a truthful blocked gate'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_paid', 1,
      '87000000-0000-4000-8000-000000000701',
      'confirm_contract', 1250.50, 'USD', '2026-09-15', NULL,
      'contract:v1', NULL
    ) ->> 'message'
  ) = 'admissions_gate_contract_confirmation_forbidden',
  'Sales job title implied contract-confirmation authority'
);

SELECT pg_temp.u5_assert(
  pg_temp.u5_attempt_direct_gate_update(:'u5_org_a', :'u5_lead_paid')
    = '42501',
  'authenticated actor bypassed the gate mutation RPC'
);

RESET ROLE;
SET LOCAL request.jwt.claims TO :'u5_admin_a_claims_v1';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_override', 1,
      '87000000-0000-4000-8000-000000000702',
      'override_gate', NULL, NULL, NULL, NULL, NULL,
      'Director-approved exception'
    ) ->> 'message'
  ) = 'admissions_gate_override_forbidden',
  'Admin title implied override authority before the individual grant'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_permission_change(
      :'u5_org_a', :'u5_sales_a_membership',
      'admissions.handoff.gate.override', TRUE,
      'must fail for non-admin target',
      '87000000-0000-4000-8000-000000000703'
    ) ->> 'sqlstate'
  ) = '22023',
  'override grant accepted a non-Admin membership'
);

SELECT platform.change_membership_permission(
  :'u5_org_a', :'u5_sales_a_membership',
  'contract.evidence.confirm', TRUE,
  'U5 contract confirmer',
  '87000000-0000-4000-8000-000000000704'
);
SELECT platform.change_membership_permission(
  :'u5_org_a', :'u5_sales_a_membership',
  'finance.first.payment.confirm', TRUE,
  'U5 payment confirmer',
  '87000000-0000-4000-8000-000000000705'
);
SELECT platform.change_membership_permission(
  :'u5_org_a', :'u5_inactive_sales_membership',
  'contract.evidence.confirm', TRUE,
  'U5 inactive negative fixture',
  '87000000-0000-4000-8000-000000000706'
);
SELECT platform.change_membership_permission(
  :'u5_org_a', :'u5_admin_a_membership',
  'admissions.handoff.gate.override', TRUE,
  'U5 explicit Admin override',
  '87000000-0000-4000-8000-000000000707'
);

RESET ROLE;

SELECT jsonb_build_object(
  'sub', :'u5_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 2,
  'platform_organization_id', :'u5_org_a',
  'platform_membership_id', :'u5_admin_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u5_admin_a_claims_v2,
jsonb_build_object(
  'sub', :'u5_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 3,
  'platform_organization_id', :'u5_org_a',
  'platform_membership_id', :'u5_sales_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u5_sales_a_claims_v3,
jsonb_build_object(
  'sub', :'u5_inactive_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 2,
  'platform_organization_id', :'u5_org_a',
  'platform_membership_id', :'u5_inactive_sales_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u5_inactive_sales_claims_v2
\gset

SET LOCAL request.jwt.claims TO :'u5_admin_a_claims_v2';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  (
    SELECT count(*) = 1
      AND bool_and(admissions_gate_override_granted)
    FROM platform.staff_directory(:'u5_org_a')
    WHERE membership_id = :'u5_admin_a_membership'
  )
  AND (
    SELECT count(*) = 1
      AND bool_and(contract_confirmation_granted)
      AND bool_and(first_payment_confirmation_granted)
      AND NOT bool_or(admissions_gate_override_granted)
    FROM platform.staff_directory(:'u5_org_a')
    WHERE membership_id = :'u5_sales_a_membership'
  ),
  'staff directory did not expose exact individual grants'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_override', 1,
      '87000000-0000-4000-8000-000000000708',
      'override_gate', NULL, NULL, NULL, NULL, NULL, '   '
    ) ->> 'message'
  ) = 'admissions_gate_override_reason_required',
  'blank override reason was accepted'
);

RESET ROLE;
SET LOCAL request.jwt.claims TO :'u5_sales_a_claims_v3';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_inactive', 1,
      '87000000-0000-4000-8000-000000000709',
      'confirm_first_payment', NULL, NULL, NULL, '2026-08-25',
      'receipt:without-contract', NULL
    ) ->> 'message'
  ) = 'admissions_gate_contract_required',
  'payment confirmation succeeded without a contract expectation'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_paid', 1,
      '87000000-0000-4000-8000-000000000717',
      'confirm_contract', 1250.501, 'USD', '2026-09-15', NULL,
      'contract:over-precision', NULL
    ) ->> 'message'
  ) = 'admissions_gate_invalid_contract_confirmation',
  'contract amount accepted more than two decimal places'
);

SELECT pg_temp.u5_attempt_mutation(
  :'u5_lead_paid', 1,
  '87000000-0000-4000-8000-000000000710',
  'confirm_contract', 1250.50, 'USD', '2026-09-15', NULL,
  'contract:v1', NULL
) AS u5_contract_attempt
\gset

SELECT pg_temp.u5_assert(
  (:'u5_contract_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u5_contract_attempt'::JSONB #>> '{result,gate_state}') = 'blocked'
  AND (:'u5_contract_attempt'::JSONB #>> '{result,gate_version}') = '2'
  AND (
    :'u5_contract_attempt'::JSONB #>> '{result,first_payment_amount}'
  )::NUMERIC = 1250.50
  AND (
    :'u5_contract_attempt'::JSONB #>>
      '{result,contract_confirmed_by_membership_id}'
  )::UUID = :'u5_sales_a_membership'
  AND (:'u5_contract_attempt'::JSONB #>> '{result,contract_confirmed}')
    = 'true'
  AND (:'u5_contract_attempt'::JSONB #>> '{result,normal_handoff_allowed}')
    = 'false',
  'authorized contract confirmation did not preserve the blocked gate'
);

SELECT pg_temp.u5_attempt_mutation(
  :'u5_lead_paid', 1,
  '87000000-0000-4000-8000-000000000710',
  'confirm_contract', 1250.50, 'USD', '2026-09-15', NULL,
  'contract:v1', NULL
) AS u5_contract_replay
\gset

SELECT pg_temp.u5_assert(
  (:'u5_contract_replay'::JSONB -> 'result')
    = (:'u5_contract_attempt'::JSONB -> 'result'),
  'exact retry did not replay the stored result'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_paid', 1,
      '87000000-0000-4000-8000-000000000710',
      'confirm_contract', 1250.50, 'USD', '2026-09-16', NULL,
      'contract:v1', NULL
    ) ->> 'message'
  ) = 'admissions_gate_request_id_conflict',
  'request id accepted a changed payload'
);

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_paid', 1,
      '87000000-0000-4000-8000-000000000711',
      'confirm_contract', 1250.50, 'USD', '2026-09-15', NULL,
      'contract:v2', NULL
    ) ->> 'message'
  ) = 'admissions_gate_version_conflict',
  'stale optimistic version was accepted'
);

RESET ROLE;

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_handoff_assertion(
      :'u5_org_a', :'u5_lead_paid', 'normal'
    ) ->> 'message'
  ) = 'admissions_gate_handoff_blocked',
  'normal handoff assertion accepted a blocked gate'
);

SET LOCAL request.jwt.claims TO :'u5_sales_a_claims_v3';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_attempt_mutation(
  :'u5_lead_paid', 2,
  '87000000-0000-4000-8000-000000000712',
  'confirm_first_payment', NULL, NULL, NULL, '2026-08-25',
  'receipt:first-payment', NULL
) AS u5_payment_attempt
\gset

SELECT pg_temp.u5_assert(
  (:'u5_payment_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u5_payment_attempt'::JSONB #>> '{result,gate_state}') = 'satisfied'
  AND (:'u5_payment_attempt'::JSONB #>> '{result,gate_version}') = '3'
  AND (:'u5_payment_attempt'::JSONB #>> '{result,normal_handoff_allowed}')
    = 'true'
  AND (
    :'u5_payment_attempt'::JSONB #>>
      '{result,exceptional_handoff_allowed}'
  ) = 'false'
  AND (
    :'u5_payment_attempt'::JSONB #>>
      '{result,first_payment_confirmed_by_membership_id}'
  )::UUID = :'u5_sales_a_membership',
  'authorized payment confirmation did not satisfy the normal gate'
);

RESET ROLE;

SELECT pg_temp.u5_assert(
  pg_temp.u5_attempt_handoff_assertion(
    :'u5_org_a', :'u5_lead_paid', 'normal'
  ) ->> 'state' = 'satisfied'
  AND (
    pg_temp.u5_attempt_handoff_assertion(
      :'u5_org_a', :'u5_lead_paid', 'exceptional_override'
    ) ->> 'message'
  ) = 'admissions_gate_handoff_blocked',
  'satisfied gate did not enforce the normal-only handoff path'
);

SET LOCAL request.jwt.claims TO :'u5_admin_a_claims_v2';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_attempt_mutation(
  :'u5_lead_override', 1,
  '87000000-0000-4000-8000-000000000713',
  'override_gate', NULL, NULL, NULL, NULL, NULL,
  'Director-approved pilot exception'
) AS u5_override_attempt
\gset

SELECT pg_temp.u5_assert(
  (:'u5_override_attempt'::JSONB ->> 'ok') = 'true'
  AND (:'u5_override_attempt'::JSONB #>> '{result,gate_state}') = 'overridden'
  AND (
    :'u5_override_attempt'::JSONB #>>
      '{result,exceptional_handoff_allowed}'
  ) = 'true'
  AND (:'u5_override_attempt'::JSONB #>> '{result,normal_handoff_allowed}')
    = 'false'
  AND (:'u5_override_attempt'::JSONB #>> '{result,override_reason}')
    = 'Director-approved pilot exception',
  'explicit Admin override was not preserved as exceptional behavior'
);

RESET ROLE;

SELECT pg_temp.u5_assert(
  pg_temp.u5_attempt_handoff_assertion(
    :'u5_org_a', :'u5_lead_override', 'exceptional_override'
  ) ->> 'state' = 'overridden'
  AND (
    pg_temp.u5_attempt_handoff_assertion(
      :'u5_org_a', :'u5_lead_override', 'normal'
    ) ->> 'message'
  ) = 'admissions_gate_handoff_blocked',
  'overridden gate did not enforce the explicit exceptional handoff path'
);

SET LOCAL request.jwt.claims TO :'u5_inactive_sales_claims_v2';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_inactive', 1,
      '87000000-0000-4000-8000-000000000714',
      'confirm_contract', 500, 'USD', '2026-09-30', NULL,
      'contract:inactive', NULL
    ) ->> 'message'
  ) = 'admissions_gate_not_found_or_forbidden'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.lead_admissions_gates
    WHERE organization_id = :'u5_org_a'
  ),
  'inactive membership retained gate read or mutation authority'
);

RESET ROLE;
SET LOCAL request.jwt.claims TO :'u5_admin_b_claims_v1';
SET LOCAL ROLE authenticated;

SELECT platform.change_membership_permission(
  :'u5_org_b', :'u5_admin_b_membership',
  'contract.evidence.confirm', TRUE,
  'U5 tenant-isolation confirmer',
  '87000000-0000-4000-8000-000000000715'
);

RESET ROLE;

SELECT jsonb_build_object(
  'sub', :'u5_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 2,
  'platform_organization_id', :'u5_org_b',
  'platform_membership_id', :'u5_admin_b_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u5_admin_b_claims_v2
\gset

SET LOCAL request.jwt.claims TO :'u5_admin_b_claims_v2';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u5_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_lead_admissions_gate(:'u5_lead_paid')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.lead_admissions_gates
    WHERE organization_id = :'u5_org_a'
  )
  AND (
    pg_temp.u5_attempt_mutation(
      :'u5_lead_paid', 3,
      '87000000-0000-4000-8000-000000000716',
      'confirm_contract', 1250.50, 'USD', '2026-09-15', NULL,
      'contract:cross-tenant', NULL
    ) ->> 'message'
  ) = 'admissions_gate_not_found_or_forbidden',
  'tenant B read or mutated tenant A gate facts'
);

RESET ROLE;

SET LOCAL request.jwt.claims TO :'u5_admin_a_claims_v2';
SET LOCAL ROLE authenticated;

SELECT platform.search_audit_events(
  p_actions => ARRAY['lead.admissions.gate.firstpayment.confirmed'],
  p_resource_types => ARRAY['lead'],
  p_resource_id => :'u5_lead_paid',
  p_page_size => 10
) AS u5_safe_audit_projection
\gset

SELECT pg_temp.u5_assert(
  pg_catalog.jsonb_array_length(
    :'u5_safe_audit_projection'::JSONB -> 'rows'
  ) = 1
  AND (
    :'u5_safe_audit_projection'::JSONB #>> '{rows,0,action}'
  ) = 'lead.admissions.gate.firstpayment.confirmed'
  AND (
    :'u5_safe_audit_projection'::JSONB #>> '{rows,0,resource_type}'
  ) = 'lead'
  AND (
    :'u5_safe_audit_projection'::JSONB #> '{rows,0,changed_field_codes}'
  ) ? 'first_payment_confirmation'
  AND (
    :'u5_safe_audit_projection'::JSONB #> '{rows,0,changed_field_codes}'
  ) ? 'gate_state',
  'first-payment audit was missing from the bounded safe projection'
);

RESET ROLE;

SELECT pg_temp.u5_assert(
  pg_temp.u5_attempt_audit_update(
    '87000000-0000-4000-8000-000000000713'
  ) <> 'allowed'
  AND pg_temp.u5_attempt_receipt_update(
    '87000000-0000-4000-8000-000000000713'
  ) <> 'allowed'
  AND (
    SELECT count(*) = 1
    FROM platform_private.lead_admissions_gate_receipts
    WHERE request_id = '87000000-0000-4000-8000-000000000710'
  )
  AND (
    SELECT count(*) = 1
      AND bool_and(actor_membership_id = :'u5_admin_a_membership')
      AND bool_and(reason = 'Director-approved pilot exception')
      AND bool_and(resulting_version = 2)
    FROM platform.audit_events
    WHERE request_id = '87000000-0000-4000-8000-000000000713'
      AND action = 'lead.admissions.gate.overridden'
  ),
  'override audit or receipt was mutable or lost actor/reason/version evidence'
);

SELECT pg_temp.u5_assert(
  (
    SELECT count(*) = 3
      AND bool_and(actor_kind = 'user')
      AND bool_and(actor_membership_id IS NOT NULL)
      AND bool_and(resulting_version IN (2, 3))
    FROM platform.audit_events
    WHERE request_id IN (
      '87000000-0000-4000-8000-000000000710',
      '87000000-0000-4000-8000-000000000712',
      '87000000-0000-4000-8000-000000000713'
    )
  ),
  'confirmation and override mutations did not create exact immutable audits'
);

ROLLBACK;
