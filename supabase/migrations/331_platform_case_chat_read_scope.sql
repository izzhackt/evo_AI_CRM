-- 331 «Чтение чата снимает уведомление только своего дела» (issue #1331, после ревью #1318 / миграции 330).
-- Что было: platform.mark_own_case_chat_notifications_read_v1 снимала непрочитанные уведомления чата по ВСЕМ делам студента
-- и сравнивала p_up_to_sequence_id с общим номером сообщений (sequence_id сквозной по всем делам). У студента с двумя
-- делами чтение чата одного дела могло снять уведомление другого, которого он не видел.
-- Что меняется: команда берёт дело так же, как страница чата portal_case_chat_page_v1 и отправка portal_case_chat_post_v1 (200):
-- platform_private.require_case_operations_actor(NULL, TRUE), то есть единственное портальное дело студента в состоянии
-- active/closed, и работает только с уведомлением этого дела. Если такого дела нет или их несколько, команда отказывает 42501
-- (чат в этом случае не открывается вовсе, читать нечего). Сигнатура, тип результата, GRANT (только authenticated), SECURITY
-- DEFINER, search_path '' и коды ошибок (22023 пустая позиция, 42501 не студент) не меняются: приложение вызывает команду как
-- раньше и разбирает ответ как раньше, поэтому порядок выката любой.
-- Forward-only, ничего не удаляет. Повтор отказывает a331_already_applied, чужое тело команды a331_anchor_drift.
BEGIN;

DO $a331_anchor$
DECLARE v_body TEXT;
BEGIN
  v_body := (SELECT p.prosrc FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('platform.mark_own_case_chat_notifications_read_v1(bigint)'));
  IF v_body IS NOT NULL AND position('require_case_operations_actor' IN v_body) > 0 THEN
    RAISE EXCEPTION 'a331_already_applied' USING ERRCODE = '55000';
  END IF;
  IF md5(v_body) IS DISTINCT FROM '29e510684eda732f7d3b8adad3765e73' THEN
    RAISE EXCEPTION 'a331_anchor_drift: mark_own_case_chat_notifications_read_v1 is not the 330 definition' USING ERRCODE = '55000';
  END IF;
END
$a331_anchor$;

CREATE OR REPLACE FUNCTION platform.mark_own_case_chat_notifications_read_v1(p_up_to_sequence_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; gate RECORD; target RECORD; marked INTEGER := 0; v_request UUID;
  read_at_value TIMESTAMPTZ := statement_timestamp();
  fixed_reason CONSTANT TEXT := 'Student opened the case chat';
BEGIN
  IF p_up_to_sequence_id IS NULL OR p_up_to_sequence_id < 0 THEN
    RAISE EXCEPTION 'portal_case_chat_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform.current_actor_authority() AS authority WHERE authority.platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(actor.organization_id, 'notification.read.self') THEN
    RAISE EXCEPTION 'Notification is unavailable' USING ERRCODE = '42501';
  END IF;
  -- 331: дело, чей чат показан, то же, что отдаёт portal_case_chat_page_v1. Параметр не называет дело, чужое неадресуемо.
  SELECT * INTO gate FROM platform_private.require_case_operations_actor(NULL, TRUE);
  FOR target IN
    SELECT n.id, n.student_case_id FROM platform.notifications n
    WHERE n.organization_id = actor.organization_id AND n.recipient_membership_id = actor.membership_id
      AND n.student_case_id = gate.student_case_id
      AND n.category = 'case_chat.message' AND n.read_at IS NULL
      AND private.platform_can_read_student_portal_case(n.organization_id, n.student_case_id)
  LOOP
    -- Тот же замок, что у записи в чат: сообщение, которое ещё сохраняется, не потеряет своё уведомление.
    PERFORM pg_advisory_xact_lock(hashtextextended('case-chat:' || actor.organization_id::TEXT || ':' || target.student_case_id::TEXT, 0));
    CONTINUE WHEN EXISTS (SELECT 1 FROM platform.case_chat_messages m
      WHERE m.organization_id = actor.organization_id AND m.student_case_id = target.student_case_id
        AND m.sequence_id > p_up_to_sequence_id AND m.author_membership_id <> actor.membership_id);
    v_request := gen_random_uuid();
    UPDATE platform.notifications SET read_at = read_at_value
      WHERE organization_id = actor.organization_id AND id = target.id AND read_at IS NULL;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO platform.notification_events (organization_id, notification_id, student_case_id, recipient_membership_id,
      event_type, actor_membership_id, reason, request_id)
    VALUES (actor.organization_id, target.id, target.student_case_id, actor.membership_id, 'read', actor.membership_id,
      fixed_reason, v_request);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type,
      resource_id, before_state, after_state, reason, request_id)
    VALUES (actor.organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT, 'notification.read', 'notification',
      target.id, jsonb_build_object('read_at', NULL),
      jsonb_build_object('notification_id', target.id, 'is_read', TRUE, 'read_at', read_at_value), fixed_reason, v_request);
    marked := marked + 1;
  END LOOP;
  RETURN marked;
END
$$;
REVOKE ALL ON FUNCTION platform.mark_own_case_chat_notifications_read_v1(BIGINT) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.mark_own_case_chat_notifications_read_v1(BIGINT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
