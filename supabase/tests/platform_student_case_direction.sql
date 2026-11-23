\set ON_ERROR_STOP on
-- Boundary suite for migration 373 «Страна своего дела для справки к документам». Runs on the real chain right after 373
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the country follows the 338 rule: admissions_direction; else target_country as a code; else the case application
--     direction; else NULL (a free-text target_country such as «Китай» is not a code, like in 338);
--  2. the student reads only their own portal cases (pending, active, closed), each with its country; a case without a
--     portal is not read; a student with two cases gets both;
--  3. staff and another student get nothing about these cases; anon may not execute the read;
--  4. posture: both functions are stable SECURITY DEFINER with an empty search_path; the rule is closed to every role.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A373_STUDENT_CASE_DIRECTION_SUITE_START

CREATE FUNCTION pg_temp.a373_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a373_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A373: %', message; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Actors: 1 admin, 2 curator, 3–9 students.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a373_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a373_actors VALUES (1, 'admin', TRUE), (2, 'curator', FALSE);
INSERT INTO a373_actors SELECT n, 'student', FALSE FROM generate_series(3, 9) n;
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a373_id(1), 'A373 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a373_id(100 + n), 'a373-' || n || '@example.invalid', '{}'::JSONB FROM a373_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a373_id(200 + n), pg_temp.a373_id(100 + n), 'A373 Actor ' || n, 'active', 1 FROM a373_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a373_id(300 + a.n), pg_temp.a373_id(1), pg_temp.a373_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a373_actors a;

SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a373_id(401), pg_temp.a373_id(1), 'organization', pg_temp.a373_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a373_id(1), pg_temp.a373_id(300 + n), pg_temp.a373_id(401), 1, 1, TRUE, 'system', 'A373 synthetic organization scope', pg_temp.a373_id(460 + n)
  FROM a373_actors;

-- Cases (n → student actor): 1 CN by direction; 2 MY from target_country code; 3 China from the application (target text
-- «Китай» is not a code); 4 CN without a portal; 5 MY closed; 6 CN and 7 MY of one student; 8 nothing known.
CREATE TEMP TABLE a373_cases(n INTEGER PRIMARY KEY, student INTEGER, target TEXT, direction TEXT, state TEXT, portal BOOLEAN);
INSERT INTO a373_cases VALUES
  (1, 3, 'CN', 'CN', 'active', TRUE),
  (2, 4, 'MY', NULL, 'active', TRUE),
  (3, 5, 'Китай', NULL, 'pending', TRUE),
  (4, 6, 'CN', 'CN', 'active', FALSE),
  (5, 7, 'MY', 'MY', 'closed', TRUE),
  (6, 8, 'CN', 'CN', 'active', TRUE),
  (7, 8, 'MY', 'MY', 'active', TRUE),
  (8, 9, NULL, NULL, 'active', TRUE);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a373_id(410 + c.n), pg_temp.a373_id(1), 'student_case', pg_temp.a373_id(800 + c.n), 1 FROM a373_cases c;
-- The portal reads a case only through the student's own case scope (platform_can_read_student_portal_case).
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a373_id(1), pg_temp.a373_id(300 + c.student), pg_temp.a373_id(410 + c.n), 1, 1, TRUE, 'system', 'A373 synthetic case scope',
    pg_temp.a373_id(480 + c.n)
  FROM a373_cases c;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a373_id(800 + c.n), pg_temp.a373_id(1), pg_temp.a373_id(300 + c.student), pg_temp.a373_id(301),
  CASE WHEN c.state = 'pending' THEN NULL ELSE pg_temp.a373_id(302) END,
  'a373-case-' || c.n, 'A373 Студент ' || c.n, c.target, 'Бакалавриат', 'Информационные технологии', 'documents',
  c.state::platform.student_case_state, CASE WHEN c.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN c.state = 'closed' THEN clock_timestamp() END, pg_temp.a373_id(410 + c.n), 1, c.direction, 'documents',
  CASE WHEN c.portal THEN clock_timestamp() END,
  TIMESTAMPTZ '2026-02-01 00:00:00+00' + c.n * INTERVAL '1 day', clock_timestamp()
FROM a373_cases c;
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id, invited_case_id, admissions_direction)
VALUES (pg_temp.a373_id(903), pg_temp.a373_id(1), pg_temp.a373_id(105), 'a373-5@example.invalid',
  jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a373_id(913), 'firstName', 'Анкетная', 'lastName', 'Тестова',
    'phone', '+996 700 000 000', 'destinationCountries', jsonb_build_array('MY'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', jsonb_build_array('Информационные технологии'),
    'studyLevels', jsonb_build_array('bachelor'), 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
  'approved', 2, TIMESTAMPTZ '2026-10-01 10:00:00+00', TIMESTAMPTZ '2026-10-02 10:00:00+00', pg_temp.a373_id(301),
  'A373 synthetic approval', pg_temp.a373_id(803), NULL, 'CN');
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 1. The 338 rule (as the database owner).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a373_assert(platform_private.student_case_direction(pg_temp.a373_id(1), pg_temp.a373_id(801)) = 'CN',
  'admissions_direction wins');
SELECT pg_temp.a373_assert(platform_private.student_case_direction(pg_temp.a373_id(1), pg_temp.a373_id(802)) = 'MY',
  'without a direction, target_country as a code');
SELECT pg_temp.a373_assert(platform_private.student_case_direction(pg_temp.a373_id(1), pg_temp.a373_id(803)) = 'CN',
  'free text is not a code: the case application decides (its questionnaire listing Malaysia does not matter)');
SELECT pg_temp.a373_assert(platform_private.student_case_direction(pg_temp.a373_id(1), pg_temp.a373_id(808)) IS NULL,
  'nothing known: NULL');
SELECT pg_temp.a373_assert(platform_private.student_case_direction(pg_temp.a373_id(2), pg_temp.a373_id(801)) IS NULL,
  'another organization: NULL');

-- ---------------------------------------------------------------------------
-- 2–3. What each actor reads.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a373_read_as(p_actor INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a373_id(100 + p_actor),
    'claims', jsonb_build_object('sub', pg_temp.a373_id(100 + p_actor), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(string_agg(right(r.student_case_id::TEXT, 3) || '=' || coalesce(r.direction, '-'), ',' ORDER BY r.student_case_id), '')
    INTO result FROM platform.student_portal_case_directions_v1() r;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END $$;

SELECT pg_temp.a373_assert(pg_temp.a373_read_as(3) = '801=CN', 'student 3 reads their China case');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(4) = '802=MY', 'student 4 reads Malaysia from the target code');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(5) = '803=CN', 'student 5 reads China from the case application, not from the questionnaire countries');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(6) = '', 'a case without a portal is not read');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(7) = '805=MY', 'a closed case is still read');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(8) = '806=CN,807=MY', 'two cases of one student: both, each with its country');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(9) = '808=-', 'an unknown country comes back as NULL');
SELECT pg_temp.a373_assert(pg_temp.a373_read_as(2) = '' AND pg_temp.a373_read_as(1) = '', 'staff read nothing through the student read');

DO $anon$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM platform.student_portal_case_directions_v1();
    RAISE EXCEPTION 'A373: anon executed the student read';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
END
$anon$;

-- ---------------------------------------------------------------------------
-- 4. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a373_assert((SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 's')
    FROM pg_catalog.pg_proc p WHERE p.oid IN (
      to_regprocedure('platform_private.student_case_direction(uuid,uuid)'),
      to_regprocedure('platform.student_portal_case_directions_v1()'))),
  'both functions are stable SECURITY DEFINER with an empty search_path');
SELECT pg_temp.a373_assert(NOT has_function_privilege('authenticated', 'platform_private.student_case_direction(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform_private.student_case_direction(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform_private.student_case_direction(uuid,uuid)', 'EXECUTE'),
  'the rule is closed to authenticated, anon and service_role');
SELECT pg_temp.a373_assert(has_function_privilege('authenticated', 'platform.student_portal_case_directions_v1()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform.student_portal_case_directions_v1()', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform.student_portal_case_directions_v1()', 'EXECUTE'),
  'only authenticated may execute the student read');

\echo A373_STUDENT_CASE_DIRECTION_SUITE_PASSED
ROLLBACK;
