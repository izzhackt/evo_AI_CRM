\set ON_ERROR_STOP on

-- Disposable BW8A row-authority proof. All identities and values are
-- synthetic. The fixture reuses the BW3 case graph created at migration 053,
-- adds one clean current document version as postgres, and exercises BW8A
-- mutations only through the reviewed service/user RPC surfaces.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW8A RLS assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.bw8_sensitive_row_count(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    (SELECT count(*)
     FROM platform.document_extraction_runs
     WHERE organization_id = p_organization_id
       AND student_case_id = p_student_case_id)
    + (SELECT count(*)
       FROM platform.document_extracted_facts
       WHERE organization_id = p_organization_id
         AND student_case_id = p_student_case_id)
    + (SELECT count(*)
       FROM platform.student_profile_field_values
       WHERE organization_id = p_organization_id
         AND student_case_id = p_student_case_id)
    + (SELECT count(*)
       FROM platform.student_profile_field_decisions
       WHERE organization_id = p_organization_id
         AND student_case_id = p_student_case_id)
    + (SELECT count(*)
       FROM platform.student_profile_exports
       WHERE organization_id = p_organization_id
         AND student_case_id = p_student_case_id)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.bw8_sensitive_row_count(UUID, UUID)
  TO anon, authenticated;

\set bw8_org_a '51000000-0000-4000-8000-000000000001'
\set bw8_org_b '51100000-0000-4000-8000-000000000001'
\set bw8_admin_user '51000000-0000-4000-8000-000000000101'
\set bw8_sales_user '51000000-0000-4000-8000-000000000102'
\set bw8_curator_user '51000000-0000-4000-8000-000000000103'
\set bw8_finance_user '51000000-0000-4000-8000-000000000104'
\set bw8_student_user '51000000-0000-4000-8000-000000000105'
\set bw8_admin_b_user '51100000-0000-4000-8000-000000000101'
\set bw8_unassigned_curator_user '59000000-0000-4000-8000-000000000101'
\set bw8_requirement_id '59000000-0000-4000-8000-000000000201'
\set bw8_slot_id '59000000-0000-4000-8000-000000000202'
\set bw8_document_version_id '59000000-0000-4000-8000-000000000203'

SELECT student_case.id::TEXT AS bw8_case_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw8_org_a'
  AND student_case.source_key = 'bw3-synthetic-case-001'
\gset

SELECT membership.id::TEXT AS bw8_admin_membership_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw8_org_a'
  AND profile.auth_user_id = :'bw8_admin_user'
\gset

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_admin_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_admin_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_sales_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_sales_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_curator_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_curator_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_stale_curator_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_curator_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_finance_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_finance_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_student_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_student_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_admin_b_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_admin_b_user'
  AND membership.organization_id = :'bw8_org_b'
\gset
SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw8_service_claims
\gset

-- Create one same-organization Curator without a case scope. This identity is
-- later blocked and restored to prove both gates independently.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'bw8_unassigned_curator_user',
  'bw8-unassigned-curator@example.invalid',
  '{}'
);

SET request.jwt.claims TO :'bw8_admin_claims';
SET ROLE authenticated;
SELECT platform.provision_member(
  :'bw8_org_a',
  :'bw8_unassigned_curator_user',
  'BW8A Synthetic Unassigned Curator',
  'curator',
  'create unassigned Curator for BW8A fail-closed proof',
  '59000000-0000-4000-8000-000000000301'
)::TEXT AS bw8_unassigned_curator_result
\gset
RESET ROLE;

SELECT
  (:'bw8_unassigned_curator_result'::JSONB ->> 'membership_id')
    AS bw8_unassigned_curator_membership_id
\gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_unassigned_curator_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_unassigned_curator_user'
  AND membership.organization_id = :'bw8_org_a'
\gset

-- Build one private, clean, current synthetic document source without using a
-- production provider or storage object. All subsequent intelligence writes
-- must pass through service-only RPCs.
INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
) VALUES (
  :'bw8_requirement_id', :'bw8_org_a', 'Synthetic Country',
  'Synthetic Degree', 'synthetic_program', 9001,
  'bw8.rls.synthetic_passport', 'BW8A synthetic passport',
  'Disposable RLS fixture only', 'active', :'bw8_admin_membership_id'
);
INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
) VALUES (
  :'bw8_slot_id', :'bw8_org_a', :'bw8_case_id', :'bw8_requirement_id',
  'required', :'bw8_admin_membership_id'
);
INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id, integrity_status,
  malware_status, validation_updated_at
) VALUES (
  :'bw8_document_version_id', :'bw8_org_a', :'bw8_case_id', :'bw8_slot_id', 1,
  'bw8a-synthetic-passport.pdf', 'application/pdf', 1024, repeat('a', 64),
  'synthetic://bw8a/rls/document-version', :'bw8_admin_membership_id',
  'verified', 'clean', statement_timestamp()
);
UPDATE platform.document_slots
SET status = 'submitted',
    current_version_id = :'bw8_document_version_id',
    current_version_no = 1
WHERE organization_id = :'bw8_org_a'
  AND id = :'bw8_slot_id';

-- Even the table owner cannot forge the short-lived recompute capability.
-- Without a matching transaction-bound private context, the slot trigger must
-- reject direct applicability mutation before any state changes.
\set ON_ERROR_STOP off
UPDATE platform.document_slots
SET applicability_status = 'pending_information',
    applicability_reference_date = DATE '2026-08-05'
WHERE organization_id = :'bw8_org_a'
  AND id = :'bw8_slot_id';
\set bw8_owner_direct_applicability_state :SQLSTATE
\set ON_ERROR_STOP on

-- service_role is not a table writer. It can create and transition extraction
-- evidence only through the exact reviewed service RPCs.
SET request.jwt.claims TO :'bw8_service_claims';
SET ROLE service_role;
\set ON_ERROR_STOP off
INSERT INTO platform.document_extraction_runs DEFAULT VALUES;
\set bw8_service_direct_write_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.create_document_extraction_run(
  :'bw8_org_a', :'bw8_document_version_id', 'synthetic_ocr',
  'bw8a-test-model-v1', 'bw8a-test-policy-v1', 1,
  '59000000-0000-4000-8000-000000000302'
)::TEXT AS bw8_extraction_run_result
\gset
SELECT (:'bw8_extraction_run_result'::JSONB ->> 'extraction_run_id')
  AS bw8_extraction_run_id
\gset
SELECT platform.transition_document_extraction_run(
  :'bw8_org_a', :'bw8_extraction_run_id', 'queued', 'processing',
  NULL, NULL, '59000000-0000-4000-8000-000000000303'
);
SELECT platform.append_document_extracted_fact(
  :'bw8_org_a', :'bw8_extraction_run_id', 'personal.first_name', 'name',
  to_jsonb('Meerim'::TEXT), to_jsonb('Meerim'::TEXT), 0.9900,
  jsonb_build_object('kind', 'page', 'page', 1, 'anchor', 'given_name'),
  'proposed', '59000000-0000-4000-8000-000000000304'
)::TEXT AS bw8_first_fact_result
\gset
SELECT platform.append_document_extracted_fact(
  :'bw8_org_a', :'bw8_extraction_run_id', 'personal.student_email', 'email',
  to_jsonb('meerim@example.invalid'::TEXT),
  to_jsonb('meerim@example.invalid'::TEXT), 0.9700,
  jsonb_build_object('kind', 'page', 'page', 1, 'anchor', 'email'),
  'proposed', '59000000-0000-4000-8000-000000000305'
)::TEXT AS bw8_second_fact_result
\gset
SELECT (:'bw8_first_fact_result'::JSONB ->> 'extracted_fact_id')
  AS bw8_first_fact_id,
  (:'bw8_second_fact_result'::JSONB ->> 'extracted_fact_id')
  AS bw8_second_fact_id
\gset
SELECT platform.transition_document_extraction_run(
  :'bw8_org_a', :'bw8_extraction_run_id', 'processing', 'succeeded',
  NULL, NULL, '59000000-0000-4000-8000-000000000306'
);
RESET ROLE;

SELECT revision::TEXT AS bw8_profile_revision_before
FROM platform.student_profiles
WHERE organization_id = :'bw8_org_a'
  AND student_case_id = :'bw8_case_id'
\gset

-- Even an Admin has no direct table-write capability; their exact human RPC
-- succeeds and advances both field and global profile revisions.
SET request.jwt.claims TO :'bw8_admin_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
INSERT INTO platform.student_profile_field_values DEFAULT VALUES;
\set bw8_authenticated_direct_write_state :SQLSTATE
UPDATE platform.document_slots
SET applicability_status = 'pending_information',
    applicability_reference_date = DATE '2026-08-05'
WHERE organization_id = :'bw8_org_a'
  AND id = :'bw8_slot_id';
\set bw8_authenticated_direct_applicability_state :SQLSTATE
\set ON_ERROR_STOP on
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_profile_revision_before'::BIGINT,
  'study.desired_university', 'text',
  to_jsonb('BW8A Synthetic University'::TEXT),
  'Admin records one reviewed manual field value',
  '59000000-0000-4000-8000-000000000307'
)::TEXT AS bw8_admin_manual_result
\gset
RESET ROLE;
SELECT (:'bw8_admin_manual_result'::JSONB ->> 'profile_revision')
  AS bw8_revision_after_admin
\gset

-- The existing BW3 Curator is freshly claimed and assigned to this exact case.
-- Confirmation mutates the typed profile; rejection records an append-only
-- decision without changing the profile revision.
SET request.jwt.claims TO :'bw8_curator_claims';
SET ROLE authenticated;
SELECT platform.confirm_student_profile_extracted_fact(
  :'bw8_org_a', :'bw8_case_id', :'bw8_first_fact_id',
  :'bw8_revision_after_admin'::BIGINT,
  'Assigned Curator confirms typed first-name evidence',
  '59000000-0000-4000-8000-000000000308'
)::TEXT AS bw8_curator_confirm_result
\gset
SELECT (:'bw8_curator_confirm_result'::JSONB ->> 'profile_revision')
  AS bw8_revision_after_confirm
\gset
SELECT platform.reject_student_profile_extracted_fact(
  :'bw8_org_a', :'bw8_case_id', :'bw8_second_fact_id',
  :'bw8_revision_after_confirm'::BIGINT,
  'Assigned Curator rejects synthetic email candidate',
  '59000000-0000-4000-8000-000000000309'
)::TEXT AS bw8_curator_reject_result
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw8_admin_claims';
SET ROLE authenticated;
SELECT platform.request_student_profile_export(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'evo.student_profile', 'v1', repeat('b', 64), 'docx', repeat('c', 64),
  'Admin requests exact-revision synthetic profile export',
  '59000000-0000-4000-8000-000000000310'
)::TEXT AS bw8_export_result
\gset

SELECT count(*)::TEXT AS bw8_admin_catalog_count
FROM platform.student_profile_field_catalog
\gset
SELECT
  (SELECT count(*) FROM platform.document_extraction_runs
   WHERE organization_id = :'bw8_org_a'
     AND student_case_id = :'bw8_case_id')::TEXT AS bw8_admin_run_count,
  (SELECT count(*) FROM platform.document_extracted_facts
   WHERE organization_id = :'bw8_org_a'
     AND student_case_id = :'bw8_case_id')::TEXT AS bw8_admin_fact_count,
  (SELECT count(*) FROM platform.student_profile_field_values
   WHERE organization_id = :'bw8_org_a'
     AND student_case_id = :'bw8_case_id')::TEXT AS bw8_admin_value_count,
  (SELECT count(*) FROM platform.student_profile_field_decisions
   WHERE organization_id = :'bw8_org_a'
     AND student_case_id = :'bw8_case_id')::TEXT AS bw8_admin_decision_count,
  (SELECT count(*) FROM platform.student_profile_exports
   WHERE organization_id = :'bw8_org_a'
     AND student_case_id = :'bw8_case_id')::TEXT AS bw8_admin_export_count
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw8_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_curator_sensitive_count
\gset
RESET ROLE;

-- Non-BW8 staff, the Student, cross-tenant Admin, stale Curator claim and
-- unassigned Curator all receive an empty sensitive projection and cannot call
-- a human profile mutation RPC.
SET request.jwt.claims TO :'bw8_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_sales_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden Sales edit'::TEXT),
  'Sales must not edit expanded profile fields',
  '59000000-0000-4000-8000-000000000311'
);
\set bw8_sales_rpc_state :SQLSTATE
SELECT platform.recompute_student_document_applicability(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  DATE '2026-08-05', NULL, NULL,
  'Sales must not recompute document applicability',
  '59000000-0000-4000-8000-000000000321'
);
\set bw8_sales_recompute_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8_finance_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_finance_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden Finance edit'::TEXT),
  'Finance must not edit expanded profile fields',
  '59000000-0000-4000-8000-000000000312'
);
\set bw8_finance_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8_student_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_student_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden Student edit'::TEXT),
  'Student must not edit staff-only expanded profile fields',
  '59000000-0000-4000-8000-000000000313'
);
\set bw8_student_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8_admin_b_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_cross_org_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden cross-org edit'::TEXT),
  'Cross-organization Admin must not edit another tenant',
  '59000000-0000-4000-8000-000000000314'
);
\set bw8_cross_org_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Make this claim stale without mutating the real Curator: the JWT carries an
-- older access version than the database. The current fresh claim above keeps
-- working, proving access-version freshness is the deciding gate.
SELECT jsonb_set(
  :'bw8_stale_curator_claims'::JSONB,
  '{platform_access_version}',
  to_jsonb((:'bw8_stale_curator_claims'::JSONB
    ->> 'platform_access_version')::BIGINT - 1)
)::TEXT AS bw8_stale_curator_claims
\gset
SET request.jwt.claims TO :'bw8_stale_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_stale_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden stale edit'::TEXT),
  'Stale Curator claim must fail closed',
  '59000000-0000-4000-8000-000000000315'
);
\set bw8_stale_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw8_unassigned_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_unassigned_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden unassigned edit'::TEXT),
  'Unassigned Curator must fail closed',
  '59000000-0000-4000-8000-000000000316'
);
\set bw8_unassigned_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Block the unassigned membership, refresh its claim, prove the independent
-- lifecycle gate, then restore it before assertions/the next SQL suite.
SET request.jwt.claims TO :'bw8_admin_claims';
SET ROLE authenticated;
SELECT platform.change_membership_status(
  :'bw8_org_a', :'bw8_unassigned_curator_membership_id', 'blocked',
  'temporarily block synthetic Curator for BW8A RLS proof',
  '59000000-0000-4000-8000-000000000317'
);
RESET ROLE;
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', membership."current_role",
  'platform_access_version', profile.access_version
)::TEXT AS bw8_blocked_curator_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'bw8_unassigned_curator_user'
  AND membership.organization_id = :'bw8_org_a'
\gset
SET request.jwt.claims TO :'bw8_blocked_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.bw8_sensitive_row_count(
  :'bw8_org_a', :'bw8_case_id'
)::TEXT AS bw8_blocked_sensitive_count
\gset
\set ON_ERROR_STOP off
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden blocked edit'::TEXT),
  'Blocked Curator membership must fail closed',
  '59000000-0000-4000-8000-000000000318'
);
\set bw8_blocked_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;
SET request.jwt.claims TO :'bw8_admin_claims';
SET ROLE authenticated;
SELECT platform.change_membership_status(
  :'bw8_org_a', :'bw8_unassigned_curator_membership_id', 'active',
  'restore synthetic Curator after BW8A blocked-membership proof',
  '59000000-0000-4000-8000-000000000319'
);
RESET ROLE;

SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT pg_temp.bw8_sensitive_row_count(:'bw8_org_a', :'bw8_case_id');
\set bw8_anon_read_state :SQLSTATE
SELECT platform.manual_edit_student_profile_field(
  :'bw8_org_a', :'bw8_case_id', :'bw8_revision_after_confirm'::BIGINT,
  'study.field_major', 'text', to_jsonb('Forbidden anonymous edit'::TEXT),
  'Anonymous principal must fail closed',
  '59000000-0000-4000-8000-000000000320'
);
\set bw8_anon_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw8_service_direct_write_state' = '42501',
  'service_role must not write BW8A tables directly'
);
SELECT pg_temp.assert_true(
  :'bw8_authenticated_direct_write_state' = '42501',
  'authenticated Admin must not write BW8A tables directly'
);
SELECT pg_temp.assert_true(
  :'bw8_owner_direct_applicability_state' = '55000'
    AND :'bw8_authenticated_direct_applicability_state' = '42501',
  'slot applicability must reject owner forgery and direct authenticated writes'
);
SELECT pg_temp.assert_true(
  :'bw8_admin_catalog_count' = '62',
  'authenticated catalog must expose exactly the reviewed 62 field keys'
);
SELECT pg_temp.assert_true(
  :'bw8_admin_run_count' = '1'
    AND :'bw8_admin_fact_count' = '2'
    AND :'bw8_admin_value_count' = '2'
    AND :'bw8_admin_decision_count' = '3'
    AND :'bw8_admin_export_count' = '1',
  'same-organization Admin must read all synthetic BW8A evidence rows'
);
SELECT pg_temp.assert_true(
  :'bw8_curator_sensitive_count' = '9',
  'freshly claimed assigned Curator must read the exact same-case evidence'
);
SELECT pg_temp.assert_true(
  :'bw8_sales_sensitive_count' = '0'
    AND :'bw8_finance_sensitive_count' = '0'
    AND :'bw8_student_sensitive_count' = '0'
    AND :'bw8_cross_org_sensitive_count' = '0'
    AND :'bw8_stale_sensitive_count' = '0'
    AND :'bw8_unassigned_sensitive_count' = '0'
    AND :'bw8_blocked_sensitive_count' = '0',
  'non-authorized, cross-tenant, stale, unassigned and blocked reads must be empty'
);
SELECT pg_temp.assert_true(
  :'bw8_sales_rpc_state' = '42501'
    AND :'bw8_sales_recompute_state' = '42501'
    AND :'bw8_finance_rpc_state' = '42501'
    AND :'bw8_student_rpc_state' = '42501'
    AND :'bw8_cross_org_rpc_state' = '42501'
    AND :'bw8_stale_rpc_state' = '42501'
    AND :'bw8_unassigned_rpc_state' = '42501'
    AND :'bw8_blocked_rpc_state' = '42501',
  'all unauthorized authenticated human RPC calls must fail with insufficient privilege'
);
SELECT pg_temp.assert_true(
  :'bw8_anon_read_state' = '42501'
    AND :'bw8_anon_rpc_state' = '42501',
  'anonymous read and RPC access must be absent'
);
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform.organization_memberships
    WHERE organization_id = :'bw8_org_a'
      AND id = :'bw8_unassigned_curator_membership_id'
      AND status = 'active'
  ),
  'blocked-membership fixture must be restored before the next suite'
);

RESET request.jwt.claims;
SELECT 'BW8A student-document intelligence RLS tests passed.' AS result;
