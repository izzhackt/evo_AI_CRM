-- ============================================================
-- 057_platform_contract_draft_report.sql
--
-- BW6: source-reviewed contract templates, immutable student-case contract
-- drafts, one audited mutable post-contract checklist and immutable reports.
--
-- Generation is deliberately provider-free and server-side. Callers may pick
-- an approved template, but they cannot submit a replacement data payload,
-- chat body, provider response, legacy SQLite row or document body.
-- ============================================================

BEGIN;

-- Supabase CLI keeps uuid-ossp in `extensions`, while a fresh disposable
-- PostgreSQL image can install it in `public`. Migration 052 predates that
-- environment split and calls the public name from one security-definer RPC.
-- Add only the missing compatibility entry point and keep it non-callable by
-- API roles; the owning RPC can still execute it as its function owner.
DO $$
BEGIN
  IF to_regprocedure('public.uuid_generate_v5(uuid,text)') IS NULL THEN
    IF to_regprocedure('extensions.uuid_generate_v5(uuid,text)') IS NULL THEN
      RAISE EXCEPTION 'uuid-ossp uuid_generate_v5 is unavailable'
        USING ERRCODE = '42883';
    END IF;

    EXECUTE $create_function$
      CREATE FUNCTION public.uuid_generate_v5(UUID, TEXT)
      RETURNS UUID
      LANGUAGE SQL
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = ''
      AS $function$
        SELECT extensions.uuid_generate_v5($1, $2)
      $function$
    $create_function$;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.uuid_generate_v5(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION public.uuid_generate_v5(UUID, TEXT) IS
  'Internal uuid-ossp compatibility entry point for the immutable migration-052 service RPC; API execution is revoked.';

CREATE TYPE platform.contract_template_version_status AS ENUM (
  'draft',
  'approved',
  'retired'
);

CREATE TYPE platform.contract_artifact_status AS ENUM (
  'draft',
  'approved',
  'rejected'
);

CREATE TYPE platform.contract_artifact_review_decision AS ENUM (
  'approved',
  'rejected'
);

CREATE TYPE platform.post_contract_item_status AS ENUM (
  'open',
  'in_progress',
  'blocked',
  'delivered'
);

CREATE OR REPLACE FUNCTION platform_private.bw6_json_sha256(
  p_value JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_value::TEXT, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION platform_private.bw6_text_sha256(
  p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(p_value, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION platform_private.validate_bw6_reason(
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
    RAISE EXCEPTION 'A bounded BW6 mutation reason is required'
      USING ERRCODE = '22023';
  END IF;
  RETURN normalized_reason;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.lock_bw6_request(
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
    hashtextextended('evo:bw6:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.contract_manifest_source_type(
  p_source_path TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_source_path
    WHEN 'student_case.student_display_name' THEN 'text'
    WHEN 'student_case.target_country' THEN 'text'
    WHEN 'student_case.target_degree' THEN 'text'
    WHEN 'student_case.program_direction' THEN 'text'
    WHEN 'student_case.intake' THEN 'text'
    WHEN 'student_case.contract_confirmed_at' THEN 'timestamp'
    WHEN 'student_profile.preferred_display_name' THEN 'text'
    WHEN 'student_profile.legal_display_name' THEN 'text'
    WHEN 'student_profile.communication_language' THEN 'text'
    WHEN 'student_profile.date_of_birth' THEN 'date'
    WHEN 'student_profile.citizenship_country' THEN 'text'
    WHEN 'student_profile.residency_country' THEN 'text'
    WHEN 'student_profile.current_education_summary' THEN 'text'
    WHEN 'student_profile.academic_summary' THEN 'text'
    WHEN 'student_profile.language_summary' THEN 'text'
    WHEN 'student_profile.budget_band' THEN 'text'
    WHEN 'country_requirement.target_country' THEN 'text'
    WHEN 'country_requirement.target_degree' THEN 'text'
    WHEN 'country_requirement.program_direction' THEN 'text'
    WHEN 'country_requirement.version' THEN 'integer'
    WHEN 'handoff.next_step' THEN 'text'
    WHEN 'handoff.due_at' THEN 'timestamp'
    WHEN 'handoff.responsible_role' THEN 'text'
    WHEN 'handoff.approved_commercial_fields.service_package' THEN 'text'
    WHEN 'handoff.approved_commercial_fields.fee_currency' THEN 'text'
    WHEN 'handoff.approved_commercial_fields.fee_amount_minor' THEN 'integer'
    WHEN 'handoff.approved_commercial_fields.payment_terms' THEN 'text'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.contract_field_manifest_is_valid(
  p_manifest JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    jsonb_typeof(p_manifest) = 'array'
    AND jsonb_array_length(p_manifest) BETWEEN 1 AND 32
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_manifest) AS entry(value)
      WHERE jsonb_typeof(entry.value) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(entry.value)
        ) <> 4
        OR NOT (entry.value ?& ARRAY[
          'field_key', 'source_path', 'value_type', 'required'
        ])
        OR COALESCE(entry.value ->> 'field_key', '') !~
          '^[a-z][a-z0-9_]{1,63}$'
        OR COALESCE(entry.value ->> 'source_path', '') = ''
        OR COALESCE(entry.value ->> 'value_type', '') NOT IN (
          'text', 'integer', 'boolean', 'date', 'timestamp'
        )
        OR jsonb_typeof(entry.value -> 'required') <> 'boolean'
        OR platform_private.contract_manifest_source_type(
          entry.value ->> 'source_path'
        ) IS DISTINCT FROM (entry.value ->> 'value_type')
    )
    AND jsonb_array_length(p_manifest) = (
      SELECT count(DISTINCT entry.value ->> 'field_key')
      FROM jsonb_array_elements(p_manifest) AS entry(value)
    )
    AND jsonb_array_length(p_manifest) = (
      SELECT count(DISTINCT entry.value ->> 'source_path')
      FROM jsonb_array_elements(p_manifest) AS entry(value)
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.contract_template_is_valid(
  p_template_text TEXT,
  p_manifest JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH placeholders AS (
    SELECT match[1] AS field_key
    FROM regexp_matches(
      p_template_text,
      '\{\{([a-z][a-z0-9_]{1,63})\}\}',
      'g'
    ) AS match
  ), manifest_fields AS (
    SELECT entry.value ->> 'field_key' AS field_key
    FROM jsonb_array_elements(p_manifest) AS entry(value)
  )
  SELECT
    platform_private.contract_field_manifest_is_valid(p_manifest)
    AND p_template_text IS NOT NULL
    AND char_length(btrim(p_template_text)) BETWEEN 1 AND 20000
    AND regexp_replace(
      p_template_text,
      '\{\{[a-z][a-z0-9_]{1,63}\}\}',
      '',
      'g'
    ) !~ '\{\{|\}\}'
    AND NOT EXISTS (
      SELECT 1
      FROM placeholders
      WHERE placeholders.field_key NOT IN (
        SELECT manifest_fields.field_key FROM manifest_fields
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM manifest_fields
      WHERE manifest_fields.field_key NOT IN (
        SELECT placeholders.field_key FROM placeholders
      )
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.post_contract_blueprint_is_valid(
  p_blueprint JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    jsonb_typeof(p_blueprint) = 'array'
    AND jsonb_array_length(p_blueprint) BETWEEN 1 AND 64
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_blueprint) AS entry(value)
      WHERE jsonb_typeof(entry.value) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(entry.value)
        ) <> 4
        OR NOT (entry.value ?& ARRAY[
          'item_key', 'label', 'owner_role', 'next_action'
        ])
        OR COALESCE(entry.value ->> 'item_key', '') !~
          '^[a-z][a-z0-9_]{1,63}$'
        OR char_length(btrim(COALESCE(entry.value ->> 'label', '')))
          NOT BETWEEN 1 AND 240
        OR (entry.value ->> 'label') ~ '[[:cntrl:]]'
        OR COALESCE(entry.value ->> 'owner_role', '') NOT IN (
          'admin', 'curator'
        )
        OR char_length(btrim(COALESCE(entry.value ->> 'next_action', '')))
          NOT BETWEEN 1 AND 1000
        OR (entry.value ->> 'next_action') ~ '[[:cntrl:]]'
    )
    AND jsonb_array_length(p_blueprint) = (
      SELECT count(DISTINCT entry.value ->> 'item_key')
      FROM jsonb_array_elements(p_blueprint) AS entry(value)
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.bw6_json_value_matches_type(
  p_value JSONB,
  p_value_type TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = 'null'::JSONB THEN TRUE
    WHEN p_value_type IN ('text', 'date', 'timestamp') THEN
      jsonb_typeof(p_value) = 'string'
    WHEN p_value_type = 'boolean' THEN jsonb_typeof(p_value) = 'boolean'
    WHEN p_value_type = 'integer' THEN
      jsonb_typeof(p_value) = 'number'
      AND (p_value #>> '{}') ~ '^-?[0-9]+$'
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.bw6_render_scalar(
  p_value JSONB,
  p_value_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rendered TEXT;
BEGIN
  IF p_value IS NULL OR p_value = 'null'::JSONB THEN
    RETURN '';
  END IF;
  IF NOT platform_private.bw6_json_value_matches_type(p_value, p_value_type) THEN
    RAISE EXCEPTION 'Contract source value does not match its approved type'
      USING ERRCODE = '22023';
  END IF;
  rendered := CASE
    WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}'
    ELSE p_value::TEXT
  END;
  IF rendered LIKE '%{{%' OR rendered LIKE '%}}%' THEN
    RAISE EXCEPTION 'Contract source values cannot contain placeholders'
      USING ERRCODE = '22023';
  END IF;
  RETURN rendered;
END
$$;

CREATE TABLE platform.contract_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  template_key TEXT NOT NULL CHECK (
    template_key ~ '^contract_[a-z][a-z0-9_]{1,55}$'
  ),
  title TEXT NOT NULL CHECK (
    char_length(btrim(title)) BETWEEN 1 AND 240
    AND title = btrim(title)
    AND title !~ '[[:cntrl:]]'
  ),
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.contract_template_version_status NOT NULL DEFAULT 'draft',
  source_registry_id UUID NOT NULL,
  source_revision TEXT NOT NULL CHECK (
    source_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
  ),
  field_manifest JSONB NOT NULL CHECK (
    platform_private.contract_field_manifest_is_valid(field_manifest)
  ),
  template_text TEXT NOT NULL,
  template_sha256 TEXT NOT NULL CHECK (template_sha256 ~ '^[0-9a-f]{64}$'),
  post_contract_checklist_blueprint JSONB NOT NULL CHECK (
    platform_private.post_contract_blueprint_is_valid(
      post_contract_checklist_blueprint
    )
  ),
  blueprint_sha256 TEXT NOT NULL CHECK (blueprint_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_membership_id UUID NOT NULL,
  approved_by_membership_id UUID,
  approved_at TIMESTAMPTZ,
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT contract_template_versions_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT contract_template_versions_org_key_version_key
    UNIQUE (organization_id, template_key, version),
  CONSTRAINT contract_template_versions_source_fkey
    FOREIGN KEY (organization_id, source_registry_id)
    REFERENCES platform.source_registry(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_approved_by_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_retired_by_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT contract_template_versions_template_check CHECK (
    platform_private.contract_template_is_valid(template_text, field_manifest)
    AND template_sha256 = platform_private.bw6_text_sha256(template_text)
    AND blueprint_sha256 = platform_private.bw6_json_sha256(
      post_contract_checklist_blueprint
    )
  ),
  CONSTRAINT contract_template_versions_status_metadata_check CHECK (
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

CREATE UNIQUE INDEX contract_template_versions_one_approved_idx
  ON platform.contract_template_versions (organization_id, template_key)
  WHERE status = 'approved';

CREATE INDEX contract_template_versions_source_idx
  ON platform.contract_template_versions (
    organization_id,
    source_registry_id,
    version DESC
  );

CREATE TABLE platform.student_case_contract_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  contract_template_version_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.contract_artifact_status NOT NULL DEFAULT 'draft',
  input_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(input_snapshot) = 'object'
    AND input_snapshot ?& ARRAY['manifest_version', 'values', 'sources']
    AND input_snapshot -> 'manifest_version' = '1'::JSONB
    AND jsonb_typeof(input_snapshot -> 'values') = 'object'
    AND jsonb_typeof(input_snapshot -> 'sources') = 'object'
  ),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_text TEXT NOT NULL CHECK (
    char_length(rendered_text) BETWEEN 1 AND 100000
  ),
  rendered_sha256 TEXT NOT NULL CHECK (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_membership_id UUID NOT NULL,
  reviewed_by_membership_id UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_case_contract_drafts_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_case_contract_drafts_case_version_key
    UNIQUE (organization_id, student_case_id, version),
  CONSTRAINT student_case_contract_drafts_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_contract_drafts_template_fkey
    FOREIGN KEY (organization_id, contract_template_version_id)
    REFERENCES platform.contract_template_versions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_contract_drafts_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_contract_drafts_reviewed_by_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_case_contract_drafts_hash_check CHECK (
    input_sha256 = platform_private.bw6_json_sha256(input_snapshot)
    AND rendered_sha256 = platform_private.bw6_text_sha256(rendered_text)
  ),
  CONSTRAINT student_case_contract_drafts_status_metadata_check CHECK (
    (
      status = 'draft'
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
    )
    OR (
      status IN ('approved', 'rejected')
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX student_case_contract_drafts_case_idx
  ON platform.student_case_contract_drafts (
    organization_id,
    student_case_id,
    version DESC
  );

CREATE TABLE platform.post_contract_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  contract_template_version_id UUID NOT NULL,
  item_key TEXT NOT NULL CHECK (item_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label TEXT NOT NULL CHECK (
    char_length(btrim(label)) BETWEEN 1 AND 240
    AND label = btrim(label)
    AND label !~ '[[:cntrl:]]'
  ),
  status platform.post_contract_item_status NOT NULL DEFAULT 'open',
  owner_role platform.business_role NOT NULL CHECK (
    owner_role IN ('admin', 'curator')
  ),
  owner_membership_id UUID NOT NULL,
  next_action TEXT,
  evidence_ref TEXT,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_membership_id UUID NOT NULL,
  updated_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT post_contract_items_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT post_contract_items_template_item_key
    UNIQUE (
      organization_id,
      student_case_id,
      contract_template_version_id,
      item_key
    ),
  CONSTRAINT post_contract_items_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_items_template_fkey
    FOREIGN KEY (organization_id, contract_template_version_id)
    REFERENCES platform.contract_template_versions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_items_owner_fkey
    FOREIGN KEY (organization_id, owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_items_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_items_updated_by_fkey
    FOREIGN KEY (organization_id, updated_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_items_next_action_check CHECK (
    next_action IS NULL
    OR (
      char_length(btrim(next_action)) BETWEEN 1 AND 1000
      AND next_action = btrim(next_action)
      AND next_action !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT post_contract_items_evidence_check CHECK (
    evidence_ref IS NULL
    OR (
      char_length(btrim(evidence_ref)) BETWEEN 1 AND 512
      AND evidence_ref = btrim(evidence_ref)
      AND evidence_ref !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT post_contract_items_state_shape_check CHECK (
    (
      status = 'delivered'
      AND evidence_ref IS NOT NULL
    )
    OR (
      status IN ('open', 'in_progress', 'blocked')
      AND next_action IS NOT NULL
    )
  )
);

CREATE INDEX post_contract_items_case_status_idx
  ON platform.post_contract_items (
    organization_id,
    student_case_id,
    status,
    item_key
  );

CREATE TABLE platform.post_contract_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  contract_template_version_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.contract_artifact_status NOT NULL DEFAULT 'draft',
  total_item_count INTEGER NOT NULL CHECK (total_item_count > 0),
  delivered_item_count INTEGER NOT NULL CHECK (delivered_item_count >= 0),
  open_item_count INTEGER NOT NULL CHECK (open_item_count >= 0),
  in_progress_item_count INTEGER NOT NULL CHECK (in_progress_item_count >= 0),
  blocked_item_count INTEGER NOT NULL CHECK (blocked_item_count >= 0),
  item_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(item_snapshot) = 'array'
    AND jsonb_array_length(item_snapshot) = total_item_count
  ),
  report_sha256 TEXT NOT NULL CHECK (report_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_membership_id UUID NOT NULL,
  reviewed_by_membership_id UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT post_contract_reports_org_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT post_contract_reports_template_version_key
    UNIQUE (
      organization_id,
      student_case_id,
      contract_template_version_id,
      version
    ),
  CONSTRAINT post_contract_reports_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_reports_template_fkey
    FOREIGN KEY (organization_id, contract_template_version_id)
    REFERENCES platform.contract_template_versions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_reports_created_by_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_reports_reviewed_by_fkey
    FOREIGN KEY (organization_id, reviewed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT post_contract_reports_counts_check CHECK (
    total_item_count = delivered_item_count
      + open_item_count
      + in_progress_item_count
      + blocked_item_count
  ),
  CONSTRAINT post_contract_reports_hash_check CHECK (
    report_sha256 = platform_private.bw6_json_sha256(jsonb_build_object(
      'contract_template_version_id', contract_template_version_id,
      'total_item_count', total_item_count,
      'delivered_item_count', delivered_item_count,
      'open_item_count', open_item_count,
      'in_progress_item_count', in_progress_item_count,
      'blocked_item_count', blocked_item_count,
      'item_snapshot', item_snapshot
    ))
  ),
  CONSTRAINT post_contract_reports_status_metadata_check CHECK (
    (
      status = 'draft'
      AND reviewed_by_membership_id IS NULL
      AND reviewed_at IS NULL
    )
    OR (
      status IN ('approved', 'rejected')
      AND reviewed_by_membership_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX post_contract_reports_case_idx
  ON platform.post_contract_reports (
    organization_id,
    student_case_id,
    contract_template_version_id,
    version DESC
  );

ALTER TABLE platform.contract_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.contract_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_contract_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_case_contract_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.post_contract_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.post_contract_items FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.post_contract_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.post_contract_reports FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.guard_contract_template_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contract template versions are retained for audit'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.organization_id <> NEW.organization_id
    OR OLD.template_key <> NEW.template_key
    OR OLD.title <> NEW.title
    OR OLD.version <> NEW.version
    OR OLD.source_registry_id <> NEW.source_registry_id
    OR OLD.source_revision <> NEW.source_revision
    OR OLD.field_manifest <> NEW.field_manifest
    OR OLD.template_text <> NEW.template_text
    OR OLD.template_sha256 <> NEW.template_sha256
    OR OLD.post_contract_checklist_blueprint <>
      NEW.post_contract_checklist_blueprint
    OR OLD.blueprint_sha256 <> NEW.blueprint_sha256
    OR OLD.created_by_membership_id <> NEW.created_by_membership_id
    OR OLD.created_at <> NEW.created_at
    OR NOT (
      (
        OLD.status = 'draft'
        AND NEW.status = 'approved'
        AND OLD.approved_by_membership_id IS NULL
        AND OLD.approved_at IS NULL
        AND NEW.approved_by_membership_id IS NOT NULL
        AND NEW.approved_at IS NOT NULL
        AND NEW.retired_by_membership_id IS NULL
        AND NEW.retired_at IS NULL
      )
      OR (
        OLD.status = 'approved'
        AND NEW.status = 'retired'
        AND OLD.approved_by_membership_id = NEW.approved_by_membership_id
        AND OLD.approved_at = NEW.approved_at
        AND NEW.retired_by_membership_id IS NOT NULL
        AND NEW.retired_at IS NOT NULL
      )
    )
  THEN
    RAISE EXCEPTION 'Contract template version transition is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_contract_artifact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contract artifacts are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'student_case_contract_drafts' THEN
    IF OLD.id IS DISTINCT FROM NEW.id
      OR OLD.organization_id <> NEW.organization_id
      OR OLD.student_case_id <> NEW.student_case_id
      OR OLD.contract_template_version_id <> NEW.contract_template_version_id
      OR OLD.version <> NEW.version
      OR OLD.input_snapshot <> NEW.input_snapshot
      OR OLD.input_sha256 <> NEW.input_sha256
      OR OLD.rendered_text <> NEW.rendered_text
      OR OLD.rendered_sha256 <> NEW.rendered_sha256
      OR OLD.created_by_membership_id <> NEW.created_by_membership_id
      OR OLD.created_at <> NEW.created_at
    THEN
      RAISE EXCEPTION 'Contract draft payloads are immutable'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF OLD.id IS DISTINCT FROM NEW.id
      OR OLD.organization_id <> NEW.organization_id
      OR OLD.student_case_id <> NEW.student_case_id
      OR OLD.contract_template_version_id <> NEW.contract_template_version_id
      OR OLD.version <> NEW.version
      OR OLD.total_item_count <> NEW.total_item_count
      OR OLD.delivered_item_count <> NEW.delivered_item_count
      OR OLD.open_item_count <> NEW.open_item_count
      OR OLD.in_progress_item_count <> NEW.in_progress_item_count
      OR OLD.blocked_item_count <> NEW.blocked_item_count
      OR OLD.item_snapshot <> NEW.item_snapshot
      OR OLD.report_sha256 <> NEW.report_sha256
      OR OLD.created_by_membership_id <> NEW.created_by_membership_id
      OR OLD.created_at <> NEW.created_at
    THEN
      RAISE EXCEPTION 'Post-contract report payloads are immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD.status <> 'draft'
    OR NEW.status NOT IN ('approved', 'rejected')
    OR OLD.reviewed_by_membership_id IS NOT NULL
    OR OLD.reviewed_at IS NOT NULL
    OR NEW.reviewed_by_membership_id IS NULL
    OR NEW.reviewed_at IS NULL
  THEN
    RAISE EXCEPTION 'Contract artifact review transition is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_post_contract_item_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  owner platform.organization_memberships%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Post-contract items are retained for audit'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO owner
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = NEW.organization_id
    AND membership.id = NEW.owner_membership_id;
  IF NOT FOUND
    OR owner.status <> 'active'
    OR owner."current_role" IS DISTINCT FROM NEW.owner_role
    OR NEW.owner_role NOT IN ('admin', 'curator')
  THEN
    RAISE EXCEPTION 'Post-contract owner must be an active Admin or Curator'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.id IS DISTINCT FROM NEW.id
    OR OLD.organization_id <> NEW.organization_id
    OR OLD.student_case_id <> NEW.student_case_id
    OR OLD.contract_template_version_id <> NEW.contract_template_version_id
    OR OLD.item_key <> NEW.item_key
    OR OLD.label <> NEW.label
    OR OLD.created_by_membership_id <> NEW.created_by_membership_id
    OR OLD.created_at <> NEW.created_at
    OR NEW.revision <> OLD.revision + 1
    OR NEW.updated_by_membership_id IS NULL
    OR NEW.updated_at <= OLD.updated_at
  ) THEN
    RAISE EXCEPTION 'Post-contract item mutation is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER contract_template_versions_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.contract_template_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_contract_template_version_mutation();
CREATE TRIGGER contract_template_versions_no_truncate
  BEFORE TRUNCATE ON platform.contract_template_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER student_case_contract_drafts_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.student_case_contract_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_contract_artifact_mutation();
CREATE TRIGGER student_case_contract_drafts_no_truncate
  BEFORE TRUNCATE ON platform.student_case_contract_drafts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER post_contract_items_guard_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON platform.post_contract_items
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_post_contract_item_mutation();
CREATE TRIGGER post_contract_items_no_truncate
  BEFORE TRUNCATE ON platform.post_contract_items
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER post_contract_reports_guard_mutation
  BEFORE UPDATE OR DELETE ON platform.post_contract_reports
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_contract_artifact_mutation();
CREATE TRIGGER post_contract_reports_no_truncate
  BEFORE TRUNCATE ON platform.post_contract_reports
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON FUNCTION
  platform_private.bw6_json_sha256(JSONB),
  platform_private.bw6_text_sha256(TEXT),
  platform_private.validate_bw6_reason(TEXT),
  platform_private.lock_bw6_request(UUID),
  platform_private.contract_manifest_source_type(TEXT),
  platform_private.contract_field_manifest_is_valid(JSONB),
  platform_private.contract_template_is_valid(TEXT, JSONB),
  platform_private.post_contract_blueprint_is_valid(JSONB),
  platform_private.bw6_json_value_matches_type(JSONB, TEXT),
  platform_private.bw6_render_scalar(JSONB, TEXT),
  platform_private.guard_contract_template_version_mutation(),
  platform_private.guard_contract_artifact_mutation(),
  platform_private.guard_post_contract_item_mutation()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Immutable v11 bundles clone v10 and add only the BW6 permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('contract.template.read', 'Read source-reviewed contract template versions'),
  ('contract.template.manage', 'Create, approve and retire contract template versions'),
  ('contract.draft.manage', 'Generate and review authorized student-case contract drafts'),
  ('post.contract.manage', 'Manage post-contract checklist items and reports');

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000001001', 'admin', 11, 'draft', 'Admin v11 contract and post-contract workflow'),
  ('00000000-0000-4000-8000-000000001002', 'sales', 11, 'draft', 'Sales v11 pending-case contract drafts'),
  ('00000000-0000-4000-8000-000000001003', 'curator', 11, 'draft', 'Curator v11 assigned-case contract workflow'),
  ('00000000-0000-4000-8000-000000001004', 'finance', 11, 'draft', 'Finance v11 unchanged'),
  ('00000000-0000-4000-8000-000000001005', 'student', 11, 'draft', 'Student v11 unchanged');

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v11.id, v11.role, v10_permission.permission_key
FROM platform.role_bundle_versions AS v11
JOIN platform.role_bundle_versions AS v10
  ON v10.role = v11.role
  AND v10.version = 10
  AND v10.status = 'published'
JOIN platform.role_bundle_permissions AS v10_permission
  ON v10_permission.bundle_id = v10.id
  AND v10_permission.bundle_role = v10.role
WHERE v11.version = 11;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 11
  AND (
    (
      bundle.role = 'admin'
      AND permission.permission_key IN (
        'contract.template.read',
        'contract.template.manage',
        'contract.draft.manage',
        'post.contract.manage'
      )
    )
    OR (
      bundle.role = 'sales'
      AND permission.permission_key IN (
        'contract.template.read',
        'contract.draft.manage'
      )
    )
    OR (
      bundle.role = 'curator'
      AND permission.permission_key IN (
        'contract.template.read',
        'contract.draft.manage',
        'post.contract.manage'
      )
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 11;

CREATE TEMPORARY TABLE bw6_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v11.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v10
  ON v10.id = membership.current_bundle_id
  AND v10.role = membership."current_role"
  AND v10.version = 10
  AND v10.status = 'published'
JOIN platform.role_bundle_versions AS v11
  ON v11.role = membership."current_role"
  AND v11.version = 11
  AND v11.status = 'published'
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
  'BW6 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw6_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw6_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM bw6_membership_bundle_upgrades AS upgrade
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
  'migration:057_platform_contract_draft_report',
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
  'BW6 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw6_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION private.platform_can_read_contract_template(
  p_organization_id UUID,
  p_status platform.contract_template_version_status
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
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id,
        'contract.template.read'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND private.platform_has_scope(
            p_organization_id,
            'organization',
            p_organization_id
          )
        )
        OR (
          membership."current_role" IN ('sales', 'curator')
          AND p_status = 'approved'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_access_bw6_case(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_permission_key TEXT,
  p_post_contract_only BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.student_cases AS student_case
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = student_case.organization_id
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = p_student_case_id
      AND profile.auth_user_id = (SELECT auth.uid())
      AND profile.status = 'active'
      AND membership.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND membership."current_role"::TEXT =
        (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT =
        (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id,
        p_permission_key
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND private.platform_has_scope(
            p_organization_id,
            'organization',
            p_organization_id
          )
        )
        OR (
          NOT p_post_contract_only
          AND membership."current_role" = 'sales'
          AND student_case.state = 'pending'
          AND student_case.responsible_sales_membership_id = membership.id
          AND private.platform_has_scope(
            p_organization_id,
            'student_case',
            p_student_case_id
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND private.platform_has_scope(
            p_organization_id,
            'student_case',
            p_student_case_id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION
  private.platform_can_read_contract_template(
    UUID,
    platform.contract_template_version_status
  ),
  private.platform_can_access_bw6_case(UUID, UUID, TEXT, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  private.platform_can_read_contract_template(
    UUID,
    platform.contract_template_version_status
  ),
  private.platform_can_access_bw6_case(UUID, UUID, TEXT, BOOLEAN)
TO authenticated;

CREATE POLICY contract_template_versions_read
  ON platform.contract_template_versions
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_contract_template(
      organization_id,
      status
    ))
  );

CREATE POLICY student_case_contract_drafts_read
  ON platform.student_case_contract_drafts
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_access_bw6_case(
      organization_id,
      student_case_id,
      'contract.draft.manage',
      FALSE
    ))
  );

CREATE POLICY post_contract_items_read
  ON platform.post_contract_items
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_access_bw6_case(
      organization_id,
      student_case_id,
      'post.contract.manage',
      TRUE
    ))
  );

CREATE POLICY post_contract_reports_read
  ON platform.post_contract_reports
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_access_bw6_case(
      organization_id,
      student_case_id,
      'post.contract.manage',
      TRUE
    ))
  );

CREATE OR REPLACE FUNCTION platform_private.require_bw6_admin_actor(
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
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'contract.template.manage'
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

CREATE OR REPLACE FUNCTION platform_private.require_bw6_case_actor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_permission_key TEXT,
  p_post_contract_only BOOLEAN DEFAULT FALSE
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
  student_case platform.student_cases%ROWTYPE;
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_case_id is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    p_permission_key
  );
  SELECT * INTO student_case
  FROM platform.student_cases AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authorized student case is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (
      actor.actor_role = 'admin'
      AND private.platform_has_scope(
        p_organization_id,
        'organization',
        p_organization_id
      )
    )
    OR (
      NOT p_post_contract_only
      AND actor.actor_role = 'sales'
      AND student_case.state = 'pending'
      AND student_case.responsible_sales_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
    OR (
      actor.actor_role = 'curator'
      AND student_case.state IN ('active', 'closed')
      AND student_case.current_curator_membership_id =
        actor.actor_membership_id
      AND private.platform_has_scope(
        p_organization_id,
        'student_case',
        p_student_case_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Actor is not authorized for this student case state'
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
  platform_private.require_bw6_admin_actor(UUID),
  platform_private.require_bw6_case_actor(UUID, UUID, TEXT, BOOLEAN)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.create_contract_template_version(
  p_organization_id UUID,
  p_template_key TEXT,
  p_title TEXT,
  p_source_registry_id UUID,
  p_field_manifest JSONB,
  p_template_text TEXT,
  p_post_contract_checklist_blueprint JSONB,
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
  normalized_title TEXT := btrim(p_title);
  template_sha256 TEXT;
  blueprint_sha256 TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  created_id UUID := gen_random_uuid();
  next_version BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_source_registry_id IS NULL
    OR p_template_key IS NULL
    OR p_template_key !~ '^contract_[a-z][a-z0-9_]{1,55}$'
    OR normalized_title IS NULL
    OR char_length(normalized_title) NOT BETWEEN 1 AND 240
    OR NOT platform_private.contract_template_is_valid(
      p_template_text,
      p_field_manifest
    )
    OR NOT platform_private.post_contract_blueprint_is_valid(
      p_post_contract_checklist_blueprint
    )
  THEN
    RAISE EXCEPTION 'A complete bounded contract template version is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_bw6_admin_actor(p_organization_id);
  template_sha256 := platform_private.bw6_text_sha256(p_template_text);
  blueprint_sha256 := platform_private.bw6_json_sha256(
    p_post_contract_checklist_blueprint
  );
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'template_key', p_template_key,
    'title', normalized_title,
    'source_registry_id', p_source_registry_id,
    'field_manifest', p_field_manifest,
    'template_sha256', template_sha256,
    'blueprint_sha256', blueprint_sha256
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'contract.template.version.create',
    'contract_template_version',
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
  THEN
    RAISE EXCEPTION 'A reviewed source with an exact revision is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw6:template:' || p_organization_id::TEXT || ':' || p_template_key,
    0
  ));
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM platform.contract_template_versions AS template
  WHERE template.organization_id = p_organization_id
    AND template.template_key = p_template_key;

  INSERT INTO platform.contract_template_versions (
    id,
    organization_id,
    template_key,
    title,
    version,
    source_registry_id,
    source_revision,
    field_manifest,
    template_text,
    template_sha256,
    post_contract_checklist_blueprint,
    blueprint_sha256,
    created_by_membership_id
  ) VALUES (
    created_id,
    p_organization_id,
    p_template_key,
    normalized_title,
    next_version,
    p_source_registry_id,
    source_row.source_revision,
    p_field_manifest,
    p_template_text,
    template_sha256,
    p_post_contract_checklist_blueprint,
    blueprint_sha256,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_template_version_id', created_id,
    'template_key', p_template_key,
    'version', next_version,
    'status', 'draft',
    'source_registry_id', p_source_registry_id,
    'source_revision', source_row.source_revision,
    'template_sha256', template_sha256,
    'blueprint_sha256', blueprint_sha256,
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
    'contract.template.version.create', 'contract_template_version',
    created_id, NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.approve_contract_template_version(
  p_organization_id UUID,
  p_contract_template_version_id UUID,
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
  target platform.contract_template_versions%ROWTYPE;
  source_row platform.source_registry%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL OR p_contract_template_version_id IS NULL THEN
    RAISE EXCEPTION 'Contract template version is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_admin_actor(p_organization_id);
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_template_version_id', p_contract_template_version_id
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'contract.template.version.approve',
    'contract_template_version',
    p_contract_template_version_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target
  FROM platform.contract_template_versions AS template
  WHERE template.organization_id = p_organization_id
    AND template.id = p_contract_template_version_id
  FOR UPDATE;
  IF NOT FOUND OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'A draft contract template version is required'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO source_row
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = target.source_registry_id
  FOR UPDATE;
  IF NOT FOUND
    OR source_row.review_status <> 'reviewed'
    OR source_row.source_revision IS DISTINCT FROM target.source_revision
  THEN
    RAISE EXCEPTION 'The pinned source revision must remain reviewed'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM platform.contract_template_versions AS approved
    WHERE approved.organization_id = p_organization_id
      AND approved.template_key = target.template_key
      AND approved.status = 'approved'
      AND approved.id <> target.id
  ) THEN
    RAISE EXCEPTION 'Retire the currently approved template version first'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.contract_template_versions
  SET
    status = 'approved',
    approved_by_membership_id = actor.actor_membership_id,
    approved_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_contract_template_version_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_template_version_id', target.id,
    'template_key', target.template_key,
    'version', target.version,
    'status', 'approved',
    'source_registry_id', target.source_registry_id,
    'source_revision', target.source_revision,
    'template_sha256', target.template_sha256,
    'blueprint_sha256', target.blueprint_sha256,
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
    'contract.template.version.approve', 'contract_template_version',
    target.id, jsonb_build_object('status', target.status), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_contract_template_version(
  p_organization_id UUID,
  p_contract_template_version_id UUID,
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
  target platform.contract_template_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL OR p_contract_template_version_id IS NULL THEN
    RAISE EXCEPTION 'Contract template version is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_admin_actor(p_organization_id);
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_template_version_id', p_contract_template_version_id
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'contract.template.version.retire',
    'contract_template_version',
    p_contract_template_version_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target
  FROM platform.contract_template_versions AS template
  WHERE template.organization_id = p_organization_id
    AND template.id = p_contract_template_version_id
  FOR UPDATE;
  IF NOT FOUND OR target.status <> 'approved' THEN
    RAISE EXCEPTION 'An approved contract template version is required'
      USING ERRCODE = '55000';
  END IF;
  UPDATE platform.contract_template_versions
  SET
    status = 'retired',
    retired_by_membership_id = actor.actor_membership_id,
    retired_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_contract_template_version_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'contract_template_version_id', target.id,
    'template_key', target.template_key,
    'version', target.version,
    'status', 'retired',
    'source_registry_id', target.source_registry_id,
    'source_revision', target.source_revision,
    'template_sha256', target.template_sha256,
    'blueprint_sha256', target.blueprint_sha256,
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
    'contract.template.version.retire', 'contract_template_version',
    target.id, jsonb_build_object('status', target.status), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.generate_student_case_contract_draft(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_contract_template_version_id UUID,
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
  student_case platform.student_cases%ROWTYPE;
  student_profile platform.student_profiles%ROWTYPE;
  country_requirement platform.country_requirement_versions%ROWTYPE;
  handoff platform.student_case_op_handoffs%ROWTYPE;
  template platform.contract_template_versions%ROWTYPE;
  source_row platform.source_registry%ROWTYPE;
  manifest_entry JSONB;
  field_key TEXT;
  source_path TEXT;
  value_type TEXT;
  source_value JSONB;
  source_values JSONB;
  values_snapshot JSONB := '{}'::JSONB;
  input_snapshot JSONB;
  input_sha256 TEXT;
  rendered_text TEXT;
  rendered_sha256 TEXT;
  normalized_reason TEXT;
  replayed JSONB;
  created_id UUID := gen_random_uuid();
  next_version BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_contract_template_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Case and approved contract template are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'contract.draft.manage',
    FALSE
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'contract.draft.generate',
    'student_case_contract_draft',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'contract_template_version_id', p_contract_template_version_id,
      'actor_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO student_case
  FROM platform.student_cases AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND
    OR student_case.contract_confirmed_at IS NULL
    OR student_case.contract_confirmation_ref IS NULL
  THEN
    RAISE EXCEPTION 'A confirmed student case is required'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO handoff
  FROM platform.student_case_op_handoffs AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An approved OP-to-OZO handoff is required'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO template
  FROM platform.contract_template_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_contract_template_version_id
  FOR SHARE;
  IF NOT FOUND OR template.status <> 'approved' THEN
    RAISE EXCEPTION 'An approved contract template version is required'
      USING ERRCODE = '55000';
  END IF;
  SELECT * INTO source_row
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = template.source_registry_id;
  IF NOT FOUND
    OR source_row.review_status <> 'reviewed'
    OR source_row.source_revision IS DISTINCT FROM template.source_revision
  THEN
    RAISE EXCEPTION 'The template source revision must remain reviewed'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO student_profile
  FROM platform.student_profiles AS profile
  WHERE profile.organization_id = p_organization_id
    AND profile.student_case_id = p_student_case_id;
  IF student_case.applied_country_requirement_version_id IS NOT NULL THEN
    SELECT * INTO country_requirement
    FROM platform.country_requirement_versions AS requirement
    WHERE requirement.organization_id = p_organization_id
      AND requirement.id =
        student_case.applied_country_requirement_version_id;
  END IF;

  source_values := jsonb_build_object(
    'student_case.student_display_name', student_case.student_display_name,
    'student_case.target_country', student_case.target_country,
    'student_case.target_degree', student_case.target_degree,
    'student_case.program_direction', student_case.program_direction,
    'student_case.intake', student_case.intake,
    'student_case.contract_confirmed_at', to_char(
      student_case.contract_confirmed_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'student_profile.preferred_display_name',
      student_profile.preferred_display_name,
    'student_profile.legal_display_name', student_profile.legal_display_name,
    'student_profile.communication_language',
      student_profile.communication_language,
    'student_profile.date_of_birth', to_char(
      student_profile.date_of_birth,
      'YYYY-MM-DD'
    ),
    'student_profile.citizenship_country',
      student_profile.citizenship_country,
    'student_profile.residency_country', student_profile.residency_country,
    'student_profile.current_education_summary',
      student_profile.current_education_summary,
    'student_profile.academic_summary', student_profile.academic_summary,
    'student_profile.language_summary', student_profile.language_summary,
    'student_profile.budget_band', student_profile.budget_band,
    'country_requirement.target_country', country_requirement.target_country,
    'country_requirement.target_degree', country_requirement.target_degree,
    'country_requirement.program_direction',
      country_requirement.program_direction,
    'country_requirement.version', country_requirement.version,
    'handoff.next_step', handoff.next_step,
    'handoff.due_at', to_char(
      handoff.due_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'handoff.responsible_role', handoff.responsible_role::TEXT,
    'handoff.approved_commercial_fields.service_package',
      handoff.approved_commercial_fields -> 'service_package',
    'handoff.approved_commercial_fields.fee_currency',
      handoff.approved_commercial_fields -> 'fee_currency',
    'handoff.approved_commercial_fields.fee_amount_minor',
      handoff.approved_commercial_fields -> 'fee_amount_minor',
    'handoff.approved_commercial_fields.payment_terms',
      handoff.approved_commercial_fields -> 'payment_terms'
  );
  rendered_text := template.template_text;
  FOR manifest_entry IN
    SELECT entry.value
    FROM jsonb_array_elements(template.field_manifest) AS entry(value)
  LOOP
    field_key := manifest_entry ->> 'field_key';
    source_path := manifest_entry ->> 'source_path';
    value_type := manifest_entry ->> 'value_type';
    source_value := source_values -> source_path;
    IF COALESCE((manifest_entry ->> 'required')::BOOLEAN, FALSE)
      AND (source_value IS NULL OR source_value = 'null'::JSONB)
    THEN
      RAISE EXCEPTION 'Required contract source % is unavailable', source_path
        USING ERRCODE = '22023';
    END IF;
    IF NOT platform_private.bw6_json_value_matches_type(
      source_value,
      value_type
    ) THEN
      RAISE EXCEPTION 'Contract source % violates declared type %',
        source_path, value_type
        USING ERRCODE = '22023';
    END IF;
    values_snapshot := values_snapshot || jsonb_build_object(
      field_key,
      COALESCE(source_value, 'null'::JSONB)
    );
    rendered_text := replace(
      rendered_text,
      '{{' || field_key || '}}',
      platform_private.bw6_render_scalar(source_value, value_type)
    );
  END LOOP;
  IF rendered_text ~ '\{\{|\}\}'
    OR char_length(rendered_text) NOT BETWEEN 1 AND 100000
  THEN
    RAISE EXCEPTION 'Contract rendering left an unresolved placeholder'
      USING ERRCODE = '22023';
  END IF;

  input_snapshot := jsonb_build_object(
    'manifest_version', 1,
    'values', values_snapshot,
    'sources', jsonb_build_object(
      'student_case_id', student_case.id,
      'student_profile_id', student_profile.id,
      'student_profile_revision', student_profile.revision,
      'country_requirement_version_id', country_requirement.id,
      'country_requirement_version', country_requirement.version,
      'student_case_op_handoff_id', handoff.id
    )
  );
  input_sha256 := platform_private.bw6_json_sha256(input_snapshot);
  rendered_sha256 := platform_private.bw6_text_sha256(rendered_text);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw6:contract-draft:' || p_organization_id::TEXT || ':' ||
      p_student_case_id::TEXT,
    0
  ));
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM platform.student_case_contract_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.student_case_id = p_student_case_id;

  INSERT INTO platform.student_case_contract_drafts (
    id,
    organization_id,
    student_case_id,
    contract_template_version_id,
    version,
    input_snapshot,
    input_sha256,
    rendered_text,
    rendered_sha256,
    created_by_membership_id
  ) VALUES (
    created_id,
    p_organization_id,
    p_student_case_id,
    p_contract_template_version_id,
    next_version,
    input_snapshot,
    input_sha256,
    rendered_text,
    rendered_sha256,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'student_case_contract_draft_id', created_id,
    'contract_template_version_id', p_contract_template_version_id,
    'version', next_version,
    'status', 'draft',
    'input_sha256', input_sha256,
    'rendered_sha256', rendered_sha256,
    'actor_membership_id', actor.actor_membership_id
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'contract.draft.generate', 'student_case_contract_draft', created_id,
    NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_student_case_contract_draft(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_student_case_contract_draft_id UUID,
  p_decision platform.contract_artifact_review_decision,
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
  target platform.student_case_contract_drafts%ROWTYPE;
  normalized_reason TEXT;
  mutation_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_student_case_contract_draft_id IS NULL
    OR p_decision IS NULL
  THEN
    RAISE EXCEPTION 'Contract draft and review decision are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'contract.draft.manage',
    FALSE
  );
  mutation_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'student_case_contract_draft_id', p_student_case_contract_draft_id,
    'decision', p_decision
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'contract.draft.review',
    'student_case_contract_draft',
    p_student_case_contract_draft_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'decision', p_decision,
      'actor_membership_id', actor.actor_membership_id,
      'mutation_sha256', mutation_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target
  FROM platform.student_case_contract_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.student_case_id = p_student_case_id
    AND draft.id = p_student_case_contract_draft_id
  FOR UPDATE;
  IF NOT FOUND OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'A draft contract artifact is required'
      USING ERRCODE = '55000';
  END IF;
  UPDATE platform.student_case_contract_drafts
  SET
    status = p_decision::TEXT::platform.contract_artifact_status,
    reviewed_by_membership_id = actor.actor_membership_id,
    reviewed_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_student_case_contract_draft_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'student_case_contract_draft_id', target.id,
    'contract_template_version_id', target.contract_template_version_id,
    'version', target.version,
    'decision', p_decision,
    'status', p_decision,
    'input_sha256', target.input_sha256,
    'rendered_sha256', target.rendered_sha256,
    'actor_membership_id', actor.actor_membership_id,
    'mutation_sha256', mutation_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'contract.draft.review', 'student_case_contract_draft', target.id,
    jsonb_build_object('status', target.status), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.seed_post_contract_items(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_contract_template_version_id UUID,
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
  student_case platform.student_cases%ROWTYPE;
  template platform.contract_template_versions%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  seeded_item_count INTEGER := 0;
  existing_item_count INTEGER := 0;
  total_item_count INTEGER := 0;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_contract_template_version_id IS NULL
  THEN
    RAISE EXCEPTION 'Case and approved contract template are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'post.contract.manage',
    TRUE
  );
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'contract_template_version_id', p_contract_template_version_id
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'post.contract.items.seed',
    'post_contract_item_set',
    p_student_case_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'contract_template_version_id', p_contract_template_version_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO student_case
  FROM platform.student_cases AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_student_case_id
  FOR UPDATE;
  SELECT * INTO template
  FROM platform.contract_template_versions AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_contract_template_version_id
  FOR SHARE;
  IF NOT FOUND OR template.status <> 'approved' THEN
    RAISE EXCEPTION 'An approved contract template version is required'
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM platform.student_case_contract_drafts AS draft
    WHERE draft.organization_id = p_organization_id
      AND draft.student_case_id = p_student_case_id
      AND draft.contract_template_version_id = p_contract_template_version_id
      AND draft.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'An approved contract draft is required before post-contract work'
      USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw6:post-contract-items:' || p_organization_id::TEXT || ':' ||
      p_student_case_id::TEXT || ':' || p_contract_template_version_id::TEXT,
    0
  ));
  SELECT count(*)::INTEGER INTO existing_item_count
  FROM platform.post_contract_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.student_case_id = p_student_case_id
    AND item.contract_template_version_id = p_contract_template_version_id;

  INSERT INTO platform.post_contract_items (
    organization_id,
    student_case_id,
    contract_template_version_id,
    item_key,
    label,
    status,
    owner_role,
    owner_membership_id,
    next_action,
    created_by_membership_id,
    updated_by_membership_id
  )
  SELECT
    p_organization_id,
    p_student_case_id,
    p_contract_template_version_id,
    entry.value ->> 'item_key',
    btrim(entry.value ->> 'label'),
    'open'::platform.post_contract_item_status,
    (entry.value ->> 'owner_role')::platform.business_role,
    CASE entry.value ->> 'owner_role'
      WHEN 'curator' THEN student_case.current_curator_membership_id
      WHEN 'admin' THEN template.approved_by_membership_id
    END,
    btrim(entry.value ->> 'next_action'),
    actor.actor_membership_id,
    actor.actor_membership_id
  FROM jsonb_array_elements(
    template.post_contract_checklist_blueprint
  ) AS entry(value)
  ON CONFLICT (
    organization_id,
    student_case_id,
    contract_template_version_id,
    item_key
  ) DO NOTHING;
  GET DIAGNOSTICS seeded_item_count = ROW_COUNT;

  SELECT count(*)::INTEGER INTO total_item_count
  FROM platform.post_contract_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.student_case_id = p_student_case_id
    AND item.contract_template_version_id = p_contract_template_version_id;
  IF total_item_count <>
    jsonb_array_length(template.post_contract_checklist_blueprint)
  THEN
    RAISE EXCEPTION 'Post-contract checklist does not match its approved blueprint'
      USING ERRCODE = '55000';
  END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'contract_template_version_id', p_contract_template_version_id,
    'seeded_item_count', seeded_item_count,
    'existing_item_count', existing_item_count,
    'total_item_count', total_item_count,
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
    'post.contract.items.seed', 'post_contract_item_set', p_student_case_id,
    jsonb_build_object('existing_item_count', existing_item_count), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.update_post_contract_item(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_post_contract_item_id UUID,
  p_expected_revision BIGINT,
  p_status platform.post_contract_item_status,
  p_owner_membership_id UUID,
  p_next_action TEXT,
  p_evidence_ref TEXT,
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
  target platform.post_contract_items%ROWTYPE;
  owner platform.organization_memberships%ROWTYPE;
  normalized_reason TEXT;
  normalized_next_action TEXT := NULLIF(btrim(p_next_action), '');
  normalized_evidence_ref TEXT := NULLIF(btrim(p_evidence_ref), '');
  input_sha256 TEXT;
  replayed JSONB;
  next_revision BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_post_contract_item_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision <= 0
    OR p_status IS NULL
    OR p_owner_membership_id IS NULL
    OR (
      p_status = 'delivered'
      AND normalized_evidence_ref IS NULL
    )
    OR (
      p_status IN ('open', 'in_progress', 'blocked')
      AND normalized_next_action IS NULL
    )
    OR char_length(COALESCE(normalized_next_action, '')) > 1000
    OR char_length(COALESCE(normalized_evidence_ref, '')) > 512
  THEN
    RAISE EXCEPTION 'A valid post-contract item state is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'post.contract.manage',
    TRUE
  );
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'post_contract_item_id', p_post_contract_item_id,
    'expected_revision', p_expected_revision,
    'status', p_status,
    'owner_membership_id', p_owner_membership_id,
    'next_action', normalized_next_action,
    'evidence_ref', normalized_evidence_ref
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'post.contract.item.update',
    'post_contract_item',
    p_post_contract_item_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target
  FROM platform.post_contract_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.student_case_id = p_student_case_id
    AND item.id = p_post_contract_item_id
  FOR UPDATE;
  IF NOT FOUND OR target.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Post-contract item revision is stale or inaccessible'
      USING ERRCODE = '40001';
  END IF;
  SELECT * INTO owner
  FROM platform.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.id = p_owner_membership_id;
  IF NOT FOUND
    OR owner.status <> 'active'
    OR owner."current_role" NOT IN ('admin', 'curator')
  THEN
    RAISE EXCEPTION 'An active Admin or Curator owner is required'
      USING ERRCODE = '22023';
  END IF;
  next_revision := target.revision + 1;
  UPDATE platform.post_contract_items
  SET
    status = p_status,
    owner_role = owner."current_role",
    owner_membership_id = p_owner_membership_id,
    next_action = normalized_next_action,
    evidence_ref = normalized_evidence_ref,
    revision = next_revision,
    updated_by_membership_id = actor.actor_membership_id,
    updated_at = clock_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_post_contract_item_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'post_contract_item_id', target.id,
    'status', p_status,
    'owner_role', owner."current_role",
    'owner_membership_id', p_owner_membership_id,
    'next_action', normalized_next_action,
    'evidence_ref', normalized_evidence_ref,
    'revision', next_revision,
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
    'post.contract.item.update', 'post_contract_item', target.id,
    jsonb_build_object(
      'status', target.status,
      'owner_role', target.owner_role,
      'owner_membership_id', target.owner_membership_id,
      'next_action', target.next_action,
      'evidence_ref', target.evidence_ref,
      'revision', target.revision
    ),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.generate_post_contract_report(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_contract_template_version_id UUID,
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
  normalized_reason TEXT;
  replayed JSONB;
  item_snapshot JSONB;
  total_item_count INTEGER;
  delivered_item_count INTEGER;
  open_item_count INTEGER;
  in_progress_item_count INTEGER;
  blocked_item_count INTEGER;
  report_sha256 TEXT;
  input_sha256 TEXT;
  created_id UUID := gen_random_uuid();
  next_version BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_contract_template_version_id IS NULL
  THEN
    RAISE EXCEPTION 'student_case_id and contract_template_version_id are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'post.contract.manage',
    TRUE
  );
  replayed := platform_private.replay_audit(
    p_request_id,
    'post.contract.report.generate',
    'post_contract_report',
    NULL,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'contract_template_version_id', p_contract_template_version_id,
      'actor_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw6:post-contract-report:' || p_organization_id::TEXT || ':' ||
      p_student_case_id::TEXT || ':' || p_contract_template_version_id::TEXT,
    0
  ));
  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE item.status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE item.status = 'open')::INTEGER,
    count(*) FILTER (WHERE item.status = 'in_progress')::INTEGER,
    count(*) FILTER (WHERE item.status = 'blocked')::INTEGER,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'item_key', item.item_key,
        'label', item.label,
        'status', item.status,
        'owner_role', item.owner_role,
        'owner_membership_id', item.owner_membership_id,
        'next_action', item.next_action,
        'evidence_ref', item.evidence_ref,
        'revision', item.revision,
        'updated_at', item.updated_at
      ) ORDER BY item.item_key, item.id
    ), '[]'::JSONB)
  INTO
    total_item_count,
    delivered_item_count,
    open_item_count,
    in_progress_item_count,
    blocked_item_count,
    item_snapshot
  FROM platform.post_contract_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.student_case_id = p_student_case_id
    AND item.contract_template_version_id = p_contract_template_version_id;
  IF total_item_count = 0 THEN
    RAISE EXCEPTION 'Seeded post-contract items are required'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM platform.post_contract_items AS item
    WHERE item.organization_id = p_organization_id
      AND item.student_case_id = p_student_case_id
      AND item.contract_template_version_id = p_contract_template_version_id
      AND (
        (item.status = 'delivered' AND item.evidence_ref IS NULL)
        OR (
          item.status IN ('open', 'in_progress', 'blocked')
          AND (
            item.owner_membership_id IS NULL
            OR item.next_action IS NULL
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Every report item must satisfy evidence and next-action rules'
      USING ERRCODE = '55000';
  END IF;

  report_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'contract_template_version_id', p_contract_template_version_id,
    'total_item_count', total_item_count,
    'delivered_item_count', delivered_item_count,
    'open_item_count', open_item_count,
    'in_progress_item_count', in_progress_item_count,
    'blocked_item_count', blocked_item_count,
    'item_snapshot', item_snapshot
  ));
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'contract_template_version_id', p_contract_template_version_id,
    'item_snapshot', item_snapshot
  ));
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM platform.post_contract_reports AS report
  WHERE report.organization_id = p_organization_id
    AND report.student_case_id = p_student_case_id
    AND report.contract_template_version_id = p_contract_template_version_id;

  INSERT INTO platform.post_contract_reports (
    id,
    organization_id,
    student_case_id,
    contract_template_version_id,
    version,
    total_item_count,
    delivered_item_count,
    open_item_count,
    in_progress_item_count,
    blocked_item_count,
    item_snapshot,
    report_sha256,
    created_by_membership_id
  ) VALUES (
    created_id,
    p_organization_id,
    p_student_case_id,
    p_contract_template_version_id,
    next_version,
    total_item_count,
    delivered_item_count,
    open_item_count,
    in_progress_item_count,
    blocked_item_count,
    item_snapshot,
    report_sha256,
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'contract_template_version_id', p_contract_template_version_id,
    'post_contract_report_id', created_id,
    'version', next_version,
    'status', 'draft',
    'total_item_count', total_item_count,
    'delivered_item_count', delivered_item_count,
    'open_item_count', open_item_count,
    'in_progress_item_count', in_progress_item_count,
    'blocked_item_count', blocked_item_count,
    'report_sha256', report_sha256,
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
    'post.contract.report.generate', 'post_contract_report', created_id,
    NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.review_post_contract_report(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_post_contract_report_id UUID,
  p_decision platform.contract_artifact_review_decision,
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
  target platform.post_contract_reports%ROWTYPE;
  normalized_reason TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_bw6_request(p_request_id);
  normalized_reason := platform_private.validate_bw6_reason(p_reason);
  IF p_organization_id IS NULL
    OR p_student_case_id IS NULL
    OR p_post_contract_report_id IS NULL
    OR p_decision IS NULL
  THEN
    RAISE EXCEPTION 'Post-contract report and review decision are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_bw6_case_actor(
    p_organization_id,
    p_student_case_id,
    'post.contract.manage',
    TRUE
  );
  input_sha256 := platform_private.bw6_json_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'post_contract_report_id', p_post_contract_report_id,
    'decision', p_decision
  ));
  replayed := platform_private.replay_audit(
    p_request_id,
    'post.contract.report.review',
    'post_contract_report',
    p_post_contract_report_id,
    normalized_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'student_case_id', p_student_case_id,
      'decision', p_decision,
      'actor_membership_id', actor.actor_membership_id,
      'input_sha256', input_sha256
    )
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT * INTO target
  FROM platform.post_contract_reports AS report
  WHERE report.organization_id = p_organization_id
    AND report.student_case_id = p_student_case_id
    AND report.id = p_post_contract_report_id
  FOR UPDATE;
  IF NOT FOUND OR target.status <> 'draft' THEN
    RAISE EXCEPTION 'A draft post-contract report is required'
      USING ERRCODE = '55000';
  END IF;
  UPDATE platform.post_contract_reports
  SET
    status = p_decision::TEXT::platform.contract_artifact_status,
    reviewed_by_membership_id = actor.actor_membership_id,
    reviewed_at = statement_timestamp()
  WHERE organization_id = p_organization_id
    AND id = p_post_contract_report_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'contract_template_version_id', target.contract_template_version_id,
    'post_contract_report_id', target.id,
    'version', target.version,
    'decision', p_decision,
    'status', p_decision,
    'total_item_count', target.total_item_count,
    'delivered_item_count', target.delivered_item_count,
    'open_item_count', target.open_item_count,
    'in_progress_item_count', target.in_progress_item_count,
    'blocked_item_count', target.blocked_item_count,
    'report_sha256', target.report_sha256,
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
    'post.contract.report.review', 'post_contract_report', target.id,
    jsonb_build_object('status', target.status), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_case_contract_workspace(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  student_case platform.student_cases%ROWTYPE;
  can_manage_templates BOOLEAN := FALSE;
  can_generate_contract BOOLEAN := FALSE;
  can_review_contract BOOLEAN := FALSE;
  can_manage_post_contract BOOLEAN := FALSE;
  can_review_report BOOLEAN := FALSE;
  reviewed_sources JSONB := '[]'::JSONB;
  templates JSONB := '[]'::JSONB;
  drafts JSONB := '[]'::JSONB;
  items JSONB := '[]'::JSONB;
  reports JSONB := '[]'::JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'Organization and student case are required'
      USING ERRCODE = '22023';
  END IF;
  SELECT
    profile.id AS actor_profile_id,
    membership.id AS actor_membership_id,
    profile.auth_user_id AS actor_auth_user_id,
    membership."current_role" AS actor_role
  INTO actor
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
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND membership."current_role"::TEXT =
      (SELECT auth.jwt() ->> 'platform_role')
    AND profile.access_version::TEXT =
      (SELECT auth.jwt() ->> 'platform_access_version');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Platform authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO student_case
  FROM platform.student_cases AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authorized student case is required'
      USING ERRCODE = '42501';
  END IF;

  can_manage_templates :=
    actor.actor_role = 'admin'
    AND private.platform_has_permission(
      p_organization_id,
      'contract.template.manage'
    )
    AND private.platform_has_scope(
      p_organization_id,
      'organization',
      p_organization_id
    );
  can_generate_contract :=
    private.platform_has_permission(
      p_organization_id,
      'contract.draft.manage'
    )
    AND (
      can_manage_templates
      OR (
        actor.actor_role = 'sales'
        AND student_case.state = 'pending'
        AND student_case.responsible_sales_membership_id =
          actor.actor_membership_id
        AND private.platform_has_scope(
          p_organization_id,
          'student_case',
          p_student_case_id
        )
      )
      OR (
        actor.actor_role = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id =
          actor.actor_membership_id
        AND private.platform_has_scope(
          p_organization_id,
          'student_case',
          p_student_case_id
        )
      )
    );
  can_review_contract := can_generate_contract;
  can_manage_post_contract :=
    private.platform_has_permission(
      p_organization_id,
      'post.contract.manage'
    )
    AND (
      can_manage_templates
      OR (
        actor.actor_role = 'curator'
        AND student_case.state IN ('active', 'closed')
        AND student_case.current_curator_membership_id =
          actor.actor_membership_id
        AND private.platform_has_scope(
          p_organization_id,
          'student_case',
          p_student_case_id
        )
      )
    );
  can_review_report := can_manage_post_contract;

  IF NOT (
    can_manage_templates
    OR can_generate_contract
    OR can_manage_post_contract
  ) THEN
    RAISE EXCEPTION 'Actor is not authorized for this contract workspace'
      USING ERRCODE = '42501';
  END IF;

  IF can_manage_templates THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', source.id,
        'source_key', source.source_key,
        'source_kind', source.source_kind,
        'source_url', source.source_url,
        'source_revision', source.source_revision,
        'review_status', source.review_status,
        'reviewed_at', source.reviewed_at
      ) ORDER BY source.source_key, source.id
    ), '[]'::JSONB)
    INTO reviewed_sources
    FROM platform.source_registry AS source
    WHERE source.organization_id = p_organization_id
      AND source.review_status = 'reviewed'
      AND source.source_revision IS NOT NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', template.id,
      'organization_id', template.organization_id,
      'template_key', template.template_key,
      'title', template.title,
      'version', template.version,
      'status', template.status,
      'source_registry_id', template.source_registry_id,
      'source_revision', template.source_revision,
      'field_manifest', template.field_manifest,
      'template_text', template.template_text,
      'template_sha256', template.template_sha256,
      'post_contract_checklist_blueprint',
        template.post_contract_checklist_blueprint,
      'blueprint_sha256', template.blueprint_sha256,
      'created_by_membership_id', template.created_by_membership_id,
      'approved_by_membership_id', template.approved_by_membership_id,
      'approved_at', template.approved_at,
      'retired_by_membership_id', template.retired_by_membership_id,
      'retired_at', template.retired_at,
      'created_at', template.created_at
    ) ORDER BY template.template_key, template.version DESC
  ), '[]'::JSONB)
  INTO templates
  FROM platform.contract_template_versions AS template
  WHERE template.organization_id = p_organization_id
    AND (
      can_manage_templates
      OR template.status = 'approved'
      OR EXISTS (
        SELECT 1
        FROM platform.student_case_contract_drafts AS draft
        WHERE draft.organization_id = p_organization_id
          AND draft.student_case_id = p_student_case_id
          AND draft.contract_template_version_id = template.id
      )
      OR (
        can_manage_post_contract
        AND EXISTS (
          SELECT 1
          FROM platform.post_contract_items AS item
          WHERE item.organization_id = p_organization_id
            AND item.student_case_id = p_student_case_id
            AND item.contract_template_version_id = template.id
        )
      )
      OR (
        can_manage_post_contract
        AND EXISTS (
          SELECT 1
          FROM platform.post_contract_reports AS report
          WHERE report.organization_id = p_organization_id
            AND report.student_case_id = p_student_case_id
            AND report.contract_template_version_id = template.id
        )
      )
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', draft.id,
      'organization_id', draft.organization_id,
      'student_case_id', draft.student_case_id,
      'contract_template_version_id', draft.contract_template_version_id,
      'version', draft.version,
      'status', draft.status,
      'input_snapshot', draft.input_snapshot,
      'input_sha256', draft.input_sha256,
      'rendered_text', draft.rendered_text,
      'rendered_sha256', draft.rendered_sha256,
      'created_by_membership_id', draft.created_by_membership_id,
      'reviewed_by_membership_id', draft.reviewed_by_membership_id,
      'reviewed_at', draft.reviewed_at,
      'created_at', draft.created_at
    ) ORDER BY draft.version DESC
  ), '[]'::JSONB)
  INTO drafts
  FROM platform.student_case_contract_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.student_case_id = p_student_case_id;

  IF can_manage_post_contract THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'organization_id', item.organization_id,
        'student_case_id', item.student_case_id,
        'contract_template_version_id', item.contract_template_version_id,
        'item_key', item.item_key,
        'label', item.label,
        'status', item.status,
        'owner_role', item.owner_role,
        'owner_membership_id', item.owner_membership_id,
        'next_action', item.next_action,
        'evidence_ref', item.evidence_ref,
        'revision', item.revision,
        'created_by_membership_id', item.created_by_membership_id,
        'updated_by_membership_id', item.updated_by_membership_id,
        'created_at', item.created_at,
        'updated_at', item.updated_at
      ) ORDER BY item.item_key, item.id
    ), '[]'::JSONB)
    INTO items
    FROM platform.post_contract_items AS item
    WHERE item.organization_id = p_organization_id
      AND item.student_case_id = p_student_case_id;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', report.id,
        'organization_id', report.organization_id,
        'student_case_id', report.student_case_id,
        'contract_template_version_id', report.contract_template_version_id,
        'version', report.version,
        'status', report.status,
        'total_item_count', report.total_item_count,
        'delivered_item_count', report.delivered_item_count,
        'open_item_count', report.open_item_count,
        'in_progress_item_count', report.in_progress_item_count,
        'blocked_item_count', report.blocked_item_count,
        'item_snapshot', report.item_snapshot,
        'report_sha256', report.report_sha256,
        'created_by_membership_id', report.created_by_membership_id,
        'reviewed_by_membership_id', report.reviewed_by_membership_id,
        'reviewed_at', report.reviewed_at,
        'created_at', report.created_at
      ) ORDER BY report.contract_template_version_id, report.version DESC
    ), '[]'::JSONB)
    INTO reports
    FROM platform.post_contract_reports AS report
    WHERE report.organization_id = p_organization_id
      AND report.student_case_id = p_student_case_id;
  END IF;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'actor_role', actor.actor_role,
    'can_manage_templates', can_manage_templates,
    'can_generate_contract', can_generate_contract,
    'can_review_contract', can_review_contract,
    'can_manage_post_contract', can_manage_post_contract,
    'can_review_report', can_review_report,
    'reviewed_sources', reviewed_sources,
    'templates', templates,
    'drafts', drafts,
    'items', items,
    'reports', reports
  );
END
$$;

REVOKE ALL PRIVILEGES ON TABLE
  platform.contract_template_versions,
  platform.student_case_contract_drafts,
  platform.post_contract_items,
  platform.post_contract_reports
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE
  platform.contract_template_versions,
  platform.student_case_contract_drafts,
  platform.post_contract_items,
  platform.post_contract_reports
TO authenticated;

REVOKE ALL ON FUNCTION
  platform.create_contract_template_version(
    UUID, TEXT, TEXT, UUID, JSONB, TEXT, JSONB, TEXT, UUID
  ),
  platform.approve_contract_template_version(UUID, UUID, TEXT, UUID),
  platform.retire_contract_template_version(UUID, UUID, TEXT, UUID),
  platform.generate_student_case_contract_draft(
    UUID, UUID, UUID, TEXT, UUID
  ),
  platform.review_student_case_contract_draft(
    UUID, UUID, UUID, platform.contract_artifact_review_decision, TEXT, UUID
  ),
  platform.seed_post_contract_items(UUID, UUID, UUID, TEXT, UUID),
  platform.update_post_contract_item(
    UUID, UUID, UUID, BIGINT, platform.post_contract_item_status,
    UUID, TEXT, TEXT, TEXT, UUID
  ),
  platform.generate_post_contract_report(UUID, UUID, UUID, TEXT, UUID),
  platform.review_post_contract_report(
    UUID, UUID, UUID, platform.contract_artifact_review_decision, TEXT, UUID
  ),
  platform.staff_case_contract_workspace(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.create_contract_template_version(
    UUID, TEXT, TEXT, UUID, JSONB, TEXT, JSONB, TEXT, UUID
  ),
  platform.approve_contract_template_version(UUID, UUID, TEXT, UUID),
  platform.retire_contract_template_version(UUID, UUID, TEXT, UUID),
  platform.generate_student_case_contract_draft(
    UUID, UUID, UUID, TEXT, UUID
  ),
  platform.review_student_case_contract_draft(
    UUID, UUID, UUID, platform.contract_artifact_review_decision, TEXT, UUID
  ),
  platform.seed_post_contract_items(UUID, UUID, UUID, TEXT, UUID),
  platform.update_post_contract_item(
    UUID, UUID, UUID, BIGINT, platform.post_contract_item_status,
    UUID, TEXT, TEXT, TEXT, UUID
  ),
  platform.generate_post_contract_report(UUID, UUID, UUID, TEXT, UUID),
  platform.review_post_contract_report(
    UUID, UUID, UUID, platform.contract_artifact_review_decision, TEXT, UUID
  ),
  platform.staff_case_contract_workspace(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform.contract_template_versions IS
  'Organization-scoped immutable contract template versions pinned to one reviewed source revision.';
COMMENT ON TABLE platform.student_case_contract_drafts IS
  'Immutable deterministic plain-text contract drafts resolved only from approved Platform fields.';
COMMENT ON TABLE platform.post_contract_items IS
  'The only mutable BW6 workflow table; every authorized item update is revisioned and audited.';
COMMENT ON TABLE platform.post_contract_reports IS
  'Immutable versioned post-contract item snapshots; review changes status metadata only.';
COMMENT ON FUNCTION platform.staff_case_contract_workspace(UUID, UUID) IS
  'Role- and case-scoped BW6 workspace. Finance, Student, cross-org and unassigned actors fail closed.';

COMMIT;
