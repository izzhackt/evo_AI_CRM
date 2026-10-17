-- 300_platform_telephony_unknown_leads — «Телефония Beeline KG» срез T9: неизвестный
-- входящий номер → клиент и лид «Звонок», известный клиент без открытого лида → задача
-- последнему владельцу, очередь «Заявок» v3 с вкладкой «Звонки».
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1 (правила 5 и 8), §6.2, §9.1, §9.3, §12,
-- §16 (срез T9), §18.2 (вопрос 12), ADR 0033; docs/PLAN_CHANGES.md (запись «Телефония T9»).
-- Слияние ничего не открывает: функция закрыта двумя флагами настроек (оба по умолчанию
-- выключены): projection_enabled и unknown_lead_enabled; env-выключатель
-- EVO_PLATFORM_TELEPHONY_ENABLED держит и фоновый скрипт, который её вызывает. Очередь v3
-- не показывает звонки, пока ui_enabled выключен: лиды `phone_call`, заведённые сотрудниками
-- вручную (143/264), не появляются в «Заявках» от слияния.
--
-- Что делает:
--  * telephony_calls.intake_done_at / intake_outcome — метка «приём решил по этому звонку».
--    Один звонок разбирается один раз: повторный тик ничего не создаёт (идемпотентность по
--    звонку). Отдельная от метки пропущенных звонков (срез T8, automation_done_at): срезы
--    решают независимо, порядок их вызова — в фоновом скрипте (сначала приём, потом T8).
--  * platform.telephony_intake_tick_v1(организация, лимит) — одна функция только для service
--    role, которую раз в минуту вызывает telephony-maintenance ПОСЛЕ окна успокоения и ДО
--    тика пропущенных. По порядку:
--      0. входящие звонки старше двух часов по settled_at (сверочные — по началу) получают
--         метку skipped_old одним действием: включение флага не создаёт лидов за давнюю
--         историю;
--      1. завершённые входящие звонки без метки, старые вперёд, каждый в своей точке
--         сохранения; под замком по номеру (тем же, что у ручного лида 143) номер
--         сверяется заново: клиент мог появиться за время окна и между двумя звонками одного
--         номера. Решение по состоянию в момент решения (match_state):
--           - unmatched, клиента по-прежнему нет — клиент (`Звонок +996 ••• …`, только маска) и
--             лид `source_key = 'phone_call'`, этап `new`, БЕЗ владельца, через
--             create_or_link_client / create_or_link_lead (084); звонок получает client_id,
--             lead_id и match_state = created. Создаётся и для отвеченного, и для пропущенного
--             звонка (исход lead_created); для пропущенного «Перезвонить» ответственному
--             делает тик T8 (у лида нет владельца: получатель эскалаций, иначе администратор).
--             Источник канала «Откуда узнал» не пишется: у лида без касаний он «не известно»,
--             подсказка «Спросите клиента» остаётся;
--           - unmatched, клиент появился (создан этим же тиком по прошлому звонку номера или
--             вручную) — звонок прикрепляется к нему и к его открытому лиду, нового лида нет
--             (lead_attached);
--           - matched и открытого лида нет (§6.2, §18.2 вопрос 12): отвеченный входящий —
--             задача «Клиент позвонил, открытого лида нет» последнему владельцу лида клиента,
--             иначе получателю эскалаций, иначе администратору (цепочка T8
--             telephony_call_responsible); новый лид не создаётся; одна открытая на клиента, и
--             открытая «Перезвонить» T8 по клиенту тоже считается задачей;
--           - matched с лидом, created, ambiguous («Проверить звонок» — срез T8) — ничего.
--      Исходящий звонок на неизвестный номер лид не создаёт (набор возможен только по номеру
--      из карточки, §9.3): исходящие тик не выбирает. Пропущенный известного клиента без лида —
--      «Перезвонить» последнему владельцу делает T8, здесь он пропускается.
--  * Потолки автоматики (§9.1): не больше ceiling_leads_hour лидов в час и ceiling_leads_day в
--    сутки; автозадачи этого среза считаются вместе с задачами T8 (ceiling_tasks_hour / _day).
--    При превышении вся работа звонка откатывается (звонок остаётся без метки), тик выходит,
--    оба флага автоматики выключаются сами (telephony_automation_trip, T8: версия настроек
--    растёт, в runtime-состоянии горит остановка, событие telephony.automation.stop в
--    журнале); включает админ после проверки.
--  * Задача — обычная staff_task через помощники T8 (telephony_task_create: создатель =
--    исполнитель, событие, квитанция, уведомление «назначена», строка журнала от имени
--    system; связь telephony_task_links нового вида client_no_lead). Срок — callback_work_minutes
--    рабочих минут от конца звонка, как у «Перезвонить». В тексте только маска номера.
--  * platform.staff_requests_queue_v3 — v2 (250) плюс лиды `phone_call` и вкладка «Звонки»:
--    источник 'phone_call', число вкладки, версия курсора 3 и признак phoneCalls. Лиды
--    `phone_call` входят в чтение только при ui_enabled (иначе числа нет, строк нет).
--    v2 остаётся для прежнего выпуска приложения до приёмки нового (правило 250); удаляется
--    отдельной миграцией после приёмки.
--  * Зависит от среза T8 (миграция 298): его частные помощники и вид связи задачи; без него
--    миграция отказывает (telephony_t9_prerequisites_missing).
-- Повторный запуск целой миграции отказывает (ADD COLUMN, CREATE FUNCTION), ничего не меняя.
BEGIN;

-- ---------------------------------------------------------------------------
-- Предусловия: схема и функции 084, 250, 278, срезов T1a/T1b и помощники среза T8 (298).
-- ---------------------------------------------------------------------------
DO $t300_guard$
BEGIN
  IF to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.telephony_settings') IS NULL
    OR to_regclass('platform_private.telephony_task_links') IS NULL
    OR to_regclass('platform_private.telephony_runtime_state') IS NULL
    OR to_regprocedure('platform_private.telephony_match_phone(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.whatsapp_masked_phone(text)') IS NULL
    OR to_regprocedure('platform_private.telephony_task_create(uuid,text,uuid,uuid,uuid,uuid,text,text,platform.case_task_priority,timestamp with time zone,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_call_responsible(uuid,uuid,uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.telephony_open_link(uuid,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.telephony_automation_trip(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.telephony_add_work_minutes(timestamp with time zone,integer,smallint[],time without time zone,time without time zone)') IS NULL
    OR to_regprocedure('platform_private.telephony_local_stamp(timestamp with time zone)') IS NULL
    OR to_regprocedure('platform_private.telephony_error_code(text,text,text)') IS NULL
    OR to_regprocedure('platform_private.create_or_link_client(uuid,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)') IS NULL
    OR to_regprocedure('platform_private.create_or_link_lead(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)') IS NULL
    OR to_regprocedure('platform.staff_requests_queue_v2(uuid,text,text,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'telephony_t9_prerequisites_missing' USING ERRCODE = '55000';
  END IF;
END
$t300_guard$;

-- ---------------------------------------------------------------------------
-- Метка решения приёма на звонке и индексы.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.telephony_calls
  ADD COLUMN intake_done_at TIMESTAMPTZ,
  ADD COLUMN intake_outcome TEXT;
ALTER TABLE platform_private.telephony_calls
  ADD CONSTRAINT telephony_calls_intake_check CHECK (
    (intake_done_at IS NULL) = (intake_outcome IS NULL)
    AND (intake_outcome IS NULL OR intake_outcome IN ('lead_created', 'lead_attached', 'client_task_created',
      'client_task_exists', 'nothing_to_do', 'skipped_old', 'skipped_outcome', 'skipped_phone',
      'skipped_no_assignee'))
  );
COMMENT ON COLUMN platform_private.telephony_calls.intake_outcome IS
  'Telephony T9: what the unknown-number intake decided for this settled inbound call (one decision per call). NULL until it ran.';

-- Новый вид связи задачи: «Клиент позвонил, открытого лида нет» (T9). Частичный уникальный индекс
-- T1a даёт «одна открытая на клиента» (предмет связи — клиент, лида нет).
ALTER TABLE platform_private.telephony_task_links
  DROP CONSTRAINT telephony_task_links_kind_check;
ALTER TABLE platform_private.telephony_task_links
  ADD CONSTRAINT telephony_task_links_kind_check CHECK (kind IN ('missed_callback', 'no_answer_callback',
    'result_callback', 'verify_call', 'reached_followup', 'no_answer_hint', 'client_no_lead'));
CREATE INDEX telephony_calls_intake_idx
  ON platform_private.telephony_calls (organization_id, settled_at, id)
  WHERE settled_at IS NOT NULL AND intake_done_at IS NULL AND direction = 'in' AND created_via <> 'backfill';
-- Потолок лидов считает созданные лиды по времени решения.
CREATE INDEX telephony_calls_intake_done_idx
  ON platform_private.telephony_calls (organization_id, intake_done_at DESC)
  WHERE intake_outcome = 'lead_created';

-- ---------------------------------------------------------------------------
-- Потолки автоматики (§9.1).
-- ---------------------------------------------------------------------------

-- Код сработавшего потолка (leads_hour, leads_day, tasks_hour, tasks_day) или NULL. Создание
-- ещё одного лида (или задачи) сверх потолка запрещено. Автозадачи считаются по связям всех
-- видов автоматики (T8 и этот срез) за те же окна, что и у T8; остановка — telephony_automation_trip (T8).
CREATE FUNCTION platform_private.telephony_intake_ceiling_code(p_org UUID, p_kind TEXT)
RETURNS TEXT LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; v_now TIMESTAMPTZ := clock_timestamp(); v_hour BIGINT; v_day BIGINT;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('leads', 'tasks') THEN
    RAISE EXCEPTION 'telephony_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  IF NOT FOUND THEN
    RETURN p_kind || '_hour';
  END IF;
  IF p_kind = 'leads' THEN
    SELECT count(*) FILTER (WHERE c.intake_done_at >= v_now - INTERVAL '1 hour'), count(*) INTO v_hour, v_day
    FROM platform_private.telephony_calls c
    WHERE c.organization_id = p_org AND c.intake_outcome = 'lead_created'
      AND c.intake_done_at >= v_now - INTERVAL '24 hours';
    RETURN CASE WHEN v_hour >= s.ceiling_leads_hour THEN 'leads_hour'
      WHEN v_day >= s.ceiling_leads_day THEN 'leads_day' END;
  END IF;
  SELECT count(*) FILTER (WHERE l.created_at >= v_now - INTERVAL '1 hour'), count(*) INTO v_hour, v_day
  FROM platform_private.telephony_task_links l
  WHERE l.organization_id = p_org AND l.created_at >= v_now - INTERVAL '24 hours'
    AND l.kind IN ('missed_callback', 'no_answer_callback', 'verify_call', 'no_answer_hint', 'client_no_lead');
  RETURN CASE WHEN v_hour >= s.ceiling_tasks_hour THEN 'tasks_hour'
    WHEN v_day >= s.ceiling_tasks_day THEN 'tasks_day' END;
END
$$;

-- ---------------------------------------------------------------------------
-- Решение по одному завершённому входящему звонку. Возвращает метку (intake_outcome). Потолок
-- поднимает PT429 (звонок остаётся без метки, вся его работа откатывается).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.telephony_intake_decide(p_org UUID, p_call_id UUID)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; c platform_private.telephony_calls%ROWTYPE; m RECORD;
  v_digits TEXT; v_mask TEXT; v_client UUID; v_lead UUID; v_code TEXT; v_assignee UUID;
  v_attached BOOLEAN := FALSE;
BEGIN
  SELECT * INTO s FROM platform_private.telephony_settings x WHERE x.organization_id = p_org;
  SELECT * INTO c FROM platform_private.telephony_calls x WHERE x.organization_id = p_org AND x.id = p_call_id;
  -- Звонок без итога (помечен needs_review окном успокоения) и исходящий: решать нечем и нечего.
  IF NOT FOUND OR c.outcome IS NULL OR c.direction <> 'in' THEN
    RETURN 'skipped_outcome';
  END IF;
  -- Строка сверки с пометкой проверки — возможный дубль звонка вебхука (T4a). Звонок вебхука с
  -- той же пометкой (сообщение с пустым полем) — настоящий и разбирается.
  IF c.created_via = 'reconcile' AND c.needs_review THEN
    RETURN 'skipped_outcome';
  END IF;

  IF c.match_state = 'unmatched' THEN
    IF c.client_phone IS NULL THEN
      -- Анонимный звонящий: клиента без номера не заводим.
      RETURN 'skipped_phone';
    END IF;
    -- Замок по номеру (тот же ключ, что у ручного лида 143): ручной ввод и приём не создадут двух
    -- клиентов одного номера; под замком номер сверяется заново.
    PERFORM pg_catalog.pg_advisory_xact_lock(hashtextextended(
      'manual-lead-contact:' || p_org::TEXT || ':' || platform_private.normalize_person_phone(c.client_phone), 0));
    SELECT * INTO m FROM platform_private.telephony_match_phone(p_org, c.client_phone);
    IF m.m_state = 'ambiguous' THEN
      UPDATE platform_private.telephony_calls x SET match_state = 'ambiguous', client_id = NULL, lead_id = NULL,
        updated_at = clock_timestamp()
      WHERE x.organization_id = p_org AND x.id = c.id;
      RETURN 'nothing_to_do';
    ELSIF m.m_state = 'matched' THEN
      -- Клиент появился после окна звонка (прошлый звонок номера, ручной ввод): прикрепляем.
      UPDATE platform_private.telephony_calls x SET match_state = 'matched', client_id = m.m_client_id,
        lead_id = m.m_lead_id, updated_at = clock_timestamp()
      WHERE x.organization_id = p_org AND x.id = c.id;
      c.client_id := m.m_client_id;
      c.lead_id := m.m_lead_id;
      c.match_state := 'matched';
      v_attached := TRUE;
    ELSE
      v_code := platform_private.telephony_intake_ceiling_code(p_org, 'leads');
      IF v_code IS NOT NULL THEN
        RAISE EXCEPTION 'telephony_ceiling_%', v_code USING ERRCODE = 'PT429';
      END IF;
      v_digits := ltrim(c.client_phone, '+');
      v_mask := COALESCE(platform_private.whatsapp_masked_phone(v_digits), '••••' || right(v_digits, 4));
      -- Клиент и лид отдельными внешними личностями одного звонка (повтор по звонку вернёт тех же).
      v_client := platform_private.create_or_link_client(p_org, 'Звонок ' || v_mask, NULL, c.client_phone,
        'beeline_pbx', 'call_caller', c.pbx_callid, 'call_received', c.started_at, NULL, 'telephony-call:' || c.id::TEXT);
      v_lead := platform_private.create_or_link_lead(p_org, v_client, NULL, 'new', 'phone_call',
        'beeline_pbx', 'call_lead', c.pbx_callid, 'call_received', c.started_at, NULL, 'telephony-call:' || c.id::TEXT);
      UPDATE platform_private.telephony_calls x SET match_state = 'created', client_id = v_client, lead_id = v_lead,
        updated_at = clock_timestamp()
      WHERE x.organization_id = p_org AND x.id = c.id;
      RETURN 'lead_created';
    END IF;
  END IF;

  -- Дальше только известный клиент (matched). Неоднозначный номер (ambiguous: «Проверить звонок»
  -- руководителю — срез T8) и уже созданный (created) ничего не получают.
  IF c.match_state <> 'matched' THEN
    RETURN 'nothing_to_do';
  END IF;
  IF c.lead_id IS NOT NULL THEN
    RETURN CASE WHEN v_attached THEN 'lead_attached' ELSE 'nothing_to_do' END;
  END IF;
  -- Известный клиент без открытого лида. Пропущенный — «Перезвонить» последнему владельцу (срез T8).
  IF c.outcome <> 'answered' THEN
    RETURN 'nothing_to_do';
  END IF;
  -- Своя открытая связь (мёртвая — закрытая человеком — закрывается здесь же) и открытая задача T8
  -- по клиенту считаются задачей: второй не будет.
  IF platform_private.telephony_open_link(p_org, 'client_no_lead', c.client_id) IS NOT NULL
    OR EXISTS (SELECT 1 FROM platform_private.telephony_task_links l
      JOIN platform.staff_tasks t ON t.organization_id = l.organization_id AND t.id = l.task_id
      WHERE l.organization_id = p_org AND l.client_id = c.client_id AND l.closed_at IS NULL
        AND l.kind IN ('missed_callback', 'no_answer_callback', 'result_callback')
        AND t.status NOT IN ('done', 'cancelled')) THEN
    RETURN 'client_task_exists';
  END IF;
  -- Последний владелец лида клиента (любого, в том числе закрытого), иначе получатель эскалаций, иначе администратор.
  v_assignee := platform_private.telephony_call_responsible(p_org, c.client_id, NULL, NULL);
  IF v_assignee IS NULL THEN
    RETURN 'skipped_no_assignee';
  END IF;
  v_code := platform_private.telephony_intake_ceiling_code(p_org, 'tasks');
  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION 'telephony_ceiling_%', v_code USING ERRCODE = 'PT429';
  END IF;
  v_digits := ltrim(COALESCE(c.client_phone, ''), '+');
  PERFORM platform_private.telephony_task_create(p_org, 'client_no_lead', c.id, c.client_id, NULL, v_assignee,
    'Клиент позвонил, открытого лида нет',
    format('Входящий звонок %s от клиента без открытого лида (номер %s). Откройте карточку клиента и решите, нужен ли новый лид.',
      platform_private.telephony_local_stamp(c.started_at),
      COALESCE(platform_private.whatsapp_masked_phone(v_digits), 'без номера')),
    'normal', platform_private.telephony_add_work_minutes(COALESCE(c.ended_at, c.started_at), s.callback_work_minutes,
      s.working_days, s.work_from, s.work_to), 'client');
  RETURN 'client_task_created';
END
$$;

-- ---------------------------------------------------------------------------
-- Публичный тик (только service role).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.telephony_intake_tick_v1(p_organization_id UUID, p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s platform_private.telephony_settings%ROWTYPE; v_now TIMESTAMPTZ; r RECORD; v_outcome TEXT;
  v_trip TEXT := NULL; v_old INTEGER := 0; v_created INTEGER := 0; v_attached INTEGER := 0; v_tasks INTEGER := 0;
  v_skipped INTEGER := 0; v_failed INTEGER := 0;
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
  IF NOT FOUND OR NOT s.projection_enabled OR NOT s.unknown_lead_enabled THEN
    RETURN jsonb_build_object('status', 'disabled');
  END IF;
  -- Один тик на организацию: второй параллельный запуск уходит, не дублируя работу.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('telephony-intake:' || p_organization_id::TEXT, 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_now := clock_timestamp();

  -- 0. Давние звонки решений не получают (включение флага не создаёт лидов за историю).
  UPDATE platform_private.telephony_calls x SET intake_done_at = v_now, intake_outcome = 'skipped_old',
    updated_at = v_now
  WHERE x.organization_id = p_organization_id AND x.direction = 'in' AND x.settled_at IS NOT NULL
    AND x.intake_done_at IS NULL AND x.created_via <> 'backfill'
    AND (x.settled_at < v_now - INTERVAL '2 hours'
      OR (x.created_via = 'reconcile' AND x.started_at < v_now - INTERVAL '2 hours'));
  GET DIAGNOSTICS v_old = ROW_COUNT;

  -- 1. Завершённые входящие звонки без метки, старые вперёд; каждый — в своей точке сохранения.
  FOR r IN SELECT x.id FROM platform_private.telephony_calls x
    WHERE x.organization_id = p_organization_id AND x.direction = 'in' AND x.settled_at IS NOT NULL
      AND x.intake_done_at IS NULL AND x.created_via <> 'backfill'
    ORDER BY x.settled_at, x.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_outcome := platform_private.telephony_intake_decide(p_organization_id, r.id);
      UPDATE platform_private.telephony_calls x SET intake_done_at = clock_timestamp(), intake_outcome = v_outcome,
        updated_at = clock_timestamp()
      WHERE x.organization_id = p_organization_id AND x.id = r.id;
      IF v_outcome = 'lead_created' THEN
        v_created := v_created + 1;
      ELSIF v_outcome = 'lead_attached' THEN
        v_attached := v_attached + 1;
      ELSIF v_outcome = 'client_task_created' THEN
        v_tasks := v_tasks + 1;
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
    'stop_code', v_trip, 'created', v_created, 'attached', v_attached, 'tasks', v_tasks,
    'skipped', v_skipped + v_old, 'failed', v_failed, 'last_error_code', v_error);
END
$$;

-- ---------------------------------------------------------------------------
-- Очередь «Заявок» v3: v2 (250) плюс лиды `phone_call` и вкладка «Звонки».
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_requests_queue_v3(
  p_organization_id UUID,
  p_source TEXT DEFAULT 'all',
  p_status TEXT DEFAULT 'waiting',
  p_limit INTEGER DEFAULT 50,
  p_cursor JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_state TEXT := 'forbidden';
  telephony_ui BOOLEAN := FALSE;
  application_state TEXT := 'forbidden';
  consultation_state TEXT := 'forbidden';
  application_org UUID;
  cursor_at TIMESTAMPTZ;
  cursor_kind TEXT;
  cursor_id UUID;
  backwards BOOLEAN := FALSE;
  result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.platform_role IS NOT DISTINCT FROM 'student'
    OR p_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'requests_queue_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('all','website','whatsapp','phone_call','platform_application','portal_consultation')
    OR p_status IS NULL OR p_status NOT IN ('waiting','all')
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'requests_queue_invalid_filter' USING ERRCODE = '22023';
  END IF;
  IF p_cursor IS NOT NULL THEN
    IF jsonb_typeof(p_cursor) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cursor) k)
      IS DISTINCT FROM ARRAY['direction','id','kind','limit','source','status','timestamp','v']::TEXT[]
      OR p_cursor->'v' IS DISTINCT FROM '3'::JSONB
      OR p_cursor->'limit' IS DISTINCT FROM to_jsonb(p_limit)
      OR p_cursor->'source' IS DISTINCT FROM to_jsonb(p_source)
      OR p_cursor->'status' IS DISTINCT FROM to_jsonb(p_status)
      OR jsonb_typeof(p_cursor->'direction') IS DISTINCT FROM 'string'
      OR p_cursor->>'direction' NOT IN ('next','previous')
      OR jsonb_typeof(p_cursor->'kind') IS DISTINCT FROM 'string'
      OR p_cursor->>'kind' NOT IN ('lead','application','consultation')
      OR jsonb_typeof(p_cursor->'id') IS DISTINCT FROM 'string'
      OR p_cursor->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR jsonb_typeof(p_cursor->'timestamp') IS DISTINCT FROM 'string'
      OR p_cursor->>'timestamp' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END IF;
    BEGIN
      cursor_at := (p_cursor->>'timestamp')::TIMESTAMPTZ;
      cursor_id := (p_cursor->>'id')::UUID;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor' USING ERRCODE = '22023';
    END;
    cursor_kind := p_cursor->>'kind';
    IF p_source<>'all' AND cursor_kind<>(CASE WHEN p_source IN ('website','whatsapp','phone_call') THEN 'lead'
      WHEN p_source='platform_application' THEN 'application' ELSE 'consultation' END) THEN
      RAISE EXCEPTION 'requests_queue_invalid_cursor_kind' USING ERRCODE = '22023';
    END IF;
    backwards := p_cursor->>'direction' = 'previous';
  END IF;

  -- Every kind is evaluated whatever the tab: the tabs carry their counts.
  IF platform_private.staff_has_permission(actor.organization_id,actor.membership_id,'lead.read') THEN
    -- The complete 111 receipt/audit/current-workflow guard, as in v1. The
    -- returned limited row is discarded; 23514 is NOT caught or relabelled.
    PERFORM private.staff_sales_lead_page(1);
    lead_state := 'ready';
    -- Телефония T9: лиды `phone_call` и вкладка «Звонки» входят в чтение, только когда телефония включена
    -- для сотрудников (`ui_enabled`; нет строки настроек = выключено). Слияние кода ничего не открывает.
    telephony_ui := COALESCE((SELECT s.ui_enabled FROM platform_private.telephony_settings s
      WHERE s.organization_id=actor.organization_id), FALSE);
  END IF;
  BEGIN
    application_org := platform_private.student_application_staff_org();
    IF application_org IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'requests_queue_authority_mismatch' USING ERRCODE = '23514';
    END IF;
    application_state := 'ready';
  EXCEPTION WHEN insufficient_privilege THEN
    application_state := 'forbidden';
  END;
  consultation_state := CASE WHEN private.platform_has_permission(actor.organization_id,'lead.read')
    THEN 'ready' ELSE 'forbidden' END;

  -- One STABLE statement snapshot; scope/source/status precede page selection.
  WITH lead_scope AS MATERIALIZED (
    SELECT l.id, l.created_at, l.source_key::TEXT AS source, l.current_owner_membership_id
    FROM platform.leads l
    WHERE lead_state='ready' AND l.organization_id=actor.organization_id
      AND l.lifecycle_state='open'
      AND (l.source_key IN ('website','whatsapp') OR (telephony_ui AND l.source_key='phone_call'))
      AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
  ), handed AS MATERIALIZED (
    SELECT h.lead_id FROM platform_private.sales_lead_handoffs(actor.organization_id,
      ARRAY(SELECT s.id FROM lead_scope s)) h
  ), scoped AS MATERIALIZED (
    SELECT s.created_at AS sort_at, 'lead'::TEXT COLLATE "C" AS kind, s.id, s.source,
      (s.current_owner_membership_id IS NULL AND NOT EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=s.id)) AS waiting
    FROM lead_scope s
    UNION ALL
    SELECT a.submitted_at, 'application', a.id, 'platform_application', a.status='pending'
    FROM platform_private.student_applications a
    WHERE application_state='ready' AND a.organization_id=actor.organization_id
      AND platform_private.student_application_visible(a.organization_id,a.questionnaire)
    UNION ALL
    SELECT r.created_at, 'consultation', r.id, 'portal_consultation', r.status='requested'
    FROM platform_private.portal_consultation_requests r
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    WHERE consultation_state='ready' AND r.organization_id=actor.organization_id
  ), filtered AS MATERIALIZED (
    SELECT * FROM scoped s
    WHERE (p_source='all' OR s.source=p_source) AND (p_status='all' OR s.waiting)
  ), page AS MATERIALIZED (
    SELECT * FROM filtered f
    WHERE cursor_at IS NULL
      OR (NOT backwards AND (f.sort_at,f.kind,f.id)<(cursor_at,cursor_kind COLLATE "C",cursor_id))
      OR (backwards AND (f.sort_at,f.kind,f.id)>(cursor_at,cursor_kind COLLATE "C",cursor_id))
    ORDER BY CASE WHEN backwards THEN f.sort_at END ASC,
      CASE WHEN backwards THEN f.kind END ASC, CASE WHEN backwards THEN f.id END ASC,
      f.sort_at DESC,f.kind DESC,f.id DESC LIMIT p_limit
  ), rendered AS (
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source',l.source_key,
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',COALESCE(c.display_name,c.email,c.phone,'Без имени'),
      'email',c.email,'phone',c.phone,'leadId',l.id,
      'owner',CASE WHEN l.current_owner_membership_id IS NULL THEN NULL
        ELSE jsonb_build_object('membershipId',l.current_owner_membership_id,'name',op.display_name) END,
      'handedOff',EXISTS(SELECT 1 FROM handed h WHERE h.lead_id=l.id),
      -- Exactly the owner checks of platform.mutate_sales_lead_workflow (156).
      'take',CASE WHEN q.waiting
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        AND platform_private.staff_can_access(l.organization_id,actor.membership_id,'lead.sales.owner.assign','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.read','lead',l.id)
        AND platform_private.staff_can_receive_assignment(l.organization_id,actor.membership_id,'lead.sales.workflow.manage','lead',l.id)
        THEN jsonb_build_object('workflowVersion',l.workflow_version::TEXT,'stageKey',l.stage_key,
          'nextActionText',l.next_action_text,'nextActionDueDate',to_char(l.next_action_due_date,'YYYY-MM-DD'))
        END) AS payload
    FROM page q JOIN platform.leads l ON q.kind='lead' AND l.id=q.id AND l.organization_id=actor.organization_id
    LEFT JOIN platform.clients c ON c.organization_id=l.organization_id AND c.id=l.client_id
    LEFT JOIN platform.organization_memberships om ON om.organization_id=l.organization_id AND om.id=l.current_owner_membership_id
    LEFT JOIN platform.profiles op ON op.id=om.profile_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','platform_application',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',concat(a.questionnaire->>'firstName',' ',a.questionnaire->>'lastName'),
      'email',a.normalized_email,'leadId',a.canonical_lead_id,
      'application',platform_private.student_application_json(a.id))
    FROM page q JOIN platform_private.student_applications a ON q.kind='application' AND a.id=q.id AND a.organization_id=actor.organization_id
    UNION ALL
    SELECT q.sort_at,q.kind,q.id,jsonb_build_object('kind',q.kind,'id',q.id,'source','portal_consultation',
      'occurredAt',to_char(q.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'personName',p.display_name,
      'consultation',jsonb_build_object('id',r.id,'status',r.status,'studentName',p.display_name,
        'institutionId',r.institution_id,
        'institutionName',CASE WHEN r.institution_id IS NULL THEN NULL ELSE
          platform_private.portal_consultation_institution_name(r.organization_id,r.institution_id) END,
        'note',r.note,'requestedAt',r.created_at,'handledAt',r.handled_at,'handledByName',hp.display_name))
    FROM page q JOIN platform_private.portal_consultation_requests r ON q.kind='consultation' AND r.id=q.id AND r.organization_id=actor.organization_id
    JOIN platform.organization_memberships m ON m.organization_id=r.organization_id AND m.id=r.membership_id
    JOIN platform.profiles p ON p.id=m.profile_id
    LEFT JOIN platform.organization_memberships hm ON hm.organization_id=r.organization_id AND hm.id=r.handled_by_membership_id
    LEFT JOIN platform.profiles hp ON hp.id=hm.profile_id
  ), bounds AS (
    SELECT 'previous'::TEXT AS direction, first_row.sort_at, first_row.kind, first_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at DESC,kind DESC,id DESC LIMIT 1) first_row
    UNION ALL
    SELECT 'next', last_row.sort_at,last_row.kind,last_row.id
      FROM (SELECT sort_at,kind,id FROM page ORDER BY sort_at,kind,id LIMIT 1) last_row
    UNION ALL
    -- A status/access change may empty a bookmarked page. Retain a route back
    -- to remaining rows without promising a snapshot across separate reads.
    SELECT CASE WHEN backwards THEN 'next' ELSE 'previous' END,cursor_at,cursor_kind,cursor_id
      WHERE cursor_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM page)
  ), cursors AS (
    SELECT b.direction,jsonb_build_object('v',3,'direction',b.direction,
      'source',p_source,'status',p_status,
      'limit',p_limit,'timestamp',to_char(b.sort_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind',b.kind,'id',b.id) AS value
    FROM bounds b WHERE EXISTS(SELECT 1 FROM filtered f WHERE
      (b.direction='next' AND (f.sort_at,f.kind,f.id)<(b.sort_at,b.kind COLLATE "C",b.id)) OR
      (b.direction='previous' AND (f.sort_at,f.kind,f.id)>(b.sort_at,b.kind COLLATE "C",b.id)))
  )
  SELECT jsonb_build_object('version',3,'organizationId',actor.organization_id,
    'phoneCalls',telephony_ui,'source',p_source,'status',p_status,'limit',p_limit,
    'states',jsonb_build_object('lead',lead_state,'application',application_state,'consultation',consultation_state),
    'counts',jsonb_build_object(
      'website',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='website' AND (p_status='all' OR s.waiting)) END,
      'whatsapp',CASE WHEN lead_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.source='whatsapp' AND (p_status='all' OR s.waiting)) END,
      'phone_call',CASE WHEN telephony_ui THEN (SELECT count(*) FROM scoped s
        WHERE s.source='phone_call' AND (p_status='all' OR s.waiting)) END,
      'application',CASE WHEN application_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='application' AND (p_status='all' OR s.waiting)) END,
      'consultation',CASE WHEN consultation_state='ready' THEN (SELECT count(*) FROM scoped s
        WHERE s.kind='consultation' AND (p_status='all' OR s.waiting)) END),
    'latestAt',(SELECT to_char(max(s.sort_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM scoped s WHERE p_source='all' OR s.source=p_source),
    'rows',COALESCE((SELECT jsonb_agg(payload ORDER BY sort_at DESC,kind DESC,id DESC) FROM rendered),'[]'::JSONB),
    'nextCursor',(SELECT value FROM cursors WHERE direction='next'),
    'previousCursor',(SELECT value FROM cursors WHERE direction='previous')) INTO result;
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION platform.staff_requests_queue_v3(UUID,TEXT,TEXT,INTEGER,JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.staff_requests_queue_v3(UUID,TEXT,TEXT,INTEGER,JSONB) TO authenticated;

COMMENT ON FUNCTION platform.staff_requests_queue_v3(UUID,TEXT,TEXT,INTEGER,JSONB) IS
  'Телефония T9: v2 (250) plus phone_call leads and the «Звонки» tab (source phone_call, its count, cursor version 3, phoneCalls). Calls are in the read only while telephony ui_enabled is on.';

-- ---------------------------------------------------------------------------
-- Права: помощники без грантов, публичная функция — только service_role.
-- ---------------------------------------------------------------------------
DO $t300_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_intake\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$t300_private_acl$;

REVOKE ALL ON FUNCTION platform.telephony_intake_tick_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.telephony_intake_tick_v1(UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION platform.telephony_intake_tick_v1(UUID, INTEGER) IS
  'Telephony T9: service-only minute tick of the unknown-number intake (client + phone_call lead, client-without-lead task, ceilings). Closed by projection_enabled and unknown_lead_enabled; one decision per settled inbound call.';

-- Самопроверка: публичные функции — definer, пустой search_path, нужные права; помощники — без
-- прав клиентских ролей и с пустым search_path; v2 остаётся.
DO $t300_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = 'platform.telephony_intake_tick_v1(uuid,integer)'::REGPROCEDURE;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'telephony_t9_tick_function_posture' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = 'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::REGPROCEDURE;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] OR p.provolatile <> 's'
    OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'telephony_t9_queue_function_posture' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.staff_requests_queue_v2(uuid,text,text,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'telephony_t9_queue_v2_removed' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname LIKE 'telephony\_intake\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'telephony_t9_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$t300_verify$;

COMMIT;
