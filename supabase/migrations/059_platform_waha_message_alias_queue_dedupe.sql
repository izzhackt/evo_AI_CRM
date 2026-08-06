-- Keep both verified WAHA message deliveries as immutable raw evidence while
-- allowing `message` and `message.any` to converge on one durable business
-- work item. All other attempts to bind a new source event to an existing
-- business key remain fail-closed.

CREATE OR REPLACE FUNCTION platform.enqueue_verified_webhook_work(
  p_organization_id UUID,
  p_source_webhook_event_id UUID,
  p_business_key_sha256 TEXT,
  p_max_attempts INTEGER,
  p_request_id UUID
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
  incoming_event platform_private.provider_webhook_events%ROWTYPE;
  existing_event platform_private.provider_webhook_events%ROWTYPE;
  normalized_business_key TEXT;
  input_sha256 TEXT;
  replayed JSONB;
  result JSONB;
  fixed_reason CONSTANT TEXT :=
    'Enqueue one validated pointer-only durable work item';
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.lock_p2g_request(p_request_id);

  normalized_business_key := lower(btrim(p_business_key_sha256));

  IF p_organization_id IS NULL
    OR p_source_webhook_event_id IS NULL
    OR normalized_business_key !~ '^[0-9a-f]{64}$'
    OR p_max_attempts NOT BETWEEN 1 AND 20
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
          'kind', 'provider_webhook_process'::platform.durable_work_kind,
          'source_webhook_event_id', p_source_webhook_event_id,
          'ai_draft_request_id', NULL,
          'manual_send_authorization_id', NULL,
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
    'enqueue_verified_webhook'::platform.durable_work_operation,
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  -- Use the same lock namespace and order as p2g_enqueue_work so concurrent
  -- alias deliveries cannot create two queue items or deadlock each other.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p2g:business:'
        || p_organization_id::TEXT
        || ':'
        || normalized_business_key,
      0
    )
  );

  SELECT *
  INTO source_match
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.source_webhook_event_id = p_source_webhook_event_id
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

  -- New work and exact-source replays retain the original queue contract.
  IF business_match.id IS NULL
    OR business_match.source_webhook_event_id = p_source_webhook_event_id
  THEN
    RETURN platform_private.p2g_enqueue_work(
      p_organization_id,
      'provider_webhook_process',
      p_source_webhook_event_id,
      NULL,
      NULL,
      normalized_business_key,
      p_max_attempts,
      p_request_id,
      'enqueue_verified_webhook'
    );
  END IF;

  SELECT *
  INTO incoming_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_webhook_event_id;

  SELECT *
  INTO existing_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = business_match.source_webhook_event_id;

  IF business_match.kind <> 'provider_webhook_process'
    OR business_match.max_attempts <> p_max_attempts
    OR incoming_event.id IS NULL
    OR existing_event.id IS NULL
    OR incoming_event.verification_status <> 'verified'
    OR existing_event.verification_status <> 'verified'
    OR incoming_event.provider <> 'waha'
    OR existing_event.provider <> 'waha'
    OR incoming_event.provider_account_ref <>
      existing_event.provider_account_ref
    OR incoming_event.waha_session_name IS DISTINCT FROM
      existing_event.waha_session_name
    OR incoming_event.payload_id <> existing_event.payload_id
    OR NOT (
      (
        incoming_event.event_type = 'message'
        AND existing_event.event_type = 'message.any'
      )
      OR (
        incoming_event.event_type = 'message.any'
        AND existing_event.event_type = 'message'
      )
    )
  THEN
    RAISE EXCEPTION
      'Only verified WAHA message aliases may share durable work'
      USING ERRCODE = '22023';
  END IF;

  result := jsonb_build_object(
    'organization_id', business_match.organization_id,
    'work_item_id', business_match.id,
    'kind', business_match.kind,
    'state', business_match.state,
    'queue_message_id', business_match.queue_message_id,
    'source_webhook_event_id', business_match.source_webhook_event_id,
    'ai_draft_request_id', business_match.ai_draft_request_id,
    'manual_send_authorization_id',
      business_match.manual_send_authorization_id,
    'business_key_sha256', business_match.business_key_sha256,
    'max_attempts', business_match.max_attempts,
    'deduplicated', TRUE,
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
    business_match.organization_id,
    business_match.id,
    'deduplicated',
    business_match.state,
    business_match.state,
    business_match.queue_message_id,
    'waha-message-alias-business-key:' || normalized_business_key,
    p_request_id
  );

  PERFORM platform_private.p2g_store_result(
    p_request_id,
    'enqueue_verified_webhook',
    input_sha256,
    business_match.organization_id,
    business_match.id,
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
    business_match.organization_id,
    'service',
    NULL,
    'service:platform-durable-work',
    'work.enqueue.deduplicate',
    'durable_work_item',
    business_match.id,
    jsonb_build_object('state', business_match.state),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

COMMENT ON FUNCTION platform.enqueue_verified_webhook_work(
  UUID,
  UUID,
  TEXT,
  INTEGER,
  UUID
) IS
  'Enqueues verified webhook work and safely coalesces WAHA message/message.any aliases by a shared business key.';
