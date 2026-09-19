\set ON_ERROR_STOP on
-- Privilege-boundary suite for migration 191 (OTH-5 «Переписка по делу»,
-- per-case staff chat). Isolated synthetic SQL fixtures only -- no Auth
-- invitation, real customer or provider action. Style follows
-- supabase/tests/platform_pipeline_board.sql (187's own suite: the SAME
-- domain -- curator ownership of a student_case via an 'own'-scoped role) and
-- supabase/tests/platform_notifications_v2.sql (188's suite: staff_role_*
-- grant sequence, session_replication_role=replica case seeding).
BEGIN;

CREATE FUNCTION pg_temp.p191_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59191000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p191_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P191: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.p191_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p191_id(INTEGER), pg_temp.p191_assert(BOOLEAN, TEXT), pg_temp.p191_error(TEXT)
  TO authenticated, anon, service_role;

SELECT 'P191_CASE_CHAT_SUITE_START' AS p191_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization; admin (n1), curator A (n2, owns case A), curator
-- B (n3, owns case B, no access to case A), student (n4).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p191_actors(n INTEGER, role platform.business_role, claims TEXT);
INSERT INTO p191_actors(n, role) VALUES
  (1, 'admin'), (2, 'curator'), (3, 'curator'), (4, 'student');

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p191_id(1), 'P191 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p191_id(100 + n), 'p191-' || n || '@example.invalid', '{}'::JSONB FROM p191_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p191_id(200 + n), pg_temp.p191_id(100 + n), 'P191 Actor ' || n, 'active', 1 FROM p191_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p191_id(300 + n), pg_temp.p191_id(1), pg_temp.p191_id(200 + n), 'active', role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.role AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM p191_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.p191_id(301);

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p191_id(401), pg_temp.p191_id(1), 'organization', pg_temp.p191_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.p191_id(1), pg_temp.p191_id(301), pg_temp.p191_id(401), 1, 1, TRUE, 'system', 'P191 synthetic organization scope', pg_temp.p191_id(600));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES
    (pg_temp.p191_id(410), pg_temp.p191_id(1), 'student_case', pg_temp.p191_id(501), 1),
    (pg_temp.p191_id(411), pg_temp.p191_id(1), 'student_case', pg_temp.p191_id(502), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  VALUES
    (pg_temp.p191_id(1), pg_temp.p191_id(302), pg_temp.p191_id(410), 1, 1, TRUE, 'system', 'P191 curator A case scope', pg_temp.p191_id(620)),
    (pg_temp.p191_id(1), pg_temp.p191_id(303), pg_temp.p191_id(411), 1, 1, TRUE, 'system', 'P191 curator B case scope', pg_temp.p191_id(621));

SET LOCAL session_replication_role = replica;
-- Case A (501): active, curated by curator A. Case B (502): active, curated
-- by curator B -- the cross-case boundary for quote/attachment rejection.
INSERT INTO platform.student_cases(
  id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage,
  state, handoff_at, current_scope_id, current_scope_version
) VALUES
  (pg_temp.p191_id(501), pg_temp.p191_id(1), pg_temp.p191_id(301), pg_temp.p191_id(302),
    'synthetic:p191:501', 'P191 Student A', 'CZ', 'Bachelor', 'documents',
    'active', clock_timestamp(), pg_temp.p191_id(410), 1),
  (pg_temp.p191_id(502), pg_temp.p191_id(1), pg_temp.p191_id(301), pg_temp.p191_id(303),
    'synthetic:p191:502', 'P191 Student B', 'IT', 'Bachelor', 'documents',
    'active', clock_timestamp(), pg_temp.p191_id(411), 1);
SET LOCAL session_replication_role = origin;

-- One shared document requirement; one slot per case (own-case vs. other-case attachment fixtures).
INSERT INTO platform.document_requirements(
  id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, created_by_membership_id
) VALUES (
  pg_temp.p191_id(700), pg_temp.p191_id(1), 'CZ', 'Bachelor', 'general', 1,
  'passport_copy', 'P191 Копия паспорта', 'P191 synthetic requirement', pg_temp.p191_id(301)
);
INSERT INTO platform.document_slots(id, organization_id, student_case_id, requirement_id, created_by_membership_id)
  VALUES
    (pg_temp.p191_id(710), pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(700), pg_temp.p191_id(301)),
    (pg_temp.p191_id(711), pg_temp.p191_id(1), pg_temp.p191_id(502), pg_temp.p191_id(700), pg_temp.p191_id(301));

UPDATE p191_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p191_id(200 + a.n);
GRANT SELECT ON p191_actors TO authenticated;

SELECT claims AS p191_admin FROM p191_actors WHERE n = 1 \gset

-- ---------------------------------------------------------------------------
-- Grant one 'case.read.full' + 'case.update.append' role to BOTH curators at
-- 'own' scope (155/173 surface, exactly as 187's own suite does). 'own'
-- scopes to the cases the membership actually curates, which is what makes
-- curator B's negative checks below a genuine resource-scope boundary.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p191_admin';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.p191_id(1), pg_temp.p191_id(801), 0, 'create',
  jsonb_build_object(
    'label', 'P191 Curator casework',
    'description', 'Migration 191 synthetic curator casework role',
    'permissionKeys', jsonb_build_array('case.read.full', 'case.update.append', 'task.manage')
  ),
  'P191 create curator casework role', pg_temp.p191_id(811)
) AS p191_role_created \gset
SELECT platform.staff_role_impact(pg_temp.p191_id(1), pg_temp.p191_id(801), 1)
  ->> 'impactFingerprint' AS p191_role_impact \gset
SELECT platform.staff_role_publish(
  pg_temp.p191_id(1), pg_temp.p191_id(801), 1, :'p191_role_impact',
  'P191 publish curator casework role', pg_temp.p191_id(812)
) AS p191_role_published \gset
SELECT (:'p191_role_published'::JSONB ->> 'bundleId') AS p191_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p191_id(1), pg_temp.p191_id(302), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p191_id(801), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p191_id(801), 'roleVersion', 2, 'bundleId', :'p191_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P191 grant curator A casework', pg_temp.p191_id(813)
) AS p191_curator_a_granted \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p191_id(1), pg_temp.p191_id(303), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p191_id(801), 'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p191_id(801), 'roleVersion', 2, 'bundleId', :'p191_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P191 grant curator B casework', pg_temp.p191_id(814)
) AS p191_curator_b_granted \gset
RESET ROLE;

-- One case task on case A, assigned to curator A, for the attachment fixture.
SET request.jwt.claims TO :'p191_admin';
SET ROLE authenticated;
SELECT platform.create_case_task(pg_temp.p191_id(1), pg_temp.p191_id(501), 'follow_up',
  'P191 case A task', pg_temp.p191_id(302), 'normal', NULL, NULL, 'open', FALSE, 0,
  pg_temp.p191_id(815))::TEXT AS p191_task_a_created \gset
SELECT (:'p191_task_a_created'::JSONB ->> 'case_task_id')::UUID AS p191_task_a \gset
RESET ROLE;

-- The grants/task creation bump access versions: rebuild claims from live rows.
UPDATE p191_actors a SET claims = jsonb_build_object(
  'sub', p.auth_user_id, 'role', 'authenticated', 'platform_role', a.role,
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', b.id, 'platform_bundle_version', b.version
)::TEXT
FROM platform.profiles p JOIN platform.organization_memberships m ON m.profile_id = p.id
  JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
WHERE p.id = pg_temp.p191_id(200 + a.n);

SELECT claims AS p191_admin FROM p191_actors WHERE n = 1 \gset
SELECT claims AS p191_curator_a FROM p191_actors WHERE n = 2 \gset
SELECT claims AS p191_curator_b FROM p191_actors WHERE n = 3 \gset
SELECT claims AS p191_student FROM p191_actors WHERE n = 4 \gset

-- ===========================================================================
-- (1) Curator A posts on their own case. Persisted, thread updated.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(901),
  jsonb_build_object('mode', 'post', 'body', 'P191 first message', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL)
)::TEXT AS p191_post_one \gset
SELECT (:'p191_post_one'::JSONB ->> 'messageId')::UUID AS p191_message_one \gset
RESET ROLE;

SELECT pg_temp.p191_assert(
  (SELECT count(*) = 1 FROM platform.case_chat_messages WHERE id = :'p191_message_one' AND body = 'P191 first message' AND author_membership_id = pg_temp.p191_id(302)),
  'curator A''s post is persisted exactly once with its own body'
);
SELECT pg_temp.p191_assert(
  (SELECT last_message_sequence_id IS NOT NULL AND await_state = 'none' FROM platform.case_chat_threads
    WHERE organization_id = pg_temp.p191_id(1) AND student_case_id = pg_temp.p191_id(501)),
  'the thread row is upserted with the new last message and stays await_state=none for a staff post'
);
-- A staff post is never itself a notification-worthy event for its own author.
SELECT pg_temp.p191_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_notifications WHERE kind = 'case_message' AND recipient_membership_id = pg_temp.p191_id(302)),
  'the acting curator is never notified of their own message'
);

-- ===========================================================================
-- (2) Admin posts on case A -> notifies curator A (ids only, event_key carries the message id).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_admin';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(902),
  jsonb_build_object('mode', 'post', 'body', 'P191 admin message', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL)
)::TEXT AS p191_post_two \gset
SELECT (:'p191_post_two'::JSONB ->> 'messageId')::UUID AS p191_message_two \gset
RESET ROLE;

SELECT pg_temp.p191_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p191_id(1) AND kind = 'case_message'
      AND recipient_membership_id = pg_temp.p191_id(302) AND student_case_id = pg_temp.p191_id(501)
      AND actor_membership_id = pg_temp.p191_id(301) AND event_key = 'case-message:' || :'p191_message_two'),
  'an admin post notifies exactly the case''s current curator, ids only, event_key carries the message id'
);
SELECT pg_temp.p191_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_notifications WHERE kind = 'case_message' AND recipient_membership_id = pg_temp.p191_id(301)),
  'the posting admin is never notified of their own message'
);

-- ===========================================================================
-- (3) Replay: same request id, same input -> identical receipt, no second row.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p191_assert(
  platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(901),
    jsonb_build_object('mode', 'post', 'body', 'P191 first message', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL)
  ) = :'p191_post_one'::JSONB,
  'an exact replay of the same request id and input returns the identical receipt'
);
RESET ROLE;
SELECT pg_temp.p191_assert(
  (SELECT count(*) = 1 FROM platform.case_chat_messages WHERE id = :'p191_message_one'),
  'the replay never stored a second message row'
);

-- Same request id, different input -> a request conflict (40001), not a silent replay or a plain 22023.
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(901),
    jsonb_build_object('mode', 'post', 'body', 'P191 different text', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL))) = '40001',
  'reusing a request id with different input is a request conflict, not a replay'
);
-- Same request id, IDENTICAL input, but a DIFFERENT case -> also a conflict:
-- the receipt fingerprint carries the case id, so a reused id can never
-- return another case's stored receipt (coverage gap flagged in review).
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(502), pg_temp.p191_id(901),
    jsonb_build_object('mode', 'post', 'body', 'P191 first message', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL))) = '40001',
  'reusing a request id against another case conflicts instead of replaying the first case''s receipt'
);
RESET ROLE;

-- ===========================================================================
-- (4) Quote to another case's message is rejected (P0002 — not found in THIS case).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_b';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(502), pg_temp.p191_id(903),
  jsonb_build_object('mode', 'post', 'body', 'P191 case B seed message', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL)
)::TEXT AS p191_post_case_b \gset
SELECT (:'p191_post_case_b'::JSONB ->> 'messageId')::UUID AS p191_message_case_b \gset
RESET ROLE;

SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501), gen_random_uuid(),
    jsonb_build_object('mode', 'post', 'body', 'P191 quoting another case', 'quotedMessageId', :'p191_message_case_b', 'attachmentKind', NULL, 'attachmentId', NULL))) = 'P0002',
  'quoting a message from another case is rejected'
);

-- ===========================================================================
-- (5) Attachment to another case's document is rejected (P0002); attachment
-- to the caller's own case document is accepted, with its label resolved.
-- ===========================================================================
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501), gen_random_uuid(),
    jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'document', 'attachmentId', pg_temp.p191_id(711)))) = 'P0002',
  'attaching another case''s document is rejected'
);
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(904),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'document', 'attachmentId', pg_temp.p191_id(710))
)::TEXT AS p191_post_document \gset
SELECT (:'p191_post_document'::JSONB ->> 'messageId')::UUID AS p191_message_document \gset

-- Own-case task attachment is accepted too.
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(905),
  jsonb_build_object('mode', 'post', 'body', NULL, 'quotedMessageId', NULL, 'attachmentKind', 'case_task', 'attachmentId', :'p191_task_a')
)::TEXT AS p191_post_task \gset

SELECT platform.case_chat_read_page_v1(pg_temp.p191_id(1), pg_temp.p191_id(501))::TEXT AS p191_page_a \gset
RESET ROLE;

SELECT pg_temp.p191_assert(
  (SELECT item ->> 'attachmentKind' = 'document' AND item ->> 'attachmentLabel' = 'P191 Копия паспорта'
   FROM jsonb_array_elements(:'p191_page_a'::JSONB -> 'messages') item WHERE item ->> 'id' = :'p191_message_document'::TEXT),
  'a document attachment resolves the document requirement''s own label, not a raw id'
);

-- ===========================================================================
-- (6) set_await / clear round-trip: explicit action only, never implicit.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(906),
  jsonb_build_object('mode', 'set_await', 'state', 'awaiting_student'))::TEXT AS p191_await_set \gset
RESET ROLE;
SELECT pg_temp.p191_assert(
  (SELECT await_state = 'awaiting_student' AND await_set_by_membership_id = pg_temp.p191_id(302) AND await_set_at IS NOT NULL
    FROM platform.case_chat_threads WHERE organization_id = pg_temp.p191_id(1) AND student_case_id = pg_temp.p191_id(501)),
  'set_await(awaiting_student) records the state and who set it'
);
-- Ordinary sends never set "Ждём студента" implicitly (already proven in (1):
-- the thread stayed 'none' after a plain post before this explicit action).
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(907),
  jsonb_build_object('mode', 'set_await', 'state', 'none'))::TEXT AS p191_await_clear \gset
RESET ROLE;
SELECT pg_temp.p191_assert(
  (SELECT await_state = 'none' FROM platform.case_chat_threads WHERE organization_id = pg_temp.p191_id(1) AND student_case_id = pg_temp.p191_id(501)),
  '«Ответ не требуется» clears the mark back to none'
);

-- ===========================================================================
-- (7) Read cursor bump: read alone never clears an await mark (set here first
-- to prove the two are independent), and case_chat_read_page_v1 reports it.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_a';
SET LOCAL ROLE authenticated;
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(908),
  jsonb_build_object('mode', 'set_await', 'state', 'needs_reply'))::TEXT AS p191_await_needs_reply \gset
SELECT max(sequence_id)::TEXT AS p191_max_sequence FROM platform.case_chat_messages
  WHERE organization_id = pg_temp.p191_id(1) AND student_case_id = pg_temp.p191_id(501) \gset
SELECT platform.case_chat_command(pg_temp.p191_id(1), pg_temp.p191_id(501), pg_temp.p191_id(909),
  jsonb_build_object('mode', 'read', 'sequenceId', :'p191_max_sequence'))::TEXT AS p191_read_bump \gset
SELECT platform.case_chat_read_page_v1(pg_temp.p191_id(1), pg_temp.p191_id(501))::TEXT AS p191_page_after_read \gset
RESET ROLE;
SELECT pg_temp.p191_assert(
  (SELECT last_read_sequence_id::TEXT = :'p191_max_sequence' FROM platform_private.case_chat_read_positions
    WHERE organization_id = pg_temp.p191_id(1) AND membership_id = pg_temp.p191_id(302) AND student_case_id = pg_temp.p191_id(501)),
  'the read command bumps the caller''s own cursor to the requested (capped) sequence'
);
SELECT pg_temp.p191_assert(:'p191_page_after_read'::JSONB ->> 'readSequenceId' = :'p191_max_sequence', 'the read page reports the bumped cursor back');
SELECT pg_temp.p191_assert(
  (:'p191_page_after_read'::JSONB -> 'thread' ->> 'awaitState') = 'needs_reply',
  'reading alone never clears «Нужен ответ» -- only the explicit set_await action does'
);

-- ===========================================================================
-- (8) Curator B has no scope on case A: 42501 on post, and the threads list
-- excludes case A while still including their own case B.
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_curator_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501), gen_random_uuid(),
    jsonb_build_object('mode', 'post', 'body', 'P191 curator B intrusion', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL))) = '42501',
  'a curator with no scope on this case is forbidden from posting to it'
);
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_read_page_v1(%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501))) = '42501',
  'a curator with no scope on this case is forbidden from reading its page'
);
SELECT platform.staff_case_chat_threads_v1(NULL) AS p191_threads_b \gset
SELECT pg_temp.p191_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p191_threads_b'::JSONB -> 'rows') r WHERE r ->> 'studentCaseId' = pg_temp.p191_id(501)::TEXT),
  'the threads list for a curator excludes a case outside their own scope'
);
SELECT pg_temp.p191_assert(
  EXISTS (SELECT 1 FROM jsonb_array_elements(:'p191_threads_b'::JSONB -> 'rows') r WHERE r ->> 'studentCaseId' = pg_temp.p191_id(502)::TEXT),
  'the threads list for a curator still includes their own case'
);
RESET ROLE;

-- ===========================================================================
-- (9) A student is refused on every surface in THIS migration (their own
-- posting door is a separate, not-yet-built plan).
-- ===========================================================================
SET LOCAL request.jwt.claims TO :'p191_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_command(%L,%L,%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501), gen_random_uuid(),
    jsonb_build_object('mode', 'post', 'body', 'P191 student attempt', 'quotedMessageId', NULL, 'attachmentKind', NULL, 'attachmentId', NULL))) = '42501',
  'a student is refused on case_chat_command in this migration'
);
SELECT pg_temp.p191_assert(
  pg_temp.p191_error(format('SELECT platform.case_chat_read_page_v1(%L,%L)', pg_temp.p191_id(1), pg_temp.p191_id(501))) = '42501',
  'a student is refused on case_chat_read_page_v1'
);
SELECT pg_temp.p191_assert(
  pg_temp.p191_error('SELECT platform.staff_case_chat_threads_v1(NULL)') = '42501',
  'a student is refused on staff_case_chat_threads_v1'
);
RESET ROLE;

-- ===========================================================================
-- (10) Append-only guards: messages and receipts reject UPDATE/DELETE (55000,
-- the same code platform_private.block_append_only_mutation always uses).
-- ===========================================================================
SELECT pg_temp.p191_assert(pg_temp.p191_error(format('UPDATE platform.case_chat_messages SET body = %L WHERE id = %L', 'tampered', :'p191_message_one')) = '55000', 'messages are append-only against UPDATE');
SELECT pg_temp.p191_assert(pg_temp.p191_error(format('DELETE FROM platform.case_chat_messages WHERE id = %L', :'p191_message_one')) = '55000', 'messages are append-only against DELETE');
SELECT pg_temp.p191_assert(pg_temp.p191_error('UPDATE platform_private.case_chat_receipts SET fingerprint = fingerprint') = '55000', 'receipts are append-only against UPDATE');
SELECT pg_temp.p191_assert(pg_temp.p191_error('DELETE FROM platform_private.case_chat_receipts') = '55000', 'receipts are append-only against DELETE');

-- ===========================================================================
-- Final invariants (superuser; platform_private.* grants no SELECT to
-- authenticated, same placement as 187/188's own suites).
-- ===========================================================================
SELECT pg_temp.p191_assert(
  (SELECT count(*) FROM platform.case_chat_messages WHERE organization_id = pg_temp.p191_id(1) AND student_case_id = pg_temp.p191_id(501)) = 4,
  'exactly the four case-A messages this suite intentionally created exist (first, admin, document-attached, task-attached) -- the replay and every rejected attempt stored nothing'
);
SELECT pg_temp.p191_assert(
  'case.chat.post' = ANY (platform_private.p7a_safe_audit_actions()) AND 'case.chat.await' = ANY (platform_private.p7a_safe_audit_actions()),
  'both new actions are listed in the audit-search allowlist'
);

SELECT 'P191_CASE_CHAT_SUITE_PASSED' AS p191_suite_marker;

ROLLBACK;
