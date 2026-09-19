\set ON_ERROR_STOP on
-- Privilege-boundary suite for migration 200 (PORT-5c «Сообщения по делу»,
-- студенческая сторона per-case чата поверх модели 191). Isolated synthetic
-- SQL fixtures only -- no Auth invitation, real customer or provider action.
-- Style follows supabase/tests/platform_case_chat.sql (191's own suite: the
-- staff side of the SAME tables) and platform_portal_access_tiers.sql (192:
-- the approved/assisted tier fixtures this gate builds on).
--
-- Boundary claims proven here:
--   (i)    an active-case student reads and posts their OWN thread through
--          the new portal RPCs;
--   (ii)   a student post flips the thread from the curator's explicit
--          'awaiting_student' to 'needs_reply' (the exact 191-modeled
--          semantics), without touching await_set_by/await_set_at;
--   (iii)  the post notifies the case's current curator (ids only), and the
--          curator sees the student message through THEIR existing 191 RPCs
--          (real calls: case_chat_read_page_v1, staff_case_chat_threads_v1);
--   (iv)   replaying the same request id + body returns the identical
--          receipt with no second row; the same request id with a different
--          body is PT409 (the 178/186/194 convention -- never 40001);
--   (v)    a pending-case (approved-tier) student is DENIED 42501 on both
--          portal RPCs -- «Общение» is assisted-only (plan §4, gate 192);
--   (vi)   a second active student is isolated: their page never shows case
--          A, their post lands in their own case;
--   (vii)  staff, anon and service_role are all denied on the portal RPCs;
--   (viii) body validation is 22023 (empty, too long, control characters);
--   (ix)   before-cursor pagination excludes newer messages;
--   (x)    attachment link-cards keep staff boundaries (contract 191->200 §6):
--          a case task's title NEVER reaches the student (attachmentLabel is
--          NULL while the staff 191 RPC still resolves it), a removed document
--          slot resolves to NULL (the post-192 student_portal_documents
--          semantics), a live document slot still resolves its label, and
--          over-long labels / author names are truncated SQL-side so one
--          staff row can never brick the fail-closed client parser.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p200_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('20000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p200_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P200: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.p200_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p200_id(INTEGER), pg_temp.p200_assert(BOOLEAN, TEXT), pg_temp.p200_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P200_PORTAL_CASE_CHAT_SUITE_START' AS p200_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization; admin (n1), curator (n2, curates cases A and C),
-- student A (n3, ACTIVE portal case A -- assisted), student B (n4, PENDING
-- portal case B -- approved tier), student C (n5, ACTIVE portal case C --
-- the isolation counterpart). Case shapes mirror platform_portal_access_tiers
-- (the exact 180/182/185 production shapes, replica-mode snapshots).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p200_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO p200_actors(n, role) VALUES
  (1, 'admin'), (2, 'curator'), (3, 'student'), (4, 'student'), (5, 'student');

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p200_id(1), 'P200 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p200_id(100 + n), 'p200-' || n || '@example.invalid', '{}'::JSONB FROM p200_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p200_id(200 + n), pg_temp.p200_id(100 + n), 'P200 Actor ' || n, 'active', 1 FROM p200_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.p200_id(300 + n), pg_temp.p200_id(1), pg_temp.p200_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1),
    a.role = 'admin'
  FROM p200_actors a;

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES
    (pg_temp.p200_id(2), pg_temp.p200_id(1), 'organization', pg_temp.p200_id(1), 1),
    (pg_temp.p200_id(410), pg_temp.p200_id(1), 'student_case', pg_temp.p200_id(501), 1),
    (pg_temp.p200_id(411), pg_temp.p200_id(1), 'student_case', pg_temp.p200_id(502), 1),
    (pg_temp.p200_id(412), pg_temp.p200_id(1), 'student_case', pg_temp.p200_id(503), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p200_id(1), pg_temp.p200_id(300 + n), pg_temp.p200_id(2), 1, 1, TRUE, 'system', 'P200 synthetic organization scope', pg_temp.p200_id(600 + n)
  FROM generate_series(1, 5) AS n;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  VALUES
    (pg_temp.p200_id(1), pg_temp.p200_id(302), pg_temp.p200_id(410), 1, 1, TRUE, 'system', 'P200 curator case A scope', pg_temp.p200_id(611)),
    (pg_temp.p200_id(1), pg_temp.p200_id(302), pg_temp.p200_id(412), 1, 1, TRUE, 'system', 'P200 curator case C scope', pg_temp.p200_id(612)),
    (pg_temp.p200_id(1), pg_temp.p200_id(303), pg_temp.p200_id(410), 1, 1, TRUE, 'system', 'P200 student A case scope', pg_temp.p200_id(613)),
    (pg_temp.p200_id(1), pg_temp.p200_id(304), pg_temp.p200_id(411), 1, 1, TRUE, 'system', 'P200 student B case scope', pg_temp.p200_id(614)),
    (pg_temp.p200_id(1), pg_temp.p200_id(305), pg_temp.p200_id(412), 1, 1, TRUE, 'system', 'P200 student C case scope', pg_temp.p200_id(615));

-- Already-provisioned case snapshots (the p135/p192 convention): the 042
-- BEFORE trigger forbids pre-activated inserts, so replica mode skips it
-- while every table CHECK/FK still applies.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, contract_confirmation_ref,
  contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version
) VALUES
  (pg_temp.p200_id(501), pg_temp.p200_id(1), pg_temp.p200_id(303), pg_temp.p200_id(301),
   pg_temp.p200_id(302), 'synthetic:p200:assisted-a', 'synthetic:p200:contract-a',
   clock_timestamp(), 'P200 Student A', 'China', 'Bachelor',
   'Engineering', '2027', 'approved', 'documents', 'active',
   clock_timestamp(), clock_timestamp(), pg_temp.p200_id(410), 1),
  (pg_temp.p200_id(503), pg_temp.p200_id(1), pg_temp.p200_id(305), pg_temp.p200_id(301),
   pg_temp.p200_id(302), 'synthetic:p200:assisted-c', 'synthetic:p200:contract-c',
   clock_timestamp(), 'P200 Student C', 'China', 'Bachelor',
   'Engineering', '2027', 'approved', 'documents', 'active',
   clock_timestamp(), clock_timestamp(), pg_temp.p200_id(412), 1);
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p200_id(502), pg_temp.p200_id(1), pg_temp.p200_id(304), pg_temp.p200_id(301),
  'synthetic:p200:approved-cabinet', 'P200 Student B', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p200_id(411), 1
);
SET LOCAL session_replication_role = origin;

UPDATE p200_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p200_id(200 + a.n);
GRANT SELECT ON p200_actors TO authenticated;

SELECT claims AS p200_admin FROM p200_actors WHERE n = 1 \gset

-- ---------------------------------------------------------------------------
-- Grant the curator 'case.read.full' + 'case.update.append' + 'task.manage'
-- at 'own' scope (the 155/173 surface, exactly the role 191's own suite
-- builds) so the staff-side 191 RPC calls below are REAL curator calls, not
-- admin shortcuts, and the curator can hold the (7b) task assignment.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p200_admin';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.p200_id(1), pg_temp.p200_id(801), 0, 'create',
  jsonb_build_object(
    'label', 'P200 Curator casework',
    'description', 'Migration 200 synthetic curator casework role',
    'permissionKeys', jsonb_build_array('case.read.full', 'case.update.append', 'task.manage')
  ),
  'P200 create curator casework role', pg_temp.p200_id(811)
) AS p200_role_created \gset
SELECT platform.staff_role_impact(pg_temp.p200_id(1), pg_temp.p200_id(801), 1)
  ->> 'impactFingerprint' AS p200_role_impact \gset
SELECT platform.staff_role_publish(
  pg_temp.p200_id(1), pg_temp.p200_id(801), 1, :'p200_role_impact',
  'P200 publish curator casework role', pg_temp.p200_id(812)
) AS p200_role_published \gset
SELECT (:'p200_role_published'::JSONB ->> 'bundleId') AS p200_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p200_id(1), pg_temp.p200_id(302), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p200_id(801), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p200_id(801), 'roleVersion', 2, 'bundleId', :'p200_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P200 grant curator casework', pg_temp.p200_id(813)
) AS p200_curator_granted \gset
RESET ROLE;

-- The grants bump access versions: rebuild every actor's claims from live rows.
UPDATE p200_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p200_id(200 + a.n);

SELECT claims AS p200_admin FROM p200_actors WHERE n = 1 \gset
SELECT claims AS p200_curator FROM p200_actors WHERE n = 2 \gset
SELECT claims AS p200_student_a FROM p200_actors WHERE n = 3 \gset
SELECT claims AS p200_student_b FROM p200_actors WHERE n = 4 \gset
SELECT claims AS p200_student_c FROM p200_actors WHERE n = 5 \gset

-- ===========================================================================
-- (1) Student A reads their empty thread: [], cursor 0, awaitState none.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1()::TEXT AS p200_page_empty \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (:'p200_page_empty'::JSONB -> 'messages') = '[]'::JSONB
    AND (:'p200_page_empty'::JSONB ->> 'awaitState') = 'none'
    AND (:'p200_page_empty'::JSONB ->> 'hasMore')::BOOLEAN = FALSE,
  'an assisted student reads their own empty thread honestly'
);

-- ===========================================================================
-- (2) Curator explicitly sets awaiting_student through THEIR 191 command.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(901),
  jsonb_build_object('mode', 'set_await', 'state', 'awaiting_student'))::TEXT AS p200_await_set \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT await_state = 'awaiting_student' AND await_set_by_membership_id = pg_temp.p200_id(302)
    FROM platform.case_chat_threads WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501)),
  'the curator''s explicit awaiting_student mark is recorded before the student replies'
);

-- ===========================================================================
-- (3) Student A posts: message persisted, awaiting_student -> needs_reply,
-- await_set_by/at untouched, curator notified (ids only).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_post_v1(pg_temp.p200_id(902), 'P200 здравствуйте, вопрос по документам')::TEXT AS p200_post_one \gset
RESET ROLE;
SELECT (:'p200_post_one'::JSONB ->> 'messageId')::UUID AS p200_message_one \gset

SELECT pg_temp.p200_assert(
  (SELECT count(*) = 1 FROM platform.case_chat_messages
    WHERE id = :'p200_message_one' AND organization_id = pg_temp.p200_id(1)
      AND student_case_id = pg_temp.p200_id(501) AND author_membership_id = pg_temp.p200_id(303)
      AND body = 'P200 здравствуйте, вопрос по документам'),
  'the student post is persisted exactly once in the student''s OWN case with the student as author'
);
SELECT pg_temp.p200_assert(
  (SELECT await_state = 'needs_reply'
      AND await_set_by_membership_id = pg_temp.p200_id(302) AND await_set_at IS NOT NULL
      AND last_message_sequence_id IS NOT NULL
    FROM platform.case_chat_threads WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501)),
  'a student post flips awaiting_student to needs_reply without touching the explicit await_set_by/await_set_at record'
);
SELECT pg_temp.p200_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p200_id(1) AND kind = 'case_message'
      AND recipient_membership_id = pg_temp.p200_id(302) AND student_case_id = pg_temp.p200_id(501)
      AND actor_membership_id = pg_temp.p200_id(303) AND event_key = 'case-message:' || :'p200_message_one'),
  'the student post notifies exactly the case''s current curator, ids only'
);

-- ===========================================================================
-- (4) Idempotency: same request id + same body -> identical receipt, one
-- row; same request id + different body -> PT409 (never 40001).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p200_assert(
  platform.portal_case_chat_post_v1(pg_temp.p200_id(902), 'P200 здравствуйте, вопрос по документам') = :'p200_post_one'::JSONB,
  'an exact replay of the same request id and body returns the identical receipt'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)',
    pg_temp.p200_id(902), 'P200 другой текст')) = 'PT409',
  'reusing a request id with a different body is a PT409 conflict, not a silent replay and not a retryable 40001'
);
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT count(*) = 1 FROM platform.case_chat_messages WHERE id = :'p200_message_one'),
  'the replay and the conflicting attempt never stored a second row'
);

-- ===========================================================================
-- (5) Student A's own page shows the message with mine=true; the curator
-- sees the SAME message through the existing 191 staff RPCs (real calls).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1()::TEXT AS p200_page_after_post \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT (item ->> 'mine')::BOOLEAN = TRUE AND item ->> 'authorName' = 'P200 Actor 3'
      AND item ->> 'body' = 'P200 здравствуйте, вопрос по документам'
   FROM jsonb_array_elements(:'p200_page_after_post'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_one'::TEXT),
  'the student''s own page carries the message with mine=true and the author name'
);
SELECT pg_temp.p200_assert(
  (:'p200_page_after_post'::JSONB ->> 'awaitState') = 'needs_reply',
  'the student page reports the thread state honestly after their post'
);

SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_read_page_v1(pg_temp.p200_id(1), pg_temp.p200_id(501))::TEXT AS p200_staff_page \gset
SELECT platform.staff_case_chat_threads_v1(NULL)::TEXT AS p200_staff_threads \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT item ->> 'authorName' = 'P200 Actor 3' AND item ->> 'body' = 'P200 здравствуйте, вопрос по документам'
   FROM jsonb_array_elements(:'p200_staff_page'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_one'::TEXT),
  'the curator sees the student message through the UNCHANGED 191 read RPC, author resolved'
);
SELECT pg_temp.p200_assert(
  (SELECT r ->> 'awaitState' = 'needs_reply' AND (r ->> 'unread')::BOOLEAN = TRUE
   FROM jsonb_array_elements(:'p200_staff_threads'::JSONB -> 'rows') r
   WHERE r ->> 'studentCaseId' = pg_temp.p200_id(501)::TEXT),
  'the UNCHANGED 191 threads list marks the case needs_reply and unread for the curator'
);

-- ===========================================================================
-- (6) Curator replies through 191: the state stays needs_reply (an ordinary
-- staff post never clears it -- 191's explicit-only rule), and the student
-- sees the reply with mine=false. An explicit set_await(none) then clears.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(903),
  jsonb_build_object('mode', 'post', 'body', 'P200 ответ куратора', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL)
)::TEXT AS p200_staff_reply \gset
RESET ROLE;
SELECT (:'p200_staff_reply'::JSONB ->> 'messageId')::UUID AS p200_message_reply \gset
SELECT pg_temp.p200_assert(
  (SELECT await_state = 'needs_reply' FROM platform.case_chat_threads
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501)),
  'an ordinary staff reply keeps needs_reply -- only the explicit set_await clears it (191 rule)'
);

SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1()::TEXT AS p200_page_with_reply \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT (item ->> 'mine')::BOOLEAN = FALSE AND item ->> 'authorName' = 'P200 Actor 2'
   FROM jsonb_array_elements(:'p200_page_with_reply'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_reply'::TEXT),
  'the student sees the curator reply with mine=false and the curator''s name'
);

SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(904),
  jsonb_build_object('mode', 'set_await', 'state', 'none'))::TEXT AS p200_await_cleared \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT await_state = 'none' FROM platform.case_chat_threads
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501)),
  'the explicit set_await(none) clears the mark'
);

-- ===========================================================================
-- (7) Before-cursor pagination: a page bounded by the newest sequence id
-- excludes the newest message and keeps the older one.
-- ===========================================================================
SELECT max(sequence_id)::TEXT AS p200_max_sequence FROM platform.case_chat_messages
  WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501) \gset
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1(:'p200_max_sequence'::BIGINT)::TEXT AS p200_page_before \gset
SELECT pg_temp.p200_assert(
  pg_temp.p200_error('SELECT platform.portal_case_chat_page_v1(-1)') = '22023',
  'a negative before-cursor is rejected as invalid input'
);
RESET ROLE;
SELECT pg_temp.p200_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p200_page_before'::JSONB -> 'messages') item
    WHERE item ->> 'id' = :'p200_message_reply'::TEXT)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'p200_page_before'::JSONB -> 'messages') item
    WHERE item ->> 'id' = :'p200_message_one'::TEXT),
  'the before-cursor page excludes the newest message and keeps the older one'
);

-- ===========================================================================
-- (7b) Attachment link-cards keep staff boundaries (contract 191->200 §6).
-- Fixtures: one NOT-student_visible case task on case A; three document
-- requirements (a normal label, an over-long 340-char label, and one whose
-- slot gets removed after the post). The curator attaches all four through
-- THEIR unchanged 191 command; the student read must withhold the task title
-- entirely, drop the removed slot's label, keep the live one, and truncate
-- over-long labels/author names SQL-side.
-- ===========================================================================
INSERT INTO platform.document_requirements(
  id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, created_by_membership_id
) VALUES
  (pg_temp.p200_id(700), pg_temp.p200_id(1), 'China', 'Bachelor', 'Engineering', 1,
   'p200_passport_copy', 'P200 Копия паспорта', 'P200 synthetic requirement', pg_temp.p200_id(301)),
  (pg_temp.p200_id(701), pg_temp.p200_id(1), 'China', 'Bachelor', 'Engineering', 1,
   'p200_overlong_label', 'P200 ' || repeat('x', 335), 'P200 over-long label requirement', pg_temp.p200_id(301)),
  (pg_temp.p200_id(702), pg_temp.p200_id(1), 'China', 'Bachelor', 'Engineering', 1,
   'p200_removed_slot', 'P200 Удалённое требование', 'P200 removed-slot requirement', pg_temp.p200_id(301));
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, created_by_membership_id)
  VALUES
    (pg_temp.p200_id(710), pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(700), pg_temp.p200_id(301)),
    (pg_temp.p200_id(711), pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(701), pg_temp.p200_id(301)),
    (pg_temp.p200_id(712), pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(702), pg_temp.p200_id(301));

-- The case task is deliberately student_visible = FALSE: the exact row 069/089
-- hide from the student, so a resolved title here would be a real leak.
SET LOCAL request.jwt.claims TO :'p200_admin';
SET LOCAL ROLE authenticated;
SELECT platform.create_case_task(pg_temp.p200_id(1), pg_temp.p200_id(501), 'follow_up',
  'P200 case A task', pg_temp.p200_id(302), 'normal', NULL, NULL, 'open', FALSE, 0,
  pg_temp.p200_id(906))::TEXT AS p200_task_created \gset
RESET ROLE;
SELECT (:'p200_task_created'::JSONB ->> 'case_task_id')::UUID AS p200_task_a \gset

SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(907),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'case_task', 'attachmentId', :'p200_task_a')
)::TEXT AS p200_post_task_card \gset
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(908),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'document', 'attachmentId', pg_temp.p200_id(710))
)::TEXT AS p200_post_live_doc \gset
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(909),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'document', 'attachmentId', pg_temp.p200_id(712))
)::TEXT AS p200_post_removed_doc \gset
SELECT platform.case_chat_command(pg_temp.p200_id(1), pg_temp.p200_id(501), pg_temp.p200_id(910),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'document', 'attachmentId', pg_temp.p200_id(711))
)::TEXT AS p200_post_overlong_doc \gset
RESET ROLE;
SELECT (:'p200_post_task_card'::JSONB ->> 'messageId')::UUID AS p200_message_task_card \gset
SELECT (:'p200_post_live_doc'::JSONB ->> 'messageId')::UUID AS p200_message_live_doc \gset
SELECT (:'p200_post_removed_doc'::JSONB ->> 'messageId')::UUID AS p200_message_removed_doc \gset
SELECT (:'p200_post_overlong_doc'::JSONB ->> 'messageId')::UUID AS p200_message_overlong_doc \gset

-- After the posts: remove slot 712 (the link-card now points at a removed
-- slot) and give the curator an over-long display name. Replica mode keeps
-- side-effect triggers out so no actor's access version drifts mid-suite;
-- neither row shape is otherwise CHECK-bounded (042/043) -- which is exactly
-- why the RPC truncates.
SET LOCAL session_replication_role = replica;
UPDATE platform.document_slots
  SET removed_at = clock_timestamp(), removed_by_membership_id = pg_temp.p200_id(302),
    removal_reason = 'P200 slot removed after the link-card was posted'
  WHERE id = pg_temp.p200_id(712) AND organization_id = pg_temp.p200_id(1);
UPDATE platform.profiles SET display_name = 'P200 ' || repeat('n', 245)
  WHERE id = pg_temp.p200_id(202);
SET LOCAL session_replication_role = origin;

SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1()::TEXT AS p200_page_attachments \gset
RESET ROLE;

SELECT pg_temp.p200_assert(
  (SELECT item ->> 'attachmentKind' = 'case_task' AND item -> 'attachmentLabel' = 'null'::JSONB
   FROM jsonb_array_elements(:'p200_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_task_card'::TEXT),
  'contract §6: a case task link-card reaches the student WITHOUT the task title -- attachmentLabel is NULL'
);
SELECT pg_temp.p200_assert(
  position('P200 case A task' IN :'p200_page_attachments') = 0,
  'the task title never appears anywhere in the serialized student page'
);
SELECT pg_temp.p200_assert(
  (SELECT item ->> 'attachmentLabel' = 'P200 Копия паспорта'
   FROM jsonb_array_elements(:'p200_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_live_doc'::TEXT),
  'a LIVE document slot still resolves its requirement label for the student (the withholding is task-specific, not blanket)'
);
SELECT pg_temp.p200_assert(
  (SELECT item ->> 'attachmentKind' = 'document' AND item -> 'attachmentLabel' = 'null'::JSONB
   FROM jsonb_array_elements(:'p200_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_removed_doc'::TEXT),
  'a REMOVED document slot resolves to label NULL (post-192 student_portal_documents semantics)'
);
SELECT pg_temp.p200_assert(
  (SELECT char_length(item ->> 'attachmentLabel') = 300
      AND item ->> 'attachmentLabel' = left('P200 ' || repeat('x', 335), 300)
   FROM jsonb_array_elements(:'p200_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_overlong_doc'::TEXT),
  'an over-long document label is truncated to 300 characters SQL-side, inside the strict client parser cap'
);
SELECT pg_temp.p200_assert(
  (SELECT char_length(item ->> 'authorName') = 200
   FROM jsonb_array_elements(:'p200_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_task_card'::TEXT),
  'an over-long author display name is truncated to 200 characters SQL-side'
);

-- Discriminating counterpart: the SAME task message through the curator's
-- UNCHANGED 191 read RPC still resolves the title -- the data exists, and
-- only the portal RPC withholds it.
SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_read_page_v1(pg_temp.p200_id(1), pg_temp.p200_id(501))::TEXT AS p200_staff_page_attachments \gset
RESET ROLE;
SELECT pg_temp.p200_assert(
  (SELECT item ->> 'attachmentKind' = 'case_task' AND item ->> 'attachmentLabel' = 'P200 case A task'
   FROM jsonb_array_elements(:'p200_staff_page_attachments'::JSONB -> 'messages') item
   WHERE item ->> 'id' = :'p200_message_task_card'::TEXT),
  'the staff 191 RPC still resolves the SAME task card''s title -- the portal withholding is a boundary, not missing data'
);

-- ===========================================================================
-- (8) A pending-case (approved-tier) student is denied on BOTH portal RPCs:
-- «Общение» belongs to сопровождение (plan §4, the 192 gate).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error('SELECT platform.portal_case_chat_page_v1()') = '42501',
  'a pending-case student is denied the thread read'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)',
    gen_random_uuid(), 'P200 pending attempt')) = '42501',
  'a pending-case student is denied posting'
);
RESET ROLE;

-- ===========================================================================
-- (9) A second active student is isolated: their page never shows case A,
-- their post lands in their OWN case and notifies its curator.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_c';
SET LOCAL ROLE authenticated;
SELECT platform.portal_case_chat_page_v1()::TEXT AS p200_page_c_before \gset
SELECT platform.portal_case_chat_post_v1(pg_temp.p200_id(905), 'P200 сообщение студента C')::TEXT AS p200_post_c \gset
RESET ROLE;
SELECT (:'p200_post_c'::JSONB ->> 'messageId')::UUID AS p200_message_c \gset
SELECT pg_temp.p200_assert(
  (:'p200_page_c_before'::JSONB -> 'messages') = '[]'::JSONB,
  'student C''s thread never shows case A''s conversation'
);
SELECT pg_temp.p200_assert(
  (SELECT count(*) = 1 FROM platform.case_chat_messages
    WHERE id = :'p200_message_c' AND student_case_id = pg_temp.p200_id(503)
      AND author_membership_id = pg_temp.p200_id(305)),
  'student C''s post lands in their OWN case, never in case A'
);
SELECT pg_temp.p200_assert(
  (SELECT await_state = 'needs_reply' FROM platform.case_chat_threads
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(503)),
  'student C''s own thread is marked needs_reply by their post'
);

-- ===========================================================================
-- (10) Staff, anon and service_role are denied on the portal RPCs.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_curator';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error('SELECT platform.portal_case_chat_page_v1()') = '42501',
  'a curator is denied the STUDENT portal read RPC'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)',
    gen_random_uuid(), 'P200 staff attempt')) = '42501',
  'a curator is denied the STUDENT portal post RPC'
);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p200_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error('SELECT platform.portal_case_chat_page_v1()') = '42501',
  'an admin is denied the STUDENT portal read RPC'
);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error('SELECT platform.portal_case_chat_page_v1()') = '42501',
  'anon is denied the portal read RPC (no EXECUTE grant)'
);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)',
    gen_random_uuid(), 'P200 service attempt')) = '42501',
  'service_role is denied the portal post RPC (no EXECUTE grant)'
);
RESET ROLE;

-- ===========================================================================
-- (11) Body validation is 22023: empty, whitespace-only, too long, control
-- characters; a NULL request id is 22023 too.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p200_student_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)', gen_random_uuid(), '')) = '22023',
  'an empty body is rejected'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)', gen_random_uuid(), '   ')) = '22023',
  'a whitespace-only body is rejected'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)', gen_random_uuid(), repeat('a', 2001))) = '22023',
  'a body over 2000 characters is rejected'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(%L, %L)', gen_random_uuid(), 'P200 ' || chr(7))) = '22023',
  'control characters are rejected'
);
SELECT pg_temp.p200_assert(
  pg_temp.p200_error(format('SELECT platform.portal_case_chat_post_v1(NULL, %L)', 'P200 без request id')) = '22023',
  'a NULL request id is rejected'
);
RESET ROLE;

-- ===========================================================================
-- Final invariants (superuser): exactly the messages this suite intentionally
-- created exist -- every rejected attempt stored nothing.
-- ===========================================================================
SELECT pg_temp.p200_assert(
  (SELECT count(*) FROM platform.case_chat_messages
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(501)) = 6,
  'case A holds exactly the student post, the curator reply and the four (7b) attachment link-cards'
);
SELECT pg_temp.p200_assert(
  (SELECT count(*) FROM platform.case_chat_messages
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(503)) = 1,
  'case C holds exactly student C''s own post'
);
SELECT pg_temp.p200_assert(
  (SELECT count(*) FROM platform.case_chat_messages
    WHERE organization_id = pg_temp.p200_id(1) AND student_case_id = pg_temp.p200_id(502)) = 0,
  'the pending case B never received a message'
);

SELECT 'P200_PORTAL_CASE_CHAT_SUITE_PASSED' AS p200_suite_marker;

ROLLBACK;
