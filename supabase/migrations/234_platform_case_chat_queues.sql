-- CRM-07 / item 11: filter work queues before the existing list bound.
-- V1, message commands, await semantics and all existing data stay unchanged.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('platform.staff_case_chat_threads_v1(text)') IS NULL
    OR to_regprocedure('private.platform_can_read_student_case(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'case_chat_queue_dependency_missing';
  END IF;
END $$;

CREATE FUNCTION platform.staff_case_chat_threads_v2(
  p_query TEXT DEFAULT NULL, p_await_state TEXT DEFAULT NULL
)
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

  IF p_await_state IS NOT NULL AND p_await_state NOT IN ('needs_reply', 'awaiting_student') THEN
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
      AND (p_await_state IS NULL OR t.await_state = p_await_state)
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

REVOKE ALL ON FUNCTION platform.staff_case_chat_threads_v2(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_chat_threads_v2(TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_case_chat_threads_v2(TEXT, TEXT) IS
  'Staff case chat queues: authorized active cases, name and await filter before the 200-row bound. Read-only; unread is independent of await state.';

NOTIFY pgrst, 'reload schema';
COMMIT;
