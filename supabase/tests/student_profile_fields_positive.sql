\set ON_ERROR_STOP on

-- Positive D2 database proof only. Synthetic upstream identity/case/approved
-- checklist snapshots follow the existing admissions fixture convention. No
-- triggers are disabled; no real Auth server, file, provider or browser is used.
-- This file is run only by the disposable network-none PostgreSQL harness.
BEGIN;
CREATE FUNCTION pg_temp.d2_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59159000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.d2_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'D2 positive proof: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.d2_field(snapshot JSONB, field_key TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT field FROM jsonb_array_elements(snapshot->'fields') AS field WHERE field->>'field_key' = $2
$$;
GRANT EXECUTE ON FUNCTION pg_temp.d2_id(INTEGER), pg_temp.d2_assert(BOOLEAN, TEXT),
  pg_temp.d2_field(JSONB, TEXT) TO authenticated;
CREATE TEMP TABLE d2_receipts(key TEXT PRIMARY KEY, body JSONB NOT NULL);
GRANT SELECT, INSERT ON d2_receipts TO authenticated;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.d2_id(1), 'D2 Fictional Organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (pg_temp.d2_id(101), 'd2-positive-staff@example.invalid', '{}');
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.d2_id(201), pg_temp.d2_id(101), 'D2 Fictional Admin', 'active', 1);
INSERT INTO platform.organization_memberships(
  id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin
) VALUES (
  pg_temp.d2_id(301), pg_temp.d2_id(1), pg_temp.d2_id(201), 'active', 'admin',
  (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE
);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.d2_id(400 + n), pg_temp.d2_id(1), 'student_case', pg_temp.d2_id(500 + n), 1
  FROM generate_series(1, 2) AS n;
-- Existing reviewed checklist snapshot: its approval workflow is not under test.
INSERT INTO platform.country_requirement_versions(
  id, organization_id, target_country, target_degree, program_direction, version,
  status, required_profile_fields, created_by_membership_id, approved_by_membership_id, approved_at
) VALUES (
  pg_temp.d2_id(601), pg_temp.d2_id(1), 'China', 'Bachelor', 'Engineering', 1,
  'approved', ARRAY[]::platform.student_profile_field[], pg_temp.d2_id(301), pg_temp.d2_id(301), statement_timestamp()
);
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, source_key, student_display_name,
  target_country, target_degree, program_direction, state, current_scope_id, current_scope_version,
  applied_country_requirement_version_id
) SELECT pg_temp.d2_id(500 + n), pg_temp.d2_id(1), pg_temp.d2_id(301),
  'synthetic:d2-positive:' || n, 'D2 Fictional Student ' || n, 'China', 'Bachelor', 'Engineering',
  'pending', pg_temp.d2_id(400 + n), 1, CASE WHEN n = 1 THEN pg_temp.d2_id(601) ELSE NULL END
FROM generate_series(1, 2) AS n;
INSERT INTO platform.student_profiles(
  id, organization_id, student_case_id, revision, preferred_display_name,
  communication_language, citizenship_country, residency_country, current_education_summary,
  academic_summary, language_summary, budget_band, decision_participant_labels,
  consent_status, next_step, created_by_membership_id, updated_by_membership_id
) VALUES (
  pg_temp.d2_id(701), pg_temp.d2_id(1), pg_temp.d2_id(501), 3, 'Existing fictional applicant',
  'ru', 'Existing citizenship', 'Existing residence', 'Existing education',
  'Existing academics', 'Existing language', 'Existing budget', ARRAY[]::TEXT[],
  'not_recorded', 'Existing next step', pg_temp.d2_id(301), pg_temp.d2_id(301)
);
INSERT INTO d2_receipts SELECT 'existing-row', to_jsonb(profile)
  FROM platform.student_profiles AS profile WHERE profile.id = pg_temp.d2_id(701);
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.d2_id(101), 'claims', jsonb_build_object('sub', pg_temp.d2_id(101), 'role', 'authenticated')
))->'claims')::TEXT AS d2_staff_claims \gset
SET LOCAL request.jwt.claims TO :'d2_staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d2_receipts SELECT 'existing-snapshot', to_jsonb(snapshot)
  FROM platform.staff_student_profile_snapshot(pg_temp.d2_id(501)) AS snapshot;
SELECT pg_temp.d2_assert((SELECT count(*) = 1 FROM d2_receipts WHERE key = 'existing-snapshot'), 'intended staff reads the existing profile before migration');
RESET ROLE;
COMMIT;
\echo STUDENT_PROFILE_FIELDS_SYNTHETIC_BASELINE_READY

\ir ../migrations/158_platform_partial_student_profiles.sql
\ir ../migrations/159_platform_student_profile_field_reviews.sql
\echo STUDENT_PROFILE_FIELDS_MIGRATIONS_158_159_APPLIED

BEGIN;
SELECT pg_temp.d2_assert((SELECT to_jsonb(profile) = (SELECT body FROM d2_receipts WHERE key = 'existing-row')
  FROM platform.student_profiles AS profile WHERE profile.id = pg_temp.d2_id(701)), 'existing profile is byte-for-byte unchanged by migrations');
SET LOCAL request.jwt.claims TO :'d2_staff_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.d2_assert((SELECT to_jsonb(snapshot) = (SELECT body FROM d2_receipts WHERE key = 'existing-snapshot')
  FROM platform.staff_student_profile_snapshot(pg_temp.d2_id(501)) AS snapshot), 'existing staff snapshot is preserved');

DO $empty_profile$
DECLARE
  org UUID := pg_temp.d2_id(1);
  case_id UUID := pg_temp.d2_id(502);
  snapshot JSONB;
  receipt JSONB;
  replayed JSONB;
  partial RECORD;
BEGIN
  snapshot := platform.staff_student_profile_fields(case_id);
  PERFORM pg_temp.d2_assert(snapshot->'profile' = 'null'::JSONB AND snapshot->>'can_initialize' = 'true'
    AND jsonb_array_length(snapshot->'fields') = 61, 'absence is readable without creating a profile');
  receipt := platform.start_student_profile(org, case_id, 0, 'Start synthetic partial profile', pg_temp.d2_id(801));
  INSERT INTO d2_receipts VALUES ('start', receipt);
  snapshot := platform.staff_student_profile_fields(case_id);
  PERFORM pg_temp.d2_assert(snapshot->'profile'->>'revision' = '1'
    AND snapshot->'profile'->>'id' = receipt->>'student_profile_id'
    AND snapshot->>'can_initialize' = 'false' AND snapshot->>'can_review' = 'true', 'explicit initialization produces revision one');
  PERFORM pg_temp.d2_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'fields') AS field
    WHERE field->'value' <> 'null'::JSONB OR field->>'review_state' <> 'needs_review'), 'empty facts are not invented');
  SELECT * INTO partial FROM platform.staff_student_profile_snapshot(case_id);
  PERFORM pg_temp.d2_assert(partial.profile_revision = 1 AND partial.preferred_display_name IS NULL
    AND partial.communication_language IS NULL AND partial.citizenship_country IS NULL AND partial.residency_country IS NULL
    AND partial.current_education_summary IS NULL AND partial.academic_summary IS NULL AND partial.language_summary IS NULL
    AND partial.budget_band IS NULL AND partial.profile_next_step IS NULL
    AND partial.applied_country_requirement_version_id IS NULL AND partial.checklist_version IS NULL
    AND cardinality(partial.required_profile_fields) = 0 AND partial.consent_status = 'not_recorded'
    AND partial.consent_evidence_ref IS NULL AND cardinality(partial.decision_participant_labels) = 0,
    'partial snapshot preserves nine NULL facts and coherent no-checklist metadata');

  receipt := platform.review_student_profile_field(org, case_id, 'date_of_birth', 'confirm', '29.02.2008', NULL, NULL, NULL,
    1, 'Confirm synthetic date', pg_temp.d2_id(802));
  PERFORM pg_temp.d2_assert(receipt->>'profile_revision' = '2', 'mapped confirmation increments the aggregate once');
  receipt := platform.review_student_profile_field(org, case_id, 'student_first_name', 'confirm', repeat('𠮷', 60), NULL, NULL, NULL,
    2, 'Confirm synthetic name', pg_temp.d2_id(803));
  INSERT INTO d2_receipts VALUES ('name', receipt);
  PERFORM pg_temp.d2_assert(receipt->>'profile_revision' = '3', 'extension confirmation increments the aggregate once');
  receipt := platform.review_student_profile_field(org, case_id, 'nationality', 'confirm', 'Synthetic citizenship', NULL, NULL, NULL,
    3, 'Confirm synthetic citizenship', pg_temp.d2_id(804));
  PERFORM pg_temp.d2_assert(receipt->>'profile_revision' = '4', 'citizenship confirmation increments once');
  receipt := platform.review_student_profile_field(org, case_id, 'mother_employer', 'clear', NULL, NULL, NULL, NULL,
    4, 'Confirm optional field is empty', pg_temp.d2_id(805));
  PERFORM pg_temp.d2_assert(receipt->>'profile_revision' = '5', 'confirmed empty increments once');
  snapshot := platform.staff_student_profile_fields(case_id);
  PERFORM pg_temp.d2_assert(pg_temp.d2_field(snapshot, 'date_of_birth')->>'value' = '2008-02-29'
    AND pg_temp.d2_field(snapshot, 'date_of_birth')->>'review_state' = 'confirmed', 'mapped date readback is normalized and confirmed');
  PERFORM pg_temp.d2_assert(pg_temp.d2_field(snapshot, 'student_first_name')->>'value' = repeat('𠮷', 60)
    AND pg_temp.d2_field(snapshot, 'student_first_name')->>'review_state' = 'confirmed', 'supplementary-CJK extension is preserved at its bound');
  PERFORM pg_temp.d2_assert(pg_temp.d2_field(snapshot, 'mother_employer')->'value' = 'null'::JSONB
    AND pg_temp.d2_field(snapshot, 'mother_employer')->>'review_state' = 'confirmed'
    AND pg_temp.d2_field(snapshot, 'mother_employer')->'reviewed_at' <> 'null'::JSONB, 'confirmed empty differs from an absent field');
  SELECT * INTO partial FROM platform.staff_student_profile_snapshot(case_id);
  PERFORM pg_temp.d2_assert(partial.date_of_birth = DATE '2008-02-29'
    AND partial.citizenship_country = 'Synthetic citizenship' AND partial.profile_revision = 5,
    'existing canonical reader observes mapped values and the same revision');

  replayed := platform.start_student_profile(org, case_id, 0, 'Start synthetic partial profile', pg_temp.d2_id(801));
  PERFORM pg_temp.d2_assert(replayed = (SELECT body FROM d2_receipts WHERE key = 'start'), 'start replay returns the original receipt after newer edits');
  replayed := platform.review_student_profile_field(org, case_id, 'student_first_name', 'confirm', repeat('𠮷', 60), NULL, NULL, NULL,
    2, 'Confirm synthetic name', pg_temp.d2_id(803));
  PERFORM pg_temp.d2_assert(replayed = (SELECT body FROM d2_receipts WHERE key = 'name'), 'review replay returns the original receipt');
  PERFORM pg_temp.d2_assert(platform.staff_student_profile_fields(case_id) = snapshot, 'ordinary retries do not change values or revision');
END
$empty_profile$;
\echo STUDENT_PROFILE_FIELDS_PARTIAL_REVIEW_REPLAY_VERIFIED

DO $prepare_canonical_update$
DECLARE
  org UUID := pg_temp.d2_id(1);
  case_id UUID := pg_temp.d2_id(501);
  before_update JSONB;
BEGIN
  PERFORM platform.review_student_profile_field(org, case_id, 'date_of_birth', 'confirm', '2007-05-03', NULL, NULL, NULL,
    3, 'Confirm optional synthetic date', pg_temp.d2_id(811));
  PERFORM platform.review_student_profile_field(org, case_id, 'nationality', 'confirm', 'Existing citizenship', NULL, NULL, NULL,
    4, 'Confirm existing citizenship', pg_temp.d2_id(812));
  PERFORM platform.review_student_profile_field(org, case_id, 'country_of_residence', 'confirm', 'Existing residence', NULL, NULL, NULL,
    5, 'Confirm existing residence', pg_temp.d2_id(813));
  PERFORM platform.review_student_profile_field(org, case_id, 'student_last_name', 'confirm', 'Synthetic family name', NULL, NULL, NULL,
    6, 'Confirm extension on existing profile', pg_temp.d2_id(814));
  before_update := platform.staff_student_profile_fields(case_id);
  PERFORM pg_temp.d2_assert(before_update->'profile'->>'revision' = '7', 'four reviews add exactly four revisions to the existing profile');
  INSERT INTO d2_receipts VALUES ('before-full-update', before_update);
END
$prepare_canonical_update$;

-- The full writer is a separate statement, like the next application RPC.
-- Its statement_timestamp must not be the timestamp of the preceding reviews.
DO $canonical_update$
DECLARE
  org UUID := pg_temp.d2_id(1);
  case_id UUID := pg_temp.d2_id(501);
  receipt JSONB;
  before_update JSONB := (SELECT body FROM d2_receipts WHERE key = 'before-full-update');
  after_update JSONB;
BEGIN
  receipt := platform.upsert_student_profile(org, case_id, 7, 'Existing fictional applicant', NULL, DATE '2007-05-03',
    'ru', 'Updated citizenship', 'Existing residence', 'Existing education', 'Existing academics', 'Existing language',
    'Existing budget', ARRAY[]::TEXT[], 'not_recorded', NULL, 'Existing next step',
    'Ordinary full-profile update', pg_temp.d2_id(815));
  after_update := platform.staff_student_profile_fields(case_id);
  PERFORM pg_temp.d2_assert(receipt->>'revision' = '8' AND after_update->'profile'->>'revision' = '8', 'full update increments the same aggregate once');
  PERFORM pg_temp.d2_assert(pg_temp.d2_field(after_update, 'nationality')->>'value' = 'Updated citizenship'
    AND pg_temp.d2_field(after_update, 'nationality')->>'review_state' = 'needs_review'
    AND pg_temp.d2_field(after_update, 'nationality')->'reviewed_at' = 'null'::JSONB, 'changed canonical citizenship loses only its prior confirmation');
  PERFORM pg_temp.d2_assert(pg_temp.d2_field(after_update, 'date_of_birth') = pg_temp.d2_field(before_update, 'date_of_birth')
    AND pg_temp.d2_field(after_update, 'country_of_residence') = pg_temp.d2_field(before_update, 'country_of_residence')
    AND pg_temp.d2_field(after_update, 'student_last_name') = pg_temp.d2_field(before_update, 'student_last_name'),
    'unchanged mapped and extension confirmations survive a full update');
END
$canonical_update$;
RESET ROLE;
SELECT pg_temp.d2_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.d2_id(801)), 'one audit event for repeated initialization');
SELECT pg_temp.d2_assert((SELECT count(*) = 1 FROM platform.student_profile_field_reviews WHERE request_id = pg_temp.d2_id(803)), 'one review history entry for repeated confirmation');
SELECT pg_temp.d2_assert((SELECT count(*) = 2 FROM platform.student_profiles WHERE organization_id = pg_temp.d2_id(1)), 'one canonical profile per synthetic case');
SELECT pg_temp.d2_assert(NOT EXISTS (SELECT 1 FROM platform.student_profile_fields
  WHERE organization_id = pg_temp.d2_id(1) AND field_key IN ('date_of_birth', 'nationality', 'country_of_residence') AND value IS NOT NULL),
  'mapped fields have no duplicate current value');
COMMIT;
\echo STUDENT_PROFILE_FIELDS_CANONICAL_REVISION_INVALIDATION_VERIFIED
