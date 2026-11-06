-- 335 «Куратор страны подставляется в продаже сам» (решение владельца 06.11.2026: «когда студент в анкете выбирает страну, ему
-- автоматом выбирается куратор страны»; пока только Китай и Малайзия, кураторов двое). Хуки набора в
-- `scripts/test-runners/test-postgres-authorization.sh` привязаны к имени файла, не к номеру.
--
-- Куратор дела назначается продажей (create_sales_report_handoff, 174/215): продажник выбирает его в форме «Отчёт продаж» из
-- списка platform.sales_register_intake_options (174). Кто куратор страны, база не знала. Роль с областью «направление» для этого
-- не годится: такой сотрудник не проходит проверку списка 174 (она идёт без направления), а куратор всей организации видит все
-- направления — проверено набором этой миграции. Поэтому куратор страны — явная настройка администратора.
--
--   platform_private.country_curators(organization_id, direction, curator_membership_id, version, updated_at,
--     updated_by_membership_id)  PK (organization_id, direction); direction только 'CN' | 'MY'; куратор NULL = не задан.
--     RLS включена и принудительна, права отозваны у всех клиентских ролей.
--   platform.country_curators_v1(организация) -> JSONB   STABLE, только системный Admin: настройка по двум странам и список
--     кураторов, которых можно выбрать (тот же отбор, что у списка 174: активный сотрудник с case.read.full и task.manage).
--   platform.country_curator_save_v1(организация, направление, ожидаемая версия, куратор, id запроса) -> JSONB   VOLATILE,
--     только системный Admin; замок организации, повтор по id запроса, версия строки, тот же ввод — без записи; журнал
--     `country.curator.change`, объект organization (как 323).
--   platform.sales_register_intake_options_v2(организация, запрос) -> JSONB   STABLE: ответ 174 с теми же правами и строками плюс
--     country_curators {CN, MY} (куратор страны, если он всё ещё в списке 174) и у лида application_country — первая страна его
--     анкеты. 174 не меняется: прежнее приложение читает прежний ответ (его разбор строгий), новое без v2 возвращается к 174.
--   Ошибки: 42501 — не Admin; 22023 — неизвестное направление, плохая версия, id запроса или куратор, которого нельзя выбрать;
--   PT409 — версия строки не та; 23505 — id запроса уже занят иным вводом.
-- Порядок выката любой. Forward-only, ничего не удаляет. Повтор: a335_already_applied (55000).
BEGIN;

DO $a335_anchor$
BEGIN
  IF to_regclass('platform_private.country_curators') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_country_curators()') IS NOT NULL
    OR 'country.curator.change' = ANY (platform_private.p7a_safe_audit_actions())
  THEN
    RAISE EXCEPTION 'a335_already_applied' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('platform.sales_register_intake_options(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.staff_context_can_access(uuid,uuid,text,text,uuid,uuid,uuid,text)') IS NULL
  THEN
    RAISE EXCEPTION 'a335_anchor_drift: the objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
END
$a335_anchor$;

CREATE TABLE platform_private.country_curators (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  direction TEXT NOT NULL CHECK (direction IN ('CN', 'MY')),
  curator_membership_id UUID,
  version BIGINT NOT NULL CHECK (version > 0 AND version < 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by_membership_id UUID NOT NULL,
  PRIMARY KEY (organization_id, direction),
  FOREIGN KEY (organization_id, curator_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, updated_by_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);
ALTER TABLE platform_private.country_curators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.country_curators FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform_private.country_curators FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Кого можно выбрать: тот же отбор, что у списка кураторов 174.
CREATE FUNCTION platform_private.country_curator_eligible(p_organization_id UUID, p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id AND m.status = 'active' AND p.status = 'active'
      AND platform_private.staff_context_can_access(p_organization_id, m.id, 'case.read.full', 'student_case', NULL, m.id, NULL, NULL)
      AND platform_private.staff_context_can_access(p_organization_id, m.id, 'task.manage', 'student_case', NULL, m.id, NULL, NULL))
$$;
REVOKE ALL ON FUNCTION platform_private.country_curator_eligible(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

CREATE FUNCTION platform.country_curators_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE countries JSONB; curators JSONB;
BEGIN
  IF p_organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.membership_id IS NOT NULL AND a.platform_role = 'admin'::platform.business_role) THEN
    RAISE EXCEPTION 'country_curator_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('direction', d.code, 'curatorId', x.curator_membership_id,
      'curatorLabel', p.display_name,
      'eligible', x.curator_membership_id IS NOT NULL AND platform_private.country_curator_eligible(p_organization_id, x.curator_membership_id),
      'version', coalesce(x.version, 0)) ORDER BY d.ord)
  INTO countries
  FROM unnest(ARRAY['CN', 'MY']) WITH ORDINALITY AS d(code, ord)
  LEFT JOIN platform_private.country_curators x ON x.organization_id = p_organization_id AND x.direction = d.code
  LEFT JOIN platform.organization_memberships m ON m.organization_id = p_organization_id AND m.id = x.curator_membership_id
  LEFT JOIN platform.profiles p ON p.id = m.profile_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'label', p.display_name) ORDER BY p.display_name, m.id), '[]'::JSONB)
  INTO curators
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND platform_private.country_curator_eligible(p_organization_id, m.id);
  RETURN jsonb_build_object('schemaVersion', 1, 'organizationId', p_organization_id, 'countries', countries, 'curators', curators);
END
$$;

CREATE FUNCTION platform.country_curator_save_v1(
  p_organization_id UUID, p_direction TEXT, p_expected_version BIGINT, p_curator_membership_id UUID, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD; v_fp TEXT; v_prior platform.audit_events%ROWTYPE;
  v_old platform_private.country_curators%ROWTYPE; v_new platform_private.country_curators%ROWTYPE;
  v_exists BOOLEAN; v_current BIGINT; v_receipt JSONB;
BEGIN
  SELECT a.organization_id, a.membership_id, a.profile_id, a.auth_user_id INTO v_actor
  FROM platform.current_actor_authority() a
  WHERE p_organization_id IS NOT NULL AND a.organization_id = p_organization_id
    AND a.membership_id IS NOT NULL AND a.platform_role = 'admin'::platform.business_role
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'country_curator_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('CN', 'MY') THEN
    RAISE EXCEPTION 'country_curator_invalid_direction' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0 OR p_expected_version >= 9007199254740991 THEN
    RAISE EXCEPTION 'country_curator_invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_curator_membership_id IS NOT NULL AND NOT platform_private.country_curator_eligible(p_organization_id, p_curator_membership_id) THEN
    RAISE EXCEPTION 'country_curator_not_eligible' USING ERRCODE = '22023';
  END IF;

  v_fp := encode(sha256(convert_to(jsonb_build_object('direction', p_direction, 'expectedVersion', p_expected_version,
    'curatorId', p_curator_membership_id)::TEXT, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('country_curators:' || p_organization_id::TEXT, 335));
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'country.curator.change'
      AND v_prior.actor_profile_id = v_actor.profile_id AND v_prior.after_state ->> 'fingerprint' = v_fp THEN
      RETURN (v_prior.after_state - 'fingerprint') || jsonb_build_object('replayed', TRUE);
    END IF;
    RAISE EXCEPTION 'country_curator_request_conflict' USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_old FROM platform_private.country_curators x
  WHERE x.organization_id = p_organization_id AND x.direction = p_direction FOR UPDATE;
  v_exists := FOUND;
  v_current := CASE WHEN v_exists THEN v_old.version ELSE 0 END;
  IF p_expected_version IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'country_curator_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF (v_exists AND v_old.curator_membership_id IS NOT DISTINCT FROM p_curator_membership_id)
    OR (NOT v_exists AND p_curator_membership_id IS NULL) THEN
    RETURN jsonb_build_object('status', 'unchanged', 'schemaVersion', 1, 'organizationId', p_organization_id,
      'direction', p_direction, 'curatorId', v_old.curator_membership_id, 'version', v_current, 'replayed', FALSE);
  END IF;

  IF NOT v_exists THEN
    INSERT INTO platform_private.country_curators AS x (organization_id, direction, curator_membership_id, version, updated_by_membership_id)
    VALUES (p_organization_id, p_direction, p_curator_membership_id, 1, v_actor.membership_id)
    RETURNING * INTO v_new;
  ELSE
    UPDATE platform_private.country_curators x SET curator_membership_id = p_curator_membership_id, version = x.version + 1,
      updated_at = statement_timestamp(), updated_by_membership_id = v_actor.membership_id
    WHERE x.organization_id = p_organization_id AND x.direction = p_direction
    RETURNING * INTO v_new;
  END IF;

  v_receipt := jsonb_build_object('status', 'saved', 'schemaVersion', 1, 'organizationId', p_organization_id,
    'direction', p_direction, 'curatorId', v_new.curator_membership_id, 'version', v_new.version);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_membership_id,
    actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id, resulting_version)
  VALUES (p_organization_id, 'user', v_actor.profile_id, v_actor.membership_id,
    'auth:' || v_actor.auth_user_id::TEXT, 'country.curator.change', 'organization', p_organization_id,
    jsonb_build_object('direction', p_direction, 'curatorId', v_old.curator_membership_id, 'version', v_current),
    v_receipt || jsonb_build_object('fingerprint', v_fp),
    'Куратор страны изменён', p_request_id, v_new.version);
  RETURN v_receipt || jsonb_build_object('replayed', FALSE);
END
$$;

CREATE FUNCTION platform.sales_register_intake_options_v2(p_organization_id UUID, p_query TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE base JSONB; leads JSONB; country JSONB;
BEGIN
  -- Права, проверка запроса и сама выборка — в 174; здесь только дополнение.
  base := platform.sales_register_intake_options(p_organization_id, p_query);
  SELECT coalesce(jsonb_agg(l.value || jsonb_build_object('application_country', (
      SELECT a.questionnaire -> 'destinationCountries' ->> 0 FROM platform_private.student_applications a
      WHERE a.organization_id = p_organization_id AND a.canonical_lead_id = (l.value ->> 'id')::UUID
      ORDER BY a.submitted_at DESC NULLS LAST, a.id DESC LIMIT 1
    )) ORDER BY l.ord), '[]'::JSONB)
  INTO leads FROM jsonb_array_elements(base -> 'leads') WITH ORDINALITY AS l(value, ord);
  -- Куратор страны — только если он всё ещё в списке кураторов 174 (уволен или без права — не подставляется).
  SELECT jsonb_object_agg(d.code, (SELECT to_jsonb(x.curator_membership_id) FROM platform_private.country_curators x
      WHERE x.organization_id = p_organization_id AND x.direction = d.code
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(base -> 'curators') c WHERE c ->> 'id' = x.curator_membership_id::TEXT)))
  INTO country FROM unnest(ARRAY['CN', 'MY']) AS d(code);
  RETURN jsonb_build_object('organization_id', base -> 'organization_id', 'curators', base -> 'curators', 'leads', leads,
    'country_curators', country);
END
$$;

REVOKE ALL ON FUNCTION platform.country_curators_v1(UUID), platform.country_curator_save_v1(UUID, TEXT, BIGINT, UUID, UUID),
  platform.sales_register_intake_options_v2(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.country_curators_v1(UUID), platform.country_curator_save_v1(UUID, TEXT, BIGINT, UUID, UUID),
  platform.sales_register_intake_options_v2(UUID, TEXT) TO authenticated;

-- «Журнал действий»: действие country.curator.change в allowlist (rename-and-union, как 323).
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_country_curators;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_country_curators()
      || ARRAY[
    'country.curator.change'
      ]::TEXT[]
  ) AS allowed(action)
$$;
REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_country_curators(),
  platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $a335_verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'platform_private.country_curators'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('authenticated', 'platform_private.country_curators', 'SELECT')
    OR has_table_privilege('service_role', 'platform_private.country_curators', 'SELECT')
  THEN
    RAISE EXCEPTION 'a335_verify_table' USING ERRCODE = '55000';
  END IF;
  IF NOT ('country.curator.change' = ANY (platform_private.p7a_safe_audit_actions()))
    OR cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_country_curators()) + 1
  THEN
    RAISE EXCEPTION 'a335_verify_allowlist' USING ERRCODE = '55000';
  END IF;
END
$a335_verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
