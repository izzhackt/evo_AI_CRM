-- ============================================================
-- 083_platform_unified_staff_access.sql
--
-- U1: one live Supabase staff authority for the three-role pilot.
--
-- This migration keeps the historical enum values required by later Portal
-- and migration work, but the authenticated staff lifecycle RPCs below accept
-- only admin, sales and curator. Sensitive contract/payment authority is an
-- individual append-only grant, never an implication of the role title.
-- ============================================================

ALTER TYPE platform.membership_status
  ADD VALUE IF NOT EXISTS 'suspended' AFTER 'active';

BEGIN;

INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  (
    'contract.evidence.confirm',
    'Individually granted authority to confirm contract evidence'
  ),
  (
    'finance.first.payment.confirm',
    'Individually granted authority to confirm first-payment evidence'
  );

CREATE TABLE platform.membership_permission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  permission_key TEXT NOT NULL
    REFERENCES platform.permission_definitions(permission_key)
    ON DELETE RESTRICT,
  permission_version BIGINT NOT NULL CHECK (permission_version > 0),
  granted BOOLEAN NOT NULL,
  actor_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_principal TEXT NOT NULL CHECK (btrim(actor_principal) <> ''),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT membership_permission_events_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT membership_permission_events_sensitive_key_check CHECK (
    permission_key IN (
      'contract.evidence.confirm',
      'finance.first.payment.confirm'
    )
  ),
  CONSTRAINT membership_permission_events_version_key UNIQUE (
    organization_id,
    membership_id,
    permission_key,
    permission_version
  ),
  CONSTRAINT membership_permission_events_request_key UNIQUE (request_id)
);

CREATE INDEX membership_permission_events_latest_idx
  ON platform.membership_permission_events (
    organization_id,
    membership_id,
    permission_key,
    permission_version DESC
  );
CREATE INDEX membership_permission_events_profile_idx
  ON platform.membership_permission_events (profile_id, created_at DESC);
CREATE INDEX membership_permission_events_actor_idx
  ON platform.membership_permission_events (actor_profile_id, created_at DESC);

ALTER TABLE platform.membership_permission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_permission_events FORCE ROW LEVEL SECURITY;

CREATE TRIGGER membership_permission_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.membership_permission_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER membership_permission_events_append_only_truncate
  BEFORE TRUNCATE ON platform.membership_permission_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON TABLE platform.membership_permission_events
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.latest_membership_permission_grant(
  p_organization_id UUID,
  p_membership_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT event.granted
    FROM platform.membership_permission_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.membership_id = p_membership_id
      AND event.permission_key = p_permission_key
    ORDER BY event.permission_version DESC
    LIMIT 1
  ), FALSE)
$$;

REVOKE ALL ON FUNCTION
  platform_private.latest_membership_permission_grant(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Every direct RLS decision binds the JWT to the exact live authority. The
-- existing finance.event.confirm action is additionally mapped to the narrow
-- individual first-payment permission so its real payment RPC cannot inherit
-- authority from a job title.
CREATE OR REPLACE FUNCTION private.platform_has_permission(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND membership.organization_id::TEXT =
        (SELECT auth.jwt() ->> 'platform_organization_id')
      AND membership.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_membership_id')
      AND bundle.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_id')
      AND bundle.version::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_version')
      AND (
        (
          p_permission_key = 'contract.evidence.confirm'
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'contract.evidence.confirm'
          )
        )
        OR (
          p_permission_key IN (
            'finance.event.confirm',
            'finance.first.payment.confirm'
          )
          AND membership."current_role" IN ('admin', 'sales', 'curator')
          AND platform_private.latest_membership_permission_grant(
            membership.organization_id,
            membership.id,
            'finance.first.payment.confirm'
          )
        )
        OR (
          p_permission_key NOT IN (
            'contract.evidence.confirm',
            'finance.event.confirm',
            'finance.first.payment.confirm'
          )
          AND EXISTS (
            SELECT 1
            FROM platform.role_bundle_permissions AS bundle_permission
            WHERE bundle_permission.bundle_id = bundle.id
              AND bundle_permission.bundle_role = bundle.role
              AND bundle_permission.permission_key = p_permission_key
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION private.platform_has_permission(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.platform_has_permission(UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.platform_has_scope(
  p_organization_id UUID,
  p_scope_kind platform.scope_kind,
  p_scope_key UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.profiles AS profile
    JOIN platform.organization_memberships AS membership
      ON membership.profile_id = profile.id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    JOIN platform.record_scopes AS scope
      ON scope.organization_id = membership.organization_id
      AND scope.scope_kind = p_scope_kind
      AND scope.scope_key = p_scope_key
      AND scope.is_active
    JOIN platform.membership_scope_assignments AS assignment
      ON assignment.organization_id = membership.organization_id
      AND assignment.membership_id = membership.id
      AND assignment.scope_id = scope.id
      AND assignment.scope_version = scope.scope_version
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND membership.organization_id::TEXT =
        (SELECT auth.jwt() ->> 'platform_organization_id')
      AND membership.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_membership_id')
      AND bundle.id::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_id')
      AND bundle.version::TEXT =
        (SELECT auth.jwt() ->> 'platform_bundle_version')
      AND assignment.granted
      AND NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS later_assignment
        WHERE later_assignment.organization_id = assignment.organization_id
          AND later_assignment.membership_id = assignment.membership_id
          AND later_assignment.scope_id = assignment.scope_id
          AND later_assignment.assignment_version > assignment.assignment_version
      )
  )
$$;

REVOKE ALL ON FUNCTION
  private.platform_has_scope(UUID, platform.scope_kind, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_has_scope(UUID, platform.scope_kind, UUID)
  TO authenticated;

-- Tokens carry immutable coarse claims, while every request still checks the
-- corresponding live rows. A role/status/bundle/permission change bumps the
-- access version and therefore invalidates the resident token immediately.
CREATE OR REPLACE FUNCTION platform_private.custom_access_token_hook(
  event JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  claims JSONB;
  authorities JSONB;
BEGIN
  claims := CASE
    WHEN jsonb_typeof(event -> 'claims') = 'object'
      THEN event -> 'claims'
    ELSE '{}'::JSONB
  END;
  claims := claims
    - 'platform_role'
    - 'platform_access_version'
    - 'platform_organization_id'
    - 'platform_membership_id'
    - 'platform_bundle_id'
    - 'platform_bundle_version';

  SELECT jsonb_agg(
    jsonb_build_object(
      'platform_role', membership."current_role"::TEXT,
      'platform_access_version', profile.access_version,
      'platform_organization_id', membership.organization_id::TEXT,
      'platform_membership_id', membership.id::TEXT,
      'platform_bundle_id', bundle.id::TEXT,
      'platform_bundle_version', bundle.version
    )
    ORDER BY membership.id
  )
  INTO authorities
  FROM platform.profiles AS profile
  JOIN platform.organization_memberships AS membership
    ON membership.profile_id = profile.id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  WHERE profile.auth_user_id::TEXT = event ->> 'user_id'
    AND profile.status = 'active'
    AND membership.status = 'active'
    AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
    AND organization.status = 'active'
    AND bundle.status = 'published';

  IF jsonb_array_length(COALESCE(authorities, '[]'::JSONB)) = 1 THEN
    claims := claims || (authorities -> 0);
  END IF;

  RETURN jsonb_build_object('claims', claims);
END
$$;

GRANT SELECT (version)
  ON platform.role_bundle_versions TO supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.custom_access_token_hook(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform_private.custom_access_token_hook(JSONB)
  TO supabase_auth_admin;

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
      auth.jwt() ->> 'platform_access_version' AS platform_access_version,
      auth.jwt() ->> 'platform_organization_id' AS organization_id,
      auth.jwt() ->> 'platform_membership_id' AS membership_id,
      auth.jwt() ->> 'platform_bundle_id' AS bundle_id,
      auth.jwt() ->> 'platform_bundle_version' AS bundle_version
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
      AND membership."current_role" IN ('admin', 'sales', 'curator', 'student')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT = caller.platform_role
      AND profile.access_version::TEXT = caller.platform_access_version
      AND membership.organization_id::TEXT = caller.organization_id
      AND membership.id::TEXT = caller.membership_id
      AND bundle.id::TEXT = caller.bundle_id
      AND bundle.version::TEXT = caller.bundle_version
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

-- Finance is a module/permission area in the pilot. Reuse the existing payment
-- action while removing its old job-title restriction; the explicit grant in
-- platform_has_permission is now the decisive gate.
CREATE OR REPLACE FUNCTION platform_private.require_finance_actor(
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );

  IF actor.actor_role NOT IN ('admin', 'sales', 'curator')
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'Active organization-scoped pilot permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION platform_private.require_finance_actor(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Existing broad role RPCs are retained as historical implementation detail
-- but are no longer callable by an authenticated browser. The U1 wrappers are
-- the only staff provisioning/role-assignment seam and reject finance/student.
CREATE OR REPLACE FUNCTION platform.provision_pilot_staff_member(
  p_organization_id UUID,
  p_member_auth_user_id UUID,
  p_member_display_name TEXT,
  p_role platform.business_role,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  provisioned_result JSONB;
  scope_result JSONB;
  scope_request_id UUID;
BEGIN
  IF p_role IS NULL OR p_role::TEXT NOT IN ('admin', 'sales', 'curator') THEN
    RAISE EXCEPTION
      'U1 staff role must be admin, sales or curator'
      USING ERRCODE = '22023';
  END IF;

  provisioned_result := platform.provision_member(
    p_organization_id,
    p_member_auth_user_id,
    p_member_display_name,
    p_role,
    p_reason,
    p_request_id
  );

  -- The historical provisioner assigned the organization scope only to Admin.
  -- Every U1 staff actor needs that same live scope, so append it inside this
  -- transaction before returning success. A deterministic child request ID
  -- preserves idempotent retries while keeping both audit events immutable.
  IF NOT COALESCE(
    (provisioned_result ->> 'organization_scope_assigned')::BOOLEAN,
    FALSE
  ) THEN
    scope_request_id := md5(
      p_request_id::TEXT || ':u1-pilot-organization-scope'
    )::UUID;
    scope_result := platform.assign_organization_scope(
      p_organization_id,
      (provisioned_result ->> 'membership_id')::UUID,
      p_reason,
      scope_request_id
    );
    provisioned_result := provisioned_result || jsonb_build_object(
      'organization_scope_assigned', TRUE,
      'organization_scope_assignment_version',
        (scope_result ->> 'assignment_version')::BIGINT,
      'access_version', (scope_result ->> 'access_version')::BIGINT
    );
  END IF;

  RETURN provisioned_result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_pilot_staff_role(
  p_organization_id UUID,
  p_membership_id UUID,
  p_new_role platform.business_role,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_new_role IS NULL
    OR p_new_role::TEXT NOT IN ('admin', 'sales', 'curator')
  THEN
    RAISE EXCEPTION
      'U1 staff role must be admin, sales or curator'
      USING ERRCODE = '22023';
  END IF;

  RETURN platform.change_membership_role(
    p_organization_id,
    p_membership_id,
    p_new_role,
    p_reason,
    p_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.provision_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) FROM authenticated;
REVOKE ALL ON FUNCTION platform.change_membership_role(
  UUID, UUID, platform.business_role, TEXT, UUID
) FROM authenticated;

REVOKE ALL ON FUNCTION platform.provision_pilot_staff_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.provision_pilot_staff_member(
  UUID, UUID, TEXT, platform.business_role, TEXT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_pilot_staff_role(
  UUID, UUID, platform.business_role, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_pilot_staff_role(
  UUID, UUID, platform.business_role, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION platform.change_pilot_staff_status(
  p_organization_id UUID,
  p_membership_id UUID,
  p_new_status platform.membership_status,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'membership.status.change'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.id = p_membership_id
      AND membership."current_role" IN ('admin', 'sales', 'curator')
  ) THEN
    RAISE EXCEPTION
      'Target is not a U1 pilot staff membership'
      USING ERRCODE = '22023';
  END IF;

  RETURN platform.change_membership_status(
    p_organization_id,
    p_membership_id,
    p_new_status,
    p_reason,
    p_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.change_membership_status(
  UUID, UUID, platform.membership_status, TEXT, UUID
) FROM authenticated;
REVOKE ALL ON FUNCTION platform.change_pilot_staff_status(
  UUID, UUID, platform.membership_status, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_pilot_staff_status(
  UUID, UUID, platform.membership_status, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION platform.change_membership_permission(
  p_organization_id UUID,
  p_membership_id UUID,
  p_permission_key TEXT,
  p_granted BOOLEAN,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_profile_id UUID;
  actor_membership_id UUID;
  actor_auth_user_id UUID;
  target_profile_id UUID;
  target_role platform.business_role;
  previous_granted BOOLEAN;
  next_permission_version BIGINT;
  next_access_version BIGINT;
  event_created_at TIMESTAMPTZ := statement_timestamp();
  before_state JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_membership_id IS NULL
    OR p_permission_key IS NULL
    OR p_permission_key NOT IN (
      'contract.evidence.confirm',
      'finance.first.payment.confirm'
    )
    OR p_granted IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, sensitive permission, grant, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT actor.actor_profile_id,
         actor.actor_membership_id,
         actor.actor_auth_user_id
  INTO actor_profile_id,
       actor_membership_id,
       actor_auth_user_id
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'membership.role.change'
  ) AS actor;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  result := platform_private.replay_audit(
    p_request_id,
    'membership.permission.change',
    'organization_membership',
    p_membership_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'membership_id', p_membership_id,
      'permission_key', p_permission_key,
      'granted', p_granted
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  SELECT membership.profile_id, membership."current_role"
  INTO target_profile_id, target_role
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
    AND membership."current_role" IN ('admin', 'sales', 'curator')
    AND profile.status = 'active'
  FOR UPDATE OF membership, profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active U1 pilot staff membership is unavailable'
      USING ERRCODE = '42501';
  END IF;

  previous_granted :=
    platform_private.latest_membership_permission_grant(
      p_organization_id,
      p_membership_id,
      p_permission_key
    );

  IF previous_granted = p_granted THEN
    RAISE EXCEPTION
      'Sensitive permission is already in the requested state'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(event.permission_version), 0) + 1
  INTO next_permission_version
  FROM platform.membership_permission_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.membership_id = p_membership_id
    AND event.permission_key = p_permission_key;

  INSERT INTO platform.membership_permission_events (
    organization_id,
    membership_id,
    profile_id,
    permission_key,
    permission_version,
    granted,
    actor_profile_id,
    actor_principal,
    reason,
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    p_membership_id,
    target_profile_id,
    p_permission_key,
    next_permission_version,
    p_granted,
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    btrim(p_reason),
    p_request_id,
    event_created_at
  );

  next_access_version :=
    platform_private.bump_access_version(target_profile_id);

  before_state := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'permission_key', p_permission_key,
    'granted', previous_granted
  );
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'profile_id', target_profile_id,
    'role', target_role::TEXT,
    'permission_key', p_permission_key,
    'granted', p_granted,
    'permission_version', next_permission_version,
    'access_version', next_access_version,
    'changed_at', event_created_at
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id,
    created_at
  )
  VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    'membership.permission.change',
    'organization_membership',
    p_membership_id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id,
    event_created_at
  );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.change_membership_permission(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_membership_permission(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION platform.staff_directory(
  p_organization_id UUID
)
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  display_name TEXT,
  platform_role platform.business_role,
  membership_status platform.membership_status,
  access_version BIGINT,
  contract_confirmation_granted BOOLEAN,
  first_payment_confirmation_granted BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'membership.read'
  );

  RETURN QUERY
  SELECT
    profile.auth_user_id,
    profile.id,
    membership.id,
    profile.display_name,
    membership."current_role",
    membership.status,
    profile.access_version,
    platform_private.latest_membership_permission_grant(
      membership.organization_id,
      membership.id,
      'contract.evidence.confirm'
    ),
    platform_private.latest_membership_permission_grant(
      membership.organization_id,
      membership.id,
      'finance.first.payment.confirm'
    )
  FROM platform.organization_memberships AS membership
  JOIN platform.profiles AS profile ON profile.id = membership.profile_id
  WHERE membership.organization_id = p_organization_id
    AND membership."current_role" IN ('admin', 'sales', 'curator')
  ORDER BY lower(profile.display_name), membership.id;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_directory(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_directory(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform.assert_sensitive_permission(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authority RECORD;
BEGIN
  IF p_permission_key NOT IN (
    'contract.evidence.confirm',
    'finance.first.payment.confirm'
  ) THEN
    RAISE EXCEPTION
      'Unsupported sensitive permission'
      USING ERRCODE = '22023';
  END IF;

  IF NOT private.platform_has_permission(
    p_organization_id,
    p_permission_key
  ) OR NOT private.platform_has_scope(
    p_organization_id,
    'organization',
    p_organization_id
  ) THEN
    RAISE EXCEPTION
      'Explicit live sensitive permission is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO authority FROM platform.current_actor_authority();
  IF NOT FOUND OR authority.organization_id <> p_organization_id THEN
    RAISE EXCEPTION
      'Exact live staff authority is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'organization_id', authority.organization_id,
    'membership_id', authority.membership_id,
    'profile_id', authority.profile_id,
    'role', authority.platform_role::TEXT,
    'permission_key', p_permission_key,
    'authorized', TRUE,
    'access_version', authority.platform_access_version
  );
END
$$;

REVOKE ALL ON FUNCTION platform.assert_sensitive_permission(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assert_sensitive_permission(UUID, TEXT)
  TO authenticated;

-- Extend the bounded audit projection without rewriting the historical P7A
-- allowlists. The renamed functions remain private implementation details.
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_u1;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT array_agg(action ORDER BY action)
  FROM unnest(array_append(
      platform_private.p7a_safe_audit_actions_pre_u1(),
      'membership.permission.change'
    )) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  RENAME TO p7a_changed_field_codes_pre_u1;
CREATE FUNCTION platform_private.p7a_changed_field_codes(p_action TEXT)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_action = 'membership.permission.change' THEN
      ARRAY['access_version', 'sensitive_permission']::TEXT[]
    ELSE platform_private.p7a_changed_field_codes_pre_u1(p_action)
  END
$$;

REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions_pre_u1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_safe_audit_actions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.p7a_changed_field_codes_pre_u1(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.p7a_changed_field_codes(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON TABLE platform.membership_permission_events IS
  'Append-only individual grant/revoke history for U1 sensitive staff permissions.';
COMMENT ON FUNCTION platform.change_membership_permission(
  UUID, UUID, TEXT, BOOLEAN, TEXT, UUID
) IS
  'Admin-only audited individual contract/first-payment permission lifecycle; bumps target access_version.';
COMMENT ON FUNCTION platform.assert_sensitive_permission(UUID, TEXT) IS
  'Fail-closed public action seam for testing and later domain RPC composition; performs no domain mutation.';
COMMENT ON FUNCTION platform.current_actor_authority() IS
  'Returns one live authority only when user, organization, membership, bundle version, role and access version all match verified JWT claims.';

COMMIT;
