\set ON_ERROR_STOP on

-- Migration 060 intentionally accepted any numeric direct-chat identifier.
-- Leave one such historical, out-of-range row in the disposable database so
-- migration 085 proves it upgrades compatible data without rewriting or
-- aborting on preserved private evidence.
BEGIN;

SELECT
  membership.organization_id AS u3_pre_org,
  membership.id AS u3_pre_sales_membership
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
LIMIT 1
\gset

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id, received_at
)
VALUES (
  '85300000-0000-4000-8000-000000000001',
  :'u3_pre_org',
  'waha',
  'waha:evo-inbox',
  NULL,
  NULL,
  'synthetic-u3-pre085-short-chat',
  'evo-inbox',
  'synthetic-u3-pre085-short-chat',
  'message',
  '2026-08-24T06:00:00Z',
  'verified',
  '{"event":"message","session":"evo-inbox","payload":{"id":"synthetic-u3-pre085-short-chat","from":"123@c.us","chatId":"123@c.us","fromMe":false,"source":"app","body":"Historical unsupported direct chat"}}',
  '{"hmac_verified":true}',
  'synthetic:u3:pre085:short-chat',
  repeat('85', 32),
  '85300000-0000-4000-8000-000000000002',
  '2026-08-24T06:00:01Z'
);

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version, is_active
)
VALUES (
  '85300000-0000-4000-8000-000000000003',
  :'u3_pre_org',
  'conversation',
  '85300000-0000-4000-8000-000000000004',
  1,
  TRUE
);

INSERT INTO platform.communication_conversations (
  id, organization_id, student_case_id,
  responsible_sales_membership_id, sales_authority_source,
  current_curator_membership_id, queue, status, subject,
  waha_session_name, kommo_account_id, kommo_conversation_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  current_scope_id, current_scope_version, created_from_webhook_event_id
)
VALUES (
  '85300000-0000-4000-8000-000000000004',
  :'u3_pre_org',
  NULL,
  :'u3_pre_sales_membership',
  'platform_intake',
  NULL,
  'sales',
  'open',
  'WhatsApp ••••0123',
  'evo-inbox',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  '85300000-0000-4000-8000-000000000003',
  1,
  '85300000-0000-4000-8000-000000000001'
);

INSERT INTO platform_private.waha_direct_chat_bindings (
  id, organization_id, waha_session_name, normalized_chat_id,
  conversation_id, source_webhook_event_id
)
VALUES (
  '85300000-0000-4000-8000-000000000005',
  :'u3_pre_org',
  'evo-inbox',
  '123@c.us',
  '85300000-0000-4000-8000-000000000004',
  '85300000-0000-4000-8000-000000000001'
);

COMMIT;

SELECT 'platform migration 085 compatibility fixture prepared' AS result;
