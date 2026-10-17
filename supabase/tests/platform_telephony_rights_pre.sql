\set ON_ERROR_STOP on
\set VERBOSITY verbose
-- Tamper run for migration 291 «Телефония» срез T2 (docs/EVO_TELEPHONY_PLAN_
-- 2026-10-16.md §11). scripts/test-postgres-authorization.sh runs this file
-- IMMEDIATELY BEFORE the ordinary apply of migration 291, once per case
-- (-v t290_case=admin_missing | catalog_drift), and requires it to FAIL with
-- SQLSTATE 55000 and the named reason. It proves the plan's promise that the
-- check at the end of the migration rolls it back:
--  * admin_missing   -- an active system admin exists and one telephony key is
--                       made ineffective for everyone (a stand-in
--                       platform_private.staff_has_permission), so the final
--                       check must refuse: telephony_rights_admin_missing;
--  * catalog_drift   -- telephony.manage already exists with another group
--                       (the migration's INSERT ... ON CONFLICT DO NOTHING keeps
--                       it), so the final check must refuse:
--                       telephony_permission_catalog_drift.
-- Everything here lives in one transaction that the failing migration never
-- commits; the ordinary apply afterwards proves nothing was kept. Isolated
-- synthetic fixture: no real person, provider or production action.
BEGIN;

SELECT (:'t290_case' = 'admin_missing') AS t290_is_admin_case \gset

\if :t290_is_admin_case
INSERT INTO platform.organizations(id, name)
  VALUES ('29000000-0000-4000-8000-000000000001', 'T290 tamper organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES ('29000000-0000-4000-8000-000000000101', 't290-tamper@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES ('29000000-0000-4000-8000-000000000201', '29000000-0000-4000-8000-000000000101',
    'T290 tamper admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES ('29000000-0000-4000-8000-000000000301', '29000000-0000-4000-8000-000000000001',
    '29000000-0000-4000-8000-000000000201', 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions
      WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id = '29000000-0000-4000-8000-000000000301';
CREATE OR REPLACE FUNCTION platform_private.staff_has_permission(
  p_organization_id UUID, p_membership_id UUID, p_permission_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_permission_key <> 'telephony.manage'
$$;
\else
INSERT INTO platform.permission_definitions
  (permission_key, description, staff_label, staff_group, staff_resource_kinds, staff_scope_kinds,
   staff_sensitive, staff_system_only)
VALUES ('telephony.manage', 'T290 pre-existing drifted definition', 'Телефония: настройки', 'Прочее',
  ARRAY['organization'], ARRAY['organization'], FALSE, FALSE);
\endif

\echo T290_TAMPER_BEFORE_MIGRATION
\i :migration_file
