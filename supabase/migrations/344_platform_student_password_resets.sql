-- ============================================================
-- 344_platform_student_password_resets.sql
--
-- Сброс пароля студента администратором (подзадача 6 плана кабинетов, 07.11.2026; владелец 03.11: «админ пароль не
-- видит, но может сбросить»). Хуки набора в `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Как устроено (тот же порядок, что у кабинета 342/343: разрешение в базе, потом Auth, потом запись):
--   1. authorize_student_password_reset_v1 — System Admin с правом membership.provision получает разрешение на один
--      сброс для дела своей организации, к которому привязан студент (активное членство «student», активный профиль).
--      Пользователь Auth берётся из привязки дела, не из формы: сотрудника этим путём не сбросить. Повтор того же запроса
--      тем же админом — та же строка; разрешение, которое завершение всё равно отклонит, повтор закрывает до Auth.
--      Занятый в журнале request_id отклоняется сразу.
--   2. Сервер ставит пользователю Auth новый временный пароль и пометку «сначала свой пароль» (342); пароль нигде не
--      хранится и показывается админу один раз.
--   3. complete_student_password_reset_v1 — только сервер, в течение 10 минут, админ всё ещё админ с той же версией
--      доступа, дело привязано к тому же студенту: одна запись журнала student.password.reset. Не вышло со стороны Auth —
--      fail_student_password_reset_v1.
--   4. staff_student_case_cabinet_v1 (343) теперь отдаёт и логин студента (340) или его почту, если логина нет и почта не
--      служебная: админ видит, чем студент входит.
-- Новых прав нет; таблица закрыта от всех ролей. Forward-only: повтор отказывает a344_already_applied.
-- ============================================================

BEGIN;

DO $a344_guard$
BEGIN
  IF to_regclass('platform_private.student_password_resets') IS NOT NULL THEN
    RAISE EXCEPTION 'a344_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a344_guard$;

CREATE TABLE platform_private.student_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id),
  request_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  auth_user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_by_membership_id UUID NOT NULL,
  requested_by_profile_id UUID NOT NULL,
  requested_by_auth_user_id UUID NOT NULL,
  requested_by_access_version BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT student_password_resets_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT student_password_resets_case_fk FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases (organization_id, id),
  CONSTRAINT student_password_resets_finish_shape CHECK ((state = 'authorized') = (finished_at IS NULL))
);

ALTER TABLE platform_private.student_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_password_resets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_password_resets FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Студент, привязанный к делу: пользователь Auth живого членства «student» с живым профилем; иначе NULL.
CREATE FUNCTION platform_private.student_case_bound_auth_user(p_organization_id UUID, p_student_case_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT profile.auth_user_id
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = student_case.organization_id AND membership.id = student_case.student_membership_id
  JOIN platform.profiles AS profile ON profile.id = membership.profile_id
  WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id
    AND membership.status = 'active' AND membership."current_role" = 'student' AND profile.status = 'active'
$$;

-- 1. Разрешение администратора на один сброс.
CREATE FUNCTION platform.authorize_student_password_reset_v1(
  p_organization_id UUID,
  p_request_id UUID,
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  actor_access_version BIGINT;
  student_auth_user_id UUID;
  row platform_private.student_password_resets%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_password_reset_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  SELECT identity.access_version INTO actor_access_version
  FROM platform_private.staff_membership_identity(p_organization_id, actor.actor_membership_id) AS identity
  WHERE identity.system_role = 'admin' AND identity.profile_id = actor.actor_profile_id
    AND identity.auth_user_id = actor.actor_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO row FROM platform_private.student_password_resets AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF row.requested_by_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR row.student_case_id IS DISTINCT FROM p_student_case_id THEN
      RAISE EXCEPTION 'student_password_reset_request_conflict' USING ERRCODE = '23505';
    END IF;
    -- Ревью 07.11: сервер меняет пароль сразу после «authorized». Разрешение, которое завершение всё равно отклонит
    -- (прошло 10 минут, у админа другая версия доступа, дело привязано не к этому студенту), закрывается здесь, до Auth.
    IF row.state = 'authorized' AND (
      row.created_at < statement_timestamp() - INTERVAL '10 minutes'
      OR row.requested_by_access_version IS DISTINCT FROM actor_access_version
      OR platform_private.student_case_bound_auth_user(p_organization_id, row.student_case_id) IS DISTINCT FROM row.auth_user_id
    ) THEN
      UPDATE platform_private.student_password_resets AS target
      SET state = 'failed', finished_at = statement_timestamp()
      WHERE target.id = row.id
      RETURNING * INTO row;
    END IF;
    RETURN jsonb_build_object('reset_id', row.id, 'state', row.state, 'auth_user_id', row.auth_user_id);
  END IF;
  -- Журнал пишет запись с этим же request_id, а он уникален во всём журнале: занятый номер отклоняется до Auth.
  IF EXISTS (SELECT 1 FROM platform.audit_events AS event WHERE event.request_id = p_request_id) THEN
    RAISE EXCEPTION 'student_password_reset_request_conflict' USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id
  ) THEN
    RAISE EXCEPTION 'student_password_reset_invalid' USING ERRCODE = '22023';
  END IF;
  student_auth_user_id := platform_private.student_case_bound_auth_user(p_organization_id, p_student_case_id);
  IF student_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'student_case_no_cabinet' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO platform_private.student_password_resets (
    organization_id, request_id, student_case_id, auth_user_id, requested_by_membership_id, requested_by_profile_id,
    requested_by_auth_user_id, requested_by_access_version
  ) VALUES (
    p_organization_id, p_request_id, p_student_case_id, student_auth_user_id, actor.actor_membership_id,
    actor.actor_profile_id, actor.actor_auth_user_id, actor_access_version
  )
  RETURNING * INTO row;
  RETURN jsonb_build_object('reset_id', row.id, 'state', row.state, 'auth_user_id', row.auth_user_id);
END
$$;

-- 2. Сервер поставил новый временный пароль: журнал. Только сервер, в течение 10 минут после разрешения.
CREATE FUNCTION platform.complete_student_password_reset_v1(p_reset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row platform_private.student_password_resets%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO row FROM platform_private.student_password_resets AS candidate WHERE candidate.id = p_reset_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_password_reset_invalid' USING ERRCODE = '22023';
  END IF;
  -- Как 343 после ревью: организация и админ блокируются раньше проверки прав.
  PERFORM 1 FROM platform.organizations WHERE id = row.organization_id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(row.organization_id, ARRAY[row.requested_by_membership_id]);
  SELECT * INTO row FROM platform_private.student_password_resets AS candidate WHERE candidate.id = p_reset_id FOR UPDATE;
  IF row.state = 'completed' THEN
    RETURN jsonb_build_object('reset_id', row.id, 'state', row.state);
  END IF;
  IF row.state <> 'authorized' OR row.created_at < statement_timestamp() - INTERVAL '10 minutes' THEN
    RAISE EXCEPTION 'student_password_reset_expired' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(row.organization_id, row.requested_by_membership_id) AS identity
    WHERE identity.system_role = 'admin' AND identity.auth_user_id = row.requested_by_auth_user_id
      AND identity.profile_id = row.requested_by_profile_id AND identity.access_version = row.requested_by_access_version
  )
    OR platform_private.staff_has_permission(row.organization_id, row.requested_by_membership_id, 'membership.provision') IS NOT TRUE
  THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;
  IF platform_private.student_case_bound_auth_user(row.organization_id, row.student_case_id) IS DISTINCT FROM row.auth_user_id THEN
    RAISE EXCEPTION 'student_case_no_cabinet' USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform_private.student_password_resets AS target
  SET state = 'completed', finished_at = statement_timestamp()
  WHERE target.id = row.id;
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    after_state, reason, request_id
  ) VALUES (
    row.organization_id, 'user', row.requested_by_profile_id, 'auth:' || row.requested_by_auth_user_id::TEXT,
    'student.password.reset', 'student_case', row.student_case_id,
    jsonb_build_object('auth_user_id', row.auth_user_id),
    'Пароль студента сброшен администратором', row.request_id
  );
  RETURN jsonb_build_object('reset_id', row.id, 'state', 'completed');
END
$$;

-- 3. Auth не принял новый пароль: разрешение закрыто.
CREATE FUNCTION platform.fail_student_password_reset_v1(p_reset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_password_reset_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE platform_private.student_password_resets
  SET state = 'failed', finished_at = statement_timestamp()
  WHERE id = p_reset_id AND state = 'authorized';
END
$$;

-- 4. Карточка: к состоянию кабинета (343) — чем студент входит (логин или несслужебная почта).
CREATE OR REPLACE FUNCTION platform.staff_student_case_cabinet_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
  student_auth_user_id UUID;
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  student_auth_user_id := platform_private.student_case_bound_auth_user(p_organization_id, p_student_case_id);
  RETURN jsonb_build_object(
    'state', CASE
      WHEN target_case.student_membership_id IS NULL THEN 'none'
      WHEN target_case.portal_activated_at IS NULL THEN 'bound'
      ELSE 'open'
    END,
    'refusal', platform_private.student_case_account_refusal(target_case),
    'login', (SELECT student_login.login FROM platform_private.student_logins AS student_login
      WHERE student_login.auth_user_id = student_auth_user_id),
    'email', (SELECT auth_user.email FROM auth.users AS auth_user
      WHERE auth_user.id = student_auth_user_id AND auth_user.email NOT LIKE '%@students.evoadmissions.invalid')
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.student_case_bound_auth_user(UUID, UUID),
  platform.authorize_student_password_reset_v1(UUID, UUID, UUID),
  platform.complete_student_password_reset_v1(UUID),
  platform.fail_student_password_reset_v1(UUID),
  platform.staff_student_case_cabinet_v1(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.authorize_student_password_reset_v1(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_cabinet_v1(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.complete_student_password_reset_v1(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION platform.fail_student_password_reset_v1(UUID) TO service_role;

-- «Журнал действий»: student.password.reset в allowlist (rename-and-union, как 341/342).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_password_resets;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_password_resets()
      || ARRAY[
    'student.password.reset'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_password_resets(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.authorize_student_password_reset_v1(UUID, UUID, UUID)
  IS 'System Admin only: permission for one password reset of the Student bound to a case of the organization.';
COMMENT ON FUNCTION platform.complete_student_password_reset_v1(UUID)
  IS 'Service only, within 10 minutes: writes student.password.reset once the new temporary password is set.';
COMMENT ON FUNCTION platform.fail_student_password_reset_v1(UUID)
  IS 'Service only: closes a reset permission whose new password Auth did not take.';

NOTIFY pgrst, 'reload schema';

COMMIT;
