\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK on

-- P5A end-to-end database acceptance for the manual WhatsApp reconciliation
-- contour. Every identifier, Vault secret and provider identity introduced by
-- this file is synthetic and transaction-local. The test never contacts WAHA.
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
    RAISE EXCEPTION 'P5A reconciliation assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Reuse one untouched synthetic manual-send fixture from the persistent test
-- seed. It must be the latest manual-send work item for its conversation so the
-- staff-safe projection resolves this exact attempt after it is claimed.
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
    JOIN platform.profiles AS sender_profile
      ON sender_profile.id = sender_membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = item.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = sender_membership.current_bundle_id
     AND bundle.role = sender_membership.current_role
    WHERE item.kind = 'manual_whatsapp_send'
      AND item.state IN ('queued', 'leased', 'retry_wait')
      AND item.max_attempts = 1
      AND conversation.waha_session_name = 'evo-inbox'
      AND source_message.direction = 'inbound'
      AND source_event.verification_status = 'verified'
      AND sender_profile.auth_user_id IS NOT NULL
      AND sender_profile.status = 'active'
      AND sender_membership.status = 'active'
      AND sender_membership.current_role IN ('admin', 'sales', 'curator')
      AND organization.status = 'active'
      AND bundle.status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.durable_work_attempts AS attempt
        WHERE attempt.organization_id = item.organization_id
          AND attempt.work_item_id = item.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.manual_send_provider_bindings AS binding
        WHERE binding.organization_id = item.organization_id
          AND binding.manual_send_authorization_id = authorization_row.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform.communication_messages AS outbound_message
        WHERE outbound_message.organization_id = item.organization_id
          AND outbound_message.manual_send_authorization_id = authorization_row.id
          AND outbound_message.direction = 'outbound'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.waha_direct_chat_bindings AS direct_binding
        WHERE direct_binding.organization_id = item.organization_id
          AND direct_binding.conversation_id = conversation.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.waha_message_bindings AS message_binding
        WHERE message_binding.organization_id = item.organization_id
          AND message_binding.communication_message_id = source_message.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM platform_private.durable_work_items AS newer_item
        JOIN platform.manual_send_authorizations AS newer_authorization
          ON newer_authorization.organization_id = newer_item.organization_id
         AND newer_authorization.id = newer_item.manual_send_authorization_id
        WHERE newer_item.organization_id = item.organization_id
          AND newer_item.kind = 'manual_whatsapp_send'
          AND newer_authorization.conversation_id = conversation.id
          AND (
            newer_authorization.authorized_at > authorization_row.authorized_at
            OR (
              newer_authorization.authorized_at = authorization_row.authorized_at
              AND newer_item.id > item.id
            )
          )
      )
  ),
  'No untouched latest manual-send fixture is available for reconciliation'
);

SELECT
  item.organization_id::TEXT AS p5a_r_org_id,
  item.id::TEXT AS p5a_r_work_item_id,
  authorization_row.id::TEXT AS p5a_r_authorization_id,
  authorization_row.conversation_id::TEXT AS p5a_r_conversation_id,
  authorization_row.source_message_id::TEXT AS p5a_r_source_message_id,
  authorization_row.final_text_sha256 AS p5a_r_final_text_sha256,
  authorization_row.authorized_by_membership_id::TEXT
    AS p5a_r_sender_membership_id,
  sender_membership.current_role::TEXT AS p5a_r_sender_role,
  sender_profile.auth_user_id::TEXT AS p5a_r_sender_auth_user_id,
  sender_profile.access_version::TEXT AS p5a_r_sender_access_version,
  sender_membership.current_bundle_id::TEXT AS p5a_r_sender_bundle_id,
  bundle.version::TEXT AS p5a_r_sender_bundle_version,
  source_message.source_webhook_event_id::TEXT AS p5a_r_source_event_id
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
JOIN platform.profiles AS sender_profile
  ON sender_profile.id = sender_membership.profile_id
JOIN platform.organizations AS organization
  ON organization.id = item.organization_id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = sender_membership.current_bundle_id
 AND bundle.role = sender_membership.current_role
WHERE item.kind = 'manual_whatsapp_send'
  AND item.state IN ('queued', 'leased', 'retry_wait')
  AND item.max_attempts = 1
  AND conversation.waha_session_name = 'evo-inbox'
  AND source_message.direction = 'inbound'
  AND source_event.verification_status = 'verified'
  AND sender_profile.auth_user_id IS NOT NULL
  AND sender_profile.status = 'active'
  AND sender_membership.status = 'active'
  AND sender_membership.current_role IN ('admin', 'sales', 'curator')
  AND organization.status = 'active'
  AND bundle.status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.durable_work_attempts AS attempt
    WHERE attempt.organization_id = item.organization_id
      AND attempt.work_item_id = item.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.manual_send_provider_bindings AS binding
    WHERE binding.organization_id = item.organization_id
      AND binding.manual_send_authorization_id = authorization_row.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS outbound_message
    WHERE outbound_message.organization_id = item.organization_id
      AND outbound_message.manual_send_authorization_id = authorization_row.id
      AND outbound_message.direction = 'outbound'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_direct_chat_bindings AS direct_binding
    WHERE direct_binding.organization_id = item.organization_id
      AND direct_binding.conversation_id = conversation.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_message_bindings AS message_binding
    WHERE message_binding.organization_id = item.organization_id
      AND message_binding.communication_message_id = source_message.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.durable_work_items AS newer_item
    JOIN platform.manual_send_authorizations AS newer_authorization
      ON newer_authorization.organization_id = newer_item.organization_id
     AND newer_authorization.id = newer_item.manual_send_authorization_id
    WHERE newer_item.organization_id = item.organization_id
      AND newer_item.kind = 'manual_whatsapp_send'
      AND newer_authorization.conversation_id = conversation.id
      AND (
        newer_authorization.authorized_at > authorization_row.authorized_at
        OR (
          newer_authorization.authorized_at = authorization_row.authorized_at
          AND newer_item.id > item.id
        )
      )
  )
ORDER BY authorization_row.authorized_at, item.id
LIMIT 1
\gset

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p5a_r_sender_auth_user_id',
  'role', 'authenticated',
  'platform_role', :'p5a_r_sender_role',
  'platform_access_version', :'p5a_r_sender_access_version'::BIGINT,
  'platform_organization_id', :'p5a_r_org_id',
  'platform_membership_id', :'p5a_r_sender_membership_id',
  'platform_bundle_id', :'p5a_r_sender_bundle_id',
  'platform_bundle_version', :'p5a_r_sender_bundle_version'::BIGINT
)::TEXT AS p5a_r_staff_claims
\gset

-- Rebind the selected work item to a fresh transaction-local queue pointer.
SELECT pgmq.send(
  'platform_work_v1',
  pg_catalog.jsonb_build_object(
    'v', 1,
    'work_item_id', :'p5a_r_work_item_id',
    'kind', 'manual_whatsapp_send'
  ),
  0
)::TEXT AS p5a_r_queue_message_id
\gset

SET LOCAL session_replication_role = replica;
UPDATE platform_private.durable_work_items
SET queue_message_id = :'p5a_r_queue_message_id',
    state = 'queued',
    attempt_count = 0,
    max_attempts = 1,
    available_at = pg_catalog.statement_timestamp(),
    leased_until = NULL,
    completed_at = NULL,
    updated_at = pg_catalog.statement_timestamp()
WHERE organization_id = :'p5a_r_org_id'
  AND id = :'p5a_r_work_item_id';
SET LOCAL session_replication_role = origin;

-- Configure a disposable Vault-backed WAHA runtime without revealing the
-- secret through any authenticated staff surface.
SELECT vault.create_secret(
  'synthetic-p5a-reconciliation-private-waha-key',
  'p5a-reconciliation-waha-key',
  'Disposable migration-096 reconciliation acceptance only'
)::TEXT AS p5a_r_vault_secret_id
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
  :'p5a_r_org_id',
  'evo-inbox',
  'http://evo-inbox-waha:3000',
  :'p5a_r_vault_secret_id',
  platform_private.ai_memory_text_sha256(
    'synthetic-p5a-reconciliation-private-waha-key'
  ),
  TRUE,
  1
)
ON CONFLICT (organization_id) DO UPDATE
SET waha_session_name = EXCLUDED.waha_session_name,
    waha_base_url = EXCLUDED.waha_base_url,
    api_key_secret_id = EXCLUDED.api_key_secret_id,
    api_key_sha256 = EXCLUDED.api_key_sha256,
    enabled = EXCLUDED.enabled,
    binding_version =
      platform_private.manual_send_waha_runtime_bindings.binding_version + 1,
    updated_at = pg_catalog.statement_timestamp();

INSERT INTO platform_private.waha_direct_chat_bindings (
  organization_id,
  waha_session_name,
  normalized_chat_id,
  conversation_id,
  source_webhook_event_id
) VALUES (
  :'p5a_r_org_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_conversation_id',
  :'p5a_r_source_event_id'
);

INSERT INTO platform_private.waha_message_bindings (
  organization_id,
  waha_session_name,
  raw_message_id,
  communication_message_id,
  source_webhook_event_id
) VALUES (
  :'p5a_r_org_id',
  'evo-inbox',
  'false_996555096001@c.us_AAAAAAAAAAAAAAAAAAAA',
  :'p5a_r_source_message_id',
  :'p5a_r_source_event_id'
);

-- The normal provider worker claims exactly once, then reports an ambiguous
-- external result. This creates the unknown-delivery review boundary without
-- persisting an outbound message or a provider binding.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.claim_manual_whatsapp_send_item(
  :'p5a_r_org_id',
  :'p5a_r_work_item_id',
  60,
  'p5a-reconciliation-worker',
  '96600000-0000-4000-8000-000000000001'
)::TEXT AS p5a_r_claim
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'p5a_r_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND :'p5a_r_claim'::JSONB ->> 'organization_id' = :'p5a_r_org_id'
  AND :'p5a_r_claim'::JSONB ->> 'work_item_id' = :'p5a_r_work_item_id'
  AND :'p5a_r_claim'::JSONB ->> 'manual_send_authorization_id' =
    :'p5a_r_authorization_id'
  AND :'p5a_r_claim'::JSONB ->> 'waha_session_name' = 'evo-inbox'
  AND :'p5a_r_claim'::JSONB ->> 'raw_chat_id' = '996555096001@c.us',
  'Manual send was not claimed through the exact synthetic WAHA binding'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_send(
  :'p5a_r_org_id',
  :'p5a_r_work_item_id',
  (:'p5a_r_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5a_r_authorization_id',
  'unknown_result',
  'provider_timeout',
  NULL,
  NULL,
  '96600000-0000-4000-8000-000000000002'
)::TEXT AS p5a_r_unknown_finish
\gset
RESET ROLE;

SELECT (:'p5a_r_claim'::JSONB ->> 'attempt_id') AS p5a_r_attempt_id
\gset

SELECT pg_temp.assert_true(
  :'p5a_r_unknown_finish'::JSONB ->> 'outcome' = 'unknown_result'
  AND :'p5a_r_unknown_finish'::JSONB ->> 'state' = 'unknown_manual_review'
  AND :'p5a_r_unknown_finish'::JSONB ->> 'communication_message_id' IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.manual_send_provider_bindings AS binding
    WHERE binding.organization_id = :'p5a_r_org_id'
      AND binding.durable_work_attempt_id = :'p5a_r_attempt_id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'p5a_r_org_id'
      AND message.manual_send_authorization_id = :'p5a_r_authorization_id'
      AND message.direction = 'outbound'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = :'p5a_r_org_id'
      AND review.work_item_id = :'p5a_r_work_item_id'
      AND review.manual_send_authorization_id = :'p5a_r_authorization_id'
      AND review.review_kind = 'unknown_delivery'
      AND review.status = 'open'
  ),
  'Ambiguous provider result did not stop at one open unknown-delivery review'
);

-- Authenticated staff sees a safe unknown state and creates an exact readback
-- request. The browser row must not contain a session, chat or provider ID.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT AS p5a_r_unknown_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset

SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_one_id,
  reconciliation_kind AS p5a_r_request_one_kind,
  replayed::TEXT AS p5a_r_request_one_replayed
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000010',
  'P5A exact unknown readback check'
)
\gset

\set ON_ERROR_STOP off
SELECT platform.manual_whatsapp_reconciliation_context(
  :'p5a_r_request_one_id'
);
\set p5a_r_staff_context_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_unknown_snapshot'::JSONB ->> 'status' = 'unknown'
  AND (:'p5a_r_unknown_snapshot'::JSONB ->> 'reconciliation_required')::BOOLEAN
  AND NOT (
    :'p5a_r_unknown_snapshot'::JSONB ?| ARRAY[
      'waha_session_name',
      'raw_chat_id',
      'provider_message_id',
      'recipient_sha256'
    ]::TEXT[]
  )
  AND :'p5a_r_request_one_kind' = 'unknown_recovery'
  AND :'p5a_r_request_one_replayed'::BOOLEAN IS FALSE
  AND :'p5a_r_staff_context_state' = '42501',
  'Staff unknown projection leaked private identity or exact context access'
);

-- Only the service role can resolve the exact private readback context.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.manual_whatsapp_reconciliation_context(
  :'p5a_r_request_one_id'
)::TEXT AS p5a_r_context_one
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_context_one'::JSONB ->> 'waha_session_name' = 'evo-inbox'
  AND :'p5a_r_context_one'::JSONB ->> 'raw_chat_id' = '996555096001@c.us'
  AND :'p5a_r_context_one'::JSONB ->> 'final_text_sha256' =
    :'p5a_r_final_text_sha256'
  AND :'p5a_r_context_one'::JSONB ->> 'reconciliation_kind' =
    'unknown_recovery'
  AND :'p5a_r_context_one'::JSONB ->> 'expected_provider_message_id' IS NULL
  AND (:'p5a_r_context_one'::JSONB ->> 'completed')::BOOLEAN IS FALSE,
  'Service did not receive the exact first unknown-recovery context'
);

-- Identity mismatch fails closed even for service_role. The exact readback then
-- reports zero matches and leaves the review open for a later explicit check.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
\set ON_ERROR_STOP off
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_one_id',
  'evo-inbox',
  '996555096999@c.us',
  :'p5a_r_final_text_sha256',
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  '96600000-0000-4000-8000-000000000019'
);
\set p5a_r_wrong_recipient_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_one_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  '96600000-0000-4000-8000-000000000020'
)::TEXT AS p5a_r_not_found
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_wrong_recipient_state' = '42501'
  AND :'p5a_r_not_found'::JSONB ->> 'outcome' = 'message_not_found'
  AND (:'p5a_r_not_found'::JSONB ->> 'reconciliation_required')::BOOLEAN
  AND (:'p5a_r_not_found'::JSONB ->> 'replayed')::BOOLEAN IS FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.manual_send_provider_bindings AS binding
    WHERE binding.organization_id = :'p5a_r_org_id'
      AND binding.durable_work_attempt_id = :'p5a_r_attempt_id'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = :'p5a_r_org_id'
      AND review.work_item_id = :'p5a_r_work_item_id'
      AND review.review_kind = 'unknown_delivery'
      AND review.status = 'open'
  ),
  'Zero-match readback did not remain fail-closed without an outbound message'
);

-- Reusing the same staff request after it completed is an exact replay, not a
-- second ledger entry. A new request can then perform another human-approved
-- readback while the delivery is still unknown.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_one_replay_id,
  reconciliation_kind AS p5a_r_request_one_replay_kind,
  replayed::TEXT AS p5a_r_request_one_replay_flag
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000010',
  'P5A exact unknown readback check'
)
\gset

SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_two_id,
  reconciliation_kind AS p5a_r_request_two_kind,
  replayed::TEXT AS p5a_r_request_two_replayed
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000011',
  'P5A exact provider recovery check'
)
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_request_one_replay_id' = :'p5a_r_request_one_id'
  AND :'p5a_r_request_one_replay_kind' = 'unknown_recovery'
  AND :'p5a_r_request_one_replay_flag'::BOOLEAN
  AND :'p5a_r_request_two_kind' = 'unknown_recovery'
  AND :'p5a_r_request_two_replayed'::BOOLEAN IS FALSE,
  'Unknown-recovery request replay or second explicit request drifted'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.manual_whatsapp_reconciliation_context(
  :'p5a_r_request_two_id'
)::TEXT AS p5a_r_context_two
\gset
RESET ROLE;

SELECT pg_catalog.statement_timestamp()::TEXT AS p5a_r_provider_observed_at,
  (pg_catalog.statement_timestamp() + INTERVAL '1 second')::TEXT
    AS p5a_r_server_ack_observed_at
\gset

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_two_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'server',
  :'p5a_r_provider_observed_at',
  :'p5a_r_server_ack_observed_at',
  '96600000-0000-4000-8000-000000000021'
)::TEXT AS p5a_r_recovered
\gset

SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_two_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'server',
  :'p5a_r_provider_observed_at',
  :'p5a_r_server_ack_observed_at',
  '96600000-0000-4000-8000-000000000021'
)::TEXT AS p5a_r_recovered_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_two_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'device',
  :'p5a_r_provider_observed_at',
  :'p5a_r_server_ack_observed_at',
  '96600000-0000-4000-8000-000000000021'
);
\set p5a_r_completion_conflict_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_context_two'::JSONB ->> 'reconciliation_kind' =
    'unknown_recovery'
  AND :'p5a_r_context_two'::JSONB ->> 'expected_provider_message_id' IS NULL
  AND :'p5a_r_recovered'::JSONB ->> 'outcome' = 'message_confirmed'
  AND :'p5a_r_recovered'::JSONB ->> 'ack_name' = 'SERVER'
  AND (:'p5a_r_recovered'::JSONB ->> 'replayed')::BOOLEAN IS FALSE
  AND :'p5a_r_recovered_replay'::JSONB ->> 'communication_message_id' =
    :'p5a_r_recovered'::JSONB ->> 'communication_message_id'
  AND (:'p5a_r_recovered_replay'::JSONB ->> 'replayed')::BOOLEAN
  AND :'p5a_r_completion_conflict_state' = '22023',
  'One-match recovery was not idempotent or accepted conflicting completion data'
);

-- The original second staff request remains replay-stable after recovery. A
-- new request now switches to the ACK-refresh contract for that exact provider
-- message; it cannot create or resend another outbound message.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_two_replay_id,
  reconciliation_kind AS p5a_r_request_two_replay_kind,
  replayed::TEXT AS p5a_r_request_two_replay_flag
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000011',
  'P5A exact provider recovery check'
)
\gset

SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT AS p5a_r_recovered_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset

SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_three_id,
  reconciliation_kind AS p5a_r_request_three_kind,
  replayed::TEXT AS p5a_r_request_three_replayed
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000012',
  'P5A exact provider ACK refresh check'
)
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_request_two_replay_id' = :'p5a_r_request_two_id'
  AND :'p5a_r_request_two_replay_kind' = 'unknown_recovery'
  AND :'p5a_r_request_two_replay_flag'::BOOLEAN
  AND :'p5a_r_recovered_snapshot'::JSONB ->> 'status' = 'accepted'
  AND (:'p5a_r_recovered_snapshot'::JSONB ->> 'reconciliation_required')::BOOLEAN
    IS FALSE
  AND :'p5a_r_recovered_snapshot'::JSONB ->> 'ack_name' = 'SERVER'
  AND :'p5a_r_recovered_snapshot'::JSONB ->> 'latest_reconciliation_outcome' =
    'message_confirmed'
  AND :'p5a_r_request_three_kind' = 'ack_refresh'
  AND :'p5a_r_request_three_replayed'::BOOLEAN IS FALSE,
  'Recovered projection or ACK-refresh request did not use canonical state'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.manual_whatsapp_reconciliation_context(
  :'p5a_r_request_three_id'
)::TEXT AS p5a_r_context_three
\gset
RESET ROLE;

SELECT (pg_catalog.statement_timestamp() + INTERVAL '2 seconds')::TEXT
  AS p5a_r_read_ack_observed_at
\gset

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_three_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'read',
  :'p5a_r_provider_observed_at',
  :'p5a_r_read_ack_observed_at',
  '96600000-0000-4000-8000-000000000022'
)::TEXT AS p5a_r_ack_refreshed
\gset
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT AS p5a_r_read_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_context_three'::JSONB ->> 'reconciliation_kind' = 'ack_refresh'
  AND :'p5a_r_context_three'::JSONB ->> 'expected_provider_message_id' =
    'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB'
  AND :'p5a_r_ack_refreshed'::JSONB ->> 'outcome' = 'delivery_refreshed'
  AND :'p5a_r_ack_refreshed'::JSONB ->> 'ack_name' = 'READ'
  AND (:'p5a_r_ack_refreshed'::JSONB ->> 'replayed')::BOOLEAN IS FALSE
  AND :'p5a_r_read_snapshot'::JSONB ->> 'status' = 'accepted'
  AND (:'p5a_r_read_snapshot'::JSONB ->> 'reconciliation_required')::BOOLEAN
    IS FALSE
  AND :'p5a_r_read_snapshot'::JSONB ->> 'provider_source' = 'api'
  AND :'p5a_r_read_snapshot'::JSONB ->> 'ack_name' = 'READ'
  AND :'p5a_r_read_snapshot'::JSONB ->> 'latest_reconciliation_kind' =
    'ack_refresh'
  AND :'p5a_r_read_snapshot'::JSONB ->> 'latest_reconciliation_outcome' =
    'delivery_refreshed'
  AND NOT (
    :'p5a_r_read_snapshot'::JSONB ?| ARRAY[
      'waha_session_name',
      'raw_chat_id',
      'provider_message_id',
      'recipient_sha256'
    ]::TEXT[]
  ),
  'ACK refresh did not advance the browser-safe effective state to READ'
);

-- A later manual readback can be weaker than already-proved delivery state.
-- Record SERVER after READ and prove the effective browser projection remains
-- monotonic instead of regressing to the newest reconciliation row.
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_four_id,
  reconciliation_kind AS p5a_r_request_four_kind,
  replayed::TEXT AS p5a_r_request_four_replayed
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000013',
  'P5A weaker ACK must not regress READ'
)
\gset
RESET ROLE;

SELECT (pg_catalog.statement_timestamp() + INTERVAL '3 seconds')::TEXT
  AS p5a_r_weaker_server_observed_at
\gset

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_four_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'server',
  :'p5a_r_provider_observed_at',
  :'p5a_r_weaker_server_observed_at',
  '96600000-0000-4000-8000-000000000023'
)::TEXT AS p5a_r_weaker_server_result
\gset
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT
  AS p5a_r_after_weaker_server_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_request_four_kind' = 'ack_refresh'
  AND :'p5a_r_request_four_replayed'::BOOLEAN IS FALSE
  AND :'p5a_r_weaker_server_result'::JSONB ->> 'outcome' =
    'delivery_refreshed'
  AND :'p5a_r_weaker_server_result'::JSONB ->> 'ack_name' = 'SERVER'
  AND :'p5a_r_after_weaker_server_snapshot'::JSONB ->> 'ack_name' = 'READ'
  AND :'p5a_r_after_weaker_server_snapshot'::JSONB ->>
    'latest_reconciliation_outcome' = 'delivery_refreshed',
  'A weaker later reconciliation regressed the effective READ state'
);

-- Model a real verified WAHA ACK observation with its required source-event
-- and message foreign keys, then publish the corresponding current PLAYED row.
-- A subsequent weaker manual readback must not override this stronger evidence.
SELECT (pg_catalog.statement_timestamp() + INTERVAL '4 seconds')::TEXT
  AS p5a_r_played_observed_at
\gset

INSERT INTO platform_private.provider_webhook_events (
  id,
  organization_id,
  provider,
  provider_account_ref,
  provider_conversation_ref,
  provider_event_variant_ref,
  provider_request_id,
  waha_session_name,
  payload_id,
  event_type,
  provider_occurred_at,
  verification_status,
  raw_payload,
  verification_headers,
  verification_evidence_ref,
  payload_sha256,
  request_id
) VALUES (
  '96600000-0000-4000-8000-000000000030',
  :'p5a_r_org_id',
  'waha',
  'waha:evo-inbox',
  NULL,
  'played',
  'synthetic-p5a-reconciliation-played',
  'evo-inbox',
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'message.ack',
  :'p5a_r_played_observed_at',
  'verified',
  pg_catalog.jsonb_build_object(
    'event', 'message.ack',
    'session', 'evo-inbox',
    'payload', pg_catalog.jsonb_build_object(
      'id', 'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
      'fromMe', TRUE,
      'ack', 4,
      'ackName', 'PLAYED'
    )
  ),
  '{"hmac_verified":true}',
  'synthetic:p5a-reconciliation:played',
  repeat('d', 64),
  '96600000-0000-4000-8000-000000000031'
);

INSERT INTO platform_private.waha_ack_observations (
  id,
  organization_id,
  source_webhook_event_id,
  communication_message_id,
  waha_session_name,
  raw_message_id,
  from_me,
  ack_code,
  ack_name,
  observed_at,
  request_id
) VALUES (
  '96600000-0000-4000-8000-000000000032',
  :'p5a_r_org_id',
  '96600000-0000-4000-8000-000000000030',
  (:'p5a_r_recovered'::JSONB ->> 'communication_message_id')::UUID,
  'evo-inbox',
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  TRUE,
  4,
  'PLAYED',
  :'p5a_r_played_observed_at',
  '96600000-0000-4000-8000-000000000033'
);

INSERT INTO platform.waha_message_ack_current (
  organization_id,
  communication_message_id,
  waha_ack_name,
  waha_ack_observed_at,
  source_observation_id
) VALUES (
  :'p5a_r_org_id',
  (:'p5a_r_recovered'::JSONB ->> 'communication_message_id')::UUID,
  'PLAYED',
  :'p5a_r_played_observed_at',
  '96600000-0000-4000-8000-000000000032'
);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT AS p5a_r_played_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset

SELECT
  reconciliation_request_id::TEXT AS p5a_r_request_five_id,
  reconciliation_kind AS p5a_r_request_five_kind,
  replayed::TEXT AS p5a_r_request_five_replayed
FROM platform.request_manual_whatsapp_reconciliation(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id',
  :'p5a_r_attempt_id',
  '96600000-0000-4000-8000-000000000014',
  'P5A weaker ACK must not regress PLAYED'
)
\gset
RESET ROLE;

SELECT (pg_catalog.statement_timestamp() + INTERVAL '5 seconds')::TEXT
  AS p5a_r_final_weaker_server_observed_at
\gset

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
SET LOCAL ROLE service_role;
SELECT platform.finish_manual_whatsapp_reconciliation(
  :'p5a_r_request_five_id',
  'evo-inbox',
  '996555096001@c.us',
  :'p5a_r_final_text_sha256',
  1,
  'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB',
  'api',
  'server',
  :'p5a_r_provider_observed_at',
  :'p5a_r_final_weaker_server_observed_at',
  '96600000-0000-4000-8000-000000000024'
)::TEXT AS p5a_r_final_weaker_server_result
\gset
RESET ROLE;

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  :'p5a_r_staff_claims',
  true
);
SET LOCAL ROLE authenticated;
SELECT pg_catalog.to_jsonb(latest_attempt)::TEXT
  AS p5a_r_after_played_weaker_snapshot
FROM platform.staff_latest_manual_whatsapp_send_attempt(
  :'p5a_r_org_id',
  :'p5a_r_conversation_id'
) AS latest_attempt
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p5a_r_played_snapshot'::JSONB ->> 'ack_name' = 'PLAYED'
  AND :'p5a_r_request_five_kind' = 'ack_refresh'
  AND :'p5a_r_request_five_replayed'::BOOLEAN IS FALSE
  AND :'p5a_r_final_weaker_server_result'::JSONB ->> 'ack_name' = 'SERVER'
  AND :'p5a_r_after_played_weaker_snapshot'::JSONB ->> 'ack_name' = 'PLAYED'
  AND :'p5a_r_after_played_weaker_snapshot'::JSONB ->> 'status' = 'accepted'
  AND (:'p5a_r_after_played_weaker_snapshot'::JSONB ->>
    'reconciliation_required')::BOOLEAN IS FALSE,
  'A weaker manual readback overrode the stronger verified PLAYED observation'
);

-- Final invariants: one external attempt, one recovered outbound row, one
-- private provider binding, a resolved review and exactly five result rows.
-- The reconciliation routines contain no enqueue/send/fallback call.
SELECT pg_temp.assert_true(
  (
    SELECT pg_catalog.count(*) = 1
    FROM platform_private.durable_work_attempts AS attempt
    WHERE attempt.organization_id = :'p5a_r_org_id'
      AND attempt.work_item_id = :'p5a_r_work_item_id'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'p5a_r_org_id'
      AND message.manual_send_authorization_id = :'p5a_r_authorization_id'
      AND message.direction = 'outbound'
      AND message.message_identity_source = 'private_manual_send_binding'
  )
  AND (
    SELECT pg_catalog.count(*) = 1
    FROM platform_private.manual_send_provider_bindings AS binding
    WHERE binding.organization_id = :'p5a_r_org_id'
      AND binding.durable_work_attempt_id = :'p5a_r_attempt_id'
      AND binding.raw_message_id =
        'false_996555096001@c.us_BBBBBBBBBBBBBBBBBBBB'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.work_review_cases AS review
    WHERE review.organization_id = :'p5a_r_org_id'
      AND review.work_item_id = :'p5a_r_work_item_id'
      AND review.manual_send_authorization_id = :'p5a_r_authorization_id'
      AND review.review_kind = 'unknown_delivery'
      AND review.status = 'resolved'
      AND review.resolution = 'duplicate_suppressed'
      AND review.resolved_request_id =
        '96600000-0000-4000-8000-000000000021'
  )
  AND (
    SELECT pg_catalog.count(*) = 5
      AND pg_catalog.count(*) FILTER (
        WHERE result.outcome = 'message_not_found'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE result.outcome = 'message_confirmed'
      ) = 1
      AND pg_catalog.count(*) FILTER (
        WHERE result.outcome = 'delivery_refreshed'
      ) = 3
    FROM platform_private.manual_whatsapp_reconciliation_results AS result
    WHERE result.organization_id = :'p5a_r_org_id'
      AND result.attempt_id = :'p5a_r_attempt_id'
  )
  AND (
    SELECT pg_catalog.count(*) = 5
    FROM platform_private.manual_whatsapp_reconciliation_requests AS request
    WHERE request.organization_id = :'p5a_r_org_id'
      AND request.attempt_id = :'p5a_r_attempt_id'
  )
  AND (
    SELECT pg_catalog.pg_get_functiondef(routine.oid)
      !~ '(pgmq[.]send|claim_manual_whatsapp_send|finish_manual_whatsapp_send)'
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid =
      'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)'::REGPROCEDURE
  ),
  'Reconciliation created duplicate delivery state or gained send/fallback authority'
);

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
\set ON_ERROR_ROLLBACK off

SELECT 'platform migration 096 manual WhatsApp reconciliation passed' AS result;
