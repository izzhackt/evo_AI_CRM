\set ON_ERROR_STOP on

-- Run after migration161 in an isolated synthetic database only. This proves
-- database command/audit outcomes, not Auth, DOCX rendering or delivery.
BEGIN;
CREATE FUNCTION pg_temp.d2c_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('60160000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.d2c_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'D2c positive proof: %', message; END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.d2c_id(INTEGER), pg_temp.d2c_assert(BOOLEAN, TEXT) TO authenticated, service_role;
CREATE TEMP TABLE d2c_receipts(key TEXT PRIMARY KEY, body JSONB NOT NULL);
GRANT SELECT, INSERT ON d2c_receipts TO authenticated, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.d2c_id(1), 'D2c Fictional Organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.d2c_id(100 + n), 'd2c-positive-' || n || '@example.invalid', '{}'::JSONB FROM generate_series(1, 2) n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.d2c_id(200 + n), pg_temp.d2c_id(100 + n), 'D2c Fictional Admin ' || n, 'active', 1 FROM generate_series(1, 2) n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.d2c_id(300 + n), pg_temp.d2c_id(1), pg_temp.d2c_id(200 + n), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE
  FROM generate_series(1, 2) n;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.d2c_id(401), pg_temp.d2c_id(1), 'student_case', pg_temp.d2c_id(501), 1);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, source_key, student_display_name,
  target_country, target_degree, program_direction, state, current_scope_id, current_scope_version)
VALUES (pg_temp.d2c_id(501), pg_temp.d2c_id(1), pg_temp.d2c_id(301), 'synthetic:d2c-positive', 'D2c Fictional Student',
  'China', 'Bachelor', 'Engineering', 'pending', pg_temp.d2c_id(401), 1);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.d2c_id(101), 'claims', jsonb_build_object('sub', pg_temp.d2c_id(101), 'role', 'authenticated')
))->'claims')::TEXT AS d2c_staff_claims \gset
SET LOCAL request.jwt.claims TO :'d2c_staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d2c_receipts SELECT 'profile', platform.start_student_profile(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), 0, 'Start synthetic export profile', pg_temp.d2c_id(701));
INSERT INTO d2c_receipts SELECT 'user-snapshot', platform.staff_student_profile_fields(pg_temp.d2c_id(501));
SELECT pg_temp.d2c_assert((SELECT body->'profile'->>'revision' = '1' AND body->>'can_export' = 'true'
  FROM d2c_receipts WHERE key = 'user-snapshot'), 'authorized user reads the canonical partial profile');
RESET ROLE;

-- Catalog inspection verifies the intended service-only contract without
-- attempting an unauthorized call or synthesizing a browser exploit.
SELECT pg_temp.d2c_assert(NOT has_function_privilege('authenticated',
  'platform.complete_student_profile_export(uuid,text,text,integer,text)', 'EXECUTE'), 'browser role has no completion privilege');
SELECT pg_temp.d2c_assert(has_function_privilege('service_role',
  'platform.complete_student_profile_export(uuid,text,text,integer,text)', 'EXECUTE'), 'server role owns completion');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d2c_receipts SELECT 'first', platform.begin_student_profile_export(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), pg_temp.d2c_id(101), pg_temp.d2c_id(301), 1, 'draft', repeat('a', 64), pg_temp.d2c_id(801));
INSERT INTO d2c_receipts SELECT 'pending-replay', platform.begin_student_profile_export(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), pg_temp.d2c_id(101), pg_temp.d2c_id(301), 1, 'draft', repeat('a', 64), pg_temp.d2c_id(801));
SELECT pg_temp.d2c_assert((SELECT body->>'created' = 'false' AND body->>'status' = 'pending'
  AND body->>'attempt_id' = (SELECT body->>'attempt_id' FROM d2c_receipts WHERE key = 'first')
  FROM d2c_receipts WHERE key = 'pending-replay'), 'pending replay returns the existing attempt');
INSERT INTO d2c_receipts SELECT 'generated', platform.complete_student_profile_export(
  (SELECT (body->>'attempt_id')::UUID FROM d2c_receipts WHERE key = 'first'), 'generated', repeat('b', 64), 128, NULL);
INSERT INTO d2c_receipts SELECT 'generated-completion-replay', platform.complete_student_profile_export(
  (SELECT (body->>'attempt_id')::UUID FROM d2c_receipts WHERE key = 'first'), 'generated', repeat('b', 64), 128, NULL);
SELECT pg_temp.d2c_assert((SELECT body = (SELECT body FROM d2c_receipts WHERE key = 'generated')
  FROM d2c_receipts WHERE key = 'generated-completion-replay'), 'terminal completion is idempotent');
INSERT INTO d2c_receipts SELECT 'second', platform.begin_student_profile_export(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), pg_temp.d2c_id(101), pg_temp.d2c_id(301), 1, 'draft', repeat('a', 64), pg_temp.d2c_id(802));
RESET ROLE;

-- An ordinary concurrent curator update advances the canonical revision.
SET LOCAL request.jwt.claims TO :'d2c_staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d2c_receipts SELECT 'review', platform.review_student_profile_field(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), 'student_first_name', 'confirm', 'Synthetic update', NULL, NULL, NULL,
  1, 'Ordinary synthetic edit between begin and complete', pg_temp.d2c_id(702));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d2c_receipts SELECT 'stale-result', platform.complete_student_profile_export(
  (SELECT (body->>'attempt_id')::UUID FROM d2c_receipts WHERE key = 'second'), 'generated', repeat('c', 64), 128, NULL);
SELECT pg_temp.d2c_assert((SELECT body->>'status' = 'failed' AND body->>'failure_code' = 'profile_changed'
  FROM d2c_receipts WHERE key = 'stale-result'), 'stale completion returns a recorded failure');
INSERT INTO d2c_receipts SELECT 'old-generated-replay', platform.begin_student_profile_export(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), pg_temp.d2c_id(101), pg_temp.d2c_id(301), 1, 'draft', repeat('a', 64), pg_temp.d2c_id(801));
SELECT pg_temp.d2c_assert((SELECT body->>'status' = 'generated' AND body->>'created' = 'false'
  AND body->>'profile_revision' = '1' FROM d2c_receipts WHERE key = 'old-generated-replay'),
  'generated replay keeps its original revision after later profile edits');
INSERT INTO d2c_receipts SELECT 'third', platform.begin_student_profile_export(
  pg_temp.d2c_id(1), pg_temp.d2c_id(501), pg_temp.d2c_id(101), pg_temp.d2c_id(301), 2, 'draft', repeat('a', 64), pg_temp.d2c_id(803));
RESET ROLE;

-- The other Admin uses the existing canonical rights command. This is a normal
-- role change, not direct mutation of export records or caller credentials.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.d2c_id(102), 'claims', jsonb_build_object('sub', pg_temp.d2c_id(102), 'role', 'authenticated')
))->'claims')::TEXT AS d2c_other_staff_claims \gset
SET LOCAL request.jwt.claims TO :'d2c_other_staff_claims';
SET LOCAL ROLE authenticated;
INSERT INTO d2c_receipts SELECT 'rights-change', platform.staff_system_admin_command(
  pg_temp.d2c_id(1), pg_temp.d2c_id(301), 1, FALSE, 'Ordinary synthetic role change during export', pg_temp.d2c_id(703));
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO d2c_receipts SELECT 'rights-result', platform.complete_student_profile_export(
  (SELECT (body->>'attempt_id')::UUID FROM d2c_receipts WHERE key = 'third'), 'generated', repeat('d', 64), 128, NULL);
SELECT pg_temp.d2c_assert((SELECT body->>'status' = 'failed' AND body->>'failure_code' = 'access_changed'
  FROM d2c_receipts WHERE key = 'rights-result'), 'rights change returns a recorded failure');
RESET ROLE;

SELECT pg_temp.d2c_assert((SELECT count(*) = 3 FROM platform_private.student_profile_export_attempts
  WHERE organization_id = pg_temp.d2c_id(1)), 'three explicit requests create exactly three attempts');
SELECT pg_temp.d2c_assert((SELECT count(*) = 6 FROM platform.audit_events
  WHERE organization_id = pg_temp.d2c_id(1) AND action LIKE 'student.profile.export.%'), 'each attempt has one durable terminal audit');
SELECT pg_temp.d2c_assert((SELECT count(*) = 2 FROM platform_private.student_profile_export_attempts
  WHERE organization_id = pg_temp.d2c_id(1) AND status = 'failed' AND output_sha256 IS NULL AND output_bytes IS NULL),
  'failed completion audits survive and do not describe downloadable bytes');
SELECT pg_temp.d2c_assert((SELECT count(*) = 1 FROM platform.student_profiles
  WHERE organization_id = pg_temp.d2c_id(1) AND revision = 2), 'export commands do not mutate profile revision');
ROLLBACK;
\echo STUDENT_PROFILE_EXPORT_COMMAND_OUTCOMES_VERIFIED
