-- ============================================================
-- 056_platform_university_catalog_import_boundary.sql
--
-- BW5: reviewed, PII-free university/college catalog imports. Source rows are
-- staged as bounded typed fields, validated deterministically, and promoted
-- only by an explicit Admin approval. No provider is called and no production
-- catalog data is seeded by this migration.
-- ============================================================

BEGIN;

CREATE TYPE platform.catalog_institution_kind AS ENUM (
  'university',
  'college'
);
CREATE TYPE platform.catalog_import_status AS ENUM (
  'staging',
  'validated',
  'approved',
  'rejected'
);
CREATE TYPE platform.catalog_candidate_validation_status AS ENUM (
  'pending',
  'valid',
  'invalid'
);
CREATE TYPE platform.catalog_import_review_decision AS ENUM (
  'approve',
  'reject'
);

CREATE OR REPLACE FUNCTION platform_private.normalize_catalog_institution_name(
  p_institution_name TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(
    regexp_replace(
      btrim(COALESCE(p_institution_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.catalog_validation_errors_are_safe(
  p_errors TEXT[]
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_errors IS NOT NULL
    AND p_errors <@ ARRAY[
      'institution_name_invalid',
      'country_code_invalid',
      'duplicate_in_batch',
      'source_record_already_approved',
      'institution_already_approved'
    ]::TEXT[]
    AND cardinality(p_errors) = (
      SELECT count(DISTINCT error_code)
      FROM unnest(p_errors) AS error_code
    )
$$;

CREATE TABLE platform.catalog_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_registry_id UUID NOT NULL,
  source_revision TEXT NOT NULL CHECK (
    source_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
  ),
  institution_kind platform.catalog_institution_kind NOT NULL,
  status platform.catalog_import_status NOT NULL DEFAULT 'staging',
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  validated_by_membership_id UUID,
  validated_at TIMESTAMPTZ,
  reviewed_by_membership_id UUID,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT CHECK (
    review_reason IS NULL
    OR (
      btrim(review_reason) <> ''
      AND char_length(review_reason) <= 500
      AND review_reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT catalog_import_batches_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT catalog_import_batches_exact_provenance_key
    UNIQUE (
      organization_id,
      id,
      source_registry_id,
      source_revision,
      institution_kind
    ),
  CONSTRAINT catalog_import_batches_source_fkey
    FOREIGN KEY (organization_id, source_registry_id)
    REFERENCES platform.source_registry(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_batches_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_batches_validated_by_fkey
    FOREIGN KEY (organization_id, validated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_batches_reviewed_by_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_batches_state_metadata_check CHECK (
    (
      status = 'staging'
      AND validated_by_membership_id IS NULL
      AND validated_at IS NULL
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR (
      status = 'validated'
      AND validated_by_membership_id IS NOT NULL
      AND validated_at IS NOT NULL
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
      AND review_reason IS NULL
    )
    OR (
      status = 'approved'
      AND validated_by_membership_id IS NOT NULL
      AND validated_at IS NOT NULL
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND (validated_by_membership_id IS NULL) = (validated_at IS NULL)
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND review_reason IS NOT NULL
    )
  )
);

CREATE TABLE platform.catalog_institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  institution_kind platform.catalog_institution_kind NOT NULL,
  institution_name TEXT NOT NULL CHECK (
    btrim(institution_name) <> ''
    AND char_length(institution_name) <= 300
    AND institution_name !~ '[[:cntrl:]]'
  ),
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  city TEXT CHECK (
    city IS NULL
    OR (
      btrim(city) <> ''
      AND char_length(city) <= 200
      AND city !~ '[[:cntrl:]]'
    )
  ),
  source_registry_id UUID NOT NULL,
  source_revision TEXT NOT NULL CHECK (
    source_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
  ),
  import_batch_id UUID NOT NULL,
  source_record_key TEXT NOT NULL CHECK (
    source_record_key ~ '^rec_[a-f0-9]{32,64}$'
  ),
  approved_by_membership_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT catalog_institutions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT catalog_institutions_batch_id_id_key
    UNIQUE (organization_id, import_batch_id, id),
  CONSTRAINT catalog_institutions_source_record_key
    UNIQUE (organization_id, source_registry_id, source_record_key),
  CONSTRAINT catalog_institutions_exact_batch_provenance_fkey
    FOREIGN KEY (
      organization_id,
      import_batch_id,
      source_registry_id,
      source_revision,
      institution_kind
    )
    REFERENCES platform.catalog_import_batches(
      organization_id,
      id,
      source_registry_id,
      source_revision,
      institution_kind
    )
    ON DELETE RESTRICT,
  CONSTRAINT catalog_institutions_approved_by_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX catalog_institutions_normalized_key
  ON platform.catalog_institutions (
    organization_id,
    institution_kind,
    platform_private.normalize_catalog_institution_name(institution_name),
    country_code
  );
CREATE INDEX catalog_institutions_approved_at_idx
  ON platform.catalog_institutions (organization_id, approved_at DESC, id);

CREATE TABLE platform.catalog_import_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  catalog_import_batch_id UUID NOT NULL,
  source_record_key TEXT NOT NULL CHECK (
    source_record_key ~ '^rec_[a-f0-9]{32,64}$'
  ),
  institution_name TEXT NOT NULL CHECK (
    char_length(institution_name) <= 300
    AND institution_name !~ '[[:cntrl:]]'
  ),
  country_code TEXT NOT NULL CHECK (
    char_length(country_code) <= 8
    AND country_code !~ '[[:cntrl:]]'
  ),
  city TEXT CHECK (
    city IS NULL
    OR (
      btrim(city) <> ''
      AND char_length(city) <= 200
      AND city !~ '[[:cntrl:]]'
    )
  ),
  validation_status platform.catalog_candidate_validation_status
    NOT NULL DEFAULT 'pending',
  validation_errors TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  catalog_institution_id UUID,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT catalog_import_candidates_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT catalog_import_candidates_batch_record_key
    UNIQUE (organization_id, catalog_import_batch_id, source_record_key),
  CONSTRAINT catalog_import_candidates_batch_fkey
    FOREIGN KEY (organization_id, catalog_import_batch_id)
    REFERENCES platform.catalog_import_batches(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_candidates_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_candidates_promoted_fkey
    FOREIGN KEY (
      organization_id,
      catalog_import_batch_id,
      catalog_institution_id
    )
    REFERENCES platform.catalog_institutions(
      organization_id,
      import_batch_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT catalog_import_candidates_validation_check CHECK (
    (
      validation_status = 'pending'
      AND cardinality(validation_errors) = 0
      AND catalog_institution_id IS NULL
    )
    OR (
      validation_status = 'valid'
      AND cardinality(validation_errors) = 0
    )
    OR (
      validation_status = 'invalid'
      AND cardinality(validation_errors) > 0
      AND catalog_institution_id IS NULL
    )
  ),
  CONSTRAINT catalog_import_candidates_error_allowlist_check CHECK (
    platform_private.catalog_validation_errors_are_safe(validation_errors)
  )
);

CREATE INDEX catalog_import_candidates_batch_status_idx
  ON platform.catalog_import_candidates (
    organization_id,
    catalog_import_batch_id,
    validation_status,
    id
  );

ALTER TABLE platform.university_applications
  ADD COLUMN catalog_institution_id UUID;
ALTER TABLE platform.university_applications
  ADD CONSTRAINT university_applications_catalog_institution_fkey
  FOREIGN KEY (organization_id, catalog_institution_id)
  REFERENCES platform.catalog_institutions(organization_id, id)
  ON DELETE RESTRICT;
CREATE INDEX university_applications_catalog_institution_idx
  ON platform.university_applications (
    organization_id,
    catalog_institution_id
  )
  WHERE catalog_institution_id IS NOT NULL;

ALTER TABLE platform.catalog_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_institutions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_import_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_import_candidates FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.guard_catalog_import_batch_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Catalog import batches are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id <> NEW.organization_id
    OR OLD.source_registry_id <> NEW.source_registry_id
    OR OLD.source_revision <> NEW.source_revision
    OR OLD.institution_kind <> NEW.institution_kind
    OR OLD.created_by_membership_id <> NEW.created_by_membership_id
    OR OLD.created_at <> NEW.created_at
    OR NOT (
      (OLD.status = 'staging' AND NEW.status IN ('validated', 'rejected'))
      OR (OLD.status = 'validated' AND NEW.status IN ('approved', 'rejected'))
    )
  THEN
    RAISE EXCEPTION 'Catalog import batch transition is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_catalog_import_candidate_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Catalog import candidates are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id <> NEW.organization_id
    OR OLD.catalog_import_batch_id <> NEW.catalog_import_batch_id
    OR OLD.source_record_key <> NEW.source_record_key
    OR OLD.institution_name <> NEW.institution_name
    OR OLD.country_code <> NEW.country_code
    OR OLD.city IS DISTINCT FROM NEW.city
    OR OLD.created_by_membership_id <> NEW.created_by_membership_id
    OR OLD.created_at <> NEW.created_at
    OR NOT (
      (
        OLD.validation_status = 'pending'
        AND NEW.validation_status IN ('valid', 'invalid')
        AND NEW.catalog_institution_id IS NULL
      )
      OR (
        OLD.validation_status = 'valid'
        AND NEW.validation_status = 'valid'
        AND OLD.validation_errors = NEW.validation_errors
        AND OLD.catalog_institution_id IS NULL
        AND NEW.catalog_institution_id IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'Catalog import candidate transition is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_import_batches_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.catalog_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_catalog_import_batch_mutation();
CREATE TRIGGER catalog_import_batches_no_truncate
  BEFORE TRUNCATE ON platform.catalog_import_batches
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER catalog_import_candidates_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.catalog_import_candidates
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_catalog_import_candidate_mutation();
CREATE TRIGGER catalog_import_candidates_no_truncate
  BEFORE TRUNCATE ON platform.catalog_import_candidates
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER catalog_institutions_immutable
  BEFORE UPDATE OR DELETE ON platform.catalog_institutions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER catalog_institutions_no_truncate
  BEFORE TRUNCATE ON platform.catalog_institutions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON FUNCTION
  platform_private.normalize_catalog_institution_name(TEXT),
  platform_private.catalog_validation_errors_are_safe(TEXT[]),
  platform_private.guard_catalog_import_batch_mutation(),
  platform_private.guard_catalog_import_candidate_mutation()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Immutable v10 bundles clone v9 and add only the BW5 catalog permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('catalog.read', 'Read explicitly approved university and college catalog rows'),
  ('catalog.import.manage', 'Stage, validate, approve or reject catalog imports');

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000000901', 'admin', 10, 'draft', 'Admin v10 catalog import boundary'),
  ('00000000-0000-4000-8000-000000000902', 'sales', 10, 'draft', 'Sales v10 approved catalog read'),
  ('00000000-0000-4000-8000-000000000903', 'curator', 10, 'draft', 'Curator v10 approved catalog read'),
  ('00000000-0000-4000-8000-000000000904', 'finance', 10, 'draft', 'Finance v10 unchanged'),
  ('00000000-0000-4000-8000-000000000905', 'student', 10, 'draft', 'Student v10 unchanged');

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v10.id, v10.role, v9_permission.permission_key
FROM platform.role_bundle_versions AS v10
JOIN platform.role_bundle_versions AS v9
  ON v9.role = v10.role
  AND v9.version = 9
  AND v9.status = 'published'
JOIN platform.role_bundle_permissions AS v9_permission
  ON v9_permission.bundle_id = v9.id
  AND v9_permission.bundle_role = v9.role
WHERE v10.version = 10;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 10
  AND (
    (
      bundle.role = 'admin'
      AND permission.permission_key IN (
        'catalog.read',
        'catalog.import.manage'
      )
    )
    OR (
      bundle.role IN ('sales', 'curator')
      AND permission.permission_key = 'catalog.read'
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 10;

CREATE TEMPORARY TABLE bw5_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v10.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v9
  ON v9.id = membership.current_bundle_id
  AND v9.role = membership."current_role"
  AND v9.version = 9
  AND v9.status = 'published'
JOIN platform.role_bundle_versions AS v10
  ON v10.role = membership."current_role"
  AND v10.version = 10
  AND v10.status = 'published'
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
  'BW5 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw5_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw5_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM bw5_membership_bundle_upgrades AS upgrade
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
  'migration:056_platform_university_catalog_import_boundary',
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
  'BW5 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw5_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_bw5_request(
  p_request_id UUID
)
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
    hashtextextended('evo:bw5:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.bw5_input_sha256(
  p_input JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_input::TEXT, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION platform_private.validate_bw5_reason(
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_reason TEXT := btrim(p_reason);
BEGIN
  IF normalized_reason IS NULL
    OR normalized_reason = ''
    OR char_length(normalized_reason) > 500
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'A bounded catalog mutation reason is required'
      USING ERRCODE = '22023';
  END IF;
  RETURN normalized_reason;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.current_bw5_actor(
  p_permission_key TEXT,
  p_require_admin_scope BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  actor_profile_id UUID,
  actor_membership_id UUID,
  actor_auth_user_id UUID,
  actor_organization_id UUID,
  actor_role platform.business_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    membership.id,
    profile.auth_user_id,
    membership.organization_id,
    membership."current_role"
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
    AND membership.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version')
    AND private.platform_has_permission(
      membership.organization_id,
      p_permission_key
    )
    AND (
      NOT p_require_admin_scope
      OR (
        membership."current_role" = 'admin'
        AND private.platform_has_scope(
          membership.organization_id,
          'organization',
          membership.organization_id
        )
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform permission is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw5_admin_actor(
  p_organization_id UUID
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
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'catalog.import.manage'
  );

  IF actor.actor_role IS DISTINCT FROM 'admin'
    OR NOT private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    )
  THEN
    RAISE EXCEPTION 'Active organization-scoped Admin is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    actor.actor_role;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.lock_bw5_request(UUID),
  platform_private.bw5_input_sha256(JSONB),
  platform_private.validate_bw5_reason(TEXT),
  platform_private.current_bw5_actor(TEXT, BOOLEAN),
  platform_private.require_bw5_admin_actor(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE POLICY catalog_institutions_approved_read
  ON platform.catalog_institutions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'catalog.read'
    ))
  );

CREATE POLICY catalog_import_batches_admin_read
  ON platform.catalog_import_batches
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'catalog.import.manage'
    ))
    AND (SELECT private.platform_has_scope(
      organization_id,
      'organization',
      organization_id
    ))
  );

CREATE POLICY catalog_import_candidates_admin_read
  ON platform.catalog_import_candidates
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'catalog.import.manage'
    ))
    AND (SELECT private.platform_has_scope(
      organization_id,
      'organization',
      organization_id
    ))
  );

CREATE OR REPLACE FUNCTION platform.create_catalog_import_batch(
  p_organization_id UUID,
  p_source_registry_id UUID,
  p_institution_kind platform.catalog_institution_kind,
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
  source_row platform.source_registry%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  created_batch_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);
  normalized_reason := platform_private.validate_bw5_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_source_registry_id IS NULL
    OR p_institution_kind IS NULL
  THEN
    RAISE EXCEPTION 'Organization, reviewed source and institution kind are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);

  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'source_registry_id', p_source_registry_id,
    'institution_kind', p_institution_kind,
    'reason', normalized_reason
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.create',
    'catalog_import_batch',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO source_row
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_registry_id
  FOR UPDATE;

  IF NOT FOUND
    OR source_row.review_status <> 'reviewed'
    OR source_row.source_revision IS NULL
    OR source_row.source_kind NOT IN (
      'google_spreadsheet',
      'google_drive_file',
      'notion_database'
    )
  THEN
    RAISE EXCEPTION 'A reviewed catalog source with an exact revision is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.create',
    'catalog_import_batch',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  INSERT INTO platform.catalog_import_batches (
    id,
    organization_id,
    source_registry_id,
    source_revision,
    institution_kind,
    created_by_membership_id
  ) VALUES (
    created_batch_id,
    p_organization_id,
    p_source_registry_id,
    source_row.source_revision,
    p_institution_kind,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', created_batch_id,
    'source_registry_id', p_source_registry_id,
    'source_revision', source_row.source_revision,
    'institution_kind', p_institution_kind,
    'status', 'staging',
    'candidate_count', 0,
    'valid_candidate_count', 0,
    'invalid_candidate_count', 0,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'catalog.import.batch.create', 'catalog_import_batch', created_batch_id,
    NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.stage_catalog_import_candidate(
  p_organization_id UUID,
  p_catalog_import_batch_id UUID,
  p_source_record_key TEXT,
  p_institution_name TEXT,
  p_country_code TEXT,
  p_city TEXT,
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
  batch_row platform.catalog_import_batches%ROWTYPE;
  normalized_source_record_key TEXT := btrim(p_source_record_key);
  normalized_institution_name TEXT := btrim(p_institution_name);
  normalized_country_code TEXT := btrim(p_country_code);
  normalized_city TEXT := NULLIF(btrim(p_city), '');
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  created_candidate_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);
  normalized_reason := platform_private.validate_bw5_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_catalog_import_batch_id IS NULL
    OR normalized_source_record_key IS NULL
    OR normalized_source_record_key !~ '^rec_[a-f0-9]{32,64}$'
    OR p_institution_name IS NULL
    OR char_length(normalized_institution_name) > 300
    OR normalized_institution_name ~ '[[:cntrl:]]'
    OR p_country_code IS NULL
    OR char_length(normalized_country_code) > 8
    OR normalized_country_code ~ '[[:cntrl:]]'
    OR (
      normalized_city IS NOT NULL
      AND (
        char_length(normalized_city) > 200
        OR normalized_city ~ '[[:cntrl:]]'
      )
    )
  THEN
    RAISE EXCEPTION 'Bounded typed catalog candidate fields are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'source_record_key', normalized_source_record_key,
    'institution_name', normalized_institution_name,
    'country_code', normalized_country_code,
    'city', normalized_city,
    'reason', normalized_reason
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.candidate.stage',
    'catalog_import_candidate',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO batch_row
  FROM platform.catalog_import_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_catalog_import_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch_row.status <> 'staging' THEN
    RAISE EXCEPTION 'Catalog candidates may be staged only into a staging batch'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.candidate.stage',
    'catalog_import_candidate',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  INSERT INTO platform.catalog_import_candidates (
    id,
    organization_id,
    catalog_import_batch_id,
    source_record_key,
    institution_name,
    country_code,
    city,
    created_by_membership_id
  ) VALUES (
    created_candidate_id,
    p_organization_id,
    p_catalog_import_batch_id,
    normalized_source_record_key,
    normalized_institution_name,
    normalized_country_code,
    normalized_city,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'catalog_import_candidate_id', created_candidate_id,
    'source_record_key', normalized_source_record_key,
    'validation_status', 'pending',
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'catalog.import.candidate.stage', 'catalog_import_candidate',
    created_candidate_id, NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.validate_catalog_import_batch(
  p_organization_id UUID,
  p_catalog_import_batch_id UUID,
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
  batch_row platform.catalog_import_batches%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  candidate_count BIGINT;
  valid_candidate_count BIGINT;
  invalid_candidate_count BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);
  normalized_reason := platform_private.validate_bw5_reason(p_reason);
  IF p_organization_id IS NULL OR p_catalog_import_batch_id IS NULL THEN
    RAISE EXCEPTION 'Organization and catalog import batch are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'reason', normalized_reason
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.validate',
    'catalog_import_batch',
    p_catalog_import_batch_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO batch_row
  FROM platform.catalog_import_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_catalog_import_batch_id
  FOR UPDATE;
  IF NOT FOUND OR batch_row.status <> 'staging' THEN
    RAISE EXCEPTION 'Only a staging catalog import batch may be validated'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO candidate_count
  FROM platform.catalog_import_candidates AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.catalog_import_batch_id = p_catalog_import_batch_id;
  IF candidate_count = 0 THEN
    RAISE EXCEPTION 'At least one staged catalog candidate is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.validate',
    'catalog_import_batch',
    p_catalog_import_batch_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  WITH validation AS (
    SELECT
      candidate.id,
      array_remove(ARRAY[
        CASE
          WHEN btrim(candidate.institution_name) = ''
          THEN 'institution_name_invalid'
        END,
        CASE
          WHEN candidate.country_code !~ '^[A-Z]{2}$'
          THEN 'country_code_invalid'
        END,
        CASE
          WHEN count(*) OVER (
            PARTITION BY
              platform_private.normalize_catalog_institution_name(
                candidate.institution_name
              ),
              candidate.country_code
          ) > 1
          THEN 'duplicate_in_batch'
        END,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM platform.catalog_institutions AS approved
            WHERE approved.organization_id = candidate.organization_id
              AND approved.source_registry_id = batch_row.source_registry_id
              AND approved.source_record_key = candidate.source_record_key
          )
          THEN 'source_record_already_approved'
        END,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM platform.catalog_institutions AS approved
            WHERE approved.organization_id = candidate.organization_id
              AND approved.institution_kind = batch_row.institution_kind
              AND approved.country_code = candidate.country_code
              AND platform_private.normalize_catalog_institution_name(
                approved.institution_name
              ) = platform_private.normalize_catalog_institution_name(
                candidate.institution_name
              )
          )
          THEN 'institution_already_approved'
        END
      ]::TEXT[], NULL) AS errors
    FROM platform.catalog_import_candidates AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.catalog_import_batch_id = p_catalog_import_batch_id
  )
  UPDATE platform.catalog_import_candidates AS candidate
  SET
    validation_status = CASE
      WHEN cardinality(validation.errors) = 0
        THEN 'valid'::platform.catalog_candidate_validation_status
      ELSE 'invalid'::platform.catalog_candidate_validation_status
    END,
    validation_errors = validation.errors
  FROM validation
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = validation.id;

  SELECT
    count(*),
    count(*) FILTER (WHERE validation_status = 'valid'),
    count(*) FILTER (WHERE validation_status = 'invalid')
  INTO candidate_count, valid_candidate_count, invalid_candidate_count
  FROM platform.catalog_import_candidates AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.catalog_import_batch_id = p_catalog_import_batch_id;

  UPDATE platform.catalog_import_batches
  SET
    status = 'validated',
    validated_by_membership_id = actor.actor_membership_id,
    validated_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_catalog_import_batch_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'status', 'validated',
    'candidate_count', candidate_count,
    'valid_candidate_count', valid_candidate_count,
    'invalid_candidate_count', invalid_candidate_count,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'catalog.import.batch.validate', 'catalog_import_batch',
    p_catalog_import_batch_id,
    jsonb_build_object('status', batch_row.status),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_catalog_import_batch(
  p_organization_id UUID,
  p_catalog_import_batch_id UUID,
  p_decision platform.catalog_import_review_decision,
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
  batch_row platform.catalog_import_batches%ROWTYPE;
  source_row platform.source_registry%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  candidate_count BIGINT;
  valid_candidate_count BIGINT;
  invalid_candidate_count BIGINT;
  promoted_candidate_count BIGINT := 0;
  next_status platform.catalog_import_status;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);
  normalized_reason := platform_private.validate_bw5_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_catalog_import_batch_id IS NULL
    OR p_decision IS NULL
  THEN
    RAISE EXCEPTION 'Organization, catalog import batch and decision are required'
      USING ERRCODE = '22023';
  END IF;
  next_status := CASE p_decision
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
  END;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'decision', p_decision,
    'reason', normalized_reason
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.review',
    'catalog_import_batch',
    p_catalog_import_batch_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO batch_row
  FROM platform.catalog_import_batches AS batch
  WHERE batch.organization_id = p_organization_id
    AND batch.id = p_catalog_import_batch_id
  FOR UPDATE;
  IF NOT FOUND
    OR (
      p_decision = 'approve'
      AND batch_row.status <> 'validated'
    )
    OR (
      p_decision = 'reject'
      AND batch_row.status NOT IN ('staging', 'validated')
    )
  THEN
    RAISE EXCEPTION 'Catalog import batch is unavailable for this review decision'
      USING ERRCODE = '55000';
  END IF;

  IF p_decision = 'approve' THEN
    SELECT * INTO source_row
    FROM platform.source_registry AS source
    WHERE source.organization_id = p_organization_id
      AND source.id = batch_row.source_registry_id
    FOR UPDATE;
    IF NOT FOUND
      OR source_row.review_status <> 'reviewed'
      OR source_row.source_revision IS DISTINCT FROM batch_row.source_revision
    THEN
      RAISE EXCEPTION 'Catalog source review or exact revision changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE validation_status = 'valid'),
    count(*) FILTER (WHERE validation_status = 'invalid')
  INTO candidate_count, valid_candidate_count, invalid_candidate_count
  FROM platform.catalog_import_candidates AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.catalog_import_batch_id = p_catalog_import_batch_id;

  IF p_decision = 'approve'
    AND (
      candidate_count = 0
      OR invalid_candidate_count <> 0
      OR valid_candidate_count <> candidate_count
      OR EXISTS (
        SELECT 1
        FROM platform.catalog_import_candidates AS candidate
        WHERE candidate.organization_id = p_organization_id
          AND candidate.catalog_import_batch_id = p_catalog_import_batch_id
          AND (
            cardinality(candidate.validation_errors) <> 0
            OR candidate.catalog_institution_id IS NOT NULL
          )
      )
    )
  THEN
    RAISE EXCEPTION 'Only a zero-error validated batch may be approved'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw5_admin_actor(p_organization_id);
  replayed := platform_private.replay_audit(
    p_request_id,
    'catalog.import.batch.review',
    'catalog_import_batch',
    p_catalog_import_batch_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'catalog_import_batch_id', p_catalog_import_batch_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  UPDATE platform.catalog_import_batches
  SET
    status = next_status,
    reviewed_by_membership_id = actor.actor_membership_id,
    reviewed_at = statement_timestamp(),
    review_reason = normalized_reason
  WHERE organization_id = p_organization_id
    AND id = p_catalog_import_batch_id;

  IF p_decision = 'approve' THEN
    INSERT INTO platform.catalog_institutions (
      organization_id,
      institution_kind,
      institution_name,
      country_code,
      city,
      source_registry_id,
      source_revision,
      import_batch_id,
      source_record_key,
      approved_by_membership_id
    )
    SELECT
      candidate.organization_id,
      batch_row.institution_kind,
      candidate.institution_name,
      candidate.country_code,
      candidate.city,
      batch_row.source_registry_id,
      batch_row.source_revision,
      batch_row.id,
      candidate.source_record_key,
      actor.actor_membership_id
    FROM platform.catalog_import_candidates AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.catalog_import_batch_id = p_catalog_import_batch_id
      AND candidate.validation_status = 'valid'
      AND cardinality(candidate.validation_errors) = 0;

    UPDATE platform.catalog_import_candidates AS candidate
    SET catalog_institution_id = approved.id
    FROM platform.catalog_institutions AS approved
    WHERE candidate.organization_id = p_organization_id
      AND candidate.catalog_import_batch_id = p_catalog_import_batch_id
      AND approved.organization_id = candidate.organization_id
      AND approved.import_batch_id = candidate.catalog_import_batch_id
      AND approved.source_record_key = candidate.source_record_key;
    GET DIAGNOSTICS promoted_candidate_count = ROW_COUNT;

    IF promoted_candidate_count <> candidate_count THEN
      RAISE EXCEPTION 'Every validated candidate must be promoted atomically'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'catalog_import_batch_id', p_catalog_import_batch_id,
    'decision', p_decision,
    'status', next_status,
    'candidate_count', candidate_count,
    'valid_candidate_count', valid_candidate_count,
    'invalid_candidate_count', invalid_candidate_count,
    'promoted_candidate_count', promoted_candidate_count,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'catalog.import.batch.review', 'catalog_import_batch',
    p_catalog_import_batch_id,
    jsonb_build_object('status', batch_row.status),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_catalog_university_application(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_catalog_institution_id UUID,
  p_program_name TEXT,
  p_status platform.application_status,
  p_evidence_reference TEXT,
  p_note TEXT,
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
  catalog_row platform.catalog_institutions%ROWTYPE;
  normalized_program_name TEXT := btrim(p_program_name);
  normalized_evidence_reference TEXT := NULLIF(btrim(p_evidence_reference), '');
  normalized_note TEXT := NULLIF(btrim(p_note), '');
  input_sha256 TEXT;
  replayed JSONB;
  created_application_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT := 'Catalog-backed university application created';
BEGIN
  PERFORM platform_private.lock_bw5_request(p_request_id);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_catalog_institution_id IS NULL
    OR normalized_program_name IS NULL
    OR normalized_program_name = ''
    OR char_length(normalized_program_name) > 300
    OR normalized_program_name ~ '[[:cntrl:]]'
    OR p_status IS NULL
    OR (
      normalized_evidence_reference IS NOT NULL
      AND (
        char_length(normalized_evidence_reference) > 1000
        OR normalized_evidence_reference ~ '[[:cntrl:]]'
      )
    )
    OR (
      normalized_note IS NOT NULL
      AND (
        char_length(normalized_note) > 1000
        OR normalized_note ~ '[[:cntrl:]]'
      )
    )
    OR (
      platform_private.application_status_needs_evidence(p_status)
      AND normalized_evidence_reference IS NULL
    )
  THEN
    RAISE EXCEPTION 'Catalog application fields and required evidence are invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  input_sha256 := platform_private.bw5_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'catalog_institution_id', p_catalog_institution_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
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

  SELECT * INTO catalog_row
  FROM platform.catalog_institutions AS institution
  WHERE institution.organization_id = p_organization_id
    AND institution.id = p_catalog_institution_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved catalog institution is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'application.manage'
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'application.create',
    'university_application',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'catalog_institution_id', p_catalog_institution_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  INSERT INTO platform.university_applications (
    id,
    organization_id,
    student_case_id,
    catalog_institution_id,
    institution_name,
    program_name,
    status,
    latest_evidence_reference,
    created_by_membership_id
  ) VALUES (
    created_application_id,
    p_organization_id,
    p_student_case_id,
    p_catalog_institution_id,
    catalog_row.institution_name,
    normalized_program_name,
    p_status,
    normalized_evidence_reference,
    actor.actor_membership_id
  );

  INSERT INTO platform.university_application_events (
    organization_id,
    application_id,
    student_case_id,
    previous_status,
    new_status,
    evidence_reference,
    note,
    actor_membership_id,
    request_id
  ) VALUES (
    p_organization_id,
    created_application_id,
    p_student_case_id,
    NULL,
    p_status,
    normalized_evidence_reference,
    normalized_note,
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'university_application_id', created_application_id,
    'student_case_id', p_student_case_id,
    'catalog_institution_id', p_catalog_institution_id,
    'institution_name', catalog_row.institution_name,
    'program_name', normalized_program_name,
    'status', p_status,
    'evidence_reference', normalized_evidence_reference,
    'note', normalized_note,
    'actor_membership_id', actor.actor_membership_id,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'application.create', 'university_application',
    created_application_id, NULL, result, fixed_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_catalog_institutions()
RETURNS TABLE (
  organization_id UUID,
  catalog_institution_id UUID,
  institution_kind platform.catalog_institution_kind,
  institution_name TEXT,
  country_code TEXT,
  city TEXT,
  source_registry_id UUID,
  source_revision TEXT,
  import_batch_id UUID,
  approved_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    institution.organization_id,
    institution.id,
    institution.institution_kind,
    institution.institution_name,
    institution.country_code,
    institution.city,
    institution.source_registry_id,
    institution.source_revision,
    institution.import_batch_id,
    institution.approved_at
  FROM platform_private.current_bw5_actor('catalog.read', FALSE) AS actor
  JOIN platform.catalog_institutions AS institution
    ON institution.organization_id = actor.actor_organization_id
  ORDER BY
    institution.institution_kind,
    platform_private.normalize_catalog_institution_name(
      institution.institution_name
    ),
    institution.country_code,
    institution.id
$$;

CREATE OR REPLACE FUNCTION platform.admin_catalog_sources()
RETURNS TABLE (
  organization_id UUID,
  source_registry_id UUID,
  source_kind platform.workflow_source_kind,
  source_url TEXT,
  source_revision TEXT,
  review_status platform.workflow_source_review_status,
  created_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    source.organization_id,
    source.id,
    source.source_kind,
    source.source_url,
    source.source_revision,
    source.review_status,
    source.created_at,
    source.reviewed_at
  FROM platform_private.current_bw5_actor(
    'catalog.import.manage',
    TRUE
  ) AS actor
  JOIN platform.source_registry AS source
    ON source.organization_id = actor.actor_organization_id
  WHERE source.source_kind IN (
    'google_spreadsheet',
    'google_drive_file',
    'notion_database'
  )
  ORDER BY source.created_at DESC, source.id
$$;

CREATE OR REPLACE FUNCTION platform.admin_catalog_import_batches()
RETURNS TABLE (
  organization_id UUID,
  catalog_import_batch_id UUID,
  source_registry_id UUID,
  source_kind platform.workflow_source_kind,
  source_url TEXT,
  source_revision TEXT,
  institution_kind platform.catalog_institution_kind,
  status platform.catalog_import_status,
  candidate_count BIGINT,
  valid_candidate_count BIGINT,
  invalid_candidate_count BIGINT,
  created_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    batch.organization_id,
    batch.id,
    batch.source_registry_id,
    source.source_kind,
    source.source_url,
    batch.source_revision,
    batch.institution_kind,
    batch.status,
    count(candidate.id),
    count(candidate.id) FILTER (
      WHERE candidate.validation_status = 'valid'
    ),
    count(candidate.id) FILTER (
      WHERE candidate.validation_status = 'invalid'
    ),
    batch.created_at,
    batch.validated_at,
    batch.reviewed_at,
    batch.review_reason
  FROM platform_private.current_bw5_actor(
    'catalog.import.manage',
    TRUE
  ) AS actor
  JOIN platform.catalog_import_batches AS batch
    ON batch.organization_id = actor.actor_organization_id
  JOIN platform.source_registry AS source
    ON source.organization_id = batch.organization_id
    AND source.id = batch.source_registry_id
  LEFT JOIN platform.catalog_import_candidates AS candidate
    ON candidate.organization_id = batch.organization_id
    AND candidate.catalog_import_batch_id = batch.id
  GROUP BY
    batch.organization_id,
    batch.id,
    batch.source_registry_id,
    source.source_kind,
    source.source_url,
    batch.source_revision,
    batch.institution_kind,
    batch.status,
    batch.created_at,
    batch.validated_at,
    batch.reviewed_at,
    batch.review_reason
  ORDER BY batch.created_at DESC, batch.id
$$;

CREATE OR REPLACE FUNCTION platform.admin_catalog_import_candidates(
  p_catalog_import_batch_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  catalog_import_candidate_id UUID,
  catalog_import_batch_id UUID,
  source_record_key TEXT,
  institution_name TEXT,
  country_code TEXT,
  city TEXT,
  validation_status platform.catalog_candidate_validation_status,
  validation_errors TEXT[],
  catalog_institution_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_catalog_import_batch_id IS NULL THEN
    RAISE EXCEPTION 'catalog_import_batch_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.current_bw5_actor(
    'catalog.import.manage',
    TRUE
  );

  RETURN QUERY
  SELECT
    candidate.organization_id,
    candidate.id,
    candidate.catalog_import_batch_id,
    candidate.source_record_key,
    candidate.institution_name,
    candidate.country_code,
    candidate.city,
    candidate.validation_status,
    candidate.validation_errors,
    candidate.catalog_institution_id,
    candidate.created_at
  FROM platform.catalog_import_candidates AS candidate
  WHERE candidate.organization_id = actor.actor_organization_id
    AND candidate.catalog_import_batch_id = p_catalog_import_batch_id
  ORDER BY candidate.created_at, candidate.id;
END
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform.catalog_import_batches,
  platform.catalog_institutions,
  platform.catalog_import_candidates
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE
  platform.catalog_import_batches,
  platform.catalog_institutions,
  platform.catalog_import_candidates
TO authenticated;

REVOKE ALL ON FUNCTION
  platform.create_catalog_import_batch(
    UUID, UUID, platform.catalog_institution_kind, TEXT, UUID
  ),
  platform.stage_catalog_import_candidate(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
  ),
  platform.validate_catalog_import_batch(UUID, UUID, TEXT, UUID),
  platform.review_catalog_import_batch(
    UUID, UUID, platform.catalog_import_review_decision, TEXT, UUID
  ),
  platform.create_catalog_university_application(
    UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT, UUID
  ),
  platform.staff_catalog_institutions(),
  platform.admin_catalog_sources(),
  platform.admin_catalog_import_batches(),
  platform.admin_catalog_import_candidates(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.create_catalog_import_batch(
    UUID, UUID, platform.catalog_institution_kind, TEXT, UUID
  ),
  platform.stage_catalog_import_candidate(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
  ),
  platform.validate_catalog_import_batch(UUID, UUID, TEXT, UUID),
  platform.review_catalog_import_batch(
    UUID, UUID, platform.catalog_import_review_decision, TEXT, UUID
  ),
  platform.create_catalog_university_application(
    UUID, UUID, UUID, TEXT, platform.application_status, TEXT, TEXT, UUID
  ),
  platform.staff_catalog_institutions(),
  platform.admin_catalog_sources(),
  platform.admin_catalog_import_batches(),
  platform.admin_catalog_import_candidates(UUID)
TO authenticated;

COMMENT ON TABLE platform.catalog_import_batches IS
  'Admin-reviewed PII-free catalog import batches pinned to one reviewed source revision.';
COMMENT ON TABLE platform.catalog_import_candidates IS
  'Bounded typed staging rows only; no raw source payload, customer data or provider content.';
COMMENT ON TABLE platform.catalog_institutions IS
  'Only explicitly approved university/college metadata with immutable source and batch provenance.';
COMMENT ON COLUMN platform.university_applications.catalog_institution_id IS
  'Nullable link to the approved catalog row whose institution_name was copied into this application.';

COMMIT;
