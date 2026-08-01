\set ON_ERROR_STOP on

-- Disposable BW1 authorization/versioning proof. All identities and source
-- locators are synthetic or public plan references; no provider is contacted.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW1 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT) TO authenticated;

\set bw1_org_a '51000000-0000-4000-8000-000000000001'
\set bw1_org_b '51100000-0000-4000-8000-000000000001'
\set bw1_admin_user '51000000-0000-4000-8000-000000000101'
\set bw1_sales_user '51000000-0000-4000-8000-000000000102'
\set bw1_curator_user '51000000-0000-4000-8000-000000000103'
\set bw1_finance_user '51000000-0000-4000-8000-000000000104'
\set bw1_student_user '51000000-0000-4000-8000-000000000105'
\set bw1_admin_b_user '51100000-0000-4000-8000-000000000101'
\set bw1_admin_profile '51000000-0000-4000-8000-000000000201'
\set bw1_sales_profile '51000000-0000-4000-8000-000000000202'
\set bw1_curator_profile '51000000-0000-4000-8000-000000000203'
\set bw1_finance_profile '51000000-0000-4000-8000-000000000204'
\set bw1_student_profile '51000000-0000-4000-8000-000000000205'
\set bw1_admin_b_profile '51100000-0000-4000-8000-000000000201'
\set bw1_admin_membership '51000000-0000-4000-8000-000000000301'
\set bw1_sales_membership '51000000-0000-4000-8000-000000000302'
\set bw1_curator_membership '51000000-0000-4000-8000-000000000303'
\set bw1_finance_membership '51000000-0000-4000-8000-000000000304'
\set bw1_student_membership '51000000-0000-4000-8000-000000000305'
\set bw1_admin_b_membership '51100000-0000-4000-8000-000000000301'
\set bw1_scope_a '51000000-0000-4000-8000-000000000401'
\set bw1_scope_b '51100000-0000-4000-8000-000000000401'

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'bw1_admin_user', 'bw1-admin@example.invalid', '{}'),
  (:'bw1_sales_user', 'bw1-sales@example.invalid', '{}'),
  (:'bw1_curator_user', 'bw1-curator@example.invalid', '{}'),
  (:'bw1_finance_user', 'bw1-finance@example.invalid', '{}'),
  (:'bw1_student_user', 'bw1-student@example.invalid', '{}'),
  (:'bw1_admin_b_user', 'bw1-admin-b@example.invalid', '{}');

BEGIN;
INSERT INTO platform.organizations (id, name)
VALUES
  (:'bw1_org_a', 'BW1 Synthetic Organization A'),
  (:'bw1_org_b', 'BW1 Synthetic Organization B');
INSERT INTO platform.profiles (id, auth_user_id, display_name)
VALUES
  (:'bw1_admin_profile', :'bw1_admin_user', 'BW1 Admin'),
  (:'bw1_sales_profile', :'bw1_sales_user', 'BW1 Sales'),
  (:'bw1_curator_profile', :'bw1_curator_user', 'BW1 Curator'),
  (:'bw1_finance_profile', :'bw1_finance_user', 'BW1 Finance'),
  (:'bw1_student_profile', :'bw1_student_user', 'BW1 Student'),
  (:'bw1_admin_b_profile', :'bw1_admin_b_user', 'BW1 Admin B');
INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
SELECT seed.membership_id, seed.organization_id, seed.profile_id, 'active',
  seed.business_role, bundle.id
FROM (
  VALUES
    (:'bw1_admin_membership'::UUID, :'bw1_org_a'::UUID, :'bw1_admin_profile'::UUID, 'admin'::platform.business_role),
    (:'bw1_sales_membership'::UUID, :'bw1_org_a'::UUID, :'bw1_sales_profile'::UUID, 'sales'::platform.business_role),
    (:'bw1_curator_membership'::UUID, :'bw1_org_a'::UUID, :'bw1_curator_profile'::UUID, 'curator'::platform.business_role),
    (:'bw1_finance_membership'::UUID, :'bw1_org_a'::UUID, :'bw1_finance_profile'::UUID, 'finance'::platform.business_role),
    (:'bw1_student_membership'::UUID, :'bw1_org_a'::UUID, :'bw1_student_profile'::UUID, 'student'::platform.business_role),
    (:'bw1_admin_b_membership'::UUID, :'bw1_org_b'::UUID, :'bw1_admin_b_profile'::UUID, 'admin'::platform.business_role)
) AS seed(membership_id, organization_id, profile_id, business_role)
JOIN platform.role_bundle_versions AS bundle
  ON bundle.role = seed.business_role
  AND bundle.version = 7
  AND bundle.status = 'published';
INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key
)
VALUES
  (:'bw1_scope_a', :'bw1_org_a', 'organization', :'bw1_org_a'),
  (:'bw1_scope_b', :'bw1_org_b', 'organization', :'bw1_org_b');
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id
)
SELECT seed.organization_id, seed.membership_id, seed.scope_id, 1, 1, TRUE,
  'system', 'BW1 synthetic organization scope', seed.request_id
FROM (
  VALUES
    (:'bw1_org_a'::UUID, :'bw1_admin_membership'::UUID, :'bw1_scope_a'::UUID, '51000000-0000-4000-8000-000000000501'::UUID),
    (:'bw1_org_a'::UUID, :'bw1_sales_membership'::UUID, :'bw1_scope_a'::UUID, '51000000-0000-4000-8000-000000000502'::UUID),
    (:'bw1_org_a'::UUID, :'bw1_curator_membership'::UUID, :'bw1_scope_a'::UUID, '51000000-0000-4000-8000-000000000503'::UUID),
    (:'bw1_org_a'::UUID, :'bw1_finance_membership'::UUID, :'bw1_scope_a'::UUID, '51000000-0000-4000-8000-000000000504'::UUID),
    (:'bw1_org_a'::UUID, :'bw1_student_membership'::UUID, :'bw1_scope_a'::UUID, '51000000-0000-4000-8000-000000000505'::UUID),
    (:'bw1_org_b'::UUID, :'bw1_admin_b_membership'::UUID, :'bw1_scope_b'::UUID, '51100000-0000-4000-8000-000000000501'::UUID)
) AS seed(organization_id, membership_id, scope_id, request_id);
COMMIT;

SELECT jsonb_build_object(
  'sub', :'bw1_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1
)::TEXT AS bw1_admin_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw1_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1
)::TEXT AS bw1_sales_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw1_curator_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1
)::TEXT AS bw1_curator_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw1_finance_user', 'role', 'authenticated',
  'platform_role', 'finance', 'platform_access_version', 1
)::TEXT AS bw1_finance_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw1_student_user', 'role', 'authenticated',
  'platform_role', 'student', 'platform_access_version', 1
)::TEXT AS bw1_student_claims \gset
SELECT jsonb_build_object(
  'sub', :'bw1_admin_b_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1
)::TEXT AS bw1_admin_b_claims \gset

SET request.jwt.claims TO :'bw1_admin_claims';
SET ROLE authenticated;

-- Direct writes stay unavailable even to Admin.
\set ON_ERROR_STOP off
INSERT INTO platform.source_registry (
  organization_id, source_key, source_kind, source_url,
  created_by_membership_id
) VALUES (
  :'bw1_org_a', 'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'google_document',
  'https://docs.google.com/document/d/1234567890/edit',
  :'bw1_admin_membership'
);
\set bw1_direct_insert_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_direct_insert_state' = '42501',
  'Admin unexpectedly received direct INSERT privilege'
);

-- Unsafe canonical URLs fail before any row or audit is written.
\set ON_ERROR_STOP off
SELECT platform.register_workflow_source(
  :'bw1_org_a', 'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', 'google_document',
  'https://docs.google.com/document/d/1234567890/edit?token=secret',
  'revision1', 'unsafe query denial',
  '51000000-0000-4000-8000-000000000601'
);
\set bw1_query_url_state :SQLSTATE
SELECT platform.register_workflow_source(
  :'bw1_org_a', 'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac', 'google_document',
  'https://user@docs.google.com/document/d/1234567890/edit',
  'revision1', 'unsafe userinfo denial',
  '51000000-0000-4000-8000-000000000602'
);
\set bw1_userinfo_url_state :SQLSTATE
SELECT platform.register_workflow_source(
  :'bw1_org_a', 'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad', 'google_document',
  'https://docs.google.com/document/d/1234567890/edit#fragment',
  'revision1', 'unsafe fragment denial',
  '51000000-0000-4000-8000-000000000603'
);
\set bw1_fragment_url_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_query_url_state' = '22023'
    AND :'bw1_userinfo_url_state' = '22023'
    AND :'bw1_fragment_url_state' = '22023',
  'unsafe source URL was accepted'
);

SELECT platform.register_workflow_source(
  :'bw1_org_a', 'src_11111111111111111111111111111111', 'google_document',
  'https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit',
  'revision20260730', 'register reviewed plan source',
  '51000000-0000-4000-8000-000000000610'
)::TEXT AS bw1_source_id \gset

SELECT pg_temp.assert_true(
  platform.register_workflow_source(
    :'bw1_org_a', 'src_11111111111111111111111111111111', 'google_document',
    'https://docs.google.com/document/d/1-ZrRawX2gdCmwz-vq8vYEBXnzSDVC-10wUeCuPhwlaA/edit',
    'revision20260730', 'register reviewed plan source',
    '51000000-0000-4000-8000-000000000610'
  ) = :'bw1_source_id'::UUID,
  'exact source registration replay changed identity'
);
\set ON_ERROR_STOP off
SELECT platform.register_workflow_source(
  :'bw1_org_a', 'src_11111111111111111111111111111111', 'google_document',
  'https://docs.google.com/document/d/DIFFERENT1234567890/edit',
  'revision20260730', 'register reviewed plan source',
  '51000000-0000-4000-8000-000000000610'
);
\set bw1_changed_replay_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_changed_replay_state' = '22023',
  'changed payload reused a request_id'
);

SELECT platform.review_workflow_source(
  :'bw1_org_a', :'bw1_source_id', 'reviewed',
  'approve repository plan provenance',
  '51000000-0000-4000-8000-000000000611'
);
SELECT platform.create_workflow_contract(
  :'bw1_org_a', 'wf_op', 'op', 'create normalized op contract',
  '51000000-0000-4000-8000-000000000612'
)::TEXT AS bw1_op_contract_id \gset
SELECT platform.create_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_contract_id', 1,
  ARRAY['new','contacting','qualified','meeting_scheduled','meeting_completed','potential','contract_signed'],
  ARRAY['no_answer','meeting_not_attended'], ARRAY['won','lost'], ARRAY[]::TEXT[],
  'create normalized op v1',
  '51000000-0000-4000-8000-000000000613'
)::TEXT AS bw1_op_v1_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw1_org_a', :'bw1_op_v1_id', :'bw1_source_id',
  'link op v1 provenance',
  '51000000-0000-4000-8000-000000000614'
);
SELECT platform.approve_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v1_id', 'approve normalized op v1',
  '51000000-0000-4000-8000-000000000615'
);

SELECT platform.create_workflow_contract(
  :'bw1_org_a', 'wf_ozo', 'ozo', 'create normalized ozo contract',
  '51000000-0000-4000-8000-000000000616'
)::TEXT AS bw1_ozo_contract_id \gset
SELECT platform.create_workflow_contract_version(
  :'bw1_org_a', :'bw1_ozo_contract_id', 1,
  ARRAY['intake','profile_and_route','documents','applications','decisions','visa_and_predeparture','arrival_and_adaptation','completed','closed'],
  ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY['completed','closed'],
  'create normalized ozo v1',
  '51000000-0000-4000-8000-000000000617'
)::TEXT AS bw1_ozo_v1_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw1_org_a', :'bw1_ozo_v1_id', :'bw1_source_id',
  'link ozo v1 provenance',
  '51000000-0000-4000-8000-000000000618'
);
SELECT platform.approve_workflow_contract_version(
  :'bw1_org_a', :'bw1_ozo_v1_id', 'approve normalized ozo v1',
  '51000000-0000-4000-8000-000000000619'
);
RESET ROLE;

-- Each non-student staff role sees only the reviewed source and approved v1
-- contracts; Student and another organization see nothing.
SET request.jwt.claims TO :'bw1_sales_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_sales_sources FROM platform.source_registry \gset
SELECT count(*)::TEXT AS bw1_sales_contracts FROM platform.workflow_contracts \gset
SELECT count(*)::TEXT AS bw1_sales_versions FROM platform.workflow_contract_versions \gset
RESET ROLE;
SET request.jwt.claims TO :'bw1_curator_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_curator_versions FROM platform.workflow_contract_versions \gset
RESET ROLE;
SET request.jwt.claims TO :'bw1_finance_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_finance_versions FROM platform.workflow_contract_versions \gset
RESET ROLE;
SET request.jwt.claims TO :'bw1_student_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_student_sources FROM platform.source_registry \gset
SELECT count(*)::TEXT AS bw1_student_contracts FROM platform.workflow_contracts \gset
SELECT count(*)::TEXT AS bw1_student_versions FROM platform.workflow_contract_versions \gset
\set ON_ERROR_STOP off
SELECT platform.create_workflow_contract(
  :'bw1_org_a', 'wf_op', 'op', 'student denied',
  '51000000-0000-4000-8000-000000000620'
);
\set bw1_student_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SET request.jwt.claims TO :'bw1_admin_b_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_cross_org_sources FROM platform.source_registry \gset
SELECT count(*)::TEXT AS bw1_cross_org_contracts FROM platform.workflow_contracts \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw1_sales_sources' = '1'
    AND :'bw1_sales_contracts' = '2'
    AND :'bw1_sales_versions' = '2'
    AND :'bw1_curator_versions' = '2'
    AND :'bw1_finance_versions' = '2'
    AND :'bw1_student_sources' = '0'
    AND :'bw1_student_contracts' = '0'
    AND :'bw1_student_versions' = '0'
    AND :'bw1_cross_org_sources' = '0'
    AND :'bw1_cross_org_contracts' = '0'
    AND :'bw1_student_rpc_state' = '42501',
  'staff/student/cross-organization RLS matrix failed'
);

-- service_role has neither direct table access nor workflow mutation RPC use.
SET request.jwt.claims TO '{"role":"service_role"}'; SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT * FROM platform.source_registry;
\set bw1_service_select_state :SQLSTATE
SELECT platform.create_workflow_contract(
  :'bw1_org_a', 'wf_op', 'op', 'service denied',
  '51000000-0000-4000-8000-000000000621'
);
\set bw1_service_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw1_service_select_state' = '42501'
    AND :'bw1_service_rpc_state' = '42501',
  'service_role received a direct BW1 table/RPC path'
);

-- A second exact OP version cannot become approved while v1 is approved.
SET request.jwt.claims TO :'bw1_admin_claims'; SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_contract_id', 3,
  ARRAY['new','contacting','qualified','meeting_scheduled','meeting_completed','potential','contract_signed'],
  ARRAY['no_answer','meeting_not_attended'], ARRAY['won','lost'], ARRAY[]::TEXT[],
  'reject skipped op version',
  '51000000-0000-4000-8000-000000000633'
);
\set bw1_skipped_version_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_skipped_version_state' = '22023',
  'a non-sequential workflow version was accepted'
);
SELECT platform.create_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_contract_id', 2,
  ARRAY['new','contacting','qualified','meeting_scheduled','meeting_completed','potential','contract_signed'],
  ARRAY['no_answer','meeting_not_attended'], ARRAY['won','lost'], ARRAY[]::TEXT[],
  'create normalized op v2',
  '51000000-0000-4000-8000-000000000622'
)::TEXT AS bw1_op_v2_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw1_org_a', :'bw1_op_v2_id', :'bw1_source_id',
  'link op v2 provenance',
  '51000000-0000-4000-8000-000000000623'
);
\set ON_ERROR_STOP off
SELECT platform.approve_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v2_id', 'approve normalized op v2 too early',
  '51000000-0000-4000-8000-000000000624'
);
\set bw1_second_approved_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_second_approved_state' = '23505',
  'more than one approved version was allowed'
);
SELECT platform.retire_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v1_id', 'retire superseded op v1',
  '51000000-0000-4000-8000-000000000625'
);
SELECT platform.approve_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v2_id', 'approve normalized op v2 successor',
  '51000000-0000-4000-8000-000000000626'
);

-- Retiring definitions and their source preserves staff-readable history, but
-- a retired source cannot authorize a new approval.
SELECT platform.retire_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v2_id', 'retire op v2 historical definition',
  '51000000-0000-4000-8000-000000000627'
);
SELECT platform.retire_workflow_contract_version(
  :'bw1_org_a', :'bw1_ozo_v1_id', 'retire ozo v1 historical definition',
  '51000000-0000-4000-8000-000000000628'
);
SELECT platform.retire_workflow_source(
  :'bw1_org_a', :'bw1_source_id', 'retire superseded plan source',
  '51000000-0000-4000-8000-000000000629'
);
SELECT platform.create_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_contract_id', 3,
  ARRAY['new','contacting','qualified','meeting_scheduled','meeting_completed','potential','contract_signed'],
  ARRAY['no_answer','meeting_not_attended'], ARRAY['won','lost'], ARRAY[]::TEXT[],
  'create normalized op v3',
  '51000000-0000-4000-8000-000000000630'
)::TEXT AS bw1_op_v3_id \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw1_org_a', :'bw1_op_v3_id', :'bw1_source_id',
  'link retired provenance for denial proof',
  '51000000-0000-4000-8000-000000000631'
);
\set ON_ERROR_STOP off
SELECT platform.approve_workflow_contract_version(
  :'bw1_org_a', :'bw1_op_v3_id', 'reject retired provenance',
  '51000000-0000-4000-8000-000000000632'
);
\set bw1_retired_source_approval_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw1_sales_claims'; SET ROLE authenticated;
SELECT count(*)::TEXT AS bw1_historical_sources FROM platform.source_registry \gset
SELECT count(*)::TEXT AS bw1_historical_contracts FROM platform.workflow_contracts \gset
SELECT count(*)::TEXT AS bw1_historical_versions FROM platform.workflow_contract_versions \gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'bw1_historical_sources' = '1'
    AND :'bw1_historical_contracts' = '2'
    AND :'bw1_historical_versions' = '3'
    AND :'bw1_retired_source_approval_state' = '22023',
  'retired provenance history or new-approval denial failed'
);

-- Even the migration owner cannot rewrite approved/retired definitions or
-- append provenance to a non-draft version.
\set ON_ERROR_STOP off
UPDATE platform.workflow_contract_versions
SET stage_keys = ARRAY['tampered']
WHERE id = :'bw1_op_v1_id';
\set bw1_retired_mutation_state :SQLSTATE
UPDATE platform.workflow_contract_versions
SET stage_keys = ARRAY['tampered']
WHERE id = :'bw1_op_v2_id';
\set bw1_approved_mutation_state :SQLSTATE
INSERT INTO platform.workflow_contract_version_sources (
  organization_id, workflow_contract_id, workflow_contract_version_id,
  source_registry_id, created_by_membership_id
) VALUES (
  :'bw1_org_a', :'bw1_op_contract_id', :'bw1_op_v2_id',
  :'bw1_source_id', :'bw1_admin_membership'
);
\set bw1_approved_link_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'bw1_retired_mutation_state' = '55000'
    AND :'bw1_approved_mutation_state' = '55000'
    AND :'bw1_approved_link_state' IN ('55000', '23505'),
  'approved/retired workflow evidence remained mutable'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) FROM platform.audit_events
    WHERE request_id IN (
      '51000000-0000-4000-8000-000000000610',
      '51000000-0000-4000-8000-000000000611',
      '51000000-0000-4000-8000-000000000612',
      '51000000-0000-4000-8000-000000000613',
      '51000000-0000-4000-8000-000000000614',
      '51000000-0000-4000-8000-000000000615',
      '51000000-0000-4000-8000-000000000616',
      '51000000-0000-4000-8000-000000000617',
      '51000000-0000-4000-8000-000000000618',
      '51000000-0000-4000-8000-000000000619',
      '51000000-0000-4000-8000-000000000622',
      '51000000-0000-4000-8000-000000000623',
      '51000000-0000-4000-8000-000000000625',
      '51000000-0000-4000-8000-000000000626',
      '51000000-0000-4000-8000-000000000627',
      '51000000-0000-4000-8000-000000000628',
      '51000000-0000-4000-8000-000000000629',
      '51000000-0000-4000-8000-000000000630',
      '51000000-0000-4000-8000-000000000631'
    )
  ) = 19,
  'BW1 guarded mutations did not produce one audit per request'
);

SELECT 'platform business workflow contract RLS passed' AS result;
