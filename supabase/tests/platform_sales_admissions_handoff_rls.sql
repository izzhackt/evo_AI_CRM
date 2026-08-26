\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u6_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'U6 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_handoff(
  p_lead_id UUID,
  p_expected_gate_version BIGINT,
  p_admissions_owner_membership_id UUID,
  p_handoff_mode TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', TRUE,
    'result', platform.handoff_lead_to_admissions(
      p_lead_id,
      p_expected_gate_version,
      p_admissions_owner_membership_id,
      p_handoff_mode,
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

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_staff_read(
  p_lead_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  row_data RECORD;
BEGIN
  SELECT *
  INTO row_data
  FROM platform.staff_lead_admissions_handoff(p_lead_id)
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'result', to_jsonb(row_data)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_context_read(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  row_data RECORD;
BEGIN
  SELECT *
  INTO row_data
  FROM platform.staff_student_case_handoff_context(p_student_case_id)
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'result', to_jsonb(row_data)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_handoff_update(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform.sales_admissions_handoffs
  SET reason = 'tampered'
  WHERE organization_id = p_organization_id
    AND lead_id = p_lead_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_receipt_update(
  p_request_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE platform_private.sales_admissions_handoff_receipts
  SET reason = 'tampered'
  WHERE request_id = p_request_id;
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u6_attempt_duplicate_case(
  p_organization_id UUID,
  p_lead_id UUID,
  p_client_id UUID,
  p_sales_membership_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  duplicate_case_id UUID := '88000000-0000-4000-8000-000000000991'::UUID;
  duplicate_scope_id UUID := '88000000-0000-4000-8000-000000000992'::UUID;
BEGIN
  INSERT INTO platform.record_scopes (
    id,
    organization_id,
    scope_kind,
    scope_key,
    scope_version,
    is_active
  ) VALUES (
    duplicate_scope_id,
    p_organization_id,
    'student_case',
    duplicate_case_id,
    1,
    TRUE
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
    handoff_at,
    portal_activated_at,
    closed_at,
    next_action,
    current_scope_id,
    current_scope_version,
    canonical_client_id,
    canonical_lead_id
  ) VALUES (
    duplicate_case_id,
    p_organization_id,
    NULL,
    p_sales_membership_id,
    p_sales_membership_id,
    'synthetic-u6-duplicate-case',
    'u6-duplicate',
    statement_timestamp(),
    'U6 Duplicate Case',
    NULL,
    NULL,
    'draft',
    'admissions_handoff',
    'active',
    statement_timestamp(),
    NULL,
    NULL,
    'duplicate',
    duplicate_scope_id,
    1,
    p_client_id,
    p_lead_id
  );

  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.u6_assert(BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_handoff(
  UUID, BIGINT, UUID, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_staff_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_context_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_handoff_update(UUID, UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_receipt_update(UUID)
TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.u6_attempt_duplicate_case(
  UUID, UUID, UUID, UUID
) TO authenticated;
\set u6_org_a '88000000-0000-4000-8000-000000000001'
\set u6_org_b '88000000-0000-4000-8000-000000000002'
\set u6_scope_a '88000000-0000-4000-8000-000000000011'
\set u6_scope_b '88000000-0000-4000-8000-000000000012'
\set u6_scope_override_case '88000000-0000-4000-8000-000000000021'
\set u6_scope_identity_mismatch_case '88000000-0000-4000-8000-000000000022'

\set u6_admin_a_user '88000000-0000-4000-8000-000000000101'
\set u6_sales_a_user '88000000-0000-4000-8000-000000000102'
\set u6_sales_other_user '88000000-0000-4000-8000-000000000103'
\set u6_inactive_sales_user '88000000-0000-4000-8000-000000000104'
\set u6_curator_a_user '88000000-0000-4000-8000-000000000105'
\set u6_inactive_curator_user '88000000-0000-4000-8000-000000000106'
\set u6_admin_b_user '88000000-0000-4000-8000-000000000107'
\set u6_curator_b_user '88000000-0000-4000-8000-000000000108'
\set u6_student_a_user '88000000-0000-4000-8000-000000000109'

\set u6_admin_a_profile '88000000-0000-4000-8000-000000000201'
\set u6_sales_a_profile '88000000-0000-4000-8000-000000000202'
\set u6_sales_other_profile '88000000-0000-4000-8000-000000000203'
\set u6_inactive_sales_profile '88000000-0000-4000-8000-000000000204'
\set u6_curator_a_profile '88000000-0000-4000-8000-000000000205'
\set u6_inactive_curator_profile '88000000-0000-4000-8000-000000000206'
\set u6_admin_b_profile '88000000-0000-4000-8000-000000000207'
\set u6_curator_b_profile '88000000-0000-4000-8000-000000000208'
\set u6_student_a_profile '88000000-0000-4000-8000-000000000209'

\set u6_admin_a_membership '88000000-0000-4000-8000-000000000301'
\set u6_sales_a_membership '88000000-0000-4000-8000-000000000302'
\set u6_sales_other_membership '88000000-0000-4000-8000-000000000303'
\set u6_inactive_sales_membership '88000000-0000-4000-8000-000000000304'
\set u6_curator_a_membership '88000000-0000-4000-8000-000000000305'
\set u6_inactive_curator_membership '88000000-0000-4000-8000-000000000306'
\set u6_admin_b_membership '88000000-0000-4000-8000-000000000307'
\set u6_curator_b_membership '88000000-0000-4000-8000-000000000308'
\set u6_student_a_membership '88000000-0000-4000-8000-000000000309'

\set u6_client_normal '88000000-0000-4000-8000-000000000401'
\set u6_client_override '88000000-0000-4000-8000-000000000402'
\set u6_client_blocked '88000000-0000-4000-8000-000000000403'
\set u6_client_b '88000000-0000-4000-8000-000000000404'
\set u6_client_identity_mismatch '88000000-0000-4000-8000-000000000405'

\set u6_lead_normal '88000000-0000-4000-8000-000000000501'
\set u6_lead_override '88000000-0000-4000-8000-000000000502'
\set u6_lead_blocked '88000000-0000-4000-8000-000000000503'
\set u6_lead_b '88000000-0000-4000-8000-000000000504'
\set u6_lead_identity_mismatch '88000000-0000-4000-8000-000000000505'
\set u6_case_override_existing '88000000-0000-4000-8000-000000000801'
\set u6_case_identity_mismatch '88000000-0000-4000-8000-000000000802'

INSERT INTO platform.organizations (id, name)
VALUES
  (:'u6_org_a', 'U6 Organization A'),
  (:'u6_org_b', 'U6 Organization B');

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES
  (:'u6_scope_a', :'u6_org_a', 'organization', :'u6_org_a', 1),
  (:'u6_scope_b', :'u6_org_b', 'organization', :'u6_org_b', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'u6_admin_a_user', 'u6-admin-a@example.invalid', '{}'),
  (:'u6_sales_a_user', 'u6-sales-a@example.invalid', '{}'),
  (:'u6_sales_other_user', 'u6-sales-other@example.invalid', '{}'),
  (:'u6_inactive_sales_user', 'u6-inactive-sales@example.invalid', '{}'),
  (:'u6_curator_a_user', 'u6-curator-a@example.invalid', '{}'),
  (:'u6_inactive_curator_user', 'u6-inactive-curator@example.invalid', '{}'),
  (:'u6_admin_b_user', 'u6-admin-b@example.invalid', '{}'),
  (:'u6_curator_b_user', 'u6-curator-b@example.invalid', '{}'),
  (:'u6_student_a_user', 'u6-student-a@example.invalid', '{}');

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name,
  status,
  access_version
) VALUES
  (:'u6_admin_a_profile', :'u6_admin_a_user', 'U6 Admin A', 'active', 1),
  (:'u6_sales_a_profile', :'u6_sales_a_user', 'U6 Sales A', 'active', 1),
  (:'u6_sales_other_profile', :'u6_sales_other_user', 'U6 Sales Other', 'active', 1),
  (:'u6_inactive_sales_profile', :'u6_inactive_sales_user', 'U6 Inactive Sales', 'active', 1),
  (:'u6_curator_a_profile', :'u6_curator_a_user', 'U6 Curator A', 'active', 1),
  (:'u6_inactive_curator_profile', :'u6_inactive_curator_user', 'U6 Inactive Curator', 'active', 1),
  (:'u6_admin_b_profile', :'u6_admin_b_user', 'U6 Admin B', 'active', 1),
  (:'u6_curator_b_profile', :'u6_curator_b_user', 'U6 Curator B', 'active', 1),
  (:'u6_student_a_profile', :'u6_student_a_user', 'U6 Student A', 'active', 1);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) VALUES
  (:'u6_admin_a_membership', :'u6_org_a', :'u6_admin_a_profile', 'active', 'admin', '00000000-0000-4000-8000-000000001301'),
  (:'u6_sales_a_membership', :'u6_org_a', :'u6_sales_a_profile', 'active', 'sales', '00000000-0000-4000-8000-000000001302'),
  (:'u6_sales_other_membership', :'u6_org_a', :'u6_sales_other_profile', 'active', 'sales', '00000000-0000-4000-8000-000000001302'),
  (:'u6_inactive_sales_membership', :'u6_org_a', :'u6_inactive_sales_profile', 'inactive', 'sales', '00000000-0000-4000-8000-000000001302'),
  (:'u6_curator_a_membership', :'u6_org_a', :'u6_curator_a_profile', 'active', 'curator', '00000000-0000-4000-8000-000000001303'),
  (:'u6_inactive_curator_membership', :'u6_org_a', :'u6_inactive_curator_profile', 'inactive', 'curator', '00000000-0000-4000-8000-000000001303'),
  (:'u6_admin_b_membership', :'u6_org_b', :'u6_admin_b_profile', 'active', 'admin', '00000000-0000-4000-8000-000000001301'),
  (:'u6_curator_b_membership', :'u6_org_b', :'u6_curator_b_profile', 'active', 'curator', '00000000-0000-4000-8000-000000001303'),
  (:'u6_student_a_membership', :'u6_org_a', :'u6_student_a_profile', 'active', 'student', '00000000-0000-4000-8000-000000001305');

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
  'U6 organization authority fixture',
  fixture.request_id
FROM (VALUES
  ('88000000-0000-4000-8000-000000000601'::UUID, :'u6_org_a'::UUID, :'u6_admin_a_membership'::UUID, :'u6_scope_a'::UUID, '88000000-0000-4000-8000-000000000611'::UUID),
  ('88000000-0000-4000-8000-000000000602'::UUID, :'u6_org_a'::UUID, :'u6_sales_a_membership'::UUID, :'u6_scope_a'::UUID, '88000000-0000-4000-8000-000000000612'::UUID),
  ('88000000-0000-4000-8000-000000000603'::UUID, :'u6_org_a'::UUID, :'u6_sales_other_membership'::UUID, :'u6_scope_a'::UUID, '88000000-0000-4000-8000-000000000613'::UUID),
  ('88000000-0000-4000-8000-000000000604'::UUID, :'u6_org_a'::UUID, :'u6_curator_a_membership'::UUID, :'u6_scope_a'::UUID, '88000000-0000-4000-8000-000000000614'::UUID),
  ('88000000-0000-4000-8000-000000000605'::UUID, :'u6_org_b'::UUID, :'u6_admin_b_membership'::UUID, :'u6_scope_b'::UUID, '88000000-0000-4000-8000-000000000615'::UUID),
  ('88000000-0000-4000-8000-000000000606'::UUID, :'u6_org_b'::UUID, :'u6_curator_b_membership'::UUID, :'u6_scope_b'::UUID, '88000000-0000-4000-8000-000000000616'::UUID),
  ('88000000-0000-4000-8000-000000000607'::UUID, :'u6_org_a'::UUID, :'u6_student_a_membership'::UUID, :'u6_scope_a'::UUID, '88000000-0000-4000-8000-000000000617'::UUID)
) AS fixture(id, organization_id, membership_id, scope_id, request_id);

INSERT INTO platform.clients (
  id,
  organization_id,
  display_name,
  normalized_name
) VALUES
  (:'u6_client_normal', :'u6_org_a', 'U6 Client Normal', 'u6 client normal'),
  (:'u6_client_override', :'u6_org_a', 'U6 Client Override', 'u6 client override'),
  (:'u6_client_blocked', :'u6_org_a', 'U6 Client Blocked', 'u6 client blocked'),
  (:'u6_client_b', :'u6_org_b', 'U6 Client B', 'u6 client b'),
  (:'u6_client_identity_mismatch', :'u6_org_a', 'U6 Client Identity Mismatch', 'u6 client identity mismatch');

INSERT INTO platform.leads (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state
) VALUES
  (:'u6_lead_normal', :'u6_org_a', :'u6_client_normal', :'u6_sales_a_membership', 'qualified', 'u6_normal', 'open'),
  (:'u6_lead_override', :'u6_org_a', :'u6_client_override', :'u6_sales_a_membership', 'qualified', 'u6_override', 'open'),
  (:'u6_lead_blocked', :'u6_org_a', :'u6_client_blocked', :'u6_sales_a_membership', 'qualified', 'u6_blocked', 'open'),
  (:'u6_lead_b', :'u6_org_b', :'u6_client_b', :'u6_admin_b_membership', 'qualified', 'u6_b', 'open'),
  (:'u6_lead_identity_mismatch', :'u6_org_a', :'u6_client_identity_mismatch', :'u6_sales_a_membership', 'qualified', 'u6_identity_mismatch', 'open');

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = TRUE,
  contract_confirmed_by_membership_id = :'u6_admin_a_membership',
  contract_confirmed_by_profile_id = :'u6_admin_a_profile',
  contract_confirmed_at = '2099-01-01T09:00:00Z',
  contract_evidence_reference = 'U6-CONTRACT-NORMAL',
  first_payment_amount = 1200.00,
  first_payment_currency = 'USD',
  first_payment_due_date = DATE '2099-01-10',
  first_payment_received_date = DATE '2099-01-05',
  first_payment_confirmed_by_membership_id = :'u6_admin_a_membership',
  first_payment_confirmed_by_profile_id = :'u6_admin_a_profile',
  first_payment_confirmed_at = '2099-01-05T12:00:00Z',
  first_payment_evidence_reference = 'U6-PAYMENT-NORMAL',
  gate_state = 'satisfied',
  gate_version = 2
WHERE organization_id = :'u6_org_a'
  AND lead_id = :'u6_lead_normal';

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = FALSE,
  contract_confirmed_by_membership_id = NULL,
  contract_confirmed_by_profile_id = NULL,
  contract_confirmed_at = NULL,
  contract_evidence_reference = NULL,
  first_payment_amount = NULL,
  first_payment_currency = NULL,
  first_payment_due_date = NULL,
  first_payment_received_date = NULL,
  first_payment_confirmed_by_membership_id = NULL,
  first_payment_confirmed_by_profile_id = NULL,
  first_payment_confirmed_at = NULL,
  first_payment_evidence_reference = NULL,
  override_reason = 'Director approved exceptional handoff',
  overridden_by_membership_id = :'u6_admin_a_membership',
  overridden_by_profile_id = :'u6_admin_a_profile',
  overridden_at = '2099-01-06T10:00:00Z',
  gate_state = 'overridden',
  gate_version = 3
WHERE organization_id = :'u6_org_a'
  AND lead_id = :'u6_lead_override';

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = FALSE,
  contract_confirmed_by_membership_id = NULL,
  contract_confirmed_by_profile_id = NULL,
  contract_confirmed_at = NULL,
  contract_evidence_reference = NULL,
  first_payment_amount = NULL,
  first_payment_currency = NULL,
  first_payment_due_date = NULL,
  first_payment_received_date = NULL,
  first_payment_confirmed_by_membership_id = NULL,
  first_payment_confirmed_by_profile_id = NULL,
  first_payment_confirmed_at = NULL,
  first_payment_evidence_reference = NULL,
  override_reason = 'Director approved exceptional handoff',
  overridden_by_membership_id = :'u6_admin_a_membership',
  overridden_by_profile_id = :'u6_admin_a_profile',
  overridden_at = '2099-01-06T10:00:00Z',
  gate_state = 'overridden',
  gate_version = 3
WHERE organization_id = :'u6_org_a'
  AND lead_id = :'u6_lead_identity_mismatch';

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = TRUE,
  contract_confirmed_by_membership_id = :'u6_admin_a_membership',
  contract_confirmed_by_profile_id = :'u6_admin_a_profile',
  contract_confirmed_at = '2099-01-01T09:00:00Z',
  contract_evidence_reference = 'U6-CONTRACT-BLOCKED',
  gate_state = 'blocked',
  gate_version = 1
WHERE organization_id = :'u6_org_a'
  AND lead_id = :'u6_lead_blocked';

UPDATE platform.lead_admissions_gates
SET
  contract_confirmed = TRUE,
  contract_confirmed_by_membership_id = :'u6_admin_b_membership',
  contract_confirmed_by_profile_id = :'u6_admin_b_profile',
  contract_confirmed_at = '2099-01-01T09:00:00Z',
  contract_evidence_reference = 'U6-CONTRACT-B',
  first_payment_amount = 500.00,
  first_payment_currency = 'USD',
  first_payment_due_date = DATE '2099-01-03',
  first_payment_received_date = DATE '2099-01-03',
  first_payment_confirmed_by_membership_id = :'u6_admin_b_membership',
  first_payment_confirmed_by_profile_id = :'u6_admin_b_profile',
  first_payment_confirmed_at = '2099-01-03T12:00:00Z',
  first_payment_evidence_reference = 'U6-PAYMENT-B',
  gate_state = 'satisfied',
  gate_version = 2
WHERE organization_id = :'u6_org_b'
  AND lead_id = :'u6_lead_b';

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version
) VALUES
  (
    :'u6_scope_override_case',
    :'u6_org_a',
    'student_case',
    :'u6_case_override_existing',
    1
  ),
  (
    :'u6_scope_identity_mismatch_case',
    :'u6_org_a',
    'student_case',
    :'u6_case_identity_mismatch',
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
) VALUES
  (
    :'u6_case_override_existing',
    :'u6_org_a',
    NULL,
    :'u6_sales_a_membership',
    NULL,
    'canonical-lead:' || :'u6_lead_override',
    NULL,
    NULL,
    'U6 Client Override',
    NULL,
    NULL,
    'draft',
    'sales_handoff_pending',
    'pending',
    'Awaiting audited Admissions handoff',
    :'u6_scope_override_case',
    1,
    :'u6_client_override',
    :'u6_lead_override'
  ),
  (
    :'u6_case_identity_mismatch',
    :'u6_org_a',
    NULL,
    :'u6_sales_other_membership',
    NULL,
    'canonical-lead:' || :'u6_lead_identity_mismatch',
    'synthetic:mismatched-existing-case',
    TIMESTAMPTZ '2026-08-24 03:00:00+00',
    'U6 Client Identity Mismatch',
    NULL,
    NULL,
    'draft',
    'sales_handoff_pending',
    'pending',
    'Awaiting audited Admissions handoff',
    :'u6_scope_identity_mismatch_case',
    1,
    :'u6_client_identity_mismatch',
    :'u6_lead_identity_mismatch'
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
) VALUES (
  '88000000-0000-4000-8000-000000000608',
  :'u6_org_a',
  :'u6_sales_a_membership',
  :'u6_scope_override_case',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'U6 existing pending-case fixture',
  '88000000-0000-4000-8000-000000000618'
);

SELECT jsonb_build_object(
  'sub', :'u6_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_admin_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u6_admin_a_claims_v1,
jsonb_build_object(
  'sub', :'u6_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_sales_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u6_sales_a_claims_v1,
jsonb_build_object(
  'sub', :'u6_sales_other_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_sales_other_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u6_sales_other_claims_v1,
jsonb_build_object(
  'sub', :'u6_inactive_sales_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_inactive_sales_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001302',
  'platform_bundle_version', 13
)::TEXT AS u6_inactive_sales_claims_v1,
jsonb_build_object(
  'sub', :'u6_curator_a_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', 3,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_curator_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001303',
  'platform_bundle_version', 13
)::TEXT AS u6_curator_a_claims_v3,
jsonb_build_object(
  'sub', :'u6_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_b',
  'platform_membership_id', :'u6_admin_b_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001301',
  'platform_bundle_version', 13
)::TEXT AS u6_admin_b_claims_v1,
jsonb_build_object(
  'sub', :'u6_student_a_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', 1,
  'platform_organization_id', :'u6_org_a',
  'platform_membership_id', :'u6_student_a_membership',
  'platform_bundle_id', '00000000-0000-4000-8000-000000001305',
  'platform_bundle_version', 13
)::TEXT AS u6_student_a_claims_v1
\gset

SELECT pg_temp.u6_assert(
  (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'platform.sales_admissions_handoffs'::REGCLASS
  )
  AND (
    SELECT relrowsecurity AND relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid =
      'platform_private.sales_admissions_handoff_receipts'::REGCLASS
  ),
  'handoff or receipt table is not forced-RLS'
);

SET request.jwt.claims TO :'u6_sales_a_claims_v1';
SET ROLE authenticated;

SELECT pg_temp.u6_attempt_staff_read(:'u6_lead_normal') AS u6_sales_read_before \gset
SELECT pg_temp.u6_assert(
  (:'u6_sales_read_before'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u6_sales_read_before'::JSONB #>> '{result,can_submit_normal}')::BOOLEAN
  AND NOT COALESCE(
    (:'u6_sales_read_before'::JSONB #>> '{result,can_submit_exceptional}')::BOOLEAN,
    FALSE
  )
  AND jsonb_array_length(
    COALESCE(
      :'u6_sales_read_before'::JSONB #> '{result,eligible_admissions_owners}',
      '[]'::JSONB
    )
  ) = 1,
  'pre-handoff sales read model or eligible admissions owners is wrong'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Sales finished qualification and payment evidence',
  '88000000-0000-4000-8000-000000000701'
) AS u6_normal_first \gset

SELECT pg_temp.u6_assert(
  (:'u6_normal_first'::JSONB ->> 'ok')::BOOLEAN,
  'normal handoff should succeed'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Sales finished qualification and payment evidence',
  '88000000-0000-4000-8000-000000000701'
) AS u6_normal_same_request \gset

SELECT pg_temp.u6_assert(
  (:'u6_normal_same_request'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u6_normal_same_request'::JSONB #>> '{result,case_id}')
    = (:'u6_normal_first'::JSONB #>> '{result,case_id}'),
  'same-request replay should return the committed case'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Different replay reason',
  '88000000-0000-4000-8000-000000000701'
) AS u6_normal_same_request_conflict \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_normal_same_request_conflict'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_normal_same_request_conflict'::JSONB ->> 'sqlstate' = '23505',
  'same request id with different payload must conflict'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Sales finished qualification and payment evidence',
  '88000000-0000-4000-8000-000000000702'
) AS u6_normal_second_request \gset

SELECT pg_temp.u6_assert(
  (:'u6_normal_second_request'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u6_normal_second_request'::JSONB #>> '{result,case_id}')
    = (:'u6_normal_first'::JSONB #>> '{result,case_id}'),
  'different-request identical replay should converge on the same case'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_blocked',
  1,
  :'u6_curator_a_membership',
  'normal',
  'Blocked path should fail',
  '88000000-0000-4000-8000-000000000703'
) AS u6_blocked_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_blocked_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_blocked_attempt'::JSONB ->> 'sqlstate' = 'PT409',
  'blocked gate must stay blocked'
);

SET request.jwt.claims TO :'u6_sales_other_claims_v1';

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Wrong sales owner',
  '88000000-0000-4000-8000-000000000704'
) AS u6_wrong_sales_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_wrong_sales_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_wrong_sales_attempt'::JSONB ->> 'sqlstate' = '42501',
  'non-owner sales actor must be denied'
);

SET request.jwt.claims TO :'u6_inactive_sales_claims_v1';

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_blocked',
  1,
  :'u6_curator_a_membership',
  'normal',
  'Inactive sales actor',
  '88000000-0000-4000-8000-000000000705'
) AS u6_inactive_sales_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_inactive_sales_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_inactive_sales_attempt'::JSONB ->> 'sqlstate' = '42501',
  'inactive sales actor must be denied'
);

SET request.jwt.claims TO :'u6_admin_b_claims_v1';

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_normal',
  2,
  :'u6_curator_a_membership',
  'normal',
  'Cross-tenant admin attempt',
  '88000000-0000-4000-8000-000000000706'
) AS u6_cross_tenant_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_cross_tenant_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_cross_tenant_attempt'::JSONB ->> 'sqlstate' = '42501',
  'cross-tenant admin must be denied'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_b',
  2,
  :'u6_curator_b_membership',
  'normal',
  'Lead with non-Sales owner',
  '88000000-0000-4000-8000-000000000711'
) AS u6_invalid_sales_owner_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_invalid_sales_owner_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_invalid_sales_owner_attempt'::JSONB ->> 'sqlstate' = '42501',
  'handoff must deny a lead without an active Sales owner'
);

SET request.jwt.claims TO :'u6_admin_a_claims_v1';

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_blocked',
  1,
  :'u6_sales_a_membership',
  'normal',
  'Invalid owner role',
  '88000000-0000-4000-8000-000000000707'
) AS u6_invalid_owner_role \gset

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_blocked',
  1,
  :'u6_inactive_curator_membership',
  'normal',
  'Inactive curator owner',
  '88000000-0000-4000-8000-000000000708'
) AS u6_invalid_owner_inactive \gset

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_blocked',
  1,
  :'u6_curator_b_membership',
  'normal',
  'Cross-tenant curator owner',
  '88000000-0000-4000-8000-000000000709'
) AS u6_invalid_owner_cross_tenant \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_invalid_owner_role'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_invalid_owner_role'::JSONB ->> 'sqlstate' = '22023'
  AND NOT (:'u6_invalid_owner_inactive'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_invalid_owner_inactive'::JSONB ->> 'sqlstate' = '22023'
  AND NOT (:'u6_invalid_owner_cross_tenant'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_invalid_owner_cross_tenant'::JSONB ->> 'sqlstate' = '22023',
  'invalid admissions owner paths must fail closed'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_identity_mismatch',
  3,
  :'u6_curator_a_membership',
  'exceptional_override',
  'Existing pending identity mismatch',
  '88000000-0000-4000-8000-000000000713'
) AS u6_existing_identity_conflict_attempt \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_existing_identity_conflict_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_existing_identity_conflict_attempt'::JSONB ->> 'sqlstate' = 'PT409',
  'existing pending case must retain the canonical Sales owner and gate evidence'
);

SELECT pg_temp.u6_attempt_handoff(
  :'u6_lead_override',
  3,
  :'u6_curator_a_membership',
  'exceptional_override',
  'Director approved exceptional handoff',
  '88000000-0000-4000-8000-000000000710'
) AS u6_exceptional_attempt \gset

SELECT pg_temp.u6_assert(
  (:'u6_exceptional_attempt'::JSONB ->> 'ok')::BOOLEAN
  AND (:'u6_exceptional_attempt'::JSONB #>> '{result,case_id}')::UUID =
    :'u6_case_override_existing'::UUID
  AND (
    SELECT student_case.state = 'active'
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'u6_org_a'
      AND student_case.id = :'u6_case_override_existing'
  )
  AND (
    SELECT count(*)
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'u6_org_a'
      AND student_case.canonical_lead_id = :'u6_lead_override'
      AND student_case.state = 'active'
  ) = 1,
  'exceptional override must activate the existing canonical pending case'
);

SELECT pg_temp.u6_assert(
  EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    WHERE student_case.id =
      (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID
      AND student_case.organization_id = :'u6_org_a'
      AND student_case.canonical_lead_id = :'u6_lead_normal'
      AND student_case.state = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_definition
    WHERE index_definition.indexrelid =
      'platform.student_cases_one_open_case_per_canonical_lead_idx'::REGCLASS
      AND index_definition.indisvalid
      AND index_definition.indisunique
  ),
  'duplicate probe requires one active canonical case and a valid unique index'
);

SELECT pg_temp.u6_attempt_duplicate_case(
  :'u6_org_a',
  :'u6_lead_normal',
  :'u6_client_normal',
  :'u6_sales_a_membership'
) AS u6_duplicate_case_attempt \gset

SELECT pg_temp.u6_assert(
  :'u6_duplicate_case_attempt' IN ('23505', '55000'),
  'direct duplicate active-case creation should be blocked'
);

SELECT pg_temp.u6_assert(
  (SELECT count(*) FROM platform.student_cases WHERE organization_id = :'u6_org_a' AND canonical_lead_id = :'u6_lead_normal') = 1
  AND (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = :'u6_org_a' AND lead_id = :'u6_lead_normal') = 1
  AND (SELECT count(*) FROM platform.case_tasks WHERE organization_id = :'u6_org_a' AND student_case_id = (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID AND source_key LIKE 'u6.%') = 3
  AND (SELECT count(*) FROM platform.student_case_assignment_events WHERE organization_id = :'u6_org_a' AND student_case_id = (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID) = 1
  AND (SELECT count(*) FROM platform.student_case_lifecycle_events WHERE organization_id = :'u6_org_a' AND student_case_id = (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID AND event_type = 'activated') = 1,
  'normal handoff must create one case, one handoff, three tasks and both journals'
);

SELECT pg_temp.u6_assert(
  pg_temp.u6_attempt_handoff_update(:'u6_org_a', :'u6_lead_normal') = '55000'
  AND pg_temp.u6_attempt_receipt_update('88000000-0000-4000-8000-000000000701'::UUID) = '55000',
  'handoff evidence or receipts are not append-only'
);

SELECT pg_temp.u6_attempt_context_read(
  (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID
) AS u6_context_admin \gset

SELECT pg_temp.u6_assert(
  (:'u6_context_admin'::JSONB ->> 'ok')::BOOLEAN
  AND jsonb_array_length(COALESCE(:'u6_context_admin'::JSONB #> '{result,starter_tasks}', '[]'::JSONB)) = 3,
  'admissions context read must expose immutable handoff context and three starter tasks'
);

SET request.jwt.claims TO :'u6_curator_a_claims_v3';

SELECT pg_temp.u6_attempt_context_read(
  (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID
) AS u6_context_curator \gset

SELECT pg_temp.u6_assert(
  (:'u6_context_curator'::JSONB ->> 'ok')::BOOLEAN,
  'assigned curator must read the handoff context'
);

SELECT pg_temp.u6_assert(
  (SELECT count(*) FROM platform.student_portal_cases()) = 0,
  'U6 must not broaden student portal reads for non-student actors'
);

SET request.jwt.claims TO :'u6_sales_a_claims_v1';

SELECT pg_temp.u6_attempt_context_read(
  (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID
) AS u6_context_sales \gset

SELECT pg_temp.u6_assert(
  NOT (:'u6_context_sales'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_context_sales'::JSONB ->> 'sqlstate' = '42501',
  'Sales must retain only the bounded summary and not full Admissions context'
);

SET request.jwt.claims TO :'u6_student_a_claims_v1';

SELECT pg_temp.u6_attempt_context_read(
  (:'u6_normal_first'::JSONB #>> '{result,case_id}')::UUID
) AS u6_context_student \gset

SELECT pg_temp.u6_assert(
  (SELECT count(*) FROM platform.student_portal_cases()) = 0
  AND NOT (:'u6_context_student'::JSONB ->> 'ok')::BOOLEAN
  AND :'u6_context_student'::JSONB ->> 'sqlstate' = '42501',
  'student portal users must not inherit staff handoff context or unrelated cases'
);

RESET ROLE;

SELECT pg_temp.u6_assert(
  (:'u6_exceptional_attempt'::JSONB ->> 'ok')::BOOLEAN,
  'exceptional override without normal contract evidence should succeed'
);

ROLLBACK;
