-- ============================================================
-- 340_platform_student_logins.sql
--
-- Вход студента по логину (решение 07.11.2026: пользователь и владелец в Telegram — «регистрация пусть остаётся»,
-- «только они не будут никнейм выбирать»; логины вида имя.фамилия). Supabase Auth знает только почту, поэтому логин —
-- отдельная закрытая запись: логин → пользователь Auth. Логин студент не выбирает: его строит приложение из имени и
-- фамилии латиницей, а база выдаёт первый свободный вариант (aidai.chynarova, aidai.chynarova2, ...).
--
-- Почта по логину находится только на сервере (service_role) при входе и наружу не отдаётся. Студент видит только
-- свой логин. Таблица закрыта от всех ролей, писать в неё может только эта миграция через функции ниже.
-- ============================================================

BEGIN;

DO $a340_guard$
BEGIN
  IF to_regclass('platform_private.student_logins') IS NOT NULL THEN
    RAISE EXCEPTION 'a340_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a340_guard$;

CREATE TABLE platform_private.student_logins (
  login TEXT PRIMARY KEY,
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  -- Латиница и цифры, части через точку; «admin» занят входом администратора.
  CONSTRAINT student_logins_login_shape CHECK (
    char_length(login) BETWEEN 3 AND 64
    AND login ~ '^[a-z][a-z0-9]*([.][a-z0-9]+)+$'
  )
);

ALTER TABLE platform_private.student_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_logins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_logins FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Выдать логин пользователю: первый свободный из base, base2, base3, ... Если логин уже есть — вернуть его.
CREATE FUNCTION platform.claim_student_login_v1(p_auth_user_id UUID, p_base TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base TEXT := lower(btrim(p_base));
  existing TEXT;
  candidate TEXT;
  attempt INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_login_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_auth_user_id IS NULL OR base IS NULL OR char_length(base) NOT BETWEEN 3 AND 60
    OR base !~ '^[a-z][a-z0-9]*([.][a-z0-9]+)+$'
  THEN
    RAISE EXCEPTION 'student_login_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_auth_user_id) THEN
    RAISE EXCEPTION 'student_login_user_unknown' USING ERRCODE = '22023';
  END IF;

  SELECT student_login.login INTO existing
  FROM platform_private.student_logins AS student_login
  WHERE student_login.auth_user_id = p_auth_user_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  FOR attempt IN 1..999 LOOP
    candidate := base || CASE WHEN attempt = 1 THEN '' ELSE attempt::TEXT END;
    INSERT INTO platform_private.student_logins (login, auth_user_id)
    VALUES (candidate, p_auth_user_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      RETURN candidate;
    END IF;
    -- Параллельная выдача тому же пользователю: вернуть то, что успело записаться.
    SELECT student_login.login INTO existing
    FROM platform_private.student_logins AS student_login
    WHERE student_login.auth_user_id = p_auth_user_id;
    IF existing IS NOT NULL THEN
      RETURN existing;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'student_login_exhausted' USING ERRCODE = '55000';
END
$$;

-- Почта для входа по логину. Только сервер; удалённые и заблокированные пользователи не находятся.
CREATE FUNCTION platform.student_login_email_v1(p_login TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  found_email TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_login_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(auth_user.email)) INTO found_email
  FROM platform_private.student_logins AS student_login
  JOIN auth.users AS auth_user ON auth_user.id = student_login.auth_user_id
  WHERE student_login.login = lower(btrim(p_login))
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= statement_timestamp());
  RETURN found_email;
END
$$;

-- Свой логин — студенту в профиле.
CREATE FUNCTION platform.own_student_login_v1()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT student_login.login
  FROM platform_private.student_logins AS student_login
  WHERE student_login.auth_user_id = (SELECT auth.uid())
$$;

REVOKE ALL ON FUNCTION
  platform.claim_student_login_v1(UUID, TEXT),
  platform.student_login_email_v1(TEXT),
  platform.own_student_login_v1()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.claim_student_login_v1(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.student_login_email_v1(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.own_student_login_v1() TO authenticated;

COMMENT ON FUNCTION platform.claim_student_login_v1(UUID, TEXT)
  IS 'Service only: gives the auth user the first free login of base, base2, base3, ... or returns the login it already has.';
COMMENT ON FUNCTION platform.student_login_email_v1(TEXT)
  IS 'Service only: the sign-in email behind a student login; never exposed to the browser.';
COMMENT ON FUNCTION platform.own_student_login_v1()
  IS 'The signed-in user''s own student login, or NULL.';

NOTIFY pgrst, 'reload schema';

COMMIT;
