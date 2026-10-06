-- 269_platform_ai_agent_rpc — «ИИ-агент» P1: функции сотрудников
-- (platform.ai_agent_*_v1, EXECUTE только у authenticated) и функции сервиса
-- агента (platform_ai_agent.*, EXECUTE только у evo_ai_agent). Контракт:
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.3, §5.3–5.5, §6 (части БД), §10,
-- §13, §14; ADR 0032.
--
-- Границы, которые держит БД, а не код агента:
--  * диалог агент получает только по свежему одноразовому билету, выданному
--    по сессии сотрудника (право ai.agent.use, communication.read.full,
--    диалог очереди продаж). Билет: 32 случайных байта (два
--    gen_random_uuid(), pg_strong_random), в БД только SHA-256, срок 60 с,
--    одно погашение; погашенный билет годен 5 минут и перепроверяет доступ
--    сотрудника при каждом чтении. В P1 фоновых функций с текстом диалогов
--    нет;
--  * без записанного согласия на Gemini билет не выдаётся и не гасится,
--    резерв бюджета не даётся (PT412 ai_consent_required);
--  * лимиты: 20 ответов в минуту на сотрудника (PT429 ai_rate_limited) и
--    месячный лимит EVO с резервом стоимости (PT402 ai_budget_exhausted);
--    резерв ответа, оборвавшегося до вызова Gemini, возвращает
--    budget_release_v1, погашенный резерв он не трогает;
--  * один генератор на ключ ответа (heartbeat 8 с, брошенный после 30 с),
--    устаревший ответ — PT409 superseded / stale_answer;
--  * маркер источника в ответе — только на клиентский фрагмент этой
--    организации;
--  * «База знаний» доступна только admin через ai_agent_seed_from_kb_v1 и
--    только из закрытого списка (§14); у роли агента нет функций, читающих
--    «Базу знаний»;
--  * согласие на Gemini записывает и отзывает только admin (§13).
-- Ошибки: 42501 нет прав/билет недействителен, 22023 неверный ввод,
-- P0002 не найдено, PT409 конфликт версии/устаревание, PT412 нет согласия,
-- PT429 лимит запросов, PT402 месячный лимит.
BEGIN;

-- Загружает библиотеку pgvector в этой сессии: без неё атрибут функции
-- `SET hnsw.*` создаётся как placeholder, а его владелец не superuser.
SELECT '[0]'::public.halfvec IS NOT NULL AS ai269_vector_loaded;

-- ===========================================================================
-- Внутренние помощники (platform_private, без грантов).
-- ===========================================================================

CREATE OR REPLACE FUNCTION platform_private.ai_settings_row(p_organization_id UUID)
RETURNS platform_private.ai_settings LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_settings;
BEGIN
  SELECT * INTO v_settings FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id;
  IF NOT FOUND THEN
    INSERT INTO platform_private.ai_settings (organization_id)
    SELECT o.id FROM platform.organizations o WHERE o.id = p_organization_id
    ON CONFLICT (organization_id) DO NOTHING;
    SELECT * INTO v_settings FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_settings;
END
$$;

-- Отпечаток знаний: версия знаний, версия правил и модели ответа.
CREATE OR REPLACE FUNCTION platform_private.ai_knowledge_fingerprint(p_settings platform_private.ai_settings)
RETURNS TEXT LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object('v', 1,
    'knowledgeVersion', p_settings.knowledge_version, 'rulesVersionId', p_settings.rules_version_id,
    'answerModel', p_settings.answer_model, 'fastModel', p_settings.fast_model,
    'embeddingModel', p_settings.embedding_model)::TEXT, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_fingerprint(p_value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(COALESCE(p_value, 'null'::JSONB)::TEXT, 'UTF8')), 'hex')
$$;

-- День расходов по Asia/Bishkek.
CREATE OR REPLACE FUNCTION platform_private.ai_local_day(p_at TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (p_at AT TIME ZONE 'Asia/Bishkek')::DATE
$$;

-- Сотрудник (не студент) текущей сессии с правом уровня организации.
CREATE OR REPLACE FUNCTION platform_private.ai_staff_actor(p_organization_id UUID, p_permission_key TEXT)
RETURNS TABLE (membership_id UUID, profile_id UUID, auth_user_id UUID, is_admin BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_permission_key IS NULL OR p_permission_key NOT IN ('ai.agent.use', 'ai.agent.manage') THEN
    RAISE EXCEPTION 'ai_agent_invalid_permission' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT a.membership_id, a.profile_id, a.auth_user_id, (a.platform_role IS NOT DISTINCT FROM 'admin')
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.platform_role IS DISTINCT FROM 'student'
    AND platform_private.staff_can_access(a.organization_id, a.membership_id, p_permission_key,
      'organization', p_organization_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

-- Admin (system admin), как в kb_require_admin (201): согласие на Gemini.
CREATE OR REPLACE FUNCTION platform_private.ai_admin_actor(p_organization_id UUID)
RETURNS TABLE (membership_id UUID, profile_id UUID, auth_user_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    PERFORM platform_private.kb_require_admin(p_organization_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'ai_admin_required' USING ERRCODE = '42501';
  END;
  RETURN QUERY
  SELECT a.membership_id, a.profile_id, a.auth_user_id FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.platform_role = 'admin' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_admin_required' USING ERRCODE = '42501';
  END IF;
END
$$;

-- Диалог очереди продаж, который сотрудник может читать, и право ai.agent.use.
CREATE OR REPLACE FUNCTION platform_private.ai_conversation_allowed(
  p_organization_id UUID, p_membership_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_organization_id IS NOT NULL AND p_membership_id IS NOT NULL AND p_conversation_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform.communication_conversations c
      WHERE c.organization_id = p_organization_id AND c.id = p_conversation_id AND c.queue = 'sales')
    AND platform_private.staff_can_access(p_organization_id, p_membership_id, 'ai.agent.use',
      'organization', p_organization_id)
    AND platform_private.staff_can_access(p_organization_id, p_membership_id, 'communication.read.full',
      'conversation', p_conversation_id)
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_latest_inbound(p_organization_id UUID, p_conversation_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
    AND m.direction = 'inbound'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_latest_outbound(p_organization_id UUID, p_conversation_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
    AND m.direction = 'outbound'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
$$;

-- Якорь ответа ещё действует: его входящее — последнее входящее диалога, а у
-- «продолжения» (followup) его исходящее — последнее исходящее. Новое
-- сообщение сотрудника (в том числе отправленное продолжение) делает
-- продолжение устаревшим, как новое сообщение клиента — ответ.
CREATE OR REPLACE FUNCTION platform_private.ai_answer_anchored(p_answer platform_private.ai_answers)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_answer.source_message_id IS NOT DISTINCT FROM
      platform_private.ai_latest_inbound(p_answer.organization_id, p_answer.conversation_id)
    AND (p_answer.intent <> 'followup' OR p_answer.source_outbound_message_id IS NOT DISTINCT FROM
      platform_private.ai_latest_outbound(p_answer.organization_id, p_answer.conversation_id))
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_require_consent(p_settings platform_private.ai_settings)
RETURNS VOID LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF p_settings.gemini_consent_at IS NULL THEN
    RAISE EXCEPTION 'ai_consent_required' USING ERRCODE = 'PT412';
  END IF;
END
$$;

-- Квитанции команд: повтор того же request_id отдаёт ту же квитанцию,
-- другой ввод — конфликт.
CREATE OR REPLACE FUNCTION platform_private.ai_request_replay(p_organization_id UUID, p_request_id UUID,
  p_membership_id UUID, p_operation TEXT, p_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row platform_private.ai_requests;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'ai_request_id_required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_request:' || p_organization_id::TEXT || ':' || p_request_id::TEXT, 269));
  SELECT * INTO v_row FROM platform_private.ai_requests r
  WHERE r.organization_id = p_organization_id AND r.request_id = p_request_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.request_id = p_request_id) THEN
      RAISE EXCEPTION 'ai_request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN NULL;
  END IF;
  IF v_row.actor_membership_id <> p_membership_id OR v_row.operation <> p_operation
    OR v_row.fingerprint <> p_fingerprint THEN
    RAISE EXCEPTION 'ai_request_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN v_row.receipt || jsonb_build_object('replayed', TRUE);
END
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_request_finish(p_organization_id UUID, p_request_id UUID,
  p_actor_membership_id UUID, p_actor_profile_id UUID, p_actor_auth_user_id UUID, p_operation TEXT,
  p_fingerprint TEXT, p_receipt JSONB, p_action TEXT, p_resource_type TEXT, p_resource_id UUID,
  p_before JSONB, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', p_actor_profile_id, 'auth:' || p_actor_auth_user_id::TEXT, p_action,
    p_resource_type, p_resource_id, p_before, p_receipt, p_reason, p_request_id);
  INSERT INTO platform_private.ai_requests (organization_id, request_id, actor_membership_id, operation,
    fingerprint, receipt)
  VALUES (p_organization_id, p_request_id, p_actor_membership_id, p_operation, p_fingerprint, p_receipt);
  RETURN p_receipt || jsonb_build_object('replayed', FALSE);
END
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_bump_knowledge(p_organization_id UUID)
RETURNS BIGINT LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE platform_private.ai_settings s SET knowledge_version = s.knowledge_version + 1,
    updated_at = statement_timestamp()
  WHERE s.organization_id = p_organization_id
  RETURNING s.knowledge_version
$$;

-- Указатель в очередь агента: {v, kind, ref_id}, без текстов.
CREATE OR REPLACE FUNCTION platform_private.ai_enqueue(p_kind TEXT, p_ref_id UUID)
RETURNS BIGINT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_msg_id BIGINT;
BEGIN
  IF p_kind NOT IN ('ingest', 'reindex', 'memory', 'autosend', 'seed') OR p_ref_id IS NULL THEN
    RAISE EXCEPTION 'ai_queue_invalid_pointer' USING ERRCODE = '22023';
  END IF;
  SELECT pgmq.send('ai_agent_work_v1', jsonb_build_object('v', 1, 'kind', p_kind, 'ref_id', p_ref_id), 0)
  INTO v_msg_id;
  RETURN v_msg_id;
END
$$;

-- Цена (USD за 1 млн токенов), действующая в этот день.
CREATE OR REPLACE FUNCTION platform_private.ai_price(p_model TEXT, p_kind TEXT, p_day DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.usd_per_million FROM platform_private.ai_prices p
  WHERE p.model = p_model AND p.kind = p_kind AND p.effective_from <= p_day
    AND (p.effective_to IS NULL OR p.effective_to >= p_day)
  ORDER BY p.effective_from DESC LIMIT 1
$$;

-- Модель оценена в этот день: генерирующей нужны цены входа и выхода, модели
-- эмбеддингов — цена embedding. Вызов модели без цены не попал бы в месячный
-- лимит (§10), поэтому такую модель нельзя выбрать в настройках и под неё не
-- резервируется бюджет.
CREATE OR REPLACE FUNCTION platform_private.ai_model_priced(p_model TEXT, p_embedding BOOLEAN, p_day DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_embedding THEN platform_private.ai_price(p_model, 'embedding', p_day) IS NOT NULL
    ELSE platform_private.ai_price(p_model, 'input', p_day) IS NOT NULL
      AND platform_private.ai_price(p_model, 'output', p_day) IS NOT NULL END
$$;

-- Модели настроек без цены на этот день (пустой массив — все оценены).
CREATE OR REPLACE FUNCTION platform_private.ai_unpriced_models(p_settings platform_private.ai_settings, p_day DATE)
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT m.model ORDER BY m.model), '{}') FROM (VALUES
    (p_settings.answer_model, FALSE), (p_settings.fast_model, FALSE), (p_settings.vision_model, FALSE),
    (p_settings.arbiter_model, FALSE), (p_settings.arbiter_fallback_model, FALSE),
    (p_settings.embedding_model, TRUE)) m(model, embedding)
  WHERE NOT platform_private.ai_model_priced(m.model, m.embedding, p_day)
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_purpose_group(p_purpose TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_purpose = 'answer' THEN 'answers'
    WHEN p_purpose IN ('rewrite', 'embed_query') THEN 'search'
    WHEN p_purpose = 'precompute' THEN 'precompute'
    WHEN p_purpose IN ('memory', 'summary') THEN 'memory'
    WHEN p_purpose IN ('embed_document', 'enrich') THEN 'documents'
    WHEN p_purpose IN ('ocr_page', 'ocr_arbiter') THEN 'ocr'
    WHEN p_purpose = 'laboratory' THEN 'laboratory'
    WHEN p_purpose IN ('autosend', 'autosend_summary') THEN 'autosend'
    WHEN p_purpose = 'probe' THEN 'probe'
    WHEN p_purpose = 'dictation' THEN 'dictation'
  END
$$;

-- Погашенный билет, годный ещё 5 минут; доступ сотрудника перепроверяется.
CREATE OR REPLACE FUNCTION platform_private.ai_redemption(p_redemption_id UUID, p_purpose TEXT)
RETURNS platform_private.ai_tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets;
BEGIN
  SELECT * INTO v_ticket FROM platform_private.ai_tickets t WHERE t.id = p_redemption_id;
  IF NOT FOUND OR v_ticket.used_at IS NULL OR v_ticket.used_at < clock_timestamp() - INTERVAL '5 minutes'
    OR v_ticket.purpose IS DISTINCT FROM p_purpose
    OR NOT platform_private.ai_conversation_allowed(v_ticket.organization_id, v_ticket.membership_id,
      v_ticket.conversation_id) THEN
    RAISE EXCEPTION 'ai_redemption_invalid' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(v_ticket.organization_id));
  RETURN v_ticket;
END
$$;

-- Один отсчёт лимита на одно погашение; превышение откатывает отсчёт.
CREATE OR REPLACE FUNCTION platform_private.ai_rate_take(p_ticket platform_private.ai_tickets)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_settings; v_hits INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM platform_private.ai_tickets t
    WHERE t.token_sha256 = p_ticket.token_sha256 AND t.rate_taken_at IS NOT NULL) THEN
    RETURN;
  END IF;
  v_settings := platform_private.ai_settings_row(p_ticket.organization_id);
  INSERT INTO platform_private.ai_rate_limits AS l (organization_id, membership_id, window_start, hits)
  VALUES (p_ticket.organization_id, p_ticket.membership_id, date_trunc('minute', clock_timestamp()), 1)
  ON CONFLICT (organization_id, membership_id, window_start) DO UPDATE SET hits = l.hits + 1
  RETURNING l.hits INTO v_hits;
  IF v_hits > v_settings.rate_per_member_minute THEN
    RAISE EXCEPTION 'ai_rate_limited' USING ERRCODE = 'PT429';
  END IF;
  UPDATE platform_private.ai_tickets t SET rate_taken_at = clock_timestamp()
  WHERE t.token_sha256 = p_ticket.token_sha256;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_document_json(p_document platform_private.ai_documents)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_document.id, 'title', p_document.title, 'kind', p_document.kind,
    'audience', p_document.audience, 'autosendAllowed', p_document.autosend_allowed,
    'status', p_document.status, 'stage', p_document.stage, 'progress', p_document.progress,
    'errorCode', p_document.error_code, 'source', p_document.source,
    'sourceRef', p_document.source_ref - 'root', 'editedInLab', p_document.edited_in_lab,
    'docVersion', p_document.doc_version, 'rowVersion', p_document.row_version,
    'pageCount', p_document.page_count, 'replacesId', p_document.replaces_id,
    'supersededById', p_document.superseded_by_id, 'createdAt', p_document.created_at,
    'updatedAt', p_document.updated_at, 'indexedAt', p_document.indexed_at,
    'chunkCount', (SELECT count(*) FROM platform_private.ai_chunks c WHERE c.document_id = p_document.id),
    'openReviewCount', (SELECT count(*) FROM platform_private.ai_review_items r
      WHERE r.document_id = p_document.id AND r.status = 'open'))
$$;

DO $ai269_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_settings_row', 'ai_knowledge_fingerprint',
      'ai_fingerprint', 'ai_local_day', 'ai_staff_actor', 'ai_admin_actor', 'ai_conversation_allowed',
      'ai_latest_inbound', 'ai_latest_outbound', 'ai_answer_anchored', 'ai_require_consent', 'ai_request_replay',
      'ai_request_finish', 'ai_bump_knowledge', 'ai_enqueue', 'ai_price', 'ai_model_priced', 'ai_unpriced_models',
      'ai_purpose_group', 'ai_redemption', 'ai_rate_take', 'ai_document_json') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai269_private_acl$;

-- ===========================================================================
-- Функции сотрудников (platform, EXECUTE только у authenticated).
-- ===========================================================================

-- Одноразовый билет CRM → агент (§4.3). Токен (64 hex) отдаётся один раз.
CREATE OR REPLACE FUNCTION platform.ai_agent_ticket_v1(p_organization_id UUID, p_purpose TEXT,
  p_conversation_id UUID, p_ref_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_bytes BYTEA; v_ticket platform_private.ai_tickets; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_purpose IS DISTINCT FROM 'answer' THEN
    RAISE EXCEPTION 'ai_ticket_invalid_purpose' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_ref_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m
    WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
      AND m.id = p_ref_id AND m.direction = 'inbound') THEN
    RAISE EXCEPTION 'ai_ticket_invalid_message' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
  -- Не больше 60 билетов в минуту на сотрудника (ответов — 20/мин, §6.8).
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_ticket:' || p_organization_id::TEXT || ':'
    || v_actor.membership_id::TEXT, 269));
  IF (SELECT count(*) FROM (SELECT 1 FROM platform_private.ai_tickets t
      WHERE t.organization_id = p_organization_id AND t.membership_id = v_actor.membership_id
        AND t.issued_at > v_now - INTERVAL '60 seconds' LIMIT 60) x) >= 60 THEN
    RAISE EXCEPTION 'ai_ticket_rate_limited' USING ERRCODE = 'PT429';
  END IF;

  -- Чистка билетов старше суток (ограниченно, без отдельного cron).
  DELETE FROM platform_private.ai_tickets t WHERE t.token_sha256 IN (
    SELECT o.token_sha256 FROM platform_private.ai_tickets o
    WHERE o.expires_at < clock_timestamp() - INTERVAL '1 day' LIMIT 100);

  v_bytes := decode(replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', ''), 'hex');
  INSERT INTO platform_private.ai_tickets (token_sha256, organization_id, membership_id, purpose,
    conversation_id, ref_id, issued_at, expires_at)
  VALUES (encode(sha256(v_bytes), 'hex'), p_organization_id, v_actor.membership_id, p_purpose,
    p_conversation_id, p_ref_id, v_now, v_now + INTERVAL '60 seconds')
  RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('ticket', encode(v_bytes, 'hex'), 'expiresAt', v_ticket.expires_at,
    'purpose', v_ticket.purpose, 'conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id);
END
$$;

-- Сохранённый ответ и флаг его актуальности (повторное открытие без Gemini).
CREATE OR REPLACE FUNCTION platform.ai_agent_answer_current_v1(p_organization_id UUID, p_conversation_id UUID,
  p_intent TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_latest UUID; v_last_direction TEXT;
  v_answer platform_private.ai_answers; v_fingerprint TEXT; v_current BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_intent IS NOT NULL AND p_intent NOT IN ('reply', 'followup') THEN
    RAISE EXCEPTION 'ai_answer_invalid_intent' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  v_fingerprint := platform_private.ai_knowledge_fingerprint(v_settings);
  v_latest := platform_private.ai_latest_inbound(p_organization_id, p_conversation_id);
  SELECT m.direction::TEXT INTO v_last_direction FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  SELECT * INTO v_answer FROM platform_private.ai_answers a
  WHERE a.organization_id = p_organization_id AND a.conversation_id = p_conversation_id
    AND (p_intent IS NULL OR a.intent = p_intent)
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('answer', NULL, 'latestInboundMessageId', v_latest,
      'lastMessageDirection', v_last_direction, 'consentRecorded', v_settings.gemini_consent_at IS NOT NULL);
  END IF;
  v_current := v_answer.status = 'ready' AND platform_private.ai_answer_anchored(v_answer)
    AND v_answer.knowledge_fingerprint = v_fingerprint;
  RETURN jsonb_build_object('answer', jsonb_build_object('answerId', v_answer.id, 'status', v_answer.status,
      'intent', v_answer.intent, 'sourceMessageId', v_answer.source_message_id,
      'sourceOutboundMessageId', v_answer.source_outbound_message_id,
      'result', CASE WHEN v_answer.status = 'ready' THEN v_answer.result END,
      'errorCode', v_answer.error_code, 'model', v_answer.model, 'createdAt', v_answer.created_at,
      'insertedAt', v_answer.inserted_at, 'current', v_current),
    'latestInboundMessageId', v_latest, 'lastMessageDirection', v_last_direction,
    'consentRecorded', v_settings.gemini_consent_at IS NOT NULL);
END
$$;

-- «Вставить в ответ»: только актуальный готовый ответ; иначе PT409.
CREATE OR REPLACE FUNCTION platform.ai_agent_answer_insert_v1(p_organization_id UUID, p_answer_id UUID,
  p_part TEXT DEFAULT 'reply')
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_answer platform_private.ai_answers; v_settings platform_private.ai_settings;
  v_text TEXT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_part IS NULL OR p_part NOT IN ('reply', 'question') THEN
    RAISE EXCEPTION 'ai_answer_invalid_part' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_answer FROM platform_private.ai_answers a
  WHERE a.organization_id = p_organization_id AND a.id = p_answer_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id,
    v_answer.conversation_id) THEN
    RAISE EXCEPTION 'ai_answer_unavailable' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  IF v_answer.status <> 'ready' OR NOT platform_private.ai_answer_anchored(v_answer)
    OR v_answer.knowledge_fingerprint <> platform_private.ai_knowledge_fingerprint(v_settings) THEN
    RAISE EXCEPTION 'stale_answer' USING ERRCODE = 'PT409';
  END IF;
  v_text := v_answer.result ->> p_part;
  IF v_text IS NULL OR btrim(v_text) = '' THEN
    RAISE EXCEPTION 'ai_answer_part_missing' USING ERRCODE = 'P0002';
  END IF;
  UPDATE platform_private.ai_answers a SET inserted_at = clock_timestamp(), inserted_by = v_actor.membership_id,
    updated_at = clock_timestamp()
  WHERE a.id = v_answer.id;
  RETURN jsonb_build_object('answerId', v_answer.id, 'part', p_part, 'text', v_text);
END
$$;

-- Список «Информации для агента» (без текста документов).
CREATE OR REPLACE FUNCTION platform.ai_agent_documents_v1(p_organization_id UUID, p_query JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_limit INTEGER; v_status TEXT; v_audience TEXT; v_items JSONB;
  v_before_at TIMESTAMPTZ; v_before_id UUID;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object'
    OR (p_query - ARRAY['status', 'audience', 'limit', 'beforeUpdatedAt', 'beforeId']) <> '{}'::JSONB THEN
    RAISE EXCEPTION 'ai_documents_invalid_query' USING ERRCODE = '22023';
  END IF;
  v_status := p_query ->> 'status';
  v_audience := p_query ->> 'audience';
  IF (v_status IS NOT NULL AND v_status NOT IN ('queued', 'processing', 'review', 'ready', 'failed', 'superseded'))
    OR (v_audience IS NOT NULL AND v_audience NOT IN ('client', 'internal'))
    OR (p_query ? 'limit' AND (jsonb_typeof(p_query -> 'limit') <> 'number'
      OR (p_query ->> 'limit') !~ '^[0-9]{1,3}$'))
    OR ((p_query ? 'beforeUpdatedAt') <> (p_query ? 'beforeId')) THEN
    RAISE EXCEPTION 'ai_documents_invalid_query' USING ERRCODE = '22023';
  END IF;
  v_limit := least(200, greatest(1, COALESCE((p_query ->> 'limit')::INTEGER, 100)));
  IF p_query ? 'beforeId' THEN
    v_before_at := (p_query ->> 'beforeUpdatedAt')::TIMESTAMPTZ;
    v_before_id := (p_query ->> 'beforeId')::UUID;
  END IF;
  SELECT COALESCE(jsonb_agg(platform_private.ai_document_json(d) ORDER BY d.updated_at DESC, d.id DESC), '[]'::JSONB)
  INTO v_items
  FROM (SELECT x.* FROM platform_private.ai_documents x
    WHERE x.organization_id = p_organization_id
      AND (CASE WHEN v_status IS NULL THEN x.status <> 'superseded' ELSE x.status = v_status END)
      AND (v_audience IS NULL OR x.audience = v_audience)
      AND (v_before_id IS NULL OR (x.updated_at, x.id) < (v_before_at, v_before_id))
    ORDER BY x.updated_at DESC, x.id DESC LIMIT v_limit + 1) d;
  RETURN jsonb_build_object('items', (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::JSONB)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS i(e, o) WHERE o <= v_limit),
    'hasMore', jsonb_array_length(v_items) > v_limit,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id),
    'isAdmin', v_actor.is_admin);
END
$$;

-- Название, аудитория (в «Для клиентов» — только с подтверждением),
-- разрешение для автоответчика.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_update_v1(p_organization_id UUID, p_document_id UUID,
  p_expected_version BIGINT, p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_doc platform_private.ai_documents;
  v_new platform_private.ai_documents; v_audience TEXT; v_title TEXT; v_autosend BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB
    OR (p_patch - ARRAY['title', 'audience', 'autosendAllowed', 'confirmClient']) <> '{}'::JSONB
    OR (p_patch ? 'title' AND jsonb_typeof(p_patch -> 'title') <> 'string')
    OR (p_patch ? 'audience' AND (p_patch ->> 'audience') NOT IN ('client', 'internal'))
    OR (p_patch ? 'autosendAllowed' AND jsonb_typeof(p_patch -> 'autosendAllowed') <> 'boolean')
    OR (p_patch ? 'confirmClient' AND jsonb_typeof(p_patch -> 'confirmClient') <> 'boolean') THEN
    RAISE EXCEPTION 'ai_document_invalid_patch' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id,
    'expectedVersion', p_expected_version, 'patch', p_patch));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.update', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status = 'superseded' THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_doc.row_version THEN
    RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  v_title := COALESCE(btrim(p_patch ->> 'title'), v_doc.title);
  v_audience := COALESCE(p_patch ->> 'audience', v_doc.audience);
  v_autosend := COALESCE((p_patch ->> 'autosendAllowed')::BOOLEAN, v_doc.autosend_allowed);
  IF v_audience = 'client' AND v_doc.audience <> 'client'
    AND COALESCE((p_patch ->> 'confirmClient')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'ai_document_client_confirmation_required' USING ERRCODE = '22023';
  END IF;
  IF v_audience = 'internal' THEN v_autosend := FALSE; END IF;
  IF v_autosend AND NOT v_doc.autosend_allowed AND v_doc.status NOT IN ('ready') THEN
    RAISE EXCEPTION 'ai_document_not_ready' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_documents d SET title = v_title, audience = v_audience, autosend_allowed = v_autosend,
    row_version = d.row_version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE d.id = v_doc.id RETURNING * INTO v_new;
  IF v_new.audience <> v_doc.audience THEN
    PERFORM platform_private.ai_bump_knowledge(p_organization_id);
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.update', v_fp,
    jsonb_build_object('status', 'applied', 'document', platform_private.ai_document_json(v_new)),
    'ai.agent.document.update', 'ai_document', v_doc.id,
    jsonb_build_object('title', v_doc.title, 'audience', v_doc.audience, 'autosendAllowed', v_doc.autosend_allowed,
      'rowVersion', v_doc.row_version),
    'ИИ-агент: изменён документ');
END
$$;

-- Удаление документа: фрагменты, страницы и пункты сверки уходят вместе с
-- ним; обработка, если идёт, прекращается (следующий вызов воркера получает
-- ai_document_gone). storagePath возвращается CRM для удаления объекта.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_delete_v1(p_organization_id UUID, p_document_id UUID,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_doc platform_private.ai_documents; v_had_chunks BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.delete', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_doc.row_version THEN
    RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  v_had_chunks := EXISTS (SELECT 1 FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.id);
  DELETE FROM platform_private.ai_documents d WHERE d.id = v_doc.id;
  IF v_had_chunks THEN
    PERFORM platform_private.ai_bump_knowledge(p_organization_id);
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.delete', v_fp,
    jsonb_build_object('status', 'deleted', 'documentId', v_doc.id, 'storagePath', v_doc.storage_path),
    'ai.agent.document.delete', 'ai_document', v_doc.id,
    jsonb_build_object('title', v_doc.title, 'audience', v_doc.audience, 'status', v_doc.status,
      'source', v_doc.source, 'sourceRef', v_doc.source_ref, 'rowVersion', v_doc.row_version),
    'ИИ-агент: удалён документ');
END
$$;

-- «Повторить» для документа с ошибкой.
CREATE OR REPLACE FUNCTION platform.ai_agent_document_retry_v1(p_organization_id UUID, p_document_id UUID,
  p_expected_version BIGINT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_doc platform_private.ai_documents;
  v_new platform_private.ai_documents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('documentId', p_document_id,
    'expectedVersion', p_expected_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'document.retry', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS DISTINCT FROM v_doc.row_version THEN
    RAISE EXCEPTION 'ai_document_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_doc.status <> 'failed' THEN
    RAISE EXCEPTION 'ai_document_not_failed' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_documents d SET status = 'queued', stage = NULL, progress = 0, error_code = NULL,
    attempts = 0, lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1,
    updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE d.id = v_doc.id RETURNING * INTO v_new;
  PERFORM platform_private.ai_enqueue(CASE v_doc.source WHEN 'seed_kb' THEN 'seed'
    WHEN 'upload' THEN 'ingest' ELSE 'reindex' END, v_doc.id);
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'document.retry', v_fp,
    jsonb_build_object('status', 'queued', 'document', platform_private.ai_document_json(v_new)),
    'ai.agent.document.retry', 'ai_document', v_doc.id,
    jsonb_build_object('status', v_doc.status, 'errorCode', v_doc.error_code, 'rowVersion', v_doc.row_version),
    'ИИ-агент: повтор обработки документа');
END
$$;

-- «Правила общения»: текущая версия и история (без текста старых версий).
CREATE OR REPLACE FUNCTION platform.ai_agent_rules_v1(p_organization_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_current JSONB; v_versions JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ai_rules_invalid_limit' USING ERRCODE = '22023';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  SELECT jsonb_build_object('id', r.id, 'version', r.version, 'body', r.body, 'source', r.source,
    'sourceRef', r.source_ref, 'createdAt', r.created_at, 'createdByName', cp.display_name,
    'confirmedAt', r.confirmed_at, 'confirmedByName', fp.display_name, 'needsReview', r.confirmed_at IS NULL)
  INTO v_current
  FROM platform_private.ai_rules_versions r
  LEFT JOIN platform.organization_memberships cm ON cm.organization_id = r.organization_id AND cm.id = r.created_by
  LEFT JOIN platform.profiles cp ON cp.id = cm.profile_id
  LEFT JOIN platform.organization_memberships fm ON fm.organization_id = r.organization_id AND fm.id = r.confirmed_by
  LEFT JOIN platform.profiles fp ON fp.id = fm.profile_id
  WHERE r.organization_id = p_organization_id AND r.id = v_settings.rules_version_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'version', x.version, 'source', x.source,
      'createdAt', x.created_at, 'createdByName', x.display_name, 'confirmedAt', x.confirmed_at,
      'bytes', octet_length(x.body), 'current', x.id = v_settings.rules_version_id) ORDER BY x.version DESC), '[]'::JSONB)
  INTO v_versions
  FROM (SELECT r.*, p.display_name FROM platform_private.ai_rules_versions r
    LEFT JOIN platform.organization_memberships m ON m.organization_id = r.organization_id AND m.id = r.created_by
    LEFT JOIN platform.profiles p ON p.id = m.profile_id
    WHERE r.organization_id = p_organization_id ORDER BY r.version DESC LIMIT p_limit) x;
  RETURN jsonb_build_object('current', v_current, 'versions', v_versions,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

-- Новая версия «Правил общения» (только добавляется) становится текущей.
CREATE OR REPLACE FUNCTION platform.ai_agent_rules_save_v1(p_organization_id UUID, p_body TEXT,
  p_expected_current_version INTEGER, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_settings platform_private.ai_settings;
  v_current_version INTEGER; v_rules platform_private.ai_rules_versions;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_body IS NULL OR btrim(p_body) = '' OR octet_length(p_body) > 32768 THEN
    RAISE EXCEPTION 'ai_rules_invalid_body' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('body', p_body,
    'expectedCurrentVersion', p_expected_current_version));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'rules.save', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_settings FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id FOR UPDATE;
  SELECT r.version INTO v_current_version FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = p_organization_id AND r.id = v_settings.rules_version_id;
  IF p_expected_current_version IS DISTINCT FROM v_current_version THEN
    RAISE EXCEPTION 'ai_rules_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO platform_private.ai_rules_versions (organization_id, version, body, source, created_by)
  VALUES (p_organization_id, COALESCE((SELECT max(r.version) FROM platform_private.ai_rules_versions r
    WHERE r.organization_id = p_organization_id), 0) + 1, p_body, 'manual', v_actor.membership_id)
  RETURNING * INTO v_rules;
  UPDATE platform_private.ai_settings s SET rules_version_id = v_rules.id, version = s.version + 1,
    updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'rules.save', v_fp,
    jsonb_build_object('status', 'applied', 'rulesVersionId', v_rules.id, 'version', v_rules.version,
      'bytes', octet_length(v_rules.body)),
    'ai.agent.rules.save', 'ai_rules_version', v_rules.id,
    jsonb_build_object('rulesVersionId', v_settings.rules_version_id, 'version', v_current_version),
    'ИИ-агент: новая версия «Правил общения»');
END
$$;

-- «Проверено»: подтверждение версии ставится один раз.
CREATE OR REPLACE FUNCTION platform.ai_agent_rules_confirm_v1(p_organization_id UUID, p_rules_version_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_rules platform_private.ai_rules_versions;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('rulesVersionId', p_rules_version_id));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'rules.confirm', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = p_organization_id AND r.id = p_rules_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_rules_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rules.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'ai_rules_already_confirmed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE platform_private.ai_rules_versions r SET confirmed_at = statement_timestamp(),
    confirmed_by = v_actor.membership_id
  WHERE r.id = v_rules.id;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'rules.confirm', v_fp,
    jsonb_build_object('status', 'confirmed', 'rulesVersionId', v_rules.id, 'version', v_rules.version),
    'ai.agent.rules.confirm', 'ai_rules_version', v_rules.id,
    jsonb_build_object('confirmedAt', NULL), 'ИИ-агент: «Правила общения» проверены');
END
$$;

-- «Расходы»: сегодня, месяц, прогноз, по назначению и группам, средняя цена
-- ответа, смена цен. Все суммы — SUM по ai_usage_daily.
CREATE OR REPLACE FUNCTION platform.ai_agent_spend_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_today DATE; v_month_start DATE;
  v_days_in_month INTEGER; v_days_elapsed INTEGER; v_today_usd NUMERIC; v_month_usd NUMERIC;
  v_month_estimated_usd NUMERIC; v_month_estimated BOOLEAN; v_answers BIGINT; v_answer_cost NUMERIC;
  v_reserved NUMERIC;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  v_settings := platform_private.ai_settings_row(p_organization_id);
  v_today := platform_private.ai_local_day(clock_timestamp());
  v_month_start := date_trunc('month', v_today)::DATE;
  v_days_in_month := ((v_month_start + INTERVAL '1 month')::DATE - v_month_start);
  v_days_elapsed := v_today - v_month_start + 1;
  SELECT COALESCE(sum(u.cost_usd), 0) INTO v_today_usd FROM platform_private.ai_usage_daily u
  WHERE u.organization_id = p_organization_id AND u.day = v_today;
  SELECT COALESCE(sum(u.cost_usd), 0), COALESCE(sum(u.estimated_cost_usd), 0), COALESCE(bool_or(u.estimated), FALSE),
    COALESCE(sum(u.answers), 0),
    COALESCE(sum(u.cost_usd) FILTER (WHERE u.purpose IN ('answer', 'rewrite', 'embed_query')), 0)
  INTO v_month_usd, v_month_estimated_usd, v_month_estimated, v_answers, v_answer_cost
  FROM platform_private.ai_usage_daily u
  WHERE u.organization_id = p_organization_id AND u.day BETWEEN v_month_start AND v_today;
  SELECT COALESCE(sum(b.usd), 0) INTO v_reserved FROM platform_private.ai_budget_reservations b
  WHERE b.organization_id = p_organization_id AND b.settled_at IS NULL
    AND b.created_at > clock_timestamp() - INTERVAL '15 minutes';
  RETURN jsonb_build_object(
    'currency', 'USD', 'timezone', v_settings.timezone, 'today', v_today, 'monthStart', v_month_start,
    'todayUsd', v_today_usd, 'monthUsd', v_month_usd, 'monthEstimatedUsd', v_month_estimated_usd,
    'monthEstimated', v_month_estimated,
    'forecastUsd', round(v_month_usd / v_days_elapsed * v_days_in_month, 6),
    'monthlyCapUsd', v_settings.monthly_cap_usd, 'reservedUsd', v_reserved,
    'remainingUsd', greatest(0, v_settings.monthly_cap_usd - v_month_usd - v_reserved),
    'answers', v_answers,
    'averageAnswerUsd', CASE WHEN v_answers > 0 THEN round(v_answer_cost / v_answers, 6) END,
    'byPurpose', (SELECT COALESCE(jsonb_agg(jsonb_build_object('purpose', x.purpose,
        'group', platform_private.ai_purpose_group(x.purpose), 'usd', x.usd, 'calls', x.calls,
        'estimated', x.estimated) ORDER BY x.usd DESC, x.purpose), '[]'::JSONB)
      FROM (SELECT u.purpose, sum(u.cost_usd) AS usd, sum(u.calls) AS calls, bool_or(u.estimated) AS estimated
        FROM platform_private.ai_usage_daily u
        WHERE u.organization_id = p_organization_id AND u.day BETWEEN v_month_start AND v_today
        GROUP BY u.purpose) x),
    'byGroup', (SELECT COALESCE(jsonb_agg(jsonb_build_object('group', x.grp, 'usd', x.usd, 'calls', x.calls,
        'estimated', x.estimated) ORDER BY x.usd DESC, x.grp), '[]'::JSONB)
      FROM (SELECT platform_private.ai_purpose_group(u.purpose) AS grp, sum(u.cost_usd) AS usd,
          sum(u.calls) AS calls, bool_or(u.estimated) AS estimated
        FROM platform_private.ai_usage_daily u
        WHERE u.organization_id = p_organization_id AND u.day BETWEEN v_month_start AND v_today
        GROUP BY 1) x),
    'days', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', x.day, 'usd', x.usd) ORDER BY x.day), '[]'::JSONB)
      FROM (SELECT u.day, sum(u.cost_usd) AS usd FROM platform_private.ai_usage_daily u
        WHERE u.organization_id = p_organization_id AND u.day BETWEEN v_month_start AND v_today
        GROUP BY u.day) x),
    'priceChanges', (SELECT COALESCE(jsonb_agg(jsonb_build_object('model', p.model, 'kind', p.kind,
        'effectiveFrom', p.effective_from, 'usdPerMillion', p.usd_per_million,
        'previousUsdPerMillion', platform_private.ai_price(p.model, p.kind, p.effective_from - 1))
        ORDER BY p.effective_from, p.model, p.kind), '[]'::JSONB)
      FROM platform_private.ai_prices p
      WHERE p.effective_from > v_today AND p.model IN (v_settings.answer_model, v_settings.fast_model,
        v_settings.vision_model, v_settings.arbiter_model, v_settings.arbiter_fallback_model,
        v_settings.embedding_model)));
END
$$;

-- Настройки агента (чтение).
CREATE OR REPLACE FUNCTION platform.ai_agent_settings_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_consent_name TEXT; v_today DATE;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  v_settings := platform_private.ai_settings_row(p_organization_id);
  v_today := platform_private.ai_local_day(clock_timestamp());
  SELECT p.display_name INTO v_consent_name FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.id = v_settings.gemini_consent_by;
  RETURN jsonb_build_object('version', v_settings.version,
    'models', jsonb_build_object('answer', v_settings.answer_model, 'fast', v_settings.fast_model,
      'vision', v_settings.vision_model, 'arbiter', v_settings.arbiter_model,
      'arbiterFallback', v_settings.arbiter_fallback_model, 'embedding', v_settings.embedding_model),
    'unpricedModels', to_jsonb(platform_private.ai_unpriced_models(v_settings, v_today)),
    'embeddingDim', v_settings.embedding_dim, 'monthlyCapUsd', v_settings.monthly_cap_usd,
    'ratePerMemberMinute', v_settings.rate_per_member_minute, 'timezone', v_settings.timezone,
    'rerankMode', v_settings.rerank_mode, 'precomputeEnabled', v_settings.precompute_enabled,
    'memoryEnabled', v_settings.memory_enabled, 'knowledgeVersion', v_settings.knowledge_version,
    'consent', jsonb_build_object('recorded', v_settings.gemini_consent_at IS NOT NULL,
      'at', v_settings.gemini_consent_at, 'byName', v_consent_name,
      'textVersion', v_settings.gemini_consent_text_version),
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id),
    'isAdmin', v_actor.is_admin);
END
$$;

-- Изменение настроек: месячный лимит и ID моделей. Модель эмбеддингов не
-- меняется, пока есть векторы (иначе нужен полный переиндекс).
CREATE OR REPLACE FUNCTION platform.ai_agent_settings_save_v1(p_organization_id UUID, p_expected_version BIGINT,
  p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_settings;
  v_new platform_private.ai_settings; v_key TEXT; v_today DATE;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::JSONB
    OR (p_patch - ARRAY['monthlyCapUsd', 'answerModel', 'fastModel', 'visionModel', 'arbiterModel',
      'arbiterFallbackModel', 'embeddingModel']) <> '{}'::JSONB
    OR (p_patch ? 'monthlyCapUsd' AND (jsonb_typeof(p_patch -> 'monthlyCapUsd') <> 'number'
      OR (p_patch ->> 'monthlyCapUsd')::NUMERIC NOT BETWEEN 0 AND 100000)) THEN
    RAISE EXCEPTION 'ai_settings_invalid_patch' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['answerModel', 'fastModel', 'visionModel', 'arbiterModel', 'arbiterFallbackModel',
    'embeddingModel'] LOOP
    IF p_patch ? v_key AND (jsonb_typeof(p_patch -> v_key) <> 'string'
      OR (p_patch ->> v_key) !~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$' OR (p_patch ->> v_key) LIKE '%latest%') THEN
      RAISE EXCEPTION 'ai_settings_invalid_model' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('expectedVersion', p_expected_version, 'patch', p_patch));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'settings.save', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  PERFORM platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_old FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM v_old.version THEN
    RAISE EXCEPTION 'ai_settings_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_patch ? 'embeddingModel' AND (p_patch ->> 'embeddingModel') <> v_old.embedding_model
    AND EXISTS (SELECT 1 FROM platform_private.ai_chunks c
      WHERE c.organization_id = p_organization_id AND c.embedding IS NOT NULL) THEN
    RAISE EXCEPTION 'ai_embedding_model_locked' USING ERRCODE = '22023';
  END IF;
  -- Новую модель можно выбрать, только если у неё есть цена на сегодня:
  -- иначе её вызовы записывались бы по 0 и месячный лимит не работал (§10).
  v_today := platform_private.ai_local_day(clock_timestamp());
  FOREACH v_key IN ARRAY ARRAY['answerModel', 'fastModel', 'visionModel', 'arbiterModel', 'arbiterFallbackModel',
    'embeddingModel'] LOOP
    IF p_patch ? v_key AND (p_patch ->> v_key) IS DISTINCT FROM (CASE v_key
        WHEN 'answerModel' THEN v_old.answer_model WHEN 'fastModel' THEN v_old.fast_model
        WHEN 'visionModel' THEN v_old.vision_model WHEN 'arbiterModel' THEN v_old.arbiter_model
        WHEN 'arbiterFallbackModel' THEN v_old.arbiter_fallback_model ELSE v_old.embedding_model END)
      AND NOT platform_private.ai_model_priced(p_patch ->> v_key, v_key = 'embeddingModel', v_today) THEN
      RAISE EXCEPTION 'ai_settings_unpriced_model' USING ERRCODE = '22023', DETAIL = p_patch ->> v_key;
    END IF;
  END LOOP;
  UPDATE platform_private.ai_settings s SET
    monthly_cap_usd = COALESCE((p_patch ->> 'monthlyCapUsd')::NUMERIC, s.monthly_cap_usd),
    answer_model = COALESCE(p_patch ->> 'answerModel', s.answer_model),
    fast_model = COALESCE(p_patch ->> 'fastModel', s.fast_model),
    vision_model = COALESCE(p_patch ->> 'visionModel', s.vision_model),
    arbiter_model = COALESCE(p_patch ->> 'arbiterModel', s.arbiter_model),
    arbiter_fallback_model = COALESCE(p_patch ->> 'arbiterFallbackModel', s.arbiter_fallback_model),
    embedding_model = COALESCE(p_patch ->> 'embeddingModel', s.embedding_model),
    version = s.version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id RETURNING * INTO v_new;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'settings.save', v_fp,
    jsonb_build_object('status', 'applied', 'version', v_new.version, 'monthlyCapUsd', v_new.monthly_cap_usd,
      'models', jsonb_build_object('answer', v_new.answer_model, 'fast', v_new.fast_model,
        'vision', v_new.vision_model, 'arbiter', v_new.arbiter_model,
        'arbiterFallback', v_new.arbiter_fallback_model, 'embedding', v_new.embedding_model)),
    'ai.agent.settings.save', 'organization', p_organization_id,
    jsonb_build_object('version', v_old.version, 'monthlyCapUsd', v_old.monthly_cap_usd,
      'models', jsonb_build_object('answer', v_old.answer_model, 'fast', v_old.fast_model,
        'vision', v_old.vision_model, 'arbiter', v_old.arbiter_model,
        'arbiterFallback', v_old.arbiter_fallback_model, 'embedding', v_old.embedding_model)),
    'ИИ-агент: изменены настройки');
END
$$;

-- Согласие владельца на передачу текстов клиентов в Gemini (Q4): записывает
-- и отзывает только admin (§13).
CREATE OR REPLACE FUNCTION platform.ai_agent_consent_record_v1(p_organization_id UUID, p_action TEXT,
  p_text_version TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_old platform_private.ai_settings;
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
    version = s.version + 1, updated_at = statement_timestamp(), updated_by = v_actor.membership_id
  WHERE s.organization_id = p_organization_id;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'consent.' || p_action, v_fp,
    jsonb_build_object('status', CASE WHEN p_action = 'grant' THEN 'granted' ELSE 'revoked' END,
      'textVersion', p_text_version),
    'ai.agent.consent.' || p_action, 'organization', p_organization_id,
    jsonb_build_object('recorded', v_old.gemini_consent_at IS NOT NULL,
      'textVersion', v_old.gemini_consent_text_version),
    CASE WHEN p_action = 'grant' THEN 'ИИ-агент: записано согласие на передачу текстов в Gemini'
      ELSE 'ИИ-агент: согласие на передачу текстов в Gemini отозвано' END);
END
$$;

-- Начальное наполнение из «Базы знаний» (§14): только admin и только узлы
-- закрытого списка — область internal, kind page, не удалены и не в архиве
-- (вместе с предками), в корневых папках «ИИ-ассистент», «Компания» или
-- «Страны и поступление», с пометкой импорта
-- historically_approved_general_client_knowledge или
-- historically_approved_internal_knowledge. Аудитория — из пометки.
-- p_target 'document': копия текущей версии каждой страницы в ai_documents и
-- указатель seed в очередь; та же версия узла повторно не копируется, новая
-- версия заменит старую, когда будет готова. p_target 'rules': страницы
-- (в заданном порядке) → новая версия «Правил общения» source 'seed' без
-- подтверждения («нужна проверка»).
CREATE OR REPLACE FUNCTION platform.ai_agent_seed_from_kb_v1(p_organization_id UUID, p_node_ids UUID[],
  p_target TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_ids UUID[]; v_roots TEXT[]; v_node RECORD;
  v_live platform_private.ai_documents; v_doc platform_private.ai_documents; v_created JSONB := '[]'::JSONB;
  v_unchanged JSONB := '[]'::JSONB; v_body TEXT; v_rules platform_private.ai_rules_versions;
  v_receipt JSONB; v_resource UUID;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_admin_actor(p_organization_id);
  IF p_target IS NULL OR p_target NOT IN ('document', 'rules') OR p_node_ids IS NULL
    OR cardinality(p_node_ids) NOT BETWEEN 1 AND 300 OR array_position(p_node_ids, NULL) IS NOT NULL
    OR cardinality(p_node_ids) <> (SELECT count(DISTINCT n) FROM unnest(p_node_ids) n) THEN
    RAISE EXCEPTION 'ai_seed_invalid' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('target', p_target, 'nodeIds', to_jsonb(p_node_ids)));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'seed.' || p_target, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- Закрытый список: обход от трёх корневых папок области internal, только
  -- живые (не удалённые и не в архиве) узлы и их предки.
  WITH RECURSIVE tree AS (
    SELECT n.id, n.title AS root FROM platform_private.kb_nodes n
    WHERE n.organization_id = p_organization_id AND n.area = 'internal' AND n.kind = 'folder'
      AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
    UNION ALL
    SELECT c.id, t.root FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
    WHERE c.organization_id = p_organization_id AND c.area = 'internal'
      AND c.deleted_at IS NULL AND c.archived_at IS NULL
  )
  SELECT array_agg(n.id ORDER BY u.ord), array_agg(t.root ORDER BY u.ord) INTO v_ids, v_roots
  FROM unnest(p_node_ids) WITH ORDINALITY AS u(id, ord)
  JOIN platform_private.kb_nodes n ON n.id = u.id
  JOIN tree t ON t.id = n.id
  WHERE n.organization_id = p_organization_id AND n.area = 'internal' AND n.kind = 'page'
    AND n.deleted_at IS NULL AND n.archived_at IS NULL AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge');
  IF COALESCE(cardinality(v_ids), 0) <> cardinality(p_node_ids) THEN
    RAISE EXCEPTION 'ai_seed_node_not_allowed' USING ERRCODE = '42501',
      DETAIL = (cardinality(p_node_ids) - COALESCE(cardinality(v_ids), 0))::TEXT
        || ' node(s) outside the seed allowlist';
  END IF;

  IF p_target = 'rules' THEN
    SELECT string_agg('# ' || n.title || E'\n\n' || btrim(n.body), E'\n\n' ORDER BY u.ord) INTO v_body
    FROM unnest(v_ids) WITH ORDINALITY AS u(id, ord) JOIN platform_private.kb_nodes n ON n.id = u.id;
    IF octet_length(v_body) > 32768 THEN
      RAISE EXCEPTION 'ai_rules_invalid_body' USING ERRCODE = '22023', DETAIL = 'seeded rules exceed 32 KB';
    END IF;
    PERFORM platform_private.ai_settings_row(p_organization_id);
    PERFORM 1 FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id FOR UPDATE;
    INSERT INTO platform_private.ai_rules_versions (organization_id, version, body, source, source_ref, created_by)
    VALUES (p_organization_id, COALESCE((SELECT max(r.version) FROM platform_private.ai_rules_versions r
        WHERE r.organization_id = p_organization_id), 0) + 1, v_body, 'seed',
      jsonb_build_object('kind', 'knowledge_base', 'nodes', (SELECT jsonb_agg(jsonb_build_object('nodeId', n.id,
        'nodeVersion', n.version, 'classification', n.source ->> 'classification') ORDER BY u.ord)
        FROM unnest(v_ids) WITH ORDINALITY AS u(id, ord) JOIN platform_private.kb_nodes n ON n.id = u.id)),
      v_actor.membership_id)
    RETURNING * INTO v_rules;
    UPDATE platform_private.ai_settings s SET rules_version_id = v_rules.id, version = s.version + 1,
      updated_at = statement_timestamp(), updated_by = v_actor.membership_id
    WHERE s.organization_id = p_organization_id;
    v_receipt := jsonb_build_object('status', 'applied', 'target', 'rules', 'rulesVersionId', v_rules.id,
      'version', v_rules.version, 'nodeCount', cardinality(v_ids));
    v_resource := v_rules.id;
  ELSE
    FOR v_node IN SELECT n.id, n.title, n.body, n.version, n.source ->> 'classification' AS classification,
        v_roots[u.ord] AS root
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, ord) JOIN platform_private.kb_nodes n ON n.id = u.id
      ORDER BY u.ord LOOP
      IF char_length(v_node.body) > 2000000 THEN
        RAISE EXCEPTION 'ai_seed_page_too_large' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM platform_private.ai_documents d
        WHERE d.organization_id = p_organization_id AND d.source = 'seed_kb' AND d.status <> 'superseded'
          AND d.source_ref ->> 'nodeId' = v_node.id::TEXT AND d.source_ref ->> 'nodeVersion' = v_node.version::TEXT) THEN
        v_unchanged := v_unchanged || jsonb_build_array(v_node.id);
        CONTINUE;
      END IF;
      SELECT * INTO v_live FROM platform_private.ai_documents d
      WHERE d.organization_id = p_organization_id AND d.source = 'seed_kb' AND d.status IN ('ready', 'review')
        AND d.source_ref ->> 'nodeId' = v_node.id::TEXT
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1 FOR UPDATE;
      INSERT INTO platform_private.ai_documents (organization_id, title, kind, audience, status, source,
        source_ref, content_md, replaces_id, created_by, updated_by)
      VALUES (p_organization_id, left(v_node.title, 240), 'knowledge',
        CASE WHEN v_node.classification = 'historically_approved_general_client_knowledge' THEN 'client'
          ELSE 'internal' END,
        'queued', 'seed_kb',
        jsonb_build_object('kind', 'knowledge_base', 'nodeId', v_node.id, 'nodeVersion', v_node.version::TEXT,
          'classification', v_node.classification, 'root', v_node.root),
        v_node.body, v_live.id, v_actor.membership_id, v_actor.membership_id)
      RETURNING * INTO v_doc;
      -- Незавершённые прежние копии этого узла больше не нужны.
      UPDATE platform_private.ai_documents d SET status = 'superseded', superseded_by_id = v_doc.id,
        lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
      WHERE d.organization_id = p_organization_id AND d.source = 'seed_kb' AND d.id <> v_doc.id
        AND d.status IN ('queued', 'processing', 'failed') AND d.source_ref ->> 'nodeId' = v_node.id::TEXT;
      PERFORM platform_private.ai_enqueue('seed', v_doc.id);
      v_created := v_created || jsonb_build_array(jsonb_build_object('documentId', v_doc.id, 'nodeId', v_node.id,
        'audience', v_doc.audience, 'replacesId', v_doc.replaces_id));
    END LOOP;
    v_receipt := jsonb_build_object('status', 'applied', 'target', 'document', 'created', v_created,
      'unchangedNodeIds', v_unchanged);
    v_resource := p_organization_id;
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'seed.' || p_target, v_fp, v_receipt,
    'ai.agent.seed', CASE WHEN p_target = 'rules' THEN 'ai_rules_version' ELSE 'organization' END, v_resource,
    NULL, 'ИИ-агент: начальное наполнение из «Базы знаний»');
END
$$;

-- ===========================================================================
-- Функции сервиса агента (platform_ai_agent, EXECUTE только у evo_ai_agent).
-- ===========================================================================

-- /v1/ready: БД отвечает, очередь на месте.
CREATE OR REPLACE FUNCTION platform_ai_agent.ready_v1()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('ok', TRUE,
    'queue', EXISTS (SELECT 1 FROM pgmq.meta m WHERE m.queue_name = 'ai_agent_work_v1'),
    'deadLetter', EXISTS (SELECT 1 FROM pgmq.meta m WHERE m.queue_name = 'ai_agent_dead_letter_v1'))
$$;

-- Погашение билета: один раз, в течение 60 с, с той же целью; доступ
-- сотрудника и согласие перепроверяются.
CREATE OR REPLACE FUNCTION platform_ai_agent.redeem_ticket_v1(p_ticket TEXT, p_purpose TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash TEXT; v_ticket platform_private.ai_tickets;
BEGIN
  IF p_ticket IS NULL OR p_ticket !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ai_ticket_invalid' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(sha256(decode(p_ticket, 'hex')), 'hex');
  SELECT * INTO v_ticket FROM platform_private.ai_tickets t WHERE t.token_sha256 = v_hash FOR UPDATE;
  IF NOT FOUND OR v_ticket.used_at IS NOT NULL OR v_ticket.expires_at <= clock_timestamp()
    OR v_ticket.purpose IS DISTINCT FROM p_purpose
    OR NOT platform_private.ai_conversation_allowed(v_ticket.organization_id, v_ticket.membership_id,
      v_ticket.conversation_id) THEN
    RAISE EXCEPTION 'ai_ticket_invalid' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(v_ticket.organization_id));
  UPDATE platform_private.ai_tickets t SET used_at = clock_timestamp() WHERE t.token_sha256 = v_hash
  RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('redemptionId', v_ticket.id, 'organizationId', v_ticket.organization_id,
    'membershipId', v_ticket.membership_id, 'purpose', v_ticket.purpose,
    'conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id,
    'validUntil', v_ticket.used_at + INTERVAL '5 minutes');
END
$$;

-- Настройки для генерации: модели, текущие «Правила общения», отпечаток.
-- Текста диалогов здесь нет.
CREATE OR REPLACE FUNCTION platform_ai_agent.settings_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_settings; v_rules platform_private.ai_rules_versions;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = p_organization_id AND r.id = v_settings.rules_version_id;
  RETURN jsonb_build_object('organizationId', p_organization_id,
    'consentRecorded', v_settings.gemini_consent_at IS NOT NULL,
    'models', jsonb_build_object('answer', v_settings.answer_model, 'fast', v_settings.fast_model,
      'vision', v_settings.vision_model, 'arbiter', v_settings.arbiter_model,
      'arbiterFallback', v_settings.arbiter_fallback_model, 'embedding', v_settings.embedding_model),
    'embeddingDim', v_settings.embedding_dim, 'rerankMode', v_settings.rerank_mode,
    'timezone', v_settings.timezone, 'knowledgeVersion', v_settings.knowledge_version,
    'fingerprint', platform_private.ai_knowledge_fingerprint(v_settings),
    'rules', CASE WHEN v_rules.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_rules.id,
      'version', v_rules.version, 'body', v_rules.body, 'needsReview', v_rules.confirmed_at IS NULL) END);
END
$$;

-- Контекст ответа по погашенному билету: последние 20 сообщений (текст,
-- направление, время, пометки медиа без содержимого), минимальная карточка
-- лида (имя, интерес к стране, этап; без телефона, email и документов).
CREATE OR REPLACE FUNCTION platform_ai_agent.conversation_context_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_messages JSONB; v_lead JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('messageId', x.id, 'direction', x.direction,
      'role', CASE WHEN x.direction = 'inbound' THEN 'client' ELSE 'staff' END, 'at', x.created_at,
      'text', x.body_text, 'media', x.media) ORDER BY x.created_at, x.id), '[]'::JSONB)
  INTO v_messages
  FROM (SELECT m.id, m.direction::TEXT AS direction, m.created_at, m.body_text,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', md.media_kind) ORDER BY md.ordinal, md.id), '[]'::JSONB)
       FROM platform.communication_message_media md
       WHERE md.organization_id = m.organization_id AND md.communication_message_id = m.id) AS media
    FROM platform.communication_messages m
    WHERE m.organization_id = v_ticket.organization_id AND m.conversation_id = v_ticket.conversation_id
    ORDER BY m.created_at DESC, m.id DESC LIMIT 20) x;
  -- Только первое слово имени; имя, похожее на номер или адрес, не передаётся.
  SELECT jsonb_build_object('name', CASE WHEN split_part(btrim(cl.display_name), ' ', 1) ~ '[0-9@+]' THEN NULL
      ELSE NULLIF(split_part(btrim(cl.display_name), ' ', 1), '') END,
      'interestDirection', l.interest_direction, 'stage', l.stage_key)
  INTO v_lead
  FROM platform.communication_conversations c
  JOIN platform.leads l ON l.organization_id = c.organization_id AND l.id = c.canonical_lead_id
  LEFT JOIN platform.clients cl ON cl.organization_id = l.organization_id AND cl.id = l.client_id
  WHERE c.organization_id = v_ticket.organization_id AND c.id = v_ticket.conversation_id;
  RETURN jsonb_build_object('conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id,
    'latestInboundMessageId', platform_private.ai_latest_inbound(v_ticket.organization_id, v_ticket.conversation_id),
    'messages', v_messages, 'lead', v_lead, 'memory', NULL);
END
$$;

-- Ранжирование RRF (k = 60) одной аудитории: смысл (halfvec, top-50 на
-- запрос) и точные слова (russian FTS: И терминов, ИЛИ при малом числе
-- совпадений; top-50 по ts_rank_cd). Только документы ready/review, не
-- заменённые.
CREATE OR REPLACE FUNCTION platform_private.ai_search_rank(p_organization_id UUID, p_audience TEXT,
  p_vectors public.halfvec[], p_texts TEXT[])
RETURNS TABLE (chunk_id BIGINT, score DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
SET hnsw.iterative_scan = relaxed_order SET hnsw.ef_search = 100 AS $$
  WITH vec_hits AS (
    SELECT hit.id, row_number() OVER (PARTITION BY q.ord ORDER BY hit.distance, hit.id) AS rnk
    FROM unnest(p_vectors) WITH ORDINALITY AS q(v, ord)
    CROSS JOIN LATERAL (
      SELECT c.id, c.embedding OPERATOR(public.<=>) q.v AS distance
      FROM platform_private.ai_chunks c
      JOIN platform_private.ai_documents d ON d.id = c.document_id
      WHERE c.organization_id = p_organization_id AND c.embedding IS NOT NULL
        AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL AND d.audience = p_audience
      ORDER BY c.embedding OPERATOR(public.<=>) q.v
      LIMIT 50) hit
  ),
  -- Шесть самых длинных (информативных) лексем запроса: сначала И, при
  -- малом числе совпадений (< 5) — ИЛИ.
  text_queries AS (
    SELECT u.ord, terms.and_query, terms.or_query
    FROM unnest(p_texts) WITH ORDINALITY AS u(t, ord)
    CROSS JOIN LATERAL (
      SELECT string_agg(x.quoted, ' & ')::TSQUERY AS and_query, string_agg(x.quoted, ' | ')::TSQUERY AS or_query
      FROM (SELECT '''' || replace(replace(l.lexeme, '\', '\\'), '''', '''''') || '''' AS quoted
        FROM unnest(to_tsvector('pg_catalog.russian'::regconfig, u.t)) l
        ORDER BY char_length(l.lexeme) DESC, l.lexeme LIMIT 6) x) terms
    WHERE terms.and_query IS NOT NULL
  ),
  text_modes AS (
    SELECT tq.ord, CASE WHEN (SELECT count(*) FROM (SELECT 1 FROM platform_private.ai_chunks c
        JOIN platform_private.ai_documents d ON d.id = c.document_id
        WHERE c.organization_id = p_organization_id AND c.fts @@ tq.and_query
          AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL AND d.audience = p_audience
        LIMIT 5) h) < 5 THEN tq.or_query ELSE tq.and_query END AS query
    FROM text_queries tq
  ),
  fts_hits AS (
    SELECT hit.id, row_number() OVER (PARTITION BY tm.ord ORDER BY hit.rank DESC, hit.id) AS rnk
    FROM text_modes tm
    CROSS JOIN LATERAL (
      SELECT c.id, ts_rank_cd(c.fts, tm.query) AS rank
      FROM platform_private.ai_chunks c
      JOIN platform_private.ai_documents d ON d.id = c.document_id
      WHERE c.organization_id = p_organization_id AND c.fts @@ tm.query
        AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL AND d.audience = p_audience
      ORDER BY ts_rank_cd(c.fts, tm.query) DESC, c.id
      LIMIT 50) hit
  )
  SELECT h.id, sum(1.0 / (60 + h.rnk))::DOUBLE PRECISION
  FROM (SELECT v.id, v.rnk FROM vec_hits v UNION ALL SELECT f.id, f.rnk FROM fts_hits f) h
  GROUP BY h.id
$$;
REVOKE ALL ON FUNCTION platform_private.ai_search_rank(UUID, TEXT, public.halfvec[], TEXT[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Гибридный поиск по погашенному билету (§6.2): 5–8 клиентских фрагментов с
-- разнообразием по документам (сначала не больше двух на документ), до 3
-- внутренних по основному запросу, открытые пункты «Листа сверки» на тех же
-- страницах и до 3 подтверждённых примеров (косинус ≥ 0,80, текущая версия
-- знаний).
CREATE OR REPLACE FUNCTION platform_ai_agent.search_v1(p_redemption_id UUID, p_query_embeddings JSONB,
  p_query_texts JSONB, p_limit INTEGER DEFAULT 8, p_internal_limit INTEGER DEFAULT 3)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
SET hnsw.iterative_scan = relaxed_order SET hnsw.ef_search = 100 AS $$
DECLARE v_ticket platform_private.ai_tickets; v_settings platform_private.ai_settings;
  v_vectors public.halfvec[]; v_texts TEXT[]; v_client JSONB; v_internal JSONB; v_review JSONB; v_examples JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8 OR p_internal_limit IS NULL OR p_internal_limit NOT BETWEEN 0 AND 3
    OR p_query_embeddings IS NULL OR jsonb_typeof(p_query_embeddings) <> 'array'
    OR jsonb_array_length(p_query_embeddings) > 4
    OR p_query_texts IS NULL OR jsonb_typeof(p_query_texts) <> 'array' OR jsonb_array_length(p_query_texts) > 4
    OR jsonb_array_length(p_query_embeddings) + jsonb_array_length(p_query_texts) = 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_embeddings) e
      WHERE jsonb_typeof(e) <> 'array' OR jsonb_array_length(e) <> 1536)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_texts) e
      WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'ai_search_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg((e::TEXT)::public.halfvec(1536) ORDER BY o) INTO v_vectors
  FROM jsonb_array_elements(p_query_embeddings) WITH ORDINALITY AS a(e, o);
  SELECT array_agg(e #>> '{}' ORDER BY o) INTO v_texts
  FROM jsonb_array_elements(p_query_texts) WITH ORDINALITY AS a(e, o);

  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.pick), '[]'::JSONB) INTO v_client FROM (
    SELECT jsonb_build_object('chunkId', c.id, 'documentId', d.id, 'title', d.title, 'audience', d.audience,
        'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name, 'sectionPath', c.section_path,
        'context', c.context, 'content', c.content, 'lang', c.lang, 'score', ranked.score) AS j,
      row_number() OVER (ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id) AS pick
    FROM (SELECT s.chunk_id, s.score, row_number() OVER (PARTITION BY ch.document_id ORDER BY s.score DESC, s.chunk_id) AS doc_rank
      FROM platform_private.ai_search_rank(v_ticket.organization_id, 'client', v_vectors, v_texts) s
      JOIN platform_private.ai_chunks ch ON ch.id = s.chunk_id) ranked
    JOIN platform_private.ai_chunks c ON c.id = ranked.chunk_id
    JOIN platform_private.ai_documents d ON d.id = c.document_id
    ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id LIMIT p_limit) x;

  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.score DESC, x.id), '[]'::JSONB) INTO v_internal FROM (
    SELECT c.id, s.score, jsonb_build_object('chunkId', c.id, 'documentId', d.id, 'title', d.title,
        'audience', d.audience, 'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name,
        'sectionPath', c.section_path, 'context', c.context, 'content', c.content, 'lang', c.lang,
        'score', s.score) AS j
    FROM platform_private.ai_search_rank(v_ticket.organization_id, 'internal', v_vectors[1:1], v_texts[1:1]) s
    JOIN platform_private.ai_chunks c ON c.id = s.chunk_id
    JOIN platform_private.ai_documents d ON d.id = c.document_id
    ORDER BY s.score DESC, c.id LIMIT p_internal_limit) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId', r.document_id, 'pageNo', r.page_no, 'kind', r.kind,
      'value', r.value, 'proposed', r.proposed, 'anchor', r.anchor) ORDER BY r.document_id, r.page_no, r.id), '[]'::JSONB)
  INTO v_review
  FROM platform_private.ai_review_items r
  WHERE r.organization_id = v_ticket.organization_id AND r.status = 'open' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_client || v_internal) e
    WHERE (e ->> 'documentId')::UUID = r.document_id
      AND r.page_no BETWEEN COALESCE((e ->> 'pageFrom')::INTEGER, 1) AND COALESCE((e ->> 'pageTo')::INTEGER, 300));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('exampleId', x.id, 'question', x.question, 'answer', x.answer,
      'similarity', x.similarity) ORDER BY x.similarity DESC, x.id), '[]'::JSONB)
  INTO v_examples
  FROM (SELECT g.id, g.question, g.answer, 1 - (g.embedding OPERATOR(public.<=>) v_vectors[1]) AS similarity
    FROM platform_private.ai_golden_examples g
    WHERE v_vectors IS NOT NULL AND g.organization_id = v_ticket.organization_id AND NOT g.needs_review
      AND g.embedding IS NOT NULL AND g.knowledge_version = v_settings.knowledge_version
      AND 1 - (g.embedding OPERATOR(public.<=>) v_vectors[1]) >= 0.80
    ORDER BY g.embedding OPERATOR(public.<=>) v_vectors[1] LIMIT 3) x;

  RETURN jsonb_build_object('client', v_client, 'internal', v_internal, 'review', v_review,
    'examples', v_examples, 'knowledgeVersion', v_settings.knowledge_version,
    'fingerprint', platform_private.ai_knowledge_fingerprint(v_settings));
END
$$;

-- Один генератор на ключ ответа (§6.7). Источник — сообщение билета; если
-- пришло новое входящее, PT409 superseded. Новый полёт берёт отсчёт лимита.
CREATE OR REPLACE FUNCTION platform_ai_agent.answer_claim_v1(p_redemption_id UUID, p_intent TEXT,
  p_flight_owner TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_settings platform_private.ai_settings; v_latest UUID;
  v_latest_out UUID; v_fp TEXT; v_answer platform_private.ai_answers; v_exists BOOLEAN;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  IF p_intent IS NULL OR p_intent NOT IN ('reply', 'followup') OR p_flight_owner IS NULL
    OR char_length(btrim(p_flight_owner)) NOT BETWEEN 1 AND 200
    OR (p_intent = 'reply' AND v_ticket.ref_id IS NULL) THEN
    RAISE EXCEPTION 'ai_answer_invalid_claim' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_answer:' || v_ticket.organization_id::TEXT || ':'
    || v_ticket.conversation_id::TEXT || ':' || p_intent, 269));
  v_latest := platform_private.ai_latest_inbound(v_ticket.organization_id, v_ticket.conversation_id);
  -- Продолжение привязано и к последнему исходящему (ai_answer_anchored).
  v_latest_out := CASE WHEN p_intent = 'followup'
    THEN platform_private.ai_latest_outbound(v_ticket.organization_id, v_ticket.conversation_id) END;
  -- Ответы для прежних сообщений устарели.
  UPDATE platform_private.ai_answers a SET status = 'superseded', updated_at = clock_timestamp()
  WHERE a.organization_id = v_ticket.organization_id AND a.conversation_id = v_ticket.conversation_id
    AND a.intent = p_intent AND a.status IN ('pending', 'ready')
    AND (a.source_message_id IS DISTINCT FROM v_latest OR a.source_outbound_message_id IS DISTINCT FROM v_latest_out);
  IF v_ticket.ref_id IS DISTINCT FROM v_latest THEN
    RAISE EXCEPTION 'superseded' USING ERRCODE = 'PT409';
  END IF;
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
  v_fp := platform_private.ai_knowledge_fingerprint(v_settings);
  SELECT * INTO v_answer FROM platform_private.ai_answers a
  WHERE a.organization_id = v_ticket.organization_id AND a.conversation_id = v_ticket.conversation_id
    AND a.intent = p_intent AND a.source_message_id IS NOT DISTINCT FROM v_latest
    AND a.source_outbound_message_id IS NOT DISTINCT FROM v_latest_out AND a.knowledge_fingerprint = v_fp
  FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND v_answer.status = 'ready' THEN
    RETURN jsonb_build_object('status', 'ready', 'answerId', v_answer.id, 'result', v_answer.result,
      'fingerprint', v_fp);
  END IF;
  IF v_exists AND v_answer.status = 'pending' AND v_answer.flight_owner <> btrim(p_flight_owner)
    AND v_answer.heartbeat_at > clock_timestamp() - INTERVAL '30 seconds' THEN
    RETURN jsonb_build_object('status', 'busy', 'answerId', v_answer.id, 'fingerprint', v_fp);
  END IF;
  PERFORM platform_private.ai_rate_take(v_ticket);
  IF v_exists THEN
    UPDATE platform_private.ai_answers a SET status = 'pending', flight_owner = btrim(p_flight_owner),
      heartbeat_at = clock_timestamp(), requested_by = v_ticket.membership_id, result = NULL, error_code = NULL,
      updated_at = clock_timestamp()
    WHERE a.id = v_answer.id RETURNING * INTO v_answer;
  ELSE
    INSERT INTO platform_private.ai_answers (organization_id, conversation_id, source_message_id,
      source_outbound_message_id, intent, knowledge_fingerprint, status, flight_owner, heartbeat_at, requested_by)
    VALUES (v_ticket.organization_id, v_ticket.conversation_id, v_latest, v_latest_out, p_intent, v_fp, 'pending',
      btrim(p_flight_owner), clock_timestamp(), v_ticket.membership_id)
    RETURNING * INTO v_answer;
  END IF;
  RETURN jsonb_build_object('status', 'claimed', 'answerId', v_answer.id, 'sourceMessageId', v_answer.source_message_id,
    'sourceOutboundMessageId', v_answer.source_outbound_message_id, 'fingerprint', v_fp);
END
$$;

-- Heartbeat генератора (каждые 8 с): если пришло новое входящее (у
-- продолжения — и новое исходящее), ответ помечается superseded и поток
-- завершается кодом superseded (409). Heartbeat и finish принимают только
-- (answer_id, flight_owner) владельца генерации, без погашенного билета и без
-- повторной проверки доступа и согласия: они возвращают только статус, не
-- текст диалога; доступ и согласие проверялись при claim.
CREATE OR REPLACE FUNCTION platform_ai_agent.answer_heartbeat_v1(p_answer_id UUID, p_flight_owner TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_answer platform_private.ai_answers;
BEGIN
  SELECT * INTO v_answer FROM platform_private.ai_answers a WHERE a.id = p_answer_id FOR UPDATE;
  IF NOT FOUND OR v_answer.status <> 'pending' OR v_answer.flight_owner IS DISTINCT FROM btrim(p_flight_owner) THEN
    RAISE EXCEPTION 'ai_answer_not_owned' USING ERRCODE = '42501';
  END IF;
  IF NOT platform_private.ai_answer_anchored(v_answer) THEN
    UPDATE platform_private.ai_answers a SET status = 'superseded', updated_at = clock_timestamp()
    WHERE a.id = v_answer.id;
    RETURN jsonb_build_object('status', 'superseded', 'answerId', v_answer.id);
  END IF;
  UPDATE platform_private.ai_answers a SET heartbeat_at = clock_timestamp() WHERE a.id = v_answer.id;
  RETURN jsonb_build_object('status', 'pending', 'answerId', v_answer.id);
END
$$;

-- Завершение генерации. Маркер [n] в ответе может указывать только на
-- клиентский фрагмент этой организации из действующего документа (ready или
-- review, не заменён — как в поиске); источники — только на фрагменты
-- действующих документов этой организации; внутренние ID guard — на
-- фрагменты этой организации. Что фрагмент был в выдаче поиска, БД не
-- проверяет: выдача не хранится.
CREATE OR REPLACE FUNCTION platform_ai_agent.answer_finish_v1(p_answer_id UUID, p_flight_owner TEXT,
  p_status TEXT, p_result JSONB, p_model TEXT, p_cost_usd NUMERIC, p_timings JSONB, p_error_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_answer platform_private.ai_answers; v_ids BIGINT[]; v_final TEXT; v_result JSONB;
BEGIN
  SELECT * INTO v_answer FROM platform_private.ai_answers a WHERE a.id = p_answer_id FOR UPDATE;
  IF NOT FOUND OR v_answer.status <> 'pending' OR v_answer.flight_owner IS DISTINCT FROM btrim(p_flight_owner) THEN
    RAISE EXCEPTION 'ai_answer_not_owned' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('ready', 'failed')
    OR (p_model IS NOT NULL AND p_model !~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$')
    OR (p_cost_usd IS NOT NULL AND p_cost_usd NOT BETWEEN 0 AND 100)
    OR (p_timings IS NOT NULL AND jsonb_typeof(p_timings) <> 'object')
    OR (p_status = 'failed' AND (p_error_code IS NULL OR p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'))
    OR (p_status = 'ready' AND (p_result IS NULL OR jsonb_typeof(p_result) <> 'object'
      OR jsonb_typeof(p_result -> 'reply') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_result ->> 'reply')) NOT BETWEEN 1 AND 8000
      OR (p_result ? 'citations' AND jsonb_typeof(p_result -> 'citations') <> 'array')
      OR (p_result ? 'sources' AND jsonb_typeof(p_result -> 'sources') <> 'array'))) THEN
    RAISE EXCEPTION 'ai_answer_invalid_result' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'ready' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_result -> 'citations', '[]'::JSONB)) e
        WHERE jsonb_typeof(e -> 'chunk_id') IS DISTINCT FROM 'number' OR (e ->> 'chunk_id') !~ '^[0-9]{1,18}$')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_result -> 'sources', '[]'::JSONB)) e
        WHERE jsonb_typeof(e -> 'chunk_id') IS DISTINCT FROM 'number' OR (e ->> 'chunk_id') !~ '^[0-9]{1,18}$')
      OR jsonb_typeof(COALESCE(p_result #> '{guard,internal_chunk_ids}', '[]'::JSONB)) <> 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_result #> '{guard,internal_chunk_ids}', '[]'::JSONB)) e
        WHERE jsonb_typeof(e) <> 'number' OR e::TEXT !~ '^[0-9]{1,18}$') THEN
      RAISE EXCEPTION 'ai_answer_invalid_result' USING ERRCODE = '22023';
    END IF;
    -- Маркеры [n]: только клиентские фрагменты действующих документов этой организации.
    SELECT COALESCE(array_agg(DISTINCT (e ->> 'chunk_id')::BIGINT), '{}') INTO v_ids
    FROM jsonb_array_elements(COALESCE(p_result -> 'citations', '[]'::JSONB)) e;
    IF (SELECT count(*) FROM platform_private.ai_chunks c JOIN platform_private.ai_documents d ON d.id = c.document_id
        WHERE c.id = ANY (v_ids) AND c.organization_id = v_answer.organization_id AND d.audience = 'client'
          AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL)
      <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'ai_citation_invalid' USING ERRCODE = '22023';
    END IF;
    -- Источники: фрагменты действующих документов этой организации.
    SELECT COALESCE(array_agg(DISTINCT (e ->> 'chunk_id')::BIGINT), '{}') INTO v_ids
    FROM jsonb_array_elements(COALESCE(p_result -> 'sources', '[]'::JSONB)) e;
    IF (SELECT count(*) FROM platform_private.ai_chunks c JOIN platform_private.ai_documents d ON d.id = c.document_id
        WHERE c.id = ANY (v_ids) AND c.organization_id = v_answer.organization_id
          AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL) <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'ai_citation_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT e::TEXT::BIGINT), '{}') INTO v_ids
    FROM jsonb_array_elements(COALESCE(p_result #> '{guard,internal_chunk_ids}', '[]'::JSONB)) e;
    IF (SELECT count(*) FROM platform_private.ai_chunks c
        WHERE c.id = ANY (v_ids) AND c.organization_id = v_answer.organization_id) <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'ai_citation_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_final := CASE WHEN NOT platform_private.ai_answer_anchored(v_answer) THEN 'superseded' ELSE p_status END;
  v_result := CASE WHEN p_status = 'ready' THEN p_result || jsonb_build_object('answer_id', v_answer.id,
    'source_message_id', v_answer.source_message_id, 'intent', v_answer.intent,
    'created_at', clock_timestamp()) END;
  UPDATE platform_private.ai_answers a SET status = v_final, result = v_result,
    error_code = CASE WHEN p_status = 'failed' THEN p_error_code END, model = p_model, cost_usd = p_cost_usd,
    timings = p_timings, heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE a.id = v_answer.id;
  RETURN jsonb_build_object('status', v_final, 'answerId', v_answer.id);
END
$$;

-- Отсчёт лимита «20 ответов в минуту на сотрудника» для погашенного билета
-- (один раз на погашение). 21-й — PT429 ai_rate_limited.
CREATE OR REPLACE FUNCTION platform_ai_agent.rate_take_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  PERFORM platform_private.ai_rate_take(v_ticket);
  RETURN jsonb_build_object('status', 'taken', 'redemptionId', v_ticket.id);
END
$$;

-- Резерв стоимости под месячный лимит EVO (как 162): потрачено за месяц +
-- открытые резервы последних 15 минут + оценка ≤ monthly_cap_usd. Пока у
-- модели из настроек нет цены на сегодня, резерв не выдаётся (PT402
-- ai_model_unpriced): её вызовы не попали бы в лимит.
CREATE OR REPLACE FUNCTION platform_ai_agent.budget_reserve_v1(p_organization_id UUID, p_purpose TEXT,
  p_estimate_usd NUMERIC)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settings platform_private.ai_settings; v_today DATE; v_spent NUMERIC; v_reserved NUMERIC;
  v_id UUID;
BEGIN
  IF p_purpose IS NULL OR platform_private.ai_purpose_group(p_purpose) IS NULL
    OR p_estimate_usd IS NULL OR p_estimate_usd <= 0 OR p_estimate_usd > 5 THEN
    RAISE EXCEPTION 'ai_budget_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  PERFORM platform_private.ai_require_consent(v_settings);
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_budget:' || p_organization_id::TEXT, 269));
  v_today := platform_private.ai_local_day(clock_timestamp());
  IF cardinality(platform_private.ai_unpriced_models(v_settings, v_today)) > 0 THEN
    RAISE EXCEPTION 'ai_model_unpriced' USING ERRCODE = 'PT402',
      DETAIL = array_to_string(platform_private.ai_unpriced_models(v_settings, v_today), ',');
  END IF;
  SELECT COALESCE(sum(u.cost_usd), 0) INTO v_spent FROM platform_private.ai_usage_daily u
  WHERE u.organization_id = p_organization_id AND u.day BETWEEN date_trunc('month', v_today)::DATE AND v_today;
  SELECT COALESCE(sum(b.usd), 0) INTO v_reserved FROM platform_private.ai_budget_reservations b
  WHERE b.organization_id = p_organization_id AND b.settled_at IS NULL
    AND b.created_at > clock_timestamp() - INTERVAL '15 minutes';
  IF v_spent + v_reserved + p_estimate_usd > v_settings.monthly_cap_usd THEN
    RAISE EXCEPTION 'ai_budget_exhausted' USING ERRCODE = 'PT402';
  END IF;
  INSERT INTO platform_private.ai_budget_reservations (organization_id, purpose, usd)
  VALUES (p_organization_id, p_purpose, p_estimate_usd) RETURNING id INTO v_id;
  RETURN jsonb_build_object('reservationId', v_id,
    'remainingUsd', v_settings.monthly_cap_usd - v_spent - v_reserved - p_estimate_usd);
END
$$;

-- Возврат резерва: ответ закончился до первого вызова Gemini (отмена,
-- supersede, PT409/PT429 или ошибка поиска после резерва). Открытый резерв
-- этой организации удаляется сразу, а не занимает лимит ещё 15 минут.
-- Резерв, уже погашенный записанным вызовом (settled_at), не меняется:
-- 'settled'. Чужой, неизвестный или уже возвращённый резерв — 'absent' без
-- изменений, поэтому повтор безопасен. Гонка с usage_record_v1 решается
-- блокировкой строки: погашенный за это время резерв не удаляется.
-- Согласие не проверяется: вернуть резерв нужно и после отзыва.
CREATE OR REPLACE FUNCTION platform_ai_agent.budget_release_v1(p_organization_id UUID, p_reservation_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_settled_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'ai_budget_invalid' USING ERRCODE = '22023';
  END IF;
  DELETE FROM platform_private.ai_budget_reservations b
  WHERE b.id = p_reservation_id AND b.organization_id = p_organization_id AND b.settled_at IS NULL;
  IF FOUND THEN
    RETURN jsonb_build_object('status', 'released', 'reservationId', p_reservation_id);
  END IF;
  SELECT b.settled_at INTO v_settled_at FROM platform_private.ai_budget_reservations b
  WHERE b.id = p_reservation_id AND b.organization_id = p_organization_id;
  RETURN jsonb_build_object('status', CASE WHEN v_settled_at IS NOT NULL THEN 'settled' ELSE 'absent' END,
    'reservationId', p_reservation_id);
END
$$;

-- Журнал расходов: каждый вызов Gemini. Стоимость считается по цене дня
-- (Asia/Bishkek): (вход − кэш) × вход + кэш × кэш + (выход + thinking) ×
-- выход; для эмбеддингов — цена embedding. Повтор call_id не считается.
-- Вызов модели без цены записывается по сумме его резерва (оценка), а не по
-- 0, чтобы месячный лимит рос; без резерва — 0 и пометка unpriced.
CREATE OR REPLACE FUNCTION platform_ai_agent.usage_record_v1(p_organization_id UUID, p_call_id UUID,
  p_purpose TEXT, p_model TEXT, p_input_tokens BIGINT, p_cached_tokens BIGINT, p_output_tokens BIGINT,
  p_thinking_tokens BIGINT, p_estimated BOOLEAN, p_answer BOOLEAN DEFAULT FALSE,
  p_redemption_id UUID DEFAULT NULL, p_reservation_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_day DATE; v_membership UUID; v_in_price NUMERIC; v_out_price NUMERIC; v_cached_price NUMERIC;
  v_unpriced BOOLEAN; v_cost NUMERIC; v_est NUMERIC; v_existing NUMERIC; v_ticket platform_private.ai_tickets;
  v_reserved NUMERIC;
BEGIN
  IF p_call_id IS NULL OR p_purpose IS NULL OR platform_private.ai_purpose_group(p_purpose) IS NULL
    OR p_model IS NULL OR p_model !~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$' OR p_estimated IS NULL OR p_answer IS NULL
    OR p_input_tokens IS NULL OR p_cached_tokens IS NULL OR p_output_tokens IS NULL OR p_thinking_tokens IS NULL
    OR p_input_tokens NOT BETWEEN 0 AND 10000000 OR p_cached_tokens NOT BETWEEN 0 AND p_input_tokens
    OR p_output_tokens NOT BETWEEN 0 AND 10000000 OR p_thinking_tokens NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'ai_usage_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'ai_organization_unknown' USING ERRCODE = 'P0002';
  END IF;
  IF p_redemption_id IS NOT NULL THEN
    SELECT * INTO v_ticket FROM platform_private.ai_tickets t
    WHERE t.id = p_redemption_id AND t.used_at IS NOT NULL AND t.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_redemption_invalid' USING ERRCODE = '42501';
    END IF;
    v_membership := v_ticket.membership_id;
  END IF;
  IF p_reservation_id IS NOT NULL THEN
    SELECT b.usd INTO v_reserved FROM platform_private.ai_budget_reservations b
    WHERE b.id = p_reservation_id AND b.organization_id = p_organization_id AND b.settled_at IS NULL
    FOR UPDATE;
  END IF;
  v_day := platform_private.ai_local_day(clock_timestamp());
  v_in_price := platform_private.ai_price(p_model,
    CASE WHEN p_purpose IN ('embed_query', 'embed_document') THEN 'embedding' ELSE 'input' END, v_day);
  v_out_price := platform_private.ai_price(p_model, 'output', v_day);
  v_cached_price := COALESCE(platform_private.ai_price(p_model, 'cached', v_day), v_in_price);
  v_unpriced := v_in_price IS NULL OR (p_output_tokens + p_thinking_tokens > 0 AND v_out_price IS NULL);
  v_cost := CASE WHEN v_unpriced THEN COALESCE(v_reserved, 0) ELSE round(((p_input_tokens - p_cached_tokens) * v_in_price
    + p_cached_tokens * v_cached_price + (p_output_tokens + p_thinking_tokens) * COALESCE(v_out_price, 0))
    / 1000000.0, 6) END;
  v_est := CASE WHEN p_estimated OR v_unpriced THEN v_cost ELSE 0 END;

  INSERT INTO platform_private.ai_usage_calls (organization_id, call_id, day, cost_usd)
  VALUES (p_organization_id, p_call_id, v_day, v_cost)
  ON CONFLICT (organization_id, call_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT c.cost_usd INTO v_existing FROM platform_private.ai_usage_calls c
    WHERE c.organization_id = p_organization_id AND c.call_id = p_call_id;
    RETURN jsonb_build_object('status', 'replayed', 'costUsd', v_existing);
  END IF;

  INSERT INTO platform_private.ai_usage_daily AS u (organization_id, day, purpose, model, calls, answers,
    input_tokens, cached_tokens, output_tokens, thinking_tokens, cost_usd, estimated_cost_usd, estimated, unpriced_calls)
  VALUES (p_organization_id, v_day, p_purpose, p_model, 1, CASE WHEN p_answer THEN 1 ELSE 0 END,
    p_input_tokens, p_cached_tokens, p_output_tokens, p_thinking_tokens, v_cost, v_est,
    p_estimated OR v_unpriced, CASE WHEN v_unpriced THEN 1 ELSE 0 END)
  ON CONFLICT (organization_id, day, purpose, model) DO UPDATE SET calls = u.calls + 1,
    answers = u.answers + EXCLUDED.answers, input_tokens = u.input_tokens + EXCLUDED.input_tokens,
    cached_tokens = u.cached_tokens + EXCLUDED.cached_tokens, output_tokens = u.output_tokens + EXCLUDED.output_tokens,
    thinking_tokens = u.thinking_tokens + EXCLUDED.thinking_tokens, cost_usd = u.cost_usd + EXCLUDED.cost_usd,
    estimated_cost_usd = u.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
    estimated = u.estimated OR EXCLUDED.estimated, unpriced_calls = u.unpriced_calls + EXCLUDED.unpriced_calls,
    updated_at = statement_timestamp();
  IF v_membership IS NOT NULL THEN
    INSERT INTO platform_private.ai_usage_member_daily AS u (organization_id, day, membership_id, purpose, model,
      calls, answers, input_tokens, cached_tokens, output_tokens, thinking_tokens, cost_usd, estimated_cost_usd,
      estimated, unpriced_calls)
    VALUES (p_organization_id, v_day, v_membership, p_purpose, p_model, 1, CASE WHEN p_answer THEN 1 ELSE 0 END,
      p_input_tokens, p_cached_tokens, p_output_tokens, p_thinking_tokens, v_cost, v_est,
      p_estimated OR v_unpriced, CASE WHEN v_unpriced THEN 1 ELSE 0 END)
    ON CONFLICT (organization_id, day, membership_id, purpose, model) DO UPDATE SET calls = u.calls + 1,
      answers = u.answers + EXCLUDED.answers, input_tokens = u.input_tokens + EXCLUDED.input_tokens,
      cached_tokens = u.cached_tokens + EXCLUDED.cached_tokens, output_tokens = u.output_tokens + EXCLUDED.output_tokens,
      thinking_tokens = u.thinking_tokens + EXCLUDED.thinking_tokens, cost_usd = u.cost_usd + EXCLUDED.cost_usd,
      estimated_cost_usd = u.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
      estimated = u.estimated OR EXCLUDED.estimated, unpriced_calls = u.unpriced_calls + EXCLUDED.unpriced_calls,
      updated_at = statement_timestamp();
  END IF;
  IF p_reservation_id IS NOT NULL THEN
    UPDATE platform_private.ai_budget_reservations b SET settled_at = clock_timestamp()
    WHERE b.id = p_reservation_id AND b.organization_id = p_organization_id AND b.settled_at IS NULL;
  END IF;
  RETURN jsonb_build_object('status', 'recorded', 'costUsd', v_cost, 'estimated', p_estimated OR v_unpriced,
    'unpriced', v_unpriced, 'day', v_day);
END
$$;

-- Документы — материалы компании, не диалоги: воркер берёт документ по
-- указателю очереди под аренду.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_claim_v1(p_document_id UUID, p_worker_ref TEXT,
  p_lease_seconds INTEGER DEFAULT 300)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_settings platform_private.ai_settings;
BEGIN
  IF p_worker_ref IS NULL OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'ai_document_invalid_claim' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'gone');
  END IF;
  IF v_doc.status IN ('ready', 'review', 'superseded', 'failed') THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', v_doc.status);
  END IF;
  IF v_doc.status = 'processing' AND v_doc.lease_owner IS DISTINCT FROM btrim(p_worker_ref)
    AND v_doc.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'busy');
  END IF;
  IF v_doc.attempts >= 5 THEN
    UPDATE platform_private.ai_documents d SET status = 'failed', error_code = 'attempts_exhausted',
      lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
    WHERE d.id = v_doc.id;
    RETURN jsonb_build_object('claimed', FALSE, 'reason', 'failed');
  END IF;
  UPDATE platform_private.ai_documents d SET status = 'processing',
    stage = COALESCE(d.stage, CASE WHEN d.kind = 'knowledge' OR d.edited_in_lab THEN 'chunk' ELSE 'extract' END),
    lease_owner = btrim(p_worker_ref), lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    attempts = d.attempts + 1, row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  v_settings := platform_private.ai_settings_row(v_doc.organization_id);
  RETURN jsonb_build_object('claimed', TRUE, 'documentId', v_doc.id, 'organizationId', v_doc.organization_id,
    'kind', v_doc.kind, 'source', v_doc.source, 'title', v_doc.title, 'audience', v_doc.audience,
    'stage', v_doc.stage, 'attempts', v_doc.attempts,
    'contentMd', CASE WHEN v_doc.kind = 'knowledge' OR v_doc.edited_in_lab THEN v_doc.content_md END,
    'storagePath', v_doc.storage_path, 'mimeType', v_doc.mime_type, 'byteSize', v_doc.byte_size,
    'models', jsonb_build_object('fast', v_settings.fast_model, 'vision', v_settings.vision_model,
      'arbiter', v_settings.arbiter_model, 'arbiterFallback', v_settings.arbiter_fallback_model,
      'embedding', v_settings.embedding_model),
    'leaseExpiresAt', v_doc.lease_expires_at);
END
$$;

-- Этап и прогресс; код ошибки переводит документ в failed.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_stage_v1(p_document_id UUID, p_worker_ref TEXT,
  p_stage TEXT, p_progress INTEGER, p_error_code TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents;
BEGIN
  IF p_stage IS NULL OR p_stage NOT IN ('extract', 'ocr', 'structure', 'chunk', 'enrich', 'embed', 'index')
    OR p_progress IS NULL OR p_progress NOT BETWEEN 0 AND 100
    OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RAISE EXCEPTION 'ai_document_invalid_stage' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_gone' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.status <> 'processing' OR v_doc.lease_owner IS DISTINCT FROM btrim(p_worker_ref) THEN
    RAISE EXCEPTION 'ai_document_not_leased' USING ERRCODE = '42501';
  END IF;
  UPDATE platform_private.ai_documents d SET stage = p_stage, progress = p_progress,
    status = CASE WHEN p_error_code IS NULL THEN 'processing' ELSE 'failed' END, error_code = p_error_code,
    lease_owner = CASE WHEN p_error_code IS NULL THEN d.lease_owner END,
    lease_expires_at = CASE WHEN p_error_code IS NULL THEN greatest(d.lease_expires_at, clock_timestamp() + INTERVAL '5 minutes') END,
    row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  RETURN jsonb_build_object('status', v_doc.status, 'stage', v_doc.stage, 'progress', v_doc.progress);
END
$$;

-- Индексация одной транзакцией (§5.3): заменить фрагменты, выставить ready
-- или review, заменить прежнюю версию документа (её фрагменты уходят из
-- поиска только сейчас), увеличить knowledge_version. Не больше 2 000
-- фрагментов за вызов.
CREATE OR REPLACE FUNCTION platform_ai_agent.document_index_v1(p_document_id UUID, p_worker_ref TEXT,
  p_chunks JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_doc platform_private.ai_documents; v_count INTEGER; v_knowledge BIGINT;
BEGIN
  IF p_chunks IS NULL OR jsonb_typeof(p_chunks) <> 'array' OR jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 2000
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_chunks) e WHERE jsonb_typeof(e) <> 'object'
      OR (e - ARRAY['position', 'sectionPath', 'content', 'context', 'lang', 'indexText', 'pageFrom', 'pageTo',
        'sheetName', 'boxes', 'tokens', 'embedding']) <> '{}'::JSONB
      OR jsonb_typeof(e -> 'position') <> 'number' OR jsonb_typeof(e -> 'content') <> 'string'
      OR (e ? 'embedding' AND jsonb_typeof(e -> 'embedding') <> 'null'
        AND (jsonb_typeof(e -> 'embedding') <> 'array' OR jsonb_array_length(e -> 'embedding') <> 1536))) THEN
    RAISE EXCEPTION 'ai_document_invalid_chunks' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_document_gone' USING ERRCODE = 'P0002';
  END IF;
  IF v_doc.status <> 'processing' OR v_doc.lease_owner IS DISTINCT FROM btrim(p_worker_ref) THEN
    RAISE EXCEPTION 'ai_document_not_leased' USING ERRCODE = '42501';
  END IF;
  DELETE FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.id;
  INSERT INTO platform_private.ai_chunks (organization_id, document_id, position, section_path, content, context,
    lang, index_text, page_from, page_to, sheet_name, boxes, tokens, embedding)
  SELECT v_doc.organization_id, v_doc.id, (e ->> 'position')::INTEGER, COALESCE(e ->> 'sectionPath', ''),
    e ->> 'content', COALESCE(e ->> 'context', ''), COALESCE(e ->> 'lang', 'ru'), e ->> 'indexText',
    (e ->> 'pageFrom')::INTEGER, (e ->> 'pageTo')::INTEGER, e ->> 'sheetName',
    CASE WHEN jsonb_typeof(e -> 'boxes') = 'array' THEN e -> 'boxes' END, (e ->> 'tokens')::INTEGER,
    CASE WHEN jsonb_typeof(e -> 'embedding') = 'array' THEN ((e -> 'embedding')::TEXT)::public.halfvec(1536) END
  FROM jsonb_array_elements(p_chunks) e;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE platform_private.ai_documents d SET
    status = CASE WHEN EXISTS (SELECT 1 FROM platform_private.ai_review_items r
      WHERE r.document_id = d.id AND r.status = 'open') THEN 'review' ELSE 'ready' END,
    stage = 'index', progress = 100, error_code = NULL, lease_owner = NULL, lease_expires_at = NULL,
    doc_version = CASE WHEN d.indexed_at IS NULL THEN d.doc_version ELSE d.doc_version + 1 END,
    indexed_at = clock_timestamp(), row_version = d.row_version + 1, updated_at = statement_timestamp()
  WHERE d.id = v_doc.id RETURNING * INTO v_doc;
  IF v_doc.replaces_id IS NOT NULL THEN
    UPDATE platform_private.ai_documents d SET status = 'superseded', superseded_by_id = v_doc.id,
      autosend_allowed = FALSE, lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1,
      updated_at = statement_timestamp()
    WHERE d.organization_id = v_doc.organization_id AND d.id = v_doc.replaces_id AND d.status <> 'superseded';
    DELETE FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.replaces_id;
  END IF;
  v_knowledge := platform_private.ai_bump_knowledge(v_doc.organization_id);
  RETURN jsonb_build_object('status', v_doc.status, 'chunkCount', v_count, 'knowledgeVersion', v_knowledge,
    'replacedId', v_doc.replaces_id);
END
$$;

-- Очередь агента: только указатели. Больше трёх чтений — dead-letter.
CREATE OR REPLACE FUNCTION platform_ai_agent.work_claim_v1(p_visibility_seconds INTEGER, p_worker_ref TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_msg RECORD; v_valid BOOLEAN; i INTEGER;
BEGIN
  IF p_visibility_seconds IS NULL OR p_visibility_seconds NOT BETWEEN 5 AND 900 OR p_worker_ref IS NULL
    OR char_length(btrim(p_worker_ref)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ai_work_invalid_claim' USING ERRCODE = '22023';
  END IF;
  FOR i IN 1..10 LOOP
    SELECT r.msg_id, r.read_ct, r.message INTO v_msg
    FROM pgmq.read('ai_agent_work_v1', p_visibility_seconds, 1, '{}'::JSONB) r;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('claimed', FALSE);
    END IF;
    v_valid := jsonb_typeof(v_msg.message) = 'object'
      AND (v_msg.message - ARRAY['v', 'kind', 'ref_id']) = '{}'::JSONB
      AND v_msg.message ->> 'v' = '1'
      AND v_msg.message ->> 'kind' IN ('ingest', 'reindex', 'memory', 'autosend', 'seed')
      AND (v_msg.message ->> 'ref_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    IF NOT COALESCE(v_valid, FALSE) THEN
      PERFORM pgmq.send('ai_agent_dead_letter_v1', jsonb_build_object('v', 1, 'kind', 'invalid', 'ref_id', NULL,
        'reason', 'malformed', 'msg_id', v_msg.msg_id), 0);
      PERFORM pgmq.archive('ai_agent_work_v1', v_msg.msg_id);
      CONTINUE;
    END IF;
    IF v_msg.read_ct > 3 THEN
      PERFORM pgmq.send('ai_agent_dead_letter_v1', jsonb_build_object('v', 1, 'kind', v_msg.message ->> 'kind',
        'ref_id', v_msg.message ->> 'ref_id', 'reason', 'max_attempts', 'msg_id', v_msg.msg_id), 0);
      PERFORM pgmq.archive('ai_agent_work_v1', v_msg.msg_id);
      IF v_msg.message ->> 'kind' IN ('ingest', 'reindex', 'seed') THEN
        UPDATE platform_private.ai_documents d SET status = 'failed', error_code = 'attempts_exhausted',
          lease_owner = NULL, lease_expires_at = NULL, row_version = d.row_version + 1, updated_at = statement_timestamp()
        WHERE d.id = (v_msg.message ->> 'ref_id')::UUID AND d.status IN ('queued', 'processing');
      END IF;
      CONTINUE;
    END IF;
    RETURN jsonb_build_object('claimed', TRUE, 'msgId', v_msg.msg_id, 'kind', v_msg.message ->> 'kind',
      'refId', v_msg.message ->> 'ref_id', 'readCount', v_msg.read_ct);
  END LOOP;
  RETURN jsonb_build_object('claimed', FALSE);
END
$$;

CREATE OR REPLACE FUNCTION platform_ai_agent.work_extend_v1(p_msg_id BIGINT, p_visibility_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_msg_id IS NULL OR p_visibility_seconds IS NULL OR p_visibility_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'ai_work_invalid_extend' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_count FROM pgmq.set_vt('ai_agent_work_v1', p_msg_id, p_visibility_seconds);
  RETURN jsonb_build_object('extended', v_count > 0);
END
$$;

-- done — в архив; retry — снова видно через p_retry_seconds; dead — указатель
-- в dead-letter.
CREATE OR REPLACE FUNCTION platform_ai_agent.work_finish_v1(p_msg_id BIGINT, p_outcome TEXT,
  p_retry_seconds INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_message JSONB; v_done BOOLEAN; v_count INTEGER;
BEGIN
  IF p_msg_id IS NULL OR p_outcome IS NULL OR p_outcome NOT IN ('done', 'retry', 'dead')
    OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'ai_work_invalid_finish' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'retry' THEN
    SELECT count(*) INTO v_count FROM pgmq.set_vt('ai_agent_work_v1', p_msg_id, p_retry_seconds);
    RETURN jsonb_build_object('finished', v_count > 0, 'outcome', p_outcome);
  END IF;
  IF p_outcome = 'dead' THEN
    SELECT q.message INTO v_message FROM pgmq.q_ai_agent_work_v1 q WHERE q.msg_id = p_msg_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('finished', FALSE, 'outcome', p_outcome);
    END IF;
    PERFORM pgmq.send('ai_agent_dead_letter_v1', jsonb_build_object('v', 1, 'kind', v_message ->> 'kind',
      'ref_id', v_message ->> 'ref_id', 'reason', 'terminal', 'msg_id', p_msg_id), 0);
  END IF;
  SELECT pgmq.archive('ai_agent_work_v1', p_msg_id) INTO v_done;
  RETURN jsonb_build_object('finished', COALESCE(v_done, FALSE), 'outcome', p_outcome);
END
$$;

-- Уборка: билеты старше суток, ответы старше 90 дней, окна лимита, ключи
-- повтора расходов старше 3 дней, резервы старше суток.
CREATE OR REPLACE FUNCTION platform_ai_agent.maintenance_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tickets INTEGER; v_answers INTEGER; v_rates INTEGER; v_calls INTEGER; v_reservations INTEGER;
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
  RETURN jsonb_build_object('tickets', v_tickets, 'answers', v_answers, 'rateWindows', v_rates,
    'usageCalls', v_calls, 'reservations', v_reservations);
END
$$;

-- ===========================================================================
-- Гранты: сотрудникам — только platform.ai_agent_*_v1 (authenticated);
-- агенту — только функции platform_ai_agent (evo_ai_agent).
-- ===========================================================================
DO $ai269_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%\_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_ai_agent' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO evo_ai_agent', f);
  END LOOP;
END
$ai269_acl$;

-- Точный список функций обеих поверхностей; лишняя функция — ошибка.
DO $ai269_inventory$
DECLARE v_staff TEXT[]; v_agent TEXT[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_staff FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_agent FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_ai_agent';
  IF v_staff IS DISTINCT FROM ARRAY['ai_agent_answer_current_v1', 'ai_agent_answer_insert_v1',
      'ai_agent_consent_record_v1', 'ai_agent_document_delete_v1', 'ai_agent_document_retry_v1',
      'ai_agent_document_update_v1', 'ai_agent_documents_v1', 'ai_agent_rules_confirm_v1', 'ai_agent_rules_save_v1',
      'ai_agent_rules_v1', 'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1', 'ai_agent_settings_v1',
      'ai_agent_spend_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1', 'document_index_v1',
      'document_stage_v1', 'maintenance_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1', 'search_v1',
      'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1', 'work_finish_v1'] THEN
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
$ai269_inventory$;

COMMENT ON FUNCTION platform.ai_agent_ticket_v1(UUID, TEXT, UUID, UUID) IS
  'AI agent P1: one-time 60 s ticket for the private agent service; staff with ai.agent.use who can read the sales conversation; consent required.';
COMMENT ON FUNCTION platform_ai_agent.redeem_ticket_v1(TEXT, TEXT) IS
  'AI agent P1: single-use redemption of a CRM ticket; access and consent re-checked.';

NOTIFY pgrst, 'reload schema';
COMMIT;
