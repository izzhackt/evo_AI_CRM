-- PORT-5a «Профиль портала: язык и запрос удаления аккаунта»
-- (план docs/EVO_PORTAL_WEB_IPHONE_PLAN_2026-09-19.md §6 «Профиль», §8.5,
-- §13 Apple Account deletion §5.1.1(v); решение PORT-0 «Локализация»:
-- язык — персистентное поле профиля в БД, cookie — request-time умолчание;
-- запись PLAN_CHANGES 2026-09-19 «PORT-5a»).
--
-- Модель. platform.student_profiles 1:1 с делом (UNIQUE(organization_id,
-- student_case_id), 053) и оба intake-пути создают/дозаполняют строку
-- (публичная анкета 180:296, приглашение 193:352-373). Legacy cabinet-кейс
-- может не иметь строки (193 обрабатывает profile-less case явно), поэтому:
-- чтение отдаёт честный default 'ru' без строки, запись создаёт минимальную
-- строку без выдуманных фактов — паттерн D2a (159: профиль может
-- существовать без фактов; consent_status='not_recorded', анкетные поля
-- NULL). Обновление языка идёт через штатный revision-guard 053
-- (revision+1, updated_by, updated_at) — язык — часть канонического
-- профиля, staff-редакторы получают честный optimistic-conflict, не тихую
-- перезапись.
--
-- Guard студенческих RPC — ровно guard каталога 148/195 (platform_role=
-- 'student' + portal.read.self), case-НЕзависимый; собственное дело
-- резолвится как в student_portal_cases: state IN ('pending','active',
-- 'closed') AND portal_activated_at IS NOT NULL, первая по created_at.
--
-- Удаление аккаунта (§13): реальный серверный запрос со статусом, не кнопка
-- «напишите нам». Идемпотентно по request_id И не более одного ОТКРЫТОГО
-- запроса на участника (частичный уникальный индекс): повтор с новым
-- request_id возвращает исходный открытый запрос. Обработка запроса —
-- существующий staff-процесс; никакие записи здесь не удаляются.
BEGIN;

ALTER TABLE platform.student_profiles
  ADD COLUMN portal_language TEXT NOT NULL DEFAULT 'ru'
    CHECK (portal_language IN ('ru', 'ky'));

CREATE TABLE platform_private.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'acknowledged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_membership_id UUID,
  CHECK (
    (status = 'requested'
      AND acknowledged_at IS NULL AND acknowledged_by_membership_id IS NULL)
    OR (status = 'acknowledged'
      AND acknowledged_at IS NOT NULL AND acknowledged_by_membership_id IS NOT NULL)
  ),
  UNIQUE (organization_id, membership_id, request_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, acknowledged_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

-- «Один открытый запрос на участника» — инвариант в самой БД, не в коде.
CREATE UNIQUE INDEX account_deletion_requests_one_open_idx
  ON platform_private.account_deletion_requests (organization_id, membership_id)
  WHERE status = 'requested';

ALTER TABLE platform_private.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.account_deletion_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.account_deletion_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Собственный портальный профиль: имя/email read-only, язык, состояние дела
-- и отметка открытого запроса удаления (чтобы экран честно показывал
-- «запрос отправлен» после перезагрузки и на втором устройстве).
CREATE FUNCTION platform.get_own_portal_profile_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a RECORD; own_case_id UUID; own_case_state platform.student_case_state;
  language TEXT; user_email TEXT; deletion_requested_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT sc.id, sc.state INTO own_case_id, own_case_state
  FROM platform.student_cases sc
  WHERE sc.organization_id = a.organization_id
    AND sc.student_membership_id = a.membership_id
    AND sc.portal_activated_at IS NOT NULL
    AND sc.state IN ('pending', 'active', 'closed')
  ORDER BY sc.created_at, sc.id LIMIT 1;
  IF own_case_id IS NOT NULL THEN
    SELECT sp.portal_language INTO language
    FROM platform.student_profiles sp
    WHERE sp.organization_id = a.organization_id AND sp.student_case_id = own_case_id;
  END IF;
  SELECT u.email INTO user_email FROM auth.users u WHERE u.id = a.auth_user_id;
  SELECT r.created_at INTO deletion_requested_at
  FROM platform_private.account_deletion_requests r
  WHERE r.organization_id = a.organization_id
    AND r.membership_id = a.membership_id AND r.status = 'requested'
  ORDER BY r.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'displayName', a.display_name,
    'email', user_email,
    'portalLanguage', COALESCE(language, 'ru'),
    'caseState', own_case_state,
    'deletionRequestedAt', deletion_requested_at
  );
END $$;

-- Язык портала: student-only запись собственного профиля. Без строки
-- профиля (legacy cabinet-кейс) создаётся минимальная строка без выдуманных
-- фактов (D2a/159); иначе — штатное revision-обновление 053.
CREATE FUNCTION platform.set_own_portal_language_v1(p_language TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; own_case_id UUID; profile platform.student_profiles%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_language IS NULL OR p_language NOT IN ('ru', 'ky') THEN
    RAISE EXCEPTION 'Invalid portal language' USING ERRCODE = '22023';
  END IF;
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
    'evo:portal-language:' || a.organization_id::TEXT || ':' || own_case_id::TEXT, 0));
  SELECT * INTO profile FROM platform.student_profiles sp
  WHERE sp.organization_id = a.organization_id AND sp.student_case_id = own_case_id
  FOR UPDATE;
  IF FOUND THEN
    UPDATE platform.student_profiles SET
      portal_language = p_language,
      revision = profile.revision + 1,
      updated_by_membership_id = a.membership_id,
      updated_at = clock_timestamp()
    WHERE id = profile.id;
  ELSE
    INSERT INTO platform.student_profiles (
      organization_id, student_case_id, revision, decision_participant_labels,
      consent_status, portal_language, created_by_membership_id, updated_by_membership_id
    ) VALUES (
      a.organization_id, own_case_id, 1, ARRAY[]::TEXT[],
      'not_recorded', p_language, a.membership_id, a.membership_id
    );
  END IF;
  RETURN jsonb_build_object('portalLanguage', p_language);
END $$;

-- Инициирование удаления аккаунта (§13): идемпотентно по request_id, один
-- открытый запрос на участника; повтор с новым request_id возвращает
-- исходный открытый запрос. Никаких удалений данных здесь не происходит.
CREATE FUNCTION platform.request_account_deletion_v1(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD; existing platform_private.account_deletion_requests%ROWTYPE;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority() WHERE platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(a.organization_id, 'portal.read.self') THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid deletion request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:account-deletion:' || a.organization_id::TEXT || ':' || a.membership_id::TEXT, 0));
  -- Точный повтор той же команды.
  SELECT * INTO existing FROM platform_private.account_deletion_requests r
  WHERE r.organization_id = a.organization_id
    AND r.membership_id = a.membership_id AND r.request_id = p_request_id;
  IF NOT FOUND THEN
    -- Уже есть открытый запрос — возвращаем его, второй ряд не создаётся.
    SELECT * INTO existing FROM platform_private.account_deletion_requests r
    WHERE r.organization_id = a.organization_id
      AND r.membership_id = a.membership_id AND r.status = 'requested'
    ORDER BY r.created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO platform_private.account_deletion_requests (
      organization_id, membership_id, request_id
    ) VALUES (a.organization_id, a.membership_id, p_request_id)
    RETURNING * INTO existing;
  END IF;
  RETURN jsonb_build_object(
    'requestId', existing.request_id,
    'status', existing.status,
    'requestedAt', existing.created_at
  );
END $$;

-- Staff-чтение запросов удаления: только admin своей организации (план §6:
-- «Удаление аккаунта» — процесс команды; sales/curator доступа не имеют).
CREATE FUNCTION platform.staff_account_deletion_requests_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM platform.current_actor_authority();
  IF a.membership_id IS NULL OR a.platform_role <> 'admin'
    OR NOT private.platform_has_permission(a.organization_id, 'organization.read') THEN
    RAISE EXCEPTION 'Deletion requests unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'requestId', r.request_id,
      'membershipId', r.membership_id,
      'displayName', p.display_name,
      'status', r.status,
      'requestedAt', r.created_at,
      'studentCaseId', (
        SELECT sc.id FROM platform.student_cases sc
        WHERE sc.organization_id = r.organization_id
          AND sc.student_membership_id = r.membership_id
        ORDER BY sc.created_at, sc.id LIMIT 1
      )
    ) ORDER BY r.created_at DESC, r.request_id)
    FROM platform_private.account_deletion_requests r
    JOIN platform.organization_memberships m
      ON m.organization_id = r.organization_id AND m.id = r.membership_id
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE r.organization_id = a.organization_id
  ), '[]'::JSONB);
END $$;

REVOKE ALL ON FUNCTION
  platform.get_own_portal_profile_v1(),
  platform.set_own_portal_language_v1(TEXT),
  platform.request_account_deletion_v1(UUID),
  platform.staff_account_deletion_requests_v1()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.get_own_portal_profile_v1(),
  platform.set_own_portal_language_v1(TEXT),
  platform.request_account_deletion_v1(UUID),
  platform.staff_account_deletion_requests_v1()
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
