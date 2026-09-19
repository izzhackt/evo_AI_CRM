-- PORT-5c «Общение по делу» — студенческая сторона per-case чата
-- (план docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md §6 строка «Общение»,
-- §10 PORT-5; запись PLAN_CHANGES 2026-09-19 «PORT-5c: сообщения по делу для
-- студента (миграция 200)»).
--
-- Intent. Миграция 191 (OTH-5) построила staff-сторону чата по делу и явно
-- оставила student-side как «DECLARED, NOT-YET-BUILT dependency» портального
-- плана (191:11-18): platform.case_chat_command отклоняет студента 42501, а
-- студенческая ветка thread-upsert'а смоделирована, но недостижима. Эта
-- миграция открывает студенту его дверь — БЕЗ второй модели чата: те же
-- таблицы platform.case_chat_messages / platform.case_chat_threads /
-- platform_private.case_chat_receipts, те же локи, тот же realtime-топик.
--
-- Гейт. Оба RPC используют ровно гейт-паттерн 192 для case-операций:
-- platform_private.require_case_operations_actor(NULL, TRUE) — студент со
-- СВОИМ единственным портальным кейсом, state IN ('active','closed') после
-- ужесточения 192 («Общение» по диаграмме плана §4 принадлежит
-- сопровождению; approved/pending-кейс получает «Запрос консультации» 197,
-- не переписку). Параметры RPC не адресуют кейс вовсе — чужой кейс
-- неадресуем по построению.
--
-- Семантика await-состояний — точно как задумал OTH в 191:
--   * студенческий пост ставит await_state='needs_reply' (и тем самым
--     снимает 'awaiting_student') — это дословно смоделированная 191-й
--     ветка `CASE WHEN actor.platform_role = 'student' THEN 'needs_reply'`
--     (191:297-305), воспроизведённая здесь достижимым кодом;
--   * явные await_set_by_membership_id/await_set_at НЕ трогаются постом
--     (как и в post-ветке 191 — их меняет только явный set_await);
--   * чтение НИКОГДА не меняет await_state (правило 191 read-ветки).
--
-- Staff-сторона 191 НЕ переписывается, и аддитивный anchor-патч НЕ нужен:
-- case_chat_read_page_v1 резолвит имя автора через organization_memberships
-- → profiles (студенческий membership проходит тот же JOIN),
-- staff_case_chat_threads_v1 считает unread по «автор не я», триггер
-- platform_private.notify_case_chat_message уведомляет текущего куратора о
-- студенческом INSERT, board 187/191 читает needs_reply из треда. Каждое
-- утверждение проверяется РЕАЛЬНЫМ вызовом staff-RPC в
-- supabase/tests/platform_portal_case_chat.sql (checkpoint 200).
--
-- Конфликт receipt'а — PT409, НЕ 40001: эти RPC достижимы через PostgREST,
-- а SQLSTATE 40001 ретраится им бесконечно (инцидент миграции 186;
-- конвенция 178/186/194). Staff-команда 191 сохраняет свой 40001 — она вне
-- объёма этой миграции.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) platform.portal_case_chat_post_v1: идемпотентная отправка студента.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.portal_case_chat_post_v1(p_request_id UUID, p_body TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  gate RECORD; body_text TEXT; fingerprint TEXT;
  prior platform_private.case_chat_receipts%ROWTYPE;
  msg platform.case_chat_messages; result JSONB;
BEGIN
  -- Гейт 192: студент + свой портальный кейс + state IN ('active','closed').
  -- Staff и anon сюда не проходят: staff-ветка require_case_operations_actor
  -- с p_case_id=NULL не находит кейса (42501), у anon нет membership.
  SELECT * INTO gate FROM platform_private.require_case_operations_actor(NULL, TRUE);
  IF gate.platform_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'portal_case_chat_invalid' USING ERRCODE = '22023';
  END IF;
  body_text := btrim(coalesce(p_body, ''));
  -- Разумная длина студенческого сообщения: 1..2000 (внутри CHECK 8000 табл.
  -- 191); управляющие символы кроме \n\r\t запрещены — зеркало CHECK 191.
  IF char_length(body_text) < 1 OR char_length(body_text) > 2000
    OR body_text ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN
    RAISE EXCEPTION 'portal_case_chat_invalid' USING ERRCODE = '22023';
  END IF;

  -- Те же локи и тот же порядок, что team_chat/191 (191:194-198): retry не
  -- интерливится, студенческие и staff-записи сериализуются на одном стриме.
  PERFORM pg_advisory_xact_lock(hashtextextended('case-chat-request:' || gate.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('case-chat:' || gate.organization_id::TEXT || ':' || gate.student_case_id::TEXT, 0));

  fingerprint := md5(jsonb_build_object('actor', gate.membership_id, 'case', gate.student_case_id,
    'input', jsonb_build_object('mode', 'portal_post', 'body', body_text))::TEXT);
  SELECT * INTO prior FROM platform_private.case_chat_receipts r
    WHERE r.organization_id = gate.organization_id
      AND r.actor_membership_id = gate.membership_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF prior.fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'portal_case_chat_request_conflict' USING ERRCODE = 'PT409';
    END IF;
    RETURN prior.receipt;
  END IF;

  -- Перепроверка гейта после локов (паттерн 191:210-222): состояние кейса
  -- могло измениться, пока транзакция ждала стрим.
  PERFORM * FROM platform_private.require_case_operations_actor(gate.student_case_id, TRUE);

  INSERT INTO platform.case_chat_messages
    (organization_id, student_case_id, author_membership_id, body)
  VALUES (gate.organization_id, gate.student_case_id, gate.membership_id, body_text)
  RETURNING * INTO msg;

  -- Достижимая версия студенческой ветки 191 (191:293-305): пост студента
  -- ставит needs_reply (снимая awaiting_student); явные await_set_by/at не
  -- трогаются — их меняет только явный set_await куратора.
  INSERT INTO platform.case_chat_threads
    (organization_id, student_case_id, last_message_at, last_message_sequence_id, await_state)
  VALUES (gate.organization_id, gate.student_case_id, msg.created_at, msg.sequence_id, 'needs_reply')
  ON CONFLICT (organization_id, student_case_id) DO UPDATE SET
    last_message_at = EXCLUDED.last_message_at,
    last_message_sequence_id = EXCLUDED.last_message_sequence_id,
    await_state = 'needs_reply';

  -- Invalidate-only broadcast в тот же топик 191 (191:307-310): staff-сессии
  -- обновляются; содержимое сообщения в канал не попадает.
  PERFORM realtime.send(jsonb_build_object('refresh', true), 'invalidate',
    'case-chat:' || gate.organization_id::TEXT || ':' || gate.student_case_id::TEXT, true);

  result := jsonb_build_object('requestId', p_request_id, 'studentCaseId', gate.student_case_id,
    'mode', 'portal_post', 'messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT,
    'createdAt', msg.created_at);

  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state, reason, request_id)
  SELECT gate.organization_id, 'user', a.profile_id, 'auth:' || a.auth_user_id::TEXT,
    'case.chat.post', 'student_case', gate.student_case_id, NULL,
    jsonb_build_object('messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT),
    'Case chat message posted', p_request_id
  FROM platform.current_actor_authority() a;

  INSERT INTO platform_private.case_chat_receipts (organization_id, actor_membership_id, request_id, fingerprint, receipt)
    VALUES (gate.organization_id, gate.membership_id, p_request_id, fingerprint, result);
  RETURN result;
END $$;

-- ---------------------------------------------------------------------------
-- 2) platform.portal_case_chat_page_v1: чтение СВОЕГО треда, before-курсор.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.portal_case_chat_page_v1(p_before_sequence_id BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  gate RECORD; ids UUID[]; has_more BOOLEAN := false; next_cursor BIGINT := 0;
  rows JSONB; thread platform.case_chat_threads%ROWTYPE;
BEGIN
  SELECT * INTO gate FROM platform_private.require_case_operations_actor(NULL, TRUE);
  IF gate.platform_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'Case access denied' USING ERRCODE = '42501';
  END IF;
  IF p_before_sequence_id IS NOT NULL AND p_before_sequence_id < 0 THEN
    RAISE EXCEPTION 'portal_case_chat_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(m.id ORDER BY m.sequence_id DESC) INTO ids FROM (
    SELECT m.id, m.sequence_id FROM platform.case_chat_messages m
    WHERE m.organization_id = gate.organization_id AND m.student_case_id = gate.student_case_id
      AND (p_before_sequence_id IS NULL OR m.sequence_id < p_before_sequence_id)
    ORDER BY m.sequence_id DESC LIMIT 31
  ) m;
  has_more := coalesce(cardinality(ids), 0) > 30;
  ids := ids[1:30];
  SELECT coalesce(min(m.sequence_id), 0) INTO next_cursor FROM platform.case_chat_messages m WHERE m.id = ANY(ids);

  -- Строка сообщения для студента: подписи вместо raw id (label документа /
  -- заголовок задачи — staff может приложить карточку-ссылку, 191 secция c),
  -- превью цитаты, признак «моё». Ответы и результаты тестов сюда попасть не
  -- могут — чат не имеет к ним доступа ни в одной ветке.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'sequenceId', m.sequence_id::TEXT,
      'mine', m.author_membership_id = gate.membership_id,
      'authorName', author_profile.display_name,
      'body', m.body, 'createdAt', m.created_at,
      'attachmentKind', m.attachment_kind,
      'attachmentLabel', CASE
        WHEN m.attachment_kind = 'document' THEN document_requirement.label
        WHEN m.attachment_kind = 'case_task' THEN case_task.title
        ELSE NULL END,
      'quotedBodyPreview', CASE WHEN quoted.id IS NOT NULL THEN left(quoted.body, 140) ELSE NULL END
    ) ORDER BY m.sequence_id DESC), '[]'::JSONB)
  INTO rows
  FROM platform.case_chat_messages m
  JOIN platform.organization_memberships author_member
    ON author_member.organization_id = gate.organization_id AND author_member.id = m.author_membership_id
  JOIN platform.profiles author_profile ON author_profile.id = author_member.profile_id
  LEFT JOIN platform.case_chat_messages quoted
    ON quoted.organization_id = gate.organization_id AND quoted.student_case_id = gate.student_case_id
    AND quoted.id = m.quoted_message_id
  LEFT JOIN platform.document_slots document_slot
    ON m.attachment_kind = 'document' AND document_slot.organization_id = gate.organization_id AND document_slot.id = m.attachment_id
  LEFT JOIN platform.document_requirements document_requirement
    ON document_requirement.organization_id = gate.organization_id AND document_requirement.id = document_slot.requirement_id
  LEFT JOIN platform.case_tasks case_task
    ON m.attachment_kind = 'case_task' AND case_task.organization_id = gate.organization_id AND case_task.id = m.attachment_id
  WHERE m.organization_id = gate.organization_id AND m.student_case_id = gate.student_case_id AND m.id = ANY(ids);

  SELECT * INTO thread FROM platform.case_chat_threads t
    WHERE t.organization_id = gate.organization_id AND t.student_case_id = gate.student_case_id;

  RETURN jsonb_build_object(
    'messages', rows, 'cursor', next_cursor::TEXT, 'hasMore', has_more,
    'awaitState', coalesce(thread.await_state, 'none')
  );
END $$;

REVOKE ALL ON FUNCTION
  platform.portal_case_chat_post_v1(UUID, TEXT),
  platform.portal_case_chat_page_v1(BIGINT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.portal_case_chat_post_v1(UUID, TEXT),
  platform.portal_case_chat_page_v1(BIGINT)
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
