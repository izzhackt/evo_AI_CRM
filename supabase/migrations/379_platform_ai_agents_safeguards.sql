-- 379: «ИИ-агенты» — два предохранителя базы данных (ночь 28.11.2026, PLAN_CHANGES «мозг компании, досье и предохранители»).
--
-- 1. «Авто» у выключенного агента. Выключение агента (`ai_agents_update_v1` с enabled = false) само ставит
--    auto_send = false, а при выключенном агенте «Авто» не включается (патч autoSend = true молча не действует). Раньше
--    «Авто» оставался включённым у выключенного агента: при следующем включении агент без одобрения писал клиентам.
--    Однократно: auto_send = false везде, где enabled = false (версия настройки +1, чтобы открытый экран обновился).
--
-- 2. Код полномочия «отправить без черновика» привязан к цели. Раньше `ai_agent_tool_send_message_v1` сверял код только с
--    открытым запуском агента: код, выданный на один чат, годился для другого чата того же запуска. Теперь у запуска
--    есть цель (`authority_conversation_id` или `authority_case_id`, обе пустые у старых запусков):
--      * цель названа при резерве запуска (`ai_agent_runtime_run_reserve_v1`, два новых необязательных параметра) —
--        код действует только на неё;
--      * цель пуста — привязка при первом использовании: первый send_message с верным кодом записывает свою цель;
--      * отправка с этим кодом в другую цель не ошибка, а черновик (как без кода): код тогда не считается полномочием,
--        отправитель — ответственный, а не инициатор запуска.
--    Правило тишины receive_only, лимиты, «только ответ на входящее», черновик и «Авто» агента не меняются.
--
-- Тела функций меняются самопроверяемой заменой над ТЕКУЩИМ определением в базе (как 302, 376 и 378): каждый якорь
-- должен встретиться ровно один раз, иначе миграция падает (a379_anchor_drift:<функция>:<номер>), а не тихо пропускает
-- изменение. Повтор — a379_already_applied. Права, владелец и сигнатура `ai_agents_update_v1` и `send_message_v1`
-- не меняются; `ai_agent_runtime_run_reserve_v1` получает два параметра с умолчанием (старый вызов из девяти аргументов
-- работает), права те же: только service_role.

BEGIN;

DO $a379_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('platform_private.ai_agent_runs') AND a.attname = 'authority_conversation_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'a379_already_applied';
  END IF;
  IF to_regclass('platform_private.ai_agent_runs') IS NULL
    OR to_regprocedure('platform.ai_agents_update_v1(uuid,text,bigint,jsonb,uuid)') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('platform.ai_agent_runtime_run_reserve_v1(uuid,text,text,text,uuid,text,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'a379_function_missing';
  END IF;
END
$a379_guard$;

-- ---------------------------------------------------------------------------
-- Цель кода полномочия на запуске.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.ai_agent_runs
  ADD COLUMN authority_conversation_id UUID,
  ADD COLUMN authority_case_id UUID,
  ADD CONSTRAINT ai_agent_runs_authority_target_check CHECK (
    (authority_conversation_id IS NULL OR authority_case_id IS NULL)
    AND ((authority_conversation_id IS NULL AND authority_case_id IS NULL) OR send_authority));

-- ---------------------------------------------------------------------------
-- Резерв запуска: цель кода полномочия из контекста «Поручить» (необязательна).
-- Другая сигнатура (параметры в конце, с умолчанием): старая функция убирается, чтобы вызов из девяти аргументов не стал
-- неоднозначным; права те же, что у остальных функций рантайма.
-- ---------------------------------------------------------------------------
DROP FUNCTION platform.ai_agent_runtime_run_reserve_v1(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER);

CREATE FUNCTION platform.ai_agent_runtime_run_reserve_v1(p_organization_id UUID, p_key TEXT, p_trigger_kind TEXT,
  p_dedupe_key TEXT, p_started_by_membership_id UUID, p_send_authority_sha256 TEXT, p_prompt_preview TEXT,
  p_model TEXT, p_agent_version INTEGER, p_authority_conversation_id UUID DEFAULT NULL, p_authority_case_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_id UUID; v_existing UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) OR p_trigger_kind IS NULL
    OR p_trigger_kind NOT IN ('command', 'schedule', 'website_lead', 'whatsapp_inbound')
    OR (p_send_authority_sha256 IS NOT NULL AND p_send_authority_sha256 !~ '^[0-9a-f]{64}$')
    OR (p_dedupe_key IS NOT NULL AND char_length(p_dedupe_key) NOT BETWEEN 1 AND 200)
    -- 379: цель кода — одна (чат или дело), только у запуска с кодом, и она есть в этой организации.
    OR (p_authority_conversation_id IS NOT NULL AND p_authority_case_id IS NOT NULL)
    OR ((p_authority_conversation_id IS NOT NULL OR p_authority_case_id IS NOT NULL) AND p_send_authority_sha256 IS NULL)
    OR (p_authority_conversation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform.communication_conversations c
        WHERE c.organization_id = p_organization_id AND c.id = p_authority_conversation_id))
    OR (p_authority_case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform.student_cases s
        WHERE s.organization_id = p_organization_id AND s.id = p_authority_case_id)) THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_dedupe_key IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_key AND r.dedupe_key = p_dedupe_key;
    IF FOUND THEN
      RETURN jsonb_build_object('reserved', FALSE, 'reason', 'duplicate', 'existingRunId', v_existing);
    END IF;
  END IF;
  IF p_trigger_kind IN ('website_lead', 'whatsapp_inbound') THEN
    -- Открытый запуск старше 15 минут не блокирует: закрывает его сверка, а если она не дошла, события не должны вставать.
    SELECT r.id INTO v_existing FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_key AND r.trigger_kind = p_trigger_kind
      AND r.status IN ('starting', 'running') AND r.started_at > clock_timestamp() - INTERVAL '15 minutes'
    ORDER BY r.started_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('reserved', FALSE, 'reason', 'run_in_progress', 'existingRunId', v_existing);
    END IF;
  END IF;
  INSERT INTO platform_private.ai_agent_runs (organization_id, agent_key, trigger_kind, dedupe_key, started_by_membership_id,
    send_authority, send_authority_sha256, prompt_preview, model, agent_version, authority_conversation_id, authority_case_id)
  VALUES (p_organization_id, p_key, p_trigger_kind, p_dedupe_key, p_started_by_membership_id,
    p_send_authority_sha256 IS NOT NULL, p_send_authority_sha256, left(p_prompt_preview, 500),
    COALESCE(p_model, a.model), COALESCE(p_agent_version, a.claude_agent_version),
    p_authority_conversation_id, p_authority_case_id)
  RETURNING id INTO v_id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, p_started_by_membership_id, p_key, 'ai.agent.run.start',
    'ai_agent_run', v_id,
    NULL, jsonb_build_object('agentKey', p_key, 'trigger', p_trigger_kind, 'model', COALESCE(p_model, a.model),
      'sendAuthority', p_send_authority_sha256 IS NOT NULL),
    'ИИ-агент: запуск');
  RETURN jsonb_build_object('reserved', TRUE, 'runId', v_id);
END
$$;

REVOKE ALL ON FUNCTION platform.ai_agent_runtime_run_reserve_v1(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_runtime_run_reserve_v1(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 1. ai_agents_update_v1: выключенный агент без «Авто».
-- ---------------------------------------------------------------------------
DO $a379_update$
DECLARE
  sig CONSTANT TEXT := 'platform.ai_agents_update_v1(uuid,text,bigint,jsonb,uuid)';
  body TEXT;
  pairs TEXT[][];
  n INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(sig));
  IF position('379' IN body) > 0 THEN
    RAISE EXCEPTION 'a379_already_applied';
  END IF;
  pairs := ARRAY[
    -- После разбора патча: у выключенного агента «Авто» всегда выключен (и при выключении, и при попытке включить «Авто»).
    ARRAY[$o1$  IF n_enabled IS DISTINCT FROM a.enabled THEN v_changed := array_append(v_changed, 'enabled');$o1$,
          $n1$  -- 379: выключенный агент ничего не пишет сам; «Авто» не должен дожидаться следующего включения.
  IF NOT n_enabled THEN
    n_auto := FALSE;
  END IF;

  IF n_enabled IS DISTINCT FROM a.enabled THEN v_changed := array_append(v_changed, 'enabled');$n1$]
  ];
  FOR n IN 1 .. array_length(pairs, 1) LOOP
    IF (length(body) - length(replace(body, pairs[n][1], ''))) / length(pairs[n][1]) <> 1 THEN
      RAISE EXCEPTION 'a379_anchor_drift:update:%', n;
    END IF;
    body := replace(body, pairs[n][1], pairs[n][2]);
  END LOOP;
  EXECUTE body;
END
$a379_update$;

-- Однократно: «Авто» выключен у всех выключенных агентов.
UPDATE platform_private.ai_agents x
SET auto_send = FALSE, config_version = x.config_version + 1, updated_at = clock_timestamp()
WHERE NOT x.enabled AND x.auto_send;

-- ---------------------------------------------------------------------------
-- 2. ai_agent_tool_send_message_v1: код полномочия действует на свою цель.
-- ---------------------------------------------------------------------------
DO $a379_send$
DECLARE
  sig CONSTANT TEXT := 'platform.ai_agent_tool_send_message_v1(uuid,text,jsonb)';
  body TEXT;
  pairs TEXT[][];
  n INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(sig));
  IF position('authority_conversation_id' IN body) > 0 THEN
    RAISE EXCEPTION 'a379_already_applied';
  END IF;
  pairs := ARRAY[
    ARRAY[$o1$      AND r.send_authority AND r.send_authority_sha256 = platform_private.ai_agent_sha256(v_code)
    ORDER BY r.started_at DESC LIMIT 1;
    IF FOUND THEN
      v_direct := TRUE;
    END IF;$o1$,
          $n1$      AND r.send_authority AND r.send_authority_sha256 = platform_private.ai_agent_sha256(v_code)
    ORDER BY r.started_at DESC LIMIT 1
    FOR UPDATE OF r;
    IF FOUND THEN
      -- 379: код привязан к цели. Цель из резерва запуска уважается; пустая цель занимается первым верным использованием.
      -- Другая цель с тем же кодом — не ошибка, а черновик (как без кода): запуск тогда не источник отправителя.
      IF v_auth_run.authority_conversation_id IS NULL AND v_auth_run.authority_case_id IS NULL THEN
        UPDATE platform_private.ai_agent_runs x
        SET authority_conversation_id = v_conv.id, authority_case_id = v_case.id
        WHERE x.id = v_auth_run.id;
        v_direct := TRUE;
      ELSIF (v_channel = 'whatsapp' AND v_auth_run.authority_conversation_id = v_conv.id)
        OR (v_channel = 'portal' AND v_auth_run.authority_case_id = v_case.id) THEN
        v_direct := TRUE;
      ELSE
        v_auth_run := NULL;
      END IF;
    END IF;$n1$]
  ];
  FOR n IN 1 .. array_length(pairs, 1) LOOP
    IF (length(body) - length(replace(body, pairs[n][1], ''))) / length(pairs[n][1]) <> 1 THEN
      RAISE EXCEPTION 'a379_anchor_drift:send_message:%', n;
    END IF;
    body := replace(body, pairs[n][1], pairs[n][2]);
  END LOOP;
  EXECUTE body;
END
$a379_send$;

COMMIT;
