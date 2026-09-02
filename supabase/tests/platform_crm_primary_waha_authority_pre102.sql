\set ON_ERROR_STOP on

-- Seed immutable legacy evidence at the migration-101 boundary. Migration 102
-- must keep these rows byte-for-byte queryable while removing their ability to
-- participate in current health or new work.
BEGIN;

INSERT INTO platform.organizations (id, name)
VALUES (
  'a1020000-0000-4000-8000-000000000001',
  'Migration 102 historical WAHA evidence'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  'a1020000-0000-4000-8000-000000000002',
  'migration-102-admin@example.invalid',
  '{}'::JSONB
);

INSERT INTO platform.profiles (
  id,
  auth_user_id,
  display_name
)
VALUES (
  'a1020000-0000-4000-8000-000000000003',
  'a1020000-0000-4000-8000-000000000002',
  'Migration 102 Admin'
);

INSERT INTO platform.organization_memberships (
  id,
  organization_id,
  profile_id,
  status,
  "current_role",
  current_bundle_id
)
VALUES (
  'a1020000-0000-4000-8000-000000000004',
  'a1020000-0000-4000-8000-000000000001',
  'a1020000-0000-4000-8000-000000000003',
  'active',
  'admin',
  '00000000-0000-4000-8000-000000001301'
);

INSERT INTO platform.record_scopes (
  id,
  organization_id,
  scope_kind,
  scope_key,
  scope_version,
  is_active
)
VALUES (
  'a1020000-0000-4000-8000-000000000005',
  'a1020000-0000-4000-8000-000000000001',
  'organization',
  'a1020000-0000-4000-8000-000000000001',
  1,
  TRUE
);

INSERT INTO platform.membership_scope_assignments (
  id,
  organization_id,
  membership_id,
  scope_id,
  scope_version,
  assignment_version,
  granted,
  actor_kind,
  actor_profile_id,
  reason,
  request_id
)
VALUES (
  'a1020000-0000-4000-8000-000000000006',
  'a1020000-0000-4000-8000-000000000001',
  'a1020000-0000-4000-8000-000000000004',
  'a1020000-0000-4000-8000-000000000005',
  1,
  1,
  TRUE,
  'system',
  NULL,
  'Migration 102 historical evidence fixture',
  'a1020000-0000-4000-8000-000000000007'
);

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
  received_at,
  request_id
)
VALUES (
  'a1020000-0000-4000-8000-000000000101',
  'a1020000-0000-4000-8000-000000000001',
  'waha',
  'waha:evo-inbox',
  NULL,
  NULL,
  'migration-102-historical-session-status',
  'evo-inbox',
  'migration-102-historical-session-status',
  'session.status',
  '2026-08-30 10:00:00+06',
  'verified',
  '{"event":"session.status","session":"evo-inbox","payload":{"name":"evo-inbox","status":"SCAN_QR_CODE"}}',
  '{"hmac_verified":true}',
  'synthetic:migration-102:historical-session',
  repeat('a1', 32),
  '2026-08-30 10:00:01+06',
  'a1020000-0000-4000-8000-000000000111'
);

INSERT INTO platform_private.waha_session_observations (
  id,
  organization_id,
  source_webhook_event_id,
  waha_session_name,
  status,
  observed_at,
  request_id,
  created_at
)
VALUES (
  'a1020000-0000-4000-8000-000000000102',
  'a1020000-0000-4000-8000-000000000001',
  'a1020000-0000-4000-8000-000000000101',
  'evo-inbox',
  'SCAN_QR_CODE',
  '2026-08-30 10:00:00+06',
  'a1020000-0000-4000-8000-000000000112',
  '2026-08-30 10:00:02+06'
);

INSERT INTO platform.waha_session_health (
  organization_id,
  waha_session_name,
  status,
  observed_at
)
VALUES (
  'a1020000-0000-4000-8000-000000000001',
  'evo-inbox',
  'SCAN_QR_CODE',
  '2026-08-30 10:00:00+06'
);

COMMIT;
