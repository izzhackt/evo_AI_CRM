-- Сторож сроков (28.11.2026, «ИИ-агенты: мозг компании, досье и предохранители»).
--
-- Каждое утро находит активные дела, где срок уже можно вычислить без модели, и ставит задачу куратору дела.
-- Чистый SQL и задачи: ни Claude, ни токенов, ни догадок. Пустая дата не считается просрочкой.
--
-- Правила (чтение, `platform_private.case_deadline_watch_rows`), только дела в работе (`student_cases.state = 'active'`):
--   slot_due           слот документа (`document_slots`) ещё не «принят» (status <> 'approved'), срок (`deadline`, день по
--                      Asia/Bishkek) наступает в ближайшие 7 дней или уже прошёл; убранный слот (`removed_at`) и слот
--                      снятого требования не берутся; у своего (custom) слота название берётся из `display_label`;
--   next_step_overdue  `student_cases.next_action_due_on` раньше сегодняшнего дня;
--   tranche_overdue    живой транш (`payment_obligations.archived_at IS NULL`), не оплачен: оплачено за вычетом возвратов
--                      меньше суммы (total_paid_minor - total_refunded_minor < amount_minor, как в 043/069), срок `due_at`
--                      (день по Asia/Bishkek) раньше сегодняшнего дня.
--   intake_without_id  НЕ ВЫЧИСЛЯЕТСЯ в SQL и не включён: заявка дела хранит набор текстом (`student_cases.intake`), а
--                      привязка к набору каталога (`catalog_preparations.intake_id`) всегда с идентификатором (NOT NULL).
--                      Набор «без постоянного id» есть только внутри JSON опубликованной карточки вуза
--                      (`universityMissingIntakeIds` в TypeScript), и это свойство карточки, а не срока дела.
--
-- Одна строка на дело и причину (куратора не заваливаем): берётся САМАЯ РАННЯЯ дата из ещё не решённых, в названии её
-- документ или платёж и «и ещё N» про остальные того же дела и той же причины (с другими сроками тоже). Когда самое раннее
-- решено, самым ранним становится следующее: дата другая, ключ новый, задача новая.
--
-- Запуск (`platform.case_deadline_watch_run_v1`, только service_role). По умолчанию сухой прогон: ничего не пишет и
-- отдаёт счётчики и список. Потолок `p_max_tasks` (по умолчанию 50) на один запуск: сначала самые просроченные (самая
-- ранняя дата, затем дело); остальные строки считаются `capped` и подхватываются следующим запуском.
-- Настоящий запуск ставит задачу по делу куратору дела (если он не может принять задачу, то
-- ответственному администратору организации, как `create_task` агента в 317/319) тем же видом записи: `case_tasks`
-- плюс событие `case_task_events`, не для студента.
--
-- Повторы. Ключ `watch:<дело>:<причина>:<самая ранняя дата>` записывается в `platform_private.case_deadline_watch_log` вместе с
-- задачей и НИКОГДА не ставит вторую задачу: ни пока первая открыта, ни после того как её закрыли. Если срок в деле
-- перенесли, ключ новый (другая дата), и сторож поставит новую задачу. Закрытая задача без переноса срока второй раз не
-- возвращается: куратор уже ответил.
--
-- Аудит как у системных действий агентов: `ai_agent_audit` без сотрудника, действие `ai.agent.tool.write`, ресурс
-- `case_task`, субъект `ai-agent:case-deadline-watch` (разрешённые списки действий и ресурсов не менялись).
--
-- Порядок выката: миграция до запуска сторожа; приложение она не меняет (сторож запускается скриптом по таймеру).
BEGIN;

DO $a380_anchor$
BEGIN
  IF to_regclass('platform.document_slots') IS NULL OR to_regclass('platform.document_requirements') IS NULL
    OR to_regclass('platform.payment_obligations') IS NULL OR to_regclass('platform.case_tasks') IS NULL
    OR to_regclass('platform.case_task_events') IS NULL
    OR to_regprocedure('platform_private.ai_agents_responsible(uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_staff_assignable(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_audit(uuid,uuid,text,text,text,uuid,jsonb,jsonb,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform'
      AND table_name = 'payment_obligations' AND column_name = 'archived_at')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform'
      AND table_name = 'student_cases' AND column_name = 'next_action_due_on')
  THEN
    RAISE EXCEPTION 'a380_anchor_drift: the objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.case_deadline_watch_log') IS NOT NULL
    OR to_regprocedure('platform.case_deadline_watch_run_v1(uuid,date,boolean,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'a380_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a380_anchor$;

-- Ключи, по которым задача уже ставилась (замок на повтор). Закрыта всем ролям API.
CREATE TABLE platform_private.case_deadline_watch_log (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  watch_key TEXT NOT NULL,
  case_task_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, watch_key),
  CONSTRAINT case_deadline_watch_log_key_check CHECK (watch_key ~ '^watch:[0-9a-f-]{36}:(slot_due|next_step_overdue|tranche_overdue):\d{4}-\d{2}-\d{2}$')
);
ALTER TABLE platform_private.case_deadline_watch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.case_deadline_watch_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.case_deadline_watch_log
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Название задачи: подписи рядом с кодом; те же слова лежат в `CASE_DEADLINE_WATCH_TITLES` (src/lib/v3/wording.ts), их
-- равенство проверяет tests/case-deadline-watch.test.mjs. Дата дд.мм.гггг, «{detail}» - документ или платёж в кавычках.
CREATE FUNCTION platform_private.case_deadline_watch_title(p_reason TEXT, p_detail TEXT, p_due DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT replace(replace(CASE p_reason
    WHEN 'slot_due' THEN 'Срок документа — {detail}: {date}'
    WHEN 'next_step_overdue' THEN 'Следующий шаг просрочен: срок был {date}'
    WHEN 'tranche_overdue' THEN 'Платёж просрочен — {detail}: срок был {date}'
  END, '{detail}', COALESCE(p_detail, '')), '{date}', to_char(p_due, 'DD.MM.YYYY'))
$$;

-- Правила: строки (дело, причина, срок, подробность) по активным делам организации на день p_today.
CREATE FUNCTION platform_private.case_deadline_watch_rows(p_organization_id UUID, p_today DATE)
RETURNS TABLE (case_id UUID, reason_code TEXT, due_date DATE, detail TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH slots AS (
    SELECT s.student_case_id AS cid, (s.deadline AT TIME ZONE 'Asia/Bishkek')::DATE AS due,
      COALESCE(s.display_label, r.label) AS label
    FROM platform.document_slots s
    JOIN platform.student_cases c ON c.organization_id = s.organization_id AND c.id = s.student_case_id
    LEFT JOIN platform.document_requirements r ON r.organization_id = s.organization_id AND r.id = s.requirement_id
    WHERE s.organization_id = p_organization_id AND c.state = 'active' AND (r.id IS NULL OR r.status = 'active')
      AND s.removed_at IS NULL AND s.status <> 'approved' AND s.deadline IS NOT NULL
      AND (s.deadline AT TIME ZONE 'Asia/Bishkek')::DATE <= p_today + 7
  ), tranches AS (
    SELECT o.student_case_id AS cid, (o.due_at AT TIME ZONE 'Asia/Bishkek')::DATE AS due, o.label AS label
    FROM platform.payment_obligations o
    JOIN platform.student_cases c ON c.organization_id = o.organization_id AND c.id = o.student_case_id
    WHERE o.organization_id = p_organization_id AND c.state = 'active' AND o.archived_at IS NULL
      AND o.total_paid_minor - o.total_refunded_minor < o.amount_minor
      AND (o.due_at AT TIME ZONE 'Asia/Bishkek')::DATE < p_today
  )
  SELECT g.cid, 'slot_due'::TEXT, min(g.due),
    '«' || (array_agg(g.label ORDER BY g.due, g.label))[1] || '»'
      || CASE WHEN count(*) > 1 THEN ' и ещё ' || (count(*) - 1)::TEXT ELSE '' END
  FROM slots g GROUP BY g.cid
  UNION ALL
  SELECT c.id, 'next_step_overdue'::TEXT, c.next_action_due_on, NULL::TEXT
  FROM platform.student_cases c
  WHERE c.organization_id = p_organization_id AND c.state = 'active' AND c.next_action_due_on IS NOT NULL
    AND c.next_action_due_on < p_today
  UNION ALL
  SELECT g.cid, 'tranche_overdue'::TEXT, min(g.due),
    '«' || (array_agg(g.label ORDER BY g.due, g.label))[1] || '»'
      || CASE WHEN count(*) > 1 THEN ' и ещё ' || (count(*) - 1)::TEXT ELSE '' END
  FROM tranches g GROUP BY g.cid
  ORDER BY 1, 2, 3
$$;

-- Запуск. Сухой прогон по умолчанию; только service_role.
CREATE FUNCTION platform.case_deadline_watch_run_v1(p_organization_id UUID, p_today DATE DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT TRUE, p_max_tasks INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today DATE; r RECORD; v_key TEXT; v_resp UUID; v_curator UUID; v_assignee UUID; v_task UUID; v_title TEXT;
  v_priority TEXT; v_outcome TEXT; v_items JSONB := '[]'::JSONB; v_item_count INTEGER := 0;
  v_by JSONB := jsonb_build_object(
    'slot_due', jsonb_build_object('found', 0, 'created', 0, 'would_create', 0, 'skipped', 0, 'no_assignee', 0, 'capped', 0),
    'next_step_overdue', jsonb_build_object('found', 0, 'created', 0, 'would_create', 0, 'skipped', 0, 'no_assignee', 0, 'capped', 0),
    'tranche_overdue', jsonb_build_object('found', 0, 'created', 0, 'would_create', 0, 'skipped', 0, 'no_assignee', 0, 'capped', 0));
  v_found INTEGER := 0; v_created INTEGER := 0; v_would INTEGER := 0; v_skipped INTEGER := 0; v_none INTEGER := 0;
  v_capped INTEGER := 0; v_planned INTEGER := 0;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_dry_run IS NULL OR p_max_tasks IS NULL OR p_max_tasks < 1 OR p_max_tasks > 1000 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id AND o.status = 'active') THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_today := COALESCE(p_today, (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE);
  IF NOT p_dry_run THEN
    -- Один настоящий запуск на организацию за раз: два запуска подряд видят ключи друг друга.
    PERFORM pg_advisory_xact_lock(hashtextextended('case_deadline_watch:' || p_organization_id::TEXT, 0));
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  FOR r IN SELECT * FROM platform_private.case_deadline_watch_rows(p_organization_id, v_today) x
    ORDER BY x.due_date, x.case_id, x.reason_code LOOP
    v_found := v_found + 1;
    v_key := 'watch:' || r.case_id::TEXT || ':' || r.reason_code || ':' || to_char(r.due_date, 'YYYY-MM-DD');
    IF EXISTS (SELECT 1 FROM platform_private.case_deadline_watch_log l
      WHERE l.organization_id = p_organization_id AND l.watch_key = v_key) THEN
      v_outcome := 'skipped';
    ELSE
      SELECT c.current_curator_membership_id INTO v_curator FROM platform.student_cases c
      WHERE c.organization_id = p_organization_id AND c.id = r.case_id;
      v_assignee := CASE WHEN platform_private.ai_agent_staff_assignable(p_organization_id, v_curator) THEN v_curator
        ELSE v_resp END;
      IF v_assignee IS NULL OR v_resp IS NULL THEN
        v_outcome := 'no_assignee';
      ELSIF v_planned >= p_max_tasks THEN
        v_outcome := 'capped';
      ELSIF p_dry_run THEN
        v_planned := v_planned + 1;
        v_outcome := 'would_create';
      ELSE
        v_planned := v_planned + 1;
        v_title := platform_private.case_deadline_watch_title(r.reason_code, r.detail, r.due_date);
        v_priority := CASE WHEN r.due_date < v_today THEN 'high' ELSE 'normal' END;
        INSERT INTO platform.case_tasks (organization_id, student_case_id, task_type, title, assignee_membership_id, priority,
          due_on, status, student_visible, created_by_membership_id)
        VALUES (p_organization_id, r.case_id, 'deadline_watch', v_title, v_assignee, v_priority::platform.case_task_priority,
          v_today, 'open', FALSE, v_resp)
        RETURNING id INTO v_task;
        INSERT INTO platform.case_task_events (organization_id, case_task_id, student_case_id, previous_status, new_status,
          previous_assignee_membership_id, new_assignee_membership_id, actor_membership_id, request_id)
        VALUES (p_organization_id, v_task, r.case_id, NULL, 'open', NULL, v_assignee, v_resp, gen_random_uuid());
        INSERT INTO platform_private.case_deadline_watch_log (organization_id, watch_key, case_task_id)
        VALUES (p_organization_id, v_key, v_task);
        PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, 'case-deadline-watch', 'ai.agent.tool.write',
          'case_task', v_task, NULL,
          jsonb_build_object('agentKey', 'case-deadline-watch', 'tool', 'case_deadline_watch', 'taskId', v_task),
          'Сторож сроков поставил задачу по сроку из дела');
        v_outcome := 'created';
      END IF;
    END IF;
    v_by := jsonb_set(v_by, ARRAY[r.reason_code, 'found'], to_jsonb((v_by -> r.reason_code ->> 'found')::INTEGER + 1));
    v_by := jsonb_set(v_by, ARRAY[r.reason_code, v_outcome],
      to_jsonb((v_by -> r.reason_code ->> v_outcome)::INTEGER + 1));
    IF v_outcome = 'created' THEN v_created := v_created + 1;
    ELSIF v_outcome = 'would_create' THEN v_would := v_would + 1;
    ELSIF v_outcome = 'skipped' THEN v_skipped := v_skipped + 1;
    ELSIF v_outcome = 'capped' THEN v_capped := v_capped + 1;
    ELSE v_none := v_none + 1; END IF;
    IF p_dry_run AND v_item_count < 500 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('case_id', r.case_id, 'reason_code', r.reason_code,
        'due_date', r.due_date, 'outcome', v_outcome));
      v_item_count := v_item_count + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dry_run', p_dry_run, 'today', v_today, 'found', v_found, 'created', v_created,
    'would_create', v_would, 'skipped', v_skipped, 'no_assignee', v_none, 'capped', v_capped,
    'max_tasks', p_max_tasks, 'by_reason', v_by)
    || CASE WHEN p_dry_run THEN jsonb_build_object('items', v_items, 'items_truncated', v_found > v_item_count) ELSE '{}'::JSONB END;
END
$$;

REVOKE ALL ON FUNCTION platform_private.case_deadline_watch_title(TEXT, TEXT, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION platform_private.case_deadline_watch_rows(UUID, DATE)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
REVOKE ALL ON FUNCTION platform.case_deadline_watch_run_v1(UUID, DATE, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.case_deadline_watch_run_v1(UUID, DATE, BOOLEAN, INTEGER) TO service_role;

DO $a380_verify$
DECLARE f REGPROCEDURE;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'platform_private.case_deadline_watch_title(text,text,date)'::REGPROCEDURE,
    'platform_private.case_deadline_watch_rows(uuid,date)'::REGPROCEDURE,
    'platform.case_deadline_watch_run_v1(uuid,date,boolean,integer)'::REGPROCEDURE] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
      OR has_function_privilege('service_role', f, 'EXECUTE') IS DISTINCT FROM (f = 'platform.case_deadline_watch_run_v1(uuid,date,boolean,integer)'::REGPROCEDURE) THEN
      RAISE EXCEPTION 'a380_posture: wrong grants on %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'platform_private.case_deadline_watch_log', 'SELECT')
    OR has_table_privilege('authenticated', 'platform_private.case_deadline_watch_log', 'SELECT') THEN
    RAISE EXCEPTION 'a380_posture: the watch log is open' USING ERRCODE = '55000';
  END IF;
END
$a380_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
