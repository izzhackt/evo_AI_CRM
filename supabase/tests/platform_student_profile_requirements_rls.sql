\set ON_ERROR_STOP on

-- Disposable BW3 authorization/versioning proof. Every identity and value is
-- explicitly synthetic; no source content, provider, or production service is
-- contacted.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW3 assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

\set bw3_org_a '51000000-0000-4000-8000-000000000001'
\set bw3_org_b '51100000-0000-4000-8000-000000000001'
\set bw3_admin_user '51000000-0000-4000-8000-000000000101'
\set bw3_sales_user '51000000-0000-4000-8000-000000000102'
\set bw3_curator_user '51000000-0000-4000-8000-000000000103'
\set bw3_finance_user '51000000-0000-4000-8000-000000000104'
\set bw3_student_one_user '51000000-0000-4000-8000-000000000105'
\set bw3_student_two_user '53000000-0000-4000-8000-000000000106'
\set bw3_admin_b_user '51100000-0000-4000-8000-000000000101'
\set bw3_sales_membership '51000000-0000-4000-8000-000000000302'
\set bw3_curator_membership '51000000-0000-4000-8000-000000000303'
\set bw3_student_one_membership '51000000-0000-4000-8000-000000000305'

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_admin_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_admin_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_admin_b_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_admin_b_user' \gset
SELECT jsonb_build_object('role', 'service_role')::TEXT
  AS bw3_service_claims \gset

-- A second synthetic Student proves student-to-student isolation.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  :'bw3_student_two_user',
  'bw3-student-two@example.invalid',
  '{}'
);

SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
SELECT platform.provision_member(
  :'bw3_org_a',
  :'bw3_student_two_user',
  'BW3 Synthetic Student Two',
  'student',
  'provision second synthetic BW3 Student',
  '53000000-0000-4000-8000-000000000601'
)::TEXT AS bw3_student_two_result \gset
RESET ROLE;
SELECT
  (:'bw3_student_two_result'::JSONB ->> 'membership_id')
    AS bw3_student_two_membership,
  (:'bw3_student_two_result'::JSONB ->> 'profile_id')
    AS bw3_student_two_identity_profile_id
\gset

-- Two pending cases share one exact synthetic route. The service-only ingest
-- is existing P2D behavior and creates the case scopes used by Sales/Student.
SET request.jwt.claims TO :'bw3_service_claims';
SET ROLE service_role;
SELECT platform.create_pending_student_case(
  :'bw3_org_a',
  :'bw3_student_one_membership',
  :'bw3_sales_membership',
  'bw3-synthetic-case-001',
  'bw3-synthetic-contract-001',
  '2026-08-02T08:00:00Z'::TIMESTAMPTZ,
  'BW3 Synthetic Student One',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  'synthetic_intake',
  'ru',
  'synthetic_budget',
  'profile_and_route',
  'Complete synthetic Student Profile',
  '53000000-0000-4000-8000-000000000602'
)::TEXT AS bw3_case_one_result \gset
SELECT platform.create_pending_student_case(
  :'bw3_org_a',
  :'bw3_student_two_membership',
  :'bw3_sales_membership',
  'bw3-synthetic-case-002',
  'bw3-synthetic-contract-002',
  '2026-08-02T08:05:00Z'::TIMESTAMPTZ,
  'BW3 Synthetic Student Two',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  'synthetic_intake',
  'ru',
  'synthetic_budget',
  'profile_and_route',
  'Complete second synthetic Student Profile',
  '53000000-0000-4000-8000-000000000603'
)::TEXT AS bw3_case_two_result \gset
RESET ROLE;
SELECT
  (:'bw3_case_one_result'::JSONB ->> 'student_case_id') AS bw3_case_one_id,
  (:'bw3_case_two_result'::JSONB ->> 'student_case_id') AS bw3_case_two_id
\gset

-- Case-scope creation increments access versions; claims always refresh from
-- the database instead of confusing JWT access-version with bundle version.
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_sales_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_sales_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_curator_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_curator_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_finance_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_finance_user' \gset

-- Reuse a reviewed PII-free source from BW1/BW2. No country facts or source
-- content are copied into the database or this fixture.
SELECT source.id::TEXT AS bw3_reviewed_source_id
FROM platform.source_registry AS source
WHERE source.organization_id = :'bw3_org_a'
  AND source.review_status = 'reviewed'
ORDER BY source.created_at, source.id
LIMIT 1 \gset

SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;

-- Approval without reviewed provenance and a matching active requirement is
-- denied while the authoring row remains draft.
SELECT platform.create_country_requirement_version(
  :'bw3_org_a',
  'Synthetic Orphan Country',
  'Synthetic Degree',
  'synthetic_program',
  1,
  ARRAY[]::platform.student_profile_field[],
  'create orphan draft for approval denial',
  '53000000-0000-4000-8000-000000000610'
)::TEXT AS bw3_orphan_version_id \gset
\set ON_ERROR_STOP off
SELECT platform.approve_country_requirement_version(
  :'bw3_org_a',
  :'bw3_orphan_version_id',
  'approval must fail without provenance',
  '53000000-0000-4000-8000-000000000611'
);
\set bw3_orphan_approval_state :SQLSTATE
\set ON_ERROR_STOP on

-- Version one deliberately excludes legal name and birth date.
SELECT platform.create_country_requirement_version(
  :'bw3_org_a',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  1,
  ARRAY[
    'preferred_display_name',
    'communication_language',
    'citizenship_country',
    'academic_summary',
    'language_summary',
    'budget_band',
    'next_step'
  ]::platform.student_profile_field[],
  'create synthetic country requirement version one',
  '53000000-0000-4000-8000-000000000612'
)::TEXT AS bw3_version_one_id \gset

SELECT (
  platform.create_document_requirement(
    :'bw3_org_a',
    'Synthetic Country',
    'Synthetic Degree',
    'synthetic_program',
    1,
    'synthetic.identity',
    'Synthetic identity evidence',
    'Upload only through the existing private document path',
    '53000000-0000-4000-8000-000000000613'
  ) ->> 'document_requirement_id'
) AS bw3_requirement_one_a \gset
SELECT (
  platform.create_document_requirement(
    :'bw3_org_a',
    'Synthetic Country',
    'Synthetic Degree',
    'synthetic_program',
    1,
    'synthetic.education',
    'Synthetic education evidence',
    'Upload only through the existing private document path',
    '53000000-0000-4000-8000-000000000614'
  ) ->> 'document_requirement_id'
) AS bw3_requirement_one_b \gset
SELECT platform.link_country_requirement_version_source(
  :'bw3_org_a',
  :'bw3_version_one_id',
  :'bw3_reviewed_source_id',
  'link reviewed source to synthetic version one',
  '53000000-0000-4000-8000-000000000615'
)::TEXT AS bw3_version_one_source_link_id \gset

RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw3_orphan_approval_state' = '22023'
    AND (
      SELECT status = 'draft'
      FROM platform.country_requirement_versions
      WHERE id = :'bw3_orphan_version_id'
    ),
  'draft approval constraints failed'
);

-- Admin cannot bind a draft. Sales cannot author requirement versions.
SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_version_one_id',
  'draft apply denial',
  '53000000-0000-4000-8000-000000000616'
);
\set bw3_draft_apply_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_sales_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_country_requirement_version(
  :'bw3_org_a', 'Forbidden Sales Country', 'Synthetic Degree',
  'synthetic_program', 1, ARRAY[]::platform.student_profile_field[],
  'Sales cannot author country requirements',
  '53000000-0000-4000-8000-000000000617'
);
\set bw3_sales_author_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
SELECT platform.approve_country_requirement_version(
  :'bw3_org_a',
  :'bw3_version_one_id',
  'approve source-reviewed synthetic version one',
  '53000000-0000-4000-8000-000000000618'
);

SELECT platform.create_country_requirement_version(
  :'bw3_org_a',
  'Different Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  1,
  ARRAY[]::platform.student_profile_field[],
  'create approved route mismatch fixture',
  '53000000-0000-4000-8000-000000000619'
)::TEXT AS bw3_mismatch_version_id \gset
SELECT platform.create_document_requirement(
  :'bw3_org_a',
  'Different Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  1,
  'synthetic.mismatch',
  'Synthetic mismatch evidence',
  'This requirement must never bind to the main synthetic route',
  '53000000-0000-4000-8000-000000000620'
);
SELECT platform.link_country_requirement_version_source(
  :'bw3_org_a', :'bw3_mismatch_version_id', :'bw3_reviewed_source_id',
  'link reviewed source to mismatch version',
  '53000000-0000-4000-8000-000000000621'
);
SELECT platform.approve_country_requirement_version(
  :'bw3_org_a', :'bw3_mismatch_version_id',
  'approve mismatch version for route denial proof',
  '53000000-0000-4000-8000-000000000622'
);
RESET ROLE;

-- Direct RPC calls cannot bypass the Admin-only immutable binding boundary.
SET request.jwt.claims TO :'bw3_sales_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_version_one_id',
  'Sales cannot bind an immutable requirement version',
  '53000000-0000-4000-8000-000000000647'
);
\set bw3_sales_apply_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_curator_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_version_one_id',
  'Curator cannot bind an immutable requirement version',
  '53000000-0000-4000-8000-000000000648'
);
\set bw3_curator_apply_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Matching approved route mismatch fails before binding; Admin then applies
-- the exact approved version and receives idempotent replay.
SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_mismatch_version_id',
  'route mismatch apply denial',
  '53000000-0000-4000-8000-000000000623'
);
\set bw3_mismatch_apply_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_version_one_id',
  'apply synthetic version one',
  '53000000-0000-4000-8000-000000000624'
)::TEXT AS bw3_apply_one_result \gset
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_version_one_id',
  'apply synthetic version one',
  '53000000-0000-4000-8000-000000000624'
)::TEXT AS bw3_apply_one_replay \gset
\set ON_ERROR_STOP off
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_mismatch_version_id',
  'apply synthetic version one',
  '53000000-0000-4000-8000-000000000624'
);
\set bw3_changed_apply_replay_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw3_draft_apply_state' = '22023'
    AND :'bw3_sales_author_state' = '42501'
    AND :'bw3_sales_apply_state' = '42501'
    AND :'bw3_curator_apply_state' = '42501'
    AND :'bw3_mismatch_apply_state' = '22023'
    AND :'bw3_changed_apply_replay_state' = '22023',
  'author, immutable-binding, draft, route-mismatch or changed-replay denial failed'
);
SELECT pg_temp.assert_true(
  :'bw3_apply_one_result'::JSONB = :'bw3_apply_one_replay'::JSONB
    AND (:'bw3_apply_one_result'::JSONB ->> 'document_slot_count')::BIGINT = 2
    AND (
      SELECT count(*) = 2
      FROM platform.document_slots
      WHERE organization_id = :'bw3_org_a'
        AND student_case_id = :'bw3_case_one_id'
    )
    AND (
      SELECT count(*) = 1
      FROM platform.audit_events
      WHERE request_id = '53000000-0000-4000-8000-000000000624'
        AND action = 'country.requirement.apply'
    ),
  'apply replay or one-slot-per-requirement contract failed'
);

-- Version two adds the only two sensitive typed fields. Publishing it does
-- not alter the case already pinned to version one.
SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
SELECT platform.create_country_requirement_version(
  :'bw3_org_a',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  2,
  ARRAY[
    'preferred_display_name',
    'legal_display_name',
    'communication_language',
    'date_of_birth',
    'citizenship_country',
    'academic_summary',
    'language_summary',
    'budget_band',
    'next_step'
  ]::platform.student_profile_field[],
  'create synthetic country requirement version two',
  '53000000-0000-4000-8000-000000000630'
)::TEXT AS bw3_version_two_id \gset
SELECT platform.create_document_requirement(
  :'bw3_org_a',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  2,
  'synthetic.version_two',
  'Synthetic version two evidence',
  'Upload only through the existing private document path',
  '53000000-0000-4000-8000-000000000631'
);
SELECT platform.link_country_requirement_version_source(
  :'bw3_org_a', :'bw3_version_two_id', :'bw3_reviewed_source_id',
  'link reviewed source to synthetic version two',
  '53000000-0000-4000-8000-000000000632'
);
SELECT platform.approve_country_requirement_version(
  :'bw3_org_a', :'bw3_version_two_id',
  'approve source-reviewed synthetic version two',
  '53000000-0000-4000-8000-000000000633'
);
SELECT platform.create_country_requirement_version(
  :'bw3_org_a',
  'Synthetic Country',
  'Synthetic Degree',
  'synthetic_program',
  3,
  ARRAY[]::platform.student_profile_field[],
  'leave synthetic version three in draft for read minimization proof',
  '53000000-0000-4000-8000-000000000649'
)::TEXT AS bw3_version_three_draft_id \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (
    SELECT applied_country_requirement_version_id = :'bw3_version_one_id'
    FROM platform.student_cases
    WHERE id = :'bw3_case_one_id'
  )
  AND (
    SELECT count(*) = 2
    FROM platform.document_slots
    WHERE student_case_id = :'bw3_case_one_id'
  ),
  'new approved v2 silently changed the v1-bound case'
);

SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
SELECT platform.apply_country_requirement_version(
  :'bw3_org_a', :'bw3_case_two_id', :'bw3_version_two_id',
  'apply synthetic version two',
  '53000000-0000-4000-8000-000000000634'
);
RESET ROLE;

SET request.jwt.claims TO :'bw3_sales_claims';
SET ROLE authenticated;

-- Version one must reject sensitive fields that its manifest did not name.
\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 0,
  'Synthetic Preferred One', 'Synthetic Legal One', DATE '2001-01-01',
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_standard',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'sensitive values must be gated',
  '53000000-0000-4000-8000-000000000635'
);
\set bw3_sensitive_gate_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 0,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_standard',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'create minimized synthetic profile one',
  '53000000-0000-4000-8000-000000000636'
)::TEXT AS bw3_profile_one_create \gset
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 0,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_standard',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'create minimized synthetic profile one',
  '53000000-0000-4000-8000-000000000636'
)::TEXT AS bw3_profile_one_replay \gset

\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 0,
  'Changed replay value', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_standard',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'create minimized synthetic profile one',
  '53000000-0000-4000-8000-000000000636'
);
\set bw3_profile_changed_replay_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 1,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_updated',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'revise synthetic budget band',
  '53000000-0000-4000-8000-000000000637'
)::TEXT AS bw3_profile_one_update \gset

\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 1,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_stale',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Complete synthetic checklist',
  'stale revision must fail',
  '53000000-0000-4000-8000-000000000638'
);
\set bw3_stale_revision_state :SQLSTATE
\set ON_ERROR_STOP on

-- The v2-bound second case may store legal name and birth date.
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_two_id', 0,
  'Synthetic Preferred Two', 'Synthetic Legal Two', DATE '2002-02-02',
  'en', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education two', 'Synthetic academic summary two',
  'Synthetic language summary two', 'synthetic_budget_standard',
  ARRAY['self', 'guardian']::TEXT[], 'not_recorded', NULL,
  'Complete second synthetic checklist',
  'create version-two synthetic profile',
  '53000000-0000-4000-8000-000000000639'
)::TEXT AS bw3_profile_two_create \gset

SELECT count(*)::TEXT AS bw3_sales_pending_profile_read
FROM platform.staff_student_profile_snapshot(:'bw3_case_one_id') \gset
SELECT count(*)::TEXT AS bw3_sales_pending_document_read
FROM platform.staff_student_case_documents(:'bw3_case_one_id') \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw3_sensitive_gate_state' = '22023'
    AND :'bw3_profile_changed_replay_state' = '22023'
    AND :'bw3_stale_revision_state' = '40001'
    AND :'bw3_profile_one_create'::JSONB = :'bw3_profile_one_replay'::JSONB
    AND (:'bw3_profile_one_update'::JSONB ->> 'revision')::BIGINT = 2
    AND (:'bw3_profile_two_create'::JSONB ->> 'revision')::BIGINT = 1
    AND :'bw3_sales_pending_profile_read' = '1'
    AND :'bw3_sales_pending_document_read' = '2',
  'profile gate, replay, revision or pending Sales access failed'
);
SELECT pg_temp.assert_true(
  (
    SELECT NOT (event.after_state ? 'preferred_display_name')
      AND NOT (event.after_state ? 'legal_display_name')
      AND NOT (event.after_state ? 'date_of_birth')
      AND event.after_state::TEXT NOT LIKE '%Synthetic Preferred%'
      AND COALESCE(event.before_state::TEXT, '') NOT LIKE
        '%Synthetic Preferred%'
    FROM platform.audit_events AS event
    WHERE event.request_id = '53000000-0000-4000-8000-000000000636'
  ),
  'Student Profile audit stored PII values'
);

-- Browser DML is absent. Owner-level trigger probes separately prove that the
-- case pin, approved manifest, and source links cannot be rewritten.
SET request.jwt.claims TO :'bw3_sales_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
UPDATE platform.student_profiles
SET budget_band = 'forbidden direct update'
WHERE student_case_id = :'bw3_case_one_id';
\set bw3_direct_profile_update_state :SQLSTATE
UPDATE platform.student_cases
SET applied_country_requirement_version_id = NULL
WHERE id = :'bw3_case_one_id';
\set bw3_direct_binding_update_state :SQLSTATE
INSERT INTO platform.country_requirement_versions (
  organization_id, target_country, target_degree, program_direction,
  version, created_by_membership_id
) VALUES (
  :'bw3_org_a', 'Forbidden direct country', 'Synthetic Degree',
  'synthetic_program', 1, :'bw3_sales_membership'
);
\set bw3_direct_country_insert_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

\set ON_ERROR_STOP off
UPDATE platform.student_cases
SET applied_country_requirement_version_id = NULL
WHERE id = :'bw3_case_one_id';
\set bw3_owner_binding_clear_state :SQLSTATE
UPDATE platform.student_cases
SET applied_country_requirement_version_id = :'bw3_version_two_id'
WHERE id = :'bw3_case_one_id';
\set bw3_owner_binding_rebind_state :SQLSTATE
UPDATE platform.document_requirements
SET label = 'Forbidden approved manifest rewrite'
WHERE id = :'bw3_requirement_one_a';
\set bw3_owner_requirement_update_state :SQLSTATE
INSERT INTO platform.document_requirements (
  organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions,
  created_by_membership_id
) VALUES (
  :'bw3_org_a', 'Synthetic Country', 'Synthetic Degree', 'synthetic_program',
  1, 'synthetic.late', 'Forbidden late requirement',
  'Approved manifests cannot grow silently', :'bw3_sales_membership'
);
\set bw3_owner_requirement_insert_state :SQLSTATE
UPDATE platform.country_requirement_versions
SET required_profile_fields = ARRAY[]::platform.student_profile_field[]
WHERE id = :'bw3_version_one_id';
\set bw3_owner_version_update_state :SQLSTATE
DELETE FROM platform.country_requirement_version_sources
WHERE id = :'bw3_version_one_source_link_id';
\set bw3_owner_source_link_delete_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'bw3_direct_profile_update_state' = '42501'
    AND :'bw3_direct_binding_update_state' = '42501'
    AND :'bw3_direct_country_insert_state' = '42501'
    AND :'bw3_owner_binding_clear_state' = '55000'
    AND :'bw3_owner_binding_rebind_state' = '55000'
    AND :'bw3_owner_requirement_update_state' = '55000'
    AND :'bw3_owner_requirement_insert_state' = '55000'
    AND :'bw3_owner_version_update_state' = '55000'
    AND :'bw3_owner_source_link_delete_state' = '55000',
  'direct DML or immutable manifest/binding/source guard failed'
);

-- A retired version remains a valid historical pin. Handoff itself updates
-- the case, so this also proves the retired pin does not freeze unrelated case
-- lifecycle fields.
SET request.jwt.claims TO :'bw3_admin_claims';
SET ROLE authenticated;
SELECT platform.retire_country_requirement_version(
  :'bw3_org_a', :'bw3_version_one_id',
  'retire version one while retaining historical binding',
  '53000000-0000-4000-8000-000000000640'
);
SELECT platform.assign_student_case_curator(
  :'bw3_org_a', :'bw3_case_one_id', :'bw3_curator_membership',
  'handoff synthetic case one to Curator',
  '53000000-0000-4000-8000-000000000641'
);
SELECT platform.assign_student_case_curator(
  :'bw3_org_a', :'bw3_case_two_id', :'bw3_curator_membership',
  'handoff synthetic case two to Curator',
  '53000000-0000-4000-8000-000000000642'
);
RESET ROLE;

-- Handoff rotates scopes and access versions. Refresh all affected claims.
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_sales_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_sales_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_curator_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_curator_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_student_one_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_student_one_user' \gset
SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version
)::TEXT AS bw3_student_two_claims
FROM platform.profiles AS profile
WHERE profile.auth_user_id = :'bw3_student_two_user' \gset

SET request.jwt.claims TO :'bw3_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_sales_after_handoff_read
FROM platform.staff_student_profile_snapshot(:'bw3_case_one_id') \gset
\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 2,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_updated',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Forbidden Sales update after handoff',
  'Sales loses full profile access after handoff',
  '53000000-0000-4000-8000-000000000643'
);
\set bw3_sales_after_handoff_write_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_curator_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_curator_profile_read
FROM platform.staff_student_profile_snapshot(:'bw3_case_one_id') \gset
SELECT
  count(*)::TEXT AS bw3_curator_country_version_count,
  count(*) FILTER (WHERE status = 'draft')::TEXT
    AS bw3_curator_draft_version_count
FROM platform.staff_country_requirement_versions_for_case(:'bw3_case_one_id')
\gset
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 2,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_updated',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Curator owns next profile step after handoff',
  'assigned Curator revises retired-version-bound profile',
  '53000000-0000-4000-8000-000000000644'
)::TEXT AS bw3_curator_profile_update \gset
RESET ROLE;

SET request.jwt.claims TO :'bw3_finance_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_finance_profile_read
FROM platform.staff_student_profile_snapshot(:'bw3_case_one_id') \gset
\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 3,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_updated',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Forbidden Finance profile update',
  'Finance has no profile permission',
  '53000000-0000-4000-8000-000000000645'
);
\set bw3_finance_profile_write_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_admin_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_cross_org_profile_read
FROM platform.staff_student_profile_snapshot(:'bw3_case_one_id') \gset
SELECT count(*)::TEXT AS bw3_cross_org_direct_read
FROM platform.student_profiles
WHERE student_case_id = :'bw3_case_one_id' \gset
RESET ROLE;

SET request.jwt.claims TO :'bw3_student_one_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_student_one_portal_count
FROM platform.student_portal_profile()
WHERE case_id = :'bw3_case_one_id' \gset
SELECT count(*)::TEXT AS bw3_student_one_cross_count
FROM platform.student_portal_profile()
WHERE case_id = :'bw3_case_two_id' \gset
SELECT count(*)::TEXT AS bw3_student_one_direct_count
FROM platform.student_profiles
WHERE student_case_id IN (:'bw3_case_one_id', :'bw3_case_two_id') \gset
\set ON_ERROR_STOP off
SELECT platform.upsert_student_profile(
  :'bw3_org_a', :'bw3_case_one_id', 3,
  'Synthetic Preferred One', NULL, NULL,
  'ru', 'Synthetic Citizenship', 'Synthetic Residency',
  'Synthetic current education', 'Synthetic academic summary',
  'Synthetic language summary', 'synthetic_budget_updated',
  ARRAY['self']::TEXT[], 'not_recorded', NULL,
  'Forbidden Student self mutation',
  'Student profile is read-only in portal',
  '53000000-0000-4000-8000-000000000646'
);
\set bw3_student_profile_write_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw3_student_two_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS bw3_student_two_portal_count
FROM platform.student_portal_profile()
WHERE case_id = :'bw3_case_two_id' \gset
SELECT count(*)::TEXT AS bw3_student_two_cross_count
FROM platform.student_portal_profile()
WHERE case_id = :'bw3_case_one_id' \gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw3_sales_after_handoff_read' = '0'
    AND :'bw3_sales_after_handoff_write_state' = '42501'
    AND :'bw3_curator_profile_read' = '1'
    AND :'bw3_curator_country_version_count' = '2'
    AND :'bw3_curator_draft_version_count' = '0'
    AND (:'bw3_curator_profile_update'::JSONB ->> 'revision')::BIGINT = 3
    AND :'bw3_finance_profile_read' = '0'
    AND :'bw3_finance_profile_write_state' = '42501'
    AND :'bw3_cross_org_profile_read' = '0'
    AND :'bw3_cross_org_direct_read' = '0'
    AND :'bw3_student_one_portal_count' = '1'
    AND :'bw3_student_one_cross_count' = '0'
    AND :'bw3_student_one_direct_count' = '1'
    AND :'bw3_student_profile_write_state' = '42501'
    AND :'bw3_student_two_portal_count' = '1'
    AND :'bw3_student_two_cross_count' = '0',
  'post-handoff role matrix or cross-student/cross-org denial failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT status = 'retired'
      AND required_profile_fields @>
        ARRAY['preferred_display_name']::platform.student_profile_field[]
    FROM platform.country_requirement_versions
    WHERE id = :'bw3_version_one_id'
  )
  AND (
    SELECT applied_country_requirement_version_id = :'bw3_version_one_id'
    FROM platform.student_cases
    WHERE id = :'bw3_case_one_id'
  ),
  'retired version retention or immutable case pin failed'
);

SELECT 'platform Student Profile requirements RLS passed' AS result;
