-- 309_platform_portal_light_poll: лёгкий опрос кабинета студента и колокольчика CRM
-- (срез A4 плана скорости; docs/PLAN_CHANGES.md, запись 2026-10-19 «Скорость A0 + A4»,
-- пункты 7, 8 и 12; решение владельца 19.10.2026). Хук набора в
-- `scripts/test-postgres-authorization.sh` ищет файл по имени, а не по номеру.
--
-- Зачем. Вкладка кабинета студента опрашивала сервер раз в минуту ценой 7-8 RPC:
-- проверка доступа в proxy и ещё одна в server action, затем уведомления, обзор и
-- финансы. Колокольчик CRM стоил 3 RPC в минуту. Здесь две функции, каждая отвечает
-- за ОДИН вызов: проверяет, кто спрашивает, и возвращает число непрочитанного и
-- «версию» того, что показывает раздел. Клиент перечитывает страницу только тогда,
-- когда версия сменилась.
--
-- Что делает: только добавление двух функций, без таблиц, колонок, журнала и
-- триггеров. Прежние функции и приложение, которое их вызывает, не затронуты;
-- старое приложение новые функции не вызывает (порядок выпуска: ledger check ->
-- apply 309 -> выпуск приложения).
--
--  1. platform.student_portal_poll_v1(p_section TEXT DEFAULT NULL) RETURNS JSONB
--     (STABLE, SECURITY DEFINER, EXECUTE только у authenticated).
--     * Раздел: NULL | home | admission | documents | payments | notifications |
--       messages. Любое другое значение (в том числе пустая строка и другой регистр)
--       это 22023 `portal_poll_section_invalid`: строгий разбор, как у GET-маршрута.
--     * Доступ тот же, что у студенческого proxy: ровно одна строка
--       platform.student_portal_cases() (она сама проверяет
--       private.platform_can_read_student_portal_case). Сотрудник, аноним, студент без
--       кабинета, с заблокированным профилем или неактивным членством получает
--       {"access": false} без исключения.
--     * Ответ {"access": true, "unread": N, "version": "<md5>" | null}.
--       unread это число непрочитанных строк platform.student_portal_notifications_v2()
--       (тот же источник, что показывает колокольчик). version это md5 текста из:
--       строки дела (to_jsonb строки student_portal_cases(): состояние, этап и т.д.),
--       пар (notification_id, read_at) списка уведомлений и содержимого раздела:
--         home        student_portal_overview_v2() и student_portal_finance_v2();
--         admission   они же и student_catalog_preparations_v1(<дело>);
--         documents   student_portal_documents();
--         payments    student_portal_finance_v2();
--         messages    portal_case_chat_page_v1(NULL);
--         notifications и NULL ничего сверх строки дела и уведомлений.
--       Наборы строк хэшируются независимо от порядка (сортировка по тексту строки),
--       части склеены с метками и именем раздела. Версия считается из тех же читателей,
--       что страница раздела, поэтому права и состав данных у них общие.
--     * Если чтение содержимого раздела поднимает 42501 (чат закрыт для студента не на
--       сопровождении: дело в состоянии pending), version = JSON null («неизвестна»),
--       а access и unread возвращаются. Ловится ТОЛЬКО 42501: таймауты и прочее
--       всплывают наружу.
--     * Детерминизм: функция фиксирует TimeZone = UTC на время вызова, иначе
--       to_jsonb(timestamptz) писал бы метки времени в поясе сессии и одна и та же
--       версия зависела бы от настроек подключения.
--     * Ничего не пишет (работает в READ ONLY транзакции). В ответе нет ни одного
--       значения данных: только признак, число и хэш.
--
--  2. platform.staff_notifications_state_v1() RETURNS JSONB
--     (VOLATILE, SECURITY DEFINER, EXECUTE только у authenticated).
--     Колокольчик сотрудника. ВАЖНО: функция ВЫЗЫВАЕТ platform.staff_notifications_page_v2
--     (188), а не копирует её условия. Страница v2 при чтении создаёт напоминания о
--     сроках «завтра» (INSERT в staff_notifications) и гасит устаревшие (UPDATE
--     read_at); колокольчик опрашивает её раз в минуту, и это единственный механизм
--     появления напоминаний. Поэтому опрос не может быть чистым чтением, а функция
--     VOLATILE. Ответ {"access": true, "unread": N, "version": md5(страница)}; для
--     студента, сессии без членства или при 42501 страницы {"access": false}.
--     TimeZone здесь НЕ фиксируется: ключи напоминаний 'task-reminder:<id>:<срок>'
--     содержат срок, записанный текстом в поясе сессии, и вызов должен идти в тех же
--     условиях, что прямой вызов страницы (иначе ключи двух путей разошлись бы).
--
-- Повторный запуск целой миграции отказывает (CREATE FUNCTION), ничего не меняя.
BEGIN;

CREATE FUNCTION platform.student_portal_poll_v1(p_section TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
AS $$
DECLARE
  case_count BIGINT;
  portal_case_id UUID;
  case_part TEXT;
  unread_count BIGINT;
  notifications_part TEXT;
  overview_part TEXT;
  finance_part TEXT;
  section_part TEXT;
  version_text TEXT;
BEGIN
  IF p_section IS NOT NULL AND p_section NOT IN (
    'home', 'admission', 'documents', 'payments', 'notifications', 'messages'
  ) THEN
    RAISE EXCEPTION 'portal_poll_section_invalid' USING ERRCODE = '22023';
  END IF;

  -- Доступ ровно как у студенческого proxy: одна строка дела портала.
  SELECT count(*), min(portal_case.case_id::TEXT)::UUID, min(to_jsonb(portal_case)::TEXT)
  INTO case_count, portal_case_id, case_part
  FROM platform.student_portal_cases() AS portal_case;
  IF case_count IS DISTINCT FROM 1 THEN
    RETURN jsonb_build_object('access', FALSE);
  END IF;

  SELECT
    count(*) FILTER (WHERE notification.read_at IS NULL),
    COALESCE(string_agg(
      jsonb_build_array(notification.notification_id, notification.read_at)::TEXT, '|'
      ORDER BY jsonb_build_array(notification.notification_id, notification.read_at)::TEXT
    ), '')
  INTO unread_count, notifications_part
  FROM platform.student_portal_notifications_v2() AS notification;

  -- Содержимое раздела. Отказ в доступе (42501) делает версию неизвестной, но не
  -- ломает опрос; любая другая ошибка всплывает.
  BEGIN
    section_part := '';
    IF p_section IN ('home', 'admission') THEN
      SELECT COALESCE(string_agg(to_jsonb(row_value)::TEXT, '|' ORDER BY to_jsonb(row_value)::TEXT), '')
      INTO overview_part
      FROM platform.student_portal_overview_v2() AS row_value;
      SELECT COALESCE(string_agg(to_jsonb(row_value)::TEXT, '|' ORDER BY to_jsonb(row_value)::TEXT), '')
      INTO finance_part
      FROM platform.student_portal_finance_v2() AS row_value;
      section_part := concat_ws('|', 'overview:' || overview_part, 'finance:' || finance_part);
      IF p_section = 'admission' THEN
        section_part := concat_ws(
          '|', section_part,
          'preparations:' || COALESCE(platform.student_catalog_preparations_v1(portal_case_id)::TEXT, '')
        );
      END IF;
    ELSIF p_section = 'documents' THEN
      SELECT COALESCE(string_agg(to_jsonb(row_value)::TEXT, '|' ORDER BY to_jsonb(row_value)::TEXT), '')
      INTO section_part
      FROM platform.student_portal_documents() AS row_value;
      section_part := 'documents:' || section_part;
    ELSIF p_section = 'payments' THEN
      SELECT COALESCE(string_agg(to_jsonb(row_value)::TEXT, '|' ORDER BY to_jsonb(row_value)::TEXT), '')
      INTO section_part
      FROM platform.student_portal_finance_v2() AS row_value;
      section_part := 'finance:' || section_part;
    ELSIF p_section = 'messages' THEN
      section_part := 'chat:' || COALESCE(platform.portal_case_chat_page_v1(NULL)::TEXT, '');
    END IF;

    version_text := md5(concat_ws(
      '|',
      'poll1',
      'section:' || COALESCE(p_section, ''),
      'case:' || case_part,
      'notifications:' || notifications_part,
      section_part
    ));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    version_text := NULL;
  END;

  RETURN jsonb_build_object('access', TRUE, 'unread', unread_count, 'version', version_text);
END
$$;

CREATE FUNCTION platform.staff_notifications_state_v1()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  page JSONB;
BEGIN
  SELECT authority.organization_id, authority.membership_id
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IS DISTINCT FROM 'student'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('access', FALSE);
  END IF;

  -- Прямой вызов страницы v2 (188): он же создаёт напоминания о сроках и гасит
  -- устаревшие, ради этого побочного эффекта функция и VOLATILE.
  BEGIN
    page := platform.staff_notifications_page_v2(actor.organization_id, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    RETURN jsonb_build_object('access', FALSE);
  END;

  RETURN jsonb_build_object(
    'access', TRUE,
    'unread', (page ->> 'unread_count')::BIGINT,
    'version', md5(page::TEXT)
  );
END
$$;

REVOKE ALL ON FUNCTION platform.student_portal_poll_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.student_portal_poll_v1(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_notifications_state_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.staff_notifications_state_v1() TO authenticated;

COMMENT ON FUNCTION platform.student_portal_poll_v1(TEXT) IS
  'Light poll of the Student cabinet (A4): one RPC checks that the caller is an active Student (exactly one student_portal_cases() row, else {"access": false}) and returns {"access": true, "unread": N, "version": md5 | null}. unread counts the unread rows of student_portal_notifications_v2(). version is a hash of what the section shows (the case row, the notification ids with read_at and the section readers; set hashes do not depend on row order); null when the section read is refused with 42501 (messages for a Student not under assistance). Section: NULL, home, admission, documents, payments, notifications, messages; anything else is 22023. Read only; the answer carries no data values.';
COMMENT ON FUNCTION platform.staff_notifications_state_v1() IS
  'Light poll of the CRM bell (A4): {"access": true, "unread": N, "version": md5 of the page} for a non-Student with a membership, else {"access": false}. VOLATILE on purpose: it CALLS staff_notifications_page_v2, which on read materializes the due-tomorrow reminders (INSERT) and neutralizes stale ones (UPDATE); the bell polls it once a minute and that is the only mechanism by which reminders appear, so a pure read would stop them.';

-- Проверка в конце: права ровно такие, как задумано, и характеристики функций.
DO $a309_verify$
DECLARE
  r TEXT;
  signature REGPROCEDURE;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'platform.student_portal_poll_v1(text)'::REGPROCEDURE,
    'platform.staff_notifications_state_v1()'::REGPROCEDURE
  ] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
      IF has_function_privilege(r, signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'portal_light_poll_acl_drift: % %', signature, r USING ERRCODE = '55000';
      END IF;
    END LOOP;
    IF has_function_privilege('public', signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'portal_light_poll_acl_drift: % authenticated', signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'platform.student_portal_poll_v1(text)'::REGPROCEDURE AND p.prosecdef
      AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'portal_light_poll_definer_drift: student_portal_poll_v1' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'platform.staff_notifications_state_v1()'::REGPROCEDURE AND p.prosecdef
      AND p.provolatile = 'v' AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'portal_light_poll_definer_drift: staff_notifications_state_v1' USING ERRCODE = '55000';
  END IF;
END
$a309_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
