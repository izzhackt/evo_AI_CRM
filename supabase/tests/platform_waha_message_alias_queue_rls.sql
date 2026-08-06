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

\echo 'P5A WAHA message alias queue acceptance passed'
