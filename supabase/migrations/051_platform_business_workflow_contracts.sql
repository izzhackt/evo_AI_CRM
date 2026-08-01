-- ============================================================
-- 051_platform_business_workflow_contracts.sql
--
-- BW1: source-aware, versioned OP/OZO workflow contracts without PII.
--
-- This migration is additive and Platform-only. It does not alter the legacy
-- SQLite plane, provider state, or the existing student_cases operational_stage.
-- Source rows contain only an opaque key, a constrained public provider URL,
-- an optional opaque revision, and review metadata. They never contain source
-- content, customer rows, or file/folder names.
-- ============================================================

BEGIN;

CREATE TYPE platform.workflow_kind AS ENUM ('op', 'ozo');
CREATE TYPE platform.workflow_source_kind AS ENUM (
  'repository_contract',
  'google_document',
  'google_spreadsheet',
  'google_drive_file',
  'notion_database'
);
CREATE TYPE platform.workflow_source_review_status AS ENUM (
  'pending',
  'reviewed',
  'rejected',
  'retired'
);
CREATE TYPE platform.workflow_contract_version_status AS ENUM (
  'draft',
  'approved',
  'retired'
);

-- Only canonical, public-safe provider object URLs are accepted. The allowlist
-- deliberately excludes Drive folders, arbitrary paths, userinfo, ports,
-- query strings, fragments, localhost/private literals and percent-encoding.
CREATE OR REPLACE FUNCTION platform_private.is_safe_workflow_source_url(
  p_source_kind platform.workflow_source_kind,
  p_source_url TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_source_kind
    WHEN 'google_document' THEN
      p_source_url ~
        '^https://docs\.google\.com/document/d/[A-Za-z0-9_-]{10,200}(/(edit|view))?$'
    WHEN 'google_spreadsheet' THEN
      p_source_url ~
        '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{10,200}(/(edit|view))?$'
    WHEN 'google_drive_file' THEN
      p_source_url ~
        '^https://drive\.google\.com/file/d/[A-Za-z0-9_-]{10,200}(/(view|edit))?$'
    WHEN 'notion_database' THEN
      p_source_url ~
        '^https://(www\.)?notion\.so/[A-Fa-f0-9]{32}$'
    WHEN 'repository_contract' THEN
      p_source_url ~
        '^https://github\.com/[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}/commit/[A-Fa-f0-9]{40}$'
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.workflow_key_array_is_safe_unique(
  p_values TEXT[],
  p_allow_empty BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_values IS NOT NULL
    AND (p_allow_empty OR cardinality(p_values) > 0)
    AND cardinality(p_values) <= 32
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_values) AS item(value)
      WHERE item.value !~ '^[a-z][a-z0-9_]{1,63}$'
    )
    AND cardinality(p_values) = (
      SELECT count(DISTINCT item.value)
      FROM unnest(p_values) AS item(value)
    )
$$;

CREATE TABLE platform.source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL
    CHECK (source_key ~ '^src_[a-f0-9]{32,64}$'),
  source_kind platform.workflow_source_kind NOT NULL,
  source_url TEXT NOT NULL CHECK (
    length(source_url) <= 512
    AND platform_private.is_safe_workflow_source_url(source_kind, source_url)
  ),
  source_revision TEXT CHECK (
    source_revision IS NULL
    OR source_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
  ),
  review_status platform.workflow_source_review_status NOT NULL DEFAULT 'pending',
  created_by_membership_id UUID NOT NULL,
  reviewed_by_membership_id UUID,
  reviewer_role platform.business_role,
  reviewed_at TIMESTAMPTZ,
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT source_registry_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT source_registry_organization_source_key_key
    UNIQUE (organization_id, source_key),
  CONSTRAINT source_registry_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT source_registry_reviewed_by_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT source_registry_retired_by_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT source_registry_review_metadata_check CHECK (
    (
      review_status = 'pending'
      AND reviewed_by_membership_id IS NULL
      AND reviewer_role IS NULL
      AND reviewed_at IS NULL
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
    )
    OR (
      review_status IN ('reviewed', 'rejected')
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewer_role = 'admin'
      AND reviewed_at IS NOT NULL
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
    )
    OR (
      review_status = 'retired'
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewer_role = 'admin'
      AND reviewed_at IS NOT NULL
      AND retired_by_membership_id IS NOT NULL
      AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX source_registry_canonical_revision_key
  ON platform.source_registry (
    organization_id,
    source_url,
    COALESCE(source_revision, '')
  );

CREATE TABLE platform.workflow_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  contract_key TEXT NOT NULL CHECK (contract_key IN ('wf_op', 'wf_ozo')),
  workflow_kind platform.workflow_kind NOT NULL,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT workflow_contracts_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT workflow_contracts_organization_contract_key_key
    UNIQUE (organization_id, contract_key),
  CONSTRAINT workflow_contracts_one_kind_per_organization_key
    UNIQUE (organization_id, workflow_kind),
  CONSTRAINT workflow_contracts_key_kind_check CHECK (
    contract_key = 'wf_' || workflow_kind::TEXT
  ),
  CONSTRAINT workflow_contracts_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform.workflow_contract_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  workflow_contract_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.workflow_contract_version_status NOT NULL DEFAULT 'draft',
  stage_keys TEXT[] NOT NULL,
  follow_up_outcome_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  closure_result_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  terminal_stage_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_by_membership_id UUID NOT NULL,
  approved_by_membership_id UUID,
  approved_at TIMESTAMPTZ,
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT workflow_contract_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT workflow_contract_versions_organization_id_id_contract_key
    UNIQUE (organization_id, id, workflow_contract_id),
  CONSTRAINT workflow_contract_versions_contract_version_key
    UNIQUE (organization_id, workflow_contract_id, version),
  CONSTRAINT workflow_contract_versions_contract_fkey
    FOREIGN KEY (organization_id, workflow_contract_id)
    REFERENCES platform.workflow_contracts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_versions_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_versions_approved_by_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_versions_retired_by_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_versions_stage_keys_check CHECK (
    platform_private.workflow_key_array_is_safe_unique(stage_keys, FALSE)
  ),
  CONSTRAINT workflow_contract_versions_follow_up_keys_check CHECK (
    platform_private.workflow_key_array_is_safe_unique(
      follow_up_outcome_keys,
      TRUE
    )
  ),
  CONSTRAINT workflow_contract_versions_closure_keys_check CHECK (
    platform_private.workflow_key_array_is_safe_unique(
      closure_result_keys,
      TRUE
    )
  ),
  CONSTRAINT workflow_contract_versions_terminal_keys_check CHECK (
    platform_private.workflow_key_array_is_safe_unique(
      terminal_stage_keys,
      TRUE
    )
    AND terminal_stage_keys <@ stage_keys
  ),
  CONSTRAINT workflow_contract_versions_status_metadata_check CHECK (
    (
      status = 'draft'
      AND approved_by_membership_id IS NULL
      AND approved_at IS NULL
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'approved'
      AND approved_by_membership_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
    )
    OR (
      status = 'retired'
      AND approved_by_membership_id IS NOT NULL
      AND approved_at IS NOT NULL
      AND retired_by_membership_id IS NOT NULL
      AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX workflow_contract_versions_one_approved_idx
  ON platform.workflow_contract_versions (
    organization_id,
    workflow_contract_id
  )
  WHERE status = 'approved';

CREATE TABLE platform.workflow_contract_version_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  workflow_contract_id UUID NOT NULL,
  workflow_contract_version_id UUID NOT NULL,
  source_registry_id UUID NOT NULL,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT workflow_contract_version_sources_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT workflow_contract_version_sources_version_source_key
    UNIQUE (
      organization_id,
      workflow_contract_version_id,
      source_registry_id
    ),
  CONSTRAINT workflow_contract_version_sources_version_fkey
    FOREIGN KEY (
      organization_id,
      workflow_contract_version_id,
      workflow_contract_id
    )
    REFERENCES platform.workflow_contract_versions(
      organization_id,
      id,
      workflow_contract_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_version_sources_source_fkey
    FOREIGN KEY (organization_id, source_registry_id)
    REFERENCES platform.source_registry(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_contract_version_sources_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX workflow_contract_versions_contract_status_idx
  ON platform.workflow_contract_versions (
    organization_id,
    workflow_contract_id,
    status,
    version DESC
  );
CREATE INDEX workflow_contract_version_sources_source_idx
  ON platform.workflow_contract_version_sources (
    organization_id,
    source_registry_id
  );

ALTER TABLE platform.source_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.source_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contract_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contract_version_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.workflow_contract_version_sources FORCE ROW LEVEL SECURITY;

-- Workflow identities and version payloads are append-only. Source/version
-- state may advance only through the guarded transitions below.
CREATE OR REPLACE FUNCTION platform_private.guard_workflow_source_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow source rows are append-only' USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.source_key <> OLD.source_key
    OR NEW.source_kind <> OLD.source_kind
    OR NEW.source_url <> OLD.source_url
    OR NEW.source_revision IS DISTINCT FROM OLD.source_revision
    OR NEW.created_by_membership_id <> OLD.created_by_membership_id
    OR NEW.created_at <> OLD.created_at
    OR OLD.review_status IN ('rejected', 'retired')
    OR NOT (
      (OLD.review_status = 'pending' AND NEW.review_status IN ('reviewed', 'rejected'))
      OR (OLD.review_status = 'reviewed' AND NEW.review_status = 'retired')
    )
  THEN
    RAISE EXCEPTION 'Workflow source transition is immutable or invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_workflow_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow contract versions are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.workflow_contract_id <> OLD.workflow_contract_id
    OR NEW.version <> OLD.version
    OR NEW.stage_keys <> OLD.stage_keys
    OR NEW.follow_up_outcome_keys <> OLD.follow_up_outcome_keys
    OR NEW.closure_result_keys <> OLD.closure_result_keys
    OR NEW.terminal_stage_keys <> OLD.terminal_stage_keys
    OR NEW.created_by_membership_id <> OLD.created_by_membership_id
    OR NEW.created_at <> OLD.created_at
    OR OLD.status = 'retired'
    OR NOT (
      (OLD.status = 'draft' AND NEW.status = 'approved')
      OR (OLD.status = 'approved' AND NEW.status = 'retired')
    )
  THEN
    RAISE EXCEPTION 'Workflow contract version transition is immutable or invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_workflow_source_link_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.workflow_contract_versions AS version
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.workflow_contract_version_id
      AND version.workflow_contract_id = NEW.workflow_contract_id
      AND version.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Sources may be linked only to a draft workflow version'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER source_registry_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.source_registry
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_workflow_source_mutation();
CREATE TRIGGER source_registry_no_truncate
  BEFORE TRUNCATE ON platform.source_registry
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER workflow_contracts_append_only
  BEFORE UPDATE OR DELETE ON platform.workflow_contracts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER workflow_contracts_no_truncate
  BEFORE TRUNCATE ON platform.workflow_contracts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER workflow_contract_versions_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.workflow_contract_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_workflow_version_mutation();
CREATE TRIGGER workflow_contract_versions_no_truncate
  BEFORE TRUNCATE ON platform.workflow_contract_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER workflow_contract_version_sources_draft_only
  BEFORE INSERT ON platform.workflow_contract_version_sources
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_workflow_source_link_insert();
CREATE TRIGGER workflow_contract_version_sources_append_only
  BEFORE UPDATE OR DELETE ON platform.workflow_contract_version_sources
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER workflow_contract_version_sources_no_truncate
  BEFORE TRUNCATE ON platform.workflow_contract_version_sources
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Immutable v7 bundles clone every published v6 permission and add BW1 read
-- and management permissions. Student receives neither permission.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  (
    'workflow.contract.read',
    'Read reviewed sources and approved OP/OZO workflow contracts'
  ),
  (
    'workflow.contract.manage',
    'Register, review, approve and retire OP/OZO workflow contracts'
  );

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000000601', 'admin', 7, 'draft', 'Admin v7 business workflow contracts'),
  ('00000000-0000-4000-8000-000000000602', 'sales', 7, 'draft', 'Sales v7 business workflow contracts'),
  ('00000000-0000-4000-8000-000000000603', 'curator', 7, 'draft', 'Curator v7 business workflow contracts'),
  ('00000000-0000-4000-8000-000000000604', 'finance', 7, 'draft', 'Finance v7 business workflow contracts'),
  ('00000000-0000-4000-8000-000000000605', 'student', 7, 'draft', 'Student v7 business workflow contracts');

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v7.id, v7.role, v6_permission.permission_key
FROM platform.role_bundle_versions AS v7
JOIN platform.role_bundle_versions AS v6
  ON v6.role = v7.role
  AND v6.version = 6
  AND v6.status = 'published'
JOIN platform.role_bundle_permissions AS v6_permission
  ON v6_permission.bundle_id = v6.id
  AND v6_permission.bundle_role = v6.role
WHERE v7.version = 7;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 7
  AND (
    (bundle.role = 'admin' AND permission.permission_key IN (
      'workflow.contract.read',
      'workflow.contract.manage'
    ))
    OR (
      bundle.role IN ('sales', 'curator', 'finance')
      AND permission.permission_key = 'workflow.contract.read'
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 7;

CREATE TEMPORARY TABLE bw1_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v7.id AS new_bundle_id,
  profile.access_version AS previous_access_version,
  COALESCE((
    SELECT MAX(history.role_version)
    FROM platform.membership_role_history AS history
    WHERE history.organization_id = membership.organization_id
      AND history.membership_id = membership.id
  ), 0) + 1 AS next_role_version,
  gen_random_uuid() AS request_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
JOIN platform.role_bundle_versions AS v6
  ON v6.id = membership.current_bundle_id
  AND v6.role = membership."current_role"
  AND v6.version = 6
  AND v6.status = 'published'
JOIN platform.role_bundle_versions AS v7
  ON v7.role = membership."current_role"
  AND v7.version = 7
  AND v7.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL;

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
SELECT
  upgrade.organization_id,
  upgrade.membership_id,
  upgrade.profile_id,
  upgrade.next_role_version,
  upgrade.business_role,
  upgrade.business_role,
  upgrade.previous_bundle_id,
  upgrade.new_bundle_id,
  'system',
  NULL,
  'BW1 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw1_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw1_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM bw1_membership_bundle_upgrades AS upgrade
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
SELECT
  upgrade.organization_id,
  'system',
  NULL,
  'migration:051_platform_business_workflow_contracts',
  'rbac.bundle.upgrade',
  'organization_membership',
  upgrade.membership_id,
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.previous_bundle_id,
    'access_version', upgrade.previous_access_version
  ),
  jsonb_build_object(
    'role', upgrade.business_role,
    'bundle_id', upgrade.new_bundle_id,
    'access_version', profile.access_version
  ),
  'BW1 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw1_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_bw1_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:bw1:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw1_admin_actor(
  p_organization_id UUID
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
  IF p_organization_id IS NULL
    OR (SELECT auth.uid()) IS NULL
    OR NOT private.platform_has_permission(
      p_organization_id,
      'workflow.contract.manage'
    )
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION 'Active organization-scoped Admin is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, membership.id, profile.auth_user_id
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
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version')
    AND organization.status = 'active'
    AND bundle.status = 'published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active organization-scoped Admin is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.platform_can_manage_workflow_contracts(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.platform_has_permission(
      p_organization_id,
      'workflow.contract.manage'
    )
    AND private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_workflow_contracts(
  p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.platform_has_permission(
      p_organization_id,
      'workflow.contract.read'
    )
    AND private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_workflow_source(
  p_organization_id UUID,
  p_source_registry_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.platform_can_manage_workflow_contracts(p_organization_id)
    OR (
      private.platform_can_read_workflow_contracts(p_organization_id)
      AND EXISTS (
        SELECT 1
        FROM platform.source_registry AS source
        WHERE source.organization_id = p_organization_id
          AND source.id = p_source_registry_id
          AND (
            source.review_status = 'reviewed'
            OR (
              source.review_status = 'retired'
              AND EXISTS (
                SELECT 1
                FROM platform.workflow_contract_version_sources AS link
                JOIN platform.workflow_contract_versions AS version
                  ON version.organization_id = link.organization_id
                  AND version.id = link.workflow_contract_version_id
                WHERE link.organization_id = source.organization_id
                  AND link.source_registry_id = source.id
                  AND version.status IN ('approved', 'retired')
                  AND EXISTS (
                    SELECT 1
                    FROM platform.workflow_contract_version_sources AS linked_source
                    JOIN platform.source_registry AS provenance
                      ON provenance.organization_id = linked_source.organization_id
                      AND provenance.id = linked_source.source_registry_id
                    WHERE linked_source.organization_id = version.organization_id
                      AND linked_source.workflow_contract_version_id = version.id
                      AND provenance.review_status IN ('reviewed', 'retired')
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM platform.workflow_contract_version_sources AS linked_source
                    JOIN platform.source_registry AS provenance
                      ON provenance.organization_id = linked_source.organization_id
                      AND provenance.id = linked_source.source_registry_id
                    WHERE linked_source.organization_id = version.organization_id
                      AND linked_source.workflow_contract_version_id = version.id
                      AND provenance.review_status NOT IN ('reviewed', 'retired')
                  )
              )
            )
          )
      )
    )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_workflow_version(
  p_organization_id UUID,
  p_workflow_contract_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    private.platform_can_manage_workflow_contracts(p_organization_id)
    OR (
      private.platform_can_read_workflow_contracts(p_organization_id)
      AND EXISTS (
        SELECT 1
        FROM platform.workflow_contract_versions AS version
        WHERE version.organization_id = p_organization_id
          AND version.id = p_workflow_contract_version_id
          AND version.status IN ('approved', 'retired')
          AND EXISTS (
            SELECT 1
            FROM platform.workflow_contract_version_sources AS link
            JOIN platform.source_registry AS source
              ON source.organization_id = link.organization_id
              AND source.id = link.source_registry_id
            WHERE link.organization_id = version.organization_id
              AND link.workflow_contract_version_id = version.id
              AND source.review_status IN ('reviewed', 'retired')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM platform.workflow_contract_version_sources AS link
            JOIN platform.source_registry AS source
              ON source.organization_id = link.organization_id
              AND source.id = link.source_registry_id
            WHERE link.organization_id = version.organization_id
              AND link.workflow_contract_version_id = version.id
              AND source.review_status NOT IN ('reviewed', 'retired')
          )
      )
    )
$$;

CREATE POLICY source_registry_read
  ON platform.source_registry FOR SELECT TO authenticated
  USING ((SELECT private.platform_can_read_workflow_source(organization_id, id)));
CREATE POLICY workflow_contracts_read
  ON platform.workflow_contracts FOR SELECT TO authenticated
  USING (
    (SELECT private.platform_can_manage_workflow_contracts(organization_id))
    OR (
      (SELECT private.platform_can_read_workflow_contracts(organization_id))
      AND EXISTS (
        SELECT 1
        FROM platform.workflow_contract_versions AS version
        WHERE version.organization_id = workflow_contracts.organization_id
          AND version.workflow_contract_id = workflow_contracts.id
          AND private.platform_can_read_workflow_version(
            version.organization_id,
            version.id
          )
      )
    )
  );
CREATE POLICY workflow_contract_versions_read
  ON platform.workflow_contract_versions FOR SELECT TO authenticated
  USING ((SELECT private.platform_can_read_workflow_version(organization_id, id)));
CREATE POLICY workflow_contract_version_sources_read
  ON platform.workflow_contract_version_sources FOR SELECT TO authenticated
  USING (
    (SELECT private.platform_can_read_workflow_version(
      organization_id,
      workflow_contract_version_id
    ))
    AND (SELECT private.platform_can_read_workflow_source(
      organization_id,
      source_registry_id
    ))
  );

CREATE OR REPLACE FUNCTION platform_private.bw1_input_sha256(p_input JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_input::TEXT, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION platform_private.bw1_replay_uuid(
  p_request_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_reason TEXT,
  p_input_sha256 TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  replayed JSONB;
BEGIN
  replayed := platform_private.replay_audit(
    p_request_id,
    p_action,
    p_resource_type,
    NULL,
    p_reason,
    jsonb_build_object('input_sha256', p_input_sha256)
  );
  IF replayed IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (replayed ->> 'id')::UUID;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.validate_bw1_reason(p_reason TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_reason IS NULL
    OR btrim(p_reason) = ''
    OR length(btrim(p_reason)) > 500
    OR btrim(p_reason) ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'A bounded non-empty reason is required'
      USING ERRCODE = '22023';
  END IF;
  RETURN btrim(p_reason);
END
$$;

CREATE OR REPLACE FUNCTION platform_private.assert_normalized_workflow_version(
  p_organization_id UUID,
  p_workflow_contract_version_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target RECORD;
BEGIN
  SELECT
    version.status,
    version.stage_keys,
    version.follow_up_outcome_keys,
    version.closure_result_keys,
    version.terminal_stage_keys,
    contract.workflow_kind
  INTO target
  FROM platform.workflow_contract_versions AS version
  JOIN platform.workflow_contracts AS contract
    ON contract.organization_id = version.organization_id
    AND contract.id = version.workflow_contract_id
  WHERE version.organization_id = p_organization_id
    AND version.id = p_workflow_contract_version_id
  FOR UPDATE OF version;

  IF NOT FOUND OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'A draft workflow contract version is required'
      USING ERRCODE = '22023';
  END IF;

  IF target.workflow_kind = 'op' AND NOT (
    target.stage_keys = ARRAY[
      'new',
      'contacting',
      'qualified',
      'meeting_scheduled',
      'meeting_completed',
      'potential',
      'contract_signed'
    ]::TEXT[]
    AND target.follow_up_outcome_keys =
      ARRAY['no_answer', 'meeting_not_attended']::TEXT[]
    AND target.closure_result_keys = ARRAY['won', 'lost']::TEXT[]
    AND target.terminal_stage_keys = ARRAY[]::TEXT[]
  ) THEN
    RAISE EXCEPTION 'OP v1 lifecycle does not match the normalized contract'
      USING ERRCODE = '22023';
  ELSIF target.workflow_kind = 'ozo' AND NOT (
    target.stage_keys = ARRAY[
      'intake',
      'profile_and_route',
      'documents',
      'applications',
      'decisions',
      'visa_and_predeparture',
      'arrival_and_adaptation',
      'completed',
      'closed'
    ]::TEXT[]
    AND target.follow_up_outcome_keys = ARRAY[]::TEXT[]
    AND target.closure_result_keys = ARRAY[]::TEXT[]
    AND target.terminal_stage_keys = ARRAY['completed', 'closed']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'OZO v1 lifecycle does not match the normalized contract'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.workflow_contract_version_sources AS link
    JOIN platform.source_registry AS source
      ON source.organization_id = link.organization_id
      AND source.id = link.source_registry_id
    WHERE link.organization_id = p_organization_id
      AND link.workflow_contract_version_id = p_workflow_contract_version_id
      AND source.review_status = 'reviewed'
  ) OR EXISTS (
    SELECT 1
    FROM platform.workflow_contract_version_sources AS link
    JOIN platform.source_registry AS source
      ON source.organization_id = link.organization_id
      AND source.id = link.source_registry_id
    WHERE link.organization_id = p_organization_id
      AND link.workflow_contract_version_id = p_workflow_contract_version_id
      AND source.review_status <> 'reviewed'
  ) THEN
    RAISE EXCEPTION 'Every approved workflow version needs reviewed provenance'
      USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.register_workflow_source(
  p_organization_id UUID,
  p_source_key TEXT,
  p_source_kind platform.workflow_source_kind,
  p_source_url TEXT,
  p_source_revision TEXT,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_reason TEXT;
  normalized_url TEXT := btrim(p_source_url);
  normalized_revision TEXT := NULLIF(btrim(p_source_revision), '');
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_source_key !~ '^src_[a-f0-9]{32,64}$'
    OR p_source_kind IS NULL
    OR NOT platform_private.is_safe_workflow_source_url(
      p_source_kind,
      normalized_url
    )
    OR (
      normalized_revision IS NOT NULL
      AND normalized_revision !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
    )
  THEN
    RAISE EXCEPTION 'A safe opaque workflow source is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'source_key', p_source_key,
    'source_kind', p_source_kind,
    'source_url', normalized_url,
    'source_revision', normalized_revision
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id,
    'workflow.source.register',
    'source_registry',
    normalized_reason,
    input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  INSERT INTO platform.source_registry (
    organization_id,
    source_key,
    source_kind,
    source_url,
    source_revision,
    created_by_membership_id
  ) VALUES (
    p_organization_id,
    p_source_key,
    p_source_kind,
    normalized_url,
    normalized_revision,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.source.register',
    'source_registry', created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'review_status', 'pending'
    ), normalized_reason, p_request_id
  );
  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_workflow_source(
  p_organization_id UUID,
  p_source_registry_id UUID,
  p_decision platform.workflow_source_review_status,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target platform.source_registry%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_source_registry_id IS NULL OR p_decision NOT IN ('reviewed', 'rejected') THEN
    RAISE EXCEPTION 'A reviewed or rejected source decision is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'source_registry_id', p_source_registry_id,
    'decision', p_decision
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.source.review', 'source_registry',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT * INTO target
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_registry_id
  FOR UPDATE;
  IF NOT FOUND OR target.review_status <> 'pending' THEN
    RAISE EXCEPTION 'A pending workflow source is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.source_registry
  SET review_status = p_decision,
      reviewed_by_membership_id = actor.actor_membership_id,
      reviewer_role = 'admin',
      reviewed_at = statement_timestamp()
  WHERE organization_id = p_organization_id AND id = p_source_registry_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.source.review',
    'source_registry', p_source_registry_id,
    jsonb_build_object('review_status', target.review_status),
    jsonb_build_object(
      'id', p_source_registry_id,
      'input_sha256', input_sha256,
      'review_status', p_decision
    ), normalized_reason, p_request_id
  );
  RETURN p_source_registry_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_workflow_source(
  p_organization_id UUID,
  p_source_registry_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target platform.source_registry%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'source_registry_id', p_source_registry_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.source.retire', 'source_registry',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT * INTO target
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_registry_id
  FOR UPDATE;
  IF NOT FOUND OR target.review_status <> 'reviewed' THEN
    RAISE EXCEPTION 'A reviewed workflow source is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.source_registry
  SET review_status = 'retired',
      retired_by_membership_id = actor.actor_membership_id,
      retired_at = statement_timestamp()
  WHERE organization_id = p_organization_id AND id = p_source_registry_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.source.retire',
    'source_registry', p_source_registry_id,
    jsonb_build_object('review_status', target.review_status),
    jsonb_build_object(
      'id', p_source_registry_id,
      'input_sha256', input_sha256,
      'review_status', 'retired'
    ), normalized_reason, p_request_id
  );
  RETURN p_source_registry_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_workflow_contract(
  p_organization_id UUID,
  p_contract_key TEXT,
  p_workflow_kind platform.workflow_kind,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_workflow_kind IS NULL
    OR p_contract_key IS DISTINCT FROM 'wf_' || p_workflow_kind::TEXT
  THEN
    RAISE EXCEPTION 'Contract key must match wf_op or wf_ozo'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_key', p_contract_key,
    'workflow_kind', p_workflow_kind
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.contract.create', 'workflow_contract',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  INSERT INTO platform.workflow_contracts (
    organization_id, contract_key, workflow_kind, created_by_membership_id
  ) VALUES (
    p_organization_id, p_contract_key, p_workflow_kind,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.contract.create',
    'workflow_contract', created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'contract_key', p_contract_key,
      'workflow_kind', p_workflow_kind
    ), normalized_reason, p_request_id
  );
  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_workflow_contract_version(
  p_organization_id UUID,
  p_workflow_contract_id UUID,
  p_version BIGINT,
  p_stage_keys TEXT[],
  p_follow_up_outcome_keys TEXT[],
  p_closure_result_keys TEXT[],
  p_terminal_stage_keys TEXT[],
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_version IS NULL OR p_version <= 0
    OR NOT platform_private.workflow_key_array_is_safe_unique(p_stage_keys, FALSE)
    OR NOT platform_private.workflow_key_array_is_safe_unique(
      p_follow_up_outcome_keys,
      TRUE
    )
    OR NOT platform_private.workflow_key_array_is_safe_unique(
      p_closure_result_keys,
      TRUE
    )
    OR NOT platform_private.workflow_key_array_is_safe_unique(
      p_terminal_stage_keys,
      TRUE
    )
    OR NOT p_terminal_stage_keys <@ p_stage_keys
  THEN
    RAISE EXCEPTION 'A bounded unique workflow definition is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'workflow_contract_id', p_workflow_contract_id,
    'version', p_version,
    'stage_keys', p_stage_keys,
    'follow_up_outcome_keys', p_follow_up_outcome_keys,
    'closure_result_keys', p_closure_result_keys,
    'terminal_stage_keys', p_terminal_stage_keys
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.version.create', 'workflow_contract_version',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  PERFORM 1
  FROM platform.workflow_contracts AS contract
  WHERE contract.organization_id = p_organization_id
    AND contract.id = p_workflow_contract_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A same-organization workflow contract is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_version <> COALESCE((
    SELECT MAX(version.version)
    FROM platform.workflow_contract_versions AS version
    WHERE version.organization_id = p_organization_id
      AND version.workflow_contract_id = p_workflow_contract_id
  ), 0) + 1 THEN
    RAISE EXCEPTION 'Workflow versions must be created sequentially'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.workflow_contract_versions (
    organization_id, workflow_contract_id, version, stage_keys,
    follow_up_outcome_keys, closure_result_keys, terminal_stage_keys,
    created_by_membership_id
  ) VALUES (
    p_organization_id, p_workflow_contract_id, p_version, p_stage_keys,
    p_follow_up_outcome_keys, p_closure_result_keys, p_terminal_stage_keys,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.version.create',
    'workflow_contract_version', created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'workflow_contract_id', p_workflow_contract_id,
      'version', p_version,
      'status', 'draft'
    ), normalized_reason, p_request_id
  );
  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.link_workflow_contract_version_source(
  p_organization_id UUID,
  p_workflow_contract_version_id UUID,
  p_source_registry_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  workflow_contract_id UUID;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'workflow_contract_version_id', p_workflow_contract_version_id,
    'source_registry_id', p_source_registry_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.source.link', 'workflow_contract_version_source',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT version.workflow_contract_id INTO workflow_contract_id
  FROM platform.workflow_contract_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_workflow_contract_version_id
    AND version.status = 'draft'
  FOR UPDATE;
  IF workflow_contract_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM platform.source_registry AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_registry_id
  ) THEN
    RAISE EXCEPTION 'A same-organization draft version and source are required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.workflow_contract_version_sources (
    organization_id, workflow_contract_id, workflow_contract_version_id,
    source_registry_id, created_by_membership_id
  ) VALUES (
    p_organization_id, workflow_contract_id,
    p_workflow_contract_version_id, p_source_registry_id,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.source.link',
    'workflow_contract_version_source', created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'workflow_contract_version_id', p_workflow_contract_version_id,
      'source_registry_id', p_source_registry_id
    ), normalized_reason, p_request_id
  );
  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.approve_workflow_contract_version(
  p_organization_id UUID,
  p_workflow_contract_version_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target platform.workflow_contract_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'workflow_contract_version_id', p_workflow_contract_version_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.version.approve', 'workflow_contract_version',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  PERFORM platform_private.assert_normalized_workflow_version(
    p_organization_id,
    p_workflow_contract_version_id
  );
  SELECT * INTO target
  FROM platform.workflow_contract_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_workflow_contract_version_id;

  UPDATE platform.workflow_contract_versions
  SET status = 'approved',
      approved_by_membership_id = actor.actor_membership_id,
      approved_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_workflow_contract_version_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.version.approve',
    'workflow_contract_version', p_workflow_contract_version_id,
    jsonb_build_object('status', target.status),
    jsonb_build_object(
      'id', p_workflow_contract_version_id,
      'input_sha256', input_sha256,
      'status', 'approved'
    ), normalized_reason, p_request_id
  );
  RETURN p_workflow_contract_version_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_workflow_contract_version(
  p_organization_id UUID,
  p_workflow_contract_version_id UUID,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target platform.workflow_contract_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  SELECT * INTO actor
  FROM platform_private.require_bw1_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw1_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'workflow_contract_version_id', p_workflow_contract_version_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id, 'workflow.version.retire', 'workflow_contract_version',
    normalized_reason, input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT * INTO target
  FROM platform.workflow_contract_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_workflow_contract_version_id
  FOR UPDATE;
  IF NOT FOUND OR target.status <> 'approved' THEN
    RAISE EXCEPTION 'An approved workflow version is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.workflow_contract_versions
  SET status = 'retired',
      retired_by_membership_id = actor.actor_membership_id,
      retired_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_workflow_contract_version_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT, 'workflow.version.retire',
    'workflow_contract_version', p_workflow_contract_version_id,
    jsonb_build_object('status', target.status),
    jsonb_build_object(
      'id', p_workflow_contract_version_id,
      'input_sha256', input_sha256,
      'status', 'retired'
    ), normalized_reason, p_request_id
  );
  RETURN p_workflow_contract_version_id;
END
$$;

REVOKE ALL ON TABLE
  platform.source_registry,
  platform.workflow_contracts,
  platform.workflow_contract_versions,
  platform.workflow_contract_version_sources
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.source_registry,
  platform.workflow_contracts,
  platform.workflow_contract_versions,
  platform.workflow_contract_version_sources
TO authenticated;

GRANT USAGE ON TYPE
  platform.workflow_kind,
  platform.workflow_source_kind,
  platform.workflow_source_review_status,
  platform.workflow_contract_version_status
TO authenticated;

REVOKE ALL ON FUNCTION
  platform_private.is_safe_workflow_source_url(
    platform.workflow_source_kind,
    TEXT
  ),
  platform_private.workflow_key_array_is_safe_unique(TEXT[], BOOLEAN),
  platform_private.guard_workflow_source_mutation(),
  platform_private.guard_workflow_version_mutation(),
  platform_private.guard_workflow_source_link_insert(),
  platform_private.lock_bw1_request(UUID),
  platform_private.require_bw1_admin_actor(UUID),
  platform_private.bw1_input_sha256(JSONB),
  platform_private.bw1_replay_uuid(UUID, TEXT, TEXT, TEXT, TEXT),
  platform_private.validate_bw1_reason(TEXT),
  platform_private.assert_normalized_workflow_version(UUID, UUID),
  private.platform_can_manage_workflow_contracts(UUID),
  private.platform_can_read_workflow_contracts(UUID),
  private.platform_can_read_workflow_source(UUID, UUID),
  private.platform_can_read_workflow_version(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  private.platform_can_manage_workflow_contracts(UUID),
  private.platform_can_read_workflow_contracts(UUID),
  private.platform_can_read_workflow_source(UUID, UUID),
  private.platform_can_read_workflow_version(UUID, UUID)
TO authenticated;

REVOKE ALL ON FUNCTION
  platform.register_workflow_source(
    UUID,
    TEXT,
    platform.workflow_source_kind,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.review_workflow_source(
    UUID,
    UUID,
    platform.workflow_source_review_status,
    TEXT,
    UUID
  ),
  platform.retire_workflow_source(UUID, UUID, TEXT, UUID),
  platform.create_workflow_contract(
    UUID,
    TEXT,
    platform.workflow_kind,
    TEXT,
    UUID
  ),
  platform.create_workflow_contract_version(
    UUID,
    UUID,
    BIGINT,
    TEXT[],
    TEXT[],
    TEXT[],
    TEXT[],
    TEXT,
    UUID
  ),
  platform.link_workflow_contract_version_source(
    UUID,
    UUID,
    UUID,
    TEXT,
    UUID
  ),
  platform.approve_workflow_contract_version(UUID, UUID, TEXT, UUID),
  platform.retire_workflow_contract_version(UUID, UUID, TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.register_workflow_source(
    UUID,
    TEXT,
    platform.workflow_source_kind,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.review_workflow_source(
    UUID,
    UUID,
    platform.workflow_source_review_status,
    TEXT,
    UUID
  ),
  platform.retire_workflow_source(UUID, UUID, TEXT, UUID),
  platform.create_workflow_contract(
    UUID,
    TEXT,
    platform.workflow_kind,
    TEXT,
    UUID
  ),
  platform.create_workflow_contract_version(
    UUID,
    UUID,
    BIGINT,
    TEXT[],
    TEXT[],
    TEXT[],
    TEXT[],
    TEXT,
    UUID
  ),
  platform.link_workflow_contract_version_source(
    UUID,
    UUID,
    UUID,
    TEXT,
    UUID
  ),
  platform.approve_workflow_contract_version(UUID, UUID, TEXT, UUID),
  platform.retire_workflow_contract_version(UUID, UUID, TEXT, UUID)
TO authenticated;

COMMENT ON TABLE platform.source_registry IS
  'PII-free workflow provenance: opaque key, constrained canonical provider URL, optional opaque revision and Admin review metadata.';
COMMENT ON TABLE platform.workflow_contracts IS
  'Organization-scoped OP/OZO contract identity. Definitions are append-only versions.';
COMMENT ON TABLE platform.workflow_contract_versions IS
  'Immutable normalized OP/OZO lifecycle version; at most one approved version exists per contract.';
COMMENT ON TABLE platform.workflow_contract_version_sources IS
  'Append-only provenance links created while the workflow version is draft.';

COMMIT;
