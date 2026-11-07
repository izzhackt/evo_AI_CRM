-- ============================================================
-- 347_platform_wording_fixes.sql
--
-- Две мелочи, найденные проверкой боевой CRM 07.11.2026 (пользователь: «исправь»). Хуки набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- 1. Задача после передачи дела называлась «Проверить унаследованный контекст Sales» — английское слово на экране.
--    Теперь «Проверить данные от отдела продаж»: в обеих функциях, которые её создают (088 handoff_lead_to_admissions —
--    задача и «следующий шаг» нового дела; 258 record_pending_case_sales_handoff — задача), и в уже созданных задачах.
--    «Следующий шаг» уже переданных дел не переписывается: дело с применённым сценарием меняется только версионной
--    командой (триггер admissions_guard_case), его меняет куратор.
-- 2. Очередь «Запросы на удаление» называла кабинет от администратора служебной почтой
--    `student-…@students.evoadmissions.invalid` (342). Теперь вместо неё логин студента (340); настоящая почта — как была.
--
-- Тела функций меняются заменой проверенных фрагментов (шаблон 281/282, как 345): каждый фрагмент обязан встретиться
-- ровно столько раз, сколько ожидается, иначе миграция падает, ничего не меняя. CREATE OR REPLACE сохраняет владельца
-- и права. Forward-only: повтор отказывает a347_already_applied.
-- ============================================================

BEGIN;

DO $a347_guard$
BEGIN
  IF pg_get_functiondef('platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)'::regprocedure)
      LIKE '%platform_private.student_logins%' THEN
    RAISE EXCEPTION 'a347_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a347_guard$;

CREATE FUNCTION pg_temp.a347_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_count INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_count THEN
    RAISE EXCEPTION 'a347_replace_drift: % expected %, found %', p_signature, p_count, matches;
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

-- 1. Название задачи и «следующий шаг» после передачи дела.
SELECT pg_temp.a347_replace('platform_private.handoff_lead_to_admissions(uuid,bigint,uuid,text,text,uuid)',
  $old$'Проверить унаследованный контекст Sales'$old$, $new$'Проверить данные от отдела продаж'$new$, 3);
SELECT pg_temp.a347_replace(
  'platform_private.record_pending_case_sales_handoff(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone,uuid)',
  $old$'Проверить унаследованный контекст Sales'$old$, $new$'Проверить данные от отдела продаж'$new$, 1);

UPDATE platform.case_tasks
SET title = 'Проверить данные от отдела продаж'
WHERE title = 'Проверить унаследованный контекст Sales';

-- 2. Логин вместо служебной почты в очереди удаления. Без имени в профиле очередь называла кабинет этой почтой и в
--    имени: тогда имя — логин, а почты в строке нет (логин не повторяется).
--    Сначала соединение с логином: каждая замена сразу пересоздаёт функцию, и тело должно быть верным на каждом шаге.
SELECT pg_temp.a347_replace('platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)',
  $old$platform_private.account_deletion_plan(r) plan$old$,
  $new$platform_private.account_deletion_plan(r) plan
    LEFT JOIN platform_private.student_logins AS cabinet ON cabinet.auth_user_id = r.subject_auth_user_id$new$, 1);
SELECT pg_temp.a347_replace('platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)',
  $old$'displayName', person.display_name,$old$,
  $new$-- 347: у кабинета от администратора служебная почта (342); очередь называет его логином (340).
    'displayName', CASE WHEN person.display_name LIKE '%@students.evoadmissions.invalid'
      THEN COALESCE(cabinet.login, 'Кабинет студента') ELSE person.display_name END,$new$, 1);
SELECT pg_temp.a347_replace('platform_private.account_deletion_queue_row(platform_private.account_deletion_requests)',
  $old$'email', person.email,$old$,
  $new$'email', CASE
      WHEN person.email IS NULL OR person.email NOT LIKE '%@students.evoadmissions.invalid' THEN person.email
      WHEN person.display_name LIKE '%@students.evoadmissions.invalid' THEN NULL
      ELSE cabinet.login END,$new$, 1);

COMMIT;
