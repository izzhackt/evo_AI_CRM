-- 313 «Удаление аккаунта (280): доработки P3 после независимого review 15.10.2026»
-- (issue #1192; docs/PLAN_CHANGES.md «2026-10-21 · Удаление аккаунта (280): доработки P3
-- (миграция 313)»). Номер 313 - следующий свободный после 312 на момент написания; при слиянии
-- сверяется и, если занят, меняется на следующий (имя файла и записи PLAN_CHANGES, тест
-- журнала tests/platform-audit.test.mjs и хук набора в scripts/test-postgres-authorization.sh
-- ищутся по имени файла/слуга, а не по номеру).
--
-- Forward-only, ничего не удаляет. Таблицы и права не добавляются; заменяются тела восьми функций
-- 280 (каждая привязана к md5 прежнего определения: чужой дрейф останавливает миграцию), одно
-- ограничение таблицы запросов расширяется, добавляется одна функция чтения. Права `authenticated`
-- на прежние RPC не меняются.
--
--  a) SQL-1. `account_deletion_auth_log_erase` молча пропускала очистку журнала Auth, если у
--     владельца функции нет права DELETE на `auth.audit_log_entries` или `auth.flow_state`, и
--     результат нигде не сохранялся. Теперь она возвращает `{status: erased|not_erased, entries}`;
--     `process_account_deletion_v1` и `complete_account_deletion_v1` пишут последний результат в
--     `summary.authLog` и в `after_state.auth_log` записи журнала; `staff_account_deletion_detail_v1`
--     отдаёт `authLog`, и CRM показывает «журнал входов Auth не очищен». Запрос при этом не
--     блокируется: вход и записи уже удалены, откатывать нечего, а остаток делает технический
--     администратор по инструкции.
--  b) SQL-2. `complete_account_deletion_v1` считала любой остаток строки в `auth.users` живым
--     входом. Мягко удалённый пользователь (`auth.admin.deleteUser(id, true)`: почта и пароль
--     обезличены, сессии удалены, войти нельзя) закрыть автоматический запрос не давал, а
--     `mark_account_deletion_done_v1` для `processing` отказывала. Теперь `complete` закрывает
--     запрос, если вход не активен (`absent` или `disabled`); активный по-прежнему
--     `account_deletion_auth_user_exists`. У отключённого входа строка Auth и всё, что на неё
--     ссылается, остаётся, поэтому `complete` заново проверяет простоту аккаунта и при
--     появившихся связанных записях отказывает `account_deletion_not_simple` (как `process`):
--     порог держит база, а не экран CRM.
--  c) F3. Запрос в `processing`, у которого аккаунт снова стал «не простым» (анкета подана
--     повторно, одобрена параллельно), не закрывался ничем: `process` отказывает
--     (`account_deletion_not_simple`), `complete` ждёт удаления входа, `mark` отказывал по статусу.
--     Теперь: `account_deletion_plan` отдаёт такому запросу режим `manual`;
--     `mark_account_deletion_done_v1` принимает `processing`, пока аккаунт не прост (и, как
--     всегда, только когда вход не активен); простой начатый запрос `mark` по-прежнему отклоняет
--     (`account_deletion_processing`: его доводит «Повторить удаление»); ограничение формы
--     допускает ручное закрытие запроса, который уже начинали обрабатывать автоматически.
--  d) SQL-3. Пять действий аудита удаления (`account.deletion.request|process|complete|
--     manual.complete|email`) и тип объекта `account_deletion_request` не входили в allowlist
--     «Журнала действий». Они добавлены приёмом rename-and-union (255, 291, 302, 311). Безопасная
--     строка журнала несёт только действие, тип, идентификатор запроса, категорию актора и код
--     запроса: ни имени, ни почты, ни идентификатора Auth.
--  e) UI-F4. `account_deletion_queue_row` получает `applicationSubmitted` (true/false/null): у
--     аккаунта без одобрения - была ли анкета. Открытый запрос читает таблицу анкет, начатый или
--     выполненный - счётчик `summary.counts.application`; для студента и ручного выполненного
--     запроса без счётчиков - null.
--  f) UI-F6. `platform.staff_account_deletion_open_count_v1()`: `{open, overdue}` для счётчика
--     «Запросы на удаление» в CRM; только `account.deletion.process` (системный Admin). Дешёвый
--     подсчёт по индексу очереди, без обхода записей аккаунтов.
--
-- Порядок выката. Приложение без миграции работает: новые ключи ответов читаются как отсутствующие,
-- а попытка завершить запрос после сбоя удаления входа просто получит прежний отказ базы.
-- Миграция без приложения безвредна: старый разбор ответов лишние ключи не читает; новые действия
-- журнала старое приложение покажет как нераспознанные строки, а не уронит страницу.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, которые заменяются, ровно такие, какими их оставила 280, и новые имена свободны.
-- ---------------------------------------------------------------------------
DO $a313_anchor$
BEGIN
  IF to_regclass('platform_private.account_deletion_requests') IS NULL
    OR to_regprocedure('platform_private.account_deletion_auth_log_erase(uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_login(uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_check(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.account_deletion_staff_actor()') IS NULL
    OR to_regprocedure('platform_private.account_deletion_result(platform_private.account_deletion_requests)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
  THEN
    RAISE EXCEPTION 'a313_anchor_drift: the 280 objects are missing' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform_private.account_deletion_auth_log_erase(uuid)'::regprocedure)
        IS DISTINCT FROM '142393be6238b0f3df2f0fd3cb7ff5c6'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.process_account_deletion_v1(uuid)'::regprocedure)
        IS DISTINCT FROM '3dcb8c286f5f3bb4ffa5932f7c6c4f57'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.complete_account_deletion_v1(uuid)'::regprocedure)
        IS DISTINCT FROM '52ec4bde1cce0ed86e5f83dcd7b567d5'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.mark_account_deletion_done_v1(uuid,text)'::regprocedure)
        IS DISTINCT FROM '675dc7dcea44ed28ffa79f295c2bd4b0'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform_private.account_deletion_plan(platform_private.account_deletion_requests)'::regprocedure)
        IS DISTINCT FROM '153bba2a8c096b0759f29e0fc1cd81fe'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)'::regprocedure)
        IS DISTINCT FROM '62b714ba14cef540647c793c309a40d4'
    OR (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = 'platform.staff_account_deletion_detail_v1(uuid)'::regprocedure)
        IS DISTINCT FROM '3c43a59060c1b9c8aab473546221c6b2'
  THEN
    RAISE EXCEPTION 'a313_anchor_drift: a replaced function is not the 280 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform_private.account_deletion_requests'::regclass
        AND c.conname = 'account_deletion_requests_shape_check') IS NULL
    OR (SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform_private.account_deletion_requests'::regclass
        AND c.conname = 'account_deletion_requests_shape_check')
        NOT LIKE '%(completion_mode = ''manual''::text) AND (processing_started_at IS NULL) AND (manual_note IS NOT NULL)%'
  THEN
    RAISE EXCEPTION 'a313_anchor_drift: account_deletion_requests_shape_check is not the 280 constraint' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.staff_account_deletion_open_count_v1()') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_account_deletion_journal()') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal()') IS NOT NULL
    OR 'account.deletion.request' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'account_deletion_request' = ANY (platform_private.p7a_safe_audit_resource_types())
  THEN
    RAISE EXCEPTION 'a313_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a313_anchor$;

-- ---------------------------------------------------------------------------
-- c) Ограничение формы: ручное закрытие допускает запрос, который уже начинали
-- обрабатывать автоматически (processing_started_at не обязан быть пустым).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.account_deletion_requests
  DROP CONSTRAINT account_deletion_requests_shape_check,
  ADD CONSTRAINT account_deletion_requests_shape_check CHECK (
    (status = 'requested' AND acknowledged_at IS NULL AND acknowledged_by_membership_id IS NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_at IS NOT NULL AND acknowledged_by_membership_id IS NOT NULL
      AND processing_started_at IS NULL AND completed_at IS NULL)
    OR (status = 'processing' AND processing_started_at IS NOT NULL
      AND processing_started_by_membership_id IS NOT NULL AND last_processed_at IS NOT NULL
      AND completed_at IS NULL)
    -- Automatic: after processing, no note. Manual: a note; the automatic processing may have
    -- started before the account stopped being simple (313).
    OR (status = 'completed' AND completed_at IS NOT NULL AND completed_by_membership_id IS NOT NULL
      AND ((completion_mode = 'automatic' AND processing_started_at IS NOT NULL AND manual_note IS NULL)
        OR (completion_mode = 'manual' AND manual_note IS NOT NULL)))
  );

-- ---------------------------------------------------------------------------
-- a) SQL-1. Очистка журнала Auth возвращает результат. Тип результата меняется
-- (BIGINT -> JSONB), поэтому DROP + CREATE; вызывают её только функции ниже.
-- ---------------------------------------------------------------------------
DROP FUNCTION platform_private.account_deletion_auth_log_erase(UUID);
CREATE FUNCTION platform_private.account_deletion_auth_log_erase(p_auth_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE entries BIGINT := 0; erased BOOLEAN := TRUE;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erased', 'entries', 0);
  END IF;
  -- Стирается всё, что разрешено; статус говорит, всё ли. Таблицы нет вовсе (другая версия
  -- Auth) - стирать нечего. Подтранзакция на случай отказа в правах уже во время DELETE.
  BEGIN
    IF to_regclass('auth.flow_state') IS NOT NULL THEN
      IF has_table_privilege('auth.flow_state', 'DELETE') THEN
        DELETE FROM auth.flow_state f WHERE f.user_id = p_auth_user_id;
      ELSE
        erased := FALSE;
      END IF;
    END IF;
    IF to_regclass('auth.audit_log_entries') IS NOT NULL THEN
      IF has_table_privilege('auth.audit_log_entries', 'DELETE') THEN
        DELETE FROM auth.audit_log_entries e
        WHERE e.payload ->> 'actor_id' = p_auth_user_id::TEXT
          OR e.payload -> 'traits' ->> 'user_id' = p_auth_user_id::TEXT;
        GET DIAGNOSTICS entries = ROW_COUNT;
      ELSE
        erased := FALSE;
      END IF;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    erased := FALSE;
    entries := 0;
  END;
  RETURN jsonb_build_object('status', CASE WHEN erased THEN 'erased' ELSE 'not_erased' END, 'entries', entries);
END
$$;
REVOKE ALL ON FUNCTION platform_private.account_deletion_auth_log_erase(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.account_deletion_auth_log_erase(UUID) IS
  'Migration 313: erases the Supabase Auth journal entries and PKCE flows keyed by the user id and returns {status: erased|not_erased, entries}; not_erased when the function owner lacks DELETE on an Auth table. Owner-only.';

-- ---------------------------------------------------------------------------
-- c) + e) план: режим «ручная» для начатого запроса, который стал не простым; результат
-- очистки журнала Auth. Прежнее тело, одно условие режима и один ключ.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.account_deletion_plan(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE chk JSONB; login TEXT;
BEGIN
  IF r.status = 'completed' THEN
    RETURN jsonb_build_object('mode', r.completion_mode, 'reasons', '[]'::JSONB, 'otherTables', '[]'::JSONB,
      'counts', COALESCE(r.summary -> 'counts', '{}'::JSONB),
      'login', platform_private.account_deletion_login(r.subject_auth_user_id),
      'authLog', r.summary #>> '{authLog,status}');
  END IF;
  chk := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id);
  login := platform_private.account_deletion_login(r.subject_auth_user_id);
  RETURN jsonb_build_object(
    -- Автоматически: аккаунт прост, и удаление ещё не сделано целиком (начатое доводится до
    -- конца) или вход ещё есть. Начатый запрос, который стал не простым, - только вручную.
    'mode', CASE WHEN jsonb_array_length(chk -> 'reasons') = 0 AND (r.status = 'processing' OR login <> 'absent')
      THEN 'automatic' ELSE 'manual' END,
    'reasons', chk -> 'reasons',
    'otherTables', COALESCE(chk #> '{closure,other}', '[]'::JSONB),
    'counts', platform_private.account_deletion_counts(chk -> 'closure'),
    'login', login,
    'authLog', r.summary #>> '{authLog,status}');
END
$$;

-- ---------------------------------------------------------------------------
-- e) строка очереди: была ли анкета у аккаунта без одобрения.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_private.account_deletion_queue_row(r platform_private.account_deletion_requests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'kind', r.subject_kind,
    'status', CASE WHEN r.status = 'acknowledged' THEN 'requested' ELSE r.status END,
    'mode', plan ->> 'mode',
    'displayName', person.display_name,
    'email', person.email,
    'studentCaseId', person.student_case_id,
    'requestedAt', r.created_at,
    'dueAt', r.due_at,
    'overdue', r.status <> 'completed' AND r.due_at < clock_timestamp(),
    'processingStartedAt', r.processing_started_at,
    'completedAt', r.completed_at,
    'confirmationEmailStatus', r.confirmation_email_status,
    -- Аккаунт без одобрения: подавал ли он анкету. Начатый и выполненный запрос уже удалил строки
    -- анкеты, поэтому читает счётчик сводки (null, если счётчика нет: ручной запрос).
    'applicationSubmitted', CASE
      WHEN r.subject_kind <> 'applicant' THEN NULL
      WHEN r.status IN ('processing', 'completed')
        THEN (r.summary #>> '{counts,application}')::NUMERIC > 0
      ELSE EXISTS (SELECT 1 FROM platform_private.student_applications a
        WHERE a.auth_user_id = r.subject_auth_user_id) END)
  FROM platform_private.account_deletion_person(r) person,
    platform_private.account_deletion_plan(r) plan
$$;

CREATE OR REPLACE FUNCTION platform.staff_account_deletion_detail_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; r platform_private.account_deletion_requests%ROWTYPE; plan JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  plan := platform_private.account_deletion_plan(r);
  RETURN platform_private.account_deletion_queue_row(r) || jsonb_build_object(
    'reasons', plan -> 'reasons',
    'otherTables', plan -> 'otherTables',
    'counts', plan -> 'counts',
    'login', plan -> 'login',
    'authLog', plan -> 'authLog',
    'manualNote', r.manual_note,
    'processingStartedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.processing_started_by_membership_id),
    'completedBy', (SELECT p.display_name FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = r.organization_id AND m.id = r.completed_by_membership_id));
END
$$;

-- ---------------------------------------------------------------------------
-- a) AUTOMATIC, database part: результат очистки журнала Auth попадает в сводку и в журнал.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.process_account_deletion_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  chk JSONB;
  closure JSONB;
  deleted JSONB;
  auth_log JSONB;
  v_email TEXT;
  first_run BOOLEAN;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || r.subject_auth_user_id::TEXT, 0));

  chk := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id);
  IF jsonb_array_length(chk -> 'reasons') > 0 THEN
    RAISE EXCEPTION 'account_deletion_not_simple' USING ERRCODE = '55000',
      DETAIL = (SELECT string_agg(x, ',') FROM jsonb_array_elements_text(chk -> 'reasons') x);
  END IF;
  closure := COALESCE(chk -> 'closure', '{}'::JSONB);
  first_run := r.status IN ('requested', 'acknowledged');
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = r.subject_auth_user_id;

  -- The kept request rows of this account stop naming its membership.
  UPDATE platform_private.account_deletion_requests x SET membership_id = NULL
  WHERE x.subject_auth_user_id = r.subject_auth_user_id AND x.membership_id IS NOT NULL;
  UPDATE platform_private.account_deletion_requests x SET
    erasure_transaction_id = pg_catalog.pg_current_xact_id(),
    confirmation_email = COALESCE(v_email, x.confirmation_email)
  WHERE x.id = r.id;
  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', r.id::TEXT, TRUE);
  deleted := platform_private.account_deletion_erase(closure);
  PERFORM pg_catalog.set_config('platform.account_erasure_request_id', '', TRUE);
  auth_log := platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id);

  UPDATE platform_private.account_deletion_requests x SET
    erasure_transaction_id = NULL,
    status = 'processing',
    processing_started_at = COALESCE(x.processing_started_at, clock_timestamp()),
    processing_started_by_membership_id = COALESCE(x.processing_started_by_membership_id, actor.membership_id),
    last_processed_at = clock_timestamp(),
    summary = CASE WHEN first_run OR x.summary IS NULL
      THEN jsonb_build_object('counts', platform_private.account_deletion_counts(closure)) ELSE x.summary END
      || jsonb_build_object('authLog', auth_log)
  WHERE x.id = r.id
  RETURNING * INTO r;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.process', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'subject_kind', r.subject_kind, 'deleted', deleted,
      'auth_log', auth_log ->> 'status'),
    CASE WHEN first_run THEN 'Own rows of a simple account deleted in the database'
      ELSE 'Own rows of a simple account deleted again in the database' END,
    gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- ---------------------------------------------------------------------------
-- a) + b) AUTOMATIC, last step: вход не активен (удалён или отключён мягко); результат
-- очистки журнала Auth попадает в сводку и в журнал.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.complete_account_deletion_v1(p_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  login TEXT;
  chk JSONB;
  auth_log JSONB;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  IF r.status <> 'processing' THEN
    RAISE EXCEPTION 'account_deletion_not_processed' USING ERRCODE = '55000';
  END IF;
  -- Вход, которым нельзя войти, не мешает: удалён целиком или отключён мягким удалением Auth
  -- (почта и пароль обезличены, сессии сняты). Остаток строки Auth виден в карточке (вход).
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || r.subject_auth_user_id::TEXT, 0));
  login := platform_private.account_deletion_login(r.subject_auth_user_id);
  IF login = 'active' THEN
    RAISE EXCEPTION 'account_deletion_auth_user_exists' USING ERRCODE = '55000';
  END IF;
  -- Строка Auth осталась (мягкое удаление): в 280 «строки нет» означало, что всё, что на неё
  -- ссылается, уже ушло; у отключённого входа это не так. Автоматически закрывается только
  -- простой аккаунт - база сама держит этот порог, а не экран CRM (отказ тот же, что у process).
  IF login <> 'absent' THEN
    chk := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id);
    IF jsonb_array_length(chk -> 'reasons') > 0 THEN
      RAISE EXCEPTION 'account_deletion_not_simple' USING ERRCODE = '55000',
        DETAIL = (SELECT string_agg(x, ',') FROM jsonb_array_elements_text(chk -> 'reasons') x);
    END IF;
  END IF;
  -- deleteUser wrote its own «user_deleted» entry.
  auth_log := platform_private.account_deletion_auth_log_erase(r.subject_auth_user_id);
  UPDATE platform_private.account_deletion_requests x SET
    status = 'completed', completion_mode = 'automatic',
    completed_at = clock_timestamp(), completed_by_membership_id = actor.membership_id,
    summary = COALESCE(x.summary, '{}'::JSONB) || jsonb_build_object('authLog', auth_log)
  WHERE x.id = r.id
  RETURNING * INTO r;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.complete', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'mode', r.completion_mode, 'subject_kind', r.subject_kind,
      'login', login, 'auth_log', auth_log ->> 'status'),
    'Account deletion completed automatically', gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- ---------------------------------------------------------------------------
-- c) MANUAL: processing принимается, когда аккаунт стал не простым. Простой начатый
-- запрос по-прежнему закрывается автоматически («Повторить удаление»).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.mark_account_deletion_done_v1(p_id UUID, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  r platform_private.account_deletion_requests%ROWTYPE;
  reasons JSONB;
  login TEXT;
  note TEXT := btrim(p_note);
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  IF p_id IS NULL OR note IS NULL OR char_length(note) NOT BETWEEN 10 AND 2000
    OR note ~ '[\x01-\x09\x0b-\x1f\x7f]' THEN
    RAISE EXCEPTION 'account_deletion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM platform_private.account_deletion_requests x
  WHERE x.id = p_id AND x.organization_id = actor.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'completed' THEN
    RETURN platform_private.account_deletion_result(r);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evo:account-deletion-subject:' || r.subject_auth_user_id::TEXT, 0));
  login := platform_private.account_deletion_login(r.subject_auth_user_id);
  -- Начатый запрос проверяется всегда: пока аккаунт прост, его закрывает автоматический путь,
  -- а вручную - только тот, у которого появились связанные записи (313).
  IF login <> 'absent' OR r.status = 'processing' THEN
    reasons := platform_private.account_deletion_check(r.organization_id, r.subject_auth_user_id) -> 'reasons';
    IF jsonb_array_length(reasons) = 0 THEN
      IF r.status = 'processing' THEN
        RAISE EXCEPTION 'account_deletion_processing' USING ERRCODE = '55000';
      END IF;
      RAISE EXCEPTION 'account_deletion_automatic_available' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF login = 'active' THEN
    RAISE EXCEPTION 'account_deletion_login_active' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.account_deletion_requests x SET
    status = 'completed', completion_mode = 'manual', manual_note = note,
    completed_at = clock_timestamp(), completed_by_membership_id = actor.membership_id
  WHERE x.id = r.id
  RETURNING * INTO r;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id, actor_principal,
    action, resource_type, resource_id, after_state, reason, request_id
  ) VALUES (
    r.organization_id, 'user', actor.profile_id, actor.membership_id, 'auth:' || actor.auth_user_id::TEXT,
    'account.deletion.manual.complete', 'account_deletion_request', r.id,
    jsonb_build_object('status', r.status, 'mode', r.completion_mode, 'subject_kind', r.subject_kind,
      'reasons', COALESCE(reasons, '[]'::JSONB), 'login', login,
      'started_automatic', r.processing_started_at IS NOT NULL),
    note, gen_random_uuid()
  );
  RETURN platform_private.account_deletion_result(r);
END
$$;

-- ---------------------------------------------------------------------------
-- f) Счётчик открытых запросов для CRM.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_account_deletion_open_count_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform_private.account_deletion_staff_actor();
  RETURN (
    SELECT jsonb_build_object(
      'open', count(*),
      'overdue', count(*) FILTER (WHERE r.due_at < clock_timestamp()))
    FROM platform_private.account_deletion_requests r
    WHERE r.organization_id = actor.organization_id AND r.status <> 'completed');
END
$$;
REVOKE ALL ON FUNCTION platform.staff_account_deletion_open_count_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_account_deletion_open_count_v1() TO authenticated;
COMMENT ON FUNCTION platform.staff_account_deletion_open_count_v1() IS
  'Migration 313: {open, overdue} counts of the organization''s not completed account deletion requests, for the CRM counter. account.deletion.process only (the system Admin); everyone else 42501. No person data.';

-- ---------------------------------------------------------------------------
-- d) «Журнал действий»: пять действий удаления и тип объекта (rename-and-union).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_account_deletion_journal;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_account_deletion_journal()
      || ARRAY[
    'account.deletion.complete',
    'account.deletion.email',
    'account.deletion.manual.complete',
    'account.deletion.process',
    'account.deletion.request'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_account_deletion_journal;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal()
      || ARRAY[
    'account_deletion_request'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_account_deletion_journal(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Проверка в конце: allowlist, форма и права заменённых и новой функций.
-- ---------------------------------------------------------------------------
DO $a313_verify$
DECLARE
  routine RECORD;
BEGIN
  IF NOT ('account.deletion.request' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('account.deletion.process' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('account.deletion.complete' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('account.deletion.manual.complete' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('account.deletion.email' = ANY (platform_private.p7a_safe_audit_actions()))
    OR 'account.deletion.request' = ANY (platform_private.p7a_safe_audit_actions_pre_account_deletion_journal())
    OR NOT ('case.direction.set' = ANY (platform_private.p7a_safe_audit_actions()))
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_account_deletion_journal()) + 5
    OR NOT ('account_deletion_request' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR 'account_deletion_request' = ANY (platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal())
    OR cardinality(platform_private.p7a_safe_audit_resource_types())
      <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_account_deletion_journal()) + 1
  THEN
    RAISE EXCEPTION 'a313_verify_allowlist' USING ERRCODE = '55000';
  END IF;

  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'platform.process_account_deletion_v1(uuid)'::REGPROCEDURE,
      'platform.complete_account_deletion_v1(uuid)'::REGPROCEDURE,
      'platform.mark_account_deletion_done_v1(uuid,text)'::REGPROCEDURE,
      'platform.staff_account_deletion_detail_v1(uuid)'::REGPROCEDURE,
      'platform.staff_account_deletion_open_count_v1()'::REGPROCEDURE,
      'platform_private.account_deletion_auth_log_erase(uuid)'::REGPROCEDURE,
      'platform_private.account_deletion_plan(platform_private.account_deletion_requests)'::REGPROCEDURE,
      'platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)'::REGPROCEDURE)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION 'a313_verify_function: %', routine.signature USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.process_account_deletion_v1(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.complete_account_deletion_v1(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.mark_account_deletion_done_v1(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
    OR has_function_privilege('service_role', 'platform.staff_account_deletion_open_count_v1()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.account_deletion_auth_log_erase(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform_private.p7a_safe_audit_actions()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_resource_types()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a313_verify_grants' USING ERRCODE = '55000';
  END IF;
END
$a313_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
