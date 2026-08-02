-- ============================================================
-- 054_platform_decision_prompt_lifecycle.sql
--
-- BW4: append-only conversation decision history and independently versioned
-- Lead Manager prompt artifacts. Prompt content remains backend-private;
-- browser-facing projections expose metadata only. Every staff mutation is
-- re-authorized against the live conversation/case owner at execution time.
--
-- This forward-only migration does not call a provider, send a customer
-- message, import production data, or mutate any deployment.
-- ============================================================

BEGIN;

CREATE TYPE platform.decision_backlog_status AS ENUM (
  'unresolved',
  'answered',
  'retired'
);

CREATE TYPE platform.decision_requirement_kind AS ENUM (
  'general',
  'student_profile',
  'country_requirement',
  'document_requirement',
  'handoff'
);

CREATE TYPE platform.ai_prompt_artifact_kind AS ENUM (
  'prompt_policy',
  'business_context'
);

CREATE TYPE platform.ai_prompt_artifact_status AS ENUM (
  'approved',
  'retired'
);

-- Raw prompt content is intentionally outside the exposed platform schema.
CREATE TABLE platform_private.ai_prompt_artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  artifact_kind platform.ai_prompt_artifact_kind NOT NULL,
  artifact_key TEXT NOT NULL DEFAULT 'lead_manager.default' CHECK (
    artifact_key = 'lead_manager.default'
  ),
  title TEXT NOT NULL CHECK (
    btrim(title) <> '' AND char_length(title) <= 200
  ),
  version BIGINT NOT NULL CHECK (version > 0),
  status platform.ai_prompt_artifact_status NOT NULL DEFAULT 'approved',
  content_text TEXT NOT NULL CHECK (
    btrim(content_text) <> '' AND char_length(content_text) <= 262144
  ),
  content_sha256 TEXT NOT NULL CHECK (
    content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  provenance_ref TEXT NOT NULL CHECK (
    btrim(provenance_ref) <> ''
    AND char_length(provenance_ref) <= 1000
    AND provenance_ref !~ '[[:cntrl:]]'
  ),
  approved_by_membership_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  retired_by_membership_id UUID,
  retired_at TIMESTAMPTZ,
  retirement_reason_sha256 TEXT CHECK (
    retirement_reason_sha256 IS NULL
    OR retirement_reason_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_prompt_artifact_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_prompt_artifact_versions_kind_key_version_key
    UNIQUE (organization_id, artifact_kind, artifact_key, version),
  CONSTRAINT ai_prompt_artifact_versions_approver_fkey
    FOREIGN KEY (organization_id, approved_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_prompt_artifact_versions_retirer_fkey
    FOREIGN KEY (organization_id, retired_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_prompt_artifact_versions_status_shape_check CHECK (
    (
      status = 'approved'
      AND retired_by_membership_id IS NULL
      AND retired_at IS NULL
      AND retirement_reason_sha256 IS NULL
    )
    OR (
      status = 'retired'
      AND retired_by_membership_id IS NOT NULL
      AND retired_at IS NOT NULL
      AND retirement_reason_sha256 IS NOT NULL
    )
  )
);

CREATE INDEX ai_prompt_artifact_versions_active_idx
  ON platform_private.ai_prompt_artifact_versions (
    organization_id,
    artifact_kind,
    artifact_key,
    status,
    version DESC
  );
CREATE INDEX ai_prompt_artifact_versions_approver_idx
  ON platform_private.ai_prompt_artifact_versions (
    organization_id,
    approved_by_membership_id
  );
CREATE INDEX ai_prompt_artifact_versions_retirer_idx
  ON platform_private.ai_prompt_artifact_versions (
    organization_id,
    retired_by_membership_id
  )
  WHERE retired_by_membership_id IS NOT NULL;

-- This public table exposes only immutable identifiers and safe metadata
-- relationships. Raw content remains in platform_private.
CREATE TABLE platform.ai_draft_request_prompt_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  ai_draft_request_id UUID NOT NULL,
  prompt_policy_artifact_version_id UUID NOT NULL,
  business_context_artifact_version_id UUID NOT NULL,
  selected_by_profile_id UUID NOT NULL,
  selected_by_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_draft_request_prompt_selections_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_draft_request_prompt_selections_request_key
    UNIQUE (organization_id, ai_draft_request_id),
  CONSTRAINT ai_draft_request_prompt_selections_parent_identity_key
    UNIQUE (organization_id, ai_draft_request_id, conversation_id),
  CONSTRAINT ai_draft_request_prompt_selections_request_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_request_id,
      conversation_id
    )
    REFERENCES platform.ai_draft_requests(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_prompt_selections_policy_fkey
    FOREIGN KEY (organization_id, prompt_policy_artifact_version_id)
    REFERENCES platform_private.ai_prompt_artifact_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_prompt_selections_context_fkey
    FOREIGN KEY (organization_id, business_context_artifact_version_id)
    REFERENCES platform_private.ai_prompt_artifact_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_prompt_selections_profile_fkey
    FOREIGN KEY (selected_by_profile_id)
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_prompt_selections_membership_fkey
    FOREIGN KEY (organization_id, selected_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_prompt_selections_distinct_check CHECK (
    prompt_policy_artifact_version_id <>
      business_context_artifact_version_id
  )
);

CREATE INDEX ai_draft_request_prompt_selections_conversation_idx
  ON platform.ai_draft_request_prompt_selections (
    organization_id,
    conversation_id,
    selected_at DESC,
    id DESC
  );
CREATE INDEX ai_draft_request_prompt_selections_policy_idx
  ON platform.ai_draft_request_prompt_selections (
    organization_id,
    prompt_policy_artifact_version_id
  );
CREATE INDEX ai_draft_request_prompt_selections_context_idx
  ON platform.ai_draft_request_prompt_selections (
    organization_id,
    business_context_artifact_version_id
  );
CREATE INDEX ai_draft_request_prompt_selections_membership_idx
  ON platform.ai_draft_request_prompt_selections (
    organization_id,
    selected_by_membership_id,
    selected_at DESC
  );

CREATE TABLE platform.decision_backlogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  student_case_id UUID,
  created_by_profile_id UUID NOT NULL,
  created_by_membership_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT decision_backlogs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT decision_backlogs_parent_identity_key
    UNIQUE (organization_id, id, conversation_id),
  CONSTRAINT decision_backlogs_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT decision_backlogs_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT decision_backlogs_profile_fkey
    FOREIGN KEY (created_by_profile_id)
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT decision_backlogs_membership_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX decision_backlogs_conversation_idx
  ON platform.decision_backlogs (
    organization_id,
    conversation_id,
    created_at,
    id
  );
CREATE INDEX decision_backlogs_case_idx
  ON platform.decision_backlogs (organization_id, student_case_id)
  WHERE student_case_id IS NOT NULL;
CREATE INDEX decision_backlogs_creator_idx
  ON platform.decision_backlogs (
    organization_id,
    created_by_membership_id,
    created_at DESC
  );

CREATE TABLE platform.decision_backlog_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  decision_backlog_id UUID NOT NULL,
  effective_version BIGINT NOT NULL CHECK (effective_version > 0),
  question TEXT NOT NULL CHECK (
    btrim(question) <> '' AND char_length(question) <= 2000
  ),
  answer TEXT CHECK (
    answer IS NULL
    OR (btrim(answer) <> '' AND char_length(answer) <= 8000)
  ),
  owner_role platform.business_role NOT NULL CHECK (
    owner_role IN ('admin', 'sales', 'curator')
  ),
  status platform.decision_backlog_status NOT NULL,
  affected_requirement_kind platform.decision_requirement_kind NOT NULL,
  affected_requirement_id UUID,
  affected_requirement_field platform.student_profile_field,
  source_registry_id UUID,
  evidence_ref TEXT CHECK (
    evidence_ref IS NULL
    OR (btrim(evidence_ref) <> '' AND char_length(evidence_ref) <= 1000)
  ),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_profile_id UUID NOT NULL,
  created_by_membership_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT decision_backlog_versions_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT decision_backlog_versions_backlog_version_key
    UNIQUE (organization_id, decision_backlog_id, effective_version),
  CONSTRAINT decision_backlog_versions_backlog_fkey
    FOREIGN KEY (
      organization_id,
      decision_backlog_id,
      conversation_id
    )
    REFERENCES platform.decision_backlogs(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT decision_backlog_versions_source_fkey
    FOREIGN KEY (organization_id, source_registry_id)
    REFERENCES platform.source_registry(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT decision_backlog_versions_profile_fkey
    FOREIGN KEY (created_by_profile_id)
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT decision_backlog_versions_membership_fkey
    FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT decision_backlog_versions_source_pair_check CHECK (
    (source_registry_id IS NULL) = (evidence_ref IS NULL)
  ),
  CONSTRAINT decision_backlog_versions_status_shape_check CHECK (
    (
      status = 'answered'
      AND answer IS NOT NULL
      AND source_registry_id IS NOT NULL
      AND evidence_ref IS NOT NULL
    )
    OR (
      status = 'unresolved'
      AND answer IS NULL
    )
    OR status = 'retired'
  ),
  CONSTRAINT decision_backlog_versions_requirement_shape_check CHECK (
    (
      affected_requirement_kind = 'general'
      AND affected_requirement_id IS NULL
      AND affected_requirement_field IS NULL
    )
    OR (
      affected_requirement_kind = 'student_profile'
      AND affected_requirement_id IS NOT NULL
      AND affected_requirement_field IS NOT NULL
    )
    OR (
      affected_requirement_kind IN (
        'country_requirement',
        'document_requirement',
        'handoff'
      )
      AND affected_requirement_id IS NOT NULL
      AND affected_requirement_field IS NULL
    )
  )
);

CREATE INDEX decision_backlog_versions_backlog_idx
  ON platform.decision_backlog_versions (
    organization_id,
    decision_backlog_id,
    effective_version DESC
  );
CREATE INDEX decision_backlog_versions_source_idx
  ON platform.decision_backlog_versions (
    organization_id,
    source_registry_id
  )
  WHERE source_registry_id IS NOT NULL;
CREATE INDEX decision_backlog_versions_creator_idx
  ON platform.decision_backlog_versions (
    organization_id,
    created_by_membership_id,
    created_at DESC
  );

-- Historical drafts remain valid with NULL artifact columns. Every draft
-- created after this migration is pinned by the insert guard below.
ALTER TABLE platform.ai_drafts
  ADD COLUMN prompt_policy_artifact_version_id UUID,
  ADD COLUMN business_context_artifact_version_id UUID,
  ADD CONSTRAINT ai_drafts_prompt_policy_artifact_fkey
    FOREIGN KEY (organization_id, prompt_policy_artifact_version_id)
    REFERENCES platform_private.ai_prompt_artifact_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT ai_drafts_business_context_artifact_fkey
    FOREIGN KEY (organization_id, business_context_artifact_version_id)
    REFERENCES platform_private.ai_prompt_artifact_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT ai_drafts_prompt_artifact_pair_check CHECK (
    (prompt_policy_artifact_version_id IS NULL) =
      (business_context_artifact_version_id IS NULL)
  );

CREATE INDEX ai_drafts_prompt_policy_artifact_idx
  ON platform.ai_drafts (
    organization_id,
    prompt_policy_artifact_version_id
  )
  WHERE prompt_policy_artifact_version_id IS NOT NULL;
CREATE INDEX ai_drafts_business_context_artifact_idx
  ON platform.ai_drafts (
    organization_id,
    business_context_artifact_version_id
  )
  WHERE business_context_artifact_version_id IS NOT NULL;

ALTER TABLE platform_private.ai_prompt_artifact_versions
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.ai_prompt_artifact_versions
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_request_prompt_selections
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_request_prompt_selections
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.decision_backlogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.decision_backlogs FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.decision_backlog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.decision_backlog_versions FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION platform_private.ai_prompt_compatibility_snapshot(
  p_artifact_key TEXT,
  p_version BIGINT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_artifact_key || '@' || p_version::TEXT
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_ai_prompt_artifact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI prompt artifact versions are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.artifact_kind <> OLD.artifact_kind
    OR NEW.artifact_key <> OLD.artifact_key
    OR NEW.title <> OLD.title
    OR NEW.version <> OLD.version
    OR NEW.content_text <> OLD.content_text
    OR NEW.content_sha256 <> OLD.content_sha256
    OR NEW.provenance_ref <> OLD.provenance_ref
    OR NEW.approved_by_membership_id <> OLD.approved_by_membership_id
    OR NEW.approved_at <> OLD.approved_at
    OR NEW.created_at <> OLD.created_at
    OR OLD.status <> 'approved'
    OR NEW.status <> 'retired'
    OR NEW.retired_by_membership_id IS NULL
    OR NEW.retired_at IS NULL
    OR NEW.retirement_reason_sha256 IS NULL
  THEN
    RAISE EXCEPTION 'AI prompt artifact history is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_ai_prompt_selection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.ai_prompt_artifact_versions AS artifact
    WHERE artifact.organization_id = NEW.organization_id
      AND artifact.id = NEW.prompt_policy_artifact_version_id
      AND artifact.artifact_kind = 'prompt_policy'
      AND artifact.artifact_key = 'lead_manager.default'
      AND artifact.status = 'approved'
  ) OR NOT EXISTS (
    SELECT 1
    FROM platform_private.ai_prompt_artifact_versions AS artifact
    WHERE artifact.organization_id = NEW.organization_id
      AND artifact.id = NEW.business_context_artifact_version_id
      AND artifact.artifact_kind = 'business_context'
      AND artifact.artifact_key = 'lead_manager.default'
      AND artifact.status = 'approved'
  ) THEN
    RAISE EXCEPTION
      'AI draft request requires approved prompt-policy and business-context pins'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_ai_draft_prompt_pins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selection_row platform.ai_draft_request_prompt_selections%ROWTYPE;
  policy_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  selected_knowledge_version_id UUID;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.ai_draft_request_id <> OLD.ai_draft_request_id
      OR NEW.organization_id <> OLD.organization_id
      OR NEW.prompt_policy_artifact_version_id
        IS DISTINCT FROM OLD.prompt_policy_artifact_version_id
      OR NEW.business_context_artifact_version_id
        IS DISTINCT FROM OLD.business_context_artifact_version_id
    )
  THEN
    RAISE EXCEPTION 'AI draft prompt pins are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO selection_row
  FROM platform.ai_draft_request_prompt_selections AS selection
  WHERE selection.organization_id = NEW.organization_id
    AND selection.ai_draft_request_id = NEW.ai_draft_request_id;

  IF selection_row.id IS NULL THEN
    RAISE EXCEPTION 'AI draft request prompt pins are unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT selection.selected_knowledge_version_id
  INTO selected_knowledge_version_id
  FROM platform.ai_draft_request_knowledge_selections AS selection
  WHERE selection.organization_id = NEW.organization_id
    AND selection.ai_draft_request_id = NEW.ai_draft_request_id;

  IF selected_knowledge_version_id IS NULL THEN
    RAISE EXCEPTION 'AI draft request knowledge pin is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.knowledge_version_id IS NOT NULL
    AND NEW.knowledge_version_id <> selected_knowledge_version_id
  THEN
    RAISE EXCEPTION 'AI draft knowledge pin mismatch'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.prompt_policy_artifact_version_id IS NOT NULL
    AND NEW.prompt_policy_artifact_version_id <>
      selection_row.prompt_policy_artifact_version_id
  THEN
    RAISE EXCEPTION 'AI draft prompt-policy pin mismatch'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.business_context_artifact_version_id IS NOT NULL
    AND NEW.business_context_artifact_version_id <>
      selection_row.business_context_artifact_version_id
  THEN
    RAISE EXCEPTION 'AI draft business-context pin mismatch'
      USING ERRCODE = '22023';
  END IF;

  NEW.prompt_policy_artifact_version_id :=
    selection_row.prompt_policy_artifact_version_id;
  NEW.business_context_artifact_version_id :=
    selection_row.business_context_artifact_version_id;

  SELECT *
  INTO policy_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = NEW.organization_id
    AND artifact.id = selection_row.prompt_policy_artifact_version_id
    AND artifact.artifact_kind = 'prompt_policy'
    AND artifact.artifact_key = 'lead_manager.default';

  IF policy_row.id IS NULL THEN
    RAISE EXCEPTION 'Pinned AI prompt-policy artifact is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.prompt_policy_version IS NOT NULL
    AND NEW.prompt_policy_version <>
      platform_private.ai_prompt_compatibility_snapshot(
        policy_row.artifact_key,
        policy_row.version
      )
  THEN
    RAISE EXCEPTION 'Legacy prompt-policy snapshot does not match request pin'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.decision_requirement_is_valid(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_requirement_kind platform.decision_requirement_kind,
  p_requirement_id UUID,
  p_requirement_field platform.student_profile_field
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  CASE p_requirement_kind
    WHEN 'general' THEN
      RETURN p_requirement_id IS NULL AND p_requirement_field IS NULL;
    WHEN 'student_profile' THEN
      RETURN p_student_case_id IS NOT NULL
        AND p_requirement_id = p_student_case_id
        AND p_requirement_field IS NOT NULL;
    WHEN 'country_requirement' THEN
      RETURN p_student_case_id IS NOT NULL
        AND p_requirement_field IS NULL
        AND EXISTS (
          SELECT 1
          FROM platform.student_cases AS student_case
          WHERE student_case.organization_id = p_organization_id
            AND student_case.id = p_student_case_id
            AND student_case.applied_country_requirement_version_id =
              p_requirement_id
        );
    WHEN 'document_requirement' THEN
      RETURN p_student_case_id IS NOT NULL
        AND p_requirement_field IS NULL
        AND EXISTS (
          SELECT 1
          FROM platform.document_slots AS slot
          WHERE slot.organization_id = p_organization_id
            AND slot.student_case_id = p_student_case_id
            AND slot.requirement_id = p_requirement_id
        );
    WHEN 'handoff' THEN
      RETURN p_student_case_id IS NOT NULL
        AND p_requirement_field IS NULL
        AND EXISTS (
          SELECT 1
          FROM platform.student_case_op_handoffs AS handoff
          WHERE handoff.organization_id = p_organization_id
            AND handoff.student_case_id = p_student_case_id
            AND handoff.id = p_requirement_id
        );
    ELSE
      RETURN FALSE;
  END CASE;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_decision_backlog_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  backlog_row platform.decision_backlogs%ROWTYPE;
  prior_version BIGINT;
  source_status platform.workflow_source_review_status;
BEGIN
  SELECT *
  INTO backlog_row
  FROM platform.decision_backlogs AS backlog
  WHERE backlog.organization_id = NEW.organization_id
    AND backlog.id = NEW.decision_backlog_id
    AND backlog.conversation_id = NEW.conversation_id;

  IF backlog_row.id IS NULL THEN
    RAISE EXCEPTION 'Decision backlog is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT MAX(version.effective_version)
  INTO prior_version
  FROM platform.decision_backlog_versions AS version
  WHERE version.organization_id = NEW.organization_id
    AND version.decision_backlog_id = NEW.decision_backlog_id;

  IF NEW.effective_version <> COALESCE(prior_version, 0) + 1 THEN
    RAISE EXCEPTION 'Decision effective version is not the next version'
      USING ERRCODE = '40001';
  END IF;

  IF NOT platform_private.decision_requirement_is_valid(
    NEW.organization_id,
    backlog_row.student_case_id,
    NEW.affected_requirement_kind,
    NEW.affected_requirement_id,
    NEW.affected_requirement_field
  ) THEN
    RAISE EXCEPTION 'Affected decision requirement is outside the conversation case'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.source_registry_id IS NOT NULL THEN
    SELECT source.review_status
    INTO source_status
    FROM platform.source_registry AS source
    WHERE source.organization_id = NEW.organization_id
      AND source.id = NEW.source_registry_id;

    IF source_status IS NULL
      OR (
        NEW.status IN ('answered', 'unresolved')
        AND source_status <> 'reviewed'
      )
      OR (
        NEW.status = 'retired'
        AND source_status NOT IN ('reviewed', 'retired')
      )
    THEN
      RAISE EXCEPTION 'Decision source must have reviewed provenance'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER ai_prompt_artifact_versions_transition_guard
  BEFORE UPDATE OR DELETE
  ON platform_private.ai_prompt_artifact_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_ai_prompt_artifact_mutation();
CREATE TRIGGER ai_prompt_artifact_versions_no_truncate
  BEFORE TRUNCATE
  ON platform_private.ai_prompt_artifact_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_request_prompt_selections_insert_guard
  BEFORE INSERT
  ON platform.ai_draft_request_prompt_selections
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_ai_prompt_selection();
CREATE TRIGGER ai_draft_request_prompt_selections_append_only
  BEFORE UPDATE OR DELETE
  ON platform.ai_draft_request_prompt_selections
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_request_prompt_selections_no_truncate
  BEFORE TRUNCATE
  ON platform.ai_draft_request_prompt_selections
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_drafts_prompt_pin_guard
  BEFORE INSERT OR UPDATE
  ON platform.ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_ai_draft_prompt_pins();
CREATE TRIGGER decision_backlogs_append_only
  BEFORE UPDATE OR DELETE
  ON platform.decision_backlogs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER decision_backlogs_no_truncate
  BEFORE TRUNCATE
  ON platform.decision_backlogs
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER decision_backlog_versions_insert_guard
  BEFORE INSERT
  ON platform.decision_backlog_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_decision_backlog_version();
CREATE TRIGGER decision_backlog_versions_append_only
  BEFORE UPDATE OR DELETE
  ON platform.decision_backlog_versions
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER decision_backlog_versions_no_truncate
  BEFORE TRUNCATE
  ON platform.decision_backlog_versions
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

REVOKE ALL ON FUNCTION
  platform_private.ai_prompt_compatibility_snapshot(TEXT, BIGINT),
  platform_private.guard_ai_prompt_artifact_mutation(),
  platform_private.guard_ai_prompt_selection(),
  platform_private.guard_ai_draft_prompt_pins(),
  platform_private.decision_requirement_is_valid(
    UUID,
    UUID,
    platform.decision_requirement_kind,
    UUID,
    platform.student_profile_field
  ),
  platform_private.guard_decision_backlog_version()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Immutable v9 bundles clone v8 and add only the BW4 permissions.
INSERT INTO platform.permission_definitions (permission_key, description)
VALUES
  ('decision.read', 'Read decision history for an authorized conversation'),
  ('decision.manage', 'Append decision versions for an authorized conversation'),
  ('prompt.artifact.manage', 'Publish, inspect and retire private AI prompt artifacts');

INSERT INTO platform.role_bundle_versions (id, role, version, status, label)
VALUES
  ('00000000-0000-4000-8000-000000000801', 'admin', 9, 'draft', 'Admin v9 decision and prompt lifecycle'),
  ('00000000-0000-4000-8000-000000000802', 'sales', 9, 'draft', 'Sales v9 decision lifecycle'),
  ('00000000-0000-4000-8000-000000000803', 'curator', 9, 'draft', 'Curator v9 decision lifecycle'),
  ('00000000-0000-4000-8000-000000000804', 'finance', 9, 'draft', 'Finance v9 unchanged'),
  ('00000000-0000-4000-8000-000000000805', 'student', 9, 'draft', 'Student v9 unchanged');

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT v9.id, v9.role, v8_permission.permission_key
FROM platform.role_bundle_versions AS v9
JOIN platform.role_bundle_versions AS v8
  ON v8.role = v9.role
  AND v8.version = 8
  AND v8.status = 'published'
JOIN platform.role_bundle_permissions AS v8_permission
  ON v8_permission.bundle_id = v8.id
  AND v8_permission.bundle_role = v8.role
WHERE v9.version = 9;

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
SELECT bundle.id, bundle.role, permission.permission_key
FROM platform.role_bundle_versions AS bundle
CROSS JOIN platform.permission_definitions AS permission
WHERE bundle.version = 9
  AND (
    (
      bundle.role = 'admin'
      AND permission.permission_key IN (
        'decision.read',
        'decision.manage',
        'prompt.artifact.manage'
      )
    )
    OR (
      bundle.role IN ('sales', 'curator')
      AND permission.permission_key IN ('decision.read', 'decision.manage')
    )
  );

UPDATE platform.role_bundle_versions
SET status = 'published', published_at = statement_timestamp()
WHERE version = 9;

CREATE TEMPORARY TABLE bw4_membership_bundle_upgrades
ON COMMIT DROP
AS
SELECT
  membership.organization_id,
  membership.id AS membership_id,
  membership.profile_id,
  membership."current_role" AS business_role,
  membership.current_bundle_id AS previous_bundle_id,
  v9.id AS new_bundle_id,
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
JOIN platform.role_bundle_versions AS v8
  ON v8.id = membership.current_bundle_id
  AND v8.role = membership."current_role"
  AND v8.version = 8
  AND v8.status = 'published'
JOIN platform.role_bundle_versions AS v9
  ON v9.role = membership."current_role"
  AND v9.version = 9
  AND v9.status = 'published'
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
  'BW4 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw4_membership_bundle_upgrades AS upgrade;

UPDATE platform.organization_memberships AS membership
SET current_bundle_id = upgrade.new_bundle_id
FROM bw4_membership_bundle_upgrades AS upgrade
WHERE membership.organization_id = upgrade.organization_id
  AND membership.id = upgrade.membership_id;

UPDATE platform.profiles AS profile
SET access_version = profile.access_version + 1
WHERE profile.id IN (
  SELECT DISTINCT upgrade.profile_id
  FROM bw4_membership_bundle_upgrades AS upgrade
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
  'migration:054_platform_decision_prompt_lifecycle',
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
  'BW4 immutable RBAC bundle upgrade',
  upgrade.request_id
FROM bw4_membership_bundle_upgrades AS upgrade
JOIN platform.profiles AS profile ON profile.id = upgrade.profile_id;

CREATE OR REPLACE FUNCTION platform_private.lock_bw4_request(
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
    hashtextextended('evo:bw4:request:' || p_request_id::TEXT, 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.lock_bw4_prompt_stream(
  p_organization_id UUID,
  p_artifact_kind platform.ai_prompt_artifact_kind
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_artifact_kind IS NULL THEN
    RAISE EXCEPTION 'Prompt artifact stream is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:bw4:prompt:'
        || p_organization_id::TEXT
        || ':'
        || p_artifact_kind::TEXT,
      0
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION platform_private.require_bw4_admin_actor(
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
      'prompt.artifact.manage'
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

REVOKE ALL ON FUNCTION
  platform_private.lock_bw4_request(UUID),
  platform_private.lock_bw4_prompt_stream(
    UUID,
    platform.ai_prompt_artifact_kind
  ),
  platform_private.require_bw4_admin_actor(UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.publish_ai_prompt_artifact_version(
  p_organization_id UUID,
  p_artifact_kind platform.ai_prompt_artifact_kind,
  p_title TEXT,
  p_content_text TEXT,
  p_provenance_ref TEXT,
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
  created_artifact_id UUID := gen_random_uuid();
  next_version BIGINT;
  content_hash TEXT;
  input_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Publish one reviewed Lead Manager prompt artifact version';
BEGIN
  PERFORM platform_private.lock_bw4_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_artifact_kind IS NULL
    OR btrim(COALESCE(p_title, '')) = ''
    OR char_length(p_title) > 200
    OR btrim(COALESCE(p_content_text, '')) = ''
    OR char_length(p_content_text) > 262144
    OR btrim(COALESCE(p_provenance_ref, '')) = ''
    OR char_length(p_provenance_ref) > 1000
    OR p_provenance_ref ~ '[[:cntrl:]]'
    OR btrim(COALESCE(p_reason, '')) = ''
    OR char_length(p_reason) > 1000
  THEN
    RAISE EXCEPTION 'Bounded prompt artifact content and reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_bw4_admin_actor(p_organization_id);

  content_hash := encode(
    sha256(convert_to(p_content_text, 'UTF8')),
    'hex'
  );
  input_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'artifact_kind', p_artifact_kind,
          'artifact_key', 'lead_manager.default',
          'title', btrim(p_title),
          'content_sha256', content_hash,
          'provenance_ref', btrim(p_provenance_ref),
          'reason', btrim(p_reason),
          'actor_membership_id', actor.actor_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'prompt.artifact.publish',
    'ai_prompt_artifact_version',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'artifact_kind', p_artifact_kind,
      'input_sha256', input_hash,
      'approved_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.lock_bw4_prompt_stream(
    p_organization_id,
    p_artifact_kind
  );

  SELECT COALESCE(MAX(artifact.version), 0) + 1
  INTO next_version
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_kind = p_artifact_kind
    AND artifact.artifact_key = 'lead_manager.default';

  INSERT INTO platform_private.ai_prompt_artifact_versions (
    id,
    organization_id,
    artifact_kind,
    artifact_key,
    title,
    version,
    status,
    content_text,
    content_sha256,
    provenance_ref,
    approved_by_membership_id
  )
  VALUES (
    created_artifact_id,
    p_organization_id,
    p_artifact_kind,
    'lead_manager.default',
    btrim(p_title),
    next_version,
    'approved',
    p_content_text,
    content_hash,
    btrim(p_provenance_ref),
    actor.actor_membership_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'prompt_artifact_version_id', created_artifact_id,
    'artifact_kind', p_artifact_kind,
    'artifact_key', 'lead_manager.default',
    'title', btrim(p_title),
    'version', next_version,
    'status', 'approved',
    'content_sha256', content_hash,
    'provenance_ref', btrim(p_provenance_ref),
    'approved_by_membership_id', actor.actor_membership_id,
    'input_sha256', input_hash
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'prompt.artifact.publish',
    'ai_prompt_artifact_version',
    created_artifact_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.retire_ai_prompt_artifact_version(
  p_organization_id UUID,
  p_prompt_artifact_version_id UUID,
  p_expected_version BIGINT,
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
  artifact_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  reason_hash TEXT;
  input_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Retire one approved Lead Manager prompt artifact version';
BEGIN
  PERFORM platform_private.lock_bw4_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_prompt_artifact_version_id IS NULL
    OR p_expected_version IS NULL
    OR p_expected_version <= 0
    OR btrim(COALESCE(p_reason, '')) = ''
    OR char_length(p_reason) > 1000
  THEN
    RAISE EXCEPTION 'Artifact, expected version and bounded reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_bw4_admin_actor(p_organization_id);

  reason_hash := encode(
    sha256(convert_to(btrim(p_reason), 'UTF8')),
    'hex'
  );
  input_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'prompt_artifact_version_id', p_prompt_artifact_version_id,
          'expected_version', p_expected_version,
          'reason_sha256', reason_hash,
          'actor_membership_id', actor.actor_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'prompt.artifact.retire',
    'ai_prompt_artifact_version',
    p_prompt_artifact_version_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'prompt_artifact_version_id', p_prompt_artifact_version_id,
      'expected_version', p_expected_version,
      'input_sha256', input_hash,
      'retired_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO artifact_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.id = p_prompt_artifact_version_id
  FOR UPDATE;

  IF artifact_row.id IS NULL THEN
    RAISE EXCEPTION 'Prompt artifact version is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF artifact_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Prompt artifact expected version does not match'
      USING ERRCODE = '40001';
  END IF;
  IF artifact_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved prompt artifact can be retired'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform_private.ai_prompt_artifact_versions AS artifact
  SET
    status = 'retired',
    retired_by_membership_id = actor.actor_membership_id,
    retired_at = statement_timestamp(),
    retirement_reason_sha256 = reason_hash
  WHERE artifact.organization_id = p_organization_id
    AND artifact.id = p_prompt_artifact_version_id;

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'prompt_artifact_version_id', p_prompt_artifact_version_id,
    'artifact_kind', artifact_row.artifact_kind,
    'artifact_key', artifact_row.artifact_key,
    'title', artifact_row.title,
    'version', artifact_row.version,
    'expected_version', p_expected_version,
    'status', 'retired',
    'content_sha256', artifact_row.content_sha256,
    'provenance_ref', artifact_row.provenance_ref,
    'retired_by_membership_id', actor.actor_membership_id,
    'input_sha256', input_hash
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'prompt.artifact.retire',
    'ai_prompt_artifact_version',
    p_prompt_artifact_version_id,
    jsonb_build_object(
      'version', artifact_row.version,
      'status', artifact_row.status,
      'content_sha256', artifact_row.content_sha256
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.admin_ai_prompt_artifact_catalog(
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  artifacts JSONB;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_bw4_admin_actor(p_organization_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'prompt_artifact_version_id', artifact.id,
        'artifact_kind', artifact.artifact_kind,
        'artifact_key', artifact.artifact_key,
        'title', artifact.title,
        'version', artifact.version,
        'status', artifact.status,
        'content_text', artifact.content_text,
        'content_sha256', artifact.content_sha256,
        'provenance_ref', artifact.provenance_ref,
        'approved_at', artifact.approved_at,
        'retired_at', artifact.retired_at,
        'created_at', artifact.created_at
      )
      ORDER BY artifact.artifact_kind, artifact.version DESC
    ),
    '[]'::JSONB
  )
  INTO artifacts
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_key = 'lead_manager.default';

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'artifact_key', 'lead_manager.default',
    'artifacts', artifacts
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.create_decision_backlog_entry(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_student_case_id UUID,
  p_question TEXT,
  p_owner_role platform.business_role,
  p_affected_requirement_kind platform.decision_requirement_kind,
  p_affected_requirement_id UUID,
  p_affected_requirement_field platform.student_profile_field,
  p_source_registry_id UUID,
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
  conversation_row platform.communication_conversations%ROWTYPE;
  created_backlog_id UUID := gen_random_uuid();
  created_version_id UUID := gen_random_uuid();
  input_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Create one unresolved conversation decision backlog entry';
BEGIN
  PERFORM platform_private.lock_bw4_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR btrim(COALESCE(p_question, '')) = ''
    OR char_length(p_question) > 2000
    OR p_owner_role IS NULL
    OR p_owner_role NOT IN ('admin', 'sales', 'curator')
    OR p_affected_requirement_kind IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
    OR char_length(p_reason) > 1000
    OR (p_source_registry_id IS NULL) <> (p_evidence_ref IS NULL)
    OR (
      p_evidence_ref IS NOT NULL
      AND (
        btrim(p_evidence_ref) = ''
        OR char_length(p_evidence_ref) > 1000
      )
    )
  THEN
    RAISE EXCEPTION 'Bounded unresolved decision input is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'decision.manage'
  );

  IF actor.actor_role <> 'admin' AND p_owner_role <> actor.actor_role THEN
    RAISE EXCEPTION 'Decision owner role exceeds the actor authority'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open'
  FOR UPDATE;

  IF conversation_row.id IS NULL THEN
    RAISE EXCEPTION 'Open communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF conversation_row.student_case_id IS DISTINCT FROM p_student_case_id THEN
    RAISE EXCEPTION 'Decision case must match the live conversation case'
      USING ERRCODE = '42501';
  END IF;

  input_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'conversation_id', p_conversation_id,
          'student_case_id', p_student_case_id,
          'question', btrim(p_question),
          'owner_role', p_owner_role,
          'affected_requirement_kind', p_affected_requirement_kind,
          'affected_requirement_id', p_affected_requirement_id,
          'affected_requirement_field', p_affected_requirement_field,
          'source_registry_id', p_source_registry_id,
          'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
          'reason', btrim(p_reason),
          'actor_membership_id', actor.actor_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'decision.backlog.create',
    'decision_backlog',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'student_case_id', p_student_case_id,
      'effective_version', 1,
      'status', 'unresolved',
      'input_sha256', input_hash,
      'created_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'input_sha256' - 'created_by_membership_id';
  END IF;

  INSERT INTO platform.decision_backlogs (
    id,
    organization_id,
    conversation_id,
    student_case_id,
    created_by_profile_id,
    created_by_membership_id
  )
  VALUES (
    created_backlog_id,
    p_organization_id,
    p_conversation_id,
    p_student_case_id,
    actor.actor_profile_id,
    actor.actor_membership_id
  );

  INSERT INTO platform.decision_backlog_versions (
    id,
    organization_id,
    conversation_id,
    decision_backlog_id,
    effective_version,
    question,
    answer,
    owner_role,
    status,
    affected_requirement_kind,
    affected_requirement_id,
    affected_requirement_field,
    source_registry_id,
    evidence_ref,
    input_sha256,
    created_by_profile_id,
    created_by_membership_id,
    request_id
  )
  VALUES (
    created_version_id,
    p_organization_id,
    p_conversation_id,
    created_backlog_id,
    1,
    btrim(p_question),
    NULL,
    p_owner_role,
    'unresolved',
    p_affected_requirement_kind,
    p_affected_requirement_id,
    p_affected_requirement_field,
    p_source_registry_id,
    NULLIF(btrim(p_evidence_ref), ''),
    input_hash,
    actor.actor_profile_id,
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'student_case_id', p_student_case_id,
    'decision_backlog_id', created_backlog_id,
    'decision_backlog_version_id', created_version_id,
    'effective_version', 1,
    'status', 'unresolved'
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'decision.backlog.create',
    'decision_backlog',
    created_backlog_id,
    NULL,
    result || jsonb_build_object(
      'input_sha256', input_hash,
      'created_by_membership_id', actor.actor_membership_id
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.transition_decision_backlog_entry(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_decision_backlog_id UUID,
  p_expected_effective_version BIGINT,
  p_new_status platform.decision_backlog_status,
  p_question TEXT,
  p_answer TEXT,
  p_owner_role platform.business_role,
  p_affected_requirement_kind platform.decision_requirement_kind,
  p_affected_requirement_id UUID,
  p_affected_requirement_field platform.student_profile_field,
  p_source_registry_id UUID,
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
  conversation_row platform.communication_conversations%ROWTYPE;
  backlog_row platform.decision_backlogs%ROWTYPE;
  current_version platform.decision_backlog_versions%ROWTYPE;
  created_version_id UUID := gen_random_uuid();
  next_version BIGINT;
  input_hash TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Append one effective conversation decision version';
BEGIN
  PERFORM platform_private.lock_bw4_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_decision_backlog_id IS NULL
    OR p_expected_effective_version IS NULL
    OR p_expected_effective_version <= 0
    OR p_new_status IS NULL
    OR btrim(COALESCE(p_question, '')) = ''
    OR char_length(p_question) > 2000
    OR p_owner_role IS NULL
    OR p_owner_role NOT IN ('admin', 'sales', 'curator')
    OR p_affected_requirement_kind IS NULL
    OR btrim(COALESCE(p_reason, '')) = ''
    OR char_length(p_reason) > 1000
    OR (p_source_registry_id IS NULL) <> (p_evidence_ref IS NULL)
    OR (
      p_evidence_ref IS NOT NULL
      AND (
        btrim(p_evidence_ref) = ''
        OR char_length(p_evidence_ref) > 1000
      )
    )
    OR (
      p_answer IS NOT NULL
      AND (
        btrim(p_answer) = ''
        OR char_length(p_answer) > 8000
      )
    )
    OR (
      p_new_status = 'answered'
      AND (
        p_answer IS NULL
        OR p_source_registry_id IS NULL
        OR p_evidence_ref IS NULL
      )
    )
    OR (p_new_status = 'unresolved' AND p_answer IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Bounded decision transition input is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'decision.manage'
  );

  IF actor.actor_role <> 'admin' AND p_owner_role <> actor.actor_role THEN
    RAISE EXCEPTION 'Decision owner role exceeds the actor authority'
      USING ERRCODE = '42501';
  END IF;

  input_hash := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'conversation_id', p_conversation_id,
          'decision_backlog_id', p_decision_backlog_id,
          'expected_effective_version', p_expected_effective_version,
          'new_status', p_new_status,
          'question', btrim(p_question),
          'answer', NULLIF(btrim(p_answer), ''),
          'owner_role', p_owner_role,
          'affected_requirement_kind', p_affected_requirement_kind,
          'affected_requirement_id', p_affected_requirement_id,
          'affected_requirement_field', p_affected_requirement_field,
          'source_registry_id', p_source_registry_id,
          'evidence_ref', NULLIF(btrim(p_evidence_ref), ''),
          'reason', btrim(p_reason),
          'actor_membership_id', actor.actor_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'decision.backlog.transition',
    'decision_backlog',
    p_decision_backlog_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'decision_backlog_id', p_decision_backlog_id,
      'previous_effective_version', p_expected_effective_version,
      'status', p_new_status,
      'input_sha256', input_hash,
      'created_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'input_sha256' - 'created_by_membership_id';
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open';

  SELECT *
  INTO backlog_row
  FROM platform.decision_backlogs AS backlog
  WHERE backlog.organization_id = p_organization_id
    AND backlog.id = p_decision_backlog_id
    AND backlog.conversation_id = p_conversation_id
  FOR UPDATE;

  IF conversation_row.id IS NULL OR backlog_row.id IS NULL THEN
    RAISE EXCEPTION 'Decision backlog is unavailable'
      USING ERRCODE = '42501';
  END IF;
  IF backlog_row.student_case_id IS NOT NULL
    AND backlog_row.student_case_id IS DISTINCT FROM
      conversation_row.student_case_id
  THEN
    RAISE EXCEPTION 'Decision backlog no longer matches the live conversation case'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO current_version
  FROM platform.decision_backlog_versions AS version
  WHERE version.organization_id = p_organization_id
    AND version.decision_backlog_id = p_decision_backlog_id
  ORDER BY version.effective_version DESC
  LIMIT 1;

  IF current_version.id IS NULL THEN
    RAISE EXCEPTION 'Decision backlog has no effective version'
      USING ERRCODE = '55000';
  END IF;
  IF current_version.effective_version <> p_expected_effective_version THEN
    RAISE EXCEPTION 'Decision expected effective version does not match'
      USING ERRCODE = '40001';
  END IF;
  IF NOT (
    (current_version.status = 'unresolved' AND p_new_status IN ('answered', 'retired'))
    OR (current_version.status = 'answered' AND p_new_status IN ('unresolved', 'retired'))
  ) THEN
    RAISE EXCEPTION 'Decision status transition is not allowed'
      USING ERRCODE = '22023';
  END IF;

  IF p_new_status = 'retired'
    AND (
      btrim(p_question) IS DISTINCT FROM current_version.question
      OR p_answer IS DISTINCT FROM current_version.answer
      OR p_owner_role IS DISTINCT FROM current_version.owner_role
      OR p_affected_requirement_kind IS DISTINCT FROM
        current_version.affected_requirement_kind
      OR p_affected_requirement_id IS DISTINCT FROM
        current_version.affected_requirement_id
      OR p_affected_requirement_field IS DISTINCT FROM
        current_version.affected_requirement_field
      OR p_source_registry_id IS DISTINCT FROM
        current_version.source_registry_id
      OR NULLIF(btrim(p_evidence_ref), '') IS DISTINCT FROM
        current_version.evidence_ref
    )
  THEN
    RAISE EXCEPTION 'Retirement must preserve the prior decision snapshot'
      USING ERRCODE = '22023';
  END IF;

  next_version := current_version.effective_version + 1;

  INSERT INTO platform.decision_backlog_versions (
    id,
    organization_id,
    conversation_id,
    decision_backlog_id,
    effective_version,
    question,
    answer,
    owner_role,
    status,
    affected_requirement_kind,
    affected_requirement_id,
    affected_requirement_field,
    source_registry_id,
    evidence_ref,
    input_sha256,
    created_by_profile_id,
    created_by_membership_id,
    request_id
  )
  VALUES (
    created_version_id,
    p_organization_id,
    p_conversation_id,
    p_decision_backlog_id,
    next_version,
    btrim(p_question),
    NULLIF(btrim(p_answer), ''),
    p_owner_role,
    p_new_status,
    p_affected_requirement_kind,
    p_affected_requirement_id,
    p_affected_requirement_field,
    p_source_registry_id,
    NULLIF(btrim(p_evidence_ref), ''),
    input_hash,
    actor.actor_profile_id,
    actor.actor_membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'student_case_id', backlog_row.student_case_id,
    'decision_backlog_id', p_decision_backlog_id,
    'decision_backlog_version_id', created_version_id,
    'previous_effective_version', current_version.effective_version,
    'previous_status', current_version.status,
    'effective_version', next_version,
    'status', p_new_status
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'decision.backlog.transition',
    'decision_backlog',
    p_decision_backlog_id,
    jsonb_build_object(
      'effective_version', current_version.effective_version,
      'status', current_version.status,
      'source_registry_id', current_version.source_registry_id
    ),
    result || jsonb_build_object(
      'input_sha256', input_hash,
      'created_by_membership_id', actor.actor_membership_id,
      'source_registry_id', p_source_registry_id
    ),
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Migration 050 removed the superseded six-argument request_ai_draft RPC.
-- Its public staff successor keeps the exact seven-argument signature while
-- adding immutable prompt-policy and business-context pins.
CREATE OR REPLACE FUNCTION platform.request_ai_draft_with_knowledge(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_requested_language platform.ai_draft_language,
  p_selected_knowledge_version_id UUID,
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
  conversation_row platform.communication_conversations%ROWTYPE;
  source_message_row platform.communication_messages%ROWTYPE;
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  policy_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  context_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  health RECORD;
  child_request_id UUID;
  child_enqueue_request_id UUID;
  child_prompt_selection_request_id UUID;
  created_request_id UUID := gen_random_uuid();
  selection_row platform.ai_draft_request_knowledge_selections%ROWTYPE;
  enqueue_result JSONB;
  business_key_sha256 TEXT;
  request_input_sha256 TEXT;
  replayed JSONB;
  request_result JSONB;
  result JSONB;
  request_audit_reason CONSTANT TEXT :=
    'Create one staff-requested draft for the latest inbound cycle';
  selection_audit_reason CONSTANT TEXT :=
    'Pin approved knowledge and prompt artifacts for one AI draft request';
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_source_message_id IS NULL
    OR p_selected_knowledge_version_id IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR char_length(p_reason) > 1000
  THEN
    RAISE EXCEPTION
      'Current source, approved knowledge and bounded explicit reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.request'
  );

  request_input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'communication_conversation_id', p_conversation_id,
          'source_message_id', p_source_message_id,
          'requested_language', p_requested_language,
          'selected_knowledge_version_id', p_selected_knowledge_version_id,
          'reason', btrim(p_reason),
          'selected_by_membership_id', actor.actor_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.request.knowledge',
    'ai_draft_request_knowledge_selection',
    NULL,
    selection_audit_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'requested_language', p_requested_language,
      'selected_knowledge_version_id', p_selected_knowledge_version_id,
      'selected_by_membership_id', actor.actor_membership_id,
      'request_input_sha256', request_input_sha256
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed - 'request_input_sha256';
  END IF;

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open'
  FOR UPDATE;

  SELECT *
  INTO source_message_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.id = p_source_message_id
    AND message.conversation_id = p_conversation_id
    AND message.direction = 'inbound';

  IF conversation_row.id IS NULL
    OR source_message_row.id IS NULL
    OR EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = p_organization_id
        AND later_message.conversation_id = p_conversation_id
        AND later_message.direction = 'inbound'
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          source_message_row.created_at,
          source_message_row.id
        )
    )
  THEN
    RAISE EXCEPTION
      'AI draft source must be the latest inbound message in an open conversation'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO health
  FROM platform_private.require_ready_messaging_integration(
    p_organization_id,
    'ai'
  );

  SELECT *
  INTO knowledge_row
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.id = p_selected_knowledge_version_id
    AND knowledge.status = 'approved';

  IF knowledge_row.id IS NULL THEN
    RAISE EXCEPTION 'Selected approved knowledge is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO policy_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_kind = 'prompt_policy'
    AND artifact.artifact_key = 'lead_manager.default'
    AND artifact.status = 'approved'
  ORDER BY artifact.version DESC
  LIMIT 1
  FOR SHARE;

  SELECT *
  INTO context_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_kind = 'business_context'
    AND artifact.artifact_key = 'lead_manager.default'
    AND artifact.status = 'approved'
  ORDER BY artifact.version DESC
  LIMIT 1
  FOR SHARE;

  IF policy_row.id IS NULL OR context_row.id IS NULL THEN
    RAISE EXCEPTION
      'Approved prompt-policy and business-context artifacts are required'
      USING ERRCODE = '55000';
  END IF;

  child_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'request-ai-draft'
  );
  child_enqueue_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'enqueue-ai-draft'
  );
  child_prompt_selection_request_id :=
    platform_private.p3c_request_child_id(
      p_request_id,
      'select-ai-prompt-artifacts'
    );

  INSERT INTO platform.ai_draft_requests (
    id,
    organization_id,
    conversation_id,
    student_case_id,
    source_message_id,
    requested_language,
    requested_by_profile_id,
    requested_by_membership_id,
    reason,
    request_id
  )
  VALUES (
    created_request_id,
    p_organization_id,
    p_conversation_id,
    conversation_row.student_case_id,
    p_source_message_id,
    p_requested_language,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    child_request_id
  );

  request_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_request_id', created_request_id,
    'communication_conversation_id', p_conversation_id,
    'source_message_id', p_source_message_id,
    'requested_language', p_requested_language,
    'requested_by_membership_id', actor.actor_membership_id,
    'request_input_sha256', request_input_sha256
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.draft.request',
    'ai_draft_request',
    created_request_id,
    NULL,
    request_result,
    request_audit_reason,
    child_request_id
  );

  INSERT INTO platform.ai_draft_request_knowledge_selections (
    organization_id,
    conversation_id,
    ai_draft_request_id,
    selected_knowledge_version_id,
    selected_by_profile_id,
    selected_by_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    created_request_id,
    p_selected_knowledge_version_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  )
  RETURNING * INTO selection_row;

  INSERT INTO platform.ai_draft_request_prompt_selections (
    organization_id,
    conversation_id,
    ai_draft_request_id,
    prompt_policy_artifact_version_id,
    business_context_artifact_version_id,
    selected_by_profile_id,
    selected_by_membership_id,
    request_id
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    created_request_id,
    policy_row.id,
    context_row.id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    child_prompt_selection_request_id
  );

  business_key_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'communication_conversation_id', p_conversation_id,
          'source_message_id', p_source_message_id,
          'requested_language', p_requested_language,
          'selected_knowledge_version_id', p_selected_knowledge_version_id,
          'prompt_policy_artifact_version_id', policy_row.id,
          'business_context_artifact_version_id', context_row.id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  enqueue_result := platform_private.p3c_enqueue_authenticated_work(
    p_organization_id,
    'ai_draft_generate',
    created_request_id,
    NULL,
    business_key_sha256,
    1,
    child_enqueue_request_id,
    'enqueue_ai_draft',
    actor.actor_profile_id,
    actor.actor_auth_user_id,
    'Enqueue one AI draft generation for the exact current inbound cycle'
  );

  result := (request_result - 'request_input_sha256') || jsonb_build_object(
    'selected_knowledge_version_id', p_selected_knowledge_version_id,
    'selected_knowledge_key', knowledge_row.knowledge_key,
    'selected_knowledge_version', knowledge_row.version,
    'selected_by_membership_id', actor.actor_membership_id,
    'prompt_policy_artifact_version_id', policy_row.id,
    'prompt_policy_title', policy_row.title,
    'prompt_policy_version',
      platform_private.ai_prompt_compatibility_snapshot(
        policy_row.artifact_key,
        policy_row.version
      ),
    'prompt_policy_content_sha256', policy_row.content_sha256,
    'business_context_artifact_version_id', context_row.id,
    'business_context_title', context_row.title,
    'business_context_version', context_row.version,
    'business_context_content_sha256', context_row.content_sha256,
    'work_item_id', enqueue_result -> 'work_item_id',
    'work_state', enqueue_result -> 'state',
    'queue_message_id', enqueue_result -> 'queue_message_id',
    'business_key_sha256', business_key_sha256,
    'ai_readiness', health.readiness,
    'ai_readiness_evidence_kind', health.evidence_kind,
    'ai_readiness_fresh', TRUE,
    'ai_readiness_observed_at', health.observed_at
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
    actor.actor_profile_id,
    actor.actor_auth_user_id::TEXT,
    'ai.draft.request.knowledge',
    'ai_draft_request_knowledge_selection',
    selection_row.id,
    NULL,
    result || jsonb_build_object(
      'request_input_sha256', request_input_sha256
    ),
    selection_audit_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.complete_ai_draft_generation(
  p_organization_id UUID,
  p_ai_draft_id UUID,
  p_knowledge_version_id UUID,
  p_generated_text TEXT,
  p_provider_ref TEXT,
  p_model_ref TEXT,
  p_prompt_policy_version TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  draft_row platform.ai_drafts%ROWTYPE;
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  knowledge_selection_row
    platform.ai_draft_request_knowledge_selections%ROWTYPE;
  prompt_selection_row
    platform.ai_draft_request_prompt_selections%ROWTYPE;
  policy_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  context_row platform_private.ai_prompt_artifact_versions%ROWTYPE;
  generated_hash TEXT;
  expected_prompt_policy_snapshot TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Complete generation only after explicit human RU or EN selection';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role is required' USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_ai_draft_id IS NULL
    OR p_knowledge_version_id IS NULL
    OR p_generated_text IS NULL
    OR btrim(p_generated_text) = ''
    OR p_provider_ref IS NULL
    OR btrim(p_provider_ref) = ''
    OR char_length(p_provider_ref) > 200
    OR p_model_ref IS NULL
    OR btrim(p_model_ref) = ''
    OR char_length(p_model_ref) > 200
    OR p_prompt_policy_version IS NULL
    OR btrim(p_prompt_policy_version) = ''
    OR char_length(p_prompt_policy_version) > 200
  THEN
    RAISE EXCEPTION
      'Pinned knowledge, provider metadata and generated text are required'
      USING ERRCODE = '22023';
  END IF;

  generated_hash := encode(
    sha256(convert_to(p_generated_text, 'UTF8')),
    'hex'
  );

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id;

  IF draft_row.id IS NULL THEN
    RAISE EXCEPTION 'AI draft is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO knowledge_selection_row
  FROM platform.ai_draft_request_knowledge_selections AS selection
  WHERE selection.organization_id = p_organization_id
    AND selection.ai_draft_request_id = draft_row.ai_draft_request_id;

  SELECT *
  INTO prompt_selection_row
  FROM platform.ai_draft_request_prompt_selections AS selection
  WHERE selection.organization_id = p_organization_id
    AND selection.ai_draft_request_id = draft_row.ai_draft_request_id;

  SELECT *
  INTO policy_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.id = prompt_selection_row.prompt_policy_artifact_version_id
    AND artifact.artifact_kind = 'prompt_policy'
    AND artifact.artifact_key = 'lead_manager.default';

  SELECT *
  INTO context_row
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.id = prompt_selection_row.business_context_artifact_version_id
    AND artifact.artifact_kind = 'business_context'
    AND artifact.artifact_key = 'lead_manager.default';

  IF knowledge_selection_row.id IS NULL
    OR prompt_selection_row.id IS NULL
    OR policy_row.id IS NULL
    OR context_row.id IS NULL
  THEN
    RAISE EXCEPTION 'Authoritative AI draft request pins are unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF knowledge_selection_row.selected_knowledge_version_id <>
      p_knowledge_version_id
    OR draft_row.prompt_policy_artifact_version_id <>
      prompt_selection_row.prompt_policy_artifact_version_id
    OR draft_row.business_context_artifact_version_id <>
      prompt_selection_row.business_context_artifact_version_id
  THEN
    RAISE EXCEPTION 'AI generation inputs do not match the request pins'
      USING ERRCODE = '22023';
  END IF;

  expected_prompt_policy_snapshot :=
    platform_private.ai_prompt_compatibility_snapshot(
      policy_row.artifact_key,
      policy_row.version
    );

  IF btrim(p_prompt_policy_version) <>
      expected_prompt_policy_snapshot
  THEN
    RAISE EXCEPTION 'Legacy prompt-policy snapshot does not match request pin'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.generate',
    'ai_draft',
    p_ai_draft_id,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'knowledge_version_id', p_knowledge_version_id,
      'prompt_policy_artifact_version_id', policy_row.id,
      'business_context_artifact_version_id', context_row.id,
      'provider_ref', btrim(p_provider_ref),
      'model_ref', btrim(p_model_ref),
      'prompt_policy_version', expected_prompt_policy_snapshot,
      'generated_text_sha256', generated_hash,
      'state', 'review_required'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  SELECT *
  INTO knowledge_row
  FROM platform.approved_knowledge_versions AS knowledge
  WHERE knowledge.organization_id = p_organization_id
    AND knowledge.id = p_knowledge_version_id;

  IF draft_row.id IS NULL
    OR draft_row.state <> 'language_selected'
    OR draft_row.detection_status <> 'uncertain'
    OR draft_row.selected_language IS NULL
    OR knowledge_row.id IS NULL
    OR draft_row.prompt_policy_artifact_version_id <> policy_row.id
    OR draft_row.business_context_artifact_version_id <> context_row.id
  THEN
    RAISE EXCEPTION
      'Human-selected draft and its authoritative request pins are required'
      USING ERRCODE = '55000';
  END IF;

  UPDATE platform.ai_drafts
  SET
    knowledge_version_id = p_knowledge_version_id,
    prompt_policy_artifact_version_id = policy_row.id,
    business_context_artifact_version_id = context_row.id,
    provider_ref = btrim(p_provider_ref),
    model_ref = btrim(p_model_ref),
    prompt_policy_version = expected_prompt_policy_snapshot,
    generated_text = p_generated_text,
    generated_text_sha256 = generated_hash,
    failure_outcome = NULL,
    state = 'review_required'
  WHERE organization_id = p_organization_id
    AND id = p_ai_draft_id;

  INSERT INTO platform.ai_draft_knowledge_citations (
    organization_id,
    conversation_id,
    ai_draft_id,
    knowledge_version_id,
    citation_order,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    p_knowledge_version_id,
    1,
    p_request_id
  );

  INSERT INTO platform.ai_draft_events (
    organization_id,
    conversation_id,
    ai_draft_id,
    event_type,
    previous_state,
    new_state,
    selected_language,
    knowledge_version_id,
    review_decision,
    content_text,
    actor_kind,
    actor_profile_id,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    draft_row.conversation_id,
    p_ai_draft_id,
    'generation_completed',
    draft_row.state,
    'review_required',
    draft_row.selected_language,
    p_knowledge_version_id,
    NULL,
    p_generated_text,
    'service',
    NULL,
    NULL,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'ai_draft_id', p_ai_draft_id,
    'knowledge_version_id', p_knowledge_version_id,
    'prompt_policy_artifact_version_id', policy_row.id,
    'business_context_artifact_version_id', context_row.id,
    'provider_ref', btrim(p_provider_ref),
    'model_ref', btrim(p_model_ref),
    'prompt_policy_version', expected_prompt_policy_snapshot,
    'generated_text_sha256', generated_hash,
    'state', 'review_required'
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
    'service',
    NULL,
    'service:platform-draft-worker',
    'ai.draft.generate',
    'ai_draft',
    p_ai_draft_id,
    jsonb_build_object(
      'state', draft_row.state,
      'failure_outcome', draft_row.failure_outcome,
      'prompt_policy_artifact_version_id',
        draft_row.prompt_policy_artifact_version_id,
      'business_context_artifact_version_id',
        draft_row.business_context_artifact_version_id
    ),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.safe_ai_prompt_artifact_metadata(
  p_organization_id UUID,
  p_prompt_artifact_version_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'prompt_artifact_version_id', artifact.id,
    'artifact_kind', artifact.artifact_kind,
    'artifact_key', artifact.artifact_key,
    'title', artifact.title,
    'version', artifact.version,
    'status', artifact.status,
    'content_sha256', artifact.content_sha256,
    'provenance_ref', artifact.provenance_ref,
    'approved_at', artifact.approved_at
  )
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.id = p_prompt_artifact_version_id
$$;

REVOKE ALL ON FUNCTION
  platform_private.safe_ai_prompt_artifact_metadata(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_conversation_bw4_workspace(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  conversation_row platform.communication_conversations%ROWTYPE;
  can_manage BOOLEAN;
  allowed_owner_roles JSONB;
  handoff JSONB;
  available_requirements JSONB;
  reviewed_sources JSONB;
  active_policy JSONB;
  active_context JSONB;
  pinned_prompts JSONB;
  decisions JSONB;
BEGIN
  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'decision.read'
  );

  SELECT *
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;

  IF conversation_row.id IS NULL THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  can_manage := private.platform_has_permission(
    p_organization_id,
    'decision.manage'
  );
  allowed_owner_roles := CASE actor.actor_role
    WHEN 'admin' THEN to_jsonb(ARRAY['admin', 'sales', 'curator']::TEXT[])
    WHEN 'sales' THEN to_jsonb(ARRAY['sales']::TEXT[])
    WHEN 'curator' THEN to_jsonb(ARRAY['curator']::TEXT[])
    ELSE '[]'::JSONB
  END;

  SELECT jsonb_build_object(
    'handoff_id', case_handoff.id,
    'student_case_id', case_handoff.student_case_id,
    'op_workflow_contract_id', case_handoff.op_workflow_contract_id,
    'op_workflow_contract_version_id',
      case_handoff.op_workflow_contract_version_id,
    'ozo_workflow_contract_id', case_handoff.ozo_workflow_contract_id,
    'ozo_workflow_contract_version_id',
      case_handoff.ozo_workflow_contract_version_id,
    'approved_commercial_fields', case_handoff.approved_commercial_fields,
    'unresolved_questions', case_handoff.unresolved_questions,
    'promises', case_handoff.promises,
    'next_step', case_handoff.next_step,
    'due_at', case_handoff.due_at,
    'responsible_role', case_handoff.responsible_role,
    'created_at', case_handoff.created_at
  )
  INTO handoff
  FROM platform.student_case_op_handoffs AS case_handoff
  WHERE case_handoff.organization_id = p_organization_id
    AND case_handoff.student_case_id = conversation_row.student_case_id;

  -- Only stable operator taxonomy is exposed here. Country labels are built
  -- from the approved route definition; document labels come from the
  -- requirement catalog, never from uploaded document or customer content.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'requirement_kind', requirement.requirement_kind,
        'requirement_id', requirement.requirement_id,
        'label', requirement.label
      )
      ORDER BY
        requirement.requirement_kind,
        requirement.label,
        requirement.requirement_id
    ),
    '[]'::JSONB
  )
  INTO available_requirements
  FROM (
    SELECT
      'country_requirement'::TEXT AS requirement_kind,
      country_version.id AS requirement_id,
      left(
        format(
          '%s - %s - %s (v%s)',
          country_version.target_country,
          country_version.target_degree,
          country_version.program_direction,
          country_version.version
        ),
        240
      ) AS label
    FROM platform.student_cases AS student_case
    JOIN platform.country_requirement_versions AS country_version
      ON country_version.organization_id = student_case.organization_id
      AND country_version.id =
        student_case.applied_country_requirement_version_id
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = conversation_row.student_case_id

    UNION ALL

    SELECT
      'document_requirement'::TEXT AS requirement_kind,
      document_requirement.id AS requirement_id,
      left(
        COALESCE(
          NULLIF(
            btrim(
              regexp_replace(
                document_requirement.label,
                '[[:cntrl:]]+',
                ' ',
                'g'
              )
            ),
            ''
          ),
          document_requirement.requirement_key
        ),
        240
      ) AS label
    FROM platform.document_slots AS slot
    JOIN platform.document_requirements AS document_requirement
      ON document_requirement.organization_id = slot.organization_id
      AND document_requirement.id = slot.requirement_id
    WHERE slot.organization_id = p_organization_id
      AND slot.student_case_id = conversation_row.student_case_id
  ) AS requirement;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'source_registry_id', source.id,
        'source_key', source.source_key,
        'source_kind', source.source_kind,
        'source_url', source.source_url,
        'source_revision', source.source_revision,
        'review_status', source.review_status,
        'reviewed_at', source.reviewed_at
      )
      ORDER BY source.reviewed_at DESC, source.id
    ),
    '[]'::JSONB
  )
  INTO reviewed_sources
  FROM platform.source_registry AS source
  WHERE source.organization_id = p_organization_id
    AND (
      source.review_status = 'reviewed'
      OR (
        source.review_status = 'retired'
        AND EXISTS (
          SELECT 1
          FROM platform.decision_backlog_versions AS decision_version
          JOIN platform.decision_backlogs AS decision_backlog
            ON decision_backlog.organization_id =
              decision_version.organization_id
            AND decision_backlog.id =
              decision_version.decision_backlog_id
          WHERE decision_version.organization_id = p_organization_id
            AND decision_version.source_registry_id = source.id
            AND decision_backlog.conversation_id = p_conversation_id
        )
      )
    );

  SELECT platform_private.safe_ai_prompt_artifact_metadata(
    artifact.organization_id,
    artifact.id
  )
  INTO active_policy
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_kind = 'prompt_policy'
    AND artifact.artifact_key = 'lead_manager.default'
    AND artifact.status = 'approved'
  ORDER BY artifact.version DESC
  LIMIT 1;

  SELECT platform_private.safe_ai_prompt_artifact_metadata(
    artifact.organization_id,
    artifact.id
  )
  INTO active_context
  FROM platform_private.ai_prompt_artifact_versions AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.artifact_kind = 'business_context'
    AND artifact.artifact_key = 'lead_manager.default'
    AND artifact.status = 'approved'
  ORDER BY artifact.version DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'ai_draft_request_id', selection.ai_draft_request_id,
    'selected_at', selection.selected_at,
    'prompt_policy',
      platform_private.safe_ai_prompt_artifact_metadata(
        selection.organization_id,
        selection.prompt_policy_artifact_version_id
      ),
    'business_context',
      platform_private.safe_ai_prompt_artifact_metadata(
        selection.organization_id,
        selection.business_context_artifact_version_id
      )
  )
  INTO pinned_prompts
  FROM platform.ai_draft_request_prompt_selections AS selection
  WHERE selection.organization_id = p_organization_id
    AND selection.conversation_id = p_conversation_id
  ORDER BY selection.selected_at DESC, selection.id DESC
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'decision_backlog_id', backlog.id,
        'current_effective_version', (
          SELECT MAX(version.effective_version)
          FROM platform.decision_backlog_versions AS version
          WHERE version.organization_id = backlog.organization_id
            AND version.decision_backlog_id = backlog.id
        ),
        'versions', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'decision_backlog_version_id', version.id,
                'effective_version', version.effective_version,
                'question', version.question,
                'answer', version.answer,
                'owner_role', version.owner_role,
                'status', version.status,
                'affected_requirement_kind',
                  version.affected_requirement_kind,
                'affected_requirement_id', version.affected_requirement_id,
                'affected_requirement_field',
                  version.affected_requirement_field,
                'source_registry_id', version.source_registry_id,
                'evidence_ref', version.evidence_ref,
                'created_at', version.created_at
              )
              ORDER BY version.effective_version
            ),
            '[]'::JSONB
          )
          FROM platform.decision_backlog_versions AS version
          WHERE version.organization_id = backlog.organization_id
            AND version.decision_backlog_id = backlog.id
        )
      )
      ORDER BY backlog.created_at, backlog.id
    ),
    '[]'::JSONB
  )
  INTO decisions
  FROM platform.decision_backlogs AS backlog
  WHERE backlog.organization_id = p_organization_id
    AND backlog.conversation_id = p_conversation_id;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'conversation_id', p_conversation_id,
    'student_case_id', conversation_row.student_case_id,
    'actor_role', actor.actor_role,
    'can_manage_decisions', can_manage,
    'allowed_owner_roles', allowed_owner_roles,
    'handoff', handoff,
    'available_requirements', available_requirements,
    'reviewed_sources', reviewed_sources,
    'active_prompt_artifacts', jsonb_build_object(
      'prompt_policy', active_policy,
      'business_context', active_context
    ),
    'pinned_prompt_artifacts', pinned_prompts,
    'decisions', decisions
  );
END
$$;

CREATE POLICY ai_draft_request_prompt_selections_full_read
  ON platform.ai_draft_request_prompt_selections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

-- Decision history is exposed only through the hardened workspace RPC. The
-- prompt selection relation may be read directly under the existing full
-- communication object scope; every write remains RPC-only.
REVOKE ALL PRIVILEGES ON TABLE
  platform_private.ai_prompt_artifact_versions,
  platform.ai_draft_request_prompt_selections,
  platform.decision_backlogs,
  platform.decision_backlog_versions
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE platform.ai_draft_request_prompt_selections
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.publish_ai_prompt_artifact_version(
    UUID,
    platform.ai_prompt_artifact_kind,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.retire_ai_prompt_artifact_version(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    UUID
  ),
  platform.admin_ai_prompt_artifact_catalog(UUID),
  platform.create_decision_backlog_entry(
    UUID,
    UUID,
    UUID,
    TEXT,
    platform.business_role,
    platform.decision_requirement_kind,
    UUID,
    platform.student_profile_field,
    UUID,
    TEXT,
    TEXT,
    UUID
  ),
  platform.transition_decision_backlog_entry(
    UUID,
    UUID,
    UUID,
    BIGINT,
    platform.decision_backlog_status,
    TEXT,
    TEXT,
    platform.business_role,
    platform.decision_requirement_kind,
    UUID,
    platform.student_profile_field,
    UUID,
    TEXT,
    TEXT,
    UUID
  ),
  platform.request_ai_draft_with_knowledge(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    UUID,
    TEXT,
    UUID
  ),
  platform.complete_ai_draft_generation(
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_bw4_workspace(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.publish_ai_prompt_artifact_version(
    UUID,
    platform.ai_prompt_artifact_kind,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.retire_ai_prompt_artifact_version(
    UUID,
    UUID,
    BIGINT,
    TEXT,
    UUID
  ),
  platform.admin_ai_prompt_artifact_catalog(UUID),
  platform.create_decision_backlog_entry(
    UUID,
    UUID,
    UUID,
    TEXT,
    platform.business_role,
    platform.decision_requirement_kind,
    UUID,
    platform.student_profile_field,
    UUID,
    TEXT,
    TEXT,
    UUID
  ),
  platform.transition_decision_backlog_entry(
    UUID,
    UUID,
    UUID,
    BIGINT,
    platform.decision_backlog_status,
    TEXT,
    TEXT,
    platform.business_role,
    platform.decision_requirement_kind,
    UUID,
    platform.student_profile_field,
    UUID,
    TEXT,
    TEXT,
    UUID
  ),
  platform.request_ai_draft_with_knowledge(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    UUID,
    TEXT,
    UUID
  ),
  platform.staff_conversation_bw4_workspace(UUID, UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION platform.complete_ai_draft_generation(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) TO service_role;

COMMENT ON TABLE platform_private.ai_prompt_artifact_versions IS
  'Backend-private, immutable Lead Manager prompt-policy and business-context versions.';
COMMENT ON TABLE platform.ai_draft_request_prompt_selections IS
  'Immutable metadata-only prompt artifact pins for one explicit AI draft request.';
COMMENT ON TABLE platform.decision_backlogs IS
  'Immutable conversation/case identity for one versioned decision backlog entry.';
COMMENT ON TABLE platform.decision_backlog_versions IS
  'Append-only effective Q&A versions; unanswered rows never become silent defaults.';
COMMENT ON COLUMN platform.ai_drafts.prompt_policy_version IS
  'Legacy compatibility snapshot derived from the authoritative prompt-policy artifact pin.';

COMMIT;
