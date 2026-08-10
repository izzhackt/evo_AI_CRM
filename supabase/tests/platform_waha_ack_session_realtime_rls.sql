\set ON_ERROR_STOP on

-- P5E acceptance is synthetic and runs only in the disposable authorization
-- database. It performs no provider call, send/read action, session mutation,
-- amoCRM write or production operation.
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
    RAISE EXCEPTION 'P5E assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.process_next_waha_observation(
  p_organization_id UUID,
  p_intake_sales_membership_id UUID,
  p_worker_ref TEXT,
  p_claim_request_id UUID,
  p_projection_request_id UUID,
  p_finish_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  claim_result JSONB;
  projection_result JSONB;
  finish_result JSONB;
BEGIN
  claim_result := platform.claim_waha_event_projection(
    p_organization_id,
    300,
    p_worker_ref,
    p_claim_request_id
  );

  IF NOT COALESCE((claim_result ->> 'claimed')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Expected a P5E work claim for %', p_worker_ref;
  END IF;

  projection_result := platform.project_claimed_waha_observation(
    p_organization_id,
    (claim_result ->> 'work_item_id')::UUID,
    (claim_result ->> 'attempt_id')::UUID,
    p_intake_sales_membership_id,
    p_projection_request_id
  );

  finish_result := platform.finish_waha_event_projection(
    p_organization_id,
    (claim_result ->> 'work_item_id')::UUID,
    (claim_result ->> 'attempt_id')::UUID,
    (projection_result ->> 'disposition')::platform.durable_work_finish_outcome,
    projection_result ->> 'error_code',
    projection_result ->> 'evidence_ref',
    CASE
      WHEN projection_result ->> 'disposition' = 'retryable_error' THEN 60
      ELSE NULL
    END,
    p_finish_request_id
  );

  RETURN jsonb_build_object(
    'claim', claim_result,
    'projection', projection_result,
    'finish', finish_result
  );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.process_next_waha_observation(
  UUID, UUID, TEXT, UUID, UUID, UUID
) TO service_role;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS sales_a_membership_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS sales_b_membership_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000007'
\gset

SELECT
  binding.communication_message_id AS outbound_message_id,
  message.conversation_id AS outbound_conversation_id
FROM platform_private.waha_message_bindings AS binding
JOIN platform.communication_messages AS message
  ON message.organization_id = binding.organization_id
 AND message.id = binding.communication_message_id
WHERE binding.organization_id = :'org_a_id'
  AND binding.waha_session_name = 'evo-inbox'
  AND binding.raw_message_id = 'p5c-history-outbound-1'
  AND message.direction = 'outbound'
\gset

-- Give the independent positive-rank ACK sequence its own legitimate
-- read-only history message. Reusing only the original source event would
-- violate the deferred history-binding proof at commit time.
SELECT
  observation.run_id AS positive_outbound_run_id,
  observation.normalized_chat_id AS positive_outbound_chat_id,
  message.conversation_id AS positive_outbound_conversation_id,
  message.sender_participant_id AS positive_outbound_sender_id,
  message.language::TEXT AS positive_outbound_language
FROM platform_private.waha_history_message_observations AS observation
JOIN platform.communication_messages AS message
  ON message.organization_id = observation.organization_id
 AND message.id = observation.communication_message_id
WHERE observation.organization_id = :'org_a_id'
  AND observation.raw_message_id = 'p5c-history-outbound-1'
\gset

SELECT jsonb_build_object(
  'provenance', 'api_history',
  'read_only', TRUE,
  'session', 'evo-inbox',
  'chat_id', :'positive_outbound_chat_id',
  'message', jsonb_build_object(
    'raw_message_id', 'p5e-ack-outbound-2',
    'direction', 'outbound',
    'occurred_at', '2026-08-10T09:30:00+06:00',
    'body_text', 'Synthetic P5E positive-rank outbound fixture',
    'has_media', FALSE
  )
)::TEXT AS positive_outbound_raw_envelope
\gset

SELECT encode(
  sha256(convert_to(:'positive_outbound_raw_envelope'::JSONB::TEXT, 'UTF8')),
  'hex'
) AS positive_outbound_payload_sha256
\gset

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id
) VALUES (
  '46310000-0000-4000-8000-000000000001', :'org_a_id', 'waha',
  'waha:evo-inbox', NULL, NULL, 'synthetic:p5e:history-request',
  'evo-inbox', 'p5e-ack-outbound-2', 'history.message',
  '2026-08-10T09:30:00+06:00', 'missing',
  :'positive_outbound_raw_envelope'::JSONB,
  '{"provenance":"api_history","webhook_verified":false,"read_only":true}',
  'synthetic:p5e:history-read', :'positive_outbound_payload_sha256',
  '46310000-0000-4000-8000-000000000002'
);

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id, created_at
)
SELECT
  '46310000-0000-4000-8000-000000000003',
  :'org_a_id',
  :'positive_outbound_conversation_id',
  message.student_case_id,
  :'positive_outbound_sender_id',
  'outbound',
  'Synthetic P5E positive-rank outbound fixture',
  :'positive_outbound_language'::platform.communication_message_language,
  FALSE,
  'private_waha_history_binding',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  '46310000-0000-4000-8000-000000000001',
  NULL,
  '2026-08-10T09:30:00+06:00'
FROM platform.communication_messages AS message
WHERE message.organization_id = :'org_a_id'
  AND message.id = :'outbound_message_id';

INSERT INTO platform_private.waha_message_bindings (
  organization_id, waha_session_name, raw_message_id,
  communication_message_id, source_webhook_event_id
) VALUES (
  :'org_a_id', 'evo-inbox', 'p5e-ack-outbound-2',
  '46310000-0000-4000-8000-000000000003',
  '46310000-0000-4000-8000-000000000001'
);

INSERT INTO platform_private.waha_history_message_observations (
  organization_id, run_id, waha_session_name, normalized_chat_id,
  raw_message_id, direction, provider_occurred_at, source_event_id,
  communication_message_id, payload_sha256, page_request_id
) VALUES (
  :'org_a_id', :'positive_outbound_run_id', 'evo-inbox',
  :'positive_outbound_chat_id', 'p5e-ack-outbound-2', 'outbound',
  '2026-08-10T09:30:00+06:00',
  '46310000-0000-4000-8000-000000000001',
  '46310000-0000-4000-8000-000000000003',
  :'positive_outbound_payload_sha256',
  '46310000-0000-4000-8000-000000000004'
);

INSERT INTO platform_private.waha_history_projection_effects (
  organization_id, run_id, source_event_id, communication_message_id,
  disposition, payload_sha256, page_request_id
) VALUES (
  :'org_a_id', :'positive_outbound_run_id',
  '46310000-0000-4000-8000-000000000001',
  '46310000-0000-4000-8000-000000000003', 'projected',
  :'positive_outbound_payload_sha256',
  '46310000-0000-4000-8000-000000000004'
);

SELECT
  binding.communication_message_id AS positive_outbound_message_id,
  message.conversation_id AS positive_outbound_conversation_id
FROM platform_private.waha_message_bindings AS binding
JOIN platform.communication_messages AS message
  ON message.organization_id = binding.organization_id
 AND message.id = binding.communication_message_id
WHERE binding.organization_id = :'org_a_id'
  AND binding.waha_session_name = 'evo-inbox'
  AND binding.raw_message_id = 'p5e-ack-outbound-2'
  AND message.direction = 'outbound'
\gset

SELECT jsonb_build_object(
  'role', 'authenticated',
  'sub', '4b500000-0000-4000-8000-000000000003',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'
)::TEXT AS sales_a_claims
\gset

SELECT pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'platform.claim_waha_event_projection(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.claim_waha_event_projection(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_waha_event_projection(uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.finish_waha_event_projection(uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.staff_waha_session_health(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.staff_waha_session_health(uuid)',
    'EXECUTE'
  ),
  'P5E worker or staff RPC grants are not least privilege'
);

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'platform.waha_session_health',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform.waha_message_ack_current',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform.waha_message_ack_current',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform.waha_message_ack_current',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform.waha_message_ack_current',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform.waha_message_ack_current',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_ack_observations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_session_observations',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_event_projection_requests',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'realtime.messages',
    'INSERT'
  ),
  'P5E evidence, current state or Realtime send grants are too broad'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'platform'
      AND column_row.table_name = 'communication_messages'
      AND column_row.column_name IN (
        'waha_ack_name',
        'waha_ack_observed_at'
      )
  )
  AND EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'waha_message_ack_current'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ),
  'immutable messages regained mutable ACK columns or current ACK RLS drifted'
);

SELECT pg_temp.assert_true(
  position(
    'platform.project_claimed_waha_event' IN pg_get_functiondef(
      'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
    )
  ) > 0,
  'generalized projector no longer delegates message/message.any to P5B'
);

SELECT pg_temp.assert_true(
  position(
    'platform:waha-session-health:' IN pg_get_functiondef(
      'platform.project_claimed_waha_observation(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
    )
  ) > 0,
  'first session observation is not serialized before current-state comparison'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM pg_indexes AS index_row
    WHERE index_row.schemaname = 'platform_private'
      AND index_row.tablename = 'waha_event_projection_requests'
      AND index_row.indexname = 'waha_event_projection_requests_attempt_idx'
      AND index_row.indexdef LIKE
        '%(organization_id, work_item_id, attempt_id)%'
  ),
  'projection request finish lookup index is missing or has drifted'
);

-- Earlier suites intentionally leave queue evidence. Keep it immutable while
-- moving only currently-visible test pointers out of this focused claim order.
UPDATE pgmq.q_platform_work_v1
SET vt = clock_timestamp() + INTERVAL '1 day'
WHERE vt <= clock_timestamp();

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
    '46300000-0000-4000-8000-000000000001',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'read',
    'synthetic-p5e-ack-read', 'evo-inbox',
    'p5e-ack-outbound-2', 'message.ack',
    '2026-08-10 10:10:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":3,"ackName":"READ"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-read',
    repeat('a1', 32), '46300000-0000-4000-8000-000000000101'
  ),
  (
    '46300000-0000-4000-8000-000000000002',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'device',
    'synthetic-p5e-ack-older-device', 'evo-inbox',
    'p5e-ack-outbound-2', 'message.ack',
    '2026-08-10 10:09:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":2,"ackName":"DEVICE"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-older',
    repeat('a2', 32), '46300000-0000-4000-8000-000000000102'
  ),
  (
    '46300000-0000-4000-8000-000000000003',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'read-mismatch',
    'synthetic-p5e-ack-mismatch', 'evo-inbox',
    'p5e-ack-outbound-2', 'message.ack',
    '2026-08-10 10:11:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":2,"ackName":"READ"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-mismatch',
    repeat('a3', 32), '46300000-0000-4000-8000-000000000103'
  ),
  (
    '46300000-0000-4000-8000-000000000004',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'server',
    'synthetic-p5e-ack-unbound', 'evo-inbox',
    'p5e-unbound-raw-message-id', 'message.ack',
    '2026-08-10 10:12:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-unbound-raw-message-id","fromMe":true,"ack":1,"ackName":"SERVER"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-unbound',
    repeat('a4', 32), '46300000-0000-4000-8000-000000000104'
  ),
  (
    '46300000-0000-4000-8000-000000000005',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-working', 'evo-inbox',
    'p5e-session-working', 'session.status',
    '2026-08-10 10:20:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"WORKING","data":{"passkey":"synthetic-private-challenge","phone":"+15550000000"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-working',
    repeat('a5', 32), '46300000-0000-4000-8000-000000000105'
  ),
  (
    '46300000-0000-4000-8000-000000000006',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-older', 'evo-inbox',
    'p5e-session-older', 'session.status',
    '2026-08-10 10:19:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"STARTING","data":{"reason":"synthetic-private-old"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-older',
    repeat('a6', 32), '46300000-0000-4000-8000-000000000106'
  ),
  (
    '46300000-0000-4000-8000-000000000007',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-invalid', 'evo-inbox',
    'p5e-session-invalid', 'session.status',
    '2026-08-10 10:21:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"working","data":{"passkey":"must-not-leak"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-invalid',
    repeat('a7', 32), '46300000-0000-4000-8000-000000000107'
  ),
  (
    '46300000-0000-4000-8000-000000000008',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'pending',
    'synthetic-p5e-ack-pending', 'evo-inbox',
    'local-message-ack-delivery:' || repeat('a8', 32) || ':' ||
      repeat('d8', 32),
    'message.ack',
    '2026-08-10 10:00:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5c-history-outbound-1","fromMe":true,"ack":0,"ackName":"PENDING"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-pending',
    repeat('a8', 32), '46300000-0000-4000-8000-000000000108'
  ),
  (
    '46300000-0000-4000-8000-000000000009',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'error',
    'synthetic-p5e-ack-error', 'evo-inbox',
    'local-message-ack-delivery:' || repeat('a9', 32) || ':' ||
      repeat('d9', 32),
    'message.ack',
    '2026-08-10 10:01:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5c-history-outbound-1","fromMe":true,"ack":-1,"ackName":"ERROR"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-error',
    repeat('a9', 32), '46300000-0000-4000-8000-000000000109'
  ),
  (
    '46300000-0000-4000-8000-000000000010',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'device',
    'synthetic-p5e-ack-positive-after-error', 'evo-inbox',
    'local-message-ack-delivery:' || repeat('aa', 32) || ':' ||
      repeat('da', 32),
    'message.ack',
    '2026-08-10 10:02:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5c-history-outbound-1","fromMe":true,"ack":2,"ackName":"DEVICE"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-positive-after-error',
    repeat('aa', 32), '46300000-0000-4000-8000-000000000110'
  ),
  (
    '46300000-0000-4000-8000-000000000011',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'played',
    'synthetic-p5e-ack-timestampless', 'evo-inbox',
    'local-message-ack-delivery:' || repeat('b1', 32) || ':' ||
      repeat('c1', 32),
    'message.ack', '2026-08-10 10:08:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":4,"ackName":"PLAYED"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-timestampless',
    repeat('b1', 32), '46300000-0000-4000-8000-000000000111'
  ),
  (
    '46300000-0000-4000-8000-000000000012',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'device',
    'synthetic-p5e-ack-alias-invalid', 'evo-inbox',
    'local-message-ack-delivery:' || repeat('ff', 32) || ':' ||
      repeat('c2', 32),
    'message.ack', '2026-08-10 10:25:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":2,"ackName":"DEVICE"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-alias-invalid',
    repeat('b2', 32), '46300000-0000-4000-8000-000000000112'
  ),
  (
    '46300000-0000-4000-8000-000000000013',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'server',
    'synthetic-p5e-ack-later-lower', 'evo-inbox',
    'p5e-ack-outbound-2', 'message.ack',
    '2026-08-10 10:30:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":1,"ackName":"SERVER"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-later-lower',
    repeat('b3', 32), '46300000-0000-4000-8000-000000000113'
  ),
  (
    '46300000-0000-4000-8000-000000000014',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'error',
    'synthetic-p5e-ack-late-error', 'evo-inbox',
    'p5e-ack-outbound-2', 'message.ack',
    '2026-08-10 10:31:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"p5e-ack-outbound-2","fromMe":true,"ack":-1,"ackName":"ERROR"}}',
    '{"hmac_verified":true}', 'synthetic:p5e:ack-late-error',
    repeat('b4', 32), '46300000-0000-4000-8000-000000000114'
  ),
  (
    '46300000-0000-4000-8000-000000000015',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-unknown', 'evo-inbox',
    'p5e-session-unknown', 'session.status',
    '2026-08-10 10:30:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"FUTURE_STATE","data":{"passkey":"must-stay-private","provider":"raw"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-unknown',
    repeat('b5', 32), '46300000-0000-4000-8000-000000000115'
  ),
  (
    '46300000-0000-4000-8000-000000000016',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-conflict', 'evo-inbox',
    'p5e-session-conflict', 'session.status',
    '2026-08-10 10:30:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"STARTING","data":{"reason":"equal-time-conflict"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-conflict',
    repeat('b6', 32), '46300000-0000-4000-8000-000000000116'
  ),
  (
    '46300000-0000-4000-8000-000000000017',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5e-session-duplicate', 'evo-inbox',
    'p5e-session-duplicate', 'session.status',
    '2026-08-10 10:30:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"FUTURE_STATE","data":{"provider":"duplicate-delivery"}}}',
    '{"hmac_verified":true}', 'synthetic:p5e:session-duplicate',
    repeat('b7', 32), '46300000-0000-4000-8000-000000000117'
  );

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

-- Exercise the legacy fail-closed ERROR state machine in isolation before the
-- rank/out-of-order sequence below.
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000008',
  encode(sha256(convert_to('p5e-ack-pending', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000208'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000009',
  encode(sha256(convert_to('p5e-ack-error', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000209'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000010',
  encode(sha256(convert_to('p5e-ack-positive-after-error', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000210'
);

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000001',
  encode(sha256(convert_to('p5e-ack-read', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000201'
)::TEXT AS ack_read_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000002',
  encode(sha256(convert_to('p5e-ack-older', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000202'
)::TEXT AS ack_older_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000003',
  encode(sha256(convert_to('p5e-ack-mismatch', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000203'
)::TEXT AS ack_mismatch_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000004',
  encode(sha256(convert_to('p5e-ack-unbound', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000204'
)::TEXT AS ack_unbound_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000005',
  encode(sha256(convert_to('p5e-session-working', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000205'
)::TEXT AS session_working_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000006',
  encode(sha256(convert_to('p5e-session-older', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000206'
)::TEXT AS session_older_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000007',
  encode(sha256(convert_to('p5e-session-invalid', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000207'
)::TEXT AS session_invalid_enqueue
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000011',
  encode(sha256(convert_to('p5e-ack-timestampless', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000211'
)::TEXT AS ack_timestampless_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000012',
  encode(sha256(convert_to('p5e-ack-alias-invalid', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000212'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000013',
  encode(sha256(convert_to('p5e-ack-later-lower', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000213'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000014',
  encode(sha256(convert_to('p5e-ack-late-error', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000214'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000015',
  encode(sha256(convert_to('p5e-session-unknown', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000215'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000016',
  encode(sha256(convert_to('p5e-session-conflict', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000216'
);
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '46300000-0000-4000-8000-000000000017',
  encode(sha256(convert_to('p5e-session-duplicate', 'UTF8')), 'hex'),
  4,
  '46300000-0000-4000-8000-000000000217'
);

-- Tenant-scoped claim may not lease another organization's pointer.
SELECT platform.claim_waha_event_projection(
  :'org_b_id', 300, 'p5e-cross-org-worker',
  '46300000-0000-4000-8000-000000000301'
)::TEXT AS cross_org_claim
\gset

SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-ack-pending-worker',
  '46300000-0000-4000-8000-000000000310',
  '46300000-0000-4000-8000-000000000410',
  '46300000-0000-4000-8000-000000000510'
)::TEXT AS ack_pending_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-ack-error-worker',
  '46300000-0000-4000-8000-000000000311',
  '46300000-0000-4000-8000-000000000411',
  '46300000-0000-4000-8000-000000000511'
)::TEXT AS ack_error_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id',
  'p5e-ack-positive-after-error-worker',
  '46300000-0000-4000-8000-000000000312',
  '46300000-0000-4000-8000-000000000412',
  '46300000-0000-4000-8000-000000000512'
)::TEXT AS ack_positive_after_error_run
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'ack_pending_run'::JSONB #>> '{projection,waha_ack_name}' = 'PENDING'
  AND :'ack_error_run'::JSONB #>> '{projection,waha_ack_name}' = 'ERROR'
  AND (:'ack_error_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN
  AND NOT (:'ack_positive_after_error_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN
  AND current_ack.waha_ack_name = 'ERROR'
  AND current_ack.waha_ack_observed_at =
    '2026-08-10 10:01:00+06'::TIMESTAMPTZ
FROM platform.waha_message_ack_current AS current_ack
WHERE current_ack.organization_id = :'org_a_id'
  AND current_ack.communication_message_id = :'outbound_message_id';

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-read-worker',
  '46300000-0000-4000-8000-000000000302'
)::TEXT AS ack_read_claim
\gset
SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-read-worker',
  '46300000-0000-4000-8000-000000000302'
)::TEXT AS ack_read_claim_replay
\gset

SAVEPOINT expect_cross_org_project_denied;
\set ON_ERROR_STOP off
SELECT platform.project_claimed_waha_observation(
  :'org_b_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_b_membership_id',
  '46300000-0000-4000-8000-000000000401'
);
\set cross_org_project_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_cross_org_project_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_cross_org_project_denied;

SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000402'
)::TEXT AS ack_read_projection
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000402'
)::TEXT AS ack_read_projection_replay
\gset

SAVEPOINT expect_projection_request_collision;
\set ON_ERROR_STOP off
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_b_membership_id',
  '46300000-0000-4000-8000-000000000402'
);
\set projection_request_collision_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_projection_request_collision;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_projection_request_collision;

SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_read_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_read_projection'::JSONB ->> 'error_code',
  :'ack_read_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000501'
)::TEXT AS ack_read_finish
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_read_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_read_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_read_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_read_projection'::JSONB ->> 'error_code',
  :'ack_read_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000501'
)::TEXT AS ack_read_finish_replay
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-older-worker',
  '46300000-0000-4000-8000-000000000303'
)::TEXT AS ack_older_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_older_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_older_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000403'
)::TEXT AS ack_older_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_older_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_older_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_older_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_older_projection'::JSONB ->> 'error_code',
  :'ack_older_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000502'
)::TEXT AS ack_older_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-mismatch-worker',
  '46300000-0000-4000-8000-000000000304'
)::TEXT AS ack_mismatch_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_mismatch_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_mismatch_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000404'
)::TEXT AS ack_mismatch_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_mismatch_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_mismatch_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_mismatch_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_mismatch_projection'::JSONB ->> 'error_code',
  :'ack_mismatch_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000503'
)::TEXT AS ack_mismatch_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-unbound-worker',
  '46300000-0000-4000-8000-000000000305'
)::TEXT AS ack_unbound_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_unbound_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_unbound_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000405'
)::TEXT AS ack_unbound_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_unbound_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_unbound_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_unbound_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_unbound_projection'::JSONB ->> 'error_code',
  :'ack_unbound_projection'::JSONB ->> 'evidence_ref',
  3600,
  '46300000-0000-4000-8000-000000000504'
)::TEXT AS ack_unbound_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-session-working-worker',
  '46300000-0000-4000-8000-000000000306'
)::TEXT AS session_working_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'session_working_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_working_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000406'
)::TEXT AS session_working_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'session_working_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_working_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'session_working_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'session_working_projection'::JSONB ->> 'error_code',
  :'session_working_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000505'
)::TEXT AS session_working_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-session-older-worker',
  '46300000-0000-4000-8000-000000000307'
)::TEXT AS session_older_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'session_older_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_older_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000407'
)::TEXT AS session_older_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'session_older_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_older_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'session_older_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'session_older_projection'::JSONB ->> 'error_code',
  :'session_older_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000506'
)::TEXT AS session_older_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-session-invalid-worker',
  '46300000-0000-4000-8000-000000000308'
)::TEXT AS session_invalid_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'session_invalid_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_invalid_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000408'
)::TEXT AS session_invalid_projection
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'session_invalid_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'session_invalid_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'session_invalid_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'session_invalid_projection'::JSONB ->> 'error_code',
  :'session_invalid_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000507'
)::TEXT AS session_invalid_finish
\gset

SELECT platform.claim_waha_event_projection(
  :'org_a_id', 300, 'p5e-ack-timestampless-worker',
  '46300000-0000-4000-8000-000000000320'
)::TEXT AS ack_timestampless_claim
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_timestampless_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_timestampless_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000420'
)::TEXT AS ack_timestampless_projection
\gset
SELECT platform.project_claimed_waha_observation(
  :'org_a_id',
  (:'ack_timestampless_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_timestampless_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_a_membership_id',
  '46300000-0000-4000-8000-000000000420'
)::TEXT AS ack_timestampless_projection_replay
\gset
SELECT platform.finish_waha_event_projection(
  :'org_a_id',
  (:'ack_timestampless_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'ack_timestampless_claim'::JSONB ->> 'attempt_id')::UUID,
  (:'ack_timestampless_projection'::JSONB ->> 'disposition')::platform.durable_work_finish_outcome,
  :'ack_timestampless_projection'::JSONB ->> 'error_code',
  :'ack_timestampless_projection'::JSONB ->> 'evidence_ref',
  NULL,
  '46300000-0000-4000-8000-000000000520'
)::TEXT AS ack_timestampless_finish
\gset

SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-ack-alias-invalid-worker',
  '46300000-0000-4000-8000-000000000321',
  '46300000-0000-4000-8000-000000000421',
  '46300000-0000-4000-8000-000000000521'
)::TEXT AS ack_alias_invalid_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-ack-later-lower-worker',
  '46300000-0000-4000-8000-000000000322',
  '46300000-0000-4000-8000-000000000422',
  '46300000-0000-4000-8000-000000000522'
)::TEXT AS ack_later_lower_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-ack-late-error-worker',
  '46300000-0000-4000-8000-000000000323',
  '46300000-0000-4000-8000-000000000423',
  '46300000-0000-4000-8000-000000000523'
)::TEXT AS ack_late_error_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-session-unknown-worker',
  '46300000-0000-4000-8000-000000000324',
  '46300000-0000-4000-8000-000000000424',
  '46300000-0000-4000-8000-000000000524'
)::TEXT AS session_unknown_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-session-conflict-worker',
  '46300000-0000-4000-8000-000000000325',
  '46300000-0000-4000-8000-000000000425',
  '46300000-0000-4000-8000-000000000525'
)::TEXT AS session_conflict_run
\gset
SELECT pg_temp.process_next_waha_observation(
  :'org_a_id', :'sales_a_membership_id', 'p5e-session-duplicate-worker',
  '46300000-0000-4000-8000-000000000326',
  '46300000-0000-4000-8000-000000000426',
  '46300000-0000-4000-8000-000000000526'
)::TEXT AS session_duplicate_run
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  (:'cross_org_claim'::JSONB ->> 'claimed')::BOOLEAN = FALSE
  AND :'cross_org_project_state' <> '00000',
  'cross-organization WAHA work was claimed or projected'
);

SELECT pg_temp.assert_true(
  :'ack_read_claim' = :'ack_read_claim_replay'
  AND :'ack_read_projection' = :'ack_read_projection_replay'
  AND :'ack_read_finish' = :'ack_read_finish_replay'
  AND :'ack_timestampless_projection' =
    :'ack_timestampless_projection_replay'
  AND :'projection_request_collision_state' = '22023',
  'claim/project/finish replay or request collision safety failed'
);

SELECT pg_temp.assert_true(
  :'ack_read_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND :'ack_read_projection'::JSONB ->> 'waha_ack_name' = 'READ'
  AND (:'ack_read_projection'::JSONB ->> 'current_state_updated')::BOOLEAN
  AND :'ack_older_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND NOT (
    :'ack_older_projection'::JSONB ->> 'current_state_updated'
  )::BOOLEAN
  AND :'ack_mismatch_projection'::JSONB ->> 'disposition' =
    'terminal_error'
  AND :'ack_mismatch_projection'::JSONB ->> 'error_code' =
    'waha_ack_pair_mismatch'
  AND :'ack_unbound_projection'::JSONB ->> 'disposition' =
    'retryable_error'
  AND :'ack_unbound_projection'::JSONB ->> 'error_code' =
    'waha_ack_binding_pending'
  AND :'ack_timestampless_projection'::JSONB ->> 'disposition' =
    'succeeded'
  AND :'ack_timestampless_projection'::JSONB ->> 'waha_ack_name' =
    'PLAYED'
  AND (:'ack_timestampless_projection'::JSONB ->>
    'current_state_updated')::BOOLEAN
  AND :'ack_alias_invalid_run'::JSONB #>>
    '{projection,disposition}' = 'terminal_error'
  AND :'ack_alias_invalid_run'::JSONB #>>
    '{projection,error_code}' = 'waha_ack_identity_invalid'
  AND NOT (:'ack_later_lower_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN
  AND NOT (:'ack_late_error_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN,
  'ACK exact-pair, missing-binding or out-of-order dispositions drifted'
);

SELECT pg_temp.assert_true(
  current_ack.waha_ack_name = 'PLAYED'
  AND current_ack.waha_ack_observed_at =
    '2026-08-10 10:08:00+06'::TIMESTAMPTZ
FROM platform.waha_message_ack_current AS current_ack
WHERE current_ack.organization_id = :'org_a_id'
  AND current_ack.communication_message_id = :'positive_outbound_message_id';

SELECT pg_temp.assert_true(
  count(*) = 3
  AND count(*) FILTER (
    WHERE observation.ack_name = 'PENDING'
      AND observation.ack_code = 0
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'ERROR'
      AND observation.ack_code = -1
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'DEVICE'
      AND observation.ack_code = 2
      AND observation.from_me
  ) = 1
  AND bool_and(
    observation.raw_message_id = 'p5c-history-outbound-1'
  )
FROM platform_private.waha_ack_observations AS observation
WHERE observation.organization_id = :'org_a_id'
  AND observation.communication_message_id = :'outbound_message_id';

SELECT pg_temp.assert_true(
  count(*) = 5
  AND count(*) FILTER (
    WHERE observation.ack_name = 'READ'
      AND observation.ack_code = 3
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'DEVICE'
      AND observation.ack_code = 2
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'ERROR'
      AND observation.ack_code = -1
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'PLAYED'
      AND observation.ack_code = 4
      AND observation.from_me
  ) = 1
  AND count(*) FILTER (
    WHERE observation.ack_name = 'SERVER'
      AND observation.ack_code = 1
      AND observation.from_me
  ) = 1
  AND bool_and(
    observation.raw_message_id = 'p5e-ack-outbound-2'
  )
FROM platform_private.waha_ack_observations AS observation
WHERE observation.organization_id = :'org_a_id'
  AND observation.communication_message_id = :'positive_outbound_message_id';

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_ack_observations AS observation
    WHERE observation.organization_id = :'org_a_id'
      AND observation.source_webhook_event_id IN (
        '46300000-0000-4000-8000-000000000003',
        '46300000-0000-4000-8000-000000000004',
        '46300000-0000-4000-8000-000000000012'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_event_projection_effects AS effect
    WHERE effect.organization_id = :'org_a_id'
      AND effect.work_item_id =
        (:'ack_unbound_claim'::JSONB ->> 'work_item_id')::UUID
  ),
  'malformed or retryable ACK created immutable success evidence'
);

SELECT pg_temp.assert_true(
  :'session_working_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND (:'session_working_projection'::JSONB ->> 'current_state_updated')::BOOLEAN
  AND :'session_older_projection'::JSONB ->> 'disposition' = 'succeeded'
  AND NOT (
    :'session_older_projection'::JSONB ->> 'current_state_updated'
  )::BOOLEAN
  AND :'session_invalid_projection'::JSONB ->> 'disposition' =
    'terminal_error'
  AND :'session_invalid_projection'::JSONB ->> 'error_code' =
    'waha_session_status_invalid'
  AND :'session_unknown_run'::JSONB #>>
    '{projection,disposition}' = 'succeeded'
  AND (:'session_unknown_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN
  AND :'session_conflict_run'::JSONB #>>
    '{projection,disposition}' = 'terminal_error'
  AND :'session_conflict_run'::JSONB #>>
    '{projection,error_code}' = 'waha_session_status_conflict'
  AND :'session_duplicate_run'::JSONB #>>
    '{projection,disposition}' = 'succeeded'
  AND NOT (:'session_duplicate_run'::JSONB #>>
    '{projection,current_state_updated}')::BOOLEAN,
  'session bounded-status or out-of-order dispositions drifted'
);

SELECT pg_temp.assert_true(
  health.waha_session_name = 'evo-inbox'
  AND health.status = 'FUTURE_STATE'
  AND health.status <> 'WORKING'
  AND health.observed_at = '2026-08-10 10:30:00+06'::TIMESTAMPTZ
  AND position('passkey' IN row_to_json(health)::TEXT) = 0
  AND position('+15550000000' IN row_to_json(health)::TEXT) = 0
FROM platform.waha_session_health AS health
WHERE health.organization_id = :'org_a_id';

SELECT pg_temp.assert_true(
  count(*) = 5
  AND count(*) FILTER (WHERE observation.status = 'WORKING') = 1
  AND count(*) FILTER (WHERE observation.status = 'STARTING') = 2
  AND count(*) FILTER (WHERE observation.status = 'FUTURE_STATE') = 2
FROM platform_private.waha_session_observations AS observation
WHERE observation.organization_id = :'org_a_id';

-- Broadcast is an organization-scoped invalidation only. Force a conversation
-- change so all public resource families covered by this suite have emitted or
-- installed an invalidation path.
UPDATE platform.communication_conversations
SET updated_at = updated_at
WHERE organization_id = :'org_a_id'
  AND id = :'outbound_conversation_id';

SELECT realtime.send(
  jsonb_build_object('resource', 'session'),
  'invalidate',
  'platform-messaging:' || :'org_b_id',
  TRUE
);

SELECT pg_temp.assert_true(
  count(*) = 4
FROM pg_trigger AS trigger_row
WHERE NOT trigger_row.tgisinternal
  AND trigger_row.tgname IN (
    'communication_conversations_realtime_invalidate',
    'communication_messages_realtime_invalidate',
    'communication_message_media_realtime_invalidate',
    'waha_session_health_realtime_invalidate'
  )
  AND trigger_row.tgfoid =
    'platform_private.broadcast_platform_messaging_invalidation()'::REGPROCEDURE
);

SELECT pg_temp.assert_true(
  count(*) > 0
  AND bool_and(message.extension = 'broadcast')
  AND bool_and(message.event = 'invalidate')
  AND bool_and(message.private)
  AND bool_and(jsonb_object_length(message.payload) = 1)
  AND bool_and(message.payload ? 'resource')
  AND bool_and(
    message.payload ->> 'resource' IN (
      'conversation', 'message', 'media', 'session'
    )
  )
  AND bool_and(
    position('p5c-history-outbound-1' IN message.payload::TEXT) = 0
  )
  AND bool_and(
    position(:'outbound_message_id' IN message.payload::TEXT) = 0
  )
  AND bool_and(position('passkey' IN message.payload::TEXT) = 0)
FROM realtime.messages AS message
WHERE message.topic = 'platform-messaging:' || :'org_a_id';

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'realtime.send(jsonb,text,text,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'realtime.send(jsonb,text,text,boolean)',
    'EXECUTE'
  )
  AND (
    SELECT count(*) = 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'platform_messaging_broadcast_read'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::NAME[]
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND cmd = 'INSERT'
      AND 'authenticated' = ANY(roles)
  ),
  'Realtime receive-only grants or policy shape drifted'
);

SELECT 'platform-messaging:' || :'org_a_id' AS org_a_topic,
       'platform-messaging:' || :'org_b_id' AS org_b_topic
\gset

SET request.jwt.claims TO :'sales_a_claims';
SELECT set_config('realtime.topic', :'org_a_topic', TRUE);
SET ROLE authenticated;

SELECT COALESCE(jsonb_agg(to_jsonb(message_row)), '[]'::JSONB)::TEXT
  AS staff_messages
FROM platform.staff_conversation_messages(
  :'org_a_id', :'outbound_conversation_id'
) AS message_row
\gset

SELECT to_jsonb(health_row)::TEXT AS staff_session_health
FROM platform.staff_waha_session_health(:'org_a_id') AS health_row
\gset

SELECT count(*)::TEXT AS own_realtime_count
FROM realtime.messages
WHERE topic = :'org_a_topic'
  AND extension = 'broadcast'
\gset

SELECT count(*)::TEXT AS own_realtime_visible_total
FROM realtime.messages
\gset

SAVEPOINT expect_cross_org_health_denied;
\set ON_ERROR_STOP off
SELECT * FROM platform.staff_waha_session_health(:'org_b_id');
\set cross_org_health_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_cross_org_health_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_cross_org_health_denied;

SAVEPOINT expect_private_ack_denied;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.waha_ack_observations;
\set private_ack_select_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_private_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_private_ack_denied;

SAVEPOINT expect_realtime_insert_denied;
\set ON_ERROR_STOP off
INSERT INTO realtime.messages (topic, extension, payload, event, private)
VALUES (:'org_a_topic', 'broadcast', '{}', 'invalidate', TRUE);
\set realtime_insert_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_realtime_insert_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_realtime_insert_denied;

SAVEPOINT expect_realtime_send_denied;
\set ON_ERROR_STOP off
SELECT realtime.send('{}', 'invalidate', :'org_a_topic', TRUE);
\set realtime_send_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_realtime_send_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_realtime_send_denied;

RESET ROLE;
SELECT set_config('realtime.topic', :'org_b_topic', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS cross_org_realtime_count
FROM realtime.messages
\gset

RESET ROLE;
SELECT set_config('realtime.topic', 'platform-messaging:not-a-uuid', TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS malformed_topic_realtime_count
FROM realtime.messages
\gset

RESET ROLE;
SELECT set_config('realtime.topic', upper(:'org_a_topic'), TRUE);
SET ROLE authenticated;
SELECT count(*)::TEXT AS non_exact_topic_realtime_count
FROM realtime.messages
\gset

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  jsonb_array_length(:'staff_messages'::JSONB) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(:'staff_messages'::JSONB) AS message_row
    WHERE message_row ->> 'message_id' = :'positive_outbound_message_id'
      AND message_row ->> 'waha_ack_name' = 'PLAYED'
      AND message_row ->> 'waha_ack_observed_at' IS NOT NULL
      AND message_row ? 'media'
  )
  AND position('p5c-history-outbound-1' IN :'staff_messages') = 0
  AND position('raw_message_id' IN :'staff_messages') = 0,
  'staff messages lost safe delivery fields or leaked raw identity'
);

SELECT pg_temp.assert_true(
  jsonb_object_length(:'staff_session_health'::JSONB) = 3
  AND :'staff_session_health'::JSONB ?&
    ARRAY['waha_session_name', 'status', 'observed_at']
  AND :'staff_session_health'::JSONB ->> 'waha_session_name' = 'evo-inbox'
  AND :'staff_session_health'::JSONB ->> 'status' = 'FUTURE_STATE'
  AND :'staff_session_health'::JSONB ->> 'status' <> 'WORKING'
  AND position('passkey' IN :'staff_session_health') = 0
  AND position('data' IN :'staff_session_health') = 0
  AND :'cross_org_health_state' = '42501',
  'staff session health authority, exact shape or fail-closed status drifted'
);

SELECT pg_temp.assert_true(
  :'own_realtime_count'::INTEGER > 0
  AND :'own_realtime_visible_total'::INTEGER =
    :'own_realtime_count'::INTEGER
  AND :'cross_org_realtime_count'::INTEGER = 0
  AND :'malformed_topic_realtime_count'::INTEGER = 0
  AND :'non_exact_topic_realtime_count'::INTEGER = 0
  AND :'private_ack_select_state' = '42501'
  AND :'realtime_insert_state' = '42501'
  AND :'realtime_send_state' = '42501',
  'Realtime tenant policy or private raw-evidence denial failed'
);

SAVEPOINT expect_ack_append_only;
\set ON_ERROR_STOP off
UPDATE platform_private.waha_ack_observations
SET ack_name = ack_name
WHERE organization_id = :'org_a_id'
  AND source_webhook_event_id =
    '46300000-0000-4000-8000-000000000001';
\set ack_append_only_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_ack_append_only;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_ack_append_only;

SAVEPOINT expect_current_ack_update_denied;
\set ON_ERROR_STOP off
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
UPDATE platform.waha_message_ack_current
SET waha_ack_name = 'READ'
WHERE organization_id = :'org_a_id'
  AND communication_message_id = :'positive_outbound_message_id';
\set current_ack_update_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_current_ack_update_denied;
RESET ROLE;
RESET request.jwt.claims;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_current_ack_update_denied;

SAVEPOINT expect_session_append_only;
\set ON_ERROR_STOP off
DELETE FROM platform_private.waha_session_observations
WHERE organization_id = :'org_a_id'
  AND source_webhook_event_id =
    '46300000-0000-4000-8000-000000000005';
\set session_append_only_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_session_append_only;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_session_append_only;

SELECT pg_temp.assert_true(
  :'ack_append_only_state' = '55000'
  AND :'current_ack_update_state' = '42501'
  AND :'session_append_only_state' = '55000',
  'private ACK evidence or direct current-state writes were not blocked'
);

ROLLBACK;

SELECT 'platform WAHA ACK/session/realtime RLS checks passed' AS result;
