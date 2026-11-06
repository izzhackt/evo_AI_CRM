\set ON_ERROR_STOP on
-- Boundary suite for migration 336 «ИИ-агент видит анкету студента». Runs on the real chain right after 336 inside one transaction
-- that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. get_case with include «questionnaire» returns the анкета of the case: the ordinary approval (public_application_id), an
--     invite (invited_case_id) and an approval into the case (student_case_id); the status, the date, self_reported, the answers;
--  2. the phone and the service fields never reach the agent;
--  3. a case without an анкета returns questionnaire: null; the default sections are unchanged (no questionnaire unless asked);
--  4. the database argument check takes «questionnaire» and still refuses an unknown section (22023);
--  5. the read is audited as before (one read row per call).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A336_AI_AGENT_CASE_QUESTIONNAIRE_SUITE_START

CREATE FUNCTION pg_temp.a336_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a336_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A336: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a336_call(p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.a336_case(p_case INTEGER, p_include TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a336_call(format('SELECT platform.ai_agent_tool_get_case_v1(%L, %L, %L::jsonb)', pg_temp.a336_id(1), 'curator-my',
    format('{"case_id":"%s"%s}', pg_temp.a336_id(p_case), p_include)))
$$;
CREATE FUNCTION pg_temp.a336_questionnaire(p_first TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.a336_id(p_request), 'firstName', p_first, 'lastName', 'Тестова',
    'phone', '+996 700 000 000', 'destinationCountries', jsonb_build_array('MY'), 'intakeSeason', 'autumn', 'intakeYear', 2027,
    'educationLevel', 'high_school', 'averageGrade', 4.5, 'gradeScale', '5', 'studyFields', jsonb_build_array('Информационные технологии'),
    'studyLevels', jsonb_build_array('bachelor'), 'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'intermediate'),
    'tuitionBudget', '5000_10000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18')
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2-4 Students. Cases: 701 ordinary approval (public_application_id), 702 invite, 703 approval into the
-- case, 704 no анкета. Applications 801-803.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a336_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a336_actors VALUES (1, 'admin', TRUE), (2, 'student', FALSE), (3, 'student', FALSE), (4, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a336_id(1), 'A336 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a336_id(100 + n), 'a336-' || n || '@example.invalid', '{}'::JSONB FROM a336_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a336_id(200 + n), pg_temp.a336_id(100 + n), 'A336 Actor ' || n, 'active', 1 FROM a336_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a336_id(300 + a.n), pg_temp.a336_id(1), pg_temp.a336_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a336_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a336_id(401), pg_temp.a336_id(1), 'organization', pg_temp.a336_id(1), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, public_application_id, created_at, updated_at)
SELECT pg_temp.a336_id(700 + c.n), pg_temp.a336_id(1), c.member, pg_temp.a336_id(301), pg_temp.a336_id(301), 'a336-case-' || c.n,
  'A336 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a336_id(401), 1, 'MY', 'documents',
  CASE WHEN c.member IS NULL THEN NULL ELSE clock_timestamp() END, c.public_app, clock_timestamp(), clock_timestamp()
FROM (VALUES (1, pg_temp.a336_id(302), pg_temp.a336_id(801)), (2, pg_temp.a336_id(303), NULL::UUID), (3, pg_temp.a336_id(304), NULL::UUID),
  (4, NULL::UUID, NULL::UUID)) AS c(n, member, public_app);
INSERT INTO platform_private.student_applications (id, organization_id, auth_user_id, normalized_email, questionnaire, status, revision,
  submitted_at, decided_at, decided_by_membership_id, decision_reason, student_case_id, invited_case_id)
VALUES
  (pg_temp.a336_id(801), pg_temp.a336_id(1), pg_temp.a336_id(102), 'a336-2@example.invalid', pg_temp.a336_questionnaire('Обычная', 901),
    'approved', 2, TIMESTAMPTZ '2026-10-01 10:00:00+00', TIMESTAMPTZ '2026-10-02 10:00:00+00', pg_temp.a336_id(301), 'A336 synthetic approval',
    pg_temp.a336_id(701), NULL),
  (pg_temp.a336_id(802), pg_temp.a336_id(1), pg_temp.a336_id(103), 'a336-3@example.invalid', pg_temp.a336_questionnaire('Приглашённая', 902),
    'pending', 1, TIMESTAMPTZ '2026-11-01 10:00:00+00', NULL, NULL, NULL, NULL, pg_temp.a336_id(702)),
  (pg_temp.a336_id(803), pg_temp.a336_id(1), pg_temp.a336_id(104), 'a336-4@example.invalid', pg_temp.a336_questionnaire('Привязанная', 903),
    'approved', 2, TIMESTAMPTZ '2026-11-02 10:00:00+00', TIMESTAMPTZ '2026-11-03 10:00:00+00', pg_temp.a336_id(301), 'A336 synthetic approval',
    pg_temp.a336_id(703), NULL);
SET LOCAL session_replication_role = origin;

SELECT platform_private.ai_agents_ensure_rows(pg_temp.a336_id(1));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id = pg_temp.a336_id(1) AND key = 'curator-my';

-- ---------------------------------------------------------------------------
-- 1, 2. The анкета of each kind of case, without the phone and the service fields.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a336_case(701, ',"include":["questionnaire"]') AS a336_ordinary \gset
SELECT pg_temp.a336_assert(NOT (:'a336_ordinary'::JSONB ? 'error'), 'get_case takes the questionnaire section');
SELECT pg_temp.a336_assert(:'a336_ordinary'::JSONB #>> '{questionnaire,answers,firstName}' = 'Обычная'
    AND :'a336_ordinary'::JSONB #>> '{questionnaire,status}' = 'approved'
    AND (:'a336_ordinary'::JSONB #>> '{questionnaire,self_reported}')::BOOLEAN
    AND :'a336_ordinary'::JSONB #> '{questionnaire,submitted_at}' IS NOT NULL,
  'the ordinary approval: answers, status, date, self_reported');
SELECT pg_temp.a336_assert(NOT (:'a336_ordinary'::JSONB -> 'questionnaire' -> 'answers' ?| ARRAY['phone', 'requestId', 'consent', 'consentVersion', 'schemaVersion']),
  'no phone and no service fields');
SELECT pg_temp.a336_assert(pg_temp.a336_case(702, ',"include":["questionnaire"]') #>> '{questionnaire,answers,firstName}' = 'Приглашённая'
    AND pg_temp.a336_case(702, ',"include":["questionnaire"]') #>> '{questionnaire,status}' = 'pending',
  'the invite case: its pending анкета');
SELECT pg_temp.a336_assert(pg_temp.a336_case(703, ',"include":["questionnaire"]') #>> '{questionnaire,answers,firstName}' = 'Привязанная',
  'an approval into the case: its анкета');

-- ---------------------------------------------------------------------------
-- 3. No анкета; the default sections.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a336_assert(pg_temp.a336_case(704, ',"include":["questionnaire"]') -> 'questionnaire' = 'null'::JSONB,
  'a case without an анкета: questionnaire null');
SELECT pg_temp.a336_assert(NOT (pg_temp.a336_case(701, '') ? 'questionnaire') AND pg_temp.a336_case(701, '') ? 'tasks',
  'the default sections are unchanged');

-- ---------------------------------------------------------------------------
-- 4. The argument check; 5. the audit.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a336_assert(pg_temp.a336_case(701, ',"include":["questionnaire","secret"]') ->> 'error' = '22023',
  'an unknown section is still refused');
SELECT pg_temp.a336_assert(pg_temp.a336_case(701, ',"include":["documents","applications","payments","tasks","notes","profile","questionnaire"]') ? 'questionnaire',
  'all seven sections at once');
SELECT pg_temp.a336_assert((SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.a336_id(1)
    AND e.resource_type = 'student_case' AND e.resource_id = pg_temp.a336_id(701) AND e.action = 'ai.agent.tool.read') >= 4,
  'every read is audited');

\echo A336_AI_AGENT_CASE_QUESTIONNAIRE_SUITE_PASSED
ROLLBACK;
