-- ============================================================
-- 343_platform_student_case_accounts.sql
--
-- Кабинет студенту, у которого уже есть дело (решение 07.11.2026: кабинеты нынешним студентам с временным паролем;
-- подзадача 4 плана кабинетов). Администратор создаёт аккаунт с временным паролем (342) и в той же операции привязывает
-- его к делу: после первого входа и своего пароля студент сразу видит своё дело в кабинете. Хуки набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла.
--
-- Как устроено (шаги привязки те же, что у приглашения в finalize_student_portal_authority, 126/185):
--   1. authorize_student_case_account_v1 — System Admin с правами membership.provision и scope.manage (как у
--      приглашения) получает разрешение на один аккаунт для дела своей организации: дело открыто (pending или active),
--      студента у него нет, приглашения по почте (126) нет, и это не предварительное дело без продавца (lead-cabinet:
--      CHECK 281 требует у него пустого студента). Повтор того же запроса тем же админом — та же строка.
--   2. Сервер создаёт пользователя Auth с временным паролем (342; пароль нигде не хранится).
--   3. complete_student_case_account_v1 — только сервер, в течение часа, админ всё ещё админ с той же версией доступа:
--      логин имя.фамилия (340), профиль и членство студента (provision_member_authorized_e1), доступ к организации и к
--      делу, привязка дела, кабинет открыт (portal_activated_at), журнал «student.account.create» и
--      «student.portal.authority.activate», как у 342 и приглашения. Не вышло — fail_student_case_account_v1, сервер
--      удаляет пользователя Auth.
--   4. staff_student_case_cabinet_v1 — карточке студента (только Admin): кабинет у дела и причина, по которой
--      кабинет здесь не открыть, чтобы форма не предлагала заведомый отказ.
-- Привязку дела охраняет триггер 215 (guard_student_case_identity_e1): он пускал только квитанцию приглашения 126.
-- Добавлена вторая ветка — строка этой таблицы, помеченная в той же транзакции (xid8, как квитанция продажи в 215).
-- Таблица 342 остаётся для кабинета без дела; её столбец student_case_id по-прежнему пуст.
-- Новых прав и действий журнала нет; таблица закрыта от всех ролей. Forward-only: повтор отказывает
-- a343_already_applied, чужое тело триггера — a343_replace_drift.
-- ============================================================

BEGIN;

DO $a343_guard$
BEGIN
  IF to_regclass('platform_private.student_case_account_provisioning') IS NOT NULL THEN
    RAISE EXCEPTION 'a343_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a343_guard$;

CREATE TABLE platform_private.student_case_account_provisioning (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations (id),
  request_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  requested_by_membership_id UUID NOT NULL,
  requested_by_profile_id UUID NOT NULL,
  requested_by_auth_user_id UUID NOT NULL,
  requested_by_access_version BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'authorized' CHECK (state IN ('authorized', 'completed', 'failed')),
  auth_user_id UUID REFERENCES auth.users (id) ON DELETE RESTRICT,
  student_profile_id UUID,
  student_membership_id UUID,
  bind_transaction_id xid8,
  login TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT student_case_account_provisioning_request_key UNIQUE (organization_id, request_id),
  CONSTRAINT student_case_account_provisioning_auth_user_key UNIQUE (auth_user_id),
  CONSTRAINT student_case_account_provisioning_membership_key UNIQUE (student_membership_id),
  CONSTRAINT student_case_account_provisioning_case_fk FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases (organization_id, id),
  CONSTRAINT student_case_account_provisioning_finish_shape CHECK ((state = 'authorized') = (finished_at IS NULL)),
  CONSTRAINT student_case_account_provisioning_completed_shape CHECK (state <> 'completed' OR (
    auth_user_id IS NOT NULL AND student_profile_id IS NOT NULL AND student_membership_id IS NOT NULL AND login IS NOT NULL
  ))
);

ALTER TABLE platform_private.student_case_account_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_case_account_provisioning FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_case_account_provisioning FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Можно ли привязать дело к этому аккаунту: те же отказы в разрешении и в завершении (дело заблокировано FOR UPDATE).
CREATE FUNCTION platform_private.student_case_account_refusal(p_case platform.student_cases)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_case.student_membership_id IS NOT NULL THEN 'student_case_has_cabinet'
    WHEN p_case.state NOT IN ('pending', 'active') OR p_case.closed_at IS NOT NULL THEN 'student_case_closed'
    WHEN EXISTS (
      SELECT 1 FROM platform_private.student_portal_provisioning_receipts AS receipt
      WHERE receipt.student_case_id = p_case.id
    ) THEN 'student_case_invite_exists'
    WHEN p_case.responsible_sales_membership_id IS NULL AND p_case.canonical_lead_id IS NOT NULL
      AND p_case.source_key = 'lead-cabinet:' || p_case.canonical_lead_id::TEXT
    THEN 'student_case_unsupported'
  END
$$;

-- 1. Разрешение администратора на один аккаунт для дела.
CREATE FUNCTION platform.authorize_student_case_account_v1(
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
  target_case platform.student_cases%ROWTYPE;
  refusal TEXT;
  row platform_private.student_case_account_provisioning%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  -- Как приглашение 185: членство и доступ к делу выдаёт только System Admin с этими правами.
  SELECT * INTO actor FROM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'scope.manage');
  SELECT identity.access_version INTO actor_access_version
  FROM platform_private.staff_membership_identity(p_organization_id, actor.actor_membership_id) AS identity
  WHERE identity.system_role = 'admin' AND identity.profile_id = actor.actor_profile_id
    AND identity.auth_user_id = actor.actor_auth_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO row FROM platform_private.student_case_account_provisioning AS candidate
  WHERE candidate.organization_id = p_organization_id AND candidate.request_id = p_request_id
  FOR UPDATE;
  IF FOUND THEN
    IF row.requested_by_membership_id IS DISTINCT FROM actor.actor_membership_id
      OR row.student_case_id IS DISTINCT FROM p_student_case_id THEN
      RAISE EXCEPTION 'student_account_request_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('provisioning_id', row.id, 'state', row.state, 'login', row.login);
  END IF;

  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  refusal := platform_private.student_case_account_refusal(target_case);
  IF refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', refusal USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO platform_private.student_case_account_provisioning (
    organization_id, request_id, student_case_id, requested_by_membership_id, requested_by_profile_id,
    requested_by_auth_user_id, requested_by_access_version
  ) VALUES (
    p_organization_id, p_request_id, p_student_case_id, actor.actor_membership_id, actor.actor_profile_id,
    actor.actor_auth_user_id, actor_access_version
  )
  RETURNING * INTO row;
  RETURN jsonb_build_object('provisioning_id', row.id, 'state', row.state, 'login', NULL);
END
$$;

-- 2. Сервер создал пользователя Auth: логин, студент, доступ, привязка дела, кабинет открыт. Одна транзакция.
CREATE FUNCTION platform.complete_student_case_account_v1(p_provisioning_id UUID, p_auth_user_id UUID, p_login_base TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  row platform_private.student_case_account_provisioning%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  case_scope platform.record_scopes%ROWTYPE;
  refusal TEXT;
  student_login TEXT;
  membership_result JSONB;
  new_profile_id UUID;
  new_membership_id UUID;
  occurred_at TIMESTAMPTZ := statement_timestamp();
  changed INTEGER;
  child_membership UUID;
  child_org_scope UUID;
  child_case_scope UUID;
  child_final_audit UUID;
  final_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provisioning_id IS NULL OR p_auth_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_auth_user_id) THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO row FROM platform_private.student_case_account_provisioning AS candidate
  WHERE candidate.id = p_provisioning_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_account_invalid' USING ERRCODE = '22023';
  END IF;
  -- Порядок блокировок как у finalize 185: домен, дерево запроса, организация, админ — и только потом дело
  -- (иначе встречная продажа create_sales_report_handoff, которая берёт организацию раньше дела, даёт взаимную блокировку).
  PERFORM platform_private.lock_student_case_note_assignment_domain(row.organization_id);
  PERFORM platform_private.lock_student_portal_request_tree(row.request_id);
  PERFORM 1 FROM platform.organizations WHERE id = row.organization_id FOR UPDATE;
  PERFORM platform_private.staff_lock_memberships(row.organization_id, ARRAY[row.requested_by_membership_id]);
  SELECT * INTO row FROM platform_private.student_case_account_provisioning AS candidate
  WHERE candidate.id = p_provisioning_id
  FOR UPDATE;
  IF row.state = 'completed' AND row.auth_user_id = p_auth_user_id THEN
    RETURN jsonb_build_object('provisioning_id', row.id, 'login', row.login, 'student_case_id', row.student_case_id);
  END IF;
  IF row.state <> 'authorized' OR row.created_at < statement_timestamp() - INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'student_account_expired' USING ERRCODE = '55000';
  END IF;
  -- Как finalize 157/185, уже под блокировками: админ всё ещё админ с теми же правами и той же версией доступа.
  IF NOT EXISTS (
    SELECT 1 FROM platform_private.staff_membership_identity(row.organization_id, row.requested_by_membership_id) AS identity
    WHERE identity.system_role = 'admin' AND identity.auth_user_id = row.requested_by_auth_user_id
      AND identity.profile_id = row.requested_by_profile_id AND identity.access_version = row.requested_by_access_version
  )
    OR platform_private.staff_has_permission(row.organization_id, row.requested_by_membership_id, 'membership.provision') IS NOT TRUE
    OR platform_private.staff_has_permission(row.organization_id, row.requested_by_membership_id, 'scope.manage') IS NOT TRUE
  THEN
    RAISE EXCEPTION 'student_account_forbidden' USING ERRCODE = '42501';
  END IF;

  child_membership := platform_private.student_portal_child_request_id(row.request_id, '01-membership-provision');
  child_org_scope := platform_private.student_portal_child_request_id(row.request_id, '02-organization-scope');
  child_case_scope := platform_private.student_portal_child_request_id(row.request_id, '03-student-case-scope');
  child_final_audit := platform_private.student_portal_child_request_id(row.request_id, '05-student-portal-audit');

  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = row.organization_id AND student_case.id = row.student_case_id
  FOR UPDATE;
  refusal := platform_private.student_case_account_refusal(target_case);
  IF refusal IS NOT NULL THEN
    RAISE EXCEPTION '%', refusal USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO case_scope FROM platform.record_scopes AS scope
  WHERE scope.organization_id = row.organization_id
    AND scope.id = target_case.current_scope_id
    AND scope.scope_version = target_case.current_scope_version
    AND scope.scope_kind = 'student_case'
    AND scope.scope_key = target_case.id
    AND scope.is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active student-case scope is unavailable' USING ERRCODE = '55000';
  END IF;

  student_login := platform.claim_student_login_v1(p_auth_user_id, p_login_base);
  BEGIN
    membership_result := platform_private.provision_member_authorized_e1(
      row.organization_id, p_auth_user_id, target_case.student_display_name, 'student',
      'Кабинет студента от администратора', child_membership,
      row.requested_by_profile_id, row.requested_by_auth_user_id
    );
  EXCEPTION
    WHEN invalid_parameter_value OR unique_violation THEN
      RAISE EXCEPTION 'student_account_identity_conflict' USING ERRCODE = 'PT409';
  END;
  new_profile_id := (membership_result ->> 'profile_id')::UUID;
  new_membership_id := (membership_result ->> 'membership_id')::UUID;
  PERFORM platform_private.assign_organization_scope_authorized_e1(
    row.organization_id, new_membership_id, 'Кабинет студента: доступ к организации', child_org_scope,
    row.requested_by_profile_id, row.requested_by_auth_user_id
  );
  PERFORM platform_private.append_scope_event(
    row.organization_id, new_membership_id, case_scope.id, case_scope.scope_version, TRUE,
    'user', row.requested_by_profile_id, 'Кабинет студента: доступ к делу', child_case_scope
  );

  -- Пропуск для триггера 215: эта строка, эта транзакция, этот студент.
  UPDATE platform_private.student_case_account_provisioning AS target
  SET auth_user_id = p_auth_user_id, student_profile_id = new_profile_id, student_membership_id = new_membership_id,
      bind_transaction_id = pg_catalog.pg_current_xact_id()
  WHERE target.id = row.id;
  PERFORM pg_catalog.set_config('platform.student_case_account_bind_id', row.id::TEXT, TRUE);
  UPDATE platform.student_cases AS student_case
  SET student_membership_id = new_membership_id
  WHERE student_case.organization_id = row.organization_id
    AND student_case.id = row.student_case_id
    AND student_case.student_membership_id IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM pg_catalog.set_config('platform.student_case_account_bind_id', '', TRUE);
  IF changed <> 1 THEN
    RAISE EXCEPTION 'student_case_has_cabinet' USING ERRCODE = 'PT409';
  END IF;
  UPDATE platform.student_cases AS student_case
  SET portal_activated_at = occurred_at
  WHERE student_case.organization_id = row.organization_id
    AND student_case.id = row.student_case_id
    AND student_case.student_membership_id = new_membership_id
    AND student_case.portal_activated_at IS NULL
    AND student_case.closed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'student_case_closed' USING ERRCODE = 'PT409';
  END IF;
  -- Как finalize: обязательный подъём версии доступа после обеих областей и привязки.
  PERFORM platform_private.bump_access_version(new_profile_id);

  UPDATE platform_private.student_case_account_provisioning AS target
  SET state = 'completed', login = student_login, finished_at = statement_timestamp()
  WHERE target.id = row.id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    after_state, reason, request_id
  ) VALUES (
    row.organization_id, 'user', row.requested_by_profile_id, 'auth:' || row.requested_by_auth_user_id::TEXT,
    'student.account.create', 'organization', row.organization_id,
    jsonb_build_object('auth_user_id', p_auth_user_id),
    'Кабинет студента создан администратором', row.request_id
  );
  final_result := jsonb_build_object(
    'student_case_id', row.student_case_id,
    'student_profile_id', new_profile_id,
    'student_membership_id', new_membership_id,
    'portal_activated_at', occurred_at,
    'authority_activated', TRUE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    before_state, after_state, reason, request_id
  ) VALUES (
    row.organization_id, 'user', row.requested_by_profile_id, 'auth:' || row.requested_by_auth_user_id::TEXT,
    'student.portal.authority.activate', 'student_case', row.student_case_id,
    jsonb_build_object('student_membership_id', target_case.student_membership_id,
      'portal_activated_at', target_case.portal_activated_at),
    final_result,
    'Кабинет студента от администратора', child_final_audit
  );

  RETURN jsonb_build_object('provisioning_id', row.id, 'login', student_login, 'student_case_id', row.student_case_id);
END
$$;

-- 3. Сервер не смог создать пользователя Auth или завершить: разрешение закрыто.
CREATE FUNCTION platform.fail_student_case_account_v1(p_provisioning_id UUID)
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
  UPDATE platform_private.student_case_account_provisioning
  SET state = 'failed', finished_at = statement_timestamp()
  WHERE id = p_provisioning_id AND state = 'authorized';
END
$$;

-- 4. Карточка студента: кабинет у дела («open» — студент привязан и кабинет открыт, «bound» — привязан, кабинет ещё
--    закрыт, «none» — студента нет) и причина, по которой кабинет здесь не открыть (те же отказы, что у разрешения).
CREATE FUNCTION platform.staff_student_case_cabinet_v1(p_organization_id UUID, p_student_case_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_case platform.student_cases%ROWTYPE;
BEGIN
  PERFORM 1 FROM platform_private.require_admin_actor(p_organization_id, 'membership.provision');
  SELECT * INTO target_case FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id AND student_case.id = p_student_case_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'state', CASE
      WHEN target_case.student_membership_id IS NULL THEN 'none'
      WHEN target_case.portal_activated_at IS NULL THEN 'bound'
      ELSE 'open'
    END,
    'refusal', platform_private.student_case_account_refusal(target_case)
  );
END
$$;

-- Вторая ветка триггера 215: строка этой таблицы, помеченная в этой транзакции, с этим делом и этим студентом.
CREATE FUNCTION platform_private.student_case_account_bind_allowed(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_student_membership_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bind_id UUID;
BEGIN
  BEGIN
    bind_id := NULLIF(pg_catalog.current_setting('platform.student_case_account_bind_id', TRUE), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;
  IF bind_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM platform_private.student_case_account_provisioning AS provisioning
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = provisioning.organization_id
      AND membership.id = provisioning.student_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
      AND profile.id = provisioning.student_profile_id
      AND profile.auth_user_id = provisioning.auth_user_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE provisioning.id = bind_id
      AND provisioning.organization_id = p_organization_id
      AND provisioning.student_case_id = p_student_case_id
      AND provisioning.student_membership_id = p_student_membership_id
      AND provisioning.state = 'authorized'
      AND provisioning.bind_transaction_id = pg_catalog.pg_current_xact_id()
      AND membership.status = 'active'
      AND membership."current_role" = 'student'
      AND profile.status = 'active'
      AND bundle.status = 'published'
  );
END
$$;

-- Триггер 215: прежняя ветка квитанции приглашения не меняется, вторая добавлена через OR.
-- Обе правки за один проход: по отдельности скобки в теле не сходятся.
CREATE FUNCTION pg_temp.a343_patch(p_signature TEXT, p_old TEXT[], p_new TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER; i INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  IF body IS NULL THEN
    RAISE EXCEPTION 'a343_replace_drift: % is missing', p_signature USING ERRCODE = '55000';
  END IF;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    matches := (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]);
    IF matches IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'a343_replace_drift: % fragment % expected 1, found %', p_signature, i, matches USING ERRCODE = '55000';
    END IF;
    body := replace(body, p_old[i], p_new[i]);
  END LOOP;
  EXECUTE body;
END
$$;

SELECT pg_temp.a343_patch('platform_private.guard_student_case_identity_e1()',
  ARRAY[$old1$  IF bind_receipt_id IS NULL OR NOT EXISTS ($old1$, $old2$      AND bundle.status = 'published'
  ) THEN$old2$],
  ARRAY[$new1$  IF (bind_receipt_id IS NULL OR NOT EXISTS ($new1$, $new2$      AND bundle.status = 'published'
  )) AND platform_private.student_case_account_bind_allowed(
    NEW.organization_id, NEW.id, NEW.student_membership_id
  ) IS NOT TRUE THEN$new2$]);

REVOKE ALL ON FUNCTION
  platform_private.student_case_account_refusal(platform.student_cases),
  platform.authorize_student_case_account_v1(UUID, UUID, UUID),
  platform.complete_student_case_account_v1(UUID, UUID, TEXT),
  platform.fail_student_case_account_v1(UUID),
  platform.staff_student_case_cabinet_v1(UUID, UUID),
  platform_private.student_case_account_bind_allowed(UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.authorize_student_case_account_v1(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_cabinet_v1(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.complete_student_case_account_v1(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.fail_student_case_account_v1(UUID) TO service_role;

COMMENT ON FUNCTION platform.authorize_student_case_account_v1(UUID, UUID, UUID)
  IS 'System Admin only: permission for one student account bound to an open case without a student or an invite.';
COMMENT ON FUNCTION platform.complete_student_case_account_v1(UUID, UUID, TEXT)
  IS 'Service only, within an hour: login, Student profile and membership, scopes, case binding and portal activation.';
COMMENT ON FUNCTION platform.fail_student_case_account_v1(UUID)
  IS 'Service only: closes a permission whose account could not be created or bound.';
COMMENT ON FUNCTION platform.staff_student_case_cabinet_v1(UUID, UUID)
  IS 'System Admin only: the cabinet state of a case and why a temporary-password cabinet cannot be opened there.';

NOTIFY pgrst, 'reload schema';

COMMIT;
