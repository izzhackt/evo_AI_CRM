-- ============================================================
-- 084_platform_canonical_client_lead.sql
--
-- U2: canonical EVO client/person and lead authority.
--
-- Provider identifiers remain provenance only. They never select or mutate
-- the canonical EVO owner or stage. Provider import/reconciliation is outside
-- this migration.
-- ============================================================

BEGIN;

CREATE TYPE platform.client_lifecycle_state AS ENUM (
  'active',
  'inactive',
  'merged'
);

CREATE TYPE platform.lead_lifecycle_state AS ENUM (
  'open',
  'converted',
  'disqualified',
  'archived'
);

CREATE OR REPLACE FUNCTION platform_private.normalize_person_name(
  p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
SET search_path = ''
AS $$
  SELECT lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(p_value),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.normalize_person_email(
  p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
SET search_path = ''
AS $$
  SELECT lower(pg_catalog.btrim(p_value))
$$;

CREATE OR REPLACE FUNCTION platform_private.normalize_person_phone(
  p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
SET search_path = ''
AS $$
  SELECT
    CASE
      WHEN pg_catalog.btrim(p_value) LIKE '+%' THEN '+'
      ELSE ''
    END
    || pg_catalog.regexp_replace(p_value, '[^0-9]', '', 'g')
$$;

CREATE TABLE platform.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
  normalized_name TEXT NOT NULL,
  email TEXT,
  normalized_email TEXT,
  phone TEXT,
  normalized_phone TEXT,
  lifecycle_state platform.client_lifecycle_state NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT clients_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT clients_normalized_name_check CHECK (
    normalized_name = platform_private.normalize_person_name(display_name)
    AND normalized_name <> ''
  ),
  CONSTRAINT clients_email_shape_check CHECK (
    (
      email IS NULL
      AND normalized_email IS NULL
    )
    OR (
      email IS NOT NULL
      AND normalized_email =
        platform_private.normalize_person_email(email)
      AND normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  CONSTRAINT clients_phone_shape_check CHECK (
    (
      phone IS NULL
      AND normalized_phone IS NULL
    )
    OR (
      phone IS NOT NULL
      AND normalized_phone =
        platform_private.normalize_person_phone(phone)
      AND normalized_phone ~ '^\+?[0-9]{7,15}$'
    )
  )
);

CREATE UNIQUE INDEX clients_active_strong_identity_key
  ON platform.clients (
    organization_id,
    normalized_email,
    normalized_phone
  )
  WHERE lifecycle_state = 'active'
    AND normalized_email IS NOT NULL
    AND normalized_phone IS NOT NULL;

CREATE INDEX clients_updated_page_idx
  ON platform.clients (organization_id, updated_at DESC, id DESC);
CREATE INDEX clients_normalized_name_idx
  ON platform.clients (organization_id, normalized_name, id);
CREATE INDEX clients_normalized_email_idx
  ON platform.clients (organization_id, normalized_email, id)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX clients_normalized_phone_idx
  ON platform.clients (organization_id, normalized_phone, id)
  WHERE normalized_phone IS NOT NULL;

CREATE TABLE platform.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  client_id UUID,
  current_owner_membership_id UUID,
  stage_key TEXT NOT NULL CHECK (
    stage_key = lower(btrim(stage_key))
    AND stage_key ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  source_key TEXT NOT NULL CHECK (
    source_key = lower(btrim(source_key))
    AND source_key ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  lifecycle_state platform.lead_lifecycle_state NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT leads_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT leads_organization_client_id_id_key
    UNIQUE (organization_id, client_id, id),
  CONSTRAINT leads_client_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT leads_owner_membership_fkey
    FOREIGN KEY (organization_id, current_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX leads_updated_page_idx
  ON platform.leads (organization_id, updated_at DESC, id DESC);
CREATE INDEX leads_client_idx
  ON platform.leads (organization_id, client_id, updated_at DESC, id DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX leads_owner_page_idx
  ON platform.leads (
    organization_id,
    current_owner_membership_id,
    updated_at DESC,
    id DESC
  )
  WHERE current_owner_membership_id IS NOT NULL;
CREATE INDEX leads_stage_lifecycle_page_idx
  ON platform.leads (
    organization_id,
    stage_key,
    lifecycle_state,
    updated_at DESC,
    id DESC
  );

ALTER TABLE platform.organization_memberships
  ADD CONSTRAINT organization_memberships_organization_id_id_profile_id_key
  UNIQUE (organization_id, id, profile_id);

CREATE TABLE platform.external_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL CHECK (
    source_system = lower(btrim(source_system))
    AND source_system ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  external_object_type TEXT NOT NULL CHECK (
    external_object_type = lower(btrim(external_object_type))
    AND external_object_type ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  external_identifier TEXT NOT NULL CHECK (
    external_identifier = btrim(external_identifier)
    AND external_identifier <> ''
    AND length(external_identifier) <= 512
  ),
  client_id UUID,
  lead_id UUID,
  observed_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ,
  source_ref TEXT CHECK (
    source_ref IS NULL
    OR (btrim(source_ref) <> '' AND length(source_ref) <= 1024)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT external_identifiers_one_subject_check CHECK (
    (client_id IS NOT NULL)::INTEGER
      + (lead_id IS NOT NULL)::INTEGER = 1
  ),
  CONSTRAINT external_identifiers_observation_check CHECK (
    imported_at IS NULL OR imported_at >= observed_at
  ),
  CONSTRAINT external_identifiers_provider_key UNIQUE (
    organization_id,
    source_system,
    external_object_type,
    external_identifier
  ),
  CONSTRAINT external_identifiers_client_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT external_identifiers_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX external_identifiers_client_idx
  ON platform.external_identifiers (
    organization_id,
    client_id,
    observed_at DESC,
    id DESC
  )
  WHERE client_id IS NOT NULL;
CREATE INDEX external_identifiers_lead_idx
  ON platform.external_identifiers (
    organization_id,
    lead_id,
    observed_at DESC,
    id DESC
  )
  WHERE lead_id IS NOT NULL;

CREATE TABLE platform.subject_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  client_id UUID,
  lead_id UUID,
  source_system TEXT NOT NULL CHECK (
    source_system = lower(btrim(source_system))
    AND source_system ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  evidence_type TEXT NOT NULL CHECK (
    evidence_type = lower(btrim(evidence_type))
    AND evidence_type ~ '^[a-z][a-z0-9_.-]{0,63}$'
  ),
  observed_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ,
  source_ref TEXT CHECK (
    source_ref IS NULL
    OR (btrim(source_ref) <> '' AND length(source_ref) <= 1024)
  ),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT subject_provenance_one_subject_check CHECK (
    (client_id IS NOT NULL)::INTEGER
      + (lead_id IS NOT NULL)::INTEGER = 1
  ),
  CONSTRAINT subject_provenance_observation_check CHECK (
    imported_at IS NULL OR imported_at >= observed_at
  ),
  CONSTRAINT subject_provenance_client_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT subject_provenance_lead_fkey
    FOREIGN KEY (organization_id, lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX subject_provenance_client_idx
  ON platform.subject_provenance (
    organization_id,
    client_id,
    observed_at DESC,
    id DESC
  )
  WHERE client_id IS NOT NULL;
CREATE INDEX subject_provenance_lead_idx
  ON platform.subject_provenance (
    organization_id,
    lead_id,
    observed_at DESC,
    id DESC
  )
  WHERE lead_id IS NOT NULL;

CREATE TABLE platform_private.client_duplicate_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  left_client_id UUID NOT NULL,
  right_client_id UUID NOT NULL,
  match_basis TEXT NOT NULL CHECK (
    match_basis IN ('name', 'email', 'phone', 'multiple_weak')
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'resolved', 'stale')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT client_duplicate_candidates_pair_order_check CHECK (
    left_client_id < right_client_id
  ),
  CONSTRAINT client_duplicate_candidates_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT client_duplicate_candidates_status_shape_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT client_duplicate_candidates_left_fkey
    FOREIGN KEY (organization_id, left_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_duplicate_candidates_right_fkey
    FOREIGN KEY (organization_id, right_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_duplicate_candidates_pair_key UNIQUE (
    organization_id,
    left_client_id,
    right_client_id
  )
);

CREATE INDEX client_duplicate_candidates_open_client_idx
  ON platform_private.client_duplicate_candidates (
    organization_id,
    left_client_id,
    right_client_id,
    created_at DESC
  )
  WHERE status = 'open';

CREATE TABLE platform_private.client_duplicate_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  survivor_client_id UUID NOT NULL,
  superseded_client_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (
    btrim(reason) <> '' AND length(reason) <= 2000
  ),
  request_id UUID NOT NULL UNIQUE,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT client_duplicate_resolutions_distinct_check CHECK (
    survivor_client_id <> superseded_client_id
  ),
  CONSTRAINT client_duplicate_resolutions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT client_duplicate_resolutions_candidate_key UNIQUE (
    organization_id,
    candidate_id
  ),
  CONSTRAINT client_duplicate_resolutions_candidate_fkey
    FOREIGN KEY (organization_id, candidate_id)
    REFERENCES platform_private.client_duplicate_candidates(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT client_duplicate_resolutions_survivor_fkey
    FOREIGN KEY (organization_id, survivor_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_duplicate_resolutions_superseded_fkey
    FOREIGN KEY (organization_id, superseded_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_duplicate_resolutions_actor_membership_fkey
    FOREIGN KEY (
      organization_id,
      actor_membership_id,
      actor_profile_id
    )
    REFERENCES platform.organization_memberships(
      organization_id,
      id,
      profile_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX client_duplicate_resolutions_actor_idx
  ON platform_private.client_duplicate_resolutions (
    organization_id,
    actor_profile_id,
    resolved_at DESC
  );

CREATE TABLE platform_private.client_aliases (
  superseded_client_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  canonical_client_id UUID NOT NULL,
  resolution_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT client_aliases_non_self_check CHECK (
    superseded_client_id <> canonical_client_id
  ),
  CONSTRAINT client_aliases_superseded_fkey
    FOREIGN KEY (organization_id, superseded_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_aliases_canonical_fkey
    FOREIGN KEY (organization_id, canonical_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT client_aliases_resolution_fkey
    FOREIGN KEY (organization_id, resolution_id)
    REFERENCES platform_private.client_duplicate_resolutions(
      organization_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX client_aliases_canonical_idx
  ON platform_private.client_aliases (
    organization_id,
    canonical_client_id,
    superseded_client_id
  );

ALTER TABLE platform.student_cases
  ADD COLUMN canonical_client_id UUID,
  ADD COLUMN canonical_lead_id UUID,
  ADD CONSTRAINT student_cases_canonical_client_fkey
    FOREIGN KEY (organization_id, canonical_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT student_cases_canonical_lead_fkey
    FOREIGN KEY (organization_id, canonical_lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT;

CREATE INDEX student_cases_canonical_client_idx
  ON platform.student_cases (
    organization_id,
    canonical_client_id,
    updated_at DESC,
    id DESC
  )
  WHERE canonical_client_id IS NOT NULL;
CREATE INDEX student_cases_canonical_lead_idx
  ON platform.student_cases (
    organization_id,
    canonical_lead_id,
    updated_at DESC,
    id DESC
  )
  WHERE canonical_lead_id IS NOT NULL;

ALTER TABLE platform.communication_conversations
  ADD COLUMN canonical_client_id UUID,
  ADD COLUMN canonical_lead_id UUID,
  ADD CONSTRAINT communication_conversations_canonical_client_fkey
    FOREIGN KEY (organization_id, canonical_client_id)
    REFERENCES platform.clients(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT communication_conversations_canonical_lead_fkey
    FOREIGN KEY (organization_id, canonical_lead_id)
    REFERENCES platform.leads(organization_id, id)
    ON DELETE RESTRICT;

CREATE INDEX communication_conversations_canonical_client_idx
  ON platform.communication_conversations (
    organization_id,
    canonical_client_id,
    updated_at DESC,
    id DESC
  )
  WHERE canonical_client_id IS NOT NULL;
CREATE INDEX communication_conversations_canonical_lead_idx
  ON platform.communication_conversations (
    organization_id,
    canonical_lead_id,
    updated_at DESC,
    id DESC
  )
  WHERE canonical_lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION platform_private.guard_p2f_parent_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'communication_conversations' THEN
    IF OLD.student_case_id IS NOT NULL
      AND NEW.student_case_id IS DISTINCT FROM OLD.student_case_id
    THEN
      RAISE EXCEPTION
        'A linked conversation cannot be moved to another case'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.queue = 'curator'
      AND NEW.queue IS DISTINCT FROM OLD.queue
    THEN
      RAISE EXCEPTION
        'A Curator conversation cannot return to the Sales queue'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'closed'
      AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      RAISE EXCEPTION
        'A closed communication conversation cannot be reopened'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.student_case_id IS NOT DISTINCT FROM OLD.student_case_id
      AND NEW.queue IS NOT DISTINCT FROM OLD.queue
      AND NEW.current_curator_membership_id IS NOT DISTINCT FROM
        OLD.current_curator_membership_id
      AND NEW.current_scope_id IS NOT DISTINCT FROM OLD.current_scope_id
      AND NEW.current_scope_version IS NOT DISTINCT FROM
        OLD.current_scope_version
      AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.canonical_client_id IS NOT DISTINCT FROM OLD.canonical_client_id
      AND NEW.canonical_lead_id IS NOT DISTINCT FROM OLD.canonical_lead_id
    THEN
      RAISE EXCEPTION
        'Conversation update requires a reviewed link, handoff, close or canonical link change'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'approved_knowledge_versions' THEN
    IF OLD.status <> 'approved' OR NEW.status <> 'retired' THEN
      RAISE EXCEPTION
        'Approved knowledge may transition only to retired'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_drafts' THEN
    IF (
      OLD.selected_language IS NOT NULL
      AND NEW.selected_language IS DISTINCT FROM OLD.selected_language
    )
      OR (
        OLD.knowledge_version_id IS NOT NULL
        AND NEW.knowledge_version_id IS DISTINCT FROM
          OLD.knowledge_version_id
      )
      OR (
        OLD.provider_ref IS NOT NULL
        AND NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
      )
      OR (
        OLD.model_ref IS NOT NULL
        AND NEW.model_ref IS DISTINCT FROM OLD.model_ref
      )
      OR (
        OLD.prompt_policy_version IS NOT NULL
        AND NEW.prompt_policy_version IS DISTINCT FROM
          OLD.prompt_policy_version
      )
      OR (
        OLD.source_context IS DISTINCT FROM NEW.source_context
      )
      OR (
        OLD.source_context_sha256 IS DISTINCT FROM
          NEW.source_context_sha256
      )
      OR (
        OLD.generated_text IS NOT NULL
        AND NEW.generated_text IS DISTINCT FROM OLD.generated_text
      )
      OR (
        OLD.generated_text_sha256 IS NOT NULL
        AND NEW.generated_text_sha256 IS DISTINCT FROM
          OLD.generated_text_sha256
      )
    THEN
      RAISE EXCEPTION
        'Original AI generation evidence is immutable once recorded'
        USING ERRCODE = '55000';
    END IF;

    IF NOT (
      (
        OLD.state = 'awaiting_language_selection'
        AND NEW.state IN ('language_selected', 'handed_off')
      )
      OR (
        OLD.state = 'language_selected'
        AND NEW.state IN ('review_required', 'handed_off')
      )
      OR (
        OLD.state = 'review_required'
        AND NEW.state IN (
          'rework_requested',
          'ready_for_manual_send',
          'handed_off'
        )
      )
      OR (
        OLD.state = 'ready_for_manual_send'
        AND NEW.state IN ('manual_send_authorized', 'handed_off')
      )
    ) THEN
      RAISE EXCEPTION
        'AI draft transition is not allowed'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION
      'Unexpected P2F guarded table %',
      TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

ALTER TABLE platform.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.leads FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.external_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.external_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.subject_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.subject_provenance FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_duplicate_candidates
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_duplicate_candidates
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_duplicate_resolutions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_duplicate_resolutions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.client_aliases FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.guard_client_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Canonical clients cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Canonical client identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.lifecycle_state = 'merged'
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'A merged canonical client is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.lifecycle_state = 'merged'
    AND OLD.lifecycle_state <> 'merged'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.client_aliases AS alias
      WHERE alias.organization_id = NEW.organization_id
        AND alias.superseded_client_id = NEW.id
    )
  THEN
    RAISE EXCEPTION 'A merged client requires an auditable alias'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_lead_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Canonical leads cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.source_key IS DISTINCT FROM OLD.source_key
  THEN
    RAISE EXCEPTION 'Canonical lead identity and source are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.lifecycle_state = 'archived'
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'An archived canonical lead is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.lifecycle_state = 'converted'
    AND NEW.lifecycle_state NOT IN ('converted', 'archived')
  THEN
    RAISE EXCEPTION 'A converted lead can only remain converted or archive'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.lifecycle_state = 'disqualified'
    AND NEW.lifecycle_state NOT IN ('open', 'disqualified', 'archived')
  THEN
    RAISE EXCEPTION 'Invalid disqualified lead lifecycle transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_duplicate_candidate_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Duplicate candidates cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.left_client_id IS DISTINCT FROM OLD.left_client_id
    OR NEW.right_client_id IS DISTINCT FROM OLD.right_client_id
    OR NEW.match_basis IS DISTINCT FROM OLD.match_basis
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.status <> 'open'
    OR NEW.status NOT IN ('resolved', 'stale')
    OR NEW.resolved_at IS NULL
  THEN
    RAISE EXCEPTION 'Invalid duplicate candidate transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.enforce_canonical_module_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  bound_client_id UUID;
BEGIN
  IF NEW.canonical_client_id IS NULL OR NEW.canonical_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lead.client_id
  INTO bound_client_id
  FROM platform.leads AS lead
  WHERE lead.organization_id = NEW.organization_id
    AND lead.id = NEW.canonical_lead_id;

  IF NOT FOUND OR bound_client_id IS DISTINCT FROM NEW.canonical_client_id THEN
    RAISE EXCEPTION
      'Canonical module client and lead bindings disagree'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER clients_validate_mutation
  BEFORE UPDATE OR DELETE ON platform.clients
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_client_mutation();
CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON platform.clients
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER clients_no_truncate
  BEFORE TRUNCATE ON platform.clients
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER leads_validate_mutation
  BEFORE UPDATE OR DELETE ON platform.leads
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_lead_mutation();
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON platform.leads
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.set_updated_at();
CREATE TRIGGER leads_no_truncate
  BEFORE TRUNCATE ON platform.leads
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER external_identifiers_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.external_identifiers
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER external_identifiers_no_truncate
  BEFORE TRUNCATE ON platform.external_identifiers
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER subject_provenance_append_only_rows
  BEFORE UPDATE OR DELETE ON platform.subject_provenance
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER subject_provenance_no_truncate
  BEFORE TRUNCATE ON platform.subject_provenance
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER client_duplicate_candidates_guard_mutation
  BEFORE UPDATE OR DELETE
  ON platform_private.client_duplicate_candidates
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_duplicate_candidate_mutation();
CREATE TRIGGER client_duplicate_candidates_no_truncate
  BEFORE TRUNCATE ON platform_private.client_duplicate_candidates
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER client_duplicate_resolutions_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.client_duplicate_resolutions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER client_duplicate_resolutions_no_truncate
  BEFORE TRUNCATE ON platform_private.client_duplicate_resolutions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER client_aliases_append_only_rows
  BEFORE UPDATE OR DELETE ON platform_private.client_aliases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER client_aliases_no_truncate
  BEFORE TRUNCATE ON platform_private.client_aliases
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER student_cases_canonical_binding_guard
  BEFORE INSERT OR UPDATE OF canonical_client_id, canonical_lead_id
  ON platform.student_cases
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.enforce_canonical_module_binding();

CREATE TRIGGER communication_conversations_canonical_binding_guard
  BEFORE INSERT OR UPDATE OF canonical_client_id, canonical_lead_id
  ON platform.communication_conversations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.enforce_canonical_module_binding();

REVOKE ALL ON FUNCTION
  platform_private.normalize_person_name(TEXT),
  platform_private.normalize_person_email(TEXT),
  platform_private.normalize_person_phone(TEXT),
  platform_private.guard_client_mutation(),
  platform_private.guard_lead_mutation(),
  platform_private.guard_duplicate_candidate_mutation(),
  platform_private.enforce_canonical_module_binding()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Immutable v12 bundles clone v11 and add only U2 permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('client.read', 'Read canonical clients within live staff object scope'),
  ('lead.read', 'Read canonical leads within live staff object scope'),
  (
    'client.duplicate.resolve',
    'Resolve an ambiguous canonical-client duplicate as an active Admin'
  );

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  (
    '00000000-0000-4000-8000-000000001101',
    'admin', 12, 'draft', 'Admin v12 canonical client and lead'
  ),
  (
    '00000000-0000-4000-8000-000000001102',
    'sales', 12, 'draft', 'Sales v12 owned canonical leads'
  ),
  (
    '00000000-0000-4000-8000-000000001103',
    'curator', 12, 'draft', 'Curator v12 assigned canonical clients'
  ),
  (
    '00000000-0000-4000-8000-000000001104',
    'finance', 12, 'draft', 'Finance v12 unchanged'
  ),
  (
    '00000000-0000-4000-8000-000000001105',
    'student', 12, 'draft', 'Student v12 unchanged'
  );

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v12.id, v12.role, v11_permission.permission_key
FROM platform.role_bundle_versions AS v12
JOIN platform.role_bundle_versions AS v11
  ON v11.role = v12.role
  AND v11.version = 11
  AND v11.status = 'published'
JOIN platform.role_bundle_permissions AS v11_permission
  ON v11_permission.bundle_id = v11.id
  AND v11_permission.bundle_role = v11.role
WHERE v12.version = 12;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 12
  AND (
    (
      bundle.role IN ('admin', 'sales', 'curator')
      AND permission.permission_key IN ('client.read', 'lead.read')
    )
    OR (
      bundle.role = 'admin'
      AND permission.permission_key = 'client.duplicate.resolve'
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 12;

CREATE TEMPORARY TABLE u2_membership_bundle_upgrades
ON COMMIT DROP
AS
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
  'U2 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM u2_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM u2_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM u2_membership_bundle_upgrades AS upgrade
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
  'migration:084_platform_canonical_client_lead',
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
  'U2 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM u2_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.resolve_canonical_client_id(
  p_organization_id UUID,
  p_client_id UUID
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(alias.canonical_client_id, client.id)
  FROM platform.clients AS client
  LEFT JOIN platform_private.client_aliases AS alias
    ON alias.organization_id = client.organization_id
    AND alias.superseded_client_id = client.id
  WHERE client.organization_id = p_organization_id
    AND client.id = p_client_id
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_canonical_client(
  p_organization_id UUID,
  p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requested AS MATERIALIZED (
    SELECT platform_private.resolve_canonical_client_id(
      p_organization_id,
      p_client_id
    ) AS client_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM requested
    JOIN platform.clients AS client
      ON client.organization_id = p_organization_id
      AND client.id = requested.client_id
    CROSS JOIN platform.current_actor_authority() AS actor
    WHERE actor.organization_id = client.organization_id
      AND private.platform_has_permission(
        client.organization_id,
        'client.read'
      )
      AND (
        actor.platform_role = 'admin'
        OR (
          actor.platform_role = 'sales'
          AND EXISTS (
            SELECT 1
            FROM platform.leads AS lead
            WHERE lead.organization_id = client.organization_id
              AND lead.client_id = client.id
              AND lead.current_owner_membership_id = actor.membership_id
          )
        )
        OR (
          actor.platform_role = 'curator'
          AND EXISTS (
            SELECT 1
            FROM platform.student_cases AS student_case
            LEFT JOIN platform.leads AS linked_lead
              ON linked_lead.organization_id = student_case.organization_id
              AND linked_lead.id = student_case.canonical_lead_id
            WHERE student_case.organization_id = client.organization_id
              AND student_case.current_curator_membership_id =
                actor.membership_id
              AND (
                student_case.canonical_client_id = client.id
                OR linked_lead.client_id = client.id
              )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION private.platform_can_read_canonical_lead(
  p_organization_id UUID,
  p_lead_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    CROSS JOIN platform.current_actor_authority() AS actor
    WHERE lead.organization_id = p_organization_id
      AND lead.id = p_lead_id
      AND actor.organization_id = lead.organization_id
      AND private.platform_has_permission(
        lead.organization_id,
        'lead.read'
      )
      AND (
        actor.platform_role = 'admin'
        OR (
          actor.platform_role = 'sales'
          AND lead.current_owner_membership_id = actor.membership_id
        )
        OR (
          actor.platform_role = 'curator'
          AND EXISTS (
            SELECT 1
            FROM platform.student_cases AS student_case
            WHERE student_case.organization_id = lead.organization_id
              AND student_case.current_curator_membership_id =
                actor.membership_id
              AND student_case.canonical_lead_id = lead.id
          )
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.resolve_canonical_client_id(UUID, UUID),
  private.platform_can_read_canonical_client(UUID, UUID),
  private.platform_can_read_canonical_lead(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  private.platform_can_read_canonical_client(UUID, UUID),
  private.platform_can_read_canonical_lead(UUID, UUID)
TO authenticated;

CREATE POLICY clients_read
  ON platform.clients
  FOR SELECT
  TO authenticated
  USING (
    private.platform_can_read_canonical_client(organization_id, id)
  );

CREATE POLICY leads_read
  ON platform.leads
  FOR SELECT
  TO authenticated
  USING (
    private.platform_can_read_canonical_lead(organization_id, id)
  );

CREATE POLICY external_identifiers_read
  ON platform.external_identifiers
  FOR SELECT
  TO authenticated
  USING (
    (
      client_id IS NOT NULL
      AND private.platform_can_read_canonical_client(
        organization_id,
        client_id
      )
    )
    OR (
      lead_id IS NOT NULL
      AND private.platform_can_read_canonical_lead(organization_id, lead_id)
    )
  );

CREATE POLICY subject_provenance_read
  ON platform.subject_provenance
  FOR SELECT
  TO authenticated
  USING (
    (
      client_id IS NOT NULL
      AND private.platform_can_read_canonical_client(
        organization_id,
        client_id
      )
    )
    OR (
      lead_id IS NOT NULL
      AND private.platform_can_read_canonical_lead(organization_id, lead_id)
    )
  );

REVOKE ALL ON TABLE
  platform.clients,
  platform.leads,
  platform.external_identifiers,
  platform.subject_provenance
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT (
  id,
  organization_id,
  display_name,
  email,
  phone,
  lifecycle_state,
  created_at,
  updated_at
) ON platform.clients TO authenticated;

GRANT SELECT (
  id,
  organization_id,
  client_id,
  current_owner_membership_id,
  stage_key,
  source_key,
  lifecycle_state,
  created_at,
  updated_at
) ON platform.leads TO authenticated;

GRANT SELECT ON TABLE
  platform.external_identifiers,
  platform.subject_provenance
TO authenticated;

REVOKE ALL ON TABLE
  platform_private.client_duplicate_candidates,
  platform_private.client_duplicate_resolutions,
  platform_private.client_aliases
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.lock_external_identity(
  p_organization_id UUID,
  p_source_system TEXT,
  p_external_object_type TEXT,
  p_external_identifier TEXT
)
RETURNS VOID
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::TEXT
        || E'\x1f' || p_source_system
        || E'\x1f' || p_external_object_type
        || E'\x1f' || p_external_identifier,
      0
    )
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.create_ambiguous_candidates(
  p_organization_id UUID,
  p_client_id UUID
)
RETURNS VOID
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH source_client AS MATERIALIZED (
    SELECT client.*
    FROM platform.clients AS client
    WHERE client.organization_id = p_organization_id
      AND client.id = p_client_id
      AND client.lifecycle_state = 'active'
  ),
  matches AS MATERIALIZED (
    SELECT
      existing.id,
      (
        (existing.normalized_name = source.normalized_name)::INTEGER
        + (
          source.normalized_email IS NOT NULL
          AND existing.normalized_email = source.normalized_email
        )::INTEGER
        + (
          source.normalized_phone IS NOT NULL
          AND existing.normalized_phone = source.normalized_phone
        )::INTEGER
      ) AS match_count,
      existing.normalized_name = source.normalized_name AS name_matches,
      source.normalized_email IS NOT NULL
        AND existing.normalized_email = source.normalized_email
        AS email_matches,
      source.normalized_phone IS NOT NULL
        AND existing.normalized_phone = source.normalized_phone
        AS phone_matches
    FROM source_client AS source
    JOIN platform.clients AS existing
      ON existing.organization_id = source.organization_id
      AND existing.id <> source.id
      AND existing.lifecycle_state = 'active'
      AND (
        existing.normalized_name = source.normalized_name
        OR (
          source.normalized_email IS NOT NULL
          AND existing.normalized_email = source.normalized_email
        )
        OR (
          source.normalized_phone IS NOT NULL
          AND existing.normalized_phone = source.normalized_phone
        )
      )
  )
  INSERT INTO platform_private.client_duplicate_candidates (
    organization_id,
    left_client_id,
    right_client_id,
    match_basis
  )
  SELECT
    p_organization_id,
    LEAST(p_client_id, matches.id),
    GREATEST(p_client_id, matches.id),
    CASE
      WHEN matches.match_count > 1 THEN 'multiple_weak'
      WHEN matches.email_matches THEN 'email'
      WHEN matches.phone_matches THEN 'phone'
      ELSE 'name'
    END
  FROM matches
  ON CONFLICT (
    organization_id,
    left_client_id,
    right_client_id
  ) DO NOTHING
$$;

REVOKE ALL ON FUNCTION
  platform_private.lock_external_identity(UUID, TEXT, TEXT, TEXT),
  platform_private.create_ambiguous_candidates(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform_private.create_or_link_client(
  p_organization_id UUID,
  p_display_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_source_system TEXT,
  p_external_object_type TEXT,
  p_external_identifier TEXT,
  p_evidence_type TEXT,
  p_observed_at TIMESTAMPTZ,
  p_imported_at TIMESTAMPTZ DEFAULT NULL,
  p_source_ref TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  input_normalized_name TEXT;
  input_normalized_email TEXT;
  input_normalized_phone TEXT;
  normalized_source_system TEXT;
  normalized_object_type TEXT;
  normalized_external_identifier TEXT;
  normalized_evidence_type TEXT;
  canonical_client_id UUID;
  inserted_client_id UUID;
  existing_external platform.external_identifiers%ROWTYPE;
  existing_client platform.clients%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR p_display_name IS NULL
    OR p_source_system IS NULL
    OR p_external_object_type IS NULL
    OR p_external_identifier IS NULL
    OR p_evidence_type IS NULL
    OR p_observed_at IS NULL
  THEN
    RAISE EXCEPTION 'Canonical client source fields are required'
      USING ERRCODE = '22023';
  END IF;

  input_normalized_name :=
    platform_private.normalize_person_name(p_display_name);
  input_normalized_email :=
    platform_private.normalize_person_email(p_email);
  input_normalized_phone :=
    platform_private.normalize_person_phone(p_phone);
  normalized_source_system := lower(btrim(p_source_system));
  normalized_object_type := lower(btrim(p_external_object_type));
  normalized_external_identifier := btrim(p_external_identifier);
  normalized_evidence_type := lower(btrim(p_evidence_type));

  IF input_normalized_name IS NULL OR input_normalized_name = ''
    OR normalized_source_system !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_object_type !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_external_identifier = ''
    OR length(normalized_external_identifier) > 512
    OR normalized_evidence_type !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR (
      p_email IS NOT NULL
      AND (
        input_normalized_email IS NULL
        OR input_normalized_email !~
          '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    )
    OR (
      p_phone IS NOT NULL
      AND (
        input_normalized_phone IS NULL
        OR input_normalized_phone !~ '^\+?[0-9]{7,15}$'
      )
    )
    OR (
      p_source_ref IS NOT NULL
      AND (btrim(p_source_ref) = '' OR length(p_source_ref) > 1024)
    )
    OR (p_imported_at IS NOT NULL AND p_imported_at < p_observed_at)
  THEN
    RAISE EXCEPTION 'Malformed canonical client identity or provenance'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Canonical client organization is not active'
      USING ERRCODE = '23503';
  END IF;

  PERFORM platform_private.lock_external_identity(
    p_organization_id,
    normalized_source_system,
    normalized_object_type,
    normalized_external_identifier
  );

  SELECT external.*
  INTO existing_external
  FROM platform.external_identifiers AS external
  WHERE external.organization_id = p_organization_id
    AND external.source_system = normalized_source_system
    AND external.external_object_type = normalized_object_type
    AND external.external_identifier = normalized_external_identifier
  FOR UPDATE;

  IF FOUND THEN
    IF existing_external.client_id IS NULL THEN
      RAISE EXCEPTION 'External identity is already bound to a lead'
        USING ERRCODE = '23505';
    END IF;

    canonical_client_id := platform_private.resolve_canonical_client_id(
      p_organization_id,
      existing_external.client_id
    );

    SELECT client.*
    INTO STRICT existing_client
    FROM platform.clients AS client
    WHERE client.organization_id = p_organization_id
      AND client.id = canonical_client_id;

    IF input_normalized_email IS NOT NULL
      AND input_normalized_phone IS NOT NULL
      AND existing_client.normalized_email IS NOT NULL
      AND existing_client.normalized_phone IS NOT NULL
      AND (
        existing_client.normalized_email,
        existing_client.normalized_phone
      ) IS DISTINCT FROM (
        input_normalized_email,
        input_normalized_phone
      )
    THEN
      RAISE EXCEPTION
        'External client identity conflicts with canonical strong identity'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO platform.subject_provenance (
      organization_id,
      client_id,
      source_system,
      evidence_type,
      observed_at,
      imported_at,
      source_ref
    ) VALUES (
      p_organization_id,
      canonical_client_id,
      normalized_source_system,
      normalized_evidence_type,
      p_observed_at,
      p_imported_at,
      p_source_ref
    );

    RETURN canonical_client_id;
  END IF;

  IF input_normalized_email IS NOT NULL
    AND input_normalized_phone IS NOT NULL
  THEN
    INSERT INTO platform.clients (
      organization_id,
      display_name,
      normalized_name,
      email,
      normalized_email,
      phone,
      normalized_phone
    ) VALUES (
      p_organization_id,
      btrim(p_display_name),
      input_normalized_name,
      CASE WHEN p_email IS NULL THEN NULL ELSE btrim(p_email) END,
      input_normalized_email,
      CASE WHEN p_phone IS NULL THEN NULL ELSE btrim(p_phone) END,
      input_normalized_phone
    )
    ON CONFLICT (
      organization_id,
      normalized_email,
      normalized_phone
    ) WHERE lifecycle_state = 'active'
      AND normalized_email IS NOT NULL
      AND normalized_phone IS NOT NULL
    DO NOTHING
    RETURNING id INTO inserted_client_id;

    IF inserted_client_id IS NULL THEN
      SELECT client.id
      INTO STRICT canonical_client_id
      FROM platform.clients AS client
      WHERE client.organization_id = p_organization_id
        AND client.lifecycle_state = 'active'
        AND client.normalized_email = input_normalized_email
        AND client.normalized_phone = input_normalized_phone;
    ELSE
      canonical_client_id := inserted_client_id;
    END IF;
  ELSE
    INSERT INTO platform.clients (
      organization_id,
      display_name,
      normalized_name,
      email,
      normalized_email,
      phone,
      normalized_phone
    ) VALUES (
      p_organization_id,
      btrim(p_display_name),
      input_normalized_name,
      CASE WHEN p_email IS NULL THEN NULL ELSE btrim(p_email) END,
      input_normalized_email,
      CASE WHEN p_phone IS NULL THEN NULL ELSE btrim(p_phone) END,
      input_normalized_phone
    )
    RETURNING id INTO canonical_client_id;

    inserted_client_id := canonical_client_id;
  END IF;

  INSERT INTO platform.external_identifiers (
    organization_id,
    source_system,
    external_object_type,
    external_identifier,
    client_id,
    observed_at,
    imported_at,
    source_ref
  ) VALUES (
    p_organization_id,
    normalized_source_system,
    normalized_object_type,
    normalized_external_identifier,
    canonical_client_id,
    p_observed_at,
    p_imported_at,
    p_source_ref
  );

  INSERT INTO platform.subject_provenance (
    organization_id,
    client_id,
    source_system,
    evidence_type,
    observed_at,
    imported_at,
    source_ref
  ) VALUES (
    p_organization_id,
    canonical_client_id,
    normalized_source_system,
    normalized_evidence_type,
    p_observed_at,
    p_imported_at,
    p_source_ref
  );

  IF inserted_client_id IS NOT NULL THEN
    PERFORM platform_private.create_ambiguous_candidates(
      p_organization_id,
      canonical_client_id
    );
  END IF;

  RETURN canonical_client_id;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.create_or_link_lead(
  p_organization_id UUID,
  p_client_id UUID,
  p_current_owner_membership_id UUID,
  p_stage_key TEXT,
  p_source_key TEXT,
  p_source_system TEXT,
  p_external_object_type TEXT,
  p_external_identifier TEXT,
  p_evidence_type TEXT,
  p_observed_at TIMESTAMPTZ,
  p_imported_at TIMESTAMPTZ DEFAULT NULL,
  p_source_ref TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_stage_key TEXT;
  normalized_source_key TEXT;
  normalized_source_system TEXT;
  normalized_object_type TEXT;
  normalized_external_identifier TEXT;
  normalized_evidence_type TEXT;
  canonical_client_id UUID;
  canonical_lead_id UUID;
  existing_external platform.external_identifiers%ROWTYPE;
  existing_lead platform.leads%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR p_stage_key IS NULL
    OR p_source_key IS NULL
    OR p_source_system IS NULL
    OR p_external_object_type IS NULL
    OR p_external_identifier IS NULL
    OR p_evidence_type IS NULL
    OR p_observed_at IS NULL
  THEN
    RAISE EXCEPTION 'Canonical lead source fields are required'
      USING ERRCODE = '22023';
  END IF;

  normalized_stage_key := lower(btrim(p_stage_key));
  normalized_source_key := lower(btrim(p_source_key));
  normalized_source_system := lower(btrim(p_source_system));
  normalized_object_type := lower(btrim(p_external_object_type));
  normalized_external_identifier := btrim(p_external_identifier);
  normalized_evidence_type := lower(btrim(p_evidence_type));

  IF normalized_stage_key !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_source_key !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_source_system !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_object_type !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR normalized_external_identifier = ''
    OR length(normalized_external_identifier) > 512
    OR normalized_evidence_type !~ '^[a-z][a-z0-9_.-]{0,63}$'
    OR (
      p_source_ref IS NOT NULL
      AND (btrim(p_source_ref) = '' OR length(p_source_ref) > 1024)
    )
    OR (p_imported_at IS NOT NULL AND p_imported_at < p_observed_at)
  THEN
    RAISE EXCEPTION 'Malformed canonical lead identity or provenance'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Canonical lead organization is not active'
      USING ERRCODE = '23503';
  END IF;

  IF p_client_id IS NOT NULL THEN
    canonical_client_id := platform_private.resolve_canonical_client_id(
      p_organization_id,
      p_client_id
    );

    IF canonical_client_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM platform.clients AS client
      WHERE client.organization_id = p_organization_id
        AND client.id = canonical_client_id
        AND client.lifecycle_state = 'active'
    ) THEN
      RAISE EXCEPTION 'Canonical lead client is not active in organization'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_current_owner_membership_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS membership
      JOIN platform.profiles AS profile ON profile.id = membership.profile_id
      WHERE membership.organization_id = p_organization_id
        AND membership.id = p_current_owner_membership_id
        AND membership.status = 'active'
        AND membership."current_role" = 'sales'
        AND profile.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'Canonical lead owner must be an active Sales membership'
      USING ERRCODE = '23503';
  END IF;

  PERFORM platform_private.lock_external_identity(
    p_organization_id,
    normalized_source_system,
    normalized_object_type,
    normalized_external_identifier
  );

  SELECT external.*
  INTO existing_external
  FROM platform.external_identifiers AS external
  WHERE external.organization_id = p_organization_id
    AND external.source_system = normalized_source_system
    AND external.external_object_type = normalized_object_type
    AND external.external_identifier = normalized_external_identifier
  FOR UPDATE;

  IF FOUND THEN
    IF existing_external.lead_id IS NULL THEN
      RAISE EXCEPTION 'External identity is already bound to a client'
        USING ERRCODE = '23505';
    END IF;

    SELECT lead.*
    INTO STRICT existing_lead
    FROM platform.leads AS lead
    WHERE lead.organization_id = p_organization_id
      AND lead.id = existing_external.lead_id;

    IF (
        canonical_client_id IS NOT NULL
        AND existing_lead.client_id IS DISTINCT FROM canonical_client_id
      )
      OR (
        p_current_owner_membership_id IS NOT NULL
        AND existing_lead.current_owner_membership_id
          IS DISTINCT FROM p_current_owner_membership_id
      )
      OR existing_lead.stage_key <> normalized_stage_key
      OR existing_lead.source_key <> normalized_source_key
    THEN
      RAISE EXCEPTION
        'External lead identity conflicts with canonical client, owner or stage'
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO platform.subject_provenance (
      organization_id,
      lead_id,
      source_system,
      evidence_type,
      observed_at,
      imported_at,
      source_ref
    ) VALUES (
      p_organization_id,
      existing_lead.id,
      normalized_source_system,
      normalized_evidence_type,
      p_observed_at,
      p_imported_at,
      p_source_ref
    );

    RETURN existing_lead.id;
  END IF;

  INSERT INTO platform.leads (
    organization_id,
    client_id,
    current_owner_membership_id,
    stage_key,
    source_key
  ) VALUES (
    p_organization_id,
    canonical_client_id,
    p_current_owner_membership_id,
    normalized_stage_key,
    normalized_source_key
  )
  RETURNING id INTO canonical_lead_id;

  INSERT INTO platform.external_identifiers (
    organization_id,
    source_system,
    external_object_type,
    external_identifier,
    lead_id,
    observed_at,
    imported_at,
    source_ref
  ) VALUES (
    p_organization_id,
    normalized_source_system,
    normalized_object_type,
    normalized_external_identifier,
    canonical_lead_id,
    p_observed_at,
    p_imported_at,
    p_source_ref
  );

  INSERT INTO platform.subject_provenance (
    organization_id,
    lead_id,
    source_system,
    evidence_type,
    observed_at,
    imported_at,
    source_ref
  ) VALUES (
    p_organization_id,
    canonical_lead_id,
    normalized_source_system,
    normalized_evidence_type,
    p_observed_at,
    p_imported_at,
    p_source_ref
  );

  RETURN canonical_lead_id;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.create_or_link_client(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TIMESTAMPTZ, TIMESTAMPTZ, TEXT
  ),
  platform_private.create_or_link_lead(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
    TIMESTAMPTZ, TIMESTAMPTZ, TEXT
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.resolve_client_duplicate(
  p_candidate_id UUID,
  p_survivor_client_id UUID,
  p_superseded_client_id UUID,
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
  candidate platform_private.client_duplicate_candidates%ROWTYPE;
  existing_resolution platform_private.client_duplicate_resolutions%ROWTYPE;
  actor RECORD;
  resolution_id UUID;
  resolution_timestamp TIMESTAMPTZ;
BEGIN
  IF p_candidate_id IS NULL
    OR p_survivor_client_id IS NULL
    OR p_superseded_client_id IS NULL
    OR p_request_id IS NULL
    OR p_survivor_client_id = p_superseded_client_id
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR length(p_reason) > 2000
  THEN
    RAISE EXCEPTION 'Malformed client duplicate resolution'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'u2:client-duplicate-resolution:' || p_request_id::TEXT,
      0
    )
  );

  SELECT resolution.*
  INTO existing_resolution
  FROM platform_private.client_duplicate_resolutions AS resolution
  WHERE resolution.request_id = p_request_id;

  IF FOUND THEN
    SELECT authority.*
    INTO actor
    FROM platform.current_actor_authority() AS authority
    WHERE authority.organization_id = existing_resolution.organization_id
      AND authority.platform_role = 'admin'
      AND private.platform_has_permission(
        existing_resolution.organization_id,
        'client.duplicate.resolve'
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Active Admin duplicate-resolution authority is required'
        USING ERRCODE = '42501';
    END IF;

    IF existing_resolution.candidate_id <> p_candidate_id
      OR existing_resolution.survivor_client_id <> p_survivor_client_id
      OR existing_resolution.superseded_client_id <>
        p_superseded_client_id
      OR existing_resolution.reason <> btrim(p_reason)
    THEN
      RAISE EXCEPTION 'Duplicate resolution request UUID conflicts'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'resolution_id', existing_resolution.id,
      'candidate_id', existing_resolution.candidate_id,
      'organization_id', existing_resolution.organization_id,
      'survivor_client_id', existing_resolution.survivor_client_id,
      'superseded_client_id', existing_resolution.superseded_client_id,
      'resolved_at', existing_resolution.resolved_at,
      'request_id', existing_resolution.request_id
    );
  END IF;

  SELECT duplicate_candidate.*
  INTO candidate
  FROM platform_private.client_duplicate_candidates AS duplicate_candidate
  WHERE duplicate_candidate.id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate candidate does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF candidate.status <> 'open' THEN
    RAISE EXCEPTION 'Duplicate candidate is stale or already resolved'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (
      candidate.left_client_id = p_survivor_client_id
      AND candidate.right_client_id = p_superseded_client_id
    )
    OR (
      candidate.right_client_id = p_survivor_client_id
      AND candidate.left_client_id = p_superseded_client_id
    )
  ) THEN
    RAISE EXCEPTION 'Resolution clients do not match the candidate pair'
      USING ERRCODE = '23514';
  END IF;

  SELECT authority.*
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.organization_id = candidate.organization_id
    AND authority.platform_role = 'admin'
    AND private.platform_has_permission(
      candidate.organization_id,
      'client.duplicate.resolve'
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active Admin duplicate-resolution authority is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform.clients AS survivor
    JOIN platform.clients AS superseded
      ON superseded.organization_id = survivor.organization_id
    WHERE survivor.organization_id = candidate.organization_id
      AND survivor.id = p_survivor_client_id
      AND survivor.lifecycle_state = 'active'
      AND superseded.id = p_superseded_client_id
      AND superseded.lifecycle_state = 'active'
  )
    OR EXISTS (
      SELECT 1
      FROM platform_private.client_aliases AS alias
      WHERE alias.organization_id = candidate.organization_id
        AND alias.superseded_client_id IN (
          p_survivor_client_id,
          p_superseded_client_id
        )
    )
  THEN
    RAISE EXCEPTION 'Resolution requires two live unaliased clients'
      USING ERRCODE = '55000';
  END IF;

  resolution_id := gen_random_uuid();
  resolution_timestamp := statement_timestamp();

  INSERT INTO platform_private.client_duplicate_resolutions (
    id,
    organization_id,
    candidate_id,
    survivor_client_id,
    superseded_client_id,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id,
    resolved_at
  ) VALUES (
    resolution_id,
    candidate.organization_id,
    candidate.id,
    p_survivor_client_id,
    p_superseded_client_id,
    actor.profile_id,
    actor.membership_id,
    btrim(p_reason),
    p_request_id,
    resolution_timestamp
  );

  INSERT INTO platform_private.client_aliases (
    superseded_client_id,
    organization_id,
    canonical_client_id,
    resolution_id,
    created_at
  ) VALUES (
    p_superseded_client_id,
    candidate.organization_id,
    p_survivor_client_id,
    resolution_id,
    resolution_timestamp
  );

  UPDATE platform.leads AS lead
  SET client_id = p_survivor_client_id
  WHERE lead.organization_id = candidate.organization_id
    AND lead.client_id = p_superseded_client_id;

  UPDATE platform.student_cases AS student_case
  SET canonical_client_id = p_survivor_client_id
  WHERE student_case.organization_id = candidate.organization_id
    AND student_case.canonical_client_id = p_superseded_client_id;

  UPDATE platform.communication_conversations AS conversation
  SET canonical_client_id = p_survivor_client_id
  WHERE conversation.organization_id = candidate.organization_id
    AND conversation.canonical_client_id = p_superseded_client_id;

  UPDATE platform_private.client_duplicate_candidates AS stale_candidate
  SET status = 'stale', resolved_at = resolution_timestamp
  WHERE stale_candidate.organization_id = candidate.organization_id
    AND stale_candidate.status = 'open'
    AND stale_candidate.id <> candidate.id
    AND (
      stale_candidate.left_client_id = p_superseded_client_id
      OR stale_candidate.right_client_id = p_superseded_client_id
    );

  UPDATE platform_private.client_duplicate_candidates AS resolved_candidate
  SET status = 'resolved', resolved_at = resolution_timestamp
  WHERE resolved_candidate.id = candidate.id;

  UPDATE platform.clients AS superseded
  SET lifecycle_state = 'merged'
  WHERE superseded.organization_id = candidate.organization_id
    AND superseded.id = p_superseded_client_id;

  UPDATE platform.clients AS survivor
  SET display_name = survivor.display_name
  WHERE survivor.organization_id = candidate.organization_id
    AND survivor.id = p_survivor_client_id;

  RETURN jsonb_build_object(
    'resolution_id', resolution_id,
    'candidate_id', candidate.id,
    'organization_id', candidate.organization_id,
    'survivor_client_id', p_survivor_client_id,
    'superseded_client_id', p_superseded_client_id,
    'resolved_at', resolution_timestamp,
    'request_id', p_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.resolve_client_duplicate(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.resolve_client_duplicate(
  UUID, UUID, UUID, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION platform_private.visible_canonical_leads()
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    lead.updated_at,
    lead.organization_id,
    lead.id,
    client.id,
    client.display_name,
    client.email,
    client.phone,
    lead.current_owner_membership_id,
    owner_profile.display_name,
    lead.stage_key,
    lead.source_key,
    lead.lifecycle_state,
    CASE
      WHEN client.id IS NULL THEN 0::BIGINT
      ELSE (
        SELECT count(*)
        FROM platform_private.client_duplicate_candidates AS candidate
        WHERE candidate.organization_id = lead.organization_id
          AND candidate.status = 'open'
          AND client.id IN (
            candidate.left_client_id,
            candidate.right_client_id
          )
      )
    END,
    (
      SELECT count(*)
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = lead.organization_id
        AND (
          student_case.canonical_lead_id = lead.id
          OR (
            lead.client_id IS NOT NULL
            AND student_case.canonical_client_id = lead.client_id
          )
        )
        AND private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
    ),
    (
      SELECT count(*)
      FROM platform.communication_conversations AS conversation
      WHERE conversation.organization_id = lead.organization_id
        AND (
          conversation.canonical_lead_id = lead.id
          OR (
            lead.client_id IS NOT NULL
            AND conversation.canonical_client_id = lead.client_id
          )
        )
        AND private.platform_can_read_communication_full(
          conversation.organization_id,
          conversation.id
        )
    ),
    lead.created_at,
    lead.updated_at
  FROM platform.current_actor_authority() AS actor
  JOIN platform.leads AS lead
    ON lead.organization_id = actor.organization_id
  LEFT JOIN platform.clients AS client
    ON client.organization_id = lead.organization_id
    AND client.id = lead.client_id
  LEFT JOIN platform.organization_memberships AS owner_membership
    ON owner_membership.organization_id = lead.organization_id
    AND owner_membership.id = lead.current_owner_membership_id
  LEFT JOIN platform.profiles AS owner_profile
    ON owner_profile.id = owner_membership.profile_id
  WHERE private.platform_has_permission(
      lead.organization_id,
      'lead.read'
    )
    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND lead.current_owner_membership_id = actor.membership_id
      )
      OR (
        actor.platform_role = 'curator'
        AND EXISTS (
          SELECT 1
          FROM platform.student_cases AS student_case
          WHERE student_case.organization_id = lead.organization_id
            AND student_case.current_curator_membership_id =
              actor.membership_id
            AND student_case.canonical_lead_id = lead.id
        )
      )
    )
$$;

CREATE OR REPLACE FUNCTION platform_private.visible_canonical_clients()
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  client_id UUID,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  lifecycle_state platform.client_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_lead_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    client.updated_at,
    client.organization_id,
    client.id,
    client.display_name,
    client.email,
    client.phone,
    client.lifecycle_state,
    (
      SELECT count(*)
      FROM platform_private.client_duplicate_candidates AS candidate
      WHERE candidate.organization_id = client.organization_id
        AND candidate.status = 'open'
        AND client.id IN (
          candidate.left_client_id,
          candidate.right_client_id
        )
    ),
    (
      SELECT count(*)
      FROM platform.leads AS linked_lead
      WHERE linked_lead.organization_id = client.organization_id
        AND linked_lead.client_id = client.id
        AND private.platform_can_read_canonical_lead(
          linked_lead.organization_id,
          linked_lead.id
        )
    ),
    (
      SELECT count(*)
      FROM platform.student_cases AS student_case
      LEFT JOIN platform.leads AS case_lead
        ON case_lead.organization_id = student_case.organization_id
        AND case_lead.id = student_case.canonical_lead_id
      WHERE student_case.organization_id = client.organization_id
        AND (
          student_case.canonical_client_id = client.id
          OR case_lead.client_id = client.id
        )
        AND private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
    ),
    (
      SELECT count(*)
      FROM platform.communication_conversations AS conversation
      LEFT JOIN platform.leads AS conversation_lead
        ON conversation_lead.organization_id = conversation.organization_id
        AND conversation_lead.id = conversation.canonical_lead_id
      WHERE conversation.organization_id = client.organization_id
        AND (
          conversation.canonical_client_id = client.id
          OR conversation_lead.client_id = client.id
        )
        AND private.platform_can_read_communication_full(
          conversation.organization_id,
          conversation.id
        )
    ),
    client.created_at,
    client.updated_at
  FROM platform.current_actor_authority() AS actor
  JOIN platform.clients AS client
    ON client.organization_id = actor.organization_id
  WHERE private.platform_has_permission(
      client.organization_id,
      'client.read'
    )
    AND (
      actor.platform_role = 'admin'
      OR (
        actor.platform_role = 'sales'
        AND EXISTS (
          SELECT 1
          FROM platform.leads AS owned_lead
          WHERE owned_lead.organization_id = client.organization_id
            AND owned_lead.client_id = client.id
            AND owned_lead.current_owner_membership_id =
              actor.membership_id
        )
      )
      OR (
        actor.platform_role = 'curator'
        AND EXISTS (
          SELECT 1
          FROM platform.student_cases AS student_case
          LEFT JOIN platform.leads AS case_lead
            ON case_lead.organization_id = student_case.organization_id
            AND case_lead.id = student_case.canonical_lead_id
          WHERE student_case.organization_id = client.organization_id
            AND student_case.current_curator_membership_id =
              actor.membership_id
            AND (
              student_case.canonical_client_id = client.id
              OR case_lead.client_id = client.id
            )
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION
  platform_private.visible_canonical_leads(),
  platform_private.visible_canonical_clients()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_canonical_lead_page(
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_lead_id UUID DEFAULT NULL,
  p_stage_key TEXT DEFAULT NULL,
  p_lifecycle_state platform.lead_lifecycle_state DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid canonical-lead page limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_lead_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete canonical-lead cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_stage_key IS NOT NULL
    AND lower(btrim(p_stage_key)) !~ '^[a-z][a-z0-9_.-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid canonical-lead stage filter'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND length(btrim(p_query)) > 200 THEN
    RAISE EXCEPTION 'Canonical-lead search is too long'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT visible.*
  FROM platform_private.visible_canonical_leads() AS visible
  WHERE (
      p_before_sort_at IS NULL
      OR (visible.sort_at, visible.lead_id)
        < (p_before_sort_at, p_before_lead_id)
    )
    AND (
      p_stage_key IS NULL
      OR visible.stage_key = lower(btrim(p_stage_key))
    )
    AND (
      p_lifecycle_state IS NULL
      OR visible.lifecycle_state = p_lifecycle_state
    )
    AND (
      p_query IS NULL
      OR btrim(p_query) = ''
      OR position(
        lower(btrim(p_query))
        IN lower(
          concat_ws(
            ' ',
            visible.client_display_name,
            visible.client_email,
            visible.client_phone,
            visible.stage_key,
            visible.source_key,
            visible.lead_id::TEXT
          )
        )
      ) > 0
    )
  ORDER BY visible.sort_at DESC, visible.lead_id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_canonical_client_page(
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_client_id UUID DEFAULT NULL,
  p_lifecycle_state platform.client_lifecycle_state DEFAULT NULL,
  p_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  client_id UUID,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  lifecycle_state platform.client_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_lead_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid canonical-client page limit'
      USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_client_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete canonical-client cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL AND length(btrim(p_query)) > 200 THEN
    RAISE EXCEPTION 'Canonical-client search is too long'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH actor AS (
    SELECT *
    FROM platform.current_actor_authority()
  ),
  page_clients AS (
    SELECT
      client.updated_at AS sort_at,
      client.organization_id,
      client.id AS client_id,
      client.display_name,
      client.email,
      client.phone,
      client.lifecycle_state,
      client.created_at,
      client.updated_at
    FROM actor
    JOIN platform.clients AS client
      ON client.organization_id = actor.organization_id
    WHERE private.platform_has_permission(
        client.organization_id,
        'client.read'
      )
      AND (
        actor.platform_role = 'admin'
        OR (
          actor.platform_role = 'sales'
          AND EXISTS (
            SELECT 1
            FROM platform.leads AS owned_lead
            WHERE owned_lead.organization_id = client.organization_id
              AND owned_lead.client_id = client.id
              AND owned_lead.current_owner_membership_id =
                actor.membership_id
          )
        )
        OR (
          actor.platform_role = 'curator'
          AND EXISTS (
            SELECT 1
            FROM platform.student_cases AS student_case
            LEFT JOIN platform.leads AS case_lead
              ON case_lead.organization_id = student_case.organization_id
              AND case_lead.id = student_case.canonical_lead_id
            WHERE student_case.organization_id = client.organization_id
              AND student_case.current_curator_membership_id =
                actor.membership_id
              AND (
                student_case.canonical_client_id = client.id
                OR case_lead.client_id = client.id
              )
          )
        )
      )
      AND (
        p_before_sort_at IS NULL
        OR (client.updated_at, client.id)
          < (p_before_sort_at, p_before_client_id)
      )
      AND (
        p_lifecycle_state IS NULL
        OR client.lifecycle_state = p_lifecycle_state
      )
      AND (
        p_query IS NULL
        OR btrim(p_query) = ''
        OR position(
          lower(btrim(p_query))
          IN lower(
            concat_ws(
              ' ',
              client.display_name,
              client.email,
              client.phone,
              client.id::TEXT
            )
          )
        ) > 0
      )
    ORDER BY client.updated_at DESC, client.id DESC
    LIMIT p_limit
  )
  SELECT
    page_client.sort_at,
    page_client.organization_id,
    page_client.client_id,
    page_client.display_name,
    page_client.email,
    page_client.phone,
    page_client.lifecycle_state,
    (
      SELECT count(*)
      FROM platform_private.client_duplicate_candidates AS candidate
      WHERE candidate.organization_id = page_client.organization_id
        AND candidate.status = 'open'
        AND page_client.client_id IN (
          candidate.left_client_id,
          candidate.right_client_id
        )
    ),
    (
      SELECT count(*)
      FROM platform.leads AS linked_lead
      WHERE linked_lead.organization_id = page_client.organization_id
        AND linked_lead.client_id = page_client.client_id
        AND private.platform_can_read_canonical_lead(
          linked_lead.organization_id,
          linked_lead.id
        )
    ),
    (
      SELECT count(*)
      FROM platform.student_cases AS student_case
      LEFT JOIN platform.leads AS case_lead
        ON case_lead.organization_id = student_case.organization_id
        AND case_lead.id = student_case.canonical_lead_id
      WHERE student_case.organization_id = page_client.organization_id
        AND (
          student_case.canonical_client_id = page_client.client_id
          OR case_lead.client_id = page_client.client_id
        )
        AND private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        )
    ),
    (
      SELECT count(*)
      FROM platform.communication_conversations AS conversation
      LEFT JOIN platform.leads AS conversation_lead
        ON conversation_lead.organization_id = conversation.organization_id
        AND conversation_lead.id = conversation.canonical_lead_id
      WHERE conversation.organization_id = page_client.organization_id
        AND (
          conversation.canonical_client_id = page_client.client_id
          OR conversation_lead.client_id = page_client.client_id
        )
        AND private.platform_can_read_communication_full(
          conversation.organization_id,
          conversation.id
        )
    ),
    page_client.created_at,
    page_client.updated_at
  FROM page_clients AS page_client
  ORDER BY page_client.sort_at DESC, page_client.client_id DESC;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_canonical_lead_detail(
  p_lead_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  lead_id UUID,
  client_id UUID,
  client_display_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  current_owner_membership_id UUID,
  current_owner_display_name TEXT,
  stage_key TEXT,
  source_key TEXT,
  lifecycle_state platform.lead_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  external_identifiers JSONB,
  provenance JSONB,
  linked_student_cases JSONB,
  linked_conversations JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    visible.organization_id,
    visible.lead_id,
    visible.client_id,
    visible.client_display_name,
    visible.client_email,
    visible.client_phone,
    visible.current_owner_membership_id,
    visible.current_owner_display_name,
    visible.stage_key,
    visible.source_key,
    visible.lifecycle_state,
    visible.open_duplicate_candidate_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at,
    COALESCE((
      SELECT jsonb_agg(
        external_projection.item
        ORDER BY external_projection.observed_at DESC,
          external_projection.id DESC
      )
      FROM (
        SELECT
          external.id,
          external.observed_at,
          jsonb_build_object(
            'id', external.id,
            'source_system', external.source_system,
            'external_object_type', external.external_object_type,
            'external_identifier', external.external_identifier,
            'observed_at', external.observed_at,
            'imported_at', external.imported_at,
            'source_ref', external.source_ref
          ) AS item
        FROM platform.external_identifiers AS external
        WHERE external.organization_id = visible.organization_id
          AND external.lead_id = visible.lead_id
        ORDER BY external.observed_at DESC, external.id DESC
        LIMIT 25
      ) AS external_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        provenance_projection.item
        ORDER BY provenance_projection.observed_at DESC,
          provenance_projection.id DESC
      )
      FROM (
        SELECT
          evidence.id,
          evidence.observed_at,
          jsonb_build_object(
            'id', evidence.id,
            'source_system', evidence.source_system,
            'evidence_type', evidence.evidence_type,
            'observed_at', evidence.observed_at,
            'imported_at', evidence.imported_at,
            'source_ref', evidence.source_ref,
            'recorded_at', evidence.recorded_at
          ) AS item
        FROM platform.subject_provenance AS evidence
        WHERE evidence.organization_id = visible.organization_id
          AND evidence.lead_id = visible.lead_id
        ORDER BY evidence.observed_at DESC, evidence.id DESC
        LIMIT 25
      ) AS provenance_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        case_projection.item
        ORDER BY case_projection.updated_at DESC,
          case_projection.id DESC
      )
      FROM (
        SELECT
          student_case.id,
          student_case.updated_at,
          jsonb_build_object(
            'student_case_id', student_case.id,
            'student_display_name', student_case.student_display_name,
            'operational_stage', student_case.operational_stage,
            'state', student_case.state,
            'updated_at', student_case.updated_at
          ) AS item
        FROM platform.student_cases AS student_case
        WHERE student_case.organization_id = visible.organization_id
          AND (
            student_case.canonical_lead_id = visible.lead_id
            OR (
              visible.client_id IS NOT NULL
              AND student_case.canonical_client_id = visible.client_id
            )
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
        ORDER BY student_case.updated_at DESC, student_case.id DESC
        LIMIT 25
      ) AS case_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        conversation_projection.item
        ORDER BY conversation_projection.updated_at DESC,
          conversation_projection.id DESC
      )
      FROM (
        SELECT
          conversation.id,
          conversation.updated_at,
          jsonb_build_object(
            'conversation_id', conversation.id,
            'subject', conversation.subject,
            'queue', conversation.queue,
            'status', conversation.status,
            'updated_at', conversation.updated_at
          ) AS item
        FROM platform.communication_conversations AS conversation
        WHERE conversation.organization_id = visible.organization_id
          AND (
            conversation.canonical_lead_id = visible.lead_id
            OR (
              visible.client_id IS NOT NULL
              AND conversation.canonical_client_id = visible.client_id
            )
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT 25
      ) AS conversation_projection
    ), '[]'::JSONB)
  FROM platform_private.visible_canonical_leads() AS visible
  WHERE visible.lead_id = p_lead_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.staff_canonical_client_detail(
  p_client_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  client_id UUID,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  lifecycle_state platform.client_lifecycle_state,
  open_duplicate_candidate_count BIGINT,
  linked_lead_count BIGINT,
  linked_student_case_count BIGINT,
  linked_conversation_count BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  external_identifiers JSONB,
  provenance JSONB,
  linked_leads JSONB,
  linked_student_cases JSONB,
  linked_conversations JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requested AS MATERIALIZED (
    SELECT COALESCE((
      SELECT alias.canonical_client_id
      FROM platform_private.client_aliases AS alias
      WHERE alias.superseded_client_id = p_client_id
    ), p_client_id) AS client_id
  )
  SELECT
    visible.organization_id,
    visible.client_id,
    visible.display_name,
    visible.email,
    visible.phone,
    visible.lifecycle_state,
    visible.open_duplicate_candidate_count,
    visible.linked_lead_count,
    visible.linked_student_case_count,
    visible.linked_conversation_count,
    visible.created_at,
    visible.updated_at,
    COALESCE((
      SELECT jsonb_agg(
        external_projection.item
        ORDER BY external_projection.observed_at DESC,
          external_projection.id DESC
      )
      FROM (
        SELECT
          external.id,
          external.observed_at,
          jsonb_build_object(
            'id', external.id,
            'source_system', external.source_system,
            'external_object_type', external.external_object_type,
            'external_identifier', external.external_identifier,
            'observed_at', external.observed_at,
            'imported_at', external.imported_at,
            'source_ref', external.source_ref
          ) AS item
        FROM platform.external_identifiers AS external
        WHERE external.organization_id = visible.organization_id
          AND external.client_id IS NOT NULL
          AND (
            external.client_id = visible.client_id
            OR EXISTS (
              SELECT 1
              FROM platform_private.client_aliases AS alias
              WHERE alias.organization_id = visible.organization_id
                AND alias.canonical_client_id = visible.client_id
                AND alias.superseded_client_id = external.client_id
            )
          )
        ORDER BY external.observed_at DESC, external.id DESC
        LIMIT 25
      ) AS external_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        provenance_projection.item
        ORDER BY provenance_projection.observed_at DESC,
          provenance_projection.id DESC
      )
      FROM (
        SELECT
          evidence.id,
          evidence.observed_at,
          jsonb_build_object(
            'id', evidence.id,
            'source_system', evidence.source_system,
            'evidence_type', evidence.evidence_type,
            'observed_at', evidence.observed_at,
            'imported_at', evidence.imported_at,
            'source_ref', evidence.source_ref,
            'recorded_at', evidence.recorded_at
          ) AS item
        FROM platform.subject_provenance AS evidence
        WHERE evidence.organization_id = visible.organization_id
          AND evidence.client_id IS NOT NULL
          AND (
            evidence.client_id = visible.client_id
            OR EXISTS (
              SELECT 1
              FROM platform_private.client_aliases AS alias
              WHERE alias.organization_id = visible.organization_id
                AND alias.canonical_client_id = visible.client_id
                AND alias.superseded_client_id = evidence.client_id
            )
          )
        ORDER BY evidence.observed_at DESC, evidence.id DESC
        LIMIT 25
      ) AS provenance_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        lead_projection.item
        ORDER BY lead_projection.updated_at DESC,
          lead_projection.id DESC
      )
      FROM (
        SELECT
          lead.id,
          lead.updated_at,
          jsonb_build_object(
            'lead_id', lead.id,
            'stage_key', lead.stage_key,
            'lifecycle_state', lead.lifecycle_state,
            'source_key', lead.source_key,
            'current_owner_membership_id',
              lead.current_owner_membership_id,
            'current_owner_display_name', owner_profile.display_name,
            'updated_at', lead.updated_at
          ) AS item
        FROM platform.leads AS lead
        LEFT JOIN platform.organization_memberships AS owner_membership
          ON owner_membership.organization_id = lead.organization_id
          AND owner_membership.id = lead.current_owner_membership_id
        LEFT JOIN platform.profiles AS owner_profile
          ON owner_profile.id = owner_membership.profile_id
        WHERE lead.organization_id = visible.organization_id
          AND lead.client_id = visible.client_id
          AND private.platform_can_read_canonical_lead(
            lead.organization_id,
            lead.id
          )
        ORDER BY lead.updated_at DESC, lead.id DESC
        LIMIT 25
      ) AS lead_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        case_projection.item
        ORDER BY case_projection.updated_at DESC,
          case_projection.id DESC
      )
      FROM (
        SELECT
          student_case.id,
          student_case.updated_at,
          jsonb_build_object(
            'student_case_id', student_case.id,
            'student_display_name', student_case.student_display_name,
            'operational_stage', student_case.operational_stage,
            'state', student_case.state,
            'updated_at', student_case.updated_at
          ) AS item
        FROM platform.student_cases AS student_case
        LEFT JOIN platform.leads AS case_lead
          ON case_lead.organization_id = student_case.organization_id
          AND case_lead.id = student_case.canonical_lead_id
        WHERE student_case.organization_id = visible.organization_id
          AND (
            student_case.canonical_client_id = visible.client_id
            OR case_lead.client_id = visible.client_id
          )
          AND private.platform_can_read_student_case(
            student_case.organization_id,
            student_case.id
          )
        ORDER BY student_case.updated_at DESC, student_case.id DESC
        LIMIT 25
      ) AS case_projection
    ), '[]'::JSONB),
    COALESCE((
      SELECT jsonb_agg(
        conversation_projection.item
        ORDER BY conversation_projection.updated_at DESC,
          conversation_projection.id DESC
      )
      FROM (
        SELECT
          conversation.id,
          conversation.updated_at,
          jsonb_build_object(
            'conversation_id', conversation.id,
            'subject', conversation.subject,
            'queue', conversation.queue,
            'status', conversation.status,
            'updated_at', conversation.updated_at
          ) AS item
        FROM platform.communication_conversations AS conversation
        LEFT JOIN platform.leads AS conversation_lead
          ON conversation_lead.organization_id = conversation.organization_id
          AND conversation_lead.id = conversation.canonical_lead_id
        WHERE conversation.organization_id = visible.organization_id
          AND (
            conversation.canonical_client_id = visible.client_id
            OR conversation_lead.client_id = visible.client_id
          )
          AND private.platform_can_read_communication_full(
            conversation.organization_id,
            conversation.id
          )
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT 25
      ) AS conversation_projection
    ), '[]'::JSONB)
  FROM requested
  JOIN platform_private.visible_canonical_clients() AS visible
    ON visible.client_id = requested.client_id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION
  platform.staff_canonical_lead_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    platform.lead_lifecycle_state,
    TEXT
  ),
  platform.staff_canonical_lead_detail(UUID),
  platform.staff_canonical_client_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.client_lifecycle_state,
    TEXT
  ),
  platform.staff_canonical_client_detail(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.staff_canonical_lead_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    TEXT,
    platform.lead_lifecycle_state,
    TEXT
  ),
  platform.staff_canonical_lead_detail(UUID),
  platform.staff_canonical_client_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.client_lifecycle_state,
    TEXT
  ),
  platform.staff_canonical_client_detail(UUID)
TO authenticated;

COMMENT ON TABLE platform.clients IS
  'Canonical EVO person identity. Normalized values compare candidates only; display values remain authoritative for staff presentation.';
COMMENT ON TABLE platform.leads IS
  'Canonical EVO lead ownership, stage and lifecycle. Provider identifiers are provenance only.';
COMMENT ON TABLE platform.external_identifiers IS
  'Append-only provider/source identifier mapped to exactly one canonical subject.';
COMMENT ON TABLE platform.subject_provenance IS
  'Append-only safe source and freshness evidence; raw provider payloads are forbidden.';
COMMENT ON FUNCTION platform.resolve_client_duplicate(
  UUID, UUID, UUID, TEXT, UUID
) IS
  'Active-Admin idempotent merge of one open client duplicate candidate, preserving evidence behind a private alias.';
COMMENT ON FUNCTION platform.staff_canonical_lead_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  TEXT,
  platform.lead_lifecycle_state,
  TEXT
) IS
  'Role-scoped canonical lead keyset page; limit 1..101 and full cursor pair required.';
COMMENT ON FUNCTION platform.staff_canonical_lead_detail(UUID) IS
  'Role-scoped canonical lead detail with safe nested projections capped at 25 rows each.';
COMMENT ON FUNCTION platform.staff_canonical_client_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  platform.client_lifecycle_state,
  TEXT
) IS
  'Role-scoped canonical client keyset page; limit 1..101 and full cursor pair required.';
COMMENT ON FUNCTION platform.staff_canonical_client_detail(UUID) IS
  'Role-scoped canonical client detail with safe nested projections capped at 25 rows each.';

COMMIT;
