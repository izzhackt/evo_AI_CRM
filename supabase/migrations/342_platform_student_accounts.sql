-- ============================================================
-- 342_platform_student_accounts.sql
--
-- Кабинеты студентов создаёт администратор (решение 07.11.2026: пользователь — «сделай еще так что бы я мог просто
-- акк создать как админ даже если никакой инфы не будет»; владелец и пользователь — нынешним студентам кабинеты с
-- временным паролем, «пароли мы нигде сохранять не будем»). Хуки набора в `scripts/test-runners/test-postgres-
-- authorization.sh` привязаны к имени файла.
--
-- Как устроено (тот же порядок, что у приглашения в кабинет 185: разрешение в базе, потом Auth, потом запись):
--   1. authorize_student_account_v1 — администратор (current_actor_authority, platform_role admin) получает разрешение
--      на один аккаунт: строка provisioning со своим request_id; повтор того же запроса тем же админом — та же строка.
--   2. Сервер создаёт пользователя Auth с временным паролем (пароль нигде не хранится и показывается один раз).
--   3. complete_student_account_v1 (только сервер, в течение часа после разрешения) — логин имя.фамилия (340) и одна
--      запись журнала student.account.create от имени админа. Если Auth не удался, fail_student_account_v1 закрывает
--      разрешение.
-- Кабинет с нуля не привязан к делу: студент входит, меняет пароль и сам заполняет анкету, дальше всё как раньше.
-- Привязка к существующему делу — следующий шаг (столбец student_case_id уже есть, сейчас всегда NULL).
-- Новых прав нет; таблица закрыта от всех ролей. Forward-only: повтор отказывает a342_already_applied.
-- ============================================================

BEGIN;

DO $a342_guard$
BEGIN
  IF to_regclass('platform_private.student_account_provisioning') IS NOT NULL THEN
    RAISE EXCEPTION 'a342_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a342_guard$;

CREATE TABLE platform_private.student_account_provisioning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id),
  request_id UUID NOT NULL,
  requested_by_membership_id UUID NOT NULL,
  requested_by_profile_id UUID NOT NULL,
  requested_by_auth_user_id UUID NOT NULL,
  student_case_id UUID,
  state TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized', 'completed', 'failed')),
  auth_user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  login TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT student_account_provisioning_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT student_account_provisioning_case_shape CHECK (student_case_id IS NULL),
  CONSTRAINT student_account_provisioning_finish_shape CHECK ((state = 'authorized') = (finished_at IS NULL)),
  CONSTRAINT student_account_provisioning_completed_shape CHECK (state <> 'completed' OR login IS NOT NULL)
);

ALTER TABLE platform_private.student_account_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_account_provisioning FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_account_provisioning FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- 1. Разрешение администратора на один аккаунт.
CREATE FUNCTION platform.authorize_student_account_v1(p_organization_id UUID, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  row platform_private.student_account_provisioning%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT authority.organization_id, authority.membership_id, authority.profile_id, authority.auth_user_id INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.organization_id = p_organization_id AND authority.membership_id IS NOT NULL
    AND authority.platform_role = 'admin'::platform.business_role;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO row FROM platform_private.student_account_provisioning AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF row.requested_by_membership_id IS DISTINCT FROM actor.membership_id THEN
      RAISE EXCEPTION 'student_account_request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('provisioning_id', row.id, 'state', row.state, 'login', row.login);
  END IF;

  INSERT INTO platform_private.student_account_provisioning (
    organization_id, request_id, requested_by_membership_id, requested_by_profile_id, requested_by_auth_user_id
  ) VALUES (
    p_organization_id, p_request_id, actor.membership_id, actor.profile_id, actor.auth_user_id
  )
  RETURNING * INTO row;
  RETURN jsonb_build_object('provisioning_id', row.id, 'state', row.state, 'login', NULL);
END
$$;

-- 2. Сервер создал пользователя Auth: логин и журнал. Только сервер, в течение часа после разрешения.
CREATE FUNCTION platform.complete_student_account_v1(p_provisioning_id UUID, p_auth_user_id UUID, p_login_base TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row platform_private.student_account_provisioning%ROWTYPE;
  student_login TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provisioning_id IS NULL OR p_auth_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_auth_user_id) THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO row FROM platform_private.student_account_provisioning AS candidate
  WHERE candidate.id = p_provisioning_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  IF row.state = 'completed' AND row.auth_user_id = p_auth_user_id THEN
    RETURN jsonb_build_object('provisioning_id', row.id, 'login', row.login);
  END IF;
  IF row.state <> 'authorized' OR row.created_at < statement_timestamp() - INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'student_account_expired' USING ERRCODE = '55000';
  END IF;

  student_login := platform.claim_student_login_v1(p_auth_user_id, p_login_base);

  UPDATE platform_private.student_account_provisioning
  SET state = 'completed', auth_user_id = p_auth_user_id, login = student_login, finished_at = statement_timestamp()
  WHERE id = row.id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    after_state, reason, request_id
  ) VALUES (
    row.organization_id, 'user', row.requested_by_profile_id, 'auth:' || row.requested_by_auth_user_id::TEXT,
    'student.account.create', 'organization', row.organization_id,
    jsonb_build_object('auth_user_id', p_auth_user_id),
    'Кабинет студента создан администратором', row.request_id
  );

  RETURN jsonb_build_object('provisioning_id', row.id, 'login', student_login);
END
$$;

-- 3. Сервер не смог создать пользователя Auth: разрешение закрыто.
CREATE FUNCTION platform.fail_student_account_v1(p_provisioning_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE platform_private.student_account_provisioning
  SET state = 'failed', finished_at = statement_timestamp()
  WHERE id = p_provisioning_id AND state = 'authorized';
END
$$;

REVOKE ALL ON FUNCTION
  platform.authorize_student_account_v1(UUID, UUID),
  platform.complete_student_account_v1(UUID, UUID, TEXT),
  platform.fail_student_account_v1(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.authorize_student_account_v1(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.complete_student_account_v1(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.fail_student_account_v1(UUID) TO service_role;

-- «Журнал действий»: student.account.create в allowlist (rename-and-union, как 341).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_accounts;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_accounts()
      || ARRAY[
    'student.account.create'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_accounts(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.authorize_student_account_v1(UUID, UUID)
  IS 'Admin only: permission for one student account; the same request by the same admin returns the same row.';
COMMENT ON FUNCTION platform.complete_student_account_v1(UUID, UUID, TEXT)
  IS 'Service only, within an hour of the permission: claims the name.surname login and writes student.account.create.';
COMMENT ON FUNCTION platform.fail_student_account_v1(UUID)
  IS 'Service only: closes a permission whose Auth account could not be created.';

NOTIFY pgrst, 'reload schema';

COMMIT;
