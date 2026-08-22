\set ON_ERROR_STOP on

-- P5B acceptance uses synthetic signed-provider evidence in the disposable
-- authorization database. It makes no WAHA, WhatsApp, amoCRM or Kommo call.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P5B assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT
  membership.organization_id AS org_a_id,
  membership.id AS sales_a_membership_id
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
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
  membership.current_bundle_id AS p5b_sales_bundle_id
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'sales_a_membership_id'
\gset

SELECT
  scope.id AS p5b_org_scope_id,
  scope.scope_version::TEXT AS p5b_org_scope_version
FROM platform.record_scopes AS scope
WHERE scope.organization_id = :'org_a_id'
  AND scope.scope_kind = 'organization'
  AND scope.scope_key = :'org_a_id'
  AND scope.is_active
\gset

SELECT (max(version) + 1000)::TEXT AS p5b_limited_bundle_version
FROM platform.role_bundle_versions
WHERE role = 'sales'
\gset

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '4b500000-0000-4000-8000-000000000001',
    'p5b-no-scope@example.invalid',
    '{}'::JSONB
  ),
  (
    '4b500000-0000-4000-8000-000000000002',
    'p5b-limited-bundle@example.invalid',
    '{}'::JSONB
  ),
  (
    '4b500000-0000-4000-8000-000000000003',
    'p5b-intake-sales@example.invalid',
    '{}'::JSONB
  );

INSERT INTO platform.profiles (id, auth_user_id, display_name)
VALUES
  (
    '4b500000-0000-4000-8000-000000000011',
    '4b500000-0000-4000-8000-000000000001',
    'P5B no-scope Sales'
  ),
  (
    '4b500000-0000-4000-8000-000000000012',
    '4b500000-0000-4000-8000-000000000002',
    'P5B limited-bundle Sales'
  ),
  (
    '4b500000-0000-4000-8000-000000000014',
    '4b500000-0000-4000-8000-000000000003',
    'P5B authorized intake Sales'
  );

INSERT INTO platform.role_bundle_versions (
  id,
  role,
  version,
  status,
  label,
  published_at
)
VALUES (
  '4b500000-0000-4000-8000-000000000013',
  'sales',
  :'p5b_limited_bundle_version'::BIGINT,
  'draft',
  'P5B Sales without communication read',
  NULL
);

INSERT INTO platform.role_bundle_permissions (
  bundle_id,
  bundle_role,
  permission_key
)
VALUES (
  '4b500000-0000-4000-8000-000000000013',
  'sales',
  'organization.read'
);

UPDATE platform.role_bundle_versions
SET
  status = 'published',
  published_at = statement_timestamp()
WHERE id = '4b500000-0000-4000-8000-000000000013';

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
VALUES
  (
    '4b500000-0000-4000-8000-000000000021',
    :'org_a_id',
    '4b500000-0000-4000-8000-000000000011',
    'active',
    'sales',
    :'p5b_sales_bundle_id'
  ),
  (
    '4b500000-0000-4000-8000-000000000022',
    :'org_a_id',
    '4b500000-0000-4000-8000-000000000012',
    'active',
    'sales',
    '4b500000-0000-4000-8000-000000000013'
  ),
  (
    '4b500000-0000-4000-8000-000000000024',
    :'org_a_id',
    '4b500000-0000-4000-8000-000000000014',
    'active',
    'sales',
    :'p5b_sales_bundle_id'
  );

\set p5b_intake_sales_membership_id '4b500000-0000-4000-8000-000000000024'
\set p5b_rotated_intake_sales_membership_id '4b500000-0000-4000-8000-000000000021'

INSERT INTO platform.membership_scope_assignments (
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  reason,
  request_id
)
VALUES
  (
    :'org_a_id',
    '4b500000-0000-4000-8000-000000000022',
    :'p5b_org_scope_id',
    :'p5b_org_scope_version'::BIGINT,
    1,
    TRUE,
    'service',
    'P5B negative permission fixture only',
    '4b500000-0000-4000-8000-000000000023'
  ),
  (
    :'org_a_id',
    :'p5b_intake_sales_membership_id',
    :'p5b_org_scope_id',
    :'p5b_org_scope_version'::BIGINT,
    1,
    TRUE,
    'service',
    'P5B positive intake authorization fixture',
    '4b500000-0000-4000-8000-000000000024'
  );

SELECT profile.access_version::TEXT AS p5b_intake_access_version_before
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'platform.claim_waha_webhook_work(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.claim_waha_webhook_work(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.claim_waha_webhook_work(uuid,integer,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.finish_waha_webhook_work(uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.finish_waha_webhook_work(uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.finish_waha_webhook_work(uuid,uuid,uuid,platform.durable_work_finish_outcome,text,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.waha_message_bindings',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.waha_message_bindings',
    'SELECT'
  ),
  'WAHA RPC or private raw-message binding privileges are too broad'
);

SELECT pg_temp.assert_true(
  position(
    'SELECT source_event.received_at AS observed_at' IN
    pg_get_functiondef(
      'platform.staff_communication_page(uuid,integer,timestamptz,uuid,platform.communication_queue,platform.communication_status,uuid)'::REGPROCEDURE
    )
  ) > 0
  AND position(
    'source_event.verification_status = ''verified''' IN
    pg_get_functiondef(
      'platform.staff_communication_page(uuid,integer,timestamptz,uuid,platform.communication_queue,platform.communication_status,uuid)'::REGPROCEDURE
    )
  ) > 0
  AND position(
    'conversation.id DESC' IN
    pg_get_functiondef(
      'platform.staff_communication_page(uuid,integer,timestamptz,uuid,platform.communication_queue,platform.communication_status,uuid)'::REGPROCEDURE
    )
  ) > 0,
  'P5B verified receipt-time queue ordering drifted'
);

-- Earlier suites deliberately leave queue rows behind. Quarantine only those
-- pre-existing disposable rows so this focused test has deterministic order.
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
    '4b500000-0000-4000-8000-000000000101',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-main', 'evo-inbox',
    'true_14155550101@c.us_AAA', 'message',
    '2026-08-07 10:00:00+06', 'verified',
    '{"event":"message","session":"evo-inbox","payload":{"id":"true_14155550101@c.us_AAA","timestamp":1786075200,"from":"14155550101@s.whatsapp.net","chatId":"14155550101@c.us","fromMe":false,"source":"app","body":"Synthetic inbound main"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:main', repeat('1a', 32),
    '4b500000-0000-4000-8000-000000000201'
  ),
  (
    '4b500000-0000-4000-8000-000000000102',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-main-alias', 'evo-inbox',
    'true_14155550101@c.us_AAA',
    'message.any', '2026-08-07 10:00:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"true_14155550101@c.us_AAA","timestamp":1786075200,"from":"14155550101@c.us","fromMe":false,"source":"app","body":"Synthetic inbound main"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:main-alias', repeat('1b', 32),
    '4b500000-0000-4000-8000-000000000202'
  ),
  (
    '4b500000-0000-4000-8000-000000000103',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-group', 'evo-inbox', 'p5b-message-group', 'message',
    '2026-08-07 10:01:00+06', 'verified',
    '{"event":"message","session":"evo-inbox","payload":{"id":"p5b-message-group","timestamp":1786075260,"from":"120363000000000000@g.us","fromMe":false,"source":"app","body":"Synthetic group"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:group', repeat('2a', 32),
    '4b500000-0000-4000-8000-000000000203'
  ),
  (
    '4b500000-0000-4000-8000-000000000104',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-media', 'evo-inbox', 'p5b-message-media', 'message',
    '2026-08-07 10:02:00+06', 'verified',
    '{"event":"message","session":"evo-inbox","payload":{"id":"p5b-message-media","timestamp":1786075320,"from":"14155550102@c.us","fromMe":false,"source":"app","body":"","hasMedia":true}}',
    '{"hmac_verified":true}', 'synthetic:p5b:media', repeat('2b', 32),
    '4b500000-0000-4000-8000-000000000204'
  ),
  (
    '4b500000-0000-4000-8000-000000000105',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-empty', 'evo-inbox', 'p5b-message-empty', 'message',
    '2026-08-07 10:03:00+06', 'verified',
    '{"event":"message","session":"evo-inbox","payload":{"id":"p5b-message-empty","timestamp":1786075380,"from":"14155550103@c.us","fromMe":false,"source":"app","body":"   "}}',
    '{"hmac_verified":true}', 'synthetic:p5b:empty', repeat('2c', 32),
    '4b500000-0000-4000-8000-000000000205'
  ),
  (
    '4b500000-0000-4000-8000-000000000106',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-second', 'evo-inbox', 'p5b-message-second', 'message.any',
    '2026-08-07 10:04:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"p5b-message-second","timestamp":1786075440,"from":"14155550101@c.us","fromMe":false,"source":"app","body":"Synthetic inbound second"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:second', repeat('2d', 32),
    '4b500000-0000-4000-8000-000000000206'
  ),
  (
    '4b500000-0000-4000-8000-000000000107',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, 'read',
    'synthetic-p5b-ack', 'evo-inbox', 'p5b-ack-delivery', 'message.ack',
    '2026-08-07 10:05:00+06', 'verified',
    '{"event":"message.ack","session":"evo-inbox","payload":{"id":"true_14155550101@c.us_AAA","from":"14155550101@c.us","fromMe":true,"ack":3,"ackName":"READ"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:ack', repeat('2e', 32),
    '4b500000-0000-4000-8000-000000000207'
  ),
  (
    '4b500000-0000-4000-8000-000000000108',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-status', 'evo-inbox', 'p5b-status-working',
    'session.status', '2026-08-07 10:06:00+06', 'verified',
    '{"event":"session.status","session":"evo-inbox","payload":{"status":"WORKING"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:status', repeat('2f', 32),
    '4b500000-0000-4000-8000-000000000208'
  ),
  (
    '4b500000-0000-4000-8000-000000000109',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-from-me', 'evo-inbox', 'p5b-from-me', 'message.any',
    '2026-08-07 10:07:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"p5b-from-me","timestamp":1786075620,"from":"14155550104@c.us","fromMe":true,"source":"app","body":"Own message"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:from-me', repeat('3a', 32),
    '4b500000-0000-4000-8000-000000000209'
  ),
  (
    '4b500000-0000-4000-8000-000000000110',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-api', 'evo-inbox', 'p5b-api', 'message.any',
    '2026-08-07 10:08:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"p5b-api","timestamp":1786075680,"from":"14155550105@c.us","fromMe":false,"source":"api","body":"API message"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:api', repeat('3b', 32),
    '4b500000-0000-4000-8000-000000000210'
  ),
  (
    '4b500000-0000-4000-8000-000000000111',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-exhausted', 'evo-inbox', 'p5b-exhausted', 'message',
    '2026-08-07 10:09:00+06', 'verified',
    '{"event":"message","session":"evo-inbox","payload":{"id":"p5b-exhausted","timestamp":1786075740,"from":"14155550106@c.us","fromMe":false,"source":"app","body":"Expired retry budget"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:exhausted', repeat('3c', 32),
    '4b500000-0000-4000-8000-000000000211'
  ),
  (
    '4b500000-0000-4000-8000-000000000112',
    :'org_a_id', 'waha', 'waha:other-session', NULL, NULL,
    'synthetic-p5b-other-session', 'other-session',
    'p5b-other-session', 'message',
    '2026-08-07 10:10:00+06', 'verified',
    '{"event":"message","session":"other-session","payload":{"id":"p5b-other-session","timestamp":1786075800,"from":"14155550107@c.us","fromMe":false,"source":"app","body":"Wrong WAHA account"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:other-session', repeat('3d', 32),
    '4b500000-0000-4000-8000-000000000212'
  ),
  (
    '4b500000-0000-4000-8000-000000000113',
    :'org_a_id', 'waha', 'waha:evo-inbox', NULL, NULL,
    'synthetic-p5b-metadata-mismatch', 'evo-inbox',
    'p5b-metadata-mismatch', 'message',
    '2026-08-07 10:11:00+06', 'verified',
    '{"event":"message.any","session":"evo-inbox","payload":{"id":"p5b-metadata-mismatch","timestamp":1786075860,"from":"14155550108@c.us","fromMe":false,"source":"app","body":"Mismatched envelope"}}',
    '{"hmac_verified":true}', 'synthetic:p5b:metadata-mismatch', repeat('3e', 32),
    '4b500000-0000-4000-8000-000000000213'
  );

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000101',
  encode(sha256(convert_to('p5b-main', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000301'
)::TEXT AS p5b_main_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000102',
  encode(sha256(convert_to('p5b-main', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000302'
)::TEXT AS p5b_alias_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000103',
  encode(sha256(convert_to('p5b-group', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000303'
)::TEXT AS p5b_group_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000104',
  encode(sha256(convert_to('p5b-media', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000304'
)::TEXT AS p5b_media_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000105',
  encode(sha256(convert_to('p5b-empty', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000305'
)::TEXT AS p5b_empty_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000106',
  encode(sha256(convert_to('p5b-second', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000306'
)::TEXT AS p5b_second_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000107',
  encode(sha256(convert_to('p5b-ack', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000307'
)::TEXT AS p5b_ack_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000108',
  encode(sha256(convert_to('p5b-status', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000308'
)::TEXT AS p5b_status_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000111',
  encode(sha256(convert_to('p5b-exhausted', 'UTF8')), 'hex'), 1,
  '4b500000-0000-4000-8000-000000000309'
)::TEXT AS p5b_exhausted_enqueue
\gset
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id', '4b500000-0000-4000-8000-000000000112',
  encode(sha256(convert_to('p5b-other-session', 'UTF8')), 'hex'), 4,
  '4b500000-0000-4000-8000-000000000310'
)::TEXT AS p5b_other_session_enqueue
\gset

-- These synthetic rows model stale/bypassed historical pointers. P5B must
-- claim direction/source/envelope-invalid provider rows so the projector can
-- terminally audit them, while unrelated queue lanes remain untouched.
RESET ROLE;
RESET request.jwt.claims;

UPDATE platform_private.durable_work_items
SET
  state = 'leased',
  attempt_count = 1,
  leased_until = clock_timestamp() - INTERVAL '1 minute'
WHERE organization_id = :'org_a_id'
  AND id = (:'p5b_exhausted_enqueue'::JSONB ->> 'work_item_id')::UUID;

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
  '4b500000-0000-4000-8000-000000000550',
  :'org_a_id',
  (:'p5b_exhausted_enqueue'::JSONB ->> 'work_item_id')::UUID,
  1,
  (:'p5b_exhausted_enqueue'::JSONB ->> 'queue_message_id')::BIGINT,
  1,
  'p5b-expired-worker',
  clock_timestamp() - INTERVAL '2 minutes',
  clock_timestamp() - INTERVAL '1 minute'
);

UPDATE platform_private.durable_work_items
SET
  state = 'leased',
  attempt_count = 1,
  leased_until = clock_timestamp() + INTERVAL '5 minutes'
WHERE organization_id = :'org_a_id'
  AND id = (:'p5b_ack_enqueue'::JSONB ->> 'work_item_id')::UUID;

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
  '4b500000-0000-4000-8000-000000000551',
  :'org_a_id',
  (:'p5b_ack_enqueue'::JSONB ->> 'work_item_id')::UUID,
  1,
  (:'p5b_ack_enqueue'::JSONB ->> 'queue_message_id')::BIGINT,
  1,
  'p5b-generic-wrong-lane-worker',
  clock_timestamp(),
  clock_timestamp() + INTERVAL '5 minutes'
);

SELECT pgmq.send(
  'platform_work_v1',
  '{"v":1,"work_item_id":"4b500000-0000-4000-8000-000000000501","kind":"provider_webhook_process"}',
  0
)::TEXT AS p5b_from_me_queue_id
\gset
INSERT INTO platform_private.durable_work_items (
  id, organization_id, kind, source_webhook_event_id,
  business_key_sha256, queue_message_id, max_attempts, request_id
) VALUES (
  '4b500000-0000-4000-8000-000000000501', :'org_a_id',
  'provider_webhook_process', '4b500000-0000-4000-8000-000000000109',
  encode(sha256(convert_to('p5b-from-me', 'UTF8')), 'hex'),
  :'p5b_from_me_queue_id'::BIGINT, 4,
  '4b500000-0000-4000-8000-000000000511'
);

SELECT pgmq.send(
  'platform_work_v1',
  '{"v":1,"work_item_id":"4b500000-0000-4000-8000-000000000502","kind":"provider_webhook_process"}',
  0
)::TEXT AS p5b_api_queue_id
\gset
INSERT INTO platform_private.durable_work_items (
  id, organization_id, kind, source_webhook_event_id,
  business_key_sha256, queue_message_id, max_attempts, request_id
) VALUES (
  '4b500000-0000-4000-8000-000000000502', :'org_a_id',
  'provider_webhook_process', '4b500000-0000-4000-8000-000000000110',
  encode(sha256(convert_to('p5b-api', 'UTF8')), 'hex'),
  :'p5b_api_queue_id'::BIGINT, 4,
  '4b500000-0000-4000-8000-000000000512'
);

SELECT pgmq.send(
  'platform_work_v1',
  '{"v":1,"work_item_id":"4b500000-0000-4000-8000-000000000505","kind":"provider_webhook_process"}',
  0
)::TEXT AS p5b_metadata_mismatch_queue_id
\gset
INSERT INTO platform_private.durable_work_items (
  id, organization_id, kind, source_webhook_event_id,
  business_key_sha256, queue_message_id, max_attempts, request_id
) VALUES (
  '4b500000-0000-4000-8000-000000000505', :'org_a_id',
  'provider_webhook_process', '4b500000-0000-4000-8000-000000000113',
  encode(sha256(convert_to('p5b-metadata-mismatch', 'UTF8')), 'hex'),
  :'p5b_metadata_mismatch_queue_id'::BIGINT, 4,
  '4b500000-0000-4000-8000-000000000515'
);

SELECT pgmq.send(
  'platform_work_v1',
  '{"v":1,"work_item_id":"4b500000-0000-4000-8000-000000000503","kind":"ai_draft_generate"}',
  0
)::TEXT AS p5b_ai_queue_id
\gset
SELECT pgmq.send(
  'platform_work_v1',
  '{"v":1,"work_item_id":"4b500000-0000-4000-8000-000000000504","kind":"manual_whatsapp_send"}',
  0
)::TEXT AS p5b_manual_queue_id
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.claim_waha_webhook_work(
  :'org_b_id', 300, 'p5b-worker-org-b',
  '4b500000-0000-4000-8000-000000000601'
)::TEXT AS p5b_cross_org_claim
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-main',
  '4b500000-0000-4000-8000-000000000602'
)::TEXT AS p5b_main_claim
\gset

\set ON_ERROR_STOP off
SELECT platform.project_claimed_waha_event(
  :'org_b_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_b_membership_id',
  '4b500000-0000-4000-8000-000000000611'
);
\set p5b_cross_org_project_state :SQLSTATE

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  '4b500000-0000-4000-8000-000000000699',
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000612'
);
\set p5b_wrong_attempt_state :SQLSTATE

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  :'sales_b_membership_id',
  '4b500000-0000-4000-8000-000000000613'
);
\set p5b_invalid_sales_state :SQLSTATE

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  '4b500000-0000-4000-8000-000000000021',
  '4b500000-0000-4000-8000-000000000621'
);
\set p5b_no_org_scope_state :SQLSTATE

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  '4b500000-0000-4000-8000-000000000022',
  '4b500000-0000-4000-8000-000000000622'
);
\set p5b_missing_permission_state :SQLSTATE

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_ack_enqueue'::JSONB ->> 'work_item_id')::UUID,
  '4b500000-0000-4000-8000-000000000551',
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000623'
);
\set p5b_unrelated_lane_state :SQLSTATE

SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL,
  'p5b:projection-not-recorded',
  NULL,
  '4b500000-0000-4000-8000-000000000624'
);
\set p5b_finish_without_projection_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000614'
)::TEXT AS p5b_main_projection
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000614'
)::TEXT AS p5b_main_replay
\gset

\set ON_ERROR_STOP off
INSERT INTO platform.communication_messages (
  id,
  organization_id,
  conversation_id,
  student_case_id,
  sender_participant_id,
  direction,
  body_text,
  language,
  student_visible,
  message_identity_source,
  waha_session_name,
  waha_message_id,
  kommo_account_id,
  kommo_conversation_id,
  kommo_message_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  source_webhook_event_id,
  manual_send_authorization_id,
  created_at
)
SELECT
  '4b500000-0000-4000-8000-000000000033',
  message.organization_id,
  message.conversation_id,
  message.student_case_id,
  message.sender_participant_id,
  message.direction,
  'Synthetic unbound private identity',
  message.language,
  message.student_visible,
  'private_waha_binding',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  message.source_webhook_event_id,
  NULL,
  message.created_at + INTERVAL '1 second'
FROM platform.communication_messages AS message
WHERE message.organization_id = :'org_a_id'
  AND message.id = (
    :'p5b_main_projection'::JSONB ->> 'communication_message_id'
  )::UUID;
\set p5b_unbound_private_message_state :SQLSTATE
\set ON_ERROR_STOP on

RESET ROLE;
RESET request.jwt.claims;
SELECT updated_at::TEXT AS p5b_conversation_updated_after_first
FROM platform.communication_conversations
WHERE organization_id = :'org_a_id'
  AND id = (
    :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
  )::UUID
\gset
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL,
  (:'p5b_main_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000619'
)::TEXT AS p5b_main_finish
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_main_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_main_claim'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL,
  (:'p5b_main_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000619'
)::TEXT AS p5b_main_finish_replay
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-group',
  '4b500000-0000-4000-8000-000000000603'
)::TEXT AS p5b_group_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_group_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_group_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000615'
)::TEXT AS p5b_group_projection
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_group_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_group_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error',
  (:'p5b_group_projection'::JSONB ->> 'error_code'),
  (:'p5b_group_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000620'
)::TEXT AS p5b_group_finish
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_group_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_group_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error',
  (:'p5b_group_projection'::JSONB ->> 'error_code'),
  (:'p5b_group_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000620'
)::TEXT AS p5b_group_finish_replay
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-media',
  '4b500000-0000-4000-8000-000000000604'
)::TEXT AS p5b_media_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_media_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_media_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000616'
)::TEXT AS p5b_media_projection
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_media_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_media_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000616'
)::TEXT AS p5b_media_projection_replay
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_media_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_media_claim'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL,
  (:'p5b_media_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000624'
)::TEXT AS p5b_media_finish
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-empty',
  '4b500000-0000-4000-8000-000000000605'
)::TEXT AS p5b_empty_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_empty_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_empty_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000617'
)::TEXT AS p5b_empty_projection
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_empty_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_empty_claim'::JSONB ->> 'attempt_id')::UUID,
  'succeeded', NULL,
  (:'p5b_empty_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000625'
)::TEXT AS p5b_empty_finish
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-second',
  '4b500000-0000-4000-8000-000000000606'
)::TEXT AS p5b_second_claim
\gset

-- The configured intake member may rotate after a chat is bound. The durable
-- conversation keeps its original Sales owner; a new authorized intake member
-- must not reassign or break follow-up projection for that existing binding.
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO platform.membership_scope_assignments (
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  reason,
  request_id
)
VALUES (
  :'org_a_id',
  :'p5b_rotated_intake_sales_membership_id',
  :'p5b_org_scope_id',
  :'p5b_org_scope_version'::BIGINT,
  1,
  TRUE,
  'service',
  'P5B rotated intake authorization regression fixture',
  '4b500000-0000-4000-8000-000000000026'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_second_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_second_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_rotated_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000618'
)::TEXT AS p5b_second_projection
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-exhausted',
  '4b500000-0000-4000-8000-000000000607'
)::TEXT AS p5b_exhausted_claim
\gset
SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-exhausted',
  '4b500000-0000-4000-8000-000000000607'
)::TEXT AS p5b_exhausted_claim_replay
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-from-me',
  '4b500000-0000-4000-8000-000000000640'
)::TEXT AS p5b_from_me_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_from_me_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_from_me_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000641'
)::TEXT AS p5b_from_me_projection
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_from_me_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_from_me_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error',
  (:'p5b_from_me_projection'::JSONB ->> 'error_code'),
  (:'p5b_from_me_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000642'
)::TEXT AS p5b_from_me_finish
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-api',
  '4b500000-0000-4000-8000-000000000643'
)::TEXT AS p5b_api_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_api_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_api_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000644'
)::TEXT AS p5b_api_projection
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_api_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_api_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error',
  (:'p5b_api_projection'::JSONB ->> 'error_code'),
  (:'p5b_api_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000645'
)::TEXT AS p5b_api_finish
\gset

SELECT platform.claim_waha_webhook_work(
  :'org_a_id', 300, 'p5b-worker-metadata-mismatch',
  '4b500000-0000-4000-8000-000000000646'
)::TEXT AS p5b_metadata_mismatch_claim
\gset
SELECT platform.project_claimed_waha_event(
  :'org_a_id',
  (:'p5b_metadata_mismatch_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_metadata_mismatch_claim'::JSONB ->> 'attempt_id')::UUID,
  :'p5b_intake_sales_membership_id',
  '4b500000-0000-4000-8000-000000000647'
)::TEXT AS p5b_metadata_mismatch_projection
\gset
SELECT platform.finish_waha_webhook_work(
  :'org_a_id',
  (:'p5b_metadata_mismatch_claim'::JSONB ->> 'work_item_id')::UUID,
  (:'p5b_metadata_mismatch_claim'::JSONB ->> 'attempt_id')::UUID,
  'terminal_error',
  (:'p5b_metadata_mismatch_projection'::JSONB ->> 'error_code'),
  (:'p5b_metadata_mismatch_projection'::JSONB ->> 'evidence_ref'),
  NULL,
  '4b500000-0000-4000-8000-000000000648'
)::TEXT AS p5b_metadata_mismatch_finish
\gset

RESET ROLE;
RESET request.jwt.claims;

\set ON_ERROR_STOP off
UPDATE platform.communication_conversations
SET sales_authority_source = 'provider_linked'
WHERE organization_id = :'org_a_id'
  AND id = (
    :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
  )::UUID;
\set p5b_authority_flip_state :SQLSTATE

UPDATE platform.communication_conversations
SET updated_at = updated_at + INTERVAL '1 second'
WHERE organization_id = :'org_a_id'
  AND id = (
    :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
  )::UUID;
\set p5b_direct_activity_touch_state :SQLSTATE

INSERT INTO platform.communication_conversations (
  id,
  organization_id,
  student_case_id,
  responsible_sales_membership_id,
  sales_authority_source,
  current_curator_membership_id,
  queue,
  status,
  subject,
  waha_session_name,
  kommo_account_id,
  kommo_conversation_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  current_scope_id,
  current_scope_version,
  created_from_webhook_event_id
)
SELECT
  '4b500000-0000-4000-8000-000000000031',
  conversation.organization_id,
  NULL,
  conversation.responsible_sales_membership_id,
  'provider_linked',
  NULL,
  'sales',
  'open',
  'Invalid provider-linked conversation',
  conversation.waha_session_name,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  conversation.current_scope_id,
  conversation.current_scope_version,
  conversation.created_from_webhook_event_id
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'org_a_id'
  AND conversation.id = (
    :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
  )::UUID;
\set p5b_provider_without_identity_state :SQLSTATE

INSERT INTO platform.communication_conversations (
  id,
  organization_id,
  student_case_id,
  responsible_sales_membership_id,
  sales_authority_source,
  current_curator_membership_id,
  queue,
  status,
  subject,
  waha_session_name,
  kommo_account_id,
  kommo_conversation_id,
  amocrm_account_id,
  amocrm_lead_id,
  amocrm_contact_id,
  current_scope_id,
  current_scope_version,
  created_from_webhook_event_id
)
SELECT
  '4b500000-0000-4000-8000-000000000032',
  conversation.organization_id,
  NULL,
  conversation.responsible_sales_membership_id,
  'platform_intake',
  NULL,
  'sales',
  'open',
  'Invalid intake provider identity',
  conversation.waha_session_name,
  9876543210001,
  NULL,
  9876543210002,
  9876543210003,
  9876543210004,
  conversation.current_scope_id,
  conversation.current_scope_version,
  conversation.created_from_webhook_event_id
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'org_a_id'
  AND conversation.id = (
    :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
  )::UUID;
\set p5b_intake_with_identity_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  (:'p5b_cross_org_claim'::JSONB ->> 'claimed')::BOOLEAN = FALSE
  AND (:'p5b_main_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND :'p5b_cross_org_project_state' <> '00000'
  AND :'p5b_wrong_attempt_state' <> '00000'
  AND :'p5b_invalid_sales_state' <> '00000'
  AND :'p5b_no_org_scope_state' <> '00000'
  AND :'p5b_missing_permission_state' <> '00000'
  AND :'p5b_unrelated_lane_state' <> '00000'
  AND :'p5b_finish_without_projection_state' = '42501'
  AND :'p5b_authority_flip_state' <> '00000'
  AND :'p5b_direct_activity_touch_state' = '55000'
  AND :'p5b_provider_without_identity_state' <> '00000'
  AND :'p5b_intake_with_identity_state' <> '00000',
  'tenant, attempt, scope, permission, provenance, or Sales validation did not fail closed'
);

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_work_projection_effects
    WHERE organization_id = :'org_a_id'
      AND work_item_id =
        (:'p5b_ack_enqueue'::JSONB ->> 'work_item_id')::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.waha_work_projection_requests
    WHERE organization_id = :'org_a_id'
      AND work_item_id =
        (:'p5b_ack_enqueue'::JSONB ->> 'work_item_id')::UUID
  ),
  'unrelated WAHA lane created a P5B projection effect or replay receipt'
);

SELECT pg_temp.assert_true(
  (:'p5b_alias_enqueue'::JSONB ->> 'deduplicated')::BOOLEAN
  AND (:'p5b_main_enqueue'::JSONB ->> 'work_item_id') =
    (:'p5b_alias_enqueue'::JSONB ->> 'work_item_id')
  AND :'p5b_main_projection' = :'p5b_main_replay'
  AND (:'p5b_main_projection'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'p5b_main_projection'::JSONB ->> 'error_code') IS NULL
  AND :'p5b_main_projection' NOT LIKE '%14155550101%'
  AND :'p5b_main_projection' NOT LIKE '%Synthetic inbound main%'
  AND :'p5b_unbound_private_message_state' <> '00000',
  'message alias replay duplicated effects or leaked customer content'
);

SELECT pg_temp.assert_true(
  :'p5b_main_finish' = :'p5b_main_finish_replay'
  AND (:'p5b_main_finish'::JSONB ->> 'organization_id') = :'org_a_id'
  AND (:'p5b_main_finish'::JSONB ->> 'state') = 'succeeded'
  AND (:'p5b_main_finish'::JSONB ->> 'outcome') = 'succeeded'
  AND :'p5b_group_finish' = :'p5b_group_finish_replay'
  AND (:'p5b_group_finish'::JSONB ->> 'organization_id') = :'org_a_id'
  AND (:'p5b_group_finish'::JSONB ->> 'state') = 'dead_lettered'
  AND (:'p5b_group_finish'::JSONB ->> 'outcome') = 'terminal_error',
  'org-bound success or terminal finish/replay envelope failed'
);

SELECT pg_temp.assert_true(
  :'p5b_exhausted_claim' = :'p5b_exhausted_claim_replay'
  AND (:'p5b_exhausted_claim'::JSONB ->> 'claimed')::BOOLEAN = FALSE
  AND (:'p5b_exhausted_claim'::JSONB ->> 'queue') =
    'platform_work_v1'
  AND (:'p5b_exhausted_claim'::JSONB ->>
    'retry_budget_exhausted')::BOOLEAN
  AND (:'p5b_exhausted_claim'::JSONB ->> 'state') = 'dead_lettered'
  AND (:'p5b_exhausted_claim'::JSONB ->> 'reason_code') =
    'retry_budget_exhausted'
  AND (
    SELECT state = 'dead_lettered'
    FROM platform_private.durable_work_items
    WHERE organization_id = :'org_a_id'
      AND id =
        (:'p5b_exhausted_enqueue'::JSONB ->> 'work_item_id')::UUID
  )
  AND (
    SELECT
      finished_at IS NOT NULL
      AND outcome = 'lease_expired'
      AND error_code = 'lease_expired'
    FROM platform_private.durable_work_attempts
    WHERE organization_id = :'org_a_id'
      AND id = '4b500000-0000-4000-8000-000000000550'
  ),
  'retry-budget exhaustion response or idempotent replay contract failed'
);

SELECT pg_temp.assert_true(
  (:'p5b_from_me_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'p5b_from_me_projection'::JSONB ->> 'disposition') =
    'terminal_error'
  AND (:'p5b_from_me_projection'::JSONB ->> 'error_code') =
    'waha_inbound_from_me'
  AND (:'p5b_from_me_finish'::JSONB ->> 'state') = 'dead_lettered'
  AND (:'p5b_api_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'p5b_api_projection'::JSONB ->> 'disposition') =
    'terminal_error'
  AND (:'p5b_api_projection'::JSONB ->> 'error_code') =
    'waha_inbound_api_source'
  AND (:'p5b_api_finish'::JSONB ->> 'state') = 'dead_lettered'
  AND (:'p5b_metadata_mismatch_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'p5b_metadata_mismatch_projection'::JSONB ->> 'disposition') =
    'terminal_error'
  AND (:'p5b_metadata_mismatch_projection'::JSONB ->> 'error_code') =
    'waha_event_metadata_mismatch'
  AND (:'p5b_metadata_mismatch_finish'::JSONB ->> 'state') =
    'dead_lettered'
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'org_a_id'
      AND message.source_webhook_event_id IN (
        '4b500000-0000-4000-8000-000000000109',
        '4b500000-0000-4000-8000-000000000110',
        '4b500000-0000-4000-8000-000000000113'
      )
  ),
  'malformed verified WAHA work did not terminate without public projection'
);

SELECT pg_temp.assert_true(
  (:'p5b_group_projection'::JSONB ->> 'disposition') = 'terminal_error'
  AND (:'p5b_group_projection'::JSONB ->> 'error_code') =
    'waha_inbound_unsupported_chat'
  AND :'p5b_media_projection' = :'p5b_media_projection_replay'
  AND (:'p5b_media_projection'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'p5b_media_projection'::JSONB ->> 'error_code') IS NULL
  AND (:'p5b_media_projection'::JSONB ->>
    'human_review_required')::BOOLEAN
  AND (:'p5b_media_projection'::JSONB ->> 'handoff_event_id') IS NOT NULL
  AND (:'p5b_media_finish'::JSONB ->> 'state') = 'succeeded'
  AND (:'p5b_empty_projection'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'p5b_empty_projection'::JSONB ->> 'error_code') IS NULL
  AND (:'p5b_empty_projection'::JSONB ->>
    'human_review_required')::BOOLEAN
  AND (:'p5b_empty_projection'::JSONB ->> 'handoff_event_id') IS NOT NULL
  AND (:'p5b_empty_finish'::JSONB ->> 'state') = 'succeeded'
  AND (:'p5b_second_projection'::JSONB ->> 'disposition') = 'succeeded',
  'group, media-only, empty, or direct-message outcomes are wrong'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 2
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'org_a_id'
      AND message.id IN (
        (:'p5b_media_projection'::JSONB ->>
          'communication_message_id')::UUID,
        (:'p5b_empty_projection'::JSONB ->>
          'communication_message_id')::UUID
      )
      AND message.body_text =
        '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.'
      AND message.language = 'undetermined'
      AND NOT message.student_visible
      AND message.message_identity_source = 'private_waha_binding'
      AND message.waha_session_name IS NULL
      AND message.waha_message_id IS NULL
      AND message.kommo_account_id IS NULL
      AND message.amocrm_account_id IS NULL
  )
  AND (
    SELECT count(*) = 2
    FROM platform_private.waha_message_bindings AS binding
    WHERE binding.organization_id = :'org_a_id'
      AND binding.source_webhook_event_id IN (
        '4b500000-0000-4000-8000-000000000104',
        '4b500000-0000-4000-8000-000000000105'
      )
      AND binding.communication_message_id IN (
        (:'p5b_media_projection'::JSONB ->>
          'communication_message_id')::UUID,
        (:'p5b_empty_projection'::JSONB ->>
          'communication_message_id')::UUID
      )
  )
  AND (
    SELECT count(*) = 2
    FROM platform.conversation_handoff_events AS handoff
    WHERE handoff.organization_id = :'org_a_id'
      AND handoff.source_webhook_event_id IN (
        '4b500000-0000-4000-8000-000000000104',
        '4b500000-0000-4000-8000-000000000105'
      )
      AND handoff.id IN (
        (:'p5b_media_projection'::JSONB ->> 'handoff_event_id')::UUID,
        (:'p5b_empty_projection'::JSONB ->> 'handoff_event_id')::UUID
      )
      AND handoff.request_id = handoff.source_webhook_event_id
      AND handoff.previous_queue IS NULL
      AND handoff.previous_owner_membership_id IS NULL
      AND handoff.new_queue = 'sales'
      AND handoff.new_owner_membership_id =
        :'p5b_intake_sales_membership_id'
      AND handoff.reason =
        'Inbound WAHA content without text requires staff review'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.communication_conversations AS conversation
    JOIN platform.conversation_participants AS participant
      ON participant.organization_id = conversation.organization_id
     AND participant.conversation_id = conversation.id
     AND participant.participant_kind = 'sales'
    WHERE conversation.organization_id = :'org_a_id'
      AND conversation.id = (
        :'p5b_second_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
      AND conversation.responsible_sales_membership_id =
        :'p5b_intake_sales_membership_id'
      AND participant.membership_id = :'p5b_intake_sales_membership_id'
      AND participant.membership_id <>
        :'p5b_rotated_intake_sales_membership_id'
  )
  AND (
    SELECT count(*) = 2
    FROM platform_private.durable_work_items AS item
    WHERE item.organization_id = :'org_a_id'
      AND item.id IN (
        (:'p5b_media_claim'::JSONB ->> 'work_item_id')::UUID,
        (:'p5b_empty_claim'::JSONB ->> 'work_item_id')::UUID
      )
      AND item.state = 'succeeded'
  ),
  'bodyless WAHA projection did not preserve private identity, operator marker, handoff, and successful finish'
);

SELECT pg_temp.assert_true(
  (
    SELECT count(*) = 1
    FROM platform_private.waha_direct_chat_bindings
    WHERE organization_id = :'org_a_id'
      AND waha_session_name = 'evo-inbox'
      AND normalized_chat_id = '14155550101@c.us'
  )
  AND (
    SELECT count(*) = 1
    FROM platform.communication_conversations
    WHERE id = (
      :'p5b_main_projection'::JSONB ->>
        'communication_conversation_id'
    )::UUID
      AND organization_id = :'org_a_id'
      AND queue = 'sales'
      AND sales_authority_source = 'platform_intake'
      AND student_case_id IS NULL
      AND current_curator_membership_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
      AND subject = 'WhatsApp ••••0101'
  )
  AND (
    SELECT count(*) = 2
    FROM platform.conversation_participants
    WHERE organization_id = :'org_a_id'
      AND conversation_id = (
        :'p5b_main_projection'::JSONB ->>
        'communication_conversation_id'
      )::UUID
  )
  AND (
    SELECT count(*) = 1
    FROM platform.conversation_participants AS participant
    WHERE participant.organization_id = :'org_a_id'
      AND participant.conversation_id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
      AND participant.participant_kind = 'customer'
      AND participant.external_subject_ref =
        'waha-participant:' || participant.id::TEXT
      AND participant.external_subject_ref NOT LIKE '%14155550101%'
      AND participant.external_subject_ref NOT LIKE '%@c.us%'
      AND participant.external_subject_ref <>
        'waha-chat-sha256:' || encode(
          sha256(
            convert_to(
              :'org_a_id' || ':evo-inbox:14155550101@c.us',
              'UTF8'
            )
          ),
          'hex'
        )
  )
  AND (
    SELECT count(*) = 2
    FROM platform.communication_messages
    WHERE organization_id = :'org_a_id'
      AND conversation_id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
      AND direction = 'inbound'
      AND message_identity_source = 'private_waha_binding'
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND amocrm_account_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.conversation_handoff_events
    WHERE organization_id = :'org_a_id'
      AND conversation_id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = message.organization_id
     AND source_event.id = message.source_webhook_event_id
    WHERE message.organization_id = :'org_a_id'
      AND message.conversation_id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
      AND message.created_at <> source_event.provider_occurred_at
  )
  AND (
    SELECT array_agg(binding.raw_message_id ORDER BY message.created_at)
      = ARRAY[
        'true_14155550101@c.us_AAA',
        'p5b-message-second'
      ]::TEXT[]
    FROM platform.communication_messages AS message
    JOIN platform_private.waha_message_bindings AS binding
      ON binding.organization_id = message.organization_id
     AND binding.communication_message_id = message.id
    WHERE message.organization_id = :'org_a_id'
      AND message.conversation_id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'org_a_id'
      AND (
        COALESCE(message.waha_message_id, '') LIKE '%14155550101%'
        OR COALESCE(message.body_text, '') LIKE '%true_14155550101@c.us_AAA%'
      )
  )
  AND (
    SELECT conversation.updated_at =
      :'p5b_conversation_updated_after_first'::TIMESTAMPTZ
    FROM platform.communication_conversations AS conversation
    WHERE conversation.organization_id = :'org_a_id'
      AND conversation.id = (
        :'p5b_main_projection'::JSONB ->>
          'communication_conversation_id'
      )::UUID
  )
  AND (
    SELECT profile.access_version =
      :'p5b_intake_access_version_before'::BIGINT
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    WHERE membership.organization_id = :'org_a_id'
      AND membership.id = :'p5b_intake_sales_membership_id'
  ),
  'WAHA-only conversation, participants, chronology, queue freshness, or no-handoff shape failed'
);

SELECT pg_temp.assert_true(
  (
    SELECT read_ct = 0
    FROM pgmq.q_platform_work_v1
    WHERE msg_id =
      (:'p5b_ack_enqueue'::JSONB ->> 'queue_message_id')::BIGINT
  )
  AND (
    SELECT read_ct = 0
    FROM pgmq.q_platform_work_v1
    WHERE msg_id =
      (:'p5b_status_enqueue'::JSONB ->> 'queue_message_id')::BIGINT
  )
  AND (
    SELECT read_ct = 0
    FROM pgmq.q_platform_work_v1
    WHERE msg_id = :'p5b_ai_queue_id'::BIGINT
  )
  AND (
    SELECT read_ct = 0
    FROM pgmq.q_platform_work_v1
    WHERE msg_id = :'p5b_manual_queue_id'::BIGINT
  )
  AND (
    SELECT read_ct = 0
    FROM pgmq.q_platform_work_v1
    WHERE msg_id =
      (:'p5b_other_session_enqueue'::JSONB ->> 'queue_message_id')::BIGINT
  ),
  'claim touched ACK, status, wrong-session, AI, or manual queue rows'
);

SELECT
  profile.access_version AS p5b_intake_sales_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset
SELECT
  profile.access_version AS p5b_sales_b_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000007'
\gset
SELECT
  profile.access_version AS p5b_same_org_sales_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT jsonb_build_object(
  'sub', '4b500000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p5b_intake_sales_access_version'::BIGINT
)::TEXT AS p5b_intake_sales_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000007',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p5b_sales_b_access_version'::BIGINT
)::TEXT AS p5b_sales_b_claims
\gset
SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'p5b_same_org_sales_access_version'::BIGINT
)::TEXT AS p5b_same_org_sales_claims
\gset

SET request.jwt.claims TO :'p5b_intake_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p5b_owner_conversation_count
FROM platform.communication_conversations
WHERE id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
SELECT count(*)::TEXT AS p5b_owner_message_count
FROM platform.communication_messages
WHERE conversation_id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p5b_same_org_sales_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p5b_same_org_non_owner_conversation_count
FROM platform.communication_conversations
WHERE id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
SELECT count(*)::TEXT AS p5b_same_org_non_owner_message_count
FROM platform.communication_messages
WHERE conversation_id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
RESET ROLE;
RESET request.jwt.claims;

SET request.jwt.claims TO :'p5b_sales_b_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS p5b_cross_org_conversation_count
FROM platform.communication_conversations
WHERE id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
SELECT count(*)::TEXT AS p5b_cross_org_message_count
FROM platform.communication_messages
WHERE conversation_id = (
  :'p5b_main_projection'::JSONB ->> 'communication_conversation_id'
)::UUID
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.assert_true(
  :'p5b_owner_conversation_count'::INTEGER = 1
  AND :'p5b_owner_message_count'::INTEGER = 2
  AND :'p5b_same_org_non_owner_conversation_count'::INTEGER = 0
  AND :'p5b_same_org_non_owner_message_count'::INTEGER = 0
  AND :'p5b_cross_org_conversation_count'::INTEGER = 0
  AND :'p5b_cross_org_message_count'::INTEGER = 0,
  'staff conversation/message visibility is not tenant and assignment scoped'
);

SELECT 'platform WAHA inbound work projection checks passed' AS result;
