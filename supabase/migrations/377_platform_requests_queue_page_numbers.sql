-- 377: «Заявки» — номера страниц (1 2 3 …), а не только «Предыдущая / Следующая».
--
-- Было: `platform.staff_requests_queue_v3` (368) листает только курсором — от
-- границы текущей страницы вперёд или назад. Открыть сразу пятую страницу
-- нельзя: курсор пятой страницы знает только база.
--
-- Стало: `platform.staff_requests_queue_v4` — то же тело, что у v3 (права,
-- видимость, «Ждут разбора», числа вкладок, проверка журнала — без изменений),
-- плюс:
--   * `p_offset INTEGER DEFAULT 0` — сколько строк выбранного отбора пропустить
--     (0..50000; вместе с курсором нельзя): так открывается страница N;
--   * в ответе `version: 4` и `offset` — сколько строк отбора стоит до первой
--     строки страницы (и при переходе курсором), чтобы экран знал номер текущей
--     страницы.
-- Курсоры прежние (`v: 3`): «Следующая страница» по-прежнему идёт от границы
-- страницы и не пропускает заявку, которую за это время взяли в работу.
--
-- v4 собирается из текущего текста v3 самопроверяемой заменой (как 302/375):
-- каждый кусок должен найтись ровно один раз, иначе миграция падает. v3 не
-- меняется и остаётся для приложения прежней версии, пока оно не обновлено.

DO $a377_queue$
DECLARE original TEXT; body TEXT;
  head_old CONSTANT TEXT := $h$FUNCTION platform.staff_requests_queue_v3(p_organization_id uuid, p_source text DEFAULT 'all'::text, p_status text DEFAULT 'waiting'::text, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb)$h$;
  check_old CONSTANT TEXT := $c$OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN$c$;
  page_old CONSTANT TEXT := $p$f.sort_at DESC,f.kind DESC,f.id DESC LIMIT p_limit$p$;
  out_old CONSTANT TEXT := $o$SELECT jsonb_build_object('version',3,$o$;
BEGIN
  IF to_regprocedure('platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'a377_queue_v3_missing';
  END IF;
  IF to_regprocedure('platform.staff_requests_queue_v4(uuid,text,text,integer,jsonb,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'a377_queue_v4_exists';
  END IF;
  original := pg_get_functiondef('platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::regprocedure);
  IF (length(original) - length(replace(original, head_old, ''))) / length(head_old) <> 1
    OR (length(original) - length(replace(original, check_old, ''))) / length(check_old) <> 1
    OR (length(original) - length(replace(original, page_old, ''))) / length(page_old) <> 1
    OR (length(original) - length(replace(original, out_old, ''))) / length(out_old) <> 1
  THEN
    RAISE EXCEPTION 'a377_queue_anchor_drift';
  END IF;
  body := replace(original, head_old,
    $h$FUNCTION platform.staff_requests_queue_v4(p_organization_id uuid, p_source text DEFAULT 'all'::text, p_status text DEFAULT 'waiting'::text, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb, p_offset integer DEFAULT 0)$h$);
  body := replace(body, check_old,
    $c$OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 50000 OR (p_offset > 0 AND p_cursor IS NOT NULL) THEN$c$);
  body := replace(body, page_old, $p$f.sort_at DESC,f.kind DESC,f.id DESC LIMIT p_limit OFFSET p_offset$p$);
  body := replace(body, out_old,
    $o$SELECT jsonb_build_object('version',4,
    'offset',CASE WHEN EXISTS(SELECT 1 FROM page) THEN (SELECT count(*) FROM filtered f,
        (SELECT sort_at,kind,id FROM page ORDER BY sort_at DESC,kind DESC,id DESC LIMIT 1) first_row
      WHERE (f.sort_at,f.kind,f.id)>(first_row.sort_at,first_row.kind COLLATE "C",first_row.id)) ELSE p_offset END,$o$);
  EXECUTE body;
END
$a377_queue$;

REVOKE ALL ON FUNCTION platform.staff_requests_queue_v4(UUID, TEXT, TEXT, INTEGER, JSONB, INTEGER)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
DO $a377_agent$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evo_ai_agent') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION platform.staff_requests_queue_v4(UUID, TEXT, TEXT, INTEGER, JSONB, INTEGER) FROM evo_ai_agent';
  END IF;
END
$a377_agent$;
GRANT EXECUTE ON FUNCTION platform.staff_requests_queue_v4(UUID, TEXT, TEXT, INTEGER, JSONB, INTEGER) TO authenticated;
COMMENT ON FUNCTION platform.staff_requests_queue_v4(UUID, TEXT, TEXT, INTEGER, JSONB, INTEGER) IS
  'Очередь «Заявок» (377): тело v3 (368) и смещение p_offset для номеров страниц; в ответе version 4 и offset первой строки страницы.';

-- Самопроверка: та же осанка, что у v3 в 368.
DO $a377_verify$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
  f CONSTANT REGPROCEDURE := 'platform.staff_requests_queue_v4(uuid,text,text,integer,jsonb,integer)'::REGPROCEDURE;
BEGIN
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid = f;
  IF NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] OR p.provolatile <> 's'
    OR pg_get_userbyid(p.proowner) <> 'postgres'
    OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('service_role', f, 'EXECUTE')
    OR has_function_privilege('supabase_auth_admin', f, 'EXECUTE')
    OR (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evo_ai_agent') AND has_function_privilege('evo_ai_agent', f, 'EXECUTE'))
    OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'a377_function_posture' USING ERRCODE = '55000';
  END IF;
END
$a377_verify$;

NOTIFY pgrst, 'reload schema';
