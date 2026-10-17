-- 291_platform_telephony_rights — права и роли «Телефонии Beeline KG», срез T2.
-- Контракт: docs/EVO_TELEPHONY_PLAN_2026-10-16.md §11, §16 (срез T2), ADR 0033;
-- docs/PLAN_CHANGES.md «2026-10-17 — Телефония T2: права, роли и журнал
-- (миграция 291)». Никаких таблиц, функций приёма, маршрутов или интерфейса:
-- только каталог прав, две роли, проверка в конце и расширение серверного
-- allowlist-а журнала действий.
--
-- 1. Шесть прав уровня организации, как ai.agent.* в 268: staff_resource_kinds и
--    staff_scope_kinds = {organization}, не системные, не чувствительные,
--    группа «Телефония». Различие «свои» и «все» делает не область права, а
--    функция в базе по участию сотрудника в ногах звонка (срезы T5, T6, T10).
--      telephony.call.dial              кнопка «Позвонить», результат звонка
--      telephony.recording.listen.own   слушать записи звонков со своим участием
--      telephony.recording.listen.all   слушать любую запись
--      telephony.report.read.own        блок «Звонки» отчёта, только свои цифры
--      telephony.report.read.all        блок «Звонки» отчёта по всем
--      telephony.manage                 «Настройки → Телефония»
-- 2. Две новые роли организационной области (шаблон 173: определение роли, версия
--    bundle 1, привязка, current_bundle_id), по одному набору на активную
--    организацию. Шаблон 268 («… — общие разделы») здесь НЕ применяется: он дал бы
--    ключи всем сотрудникам и не выражает «менеджер — свои, руководитель — все»
--    (план §11), поэтому listen.all, report.read.all и manage не попадают ни в
--    одну существующую роль.
--      «Телефония — менеджер»      call.dial, recording.listen.own, report.read.own
--      «Телефония — руководитель»  все шесть
--    Роли никому не назначаются: назначение делает admin в «Ролях» (руководитель
--    продаж — сотрудник, названный владельцем; имя в Git не пишется). Уже
--    существующая роль с тем же названием в организации не меняется: правка
--    admin сильнее миграции. Ни одна уже существующая роль (ни «… — общие
--    разделы», ни фиксированные bundles) не меняется вообще, поэтому миграция не
--    зависит от состава ролей production, который при написании не читался.
--    Назначений нет, поэтому access_version никого не растёт; в audit_events идёт
--    по одной записи `staff.roles.migrated` на роль (как в 268; это одноразовое
--    действие миграции, в allowlist журнала оно не входит).
-- 3. Системный admin. staff_has_permission даёт system admin любое право, которое
--    не sensitive и не system-only и у которого есть хотя бы один вид ресурса
--    (155); отдельный bundle admin-у не нужен, и третья роль «Телефония —
--    администратор» из запасного варианта плана не создаётся. Проверка
--    platform_private.telephony_rights_verify() в конце миграции откатывает её
--    (55000), если каталог ушёл от формы выше или у любого system admin хотя бы
--    один из шести ключей не действует. NOTICE сообщает, сколько активных
--    сотрудников пока без telephony.call.dial.
-- 4. Allowlist журнала действий (приём rename-and-union 255, шаблон 191/154):
--    p7a_safe_audit_actions() и p7a_safe_audit_resource_types() переименованы в
--    *_pre_telephony_rights и заменены новыми функциями (не OR REPLACE), которые
--    объединяют прежний список с новым; ORDER BY внутри array_agg(DISTINCT …);
--    REVOKE ALL на все версии. p7a_changed_field_codes(TEXT) не трогается: новые
--    действия берут существующую ветку по умолчанию ['record_status'].
--      действия:  telephony.recording.listen (выдача разрешения на запись),
--                 telephony.dial (набор и отказ набора), telephony.result.set,
--                 telephony.settings.change, telephony.mapping.change,
--                 telephony.automation.stop (автоматика выключена потолком)
--      типы:      telephony_call, telephony_dial_request, telephony_settings
--    Автоматические события приёма в журнал не идут (как work.* и
--    communication.webhook.persist).
-- Повторный запуск целой миграции отказывает и ничего не меняет (CREATE FUNCTION
-- для telephony_rights_verify/telephony_rights_provision и ALTER … RENAME
-- allowlist-функций падают, транзакция откатывается; то же свойство, что у 255).
-- Идемпотентна только сама platform_private.telephony_rights_provision: роль с
-- тем же названием пропускается. Старые фиксированные bundles 041 не
-- трогаются; студентам права не даются. Слияние ничего не открывает: ни
-- таблиц, ни флагов, ни маршрутов, ни кнопок; действия попадут в журнал, когда
-- их начнут писать срезы T4b–T8.
BEGIN;

INSERT INTO platform.permission_definitions
  (permission_key, description, staff_label, staff_group, staff_resource_kinds, staff_scope_kinds,
   staff_sensitive, staff_system_only)
VALUES
  ('telephony.call.dial', 'Телефония: кнопка «Позвонить» и результат звонка',
   'Телефония: позвонить из CRM', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('telephony.recording.listen.own', 'Телефония: слушать записи звонков, в которых участвовал сам сотрудник',
   'Телефония: слушать свои записи', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('telephony.recording.listen.all', 'Телефония: слушать любую запись звонка',
   'Телефония: слушать все записи', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('telephony.report.read.own', 'Телефония: блок «Звонки» отчёта, только свои цифры',
   'Телефония: отчёт по своим звонкам', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('telephony.report.read.all', 'Телефония: блок «Звонки» отчёта по всем сотрудникам',
   'Телефония: отчёт по всем звонкам', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE),
  ('telephony.manage', 'Телефония: «Настройки → Телефония» — сопоставление, часы, флаги, префиксы, лимиты',
   'Телефония: настройки', 'Телефония', ARRAY['organization'], ARRAY['organization'], FALSE, FALSE)
ON CONFLICT (permission_key) DO NOTHING;

-- Проверка в конце: форма каталога и действие всех шести ключей у каждого system
-- admin. Отдельная функция, чтобы тест мог проверить её и на порче.
CREATE FUNCTION platform_private.telephony_rights_verify()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  all_keys CONSTANT TEXT[] := ARRAY['telephony.call.dial', 'telephony.manage', 'telephony.recording.listen.all',
    'telephony.recording.listen.own', 'telephony.report.read.all', 'telephony.report.read.own'];
  admins_missing INTEGER;
  uncovered INTEGER;
BEGIN
  IF (SELECT count(*) FROM platform.permission_definitions d
      WHERE d.permission_key = ANY (all_keys)
        AND d.staff_resource_kinds = ARRAY['organization']::TEXT[]
        AND d.staff_scope_kinds = ARRAY['organization']::TEXT[]
        AND NOT d.staff_sensitive AND NOT d.staff_system_only AND d.staff_group = 'Телефония') <> 6 THEN
    RAISE EXCEPTION 'telephony_permission_catalog_drift' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO admins_missing
  FROM platform.organization_memberships m
  WHERE m.is_system_admin
    AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
    AND EXISTS (SELECT 1 FROM unnest(all_keys) k
      WHERE NOT platform_private.staff_has_permission(m.organization_id, m.id, k));
  IF admins_missing > 0 THEN
    RAISE EXCEPTION 'telephony_rights_admin_missing: %', admins_missing USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO uncovered
  FROM platform.organization_memberships m
  WHERE EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(m.organization_id, m.id))
    AND NOT platform_private.staff_has_permission(m.organization_id, m.id, 'telephony.call.dial');
  IF uncovered > 0 THEN
    RAISE NOTICE 'telephony_rights_staff_without_dial: %', uncovered;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION platform_private.telephony_rights_verify()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.telephony_rights_verify() IS
  'Migration 291: the telephony catalog keeps its shape and every system admin holds all six telephony permissions (55000 otherwise). Read-only; owner-only.';

-- Две роли на активную организацию, по форме шаблона 173. Назначений нет.
CREATE FUNCTION platform_private.telephony_rights_provision(p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  manager_keys CONSTANT TEXT[] := ARRAY['telephony.call.dial', 'telephony.recording.listen.own',
    'telephony.report.read.own'];
  supervisor_keys CONSTANT TEXT[] := ARRAY['telephony.call.dial', 'telephony.manage',
    'telephony.recording.listen.all', 'telephony.recording.listen.own', 'telephony.report.read.all',
    'telephony.report.read.own'];
  org RECORD;
  spec RECORD;
  keys TEXT[];
  v_role_id UUID;
  v_bundle_id UUID;
  created JSONB := '[]'::JSONB;
  skipped JSONB := '[]'::JSONB;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'telephony_rights_reason_required' USING ERRCODE = '22023';
  END IF;
  -- Как staff_role_request_begin: сначала организация, затем роль.
  FOR org IN SELECT o.id FROM platform.organizations o WHERE o.status = 'active' ORDER BY o.id FOR UPDATE LOOP
    FOR spec IN SELECT * FROM (VALUES
      (1, 'Телефония — менеджер',
       'Звонки: «Позвонить», результат звонка, свои записи и своя часть отчёта.', manager_keys),
      (2, 'Телефония — руководитель',
       'Звонки: все звонки и записи, отчёт по всем, настройки телефонии.', supervisor_keys)
    ) AS t(ord, label, description, permissions) ORDER BY t.ord LOOP
      IF EXISTS (SELECT 1 FROM platform.staff_role_definitions r
          WHERE r.organization_id = org.id AND r.label = spec.label) THEN
        skipped := skipped || jsonb_build_array(jsonb_build_object('organizationId', org.id, 'label', spec.label));
        CONTINUE;
      END IF;
      SELECT array_agg(DISTINCT k ORDER BY k) INTO keys FROM unnest(spec.permissions) k;
      PERFORM platform_private.staff_validate_permission_keys(to_jsonb(keys));
      IF EXISTS (SELECT 1 FROM unnest(keys) k JOIN platform.permission_definitions d ON d.permission_key = k
          WHERE d.staff_scope_kinds IS DISTINCT FROM ARRAY['organization']::TEXT[]) THEN
        RAISE EXCEPTION 'telephony_rights_scope_invalid: %', spec.label USING ERRCODE = '55000';
      END IF;

      v_role_id := gen_random_uuid();
      v_bundle_id := gen_random_uuid();
      INSERT INTO platform.staff_role_definitions (id, organization_id, label, description, status, draft_permission_keys)
        VALUES (v_role_id, org.id, spec.label, spec.description, 'active', keys);
      INSERT INTO platform.role_bundle_versions (id, role, version, label) VALUES (v_bundle_id, NULL, 1, spec.label);
      INSERT INTO platform.role_bundle_permissions (bundle_id, bundle_role, permission_key)
        SELECT v_bundle_id, NULL, k FROM unnest(keys) k;
      UPDATE platform.role_bundle_versions b SET status = 'published', published_at = statement_timestamp()
        WHERE b.id = v_bundle_id;
      INSERT INTO platform.staff_role_bundle_bindings VALUES (org.id, v_role_id, v_bundle_id, 1);
      UPDATE platform.staff_role_definitions d SET current_bundle_id = v_bundle_id WHERE d.id = v_role_id;

      INSERT INTO platform.audit_events (organization_id, actor_kind, actor_principal, action, resource_type,
        resource_id, before_state, after_state, reason, request_id)
      VALUES (org.id, 'system', 'migration:291', 'staff.roles.migrated', 'staff_role', v_role_id, NULL,
        jsonb_build_object('schemaVersion', 1, 'roleVersion', 1, 'bundleId', v_bundle_id, 'bundleVersion', 1,
          'createdPermissionKeys', to_jsonb(keys), 'affectedMembershipIds', '[]'::JSONB),
        btrim(p_reason), gen_random_uuid());
      created := created || jsonb_build_array(jsonb_build_object('organizationId', org.id, 'roleId', v_role_id,
        'label', spec.label, 'bundleId', v_bundle_id, 'permissionKeys', to_jsonb(keys)));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('roles', created, 'skipped', skipped);
END
$$;
REVOKE ALL ON FUNCTION platform_private.telephony_rights_provision(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON FUNCTION platform_private.telephony_rights_provision(TEXT) IS
  'Migration 291: create «Телефония — менеджер» and «Телефония — руководитель» (organization scope, bundle 1) in every active organization; assigns nobody. Idempotent by role label; owner-only.';

DO $tel290_provision$
DECLARE
  v_result JSONB;
BEGIN
  v_result := platform_private.telephony_rights_provision(
    'Телефония T2: роли «Телефония — менеджер» и «Телефония — руководитель» (план §11); никого не назначаем');
  -- Кто применяет ledger, видит, сколько ролей создано и сколько пропущено
  -- (роль с тем же названием уже есть: она не меняется и ключей не получает).
  RAISE NOTICE 'telephony_rights_roles_created: %', jsonb_array_length(v_result -> 'roles');
  RAISE NOTICE 'telephony_rights_roles_skipped: %', jsonb_array_length(v_result -> 'skipped');
END
$tel290_provision$;

-- Allowlist журнала: rename-and-union (255). Действия и типы объектов.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_telephony_rights;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_telephony_rights()
      || ARRAY[
    'telephony.automation.stop',
    'telephony.dial',
    'telephony.mapping.change',
    'telephony.recording.listen',
    'telephony.result.set',
    'telephony.settings.change'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_telephony_rights;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_telephony_rights()
      || ARRAY[
    'telephony_call',
    'telephony_dial_request',
    'telephony_settings'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_telephony_rights(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_telephony_rights(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $tel290_verify$
BEGIN
  PERFORM platform_private.telephony_rights_verify();
END
$tel290_verify$;

COMMIT;
