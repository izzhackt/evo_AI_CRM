-- ============================================================
-- 370_platform_student_queue_counts_speed.sql
--
-- Скорость «Студентов» (аудит замеров 11–20.11.2026: полная загрузка `/profile` медиана 0,52 с, p90 0,86 с). Хук набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязан к имени файла, а не к номеру.
--
-- Что было. Числа вкладок, групп и меню `platform.staff_student_case_queue_counts_v1` (241, 242, 244, 245) решали «читает ли
-- сотрудник это дело» построчно: `private.platform_can_read_student_case(org, case)` на каждое дело организации. Страницу
-- очереди (`staff_student_case_queue_v1`) 310 уже перевела на множество читаемых дел, а числа остались на построчной проверке:
-- на каждое открытие «Студентов» один и тот же вопрос о правах задавался заново для каждого дела.
--
-- Что делает миграция. Числа читают то же множество, что и очередь: `platform_private.staff_readable_case_ids_for_actor_v1`
-- (310; зеркало построчной проверки, закреплено `supabase/tests/platform_permission_once.sql`). Тело берётся из боевого
-- определения и меняется двумя проверяемыми заменами (по одному совпадению каждая), как в 310:
--   1. CTE `readable_cases` перед `base`;
--   2. в `base` построчный вызов заменён на `c.id IN (SELECT ... FROM readable_cases)`.
-- Цепочка флагов (`platform_private.case_queue_flags`) считается в `base` один раз на дело, из них выводятся и вкладки, и
-- полосы, и группы; она по-прежнему только для читаемых дел (условие стоит в WHERE, выражение флагов — в списке полей).
-- Результат, ключи ответа, права, коды ошибок и их тексты прежние; сигнатура и тип результата не меняются.
--
-- Forward-only: повтор отказывает a370_already_applied; тело, которое не то, что выпущено до 370, — a370_anchor_drift.
-- CREATE OR REPLACE сохраняет владельца и права (EXECUTE только у authenticated); они ниже перепроверяются.
-- ============================================================

BEGIN;

DO $a370_counts$
DECLARE
  signature CONSTANT REGPROCEDURE := 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure;
  original TEXT;
  body TEXT;
  anchors CONSTANT TEXT[] := ARRAY[
    $q$  WITH base AS MATERIALIZED (
$q$,
    $q$      AND private.platform_can_read_student_case(c.organization_id, c.id)
$q$];
  replacements CONSTANT TEXT[] := ARRAY[
    $q$  WITH readable_cases AS MATERIALIZED (
    SELECT v.id
    FROM platform_private.staff_readable_case_ids_for_actor_v1(a.organization_id) AS v(id)
  ), base AS MATERIALIZED (
$q$,
    $q$      AND c.id IN (SELECT readable_case.id FROM readable_cases AS readable_case)
$q$];
  i INTEGER;
BEGIN
  original := pg_get_functiondef(signature);
  IF strpos(original, 'readable_cases') <> 0 THEN
    RAISE EXCEPTION 'a370_already_applied' USING ERRCODE = '55000';
  END IF;
  body := original;
  FOR i IN 1 .. cardinality(anchors) LOOP
    IF (length(body) - length(replace(body, anchors[i], ''))) / length(anchors[i]) <> 1 THEN
      RAISE EXCEPTION 'a370_anchor_drift: % (%)', signature, i;
    END IF;
    body := replace(body, anchors[i], replacements[i]);
  END LOOP;
  EXECUTE body;
END
$a370_counts$;

-- The row-by-row call is gone; the set primitive and the flags chain stay; grants as before.
DO $a370_verify$
DECLARE
  routine RECORD;
BEGIN
  SELECT p.oid::REGPROCEDURE AS signature, p.prosrc, p.prosecdef, p.proconfig, p.prorettype
    INTO routine
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = 'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::regprocedure;
  IF strpos(routine.prosrc, 'private.platform_can_read_student_case') <> 0
    OR strpos(routine.prosrc, 'staff_readable_case_ids_for_actor_v1') = 0
    OR strpos(routine.prosrc, 'platform_private.case_queue_flags(c.id)') = 0
    OR routine.prorettype <> 'jsonb'::REGTYPE
    OR NOT routine.prosecdef OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=""']
    OR has_function_privilege('anon', routine.signature, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', routine.signature, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'a370_verification_failed: %', routine.signature;
  END IF;
END
$a370_verify$;

COMMENT ON FUNCTION platform.staff_student_case_queue_counts_v1(TEXT, TEXT, UUID, TEXT, TEXT) IS
  '«Студенты» queue counts: views (pending since 242; needs_action with no step and chat waiting for staff since 245), due bands and direction/curator/stage facets under the exact filters of staff_student_case_queue_v1; visibility = the set platform_private.staff_readable_case_ids_for_actor_v1 (mirror of private.platform_can_read_student_case, set once per request since 370).';

COMMIT;
