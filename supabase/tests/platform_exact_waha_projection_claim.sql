\set ON_ERROR_STOP on

-- P5B exact-claim acceptance is provider-free. It uses synthetic verified
-- WAHA evidence in the disposable authorization database and makes no network
-- call to WAHA, WhatsApp, amoCRM or Kommo.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5B exact-claim assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS exact_org_id,
  membership.id AS exact_sales_membership_id,
  profile.id AS exact_sales_profile_id,
  profile.auth_user_id AS exact_sales_auth_user_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
 AND bundle.role = membership."current_role"
 AND bundle.status = 'published'
JOIN platform.organizations AS organization
  ON organization.id = membership.organization_id
WHERE membership.status = 'active'
  AND membership."current_role" = 'sales'
  AND profile.status = 'active'
  AND organization.status = 'active'
  AND platform_private.membership_has_active_scope(
    membership.organization_id,
    membership.id,
    'organization',
    membership.organization_id
  )
  AND (
    SELECT count(DISTINCT permission.permission_key) = 2
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key IN (
        'organization.read',
        'communication.read.full'
      )
  )
ORDER BY membership.created_at, membership.id
LIMIT 1
\gset

BEGIN;

SELECT pg_temp.assert_true(
  to_regprocedure(
    'platform.claim_waha_webhook_work(uuid,integer,text,uuid)'
  ) IS NULL
  AND to_regprocedure(
    'platform.claim_waha_event_projection(uuid,integer,text,uuid)'
  ) IS NULL
  AND to_regprocedure(
    'platform_private.claim_next_waha_message_work_internal(uuid,integer,text,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'platform_private.claim_next_waha_observation_work_internal(uuid,integer,text,uuid)'
  ) IS NOT NULL
  AND NOT has_function_privilege(
    'service_role',
    'platform_private.claim_next_waha_message_work_internal(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform_private.claim_next_waha_observation_work_internal(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform_private.claim_next_durable_work_internal(integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.claim_waha_webhook_work_item(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.claim_waha_webhook_work_item(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.claim_waha_webhook_work_item(uuid,uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.claim_durable_work(integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform_private.finish_manual_whatsapp_reconciliation_internal(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_manual_whatsapp_reconciliation(uuid,text,text,text,integer,text,text,platform.waha_ack_state,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
        'platform_private.manual_whatsapp_reconciliation_results'::REGCLASS
      AND constraint_row.conname =
        'manual_whatsapp_reconciliation_results_provider_source_check'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) LIKE
        '%provider_source = ''api''::text%'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid) NOT LIKE '%app%'
  ),
  'exact claims, reconciliation source constraint, or service grants drifted'
);

-- Earlier boundary suites may leave disposable queue rows behind. Hide them so
-- the exact ordering assertions below describe only this fixture.
UPDATE pgmq.q_platform_work_v1
SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
WHERE vt <= pg_catalog.clock_timestamp();

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
)
VALUES
  (
    '98000000-0000-4000-8000-000000000101',
    :'exact_org_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p98-inbound', 'evo-inbox',
    'false_996555001122@c.us_P98INBOUND', 'message.any',
    '2026-09-02 10:00:00+04', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"false_996555001122@c.us_P98INBOUND","timestamp":1788333600,"from":"996555001122@c.us","fromMe":false,"source":"app","body":"Synthetic exact inbound"}}',
    '{"hmac_verified":true}', 'synthetic:p98:inbound', repeat('98', 32),
    '98000000-0000-4000-8000-000000000201'
  ),
  (
    '98000000-0000-4000-8000-000000000102',
    :'exact_org_id', 'waha', 'waha:evo-inbox', NULL, 'read',
    'synthetic-p98-ack', 'evo-inbox',
    'true_996555001122@c.us_P98OUTBOUND', 'message.ack',
    '2026-09-02 10:01:00+04', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"true_996555001122@c.us_P98OUTBOUND","fromMe":true,"ack":3,"ackName":"READ"}}',
    '{"hmac_verified":true}', 'synthetic:p98:ack', repeat('89', 32),
    '98000000-0000-4000-8000-000000000202'
  );

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.enqueue_verified_webhook_work(
  :'exact_org_id',
  '98000000-0000-4000-8000-000000000101',
  encode(sha256(convert_to('p98-inbound', 'UTF8')), 'hex'),
  8,
  '98000000-0000-4000-8000-000000000301'
)::TEXT AS exact_inbound_enqueue
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'exact_org_id',
  '98000000-0000-4000-8000-000000000102',
  encode(sha256(convert_to('p98-ack', 'UTF8')), 'hex'),
  8,
  '98000000-0000-4000-8000-000000000302'
)::TEXT AS exact_ack_enqueue
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT queue_row.read_ct::TEXT AS exact_provider_read_count_before
FROM pgmq.q_platform_work_v1 AS queue_row
WHERE queue_row.msg_id =
  (:'exact_inbound_enqueue'::JSONB ->> 'queue_message_id')::BIGINT
\gset

-- The generic public claim may still exist for other work kinds, but selecting
-- provider_webhook_process through it must raise and roll the attempted lease
-- back atomically.
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT generic_provider_denied;
\set ON_ERROR_STOP off
SELECT platform.claim_durable_work(
  60,
  'p98-generic-provider-denied',
  '98000000-0000-4000-8000-000000000303'
);
\set exact_generic_provider_state :SQLSTATE
ROLLBACK TO SAVEPOINT generic_provider_denied;

SAVEPOINT wrong_exact_head;
SELECT platform.claim_waha_webhook_work_item(
  :'exact_org_id',
  (:'exact_ack_enqueue'::JSONB ->> 'work_item_id')::UUID,
  60,
  'p98-wrong-head',
  '98000000-0000-4000-8000-000000000304'
);
\set exact_wrong_head_state :SQLSTATE
ROLLBACK TO SAVEPOINT wrong_exact_head;
\set ON_ERROR_STOP on

RESET ROLE;
RESET request.jwt.claims;

SELECT queue_row.read_ct::TEXT AS exact_provider_read_count_after
FROM pgmq.q_platform_work_v1 AS queue_row
WHERE queue_row.msg_id =
  (:'exact_inbound_enqueue'::JSONB ->> 'queue_message_id')::BIGINT
\gset

SELECT count(*)::TEXT AS exact_attempts_after_denials
FROM platform_private.durable_work_attempts AS attempt
WHERE attempt.work_item_id IN (
  (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID,
  (:'exact_ack_enqueue'::JSONB ->> 'work_item_id')::UUID
)
\gset

SELECT pg_temp.assert_true(
  :'exact_generic_provider_state' = '42501'
  AND :'exact_wrong_head_state' = '55000'
  AND :'exact_provider_read_count_after' = :'exact_provider_read_count_before'
  AND :'exact_attempts_after_denials'::INTEGER = 0,
  'generic provider or wrong-head exact claim did not fail without a lease'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.claim_waha_webhook_work_item(
  :'exact_org_id',
  (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID,
  60,
  'p98-exact-inbound',
  '98000000-0000-4000-8000-000000000305'
)::TEXT AS exact_inbound_claim
\gset

SELECT platform.project_claimed_waha_event(
  :'exact_org_id',
  (:'exact_inbound_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'exact_inbound_claim'::JSONB ->> 'attempt_id')::UUID,
  :'exact_sales_membership_id',
  '98000000-0000-4000-8000-000000000306'
)::TEXT AS exact_inbound_projection
\gset

SELECT platform.finish_waha_webhook_work(
  :'exact_org_id',
  (:'exact_inbound_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'exact_inbound_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'exact_inbound_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'exact_inbound_projection'::JSONB ->> 'error_code',
  :'exact_inbound_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '98000000-0000-4000-8000-000000000307'
)::TEXT AS exact_inbound_finish
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT count(*)::TEXT AS exact_message_count_before_replay
FROM platform.communication_messages AS message
WHERE message.organization_id = :'exact_org_id'
  AND message.source_webhook_event_id =
    '98000000-0000-4000-8000-000000000101'
\gset

SELECT count(*)::TEXT AS exact_projection_count_before_replay
FROM platform_private.waha_work_projection_effects AS effect
WHERE effect.organization_id = :'exact_org_id'
  AND effect.work_item_id =
    (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SELECT count(*)::TEXT AS exact_work_event_count_before_replay
FROM platform_private.durable_work_events AS event
WHERE event.organization_id = :'exact_org_id'
  AND event.work_item_id =
    (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.claim_waha_webhook_work_item(
  :'exact_org_id',
  (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID,
  60,
  'p98-exact-inbound-replay',
  '98000000-0000-4000-8000-000000000308'
)::TEXT AS exact_inbound_replay
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT count(*)::TEXT AS exact_message_count_after_replay
FROM platform.communication_messages AS message
WHERE message.organization_id = :'exact_org_id'
  AND message.source_webhook_event_id =
    '98000000-0000-4000-8000-000000000101'
\gset

SELECT count(*)::TEXT AS exact_projection_count_after_replay
FROM platform_private.waha_work_projection_effects AS effect
WHERE effect.organization_id = :'exact_org_id'
  AND effect.work_item_id =
    (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SELECT count(*)::TEXT AS exact_work_event_count_after_replay
FROM platform_private.durable_work_events AS event
WHERE event.organization_id = :'exact_org_id'
  AND event.work_item_id =
    (:'exact_inbound_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.claim_waha_webhook_work_item(
  :'exact_org_id',
  (:'exact_ack_enqueue'::JSONB ->> 'work_item_id')::UUID,
  60,
  'p98-exact-ack',
  '98000000-0000-4000-8000-000000000309'
)::TEXT AS exact_ack_claim
\gset

SELECT platform.project_claimed_waha_observation(
  :'exact_org_id',
  (:'exact_ack_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'exact_ack_claim'::JSONB ->> 'attempt_id')::UUID,
  :'exact_sales_membership_id',
  '98000000-0000-4000-8000-000000000310'
)::TEXT AS exact_ack_projection
\gset

SELECT platform.finish_waha_event_projection(
  :'exact_org_id',
  (:'exact_ack_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'exact_ack_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'exact_ack_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'exact_ack_projection'::JSONB ->> 'error_code',
  :'exact_ack_projection'::JSONB ->> 'evidence_ref',
  30,
  '98000000-0000-4000-8000-000000000311'
)::TEXT AS exact_ack_finish
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT message.id AS exact_source_message_id,
  message.conversation_id AS exact_conversation_id
FROM platform.communication_messages AS message
WHERE message.organization_id = :'exact_org_id'
  AND message.source_webhook_event_id =
    '98000000-0000-4000-8000-000000000101'
\gset

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
  '98000000-0000-4000-8000-000000000401',
  :'exact_org_id',
  :'exact_conversation_id',
  NULL,
  :'exact_source_message_id',
  'ru',
  :'exact_sales_profile_id',
  :'exact_sales_membership_id',
  'Synthetic unrelated exact-claim proof',
  '98000000-0000-4000-8000-000000000402'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.enqueue_ai_draft_work(
  :'exact_org_id',
  '98000000-0000-4000-8000-000000000401',
  encode(sha256(convert_to('p98-unrelated-ai', 'UTF8')), 'hex'),
  4,
  '98000000-0000-4000-8000-000000000403'
)::TEXT AS exact_ai_enqueue
\gset

SELECT platform.claim_durable_work(
  60,
  'p98-generic-unrelated',
  '98000000-0000-4000-8000-000000000404'
)::TEXT AS exact_ai_claim
\gset

SELECT pg_temp.assert_true(
  (:'exact_inbound_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND :'exact_inbound_claim'::JSONB ->> 'requested_work_item_id' =
    :'exact_inbound_enqueue'::JSONB ->> 'work_item_id'
  AND :'exact_inbound_claim'::JSONB ->> 'event_type' = 'message.any'
  AND :'exact_inbound_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND :'exact_inbound_finish'::JSONB ->> 'state' = 'succeeded'
  AND NOT (:'exact_inbound_replay'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'exact_inbound_replay'::JSONB ->> 'completed')::BOOLEAN
  AND :'exact_message_count_before_replay'::INTEGER = 1
  AND :'exact_message_count_after_replay' =
    :'exact_message_count_before_replay'
  AND :'exact_projection_count_before_replay'::INTEGER = 1
  AND :'exact_projection_count_after_replay' =
    :'exact_projection_count_before_replay'
  AND :'exact_work_event_count_after_replay' =
    :'exact_work_event_count_before_replay'
  AND (:'exact_ack_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND :'exact_ack_claim'::JSONB ->> 'event_type' = 'message.ack'
  AND :'exact_ack_projection'::JSONB ->> 'disposition' = 'retryable_error'
  AND :'exact_ack_projection'::JSONB ->> 'error_code' =
    'waha_ack_binding_pending'
  AND :'exact_ack_finish'::JSONB ->> 'state' = 'retry_wait'
  AND (:'exact_ai_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND :'exact_ai_claim'::JSONB ->> 'kind' = 'ai_draft_generate'
  AND :'exact_ai_claim'::JSONB ->> 'work_item_id' =
    :'exact_ai_enqueue'::JSONB ->> 'work_item_id',
  'exact inbound/ACK projection, replay, or unrelated generic claim drifted'
);

RESET ROLE;
RESET request.jwt.claims;

-- Build one transaction-local unknown manual-send attempt and a table-valid
-- reconciliation request from the inbound message projected above.
INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  ai_draft_id,
  source_message_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '98000000-0000-4000-8000-000000000504',
  :'exact_org_id',
  :'exact_conversation_id',
  NULL,
  :'exact_source_message_id',
  'Synthetic reviewed P98 reply',
  platform_private.ai_memory_text_sha256('Synthetic reviewed P98 reply'),
  :'exact_sales_profile_id',
  :'exact_sales_membership_id',
  'Synthetic P98 app-source rejection fixture',
  '98000000-0000-4000-8000-000000000505'
);

SELECT pgmq.send(
  'platform_work_v1',
  jsonb_build_object(
    'v', 1,
    'work_item_id', '98000000-0000-4000-8000-000000000506',
    'kind', 'manual_whatsapp_send'
  ),
  0
)::TEXT AS exact_reconcile_queue_id
\gset

INSERT INTO platform_private.durable_work_items (
  id,
  organization_id,
  kind,
  state,
  manual_send_authorization_id,
  business_key_sha256,
  queue_message_id,
  attempt_count,
  max_attempts,
  available_at,
  leased_until,
  request_id
)
VALUES (
  '98000000-0000-4000-8000-000000000506',
  :'exact_org_id',
  'manual_whatsapp_send',
  'leased',
  '98000000-0000-4000-8000-000000000504',
  encode(sha256(convert_to('p98-reconciliation-manual', 'UTF8')), 'hex'),
  :'exact_reconcile_queue_id'::BIGINT,
  1,
  1,
  pg_catalog.statement_timestamp(),
  pg_catalog.clock_timestamp() + INTERVAL '1 minute',
  '98000000-0000-4000-8000-000000000509'
);

SELECT jsonb_build_object(
  'work_item_id', '98000000-0000-4000-8000-000000000506',
  'queue_message_id', :'exact_reconcile_queue_id'::BIGINT
)::TEXT AS exact_reconcile_enqueue
\gset

UPDATE pgmq.q_platform_work_v1
SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 minute',
    read_ct = read_ct + 1
WHERE msg_id =
  (:'exact_reconcile_enqueue'::JSONB ->> 'queue_message_id')::BIGINT;

UPDATE platform_private.durable_work_items
SET state = 'leased',
    attempt_count = 1,
    leased_until = pg_catalog.clock_timestamp() + INTERVAL '1 minute',
    updated_at = pg_catalog.statement_timestamp()
WHERE organization_id = :'exact_org_id'
  AND id = (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID;

INSERT INTO platform_private.durable_work_attempts (
  id,
  organization_id,
  work_item_id,
  attempt_number,
  queue_message_id,
  queue_read_count,
  worker_ref,
  claimed_at,
  lease_expires_at
)
VALUES (
  '98000000-0000-4000-8000-000000000507',
  :'exact_org_id',
  (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID,
  1,
  (:'exact_reconcile_enqueue'::JSONB ->> 'queue_message_id')::BIGINT,
  1,
  'p98-synthetic-unknown-worker',
  pg_catalog.statement_timestamp(),
  pg_catalog.clock_timestamp() + INTERVAL '1 minute'
);

SELECT platform_private.p2g_open_unknown_review(
  (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID,
  '98000000-0000-4000-8000-000000000507',
  'provider_timeout',
  'synthetic:p98:unknown-result',
  '98000000-0000-4000-8000-000000000508'
)::TEXT AS exact_reconcile_unknown
\gset

SELECT authorization_row.final_text_sha256 AS exact_reconcile_final_text_sha256
FROM platform.manual_send_authorizations AS authorization_row
WHERE authorization_row.organization_id = :'exact_org_id'
  AND authorization_row.id = '98000000-0000-4000-8000-000000000504'
\gset

INSERT INTO platform_private.manual_whatsapp_reconciliation_requests (
  id,
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
  '98000000-0000-4000-8000-000000000501',
  :'exact_org_id',
  :'exact_conversation_id',
  :'exact_source_message_id',
  (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID,
  '98000000-0000-4000-8000-000000000507',
  '98000000-0000-4000-8000-000000000504',
  'unknown_recovery',
  '98000000-0000-4000-8000-000000000502',
  repeat('7a', 32),
  'evo-inbox',
  platform_private.ai_memory_text_sha256('996555098001@c.us'),
  :'exact_reconcile_final_text_sha256',
  NULL,
  :'exact_sales_profile_id',
  :'exact_sales_membership_id',
  :'exact_sales_auth_user_id',
  'Synthetic P98 Staff',
  'Reject app-originated reconciliation settlement'
);

SELECT count(*)::TEXT AS exact_reconcile_message_count_before
FROM platform.communication_messages AS message
WHERE message.organization_id = :'exact_org_id'
  AND message.manual_send_authorization_id =
    '98000000-0000-4000-8000-000000000504'
\gset

SELECT count(*)::TEXT AS exact_reconcile_result_count_before
FROM platform_private.manual_whatsapp_reconciliation_results AS result
WHERE result.request_id = '98000000-0000-4000-8000-000000000502'
\gset

SELECT count(*)::TEXT AS exact_reconcile_event_count_before
FROM platform_private.durable_work_events AS event
WHERE event.organization_id = :'exact_org_id'
  AND event.work_item_id =
    (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT app_source_denied;
\set ON_ERROR_STOP off
SELECT platform.finish_manual_whatsapp_reconciliation(
  '98000000-0000-4000-8000-000000000501',
  'evo-inbox',
  '996555098001@c.us',
  :'exact_reconcile_final_text_sha256',
  1,
  'true_996555098001@c.us_P98APP',
  'app',
  'server',
  pg_catalog.statement_timestamp() - INTERVAL '1 second',
  pg_catalog.statement_timestamp(),
  '98000000-0000-4000-8000-000000000503'
);
\set exact_reconcile_app_state :SQLSTATE
ROLLBACK TO SAVEPOINT app_source_denied;
\set ON_ERROR_STOP on
RESET ROLE;
RESET request.jwt.claims;

SELECT count(*)::TEXT AS exact_reconcile_message_count_after
FROM platform.communication_messages AS message
WHERE message.organization_id = :'exact_org_id'
  AND message.manual_send_authorization_id =
    '98000000-0000-4000-8000-000000000504'
\gset

SELECT count(*)::TEXT AS exact_reconcile_result_count_after
FROM platform_private.manual_whatsapp_reconciliation_results AS result
WHERE result.request_id = '98000000-0000-4000-8000-000000000502'
\gset

SELECT count(*)::TEXT AS exact_reconcile_event_count_after
FROM platform_private.durable_work_events AS event
WHERE event.organization_id = :'exact_org_id'
  AND event.work_item_id =
    (:'exact_reconcile_enqueue'::JSONB ->> 'work_item_id')::UUID
\gset

SELECT pg_temp.assert_true(
  :'exact_reconcile_app_state' = '22023'
  AND :'exact_reconcile_message_count_after' =
    :'exact_reconcile_message_count_before'
  AND :'exact_reconcile_result_count_after' =
    :'exact_reconcile_result_count_before'
  AND :'exact_reconcile_event_count_after' =
    :'exact_reconcile_event_count_before',
  'source=app reconciliation wrote a message, result, or event'
);

ROLLBACK;

\echo 'P5B exact WAHA projection claim acceptance passed'
