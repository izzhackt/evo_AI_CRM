-- 383 «Предложение агента, которое принимает человек»: «Предложить шаг» и страница передачи дела
-- (план «ИИ-агенты: мозг компании, досье и предохранители», решение владельца 28.11.2026: на продакшене у 101 из 102
-- активных дел «Шаг не задан»; агент предлагает шаг только по кнопке куратора, без ночного прохода).
-- Номер 383: 379–382 заняты параллельными PR и досье (#1622); миграция только добавляет, ни одна существующая функция не меняется.
--
-- Что добавляется:
--   1) таблица platform_private.agent_suggestions: предложение агента (`kind = next_step`), одна `pending` на (дело, вид) —
--      новое предложение заменяет старое (старое получает `expired`); срок жизни 7 дней; закрытая таблица (RLS, без грантов).
--   2) строка platform_private.ai_agent_tool_schemas и инструмент `platform.ai_agent_tool_propose_next_step_v1` (service_role):
--      дело своей организации, дело в работе, текст шага до 300 знаков одной строкой, срок не раньше сегодняшнего, исполнитель —
--      действующий сотрудник; запрещённые формулировки (гарантия визы или поступления, суммы денег) — `text_invalid`;
--      агент выключен — `agent_disabled` (общее начало `ai_agent_tool_begin`); журнал `ai.agent.tool.write`; повтор тех же
--      данных в окне 10 минут отдаёт прежний ответ (общий ключ `ai_agent_auto_key`).
--   3) RPC сотрудника (authenticated): `agent_case_target_v1` (дело для запуска агента: состояние, страна, направление, право записи шага),
--      `agent_suggestion_read_v1` (текущее предложение дела), `agent_suggestion_decide_v1`
--      («Принять» или «Не то») и `case_handoff_note_v1` (последняя заметка «Передача дела»).
--      «Принять» вызывает существующий `platform.set_case_next_action_v1` от имени сотрудника, с его версией дела и его
--      правом (`case.route.manage`) в той же транзакции: устаревшая версия — конфликт `PT409`, предложение остаётся `pending`.
--      Журнал решения — `ai.agent.draft.decide` по делу (запись шага пишет сам `set_case_next_action_v1`).
--
-- Исполнитель предложения (`assignee_membership_id`) показывается сотруднику и хранится, но в шаг дела не пишется:
-- у `student_cases.next_action` нет поля исполнителя. Деньги и согласие студента не затрагиваются.
-- Forward-only: повтор отказывает a383_already_applied.
BEGIN;

DO $a383_anchor$
BEGIN
  IF to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_dedupe_once(uuid,text,text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_auto_key(text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit(uuid,uuid,text,text,text,uuid,jsonb,jsonb,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_open_run(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_staff_assignable(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.admissions_lock_case(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.u7_require_case_workspace_actor(uuid)') IS NULL
    OR to_regprocedure('platform.set_case_next_action_v1(uuid,uuid,bigint,text,date,uuid)') IS NULL
    OR to_regprocedure('private.platform_can_read_student_case(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'a383_anchor_drift: the 317 / 319 / 137 / 241 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.agent_suggestions') IS NOT NULL
    OR to_regprocedure('platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas WHERE tool = 'propose_next_step') THEN
    RAISE EXCEPTION 'a383_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a383_anchor$;

-- ---------------------------------------------------------------------------
-- 1. Таблица предложений.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.agent_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  case_id UUID NOT NULL,
  run_id UUID REFERENCES platform_private.ai_agent_runs(id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL,
  text TEXT NOT NULL,
  due_on DATE,
  assignee_membership_id UUID,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_membership_id UUID,
  decided_at TIMESTAMPTZ,
  dismiss_reason TEXT,
  accept_request_id UUID,
  accept_receipt JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agent_suggestions_agent_fkey FOREIGN KEY (organization_id, agent_key)
    REFERENCES platform_private.ai_agents(organization_id, key) ON DELETE RESTRICT,
  CONSTRAINT agent_suggestions_kind_check CHECK (kind IN ('next_step')),
  CONSTRAINT agent_suggestions_status_check CHECK (status IN ('pending', 'accepted', 'dismissed', 'expired')),
  CONSTRAINT agent_suggestions_text_check CHECK (char_length(text) BETWEEN 1 AND 300 AND text !~ E'[\\x01-\\x1F\\x7F]'),
  CONSTRAINT agent_suggestions_reason_check CHECK (char_length(reason) BETWEEN 1 AND 300 AND reason !~ E'[\\x01-\\x1F\\x7F]'),
  CONSTRAINT agent_suggestions_dismiss_reason_check CHECK (dismiss_reason IS NULL
    OR (char_length(dismiss_reason) BETWEEN 1 AND 300 AND dismiss_reason !~ E'[\\x01-\\x1F\\x7F]')),
  CONSTRAINT agent_suggestions_decision_check CHECK (
    (status IN ('accepted', 'dismissed') AND decided_by_membership_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status IN ('pending', 'expired') AND decided_by_membership_id IS NULL AND decided_at IS NULL AND dismiss_reason IS NULL)),
  CONSTRAINT agent_suggestions_dismiss_only_check CHECK (dismiss_reason IS NULL OR status = 'dismissed'),
  -- Принятое предложение помнит запрос и квитанцию записи шага: повтор тем же запросом отдаёт её, не трогая дело.
  CONSTRAINT agent_suggestions_accept_check CHECK ((status = 'accepted') = (accept_request_id IS NOT NULL AND accept_receipt IS NOT NULL))
);
-- Одно живое предложение на (дело, вид): новое заменяет старое.
CREATE UNIQUE INDEX agent_suggestions_one_pending_idx ON platform_private.agent_suggestions (organization_id, case_id, kind)
  WHERE status = 'pending';
CREATE INDEX agent_suggestions_case_idx ON platform_private.agent_suggestions (organization_id, case_id, created_at DESC);

ALTER TABLE platform_private.agent_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.agent_suggestions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.agent_suggestions
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

COMMENT ON TABLE platform_private.agent_suggestions IS
  '383: предложение агента сотруднику (сейчас «следующий шаг» дела). Принимает человек; одна pending на (дело, вид).';

-- ---------------------------------------------------------------------------
-- 2. Строка схемы входа инструмента (зеркало contract.ts; совпадение проверяет tests/ai-agents-db-contract.test.mjs).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.ai_agent_tool_schemas (tool, kind, audit, input_schema) VALUES
  ('propose_next_step', 'write', 'write', $j${"type":"object","properties":{"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"text":{"type":"string","minLength":1,"maxLength":300,"description":"The one next step, one line, no guarantees and no amounts of money."},"due_on":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Due date, not earlier than today (YYYY-MM-DD)"},"assignee_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Who does it: staff id (membership)."},"reason":{"type":"string","minLength":1,"maxLength":300,"description":"Why this step (shown to staff, small)."}},"required":["case_id","text","reason"],"additionalProperties":false}$j$::jsonb);

-- ---------------------------------------------------------------------------
-- 3. Закрытый помощник: запрещённые формулировки в предложении.
-- ---------------------------------------------------------------------------
-- Гарантия визы или поступления и обещания; для текста шага ещё и суммы денег (знак валюты, число с валютой, «тыс»/«млн»).
-- Регистр снят lower(): в базе en_US.UTF-8, кириллица приводится.
CREATE FUNCTION platform_private.agent_suggestion_text_forbidden(p_text TEXT, p_money BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Обещание: корень «обещ» в любой форме (обещаю, пообещать, обещание). Короткие корни валют только с границей слова (\y),
  -- чтобы «3 европейских вуза», «2 сомнения», «3 рубежа» проходили. Суммы словами: «тысяч / миллион ... долларов / сом».
  SELECT lower(p_text) ~ '(гаранти|обещ|стопроцент|100 ?%|наверняка|без риска|точно (поступ|получ|одобр|дадут|выдадут|примут)|guarantee)'
    OR (p_money AND lower(p_text) ~ ('([$€£¥₽₸]'
      || '|\d ?(usd|eur|cny|rmb|myr|kgs|aed|rub|kzt|долл[а-яё]*|евро|юан[а-яё]*|ринг[а-яё]*|сом|сомов|сома|руб|рубл[а-яё]*|тенге|дирхам[а-яё]*|лир|лира|лиры)\y'
      || '|(usd|eur|cny|rmb|myr|kgs|aed) ?\d'
      || '|(тысяч|тыс|миллион|млн)[а-яё.]* ?(долл|евро|юан|ринг|сом|руб|тенге|дирхам|лир|usd|eur|cny|rmb|myr|kgs|aed))'))
$$;

-- ---------------------------------------------------------------------------
-- 4. Инструмент агента propose_next_step (service_role).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.ai_agent_tool_propose_next_step_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_case platform.student_cases; v_text TEXT; v_reason TEXT; v_due DATE; v_assignee UUID;
  v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE; v_key TEXT; v_prior JSONB; v_run UUID;
  v_id UUID; v_expires TIMESTAMPTZ; v_result JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'propose_next_step', p_args);
  v_text := btrim(regexp_replace(platform_private.ai_agent_clean_text(p_args ->> 'text'), E'\\s*\\n\\s*', ' ', 'g'));
  v_reason := btrim(regexp_replace(platform_private.ai_agent_clean_text(p_args ->> 'reason'), E'\\s*\\n\\s*', ' ', 'g'));
  IF NOT platform_private.ai_agent_text_ok(v_text, 300) OR NOT platform_private.ai_agent_text_ok(v_reason, 300)
    OR platform_private.agent_suggestion_text_forbidden(v_text, TRUE)
    OR platform_private.agent_suggestion_text_forbidden(v_reason, FALSE) THEN
    RAISE EXCEPTION 'text_invalid' USING ERRCODE = '55000';
  END IF;
  v_due := platform_private.ai_agent_arg_date(p_args, 'due_on');
  IF v_due IS NOT NULL AND (v_due < v_today OR v_due > v_today + 366) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'assignee_id' THEN
    v_assignee := (p_args ->> 'assignee_id')::UUID;
    IF NOT platform_private.ai_agent_staff_assignable(p_organization_id, v_assignee) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  -- Повтор тех же данных в окне 10 минут: первый ответ, вторая строка не создаётся.
  v_key := platform_private.ai_agent_auto_key('propose_next_step', jsonb_build_array(
    p_args ->> 'case_id', lower(v_text), v_due, v_assignee));
  v_prior := platform_private.ai_agent_dedupe_once(p_organization_id, p_agent_key, v_key);
  IF v_prior IS NOT NULL THEN
    RETURN v_prior;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'agent_suggestion:' || p_organization_id::TEXT || ':' || (p_args ->> 'case_id') || ':next_step', 0));
  SELECT * INTO v_case FROM platform.student_cases s
  WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_case.state <> 'active' THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.agent_suggestions x SET status = 'expired'
  WHERE x.organization_id = p_organization_id AND x.case_id = v_case.id AND x.kind = 'next_step' AND x.status = 'pending';
  v_run := (platform_private.ai_agent_open_run(p_organization_id, p_agent_key)).id;
  INSERT INTO platform_private.agent_suggestions (organization_id, kind, case_id, run_id, agent_key, text, due_on,
    assignee_membership_id, reason)
  VALUES (p_organization_id, 'next_step', v_case.id, v_run, p_agent_key, v_text, v_due, v_assignee, v_reason)
  RETURNING id, expires_at INTO v_id, v_expires;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write', 'student_case', v_case.id, NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'propose_next_step', 'suggestionId', v_id),
    'ИИ-агент предложил следующий шаг дела');
  v_result := jsonb_build_object('suggestion_id', v_id, 'status', 'pending', 'expires_at', v_expires);
  PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, v_key, v_result);
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC сотрудника.
-- ---------------------------------------------------------------------------

-- Дело для запуска агента, прочитанное сервером: состояние, направление и страна. Право то же, что у записи шага дела
-- (цепочка 137: case.route.manage и область дела) без блокировки; нет права — 42501. Для «Предложить шаг» и «Собрать передачу».
CREATE FUNCTION platform.agent_case_target_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; c platform.student_cases;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'agent_suggestion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.require_domain_actor(actor.organization_id, 'case.route.manage');
  SELECT * INTO c FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.require_case_operator(c.organization_id, c.id, 'case.route.manage');
  RETURN jsonb_build_object('student_case_id', c.id, 'state', c.state, 'admissions_direction', c.admissions_direction,
    'target_country', c.target_country);
END
$$;

-- Текущее предложение дела: pending и не просрочено; иначе NULL. Право — чтение дела (то же, что у «Шапки» дела).
CREATE FUNCTION platform.agent_suggestion_read_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; s platform_private.agent_suggestions; v_agent_title TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'agent_suggestion_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM platform_private.agent_suggestions x
  WHERE x.organization_id = p_organization_id AND x.case_id = p_student_case_id AND x.kind = 'next_step'
    AND x.status = 'pending' AND x.expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT g.title INTO v_agent_title FROM platform_private.ai_agents g WHERE g.organization_id = s.organization_id AND g.key = s.agent_key;
  RETURN jsonb_build_object('suggestion_id', s.id, 'kind', s.kind, 'student_case_id', s.case_id, 'text', s.text,
    'due_on', to_char(s.due_on, 'YYYY-MM-DD'), 'assignee_membership_id', s.assignee_membership_id,
    'assignee_name', platform_private.ai_agent_member_name(s.organization_id, s.assignee_membership_id),
    'reason', s.reason, 'agent_key', s.agent_key, 'agent_title', v_agent_title, 'created_at', s.created_at,
    'expires_at', s.expires_at);
END
$$;

-- «Принять» / «Не то». «Принять» пишет шаг существующим set_case_next_action_v1 (версия дела сотрудника, его право,
-- идемпотентность по p_request_id); при любой ошибке записи вся транзакция откатывается и предложение остаётся pending.
CREATE FUNCTION platform.agent_suggestion_decide_v1(p_organization_id UUID, p_suggestion_id UUID, p_decision TEXT,
  p_expected_version BIGINT, p_dismiss_reason TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD; s platform_private.agent_suggestions; c platform.student_cases; v_reason TEXT; v_receipt JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_suggestion_id IS NULL OR p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('accept', 'dismiss')
    OR (p_decision = 'accept' AND (p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 9223372036854775806)) THEN
    RAISE EXCEPTION 'agent_suggestion_invalid' USING ERRCODE = '22023';
  END IF;
  v_reason := NULLIF(btrim(regexp_replace(COALESCE(p_dismiss_reason, ''), E'\\s*[\\r\\n]+\\s*', ' ', 'g')), '');
  IF p_decision = 'accept' AND v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'agent_suggestion_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND (char_length(v_reason) > 300 OR v_reason ~ E'[\\x01-\\x1F\\x7F]') THEN
    RAISE EXCEPTION 'agent_suggestion_invalid' USING ERRCODE = '22023';
  END IF;
  -- Чужая организация и несуществующее предложение отвечают одинаково.
  SELECT * INTO s FROM platform_private.agent_suggestions x WHERE x.organization_id = p_organization_id AND x.id = p_suggestion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(s.case_id);
  IF actor.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  -- Право то же, что у записи шага: цепочка 137 (блокировка дела и case.route.manage).
  c := platform_private.admissions_lock_case(s.case_id, 'case.route.manage');
  IF c.id IS NULL OR c.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM platform_private.agent_suggestions x WHERE x.id = p_suggestion_id FOR UPDATE;
  -- Повтор «Принять» тем же сотрудником и ТЕМ ЖЕ запросом: прежняя квитанция, set_case_next_action_v1 не вызывается.
  -- Другой запрос на принятом предложении — agent_suggestion_not_pending (ниже).
  IF s.status = 'accepted' AND p_decision = 'accept' AND s.decided_by_membership_id = actor.membership_id
    AND s.accept_request_id = p_request_id THEN
    RETURN jsonb_build_object('suggestion_id', s.id, 'status', 'accepted', 'receipt', s.accept_receipt, 'replayed', TRUE);
  END IF;
  IF s.status <> 'pending' OR s.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'agent_suggestion_not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'accept' THEN
    v_receipt := platform.set_case_next_action_v1(p_organization_id, s.case_id, p_expected_version, s.text, s.due_on, p_request_id);
    UPDATE platform_private.agent_suggestions x SET status = 'accepted', decided_by_membership_id = actor.membership_id,
      decided_at = clock_timestamp(), accept_request_id = p_request_id, accept_receipt = v_receipt WHERE x.id = s.id RETURNING * INTO s;
  ELSE
    UPDATE platform_private.agent_suggestions x SET status = 'dismissed', decided_by_membership_id = actor.membership_id,
      decided_at = clock_timestamp(), dismiss_reason = v_reason WHERE x.id = s.id RETURNING * INTO s;
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, actor.membership_id, s.agent_key, 'ai.agent.draft.decide',
    'student_case', s.case_id, jsonb_build_object('status', 'pending'),
    jsonb_build_object('agentKey', s.agent_key, 'kind', s.kind, 'decision', p_decision, 'status', s.status, 'suggestionId', s.id),
    'ИИ-агент: решение по предложению шага');
  RETURN jsonb_build_object('suggestion_id', s.id, 'status', s.status, 'receipt', v_receipt, 'replayed', FALSE);
END
$$;

-- Последняя заметка дела «Передача дела»: её пишет агент через add_note (текст `[ИИ «<имя>»] Передача дела`, дальше страница).
-- Право — то же, что у чтения заметок дела (117). Нет такой заметки — NULL.
CREATE FUNCTION platform.case_handoff_note_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; n platform.case_notes;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'case_handoff_note_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT authority.* INTO actor FROM platform.current_actor_authority() AS authority;
  IF NOT FOUND OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR NOT private.platform_can_read_student_case(actor.organization_id, p_student_case_id) THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO n FROM platform.case_notes x
  WHERE x.organization_id = p_organization_id AND x.student_case_id = p_student_case_id
    AND x.body ~ E'^\\[ИИ «[^»]{1,120}»\\] Передача дела(\\n|$)'
  ORDER BY x.created_at DESC, x.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('case_note_id', n.id, 'body', n.body, 'created_at', n.created_at);
END
$$;

-- ---------------------------------------------------------------------------
-- 6. Права.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  platform.ai_agent_tool_propose_next_step_v1(UUID, TEXT, JSONB),
  platform.agent_case_target_v1(UUID, UUID),
  platform.agent_suggestion_read_v1(UUID, UUID),
  platform.agent_suggestion_decide_v1(UUID, UUID, TEXT, BIGINT, TEXT, UUID),
  platform.case_handoff_note_v1(UUID, UUID),
  platform_private.agent_suggestion_text_forbidden(TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_tool_propose_next_step_v1(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION
  platform.agent_case_target_v1(UUID, UUID),
  platform.agent_suggestion_read_v1(UUID, UUID),
  platform.agent_suggestion_decide_v1(UUID, UUID, TEXT, BIGINT, TEXT, UUID),
  platform.case_handoff_note_v1(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION platform.ai_agent_tool_propose_next_step_v1(UUID, TEXT, JSONB) IS
  '383: агент предлагает следующий шаг дела; сохраняется pending-предложение, шаг дела не меняется.';
COMMENT ON FUNCTION platform.agent_suggestion_decide_v1(UUID, UUID, TEXT, BIGINT, TEXT, UUID) IS
  '383: «Принять» пишет шаг через set_case_next_action_v1 от имени сотрудника; «Не то» закрывает предложение.';

-- ---------------------------------------------------------------------------
-- Проверка в конце: права, определитель, пустой search_path, строка схемы.
-- ---------------------------------------------------------------------------
DO $a383_verify$
DECLARE f REGPROCEDURE;
BEGIN
  IF (SELECT count(*) FROM platform_private.ai_agent_tool_schemas WHERE tool = 'propose_next_step' AND kind = 'write' AND audit = 'write') <> 1 THEN
    RAISE EXCEPTION 'a383_verify_schema' USING ERRCODE = '55000';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)'::REGPROCEDURE,
    'platform.agent_case_target_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.agent_suggestion_read_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.agent_suggestion_decide_v1(uuid,uuid,text,bigint,text,uuid)'::REGPROCEDURE,
    'platform.case_handoff_note_v1(uuid,uuid)'::REGPROCEDURE,
    'platform_private.agent_suggestion_text_forbidden(text,boolean)'::REGPROCEDURE] LOOP
    IF (SELECT p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] FROM pg_catalog.pg_proc p WHERE p.oid = f) THEN
      RAISE EXCEPTION 'a383_verify_function: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)'::REGPROCEDURE::OID, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)'::REGPROCEDURE::OID, 'EXECUTE')
    OR has_function_privilege('anon', 'platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)'::REGPROCEDURE::OID, 'EXECUTE')
    OR has_function_privilege('evo_ai_agent', 'platform.ai_agent_tool_propose_next_step_v1(uuid,text,jsonb)'::REGPROCEDURE::OID, 'EXECUTE') THEN
    RAISE EXCEPTION 'a383_verify_tool_grant' USING ERRCODE = '55000';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'platform.agent_case_target_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.agent_suggestion_read_v1(uuid,uuid)'::REGPROCEDURE,
    'platform.agent_suggestion_decide_v1(uuid,uuid,text,bigint,text,uuid)'::REGPROCEDURE,
    'platform.case_handoff_note_v1(uuid,uuid)'::REGPROCEDURE] LOOP
    IF NOT has_function_privilege('authenticated', f::OID, 'EXECUTE')
      OR has_function_privilege('anon', f::OID, 'EXECUTE') OR has_function_privilege('service_role', f::OID, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f::OID, 'EXECUTE') THEN
      RAISE EXCEPTION 'a383_verify_staff_grant: %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'platform_private.agent_suggestion_text_forbidden(text,boolean)'::REGPROCEDURE::OID, 'EXECUTE')
    OR has_function_privilege('authenticated', 'platform_private.agent_suggestion_text_forbidden(text,boolean)'::REGPROCEDURE::OID, 'EXECUTE') THEN
    RAISE EXCEPTION 'a383_verify_helper_grant' USING ERRCODE = '55000';
  END IF;
  IF has_table_privilege('authenticated', 'platform_private.agent_suggestions', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.agent_suggestions', 'SELECT') THEN
    RAISE EXCEPTION 'a383_verify_table_grant' USING ERRCODE = '55000';
  END IF;
END
$a383_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
