-- ============================================================
-- 041_platform_identity_rbac_audit.sql
--
-- P2C: fail-closed Platform identity, versioned RBAC, live record scope,
-- custom JWT claims, replay-safe authority mutations and append-only audit.
--
-- This migration does not map legacy Inbox/root roles and does not create a
-- Platform identity from the legacy auth.users signup trigger. Every Platform
-- membership is created explicitly through a reviewed RPC.
-- ============================================================

-- P2B temporarily gave service_role broad future-object privileges. P2C
-- replaces that bootstrap posture with explicit routine grants only.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
  REVOKE ALL PRIVILEGES ON TYPES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_private
  REVOKE ALL PRIVILEGES ON TYPES
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TYPE platform.organization_status AS ENUM (
  'active',
  'suspended',
  'closed'
);
CREATE TYPE platform.profile_status AS ENUM (
  'active',
  'blocked'
);
CREATE TYPE platform.membership_status AS ENUM (
  'invited',
  'active',
  'inactive',
  'blocked'
);
CREATE TYPE platform.business_role AS ENUM (
  'admin',
  'sales',
  'curator',
  'finance',
  'student'
);
CREATE TYPE platform.bundle_status AS ENUM (
  'draft',
  'published',
  'retired'
);
CREATE TYPE platform.scope_kind AS ENUM (
  'organization',
  'student_case',
  'application',
  'conversation',
  'document',
  'visa_case',
  'finance_record',
  'task',
  'notification'
);
CREATE TYPE platform.audit_actor_kind AS ENUM (
  'service',
  'user',
  'system'
);

CREATE TABLE platform.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  status platform.organization_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE platform.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  status platform.profile_status NOT NULL DEFAULT 'active',
  access_version BIGINT NOT NULL DEFAULT 1 CHECK (access_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT profiles_auth_user_id_key UNIQUE (auth_user_id)
);

CREATE TABLE platform.permission_definitions (
  permission_key TEXT PRIMARY KEY
    CHECK (permission_key ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE platform.role_bundle_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role platform.business_role NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.bundle_status NOT NULL DEFAULT 'draft',
  label TEXT NOT NULL CHECK (btrim(label) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  published_at TIMESTAMPTZ,
  CONSTRAINT role_bundle_versions_role_version_key UNIQUE (role, version),
  CONSTRAINT role_bundle_versions_id_role_key UNIQUE (id, role),
  CONSTRAINT role_bundle_versions_publication_check CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published')
  )
);

CREATE TABLE platform.role_bundle_permissions (
  bundle_id UUID NOT NULL,
  bundle_role platform.business_role NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (bundle_id, permission_key),
  CONSTRAINT role_bundle_permissions_bundle_role_fkey
    FOREIGN KEY (bundle_id, bundle_role)
    REFERENCES platform.role_bundle_versions(id, role)
    ON DELETE RESTRICT,
  CONSTRAINT role_bundle_permissions_permission_key_fkey
    FOREIGN KEY (permission_key)
    REFERENCES platform.permission_definitions(permission_key)
    ON DELETE RESTRICT
);

CREATE TABLE platform.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  status platform.membership_status NOT NULL DEFAULT 'active',
  "current_role" platform.business_role,
  current_bundle_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT organization_memberships_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT organization_memberships_organization_profile_key
    UNIQUE (organization_id, profile_id),
  CONSTRAINT organization_memberships_bundle_role_fkey
    FOREIGN KEY (current_bundle_id, "current_role")
    REFERENCES platform.role_bundle_versions(id, role)
    ON DELETE RESTRICT,
  CONSTRAINT organization_memberships_role_bundle_pair_check CHECK (
    ("current_role" IS NULL) = (current_bundle_id IS NULL)
  ),
  CONSTRAINT organization_memberships_active_authority_check CHECK (
    status <> 'active'
    OR ("current_role" IS NOT NULL AND current_bundle_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX organization_memberships_one_active_per_profile_idx
  ON platform.organization_memberships (profile_id)
  WHERE status = 'active';

CREATE TABLE platform.membership_role_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  role_version BIGINT NOT NULL CHECK (role_version > 0),
  previous_role platform.business_role,
  new_role platform.business_role NOT NULL,
  previous_bundle_id UUID,
  new_bundle_id UUID NOT NULL,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT membership_role_history_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT membership_role_history_new_bundle_role_fkey
    FOREIGN KEY (new_bundle_id, new_role)
    REFERENCES platform.role_bundle_versions(id, role)
    ON DELETE RESTRICT,
  CONSTRAINT membership_role_history_previous_bundle_role_fkey
    FOREIGN KEY (previous_bundle_id, previous_role)
    REFERENCES platform.role_bundle_versions(id, role)
    ON DELETE RESTRICT,
  CONSTRAINT membership_role_history_previous_pair_check CHECK (
    (previous_role IS NULL) = (previous_bundle_id IS NULL)
  ),
  CONSTRAINT membership_role_history_organization_membership_version_key
    UNIQUE (organization_id, membership_id, role_version),
  CONSTRAINT membership_role_history_actor_check CHECK (
    (actor_kind = 'user' AND actor_profile_id IS NOT NULL)
    OR (actor_kind <> 'user' AND actor_profile_id IS NULL)
  )
);

CREATE TABLE platform.record_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  scope_kind platform.scope_kind NOT NULL,
  scope_key UUID NOT NULL,
  scope_version BIGINT NOT NULL DEFAULT 1 CHECK (scope_version > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT record_scopes_organization_id_id_version_key
    UNIQUE (organization_id, id, scope_version),
  CONSTRAINT record_scopes_organization_kind_key_version_key
    UNIQUE (organization_id, scope_kind, scope_key, scope_version),
  CONSTRAINT record_scopes_organization_key_check CHECK (
    scope_kind <> 'organization'
    OR scope_key = organization_id
  )
);

CREATE TABLE platform.membership_scope_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  scope_id UUID NOT NULL,
  scope_version BIGINT NOT NULL CHECK (scope_version > 0),
  assignment_version BIGINT NOT NULL CHECK (assignment_version > 0),
  granted BOOLEAN NOT NULL,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT membership_scope_assignments_membership_fkey
    FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT membership_scope_assignments_scope_version_fkey
    FOREIGN KEY (organization_id, scope_id, scope_version)
    REFERENCES platform.record_scopes(
      organization_id,
      id,
      scope_version
    )
    ON DELETE RESTRICT,
  CONSTRAINT membership_scope_assignments_actor_check CHECK (
    (actor_kind = 'user' AND actor_profile_id IS NOT NULL)
    OR (actor_kind <> 'user' AND actor_profile_id IS NULL)
  ),
  CONSTRAINT membership_scope_assignments_event_key
    UNIQUE (
      organization_id,
      membership_id,
      scope_id,
      assignment_version
    )
);

CREATE TABLE platform.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  actor_kind platform.audit_actor_kind NOT NULL,
  actor_profile_id UUID
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_principal TEXT NOT NULL CHECK (btrim(actor_principal) <> ''),
  action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'),
  resource_type TEXT NOT NULL CHECK (
    resource_type ~ '^[a-z][a-z0-9_]*$'
  ),
  resource_id UUID NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT audit_events_request_id_key UNIQUE (request_id),
  CONSTRAINT audit_events_actor_check CHECK (
    (actor_kind = 'user' AND actor_profile_id IS NOT NULL)
    OR (actor_kind <> 'user' AND actor_profile_id IS NULL)
  )
);

-- Foreign keys are not indexed automatically. These leading indexes cover
-- tenant joins, RLS lookup paths and RESTRICT checks.
CREATE INDEX profiles_status_auth_user_idx
  ON platform.profiles (status, auth_user_id);
CREATE INDEX role_bundle_permissions_permission_key_idx
  ON platform.role_bundle_permissions (permission_key);
CREATE INDEX role_bundle_permissions_bundle_role_idx
  ON platform.role_bundle_permissions (bundle_id, bundle_role);
CREATE INDEX role_bundle_permissions_role_bundle_idx
  ON platform.role_bundle_permissions (bundle_role, bundle_id);
CREATE INDEX role_bundle_versions_status_role_version_idx
  ON platform.role_bundle_versions (status, role, version DESC);
CREATE INDEX organization_memberships_profile_status_idx
  ON platform.organization_memberships (profile_id, status);
CREATE INDEX organization_memberships_org_status_role_idx
  ON platform.organization_memberships (
    organization_id,
    status,
    "current_role"
  );
CREATE INDEX organization_memberships_bundle_role_idx
  ON platform.organization_memberships (current_bundle_id, "current_role");
CREATE INDEX membership_role_history_profile_idx
  ON platform.membership_role_history (profile_id);
CREATE INDEX membership_role_history_new_bundle_role_idx
  ON platform.membership_role_history (new_bundle_id, new_role);
CREATE INDEX membership_role_history_previous_bundle_role_idx
  ON platform.membership_role_history (previous_bundle_id, previous_role);
CREATE INDEX membership_role_history_actor_profile_idx
  ON platform.membership_role_history (actor_profile_id);
CREATE INDEX record_scopes_org_kind_key_active_idx
  ON platform.record_scopes (
    organization_id,
    scope_kind,
    scope_key,
    is_active
  );
CREATE INDEX membership_scope_assignments_membership_latest_idx
  ON platform.membership_scope_assignments (
    organization_id,
    membership_id,
    scope_id,
    assignment_version DESC
  );
CREATE INDEX membership_scope_assignments_scope_version_idx
  ON platform.membership_scope_assignments (
    organization_id,
    scope_id,
    scope_version
  );
CREATE INDEX membership_scope_assignments_actor_profile_idx
  ON platform.membership_scope_assignments (actor_profile_id);
CREATE INDEX audit_events_org_created_idx
  ON platform.audit_events (organization_id, created_at DESC);
CREATE INDEX audit_events_actor_profile_idx
  ON platform.audit_events (actor_profile_id);
CREATE INDEX audit_events_resource_idx
  ON platform.audit_events (
    organization_id,
    resource_type,
    resource_id,
    created_at DESC
  );

-- All Data API tables are deny-by-default even for their owner.
ALTER TABLE platform.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.permission_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.role_bundle_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.role_bundle_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.role_bundle_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.role_bundle_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_role_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_role_history FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.record_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.record_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_scope_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.membership_scope_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_events FORCE ROW LEVEL SECURITY;

-- Reset inherited P2B object privileges before granting the reviewed read/RPC
-- surface at the end of this migration.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Explicit v1 permission catalog. No wildcard permission exists.
INSERT INTO platform.permission_definitions (
  permission_key,
  description
)
VALUES
  ('organization.read', 'Read the active organization record'),
  ('profile.read.self', 'Read the caller''s own Platform profile'),
  ('membership.read.self', 'Read the caller''s own organization membership'),
  ('scope.read.self', 'Read the caller''s own effective record scopes'),
  ('membership.read', 'Read organization membership records'),
  ('membership.provision', 'Provision a Platform organization member'),
  ('membership.role.change', 'Change a member''s Platform business role'),
  ('membership.status.change', 'Change a member''s lifecycle status'),
  ('scope.manage', 'Assign or revoke organization record scope'),
  ('rbac.read', 'Read versioned Platform permission bundles'),
  ('audit.read', 'Read immutable organization audit evidence');

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'admin',
    1,
    'draft',
    'Admin v1'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'sales',
    1,
    'draft',
    'Sales v1'
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    'curator',
    1,
    'draft',
    'Curator v1'
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'finance',
    1,
    'draft',
    'Finance v1'
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'student',
    1,
    'draft',
    'Student v1'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT
  bundle.id,
  bundle.role,
  permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 1
  AND (
    permission.permission_key IN (
      'organization.read',
      'profile.read.self',
      'membership.read.self',
      'scope.read.self'
    )
    OR (
      bundle.role = 'admin'
      AND permission.permission_key IN (
        'membership.read',
        'membership.provision',
        'membership.role.change',
        'membership.status.change',
        'scope.manage',
        'rbac.read',
        'audit.read'
      )
    )
  );

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE version = 1;

CREATE OR REPLACE FUNCTION platform_private.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END
$$;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON platform.organizations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON platform.profiles
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER organization_memberships_set_updated_at
  BEFORE UPDATE ON platform.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();

CREATE OR REPLACE FUNCTION platform_private.block_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'platform.% is append-only; % is forbidden',
    TG_TABLE_NAME,
    TG_OP
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER permission_definitions_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.permission_definitions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER permission_definitions_append_only_truncate
  BEFORE TRUNCATE ON platform.permission_definitions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER membership_role_history_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.membership_role_history
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER membership_role_history_append_only_truncate
  BEFORE TRUNCATE ON platform.membership_role_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER membership_scope_assignments_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.membership_scope_assignments
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER membership_scope_assignments_append_only_truncate
  BEFORE TRUNCATE ON platform.membership_scope_assignments
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER audit_events_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER audit_events_append_only_truncate
  BEFORE TRUNCATE ON platform.audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.protect_published_bundle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION
      'Published role bundle % v% is immutable',
      OLD.role,
      OLD.version
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_bundle_versions_published_immutable
  BEFORE UPDATE OR DELETE ON platform.role_bundle_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_published_bundle();
CREATE TRIGGER role_bundle_versions_no_truncate
  BEFORE TRUNCATE ON platform.role_bundle_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.protect_bundle_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  checked_bundle_id UUID;
BEGIN
  checked_bundle_id := COALESCE(NEW.bundle_id, OLD.bundle_id);
  IF EXISTS (
    SELECT 1
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.id = checked_bundle_id
      AND bundle.status = 'published'
  ) THEN
    RAISE EXCEPTION
      'Permissions of published role bundle % are immutable',
      checked_bundle_id
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER role_bundle_permissions_published_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON platform.role_bundle_permissions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.protect_bundle_permission();
CREATE TRIGGER role_bundle_permissions_no_truncate
  BEFORE TRUNCATE ON platform.role_bundle_permissions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Browser policies call only these small boolean SECURITY DEFINER helpers.
-- They live outside exposed schemas, pin an empty search_path and compare JWT
-- text to trusted enum/bigint text, so malformed claims never reach a cast.
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
    JOIN platform.role_bundle_permissions AS bundle_permission
      ON bundle_permission.bundle_id = bundle.id
      AND bundle_permission.bundle_role = bundle.role
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND bundle_permission.permission_key = p_permission_key
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
  )
$$;

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
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND assignment.granted
      AND NOT EXISTS (
        SELECT 1
        FROM platform.membership_scope_assignments AS later_assignment
        WHERE later_assignment.organization_id =
            assignment.organization_id
          AND later_assignment.membership_id = assignment.membership_id
          AND later_assignment.scope_id = assignment.scope_id
          AND later_assignment.assignment_version >
            assignment.assignment_version
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_profile(
  p_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS target_membership
    JOIN platform.profiles AS target_profile
      ON target_profile.id = target_membership.profile_id
    WHERE target_profile.id = p_profile_id
      AND target_profile.status = 'active'
      AND target_membership.status = 'active'
      AND (
        (
          target_profile.auth_user_id = (SELECT auth.uid())
          AND private.platform_has_permission(
            target_membership.organization_id,
            'profile.read.self'
          )
        )
        OR private.platform_has_permission(
          target_membership.organization_id,
          'membership.read'
        )
      )
      AND private.platform_has_scope(
        target_membership.organization_id,
        'organization',
        target_membership.organization_id
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_membership(
  p_organization_id UUID,
  p_membership_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS target_membership
    JOIN platform.profiles AS target_profile
      ON target_profile.id = target_membership.profile_id
    WHERE target_membership.organization_id = p_organization_id
      AND target_membership.id = p_membership_id
      AND (
        (
          target_profile.auth_user_id = (SELECT auth.uid())
          AND private.platform_has_permission(
            p_organization_id,
            'membership.read.self'
          )
        )
        OR private.platform_has_permission(
          p_organization_id,
          'membership.read'
        )
      )
      AND private.platform_has_scope(
        p_organization_id,
        'organization',
        p_organization_id
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_scope(
  p_organization_id UUID,
  p_scope_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.record_scopes AS target_scope
    WHERE target_scope.organization_id = p_organization_id
      AND target_scope.id = p_scope_id
      AND target_scope.is_active
      AND (
        (
          private.platform_has_permission(
            p_organization_id,
            'scope.read.self'
          )
          AND private.platform_has_scope(
            p_organization_id,
            target_scope.scope_kind,
            target_scope.scope_key
          )
        )
        OR (
          private.platform_has_permission(
            p_organization_id,
            'scope.manage'
          )
          AND private.platform_has_scope(
            p_organization_id,
            'organization',
            p_organization_id
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_rbac()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND membership.status = 'active'
      AND private.platform_has_permission(
        membership.organization_id,
        'rbac.read'
      )
      AND private.platform_has_scope(
        membership.organization_id,
        'organization',
        membership.organization_id
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_audit(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.platform_has_permission(p_organization_id, 'audit.read')
    AND private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
$$;

REVOKE ALL ON FUNCTION private.platform_has_permission(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_has_scope(
  UUID,
  platform.scope_kind,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_can_read_profile(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_can_read_membership(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_can_read_scope(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_can_read_rbac()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.platform_can_read_audit(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION private.platform_has_permission(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_has_scope(
  UUID,
  platform.scope_kind,
  UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_can_read_profile(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_can_read_membership(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_can_read_scope(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_can_read_rbac()
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.platform_can_read_audit(UUID)
  TO authenticated;

-- Supabase Auth invokes this hook as supabase_auth_admin before issuing a JWT.
-- It receives only the columns required to derive the two coarse claims.
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
  claims := claims - 'platform_role' - 'platform_access_version';

  SELECT jsonb_agg(
    jsonb_build_object(
      'platform_role',
      membership."current_role"::TEXT,
      'platform_access_version',
      profile.access_version
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
    AND organization.status = 'active'
    AND bundle.status = 'published';

  IF jsonb_array_length(COALESCE(authorities, '[]'::JSONB)) = 1 THEN
    claims := jsonb_set(
      claims,
      '{platform_role}',
      authorities -> 0 -> 'platform_role',
      TRUE
    );
    claims := jsonb_set(
      claims,
      '{platform_access_version}',
      authorities -> 0 -> 'platform_access_version',
      TRUE
    );
  END IF;

  RETURN jsonb_build_object('claims', claims);
END
$$;

CREATE POLICY auth_hook_profiles_select
  ON platform.profiles
  FOR SELECT
  TO supabase_auth_admin
  USING (TRUE);
CREATE POLICY auth_hook_memberships_select
  ON platform.organization_memberships
  FOR SELECT
  TO supabase_auth_admin
  USING (TRUE);
CREATE POLICY auth_hook_organizations_select
  ON platform.organizations
  FOR SELECT
  TO supabase_auth_admin
  USING (TRUE);
CREATE POLICY auth_hook_bundles_select
  ON platform.role_bundle_versions
  FOR SELECT
  TO supabase_auth_admin
  USING (TRUE);

REVOKE ALL PRIVILEGES ON SCHEMA platform_private
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA platform_private TO supabase_auth_admin;
GRANT USAGE ON SCHEMA platform TO supabase_auth_admin;

GRANT SELECT (id, auth_user_id, status, access_version)
  ON platform.profiles TO supabase_auth_admin;
GRANT SELECT (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
) ON platform.organization_memberships TO supabase_auth_admin;
GRANT SELECT (id, status)
  ON platform.organizations TO supabase_auth_admin;
GRANT SELECT (id, role, status)
  ON platform.role_bundle_versions TO supabase_auth_admin;

GRANT USAGE ON TYPE
  platform.organization_status,
  platform.profile_status,
  platform.membership_status,
  platform.business_role,
  platform.bundle_status
TO supabase_auth_admin;

REVOKE ALL ON FUNCTION platform_private.custom_access_token_hook(JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION platform_private.custom_access_token_hook(JSONB)
  TO supabase_auth_admin;

-- Browser SELECT policies. No INSERT/UPDATE/DELETE policy is created.
CREATE POLICY organizations_read
  ON platform.organizations
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(id, 'organization.read'))
    AND (SELECT private.platform_has_scope(id, 'organization', id))
  );

CREATE POLICY profiles_read
  ON platform.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_profile(id)));

CREATE POLICY permission_definitions_read
  ON platform.permission_definitions
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_rbac()));

CREATE POLICY role_bundle_versions_read
  ON platform.role_bundle_versions
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_rbac()));

CREATE POLICY role_bundle_permissions_read
  ON platform.role_bundle_permissions
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_rbac()));

CREATE POLICY organization_memberships_read
  ON platform.organization_memberships
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_membership(organization_id, id))
  );

CREATE POLICY membership_role_history_read
  ON platform.membership_role_history
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_audit(organization_id)));

CREATE POLICY record_scopes_read
  ON platform.record_scopes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_scope(organization_id, id))
  );

CREATE POLICY membership_scope_assignments_read
  ON platform.membership_scope_assignments
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_membership(
      organization_id,
      membership_id
    ))
    AND (SELECT private.platform_can_read_scope(organization_id, scope_id))
  );

CREATE POLICY audit_events_read
  ON platform.audit_events
  FOR SELECT
  TO authenticated
  USING ((SELECT private.platform_can_read_audit(organization_id)));

CREATE OR REPLACE FUNCTION platform_private.replay_audit(
  p_request_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_reason TEXT,
  p_expected_after JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prior_event platform.audit_events%ROWTYPE;
BEGIN
  SELECT *
  INTO prior_event
  FROM platform.audit_events AS event
  WHERE event.request_id = p_request_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF prior_event.action <> p_action
    OR prior_event.resource_type <> p_resource_type
    OR (
      p_resource_id IS NOT NULL
      AND prior_event.resource_id <> p_resource_id
    )
    OR prior_event.reason <> p_reason
    OR NOT (prior_event.after_state @> p_expected_after)
  THEN
    RAISE EXCEPTION
      'request_id % was already used for another mutation',
      p_request_id
      USING ERRCODE = '22023';
  END IF;

  RETURN prior_event.after_state;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.published_bundle_for_role(
  p_role platform.business_role
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selected_bundle_id UUID;
BEGIN
  SELECT bundle.id
  INTO selected_bundle_id
  FROM platform.role_bundle_versions AS bundle
  WHERE bundle.role = p_role
    AND bundle.status = 'published'
  ORDER BY bundle.version DESC
  LIMIT 1;

  IF selected_bundle_id IS NULL THEN
    RAISE EXCEPTION
      'No published permission bundle exists for role %',
      p_role
      USING ERRCODE = '55000';
  END IF;

  RETURN selected_bundle_id;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_admin_actor(
  p_organization_id UUID,
  p_permission_key TEXT
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT private.platform_has_permission(
      p_organization_id,
      p_permission_key
    )
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION
      'Active scoped Admin permission % is required',
      p_permission_key
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    membership.id,
    profile.auth_user_id
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
    AND membership."current_role" = 'admin'
    AND organization.status = 'active'
    AND bundle.status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active scoped Admin identity is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.append_scope_event(
  p_organization_id UUID,
  p_membership_id UUID,
  p_scope_id UUID,
  p_scope_version BIGINT,
  p_granted BOOLEAN,
  p_actor_kind platform.audit_actor_kind,
  p_actor_profile_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_assignment_version BIGINT;
BEGIN
  SELECT COALESCE(MAX(assignment.assignment_version), 0) + 1
  INTO next_assignment_version
  FROM platform.membership_scope_assignments AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.membership_id = p_membership_id
    AND assignment.scope_id = p_scope_id;

  INSERT INTO platform.membership_scope_assignments (
    organization_id,
    membership_id,
    scope_id,
    scope_version,
    assignment_version,
    granted,
    actor_kind,
    actor_profile_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_membership_id,
    p_scope_id,
    p_scope_version,
    next_assignment_version,
    p_granted,
    p_actor_kind,
    p_actor_profile_id,
    btrim(p_reason),
    p_request_id
  );

  RETURN next_assignment_version;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.bump_access_version(
  p_profile_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  next_access_version BIGINT;
BEGIN
  UPDATE platform.profiles AS profile
  SET access_version = profile.access_version + 1
  WHERE profile.id = p_profile_id
  RETURNING profile.access_version INTO next_access_version;

  IF next_access_version IS NULL THEN
    RAISE EXCEPTION
      'Profile % does not exist',
      p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN next_access_version;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.organization_has_live_admin(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM platform.organizations AS organization
      WHERE organization.id = p_organization_id
        AND organization.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile
        ON profile.id = membership.profile_id
      JOIN platform.role_bundle_versions AS bundle
        ON bundle.id = membership.current_bundle_id
        AND bundle.role = membership."current_role"
      JOIN platform.record_scopes AS scope
        ON scope.organization_id = membership.organization_id
        AND scope.scope_kind = 'organization'
        AND scope.scope_key = membership.organization_id
        AND scope.is_active
      JOIN platform.membership_scope_assignments AS assignment
        ON assignment.organization_id = membership.organization_id
        AND assignment.membership_id = membership.id
        AND assignment.scope_id = scope.id
        AND assignment.scope_version = scope.scope_version
      WHERE membership.organization_id = p_organization_id
        AND membership.status = 'active'
        AND membership."current_role" = 'admin'
        AND profile.status = 'active'
        AND bundle.status = 'published'
        AND assignment.granted
        AND NOT EXISTS (
          SELECT 1
          FROM platform.membership_scope_assignments AS later_assignment
          WHERE later_assignment.organization_id =
              assignment.organization_id
            AND later_assignment.membership_id = assignment.membership_id
            AND later_assignment.scope_id = assignment.scope_id
            AND later_assignment.assignment_version >
              assignment.assignment_version
        )
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.assert_live_admin_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  checked_organization_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    FOR checked_organization_id IN
      SELECT membership.organization_id
      FROM platform.organization_memberships AS membership
      WHERE membership.profile_id = COALESCE(NEW.id, OLD.id)
    LOOP
      IF NOT platform_private.organization_has_live_admin(
        checked_organization_id
      ) THEN
        RAISE EXCEPTION
          'Organization % must retain an active organization-scoped Admin',
          checked_organization_id
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'organizations' THEN
    checked_organization_id := COALESCE(NEW.id, OLD.id);
  ELSE
    checked_organization_id :=
      COALESCE(NEW.organization_id, OLD.organization_id);
  END IF;

  IF NOT platform_private.organization_has_live_admin(
    checked_organization_id
  ) THEN
    RAISE EXCEPTION
      'Organization % must retain an active organization-scoped Admin',
      checked_organization_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER organizations_retain_live_admin
  AFTER INSERT OR UPDATE OR DELETE ON platform.organizations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_live_admin_trigger();
CREATE CONSTRAINT TRIGGER profiles_retain_live_admin
  AFTER UPDATE OR DELETE ON platform.profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_live_admin_trigger();
CREATE CONSTRAINT TRIGGER memberships_retain_live_admin
  AFTER INSERT OR UPDATE OR DELETE ON platform.organization_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_live_admin_trigger();
CREATE CONSTRAINT TRIGGER scopes_retain_live_admin
  AFTER UPDATE OR DELETE ON platform.record_scopes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_live_admin_trigger();
CREATE CONSTRAINT TRIGGER scope_events_retain_live_admin
  AFTER INSERT ON platform.membership_scope_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_live_admin_trigger();

CREATE OR REPLACE FUNCTION platform.bootstrap_organization_admin(
  p_organization_name TEXT,
  p_admin_auth_user_id UUID,
  p_admin_display_name TEXT,
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
  organization_id UUID;
  profile_id UUID;
  membership_id UUID;
  bundle_id UUID;
  scope_id UUID;
  result JSONB;
BEGIN
  IF p_request_id IS NULL
    OR p_admin_auth_user_id IS NULL
    OR btrim(COALESCE(p_organization_name, '')) = ''
    OR btrim(COALESCE(p_admin_display_name, '')) = ''
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, Admin identity, display name, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION
      'bootstrap_organization_admin is service-role-only'
      USING ERRCODE = '42501';
  END IF;

  -- Different idempotency keys must still serialize the one-time existence
  -- check. Without this fixed lock, two concurrent first-bootstrap requests
  -- could both observe an empty organizations table and create two roots.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo-platform:first-organization-bootstrap', 0)
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    'organization.bootstrap',
    'organization',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_name',
      btrim(p_organization_name),
      'admin_auth_user_id',
      p_admin_auth_user_id
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  IF EXISTS (SELECT 1 FROM platform.organizations) THEN
    RAISE EXCEPTION
      'The first Platform organization has already been bootstrapped'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_admin_auth_user_id
  ) THEN
    RAISE EXCEPTION
      'Auth user % does not exist',
      p_admin_auth_user_id
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.profiles AS existing_profile
    WHERE existing_profile.auth_user_id = p_admin_auth_user_id
  ) THEN
    RAISE EXCEPTION
      'Platform profile already exists for auth user %',
      p_admin_auth_user_id
      USING ERRCODE = '23505';
  END IF;

  bundle_id :=
    platform_private.published_bundle_for_role('admin');

  INSERT INTO platform.organizations (name)
  VALUES (btrim(p_organization_name))
  RETURNING id INTO organization_id;

  INSERT INTO platform.profiles (
    auth_user_id,
    display_name
  )
  VALUES (
    p_admin_auth_user_id,
    btrim(p_admin_display_name)
  )
  RETURNING id INTO profile_id;

  INSERT INTO platform.organization_memberships (
    organization_id,
    profile_id,
    status,
    "current_role",
    current_bundle_id
  )
  VALUES (
    organization_id,
    profile_id,
    'active',
    'admin',
    bundle_id
  )
  RETURNING id INTO membership_id;

  INSERT INTO platform.record_scopes (
    organization_id,
    scope_kind,
    scope_key,
    scope_version
  )
  VALUES (
    organization_id,
    'organization',
    organization_id,
    1
  )
  RETURNING id INTO scope_id;

  INSERT INTO platform.membership_role_history (
    organization_id,
    membership_id,
    profile_id,
    role_version,
    previous_role,
    new_role,
    previous_bundle_id,
    new_bundle_id,
    actor_kind,
    actor_profile_id,
    reason,
    request_id
  )
  VALUES (
    organization_id,
    membership_id,
    profile_id,
    1,
    NULL,
    'admin',
    NULL,
    bundle_id,
    'service',
    NULL,
    btrim(p_reason),
    p_request_id
  );

  PERFORM platform_private.append_scope_event(
    organization_id,
    membership_id,
    scope_id,
    1,
    TRUE,
    'service',
    NULL,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id',
    organization_id,
    'organization_name',
    btrim(p_organization_name),
    'profile_id',
    profile_id,
    'admin_auth_user_id',
    p_admin_auth_user_id,
    'membership_id',
    membership_id,
    'role',
    'admin',
    'status',
    'active',
    'bundle_id',
    bundle_id,
    'scope_id',
    scope_id,
    'access_version',
    1
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
    request_id
  )
  VALUES (
    organization_id,
    'service',
    NULL,
    'evo-platform-bootstrap',
    'organization.bootstrap',
    'organization',
    organization_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.provision_member(
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
  actor_profile_id UUID;
  actor_membership_id UUID;
  actor_auth_user_id UUID;
  member_profile_id UUID;
  member_membership_id UUID;
  member_bundle_id UUID;
  member_scope_id UUID;
  member_scope_version BIGINT;
  member_access_version BIGINT;
  profile_existed BOOLEAN := FALSE;
  scope_assigned BOOLEAN := FALSE;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_member_auth_user_id IS NULL
    OR p_role IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_member_display_name, '')) = ''
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, member identity, role, display name, reason and request_id are required'
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
    'membership.provision'
  ) AS actor;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    'membership.provision',
    'organization_membership',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id',
      p_organization_id,
      'member_auth_user_id',
      p_member_auth_user_id,
      'display_name',
      btrim(p_member_display_name),
      'role',
      p_role::TEXT
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION
      'Active organization % does not exist',
      p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS auth_user
    WHERE auth_user.id = p_member_auth_user_id
  ) THEN
    RAISE EXCEPTION
      'Auth user % does not exist',
      p_member_auth_user_id
      USING ERRCODE = '23503';
  END IF;

  SELECT profile.id,
         profile.access_version,
         TRUE
  INTO member_profile_id,
       member_access_version,
       profile_existed
  FROM platform.profiles AS profile
  WHERE profile.auth_user_id = p_member_auth_user_id
  FOR UPDATE;

  IF profile_existed THEN
    IF NOT EXISTS (
      SELECT 1
      FROM platform.profiles AS profile
      WHERE profile.id = member_profile_id
        AND profile.status = 'active'
        AND profile.display_name = btrim(p_member_display_name)
    ) THEN
      RAISE EXCEPTION
        'Existing Platform profile is blocked or has a different display name'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    INSERT INTO platform.profiles (
      auth_user_id,
      display_name
    )
    VALUES (
      p_member_auth_user_id,
      btrim(p_member_display_name)
    )
    RETURNING id, access_version
    INTO member_profile_id, member_access_version;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.profile_id = member_profile_id
  ) THEN
    RAISE EXCEPTION
      'A membership for this profile and organization already exists'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    WHERE membership.profile_id = member_profile_id
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION
      'This profile already has an active organization membership'
      USING ERRCODE = '23505';
  END IF;

  member_bundle_id :=
    platform_private.published_bundle_for_role(p_role);

  INSERT INTO platform.organization_memberships (
    organization_id,
    profile_id,
    status,
    "current_role",
    current_bundle_id
  )
  VALUES (
    p_organization_id,
    member_profile_id,
    'active',
    p_role,
    member_bundle_id
  )
  RETURNING id INTO member_membership_id;

  IF profile_existed THEN
    member_access_version :=
      platform_private.bump_access_version(member_profile_id);
  END IF;

  INSERT INTO platform.membership_role_history (
    organization_id,
    membership_id,
    profile_id,
    role_version,
    previous_role,
    new_role,
    previous_bundle_id,
    new_bundle_id,
    actor_kind,
    actor_profile_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    member_membership_id,
    member_profile_id,
    1,
    NULL,
    p_role,
    NULL,
    member_bundle_id,
    'user',
    actor_profile_id,
    btrim(p_reason),
    p_request_id
  );

  IF p_role = 'admin' THEN
    SELECT scope.id, scope.scope_version
    INTO member_scope_id, member_scope_version
    FROM platform.record_scopes AS scope
    WHERE scope.organization_id = p_organization_id
      AND scope.scope_kind = 'organization'
      AND scope.scope_key = p_organization_id
      AND scope.is_active
    ORDER BY scope.scope_version DESC
    LIMIT 1;

    IF member_scope_id IS NULL THEN
      RAISE EXCEPTION
        'Organization scope is missing for %',
        p_organization_id
        USING ERRCODE = '55000';
    END IF;

    PERFORM platform_private.append_scope_event(
      p_organization_id,
      member_membership_id,
      member_scope_id,
      member_scope_version,
      TRUE,
      'user',
      actor_profile_id,
      btrim(p_reason),
      p_request_id
    );
    scope_assigned := TRUE;
  END IF;

  result := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'profile_id',
    member_profile_id,
    'member_auth_user_id',
    p_member_auth_user_id,
    'display_name',
    btrim(p_member_display_name),
    'membership_id',
    member_membership_id,
    'role',
    p_role::TEXT,
    'status',
    'active',
    'bundle_id',
    member_bundle_id,
    'organization_scope_assigned',
    scope_assigned,
    'access_version',
    member_access_version
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
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    'membership.provision',
    'organization_membership',
    member_membership_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.mutate_organization_scope(
  p_organization_id UUID,
  p_membership_id UUID,
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
  target_status platform.membership_status;
  organization_scope_id UUID;
  organization_scope_version BIGINT;
  latest_scope_granted BOOLEAN;
  latest_assignment_version BIGINT;
  next_assignment_version BIGINT;
  next_access_version BIGINT;
  action_name TEXT;
  before_state JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_membership_id IS NULL
    OR p_granted IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, scope effect, reason and request_id are required'
      USING ERRCODE = '22023';
  END IF;

  action_name := CASE
    WHEN p_granted THEN 'membership.scope.organization.assign'
    ELSE 'membership.scope.organization.revoke'
  END;

  SELECT actor.actor_profile_id,
         actor.actor_membership_id,
         actor.actor_auth_user_id
  INTO actor_profile_id,
       actor_membership_id,
       actor_auth_user_id
  FROM platform_private.require_admin_actor(
    p_organization_id,
    'scope.manage'
  ) AS actor;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    action_name,
    'organization_membership',
    p_membership_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id',
      p_organization_id,
      'membership_id',
      p_membership_id,
      'organization_scope_granted',
      p_granted
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  SELECT
    membership.profile_id,
    membership."current_role",
    membership.status
  INTO
    target_profile_id,
    target_role,
    target_status
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Membership % does not exist in organization %',
      p_membership_id,
      p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT scope.id, scope.scope_version
  INTO organization_scope_id, organization_scope_version
  FROM platform.record_scopes AS scope
  WHERE scope.organization_id = p_organization_id
    AND scope.scope_kind = 'organization'
    AND scope.scope_key = p_organization_id
    AND scope.is_active
  ORDER BY scope.scope_version DESC
  LIMIT 1;

  IF organization_scope_id IS NULL THEN
    RAISE EXCEPTION
      'Organization scope is missing for %',
      p_organization_id
      USING ERRCODE = '55000';
  END IF;

  SELECT assignment.granted, assignment.assignment_version
  INTO latest_scope_granted, latest_assignment_version
  FROM platform.membership_scope_assignments AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.membership_id = p_membership_id
    AND assignment.scope_id = organization_scope_id
  ORDER BY assignment.assignment_version DESC
  LIMIT 1;

  IF p_granted AND COALESCE(latest_scope_granted, FALSE) THEN
    RAISE EXCEPTION
      'Membership % already has organization scope',
      p_membership_id
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_granted AND NOT COALESCE(latest_scope_granted, FALSE) THEN
    RAISE EXCEPTION
      'Membership % does not have organization scope',
      p_membership_id
      USING ERRCODE = '22023';
  END IF;

  before_state := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    target_role::TEXT,
    'status',
    target_status::TEXT,
    'organization_scope_granted',
    COALESCE(latest_scope_granted, FALSE),
    'assignment_version',
    latest_assignment_version
  );

  next_assignment_version :=
    platform_private.append_scope_event(
      p_organization_id,
      p_membership_id,
      organization_scope_id,
      organization_scope_version,
      p_granted,
      'user',
      actor_profile_id,
      btrim(p_reason),
      p_request_id
    );

  next_access_version :=
    platform_private.bump_access_version(target_profile_id);

  result := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    target_role::TEXT,
    'status',
    target_status::TEXT,
    'scope_id',
    organization_scope_id,
    'scope_version',
    organization_scope_version,
    'organization_scope_granted',
    p_granted,
    'assignment_version',
    next_assignment_version,
    'access_version',
    next_access_version
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
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    action_name,
    'organization_membership',
    p_membership_id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.assign_organization_scope(
  p_organization_id UUID,
  p_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_organization_scope(
    p_organization_id,
    p_membership_id,
    TRUE,
    btrim(p_reason),
    p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.revoke_organization_scope(
  p_organization_id UUID,
  p_membership_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.mutate_organization_scope(
    p_organization_id,
    p_membership_id,
    FALSE,
    p_reason,
    p_request_id
  )
$$;

CREATE OR REPLACE FUNCTION platform.change_membership_role(
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
DECLARE
  actor_profile_id UUID;
  actor_membership_id UUID;
  actor_auth_user_id UUID;
  target_profile_id UUID;
  previous_role platform.business_role;
  previous_bundle_id UUID;
  target_status platform.membership_status;
  new_bundle_id UUID;
  next_role_version BIGINT;
  next_access_version BIGINT;
  organization_scope_id UUID;
  organization_scope_version BIGINT;
  latest_scope_granted BOOLEAN;
  scope_auto_assigned BOOLEAN := FALSE;
  before_state JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_membership_id IS NULL
    OR p_new_role IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, new role, reason and request_id are required'
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    'membership.role.change',
    'organization_membership',
    p_membership_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id',
      p_organization_id,
      'membership_id',
      p_membership_id,
      'role',
      p_new_role::TEXT
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  SELECT
    membership.profile_id,
    membership."current_role",
    membership.current_bundle_id,
    membership.status
  INTO
    target_profile_id,
    previous_role,
    previous_bundle_id,
    target_status
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Membership % does not exist in organization %',
      p_membership_id,
      p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  IF previous_role = p_new_role THEN
    RAISE EXCEPTION
      'Membership % already has role %',
      p_membership_id,
      p_new_role
      USING ERRCODE = '22023';
  END IF;

  new_bundle_id :=
    platform_private.published_bundle_for_role(p_new_role);

  before_state := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    previous_role::TEXT,
    'status',
    target_status::TEXT,
    'bundle_id',
    previous_bundle_id
  );

  UPDATE platform.organization_memberships
  SET
    "current_role" = p_new_role,
    current_bundle_id = new_bundle_id
  WHERE organization_id = p_organization_id
    AND id = p_membership_id;

  IF p_new_role = 'admin' THEN
    SELECT scope.id, scope.scope_version
    INTO organization_scope_id, organization_scope_version
    FROM platform.record_scopes AS scope
    WHERE scope.organization_id = p_organization_id
      AND scope.scope_kind = 'organization'
      AND scope.scope_key = p_organization_id
      AND scope.is_active
    ORDER BY scope.scope_version DESC
    LIMIT 1;

    IF organization_scope_id IS NULL THEN
      RAISE EXCEPTION
        'Organization scope is missing for %',
        p_organization_id
        USING ERRCODE = '55000';
    END IF;

    SELECT assignment.granted
    INTO latest_scope_granted
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.organization_id = p_organization_id
      AND assignment.membership_id = p_membership_id
      AND assignment.scope_id = organization_scope_id
    ORDER BY assignment.assignment_version DESC
    LIMIT 1;

    IF NOT COALESCE(latest_scope_granted, FALSE) THEN
      PERFORM platform_private.append_scope_event(
        p_organization_id,
        p_membership_id,
        organization_scope_id,
        organization_scope_version,
        TRUE,
        'user',
        actor_profile_id,
        btrim(p_reason),
        p_request_id
      );
      scope_auto_assigned := TRUE;
    END IF;
  END IF;

  next_access_version :=
    platform_private.bump_access_version(target_profile_id);

  SELECT COALESCE(MAX(history.role_version), 0) + 1
  INTO next_role_version
  FROM platform.membership_role_history AS history
  WHERE history.organization_id = p_organization_id
    AND history.membership_id = p_membership_id;

  INSERT INTO platform.membership_role_history (
    organization_id,
    membership_id,
    profile_id,
    role_version,
    previous_role,
    new_role,
    previous_bundle_id,
    new_bundle_id,
    actor_kind,
    actor_profile_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_membership_id,
    target_profile_id,
    next_role_version,
    previous_role,
    p_new_role,
    previous_bundle_id,
    new_bundle_id,
    'user',
    actor_profile_id,
    btrim(p_reason),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    p_new_role::TEXT,
    'status',
    target_status::TEXT,
    'bundle_id',
    new_bundle_id,
    'role_version',
    next_role_version,
    'organization_scope_auto_assigned',
    scope_auto_assigned,
    'access_version',
    next_access_version
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
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    'membership.role.change',
    'organization_membership',
    p_membership_id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.change_membership_status(
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
DECLARE
  actor_profile_id UUID;
  actor_membership_id UUID;
  actor_auth_user_id UUID;
  target_profile_id UUID;
  target_role platform.business_role;
  target_bundle_id UUID;
  previous_status platform.membership_status;
  next_access_version BIGINT;
  before_state JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL
    OR p_membership_id IS NULL
    OR p_new_status IS NULL
    OR p_request_id IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
  THEN
    RAISE EXCEPTION
      'organization, membership, new status, reason and request_id are required'
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
    'membership.status.change'
  ) AS actor;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_request_id::TEXT, 0)
  );

  result := platform_private.replay_audit(
    p_request_id,
    'membership.status.change',
    'organization_membership',
    p_membership_id,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id',
      p_organization_id,
      'membership_id',
      p_membership_id,
      'status',
      p_new_status::TEXT
    )
  );
  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  SELECT
    membership.profile_id,
    membership."current_role",
    membership.current_bundle_id,
    membership.status
  INTO
    target_profile_id,
    target_role,
    target_bundle_id,
    previous_status
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Membership % does not exist in organization %',
      p_membership_id,
      p_organization_id
      USING ERRCODE = 'P0002';
  END IF;

  IF actor_membership_id = p_membership_id
    AND p_new_status <> 'active'
  THEN
    RAISE EXCEPTION
      'An Admin cannot deactivate or block their own membership'
      USING ERRCODE = '42501';
  END IF;

  IF previous_status = p_new_status THEN
    RAISE EXCEPTION
      'Membership % already has status %',
      p_membership_id,
      p_new_status
      USING ERRCODE = '22023';
  END IF;

  before_state := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    target_role::TEXT,
    'status',
    previous_status::TEXT,
    'bundle_id',
    target_bundle_id
  );

  UPDATE platform.organization_memberships
  SET status = p_new_status
  WHERE organization_id = p_organization_id
    AND id = p_membership_id;

  next_access_version :=
    platform_private.bump_access_version(target_profile_id);

  result := jsonb_build_object(
    'organization_id',
    p_organization_id,
    'membership_id',
    p_membership_id,
    'profile_id',
    target_profile_id,
    'role',
    target_role::TEXT,
    'status',
    p_new_status::TEXT,
    'bundle_id',
    target_bundle_id,
    'access_version',
    next_access_version
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
    request_id
  )
  VALUES (
    p_organization_id,
    'user',
    actor_profile_id,
    'auth:' || actor_auth_user_id::TEXT,
    'membership.status.change',
    'organization_membership',
    p_membership_id,
    before_state,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

-- The platform schema is an authenticated read/RPC surface only. All identity
-- writes, including service writes, remain inside the six reviewed functions.
REVOKE ALL PRIVILEGES ON SCHEMA platform
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA platform
  TO authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.organizations,
  platform.profiles,
  platform.permission_definitions,
  platform.role_bundle_versions,
  platform.role_bundle_permissions,
  platform.organization_memberships,
  platform.membership_role_history,
  platform.record_scopes,
  platform.membership_scope_assignments,
  platform.audit_events
TO authenticated;

GRANT USAGE ON TYPE
  platform.organization_status,
  platform.profile_status,
  platform.membership_status,
  platform.business_role,
  platform.bundle_status,
  platform.scope_kind,
  platform.audit_actor_kind
TO authenticated;

REVOKE ALL ON FUNCTION platform.bootstrap_organization_admin(
  TEXT,
  UUID,
  TEXT,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.bootstrap_organization_admin(
  TEXT,
  UUID,
  TEXT,
  TEXT,
  UUID
) TO service_role;

REVOKE ALL ON FUNCTION platform.provision_member(
  UUID,
  UUID,
  TEXT,
  platform.business_role,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.provision_member(
  UUID,
  UUID,
  TEXT,
  platform.business_role,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_membership_role(
  UUID,
  UUID,
  platform.business_role,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_membership_role(
  UUID,
  UUID,
  platform.business_role,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_membership_status(
  UUID,
  UUID,
  platform.membership_status,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_membership_status(
  UUID,
  UUID,
  platform.membership_status,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.assign_organization_scope(
  UUID,
  UUID,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assign_organization_scope(
  UUID,
  UUID,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.revoke_organization_scope(
  UUID,
  UUID,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.revoke_organization_scope(
  UUID,
  UUID,
  TEXT,
  UUID
) TO authenticated;

COMMENT ON TABLE platform.organizations IS
  'EVO Platform organization boundary. Lifecycle changes are forward-reviewed; P2C exposes no organization-status RPC.';
COMMENT ON TABLE platform.profiles IS
  'Auth-linked Platform identity. access_version invalidates stale JWT authority immediately through live RLS checks.';
COMMENT ON TABLE platform.role_bundle_versions IS
  'Immutable after publication; memberships bind both bundle id and business role structurally.';
COMMENT ON TABLE platform.membership_scope_assignments IS
  'Append-only grant/revoke events. The latest assignment_version is the effective scope state.';
COMMENT ON TABLE platform.audit_events IS
  'Append-only authority audit with a globally unique request_id for replay safety.';
COMMENT ON FUNCTION platform_private.custom_access_token_hook(JSONB) IS
  'Supabase custom access-token hook. Emits only platform_role and platform_access_version when exactly one live authority exists.';
