-- 385: пометка «Тестовый лид» (ночь 28.11.2026, PLAN_CHANGES «ИИ-агенты: мозг компании, досье и предохранители»).
--
-- Зачем. Тестовые лиды (проверка формы сайта, пробный чат WhatsApp, обучение сотрудников) смешивались с боевыми:
-- попадали в воронку и числа, а главное — будили ИИ-агентов, которые писали «клиенту» и тратили дневной лимит.
--
-- Выбор: флаг живёт на ЛИДЕ (`platform.leads.is_test`), а не на клиенте. Тестовость принадлежит обращению: один и тот же
-- настоящий человек может проверить форму сам, а потом прийти настоящим обращением (новый лид, он не тестовый). Флаг
-- клиента скрыл бы реальную историю. Дело студента, переписка и платежи пометку не наследуют и не меняются.
--
-- Что делает миграция:
--   1. `platform.leads.is_test boolean not null default false`.
--   2. `platform.set_lead_is_test_v1(org, lead, is_test, request_id)` — «Тестовый лид» вкл/выкл: те же права, что у закрытия и
--      правки лида (`lead.sales.workflow.manage` + `lead.read` на этот лид), идемпотентность по request_id через журнал
--      платформы (`lead.test_flag.change`), версия процесса лида не меняется. Закрытые лиды помечать можно, архивные — нет.
--   3. `platform.staff_lead_test_flags_v1(org, lead_ids)` — какие из названных лидов тестовые (для метки «Тест» на доске
--      и в карточке; читает только то, что сотрудник и так видит по `lead.read`).
--   4. `platform.ai_agent_runtime_event_lead_is_test_v1(org, kind, ref)` — только service_role: лид события (заявка сайта
--      по request_id, входящий WhatsApp по беседе) тестовый? Хук приёма не будит агентов по тестовому лиду.
--   5. Метрики и инструменты агента без тестовых (фрагментом поверх ТЕКУЩЕГО определения, каждый якорь ровно один раз,
--      иначе миграция падает `a385_anchor_drift:<функция>:<номер>`):
--        * `ai_agent_tool_list_leads_v1` — тестовые лиды не отдаются;
--        * `ai_agent_tool_funnel_stats_v1` — не считаются ни в созданных, ни в «зависших»;
--        * `ai_agent_tool_list_conversations_v1` — чаты тестового лида не отдаются (иначе агент отвечал бы на них, проснувшись
--          от другого события);
--        * `current_sales_funnel` — экран воронки считает только боевые открытые лиды.
--      Не тронуты (см. PR): `get_lead`/`get_client_card` по явному id, доска `staff_sales_lead_page` (там метка «Тест», а не
--      скрытие), отчёт продаж, маркетинговые когорты, телефония.

BEGIN;

DO $a385_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('platform.leads') AND a.attname = 'is_test' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'a385_already_applied';
  END IF;
  IF to_regclass('platform.leads') IS NULL
    OR to_regclass('platform_private.website_lead_receipts') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_list_leads_v1(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_funnel_stats_v1(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('platform.current_sales_funnel(uuid)') IS NULL
    OR to_regprocedure('platform_private.lock_p2d_request(uuid)') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL THEN
    RAISE EXCEPTION 'a385_anchor_missing';
  END IF;
END
$a385_guard$;

-- ---------------------------------------------------------------------------
-- 1. Колонка.
-- ---------------------------------------------------------------------------
ALTER TABLE platform.leads ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2. «Тестовый лид» вкл/выкл.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.set_lead_is_test_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_is_test BOOLEAN,
  p_request_id UUID
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  lead_row platform.leads%ROWTYPE;
  changed platform.leads%ROWTYPE;
  prior platform.audit_events%ROWTYPE;
  recorded_at TIMESTAMPTZ;
BEGIN
  IF p_organization_id IS NULL OR p_lead_id IS NULL OR p_is_test IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'lead_test_flag_invalid' USING ERRCODE = '22023';
  END IF;

  -- Только сотрудник, никогда студент; решают права на лид, а не грубая роль (как у закрытия лида, 246).
  SELECT a.* INTO actor FROM platform.current_actor_authority() AS a
    WHERE a.organization_id = p_organization_id AND a.platform_role IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(a.organization_id, a.membership_id,
        'lead.sales.workflow.manage', 'lead', p_lead_id)
      AND platform_private.staff_can_access(a.organization_id, a.membership_id,
        'lead.read', 'lead', p_lead_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_test_flag_forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2d_request(p_request_id);
  SELECT * INTO lead_row FROM platform.leads AS l
    WHERE l.organization_id = p_organization_id AND l.id = p_lead_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_test_flag_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior FROM platform.audit_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id
      OR prior.action IS DISTINCT FROM 'lead.test_flag.change'
      OR prior.resource_type IS DISTINCT FROM 'lead'
      OR prior.resource_id IS DISTINCT FROM p_lead_id
      OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR (prior.after_state ->> 'is_test')::BOOLEAN IS DISTINCT FROM p_is_test
    THEN
      RAISE EXCEPTION 'lead_test_flag_request_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('organization_id', prior.organization_id, 'lead_id', prior.resource_id,
      'is_test', p_is_test, 'changed', TRUE, 'request_id', prior.request_id, 'changed_at', prior.created_at);
  END IF;

  IF lead_row.lifecycle_state = 'archived' THEN
    RAISE EXCEPTION 'lead_test_flag_state_conflict' USING ERRCODE = 'PT409';
  END IF;
  -- Уже так: ничего не пишем (ни строки, ни сдвига updated_at), ответ честный — «без изменений».
  IF lead_row.is_test = p_is_test THEN
    RETURN jsonb_build_object('organization_id', lead_row.organization_id, 'lead_id', lead_row.id,
      'is_test', lead_row.is_test, 'changed', FALSE, 'request_id', p_request_id, 'changed_at', NULL);
  END IF;

  UPDATE platform.leads AS l SET is_test = p_is_test
  WHERE l.organization_id = lead_row.organization_id AND l.id = lead_row.id
  RETURNING * INTO changed;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state,
    after_state, reason, request_id
  ) VALUES (
    lead_row.organization_id, 'user', actor.profile_id, actor.membership_id,
    'auth:' || actor.auth_user_id::TEXT, 'lead.test_flag.change', 'lead', lead_row.id,
    jsonb_build_object('is_test', lead_row.is_test),
    jsonb_build_object('is_test', changed.is_test),
    CASE WHEN p_is_test THEN 'Lead marked as test' ELSE 'Lead is no longer marked as test' END,
    p_request_id
  ) RETURNING created_at INTO recorded_at;

  RETURN jsonb_build_object('organization_id', changed.organization_id, 'lead_id', changed.id,
    'is_test', changed.is_test, 'changed', TRUE, 'request_id', p_request_id, 'changed_at', recorded_at);
END
$$;

REVOKE ALL ON FUNCTION platform.set_lead_is_test_v1(UUID, UUID, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_lead_is_test_v1(UUID, UUID, BOOLEAN, UUID) TO authenticated;
COMMENT ON FUNCTION platform.set_lead_is_test_v1(UUID, UUID, BOOLEAN, UUID) IS
  '«Тестовый лид» вкл/выкл (385). lead.sales.workflow.manage + lead.read на лид; идемпотентно по request_id (журнал lead.test_flag.change); то же значение — без записи; архивный лид не помечается. Тестовый лид не будит ИИ-агентов и не считается в воронке и инструментах агента.';

-- ---------------------------------------------------------------------------
-- 3. Какие из лидов тестовые (метка «Тест»).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_lead_test_flags_v1(p_organization_id UUID, p_lead_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  found_ids JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_test_flags_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) > 4000
    OR EXISTS (SELECT 1 FROM unnest(p_lead_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION 'lead_test_flags_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(l.id ORDER BY l.id), '[]'::JSONB) INTO found_ids
  FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids) AND l.is_test
    AND platform_private.staff_can_access(p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id);
  RETURN jsonb_build_object('organization_id', p_organization_id, 'test_lead_ids', found_ids);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_lead_test_flags_v1(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_lead_test_flags_v1(UUID, UUID[]) TO authenticated;
COMMENT ON FUNCTION platform.staff_lead_test_flags_v1(UUID, UUID[]) IS
  'Из названных лидов — те, что помечены «Тестовый лид» (385); только видимые сотруднику по lead.read.';

-- ---------------------------------------------------------------------------
-- 4. Лид события тестовый? (хук приёма, только service_role)
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.ai_agent_runtime_event_lead_is_test_v1(p_organization_id UUID, p_trigger_kind TEXT, p_ref TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ref UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_trigger_kind IS NULL OR p_trigger_kind NOT IN ('website_lead', 'whatsapp_inbound') THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  -- Без id (старый путь WhatsApp по таймеру) или с мусором лид неизвестен: событие не тестовое.
  IF p_ref IS NULL OR p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN FALSE;
  END IF;
  v_ref := p_ref::UUID;
  IF p_trigger_kind = 'website_lead' THEN
    -- Заявка могла лечь на уже существующий открытый лид того же телефона: тестовым считается он.
    RETURN EXISTS (SELECT 1 FROM platform_private.website_lead_receipts r
      JOIN platform.leads l ON l.organization_id = r.organization_id AND l.id = r.lead_id
      WHERE r.organization_id = p_organization_id AND r.request_id = v_ref AND l.is_test);
  END IF;
  RETURN EXISTS (SELECT 1 FROM platform.communication_conversations cv
    JOIN platform.leads l ON l.organization_id = cv.organization_id AND l.id = cv.canonical_lead_id
    WHERE cv.organization_id = p_organization_id AND cv.id = v_ref AND l.is_test);
END
$$;

REVOKE ALL ON FUNCTION platform.ai_agent_runtime_event_lead_is_test_v1(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_runtime_event_lead_is_test_v1(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Инструменты агента и воронка без тестовых.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a385_patch(p_sig TEXT, p_tag TEXT, p_pairs TEXT[][]) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; n INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_sig));
  IF position('is_test' IN body) > 0 THEN
    RAISE EXCEPTION 'a385_already_applied';
  END IF;
  FOR n IN 1 .. array_length(p_pairs, 1) LOOP
    IF (length(body) - length(replace(body, p_pairs[n][1], ''))) / length(p_pairs[n][1]) <> 1 THEN
      RAISE EXCEPTION 'a385_anchor_drift:%:%', p_tag, n;
    END IF;
    body := replace(body, p_pairs[n][1], p_pairs[n][2]);
  END LOOP;
  EXECUTE body;
END
$$;

SELECT pg_temp.a385_patch('platform.ai_agent_tool_list_leads_v1(uuid,text,jsonb)', 'list_leads', ARRAY[
  ARRAY[$o1$      AND (v_state = 'all' OR x.lifecycle_state::TEXT = CASE v_state$o1$,
        $n1$      AND NOT x.is_test
      AND (v_state = 'all' OR x.lifecycle_state::TEXT = CASE v_state$n1$]]);

SELECT pg_temp.a385_patch('platform.ai_agent_tool_funnel_stats_v1(uuid,text,jsonb)', 'funnel_stats', ARRAY[
  ARRAY[$o1$      AND (l.created_at AT TIME ZONE 'Asia/Bishkek')::DATE BETWEEN v_from AND v_to$o1$,
        $n1$      AND NOT l.is_test
      AND (l.created_at AT TIME ZONE 'Asia/Bishkek')::DATE BETWEEN v_from AND v_to$n1$],
  ARRAY[$o2$    AND l.updated_at < clock_timestamp() - INTERVAL '7 days'$o2$,
        $n2$    AND NOT l.is_test
    AND l.updated_at < clock_timestamp() - INTERVAL '7 days'$n2$]]);

SELECT pg_temp.a385_patch('platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)', 'list_conversations', ARRAY[
  ARRAY[$o1$      AND (v_queue_enum IS NULL OR cv.queue::TEXT = v_queue_enum)$o1$,
        $n1$      AND (v_queue_enum IS NULL OR cv.queue::TEXT = v_queue_enum)
      AND NOT EXISTS (SELECT 1 FROM platform.leads tl
        WHERE tl.organization_id = cv.organization_id AND tl.id = cv.canonical_lead_id AND tl.is_test)$n1$]]);

SELECT pg_temp.a385_patch('platform.current_sales_funnel(uuid)', 'current_sales_funnel', ARRAY[
  ARRAY[$o1$    WHERE l.organization_id = p_organization_id AND l.lifecycle_state = 'open'$o1$,
        $n1$    WHERE l.organization_id = p_organization_id AND l.lifecycle_state = 'open' AND NOT l.is_test$n1$]]);

NOTIFY pgrst, 'reload schema';

COMMIT;
