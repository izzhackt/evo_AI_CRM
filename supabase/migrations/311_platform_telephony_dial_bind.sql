-- 311_platform_telephony_dial_bind — «Телефония Beeline KG» срез T7b: звонок из «Позвонить»
-- привязывается к своему набору, а загрузка истории (первичный импорт) идёт только за
-- последние 30 суток.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4 (первичный импорт), §6.1 (правила 5 и 8),
-- §9.4, §14 (шаг 11, предусловие `missed_task_enabled`), ADR 0033; docs/PLAN_CHANGES.md (запись
-- «Телефония T7b», продолжение «Телефония T7», п. 14б и 15б). Слияние ничего не открывает: каждый
-- флаг (`dial_enabled`, `missed_task_enabled`, `backfill_enabled`) остаётся выключенным, пока его
-- не включит агент по факту проверки; звонков эта миграция не совершает.
--
-- Что делает.
-- 1. Привязка звонка к набору (замыкает разрыв T7, п. 14б и 15б). `makecall` отвечает `callid`, а
--    `platform.telephony_dial_finish_v1` уже записывает его в строку набора (`pbx_callid`); не хватало
--    стыка со звонком. Теперь строка `telephony_calls` получает `dial_request_id` тремя путями, в
--    любом порядке прихода данных (событие раньше итога набора и наоборот):
--      а) ВСТАВКА строки звонка (BEFORE INSERT, и приём событий 289, и сверка 293 вставляют так):
--         исходящий звонок с `pbx_callid` принятого набора (`sent`) получает его набор;
--      б) ИТОГ набора `sent` (`telephony_dial_finish_v1`): уже пришедшие события этого `callid`
--         получают набор;
--      в) РЕШЕНИЕ автоматики (`telephony_automation_decide`): звонок без набора ищет его
--         `telephony_dial_bind` — по цепочке переведённых звонков (`linked_call_id`, `second_callid`
--         события TRANSFERRED: если звонок цепочки уже несёт набор, вся цепочка — тот же набор) и
--         запасным ключом плана (риск 10: `callid` ВАТС может не совпасть с ответом `makecall`, а у
--         набора без `callid` — `unconfirmed` — его нет вовсе): сотрудник из набора (логин или
--         сопоставленный сотрудник) есть среди ног звонка, номер клиента тот же, звонок начался
--         в пределах минуты до набора и двух минут после его итога; одному набору — один звонок
--         (уникальный индекс 288), и это самый ранний из подходящих звонков, а не тот, который
--         решение разбирает первым.
--    `created_via` не меняется: это «как создана строка» (сверка читает `webhook` для возможных
--    дублей, здоровье — `reconcile`); связь несёт `dial_request_id` (схема 288 это допускает у
--    исходящего звонка любого происхождения: «сверка может привязать исходящий звонок к набору
--    позже»).
--    Решение автоматики по исходящему звонку из «Позвонить»: ВАТС сначала звонит устройству
--    сотрудника и только после ответа соединяет с клиентом. Если сотрудник из набора НЕ ответил на
--    СВОЮ ногу (нет `ACCEPTED`, состояния `accepted`/`completed`/`transferred`, времени разговора
--    или `Success` с длительностью у его ноги), клиенту не звонили: «Недозвон» не ставится, задача
--    не создаётся, звонок получает метку `skipped_dial_unanswered` («вызов не принят сотрудником»),
--    результат остаётся пустым. Если сотрудник ответил, а клиент нет — прежние правила «Недозвона»
--    (T8) без изменений. Решение одно на звонок (метка `automation_done_at`, T8), поэтому повтор
--    тика, повторный итог набора и повторный поиск набора ничего не меняют.
-- 2. Окно первичного импорта — 30 суток (решение владельца 20.10.2026): нижний предел
--    `platform_private.telephony_backfill_floor(сейчас)` = `GREATEST(сейчас − 30 суток,
--    22.10.2025 00:00 Asia/Bishkek)`, считается при каждом запуске по часам базы, и прежняя
--    константа остаётся лишь абсолютным нижним пределом доступных записей. Заменены две функции 293, где
--    стояла константа: `telephony_maintenance_plan_v1` (окна назад) и `telephony_runtime_mark_v1`
--    (курсор не уходит за предел, предел ставит «завершено»; первая отметка с курсором за пределом тоже
--    зажимается на предел — раньше она сохранялась как есть). Предел плавает за «сейчас», поэтому
--    импорт, чей курсор остался позади нового предела (пауза, выключенный флаг на несколько
--    суток), план сам отмечает завершённым (иначе «идёт» без конца); флаг `backfill_enabled` по-прежнему
--    единственное, что запускает импорт, и без него и без `projection_enabled` ничего не пишется.
-- 3. Хвосты: допустимые метки автоматики (CHECK 298) получили `skipped_dial_unanswered`.
--
-- Заменены функции (CREATE OR REPLACE: права и комментарии сохраняются, тело = прежнее + описанные
-- правки; тело каждой привязано к md5 прежнего определения, чужой дрейф останавливает миграцию):
--   platform.telephony_maintenance_plan_v1 (293), platform.telephony_runtime_mark_v1 (293),
--   platform_private.telephony_automation_decide (298), platform.telephony_dial_finish_v1 (299).
-- Новые (все частные, без прав у PUBLIC и клиентских ролей): telephony_backfill_floor,
-- telephony_call_chain, telephony_dial_bind, telephony_dial_employee_answered, триггерная
-- telephony_calls_bind_dial_row. Новых публичных функций, таблиц, столбцов и данных нет.
-- Повторный запуск целой миграции отказывает (CREATE FUNCTION, якоря), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: что заменяется — живые определения 293, 298 и 299; новых имён ещё нет.
-- ---------------------------------------------------------------------------
DO $a311_anchor$
BEGIN
  IF to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_call_legs') IS NULL
    OR to_regclass('platform_private.telephony_dial_requests') IS NULL
    OR to_regclass('platform_private.telephony_runtime_state') IS NULL
    OR to_regclass('platform_private.telephony_settings') IS NULL THEN
    RAISE EXCEPTION 'a311_anchor_drift: the telephony tables are missing' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_maintenance_plan_v1(uuid)'))
        IS DISTINCT FROM 'a574625e23b938abb3b0044e2cd59add' THEN
    RAISE EXCEPTION 'a311_anchor_drift: platform.telephony_maintenance_plan_v1(uuid) is not the 293 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_runtime_mark_v1(uuid,text,timestamptz,text,jsonb,jsonb)'))
        IS DISTINCT FROM 'e55c0d546c9236bcec1291c89ef30642' THEN
    RAISE EXCEPTION 'a311_anchor_drift: platform.telephony_runtime_mark_v1 is not the 293 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform_private.telephony_automation_decide(uuid,uuid)'))
        IS DISTINCT FROM 'a9dafed771c962f0d9ef05a984cd7ae1' THEN
    RAISE EXCEPTION 'a311_anchor_drift: platform_private.telephony_automation_decide(uuid,uuid) is not the 298 definition' USING ERRCODE = '55000';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)'))
        IS DISTINCT FROM '5d799297454dde2a94df931336bc39ab' THEN
    RAISE EXCEPTION 'a311_anchor_drift: platform.telephony_dial_finish_v1 is not the 299 definition' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform_private.telephony_chain_answered(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.telephony_automation_no_answer(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a311_anchor_drift: the 289 / 298 helpers are missing' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'platform_private.telephony_calls'::regclass AND c.conname = 'telephony_calls_automation_check'
        AND pg_get_constraintdef(c.oid) LIKE '%later_answered%'
        AND pg_get_constraintdef(c.oid) NOT LIKE '%skipped_dial_unanswered%') THEN
    RAISE EXCEPTION 'a311_anchor_drift: telephony_calls_automation_check is not the 298 constraint' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname IN ('telephony_backfill_floor', 'telephony_call_chain', 'telephony_dial_bind',
        'telephony_dial_employee_answered', 'telephony_calls_bind_dial_row')
      AND n.nspname IN ('platform', 'platform_private')
  ) THEN
    RAISE EXCEPTION 'a311_anchor_drift: the T7b functions already exist' USING ERRCODE = '55000';
  END IF;
END
$a311_anchor$;

-- ---------------------------------------------------------------------------
-- 1. Метка автоматики «вызов не принят сотрудником».
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.telephony_calls DROP CONSTRAINT telephony_calls_automation_check;
ALTER TABLE platform_private.telephony_calls
  ADD CONSTRAINT telephony_calls_automation_check CHECK (
    (automation_done_at IS NULL) = (automation_outcome IS NULL)
    AND (automation_outcome IS NULL OR automation_outcome IN (
      'task_created', 'task_merged', 'tasks_closed', 'nothing_to_do', 'no_answer_task', 'no_answer_marked',
      'skipped_old', 'skipped_unmatched', 'skipped_chain', 'skipped_outcome', 'skipped_no_assignee',
      'later_answered', 'skipped_dial_unanswered'))
  );
COMMENT ON COLUMN platform_private.telephony_calls.automation_outcome IS
  'Telephony T8: what the missed-call automation decided for this settled call (one decision per call). NULL until it ran. skipped_dial_unanswered (T7b): a call from the Call button whose employee did not answer their own leg, so the client was never called.';

-- ---------------------------------------------------------------------------
-- 2. Нижний предел первичного импорта: последние 30 суток, не раньше 22.10.2025.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_backfill_floor(p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT GREATEST(p_now - INTERVAL '30 days', TIMESTAMPTZ '2025-10-21 18:00:00+00') -- 22.10.2025 00:00 Asia/Bishkek
$$;

-- ---------------------------------------------------------------------------
-- 3. Цепочка связанных звонков (как в telephony_chain_answered 289: linked_call_id в обе
-- стороны, глубина до 10, тот же клиентский номер).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_call_chain(p_org UUID, p_call_id UUID)
RETURNS TABLE (o_call_id UUID)
LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH RECURSIVE first_call AS (
    SELECT x.id, x.client_phone FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_org AND x.id = p_call_id
  ), chain(id, depth) AS (
    SELECT f.id, 0 FROM first_call f
    UNION
    SELECT n.id, ch.depth + 1
    FROM chain ch
    JOIN platform_private.telephony_calls x ON x.organization_id = p_org AND x.id = ch.id
    JOIN platform_private.telephony_calls n ON n.organization_id = p_org
      AND (n.id = x.linked_call_id OR n.linked_call_id = x.id)
    CROSS JOIN first_call f
    WHERE ch.depth < 10 AND n.client_phone IS NOT DISTINCT FROM f.client_phone
  )
  SELECT DISTINCT c.id FROM chain c
$$;

-- ---------------------------------------------------------------------------
-- 4. Набор звонка: уже привязанный, по номеру звонка ВАТС, запасным ключом. Привязывает
-- (dial_request_id) и возвращает набор; NULL — звонок не из «Позвонить» (или неоднозначно).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_dial_bind(p_org UUID, p_call_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  c platform_private.telephony_calls%ROWTYPE;
  v_dial UUID; v_call UUID;
BEGIN
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  IF NOT FOUND OR c.direction <> 'out' THEN
    RETURN NULL;
  END IF;

  -- а) Цепочка уже несёт набор: весь контакт — один звонок из «Позвонить».
  SELECT x.dial_request_id INTO v_dial
  FROM platform_private.telephony_call_chain(p_org, p_call_id) ch
  JOIN platform_private.telephony_calls x ON x.organization_id = p_org AND x.id = ch.o_call_id
  WHERE x.dial_request_id IS NOT NULL
  ORDER BY x.started_at, x.id LIMIT 1;
  IF FOUND THEN
    RETURN v_dial;
  END IF;

  -- б) Номер звонка ВАТС из ответа makecall совпал с звонком цепочки (набор принят, `sent`).
  SELECT d.id, x.id INTO v_dial, v_call
  FROM platform_private.telephony_call_chain(p_org, p_call_id) ch
  JOIN platform_private.telephony_calls x ON x.organization_id = p_org AND x.id = ch.o_call_id
    AND x.direction = 'out' AND x.dial_request_id IS NULL
  JOIN platform_private.telephony_dial_requests d ON d.organization_id = p_org AND d.pbx_callid = x.pbx_callid
    AND d.status = 'sent'
  WHERE NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
    WHERE y.organization_id = p_org AND y.dial_request_id = d.id)
  ORDER BY d.created_at, d.id LIMIT 1;
  IF FOUND THEN
    UPDATE platform_private.telephony_calls x SET dial_request_id = v_dial, updated_at = clock_timestamp()
    WHERE x.organization_id = p_org AND x.id = v_call AND x.dial_request_id IS NULL;
    RETURN v_dial;
  END IF;

  -- в) Запасной ключ плана (риск 10): сотрудник набора среди ног звонка, тот же номер клиента, время
  -- рядом с набором. Только набор, чей номер звонка не нашёлся (нет `callid` или такого звонка нет).
  IF c.client_phone IS NOT NULL THEN
    SELECT d.id INTO v_dial
    FROM platform_private.telephony_dial_requests d
    WHERE d.organization_id = p_org AND d.status IN ('requested', 'sent', 'unconfirmed')
      AND d.client_phone = c.client_phone
      AND (d.pbx_callid IS NULL OR NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
        WHERE y.organization_id = p_org AND y.pbx_callid = d.pbx_callid))
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
        WHERE y.organization_id = p_org AND y.dial_request_id = d.id)
      AND c.started_at BETWEEN d.created_at - INTERVAL '60 seconds' AND d.updated_at + INTERVAL '120 seconds'
      AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs l
        WHERE l.organization_id = p_org AND l.call_id = c.id
          AND (l.membership_id = d.membership_id OR (l.pbx_user <> '' AND lower(l.pbx_user) = lower(d.pbx_user))))
      -- Набору достаётся самый ранний подходящий звонок, а не тот, который решение разбирает первым:
      -- порядок разбора (по settled_at, потом по id) на выбор набора не влияет.
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
        WHERE y.organization_id = p_org AND y.id <> c.id AND y.direction = 'out' AND y.dial_request_id IS NULL
          AND y.client_phone = c.client_phone
          AND y.started_at BETWEEN d.created_at - INTERVAL '60 seconds' AND d.updated_at + INTERVAL '120 seconds'
          AND (y.started_at, y.id) < (c.started_at, c.id)
          AND EXISTS (SELECT 1 FROM platform_private.telephony_call_legs l2
            WHERE l2.organization_id = p_org AND l2.call_id = y.id
              AND (l2.membership_id = d.membership_id OR (l2.pbx_user <> '' AND lower(l2.pbx_user) = lower(d.pbx_user)))))
    ORDER BY abs(extract(epoch FROM (c.started_at - d.created_at))), d.id LIMIT 1;
    IF FOUND THEN
      UPDATE platform_private.telephony_calls x SET dial_request_id = v_dial, updated_at = clock_timestamp()
      WHERE x.organization_id = p_org AND x.id = c.id AND x.dial_request_id IS NULL;
      RETURN v_dial;
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN unique_violation THEN
  -- Параллельный писатель привязал этот набор к другому звонку: уникальный индекс 288 уже решил.
  RETURN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Ответил ли сотрудник из набора на СВОЮ ногу (в любом звонке цепочки). Ответ — любой
-- признак: ACCEPTED, состояние ноги, время разговора, Success с длительностью.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_dial_employee_answered(p_org UUID, p_dial_id UUID, p_call_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.telephony_dial_requests d
    JOIN platform_private.telephony_call_chain(p_org, p_call_id) ch ON TRUE
    JOIN platform_private.telephony_call_legs l ON l.organization_id = d.organization_id AND l.call_id = ch.o_call_id
    WHERE d.organization_id = p_org AND d.id = p_dial_id
      AND (l.membership_id = d.membership_id OR (l.pbx_user <> '' AND lower(l.pbx_user) = lower(d.pbx_user)))
      AND (l.accepted_at IS NOT NULL OR l.state IN ('accepted', 'completed', 'transferred')
        OR COALESCE(l.talk_seconds, 0) > 0
        OR (l.status = 'success' AND COALESCE(l.webhook_total_seconds, 0) > 0)))
$$;

-- ---------------------------------------------------------------------------
-- 6. Вставка строки звонка: исходящий звонок принятого набора с тем же `callid` получает набор
-- сразу (событие ВАТС пришло позже итога набора). Строки с сомнением о направлении пропускаются.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_calls_bind_dial_row()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE v_dial UUID;
BEGIN
  IF NEW.direction = 'out' AND NEW.dial_request_id IS NULL AND NOT NEW.needs_review THEN
    SELECT d.id INTO v_dial
    FROM platform_private.telephony_dial_requests d
    WHERE d.organization_id = NEW.organization_id AND d.pbx_callid = NEW.pbx_callid AND d.status = 'sent'
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
        WHERE y.organization_id = d.organization_id AND y.dial_request_id = d.id)
    ORDER BY d.created_at, d.id LIMIT 1;
    IF FOUND THEN
      NEW.dial_request_id := v_dial;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER telephony_calls_bind_dial_insert
  BEFORE INSERT ON platform_private.telephony_calls
  FOR EACH ROW EXECUTE FUNCTION platform_private.telephony_calls_bind_dial_row();

-- ---------------------------------------------------------------------------
-- 7. Заменённые функции (тело прежнее, правки описаны в шапке).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.telephony_maintenance_plan_v1(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tz CONSTANT TEXT := 'Asia/Bishkek';
  v_floor TIMESTAMPTZ; -- нижний предел первичного импорта: последние 30 суток, не раньше 22.10.2025
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
  v_floor := platform_private.telephony_backfill_floor(v_now);
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

  -- Первичный импорт: суточные окна назад от момента первого запуска до нижнего предела
  -- (последние 30 суток от «сейчас», не раньше 22.10.2025; сверка закрывает последние два часа,
  -- импорт идёт от «сейчас» назад без щели). Предел плавает за часами базы: импорт, который
  -- стоял (пауза, выключенный флаг) и чей курсор остался позади нового предела, уже дошёл до
  -- границы; его отмечают завершённым, иначе «Настройки» показывали бы «идёт» без конца.
  IF v_proj AND v_backfill AND rs.backfill_done_at IS NULL AND rs.backfill_cursor_at IS NOT NULL
     AND rs.backfill_cursor_at <= v_floor THEN
    UPDATE platform_private.telephony_runtime_state x SET backfill_done_at = v_now, updated_at = v_now
    WHERE x.organization_id = p_organization_id AND x.backfill_done_at IS NULL;
    rs.backfill_done_at := v_now;
  END IF;
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

CREATE OR REPLACE FUNCTION platform.telephony_runtime_mark_v1(
  p_organization_id UUID, p_event TEXT, p_cursor TIMESTAMPTZ DEFAULT NULL, p_error_code TEXT DEFAULT NULL,
  p_summary JSONB DEFAULT NULL, p_facts JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_floor TIMESTAMPTZ; -- нижний предел первичного импорта: последние 30 суток, не раньше 22.10.2025
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
  v_floor := platform_private.telephony_backfill_floor(v_now);
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
        THEN LEAST(COALESCE(x.backfill_cursor_at, GREATEST(p_cursor, v_floor)), GREATEST(p_cursor, v_floor)) ELSE x.backfill_cursor_at END,
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

CREATE OR REPLACE FUNCTION platform_private.telephony_automation_decide(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c platform_private.telephony_calls%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp(); v_dial UUID;
BEGIN
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  IF NOT FOUND OR c.outcome IS NULL THEN
    -- Звонок без итога (помечен needs_review окном успокоения): решать нечем.
    RETURN 'skipped_outcome';
  END IF;
  IF c.settled_at < v_now - INTERVAL '2 hours'
     OR (c.created_via = 'reconcile' AND c.started_at < v_now - INTERVAL '2 hours') THEN
    RETURN 'skipped_old';
  END IF;
  IF c.outcome = 'answered' THEN
    RETURN platform_private.telephony_automation_answered(p_org, p_call_id);
  ELSIF c.created_via = 'reconcile' AND c.needs_review THEN
    -- Строка сверки с пометкой проверки (возможный дубль звонка вебхука в пределах минуты или
    -- неизвестный статус): задача по ней удвоила бы счётчик уже разобранного звонка.
    RETURN 'skipped_outcome';
  ELSIF c.direction = 'in' THEN
    RETURN platform_private.telephony_automation_missed(p_org, p_call_id);
  ELSIF c.direction = 'out' THEN
    -- Звонок из «Позвонить» (набор находится по номеру звонка ВАТС, по цепочке переводов или по
    -- сотруднику, номеру и времени): ВАТС сначала звонит сотруднику, потом клиенту. Не взял свою
    -- трубку — клиенту не звонили, «Недозвона» и задачи нет (план §14, шаг 11). Взял, а клиент не
    -- ответил — обычные правила «Недозвона».
    v_dial := platform_private.telephony_dial_bind(p_org, p_call_id);
    IF v_dial IS NOT NULL AND NOT platform_private.telephony_dial_employee_answered(p_org, v_dial, p_call_id) THEN
      RETURN 'skipped_dial_unanswered';
    END IF;
    RETURN platform_private.telephony_automation_no_answer(p_org, p_call_id);
  END IF;
  RETURN 'skipped_outcome';
END
$$;

CREATE OR REPLACE FUNCTION platform.telephony_dial_finish_v1(
  p_organization_id UUID,
  p_dial_request_id UUID,
  p_membership_id UUID,
  p_outcome TEXT,
  p_pbx_callid TEXT,
  p_pbx_http_status INTEGER,
  p_error_code TEXT,
  p_refusal_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row platform_private.telephony_dial_requests;
  v_profile UUID;
  v_auth UUID;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  -- Форма итога: у каждого своя комбинация полей, остальные пусты.
  IF p_organization_id IS NULL OR p_dial_request_id IS NULL OR p_membership_id IS NULL OR p_outcome IS NULL
     OR p_outcome NOT IN ('sent', 'unconfirmed', 'failed', 'refused')
     OR (p_outcome = 'sent') <> (p_pbx_callid IS NOT NULL)
     OR (p_pbx_callid IS NOT NULL AND (char_length(p_pbx_callid) NOT BETWEEN 1 AND 200
       OR p_pbx_callid <> btrim(p_pbx_callid) OR p_pbx_callid ~ '[[:cntrl:]]'))
     OR (p_outcome IN ('failed', 'unconfirmed')) <> (p_error_code IS NOT NULL)
     OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{0,63}$')
     OR (p_outcome = 'refused') <> (p_refusal_code IS NOT NULL)
     OR (p_refusal_code IS NOT NULL AND p_refusal_code NOT IN ('pbx_offline', 'pbx_user_not_found'))
     OR (p_pbx_http_status IS NOT NULL AND p_pbx_http_status NOT BETWEEN 100 AND 599) THEN
    RAISE EXCEPTION 'telephony_dial_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM platform_private.telephony_dial_requests d
   WHERE d.organization_id = p_organization_id AND d.id = p_dial_request_id AND d.membership_id = p_membership_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_dial_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Итог уже есть: повтор ничего не меняет и не пишется в журнал.
  IF v_row.status <> 'requested' THEN
    RETURN jsonb_build_object('status', v_row.status, 'changed', FALSE);
  END IF;

  -- Отказ проверки статуса: звонка не было, номер и логин в строке не нужны и стираются.
  UPDATE platform_private.telephony_dial_requests d
     SET status = p_outcome, pbx_callid = p_pbx_callid, pbx_http_status = p_pbx_http_status,
         pbx_error_code = p_error_code, refusal_code = p_refusal_code, updated_at = v_now,
         client_phone = CASE WHEN p_outcome = 'refused' THEN NULL ELSE client_phone END,
         pbx_user = CASE WHEN p_outcome = 'refused' THEN NULL ELSE pbx_user END
   WHERE d.organization_id = p_organization_id AND d.id = p_dial_request_id;

  SELECT m.profile_id, pr.auth_user_id INTO v_profile, v_auth
    FROM platform.organization_memberships m
    JOIN platform.profiles pr ON pr.id = m.profile_id
   WHERE m.organization_id = p_organization_id AND m.id = p_membership_id;
  -- Журнал: идентификаторы и коды, без номера клиента, логина ВАТС и callid.
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at, actor_membership_id)
  VALUES (p_organization_id, 'user', v_profile, 'auth:' || COALESCE(v_auth, v_profile)::TEXT,
    'telephony.dial', 'telephony_dial_request', v_row.id,
    jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', p_outcome, 'code', COALESCE(p_refusal_code, p_error_code),
      'httpStatus', p_pbx_http_status, 'leadId', v_row.lead_id, 'dialRequestId', v_row.id),
    CASE p_outcome WHEN 'refused' THEN 'Телефония: отказ набора' ELSE 'Телефония: набор из CRM' END,
    gen_random_uuid(), v_now, p_membership_id);

  -- Принятый ВАТС набор: если события этого звонка уже пришли раньше итога, строка звонка получает
  -- свой набор сейчас; если придут позже — набор подберёт вставка строки звонка (триггер) или
  -- решение автоматики. Занятый другим звонком набор итог не роняет.
  IF p_outcome = 'sent' THEN
    BEGIN
      UPDATE platform_private.telephony_calls x SET dial_request_id = v_row.id, updated_at = v_now
      WHERE x.organization_id = p_organization_id AND x.pbx_callid = p_pbx_callid AND x.direction = 'out'
        AND x.dial_request_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls y
          WHERE y.organization_id = p_organization_id AND y.dial_request_id = v_row.id);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('status', p_outcome, 'changed', TRUE);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: частные функции закрыты для всех; у заменённых права сохранились (OR REPLACE).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform_private.telephony_backfill_floor(TIMESTAMPTZ),
  platform_private.telephony_call_chain(UUID, UUID),
  platform_private.telephony_dial_bind(UUID, UUID),
  platform_private.telephony_dial_employee_answered(UUID, UUID, UUID),
  platform_private.telephony_calls_bind_dial_row()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

COMMENT ON FUNCTION platform_private.telephony_backfill_floor(TIMESTAMPTZ) IS
  'Telephony T7b: the lower bound of the first import: the last 30 days from p_now, never earlier than 22.10.2025 00:00 Asia/Bishkek (the oldest available records).';
COMMENT ON FUNCTION platform_private.telephony_call_chain(UUID, UUID) IS
  'Telephony T7b: ids of the calls linked to a call through linked_call_id (second_callid of a transfer), both ways, depth up to 10, the same client number.';
COMMENT ON FUNCTION platform_private.telephony_dial_bind(UUID, UUID) IS
  'Telephony T7b: finds and binds (dial_request_id) the Call-button request of an outbound call: the chain already carries one, the PBX call id from makecall matches, or the plan fallback key (employee leg, client number, time). NULL when the call was not dialled from the CRM.';
COMMENT ON FUNCTION platform_private.telephony_dial_employee_answered(UUID, UUID, UUID) IS
  'Telephony T7b: whether the employee of a Call-button request answered their own leg (ACCEPTED, leg state, talk time or Success with duration) in any call of the chain. If not, the client was never called.';
COMMENT ON FUNCTION platform_private.telephony_calls_bind_dial_row() IS
  'Telephony T7b: BEFORE INSERT on telephony_calls: an outbound call with the PBX call id of a sent Call-button request gets that request at once.';
COMMENT ON FUNCTION platform_private.telephony_automation_decide(UUID, UUID) IS
  'Telephony T8 + T7b: the decision for one settled call. An outbound call from the Call button whose employee did not answer their own leg is skipped (skipped_dial_unanswered): no «Недозвон», no task.';
COMMENT ON FUNCTION platform.telephony_maintenance_plan_v1(UUID) IS
  'Telephony T4a + T7b: service-only plan for the maintenance script (what is due, windows by the database clock). No settings row = everything off. The first import covers the last 30 days only.';
COMMENT ON FUNCTION platform.telephony_runtime_mark_v1(UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB) IS
  'Telephony T4a + T7b: service-only run mark (times, cursors, PBX error code, counters, PBX facts). The reconcile cursor only moves forward, the backfill cursor only backward and stops at the 30-day floor.';
COMMENT ON FUNCTION platform.telephony_dial_finish_v1(UUID, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) IS
  'Telephony T7 + T7b: service-only. The single transition requested -> sent (call id) | unconfirmed | failed | refused (pbx_offline, pbx_user_not_found), with one telephony.dial journal row; a refused row loses the number and the PBX login (no call was made); a repeat changes nothing. A sent request also binds an already arrived outbound call with that call id.';

-- Проверка в конце: права ровно такие, как задумано.
DO $tel311_verify$
DECLARE
  r TEXT;
  f REGPROCEDURE;
  p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname IN ('telephony_backfill_floor', 'telephony_call_chain',
      'telephony_dial_bind', 'telephony_dial_employee_answered', 'telephony_calls_bind_dial_row',
      'telephony_automation_decide') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t7b_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'evo_ai_agent'] LOOP
      IF has_function_privilege(r, p.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'telephony_t7b_private_acl_drift: % %', f, r USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname IN ('telephony_maintenance_plan_v1', 'telephony_runtime_mark_v1',
      'telephony_dial_finish_v1') LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t7b_service_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'platform_private.telephony_calls'::regclass AND t.tgname = 'telephony_calls_bind_dial_insert'
        AND NOT t.tgisinternal AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'telephony_t7b_trigger_missing' USING ERRCODE = '55000';
  END IF;
END
$tel311_verify$;

COMMIT;
