-- 319: «ИИ-агенты»: два пункта аудита стека 24.10.2026 (docs/PLAN_CHANGES.md «2026-10-24 · ИИ-агенты: усиление по
-- аудиту стека, база данных (миграция 319)»). Номер 319: на origin/main последняя 318; хуки набора привязаны к
-- имени файла, не к номеру.
--
-- Forward-only. Заменяемые тела закреплены md5 их вида из 317 (шаблон 303/304/312/316/318): расхождение
-- останавливает миграцию, ничего не меняя. Повторный запуск: a319_already_applied (55000). SECURITY DEFINER
-- с пустым search_path у всего нового; помощники не доступны никому. Сигнатуры заменяемых функций не меняются,
-- поэтому права прежние (CREATE OR REPLACE их сохраняет), а приложение менять не нужно.
--
--  a) Повтор записи без ключа модели. 318 дала `send_message` ключ повтора по умолчанию; тот же механизм теперь
--     у `create_task`, `add_note` и `post_digest` (у отчёта ключа модели нет вовсе). Ключ строится из частей
--     вызова (create_task: заголовок, описание, исполнитель, срок, приоритет, дело, лид; add_note: лид или дело
--     и текст; post_digest: вид, заголовок, текст, данные графиков, период), текст нормализован как у
--     send_message (пробелы сжаты, регистр снят), окно 10 минут, свои пространства `create_task_auto:`,
--     `add_note_auto:`, `post_digest_auto:`: ключи модели с ними не пересекаются. Блокировка по ключу до конца
--     транзакции (platform_private.ai_agent_dedupe_once) делает два одинаковых вызова последовательными, в том
--     числе с ключом модели (раньше у него блокировки не было). Повтор после обрыва или таймаута приложения
--     (`withDeadline` не отменяет вызов базы) отдаёт первый ответ, а не создаёт вторую строку. Ответ повтора
--     `create_task` по-прежнему с `deduplicated: true`; у `add_note` и `post_digest` это ответ первого вызова.
--  b) Аудит чувствительных чтений в той же транзакции. Шесть чтений (get_client_card, get_lead, get_case,
--     get_document_file, get_conversation, get_case_chat) писали строку журнала платформы ПОСЛЕ ответа, из
--     `ai_agent_mcp_log_v1`: сбой этого вызова оставлял выданные данные без записи. Теперь каждая функция чтения
--     сама вставляет строку (platform_private.ai_agent_audit_read: `ai.agent.tool.read`, для файла
--     `ai.agent.document.read`; актор и `after_state` те же) до выдачи данных: не записалось - исключение, данные
--     не выданы. `ai_agent_mcp_log_v1` пишет только строку действий; `ai_agent_actions.audit_event_id` у новых
--     строк пуст (приложение и экраны его не читают; у прежних строк значение осталось). Ответы инструментов
--     не меняются. Дополнительных параметров нет: организация, агент, инструмент и объект известны самой функции.
--
-- Порядок выката. Миграция может идти до приложения или после него: приложение не менялось, сигнатуры те же.
-- Старый вызов журнала действий после миграции просто не пишет аудит (его пишут функции чтения).
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты 317 / 318, на которые опирается миграция, и md5 десяти заменяемых тел.
-- ---------------------------------------------------------------------------
DO $a319_anchor$
DECLARE r RECORD;
BEGIN
  IF to_regclass('platform_private.ai_agent_actions') IS NULL
    OR to_regclass('platform_private.ai_agent_dedupe') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit(uuid,uuid,text,text,text,uuid,jsonb,jsonb,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_get(uuid,text,text,interval)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_put(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_sha256(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_send_text_norm(text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'a319_anchor_drift: the 317 / 318 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform_private.ai_agent_auto_key(text,jsonb)') IS NOT NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_once(uuid,text,text)') IS NOT NULL
    OR to_regprocedure('platform_private.ai_agent_audit_read(uuid,text,text,text,uuid)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'a319_already_applied' USING ERRCODE = '55000';
  END IF;
  -- 317: тела десяти заменяемых функций ровно такие, какими их оставила 317 (318 их не трогала).
  FOR r IN SELECT v.sig, v.md5sum FROM (VALUES
    ('platform.ai_agent_tool_create_task_v1(uuid,text,jsonb)', '25c28ccb74c7ca40f0b6f5d682fee120'),
    ('platform.ai_agent_tool_add_note_v1(uuid,text,jsonb)', '5c550ef63ff0e98bdd87319778daf0e1'),
    ('platform.ai_agent_tool_post_digest_v1(uuid,text,jsonb)', 'd35dadc8a2076e93c062c5204a500010'),
    ('platform.ai_agent_tool_get_client_card_v1(uuid,text,jsonb)', 'abb18b3755b1905e56240286bfe63289'),
    ('platform.ai_agent_tool_get_lead_v1(uuid,text,jsonb)', '0944ad89c472b4b36c51d5aaf335d952'),
    ('platform.ai_agent_tool_get_case_v1(uuid,text,jsonb)', 'd71637f50d9e8f1adef53568df6c485f'),
    ('platform.ai_agent_tool_get_document_file_v1(uuid,text,jsonb)', 'b37196414db862887495646fa8f1085f'),
    ('platform.ai_agent_tool_get_conversation_v1(uuid,text,jsonb)', 'ea7f4bb11eb7f9809e26ca05f7f9a541'),
    ('platform.ai_agent_tool_get_case_chat_v1(uuid,text,jsonb)', '6ee2c444ff6d4383f18a9443d3a62e58'),
    ('platform.ai_agent_mcp_log_v1(uuid,text,text,jsonb,text,text,integer)', 'd1b122493e5bd344837c62c97004b9b3')
  ) AS v(sig, md5sum) LOOP
    IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(r.sig)) IS DISTINCT FROM r.md5sum THEN
      RAISE EXCEPTION 'a319_anchor_drift: % is not the 317 definition', r.sig USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$a319_anchor$;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- a) Ключ повтора записи без ключа модели: «<инструмент>_auto:» и SHA-256 канонического JSON частей вызова
-- (jsonb приводит порядок ключей к одному виду). Длина не больше 30 + 64 знаков: в пределе таблицы (200).
CREATE FUNCTION platform_private.ai_agent_auto_key(p_tool TEXT, p_parts JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_tool || '_auto:' || platform_private.ai_agent_sha256(p_parts::TEXT)
$$;

-- a) Повтор записи: блокировка по ключу до конца транзакции (два одинаковых вызова идут по очереди), затем прежний
-- ответ в окне 10 минут (AI_AGENT_LIMITS.idempotencyWindowMinutes) или NULL. Формула блокировки та же, что у
-- send_message в 318.
CREATE FUNCTION platform_private.ai_agent_dedupe_once(p_organization_id UUID, p_agent_key TEXT, p_dedupe_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::TEXT || ':' || p_agent_key || ':' || p_dedupe_key, 0));
  RETURN platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key, p_dedupe_key, INTERVAL '10 minutes');
END
$$;

-- b) Строка журнала платформы о чувствительном чтении, в транзакции самой функции чтения: служба агента
-- (`ai-agent:<ключ>`), в `after_state` только агент и инструмент; открытие документа - своё действие.
CREATE FUNCTION platform_private.ai_agent_audit_read(p_organization_id UUID, p_agent_key TEXT, p_tool TEXT,
  p_resource_type TEXT, p_resource_id UUID)
RETURNS UUID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key,
    CASE p_tool WHEN 'get_document_file' THEN 'ai.agent.document.read' ELSE 'ai.agent.tool.read' END,
    p_resource_type, p_resource_id, NULL, jsonb_build_object('agentKey', p_agent_key, 'tool', p_tool),
    CASE p_tool WHEN 'get_document_file' THEN 'ИИ-агент открыл документ студента'
      ELSE 'ИИ-агент прочитал данные клиента' END)
$$;

-- ---------------------------------------------------------------------------
-- Функции инструментов (service_role): тела 317 плюс заменённые места, помеченные «319:».
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_create_task_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_resp UUID; v_idem TEXT; v_prior JSONB; v_case platform.student_cases; v_assignee UUID;
  v_title TEXT; v_desc TEXT; v_due DATE; v_priority TEXT := COALESCE(p_args ->> 'priority', 'normal'); v_task UUID;
  v_kind TEXT; v_result JSONB; v_lead UUID; v_profile UUID; v_key TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'create_task', p_args);
  v_idem := p_args ->> 'idempotency_key';
  -- 319: без ключа от модели ключ строится из заголовка, описания, исполнителя, срока, приоритета, дела и лида
  -- (текст нормализован как у send_message в 318), окно 10 минут, отдельное пространство `create_task_auto:`.
  -- Блокировка по ключу до конца транзакции делает два одинаковых вызова последовательными; повтор после
  -- обрыва или таймаута приложения (withDeadline не отменяет вызов базы) отдаёт первый ответ.
  v_key := CASE WHEN v_idem IS NOT NULL THEN 'create_task:' || v_idem
    ELSE platform_private.ai_agent_auto_key('create_task', jsonb_build_array(
      COALESCE(platform_private.ai_agent_send_text_norm(p_args ->> 'title'), ''),
      COALESCE(platform_private.ai_agent_send_text_norm(p_args ->> 'description'), ''),
      p_args ->> 'assignee_id', p_args ->> 'due_on', v_priority, p_args ->> 'case_id', p_args ->> 'lead_id')) END;
  v_prior := platform_private.ai_agent_dedupe_once(p_organization_id, p_agent_key, v_key);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior || jsonb_build_object('deduplicated', TRUE);
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  IF v_resp IS NULL THEN
    RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
  END IF;
  v_title := '[ИИ «' || a.title || '»] ' || btrim(p_args ->> 'title');
  v_desc := NULLIF(btrim(p_args ->> 'description'), '');
  v_due := platform_private.ai_agent_arg_date(p_args, 'due_on');
  IF p_args ? 'case_id' THEN
    SELECT * INTO v_case FROM platform.student_cases s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p_args ? 'lead_id' THEN
    v_lead := (p_args ->> 'lead_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p_args ? 'assignee_id' THEN
    v_assignee := (p_args ->> 'assignee_id')::UUID;
    IF NOT platform_private.ai_agent_staff_assignable(p_organization_id, v_assignee) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_case.id IS NOT NULL AND platform_private.ai_agent_staff_assignable(p_organization_id, v_case.current_curator_membership_id) THEN
    v_assignee := v_case.current_curator_membership_id;
  ELSE
    v_assignee := v_resp;
  END IF;
  IF v_case.id IS NOT NULL THEN
    v_kind := 'case';
    SELECT m.profile_id INTO v_profile FROM platform.organization_memberships m WHERE m.organization_id = p_organization_id AND m.id = v_resp;
    INSERT INTO platform.case_tasks (organization_id, student_case_id, task_type, title, assignee_membership_id, priority,
      due_on, status, student_visible, created_by_membership_id)
    VALUES (p_organization_id, v_case.id, 'ai_agent', v_title, v_assignee, v_priority::platform.case_task_priority, v_due,
      'open', FALSE, v_resp)
    RETURNING id INTO v_task;
    INSERT INTO platform.case_task_events (organization_id, case_task_id, student_case_id, previous_status, new_status,
      previous_assignee_membership_id, new_assignee_membership_id, actor_membership_id, request_id)
    VALUES (p_organization_id, v_task, v_case.id, NULL, 'open', NULL, v_assignee, v_resp, gen_random_uuid());
  ELSE
    v_kind := 'staff';
    v_task := platform_private.ai_agent_make_staff_task(p_organization_id, v_resp, v_assignee, v_title, v_desc, v_priority,
      v_due, v_lead, p_agent_key);
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write',
    CASE v_kind WHEN 'case' THEN 'case_task' ELSE 'staff_task' END, v_task, NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'create_task', 'taskId', v_task),
    'ИИ-агент изменил данные: создана задача');
  v_result := jsonb_build_object('task_id', v_task, 'kind', v_kind,
    'assignee_name', platform_private.ai_agent_member_name(p_organization_id, v_assignee), 'deduplicated', FALSE);
  PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key, v_result);
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_add_note_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_resp UUID; v_idem TEXT; v_prior JSONB; v_body TEXT; v_lead UUID; v_case UUID; v_note UUID; v_result JSONB;
  v_key TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'add_note', p_args);
  IF (p_args ? 'lead_id')::INTEGER + (p_args ? 'case_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_idem := p_args ->> 'idempotency_key';
  -- 319: без ключа от модели ключ строится из объекта (лид или дело) и нормализованного текста заметки, окно
  -- 10 минут, пространство `add_note_auto:`; блокировка по ключу, повтор отдаёт первый ответ.
  v_key := CASE WHEN v_idem IS NOT NULL THEN 'add_note:' || v_idem
    ELSE platform_private.ai_agent_auto_key('add_note', jsonb_build_array(
      CASE WHEN p_args ? 'lead_id' THEN 'lead' ELSE 'case' END, COALESCE(p_args ->> 'lead_id', p_args ->> 'case_id'),
      COALESCE(platform_private.ai_agent_send_text_norm(p_args ->> 'body'), ''))) END;
  v_prior := platform_private.ai_agent_dedupe_once(p_organization_id, p_agent_key, v_key);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  IF v_resp IS NULL THEN
    RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
  END IF;
  v_body := btrim('[ИИ «' || a.title || '»] ' || platform_private.ai_agent_clean_text(p_args ->> 'body'));
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'lead_id' THEN
    v_lead := (p_args ->> 'lead_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_case := (p_args ->> 'case_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = v_case) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO platform.case_notes (organization_id, lead_id, student_case_id, body, created_by_membership_id)
  VALUES (p_organization_id, v_lead, v_case, v_body, v_resp)
  RETURNING id INTO v_note;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write',
    CASE WHEN v_lead IS NOT NULL THEN 'lead' ELSE 'student_case' END, COALESCE(v_lead, v_case), NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'add_note', 'noteId', v_note),
    'ИИ-агент изменил данные: добавлена заметка');
  v_result := jsonb_build_object('note_id', v_note);
  PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key, v_result);
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_post_digest_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_run platform_private.ai_agent_runs; v_from DATE; v_to DATE; v_id UUID;
  v_key TEXT; v_prior JSONB; v_result JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'post_digest', p_args);
  v_from := platform_private.ai_agent_arg_date(p_args, 'period_from');
  v_to := platform_private.ai_agent_arg_date(p_args, 'period_to');
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'metrics' AND octet_length((p_args -> 'metrics')::TEXT) > 16384 THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  -- 319: у отчёта нет ключа модели: ключ строится из вида, заголовка, текста, данных графиков и периода (текст
  -- нормализован как у send_message), окно 10 минут, пространство `post_digest_auto:`; блокировка по ключу,
  -- повтор отдаёт первый ответ и не публикует второй отчёт.
  v_key := platform_private.ai_agent_auto_key('post_digest', jsonb_build_array(
    p_args ->> 'kind', COALESCE(platform_private.ai_agent_send_text_norm(p_args ->> 'title'), ''),
    COALESCE(platform_private.ai_agent_send_text_norm(p_args ->> 'body_md'), ''), p_args -> 'metrics',
    p_args ->> 'period_from', p_args ->> 'period_to'));
  v_prior := platform_private.ai_agent_dedupe_once(p_organization_id, p_agent_key, v_key);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  INSERT INTO platform_private.ai_agent_digests (organization_id, agent_key, run_id, kind, title, body_md, metrics, period_from, period_to)
  VALUES (p_organization_id, p_agent_key, v_run.id, p_args ->> 'kind', btrim(p_args ->> 'title'), p_args ->> 'body_md',
    p_args -> 'metrics', v_from, v_to)
  RETURNING id INTO v_id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write', 'ai_agent', a.id, NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'post_digest', 'digestId', v_id, 'kind', p_args ->> 'kind'),
    'ИИ-агент изменил данные: опубликован отчёт');
  v_result := jsonb_build_object('digest_id', v_id);
  PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key, v_result);
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_client_card_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_client UUID; v_c platform.clients; v_lead UUID;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_client_card', p_args);
  IF (p_args ? 'client_id')::INTEGER + (p_args ? 'lead_id')::INTEGER + (p_args ? 'case_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'client_id' THEN
    v_client := (p_args ->> 'client_id')::UUID;
  ELSIF p_args ? 'lead_id' THEN
    SELECT l.client_id INTO v_client FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = (p_args ->> 'lead_id')::UUID;
  ELSE
    SELECT COALESCE(s.canonical_client_id, (SELECT l.client_id FROM platform.leads l
      WHERE l.organization_id = s.organization_id AND l.id = s.canonical_lead_id)) INTO v_client
    FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
  END IF;
  SELECT * INTO v_c FROM platform.clients c WHERE c.organization_id = p_organization_id AND c.id = v_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных; объект - как в вызове (клиент, лид или дело).
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_client_card',
    CASE WHEN p_args ? 'client_id' THEN 'client' WHEN p_args ? 'lead_id' THEN 'lead' ELSE 'student_case' END,
    (p_args ->> CASE WHEN p_args ? 'client_id' THEN 'client_id' WHEN p_args ? 'lead_id' THEN 'lead_id' ELSE 'case_id' END)::UUID);
  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', v_c.id, 'name', v_c.display_name,
      'phone_masked', platform_private.ai_agent_mask_phone(v_c.phone), 'email_masked', platform_private.ai_agent_mask_email(v_c.email)),
    'leads', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'stage', l.stage_key, 'source', l.source_key,
        'state', CASE l.lifecycle_state::TEXT WHEN 'converted' THEN 'won' WHEN 'disqualified' THEN 'lost' ELSE l.lifecycle_state::TEXT END,
        'owner_name', platform_private.ai_agent_member_name(l.organization_id, l.current_owner_membership_id),
        'created_at', l.created_at) ORDER BY l.created_at DESC)
      FROM (SELECT x.* FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.client_id = v_c.id
        ORDER BY x.created_at DESC LIMIT 20) l), '[]'::JSONB),
    'cases', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'country', s.target_country, 'degree', s.target_degree,
        'direction', s.admissions_direction, 'operational_stage', s.operational_stage,
        'curator_name', platform_private.ai_agent_member_name(s.organization_id, s.current_curator_membership_id),
        'state', s.state::TEXT) ORDER BY s.created_at DESC)
      FROM (SELECT x.* FROM platform.student_cases x WHERE x.organization_id = p_organization_id
        AND (x.canonical_client_id = v_c.id OR x.canonical_lead_id IN (SELECT l.id FROM platform.leads l
          WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id))
        ORDER BY x.created_at DESC LIMIT 20) s), '[]'::JSONB),
    'conversations', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status::TEXT, 'queue', v.queue::TEXT,
        'last_message_at', v.last_at, 'unanswered', v.unanswered) ORDER BY v.last_at DESC NULLS LAST)
      FROM (SELECT cv.id, cv.status, cv.queue, lm.at AS last_at, COALESCE(lm.direction = 'inbound', FALSE) AS unanswered
        FROM platform.communication_conversations cv
        LEFT JOIN LATERAL platform_private.ai_agent_conv_last(cv.organization_id, cv.id) lm ON TRUE
        WHERE cv.organization_id = p_organization_id AND cv.canonical_client_id = v_c.id
        ORDER BY lm.at DESC NULLS LAST LIMIT 10) v), '[]'::JSONB),
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = p_organization_id
        AND (x.lead_id IN (SELECT l.id FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id)
          OR x.student_case_id IN (SELECT s.id FROM platform.student_cases s WHERE s.organization_id = p_organization_id
            AND (s.canonical_client_id = v_c.id OR s.canonical_lead_id IN (SELECT l.id FROM platform.leads l
              WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id))))
        ORDER BY x.created_at DESC LIMIT 10) n), '[]'::JSONB));
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_lead_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; l platform.leads; c platform.clients; v_conditions JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_lead', p_args);
  SELECT * INTO l FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'lead_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_lead', 'lead', l.id);
  SELECT * INTO c FROM platform.clients x WHERE x.organization_id = p_organization_id AND x.id = l.client_id;
  SELECT s.fields INTO v_conditions FROM platform_private.lead_sale_conditions s
  WHERE s.organization_id = p_organization_id AND s.lead_id = l.id;
  RETURN jsonb_build_object(
    'lead', jsonb_build_object('id', l.id, 'client_id', l.client_id, 'stage', l.stage_key, 'source', l.source_key,
      'state', CASE l.lifecycle_state::TEXT WHEN 'converted' THEN 'won' WHEN 'disqualified' THEN 'lost' ELSE l.lifecycle_state::TEXT END,
      'owner_name', platform_private.ai_agent_member_name(l.organization_id, l.current_owner_membership_id),
      'direction', l.interest_direction, 'next_action', l.next_action_text, 'next_action_due', l.next_action_due_date,
      'created_at', l.created_at, 'updated_at', l.updated_at),
    'client', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'name', c.display_name,
      'phone_masked', platform_private.ai_agent_mask_phone(c.phone), 'email_masked', platform_private.ai_agent_mask_email(c.email)) END,
    'stage_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', h.desired_stage_key, 'at', h.created_at) ORDER BY h.created_at)
      FROM (SELECT r.desired_stage_key, r.created_at FROM platform_private.sales_lead_workflow_receipts r
        WHERE r.organization_id = p_organization_id AND r.lead_id = l.id ORDER BY r.created_at DESC LIMIT 30) h), '[]'::JSONB),
    'sale_conditions', v_conditions,
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = p_organization_id AND x.lead_id = l.id
        ORDER BY x.created_at DESC LIMIT 10) n), '[]'::JSONB),
    'open_tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id', t.id, 'title', left(t.title, 200),
        'assignee_name', platform_private.ai_agent_member_name(t.organization_id, t.assignee_membership_id),
        'status', t.status::TEXT, 'priority', t.priority::TEXT, 'due_on', COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE))
        ORDER BY t.created_at DESC)
      FROM (SELECT x.* FROM platform.staff_tasks x
        WHERE x.organization_id = p_organization_id AND x.status IN ('open', 'in_progress', 'blocked')
          AND x.id IN (SELECT k.staff_task_id FROM platform_private.staff_lead_task_links k
            WHERE k.organization_id = p_organization_id AND k.lead_id = l.id)
        ORDER BY x.created_at DESC LIMIT 20) t), '[]'::JSONB),
    'conversation_ids', COALESCE((SELECT jsonb_agg(cv.id ORDER BY cv.created_at DESC) FROM platform.communication_conversations cv
      WHERE cv.organization_id = p_organization_id AND cv.canonical_lead_id = l.id), '[]'::JSONB),
    'calls_count', (SELECT count(*) FROM platform_private.telephony_calls tc
      WHERE tc.organization_id = p_organization_id AND tc.lead_id = l.id));
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_case_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_inc TEXT[]; v_out JSONB; v_money JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_case', 'student_case', s.id);
  v_inc := CASE WHEN p_args ? 'include' THEN ARRAY(SELECT jsonb_array_elements_text(p_args -> 'include'))
    ELSE ARRAY['documents', 'applications', 'payments', 'tasks'] END;
  v_out := jsonb_build_object('case', jsonb_build_object('id', s.id, 'student_name', s.student_display_name,
      'country', s.target_country, 'degree', s.target_degree, 'direction', s.admissions_direction,
      'program_direction', s.program_direction, 'intake', s.intake, 'operational_stage', s.operational_stage,
      'pipeline_stage', s.pipeline_stage, 'state', s.state::TEXT, 'next_action', s.next_action,
      'next_action_due_on', s.next_action_due_on,
      'curator_name', platform_private.ai_agent_member_name(s.organization_id, s.current_curator_membership_id),
      'sales_name', platform_private.ai_agent_member_name(s.organization_id, s.responsible_sales_membership_id),
      'handoff_at', s.handoff_at, 'created_at', s.created_at, 'updated_at', s.updated_at));
  IF 'documents' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'slot_id', d.id, 'requirement', COALESCE(d.display_label, r.label), 'status', d.status::TEXT, 'deadline', d.deadline,
        'latest_version_id', d.current_version_id, 'reviewed_at', rv.created_at, 'review_note', left(rv.reason, 300),
        'mime_type', v.declared_mime_type, 'byte_size', v.byte_size, 'uploaded_at', v.created_at)
        ORDER BY d.created_at, d.id)
      FROM platform.document_slots d
      LEFT JOIN platform.document_requirements r ON r.organization_id = d.organization_id AND r.id = d.requirement_id
      LEFT JOIN platform.document_versions v ON v.organization_id = d.organization_id AND v.id = d.current_version_id
      LEFT JOIN LATERAL (SELECT y.created_at, y.reason FROM platform.document_reviews y
        WHERE y.organization_id = d.organization_id AND y.document_version_id = d.current_version_id
        ORDER BY y.created_at DESC, y.id DESC LIMIT 1) rv ON TRUE
      WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL), '[]'::JSONB));
  END IF;
  IF 'applications' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('applications', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'institution', u.institution_name, 'program', u.program_name, 'status', u.status::TEXT,
        'is_primary', u.is_primary, 'deadline', u.university_deadline_on, 'country', u.country, 'degree', u.degree)
        ORDER BY u.created_at)
      FROM platform.university_applications u
      WHERE u.organization_id = s.organization_id AND u.student_case_id = s.id), '[]'::JSONB));
  END IF;
  IF 'payments' = ANY (v_inc) THEN
    SELECT jsonb_build_object(
      'obligations', COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'label', left(o.label, 200), 'category', o.category::TEXT,
        'amount', platform_private.ai_agent_money(o.amount_minor), 'currency', o.currency,
        'due_on', (o.due_at AT TIME ZONE 'Asia/Bishkek')::DATE,
        'paid', platform_private.ai_agent_money(o.total_paid_minor - o.total_refunded_minor),
        'status', CASE WHEN o.total_paid_minor - o.total_refunded_minor >= o.amount_minor THEN 'paid'
          WHEN o.due_at IS NOT NULL AND o.due_at < clock_timestamp() THEN 'overdue'
          WHEN o.total_paid_minor - o.total_refunded_minor > 0 THEN 'partial' ELSE 'open' END) ORDER BY o.created_at), '[]'::JSONB),
      'overdue_count', count(*) FILTER (WHERE o.due_at IS NOT NULL AND o.due_at < clock_timestamp()
        AND o.total_paid_minor - o.total_refunded_minor < o.amount_minor))
    INTO v_money
    FROM platform.payment_obligations o
    WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id AND o.archived_at IS NULL;
    v_out := v_out || jsonb_build_object('payments', v_money || jsonb_build_object(
      'total_due', COALESCE((SELECT jsonb_object_agg(t.currency, platform_private.ai_agent_money(t.v)) FROM (
        SELECT o.currency, sum(greatest(o.amount_minor - (o.total_paid_minor - o.total_refunded_minor), 0)) AS v
        FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id
          AND o.archived_at IS NULL GROUP BY o.currency) t), '{}'::JSONB),
      'total_paid', COALESCE((SELECT jsonb_object_agg(t.currency, platform_private.ai_agent_money(t.v)) FROM (
        SELECT o.currency, sum(o.total_paid_minor - o.total_refunded_minor) AS v
        FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id
          AND o.archived_at IS NULL GROUP BY o.currency) t), '{}'::JSONB)));
  END IF;
  IF 'tasks' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', left(t.title, 200), 'status', t.status::TEXT, 'priority', t.priority::TEXT,
        'due_on', COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE),
        'assignee_name', platform_private.ai_agent_member_name(t.organization_id, t.assignee_membership_id))
        ORDER BY t.created_at DESC)
      FROM (SELECT x.* FROM platform.case_tasks x WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
        AND x.status IN ('open', 'in_progress', 'blocked') ORDER BY x.created_at DESC LIMIT 30) t), '[]'::JSONB));
  END IF;
  IF 'notes' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
        ORDER BY x.created_at DESC LIMIT 20) n), '[]'::JSONB));
  END IF;
  IF 'profile' = ANY (v_inc) THEN
    -- Только безопасные поля профиля: без даты рождения, паспортных и родительских данных.
    v_out := v_out || jsonb_build_object('profile', (SELECT jsonb_build_object(
        'preferred_name', p.preferred_display_name, 'communication_language', p.communication_language,
        'citizenship_country', p.citizenship_country, 'residency_country', p.residency_country,
        'education', left(p.current_education_summary, 500), 'academic', left(p.academic_summary, 500),
        'language', left(p.language_summary, 500), 'budget_band', p.budget_band, 'next_step', left(p.next_step, 300))
      FROM platform.student_profiles p WHERE p.organization_id = s.organization_id AND p.student_case_id = s.id));
  END IF;
  RETURN v_out;
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_document_file_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_version UUID; v platform.document_versions; b platform_private.document_storage_bindings;
  v_token TEXT; v_ttl INTEGER := 600; v_max_bytes CONSTANT BIGINT := 26214400;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_document_file', p_args);
  IF (p_args ? 'document_version_id')::INTEGER + (p_args ? 'slot_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'document_version_id' THEN
    v_version := (p_args ->> 'document_version_id')::UUID;
  ELSE
    SELECT s.current_version_id INTO v_version FROM platform.document_slots s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'slot_id')::UUID AND s.removed_at IS NULL;
  END IF;
  SELECT * INTO v FROM platform.document_versions x WHERE x.organization_id = p_organization_id AND x.id = v_version;
  IF NOT FOUND OR v.malware_status::TEXT <> 'clean' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO b FROM platform_private.document_storage_bindings x
  WHERE x.organization_id = p_organization_id AND x.document_version_id = v.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v.byte_size > v_max_bytes THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  -- 319: аудит открытия документа в этой же транзакции, до выдачи ссылки; объект - дело версии документа.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_document_file', 'student_case', v.student_case_id);
  v_token := translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), E'+/=\n', '-_');
  v_token := left(v_token, 43);
  INSERT INTO platform_private.ai_agent_file_grants (organization_id, agent_key, token_sha256, document_version_id,
    storage_bucket, storage_path, mime_type, byte_size, file_name, expires_at, max_uses)
  VALUES (p_organization_id, p_agent_key, platform_private.ai_agent_sha256(v_token), v.id, b.bucket_id, b.object_name,
    v.declared_mime_type, v.byte_size, left(v.original_filename, 200), clock_timestamp() + make_interval(secs => v_ttl), 3);
  RETURN jsonb_build_object('token', v_token, 'file_name', left(v.original_filename, 200), 'mime_type', v.declared_mime_type,
    'byte_size', v.byte_size, 'expires_in_seconds', v_ttl);
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_conversation_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; cv platform.communication_conversations; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_state TEXT; v_latest UUID; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_conversation', p_args);
  SELECT * INTO cv FROM platform.communication_conversations x
  WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'conversation_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_conversation', 'communication_conversation', cv.id);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at, 'direction', m.direction::TEXT, 'origin', platform_private.ai_agent_message_origin(m),
      'text', left(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), 2000),
      'media_kind', (platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind'))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.communication_messages x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = cv.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  -- Новейшие - внизу.
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, cv.waha_session_name);
  v_latest := platform_private.ai_latest_inbound(p_organization_id, cv.id);
  RETURN jsonb_build_object(
    'conversation', jsonb_build_object('id', cv.id, 'status', cv.status::TEXT,
      'queue', CASE cv.queue::TEXT WHEN 'curator' THEN 'admissions' ELSE cv.queue::TEXT END,
      'lead_id', cv.canonical_lead_id, 'case_id', cv.student_case_id,
      'contact_name', COALESCE((SELECT c.display_name FROM platform.clients c
        WHERE c.organization_id = cv.organization_id AND c.id = cv.canonical_client_id), left(cv.subject, 120)),
      'whatsapp_state', v_state),
    'messages', v_items,
    'can_reply', cv.status = 'open' AND v_latest IS NOT NULL AND v_state <> 'disconnected',
    'latest_inbound_message_id', v_latest,
    'next_cursor', v_next);
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_tool_get_case_chat_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case_chat', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  -- 319: аудит чтения в этой же транзакции, до выдачи данных.
  PERFORM platform_private.ai_agent_audit_read(p_organization_id, p_agent_key, 'get_case_chat', 'student_case', s.id);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at,
      'author', CASE WHEN m.author_membership_id IS NOT DISTINCT FROM s.student_membership_id THEN 'student'
        WHEN EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = m.organization_id
          AND d.student_case_id = m.student_case_id AND d.provider ->> 'messageId' = m.id::TEXT) THEN 'ai_agent'
        ELSE 'staff' END,
      'author_name', platform_private.ai_agent_member_name(m.organization_id, m.author_membership_id),
      'text', left(m.body, 2000))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.case_chat_messages x
    WHERE x.organization_id = p_organization_id AND x.student_case_id = s.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  RETURN jsonb_build_object('messages', v_items, 'next_cursor', v_next);
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_mcp_log_v1(p_organization_id UUID, p_agent_key TEXT, p_tool TEXT, p_args JSONB,
  p_status TEXT, p_error_code TEXT, p_duration_ms INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run platform_private.ai_agent_runs; v_action BIGINT; v_args JSONB := COALESCE(p_args, '{}'::JSONB);
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_agent_key IS NULL OR p_tool IS NULL OR p_status IS NULL
    OR p_status NOT IN ('ok', 'error', 'denied')
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas s WHERE s.tool = p_tool)
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_agents a WHERE a.organization_id = p_organization_id AND a.key = p_agent_key) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  INSERT INTO platform_private.ai_agent_actions (organization_id, agent_key, run_id, tool, args_summary, result_status,
    error_code, duration_ms)
  VALUES (p_organization_id, p_agent_key, v_run.id, p_tool, platform_private.ai_agent_args_summary(v_args), p_status,
    left(p_error_code, 64), p_duration_ms)
  RETURNING id INTO v_action;
  -- 319: аудит шести чувствительных чтений пишут сами функции инструментов в своей транзакции
  -- (platform_private.ai_agent_audit_read): здесь остаётся только строка действий, audit_event_id у новых строк пуст.
  RETURN jsonb_build_object('actionId', v_action);
END
$$;

-- ---------------------------------------------------------------------------
-- Права: те же правила, что в 317 и 318 (сотрудник - authenticated; рантайм, MCP и инструменты - service_role;
-- помощники - никому). Цикл повторяет 318 и сохраняет итог для всех функций семейства, в том числе для новых помощников.
-- ---------------------------------------------------------------------------
DO $a319_acl$
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
$a319_acl$;

-- ---------------------------------------------------------------------------
-- Проверка в конце: права, определитель, пустой search_path, число функций (новых функций схемы platform нет),
-- а также места, ради которых миграция сделана: аудит внутри шести чтений, ключ повтора в трёх записях, журнал
-- действий без аудита.
-- ---------------------------------------------------------------------------
DO $a319_verify$
DECLARE f RECORD; v_staff INTEGER; v_service INTEGER;
BEGIN
  FOR f IN SELECT p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
        OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%'))
      OR (n.nspname = 'platform_private' AND p.proname LIKE 'ai\_agent%' AND p.proname <> 'ai_agent_grant_common_roles'
        AND p.proname NOT LIKE 'ai\_agent\_answer%') LOOP
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a319_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform_private' AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
      OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'a319_verify_helper_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform' THEN
      IF NOT f.prosecdef THEN
        RAISE EXCEPTION 'a319_verify_definer: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a319_verify_staff_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname NOT LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a319_verify_service_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE p.proname LIKE 'ai\_agents\_%\_v1'),
    count(*) FILTER (WHERE p.proname NOT LIKE 'ai\_agents\_%\_v1')
  INTO v_staff, v_service
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
    OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%');
  -- Как после 318: 9 функций сотрудника; 16 рантайма, 3 MCP и 24 инструмента (319 новых функций схемы platform не добавляет).
  IF v_staff <> 9 OR v_service <> 16 + 3 + 24 THEN
    RAISE EXCEPTION 'a319_verify_counts: % / %', v_staff, v_service USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname IN ('ai_agent_tool_get_client_card_v1', 'ai_agent_tool_get_lead_v1', 'ai_agent_tool_get_case_v1', 'ai_agent_tool_get_document_file_v1', 'ai_agent_tool_get_conversation_v1', 'ai_agent_tool_get_case_chat_v1') AND strpos(p.prosrc, 'ai_agent_audit_read(') > 0) <> 6
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname IN ('ai_agent_tool_create_task_v1', 'ai_agent_tool_add_note_v1', 'ai_agent_tool_post_digest_v1') AND strpos(p.prosrc, 'ai_agent_dedupe_once(') > 0
        AND strpos(p.prosrc, 'ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key') > 0) <> 3
    OR (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
        AND p.proname = 'ai_agent_mcp_log_v1' AND strpos(p.prosrc, 'ai_agent_audit(') = 0) <> 1
  THEN
    RAISE EXCEPTION 'a319_verify_bodies' USING ERRCODE = '55000';
  END IF;
END
$a319_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
