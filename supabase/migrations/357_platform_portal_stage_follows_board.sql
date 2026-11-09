-- ============================================================
-- 357_platform_portal_stage_follows_board.sql
--
-- Этап в кабинете студента следует за доской «Воронка поступления» (09.11.2026, разбор владельца по делу студента:
-- в CRM «Документы», 3 из 9, а в кабинете «Приём», шаг 1 из 7).
--
-- Причина: кабинет (веб и приложение) читает этап из `student_portal_overview_v2()`, а та отдаёт
-- `student_cases.operational_stage`. Кураторы двигают карточку на доске, то есть `pipeline_stage` (187); 187 намеренно
-- отвязала доску от `operational_stage`, и экраны сотрудников `operational_stage` не меняют. На 09.11 у всех 98 дел в
-- работе `operational_stage = 'intake'`: каждый студент видит «Приём», где бы ни стояло дело.
--
-- Что меняется: только выражение этапа в ответе `platform.student_portal_overview_v2()`. Имя и тип колонки прежние,
-- поэтому веб и уже собранное приложение читают её без изменений. Таблицы, данные, права и `operational_stage` дела
-- не трогаются.
--
-- Правило (чистое чтение):
--   * этап дела на пути кабинета (intake … arrival_and_adaptation) — кабинет показывает дальний из двух: этап дела или
--     этап колонки доски. Колонка доски переводится в этап кабинета так (обратное к переносу 187):
--       new → intake, shortlist → profile_and_route, documents → documents, ready_to_submit → applications,
--       awaiting_decision → decisions, confirmed / visa / predeparture → visa_and_predeparture
--       (вкладка доски «Виза и выезд»), arrived → arrival_and_adaptation;
--   * любой другой этап дела (передача, договор, анкета, завершено, закрыто, нестандартный) — как раньше, без доски.
--
-- Замена одного проверенного фрагмента тела (шаблон 350, 353, 355): `student_case.operational_stage,` должен
-- встретиться ровно один раз, иначе миграция падает, ничего не меняя. CREATE OR REPLACE сохраняет владельца,
-- SECURITY DEFINER, пустой search_path и права. Forward-only: повтор отказывает a357_already_applied. Файл
-- самодостаточен: при смене номера достаточно переименовать его (номер только в префиксе a357).
-- ============================================================

BEGIN;

DO $a357$
DECLARE
  fn CONSTANT REGPROCEDURE := 'platform.student_portal_overview_v2()'::REGPROCEDURE;
  definition TEXT;
  old_fragment CONSTANT TEXT := E'  SELECT\n    student_case.operational_stage,\n';
  new_fragment CONSTANT TEXT := E'  SELECT\n'
    || E'    -- 357: этап кабинета следует за колонкой доски (дальний из двух), см. заголовок миграции.\n'
    || E'    CASE\n'
    || E'      WHEN array_position(ARRAY[''intake'',''profile_and_route'',''documents'',''applications'',''decisions'',\n'
    || E'        ''visa_and_predeparture'',''arrival_and_adaptation''], student_case.operational_stage) IS NULL\n'
    || E'        THEN student_case.operational_stage\n'
    || E'      ELSE (ARRAY[''intake'',''profile_and_route'',''documents'',''applications'',''decisions'',\n'
    || E'        ''visa_and_predeparture'',''arrival_and_adaptation''])[GREATEST(\n'
    || E'        array_position(ARRAY[''intake'',''profile_and_route'',''documents'',''applications'',''decisions'',\n'
    || E'          ''visa_and_predeparture'',''arrival_and_adaptation''], student_case.operational_stage),\n'
    || E'        CASE student_case.pipeline_stage\n'
    || E'          WHEN ''shortlist'' THEN 2 WHEN ''documents'' THEN 3 WHEN ''ready_to_submit'' THEN 4\n'
    || E'          WHEN ''awaiting_decision'' THEN 5 WHEN ''confirmed'' THEN 6 WHEN ''visa'' THEN 6\n'
    || E'          WHEN ''predeparture'' THEN 6 WHEN ''arrived'' THEN 7 ELSE 1 END)]\n'
    || E'    END AS operational_stage,\n';
  matches INTEGER;
BEGIN
  definition := pg_get_functiondef(fn);
  IF position('357: этап кабинета следует за колонкой доски' IN definition) > 0 THEN
    RAISE EXCEPTION 'a357_already_applied';
  END IF;
  matches := (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment);
  IF matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'a357_replace_drift: student_portal_overview_v2 stage fragment expected 1, found %; review migration 357', matches;
  END IF;
  EXECUTE replace(definition, old_fragment, new_fragment);
END
$a357$;

COMMIT;
