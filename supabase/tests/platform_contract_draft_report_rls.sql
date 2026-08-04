\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- BW6 stateful authorization and lifecycle proof. Every value is synthetic,
-- the transaction is rolled back, and no provider, document body, customer
-- record or legacy SQLite plane is read or mutated.
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
    RAISE EXCEPTION 'BW6 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

\set bw6_admin_a_user '51000000-0000-4000-8000-000000000101'
\set bw6_sales_a_user '51000000-0000-4000-8000-000000000102'
\set bw6_curator_a_user '51000000-0000-4000-8000-000000000103'
\set bw6_finance_a_user '51000000-0000-4000-8000-000000000104'
\set bw6_student_a_user '51000000-0000-4000-8000-000000000105'
\set bw6_admin_b_user '51100000-0000-4000-8000-000000000101'

SELECT
  membership.organization_id AS bw6_org_a,
  membership.id AS bw6_admin_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_admin_a_user'
\gset
SELECT
  membership.organization_id AS bw6_org_b,
  membership.id AS bw6_admin_b_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_admin_b_user'
\gset
SELECT membership.id AS bw6_sales_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_sales_a_user'
  AND membership.organization_id = :'bw6_org_a'
\gset
SELECT membership.id AS bw6_curator_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_curator_a_user'
  AND membership.organization_id = :'bw6_org_a'
\gset
SELECT membership.id AS bw6_finance_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_finance_a_user'
  AND membership.organization_id = :'bw6_org_a'
\gset
SELECT membership.id AS bw6_student_a_membership
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = :'bw6_student_a_user'
  AND membership.organization_id = :'bw6_org_a'
\gset

SELECT
  student_case.id AS bw6_active_case
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw6_org_a'
  AND student_case.source_key = 'bw2-synthetic-case-001'
\gset
SELECT student_case.student_membership_id AS bw6_pending_student_membership
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw6_org_a'
  AND student_case.source_key = 'bw3-synthetic-case-003'
\gset
SELECT count(*) AS bw6_legacy_contacts_before FROM public.contacts \gset

SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw6_service_claims \gset

-- The earlier BW2 denial proof intentionally retired its current OP version.
-- Establish a new reviewed current OP version through the audited Admin APIs;
-- keep using the still-current OZO version and the existing reviewed source.
SELECT contract.id AS bw6_op_contract_id
FROM platform.workflow_contracts AS contract
WHERE contract.organization_id = :'bw6_org_a'
  AND contract.workflow_kind = 'op'
\gset
SELECT version.id AS bw6_ozo_version
FROM platform.workflow_contract_versions AS version
JOIN platform.workflow_contracts AS contract
  ON contract.organization_id = version.organization_id
  AND contract.id = version.workflow_contract_id
WHERE version.organization_id = :'bw6_org_a'
  AND contract.workflow_kind = 'ozo'
  AND version.status = 'approved'
\gset
SELECT source.id AS bw6_workflow_source_id
FROM platform.source_registry AS source
WHERE source.organization_id = :'bw6_org_a'
  AND source.review_status = 'reviewed'
ORDER BY source.created_at, source.id
LIMIT 1
\gset
SELECT (COALESCE(max(version.version), 0) + 1)::TEXT
  AS bw6_op_version_number
FROM platform.workflow_contract_versions AS version
WHERE version.organization_id = :'bw6_org_a'
  AND version.workflow_contract_id = :'bw6_op_contract_id'
\gset
SELECT jsonb_build_object(
  'sub', :'bw6_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version
)::TEXT AS bw6_admin_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_admin_a_user' \gset
SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_workflow_contract_version(
  :'bw6_org_a', :'bw6_op_contract_id', :'bw6_op_version_number'::BIGINT,
  ARRAY[
    'new', 'contacting', 'qualified', 'meeting_scheduled',
    'meeting_completed', 'potential', 'contract_signed'
  ],
  ARRAY['no_answer', 'meeting_not_attended'],
  ARRAY['won', 'lost'],
  ARRAY[]::TEXT[],
  'Create current synthetic BW6 OP version',
  '57000000-0000-4000-8000-000000000011'
)::TEXT AS bw6_op_version \gset
SELECT platform.link_workflow_contract_version_source(
  :'bw6_org_a', :'bw6_op_version', :'bw6_workflow_source_id',
  'Link current synthetic BW6 OP provenance',
  '57000000-0000-4000-8000-000000000012'
);
SELECT platform.approve_workflow_contract_version(
  :'bw6_org_a', :'bw6_op_version',
  'Approve current synthetic BW6 OP version',
  '57000000-0000-4000-8000-000000000013'
);
RESET ROLE;

-- Create a second confirmed/handoff case that remains pending and is owned by
-- the existing Sales fixture. The service call is database-local and carries
-- only synthetic fields.
SET request.jwt.claims TO :'bw6_service_claims';
SET ROLE service_role;
SELECT platform.create_pending_student_case_with_handoff(
  :'bw6_org_a',
  :'bw6_pending_student_membership',
  :'bw6_sales_a_membership',
  'bw6-synthetic-sales-pending',
  'bw6-synthetic-contract-confirmation',
  '2026-08-04T08:00:00Z'::TIMESTAMPTZ,
  'BW6 Synthetic Pending Student',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  'synthetic_intake',
  'ru',
  'synthetic_budget',
  'intake',
  'Review synthetic contract draft',
  :'bw6_op_version',
  :'bw6_ozo_version',
  '{"service_package":"synthetic_standard","fee_currency":"USD","fee_amount_minor":125000,"payment_terms":"synthetic_single_payment"}'::JSONB,
  '[]'::JSONB,
  '[]'::JSONB,
  'Complete synthetic contract review',
  '2026-08-20T08:00:00Z'::TIMESTAMPTZ,
  'sales',
  '57000000-0000-4000-8000-000000000001'
)::TEXT AS bw6_pending_case_result \gset
RESET ROLE;

SELECT (:'bw6_pending_case_result'::JSONB ->> 'student_case_id')::UUID
  AS bw6_pending_case \gset

-- BW2 already assigned the active case to this Curator. The new pending case
-- changes live Sales/Student scope, so every claim is refreshed from the
-- database rather than reusing a stale access version.
SELECT jsonb_build_object(
  'sub', :'bw6_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version
)::TEXT AS bw6_admin_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_admin_a_user' \gset
SELECT jsonb_build_object(
  'sub', :'bw6_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version

)::TEXT AS bw6_admin_b_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_admin_b_user' \gset
SELECT jsonb_build_object(
  'sub', :'bw6_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version

)::TEXT AS bw6_sales_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_sales_a_user' \gset
SELECT jsonb_build_object(
  'sub', :'bw6_curator_a_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw6_curator_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_curator_a_user' \gset
SELECT jsonb_build_object(
  'sub', :'bw6_finance_a_user',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', profile.access_version
)::TEXT AS bw6_finance_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_finance_a_user' \gset
SELECT jsonb_build_object(
  'sub', :'bw6_student_a_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version
)::TEXT AS bw6_student_a_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw6_student_a_user' \gset

-- Register an exact-revision synthetic repository source. PostgreSQL never
-- dereferences the URL. Template creation must fail until Admin review.
SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw6_org_a',
  'src_57000000000000000000000000000001',
  'repository_contract',
  'https://github.com/example/evo-contracts/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bw6_synthetic_v1',
  'Register synthetic BW6 contract template source',
  '57000000-0000-4000-8000-000000000010'
)::TEXT AS bw6_pending_source_id \gset

\set ON_ERROR_STOP off
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_synthetic_service', 'Synthetic Service Contract',
  :'bw6_pending_source_id',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true},{"field_key":"service_package","source_path":"handoff.approved_commercial_fields.service_package","value_type":"text","required":true},{"field_key":"fee_currency","source_path":"handoff.approved_commercial_fields.fee_currency","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}
Package: {{service_package}}
Currency: {{fee_currency}}',
  '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send the synthetic non-provider welcome pack"},{"item_key":"document_review","label":"Review synthetic document plan","owner_role":"curator","next_action":"Review the synthetic document plan"}]'::JSONB,
  'Pending source must not create a template',
  '57000000-0000-4000-8000-000000000011'
);
\set bw6_unreviewed_source_state :SQLSTATE
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_unknown_source', 'Unknown Source Contract',
  '57000000-0000-4000-8000-00000000ffff',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}',
  '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send synthetic pack"}]'::JSONB,

  'Unknown source must fail',
  '57000000-0000-4000-8000-000000000012'
);
\set bw6_unknown_source_state :SQLSTATE
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_unknown_manifest', 'Unknown Manifest Contract',
  :'bw6_pending_source_id',
  '[{"field_key":"chat","source_path":"chat.raw_body","value_type":"text","required":true}]'::JSONB,
  'Chat: {{chat}}',
  '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send synthetic pack"}]'::JSONB,
  'Unknown manifest path must fail',
  '57000000-0000-4000-8000-000000000013'
);
\set bw6_unknown_manifest_state :SQLSTATE
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_unknown_placeholder', 'Unknown Placeholder Contract',
  :'bw6_pending_source_id',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB,
  'Student: {{unknown_field}}',

  '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send synthetic pack"}]'::JSONB,
  'Unknown placeholder must fail',
  '57000000-0000-4000-8000-000000000014'
);
\set bw6_unknown_placeholder_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.review_workflow_source(
  :'bw6_org_a', :'bw6_pending_source_id', 'reviewed',
  'Review synthetic BW6 contract source',
  '57000000-0000-4000-8000-000000000015'
);

SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_synthetic_service', 'Synthetic Service Contract',
  :'bw6_pending_source_id',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true},{"field_key":"service_package","source_path":"handoff.approved_commercial_fields.service_package","value_type":"text","required":true},{"field_key":"fee_currency","source_path":"handoff.approved_commercial_fields.fee_currency","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}
Package: {{service_package}}
Currency: {{fee_currency}}',
  '[{"item_key":"welcome_pack","label":"Send synthetic welcome pack","owner_role":"curator","next_action":"Send the synthetic non-provider welcome pack"},{"item_key":"document_review","label":"Review synthetic document plan","owner_role":"curator","next_action":"Review the synthetic document plan"}]'::JSONB,
  'Create reviewed synthetic contract template',
  '57000000-0000-4000-8000-000000000016'
)::TEXT AS bw6_template_create \gset
SELECT (:'bw6_template_create'::JSONB ->> 'contract_template_version_id')::UUID
  AS bw6_template_id \gset
SELECT platform.approve_contract_template_version(
  :'bw6_org_a', :'bw6_template_id',
  'Approve synthetic contract template',
  '57000000-0000-4000-8000-000000000017'
)::TEXT AS bw6_template_approve \gset
SELECT platform.approve_contract_template_version(
  :'bw6_org_a', :'bw6_template_id',
  'Approve synthetic contract template',
  '57000000-0000-4000-8000-000000000017'
)::TEXT AS bw6_template_approve_replay \gset

-- A second approved version for the same case proves that checklist/report
-- snapshots remain pinned instead of being aggregated case-wide.
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_synthetic_service_alt', 'Synthetic Service Contract v2',
  :'bw6_pending_source_id',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true},{"field_key":"service_package","source_path":"handoff.approved_commercial_fields.service_package","value_type":"text","required":true},{"field_key":"fee_currency","source_path":"handoff.approved_commercial_fields.fee_currency","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}
Package: {{service_package}}
Currency: {{fee_currency}}',
  '[{"item_key":"second_follow_up","label":"Second-version follow-up","owner_role":"curator","next_action":"Complete the second-version follow-up"}]'::JSONB,
  'Create a second reviewed template version for isolation proof',
  '57000000-0000-4000-8000-000000000401'
)::TEXT AS bw6_second_template_create \gset
SELECT (
  :'bw6_second_template_create'::JSONB ->> 'contract_template_version_id'
)::UUID AS bw6_second_template_id \gset
SELECT platform.approve_contract_template_version(
  :'bw6_org_a', :'bw6_second_template_id',
  'Approve the second template version for isolation proof',
  '57000000-0000-4000-8000-000000000402'
)::TEXT AS bw6_second_template_approve \gset

-- Authenticated callers have SELECT-only RLS access. Template lifecycle is
-- Admin-only and valid direct table writes are still denied.
\set ON_ERROR_STOP off
INSERT INTO platform.contract_template_versions (
  organization_id, template_key, title, version, source_registry_id,
  source_revision, field_manifest, template_text, template_sha256,
  post_contract_checklist_blueprint, blueprint_sha256,
  created_by_membership_id
) VALUES (
  :'bw6_org_a', 'contract_direct_denied', 'Direct Denied', 1,
  :'bw6_pending_source_id', 'bw6_synthetic_v1',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}', repeat('0', 64),

  '[{"item_key":"welcome_pack","label":"Send pack","owner_role":"curator","next_action":"Send pack"}]'::JSONB,
  repeat('0', 64), :'bw6_admin_a_membership'
);
\set bw6_direct_template_insert_state :SQLSTATE
UPDATE platform.contract_template_versions
SET title = 'Direct mutation denied'
WHERE id = :'bw6_template_id';
\set bw6_direct_template_update_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw6_sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_contract_template_version(
  :'bw6_org_a', 'contract_sales_denied', 'Sales Denied Contract',
  :'bw6_pending_source_id',
  '[{"field_key":"student_name","source_path":"student_case.student_display_name","value_type":"text","required":true}]'::JSONB,
  'Student: {{student_name}}',
  '[{"item_key":"welcome_pack","label":"Send pack","owner_role":"curator","next_action":"Send pack"}]'::JSONB,
  'Sales cannot create templates',
  '57000000-0000-4000-8000-000000000018'
);
\set bw6_sales_template_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw6_unreviewed_source_state' = '22023'
  AND :'bw6_unknown_source_state' = '22023'

  AND :'bw6_unknown_manifest_state' = '22023'
  AND :'bw6_unknown_placeholder_state' = '22023'
  AND :'bw6_direct_template_insert_state' = '42501'
  AND :'bw6_direct_template_update_state' = '42501'
  AND :'bw6_sales_template_state' = '42501'
  AND :'bw6_template_approve' = :'bw6_template_approve_replay'
  AND (
    SELECT count(*) = 1
    FROM platform.contract_template_versions
    WHERE id = :'bw6_template_id'
      AND status = 'approved'
  ),
  'Template source, manifest, placeholder, ACL, lifecycle or replay drifted'
);

-- Responsible Sales owns the pending contract path.
SET request.jwt.claims TO :'bw6_sales_a_claims';
SET ROLE authenticated;
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_template_id',
  'Generate pending Sales synthetic contract draft',
  '57000000-0000-4000-8000-000000000101'
)::TEXT AS bw6_sales_draft \gset
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_template_id',
  'Generate pending Sales synthetic contract draft',
  '57000000-0000-4000-8000-000000000101'
)::TEXT AS bw6_sales_draft_replay \gset
SELECT (:'bw6_sales_draft'::JSONB ->> 'student_case_contract_draft_id')::UUID
  AS bw6_sales_draft_id \gset
SELECT platform.review_student_case_contract_draft(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_sales_draft_id', 'approved',
  'Approve pending Sales synthetic contract draft',
  '57000000-0000-4000-8000-000000000102'
)::TEXT AS bw6_sales_draft_review \gset

\set ON_ERROR_STOP off
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',

  'Sales cannot generate after handoff',
  '57000000-0000-4000-8000-000000000103'
);
\set bw6_sales_active_state :SQLSTATE
SELECT platform.seed_post_contract_items(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_template_id',
  'Sales cannot seed post-contract items',
  '57000000-0000-4000-8000-000000000104'
);
\set bw6_sales_post_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Assigned Curator owns the active contract path.
SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Generate assigned Curator synthetic contract draft',
  '57000000-0000-4000-8000-000000000111'
)::TEXT AS bw6_curator_draft \gset
SELECT (:'bw6_curator_draft'::JSONB ->> 'student_case_contract_draft_id')::UUID
  AS bw6_curator_draft_id \gset
SELECT platform.review_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_curator_draft_id', 'approved',
  'Approve assigned Curator synthetic contract draft',
  '57000000-0000-4000-8000-000000000112'
)::TEXT AS bw6_curator_draft_review \gset
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_second_template_id',
  'Generate the second-template draft for report isolation',
  '57000000-0000-4000-8000-000000000405'
)::TEXT AS bw6_second_template_draft \gset
SELECT (
  :'bw6_second_template_draft'::JSONB ->> 'student_case_contract_draft_id'
)::UUID AS bw6_second_template_draft_id \gset
SELECT platform.review_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_second_template_draft_id', 'approved',
  'Approve the second-template draft for report isolation',
  '57000000-0000-4000-8000-000000000406'
)::TEXT AS bw6_second_template_draft_review \gset
\set ON_ERROR_STOP off
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_template_id',
  'Unassigned Curator cannot generate pending contract',
  '57000000-0000-4000-8000-000000000113'
);
\set bw6_unassigned_curator_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;


-- Admin may generate/review on either state, while Finance, Student and a
-- cross-organization Admin fail closed.
SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Generate Admin synthetic contract draft',
  '57000000-0000-4000-8000-000000000121'
)::TEXT AS bw6_admin_draft \gset
SELECT (:'bw6_admin_draft'::JSONB ->> 'student_case_contract_draft_id')::UUID
  AS bw6_admin_draft_id \gset
SELECT platform.review_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_admin_draft_id', 'rejected',
  'Reject Admin synthetic contract draft without editing payload',
  '57000000-0000-4000-8000-000000000122'
)::TEXT AS bw6_admin_draft_review \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_finance_a_claims';

SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Finance contract generation must fail',
  '57000000-0000-4000-8000-000000000123'
);
\set bw6_finance_contract_state :SQLSTATE
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
);
\set bw6_finance_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw6_student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Student contract generation must fail',
  '57000000-0000-4000-8000-000000000124'
);
\set bw6_student_contract_state :SQLSTATE
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
);
\set bw6_student_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw6_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_student_case_contract_draft(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Cross-organization contract generation must fail',
  '57000000-0000-4000-8000-000000000125'
);
\set bw6_cross_org_contract_state :SQLSTATE
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
);
\set bw6_cross_org_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- RLS object scope: each owner sees only its own state-valid case; Finance,
-- Student and cross-org actors see no BW6 rows directly.
SET request.jwt.claims TO :'bw6_sales_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw6_sales_pending_draft_count
FROM platform.student_case_contract_drafts
WHERE student_case_id = :'bw6_pending_case' \gset
SELECT count(*) AS bw6_sales_active_draft_count

FROM platform.student_case_contract_drafts
WHERE student_case_id = :'bw6_active_case' \gset
SELECT count(*) AS bw6_sales_template_count
FROM platform.contract_template_versions
WHERE id = :'bw6_template_id' \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw6_curator_active_draft_count
FROM platform.student_case_contract_drafts
WHERE student_case_id = :'bw6_active_case' \gset
SELECT count(*) AS bw6_curator_pending_draft_count
FROM platform.student_case_contract_drafts

WHERE student_case_id = :'bw6_pending_case' \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_finance_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw6_finance_draft_count
FROM platform.student_case_contract_drafts \gset
SELECT count(*) AS bw6_finance_template_count
FROM platform.contract_template_versions \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_student_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw6_student_draft_count
FROM platform.student_case_contract_drafts \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_admin_b_claims';
SET ROLE authenticated;
SELECT count(*) AS bw6_cross_org_draft_count
FROM platform.student_case_contract_drafts
WHERE organization_id = :'bw6_org_a' \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw6_sales_draft' = :'bw6_sales_draft_replay'
  AND :'bw6_sales_active_state' = '42501'
  AND :'bw6_sales_post_state' = '42501'
  AND :'bw6_unassigned_curator_state' = '42501'
  AND :'bw6_finance_contract_state' = '42501'
  AND :'bw6_student_contract_state' = '42501'
  AND :'bw6_cross_org_contract_state' = '42501'
  AND :'bw6_finance_workspace_state' = '42501'
  AND :'bw6_student_workspace_state' = '42501'
  AND :'bw6_cross_org_workspace_state' = '42501'
  AND :'bw6_sales_pending_draft_count' = '1'
  AND :'bw6_sales_active_draft_count' = '0'
  AND :'bw6_sales_template_count' = '1'
  AND :'bw6_curator_active_draft_count' = '3'
  AND :'bw6_curator_pending_draft_count' = '0'
  AND :'bw6_finance_draft_count' = '0'
  AND :'bw6_finance_template_count' = '0'
  AND :'bw6_student_draft_count' = '0'
  AND :'bw6_cross_org_draft_count' = '0'
  AND (
    SELECT rendered_text =
      'Student: BW6 Synthetic Pending Student
Package: synthetic_standard
Currency: USD'
      AND input_snapshot -> 'values' = jsonb_build_object(
        'student_name', 'BW6 Synthetic Pending Student',
        'service_package', 'synthetic_standard',
        'fee_currency', 'USD'
      )
    FROM platform.student_case_contract_drafts
    WHERE id = :'bw6_sales_draft_id'
  )
  AND (
    SELECT status = 'rejected'
      AND input_sha256 =
        (:'bw6_admin_draft'::JSONB ->> 'input_sha256')
      AND rendered_sha256 =
        (:'bw6_admin_draft'::JSONB ->> 'rendered_sha256')
    FROM platform.student_case_contract_drafts
    WHERE id = :'bw6_admin_draft_id'
  )
  AND (
    SELECT status = 'approved'
      AND contract_template_version_id = :'bw6_second_template_id'
    FROM platform.student_case_contract_drafts
    WHERE id = :'bw6_second_template_draft_id'
  ),

  'Contract role/state/RLS/server-render/review contract drifted'
);


-- Reports cannot be generated before checklist seeding.
SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Report without seeded items must fail',
  '57000000-0000-4000-8000-000000000201'
);
\set bw6_unseeded_report_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.seed_post_contract_items(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Seed synthetic post-contract checklist',
  '57000000-0000-4000-8000-000000000202'
)::TEXT AS bw6_seed_result \gset
SELECT platform.seed_post_contract_items(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Seed synthetic post-contract checklist',
  '57000000-0000-4000-8000-000000000202'
)::TEXT AS bw6_seed_replay \gset
SELECT platform.seed_post_contract_items(
  :'bw6_org_a', :'bw6_active_case', :'bw6_second_template_id',
  'Seed the isolated second-version checklist',
  '57000000-0000-4000-8000-000000000403'
)::TEXT AS bw6_second_seed_result \gset
RESET ROLE;

SELECT id AS bw6_welcome_item_id, revision AS bw6_welcome_revision
FROM platform.post_contract_items
WHERE organization_id = :'bw6_org_a'
  AND student_case_id = :'bw6_active_case'
  AND item_key = 'welcome_pack' \gset
SELECT id AS bw6_document_item_id, revision AS bw6_document_revision
FROM platform.post_contract_items
WHERE organization_id = :'bw6_org_a'
  AND student_case_id = :'bw6_active_case'
  AND item_key = 'document_review' \gset
SELECT id AS bw6_second_item_id
FROM platform.post_contract_items
WHERE organization_id = :'bw6_org_a'
  AND student_case_id = :'bw6_active_case'
  AND contract_template_version_id = :'bw6_second_template_id'
  AND item_key = 'second_follow_up' \gset

SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.update_post_contract_item(
  :'bw6_org_a', :'bw6_active_case', :'bw6_welcome_item_id',
  :'bw6_welcome_revision', 'delivered', :'bw6_curator_a_membership',
  NULL, NULL,
  'Delivered without evidence must fail',
  '57000000-0000-4000-8000-000000000203'
);
\set bw6_delivered_without_evidence_state :SQLSTATE
SELECT platform.update_post_contract_item(
  :'bw6_org_a', :'bw6_active_case', :'bw6_document_item_id',
  :'bw6_document_revision', 'blocked', :'bw6_curator_a_membership',
  NULL, NULL,
  'Blocked without next action must fail',
  '57000000-0000-4000-8000-000000000204'
);
\set bw6_blocked_without_next_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.update_post_contract_item(
  :'bw6_org_a', :'bw6_active_case', :'bw6_welcome_item_id',
  :'bw6_welcome_revision', 'delivered', :'bw6_curator_a_membership',
  NULL, 'synthetic:evidence:welcome-pack',
  'Record synthetic delivered evidence',
  '57000000-0000-4000-8000-000000000205'
)::TEXT AS bw6_delivered_update \gset
SELECT platform.update_post_contract_item(
  :'bw6_org_a', :'bw6_active_case', :'bw6_document_item_id',
  :'bw6_document_revision', 'blocked', :'bw6_curator_a_membership',
  'Request synthetic missing input', NULL,
  'Record synthetic blocked next action',
  '57000000-0000-4000-8000-000000000206'
)::TEXT AS bw6_blocked_update \gset

\set ON_ERROR_STOP off
SELECT platform.update_post_contract_item(
  :'bw6_org_a', :'bw6_active_case', :'bw6_welcome_item_id',
  :'bw6_welcome_revision', 'delivered', :'bw6_curator_a_membership',
  NULL, 'synthetic:evidence:welcome-pack',
  'Stale revision must fail',

  '57000000-0000-4000-8000-000000000207'
);
\set bw6_stale_item_state :SQLSTATE
UPDATE platform.post_contract_items
SET next_action = 'Direct mutation denied'
WHERE id = :'bw6_document_item_id';
\set bw6_direct_item_update_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Generate validated synthetic post-contract report',
  '57000000-0000-4000-8000-000000000208'
)::TEXT AS bw6_report_result \gset
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Generate validated synthetic post-contract report',
  '57000000-0000-4000-8000-000000000208'
)::TEXT AS bw6_report_replay \gset
SELECT (:'bw6_report_result'::JSONB ->> 'post_contract_report_id')::UUID
  AS bw6_report_id \gset
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_second_template_id',
  'Generate the isolated second-version report',
  '57000000-0000-4000-8000-000000000404'
)::TEXT AS bw6_second_report_result \gset
SELECT (
  :'bw6_second_report_result'::JSONB ->> 'post_contract_report_id'
)::UUID AS bw6_second_report_id \gset
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_second_template_id',
  'Generate validated synthetic post-contract report',
  '57000000-0000-4000-8000-000000000208'
);
\set bw6_report_template_replay_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT report.contract_template_version_id = :'bw6_template_id'
      AND report.version = 1
      AND report.total_item_count = 2
      AND report.delivered_item_count = 1
      AND report.blocked_item_count = 1
      AND jsonb_array_length(report.item_snapshot) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(report.item_snapshot) AS snapshot(item)
        WHERE snapshot.item ->> 'id' = :'bw6_second_item_id'
      )
    FROM platform.post_contract_reports AS report
    WHERE report.id = :'bw6_report_id'
  )
  AND (
    SELECT report.contract_template_version_id = :'bw6_second_template_id'
      AND report.version = 1
      AND report.total_item_count = 1
      AND report.open_item_count = 1
      AND jsonb_array_length(report.item_snapshot) = 1
      AND report.item_snapshot -> 0 ->> 'id' = :'bw6_second_item_id'
    FROM platform.post_contract_reports AS report
    WHERE report.id = :'bw6_second_report_id'
  ),
  'Post-contract reports mixed checklist template versions'
);

-- Admin may review the Curator-generated report.
SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
SELECT platform.review_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_report_id', 'approved',
  'Approve synthetic post-contract report',
  '57000000-0000-4000-8000-000000000209'
)::TEXT AS bw6_report_review \gset
RESET ROLE;

-- Post-contract authority remains Admin or the assigned Curator only.
SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_pending_case', :'bw6_template_id',
  'Unassigned Curator post-contract report must fail',
  '57000000-0000-4000-8000-000000000210'
);
\set bw6_unassigned_curator_post_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT count(*) AS bw6_curator_item_read_count
FROM platform.post_contract_items
WHERE student_case_id = :'bw6_active_case' \gset
SELECT count(*) AS bw6_curator_report_read_count
FROM platform.post_contract_reports
WHERE student_case_id = :'bw6_active_case' \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Finance post-contract report must fail',
  '57000000-0000-4000-8000-000000000211'
);
\set bw6_finance_post_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT count(*) AS bw6_finance_item_read_count


FROM platform.post_contract_items \gset
SELECT count(*) AS bw6_finance_report_read_count
FROM platform.post_contract_reports \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Student post-contract report must fail',
  '57000000-0000-4000-8000-000000000212'
);
\set bw6_student_post_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT count(*) AS bw6_student_item_read_count
FROM platform.post_contract_items \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.generate_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_template_id',
  'Cross-organization post-contract report must fail',
  '57000000-0000-4000-8000-000000000213'
);
\set bw6_cross_org_post_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT count(*) AS bw6_cross_org_item_read_count
FROM platform.post_contract_items
WHERE organization_id = :'bw6_org_a' \gset
RESET ROLE;

-- Workspace shape and capability booleans are the repository/UI contract.
SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
)::TEXT AS bw6_admin_workspace \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
)::TEXT AS bw6_curator_workspace \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_sales_a_claims';
SET ROLE authenticated;
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_pending_case'
)::TEXT AS bw6_sales_workspace \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw6_unseeded_report_state' = '55000'
  AND :'bw6_seed_result' = :'bw6_seed_replay'
  AND (:'bw6_seed_result'::JSONB ->> 'seeded_item_count')::INTEGER = 2
  AND (:'bw6_seed_result'::JSONB ->> 'total_item_count')::INTEGER = 2
  AND :'bw6_delivered_without_evidence_state' = '22023'
  AND :'bw6_blocked_without_next_state' = '22023'
  AND :'bw6_stale_item_state' = '40001'
  AND :'bw6_direct_item_update_state' = '42501'
  AND :'bw6_report_result' = :'bw6_report_replay'
  AND :'bw6_report_template_replay_mismatch_state' = '22023'
  AND (:'bw6_report_result'::JSONB ->> 'contract_template_version_id')::UUID =
    :'bw6_template_id'
  AND (:'bw6_report_result'::JSONB ->> 'total_item_count')::INTEGER = 2
  AND (:'bw6_report_result'::JSONB ->> 'delivered_item_count')::INTEGER = 1
  AND (:'bw6_report_result'::JSONB ->> 'blocked_item_count')::INTEGER = 1
  AND (:'bw6_report_result'::JSONB ->> 'open_item_count')::INTEGER = 0

  AND (:'bw6_report_result'::JSONB ->> 'in_progress_item_count')::INTEGER = 0
  AND (:'bw6_second_report_result'::JSONB ->> 'contract_template_version_id')::UUID =
    :'bw6_second_template_id'
  AND (:'bw6_second_report_result'::JSONB ->> 'total_item_count')::INTEGER = 1
  AND (:'bw6_second_report_result'::JSONB ->> 'open_item_count')::INTEGER = 1
  AND :'bw6_unassigned_curator_post_state' = '42501'
  AND :'bw6_finance_post_state' = '42501'
  AND :'bw6_student_post_state' = '42501'
  AND :'bw6_cross_org_post_state' = '42501'
  AND :'bw6_curator_item_read_count' = '3'
  AND :'bw6_curator_report_read_count' = '2'
  AND :'bw6_finance_item_read_count' = '0'
  AND :'bw6_finance_report_read_count' = '0'
  AND :'bw6_student_item_read_count' = '0'

  AND :'bw6_cross_org_item_read_count' = '0'
  AND (
    SELECT status = 'approved'
      AND jsonb_array_length(item_snapshot) = 2
      AND report_sha256 =
        (:'bw6_report_result'::JSONB ->> 'report_sha256')
    FROM platform.post_contract_reports
    WHERE id = :'bw6_report_id'
  ),
  'Post-contract validation, replay, role, RLS or report proof drifted'
);

SELECT pg_temp.assert_true(
  (:'bw6_admin_workspace'::JSONB ->> 'organization_id')::UUID = :'bw6_org_a'
  AND (:'bw6_admin_workspace'::JSONB ->> 'student_case_id')::UUID =
    :'bw6_active_case'
  AND :'bw6_admin_workspace'::JSONB ->> 'actor_role' = 'admin'
  AND (:'bw6_admin_workspace'::JSONB ->> 'can_manage_templates')::BOOLEAN
  AND (:'bw6_admin_workspace'::JSONB ->> 'can_generate_contract')::BOOLEAN
  AND (:'bw6_admin_workspace'::JSONB ->> 'can_review_contract')::BOOLEAN
  AND (:'bw6_admin_workspace'::JSONB ->> 'can_manage_post_contract')::BOOLEAN
  AND (:'bw6_admin_workspace'::JSONB ->> 'can_review_report')::BOOLEAN
  AND jsonb_array_length(
    :'bw6_admin_workspace'::JSONB -> 'reviewed_sources'
  ) >= 1
  AND jsonb_array_length(:'bw6_admin_workspace'::JSONB -> 'templates') = 2
  AND jsonb_array_length(:'bw6_admin_workspace'::JSONB -> 'drafts') = 3
  AND jsonb_array_length(:'bw6_admin_workspace'::JSONB -> 'items') = 3
  AND jsonb_array_length(:'bw6_admin_workspace'::JSONB -> 'reports') = 2
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      :'bw6_admin_workspace'::JSONB -> 'reports'
    ) AS report(value)
    WHERE report.value ->> 'contract_template_version_id' IS NULL
  )
  AND :'bw6_curator_workspace'::JSONB ->> 'actor_role' = 'curator'
  AND NOT (
    :'bw6_curator_workspace'::JSONB ->> 'can_manage_templates'
  )::BOOLEAN
  AND (:'bw6_curator_workspace'::JSONB ->> 'can_generate_contract')::BOOLEAN
  AND (:'bw6_curator_workspace'::JSONB ->> 'can_manage_post_contract')::BOOLEAN
  AND jsonb_array_length(:'bw6_curator_workspace'::JSONB -> 'templates') = 2
  AND jsonb_array_length(
    :'bw6_curator_workspace'::JSONB -> 'reviewed_sources'
  ) = 0
  AND :'bw6_sales_workspace'::JSONB ->> 'actor_role' = 'sales'
  AND NOT (:'bw6_sales_workspace'::JSONB ->> 'can_manage_templates')::BOOLEAN
  AND (:'bw6_sales_workspace'::JSONB ->> 'can_generate_contract')::BOOLEAN
  AND NOT (:'bw6_sales_workspace'::JSONB ->> 'can_manage_post_contract')::BOOLEAN
  AND jsonb_array_length(:'bw6_sales_workspace'::JSONB -> 'drafts') = 1
  AND jsonb_array_length(:'bw6_sales_workspace'::JSONB -> 'items') = 0
  AND jsonb_array_length(:'bw6_sales_workspace'::JSONB -> 'reports') = 0,
  'BW6 workspace JSON shape or capability booleans drifted'
);

-- Immutable template/draft/report payloads and the item identity/label fields
-- remain guarded even for the owning database role. Approval never edits an
-- artifact payload.
\set ON_ERROR_STOP off
UPDATE platform.contract_template_versions
SET template_text = template_text || ' direct mutation'
WHERE id = :'bw6_template_id';
\set bw6_template_immutable_state :SQLSTATE
UPDATE platform.student_case_contract_drafts
SET rendered_text = rendered_text || ' direct mutation'
WHERE id = :'bw6_curator_draft_id';

\set bw6_draft_immutable_state :SQLSTATE
UPDATE platform.post_contract_items
SET label = 'Direct immutable label mutation'
WHERE id = :'bw6_document_item_id';
\set bw6_item_identity_immutable_state :SQLSTATE
UPDATE platform.post_contract_reports
SET item_snapshot = '[]'::JSONB
WHERE id = :'bw6_report_id';
\set bw6_report_immutable_state :SQLSTATE
UPDATE platform.post_contract_reports
SET contract_template_version_id = :'bw6_second_template_id'
WHERE id = :'bw6_report_id';
\set bw6_report_template_immutable_state :SQLSTATE
DELETE FROM platform.post_contract_reports WHERE id = :'bw6_report_id';
\set bw6_report_delete_state :SQLSTATE
\set ON_ERROR_STOP on

SET request.jwt.claims TO :'bw6_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.review_post_contract_report(
  :'bw6_org_a', :'bw6_active_case', :'bw6_report_id', 'rejected',
  'Approved report cannot be reviewed again',
  '57000000-0000-4000-8000-000000000214'
);

\set bw6_second_report_review_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.retire_contract_template_version(
  :'bw6_org_a', :'bw6_template_id',
  'Retire synthetic template after historical artifact proof',
  '57000000-0000-4000-8000-000000000301'
)::TEXT AS bw6_template_retire \gset
RESET ROLE;

SET request.jwt.claims TO :'bw6_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_case_contract_workspace(
  :'bw6_org_a', :'bw6_active_case'
)::TEXT AS bw6_curator_workspace_after_retire \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw6_template_immutable_state' = '55000'
  AND :'bw6_draft_immutable_state' = '55000'
  AND :'bw6_item_identity_immutable_state' = '55000'
  AND :'bw6_report_immutable_state' = '55000'
  AND :'bw6_report_template_immutable_state' = '55000'
  AND :'bw6_report_delete_state' = '55000'
  AND :'bw6_second_report_review_state' = '55000'
  AND (:'bw6_template_retire'::JSONB ->> 'status') = 'retired'
  AND EXISTS (
    SELECT 1
    FROM platform.student_case_contract_drafts
    WHERE id = :'bw6_curator_draft_id'
      AND status = 'approved'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.post_contract_reports
    WHERE id = :'bw6_report_id'
      AND status = 'approved'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      :'bw6_curator_workspace_after_retire'::JSONB -> 'templates'
    ) AS template(value)
    WHERE (template.value ->> 'id')::UUID = :'bw6_template_id'
      AND template.value ->> 'status' = 'retired'
  ),
  'BW6 immutable payload, review transition, retirement or history drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*)
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '57000000-0000-4000-8000-000000000016',
      '57000000-0000-4000-8000-000000000017',
      '57000000-0000-4000-8000-000000000101',
      '57000000-0000-4000-8000-000000000102',
      '57000000-0000-4000-8000-000000000111',
      '57000000-0000-4000-8000-000000000112',
      '57000000-0000-4000-8000-000000000121',
      '57000000-0000-4000-8000-000000000122',
      '57000000-0000-4000-8000-000000000202',
      '57000000-0000-4000-8000-000000000205',
      '57000000-0000-4000-8000-000000000206',

      '57000000-0000-4000-8000-000000000208',
      '57000000-0000-4000-8000-000000000209',
      '57000000-0000-4000-8000-000000000301',
      '57000000-0000-4000-8000-000000000401',
      '57000000-0000-4000-8000-000000000402',
      '57000000-0000-4000-8000-000000000403',
      '57000000-0000-4000-8000-000000000404',
      '57000000-0000-4000-8000-000000000405',
      '57000000-0000-4000-8000-000000000406'
    )
  ) = 20
  AND (
    SELECT count(*)
    FROM platform.student_case_contract_drafts
    WHERE organization_id = :'bw6_org_a'
      AND student_case_id = :'bw6_pending_case'
  ) = 1
  AND (
    SELECT count(*)
    FROM platform.post_contract_items
    WHERE organization_id = :'bw6_org_a'
      AND student_case_id = :'bw6_active_case'
  ) = 3
  AND (
    SELECT count(*)
    FROM platform.post_contract_reports
    WHERE organization_id = :'bw6_org_a'
      AND student_case_id = :'bw6_active_case'
  ) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM platform.student_case_contract_drafts AS draft
    WHERE draft.input_snapshot::TEXT ILIKE '%raw_provider%'
      OR draft.rendered_text ILIKE '%raw_provider%'
  )
  AND (SELECT count(*) FROM public.contacts) = :'bw6_legacy_contacts_before',
  'BW6 audit, replay, provider-free or legacy-plane boundary drifted'
);


ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform contract draft/report RLS passed' AS result;
