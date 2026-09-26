-- «Требуют действия» и «Ждём студента» по правде (решение владельца 26.09.2026).
-- docs/PLAN_CHANGES.md «2026-09-26 — Дело студента: сначала работа;
-- «Требуют действия» и «Ждём студента» по правде (миграция 244)» and
-- «2026-09-26 — Дело студента: номер миграции 244 → 245» (243 and 244 were
-- taken by #1064 and #1065 before this slice merged).
--
-- Why (26.09 read-only audit, UXADMISSIONS):
--  * «Студенты» → «Требуют действия» counted only overdue | awaiting_ack |
--    needs_curator (241:120, 242:38). An active case with no next step («Шаг
--    не задан») and a case whose student wrote and waits for an answer were
--    real work that the tab never showed.
--  * A staff post in the case chat kept the thread's await_state (191:305
--    `ELSE platform.case_chat_threads.await_state`), so «Нужен ответ» stayed
--    red after the curator had answered.
--
-- Owner decisions 26.09: «Требуют действия» also counts «нет шага» and «нужен
-- ответ»; a staff reply sets «Ждём студента» automatically; a student post
-- keeps setting «Нужен ответ».
--
-- Forward-only, on the LATEST definitions: the queue page and counts reads
-- as 241 + 242 + 244 left them (244 replaced only their coarse-role gate;
-- 243 changed a different function), and
-- platform.case_chat_command as 191 left it (200 added the separate student
-- RPC platform.portal_case_chat_post_v1 and did not touch this command; 234
-- added staff_case_chat_threads_v2 only). No signature, owner, grant or
-- error code changes; SECURITY DEFINER with search_path = '' throughout.
--
--  a) platform_private.case_needs_reply(org, case): the case chat thread
--     waits for a staff answer (await_state = 'needs_reply'). SECURITY
--     DEFINER, no grants: only the SECURITY DEFINER reads below call it,
--     after their own row visibility check.
--  b) platform_private.case_queue_flags(case): the attention flags of 182
--     plus two queue-only signals — 'no_step' (state 'active' and
--     next_action NULL or blank) and 'needs_reply' (state active or pending
--     and (a)). admissions_attention_flags itself is NOT changed: the board,
--     the direction summary, the directory and the case header keep their
--     meaning, and the attention_flags a row returns stay exactly 182's.
--  c) platform_private.case_queue_in_view: needs_action also matches
--     'no_step' and 'needs_reply'. It is the one predicate both reads use,
--     so the tab number is still the count of the rows its click shows.
--  d) platform.staff_student_case_queue_v1 and
--     platform.staff_student_case_queue_counts_v1: the view flags come from
--     (b) instead of 182 (self-verifying anchor replace, the 182/241/242/244
--     pattern: exactly one old anchor before, exactly one new after); each
--     page row also returns 'needs_reply' (boolean) for «Сигналы». The
--     previous client ignores the new key; the counts payload keeps its
--     exact key set. Row visibility (private.platform_can_read_student_case)
--     and the read gate are unchanged — the chat state of a visible case is
--     readable to everyone who can read the case (case_chat_read_page_v1
--     needs the same case.read.full).
--  e) platform.case_chat_command, mode 'post': a staff post sets
--     await_state = 'awaiting_student' with await_set_by_membership_id and
--     await_set_at (the thread CHECK keeps the pair together), unless the
--     same command carries an explicit 'state' ('none' | 'needs_reply' |
--     'awaiting_student'), which then wins. The key is optional and new:
--     current clients never send it. The fingerprint already covers the
--     whole input, so an exact replay returns the first receipt without a
--     second message or state change, and a different payload under the same
--     request id stays 40001. The student branch of this command stays
--     unreachable (students are refused at its gate; their posts go through
--     portal_case_chat_post_v1, which keeps setting 'needs_reply').
--
-- Release: apply through evo-schema-ledger.yml after 243 and 244 and before
-- the release that ships the code reading 'needs_reply'.
BEGIN;

-- ---------------------------------------------------------------------------
-- a) The case chat waits for a staff answer
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.case_needs_reply(p_organization_id UUID, p_student_case_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.case_chat_threads AS t
    WHERE t.organization_id = p_organization_id AND t.student_case_id = p_student_case_id
      AND t.await_state = 'needs_reply')
$$;

-- ---------------------------------------------------------------------------
-- b) Queue flags: 182's attention flags plus 'no_step' and 'needs_reply'
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.case_queue_flags(p_case_id UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c platform.student_cases%ROWTYPE;
  flags TEXT[];
BEGIN
  SELECT * INTO STRICT c FROM platform.student_cases WHERE id = p_case_id;
  flags := platform_private.admissions_attention_flags(c.id);
  IF c.state = 'active' AND NULLIF(btrim(c.next_action), '') IS NULL THEN
    flags := array_append(flags, 'no_step');
  END IF;
  IF c.state IN ('active', 'pending') AND platform_private.case_needs_reply(c.organization_id, c.id) THEN
    flags := array_append(flags, 'needs_reply');
  END IF;
  RETURN flags;
END
$$;

REVOKE ALL ON FUNCTION platform_private.case_needs_reply(UUID, UUID),
  platform_private.case_queue_flags(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- c) «Требуют действия» matches the two new signals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.case_queue_in_view(
  p_view TEXT, p_state platform.student_case_state, p_is_mine BOOLEAN, p_flags TEXT[]
) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_view
    WHEN 'mine' THEN p_state = 'active' AND COALESCE(p_is_mine, FALSE)
    WHEN 'needs_action' THEN COALESCE(p_flags && ARRAY['overdue', 'awaiting_ack', 'needs_curator', 'no_step', 'needs_reply']::TEXT[], FALSE)
    WHEN 'active' THEN p_state = 'active'
    WHEN 'needs_curator' THEN COALESCE('needs_curator' = ANY (p_flags), FALSE)
    WHEN 'closed' THEN p_state = 'closed'
    WHEN 'pending' THEN p_state = 'pending'
    ELSE FALSE
  END
$$;

-- ---------------------------------------------------------------------------
-- d) Both reads take the queue flags; the page row returns needs_reply
-- ---------------------------------------------------------------------------
DO $a245_reads$
DECLARE
  target RECORD;
  original TEXT;
  body TEXT;
  anchor TEXT;
  replacement TEXT;
  i INTEGER;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
      ARRAY[
        $q$THEN platform_private.admissions_attention_flags(c.id) END)$q$,
        $q$'attention_flags', to_jsonb(COALESCE(shown.flags, ARRAY[]::TEXT[])),$q$
      ],
      ARRAY[
        $q$THEN platform_private.case_queue_flags(c.id) END)$q$,
        $q$'attention_flags', to_jsonb(COALESCE(shown.flags, ARRAY[]::TEXT[])),
      'needs_reply', platform_private.case_needs_reply(shown.organization_id, shown.id),$q$
      ]),
    ('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
      ARRAY[$q$THEN platform_private.admissions_attention_flags(c.id) END AS flags,$q$],
      ARRAY[$q$THEN platform_private.case_queue_flags(c.id) END AS flags,$q$])
  ) AS t(signature, anchors, replacements) LOOP
    original := pg_get_functiondef(target.signature::regprocedure);
    body := original;
    FOR i IN 1 .. cardinality(target.anchors) LOOP
      anchor := target.anchors[i];
      replacement := target.replacements[i];
      IF (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1
        OR strpos(body, replacement) <> 0
      THEN
        RAISE EXCEPTION 'student_case_queue_flags_anchor_drift: % (%)', target.signature, i;
      END IF;
      body := replace(body, anchor, replacement);
      IF (length(body) - length(replace(body, replacement, ''))) / length(replacement) <> 1 THEN
        RAISE EXCEPTION 'student_case_queue_flags_anchor_drift: % (% after)', target.signature, i;
      END IF;
    END LOOP;
    EXECUTE body;
  END LOOP;
END
$a245_reads$;

-- ---------------------------------------------------------------------------
-- e) A staff post sets «Ждём студента» unless the command chose a state
-- ---------------------------------------------------------------------------
DO $a245_chat$
DECLARE
  original TEXT;
  body TEXT;
  anchors CONSTANT TEXT[] := ARRAY[
    $q$WHEN 'post' THEN ARRAY['mode', 'body', 'quotedMessageId', 'attachmentKind', 'attachmentId']$q$,
    $q$    INSERT INTO platform.case_chat_threads
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
        ELSE platform.case_chat_threads.await_state END;$q$
  ];
  replacements CONSTANT TEXT[] := ARRAY[
    $q$WHEN 'post' THEN ARRAY['mode', 'body', 'quotedMessageId', 'attachmentKind', 'attachmentId', 'state']$q$,
    $q$    -- 245 (owner decision 26.09): a staff post answers the student, so the
    -- thread waits for the student («Ждём студента») — unless this same
    -- command chose the state explicitly. The student branch stays
    -- unreachable here (students post through portal_case_chat_post_v1,
    -- which keeps setting 'needs_reply').
    IF p_input ? 'state' THEN
      IF jsonb_typeof(p_input -> 'state') <> 'string'
        OR (p_input ->> 'state') NOT IN ('none', 'needs_reply', 'awaiting_student') THEN
        RAISE EXCEPTION 'case_chat_invalid' USING ERRCODE = '22023';
      END IF;
      await_state := p_input ->> 'state';
    ELSE
      await_state := 'awaiting_student';
    END IF;
    INSERT INTO platform.case_chat_threads
      (organization_id, student_case_id, last_message_at, last_message_sequence_id, await_state,
       await_set_by_membership_id, await_set_at)
    VALUES (
      p_organization_id, p_student_case_id, msg.created_at, msg.sequence_id,
      CASE WHEN actor.platform_role = 'student' THEN 'needs_reply' ELSE await_state END,
      CASE WHEN actor.platform_role = 'student' THEN NULL ELSE actor.membership_id END,
      CASE WHEN actor.platform_role = 'student' THEN NULL ELSE clock_timestamp() END
    )
    ON CONFLICT (organization_id, student_case_id) DO UPDATE SET
      last_message_at = EXCLUDED.last_message_at,
      last_message_sequence_id = EXCLUDED.last_message_sequence_id,
      await_state = EXCLUDED.await_state,
      -- The thread CHECK keeps the pair together: a student post leaves the
      -- last explicit marker as it was, a staff post records who set it.
      await_set_by_membership_id = CASE WHEN actor.platform_role = 'student'
        THEN platform.case_chat_threads.await_set_by_membership_id ELSE EXCLUDED.await_set_by_membership_id END,
      await_set_at = CASE WHEN actor.platform_role = 'student'
        THEN platform.case_chat_threads.await_set_at ELSE EXCLUDED.await_set_at END;$q$
  ];
  i INTEGER;
BEGIN
  original := pg_get_functiondef('platform.case_chat_command(uuid,uuid,uuid,jsonb)'::regprocedure);
  body := original;
  FOR i IN 1 .. cardinality(anchors) LOOP
    IF (length(body) - length(replace(body, anchors[i], ''))) / length(anchors[i]) <> 1
      OR strpos(body, replacements[i]) <> 0
    THEN
      RAISE EXCEPTION 'case_chat_command_post_anchor_drift: %', i;
    END IF;
    body := replace(body, anchors[i], replacements[i]);
    IF (length(body) - length(replace(body, replacements[i], ''))) / length(replacements[i]) <> 1 THEN
      RAISE EXCEPTION 'case_chat_command_post_anchor_drift: % after', i;
    END IF;
  END LOOP;
  EXECUTE body;
END
$a245_chat$;

-- ---------------------------------------------------------------------------
-- f) Grants restated (CREATE OR REPLACE keeps them); self-check
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT),
  platform.case_chat_command(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT),
  platform.case_chat_command(UUID, UUID, UUID, JSONB)
  TO authenticated;

DO $a245_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN (
      'platform_private.case_needs_reply(uuid,uuid)'::regprocedure,
      'platform_private.case_queue_flags(uuid)'::regprocedure,
      'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure,
      'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure,
      'platform.case_chat_command(uuid,uuid,uuid,jsonb)'::regprocedure)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
      OR routine.prosrc ~ 'platform_role\s*(NOT\s+)?IN\s*\('
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR (routine.signature::TEXT LIKE 'platform_private.%' AND has_function_privilege('authenticated', routine.signature, 'EXECUTE'))
    THEN
      RAISE EXCEPTION 'a245_case_work_signals_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF strpos(pg_get_functiondef('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure),
      'platform_private.admissions_attention_flags(c.id) AS flags') = 0
  THEN
    RAISE EXCEPTION 'a245_case_work_signals_verification_failed: row attention_flags must stay 182''s';
  END IF;
END
$a245_verify$;

COMMENT ON FUNCTION platform.staff_student_case_queue_v1(TEXT, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» work queue page: views mine/needs_action/active/needs_curator/closed/pending (needs_action also no step and chat waiting for staff since 245), due or updated keyset order, pipeline_stage, checklist document counts and needs_reply per row; visibility = private.platform_can_read_student_case.';
COMMENT ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» queue counts: views (pending since 242; needs_action with no step and chat waiting for staff since 245), due bands and direction/curator/stage facets under the exact filters of staff_student_case_queue_v1; visibility = private.platform_can_read_student_case.';
COMMENT ON FUNCTION platform.case_chat_command(UUID, UUID, UUID, JSONB) IS
  'Staff case chat command: post / set_await / read. Since 245 a staff post sets await_state awaiting_student (or the explicit optional state of the same command); idempotent by request id.';

COMMIT;
