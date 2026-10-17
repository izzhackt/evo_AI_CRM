-- 293_platform_telephony_reconcile — «Телефония Beeline KG» срез T4a: сверка по
-- истории ВАТС, первичный импорт, справочник сотрудников ВАТС, состояние и
-- здоровье фоновой работы.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.3, §5.4 (сверка, первичный
-- импорт), §6.1, §6.3, §7.3, §9.1, §16 (срез T4a); ADR 0033; docs/PLAN_CHANGES.md
-- (запись «Телефония T4a»). Схема — 288 (T1a), приём и проекция — 289 (T1b).
-- Здесь функции, которые вызывает фоновый скрипт `telephony-maintenance`, и
-- несколько столбцов состояния. Клиент ВАТС, расписание и таймер — код
-- приложения, не база. Слияние ничего не открывает: каждая функция закрыта
-- флагом projection_enabled (отсутствие строки настроек = выключено), первичный
-- импорт — ещё и собственным флагом backfill_enabled (по умолчанию выключен).
--
-- Что делает:
--  * ALTER telephony_settings: backfill_enabled (выключен); ALTER
--    telephony_runtime_state: времена запусков справочника, суточной сверки,
--    первичного импорта и проверки здоровья, pbx_facts (часовой пояс, лимиты и
--    настройки записи ВАТС — только числа, флаги и название пояса),
--    mode_summaries (счётчики последних прогонов — только числа);
--  * platform.telephony_maintenance_plan_v1 (только service_role) — что пора
--    делать и в каких окнах: повтор проекции и окно успокоения (раз в запуск),
--    справочник и проверка здоровья (раз в 10 минут и в час), сверка (окно от
--    курсора минус два часа, не больше суток за прогон), суточная сверка
--    «вчера целиком» (после 03:00 по Бишкеку), первичный импорт (суточные окна
--    назад от «сейчас» до 22.10.2025);
--  * platform.telephony_sync_extensions_v1 — справочник telephony_extensions по
--    GET /users: логин (без учёта регистра), внутренний номер, имя; сотрудника EVO
--    функция НЕ назначает (сопоставление подтверждает admin, срез T4b); строки
--    пропавших из полного списка — active = false, не удаление;
--  * platform.telephony_reconcile_apply_v1 — пачка строк GET /history/json в
--    звонки и ноги. Режим reconcile создаёт недостающие звонки
--    (created_via = 'reconcile'), режим backfill — только для номеров, уже
--    совпавших с клиентом EVO (created_via = 'backfill'), остальные строки
--    отбрасываются без сохранения. Итог по сверке неточный: outcome_source =
--    'pull', outcome — answered / missed / no_answer_unknown (§5.4). Точный итог
--    вебхука сверка не перезаписывает, а дополняет: время разговора, ожидание,
--    адресат (destination), подсказку missedStatus, номер, ссылку на запись
--    (пока звонку меньше 360 дней); ответ необратим;
--  * platform.telephony_runtime_mark_v1 — отметка прогона: курсоры (сверка
--    сдвигается только вперёд, импорт — только назад), времена, ошибка ВАТС
--    кодом (без текста), счётчики, факты ВАТС;
--  * platform.telephony_integration_health_v1 — данные здоровья для «Настроек»
--    (срез T4b): флаги, справочник, расписание, курсоры, ВАТС (последняя ошибка
--    кодом, факты), расхождения за сутки, принятые сообщения за сутки (всего,
--    отклонено после проверки ключа, неполных), остановка автоматики, очередь.
--    Только числа, времена и слова, ни номеров, ни логинов, ни ссылок.
--
-- Замки как в 289: SECURITY DEFINER, search_path = '', проверка роли
-- service_role внутри (42501 иначе, в том числе для роли БД service_role без
-- служебной заявки), EXECUTE только у service_role; частные помощники без
-- грантов; самопроверка в конце откатывает миграцию, если это не так.
-- Нарушение целостности внутри построчного писателя ловится и наружу идёт только
-- SQLSTATE и имя ограничения или столбца (PLAN_CHANGES T1a, п. 13): ни значения,
-- ни ссылки, ни номера в ответе нет.
--
-- Безопасно для production: новые функции, два помощника проверки формы и новые
-- столбцы с безопасными значениями по умолчанию; ни одна существующая функция,
-- политика или право не меняется; пока строки настроек нет или
-- projection_enabled = false, функции ничего не пишут в звонки.
BEGIN;

DO $tel293_preconditions$
BEGIN
  IF to_regclass('platform_private.telephony_settings') IS NULL
    OR to_regclass('platform_private.telephony_runtime_state') IS NULL
    OR to_regclass('platform_private.telephony_extensions') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_call_legs') IS NULL
    OR to_regclass('platform_private.telephony_call_events') IS NULL
    OR to_regclass('platform_private.telephony_event_work') IS NULL
    OR to_regprocedure('platform_private.telephony_recompute_call(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.telephony_resolve_user(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_match_phone(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_phone_e164(text)') IS NULL
    OR to_regprocedure('platform_private.telephony_parse_ts(text)') IS NULL
    OR to_regprocedure('platform_private.telephony_to_int(text)') IS NULL
    OR to_regprocedure('platform_private.telephony_status_word(text)') IS NULL
    OR to_regprocedure('platform_private.telephony_clean_text(text,integer)') IS NULL
    OR to_regprocedure('platform_private.telephony_error_code(text,text,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_leg_state_merge(text,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_projection_enabled(uuid)') IS NULL
    OR to_regprocedure('platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'telephony_t4a_requires_t1b' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid IN ('platform_private.telephony_settings'::REGCLASS,
        'platform_private.telephony_runtime_state'::REGCLASS)
      AND NOT a.attisdropped
      AND a.attname IN ('backfill_enabled', 'users_sync_run_at', 'users_sync_success_at',
        'reconcile_daily_run_at', 'reconcile_daily_success_at', 'backfill_run_at', 'probe_run_at',
        'probe_success_at', 'pbx_facts', 'mode_summaries')
  ) THEN
    RAISE EXCEPTION 'telephony_t4a_columns_already_exist' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('telephony_maintenance_plan_v1', 'telephony_sync_extensions_v1',
        'telephony_reconcile_apply_v1', 'telephony_runtime_mark_v1', 'telephony_integration_health_v1',
        'telephony_summary_ok', 'telephony_facts_ok', 'telephony_reconcile_row')
      AND n.nspname IN ('platform', 'platform_private')
  ) THEN
    RAISE EXCEPTION 'telephony_t4a_functions_already_exist' USING ERRCODE = '55000';
  END IF;
END
$tel293_preconditions$;

-- ---------------------------------------------------------------------------
-- Проверки формы (IMMUTABLE; для CHECK; без грантов). Только числа, флаги и
-- короткие слова: ни номеров, ни логинов, ни ссылок, ни текста ВАТС.
-- ---------------------------------------------------------------------------

-- Счётчики прогонов: {"reconcile": {"rows": 12, "created": 1, …}, "backfill": {…}}.
CREATE FUNCTION platform_private.telephony_summary_ok(p_summary JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r RECORD; c RECORD;
BEGIN
  IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN RETURN FALSE; END IF;
  FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_summary) e LOOP
    IF r.k NOT IN ('reconcile', 'daily', 'backfill', 'users') OR jsonb_typeof(r.v) <> 'object' THEN
      RETURN FALSE;
    END IF;
    FOR c IN SELECT x.key AS k, x.value AS v FROM jsonb_each(r.v) x LOOP
      IF c.k !~ '^[a-z][a-z_]{0,31}$' OR jsonb_typeof(c.v) <> 'number' OR (c.v #>> '{}') !~ '^[0-9]{1,12}$' THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  END LOOP;
  RETURN TRUE;
END
$$;

-- Факты ВАТС (GET /domain, GET /record, GET /groups): название пояса, целые
-- числа и флаги. Список имён закрыт.
CREATE FUNCTION platform_private.telephony_facts_ok(p_facts JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r RECORD;
BEGIN
  IF p_facts IS NULL OR jsonb_typeof(p_facts) <> 'object' THEN RETURN FALSE; END IF;
  FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_facts) e LOOP
    IF r.k = 'timezone_name' THEN
      IF jsonb_typeof(r.v) <> 'string' OR (r.v #>> '{}') !~ '^[A-Za-z0-9_/+-]{1,64}$' THEN RETURN FALSE; END IF;
    ELSIF r.k IN ('record_service', 'record_external', 'record_inner') THEN
      IF jsonb_typeof(r.v) <> 'boolean' THEN RETURN FALSE; END IF;
    ELSIF r.k IN ('timezone_offset_minutes', 'users_used', 'users_total', 'groups_total', 'record_exceptions') THEN
      IF jsonb_typeof(r.v) <> 'number' OR (r.v #>> '{}') !~ '^-?[0-9]{1,6}$' THEN RETURN FALSE; END IF;
    ELSE
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END
$$;

-- ---------------------------------------------------------------------------
-- Столбцы. Значения по умолчанию безопасны: флаг выключен, времена пусты.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.telephony_settings
  ADD COLUMN backfill_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN platform_private.telephony_settings.backfill_enabled IS
  'Telephony T4a: first import of one year of call metadata and recording links for clients already in EVO (plan 5.4). OFF until the owner says yes; needs projection_enabled too.';

ALTER TABLE platform_private.telephony_runtime_state
  ADD COLUMN users_sync_run_at TIMESTAMPTZ,
  ADD COLUMN users_sync_success_at TIMESTAMPTZ,
  ADD COLUMN reconcile_daily_run_at TIMESTAMPTZ,
  ADD COLUMN reconcile_daily_success_at TIMESTAMPTZ,
  ADD COLUMN backfill_run_at TIMESTAMPTZ,
  ADD COLUMN probe_run_at TIMESTAMPTZ,
  ADD COLUMN probe_success_at TIMESTAMPTZ,
  ADD COLUMN pbx_facts JSONB CHECK (pbx_facts IS NULL OR (platform_private.telephony_facts_ok(pbx_facts)
    AND pg_column_size(pbx_facts) <= 1024)),
  ADD COLUMN mode_summaries JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (platform_private.telephony_summary_ok(mode_summaries)
    AND pg_column_size(mode_summaries) <= 4096);
COMMENT ON COLUMN platform_private.telephony_runtime_state.pbx_facts IS
  'Telephony T4a: last GET /domain, /record, /groups facts (time zone name, limits, record settings). Numbers, flags and one zone name only.';
COMMENT ON COLUMN platform_private.telephony_runtime_state.mode_summaries IS
  'Telephony T4a: counters of the last reconcile, daily, backfill and users runs. Numbers only.';

-- ---------------------------------------------------------------------------
-- Что пора делать (чтение; окна считает база по своим часам).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_maintenance_plan_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tz CONSTANT TEXT := 'Asia/Bishkek';
  v_floor CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '2025-10-21 18:00:00+00'; -- 22.10.2025 00:00 Asia/Bishkek
  v_now TIMESTAMPTZ; v_today TIMESTAMPTZ;
  s platform_private.telephony_settings%ROWTYPE;
  rs platform_private.telephony_runtime_state%ROWTYPE;
  v_proj BOOLEAN; v_paused BOOLEAN; v_backfill BOOLEAN; v_dir INTEGER;
  v_cur TIMESTAMPTZ; v_rec_start TIMESTAMPTZ; v_rec_end TIMESTAMPTZ; v_rec_due BOOLEAN; v_rec_gap INTERVAL;
  v_day_due BOOLEAN; v_users_due BOOLEAN; v_probe_due BOOLEAN;
  v_bf_upper TIMESTAMPTZ; v_bf_lower TIMESTAMPTZ; v_bf_due BOOLEAN;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  v_today := (date_trunc('day', v_now AT TIME ZONE v_tz)) AT TIME ZONE v_tz;
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_organization_id;
  SELECT * INTO rs FROM platform_private.telephony_runtime_state x WHERE x.organization_id = p_organization_id;
  -- Без строки настроек всё выключено.
  v_proj := COALESCE(s.projection_enabled, FALSE);
  v_paused := COALESCE(s.outbound_paused, FALSE);
  v_backfill := COALESCE(s.backfill_enabled, FALSE);
  SELECT count(*) INTO v_dir FROM platform_private.telephony_extensions x
  WHERE x.organization_id = p_organization_id AND x.active;

  -- Справочник и проверка здоровья идут и при выключенной проекции: справочник
  -- должен быть заполнен ДО её включения (PLAN_CHANGES T1b, п. 13 (г)).
  v_users_due := rs.users_sync_run_at IS NULL OR rs.users_sync_run_at <= v_now - INTERVAL '570 seconds';
  v_probe_due := rs.probe_run_at IS NULL OR rs.probe_run_at <= v_now - INTERVAL '55 minutes';

  -- Сверка: окно от курсора минус два часа, не больше суток за прогон; без курсора
  -- — последние два часа. Отстав больше чем на сутки, догоняет каждую минуту.
  v_cur := rs.reconcile_cursor_at;
  v_rec_start := COALESCE(v_cur, v_now) - INTERVAL '2 hours';
  v_rec_end := LEAST(v_now, v_rec_start + INTERVAL '24 hours');
  v_rec_gap := CASE WHEN v_cur IS NOT NULL AND v_cur < v_now - INTERVAL '24 hours'
    THEN INTERVAL '50 seconds' ELSE INTERVAL '570 seconds' END;
  v_rec_due := v_proj AND v_dir > 0 AND (rs.reconcile_run_at IS NULL OR rs.reconcile_run_at <= v_now - v_rec_gap);

  -- «Вчера целиком» раз в сутки, после 03:00 по Бишкеку и после первого курсора.
  v_day_due := v_proj AND v_dir > 0 AND v_cur IS NOT NULL
    AND extract(hour FROM v_now AT TIME ZONE v_tz) >= 3
    AND (rs.reconcile_daily_success_at IS NULL OR rs.reconcile_daily_success_at < v_today)
    AND (rs.reconcile_daily_run_at IS NULL OR rs.reconcile_daily_run_at <= v_now - INTERVAL '30 minutes');

  -- Первичный импорт: суточные окна назад от момента первого запуска до 22.10.2025
  -- (сверка закрывает последние два часа, импорт идёт от «сейчас» назад без щели).
  v_bf_upper := COALESCE(rs.backfill_cursor_at, v_now);
  v_bf_lower := GREATEST(v_bf_upper - INTERVAL '24 hours', v_floor);
  v_bf_due := v_proj AND v_backfill AND v_dir > 0 AND rs.backfill_done_at IS NULL AND v_bf_upper > v_floor
    AND (rs.backfill_run_at IS NULL OR rs.backfill_run_at <= v_now - INTERVAL '50 seconds');

  RETURN jsonb_build_object(
    'status', 'ok',
    'now', v_now,
    'projection_enabled', v_proj,
    'outbound_paused', v_paused,
    'backfill_enabled', v_backfill,
    'directory_active', v_dir,
    'retry_due', v_proj,
    'settle_due', v_proj,
    'users_due', v_users_due,
    'probe_due', v_probe_due,
    'reconcile', jsonb_build_object('due', v_rec_due, 'window_start', v_rec_start, 'window_end', v_rec_end),
    'daily', jsonb_build_object('due', v_day_due, 'window_start', v_today - INTERVAL '24 hours', 'window_end', v_today),
    'backfill', jsonb_build_object('due', v_bf_due, 'window_start', v_bf_lower, 'window_end', v_bf_upper,
      'done', rs.backfill_done_at IS NOT NULL)
  );
END
$$;

-- ---------------------------------------------------------------------------
-- Справочник сотрудников ВАТС по GET /users (§6.3). Сотрудника EVO не назначает.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_sync_extensions_v1(
  p_organization_id UUID, p_users JSONB, p_complete BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ; r RECORD; x platform_private.telephony_extensions%ROWTYPE;
  v_login TEXT; v_ext TEXT; v_name TEXT; v_seen TEXT[] := ARRAY[]::TEXT[];
  v_received INTEGER := 0; v_invalid INTEGER := 0; v_inserted INTEGER := 0; v_updated INTEGER := 0;
  v_reactivated INTEGER := 0; v_conflicts INTEGER := 0; v_deactivated INTEGER := 0; v_active INTEGER;
  v_new_active BOOLEAN; v_n INTEGER;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_users IS NULL OR jsonb_typeof(p_users) <> 'array'
    OR jsonb_array_length(p_users) > 200 OR p_complete IS NULL THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();

  -- Сначала только проверка списка: пустой или негодный список ничего не меняет
  -- (иначе сбой ВАТС обнулил бы справочник и остановил проекцию).
  FOR r IN SELECT e.value AS v FROM jsonb_array_elements(p_users) e LOOP
    v_received := v_received + 1;
    v_login := CASE WHEN jsonb_typeof(r.v) = 'object' THEN platform_private.telephony_clean_text(r.v ->> 'login', 128) END;
    IF v_login IS NULL OR lower(v_login) IN ('ivr', 'fax') OR lower(v_login) = ANY (v_seen) THEN
      v_invalid := v_invalid + 1;
    ELSE
      v_seen := v_seen || lower(v_login);
    END IF;
  END LOOP;
  IF cardinality(v_seen) = 0 THEN
    RETURN jsonb_build_object('status', 'empty', 'received', v_received, 'invalid', v_invalid);
  END IF;

  v_seen := ARRAY[]::TEXT[];
  FOR r IN SELECT e.value AS v FROM jsonb_array_elements(p_users) e LOOP
    v_login := CASE WHEN jsonb_typeof(r.v) = 'object' THEN platform_private.telephony_clean_text(r.v ->> 'login', 128) END;
    CONTINUE WHEN v_login IS NULL OR lower(v_login) IN ('ivr', 'fax') OR lower(v_login) = ANY (v_seen);
    v_seen := v_seen || lower(v_login);
    v_ext := platform_private.telephony_clean_text(r.v ->> 'ext', 32);
    v_name := platform_private.telephony_clean_text(r.v ->> 'name', 200);
    SELECT * INTO x FROM platform_private.telephony_extensions e
    WHERE e.organization_id = p_organization_id AND lower(e.pbx_user) = lower(v_login)
    ORDER BY e.active DESC, e.created_at, e.id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO platform_private.telephony_extensions (organization_id, pbx_user, extension, pbx_display_name,
        membership_id, active, last_seen_in_users_at)
      VALUES (p_organization_id, v_login, v_ext, v_name, NULL, TRUE, v_now);
      v_inserted := v_inserted + 1;
    ELSE
      -- Вернувшегося сотрудника с назначенным сотрудником EVO включаем, только
      -- если этого сотрудника EVO не держит другой действующий пользователь ВАТС.
      v_new_active := CASE
        WHEN x.active THEN TRUE
        WHEN x.membership_id IS NULL THEN TRUE
        WHEN NOT EXISTS (SELECT 1 FROM platform_private.telephony_extensions o
          WHERE o.organization_id = p_organization_id AND o.membership_id = x.membership_id
            AND o.active AND o.id <> x.id) THEN TRUE
        ELSE FALSE END;
      UPDATE platform_private.telephony_extensions e SET
        extension = v_ext, pbx_display_name = v_name, last_seen_in_users_at = v_now, active = v_new_active,
        updated_at = v_now
      WHERE e.id = x.id
        AND (e.extension IS DISTINCT FROM v_ext OR e.pbx_display_name IS DISTINCT FROM v_name
          OR e.active IS DISTINCT FROM v_new_active
          OR e.last_seen_in_users_at IS NULL OR e.last_seen_in_users_at < v_now - INTERVAL '5 minutes');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 AND (x.extension IS DISTINCT FROM v_ext OR x.pbx_display_name IS DISTINCT FROM v_name) THEN
        v_updated := v_updated + 1;
      END IF;
      IF NOT x.active AND v_new_active THEN v_reactivated := v_reactivated + 1; END IF;
      IF NOT x.active AND NOT v_new_active THEN v_conflicts := v_conflicts + 1; END IF;
    END IF;
  END LOOP;

  -- Пропавшие из ПОЛНОГО списка выключаются, не удаляются: старые звонки по-прежнему
  -- узнают их как сотрудников ВАТС (правило 1 §6.1).
  IF p_complete THEN
    UPDATE platform_private.telephony_extensions e SET active = FALSE, updated_at = v_now
    WHERE e.organization_id = p_organization_id AND e.active AND NOT (lower(e.pbx_user) = ANY (v_seen));
    GET DIAGNOSTICS v_deactivated = ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_active FROM platform_private.telephony_extensions e
  WHERE e.organization_id = p_organization_id AND e.active;
  RETURN jsonb_build_object('status', 'ok', 'received', v_received, 'invalid', v_invalid, 'inserted', v_inserted,
    'updated', v_updated, 'reactivated', v_reactivated, 'conflicts', v_conflicts, 'deactivated', v_deactivated,
    'active', v_active);
END
$$;

-- ---------------------------------------------------------------------------
-- Одна строка GET /history/json в звонок и ногу (§5.4). Возвращает результат:
-- created, updated, unchanged, invalid, dropped (первичный импорт, номер не
-- совпал с клиентом), плюс признаки «ссылка записана» и «возможный дубль».
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_reconcile_row(p_org UUID, p_mode TEXT, p_row JSONB)
RETURNS TABLE (o_result TEXT, o_link_set BOOLEAN, o_suspect BOOLEAN)
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  v_uid TEXT; v_dir TEXT; v_status TEXT; v_status_known BOOLEAN; v_start TIMESTAMPTZ;
  v_wait INTEGER; v_dur INTEGER; v_phone TEXT; v_company TEXT; v_company_name TEXT; v_dest TEXT;
  v_user TEXT; v_member UUID; v_group TEXT; v_missed SMALLINT; v_link TEXT;
  v_answered BOOLEAN; v_outcome TEXT; v_acc TIMESTAMPTZ; v_end TIMESTAMPTZ;
  cl platform_private.telephony_calls%ROWTYPE;
  lg platform_private.telephony_call_legs%ROWTYPE;
  m RECORD; v_found BOOLEAN; v_leg_found BOOLEAN; v_n INTEGER;
  v_changed BOOLEAN := FALSE; v_leg_changed BOOLEAN := FALSE; v_suspect BOOLEAN := FALSE; v_link_set BOOLEAN := FALSE;
  v_before_outcome TEXT; v_before_source TEXT; v_after platform_private.telephony_calls%ROWTYPE;
  v_call_id UUID; v_leg_id UUID; v_age_ok BOOLEAN; v_via TEXT; v_has_user BOOLEAN;
BEGIN
  -- Разбор. Всё, что не разобралось в звонок (нет идентификатора, направления или
  -- времени начала), — invalid: такую строку не повторяют.
  v_uid := platform_private.telephony_clean_text(p_row ->> 'uid', 200);
  v_dir := CASE lower(btrim(p_row ->> 'type')) WHEN 'in' THEN 'in' WHEN 'out' THEN 'out' END;
  v_start := platform_private.telephony_parse_ts(p_row ->> 'start');
  IF v_uid IS NULL OR v_uid LIKE 'tmp:%' OR v_dir IS NULL OR v_start IS NULL
    OR v_start > clock_timestamp() + INTERVAL '1 day' THEN
    RETURN QUERY SELECT 'invalid'::TEXT, FALSE, FALSE;
    RETURN;
  END IF;
  v_status := platform_private.telephony_status_word(p_row ->> 'status');
  v_status_known := v_status IN ('success', 'missed', 'noanswer');
  v_wait := platform_private.telephony_to_int(p_row ->> 'wait');
  v_dur := platform_private.telephony_to_int(p_row ->> 'duration');
  v_phone := platform_private.telephony_phone_e164(p_row ->> 'client');
  v_company := platform_private.telephony_clean_text(p_row ->> 'diversion', 64);
  IF v_company ~ '^\+?[0-9][0-9 ()-]*$' THEN
    v_company := NULLIF(regexp_replace(v_company, '[^0-9]', '', 'g'), '');
  END IF;
  v_company_name := platform_private.telephony_clean_text(p_row ->> 'telnum_name', 200);
  v_dest := platform_private.telephony_status_word(p_row ->> 'destination');
  SELECT r.o_pbx_user, r.o_membership_id INTO v_user, v_member
  FROM platform_private.telephony_resolve_user(p_org, p_row ->> 'user') r;
  v_has_user := COALESCE(v_user, '') <> '';
  v_user := COALESCE(v_user, '');
  v_group := platform_private.telephony_clean_text(p_row ->> 'group_name', 200);
  v_missed := CASE WHEN btrim(p_row ->> 'missedStatus') ~ '^[1-4]$' THEN btrim(p_row ->> 'missedStatus')::SMALLINT END;
  v_link := CASE WHEN (p_row ->> 'record') ~ '^https://[^[:space:][:cntrl:]]+$'
      AND char_length(p_row ->> 'record') <= 1024 THEN p_row ->> 'record' END;

  -- Итог по сверке неточный (§5.4): ответил сотрудник — входящий: status = success,
  -- destination = user и разговор больше нуля; исходящий: success и разговор больше
  -- нуля. Иначе входящий — missed, исходящий — no_answer_unknown.
  v_answered := v_status = 'success' AND COALESCE(v_dur, 0) > 0 AND (v_dir = 'out' OR v_dest = 'user');
  v_outcome := CASE WHEN v_answered THEN 'answered' WHEN v_dir = 'in' THEN 'missed' ELSE 'no_answer_unknown' END;
  v_acc := v_start + pg_catalog.make_interval(secs => COALESCE(v_wait, 0));
  v_end := v_acc + pg_catalog.make_interval(secs => COALESCE(v_dur, 0));
  v_via := CASE p_mode WHEN 'backfill' THEN 'backfill' ELSE 'reconcile' END;

  -- Один звонок обрабатывается одним писателем (ключ как у приёма вебхука).
  PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended('evo:telephony:call:' || p_org::TEXT || ':' || v_uid, 0));
  SELECT * INTO cl FROM platform_private.telephony_calls x
  WHERE x.organization_id = p_org AND x.pbx_callid = v_uid FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    SELECT * INTO m FROM platform_private.telephony_match_phone(p_org, v_phone);
    -- Первичный импорт: только номера, уже совпавшие с клиентом EVO; остальные
    -- строки отбрасываются без сохранения и без журнала.
    IF p_mode = 'backfill' AND m.m_state IS DISTINCT FROM 'matched' THEN
      RETURN QUERY SELECT 'dropped'::TEXT, FALSE, FALSE;
      RETURN;
    END IF;
    -- Возможный дубль: вебхук мог принести тот же звонок под другим идентификатором
    -- (если uid истории не равен callid вебхука — проверяется настоящими звонками,
    -- план §5.4). Такая строка создаётся, но на решения не влияет (needs_review).
    IF v_phone IS NOT NULL AND EXISTS (
      SELECT 1 FROM platform_private.telephony_calls y
      WHERE y.organization_id = p_org AND y.created_via = 'webhook' AND y.direction = v_dir
        AND y.client_phone = v_phone AND y.pbx_callid <> v_uid
        AND abs(extract(epoch FROM (y.started_at - v_start))) <= 60
    ) THEN
      v_suspect := TRUE;
    END IF;
    INSERT INTO platform_private.telephony_calls (organization_id, pbx_callid, direction, state, outcome, outcome_source,
      started_at, answered_at, ended_at, settled_at, last_message_at, wait_seconds, talk_seconds, client_phone,
      company_number, company_number_name, pbx_destination, pbx_missed_status, membership_id, client_id, lead_id,
      match_state, recording_state, created_via, needs_review)
    VALUES (p_org, v_uid, v_dir, 'ended', v_outcome, 'pull',
      v_start, CASE WHEN v_answered THEN v_acc END, v_end, clock_timestamp(), clock_timestamp(), v_wait, v_dur, v_phone,
      v_company, v_company_name, v_dest, v_missed, CASE WHEN v_answered THEN v_member END, m.m_client_id, m.m_lead_id,
      m.m_state, CASE WHEN v_link IS NOT NULL THEN 'available' ELSE 'none' END, v_via,
      v_suspect OR NOT v_status_known)
    RETURNING id INTO v_call_id;
    INSERT INTO platform_private.telephony_call_legs (organization_id, call_id, pbx_user, group_name, membership_id,
      state, status, leg_started_at, leg_start_source, accepted_at, ended_at, wait_seconds, talk_seconds,
      recording_link, recording_state)
    VALUES (p_org, v_call_id, v_user, v_group, v_member,
      CASE WHEN v_answered THEN 'completed' ELSE 'missed' END, v_status, v_start, 'pull',
      CASE WHEN v_answered THEN v_acc END, v_end, v_wait, v_dur,
      v_link, CASE WHEN v_link IS NOT NULL THEN 'available' ELSE 'none' END)
    RETURNING id INTO v_leg_id;
    INSERT INTO platform_private.telephony_call_events (organization_id, call_id, leg_id, source, event_type, pbx_user,
      occurred_at)
    VALUES (p_org, v_call_id, v_leg_id, 'pull', v_via, NULLIF(v_user, ''), v_start);
    RETURN QUERY SELECT 'created'::TEXT, v_link IS NOT NULL, v_suspect;
    RETURN;
  END IF;

  -- Звонок уже есть (вебхук или прежняя сверка): дополняем, точный итог вебхука не
  -- перезаписываем, ответ необратим.
  v_call_id := cl.id;
  v_before_outcome := cl.outcome;
  v_before_source := cl.outcome_source;
  v_age_ok := (clock_timestamp() - cl.started_at) < INTERVAL '360 days';

  IF v_has_user THEN
    SELECT * INTO lg FROM platform_private.telephony_call_legs x
    WHERE x.organization_id = p_org AND x.call_id = cl.id AND lower(x.pbx_user) = lower(v_user)
    ORDER BY (x.leg_started_at = v_start) DESC, abs(extract(epoch FROM (x.leg_started_at - v_start))), x.id
    LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO lg FROM platform_private.telephony_call_legs x
    WHERE x.organization_id = p_org AND x.call_id = cl.id AND x.pbx_user = ''
    ORDER BY abs(extract(epoch FROM (x.leg_started_at - v_start))), x.id
    LIMIT 1 FOR UPDATE;
  END IF;
  v_leg_found := FOUND;

  IF NOT v_leg_found AND (v_has_user OR v_link IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_legs z
        WHERE z.organization_id = p_org AND z.call_id = cl.id)) THEN
    INSERT INTO platform_private.telephony_call_legs (organization_id, call_id, pbx_user, group_name, membership_id,
      state, status, leg_started_at, leg_start_source, accepted_at, ended_at, wait_seconds, talk_seconds,
      recording_link, recording_state)
    VALUES (p_org, cl.id, v_user, v_group, v_member,
      CASE WHEN v_answered AND v_has_user THEN 'completed' ELSE 'missed' END, v_status, v_start, 'pull',
      CASE WHEN v_answered AND v_has_user THEN v_acc END, v_end, v_wait,
      CASE WHEN v_answered AND v_has_user THEN v_dur END,
      v_link, CASE WHEN v_link IS NOT NULL THEN 'available' ELSE 'none' END)
    RETURNING * INTO lg;
    v_leg_found := TRUE;
    v_leg_changed := TRUE;
    v_link_set := v_link IS NOT NULL;
  ELSIF v_leg_found THEN
    -- Дополнение ноги: заполняем недостающее, время разговора берём из сверки.
    UPDATE platform_private.telephony_call_legs x SET
      talk_seconds = CASE WHEN v_answered AND v_has_user THEN v_dur ELSE x.talk_seconds END,
      wait_seconds = COALESCE(x.wait_seconds, v_wait),
      status = COALESCE(x.status, v_status),
      group_name = COALESCE(x.group_name, v_group),
      membership_id = COALESCE(x.membership_id, v_member),
      state = CASE WHEN v_answered AND v_has_user
        THEN platform_private.telephony_leg_state_merge(x.state, 'completed') ELSE x.state END,
      accepted_at = CASE WHEN v_answered AND v_has_user THEN COALESCE(x.accepted_at, v_acc) ELSE x.accepted_at END,
      ended_at = CASE WHEN v_answered AND v_has_user THEN COALESCE(x.ended_at, v_end) ELSE x.ended_at END,
      updated_at = clock_timestamp()
    WHERE x.id = lg.id
      AND (x.wait_seconds IS NULL AND v_wait IS NOT NULL
        OR x.status IS NULL AND v_status IS NOT NULL
        OR x.group_name IS NULL AND v_group IS NOT NULL
        OR x.membership_id IS NULL AND v_member IS NOT NULL
        OR (v_answered AND v_has_user AND (x.talk_seconds IS DISTINCT FROM v_dur
          OR x.state IS DISTINCT FROM platform_private.telephony_leg_state_merge(x.state, 'completed')
          OR x.accepted_at IS NULL OR x.ended_at IS NULL)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_leg_changed := TRUE; END IF;
    -- Ссылка на запись: пока звонку меньше 360 дней сверка обновляет её (§7.3); срок
    -- вышел (expired) — не оживляем. Новая ссылка даёт записи новую попытку.
    IF v_link IS NOT NULL AND v_age_ok AND lg.recording_state <> 'expired'
      AND lg.recording_link IS DISTINCT FROM v_link THEN
      UPDATE platform_private.telephony_call_legs x SET recording_link = v_link, recording_state = 'available',
        not_found_count = 0, first_not_found_at = NULL, recording_next_check_at = NULL, updated_at = clock_timestamp()
      WHERE x.id = lg.id;
      v_leg_changed := TRUE;
      v_link_set := TRUE;
    END IF;
  END IF;

  -- Звонок: недостающие реквизиты и подсказки сверки.
  UPDATE platform_private.telephony_calls x SET
    client_phone = COALESCE(x.client_phone, v_phone),
    company_number = COALESCE(x.company_number, v_company),
    company_number_name = COALESCE(x.company_number_name, v_company_name),
    pbx_destination = COALESCE(v_dest, x.pbx_destination),
    pbx_missed_status = COALESCE(v_missed, x.pbx_missed_status),
    started_at = LEAST(x.started_at, v_start),
    updated_at = clock_timestamp()
  WHERE x.id = cl.id
    AND (x.client_phone IS NULL AND v_phone IS NOT NULL
      OR x.company_number IS NULL AND v_company IS NOT NULL
      OR x.company_number_name IS NULL AND v_company_name IS NOT NULL
      OR x.pbx_destination IS DISTINCT FROM COALESCE(v_dest, x.pbx_destination)
      OR x.pbx_missed_status IS DISTINCT FROM COALESCE(v_missed, x.pbx_missed_status)
      OR x.started_at > v_start);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_changed := TRUE; END IF;

  -- Итог. Звонок, чей итог уже дала сверка, пересчёту по ногам не подлежит (пересчёт
  -- вебхука заменил бы «неточный» и «no_answer_unknown»); он может только стать
  -- answered. Звонок с итогом вебхука пересчитывается при изменении ног: ответ,
  -- найденный только сверкой, помечается источником pull. Звонок без итога
  -- получает итог сверки (неточный) и сразу завершается для решений.
  IF v_before_source = 'pull' THEN
    IF v_answered AND v_before_outcome IS DISTINCT FROM 'answered' THEN
      UPDATE platform_private.telephony_calls x SET state = 'ended', outcome = 'answered', outcome_source = 'pull',
        answered_at = v_acc, ended_at = COALESCE(x.ended_at, v_end), settled_at = COALESCE(x.settled_at, clock_timestamp()),
        membership_id = COALESCE(v_member, x.membership_id), talk_seconds = COALESCE(v_dur, x.talk_seconds),
        updated_at = clock_timestamp()
      WHERE x.id = cl.id;
      v_changed := TRUE;
    END IF;
  ELSIF v_leg_changed OR v_before_outcome IS NULL THEN
    IF v_before_outcome IS NULL THEN
      -- Звонок виден как идущий, а ВАТС его уже закончила: открытые ноги закрываем.
      UPDATE platform_private.telephony_call_legs x SET state = 'missed', ended_at = COALESCE(x.ended_at, v_end),
        updated_at = clock_timestamp()
      WHERE x.organization_id = p_org AND x.call_id = cl.id AND x.state IN ('ringing', 'accepted');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN v_leg_changed := TRUE; END IF;
    END IF;
    IF v_leg_changed THEN
      PERFORM platform_private.telephony_recompute_call(p_org, cl.id);
    END IF;
    SELECT * INTO v_after FROM platform_private.telephony_calls x WHERE x.id = cl.id;
    IF v_before_outcome IS NULL THEN
      -- Итог ещё не был известен: окончательный выбирает сверка. Старшие итоги
      -- вебхука (busy, cancelled и т. п.) сохраняются, остальное — итог сверки.
      UPDATE platform_private.telephony_calls x SET
        outcome = CASE WHEN v_after.outcome IN ('answered', 'busy', 'unavailable', 'not_found', 'not_allowed', 'cancelled')
          THEN v_after.outcome ELSE v_outcome END,
        outcome_source = 'pull', state = 'ended',
        ended_at = COALESCE(v_after.ended_at, v_end),
        answered_at = CASE WHEN v_after.outcome = 'answered' THEN COALESCE(v_after.answered_at, v_acc) END,
        settled_at = COALESCE(x.settled_at, clock_timestamp()),
        updated_at = clock_timestamp()
      WHERE x.id = cl.id;
      v_changed := TRUE;
    ELSIF v_after.outcome = 'answered' AND v_before_outcome IS DISTINCT FROM 'answered' THEN
      UPDATE platform_private.telephony_calls x SET outcome_source = 'pull', updated_at = clock_timestamp()
      WHERE x.id = cl.id;
      v_changed := TRUE;
    END IF;
  END IF;

  -- Сводное состояние записи по ногам.
  UPDATE platform_private.telephony_calls x SET recording_state = z.rec, updated_at = clock_timestamp()
  FROM (SELECT CASE WHEN bool_or(l.recording_state = 'available') THEN 'available'
      WHEN bool_or(l.recording_state = 'unavailable') THEN 'unavailable'
      WHEN bool_or(l.recording_state = 'expired') THEN 'expired' ELSE 'none' END AS rec
    FROM platform_private.telephony_call_legs l WHERE l.organization_id = p_org AND l.call_id = cl.id) z
  WHERE x.id = cl.id AND x.recording_state IS DISTINCT FROM z.rec;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_changed := TRUE; END IF;

  -- Пока звонок не завершён для решений, номер сверяется заново (клиент мог
  -- появиться); созданное (T9) и завершённое не трогаем.
  SELECT * INTO v_after FROM platform_private.telephony_calls x WHERE x.id = cl.id;
  IF v_after.client_phone IS NOT NULL AND v_after.match_state <> 'created' AND v_after.settled_at IS NULL THEN
    SELECT * INTO m FROM platform_private.telephony_match_phone(p_org, v_after.client_phone);
    UPDATE platform_private.telephony_calls x SET match_state = m.m_state, client_id = m.m_client_id,
      lead_id = m.m_lead_id, updated_at = clock_timestamp()
    WHERE x.id = cl.id
      AND (x.match_state, x.client_id, x.lead_id) IS DISTINCT FROM (m.m_state, m.m_client_id, m.m_lead_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_changed := TRUE; END IF;
  END IF;

  RETURN QUERY SELECT CASE WHEN v_changed OR v_leg_changed THEN 'updated' ELSE 'unchanged' END::TEXT, v_link_set, FALSE;
END
$$;

-- ---------------------------------------------------------------------------
-- Пачка строк истории ВАТС (до 100 строк). Каждая строка — в своей точке
-- сохранения: сбой одной не отменяет остальные и не оставляет ничего от неё.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_reconcile_apply_v1(p_organization_id UUID, p_mode TEXT, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r RECORD; res RECORD;
  v_received INTEGER := 0; v_created INTEGER := 0; v_updated INTEGER := 0; v_unchanged INTEGER := 0;
  v_invalid INTEGER := 0; v_dropped INTEGER := 0; v_suspect INTEGER := 0; v_links INTEGER := 0; v_failed INTEGER := 0;
  v_codes TEXT[] := ARRAY[]::TEXT[]; v_code TEXT; v_sqlstate TEXT; v_constraint TEXT; v_column TEXT;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('reconcile', 'backfill')
    OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  -- Закрыто флагом проекции (нет строки настроек = выключено); импорт — своим флагом.
  IF NOT platform_private.telephony_projection_enabled(p_organization_id) THEN
    RETURN jsonb_build_object('status', 'disabled', 'reason', 'projection');
  END IF;
  IF p_mode = 'backfill' AND NOT COALESCE((SELECT s.backfill_enabled FROM platform_private.telephony_settings s
      WHERE s.organization_id = p_organization_id), FALSE) THEN
    RETURN jsonb_build_object('status', 'disabled', 'reason', 'backfill');
  END IF;
  -- Справочник пуст: «ответил сотрудник» определить нечем (как у проекции, T1b п. 13 (г)).
  IF NOT EXISTS (SELECT 1 FROM platform_private.telephony_extensions x
    WHERE x.organization_id = p_organization_id AND x.active) THEN
    RETURN jsonb_build_object('status', 'directory_empty');
  END IF;

  FOR r IN SELECT e.value AS v FROM jsonb_array_elements(p_rows) e LOOP
    v_received := v_received + 1;
    IF jsonb_typeof(r.v) <> 'object' THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    BEGIN
      SELECT * INTO res FROM platform_private.telephony_reconcile_row(p_organization_id, p_mode, r.v);
      CASE res.o_result
        WHEN 'created' THEN v_created := v_created + 1;
        WHEN 'updated' THEN v_updated := v_updated + 1;
        WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
        WHEN 'dropped' THEN v_dropped := v_dropped + 1;
        ELSE v_invalid := v_invalid + 1;
      END CASE;
      IF res.o_link_set THEN v_links := v_links + 1; END IF;
      IF res.o_suspect THEN v_suspect := v_suspect + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_code := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_failed := v_failed + 1;
      IF cardinality(v_codes) < 5 AND NOT (v_code = ANY (v_codes)) THEN v_codes := v_codes || v_code; END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('status', 'ok', 'mode', p_mode, 'received', v_received, 'created', v_created,
    'updated', v_updated, 'unchanged', v_unchanged, 'invalid', v_invalid, 'dropped', v_dropped,
    'suspected_duplicates', v_suspect, 'links_set', v_links, 'failed', v_failed, 'error_codes', to_jsonb(v_codes));
END
$$;

-- ---------------------------------------------------------------------------
-- Отметка прогона: времена, курсоры, ошибка ВАТС кодом, счётчики, факты.
-- Курсор сверки идёт только вперёд, курсор импорта — только назад.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_runtime_mark_v1(
  p_organization_id UUID, p_event TEXT, p_cursor TIMESTAMPTZ DEFAULT NULL, p_error_code TEXT DEFAULT NULL,
  p_summary JSONB DEFAULT NULL, p_facts JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_floor CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '2025-10-21 18:00:00+00';
  v_now TIMESTAMPTZ; v_mode TEXT; v_kind TEXT; v_code TEXT; r RECORD;
  v_sum JSONB := '{}'::JSONB; v_facts JSONB := '{}'::JSONB;
  v_events CONSTANT TEXT[] := ARRAY['tick', 'users_ok', 'users_error', 'probe_ok', 'probe_error', 'reconcile_ok',
    'reconcile_error', 'daily_ok', 'daily_error', 'backfill_ok', 'backfill_error'];
  v_counters CONSTANT TEXT[] := ARRAY['rows', 'created', 'updated', 'unchanged', 'invalid', 'dropped',
    'suspected_duplicates', 'links_set', 'failed', 'requests', 'windows', 'users', 'inserted', 'deactivated',
    'conflicts', 'reactivated'];
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_event IS NULL OR NOT (p_event = ANY (v_events)) THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  v_mode := split_part(p_event, '_', 1);
  v_kind := split_part(p_event, '_', 2);
  v_code := CASE WHEN p_error_code ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_error_code ELSE 'unknown_error' END;
  IF p_cursor IS NOT NULL AND (p_cursor < TIMESTAMPTZ '2020-01-01 00:00:00+00' OR p_cursor > v_now + INTERVAL '1 hour') THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Только известные счётчики и только целые числа.
  IF p_summary IS NOT NULL AND jsonb_typeof(p_summary) = 'object' THEN
    FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_summary) e LOOP
      IF r.k = ANY (v_counters) AND jsonb_typeof(r.v) = 'number' AND (r.v #>> '{}') ~ '^[0-9]{1,12}$' THEN
        v_sum := v_sum || jsonb_build_object(r.k, r.v);
      END IF;
    END LOOP;
  END IF;
  -- Только известные факты ВАТС (форма та же, что у CHECK столбца).
  IF p_facts IS NOT NULL AND jsonb_typeof(p_facts) = 'object' THEN
    FOR r IN SELECT e.key AS k, e.value AS v FROM jsonb_each(p_facts) e LOOP
      IF platform_private.telephony_facts_ok(jsonb_build_object(r.k, r.v)) THEN
        v_facts := v_facts || jsonb_build_object(r.k, r.v);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO platform_private.telephony_runtime_state (organization_id) VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  IF p_event = 'tick' THEN
    UPDATE platform_private.telephony_runtime_state x SET retry_run_at = v_now, settle_run_at = v_now, updated_at = v_now
    WHERE x.organization_id = p_organization_id;
  ELSIF v_kind = 'error' THEN
    -- Время запуска обновляется и при ошибке: так прогон не повторяется чаще своего
    -- срока. Сверка и импорт не сдвигаются.
    UPDATE platform_private.telephony_runtime_state x SET
      users_sync_run_at = CASE WHEN v_mode = 'users' THEN v_now ELSE x.users_sync_run_at END,
      probe_run_at = CASE WHEN v_mode = 'probe' THEN v_now ELSE x.probe_run_at END,
      reconcile_run_at = CASE WHEN v_mode = 'reconcile' THEN v_now ELSE x.reconcile_run_at END,
      reconcile_daily_run_at = CASE WHEN v_mode = 'daily' THEN v_now ELSE x.reconcile_daily_run_at END,
      backfill_run_at = CASE WHEN v_mode = 'backfill' THEN v_now ELSE x.backfill_run_at END,
      last_pbx_error_at = v_now, last_pbx_error_code = v_code, updated_at = v_now
    WHERE x.organization_id = p_organization_id;
  ELSE
    UPDATE platform_private.telephony_runtime_state x SET
      users_sync_run_at = CASE WHEN v_mode = 'users' THEN v_now ELSE x.users_sync_run_at END,
      users_sync_success_at = CASE WHEN v_mode = 'users' THEN v_now ELSE x.users_sync_success_at END,
      probe_run_at = CASE WHEN v_mode = 'probe' THEN v_now ELSE x.probe_run_at END,
      probe_success_at = CASE WHEN v_mode = 'probe' THEN v_now ELSE x.probe_success_at END,
      pbx_facts = CASE WHEN v_mode = 'probe' AND v_facts <> '{}'::JSONB THEN v_facts ELSE x.pbx_facts END,
      reconcile_run_at = CASE WHEN v_mode = 'reconcile' THEN v_now ELSE x.reconcile_run_at END,
      reconcile_success_at = CASE WHEN v_mode = 'reconcile' THEN v_now ELSE x.reconcile_success_at END,
      reconcile_cursor_at = CASE WHEN v_mode = 'reconcile' AND p_cursor IS NOT NULL
        THEN GREATEST(COALESCE(x.reconcile_cursor_at, p_cursor), p_cursor) ELSE x.reconcile_cursor_at END,
      reconcile_daily_run_at = CASE WHEN v_mode = 'daily' THEN v_now ELSE x.reconcile_daily_run_at END,
      reconcile_daily_success_at = CASE WHEN v_mode = 'daily' THEN v_now ELSE x.reconcile_daily_success_at END,
      backfill_run_at = CASE WHEN v_mode = 'backfill' THEN v_now ELSE x.backfill_run_at END,
      backfill_cursor_at = CASE WHEN v_mode = 'backfill' AND p_cursor IS NOT NULL
        THEN LEAST(COALESCE(x.backfill_cursor_at, p_cursor), GREATEST(p_cursor, v_floor)) ELSE x.backfill_cursor_at END,
      backfill_done_at = CASE WHEN v_mode = 'backfill' AND p_cursor IS NOT NULL AND p_cursor <= v_floor
        THEN COALESCE(x.backfill_done_at, v_now) ELSE x.backfill_done_at END,
      last_pbx_ok_at = v_now, updated_at = v_now
    WHERE x.organization_id = p_organization_id;
    IF v_mode IN ('users', 'reconcile', 'daily', 'backfill') AND v_sum <> '{}'::JSONB THEN
      UPDATE platform_private.telephony_runtime_state x SET
        mode_summaries = x.mode_summaries || jsonb_build_object(v_mode, v_sum)
      WHERE x.organization_id = p_organization_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'event', p_event);
END
$$;

-- ---------------------------------------------------------------------------
-- Здоровье интеграции для «Настроек» (срез T4b построит на нём чтение для
-- сотрудников). Только числа, времена и слова: ни номеров, ни логинов, ни ссылок.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_integration_health_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ;
  s platform_private.telephony_settings%ROWTYPE;
  rs platform_private.telephony_runtime_state%ROWTYPE;
  v_active INTEGER; v_inactive INTEGER; v_unmapped INTEGER; v_seen TIMESTAMPTZ;
  v_recon INTEGER; v_total INTEGER; v_work JSONB; v_ev_total INTEGER; v_ev_rejected INTEGER; v_ev_incomplete INTEGER;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  v_now := clock_timestamp();
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_organization_id;
  SELECT * INTO rs FROM platform_private.telephony_runtime_state x WHERE x.organization_id = p_organization_id;
  SELECT count(*) FILTER (WHERE e.active), count(*) FILTER (WHERE NOT e.active),
    count(*) FILTER (WHERE e.active AND e.membership_id IS NULL), max(e.last_seen_in_users_at)
  INTO v_active, v_inactive, v_unmapped, v_seen
  FROM platform_private.telephony_extensions e WHERE e.organization_id = p_organization_id;
  -- Расхождения за сутки: звонки, которых вебхук не принёс и которые создала сверка,
  -- против всех звонков за те же сутки (критерий выхода из фазы 1 — 99 %, §4).
  SELECT count(*) FILTER (WHERE c.created_via = 'reconcile'), count(*)
  INTO v_recon, v_total
  FROM platform_private.telephony_calls c
  WHERE c.organization_id = p_organization_id AND c.created_via IN ('webhook', 'reconcile', 'dial')
    AND c.started_at >= v_now - INTERVAL '24 hours';
  SELECT COALESCE(jsonb_object_agg(w.state, w.n), '{}'::JSONB) INTO v_work
  FROM (SELECT x.state, count(*) AS n FROM platform_private.telephony_event_work x
    WHERE x.organization_id = p_organization_id GROUP BY x.state) w;
  -- Принятые сообщения за сутки: сколько всего, сколько отклонено после проверки
  -- ключа (форма без значений) и сколько неполных (§12, строка «Телефония»).
  SELECT count(*), count(*) FILTER (WHERE e.validation_state = 'rejected'),
    count(*) FILTER (WHERE e.validation_state = 'incomplete')
  INTO v_ev_total, v_ev_rejected, v_ev_incomplete
  FROM platform_private.telephony_pbx_events e
  WHERE e.organization_id = p_organization_id AND e.received_at >= v_now - INTERVAL '24 hours';
  RETURN jsonb_build_object(
    'status', 'ok',
    'now', v_now,
    'flags', jsonb_build_object('projection_enabled', COALESCE(s.projection_enabled, FALSE),
      'outbound_paused', COALESCE(s.outbound_paused, FALSE), 'backfill_enabled', COALESCE(s.backfill_enabled, FALSE)),
    'directory', jsonb_build_object('active', v_active, 'inactive', v_inactive, 'unmapped', v_unmapped,
      'last_seen_at', v_seen),
    'schedule', jsonb_build_object(
      'retry_run_at', rs.retry_run_at, 'settle_run_at', rs.settle_run_at,
      'users_sync_run_at', rs.users_sync_run_at, 'users_sync_success_at', rs.users_sync_success_at,
      'reconcile_run_at', rs.reconcile_run_at, 'reconcile_success_at', rs.reconcile_success_at,
      'reconcile_cursor_at', rs.reconcile_cursor_at,
      'reconcile_lag_seconds', CASE WHEN rs.reconcile_cursor_at IS NULL THEN NULL
        ELSE greatest(0, floor(extract(epoch FROM (v_now - rs.reconcile_cursor_at))))::BIGINT END,
      'reconcile_daily_run_at', rs.reconcile_daily_run_at, 'reconcile_daily_success_at', rs.reconcile_daily_success_at,
      'backfill_run_at', rs.backfill_run_at, 'backfill_cursor_at', rs.backfill_cursor_at,
      'backfill_done_at', rs.backfill_done_at,
      'probe_run_at', rs.probe_run_at, 'probe_success_at', rs.probe_success_at),
    'pbx', jsonb_build_object('last_ok_at', rs.last_pbx_ok_at, 'last_error_at', rs.last_pbx_error_at,
      'last_error_code', rs.last_pbx_error_code, 'facts', rs.pbx_facts),
    'last_event_at', rs.last_event_at,
    'internal_calls_total', COALESCE(rs.internal_calls_total, 0),
    'evidence', jsonb_build_object('window_hours', 24, 'received', COALESCE(v_ev_total, 0),
      'rejected', COALESCE(v_ev_rejected, 0), 'incomplete', COALESCE(v_ev_incomplete, 0)),
    'automation_stop', jsonb_build_object('stopped_at', rs.automation_stopped_at, 'code', rs.automation_stop_code),
    'summaries', COALESCE(rs.mode_summaries, '{}'::JSONB),
    'divergence', jsonb_build_object('window_hours', 24, 'reconciled_calls', COALESCE(v_recon, 0),
      'calls', COALESCE(v_total, 0)),
    'work', v_work
  );
END
$$;

-- ---------------------------------------------------------------------------
-- Права: частные помощники без грантов; публичные функции — только service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_summary_ok(JSONB),
  platform_private.telephony_facts_ok(JSONB),
  platform_private.telephony_reconcile_row(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

REVOKE ALL ON FUNCTION
  platform.telephony_maintenance_plan_v1(UUID),
  platform.telephony_sync_extensions_v1(UUID, JSONB, BOOLEAN),
  platform.telephony_reconcile_apply_v1(UUID, TEXT, JSONB),
  platform.telephony_runtime_mark_v1(UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB),
  platform.telephony_integration_health_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION
  platform.telephony_maintenance_plan_v1(UUID),
  platform.telephony_sync_extensions_v1(UUID, JSONB, BOOLEAN),
  platform.telephony_reconcile_apply_v1(UUID, TEXT, JSONB),
  platform.telephony_runtime_mark_v1(UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB),
  platform.telephony_integration_health_v1(UUID)
  TO service_role;

COMMENT ON FUNCTION platform.telephony_maintenance_plan_v1(UUID) IS
  'Telephony T4a: service-only plan for the maintenance script (what is due, windows by the database clock). No settings row = everything off.';
COMMENT ON FUNCTION platform.telephony_sync_extensions_v1(UUID, JSONB, BOOLEAN) IS
  'Telephony T4a: service-only sync of the PBX user directory from GET /users (by login, case-insensitive). Never assigns an EVO staff member; users missing from a complete list are deactivated, not deleted.';
COMMENT ON FUNCTION platform.telephony_reconcile_apply_v1(UUID, TEXT, JSONB) IS
  'Telephony T4a: service-only apply of up to 100 GET /history/json rows into calls and legs. Pull outcomes are inexact (outcome_source = pull); a webhook outcome is never overwritten and an answer is irreversible. Closed by projection_enabled (and backfill_enabled for backfill).';
COMMENT ON FUNCTION platform.telephony_runtime_mark_v1(UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB) IS
  'Telephony T4a: service-only run mark (times, cursors, PBX error code, counters, PBX facts). The reconcile cursor only moves forward, the backfill cursor only backward.';
COMMENT ON FUNCTION platform.telephony_integration_health_v1(UUID) IS
  'Telephony T4a: service-only health data for the settings screen (numbers, times and words only).';

-- Самопроверка: публичные функции — definer, пустой search_path, EXECUTE только у
-- service_role; помощники — без прав клиентских ролей.
DO $tel293_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname IN ('telephony_maintenance_plan_v1', 'telephony_sync_extensions_v1',
      'telephony_reconcile_apply_v1', 'telephony_runtime_mark_v1', 'telephony_integration_health_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t4a_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname IN ('telephony_summary_ok', 'telephony_facts_ok',
      'telephony_reconcile_row') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t4a_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel293_verify$;

COMMIT;
