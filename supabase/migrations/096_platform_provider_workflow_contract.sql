-- ============================================================
-- 096_platform_provider_workflow_contract.sql
--
-- P5A: complete the bounded Supabase provider workflow contract needed for
-- the later runtime cutover. This migration does not call Gemini or WAHA.
-- It adds:
--   - an authenticated Gemini request ledger bound to one staff actor;
--   - a service-validated Gemini begin path that must consume that ledger;
--   - an authenticated WhatsApp reconciliation request ledger;
--   - append-only reconciliation results plus one staff-safe latest-attempt
--     read model that computes effective state without mutating immutable
--     durable work history.
-- ============================================================

BEGIN;

CREATE TYPE platform.manual_whatsapp_reconciliation_kind AS ENUM (
  'unknown_recovery',
  'ack_refresh'
);

CREATE TYPE platform.manual_whatsapp_reconciliation_outcome AS ENUM (
  'message_confirmed',
  'message_not_found',
  'delivery_refreshed'
);

CREATE TABLE platform_private.gemini_proposal_request_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  model_ref TEXT NOT NULL CHECK (model_ref = 'gemini-3.7-flash'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  prompt_policy_version TEXT NOT NULL CHECK (
    prompt_policy_version = 'u9-gemini-human-review-v1'
  ),
  requested_by_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  requested_by_membership_id UUID NOT NULL,
  requested_by_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_by_name TEXT NOT NULL CHECK (
    requested_by_name = pg_catalog.btrim(requested_by_name)
    AND pg_catalog.char_length(requested_by_name) BETWEEN 1 AND 200
    AND requested_by_name !~ '[[:cntrl:]]'
  ),
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.char_length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT gemini_proposal_request_receipts_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT gemini_proposal_request_receipts_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_request_receipts_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT gemini_proposal_request_receipts_membership_fkey
    FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX gemini_proposal_request_receipts_latest_idx
  ON platform_private.gemini_proposal_request_receipts (
    organization_id,
    conversation_id,
    created_at DESC,
    id DESC
  );

ALTER TABLE platform_private.gemini_proposal_request_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.gemini_proposal_request_receipts
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER gemini_proposal_request_receipts_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.gemini_proposal_request_receipts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER gemini_proposal_request_receipts_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.gemini_proposal_request_receipts
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

ALTER TABLE platform_private.gemini_proposal_requests
  ADD COLUMN staff_binding_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN staff_request_receipt_id UUID;

-- Rows created before migration 096 remain immutable historical evidence.
-- Every new row defaults to the staff-bound contract below.
ALTER TABLE platform_private.gemini_proposal_requests
  ALTER COLUMN staff_binding_required SET DEFAULT TRUE;

ALTER TABLE platform_private.gemini_proposal_requests
  ADD CONSTRAINT gemini_proposal_requests_staff_receipt_fkey
    FOREIGN KEY (organization_id, staff_request_receipt_id)
    REFERENCES platform_private.gemini_proposal_request_receipts(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT gemini_proposal_requests_staff_receipt_key
    UNIQUE (organization_id, staff_request_receipt_id),
  ADD CONSTRAINT gemini_proposal_requests_staff_binding_shape_check CHECK (
    (
      NOT staff_binding_required
      AND staff_request_receipt_id IS NULL
    )
    OR (
      staff_binding_required
      AND schema_version = 2
      AND staff_request_receipt_id IS NOT NULL
    )
  );

CREATE INDEX gemini_proposal_requests_staff_bound_latest_idx
  ON platform_private.gemini_proposal_requests (
    organization_id,
    created_at DESC,
    id DESC
  )
  WHERE staff_binding_required;

CREATE TABLE platform_private.manual_whatsapp_reconciliation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  manual_send_authorization_id UUID NOT NULL,
  reconciliation_kind platform.manual_whatsapp_reconciliation_kind NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  waha_session_name TEXT NOT NULL CHECK (waha_session_name = 'evo-inbox'),
  recipient_sha256 TEXT NOT NULL CHECK (recipient_sha256 ~ '^[0-9a-f]{64}$'),
  final_text_sha256 TEXT NOT NULL CHECK (final_text_sha256 ~ '^[0-9a-f]{64}$'),
  expected_provider_message_sha256 TEXT CHECK (
    expected_provider_message_sha256 IS NULL
    OR expected_provider_message_sha256 ~ '^[0-9a-f]{64}$'
  ),
  requested_by_profile_id UUID NOT NULL
    REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  requested_by_membership_id UUID NOT NULL,
  requested_by_auth_user_id UUID NOT NULL
    REFERENCES auth.users(id) ON DELETE RESTRICT,
  requested_by_name TEXT NOT NULL CHECK (
    requested_by_name = pg_catalog.btrim(requested_by_name)
    AND pg_catalog.char_length(requested_by_name) BETWEEN 1 AND 200
    AND requested_by_name !~ '[[:cntrl:]]'
  ),
  reason TEXT NOT NULL CHECK (
    reason = pg_catalog.btrim(reason)
    AND pg_catalog.char_length(reason) BETWEEN 1 AND 1000
    AND reason !~ '[[:cntrl:]]'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT manual_whatsapp_reconciliation_requests_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT manual_whatsapp_reconciliation_requests_org_request_key
    UNIQUE (organization_id, request_id),
  CONSTRAINT manual_whatsapp_reconciliation_requests_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_source_message_fkey
    FOREIGN KEY (organization_id, source_message_id, conversation_id)
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_work_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_authorization_fkey
    FOREIGN KEY (organization_id, manual_send_authorization_id, conversation_id)
    REFERENCES platform.manual_send_authorizations(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_membership_fkey
    FOREIGN KEY (organization_id, requested_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_requests_kind_shape_check CHECK (
    (
      reconciliation_kind = 'unknown_recovery'
      AND expected_provider_message_sha256 IS NULL
    )
    OR (
      reconciliation_kind = 'ack_refresh'
      AND expected_provider_message_sha256 IS NOT NULL
    )
  )
);

CREATE INDEX manual_whatsapp_reconciliation_requests_latest_idx
  ON platform_private.manual_whatsapp_reconciliation_requests (
    organization_id,
    attempt_id,
    created_at DESC,
    id DESC
  );

ALTER TABLE platform_private.manual_whatsapp_reconciliation_requests
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.manual_whatsapp_reconciliation_requests
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER manual_whatsapp_reconciliation_requests_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.manual_whatsapp_reconciliation_requests
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER manual_whatsapp_reconciliation_requests_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.manual_whatsapp_reconciliation_requests
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TABLE platform_private.manual_whatsapp_reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  manual_send_authorization_id UUID NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  completion_request_id UUID NOT NULL UNIQUE,
  result_fingerprint TEXT NOT NULL CHECK (
    result_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  reconciliation_kind platform.manual_whatsapp_reconciliation_kind NOT NULL,
  outcome platform.manual_whatsapp_reconciliation_outcome NOT NULL,
  communication_message_id UUID,
  waha_session_name TEXT NOT NULL CHECK (waha_session_name = 'evo-inbox'),
  recipient_sha256 TEXT NOT NULL CHECK (recipient_sha256 ~ '^[0-9a-f]{64}$'),
  final_text_sha256 TEXT NOT NULL CHECK (final_text_sha256 ~ '^[0-9a-f]{64}$'),
  provider_message_id TEXT CHECK (
    provider_message_id IS NULL
    OR (
      provider_message_id = pg_catalog.btrim(provider_message_id)
      AND pg_catalog.char_length(provider_message_id) BETWEEN 1 AND 512
      AND provider_message_id ~ '^[ -~]+$'
    )
  ),
  provider_source TEXT CHECK (
    provider_source IS NULL OR provider_source IN ('api', 'app')
  ),
  ack_state platform.waha_ack_state,
  provider_observed_at TIMESTAMPTZ,
  ack_observed_at TIMESTAMPTZ,
  work_review_case_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT manual_whatsapp_reconciliation_results_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT manual_whatsapp_reconciliation_results_request_fkey
    FOREIGN KEY (organization_id, request_id)
    REFERENCES platform_private.manual_whatsapp_reconciliation_requests(
      organization_id,
      request_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_conversation_fkey
    FOREIGN KEY (organization_id, conversation_id)
    REFERENCES platform.communication_conversations(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_work_item_fkey
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES platform_private.durable_work_items(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_attempt_fkey
    FOREIGN KEY (organization_id, attempt_id)
    REFERENCES platform_private.durable_work_attempts(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_authorization_fkey
    FOREIGN KEY (organization_id, manual_send_authorization_id, conversation_id)
    REFERENCES platform.manual_send_authorizations(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_message_fkey
    FOREIGN KEY (organization_id, communication_message_id)
    REFERENCES platform.communication_messages(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_review_case_fkey
    FOREIGN KEY (organization_id, work_review_case_id)
    REFERENCES platform.work_review_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT manual_whatsapp_reconciliation_results_shape_check CHECK (
    (
      outcome = 'message_not_found'
      AND communication_message_id IS NULL
      AND provider_message_id IS NULL
      AND provider_source IS NULL
      AND ack_state IS NULL
      AND provider_observed_at IS NULL
      AND ack_observed_at IS NULL
      AND work_review_case_id IS NULL
    )
    OR (
      outcome IN ('message_confirmed', 'delivery_refreshed')
      AND communication_message_id IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND provider_source IS NOT NULL
      AND ack_state IS NOT NULL
      AND provider_observed_at IS NOT NULL
      AND ack_observed_at IS NOT NULL
      AND ack_observed_at >= provider_observed_at
      AND (
        outcome <> 'message_confirmed'
        OR work_review_case_id IS NOT NULL
      )
    )
  )
);

CREATE INDEX manual_whatsapp_reconciliation_results_latest_idx
  ON platform_private.manual_whatsapp_reconciliation_results (
    organization_id,
    attempt_id,
    created_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX manual_whatsapp_reconciliation_results_recovery_effect_key
  ON platform_private.manual_whatsapp_reconciliation_results (
    organization_id,
    attempt_id
  )
  WHERE reconciliation_kind = 'unknown_recovery'
    AND outcome = 'message_confirmed';

ALTER TABLE platform_private.manual_whatsapp_reconciliation_results
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.manual_whatsapp_reconciliation_results
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER manual_whatsapp_reconciliation_results_append_only_rows
  BEFORE UPDATE OR DELETE
  ON platform_private.manual_whatsapp_reconciliation_results
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER manual_whatsapp_reconciliation_results_append_only_truncate
  BEFORE TRUNCATE
  ON platform_private.manual_whatsapp_reconciliation_results
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform.request_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_request_id UUID,
  p_model_ref TEXT,
  p_schema_version INTEGER,
  p_prompt_policy_version TEXT,
  p_reason TEXT
)
RETURNS TABLE (
  proposal_request_receipt_id UUID,
  request_id UUID,
  replayed BOOLEAN,
  completed BOOLEAN,
  outcome TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  conversation_row platform.communication_conversations%ROWTYPE;
  source_row platform.communication_messages%ROWTYPE;
  prior_receipt platform_private.gemini_proposal_request_receipts%ROWTYPE;
  prior_request platform_private.gemini_proposal_requests%ROWTYPE;
  request_outcome TEXT;
  exact_model_ref TEXT := pg_catalog.btrim(p_model_ref);
  exact_prompt_policy_version TEXT := pg_catalog.btrim(p_prompt_policy_version);
  exact_reason TEXT := NULLIF(pg_catalog.btrim(p_reason), '');
  request_fingerprint TEXT;
  safe_requested_by_name TEXT;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR exact_model_ref IS DISTINCT FROM 'gemini-3.7-flash'
    OR p_schema_version IS DISTINCT FROM 2
    OR exact_prompt_policy_version IS DISTINCT FROM
      'u9-gemini-human-review-v1'
    OR exact_reason IS NULL
    OR pg_catalog.char_length(exact_reason) > 1000
    OR exact_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Gemini proposal request is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.request'
  );

  SELECT profile.display_name
  INTO safe_requested_by_name
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id
    AND profile.display_name = pg_catalog.btrim(profile.display_name)
    AND pg_catalog.char_length(profile.display_name) BETWEEN 1 AND 200
    AND profile.display_name !~ '[[:cntrl:]]';

  IF safe_requested_by_name IS NULL THEN
    RAISE EXCEPTION 'Gemini proposal requester identity is unavailable'
      USING ERRCODE = '42501';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'model_ref', exact_model_ref,
      'schema_version', p_schema_version,
      'prompt_policy_version', exact_prompt_policy_version,
      'requested_by_membership_id', actor.actor_membership_id,
      'requested_by_auth_user_id', actor.actor_auth_user_id,
      'reason', exact_reason
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5a:gemini-request-receipt:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO prior_receipt
  FROM platform_private.gemini_proposal_request_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF FOUND THEN
    IF prior_receipt.organization_id <> p_organization_id
      OR prior_receipt.conversation_id <> p_conversation_id
      OR prior_receipt.source_message_id <> p_source_message_id
      OR prior_receipt.request_fingerprint <> request_fingerprint
      OR prior_receipt.requested_by_membership_id <> actor.actor_membership_id
      OR prior_receipt.requested_by_auth_user_id <> actor.actor_auth_user_id
      OR prior_receipt.reason <> exact_reason
    THEN
      RAISE EXCEPTION
        'request_id was already used for another Gemini proposal request'
        USING ERRCODE = '22023';
    END IF;

    SELECT request.*
    INTO prior_request
    FROM platform_private.gemini_proposal_requests AS request
    WHERE request.organization_id = prior_receipt.organization_id
      AND request.request_id = prior_receipt.request_id;

    IF prior_request.id IS NOT NULL THEN
      SELECT result.outcome::TEXT
      INTO request_outcome
      FROM platform_private.gemini_proposal_results AS result
      WHERE result.organization_id = prior_request.organization_id
        AND result.proposal_request_id = prior_request.id;
    ELSE
      request_outcome := NULL;
    END IF;

    proposal_request_receipt_id := prior_receipt.id;
    request_id := prior_receipt.request_id;
    replayed := TRUE;
    completed := request_outcome IS NOT NULL;
    outcome := request_outcome;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT message.*
  INTO source_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
    AND message.id = p_source_message_id
    AND message.direction = 'inbound'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = message.organization_id
        AND later_message.conversation_id = message.conversation_id
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          message.created_at,
          message.id
        )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Source must be the latest inbound communication message'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO platform_private.gemini_proposal_request_receipts (
    organization_id,
    conversation_id,
    source_message_id,
    request_id,
    request_fingerprint,
    model_ref,
    schema_version,
    prompt_policy_version,
    requested_by_profile_id,
    requested_by_membership_id,
    requested_by_auth_user_id,
    requested_by_name,
    reason
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_request_id,
    request_fingerprint,
    exact_model_ref,
    p_schema_version,
    exact_prompt_policy_version,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    safe_requested_by_name,
    exact_reason
  )
  RETURNING id INTO proposal_request_receipt_id;

  request_id := p_request_id;
  replayed := FALSE;
  completed := FALSE;
  outcome := NULL;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform.begin_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_request_id UUID,
  p_model_ref TEXT,
  p_schema_version INTEGER,
  p_prompt_policy_version TEXT
)
RETURNS TABLE (
  proposal_request_id UUID,
  replayed BOOLEAN,
  completed BOOLEAN,
  outcome TEXT,
  context JSONB
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation_row platform.communication_conversations%ROWTYPE;
  source_row platform.communication_messages%ROWTYPE;
  prior_request platform_private.gemini_proposal_requests%ROWTYPE;
  request_receipt platform_private.gemini_proposal_request_receipts%ROWTYPE;
  private_context JSONB;
  request_fingerprint TEXT;
  exact_model_ref TEXT := pg_catalog.btrim(p_model_ref);
  exact_prompt_policy_version TEXT :=
    pg_catalog.btrim(p_prompt_policy_version);
  existing_outcome TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_request_id IS NULL
    OR exact_model_ref IS DISTINCT FROM 'gemini-3.7-flash'
    OR p_schema_version IS DISTINCT FROM 2
    OR exact_prompt_policy_version IS DISTINCT FROM
      'u9-gemini-human-review-v1'
  THEN
    RAISE EXCEPTION 'Gemini proposal request is invalid'
      USING ERRCODE = '22023';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'model_ref', exact_model_ref,
      'schema_version', p_schema_version,
      'prompt_policy_version', exact_prompt_policy_version,
      'requested_by_membership_id', (
        SELECT receipt.requested_by_membership_id
        FROM platform_private.gemini_proposal_request_receipts AS receipt
        WHERE receipt.request_id = p_request_id
      ),
      'requested_by_auth_user_id', (
        SELECT receipt.requested_by_auth_user_id
        FROM platform_private.gemini_proposal_request_receipts AS receipt
        WHERE receipt.request_id = p_request_id
      ),
      'reason', (
        SELECT receipt.reason
        FROM platform_private.gemini_proposal_request_receipts AS receipt
        WHERE receipt.request_id = p_request_id
      )
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT receipt.*
  INTO request_receipt
  FROM platform_private.gemini_proposal_request_receipts AS receipt
  WHERE receipt.request_id = p_request_id;

  IF request_receipt.id IS NULL
    OR request_receipt.organization_id <> p_organization_id
    OR request_receipt.conversation_id <> p_conversation_id
    OR request_receipt.source_message_id <> p_source_message_id
    OR request_receipt.request_fingerprint <> request_fingerprint
  THEN
    RAISE EXCEPTION
      'Gemini proposal request must originate from authenticated staff'
      USING ERRCODE = '42501';
  END IF;

  SELECT request.*
  INTO prior_request
  FROM platform_private.gemini_proposal_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF prior_request.request_fingerprint <> request_fingerprint
      OR NOT prior_request.staff_binding_required
      OR prior_request.staff_request_receipt_id <> request_receipt.id
    THEN
      RAISE EXCEPTION
        'request_id was already used for another Gemini proposal request'
        USING ERRCODE = '22023';
    END IF;

    SELECT result.outcome::TEXT
    INTO existing_outcome
    FROM platform_private.gemini_proposal_results AS result
    WHERE result.organization_id = prior_request.organization_id
      AND result.proposal_request_id = prior_request.id;

    RETURN QUERY
    SELECT
      prior_request.id,
      TRUE,
      existing_outcome IS NOT NULL,
      existing_outcome,
      prior_request.private_context;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:u9:gemini-conversation:'
        || p_organization_id::TEXT
        || ':'
        || p_conversation_id::TEXT,
      0
    )
  );

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id
    AND conversation.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Open communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT message.*
  INTO source_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
    AND message.id = p_source_message_id
    AND message.direction = 'inbound'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.communication_messages AS later_message
      WHERE later_message.organization_id = message.organization_id
        AND later_message.conversation_id = message.conversation_id
        AND (
          later_message.created_at,
          later_message.id
        ) > (
          message.created_at,
          message.id
        )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Source must be the latest inbound communication message'
      USING ERRCODE = '42501';
  END IF;

  WITH current_knowledge AS MATERIALIZED (
    SELECT DISTINCT ON (knowledge.knowledge_key)
      knowledge.knowledge_key,
      knowledge.version,
      knowledge.title,
      knowledge.content_text,
      knowledge.approved_at,
      knowledge.id
    FROM platform.approved_knowledge_versions AS knowledge
    WHERE knowledge.organization_id = p_organization_id
      AND knowledge.status = 'approved'
    ORDER BY
      knowledge.knowledge_key,
      knowledge.version DESC,
      knowledge.id DESC
  ),
  selected_knowledge AS MATERIALIZED (
    SELECT
      knowledge.*,
      pg_catalog.row_number() OVER (
        ORDER BY
          knowledge.approved_at DESC,
          knowledge.knowledge_key,
          knowledge.version DESC,
          knowledge.id
      )::INTEGER AS evidence_ordinal
    FROM current_knowledge AS knowledge
    ORDER BY
      knowledge.approved_at DESC,
      knowledge.knowledge_key,
      knowledge.version DESC,
      knowledge.id
    LIMIT 6
  ),
  knowledge_context AS MATERIALIZED (
    SELECT
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'source_ref', pg_catalog.jsonb_build_object(
              'knowledge_key', selected.knowledge_key,
              'knowledge_version', selected.version,
              'evidence_ordinal', selected.evidence_ordinal
            ),
            'title', pg_catalog.left(
              pg_catalog.btrim(selected.title),
              500
            ),
            'content_text', pg_catalog.left(
              pg_catalog.btrim(selected.content_text),
              4000
            )
          )
          ORDER BY selected.evidence_ordinal
        ),
        '[]'::JSONB
      ) AS items,
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'knowledge_key', selected.knowledge_key,
            'knowledge_version', selected.version,
            'evidence_ordinal', selected.evidence_ordinal
          )
          ORDER BY selected.evidence_ordinal
        ),
        '[]'::JSONB
      ) AS allowed_citations
    FROM selected_knowledge AS selected
  )
  SELECT pg_catalog.jsonb_build_object(
    'conversation', pg_catalog.jsonb_build_object(
      'conversation_id', conversation_row.id,
      'student_case_id', conversation_row.student_case_id,
      'status', conversation_row.status::TEXT
    ),
    'source_message', pg_catalog.jsonb_build_object(
      'message_id', source_row.id,
      'direction', source_row.direction::TEXT,
      'language', source_row.language::TEXT,
      'body_text', pg_catalog.left(
        pg_catalog.btrim(source_row.body_text),
        4000
      ),
      'created_at', source_row.created_at
    ),
    'approved_knowledge', knowledge_context.items,
    'allowed_citations', knowledge_context.allowed_citations
  )
  INTO private_context
  FROM knowledge_context;

  IF private_context IS NULL
    OR pg_catalog.char_length(private_context::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Gemini proposal context exceeds its safe bound'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform_private.gemini_proposal_requests (
    organization_id,
    conversation_id,
    source_message_id,
    request_id,
    request_fingerprint,
    model_ref,
    schema_version,
    prompt_policy_version,
    private_context,
    context_sha256,
    input_sha256,
    staff_binding_required,
    staff_request_receipt_id
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_request_id,
    request_fingerprint,
    exact_model_ref,
    p_schema_version,
    exact_prompt_policy_version,
    private_context,
    platform_private.ai_memory_json_sha256(private_context),
    platform_private.ai_memory_json_sha256(
      pg_catalog.jsonb_build_object(
        'request_fingerprint', request_fingerprint,
        'context', private_context
      )
    ),
    TRUE,
    request_receipt.id
  )
  RETURNING id INTO proposal_request_id;

  replayed := FALSE;
  completed := FALSE;
  outcome := NULL;
  context := private_context;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.gemini_proposal_is_staff_bound(
  p_organization_id UUID,
  p_proposal_request_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.gemini_proposal_requests AS proposal_request
    JOIN platform_private.gemini_proposal_request_receipts AS receipt
      ON receipt.organization_id = proposal_request.organization_id
     AND receipt.id = proposal_request.staff_request_receipt_id
     AND receipt.request_id = proposal_request.request_id
     AND receipt.conversation_id = proposal_request.conversation_id
     AND receipt.source_message_id = proposal_request.source_message_id
     AND receipt.model_ref = proposal_request.model_ref
     AND receipt.schema_version = proposal_request.schema_version
     AND receipt.prompt_policy_version = proposal_request.prompt_policy_version
    WHERE proposal_request.organization_id = p_organization_id
      AND proposal_request.id = p_proposal_request_id
      AND proposal_request.schema_version = 2
      AND proposal_request.staff_binding_required
  )
$$;

CREATE OR REPLACE FUNCTION platform_private.require_staff_bound_gemini_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_schema_version INTEGER;
BEGIN
  SELECT proposal_request.schema_version
  INTO request_schema_version
  FROM platform_private.gemini_proposal_requests AS proposal_request
  WHERE proposal_request.organization_id = NEW.organization_id
    AND proposal_request.id = NEW.proposal_request_id;

  IF request_schema_version = 2
    AND NOT platform_private.gemini_proposal_is_staff_bound(
      NEW.organization_id,
      NEW.proposal_request_id
    )
  THEN
    RAISE EXCEPTION 'Gemini proposal result requires authenticated staff initiation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER gemini_proposal_results_staff_binding_guard
  BEFORE INSERT
  ON platform_private.gemini_proposal_results
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.require_staff_bound_gemini_result();

ALTER FUNCTION platform.staff_gemini_proposal(UUID, UUID)
  SET SCHEMA platform_private;

ALTER FUNCTION platform_private.staff_gemini_proposal(UUID, UUID)
  RENAME TO staff_gemini_proposal_pre_p5a_internal;

CREATE FUNCTION platform.staff_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  proposal_request_id UUID,
  source_message_id UUID,
  outcome TEXT,
  failure_code TEXT,
  model_ref TEXT,
  schema_version INTEGER,
  language TEXT,
  intent TEXT,
  confidence SMALLINT,
  risk TEXT,
  handoff_required BOOLEAN,
  handoff_reasons TEXT[],
  citations JSONB,
  memory_changes JSONB,
  qualification JSONB,
  reply_text TEXT,
  summary TEXT,
  next_action TEXT,
  draft_internal_note TEXT,
  missing_document_suggestion TEXT,
  deadline_warning TEXT,
  limitations JSONB,
  uncertainty TEXT,
  requested_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  human_review_required BOOLEAN,
  autonomous_authority BOOLEAN,
  provider_proof_state TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  latest_request_id UUID;
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'ai.draft.review'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT proposal_request.id
  INTO latest_request_id
  FROM platform_private.gemini_proposal_requests AS proposal_request
  WHERE proposal_request.organization_id = p_organization_id
    AND proposal_request.conversation_id = p_conversation_id
  ORDER BY proposal_request.created_at DESC, proposal_request.id DESC
  LIMIT 1;

  IF latest_request_id IS NULL
    OR NOT platform_private.gemini_proposal_is_staff_bound(
      p_organization_id,
      latest_request_id
    )
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM platform_private.staff_gemini_proposal_pre_p5a_internal(
    p_organization_id,
    p_conversation_id
  );
END
$$;

ALTER FUNCTION platform.review_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB,
  TEXT
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.review_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB,
  TEXT
) RENAME TO review_gemini_proposal_pre_p5a_internal;

CREATE FUNCTION platform.review_gemini_proposal(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_proposal_request_id UUID,
  p_review_request_id UUID,
  p_decision TEXT,
  p_reviewed_payload JSONB,
  p_reason TEXT
)
RETURNS TABLE (
  review_id UUID,
  proposal_request_id UUID,
  decision TEXT,
  reviewed_payload JSONB,
  reviewed_payload_sha256 TEXT,
  reason TEXT,
  reviewed_by_membership_id UUID,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  replayed BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.review'
  );

  IF NOT platform_private.gemini_proposal_is_staff_bound(
    p_organization_id,
    p_proposal_request_id
  ) THEN
    RAISE EXCEPTION 'Gemini proposal review requires authenticated staff initiation'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM platform_private.review_gemini_proposal_pre_p5a_internal(
    p_organization_id,
    p_conversation_id,
    p_proposal_request_id,
    p_review_request_id,
    p_decision,
    p_reviewed_payload,
    p_reason
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_gemini_proposal_reviews(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  review_id UUID,
  proposal_request_id UUID,
  decision TEXT,
  reviewed_payload JSONB,
  reviewed_payload_sha256 TEXT,
  reason TEXT,
  reviewed_by_membership_id UUID,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'Organization, conversation and limit are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'ai.draft.review'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    review.id,
    review.proposal_request_id,
    review.decision::TEXT,
    review.reviewed_payload,
    review.reviewed_payload_sha256,
    review.reason,
    review.reviewed_by_membership_id,
    review.reviewed_by_name,
    review.reviewed_at
  FROM platform.gemini_proposal_reviews AS review
  WHERE review.organization_id = p_organization_id
    AND review.conversation_id = p_conversation_id
    AND platform_private.gemini_proposal_is_staff_bound(
      review.organization_id,
      review.proposal_request_id
    )
  ORDER BY review.reviewed_at DESC, review.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_latest_manual_whatsapp_send_attempt(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  attempt_id UUID,
  work_item_id UUID,
  conversation_id UUID,
  manual_send_authorization_id UUID,
  final_text TEXT,
  authorized_by_membership_id UUID,
  authorized_by_name TEXT,
  status TEXT,
  reconciliation_required BOOLEAN,
  provider_source TEXT,
  ack_name TEXT,
  provider_observed_at TIMESTAMPTZ,
  ack_observed_at TIMESTAMPTZ,
  failure_code TEXT,
  attempt_number INTEGER,
  authorized_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  latest_reconciliation_kind TEXT,
  latest_reconciliation_outcome TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Organization and conversation are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION 'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH latest_work AS MATERIALIZED (
    SELECT
      item.id AS work_item_id,
      item.organization_id,
      item.state AS work_state,
      item.manual_send_authorization_id,
      item.created_at AS work_created_at
    FROM platform_private.durable_work_items AS item
    JOIN platform.manual_send_authorizations AS authorization_row
      ON authorization_row.organization_id = item.organization_id
     AND authorization_row.id = item.manual_send_authorization_id
    WHERE item.organization_id = p_organization_id
      AND item.kind = 'manual_whatsapp_send'
      AND authorization_row.conversation_id = p_conversation_id
    ORDER BY authorization_row.authorized_at DESC, item.id DESC
    LIMIT 1
  ),
  latest_attempt AS MATERIALIZED (
    SELECT
      attempt.id AS attempt_id,
      attempt.work_item_id,
      attempt.attempt_number,
      attempt.claimed_at,
      attempt.finished_at,
      attempt.outcome,
      attempt.error_code
    FROM latest_work AS work_item
    JOIN platform_private.durable_work_attempts AS attempt
      ON attempt.organization_id = work_item.organization_id
     AND attempt.work_item_id = work_item.work_item_id
    ORDER BY attempt.attempt_number DESC, attempt.id DESC
    LIMIT 1
  ),
  authorization_row AS MATERIALIZED (
    SELECT
      authz.id,
      authz.organization_id,
      authz.conversation_id,
      authz.final_text,
      authz.authorized_by_membership_id,
      authz.authorized_by_profile_id,
      authz.authorized_at
    FROM latest_work AS work_item
    JOIN platform.manual_send_authorizations AS authz
      ON authz.organization_id = work_item.organization_id
     AND authz.id = work_item.manual_send_authorization_id
  ),
  authorization_actor AS MATERIALIZED (
    SELECT
      membership.id AS membership_id,
      profile.display_name
    FROM authorization_row AS authz
    JOIN platform.organization_memberships AS membership
      ON membership.organization_id = authz.organization_id
     AND membership.id = authz.authorized_by_membership_id
    JOIN platform.profiles AS profile
      ON profile.id = authz.authorized_by_profile_id
  ),
  base_binding AS MATERIALIZED (
    SELECT
      binding.communication_message_id,
      binding.provider_observed_at
    FROM latest_work AS work_item
    JOIN platform_private.manual_send_provider_bindings AS binding
      ON binding.organization_id = work_item.organization_id
     AND binding.durable_work_item_id = work_item.work_item_id
  ),
  base_ack AS MATERIALIZED (
    SELECT
      ack_current.communication_message_id,
      ack_current.waha_ack_name,
      ack_current.waha_ack_observed_at
    FROM base_binding AS binding
    JOIN platform.waha_message_ack_current AS ack_current
      ON ack_current.organization_id = p_organization_id
     AND ack_current.communication_message_id = binding.communication_message_id
  ),
  latest_reconciliation AS MATERIALIZED (
    SELECT result.*
    FROM latest_attempt AS attempt
    JOIN platform_private.manual_whatsapp_reconciliation_results AS result
      ON result.organization_id = p_organization_id
     AND result.attempt_id = attempt.attempt_id
    ORDER BY result.created_at DESC, result.id DESC
    LIMIT 1
  ),
  ack_candidates AS MATERIALIZED (
    SELECT
      pg_catalog.upper(result.ack_state::TEXT) AS ack_name,
      result.ack_observed_at,
      CASE result.ack_state
        WHEN 'unknown' THEN -1
        WHEN 'pending' THEN 0
        WHEN 'error' THEN 1
        WHEN 'server' THEN 2
        WHEN 'device' THEN 3
        WHEN 'read' THEN 4
        WHEN 'played' THEN 5
      END AS ack_rank
    FROM latest_attempt AS attempt
    JOIN platform_private.manual_whatsapp_reconciliation_results AS result
      ON result.organization_id = p_organization_id
     AND result.attempt_id = attempt.attempt_id
    WHERE result.outcome IN ('message_confirmed', 'delivery_refreshed')

    UNION ALL

    SELECT
      ack_current.waha_ack_name AS ack_name,
      ack_current.waha_ack_observed_at AS ack_observed_at,
      CASE ack_current.waha_ack_name
        WHEN 'PENDING' THEN 0
        WHEN 'ERROR' THEN 1
        WHEN 'SERVER' THEN 2
        WHEN 'DEVICE' THEN 3
        WHEN 'READ' THEN 4
        WHEN 'PLAYED' THEN 5
      END AS ack_rank
    FROM base_ack AS ack_current
  ),
  effective_ack AS MATERIALIZED (
    -- A later manual readback is evidence, not permission to regress the
    -- canonical delivery state. Prefer the strongest state observed across
    -- every exact reconciliation result and the webhook projection; use the
    -- newest observation only to break a same-state tie.
    SELECT candidate.ack_name, candidate.ack_observed_at
    FROM ack_candidates AS candidate
    ORDER BY
      candidate.ack_rank DESC,
      candidate.ack_observed_at DESC,
      candidate.ack_name
    LIMIT 1
  ),
  effective_state AS MATERIALIZED (
    SELECT
      attempt.attempt_id,
      work_item.work_item_id,
      authorization_row.conversation_id,
      authorization_row.id AS manual_send_authorization_id,
      authorization_row.final_text,
      authorization_row.authorized_by_membership_id,
      authorization_actor.display_name AS authorized_by_name,
      CASE
        WHEN binding.communication_message_id IS NOT NULL THEN 'accepted'
        WHEN attempt.outcome = 'succeeded' THEN 'accepted'
        WHEN attempt.outcome = 'unknown_result' THEN 'unknown'
        WHEN attempt.outcome IS NULL
          AND work_item.work_state IN ('queued', 'leased', 'retry_wait')
          THEN 'prepared'
        ELSE 'rejected'
      END AS status,
      (
        attempt.outcome = 'unknown_result'
        AND binding.communication_message_id IS NULL
      ) AS reconciliation_required,
      reconciliation.provider_source,
      effective_ack.ack_name,
      COALESCE(
        reconciliation.provider_observed_at,
        binding.provider_observed_at
      ) AS provider_observed_at,
      effective_ack.ack_observed_at,
      attempt.error_code AS failure_code,
      attempt.attempt_number,
      authorization_row.authorized_at,
      attempt.claimed_at,
      attempt.finished_at AS settled_at,
      reconciliation.created_at AS last_reconciled_at,
      reconciliation.reconciliation_kind::TEXT AS latest_reconciliation_kind,
      reconciliation.outcome::TEXT AS latest_reconciliation_outcome
    FROM latest_work AS work_item
    JOIN latest_attempt AS attempt ON TRUE
    JOIN authorization_row ON TRUE
    JOIN authorization_actor ON TRUE
    LEFT JOIN base_binding AS binding ON TRUE
    LEFT JOIN latest_reconciliation AS reconciliation ON TRUE
    LEFT JOIN effective_ack ON TRUE
  )
  SELECT *
  FROM effective_state;
END
$$;

-- Authenticated staff request, service-only exact WAHA readback context,
-- and idempotent service completion are the sole reconciliation entrypoints.
CREATE OR REPLACE FUNCTION platform.request_manual_whatsapp_reconciliation(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_attempt_id UUID,
  p_request_id UUID,
  p_reason TEXT
)
RETURNS TABLE (
  reconciliation_request_id UUID,
  reconciliation_kind TEXT,
  replayed BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  latest_attempt RECORD;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  provider_binding platform_private.manual_send_provider_bindings%ROWTYPE;
  prior_request platform_private.manual_whatsapp_reconciliation_requests%ROWTYPE;
  exact_reason TEXT := NULLIF(pg_catalog.btrim(p_reason), '');
  safe_requested_by_name TEXT;
  exact_kind platform.manual_whatsapp_reconciliation_kind;
  expected_provider_message_sha256 TEXT;
  request_fingerprint TEXT;
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_attempt_id IS NULL
    OR p_request_id IS NULL
    OR exact_reason IS NULL
    OR pg_catalog.char_length(exact_reason) > 1000
    OR exact_reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Reconciliation request is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'communication.manual.send'
  );

  SELECT profile.display_name
  INTO safe_requested_by_name
  FROM platform.profiles AS profile
  WHERE profile.id = actor.actor_profile_id
    AND profile.auth_user_id = actor.actor_auth_user_id
    AND profile.display_name = pg_catalog.btrim(profile.display_name)
    AND pg_catalog.char_length(profile.display_name) BETWEEN 1 AND 200
    AND profile.display_name !~ '[[:cntrl:]]';

  IF safe_requested_by_name IS NULL THEN
    RAISE EXCEPTION 'Reconciliation requester identity is unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5a:manual-whatsapp-reconciliation-request:' || p_request_id::TEXT,
      0
    )
  );

  SELECT request.*
  INTO prior_request
  FROM platform_private.manual_whatsapp_reconciliation_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    request_fingerprint := platform_private.ai_memory_json_sha256(
      pg_catalog.jsonb_build_object(
        'organization_id', prior_request.organization_id,
        'conversation_id', prior_request.conversation_id,
        'source_message_id', prior_request.source_message_id,
        'work_item_id', prior_request.work_item_id,
        'attempt_id', prior_request.attempt_id,
        'manual_send_authorization_id',
          prior_request.manual_send_authorization_id,
        'reconciliation_kind', prior_request.reconciliation_kind,
        'waha_session_name', prior_request.waha_session_name,
        'recipient_sha256', prior_request.recipient_sha256,
        'final_text_sha256', prior_request.final_text_sha256,
        'expected_provider_message_sha256',
          prior_request.expected_provider_message_sha256,
        'requested_by_membership_id', actor.actor_membership_id,
        'requested_by_auth_user_id', actor.actor_auth_user_id,
        'reason', exact_reason
      )
    );

    IF prior_request.organization_id <> p_organization_id
      OR prior_request.conversation_id <> p_conversation_id
      OR prior_request.attempt_id <> p_attempt_id
      OR prior_request.requested_by_membership_id <> actor.actor_membership_id
      OR prior_request.requested_by_auth_user_id <> actor.actor_auth_user_id
      OR prior_request.reason <> exact_reason
      OR prior_request.request_fingerprint <> request_fingerprint
    THEN
      RAISE EXCEPTION
        'request_id was already used for another WhatsApp reconciliation request'
        USING ERRCODE = '22023';
    END IF;

    reconciliation_request_id := prior_request.id;
    reconciliation_kind := prior_request.reconciliation_kind::TEXT;
    replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO latest_attempt
  FROM platform.staff_latest_manual_whatsapp_send_attempt(
    p_organization_id,
    p_conversation_id
  )
  WHERE attempt_id = p_attempt_id;

  IF latest_attempt.attempt_id IS NULL THEN
    RAISE EXCEPTION 'Latest manual WhatsApp attempt is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT authorization_source.*
  INTO authorization_row
  FROM platform.manual_send_authorizations AS authorization_source
  WHERE authorization_source.organization_id = p_organization_id
    AND authorization_source.id = latest_attempt.manual_send_authorization_id
    AND authorization_source.conversation_id = p_conversation_id;

  SELECT binding.*
  INTO direct_binding
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.conversation_id = p_conversation_id
    AND binding.waha_session_name = 'evo-inbox';

  SELECT binding.*
  INTO provider_binding
  FROM platform_private.manual_send_provider_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.durable_work_attempt_id = p_attempt_id;

  IF authorization_row.id IS NULL
    OR direct_binding.id IS NULL
    OR authorization_row.final_text_sha256 <>
      platform_private.ai_memory_text_sha256(
        pg_catalog.btrim(authorization_row.final_text)
      )
  THEN
    RAISE EXCEPTION 'Manual WhatsApp reconciliation identity is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF latest_attempt.status = 'unknown'
    AND latest_attempt.reconciliation_required
    AND provider_binding.id IS NULL
  THEN
    exact_kind := 'unknown_recovery';
    expected_provider_message_sha256 := NULL;
  ELSIF latest_attempt.status = 'accepted'
    AND provider_binding.id IS NOT NULL
  THEN
    exact_kind := 'ack_refresh';
    expected_provider_message_sha256 :=
      platform_private.ai_memory_text_sha256(provider_binding.raw_message_id);
  ELSE
    RAISE EXCEPTION 'Latest manual WhatsApp attempt cannot be reconciled'
      USING ERRCODE = '55000';
  END IF;

  request_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'organization_id', p_organization_id,
      'conversation_id', p_conversation_id,
      'source_message_id', authorization_row.source_message_id,
      'work_item_id', latest_attempt.work_item_id,
      'attempt_id', p_attempt_id,
      'manual_send_authorization_id', authorization_row.id,
      'reconciliation_kind', exact_kind,
      'waha_session_name', 'evo-inbox',
      'recipient_sha256',
        platform_private.ai_memory_text_sha256(direct_binding.normalized_chat_id),
      'final_text_sha256', authorization_row.final_text_sha256,
      'expected_provider_message_sha256', expected_provider_message_sha256,
      'requested_by_membership_id', actor.actor_membership_id,
      'requested_by_auth_user_id', actor.actor_auth_user_id,
      'reason', exact_reason
    )
  );

  INSERT INTO platform_private.manual_whatsapp_reconciliation_requests
    AS created_request (
    organization_id,
    conversation_id,
    source_message_id,
    work_item_id,
    attempt_id,
    manual_send_authorization_id,
    reconciliation_kind,
    request_id,
    request_fingerprint,
    waha_session_name,
    recipient_sha256,
    final_text_sha256,
    expected_provider_message_sha256,
    requested_by_profile_id,
    requested_by_membership_id,
    requested_by_auth_user_id,
    requested_by_name,
    reason
  )
  VALUES (
    p_organization_id,
    p_conversation_id,
    authorization_row.source_message_id,
    latest_attempt.work_item_id,
    p_attempt_id,
    authorization_row.id,
    exact_kind,
    p_request_id,
    request_fingerprint,
    'evo-inbox',
    platform_private.ai_memory_text_sha256(direct_binding.normalized_chat_id),
    authorization_row.final_text_sha256,
    expected_provider_message_sha256,
    actor.actor_profile_id,
    actor.actor_membership_id,
    actor.actor_auth_user_id,
    safe_requested_by_name,
    exact_reason
  )
  RETURNING created_request.id, created_request.reconciliation_kind::TEXT
  INTO reconciliation_request_id, reconciliation_kind;

  replayed := FALSE;
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION platform.manual_whatsapp_reconciliation_context(
  p_reconciliation_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row platform_private.manual_whatsapp_reconciliation_requests%ROWTYPE;
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt_row platform_private.durable_work_attempts%ROWTYPE;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  provider_binding platform_private.manual_send_provider_bindings%ROWTYPE;
  completed BOOLEAN;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_reconciliation_request_id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation request id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT request.*
  INTO request_row
  FROM platform_private.manual_whatsapp_reconciliation_requests AS request
  WHERE request.id = p_reconciliation_request_id;

  SELECT item.*
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = request_row.organization_id
    AND item.id = request_row.work_item_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.manual_send_authorization_id = request_row.manual_send_authorization_id;

  SELECT attempt.*
  INTO attempt_row
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = request_row.organization_id
    AND attempt.id = request_row.attempt_id
    AND attempt.work_item_id = request_row.work_item_id;

  SELECT authorization_source.*
  INTO authorization_row
  FROM platform.manual_send_authorizations AS authorization_source
  WHERE authorization_source.organization_id = request_row.organization_id
    AND authorization_source.id = request_row.manual_send_authorization_id
    AND authorization_source.conversation_id = request_row.conversation_id
    AND authorization_source.source_message_id = request_row.source_message_id;

  SELECT binding.*
  INTO direct_binding
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = request_row.organization_id
    AND binding.conversation_id = request_row.conversation_id
    AND binding.waha_session_name = request_row.waha_session_name;

  SELECT binding.*
  INTO provider_binding
  FROM platform_private.manual_send_provider_bindings AS binding
  WHERE binding.organization_id = request_row.organization_id
    AND binding.durable_work_attempt_id = request_row.attempt_id;

  SELECT EXISTS (
    SELECT 1
    FROM platform_private.manual_whatsapp_reconciliation_results AS result
    WHERE result.organization_id = request_row.organization_id
      AND result.request_id = request_row.request_id
  ) INTO completed;

  IF request_row.id IS NULL
    OR work_item.id IS NULL
    OR attempt_row.id IS NULL
    OR authorization_row.id IS NULL
    OR direct_binding.id IS NULL
    OR request_row.recipient_sha256 <>
      platform_private.ai_memory_text_sha256(direct_binding.normalized_chat_id)
    OR request_row.final_text_sha256 <> authorization_row.final_text_sha256
    OR authorization_row.final_text_sha256 <>
      platform_private.ai_memory_text_sha256(
        pg_catalog.btrim(authorization_row.final_text)
      )
    OR (
      request_row.reconciliation_kind = 'unknown_recovery'
      AND (
        attempt_row.outcome <> 'unknown_result'
        OR work_item.state <> 'unknown_manual_review'
        OR request_row.expected_provider_message_sha256 IS NOT NULL
      )
    )
    OR (
      request_row.reconciliation_kind = 'ack_refresh'
      AND (
        provider_binding.id IS NULL
        OR request_row.expected_provider_message_sha256 <>
          platform_private.ai_memory_text_sha256(provider_binding.raw_message_id)
      )
    )
  THEN
    RAISE EXCEPTION 'Reconciliation request no longer matches canonical state'
      USING ERRCODE = '55000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'reconciliation_request_id', request_row.id,
    'request_id', request_row.request_id,
    'organization_id', request_row.organization_id,
    'conversation_id', request_row.conversation_id,
    'source_message_id', request_row.source_message_id,
    'work_item_id', request_row.work_item_id,
    'attempt_id', request_row.attempt_id,
    'manual_send_authorization_id', request_row.manual_send_authorization_id,
    'reconciliation_kind', request_row.reconciliation_kind,
    'waha_session_name', request_row.waha_session_name,
    'raw_chat_id', direct_binding.normalized_chat_id,
    'final_text', authorization_row.final_text,
    'final_text_sha256', authorization_row.final_text_sha256,
    'expected_provider_message_id', provider_binding.raw_message_id,
    'provider_window_start', attempt_row.claimed_at - INTERVAL '5 minutes',
    'provider_window_end', COALESCE(
      attempt_row.finished_at,
      statement_timestamp()
    ) + INTERVAL '15 minutes',
    'completed', completed
  );
END
$$;

CREATE FUNCTION platform.finish_manual_whatsapp_reconciliation(
  p_reconciliation_request_id UUID,
  p_waha_session_name TEXT,
  p_raw_chat_id TEXT,
  p_final_text_sha256 TEXT,
  p_match_count INTEGER,
  p_provider_message_id TEXT,
  p_provider_source TEXT,
  p_ack_state platform.waha_ack_state,
  p_provider_observed_at TIMESTAMPTZ,
  p_ack_observed_at TIMESTAMPTZ,
  p_completion_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_row platform_private.manual_whatsapp_reconciliation_requests%ROWTYPE;
  prior_result platform_private.manual_whatsapp_reconciliation_results%ROWTYPE;
  competing_result platform_private.manual_whatsapp_reconciliation_results%ROWTYPE;
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt_row platform_private.durable_work_attempts%ROWTYPE;
  authorization_row platform.manual_send_authorizations%ROWTYPE;
  conversation_row platform.communication_conversations%ROWTYPE;
  source_message_row platform.communication_messages%ROWTYPE;
  sender_participant platform.conversation_participants%ROWTYPE;
  direct_binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  existing_binding platform_private.manual_send_provider_bindings%ROWTYPE;
  review_case platform.work_review_cases%ROWTYPE;
  created_message_id UUID := gen_random_uuid();
  result_outcome platform.manual_whatsapp_reconciliation_outcome;
  exact_session TEXT := NULLIF(pg_catalog.btrim(p_waha_session_name), '');
  exact_recipient TEXT := NULLIF(pg_catalog.btrim(p_raw_chat_id), '');
  exact_final_text_sha256 TEXT := pg_catalog.lower(
    pg_catalog.btrim(p_final_text_sha256)
  );
  exact_provider_message_id TEXT := NULLIF(
    pg_catalog.btrim(p_provider_message_id),
    ''
  );
  exact_provider_source TEXT := NULLIF(pg_catalog.btrim(p_provider_source), '');
  result_fingerprint TEXT;
  result_record platform_private.manual_whatsapp_reconciliation_results%ROWTYPE;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_reconciliation_request_id IS NULL
    OR p_completion_request_id IS NULL
    OR exact_session IS NULL
    OR exact_recipient IS NULL
    OR exact_final_text_sha256 IS NULL
    OR exact_final_text_sha256 !~ '^[0-9a-f]{64}$'
    OR p_match_count IS NULL
    OR p_match_count NOT BETWEEN 0 AND 1
    OR (
      p_match_count = 0
      AND (
        exact_provider_message_id IS NOT NULL
        OR exact_provider_source IS NOT NULL
        OR p_ack_state IS NOT NULL
        OR p_provider_observed_at IS NOT NULL
        OR p_ack_observed_at IS NOT NULL
      )
    )
    OR (
      p_match_count = 1
      AND (
        exact_provider_message_id IS NULL
        OR pg_catalog.char_length(exact_provider_message_id) > 512
        OR exact_provider_message_id !~ '^[ -~]+$'
        OR exact_provider_source NOT IN ('api', 'app')
        OR p_ack_state IS NULL
        OR p_provider_observed_at IS NULL
        OR p_ack_observed_at IS NULL
        OR p_ack_observed_at < p_provider_observed_at
        OR p_ack_observed_at > statement_timestamp() + INTERVAL '5 minutes'
      )
    )
  THEN
    RAISE EXCEPTION 'WhatsApp reconciliation input is invalid'
      USING ERRCODE = '22023';
  END IF;

  result_fingerprint := platform_private.ai_memory_json_sha256(
    pg_catalog.jsonb_build_object(
      'reconciliation_request_id', p_reconciliation_request_id,
      'waha_session_name', exact_session,
      'raw_chat_id', exact_recipient,
      'final_text_sha256', exact_final_text_sha256,
      'match_count', p_match_count,
      'provider_message_id', exact_provider_message_id,
      'provider_source', exact_provider_source,
      'ack_state', p_ack_state,
      'provider_observed_at', p_provider_observed_at,
      'ack_observed_at', p_ack_observed_at
    )
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5a:manual-whatsapp-reconciliation-finish:'
        || p_completion_request_id::TEXT,
      0
    )
  );

  SELECT result.*
  INTO prior_result
  FROM platform_private.manual_whatsapp_reconciliation_results AS result
  WHERE result.completion_request_id = p_completion_request_id;

  IF FOUND THEN
    IF prior_result.result_fingerprint <> result_fingerprint
      OR prior_result.request_id <> (
        SELECT request.request_id
        FROM platform_private.manual_whatsapp_reconciliation_requests AS request
        WHERE request.id = p_reconciliation_request_id
      )
    THEN
      RAISE EXCEPTION
        'completion_request_id was already used for another reconciliation result'
        USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'reconciliation_request_id', p_reconciliation_request_id,
      'organization_id', prior_result.organization_id,
      'conversation_id', prior_result.conversation_id,
      'attempt_id', prior_result.attempt_id,
      'outcome', prior_result.outcome,
      'communication_message_id', prior_result.communication_message_id,
      'ack_name', CASE
        WHEN prior_result.ack_state IS NULL THEN NULL
        ELSE pg_catalog.upper(prior_result.ack_state::TEXT)
      END,
      'reconciliation_required', prior_result.outcome = 'message_not_found',
      'replayed', TRUE
    );
  END IF;

  SELECT request.*
  INTO request_row
  FROM platform_private.manual_whatsapp_reconciliation_requests AS request
  WHERE request.id = p_reconciliation_request_id;

  IF request_row.id IS NULL THEN
    RAISE EXCEPTION
      'WhatsApp reconciliation request must originate from authenticated staff'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5a:manual-whatsapp-reconciliation-attempt:'
        || request_row.attempt_id::TEXT,
      0
    )
  );

  SELECT result.*
  INTO competing_result
  FROM platform_private.manual_whatsapp_reconciliation_results AS result
  WHERE result.organization_id = request_row.organization_id
    AND result.request_id = request_row.request_id;

  IF FOUND THEN
    RAISE EXCEPTION 'Reconciliation request already has another completion identity'
      USING ERRCODE = '23505';
  END IF;

  SELECT item.*
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = request_row.organization_id
    AND item.id = request_row.work_item_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.manual_send_authorization_id = request_row.manual_send_authorization_id
  FOR UPDATE;

  SELECT attempt.*
  INTO attempt_row
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = request_row.organization_id
    AND attempt.id = request_row.attempt_id
    AND attempt.work_item_id = request_row.work_item_id
  FOR UPDATE;

  SELECT authorization_source.*
  INTO authorization_row
  FROM platform.manual_send_authorizations AS authorization_source
  WHERE authorization_source.organization_id = request_row.organization_id
    AND authorization_source.id = request_row.manual_send_authorization_id
    AND authorization_source.conversation_id = request_row.conversation_id
    AND authorization_source.source_message_id = request_row.source_message_id;

  SELECT conversation.*
  INTO conversation_row
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = request_row.organization_id
    AND conversation.id = request_row.conversation_id
    AND conversation.waha_session_name = request_row.waha_session_name;

  SELECT message.*
  INTO source_message_row
  FROM platform.communication_messages AS message
  WHERE message.organization_id = request_row.organization_id
    AND message.id = request_row.source_message_id
    AND message.conversation_id = request_row.conversation_id
    AND message.direction = 'inbound';

  SELECT binding.*
  INTO direct_binding
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = request_row.organization_id
    AND binding.conversation_id = request_row.conversation_id
    AND binding.waha_session_name = request_row.waha_session_name;

  SELECT binding.*
  INTO existing_binding
  FROM platform_private.manual_send_provider_bindings AS binding
  WHERE binding.organization_id = request_row.organization_id
    AND binding.durable_work_attempt_id = request_row.attempt_id;

  IF work_item.id IS NULL
    OR attempt_row.id IS NULL
    OR authorization_row.id IS NULL
    OR conversation_row.id IS NULL
    OR source_message_row.id IS NULL
    OR direct_binding.id IS NULL
    OR exact_session <> request_row.waha_session_name
    OR exact_recipient <> direct_binding.normalized_chat_id
    OR request_row.recipient_sha256 <>
      platform_private.ai_memory_text_sha256(exact_recipient)
    OR exact_final_text_sha256 <> request_row.final_text_sha256
    OR authorization_row.final_text_sha256 <> request_row.final_text_sha256
    OR authorization_row.final_text_sha256 <>
      platform_private.ai_memory_text_sha256(
        pg_catalog.btrim(authorization_row.final_text)
      )
  THEN
    RAISE EXCEPTION 'WhatsApp reconciliation identity does not match canonical state'
      USING ERRCODE = '42501';
  END IF;

  IF p_match_count = 1
    AND (
      p_provider_observed_at < attempt_row.claimed_at - INTERVAL '5 minutes'
      OR p_provider_observed_at >
        COALESCE(attempt_row.finished_at, statement_timestamp())
          + INTERVAL '15 minutes'
    )
  THEN
    RAISE EXCEPTION 'Provider message time is outside the exact send-attempt window'
      USING ERRCODE = '22023';
  END IF;

  IF request_row.reconciliation_kind = 'unknown_recovery' THEN
    IF attempt_row.outcome <> 'unknown_result'
      OR work_item.state <> 'unknown_manual_review'
      OR existing_binding.id IS NOT NULL
    THEN
      RAISE EXCEPTION 'Unknown send attempt is no longer recoverable'
        USING ERRCODE = '55000';
    END IF;
    result_outcome := CASE
      WHEN p_match_count = 0 THEN 'message_not_found'
      ELSE 'message_confirmed'
    END;
  ELSE
    IF existing_binding.id IS NULL
      OR request_row.expected_provider_message_sha256 <>
        platform_private.ai_memory_text_sha256(existing_binding.raw_message_id)
      OR p_match_count <> 1
      OR exact_provider_message_id <> existing_binding.raw_message_id
      OR p_provider_observed_at <> existing_binding.provider_observed_at
    THEN
      RAISE EXCEPTION 'ACK refresh does not match the accepted provider message'
        USING ERRCODE = '22023';
    END IF;
    result_outcome := 'delivery_refreshed';
    created_message_id := existing_binding.communication_message_id;
  END IF;

  IF result_outcome = 'message_confirmed' THEN
    SELECT participant.*
    INTO sender_participant
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = request_row.organization_id
      AND participant.conversation_id = request_row.conversation_id
      AND participant.membership_id = authorization_row.authorized_by_membership_id
      AND participant.participant_kind IN ('admin', 'sales', 'curator')
    ORDER BY participant.created_at DESC, participant.id DESC
    LIMIT 1;

    SELECT review.*
    INTO review_case
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = request_row.organization_id
      AND review.work_item_id = request_row.work_item_id
      AND review.manual_send_authorization_id = request_row.manual_send_authorization_id
      AND review.review_kind = 'unknown_delivery'
      AND review.status = 'open'
    FOR UPDATE;

    IF sender_participant.id IS NULL OR review_case.id IS NULL THEN
      RAISE EXCEPTION 'Unknown recovery requires its exact sender and open review case'
        USING ERRCODE = '55000';
    END IF;

    INSERT INTO platform.communication_messages (
      id,
      organization_id,
      conversation_id,
      student_case_id,
      sender_participant_id,
      direction,
      body_text,
      language,
      student_visible,
      message_identity_source,
      waha_session_name,
      waha_message_id,
      kommo_account_id,
      kommo_conversation_id,
      kommo_message_id,
      amocrm_account_id,
      amocrm_lead_id,
      amocrm_contact_id,
      source_webhook_event_id,
      manual_send_authorization_id,
      autonomous_reply_intent_id,
      created_at
    ) VALUES (
      created_message_id,
      request_row.organization_id,
      request_row.conversation_id,
      conversation_row.student_case_id,
      sender_participant.id,
      'outbound',
      authorization_row.final_text,
      source_message_row.language,
      TRUE,
      'private_manual_send_binding',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      source_message_row.source_webhook_event_id,
      authorization_row.id,
      NULL,
      p_provider_observed_at
    );

    INSERT INTO platform_private.manual_send_provider_bindings (
      organization_id,
      manual_send_authorization_id,
      durable_work_item_id,
      durable_work_attempt_id,
      communication_message_id,
      waha_session_name,
      raw_message_id,
      provider_observed_at
    ) VALUES (
      request_row.organization_id,
      authorization_row.id,
      work_item.id,
      attempt_row.id,
      created_message_id,
      request_row.waha_session_name,
      exact_provider_message_id,
      p_provider_observed_at
    );

    UPDATE platform.work_review_cases
    SET
      status = 'resolved',
      resolution = 'duplicate_suppressed',
      resolution_reason = request_row.reason,
      resolved_by_profile_id = request_row.requested_by_profile_id,
      resolved_by_membership_id = request_row.requested_by_membership_id,
      resolved_request_id = p_completion_request_id,
      resolved_at = statement_timestamp()
    WHERE organization_id = request_row.organization_id
      AND id = review_case.id;

    INSERT INTO platform.work_review_events (
      organization_id,
      work_review_case_id,
      event_type,
      actor_kind,
      actor_profile_id,
      actor_membership_id,
      actor_principal,
      before_state,
      after_state,
      reason,
      request_id
    ) VALUES (
      request_row.organization_id,
      review_case.id,
      'resolved',
      'user',
      request_row.requested_by_profile_id,
      request_row.requested_by_membership_id,
      request_row.requested_by_auth_user_id::TEXT,
      pg_catalog.jsonb_build_object(
        'status', 'open',
        'work_state', work_item.state
      ),
      pg_catalog.jsonb_build_object(
        'status', 'resolved',
        'resolution', 'duplicate_suppressed',
        'work_state', work_item.state,
        'send_triggered', FALSE
      ),
      request_row.reason,
      p_completion_request_id
    );

    INSERT INTO platform_private.durable_work_events (
      organization_id,
      work_item_id,
      attempt_id,
      event_type,
      previous_state,
      new_state,
      queue_message_id,
      evidence_ref,
      request_id
    ) VALUES (
      request_row.organization_id,
      work_item.id,
      attempt_row.id,
      'review_resolved',
      work_item.state,
      work_item.state,
      work_item.queue_message_id,
      'exact-waha-readback-recovered',
      p_completion_request_id
    );
  END IF;

  INSERT INTO platform_private.manual_whatsapp_reconciliation_results (
    organization_id,
    conversation_id,
    work_item_id,
    attempt_id,
    manual_send_authorization_id,
    request_id,
    completion_request_id,
    result_fingerprint,
    reconciliation_kind,
    outcome,
    communication_message_id,
    waha_session_name,
    recipient_sha256,
    final_text_sha256,
    provider_message_id,
    provider_source,
    ack_state,
    provider_observed_at,
    ack_observed_at,
    work_review_case_id
  ) VALUES (
    request_row.organization_id,
    request_row.conversation_id,
    request_row.work_item_id,
    request_row.attempt_id,
    request_row.manual_send_authorization_id,
    request_row.request_id,
    p_completion_request_id,
    result_fingerprint,
    request_row.reconciliation_kind,
    result_outcome,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE created_message_id END,
    request_row.waha_session_name,
    request_row.recipient_sha256,
    request_row.final_text_sha256,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE exact_provider_message_id END,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE exact_provider_source END,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE p_ack_state END,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE p_provider_observed_at END,
    CASE WHEN result_outcome = 'message_not_found' THEN NULL
      ELSE p_ack_observed_at END,
    CASE WHEN result_outcome = 'message_confirmed' THEN review_case.id
      ELSE NULL END
  )
  RETURNING * INTO result_record;

  RETURN pg_catalog.jsonb_build_object(
    'reconciliation_request_id', request_row.id,
    'organization_id', result_record.organization_id,
    'conversation_id', result_record.conversation_id,
    'attempt_id', result_record.attempt_id,
    'outcome', result_record.outcome,
    'communication_message_id', result_record.communication_message_id,
    'ack_name', CASE
      WHEN result_record.ack_state IS NULL THEN NULL
      ELSE pg_catalog.upper(result_record.ack_state::TEXT)
    END,
    'reconciliation_required', result_record.outcome = 'message_not_found',
    'replayed', FALSE
  );
END
$$;

REVOKE ALL ON TABLE
  platform_private.gemini_proposal_request_receipts,
  platform_private.manual_whatsapp_reconciliation_requests,
  platform_private.manual_whatsapp_reconciliation_results
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON TYPE
  platform.manual_whatsapp_reconciliation_kind,
  platform.manual_whatsapp_reconciliation_outcome
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.request_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    INTEGER,
    TEXT,
    TEXT
  ),
  platform.begin_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    INTEGER,
    TEXT
  ),
  platform_private.gemini_proposal_is_staff_bound(UUID, UUID),
  platform_private.require_staff_bound_gemini_result(),
  platform_private.staff_gemini_proposal_pre_p5a_internal(UUID, UUID),
  platform_private.review_gemini_proposal_pre_p5a_internal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    JSONB,
    TEXT
  ),
  platform.staff_gemini_proposal(UUID, UUID),
  platform.review_gemini_proposal(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    JSONB,
    TEXT
  ),
  platform.staff_gemini_proposal_reviews(UUID, UUID, INTEGER),
  platform.staff_latest_manual_whatsapp_send_attempt(UUID, UUID),
  platform.request_manual_whatsapp_reconciliation(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT
  ),
  platform.manual_whatsapp_reconciliation_context(UUID),
  platform.finish_manual_whatsapp_reconciliation(
    UUID,
    TEXT,
    TEXT,
    TEXT,
    INTEGER,
    TEXT,
    TEXT,
    platform.waha_ack_state,
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.request_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.begin_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION platform.staff_gemini_proposal(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.review_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  JSONB,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_gemini_proposal_reviews(
  UUID,
  UUID,
  INTEGER
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_latest_manual_whatsapp_send_attempt(
  UUID,
  UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.request_manual_whatsapp_reconciliation(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.manual_whatsapp_reconciliation_context(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION platform.finish_manual_whatsapp_reconciliation(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  platform.waha_ack_state,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID
) TO service_role;

COMMENT ON TABLE platform_private.gemini_proposal_request_receipts IS
  'Append-only authenticated staff ledger that authorizes one later service Gemini begin.';
COMMENT ON FUNCTION platform.request_gemini_proposal(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  TEXT
) IS
  'Records one authenticated Gemini request ledger entry; provider execution remains service-only.';
COMMENT ON TABLE platform_private.manual_whatsapp_reconciliation_requests IS
  'Append-only authenticated staff ledger for exact WAHA readback requests.';
COMMENT ON TABLE platform_private.manual_whatsapp_reconciliation_results IS
  'Append-only exact WAHA readback results used to compute current effective send state.';
COMMENT ON FUNCTION platform.staff_latest_manual_whatsapp_send_attempt(
  UUID,
  UUID
) IS
  'Returns the current effective latest manual-send state, including exact readback evidence when present.';
COMMENT ON FUNCTION platform.request_manual_whatsapp_reconciliation(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT
) IS
  'Records one authenticated request to reconcile the latest manual WhatsApp send attempt.';
COMMENT ON FUNCTION platform.manual_whatsapp_reconciliation_context(UUID) IS
  'Returns exact private WAHA readback inputs to the service role only.';
COMMENT ON FUNCTION platform.finish_manual_whatsapp_reconciliation(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  platform.waha_ack_state,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  UUID
) IS
  'Records one exact idempotent service-only WAHA readback result without sending.';

COMMIT;
