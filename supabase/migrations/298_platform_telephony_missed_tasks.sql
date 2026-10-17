-- 298_platform_telephony_missed_tasks — «Телефония Beeline KG» срез T8: задача
-- «Перезвонить» по пропущенному входящему, «Недозвон» с каденсом, автозакрытие по
-- отвеченному звонку, задачи по результату звонка и потолки автоматики.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1 (правила 5 и 8), §6.2, §9.1,
-- §9.2, §9.4, §16 (срез T8), ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T8»).
-- Слияние ничего не открывает: функция закрыта флагами настроек (все по умолчанию
-- выключены): projection_enabled и missed_task_enabled; env-выключатель
-- EVO_PLATFORM_TELEPHONY_ENABLED держит и фоновый скрипт, который её вызывает.
--
-- Что делает:
--  * telephony_calls.automation_done_at / automation_outcome — метка «автоматика
--    решила по этому звонку». Один звонок разбирается один раз: повторный тик ничего не
--    создаёт (идемпотентность). Выбираются завершённые (settled_at, окно успокоения
--    правила 5) звонки без метки, кроме первичного импорта (created_via = 'backfill').
--  * telephony_task_links: вид 'no_answer_hint' (подсказка руководителю после пяти
--    недозвонов за семь дней, §9.4) и счётчик occurrences (повторные пропущенные
--    увеличивают счётчик в тексте открытой задачи, §9.2).
--  * platform.telephony_automation_tick_v1(организация, лимит) — одна функция только для
--    service role, которую раз в минуту вызывает telephony-maintenance после окна
--    успокоения. По порядку:
--      0. связи, чья задача уже закрыта человеком, закрываются (task_done), иначе
--         открытая «мёртвая» связь мешала бы следующей задаче;
--      1. результат «Перезвонить» + день (T5 записал день и ничего не обещал):
--         задача на этот день в начале рабочего дня; открытые системные
--         «Перезвонить» того же лида заменяются; изменённый день — новая задача;
--      2. «Не интересно»: открытые «Перезвонить» клиента закрываются, лид не закрывается;
--      3. результат «Перезвонить» изменён на другой — задача по нему отменяется;
--      4. звонок, ставший отвеченным после решения (сверка), закрывает свою задачу, а
--         автоматический «Недозвон» у него снимается;
--      5. каждый завершённый звонок без метки: отвеченный закрывает открытые «Перезвонить»
--         клиента (звонок позже, чем звонок задачи; явную дату результата — не раньше
--         этой даты); пропущенный входящий — «Перезвонить» ответственному (владелец лида,
--         иначе последний владелец лида клиента, иначе руководитель продаж, иначе
--         администратор; кто не может получить задачу, пропускается), срок — 15 рабочих
--         минут от момента пропуска; одна открытая на лид (иначе клиента), повторные
--         пропущенные увеличивают счётчик; неоднозначный номер — «Проверить звонок»
--         руководителю; неизвестный номер — только метка (лид «Звонок» — срез T9);
--         исходящий без ответа с точным статусом вебхука — результат «Недозвон»
--         (result_code = 'no_answer', без автора) и задача по каденсу настроек, одна
--         открытая на лид, прежняя заменяется; после пяти недозвонов за семь дней —
--         подсказка руководителю.
--  * Правила отказа от решения: цепочка связанных звонков с ответом сотрудника (правило 8);
--    позже состоялся отвеченный звонок этого клиента; сверочная строка с пометкой проверки
--    (возможный дубль звонка вебхука, неизвестный статус); звонок старше двух часов по
--    settled_at (и сверочный — по началу): иначе включение флага разом засыпало бы
--    команду задачами за давние пропущенные; сверочные (pull) исходящие «Недозвон» и
--    каденс не получают (§5.4).
--  * Потолки автоматики (§9.1): не больше ceiling_tasks_hour в час и ceiling_tasks_day в
--    сутки автозадач (пропущенный, «Недозвон», «Проверить звонок», подсказка; задачи по
--    кнопке результата и счётчики не считаются: их ставит сотрудник). При превышении оба
--    флага автоматики (missed_task_enabled, unknown_lead_enabled) выключаются сами,
--    версия настроек растёт, в runtime-состоянии горит остановка (automation_stopped_*),
--    событие пишется в журнал (telephony.automation.stop); включает админ после
--    проверки. Звонок, на котором сработал потолок, остаётся без метки.
--  * Рабочие минуты: часы идут только внутри рабочего времени (дни и часы настроек, пояс
--    Asia/Bishkek): пропущено в 19:55 — срок завтра 10:10, пропущено в 03:00 — 10:15,
--    в воскресенье — понедельник 10:15. Чистые помощники работают с аргументами и
--    проверяются без часов.
--  * Задача — обычная staff_task: создатель = исполнитель (системного сотрудника нет),
--    событие, квитанция, связь с лидом (staff_lead_task_links), уведомление
--    «назначена» и строка журнала от имени system (как у 276). В «Сегодня» и в «Задачи»
--    она видна исполнителю без изменений. В тексте нет номера клиента: у «Проверить
--    звонок» только маска (278).
-- Повторный запуск целой миграции отказывает (ADD COLUMN, CREATE FUNCTION), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Столбцы, виды связей и индексы.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.telephony_calls
  ADD COLUMN automation_done_at TIMESTAMPTZ,
  ADD COLUMN automation_outcome TEXT;
ALTER TABLE platform_private.telephony_calls
  ADD CONSTRAINT telephony_calls_automation_check CHECK (
    (automation_done_at IS NULL) = (automation_outcome IS NULL)
    AND (automation_outcome IS NULL OR automation_outcome IN (
      'task_created', 'task_merged', 'tasks_closed', 'nothing_to_do', 'no_answer_task', 'no_answer_marked',
      'skipped_old', 'skipped_unmatched', 'skipped_chain', 'skipped_outcome', 'skipped_no_assignee',
      'later_answered'))
  );
COMMENT ON COLUMN platform_private.telephony_calls.automation_outcome IS
  'Telephony T8: what the missed-call automation decided for this settled call (one decision per call). NULL until it ran.';
CREATE INDEX telephony_calls_automation_idx
  ON platform_private.telephony_calls (organization_id, settled_at, id)
  WHERE settled_at IS NOT NULL AND automation_done_at IS NULL AND created_via <> 'backfill';
-- Результаты «Перезвонить» с днём: выбор задач по кнопке результата (шаг 1 тика).
CREATE INDEX telephony_calls_callback_result_idx
  ON platform_private.telephony_calls (organization_id, result_callback_on, id)
  WHERE result_code = 'callback';

ALTER TABLE platform_private.telephony_task_links
  DROP CONSTRAINT telephony_task_links_kind_check;
ALTER TABLE platform_private.telephony_task_links
  ADD CONSTRAINT telephony_task_links_kind_check CHECK (kind IN ('missed_callback', 'no_answer_callback',
    'result_callback', 'verify_call', 'reached_followup', 'no_answer_hint'));
ALTER TABLE platform_private.telephony_task_links
  ADD COLUMN occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences BETWEEN 1 AND 10000);
COMMENT ON COLUMN platform_private.telephony_task_links.occurrences IS
  'Telephony T8: how many missed calls this open task stands for (plan 9.2: repeats raise the counter, not the number of tasks).';
-- Потолки считают автозадачи по времени создания.
CREATE INDEX telephony_task_links_created_idx
  ON platform_private.telephony_task_links (organization_id, created_at DESC);
-- Открытые связи по клиенту (закрытие по ответу, «Не интересно»).
CREATE INDEX telephony_task_links_open_client_idx
  ON platform_private.telephony_task_links (organization_id, client_id)
  WHERE closed_at IS NULL AND client_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Рабочие минуты (чистые помощники; пояс Asia/Bishkek без перехода на летнее время).
-- ---------------------------------------------------------------------------

-- Рабочий ли день (1 — понедельник … 7 — воскресенье, ISO).
CREATE FUNCTION platform_private.telephony_work_day_ok(p_day DATE, p_days SMALLINT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (extract(isodow FROM p_day))::SMALLINT = ANY (p_days)
$$;

-- Момент через p_minutes рабочих минут после p_from: часы идут только в рабочие дни
-- между p_open и p_close. Нерабочее начало сдвигается на ближайшее открытие.
-- 19:55 + 15 → завтра 10:10; 03:00 + 15 → 10:15; воскресенье + 15 → понедельник 10:15.
CREATE FUNCTION platform_private.telephony_add_work_minutes(
  p_from TIMESTAMPTZ, p_minutes INTEGER, p_days SMALLINT[], p_open TIME, p_close TIME
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_tz CONSTANT TEXT := 'Asia/Bishkek';
  v_loc TIMESTAMP; v_day DATE; v_from TIME; v_left INTERVAL; v_avail INTERVAL; v_guard INTEGER := 0;
BEGIN
  IF p_from IS NULL OR NOT isfinite(p_from) OR p_minutes IS NULL OR p_minutes NOT BETWEEN 0 AND 10080
     OR NOT platform_private.telephony_working_days_ok(p_days) OR p_open IS NULL OR p_close IS NULL
     OR p_open >= p_close THEN
    RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
  END IF;
  v_loc := p_from AT TIME ZONE v_tz;
  v_left := make_interval(mins => p_minutes);
  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 400 THEN
      RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
    END IF;
    v_day := v_loc::DATE;
    IF platform_private.telephony_work_day_ok(v_day, p_days) AND v_loc::TIME < p_close THEN
      v_from := GREATEST(v_loc::TIME, p_open);
      v_avail := p_close - v_from;
      IF v_left <= v_avail THEN
        RETURN (v_day + v_from + v_left) AT TIME ZONE v_tz;
      END IF;
      v_left := v_left - v_avail;
    END IF;
    v_loc := (v_day + 1)::TIMESTAMP;
  END LOOP;
END
$$;

-- Следующий рабочий день после местной даты p_from, в p_at (не раньше открытия и не
-- позже закрытия).
CREATE FUNCTION platform_private.telephony_next_work_day_at(
  p_from TIMESTAMPTZ, p_at TIME, p_days SMALLINT[], p_open TIME, p_close TIME
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_tz CONSTANT TEXT := 'Asia/Bishkek';
  v_day DATE; v_guard INTEGER := 0;
BEGIN
  IF p_from IS NULL OR NOT isfinite(p_from) OR p_at IS NULL OR NOT platform_private.telephony_working_days_ok(p_days)
     OR p_open IS NULL OR p_close IS NULL OR p_open >= p_close THEN
    RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
  END IF;
  v_day := (p_from AT TIME ZONE v_tz)::DATE;
  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 400 THEN
      RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
    END IF;
    v_day := v_day + 1;
    IF platform_private.telephony_work_day_ok(v_day, p_days) THEN
      RETURN (v_day + LEAST(GREATEST(p_at, p_open), p_close)) AT TIME ZONE v_tz;
    END IF;
  END LOOP;
END
$$;

-- Через p_n рабочих дней, в то же местное время суток (в пределах рабочих часов).
CREATE FUNCTION platform_private.telephony_add_work_days(
  p_from TIMESTAMPTZ, p_n INTEGER, p_days SMALLINT[], p_open TIME, p_close TIME
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_tz CONSTANT TEXT := 'Asia/Bishkek';
  v_loc TIMESTAMP; v_day DATE; v_left INTEGER; v_guard INTEGER := 0;
BEGIN
  IF p_from IS NULL OR NOT isfinite(p_from) OR p_n IS NULL OR p_n NOT BETWEEN 0 AND 30
     OR NOT platform_private.telephony_working_days_ok(p_days) OR p_open IS NULL OR p_close IS NULL
     OR p_open >= p_close THEN
    RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
  END IF;
  v_loc := p_from AT TIME ZONE v_tz;
  v_day := v_loc::DATE;
  v_left := p_n;
  WHILE v_left > 0 LOOP
    v_guard := v_guard + 1;
    IF v_guard > 400 THEN
      RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
    END IF;
    v_day := v_day + 1;
    IF platform_private.telephony_work_day_ok(v_day, p_days) THEN
      v_left := v_left - 1;
    END IF;
  END LOOP;
  RETURN (v_day + LEAST(GREATEST(date_trunc('minute', v_loc)::TIME, p_open), p_close)) AT TIME ZONE v_tz;
END
$$;

-- Один шаг каденса «Недозвона» (форма — telephony_cadence_step_ok, 288).
CREATE FUNCTION platform_private.telephony_cadence_due(
  p_from TIMESTAMPTZ, p_step JSONB, p_days SMALLINT[], p_open TIME, p_close TIME
) RETURNS TIMESTAMPTZ LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT platform_private.telephony_cadence_step_ok(p_step) THEN
    RAISE EXCEPTION 'telephony_work_time_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN CASE p_step ->> 'unit'
    WHEN 'work_hours' THEN platform_private.telephony_add_work_minutes(p_from, ((p_step ->> 'n')::INTEGER) * 60,
      p_days, p_open, p_close)
    WHEN 'work_days' THEN platform_private.telephony_add_work_days(p_from, (p_step ->> 'n')::INTEGER,
      p_days, p_open, p_close)
    ELSE platform_private.telephony_next_work_day_at(p_from, (p_step ->> 'at')::TIME, p_days, p_open, p_close)
  END;
END
$$;

-- Местная метка для текста задачи: «17.10 в 19:55». Ни номера, ни имени.
CREATE FUNCTION platform_private.telephony_local_stamp(p_at TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_char(p_at AT TIME ZONE 'Asia/Bishkek', 'DD.MM "в" HH24:MI')
$$;

-- ---------------------------------------------------------------------------
-- Ответственный и открытая связь.
-- ---------------------------------------------------------------------------

-- Может ли сотрудник получить рабочую задачу (как в 276): активный, не студент, и
-- право читать и закрывать staff-задачи.
CREATE FUNCTION platform_private.telephony_task_assignee_ok(p_org UUID, p_member UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_member IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_org AND m.id = p_member AND m.status = 'active' AND p.status = 'active'
        AND m."current_role" IS DISTINCT FROM 'student')
    AND platform_private.staff_can_receive_assignment(p_org, p_member, 'staff.task.complete', 'staff_task', NULL)
    AND platform_private.staff_can_receive_assignment(p_org, p_member, 'staff.task.read', 'staff_task', NULL)
$$;

-- Первый из кандидатов, кто может получить задачу; иначе первый подходящий
-- администратор (по дате создания, затем id); иначе NULL.
CREATE FUNCTION platform_private.telephony_pick_assignee(p_org UUID, p_candidates UUID[])
RETURNS UUID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_candidate UUID;
BEGIN
  FOREACH v_candidate IN ARRAY COALESCE(p_candidates, ARRAY[]::UUID[]) LOOP
    IF v_candidate IS NOT NULL AND platform_private.telephony_task_assignee_ok(p_org, v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  FOR v_candidate IN SELECT m.id FROM platform.organization_memberships m
    WHERE m.organization_id = p_org AND m.is_system_admin AND m.status = 'active'
    ORDER BY m.created_at, m.id LOOP
    IF platform_private.telephony_task_assignee_ok(p_org, v_candidate) THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

-- Руководитель продаж (получатель эскалаций настроек), иначе администратор.
CREATE FUNCTION platform_private.telephony_head_assignee(p_org UUID)
RETURNS UUID LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT platform_private.telephony_pick_assignee(p_org,
    ARRAY[(SELECT s.escalation_membership_id FROM platform_private.telephony_settings s
      WHERE s.organization_id = p_org)])
$$;

-- Ответственный за звонок клиента (§9.2): p_first (кто нажал результат), владелец лида,
-- без лида — последний владелец лида клиента (§6.2, §18.12), затем руководитель продаж
-- и администратор.
CREATE FUNCTION platform_private.telephony_call_responsible(p_org UUID, p_client UUID, p_lead UUID, p_first UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_owner UUID; v_escalation UUID;
BEGIN
  IF p_lead IS NOT NULL THEN
    SELECT l.current_owner_membership_id INTO v_owner FROM platform.leads l
    WHERE l.organization_id = p_org AND l.id = p_lead;
  ELSIF p_client IS NOT NULL THEN
    SELECT l.current_owner_membership_id INTO v_owner FROM platform.leads l
    WHERE l.organization_id = p_org AND l.client_id = p_client AND l.current_owner_membership_id IS NOT NULL
    ORDER BY l.updated_at DESC, l.id LIMIT 1;
  END IF;
  SELECT s.escalation_membership_id INTO v_escalation FROM platform_private.telephony_settings s
  WHERE s.organization_id = p_org;
  RETURN platform_private.telephony_pick_assignee(p_org, ARRAY[p_first, v_owner, v_escalation]);
END
$$;

-- Лид, к которому относится звонок сейчас: лид звонка, пока он открыт; иначе самый
-- недавно обновлённый открытый лид клиента; иначе NULL (§6.2: открытых нет).
CREATE FUNCTION platform_private.telephony_current_lead(p_org UUID, p_client UUID, p_call_lead UUID)
RETURNS UUID LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT l.id FROM platform.leads l WHERE l.organization_id = p_org AND l.id = p_call_lead
      AND l.client_id = p_client AND l.lifecycle_state = 'open'),
    (SELECT l.id FROM platform.leads l WHERE l.organization_id = p_org AND l.client_id = p_client
      AND l.lifecycle_state = 'open' ORDER BY l.updated_at DESC, l.id LIMIT 1))
$$;

-- Открытая связь вида и предмета; если её задачу человек уже закрыл или отменил,
-- связь закрывается (task_done) и возвращается NULL. Строки блокируются.
CREATE FUNCTION platform_private.telephony_open_link(p_org UUID, p_kind TEXT, p_scope UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE l platform_private.telephony_task_links%ROWTYPE; v_status platform.case_task_status;
BEGIN
  SELECT * INTO l FROM platform_private.telephony_task_links x
  WHERE x.organization_id = p_org AND x.kind = p_kind AND x.scope_id = p_scope AND x.closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT t.status INTO v_status FROM platform.staff_tasks t
  WHERE t.organization_id = p_org AND t.id = l.task_id FOR UPDATE;
  IF NOT FOUND OR v_status IN ('done', 'cancelled') THEN
    UPDATE platform_private.telephony_task_links x SET closed_at = clock_timestamp(), closed_reason = 'task_done'
    WHERE x.id = l.id;
    RETURN NULL;
  END IF;
  RETURN l.id;
END
$$;

-- ---------------------------------------------------------------------------
-- Создание, слияние и закрытие задач. Задача — обычная staff_task: создатель =
-- исполнитель (как 276), событие, квитанция, связь с лидом, уведомление, журнал system.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_task_create(
  p_org UUID, p_kind TEXT, p_call_id UUID, p_client_id UUID, p_lead_id UUID, p_assignee UUID,
  p_title TEXT, p_description TEXT, p_priority platform.case_task_priority, p_due_at TIMESTAMPTZ, p_key TEXT
) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at TIMESTAMPTZ := clock_timestamp(); v_member RECORD; v_task platform.staff_tasks; v_req UUID;
  v_payload JSONB; v_result JSONB; v_event UUID; v_link UUID;
BEGIN
  SELECT m.id, m.profile_id INTO v_member FROM platform.organization_memberships m
  WHERE m.organization_id = p_org AND m.id = p_assignee FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telephony_task_assignee_missing' USING ERRCODE = 'P0002';
  END IF;
  v_req := platform_private.p3c_request_child_id(p_call_id, 'telephony-task:' || p_kind || ':' || p_key);
  INSERT INTO platform.staff_tasks (organization_id, creator_membership_id, assignee_membership_id, title, description,
    status, priority, due_at, created_at, updated_at)
  VALUES (p_org, v_member.id, v_member.id, p_title, p_description, 'open', p_priority, p_due_at, v_at, v_at)
  RETURNING * INTO v_task;
  v_payload := jsonb_build_object('operation', 'create', 'source', 'telephony', 'kind', p_kind, 'call_id', p_call_id);
  v_result := jsonb_build_object('staff_task_id', v_task.id, 'version', v_task.version::TEXT, 'request_id', v_req,
    'changed_at', v_at);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
    version, before_state, after_state, request_id, created_at)
  VALUES (p_org, v_task.id, v_member.id, v_member.profile_id, 'create', v_task.version, NULL, to_jsonb(v_task), v_req, v_at)
  RETURNING id INTO v_event;
  -- Создатель = исполнитель, поэтому триггер уведомлений (142) автора события не
  -- уведомит: «назначена» тем же ключом события, как в 276.
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
  VALUES (p_org, v_member.id, 'task:' || v_event::TEXT, 'task_assigned', v_task.id)
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  INSERT INTO platform_private.staff_task_receipts (request_id, organization_id, actor_membership_id, staff_task_id,
    request_payload, result)
  VALUES (v_req, p_org, v_member.id, v_task.id, v_payload, v_result);
  IF p_lead_id IS NOT NULL THEN
    INSERT INTO platform_private.staff_lead_task_links (request_id, organization_id, actor_membership_id, staff_task_id,
      lead_id, input, result)
    VALUES (v_req, p_org, v_member.id, v_task.id, p_lead_id, v_payload, v_result);
  END IF;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (p_org, 'system', NULL, 'telephony-automation', 'staff.task.create', 'staff_task', v_task.id, NULL,
    v_result || jsonb_build_object('assigneeMembershipId', v_member.id, 'leadId', p_lead_id, 'callId', p_call_id,
      'kind', p_kind),
    'Телефония: автоматическая задача по звонку', v_req, v_at);
  INSERT INTO platform_private.telephony_task_links (organization_id, kind, task_id, call_id, client_id, lead_id, scope_id)
  VALUES (p_org, p_kind, v_task.id, p_call_id, p_client_id, p_lead_id, COALESCE(p_lead_id, p_client_id, p_call_id))
  RETURNING id INTO v_link;
  RETURN v_link;
END
$$;

-- Ещё один пропущенный звонок в открытую «Перезвонить»: счётчик и текст, срок прежний.
CREATE FUNCTION platform_private.telephony_task_merge(p_org UUID, p_link_id UUID, p_call_id UUID)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l platform_private.telephony_task_links%ROWTYPE; v_old platform.staff_tasks; v_new platform.staff_tasks;
  v_first TIMESTAMPTZ; v_this TIMESTAMPTZ; v_at TIMESTAMPTZ := clock_timestamp(); v_profile UUID; v_req UUID;
BEGIN
  SELECT * INTO l FROM platform_private.telephony_task_links x WHERE x.organization_id = p_org AND x.id = p_link_id FOR UPDATE;
  SELECT c.started_at INTO v_first FROM platform_private.telephony_calls c WHERE c.organization_id = p_org AND c.id = l.call_id;
  SELECT c.started_at INTO v_this FROM platform_private.telephony_calls c WHERE c.organization_id = p_org AND c.id = p_call_id;
  UPDATE platform_private.telephony_task_links x SET occurrences = x.occurrences + 1 WHERE x.id = l.id
  RETURNING * INTO l;
  SELECT * INTO v_old FROM platform.staff_tasks t WHERE t.organization_id = p_org AND t.id = l.task_id FOR UPDATE;
  UPDATE platform.staff_tasks t SET
    description = format('Пропущенный входящий звонок %s. Откройте карточку клиента и перезвоните. Пропущено звонков: %s. Последний — %s.',
      platform_private.telephony_local_stamp(v_first), l.occurrences, platform_private.telephony_local_stamp(v_this)),
    version = t.version + 1, updated_at = v_at
  WHERE t.id = v_old.id RETURNING * INTO v_new;
  SELECT p.id INTO v_profile FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_org AND m.id = v_new.assignee_membership_id;
  v_req := platform_private.p3c_request_child_id(v_new.id, 'telephony-merge:' || v_new.version::TEXT);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
    version, before_state, after_state, request_id, created_at)
  VALUES (p_org, v_new.id, v_new.assignee_membership_id, v_profile, 'edit', v_new.version, to_jsonb(v_old),
    to_jsonb(v_new), v_req, v_at);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (p_org, 'system', NULL, 'telephony-automation', 'staff.task.edit', 'staff_task', v_new.id, NULL,
    jsonb_build_object('staff_task_id', v_new.id, 'version', v_new.version::TEXT, 'callId', p_call_id,
      'occurrences', l.occurrences),
    'Телефония: ещё один пропущенный звонок в открытой задаче', v_req, v_at);
END
$$;

-- Закрытие связи и её задачи. Причины: answered_call (задача done), replaced и
-- cancelled (задача cancelled). Если задачу уже закрыл человек — связь закрывается как
-- task_done без записей о задаче. Возвращает TRUE, если связь была открыта.
CREATE FUNCTION platform_private.telephony_task_close(p_org UUID, p_link_id UUID, p_reason TEXT, p_call_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l platform_private.telephony_task_links%ROWTYPE; v_old platform.staff_tasks; v_new platform.staff_tasks;
  v_at TIMESTAMPTZ := clock_timestamp(); v_profile UUID; v_req UUID; v_reason TEXT := p_reason;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('answered_call', 'replaced', 'cancelled') THEN
    RAISE EXCEPTION 'telephony_task_close_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO l FROM platform_private.telephony_task_links x
  WHERE x.organization_id = p_org AND x.id = p_link_id AND x.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  SELECT * INTO v_old FROM platform.staff_tasks t WHERE t.organization_id = p_org AND t.id = l.task_id FOR UPDATE;
  IF FOUND AND v_old.status NOT IN ('done', 'cancelled') THEN
    UPDATE platform.staff_tasks t SET
      status = CASE p_reason WHEN 'answered_call' THEN 'done'::platform.case_task_status
        ELSE 'cancelled'::platform.case_task_status END,
      version = t.version + 1, updated_at = v_at
    WHERE t.id = v_old.id RETURNING * INTO v_new;
    SELECT p.id INTO v_profile FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_org AND m.id = v_new.assignee_membership_id;
    v_req := platform_private.p3c_request_child_id(v_new.id, 'telephony-close:' || v_new.version::TEXT);
    INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
      version, before_state, after_state, request_id, created_at)
    VALUES (p_org, v_new.id, v_new.assignee_membership_id, v_profile, 'status', v_new.version, to_jsonb(v_old),
      to_jsonb(v_new), v_req, v_at);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
      resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
    VALUES (p_org, 'system', NULL, 'telephony-automation', 'staff.task.status', 'staff_task', v_new.id, NULL,
      jsonb_build_object('staff_task_id', v_new.id, 'version', v_new.version::TEXT, 'status', v_new.status,
        'reason', p_reason, 'callId', p_call_id, 'kind', l.kind),
      'Телефония: задача закрыта автоматически', v_req, v_at);
  ELSE
    v_reason := 'task_done';
  END IF;
  UPDATE platform_private.telephony_task_links x SET closed_at = v_at, closed_reason = v_reason,
    closed_call_id = CASE WHEN v_reason = 'task_done' THEN NULL ELSE p_call_id END
  WHERE x.id = l.id;
  RETURN TRUE;
END
$$;

-- ---------------------------------------------------------------------------
-- Потолки автоматики (§9.1).
-- ---------------------------------------------------------------------------

-- Код сработавшего потолка (tasks_hour, tasks_day) или NULL. Считаются автозадачи по
-- звонкам (не задачи по кнопке результата): создание ещё одной сверх потолка запрещено.
CREATE FUNCTION platform_private.telephony_ceiling_code(p_org UUID)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp(); v_hour BIGINT; v_day BIGINT;
BEGIN
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  IF NOT FOUND THEN
    RETURN 'tasks_hour';
  END IF;
  SELECT count(*) FILTER (WHERE l.created_at >= v_now - INTERVAL '1 hour'), count(*) INTO v_hour, v_day
  FROM platform_private.telephony_task_links l
  WHERE l.organization_id = p_org AND l.created_at >= v_now - INTERVAL '24 hours'
    AND l.kind IN ('missed_callback', 'no_answer_callback', 'verify_call', 'no_answer_hint');
  RETURN CASE WHEN v_hour >= s.ceiling_tasks_hour THEN 'tasks_hour'
    WHEN v_day >= s.ceiling_tasks_day THEN 'tasks_day' END;
END
$$;

-- Остановка автоматики по потолку: оба флага выключаются, версия настроек растёт,
-- в состоянии горит остановка, в журнал — телефония.автоматика.стоп.
CREATE FUNCTION platform_private.telephony_automation_trip(p_org UUID, p_code TEXT)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s platform_private.telephony_settings%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_code IS NULL OR p_code NOT IN ('leads_hour', 'leads_day', 'tasks_hour', 'tasks_day') THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE platform_private.telephony_settings x SET missed_task_enabled = FALSE, unknown_lead_enabled = FALSE,
    version = x.version + 1, updated_at = v_now
  WHERE x.organization_id = p_org;
  INSERT INTO platform_private.telephony_runtime_state (organization_id) VALUES (p_org)
  ON CONFLICT (organization_id) DO NOTHING;
  UPDATE platform_private.telephony_runtime_state x SET automation_stopped_at = v_now, automation_stop_code = p_code,
    updated_at = v_now
  WHERE x.organization_id = p_org;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (p_org, 'system', NULL, 'telephony-automation', 'telephony.automation.stop', 'telephony_settings', p_org,
    jsonb_build_object('missedTaskEnabled', s.missed_task_enabled, 'unknownLeadEnabled', s.unknown_lead_enabled),
    jsonb_build_object('missedTaskEnabled', FALSE, 'unknownLeadEnabled', FALSE, 'code', p_code,
      'ceilingTasksHour', s.ceiling_tasks_hour, 'ceilingTasksDay', s.ceiling_tasks_day),
    'Телефония: автоматика остановлена по потолку', gen_random_uuid(), v_now);
END
$$;

-- ---------------------------------------------------------------------------
-- Решения по одному звонку.
-- ---------------------------------------------------------------------------

-- Пропущенный входящий (§9.2): «Перезвонить» ответственному или «Проверить звонок»
-- руководителю. Возвращает метку. Потолок поднимает PT429 (звонок остаётся без метки).
CREATE FUNCTION platform_private.telephony_automation_missed(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; c platform_private.telephony_calls%ROWTYPE;
  v_lead UUID; v_assignee UUID; v_link UUID; v_ceiling TEXT; v_base TIMESTAMPTZ; v_due TIMESTAMPTZ;
BEGIN
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  IF c.match_state = 'unmatched' THEN
    -- Лид «Звонок» по неизвестному номеру — срез T9.
    RETURN 'skipped_unmatched';
  END IF;
  IF platform_private.telephony_chain_answered(p_org, c.id) THEN
    RETURN 'skipped_chain';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_org AND x.id <> c.id AND x.outcome = 'answered' AND x.started_at > c.started_at
      AND ((c.client_id IS NOT NULL AND x.client_id = c.client_id)
        OR (c.client_phone IS NOT NULL AND x.client_phone = c.client_phone))) THEN
    RETURN 'later_answered';
  END IF;
  v_base := COALESCE(c.ended_at, c.last_message_at, c.started_at);
  v_due := platform_private.telephony_add_work_minutes(v_base, s.callback_work_minutes, s.working_days, s.work_from,
    s.work_to);

  IF c.match_state = 'ambiguous' THEN
    v_assignee := platform_private.telephony_head_assignee(p_org);
    IF v_assignee IS NULL THEN
      RETURN 'skipped_no_assignee';
    END IF;
    v_ceiling := platform_private.telephony_ceiling_code(p_org);
    IF v_ceiling IS NOT NULL THEN
      RAISE EXCEPTION 'telephony_ceiling_%', v_ceiling USING ERRCODE = 'PT429';
    END IF;
    PERFORM platform_private.telephony_task_create(p_org, 'verify_call', c.id, NULL, NULL, v_assignee,
      'Проверить звонок',
      format('Пропущенный входящий звонок %s: номер %s есть у нескольких клиентов, звонок ни к кому не привязан. Определите клиента и перезвоните.',
        platform_private.telephony_local_stamp(c.started_at),
        COALESCE(platform_private.whatsapp_masked_phone(ltrim(c.client_phone, '+')), 'без номера')),
      'normal', v_due, 'verify');
    RETURN 'task_created';
  END IF;

  v_lead := platform_private.telephony_current_lead(p_org, c.client_id, c.lead_id);
  v_assignee := platform_private.telephony_call_responsible(p_org, c.client_id, v_lead, NULL);
  IF v_assignee IS NULL THEN
    RETURN 'skipped_no_assignee';
  END IF;
  v_link := platform_private.telephony_open_link(p_org, 'missed_callback', COALESCE(v_lead, c.client_id));
  IF v_link IS NOT NULL THEN
    PERFORM platform_private.telephony_task_merge(p_org, v_link, c.id);
    RETURN 'task_merged';
  END IF;
  v_ceiling := platform_private.telephony_ceiling_code(p_org);
  IF v_ceiling IS NOT NULL THEN
    RAISE EXCEPTION 'telephony_ceiling_%', v_ceiling USING ERRCODE = 'PT429';
  END IF;
  PERFORM platform_private.telephony_task_create(p_org, 'missed_callback', c.id, c.client_id, v_lead, v_assignee,
    'Перезвонить клиенту',
    format('Пропущенный входящий звонок %s. Откройте карточку клиента и перезвоните. Пропущено звонков: 1.',
      platform_private.telephony_local_stamp(c.started_at)),
    'high', v_due, 'missed');
  RETURN 'task_created';
END
$$;

-- Исходящий без ответа клиента (§9.4): результат «Недозвон», задача по каденсу,
-- подсказка руководителю после пяти недозвонов за семь дней.
CREATE FUNCTION platform_private.telephony_automation_no_answer(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; c platform_private.telephony_calls%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp(); v_lead UUID; v_assignee UUID; v_head UUID; v_link UUID; v_ceiling TEXT;
  v_scope UUID; v_last_answer TIMESTAMPTZ; v_n INTEGER; v_n7 INTEGER; v_step JSONB; v_due TIMESTAMPTZ; v_base TIMESTAMPTZ;
BEGIN
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  -- Только точный статус вебхука и свои исходящие (сверка «Недозвон» не ставит, §5.4); не отказ ВАТС.
  IF c.outcome NOT IN ('missed', 'busy', 'unavailable', 'not_found', 'cancelled')
     OR c.outcome_source IS DISTINCT FROM 'webhook' OR c.created_via NOT IN ('webhook', 'dial')
     OR c.result_code IS NOT NULL THEN
    RETURN 'skipped_outcome';
  END IF;
  IF platform_private.telephony_chain_answered(p_org, c.id) THEN
    RETURN 'skipped_chain';
  END IF;
  UPDATE platform_private.telephony_calls x SET result_code = 'no_answer', result_at = v_now, result_by = NULL,
    updated_at = v_now
  WHERE x.organization_id = p_org AND x.id = c.id;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (p_org, 'system', NULL, 'telephony-automation', 'telephony.result.set', 'telephony_call', c.id,
    jsonb_build_object('resultCode', NULL, 'callbackOn', NULL),
    jsonb_build_object('resultCode', 'no_answer', 'callbackOn', NULL, 'direction', c.direction, 'leadId', c.lead_id),
    'Телефония: недозвон проставлен автоматически', gen_random_uuid(), v_now);
  IF c.client_id IS NULL THEN
    RETURN 'no_answer_marked';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_org AND x.id <> c.id AND x.outcome = 'answered' AND x.started_at > c.started_at
      AND x.client_id = c.client_id) THEN
    RETURN 'no_answer_marked';
  END IF;

  v_lead := platform_private.telephony_current_lead(p_org, c.client_id, c.lead_id);
  v_scope := COALESCE(v_lead, c.client_id);
  v_assignee := platform_private.telephony_call_responsible(p_org, c.client_id, v_lead, NULL);
  IF v_assignee IS NULL THEN
    RETURN 'skipped_no_assignee';
  END IF;
  -- Шаг каденса: сколько недозвонов подряд после последнего ответа клиента.
  SELECT max(x.started_at) INTO v_last_answer FROM platform_private.telephony_calls x
  WHERE x.organization_id = p_org AND x.client_id = c.client_id AND x.outcome = 'answered'
    AND x.started_at < c.started_at;
  SELECT count(*), count(*) FILTER (WHERE x.started_at > c.started_at - INTERVAL '7 days')
  INTO v_n, v_n7
  FROM platform_private.telephony_calls x
  WHERE x.organization_id = p_org AND x.client_id = c.client_id AND x.result_code = 'no_answer'
    AND x.started_at <= c.started_at AND (v_last_answer IS NULL OR x.started_at > v_last_answer);
  v_step := s.no_answer_cadence -> (LEAST(v_n, jsonb_array_length(s.no_answer_cadence)) - 1);
  v_base := COALESCE(c.ended_at, c.started_at);
  v_due := platform_private.telephony_cadence_due(v_base, v_step, s.working_days, s.work_from, s.work_to);

  -- Одна открытая «Перезвонить» на лид: прежние по каденсу и по пропущенному заменяются.
  v_link := platform_private.telephony_open_link(p_org, 'no_answer_callback', v_scope);
  IF v_link IS NOT NULL THEN
    PERFORM platform_private.telephony_task_close(p_org, v_link, 'replaced', c.id);
  END IF;
  v_link := platform_private.telephony_open_link(p_org, 'missed_callback', v_scope);
  IF v_link IS NOT NULL THEN
    PERFORM platform_private.telephony_task_close(p_org, v_link, 'replaced', c.id);
  END IF;
  v_ceiling := platform_private.telephony_ceiling_code(p_org);
  IF v_ceiling IS NOT NULL THEN
    RAISE EXCEPTION 'telephony_ceiling_%', v_ceiling USING ERRCODE = 'PT429';
  END IF;
  PERFORM platform_private.telephony_task_create(p_org, 'no_answer_callback', c.id, c.client_id, v_lead, v_assignee,
    'Перезвонить клиенту: недозвон',
    format('Звонок %s остался без ответа клиента. Попробуйте ещё раз. Недозвонов подряд: %s.',
      platform_private.telephony_local_stamp(c.started_at), v_n),
    'normal', v_due, 'no_answer');

  -- Пять недозвонов за семь дней (и дальше каждые пять): подсказка руководителю, не закрытие.
  IF v_n7 >= 5 AND v_n7 % 5 = 0 THEN
    v_head := platform_private.telephony_head_assignee(p_org);
    IF v_head IS NOT NULL AND platform_private.telephony_open_link(p_org, 'no_answer_hint', v_scope) IS NULL THEN
      v_ceiling := platform_private.telephony_ceiling_code(p_org);
      IF v_ceiling IS NOT NULL THEN
        RAISE EXCEPTION 'telephony_ceiling_%', v_ceiling USING ERRCODE = 'PT429';
      END IF;
      PERFORM platform_private.telephony_task_create(p_org, 'no_answer_hint', c.id, c.client_id, v_lead, v_head,
        'Клиент не отвечает',
        format('Недозвонов за семь дней: %s. Решите, продолжать ли обзвон или закрыть лид с причиной; лид автоматически не закрывается.',
          v_n7),
        'normal', platform_private.telephony_add_work_minutes(v_now, 0, s.working_days, s.work_from, s.work_to),
        'hint');
    END IF;
  END IF;
  RETURN 'no_answer_task';
END
$$;

-- Отвеченный звонок (§9.2): закрывает открытые «Перезвонить» этого клиента, созданные
-- по более раннему звонку. Явная дата кнопки результата закрывается не раньше этой даты.
CREATE FUNCTION platform_private.telephony_automation_answered(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c platform_private.telephony_calls%ROWTYPE; r RECORD; v_closed INTEGER := 0;
BEGIN
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  IF c.client_id IS NULL THEN
    RETURN 'nothing_to_do';
  END IF;
  FOR r IN SELECT l.id FROM platform_private.telephony_task_links l
    JOIN platform_private.telephony_calls o ON o.organization_id = l.organization_id AND o.id = l.call_id
    WHERE l.organization_id = p_org AND l.closed_at IS NULL AND l.client_id = c.client_id
      AND l.kind IN ('missed_callback', 'no_answer_callback', 'no_answer_hint', 'result_callback')
      AND o.started_at < c.started_at
      AND (l.kind <> 'result_callback' OR (c.started_at AT TIME ZONE 'Asia/Bishkek')::DATE >= o.result_callback_on)
    ORDER BY l.created_at, l.id
    FOR UPDATE OF l
  LOOP
    IF platform_private.telephony_task_close(p_org, r.id, 'answered_call', c.id) THEN
      v_closed := v_closed + 1;
    END IF;
  END LOOP;
  RETURN CASE WHEN v_closed > 0 THEN 'tasks_closed' ELSE 'nothing_to_do' END;
END
$$;

-- Решение по одному завершённому звонку. Возвращает метку (автоматика_исход).
CREATE FUNCTION platform_private.telephony_automation_decide(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c platform_private.telephony_calls%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp();
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
    RETURN platform_private.telephony_automation_no_answer(p_org, p_call_id);
  END IF;
  RETURN 'skipped_outcome';
END
$$;

-- Задача по результату «Перезвонить» + день (§9.4): на этот день в начале рабочего
-- дня, тому, кто нажал результат (иначе ответственному звонка); открытые системные
-- «Перезвонить» того же предмета заменяются. Явная дата не двигается на рабочий день.
CREATE FUNCTION platform_private.telephony_automation_result_callback(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; c platform_private.telephony_calls%ROWTYPE;
  v_lead UUID; v_assignee UUID; v_link UUID; v_kind TEXT;
BEGIN
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  v_lead := platform_private.telephony_current_lead(p_org, c.client_id, c.lead_id);
  v_assignee := platform_private.telephony_call_responsible(p_org, c.client_id, v_lead, c.result_by);
  IF v_assignee IS NULL THEN
    RETURN 'skipped_no_assignee';
  END IF;
  FOREACH v_kind IN ARRAY ARRAY['missed_callback', 'no_answer_callback', 'result_callback'] LOOP
    v_link := platform_private.telephony_open_link(p_org, v_kind, COALESCE(v_lead, c.client_id));
    IF v_link IS NOT NULL THEN
      PERFORM platform_private.telephony_task_close(p_org, v_link, 'replaced', c.id);
    END IF;
  END LOOP;
  PERFORM platform_private.telephony_task_create(p_org, 'result_callback', c.id, c.client_id, v_lead, v_assignee,
    'Перезвонить клиенту',
    format('Отмечено «Перезвонить» на %s после звонка %s.', to_char(c.result_callback_on, 'DD.MM'),
      platform_private.telephony_local_stamp(c.started_at)),
    'normal', (c.result_callback_on + s.work_from) AT TIME ZONE 'Asia/Bishkek',
    'result:' || ((extract(epoch FROM c.result_at) * 1000000)::BIGINT)::TEXT);
  RETURN 'created';
END
$$;

-- ---------------------------------------------------------------------------
-- Публичный тик (только service role).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_automation_tick_v1(p_organization_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; v_now TIMESTAMPTZ; v_today DATE; r RECORD; v_outcome TEXT;
  v_trip TEXT := NULL; v_synced INTEGER := 0;
  v_cb_created INTEGER := 0; v_cb_closed INTEGER := 0; v_created INTEGER := 0; v_merged INTEGER := 0;
  v_closed INTEGER := 0; v_marked INTEGER := 0; v_skipped INTEGER := 0; v_failed INTEGER := 0;
  v_sqlstate TEXT; v_constraint TEXT; v_column TEXT; v_error TEXT := NULL;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'telephony_unknown_organization' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_organization_id;
  IF NOT FOUND OR NOT s.projection_enabled OR NOT s.missed_task_enabled THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;
  -- Один тик на организацию: второй параллельный запуск уходит, не дублируя работу.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('telephony-automation:' || p_organization_id::TEXT, 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_now := clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Asia/Bishkek')::DATE;

  -- 0. Задачу закрыл человек — связь закрывается, иначе она мешала бы следующей задаче.
  UPDATE platform_private.telephony_task_links l SET closed_at = v_now, closed_reason = 'task_done'
  FROM platform.staff_tasks t
  WHERE l.organization_id = p_organization_id AND l.closed_at IS NULL
    AND t.organization_id = l.organization_id AND t.id = l.task_id AND t.status IN ('done', 'cancelled');
  GET DIAGNOSTICS v_synced = ROW_COUNT;

  -- 1. Результат «Перезвонить» + день, по которому задачи ещё нет.
  FOR r IN SELECT c.id FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_organization_id AND c.result_code = 'callback' AND c.result_callback_on >= v_today
      AND c.client_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l
        WHERE l.organization_id = c.organization_id AND l.kind = 'result_callback' AND l.call_id = c.id
          AND l.created_at >= c.result_at)
    ORDER BY c.result_at, c.id
    LIMIT p_limit
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    BEGIN
      IF platform_private.telephony_automation_result_callback(p_organization_id, r.id) = 'created' THEN
        v_cb_created := v_cb_created + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_error := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- 2. «Не интересно»: открытые «Перезвонить» клиента закрываются, лид остаётся как есть.
  FOR r IN SELECT DISTINCT ON (l.id) l.id AS link_id, c.id AS call_id
    FROM platform_private.telephony_task_links l
    JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.client_id = l.client_id
      AND c.result_code = 'not_interested' AND c.result_at > l.created_at
    WHERE l.organization_id = p_organization_id AND l.closed_at IS NULL
      AND l.kind IN ('missed_callback', 'no_answer_callback', 'result_callback', 'no_answer_hint')
    ORDER BY l.id, c.result_at DESC
    LIMIT p_limit
  LOOP
    BEGIN
      IF platform_private.telephony_task_close(p_organization_id, r.link_id, 'cancelled', r.call_id) THEN
        v_cb_closed := v_cb_closed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_error := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- 3. Результат «Перезвонить» изменён на другой (или убран): задача по нему отменяется.
  FOR r IN SELECT l.id AS link_id FROM platform_private.telephony_task_links l
    JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
    WHERE l.organization_id = p_organization_id AND l.closed_at IS NULL AND l.kind = 'result_callback'
      AND c.result_code IS DISTINCT FROM 'callback'
    LIMIT p_limit
  LOOP
    BEGIN
      IF platform_private.telephony_task_close(p_organization_id, r.link_id, 'cancelled', NULL) THEN
        v_cb_closed := v_cb_closed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_error := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- 4. Звонок, по которому создана задача, сверка позже признала отвеченным.
  --    «Недозвон» у отвеченного звонка снимается: результат ответа ставит сотрудник (T5).
  UPDATE platform_private.telephony_calls c SET result_code = NULL, result_at = NULL, updated_at = clock_timestamp()
  WHERE c.organization_id = p_organization_id AND c.result_code = 'no_answer' AND c.outcome = 'answered';
  FOR r IN SELECT l.id AS link_id, l.call_id FROM platform_private.telephony_task_links l
    JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
    WHERE l.organization_id = p_organization_id AND l.closed_at IS NULL
      AND l.kind IN ('missed_callback', 'no_answer_callback', 'verify_call') AND c.outcome = 'answered'
    LIMIT p_limit
  LOOP
    BEGIN
      IF platform_private.telephony_task_close(p_organization_id, r.link_id, 'answered_call', r.call_id) THEN
        v_closed := v_closed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
      v_error := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
      v_failed := v_failed + 1;
    END;
  END LOOP;

  -- 5. Завершённые звонки без метки, старые вперёд; каждый — в своей точке сохранения.
  FOR r IN SELECT x.id FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_organization_id AND x.settled_at IS NOT NULL AND x.automation_done_at IS NULL
      AND x.created_via <> 'backfill'
    ORDER BY x.settled_at, x.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_outcome := platform_private.telephony_automation_decide(p_organization_id, r.id);
      UPDATE platform_private.telephony_calls x SET automation_done_at = clock_timestamp(),
        automation_outcome = v_outcome, updated_at = clock_timestamp()
      WHERE x.organization_id = p_organization_id AND x.id = r.id;
      IF v_outcome IN ('task_created', 'no_answer_task') THEN
        v_created := v_created + 1;
      ELSIF v_outcome = 'task_merged' THEN
        v_merged := v_merged + 1;
      ELSIF v_outcome = 'tasks_closed' THEN
        v_closed := v_closed + 1;
      ELSIF v_outcome = 'no_answer_marked' THEN
        v_marked := v_marked + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'PT429' THEN
        v_trip := substr(SQLERRM, length('telephony_ceiling_') + 1);
        EXIT;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_column = COLUMN_NAME;
        v_error := platform_private.telephony_error_code(v_sqlstate, v_constraint, v_column);
        v_failed := v_failed + 1;
    END;
  END LOOP;

  IF v_trip IS NOT NULL THEN
    PERFORM platform_private.telephony_automation_trip(p_organization_id, v_trip);
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN v_trip IS NULL THEN 'ok' ELSE 'stopped' END,
    'stop_code', v_trip, 'synced', v_synced, 'callback_tasks', v_cb_created, 'cancelled', v_cb_closed,
    'created', v_created, 'merged', v_merged, 'closed', v_closed, 'marked', v_marked, 'skipped', v_skipped,
    'failed', v_failed, 'last_error_code', v_error);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники без грантов, публичная функция — только service_role.
-- ---------------------------------------------------------------------------
DO $tel298_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$tel298_private_acl$;

REVOKE ALL ON FUNCTION platform.telephony_automation_tick_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.telephony_automation_tick_v1(UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION platform.telephony_automation_tick_v1(UUID, INTEGER) IS
  'Telephony T8: service-only minute tick of the missed-call automation (callback tasks, no-answer cadence, auto-close, ceilings). Closed by projection_enabled and missed_task_enabled; one decision per settled call.';
COMMENT ON FUNCTION platform_private.telephony_add_work_minutes(TIMESTAMPTZ, INTEGER, SMALLINT[], TIME, TIME) IS
  'Telephony T8: the moment p_minutes working minutes after p_from (working days and hours only, Asia/Bishkek).';

-- Самопроверка: публичная функция — definer, пустой search_path, EXECUTE только у
-- service_role; помощники — без прав клиентских ролей и с пустым search_path.
DO $tel298_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname = 'telephony_automation_tick_v1' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'telephony_t8_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname LIKE 'telephony\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t8_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$tel298_verify$;

COMMIT;
