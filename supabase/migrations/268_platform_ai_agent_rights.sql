-- 268_platform_ai_agent_rights — права «ИИ-агента» для всех сотрудников
-- (решение владельца Q9 «нет, все могут»). Контракт:
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §5.5, §13.
--
-- 1. Два права уровня организации, как team.chat.* и staff.assistant.use (155):
--    ai.agent.use — окно ИИ в чате и просмотр раздела; ai.agent.manage —
--    знания, правила, расходы и настройки. staff_resource_kinds и
--    staff_scope_kinds = {organization}, не системные, не чувствительные,
--    группа «ИИ-агент».
-- 2. Опубликованный bundle неизменяем (041), поэтому для каждой подходящей
--    роли повторяются шаги platform.staff_role_publish (155): новая версия
--    bundle (права текущего опубликованного bundle + два новых), привязка,
--    current_bundle_id/version роли, перенос активных назначений с той же
--    областью, staff_bump_memberships. Черновик роли получает два ключа
--    поверх своих (несохранённые правки admin не теряются).
--    Подходящая роль: активная, с текущим опубликованным bundle, ВСЕ права
--    которого допускают только область organization (форма «… — общие
--    разделы» из 173), и все активные назначения — organization на текущем
--    bundle. Это строже формулировки плана («все активные назначения —
--    organization»): роль без назначений, но с правами own/department
--    (например, Sales в production), иначе стала бы назначаемой только на
--    organization. Production 06.10: подходят «Продажи — общие разделы» и
--    «Сопровождение — общие разделы», 4 активных назначения.
-- 3. Проверка в конце: у каждого сотрудника перенесённых назначений и у
--    каждого system admin есть оба права — иначе миграция откатывается.
--    Активные сотрудники без права перечисляются в NOTICE количеством
--    (план §5.5; production 06.10 — 0): им admin выдаёт роль «… — общие
--    разделы» в «Ролях», как сейчас.
-- Повторный запуск ничего не меняет: роль, в текущем bundle которой уже есть
-- оба права, пропускается. Старые фиксированные bundles 041 не трогаются;
-- студентам права не даются.
BEGIN;

INSERT INTO platform.permission_definitions
  (permission_key, description, staff_label, staff_group, staff_resource_kinds, staff_scope_kinds,
   staff_sensitive, staff_system_only)
VALUES
  ('ai.agent.use', 'ИИ-агент: помощь с ответом и просмотр раздела', 'ИИ-агент: помощь с ответом', 'ИИ-агент',
   ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('ai.agent.manage', 'ИИ-агент: знания, правила, расходы и настройки', 'ИИ-агент: управление', 'ИИ-агент',
   ARRAY['organization'], ARRAY['organization'], FALSE, FALSE)
ON CONFLICT (permission_key) DO NOTHING;

DO $ai268_catalog$
BEGIN
  IF (SELECT count(*) FROM platform.permission_definitions
      WHERE permission_key IN ('ai.agent.use', 'ai.agent.manage')
        AND staff_resource_kinds = ARRAY['organization']::TEXT[]
        AND staff_scope_kinds = ARRAY['organization']::TEXT[]
        AND NOT staff_sensitive AND NOT staff_system_only AND staff_group = 'ИИ-агент') <> 2 THEN
    RAISE EXCEPTION 'ai_agent_permission_catalog_drift' USING ERRCODE = '55000';
  END IF;
END
$ai268_catalog$;

CREATE OR REPLACE FUNCTION platform_private.ai_agent_grant_common_roles(p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  new_keys CONSTANT TEXT[] := ARRAY['ai.agent.manage', 'ai.agent.use'];
  org RECORD;
  r platform.staff_role_definitions%ROWTYPE;
  current_keys TEXT[];
  keys TEXT[];
  affected UUID[];
  v_bundle_id UUID;
  v_bundle_version BIGINT;
  summary JSONB := '[]'::JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'ai_agent_grant_reason_required' USING ERRCODE = '22023';
  END IF;
  -- Как staff_role_request_begin: сначала организация, затем роль, затем
  -- сотрудники.
  FOR org IN SELECT o.id FROM platform.organizations o WHERE o.status = 'active' ORDER BY o.id FOR UPDATE LOOP
    FOR r IN SELECT d.* FROM platform.staff_role_definitions d
      WHERE d.organization_id = org.id AND d.status = 'active' AND d.current_bundle_id IS NOT NULL
      ORDER BY d.id FOR UPDATE LOOP
      IF NOT EXISTS (SELECT 1 FROM platform.staff_role_bundle_bindings b
          JOIN platform.role_bundle_versions v ON v.id = b.bundle_id AND v.version = b.bundle_version
            AND v.status = 'published'
          WHERE b.organization_id = org.id AND b.role_id = r.id AND b.bundle_id = r.current_bundle_id) THEN
        CONTINUE;
      END IF;
      SELECT COALESCE(array_agg(bp.permission_key ORDER BY bp.permission_key), '{}') INTO current_keys
      FROM platform.role_bundle_permissions bp WHERE bp.bundle_id = r.current_bundle_id;
      IF cardinality(current_keys) = 0 OR current_keys @> new_keys THEN
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(current_keys) k
          JOIN platform.permission_definitions d ON d.permission_key = k
          WHERE d.staff_scope_kinds IS DISTINCT FROM ARRAY['organization']::TEXT[]
            OR d.staff_system_only OR d.staff_sensitive) THEN
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM platform.staff_role_assignments a
          WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL
            AND (a.scope_kind <> 'organization' OR a.bundle_id <> r.current_bundle_id)) THEN
        CONTINUE;
      END IF;

      SELECT array_agg(DISTINCT k ORDER BY k) INTO keys FROM unnest(current_keys || new_keys) k;
      PERFORM platform_private.staff_validate_permission_keys(to_jsonb(keys));
      SELECT COALESCE(array_agg(DISTINCT a.membership_id ORDER BY a.membership_id), '{}') INTO affected
      FROM platform.staff_role_assignments a
      WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL;
      PERFORM platform_private.staff_lock_memberships(org.id, affected);

      SELECT COALESCE(max(b.bundle_version), 0) + 1 INTO v_bundle_version
      FROM platform.staff_role_bundle_bindings b WHERE b.organization_id = org.id AND b.role_id = r.id;
      v_bundle_id := gen_random_uuid();
      INSERT INTO platform.role_bundle_versions (id, role, version, label)
        VALUES (v_bundle_id, NULL, v_bundle_version, r.label);
      INSERT INTO platform.role_bundle_permissions (bundle_id, bundle_role, permission_key)
        SELECT v_bundle_id, NULL, k FROM unnest(keys) k;
      UPDATE platform.role_bundle_versions b SET status = 'published', published_at = statement_timestamp()
        WHERE b.id = v_bundle_id;
      INSERT INTO platform.staff_role_bundle_bindings VALUES (org.id, r.id, v_bundle_id, v_bundle_version);
      UPDATE platform.staff_role_definitions d SET current_bundle_id = v_bundle_id, version = d.version + 1,
        updated_at = statement_timestamp(),
        draft_permission_keys = (SELECT array_agg(DISTINCT k ORDER BY k) FROM unnest(d.draft_permission_keys || new_keys) k)
      WHERE d.organization_id = org.id AND d.id = r.id;
      WITH revoked AS (
        UPDATE platform.staff_role_assignments a SET revoked_at = statement_timestamp()
        WHERE a.organization_id = org.id AND a.role_id = r.id AND a.revoked_at IS NULL
        RETURNING a.*)
      INSERT INTO platform.staff_role_assignments
        (organization_id, membership_id, role_id, bundle_id, scope_kind, scope_key, resource_kind)
      SELECT organization_id, membership_id, role_id, v_bundle_id, scope_kind, scope_key, resource_kind FROM revoked;
      PERFORM platform_private.staff_bump_memberships(org.id, affected);

      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_principal, action, resource_type,
        resource_id, before_state, after_state, reason, request_id)
      VALUES (org.id, 'system', 'migration:268', 'staff.roles.migrated', 'staff_role', r.id,
        jsonb_build_object('roleVersion', r.version, 'bundleId', r.current_bundle_id,
          'publishedPermissionKeys', to_jsonb(current_keys)),
        jsonb_build_object('schemaVersion', 1, 'roleVersion', r.version + 1, 'bundleId', v_bundle_id,
          'bundleVersion', v_bundle_version, 'addedPermissionKeys',
          (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::JSONB) FROM unnest(new_keys) k WHERE NOT (k = ANY (current_keys))),
          'affectedMembershipIds', to_jsonb(affected)),
        btrim(p_reason), gen_random_uuid());
      summary := summary || jsonb_build_array(jsonb_build_object('organizationId', org.id, 'roleId', r.id,
        'bundleId', v_bundle_id, 'bundleVersion', v_bundle_version, 'affectedMembershipIds', to_jsonb(affected)));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('roles', summary);
END
$$;
REVOKE ALL ON FUNCTION platform_private.ai_agent_grant_common_roles(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.ai_agent_grant_common_roles(TEXT) IS
  'Migration 268: publish ai.agent.use/manage into every organization-only role (the «общие разделы» shape) with the staff_role_publish steps. Idempotent; owner-only.';

SELECT platform_private.ai_agent_grant_common_roles(
  'ИИ-агент P1: ai.agent.use и ai.agent.manage для ролей «общие разделы» (решение владельца Q9)');

DO $ai268_coverage$
DECLARE moved_missing INTEGER; admins_missing INTEGER; uncovered INTEGER;
BEGIN
  -- Каждый сотрудник с назначением на роль, в текущем bundle которой есть
  -- ai.agent.use, действительно получает оба права.
  SELECT count(DISTINCT a.membership_id) INTO moved_missing
  FROM platform.staff_role_assignments a
  JOIN platform.staff_role_definitions r ON r.organization_id = a.organization_id AND r.id = a.role_id
    AND r.status = 'active' AND r.current_bundle_id = a.bundle_id
  JOIN platform.role_bundle_permissions bp ON bp.bundle_id = a.bundle_id AND bp.permission_key = 'ai.agent.use'
  JOIN platform.organization_memberships m ON m.organization_id = a.organization_id AND m.id = a.membership_id
  WHERE a.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
    AND NOT (platform_private.staff_has_permission(m.organization_id, m.id, 'ai.agent.use')
      AND platform_private.staff_has_permission(m.organization_id, m.id, 'ai.agent.manage'));
  IF moved_missing > 0 THEN
    RAISE EXCEPTION 'ai_agent_rights_not_effective: %', moved_missing USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO admins_missing
  FROM platform.organization_memberships m
  WHERE m.is_system_admin AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
    AND NOT (platform_private.staff_has_permission(m.organization_id, m.id, 'ai.agent.use')
      AND platform_private.staff_has_permission(m.organization_id, m.id, 'ai.agent.manage'));
  IF admins_missing > 0 THEN
    RAISE EXCEPTION 'ai_agent_rights_admin_missing: %', admins_missing USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO uncovered
  FROM platform.organization_memberships m
  WHERE EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
    AND NOT platform_private.staff_has_permission(m.organization_id, m.id, 'ai.agent.use');
  IF uncovered > 0 THEN
    RAISE NOTICE 'ai_agent_rights_uncovered_active_staff: %', uncovered;
  END IF;
END
$ai268_coverage$;

NOTIFY pgrst, 'reload schema';
COMMIT;
