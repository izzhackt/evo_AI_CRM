\set ON_ERROR_STOP on
-- Boundary suite for migration 331 «Чтение чата снимает уведомление только своего дела» (issue #1331). Runs on the real chain
-- right after 331 inside one transaction that is rolled back. Synthetic data only; no provider, no push, no real person, no
-- production action.
--
-- Proves:
--  1. a student with two portal cases: reading the chat clears nothing (before 331 the one call cleared both cases'
--     notifications, the message position of one case closed the other), refused with 42501 as the chat page itself is;
--  2. once the second case is no longer a portal case, the same call clears the notification of the single remaining case and
--     leaves the other one unread, with no event or audit row for it;
--  3. a student with one case: older messages leave it unread, the newest clears it with its event and audit row, a repeat
--     changes nothing, and another student's notification is never touched;
--  4. a student without a portal case and Staff are refused 42501, an empty position 22023;
--  5. the posture is as in 330: SECURITY DEFINER, search_path '', INTEGER result, authenticated only.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A331_CASE_CHAT_READ_SCOPE_SUITE_START

CREATE FUNCTION pg_temp.a331_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a331_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A331: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a331_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a331_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a331_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- A message in a case by a member: inserted as the owner, the trigger under test is what runs.
CREATE FUNCTION pg_temp.a331_post(p_case INTEGER, p_author INTEGER, p_id INTEGER) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body)
  VALUES (pg_temp.a331_id(p_id), pg_temp.a331_id(1), pg_temp.a331_id(p_case), pg_temp.a331_id(300 + p_author), 'Секретный текст сообщения');
$$;
CREATE FUNCTION pg_temp.a331_count(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.notifications n WHERE n.organization_id = pg_temp.a331_id(1) AND n.student_case_id = pg_temp.a331_id(p_case)
    AND n.category = 'case_chat.message'
$$;
-- A statement as a student with their claims: its JSONB result, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a331_as(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
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

-- ---------------------------------------------------------------------------
-- Fixture. Actors: 1 curator (Admin), 2 Student with two portal cases, 3 Student with one case, 4 Student with no case.
-- Cases: 701 and 702 student 2, 703 student 3.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a331_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a331_actors VALUES (1, 'admin', TRUE), (2, 'student', FALSE), (3, 'student', FALSE), (4, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a331_id(1), 'A331 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a331_id(100 + n), 'a331-' || n || '@example.invalid', '{}'::JSONB FROM a331_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a331_id(200 + n), pg_temp.a331_id(100 + n), 'A331 Actor ' || n, 'active', 1 FROM a331_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a331_id(300 + a.n), pg_temp.a331_id(1), pg_temp.a331_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a331_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a331_id(401), pg_temp.a331_id(1), 'organization', pg_temp.a331_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a331_id(1), pg_temp.a331_id(300 + n), pg_temp.a331_id(401), 1, 1, TRUE, 'system', 'A331 synthetic organization scope', pg_temp.a331_id(460 + n) FROM a331_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a331_id(410 + c), pg_temp.a331_id(1), 'student_case', pg_temp.a331_id(700 + c), 1 FROM generate_series(1, 3) c;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a331_id(1), pg_temp.a331_id(300 + s.member), pg_temp.a331_id(410 + s.c), 1, 1, TRUE, 'system', 'A331 synthetic scope', pg_temp.a331_id(450 + s.c)
  FROM (VALUES (1, 2), (2, 2), (3, 3)) AS s(c, member);
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a331_id(700 + c.n), pg_temp.a331_id(1), c.member, pg_temp.a331_id(301), pg_temp.a331_id(301), 'a331-case-' || c.n,
  'A331 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a331_id(410 + c.n), 1, 'MY', 'documents',
  clock_timestamp(), clock_timestamp(), clock_timestamp()
FROM (VALUES (1, pg_temp.a331_id(302)), (2, pg_temp.a331_id(302)), (3, pg_temp.a331_id(303))) AS c(n, member);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a331_claims(2) AS a331_two_cases \gset
SELECT pg_temp.a331_claims(3) AS a331_one_case \gset
SELECT pg_temp.a331_claims(4) AS a331_no_case \gset
SELECT pg_temp.a331_claims(1) AS a331_staff \gset

CREATE FUNCTION pg_temp.a331_seq(p_id INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT m.sequence_id FROM platform.case_chat_messages m WHERE m.id = pg_temp.a331_id(p_id)
$$;
CREATE FUNCTION pg_temp.a331_read_chat(p_claims TEXT, p_up_to BIGINT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a331_as(p_claims, format('SELECT to_jsonb(platform.mark_own_case_chat_notifications_read_v1(%s))', p_up_to))
$$;
CREATE FUNCTION pg_temp.a331_unread(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.notifications n WHERE n.organization_id = pg_temp.a331_id(1) AND n.student_case_id = pg_temp.a331_id(p_case)
    AND n.category = 'case_chat.message' AND n.read_at IS NULL
$$;
CREATE FUNCTION pg_temp.a331_reads(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT (SELECT count(*) FROM platform.notification_events e WHERE e.student_case_id = pg_temp.a331_id(p_case) AND e.event_type = 'read')
    + (SELECT count(*) FROM platform.audit_events a JOIN platform.notifications n ON n.id = a.resource_id
        WHERE n.student_case_id = pg_temp.a331_id(p_case) AND a.action = 'notification.read')
$$;

-- ---------------------------------------------------------------------------
-- 1. Two portal cases of one student: a message in case 702 first, then in case 701 (the sequence runs across all cases).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a331_post(702, 1, 811);
SELECT pg_temp.a331_post(701, 1, 812);
SELECT pg_temp.a331_assert(pg_temp.a331_unread(701) = 1 AND pg_temp.a331_unread(702) = 1, 'both cases hold one unread notification');
SELECT pg_temp.a331_assert(pg_temp.a331_seq(812) > pg_temp.a331_seq(811), 'the later message of the other case has a larger position');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_two_cases', pg_temp.a331_seq(812)) ->> 'error' = '42501'
  AND pg_temp.a331_unread(701) = 1 AND pg_temp.a331_unread(702) = 1 AND pg_temp.a331_reads(701) = 0 AND pg_temp.a331_reads(702) = 0,
  'with two portal cases the read is refused and clears neither notification');

-- ---------------------------------------------------------------------------
-- 2. Case 702 stops being a portal case: the call is for case 701 and touches only it.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET portal_activated_at = NULL WHERE id = pg_temp.a331_id(702);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_two_cases', pg_temp.a331_seq(811) - 1) = '0'::JSONB AND pg_temp.a331_unread(701) = 1,
  'a position before the newest message of the case leaves it unread');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_two_cases', pg_temp.a331_seq(812)) = '1'::JSONB
  AND pg_temp.a331_unread(701) = 0 AND pg_temp.a331_unread(702) = 1 AND pg_temp.a331_reads(701) = 2 AND pg_temp.a331_reads(702) = 0,
  'the read clears the notification of the one case, the other stays unread with no event or audit row');

-- ---------------------------------------------------------------------------
-- 3. A student with one case.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a331_post(703, 1, 813);
SELECT pg_temp.a331_post(703, 1, 814);
SELECT pg_temp.a331_assert(pg_temp.a331_unread(703) = 1, 'one unread for two messages');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_one_case', pg_temp.a331_seq(814) - 1) = '0'::JSONB AND pg_temp.a331_unread(703) = 1,
  'older messages leave it unread');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_one_case', pg_temp.a331_seq(814)) = '1'::JSONB
  AND pg_temp.a331_unread(703) = 0 AND pg_temp.a331_reads(703) = 2 AND pg_temp.a331_unread(702) = 1,
  'the newest message clears it, with its event and audit row, and no other notification is touched');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_one_case', pg_temp.a331_seq(814)) = '0'::JSONB AND pg_temp.a331_reads(703) = 2,
  'a repeat changes nothing');
SELECT pg_temp.a331_post(703, 1, 815);
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_two_cases', pg_temp.a331_seq(815)) = '0'::JSONB AND pg_temp.a331_unread(703) = 1,
  'another student reading the newest position of this case clears nothing in it');

-- ---------------------------------------------------------------------------
-- 4. Refusals.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_no_case', pg_temp.a331_seq(815)) ->> 'error' = '42501', 'a student without a portal case is refused');
SELECT pg_temp.a331_assert(pg_temp.a331_read_chat(:'a331_staff', pg_temp.a331_seq(815)) ->> 'error' = '42501' AND pg_temp.a331_unread(703) = 1, 'Staff is refused');
SELECT pg_temp.a331_assert(pg_temp.a331_as(:'a331_one_case', 'SELECT to_jsonb(platform.mark_own_case_chat_notifications_read_v1(NULL))') ->> 'error' = '22023',
  'an empty position is refused');
SELECT pg_temp.a331_assert(pg_temp.a331_as(:'a331_one_case', 'SELECT to_jsonb(platform.mark_own_case_chat_notifications_read_v1(-1))') ->> 'error' = '22023',
  'a negative position is refused');

-- ---------------------------------------------------------------------------
-- 5. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a331_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_function_result(p.oid) = 'integer'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('platform.mark_own_case_chat_notifications_read_v1(bigint)')),
  'SECURITY DEFINER, empty search_path, INTEGER result, authenticated only');

\echo A331_CASE_CHAT_READ_SCOPE_SUITE_PASSED
ROLLBACK;
