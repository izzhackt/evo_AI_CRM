\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- BW5 stateful authorization and lifecycle proof. Every row is synthetic and
-- the outer transaction is rolled back. No provider is called and no source
-- content, customer data or production catalog record is present.
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
    RAISE EXCEPTION 'BW5 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

SELECT
  membership.organization_id AS bw5_org_a,
  membership.id AS bw5_admin_a_membership,
  profile.auth_user_id AS bw5_admin_a_user,
  profile.access_version AS bw5_admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS bw5_org_b,
  profile.auth_user_id AS bw5_admin_b_user,
  profile.access_version AS bw5_admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS bw5_case_a,
  student_case.responsible_sales_membership_id AS bw5_sales_a_membership,
  student_case.current_curator_membership_id AS bw5_curator_a_membership
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw5_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  student_case.id AS bw5_case_b,
  student_case.student_membership_id AS bw5_student_b_membership,
  student_case.responsible_sales_membership_id AS bw5_sales_b_membership,
  student_case.current_curator_membership_id AS bw5_curator_b_membership
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw5_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  profile.auth_user_id AS bw5_sales_a_user,
  profile.access_version AS bw5_sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership.id = :'bw5_sales_a_membership'
\gset

SELECT
  profile.auth_user_id AS bw5_curator_a_user,
  profile.access_version AS bw5_curator_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership.id = :'bw5_curator_a_membership'
\gset

SELECT
  profile.auth_user_id AS bw5_finance_a_user,
  profile.access_version AS bw5_finance_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership."current_role" = 'finance'
  AND membership.status = 'active'
ORDER BY membership.created_at, membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS bw5_student_a_user,
  profile.access_version AS bw5_student_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership."current_role" = 'student'
  AND membership.status = 'active'
ORDER BY membership.created_at, membership.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', :'bw5_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'bw5_admin_a_access_version'::BIGINT
)::TEXT AS bw5_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'bw5_admin_b_access_version'::BIGINT
)::TEXT AS bw5_admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', (:'bw5_admin_a_access_version'::BIGINT - 1)
)::TEXT AS bw5_stale_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'bw5_sales_a_access_version'::BIGINT
)::TEXT AS bw5_sales_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_curator_a_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'bw5_curator_a_access_version'::BIGINT
)::TEXT AS bw5_curator_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_finance_a_user',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'bw5_finance_a_access_version'::BIGINT
)::TEXT AS bw5_finance_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_student_a_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'bw5_student_a_access_version'::BIGINT
)::TEXT AS bw5_student_a_claims
\gset

-- Register only synthetic provenance through the real BW1 source RPCs. The
-- URLs are format fixtures; PostgreSQL never dereferences them.
SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw5_org_a',
  'src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1BW5CatalogSheetFixture000000001/edit',
  'bw5revision20260803',
  'Register synthetic BW5 reviewed Sheet source',
  '56000000-0000-4000-8000-000000000001'
)::TEXT AS bw5_source_id
\gset
SELECT platform.review_workflow_source(
  :'bw5_org_a', :'bw5_source_id', 'reviewed',
  'Review synthetic BW5 Sheet source',
  '56000000-0000-4000-8000-000000000002'
);

SELECT platform.register_workflow_source(
  :'bw5_org_a',
  'src_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1BW5CatalogSheetFixture000000002/edit',
  NULL,
  'Register synthetic BW5 source without revision',
  '56000000-0000-4000-8000-000000000003'
)::TEXT AS bw5_no_revision_source_id
\gset
SELECT platform.review_workflow_source(
  :'bw5_org_a', :'bw5_no_revision_source_id', 'reviewed',
  'Review synthetic BW5 source without revision',
  '56000000-0000-4000-8000-000000000004'
);

SELECT platform.register_workflow_source(
  :'bw5_org_a',
  'src_cccccccccccccccccccccccccccccccc',
  'google_spreadsheet',
  'https://docs.google.com/spreadsheets/d/1BW5CatalogSheetFixture000000003/edit',
  'bw5revisionpending1',
  'Register synthetic BW5 pending source',
  '56000000-0000-4000-8000-000000000005'
)::TEXT AS bw5_pending_source_id
\gset

SELECT platform.register_workflow_source(
  :'bw5_org_a',
  'src_dddddddddddddddddddddddddddddddd',
  'google_document',
  'https://docs.google.com/document/d/1BW5CatalogDocFixture00000000001/edit',
  'bw5revisiondocument1',
  'Register synthetic BW5 non-catalog source kind',
  '56000000-0000-4000-8000-000000000006'
)::TEXT AS bw5_document_source_id
\gset
SELECT platform.review_workflow_source(
  :'bw5_org_a', :'bw5_document_source_id', 'reviewed',
  'Review synthetic non-catalog source kind',
  '56000000-0000-4000-8000-000000000007'
);
RESET ROLE;

-- Only the catalog source-kind allowlist is listed, and batch creation fails
-- closed for pending, unversioned, non-catalog and cross-tenant sources.
SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.admin_catalog_sources()
    WHERE source_registry_id IN (
      :'bw5_source_id', :'bw5_no_revision_source_id', :'bw5_pending_source_id'
    )) = 3
  AND NOT EXISTS (
    SELECT 1 FROM platform.admin_catalog_sources()
    WHERE source_registry_id = :'bw5_document_source_id'
  ),
  'Admin catalog source allowlist drifted'
);

\set ON_ERROR_STOP off
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_no_revision_source_id', 'university',
  'Unversioned source must fail',
  '56000000-0000-4000-8000-000000000011'
);
\set bw5_no_revision_state :SQLSTATE
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_pending_source_id', 'university',
  'Pending source must fail',
  '56000000-0000-4000-8000-000000000012'
);
\set bw5_pending_source_state :SQLSTATE
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_document_source_id', 'university',
  'Non-catalog source kind must fail',
  '56000000-0000-4000-8000-000000000013'
);
\set bw5_document_source_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'university',
  'Cross organization import must fail',
  '56000000-0000-4000-8000-000000000014'
);
\set bw5_cross_org_create_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_no_revision_state' = '22023'
  AND :'bw5_pending_source_state' = '22023'
  AND :'bw5_document_source_state' = '22023'
  AND :'bw5_cross_org_create_state' = '42501',
  'Source provenance or tenant creation denial drifted'
);

-- Direct browser writes are denied even to Admin. Sales cannot call the
-- Admin import API, and stale JWT authority is rejected before replay/state.
SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
INSERT INTO platform.catalog_import_batches (
  organization_id, source_registry_id, source_revision,
  institution_kind, created_by_membership_id
) VALUES (
  :'bw5_org_a', :'bw5_source_id', 'bw5revision20260803',
  'university', :'bw5_admin_a_membership'
);
\set bw5_direct_insert_state :SQLSTATE
UPDATE platform.catalog_import_batches SET status = 'approved'
WHERE organization_id = :'bw5_org_a';
\set bw5_direct_update_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'university',
  'Sales import mutation must fail',
  '56000000-0000-4000-8000-000000000015'
);
\set bw5_sales_import_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_stale_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT * FROM platform.admin_catalog_import_batches();
\set bw5_stale_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_direct_insert_state' = '42501'
  AND :'bw5_direct_update_state' = '42501'
  AND :'bw5_sales_import_state' = '42501'
  AND :'bw5_stale_read_state' = '42501',
  'Direct DML, role or stale-authority denial drifted'
);

-- Happy path: staging and validation are intentionally non-publishing.
SELECT count(*) AS bw5_catalog_count_before
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
\gset
SELECT count(*) AS bw5_application_count_before
FROM platform.university_applications
WHERE organization_id = :'bw5_org_a'
\gset

SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'university',
  'Create synthetic approved-path catalog batch',
  '56000000-0000-4000-8000-000000000101'
)::TEXT AS bw5_happy_batch_result
\gset
SELECT (:'bw5_happy_batch_result'::JSONB ->> 'catalog_import_batch_id')::UUID
  AS bw5_happy_batch_id
\gset
SELECT pg_temp.assert_true(
  platform.create_catalog_import_batch(
    :'bw5_org_a', :'bw5_source_id', 'university',
    'Create synthetic approved-path catalog batch',
    '56000000-0000-4000-8000-000000000101'
  ) = :'bw5_happy_batch_result'::JSONB,
  'Exact batch creation replay changed result'
);
\set ON_ERROR_STOP off
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'college',
  'Create synthetic approved-path catalog batch',
  '56000000-0000-4000-8000-000000000101'
);
\set bw5_changed_create_replay_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_happy_batch_id',
  'rec_11111111111111111111111111111111',
  'Synthetic North University', 'KG', 'Bishkek',
  'Stage first synthetic catalog candidate',
  '56000000-0000-4000-8000-000000000102'
)::TEXT AS bw5_candidate_one_result
\gset
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_happy_batch_id',
  'rec_22222222222222222222222222222222',
  'Synthetic East University', 'KZ', 'Almaty',
  'Stage second synthetic catalog candidate',
  '56000000-0000-4000-8000-000000000103'
)::TEXT AS bw5_candidate_two_result
\gset

\set ON_ERROR_STOP off
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_happy_batch_id',
  NULL,
  'Synthetic Missing-Key University', 'KG', NULL,
  'Null source record key must fail at the typed boundary',
  '56000000-0000-4000-8000-000000000109'
);
\set bw5_null_source_record_key_state :SQLSTATE
\set ON_ERROR_STOP on

-- A crafted authenticated RPC call cannot skip validation and publish a
-- staging batch. This complements the direct-table write denial above.
\set ON_ERROR_STOP off
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_happy_batch_id', 'approve',
  'Staging batch approval must fail before validation',
  '56000000-0000-4000-8000-000000000110'
);
\set bw5_staging_approval_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.validate_catalog_import_batch(
  :'bw5_org_a', :'bw5_happy_batch_id',
  'Validate synthetic approved-path batch',
  '56000000-0000-4000-8000-000000000104'
)::TEXT AS bw5_happy_validation_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_null_source_record_key_state' = '22023'
  AND :'bw5_staging_approval_state' = '55000'
  AND (:'bw5_happy_validation_result'::JSONB ->> 'status') = 'validated'
  AND (:'bw5_happy_validation_result'::JSONB ->> 'candidate_count')::BIGINT = 2
  AND (:'bw5_happy_validation_result'::JSONB ->> 'valid_candidate_count')::BIGINT = 2
  AND (:'bw5_happy_validation_result'::JSONB ->> 'invalid_candidate_count')::BIGINT = 0
  AND (SELECT count(*) FROM platform.catalog_institutions
       WHERE organization_id = :'bw5_org_a') = :'bw5_catalog_count_before'::BIGINT
  AND (SELECT count(*) FROM platform.university_applications
       WHERE organization_id = :'bw5_org_a') = :'bw5_application_count_before'::BIGINT,
  'Validation published catalog/application state before explicit approval'
);

SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_happy_batch_id',
  'rec_33333333333333333333333333333333',
  'Late Candidate', 'KG', NULL,
  'Validated batch staging must fail',
  '56000000-0000-4000-8000-000000000105'
);
\set bw5_late_stage_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_happy_batch_id', 'approve',
  'Explicitly approve synthetic catalog batch',
  '56000000-0000-4000-8000-000000000106'
)::TEXT AS bw5_happy_approval_result
\gset
SELECT pg_temp.assert_true(
  platform.review_catalog_import_batch(
    :'bw5_org_a', :'bw5_happy_batch_id', 'approve',
    'Explicitly approve synthetic catalog batch',
    '56000000-0000-4000-8000-000000000106'
  ) = :'bw5_happy_approval_result'::JSONB,
  'Exact approval replay changed result'
);
\set ON_ERROR_STOP off
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_happy_batch_id', 'reject',
  'Explicitly approve synthetic catalog batch',
  '56000000-0000-4000-8000-000000000106'
);
\set bw5_changed_review_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_changed_create_replay_state' = '22023'
  AND :'bw5_late_stage_state' = '55000'
  AND :'bw5_changed_review_replay_state' = '22023'
  AND (:'bw5_happy_approval_result'::JSONB ->> 'status') = 'approved'
  AND (:'bw5_happy_approval_result'::JSONB ->> 'promoted_candidate_count')::BIGINT = 2
  AND (SELECT count(*) FROM platform.catalog_institutions
       WHERE organization_id = :'bw5_org_a'
         AND import_batch_id = :'bw5_happy_batch_id') = 2
  AND (SELECT count(*) FROM platform.catalog_import_candidates
       WHERE organization_id = :'bw5_org_a'
         AND catalog_import_batch_id = :'bw5_happy_batch_id'
         AND catalog_institution_id IS NOT NULL) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM platform.catalog_institutions AS institution
    WHERE institution.organization_id = :'bw5_org_a'
      AND institution.import_batch_id = :'bw5_happy_batch_id'
      AND institution.source_revision <> 'bw5revision20260803'
  ),
  'Explicit approval, promotion or pinned source revision drifted'
);

-- Approved rows are readable by Admin/Sales/Curator only. Import workspaces
-- remain Admin organization-scoped. Finance, Student and another organization
-- receive no row and cannot execute the hardened read RPCs.
SET request.jwt.claims TO :'bw5_sales_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw5_sales_direct_catalog_rows
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
  AND import_batch_id = :'bw5_happy_batch_id'
\gset
SELECT count(*) AS bw5_sales_rpc_catalog_rows
FROM platform.staff_catalog_institutions()
WHERE import_batch_id = :'bw5_happy_batch_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw5_curator_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw5_curator_direct_catalog_rows
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
  AND import_batch_id = :'bw5_happy_batch_id'
\gset
SELECT count(*) AS bw5_curator_rpc_catalog_rows
FROM platform.staff_catalog_institutions()
WHERE import_batch_id = :'bw5_happy_batch_id'
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw5_finance_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw5_finance_direct_catalog_rows
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_catalog_institutions();
\set bw5_finance_catalog_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_student_a_claims';
SET ROLE authenticated;
SELECT count(*) AS bw5_student_direct_catalog_rows
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
\gset
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_catalog_institutions();
\set bw5_student_catalog_rpc_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_admin_b_claims';
SET ROLE authenticated;
SELECT count(*) AS bw5_admin_b_catalog_rows
FROM platform.catalog_institutions
WHERE organization_id = :'bw5_org_a'
\gset
SELECT count(*) AS bw5_admin_b_batch_rows
FROM platform.catalog_import_batches
WHERE organization_id = :'bw5_org_a'
\gset
SELECT count(*) AS bw5_admin_b_candidate_rpc_rows
FROM platform.admin_catalog_import_candidates(:'bw5_happy_batch_id')
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_sales_direct_catalog_rows'::BIGINT = 2
  AND :'bw5_sales_rpc_catalog_rows'::BIGINT = 2
  AND :'bw5_curator_direct_catalog_rows'::BIGINT = 2
  AND :'bw5_curator_rpc_catalog_rows'::BIGINT = 2
  AND :'bw5_finance_direct_catalog_rows'::BIGINT = 0
  AND :'bw5_student_direct_catalog_rows'::BIGINT = 0
  AND :'bw5_finance_catalog_rpc_state' = '42501'
  AND :'bw5_student_catalog_rpc_state' = '42501'
  AND :'bw5_admin_b_catalog_rows'::BIGINT = 0
  AND :'bw5_admin_b_batch_rows'::BIGINT = 0
  AND :'bw5_admin_b_candidate_rpc_rows'::BIGINT = 0,
  'Catalog read role matrix or two-organization isolation drifted'
);

SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM platform.admin_catalog_import_batches()
    WHERE catalog_import_batch_id = :'bw5_happy_batch_id'
      AND candidate_count = 2
      AND valid_candidate_count = 2
      AND invalid_candidate_count = 0
  )
  AND (SELECT count(*) FROM platform.admin_catalog_import_candidates(
    :'bw5_happy_batch_id'
  )) = 2,
  'Admin fixed-shape batch/candidate read RPC drifted'
);

-- Deterministic invalidation covers every allowlisted validation error. An
-- invalid validated batch cannot be approved and produces no catalog rows.
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'university',
  'Create synthetic invalid catalog batch',
  '56000000-0000-4000-8000-000000000201'
)::TEXT AS bw5_invalid_batch_result
\gset
SELECT (:'bw5_invalid_batch_result'::JSONB ->> 'catalog_import_batch_id')::UUID
  AS bw5_invalid_batch_id
\gset

SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'rec_11111111111111111111111111111111',
  'Different Name Same Source Record', 'UZ', NULL,
  'Stage already approved source record',
  '56000000-0000-4000-8000-000000000202'
);
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'rec_44444444444444444444444444444444',
  'Synthetic North University', 'KG', 'Bishkek',
  'Stage already approved institution',
  '56000000-0000-4000-8000-000000000203'
);
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'rec_55555555555555555555555555555555',
  '', 'kg', NULL,
  'Stage invalid required candidate fields',
  '56000000-0000-4000-8000-000000000204'
);
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'rec_66666666666666666666666666666666',
  'Duplicate University', 'KG', NULL,
  'Stage first duplicate candidate',
  '56000000-0000-4000-8000-000000000205'
);
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'rec_77777777777777777777777777777777',
  'duplicate   university', 'KG', NULL,
  'Stage normalized duplicate candidate',
  '56000000-0000-4000-8000-000000000206'
);
SELECT platform.validate_catalog_import_batch(
  :'bw5_org_a', :'bw5_invalid_batch_id',
  'Validate synthetic invalid catalog batch',
  '56000000-0000-4000-8000-000000000207'
)::TEXT AS bw5_invalid_validation_result
\gset

\set ON_ERROR_STOP off
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_invalid_batch_id', 'approve',
  'Invalid catalog batch approval must fail',
  '56000000-0000-4000-8000-000000000208'
);
\set bw5_invalid_approval_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_invalid_approval_state' = '22023'
  AND (:'bw5_invalid_validation_result'::JSONB ->> 'invalid_candidate_count')::BIGINT = 5
  AND EXISTS (
    SELECT 1 FROM platform.catalog_import_candidates
    WHERE organization_id = :'bw5_org_a'
      AND catalog_import_batch_id = :'bw5_invalid_batch_id'
      AND validation_errors @> ARRAY['institution_name_invalid']::TEXT[]
      AND validation_errors @> ARRAY['country_code_invalid']::TEXT[]
  )
  AND EXISTS (
    SELECT 1 FROM platform.catalog_import_candidates
    WHERE organization_id = :'bw5_org_a'
      AND catalog_import_batch_id = :'bw5_invalid_batch_id'
      AND validation_errors @> ARRAY['source_record_already_approved']::TEXT[]
  )
  AND EXISTS (
    SELECT 1 FROM platform.catalog_import_candidates
    WHERE organization_id = :'bw5_org_a'
      AND catalog_import_batch_id = :'bw5_invalid_batch_id'
      AND validation_errors @> ARRAY['institution_already_approved']::TEXT[]
  )
  AND (SELECT count(*) FROM platform.catalog_import_candidates
       WHERE organization_id = :'bw5_org_a'
         AND catalog_import_batch_id = :'bw5_invalid_batch_id'
         AND validation_errors @> ARRAY['duplicate_in_batch']::TEXT[]) = 2
  AND NOT EXISTS (
    SELECT 1 FROM platform.catalog_institutions
    WHERE organization_id = :'bw5_org_a'
      AND import_batch_id = :'bw5_invalid_batch_id'
  ),
  'Deterministic validation or invalid-approval boundary drifted'
);

-- A valid batch may be rejected after validation without promotion. Replay is
-- exact, while reusing the request for a different decision is rejected.
SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_source_id', 'college',
  'Create synthetic rejection-path catalog batch',
  '56000000-0000-4000-8000-000000000301'
)::TEXT AS bw5_reject_batch_result
\gset
SELECT (:'bw5_reject_batch_result'::JSONB ->> 'catalog_import_batch_id')::UUID
  AS bw5_reject_batch_id
\gset
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_reject_batch_id',
  'rec_88888888888888888888888888888888',
  'Synthetic Rejected College', 'KG', 'Osh',
  'Stage synthetic rejection candidate',
  '56000000-0000-4000-8000-000000000302'
);
SELECT platform.validate_catalog_import_batch(
  :'bw5_org_a', :'bw5_reject_batch_id',
  'Validate synthetic rejection batch',
  '56000000-0000-4000-8000-000000000303'
);
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_reject_batch_id', 'reject',
  'Explicitly reject synthetic catalog batch',
  '56000000-0000-4000-8000-000000000304'
)::TEXT AS bw5_rejection_result
\gset
SELECT pg_temp.assert_true(
  platform.review_catalog_import_batch(
    :'bw5_org_a', :'bw5_reject_batch_id', 'reject',
    'Explicitly reject synthetic catalog batch',
    '56000000-0000-4000-8000-000000000304'
  ) = :'bw5_rejection_result'::JSONB,
  'Exact rejection replay changed result'
);
\set ON_ERROR_STOP off
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_reject_batch_id', 'approve',
  'Explicitly reject synthetic catalog batch',
  '56000000-0000-4000-8000-000000000304'
);
\set bw5_changed_rejection_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'bw5_rejection_result'::JSONB ->> 'status') = 'rejected'
  AND (:'bw5_rejection_result'::JSONB ->> 'promoted_candidate_count')::BIGINT = 0
  AND :'bw5_changed_rejection_replay_state' = '22023'
  AND NOT EXISTS (
    SELECT 1 FROM platform.catalog_institutions
    WHERE organization_id = :'bw5_org_a'
      AND import_batch_id = :'bw5_reject_batch_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.catalog_import_candidates
    WHERE organization_id = :'bw5_org_a'
      AND catalog_import_batch_id = :'bw5_reject_batch_id'
      AND catalog_institution_id IS NOT NULL
  ),
  'Validated rejection promoted catalog state or replay drifted'
);

-- Approval rechecks the source's live reviewed state and exact pinned revision.
SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw5_org_a',
  'src_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'notion_database',
  'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bw5revisionretire1',
  'Register synthetic source retirement probe',
  '56000000-0000-4000-8000-000000000401'
)::TEXT AS bw5_retired_source_id
\gset
SELECT platform.review_workflow_source(
  :'bw5_org_a', :'bw5_retired_source_id', 'reviewed',
  'Review synthetic source retirement probe',
  '56000000-0000-4000-8000-000000000402'
);
SELECT platform.create_catalog_import_batch(
  :'bw5_org_a', :'bw5_retired_source_id', 'university',
  'Create source retirement probe batch',
  '56000000-0000-4000-8000-000000000403'
)::TEXT AS bw5_retired_batch_result
\gset
SELECT (:'bw5_retired_batch_result'::JSONB ->> 'catalog_import_batch_id')::UUID
  AS bw5_retired_batch_id
\gset
SELECT platform.stage_catalog_import_candidate(
  :'bw5_org_a', :'bw5_retired_batch_id',
  'rec_99999999999999999999999999999999',
  'Synthetic Retired Source University', 'TR', NULL,
  'Stage source retirement probe candidate',
  '56000000-0000-4000-8000-000000000404'
);
SELECT platform.validate_catalog_import_batch(
  :'bw5_org_a', :'bw5_retired_batch_id',
  'Validate source retirement probe batch',
  '56000000-0000-4000-8000-000000000405'
);
SELECT platform.retire_workflow_source(
  :'bw5_org_a', :'bw5_retired_source_id',
  'Retire synthetic source before catalog approval',
  '56000000-0000-4000-8000-000000000406'
);
\set ON_ERROR_STOP off
SELECT platform.review_catalog_import_batch(
  :'bw5_org_a', :'bw5_retired_batch_id', 'approve',
  'Retired source approval must fail',
  '56000000-0000-4000-8000-000000000407'
);
\set bw5_retired_source_approval_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_retired_source_approval_state' = '55000'
  AND NOT EXISTS (
    SELECT 1 FROM platform.catalog_institutions
    WHERE organization_id = :'bw5_org_a'
      AND import_batch_id = :'bw5_retired_batch_id'
  ),
  'Approval did not recheck live source review/revision provenance'
);

-- The catalog-backed application copies the approved institution name, keeps
-- the catalog FK, reuses canonical application.create audit semantics, and
-- preserves existing case authorization/idempotency behavior.
SELECT
  institution.id AS bw5_catalog_institution_id,
  institution.institution_name AS bw5_catalog_institution_name
FROM platform.catalog_institutions AS institution
WHERE institution.organization_id = :'bw5_org_a'
  AND institution.import_batch_id = :'bw5_happy_batch_id'
ORDER BY institution.id
LIMIT 1
\gset

-- Create a separate pending case through the canonical service-only ingestion
-- path so assigned Sales can be proved independently from the active Curator
-- case. The outer transaction rolls this synthetic fixture back.
SELECT jsonb_build_object('role', 'service_role')::TEXT AS bw5_service_claims
\gset
SET request.jwt.claims TO :'bw5_service_claims';
SET ROLE service_role;
SELECT platform.create_pending_student_case(
  :'bw5_org_a',
  :'bw5_student_b_membership',
  :'bw5_sales_b_membership',
  'synthetic:amocrm:lead:bw5-sales-scope',
  'synthetic:contract:bw5-sales-scope',
  '2026-08-03T00:00:00Z',
  'Synthetic BW5 Sales Student',
  'Synthetic Country',
  'Synthetic Degree',
  'Synthetic Program Direction',
  '2027-BW5',
  'EN',
  'self-funded',
  'contract_confirmed',
  'Synthetic pending case for Sales authorization proof',
  '56000000-0000-4000-8000-000000000520'
)::TEXT AS bw5_sales_case_result
\gset
RESET ROLE;
SELECT (:'bw5_sales_case_result'::JSONB ->> 'student_case_id')::UUID
  AS bw5_sales_case
\gset

-- Case ingestion rotates the assigned Sales access version. Mint the test JWT
-- from the resulting live authority, and use Case B's Curator as an unassigned
-- same-organization object-scope denial for Case A.
SELECT
  profile.auth_user_id AS bw5_sales_b_user,
  profile.access_version AS bw5_sales_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership.id = :'bw5_sales_b_membership'
\gset
SELECT
  profile.auth_user_id AS bw5_curator_b_user,
  profile.access_version AS bw5_curator_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw5_org_a'
  AND membership.id = :'bw5_curator_b_membership'
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_sales_b_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'bw5_sales_b_access_version'::BIGINT
)::TEXT AS bw5_sales_b_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw5_curator_b_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'bw5_curator_b_access_version'::BIGINT
)::TEXT AS bw5_curator_b_claims
\gset

SET request.jwt.claims TO :'bw5_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Synthetic Data Science', 'preparation', NULL,
  'Synthetic catalog-backed application fixture',
  '56000000-0000-4000-8000-000000000501'
)::TEXT AS bw5_application_result
\gset
SELECT (:'bw5_application_result'::JSONB ->> 'university_application_id')::UUID
  AS bw5_application_id
\gset
SELECT pg_temp.assert_true(
  platform.create_catalog_university_application(
    :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
    'Synthetic Data Science', 'preparation', NULL,
    'Synthetic catalog-backed application fixture',
    '56000000-0000-4000-8000-000000000501'
  ) = :'bw5_application_result'::JSONB,
  'Exact catalog application replay changed result'
);
\set ON_ERROR_STOP off
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Changed Program', 'preparation', NULL,
  'Synthetic catalog-backed application fixture',
  '56000000-0000-4000-8000-000000000501'
);
\set bw5_changed_application_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Cross Organization Program', 'preparation', NULL,
  'Cross organization catalog application must fail',
  '56000000-0000-4000-8000-000000000502'
);
\set bw5_cross_org_application_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_sales_b_claims';
SET ROLE authenticated;
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_sales_case', :'bw5_catalog_institution_id',
  'Synthetic Assigned Sales Program', 'preparation', NULL,
  'Assigned Sales catalog-backed application proof',
  '56000000-0000-4000-8000-000000000521'
)::TEXT AS bw5_sales_application_result
\gset
SELECT (:'bw5_sales_application_result'::JSONB ->> 'university_application_id')::UUID
  AS bw5_sales_application_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw5_curator_a_claims';
SET ROLE authenticated;
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Synthetic Assigned Curator Program', 'preparation', NULL,
  'Assigned Curator catalog-backed application proof',
  '56000000-0000-4000-8000-000000000522'
)::TEXT AS bw5_curator_application_result
\gset
SELECT (:'bw5_curator_application_result'::JSONB ->> 'university_application_id')::UUID
  AS bw5_curator_application_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw5_finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Forbidden Finance Program', 'preparation', NULL,
  'Finance application mutation must fail',
  '56000000-0000-4000-8000-000000000523'
);
\set bw5_finance_application_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Forbidden Student Program', 'preparation', NULL,
  'Student application mutation must fail',
  '56000000-0000-4000-8000-000000000524'
);
\set bw5_student_application_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw5_curator_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_catalog_university_application(
  :'bw5_org_a', :'bw5_case_a', :'bw5_catalog_institution_id',
  'Forbidden Unassigned Curator Program', 'preparation', NULL,
  'Unassigned Curator application mutation must fail',
  '56000000-0000-4000-8000-000000000525'
);
\set bw5_unassigned_curator_application_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw5_changed_application_replay_state' = '22023'
  AND :'bw5_cross_org_application_state' = '42501'
  AND :'bw5_finance_application_state' = '42501'
  AND :'bw5_student_application_state' = '42501'
  AND :'bw5_unassigned_curator_application_state' = '42501'
  AND (:'bw5_sales_application_result'::JSONB ->> 'student_case_id')::UUID =
    :'bw5_sales_case'
  AND (:'bw5_curator_application_result'::JSONB ->> 'student_case_id')::UUID =
    :'bw5_case_a'
  AND EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = :'bw5_org_a'
      AND student_case.id = :'bw5_sales_case'
      AND student_case.state = 'pending'
      AND student_case.responsible_sales_membership_id = :'bw5_sales_b_membership'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.university_applications AS application
    WHERE application.organization_id = :'bw5_org_a'
      AND application.id = :'bw5_application_id'
      AND application.catalog_institution_id = :'bw5_catalog_institution_id'
      AND application.institution_name = :'bw5_catalog_institution_name'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.university_applications AS application
    WHERE application.organization_id = :'bw5_org_a'
      AND application.id = :'bw5_sales_application_id'
      AND application.student_case_id = :'bw5_sales_case'
      AND application.created_by_membership_id = :'bw5_sales_b_membership'
      AND application.catalog_institution_id = :'bw5_catalog_institution_id'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.university_applications AS application
    WHERE application.organization_id = :'bw5_org_a'
      AND application.id = :'bw5_curator_application_id'
      AND application.student_case_id = :'bw5_case_a'
      AND application.created_by_membership_id = :'bw5_curator_a_membership'
      AND application.catalog_institution_id = :'bw5_catalog_institution_id'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = '56000000-0000-4000-8000-000000000501'
      AND audit.action = 'application.create'
      AND audit.resource_type = 'university_application'
      AND audit.resource_id = :'bw5_application_id'
      AND audit.after_state ->> 'catalog_institution_id' =
        :'bw5_catalog_institution_id'
  )
  AND (
    SELECT count(*)
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '56000000-0000-4000-8000-000000000521',
      '56000000-0000-4000-8000-000000000522'
    )
      AND audit.action = 'application.create'
      AND audit.resource_type = 'university_application'
      AND audit.after_state ->> 'catalog_institution_id' =
        :'bw5_catalog_institution_id'
  ) = 2
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id IN (
      '56000000-0000-4000-8000-000000000523',
      '56000000-0000-4000-8000-000000000524',
      '56000000-0000-4000-8000-000000000525'
    )
  ),
  'Catalog-backed application link, copied name, authorization or audit drifted'
);

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform university catalog import boundary RLS passed' AS result;
