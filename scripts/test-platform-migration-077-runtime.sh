#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly DATABASE_CONTAINER="${1:?database container name is required}"
readonly DATABASE_NAME="${2:?database name is required}"
readonly WAHA_SESSION_NAME="crm_primary"

# Migration 077 extends the migration-045 queue fixture with the canonical
# provider-authority boundary used by the successor schema.
# Exercise the real SQL functions transactionally so compilation alone cannot
# hide an identity, deduplication, or replay defect. Every row is rolled back.
docker exec -i "${DATABASE_CONTAINER}" \
  psql \
  -X \
  -q \
  -v ON_ERROR_STOP=1 \
  -v waha_session_name="${WAHA_SESSION_NAME}" \
  -U postgres \
  -d "${DATABASE_NAME}" <<'SQL'
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_catalog.set_config(
  'evo.test_waha_session_name',
  :'waha_session_name',
  TRUE
);

INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id,
  reason, request_id
) VALUES (
  '45990000-0000-4000-8000-000000000001',
  '45993000-0000-4000-8000-000000000003',
  '45993000-0000-4000-8000-000000000004',
  1, 1, TRUE, 'system', NULL,
  'Migration 077 disposable provider ingress proof',
  '45997000-0000-4000-8000-000000000001'
);

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256, request_id
) VALUES (
  '45997000-0000-4000-8000-000000000002',
  '45990000-0000-4000-8000-000000000001',
  'waha', 'waha:' || :'waha_session_name',
  'migration-077-signed-request', :'waha_session_name',
  'migration-077-message-1', 'message.any', '2026-08-18T00:00:00Z', 'verified',
  jsonb_build_object(
    'event', 'message.any',
    'session', :'waha_session_name',
    'payload', jsonb_build_object(
      'id', 'migration-077-message-1',
      'timestamp', 1787011200,
      'from', '14155550199@c.us',
      'chatId', '14155550199@c.us',
      'fromMe', FALSE,
      'source', 'app',
      'body', 'Synthetic migration 077 inbound message'
    ),
    'synthetic', TRUE
  ),
  '{}'::JSONB, 'local:migration-077:provider-ingress', repeat('7', 64),
  '45997000-0000-4000-8000-000000000003'
);

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.sync_lead_agent_whatsapp(
  '45990000-0000-4000-8000-000000000001'::UUID,
  '45997000-0000-4000-8000-000000000002'::UUID,
  '45993000-0000-4000-8000-000000000003'::UUID,
  990001::BIGINT, 990101::BIGINT, 990201::BIGINT,
  '45997000-0000-4000-8000-000000000004'::UUID
) AS migration_077_first
\gset
SELECT platform.sync_lead_agent_whatsapp(
  '45990000-0000-4000-8000-000000000001'::UUID,
  '45997000-0000-4000-8000-000000000002'::UUID,
  '45993000-0000-4000-8000-000000000003'::UUID,
  990001::BIGINT, 990101::BIGINT, 990201::BIGINT,
  '45997000-0000-4000-8000-000000000004'::UUID
) AS migration_077_same_request
\gset
SELECT platform.sync_lead_agent_whatsapp(
  '45990000-0000-4000-8000-000000000001'::UUID,
  '45997000-0000-4000-8000-000000000002'::UUID,
  '45993000-0000-4000-8000-000000000003'::UUID,
  990001::BIGINT, 990101::BIGINT, 990201::BIGINT,
  '45997000-0000-4000-8000-000000000005'::UUID
) AS migration_077_duplicate_event
\gset
RESET ROLE;

CREATE TEMP TABLE migration_077_sync_results (
  first_result JSONB NOT NULL,
  same_request_result JSONB NOT NULL,
  duplicate_event_result JSONB NOT NULL
) ON COMMIT DROP;
INSERT INTO migration_077_sync_results VALUES (
  :'migration_077_first'::JSONB,
  :'migration_077_same_request'::JSONB,
  :'migration_077_duplicate_event'::JSONB
);

DO $assert$
DECLARE
  first_result JSONB;
  same_request_result JSONB;
  duplicate_event_result JSONB;
BEGIN
  SELECT results.first_result, results.same_request_result,
    results.duplicate_event_result
  INTO first_result, same_request_result, duplicate_event_result
  FROM pg_temp.migration_077_sync_results AS results;
  IF first_result ->> 'deduplicated' <> 'false'
    OR first_result ->> 'provider_identity_private' <> 'true'
    OR same_request_result IS DISTINCT FROM first_result
    OR duplicate_event_result ->> 'deduplicated' <> 'true'
    OR duplicate_event_result ->> 'conversation_id' IS DISTINCT FROM
      first_result ->> 'conversation_id'
    OR duplicate_event_result ->> 'communication_message_id' IS DISTINCT FROM
      first_result ->> 'communication_message_id'
  THEN
    RAISE EXCEPTION 'Migration 077 provider ingress did not preserve exact idempotency';
  END IF;

  IF (SELECT count(*) FROM platform.communication_conversations
      WHERE organization_id = '45990000-0000-4000-8000-000000000001'
        AND waha_session_name =
          pg_catalog.current_setting('evo.test_waha_session_name')
        AND amocrm_account_id = 990001
        AND amocrm_lead_id = 990101
        AND amocrm_contact_id = 990201) <> 1
    OR (SELECT count(*) FROM platform.communication_messages
      WHERE organization_id = '45990000-0000-4000-8000-000000000001'
        AND id = (first_result ->> 'communication_message_id')::UUID
        AND direction = 'inbound'
        AND message_identity_source = 'private_waha_binding'
        AND waha_session_name IS NULL
        AND waha_message_id IS NULL) <> 1
    OR (SELECT count(*) FROM platform.audit_events
      WHERE request_id IN (
        '45997000-0000-4000-8000-000000000004',
        '45997000-0000-4000-8000-000000000005'
      )
        AND action = 'communication.leadagent.sync'
        AND before_state IS NULL
        AND NOT after_state ? 'body_text') <> 2
  THEN
    RAISE EXCEPTION 'Migration 077 provider ingress evidence is incomplete';
  END IF;
END
$assert$;

-- Seed the exact idempotency record that a successfully claimed manual-send
-- request would have produced. A replay must be downgraded to claimed=false;
-- replaying claimed=true would authorize a second irreversible WAHA call.
INSERT INTO platform_private.durable_work_idempotency (
  request_id, operation, input_sha256, response
) VALUES (
  '45997000-0000-4000-8000-000000000006',
  'claim',
  encode(sha256(convert_to(jsonb_build_object(
    'organization_id', '45990000-0000-4000-8000-000000000001'::UUID,
    'visibility_timeout_seconds', 30,
    'worker_ref', 'migration-077-replay-proof',
    'lane', 'manual_whatsapp_send'
  )::TEXT, 'UTF8')), 'hex'),
  jsonb_build_object(
    'claimed', TRUE,
    'queue', 'platform_work_v1',
    'work_item_id', '45997000-0000-4000-8000-000000000007'
  )
);

SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.claim_manual_whatsapp_send(
  '45990000-0000-4000-8000-000000000001',
  30,
  'migration-077-replay-proof',
  '45997000-0000-4000-8000-000000000006'
) AS migration_077_replay_claim
\gset
RESET ROLE;

CREATE TEMP TABLE migration_077_claim_results (replay_claim JSONB NOT NULL)
ON COMMIT DROP;
INSERT INTO migration_077_claim_results VALUES (:'migration_077_replay_claim'::JSONB);

DO $assert$
BEGIN
  IF (SELECT replay_claim FROM pg_temp.migration_077_claim_results) IS DISTINCT FROM
    '{"claimed":false,"queue":"platform_work_v1"}'::JSONB
  THEN
    RAISE EXCEPTION 'Migration 077 manual-send replay retained provider authority';
  END IF;
END
$assert$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SQL

printf '%s\n' \
  'Verified transactional migration 077 provider ingress, amoCRM identity, private binding, audit, deduplication and no-authority manual claim replay.'
