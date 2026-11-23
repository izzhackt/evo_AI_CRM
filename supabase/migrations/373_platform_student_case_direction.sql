-- ============================================================
-- 373_platform_student_case_direction.sql
--
-- Страна своего дела для справки «Образец и советы» во вкладке «Документы» кабинета (23.11.2026). Справка
-- показывала требования страны из выбора студента (284: сохранённый выбор, иначе анкета, иначе дело). А список
-- документов поставлен по стране дела (338: admissions_direction, иначе target_country кодом, иначе направление
-- анкеты дела). Если студент выбрал на «Главной» другую страну или в анкете была другая, справка показывала
-- требования чужой страны, например другой размер фото. Здесь — чтение страны своих дел тем же правилом, что у 338;
-- веб берёт его первым, выбор студента остаётся запасным.
--
--  a) platform_private.student_case_direction(org, case): правило 338 одной функцией, закрыта от всех ролей.
--  b) platform.student_portal_case_directions_v1(): строки (student_case_id, direction) своих дел с кабинетом
--     (pending, active, closed), с теми же проверками входа, прав и областей, что у 357. Направление — код
--     ('CN', 'MY', 'AE', 'TR', 'EUROPE') или NULL. Других полей дела чтение не отдаёт.
--
-- Только студент о себе; сотрудник и чужой студент получают пустой ответ, anon — отказ. В журнал не пишется: это
-- чтение. Forward-only: повтор отказывает a373_already_applied. Новых прав нет, кроме EXECUTE чтения для authenticated.
-- ============================================================

BEGIN;

DO $a373_guard$
BEGIN
  IF to_regprocedure('platform.student_portal_case_directions_v1()') IS NOT NULL
    OR to_regprocedure('platform_private.student_case_direction(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a373_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a373_guard$;

-- ---------------------------------------------------------------------------
-- a) Правило страны дела — то же, что ставит список документов (338).
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.student_case_direction(p_organization_id UUID, p_student_case_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    student_case.admissions_direction,
    platform_private.student_application_direction(upper(btrim(student_case.target_country))),
    (SELECT application.admissions_direction
     FROM platform_private.student_applications AS application
     WHERE application.organization_id = p_organization_id
       AND (application.student_case_id = p_student_case_id OR application.invited_case_id = p_student_case_id)
     ORDER BY application.submitted_at DESC NULLS LAST, application.id DESC
     LIMIT 1))
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
$$;

COMMENT ON FUNCTION platform_private.student_case_direction(UUID, UUID)
  IS 'Country of a student case by the 338 rule: admissions_direction, else target_country as a code, else the case application direction (373).';

-- ---------------------------------------------------------------------------
-- b) Чтение студента о себе: страна каждого своего дела с кабинетом.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform.student_portal_case_directions_v1()
RETURNS TABLE(student_case_id UUID, direction TEXT)
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
  SELECT student_case.id, platform_private.student_case_direction(student_case.organization_id, student_case.id)
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

COMMENT ON FUNCTION platform.student_portal_case_directions_v1()
  IS 'The signed-in student''s own portal cases with their country by the 338 rule; the document help follows it (373).';

REVOKE ALL ON FUNCTION platform_private.student_case_direction(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_portal_case_directions_v1() FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_case_directions_v1() TO authenticated;

-- ---------------------------------------------------------------------------
-- Проверка: обе функции SECURITY DEFINER с пустым search_path; закрытая функция никому не открыта.
-- ---------------------------------------------------------------------------
DO $a373_verify$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      WHERE p.oid IN (to_regprocedure('platform_private.student_case_direction(uuid,uuid)'),
                      to_regprocedure('platform.student_portal_case_directions_v1()'))
        AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 's') <> 2 THEN
    RAISE EXCEPTION 'a373_posture_broken: both functions must be stable SECURITY DEFINER with an empty search_path';
  END IF;
  IF has_function_privilege('authenticated', 'platform_private.student_case_direction(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform_private.student_case_direction(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'platform.student_portal_case_directions_v1()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'platform.student_portal_case_directions_v1()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a373_grants_broken';
  END IF;
END
$a373_verify$;

COMMIT;
