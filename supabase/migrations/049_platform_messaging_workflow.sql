-- ============================================================
-- 049_platform_messaging_workflow.sql
--
-- P3C: additive messaging workflow seam over the existing P2F/P2G
-- contracts. This migration adds:
--   - append-only private messaging integration health evidence;
--   - immutable approved-knowledge selection for AI draft requests;
--   - authenticated fail-closed wrappers for AI draft request + manual
--     WhatsApp enqueue without widening queue/private-table grants;
--   - safe workflow projection for one authorized conversation.
--
-- No provider call, send, delivery claim, health probe or production
-- mutation is performed here.
-- ============================================================

BEGIN;

CREATE TYPE platform.messaging_integration_target AS ENUM (
  'ai',
  'waha'
);

CREATE TYPE platform.messaging_integration_readiness AS ENUM (
  'ready',
  'blocked',
  'configured_unverified',
  'unconfigured'
);

CREATE TYPE platform.messaging_integration_evidence_kind AS ENUM (
  'configuration_check',
  'local_non_provider',
  'provider_observed'
);

CREATE TABLE platform_private.messaging_integration_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  target platform.messaging_integration_target NOT NULL,
  readiness platform.messaging_integration_readiness NOT NULL,
  evidence_kind platform.messaging_integration_evidence_kind NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  evidence_ref TEXT NOT NULL CHECK (btrim(evidence_ref) <> ''),
  request_id UUID NOT NULL UNIQUE,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT messaging_integration_health_events_organization_id_id_key
    UNIQUE (organization_id, id)
);

CREATE INDEX messaging_integration_health_events_target_idx
  ON platform_private.messaging_integration_health_events (
    organization_id,
    target,
    observed_at DESC,
    id DESC
  );

ALTER TABLE platform_private.messaging_integration_health_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.messaging_integration_health_events
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER messaging_integration_health_events_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.messaging_integration_health_events
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER messaging_integration_health_events_no_truncate
  BEFORE TRUNCATE
  ON platform_private.messaging_integration_health_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

ALTER TABLE platform.ai_draft_requests
  ADD CONSTRAINT ai_draft_requests_organization_request_conversation_key
  UNIQUE (organization_id, id, conversation_id);

CREATE TABLE platform.ai_draft_request_knowledge_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  ai_draft_request_id UUID NOT NULL,
  selected_knowledge_version_id UUID NOT NULL,
  selected_by_profile_id UUID NOT NULL,
  selected_by_membership_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  request_id UUID NOT NULL UNIQUE,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_draft_request_knowledge_selections_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT ai_draft_request_knowledge_selections_request_key
    UNIQUE (organization_id, ai_draft_request_id),
  CONSTRAINT ai_draft_request_knowledge_selections_parent_identity_key
    UNIQUE (organization_id, ai_draft_request_id, conversation_id),
  CONSTRAINT ai_draft_request_knowledge_selections_request_fkey
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
  CONSTRAINT ai_draft_request_knowledge_selections_knowledge_fkey
    FOREIGN KEY (organization_id, selected_knowledge_version_id)
    REFERENCES platform.approved_knowledge_versions(
      organization_id,
      id
    )
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_knowledge_selections_profile_fkey
    FOREIGN KEY (selected_by_profile_id)
    REFERENCES platform.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT ai_draft_request_knowledge_selections_membership_fkey
    FOREIGN KEY (organization_id, selected_by_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX ai_draft_request_knowledge_selections_conversation_idx
  ON platform.ai_draft_request_knowledge_selections (
    organization_id,
    conversation_id,
    selected_at DESC
  );

CREATE INDEX ai_draft_request_knowledge_selections_membership_idx
  ON platform.ai_draft_request_knowledge_selections (
    organization_id,
    selected_by_membership_id,
    selected_at DESC
  );

ALTER TABLE platform.ai_draft_request_knowledge_selections
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_draft_request_knowledge_selections
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER ai_draft_request_knowledge_selections_append_only
  BEFORE UPDATE OR DELETE
  ON platform.ai_draft_request_knowledge_selections
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER ai_draft_request_knowledge_selections_no_truncate
  BEFORE TRUNCATE
  ON platform.ai_draft_request_knowledge_selections
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.p3c_request_child_id(
  p_request_id UUID,
  p_suffix TEXT
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    substr(
      encode(
        sha256(convert_to(p_request_id::TEXT || ':' || p_suffix, 'UTF8')),
        'hex'
      ),
      1,
      8
    )
    || '-'
    || substr(
      encode(
        sha256(convert_to(p_request_id::TEXT || ':' || p_suffix, 'UTF8')),
        'hex'
      ),
      9,
      4
    )
    || '-'
    || substr(
      encode(
        sha256(convert_to(p_request_id::TEXT || ':' || p_suffix, 'UTF8')),
        'hex'
      ),
      13,
      4
    )
    || '-'
    || substr(
      encode(
        sha256(convert_to(p_request_id::TEXT || ':' || p_suffix, 'UTF8')),
        'hex'
      ),
      17,
      4
    )
    || '-'
    || substr(
      encode(
        sha256(convert_to(p_request_id::TEXT || ':' || p_suffix, 'UTF8')),
        'hex'
      ),
      21,
      12
    )
  )::UUID
$$;

CREATE OR REPLACE FUNCTION platform_private.current_messaging_integration_health(
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    latest.readiness,
    latest.evidence_kind,
    latest.reason,
    latest.evidence_ref,
    latest.observed_at
  FROM (
    SELECT
      event.readiness,
      event.evidence_kind,
      event.reason,
      event.evidence_ref,
      event.observed_at
    FROM platform_private.messaging_integration_health_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.target = p_target
    ORDER BY event.observed_at DESC, event.id DESC
    LIMIT 1
  ) AS latest;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'unconfigured'::platform.messaging_integration_readiness,
      NULL::platform.messaging_integration_evidence_kind,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ;
  END IF;
END
$$;

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
  THEN
    RAISE EXCEPTION
      '% integration is not provider-observed ready',
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

CREATE OR REPLACE FUNCTION platform_private.guard_p3c_selected_knowledge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  selection_row platform.ai_draft_request_knowledge_selections%ROWTYPE;
BEGIN
  SELECT *
  INTO selection_row
  FROM platform.ai_draft_request_knowledge_selections AS selection
  WHERE selection.organization_id = NEW.organization_id
    AND selection.ai_draft_request_id = NEW.ai_draft_request_id;

  IF selection_row.id IS NOT NULL
    AND NEW.knowledge_version_id IS DISTINCT FROM
      selection_row.selected_knowledge_version_id
  THEN
    RAISE EXCEPTION
      'AI draft must use the selected approved knowledge version'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER ai_drafts_selected_knowledge_guard
  BEFORE INSERT OR UPDATE OF ai_draft_request_id, knowledge_version_id
  ON platform.ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.guard_p3c_selected_knowledge();

CREATE POLICY ai_draft_request_knowledge_selections_full_read
  ON platform.ai_draft_request_knowledge_selections
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.platform_can_read_communication_full(
      organization_id,
      conversation_id
    ))
  );

GRANT SELECT
  ON TABLE platform.ai_draft_request_knowledge_selections
  TO authenticated;

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
  draft_request_exists BOOLEAN;
  manual_authorization_exists BOOLEAN;
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
    OR p_max_attempts NOT BETWEEN 1 AND 20
    OR (
      p_kind = 'ai_draft_generate'
      AND (
        p_ai_draft_request_id IS NULL
        OR p_manual_send_authorization_id IS NOT NULL
        OR p_max_attempts <> 1
        OR p_operation <> 'enqueue_ai_draft'
      )
    )
    OR (
      p_kind = 'manual_whatsapp_send'
      AND (
        p_ai_draft_request_id IS NOT NULL
        OR p_manual_send_authorization_id IS NULL
        OR p_max_attempts <> 1
        OR p_operation <> 'enqueue_manual_whatsapp_send'
      )
    )
  THEN
    RAISE EXCEPTION
      'Valid organization, source, business-key hash and retry budget are required'
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
    )
    INTO draft_request_exists;

    IF NOT draft_request_exists THEN
      RAISE EXCEPTION
        'AI work requires an existing request with selected knowledge and no recorded draft'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM platform.manual_send_authorizations AS manual_auth
      JOIN platform.ai_drafts AS draft
        ON draft.organization_id = manual_auth.organization_id
        AND draft.id = manual_auth.ai_draft_id
        AND draft.conversation_id = manual_auth.conversation_id
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = manual_auth.organization_id
        AND conversation.id = manual_auth.conversation_id
      WHERE manual_auth.organization_id = p_organization_id
        AND manual_auth.id = p_manual_send_authorization_id
        AND draft.state = 'manual_send_authorized'
        AND conversation.status = 'open'
    )
    INTO manual_authorization_exists;

    IF NOT manual_authorization_exists THEN
      RAISE EXCEPTION
        'Manual WhatsApp work requires one live reviewed authorization'
        USING ERRCODE = '55000';
    END IF;
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
      OR existing_item.max_attempts <> p_max_attempts
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
      'manual_send_authorization_id', existing_item.manual_send_authorization_id,
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
    p_max_attempts,
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
    'max_attempts', p_max_attempts,
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

CREATE OR REPLACE FUNCTION platform.record_messaging_integration_health_event(
  p_organization_id UUID,
  p_target platform.messaging_integration_target,
  p_readiness platform.messaging_integration_readiness,
  p_evidence_kind platform.messaging_integration_evidence_kind,
  p_reason TEXT,
  p_evidence_ref TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  replayed JSONB;
  created_event_id UUID := gen_random_uuid();
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Record append-only private messaging integration health evidence';
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION
      'Service role is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_organization_id IS NULL
    OR p_target IS NULL
    OR p_readiness IS NULL
    OR p_evidence_kind IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
    OR p_evidence_ref IS NULL
    OR btrim(p_evidence_ref) = ''
  THEN
    RAISE EXCEPTION
      'Complete messaging integration health evidence is required'
      USING ERRCODE = '22023';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'messaging.integration.health.record',
    'messaging_integration_health_event',
    NULL,
    fixed_reason,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'target', p_target,
      'readiness', p_readiness,
      'evidence_kind', p_evidence_kind,
      'reason', btrim(p_reason),
      'evidence_ref', btrim(p_evidence_ref)
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform_private.messaging_integration_health_events (
    id,
    organization_id,
    target,
    readiness,
    evidence_kind,
    reason,
    evidence_ref,
    request_id
  )
  VALUES (
    created_event_id,
    p_organization_id,
    p_target,
    p_readiness,
    p_evidence_kind,
    btrim(p_reason),
    btrim(p_evidence_ref),
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', p_organization_id,
    'messaging_integration_health_event_id', created_event_id,
    'target', p_target,
    'readiness', p_readiness,
    'evidence_kind', p_evidence_kind,
    'reason', btrim(p_reason),
    'evidence_ref', btrim(p_evidence_ref)
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
    'service:platform-messaging-health',
    'messaging.integration.health.record',
    'messaging_integration_health_event',
    created_event_id,
    NULL,
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

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
  knowledge_row platform.approved_knowledge_versions%ROWTYPE;
  health RECORD;
  child_request_id UUID;
  child_enqueue_request_id UUID;
  draft_request_result JSONB;
  draft_request_id UUID;
  selection_row platform.ai_draft_request_knowledge_selections%ROWTYPE;
  enqueue_result JSONB;
  business_key_sha256 TEXT;
  replayed JSONB;
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_selected_knowledge_version_id IS NULL
    OR p_reason IS NULL
    OR btrim(p_reason) = ''
  THEN
    RAISE EXCEPTION
      'Selected approved knowledge and explicit reason are required'
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

  draft_request_result := platform.request_ai_draft(
    p_organization_id,
    p_conversation_id,
    p_source_message_id,
    p_requested_language,
    p_reason,
    child_request_id
  );

  draft_request_id := (draft_request_result ->> 'ai_draft_request_id')::UUID;
  IF draft_request_id IS NULL THEN
    RAISE EXCEPTION
      'AI draft request wrapper expected ai_draft_request_id'
      USING ERRCODE = '55000';
  END IF;

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
    draft_request_id,
    p_selected_knowledge_version_id,
    actor.actor_profile_id,
    actor.actor_membership_id,
    btrim(p_reason),
    p_request_id
  )
  ON CONFLICT (organization_id, ai_draft_request_id) DO NOTHING;

  SELECT *
  INTO selection_row
  FROM platform.ai_draft_request_knowledge_selections AS selection
  WHERE selection.organization_id = p_organization_id
    AND selection.ai_draft_request_id = draft_request_id;

  IF selection_row.id IS NULL
    OR selection_row.selected_knowledge_version_id IS DISTINCT FROM
      p_selected_knowledge_version_id
    OR selection_row.request_id IS DISTINCT FROM p_request_id
  THEN
    RAISE EXCEPTION
      'AI draft request already has another selected knowledge record'
      USING ERRCODE = '22023';
  END IF;

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
    draft_request_id,
    NULL,
    business_key_sha256,
    1,
    child_enqueue_request_id,
    'enqueue_ai_draft',
    actor.actor_profile_id,
    actor.actor_auth_user_id,
    'Enqueue one AI draft generation after ready health check'
  );

  result := draft_request_result || jsonb_build_object(
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
    'ai_readiness_reason', health.reason,
    'ai_readiness_evidence_ref', health.evidence_ref,
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
  draft_row platform.ai_drafts%ROWTYPE;
  actor RECORD;
  health RECORD;
  child_authorize_request_id UUID;
  child_enqueue_request_id UUID;
  authorization_result JSONB;
  enqueue_result JSONB;
  result JSONB;
  replayed JSONB;
BEGIN
  PERFORM platform_private.lock_p2f_request(p_request_id);

  IF p_business_key_sha256 IS NULL
    OR lower(btrim(p_business_key_sha256)) !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION
      'Manual send requires a stable business-key hash'
      USING ERRCODE = '22023';
  END IF;

  -- Reject cross-organization callers before touching or locking a draft row.
  -- The later conversation-scoped check remains authoritative for object scope.
  SELECT *
  INTO actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'communication.manual.send'
  );

  SELECT *
  INTO draft_row
  FROM platform.ai_drafts AS draft
  WHERE draft.organization_id = p_organization_id
    AND draft.id = p_ai_draft_id
  FOR UPDATE;

  IF draft_row.id IS NULL THEN
    RAISE EXCEPTION
      'AI draft is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO actor
  FROM platform_private.require_communication_actor(
    p_organization_id,
    draft_row.conversation_id,
    'communication.manual.send'
  );

  replayed := platform_private.replay_audit(
    p_request_id,
    'communication.manual.send.request',
    'durable_work_item',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', p_organization_id,
      'ai_draft_id', p_ai_draft_id,
      'communication_conversation_id', draft_row.conversation_id,
      'business_key_sha256', lower(btrim(p_business_key_sha256)),
      'requested_by_membership_id', actor.actor_membership_id
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
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

  authorization_result := platform.authorize_manual_send(
    p_organization_id,
    p_ai_draft_id,
    p_final_text,
    p_reason,
    child_authorize_request_id
  );

  enqueue_result := platform_private.p3c_enqueue_authenticated_work(
    p_organization_id,
    'manual_whatsapp_send',
    NULL,
    (authorization_result ->> 'manual_send_authorization_id')::UUID,
    lower(btrim(p_business_key_sha256)),
    1,
    child_enqueue_request_id,
    'enqueue_manual_whatsapp_send',
    actor.actor_profile_id,
    actor.actor_auth_user_id,
    'Enqueue one authorized manual WhatsApp send after ready health check'
  );

  result := authorization_result || jsonb_build_object(
    'requested_by_membership_id', actor.actor_membership_id,
    'work_item_id', enqueue_result -> 'work_item_id',
    'work_state', enqueue_result -> 'state',
    'queue_message_id', enqueue_result -> 'queue_message_id',
    'business_key_sha256', lower(btrim(p_business_key_sha256)),
    'waha_readiness', health.readiness,
    'waha_readiness_evidence_kind', health.evidence_kind,
    'waha_readiness_reason', health.reason,
    'waha_readiness_evidence_ref', health.evidence_ref,
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
      'ai_draft_id', p_ai_draft_id
    ),
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

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
  ai_readiness_reason TEXT,
  ai_readiness_evidence_ref TEXT,
  ai_readiness_observed_at TIMESTAMPTZ,
  waha_readiness platform.messaging_integration_readiness,
  waha_readiness_evidence_kind platform.messaging_integration_evidence_kind,
  waha_readiness_reason TEXT,
  waha_readiness_evidence_ref TEXT,
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
  latest_selection AS MATERIALIZED (
    SELECT
      selection.ai_draft_request_id,
      selection.selected_knowledge_version_id,
      selection.selected_at
    FROM platform.ai_draft_request_knowledge_selections AS selection
    WHERE selection.organization_id = p_organization_id
      AND selection.conversation_id = p_conversation_id
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
  latest_request AS MATERIALIZED (
    SELECT
      request.id,
      request.requested_at,
      request.reason,
      request.requested_language
    FROM platform.ai_draft_requests AS request
    WHERE request.organization_id = p_organization_id
      AND request.conversation_id = p_conversation_id
    ORDER BY request.requested_at DESC, request.id DESC
    LIMIT 1
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
    FROM platform.ai_drafts AS draft
    WHERE draft.organization_id = p_organization_id
      AND draft.conversation_id = p_conversation_id
    ORDER BY draft.created_at DESC, draft.id DESC
    LIMIT 1
  ),
  latest_manual_auth AS MATERIALIZED (
    SELECT
      authz.id,
      authz.final_text,
      authz.authorized_at
    FROM platform.manual_send_authorizations AS authz
    WHERE authz.organization_id = p_organization_id
      AND authz.conversation_id = p_conversation_id
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
          SELECT selection.ai_draft_request_id
          FROM latest_selection AS selection
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
    FROM platform.audit_events AS event
    WHERE event.organization_id = p_organization_id
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
    -- The domain action and its internal enqueue audit share one statement
    -- timestamp. Prefer the operator-facing action for a stable projection.
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
    ai.reason,
    ai.evidence_ref,
    ai.observed_at,
    waha.readiness,
    waha.evidence_kind,
    waha.reason,
    waha.evidence_ref,
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

REVOKE ALL ON FUNCTION platform_private.p3c_request_child_id(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.current_messaging_integration_health(
    UUID,
    platform.messaging_integration_target
  )
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.require_ready_messaging_integration(
    UUID,
    platform.messaging_integration_target
  )
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
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
  platform.authorize_manual_send(
    UUID,
    UUID,
    TEXT,
    TEXT,
    UUID
  ),
  platform.record_messaging_integration_health_event(
    UUID,
    platform.messaging_integration_target,
    platform.messaging_integration_readiness,
    platform.messaging_integration_evidence_kind,
    TEXT,
    TEXT,
    UUID
  ),
  platform.request_ai_draft(
    UUID,
    UUID,
    UUID,
    platform.ai_draft_language,
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
  platform.request_manual_whatsapp_send_with_authorization(
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
  platform.record_messaging_integration_health_event(
    UUID,
    platform.messaging_integration_target,
    platform.messaging_integration_readiness,
    platform.messaging_integration_evidence_kind,
    TEXT,
    TEXT,
    UUID
  )
TO service_role;

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
    TEXT,
    TEXT,
    TEXT,
    UUID
  ),
  platform.staff_conversation_workflow(UUID, UUID)
TO authenticated;

COMMENT ON TABLE platform_private.messaging_integration_health_events IS
  'Private append-only messaging readiness evidence; no-row defaults to unconfigured.';
COMMENT ON TABLE platform.ai_draft_request_knowledge_selections IS
  'Immutable approved-knowledge choice for one AI draft request.';
COMMENT ON FUNCTION platform.request_ai_draft_with_knowledge(
  UUID,
  UUID,
  UUID,
  platform.ai_draft_language,
  UUID,
  TEXT,
  UUID
) IS
  'Authenticated fail-closed AI draft request with explicit approved-knowledge selection and ready-health gate.';
COMMENT ON FUNCTION platform.request_manual_whatsapp_send_with_authorization(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'Authenticated fail-closed manual-send authorization plus durable outbox enqueue after ready WAHA health.';
COMMENT ON FUNCTION platform.staff_conversation_workflow(UUID, UUID) IS
  'Conversation-scoped workflow projection with safe health, selected knowledge, latest draft, latest authorization and durable outbox state.';

COMMIT;
