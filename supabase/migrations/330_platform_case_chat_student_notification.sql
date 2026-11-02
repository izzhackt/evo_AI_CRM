-- 330 «Студент узнаёт о новом сообщении». Триггер нового сообщения в чате дела уведомлял только куратора. Студент видел ответ,
-- лишь сам зайдя в «Сообщения», поэтому напоминание куратора или агента о сроке могло пройти мимо него.
-- Что меняется:
--   1) platform_private.notify_case_chat_message: сообщение не от студента создаёт ему уведомление, если кабинет активирован.
--      Текста сообщения в уведомлении нет. Пока прежнее не прочитано, новое не создаётся: одно уведомление на непрочитанное;
--   2) platform_private.own_case_chat_notifications и ветка в platform.student_portal_notifications_v2: уведомление видно в
--      кабинете, на iPhone и в счётчике колокольчика (309 считает по той же функции);
--   3) platform.mark_own_student_portal_notification_read_v2 принимает и это уведомление: иначе кнопка «Отметить прочитанным»
--      отвечала бы отказом, и новые уведомления больше не появлялись бы.
--   4) platform.mark_own_case_chat_notifications_read_v1: открытый чат снимает уведомление, когда показано самое новое сообщение
--      команды. Без этого студент, прочитавший чат и не нажавший «Отметить», больше не получал бы новых уведомлений по делу;
--   5) уникальный частичный индекс держит одно непрочитанное и при одновременных сообщениях. Клиент, который чтение не
--      передаёт (приложение iPhone пока), новые не глушит: прежнее непрочитанное старше суток закрывается новым сообщением.
-- Forward-only, ничего не удаляет. own_case_chat_notifications закрыта от API-ролей, команду 4 вызывает только authenticated и
-- только как студент (иначе 42501). Повтор отказывает a330_already_applied, чужое тело
-- триггера отказывает a330_anchor_drift, чужое тело чтения или отметки a330_replace_drift.
-- Порядок выката: можно в любом порядке. Старое приложение покажет такое уведомление со ссылкой на «Обзор».
BEGIN;

DO $a330_anchor$
BEGIN
  IF to_regprocedure('platform_private.own_case_chat_notifications()') IS NOT NULL THEN
    RAISE EXCEPTION 'a330_already_applied' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('platform_private.notify_case_chat_message()'))
    IS DISTINCT FROM '59ed49386f1b3113e8805a57a47b7fc7' THEN
    RAISE EXCEPTION 'a330_anchor_drift: notify_case_chat_message is not the 191 definition' USING ERRCODE = '55000';
  END IF;
END
$a330_anchor$;

CREATE UNIQUE INDEX notifications_case_chat_one_unread
  ON platform.notifications (organization_id, student_case_id, recipient_membership_id)
  WHERE category = 'case_chat.message' AND read_at IS NULL;

CREATE OR REPLACE FUNCTION platform_private.notify_case_chat_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE curator_id UUID; student_id UUID; activated_at TIMESTAMPTZ; v_notification UUID;
BEGIN
  SELECT c.current_curator_membership_id, c.student_membership_id, c.portal_activated_at
    INTO curator_id, student_id, activated_at FROM platform.student_cases c
    WHERE c.organization_id = NEW.organization_id AND c.id = NEW.student_case_id;
  -- 330: студенту с кабинетом, одно непрочитанное на дело. Сообщение студента его самого не уведомляет.
  IF student_id IS NOT NULL AND activated_at IS NOT NULL AND student_id <> NEW.author_membership_id
    AND EXISTS (SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = NEW.organization_id AND m.id = student_id AND m.status = 'active' AND p.status = 'active')
  THEN
    WITH closed AS (
      UPDATE platform.notifications n SET read_at = statement_timestamp()
      WHERE n.organization_id = NEW.organization_id AND n.student_case_id = NEW.student_case_id
        AND n.recipient_membership_id = student_id AND n.category = 'case_chat.message' AND n.read_at IS NULL
        AND n.created_at < statement_timestamp() - INTERVAL '1 day'
      RETURNING n.id
    )
    INSERT INTO platform.notification_events (organization_id, notification_id, student_case_id, recipient_membership_id,
      event_type, actor_membership_id, reason, request_id)
    SELECT NEW.organization_id, closed.id, NEW.student_case_id, student_id, 'cancelled', NEW.author_membership_id,
      'Replaced by a newer Staff message', gen_random_uuid() FROM closed;

    INSERT INTO platform.notifications (organization_id, student_case_id, recipient_membership_id, category, title, body,
      dedupe_key, created_by_membership_id)
    VALUES (NEW.organization_id, NEW.student_case_id, student_id, 'case_chat.message', 'Новое сообщение от команды EVO',
      'Откройте «Сообщения», чтобы прочитать.', 'case_chat_message:' || NEW.id::TEXT, NEW.author_membership_id)
    ON CONFLICT (organization_id, student_case_id, recipient_membership_id)
      WHERE category = 'case_chat.message' AND read_at IS NULL DO NOTHING
    RETURNING id INTO v_notification;
    IF v_notification IS NOT NULL THEN
      INSERT INTO platform.notification_events (organization_id, notification_id, student_case_id, recipient_membership_id,
        event_type, actor_membership_id, reason, request_id)
      VALUES (NEW.organization_id, v_notification, NEW.student_case_id, student_id, 'created', NEW.author_membership_id,
        'Staff message in the Student case chat', gen_random_uuid());
    END IF;
  END IF;

  IF curator_id IS NULL OR curator_id = NEW.author_membership_id THEN RETURN NEW; END IF;
  INSERT INTO platform.staff_notifications
    (organization_id, recipient_membership_id, event_key, kind, student_case_id, actor_membership_id)
  SELECT NEW.organization_id, m.id, 'case-message:' || NEW.id::TEXT, 'case_message', NEW.student_case_id, NEW.author_membership_id
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = NEW.organization_id AND m.id = curator_id AND m.status = 'active' AND p.status = 'active'
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END
$$;

CREATE FUNCTION platform_private.own_case_chat_notifications()
RETURNS TABLE (notification_id UUID, category TEXT, event_code TEXT, subject_label TEXT, detail TEXT,
  due_at TIMESTAMPTZ, created_at TIMESTAMPTZ, read_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT n.id, n.category, 'case_chat_message'::TEXT, n.title, n.body, NULL::TIMESTAMPTZ, n.created_at, n.read_at
  FROM platform.current_actor_authority() a
  JOIN platform.notifications n
    ON n.organization_id = a.organization_id AND n.recipient_membership_id = a.membership_id
  WHERE a.platform_role = 'student' AND n.category = 'case_chat.message'
    AND private.platform_has_permission(a.organization_id, 'notification.read.self')
    AND private.platform_can_read_student_portal_case(n.organization_id, n.student_case_id)
$$;
REVOKE ALL ON FUNCTION platform_private.own_case_chat_notifications() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Студент прочитал чат до показанного сообщения. Пока от команды есть новее показанного, уведомление остаётся: одно
-- непрочитанное покрывает все сообщения дела, и новое студент ещё не видел.
CREATE FUNCTION platform.mark_own_case_chat_notifications_read_v1(p_up_to_sequence_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; target RECORD; marked INTEGER := 0; v_request UUID;
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
  FOR target IN
    SELECT n.id, n.student_case_id FROM platform.notifications n
    WHERE n.organization_id = actor.organization_id AND n.recipient_membership_id = actor.membership_id
      AND n.category = 'case_chat.message' AND n.read_at IS NULL
      AND private.platform_can_read_student_portal_case(n.organization_id, n.student_case_id)
      AND NOT EXISTS (SELECT 1 FROM platform.case_chat_messages m
        WHERE m.organization_id = n.organization_id AND m.student_case_id = n.student_case_id
          AND m.sequence_id > p_up_to_sequence_id AND m.author_membership_id <> actor.membership_id)
    FOR UPDATE OF n
  LOOP
    v_request := gen_random_uuid();
    UPDATE platform.notifications SET read_at = read_at_value
      WHERE organization_id = actor.organization_id AND id = target.id;
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

CREATE FUNCTION pg_temp.a330_replace(p_signature TEXT, p_old TEXT, p_new TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'a330_replace_drift: % expected 1, found %', p_signature, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a330_replace('platform.student_portal_notifications_v2()',
  $old$FROM platform_private.own_application_package_notifications() n$old$,
  $new$FROM platform_private.own_application_package_notifications() n
    UNION ALL
    SELECT n.notification_id,n.category,n.event_code,n.subject_label,n.detail,n.due_at,n.created_at,n.read_at
    FROM platform_private.own_case_chat_notifications() n$new$);

SELECT pg_temp.a330_replace('platform.mark_own_student_portal_notification_read_v2(uuid,uuid)',
  $old$        SELECT 1 FROM platform_private.own_application_package_notifications() package
        WHERE package.notification_id = notification.id
      )$old$,
  $new$        SELECT 1 FROM platform_private.own_application_package_notifications() package
        WHERE package.notification_id = notification.id
      )
      OR EXISTS (
        SELECT 1 FROM platform_private.own_case_chat_notifications() chat
        WHERE chat.notification_id = notification.id
      )$new$);

NOTIFY pgrst, 'reload schema';

COMMIT;
