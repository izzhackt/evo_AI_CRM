\set ON_ERROR_STOP on

-- Current-boundary acceptance through migration 097. Every identifier and secret
-- is synthetic and transaction-local. No WAHA, amoCRM, AI or managed Supabase
-- provider is contacted.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P8R4 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO service_role;

DO $$
DECLARE
  resolve_routine CONSTANT REGPROCEDURE :=
    'platform.resolve_manual_send_waha_runtime(uuid)'::REGPROCEDURE;
  claim_routine CONSTANT REGPROCEDURE :=
    'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)'::REGPROCEDURE;
  internal_claim_routine CONSTANT REGPROCEDURE :=
    'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)'::REGPROCEDURE;
  finish_routine CONSTANT REGPROCEDURE :=
    'platform.finish_manual_whatsapp_send(uuid,uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,timestamptz,uuid)'::REGPROCEDURE;
  provider_session_check TEXT;
  forbidden_role TEXT;
BEGIN
  IF pg_catalog.to_regprocedure(
      'platform.claim_manual_whatsapp_send(uuid,integer,text,uuid)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Superseded generic manual-send claim remains callable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension
    WHERE extension.extname = 'supabase_vault'
      AND extension.extnamespace = 'vault'::REGNAMESPACE
  ) THEN
    RAISE EXCEPTION 'Supabase Vault extension is not installed in vault';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid =
      'platform_private.manual_send_waha_runtime_bindings'::REGCLASS
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Manual-send WAHA runtime binding is not forced-RLS';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'platform_private.manual_send_waha_runtime_bindings'::REGCLASS
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'vault.secrets'::REGCLASS
  ) THEN
    RAISE EXCEPTION 'WAHA API key is not referenced from Vault';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = resolve_routine::OID
      AND routine.prosecdef
      AND routine.provolatile = 's'
      AND routine.proretset
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Runtime resolver signature or hardened posture drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    resolve_routine,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role lacks runtime resolver EXECUTE';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    claim_routine,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role lacks exact manual-send claim EXECUTE';
  END IF;

  IF pg_catalog.has_function_privilege(
    'service_role',
    internal_claim_routine,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role can bypass the exact manual-send claim';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      resolve_routine,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the Vault runtime resolver', forbidden_role;
    END IF;

    IF pg_catalog.has_function_privilege(
      forbidden_role,
      claim_routine,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the exact manual-send claim', forbidden_role;
    END IF;
  END LOOP;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'service_role'
  ] LOOP
    IF pg_catalog.has_table_privilege(
      forbidden_role,
      'platform_private.manual_send_waha_runtime_bindings',
      'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
      RAISE EXCEPTION '% has direct runtime-binding table access', forbidden_role;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO provider_session_check
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid =
    'platform_private.manual_send_provider_bindings'::REGCLASS
    AND constraint_row.conname =
      'manual_send_provider_bindings_waha_session_name_check';

  IF provider_session_check IS NULL
    OR provider_session_check NOT LIKE '%evo-inbox%'
    OR provider_session_check LIKE '%crm_primary%'
  THEN
    RAISE EXCEPTION 'Manual-send provider binding is not exact evo-inbox';
  END IF;

  IF pg_catalog.pg_get_functiondef(claim_routine::OID) LIKE '%crm_primary%'
    OR pg_catalog.pg_get_functiondef(finish_routine::OID) LIKE '%crm_primary%'
    OR pg_catalog.pg_get_functiondef(claim_routine::OID)
      NOT LIKE '%claim_next_manual_whatsapp_send_internal%'
    OR pg_catalog.pg_get_functiondef(internal_claim_routine::OID)
      NOT LIKE '%ensure-manual-sender-participant%'
    OR pg_catalog.pg_get_functiondef(finish_routine::OID)
      NOT LIKE '%participant_kind IN (''admin'', ''sales'', ''curator'')%'
  THEN
    RAISE EXCEPTION 'Active manual-send claim/finish contract drifted';
  END IF;
END
$$;

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform_private.durable_work_items AS item
    JOIN platform.manual_send_authorizations AS authorization_row
      ON authorization_row.organization_id = item.organization_id
     AND authorization_row.id = item.manual_send_authorization_id
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = authorization_row.organization_id
     AND conversation.id = authorization_row.conversation_id
    JOIN platform.communication_messages AS source_message
      ON source_message.organization_id = authorization_row.organization_id
     AND source_message.id = authorization_row.source_message_id
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = source_message.organization_id
     AND source_event.id = source_message.source_webhook_event_id
    JOIN platform.organization_memberships AS sender_membership
      ON sender_membership.organization_id = authorization_row.organization_id
     AND sender_membership.id = authorization_row.authorized_by_membership_id
    WHERE item.kind = 'manual_whatsapp_send'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND item.max_attempts = 1
      AND conversation.waha_session_name = 'evo-inbox'
      AND source_message.direction = 'inbound'
      AND source_event.verification_status = 'verified'
      AND sender_membership.status = 'active'
      AND sender_membership.current_role IN ('admin', 'sales', 'curator')
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.durable_work_attempts AS attempt
        WHERE attempt.organization_id = item.organization_id
          AND attempt.work_item_id = item.id
      )
  ),
  'No synthetic target-session manual-send fixture survived to migration 080'
);

SELECT
  item.organization_id::TEXT AS p8r4_org_id,
  item.id::TEXT AS p8r4_work_item_id,
  authorization_row.id::TEXT AS p8r4_authorization_id,
  authorization_row.conversation_id::TEXT AS p8r4_conversation_id,
  authorization_row.source_message_id::TEXT AS p8r4_source_message_id,
  authorization_row.authorized_by_membership_id::TEXT
    AS p8r4_sender_membership_id,
  sender_membership.current_role::TEXT AS p8r4_sender_role,
  source_message.source_webhook_event_id::TEXT AS p8r4_source_event_id
FROM platform_private.durable_work_items AS item
JOIN platform.manual_send_authorizations AS authorization_row
  ON authorization_row.organization_id = item.organization_id
 AND authorization_row.id = item.manual_send_authorization_id
JOIN platform.communication_conversations AS conversation
  ON conversation.organization_id = authorization_row.organization_id
 AND conversation.id = authorization_row.conversation_id
JOIN platform.communication_messages AS source_message
  ON source_message.organization_id = authorization_row.organization_id
 AND source_message.id = authorization_row.source_message_id
JOIN platform_private.provider_webhook_events AS source_event
  ON source_event.organization_id = source_message.organization_id
 AND source_event.id = source_message.source_webhook_event_id
JOIN platform.organization_memberships AS sender_membership
  ON sender_membership.organization_id = authorization_row.organization_id
 AND sender_membership.id = authorization_row.authorized_by_membership_id
WHERE item.kind = 'manual_whatsapp_send'
  AND item.state IN ('queued', 'leased', 'retry_wait')
  AND item.max_attempts = 1
  AND conversation.waha_session_name = 'evo-inbox'
  AND source_message.direction = 'inbound'
  AND source_event.verification_status = 'verified'
  AND sender_membership.status = 'active'
  AND sender_membership.current_role IN ('admin', 'sales', 'curator')
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.durable_work_attempts AS attempt
    WHERE attempt.organization_id = item.organization_id
      AND attempt.work_item_id = item.id
  )
ORDER BY item.created_at, item.id
LIMIT 1
\gset

SELECT pgmq.send(
  'platform_work_v1',
  jsonb_build_object(
    'v', 1,
    'work_item_id', :'p8r4_work_item_id',
    'kind', 'manual_whatsapp_send'
  ),
  0
)::TEXT AS p8r4_queue_message_id
\gset

-- Earlier exact-boundary suites intentionally exercise and may consume their
-- synthetic queue pointer. Rebind only this transaction-local fixture to a
-- fresh pointer so migration 080 executes the current claim contract.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.durable_work_items
SET queue_message_id = :'p8r4_queue_message_id',
    state = 'queued',
    attempt_count = 0,
    max_attempts = 1,
    available_at = pg_catalog.statement_timestamp(),
    leased_until = NULL,
    completed_at = NULL,
    updated_at = pg_catalog.statement_timestamp()
WHERE organization_id = :'p8r4_org_id'
  AND id = :'p8r4_work_item_id';
SET LOCAL session_replication_role = origin;

SELECT vault.create_secret(
  'synthetic-p8r4-private-waha-api-key',
  'p8r4-manual-send-waha-key',
  'Disposable migration-080 runtime acceptance only'
)::TEXT AS p8r4_vault_secret_id
\gset

INSERT INTO platform_private.manual_send_waha_runtime_bindings (
  organization_id,
  waha_session_name,
  waha_base_url,
  api_key_secret_id,
  api_key_sha256,
  enabled,
  binding_version
) VALUES (
  :'p8r4_org_id',
  'evo-inbox',
  'http://evo-crm-waha:3000',
  :'p8r4_vault_secret_id',
  pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('synthetic-p8r4-private-waha-api-key', 'UTF8')
    ),
    'hex'
  ),
  TRUE,
  1
);

DO $$
BEGIN
  BEGIN
    UPDATE platform_private.manual_send_waha_runtime_bindings
    SET waha_session_name = 'non-target-session';
    RAISE EXCEPTION 'Runtime binding accepted a non-target session';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;

  BEGIN
    UPDATE platform_private.manual_send_waha_runtime_bindings
    SET waha_base_url = 'https://public.example.invalid';
    RAISE EXCEPTION 'Runtime binding accepted a public provider URL';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    NULL;
  END;
END
$$;

SELECT pg_catalog.set_config('p8r4.organization_id', :'p8r4_org_id', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM platform.resolve_manual_send_waha_runtime(
      pg_catalog.current_setting('p8r4.organization_id')::UUID
    );
    RAISE EXCEPTION 'authenticated resolved the WAHA API key';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
END
$$;
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT
  waha_session_name AS p8r4_runtime_session,
  waha_base_url AS p8r4_runtime_base_url,
  waha_api_key AS p8r4_runtime_api_key,
  binding_version::TEXT AS p8r4_runtime_version
FROM platform.resolve_manual_send_waha_runtime(:'p8r4_org_id')
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p8r4_runtime_session' = 'evo-inbox'
    AND :'p8r4_runtime_base_url' = 'http://evo-crm-waha:3000'
    AND :'p8r4_runtime_api_key' = 'synthetic-p8r4-private-waha-api-key'
    AND :'p8r4_runtime_version' = '1',
  'service_role did not resolve the exact Vault-backed runtime binding'
);

INSERT INTO platform_private.waha_direct_chat_bindings (
  organization_id,
  waha_session_name,
  normalized_chat_id,
  conversation_id,
  source_webhook_event_id
) VALUES (
  :'p8r4_org_id',
  'evo-inbox',
  '996555080001@c.us',
  :'p8r4_conversation_id',
  :'p8r4_source_event_id'
);

INSERT INTO platform_private.waha_message_bindings (
  organization_id,
  waha_session_name,
  raw_message_id,
  communication_message_id,
  source_webhook_event_id
) VALUES (
  :'p8r4_org_id',
  'evo-inbox',
  'false_996555080001@c.us_AAAAAAAAAAAAAAAAAAAA',
  :'p8r4_source_message_id',
  :'p8r4_source_event_id'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.claim_manual_whatsapp_send_item(
  :'p8r4_org_id',
  :'p8r4_work_item_id',
  60,
  'p8r4-disposable-worker',
  '80000000-0000-4000-8000-000000000001'
)::TEXT AS p8r4_claim
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'p8r4_claim'::JSONB ->> 'claimed')::BOOLEAN
    AND :'p8r4_claim'::JSONB ->> 'organization_id' = :'p8r4_org_id'
    AND :'p8r4_claim'::JSONB ->> 'work_item_id' = :'p8r4_work_item_id'
    AND :'p8r4_claim'::JSONB ->> 'manual_send_authorization_id' =
      :'p8r4_authorization_id'
    AND :'p8r4_claim'::JSONB ->> 'waha_session_name' = 'evo-inbox'
    AND :'p8r4_claim'::JSONB ->> 'raw_chat_id' = '996555080001@c.us'
    AND :'p8r4_claim'::JSONB ->> 'raw_reply_to' =
      'false_996555080001@c.us_AAAAAAAAAAAAAAAAAAAA',
  'Manual-send claim did not return the exact target provider identity'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = :'p8r4_org_id'
      AND participant.conversation_id = :'p8r4_conversation_id'
      AND participant.membership_id = :'p8r4_sender_membership_id'
      AND participant.participant_kind::TEXT = :'p8r4_sender_role'
  ),
  'Claim did not ensure the authorized staff sender participant'
);

SELECT pg_catalog.statement_timestamp()::TEXT AS p8r4_provider_observed_at
\gset

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_send(
  :'p8r4_org_id',
  :'p8r4_work_item_id',
  (:'p8r4_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p8r4_authorization_id',
  'succeeded',
  NULL,
  'false_996555080001@c.us_BBBBBBBBBBBBBBBBBBBB',
  :'p8r4_provider_observed_at',
  '80000000-0000-4000-8000-000000000002'
)::TEXT AS p8r4_finish
\gset
RESET ROLE;

SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.assert_true(
  :'p8r4_finish'::JSONB ->> 'outcome' = 'succeeded'
    AND :'p8r4_finish'::JSONB ->> 'state' = 'succeeded'
    AND (:'p8r4_finish'::JSONB ->> 'provider_identity_private')::BOOLEAN
    AND EXISTS (
      SELECT 1
      FROM platform_private.manual_send_provider_bindings AS binding
      WHERE binding.organization_id = :'p8r4_org_id'
        AND binding.manual_send_authorization_id = :'p8r4_authorization_id'
        AND binding.waha_session_name = 'evo-inbox'
        AND binding.raw_message_id =
          'false_996555080001@c.us_BBBBBBBBBBBBBBBBBBBB'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.communication_messages AS message
      WHERE message.organization_id = :'p8r4_org_id'
        AND message.id =
          (:'p8r4_finish'::JSONB ->> 'communication_message_id')::UUID
        AND message.direction = 'outbound'
        AND message.message_identity_source = 'private_manual_send_binding'
        AND message.manual_send_authorization_id = :'p8r4_authorization_id'
    ),
  'Manual-send finish did not persist exact private provider evidence'
);

ROLLBACK;

SELECT 'platform migration 080 manual-send WAHA runtime contract passed'
  AS result;
