-- ============================================================
-- 374_platform_case_country_search.sql
--
-- Поиск и фильтр по стране дела понимают слово, а не только то, как страна записана (решение владельца 25.11.2026:
-- «Да, починить» на вопрос «Починить поиск, чтобы слово «Китай» находило дела с кодом CN?»). Хуки набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Что было. `student_cases.target_country` — свободный TEXT, и пути записи кладут туда разное: код списка продукта (`CN`:
-- «Добавить студента», импорт amoCRM 281, «Отчёт продаж» 307), название из анкеты (`China`, 177) или слово по-русски.
-- Экраны CRM с #1531 показывают всё это словом («Китай»), а поиск сравнивал запрос с записанным как есть: «Китай» не
-- находил дела с `CN` и `China`, хотя на экране у них написано «Китай». Фильтр страны на доске «Воронка поступления» слал
-- код `CN` и отбирал только дела с ровно таким текстом: дела с `China` исчезали из фильтра «Китай».
--
-- Что стало. Слова страны берутся из того, что в базе уже есть: platform.study_countries (код и названия RU, KY, EN, 282–283)
-- и platform_private.study_country_from_text (284: код, название, частые написания → код одной из шести стран; иначе NULL).
-- Нового словаря нет. Страна разбирается ОДИН раз на запрос, а не на каждую строку (на 6000 дел функция на строку
-- замедляла поиск в 5 раз, счётчики с запросом «Китай» — в 6):
--   1. platform_private.case_country_codes_matching(запрос) — коды шести стран, в чьём коде или названиях (RU, KY, EN)
--      запрос встречается с начала слова; от трёх букв («кит», «Китай», «china»), короче, пустой запрос и NULL — пустой
--      массив. Так «ма» или «ки» (начала многих имён) не тянут в поиск по имени все дела Малайзии и Китая.
--   2. platform_private.case_country_spellings(коды) — все различные записи target_country в делах, которые означают
--      одну из этих стран (`CN`, `China`, `Китай`, `Кытай`, ...). Различных записей единицы, разбирает их
--      study_country_from_text; для строк дел ничего не вызывается.
--   3. Поиск по студентам (staff_student_case_page — Ctrl+K, предупреждение о дубле, диалог задачи, «Клиентская база»;
--      staff_student_case_queue_v1 и staff_student_case_queue_counts_v1 — очередь «Студенты» и её счётчики) берёт дело, и
--      если страна дела записана одним из этих способов. Подзапрос в скобках вычисляется один раз на запрос. Запись дела
--      остаётся в поиске как есть: прежние запросы (`CN`, `china`, фрагмент слова) находят то же. Очередь и счётчики
--      правятся одинаково: число в шапке не расходится со списком.
--   4. Доска «Воронка поступления» (staff_admissions_pipeline_board_v1): фильтр страны отбирает дела той же страны по
--      тому же правилу, а не только с ровно таким текстом. Страна вне шести сравнивается как раньше, точно.
-- Права, таблицы и действия журнала те же. Forward-only: повтор отказывает a374_already_applied, чужое тело функции —
-- a374_replace_drift.
-- ============================================================

BEGIN;

DO $a374_guard$
BEGIN
  IF to_regprocedure('platform_private.case_country_codes_matching(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'a374_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a374_guard$;

-- Коды стран, в чьём коде или названиях запрос встречается С НАЧАЛА СЛОВА (без учёта регистра), от трёх букв: «кит»,
-- «Китай», «china», «arab» находят страну, «тай» внутри слова и «ма» (начало слишком многих имён) — нет. Иначе слово
-- страны вытягивало бы в поиск по имени все дела страны. Названия — из platform.study_countries, той же таблицы, что у
-- каталога. Короче трёх букв и пустой запрос ничего не выбирают: такой запрос находит то, что записано в деле как есть.
CREATE FUNCTION platform_private.case_country_codes_matching(p_query TEXT)
RETURNS TEXT[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(country.country_code ORDER BY country.sort_order), ARRAY[]::TEXT[])
  FROM platform.study_countries AS country
  WHERE char_length(btrim(COALESCE(p_query, ''))) >= 3
    AND strpos(' ' || lower(concat_ws(' ', country.country_code, country.name_ru, country.name_ky, country.name_en)),
      ' ' || lower(btrim(p_query))) > 0
$$;

-- Все различные записи страны в делах, которые значат одну из этих стран. Различных записей единицы: разбор
-- study_country_from_text (код, EN, RU, KY, частые написания) идёт по ним, а не по строкам дел. Читает только
-- записанные тексты стран, ни одного дела не отдаёт; вызывается из читающих функций ниже.
-- MATERIALIZED обязателен: без него планировщик переносит условие под DISTINCT и разбирает страну у каждой строки дел
-- (на 6000 дел это 30 мс на каждый запрос вместо 1 мс).
CREATE FUNCTION platform_private.case_country_spellings(p_codes TEXT[])
RETURNS TEXT[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH spelling AS MATERIALIZED (
    SELECT DISTINCT student_case.target_country
    FROM platform.student_cases AS student_case
    WHERE student_case.target_country IS NOT NULL
  )
  SELECT COALESCE(array_agg(spelling.target_country ORDER BY spelling.target_country), ARRAY[]::TEXT[])
  FROM spelling
  WHERE platform_private.study_country_from_text(spelling.target_country) = ANY (p_codes)
$$;

-- Правка тел за один проход; у каждого фрагмента своё ожидаемое число совпадений, иначе миграция падает.
CREATE FUNCTION pg_temp.a374_patch(p_signature TEXT, p_old TEXT[], p_new TEXT[], p_count INTEGER[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER; i INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  IF body IS NULL THEN
    RAISE EXCEPTION 'a374_replace_drift: % is missing', p_signature USING ERRCODE = '55000';
  END IF;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    matches := (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]);
    IF matches IS DISTINCT FROM p_count[i] THEN
      RAISE EXCEPTION 'a374_replace_drift: % fragment % expected %, found %', p_signature, i, p_count[i], matches
        USING ERRCODE = '55000';
    END IF;
    body := replace(body, p_old[i], p_new[i]);
  END LOOP;
  EXECUTE body;
END
$$;

-- 1. Поиск «Студентов»: дело берётся и по стране, записанной любым способом. Остальное тело функций прежнее. Подзапрос
-- `(SELECT ...)` без ссылок на строку планировщик вычисляет один раз на запрос.
SELECT pg_temp.a374_patch('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)',
  ARRAY[$old1$OR btrim(p_query) = ''$old1$],
  ARRAY[$new1$OR btrim(p_query) = ''
        OR visible.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(p_query)))::TEXT[])$new1$],
  ARRAY[1]);

SELECT pg_temp.a374_patch('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)',
  ARRAY[$old1$AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,$old1$],
  ARRAY[$new1$AND (q IS NULL
        OR c.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(q)))::TEXT[])
        OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,$new1$],
  ARRAY[1]);

SELECT pg_temp.a374_patch('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)',
  ARRAY[$old1$AND (q IS NULL OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,$old1$],
  ARRAY[$new1$AND (q IS NULL
        OR c.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(q)))::TEXT[])
        OR strpos(lower(concat_ws(' ', c.student_display_name, c.target_country,$new1$],
  ARRAY[1]);

-- 2. Фильтр страны на доске: дела с `CN`, `China` и «Китай» — одна страна. Страна вне шести: пустой набор записей, остаётся
-- прежнее точное сравнение.
SELECT pg_temp.a374_patch('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)',
  ARRAY[$old1$AND (p_country IS NULL OR c.target_country = p_country)$old1$],
  ARRAY[$new1$AND (p_country IS NULL
        OR c.target_country = p_country
        OR c.target_country = ANY ((SELECT platform_private.case_country_spellings(ARRAY[platform_private.study_country_from_text(p_country)]))::TEXT[]))$new1$],
  ARRAY[1]);

-- Новые тела действительно подключили правило (защита от тихой правки в никуда).
DO $a374_verify$
BEGIN
  IF strpos(pg_get_functiondef('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::regprocedure),
       'visible.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(p_query)))::TEXT[])') = 0
    OR strpos(pg_get_functiondef('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure),
       'c.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(q)))::TEXT[])') = 0
    OR strpos(pg_get_functiondef('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure),
       'c.target_country = ANY ((SELECT platform_private.case_country_spellings(platform_private.case_country_codes_matching(q)))::TEXT[])') = 0
    OR strpos(pg_get_functiondef('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure),
       'c.target_country = ANY ((SELECT platform_private.case_country_spellings(ARRAY[platform_private.study_country_from_text(p_country)]))::TEXT[])') = 0
  THEN
    RAISE EXCEPTION 'a374_replace_drift: a patched body does not carry the country rule' USING ERRCODE = '55000';
  END IF;
END
$a374_verify$;

REVOKE ALL ON FUNCTION
  platform_private.case_country_codes_matching(TEXT),
  platform_private.case_country_spellings(TEXT[])
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform_private.case_country_codes_matching(TEXT)
  IS 'Private 374: codes of the study countries whose code or RU, KY, EN name has a word starting with the typed text (three letters or more); empty otherwise.';
COMMENT ON FUNCTION platform_private.case_country_spellings(TEXT[])
  IS 'Private 374: the distinct target_country texts in student_cases that mean one of the given study country codes (study_country_from_text); texts only, no case data.';

-- Описания функций дополняются, а не заменяются: у очереди, счётчиков и доски там их история.
DO $a374_comments$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid,text,uuid,text)'::regprocedure,
        'Student case page (Ctrl+K, duplicate hint, task dialog, client base). 374: the query also finds the cases of a country by its word, whichever way target_country is written (CN, China, Китай).'),
      ('platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::regprocedure,
        '374: the query also finds the cases of a country by its word (CN, China and Китай are one country).'),
      ('platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure,
        '374: the query matches the same way as in staff_student_case_queue_v1 (country words), so the counts follow the list.'),
      ('platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::regprocedure,
        '374: the country filter matches a case by country, whichever way target_country is written (CN, China, Китай).')
    ) AS t(routine, note)
  LOOP
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', item.routine,
      concat_ws(' ', obj_description(item.routine, 'pg_proc'), item.note));
  END LOOP;
END
$a374_comments$;

NOTIFY pgrst, 'reload schema';

COMMIT;
