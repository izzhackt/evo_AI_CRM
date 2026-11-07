-- ============================================================
-- 346_platform_account_deletion_login_tables.sql
--
-- Удаление аккаунта знает таблицы входа по логину и кабинетов от администратора (найденная ошибка 07.11.2026;
-- пользователь: исправить «после галочек», docs/design/v3/product.md «07.11 — Согласия при регистрации»). Хуки набора
-- в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- 280 удаляет «простой» аккаунт кнопкой, только если всё, что ссылается на пользователя Auth, лежит в «своих» таблицах
-- (`own` в account_deletion_closure). Таблицы 340 (логин), 342/343 (кто и когда создал кабинет) и 344 (сбросы пароля)
-- в список не попали: у любого аккаунта с логином замыкание называло их «другими записями», и такой аккаунт уходил в
-- ручную обработку. Теперь они «свои» и удаляются вместе с аккаунтом. Ссылки для регистрации (341) не добавлены: ссылка
-- принадлежит лиду, а аккаунт, зарегистрированный по ссылке, и так ручной — анкета привязана к лиду (причина «lead»).
-- Одно место в списке, тот же приём, что 320: проверенный фрагмент, иначе миграция падает, ничего не меняя.
-- Forward-only: повтор отказывает a346_already_applied.
-- ============================================================

BEGIN;

DO $a346_closure$
DECLARE
  v_def TEXT := pg_catalog.pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure);
  v_from CONSTANT TEXT := E'''platform_private.student_ai_consents''];';
  v_to CONSTANT TEXT := E'''platform_private.student_ai_consents'',\n'
    || E'    -- 346: вход по логину (340), кабинеты от администратора (342/343), сбросы пароля (344).\n'
    || E'    ''platform_private.student_logins'', ''platform_private.student_account_provisioning'',\n'
    || E'    ''platform_private.student_case_account_provisioning'', ''platform_private.student_password_resets''];';
BEGIN
  IF strpos(v_def, '''platform_private.student_logins''') <> 0 THEN
    RAISE EXCEPTION 'a346_already_applied' USING ERRCODE = '55000';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'a346_anchor_drift: the own-table list of account_deletion_closure is not the 320 one' USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END
$a346_closure$;

COMMIT;
