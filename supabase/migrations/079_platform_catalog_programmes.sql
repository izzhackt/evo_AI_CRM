-- ============================================================
-- 079_platform_catalog_programmes.sql
--
-- Programme layer for the institution catalog, sourced from the approved EVO
-- knowledge vault instead of Notion. A programme row exists only after the
-- same explicit Admin approval that already governs institutions: candidates
-- are staged, validated deterministically and promoted, never written
-- directly. No provider is called and no catalog data is seeded here.
--
-- Design contract: docs/platform/catalog-programme-schema.md
-- Decision: docs/adr/0021-source-institution-catalog-from-approved-knowledge-vault.md
-- Measurement that shaped it: docs/platform/catalog-source-inventory.md
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Knowledge-vault source form
-- ------------------------------------------------------------
-- A vault has no URL, and a filesystem path must never enter the database.
-- A source is identified by the document digest the existing bundle builder
-- already produces, so provenance stays verifiable without exposing a path.
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
    WHEN 'knowledge_vault' THEN
      p_source_url ~ '^evo-knowledge://internal/[a-f0-9]{64}$'
    ELSE FALSE
  END
$$;

-- ------------------------------------------------------------
-- Programme dimensions
-- ------------------------------------------------------------
-- Seven levels were measured in the vault. `transfer_programme` is added
-- because fifteen INTI American and Australian Degree Transfer documents are a
-- transfer route: recording them as foundation, diploma or bachelor would
-- state a level the student does not enrol at.
CREATE TYPE platform.catalog_programme_level AS ENUM (
  'foundation',
  'certificate',
  'diploma',
  'pre_university',
  'bachelor',
  'master',
  'doctoral',
  'transfer_programme'
);

-- Study mode is part of the programme rather than a description of it.
-- Thirty-four of 104 measured programmes state duration per mode, such as
-- three years full-time and four years part-time, so one duration cell would
-- force a silent choice between two true values.
CREATE TYPE platform.catalog_study_mode AS ENUM (
  'full_time',
  'part_time',
  'online'
);

-- Intake months are validated by an IMMUTABLE helper because a CHECK
-- constraint cannot contain a subquery. The helper also enforces uniqueness
-- and ascending order, so the same month cannot be listed twice and two equal
-- sets cannot differ by ordering.
CREATE OR REPLACE FUNCTION platform_private.catalog_intake_months_are_valid(
  p_months SMALLINT[]
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_months IS NOT NULL
    AND cardinality(p_months) <= 12
    AND p_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[]
    AND p_months = (
      SELECT COALESCE(array_agg(DISTINCT month ORDER BY month), '{}'::SMALLINT[])
      FROM unnest(p_months) AS month
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.normalize_catalog_programme_name(
  p_programme_name TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(
    regexp_replace(
      btrim(COALESCE(p_programme_name, '')),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

-- ------------------------------------------------------------
-- Approved programmes
-- ------------------------------------------------------------
CREATE TABLE platform.catalog_programmes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  catalog_institution_id UUID NOT NULL,
  programme_level platform.catalog_programme_level NOT NULL,
  study_mode platform.catalog_study_mode NOT NULL,
  programme_name TEXT NOT NULL CHECK (
    btrim(programme_name) <> ''
    AND char_length(programme_name) <= 300
    AND programme_name !~ '[[:cntrl:]]'
  ),
  -- Optional because the source states them only sometimes. A NULL means the
  -- source carries no literal fact, never that a default should be assumed.
  -- Teaching language has no column: it was found in zero of 104 documents.
  duration_months SMALLINT CHECK (
    duration_months IS NULL OR duration_months BETWEEN 1 AND 120
  ),
  intake_months SMALLINT[] NOT NULL DEFAULT '{}'::SMALLINT[] CHECK (
    platform_private.catalog_intake_months_are_valid(intake_months)
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
  CONSTRAINT catalog_programmes_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT catalog_programmes_batch_id_id_key
    UNIQUE (organization_id, import_batch_id, id),
  CONSTRAINT catalog_programmes_source_record_key
    UNIQUE (organization_id, source_registry_id, source_record_key),
  -- The composite reference makes a cross-organization link impossible rather
  -- than merely discouraged.
  CONSTRAINT catalog_programmes_institution_fkey
    FOREIGN KEY (organization_id, catalog_institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id)
    ON DELETE RESTRICT,
  -- The batch unique key that carries source_registry_id and source_revision
  -- also carries institution_kind, which a programme does not have. Referencing
  -- the batch by identity keeps the link, and the trigger below proves the
  -- recorded registry and revision equal the batch's own, so a programme cannot
  -- claim provenance its batch does not have.
  CONSTRAINT catalog_programmes_batch_fkey
    FOREIGN KEY (organization_id, import_batch_id)
    REFERENCES platform.catalog_import_batches(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programmes_approved_by_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

-- Provenance recorded on a programme must equal the provenance of its batch.
CREATE OR REPLACE FUNCTION platform_private.assert_catalog_programme_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  batch_registry_id UUID;
  batch_revision TEXT;
BEGIN
  SELECT batch.source_registry_id, batch.source_revision
  INTO batch_registry_id, batch_revision
  FROM platform.catalog_import_batches AS batch
  WHERE batch.organization_id = NEW.organization_id
    AND batch.id = NEW.import_batch_id;

  IF batch_registry_id IS NULL
    OR batch_registry_id <> NEW.source_registry_id
    OR batch_revision IS DISTINCT FROM NEW.source_revision
  THEN
    RAISE EXCEPTION 'Catalog programme provenance must match its import batch'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_programmes_assert_provenance
  BEFORE INSERT ON platform.catalog_programmes
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.assert_catalog_programme_provenance();

-- Level and mode both belong in the key: one institution runs Diploma in
-- Business and Bachelor of Business at once, and the full-time and part-time
-- forms of one programme are two records rather than a conflict.
CREATE UNIQUE INDEX catalog_programmes_normalized_key
  ON platform.catalog_programmes (
    organization_id,
    catalog_institution_id,
    programme_level,
    study_mode,
    platform_private.normalize_catalog_programme_name(programme_name)
  );

CREATE INDEX catalog_programmes_institution_idx
  ON platform.catalog_programmes (
    organization_id,
    catalog_institution_id,
    programme_level,
    id
  );

-- ------------------------------------------------------------
-- Staged candidates
-- ------------------------------------------------------------
CREATE TABLE platform.catalog_programme_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  catalog_import_batch_id UUID NOT NULL,
  source_record_key TEXT NOT NULL CHECK (
    source_record_key ~ '^rec_[a-f0-9]{32,64}$'
  ),
  -- A candidate must name an already approved institution. A programme
  -- attached to an unapproved institution cannot become valid.
  institution_id UUID NOT NULL,
  programme_name TEXT NOT NULL CHECK (
    char_length(programme_name) <= 300
    AND programme_name !~ '[[:cntrl:]]'
  ),
  programme_level platform.catalog_programme_level NOT NULL,
  study_mode platform.catalog_study_mode NOT NULL,
  duration_months SMALLINT CHECK (
    duration_months IS NULL OR duration_months BETWEEN 1 AND 120
  ),
  intake_months SMALLINT[] NOT NULL DEFAULT '{}'::SMALLINT[] CHECK (
    platform_private.catalog_intake_months_are_valid(intake_months)
  ),
  validation_status platform.catalog_candidate_validation_status
    NOT NULL DEFAULT 'pending',
  validation_errors TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  catalog_programme_id UUID,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT catalog_programme_candidates_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT catalog_programme_candidates_batch_record_key
    UNIQUE (organization_id, catalog_import_batch_id, source_record_key),
  CONSTRAINT catalog_programme_candidates_batch_fkey
    FOREIGN KEY (organization_id, catalog_import_batch_id)
    REFERENCES platform.catalog_import_batches(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programme_candidates_institution_fkey
    FOREIGN KEY (organization_id, institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programme_candidates_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programme_candidates_promoted_fkey
    FOREIGN KEY (
      organization_id,
      catalog_import_batch_id,
      catalog_programme_id
    )
    REFERENCES platform.catalog_programmes(
      organization_id,
      import_batch_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programme_candidates_validation_check CHECK (
    (
      validation_status = 'pending'
      AND cardinality(validation_errors) = 0
      AND catalog_programme_id IS NULL
    )
    OR (
      validation_status = 'valid'
      AND cardinality(validation_errors) = 0
    )
    OR (
      validation_status = 'invalid'
      AND cardinality(validation_errors) > 0
      AND catalog_programme_id IS NULL
    )
  ),
  CONSTRAINT catalog_programme_candidates_error_allowlist_check CHECK (
    platform_private.catalog_validation_errors_are_safe(validation_errors)
  )
);

CREATE INDEX catalog_programme_candidates_batch_idx
  ON platform.catalog_programme_candidates (
    organization_id,
    catalog_import_batch_id,
    validation_status,
    id
  );

-- ------------------------------------------------------------
-- Row level security, guards and grants
-- ------------------------------------------------------------
ALTER TABLE platform.catalog_programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_programmes FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_programme_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.catalog_programme_candidates FORCE ROW LEVEL SECURITY;

-- An approved programme is immutable evidence of an approval decision. It is
-- never edited or deleted in place; a correction arrives as a new import.
CREATE OR REPLACE FUNCTION platform_private.guard_catalog_programme_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approved catalog programmes are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Approved catalog programmes are immutable'
    USING ERRCODE = '55000';
END
$$;

-- A candidate may only advance through validation. Its identity, source
-- binding and staged values cannot be rewritten after staging.
CREATE OR REPLACE FUNCTION platform_private.guard_catalog_programme_candidate_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Catalog programme candidates are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.organization_id <> NEW.organization_id
    OR OLD.catalog_import_batch_id <> NEW.catalog_import_batch_id
    OR OLD.source_record_key <> NEW.source_record_key
    OR OLD.institution_id <> NEW.institution_id
    OR OLD.programme_name <> NEW.programme_name
    OR OLD.programme_level <> NEW.programme_level
    OR OLD.study_mode <> NEW.study_mode
    OR OLD.duration_months IS DISTINCT FROM NEW.duration_months
    OR OLD.intake_months IS DISTINCT FROM NEW.intake_months
    OR OLD.created_by_membership_id <> NEW.created_by_membership_id
    OR OLD.created_at <> NEW.created_at
  THEN
    RAISE EXCEPTION 'Catalog programme candidate identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.validation_status <> 'pending'
    AND OLD.validation_status <> NEW.validation_status
  THEN
    RAISE EXCEPTION 'Catalog programme candidate validation is final'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER catalog_programmes_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.catalog_programmes
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_catalog_programme_mutation();
CREATE TRIGGER catalog_programmes_no_truncate
  BEFORE TRUNCATE ON platform.catalog_programmes
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER catalog_programme_candidates_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.catalog_programme_candidates
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_catalog_programme_candidate_mutation();
CREATE TRIGGER catalog_programme_candidates_no_truncate
  BEFORE TRUNCATE ON platform.catalog_programme_candidates
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Approved programmes follow the same read permission as institutions:
-- Admin, Sales and Curator read the catalog, Finance and Student do not.
CREATE POLICY catalog_programmes_approved_read
  ON platform.catalog_programmes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_has_permission(
      organization_id,
      'catalog.read'
    ))
  );

-- Candidates stay Admin-only: an unapproved row must never reach a Sales or
-- Curator surface where it could be mistaken for an approved programme.
CREATE POLICY catalog_programme_candidates_admin_read
  ON platform.catalog_programme_candidates
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

REVOKE ALL PRIVILEGES ON TABLE
  platform.catalog_programmes,
  platform.catalog_programme_candidates
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE
  platform.catalog_programmes,
  platform.catalog_programme_candidates
TO authenticated;

COMMENT ON TABLE platform.catalog_programmes IS
  'Explicitly approved programmes with immutable source and batch provenance. Study mode is part of the identity because duration differs per mode.';
COMMENT ON COLUMN platform.catalog_programmes.duration_months IS
  'NULL means the source states no literal duration, never that a default applies.';
COMMENT ON TABLE platform.catalog_programme_candidates IS
  'Staged programme candidates awaiting deterministic validation and explicit Admin approval. A candidate is never an approved programme.';

COMMIT;
