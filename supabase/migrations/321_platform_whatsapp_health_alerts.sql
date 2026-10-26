-- 321 «Тревога о связи WhatsApp продаж» (решение владельца 26.10.2026: WhatsApp возвращается через WAHA, и если связь
-- пропала, об этом должны узнать без захода в «Настройки»; docs/PLAN_CHANGES.md «2026-10-26 · Тревога о связи WhatsApp
-- продаж (миграция 321)», runbook docs/runbooks/whatsapp-go-live.md «Тревога об отключении и тишине»). Номер 321: на
-- origin/main последняя 320; хуки набора привязаны к имени файла, не к номеру.
--
-- Зачем. С перезагрузки сервера 16.10 сессия `crm_primary` была в `FAILED` (просила QR), и никто об этом не узнал: ни
-- таймера, ни тревоги; живая проба статуса работает только пока сотрудник держит открытой страницу «Настройки →
-- WhatsApp». До отключения в будни приходило ~225-340 входящих в день; тишина в рабочее время — тоже сигнал (WAHA/GOWS
-- бывает «молчит, но показывает WORKING», waha #2317). Эта миграция — база данных части «тревога»: состояние для
-- дедупа и автозакрытия и запись тревоги как обычной задачи сотрудникам. Решает и опрашивает WAHA фоновая задача
-- приложения (`/app/whatsapp-health-maintenance.mjs`, таймер на хосте раз в 5 минут), здесь — только хранение и
-- идемпотентная запись.
--
-- Что нового (ничего существующего не заменяется и не удаляется; повторный запуск целой миграции отказывает):
--  a) `platform_private.whatsapp_health_monitor` — ОДНА строка на (организация, сессия): последнее слово статуса, когда
--     его видели, с какого прохода идёт нынешняя серия «работает» / «не работает» и — отдельной отметкой
--     `working_since_at` — с какого момента сессия считается подключённой (отсчёт тишины). Без серии нельзя узнать «не
--     работает уже 10 минут»: запись вебхуков `session.status` приходит только при смене и теряется при перезагрузке.
--     Отметка отсчёта тишины двигается только при настоящем возврате связи (приложение решает, см. `p_working_restart`),
--     а не при каждом сбое измерения (одна медленная проба, пропуск проходов): иначе такой сбой начинал бы отсчёт
--     «молчит» заново и закрывал открытую тревогу «молчит» как «связь вернулась».
--  b) `platform_private.whatsapp_health_alerts` — журнал тревог. Не больше ОДНОЙ открытой тревоги вида
--     (`disconnected` — не работает ≥ 10 минут; `silent` — «работает», но нет входящих ≥ 3 рабочих часов) на сессию:
--     частичный уникальный индекс, поэтому один случай — одна тревога, сколько бы раз ни тикал таймер и даже при
--     гонке двух проходов. Тревога несёт id своих задач и причину закрытия.
--  c) Тревога — задача `platform.staff_tasks` каждому действующему системному администратору, который может получать
--     задачи (плюс «руководитель продаж» — получатель приёма WhatsApp, если приложение его назвало и он может). Как
--     задача телефонии (298): создатель = исполнитель, событие, квитанция, уведомление «назначена», строка журнала от
--     имени system. Кто не может получить задачу, пропускается; если не может НИКТО — вызов отказывает
--     (`whatsapp_health_no_recipient`, 55000) и ничего не записывает: тревога без человека хуже ошибки в журнале таймера,
--     следующий проход повторит. Номера клиента или телефона продаж в тексте нет: слово статуса WAHA и инструкция.
--  d) Закрытие: когда связь вернулась (или пришло сообщение), задачи тревоги закрываются со статусом `done`, событием и
--     строкой журнала system; задачу, которую человек уже закрыл или отменил, не трогаем. Закрытая тревога не мешает
--     следующей: новый случай — новая запись.
--  e) Четыре функции схемы `platform` — ТОЛЬКО для service_role (JWT-роль проверяется в теле): `whatsapp_health_read_v1`
--     (серия с отсчётом тишины, открытые тревоги, последнее входящее клиента по вебхукам `message.any` с
--     `fromMe = false` за 30 суток, часы базы), `whatsapp_health_observe_v1` (запись серии), `whatsapp_health_open_v1`,
--     `whatsapp_health_resolve_v1`.
--     Помощники `platform_private.whatsapp_health_*` без грантов.
-- Решения (пороги 10 минут и 3 рабочих часа, рабочее время пн-сб 10:00-20:00 Asia/Bishkek, тишина считается от
-- последнего входящего или от отсчёта тишины) живут в приложении, `src/lib/platform-whatsapp-health.ts`, и проверяются
-- там; база их не дублирует. Слова статуса, кроме слов WAHA, — `UNREACHABLE` (сервис не отвечает или 5xx), `SESSION_MISSING`
-- (WAHA ответил «такой сессии нет») и `UNAUTHORIZED` (WAHA не принял ключ): для сотрудника это «не работает» с особым
-- текстом; текст этих трёх слов не говорит, что телефон не отвязан, и не обещает закрыться, пока сессия не `WORKING`.
--
-- Порядок выката. Миграция без приложения безвредна: ничто не вызывает новые функции. Приложение без миграции:
-- задача записывает `failed / database` в журнал таймера (exit 1) и ничего не создаёт. Таймер на хосте ставится
-- отдельным шагом владельца (deploy/whatsapp/README.md); пока он не стоит, тревог нет. Откат: `systemctl disable
-- --now evo-whatsapp-health.timer`; открытые тревоги остаются задачами, закрыть их можно руками в «Задачах».
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается миграция; новые имена свободны.
-- ---------------------------------------------------------------------------
DO $a321_anchor$
BEGIN
  IF to_regclass('platform.organizations') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regclass('platform.profiles') IS NULL
    OR to_regclass('platform.staff_tasks') IS NULL
    OR to_regclass('platform.staff_task_events') IS NULL
    OR to_regclass('platform.staff_notifications') IS NULL
    OR to_regclass('platform.audit_events') IS NULL
    OR to_regclass('platform_private.staff_task_receipts') IS NULL
    OR to_regclass('platform_private.provider_webhook_events') IS NULL
    OR to_regprocedure('platform_private.staff_can_receive_assignment(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.p3c_request_child_id(uuid,text)') IS NULL
  THEN
    RAISE EXCEPTION 'a321_anchor_drift: the staff task, notification and webhook objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.whatsapp_health_monitor') IS NOT NULL
    OR to_regclass('platform_private.whatsapp_health_alerts') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_health_read_v1(uuid,text)') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_health_observe_v1(uuid,text,text,boolean,boolean)') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_health_open_v1(uuid,text,text,text,uuid)') IS NOT NULL
    OR to_regprocedure('platform.whatsapp_health_resolve_v1(uuid,text,text,text)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a321_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a321_anchor$;

-- ---------------------------------------------------------------------------
-- a) Серия наблюдений. Закрытая таблица: никому из API-ролей, только определители.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.whatsapp_health_monitor (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  session_name TEXT NOT NULL,
  last_status TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  since_at TIMESTAMPTZ NOT NULL,
  working_since_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT whatsapp_health_monitor_pkey PRIMARY KEY (organization_id, session_name),
  CONSTRAINT whatsapp_health_monitor_session_check CHECK (session_name = 'crm_primary'),
  CONSTRAINT whatsapp_health_monitor_status_check CHECK (last_status ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT whatsapp_health_monitor_order_check CHECK (since_at <= last_seen_at AND working_since_at <= last_seen_at)
);
COMMENT ON TABLE platform_private.whatsapp_health_monitor IS
  '321: the current run of WAHA session observations (status word, last seen, run start, and the silence baseline that moves only on a real reconnect); one row per organization and session.';

-- ---------------------------------------------------------------------------
-- b) Журнал тревог. Одна открытая тревога вида на сессию.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.whatsapp_health_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  session_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  opened_status TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  task_ids UUID[] NOT NULL DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  resolved_reason TEXT,
  CONSTRAINT whatsapp_health_alerts_session_check CHECK (session_name = 'crm_primary'),
  CONSTRAINT whatsapp_health_alerts_kind_check CHECK (kind IN ('disconnected', 'silent')),
  CONSTRAINT whatsapp_health_alerts_status_check CHECK (opened_status ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT whatsapp_health_alerts_resolved_check CHECK (
    (resolved_at IS NULL) = (resolved_reason IS NULL)
    AND (resolved_reason IS NULL OR resolved_reason IN ('working_again', 'messages_arrived', 'reconnected'))
    AND (resolved_at IS NULL OR resolved_at >= opened_at))
);
CREATE UNIQUE INDEX whatsapp_health_alerts_one_open_idx
  ON platform_private.whatsapp_health_alerts (organization_id, session_name, kind) WHERE resolved_at IS NULL;
CREATE INDEX whatsapp_health_alerts_history_idx
  ON platform_private.whatsapp_health_alerts (organization_id, session_name, opened_at DESC);
COMMENT ON TABLE platform_private.whatsapp_health_alerts IS
  '321: ledger of WhatsApp connection alerts; the partial unique index keeps one open alert per kind and session.';

ALTER TABLE platform_private.whatsapp_health_monitor ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.whatsapp_health_monitor FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.whatsapp_health_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.whatsapp_health_alerts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.whatsapp_health_monitor, platform_private.whatsapp_health_alerts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- Общая проверка входа: только service_role, организация существует, сессия одна.
CREATE FUNCTION platform_private.whatsapp_health_guard(p_organization_id UUID, p_session TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_session IS DISTINCT FROM 'crm_primary' THEN
    RAISE EXCEPTION 'whatsapp_health_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'whatsapp_health_unknown_organization' USING ERRCODE = '22023';
  END IF;
END
$$;

-- Может ли сотрудник получить рабочую задачу (как в 276 и 298): действующий, не студент, право читать и закрывать.
CREATE FUNCTION platform_private.whatsapp_health_assignable(p_organization_id UUID, p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p_membership_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = p_membership_id AND m.status = 'active'
        AND p.status = 'active' AND m."current_role" IS DISTINCT FROM 'student')
    AND platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id, 'staff.task.complete', 'staff_task', NULL)
    AND platform_private.staff_can_receive_assignment(p_organization_id, p_membership_id, 'staff.task.read', 'staff_task', NULL)
$$;

-- Заголовок задачи тревоги. Номеров в тексте нет.
CREATE FUNCTION platform_private.whatsapp_health_title(p_kind TEXT, p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind = 'silent' THEN 'WhatsApp молчит 3 часа в рабочее время — проверьте подключение'
    WHEN p_status IN ('UNREACHABLE', 'UNAUTHORIZED', 'SESSION_MISSING')
      THEN 'WhatsApp не на связи — проверьте подключение и сообщите техническому администратору'
    ELSE 'WhatsApp отключён — переподключите'
  END
$$;

-- Описание: что случилось, чем это грозит, что делать, когда задача закроется сама.
CREATE FUNCTION platform_private.whatsapp_health_text(p_kind TEXT, p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind = 'silent' THEN
      'Сессия WhatsApp отдела продаж показывает «работает», но входящих сообщений от клиентов нет уже 3 рабочих часа '
      || '(рабочее время: пн–сб, 10:00–20:00 по Бишкеку). Проверьте подключение: Настройки → Интеграции → Подключение WhatsApp; '
      || 'если там всё в порядке, напишите на номер отдела продаж с другого телефона и убедитесь, что сообщение пришло в CRM. '
      || 'Задача закроется сама, когда придёт сообщение.'
    WHEN p_status IN ('UNREACHABLE', 'UNAUTHORIZED', 'SESSION_MISSING') THEN
      'Когда задача открылась, ' || CASE p_status
        WHEN 'UNREACHABLE' THEN 'сервис WhatsApp (WAHA) не отвечал'
        WHEN 'UNAUTHORIZED' THEN 'сервис WhatsApp (WAHA) не принимал ключ доступа CRM'
        ELSE 'сервис WhatsApp (WAHA) не находил сессию отдела продаж (её нужно создать заново на стороне сервиса)'
      END
      || ' уже больше 10 минут, сообщения клиентов в CRM не приходят. Сообщите техническому администратору. Затем откройте '
      || 'Настройки → Интеграции → Подключение WhatsApp: если там просят отсканировать QR-код или показывают ошибку, '
      || 'переподключите телефон (отвязка на телефоне выглядит так же). Задача закроется сама, когда сессия снова заработает.'
    ELSE
      'Сессия WhatsApp отдела продаж не работает уже больше 10 минут ('
      || CASE p_status
        WHEN 'FAILED' THEN 'сессия остановилась с ошибкой, так бывает после отвязки на телефоне'
        WHEN 'SCAN_QR_CODE' THEN 'нужно заново отсканировать QR-код'
        WHEN 'STOPPED' THEN 'сессия остановлена'
        WHEN 'STARTING' THEN 'сессия не может запуститься'
        WHEN 'PASSKEY_REQUIRED' THEN 'WhatsApp просит подтверждение ключом доступа'
        WHEN 'PASSKEY_CONFIRMATION_REQUIRED' THEN 'WhatsApp просит подтверждение ключом доступа'
        ELSE 'статус сессии: ' || p_status
      END
      || '). Пока она не подключена, сообщения клиентов в CRM не приходят. Переподключите: '
      || 'Настройки → Интеграции → Подключение WhatsApp. Задача закроется сама, когда связь вернётся.'
  END
$$;

-- Задача сотруднику: как telephony_task_create (298) - задача, событие, уведомление, квитанция, журнал system.
-- Запрос идемпотентен по (тревога, сотрудник): id запроса выведен из них.
CREATE FUNCTION platform_private.whatsapp_health_make_task(p_organization_id UUID, p_membership_id UUID,
  p_alert_id UUID, p_kind TEXT, p_status TEXT)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_at TIMESTAMPTZ := clock_timestamp(); v_member RECORD; v_task platform.staff_tasks; v_req UUID;
  v_payload JSONB; v_result JSONB; v_event UUID;
BEGIN
  SELECT m.id, m.profile_id INTO v_member FROM platform.organization_memberships m
  WHERE m.organization_id = p_organization_id AND m.id = p_membership_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'whatsapp_health_assignee_missing' USING ERRCODE = 'P0002';
  END IF;
  v_req := platform_private.p3c_request_child_id(p_alert_id, 'whatsapp-health-task:' || p_membership_id::TEXT);
  INSERT INTO platform.staff_tasks (organization_id, creator_membership_id, assignee_membership_id, title, description,
    status, priority, due_on, created_at, updated_at)
  VALUES (p_organization_id, v_member.id, v_member.id, platform_private.whatsapp_health_title(p_kind, p_status),
    platform_private.whatsapp_health_text(p_kind, p_status), 'open',
    CASE WHEN p_kind = 'silent' THEN 'high'::platform.case_task_priority ELSE 'urgent'::platform.case_task_priority END,
    (v_at AT TIME ZONE 'Asia/Bishkek')::DATE, v_at, v_at)
  RETURNING * INTO v_task;
  v_payload := jsonb_build_object('operation', 'create', 'source', 'whatsapp_health', 'kind', p_kind, 'alert_id', p_alert_id);
  v_result := jsonb_build_object('staff_task_id', v_task.id, 'version', v_task.version::TEXT, 'request_id', v_req,
    'changed_at', v_at);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
    version, before_state, after_state, request_id, created_at)
  VALUES (p_organization_id, v_task.id, v_member.id, v_member.profile_id, 'create', v_task.version, NULL, to_jsonb(v_task),
    v_req, v_at)
  RETURNING id INTO v_event;
  -- Создатель = исполнитель, поэтому триггер уведомлений (142) автора события не уведомит: «назначена» тем же
  -- ключом события, как в 276 и 298.
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
  VALUES (p_organization_id, v_member.id, 'task:' || v_event::TEXT, 'task_assigned', v_task.id)
  ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  INSERT INTO platform_private.staff_task_receipts (request_id, organization_id, actor_membership_id, staff_task_id,
    request_payload, result)
  VALUES (v_req, p_organization_id, v_member.id, v_task.id, v_payload, v_result);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
  VALUES (p_organization_id, 'system', NULL, 'whatsapp-health', 'staff.task.create', 'staff_task', v_task.id, NULL,
    v_result || jsonb_build_object('assigneeMembershipId', v_member.id, 'kind', p_kind, 'alertId', p_alert_id),
    'WhatsApp: автоматическая задача о связи', v_req, v_at);
  RETURN v_task.id;
END
$$;

-- ---------------------------------------------------------------------------
-- e) Функции для фоновой задачи (service_role).
-- ---------------------------------------------------------------------------

-- Что нужно для решения: серия, открытые тревоги, последнее входящее клиента, часы базы.
-- Входящее клиента - вебхук `message.any` от сессии с `fromMe = false` (проверенная подпись) за 30 суток.
CREATE FUNCTION platform.whatsapp_health_read_v1(p_organization_id UUID, p_session TEXT DEFAULT 'crm_primary')
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp(); m platform_private.whatsapp_health_monitor%ROWTYPE;
  v_disconnected platform_private.whatsapp_health_alerts%ROWTYPE; v_silent platform_private.whatsapp_health_alerts%ROWTYPE;
  v_last TIMESTAMPTZ; v_has_monitor BOOLEAN; v_has_disconnected BOOLEAN; v_has_silent BOOLEAN;
BEGIN
  PERFORM platform_private.whatsapp_health_guard(p_organization_id, p_session);
  SELECT * INTO m FROM platform_private.whatsapp_health_monitor x
  WHERE x.organization_id = p_organization_id AND x.session_name = p_session;
  v_has_monitor := FOUND;
  SELECT * INTO v_disconnected FROM platform_private.whatsapp_health_alerts a
  WHERE a.organization_id = p_organization_id AND a.session_name = p_session AND a.kind = 'disconnected'
    AND a.resolved_at IS NULL;
  v_has_disconnected := FOUND;
  SELECT * INTO v_silent FROM platform_private.whatsapp_health_alerts a
  WHERE a.organization_id = p_organization_id AND a.session_name = p_session AND a.kind = 'silent'
    AND a.resolved_at IS NULL;
  v_has_silent := FOUND;
  SELECT max(e.received_at) INTO v_last FROM platform_private.provider_webhook_events e
  WHERE e.organization_id = p_organization_id AND e.provider = 'waha' AND e.waha_session_name = p_session
    AND e.event_type = 'message.any' AND e.verification_status = 'verified'
    AND e.received_at >= v_now - INTERVAL '30 days'
    AND e.raw_payload #>> '{payload,fromMe}' = 'false';
  RETURN jsonb_build_object(
    'now', v_now,
    'monitor', CASE WHEN v_has_monitor THEN jsonb_build_object('lastStatus', m.last_status,
      'lastSeenAt', m.last_seen_at, 'sinceAt', m.since_at, 'workingSinceAt', m.working_since_at) END,
    'disconnected', CASE WHEN v_has_disconnected THEN jsonb_build_object('id', v_disconnected.id,
      'openedAt', v_disconnected.opened_at) END,
    'silent', CASE WHEN v_has_silent THEN jsonb_build_object('id', v_silent.id, 'openedAt', v_silent.opened_at) END,
    'lastInboundAt', v_last);
END
$$;

-- Запись серии: слово статуса и время прохода - по часам базы; `p_restart` начинает серию заново, `p_working_restart`
-- двигает отсчёт тишины на «сейчас» (приложение просит об этом только при настоящем возврате связи; первая строка
-- серии всегда начинает отсчёт).
CREATE FUNCTION platform.whatsapp_health_observe_v1(p_organization_id UUID, p_session TEXT, p_status TEXT,
  p_restart BOOLEAN, p_working_restart BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); v_since TIMESTAMPTZ; v_working_since TIMESTAMPTZ;
BEGIN
  PERFORM platform_private.whatsapp_health_guard(p_organization_id, p_session);
  IF p_status IS NULL OR p_status !~ '^[A-Z][A-Z0-9_]{0,63}$' OR p_restart IS NULL OR p_working_restart IS NULL THEN
    RAISE EXCEPTION 'whatsapp_health_invalid_request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform_private.whatsapp_health_monitor AS x (organization_id, session_name, last_status, last_seen_at,
    since_at, working_since_at)
  VALUES (p_organization_id, p_session, p_status, v_now, v_now, v_now)
  ON CONFLICT (organization_id, session_name) DO UPDATE SET
    last_status = EXCLUDED.last_status, last_seen_at = EXCLUDED.last_seen_at,
    since_at = CASE WHEN p_restart THEN EXCLUDED.since_at ELSE x.since_at END,
    working_since_at = CASE WHEN p_working_restart THEN EXCLUDED.working_since_at ELSE x.working_since_at END
  RETURNING since_at, working_since_at INTO v_since, v_working_since;
  RETURN jsonb_build_object('sinceAt', v_since, 'lastSeenAt', v_now, 'workingSinceAt', v_working_since);
END
$$;

-- Открыть тревогу вида: не больше одной открытой; задачи действующим системным администраторам и, если назван и
-- может, руководителю продаж (`p_extra_recipient`). Никого - отказ, ничего не записано.
CREATE FUNCTION platform.whatsapp_health_open_v1(p_organization_id UUID, p_session TEXT, p_kind TEXT, p_status TEXT,
  p_extra_recipient UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_alert UUID; v_tasks UUID[] := '{}'; r RECORD;
BEGIN
  PERFORM platform_private.whatsapp_health_guard(p_organization_id, p_session);
  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent')
    OR p_status IS NULL OR p_status !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'whatsapp_health_invalid_request' USING ERRCODE = '22023';
  END IF;
  -- Второй параллельный проход ждёт первого и затем видит открытую тревогу.
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-health:' || p_organization_id::TEXT || ':' || p_kind, 0));
  IF EXISTS (SELECT 1 FROM platform_private.whatsapp_health_alerts a
    WHERE a.organization_id = p_organization_id AND a.session_name = p_session AND a.kind = p_kind
      AND a.resolved_at IS NULL) THEN
    RETURN jsonb_build_object('opened', FALSE, 'reason', 'already_open');
  END IF;
  INSERT INTO platform_private.whatsapp_health_alerts (organization_id, session_name, kind, opened_status)
  VALUES (p_organization_id, p_session, p_kind, p_status)
  RETURNING id INTO v_alert;
  FOR r IN SELECT m.id FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
      AND (m.is_system_admin OR m.id = p_extra_recipient)
      AND platform_private.whatsapp_health_assignable(p_organization_id, m.id)
    ORDER BY m.created_at, m.id LOOP
    v_tasks := v_tasks || platform_private.whatsapp_health_make_task(p_organization_id, r.id, v_alert, p_kind, p_status);
  END LOOP;
  IF cardinality(v_tasks) = 0 THEN
    RAISE EXCEPTION 'whatsapp_health_no_recipient' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.whatsapp_health_alerts a SET task_ids = v_tasks WHERE a.id = v_alert;
  RETURN jsonb_build_object('opened', TRUE, 'alertId', v_alert, 'tasks', cardinality(v_tasks));
END
$$;

-- Закрыть открытую тревогу вида: открытые задачи - `done` (событие и журнал system), задачу, которую человек уже
-- закрыл или отменил, не трогаем. Нет открытой тревоги - `resolved: false`.
CREATE FUNCTION platform.whatsapp_health_resolve_v1(p_organization_id UUID, p_session TEXT, p_kind TEXT, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_alert platform_private.whatsapp_health_alerts%ROWTYPE; v_old platform.staff_tasks; v_new platform.staff_tasks;
  v_at TIMESTAMPTZ := clock_timestamp(); v_profile UUID; v_req UUID; v_closed INTEGER := 0;
BEGIN
  PERFORM platform_private.whatsapp_health_guard(p_organization_id, p_session);
  IF p_kind IS NULL OR p_kind NOT IN ('disconnected', 'silent')
    OR p_reason IS NULL OR p_reason NOT IN ('working_again', 'messages_arrived', 'reconnected') THEN
    RAISE EXCEPTION 'whatsapp_health_invalid_request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp-health:' || p_organization_id::TEXT || ':' || p_kind, 0));
  SELECT * INTO v_alert FROM platform_private.whatsapp_health_alerts a
  WHERE a.organization_id = p_organization_id AND a.session_name = p_session AND a.kind = p_kind
    AND a.resolved_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resolved', FALSE, 'tasksClosed', 0);
  END IF;
  FOR v_old IN SELECT t.* FROM platform.staff_tasks t
    WHERE t.organization_id = p_organization_id AND t.id = ANY (v_alert.task_ids)
    ORDER BY t.created_at, t.id FOR UPDATE LOOP
    IF v_old.status IN ('done', 'cancelled') THEN
      CONTINUE;
    END IF;
    UPDATE platform.staff_tasks t SET status = 'done'::platform.case_task_status, version = t.version + 1, updated_at = v_at
    WHERE t.id = v_old.id RETURNING * INTO v_new;
    SELECT m.profile_id INTO v_profile FROM platform.organization_memberships m
    WHERE m.organization_id = p_organization_id AND m.id = v_new.assignee_membership_id;
    v_req := platform_private.p3c_request_child_id(v_new.id, 'whatsapp-health-close:' || v_new.version::TEXT);
    INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
      version, before_state, after_state, request_id, created_at)
    VALUES (p_organization_id, v_new.id, v_new.assignee_membership_id, v_profile, 'status', v_new.version,
      to_jsonb(v_old), to_jsonb(v_new), v_req, v_at);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
      resource_type, resource_id, before_state, after_state, reason, request_id, created_at)
    VALUES (p_organization_id, 'system', NULL, 'whatsapp-health', 'staff.task.status', 'staff_task', v_new.id, NULL,
      jsonb_build_object('staff_task_id', v_new.id, 'version', v_new.version::TEXT, 'status', v_new.status,
        'reason', p_reason, 'kind', p_kind, 'alertId', v_alert.id),
      'WhatsApp: задача закрыта автоматически', v_req, v_at);
    v_closed := v_closed + 1;
  END LOOP;
  UPDATE platform_private.whatsapp_health_alerts a SET resolved_at = v_at, resolved_reason = p_reason WHERE a.id = v_alert.id;
  RETURN jsonb_build_object('resolved', TRUE, 'tasksClosed', v_closed, 'alertId', v_alert.id);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: помощники без грантов, функции схемы platform - только service_role.
-- ---------------------------------------------------------------------------
DO $wh321_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'whatsapp\_health\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'whatsapp\_health\_%\_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$wh321_private_acl$;

COMMENT ON FUNCTION platform.whatsapp_health_read_v1(UUID, TEXT) IS
  '321: service-only read for the WhatsApp health job: run of observations with the silence baseline, open alerts, last customer inbound webhook, database clock.';
COMMENT ON FUNCTION platform.whatsapp_health_observe_v1(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) IS
  '321: service-only write of one observation of the WAHA session status; p_restart starts a new run, p_working_restart moves the silence baseline to now.';
COMMENT ON FUNCTION platform.whatsapp_health_open_v1(UUID, TEXT, TEXT, TEXT, UUID) IS
  '321: service-only; opens at most one alert per kind and session and gives a staff task to every active system admin who can receive tasks (plus the optional sales head).';
COMMENT ON FUNCTION platform.whatsapp_health_resolve_v1(UUID, TEXT, TEXT, TEXT) IS
  '321: service-only; resolves the open alert of the kind and closes its still-open tasks.';

-- Самопроверка: функции схемы platform - definer, пустой search_path, EXECUTE только у service_role;
-- помощники - без прав клиентских ролей и с пустым search_path; обе таблицы закрыты RLS.
DO $wh321_verify$
DECLARE f REGPROCEDURE; p pg_catalog.pg_proc%ROWTYPE; t REGCLASS;
BEGIN
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform' AND x.proname LIKE 'whatsapp\_health\_%\_v1' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'whatsapp_health_321_public_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT x.oid::REGPROCEDURE FROM pg_catalog.pg_proc x
    JOIN pg_catalog.pg_namespace n ON n.oid = x.pronamespace
    WHERE n.nspname = 'platform_private' AND x.proname LIKE 'whatsapp\_health\_%' LOOP
    SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
    IF p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'whatsapp_health_321_private_function_posture: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['platform_private.whatsapp_health_monitor'::REGCLASS, 'platform_private.whatsapp_health_alerts'::REGCLASS] LOOP
    IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = t)
      OR has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', t, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('service_role', t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'whatsapp_health_321_table_posture: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$wh321_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
