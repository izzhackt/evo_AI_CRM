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
-- Вторая часть: новое чтение `platform.student_portal_board_stage_v1()` — колонка доски своего дела (те же проверки,
-- что у обзора). По ней кабинет выбирает шаг пути страны, когда у одного этапа несколько шагов (см. ниже).
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

-- Колонка доски своего дела — отдельным чтением, а не новой колонкой обзора: веб и приложение разбирают ответ обзора
-- строго по набору ключей, лишняя колонка сломала бы уже собранные версии. Одна колонка доски точнее этапа там, где у
-- страны несколько шагов одного этапа (Малайзия: «Виза» и «Билет, SEV, MDAC и жильё»): кабинет выбирает шаг по ней.
-- Те же проверки и тот же выбор дела, что у `student_portal_overview_v2()`; студент видит только колонку своего дела.
CREATE FUNCTION platform.student_portal_board_stage_v1()
RETURNS TABLE(board_stage TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH authority AS MATERIALIZED (
    SELECT current_authority.*
    FROM platform.current_actor_authority() AS current_authority
    JOIN platform.organization_memberships AS student_membership
      ON student_membership.organization_id = current_authority.organization_id
      AND student_membership.id = current_authority.membership_id
      AND student_membership.status = 'active'
      AND student_membership."current_role" = 'student'
    JOIN platform.profiles AS student_profile
      ON student_profile.id = student_membership.profile_id
      AND student_profile.id = current_authority.profile_id
      AND student_profile.auth_user_id = current_authority.auth_user_id
      AND student_profile.auth_user_id = (SELECT auth.uid())
      AND student_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = student_membership.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = student_membership.current_bundle_id
      AND bundle.role = student_membership."current_role"
      AND bundle.status = 'published'
    WHERE current_authority.platform_role = 'student'
      AND private.platform_has_permission(current_authority.organization_id, 'portal.read.self')
      AND private.platform_has_scope(current_authority.organization_id, 'organization'::platform.scope_kind,
        current_authority.organization_id)
  )
  SELECT student_case.pipeline_stage
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  WHERE student_case.state IN ('pending', 'active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL
    AND private.platform_can_read_student_portal_case(student_case.organization_id, student_case.id)
    AND private.platform_has_permission(student_case.organization_id, 'portal.read.self')
    AND private.platform_has_scope(student_case.organization_id, 'organization'::platform.scope_kind,
      student_case.organization_id)
    AND private.platform_has_scope(student_case.organization_id, 'student_case'::platform.scope_kind, student_case.id)
  ORDER BY student_case.created_at, student_case.id
$$;

REVOKE ALL ON FUNCTION platform.student_portal_board_stage_v1() FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_board_stage_v1() TO authenticated;

COMMIT;
