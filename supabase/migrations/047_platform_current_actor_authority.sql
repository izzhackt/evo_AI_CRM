-- ============================================================
-- 047_platform_current_actor_authority.sql
--
-- P3A: one narrow, fail-closed Supabase Auth authority resolver.
--
-- The browser/server session uses its authenticated user JWT. This function
-- never accepts an actor id, organization id, role or access version from an
-- argument, and it is not executable by anon, service_role or Auth hooks.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform.current_actor_authority()
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  organization_id UUID,
  display_name TEXT,
  platform_role platform.business_role,
  platform_access_version BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH caller AS MATERIALIZED (
    SELECT
      auth.uid() AS auth_user_id,
      auth.jwt() ->> 'platform_role' AS platform_role,
      auth.jwt() ->> 'platform_access_version'
        AS platform_access_version
  ),
  active_authorities AS MATERIALIZED (
    SELECT
      profile.auth_user_id,
      profile.id AS profile_id,
      membership.id AS membership_id,
      membership.organization_id,
      profile.display_name,
      membership."current_role" AS platform_role,
      profile.access_version AS platform_access_version
    FROM caller
    JOIN platform.profiles AS profile
      ON profile.auth_user_id = caller.auth_user_id
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE caller.auth_user_id IS NOT NULL
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT = caller.platform_role
      AND profile.access_version::TEXT =
        caller.platform_access_version
  )
  SELECT
    authority.auth_user_id,
    authority.profile_id,
    authority.membership_id,
    authority.organization_id,
    authority.display_name,
    authority.platform_role,
    authority.platform_access_version
  FROM active_authorities AS authority
  WHERE (SELECT count(*) FROM active_authorities) = 1
    AND private.platform_has_permission(
      authority.organization_id,
      'organization.read'
    )
    AND private.platform_has_scope(
      authority.organization_id,
      'organization'::platform.scope_kind,
      authority.organization_id
    )
$$;

REVOKE ALL ON FUNCTION platform.current_actor_authority()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.current_actor_authority()
  TO authenticated;

COMMENT ON FUNCTION platform.current_actor_authority() IS
  'Returns exactly one live JWT-matched, permissioned and organization-scoped Platform actor authority, or no row.';

COMMIT;
