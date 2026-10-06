-- 274_platform_ai_agent_memory — «ИИ-агент» P3: память о клиенте (интерес и
-- сводка длинной переписки) и медиа в контексте. Контракт:
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §5.2–5.4, §6.1, §6.5, §9, §10, §12.1,
-- §13 (Q9: всё может каждый сотрудник с правом; Q12: согласие на Gemini
-- записывает только admin), §15 P3; docs/PLAN_CHANGES.md (06.10, P3).
--
-- Что делает:
--  * platform_private.ai_client_memory — одна строка на диалог продаж:
--    interest (≤ 140, одна строка), summary (≤ 1500), граница покрытия
--    covered_message_id/covered_count, для какого входящего и когда посчитан
--    интерес, модель, версия, отметка «указатель в очереди», аренда воркера.
--    RLS ENABLE + FORCE без политик, права отозваны у всех ролей API и у
--    evo_ai_agent. Внешний ключ (organization_id, conversation_id) на
--    communication_conversations (ON DELETE CASCADE);
--  * помощники без грантов: ai_memory_gate, ai_dialog_messages (все чтения
--    ТЕКСТА сообщений агентом; ID и направление читают напрямую
--    inbound_since_v1, ai_latest_inbound/ai_latest_outbound 269, проверка
--    ref_id в ai_agent_ticket_v1 273 и последнее направление в
--    ai_agent_answer_current_v1 270 — будущий фильтр отозванных сообщений
--    должен покрыть и их), ai_message_view (пометки 259/060/061 → виды
--    медиа, в text — только подпись, без имён файлов), ai_lead_card (карточка
--    269 без заглушки «WhatsApp …»), ai_memory_state, ai_memory_enqueue,
--    ai_memory_text_ok, ai_memory_poke;
--  * агент (platform_ai_agent, только evo_ai_agent, без билета; организация —
--    из строки диалога; текст — только диалогов продаж организаций с
--    включённой памятью и записанным согласием): inbound_since_v1,
--    memory_due_v1, memory_context_v1, memory_put_v1;
--  * сотрудники (platform, authenticated): ai_agent_memory_v1,
--    ai_agent_memory_clear_v1, ai_agent_memory_toggle_v1;
--  * conversation_context_v1, maintenance_v1 и ai_agent_consent_record_v1
--    (отзыв согласия выключает память и удаляет её) заменяются с прежними
--    сигнатурами.
--
-- Память поставляется выключенной (memory_enabled = false в 267); включение —
-- отдельное разрешение владельца. Удаления сообщений не отслеживаются
-- (сообщения только добавляются, 044; WAHA revoked отбрасывается на входе),
-- поэтому исключать пока нечего (PLAN_CHANGES 06.10, P3).
--
-- Безопасно для production: новая таблица и функции; данные сообщений, WAHA и
-- диалогов не меняются. Внешний ключ добавляет к communication_conversations
-- системные RI-триггеры и до конца транзакции миграции держит на ней SHARE
-- ROW EXCLUSIVE (запись диалогов ждёт; проверка мгновенная — таблица памяти
-- новая и пустая). Повторный запуск в той же точке цепочки ничего не меняет;
-- устаревший повтор 273 после 274 отклоняется его инвентарём функций.
BEGIN;

DO $ai274_preconditions$
BEGIN
  IF to_regclass('platform_private.ai_lab_proposals') IS NULL
    OR to_regprocedure('platform_ai_agent.lab_apply_v1(uuid,text,text,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_p3_requires_273' USING ERRCODE = '55000';
  END IF;
END
$ai274_preconditions$;

-- ---------------------------------------------------------------------------
-- Таблица памяти.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_private.ai_client_memory (
  conversation_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  interest TEXT CHECK (interest IS NULL OR (char_length(interest) BETWEEN 1 AND 140
    AND interest = btrim(interest) AND interest !~ '[[:cntrl:]]')),
  summary TEXT CHECK (summary IS NULL OR (char_length(summary) BETWEEN 1 AND 1500 AND btrim(summary) <> '')),
  covered_message_id UUID,
  covered_count INTEGER NOT NULL DEFAULT 0 CHECK (covered_count >= 0),
  interest_message_id UUID,
  interest_updated_at TIMESTAMPTZ,
  model TEXT CHECK (model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  enqueued_at TIMESTAMPTZ,
  lease_owner TEXT CHECK (char_length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_client_memory_conversation_fkey FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_client_memory_covered_check CHECK ((covered_message_id IS NULL) = (covered_count = 0)),
  CONSTRAINT ai_client_memory_summary_covered_check CHECK (summary IS NULL OR covered_message_id IS NOT NULL),
  CONSTRAINT ai_client_memory_interest_pair_check CHECK ((interest_message_id IS NULL) = (interest_updated_at IS NULL)
    AND (interest IS NULL OR interest_message_id IS NOT NULL)),
  CONSTRAINT ai_client_memory_lease_check CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ai_client_memory_org_idx ON platform_private.ai_client_memory (organization_id);
COMMENT ON TABLE platform_private.ai_client_memory IS
  'AI agent P3: client memory of one sales conversation (interest <= 140, summary <= 1500 of the messages that left the 20-message window). Model-written data, never instructions; only through the platform_ai_agent / platform.ai_agent_memory_* functions.';

DO $ai274_lockdown$
BEGIN
  ALTER TABLE platform_private.ai_client_memory ENABLE ROW LEVEL SECURITY;
  ALTER TABLE platform_private.ai_client_memory FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE platform_private.ai_client_memory
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'platform_private' AND tablename = 'ai_client_memory') THEN
    RAISE EXCEPTION 'ai_agent_table_has_policies: ai_client_memory' USING ERRCODE = '55000';
  END IF;
END
$ai274_lockdown$;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- Память включена, согласие на Gemini записано, организация активна.
CREATE OR REPLACE FUNCTION platform_private.ai_memory_gate(p_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT s.memory_enabled AND s.gemini_consent_at IS NOT NULL
    FROM platform_private.ai_settings s JOIN platform.organizations o ON o.id = s.organization_id
    WHERE s.organization_id = p_organization_id AND o.status = 'active'), FALSE)
$$;

-- Сообщения диалога, текст которых видит агент: все чтения текста идут через
-- этот помощник. Чтения только ID и направления (inbound_since_v1,
-- ai_latest_inbound/ai_latest_outbound, ai_agent_ticket_v1,
-- ai_agent_answer_current_v1) идут мимо него: будущий фильтр отозванных
-- сообщений добавляется здесь И в них.
CREATE OR REPLACE FUNCTION platform_private.ai_dialog_messages(p_organization_id UUID, p_conversation_id UUID)
RETURNS SETOF platform.communication_messages LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.* FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
$$;

-- Сообщение для модели: {messageId, direction, role, at, text, media[]}.
-- Пометка 259 «📎 <Вид>[: <имя>] — откройте в WhatsApp продаж» (подпись — со
-- следующей строки) и общие пометки 060 (входящее) и 061 (историческое
-- исходящее) превращаются в вид медиа
-- photo|video|voice|audio|sticker|file|unknown; в text остаётся только подпись.
-- Имена файлов, MIME, размеры и пути не выдаются. Строки 062 (если есть)
-- задают виды: image → photo, pdf → file.
CREATE OR REPLACE FUNCTION platform_private.ai_message_view(p_message platform.communication_messages)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('messageId', p_message.id, 'direction', p_message.direction::TEXT,
    'role', CASE WHEN p_message.direction = 'inbound' THEN 'client' ELSE 'staff' END,
    'at', p_message.created_at,
    'text', CASE WHEN x.legacy THEN NULL WHEN x.marker IS NOT NULL THEN x.caption ELSE p_message.body_text END,
    'media', COALESCE(x.media_rows,
      CASE WHEN x.legacy THEN jsonb_build_array(jsonb_build_object('kind', 'unknown'))
        WHEN x.marker IS NOT NULL THEN jsonb_build_array(jsonb_build_object('kind', CASE x.marker
          WHEN 'Фото' THEN 'photo' WHEN 'Видео' THEN 'video' WHEN 'Голосовое сообщение' THEN 'voice'
          WHEN 'Аудио' THEN 'audio' WHEN 'Стикер' THEN 'sticker' ELSE 'file' END)) END,
      '[]'::JSONB))
  FROM (SELECT
      btrim(p_message.body_text) IN (
        '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.',
        '[Системное уведомление] Историческое исходящее медиа или сообщение без текста. Требуется загрузка медиа.')
        AS legacy,
      substring(p_message.body_text FROM
        '^📎 (Фото|Видео|Голосовое сообщение|Аудио|Стикер|Файл)(?:: [^\n]*)? — откройте в WhatsApp продаж(?:\n|$)')
        AS marker,
      NULLIF(btrim(substring(p_message.body_text FROM '^[^\n]*\n(.*)$')), '') AS caption,
      (SELECT jsonb_agg(jsonb_build_object('kind', CASE md.media_kind::TEXT WHEN 'image' THEN 'photo'
          WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio' ELSE 'file' END) ORDER BY md.ordinal, md.id)
        FROM platform.communication_message_media md
        WHERE md.organization_id = p_message.organization_id AND md.communication_message_id = p_message.id)
        AS media_rows) x
$$;

-- Минимальная карточка лида (269): первое слово имени (не похожее на номер
-- или адрес и не заглушка цепочки WAHA «WhatsApp ••••NNNN» / «WhatsApp
-- контакт #…» — тогда имени нет), интерес к стране, этап. Без телефона,
-- email и документов.
CREATE OR REPLACE FUNCTION platform_private.ai_lead_card(p_organization_id UUID, p_conversation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('name', CASE WHEN n.first ~ '[0-9@+#•]' OR lower(n.first) = 'whatsapp' THEN NULL
      ELSE NULLIF(n.first, '') END,
      'interestDirection', l.interest_direction, 'stage', l.stage_key)
  FROM platform.communication_conversations c
  JOIN platform.leads l ON l.organization_id = c.organization_id AND l.id = c.canonical_lead_id
  LEFT JOIN platform.clients cl ON cl.organization_id = l.organization_id AND cl.id = l.client_id
  CROSS JOIN LATERAL (SELECT split_part(btrim(cl.display_name), ' ', 1) AS first) n
  WHERE c.organization_id = p_organization_id AND c.id = p_conversation_id
$$;

-- Состояние памяти диалога (§9). Окно — последние 20 по (created_at DESC,
-- id DESC). Покрытие согласовано, если covered_count = числу сообщений до
-- границы включительно; иначе rebuild (импорт истории вставил более ранние):
-- прежняя сводка не учитывается, покрытие с нуля. Сводка нужна, когда
-- сообщений > 20 и непокрытых за окном ≥ 6 (или rebuild); интерес — когда
-- последнее входящее не то, по которому он посчитан; задержка интереса —
-- 60 с минус возраст interest_updated_at. NULL — диалога нет.
CREATE OR REPLACE FUNCTION platform_private.ai_memory_state(p_conversation_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID; v_queue TEXT; v_memory platform_private.ai_client_memory; v_has_row BOOLEAN;
  v_b_at TIMESTAMPTZ; v_b_id UUID; v_total INTEGER; v_upto INTEGER; v_latest UUID; v_rebuild BOOLEAN;
  v_covered INTEGER; v_outside INTEGER; v_uncovered INTEGER; v_summary_due BOOLEAN; v_interest_due BOOLEAN;
  v_delay INTEGER := 0;
BEGIN
  SELECT c.organization_id, c.queue::TEXT INTO v_org, v_queue
  FROM platform.communication_conversations c WHERE c.id = p_conversation_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_memory FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id;
  v_has_row := FOUND;
  IF v_memory.covered_message_id IS NOT NULL THEN
    SELECT m.created_at, m.id INTO v_b_at, v_b_id
    FROM platform_private.ai_dialog_messages(v_org, p_conversation_id) m WHERE m.id = v_memory.covered_message_id;
  END IF;
  -- Одно чтение (один снимок): число, покрытие и последнее входящее.
  SELECT count(*)::INTEGER, (count(*) FILTER (WHERE v_b_id IS NOT NULL AND (m.created_at, m.id) <= (v_b_at, v_b_id)))::INTEGER,
    (array_agg(m.id ORDER BY m.created_at DESC, m.id DESC) FILTER (WHERE m.direction = 'inbound'))[1]
  INTO v_total, v_upto, v_latest
  FROM platform_private.ai_dialog_messages(v_org, p_conversation_id) m;
  v_rebuild := COALESCE(v_memory.covered_count, 0) > 0 AND (v_b_id IS NULL OR v_upto <> v_memory.covered_count);
  v_covered := CASE WHEN v_rebuild THEN 0 ELSE COALESCE(v_memory.covered_count, 0) END;
  v_outside := greatest(v_total - 20, 0);
  v_uncovered := greatest(v_outside - v_covered, 0);
  v_summary_due := v_total > 20 AND (v_rebuild OR v_uncovered >= 6);
  v_interest_due := v_latest IS NOT NULL AND v_latest IS DISTINCT FROM v_memory.interest_message_id;
  IF v_interest_due AND v_memory.interest_updated_at IS NOT NULL THEN
    v_delay := greatest(0, ceil(60 - extract(epoch FROM clock_timestamp() - v_memory.interest_updated_at)))::INTEGER;
  END IF;
  RETURN jsonb_build_object('conversationId', p_conversation_id, 'organizationId', v_org, 'queue', v_queue,
    'hasRow', v_has_row, 'total', v_total, 'outside', v_outside, 'coveredCount', v_covered,
    'storedCoveredCount', COALESCE(v_memory.covered_count, 0), 'rebuild', v_rebuild, 'uncovered', v_uncovered,
    'summaryDue', v_summary_due, 'interestDue', v_interest_due, 'latestInboundId', v_latest,
    'interestDelaySeconds', v_delay, 'due', v_summary_due OR v_interest_due,
    'delaySeconds', CASE WHEN v_interest_due THEN v_delay ELSE 0 END);
END
$$;

-- Указатель {v:1, kind:'memory', ref_id} в очередь агента с задержкой и
-- отметка enqueued_at (строка создаётся при первом указателе).
CREATE OR REPLACE FUNCTION platform_private.ai_memory_enqueue(p_conversation_id UUID, p_delay_seconds INTEGER)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID; v_msg_id BIGINT;
BEGIN
  SELECT c.organization_id INTO v_org FROM platform.communication_conversations c WHERE c.id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_conversation_gone' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO platform_private.ai_client_memory AS m (conversation_id, organization_id, enqueued_at)
  VALUES (p_conversation_id, v_org, clock_timestamp())
  ON CONFLICT (conversation_id) DO UPDATE SET enqueued_at = clock_timestamp();
  SELECT pgmq.send('ai_agent_work_v1', jsonb_build_object('v', 1, 'kind', 'memory', 'ref_id', p_conversation_id),
    least(3600, greatest(0, COALESCE(p_delay_seconds, 0))))
  INTO v_msg_id;
  RETURN v_msg_id;
END
$$;

-- Текст памяти без e-mail и номеров (9+ цифр, между ними — до двух знаков из
-- пробела, скобок, точки и дефиса: «+996 (555) 12-34-56», «0555.12.34.56»;
-- 14-значный ПИН тоже). Тот же шаблон — у PHONE_RE приватного сервиса.
-- NULL — допустим.
CREATE OR REPLACE FUNCTION platform_private.ai_memory_text_ok(p_text TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_text IS NULL OR (p_text !~ '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
    AND p_text !~ '\+?\d([ ().-]{0,2}\d){8,}')
$$;

-- Поставить указатель памяти диалога, если он нужен (p_summary_only — только
-- когда нужна сводка) и не стоит в очереди 10 минут и не в работе; задержка —
-- не меньше p_min_delay_seconds. Блокировки: advisory диалога, затем строка
-- памяти (вызывающие, которые берут несколько, — по возрастанию ID). Ворота
-- памяти проверяет вызывающий. {conversationId, status
-- skipped|not_due|pending|enqueued[, delaySeconds]}.
CREATE OR REPLACE FUNCTION platform_private.ai_memory_poke(p_conversation_id UUID, p_summary_only BOOLEAN,
  p_min_delay_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_queue TEXT; v_memory platform_private.ai_client_memory; v_state JSONB; v_delay INTEGER;
BEGIN
  SELECT c.queue::TEXT INTO v_queue FROM platform.communication_conversations c WHERE c.id = p_conversation_id;
  IF NOT FOUND OR v_queue <> 'sales' THEN
    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'skipped');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_memory:' || p_conversation_id::TEXT, 274));
  SELECT * INTO v_memory FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id FOR UPDATE;
  v_state := platform_private.ai_memory_state(p_conversation_id);
  IF NOT (v_state ->> CASE WHEN p_summary_only THEN 'summaryDue' ELSE 'due' END)::BOOLEAN THEN
    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'not_due');
  END IF;
  IF v_memory.enqueued_at > clock_timestamp() - INTERVAL '10 minutes'
    OR v_memory.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'pending');
  END IF;
  v_delay := least(3600, greatest((v_state ->> 'delaySeconds')::INTEGER, COALESCE(p_min_delay_seconds, 0)));
  PERFORM platform_private.ai_memory_enqueue(p_conversation_id, v_delay);
  RETURN jsonb_build_object('conversationId', p_conversation_id, 'status', 'enqueued', 'delaySeconds', v_delay);
END
$$;

DO $ai274_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_memory_gate', 'ai_dialog_messages', 'ai_message_view',
      'ai_lead_card', 'ai_memory_state', 'ai_memory_enqueue', 'ai_memory_text_ok', 'ai_memory_poke') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai274_private_acl$;

-- ===========================================================================
-- Сотрудники (platform, authenticated).
-- ===========================================================================

-- «Что ИИ знает о клиенте»: состояние памяти диалога продаж, сводка и
-- интерес (только пока память включена и согласие записано) и карточка лида,
-- прочитанная живьём, — ровно то, что видит модель. Без вызова Gemini.
CREATE OR REPLACE FUNCTION platform.ai_agent_memory_v1(p_organization_id UUID, p_conversation_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_gate BOOLEAN; v_state JSONB;
  v_memory platform_private.ai_client_memory;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  v_gate := platform_private.ai_memory_gate(p_organization_id);
  v_state := platform_private.ai_memory_state(p_conversation_id);
  IF v_gate THEN
    SELECT * INTO v_memory FROM platform_private.ai_client_memory m
    WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id;
  END IF;
  RETURN jsonb_build_object('enabled', v_settings.memory_enabled,
    'consentRecorded', v_settings.gemini_consent_at IS NOT NULL, 'active', v_gate,
    'settingsVersion', v_settings.version,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id),
    'messageCount', (v_state ->> 'total')::INTEGER,
    'summaryDue', v_gate AND (v_state ->> 'summaryDue')::BOOLEAN,
    'interestDue', v_gate AND (v_state ->> 'interestDue')::BOOLEAN,
    'memory', CASE WHEN v_memory.interest IS NOT NULL OR v_memory.summary IS NOT NULL THEN
      jsonb_build_object('interest', v_memory.interest, 'summary', v_memory.summary,
        'coveredCount', v_memory.covered_count, 'updatedAt', v_memory.updated_at) END,
    'lead', platform_private.ai_lead_card(p_organization_id, p_conversation_id));
END
$$;

-- «Забыть сводку» (Q9: ai.agent.use): строка памяти диалога удаляется; пока
-- память включена и согласие записано, сразу ставится указатель — память
-- соберётся заново, не дожидаясь нового сообщения клиента (enqueued).
-- Аудит — только флаги и счётчики.
CREATE OR REPLACE FUNCTION platform.ai_agent_memory_clear_v1(p_organization_id UUID, p_conversation_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_client_memory; v_deleted BOOLEAN;
  v_enqueued BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('conversationId', p_conversation_id));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'memory.clear', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  -- Порядок блокировок как у memory_due_v1: advisory диалога, затем строка.
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_memory:' || p_conversation_id::TEXT, 274));
  DELETE FROM platform_private.ai_client_memory m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
  RETURNING * INTO v_old;
  v_deleted := FOUND;
  IF platform_private.ai_memory_gate(p_organization_id) THEN
    v_enqueued := platform_private.ai_memory_poke(p_conversation_id, FALSE, 0) ->> 'status' = 'enqueued';
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'memory.clear', v_fp,
    jsonb_build_object('status', 'cleared', 'conversationId', p_conversation_id, 'deleted', v_deleted,
      'enqueued', v_enqueued),
    'ai.agent.memory.clear', 'communication_conversation', p_conversation_id,
    jsonb_build_object('hadInterest', v_old.interest IS NOT NULL, 'hadSummary', v_old.summary IS NOT NULL,
      'coveredCount', COALESCE(v_old.covered_count, 0), 'version', v_old.version),
    'ИИ-агент: сводка о клиенте удалена');
END
$$;

-- «Включить память» / «Выключить память» (Q9: ai.agent.manage). Включение
-- без записанного согласия — PT412 (Q12: согласие записывает admin).
-- Включение сразу ставит указатели сводки длинным диалогам продаж (больше 20
-- сообщений; до 500, по возрастанию ID, с шагом задержки 2 с) — не дожидаясь
-- нового сообщения клиента; число — в квитанции (enqueued). Интерес
-- остальных диалогов считается по их следующему входящему.
-- Выключение удаляет память всех диалогов организации (число — в квитанции).
CREATE OR REPLACE FUNCTION platform.ai_agent_memory_toggle_v1(p_organization_id UUID, p_enabled BOOLEAN,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_operation TEXT; v_old platform_private.ai_settings;
  v_new platform_private.ai_settings; v_deleted INTEGER := 0; v_enqueued INTEGER := 0; v_id UUID;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'ai_memory_invalid' USING ERRCODE = '22023';
  END IF;
  v_operation := CASE WHEN p_enabled THEN 'memory.enable' ELSE 'memory.disable' END;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('enabled', p_enabled,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    v_operation, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_settings_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_enabled AND v_old.gemini_consent_at IS NULL THEN
    RAISE EXCEPTION 'ai_consent_required' USING ERRCODE = 'PT412';
  END IF;
  UPDATE platform_private.ai_settings s SET memory_enabled = p_enabled, version = s.version + 1,
    updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  IF NOT p_enabled THEN
    DELETE FROM platform_private.ai_client_memory m WHERE m.organization_id = p_organization_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ELSIF platform_private.ai_memory_gate(p_organization_id) THEN
    FOR v_id IN SELECT c.id FROM platform.communication_conversations c
      WHERE c.organization_id = p_organization_id AND c.queue = 'sales'
        AND (SELECT count(*) FROM platform_private.ai_dialog_messages(c.organization_id, c.id)) > 20
      ORDER BY c.id LIMIT 500 LOOP
      IF platform_private.ai_memory_poke(v_id, TRUE, v_enqueued * 2) ->> 'status' = 'enqueued' THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, v_operation, v_fp,
    jsonb_build_object('status', 'applied', 'memoryEnabled', v_new.memory_enabled, 'version', v_new.version,
      'deleted', v_deleted, 'enqueued', v_enqueued),
    'ai.agent.' || v_operation, 'organization', p_organization_id,
    jsonb_build_object('memoryEnabled', v_old.memory_enabled, 'version', v_old.version),
    CASE WHEN p_enabled THEN 'ИИ-агент: память о клиенте включена'
      ELSE 'ИИ-агент: память о клиенте выключена, сводки удалены' END);
END
$$;

-- Согласие на Gemini (269, та же сигнатура; записывает и отзывает только
-- admin, §13). Отзыв теперь ещё и выключает память и сразу удаляет её во всех
-- диалогах организации, как «Выключить память»: повторное согласие память не
-- возобновляет — её снова включает сотрудник с ai.agent.manage.
CREATE OR REPLACE FUNCTION platform.ai_agent_consent_record_v1(p_organization_id UUID, p_action TEXT,
  p_text_version TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_settings; v_deleted INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_admin_actor(p_organization_id);
  IF p_action IS NULL OR p_action NOT IN ('grant', 'revoke')
    OR (p_action = 'grant' AND (p_text_version IS NULL OR p_text_version !~ '^[A-Za-z0-9._-]{1,40}$'))
    OR (p_action = 'revoke' AND p_text_version IS NOT NULL) THEN
    RAISE EXCEPTION 'ai_consent_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('action', p_action, 'textVersion', p_text_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'consent.' || p_action, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id FOR UPDATE;
  UPDATE platform_private.ai_settings s SET
    gemini_consent_at = CASE WHEN p_action = 'grant' THEN statement_timestamp() END,
    gemini_consent_by = CASE WHEN p_action = 'grant' THEN v_actor.membership_id END,
    gemini_consent_text_version = CASE WHEN p_action = 'grant' THEN p_text_version END,
    memory_enabled = CASE WHEN p_action = 'revoke' THEN FALSE ELSE s.memory_enabled END,
    version = s.version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id;
  IF p_action = 'revoke' THEN
    DELETE FROM platform_private.ai_client_memory m WHERE m.organization_id = p_organization_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'consent.' || p_action, v_fp,
    jsonb_build_object('status', CASE WHEN p_action = 'grant' THEN 'granted' ELSE 'revoked' END,
      'textVersion', p_text_version)
      || CASE WHEN p_action = 'revoke' THEN jsonb_build_object('memoryEnabled', FALSE, 'memoryDeleted', v_deleted)
        ELSE '{}'::JSONB END,
    'ai.agent.consent.' || p_action, 'organization', p_organization_id,
    jsonb_build_object('recorded', v_old.gemini_consent_at IS NOT NULL,
      'textVersion', v_old.gemini_consent_text_version, 'memoryEnabled', v_old.memory_enabled),
    CASE WHEN p_action = 'grant' THEN 'ИИ-агент: записано согласие на передачу текстов в Gemini'
      ELSE 'ИИ-агент: согласие на передачу текстов в Gemini отозвано' END);
END
$$;

-- ===========================================================================
-- Агент (platform_ai_agent, evo_ai_agent).
-- ===========================================================================

-- Указатели входящих сообщений диалогов продаж организаций с включённой
-- памятью после курсора (created_at, id); NULL — последние 5 минут. Текста
-- нет. Нет ни одной такой организации — 42501 ai_background_disabled (P4
-- расширит условие автоответчиком).
-- created_at — время события WhatsApp, а не порядок записи: проекция может
-- записать сообщение позже с более ранним временем (повтор, очередь работ,
-- равная секунда с меньшим UUID). Поэтому перекрытие — часть контракта:
-- next не уходит дальше «сейчас − 5 минут» (afterId = максимальный UUID),
-- кроме полной страницы (hasMore — листать дальше сразу). Сообщения этих
-- 5 минут приходят повторно — memory_due_v1 идемпотентна; сообщение,
-- записанное позже чем через 5 минут после своего времени, опрос не увидит
-- (его диалог обновится по следующему входящему).
CREATE OR REPLACE FUNCTION platform_ai_agent.inbound_since_v1(p_after_at TIMESTAMPTZ, p_after_id UUID,
  p_limit INTEGER DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_after_at TIMESTAMPTZ; v_after_id UUID; v_orgs UUID[]; v_items JSONB; v_count INTEGER;
  v_horizon TIMESTAMPTZ; v_next_at TIMESTAMPTZ; v_next_id UUID;
  v_max_id CONSTANT UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 OR ((p_after_at IS NULL) <> (p_after_id IS NULL)) THEN
    RAISE EXCEPTION 'ai_inbound_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(s.organization_id) INTO v_orgs FROM platform_private.ai_settings s
  WHERE platform_private.ai_memory_gate(s.organization_id);
  IF v_orgs IS NULL THEN
    RAISE EXCEPTION 'ai_background_disabled' USING ERRCODE = '42501';
  END IF;
  v_horizon := clock_timestamp() - INTERVAL '5 minutes';
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
  -- Неполная страница: курсор не дальше горизонта (может и отступить к нему).
  IF v_count < p_limit AND (v_next_at, v_next_id) > (v_horizon, v_max_id) THEN
    v_next_at := v_horizon;
    v_next_id := v_max_id;
  END IF;
  RETURN jsonb_build_object('items', v_items, 'hasMore', v_count = p_limit,
    'next', jsonb_build_object('afterAt', v_next_at, 'afterId', v_next_id));
END
$$;

-- Пора ли обновить память диалогов (1..100 ID). Диалог организации без
-- включённой памяти или согласия — 42501 ai_memory_disabled для всего вызова;
-- неизвестный или не продаж — skipped. Нужное и не поставленное в очередь
-- за 10 минут (и не в работе) — указатель с задержкой интереса. Только ID и
-- задержки.
CREATE OR REPLACE FUNCTION platform_ai_agent.memory_due_v1(p_conversation_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID; v_items JSONB := '[]'::JSONB;
BEGIN
  IF p_conversation_ids IS NULL OR cardinality(p_conversation_ids) NOT BETWEEN 1 AND 100
    OR array_position(p_conversation_ids, NULL) IS NOT NULL
    OR cardinality(p_conversation_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_conversation_ids) x) THEN
    RAISE EXCEPTION 'ai_memory_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM platform.communication_conversations c
    WHERE c.id = ANY (p_conversation_ids) AND NOT platform_private.ai_memory_gate(c.organization_id)) THEN
    RAISE EXCEPTION 'ai_memory_disabled' USING ERRCODE = '42501';
  END IF;
  -- По возрастанию ID: два поллера берут блокировки в одном порядке.
  FOR v_id IN SELECT x FROM unnest(p_conversation_ids) x ORDER BY x LOOP
    v_items := v_items || jsonb_build_array(platform_private.ai_memory_poke(v_id, FALSE, 0));
  END LOOP;
  RETURN jsonb_build_object('items', v_items);
END
$$;

-- Работа по указателю memory: аренда строки (как document_claim_v1, busy —
-- если держит другой). mode summary — прежняя сводка (NULL при rebuild),
-- до 80 самых старых непокрытых сообщений за окном (leaving), граница next;
-- interest — только окно; none — делать нечего (отметка очереди снимается).
-- Окно — последние 20, всегда. Сообщения — через ai_message_view.
CREATE OR REPLACE FUNCTION platform_ai_agent.memory_context_v1(p_conversation_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 120)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID; v_queue TEXT; v_memory platform_private.ai_client_memory; v_state JSONB; v_mode TEXT;
  v_settings platform_private.ai_settings; v_rebuild BOOLEAN; v_covered INTEGER; v_window JSONB; v_leaving JSONB;
  v_leaving_count INTEGER; v_next JSONB; v_total INTEGER; v_b_at TIMESTAMPTZ; v_b_id UUID;
BEGIN
  IF p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_memory_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT c.organization_id, c.queue::TEXT INTO v_org, v_queue
  FROM platform.communication_conversations c WHERE c.id = p_conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_conversation_gone' USING ERRCODE = 'P0002';
  END IF;
  IF NOT platform_private.ai_memory_gate(v_org) THEN
    RAISE EXCEPTION 'ai_memory_disabled' USING ERRCODE = '42501';
  END IF;
  IF v_queue <> 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
  INSERT INTO platform_private.ai_client_memory (conversation_id, organization_id)
  VALUES (p_conversation_id, v_org) ON CONFLICT (conversation_id) DO NOTHING;
  SELECT * INTO v_memory FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id FOR UPDATE;
  IF v_memory.lease_owner IS DISTINCT FROM btrim(p_worker_ref) AND v_memory.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'busy', 'conversationId', p_conversation_id,
      'leaseExpiresAt', v_memory.lease_expires_at);
  END IF;
  v_state := platform_private.ai_memory_state(p_conversation_id);
  v_mode := CASE WHEN (v_state ->> 'summaryDue')::BOOLEAN THEN 'summary'
    WHEN (v_state ->> 'interestDue')::BOOLEAN THEN 'interest' ELSE 'none' END;
  IF v_mode = 'none' THEN
    UPDATE platform_private.ai_client_memory m SET enqueued_at = NULL, lease_owner = NULL, lease_expires_at = NULL
    WHERE m.conversation_id = p_conversation_id;
    RETURN jsonb_build_object('status', 'none', 'mode', 'none', 'conversationId', p_conversation_id,
      'version', v_memory.version);
  END IF;
  UPDATE platform_private.ai_client_memory m SET lease_owner = btrim(p_worker_ref),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  WHERE m.conversation_id = p_conversation_id RETURNING * INTO v_memory;
  v_settings := platform_private.ai_settings_row(v_org);
  -- Граница сводки (сообщения неизменны — читается отдельно).
  IF v_memory.covered_message_id IS NOT NULL THEN
    SELECT m.created_at, m.id INTO v_b_at, v_b_id
    FROM platform_private.ai_dialog_messages(v_org, p_conversation_id) m WHERE m.id = v_memory.covered_message_id;
  END IF;
  -- Одно чтение сообщений (один снимок): согласованность покрытия, позиции с
  -- начала и с конца, окно и уходящие. Импорт истории, записанный после
  -- ai_memory_state, не сдвигает leaving/next относительно rebuild и prior.
  WITH msgs AS (
    SELECT d AS msg, row_number() OVER (ORDER BY d.created_at, d.id) AS rn_asc,
      row_number() OVER (ORDER BY d.created_at DESC, d.id DESC) AS rn_desc
    FROM platform_private.ai_dialog_messages(v_org, p_conversation_id) d
  ), eff AS (
    SELECT count(*)::INTEGER AS total, CASE WHEN v_memory.covered_count > 0 AND (v_b_id IS NULL
        OR count(*) FILTER (WHERE ((x.msg).created_at, (x.msg).id) <= (v_b_at, v_b_id)) <> v_memory.covered_count)
      THEN 0 ELSE v_memory.covered_count END AS covered
    FROM msgs x
  )
  SELECT max(e.total), max(e.covered),
    COALESCE(jsonb_agg(platform_private.ai_message_view(x.msg) ORDER BY x.rn_asc)
      FILTER (WHERE x.rn_desc <= 20), '[]'::JSONB),
    COALESCE(jsonb_agg(platform_private.ai_message_view(x.msg) ORDER BY x.rn_asc)
      FILTER (WHERE v_mode = 'summary' AND x.rn_desc > 20 AND x.rn_asc > e.covered AND x.rn_asc <= e.covered + 80),
      '[]'::JSONB),
    count(*) FILTER (WHERE v_mode = 'summary' AND x.rn_desc > 20 AND x.rn_asc > e.covered
      AND x.rn_asc <= e.covered + 80)
  INTO v_total, v_covered, v_window, v_leaving, v_leaving_count
  FROM eff e LEFT JOIN msgs x ON TRUE;
  v_rebuild := v_covered <> v_memory.covered_count;
  v_next := CASE WHEN v_leaving_count > 0 THEN jsonb_build_object('coveredMessageId', v_leaving -> -1 -> 'messageId',
    'coveredCount', v_covered + v_leaving_count) END;
  RETURN jsonb_build_object('status', 'claimed', 'mode', v_mode, 'rebuild', v_rebuild,
    'conversationId', p_conversation_id, 'organizationId', v_org,
    'models', jsonb_build_object('fast', v_settings.fast_model),
    'prior', jsonb_build_object('interest', v_memory.interest,
      'summary', CASE WHEN v_rebuild THEN NULL ELSE v_memory.summary END,
      'coveredCount', v_covered, 'version', v_memory.version),
    'summaryDue', (v_state ->> 'summaryDue')::BOOLEAN, 'interestDue', (v_state ->> 'interestDue')::BOOLEAN,
    'messageCount', v_total,
    'leaving', v_leaving, 'window', v_window, 'next', v_next,
    'interestMessageId', v_state -> 'latestInboundId', 'leaseExpiresAt', v_memory.lease_expires_at);
END
$$;

-- Запись памяти под арендой (42501 ai_memory_not_leased), при включённой
-- памяти и согласии, своей версии (PT409). Граница сводки: сообщение этого
-- диалога за окном (иначе 22023), счётчик равен числу сообщений до неё
-- включительно (иначе PT409 ai_memory_boundary_moved — импорт истории между
-- чтением и записью) и растёт, кроме rebuild. Длины и отсутствие телефонов и
-- e-mail — 22023 (ai_memory_invalid, ai_memory_personal_data). NULL
-- оставляет прежнее значение. Новый интерес в течение 60 с после прошлой
-- оценки не записывается (interestThrottled). Аренда снимается, отметка
-- очереди очищается, версия растёт; если память всё ещё нужна — новый
-- указатель (stillDue).
CREATE OR REPLACE FUNCTION platform_ai_agent.memory_put_v1(p_conversation_id UUID, p_worker_ref TEXT,
  p_version BIGINT, p_interest TEXT, p_summary TEXT, p_covered_message_id UUID, p_covered_count INTEGER,
  p_interest_message_id UUID, p_model TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_memory platform_private.ai_client_memory; v_new platform_private.ai_client_memory; v_queue TEXT;
  v_state JSONB; v_after JSONB; v_interest TEXT; v_summary TEXT; v_b_at TIMESTAMPTZ; v_b_id UUID;
  v_upto INTEGER; v_newer INTEGER; v_set_interest BOOLEAN; v_throttled BOOLEAN := FALSE; v_still_due BOOLEAN;
  v_delay INTEGER := 0;
BEGIN
  IF p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200 OR p_version IS NULL
    OR (p_model IS NOT NULL AND p_model !~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$')
    OR ((p_covered_message_id IS NULL) <> (p_covered_count IS NULL))
    OR ((p_summary IS NULL) <> (p_covered_message_id IS NULL))
    OR (p_interest IS NOT NULL AND p_interest_message_id IS NULL)
    OR (p_summary IS NULL AND p_interest_message_id IS NULL) THEN
    RAISE EXCEPTION 'ai_memory_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_memory FROM platform_private.ai_client_memory m WHERE m.conversation_id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR v_memory.lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    OR v_memory.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ai_memory_not_leased' USING ERRCODE = '42501';
  END IF;
  IF NOT platform_private.ai_memory_gate(v_memory.organization_id) THEN
    RAISE EXCEPTION 'ai_memory_disabled' USING ERRCODE = '42501';
  END IF;
  SELECT c.queue::TEXT INTO v_queue FROM platform.communication_conversations c
  WHERE c.organization_id = v_memory.organization_id AND c.id = p_conversation_id;
  IF v_queue IS DISTINCT FROM 'sales' THEN
    RAISE EXCEPTION 'ai_memory_not_sales' USING ERRCODE = '42501';
  END IF;
  IF p_version <> v_memory.version THEN
    RAISE EXCEPTION 'ai_memory_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  v_state := platform_private.ai_memory_state(p_conversation_id);

  IF p_covered_message_id IS NOT NULL THEN
    SELECT m.created_at, m.id INTO v_b_at, v_b_id
    FROM platform_private.ai_dialog_messages(v_memory.organization_id, p_conversation_id) m
    WHERE m.id = p_covered_message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_memory_boundary_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT (count(*) FILTER (WHERE (m.created_at, m.id) <= (v_b_at, v_b_id)))::INTEGER,
      (count(*) FILTER (WHERE (m.created_at, m.id) > (v_b_at, v_b_id)))::INTEGER
    INTO v_upto, v_newer
    FROM platform_private.ai_dialog_messages(v_memory.organization_id, p_conversation_id) m;
    IF v_newer < 20 THEN
      RAISE EXCEPTION 'ai_memory_boundary_invalid' USING ERRCODE = '22023', DETAIL = 'inside the window';
    END IF;
    IF v_upto <> p_covered_count THEN
      RAISE EXCEPTION 'ai_memory_boundary_moved' USING ERRCODE = 'PT409';
    END IF;
    IF NOT (v_state ->> 'rebuild')::BOOLEAN AND p_covered_count <= (v_state ->> 'coveredCount')::INTEGER THEN
      RAISE EXCEPTION 'ai_memory_boundary_invalid' USING ERRCODE = '22023', DETAIL = 'coverage must grow';
    END IF;
  END IF;
  IF p_interest_message_id IS NOT NULL AND NOT EXISTS (SELECT 1
    FROM platform_private.ai_dialog_messages(v_memory.organization_id, p_conversation_id) m
    WHERE m.id = p_interest_message_id AND m.direction = 'inbound') THEN
    RAISE EXCEPTION 'ai_memory_invalid' USING ERRCODE = '22023', DETAIL = 'interest message';
  END IF;

  -- Интерес — одна строка: пробелы и переводы строк сжимаются в один пробел.
  v_interest := NULLIF(btrim(regexp_replace(p_interest, '[[:space:][:cntrl:]]+', ' ', 'g')), '');
  v_summary := NULLIF(btrim(p_summary), '');
  IF (p_interest IS NOT NULL AND (v_interest IS NULL OR char_length(v_interest) > 140))
    OR (p_summary IS NOT NULL AND (v_summary IS NULL OR char_length(v_summary) > 1500)) THEN
    RAISE EXCEPTION 'ai_memory_invalid' USING ERRCODE = '22023', DETAIL = 'length';
  END IF;
  IF NOT platform_private.ai_memory_text_ok(v_interest) OR NOT platform_private.ai_memory_text_ok(v_summary) THEN
    RAISE EXCEPTION 'ai_memory_personal_data' USING ERRCODE = '22023';
  END IF;

  v_set_interest := p_interest_message_id IS NOT NULL;
  IF v_interest IS NOT NULL AND v_interest IS DISTINCT FROM v_memory.interest
    AND v_memory.interest_updated_at > clock_timestamp() - INTERVAL '60 seconds' THEN
    v_throttled := TRUE;
    v_set_interest := FALSE;
  END IF;
  UPDATE platform_private.ai_client_memory m SET
    interest = CASE WHEN v_set_interest THEN COALESCE(v_interest, m.interest) ELSE m.interest END,
    interest_message_id = CASE WHEN v_set_interest THEN p_interest_message_id ELSE m.interest_message_id END,
    interest_updated_at = CASE WHEN v_set_interest THEN clock_timestamp() ELSE m.interest_updated_at END,
    summary = COALESCE(v_summary, m.summary),
    covered_message_id = COALESCE(p_covered_message_id, m.covered_message_id),
    covered_count = COALESCE(p_covered_count, m.covered_count),
    model = COALESCE(p_model, m.model), version = m.version + 1,
    lease_owner = NULL, lease_expires_at = NULL, enqueued_at = NULL, updated_at = statement_timestamp()
  WHERE m.conversation_id = p_conversation_id RETURNING * INTO v_new;
  v_after := platform_private.ai_memory_state(p_conversation_id);
  v_still_due := (v_after ->> 'due')::BOOLEAN;
  IF v_still_due THEN
    v_delay := (v_after ->> 'delaySeconds')::INTEGER;
    PERFORM platform_private.ai_memory_enqueue(p_conversation_id, v_delay);
  END IF;
  RETURN jsonb_build_object('status', 'saved', 'conversationId', p_conversation_id, 'version', v_new.version,
    'coveredCount', v_new.covered_count, 'interestThrottled', v_throttled, 'stillDue', v_still_due,
    'delaySeconds', CASE WHEN v_still_due THEN v_delay END);
END
$$;

-- Контекст ответа по погашенному билету (269, та же сигнатура): последние 20
-- сообщений через ai_message_view (подпись и вид медиа, без имён файлов),
-- карточка лида (ai_lead_card), память — пока она включена и согласие
-- записано, иначе NULL.
CREATE OR REPLACE FUNCTION platform_ai_agent.conversation_context_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_messages JSONB; v_memory platform_private.ai_client_memory;
  v_memory_json JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  SELECT COALESCE(jsonb_agg(platform_private.ai_message_view(x.msg) ORDER BY (x.msg).created_at, (x.msg).id),
    '[]'::JSONB)
  INTO v_messages
  FROM (SELECT d AS msg FROM platform_private.ai_dialog_messages(v_ticket.organization_id, v_ticket.conversation_id) d
    ORDER BY d.created_at DESC, d.id DESC LIMIT 20) x;
  IF platform_private.ai_memory_gate(v_ticket.organization_id) THEN
    SELECT * INTO v_memory FROM platform_private.ai_client_memory m
    WHERE m.organization_id = v_ticket.organization_id AND m.conversation_id = v_ticket.conversation_id;
    IF v_memory.interest IS NOT NULL OR v_memory.summary IS NOT NULL THEN
      v_memory_json := jsonb_build_object('interest', v_memory.interest, 'summary', v_memory.summary,
        'coveredCount', v_memory.covered_count, 'updatedAt', v_memory.updated_at);
    END IF;
  END IF;
  RETURN jsonb_build_object('conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id,
    'latestInboundMessageId', platform_private.ai_latest_inbound(v_ticket.organization_id, v_ticket.conversation_id),
    'messages', v_messages, 'lead', platform_private.ai_lead_card(v_ticket.organization_id, v_ticket.conversation_id),
    'memory', v_memory_json);
END
$$;

-- Уборка (273) + память: строки диалогов не из очереди продаж и организаций
-- без включённой памяти или согласия удаляются, истёкшие аренды снимаются.
CREATE OR REPLACE FUNCTION platform_ai_agent.maintenance_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tickets INTEGER; v_answers INTEGER; v_rates INTEGER; v_calls INTEGER; v_reservations INTEGER;
  v_sessions INTEGER; v_expired INTEGER; v_proposals INTEGER; v_memory INTEGER; v_leases INTEGER;
BEGIN
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
  RETURN jsonb_build_object('tickets', v_tickets, 'answers', v_answers, 'rateWindows', v_rates,
    'usageCalls', v_calls, 'reservations', v_reservations, 'labSessions', v_sessions,
    'labProposalsExpired', v_expired, 'labProposalsDeleted', v_proposals, 'memoryDeleted', v_memory,
    'memoryLeasesCleared', v_leases);
END
$$;

-- ===========================================================================
-- Гранты и состав функций (как 273).
-- ===========================================================================
DO $ai274_acl$
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
    WHERE n.nspname = 'platform_ai_agent' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO evo_ai_agent', f);
  END LOOP;
END
$ai274_acl$;

DO $ai274_inventory$
DECLARE v_staff TEXT[]; v_agent TEXT[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_staff FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_agent FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_ai_agent';
  IF v_staff IS DISTINCT FROM ARRAY['ai_agent_answer_current_v1', 'ai_agent_answer_insert_v1',
      'ai_agent_consent_record_v1', 'ai_agent_document_confirm_company_v1', 'ai_agent_document_delete_v1',
      'ai_agent_document_page_v1', 'ai_agent_document_retry_v1', 'ai_agent_document_update_v1',
      'ai_agent_document_upload_v1', 'ai_agent_document_v1', 'ai_agent_documents_v1', 'ai_agent_example_delete_v1',
      'ai_agent_examples_v1', 'ai_agent_lab_discard_v1', 'ai_agent_lab_reject_v1', 'ai_agent_lab_v1',
      'ai_agent_memory_clear_v1', 'ai_agent_memory_toggle_v1', 'ai_agent_memory_v1',
      'ai_agent_review_resolve_v1', 'ai_agent_review_v1', 'ai_agent_rules_confirm_v1', 'ai_agent_rules_save_v1',
      'ai_agent_rules_v1', 'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1', 'ai_agent_settings_v1',
      'ai_agent_spend_v1', 'ai_agent_storage_authorize_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1',
      'document_content_put_v1', 'document_index_v1', 'document_pages_put_v1', 'document_reindex_claim_v1',
      'document_reindex_v1', 'document_stage_v1', 'inbound_since_v1', 'lab_apply_prepare_v1', 'lab_apply_v1',
      'lab_documents_v1', 'lab_proposal_put_v1', 'lab_session_get_v1', 'lab_session_put_v1', 'maintenance_v1',
      'memory_context_v1', 'memory_due_v1', 'memory_put_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1',
      'review_items_put_v1', 'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1',
      'work_finish_v1'] THEN
    RAISE EXCEPTION 'ai_agent_function_inventory_drift' USING ERRCODE = '55000',
      DETAIL = format('staff=%s agent=%s', v_staff, v_agent);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform_ai_agent' OR (n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%'))
      AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig))))
  THEN
    RAISE EXCEPTION 'ai_agent_function_not_hardened' USING ERRCODE = '55000';
  END IF;
END
$ai274_inventory$;

COMMENT ON FUNCTION platform_ai_agent.memory_put_v1(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, INTEGER, UUID, TEXT) IS
  'AI agent P3: write client memory under the worker lease (42501), gate and version (PT409); summary boundary outside the 20-message window with a matching, growing count; no phones or e-mails (22023); a changed interest within 60 s is not written.';
COMMENT ON FUNCTION platform_ai_agent.conversation_context_v1(UUID) IS
  'AI agent: answer context by a redeemed ticket — latest 20 messages (caption and media kind, no file names), lead card, client memory while enabled with consent (274).';
COMMENT ON FUNCTION platform.ai_agent_memory_toggle_v1(UUID, BOOLEAN, BIGINT, UUID) IS
  'AI agent P3: enable (consent required, PT412; enqueues summaries of sales conversations longer than 20 messages) or disable client memory; disabling deletes every memory row of the organization.';
COMMENT ON FUNCTION platform.ai_agent_consent_record_v1(UUID, TEXT, TEXT, UUID) IS
  'AI agent: Admin records or revokes the Gemini consent; a revoke also turns client memory off and deletes it (274).';
COMMENT ON FUNCTION platform_ai_agent.inbound_since_v1(TIMESTAMPTZ, UUID, INTEGER) IS
  'AI agent P3: inbound message pointers (no text) of sales conversations with memory on; next never passes now - 5 min except on a full page, so late projections are returned again (memory_due_v1 is idempotent).';

NOTIFY pgrst, 'reload schema';
COMMIT;
