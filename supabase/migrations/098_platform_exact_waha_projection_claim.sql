BEGIN;

-- Only an API-originated WAHA observation can settle a manual-send
-- reconciliation. Preserve any pre-098 append-only history with NOT VALID,
-- while the replacement constraint rejects every new/internal app-originated
-- settlement at the table boundary.
ALTER TABLE platform_private.manual_whatsapp_reconciliation_results
  DROP CONSTRAINT
    manual_whatsapp_reconciliation_results_provider_source_check;

ALTER TABLE platform_private.manual_whatsapp_reconciliation_results
  ADD CONSTRAINT manual_whatsapp_reconciliation_results_provider_source_check
  CHECK (provider_source IS NULL OR provider_source = 'api') NOT VALID;

-- Reject the invalid source before entering the historical implementation as
-- well. The private implementation and the table constraint remain independent
-- protections, so a future internal caller cannot bypass the durable rule.
ALTER FUNCTION platform.finish_manual_whatsapp_reconciliation(
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
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.finish_manual_whatsapp_reconciliation(
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
) RENAME TO finish_manual_whatsapp_reconciliation_internal;

REVOKE ALL ON FUNCTION
  platform_private.finish_manual_whatsapp_reconciliation_internal(
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
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_match_count = 1
    AND NULLIF(pg_catalog.btrim(p_provider_source), '') IS DISTINCT FROM 'api'
  THEN
    RAISE EXCEPTION
      'Matched WhatsApp reconciliation requires provider source api'
      USING ERRCODE = '22023';
  END IF;

  RETURN platform_private.finish_manual_whatsapp_reconciliation_internal(
    p_reconciliation_request_id,
    p_waha_session_name,
    p_raw_chat_id,
    p_final_text_sha256,
    p_match_count,
    p_provider_message_id,
    p_provider_source,
    p_ack_state,
    p_provider_observed_at,
    p_ack_observed_at,
    p_completion_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.finish_manual_whatsapp_reconciliation(
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
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

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

-- The historical WAHA claim functions selected the next eligible row in a
-- tenant queue. They are useful, proven lease machinery, but they are not a
-- safe synchronous webhook boundary: a request for work A could lease work B.
-- Keep both implementations private and expose one exact-item entrypoint.
ALTER FUNCTION platform.claim_waha_webhook_work(
  UUID,
  INTEGER,
  TEXT,
  UUID
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.claim_waha_webhook_work(
  UUID,
  INTEGER,
  TEXT,
  UUID
) RENAME TO claim_next_waha_message_work_internal;

ALTER FUNCTION platform.claim_waha_event_projection(
  UUID,
  INTEGER,
  TEXT,
  UUID
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.claim_waha_event_projection(
  UUID,
  INTEGER,
  TEXT,
  UUID
) RENAME TO claim_next_waha_observation_work_internal;

REVOKE ALL ON FUNCTION
  platform_private.claim_next_waha_message_work_internal(
    UUID,
    INTEGER,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform_private.claim_next_waha_observation_work_internal(
    UUID,
    INTEGER,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The original cross-kind durable claim remains useful for non-provider
-- workers. Move it behind a wrapper so provider_webhook_process can never be
-- returned through that generic public API. Raising after the private claim
-- rolls the lease, attempt, receipt and audit event back atomically.
ALTER FUNCTION platform.claim_durable_work(
  INTEGER,
  TEXT,
  UUID
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.claim_durable_work(
  INTEGER,
  TEXT,
  UUID
) RENAME TO claim_next_durable_work_internal;

REVOKE ALL ON FUNCTION platform_private.claim_next_durable_work_internal(
  INTEGER,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.claim_durable_work(
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
  result JSONB;
  result_work_item_id UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();

  -- Serialize the only generic public claim with the exact WAHA claim. This
  -- closes the check/use race in which the generic helper could otherwise see
  -- another kind first and then lease provider work after that row moved.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('evo:p5b:public-durable-claim', 0)
  );

  result := platform_private.claim_next_durable_work_internal(
    p_visibility_timeout_seconds,
    p_worker_ref,
    p_request_id
  );

  IF pg_catalog.jsonb_typeof(result) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'Durable claim returned an invalid envelope'
      USING ERRCODE = '55000';
  END IF;

  IF result ->> 'work_item_id' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    result_work_item_id := (result ->> 'work_item_id')::UUID;
  END IF;

  IF result ->> 'kind' = 'provider_webhook_process'
    OR EXISTS (
      SELECT 1
      FROM platform_private.durable_work_items AS item
      WHERE item.id = result_work_item_id
        AND item.kind = 'provider_webhook_process'
    )
  THEN
    RAISE EXCEPTION
      'Provider webhook work requires an exact-item claim'
      USING ERRCODE = '42501';
  END IF;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.claim_durable_work(
  INTEGER,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.claim_durable_work(
  INTEGER,
  TEXT,
  UUID
) TO service_role;

CREATE FUNCTION platform.claim_waha_webhook_work_item(
  p_organization_id UUID,
  p_work_item_id UUID,
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
  target_state TEXT;
  target_event_type TEXT;
  next_work_item_id UUID;
  exact_worker_ref TEXT;
  projection_completed BOOLEAN := FALSE;
  result JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_work_item_id IS NULL
    OR p_request_id IS NULL
    OR p_visibility_timeout_seconds NOT BETWEEN 1 AND 3600
    OR p_worker_ref IS NULL
    OR pg_catalog.btrim(p_worker_ref) = ''
    OR pg_catalog.char_length(pg_catalog.btrim(p_worker_ref)) > 160
    OR pg_catalog.btrim(p_worker_ref) ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Organization, work item, visibility timeout, worker and request are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT item.state::TEXT, source_event.event_type
  INTO target_state, target_event_type
  FROM platform_private.durable_work_items AS item
  JOIN platform_private.provider_webhook_events AS source_event
    ON source_event.organization_id = item.organization_id
   AND source_event.id = item.source_webhook_event_id
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id
    AND item.kind = 'provider_webhook_process'
    AND source_event.provider = 'waha'
    AND source_event.provider_account_ref = 'waha:evo-inbox'
    AND source_event.waha_session_name = 'evo-inbox'
    AND source_event.verification_status = 'verified'
    AND source_event.event_type IN ('message', 'message.any', 'message.ack');

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Only exact verified evo-inbox message or acknowledgement work may be claimed'
      USING ERRCODE = '42501';
  END IF;

  IF target_state = 'succeeded' THEN
    IF target_event_type IN ('message', 'message.any') THEN
      SELECT EXISTS (
        SELECT 1
        FROM platform_private.waha_work_projection_effects AS effect
        WHERE effect.organization_id = p_organization_id
          AND effect.work_item_id = p_work_item_id
          AND effect.disposition = 'succeeded'
      )
      INTO projection_completed;
    ELSE
      SELECT EXISTS (
        SELECT 1
        FROM platform_private.waha_event_projection_effects AS effect
        WHERE effect.organization_id = p_organization_id
          AND effect.work_item_id = p_work_item_id
          AND effect.event_type = 'message.ack'
          AND effect.disposition = 'succeeded'
      )
      INTO projection_completed;
    END IF;

    IF NOT projection_completed THEN
      RAISE EXCEPTION
        'Succeeded WAHA work has no matching successful projection effect'
        USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'completed', TRUE,
      'requested_work_item_id', p_work_item_id,
      'organization_id', p_organization_id,
      'work_item_id', p_work_item_id,
      'kind', 'provider_webhook_process',
      'event_type', target_event_type,
      'queue', 'platform_work_v1',
      'state', 'succeeded'
    );
  END IF;

  IF target_state NOT IN ('queued', 'leased', 'retry_wait') THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'completed', FALSE,
      'requested_work_item_id', p_work_item_id,
      'organization_id', p_organization_id,
      'work_item_id', p_work_item_id,
      'kind', 'provider_webhook_process',
      'event_type', target_event_type,
      'queue', 'platform_work_v1',
      'state', target_state
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('evo:p5b:public-durable-claim', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5b:waha-exact-claim:' || p_organization_id::TEXT,
      0
    )
  );

  IF target_event_type IN ('message', 'message.any') THEN
    SELECT item.id
    INTO next_work_item_id
    FROM pgmq.q_platform_work_v1 AS queue_row
    JOIN platform_private.durable_work_items AS item
      ON item.queue_message_id = queue_row.msg_id
     AND item.id::TEXT = queue_row.message ->> 'work_item_id'
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = item.organization_id
     AND source_event.id = item.source_webhook_event_id
    WHERE queue_row.vt <= pg_catalog.clock_timestamp()
      AND item.organization_id = p_organization_id
      AND item.kind = 'provider_webhook_process'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:evo-inbox'
      AND source_event.waha_session_name = 'evo-inbox'
      AND source_event.verification_status = 'verified'
      AND source_event.event_type IN ('message', 'message.any')
      AND pg_catalog.jsonb_typeof(queue_row.message) = 'object'
      AND queue_row.message ?& ARRAY['v', 'work_item_id', 'kind']
      AND queue_row.message - ARRAY['v', 'work_item_id', 'kind'] =
        '{}'::JSONB
      AND queue_row.message ->> 'v' = '1'
      AND queue_row.message ->> 'kind' = 'provider_webhook_process'
    ORDER BY queue_row.msg_id ASC
    LIMIT 1;
  ELSE
    -- Match the migration-063 observation helper exactly. It can see legacy
    -- session.status rows, so an older such row makes this ACK claim fail
    -- closed rather than allowing the helper to lease the wrong item.
    SELECT item.id
    INTO next_work_item_id
    FROM pgmq.q_platform_work_v1 AS queue_row
    JOIN platform_private.durable_work_items AS item
      ON item.queue_message_id = queue_row.msg_id
     AND item.id::TEXT = queue_row.message ->> 'work_item_id'
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = item.organization_id
     AND source_event.id = item.source_webhook_event_id
    WHERE queue_row.vt <= pg_catalog.clock_timestamp()
      AND item.organization_id = p_organization_id
      AND item.kind = 'provider_webhook_process'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:evo-inbox'
      AND source_event.waha_session_name = 'evo-inbox'
      AND source_event.verification_status = 'verified'
      AND source_event.event_type IN (
        'message',
        'message.any',
        'message.ack',
        'session.status'
      )
      AND pg_catalog.jsonb_typeof(queue_row.message) = 'object'
      AND queue_row.message ?& ARRAY['v', 'work_item_id', 'kind']
      AND queue_row.message - ARRAY['v', 'work_item_id', 'kind'] =
        '{}'::JSONB
      AND queue_row.message ->> 'v' = '1'
      AND queue_row.message ->> 'kind' = 'provider_webhook_process'
    ORDER BY queue_row.msg_id ASC
    LIMIT 1;
  END IF;

  IF next_work_item_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'completed', FALSE,
      'requested_work_item_id', p_work_item_id,
      'organization_id', p_organization_id,
      'work_item_id', p_work_item_id,
      'kind', 'provider_webhook_process',
      'event_type', target_event_type,
      'queue', 'platform_work_v1',
      'state', target_state
    );
  END IF;

  IF next_work_item_id <> p_work_item_id THEN
    RAISE EXCEPTION
      'Requested WAHA work is not the next eligible item'
      USING ERRCODE = '55000';
  END IF;

  exact_worker_ref := pg_catalog.btrim(p_worker_ref)
    || ':'
    || p_work_item_id::TEXT;

  IF target_event_type IN ('message', 'message.any') THEN
    result := platform_private.claim_next_waha_message_work_internal(
      p_organization_id,
      p_visibility_timeout_seconds,
      exact_worker_ref,
      p_request_id
    );
  ELSE
    result := platform_private.claim_next_waha_observation_work_internal(
      p_organization_id,
      p_visibility_timeout_seconds,
      exact_worker_ref,
      p_request_id
    );
  END IF;

  IF result ? 'work_item_id'
    AND result ->> 'work_item_id' IS DISTINCT FROM p_work_item_id::TEXT
  THEN
    RAISE EXCEPTION
      'Exact WAHA claim returned a different work item'
      USING ERRCODE = '55000';
  END IF;

  RETURN result || pg_catalog.jsonb_build_object(
    'completed', FALSE,
    'requested_work_item_id', p_work_item_id,
    'organization_id', p_organization_id,
    'work_item_id', p_work_item_id,
    'kind', 'provider_webhook_process',
    'event_type', target_event_type,
    'queue', 'platform_work_v1'
  );
END
$$;

REVOKE ALL ON FUNCTION platform.claim_waha_webhook_work_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.claim_waha_webhook_work_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) TO service_role;

COMMENT ON FUNCTION platform.claim_durable_work(
  INTEGER,
  TEXT,
  UUID
) IS
  'Generic durable claim retained for non-provider kinds; provider_webhook_process is rejected transactionally and must use the exact WAHA claim.';

COMMENT ON FUNCTION platform.claim_waha_webhook_work_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) IS
  'Claims exactly one verified evo-inbox message/ACK work item, fails if a helper would select another row, and returns completed only after a matching successful projection.';

COMMIT;
