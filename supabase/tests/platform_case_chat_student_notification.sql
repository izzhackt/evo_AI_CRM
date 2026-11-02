\set ON_ERROR_STOP on
-- Boundary suite for migration 330 «Студент узнаёт о новом сообщении» (docs/PLAN_CHANGES.md «2026-11-02 · Студент узнаёт о
-- новом сообщении»). Runs on the real chain right after 330 inside one transaction that is rolled back. No provider, no
-- push, no real person, no production action.
--
-- Proves:
--  1. a staff message creates one student notification with its event, without the message text;
--  2. while it is unread, a second message adds none; after it is read through the real command, a new one appears;
--  3. the message of the student notifies only the curator, never the student;
--  4. no notification for a case without a student, without an activated portal, or for a suspended student, and the
--     message itself is still saved;
--  5. the student reads it through student_portal_notifications_v2 and the bell counts it; another student does not see it;
--  6. the curator is still notified of the student's message as before;
--  7. reading the chat without the bell clears the notification, and the next message notifies again;
--  8. a message newer than the one shown stays unread; another student and Staff clear nothing;
--  9. an unread notification older than a day does not silence a new one; a fresh one does, and only one can be unread;
-- 10. the bell's read command answers normally for a row the chat has already cleared; another student is still refused;
-- 11. a task card without text rings no bell, a card with text does.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A330_CASE_CHAT_STUDENT_NOTIFICATION_SUITE_START

CREATE FUNCTION pg_temp.a330_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('33000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a330_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A330: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a330_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a330_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a330_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- A message in a case by a member: inserted as the owner, the trigger under test is what runs.
CREATE FUNCTION pg_temp.a330_post(p_case INTEGER, p_author INTEGER, p_id INTEGER) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body)
  VALUES (pg_temp.a330_id(p_id), pg_temp.a330_id(1), pg_temp.a330_id(p_case), pg_temp.a330_id(300 + p_author), 'Секретный текст сообщения');
$$;
CREATE FUNCTION pg_temp.a330_count(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.notifications n WHERE n.organization_id = pg_temp.a330_id(1) AND n.student_case_id = pg_temp.a330_id(p_case)
    AND n.category = 'case_chat.message'
$$;
-- A statement as a student with their claims: its JSONB result, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a330_as(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
-- Fixture. Actors: 1 curator (Admin), 2 Student with a portal, 3 Student invited, 4 suspended Student with a portal,
-- 5 another Student with a portal. Cases: 701 student 2, 702 no student, 703 student 3 not activated, 704 student 4, 705 student 5.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a330_actors(n INTEGER PRIMARY KEY, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a330_actors VALUES (1, 'admin', TRUE), (2, 'student', FALSE), (3, 'student', FALSE), (4, 'student', FALSE), (5, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a330_id(1), 'A330 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a330_id(100 + n), 'a330-' || n || '@example.invalid', '{}'::JSONB FROM a330_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a330_id(200 + n), pg_temp.a330_id(100 + n), 'A330 Actor ' || n, 'active', 1 FROM a330_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin, created_at)
  SELECT pg_temp.a330_id(300 + a.n), pg_temp.a330_id(1), pg_temp.a330_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1), a.sysadmin,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a330_actors a;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a330_id(401), pg_temp.a330_id(1), 'organization', pg_temp.a330_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a330_id(1), pg_temp.a330_id(300 + n), pg_temp.a330_id(401), 1, 1, TRUE, 'system', 'A330 synthetic organization scope', pg_temp.a330_id(460 + n) FROM a330_actors;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a330_id(410 + c), pg_temp.a330_id(1), 'student_case', pg_temp.a330_id(700 + c), 1 FROM generate_series(1, 5) c;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.a330_id(1), pg_temp.a330_id(300 + s.member), pg_temp.a330_id(410 + s.c), 1, 1, TRUE, 'system', 'A330 synthetic scope', pg_temp.a330_id(450 + s.c)
  FROM (VALUES (1, 2), (4, 4), (5, 5)) AS s(c, member);
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, portal_activated_at, created_at, updated_at)
SELECT pg_temp.a330_id(700 + c.n), pg_temp.a330_id(1), c.member, pg_temp.a330_id(301), pg_temp.a330_id(301), 'a330-case-' || c.n,
  'A330 Студент ' || c.n, 'Malaysia', 'bachelor', 'MY', 'documents', 'active', clock_timestamp(), pg_temp.a330_id(410 + c.n), 1, 'MY', 'documents',
  c.activated, clock_timestamp(), clock_timestamp()
FROM (VALUES (1, pg_temp.a330_id(302), clock_timestamp()), (2, NULL::UUID, NULL::TIMESTAMPTZ), (3, pg_temp.a330_id(303), NULL),
  (4, pg_temp.a330_id(304), clock_timestamp()), (5, pg_temp.a330_id(305), clock_timestamp())) AS c(n, member, activated);
SET LOCAL session_replication_role = origin;
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.a330_id(304);
SELECT pg_temp.a330_claims(2) AS a330_student \gset
SELECT pg_temp.a330_claims(5) AS a330_other \gset

-- ---------------------------------------------------------------------------
-- 1. A staff message.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a330_post(701, 1, 801);
SELECT pg_temp.a330_assert(pg_temp.a330_count(701) = 1, 'a staff message creates one student notification');
SELECT pg_temp.a330_assert((SELECT n.recipient_membership_id = pg_temp.a330_id(302) AND strpos(n.title || n.body, 'Секретный') = 0
    AND EXISTS (SELECT 1 FROM platform.notification_events e WHERE e.notification_id = n.id AND e.event_type = 'created')
  FROM platform.notifications n WHERE n.student_case_id = pg_temp.a330_id(701) AND n.category = 'case_chat.message'),
  'it goes to the student, has its event and holds no message text');

-- ---------------------------------------------------------------------------
-- 5. The student reads it; another student does not.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a330_list(p_claims TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a330_as(p_claims, 'SELECT COALESCE(jsonb_agg(to_jsonb(n)), ''[]''::JSONB) FROM platform.student_portal_notifications_v2() n')
$$;
SELECT pg_temp.a330_list(:'a330_student') AS a330_seen \gset
SELECT pg_temp.a330_assert(jsonb_array_length(:'a330_seen'::JSONB) = 1
  AND (:'a330_seen'::JSONB) -> 0 ->> 'event_code' = 'case_chat_message'
  AND (:'a330_seen'::JSONB) -> 0 ->> 'category' = 'case_chat.message'
  AND (:'a330_seen'::JSONB) -> 0 ->> 'subject_label' = 'Новое сообщение от команды EVO',
  'the student sees it in the notifications list: ' || :'a330_seen');
SELECT pg_temp.a330_assert(jsonb_array_length(pg_temp.a330_list(:'a330_other')) = 0, 'another student does not see it');

-- ---------------------------------------------------------------------------
-- 2. One notification per unread, a new one after reading.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a330_post(701, 1, 802);
SELECT pg_temp.a330_assert(pg_temp.a330_count(701) = 1, 'a second message while unread adds no notification');
SELECT (:'a330_seen'::JSONB) -> 0 ->> 'notification_id' AS a330_notification \gset
SELECT pg_temp.a330_as(:'a330_student', format('SELECT to_jsonb(r) FROM platform.mark_own_student_portal_notification_read_v2(%L, %L) r',
  :'a330_notification'::UUID, gen_random_uuid())) AS a330_mark \gset
SELECT pg_temp.a330_assert(NOT (:'a330_mark'::JSONB) ? 'error'
  AND (SELECT n.read_at IS NOT NULL FROM platform.notifications n WHERE n.id = :'a330_notification'::UUID),
  'the real read command accepts this notification: ' || :'a330_mark');
SELECT pg_temp.a330_post(701, 1, 803);
SELECT pg_temp.a330_assert(pg_temp.a330_count(701) = 2, 'after reading, a new message notifies again');

-- ---------------------------------------------------------------------------
-- 3 and 6. The student's own message.
-- ---------------------------------------------------------------------------
SELECT count(*) AS a330_staff0 FROM platform.staff_notifications s WHERE s.student_case_id = pg_temp.a330_id(701) AND s.kind = 'case_message' \gset
SELECT pg_temp.a330_post(705, 5, 804);
SELECT pg_temp.a330_assert(pg_temp.a330_count(705) = 0, 'the student''s own message does not notify the student');
SELECT pg_temp.a330_post(701, 2, 805);
SELECT pg_temp.a330_assert((SELECT count(*) = :a330_staff0 + 1 FROM platform.staff_notifications s
    WHERE s.student_case_id = pg_temp.a330_id(701) AND s.kind = 'case_message'),
  'the curator is still notified of the student''s message');

-- ---------------------------------------------------------------------------
-- 4. Nobody to notify: the message is still saved.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a330_post(702, 1, 806);
SELECT pg_temp.a330_post(703, 1, 807);
SELECT pg_temp.a330_post(704, 1, 808);
SELECT pg_temp.a330_assert(pg_temp.a330_count(702) = 0 AND pg_temp.a330_count(703) = 0 AND pg_temp.a330_count(704) = 0,
  'no notification with no student, no activated portal or a suspended student');
SELECT pg_temp.a330_assert((SELECT count(*) = 3 FROM platform.case_chat_messages m WHERE m.id IN (pg_temp.a330_id(806), pg_temp.a330_id(807), pg_temp.a330_id(808))),
  'the messages themselves are saved');

-- ---------------------------------------------------------------------------
-- 7 and 8. The student reads the chat without touching the bell.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a330_seq(p_id INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT m.sequence_id FROM platform.case_chat_messages m WHERE m.id = pg_temp.a330_id(p_id)
$$;
CREATE FUNCTION pg_temp.a330_read_chat(p_claims TEXT, p_up_to BIGINT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a330_as(p_claims, format('SELECT to_jsonb(platform.mark_own_case_chat_notifications_read_v1(%s))', p_up_to))
$$;
CREATE FUNCTION pg_temp.a330_unread(p_case INTEGER) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.notifications n WHERE n.organization_id = pg_temp.a330_id(1) AND n.student_case_id = pg_temp.a330_id(p_case)
    AND n.category = 'case_chat.message' AND n.read_at IS NULL
$$;
SELECT pg_temp.a330_post(705, 1, 810);
SELECT pg_temp.a330_post(705, 1, 811);
SELECT pg_temp.a330_assert(pg_temp.a330_count(705) = 1 AND pg_temp.a330_unread(705) = 1, 'one unread for two messages');
SELECT pg_temp.a330_read_chat(:'a330_student', pg_temp.a330_seq(811));
SELECT pg_temp.a330_assert(pg_temp.a330_unread(705) = 1, 'another student clears nothing in this case');
SELECT pg_temp.a330_claims(1) AS a330_staff \gset
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_staff', pg_temp.a330_seq(811)) ->> 'error' = '42501' AND pg_temp.a330_unread(705) = 1,
  'Staff is refused');
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_other', pg_temp.a330_seq(810) - 1) = '0'::JSONB AND pg_temp.a330_unread(705) = 1,
  'reading only older messages leaves the newer notification unread');
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_other', pg_temp.a330_seq(811)) = '1'::JSONB AND pg_temp.a330_unread(705) = 0,
  'reading the chat clears the notification without the bell');
SELECT pg_temp.a330_assert((SELECT count(*) = 1 FROM platform.notification_events e JOIN platform.notifications n ON n.id = e.notification_id
    WHERE n.student_case_id = pg_temp.a330_id(705) AND e.event_type = 'read' AND e.actor_membership_id = pg_temp.a330_id(305)),
  'the read has its event by the student');
SELECT pg_temp.a330_assert((SELECT count(*) = 1 FROM platform.audit_events a JOIN platform.notifications n ON n.id = a.resource_id
    WHERE n.student_case_id = pg_temp.a330_id(705) AND a.action = 'notification.read'), 'and its audit record');
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_other', pg_temp.a330_seq(811)) = '0'::JSONB, 'a repeat changes nothing');
SELECT pg_temp.a330_post(705, 1, 812);
SELECT pg_temp.a330_assert(pg_temp.a330_count(705) = 2 AND pg_temp.a330_unread(705) = 1,
  'read the chat without the bell: the next message notifies again');
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_other', pg_temp.a330_seq(811)) = '0'::JSONB AND pg_temp.a330_unread(705) = 1,
  'a message newer than the one shown stays unread');
SELECT pg_temp.a330_assert(pg_temp.a330_as(:'a330_other', 'SELECT to_jsonb(platform.mark_own_case_chat_notifications_read_v1(NULL))') ->> 'error' = '22023',
  'an empty position is refused');

-- ---------------------------------------------------------------------------
-- 9. A client that does not report reading, and two messages at once.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a330_post(705, 1, 813);
SELECT pg_temp.a330_assert(pg_temp.a330_count(705) = 2 AND pg_temp.a330_unread(705) = 1, 'a fresh unread still holds the next message back');
SET LOCAL session_replication_role = replica;
UPDATE platform.notifications n SET created_at = created_at - INTERVAL '25 hours'
  WHERE n.student_case_id = pg_temp.a330_id(705) AND n.category = 'case_chat.message' AND n.read_at IS NULL;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a330_post(705, 1, 814);
SELECT pg_temp.a330_assert(pg_temp.a330_count(705) = 3 AND pg_temp.a330_unread(705) = 1, 'an unread older than a day is replaced by the new message');
SELECT pg_temp.a330_assert((SELECT count(*) = 1 FROM platform.notification_events e JOIN platform.notifications n ON n.id = e.notification_id
    WHERE n.student_case_id = pg_temp.a330_id(705) AND e.event_type = 'cancelled'), 'the replaced one has its event');
DO $a330_one$
BEGIN
  INSERT INTO platform.notifications (organization_id, student_case_id, recipient_membership_id, category, title, body, dedupe_key, created_by_membership_id)
  VALUES (pg_temp.a330_id(1), pg_temp.a330_id(705), pg_temp.a330_id(305), 'case_chat.message', 'x', 'x', 'a330-second-unread', pg_temp.a330_id(301));
  RAISE EXCEPTION 'A330: a second unread notification was accepted';
EXCEPTION WHEN unique_violation THEN NULL;
END
$a330_one$;
SELECT pg_temp.a330_post(705, 5, 815);
SELECT pg_temp.a330_assert(pg_temp.a330_read_chat(:'a330_other', pg_temp.a330_seq(814)) = '1'::JSONB AND pg_temp.a330_unread(705) = 0,
  'the student''s own newer message does not hold the notification back');

-- ---------------------------------------------------------------------------
-- 10. «Отметить» in an old tab, after the chat has already cleared the row.
-- ---------------------------------------------------------------------------
SELECT n.id AS a330_cleared FROM platform.notifications n
  WHERE n.student_case_id = pg_temp.a330_id(705) AND n.category = 'case_chat.message' ORDER BY n.created_at DESC LIMIT 1 \gset
SELECT pg_temp.a330_as(:'a330_other', format('SELECT to_jsonb(r) FROM platform.mark_own_student_portal_notification_read_v2(%L, %L) r',
  :'a330_cleared'::UUID, gen_random_uuid())) AS a330_again \gset
SELECT pg_temp.a330_assert(NOT (:'a330_again'::JSONB) ? 'error' AND ((:'a330_again'::JSONB) ->> 'is_read')::BOOLEAN,
  'a read that came second answers with the same result, not an error: ' || :'a330_again');
SELECT pg_temp.a330_assert(pg_temp.a330_as(:'a330_student', format('SELECT to_jsonb(r) FROM platform.mark_own_student_portal_notification_read_v2(%L, %L) r',
  :'a330_cleared'::UUID, gen_random_uuid())) ->> 'error' = '42501', 'another student still gets a refusal');

-- ---------------------------------------------------------------------------
-- 11. A task card without text is not shown to the student, so it rings no bell; with text it does.
-- ---------------------------------------------------------------------------
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, attachment_kind, attachment_id)
VALUES (pg_temp.a330_id(816), pg_temp.a330_id(1), pg_temp.a330_id(705), pg_temp.a330_id(301), '', 'case_task', pg_temp.a330_id(900));
SELECT pg_temp.a330_assert(pg_temp.a330_unread(705) = 0, 'a task card without text rings no bell');
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, attachment_kind, attachment_id)
VALUES (pg_temp.a330_id(817), pg_temp.a330_id(1), pg_temp.a330_id(705), pg_temp.a330_id(301), 'Посмотрите задачу', 'case_task', pg_temp.a330_id(900));
SELECT pg_temp.a330_assert(pg_temp.a330_unread(705) = 1, 'a task card with text is a message');

\echo A330_CASE_CHAT_STUDENT_NOTIFICATION_SUITE_PASSED
ROLLBACK;
