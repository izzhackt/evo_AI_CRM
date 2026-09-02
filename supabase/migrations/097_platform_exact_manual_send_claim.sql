BEGIN;

-- P5B executes a staff-authorized send in the same request that created its
-- durable work item. The historical queue-wide claim could lease a different
-- organization's earlier authorization and therefore was not a safe UI
-- command boundary. Keep its proven lease machinery as a private helper, but
-- expose only an exact-work-item claim to the V2 runtime.
ALTER FUNCTION platform.claim_manual_whatsapp_send(
  UUID,
  INTEGER,
  TEXT,
  UUID
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.claim_manual_whatsapp_send(
  UUID,
  INTEGER,
  TEXT,
  UUID
) RENAME TO claim_next_manual_whatsapp_send_internal;

REVOKE ALL ON FUNCTION
  platform_private.claim_next_manual_whatsapp_send_internal(
    UUID,
    INTEGER,
    TEXT,
    UUID
  )
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION platform.claim_manual_whatsapp_send_item(
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
  next_work_item_id UUID;
  exact_worker_ref TEXT;
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

  -- Every exact claimant for this organization takes the same transaction
  -- lock. The private helper is not granted to any runtime role, so the queue
  -- head cannot change between this check and the proven lease operation.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'evo:p5b:manual-whatsapp-exact-claim:' || p_organization_id::TEXT,
      0
    )
  );

  SELECT item.id
  INTO next_work_item_id
  FROM pgmq.q_platform_work_v1 AS queue_row
  JOIN platform_private.durable_work_items AS item
    ON item.queue_message_id = queue_row.msg_id
   AND item.id::TEXT = queue_row.message ->> 'work_item_id'
  WHERE queue_row.vt <= pg_catalog.clock_timestamp()
    AND item.organization_id = p_organization_id
    AND item.kind = 'manual_whatsapp_send'
    AND item.state IN ('queued', 'leased', 'retry_wait')
    AND item.max_attempts = 1
    AND pg_catalog.jsonb_typeof(queue_row.message) = 'object'
    AND queue_row.message ?& ARRAY['v', 'work_item_id', 'kind']
    AND queue_row.message - ARRAY['v', 'work_item_id', 'kind'] = '{}'::JSONB
    AND queue_row.message ->> 'v' = '1'
    AND queue_row.message ->> 'kind' = 'manual_whatsapp_send'
  ORDER BY queue_row.msg_id ASC
  LIMIT 1;

  IF next_work_item_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'claimed', FALSE,
      'queue', 'platform_work_v1',
      'requested_work_item_id', p_work_item_id
    );
  END IF;

  IF next_work_item_id <> p_work_item_id THEN
    RAISE EXCEPTION
      'Requested manual-send work is not the next eligible item'
      USING ERRCODE = '55000';
  END IF;

  -- Binding the exact UUID into the worker reference also binds the existing
  -- request-replay fingerprint to this work item. Reusing the request UUID for
  -- another item therefore fails instead of silently authorizing it.
  exact_worker_ref := pg_catalog.btrim(p_worker_ref)
    || ':'
    || p_work_item_id::TEXT;

  result := platform_private.claim_next_manual_whatsapp_send_internal(
    p_organization_id,
    p_visibility_timeout_seconds,
    exact_worker_ref,
    p_request_id
  );

  IF COALESCE((result ->> 'claimed')::BOOLEAN, FALSE)
    AND result ->> 'work_item_id' <> p_work_item_id::TEXT
  THEN
    RAISE EXCEPTION
      'Manual-send claim returned a different work item'
      USING ERRCODE = '55000';
  END IF;

  RETURN result || pg_catalog.jsonb_build_object(
    'requested_work_item_id', p_work_item_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) TO service_role;

COMMENT ON FUNCTION platform.claim_manual_whatsapp_send_item(
  UUID,
  UUID,
  INTEGER,
  TEXT,
  UUID
) IS
  'Claims exactly one staff-authorized manual WhatsApp work item; a different queue head fails closed and the generic claim is private.';

COMMIT;
