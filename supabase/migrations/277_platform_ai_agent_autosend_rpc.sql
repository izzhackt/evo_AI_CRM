-- 277_platform_ai_agent_autosend_rpc — «ИИ-агент» P4: функции автоответчика
-- для агента и для сотрудников. Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md
-- §5.3–5.5, §11, §12.2, §13 (Q9: всё может каждый сотрудник с правом; Q12:
-- согласие на Gemini — только admin), §15 P4; docs/PLAN_CHANGES.md (07.10, P4).
--
-- Агент (platform_ai_agent, только evo_ai_agent; организация — из строки):
--  * autosend_due_v1 — 1..200 указателей {conversationId, messageId}: ворота
--    организации (включён, согласие, не на паузе, сейчас внутри интервала;
--    иначе 42501 ai_autosend_disabled), строка considering (одна на
--    сообщение), дешёвые проверки (правила 1–3, финальная фраза в интервале)
--    → skipped, иначе указатель {kind:'autosend', ref_id}. Только ID;
--  * autosend_context_v1 — аренда и полная перепроверка; decide — 20 сообщений
--    с происхождением, карточка лида, память (если включена), правила,
--    модели, финальные фразы на сегодня, строка-раскрытие, шаблоны стоп-слов,
--    режим и остаток лимитов; scheduled в срок — send; иначе skip/none;
--  * autosend_search_v1 — поиск только по клиентским документам с
--    autosend_allowed, ready, не заменённым (без внутренней ветки и эталонов);
--    расширяет offered_chunk_ids;
--  * autosend_commit_v1 — колонка «commit» таблицы §11; финальная фраза равна
--    вычисленной (код агента, почему она сказана, — в final_reason_code);
--    строка-раскрытие в начале первого ответа чата в интервале;
--    живой режим с неподтверждённым языком — phrase_unconfirmed; задержка
--    30–90 с; live → scheduled + отложенный указатель, shadow → shadow;
--    три skip gemini_error подряд — пауза;
--  * autosend_pause_v1 — пауза от агента (gemini_error, gemini_billing,
--    server_switch_off); снять паузу агент не может;
--  * autosend_summary_due_v1 / _context_v1 / _put_v1 — утренняя сводка по
--    закончившимся интервалам и задачи «Позвонить клиенту» (живые финальные
--    фразы authorized, sent или unknown — они могли дойти; один раз),
--    квалификация по чатам;
--  * inbound_since_v1 (та же сигнатура): ворота — память ИЛИ автоответчик,
--    в ответе orgs [{organizationId, memory, autosend}];
--  * maintenance_v1: + авторизованные, но не взятые claim 2 минуты → работа
--    снята с очереди, cancelled; отменённые, чья работа осталась в очереди, —
--    работа снимается снова; авторизованные без итога, чья работа
--    завершилась или чья аренда истекла больше 10 минут назад, — итог по
--    состоянию работы (sent / failed / unknown), без повторной отправки,
--    в серии ошибок как итог record (третья ошибка подряд — пауза
--    send_errors);
--    просроченные scheduled (send_at + 10 мин) → cancelled, брошенные
--    considering → skipped, строки журнала без ссылок и сводки старше 180
--    дней удаляются.
-- Сотрудники (platform, authenticated, ai_staff_actor, повтор по request_id,
-- аудит до/после): ai_agent_autosend_v1, _save_v1, _enable_v1, _shadow_v1,
-- _pause_v1, _exclusion_v1, _conversation_v1, _log_v1, _summary_v1.
-- Выключение, пауза, исключение чата, возврат в shadow и уборка снимают и
-- авторизованные, но ещё не взятые claim автоответы (276,
-- ai_autosend_cancel_pending); список живого теста — только после трёх ночей
-- проверки (275, ai_autosend_mode).
--
-- Всё поставляется выключенным; ни одна функция этой миграции не отправляет
-- сообщение и не вызывает провайдера. Повторный запуск в той же точке
-- цепочки ничего не меняет; устаревший повтор 274 после 277 отклоняется его
-- инвентарём функций.
BEGIN;

-- Загружает библиотеку pgvector в этой сессии: без неё атрибут функции
-- `SET hnsw.*` создаётся как placeholder, а его владелец не superuser (269).
SELECT '[0]'::public.halfvec IS NOT NULL AS ai277_vector_loaded;

DO $ai277_preconditions$
BEGIN
  IF to_regprocedure('platform.ai_autosend_authorize_v1(uuid,uuid,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_autosend_check(platform_private.ai_autosend_log,text,text,bigint[])') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_p4_requires_276' USING ERRCODE = '55000';
  END IF;
END
$ai277_preconditions$;

-- ===========================================================================
-- Помощники (platform_private, без грантов).
-- ===========================================================================

-- Ворота организации для фоновых функций автоответчика: организация
-- активна, автоответчик включён (shadow или живой), согласие на Gemini
-- записано, не на паузе, сейчас внутри интервала.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_gate(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT s.enabled AND s.pause_code IS NULL AND a.gemini_consent_at IS NOT NULL
      AND (platform_private.ai_autosend_window(s, clock_timestamp()) ->> 'inside')::BOOLEAN
    FROM platform_private.ai_autosend_settings s
    JOIN platform_private.ai_settings a ON a.organization_id = s.organization_id
    JOIN platform.organizations o ON o.id = s.organization_id
    WHERE s.organization_id = p_organization_id AND o.status = 'active'), FALSE)
$$;

-- Первое учтённое решение чата в интервале (строка-раскрытие, §18 Q11).
-- Для живого решения (live, live_test) считаются только живые: строки shadow
-- клиент не видел, и после перехода shadow → живой режим (или добавления
-- чата в список живого теста) первый настоящий автоответ начинается со
-- строки-раскрытия. Для shadow-решения — все, как если бы они ушли.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_first_in_interval(p_log platform_private.ai_autosend_log)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log l
    WHERE l.organization_id = p_log.organization_id AND l.conversation_id = p_log.conversation_id
      AND l.interval_start = p_log.interval_start AND l.id <> p_log.id
      AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow')
      AND (p_log.mode = 'shadow' OR l.mode IN ('live', 'live_test')))
$$;

-- Квалификация, собранная в чате за интервал (последнее значение по полю).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_qualification(p_organization_id UUID, p_conversation_id UUID,
  p_interval_start TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(x.key, x.value), '{}'::JSONB)
  FROM (SELECT DISTINCT ON (q.key) q.key, q.value
    FROM platform_private.ai_autosend_log l CROSS JOIN LATERAL jsonb_each(l.qualification) q
    WHERE l.organization_id = p_organization_id AND l.conversation_id = p_conversation_id
      AND l.interval_start = p_interval_start AND l.qualification IS NOT NULL
    ORDER BY q.key, l.created_at DESC, l.id DESC) x
$$;

-- Сообщение для модели (ai_message_view, 274) с происхождением: client,
-- crm, autoreply, phone, history, other — как в транскрипте (276).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_message_view(p_message platform.communication_messages)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.ai_message_view(p_message) || jsonb_build_object('origin', CASE
    WHEN p_message.message_identity_source = 'private_waha_history_binding' THEN 'history'
    WHEN p_message.direction = 'inbound' THEN 'client'
    WHEN p_message.message_identity_source = 'private_manual_send_binding' AND EXISTS (SELECT 1
      FROM platform.manual_send_authorizations a WHERE a.organization_id = p_message.organization_id
        AND a.id = p_message.manual_send_authorization_id AND a.kind = 'ai_autosend') THEN 'autoreply'
    WHEN p_message.message_identity_source = 'private_manual_send_binding' THEN 'crm'
    WHEN p_message.message_identity_source = 'private_waha_phone_binding' THEN 'phone'
    ELSE 'other' END)
$$;

-- Строка журнала для сотрудника; текст — только если он читает диалог.
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_log_json(p_log platform_private.ai_autosend_log,
  p_with_text BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_log.id, 'conversationId', p_log.conversation_id,
    'clientMessageId', p_log.client_message_id, 'sourceAt', p_log.source_at,
    'intervalStart', p_log.interval_start, 'intervalEnd', p_log.interval_end, 'status', p_log.status,
    'mode', p_log.mode, 'kind', p_log.kind, 'reasonCode', p_log.reason_code, 'reasonRu', p_log.reason_ru,
    'finalReasonCode', p_log.final_reason_code, 'language', p_log.language, 'citedChunkIds', to_jsonb(p_log.cited_chunk_ids), 'callDate', p_log.call_date,
    'sendAt', p_log.send_at, 'delaySeconds', p_log.delay_s, 'outcomeCode', p_log.outcome_code,
    'createdAt', p_log.created_at, 'committedAt', p_log.committed_at, 'authorizedAt', p_log.authorized_at,
    'finishedAt', p_log.finished_at, 'textHidden', NOT p_with_text,
    'text', CASE WHEN p_with_text THEN COALESCE(p_log.text, p_log.body) END,
    'qualification', CASE WHEN p_with_text THEN p_log.qualification END)
$$;

-- Настройки для сотрудника (без текстов клиентов).
CREATE OR REPLACE FUNCTION platform_private.ai_autosend_settings_json(p_settings platform_private.ai_autosend_settings)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('schedule', p_settings.schedule, 'dateOverrides', p_settings.date_overrides,
    'workingDays', to_jsonb(p_settings.working_days), 'timezone', p_settings.timezone,
    'delayMinSeconds', p_settings.delay_min_s, 'delayMaxSeconds', p_settings.delay_max_s,
    'limitChatHour', p_settings.limit_chat_hour, 'limitChatNight', p_settings.limit_chat_night,
    'limitNumberHour', p_settings.limit_number_hour, 'phrases', p_settings.phrases,
    'disclosureEnabled', p_settings.disclosure_enabled, 'disclosure', p_settings.disclosure,
    'liveTestConversationIds', to_jsonb(p_settings.live_test_conversation_ids))
$$;

DO $ai277_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'ai\_autosend\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai277_private_acl$;

-- ===========================================================================
-- Агент (platform_ai_agent, evo_ai_agent).
-- ===========================================================================

-- Указатели входящих (274, та же сигнатура): ворота — память ИЛИ
-- автоответчик (ai_autosend_gate). orgs — какие ворота у организации
-- открыты; поллер направляет указатели в memory_due_v1 и/или
-- autosend_due_v1. Текста нет.
CREATE OR REPLACE FUNCTION platform_ai_agent.inbound_since_v1(p_after_at TIMESTAMPTZ, p_after_id UUID,
  p_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_after_at TIMESTAMPTZ; v_after_id UUID; v_orgs UUID[]; v_gates JSONB; v_items JSONB; v_count INTEGER;
  v_now TIMESTAMPTZ; v_horizon TIMESTAMPTZ; v_next_at TIMESTAMPTZ; v_next_id UUID;
  v_max_id CONSTANT UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR ((p_after_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION 'ai_inbound_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(g.organization_id ORDER BY g.organization_id),
    jsonb_agg(jsonb_build_object('organizationId', g.organization_id, 'memory', g.memory, 'autosend', g.autosend)
      ORDER BY g.organization_id)
  INTO v_orgs, v_gates
  FROM (SELECT s.organization_id, platform_private.ai_memory_gate(s.organization_id) AS memory,
      platform_private.ai_autosend_gate(s.organization_id) AS autosend
    FROM platform_private.ai_settings s) g
  WHERE g.memory OR g.autosend;
  IF v_orgs IS NULL THEN
    RAISE EXCEPTION 'ai_background_disabled' USING ERRCODE = '42501';
  END IF;
  v_now := clock_timestamp();
  v_horizon := v_now - INTERVAL '5 minutes';
  v_after_at := COALESCE(p_after_at, v_horizon);
  v_after_id := COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::UUID);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('organizationId', x.organization_id,
      'conversationId', x.conversation_id, 'messageId', x.id, 'at', x.created_at) ORDER BY x.created_at, x.id),
      '[]'::JSONB), count(*)::INTEGER
  INTO v_items, v_count
  FROM (SELECT hit.organization_id, hit.conversation_id, hit.id, hit.created_at
    FROM platform.communication_conversations c
    CROSS JOIN LATERAL (SELECT m.organization_id, m.conversation_id, m.id, m.created_at
      FROM platform.communication_messages m
      WHERE m.organization_id = c.organization_id AND m.conversation_id = c.id AND m.direction = 'inbound'
        AND (m.created_at, m.id) > (v_after_at, v_after_id)
      ORDER BY m.created_at, m.id LIMIT p_limit) hit
    WHERE c.organization_id = ANY (v_orgs) AND c.queue = 'sales'
    ORDER BY hit.created_at, hit.id LIMIT p_limit) x;
  IF v_count > 0 THEN
    v_next_at := (v_items -> -1 ->> 'at')::TIMESTAMPTZ;
    v_next_id := (v_items -> -1 ->> 'messageId')::UUID;
  ELSE
    v_next_at := v_after_at;
    v_next_id := v_after_id;
  END IF;
  IF v_count < p_limit AND (v_next_at, v_next_id) > (v_horizon, v_max_id) THEN
    v_next_at := v_horizon;
    v_next_id := v_max_id;
  END IF;
  RETURN jsonb_build_object('items', v_items, 'hasMore', v_count = p_limit,
    'next', jsonb_build_object('afterAt', v_next_at, 'afterId', v_next_id), 'now', v_now, 'orgs', v_gates);
END
$$;

-- Рассмотреть входящие (1..200 {conversationId, messageId}). Любая
-- организация вызова с закрытыми воротами — 42501 ai_autosend_disabled для
-- всего вызова. Неизвестное сообщение — unknown; чат не продаж или не
-- входящее — refused (строки нет). Иначе одна строка considering на
-- сообщение (повтор отдаёт её же); дешёвые проверки — skipped с причиной;
-- прошедшие — указатель {v:1, kind:'autosend', ref_id}. Только ID и коды.
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_due_v1(p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item RECORD; v_items JSONB := '[]'::JSONB; v_msg platform.communication_messages;
  v_conv platform.communication_conversations; v_row platform_private.ai_autosend_log;
  v_settings platform_private.ai_autosend_settings; v_window JSONB; v_reason TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 200
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
      WHERE jsonb_typeof(e) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['conversationId', 'messageId']
        OR jsonb_typeof(e -> 'conversationId') <> 'string' OR jsonb_typeof(e -> 'messageId') <> 'string'
        OR (e ->> 'conversationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (e ->> 'messageId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR jsonb_array_length(p_items) <> (SELECT count(DISTINCT e ->> 'messageId') FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'ai_autosend_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
    JOIN platform.communication_messages m ON m.id = (e ->> 'messageId')::UUID
      AND m.conversation_id = (e ->> 'conversationId')::UUID
    WHERE NOT platform_private.ai_autosend_gate(m.organization_id)) THEN
    RAISE EXCEPTION 'ai_autosend_disabled' USING ERRCODE = '42501';
  END IF;
  -- По возрастанию ID чата: два поллера берут блокировки в одном порядке.
  FOR v_item IN SELECT (e ->> 'conversationId')::UUID AS conversation_id, (e ->> 'messageId')::UUID AS message_id
    FROM jsonb_array_elements(p_items) e ORDER BY 1, 2 LOOP
    SELECT * INTO v_msg FROM platform.communication_messages m
    WHERE m.id = v_item.message_id AND m.conversation_id = v_item.conversation_id;
    IF NOT FOUND THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('conversationId', v_item.conversation_id,
        'messageId', v_item.message_id, 'status', 'unknown'));
      CONTINUE;
    END IF;
    SELECT * INTO v_conv FROM platform.communication_conversations c
    WHERE c.organization_id = v_msg.organization_id AND c.id = v_msg.conversation_id;
    IF v_conv.queue <> 'sales' OR v_msg.direction <> 'inbound' THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('conversationId', v_item.conversation_id,
        'messageId', v_item.message_id, 'status', 'refused',
        'reasonCode', CASE WHEN v_conv.queue <> 'sales' THEN 'not_sales' ELSE 'not_inbound' END));
      CONTINUE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend:' || v_conv.id::TEXT, 275));
    SELECT * INTO v_row FROM platform_private.ai_autosend_log l
    WHERE l.organization_id = v_msg.organization_id AND l.client_message_id = v_msg.id;
    IF NOT FOUND THEN
      v_settings := platform_private.ai_autosend_settings_row(v_msg.organization_id);
      v_window := platform_private.ai_autosend_window(v_settings, clock_timestamp());
      -- Интервал мог закончиться после проверки ворот в начале вызова.
      IF NOT (v_window ->> 'inside')::BOOLEAN THEN
        v_items := v_items || jsonb_build_array(jsonb_build_object('conversationId', v_item.conversation_id,
          'messageId', v_item.message_id, 'status', 'refused', 'reasonCode', 'outside_interval'));
        CONTINUE;
      END IF;
      INSERT INTO platform_private.ai_autosend_log AS l (organization_id, conversation_id, client_message_id, source_at,
        interval_start, interval_end, mode)
      VALUES (v_msg.organization_id, v_conv.id, v_msg.id, v_msg.created_at,
        (v_window ->> 'intervalStart')::TIMESTAMPTZ, (v_window ->> 'intervalEnd')::TIMESTAMPTZ,
        platform_private.ai_autosend_mode(v_settings, v_conv.id))
      RETURNING * INTO v_row;
      v_reason := platform_private.ai_autosend_check(v_row, 'due', NULL, NULL);
      IF v_reason IS NOT NULL THEN
        v_row := platform_private.ai_autosend_skip(v_row.id, v_reason);
      ELSE
        PERFORM platform_private.ai_enqueue('autosend', v_row.id);
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object('conversationId', v_row.conversation_id,
        'messageId', v_row.client_message_id, 'decisionId', v_row.id, 'status', v_row.status,
        'reasonCode', v_row.reason_code, 'enqueued', v_reason IS NULL));
    ELSE
      v_items := v_items || jsonb_build_array(jsonb_build_object('conversationId', v_row.conversation_id,
        'messageId', v_row.client_message_id, 'decisionId', v_row.id, 'status', v_row.status,
        'reasonCode', v_row.reason_code, 'enqueued', FALSE, 'existing', TRUE));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('items', v_items);
END
$$;

-- Работа по указателю autosend. scheduled: в срок — send (агент вызывает
-- CRM), раньше — none. considering: аренда (busy — если держит другой) и
-- полная перепроверка (ворота и этап due); не прошло — skip (строка skipped);
-- прошло — decide с контекстом. Иначе — none.
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_context_v1(p_decision_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conversation UUID; v_row platform_private.ai_autosend_log; v_reason TEXT;
  v_settings platform_private.ai_autosend_settings; v_ai platform_private.ai_settings;
  v_rules platform_private.ai_rules_versions; v_memory platform_private.ai_client_memory; v_messages JSONB;
  v_usage JSONB; v_now TIMESTAMPTZ := clock_timestamp(); v_phrases JSONB;
BEGIN
  IF p_decision_id IS NULL OR p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_autosend_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT l.conversation_id INTO v_conversation FROM platform_private.ai_autosend_log l WHERE l.id = p_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_autosend_decision_unknown' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend:' || v_conversation::TEXT, 275));
  SELECT * INTO v_row FROM platform_private.ai_autosend_log l WHERE l.id = p_decision_id FOR UPDATE;
  IF v_row.status = 'scheduled' THEN
    RETURN jsonb_build_object('action', CASE WHEN v_row.send_at <= v_now THEN 'send' ELSE 'none' END,
      'decisionId', v_row.id, 'organizationId', v_row.organization_id, 'conversationId', v_row.conversation_id,
      'status', v_row.status, 'sendAt', v_row.send_at);
  END IF;
  IF v_row.status <> 'considering' THEN
    RETURN jsonb_build_object('action', 'none', 'decisionId', v_row.id, 'status', v_row.status);
  END IF;
  IF v_row.lease_owner IS DISTINCT FROM btrim(p_worker_ref) AND v_row.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('action', 'busy', 'decisionId', v_row.id, 'leaseExpiresAt', v_row.lease_expires_at);
  END IF;
  v_reason := platform_private.ai_autosend_check(v_row, 'due', NULL, NULL);
  IF v_reason IS NOT NULL THEN
    v_row := platform_private.ai_autosend_skip(v_row.id, v_reason);
    RETURN jsonb_build_object('action', 'skip', 'decisionId', v_row.id, 'status', v_row.status,
      'reasonCode', v_row.reason_code);
  END IF;
  v_settings := platform_private.ai_autosend_settings_row(v_row.organization_id);
  UPDATE platform_private.ai_autosend_log l SET lease_owner = btrim(p_worker_ref),
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    mode = platform_private.ai_autosend_mode(v_settings, l.conversation_id), updated_at = v_now
  WHERE l.id = v_row.id RETURNING * INTO v_row;
  v_ai := platform_private.ai_settings_row(v_row.organization_id);
  SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = v_row.organization_id AND r.id = v_ai.rules_version_id;
  SELECT COALESCE(jsonb_agg(platform_private.ai_autosend_message_view(x.msg) ORDER BY (x.msg).created_at, (x.msg).id),
    '[]'::JSONB)
  INTO v_messages
  FROM (SELECT d AS msg FROM platform_private.ai_dialog_messages(v_row.organization_id, v_row.conversation_id) d
    ORDER BY d.created_at DESC, d.id DESC LIMIT 20) x;
  IF platform_private.ai_memory_gate(v_row.organization_id) THEN
    SELECT * INTO v_memory FROM platform_private.ai_client_memory m
    WHERE m.organization_id = v_row.organization_id AND m.conversation_id = v_row.conversation_id;
  END IF;
  v_usage := platform_private.ai_autosend_usage(v_row, v_now);
  SELECT jsonb_object_agg(l.lang, platform_private.ai_autosend_final_phrase(v_settings, l.lang, v_now))
  INTO v_phrases FROM unnest(ARRAY['ru', 'ky', 'en']) l(lang);
  RETURN jsonb_build_object('action', 'decide', 'decisionId', v_row.id, 'organizationId', v_row.organization_id,
    'conversationId', v_row.conversation_id, 'clientMessageId', v_row.client_message_id,
    'intervalStart', v_row.interval_start, 'intervalEnd', v_row.interval_end, 'mode', v_row.mode,
    'leaseExpiresAt', v_row.lease_expires_at, 'messages', v_messages,
    'lead', platform_private.ai_lead_card(v_row.organization_id, v_row.conversation_id),
    'memory', CASE WHEN v_memory.interest IS NOT NULL OR v_memory.summary IS NOT NULL THEN
      jsonb_build_object('interest', v_memory.interest, 'summary', v_memory.summary) END,
    'rules', CASE WHEN v_rules.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_rules.id,
      'version', v_rules.version, 'body', v_rules.body, 'needsReview', v_rules.confirmed_at IS NULL) END,
    'models', jsonb_build_object('answer', v_ai.answer_model, 'fast', v_ai.fast_model,
      'embedding', v_ai.embedding_model),
    'finalPhrase', jsonb_build_object('ru', v_phrases -> 'ru' ->> 'text', 'ky', v_phrases -> 'ky' ->> 'text',
      'en', v_phrases -> 'en' ->> 'text', 'callDate', v_phrases -> 'ru' -> 'callDate',
      'variant', v_phrases -> 'ru' -> 'variant',
      'confirmed', jsonb_build_object('ru', platform_private.ai_autosend_language_confirmed(v_settings, 'ru'),
        'ky', platform_private.ai_autosend_language_confirmed(v_settings, 'ky'),
        'en', platform_private.ai_autosend_language_confirmed(v_settings, 'en'))),
    'disclosure', jsonb_build_object('enabled', v_settings.disclosure_enabled,
      'prefix', v_settings.disclosure_enabled AND platform_private.ai_autosend_first_in_interval(v_row),
      'ru', v_settings.disclosure -> 'ru' ->> 'text', 'ky', v_settings.disclosure -> 'ky' ->> 'text',
      'en', v_settings.disclosure -> 'en' ->> 'text'),
    'patterns', platform_private.ai_autosend_patterns(),
    'qualification', platform_private.ai_autosend_qualification(v_row.organization_id, v_row.conversation_id,
      v_row.interval_start),
    'qualificationFields', jsonb_build_array('country', 'level', 'timing', 'budget', 'grade_or_age', 'city', 'call_time'),
    'limitsLeft', jsonb_build_object(
      'chatHour', greatest(v_settings.limit_chat_hour - (v_usage ->> 'chatHour')::INTEGER, 0),
      'chatNight', greatest(v_settings.limit_chat_night - (v_usage ->> 'chatNight')::INTEGER, 0),
      'numberHour', greatest(v_settings.limit_number_hour - (v_usage ->> 'numberHour')::INTEGER, 0)));
END
$$;

-- Поиск решения: только клиентские документы с autosend_allowed, ready, не
-- заменённые (правило 4); внутренней ветки и эталонов нет. Открытые пункты
-- «Листа сверки» на страницах найденных фрагментов. Найденные фрагменты
-- добавляются в offered_chunk_ids (до 64). Только под арендой (42501).
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_search_v1(p_decision_id UUID, p_worker_ref TEXT,
  p_query_embeddings JSONB, p_query_texts JSONB, p_limit INTEGER DEFAULT 8)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
SET hnsw.iterative_scan = relaxed_order SET hnsw.ef_search = 100 AS $$
DECLARE v_row platform_private.ai_autosend_log; v_vectors public.halfvec[]; v_texts TEXT[]; v_chunks JSONB;
  v_review JSONB; v_offered BIGINT[]; v_settings platform_private.ai_settings;
BEGIN
  IF p_decision_id IS NULL OR p_worker_ref IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8
    OR p_query_embeddings IS NULL OR jsonb_typeof(p_query_embeddings) <> 'array'
    OR jsonb_array_length(p_query_embeddings) > 4
    OR p_query_texts IS NULL OR jsonb_typeof(p_query_texts) <> 'array' OR jsonb_array_length(p_query_texts) > 4
    OR jsonb_array_length(p_query_embeddings) + jsonb_array_length(p_query_texts) = 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_embeddings) e
      WHERE jsonb_typeof(e) <> 'array' OR jsonb_array_length(e) <> 1536)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_texts) e
      WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'ai_autosend_search_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM platform_private.ai_autosend_log l WHERE l.id = p_decision_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'considering' OR v_row.lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    OR v_row.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ai_autosend_not_leased' USING ERRCODE = '42501';
  END IF;
  IF NOT platform_private.ai_autosend_gate(v_row.organization_id) THEN
    RAISE EXCEPTION 'ai_autosend_disabled' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.communication_conversations c
    WHERE c.organization_id = v_row.organization_id AND c.id = v_row.conversation_id AND c.queue = 'sales') THEN
    RAISE EXCEPTION 'ai_autosend_not_sales' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_settings_row(v_row.organization_id);
  SELECT array_agg((e::TEXT)::public.halfvec(1536) ORDER BY o) INTO v_vectors
  FROM jsonb_array_elements(p_query_embeddings) WITH ORDINALITY AS a(e, o);
  SELECT array_agg(e #>> '{}' ORDER BY o) INTO v_texts
  FROM jsonb_array_elements(p_query_texts) WITH ORDINALITY AS a(e, o);
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.pick), '[]'::JSONB) INTO v_chunks FROM (
    SELECT jsonb_build_object('chunkId', c.id, 'documentId', d.id, 'title', d.title, 'pageFrom', c.page_from,
        'pageTo', c.page_to, 'sheetName', c.sheet_name, 'sectionPath', c.section_path, 'context', c.context,
        'content', c.content, 'lang', c.lang, 'score', ranked.score) AS j,
      row_number() OVER (ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id) AS pick
    FROM (SELECT s.chunk_id, s.score,
        row_number() OVER (PARTITION BY ch.document_id ORDER BY s.score DESC, s.chunk_id) AS doc_rank
      FROM platform_private.ai_search_rank(v_row.organization_id, 'client', v_vectors, v_texts) s
      JOIN platform_private.ai_chunks ch ON ch.id = s.chunk_id
      JOIN platform_private.ai_documents dd ON dd.organization_id = ch.organization_id AND dd.id = ch.document_id
      WHERE dd.audience = 'client' AND dd.autosend_allowed AND dd.status = 'ready' AND dd.superseded_by_id IS NULL) ranked
    JOIN platform_private.ai_chunks c ON c.id = ranked.chunk_id
    JOIN platform_private.ai_documents d ON d.id = c.document_id
    ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id LIMIT p_limit) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId', r.document_id, 'pageNo', r.page_no, 'kind', r.kind,
      'value', r.value, 'proposed', r.proposed, 'anchor', r.anchor, 'status', r.status)
      ORDER BY r.document_id, r.page_no, r.id), '[]'::JSONB)
  INTO v_review
  FROM platform_private.ai_review_items r
  WHERE r.organization_id = v_row.organization_id AND r.status IN ('open', 'applying') AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_chunks) e
    WHERE (e ->> 'documentId')::UUID = r.document_id
      AND r.page_no BETWEEN COALESCE((e ->> 'pageFrom')::INTEGER, 1) AND COALESCE((e ->> 'pageTo')::INTEGER, 300));
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_offered
  FROM unnest(v_row.offered_chunk_ids || ARRAY(SELECT (e ->> 'chunkId')::BIGINT FROM jsonb_array_elements(v_chunks) e)) x;
  IF cardinality(v_offered) > 64 THEN
    RAISE EXCEPTION 'ai_autosend_search_exhausted' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_autosend_log l SET offered_chunk_ids = v_offered, updated_at = clock_timestamp()
  WHERE l.id = v_row.id;
  RETURN jsonb_build_object('chunks', v_chunks, 'review', v_review, 'knowledgeVersion', v_settings.knowledge_version);
END
$$;

-- Решение агента (колонка «commit» таблицы §11). kind answer | final_phrase |
-- skip. Код причины: у skip — обязателен (причина пропуска), у final_phrase —
-- по желанию (почему агент сказал финальную фразу; final_reason_code), у
-- answer — нет. final_phrase — ровно вычисленная фраза на язык и момент; строка-
-- раскрытие — в начале первого учтённого решения чата в интервале; живой
-- режим с неподтверждённым языком — phrase_unconfirmed. Прошло: задержка
-- min..max, live/live_test → scheduled и отложенный указатель, shadow →
-- shadow. Не прошло — skipped. Три skip gemini_error подряд — пауза. Повтор
-- после записи отдаёт текущее состояние.
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_commit_v1(p_decision_id UUID, p_worker_ref TEXT, p_kind TEXT,
  p_language TEXT, p_body TEXT, p_cited_chunk_ids BIGINT[], p_reason_code TEXT, p_qualification JSONB, p_model TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_conversation UUID; v_organization UUID; v_row platform_private.ai_autosend_log;
  v_settings platform_private.ai_autosend_settings;
  v_now TIMESTAMPTZ := clock_timestamp(); v_reason TEXT; v_phrase JSONB; v_prefix BOOLEAN := FALSE; v_text TEXT;
  v_body TEXT; v_delay INTEGER; v_status TEXT; v_cited BIGINT[]; v_pause JSONB;
BEGIN
  v_body := btrim(p_body);
  v_cited := COALESCE(p_cited_chunk_ids, '{}');
  IF p_decision_id IS NULL OR p_worker_ref IS NULL OR p_kind IS NULL OR p_kind NOT IN ('answer', 'final_phrase', 'skip')
    OR (p_language IS NOT NULL AND p_language NOT IN ('ru', 'ky', 'en'))
    OR (p_kind <> 'skip' AND (p_language IS NULL OR v_body IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 1000))
    OR (p_kind = 'answer' AND p_reason_code IS NOT NULL)
    OR (p_kind = 'final_phrase' AND p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$')
    OR (p_kind = 'skip' AND (p_reason_code IS NULL OR p_reason_code !~ '^[a-z][a-z0-9_]{0,63}$'
      OR (v_body IS NOT NULL AND char_length(v_body) NOT BETWEEN 1 AND 1000)))
    OR cardinality(v_cited) > 16 OR array_position(v_cited, NULL) IS NOT NULL
    OR (p_kind = 'final_phrase' AND cardinality(v_cited) > 0)
    OR (p_model IS NOT NULL AND p_model !~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$')
    OR NOT platform_private.ai_autosend_qualification_ok(p_qualification) THEN
    RAISE EXCEPTION 'ai_autosend_commit_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT l.conversation_id, l.organization_id INTO v_conversation, v_organization
  FROM platform_private.ai_autosend_log l WHERE l.id = p_decision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_autosend_decision_unknown' USING ERRCODE = 'P0002';
  END IF;
  -- Ошибка Gemini может поставить паузу (она снимает ждущие автоответы):
  -- замок claim организации — до замков чата и строки (276).
  IF p_kind = 'skip' AND p_reason_code = 'gemini_error' THEN
    PERFORM platform_private.ai_autosend_claim_lock(v_organization);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend:' || v_conversation::TEXT, 275));
  SELECT * INTO v_row FROM platform_private.ai_autosend_log l WHERE l.id = p_decision_id FOR UPDATE;
  IF v_row.status <> 'considering' THEN
    RETURN jsonb_build_object('decisionId', v_row.id, 'status', v_row.status, 'mode', v_row.mode, 'kind', v_row.kind,
      'reasonCode', v_row.reason_code, 'sendAt', v_row.send_at, 'replayed', TRUE);
  END IF;
  IF v_row.lease_owner IS DISTINCT FROM btrim(p_worker_ref) OR v_row.lease_expires_at <= v_now THEN
    RAISE EXCEPTION 'ai_autosend_not_leased' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_autosend_settings_row(v_row.organization_id);
  SELECT * INTO v_settings FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = v_row.organization_id FOR UPDATE;
  -- Ошибки Gemini: три skip gemini_error подряд — пауза; любое другое
  -- решение агента обнуляет счётчик.
  IF p_kind = 'skip' AND p_reason_code = 'gemini_error' THEN
    UPDATE platform_private.ai_autosend_settings s SET gemini_error_streak = s.gemini_error_streak + 1,
      updated_at = v_now
    WHERE s.organization_id = v_row.organization_id RETURNING * INTO v_settings;
    IF v_settings.gemini_error_streak >= 3 THEN
      v_pause := platform_private.ai_autosend_pause(v_row.organization_id, 'gemini_error', 'agent', NULL, NULL,
        'evo_ai_agent', NULL);
    END IF;
  ELSIF v_settings.gemini_error_streak > 0 THEN
    UPDATE platform_private.ai_autosend_settings s SET gemini_error_streak = 0, updated_at = v_now
    WHERE s.organization_id = v_row.organization_id RETURNING * INTO v_settings;
  END IF;
  IF p_kind = 'skip' THEN
    UPDATE platform_private.ai_autosend_log l SET qualification = COALESCE(p_qualification, l.qualification),
      model = COALESCE(p_model, l.model), body = v_body, language = p_language, committed_at = v_now
    WHERE l.id = v_row.id;
    v_row := platform_private.ai_autosend_skip(v_row.id, p_reason_code);
    RETURN jsonb_build_object('decisionId', v_row.id, 'status', v_row.status, 'reasonCode', v_row.reason_code,
      'paused', v_pause IS NOT NULL, 'replayed', FALSE);
  END IF;

  v_row.kind := p_kind;
  v_row.language := p_language;
  v_row.body := v_body;
  v_row.mode := platform_private.ai_autosend_mode(v_settings, v_row.conversation_id);
  v_phrase := platform_private.ai_autosend_final_phrase(v_settings, p_language, v_now);
  IF v_phrase IS NULL THEN
    v_reason := 'no_working_day';
  ELSIF p_kind = 'final_phrase' AND v_body IS DISTINCT FROM v_phrase ->> 'text' THEN
    v_reason := 'phrase_mismatch';
  END IF;
  v_prefix := v_settings.disclosure_enabled AND platform_private.ai_autosend_first_in_interval(v_row);
  v_text := btrim(CASE WHEN v_prefix THEN (v_settings.disclosure -> p_language ->> 'text') || E'\n' || v_body
    ELSE v_body END);
  IF v_reason IS NULL THEN
    v_reason := platform_private.ai_autosend_check(v_row, 'commit', v_text, v_cited);
  END IF;
  IF v_reason IS NOT NULL THEN
    UPDATE platform_private.ai_autosend_log l SET kind = CASE WHEN p_kind = 'final_phrase' AND v_phrase IS NULL
        THEN NULL ELSE p_kind END,
      call_date = CASE WHEN p_kind = 'final_phrase' THEN (v_phrase ->> 'callDate')::DATE END,
      final_reason_code = CASE WHEN p_kind = 'final_phrase' AND v_phrase IS NOT NULL THEN p_reason_code END,
      language = p_language, body = v_body, mode = v_row.mode,
      cited_chunk_ids = CASE WHEN v_cited <@ l.offered_chunk_ids THEN v_cited ELSE '{}' END,
      qualification = COALESCE(p_qualification, l.qualification), model = COALESCE(p_model, l.model),
      committed_at = v_now
    WHERE l.id = v_row.id;
    v_row := platform_private.ai_autosend_skip(v_row.id, v_reason);
    RETURN jsonb_build_object('decisionId', v_row.id, 'status', v_row.status, 'mode', v_row.mode, 'kind', v_row.kind,
      'reasonCode', v_row.reason_code, 'reasonRu', v_row.reason_ru, 'replayed', FALSE);
  END IF;
  v_delay := v_settings.delay_min_s + floor(random() * (v_settings.delay_max_s - v_settings.delay_min_s + 1))::INTEGER;
  v_status := CASE WHEN v_row.mode = 'shadow' THEN 'shadow' ELSE 'scheduled' END;
  UPDATE platform_private.ai_autosend_log l SET status = v_status, kind = p_kind, language = p_language, body = v_body,
    text = v_text, text_sha256 = encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), mode = v_row.mode,
    cited_chunk_ids = v_cited, qualification = COALESCE(p_qualification, l.qualification),
    model = COALESCE(p_model, l.model),
    call_date = CASE WHEN p_kind = 'final_phrase' THEN (v_phrase ->> 'callDate')::DATE END,
    final_reason_code = CASE WHEN p_kind = 'final_phrase' THEN p_reason_code END,
    send_at = v_now + make_interval(secs => v_delay), delay_s = v_delay, committed_at = v_now,
    lease_owner = NULL, lease_expires_at = NULL, updated_at = v_now,
    finished_at = CASE WHEN v_status = 'shadow' THEN v_now END
  WHERE l.id = v_row.id RETURNING * INTO v_row;
  IF v_status = 'scheduled' THEN
    PERFORM pgmq.send('ai_agent_work_v1', jsonb_build_object('v', 1, 'kind', 'autosend', 'ref_id', v_row.id), v_delay);
  END IF;
  RETURN jsonb_build_object('decisionId', v_row.id, 'status', v_row.status, 'mode', v_row.mode, 'kind', v_row.kind,
    'sendAt', v_row.send_at, 'delaySeconds', v_row.delay_s, 'textSha256', v_row.text_sha256,
    'disclosed', v_prefix, 'callDate', v_row.call_date, 'replayed', FALSE);
END
$$;

-- Пауза от агента: gemini_error, gemini_billing (оплата, ключ, дневная
-- квота, 404 модели), server_switch_off (CRM ответил 503: env-выключатель).
-- Запланированные отправки отменяются. Снять паузу может только человек.
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_pause_v1(p_organization_id UUID, p_code TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_autosend_settings;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_code IS NULL
    OR p_code NOT IN ('gemini_error', 'gemini_billing', 'server_switch_off') THEN
    RAISE EXCEPTION 'ai_autosend_pause_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  IF EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = p_request_id) THEN
    v_settings := platform_private.ai_autosend_settings_row(p_organization_id);
    RETURN jsonb_build_object('paused', v_settings.pause_code IS NOT NULL, 'pauseCode', v_settings.pause_code,
      'changed', FALSE, 'cancelled', 0, 'replayed', TRUE);
  END IF;
  RETURN platform_private.ai_autosend_pause(p_organization_id, p_code, 'agent', NULL, NULL, 'evo_ai_agent',
    p_request_id) || jsonb_build_object('replayed', FALSE);
END
$$;

-- Утренняя сводка: для каждого закончившегося интервала с решениями и без
-- сводки (до 20 за вызов) — в одной транзакции сводка (по чатам: счётчики,
-- статусы, причины, финальная фраза и день звонка, квалификация; без текста
-- клиента) и задачи «Позвонить клиенту» по живым отправленным финальным
-- фразам (не в shadow), один раз. Возвращает ID сводок, ждущих
-- квалификации (pending).
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_summary_due_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_interval RECORD; v_summary platform_private.ai_autosend_summaries; v_items JSONB; v_counts JSONB;
  v_shadow BOOLEAN; v_task RECORD; v_result JSONB; v_created INTEGER := 0; v_pending JSONB;
BEGIN
  FOR v_interval IN SELECT l.organization_id, l.interval_start, max(l.interval_end) AS interval_end
    FROM platform_private.ai_autosend_log l
    WHERE l.interval_end <= clock_timestamp() AND NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_summaries s
      WHERE s.organization_id = l.organization_id AND s.interval_start = l.interval_start)
    GROUP BY l.organization_id, l.interval_start ORDER BY l.organization_id, l.interval_start LIMIT 20 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend_summary:' || v_interval.organization_id::TEXT || ':'
      || v_interval.interval_start::TEXT, 275));
    IF EXISTS (SELECT 1 FROM platform_private.ai_autosend_summaries s
      WHERE s.organization_id = v_interval.organization_id AND s.interval_start = v_interval.interval_start) THEN
      CONTINUE;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('conversationId', c.conversation_id, 'considered', c.considered,
        'answered', c.answered, 'finalPhrase', c.final_phrase, 'callDate', c.call_date, 'statuses', c.statuses,
        'reasons', c.reasons, 'qualification', platform_private.ai_autosend_qualification(v_interval.organization_id,
          c.conversation_id, v_interval.interval_start), 'taskId', NULL, 'taskSkipped', FALSE)
        ORDER BY c.conversation_id), '[]'::JSONB),
      jsonb_build_object('conversations', count(*), 'considered', COALESCE(sum(c.considered), 0),
        'answered', COALESCE(sum(c.answered), 0), 'finalPhrases', count(*) FILTER (WHERE c.final_phrase))
    INTO v_items, v_counts
    FROM (SELECT l.conversation_id, count(*) AS considered,
        count(*) FILTER (WHERE l.kind = 'answer' AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow'))
          AS answered,
        bool_or(l.kind = 'final_phrase' AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow'))
          AS final_phrase,
        max(l.call_date) FILTER (WHERE l.kind = 'final_phrase'
          AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow')) AS call_date,
        (SELECT jsonb_object_agg(st.status, st.n) FROM (SELECT l2.status, count(*) AS n
          FROM platform_private.ai_autosend_log l2 WHERE l2.organization_id = v_interval.organization_id
            AND l2.interval_start = v_interval.interval_start AND l2.conversation_id = l.conversation_id
          GROUP BY l2.status) st) AS statuses,
        (SELECT COALESCE(jsonb_object_agg(rs.reason_code, rs.n), '{}'::JSONB) FROM (SELECT l2.reason_code, count(*) AS n
          FROM platform_private.ai_autosend_log l2 WHERE l2.organization_id = v_interval.organization_id
            AND l2.interval_start = v_interval.interval_start AND l2.conversation_id = l.conversation_id
            AND l2.reason_code IS NOT NULL
          GROUP BY l2.reason_code) rs) AS reasons
      FROM platform_private.ai_autosend_log l
      WHERE l.organization_id = v_interval.organization_id AND l.interval_start = v_interval.interval_start
      GROUP BY l.conversation_id) c;
    -- Ночь проверки — в интервале нет ни одного решения живого режима.
    SELECT NOT COALESCE(bool_or(l.mode IN ('live', 'live_test')), FALSE) INTO v_shadow
    FROM platform_private.ai_autosend_log l
    WHERE l.organization_id = v_interval.organization_id AND l.interval_start = v_interval.interval_start;
    SELECT v_counts || COALESCE(jsonb_object_agg(st.status, st.n), '{}'::JSONB) INTO v_counts
    FROM (SELECT l.status, count(*) AS n FROM platform_private.ai_autosend_log l
      WHERE l.organization_id = v_interval.organization_id AND l.interval_start = v_interval.interval_start
      GROUP BY l.status) st;
    INSERT INTO platform_private.ai_autosend_summaries (organization_id, interval_start, interval_end, shadow_night,
      counts, items)
    VALUES (v_interval.organization_id, v_interval.interval_start, v_interval.interval_end, v_shadow, v_counts, v_items)
    RETURNING * INTO v_summary;
    v_created := v_created + 1;
    -- Задача — по живой финальной фразе, которая могла дойти до клиента:
    -- sent, unknown (сверка может найти сообщение позже) и authorized (ещё
    -- отправляется на конце интервала). Лишний звонок лучше несдержанного
    -- обещания; сводка строится один раз.
    FOR v_task IN SELECT l.conversation_id, max(l.call_date) AS call_date FROM platform_private.ai_autosend_log l
      WHERE l.organization_id = v_interval.organization_id AND l.interval_start = v_interval.interval_start
        AND l.kind = 'final_phrase' AND l.status IN ('authorized', 'sent', 'unknown') AND l.mode IN ('live', 'live_test')
      GROUP BY l.conversation_id ORDER BY l.conversation_id LOOP
      v_result := platform_private.ai_autosend_call_task(v_summary.id, v_task.conversation_id, v_task.call_date);
      UPDATE platform_private.ai_autosend_summaries s SET items = (SELECT jsonb_agg(CASE
          WHEN e ->> 'conversationId' = v_task.conversation_id::TEXT
            THEN e || jsonb_build_object('taskId', v_result -> 'taskId', 'taskSkipped', v_result -> 'taskSkipped')
          ELSE e END ORDER BY o) FROM jsonb_array_elements(s.items) WITH ORDINALITY AS a(e, o)),
        updated_at = clock_timestamp()
      WHERE s.id = v_summary.id;
    END LOOP;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('summaryId', s.id, 'organizationId', s.organization_id,
      'intervalStart', s.interval_start, 'intervalEnd', s.interval_end) ORDER BY s.interval_start, s.id), '[]'::JSONB)
  INTO v_pending
  FROM (SELECT s.* FROM platform_private.ai_autosend_summaries s WHERE s.status = 'pending'
    AND (platform_private.ai_autosend_settings_row(s.organization_id)).enabled
    ORDER BY s.interval_start, s.id LIMIT 50) s;
  RETURN jsonb_build_object('created', v_created, 'pending', v_pending);
END
$$;

-- Контекст квалификации сводки (purpose autosend_summary): по чату — его
-- сообщения за интервал (до 40 последних, через ai_message_view с
-- происхождением) и уже собранная квалификация. Ворота: автоответчик включён
-- и согласие записано (иначе 42501). Аренда сводки (busy).
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_summary_context_v1(p_summary_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_summary platform_private.ai_autosend_summaries; v_chats JSONB; v_ai platform_private.ai_settings;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_summary_id IS NULL OR p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_autosend_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_summary FROM platform_private.ai_autosend_summaries s WHERE s.id = p_summary_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_autosend_summary_unknown' USING ERRCODE = 'P0002';
  END IF;
  v_ai := platform_private.ai_settings_row(v_summary.organization_id);
  IF NOT (platform_private.ai_autosend_settings_row(v_summary.organization_id)).enabled
    OR v_ai.gemini_consent_at IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_disabled' USING ERRCODE = '42501';
  END IF;
  IF v_summary.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'none', 'summaryId', v_summary.id);
  END IF;
  IF v_summary.lease_owner IS DISTINCT FROM btrim(p_worker_ref) AND v_summary.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('status', 'busy', 'summaryId', v_summary.id, 'leaseExpiresAt', v_summary.lease_expires_at);
  END IF;
  UPDATE platform_private.ai_autosend_summaries s SET lease_owner = btrim(p_worker_ref),
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds), updated_at = v_now
  WHERE s.id = v_summary.id RETURNING * INTO v_summary;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('conversationId', c.id,
      'messages', (SELECT COALESCE(jsonb_agg(platform_private.ai_autosend_message_view(x.msg)
          ORDER BY (x.msg).created_at, (x.msg).id), '[]'::JSONB)
        FROM (SELECT d AS msg FROM platform_private.ai_dialog_messages(c.organization_id, c.id) d
          WHERE d.created_at >= v_summary.interval_start AND d.created_at < v_summary.interval_end
          ORDER BY d.created_at DESC, d.id DESC LIMIT 40) x),
      'qualification', e -> 'qualification') ORDER BY c.id), '[]'::JSONB)
  INTO v_chats
  FROM jsonb_array_elements(v_summary.items) e
  JOIN platform.communication_conversations c ON c.organization_id = v_summary.organization_id
    AND c.id = (e ->> 'conversationId')::UUID AND c.queue = 'sales';
  RETURN jsonb_build_object('status', 'claimed', 'summaryId', v_summary.id, 'organizationId', v_summary.organization_id,
    'intervalStart', v_summary.interval_start, 'intervalEnd', v_summary.interval_end,
    'models', jsonb_build_object('fast', v_ai.fast_model),
    'qualificationFields', jsonb_build_array('country', 'level', 'timing', 'budget', 'grade_or_age', 'city', 'call_time'),
    'chats', v_chats, 'leaseExpiresAt', v_summary.lease_expires_at);
END
$$;

-- Квалификация сводки под арендой: [{conversationId, qualification}] только
-- по чатам сводки; поля ≤ 140, без телефонов и e-mail (22023). Сводка
-- становится ready, аренда снимается.
CREATE OR REPLACE FUNCTION platform_ai_agent.autosend_summary_put_v1(p_summary_id UUID, p_worker_ref TEXT,
  p_items JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_summary platform_private.ai_autosend_summaries;
BEGIN
  IF p_summary_id IS NULL OR p_worker_ref IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) > 500
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
      WHERE jsonb_typeof(e) <> 'object'
        OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM ARRAY['conversationId', 'qualification']
        OR jsonb_typeof(e -> 'conversationId') <> 'string'
        OR (e ->> 'conversationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR jsonb_typeof(e -> 'qualification') <> 'object'
        OR NOT platform_private.ai_autosend_qualification_ok(e -> 'qualification')) THEN
    RAISE EXCEPTION 'ai_autosend_summary_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_summary FROM platform_private.ai_autosend_summaries s WHERE s.id = p_summary_id FOR UPDATE;
  IF NOT FOUND OR v_summary.lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    OR v_summary.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ai_autosend_not_leased' USING ERRCODE = '42501';
  END IF;
  IF NOT (platform_private.ai_autosend_settings_row(v_summary.organization_id)).enabled
    OR (platform_private.ai_settings_row(v_summary.organization_id)).gemini_consent_at IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_disabled' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NOT EXISTS (SELECT 1
    FROM jsonb_array_elements(v_summary.items) i WHERE i ->> 'conversationId' = e ->> 'conversationId')) THEN
    RAISE EXCEPTION 'ai_autosend_summary_invalid' USING ERRCODE = '22023', DETAIL = 'conversation';
  END IF;
  UPDATE platform_private.ai_autosend_summaries s SET items = (SELECT jsonb_agg(i || COALESCE((SELECT
        jsonb_build_object('qualification', COALESCE(i -> 'qualification', '{}'::JSONB) || (e -> 'qualification'))
        FROM jsonb_array_elements(p_items) e WHERE e ->> 'conversationId' = i ->> 'conversationId' LIMIT 1),
        '{}'::JSONB) ORDER BY o)
      FROM jsonb_array_elements(s.items) WITH ORDINALITY AS a(i, o)),
    status = 'ready', lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE s.id = v_summary.id;
  RETURN jsonb_build_object('status', 'saved', 'summaryId', v_summary.id);
END
$$;

-- Уборка (274) + автоответчик: авторизованные, но не взятые claim за 2
-- минуты автоответы снимаются с очереди (send_expired); работа отменённых
-- решений, оставшаяся в очереди, снимается снова; авторизованные решения без
-- итога закрываются по состоянию работы (ниже); запланированные
-- отправки, не авторизованные через 10 минут после send_at, отменяются
-- (send_expired); брошенные
-- considering (аренда истекла или не взята 10 минут) — skipped (expired);
-- истёкшие аренды сводок снимаются; строки журнала без авторизации и сводки
-- старше 180 дней удаляются.
CREATE OR REPLACE FUNCTION platform_ai_agent.maintenance_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tickets INTEGER; v_answers INTEGER; v_rates INTEGER; v_calls INTEGER; v_reservations INTEGER;
  v_sessions INTEGER; v_expired INTEGER; v_proposals INTEGER; v_memory INTEGER; v_leases INTEGER;
  v_send_expired INTEGER; v_considering INTEGER; v_log_deleted INTEGER; v_summaries_deleted INTEGER;
  v_unclaimed INTEGER := 0; v_org UUID; v_stale RECORD; v_retired INTEGER := 0; v_reconciled INTEGER := 0;
  v_streak INTEGER; v_paused BOOLEAN; v_pause JSONB; v_send_error_pauses INTEGER := 0;
BEGIN
  -- Первым (до замков строк журнала): авторизованные, но не взятые claim за 2
  -- минуты автоответы (CRM упал между authorize и claim) снимаются с очереди —
  -- они не уйдут позже по устаревшему решению и не держат очередь ручных
  -- отправок организации.
  FOR v_org IN SELECT DISTINCT l.organization_id FROM platform_private.ai_autosend_log l
    JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
    WHERE l.status = 'authorized' AND i.state = 'queued' AND i.attempt_count = 0
      AND l.authorized_at < clock_timestamp() - INTERVAL '2 minutes'
    ORDER BY 1 LOOP
    v_unclaimed := v_unclaimed + platform_private.ai_autosend_cancel_pending(v_org, NULL, NULL, 'send_expired', NULL,
      clock_timestamp() - INTERVAL '2 minutes');
  END LOOP;
  -- Отменённые решения, чья работа осталась в очереди (при отмене её не
  -- удалось снять): снять снова (276, ai_autosend_retire_work) — иначе чат
  -- навсегда «сотрудник активен», а в попытках висит queued.
  FOR v_org IN SELECT DISTINCT l.organization_id FROM platform_private.ai_autosend_log l
    JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
    WHERE l.status = 'cancelled' AND i.state = 'queued' AND i.attempt_count = 0
    ORDER BY 1 LOOP
    PERFORM platform_private.ai_autosend_claim_lock(v_org);
    FOR v_stale IN SELECT l.id, l.work_item_id, l.reason_code FROM platform_private.ai_autosend_log l
      JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
      WHERE l.organization_id = v_org AND l.status = 'cancelled' AND i.state = 'queued' AND i.attempt_count = 0
      ORDER BY l.id LIMIT 500 LOOP
      IF platform_private.ai_autosend_retire_work(v_org, v_stale.id, v_stale.work_item_id, v_stale.reason_code) THEN
        v_retired := v_retired + 1;
      END IF;
    END LOOP;
  END LOOP;
  -- Авторизованные решения без итога (CRM упал между claim и record): работа
  -- завершилась больше 10 минут назад или её аренда истекла больше 10 минут
  -- назад (CRM берёт аренду на 120 с; после неё finish уже отклоняется, а 10
  -- минут оставляют первое слово записи итога самого CRM и её повторам).
  -- Итог — по состоянию работы, как у повтора CRM: succeeded с привязкой
  -- сообщения провайдера — sent; dead_lettered — failed (send_failed);
  -- unknown/conflict_manual_review и succeeded без привязки — unknown
  -- (send_unknown); истёкшая аренда — unknown (lease_expired). Работа,
  -- очередь и попытки не трогаются, ничего не отправляется заново: истёкшую
  -- аренду, как и раньше, переводит в ручную проверку следующий claim, а
  -- сверка ручной отправки остаётся сотруднику (unknown → sent в
  -- ai_autosend_record_v1 по-прежнему допускается).
  -- Итог уборки считается в серии ошибок, как итог ai_autosend_record_v1:
  -- sent обнуляет счётчик, failed/unknown прибавляют; третья ошибка подряд —
  -- пауза send_errors (system). Иначе CRM, который падает на каждой отправке
  -- до записи итога, слал бы ночью без паузы. По организации: замок claim —
  -- первым (как в record и паузе), решения — по времени окончания работы.
  FOR v_org IN SELECT DISTINCT l.organization_id FROM platform_private.ai_autosend_log l
    JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
    WHERE l.status = 'authorized'
      AND ((i.state IN ('succeeded', 'dead_lettered', 'unknown_manual_review', 'conflict_manual_review')
          AND i.completed_at < clock_timestamp() - INTERVAL '10 minutes')
        OR (i.state = 'leased' AND i.leased_until < clock_timestamp() - INTERVAL '10 minutes'))
    ORDER BY 1 LOOP
    PERFORM platform_private.ai_autosend_claim_lock(v_org);
    v_paused := FALSE;
    FOR v_stale IN SELECT l.id, l.manual_send_authorization_id, l.work_item_id, i.state::TEXT AS work_state,
        CASE WHEN i.state = 'succeeded' AND b.durable_work_item_id IS NOT NULL THEN 'sent'
          WHEN i.state = 'dead_lettered' THEN 'failed' ELSE 'unknown' END AS outcome,
        CASE WHEN i.state = 'succeeded' AND b.durable_work_item_id IS NOT NULL THEN NULL
          WHEN i.state = 'dead_lettered' THEN 'send_failed'
          WHEN i.state = 'leased' THEN 'lease_expired' ELSE 'send_unknown' END AS code
      FROM platform_private.ai_autosend_log l
      JOIN platform_private.durable_work_items i ON i.organization_id = l.organization_id AND i.id = l.work_item_id
      LEFT JOIN LATERAL (SELECT pb.durable_work_item_id FROM platform_private.manual_send_provider_bindings pb
        WHERE pb.organization_id = l.organization_id AND pb.durable_work_item_id = l.work_item_id LIMIT 1) b ON TRUE
      WHERE l.organization_id = v_org AND l.status = 'authorized'
        AND ((i.state IN ('succeeded', 'dead_lettered', 'unknown_manual_review', 'conflict_manual_review')
            AND i.completed_at < clock_timestamp() - INTERVAL '10 minutes')
          OR (i.state = 'leased' AND i.leased_until < clock_timestamp() - INTERVAL '10 minutes'))
      ORDER BY CASE WHEN i.state = 'leased' THEN i.leased_until ELSE i.completed_at END, l.id LIMIT 5000
      FOR UPDATE OF l SKIP LOCKED LOOP
      UPDATE platform_private.ai_autosend_log l SET status = v_stale.outcome, outcome_code = v_stale.code,
        finished_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE l.id = v_stale.id AND l.status = 'authorized';
      CONTINUE WHEN NOT FOUND;
      PERFORM platform_private.ai_autosend_settings_row(v_org);
      UPDATE platform_private.ai_autosend_settings s SET
        send_error_streak = CASE WHEN v_stale.outcome = 'sent' THEN 0 ELSE s.send_error_streak + 1 END,
        updated_at = clock_timestamp()
      WHERE s.organization_id = v_org RETURNING s.send_error_streak INTO v_streak;
      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
        resource_type, resource_id, before_state, after_state, reason, request_id)
      VALUES (v_org, 'system', NULL, 'ai-autosend-maintenance', 'ai.agent.autosend.reconcile',
        'manual_send_authorization', v_stale.manual_send_authorization_id, jsonb_build_object('status', 'authorized'),
        jsonb_build_object('decisionId', v_stale.id, 'status', v_stale.outcome, 'outcomeCode', v_stale.code,
          'workItemId', v_stale.work_item_id, 'workState', v_stale.work_state, 'sendErrorStreak', v_streak),
        'ИИ-агент: итог автоответа закрыт уборкой по состоянию работы (без повторной отправки)',
        platform_private.p3c_request_child_id(v_stale.id, 'ai-autosend-reconcile'));
      v_reconciled := v_reconciled + 1;
      IF v_stale.outcome <> 'sent' AND v_streak >= 3 AND NOT v_paused THEN
        v_pause := platform_private.ai_autosend_pause(v_org, 'send_errors', 'system', NULL, NULL,
          'ai-autosend-maintenance', platform_private.p3c_request_child_id(v_stale.id, 'ai-autosend-reconcile-pause'));
        v_paused := TRUE;
        IF (v_pause ->> 'changed')::BOOLEAN THEN
          v_send_error_pauses := v_send_error_pauses + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  DELETE FROM platform_private.ai_tickets t WHERE t.token_sha256 IN (SELECT o.token_sha256
    FROM platform_private.ai_tickets o WHERE o.expires_at < clock_timestamp() - INTERVAL '1 day' LIMIT 5000);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;
  DELETE FROM platform_private.ai_answers a WHERE a.id IN (SELECT o.id FROM platform_private.ai_answers o
    WHERE o.created_at < clock_timestamp() - INTERVAL '90 days' LIMIT 5000);
  GET DIAGNOSTICS v_answers = ROW_COUNT;
  DELETE FROM platform_private.ai_rate_limits l WHERE l.window_start < clock_timestamp() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_rates = ROW_COUNT;
  DELETE FROM platform_private.ai_usage_calls c WHERE (c.organization_id, c.call_id) IN (SELECT o.organization_id,
    o.call_id FROM platform_private.ai_usage_calls o WHERE o.created_at < clock_timestamp() - INTERVAL '3 days' LIMIT 5000);
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  DELETE FROM platform_private.ai_budget_reservations b WHERE b.id IN (SELECT o.id
    FROM platform_private.ai_budget_reservations o WHERE o.created_at < clock_timestamp() - INTERVAL '1 day' LIMIT 5000);
  GET DIAGNOSTICS v_reservations = ROW_COUNT;
  DELETE FROM platform_private.ai_lab_sessions s WHERE (s.organization_id, s.membership_id) IN (SELECT o.organization_id,
    o.membership_id FROM platform_private.ai_lab_sessions o WHERE o.expires_at < clock_timestamp() LIMIT 5000);
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  UPDATE platform_private.ai_lab_proposals p SET status = 'expired', decided_at = clock_timestamp()
  WHERE p.id IN (SELECT o.id FROM platform_private.ai_lab_proposals o
    WHERE o.status = 'proposed' AND o.expires_at < clock_timestamp() LIMIT 5000);
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  DELETE FROM platform_private.ai_lab_proposals p WHERE p.id IN (SELECT o.id FROM platform_private.ai_lab_proposals o
    WHERE o.status <> 'proposed' AND o.created_at < clock_timestamp() - INTERVAL '90 days' LIMIT 5000);
  GET DIAGNOSTICS v_proposals = ROW_COUNT;
  DELETE FROM platform_private.ai_client_memory m WHERE m.conversation_id IN (SELECT o.conversation_id
    FROM platform_private.ai_client_memory o
    JOIN platform.communication_conversations c ON c.organization_id = o.organization_id AND c.id = o.conversation_id
    WHERE c.queue <> 'sales' OR NOT platform_private.ai_memory_gate(o.organization_id) LIMIT 5000);
  GET DIAGNOSTICS v_memory = ROW_COUNT;
  UPDATE platform_private.ai_client_memory m SET lease_owner = NULL, lease_expires_at = NULL
  WHERE m.lease_expires_at < clock_timestamp();
  GET DIAGNOSTICS v_leases = ROW_COUNT;
  UPDATE platform_private.ai_autosend_log l SET status = 'cancelled', reason_code = 'send_expired',
    reason_ru = platform_private.ai_autosend_reason_ru('send_expired'), finished_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE l.id IN (SELECT o.id FROM platform_private.ai_autosend_log o
    WHERE o.status = 'scheduled' AND o.send_at < clock_timestamp() - INTERVAL '10 minutes' LIMIT 5000);
  GET DIAGNOSTICS v_send_expired = ROW_COUNT;
  UPDATE platform_private.ai_autosend_log l SET status = 'skipped', reason_code = 'expired',
    reason_ru = platform_private.ai_autosend_reason_ru('expired'), lease_owner = NULL, lease_expires_at = NULL,
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE l.id IN (SELECT o.id FROM platform_private.ai_autosend_log o
    WHERE o.status = 'considering' AND o.created_at < clock_timestamp() - INTERVAL '10 minutes'
      AND (o.lease_expires_at IS NULL OR o.lease_expires_at < clock_timestamp()) LIMIT 5000);
  GET DIAGNOSTICS v_considering = ROW_COUNT;
  UPDATE platform_private.ai_autosend_summaries s SET lease_owner = NULL, lease_expires_at = NULL
  WHERE s.lease_expires_at < clock_timestamp();
  DELETE FROM platform_private.ai_autosend_log l WHERE l.id IN (SELECT o.id FROM platform_private.ai_autosend_log o
    WHERE o.manual_send_authorization_id IS NULL AND o.created_at < clock_timestamp() - INTERVAL '180 days'
      AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
        WHERE a.organization_id = o.organization_id AND a.ai_autosend_decision_id = o.id)
    LIMIT 5000);
  GET DIAGNOSTICS v_log_deleted = ROW_COUNT;
  DELETE FROM platform_private.ai_autosend_summaries s WHERE s.id IN (SELECT o.id
    FROM platform_private.ai_autosend_summaries o WHERE o.interval_end < clock_timestamp() - INTERVAL '180 days' LIMIT 5000);
  GET DIAGNOSTICS v_summaries_deleted = ROW_COUNT;
  RETURN jsonb_build_object('tickets', v_tickets, 'answers', v_answers, 'rateWindows', v_rates,
    'usageCalls', v_calls, 'reservations', v_reservations, 'labSessions', v_sessions,
    'labProposalsExpired', v_expired, 'labProposalsDeleted', v_proposals, 'memoryDeleted', v_memory,
    'memoryLeasesCleared', v_leases, 'autosendSendExpired', v_send_expired, 'autosendUnclaimedCancelled', v_unclaimed,
    'autosendCancelledWorkRetired', v_retired, 'autosendAuthorizedReconciled', v_reconciled,
    'autosendSendErrorPauses', v_send_error_pauses, 'autosendConsideringExpired', v_considering,
    'autosendLogDeleted', v_log_deleted, 'autosendSummariesDeleted', v_summaries_deleted);
END
$$;

-- ===========================================================================
-- Сотрудники (platform, authenticated).
-- ===========================================================================

-- «ИИ-агент → Автоответчик»: настройки, состояние (окно сейчас, пауза,
-- ответственный, ночи проверки), последняя сводка. ai.agent.use.
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_autosend_settings; v_ai platform_private.ai_settings;
  v_summary platform_private.ai_autosend_summaries; v_responsible TEXT; v_nights INTEGER;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  v_settings := platform_private.ai_autosend_settings_row(p_organization_id);
  v_ai := platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_summary FROM platform_private.ai_autosend_summaries s
  WHERE s.organization_id = p_organization_id ORDER BY s.interval_start DESC, s.id DESC LIMIT 1;
  SELECT p.display_name INTO v_responsible FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.id = v_settings.responsible_membership_id;
  v_nights := platform_private.ai_autosend_shadow_nights(p_organization_id);
  RETURN jsonb_build_object('settings', platform_private.ai_autosend_settings_json(v_settings),
    'state', jsonb_build_object('enabled', v_settings.enabled, 'shadowMode', v_settings.shadow_mode,
      'consentRecorded', v_ai.gemini_consent_at IS NOT NULL,
      'paused', CASE WHEN v_settings.pause_code IS NULL THEN NULL ELSE jsonb_build_object('code', v_settings.pause_code,
        'byKind', v_settings.pause_by_kind, 'at', v_settings.paused_at,
        'reasonRu', platform_private.ai_autosend_reason_ru(v_settings.pause_code)) END,
      'window', platform_private.ai_autosend_window(v_settings, clock_timestamp()),
      'responsible', CASE WHEN v_settings.responsible_membership_id IS NULL THEN NULL
        ELSE jsonb_build_object('membershipId', v_settings.responsible_membership_id, 'name', v_responsible) END,
      'enabledAt', v_settings.enabled_at, 'sendErrorStreak', v_settings.send_error_streak,
      'geminiErrorStreak', v_settings.gemini_error_streak, 'shadowNights', v_nights, 'shadowNightsRequired', 3,
      'finalPhraseNow', platform_private.ai_autosend_final_phrase(v_settings, 'ru', clock_timestamp())),
    'lastSummary', CASE WHEN v_summary.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_summary.id,
      'intervalStart', v_summary.interval_start, 'intervalEnd', v_summary.interval_end,
      'shadowNight', v_summary.shadow_night, 'counts', v_summary.counts, 'status', v_summary.status) END,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id),
    'canSend', platform_private.staff_has_permission(p_organization_id, v_actor.membership_id,
      'communication.manual.send'),
    'version', v_settings.version);
END
$$;

-- Сохранить настройки (ai.agent.manage): любые поля, включая подтверждения
-- фраз и раскрытия. Включение, режим и пауза — отдельными командами.
-- PT409 при чужой версии; неверные значения — 22023; чат живого теста — чат
-- продаж, который сотрудник читает, а задаёт список только сотрудник с правом
-- отправлять в WhatsApp (42501) и только после трёх ночей проверки (PT412,
-- порядок §11: shadow, затем живой тест). Чаты, убранные из списка, теряют
-- ждущие автоответы живого теста.
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_save_v1(p_organization_id UUID, p_expected_version BIGINT,
  p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_autosend_settings;
  v_new platform_private.ai_autosend_settings; v_live UUID[]; v_days SMALLINT[]; v_removed UUID;
  v_int_keys CONSTANT TEXT[] := ARRAY['delayMinSeconds', 'delayMaxSeconds', 'limitChatHour', 'limitChatNight',
    'limitNumberHour'];
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB
    OR (p_patch - ARRAY['schedule', 'dateOverrides', 'workingDays', 'delayMinSeconds', 'delayMaxSeconds',
      'limitChatHour', 'limitChatNight', 'limitNumberHour', 'phrases', 'disclosureEnabled', 'disclosure',
      'liveTestConversationIds']) <> '{}'::JSONB
    OR EXISTS (SELECT 1 FROM jsonb_each(p_patch) e WHERE e.key = ANY (v_int_keys)
      AND (jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}') !~ '^[0-9]{1,4}$'))
    OR (p_patch ? 'disclosureEnabled' AND jsonb_typeof(p_patch -> 'disclosureEnabled') <> 'boolean')
    OR (p_patch ? 'workingDays' AND (jsonb_typeof(p_patch -> 'workingDays') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'workingDays') d
        WHERE jsonb_typeof(d) <> 'number' OR (d #>> '{}') !~ '^[1-7]$')))
    OR (p_patch ? 'liveTestConversationIds' AND (jsonb_typeof(p_patch -> 'liveTestConversationIds') <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'liveTestConversationIds') c
        WHERE jsonb_typeof(c) <> 'string'
          OR (c #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('expectedVersion', p_expected_version, 'patch', p_patch));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'autosend.save', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM platform_private.ai_autosend_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_autosend_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_patch ? 'workingDays' THEN
    SELECT COALESCE(array_agg(DISTINCT (d #>> '{}')::SMALLINT ORDER BY (d #>> '{}')::SMALLINT), '{}')
    INTO v_days FROM jsonb_array_elements(p_patch -> 'workingDays') d;
  END IF;
  IF p_patch ? 'liveTestConversationIds' THEN
    SELECT COALESCE(array_agg(DISTINCT (c #>> '{}')::UUID ORDER BY (c #>> '{}')::UUID), '{}')
    INTO v_live FROM jsonb_array_elements(p_patch -> 'liveTestConversationIds') c;
    IF cardinality(v_live) > 3 THEN
      RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023', DETAIL = 'liveTestConversationIds';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_live) x(id)
      WHERE NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, x.id)) THEN
      RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
    END IF;
    -- Чат живого теста отвечает по-настоящему ещё в shadow: список задаёт
    -- только тот, кто сам может отправлять в WhatsApp.
    IF cardinality(v_live) > 0 AND NOT platform_private.staff_has_permission(p_organization_id, v_actor.membership_id,
      'communication.manual.send') THEN
      RAISE EXCEPTION 'ai_autosend_sender_required' USING ERRCODE = '42501';
    END IF;
    -- Живой тест — только после трёх ночей проверки (ai_autosend_mode, 275,
    -- ещё раз проверяет это при каждом решении и авторизации).
    IF cardinality(v_live) > 0 AND platform_private.ai_autosend_shadow_nights(p_organization_id) < 3 THEN
      RAISE EXCEPTION 'ai_autosend_shadow_nights_required' USING ERRCODE = 'PT412';
    END IF;
  END IF;
  BEGIN
    UPDATE platform_private.ai_autosend_settings s SET
      schedule = COALESCE(p_patch -> 'schedule', s.schedule),
      date_overrides = COALESCE(p_patch -> 'dateOverrides', s.date_overrides),
      working_days = COALESCE(v_days, s.working_days),
      delay_min_s = COALESCE((p_patch ->> 'delayMinSeconds')::INTEGER, s.delay_min_s),
      delay_max_s = COALESCE((p_patch ->> 'delayMaxSeconds')::INTEGER, s.delay_max_s),
      limit_chat_hour = COALESCE((p_patch ->> 'limitChatHour')::INTEGER, s.limit_chat_hour),
      limit_chat_night = COALESCE((p_patch ->> 'limitChatNight')::INTEGER, s.limit_chat_night),
      limit_number_hour = COALESCE((p_patch ->> 'limitNumberHour')::INTEGER, s.limit_number_hour),
      phrases = COALESCE(p_patch -> 'phrases', s.phrases),
      disclosure_enabled = COALESCE((p_patch ->> 'disclosureEnabled')::BOOLEAN, s.disclosure_enabled),
      disclosure = COALESCE(p_patch -> 'disclosure', s.disclosure),
      live_test_conversation_ids = COALESCE(v_live, s.live_test_conversation_ids),
      version = s.version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END;
  FOR v_removed IN SELECT x.id FROM unnest(v_old.live_test_conversation_ids) x(id)
    WHERE NOT (x.id = ANY (v_new.live_test_conversation_ids)) ORDER BY 1 LOOP
    PERFORM platform_private.ai_autosend_cancel_pending(p_organization_id, v_removed, NULL, 'not_live_test',
      'live_test');
  END LOOP;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'autosend.save', v_fp,
    jsonb_build_object('status', 'saved', 'version', v_new.version,
      'settings', platform_private.ai_autosend_settings_json(v_new)),
    'ai.agent.autosend.save', 'organization', p_organization_id,
    jsonb_build_object('version', v_old.version, 'settings', platform_private.ai_autosend_settings_json(v_old)),
    'ИИ-агент: настройки автоответчика изменены');
END
$$;

-- Включить / выключить (ai.agent.manage). Включение — при записанном
-- согласии (PT412) и праве отправлять в WhatsApp (communication.manual.send,
-- 42501); ответственный — тот, кто включил; первое включение — «Проверка без
-- отправки». Выключение отменяет ждущие автоответы (scheduled и ещё не
-- взятые claim).
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_enable_v1(p_organization_id UUID, p_enabled BOOLEAN,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_operation TEXT; v_old platform_private.ai_autosend_settings;
  v_new platform_private.ai_autosend_settings; v_cancelled INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_operation := CASE WHEN p_enabled THEN 'autosend.enable' ELSE 'autosend.disable' END;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('enabled', p_enabled,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    v_operation, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM platform_private.ai_autosend_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_autosend_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_enabled THEN
    IF (platform_private.ai_settings_row(p_organization_id)).gemini_consent_at IS NULL THEN
      RAISE EXCEPTION 'ai_consent_required' USING ERRCODE = 'PT412';
    END IF;
    IF NOT platform_private.staff_has_permission(p_organization_id, v_actor.membership_id,
      'communication.manual.send') THEN
      RAISE EXCEPTION 'ai_autosend_sender_required' USING ERRCODE = '42501';
    END IF;
    UPDATE platform_private.ai_autosend_settings s SET enabled = TRUE,
      shadow_mode = CASE WHEN s.enabled_at IS NULL THEN TRUE ELSE s.shadow_mode END,
      responsible_membership_id = v_actor.membership_id, enabled_at = statement_timestamp(),
      enabled_by = v_actor.membership_id, version = s.version + 1, updated_at = statement_timestamp(),
      updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  ELSE
    UPDATE platform_private.ai_autosend_settings s SET enabled = FALSE, version = s.version + 1,
      updated_at = statement_timestamp(), updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
    v_cancelled := platform_private.ai_autosend_cancel_pending(p_organization_id, NULL, NULL, 'disabled');
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, v_operation, v_fp,
    jsonb_build_object('status', 'applied', 'enabled', v_new.enabled, 'shadowMode', v_new.shadow_mode,
      'responsibleMembershipId', v_new.responsible_membership_id, 'version', v_new.version, 'cancelled', v_cancelled),
    'ai.agent.' || v_operation, 'organization', p_organization_id,
    jsonb_build_object('enabled', v_old.enabled, 'shadowMode', v_old.shadow_mode,
      'responsibleMembershipId', v_old.responsible_membership_id, 'version', v_old.version),
    CASE WHEN p_enabled THEN 'ИИ-агент: автоответчик включён' ELSE 'ИИ-агент: автоответчик выключен' END);
END
$$;

-- «Проверка без отправки» / «Отвечает» (ai.agent.manage). Живой режим —
-- только после трёх ночей проверки, с подтверждёнными RU-фразами и
-- (если включена) RU-строкой-раскрытием, без паузы и с правом отправлять
-- (PT412 / 42501). Возврат в shadow отменяет ждущие живые автоответы
-- (scheduled и ещё не взятые claim).
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_shadow_v1(p_organization_id UUID, p_shadow BOOLEAN,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_operation TEXT; v_old platform_private.ai_autosend_settings;
  v_new platform_private.ai_autosend_settings; v_cancelled INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_shadow IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_operation := CASE WHEN p_shadow THEN 'autosend.shadow' ELSE 'autosend.live' END;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('shadow', p_shadow, 'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    v_operation, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM platform_private.ai_autosend_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_autosend_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF NOT p_shadow THEN
    IF NOT platform_private.staff_has_permission(p_organization_id, v_actor.membership_id,
      'communication.manual.send') THEN
      RAISE EXCEPTION 'ai_autosend_sender_required' USING ERRCODE = '42501';
    END IF;
    IF v_old.pause_code IS NOT NULL THEN
      RAISE EXCEPTION 'ai_autosend_paused' USING ERRCODE = 'PT412';
    END IF;
    IF platform_private.ai_autosend_shadow_nights(p_organization_id) < 3 THEN
      RAISE EXCEPTION 'ai_autosend_shadow_nights_required' USING ERRCODE = 'PT412';
    END IF;
    IF NOT COALESCE((v_old.phrases -> 'ru' -> 'tomorrow' ->> 'confirmed')::BOOLEAN, FALSE)
      OR NOT COALESCE((v_old.phrases -> 'ru' -> 'day' ->> 'confirmed')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'ai_autosend_phrase_unconfirmed' USING ERRCODE = 'PT412';
    END IF;
    IF v_old.disclosure_enabled AND NOT COALESCE((v_old.disclosure -> 'ru' ->> 'confirmed')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION 'ai_autosend_disclosure_unconfirmed' USING ERRCODE = 'PT412';
    END IF;
  END IF;
  UPDATE platform_private.ai_autosend_settings s SET shadow_mode = p_shadow, version = s.version + 1,
    updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  IF p_shadow THEN
    v_cancelled := platform_private.ai_autosend_cancel_pending(p_organization_id, NULL, NULL, 'shadow_mode', 'live');
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, v_operation, v_fp,
    jsonb_build_object('status', 'applied', 'shadowMode', v_new.shadow_mode, 'version', v_new.version,
      'cancelled', v_cancelled),
    'ai.agent.' || v_operation, 'organization', p_organization_id,
    jsonb_build_object('shadowMode', v_old.shadow_mode, 'version', v_old.version),
    CASE WHEN p_shadow THEN 'ИИ-агент: автоответчик в режиме «Проверка без отправки»'
      ELSE 'ИИ-агент: автоответчик отвечает клиентам' END);
END
$$;

-- Поставить или снять паузу (ai.agent.manage, только человек). Снятие
-- обнуляет счётчики ошибок; постановка отменяет ждущие автоответы (scheduled
-- и ещё не взятые claim) — выключатель срабатывает сразу.
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_pause_v1(p_organization_id UUID, p_action TEXT,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_autosend_settings;
  v_new platform_private.ai_autosend_settings; v_cancelled INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume') THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('action', p_action, 'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'autosend.' || p_action, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM platform_private.ai_autosend_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_autosend_settings s
  WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_autosend_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_action = 'pause' THEN
    UPDATE platform_private.ai_autosend_settings s SET pause_code = COALESCE(s.pause_code, 'manual'),
      pause_by_kind = COALESCE(s.pause_by_kind, 'user'), paused_at = COALESCE(s.paused_at, clock_timestamp()),
      paused_by = CASE WHEN s.pause_code IS NULL THEN v_actor.membership_id ELSE s.paused_by END,
      version = s.version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
    v_cancelled := platform_private.ai_autosend_cancel_pending(p_organization_id, NULL, NULL, 'paused');
  ELSE
    UPDATE platform_private.ai_autosend_settings s SET pause_code = NULL, pause_by_kind = NULL, paused_at = NULL,
      paused_by = NULL, send_error_streak = 0, gemini_error_streak = 0, version = s.version + 1,
      updated_at = statement_timestamp(), updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'autosend.' || p_action, v_fp,
    jsonb_build_object('status', 'applied', 'pauseCode', v_new.pause_code, 'version', v_new.version,
      'cancelled', v_cancelled),
    'ai.agent.autosend.' || p_action, 'organization', p_organization_id,
    jsonb_build_object('pauseCode', v_old.pause_code, 'pauseByKind', v_old.pause_by_kind,
      'sendErrorStreak', v_old.send_error_streak, 'geminiErrorStreak', v_old.gemini_error_streak,
      'version', v_old.version),
    CASE WHEN p_action = 'pause' THEN 'ИИ-агент: автоответчик поставлен на паузу'
      ELSE 'ИИ-агент: пауза автоответчика снята' END);
END
$$;

-- «Автоответчик в этом чате» (ai.agent.use + чтение чата продаж, Q9):
-- исключение чата; выключение отменяет его ждущие автоответы (scheduled и
-- ещё не взятые claim).
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_exclusion_v1(p_organization_id UUID, p_conversation_id UUID,
  p_excluded BOOLEAN, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_was BOOLEAN; v_cancelled INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_excluded IS NULL THEN
    RAISE EXCEPTION 'ai_autosend_settings_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('conversationId', p_conversation_id, 'excluded', p_excluded));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'autosend.exclusion', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_autosend_claim_lock(p_organization_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_autosend:' || p_conversation_id::TEXT, 275));
  v_was := EXISTS (SELECT 1 FROM platform_private.ai_autosend_exclusions x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = p_conversation_id);
  IF p_excluded THEN
    INSERT INTO platform_private.ai_autosend_exclusions (conversation_id, organization_id, created_by)
    VALUES (p_conversation_id, p_organization_id, v_actor.membership_id) ON CONFLICT (conversation_id) DO NOTHING;
    v_cancelled := platform_private.ai_autosend_cancel_pending(p_organization_id, p_conversation_id, NULL, 'excluded');
  ELSE
    DELETE FROM platform_private.ai_autosend_exclusions x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = p_conversation_id;
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'autosend.exclusion', v_fp,
    jsonb_build_object('status', 'applied', 'conversationId', p_conversation_id, 'excluded', p_excluded,
      'cancelled', v_cancelled),
    'ai.agent.autosend.exclusion', 'communication_conversation', p_conversation_id,
    jsonb_build_object('excluded', v_was),
    CASE WHEN p_excluded THEN 'ИИ-агент: автоответчик выключен в чате'
      ELSE 'ИИ-агент: автоответчик включён в чате' END);
END
$$;

-- Состояние автоответчика в одном чате (окно ИИ): исключён ли, режим для
-- чата, пауза, внутри ли окна, сказана ли финальная фраза в этом интервале,
-- последнее решение (без текста).
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_conversation_v1(p_organization_id UUID, p_conversation_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_autosend_settings; v_window JSONB;
  v_last platform_private.ai_autosend_log;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_autosend_settings_row(p_organization_id);
  v_window := platform_private.ai_autosend_window(v_settings, clock_timestamp());
  SELECT * INTO v_last FROM platform_private.ai_autosend_log l
  WHERE l.organization_id = p_organization_id AND l.conversation_id = p_conversation_id
  ORDER BY l.created_at DESC, l.id DESC LIMIT 1;
  RETURN jsonb_build_object('conversationId', p_conversation_id, 'enabled', v_settings.enabled,
    'mode', platform_private.ai_autosend_mode(v_settings, p_conversation_id),
    'paused', v_settings.pause_code IS NOT NULL, 'pauseCode', v_settings.pause_code,
    'inside', (v_window ->> 'inside')::BOOLEAN, 'window', v_window,
    'excluded', EXISTS (SELECT 1 FROM platform_private.ai_autosend_exclusions x
      WHERE x.organization_id = p_organization_id AND x.conversation_id = p_conversation_id),
    'handedOff', (v_window ->> 'inside')::BOOLEAN AND EXISTS (SELECT 1 FROM platform_private.ai_autosend_log l
      WHERE l.organization_id = p_organization_id AND l.conversation_id = p_conversation_id
        AND l.interval_start = (v_window ->> 'intervalStart')::TIMESTAMPTZ AND l.kind = 'final_phrase'
        AND l.status IN ('scheduled', 'authorized', 'sent', 'unknown', 'shadow')),
    'lastDecision', CASE WHEN v_last.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_last.id,
      'status', v_last.status, 'mode', v_last.mode, 'kind', v_last.kind, 'reasonCode', v_last.reason_code,
      'reasonRu', v_last.reason_ru, 'createdAt', v_last.created_at, 'sendAt', v_last.send_at) END);
END
$$;

-- Журнал решений (ai.agent.use): фильтры status, conversationId,
-- intervalStart; страница по (created_at, id) убыванию, до 100. Текст ответа
-- и квалификация — только для чатов, которые сотрудник читает
-- (communication.read.full); иначе textHidden.
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_log_v1(p_organization_id UUID, p_query JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_limit INTEGER; v_status TEXT; v_conversation UUID; v_interval TIMESTAMPTZ;
  v_before_at TIMESTAMPTZ; v_before_id UUID; v_items JSONB; v_count INTEGER; v_last JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object'
    OR (p_query - ARRAY['status', 'conversationId', 'intervalStart', 'limit', 'beforeCreatedAt', 'beforeId']) <> '{}'::JSONB
    OR (p_query ? 'status' AND (p_query ->> 'status') NOT IN ('considering', 'scheduled', 'authorized', 'sent',
      'failed', 'unknown', 'skipped', 'shadow', 'cancelled'))
    OR (p_query ? 'limit' AND (jsonb_typeof(p_query -> 'limit') <> 'number' OR (p_query ->> 'limit') !~ '^[0-9]{1,3}$'))
    OR (p_query ? 'conversationId'
      AND (p_query ->> 'conversationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR (p_query ? 'beforeId'
      AND (p_query ->> 'beforeId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ((p_query ? 'beforeCreatedAt') <> (p_query ? 'beforeId')) THEN
    RAISE EXCEPTION 'ai_autosend_query_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_limit := COALESCE((p_query ->> 'limit')::INTEGER, 50);
    v_status := p_query ->> 'status';
    v_conversation := (p_query ->> 'conversationId')::UUID;
    v_interval := (p_query ->> 'intervalStart')::TIMESTAMPTZ;
    v_before_at := (p_query ->> 'beforeCreatedAt')::TIMESTAMPTZ;
    v_before_id := (p_query ->> 'beforeId')::UUID;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
    RAISE EXCEPTION 'ai_autosend_query_invalid' USING ERRCODE = '22023';
  END;
  IF v_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ai_autosend_query_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(platform_private.ai_autosend_log_json(x.l,
      platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'communication.read.full',
        'conversation', (x.l).conversation_id)) ORDER BY (x.l).created_at DESC, (x.l).id DESC), '[]'::JSONB),
    count(*)::INTEGER
  INTO v_items, v_count
  FROM (SELECT l FROM platform_private.ai_autosend_log l
    WHERE l.organization_id = p_organization_id
      AND (v_status IS NULL OR l.status = v_status)
      AND (v_conversation IS NULL OR l.conversation_id = v_conversation)
      AND (v_interval IS NULL OR l.interval_start = v_interval)
      AND (v_before_at IS NULL OR (l.created_at, l.id) < (v_before_at, v_before_id))
    ORDER BY l.created_at DESC, l.id DESC LIMIT v_limit) x;
  v_last := v_items -> -1;
  RETURN jsonb_build_object('items', v_items,
    'next', CASE WHEN v_count = v_limit THEN jsonb_build_object('beforeCreatedAt', v_last -> 'createdAt',
      'beforeId', v_last -> 'id') END);
END
$$;

-- Утренняя сводка (ai.agent.use): по ID или последняя. По чатам — счётчики
-- и причины; квалификация, день звонка и задача — только для чатов, которые
-- сотрудник читает (иначе hidden).
CREATE OR REPLACE FUNCTION platform.ai_agent_autosend_summary_v1(p_organization_id UUID, p_summary_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_summary platform_private.ai_autosend_summaries; v_items JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  SELECT * INTO v_summary FROM platform_private.ai_autosend_summaries s
  WHERE s.organization_id = p_organization_id AND (p_summary_id IS NULL OR s.id = p_summary_id)
  ORDER BY s.interval_start DESC, s.id DESC LIMIT 1;
  IF NOT FOUND THEN
    IF p_summary_id IS NOT NULL THEN
      RAISE EXCEPTION 'ai_autosend_summary_unknown' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('summary', NULL, 'shadowNights', 0);
  END IF;
  SELECT COALESCE(jsonb_agg(CASE WHEN platform_private.staff_can_access(p_organization_id, v_actor.membership_id,
        'communication.read.full', 'conversation', (e ->> 'conversationId')::UUID)
      THEN e || jsonb_build_object('hidden', FALSE)
      ELSE jsonb_build_object('hidden', TRUE, 'considered', e -> 'considered', 'answered', e -> 'answered',
        'finalPhrase', e -> 'finalPhrase', 'statuses', e -> 'statuses', 'reasons', e -> 'reasons') END ORDER BY o),
    '[]'::JSONB)
  INTO v_items FROM jsonb_array_elements(v_summary.items) WITH ORDINALITY AS a(e, o);
  RETURN jsonb_build_object('summary', jsonb_build_object('id', v_summary.id, 'intervalStart', v_summary.interval_start,
      'intervalEnd', v_summary.interval_end, 'shadowNight', v_summary.shadow_night, 'counts', v_summary.counts,
      'status', v_summary.status, 'items', v_items),
    'shadowNights', platform_private.ai_autosend_shadow_nights(p_organization_id));
END
$$;

-- ===========================================================================
-- Гранты и состав функций (как 274, расширено).
-- ===========================================================================
DO $ai277_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%\_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', f,
      CASE WHEN f = 'platform.ai_agent_storage_authorize_v1(uuid,uuid,text,text,text)'::REGPROCEDURE
        THEN 'service_role' ELSE 'authenticated' END);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_autosend\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_ai_agent' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO evo_ai_agent', f);
  END LOOP;
END
$ai277_acl$;

DO $ai277_inventory$
DECLARE v_staff TEXT[]; v_agent TEXT[]; v_service TEXT[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_staff FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_agent FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_ai_agent';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_service FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_autosend\_%';
  IF v_staff IS DISTINCT FROM ARRAY['ai_agent_answer_current_v1', 'ai_agent_answer_insert_v1',
      'ai_agent_autosend_conversation_v1', 'ai_agent_autosend_enable_v1', 'ai_agent_autosend_exclusion_v1',
      'ai_agent_autosend_log_v1', 'ai_agent_autosend_pause_v1', 'ai_agent_autosend_save_v1',
      'ai_agent_autosend_shadow_v1', 'ai_agent_autosend_summary_v1', 'ai_agent_autosend_v1',
      'ai_agent_consent_record_v1', 'ai_agent_document_confirm_company_v1', 'ai_agent_document_delete_v1',
      'ai_agent_document_page_v1', 'ai_agent_document_retry_v1', 'ai_agent_document_update_v1',
      'ai_agent_document_upload_v1', 'ai_agent_document_v1', 'ai_agent_documents_v1', 'ai_agent_example_delete_v1',
      'ai_agent_examples_v1', 'ai_agent_lab_discard_v1', 'ai_agent_lab_reject_v1', 'ai_agent_lab_v1',
      'ai_agent_memory_clear_v1', 'ai_agent_memory_toggle_v1', 'ai_agent_memory_v1',
      'ai_agent_review_resolve_v1', 'ai_agent_review_v1', 'ai_agent_rules_confirm_v1', 'ai_agent_rules_save_v1',
      'ai_agent_rules_v1', 'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1', 'ai_agent_settings_v1',
      'ai_agent_spend_v1', 'ai_agent_storage_authorize_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'autosend_commit_v1', 'autosend_context_v1', 'autosend_due_v1', 'autosend_pause_v1', 'autosend_search_v1',
      'autosend_summary_context_v1', 'autosend_summary_due_v1', 'autosend_summary_put_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1',
      'document_content_put_v1', 'document_index_v1', 'document_pages_put_v1', 'document_reindex_claim_v1',
      'document_reindex_v1', 'document_stage_v1', 'inbound_since_v1', 'lab_apply_prepare_v1', 'lab_apply_v1',
      'lab_documents_v1', 'lab_proposal_put_v1', 'lab_session_get_v1', 'lab_session_put_v1', 'maintenance_v1',
      'memory_context_v1', 'memory_due_v1', 'memory_put_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1',
      'review_items_put_v1', 'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1',
      'work_finish_v1']
    OR v_service IS DISTINCT FROM ARRAY['ai_autosend_authorize_v1', 'ai_autosend_record_v1'] THEN
    RAISE EXCEPTION 'ai_agent_function_inventory_drift' USING ERRCODE = '55000',
      DETAIL = format('staff=%s agent=%s service=%s', v_staff, v_agent, v_service);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform_ai_agent'
        OR (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agent\_%' OR p.proname LIKE 'ai\_autosend\_%')))
      AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig))))
  THEN
    RAISE EXCEPTION 'ai_agent_function_not_hardened' USING ERRCODE = '55000';
  END IF;
  -- Отправку авторизует и записывает только сервер CRM.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_autosend\_%'
      AND (NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
        OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)))
  THEN
    RAISE EXCEPTION 'ai_autosend_service_acl_drift' USING ERRCODE = '55000';
  END IF;
END
$ai277_inventory$;

COMMENT ON FUNCTION platform_ai_agent.autosend_commit_v1(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT[], TEXT, JSONB, TEXT) IS
  'AI agent P4: the agent''s decision under its lease; the database checks the commit column of plan §11 and stores the text and its SHA-256 (live → scheduled + delayed pointer, shadow → shadow, otherwise skipped). Sends nothing.';
COMMENT ON FUNCTION platform_ai_agent.inbound_since_v1(TIMESTAMPTZ, UUID, INTEGER) IS
  'AI agent P3/P4: inbound message pointers (no text) of sales conversations of organizations with memory or the autoresponder on; orgs says which gate is open; next never passes now - 5 min except on a full page.';

NOTIFY pgrst, 'reload schema';
COMMIT;
