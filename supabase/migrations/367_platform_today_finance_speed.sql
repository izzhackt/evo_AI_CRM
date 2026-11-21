-- ============================================================
-- 367_platform_today_finance_speed.sql
--
-- Скорость «Сегодня» и «Финансов» (запись docs/PLAN_CHANGES.md ведёт руководитель среза; решение владельца 21.11.2026).
-- Замер production 11-20.11: `/main` медиана 0,69 с, p90 1,75 с, одна строка evo_timing: 45 RPC, последовательная глубина 6.
-- Функции, таблицы, строки и права доступа к данным не меняются: добавляется одна читающая функция и заменяется на месте одно тело.
--
--  A. platform.staff_task_lead_refs_v1(org, task_ids): ОДНО чтение вместо «две функции на задачу». Для списка задач-перезвонов
--     «Сегодня» и «Задач» отдаёт по каждой задаче лид и имя клиента. Права РОВНО прежние, потому что решение принимают прежние
--     функции, а не их копия: на каждую задачу вызываются platform.staff_task_context (задача видна сотруднику: создатель,
--     исполнитель или полный просмотр, плюс чтение лида связи через private.platform_can_read_canonical_lead) и затем
--     platform.staff_task_lead_context (чтение лида `lead.read`). Отказ или любая ошибка по задаче — задача просто не попадает в
--     ответ (как прежнее чтение страницы: сбой = строка без клиента). Задачи без лида не попадают. Имя клиента — личные данные:
--     функция не читает ничего, чего не прочитали бы эти две функции; от других ролей, чем у них, она не зависит.
--     Ответ: {"refs":[{"task_id","lead_id","client_name"}]} в порядке входного списка. Новая функция, прежние ключи не расширены.
--     Вход: не NULL, не более 50 различных id, иначе 22023. EXECUTE только у authenticated.
--  B. platform.staff_sales_handoff_facts (212, 247): тот же вход, выход, ошибки и порядок; проверка `lead.read` на каждый лид строкой
--     (platform_private.staff_can_access на строку, ~6 мс на проверку и три вызова на «Сегодня») заменена множеством 310
--     platform_private.staff_visible_ids_v1(org, membership, 'lead.read', 'lead', id_лидов): то же правило, один раз на запрос.
--     Множество равно построчной проверке (suite 310 и supabase/tests/platform_today_finance_speed.sql).
--
-- Forward-only. Повтор отказывает a367_already_applied. Тело B меняется только если оно ещё прежнее (247): иначе a367_drift.
-- ============================================================

BEGIN;

DO $a367_guard$
DECLARE definition TEXT;
BEGIN
  IF to_regprocedure('platform.staff_task_lead_refs_v1(uuid,uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'a367_already_applied' USING ERRCODE = '55000';
  END IF;
  definition := pg_get_functiondef('platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure);
  IF strpos(definition, $$AND platform_private.staff_can_access($$) = 0
    OR strpos(definition, $$p_organization_id, actor.membership_id, 'lead.read', 'lead', l.id)$$) = 0
    OR strpos(definition, $$platform_private.sales_lead_handoffs($$) = 0
    OR strpos(definition, 'staff_visible_ids_v1') <> 0 THEN
    RAISE EXCEPTION 'a367_drift: platform.staff_sales_handoff_facts is not the 247 body';
  END IF;
  IF to_regprocedure('platform_private.staff_visible_ids_v1(uuid,uuid,text,text,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'a367_drift: the migration 310 set primitive is missing';
  END IF;
END
$a367_guard$;

-- ---------------------------------------------------------------------------
-- A. Лиды задач-перезвонов одним чтением
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_task_lead_refs_v1(p_organization_id UUID, p_task_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  task_id UUID;
  context JSONB;
  lead JSONB;
  refs JSONB := '[]'::JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_task_ids IS NULL OR cardinality(p_task_ids) > 50
    OR EXISTS (SELECT 1 FROM unnest(p_task_ids) AS id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_task_ids) AS id) <> cardinality(p_task_ids) THEN
    RAISE EXCEPTION 'staff_task_lead_refs_invalid' USING ERRCODE = '22023';
  END IF;
  FOREACH task_id IN ARRAY p_task_ids LOOP
    BEGIN
      -- The two reads below decide, exactly as the page's per-task reads did (147, 156): a task the actor may not read or a
      -- lead the actor may not read raises 42501 and the task simply has no entry.
      context := platform.staff_task_context(p_organization_id, task_id);
      CONTINUE WHEN context ->> 'lead_id' IS NULL;
      lead := platform.staff_task_lead_context(p_organization_id, (context ->> 'lead_id')::UUID);
      refs := refs || jsonb_build_array(jsonb_build_object(
        'task_id', task_id, 'lead_id', lead ->> 'lead_id', 'client_name', lead ->> 'client_name'));
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;
  RETURN jsonb_build_object('refs', refs);
END
$$;

REVOKE ALL ON FUNCTION platform.staff_task_lead_refs_v1(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_task_lead_refs_v1(UUID, UUID[]) TO authenticated;

COMMENT ON FUNCTION platform.staff_task_lead_refs_v1(UUID, UUID[]) IS
  '367: lead id and client name of up to 50 staff tasks in one read. Decides by calling staff_task_context and staff_task_lead_context per task, so authorization is exactly theirs; a task they refuse has no entry.';

-- ---------------------------------------------------------------------------
-- B. staff_sales_handoff_facts: lead.read as one set, not per row (247 body, one predicate replaced)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.staff_sales_handoff_facts(p_organization_id UUID, p_lead_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  visible_count BIGINT;
  facts JSONB;
BEGIN
  SELECT a.* INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id
    AND platform_private.staff_has_permission(a.organization_id, a.membership_id, 'lead.read');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_lead_ids IS NULL OR cardinality(p_lead_ids) > 4000
    OR EXISTS (SELECT 1 FROM unnest(p_lead_ids) id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_lead_ids) id) <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_invalid' USING ERRCODE = '22023';
  END IF;

  WITH readable AS MATERIALIZED (
    -- The 310 set primitive: the same rule as staff_can_access(.., 'lead.read', 'lead', id), computed once for the batch.
    SELECT v.id FROM platform_private.staff_visible_ids_v1(
      p_organization_id, actor.membership_id, 'lead.read', 'lead', p_lead_ids) AS v(id)
  ), visible_leads AS MATERIALIZED (
    SELECT l.id FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = ANY(p_lead_ids)
      AND l.lifecycle_state = 'open'
      AND l.id IN (SELECT r.id FROM readable r)
  ), handoffs AS MATERIALIZED (
    SELECT h.lead_id, h.completed_at
    FROM platform_private.sales_lead_handoffs(p_organization_id, ARRAY(SELECT v.id FROM visible_leads v)) h
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object(
    'lead_id', l.id, 'completed', h.completed_at IS NOT NULL,
    'completed_at', h.completed_at) ORDER BY l.id), '[]'::JSONB)
  INTO visible_count, facts
  FROM visible_leads l LEFT JOIN handoffs h ON h.lead_id = l.id;

  -- Missing, closed and inaccessible IDs all deny the complete batch. Never
  -- turn an omitted record into a false "not handed off" result.
  IF visible_count <> cardinality(p_lead_ids) THEN
    RAISE EXCEPTION 'sales_handoff_facts_forbidden' USING ERRCODE = '42501';
  END IF;
  -- JSON avoids PostgREST's row cap silently clipping a board-sized batch.
  RETURN jsonb_build_object('organization_id', p_organization_id, 'leads', facts);
END
$$;

DO $a367_verify$
DECLARE routine RECORD;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE AS signature, p.prosecdef, p.proconfig, p.provolatile
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid IN ('platform.staff_task_lead_refs_v1(uuid,uuid[])'::regprocedure,
      'platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure)
  LOOP
    IF NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR routine.provolatile <> 's'
      OR has_function_privilege('anon', routine.signature, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'a367_verification_failed: %', routine.signature;
    END IF;
  END LOOP;
  IF strpos(pg_get_functiondef('platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure), 'staff_visible_ids_v1') = 0
    OR strpos(pg_get_functiondef('platform.staff_sales_handoff_facts(uuid,uuid[])'::regprocedure), 'platform_private.staff_can_access(') <> 0 THEN
    RAISE EXCEPTION 'a367_verification_failed: handoff facts must use the set primitive';
  END IF;
END
$a367_verify$;

COMMIT;
