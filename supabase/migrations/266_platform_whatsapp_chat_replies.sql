-- 266_platform_whatsapp_chat_replies.sql
--
-- Owner decision 2026-10-06: «Продажи → WhatsApp» becomes a full chat (like
-- WhatsApp Web) instead of the one-reply «Ответ и отправка» block. Staff answer
-- a customer with several messages in a row; every message stays a
-- server-authorized, idempotent (per click) and audited manual send whose
-- sender is the member who wrote it, and the CRM still only answers: the source
-- of every send is the latest inbound message of an open conversation.
--
-- What changes (patches in the 261 style: each installed source is pinned by
-- md5 to the definition it was written against, every fragment must occur
-- exactly once, and a postcondition proves the result; otherwise the migration
-- fails closed instead of guessing):
--
--  1. platform.request_manual_whatsapp_send_with_authorization accepts, besides
--     the unchanged v1 business key (one reply per inbound message), a v2 key
--     for a staff-authored message that also binds the request id:
--       sha256(json ["evo-platform-work-v2","manual_whatsapp_send",org,conv,
--                    source,"staff-authored",request_id])
--     so every click is its own work item, while a replay of the same request id
--     still returns the stored result (replay_audit, unchanged) and the same id
--     with another text is still refused. The latest-inbound rule, readiness
--     gate, authorization row, authority trigger, audit and author are untouched.
--     v1 stays accepted so the running application keeps working until the new
--     one is deployed.
--  2. The same request refuses (55000 duplicate_of_unresolved) a text whose
--     sha256 equals that of a send of the same conversation that is still on
--     its way (queued, claimed without a result) or UNRESOLVED (outcome
--     unknown_result, no provider binding, no SETTLED «not found»): the first
--     may already have reached, or still reach, the customer. «Settled» is
--     platform_private.manual_whatsapp_send_not_found_settled: an exact
--     readback that found nothing at least five minutes after the send
--     finished (a readback taken seconds after a provider timeout can miss a
--     message the provider is still sending; API echoes are not stored, 259).
--  3. platform_private.manual_whatsapp_send_attempt_states(org, conv): one row
--     per manual-send work item of a conversation (queued without an attempt,
--     prepared, accepted, unknown, rejected), with its source message and
--     whether a settled «not found» allows the text again. Private, no grants.
--  4. platform.request_manual_whatsapp_reconciliation looks the attempt up in
--     (3) instead of in the latest-attempt reader, so an OLDER unknown attempt
--     can be checked without a resend. Its read guard (communication.read.full
--     on the conversation) is kept explicitly; everything after it is unchanged.
--     4b. platform.manual_whatsapp_reconciliation_bound_message_ids(request):
--     provider ids of OTHER CRM sends of the chat around the readback window,
--     which the readback must not take for its own (the same short text sent
--     twice). Service role only.
--  5. platform.staff_whatsapp_chat_state(org, conv, limit): the latest inbound
--     message, the newest message and the non-accepted send attempts of one
--     conversation (text, author, time, failure, latest readback outcome,
--     source, settled), with the latest-attempt reader's guards. EXECUTE for
--     authenticated only.
--  6. platform.staff_whatsapp_message_page(org, conv, limit, before_at,
--     before_id): the v1 page (called as is, so its guards and columns stay the
--     authority) plus origin (client | crm | phone | history | other, from
--     message_identity_source) and, for a CRM message, the author's name and
--     membership. v1 is untouched. EXECUTE for authenticated only.
--  7. D2: the exact claim's queue head is per CONVERSATION, not per
--     organization. Order still holds inside a chat; a stuck item blocks only
--     its own chat. platform.claim_manual_whatsapp_send_item looks for the head
--     among the items of the requested item's conversation and then claims
--     exactly that item through a new 5-argument overload of
--     platform_private.claim_next_manual_whatsapp_send_internal (the 4-argument
--     one is generated from, and stays byte-identical to, its installed source;
--     the overload adds only `item.id = p_exact_work_item_id` to the candidate).
--     A send that nobody claimed within 60 s of its request (its author's
--     action died between the request and the claim, or its claim can never
--     pass) no longer holds the chat: it stays queued for its author's own
--     retry with the same request id and is never sent by anyone else. An
--     item whose lease expired still heads the chat; any member's exact claim
--     of it only turns it into an unknown result (no send).
--
-- RLS, audit actions, grants of existing routines, the WAHA runtime, the
-- finish/reconcile completion and the readers' authority are unchanged.
--
-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--       https://www.postgresql.org/docs/current/plpgsql-control-structures.html
--       https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker

BEGIN;

-- 2 (the one definition of «settled»): an unknown attempt whose exact readback
-- found nothing at least five minutes after the send finished. A readback
-- taken earlier can miss a message the provider was still sending when the
-- application gave up waiting (WAHA's 20 s timeout), and API echoes are not
-- stored by ingress (259), so a late delivery never shows in the transcript:
-- only a settled «not found» lets the same text be sent again.
CREATE FUNCTION platform_private.manual_whatsapp_send_not_found_settled(
  p_organization_id UUID,
  p_attempt_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.durable_work_attempts AS attempt
    JOIN platform_private.manual_whatsapp_reconciliation_results AS readback
      ON readback.organization_id = attempt.organization_id
     AND readback.attempt_id = attempt.id
     AND readback.outcome = 'message_not_found'
     AND readback.created_at >= attempt.finished_at + INTERVAL '5 minutes'
    WHERE attempt.organization_id = p_organization_id
      AND attempt.id = p_attempt_id
      AND attempt.outcome = 'unknown_result'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.manual_send_provider_bindings AS binding
        WHERE binding.organization_id = attempt.organization_id
          AND binding.durable_work_item_id = attempt.work_item_id
      )
  )
$$;

REVOKE ALL ON FUNCTION platform_private.manual_whatsapp_send_not_found_settled(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

DO $n266_patch$
DECLARE
  patch RECORD;
  fragment RECORD;
  installed_source TEXT;
  definition TEXT;
  matches INTEGER;
BEGIN
  FOR patch IN
    SELECT *
    FROM (VALUES
      (1, 'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)',
        '3420c89a7d90a01cb3bcde182a42372a'),
      (2, 'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)',
        '3350080b59373334c21215779f45b398'),
      (3, 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
        '95d095c0c2023a910ff09ea5de98420a'),
      (4, 'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)',
        '2b4c64ee673a71e73ef1154595d5d825')
    ) AS pinned(ordinal, routine_signature, expected_md5)
    ORDER BY ordinal
  LOOP
    SELECT routine_row.prosrc INTO STRICT installed_source
    FROM pg_catalog.pg_proc AS routine_row
    WHERE routine_row.oid = patch.routine_signature::REGPROCEDURE;
    IF pg_catalog.md5(installed_source) IS DISTINCT FROM patch.expected_md5 THEN
      RAISE EXCEPTION 'whatsapp_chat_replies_source_drift: % is not the definition 266 was written against',
        patch.routine_signature USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- 7 (part one) must exist before the claim that calls it is replaced, and is
  -- generated from the pinned 4-argument source verified above.
  CREATE TEMP TABLE n266_fragments (
    ordinal INTEGER NOT NULL,
    routine_signature TEXT NOT NULL,
    old_fragment TEXT NOT NULL,
    new_fragment TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO n266_fragments VALUES
  -- 7: the exact-item overload of the internal claim.
  (1, 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
   $o$claim_next_manual_whatsapp_send_internal(p_organization_id uuid, p_visibility_timeout_seconds integer, p_worker_ref text, p_request_id uuid)$o$,
   $n$claim_next_manual_whatsapp_send_internal(p_organization_id uuid, p_visibility_timeout_seconds integer, p_worker_ref text, p_request_id uuid, p_exact_work_item_id uuid)$n$),
  (1, 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)',
   $o$      AND item.max_attempts = 1
      AND jsonb_typeof(queue_row.message) = 'object'$o$,
   $n$      AND item.max_attempts = 1
      AND item.id = p_exact_work_item_id
      AND jsonb_typeof(queue_row.message) = 'object'$n$),
  -- 1: the v2 business key of one staff-authored message.
  (2, 'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)',
   $o$  IF normalized_business_key <> expected_business_key THEN$o$,
   $n$  IF normalized_business_key <> expected_business_key
    AND (
      p_ai_draft_id IS NOT NULL
      OR p_request_id IS NULL
      OR normalized_business_key <> encode(
        sha256(
          convert_to(
            array_to_json(
              ARRAY[
                'evo-platform-work-v2',
                'manual_whatsapp_send',
                p_organization_id::TEXT,
                p_conversation_id::TEXT,
                p_source_message_id::TEXT,
                'staff-authored',
                p_request_id::TEXT
              ]
            )::TEXT,
            'UTF8'
          )
        ),
        'hex'
      )
    )
  THEN$n$),
  -- 2: never a second copy of a message whose first send is still on its way
  -- or has an unknown result that no settled readback has cleared.
  (2, 'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)',
   $o$  SELECT *
  INTO health
  FROM platform_private.require_ready_messaging_integration($o$,
   $n$  IF EXISTS (
    SELECT 1
    FROM platform.manual_send_authorizations AS unresolved_authorization
    JOIN platform_private.durable_work_items AS unresolved_item
      ON unresolved_item.organization_id = unresolved_authorization.organization_id
     AND unresolved_item.manual_send_authorization_id = unresolved_authorization.id
     AND unresolved_item.kind = 'manual_whatsapp_send'
    LEFT JOIN platform_private.durable_work_attempts AS unresolved_attempt
      ON unresolved_attempt.organization_id = unresolved_item.organization_id
     AND unresolved_attempt.work_item_id = unresolved_item.id
     AND unresolved_attempt.outcome = 'unknown_result'
    WHERE unresolved_authorization.organization_id = p_organization_id
      AND unresolved_authorization.conversation_id = p_conversation_id
      AND unresolved_authorization.final_text_sha256 = final_hash
      AND (
        unresolved_item.state IN ('queued', 'leased', 'retry_wait')
        OR (
          unresolved_attempt.id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM platform_private.manual_send_provider_bindings AS unresolved_binding
            WHERE unresolved_binding.organization_id = unresolved_item.organization_id
              AND unresolved_binding.durable_work_item_id = unresolved_item.id
          )
          AND NOT platform_private.manual_whatsapp_send_not_found_settled(
            unresolved_attempt.organization_id,
            unresolved_attempt.id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'duplicate_of_unresolved: the same text is still on its way or awaits a no-resend check in this conversation'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO health
  FROM platform_private.require_ready_messaging_integration($n$),
  -- 7: the queue head of the requested item's conversation, claimed exactly.
  (3, 'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)',
   $o$    AND item.max_attempts = 1
  ORDER BY queue_row.msg_id ASC
  LIMIT 1;$o$,
   $n$    AND item.max_attempts = 1
    AND EXISTS (
      SELECT 1
      FROM platform.manual_send_authorizations AS head_authorization
      JOIN platform_private.durable_work_items AS requested_item
        ON requested_item.organization_id = p_organization_id
       AND requested_item.id = p_work_item_id
       AND requested_item.kind = 'manual_whatsapp_send'
      JOIN platform.manual_send_authorizations AS requested_authorization
        ON requested_authorization.organization_id = requested_item.organization_id
       AND requested_authorization.id = requested_item.manual_send_authorization_id
      WHERE head_authorization.organization_id = item.organization_id
        AND head_authorization.id = item.manual_send_authorization_id
        AND head_authorization.conversation_id = requested_authorization.conversation_id
    )
    -- A send nobody claimed within a minute of its request (its author's
    -- action died before the claim, or its claim can never pass) no longer
    -- holds the chat. It stays queued for its author's own retry with the same
    -- request id and is never claimed or sent by anyone else.
    AND (
      item.id = p_work_item_id
      OR item.attempt_count > 0
      OR item.created_at > pg_catalog.clock_timestamp() - INTERVAL '60 seconds'
    )
  ORDER BY queue_row.msg_id ASC
  LIMIT 1;$n$),
  (3, 'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)',
   $o$  result := platform_private.claim_next_manual_whatsapp_send_internal(
    p_organization_id,
    p_visibility_timeout_seconds,
    exact_worker_ref,
    p_request_id
  );$o$,
   $n$  result := platform_private.claim_next_manual_whatsapp_send_internal(
    p_organization_id,
    p_visibility_timeout_seconds,
    exact_worker_ref,
    p_request_id,
    p_work_item_id
  );$n$);

  FOR patch IN
    SELECT DISTINCT ordinal, routine_signature FROM n266_fragments ORDER BY ordinal
  LOOP
    definition := pg_catalog.pg_get_functiondef(patch.routine_signature::REGPROCEDURE);
    FOR fragment IN
      SELECT * FROM n266_fragments
      WHERE n266_fragments.ordinal = patch.ordinal
      ORDER BY n266_fragments.old_fragment
    LOOP
      matches := (pg_catalog.length(definition)
        - pg_catalog.length(pg_catalog.replace(definition, fragment.old_fragment, '')))
        / pg_catalog.length(fragment.old_fragment);
      IF matches IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'whatsapp_chat_replies_source_drift: expected 1 fragment in %, found %',
          patch.routine_signature, matches USING ERRCODE = '55000';
      END IF;
      definition := pg_catalog.replace(definition, fragment.old_fragment, fragment.new_fragment);
    END LOOP;
    EXECUTE definition;
  END LOOP;
END
$n266_patch$;

-- The overload is private like its 4-argument original: only the owner runs it.
REVOKE ALL ON FUNCTION platform_private.claim_next_manual_whatsapp_send_internal(UUID, INTEGER, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- 3. Every manual-send work item of one conversation with its current state.
CREATE FUNCTION platform_private.manual_whatsapp_send_attempt_states(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  attempt_id UUID,
  work_item_id UUID,
  conversation_id UUID,
  manual_send_authorization_id UUID,
  final_text TEXT,
  final_text_sha256 TEXT,
  authorized_by_membership_id UUID,
  authorized_by_name TEXT,
  authorized_at TIMESTAMPTZ,
  request_id UUID,
  status TEXT,
  reconciliation_required BOOLEAN,
  failure_code TEXT,
  communication_message_id UUID,
  claimed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  latest_reconciliation_kind TEXT,
  latest_reconciliation_outcome TEXT,
  source_message_id UUID,
  readback_settled BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    attempt.id,
    item.id,
    authz.conversation_id,
    authz.id,
    authz.final_text,
    authz.final_text_sha256,
    authz.authorized_by_membership_id,
    profile.display_name,
    authz.authorized_at,
    request_audit.request_id,
    CASE
      WHEN binding.communication_message_id IS NOT NULL THEN 'accepted'
      WHEN attempt.outcome = 'succeeded' THEN 'accepted'
      WHEN attempt.outcome = 'unknown_result' THEN 'unknown'
      WHEN attempt.id IS NULL
        AND item.state IN ('queued', 'retry_wait') THEN 'queued'
      WHEN attempt.outcome IS NULL
        AND item.state IN ('queued', 'leased', 'retry_wait') THEN 'prepared'
      ELSE 'rejected'
    END,
    COALESCE(attempt.outcome = 'unknown_result'
      AND binding.communication_message_id IS NULL, FALSE),
    attempt.error_code,
    binding.communication_message_id,
    attempt.claimed_at,
    attempt.finished_at,
    readback.created_at,
    readback.reconciliation_kind::TEXT,
    readback.outcome::TEXT,
    authz.source_message_id,
    COALESCE(attempt.outcome = 'unknown_result'
      AND binding.communication_message_id IS NULL
      AND platform_private.manual_whatsapp_send_not_found_settled(item.organization_id, attempt.id), FALSE)
  FROM platform_private.durable_work_items AS item
  JOIN platform.manual_send_authorizations AS authz
    ON authz.organization_id = item.organization_id
   AND authz.id = item.manual_send_authorization_id
  JOIN platform.profiles AS profile
    ON profile.id = authz.authorized_by_profile_id
  LEFT JOIN LATERAL (
    SELECT attempt_row.*
    FROM platform_private.durable_work_attempts AS attempt_row
    WHERE attempt_row.organization_id = item.organization_id
      AND attempt_row.work_item_id = item.id
    ORDER BY attempt_row.attempt_number DESC, attempt_row.id DESC
    LIMIT 1
  ) AS attempt ON TRUE
  LEFT JOIN platform_private.manual_send_provider_bindings AS binding
    ON binding.organization_id = item.organization_id
   AND binding.durable_work_item_id = item.id
  LEFT JOIN LATERAL (
    SELECT result_row.created_at, result_row.reconciliation_kind, result_row.outcome
    FROM platform_private.manual_whatsapp_reconciliation_results AS result_row
    WHERE result_row.organization_id = item.organization_id
      AND result_row.attempt_id = attempt.id
    ORDER BY result_row.created_at DESC, result_row.id DESC
    LIMIT 1
  ) AS readback ON TRUE
  LEFT JOIN LATERAL (
    SELECT audit_row.request_id
    FROM platform.audit_events AS audit_row
    WHERE audit_row.organization_id = item.organization_id
      AND audit_row.resource_type = 'durable_work_item'
      AND audit_row.resource_id = item.id
      AND audit_row.action = 'communication.manual.send.request'
    ORDER BY audit_row.created_at, audit_row.id
    LIMIT 1
  ) AS request_audit ON TRUE
  WHERE item.organization_id = p_organization_id
    AND item.kind = 'manual_whatsapp_send'
    AND authz.conversation_id = p_conversation_id
$$;

REVOKE ALL ON FUNCTION platform_private.manual_whatsapp_send_attempt_states(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- 4. Reconcile the exact attempt the member asks for, not only the latest one.
DO $n266_reconcile$
DECLARE
  routine CONSTANT REGPROCEDURE :=
    'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)'::REGPROCEDURE;
  old_fragment CONSTANT TEXT := $o$  SELECT *
  INTO latest_attempt
  FROM platform.staff_latest_manual_whatsapp_send_attempt(
    p_organization_id,
    p_conversation_id
  )
  WHERE attempt_id = p_attempt_id;$o$;
  new_fragment CONSTANT TEXT := $n$  -- The guards of the latest-attempt reader this lookup used before 266.
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

  SELECT *
  INTO latest_attempt
  FROM platform_private.manual_whatsapp_send_attempt_states(
    p_organization_id,
    p_conversation_id
  ) AS attempt_state
  WHERE attempt_state.attempt_id = p_attempt_id;$n$;
  definition TEXT;
  matches INTEGER;
BEGIN
  IF (SELECT pg_catalog.md5(routine_row.prosrc) FROM pg_catalog.pg_proc AS routine_row
      WHERE routine_row.oid = routine) IS DISTINCT FROM '2b4c64ee673a71e73ef1154595d5d825'
  THEN
    RAISE EXCEPTION 'whatsapp_chat_replies_source_drift: request_manual_whatsapp_reconciliation changed'
      USING ERRCODE = '55000';
  END IF;
  definition := pg_catalog.pg_get_functiondef(routine);
  matches := (pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, old_fragment, '')))
    / pg_catalog.length(old_fragment);
  IF matches IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'whatsapp_chat_replies_source_drift: expected 1 reconciliation fragment, found %', matches
      USING ERRCODE = '55000';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_fragment, new_fragment);
END
$n266_reconcile$;

-- 4b. The provider ids the readback of an unknown attempt must not take for
-- its own: messages of OTHER CRM sends of the same chat around its window.
-- Several replies in a row make the same short text («Хорошо») within the
-- readback window likely; without this the readback would bind (and fail on)
-- another send's message. Service role only, like the reconciliation context.
CREATE FUNCTION platform.manual_whatsapp_reconciliation_bound_message_ids(
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
  attempt_row platform_private.durable_work_attempts%ROWTYPE;
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

  SELECT attempt.*
  INTO attempt_row
  FROM platform_private.durable_work_attempts AS attempt
  WHERE attempt.organization_id = request_row.organization_id
    AND attempt.id = request_row.attempt_id
    AND attempt.work_item_id = request_row.work_item_id;

  IF request_row.id IS NULL OR attempt_row.id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation request no longer matches canonical state'
      USING ERRCODE = '55000';
  END IF;

  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(bound.raw_message_id ORDER BY bound.raw_message_id)
    FROM (
      SELECT binding.raw_message_id
      FROM platform_private.manual_send_provider_bindings AS binding
      JOIN platform.manual_send_authorizations AS authz
        ON authz.organization_id = binding.organization_id
       AND authz.id = binding.manual_send_authorization_id
      WHERE binding.organization_id = request_row.organization_id
        AND authz.conversation_id = request_row.conversation_id
        AND binding.durable_work_item_id <> request_row.work_item_id
        AND binding.provider_observed_at
          BETWEEN attempt_row.claimed_at - INTERVAL '1 hour'
          AND COALESCE(attempt_row.finished_at, pg_catalog.statement_timestamp())
            + INTERVAL '1 hour'
      ORDER BY binding.provider_observed_at DESC, binding.id DESC
      LIMIT 200
    ) AS bound
  ), '[]'::JSONB);
END
$$;

REVOKE ALL ON FUNCTION platform.manual_whatsapp_reconciliation_bound_message_ids(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION platform.manual_whatsapp_reconciliation_bound_message_ids(UUID)
  TO service_role;

-- 5. The state of one chat for the staff page and its pulse.
CREATE FUNCTION platform.staff_whatsapp_chat_state(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  latest_inbound_message_id UUID,
  latest_inbound_at TIMESTAMPTZ,
  newest_message_id UUID,
  newest_message_at TIMESTAMPTZ,
  attempts JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_conversation_id IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
  THEN
    RAISE EXCEPTION 'Organization, conversation and a limit of 1..50 are required'
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
  SELECT
    latest_inbound.id,
    latest_inbound.created_at,
    newest.id,
    newest.created_at,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'attempt_id', state_row.attempt_id,
          'work_item_id', state_row.work_item_id,
          'request_id', state_row.request_id,
          'status', state_row.status,
          'reconciliation_required', state_row.reconciliation_required,
          'final_text', state_row.final_text,
          'authorized_by_membership_id', state_row.authorized_by_membership_id,
          'authorized_by_name', state_row.authorized_by_name,
          'authorized_at', state_row.authorized_at,
          'claimed_at', state_row.claimed_at,
          'failure_code', state_row.failure_code,
          'latest_reconciliation_outcome', state_row.latest_reconciliation_outcome,
          'last_reconciled_at', state_row.last_reconciled_at,
          'source_message_id', state_row.source_message_id,
          'readback_settled', state_row.readback_settled
        ) ORDER BY state_row.authorized_at, state_row.work_item_id)
      FROM (
        SELECT attempt_state.*
        FROM platform_private.manual_whatsapp_send_attempt_states(
          p_organization_id,
          p_conversation_id
        ) AS attempt_state
        WHERE attempt_state.status <> 'accepted'
        ORDER BY attempt_state.authorized_at DESC, attempt_state.work_item_id DESC
        LIMIT p_limit
      ) AS state_row
    ), '[]'::JSONB)
  FROM (SELECT 1) AS anchor
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.direction = 'inbound'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_inbound ON TRUE
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS newest ON TRUE;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_whatsapp_chat_state(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION platform.staff_whatsapp_chat_state(UUID, UUID, INTEGER)
  TO authenticated;

-- 6. The transcript page of the chat with the origin and CRM author of each message.
CREATE FUNCTION platform.staff_whatsapp_message_page(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_limit INTEGER,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_message_id UUID DEFAULT NULL
)
RETURNS TABLE (
  message_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  created_at TIMESTAMPTZ,
  media JSONB,
  waha_ack_name TEXT,
  waha_ack_observed_at TIMESTAMPTZ,
  origin TEXT,
  sender_name TEXT,
  sender_membership_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The v1 page decides access, limits and the cursor (and raises); this
  -- function only adds where each message came from.
  RETURN QUERY
  SELECT
    page.message_id,
    page.direction,
    page.body_text,
    page.created_at,
    page.media,
    page.waha_ack_name,
    page.waha_ack_observed_at,
    CASE
      WHEN message.message_identity_source = 'private_waha_history_binding' THEN 'history'
      WHEN page.direction = 'inbound' THEN 'client'
      WHEN message.message_identity_source = 'private_manual_send_binding' THEN 'crm'
      WHEN message.message_identity_source = 'private_waha_phone_binding' THEN 'phone'
      ELSE 'other'
    END,
    CASE
      WHEN message.message_identity_source = 'private_manual_send_binding'
        THEN author.display_name
      ELSE NULL
    END,
    CASE
      WHEN message.message_identity_source = 'private_manual_send_binding'
        THEN authz.authorized_by_membership_id
      ELSE NULL
    END
  FROM platform.staff_conversation_message_page(
    p_organization_id,
    p_conversation_id,
    p_limit,
    p_before_created_at,
    p_before_message_id
  ) AS page
  JOIN platform.communication_messages AS message
    ON message.organization_id = p_organization_id
   AND message.id = page.message_id
   AND message.conversation_id = p_conversation_id
  LEFT JOIN platform.manual_send_authorizations AS authz
    ON authz.organization_id = message.organization_id
   AND authz.id = message.manual_send_authorization_id
  LEFT JOIN platform.profiles AS author
    ON author.id = authz.authorized_by_profile_id
  ORDER BY page.created_at DESC, page.message_id DESC;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_whatsapp_message_page(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION platform.staff_whatsapp_message_page(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID)
  TO authenticated;

-- Postconditions: every patch is in place and every routine stays a hardened definer.
DO $n266_post$
DECLARE
  routine RECORD;
BEGIN
  FOR routine IN
    SELECT * FROM (VALUES
      ('platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)',
        '%evo-platform-work-v2%manual_whatsapp_send_not_found_settled(%duplicate_of_unresolved%', 'v', FALSE, TRUE),
      ('platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)',
        '%head_authorization.conversation_id = requested_authorization.conversation_id%INTERVAL ''60 seconds''%exact_worker_ref,%p_request_id,%', 'v', FALSE, FALSE),
      ('platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)',
        '%AND item.id = p_exact_work_item_id%', 'v', FALSE, FALSE),
      ('platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)',
        '%manual_whatsapp_send_attempt_states(%', 'v', FALSE, TRUE),
      ('platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)', '%manual_whatsapp_send_not_found_settled(%', 's', FALSE, FALSE),
      ('platform_private.manual_whatsapp_send_not_found_settled(uuid,uuid)', '%INTERVAL ''5 minutes''%', 's', FALSE, FALSE),
      ('platform.manual_whatsapp_reconciliation_bound_message_ids(uuid)', '%require_p2g_service()%', 's', FALSE, FALSE),
      ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)', '%', 's', FALSE, TRUE),
      ('platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)', '%', 's', FALSE, TRUE)
    ) AS expected(signature, source_like, volatility, anon_execute, authenticated_execute)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS routine_row
      WHERE routine_row.oid = routine.signature::REGPROCEDURE
        AND routine_row.prosecdef
        AND routine_row.provolatile = routine.volatility
        AND routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND routine_row.prosrc LIKE routine.source_like
        AND pg_catalog.pg_get_userbyid(routine_row.proowner) = 'postgres'
    )
      OR pg_catalog.has_function_privilege('anon', routine.signature::REGPROCEDURE, 'EXECUTE')
        IS DISTINCT FROM routine.anon_execute
      OR pg_catalog.has_function_privilege('authenticated', routine.signature::REGPROCEDURE, 'EXECUTE')
        IS DISTINCT FROM routine.authenticated_execute
    THEN
      RAISE EXCEPTION 'whatsapp_chat_replies_patch_not_applied: %', routine.signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- The 4-argument internal claim is left exactly as installed.
  IF (SELECT pg_catalog.md5(routine_row.prosrc) FROM pg_catalog.pg_proc AS routine_row
      WHERE routine_row.oid = 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)'::REGPROCEDURE)
    IS DISTINCT FROM '95d095c0c2023a910ff09ea5de98420a'
    OR pg_catalog.has_function_privilege('service_role',
      'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)'::REGPROCEDURE, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
      'platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)'::REGPROCEDURE, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
      'platform.staff_whatsapp_chat_state(uuid,uuid,integer)'::REGPROCEDURE, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role',
      'platform_private.manual_whatsapp_send_not_found_settled(uuid,uuid)'::REGPROCEDURE, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role',
      'platform.manual_whatsapp_reconciliation_bound_message_ids(uuid)'::REGPROCEDURE, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'whatsapp_chat_replies_patch_not_applied: private routines' USING ERRCODE = '55000';
  END IF;
END
$n266_post$;

COMMIT;
