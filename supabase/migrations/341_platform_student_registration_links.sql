-- ============================================================
-- 341_platform_student_registration_links.sql
--
-- Регистрация по ссылке (решение 07.11.2026, владелец в Telegram: «регистрация пусть остаётся», «просто по link или те
-- почты, которым мы дали разрешения, могут создавать аккаунт; а те, которым не дали, не смогут»). Сотрудник с доступом к
-- лиду создаёт личную ссылку: одна регистрация, 7 дней. Студент по ссылке заполняет анкету, вводит почту и пароль и
-- подтверждает почту кодом, как раньше; логин имя.фамилия выдаёт 340.
--
-- В базе хранится только хэш ссылки (sha256), сама ссылка показывается сотруднику один раз. Проверка и использование
-- ссылки — только сервер (service_role). Анкета студента, пришедшего по ссылке, привязывается к лиду ссылки
-- (canonical_lead_id), поэтому одобрение заводит дело у этого лида, а не второго (одна карточка на человека): правка
-- submit_student_application_v1 фрагментом ровно один раз. Ссылку нельзя создать для человека, у которого уже есть
-- дело (та же проверка, что у prepare_lead_cabinet_v1). Журнал: lead.registration.link.create.
-- ============================================================

BEGIN;

DO $a341_guard$
BEGIN
  IF to_regclass('platform_private.student_registration_links') IS NOT NULL THEN
    RAISE EXCEPTION 'a341_already_applied' USING ERRCODE = '55000';
  END IF;
END
$a341_guard$;

CREATE TABLE platform_private.student_registration_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_auth_user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT student_registration_links_lead_fkey
    FOREIGN KEY (organization_id, lead_id) REFERENCES platform.leads (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT student_registration_links_used_shape CHECK (used_at IS NOT NULL OR used_by_auth_user_id IS NULL),
  CONSTRAINT student_registration_links_expiry CHECK (expires_at > created_at)
);
CREATE INDEX student_registration_links_used_by_idx
  ON platform_private.student_registration_links (used_by_auth_user_id) WHERE used_by_auth_user_id IS NOT NULL;

ALTER TABLE platform_private.student_registration_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_registration_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.student_registration_links FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Создать ссылку для лида. Токен делает сервер; сюда приходит только его sha256.
CREATE FUNCTION platform.create_student_registration_link_v1(
  p_organization_id UUID,
  p_lead_id UUID,
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  client_id_value UUID;
  link platform_private.student_registration_links%ROWTYPE;
BEGIN
  IF p_lead_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'registration_link_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT authority.* INTO actor FROM platform.current_actor_authority() AS authority
  WHERE authority.organization_id = p_organization_id AND authority.platform_role IS DISTINCT FROM 'student';
  IF NOT FOUND OR NOT platform_private.staff_can_access(
    p_organization_id, actor.membership_id, 'lead.sales.workflow.manage', 'lead', p_lead_id
  ) THEN
    RAISE EXCEPTION 'registration_link_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT lead.client_id INTO client_id_value
  FROM platform.leads AS lead
  JOIN platform.clients AS client ON client.organization_id = lead.organization_id AND client.id = lead.client_id
  WHERE lead.organization_id = p_organization_id AND lead.id = p_lead_id
    AND lead.lifecycle_state = 'open' AND client.lifecycle_state = 'active'
  FOR UPDATE OF lead, client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration_link_forbidden' USING ERRCODE = '42501';
  END IF;

  -- Один человек — одна карточка: у человека уже есть дело — регистрация по ссылке не нужна.
  IF EXISTS (
    SELECT 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id AND student_case.state IN ('pending', 'active')
      AND (student_case.canonical_client_id = client_id_value
        OR student_case.canonical_lead_id IN (
          SELECT other.id FROM platform.leads AS other
          WHERE other.organization_id = p_organization_id AND other.client_id = client_id_value))
  ) THEN
    RAISE EXCEPTION 'registration_link_case_exists' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO platform_private.student_registration_links (
    organization_id, lead_id, token_hash, created_by_membership_id, expires_at
  ) VALUES (
    p_organization_id, p_lead_id, p_token_hash, actor.membership_id, statement_timestamp() + INTERVAL '7 days'
  )
  RETURNING * INTO link;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action, resource_type, resource_id,
    after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
    'lead.registration.link.create', 'lead', p_lead_id,
    jsonb_build_object('lead_id', p_lead_id, 'expires_at', link.expires_at),
    'Ссылка для регистрации студента', gen_random_uuid()
  );

  RETURN jsonb_build_object('lead_id', p_lead_id, 'expires_at', link.expires_at);
END
$$;

-- Проверить ссылку перед регистрацией: годна ли и какое имя подставить. Только сервер.
CREATE FUNCTION platform.check_student_registration_link_v1(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  link platform_private.student_registration_links%ROWTYPE;
  display_name TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'registration_link_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO link FROM platform_private.student_registration_links AS candidate
  WHERE candidate.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  IF link.used_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'used'); END IF;
  IF link.expires_at <= statement_timestamp() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  SELECT client.display_name INTO display_name
  FROM platform.leads AS lead
  JOIN platform.clients AS client ON client.organization_id = lead.organization_id AND client.id = lead.client_id
  WHERE lead.organization_id = link.organization_id AND lead.id = link.lead_id AND lead.lifecycle_state = 'open';
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown'); END IF;
  RETURN jsonb_build_object('status', 'valid', 'display_name', display_name);
END
$$;

-- Использовать ссылку: одна регистрация. Только сервер, сразу после создания пользователя Auth.
CREATE FUNCTION platform.consume_student_registration_link_v1(p_token_hash TEXT, p_auth_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  link platform_private.student_registration_links%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'registration_link_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_auth_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_auth_user_id) THEN
    RAISE EXCEPTION 'registration_link_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO link FROM platform_private.student_registration_links AS candidate
  WHERE candidate.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF link.used_at IS NOT NULL THEN
    RETURN CASE WHEN link.used_by_auth_user_id = p_auth_user_id THEN 'consumed' ELSE 'used' END;
  END IF;
  IF link.expires_at <= statement_timestamp() THEN RETURN 'expired'; END IF;
  UPDATE platform_private.student_registration_links
  SET used_at = statement_timestamp(), used_by_auth_user_id = p_auth_user_id
  WHERE id = link.id;
  RETURN 'consumed';
END
$$;

REVOKE ALL ON FUNCTION
  platform.create_student_registration_link_v1(UUID, UUID, TEXT),
  platform.check_student_registration_link_v1(TEXT),
  platform.consume_student_registration_link_v1(TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_student_registration_link_v1(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.check_student_registration_link_v1(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION platform.consume_student_registration_link_v1(TEXT, UUID) TO service_role;

-- Анкета студента, пришедшего по ссылке, — у лида ссылки (фрагмент ровно один раз).
CREATE FUNCTION pg_temp.a341_replace(p_signature TEXT, p_old TEXT, p_new TEXT, p_expected INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE body TEXT; matches INTEGER;
BEGIN
  body := pg_get_functiondef(to_regprocedure(p_signature));
  matches := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  IF body IS NULL OR matches IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'a341_replace_drift: % expected %, found %', p_signature, p_expected, matches USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(body, p_old, p_new);
END $$;

SELECT pg_temp.a341_replace('platform.submit_student_application_v1(uuid,jsonb,bigint)',
  $old$ ELSIF app.canonical_lead_id IS NULL THEN
  SELECT c.intake_owner_membership_id INTO owner_membership_id$old$,
  $new$ ELSIF app.canonical_lead_id IS NULL AND EXISTS(SELECT 1 FROM platform_private.student_registration_links l
   WHERE l.organization_id=org AND l.used_by_auth_user_id=auth.uid()) THEN
  -- 341: студент пришёл по ссылке — анкета у лида ссылки, второго лида не будет.
  UPDATE platform_private.student_applications SET canonical_lead_id=(SELECT l.lead_id FROM platform_private.student_registration_links l
   WHERE l.organization_id=org AND l.used_by_auth_user_id=auth.uid() ORDER BY l.used_at DESC, l.id DESC LIMIT 1)
  WHERE id=app.id RETURNING * INTO app;
 ELSIF app.canonical_lead_id IS NULL THEN
  SELECT c.intake_owner_membership_id INTO owner_membership_id$new$,
  1);

-- «Журнал действий»: lead.registration.link.create в allowlist (rename-and-union, как 335).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_registration_links;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_registration_links()
      || ARRAY[
    'lead.registration.link.create'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_registration_links(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.create_student_registration_link_v1(UUID, UUID, TEXT)
  IS 'Staff with lead access: a personal registration link for a lead without a case; one use, 7 days. Only the sha256 of the token is stored.';
COMMENT ON FUNCTION platform.check_student_registration_link_v1(TEXT)
  IS 'Service only: whether a registration link is valid, and the lead name to prefill.';
COMMENT ON FUNCTION platform.consume_student_registration_link_v1(TEXT, UUID)
  IS 'Service only: marks a registration link used by the new auth user; the анкета then joins the link''s lead.';

NOTIFY pgrst, 'reload schema';

COMMIT;
