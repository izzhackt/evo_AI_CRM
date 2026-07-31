-- ============================================================
-- 050_platform_messaging_workflow_controller_hardening.sql
--
-- P3C controller hardening, forward-only over migration 049:
--   - bind AI and manual-send state to the exact latest inbound cycle;
--   - support staff-written manual sends without requiring an AI draft;
--   - fail closed when provider-observed readiness is stale or implausibly
--     future-dated;
--   - expose only safe readiness metadata to browser-facing staff flows;
--   - remove superseded direct RPCs instead of leaving callable overloads.
--
-- No provider call, customer send, deployment or production mutation is
-- performed here.
-- ============================================================

BEGIN;

ALTER TABLE platform.manual_send_authorizations
  ADD COLUMN source_message_id UUID;

-- The table is append-only at runtime. A trusted forward migration may
-- backfill the source already fixed by each historical draft before restoring
-- the trigger and making the new identity mandatory.
ALTER TABLE platform.manual_send_authorizations
  DISABLE TRIGGER manual_send_authorizations_append_only;

UPDATE platform.manual_send_authorizations AS authz
SET source_message_id = draft.source_message_id
FROM platform.ai_drafts AS draft
WHERE draft.organization_id = authz.organization_id
  AND draft.id = authz.ai_draft_id
  AND draft.conversation_id = authz.conversation_id
  AND authz.source_message_id IS NULL;

ALTER TABLE platform.manual_send_authorizations
  ENABLE TRIGGER manual_send_authorizations_append_only;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform.manual_send_authorizations AS authz
    WHERE authz.source_message_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'manual-send source-message backfill is incomplete'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE platform.ai_drafts
  ADD CONSTRAINT ai_drafts_authorization_source_key
  UNIQUE (organization_id, id, conversation_id, source_message_id);

ALTER TABLE platform.manual_send_authorizations
  DROP CONSTRAINT manual_send_authorizations_draft_fkey;

ALTER TABLE platform.manual_send_authorizations
  ALTER COLUMN source_message_id SET NOT NULL,
  ALTER COLUMN ai_draft_id DROP NOT NULL,
  ADD CONSTRAINT manual_send_authorizations_source_message_fkey
    FOREIGN KEY (
      organization_id,
      source_message_id,
      conversation_id
    )
    REFERENCES platform.communication_messages(
      organization_id,
      id,
      conversation_id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT manual_send_authorizations_draft_fkey
    FOREIGN KEY (
      organization_id,
      ai_draft_id,
      conversation_id,
      source_message_id
    )
    REFERENCES platform.ai_drafts(
      organization_id,
      id,
      conversation_id,
      source_message_id
    )
    ON DELETE RESTRICT;

CREATE INDEX manual_send_authorizations_source_idx
  ON platform.manual_send_authorizations (
    organization_id,
    conversation_id,
    source_message_id,
    authorized_at DESC,
    id DESC
  );

ALTER TABLE platform_private.durable_work_items
  ADD CONSTRAINT durable_work_items_manual_send_single_attempt_check
  CHECK (
    kind <> 'manual_whatsapp_send'
    OR max_attempts = 1
  ) NOT VALID;

ALTER TABLE platform_private.durable_work_items
  VALIDATE CONSTRAINT durable_work_items_manual_send_single_attempt_check;

CREATE OR REPLACE FUNCTION platform_private.p3c_health_is_fresh(
  p_observed_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_observed_at IS NOT NULL
    AND p_observed_at >= statement_timestamp() - INTERVAL '5 minutes'
    AND p_observed_at <= statement_timestamp() + INTERVAL '1 minute'
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_p3c_health_observed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.observed_at > statement_timestamp() + INTERVAL '1 minute' THEN
    RAISE EXCEPTION
      'Messaging integration health observation exceeds clock-skew allowance'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER messaging_integration_health_events_observed_at_guard
  BEFORE INSERT
  ON platform_private.messaging_integration_health_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p3c_health_observed_at();

CREATE OR REPLACE FUNCTION platform_private.require_ready_messaging_integration(
  p_organization_id UUID,
  p_target platform.messaging_integration_target
)
RETURNS TABLE (
  readiness platform.messaging_integration_readiness,
  evidence_kind platform.messaging_integration_evidence_kind,
  reason TEXT,
  evidence_ref TEXT,
  observed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  health RECORD;
BEGIN
  SELECT *
  INTO health
  FROM platform_private.current_messaging_integration_health(
    p_organization_id,
    p_target
  );

  IF health.readiness IS DISTINCT FROM 'ready'
    OR health.evidence_kind IS DISTINCT FROM 'provider_observed'
    OR NOT platform_private.p3c_health_is_fresh(health.observed_at)
  THEN
    RAISE EXCEPTION
      '% integration is not fresh provider-observed ready',
      p_target::TEXT
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    health.readiness,
    health.evidence_kind,
    health.reason,
    health.evidence_ref,
    health.observed_at;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.guard_p3c_current_inbound_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform.communication_conversations AS conversation
  WHERE conversation.organization_id = NEW.organization_id
    AND conversation.id = NEW.conversation_id
    AND conversation.status = 'open'
  FOR UPDATE;

  IF NOT FOUND
    OR NOT EXISTS (
      SELECT 1
      FROM platform.communication_messages AS source_message
      WHERE source_message.organization_id = NEW.organization_id
        AND source_message.id = NEW.source_message_id
        AND source_message.conversation_id = NEW.conversation_id
        AND source_message.direction = 'inbound'
        AND NOT EXISTS (
          SELECT 1
          FROM platform.communication_messages AS later_message
          WHERE later_message.organization_id = NEW.organization_id
            AND later_message.conversation_id = NEW.conversation_id
            AND later_message.direction = 'inbound'
            AND (
              later_message.created_at,
              later_message.id
            ) > (
              source_message.created_at,
              source_message.id
            )
        )
    )
  THEN
    RAISE EXCEPTION
      'Messaging workflow state must reference the latest inbound message in an open conversation'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER ai_drafts_current_inbound_cycle_guard
  BEFORE INSERT OR UPDATE
  ON platform.ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p3c_current_inbound_cycle();

CREATE TRIGGER manual_send_authorizations_current_inbound_cycle_guard
  BEFORE INSERT
  ON platform.manual_send_authorizations
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p3c_current_inbound_cycle();

-- Replace the internal enqueue seam so both AI and manual work independently
-- prove that their source still belongs to the current inbound cycle. Manual
-- sends remain exactly-one-attempt; unknown outcomes therefore cannot enter an
-- automatic retry path.
CREATE OR REPLACE FUNCTION platform_private.p3c_enqueue_authenticated_work(
  p_organization_id UUID,
  p_kind platform.durable_work_kind,
  p_ai_draft_request_id UUID,
  p_manual_send_authorization_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID,
  p_operation platform.durable_work_operation,
  p_actor_profile_id UUID,
  p_actor_auth_user_id UUID,
  p_audit_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_match platform_private.durable_work_items%ROWTYPE;
  business_match platform_private.durable_work_items%ROWTYPE;
  existing_item platform_private.durable_work_items%ROWTYPE;
  source_exists BOOLEAN;
  normalized_business_key TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  created_work_item_id UUID := gen_random_uuid();
  queue_message_id BIGINT;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2g_request(p_request_id);

  normalized_business_key := lower(btrim(p_business_key_sha256));

  IF p_organization_id IS NULL
    OR p_kind NOT IN ('ai_draft_generate', 'manual_whatsapp_send')
    OR normalized_business_key !~ '^[0-9a-f]{64}$'
    OR p_max_attempts <> 1
    OR (
      p_kind = 'ai_draft_generate'
      AND (
        p_ai_draft_request_id IS NULL
        OR p_manual_send_authorization_id IS NOT NULL
        OR p_operation <> 'enqueue_ai_draft'
      )
    )
    OR (
      p_kind = 'manual_whatsapp_send'
      AND (
        p_ai_draft_request_id IS NOT NULL
        OR p_manual_send_authorization_id IS NULL
        OR p_operation <> 'enqueue_manual_whatsapp_send'
      )
    )
  THEN
    RAISE EXCEPTION
      'Valid organization, current source, business-key hash and single-attempt budget are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'kind', p_kind,
          'ai_draft_request_id', p_ai_draft_request_id,
          'manual_send_authorization_id', p_manual_send_authorization_id,
          'business_key_sha256', normalized_business_key,
          'max_attempts', p_max_attempts
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  replayed := platform_private.p2g_replay_request(
    p_request_id,
    p_operation,
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p3c:business:'
        || p_organization_id::TEXT
        || ':'
        || normalized_business_key,
      0
    )
  );

  IF p_kind = 'ai_draft_generate' THEN
    SELECT EXISTS (
      SELECT 1
      FROM platform.ai_draft_requests AS request
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = request.organization_id
        AND conversation.id = request.conversation_id
        AND conversation.status = 'open'
      JOIN platform.communication_messages AS source_message
        ON source_message.organization_id = request.organization_id
        AND source_message.id = request.source_message_id
        AND source_message.conversation_id = request.conversation_id
        AND source_message.direction = 'inbound'
      WHERE request.organization_id = p_organization_id
        AND request.id = p_ai_draft_request_id
        AND EXISTS (
          SELECT 1
          FROM platform.ai_draft_request_knowledge_selections AS selection
          WHERE selection.organization_id = request.organization_id
            AND selection.ai_draft_request_id = request.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM platform.ai_drafts AS draft
          WHERE draft.organization_id = request.organization_id
            AND draft.ai_draft_request_id = request.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM platform.communication_messages AS later_message
          WHERE later_message.organization_id = request.organization_id
            AND later_message.conversation_id = request.conversation_id
            AND later_message.direction = 'inbound'
            AND (
              later_message.created_at,
              later_message.id
            ) > (
              source_message.created_at,
              source_message.id
            )
        )
    )
    INTO source_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM platform.manual_send_authorizations AS authz
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = authz.organization_id
        AND conversation.id = authz.conversation_id
        AND conversation.status = 'open'
      JOIN platform.communication_messages AS source_message
        ON source_message.organization_id = authz.organization_id
        AND source_message.id = authz.source_message_id
        AND source_message.conversation_id = authz.conversation_id
        AND source_message.direction = 'inbound'
      LEFT JOIN platform.ai_drafts AS draft
        ON draft.organization_id = authz.organization_id
        AND draft.id = authz.ai_draft_id
        AND draft.conversation_id = authz.conversation_id
        AND draft.source_message_id = authz.source_message_id
      WHERE authz.organization_id = p_organization_id
        AND authz.id = p_manual_send_authorization_id
        AND (
          authz.ai_draft_id IS NULL
          OR draft.state = 'manual_send_authorized'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM platform.communication_messages AS later_message
          WHERE later_message.organization_id = authz.organization_id
            AND later_message.conversation_id = authz.conversation_id
            AND later_message.direction = 'inbound'
            AND (
              later_message.created_at,
              later_message.id
            ) > (
              source_message.created_at,
              source_message.id
            )
        )
    )
    INTO source_exists;
  END IF;

  IF NOT source_exists THEN
    RAISE EXCEPTION
      'Durable messaging work requires the exact current inbound cycle'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO source_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND (
      (
        p_kind = 'ai_draft_generate'
        AND item.ai_draft_request_id = p_ai_draft_request_id
      )
      OR (
        p_kind = 'manual_whatsapp_send'
        AND item.manual_send_authorization_id =
          p_manual_send_authorization_id
      )
    )
  FOR UPDATE;

  SELECT *
  INTO business_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.business_key_sha256 = normalized_business_key
  FOR UPDATE;

  IF source_match.id IS NOT NULL
    AND business_match.id IS NOT NULL
    AND source_match.id <> business_match.id
  THEN
    RAISE EXCEPTION
      'Source and business key already identify different work items'
      USING ERRCODE = '22023';
  END IF;

  IF source_match.id IS NOT NULL THEN
    existing_item := source_match;
  ELSE
    existing_item := business_match;
  END IF;

  IF existing_item.id IS NOT NULL THEN
    IF existing_item.kind <> p_kind
      OR existing_item.ai_draft_request_id IS DISTINCT FROM
        p_ai_draft_request_id
      OR existing_item.manual_send_authorization_id IS DISTINCT FROM
        p_manual_send_authorization_id
      OR existing_item.business_key_sha256 <> normalized_business_key
      OR existing_item.max_attempts <> 1
    THEN
      RAISE EXCEPTION
        'Existing durable work item does not match the requested enqueue shape'
        USING ERRCODE = '22023';
    END IF;

    result := jsonb_build_object(
      'organization_id', existing_item.organization_id,
      'work_item_id', existing_item.id,
      'kind', existing_item.kind,
      'state', existing_item.state,
      'queue_message_id', existing_item.queue_message_id,
      'source_webhook_event_id', existing_item.source_webhook_event_id,
      'ai_draft_request_id', existing_item.ai_draft_request_id,
      'manual_send_authorization_id',
        existing_item.manual_send_authorization_id,
      'business_key_sha256', existing_item.business_key_sha256,
      'max_attempts', existing_item.max_attempts,
      'deduplicated', TRUE,
      'queue_payload_is_pointer_only', TRUE
    );

    PERFORM platform_private.p2g_store_result(
      p_request_id,
      p_operation,
      input_sha256,
      existing_item.organization_id,
      existing_item.id,
      NULL,
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
      existing_item.organization_id,
      'user',
      p_actor_profile_id,
      p_actor_auth_user_id::TEXT,
      'work.enqueue.deduplicate',
      'durable_work_item',
      existing_item.id,
      jsonb_build_object('state', existing_item.state),
      result,
      btrim(p_audit_reason),
      p_request_id
    );

    RETURN result;
  END IF;

  SELECT pgmq.send(
    'platform_work_v1',
    jsonb_build_object(
      'v', 1,
      'organization_id', p_organization_id,
      'work_item_id', created_work_item_id,
      'kind', p_kind
    ),
    0
  )
  INTO queue_message_id;

  INSERT INTO platform_private.durable_work_items (
    id,
    organization_id,
    kind,
    ai_draft_request_id,
    manual_send_authorization_id,
    business_key_sha256,
    queue_message_id,
    max_attempts,
    request_id
  )
  VALUES (
    created_work_item_id,
    p_organization_id,
    p_kind,
    p_ai_draft_request_id,
    p_manual_send_authorization_id,
    normalized_business_key,
    queue_message_id,
    1,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'work_item_id', created_work_item_id,
    'kind', p_kind,
    'state', 'queued',
    'queue_message_id', queue_message_id,
    'source_webhook_event_id', NULL,
    'ai_draft_request_id', p_ai_draft_request_id,
    'manual_send_authorization_id', p_manual_send_authorization_id,
    'business_key_sha256', normalized_business_key,
    'max_attempts', 1,
    'deduplicated', FALSE,
    'queue_payload_is_pointer_only', TRUE
  );

  INSERT INTO platform_private.durable_work_events (
    organization_id,
    work_item_id,
    event_type,
    previous_state,
    new_state,
    queue_message_id,
    evidence_ref,
    request_id
  )
  VALUES (
    p_organization_id,
    created_work_item_id,
    'enqueued',
    NULL,
    'queued',
    queue_message_id,
    'business-key:' || normalized_business_key,
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    p_operation,
    input_sha256,
    p_organization_id,
    created_work_item_id,
    NULL,
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
    p_organization_id,
    'user',
    p_actor_profile_id,
    p_actor_auth_user_id::TEXT,
    'work.enqueue',
    'durable_work_item',
    created_work_item_id,
    NULL,
    result,
    btrim(p_audit_reason),
    p_request_id
  );

  RETURN result;
END
$$;

-- Remove the wrapper before its signature changes, then remove the two direct
-- authenticated APIs superseded by guarded P3C operations.
DROP FUNCTION platform.request_manual_whatsapp_send_with_authorization(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
);
DROP FUNCTION platform.request_ai_draft_with_knowledge(
  UUID,
  UUID,
  UUID,
  platform.ai_draft_language,
  UUID,
  TEXT,
  UUID
);
DROP FUNCTION platform.request_ai_draft(
  UUID,
  UUID,
  UUID,
  platform.ai_draft_language,
  TEXT,
  UUID
);
DROP FUNCTION platform.authorize_manual_send(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID
);

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
  health RECORD;
  child_request_id UUID;
  child_enqueue_request_id UUID;
  created_request_id UUID := gen_random_uuid();
  selection_row platform.ai_draft_request_knowledge_selections%ROWTYPE;
  enqueue_result JSONB;
  business_key_sha256 TEXT;
  replayed JSONB;
  request_result JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_source_message_id IS NULL
    OR p_selected_knowledge_version_id IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Current source, approved knowledge and explicit reason are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'ai.draft.request'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'ai.draft.request.knowledge',
    'ai_draft_request_knowledge_selection',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'requested_language', p_requested_language,
      'selected_knowledge_version_id', p_selected_knowledge_version_id,
      'selected_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
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
    RAISE EXCEPTION
      'Selected approved knowledge is unavailable'
      USING ERRCODE = '42501';
  END IF;

  child_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'request-ai-draft'
  );
  child_enqueue_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'enqueue-ai-draft'
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
    'requested_by_membership_id', actor.actor_membership_id
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
    btrim(p_reason),
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

  business_key_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'communication_conversation_id', p_conversation_id,
          'source_message_id', p_source_message_id,
          'requested_language', p_requested_language,
          'selected_knowledge_version_id', p_selected_knowledge_version_id
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

  result := request_result || jsonb_build_object(
    'selected_knowledge_version_id', p_selected_knowledge_version_id,
    'selected_knowledge_key', knowledge_row.knowledge_key,
    'selected_knowledge_version', knowledge_row.version,
    'selected_by_membership_id', actor.actor_membership_id,
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
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform.request_manual_whatsapp_send_with_authorization(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID,
  p_ai_draft_id UUID,
  p_final_text TEXT,
  p_reason TEXT,
  p_business_key_sha256 TEXT,
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
  draft_row platform.ai_drafts%ROWTYPE;
  health RECORD;
  created_authorization_id UUID := gen_random_uuid();
  child_authorize_request_id UUID;
  child_enqueue_request_id UUID;
  normalized_business_key TEXT;
  expected_business_key TEXT;
  final_hash TEXT;
  authorization_result JSONB;
  enqueue_result JSONB;
  result JSONB;
  replayed JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  normalized_business_key := lower(btrim(p_business_key_sha256));
  final_hash := encode(
    sha256(convert_to(btrim(p_final_text), 'UTF8')),
    'hex'
  );

  IF p_organization_id IS NULL
    OR p_conversation_id IS NULL
    OR p_source_message_id IS NULL
    OR p_final_text IS NULL
    OR btrim(p_final_text) = ''
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR normalized_business_key !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION
      'Conversation, current source, final text, reason and business key are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    p_conversation_id,
    'communication.manual.send'
  );

  expected_business_key := encode(
    sha256(
      convert_to(
        array_to_json(
          ARRAY[
            'evo-platform-work-v1',
            'manual_whatsapp_send',
            p_organization_id::TEXT,
            p_conversation_id::TEXT,
            p_source_message_id::TEXT,
            COALESCE(p_ai_draft_id::TEXT, 'staff-authored')
          ]
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  IF normalized_business_key <> expected_business_key THEN
    RAISE EXCEPTION
      'Manual-send business key does not match the immutable message cycle'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.manual.send.request',
    'durable_work_item',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'communication_conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'ai_draft_id', p_ai_draft_id,
      'final_text_sha256', final_hash,
      'business_key_sha256', normalized_business_key,
      'requested_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
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
      'Manual send source must be the latest inbound message in an open conversation'
      USING ERRCODE = '55000';
  END IF;

  IF p_ai_draft_id IS NOT NULL THEN
    SELECT *
    INTO draft_row
    FROM platform.ai_drafts AS draft
    WHERE draft.organization_id = p_organization_id
      AND draft.id = p_ai_draft_id
      AND draft.conversation_id = p_conversation_id
      AND draft.source_message_id = p_source_message_id
    FOR UPDATE;

    IF draft_row.id IS NULL
      OR draft_row.state <> 'ready_for_manual_send'
      OR draft_row.selected_language IS NULL
      OR draft_row.reviewed_text IS NULL
    THEN
      RAISE EXCEPTION
        'Optional AI draft must be human-reviewed and belong to the current inbound cycle'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT *
  INTO health
  FROM platform_private.require_ready_messaging_integration(
    p_organization_id,
    'waha'
  );

  child_authorize_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'authorize-manual-send'
  );
  child_enqueue_request_id := platform_private.p3c_request_child_id(
    p_request_id,
    'enqueue-manual-send'
  );

  INSERT INTO platform.manual_send_authorizations (
    id,
    organization_id,
    conversation_id,
    source_message_id,
    ai_draft_id,
    final_text,
    final_text_sha256,
    authorized_by_profile_id,
    authorized_by_membership_id,
    reason,
    request_id
  )
  VALUES (
    created_authorization_id,
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_ai_draft_id,
    btrim(p_final_text),
    final_hash,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    child_authorize_request_id
  );

  IF p_ai_draft_id IS NOT NULL THEN
    UPDATE platform.ai_drafts
    SET state = 'manual_send_authorized'
    WHERE organization_id = p_organization_id
      AND id = p_ai_draft_id;

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
      p_conversation_id,
      p_ai_draft_id,
      'manual_send_authorized',
      draft_row.state,
      'manual_send_authorized',
      draft_row.selected_language,
      draft_row.knowledge_version_id,
      'approved',
      btrim(p_final_text),
      'user',
      actor.actor_profile_id,
      actor.actor_membership_id,
      btrim(p_reason),
      child_authorize_request_id
    );
  END IF;

  authorization_result := jsonb_build_object(
    'organization_id', p_organization_id,
    'manual_send_authorization_id', created_authorization_id,
    'communication_conversation_id', p_conversation_id,
    'source_message_id', p_source_message_id,
    'ai_draft_id', p_ai_draft_id,
    'final_text', btrim(p_final_text),
    'final_text_sha256', final_hash,
    'authorized_by_membership_id', actor.actor_membership_id,
    'state', 'manual_send_authorized'
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
    'communication.manual.authorize',
    'manual_send_authorization',
    created_authorization_id,
    jsonb_build_object(
      'source_message_id', p_source_message_id,
      'ai_draft_state', CASE
        WHEN p_ai_draft_id IS NULL THEN NULL
        ELSE draft_row.state
      END
    ),
    authorization_result,
    btrim(p_reason),
    child_authorize_request_id
  );

  enqueue_result := platform_private.p3c_enqueue_authenticated_work(
    p_organization_id,
    'manual_whatsapp_send',
    NULL,
    created_authorization_id,
    normalized_business_key,
    1,
    child_enqueue_request_id,
    'enqueue_manual_whatsapp_send',
    actor.actor_profile_id,
    actor.actor_auth_user_id,
    'Enqueue one authorized manual WhatsApp send for the exact current inbound cycle'
  );

  result := authorization_result || jsonb_build_object(
    'requested_by_membership_id', actor.actor_membership_id,
    'work_item_id', enqueue_result -> 'work_item_id',
    'work_state', enqueue_result -> 'state',
    'queue_message_id', enqueue_result -> 'queue_message_id',
    'business_key_sha256', normalized_business_key,
    'waha_readiness', health.readiness,
    'waha_readiness_evidence_kind', health.evidence_kind,
    'waha_readiness_fresh', TRUE,
    'waha_readiness_observed_at', health.observed_at
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
    'communication.manual.send.request',
    'durable_work_item',
    (enqueue_result ->> 'work_item_id')::UUID,
    jsonb_build_object(
      'source_message_id', p_source_message_id,
      'ai_draft_id', p_ai_draft_id
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

-- The return shape changes, so PostgreSQL requires an explicit drop. The new
-- projection exposes safe freshness metadata but never private health reason
-- or evidence references.
DROP FUNCTION platform.staff_conversation_workflow(UUID, UUID);

CREATE OR REPLACE FUNCTION platform.staff_conversation_workflow(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  latest_inbound_message_id UUID,
  latest_inbound_body_text TEXT,
  latest_inbound_language platform.communication_message_language,
  latest_inbound_created_at TIMESTAMPTZ,
  selected_knowledge_version_id UUID,
  selected_knowledge_key TEXT,
  selected_knowledge_version BIGINT,
  selected_knowledge_title TEXT,
  selected_knowledge_content_sha256 TEXT,
  ai_readiness platform.messaging_integration_readiness,
  ai_readiness_evidence_kind platform.messaging_integration_evidence_kind,
  ai_readiness_fresh BOOLEAN,
  ai_readiness_observed_at TIMESTAMPTZ,
  waha_readiness platform.messaging_integration_readiness,
  waha_readiness_evidence_kind platform.messaging_integration_evidence_kind,
  waha_readiness_fresh BOOLEAN,
  waha_readiness_observed_at TIMESTAMPTZ,
  latest_ai_draft_request_id UUID,
  latest_ai_draft_request_created_at TIMESTAMPTZ,
  latest_ai_draft_request_reason TEXT,
  latest_ai_draft_requested_language platform.ai_draft_language,
  latest_ai_draft_id UUID,
  latest_ai_draft_state platform.ai_draft_state,
  latest_ai_draft_detection_status platform.ai_language_detection_status,
  latest_ai_draft_selected_language platform.ai_draft_language,
  latest_ai_draft_generated_text TEXT,
  latest_ai_draft_reviewed_text TEXT,
  latest_ai_draft_created_at TIMESTAMPTZ,
  latest_ai_draft_updated_at TIMESTAMPTZ,
  latest_ai_draft_failure_outcome TEXT,
  latest_manual_send_authorization_id UUID,
  latest_manual_send_final_text TEXT,
  latest_manual_send_authorized_at TIMESTAMPTZ,
  latest_outbox_work_item_id UUID,
  latest_outbox_kind platform.durable_work_kind,
  latest_outbox_work_state platform.durable_work_state,
  latest_outbox_attempt_count INTEGER,
  latest_outbox_max_attempts INTEGER,
  latest_outbox_available_at TIMESTAMPTZ,
  latest_outbox_updated_at TIMESTAMPTZ,
  latest_outbox_work_review_case_id UUID,
  latest_outbox_work_review_status platform.work_review_status,
  latest_outbox_observation_kind platform.provider_observation_kind,
  latest_outbox_observed_at TIMESTAMPTZ,
  latest_audit_action TEXT,
  latest_audit_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM platform.communication_conversations AS conversation
    WHERE conversation.organization_id = p_organization_id
      AND conversation.id = p_conversation_id
      AND private.platform_can_read_communication_full(
        conversation.organization_id,
        conversation.id
      )
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH latest_inbound AS MATERIALIZED (
    SELECT
      message.id,
      message.body_text,
      message.language,
      message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.direction = 'inbound'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ),
  latest_request AS MATERIALIZED (
    SELECT
      request.id,
      request.source_message_id,
      request.requested_at,
      request.reason,
      request.requested_language
    FROM latest_inbound AS inbound
    JOIN platform.ai_draft_requests AS request
      ON request.organization_id = p_organization_id
      AND request.conversation_id = p_conversation_id
      AND request.source_message_id = inbound.id
    ORDER BY request.requested_at DESC, request.id DESC
    LIMIT 1
  ),
  latest_selection AS MATERIALIZED (
    SELECT
      selection.ai_draft_request_id,
      selection.selected_knowledge_version_id,
      selection.selected_at
    FROM latest_request AS request
    JOIN platform.ai_draft_request_knowledge_selections AS selection
      ON selection.organization_id = p_organization_id
      AND selection.conversation_id = p_conversation_id
      AND selection.ai_draft_request_id = request.id
    ORDER BY selection.selected_at DESC, selection.id DESC
    LIMIT 1
  ),
  selected_knowledge AS MATERIALIZED (
    SELECT
      knowledge.id,
      knowledge.knowledge_key,
      knowledge.version,
      knowledge.title,
      knowledge.content_sha256
    FROM latest_selection
    JOIN platform.approved_knowledge_versions AS knowledge
      ON knowledge.organization_id = p_organization_id
      AND knowledge.id = latest_selection.selected_knowledge_version_id
  ),
  ai_health AS MATERIALIZED (
    SELECT *
    FROM platform_private.current_messaging_integration_health(
      p_organization_id,
      'ai'
    )
  ),
  waha_health AS MATERIALIZED (
    SELECT *
    FROM platform_private.current_messaging_integration_health(
      p_organization_id,
      'waha'
    )
  ),
  latest_draft AS MATERIALIZED (
    SELECT
      draft.id,
      draft.state,
      draft.detection_status,
      draft.selected_language,
      draft.generated_text,
      draft.reviewed_text,
      draft.created_at,
      draft.updated_at,
      draft.failure_outcome
    FROM latest_inbound AS inbound
    JOIN platform.ai_drafts AS draft
      ON draft.organization_id = p_organization_id
      AND draft.conversation_id = p_conversation_id
      AND draft.source_message_id = inbound.id
    ORDER BY draft.created_at DESC, draft.id DESC
    LIMIT 1
  ),
  latest_manual_auth AS MATERIALIZED (
    SELECT
      authz.id,
      authz.final_text,
      authz.authorized_at
    FROM latest_inbound AS inbound
    JOIN platform.manual_send_authorizations AS authz
      ON authz.organization_id = p_organization_id
      AND authz.conversation_id = p_conversation_id
      AND authz.source_message_id = inbound.id
    ORDER BY authz.authorized_at DESC, authz.id DESC
    LIMIT 1
  ),
  latest_outbox AS MATERIALIZED (
    SELECT
      item.id,
      item.kind,
      item.state,
      item.attempt_count,
      item.max_attempts,
      item.available_at,
      item.updated_at,
      review_case.id AS review_case_id,
      review_case.status AS review_status
    FROM platform_private.durable_work_items AS item
    LEFT JOIN platform.work_review_cases AS review_case
      ON review_case.organization_id = item.organization_id
      AND review_case.work_item_id = item.id
    WHERE item.organization_id = p_organization_id
      AND (
        item.ai_draft_request_id = (
          SELECT request.id
          FROM latest_request AS request
        )
        OR item.manual_send_authorization_id = (
          SELECT authz.id
          FROM latest_manual_auth AS authz
        )
      )
    ORDER BY item.created_at DESC, item.id DESC
    LIMIT 1
  ),
  latest_observation AS MATERIALIZED (
    SELECT
      event.observation_kind,
      event.observed_at
    FROM latest_manual_auth
    JOIN platform_private.provider_reconciliation_events AS event
      ON event.organization_id = p_organization_id
      AND event.manual_send_authorization_id = latest_manual_auth.id
    ORDER BY event.observed_at DESC, event.id DESC
    LIMIT 1
  ),
  latest_audit AS MATERIALIZED (
    SELECT
      event.action,
      event.created_at
    FROM latest_inbound AS inbound
    JOIN platform.audit_events AS event
      ON event.organization_id = p_organization_id
      AND event.after_state @> jsonb_build_object(
        'source_message_id',
        inbound.id
      )
      AND (
        event.after_state @> jsonb_build_object(
          'communication_conversation_id',
          p_conversation_id
        )
        OR event.after_state @> jsonb_build_object(
          'conversation_id',
          p_conversation_id
        )
      )
    ORDER BY
      event.created_at DESC,
      CASE
        WHEN event.action IN (
          'communication.manual.send.request',
          'ai.draft.request.knowledge'
        ) THEN 0
        ELSE 1
      END,
      event.id DESC
    LIMIT 1
  )
  SELECT
    p_conversation_id,
    inbound.id,
    inbound.body_text,
    inbound.language,
    inbound.created_at,
    knowledge.id,
    knowledge.knowledge_key,
    knowledge.version,
    knowledge.title,
    knowledge.content_sha256,
    ai.readiness,
    ai.evidence_kind,
    platform_private.p3c_health_is_fresh(ai.observed_at),
    ai.observed_at,
    waha.readiness,
    waha.evidence_kind,
    platform_private.p3c_health_is_fresh(waha.observed_at),
    waha.observed_at,
    draft_request.id,
    draft_request.requested_at,
    draft_request.reason,
    draft_request.requested_language,
    draft.id,
    draft.state,
    draft.detection_status,
    draft.selected_language,
    draft.generated_text,
    draft.reviewed_text,
    draft.created_at,
    draft.updated_at,
    draft.failure_outcome,
    manual_auth.id,
    manual_auth.final_text,
    manual_auth.authorized_at,
    outbox.id,
    outbox.kind,
    outbox.state,
    outbox.attempt_count,
    outbox.max_attempts,
    outbox.available_at,
    outbox.updated_at,
    outbox.review_case_id,
    outbox.review_status,
    observation.observation_kind,
    observation.observed_at,
    audit_row.action,
    audit_row.created_at
  FROM (SELECT 1) AS anchor
  LEFT JOIN latest_inbound AS inbound ON TRUE
  LEFT JOIN selected_knowledge AS knowledge ON TRUE
  LEFT JOIN ai_health AS ai ON TRUE
  LEFT JOIN waha_health AS waha ON TRUE
  LEFT JOIN latest_request AS draft_request ON TRUE
  LEFT JOIN latest_draft AS draft ON TRUE
  LEFT JOIN latest_manual_auth AS manual_auth ON TRUE
  LEFT JOIN latest_outbox AS outbox ON TRUE
  LEFT JOIN latest_observation AS observation ON TRUE
  LEFT JOIN latest_audit AS audit_row ON TRUE;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.p3c_health_is_fresh(TIMESTAMPTZ),
  platform_private.guard_p3c_health_observed_at(),
  platform_private.guard_p3c_current_inbound_cycle(),
  platform_private.require_ready_messaging_integration(
    UUID,
    platform.messaging_integration_target
  ),
  platform_private.p3c_enqueue_authenticated_work(
    UUID,
    platform.durable_work_kind,
    UUID,
    UUID,
    TEXT,
    INTEGER,
    UUID,
    platform.durable_work_operation,
    UUID,
    UUID,
    TEXT
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.request_ai_draft_with_knowledge(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    UUID,
    TEXT,
    UUID
  ),
  platform.request_manual_whatsapp_send_with_authorization(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_workflow(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.request_ai_draft_with_knowledge(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
    UUID,
    TEXT,
    UUID
  ),
  platform.request_manual_whatsapp_send_with_authorization(
    UUID,
    UUID,
    UUID,
    UUID,
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_workflow(UUID, UUID)
TO authenticated;

COMMENT ON COLUMN platform.manual_send_authorizations.source_message_id IS
  'Exact latest inbound message cycle authorized for one manual send.';
COMMENT ON FUNCTION platform.request_ai_draft_with_knowledge(
  UUID,
  UUID,
  UUID,
  platform.ai_draft_language,
  UUID,
  TEXT,
  UUID
) IS
  'Authenticated AI draft request bound to current inbound, fresh provider readiness and approved knowledge.';
COMMENT ON FUNCTION platform.request_manual_whatsapp_send_with_authorization(
  UUID,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'Authenticated direct-or-AI-assisted manual send bound to current inbound, stable business key and one-attempt outbox.';
COMMENT ON FUNCTION platform.staff_conversation_workflow(UUID, UUID) IS
  'Current-inbound workflow projection with safe readiness/freshness fields and no private health evidence.';

COMMIT;
