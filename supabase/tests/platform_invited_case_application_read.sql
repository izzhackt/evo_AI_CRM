\set ON_ERROR_STOP on
-- Boundary suite for migration 334 «Анкета приглашённого студента видна в деле». Runs on the real chain right after 334 inside one
-- transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. an invited student's pending анкета (invited_case_id) is returned for the invite case, which has no public_application_id
--     (before 334 the case read returned nothing);
--  2. after approval into the invite case (student_case_id = invited_case_id) the same анкета is still returned;
--  3. an ordinary approved анкета is still found through public_application_id, unchanged;
--  4. a case with no анкета returns NULL;
--  5. a Student and an unknown case are refused 42501, as before;
--  6. the posture is as in 177: STABLE, SECURITY DEFINER, search_path '', authenticated only.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A334_INVITED_CASE_APPLICATION_READ_SUITE_START

CREATE FUNCTION pg_temp.a334_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a334_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A334: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a334_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a334_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a334_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- The case read as an actor with their claims: its JSONB result, or {"error": SQLSTATE}.
CREATE FUNCTION pg_temp.a334_read(p_claims TEXT, p_case UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  BEGIN
    result := platform.staff_student_application_for_case_v1(p_case);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    result := jsonb_build_object('error', v_state);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a334_questionnaire(p_first TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a334_id(p_request), 'firstName', p_first, 'lastName', 'Тестова',
    'phone', '+996 700 000 000', 'destinationCountries', jsonb_build_array('MY'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', jsonb_build_array('Информационные технологии'),
    'studyLevels', jsonb_build_array('bachelor'), 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18')
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2 invited Student, 3 Student approved the ordinary way.
-- Cases: 701 invite case of student 2 (no public_application_id), 702 ordinary case of student 3, 703 a case with no анкета.
-- Applications: 801 student 2 (invited, pending), 802 student 3 (approved, the case's public application).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a334_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a334_actors VALUES (1, 'admin', TRUE), (2, 'student', FALSE), (3, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a334_id(1), 'A334 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a334_id(100 + n), 'a334-' || n || '@example.invalid', '{}'::JSONB FROM a334_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a334_id(200 + n), pg_temp.a334_id(100 + n), 'A334 Actor ' || n, 'active', 1 FROM a334_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a334_id(300 + a.n), pg_temp.a334_id(1), pg_temp.a334_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a334_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a334_id(401), pg_temp.a334_id(1), 'organization', pg_temp.a334_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a334_id(1), pg_temp.a334_id(300 + n), pg_temp.a334_id(401), 1, 1, TRUE, 'system', 'A334 synthetic organization scope', pg_temp.a334_id(460 + n) FROM a334_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a334_id(410 + c), pg_temp.a334_id(1), 'student_case', pg_temp.a334_id(700 + c), 1 FROM generate_series(1, 3) c;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, public_application_id, created_at, updated_at)
SELECT pg_temp.a334_id(700 + c.n), pg_temp.a334_id(1), c.member, pg_temp.a334_id(301), pg_temp.a334_id(301), 'a334-case-' || c.n,
  'A334 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a334_id(410 + c.n), 1, 'MY', 'documents',
  CASE WHEN c.member IS NULL THEN NULL ELSE clock_timestamp() END, c.public_app, clock_timestamp(), clock_timestamp()
FROM (VALUES (1, pg_temp.a334_id(302), NULL::UUID), (2, pg_temp.a334_id(303), pg_temp.a334_id(802)), (3, NULL::UUID, NULL::UUID)) AS c(n, member, public_app);
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id, invited_case_id)
VALUES
  (pg_temp.a334_id(801), pg_temp.a334_id(1), pg_temp.a334_id(102), 'a334-2@example.invalid', pg_temp.a334_questionnaire('Приглашённая', 901),
    'pending', 1, TIMESTAMPTZ '2026-11-01 10:00:00+00', NULL, NULL, NULL, NULL, pg_temp.a334_id(701)),
  (pg_temp.a334_id(802), pg_temp.a334_id(1), pg_temp.a334_id(103), 'a334-3@example.invalid', pg_temp.a334_questionnaire('Обычная', 902),
    'approved', 2, TIMESTAMPTZ '2026-10-01 10:00:00+00', TIMESTAMPTZ '2026-10-02 10:00:00+00', pg_temp.a334_id(301), 'A334 synthetic approval',
    pg_temp.a334_id(702), NULL);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a334_claims(1) AS a334_admin \gset
SELECT pg_temp.a334_claims(2) AS a334_student \gset

-- ---------------------------------------------------------------------------
-- 1. The invite case: no public_application_id, the pending анкета is found through invited_case_id.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a334_assert((SELECT c.public_application_id IS NULL FROM platform.student_cases c WHERE c.id = pg_temp.a334_id(701)),
  'the invite case carries no public application');
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(701)) ->> 'id' = pg_temp.a334_id(801)::TEXT,
  'the invited Student''s pending анкета is returned for the invite case');
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(701)) ->> 'status' = 'pending',
  'its status is pending');
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(701)) -> 'questionnaire' ->> 'firstName' = 'Приглашённая',
  'the answers come with it');

-- ---------------------------------------------------------------------------
-- 2. Approved into the invite case (193 sets student_case_id = invited_case_id): still found.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE platform_private.student_applications SET status = 'approved', revision = 2, decided_at = TIMESTAMPTZ '2026-11-02 10:00:00+00',
  decided_by_membership_id = pg_temp.a334_id(301), decision_reason = 'A334 synthetic approval', student_case_id = pg_temp.a334_id(701)
WHERE id = pg_temp.a334_id(801);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(701)) ->> 'id' = pg_temp.a334_id(801)::TEXT
    AND pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(701)) ->> 'status' = 'approved',
  'after approval into the invite case the same анкета is returned, approved');

-- ---------------------------------------------------------------------------
-- 3. The ordinary path is unchanged; 4. a case with no анкета returns NULL.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(702)) ->> 'id' = pg_temp.a334_id(802)::TEXT,
  'an ordinary approved анкета is still found through public_application_id');
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(703)) IS NULL
    OR pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(703)) = 'null'::JSONB,
  'a case with no анкета returns NULL');

-- ---------------------------------------------------------------------------
-- 5. Refusals as before.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_student', pg_temp.a334_id(701)) ->> 'error' = '42501',
  'a Student is refused');
SELECT pg_temp.a334_assert(pg_temp.a334_read(:'a334_admin', pg_temp.a334_id(799)) ->> 'error' = '42501',
  'an unknown case is refused');

-- ---------------------------------------------------------------------------
-- 6. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a334_assert((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
      AND pg_get_function_result(p.oid) = 'jsonb'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('platform.staff_student_application_for_case_v1(uuid)')),
  'STABLE, SECURITY DEFINER, empty search_path, JSONB result, authenticated and not anon');

\echo A334_INVITED_CASE_APPLICATION_READ_SUITE_PASSED
ROLLBACK;
