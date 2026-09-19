-- OTH-5 «Переписка по делу» (per-case staff chat): the curator-facing side of
-- the owner plan's «Общения со студентом» section
-- (docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md). Architecture pattern mirrors
-- platform.team_chat_messages (141_platform_team_chat.sql) — NOT
-- platform.case_help_requests (146), which stores one question and at most
-- one answer per row and cannot carry a multi-message history.
-- platform.case_help_requests/platform_private.case_help_commands/
-- platform.case_help_workspace_v1/platform.create_case_help_request_v1/
-- platform.answer_case_help_request_v1 are all untouched by this migration.
--
-- The student side of this chat is a DECLARED, NOT-YET-BUILT dependency (a
-- separate portal/app plan). platform.current_actor_authority() already
-- returns platform_role='student' rows (155), so platform.case_chat_command
-- recognizes a student actor today and rejects them with 42501 — see the
-- one-line comment at that function's authorization gate. The "author is a
-- student" branch of the thread's await-state upsert is written now, so the
-- schema and command never need a breaking change once the student side
-- ships, but it is provably unreachable in THIS migration.
--
-- Merge-order note: this branch's base does not contain migrations 189/190
-- (sibling OTH slices, merged separately). Numbering intentionally continues
-- from 188 without renumbering; the release ledger's contiguity is restored
-- when all OTH slices land, not by this migration.
--
-- Sections:
--  a) platform.case_chat_messages + platform.case_chat_threads: append-only
--     message log / mutable per-case await-state header, on the team_chat
--     table-pair pattern.
--  b) platform_private.case_chat_receipts (idempotent replay, fingerprint
--     shape like 187's case_pipeline_requests) + case_chat_read_positions
--     (per-staff unread cursor, like team_chat_preferences.read_sequence).
--  c) platform.case_chat_command: SECURITY DEFINER write RPC — modes post /
--     set_await / read — mirroring platform.team_chat_command's structure
--     (advisory-lock order, receipt idempotency, invalidate-only realtime).
--  d) Read RPCs: platform.case_chat_read_page_v1 (thread), and
--     platform.staff_case_chat_threads_v1 (the left list).
--  e) Staff notification: staff_notifications kind CHECK extension +
--     AFTER INSERT trigger notifying the case's current curator.
--  f) platform.staff_admissions_pipeline_board_v1: CREATE OR REPLACE, adding
--     needs_reply to the existing 187 body (reconstructed verbatim from
--     187_platform_admissions_pipeline_board.sql, its only prior version).
BEGIN;

-- ---------------------------------------------------------------------------
-- a) platform.case_chat_messages + platform.case_chat_threads
-- ---------------------------------------------------------------------------
CREATE TABLE platform.case_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  student_case_id UUID NOT NULL,
  sequence_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  author_membership_id UUID NOT NULL,
  body TEXT NOT NULL,
  quoted_message_id UUID,
  attachment_kind TEXT CHECK (attachment_kind IN ('document', 'case_task')),
  attachment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, student_case_id, id),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id),
  FOREIGN KEY (organization_id, author_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  -- Same-case quote enforcement: a composite FK cannot express "same case"
  -- with a plain CHECK (a CHECK cannot join), so — exactly like team_chat's
  -- parent_message_id FK (141:23-24) — the case_id is carried in the FK
  -- itself. platform.case_chat_command still looks the quoted row up
  -- explicitly first, so a cross-case id fails with a clean 22023 instead of
  -- a raw FK-violation error code.
  FOREIGN KEY (organization_id, student_case_id, quoted_message_id)
    REFERENCES platform.case_chat_messages(organization_id, student_case_id, id),
  CHECK (id IS DISTINCT FROM quoted_message_id),
  CHECK (char_length(body) <= 8000),
  -- Deviation from a flat 1..8000 length CHECK: an attachment-only post is
  -- allowed by the plan ("«Обсудить» ... прикладывает к черновику карточку-
  -- ссылку", "Обычное поле сообщения и «Отправить»" is the default, not the
  -- only, shape) — the lower bound only applies when there is no attachment.
  -- Mirrors team_chat's own two-branch body/deleted_at CHECK (141:26-27).
  CHECK (attachment_id IS NOT NULL OR char_length(body) >= 1),
  CHECK (body !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  CHECK ((attachment_kind IS NULL) = (attachment_id IS NULL))
);
CREATE INDEX case_chat_messages_case_idx ON platform.case_chat_messages
  (organization_id, student_case_id, sequence_id DESC);
CREATE INDEX case_chat_messages_author_idx ON platform.case_chat_messages
  (organization_id, author_membership_id);
CREATE INDEX case_chat_messages_quoted_idx ON platform.case_chat_messages
  (organization_id, student_case_id, quoted_message_id) WHERE quoted_message_id IS NOT NULL;

-- Append-only: no UPDATE/DELETE/TRUNCATE, same guard style as 187's
-- case_pipeline_requests (platform_private.block_append_only_mutation, first
-- defined in 041_platform_identity_rbac_audit.sql).
CREATE TRIGGER case_chat_messages_append_only BEFORE UPDATE OR DELETE
  ON platform.case_chat_messages FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER case_chat_messages_no_truncate BEFORE TRUNCATE
  ON platform.case_chat_messages FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TABLE platform.case_chat_threads (
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  await_state TEXT NOT NULL DEFAULT 'none' CHECK (await_state IN ('none', 'needs_reply', 'awaiting_student')),
  await_set_by_membership_id UUID,
  await_set_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  last_message_sequence_id BIGINT,
  PRIMARY KEY (organization_id, student_case_id),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id),
  FOREIGN KEY (organization_id, await_set_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  CHECK ((await_set_by_membership_id IS NULL) = (await_set_at IS NULL))
);

-- ---------------------------------------------------------------------------
-- b) platform_private.case_chat_receipts + case_chat_read_positions
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.case_chat_receipts (
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, actor_membership_id, request_id),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);
CREATE TRIGGER case_chat_receipts_append_only BEFORE UPDATE OR DELETE
  ON platform_private.case_chat_receipts FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER case_chat_receipts_no_truncate BEFORE TRUNCATE
  ON platform_private.case_chat_receipts FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TABLE platform_private.case_chat_read_positions (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  last_read_sequence_id BIGINT NOT NULL DEFAULT 0 CHECK (last_read_sequence_id >= 0),
  PRIMARY KEY (organization_id, membership_id, student_case_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
);

ALTER TABLE platform.case_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.case_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.case_chat_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_chat_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_chat_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_chat_read_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_chat_read_positions FORCE ROW LEVEL SECURITY;
-- Only validated RPCs expose content; direct table access is never a client
-- surface, same posture as 141's team_chat tables and 187's private tables.
REVOKE ALL ON platform.case_chat_messages, platform.case_chat_threads,
  platform_private.case_chat_receipts, platform_private.case_chat_read_positions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON SEQUENCE platform.case_chat_messages_sequence_id_seq
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- c) platform.case_chat_command
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.case_chat_command(
  p_organization_id UUID, p_student_case_id UUID, p_request_id UUID, p_input JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; mode TEXT; allowed TEXT[]; fingerprint TEXT; prior platform_private.case_chat_receipts%ROWTYPE;
  msg platform.case_chat_messages; quoted platform.case_chat_messages; thread platform.case_chat_threads;
  body_text TEXT; attachment_kind TEXT; attachment_id UUID; quoted_id UUID;
  await_state TEXT; read_seq BIGINT; max_seq BIGINT; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  -- The student side of this chat is a separate, not-yet-built plan (see
  -- this migration's header comment); a student actor is refused here, not
  -- routed to a partial posting path.
  IF actor.platform_role = 'student' THEN
    RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_student_case_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
  END IF;
  mode := p_input ->> 'mode';
  allowed := CASE mode
    WHEN 'post' THEN ARRAY['mode', 'body', 'quotedMessageId', 'attachmentKind', 'attachmentId']
    WHEN 'set_await' THEN ARRAY['mode', 'state']
    WHEN 'read' THEN ARRAY['mode', 'sequenceId'] END;
  IF allowed IS NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) k WHERE NOT k = ANY(allowed)) THEN
    RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
  END IF;

  -- Consistent lock order: per-actor request, then per-case stream — same
  -- ordering as platform.team_chat_command (141:251-252), so a retry on a
  -- different case cannot interleave with, or duplicate, the original write.
  PERFORM pg_advisory_xact_lock(hashtextextended('case-chat-request:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('case-chat:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, 0));

  fingerprint := md5(jsonb_build_object('actor', actor.membership_id, 'case', p_student_case_id, 'input', p_input)::TEXT);
  SELECT * INTO prior FROM platform_private.case_chat_receipts r
    WHERE r.organization_id = p_organization_id AND r.actor_membership_id = actor.membership_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'case_chat_request_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN prior.receipt;
  END IF;

  -- Authorization, re-checked after the lock (mirrors team_chat_command's
  -- re-check at 141:253-255): post/set_await need case-append authority;
  -- read needs full case read.
  IF mode IN ('post', 'set_await') AND NOT platform_private.staff_can_access(
    p_organization_id, actor.membership_id, 'case.update.append', 'student_case', p_student_case_id
  ) THEN
    RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF mode = 'read' AND NOT platform_private.staff_can_access(
    p_organization_id, actor.membership_id, 'case.read.full', 'student_case', p_student_case_id
  ) THEN
    RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';
  END IF;

  IF mode = 'post' THEN
    IF p_input ? 'body' AND p_input -> 'body' IS DISTINCT FROM 'null'::JSONB THEN
      IF jsonb_typeof(p_input -> 'body') <> 'string' THEN RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023'; END IF;
      body_text := btrim(p_input ->> 'body');
      IF char_length(body_text) < 1 OR char_length(body_text) > 8000
        OR body_text ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN
        RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
      END IF;
    ELSE
      body_text := NULL;
    END IF;

    attachment_kind := NULLIF(p_input ->> 'attachmentKind', '');
    IF attachment_kind IS NOT NULL AND attachment_kind NOT IN ('document', 'case_task') THEN
      RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
    END IF;
    IF (p_input ->> 'attachmentId') IS NOT NULL THEN
      BEGIN
        attachment_id := (p_input ->> 'attachmentId')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
      END;
    ELSE
      attachment_id := NULL;
    END IF;
    IF (attachment_kind IS NULL) <> (attachment_id IS NULL) THEN
      RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
    END IF;
    IF body_text IS NULL AND attachment_id IS NULL THEN
      RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
    END IF;
    body_text := coalesce(body_text, '');

    -- Attachment must already exist, IN THIS CASE. No new-file upload path
    -- exists here at all (explicitly not agreed by the plan) — only a
    -- link-card onto an existing case document slot or case task.
    IF attachment_kind = 'document' THEN
      IF NOT EXISTS (
        SELECT 1 FROM platform.document_slots d
        WHERE d.id = attachment_id AND d.organization_id = p_organization_id AND d.student_case_id = p_student_case_id
      ) THEN RAISE EXCEPTION 'case_chat_attachment_not_found' USING ERRCODE = 'P0002'; END IF;
    ELSIF attachment_kind = 'case_task' THEN
      IF NOT EXISTS (
        SELECT 1 FROM platform.case_tasks t
        WHERE t.id = attachment_id AND t.organization_id = p_organization_id AND t.student_case_id = p_student_case_id
      ) THEN RAISE EXCEPTION 'case_chat_attachment_not_found' USING ERRCODE = 'P0002'; END IF;
    END IF;

    IF p_input ? 'quotedMessageId' AND p_input -> 'quotedMessageId' IS DISTINCT FROM 'null'::JSONB THEN
      BEGIN
        quoted_id := (p_input ->> 'quotedMessageId')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
      END;
      -- Same-case quote only: looked up explicitly (a CHECK cannot join) so
      -- a cross-case or vanished id fails P0002 (the client shows its
      -- "refresh the thread" copy) rather than a raw FK-violation code.
      SELECT * INTO quoted FROM platform.case_chat_messages m
        WHERE m.id = quoted_id AND m.organization_id = p_organization_id AND m.student_case_id = p_student_case_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'case_chat_quote_not_found' USING ERRCODE = 'P0002'; END IF;
    ELSE
      quoted_id := NULL;
    END IF;

    INSERT INTO platform.case_chat_messages
      (organization_id, student_case_id, author_membership_id, body, quoted_message_id, attachment_kind, attachment_id)
    VALUES (p_organization_id, p_student_case_id, actor.membership_id, body_text, quoted_id, attachment_kind, attachment_id)
    RETURNING * INTO msg;

    INSERT INTO platform.case_chat_threads
      (organization_id, student_case_id, last_message_at, last_message_sequence_id, await_state)
    VALUES (
      p_organization_id, p_student_case_id, msg.created_at, msg.sequence_id,
      -- Unreachable in THIS migration (students are rejected above); modeled
      -- now so the future student-posting slice needs no schema/RPC change.
      CASE WHEN actor.platform_role = 'student' THEN 'needs_reply' ELSE 'none' END
    )
    ON CONFLICT (organization_id, student_case_id) DO UPDATE SET
      last_message_at = EXCLUDED.last_message_at,
      last_message_sequence_id = EXCLUDED.last_message_sequence_id,
      await_state = CASE WHEN actor.platform_role = 'student' THEN 'needs_reply'
        ELSE platform.case_chat_threads.await_state END;

    -- No message content, author or timestamps on stale sessions — same
    -- invalidate-only broadcast team_chat uses (141:357-358).
    PERFORM realtime.send(jsonb_build_object('refresh', true), 'invalidate',
      'case-chat:' || p_organization_id::TEXT || ':' || p_student_case_id::TEXT, true);
    result := jsonb_build_object('requestId', p_request_id, 'studentCaseId', p_student_case_id,
      'mode', mode, 'messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
      'case.chat.post', 'student_case', p_student_case_id, NULL,
      jsonb_build_object('messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT), 'Case chat message posted', p_request_id);

  ELSIF mode = 'set_await' THEN
    -- Explicit action only, never implicit: ordinary sends never reach this
    -- branch, and «Ответ не требуется» always resolves to await_state='none'.
    await_state := p_input ->> 'state';
    IF await_state IS NULL OR await_state NOT IN ('none', 'needs_reply', 'awaiting_student') THEN
      RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO platform.case_chat_threads
      (organization_id, student_case_id, await_state, await_set_by_membership_id, await_set_at)
    VALUES (p_organization_id, p_student_case_id, await_state, actor.membership_id, clock_timestamp())
    ON CONFLICT (organization_id, student_case_id) DO UPDATE SET
      await_state = EXCLUDED.await_state,
      await_set_by_membership_id = EXCLUDED.await_set_by_membership_id,
      await_set_at = EXCLUDED.await_set_at
    RETURNING * INTO thread;
    result := jsonb_build_object('requestId', p_request_id, 'studentCaseId', p_student_case_id,
      'mode', mode, 'awaitState', thread.await_state);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
      'case.chat.await', 'student_case', p_student_case_id, NULL,
      jsonb_build_object('awaitState', thread.await_state), 'Case chat await mark changed', p_request_id);

  ELSE -- mode = 'read'
    -- Read alone never clears «Нужен ответ»: this branch only ever touches
    -- the CALLER's own read cursor, never platform.case_chat_threads.await_state.
    SELECT coalesce(max(m.sequence_id), 0) INTO max_seq FROM platform.case_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.student_case_id = p_student_case_id;
    IF NOT (p_input ? 'sequenceId') OR jsonb_typeof(p_input -> 'sequenceId') <> 'string'
      OR (p_input ->> 'sequenceId') !~ '^(0|[1-9][0-9]{0,18})$' THEN
      RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
    END IF;
    read_seq := least((p_input ->> 'sequenceId')::BIGINT, max_seq);
    INSERT INTO platform_private.case_chat_read_positions
      (organization_id, membership_id, student_case_id, last_read_sequence_id)
    VALUES (p_organization_id, actor.membership_id, p_student_case_id, read_seq)
    ON CONFLICT (organization_id, membership_id, student_case_id) DO UPDATE SET
      last_read_sequence_id = greatest(
        platform_private.case_chat_read_positions.last_read_sequence_id, EXCLUDED.last_read_sequence_id);
    result := jsonb_build_object('requestId', p_request_id, 'studentCaseId', p_student_case_id,
      'mode', mode, 'sequenceId', read_seq::TEXT);
  END IF;

  INSERT INTO platform_private.case_chat_receipts (organization_id, actor_membership_id, request_id, fingerprint, receipt)
    VALUES (p_organization_id, actor.membership_id, p_request_id, fingerprint, result);
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- d) Read RPCs
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.case_chat_read_page_v1(
  p_organization_id UUID, p_student_case_id UUID, p_mode TEXT DEFAULT 'latest', p_before_sequence_id BIGINT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; ids UUID[]; has_more BOOLEAN := false; next_cursor BIGINT := 0;
  rows JSONB; thread platform.case_chat_threads%ROWTYPE; read_seq BIGINT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR actor.platform_role = 'student'
    OR NOT platform_private.staff_can_access(p_organization_id, actor.membership_id, 'case.read.full', 'student_case', p_student_case_id)
  THEN RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('latest', 'before')
    OR (p_mode = 'before' AND (p_before_sequence_id IS NULL OR p_before_sequence_id < 0)) THEN
    RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(m.id ORDER BY m.sequence_id DESC) INTO ids FROM (
    SELECT m.id, m.sequence_id FROM platform.case_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.student_case_id = p_student_case_id
      AND (p_mode = 'latest' OR m.sequence_id < p_before_sequence_id)
    ORDER BY m.sequence_id DESC LIMIT 51
  ) m;
  has_more := coalesce(cardinality(ids), 0) > 50;
  ids := ids[1:50];
  SELECT coalesce(min(m.sequence_id), 0) INTO next_cursor FROM platform.case_chat_messages m WHERE m.id = ANY(ids);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'sequenceId', m.sequence_id::TEXT,
      'authorMembershipId', m.author_membership_id, 'authorName', author_profile.display_name,
      'body', m.body, 'createdAt', m.created_at,
      'quotedMessageId', m.quoted_message_id,
      'quotedPreview', CASE WHEN quoted.id IS NOT NULL THEN jsonb_build_object(
        'id', quoted.id, 'authorName', quoted_profile.display_name, 'bodyPreview', left(quoted.body, 140)
      ) ELSE NULL END,
      'attachmentKind', m.attachment_kind, 'attachmentId', m.attachment_id,
      'attachmentLabel', CASE
        WHEN m.attachment_kind = 'document' THEN document_requirement.label
        WHEN m.attachment_kind = 'case_task' THEN case_task.title
        ELSE NULL END
    ) ORDER BY m.sequence_id DESC), '[]'::JSONB)
  INTO rows
  FROM platform.case_chat_messages m
  JOIN platform.organization_memberships author_member
    ON author_member.organization_id = p_organization_id AND author_member.id = m.author_membership_id
  JOIN platform.profiles author_profile ON author_profile.id = author_member.profile_id
  LEFT JOIN platform.case_chat_messages quoted
    ON quoted.organization_id = p_organization_id AND quoted.student_case_id = p_student_case_id AND quoted.id = m.quoted_message_id
  LEFT JOIN platform.organization_memberships quoted_member
    ON quoted_member.organization_id = p_organization_id AND quoted_member.id = quoted.author_membership_id
  LEFT JOIN platform.profiles quoted_profile ON quoted_profile.id = quoted_member.profile_id
  LEFT JOIN platform.document_slots document_slot
    ON m.attachment_kind = 'document' AND document_slot.organization_id = p_organization_id AND document_slot.id = m.attachment_id
  LEFT JOIN platform.document_requirements document_requirement
    ON document_requirement.organization_id = p_organization_id AND document_requirement.id = document_slot.requirement_id
  LEFT JOIN platform.case_tasks case_task
    ON m.attachment_kind = 'case_task' AND case_task.organization_id = p_organization_id AND case_task.id = m.attachment_id
  WHERE m.organization_id = p_organization_id AND m.student_case_id = p_student_case_id AND m.id = ANY(ids);

  SELECT * INTO thread FROM platform.case_chat_threads t
    WHERE t.organization_id = p_organization_id AND t.student_case_id = p_student_case_id;
  SELECT p.last_read_sequence_id INTO read_seq FROM platform_private.case_chat_read_positions p
    WHERE p.organization_id = p_organization_id AND p.membership_id = actor.membership_id AND p.student_case_id = p_student_case_id;

  RETURN jsonb_build_object(
    'messages', rows, 'cursor', next_cursor::TEXT, 'hasMore', has_more,
    'thread', jsonb_build_object(
      'awaitState', coalesce(thread.await_state, 'none'),
      'lastMessageAt', thread.last_message_at,
      'lastMessageSequenceId', thread.last_message_sequence_id::TEXT
    ),
    'readSequenceId', coalesce(read_seq, 0)::TEXT
  );
END $$;

CREATE FUNCTION platform.staff_case_chat_threads_v1(p_query TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.platform_role = 'student' THEN
    RAISE EXCEPTION 'case_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_query IS NOT NULL AND length(p_query) > 200 THEN
    RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT
      c.id AS student_case_id, c.student_display_name,
      coalesce(t.await_state, 'none') AS await_state,
      t.last_message_at, t.last_message_sequence_id,
      last_message.body AS last_message_body, last_message.author_membership_id AS last_message_author_membership_id,
      coalesce(read_position.last_read_sequence_id, 0) AS read_sequence_id
    FROM platform.student_cases c
    LEFT JOIN platform.case_chat_threads t ON t.organization_id = c.organization_id AND t.student_case_id = c.id
    LEFT JOIN platform.case_chat_messages last_message
      ON last_message.organization_id = c.organization_id AND last_message.student_case_id = c.id
      AND last_message.sequence_id = t.last_message_sequence_id
    LEFT JOIN platform_private.case_chat_read_positions read_position
      ON read_position.organization_id = c.organization_id AND read_position.membership_id = actor.membership_id
      AND read_position.student_case_id = c.id
    WHERE c.organization_id = actor.organization_id
      AND c.state = 'active'
      -- Same visibility predicate the admissions board read uses (187's
      -- staff_admissions_pipeline_board_v1): private.platform_can_read_student_case
      -- IS platform_private.staff_can_access_for_actor(org,'case.read.full',
      -- 'student_case',id) by definition — reused through its existing
      -- wrapper, not re-implemented here.
      AND private.platform_can_read_student_case(c.organization_id, c.id)
      AND (p_query IS NULL OR btrim(p_query) = '' OR strpos(lower(c.student_display_name), lower(btrim(p_query))) > 0)
    ORDER BY t.last_message_at DESC NULLS LAST, c.id DESC
    LIMIT 201
  ), page AS (
    SELECT * FROM visible ORDER BY last_message_at DESC NULLS LAST, student_case_id DESC LIMIT 200
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'studentCaseId', page.student_case_id,
      'studentDisplayName', page.student_display_name,
      'lastMessageSnippet', CASE WHEN page.last_message_body IS NOT NULL THEN left(page.last_message_body, 120) ELSE NULL END,
      'lastMessageAt', page.last_message_at,
      'lastMessageAuthorMembershipId', page.last_message_author_membership_id,
      'awaitState', page.await_state,
      -- Unread and «Нужен ответ» are different states (owner plan): unread
      -- is purely "someone else's message past my read cursor", independent
      -- of await_state.
      'unread', page.last_message_sequence_id IS NOT NULL
        AND page.last_message_sequence_id > page.read_sequence_id
        AND page.last_message_author_membership_id IS DISTINCT FROM actor.membership_id
    ) ORDER BY page.last_message_at DESC NULLS LAST, page.student_case_id DESC) FROM page), '[]'::JSONB),
    'truncated', (SELECT count(*) FROM visible) > 200
  ) INTO result;
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- Realtime authorization: invalidate-only broadcast, same posture as 141
-- (https://supabase.com/docs/guides/realtime/authorization).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.case_chat_can_subscribe(p_topic TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.platform_role IS DISTINCT FROM 'student'
      AND split_part(p_topic, ':', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND p_topic = 'case-chat:' || a.organization_id::TEXT || ':' || split_part(p_topic, ':', 3)
      AND platform_private.staff_can_access(
        a.organization_id, a.membership_id, 'case.read.full', 'student_case', split_part(p_topic, ':', 3)::UUID)
  )
$$;
CREATE POLICY case_chat_broadcast_read ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND topic = (SELECT realtime.topic())
  AND (SELECT platform_private.case_chat_can_subscribe((SELECT realtime.topic()))));

REVOKE ALL ON FUNCTION platform_private.case_chat_can_subscribe(TEXT),
  platform.case_chat_command(UUID, UUID, UUID, JSONB),
  platform.case_chat_read_page_v1(UUID, UUID, TEXT, BIGINT),
  platform.staff_case_chat_threads_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform_private.case_chat_can_subscribe(TEXT),
  platform.case_chat_command(UUID, UUID, UUID, JSONB),
  platform.case_chat_read_page_v1(UUID, UUID, TEXT, BIGINT),
  platform.staff_case_chat_threads_v1(TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- e) Staff notification: 'case_message' kind
-- ---------------------------------------------------------------------------
-- 188 owns the CURRENT constraint names (staff_notifications_kind_check,
-- staff_notifications_check) — dropped and re-added under the SAME names,
-- extended, same convention 188 itself used against 146's originals.
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_kind_check;
ALTER TABLE platform.staff_notifications DROP CONSTRAINT staff_notifications_check;
ALTER TABLE platform.staff_notifications
  ADD CONSTRAINT staff_notifications_kind_check CHECK (kind IN (
    'task_assigned', 'task_updated', 'chat_mention', 'case_help',
    'case_task_assigned', 'task_due', 'case_message'
  )),
  ADD CONSTRAINT staff_notifications_check CHECK (
    (kind = 'case_help' AND help_request_id IS NOT NULL AND student_case_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'chat_mention' AND message_id IS NOT NULL
      AND staff_task_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind IN ('task_assigned', 'task_updated') AND staff_task_id IS NOT NULL
      AND message_id IS NULL AND help_request_id IS NULL AND student_case_id IS NULL AND case_task_id IS NULL)
    OR (kind = 'case_task_assigned' AND case_task_id IS NOT NULL AND student_case_id IS NOT NULL
      AND staff_task_id IS NULL AND message_id IS NULL AND help_request_id IS NULL)
    OR (kind = 'task_due' AND help_request_id IS NULL AND message_id IS NULL AND student_case_id IS NULL
      AND ((staff_task_id IS NOT NULL AND case_task_id IS NULL) OR (staff_task_id IS NULL AND case_task_id IS NOT NULL)))
    OR (kind = 'case_message' AND student_case_id IS NOT NULL AND actor_membership_id IS NOT NULL
      AND message_id IS NULL AND staff_task_id IS NULL AND help_request_id IS NULL AND case_task_id IS NULL)
  );

-- Ids only, no text: event_key carries the message id ('case-message:'||id),
-- never its body. Notifies the case's CURRENT curator, never the author —
-- if the author IS the current curator (self-post) or the case has none yet,
-- no row is created.
CREATE FUNCTION platform_private.notify_case_chat_message() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE curator_id UUID;
BEGIN
  SELECT c.current_curator_membership_id INTO curator_id FROM platform.student_cases c
    WHERE c.organization_id = NEW.organization_id AND c.id = NEW.student_case_id;
  IF curator_id IS NULL OR curator_id = NEW.author_membership_id THEN RETURN NEW; END IF;
  INSERT INTO platform.staff_notifications
    (organization_id, recipient_membership_id, event_key, kind, student_case_id, actor_membership_id)
  SELECT NEW.organization_id, m.id, 'case-message:' || NEW.id::TEXT, 'case_message', NEW.student_case_id, NEW.author_membership_id
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = NEW.organization_id AND m.id = curator_id AND m.status = 'active' AND p.status = 'active'
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER case_chat_message_notifications AFTER INSERT ON platform.case_chat_messages
  FOR EACH ROW EXECUTE FUNCTION platform_private.notify_case_chat_message();
REVOKE ALL ON FUNCTION platform_private.notify_case_chat_message()
  FROM PUBLIC, anon, authenticated, service_role;

-- Visibility: extend the live platform_private.staff_notification_visible
-- (188_platform_staff_notifications_v2.sql:257-279 is the current, only
-- CREATE OR REPLACE for this function — reproduced byte-for-byte below with
-- one new OR branch, same convention 188 used against 156's version).
CREATE OR REPLACE FUNCTION platform_private.staff_notification_visible(n platform.staff_notifications)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = n.organization_id AND a.membership_id = n.recipient_membership_id
      AND a.platform_role IS DISTINCT FROM 'student' AND (
        (n.staff_task_id IS NOT NULL AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'staff.task.read', 'staff_task', n.staff_task_id))
        OR (n.message_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM platform.team_chat_messages m
          WHERE m.organization_id = n.organization_id AND m.id = n.message_id
            AND m.deleted_at IS NULL AND a.membership_id = ANY(m.mentioned_membership_ids)
            AND platform_private.team_chat_can_access(n.organization_id, m.channel_key)))
        OR (n.kind = 'case_help' AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'case.read.full', 'student_case', n.student_case_id))
        OR (n.case_task_id IS NOT NULL AND n.kind IN ('case_task_assigned', 'task_due') AND EXISTS (
          SELECT 1 FROM platform.case_tasks t
          WHERE t.organization_id = n.organization_id AND t.id = n.case_task_id
            AND (t.assignee_membership_id = a.membership_id OR platform_private.staff_can_access(
              n.organization_id, a.membership_id, 'case.read.full', 'student_case', t.student_case_id))))
        OR (n.kind = 'case_message' AND platform_private.staff_can_access(
          n.organization_id, a.membership_id, 'case.read.full', 'student_case', n.student_case_id))
      )
  )
$$;

-- staff_notifications_page_v2 (188): NO CREATE OR REPLACE needed. Its
-- enrichment already builds actor_display_name generically from
-- n.actor_membership_id (188:191-195, the `WHEN n.actor_membership_id IS NOT
-- NULL THEN actor_profile.display_name` branch — true for case_message,
-- which this migration always sets) and student_display_name generically
-- from n.student_case_id (188:209-212, the `WHEN n.student_case_id IS NOT
-- NULL THEN subject_student_case.student_display_name` branch — also true
-- for case_message). subject_title stays NULL for case_message (no
-- staff_task_id/case_task_id), which is correct: a message has no title.
-- Verified by reading 188's body in this worktree; no body change made here.
--
-- staff_notifications_page (v1, 188): its kind allowlist is the hardcoded
-- literal `n.kind IN ('task_assigned','task_updated','chat_mention',
-- 'case_help')`, used identically for both the unread count and the items
-- query (188:309-310,316) — 'case_message' (like 'case_task_assigned' and
-- 'task_due' before it) is simply never selected by an OLD client polling
-- this RPC between this migration's apply and its own release. Verified by
-- reading 188's body in this worktree; zero degradation, no change made here.

-- ---------------------------------------------------------------------------
-- f) platform.staff_admissions_pipeline_board_v1: add needs_reply
-- ---------------------------------------------------------------------------
-- 187_platform_admissions_pipeline_board.sql is this function's only prior
-- version (nothing later patches it) — reconstructed verbatim below, adding
-- exactly one boolean column and its one supporting EXISTS check. Same
-- signature: CREATE OR REPLACE keeps the REVOKE/GRANT already applied by 187
-- (Postgres does not reset a function's ACL on a same-signature replace), so
-- no REVOKE/GRANT repetition is needed here.
CREATE OR REPLACE FUNCTION platform.staff_admissions_pipeline_board_v1(
  p_curator_membership_id UUID DEFAULT NULL, p_direction TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL, p_query TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; result JSONB;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(a.organization_id, 'case.read.full') THEN
    RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE = '42501';
  END IF;
  IF p_direction IS NOT NULL AND p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR', 'unknown') THEN
    RAISE EXCEPTION 'Invalid pipeline board direction filter' USING ERRCODE = '22023';
  END IF;
  IF p_country IS NOT NULL AND length(btrim(p_country)) NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Invalid pipeline board country filter' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NOT NULL AND length(p_query) > 200 THEN
    RAISE EXCEPTION 'Invalid pipeline board search text' USING ERRCODE = '22023';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT
      c.id AS student_case_id, c.student_display_name, c.target_country,
      c.current_curator_membership_id, curator_profile.display_name AS current_curator_display_name,
      c.pipeline_stage, c.updated_at,
      platform_private.admissions_attention_flags(c.id) AS flags,
      (
        SELECT app.institution_name FROM platform.university_applications app
        WHERE app.organization_id = c.organization_id AND app.student_case_id = c.id
        ORDER BY app.is_primary DESC, app.created_at DESC LIMIT 1
      ) AS primary_institution_name,
      -- OTH-5: the board's own «Нужен ответ» mark, from the per-case chat
      -- thread this migration adds. Independent of admissions_attention_flags
      -- (137/182) — conversation state never changes the admission stage.
      EXISTS (
        SELECT 1 FROM platform.case_chat_threads t
        WHERE t.organization_id = c.organization_id AND t.student_case_id = c.id AND t.await_state = 'needs_reply'
      ) AS needs_reply
    FROM platform.student_cases c
    LEFT JOIN platform.organization_memberships curator_membership
      ON curator_membership.organization_id = c.organization_id AND curator_membership.id = c.current_curator_membership_id
    LEFT JOIN platform.profiles curator_profile ON curator_profile.id = curator_membership.profile_id
    WHERE c.organization_id = a.organization_id
      AND c.state = 'active'
      AND c.pipeline_hidden_at IS NULL
      AND private.platform_can_read_student_case(c.organization_id, c.id)
      AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id = p_curator_membership_id)
      AND (p_direction IS NULL OR COALESCE(c.admissions_direction, 'unknown') = p_direction)
      AND (p_country IS NULL OR c.target_country = p_country)
      AND (p_query IS NULL OR btrim(p_query) = '' OR strpos(lower(c.student_display_name), lower(btrim(p_query))) > 0)
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT 401
  ), page AS (
    SELECT * FROM visible ORDER BY updated_at DESC, student_case_id DESC LIMIT 400
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'student_case_id', page.student_case_id,
      'student_display_name', page.student_display_name,
      'target_country', page.target_country,
      'primary_institution_name', page.primary_institution_name,
      'current_curator_membership_id', page.current_curator_membership_id,
      'current_curator_display_name', page.current_curator_display_name,
      'pipeline_stage', page.pipeline_stage,
      'awaiting_ack', 'awaiting_ack' = ANY (page.flags),
      'overdue', 'overdue' = ANY (page.flags),
      'needs_reply', page.needs_reply
    ) ORDER BY page.updated_at DESC, page.student_case_id DESC) FROM page), '[]'::JSONB),
    'truncated', (SELECT count(*) FROM visible) > 400
  ) INTO result;
  RETURN result;
END $$;

-- Admin audit journal allowlist: expose the two new actions, same
-- rename-and-replace pattern 179/181/187 use. 'case.chat.await' (not
-- 'case.chat.set_await') because platform.audit_events.action is CHECK'd
-- against '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$' — no underscores allowed;
-- the RPC's own p_input->>'mode' string stays 'set_await'.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_case_chat;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_case_chat()
      || ARRAY['case.chat.post', 'case.chat.await']::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_case_chat(),
  platform_private.p7a_safe_audit_actions()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE platform.case_chat_messages IS
  'Native per-case staff↔student chat (staff side only, OTH-5); independent from case_help_requests (Q&A) and team_chat_messages (org-wide channels). Append-only.';

NOTIFY pgrst, 'reload schema';
COMMIT;
