-- 318: «ИИ-агенты»: три мелкие правки по ревью #1290 (docs/PLAN_CHANGES.md «2026-10-23 · ИИ-агенты: ответы
-- владельца в инструкциях, курсы для продаж, мелкие исправления (миграция 318)»). Номер 318: на origin/main
-- последняя 317; хуки набора привязаны к имени файла, не к номеру.
--
-- Forward-only. Заменяемые тела закреплены md5 их вида из 317 (шаблон 303/304/312/316): расхождение
-- останавливает миграцию, ничего не меняя. Повторный запуск: a318_already_applied (55000). SECURITY DEFINER
-- с пустым search_path у всего нового; новые функции рантайма доступны только service_role, помощники - никому.
--
--  a) Сбой синхронизации не блокирует агента. 317 пускала «Поручить» и события только при
--     sync_status = 'ok': неудачная повторная синхронизация (error) или прерванная (pending) запирала агента,
--     у которого в Claude уже есть рабочая настройка. platform_private.ai_agent_claude_usable(агент) - «агент
--     можно запускать»: ok с id агента, среды и хранилища (как раньше) ИЛИ pending / error с id агента, версией,
--     средой, хранилищем и креденшлом MCP (то есть первая успешная синхронизация дошла до агента). never и
--     ручная смена claudeAgentId (версия обнуляется) по-прежнему дают agent_not_synced. Её читают
--     ai_agents_run_authorize_v1 и ai_agent_runtime_dispatch_targets_v1 (тела 317, одно условие заменено).
--  b) send_message без idempotency_key. Ключ повтора строится из получателя (conversation_id / case_id), канала
--     и SHA-256 нормализованного текста (пробелы сжаты, регистр снят) в том же окне 10 минут и в отдельном
--     пространстве имён (`send_message_auto:`), поэтому ключи модели не пересекаются с выведенными. Два
--     одновременных одинаковых вызова идут по очереди (advisory-блокировка транзакции по ключу). Повтор
--     `needs_dispatch` пересчитывается по состоянию черновика (platform_private.ai_agent_send_replay): ушедший
--     черновик отвечает `sent`, отправляемый или с неизвестным итогом - `queued_unknown`, вернувшийся в
--     ожидание - `draft_created`; `approved` отдаёт прежний ответ (отправка WhatsApp повторяется безопасно:
--     детерминированные id шагов). Тело send_message - 317 с тремя заменёнными местами.
--  c) Одна среда Claude на организацию при одновременных синхронизациях. Два агента, которых синхронизируют
--     одновременно, оба не находили среду и создавали по своей. Теперь среду «находит или создаёт» один:
--     platform.ai_agent_runtime_environment_claim_v1 отвечает `known` (любой агент организации уже записал
--     среду - берём её), `claimed` (выдан токен аренды на 3 минуты, строка настроек организации блокируется
--     FOR UPDATE, поэтому ответ один) или `busy`; platform.ai_agent_runtime_environment_release_v1 снимает
--     аренду по токену. Аренда лежит в трёх новых столбцах ai_agents_org_settings (одна строка на
--     организацию). Приложение без этой миграции продолжает работать как раньше (без аренды).
--
-- Порядок выката. Миграция может идти до приложения: прежнее приложение не вызывает новых функций, а
-- заменённые читаются теми же вызовами; приложение с новым кодом без миграции получает PGRST202 на аренде
-- и синхронизирует как раньше.
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты 317, на которые опирается миграция, и md5 трёх заменяемых тел.
-- ---------------------------------------------------------------------------
DO $a318_anchor$
DECLARE r RECORD;
BEGIN
  IF to_regclass('platform_private.ai_agents') IS NULL
    OR to_regclass('platform_private.ai_agents_org_settings') IS NULL
    OR to_regclass('platform_private.ai_agent_drafts') IS NULL
    OR to_regclass('platform_private.ai_agent_dedupe') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.ai_agent_key_known(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agents_ensure_rows(uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_sha256(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_clean_text(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_get(uuid,text,text,interval)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_put(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform.ai_agents_run_authorize_v1(uuid,text,boolean)') IS NULL
    OR to_regprocedure('platform.ai_agent_runtime_dispatch_targets_v1(uuid,text)') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'a318_anchor_drift: the 317 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform_private.ai_agent_claude_usable(platform_private.ai_agents)') IS NOT NULL
    OR to_regprocedure('platform_private.ai_agent_send_text_norm(text)') IS NOT NULL
    OR to_regprocedure('platform_private.ai_agent_send_replay(uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('platform.ai_agent_runtime_environment_claim_v1(uuid,text)') IS NOT NULL
    OR to_regprocedure('platform.ai_agent_runtime_environment_release_v1(uuid,uuid)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'platform_private'
      AND c.table_name = 'ai_agents_org_settings' AND c.column_name = 'environment_claim_token')
  THEN
    RAISE EXCEPTION 'a318_already_applied' USING ERRCODE = '55000';
  END IF;
  -- 317: тела трёх заменяемых функций ровно такие, какими их оставила 317.
  FOR r IN SELECT v.sig, v.md5sum FROM (VALUES
    ('platform.ai_agents_run_authorize_v1(uuid,text,boolean)', '68569fdf9f72732497cbfc5dd216391e'),
    ('platform.ai_agent_runtime_dispatch_targets_v1(uuid,text)', 'd5544d56be4de65455dc7281d295e76b'),
    ('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)', '62de698a375b5368ca5d347f21708bd4')
  ) AS v(sig, md5sum) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.md5sum THEN
      RAISE EXCEPTION 'a318_anchor_drift: % is not the 317 definition', r.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a318_anchor$;

-- ---------------------------------------------------------------------------
-- c) Аренда среды: три столбца в строке настроек организации (одна строка на организацию).
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.ai_agents_org_settings
  ADD COLUMN environment_claim_token UUID,
  ADD COLUMN environment_claim_until TIMESTAMPTZ,
  ADD COLUMN environment_claim_key TEXT,
  ADD CONSTRAINT ai_agents_org_settings_env_claim_check CHECK (
    (environment_claim_token IS NULL AND environment_claim_until IS NULL AND environment_claim_key IS NULL)
    OR (environment_claim_token IS NOT NULL AND environment_claim_until IS NOT NULL AND environment_claim_key IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- a) Агента можно запускать: у него есть рабочая настройка в Claude, какой бы ни была последняя синхронизация.
CREATE FUNCTION platform_private.ai_agent_claude_usable(a platform_private.ai_agents)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (a.sync_status = 'ok'
      AND a.claude_agent_id IS NOT NULL AND a.claude_vault_id IS NOT NULL AND a.claude_environment_id IS NOT NULL)
    OR (a.sync_status IN ('pending', 'error')
      AND a.claude_agent_id IS NOT NULL AND a.claude_agent_version IS NOT NULL AND a.claude_environment_id IS NOT NULL
      AND a.claude_vault_id IS NOT NULL AND a.claude_credential_id IS NOT NULL)
$$;

-- b) Текст для ключа повтора: переводы строк и пробелы сжаты до одного пробела, края обрезаны, регистр снят.
CREATE FUNCTION platform_private.ai_agent_send_text_norm(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT lower(btrim(regexp_replace(platform_private.ai_agent_clean_text(p_text), '\s+', ' ', 'g')))
$$;

-- b) Повтор уже выполненного send_message: `needs_dispatch` описывает момент создания черновика, а к повтору
-- он мог уйти (sent), зависнуть (sending), вернуться в ожидание (pending) или закончиться (failed и т. п.).
-- Остальные ответы (draft_created, sent портала) отдаются как были.
CREATE FUNCTION platform_private.ai_agent_send_replay(p_organization_id UUID, p_prior JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d platform_private.ai_agent_drafts;
BEGIN
  IF p_prior ->> 'status' IS DISTINCT FROM 'needs_dispatch' THEN
    RETURN p_prior;
  END IF;
  SELECT * INTO d FROM platform_private.ai_agent_drafts x
  WHERE x.organization_id = p_organization_id AND x.id = (p_prior ->> 'draft_id')::UUID;
  IF NOT FOUND OR d.status = 'approved' THEN
    RETURN p_prior;
  END IF;
  IF d.status = 'sent' THEN
    RETURN jsonb_build_object('status', 'sent', 'mode', 'direct', 'draft_id', d.id);
  ELSIF d.status = 'sending' OR (d.status = 'failed' AND d.failure_code = 'unknown_result') THEN
    RETURN jsonb_build_object('status', 'queued_unknown', 'draft_id', d.id,
      'hint', 'Итог отправки неизвестен — сотрудник проверит чат');
  ELSIF d.status = 'pending' THEN
    RETURN jsonb_build_object('status', 'draft_created', 'mode', 'draft', 'draft_id', d.id,
      'hint', 'Ждёт одобрения сотрудника в CRM');
  END IF;
  RETURN jsonb_build_object('status', 'draft_created', 'mode', 'draft', 'draft_id', d.id,
    'hint', 'Сообщение не отправлено: решение за сотрудником в CRM');
END
$$;

-- ---------------------------------------------------------------------------
-- c) Функции рантайма (service_role): аренда «найти или создать среду».
-- ---------------------------------------------------------------------------

-- known: среда организации уже записана у какого-то агента; claimed: аренда выдана (claimToken); busy: аренда у другой синхронизации.
CREATE FUNCTION platform.ai_agent_runtime_environment_claim_v1(p_organization_id UUID, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s platform_private.ai_agents_org_settings; v_env TEXT; v_now TIMESTAMPTZ := clock_timestamp(); v_token UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO s FROM platform_private.ai_agents_org_settings x WHERE x.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT x.claude_environment_id INTO v_env FROM platform_private.ai_agents x
  WHERE x.organization_id = p_organization_id AND x.claude_environment_id IS NOT NULL
  ORDER BY x.synced_at DESC NULLS LAST, x.sort_order, x.key LIMIT 1;
  IF v_env IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'known', 'environmentId', v_env);
  END IF;
  IF s.environment_claim_token IS NOT NULL AND s.environment_claim_until > v_now THEN
    RETURN jsonb_build_object('status', 'busy',
      'retryAfterSeconds', LEAST(30, GREATEST(1, ceil(extract(epoch FROM (s.environment_claim_until - v_now)))::INTEGER)));
  END IF;
  v_token := gen_random_uuid();
  UPDATE platform_private.ai_agents_org_settings x
  SET environment_claim_token = v_token, environment_claim_until = v_now + INTERVAL '3 minutes', environment_claim_key = p_key
  WHERE x.organization_id = p_organization_id;
  RETURN jsonb_build_object('status', 'claimed', 'claimToken', v_token);
END
$$;

-- Снимает аренду по токену; чужой или просроченный токен ничего не меняет (released = false).
CREATE FUNCTION platform.ai_agent_runtime_environment_release_v1(p_organization_id UUID, p_claim_token UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
  END IF;
  UPDATE platform_private.ai_agents_org_settings x
  SET environment_claim_token = NULL, environment_claim_until = NULL, environment_claim_key = NULL
  WHERE x.organization_id = p_organization_id AND x.environment_claim_token = p_claim_token;
  RETURN jsonb_build_object('released', FOUND);
END
$$;


-- a) Запуск и события: рабочая настройка важнее статуса последней синхронизации.
CREATE OR REPLACE FUNCTION platform.ai_agents_run_authorize_v1(p_organization_id UUID, p_key TEXT,
  p_send_authority BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; a platform_private.ai_agents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id,
    CASE WHEN COALESCE(p_send_authority, FALSE) THEN 'ai.agent.manage' ELSE 'ai.agent.use' END);
  IF NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Директору поручает только системный администратор: его инструменты читают данные организации целиком, не по правам сотрудника.
  IF p_key = 'director' AND NOT v_actor.is_admin THEN
    RAISE EXCEPTION 'ai_agent_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT a.enabled THEN
    RAISE EXCEPTION 'agent_disabled' USING ERRCODE = '55000';
  END IF;
  -- 318: прежняя рабочая настройка в Claude важнее статуса последней синхронизации: сбой или незавершённая
  -- синхронизация (pending / error) не блокирует агента, у которого есть успешно созданная конфигурация.
  IF NOT platform_private.ai_agent_claude_usable(a) THEN
    RAISE EXCEPTION 'agent_not_synced' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM platform_private.ai_agent_runs r WHERE r.organization_id = p_organization_id
      AND r.agent_key = p_key AND r.trigger_kind = 'command' AND r.status IN ('starting', 'running')) >= 3 THEN
    RAISE EXCEPTION 'run_in_progress' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('agentKey', a.key, 'title', a.title, 'enabled', a.enabled, 'autoSend', a.auto_send,
    'model', a.model, 'runBudgetUsd', a.run_budget_usd, 'membershipId', v_actor.membership_id,
    'claude', jsonb_build_object('agentId', a.claude_agent_id, 'agentVersion', a.claude_agent_version,
      'environmentId', a.claude_environment_id, 'vaultId', a.claude_vault_id));
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_runtime_dispatch_targets_v1(p_organization_id UUID, p_trigger_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_trigger_kind IS NULL OR p_trigger_kind NOT IN ('website_lead', 'whatsapp_inbound') THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', a.key, 'title', a.title, 'model', a.model,
      'claudeAgentId', a.claude_agent_id, 'agentVersion', a.claude_agent_version, 'environmentId', a.claude_environment_id,
      'vaultId', a.claude_vault_id, 'runBudgetUsd', a.run_budget_usd, 'autoSend', a.auto_send) ORDER BY a.sort_order, a.key)
    FROM platform_private.ai_agents a
    WHERE a.organization_id = p_organization_id AND a.enabled AND platform_private.ai_agent_claude_usable(a)
      AND ((p_trigger_kind = 'website_lead' AND a.trigger_website_lead)
        OR (p_trigger_kind = 'whatsapp_inbound' AND a.trigger_whatsapp_inbound))), '[]'::JSONB);
END
$$;

-- b) send_message: ключ повтора по умолчанию.
CREATE OR REPLACE FUNCTION platform.ai_agent_tool_send_message_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_idem TEXT; v_prior JSONB; v_channel TEXT := p_args ->> 'channel'; v_text TEXT; v_max INTEGER;
  v_conv platform.communication_conversations; v_case platform.student_cases; v_source UUID; v_label TEXT; v_lead UUID;
  v_run platform_private.ai_agent_runs; v_auth_run platform_private.ai_agent_runs; v_code TEXT; v_direct BOOLEAN := FALSE;
  v_sender UUID; v_resp UUID; v_fail TEXT; v_draft platform_private.ai_agent_drafts; v_post JSONB; v_result JSONB; v_state TEXT;
  v_mode TEXT; v_status TEXT; v_hint TEXT; v_key TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'send_message', p_args);
  IF NOT ((v_channel = 'whatsapp' AND p_args ? 'conversation_id' AND NOT p_args ? 'case_id')
    OR (v_channel = 'portal' AND p_args ? 'case_id' AND NOT p_args ? 'conversation_id')) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_idem := p_args ->> 'idempotency_key';
  -- 318: без ключа от модели ключ строится из получателя и нормализованного текста (окно 10 минут): повтор
  -- того же вызова после обрыва или таймаута не отправляет и не создаёт второе сообщение. Блокировка по ключу
  -- до конца транзакции делает два одновременных одинаковых вызова последовательными.
  v_key := CASE WHEN v_idem IS NOT NULL THEN 'send_message:' || v_idem
    ELSE 'send_message_auto:' || platform_private.ai_agent_sha256(v_channel || E'\n'
      || COALESCE(p_args ->> 'conversation_id', p_args ->> 'case_id') || E'\n'
      || platform_private.ai_agent_send_text_norm(p_args ->> 'text')) END;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::TEXT || ':' || p_agent_key || ':' || v_key, 0));
  v_prior := platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key, v_key, INTERVAL '10 minutes');
  IF v_prior IS NOT NULL THEN
    RETURN platform_private.ai_agent_send_replay(p_organization_id, v_prior);
  END IF;
  v_max := CASE v_channel WHEN 'whatsapp' THEN 4000 ELSE 8000 END;
  v_text := platform_private.ai_agent_clean_text(p_args ->> 'text');
  IF NOT platform_private.ai_agent_text_ok(v_text, v_max) THEN
    RAISE EXCEPTION 'text_invalid' USING ERRCODE = '55000';
  END IF;
  IF v_channel = 'whatsapp' THEN
    SELECT * INTO v_conv FROM platform.communication_conversations c
    WHERE c.organization_id = p_organization_id AND c.id = (p_args ->> 'conversation_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_conv.status <> 'open' THEN
      RAISE EXCEPTION 'conversation_closed' USING ERRCODE = '55000';
    END IF;
    v_source := platform_private.ai_latest_inbound(p_organization_id, v_conv.id);
    IF v_source IS NULL THEN
      RAISE EXCEPTION 'no_inbound_message' USING ERRCODE = '55000';
    END IF;
    v_label := left(COALESCE((SELECT c.display_name FROM platform.clients c
      WHERE c.organization_id = v_conv.organization_id AND c.id = v_conv.canonical_client_id), v_conv.subject), 120);
    v_lead := v_conv.canonical_lead_id;
  ELSE
    SELECT * INTO v_case FROM platform.student_cases s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
    IF NOT FOUND OR v_case.state = 'closed' THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_label := left(v_case.student_display_name, 120);
    v_lead := v_case.canonical_lead_id;
  END IF;

  -- Режим: Авто агента или код полномочия открытого запуска с таким же SHA-256.
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  v_code := p_args ->> 'authority_code';
  IF v_code IS NOT NULL THEN
    SELECT * INTO v_auth_run FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_agent_key AND r.status IN ('starting', 'running')
      AND r.send_authority AND r.send_authority_sha256 = platform_private.ai_agent_sha256(v_code)
    ORDER BY r.started_at DESC LIMIT 1;
    IF FOUND THEN
      v_direct := TRUE;
    END IF;
  END IF;
  IF a.auto_send THEN
    v_direct := TRUE;
  END IF;
  IF v_run.id IS NULL AND v_auth_run.id IS NOT NULL THEN
    v_run := v_auth_run;
  END IF;

  IF v_direct THEN
    -- Отправитель: инициатор запуска с кодом полномочия, иначе ответственный.
    v_sender := CASE WHEN v_auth_run.id IS NOT NULL AND platform_private.ai_agent_staff_assignable(p_organization_id,
        v_auth_run.started_by_membership_id) THEN v_auth_run.started_by_membership_id END;
    IF v_sender IS NULL THEN
      v_resp := platform_private.ai_agents_responsible(p_organization_id);
      IF v_resp IS NULL THEN
        RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
      END IF;
      v_sender := v_resp;
    END IF;
    IF v_channel = 'whatsapp' THEN
      v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, v_conv.waha_session_name);
      IF v_state = 'disconnected' THEN
        v_fail := 'whatsapp_unavailable';
      ELSIF NOT platform_private.ai_agent_whatsapp_sender_ok(p_organization_id, v_sender, v_conv.id) THEN
        v_fail := 'sender_unavailable';
      ELSIF platform_private.ai_agent_staff_active(p_organization_id, v_conv.id, 30) THEN
        v_fail := 'staff_active';
      ELSIF platform_private.ai_agent_rate_limited(p_organization_id, v_conv.id, NULL) THEN
        v_fail := 'rate_limited';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
        WHERE m.organization_id = p_organization_id AND m.id = v_sender AND m.status = 'active'
          AND platform_private.staff_can_access(m.organization_id, m.id, 'case.update.append', 'student_case', v_case.id)) THEN
      v_fail := 'sender_unavailable';
    END IF;
    IF v_fail IS NOT NULL THEN
      v_direct := FALSE;
    END IF;
  END IF;

  IF NOT v_direct THEN
    IF (SELECT count(*) FROM platform_private.ai_agent_drafts x
        WHERE x.organization_id = p_organization_id AND x.agent_key = p_agent_key AND x.status = 'pending'
          AND x.expires_at > clock_timestamp()
          AND ((v_channel = 'whatsapp' AND x.conversation_id = v_conv.id) OR (v_channel = 'portal' AND x.student_case_id = v_case.id))) >= 3 THEN
      RAISE EXCEPTION 'conflict' USING ERRCODE = '55000';
    END IF;
    INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, run_id, channel, conversation_id, student_case_id,
      lead_id, target_label, source_message_id, text, reason, status, failure_code)
    VALUES (p_organization_id, p_agent_key, v_run.id, v_channel, v_conv.id, v_case.id, v_lead, v_label, v_source, v_text,
      left(p_args ->> 'reason', 300), 'pending', v_fail)
    RETURNING * INTO v_draft;
    v_mode := 'draft'; v_status := 'draft_created';
    v_hint := CASE WHEN v_fail IS NULL THEN 'Ждёт одобрения сотрудника в CRM'
      ELSE 'Сообщение ждёт одобрения сотрудника: ' || COALESCE(CASE v_fail
        WHEN 'whatsapp_unavailable' THEN 'WhatsApp сейчас не подключён'
        WHEN 'sender_unavailable' THEN 'отправитель не может писать в этот чат'
        WHEN 'staff_active' THEN 'в чате уже отвечает сотрудник'
        WHEN 'rate_limited' THEN 'достигнут лимит отправки' END, v_fail) END;
    v_result := jsonb_build_object('status', v_status, 'mode', v_mode, 'draft_id', v_draft.id, 'hint', v_hint);
  ELSE
    INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, run_id, channel, conversation_id, student_case_id,
      lead_id, target_label, source_message_id, text, reason, status, sent_by_agent)
    VALUES (p_organization_id, p_agent_key, v_run.id, v_channel, v_conv.id, v_case.id, v_lead, v_label, v_source, v_text,
      left(p_args ->> 'reason', 300), 'approved', TRUE)
    RETURNING * INTO v_draft;
    v_mode := 'direct';
    IF v_channel = 'portal' THEN
      v_post := platform_private.ai_agent_portal_post(p_organization_id, v_draft.id, v_sender);
      v_result := jsonb_build_object('status', 'sent', 'mode', 'direct', 'draft_id', v_draft.id,
        'message_id', v_post ->> 'messageId', 'sender_membership_id', v_sender);
    ELSE
      v_result := jsonb_build_object('status', 'needs_dispatch', 'mode', 'direct', 'draft_id', v_draft.id,
        'sender_membership_id', v_sender);
    END IF;
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.draft.create', 'ai_agent_draft',
    v_draft.id, NULL, jsonb_build_object('agentKey', p_agent_key, 'channel', v_channel, 'mode', v_mode,
      'failureCode', v_fail, 'sentByAgent', v_direct),
    CASE WHEN v_direct THEN 'ИИ-агент подготовил сообщение к отправке' ELSE 'ИИ-агент подготовил сообщение (черновик)' END);
  PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key, v_result);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- Права: те же правила, что в 317 (сотрудник - authenticated; рантайм, MCP и инструменты - service_role;
-- помощники - никому). Цикл повторяет 317 и сохраняет итог для всех функций семейства.
-- ---------------------------------------------------------------------------
DO $a318_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
        OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%'))
      OR (n.nspname = 'platform_private' AND (p.proname LIKE 'ai\_agents\_%' OR p.proname LIKE 'ai\_agent\_%')
        AND p.proname <> 'ai_agent_grant_common_roles') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND (p.proname LIKE 'ai\_agent\_runtime\_%' OR p.proname LIKE 'ai\_agent\_mcp\_%'
      OR p.proname LIKE 'ai\_agent\_tool\_%') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$a318_acl$;

-- ---------------------------------------------------------------------------
-- Проверка в конце: права, определитель, пустой search_path, число функций, таблица остаётся закрытой.
-- ---------------------------------------------------------------------------
DO $a318_verify$
DECLARE f RECORD; v_staff INTEGER; v_service INTEGER;
BEGIN
  IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class c
        WHERE c.oid = 'platform_private.ai_agents_org_settings'::REGCLASS)
    OR has_table_privilege('anon', 'platform_private.ai_agents_org_settings', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.ai_agents_org_settings', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.ai_agents_org_settings', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.ai_agents_org_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'a318_verify_table' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
        OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%'))
      OR (n.nspname = 'platform_private' AND p.proname LIKE 'ai\_agent%' AND p.proname <> 'ai_agent_grant_common_roles'
        AND p.proname NOT LIKE 'ai\_agent\_answer%') LOOP
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a318_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform_private' AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
      OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'a318_verify_helper_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform' THEN
      IF NOT f.prosecdef THEN
        RAISE EXCEPTION 'a318_verify_definer: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a318_verify_staff_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname NOT LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a318_verify_service_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE p.proname LIKE 'ai\_agents\_%\_v1'),
    count(*) FILTER (WHERE p.proname NOT LIKE 'ai\_agents\_%\_v1')
  INTO v_staff, v_service
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
    OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%');
  -- 9 функций сотрудника; 16 рантайма (14 из 317 и две аренды среды), 3 MCP и 24 инструмента.
  IF v_staff <> 9 OR v_service <> 16 + 3 + 24 THEN
    RAISE EXCEPTION 'a318_verify_counts: % / %', v_staff, v_service USING ERRCODE = '55000';
  END IF;
END
$a318_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
