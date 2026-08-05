-- The durable-work enums predate BW8 and PostgreSQL cannot use a newly added
-- enum value until the transaction that adds it commits. Keep these additions
-- in autocommit statements before the migration's explicit transaction.
ALTER TYPE platform.durable_work_kind ADD VALUE IF NOT EXISTS 'document_validation';
ALTER TYPE platform.durable_work_kind ADD VALUE IF NOT EXISTS 'document_extraction';
ALTER TYPE platform.durable_work_kind ADD VALUE IF NOT EXISTS 'student_profile_export';
ALTER TYPE platform.durable_work_operation ADD VALUE IF NOT EXISTS 'enqueue_document_validation';
ALTER TYPE platform.durable_work_operation ADD VALUE IF NOT EXISTS 'enqueue_document_extraction';
ALTER TYPE platform.durable_work_operation ADD VALUE IF NOT EXISTS 'enqueue_student_profile_export';

-- ============================================================
-- 059_platform_student_document_intelligence.sql
--
-- BW8A: evidence-backed document extraction candidates, one typed expanded
-- Student Profile field store, append-only human decisions, immutable export
-- evidence, and the source-pinned China requirement overlay.
--
-- This migration is additive and provider-free. It creates no second student,
-- case, checklist, document, file, queue or sales identity. amoCRM remains the
-- sales/contact source of truth; all rows below are scoped to existing Platform
-- cases, document versions and profiles.
-- ============================================================

BEGIN;

CREATE TYPE platform.document_extraction_run_status AS ENUM (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'superseded'
);

CREATE TYPE platform.document_extracted_fact_status AS ENUM (
  'proposed',
  'conflict',
  'confirmed',
  'rejected',
  'superseded'
);

CREATE TYPE platform.student_profile_value_kind AS ENUM (
  'name',
  'text',
  'email',
  'phone',
  'date',
  'country_code',
  'passport_number',
  'communication_language',
  'language_level',
  'education_history',
  'year',
  'money',
  'boolean',
  'text_array',
  'consent_status'
);

CREATE TYPE platform.student_profile_value_source AS ENUM (
  'extracted_fact',
  'manual'
);

CREATE TYPE platform.student_profile_field_decision_kind AS ENUM (
  'confirm',
  'reject',
  'manual_edit',
  'supersede'
);

CREATE TYPE platform.student_profile_export_format AS ENUM (
  'docx',
  'pdf'
);

CREATE TYPE platform.student_profile_export_status AS ENUM (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'superseded'
);

CREATE TYPE platform.document_requirement_applicability_rule AS ENUM (
  'always',
  'minor_only',
  'after_contract_payment'
);

CREATE TYPE platform.document_slot_applicability_status AS ENUM (
  'required',
  'not_required',
  'pending_information'
);

-- Typed JSON values keep a single value column while preserving a closed,
-- deterministic DB contract for each catalog kind. No routine logs values.
CREATE OR REPLACE FUNCTION platform_private.student_profile_value_is_valid(
  p_kind platform.student_profile_value_kind,
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  scalar_text TEXT;
  item JSONB;
  amount_text TEXT;
  year_from INTEGER;
  year_to INTEGER;
BEGIN
  IF p_kind IS NULL OR p_value IS NULL OR p_value = 'null'::JSONB THEN
    RETURN FALSE;
  END IF;

  IF p_kind IN (
    'name', 'text', 'email', 'phone', 'date', 'country_code',
    'passport_number', 'communication_language', 'language_level',
    'consent_status'
  ) THEN
    IF pg_catalog.jsonb_typeof(p_value) <> 'string' THEN RETURN FALSE; END IF;
    scalar_text := p_value #>> '{}';
  END IF;

  CASE p_kind
    WHEN 'name' THEN
      RETURN pg_catalog.char_length(pg_catalog.btrim(scalar_text)) BETWEEN 1 AND 200
        AND scalar_text = pg_catalog.btrim(scalar_text)
        AND scalar_text !~ '[[:cntrl:]]';
    WHEN 'text' THEN
      RETURN pg_catalog.char_length(pg_catalog.btrim(scalar_text)) BETWEEN 1 AND 4000
        AND scalar_text = pg_catalog.btrim(scalar_text)
        AND scalar_text !~ '[[:cntrl:]]';
    WHEN 'email' THEN
      RETURN pg_catalog.char_length(scalar_text) BETWEEN 3 AND 320
        AND scalar_text = pg_catalog.lower(pg_catalog.btrim(scalar_text))
        AND scalar_text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
    WHEN 'phone' THEN
      RETURN pg_catalog.char_length(scalar_text) BETWEEN 7 AND 32
        AND scalar_text = pg_catalog.btrim(scalar_text)
        AND scalar_text ~ '^\+?[0-9][0-9 ()-]{5,30}[0-9]$';
    WHEN 'date' THEN
      IF scalar_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN FALSE; END IF;
      RETURN scalar_text::DATE BETWEEN DATE '1900-01-01' AND DATE '2099-12-31';
    WHEN 'country_code' THEN
      RETURN scalar_text ~ '^[A-Z]{2}$';
    WHEN 'passport_number' THEN
      RETURN pg_catalog.char_length(scalar_text) BETWEEN 4 AND 32
        AND scalar_text = pg_catalog.upper(pg_catalog.btrim(scalar_text))
        AND scalar_text ~ '^[A-Z0-9 -]+$';
    WHEN 'communication_language' THEN
      RETURN scalar_text IN ('ru', 'en');
    WHEN 'language_level' THEN
      RETURN pg_catalog.char_length(scalar_text) BETWEEN 1 AND 120
        AND scalar_text = pg_catalog.btrim(scalar_text)
        AND scalar_text !~ '[[:cntrl:]]';
    WHEN 'year' THEN
      RETURN pg_catalog.jsonb_typeof(p_value) = 'number'
        AND p_value #>> '{}' ~ '^[0-9]{4}$'
        AND (p_value #>> '{}')::INTEGER BETWEEN 1900 AND 2099;
    WHEN 'boolean' THEN
      RETURN pg_catalog.jsonb_typeof(p_value) = 'boolean';
    WHEN 'consent_status' THEN
      RETURN scalar_text IN ('not_recorded', 'granted', 'withdrawn');
    WHEN 'text_array' THEN
      IF pg_catalog.jsonb_typeof(p_value) <> 'array'
        OR pg_catalog.jsonb_array_length(p_value) > 32
      THEN RETURN FALSE; END IF;
      FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP
        IF pg_catalog.jsonb_typeof(item) <> 'string'
          OR pg_catalog.char_length(pg_catalog.btrim(item #>> '{}')) NOT BETWEEN 1 AND 200
          OR item #>> '{}' <> pg_catalog.btrim(item #>> '{}')
          OR item #>> '{}' ~ '[[:cntrl:]]'
        THEN RETURN FALSE; END IF;
      END LOOP;
      RETURN (
        SELECT count(*) = count(DISTINCT value)
        FROM pg_catalog.jsonb_array_elements_text(p_value) AS value
      );
    WHEN 'money' THEN
      IF pg_catalog.jsonb_typeof(p_value) <> 'object'
        OR NOT (p_value ?& ARRAY['amount', 'currency'])
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_value)) <> 2
        OR pg_catalog.jsonb_typeof(p_value -> 'amount') <> 'number'
        OR pg_catalog.jsonb_typeof(p_value -> 'currency') <> 'string'
      THEN RETURN FALSE; END IF;
      amount_text := p_value ->> 'amount';
      RETURN amount_text ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
        AND (amount_text::NUMERIC BETWEEN 0 AND 999999999999.99)
        AND p_value ->> 'currency' ~ '^[A-Z]{3}$';
    WHEN 'education_history' THEN
      IF pg_catalog.jsonb_typeof(p_value) <> 'array'
        OR pg_catalog.jsonb_array_length(p_value) > 20
      THEN RETURN FALSE; END IF;
      FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP
        IF pg_catalog.jsonb_typeof(item) <> 'object'
          OR NOT (item ?& ARRAY[
            'school_name', 'country_city', 'year_from', 'year_to',
            'degree_certificate'
          ])
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item)) <> 5
          OR pg_catalog.jsonb_typeof(item -> 'school_name') <> 'string'
          OR pg_catalog.jsonb_typeof(item -> 'country_city') <> 'string'
          OR pg_catalog.jsonb_typeof(item -> 'year_from') <> 'number'
          OR pg_catalog.jsonb_typeof(item -> 'year_to') <> 'number'
          OR pg_catalog.jsonb_typeof(item -> 'degree_certificate') <> 'string'
          OR pg_catalog.char_length(pg_catalog.btrim(item ->> 'school_name')) NOT BETWEEN 1 AND 240
          OR pg_catalog.char_length(pg_catalog.btrim(item ->> 'country_city')) NOT BETWEEN 1 AND 240
          OR pg_catalog.char_length(pg_catalog.btrim(item ->> 'degree_certificate')) NOT BETWEEN 1 AND 240
          OR item ->> 'year_from' !~ '^[0-9]{4}$'
          OR item ->> 'year_to' !~ '^[0-9]{4}$'
        THEN RETURN FALSE; END IF;
        year_from := (item ->> 'year_from')::INTEGER;
        year_to := (item ->> 'year_to')::INTEGER;
        IF year_from NOT BETWEEN 1900 AND 2099
          OR year_to NOT BETWEEN 1900 AND 2099
          OR year_to < year_from
        THEN RETURN FALSE; END IF;
      END LOOP;
      RETURN TRUE;
  END CASE;

  RETURN FALSE;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
    OR datetime_field_overflow THEN
    RETURN FALSE;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.document_source_locator_is_valid(
  p_locator JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_locator IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_locator) = 'object'
    AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_locator)) BETWEEN 1 AND 4
    AND p_locator ? 'kind'
    AND p_locator ->> 'kind' IN ('page', 'image', 'document')
    AND (
      NOT (p_locator ? 'page')
      OR (
        pg_catalog.jsonb_typeof(p_locator -> 'page') = 'number'
        AND p_locator ->> 'page' ~ '^[1-9][0-9]{0,4}$'
      )
    )
    AND (
      NOT (p_locator ? 'anchor')
      OR (
        pg_catalog.jsonb_typeof(p_locator -> 'anchor') = 'string'
        AND pg_catalog.char_length(p_locator ->> 'anchor') BETWEEN 1 AND 240
        AND p_locator ->> 'anchor' !~ '[[:cntrl:]]'
      )
    )
    AND (
      NOT (p_locator ? 'region')
      OR (
        pg_catalog.jsonb_typeof(p_locator -> 'region') = 'string'
        AND p_locator ->> 'region' ~ '^[a-z][a-z0-9_.-]{0,63}$'
      )
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.resolve_document_applicability(
  p_rule platform.document_requirement_applicability_rule,
  p_date_of_birth DATE,
  p_reference_date DATE
)
RETURNS platform.document_slot_applicability_status
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_rule IS NULL OR p_reference_date IS NULL THEN
    RAISE EXCEPTION 'Applicability rule and reference date are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_rule IN ('always', 'after_contract_payment') THEN
    RETURN 'required';
  END IF;

  IF p_date_of_birth IS NULL THEN RETURN 'pending_information'; END IF;
  IF p_date_of_birth > p_reference_date
    OR p_date_of_birth < p_reference_date - INTERVAL '120 years'
  THEN
    RAISE EXCEPTION 'Applicant date of birth is outside the accepted range'
      USING ERRCODE = '22023';
  END IF;

  IF p_date_of_birth > (p_reference_date - INTERVAL '18 years')::DATE THEN
    RETURN 'required';
  END IF;
  RETURN 'not_required';
END
$$;

CREATE TABLE platform.student_profile_field_catalog (
  field_key TEXT PRIMARY KEY CHECK (
    field_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
  ),
  value_kind platform.student_profile_value_kind NOT NULL,
  section_key TEXT NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_order INTEGER NOT NULL UNIQUE CHECK (display_order > 0),
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  is_repeating BOOLEAN NOT NULL DEFAULT FALSE,
  core_projection_field platform.student_profile_field,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profile_field_catalog_key_kind_key
    UNIQUE (field_key, value_kind),
  CONSTRAINT student_profile_field_catalog_repeating_check CHECK (
    NOT is_repeating OR value_kind IN ('education_history', 'text_array')
  )
);

CREATE OR REPLACE FUNCTION platform_private.student_profile_catalog_value_is_valid(
  p_field_key TEXT,
  p_value JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.student_profile_field_catalog AS catalog
    WHERE catalog.field_key = p_field_key
      AND platform_private.student_profile_value_is_valid(
        catalog.value_kind,
        p_value
      )
  )
$$;

CREATE TABLE platform.document_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  status platform.document_extraction_run_status NOT NULL,
  extractor_provider TEXT NOT NULL CHECK (
    extractor_provider ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  extractor_model_version TEXT NOT NULL CHECK (
    pg_catalog.char_length(extractor_model_version) BETWEEN 1 AND 160
    AND extractor_model_version = pg_catalog.btrim(extractor_model_version)
    AND extractor_model_version !~ '[[:cntrl:]]'
  ),
  extractor_policy_version TEXT NOT NULL CHECK (
    extractor_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'
  ),
  request_id UUID NOT NULL UNIQUE,
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 20),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  failure_detail_ref TEXT CHECK (
    failure_detail_ref IS NULL OR (
      pg_catalog.char_length(failure_detail_ref) BETWEEN 1 AND 512
      AND failure_detail_ref = pg_catalog.btrim(failure_detail_ref)
      AND failure_detail_ref !~ '[[:cntrl:]]'
    )
  ),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT document_extraction_runs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_extraction_runs_parent_identity_key
    UNIQUE (organization_id, id, student_case_id, document_slot_id, document_version_id),
  CONSTRAINT document_extraction_runs_version_fkey
    FOREIGN KEY (
      organization_id, document_version_id, student_case_id, document_slot_id
    ) REFERENCES platform.document_versions(
      organization_id, id, student_case_id, document_slot_id
    ) ON DELETE RESTRICT,
  CONSTRAINT document_extraction_runs_status_shape_check CHECK (
    (status = 'queued' AND processing_started_at IS NULL AND completed_at IS NULL
      AND failure_code IS NULL AND failure_detail_ref IS NULL)
    OR (status = 'processing' AND processing_started_at IS NOT NULL
      AND completed_at IS NULL AND failure_code IS NULL AND failure_detail_ref IS NULL)
    OR (status IN ('succeeded', 'superseded') AND processing_started_at IS NOT NULL
      AND completed_at IS NOT NULL AND failure_code IS NULL AND failure_detail_ref IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE TABLE platform.document_extracted_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  extraction_run_id UUID NOT NULL,
  field_key TEXT NOT NULL,
  value_kind platform.student_profile_value_kind NOT NULL,
  candidate_value JSONB NOT NULL,
  normalized_value JSONB NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_locator JSONB NOT NULL,
  status platform.document_extracted_fact_status NOT NULL DEFAULT 'proposed',
  extractor_model_version TEXT NOT NULL,
  extractor_policy_version TEXT NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  decided_at TIMESTAMPTZ,
  CONSTRAINT document_extracted_facts_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT document_extracted_facts_org_id_case_id_key
    UNIQUE (organization_id, id, student_case_id),
  CONSTRAINT document_extracted_facts_run_fkey
    FOREIGN KEY (
      organization_id, extraction_run_id, student_case_id,
      document_slot_id, document_version_id
    ) REFERENCES platform.document_extraction_runs(
      organization_id, id, student_case_id, document_slot_id, document_version_id
    ) ON DELETE RESTRICT,
  CONSTRAINT document_extracted_facts_field_kind_fkey
    FOREIGN KEY (field_key, value_kind)
    REFERENCES platform.student_profile_field_catalog(field_key, value_kind)
    ON DELETE RESTRICT,
  CONSTRAINT document_extracted_facts_candidate_value_check CHECK (
    platform_private.student_profile_value_is_valid(value_kind, candidate_value)
  ),
  CONSTRAINT document_extracted_facts_normalized_value_check CHECK (
    platform_private.student_profile_value_is_valid(value_kind, normalized_value)
  ),
  CONSTRAINT document_extracted_facts_source_locator_check CHECK (
    platform_private.document_source_locator_is_valid(source_locator)
  ),
  CONSTRAINT document_extracted_facts_status_shape_check CHECK (
    (status IN ('proposed', 'conflict') AND decided_at IS NULL)
    OR (status IN ('confirmed', 'rejected', 'superseded') AND decided_at IS NOT NULL)
  )
);

CREATE TABLE platform.student_profile_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  field_key TEXT NOT NULL,
  value_kind platform.student_profile_value_kind NOT NULL,
  field_value JSONB NOT NULL,
  field_revision BIGINT NOT NULL CHECK (field_revision > 0),
  profile_revision BIGINT NOT NULL CHECK (profile_revision > 0),
  source_kind platform.student_profile_value_source NOT NULL,
  source_fact_id UUID,
  confirmed_by_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profile_field_values_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_profile_field_values_case_field_key
    UNIQUE (organization_id, student_case_id, field_key),
  CONSTRAINT student_profile_field_values_profile_fkey
    FOREIGN KEY (organization_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_values_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_values_field_kind_fkey
    FOREIGN KEY (field_key, value_kind)
    REFERENCES platform.student_profile_field_catalog(field_key, value_kind)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_values_fact_fkey
    FOREIGN KEY (organization_id, source_fact_id, student_case_id)
    REFERENCES platform.document_extracted_facts(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_values_actor_fkey
    FOREIGN KEY (organization_id, confirmed_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_values_value_check CHECK (
    platform_private.student_profile_value_is_valid(value_kind, field_value)
  ),
  CONSTRAINT student_profile_field_values_source_check CHECK (
    (source_kind = 'manual' AND source_fact_id IS NULL)
    OR (source_kind = 'extracted_fact' AND source_fact_id IS NOT NULL)
  )
);

CREATE TABLE platform.student_profile_field_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  field_key TEXT NOT NULL,
  decision_kind platform.student_profile_field_decision_kind NOT NULL,
  extracted_fact_id UUID,
  before_value JSONB,
  after_value JSONB,
  before_field_revision BIGINT CHECK (before_field_revision IS NULL OR before_field_revision > 0),
  after_field_revision BIGINT CHECK (after_field_revision IS NULL OR after_field_revision > 0),
  profile_revision_before BIGINT NOT NULL CHECK (profile_revision_before > 0),
  profile_revision_after BIGINT NOT NULL CHECK (profile_revision_after > 0),
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 1 AND 1000
    AND reason = pg_catalog.btrim(reason)
    AND reason !~ '[[:cntrl:]]'
  ),
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profile_field_decisions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_profile_field_decisions_profile_fkey
    FOREIGN KEY (organization_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_decisions_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_decisions_field_fkey
    FOREIGN KEY (field_key)
    REFERENCES platform.student_profile_field_catalog(field_key)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_decisions_fact_fkey
    FOREIGN KEY (organization_id, extracted_fact_id, student_case_id)
    REFERENCES platform.document_extracted_facts(organization_id, id, student_case_id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_decisions_actor_fkey
    FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_field_decisions_value_shape_check CHECK (
    (
      before_value IS NULL
      OR platform_private.student_profile_catalog_value_is_valid(field_key, before_value)
    )
    AND (
      after_value IS NULL
      OR platform_private.student_profile_catalog_value_is_valid(field_key, after_value)
    )
  ),
  CONSTRAINT student_profile_field_decisions_shape_check CHECK (
    (
      decision_kind IN ('confirm', 'supersede')
      AND extracted_fact_id IS NOT NULL
      AND after_value IS NOT NULL
      AND profile_revision_after = profile_revision_before + 1
      AND after_field_revision IS NOT NULL
    )
    OR (
      decision_kind = 'manual_edit'
      AND extracted_fact_id IS NULL
      AND after_value IS NOT NULL
      AND profile_revision_after = profile_revision_before + 1
      AND after_field_revision IS NOT NULL
    )
    OR (
      decision_kind = 'reject'
      AND extracted_fact_id IS NOT NULL
      AND after_value IS NULL
      AND profile_revision_after = profile_revision_before
      AND after_field_revision IS NULL
    )
  )
);

CREATE TABLE platform.student_profile_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  student_profile_id UUID NOT NULL,
  profile_revision BIGINT NOT NULL CHECK (profile_revision > 0),
  template_key TEXT NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  template_version TEXT NOT NULL CHECK (
    template_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'
  ),
  template_sha256 TEXT NOT NULL CHECK (template_sha256 ~ '^[0-9a-f]{64}$'),
  output_format platform.student_profile_export_format NOT NULL,
  status platform.student_profile_export_status NOT NULL,
  input_manifest_sha256 TEXT NOT NULL CHECK (input_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  output_sha256 TEXT CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  storage_evidence_ref TEXT CHECK (
    storage_evidence_ref IS NULL OR (
      pg_catalog.char_length(storage_evidence_ref) BETWEEN 1 AND 512
      AND storage_evidence_ref = pg_catalog.btrim(storage_evidence_ref)
      AND storage_evidence_ref !~ '[[:cntrl:]]'
    )
  ),
  failure_code TEXT CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_.-]{1,63}$'
  ),
  request_id UUID NOT NULL UNIQUE,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_profile_exports_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT student_profile_exports_profile_fkey
    FOREIGN KEY (organization_id, student_profile_id)
    REFERENCES platform.student_profiles(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_exports_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_exports_actor_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_profile_exports_identity_key UNIQUE (
    organization_id, student_case_id, profile_revision, template_key,
    template_version, output_format, input_manifest_sha256
  ),
  CONSTRAINT student_profile_exports_status_shape_check CHECK (
    (status IN ('queued', 'processing') AND output_sha256 IS NULL
      AND storage_evidence_ref IS NULL AND failure_code IS NULL)
    OR (status = 'succeeded' AND output_sha256 IS NOT NULL
      AND storage_evidence_ref IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND output_sha256 IS NULL
      AND storage_evidence_ref IS NULL AND failure_code IS NOT NULL)
    OR (status = 'superseded' AND failure_code IS NULL)
  )
);

ALTER TABLE platform.document_requirements
  ADD COLUMN country_requirement_version_id UUID,
  ADD COLUMN applicability_rule platform.document_requirement_applicability_rule
    NOT NULL DEFAULT 'always',
  ADD COLUMN evidence_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN source_item_order SMALLINT,
  ADD CONSTRAINT document_requirements_country_version_fkey
    FOREIGN KEY (organization_id, country_requirement_version_id)
    REFERENCES platform.country_requirement_versions(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT document_requirements_source_item_order_check CHECK (
    source_item_order IS NULL OR source_item_order BETWEEN 1 AND 100
  ),
  ADD CONSTRAINT document_requirements_overlay_shape_check CHECK (
    (country_requirement_version_id IS NULL AND source_item_order IS NULL)
    OR (country_requirement_version_id IS NOT NULL AND source_item_order IS NOT NULL)
  );

CREATE UNIQUE INDEX document_requirements_country_version_order_key
  ON platform.document_requirements (
    organization_id, country_requirement_version_id, source_item_order
  )
  WHERE country_requirement_version_id IS NOT NULL;

ALTER TABLE platform.document_slots
  ADD COLUMN applicability_status platform.document_slot_applicability_status
    NOT NULL DEFAULT 'required',
  ADD COLUMN applicability_reference_date DATE,
  ADD CONSTRAINT document_slots_applicability_shape_check CHECK (
    applicability_status = 'required'
    OR (applicability_status IN ('not_required', 'pending_information')
      AND applicability_reference_date IS NOT NULL)
  );

-- Extend the existing PGMQ ledger with typed BW8 source pointers. The queue,
-- attempt/event/dead-letter tables and claim/finish ownership remain the P2G
-- ones; no second queue or retry ledger is introduced.
ALTER TABLE platform_private.durable_work_items
  DROP CONSTRAINT durable_work_items_source_shape_check,
  ADD COLUMN source_document_version_id UUID,
  ADD COLUMN source_extraction_run_id UUID,
  ADD COLUMN source_profile_export_id UUID,
  ADD CONSTRAINT durable_work_items_document_version_fkey
    FOREIGN KEY (organization_id, source_document_version_id)
    REFERENCES platform.document_versions(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT durable_work_items_extraction_run_fkey
    FOREIGN KEY (organization_id, source_extraction_run_id)
    REFERENCES platform.document_extraction_runs(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT durable_work_items_profile_export_fkey
    FOREIGN KEY (organization_id, source_profile_export_id)
    REFERENCES platform.student_profile_exports(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT durable_work_items_source_shape_check CHECK (
    (
      kind = 'provider_webhook_process'
      AND source_webhook_event_id IS NOT NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NULL
      AND source_document_version_id IS NULL
      AND source_extraction_run_id IS NULL
      AND source_profile_export_id IS NULL
    )
    OR (
      kind = 'ai_draft_generate'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NOT NULL
      AND manual_send_authorization_id IS NULL
      AND source_document_version_id IS NULL
      AND source_extraction_run_id IS NULL
      AND source_profile_export_id IS NULL
    )
    OR (
      kind = 'manual_whatsapp_send'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NOT NULL
      AND source_document_version_id IS NULL
      AND source_extraction_run_id IS NULL
      AND source_profile_export_id IS NULL
    )
    OR (
      kind = 'document_validation'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NULL
      AND source_document_version_id IS NOT NULL
      AND source_extraction_run_id IS NULL
      AND source_profile_export_id IS NULL
    )
    OR (
      kind = 'document_extraction'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NULL
      AND source_document_version_id IS NULL
      AND source_extraction_run_id IS NOT NULL
      AND source_profile_export_id IS NULL
    )
    OR (
      kind = 'student_profile_export'
      AND source_webhook_event_id IS NULL
      AND ai_draft_request_id IS NULL
      AND manual_send_authorization_id IS NULL
      AND source_document_version_id IS NULL
      AND source_extraction_run_id IS NULL
      AND source_profile_export_id IS NOT NULL
    )
  );

CREATE UNIQUE INDEX durable_work_items_document_version_source_key
  ON platform_private.durable_work_items (
    organization_id, source_document_version_id
  ) WHERE source_document_version_id IS NOT NULL;
CREATE UNIQUE INDEX durable_work_items_extraction_run_source_key
  ON platform_private.durable_work_items (
    organization_id, source_extraction_run_id
  ) WHERE source_extraction_run_id IS NOT NULL;
CREATE UNIQUE INDEX durable_work_items_profile_export_source_key
  ON platform_private.durable_work_items (
    organization_id, source_profile_export_id
  ) WHERE source_profile_export_id IS NOT NULL;

CREATE INDEX document_extraction_runs_case_status_idx
  ON platform.document_extraction_runs (
    organization_id, student_case_id, status, queued_at DESC
  );
CREATE INDEX document_extraction_runs_version_idx
  ON platform.document_extraction_runs (
    organization_id, document_version_id, queued_at DESC
  );
CREATE INDEX document_extracted_facts_case_status_idx
  ON platform.document_extracted_facts (
    organization_id, student_case_id, status, field_key, created_at DESC
  );
CREATE INDEX document_extracted_facts_run_idx
  ON platform.document_extracted_facts (organization_id, extraction_run_id);
CREATE INDEX student_profile_field_values_profile_revision_idx
  ON platform.student_profile_field_values (
    organization_id, student_profile_id, profile_revision, field_key
  );
CREATE INDEX student_profile_field_values_source_fact_idx
  ON platform.student_profile_field_values (organization_id, source_fact_id)
  WHERE source_fact_id IS NOT NULL;
CREATE INDEX student_profile_field_decisions_case_created_idx
  ON platform.student_profile_field_decisions (
    organization_id, student_case_id, created_at DESC
  );
CREATE INDEX student_profile_field_decisions_fact_idx
  ON platform.student_profile_field_decisions (organization_id, extracted_fact_id)
  WHERE extracted_fact_id IS NOT NULL;
CREATE INDEX student_profile_exports_case_revision_idx
  ON platform.student_profile_exports (
    organization_id, student_case_id, profile_revision, created_at DESC
  );

-- Exact supplied-form catalog plus the 14 minimized-core projections. Keys are
-- the API/TypeScript contract; changing a key requires a new reviewed migration.
INSERT INTO platform.student_profile_field_catalog (
  field_key, value_kind, section_key, display_order, is_sensitive,
  is_repeating, core_projection_field
)
VALUES
  ('identity.preferred_display_name', 'name', 'identity', 1, FALSE, FALSE, 'preferred_display_name'),
  ('identity.legal_display_name', 'name', 'identity', 2, TRUE, FALSE, 'legal_display_name'),
  ('preferences.communication_language', 'communication_language', 'preferences', 3, FALSE, FALSE, 'communication_language'),
  ('personal.date_of_birth', 'date', 'personal', 4, TRUE, FALSE, 'date_of_birth'),
  ('personal.citizenship_country', 'country_code', 'personal', 5, TRUE, FALSE, 'citizenship_country'),
  ('personal.residency_country', 'country_code', 'personal', 6, TRUE, FALSE, 'residency_country'),
  ('education.current_summary', 'text', 'education', 7, TRUE, FALSE, 'current_education_summary'),
  ('education.academic_summary', 'text', 'education', 8, TRUE, FALSE, 'academic_summary'),
  ('language.summary', 'text', 'language', 9, TRUE, FALSE, 'language_summary'),
  ('study.budget_band', 'text', 'study', 10, TRUE, FALSE, 'budget_band'),
  ('decision.participant_labels', 'text_array', 'decision', 11, TRUE, TRUE, 'decision_participant_labels'),
  ('consent.status', 'consent_status', 'consent', 12, TRUE, FALSE, 'consent_status'),
  ('consent.evidence_ref', 'text', 'consent', 13, TRUE, FALSE, 'consent_evidence_ref'),
  ('workflow.next_step', 'text', 'workflow', 14, TRUE, FALSE, 'next_step'),
  ('personal.first_name', 'name', 'personal', 15, TRUE, FALSE, NULL),
  ('personal.last_name', 'name', 'personal', 16, TRUE, FALSE, NULL),
  ('personal.passport_number', 'passport_number', 'personal', 17, TRUE, FALSE, NULL),
  ('personal.passport_expiry_date', 'date', 'personal', 18, TRUE, FALSE, NULL),
  ('personal.permanent_address', 'text', 'personal', 19, TRUE, FALSE, NULL),
  ('personal.mobile_phone', 'phone', 'personal', 20, TRUE, FALSE, NULL),
  ('personal.messaging_contact', 'text', 'personal', 21, TRUE, FALSE, NULL),
  ('personal.student_email', 'email', 'personal', 22, TRUE, FALSE, NULL),
  ('personal.chinese_level', 'language_level', 'personal', 23, TRUE, FALSE, NULL),
  ('personal.english_level', 'language_level', 'personal', 24, TRUE, FALSE, NULL),
  ('education.history', 'education_history', 'education', 25, TRUE, TRUE, NULL),
  ('education.current_study_status', 'text', 'education', 26, TRUE, FALSE, NULL),
  ('education.expected_graduation_year', 'year', 'education', 27, TRUE, FALSE, NULL),
  ('education.extracurricular_achievements', 'text', 'education', 28, TRUE, FALSE, NULL),
  ('study.desired_country', 'country_code', 'study', 29, FALSE, FALSE, NULL),
  ('study.desired_university', 'text', 'study', 30, FALSE, FALSE, NULL),
  ('study.field_major', 'text', 'study', 31, FALSE, FALSE, NULL),
  ('study.program_level', 'text', 'study', 32, FALSE, FALSE, NULL),
  ('study.desired_start_date', 'date', 'study', 33, FALSE, FALSE, NULL),
  ('study.budget_per_year', 'money', 'study', 34, TRUE, FALSE, NULL),
  ('study.scholarship_interest', 'boolean', 'study', 35, FALSE, FALSE, NULL),
  ('study.field_choice_reason', 'text', 'study', 36, FALSE, FALSE, NULL),
  ('father.first_name', 'name', 'father', 37, TRUE, FALSE, NULL),
  ('father.last_name', 'name', 'father', 38, TRUE, FALSE, NULL),
  ('father.employer', 'text', 'father', 39, TRUE, FALSE, NULL),
  ('father.job_title', 'text', 'father', 40, TRUE, FALSE, NULL),
  ('father.mobile_phone', 'phone', 'father', 41, TRUE, FALSE, NULL),
  ('father.work_email', 'email', 'father', 42, TRUE, FALSE, NULL),
  ('father.personal_email', 'email', 'father', 43, TRUE, FALSE, NULL),
  ('mother.first_name', 'name', 'mother', 44, TRUE, FALSE, NULL),
  ('mother.last_name', 'name', 'mother', 45, TRUE, FALSE, NULL),
  ('mother.employer', 'text', 'mother', 46, TRUE, FALSE, NULL),
  ('mother.job_title', 'text', 'mother', 47, TRUE, FALSE, NULL),
  ('mother.mobile_phone', 'phone', 'mother', 48, TRUE, FALSE, NULL),
  ('mother.work_email', 'email', 'mother', 49, TRUE, FALSE, NULL),
  ('mother.personal_email', 'email', 'mother', 50, TRUE, FALSE, NULL),
  ('emergency.contact_name', 'name', 'emergency', 51, TRUE, FALSE, NULL),
  ('emergency.relationship', 'text', 'emergency', 52, TRUE, FALSE, NULL),
  ('emergency.phone_or_email', 'text', 'emergency', 53, TRUE, FALSE, NULL),
  ('visa.previous_refusal', 'boolean', 'visa', 54, TRUE, FALSE, NULL),
  ('visa.refusal_country', 'country_code', 'visa', 55, TRUE, FALSE, NULL),
  ('health.chronic_or_allergies', 'boolean', 'health', 56, TRUE, FALSE, NULL),
  ('health.details', 'text', 'health', 57, TRUE, FALSE, NULL),
  ('referral.source', 'text', 'referral', 58, FALSE, FALSE, NULL),
  ('acknowledgement.student_signature', 'boolean', 'acknowledgement', 59, TRUE, FALSE, NULL),
  ('acknowledgement.student_signature_date', 'date', 'acknowledgement', 60, TRUE, FALSE, NULL),
  ('acknowledgement.parent_signature', 'boolean', 'acknowledgement', 61, TRUE, FALSE, NULL),
  ('acknowledgement.parent_signature_date', 'date', 'acknowledgement', 62, TRUE, FALSE, NULL);

-- Evidence payloads are immutable. Only closed, monotonic state transitions
-- may mutate the small run/fact/export status envelopes.
CREATE OR REPLACE FUNCTION platform_private.guard_bw8_extraction_run_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.document_slot_id <> OLD.document_slot_id
    OR NEW.document_version_id <> OLD.document_version_id
    OR NEW.extractor_provider <> OLD.extractor_provider
    OR NEW.extractor_model_version <> OLD.extractor_model_version
    OR NEW.extractor_policy_version <> OLD.extractor_policy_version
    OR NEW.request_id <> OLD.request_id
    OR NEW.attempt_no <> OLD.attempt_no
    OR NEW.queued_at <> OLD.queued_at
    OR NEW.updated_at <= OLD.updated_at
    OR OLD.status IN ('succeeded', 'failed', 'superseded')
    OR NOT (
      (OLD.status = 'queued' AND NEW.status IN ('processing', 'failed', 'superseded'))
      OR (OLD.status = 'processing' AND NEW.status IN ('succeeded', 'failed', 'superseded'))
    )
  THEN
    RAISE EXCEPTION 'Document extraction run identity or transition is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bw8_extracted_fact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.document_slot_id <> OLD.document_slot_id
    OR NEW.document_version_id <> OLD.document_version_id
    OR NEW.extraction_run_id <> OLD.extraction_run_id
    OR NEW.field_key <> OLD.field_key
    OR NEW.value_kind <> OLD.value_kind
    OR NEW.candidate_value <> OLD.candidate_value
    OR NEW.normalized_value <> OLD.normalized_value
    OR NEW.confidence <> OLD.confidence
    OR NEW.source_locator <> OLD.source_locator
    OR NEW.extractor_model_version <> OLD.extractor_model_version
    OR NEW.extractor_policy_version <> OLD.extractor_policy_version
    OR NEW.request_id <> OLD.request_id
    OR NEW.created_at <> OLD.created_at
    OR OLD.status IN ('rejected', 'superseded')
    OR NOT (
      (OLD.status IN ('proposed', 'conflict')
        AND NEW.status IN ('confirmed', 'rejected', 'superseded'))
      OR (OLD.status = 'confirmed' AND NEW.status = 'superseded')
    )
  THEN
    RAISE EXCEPTION 'Extracted fact evidence or terminal decision is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bw8_profile_field_value_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.student_profile_id <> OLD.student_profile_id
    OR NEW.field_key <> OLD.field_key
    OR NEW.value_kind <> OLD.value_kind
    OR NEW.created_at <> OLD.created_at
    OR NEW.field_revision <> OLD.field_revision + 1
    OR NEW.profile_revision <= OLD.profile_revision
    OR NEW.updated_at <= OLD.updated_at
  THEN
    RAISE EXCEPTION 'Confirmed profile field identity or revision is invalid'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bw8_profile_export_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.student_case_id <> OLD.student_case_id
    OR NEW.student_profile_id <> OLD.student_profile_id
    OR NEW.profile_revision <> OLD.profile_revision
    OR NEW.template_key <> OLD.template_key
    OR NEW.template_version <> OLD.template_version
    OR NEW.template_sha256 <> OLD.template_sha256
    OR NEW.output_format <> OLD.output_format
    OR NEW.input_manifest_sha256 <> OLD.input_manifest_sha256
    OR NEW.request_id <> OLD.request_id
    OR NEW.created_by_membership_id <> OLD.created_by_membership_id
    OR NEW.created_at <> OLD.created_at
    OR OLD.status IN ('succeeded', 'failed', 'superseded')
    OR NOT (
      (OLD.status = 'queued' AND NEW.status IN ('processing', 'failed', 'superseded'))
      OR (OLD.status = 'processing' AND NEW.status IN ('succeeded', 'failed', 'superseded'))
    )
  THEN
    RAISE EXCEPTION 'Student Profile export identity or terminal evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bw8_requirement_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.country_requirement_version_id IS DISTINCT FROM OLD.country_requirement_version_id
    OR NEW.applicability_rule <> OLD.applicability_rule
    OR NEW.evidence_only <> OLD.evidence_only
    OR NEW.source_item_order IS DISTINCT FROM OLD.source_item_order
  THEN
    RAISE EXCEPTION 'Document requirement overlay metadata is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_bw8_slot_applicability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.applicability_status <> OLD.applicability_status
    OR NEW.applicability_reference_date IS DISTINCT FROM OLD.applicability_reference_date
  THEN
    RAISE EXCEPTION 'Document slot applicability is case-pinned and immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER student_profile_field_catalog_append_only
  BEFORE UPDATE OR DELETE ON platform.student_profile_field_catalog
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_profile_field_catalog_no_truncate
  BEFORE TRUNCATE ON platform.student_profile_field_catalog
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_extraction_runs_transition_guard
  BEFORE UPDATE OR DELETE ON platform.document_extraction_runs
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_extraction_run_mutation();
CREATE TRIGGER document_extraction_runs_no_truncate
  BEFORE TRUNCATE ON platform.document_extraction_runs
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_extracted_facts_transition_guard
  BEFORE UPDATE OR DELETE ON platform.document_extracted_facts
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_extracted_fact_mutation();
CREATE TRIGGER document_extracted_facts_no_truncate
  BEFORE TRUNCATE ON platform.document_extracted_facts
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_profile_field_values_revision_guard
  BEFORE UPDATE OR DELETE ON platform.student_profile_field_values
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_profile_field_value_mutation();
CREATE TRIGGER student_profile_field_values_no_truncate
  BEFORE TRUNCATE ON platform.student_profile_field_values
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_profile_field_decisions_append_only
  BEFORE UPDATE OR DELETE ON platform.student_profile_field_decisions
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_profile_field_decisions_no_truncate
  BEFORE TRUNCATE ON platform.student_profile_field_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_profile_exports_transition_guard
  BEFORE UPDATE OR DELETE ON platform.student_profile_exports
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_profile_export_mutation();
CREATE TRIGGER student_profile_exports_no_truncate
  BEFORE TRUNCATE ON platform.student_profile_exports
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER document_requirements_bw8_metadata_guard
  BEFORE UPDATE ON platform.document_requirements
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_requirement_metadata();
CREATE TRIGGER document_slots_bw8_applicability_guard
  BEFORE UPDATE ON platform.document_slots
  FOR EACH ROW EXECUTE FUNCTION platform_private.guard_bw8_slot_applicability();

ALTER TABLE platform.student_profile_field_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_extraction_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.document_extracted_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.document_extracted_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_values FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_field_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_profile_exports FORCE ROW LEVEL SECURITY;

-- Immutable v12 bundles clone v11. Only Admin and an assigned Curator receive
-- the BW8 sensitive-read/write permissions; Sales/Finance/Student stay denied.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('document.intelligence.read', 'Read assigned-case extraction and decision evidence'),
  ('document.intelligence.manage', 'Request and decide assigned-case document extraction'),
  ('profile.field.read', 'Read expanded confirmed Student Profile fields'),
  ('profile.field.manage', 'Confirm or manually edit expanded Student Profile fields'),
  ('profile.export.manage', 'Generate and download assigned-case Student Profile exports');

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000001101', 'admin', 12, 'draft', 'Admin v12 student document intelligence'),
  ('00000000-0000-4000-8000-000000001102', 'sales', 12, 'draft', 'Sales v12 unchanged'),
  ('00000000-0000-4000-8000-000000001103', 'curator', 12, 'draft', 'Curator v12 assigned student documents'),
  ('00000000-0000-4000-8000-000000001104', 'finance', 12, 'draft', 'Finance v12 unchanged'),
  ('00000000-0000-4000-8000-000000001105', 'student', 12, 'draft', 'Student v12 unchanged');

INSERT INTO platform.role_bundle_permissions (bundle_id, bundle_role, permission_key)
SELECT v12.id, v12.role, v11_permission.permission_key
FROM platform.role_bundle_versions AS v12
JOIN platform.role_bundle_versions AS v11
  ON v11.role = v12.role AND v11.version = 11 AND v11.status = 'published'
JOIN platform.role_bundle_permissions AS v11_permission
  ON v11_permission.bundle_id = v11.id AND v11_permission.bundle_role = v11.role
WHERE v12.version = 12;

INSERT INTO platform.role_bundle_permissions (bundle_id, bundle_role, permission_key)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 12
  AND bundle.role IN ('admin', 'curator')
  AND permission.permission_key IN (
    'document.intelligence.read', 'document.intelligence.manage',
    'profile.field.read', 'profile.field.manage', 'profile.export.manage'
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 12;

CREATE TEMPORARY TABLE bw8_membership_bundle_upgrades ON COMMIT DROP AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v12.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v11
  ON v11.id = membership.current_bundle_id
  AND v11.role = membership."current_role"
  AND v11.version = 11
  AND v11.status = 'published'
JOIN platform.role_bundle_versions AS v12
  ON v12.role = membership."current_role"
  AND v12.version = 12
  AND v12.status = 'published'
WHERE membership."current_role" IS NOT NULL
  AND membership.current_bundle_id IS NOT NULL;

INSERT INTO platform.membership_role_history (
  organization_id, membership_id, profile_id, role_version,
  previous_role, new_role, previous_bundle_id, new_bundle_id,
  actor_kind, actor_profile_id, reason, request_id
)
SELECT
  organization_id, membership_id, profile_id, next_role_version,
  business_role, business_role, previous_bundle_id, new_bundle_id,
  'system', NULL, 'BW8 immutable RBAC bundle upgrade', request_id
FROM bw8_membership_bundle_upgrades;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw8_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT profile_id FROM bw8_membership_bundle_upgrades
);

INSERT INTO platform.audit_events (
  organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state,
  reason, request_id
)
SELECT
  upgrade.organization_id, 'system', NULL,
  'migration:059_platform_student_document_intelligence',
  'rbac.bundle.upgrade', 'organization_membership', upgrade.membership_id,
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
  'BW8 immutable RBAC bundle upgrade', upgrade.request_id
FROM bw8_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION private.platform_can_read_student_document_intelligence(
  p_organization_id UUID,
  p_student_case_id UUID
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
    JOIN platform.profiles AS profile ON profile.id = membership.profile_id
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
      AND membership."current_role"::TEXT = (SELECT auth.jwt() ->> 'platform_role')
      AND profile.access_version::TEXT = (SELECT auth.jwt() ->> 'platform_access_version')
      AND private.platform_has_permission(
        p_organization_id, 'document.intelligence.read'
      )
      AND private.platform_has_permission(
        p_organization_id, 'profile.field.read'
      )
      AND (
        (
          membership."current_role" = 'admin'
          AND private.platform_has_scope(
            p_organization_id, 'organization', p_organization_id
          )
        )
        OR (
          membership."current_role" = 'curator'
          AND student_case.state IN ('active', 'closed')
          AND student_case.current_curator_membership_id = membership.id
          AND private.platform_has_scope(
            p_organization_id, 'student_case', p_student_case_id
          )
        )
      )
  )
$$;

CREATE POLICY student_profile_field_catalog_read
  ON platform.student_profile_field_catalog
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY document_extraction_runs_staff_read
  ON platform.document_extraction_runs
  FOR SELECT TO authenticated USING ((SELECT
    private.platform_can_read_student_document_intelligence(
      organization_id, student_case_id
    )
  ));
CREATE POLICY document_extracted_facts_staff_read
  ON platform.document_extracted_facts
  FOR SELECT TO authenticated USING ((SELECT
    private.platform_can_read_student_document_intelligence(
      organization_id, student_case_id
    )
  ));
CREATE POLICY student_profile_field_values_staff_read
  ON platform.student_profile_field_values
  FOR SELECT TO authenticated USING ((SELECT
    private.platform_can_read_student_document_intelligence(
      organization_id, student_case_id
    )
  ));
CREATE POLICY student_profile_field_decisions_staff_read
  ON platform.student_profile_field_decisions
  FOR SELECT TO authenticated USING ((SELECT
    private.platform_can_read_student_document_intelligence(
      organization_id, student_case_id
    )
  ));
CREATE POLICY student_profile_exports_staff_read
  ON platform.student_profile_exports
  FOR SELECT TO authenticated USING ((SELECT
    private.platform_can_read_student_document_intelligence(
      organization_id, student_case_id
    )
  ));

CREATE OR REPLACE FUNCTION platform_private.enqueue_bw8_durable_work(
  p_organization_id UUID,
  p_kind platform.durable_work_kind,
  p_source_document_version_id UUID,
  p_source_extraction_run_id UUID,
  p_source_profile_export_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID,
  p_operation platform.durable_work_operation
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_business_key TEXT := pg_catalog.lower(pg_catalog.btrim(p_business_key_sha256));
  source_match platform_private.durable_work_items%ROWTYPE;
  business_match platform_private.durable_work_items%ROWTYPE;
  existing_item platform_private.durable_work_items%ROWTYPE;
  document_version platform.document_versions%ROWTYPE;
  extraction_run platform.document_extraction_runs%ROWTYPE;
  profile_export platform.student_profile_exports%ROWTYPE;
  created_work_item_id UUID := gen_random_uuid();
  queue_message_id BIGINT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_kind NOT IN ('document_validation', 'document_extraction', 'student_profile_export')
    OR normalized_business_key !~ '^[0-9a-f]{64}$'
    OR p_max_attempts NOT BETWEEN 1 AND 20
    OR (
      p_kind = 'document_validation'
      AND (p_source_document_version_id IS NULL
        OR p_source_extraction_run_id IS NOT NULL
        OR p_source_profile_export_id IS NOT NULL
        OR p_operation <> 'enqueue_document_validation')
    OR (
      p_kind = 'document_extraction'
      AND (p_source_document_version_id IS NOT NULL
        OR p_source_extraction_run_id IS NULL
        OR p_source_profile_export_id IS NOT NULL
        OR p_operation <> 'enqueue_document_extraction')
    OR (
      p_kind = 'student_profile_export'
      AND (p_source_document_version_id IS NOT NULL
        OR p_source_extraction_run_id IS NOT NULL
        OR p_source_profile_export_id IS NULL
        OR p_operation <> 'enqueue_student_profile_export')
  THEN
    RAISE EXCEPTION 'Valid BW8 durable-work source and retry budget are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(sha256(convert_to(jsonb_build_object(
    'organization_id', p_organization_id,
    'kind', p_kind,
    'source_document_version_id', p_source_document_version_id,
    'source_extraction_run_id', p_source_extraction_run_id,
    'source_profile_export_id', p_source_profile_export_id,
    'business_key_sha256', normalized_business_key,
    'max_attempts', p_max_attempts
  )::TEXT, 'UTF8')), 'hex');

  replayed := platform_private.p2g_replay_request(
    p_request_id, p_operation, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:p2g:business:' || p_organization_id::TEXT || ':' || normalized_business_key,
    0
  ));

  IF p_kind = 'document_validation' THEN
    SELECT version.* INTO document_version
    FROM platform.document_versions AS version
    JOIN platform.document_slots AS slot
      ON slot.organization_id = version.organization_id
      AND slot.id = version.document_slot_id
      AND slot.student_case_id = version.student_case_id
      AND slot.current_version_id = version.id
      AND slot.current_version_no = version.version_no
    JOIN platform_private.document_upload_finalizations AS finalization
      ON finalization.organization_id = version.organization_id
      AND finalization.document_version_id = version.id
    WHERE version.organization_id = p_organization_id
      AND version.id = p_source_document_version_id
      AND version.integrity_status = 'pending'
      AND version.malware_status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Validation requires one finalized current pending document version'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_kind = 'document_extraction' THEN
    SELECT run.* INTO extraction_run
    FROM platform.document_extraction_runs AS run
    JOIN platform.document_versions AS version
      ON version.organization_id = run.organization_id
      AND version.id = run.document_version_id
      AND version.student_case_id = run.student_case_id
      AND version.document_slot_id = run.document_slot_id
    JOIN platform.document_slots AS slot
      ON slot.organization_id = version.organization_id
      AND slot.id = version.document_slot_id
      AND slot.current_version_id = version.id
      AND slot.current_version_no = version.version_no
    WHERE run.organization_id = p_organization_id
      AND run.id = p_source_extraction_run_id
      AND run.status = 'queued'
      AND version.integrity_status = 'verified'
      AND version.malware_status = 'clean'
      AND slot.status IN ('submitted', 'approved');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Extraction requires one queued clean current document run'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT export.* INTO profile_export
    FROM platform.student_profile_exports AS export
    JOIN platform.student_profiles AS profile
      ON profile.organization_id = export.organization_id
      AND profile.id = export.student_profile_id
      AND profile.student_case_id = export.student_case_id
      AND profile.revision = export.profile_revision
    WHERE export.organization_id = p_organization_id
      AND export.id = p_source_profile_export_id
      AND export.status = 'queued';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Export work requires one queued exact profile revision'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT item.* INTO source_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND (
      item.source_document_version_id = p_source_document_version_id
      OR item.source_extraction_run_id = p_source_extraction_run_id
      OR item.source_profile_export_id = p_source_profile_export_id
    )
  FOR UPDATE;

  SELECT item.* INTO business_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.business_key_sha256 = normalized_business_key
  FOR UPDATE;

  IF source_match.id IS NOT NULL AND business_match.id IS NOT NULL
    AND source_match.id <> business_match.id
  THEN
    RAISE EXCEPTION 'Source and business key identify different work items'
      USING ERRCODE = '22023';
  END IF;
  existing_item := COALESCE(source_match, business_match);

  IF existing_item.id IS NOT NULL THEN
    IF existing_item.kind <> p_kind
      OR existing_item.source_document_version_id IS DISTINCT FROM p_source_document_version_id
      OR existing_item.source_extraction_run_id IS DISTINCT FROM p_source_extraction_run_id
      OR existing_item.source_profile_export_id IS DISTINCT FROM p_source_profile_export_id
      OR existing_item.business_key_sha256 <> normalized_business_key
      OR existing_item.max_attempts <> p_max_attempts
    THEN
      RAISE EXCEPTION 'BW8 source or business key cannot be rebound'
        USING ERRCODE = '22023';
    END IF;
    result := jsonb_build_object(
      'organization_id', existing_item.organization_id,
      'work_item_id', existing_item.id,
      'kind', existing_item.kind,
      'state', existing_item.state,
      'queue_message_id', existing_item.queue_message_id,
      'deduplicated', TRUE,
      'queue_payload_is_pointer_only', TRUE
    );
    PERFORM platform_private.p2g_store_result(
      p_request_id, p_operation, input_sha256, existing_item.organization_id,
      existing_item.id, NULL, result
    );
    INSERT INTO platform.audit_events (
      organization_id, actor_kind, actor_profile_id, actor_principal,
      action, resource_type, resource_id, before_state, after_state,
      reason, request_id
    ) VALUES (
      existing_item.organization_id, 'service', NULL,
      'service:platform-durable-work', 'work.enqueue.deduplicate',
      'durable_work_item', existing_item.id,
      jsonb_build_object('state', existing_item.state), result,
      'Deduplicate one validated BW8 pointer-only work item', p_request_id
    );
    RETURN result;
  END IF;

  SELECT pgmq.send(
    'platform_work_v1',
    jsonb_build_object('v', 1, 'work_item_id', created_work_item_id, 'kind', p_kind),
    0
  ) INTO queue_message_id;

  INSERT INTO platform_private.durable_work_items (
    id, organization_id, kind, source_document_version_id,
    source_extraction_run_id, source_profile_export_id, business_key_sha256,
    queue_message_id, max_attempts, request_id
  ) VALUES (
    created_work_item_id, p_organization_id, p_kind, p_source_document_version_id,
    p_source_extraction_run_id, p_source_profile_export_id,
    normalized_business_key, queue_message_id, p_max_attempts, p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', created_work_item_id,
    'kind', p_kind,
    'state', 'queued',
    'queue_message_id', queue_message_id,
    'source_document_version_id', p_source_document_version_id,
    'source_extraction_run_id', p_source_extraction_run_id,
    'source_profile_export_id', p_source_profile_export_id,
    'max_attempts', p_max_attempts,
    'deduplicated', FALSE,
    'queue_payload_is_pointer_only', TRUE
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id, work_item_id, event_type, previous_state, new_state,
    queue_message_id, evidence_ref, request_id
  ) VALUES (
    p_organization_id, created_work_item_id, 'enqueued', NULL, 'queued',
    queue_message_id, 'business-key:' || normalized_business_key, p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id, p_operation, input_sha256, p_organization_id,
    created_work_item_id, NULL, result
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'service', NULL, 'service:platform-durable-work',
    'work.enqueue', 'durable_work_item', created_work_item_id,
    NULL, result, 'Enqueue one validated BW8 pointer-only work item', p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_document_validation_work(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.enqueue_bw8_durable_work(
    p_organization_id, 'document_validation', p_document_version_id,
    NULL, NULL, p_business_key_sha256, p_max_attempts, p_request_id,
    'enqueue_document_validation'
  )
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_document_extraction_work(
  p_organization_id UUID,
  p_extraction_run_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.enqueue_bw8_durable_work(
    p_organization_id, 'document_extraction', NULL, p_extraction_run_id,
    NULL, p_business_key_sha256, p_max_attempts, p_request_id,
    'enqueue_document_extraction'
  )
$$;

CREATE OR REPLACE FUNCTION platform.enqueue_student_profile_export_work(
  p_organization_id UUID,
  p_profile_export_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
)
RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT platform_private.enqueue_bw8_durable_work(
    p_organization_id, 'student_profile_export', NULL, NULL,
    p_profile_export_id, p_business_key_sha256, p_max_attempts, p_request_id,
    'enqueue_student_profile_export'
  )
$$;

CREATE OR REPLACE FUNCTION platform.claim_durable_work(
  p_visibility_timeout_seconds INTEGER,
  p_worker_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queue_message RECORD;
  work_item platform_private.durable_work_items%ROWTYPE;
  prior_attempt platform_private.durable_work_attempts%ROWTYPE;
  created_attempt_id UUID := gen_random_uuid();
  expiry_request_id UUID;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR btrim(p_worker_ref) = ''
    OR char_length(btrim(p_worker_ref)) > 200
  THEN
    RAISE EXCEPTION
      'Visibility timeout and worker reference are invalid'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'visibility_timeout_seconds', p_visibility_timeout_seconds,
          'worker_ref', btrim(p_worker_ref)
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    'claim',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO queue_message
  FROM pgmq.read(
    'platform_work_v1',
    p_visibility_timeout_seconds,
    1,
    '{}'::JSONB
  );

  IF NOT FOUND THEN
    result := jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1'
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      'claim',
      input_sha256,
      NULL,
      NULL,
      NULL,
      result
    );

[context-firewall: omitted 276 middle lines]

    work_item.organization_id,
    work_item.id,
    created_attempt_id,
    result
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
    work_item.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.claim',
    'durable_work_item',
    work_item.id,
    jsonb_build_object(
      'state', work_item.state,
      'attempt_count', work_item.attempt_count
    ),
    result,
    'Claim via PGMQ visibility timeout',
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_document_extraction_run(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_extractor_provider TEXT,
  p_extractor_model_version TEXT,
  p_extractor_policy_version TEXT,
  p_attempt_no INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version_row platform.document_versions%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  existing platform.document_extraction_runs%ROWTYPE;
  created_id UUID := gen_random_uuid();
  normalized_provider TEXT := pg_catalog.lower(pg_catalog.btrim(p_extractor_provider));
  normalized_model TEXT := pg_catalog.btrim(p_extractor_model_version);
  normalized_policy TEXT := pg_catalog.btrim(p_extractor_policy_version);
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  IF p_organization_id IS NULL OR p_document_version_id IS NULL
    OR p_request_id IS NULL OR p_attempt_no NOT BETWEEN 1 AND 20
    OR normalized_provider !~ '^[a-z][a-z0-9_.-]{1,63}$'
    OR pg_catalog.char_length(normalized_model) NOT BETWEEN 1 AND 160
    OR normalized_model ~ '[[:cntrl:]]'
    OR normalized_policy !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'
  THEN
    RAISE EXCEPTION 'Complete bounded extraction-run identity is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT run.* INTO existing
  FROM platform.document_extraction_runs AS run
  WHERE run.request_id = p_request_id;
  IF FOUND THEN
    IF existing.organization_id <> p_organization_id
      OR existing.document_version_id <> p_document_version_id
      OR existing.extractor_provider <> normalized_provider
      OR existing.extractor_model_version <> normalized_model
      OR existing.extractor_policy_version <> normalized_policy
      OR existing.attempt_no <> p_attempt_no
    THEN
      RAISE EXCEPTION 'request_id was already used for another extraction run'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', existing.organization_id,
      'extraction_run_id', existing.id,
      'student_case_id', existing.student_case_id,
      'document_slot_id', existing.document_slot_id,
      'document_version_id', existing.document_version_id,
      'status', existing.status,
      'deduplicated', TRUE
    );
  END IF;

  PERFORM 1 FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document version is unavailable' USING ERRCODE = '42501'; END IF;

  SELECT version.* INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document version is unavailable' USING ERRCODE = '42501'; END IF;

  SELECT slot.* INTO slot_row
  FROM platform.document_slots AS slot
  WHERE slot.organization_id = version_row.organization_id
    AND slot.id = version_row.document_slot_id
    AND slot.student_case_id = version_row.student_case_id
  FOR UPDATE;
  SELECT version.* INTO version_row
  FROM platform.document_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_document_version_id
  FOR UPDATE;

  IF slot_row.current_version_id <> version_row.id
    OR slot_row.current_version_no <> version_row.version_no
    OR slot_row.status NOT IN ('submitted', 'approved')
    OR version_row.integrity_status <> 'verified'
    OR version_row.malware_status <> 'clean'
  THEN
    RAISE EXCEPTION 'Extraction requires the clean current submitted document version'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.document_extraction_runs (
    id, organization_id, student_case_id, document_slot_id,
    document_version_id, status, extractor_provider,
    extractor_model_version, extractor_policy_version, request_id, attempt_no
  ) VALUES (
    created_id, p_organization_id, version_row.student_case_id,
    version_row.document_slot_id, version_row.id, 'queued', normalized_provider,
    normalized_model, normalized_policy, p_request_id, p_attempt_no
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'extraction_run_id', created_id,
    'student_case_id', version_row.student_case_id,
    'document_slot_id', version_row.document_slot_id,
    'document_version_id', version_row.id,
    'status', 'queued',
    'deduplicated', FALSE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'service', NULL, 'service:document-extraction',
    'document.extraction.run.create', 'document_extraction_run', created_id,
    NULL, result, 'Create provider-free extraction run evidence', p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.transition_document_extraction_run(
  p_organization_id UUID,
  p_extraction_run_id UUID,
  p_expected_status platform.document_extraction_run_status,
  p_new_status platform.document_extraction_run_status,
  p_failure_code TEXT,
  p_failure_detail_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run platform.document_extraction_runs%ROWTYPE;
  replayed JSONB;
  result JSONB;
  normalized_failure_code TEXT := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_failure_code)), '');
  normalized_failure_ref TEXT := NULLIF(pg_catalog.btrim(p_failure_detail_ref), '');
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);
  IF p_organization_id IS NULL OR p_extraction_run_id IS NULL
    OR p_expected_status IS NULL OR p_new_status IS NULL
    OR p_new_status NOT IN ('processing', 'succeeded', 'failed', 'superseded')
    OR (p_new_status = 'failed' AND normalized_failure_code IS NULL)
    OR (p_new_status <> 'failed' AND (normalized_failure_code IS NOT NULL OR normalized_failure_ref IS NOT NULL))
    OR (normalized_failure_code IS NOT NULL AND normalized_failure_code !~ '^[a-z][a-z0-9_.-]{1,63}$')
    OR (normalized_failure_ref IS NOT NULL AND pg_catalog.char_length(normalized_failure_ref) > 512)
  THEN
    RAISE EXCEPTION 'Extraction run transition is inconsistent'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'document.extraction.run.transition',
    'document_extraction_run', p_extraction_run_id,
    'Transition one persisted document extraction run',
    jsonb_build_object('new_status', p_new_status)
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT candidate.* INTO run
  FROM platform.document_extraction_runs AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_extraction_run_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extraction run is unavailable' USING ERRCODE = '42501'; END IF;
  IF run.status <> p_expected_status THEN
    RAISE EXCEPTION 'Extraction run changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  UPDATE platform.document_extraction_runs
  SET status = p_new_status,
      processing_started_at = CASE
        WHEN p_new_status = 'processing' THEN statement_timestamp()
        ELSE processing_started_at
      END,
      completed_at = CASE
        WHEN p_new_status IN ('succeeded', 'failed', 'superseded')
          THEN statement_timestamp()
        ELSE NULL
      END,
      failure_code = normalized_failure_code,
      failure_detail_ref = normalized_failure_ref,
      updated_at = statement_timestamp()
  WHERE id = run.id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'extraction_run_id', run.id,
    'previous_status', run.status,
    'new_status', p_new_status
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'service', NULL, 'service:document-extraction',
    'document.extraction.run.transition', 'document_extraction_run', run.id,
    jsonb_build_object('status', run.status), result,
    'Transition one persisted document extraction run', p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.append_document_extracted_fact(
  p_organization_id UUID,
  p_extraction_run_id UUID,
  p_field_key TEXT,
  p_value_kind platform.student_profile_value_kind,
  p_candidate_value JSONB,
  p_normalized_value JSONB,
  p_confidence NUMERIC,
  p_source_locator JSONB,
  p_initial_status platform.document_extracted_fact_status,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run platform.document_extraction_runs%ROWTYPE;
  existing platform.document_extracted_facts%ROWTYPE;
  created_id UUID := gen_random_uuid();
  result JSONB;
  value_sha256 TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);
  IF p_organization_id IS NULL OR p_extraction_run_id IS NULL
    OR p_field_key IS NULL OR p_value_kind IS NULL OR p_request_id IS NULL
    OR p_initial_status NOT IN ('proposed', 'conflict')
    OR p_confidence NOT BETWEEN 0 AND 1
    OR NOT platform_private.student_profile_value_is_valid(p_value_kind, p_candidate_value)
    OR NOT platform_private.student_profile_value_is_valid(p_value_kind, p_normalized_value)
    OR NOT platform_private.document_source_locator_is_valid(p_source_locator)
  THEN
    RAISE EXCEPTION 'Complete typed extracted fact evidence is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT fact.* INTO existing
  FROM platform.document_extracted_facts AS fact
  WHERE fact.request_id = p_request_id;
  IF FOUND THEN
    IF existing.organization_id <> p_organization_id
      OR existing.extraction_run_id <> p_extraction_run_id
      OR existing.field_key <> p_field_key
      OR existing.value_kind <> p_value_kind
      OR existing.candidate_value <> p_candidate_value
      OR existing.normalized_value <> p_normalized_value
      OR existing.confidence <> p_confidence
      OR existing.source_locator <> p_source_locator
      OR existing.status <> p_initial_status
    THEN
      RAISE EXCEPTION 'request_id was already used for another extracted fact'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object(
      'organization_id', existing.organization_id,
      'extracted_fact_id', existing.id,
      'extraction_run_id', existing.extraction_run_id,
      'status', existing.status,
      'deduplicated', TRUE
    );
  END IF;

  SELECT candidate.* INTO run
  FROM platform.document_extraction_runs AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_extraction_run_id
  FOR KEY SHARE;
  IF NOT FOUND OR run.status NOT IN ('processing', 'succeeded') THEN
    RAISE EXCEPTION 'Facts require one processing or succeeded extraction run'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.document_extracted_facts (
    id, organization_id, student_case_id, document_slot_id,
    document_version_id, extraction_run_id, field_key, value_kind,
    candidate_value, normalized_value, confidence, source_locator, status,
    extractor_model_version, extractor_policy_version, request_id
  ) VALUES (
    created_id, run.organization_id, run.student_case_id, run.document_slot_id,
    run.document_version_id, run.id, p_field_key, p_value_kind,
    p_candidate_value, p_normalized_value, p_confidence, p_source_locator,
    p_initial_status, run.extractor_model_version,
    run.extractor_policy_version, p_request_id
  );
  value_sha256 := encode(sha256(convert_to(p_normalized_value::TEXT, 'UTF8')), 'hex');
  result := jsonb_build_object(
    'organization_id', run.organization_id,
    'extracted_fact_id', created_id,
    'extraction_run_id', run.id,
    'student_case_id', run.student_case_id,
    'document_version_id', run.document_version_id,
    'field_key', p_field_key,
    'status', p_initial_status,
    'normalized_value_sha256', value_sha256,
    'deduplicated', FALSE
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    run.organization_id, 'service', NULL, 'service:document-extraction',
    'document.extracted.fact.append', 'document_extracted_fact', created_id,
    NULL, result, 'Append typed candidate evidence without profile mutation',
    p_request_id
  );
  RETURN result;
END
$$;

ALTER TABLE platform.student_profiles
  ADD CONSTRAINT student_profiles_organization_id_id_case_key
  UNIQUE (organization_id, id, student_case_id);
ALTER TABLE platform.student_profile_field_values
  ADD CONSTRAINT student_profile_field_values_profile_case_fkey
  FOREIGN KEY (organization_id, student_profile_id, student_case_id)
  REFERENCES platform.student_profiles(organization_id, id, student_case_id)
  ON DELETE RESTRICT;
ALTER TABLE platform.student_profile_field_decisions
  ADD CONSTRAINT student_profile_field_decisions_profile_case_fkey
  FOREIGN KEY (organization_id, student_profile_id, student_case_id)
  REFERENCES platform.student_profiles(organization_id, id, student_case_id)
  ON DELETE RESTRICT;
ALTER TABLE platform.student_profile_exports
  ADD CONSTRAINT student_profile_exports_profile_case_fkey
  FOREIGN KEY (organization_id, student_profile_id, student_case_id)
  REFERENCES platform.student_profiles(organization_id, id, student_case_id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION platform_private.lock_bw8_request(p_request_id UUID)
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
    hashtextextended('evo:bw8:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw8_case_actor(
  p_organization_id UUID,
  p_student_case_id UUID,
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
DECLARE actor RECORD;
BEGIN
  SELECT authority.* INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id, p_student_case_id, p_permission_key
  ) AS authority;
  IF actor.actor_role NOT IN ('admin', 'curator') THEN
    RAISE EXCEPTION 'Active Admin or assigned Curator authority is required'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT actor.actor_profile_id, actor.actor_membership_id,
    actor.actor_auth_user_id, actor.actor_role;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.project_bw8_profile_field(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_student_profile_id UUID,
  p_field_key TEXT,
  p_field_value JSONB,
  p_actor_membership_id UUID,
  p_new_profile_revision BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  participant_labels TEXT[];
  consent_status_value platform.student_profile_consent_status;
  consent_evidence_value TEXT;
  stored_consent_status JSONB;
  stored_consent_evidence JSONB;
BEGIN
  IF p_field_key = 'decision.participant_labels' THEN
    SELECT COALESCE(array_agg(value ORDER BY ordinal), ARRAY[]::TEXT[])
    INTO participant_labels
    FROM pg_catalog.jsonb_array_elements_text(p_field_value)
      WITH ORDINALITY AS item(value, ordinal);
  END IF;

  IF p_field_key IN ('consent.status', 'consent.evidence_ref') THEN
    SELECT field_value INTO stored_consent_status
    FROM platform.student_profile_field_values
    WHERE organization_id = p_organization_id
      AND student_case_id = p_student_case_id
      AND field_key = 'consent.status';
    SELECT field_value INTO stored_consent_evidence
    FROM platform.student_profile_field_values
    WHERE organization_id = p_organization_id
      AND student_case_id = p_student_case_id
      AND field_key = 'consent.evidence_ref';
    IF p_field_key = 'consent.status' THEN stored_consent_status := p_field_value; END IF;
    IF p_field_key = 'consent.evidence_ref' THEN stored_consent_evidence := p_field_value; END IF;
    IF stored_consent_status IS NOT NULL THEN
      consent_status_value := (stored_consent_status #>> '{}')::platform.student_profile_consent_status;
      consent_evidence_value := CASE
        WHEN consent_status_value = 'not_recorded' THEN NULL
        ELSE stored_consent_evidence #>> '{}'
      END;
      IF consent_status_value <> 'not_recorded' AND consent_evidence_value IS NULL THEN
        consent_status_value := NULL;
      END IF;
    END IF;
  END IF;

  UPDATE platform.student_profiles AS profile
  SET
    preferred_display_name = CASE WHEN p_field_key = 'identity.preferred_display_name'
      THEN p_field_value #>> '{}' ELSE profile.preferred_display_name END,
    legal_display_name = CASE WHEN p_field_key = 'identity.legal_display_name'
      THEN p_field_value #>> '{}' ELSE profile.legal_display_name END,
    communication_language = CASE WHEN p_field_key = 'preferences.communication_language'
      THEN p_field_value #>> '{}' ELSE profile.communication_language END,
    date_of_birth = CASE WHEN p_field_key = 'personal.date_of_birth'
      THEN (p_field_value #>> '{}')::DATE ELSE profile.date_of_birth END,
    citizenship_country = CASE WHEN p_field_key = 'personal.citizenship_country'
      THEN p_field_value #>> '{}' ELSE profile.citizenship_country END,
    residency_country = CASE WHEN p_field_key = 'personal.residency_country'
      THEN p_field_value #>> '{}' ELSE profile.residency_country END,
    current_education_summary = CASE WHEN p_field_key = 'education.current_summary'
      THEN p_field_value #>> '{}' ELSE profile.current_education_summary END,
    academic_summary = CASE WHEN p_field_key = 'education.academic_summary'
      THEN p_field_value #>> '{}' ELSE profile.academic_summary END,
    language_summary = CASE WHEN p_field_key = 'language.summary'
      THEN p_field_value #>> '{}' ELSE profile.language_summary END,
    budget_band = CASE WHEN p_field_key = 'study.budget_band'
      THEN p_field_value #>> '{}' ELSE profile.budget_band END,
    decision_participant_labels = CASE WHEN p_field_key = 'decision.participant_labels'
      THEN participant_labels ELSE profile.decision_participant_labels END,
    consent_status = CASE WHEN p_field_key IN ('consent.status', 'consent.evidence_ref')
      AND consent_status_value IS NOT NULL
      THEN consent_status_value ELSE profile.consent_status END,
    consent_evidence_ref = CASE WHEN p_field_key IN ('consent.status', 'consent.evidence_ref')
      AND consent_status_value IS NOT NULL
      THEN consent_evidence_value ELSE profile.consent_evidence_ref END,
    next_step = CASE WHEN p_field_key = 'workflow.next_step'
      THEN p_field_value #>> '{}' ELSE profile.next_step END,
    revision = p_new_profile_revision,
    updated_by_membership_id = p_actor_membership_id,
    updated_at = statement_timestamp()
  WHERE profile.organization_id = p_organization_id
    AND profile.id = p_student_profile_id
    AND profile.student_case_id = p_student_case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student Profile is unavailable' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.manual_edit_student_profile_field(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_expected_profile_revision BIGINT,
  p_field_key TEXT,
  p_value_kind platform.student_profile_value_kind,
  p_field_value JSONB,
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
  profile platform.student_profiles%ROWTYPE;
  current_value platform.student_profile_field_values%ROWTYPE;
  catalog platform.student_profile_field_catalog%ROWTYPE;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  input_sha256 TEXT;
  replayed JSONB;
  field_value_id UUID;
  next_field_revision BIGINT;
  next_profile_revision BIGINT;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_expected_profile_revision IS NULL OR p_expected_profile_revision <= 0
    OR p_field_key IS NULL OR p_value_kind IS NULL
    OR NOT platform_private.student_profile_value_is_valid(p_value_kind, p_field_value)
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete typed manual profile edit is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.* INTO actor
  FROM platform_private.require_bw8_case_actor(
    p_organization_id, p_student_case_id, 'profile.field.manage'
  ) AS authority;
  PERFORM platform_private.lock_bw8_request(p_request_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw8:profile-field:' || p_organization_id::TEXT || ':'
      || p_student_case_id::TEXT || ':' || p_field_key, 0
  ));

  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'expected_profile_revision', p_expected_profile_revision,
    'field_key', p_field_key,
    'value_kind', p_value_kind,
    'field_value', p_field_value
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'student.profile.field.manual_edit',
    'student_profile_field_value', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT field.* INTO catalog
  FROM platform.student_profile_field_catalog AS field
  WHERE field.field_key = p_field_key AND field.value_kind = p_value_kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile field kind does not match catalog' USING ERRCODE = '22023'; END IF;

  PERFORM 1 FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id FOR UPDATE;
  SELECT candidate.* INTO profile
  FROM platform.student_profiles AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student Profile is unavailable' USING ERRCODE = '42501'; END IF;
  IF profile.revision <> p_expected_profile_revision THEN
    RAISE EXCEPTION 'Student Profile revision changed concurrently'
      USING ERRCODE = '40001';
  END IF;
  SELECT value.* INTO current_value
  FROM platform.student_profile_field_values AS value
  WHERE value.organization_id = p_organization_id
    AND value.student_case_id = p_student_case_id
    AND value.field_key = p_field_key
  FOR UPDATE;

  field_value_id := COALESCE(current_value.id, gen_random_uuid());
  next_field_revision := COALESCE(current_value.field_revision, 0) + 1;
  next_profile_revision := profile.revision + 1;
  PERFORM platform_private.project_bw8_profile_field(
    p_organization_id, p_student_case_id, profile.id, p_field_key,
    p_field_value, actor.actor_membership_id, next_profile_revision
  );

  INSERT INTO platform.student_profile_field_values (
    id, organization_id, student_case_id, student_profile_id, field_key,
    value_kind, field_value, field_revision, profile_revision, source_kind,
    source_fact_id, confirmed_by_membership_id, request_id
  ) VALUES (
    field_value_id, p_organization_id, p_student_case_id, profile.id, p_field_key,
    p_value_kind, p_field_value, next_field_revision, next_profile_revision,
    'manual', NULL, actor.actor_membership_id, p_request_id
  ) ON CONFLICT (organization_id, student_case_id, field_key) DO UPDATE SET
    field_value = EXCLUDED.field_value,
    field_revision = EXCLUDED.field_revision,
    profile_revision = EXCLUDED.profile_revision,
    source_kind = EXCLUDED.source_kind,
    source_fact_id = NULL,
    confirmed_by_membership_id = EXCLUDED.confirmed_by_membership_id,
    request_id = EXCLUDED.request_id,
    updated_at = statement_timestamp();

  INSERT INTO platform.student_profile_field_decisions (
    organization_id, student_case_id, student_profile_id, field_key,
    decision_kind, extracted_fact_id, before_value, after_value,
    before_field_revision, after_field_revision, profile_revision_before,
    profile_revision_after, actor_membership_id, reason, request_id
  ) VALUES (
    p_organization_id, p_student_case_id, profile.id, p_field_key,
    'manual_edit', NULL, current_value.field_value, p_field_value,
    current_value.field_revision, next_field_revision, profile.revision,
    next_profile_revision, actor.actor_membership_id, normalized_reason, p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'student_profile_id', profile.id,
    'student_profile_field_value_id', field_value_id,
    'field_key', p_field_key,
    'field_revision', next_field_revision,
    'profile_revision', next_profile_revision,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.field.manual_edit', 'student_profile_field_value',
    field_value_id,
    jsonb_build_object('field_revision', current_value.field_revision,
      'profile_revision', profile.revision),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.confirm_student_profile_extracted_fact(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_extracted_fact_id UUID,
  p_expected_profile_revision BIGINT,
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
  fact platform.document_extracted_facts%ROWTYPE;
  run platform.document_extraction_runs%ROWTYPE;
  version_row platform.document_versions%ROWTYPE;
  slot_row platform.document_slots%ROWTYPE;
  profile platform.student_profiles%ROWTYPE;
  current_value platform.student_profile_field_values%ROWTYPE;
  current_source_created_at TIMESTAMPTZ;
  candidate_source_created_at TIMESTAMPTZ;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  input_sha256 TEXT;
  replayed JSONB;
  field_value_id UUID;
  next_field_revision BIGINT;
  next_profile_revision BIGINT;
  selected_decision platform.student_profile_field_decision_kind := 'confirm';
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_extracted_fact_id IS NULL OR p_expected_profile_revision IS NULL
    OR p_expected_profile_revision <= 0
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete extracted-fact confirmation is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT authority.* INTO actor
  FROM platform_private.require_bw8_case_actor(
    p_organization_id, p_student_case_id, 'profile.field.manage'
  ) AS authority;
  PERFORM platform_private.lock_bw8_request(p_request_id);

  SELECT candidate.* INTO fact
  FROM platform.document_extracted_facts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
    AND candidate.id = p_extracted_fact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracted fact is unavailable' USING ERRCODE = '42501'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw8:profile-field:' || p_organization_id::TEXT || ':'
      || p_student_case_id::TEXT || ':' || fact.field_key, 0
  ));
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'extracted_fact_id', p_extracted_fact_id,
    'expected_profile_revision', p_expected_profile_revision
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'student.profile.field.confirm',
    'document_extracted_fact', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM 1 FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id FOR UPDATE;
  SELECT candidate.* INTO slot_row
  FROM platform.document_slots AS candidate
  WHERE candidate.organization_id = fact.organization_id
    AND candidate.id = fact.document_slot_id
    AND candidate.student_case_id = fact.student_case_id
  FOR UPDATE;
  SELECT candidate.* INTO version_row
  FROM platform.document_versions AS candidate
  WHERE candidate.organization_id = fact.organization_id
    AND candidate.id = fact.document_version_id
    AND candidate.document_slot_id = fact.document_slot_id
    AND candidate.student_case_id = fact.student_case_id
  FOR UPDATE;
  SELECT candidate.* INTO profile
  FROM platform.student_profiles AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
  FOR UPDATE;
  SELECT candidate.* INTO fact
  FROM platform.document_extracted_facts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_extracted_fact_id
  FOR UPDATE;
  SELECT candidate.* INTO run
  FROM platform.document_extraction_runs AS candidate
  WHERE candidate.organization_id = fact.organization_id
    AND candidate.id = fact.extraction_run_id
  FOR KEY SHARE;

  IF profile.id IS NULL THEN RAISE EXCEPTION 'Student Profile is unavailable' USING ERRCODE = '42501'; END IF;
  IF profile.revision <> p_expected_profile_revision THEN
    RAISE EXCEPTION 'Student Profile revision changed concurrently'
      USING ERRCODE = '40001';
  END IF;
  IF fact.status NOT IN ('proposed', 'conflict')
    OR run.status <> 'succeeded'
    OR slot_row.current_version_id <> version_row.id
    OR slot_row.current_version_no <> version_row.version_no
    OR slot_row.status NOT IN ('submitted', 'approved')
    OR version_row.integrity_status <> 'verified'
    OR version_row.malware_status <> 'clean'
  THEN
    RAISE EXCEPTION 'Only a current clean undecided fact from a succeeded run can be confirmed'
      USING ERRCODE = '55000';
  END IF;

  SELECT candidate.* INTO current_value
  FROM platform.student_profile_field_values AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
    AND candidate.field_key = fact.field_key
  FOR UPDATE;
  IF current_value.source_fact_id IS NOT NULL THEN
    SELECT source_version.created_at INTO current_source_created_at
    FROM platform.document_extracted_facts AS source_fact
    JOIN platform.document_versions AS source_version
      ON source_version.organization_id = source_fact.organization_id
      AND source_version.id = source_fact.document_version_id
    WHERE source_fact.organization_id = current_value.organization_id
      AND source_fact.id = current_value.source_fact_id;
    candidate_source_created_at := version_row.created_at;
    IF current_source_created_at > candidate_source_created_at THEN
      RAISE EXCEPTION 'A newer confirmed document source already owns this field'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  field_value_id := COALESCE(current_value.id, gen_random_uuid());
  next_field_revision := COALESCE(current_value.field_revision, 0) + 1;
  next_profile_revision := profile.revision + 1;
  IF current_value.id IS NOT NULL THEN selected_decision := 'supersede'; END IF;

  PERFORM platform_private.project_bw8_profile_field(
    p_organization_id, p_student_case_id, profile.id, fact.field_key,
    fact.normalized_value, actor.actor_membership_id, next_profile_revision
  );
  INSERT INTO platform.student_profile_field_values (
    id, organization_id, student_case_id, student_profile_id, field_key,
    value_kind, field_value, field_revision, profile_revision, source_kind,
    source_fact_id, confirmed_by_membership_id, request_id
  ) VALUES (
    field_value_id, p_organization_id, p_student_case_id, profile.id,
    fact.field_key, fact.value_kind, fact.normalized_value,
    next_field_revision, next_profile_revision, 'extracted_fact', fact.id,
    actor.actor_membership_id, p_request_id
  ) ON CONFLICT (organization_id, student_case_id, field_key) DO UPDATE SET
    field_value = EXCLUDED.field_value,
    field_revision = EXCLUDED.field_revision,
    profile_revision = EXCLUDED.profile_revision,
    source_kind = EXCLUDED.source_kind,
    source_fact_id = EXCLUDED.source_fact_id,
    confirmed_by_membership_id = EXCLUDED.confirmed_by_membership_id,
    request_id = EXCLUDED.request_id,
    updated_at = statement_timestamp();

  IF current_value.source_fact_id IS NOT NULL
    AND current_value.source_fact_id <> fact.id
  THEN
    UPDATE platform.document_extracted_facts
    SET status = 'superseded', decided_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND id = current_value.source_fact_id
      AND status = 'confirmed';
  END IF;
  UPDATE platform.document_extracted_facts
  SET status = 'confirmed', decided_at = statement_timestamp()
  WHERE organization_id = p_organization_id AND id = fact.id;

  INSERT INTO platform.student_profile_field_decisions (
    organization_id, student_case_id, student_profile_id, field_key,
    decision_kind, extracted_fact_id, before_value, after_value,
    before_field_revision, after_field_revision, profile_revision_before,
    profile_revision_after, actor_membership_id, reason, request_id
  ) VALUES (
    p_organization_id, p_student_case_id, profile.id, fact.field_key,
    selected_decision, fact.id, current_value.field_value, fact.normalized_value,
    current_value.field_revision, next_field_revision, profile.revision,
    next_profile_revision, actor.actor_membership_id, normalized_reason, p_request_id
  );
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'student_profile_id', profile.id,
    'student_profile_field_value_id', field_value_id,
    'extracted_fact_id', fact.id,
    'field_key', fact.field_key,
    'decision', selected_decision,
    'field_revision', next_field_revision,
    'profile_revision', next_profile_revision,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.field.confirm', 'document_extracted_fact', fact.id,
    jsonb_build_object('fact_status', fact.status,
      'field_revision', current_value.field_revision,
      'profile_revision', profile.revision),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.reject_student_profile_extracted_fact(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_extracted_fact_id UUID,
  p_expected_profile_revision BIGINT,
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
  fact platform.document_extracted_facts%ROWTYPE;
  profile platform.student_profiles%ROWTYPE;
  current_value platform.student_profile_field_values%ROWTYPE;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_extracted_fact_id IS NULL OR p_expected_profile_revision IS NULL
    OR p_expected_profile_revision <= 0
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete extracted-fact rejection is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT authority.* INTO actor
  FROM platform_private.require_bw8_case_actor(
    p_organization_id, p_student_case_id, 'profile.field.manage'
  ) AS authority;
  PERFORM platform_private.lock_bw8_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'extracted_fact_id', p_extracted_fact_id,
    'expected_profile_revision', p_expected_profile_revision
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'student.profile.field.reject',
    'document_extracted_fact', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM 1 FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id FOR KEY SHARE;
  PERFORM 1 FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id FOR UPDATE;
  SELECT candidate.* INTO profile
  FROM platform.student_profiles AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id FOR UPDATE;
  SELECT candidate.* INTO fact
  FROM platform.document_extracted_facts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
    AND candidate.id = p_extracted_fact_id FOR UPDATE;
  IF profile.id IS NULL OR fact.id IS NULL THEN
    RAISE EXCEPTION 'Student Profile or extracted fact is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF profile.revision <> p_expected_profile_revision THEN
    RAISE EXCEPTION 'Student Profile revision changed concurrently'
      USING ERRCODE = '40001';
  END IF;
  IF fact.status NOT IN ('proposed', 'conflict') THEN
    RAISE EXCEPTION 'Only an undecided fact may be rejected'
      USING ERRCODE = '55000';
  END IF;
  SELECT candidate.* INTO current_value
  FROM platform.student_profile_field_values AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id
    AND candidate.field_key = fact.field_key;

  UPDATE platform.document_extracted_facts
  SET status = 'rejected', decided_at = statement_timestamp()
  WHERE id = fact.id;
  INSERT INTO platform.student_profile_field_decisions (
    organization_id, student_case_id, student_profile_id, field_key,
    decision_kind, extracted_fact_id, before_value, after_value,
    before_field_revision, after_field_revision, profile_revision_before,
    profile_revision_after, actor_membership_id, reason, request_id
  ) VALUES (
    p_organization_id, p_student_case_id, profile.id, fact.field_key,
    'reject', fact.id, current_value.field_value, NULL,
    current_value.field_revision, NULL, profile.revision, profile.revision,
    actor.actor_membership_id, normalized_reason, p_request_id
  );
  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'extracted_fact_id', fact.id,
    'field_key', fact.field_key,
    'decision', 'reject',
    'profile_revision', profile.revision,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'student.profile.field.reject', 'document_extracted_fact', fact.id,
    jsonb_build_object('fact_status', fact.status), result,
    normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.create_china_student_document_overlay(
  p_organization_id UUID,
  p_target_degree TEXT,
  p_program_direction TEXT,
  p_version BIGINT,
  p_source_registry_id UUID,
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
  created_version_id UUID := gen_random_uuid();
  normalized_degree TEXT := pg_catalog.btrim(p_target_degree);
  normalized_program TEXT := pg_catalog.btrim(p_program_direction);
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
  required_fields platform.student_profile_field[] := ARRAY[
    'preferred_display_name', 'legal_display_name', 'communication_language',
    'date_of_birth', 'citizenship_country', 'residency_country',
    'current_education_summary', 'academic_summary', 'language_summary',
    'budget_band', 'decision_participant_labels', 'consent_status',
    'consent_evidence_ref', 'next_step'
  ]::platform.student_profile_field[];
BEGIN
  IF p_organization_id IS NULL OR p_source_registry_id IS NULL
    OR p_version IS NULL OR p_version <= 0
    OR pg_catalog.char_length(normalized_degree) NOT BETWEEN 1 AND 160
    OR pg_catalog.char_length(normalized_program) NOT BETWEEN 1 AND 200
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete China overlay route/source/version is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT authority.* INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id) AS authority;
  PERFORM platform_private.lock_bw8_request(p_request_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'evo:bw8:china-overlay:' || p_organization_id::TEXT || ':'
      || normalized_degree || ':' || normalized_program, 0
  ));

  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'target_country', 'China',
    'target_degree', normalized_degree,
    'program_direction', normalized_program,
    'version', p_version,
    'source_registry_id', p_source_registry_id
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'country.requirement.china_overlay.create',
    'country_requirement_version', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  SELECT source.* INTO source_row
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND source.id = p_source_registry_id
  FOR KEY SHARE;
  IF NOT FOUND
    OR source_row.source_kind <> 'google_drive_file'
    OR source_row.source_url <>
      'https://drive.google.com/file/d/1EKZOzQKli3Ub2tVxsX1qlpRj21kAJ6C9/view'
    OR source_row.source_revision IS NULL
    OR source_row.review_status <> 'reviewed'
    OR source_row.reviewer_role <> 'admin'
    OR source_row.reviewed_by_membership_id IS NULL
    OR source_row.reviewed_at IS NULL
  THEN
    RAISE EXCEPTION 'Exact reviewed source/version is required for the China overlay'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO platform.country_requirement_versions (
    id, organization_id, target_country, target_degree, program_direction,
    version, status, required_profile_fields, created_by_membership_id
  ) VALUES (
    created_version_id, p_organization_id, 'China', normalized_degree,
    normalized_program, p_version, 'draft', required_fields,
    actor.actor_membership_id
  );
  INSERT INTO platform.country_requirement_version_sources (
    organization_id, country_requirement_version_id, source_registry_id,
    created_by_membership_id
  ) VALUES (
    p_organization_id, created_version_id, p_source_registry_id,
    actor.actor_membership_id
  );

  INSERT INTO platform.document_requirements (
    organization_id, target_country, target_degree, program_direction,
    checklist_version, requirement_key, label, instructions, status,
    created_by_membership_id, country_requirement_version_id,
    applicability_rule, evidence_only, source_item_order
  ) VALUES
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'passport', 'Passport', 'Provide the applicant passport.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 1),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'china_visa_photos', 'China visa photos', 'Provide China visa photos.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 2),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'medical_certificate', 'Medical certificate', 'Provide a medical certificate.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 3),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'education_certificate_or_grade_report',
      'Diploma/certificate or current grade report',
      'Provide a diploma, certificate, or current grade report.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 4),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'current_study_certificate', 'Current-study certificate',
      'Provide a current-study certificate.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 5),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'criminal_record_certificate', 'Criminal record certificate',
      'Provide a criminal record certificate.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 6),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'teacher_recommendations_en', 'Two teacher recommendations in English',
      'Provide two teacher recommendations in English.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 7),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'motivation_letter_study_plan_en',
      'Motivation letter/study plan in English',
      'Provide a motivation letter or study plan in English.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 8),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'video_resume', 'Video resume',
      'Checklist/evidence only; BW8 does not accept video bytes.', 'active',
      actor.actor_membership_id, created_version_id, 'always', TRUE, 9),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'bank_balance_certificate', 'Bank balance certificate',
      'Provide a bank balance certificate.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 10),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'minor_parental_travel_consent',
      'Notarized parental travel consent if the applicant is a minor',
      'Required only when the applicant is under 18 on the case reference date.', 'active',
      actor.actor_membership_id, created_version_id, 'minor_only', FALSE, 11),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'minor_original_birth_certificate',
      'Original birth certificate if the applicant is a minor',
      'Required only when the applicant is under 18 on the case reference date.', 'active',
      actor.actor_membership_id, created_version_id, 'minor_only', FALSE, 12),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'application_form_after_contract_payment',
      'Application Form after contract/payment',
      'Required after contract confirmation/payment.', 'active',
      actor.actor_membership_id, created_version_id, 'after_contract_payment', FALSE, 13),
    (p_organization_id, 'China', normalized_degree, normalized_program, p_version,
      'both_parents_passports', 'Both parents'' passports',
      'Provide both parents'' passports.', 'active',
      actor.actor_membership_id, created_version_id, 'always', FALSE, 14);

  UPDATE platform.country_requirement_versions
  SET status = 'approved', approved_by_membership_id = actor.actor_membership_id,
      approved_at = statement_timestamp()
  WHERE organization_id = p_organization_id AND id = created_version_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'country_requirement_version_id', created_version_id,
    'target_country', 'China',
    'target_degree', normalized_degree,
    'program_direction', normalized_program,
    'version', p_version,
    'source_registry_id', p_source_registry_id,
    'source_revision', source_row.source_revision,
    'source_reviewed_by_membership_id', source_row.reviewed_by_membership_id,
    'requirement_count', 14,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.china_overlay.create', 'country_requirement_version',
    created_version_id, NULL, result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.apply_china_student_document_overlay(
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
  profile platform.student_profiles%ROWTYPE;
  typed_dob JSONB;
  applicant_dob DATE;
  normalized_reason TEXT := pg_catalog.btrim(p_reason);
  input_sha256 TEXT;
  replayed JSONB;
  slot_count INTEGER;
  minor_status platform.document_slot_applicability_status;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_student_case_id IS NULL
    OR p_country_requirement_version_id IS NULL
    OR pg_catalog.char_length(normalized_reason) NOT BETWEEN 1 AND 1000
    OR normalized_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete China overlay binding is required'
      USING ERRCODE = '22023';
  END IF;
  SELECT authority.* INTO actor
  FROM platform_private.require_bw3_admin_actor(p_organization_id) AS authority;
  PERFORM platform_private.lock_bw8_request(p_request_id);
  input_sha256 := platform_private.bw1_input_sha256(jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'country_requirement_version_id', p_country_requirement_version_id
  ));
  replayed := platform_private.bw3_replay_jsonb(
    p_request_id, 'country.requirement.china_overlay.apply',
    'student_case', normalized_reason, input_sha256
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  PERFORM 1 FROM platform.organizations AS organization
  WHERE organization.id = p_organization_id FOR KEY SHARE;
  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id FOR UPDATE;
  SELECT version.* INTO target_version
  FROM platform.country_requirement_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.id = p_country_requirement_version_id FOR KEY SHARE;
  IF target_case.id IS NULL OR target_version.id IS NULL
    OR target_case.applied_country_requirement_version_id IS NOT NULL
    OR target_version.status <> 'approved'
    OR target_version.target_country <> 'China'
    OR target_case.target_country <> target_version.target_country
    OR target_case.target_degree <> target_version.target_degree
    OR target_case.program_direction IS DISTINCT FROM target_version.program_direction
    OR (SELECT count(*) FROM platform.document_requirements AS requirement
        WHERE requirement.organization_id = p_organization_id
          AND requirement.country_requirement_version_id = target_version.id) <> 14
    OR (SELECT array_agg(requirement.source_item_order ORDER BY requirement.source_item_order)
        FROM platform.document_requirements AS requirement
        WHERE requirement.organization_id = p_organization_id
          AND requirement.country_requirement_version_id = target_version.id)
       <> ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14]::SMALLINT[]
    OR NOT EXISTS (
      SELECT 1 FROM platform.country_requirement_version_sources AS link
      JOIN platform.source_registry AS source
        ON source.organization_id = link.organization_id
        AND source.id = link.source_registry_id
      WHERE link.organization_id = p_organization_id
        AND link.country_requirement_version_id = target_version.id
        AND source.review_status = 'reviewed'
        AND source.source_revision IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'Exact approved source-backed China overlay does not match case'
      USING ERRCODE = '55000';
  END IF;

  SELECT candidate.* INTO profile
  FROM platform.student_profiles AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.student_case_id = p_student_case_id;
  SELECT value.field_value INTO typed_dob
  FROM platform.student_profile_field_values AS value
  WHERE value.organization_id = p_organization_id
    AND value.student_case_id = p_student_case_id
    AND value.field_key = 'personal.date_of_birth';
  applicant_dob := COALESCE(
    CASE WHEN typed_dob IS NULL THEN NULL ELSE (typed_dob #>> '{}')::DATE END,
    profile.date_of_birth
  );
  minor_status := platform_private.resolve_document_applicability(
    'minor_only', applicant_dob, target_case.contract_confirmed_at::DATE
  );

  INSERT INTO platform.document_slots (
    organization_id, student_case_id, requirement_id, status,
    created_by_membership_id, applicability_status,
    applicability_reference_date
  )
  SELECT
    p_organization_id, p_student_case_id, requirement.id, 'required',
    actor.actor_membership_id,
    platform_private.resolve_document_applicability(
      requirement.applicability_rule, applicant_dob,
      target_case.contract_confirmed_at::DATE
    ),
    CASE WHEN requirement.applicability_rule = 'minor_only'
      THEN target_case.contract_confirmed_at::DATE ELSE NULL END
  FROM platform.document_requirements AS requirement
  WHERE requirement.organization_id = p_organization_id
    AND requirement.country_requirement_version_id = target_version.id
  ORDER BY requirement.source_item_order;
  GET DIAGNOSTICS slot_count = ROW_COUNT;
  IF slot_count <> 14 THEN RAISE EXCEPTION 'China overlay must create exactly 14 slots' USING ERRCODE = '55000'; END IF;

  UPDATE platform.student_cases
  SET applied_country_requirement_version_id = target_version.id
  WHERE organization_id = p_organization_id AND id = p_student_case_id
    AND applied_country_requirement_version_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Country requirement binding changed concurrently' USING ERRCODE = '40001'; END IF;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'country_requirement_version_id', target_version.id,
    'version', target_version.version,
    'document_slot_count', slot_count,
    'minor_only_applicability', minor_status,
    'applicability_reference_date', target_case.contract_confirmed_at::DATE,
    'video_resume_evidence_only', TRUE,
    'input_sha256', input_sha256
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT,
    'country.requirement.china_overlay.apply', 'student_case', p_student_case_id,
    jsonb_build_object('applied_country_requirement_version_id', NULL),
    result, normalized_reason, p_request_id
  );
  RETURN result;
END
$$;






[context-firewall]
span: cfw://span/019fcf9057dc7211a39f58e5859a3adb
raw: 9601 bytes, estimated 2401 tokens
returned: 2502 bytes, estimated 626 tokens
delivery_status: advisory_wrapper
full output stored locally
commands:
  cfw show 019fcf9057dc7211a39f58e5859a3adb
  cfw show 019fcf9057dc7211a39f58e5859a3adb --lines 120:180
[/context-firewall]
