\set ON_ERROR_STOP on
-- Boundary suite for migration 329 «Студент без кабинета: честный сигнал» (docs/PLAN_CHANGES.md «2026-11-02 · Студент без
-- кабинета: предупреждение и честный ответ агенту»). Runs on the real chain right after 329 inside one transaction that is
-- rolled back. No provider, no Claude call, no real person, no production action.
--
-- Proves:
--  1. the three functions keep their signature, definer, empty search_path and grants; no function is added;
--  2. the staff chat page says studentHasPortal: false with no student and with an invited, not activated one; true when activated;
--  3. get_case says student_has_portal the same way, in the case object;
--  4. send_message in the portal channel refuses no_student_portal with nothing written (no draft, no chat message) for both
--     kinds of case without a portal; a case with a portal still creates the draft as before;
--  5. a staff member may still write in the case chat of a student without a portal: the history waits for the cabinet.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A329_STUDENT_WITHOUT_PORTAL_SUITE_START

CREATE FUNCTION pg_temp.a329_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a329_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A329: %', message; END IF;
END
$$;
-- A statement as a role with the given claims: its JSONB result, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a329_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
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
CREATE FUNCTION pg_temp.a329_tool(p_tool TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a329_call('service_role', '{"role":"service_role"}',
    format('SELECT platform.ai_agent_tool_%s_v1(%L, %L, %L::jsonb)', p_tool, pg_temp.a329_id(1), 'curator-my', p_args))
$$;
CREATE FUNCTION pg_temp.a329_send(p_case INTEGER, p_key TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a329_tool('send_message', format('{"channel":"portal","case_id":"%s","text":"Напоминание о сроке","idempotency_key":"%s"}', pg_temp.a329_id(p_case), p_key))
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 Admin, 2 Student with an activated portal, 3 Student invited, not activated.
-- Cases: 701 no student, 702 not activated, 703 activated.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a329_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a329_actors VALUES (1, 'admin', TRUE), (2, 'student', FALSE), (3, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a329_id(1), 'A329 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a329_id(100 + n), 'a329-' || n || '@example.invalid', '{}'::JSONB FROM a329_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a329_id(200 + n), pg_temp.a329_id(100 + n), 'A329 Actor ' || n, 'active', 1 FROM a329_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a329_id(300 + a.n), pg_temp.a329_id(1), pg_temp.a329_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a329_actors a;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a329_id(401), pg_temp.a329_id(1), 'organization', pg_temp.a329_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a329_id(1), pg_temp.a329_id(301), pg_temp.a329_id(401), 1, 1, TRUE, 'system', 'A329 synthetic scope', pg_temp.a329_id(451));
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a329_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a329_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a329_admin \gset

SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a329_id(700 + c.n), pg_temp.a329_id(1), c.member, pg_temp.a329_id(301), pg_temp.a329_id(301), 'a329-case-' || c.n,
  'A329 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a329_id(401), 1, 'MY', 'documents',
  c.activated, clock_timestamp(), clock_timestamp()
FROM (VALUES (1, NULL::UUID, NULL::TIMESTAMPTZ), (2, pg_temp.a329_id(303), NULL), (3, pg_temp.a329_id(302), clock_timestamp())) AS c(n, member, activated);
SET LOCAL session_replication_role = origin;

SELECT platform_private.ai_agents_ensure_rows(pg_temp.a329_id(1));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id = pg_temp.a329_id(1) AND key = 'curator-my';

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a329_assert((SELECT count(*) = 3 AND bool_and(p.prosecdef) AND bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[])
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
    AND p.proname IN ('case_chat_read_page_v1', 'ai_agent_tool_get_case_v1', 'ai_agent_tool_send_message_v1')),
  'posture: the three functions stay definers with an empty search_path, closed to anon');
SELECT pg_temp.a329_assert(
  has_function_privilege('authenticated', 'platform.case_chat_read_page_v1(uuid,uuid,text,bigint)'::REGPROCEDURE, 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.ai_agent_tool_get_case_v1(uuid,text,jsonb)'::REGPROCEDURE, 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)'::REGPROCEDURE, 'EXECUTE')
  AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%') = 24,
  'posture: the grants are as they were and no tool function is added');

-- ---------------------------------------------------------------------------
-- 2. The staff chat page.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a329_page(p_claims TEXT, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a329_call('authenticated', p_claims,
    format('SELECT platform.case_chat_read_page_v1(%L, %L)', pg_temp.a329_id(1), pg_temp.a329_id(p_case)))
$$;
SELECT pg_temp.a329_assert(pg_temp.a329_page(:'a329_admin', 701) -> 'studentHasPortal' = 'false'::JSONB, 'chat page: no student');
SELECT pg_temp.a329_assert(pg_temp.a329_page(:'a329_admin', 702) -> 'studentHasPortal' = 'false'::JSONB, 'chat page: invited, not activated');
SELECT pg_temp.a329_assert(pg_temp.a329_page(:'a329_admin', 703) -> 'studentHasPortal' = 'true'::JSONB, 'chat page: activated');

-- ---------------------------------------------------------------------------
-- 3. get_case.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a329_case(p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a329_tool('get_case', format('{"case_id":"%s","include":["tasks"]}', pg_temp.a329_id(p_case)))
$$;
SELECT pg_temp.a329_assert(pg_temp.a329_case(701) #> '{case,student_has_portal}' = 'false'::JSONB, 'get_case: no student');
SELECT pg_temp.a329_assert(pg_temp.a329_case(702) #> '{case,student_has_portal}' = 'false'::JSONB, 'get_case: invited, not activated');
SELECT pg_temp.a329_assert(pg_temp.a329_case(703) #> '{case,student_has_portal}' = 'true'::JSONB, 'get_case: activated');

-- ---------------------------------------------------------------------------
-- 4. send_message.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a329_send(701, 'a329-key-one') AS a329_s1 \gset
SELECT pg_temp.a329_send(702, 'a329-key-two') AS a329_s2 \gset
SELECT pg_temp.a329_assert((:'a329_s1'::JSONB) ->> 'message' = 'no_student_portal' AND (:'a329_s1'::JSONB) ->> 'error' = '55000', 'send_message refuses with no student: ' || :'a329_s1');
SELECT pg_temp.a329_assert((:'a329_s2'::JSONB) ->> 'message' = 'no_student_portal', 'send_message refuses when not activated: ' || :'a329_s2');
SELECT pg_temp.a329_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = pg_temp.a329_id(1)
    AND d.student_case_id IN (pg_temp.a329_id(701), pg_temp.a329_id(702)))
  AND NOT EXISTS (SELECT 1 FROM platform.case_chat_messages m WHERE m.organization_id = pg_temp.a329_id(1)),
  'a refused send writes neither a draft nor a message');
SELECT pg_temp.a329_send(703, 'a329-key-three') AS a329_s3 \gset
SELECT pg_temp.a329_assert(NOT (:'a329_s3'::JSONB) ? 'error'
  AND EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = pg_temp.a329_id(1) AND d.student_case_id = pg_temp.a329_id(703)),
  'a case with a portal works as before: ' || :'a329_s3');

-- ---------------------------------------------------------------------------
-- 5. Staff may still write: the history waits for the cabinet.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a329_assert((SELECT strpos(p.prosrc, 'portal_activated_at') = 0 FROM pg_proc p
    WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'case_chat_command'),
  'the staff command of the case chat is not gated by the portal');

\echo A329_STUDENT_WITHOUT_PORTAL_SUITE_PASSED
ROLLBACK;
