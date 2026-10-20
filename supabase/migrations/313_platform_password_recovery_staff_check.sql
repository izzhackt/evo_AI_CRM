-- 313: восстановление пароля студента спрашивает у базы, не сотрудник ли этот пользователь Auth
-- (задача #1195, вариант (б); решение владельца 21.10.2026: «okay do these»). docs/PLAN_CHANGES.md
-- «2026-10-21 · Восстановление пароля студента: сотрудник любого статуса не получает письмо
-- студента, точечный поиск по адресу (миграция 313)». Номер 313 - следующий за 312 на origin/main
-- 9b40eb7ad; сверяется ещё раз перед слиянием.
--
-- Forward-only и аддитивно: две новые служебные функции в `platform`; ни таблица, ни существующая
-- функция, ни чьи-то права не меняются. SECURITY DEFINER с пустым search_path, EXECUTE только
-- `service_role` (шаблон 308): ни PUBLIC, ни anon, ни authenticated, ни supabase_auth_admin, ни
-- evo_ai_agent их вызвать не могут. Приложение зовёт их ключом service role из действия
-- «Забыли пароль?» кабинета студента (src/lib/student-password-recovery-actions.ts).
--
-- Зачем. Публичная форма «Забыли пароль?» (#1170) не отправляла письмо студента только тем, у кого в
-- метаданных Auth стоит метка сотрудника (`evo_staff_password_request_id` или
-- `evo_staff_invitation_request_id`). Действующий сотрудник БЕЗ метки (сегодня - системный
-- администратор из bootstrap) получал письмо студента: ссылка в кабинете студента отказывала, но выпуск
-- такой ссылки делал недействительной ссылку восстановления, которую администратор мог выдать ему раньше.
-- Метка - косвенный признак; членство сотрудника - сам факт, и он лежит в базе.
--
--  a) `platform.auth_user_has_staff_membership_v1(p_auth_user_id)`: есть ли у пользователя Auth членство
--     сотрудника в ЛЮБОМ статусе (`invited`, `active`, `inactive`, `blocked`), в любой организации, при
--     любом статусе профиля. Сотрудник - членство, у которого роль не `student`, включая членство без
--     роли (приглашённый и подготовленный по 157, роль назначается отдельно): ровно то же различие, что
--     у `platform_private.staff_membership_identity` (155), только без требования активности. Студент
--     (`current_role = 'student'`), пользователь без профиля, профиль без членства, неизвестный и пустой
--     идентификатор - FALSE. Ответ - один BOOLEAN, ни строки, ни имени, ни роли наружу не уходит. Если
--     у профиля есть и студенческое, и сотрудническое членство (в разных организациях), ответ TRUE: письмо
--     студента не должно ломать ссылку сотрудника.
--  b) `platform.auth_user_by_exact_email_v1(p_email)`: точечный поиск пользователя Auth по точному адресу
--     (без учёта регистра и пробелов по краям) вместо перебора `auth.admin.listUsers` страницами по 1000
--     на каждый запрос. Перебор давал нагрузку, растущую с числом пользователей, а с ~9000 пользователей
--     поиск закрывался отказом (закрытый сбой: письмо не уходило). Ответ - JSONB с тем, что приложение
--     читало из ответа Admin API, и только этим: `id`, `email`, `email_confirmed_at`, `confirmed_at`,
--     `confirmation_sent_at`, `invited_at` (время - UTC, `...Z`), `app_metadata` только с ключом
--     `evo_staff_password_request_id` и `user_metadata` только с ключом `evo_staff_invitation_request_id`
--     (пустые - `{}`). Остальные метаданные, провайдеры, телефон и хэш пароля наружу не уходят. Нет такого
--     пользователя - NULL. Два и больше пользователей с одним адресом - 21000 (`auth_user_email_ambiguous`):
--     как и раньше, неясное совпадение - «недоступно», а не догадка. Пустой, слишком длинный адрес или
--     адрес с пробелом внутри - 22023 (`auth_user_email_invalid`). Тем же поиском пользуются приглашение
--     студента (сверка и разбор занятого адреса, student-portal-invite-auth-provider.ts).
--
-- Порядок выката. Приложение без миграции не находит функций (404 от PostgREST): поиск по адресу тогда
-- «недоступен», действие восстановления отвечает «unavailable» и письмо не отправляет (закрытый сбой), а
-- сверка и разбор занятого адреса приглашения возвращают прежние осторожные коды. Поэтому миграцию
-- применяют ДО выпуска приложения.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: что читается, и свободные имена.
-- ---------------------------------------------------------------------------
DO $a313_anchor$
BEGIN
  IF to_regclass('platform.profiles') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regclass('auth.users') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'organization_memberships' AND c.column_name = 'current_role')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'profiles' AND c.column_name = 'auth_user_id')
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'a313_anchor_drift' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.auth_user_has_staff_membership_v1(uuid)') IS NOT NULL
    OR to_regprocedure('platform.auth_user_by_exact_email_v1(text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a313_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a313_anchor$;

-- ---------------------------------------------------------------------------
-- a) Членство сотрудника в любом статусе.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.auth_user_has_staff_membership_v1(p_auth_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership ON membership.profile_id = profile.id
    WHERE profile.auth_user_id = p_auth_user_id
      -- Роль NULL (приглашённый или подготовленный сотрудник) тоже сотрудник: IS DISTINCT FROM,
      -- как у staff_membership_identity (155).
      AND membership."current_role" IS DISTINCT FROM 'student'
  )
$$;

-- ---------------------------------------------------------------------------
-- b) Точечный поиск пользователя Auth по точному адресу.
-- ---------------------------------------------------------------------------
-- plpgsql, а не sql: тело разбирается при первом вызове. В управляемом Auth колонки таблицы
-- auth.users есть всегда, а в облегчённой заготовке проверочной базы (supabase/tests/bootstrap_supabase.sql)
-- их нет до теста, который добавляет их в своей транзакции (так же, как 126 и 157).
CREATE FUNCTION platform.auth_user_by_exact_email_v1(p_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email TEXT := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_rows JSONB;
BEGIN
  IF v_email IS NULL
    OR pg_catalog.char_length(v_email) NOT BETWEEN 3 AND 320
    OR pg_catalog.strpos(v_email, '@') = 0
    OR v_email ~ '[[:space:][:cntrl:]]'
  THEN
    RAISE EXCEPTION 'auth_user_email_invalid' USING ERRCODE = '22023';
  END IF;

  -- Не больше двух строк: достаточно, чтобы отличить «один» от «неясно».
  SELECT pg_catalog.jsonb_agg(matches.answer) INTO v_rows
  FROM (
    SELECT pg_catalog.jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'email_confirmed_at',
        pg_catalog.to_char(u.email_confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmed_at',
        pg_catalog.to_char(u.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'confirmation_sent_at',
        pg_catalog.to_char(u.confirmation_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'invited_at',
        pg_catalog.to_char(u.invited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'app_metadata', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'evo_staff_password_request_id', u.raw_app_meta_data -> 'evo_staff_password_request_id')),
      'user_metadata', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'evo_staff_invitation_request_id', u.raw_user_meta_data -> 'evo_staff_invitation_request_id'))
    ) AS answer
    FROM auth.users AS u
    WHERE pg_catalog.lower(u.email) = v_email
    LIMIT 2
  ) AS matches;

  IF v_rows IS NULL THEN
    RETURN NULL;
  END IF;
  IF pg_catalog.jsonb_array_length(v_rows) > 1 THEN
    RAISE EXCEPTION 'auth_user_email_ambiguous' USING ERRCODE = '21000';
  END IF;
  RETURN v_rows -> 0;
END
$$;

REVOKE ALL ON FUNCTION platform.auth_user_has_staff_membership_v1(UUID),
  platform.auth_user_by_exact_email_v1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.auth_user_has_staff_membership_v1(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION platform.auth_user_by_exact_email_v1(TEXT) TO service_role;

COMMENT ON FUNCTION platform.auth_user_has_staff_membership_v1(UUID) IS
  'Migration 313: service-only (service_role): does this Auth user have a staff membership in ANY status (invited, active, inactive, blocked) in any organization? Staff = a membership whose role is not student (a membership without a role counts). Student, no profile, a profile without a membership, an unknown or NULL id: FALSE. Used by the student password-recovery action to send no student email to staff.';
COMMENT ON FUNCTION platform.auth_user_by_exact_email_v1(TEXT) IS
  'Migration 313: service-only (service_role): the one Auth user whose email equals p_email (case-insensitive, trimmed), as JSONB {id, email, email_confirmed_at, confirmed_at, confirmation_sent_at, invited_at (UTC ...Z), app_metadata {evo_staff_password_request_id only}, user_metadata {evo_staff_invitation_request_id only}}; NULL when there is none; 21000 auth_user_email_ambiguous for two or more; 22023 auth_user_email_invalid for an empty, overlong or malformed address. Replaces the page-by-page auth.admin.listUsers scan.';

-- ---------------------------------------------------------------------------
-- Проверка в конце: определитель, пустой search_path, EXECUTE только у service_role, формы функций.
-- Сами функции здесь не вызываются: в проверочной базе таблица auth.users - облегчённая заготовка.
-- ---------------------------------------------------------------------------
DO $a313_verify$
DECLARE
  routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid, p.prosecdef, p.proconfig, p.provolatile, p.prorettype
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'platform.auth_user_has_staff_membership_v1(uuid)'::regprocedure,
      'platform.auth_user_by_exact_email_v1(text)'::regprocedure)
  LOOP
    IF NOT routine.prosecdef
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR routine.provolatile <> 's'
      OR NOT has_function_privilege('service_role', routine.oid, 'EXECUTE')
      OR has_function_privilege('anon', routine.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', routine.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', routine.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', routine.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc q, pg_catalog.aclexplode(q.proacl) a
        WHERE q.oid = routine.oid AND a.grantee = 0)
    THEN
      RAISE EXCEPTION 'a313_verify_function: %', routine.oid::regprocedure USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT prorettype FROM pg_catalog.pg_proc
      WHERE oid = 'platform.auth_user_has_staff_membership_v1(uuid)'::regprocedure) <> 'boolean'::regtype
    OR (SELECT prorettype FROM pg_catalog.pg_proc
      WHERE oid = 'platform.auth_user_by_exact_email_v1(text)'::regprocedure) <> 'jsonb'::regtype
  THEN
    RAISE EXCEPTION 'a313_verify_return_types' USING ERRCODE = '55000';
  END IF;
END
$a313_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
