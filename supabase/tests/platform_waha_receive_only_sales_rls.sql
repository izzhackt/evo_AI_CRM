\set ON_ERROR_STOP on

-- U3 acceptance uses only synthetic rows in the disposable authorization
-- database. It never contacts WAHA, WhatsApp, amoCRM, managed Supabase, or a
-- production service.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.u3_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'U3 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.u3_assert(BOOLEAN, TEXT)
  TO authenticated;

-- Resolve current identities from earlier persistent synthetic suites. P5B
-- exercised the real durable WAHA projection before migration 085; U3 must
-- have backfilled its supported direct chat to canonical U2 identity.
SELECT
  membership.organization_id AS u3_org_a,
  membership.id AS u3_intake_sales_membership,
  profile.access_version::TEXT AS u3_intake_access_version,
  membership.current_bundle_id AS u3_sales_bundle,
  bundle.version::TEXT AS u3_sales_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '4b500000-0000-4000-8000-000000000003'
\gset

SELECT
  membership.organization_id AS u3_org_b
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.id AS u3_admin_membership,
  profile.access_version::TEXT AS u3_admin_access_version,
  membership.current_bundle_id AS u3_admin_claim_bundle,
  bundle.version::TEXT AS u3_admin_claim_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
  AND membership.organization_id = :'u3_org_a'
\gset

SELECT
  membership.id AS u3_admin_b_membership,
  profile.access_version::TEXT AS u3_admin_b_access_version,
  membership.current_bundle_id AS u3_admin_b_claim_bundle,
  bundle.version::TEXT AS u3_admin_b_claim_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
  AND membership.organization_id = :'u3_org_b'
\gset

SELECT
  membership.id AS u3_other_sales_membership,
  profile.access_version::TEXT AS u3_other_sales_access_version,
  membership.current_bundle_id AS u3_other_sales_bundle,
  bundle.version::TEXT AS u3_other_sales_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
  AND membership.organization_id = :'u3_org_a'
\gset

SELECT
  membership.id AS u3_curator_membership,
  profile.access_version::TEXT AS u3_curator_access_version,
  membership.current_bundle_id AS u3_curator_bundle,
  bundle.version::TEXT AS u3_curator_bundle_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions AS bundle
  ON bundle.id = membership.current_bundle_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
  AND membership.organization_id = :'u3_org_a'
\gset

SELECT
  binding.conversation_id AS u3_conversation_id,
  conversation.canonical_client_id AS u3_client_id,
  conversation.canonical_lead_id AS u3_lead_id,
  conversation.responsible_sales_membership_id AS u3_conversation_owner
FROM platform_private.waha_direct_chat_bindings AS binding
JOIN platform.communication_conversations AS conversation
  ON conversation.organization_id = binding.organization_id
 AND conversation.id = binding.conversation_id
WHERE binding.organization_id = :'u3_org_a'
  AND binding.waha_session_name = 'evo-inbox'
  AND binding.normalized_chat_id = '14155550101@c.us'
\gset

SELECT binding.conversation_id AS u3_media_conversation_id
FROM platform_private.waha_direct_chat_bindings AS binding
WHERE binding.organization_id = :'u3_org_a'
  AND binding.waha_session_name = 'evo-inbox'
  AND binding.normalized_chat_id = '14155550102@c.us'
\gset

SELECT conversation.id AS u3_curator_conversation_id
FROM platform.communication_conversations AS conversation
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = conversation.organization_id
 AND membership.id = conversation.current_curator_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE conversation.organization_id = :'u3_org_a'
  AND conversation.queue = 'curator'
  AND profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
ORDER BY conversation.created_at, conversation.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u3_admin_access_version'::BIGINT,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', :'u3_admin_membership',
  'platform_bundle_id', :'u3_admin_claim_bundle',
  'platform_bundle_version', :'u3_admin_claim_bundle_version'::BIGINT
)::TEXT AS u3_admin_claims
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'u3_admin_b_access_version'::BIGINT,
  'platform_organization_id', :'u3_org_b',
  'platform_membership_id', :'u3_admin_b_membership',
  'platform_bundle_id', :'u3_admin_b_claim_bundle',
  'platform_bundle_version', :'u3_admin_b_claim_bundle_version'::BIGINT
)::TEXT AS u3_admin_b_claims
\gset

SELECT jsonb_build_object(
  'sub', '4b500000-0000-4000-8000-000000000003',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'u3_intake_access_version'::BIGINT,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', :'u3_intake_sales_membership',
  'platform_bundle_id', :'u3_sales_bundle',
  'platform_bundle_version', :'u3_sales_bundle_version'::BIGINT
)::TEXT AS u3_intake_claims
\gset

SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'u3_other_sales_access_version'::BIGINT,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', :'u3_other_sales_membership',
  'platform_bundle_id', :'u3_other_sales_bundle',
  'platform_bundle_version', :'u3_other_sales_bundle_version'::BIGINT
)::TEXT AS u3_other_sales_claims
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'u3_curator_access_version'::BIGINT,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', :'u3_curator_membership',
  'platform_bundle_id', :'u3_curator_bundle',
  'platform_bundle_version', :'u3_curator_bundle_version'::BIGINT
)::TEXT AS u3_curator_claims
\gset

SELECT pg_temp.u3_assert(
  :'u3_client_id'::UUID IS NOT NULL
  AND :'u3_lead_id'::UUID IS NOT NULL
  AND :'u3_conversation_owner'::UUID = :'u3_intake_sales_membership'::UUID
  AND EXISTS (
    SELECT 1 FROM platform.clients AS client
    WHERE client.organization_id = :'u3_org_a'
      AND client.id = :'u3_client_id'
      AND client.display_name = 'WhatsApp ••••0101'
      AND client.phone = '+14155550101'
  )
  AND EXISTS (
    SELECT 1 FROM platform.leads AS lead
    WHERE lead.organization_id = :'u3_org_a'
      AND lead.id = :'u3_lead_id'
      AND lead.client_id = :'u3_client_id'
      AND lead.current_owner_membership_id = :'u3_intake_sales_membership'
      AND lead.stage_key = 'new_inbound'
      AND lead.source_key = 'whatsapp'
  )
  AND EXISTS (
    SELECT 1 FROM platform.external_identifiers AS external
    WHERE external.organization_id = :'u3_org_a'
      AND external.source_system = 'waha'
      AND external.external_object_type = 'direct_chat'
      AND external.external_identifier = 'evo-inbox:14155550101@c.us'
      AND external.client_id = :'u3_client_id'
  )
  AND EXISTS (
    SELECT 1 FROM platform.external_identifiers AS external
    WHERE external.organization_id = :'u3_org_a'
      AND external.source_system = 'waha'
      AND external.external_object_type = 'sales_intake'
      AND external.external_identifier = 'evo-inbox:14155550101@c.us'
      AND external.lead_id = :'u3_lead_id'
  ),
  'verified direct inbound did not acquire exact canonical identity'
);

SELECT pg_temp.u3_assert(
  (
    SELECT count(*) = 1
    FROM platform_private.waha_direct_chat_bindings AS binding
    WHERE binding.organization_id = :'u3_org_a'
      AND binding.waha_session_name = 'evo-inbox'
      AND binding.normalized_chat_id = '14155550101@c.us'
  )
  AND (
    SELECT count(*) = 2
    FROM platform.communication_messages AS message
    WHERE message.organization_id = :'u3_org_a'
      AND message.conversation_id = :'u3_conversation_id'
      AND message.direction = 'inbound'
      AND message.message_identity_source = 'private_waha_binding'
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.external_identifiers AS external
    WHERE external.organization_id = :'u3_org_a'
      AND external.source_system = 'waha'
      AND external.external_identifier IN (
        'evo-inbox:14155550104@c.us',
        'evo-inbox:14155550105@c.us'
      )
  ),
  'alias retry duplicated work or outgoing/API evidence became Sales intake'
);

-- Phone-only similarity is weak. Exact WAHA identity gets a distinct client
-- plus review evidence instead of a silent merge.
SELECT platform_private.create_or_link_client(
  :'u3_org_a', 'Possible existing person', NULL, '+14155550155',
  'legacy', 'contact', 'u3-phone-only-existing', 'legacy_observation',
  '2026-08-24T06:00:00Z', NULL, 'synthetic:u3:phone-existing'
) AS u3_possible_client_id
\gset

SELECT platform_private.create_or_link_client(
  :'u3_org_a', 'WhatsApp ••••0155', NULL, '+14155550155',
  'waha', 'direct_chat', 'evo-inbox:14155550155@c.us',
  'webhook_verified', '2026-08-24T06:01:00Z', NULL,
  'synthetic:u3:phone-waha'
) AS u3_exact_waha_client_id
\gset

SELECT pg_temp.u3_assert(
  :'u3_possible_client_id'::UUID <> :'u3_exact_waha_client_id'::UUID
  AND EXISTS (
    SELECT 1
    FROM platform_private.client_duplicate_candidates AS candidate
    WHERE candidate.organization_id = :'u3_org_a'
      AND candidate.status = 'open'
      AND :'u3_possible_client_id'::UUID IN (
        candidate.left_client_id, candidate.right_client_id
      )
      AND :'u3_exact_waha_client_id'::UUID IN (
        candidate.left_client_id, candidate.right_client_id
      )
  ),
  'phone-only similarity silently merged clients or lost review evidence'
);

-- Seed 1,005 successful synthetic receive rows linked to the same canonical
-- conversation. Every timestamp is unique so the stable keyset can be checked
-- across eleven pages, beyond Supabase's default 1,000-row ceiling.
CREATE TEMP TABLE u3_bulk (
  sequence_number INTEGER PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  work_id UUID NOT NULL UNIQUE,
  message_id UUID NOT NULL UNIQUE,
  effect_id UUID NOT NULL UNIQUE,
  event_request_id UUID NOT NULL UNIQUE,
  work_request_id UUID NOT NULL UNIQUE,
  effect_request_id UUID NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO u3_bulk
SELECT
  sequence_number,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
FROM generate_series(1, 1005) AS fixture(sequence_number);

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id, received_at
)
SELECT
  fixture.event_id,
  :'u3_org_a', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-u3-bounded-' || fixture.sequence_number,
  'evo-inbox', 'u3-bounded-' || fixture.sequence_number, 'message',
  '2026-08-24T07:00:00Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond',
  'verified',
  jsonb_build_object(
    'event', 'message',
    'session', 'evo-inbox',
    'payload', jsonb_build_object(
      'id', 'u3-bounded-' || fixture.sequence_number,
      'timestamp', 1787547600 + fixture.sequence_number,
      'from', '14155550101@c.us',
      'chatId', '14155550101@c.us',
      'fromMe', FALSE,
      'source', 'app',
      'body', 'U3 bounded message ' || fixture.sequence_number
    )
  ),
  '{"hmac_verified":true}'::JSONB,
  'synthetic:u3:bounded:' || fixture.sequence_number,
  encode(
    sha256(convert_to('u3-bounded-' || fixture.sequence_number, 'UTF8')),
    'hex'
  ),
  fixture.event_request_id,
  '2026-08-24T07:00:00Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond'
FROM u3_bulk AS fixture;

INSERT INTO platform_private.durable_work_items (
  id, organization_id, kind, state, source_webhook_event_id,
  business_key_sha256, queue_message_id, attempt_count, max_attempts,
  available_at, leased_until, completed_at, request_id, created_at, updated_at
)
SELECT
  fixture.work_id, :'u3_org_a', 'provider_webhook_process', 'succeeded',
  fixture.event_id,
  encode(
    sha256(convert_to('u3-work-' || fixture.sequence_number, 'UTF8')),
    'hex'
  ),
  85000000 + fixture.sequence_number, 1, 4,
  '2026-08-24T07:00:00Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond',
  NULL,
  '2026-08-24T07:00:01Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond',
  fixture.work_request_id,
  '2026-08-24T07:00:00Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond',
  '2026-08-24T07:00:01Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond'
FROM u3_bulk AS fixture;

INSERT INTO platform_private.waha_work_projection_effects (
  id, organization_id, work_item_id, source_webhook_event_id, disposition,
  evidence_ref, result, request_id, projected_at
)
SELECT
  fixture.effect_id, :'u3_org_a', fixture.work_id, fixture.event_id,
  'succeeded', 'synthetic:u3:bounded:' || fixture.sequence_number,
  jsonb_build_object(
    'human_review_required', FALSE,
    'communication_conversation_id', :'u3_conversation_id'::UUID,
    'canonical_client_id', :'u3_client_id'::UUID,
    'canonical_lead_id', :'u3_lead_id'::UUID
  ),
  fixture.effect_request_id,
  '2026-08-24T07:00:01Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond'
FROM u3_bulk AS fixture;

SELECT participant.id AS u3_customer_participant_id
FROM platform.conversation_participants AS participant
WHERE participant.organization_id = :'u3_org_a'
  AND participant.conversation_id = :'u3_conversation_id'
  AND participant.participant_kind = 'customer'
LIMIT 1
\gset

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id, created_at
)
SELECT
  fixture.message_id, :'u3_org_a', :'u3_conversation_id', NULL,
  :'u3_customer_participant_id', 'inbound',
  'U3 bounded message ' || fixture.sequence_number,
  'undetermined', FALSE, 'private_waha_binding',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  fixture.event_id, NULL,
  '2026-08-24T07:00:02Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond'
FROM u3_bulk AS fixture;

INSERT INTO platform_private.waha_message_bindings (
  organization_id, waha_session_name, raw_message_id,
  communication_message_id, source_webhook_event_id, created_at
)
SELECT
  :'u3_org_a', 'evo-inbox',
  'u3-bounded-' || fixture.sequence_number,
  fixture.message_id, fixture.event_id,
  '2026-08-24T07:00:02Z'::TIMESTAMPTZ
    + fixture.sequence_number * INTERVAL '1 millisecond'
FROM u3_bulk AS fixture;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Independently visible queue/retry/terminal rows make every operational
-- state testable without manufacturing UI-only labels.
CREATE TEMP TABLE u3_states (
  state_name TEXT PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  work_id UUID NOT NULL UNIQUE,
  request_id UUID NOT NULL UNIQUE,
  queue_message_id BIGINT NOT NULL UNIQUE
) ON COMMIT DROP;

GRANT SELECT ON TABLE u3_states TO authenticated;

INSERT INTO u3_states
VALUES
  ('queued', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 85002001),
  ('retrying', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 85002002),
  (
    'terminal_failure', gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), 85002003
  );

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id, received_at
)
SELECT
  fixture.event_id, :'u3_org_a', 'waha', 'waha:evo-inbox', NULL, NULL,
  'synthetic-u3-state-' || fixture.state_name,
  'evo-inbox', 'u3-state-' || fixture.state_name, 'message',
  '2026-08-24T08:00:00Z', 'verified',
  jsonb_build_object(
    'event', 'message', 'session', 'evo-inbox',
    'payload', jsonb_build_object(
      'id', 'u3-state-' || fixture.state_name,
      'timestamp', 1787551200,
      'from', '14155550999@c.us',
      'chatId', '14155550999@c.us',
      'fromMe', FALSE,
      'source', 'app',
      'body', 'U3 state ' || fixture.state_name
    )
  ),
  '{"hmac_verified":true}'::JSONB,
  'synthetic:u3:state:' || fixture.state_name,
  encode(sha256(convert_to('u3-state-' || fixture.state_name, 'UTF8')), 'hex'),
  fixture.request_id, '2026-08-24T08:00:00Z'
FROM u3_states AS fixture;

INSERT INTO platform_private.durable_work_items (
  id, organization_id, kind, state, source_webhook_event_id,
  business_key_sha256, queue_message_id, attempt_count, max_attempts,
  available_at, leased_until, completed_at, request_id, created_at, updated_at
)
SELECT
  fixture.work_id, :'u3_org_a', 'provider_webhook_process',
  CASE fixture.state_name
    WHEN 'queued' THEN 'queued'::platform.durable_work_state
    WHEN 'retrying' THEN 'retry_wait'::platform.durable_work_state
    ELSE 'dead_lettered'::platform.durable_work_state
  END,
  fixture.event_id,
  encode(sha256(convert_to('u3-state-work-' || fixture.state_name, 'UTF8')), 'hex'),
  fixture.queue_message_id,
  CASE WHEN fixture.state_name = 'queued' THEN 0 ELSE 1 END,
  4,
  CASE WHEN fixture.state_name = 'retrying'
    THEN '2026-08-24T08:05:00Z'::TIMESTAMPTZ
    ELSE '2026-08-24T08:00:00Z'::TIMESTAMPTZ END,
  NULL,
  CASE WHEN fixture.state_name = 'terminal_failure'
    THEN '2026-08-24T08:01:00Z'::TIMESTAMPTZ ELSE NULL END,
  gen_random_uuid(), '2026-08-24T08:00:00Z',
  CASE WHEN fixture.state_name = 'terminal_failure'
    THEN '2026-08-24T08:01:00Z'::TIMESTAMPTZ
    ELSE '2026-08-24T08:00:00Z'::TIMESTAMPTZ END
FROM u3_states AS fixture;

INSERT INTO platform_private.waha_work_projection_effects (
  organization_id, work_item_id, source_webhook_event_id, disposition,
  evidence_ref, result, request_id, projected_at
)
SELECT
  :'u3_org_a', fixture.work_id, fixture.event_id, 'terminal_error',
  'synthetic:u3:terminal-failure',
  '{"error_code":"provider_projection_failed"}'::JSONB,
  gen_random_uuid(), '2026-08-24T08:01:00Z'
FROM u3_states AS fixture
WHERE fixture.state_name = 'terminal_failure';

CREATE OR REPLACE FUNCTION pg_temp.u3_walk_sales_intake(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_client_id UUID,
  p_lead_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cursor_at TIMESTAMPTZ;
  cursor_id UUID;
  previous_at TIMESTAMPTZ;
  previous_id UUID;
  page_count INTEGER;
  total_count INTEGER := 0;
  seen_ids UUID[] := ARRAY[]::UUID[];
  row_value RECORD;
BEGIN
  LOOP
    page_count := 0;
    FOR row_value IN
      SELECT page.*
      FROM platform.staff_waha_sales_intake_page(
        p_organization_id,
        101,
        cursor_at,
        cursor_id,
        'received',
        'u3 bounded message'
      ) AS page
    LOOP
      IF row_value.work_item_id = ANY(seen_ids) THEN
        RAISE EXCEPTION 'U3 Sales cursor returned duplicate %',
          row_value.work_item_id;
      END IF;
      IF previous_at IS NOT NULL
        AND (row_value.sort_at, row_value.work_item_id)
          >= (previous_at, previous_id)
      THEN
        RAISE EXCEPTION 'U3 Sales cursor ordering is unstable';
      END IF;
      IF row_value.conversation_id <> p_conversation_id
        OR row_value.canonical_client_id <> p_client_id
        OR row_value.canonical_lead_id <> p_lead_id
      THEN
        RAISE EXCEPTION 'U3 Sales page lost canonical linkage';
      END IF;
      seen_ids := array_append(seen_ids, row_value.work_item_id);
      previous_at := row_value.sort_at;
      previous_id := row_value.work_item_id;
      cursor_at := row_value.sort_at;
      cursor_id := row_value.work_item_id;
      page_count := page_count + 1;
      total_count := total_count + 1;
    END LOOP;
    EXIT WHEN page_count < 101;
  END LOOP;

  IF total_count <> 1005 THEN
    RAISE EXCEPTION 'U3 Sales cursor expected 1005 rows, found %', total_count;
  END IF;
  RETURN total_count;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.u3_walk_messages(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  cursor_at TIMESTAMPTZ;
  cursor_id UUID;
  previous_at TIMESTAMPTZ;
  previous_id UUID;
  page_count INTEGER;
  total_count INTEGER := 0;
  expected_count INTEGER;
  seen_ids UUID[] := ARRAY[]::UUID[];
  row_value RECORD;
BEGIN
  SELECT count(*) INTO expected_count
  FROM platform.communication_messages AS message
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id;

  IF expected_count <= 1000 THEN
    RAISE EXCEPTION 'U3 message fixture did not exceed 1000 rows';
  END IF;

  LOOP
    page_count := 0;
    FOR row_value IN
      SELECT page.*
      FROM platform.staff_conversation_message_page(
        p_organization_id,
        p_conversation_id,
        201,
        cursor_at,
        cursor_id
      ) AS page
    LOOP
      IF row_value.message_id = ANY(seen_ids) THEN
        RAISE EXCEPTION 'U3 message cursor returned duplicate %',
          row_value.message_id;
      END IF;
      IF previous_at IS NOT NULL
        AND (row_value.created_at, row_value.message_id)
          >= (previous_at, previous_id)
      THEN
        RAISE EXCEPTION 'U3 message cursor ordering is unstable';
      END IF;
      seen_ids := array_append(seen_ids, row_value.message_id);
      previous_at := row_value.created_at;
      previous_id := row_value.message_id;
      cursor_at := row_value.created_at;
      cursor_id := row_value.message_id;
      page_count := page_count + 1;
      total_count := total_count + 1;
    END LOOP;
    EXIT WHEN page_count < 201;
  END LOOP;

  IF total_count <> expected_count THEN
    RAISE EXCEPTION 'U3 message cursor expected %, found %',
      expected_count, total_count;
  END IF;
  RETURN total_count;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.u3_walk_sales_intake(UUID, UUID, UUID, UUID),
  pg_temp.u3_walk_messages(UUID, UUID)
TO authenticated;

-- Admin sees all six truthful operational states. The bounded public result
-- contains canonical/safe data, not private provider request or chat IDs.
SET LOCAL request.jwt.claims TO :'u3_admin_claims';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u3_assert(
  pg_temp.u3_walk_sales_intake(
    :'u3_org_a', :'u3_conversation_id', :'u3_client_id', :'u3_lead_id'
  ) = 1005,
  'Admin did not traverse all bounded U3 intake rows'
);

SELECT pg_temp.u3_assert(
  EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'received', 'Synthetic inbound main'
    ) AS page
    WHERE page.conversation_id = :'u3_conversation_id'
      AND page.canonical_lead_id = :'u3_lead_id'
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'manual_review', NULL
    ) AS page
    WHERE page.conversation_id = :'u3_media_conversation_id'
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'unsupported', NULL
    )
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'queued', NULL
    ) AS page
    JOIN u3_states AS fixture ON fixture.work_id = page.work_item_id
    WHERE fixture.state_name = 'queued'
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'retrying', NULL
    ) AS page
    JOIN u3_states AS fixture ON fixture.work_id = page.work_item_id
    WHERE fixture.state_name = 'retrying'
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'terminal_failure', NULL
    ) AS page
    JOIN u3_states AS fixture ON fixture.work_id = page.work_item_id
    WHERE fixture.state_name = 'terminal_failure'
      AND page.error_code = 'provider_projection_failed'
  ),
  'one or more explicit U3 intake states are unavailable to Admin'
);

SELECT pg_temp.u3_assert(
  pg_get_function_result(
    'platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)'::REGPROCEDURE
  ) NOT ILIKE '%raw_payload%'
  AND pg_get_function_result(
    'platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)'::REGPROCEDURE
  ) NOT ILIKE '%provider_request_id%'
  AND pg_get_function_result(
    'platform.staff_waha_sales_intake_page(uuid,integer,timestamp with time zone,uuid,text,text)'::REGPROCEDURE
  ) NOT ILIKE '%waha_message_id%'
  AND NOT EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, NULL, NULL
    ) AS page
    WHERE page.message_preview LIKE '%@c.us%'
      OR page.message_preview LIKE '%true_14155550101%'
  ),
  'safe U3 intake projection exposes private provider evidence'
);

RESET ROLE;
RESET request.jwt.claims;

-- Assigned Sales gets the same complete bounded intake and transcript.
SET LOCAL request.jwt.claims TO :'u3_intake_claims';
SET LOCAL ROLE authenticated;

SELECT pg_temp.u3_assert(
  pg_temp.u3_walk_sales_intake(
    :'u3_org_a', :'u3_conversation_id', :'u3_client_id', :'u3_lead_id'
  ) = 1005
  AND pg_temp.u3_walk_messages(
    :'u3_org_a', :'u3_conversation_id'
  ) > 1000
  AND (
    SELECT linked
    FROM platform.staff_canonical_lead_conversation_link(
      :'u3_org_a', :'u3_lead_id', :'u3_conversation_id'
    )
  ),
  'assigned Sales lost intake, bounded transcript, or exact link access'
);

RESET ROLE;
RESET request.jwt.claims;

-- Sharing a canonical client does not make a different lead the exact owner
-- of this conversation.
SELECT platform_private.create_or_link_lead(
  :'u3_org_a', :'u3_client_id', :'u3_intake_sales_membership',
  'new_inbound', 'whatsapp', 'waha', 'sales_intake',
  'evo-inbox:14155550101@c.us:separate-lead', 'webhook_verified',
  '2026-08-24T09:00:00Z', NULL, 'synthetic:u3:separate-lead'
) AS u3_other_lead_same_client
\gset

SET LOCAL request.jwt.claims TO :'u3_intake_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.u3_assert(
  NOT (
    SELECT linked
    FROM platform.staff_canonical_lead_conversation_link(
      :'u3_org_a', :'u3_other_lead_same_client', :'u3_conversation_id'
    )
  ),
  'nested Sales transcript accepted a different lead with the same client'
);
RESET ROLE;
RESET request.jwt.claims;

-- Other Sales and Curator can invoke the safe read contract but cannot see an
-- out-of-scope U3 intake. Curator retains positive bounded access to an
-- already assigned U1 communication object.
SET LOCAL request.jwt.claims TO :'u3_other_sales_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.u3_assert(
  NOT EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, 'received', 'u3 bounded message'
    )
  ),
  'unassigned Sales received another owner''s U3 intake'
);
RESET ROLE;
RESET request.jwt.claims;

SET LOCAL request.jwt.claims TO :'u3_curator_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.u3_assert(
  NOT EXISTS (
    SELECT 1 FROM platform.staff_waha_sales_intake_page(
      :'u3_org_a', 101, NULL, NULL, NULL, NULL
    )
  )
  AND EXISTS (
    SELECT 1 FROM platform.staff_conversation_message_page(
      :'u3_org_a', :'u3_curator_conversation_id', 1, NULL, NULL
    )
  ),
  'Curator scope leaked Sales intake or lost its assigned conversation'
);
RESET ROLE;
RESET request.jwt.claims;

-- Dedicated lifecycle fixtures avoid relying on an old test's mutable status.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '85000000-0000-4000-8000-000000000001',
    'u3-inactive@example.invalid', '{}'
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    'u3-suspended@example.invalid', '{}'
  );

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (
    '85000000-0000-4000-8000-000000000011',
    '85000000-0000-4000-8000-000000000001',
    'U3 inactive Sales', 'active', 1
  ),
  (
    '85000000-0000-4000-8000-000000000012',
    '85000000-0000-4000-8000-000000000002',
    'U3 suspended Sales', 'active', 1
  );

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (
    '85000000-0000-4000-8000-000000000021', :'u3_org_a',
    '85000000-0000-4000-8000-000000000011',
    'inactive', 'sales', :'u3_sales_bundle'
  ),
  (
    '85000000-0000-4000-8000-000000000022', :'u3_org_a',
    '85000000-0000-4000-8000-000000000012',
    'suspended', 'sales', :'u3_sales_bundle'
  );

SELECT jsonb_build_object(
  'sub', '85000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', '85000000-0000-4000-8000-000000000021',
  'platform_bundle_id', :'u3_sales_bundle',
  'platform_bundle_version', :'u3_sales_bundle_version'::BIGINT
)::TEXT AS u3_inactive_claims
\gset

SELECT jsonb_build_object(
  'sub', '85000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', 1,
  'platform_organization_id', :'u3_org_a',
  'platform_membership_id', '85000000-0000-4000-8000-000000000022',
  'platform_bundle_id', :'u3_sales_bundle',
  'platform_bundle_version', :'u3_sales_bundle_version'::BIGINT
)::TEXT AS u3_suspended_claims
\gset

SELECT (
  :'u3_intake_claims'::JSONB
  || jsonb_build_object(
    'platform_access_version',
    GREATEST(:'u3_intake_access_version'::BIGINT - 1, 0)
  )
)::TEXT AS u3_stale_claims
\gset

-- Each expected error is isolated by a savepoint so a genuine denial does not
-- abort the surrounding synthetic transaction.
\set ON_ERROR_STOP off

SAVEPOINT u3_cross_org_denial;
SET LOCAL request.jwt.claims TO :'u3_admin_b_claims';
SET LOCAL ROLE authenticated;
SELECT * FROM platform.staff_waha_sales_intake_page(
  :'u3_org_a', 1, NULL, NULL, NULL, NULL
);
\set u3_cross_org_state :SQLSTATE
ROLLBACK TO SAVEPOINT u3_cross_org_denial;
RELEASE SAVEPOINT u3_cross_org_denial;
RESET ROLE;
RESET request.jwt.claims;

SAVEPOINT u3_stale_denial;
SET LOCAL request.jwt.claims TO :'u3_stale_claims';
SET LOCAL ROLE authenticated;
SELECT * FROM platform.staff_waha_sales_intake_page(
  :'u3_org_a', 1, NULL, NULL, NULL, NULL
);
\set u3_stale_state :SQLSTATE
ROLLBACK TO SAVEPOINT u3_stale_denial;
RELEASE SAVEPOINT u3_stale_denial;
RESET ROLE;
RESET request.jwt.claims;

SAVEPOINT u3_inactive_denial;
SET LOCAL request.jwt.claims TO :'u3_inactive_claims';
SET LOCAL ROLE authenticated;
SELECT * FROM platform.staff_waha_sales_intake_page(
  :'u3_org_a', 1, NULL, NULL, NULL, NULL
);
\set u3_inactive_state :SQLSTATE
ROLLBACK TO SAVEPOINT u3_inactive_denial;
RELEASE SAVEPOINT u3_inactive_denial;
RESET ROLE;
RESET request.jwt.claims;

SAVEPOINT u3_suspended_denial;
SET LOCAL request.jwt.claims TO :'u3_suspended_claims';
SET LOCAL ROLE authenticated;
SELECT * FROM platform.staff_waha_sales_intake_page(
  :'u3_org_a', 1, NULL, NULL, NULL, NULL
);
\set u3_suspended_state :SQLSTATE
ROLLBACK TO SAVEPOINT u3_suspended_denial;
RELEASE SAVEPOINT u3_suspended_denial;
RESET ROLE;
RESET request.jwt.claims;

SAVEPOINT u3_anon_denial;
SET LOCAL ROLE anon;
SELECT * FROM platform.staff_waha_sales_intake_page(
  :'u3_org_a', 1, NULL, NULL, NULL, NULL
);
\set u3_anon_state :SQLSTATE
ROLLBACK TO SAVEPOINT u3_anon_denial;
RELEASE SAVEPOINT u3_anon_denial;
RESET ROLE;

\set ON_ERROR_STOP on

SELECT pg_temp.u3_assert(
  :'u3_cross_org_state' = '42501'
  AND :'u3_stale_state' = '42501'
  AND :'u3_inactive_state' = '42501'
  AND :'u3_suspended_state' = '42501'
  AND :'u3_anon_state' = '42501',
  'cross-org, stale, inactive, suspended, or anonymous access did not deny'
);

ROLLBACK;

SELECT 'platform U3 receive-only Sales RLS and traversal checks passed' AS result;
