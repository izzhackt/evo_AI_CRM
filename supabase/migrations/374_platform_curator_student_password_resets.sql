-- ============================================================
-- 374_platform_curator_student_password_resets.sql
--
-- Пароль студента сбрасывает и его куратор (решение владельца 25.11.2026: «Да, делай» на вопрос «Дать кураторам логин и
-- сброс пароля в своих делах?»). С 363 куратор открывает кабинет своему студенту, но сброс пароля (344) оставался у
-- System Admin: студенту, который временный пароль потерял или так и не получил, куратор без прав администратора новый
-- выдать не мог. Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Правило одно, в platform_private.student_password_reset_allowed: прежний System Admin с membership.provision (344)
-- ИЛИ назначенный куратор этого дела (student_cases.current_curator_membership_id) с доступом case.read.full к самому
-- делу, как в 363. Чужому делу, делу без куратора и любому другому сотруднику — прежний отказ 42501.
-- Правило проверяют обе точки 344:
--   1. authorize_student_password_reset_v1 — разрешение на один сброс (повтор запроса и отказы дела прежние);
--   2. complete_student_password_reset_v1 — уже под блокировками: тот же сотрудник с той же версией доступа и всё ещё
--      админ или куратор этого дела.
-- Карточка (staff_student_case_cabinet_v1) не меняется: с 363 она уже отдаёт куратору дела состояние кабинета и логин.
-- Причина в журнале говорит «сотрудником», а не «администратором»: кто именно сбросил пароль, журнал и так хранит
-- (actor_profile_id). Новых прав, таблиц и действий журнала нет. Forward-only: повтор отказывает a374_already_applied,
-- чужое тело функции — a374_replace_drift.
-- ============================================================

BEGIN;

DO $a374_guard$
BEGIN
  IF to_regprocedure('platform_private.student_password_reset_allowed(uuid,uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'a374_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a374_guard$;

-- Может ли этот сотрудник сбросить пароль студента этого дела: админ, как в 344, или назначенный куратор дела, как в 363.
CREATE FUNCTION platform_private.student_password_reset_allowed(
  p_organization_id UUID,
  p_membership_id UUID,
  p_student_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    EXISTS (
      SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id) AS identity
      WHERE identity.system_role = 'admin'
    )
    AND platform_private.staff_has_permission(p_organization_id, p_membership_id, 'membership.provision')
  ) OR (
    EXISTS (
      SELECT 1 FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = p_organization_id
        AND student_case.id = p_student_case_id
        AND student_case.current_curator_membership_id = p_membership_id
    )
    AND platform_private.staff_can_access(p_organization_id, p_membership_id, 'case.read.full', 'student_case', p_student_case_id)
  ), FALSE)
$$;

-- Вошедший сотрудник этой организации, которому правило разрешает сброс по этому делу; иначе 42501.
CREATE FUNCTION platform_private.require_student_password_reset_actor(p_organization_id UUID, p_student_case_id UUID)
RETURNS TABLE(actor_profile_id UUID, actor_membership_id UUID, actor_auth_user_id UUID, actor_access_version BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT identity.profile_id, identity.membership_id, identity.auth_user_id, identity.access_version
  FROM platform.current_actor_authority() AS actor
  JOIN platform_private.staff_membership_identity(actor.organization_id, actor.membership_id) AS identity ON TRUE
  WHERE actor.organization_id = p_organization_id
    AND identity.profile_id = actor.profile_id
    AND identity.auth_user_id = actor.auth_user_id
    AND platform_private.student_password_reset_allowed(p_organization_id, actor.membership_id, p_student_case_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;
END
$$;

-- Правка тел за один проход; у каждого фрагмента своё ожидаемое число совпадений, иначе миграция падает, ничего не меняя.
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

-- 1. Разрешение: вместо «только админ» — правило дела. Остальное тело (повтор запроса, отказы дела) прежнее.
SELECT pg_temp.a374_patch('platform.authorize_student_password_reset_v1(uuid,uuid,uuid)',
  ARRAY[$old1$  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  SELECT identity.access_version INTO actor_access_version
  FROM platform_private.staff_membership_identity(p_organization_id, actor.actor_membership_id) AS identity
  WHERE identity.system_role = 'admin' AND identity.profile_id = actor.actor_profile_id
    AND identity.auth_user_id = actor.actor_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;
$old1$],
  ARRAY[$new1$  -- 374: System Admin с membership.provision (344) или назначенный куратор этого дела (как 363).
  SELECT * INTO actor FROM platform_private.require_student_password_reset_actor(p_organization_id, p_student_case_id);
  actor_access_version := actor.actor_access_version;
$new1$],
  ARRAY[1]);

-- 2. Завершение под блокировками: тот же сотрудник с той же версией доступа и всё ещё админ или куратор дела.
SELECT pg_temp.a374_patch('platform.complete_student_password_reset_v1(uuid)',
  ARRAY[$old1$    WHERE identity.system_role = 'admin' AND identity.auth_user_id = row.requested_by_auth_user_id
      AND identity.profile_id = row.requested_by_profile_id AND identity.access_version = row.requested_by_access_version
  )
    OR platform_private.staff_has_permission(row.organization_id, row.requested_by_membership_id, 'membership.provision') IS NOT TRUE
  THEN$old1$,
    $old2$'Пароль студента сброшен администратором'$old2$],
  ARRAY[$new1$    WHERE identity.auth_user_id = row.requested_by_auth_user_id
      AND identity.profile_id = row.requested_by_profile_id AND identity.access_version = row.requested_by_access_version
  )
    OR platform_private.student_password_reset_allowed(
      row.organization_id, row.requested_by_membership_id, row.student_case_id
    ) IS NOT TRUE
  THEN$new1$,
    $new2$'Пароль студента сброшен сотрудником'$new2$],
  ARRAY[1, 1]);

REVOKE ALL ON FUNCTION
  platform_private.student_password_reset_allowed(UUID, UUID, UUID),
  platform_private.require_student_password_reset_actor(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.authorize_student_password_reset_v1(UUID, UUID, UUID)
  IS 'System Admin or the assigned curator of the case: permission for one password reset of the student bound to the case.';
COMMENT ON FUNCTION platform.complete_student_password_reset_v1(UUID)
  IS 'Server only, within 10 minutes: the same System Admin or assigned curator with the same access version; one journal entry.';
COMMENT ON FUNCTION platform_private.student_password_reset_allowed(UUID, UUID, UUID)
  IS 'Private 374 rule: a System Admin with membership.provision, or the assigned curator with full access to this case.';

NOTIFY pgrst, 'reload schema';

COMMIT;
