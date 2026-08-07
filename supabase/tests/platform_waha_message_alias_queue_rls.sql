\set ON_ERROR_STOP on

-- P5A acceptance uses deterministic UUIDs and synthetic provider payloads in
-- the disposable authorization database. It does not contact WAHA or enqueue
-- production work.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5A assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO service_role;

SELECT membership.organization_id AS org_a_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
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
)
VALUES
  (
    '45900000-0000-4000-8000-000000000101',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5a-alias-message-first', 'evo-inbox',
    'wamid.synthetic-p5a-message-first', 'message',
    '2026-08-07 09:00:00+06'::TIMESTAMPTZ, 'verified',
    '{"event":"message","session":"evo-inbox"}'::JSONB,
    '{"hmac_verified":true}'::JSONB,
    'synthetic:p5a:message-first', repeat('1a', 32),
    '45900000-0000-4000-8000-000000000111'
  ),
  (
    '45900000-0000-4000-8000-000000000102',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5a-alias-any-second', 'evo-inbox',
    'wamid.synthetic-p5a-message-first', 'message.any',
    '2026-08-07 09:00:00+06'::TIMESTAMPTZ, 'verified',
    '{"event":"message.any","session":"evo-inbox"}'::JSONB,
    '{"hmac_verified":true}'::JSONB,
    'synthetic:p5a:any-second', repeat('2b', 32),
    '45900000-0000-4000-8000-000000000112'
  ),
  (
    '45900000-0000-4000-8000-000000000103',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5a-alias-any-first', 'evo-inbox',
    'wamid.synthetic-p5a-any-first', 'message.any',
    '2026-08-07 09:01:00+06'::TIMESTAMPTZ, 'verified',
    '{"event":"message.any","session":"evo-inbox"}'::JSONB,
    '{"hmac_verified":true}'::JSONB,
    'synthetic:p5a:any-first', repeat('3c', 32),
    '45900000-0000-4000-8000-000000000113'
  ),
  (
    '45900000-0000-4000-8000-000000000104',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5a-alias-message-second', 'evo-inbox',
    'wamid.synthetic-p5a-any-first', 'message',
    '2026-08-07 09:01:00+06'::TIMESTAMPTZ, 'verified',
    '{"event":"message","session":"evo-inbox"}'::JSONB,
    '{"hmac_verified":true}'::JSONB,
    'synthetic:p5a:message-second', repeat('4d', 32),
    '45900000-0000-4000-8000-000000000114'
  ),
  (
    '45900000-0000-4000-8000-000000000105',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5a-unrelated-any', 'evo-inbox',
    'wamid.synthetic-p5a-unrelated', 'message.any',
    '2026-08-07 09:02:00+06'::TIMESTAMPTZ, 'verified',
    '{"event":"message.any","session":"evo-inbox"}'::JSONB,
    '{"hmac_verified":true}'::JSONB,
    'synthetic:p5a:unrelated-any', repeat('5e', 32),
    '45900000-0000-4000-8000-000000000115'
  );

SELECT count(*)::TEXT AS p5a_alias_baseline_work_count
FROM platform_private.durable_work_items
\gset
SELECT encode(
  sha256(convert_to('p5a-message-first-business-key', 'UTF8')),
  'hex'
) AS p5a_message_first_business_key
\gset
SELECT encode(
  sha256(convert_to('p5a-any-first-business-key', 'UTF8')),
  'hex'
) AS p5a_any_first_business_key
\gset

SET request.jwt.claims TO '{"role":"service_role"}';

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '45900000-0000-4000-8000-000000000101',
  :'p5a_message_first_business_key', 8,
  '45900000-0000-4000-8000-000000000201'
)::TEXT AS p5a_message_first_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '45900000-0000-4000-8000-000000000102',
  :'p5a_message_first_business_key', 8,
  '45900000-0000-4000-8000-000000000202'
)::TEXT AS p5a_any_second_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '45900000-0000-4000-8000-000000000103',
  :'p5a_any_first_business_key', 8,
  '45900000-0000-4000-8000-000000000203'
)::TEXT AS p5a_any_first_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '45900000-0000-4000-8000-000000000104',
  :'p5a_any_first_business_key', 8,
  '45900000-0000-4000-8000-000000000204'
)::TEXT AS p5a_message_second_enqueue
\gset

\set ON_ERROR_STOP off
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '45900000-0000-4000-8000-000000000105',
  :'p5a_message_first_business_key', 8,
  '45900000-0000-4000-8000-000000000205'
);
\set p5a_unrelated_source_state :SQLSTATE
\set ON_ERROR_STOP on

RESET request.jwt.claims;

SELECT count(*)::TEXT AS p5a_alias_after_work_count
FROM platform_private.durable_work_items
\gset

SELECT pg_temp.assert_true(
  (:'p5a_message_first_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_any_second_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE
    AND (:'p5a_message_first_enqueue'::JSONB ->> 'work_item_id') =
      (:'p5a_any_second_enqueue'::JSONB ->> 'work_item_id')
    AND (:'p5a_any_second_enqueue'::JSONB ->>
      'source_webhook_event_id') =
      '45900000-0000-4000-8000-000000000101'
    AND (:'p5a_any_first_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_message_second_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE
    AND (:'p5a_any_first_enqueue'::JSONB ->> 'work_item_id') =
      (:'p5a_message_second_enqueue'::JSONB ->> 'work_item_id')
    AND (:'p5a_message_second_enqueue'::JSONB ->>
      'source_webhook_event_id') =
      '45900000-0000-4000-8000-000000000103'
    AND :'p5a_unrelated_source_state' <> '00000'
    AND :'p5a_alias_after_work_count'::INTEGER =
      :'p5a_alias_baseline_work_count'::INTEGER + 2,
  'WAHA message aliases did not converge safely on durable work'
);

-- A documented session.status delivery may omit both the general envelope ID
-- and body occurrence time. Fresh request headers distinguish raw transport
-- observations, but the HMAC signs only the body. Byte-identical signed bodies
-- therefore keep separate raw evidence while converging on one business work
-- item; a different signed body cannot reuse that key.
SET request.jwt.claims TO '{"role":"service_role"}';

SELECT count(*)::TEXT AS p5a_status_baseline_event_count
FROM platform_private.provider_webhook_events
WHERE organization_id = :'org_a_id'
  AND provider = 'waha'
  AND event_type = 'session.status'
  AND waha_session_name = 'evo-inbox'
  AND provider_request_id LIKE 'synthetic-p5a-status-%'
\gset
SELECT count(*)::TEXT AS p5a_status_baseline_work_count
FROM platform_private.durable_work_items
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-p5a-status-first', 'evo-inbox',
  'local-session-status-delivery:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8:c60f3c4f46d81546b94d6dcb0d3a5674506981a807d2bad4554de9365a8b64cf',
  'session.status', '2026-08-06 04:45:09+00'::TIMESTAMPTZ, 'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"status":"SCAN_QR_CODE","data":{"attempt":1,"reason":"synthetic-regression"}}}'::JSONB,
  '{"hmac_algorithm":"sha512","hmac_verified":true,"request_id_present":true,"timestamp_freshness_verified":true}'::JSONB,
  'waha-raw-sha256:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  'cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  '45900000-0000-4000-8000-000000000301'
)::TEXT AS p5a_status_first_persist
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-p5a-status-first', 'evo-inbox',
  'local-session-status-delivery:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8:c60f3c4f46d81546b94d6dcb0d3a5674506981a807d2bad4554de9365a8b64cf',
  'session.status', '2026-08-06 04:45:09+00'::TIMESTAMPTZ, 'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"status":"SCAN_QR_CODE","data":{"attempt":1,"reason":"synthetic-regression"}}}'::JSONB,
  '{"hmac_algorithm":"sha512","hmac_verified":true,"request_id_present":true,"timestamp_freshness_verified":true}'::JSONB,
  'waha-raw-sha256:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  'cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  '45900000-0000-4000-8000-000000000302'
)::TEXT AS p5a_status_exact_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.persist_provider_webhook_event(
  :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-p5a-status-first', 'evo-inbox',
  'local-session-status-delivery:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8:ac075e13bf8f452fc1cbc642352933660a6660bbd95006e4c758fd6e5a4deb49',
  'session.status', '2026-08-06 04:45:10+00'::TIMESTAMPTZ, 'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"status":"SCAN_QR_CODE","data":{"attempt":1,"reason":"synthetic-regression"}}}'::JSONB,
  '{"hmac_algorithm":"sha512","hmac_verified":true,"request_id_present":true,"timestamp_freshness_verified":true}'::JSONB,
  'waha-raw-sha256:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  'cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  '45900000-0000-4000-8000-000000000307'
);
\set p5a_status_reused_request_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.persist_provider_webhook_event(
  :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-p5a-status-later', 'evo-inbox',
  'local-session-status-delivery:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8:f5e40e4d91bf81840c8c98774beeb561a8eb73517c35f940c9710c16dda9d445',
  'session.status', '2026-08-06 04:45:10+00'::TIMESTAMPTZ, 'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"status":"SCAN_QR_CODE","data":{"attempt":1,"reason":"synthetic-regression"}}}'::JSONB,
  '{"hmac_algorithm":"sha512","hmac_verified":true,"request_id_present":true,"timestamp_freshness_verified":true}'::JSONB,
  'waha-raw-sha256:cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  'cc9efb4d002cd270a765b16706bf6ff923f59e65ec1bbe6ebcc232ac73920db8',
  '45900000-0000-4000-8000-000000000303'
)::TEXT AS p5a_status_later_persist
\gset

SELECT platform.persist_provider_webhook_event(
  :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-p5a-status-unrelated', 'evo-inbox',
  'local-session-status-delivery:8fb5339d90af017f79f8e9fa5612360aed68584c86c6784da7276ec6a991f4f6:7a3c3233c6f8306e0a6146294a739eecaf08d700dadbd1c75d9616d57e1eda3b',
  'session.status', '2026-08-06 04:45:11+00'::TIMESTAMPTZ, 'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"status":"SCAN_QR_CODE","data":{"attempt":1,"reason":"synthetic-unrelated"}}}'::JSONB,
  '{"hmac_algorithm":"sha512","hmac_verified":true,"request_id_present":true,"timestamp_freshness_verified":true}'::JSONB,
  'waha-raw-sha256:8fb5339d90af017f79f8e9fa5612360aed68584c86c6784da7276ec6a991f4f6',
  '8fb5339d90af017f79f8e9fa5612360aed68584c86c6784da7276ec6a991f4f6',
  '45900000-0000-4000-8000-000000000308'
)::TEXT AS p5a_status_unrelated_persist
\gset

SELECT encode(
  sha256(convert_to('p5a-status-first-business-key', 'UTF8')),
  'hex'
) AS p5a_status_first_business_key
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  (:'p5a_status_first_persist'::JSONB ->> 'provider_webhook_event_id')::UUID,
  :'p5a_status_first_business_key', 8,
  '45900000-0000-4000-8000-000000000304'
)::TEXT AS p5a_status_first_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  (:'p5a_status_exact_replay'::JSONB ->> 'provider_webhook_event_id')::UUID,
  :'p5a_status_first_business_key', 8,
  '45900000-0000-4000-8000-000000000305'
)::TEXT AS p5a_status_replay_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  (:'p5a_status_later_persist'::JSONB ->> 'provider_webhook_event_id')::UUID,
  :'p5a_status_first_business_key', 8,
  '45900000-0000-4000-8000-000000000306'
)::TEXT AS p5a_status_later_enqueue
\gset

\set ON_ERROR_STOP off
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  (:'p5a_status_unrelated_persist'::JSONB ->> 'provider_webhook_event_id')::UUID,
  :'p5a_status_first_business_key', 8,
  '45900000-0000-4000-8000-000000000309'
);
\set p5a_status_unrelated_source_state :SQLSTATE
\set ON_ERROR_STOP on

RESET request.jwt.claims;

SELECT count(*)::TEXT AS p5a_status_after_event_count
FROM platform_private.provider_webhook_events
WHERE organization_id = :'org_a_id'
  AND provider = 'waha'
  AND event_type = 'session.status'
  AND waha_session_name = 'evo-inbox'
  AND provider_request_id LIKE 'synthetic-p5a-status-%'
\gset
SELECT count(*)::TEXT AS p5a_status_after_work_count
FROM platform_private.durable_work_items
\gset

SELECT pg_temp.assert_true(
  (:'p5a_status_first_persist'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_status_exact_replay'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE
    AND (:'p5a_status_later_persist'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_status_unrelated_persist'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_status_first_persist'::JSONB ->> 'provider_webhook_event_id') =
      (:'p5a_status_exact_replay'::JSONB ->> 'provider_webhook_event_id')
    AND (:'p5a_status_first_persist'::JSONB ->> 'provider_webhook_event_id') <>
      (:'p5a_status_later_persist'::JSONB ->> 'provider_webhook_event_id')
    AND :'p5a_status_reused_request_state' <> '00000'
    AND (:'p5a_status_first_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = FALSE
    AND (:'p5a_status_replay_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE
    AND (:'p5a_status_later_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN = TRUE
    AND (:'p5a_status_first_enqueue'::JSONB ->> 'work_item_id') =
      (:'p5a_status_later_enqueue'::JSONB ->> 'work_item_id')
    AND :'p5a_status_unrelated_source_state' <> '00000'
    AND :'p5a_status_after_event_count'::INTEGER =
      :'p5a_status_baseline_event_count'::INTEGER + 3
    AND :'p5a_status_after_work_count'::INTEGER =
      :'p5a_status_baseline_work_count'::INTEGER + 1,
  'WAHA session.status fallback identity did not preserve repeat evidence safely'
);

\echo 'P5A WAHA message alias and session status queue acceptance passed'
