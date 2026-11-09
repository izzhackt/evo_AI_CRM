-- 356: студент сам меняет имя и фамилию в «Профиле» кабинета (09.11.2026).
--
-- Пользователь 09.11.2026: кабинеты нынешним студентам открыты из CRM, у части дел в CRM только имя («Умар»),
-- логин им выдан вида имя.student. «давай добавим функцию изменения имени и фамилии», затем выбор: «Только имя,
-- логин не трогать».
--
-- Одна команда для вошедшего студента, тот же guard, что у языка кабинета (196): platform_role = 'student' и
-- portal.read.self, собственное дело — первое по created_at среди pending / active / closed с открытым кабинетом.
-- Имя и фамилия вместе становятся
--   a) именем профиля (platform.profiles.display_name): его показывает кабинет;
--   b) именем дела (platform.student_cases.student_display_name): его видят сотрудники в CRM.
-- Логин (platform_private.student_logins) не меняется. В журнал (audit_events) пишется факт смены без самих имён:
-- старое и новое имя — личные данные, журнал их не хранит. Повтор того же запроса (p_request_id) безопасен:
-- то же имя второй раз ничего не меняет и второе событие не пишет.
BEGIN;

CREATE FUNCTION platform.set_own_portal_name_v1(p_first_name TEXT, p_last_name TEXT, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a RECORD;
  own_case_id UUID;
  first_name TEXT := regexp_replace(btrim(COALESCE(p_first_name, '')), '\s+', ' ', 'g');
  last_name TEXT := regexp_replace(btrim(COALESCE(p_last_name, '')), '\s+', ' ', 'g');
  new_name TEXT;
  old_name TEXT;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '42501';
  END IF;
  -- Имя и фамилия: по 1–60 знаков, хотя бы одна буква, без управляющих символов.
  IF p_request_id IS NULL
    OR char_length(first_name) NOT BETWEEN 1 AND 60 OR char_length(last_name) NOT BETWEEN 1 AND 60
    OR first_name !~ '[[:alpha:]]' OR last_name !~ '[[:alpha:]]'
    OR first_name ~ '[[:cntrl:]]' OR last_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Invalid student name' USING ERRCODE = '22023';
  END IF;
  new_name := first_name || ' ' || last_name;

  SELECT sc.id INTO own_case_id
  FROM platform.student_cases sc
  WHERE sc.organization_id = a.organization_id
    AND sc.student_membership_id = a.membership_id
    AND sc.portal_activated_at IS NOT NULL
    AND sc.state IN ('pending', 'active', 'closed')
  ORDER BY sc.created_at, sc.id LIMIT 1;
  IF own_case_id IS NULL THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:portal-name:' || a.organization_id::TEXT || ':' || own_case_id::TEXT, 0));

  SELECT p.display_name INTO old_name FROM platform.profiles p WHERE p.id = a.profile_id FOR UPDATE;
  IF old_name IS DISTINCT FROM new_name THEN
    UPDATE platform.profiles SET display_name = new_name, updated_at = clock_timestamp() WHERE id = a.profile_id;
  END IF;
  UPDATE platform.student_cases SET student_display_name = new_name, updated_at = clock_timestamp()
  WHERE organization_id = a.organization_id AND id = own_case_id AND student_display_name IS DISTINCT FROM new_name;

  IF old_name IS DISTINCT FROM new_name AND NOT EXISTS (
    SELECT 1 FROM platform.audit_events e
    WHERE e.organization_id = a.organization_id AND e.request_id = p_request_id AND e.action = 'student.name.change'
  ) THEN
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_principal, actor_membership_id,
      action, resource_type, resource_id, after_state, reason, request_id
    ) VALUES (
      a.organization_id, 'user', a.profile_id, 'auth:' || a.auth_user_id::TEXT, a.membership_id,
      'student.name.change', 'student_case', own_case_id, '{}'::JSONB,
      'Студент изменил имя и фамилию в кабинете', p_request_id
    );
  END IF;

  RETURN jsonb_build_object('displayName', new_name);
END
$$;

REVOKE ALL ON FUNCTION platform.set_own_portal_name_v1(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.set_own_portal_name_v1(TEXT, TEXT, UUID) TO authenticated;

ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_student_own_name;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_student_own_name()
      || ARRAY[
    'student.name.change'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_student_own_name(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.set_own_portal_name_v1(TEXT, TEXT, UUID)
  IS 'Student only: sets the own first and last name on the profile and the own case; the login is unchanged.';

NOTIFY pgrst, 'reload schema';

COMMIT;
