-- ============================================================
-- 053_platform_student_profile_requirements.sql
--
-- BW3: minimized Student Profile plus immutable, source-reviewed country
-- requirement versions that instantiate the existing document-slot model.
--
-- This migration is Supabase-native and additive. It does not import legacy
-- SQLite data, seed country content, create a parallel checklist/document
-- model, or contact any provider or production service.
-- ============================================================

BEGIN;

CREATE TYPE platform.student_profile_consent_status AS ENUM (
  'not_recorded',
  'granted',
  'withdrawn'
);

CREATE TYPE platform.student_profile_field AS ENUM (
  'preferred_display_name',
  'legal_display_name',
  'communication_language',
  'date_of_birth',
  'citizenship_country',
  'residency_country',
  'current_education_summary',
  'academic_summary',
  'language_summary',
  'budget_band',
  'decision_participant_labels',
  'consent_status',
  'consent_evidence_ref',
  'next_step'
);

CREATE TYPE platform.country_requirement_version_status AS ENUM (
  'draft',
  'approved',
  'retired'
);

CREATE OR REPLACE FUNCTION platform_private.student_profile_fields_are_bounded(
  p_fields platform.student_profile_field[]
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_fields IS NOT NULL
    AND cardinality(p_fields) <= 14
    AND cardinality(p_fields) = (
      SELECT count(DISTINCT field_name)
      FROM unnest(p_fields) AS field_name
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.student_profile_labels_are_bounded(
  p_labels TEXT[]
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_labels IS NOT NULL
    AND cardinality(p_labels) <= 12
    AND cardinality(p_labels) = (
      SELECT count(DISTINCT label)
      FROM unnest(p_labels) AS label
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_labels) AS label
      WHERE label IS NULL
        OR btrim(label) = ''
        OR length(btrim(label)) > 120
        OR btrim(label) ~ '[[:cntrl:]]'
        OR label <> btrim(label)
    )
$$;

REVOKE ALL ON FUNCTION
  platform_private.student_profile_fields_are_bounded(
    platform.student_profile_field[]
  ),
  platform_private.student_profile_labels_are_bounded(TEXT[])
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TABLE platform.student_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  preferred_display_name TEXT NOT NULL CHECK (
    length(btrim(preferred_display_name)) BETWEEN 1 AND 160
    AND preferred_display_name = btrim(preferred_display_name)
    AND preferred_display_name !~ '[[:cntrl:]]'
  ),
  legal_display_name TEXT CHECK (
    legal_display_name IS NULL
    OR (
      length(btrim(legal_display_name)) BETWEEN 1 AND 200
      AND legal_display_name = btrim(legal_display_name)
      AND legal_display_name !~ '[[:cntrl:]]'
    )
  ),
  communication_language TEXT NOT NULL CHECK (
    communication_language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  ),
  date_of_birth DATE CHECK (
    date_of_birth IS NULL
    OR date_of_birth BETWEEN DATE '1900-01-01' AND DATE '2099-12-31'
  ),
  citizenship_country TEXT NOT NULL CHECK (
    length(btrim(citizenship_country)) BETWEEN 1 AND 120
    AND citizenship_country = btrim(citizenship_country)
    AND citizenship_country !~ '[[:cntrl:]]'
  ),
  residency_country TEXT NOT NULL CHECK (
    length(btrim(residency_country)) BETWEEN 1 AND 120
    AND residency_country = btrim(residency_country)
    AND residency_country !~ '[[:cntrl:]]'
  ),
  current_education_summary TEXT NOT NULL CHECK (
    length(btrim(current_education_summary)) BETWEEN 1 AND 2000
    AND current_education_summary = btrim(current_education_summary)
    AND current_education_summary !~ '[[:cntrl:]]'
  ),
  academic_summary TEXT NOT NULL CHECK (
    length(btrim(academic_summary)) BETWEEN 1 AND 2000
    AND academic_summary = btrim(academic_summary)
    AND academic_summary !~ '[[:cntrl:]]'
  ),
  language_summary TEXT NOT NULL CHECK (
    length(btrim(language_summary)) BETWEEN 1 AND 2000
    AND language_summary = btrim(language_summary)
    AND language_summary !~ '[[:cntrl:]]'
  ),
  budget_band TEXT NOT NULL CHECK (
    length(btrim(budget_band)) BETWEEN 1 AND 120
    AND budget_band = btrim(budget_band)
    AND budget_band !~ '[[:cntrl:]]'
  ),
  decision_participant_labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (
      platform_private.student_profile_labels_are_bounded(
        decision_participant_labels
      )
    ),
  consent_status platform.student_profile_consent_status NOT NULL,
  consent_evidence_ref TEXT CHECK (
    consent_evidence_ref IS NULL
    OR (
      length(btrim(consent_evidence_ref)) BETWEEN 1 AND 512
      AND consent_evidence_ref = btrim(consent_evidence_ref)
      AND consent_evidence_ref !~ '[[:cntrl:]]'
    )
  ),
  next_step TEXT NOT NULL CHECK (
    length(btrim(next_step)) BETWEEN 1 AND 1000
    AND next_step = btrim(next_step)
    AND next_step !~ '[[:cntrl:]]'
  ),
  created_by_membership_id UUID NOT NULL,
  updated_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profiles_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_profiles_organization_case_key
    UNIQUE (organization_id, student_case_id),
  CONSTRAINT student_profiles_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profiles_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profiles_updated_by_fkey
    FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profiles_consent_shape_check CHECK (
    (consent_status = 'not_recorded' AND consent_evidence_ref IS NULL)
    OR (
      consent_status IN ('granted', 'withdrawn')
      AND consent_evidence_ref IS NOT NULL
    )
  )
);

CREATE TABLE platform.country_requirement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  target_country TEXT NOT NULL CHECK (
    length(btrim(target_country)) BETWEEN 1 AND 120
    AND target_country = btrim(target_country)
    AND target_country !~ '[[:cntrl:]]'
  ),
  target_degree TEXT NOT NULL CHECK (
    length(btrim(target_degree)) BETWEEN 1 AND 160
    AND target_degree = btrim(target_degree)
    AND target_degree !~ '[[:cntrl:]]'
  ),
  program_direction TEXT NOT NULL CHECK (
    length(btrim(program_direction)) BETWEEN 1 AND 200
    AND program_direction = btrim(program_direction)
    AND program_direction !~ '[[:cntrl:]]'
  ),
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.country_requirement_version_status NOT NULL DEFAULT 'draft',
  required_profile_fields platform.student_profile_field[] NOT NULL
    DEFAULT ARRAY[]::platform.student_profile_field[]
    CHECK (
      platform_private.student_profile_fields_are_bounded(
        required_profile_fields
      )
    ),
  created_by_membership_id UUID NOT NULL,
  approved_by_membership_id UUID,
  approved_at TIMESTAMPTZ,
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT country_requirement_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT country_requirement_versions_route_version_key UNIQUE (
    organization_id,
    target_country,
    target_degree,
    program_direction,
    version
  ),
  CONSTRAINT country_requirement_versions_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT country_requirement_versions_approved_by_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT country_requirement_versions_retired_by_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT country_requirement_versions_status_metadata_check CHECK (
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

CREATE TABLE platform.country_requirement_version_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  country_requirement_version_id UUID NOT NULL,
  source_registry_id UUID NOT NULL,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT country_requirement_version_sources_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT country_requirement_version_sources_version_source_key
    UNIQUE (
      organization_id,
      country_requirement_version_id,
      source_registry_id
    ),
  CONSTRAINT country_requirement_version_sources_version_fkey
    FOREIGN KEY (organization_id, country_requirement_version_id)
    REFERENCES platform.country_requirement_versions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT country_requirement_version_sources_source_fkey
    FOREIGN KEY (organization_id, source_registry_id)
    REFERENCES platform.source_registry(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT country_requirement_version_sources_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE platform.student_cases
  ADD COLUMN applied_country_requirement_version_id UUID;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_applied_country_requirement_version_fkey
  FOREIGN KEY (
    organization_id,
    applied_country_requirement_version_id
  )
  REFERENCES platform.country_requirement_versions(organization_id, id)
  ON DELETE RESTRICT;

ALTER TABLE platform.student_cases
  ADD CONSTRAINT student_cases_org_id_applied_country_requirement_key
  UNIQUE (
    organization_id,
    id,
    applied_country_requirement_version_id
  );

CREATE INDEX student_profiles_case_revision_idx
  ON platform.student_profiles (organization_id, student_case_id, revision);
CREATE INDEX country_requirement_versions_route_status_idx
  ON platform.country_requirement_versions (
    organization_id,
    target_country,
    target_degree,
    program_direction,
    status,
    version DESC
  );
CREATE INDEX country_requirement_version_sources_source_idx
  ON platform.country_requirement_version_sources (
    organization_id,
    source_registry_id
  );
CREATE INDEX student_cases_applied_country_requirement_idx
  ON platform.student_cases (
    organization_id,
    applied_country_requirement_version_id
  )
  WHERE applied_country_requirement_version_id IS NOT NULL;

ALTER TABLE platform.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.country_requirement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.country_requirement_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.country_requirement_version_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.country_requirement_version_sources FORCE ROW LEVEL SECURITY;

-- Profile identities are immutable and revision increments are explicit.
CREATE OR REPLACE FUNCTION platform_private.guard_student_profile_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Student Profiles are append-preserved'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.created_by_membership_id <> OLD.created_by_membership_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.revision <> OLD.revision + 1
    OR NEW.updated_by_membership_id IS NULL
    OR NEW.updated_at <= OLD.updated_at
  THEN
    RAISE EXCEPTION 'Student Profile identity or revision is invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_country_requirement_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Country requirement versions are append-preserved'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.target_country <> OLD.target_country
    OR NEW.target_degree <> OLD.target_degree
    OR NEW.program_direction <> OLD.program_direction
    OR NEW.version <> OLD.version
    OR NEW.required_profile_fields <> OLD.required_profile_fields
    OR NEW.created_by_membership_id <> OLD.created_by_membership_id
    OR NEW.created_at <> OLD.created_at
    OR OLD.status = 'retired'
    OR (
      OLD.status = 'approved'
      AND (
        NEW.approved_by_membership_id
          IS DISTINCT FROM OLD.approved_by_membership_id
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      )
    )
    OR NOT (
      (OLD.status = 'draft' AND NEW.status = 'approved')
      OR (OLD.status = 'approved' AND NEW.status = 'retired')
    )
  THEN
    RAISE EXCEPTION 'Country requirement version transition is immutable or invalid'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_country_requirement_source_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform.country_requirement_versions AS version
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.country_requirement_version_id
      AND version.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Country requirement sources may link only to a draft version'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.source_registry AS source
    WHERE source.organization_id = NEW.organization_id
      AND source.id = NEW.source_registry_id
      AND source.review_status = 'reviewed'
  ) THEN
    RAISE EXCEPTION 'A reviewed same-organization source is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_student_case_country_requirement_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.applied_country_requirement_version_id IS NOT NULL THEN
    IF NEW.applied_country_requirement_version_id
      IS DISTINCT FROM OLD.applied_country_requirement_version_id
    THEN
      RAISE EXCEPTION 'Applied country requirement version is immutable'
        USING ERRCODE = '55000';
    END IF;
    -- A historical binding remains valid after its source version is retired.
    RETURN NEW;
  END IF;

  IF NEW.applied_country_requirement_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.country_requirement_versions AS version
    WHERE version.organization_id = NEW.organization_id
      AND version.id = NEW.applied_country_requirement_version_id
      AND version.status = 'approved'
      AND version.target_country = NEW.target_country
      AND version.target_degree = NEW.target_degree
      AND version.program_direction IS NOT DISTINCT FROM NEW.program_direction
  ) THEN
    RAISE EXCEPTION 'Only an approved exact-route country requirement version may be applied'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bound_document_requirement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_is_frozen BOOLEAN := FALSE;
  new_is_frozen BOOLEAN := FALSE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_is_frozen := EXISTS (
      SELECT 1
      FROM platform.country_requirement_versions AS version
      WHERE version.organization_id = OLD.organization_id
        AND version.target_country = OLD.target_country
        AND version.target_degree = OLD.target_degree
        AND version.program_direction = OLD.program_direction
        AND version.version = OLD.checklist_version
        AND version.status IN ('approved', 'retired')
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_is_frozen := EXISTS (
      SELECT 1
      FROM platform.country_requirement_versions AS version
      WHERE version.organization_id = NEW.organization_id
        AND version.target_country = NEW.target_country
        AND version.target_degree = NEW.target_degree
        AND version.program_direction = NEW.program_direction
        AND version.version = NEW.checklist_version
        AND version.status IN ('approved', 'retired')
    );
  END IF;

  IF old_is_frozen OR new_is_frozen THEN
    RAISE EXCEPTION 'Document requirements of an approved manifest are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.guard_student_profile_mutation(),
  platform_private.guard_country_requirement_version_mutation(),
  platform_private.guard_country_requirement_source_link(),
  platform_private.guard_student_case_country_requirement_binding(),
  platform_private.guard_bound_document_requirement_mutation()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER student_profiles_revision_guard
  BEFORE UPDATE OR DELETE ON platform.student_profiles
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_profile_mutation();
CREATE TRIGGER student_profiles_no_truncate
  BEFORE TRUNCATE ON platform.student_profiles
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER country_requirement_versions_transition_guard
  BEFORE UPDATE OR DELETE ON platform.country_requirement_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_country_requirement_version_mutation();
CREATE TRIGGER country_requirement_versions_no_truncate
  BEFORE TRUNCATE ON platform.country_requirement_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER country_requirement_version_sources_draft_insert_guard
  BEFORE INSERT ON platform.country_requirement_version_sources
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_country_requirement_source_link();
CREATE TRIGGER country_requirement_version_sources_append_only
  BEFORE UPDATE OR DELETE ON platform.country_requirement_version_sources
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER country_requirement_version_sources_no_truncate
  BEFORE TRUNCATE ON platform.country_requirement_version_sources
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_cases_country_requirement_binding_guard
  BEFORE UPDATE ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_student_case_country_requirement_binding();
CREATE TRIGGER document_requirements_approved_manifest_guard
  BEFORE INSERT OR UPDATE OR DELETE ON platform.document_requirements
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_bound_document_requirement_mutation();

-- Immutable v8 bundles clone v7 and add only BW3 permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('profile.read.full', 'Read a full Student Profile for an authorized case'),
  ('profile.manage', 'Create or revise a Student Profile for an authorized case'),
  ('country.requirement.manage', 'Author and publish country requirement versions');

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000000701', 'admin', 8, 'draft', 'Admin v8 Student Profile requirements'),
  ('00000000-0000-4000-8000-000000000702', 'sales', 8, 'draft', 'Sales v8 Student Profile requirements'),
  ('00000000-0000-4000-8000-000000000703', 'curator', 8, 'draft', 'Curator v8 Student Profile requirements'),
  ('00000000-0000-4000-8000-000000000704', 'finance', 8, 'draft', 'Finance v8 Student Profile requirements'),
  ('00000000-0000-4000-8000-000000000705', 'student', 8, 'draft', 'Student v8 Student Profile requirements');

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v8.id, v8.role, v7_permission.permission_key
FROM platform.role_bundle_versions AS v8
JOIN platform.role_bundle_versions AS v7
  ON v7.role = v8.role
  AND v7.version = 7
  AND v7.status = 'published'
JOIN platform.role_bundle_permissions AS v7_permission
  ON v7_permission.bundle_id = v7.id
  AND v7_permission.bundle_role = v7.role
WHERE v8.version = 8;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 8
  AND (
    (
      bundle.role = 'admin'
      AND permission.permission_key IN (
        'profile.read.full',
        'profile.manage',
        'country.requirement.manage'
      )
    )
    OR (
      bundle.role IN ('sales', 'curator')
      AND permission.permission_key IN ('profile.read.full', 'profile.manage')
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 8;

CREATE TEMPORARY TABLE bw3_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v8.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v7
  ON v7.id = membership.current_bundle_id
  AND v7.role = membership."current_role"
  AND v7.version = 7
  AND v7.status = 'published'
JOIN platform.role_bundle_versions AS v8
  ON v8.role = membership."current_role"
  AND v8.version = 8
  AND v8.status = 'published'
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
  'BW3 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw3_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw3_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM bw3_membership_bundle_upgrades AS upgrade
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
  'migration:053_platform_student_profile_requirements',
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
  'BW3 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw3_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_bw3_request(p_request_id UUID)
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
    hashtextextended('evo:bw3:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw3_admin_actor(
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
      'country.requirement.manage'
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

CREATE OR REPLACE FUNCTION platform_private.bw3_replay_jsonb(
  p_request_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_reason TEXT,
  p_input_sha256 TEXT
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT platform_private.replay_audit(
    p_request_id,
    p_action,
    p_resource_type,
    NULL,
    p_reason,
    jsonb_build_object('input_sha256', p_input_sha256)
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.lock_bw3_request(UUID),
  platform_private.require_bw3_admin_actor(UUID),
  platform_private.bw3_replay_jsonb(UUID, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE POLICY student_profiles_read
  ON platform.student_profiles
  FOR SELECT
  TO authenticated
  USING (
    (
      (SELECT private.platform_has_permission(
        organization_id,
        'profile.read.full'
      ))
      AND (SELECT private.platform_can_read_student_case(
        organization_id,
        student_case_id
      ))
    )
    OR (
      (SELECT private.platform_has_permission(
        organization_id,
        'profile.read.self'
      ))
      AND (SELECT private.platform_can_read_student_portal_case(
        organization_id,
        student_case_id
      ))
    )
  );

CREATE POLICY country_requirement_versions_admin_read
  ON platform.country_requirement_versions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'country.requirement.manage'
    ))
    AND (SELECT private.platform_has_scope(
      organization_id,
      'organization',
      organization_id
    ))
  );

CREATE POLICY country_requirement_version_sources_admin_read
  ON platform.country_requirement_version_sources
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'country.requirement.manage'
    ))
    AND (SELECT private.platform_has_scope(
      organization_id,
      'organization',
      organization_id
    ))
  );

-- P2D's portal helper is also used by the new base-table SELECT policy. Its
-- BOOLEAN result is already fail-closed and case-scoped; authenticated needs
-- EXECUTE for PostgreSQL to evaluate that RLS branch.
GRANT EXECUTE
  ON FUNCTION private.platform_can_read_student_portal_case(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform.create_country_requirement_version(
  p_organization_id UUID,
  p_target_country TEXT,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_version BIGINT,
  p_required_profile_fields platform.student_profile_field[],
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
  normalized_country TEXT := btrim(p_target_country);
  normalized_degree TEXT := btrim(p_target_degree);
  normalized_program TEXT := btrim(p_program_direction);
  normalized_fields platform.student_profile_field[];
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  SELECT array_agg(field_name ORDER BY field_name::TEXT)
  INTO normalized_fields
  FROM unnest(p_required_profile_fields) AS field_name;
  normalized_fields := COALESCE(
    normalized_fields,
    ARRAY[]::platform.student_profile_field[]
  );

  IF p_organization_id IS NULL
    OR normalized_country IS NULL
    OR length(normalized_country) NOT BETWEEN 1 AND 120
    OR normalized_degree IS NULL
    OR length(normalized_degree) NOT BETWEEN 1 AND 160
    OR normalized_program IS NULL
    OR length(normalized_program) NOT BETWEEN 1 AND 200
    OR p_version IS NULL
    OR p_version <= 0
    OR p_required_profile_fields IS NULL
    OR NOT platform_private.student_profile_fields_are_bounded(
      p_required_profile_fields
    )
  THEN
    RAISE EXCEPTION 'A complete bounded country requirement version is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw3:route:' || p_organization_id::TEXT || ':' ||
      normalized_country || ':' || normalized_degree || ':' ||
      normalized_program,
    0
  ));

  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'target_country', normalized_country,
    'target_degree', normalized_degree,
    'program_direction', normalized_program,
    'version', p_version,
    'required_profile_fields', normalized_fields
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id,
    'country.requirement.version.create',
    'country_requirement_version',
    normalized_reason,
    input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  IF p_version <> COALESCE((
    SELECT MAX(version.version) + 1
    FROM platform.country_requirement_versions AS version
    WHERE version.organization_id = p_organization_id
      AND version.target_country = normalized_country
      AND version.target_degree = normalized_degree
      AND version.program_direction = normalized_program
  ), 1) THEN
    RAISE EXCEPTION 'Country requirement versions must be created sequentially'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.country_requirement_versions (
    organization_id,
    target_country,
    target_degree,
    program_direction,
    version,
    required_profile_fields,
    created_by_membership_id
  ) VALUES (
    p_organization_id,
    normalized_country,
    normalized_degree,
    normalized_program,
    p_version,
    normalized_fields,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.version.create', 'country_requirement_version',
    created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'target_country', normalized_country,
      'target_degree', normalized_degree,
      'program_direction', normalized_program,
      'version', p_version,
      'required_profile_fields', normalized_fields,
      'status', 'draft'
    ),
    normalized_reason, p_request_id
  );

  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.link_country_requirement_version_source(
  p_organization_id UUID,
  p_country_requirement_version_id UUID,
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
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
  created_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_country_requirement_version_id IS NULL
    OR p_source_registry_id IS NULL
  THEN
    RAISE EXCEPTION 'Version and reviewed source are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'country_requirement_version_id', p_country_requirement_version_id,
    'source_registry_id', p_source_registry_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id,
    'country.requirement.source.link',
    'country_requirement_version_source',
    normalized_reason,
    input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.country_requirement_versions AS version
    WHERE version.organization_id = p_organization_id
      AND version.id = p_country_requirement_version_id
      AND version.status = 'draft'
    FOR UPDATE
  ) OR NOT EXISTS (
    SELECT 1
    FROM platform.source_registry AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = p_source_registry_id
      AND source.review_status = 'reviewed'
  ) THEN
    RAISE EXCEPTION 'A same-organization draft version and reviewed source are required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.country_requirement_version_sources (
    organization_id,
    country_requirement_version_id,
    source_registry_id,
    created_by_membership_id
  ) VALUES (
    p_organization_id,
    p_country_requirement_version_id,
    p_source_registry_id,
    actor.actor_membership_id
  ) RETURNING id INTO created_id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.source.link',
    'country_requirement_version_source', created_id, NULL,
    jsonb_build_object(
      'id', created_id,
      'input_sha256', input_sha256,
      'country_requirement_version_id', p_country_requirement_version_id,
      'source_registry_id', p_source_registry_id
    ),
    normalized_reason, p_request_id
  );

  RETURN created_id;
END
$$;

CREATE OR REPLACE FUNCTION platform.approve_country_requirement_version(
  p_organization_id UUID,
  p_country_requirement_version_id UUID,
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
  target platform.country_requirement_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL OR p_country_requirement_version_id IS NULL THEN
    RAISE EXCEPTION 'Country requirement version is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'country_requirement_version_id', p_country_requirement_version_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id,
    'country.requirement.version.approve',
    'country_requirement_version',
    normalized_reason,
    input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT * INTO target
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_country_requirement_version_id
  FOR UPDATE;

  IF NOT FOUND OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'A draft country requirement version is required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.country_requirement_version_sources AS link
    JOIN platform.source_registry AS source
      ON source.organization_id = link.organization_id
      AND source.id = link.source_registry_id
    WHERE link.organization_id = p_organization_id
      AND link.country_requirement_version_id = target.id
      AND source.review_status = 'reviewed'
  ) OR EXISTS (
    SELECT 1
    FROM platform.country_requirement_version_sources AS link
    JOIN platform.source_registry AS source
      ON source.organization_id = link.organization_id
      AND source.id = link.source_registry_id
    WHERE link.organization_id = p_organization_id
      AND link.country_requirement_version_id = target.id
      AND source.review_status <> 'reviewed'
  ) THEN
    RAISE EXCEPTION 'Every approved country requirement needs reviewed provenance'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.document_requirements AS requirement
    WHERE requirement.organization_id = target.organization_id
      AND requirement.target_country = target.target_country
      AND requirement.target_degree = target.target_degree
      AND requirement.program_direction IS NOT DISTINCT FROM
        target.program_direction
      AND requirement.checklist_version = target.version
      AND requirement.status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active exact-version document requirement is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.country_requirement_versions AS version
  SET status = 'approved',
      approved_by_membership_id = actor.actor_membership_id,
      approved_at = statement_timestamp()
  WHERE version.organization_id = p_organization_id
    AND version.id = target.id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.version.approve', 'country_requirement_version',
    target.id, jsonb_build_object('status', target.status),
    jsonb_build_object(
      'id', target.id,
      'input_sha256', input_sha256,
      'status', 'approved'
    ),
    normalized_reason, p_request_id
  );

  RETURN target.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_country_requirement_version(
  p_organization_id UUID,
  p_country_requirement_version_id UUID,
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
  target platform.country_requirement_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed_id UUID;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL OR p_country_requirement_version_id IS NULL THEN
    RAISE EXCEPTION 'Country requirement version is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'country_requirement_version_id', p_country_requirement_version_id
  ));
  replayed_id := platform_private.bw1_replay_uuid(
    p_request_id,
    'country.requirement.version.retire',
    'country_requirement_version',
    normalized_reason,
    input_sha256
  );
  IF replayed_id IS NOT NULL THEN RETURN replayed_id; END IF;

  SELECT * INTO target
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_country_requirement_version_id
  FOR UPDATE;

  IF NOT FOUND OR target.status <> 'approved' THEN
    RAISE EXCEPTION 'An approved country requirement version is required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.country_requirement_versions AS version
  SET status = 'retired',
      retired_by_membership_id = actor.actor_membership_id,
      retired_at = statement_timestamp()
  WHERE version.organization_id = p_organization_id
    AND version.id = target.id;

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.version.retire', 'country_requirement_version',
    target.id, jsonb_build_object('status', target.status),
    jsonb_build_object(
      'id', target.id,
      'input_sha256', input_sha256,
      'status', 'retired'
    ),
    normalized_reason, p_request_id
  );

  RETURN target.id;
END
$$;

CREATE OR REPLACE FUNCTION platform.apply_country_requirement_version(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_country_requirement_version_id UUID,
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
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  target_version platform.country_requirement_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  requirement_count BIGINT;
  slot_count BIGINT;
  result JSONB;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_country_requirement_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Organization, case and country requirement version are required'
      USING ERRCODE = '22023';
  END IF;

  -- The binding is immutable and changes which profile fields and document
  -- slots govern the case, so it stays Admin-only even though Sales and
  -- Curator may update a profile after the binding exists.
  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'country_requirement_version_id', p_country_requirement_version_id
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id,
    'country.requirement.apply',
    'student_case',
    normalized_reason,
    input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO target_version
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_country_requirement_version_id
  FOR UPDATE;

  -- Re-check live authority after locking the case/version so a concurrent
  -- role or membership change cannot complete the irreversible binding.
  SELECT * INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id);
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id,
    'country.requirement.apply',
    'student_case',
    normalized_reason,
    input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  IF target_case.applied_country_requirement_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Student case already has an immutable country requirement binding'
      USING ERRCODE = '55000';
  END IF;

  IF target_version.id IS NULL
    OR target_version.status <> 'approved'
    OR target_version.target_country <> target_case.target_country
    OR target_version.target_degree <> target_case.target_degree
    OR target_version.program_direction IS DISTINCT FROM
      target_case.program_direction
  THEN
    RAISE EXCEPTION 'Approved country requirement version must match the case route'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO requirement_count
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version
    AND requirement.status = 'active';

  IF requirement_count = 0 THEN
    RAISE EXCEPTION 'Approved country requirement has no active document requirements'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform.document_slots (
    organization_id,
    student_case_id,
    requirement_id,
    status,
    deadline,
    next_action,
    created_by_membership_id
  )
  SELECT
    p_organization_id,
    p_student_case_id,
    requirement.id,
    'required',
    NULL,
    NULL,
    actor.actor_membership_id
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version
    AND requirement.status = 'active'
  ON CONFLICT (organization_id, student_case_id, requirement_id) DO NOTHING;

  SELECT count(*) INTO slot_count
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  WHERE slot.organization_id = p_organization_id
    AND slot.student_case_id = p_student_case_id
    AND requirement.target_country = target_version.target_country
    AND requirement.target_degree = target_version.target_degree
    AND requirement.program_direction IS NOT DISTINCT FROM
      target_version.program_direction
    AND requirement.checklist_version = target_version.version;

  IF slot_count <> requirement_count THEN
    RAISE EXCEPTION 'Country requirement slot instantiation is incomplete'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.student_cases AS student_case
  SET applied_country_requirement_version_id = target_version.id
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
    AND student_case.applied_country_requirement_version_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Country requirement binding changed concurrently'
      USING ERRCODE = '55000';
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'country_requirement_version_id', target_version.id,
    'version', target_version.version,
    'document_slot_count', slot_count,
    'input_sha256', input_sha256
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.apply', 'student_case', p_student_case_id,
    jsonb_build_object('applied_country_requirement_version_id', NULL),
    result, normalized_reason, p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.upsert_student_profile(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_expected_revision BIGINT,
  p_preferred_display_name TEXT,
  p_legal_display_name TEXT,
  p_date_of_birth DATE,
  p_communication_language TEXT,
  p_citizenship_country TEXT,
  p_residency_country TEXT,
  p_current_education_summary TEXT,
  p_academic_summary TEXT,
  p_language_summary TEXT,
  p_budget_band TEXT,
  p_decision_participant_labels TEXT[],
  p_consent_status platform.student_profile_consent_status,
  p_consent_evidence_ref TEXT,
  p_next_step TEXT,
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
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  target_version platform.country_requirement_versions%ROWTYPE;
  current_profile platform.student_profiles%ROWTYPE;
  normalized_reason TEXT;
  preferred_name TEXT := btrim(p_preferred_display_name);
  legal_name TEXT := NULLIF(btrim(p_legal_display_name), '');
  communication_language_value TEXT := btrim(p_communication_language);
  citizenship_value TEXT := btrim(p_citizenship_country);
  residency_value TEXT := btrim(p_residency_country);
  education_value TEXT := btrim(p_current_education_summary);
  academic_value TEXT := btrim(p_academic_summary);
  language_value TEXT := btrim(p_language_summary);
  budget_value TEXT := btrim(p_budget_band);
  consent_ref TEXT := NULLIF(btrim(p_consent_evidence_ref), '');
  next_step_value TEXT := btrim(p_next_step);
  normalized_labels TEXT[];
  input_sha256 TEXT;
  replayed JSONB;
  profile_id UUID;
  next_revision BIGINT;
  updated_fields TEXT[];
  result JSONB;
BEGIN
  normalized_reason := platform_private.validate_bw1_reason(p_reason);
  IF p_decision_participant_labels IS NOT NULL THEN
    SELECT COALESCE(array_agg(btrim(label) ORDER BY ordinal), ARRAY[]::TEXT[])
    INTO normalized_labels
    FROM unnest(p_decision_participant_labels) WITH ORDINALITY
      AS labels(label, ordinal);
  END IF;

  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR preferred_name IS NULL
    OR length(preferred_name) NOT BETWEEN 1 AND 160
    OR communication_language_value IS NULL
    OR communication_language_value !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    OR citizenship_value IS NULL
    OR length(citizenship_value) NOT BETWEEN 1 AND 120
    OR residency_value IS NULL
    OR length(residency_value) NOT BETWEEN 1 AND 120
    OR education_value IS NULL
    OR length(education_value) NOT BETWEEN 1 AND 2000
    OR academic_value IS NULL
    OR length(academic_value) NOT BETWEEN 1 AND 2000
    OR language_value IS NULL
    OR length(language_value) NOT BETWEEN 1 AND 2000
    OR budget_value IS NULL
    OR length(budget_value) NOT BETWEEN 1 AND 120
    OR p_decision_participant_labels IS NULL
    OR NOT platform_private.student_profile_labels_are_bounded(
      normalized_labels
    )
    OR p_consent_status IS NULL
    OR (p_consent_status = 'not_recorded' AND consent_ref IS NOT NULL)
    OR (p_consent_status IN ('granted', 'withdrawn') AND consent_ref IS NULL)
    OR (consent_ref IS NOT NULL AND length(consent_ref) > 512)
    OR next_step_value IS NULL
    OR length(next_step_value) NOT BETWEEN 1 AND 1000
    OR (legal_name IS NOT NULL AND length(legal_name) > 200)
    OR (p_date_of_birth IS NOT NULL AND p_date_of_birth > current_date)
    OR (p_date_of_birth IS NOT NULL AND p_date_of_birth < DATE '1900-01-01')
  THEN
    RAISE EXCEPTION 'A complete bounded Student Profile payload is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'profile.manage'
  );
  PERFORM platform_private.lock_bw3_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'expected_revision', p_expected_revision,
    'preferred_display_name', preferred_name,
    'legal_display_name', legal_name,
    'date_of_birth', p_date_of_birth,
    'communication_language', communication_language_value,
    'citizenship_country', citizenship_value,
    'residency_country', residency_value,
    'current_education_summary', education_value,
    'academic_summary', academic_value,
    'language_summary', language_value,
    'budget_band', budget_value,
    'decision_participant_labels', normalized_labels,
    'consent_status', p_consent_status,
    'consent_evidence_ref', consent_ref,
    'next_step', next_step_value
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id,
    'student.profile.upsert',
    'student_profile',
    normalized_reason,
    input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'profile.manage'
  );

  SELECT * INTO target_version
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = target_case.applied_country_requirement_version_id
    AND version.status IN ('approved', 'retired');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student Profile requires an applied country requirement version'
      USING ERRCODE = '22023';
  END IF;

  IF ('legal_display_name' = ANY(target_version.required_profile_fields))
    IS DISTINCT FROM (legal_name IS NOT NULL)
    OR ('date_of_birth' = ANY(target_version.required_profile_fields))
      IS DISTINCT FROM (p_date_of_birth IS NOT NULL)
    OR (
      'decision_participant_labels' = ANY(target_version.required_profile_fields)
      AND cardinality(normalized_labels) = 0
    )
    OR (
      'consent_evidence_ref' = ANY(target_version.required_profile_fields)
      AND consent_ref IS NULL
    )
  THEN
    RAISE EXCEPTION 'Profile values do not satisfy the applied required_profile_fields'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_profile
  FROM platform.student_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.student_case_id = p_student_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_revision <> 0 THEN
      RAISE EXCEPTION 'Student Profile revision conflict'
        USING ERRCODE = '40001';
    END IF;
    profile_id := gen_random_uuid();
    next_revision := 1;
    updated_fields := ARRAY[
      'preferred_display_name', 'legal_display_name',
      'communication_language', 'date_of_birth', 'citizenship_country',
      'residency_country', 'current_education_summary', 'academic_summary',
      'language_summary', 'budget_band', 'decision_participant_labels',
      'consent_status', 'consent_evidence_ref', 'next_step'
    ]::TEXT[];

    INSERT INTO platform.student_profiles (
      id, organization_id, student_case_id, revision,
      preferred_display_name, legal_display_name, communication_language,
      date_of_birth, citizenship_country, residency_country,
      current_education_summary, academic_summary, language_summary,
      budget_band, decision_participant_labels, consent_status,
      consent_evidence_ref, next_step,
      created_by_membership_id, updated_by_membership_id
    ) VALUES (
      profile_id, p_organization_id, p_student_case_id, next_revision,
      preferred_name, legal_name, communication_language_value,
      p_date_of_birth, citizenship_value, residency_value,
      education_value, academic_value, language_value,
      budget_value, normalized_labels, p_consent_status,
      consent_ref, next_step_value,
      actor.actor_membership_id, actor.actor_membership_id
    );
  ELSE
    IF current_profile.revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Student Profile revision conflict'
        USING ERRCODE = '40001';
    END IF;

    updated_fields := ARRAY_REMOVE(ARRAY[
      CASE WHEN current_profile.preferred_display_name IS DISTINCT FROM preferred_name THEN 'preferred_display_name' END,
      CASE WHEN current_profile.legal_display_name IS DISTINCT FROM legal_name THEN 'legal_display_name' END,
      CASE WHEN current_profile.communication_language IS DISTINCT FROM communication_language_value THEN 'communication_language' END,
      CASE WHEN current_profile.date_of_birth IS DISTINCT FROM p_date_of_birth THEN 'date_of_birth' END,
      CASE WHEN current_profile.citizenship_country IS DISTINCT FROM citizenship_value THEN 'citizenship_country' END,
      CASE WHEN current_profile.residency_country IS DISTINCT FROM residency_value THEN 'residency_country' END,
      CASE WHEN current_profile.current_education_summary IS DISTINCT FROM education_value THEN 'current_education_summary' END,
      CASE WHEN current_profile.academic_summary IS DISTINCT FROM academic_value THEN 'academic_summary' END,
      CASE WHEN current_profile.language_summary IS DISTINCT FROM language_value THEN 'language_summary' END,
      CASE WHEN current_profile.budget_band IS DISTINCT FROM budget_value THEN 'budget_band' END,
      CASE WHEN current_profile.decision_participant_labels IS DISTINCT FROM normalized_labels THEN 'decision_participant_labels' END,
      CASE WHEN current_profile.consent_status IS DISTINCT FROM p_consent_status THEN 'consent_status' END,
      CASE WHEN current_profile.consent_evidence_ref IS DISTINCT FROM consent_ref THEN 'consent_evidence_ref' END,
      CASE WHEN current_profile.next_step IS DISTINCT FROM next_step_value THEN 'next_step' END
    ]::TEXT[], NULL);

    IF cardinality(updated_fields) = 0 THEN
      RAISE EXCEPTION 'Student Profile update must change at least one field'
        USING ERRCODE = '22023';
    END IF;

    profile_id := current_profile.id;
    next_revision := current_profile.revision + 1;
    UPDATE platform.student_profiles AS profile
    SET revision = next_revision,
        preferred_display_name = preferred_name,
        legal_display_name = legal_name,
        communication_language = communication_language_value,
        date_of_birth = p_date_of_birth,
        citizenship_country = citizenship_value,
        residency_country = residency_value,
        current_education_summary = education_value,
        academic_summary = academic_value,
        language_summary = language_value,
        budget_band = budget_value,
        decision_participant_labels = normalized_labels,
        consent_status = p_consent_status,
        consent_evidence_ref = consent_ref,
        next_step = next_step_value,
        updated_by_membership_id = actor.actor_membership_id,
        updated_at = statement_timestamp()
    WHERE profile.organization_id = p_organization_id
      AND profile.student_case_id = p_student_case_id;
  END IF;

  result := jsonb_build_object(
    'id', profile_id,
    'student_profile_id', profile_id,
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'revision', next_revision,
    'applied_country_requirement_version_id', target_version.id,
    'updated_field_names', updated_fields,
    'input_sha256', input_sha256
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.upsert', 'student_profile', profile_id,
    CASE
      WHEN current_profile.id IS NULL THEN NULL
      ELSE jsonb_build_object('id', current_profile.id, 'revision', current_profile.revision)
    END,
    result, normalized_reason, p_request_id
  );

  RETURN result;
END
$$;

-- Staff and portal snapshots share stable profile aliases. The portal version
-- additionally carries the accepted case-shell fields needed by /portal.
CREATE OR REPLACE FUNCTION platform.staff_student_profile_snapshot(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  student_profile_id UUID,
  student_display_name TEXT,
  profile_revision BIGINT,
  preferred_display_name TEXT,
  legal_display_name TEXT,
  communication_language TEXT,
  date_of_birth DATE,
  citizenship_country TEXT,
  residency_country TEXT,
  current_education_summary TEXT,
  academic_summary TEXT,
  language_summary TEXT,
  budget_band TEXT,
  decision_participant_labels TEXT[],
  consent_status platform.student_profile_consent_status,
  consent_evidence_ref TEXT,
  profile_next_step TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  case_state platform.student_case_state,
  case_next_action TEXT,
  portal_activated_at TIMESTAMPTZ,
  applied_country_requirement_version_id UUID,
  checklist_version BIGINT,
  required_profile_fields platform.student_profile_field[]
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    profile.id,
    student_case.student_display_name,
    profile.revision,
    profile.preferred_display_name,
    profile.legal_display_name,
    profile.communication_language,
    profile.date_of_birth,
    profile.citizenship_country,
    profile.residency_country,
    profile.current_education_summary,
    profile.academic_summary,
    profile.language_summary,
    profile.budget_band,
    profile.decision_participant_labels,
    profile.consent_status,
    profile.consent_evidence_ref,
    profile.next_step,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.next_action,
    student_case.portal_activated_at,
    student_case.applied_country_requirement_version_id,
    requirement_version.version,
    requirement_version.required_profile_fields
  FROM platform.student_cases AS student_case
  JOIN platform.student_profiles AS profile
    ON profile.organization_id = student_case.organization_id
    AND profile.student_case_id = student_case.id
  LEFT JOIN platform.country_requirement_versions AS requirement_version
    ON requirement_version.organization_id = student_case.organization_id
    AND requirement_version.id =
      student_case.applied_country_requirement_version_id
  WHERE student_case.id = p_student_case_id
    AND requirement_version.status IN ('approved', 'retired')
    AND private.platform_has_permission(
      student_case.organization_id,
      'profile.read.full'
    )
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
$$;

CREATE OR REPLACE FUNCTION platform.student_portal_profile()
RETURNS TABLE (
  case_id UUID,
  student_profile_id UUID,
  student_display_name TEXT,
  profile_revision BIGINT,
  preferred_display_name TEXT,
  legal_display_name TEXT,
  communication_language TEXT,
  date_of_birth DATE,
  citizenship_country TEXT,
  residency_country TEXT,
  current_education_summary TEXT,
  academic_summary TEXT,
  language_summary TEXT,
  budget_band TEXT,
  decision_participant_labels TEXT[],
  consent_status platform.student_profile_consent_status,
  consent_evidence_ref TEXT,
  profile_next_step TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  case_state platform.student_case_state,
  case_next_action TEXT,
  portal_activated_at TIMESTAMPTZ,
  applied_country_requirement_version_id UUID,
  checklist_version BIGINT,
  required_profile_fields platform.student_profile_field[]
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH eligible_cases AS MATERIALIZED (
    SELECT candidate.id
    FROM platform.student_cases AS candidate
    JOIN platform.student_profiles AS candidate_profile
      ON candidate_profile.organization_id = candidate.organization_id
      AND candidate_profile.student_case_id = candidate.id
    JOIN platform.country_requirement_versions AS candidate_version
      ON candidate_version.organization_id = candidate.organization_id
      AND candidate_version.id =
        candidate.applied_country_requirement_version_id
      AND candidate_version.status IN ('approved', 'retired')
    WHERE private.platform_has_permission(
        candidate.organization_id,
        'profile.read.self'
      )
      AND private.platform_can_read_student_portal_case(
        candidate.organization_id,
        candidate.id
      )
  )
  SELECT
    student_case.id,
    profile.id,
    student_case.student_display_name,
    profile.revision,
    profile.preferred_display_name,
    profile.legal_display_name,
    profile.communication_language,
    profile.date_of_birth,
    profile.citizenship_country,
    profile.residency_country,
    profile.current_education_summary,
    profile.academic_summary,
    profile.language_summary,
    profile.budget_band,
    profile.decision_participant_labels,
    profile.consent_status,
    profile.consent_evidence_ref,
    profile.next_step,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    student_case.route_approval_status,
    student_case.operational_stage,
    student_case.state,
    student_case.next_action,
    student_case.portal_activated_at,
    student_case.applied_country_requirement_version_id,
    requirement_version.version,
    requirement_version.required_profile_fields
  FROM platform.student_cases AS student_case
  JOIN platform.student_profiles AS profile
    ON profile.organization_id = student_case.organization_id
    AND profile.student_case_id = student_case.id
  JOIN platform.country_requirement_versions AS requirement_version
    ON requirement_version.organization_id = student_case.organization_id
    AND requirement_version.id =
      student_case.applied_country_requirement_version_id
    AND requirement_version.status IN ('approved', 'retired')
  WHERE student_case.id IN (SELECT eligible_case.id FROM eligible_cases AS eligible_case)
    AND (SELECT count(*) FROM eligible_cases) = 1
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_documents(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  document_slot_id UUID,
  document_requirement_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  instructions TEXT,
  checklist_version BIGINT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  document_version_id UUID,
  version_no BIGINT,
  original_filename TEXT,
  declared_mime_type TEXT,
  byte_size BIGINT,
  submitted_at TIMESTAMPTZ,
  review_decision platform.document_review_decision,
  rework_reason TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    slot.student_case_id,
    slot.id,
    requirement.id,
    requirement.requirement_key,
    requirement.label,
    requirement.instructions,
    requirement.checklist_version,
    slot.status,
    slot.deadline,
    slot.next_action,
    document_version.id,
    document_version.version_no,
    document_version.original_filename,
    document_version.declared_mime_type,
    document_version.byte_size,
    document_version.created_at,
    review.decision,
    CASE
      WHEN review.decision IN ('correction_required', 'rejected')
      THEN review.reason
      ELSE NULL
    END,
    review.created_at
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  LEFT JOIN platform.document_versions AS document_version
    ON document_version.organization_id = slot.organization_id
    AND document_version.document_slot_id = slot.id
    AND document_version.student_case_id = slot.student_case_id
  LEFT JOIN LATERAL (
    SELECT
      document_review.decision,
      document_review.reason,
      document_review.created_at
    FROM platform.document_reviews AS document_review
    WHERE document_review.organization_id = slot.organization_id
      AND document_review.document_version_id = document_version.id
    ORDER BY document_review.created_at DESC, document_review.id DESC
    LIMIT 1
  ) AS review ON TRUE
  WHERE slot.student_case_id = p_student_case_id
    AND private.platform_has_permission(
      slot.organization_id,
      'profile.read.full'
    )
    AND private.platform_can_read_student_case(
      slot.organization_id,
      slot.student_case_id
    )
  ORDER BY slot.deadline NULLS LAST, slot.id, document_version.version_no
$$;

CREATE OR REPLACE FUNCTION platform.staff_country_requirement_versions_for_case(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  country_requirement_version_id UUID,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  version BIGINT,
  status platform.country_requirement_version_status,
  required_profile_fields platform.student_profile_field[],
  source_count BIGINT,
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  is_applied BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    student_case.id,
    requirement_version.id,
    requirement_version.target_country,
    requirement_version.target_degree,
    requirement_version.program_direction,
    requirement_version.version,
    requirement_version.status,
    requirement_version.required_profile_fields,
    (
      SELECT count(*)
      FROM platform.country_requirement_version_sources AS source_link
      WHERE source_link.organization_id = requirement_version.organization_id
        AND source_link.country_requirement_version_id = requirement_version.id
    ),
    requirement_version.approved_at,
    requirement_version.retired_at,
    student_case.applied_country_requirement_version_id = requirement_version.id,
    requirement_version.created_at
  FROM platform.student_cases AS student_case
  JOIN platform.country_requirement_versions AS requirement_version
    ON requirement_version.organization_id = student_case.organization_id
    AND requirement_version.target_country = student_case.target_country
    AND requirement_version.target_degree = student_case.target_degree
    AND requirement_version.program_direction IS NOT DISTINCT FROM
      student_case.program_direction
  WHERE student_case.id = p_student_case_id
    AND requirement_version.status IN ('approved', 'retired')
    AND private.platform_has_permission(
      student_case.organization_id,
      'profile.read.full'
    )
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
  ORDER BY requirement_version.version DESC, requirement_version.id
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform.student_profiles,
  platform.country_requirement_versions,
  platform.country_requirement_version_sources
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE
  platform.student_profiles,
  platform.country_requirement_versions,
  platform.country_requirement_version_sources
TO authenticated;

REVOKE ALL ON FUNCTION
  platform.create_country_requirement_version(
    UUID, TEXT, TEXT, TEXT, BIGINT, platform.student_profile_field[], TEXT, UUID
  ),
  platform.link_country_requirement_version_source(UUID, UUID, UUID, TEXT, UUID),
  platform.approve_country_requirement_version(UUID, UUID, TEXT, UUID),
  platform.retire_country_requirement_version(UUID, UUID, TEXT, UUID),
  platform.apply_country_requirement_version(UUID, UUID, UUID, TEXT, UUID),
  platform.upsert_student_profile(
    UUID, UUID, BIGINT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT[], platform.student_profile_consent_status,
    TEXT, TEXT, TEXT, UUID
  ),
  platform.staff_student_profile_snapshot(UUID),
  platform.student_portal_profile(),
  platform.staff_student_case_documents(UUID),
  platform.staff_country_requirement_versions_for_case(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.create_country_requirement_version(
    UUID, TEXT, TEXT, TEXT, BIGINT, platform.student_profile_field[], TEXT, UUID
  ),
  platform.link_country_requirement_version_source(UUID, UUID, UUID, TEXT, UUID),
  platform.approve_country_requirement_version(UUID, UUID, TEXT, UUID),
  platform.retire_country_requirement_version(UUID, UUID, TEXT, UUID),
  platform.apply_country_requirement_version(UUID, UUID, UUID, TEXT, UUID),
  platform.upsert_student_profile(
    UUID, UUID, BIGINT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT[], platform.student_profile_consent_status,
    TEXT, TEXT, TEXT, UUID
  ),
  platform.staff_student_profile_snapshot(UUID),
  platform.student_portal_profile(),
  platform.staff_student_case_documents(UUID),
  platform.staff_country_requirement_versions_for_case(UUID)
TO authenticated;

COMMENT ON TABLE platform.student_profiles IS
  'Minimized, revisioned Student Profile. Optional legal name and birth date are gated by the immutable applied country requirement version.';
COMMENT ON TABLE platform.country_requirement_versions IS
  'Source-reviewed, immutable country route/profile/checklist manifest. Document requirements remain in the existing versioned document model.';
COMMENT ON TABLE platform.country_requirement_version_sources IS
  'Append-only links from country requirement versions to the existing PII-free source registry.';
COMMENT ON COLUMN platform.student_cases.applied_country_requirement_version_id IS
  'Nullable until one approved exact-route country requirement version is applied; immutable after first binding.';

COMMIT;
