-- ============================================================
-- 372_platform_board_pages_one_read.sql
--
-- «Главная»: лиды и задачи одним чтением вместо страниц подряд (запись docs/PLAN_CHANGES.md 21.11.2026).
-- Smoke выпуска r320.1-a2406d91: `/main` 21 RPC, последовательная глубина 6, 1,23 с на холодном старте. Доска продаж
-- читалась страницами по 100 одна за другой (лидов без ответственного на production 336 = 4 запроса подряд), задачи
-- «Мои» — по 50 (у сотрудника 270 открытых задач = 4 запроса подряд): каждая страница ждала конца предыдущей.
--
-- Добавляются две читающие функции. Таблицы, строки, права и прежние функции не меняются.
--  A. platform.staff_sales_lead_pages_v1(page_size, max_pages, фильтры доски): внутри базы листает прежнюю
--     platform.staff_sales_lead_page (123) с теми же фильтрами и тем же курсором (sort_at, lead_id), что код вызывал раньше
--     страница за страницей: страница просит page_size + 1 строк, лишняя строка значит «есть дальше».
--     Ответ: {"rows": [строки прежней функции подряд], "truncated": есть ли строки после max_pages страниц}.
--  B. platform.staff_task_list_pages_v1(org, view, status, page_size, max_pages): так же листает platform.staff_task_list (140)
--     курсором (updated_at, id). Ответ того же вида.
-- Права РОВНО прежние: обе функции SECURITY INVOKER, решение принимает прежняя функция, вызванная от имени того же сотрудника,
-- и её отказ (SQLSTATE и текст) возвращается как есть. Строка ответа — to_jsonb строки прежней функции, в её порядке.
-- Все страницы читаются одним запросом, то есть в одном снимке базы. Пределы: лиды page_size 1..100, max_pages 1..40;
-- задачи page_size 1..100, max_pages 1..10; иначе 22023. EXECUTE только у authenticated.
-- Все страницы идут в одном запросе, то есть под одним statement_timeout (у authenticated 8 с). Замер production 21.11
-- (чтение без записи, под сотрудником с наибольшим числом лидов): 336 лидов без ответственного, 4 страницы, 78–135 мс;
-- вся доска, 498 лидов, 5 страниц, 345–369 мс; страница стоит 20–85 мс, так что и предел в 40 страниц укладывается.
--
-- Forward-only. Повтор отказывает a372_already_applied.
-- ============================================================

BEGIN;

DO $a372_guard$
BEGIN
  IF to_regprocedure('platform.staff_sales_lead_pages_v1(integer,integer,text,text,text,uuid,text,text)') IS NOT NULL
    OR to_regprocedure('platform.staff_task_list_pages_v1(uuid,text,text,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'a372_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)') IS NULL
    OR to_regprocedure('platform.staff_task_list(uuid,text,text,timestamp with time zone,uuid,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'a372_drift: a paged read function of migrations 123/140 is missing';
  END IF;
END
$a372_guard$;

-- ---------------------------------------------------------------------------
-- A. Доска продаж: все страницы одним чтением
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_sales_lead_pages_v1(
  p_page_size INTEGER,
  p_max_pages INTEGER,
  p_connection_filter TEXT DEFAULT 'all',
  p_stage_filter TEXT DEFAULT NULL,
  p_assignment_filter TEXT DEFAULT 'all',
  p_owner_membership_id UUID DEFAULT NULL,
  p_due_filter TEXT DEFAULT 'all',
  p_query TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  page JSONB;
  collected JSONB := '[]'::JSONB;
  cursor_at TIMESTAMPTZ := NULL;
  cursor_id UUID := NULL;
  page_number INTEGER := 0;
BEGIN
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_max_pages IS NULL OR p_max_pages NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'sales_workflow_invalid_limit' USING ERRCODE = '22023';
  END IF;
  LOOP
    page_number := page_number + 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(lead_row) - 'ordinality' ORDER BY lead_row.ordinality), '[]'::JSONB)
      INTO page
      FROM platform.staff_sales_lead_page(
        p_page_size + 1, cursor_at, cursor_id, p_connection_filter, p_stage_filter, p_assignment_filter,
        p_owner_membership_id, p_due_filter, p_query
      ) WITH ORDINALITY AS lead_row;
    IF jsonb_array_length(page) <= p_page_size THEN
      RETURN jsonb_build_object('rows', collected || page, 'truncated', FALSE);
    END IF;
    -- The extra row only says «there is more»; the next page starts after the last row of this one.
    collected := collected || (page - p_page_size);
    IF page_number >= p_max_pages THEN
      RETURN jsonb_build_object('rows', collected, 'truncated', TRUE);
    END IF;
    cursor_at := (page -> (p_page_size - 1) ->> 'sort_at')::TIMESTAMPTZ;
    cursor_id := (page -> (p_page_size - 1) ->> 'lead_id')::UUID;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- B. Рабочие задачи: все страницы одним чтением
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.staff_task_list_pages_v1(
  p_organization_id UUID,
  p_view TEXT,
  p_status TEXT,
  p_page_size INTEGER,
  p_max_pages INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  page JSONB;
  collected JSONB := '[]'::JSONB;
  cursor_at TIMESTAMPTZ := NULL;
  cursor_id UUID := NULL;
  page_number INTEGER := 0;
BEGIN
  IF p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR p_max_pages IS NULL OR p_max_pages NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'staff_task_invalid_limit' USING ERRCODE = '22023';
  END IF;
  LOOP
    page_number := page_number + 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(task_row) - 'ordinality' ORDER BY task_row.ordinality), '[]'::JSONB)
      INTO page
      FROM platform.staff_task_list(
        p_organization_id, p_view, p_status, cursor_at, cursor_id, NULL, p_page_size + 1
      ) WITH ORDINALITY AS task_row;
    IF jsonb_array_length(page) <= p_page_size THEN
      RETURN jsonb_build_object('rows', collected || page, 'truncated', FALSE);
    END IF;
    collected := collected || (page - p_page_size);
    IF page_number >= p_max_pages THEN
      RETURN jsonb_build_object('rows', collected, 'truncated', TRUE);
    END IF;
    cursor_at := (page -> (p_page_size - 1) ->> 'updated_at')::TIMESTAMPTZ;
    cursor_id := (page -> (p_page_size - 1) ->> 'id')::UUID;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_sales_lead_pages_v1(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_sales_lead_pages_v1(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_task_list_pages_v1(UUID, TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_task_list_pages_v1(UUID, TEXT, TEXT, INTEGER, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_sales_lead_pages_v1(INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Every page of platform.staff_sales_lead_page in one read (same caller, filters, cursor and rows): {rows, truncated}.';
COMMENT ON FUNCTION platform.staff_task_list_pages_v1(UUID, TEXT, TEXT, INTEGER, INTEGER) IS
  'Every page of platform.staff_task_list in one read (same caller, view, status, cursor and rows): {rows, truncated}.';

COMMIT;
