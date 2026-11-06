\set ON_ERROR_STOP on
-- Boundary suite for migration 337 «При одобрении анкеты в дело копируется вся анкета». Runs on the real chain right after 337 inside
-- one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves (real submit by the account, real approval by the system Admin):
--  1. the new card fields: countries in Russian, study fields, levels in Russian, English in words, season and year — all needs_review;
--  2. «Пока не решил» gives no country field; one level gives one level;
--  3. the route of the case is untouched: target_country and admissions_direction stay NULL (план §4/§8);
--  4. the fields that were copied before are still copied.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
DO $a337_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a337_auth_role$;

\echo A337_APPLICATION_APPROVAL_FULL_COPY_SUITE_START

CREATE FUNCTION pg_temp.a337_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a337_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A337: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a337_call(p_who TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', p_who::UUID, 'claims', jsonb_build_object('sub', p_who::UUID, 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
CREATE FUNCTION pg_temp.a337_submit(p_user INTEGER, p_request INTEGER, p_countries JSONB, p_fields JSONB, p_levels JSONB) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a337_call(pg_temp.a337_id(p_user)::TEXT, format('platform.submit_student_application_v1(%L::UUID, %L::JSONB, 0)',
    pg_temp.a337_id(p_request), jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a337_id(p_request)::TEXT,
      'firstName', 'A337', 'lastName', 'Студент', 'phone', '+996555337000', 'destinationCountries', p_countries,
      'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5',
      'studyFields', p_fields, 'studyLevels', p_levels, 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
      'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18')));
  PERFORM pg_temp.a337_assert(r ? 'ok', 'анкета submit failed: ' || r::TEXT);
  RETURN (r #>> '{ok,id}')::UUID;
END
$$;
CREATE FUNCTION pg_temp.a337_approve(p_application UUID, p_request INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a337_call(pg_temp.a337_id(101)::TEXT, format(
    'platform.decide_student_application_v1(%L::UUID, 1, ''approve'', ''A337 synthetic decision'', %L::UUID)', p_application, pg_temp.a337_id(p_request)));
  PERFORM pg_temp.a337_assert(r #>> '{ok,status}' = 'approved', 'approval failed: ' || r::TEXT);
  RETURN (r #>> '{ok,student_case_id}')::UUID;
END
$$;
CREATE FUNCTION pg_temp.a337_field(p_case UUID, p_key TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT f.value FROM platform.student_profile_fields f WHERE f.student_case_id = p_case AND f.field_key = p_key
$$;

-- Fixture: one organization, the system Admin 101, applicants 111 and 112 with confirmed email.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a337_id(1), 'A337 Fictional organization');
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a337_id(2), pg_temp.a337_id(1), 'organization', pg_temp.a337_id(1), 1);
INSERT INTO auth.users(id, email, raw_user_meta_data, email_confirmed_at)
  SELECT pg_temp.a337_id(100 + n), 'a337-' || n || '@example.invalid', '{}'::JSONB, statement_timestamp()
  FROM unnest(ARRAY[1, 11, 12]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a337_id(201), pg_temp.a337_id(101), 'A337 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  VALUES (pg_temp.a337_id(301), pg_temp.a337_id(1), pg_temp.a337_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a337_id(1), pg_temp.a337_id(301), pg_temp.a337_id(2), 1, 1, TRUE, 'system', 'A337 synthetic organization scope', pg_temp.a337_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES (pg_temp.a337_id(930), pg_temp.a337_id(1), 'Отдел сопровождения');
DELETE FROM platform_private.student_application_configuration;
INSERT INTO platform_private.student_application_configuration (singleton, organization_id, review_department_id, enabled, intake_owner_membership_id)
  VALUES (TRUE, pg_temp.a337_id(1), pg_temp.a337_id(930), TRUE, NULL);

SELECT pg_temp.a337_approve(pg_temp.a337_submit(111, 711, '["CN", "MY"]'::JSONB, '["Инженерия", "Информационные технологии"]'::JSONB,
    '["bachelor", "master"]'::JSONB), 721) AS a337_case_two,
  pg_temp.a337_approve(pg_temp.a337_submit(112, 712, '["undecided"]'::JSONB, '["Медицина"]'::JSONB, '["foundation"]'::JSONB), 722) AS a337_case_undecided \gset

-- 1. The new card fields.
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'desired_country_of_study') = 'Китай, Малайзия', 'countries in Russian');
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'field_major') = 'Инженерия, Информационные технологии', 'study fields');
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'program_level') = 'Бакалавриат, Магистратура', 'levels in Russian');
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'english_level') = 'Указано студентом: начальный английский', 'English in words');
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'desired_start_date') = 'Осень 2027', 'season and year');
SELECT pg_temp.a337_assert((SELECT bool_and(f.review_state = 'needs_review') FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'a337_case_two'), 'every copied field waits for review');

-- 2. «Пока не решил» and one level.
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_undecided', 'desired_country_of_study') IS NULL
    AND NOT EXISTS (SELECT 1 FROM platform.student_profile_fields f WHERE f.student_case_id = :'a337_case_undecided'
      AND f.field_key = 'desired_country_of_study'),
  'no country field for «Пока не решил»');
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_undecided', 'program_level') = 'Подготовительная программа', 'one level');

-- 3. The route of the case is untouched.
SELECT pg_temp.a337_assert((SELECT c.target_country IS NULL AND c.admissions_direction IS NULL FROM platform.student_cases c
    WHERE c.id = :'a337_case_two'), 'target_country and admissions_direction stay NULL');

-- 4. The fields copied before are still copied.
SELECT pg_temp.a337_assert(pg_temp.a337_field(:'a337_case_two', 'student_first_name') = 'A337'
    AND pg_temp.a337_field(:'a337_case_two', 'mobile_phone') = '+996555337000'
    AND pg_temp.a337_field(:'a337_case_two', 'budget_per_year') IS NOT NULL,
  'name, phone and budget as before');

\echo A337_APPLICATION_APPROVAL_FULL_COPY_SUITE_PASSED
ROLLBACK;
