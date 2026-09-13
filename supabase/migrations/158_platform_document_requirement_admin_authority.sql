-- Global requirement definitions are System Admin configuration, not a case
-- document operation. Keep document.manage's case/document resource catalogue
-- and the paired staff evaluator unchanged; no role receives new authority.
CREATE OR REPLACE FUNCTION platform_private.require_p2e_admin_actor(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_permission_key = 'document.manage' THEN
    -- Preserve organization -> profile -> membership serialization before
    -- rechecking live System Admin authority, including on request replay.
    SELECT * INTO actor
    FROM platform_private.require_domain_actor(p_organization_id, p_permission_key);
    PERFORM 1
    FROM platform_private.require_admin_actor(p_organization_id, p_permission_key);
    RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
      actor.actor_auth_user_id, actor.actor_role;
  ELSE
    RETURN QUERY SELECT *
    FROM platform_private.require_organization_operator(p_organization_id, p_permission_key);
  END IF;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_p2e_admin_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
