\set ON_ERROR_STOP on

-- P2G acceptance uses only deterministic UUIDs, reserved example.invalid
-- identities and synthetic source rows in a disposable PostgreSQL container.
-- It proves queue authorization, manual-review and retry/dead-letter contracts.
-- It does not call a provider, worker binary or production queue.

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P2G assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.pick_enum_label(
  p_enum_values TEXT[],
  p_candidates TEXT[]
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT;
BEGIN
  FOREACH candidate IN ARRAY p_candidates LOOP
    IF candidate = ANY (p_enum_values) THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION
    'Missing required enum label. Candidates %, available %',
    p_candidates,
    p_enum_values;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO service_role;

GRANT EXECUTE ON FUNCTION pg_temp.pick_enum_label(TEXT[], TEXT[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.pick_enum_label(TEXT[], TEXT[])
  TO service_role;

-- Resolve persisted fixture identities from earlier migrations.
SELECT
  membership.organization_id AS org_a_id,
  membership.id AS admin_a_membership_id,
  profile.id AS admin_a_profile_id,
  profile.access_version AS admin_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS org_b_id,
  membership.id AS admin_b_membership_id,
  profile.id AS admin_b_profile_id,
  profile.access_version AS admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  membership.id AS sales_a_membership_id,
  profile.id AS sales_a_profile_id,
  profile.access_version AS sales_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '42000000-0000-4000-8000-000000000002'
\gset

SELECT
  membership.id AS student_a_membership_id,
  profile.id AS student_a_profile_id,
  profile.access_version AS student_a_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000005'
\gset

SELECT id AS org_a_scope_id, scope_version AS org_a_scope_version
FROM platform.record_scopes
WHERE organization_id = :'org_a_id'
ORDER BY created_at, id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS admin_a_claims
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset

SELECT jsonb_build_object(
  'sub', '42000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'sales_a_access_version'::BIGINT
)::TEXT AS sales_a_claims
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000005',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'student_a_access_version'::BIGINT
)::TEXT AS student_a_claims
\gset

SELECT enum_range(NULL::platform.durable_work_finish_outcome)::TEXT[]
  AS durable_work_finish_outcomes
\gset

SELECT enum_range(NULL::platform.work_review_resolution)::TEXT[]
  AS work_review_resolutions
\gset

SELECT enum_range(NULL::platform.work_review_status)::TEXT[]
  AS work_review_statuses
\gset

SELECT pg_temp.pick_enum_label(
  :'durable_work_finish_outcomes'::TEXT[],
  ARRAY['success', 'succeeded', 'completed', 'archived']
) AS finish_success
\gset

SELECT pg_temp.pick_enum_label(
  :'durable_work_finish_outcomes'::TEXT[],
  ARRAY['retry', 'retry_scheduled', 'retryable_error', 'retry_pending']
) AS finish_retry
\gset

SELECT pg_temp.pick_enum_label(
  :'durable_work_finish_outcomes'::TEXT[],
  ARRAY['unknown_result', 'unknown', 'unknown_manual_review']
) AS finish_unknown
\gset

SELECT pg_temp.pick_enum_label(
  :'durable_work_finish_outcomes'::TEXT[],
  ARRAY['conflict', 'provider_conflict', 'conflict_manual_review']
) AS finish_conflict
\gset

SELECT pg_temp.pick_enum_label(
  :'work_review_statuses'::TEXT[],
  ARRAY['open', 'pending', 'requires_resolution']
) AS review_status_open
\gset

SELECT (:'work_review_resolutions'::TEXT[])[1] AS review_resolution_first
\gset

SELECT pg_temp.pick_enum_label(
  :'work_review_resolutions'::TEXT[],
  ARRAY['conflict_acknowledged', 'duplicate_suppressed']
) AS conflict_review_resolution
\gset

SELECT count(*)::TEXT AS baseline_work_item_count
FROM platform_private.durable_work_items
\gset

SELECT count(*)::TEXT AS baseline_dead_letter_count
FROM platform_private.durable_work_dead_letters
\gset

SELECT count(*)::TEXT AS baseline_review_case_count
FROM platform.work_review_cases
\gset

-- Minimal P2F source rows for the queue wrappers.
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
    '45000000-0000-4000-8000-000000000101',
    :'org_a_id',
    'waha',
    'synthetic:waha:verified:a',
    NULL,
    NULL,
    'synthetic-request-verified-a',
    'evo-inbox-queue-a',
    'synthetic-payload-verified-a',
    'message.any',
    '2026-07-28 10:00:00+06'::TIMESTAMPTZ,
    'verified',
    '{"event":"verified-a"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:hmac:verified:a',
    repeat('1', 64),
    '45000000-0000-4000-8000-000000000111'
  ),
  (
    '45000000-0000-4000-8000-000000000102',
    :'org_a_id',
    'waha',
    'synthetic:waha:verified:b',
    NULL,
    NULL,
    'synthetic-request-verified-b',
    'evo-inbox-queue-b',
    'synthetic-payload-verified-b',
    'message.any',
    '2026-07-28 10:01:00+06'::TIMESTAMPTZ,
    'verified',
    '{"event":"verified-b"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:hmac:verified:b',
    repeat('2', 64),
    '45000000-0000-4000-8000-000000000112'
  ),
  (
    '45000000-0000-4000-8000-000000000103',
    :'org_a_id',
    'waha',
    'synthetic:waha:stale:a',
    NULL,
    NULL,
    'synthetic-request-stale-a',
    'evo-inbox-queue-stale',
    'synthetic-payload-stale-a',
    'message.any',
    '2026-07-28 10:02:00+06'::TIMESTAMPTZ,
    'stale',
    '{"event":"stale-a"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:hmac:stale:a',
    repeat('3', 64),
    '45000000-0000-4000-8000-000000000113'
  ),
  (
    '45000000-0000-4000-8000-000000000104',
    :'org_a_id',
    'waha',
    'synthetic:waha:verified:draft',
    NULL,
    NULL,
    'synthetic-request-verified-draft',
    'evo-inbox-queue-a',
    'synthetic-payload-verified-draft',
    'message.any',
    '2026-07-28 10:03:00+06'::TIMESTAMPTZ,
    'verified',
    '{"event":"verified-draft"}'::JSONB,
    '{"x-webhook-hmac":"synthetic"}'::JSONB,
    'synthetic:hmac:verified:draft',
    repeat('7', 64),
    '45000000-0000-4000-8000-000000000114'
  );

INSERT INTO platform.communication_conversations (
  id,
  organization_id,
  student_case_id,
  responsible_sales_membership_id,
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
VALUES (
  '45000000-0000-4000-8000-000000000201',
  :'org_a_id',
  NULL,
  :'sales_a_membership_id',
  NULL,
  'sales',
  'open',
  'Synthetic P2G Queue Fixture',
  'evo-inbox-queue-a',
  101,
  NULL,
  201,
  301,
  401,
  :'org_a_scope_id',
  :'org_a_scope_version'::BIGINT,
  '45000000-0000-4000-8000-000000000101'
);

INSERT INTO platform.conversation_participants (
  id,
  organization_id,
  conversation_id,
  participant_kind,
  membership_id,
  external_subject_ref,
  source_webhook_event_id
)
VALUES (
  '45000000-0000-4000-8000-000000000202',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  'customer',
  NULL,
  'synthetic:customer:p2g',
  '45000000-0000-4000-8000-000000000101'
);

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
VALUES (
  '45000000-0000-4000-8000-000000000203',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  NULL,
  '45000000-0000-4000-8000-000000000202',
  'inbound',
  'Здравствуйте, это синтетический Queue тест.',
  'ru',
  FALSE,
  'evo-inbox-queue-a',
  'synthetic-waha-message-p2g-a',
  101,
  NULL,
  NULL,
  201,
  301,
  401,
  '45000000-0000-4000-8000-000000000101',
  NULL,
  '2026-07-28 10:03:00+06'::TIMESTAMPTZ
);

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
VALUES (
  '45000000-0000-4000-8000-000000000209',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  NULL,
  '45000000-0000-4000-8000-000000000202',
  'inbound',
  'Это второй синтетический запрос для Queue generation.',
  'ru',
  FALSE,
  'evo-inbox-queue-a',
  'synthetic-waha-message-p2g-draft',
  101,
  NULL,
  NULL,
  201,
  301,
  401,
  '45000000-0000-4000-8000-000000000104',
  NULL,
  '2026-07-28 10:04:00+06'::TIMESTAMPTZ
);

INSERT INTO platform.approved_knowledge_versions (
  id,
  organization_id,
  knowledge_key,
  title,
  version,
  status,
  content_text,
  content_sha256,
  provenance_ref,
  approved_by_membership_id
)
VALUES (
  '45000000-0000-4000-8000-000000000204',
  :'org_a_id',
  'synthetic.p2g.knowledge',
  'Synthetic Queue Knowledge',
  1,
  'approved',
  'Approved queue fixture knowledge.',
  repeat('4', 64),
  'https://queue-fixture.example.invalid/knowledge',
  :'admin_a_membership_id'
);

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
  '45000000-0000-4000-8000-000000000205',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  NULL,
  '45000000-0000-4000-8000-000000000203',
  'ru',
  :'sales_a_profile_id',
  :'sales_a_membership_id',
  'Synthetic queue draft request',
  '45000000-0000-4000-8000-000000000115'
);

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
  '45000000-0000-4000-8000-000000000210',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  NULL,
  '45000000-0000-4000-8000-000000000209',
  'ru',
  :'sales_a_profile_id',
  :'sales_a_membership_id',
  'Synthetic queue generation-only request',
  '45000000-0000-4000-8000-000000000116'
);

INSERT INTO platform.ai_drafts (
  id,
  organization_id,
  conversation_id,
  student_case_id,
  source_message_id,
  ai_draft_request_id,
  supersedes_ai_draft_id,
  detection_status,
  selected_language,
  knowledge_version_id,
  provider_ref,
  model_ref,
  prompt_policy_version,
  source_context,
  source_context_sha256,
  generated_text,
  generated_text_sha256,
  failure_outcome,
  state,
  reviewed_text,
  reviewed_text_sha256,
  reviewed_by_membership_id,
  reviewed_at,
  review_reason
)
VALUES (
  '45000000-0000-4000-8000-000000000206',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  NULL,
  '45000000-0000-4000-8000-000000000203',
  '45000000-0000-4000-8000-000000000205',
  NULL,
  'confident',
  'ru',
  '45000000-0000-4000-8000-000000000204',
  'synthetic-provider',
  'synthetic-model',
  'v1',
  '{"source":"queue-fixture"}'::JSONB,
  repeat('5', 64),
  'Сгенерированный черновик.',
  repeat('6', 64),
  NULL,
  'manual_send_authorized',
  'Проверенный финальный текст.',
  repeat('7', 64),
  :'sales_a_membership_id',
  '2026-07-28 10:04:00+06'::TIMESTAMPTZ,
  'Synthetic queue review approval'
);

INSERT INTO platform.manual_send_authorizations (
  id,
  organization_id,
  conversation_id,
  ai_draft_id,
  final_text,
  final_text_sha256,
  authorized_by_profile_id,
  authorized_by_membership_id,
  reason,
  request_id
)
VALUES (
  '45000000-0000-4000-8000-000000000207',
  :'org_a_id',
  '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000206',
  'Разрешено к ручной отправке.',
  repeat('8', 64),
  :'sales_a_profile_id',
  :'sales_a_membership_id',
  'Synthetic manual-send authorization',
  '45000000-0000-4000-8000-000000000116'
);

-- Service-only wrappers deny browser and auth-admin roles.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000101',
  repeat('9', 64),
  2,
  '45000000-0000-4000-8000-000000000301'
);
\set enqueue_webhook_authenticated_state :SQLSTATE
SELECT platform.claim_durable_work(
  1,
  'worker-authenticated',
  '45000000-0000-4000-8000-000000000302'
);
\set claim_authenticated_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"supabase_auth_admin"}';
SET ROLE supabase_auth_admin;
\set ON_ERROR_STOP off
SELECT platform.enqueue_ai_draft_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000210',
  repeat('a', 64),
  2,
  '45000000-0000-4000-8000-000000000303'
);
\set enqueue_ai_auth_admin_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'enqueue_webhook_authenticated_state' <> '00000'
    AND :'claim_authenticated_state' <> '00000'
    AND :'enqueue_ai_auth_admin_state' <> '00000',
  'P2G service wrappers must deny authenticated and supabase_auth_admin callers'
);

-- Service role creates work and enforces source-shape/business-key invariants.
SET request.jwt.claims TO '{"role":"service_role"}';

\set ON_ERROR_STOP off
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000103',
  repeat('b', 64),
  2,
  '45000000-0000-4000-8000-000000000304'
);
\set enqueue_stale_webhook_state :SQLSTATE
\set ON_ERROR_STOP on

\set ON_ERROR_STOP off
SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000101',
  repeat('c', 64),
  2,
  '45000000-0000-4000-8000-000000000305'
)::TEXT AS enqueue_webhook_first
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000101',
  repeat('c', 64),
  2,
  '45000000-0000-4000-8000-000000000306'
)::TEXT AS enqueue_webhook_replay
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000101',
  repeat('d', 64),
  2,
  '45000000-0000-4000-8000-000000000307'
);
\set enqueue_webhook_mismatch_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT count(*)::TEXT AS after_webhook_enqueue_count
FROM platform_private.durable_work_items
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-conflict',
  '45000000-0000-4000-8000-000000000308'
)::TEXT AS conflict_claim
\gset

SELECT (:'conflict_claim'::JSONB ->> 'work_item_id') AS conflict_work_item_id
\gset
SELECT (:'conflict_claim'::JSONB ->> 'attempt_id') AS conflict_attempt_id
\gset
SELECT message::TEXT AS conflict_payload
FROM pgmq.q_platform_work_v1
WHERE msg_id = (
  :'enqueue_webhook_first'::JSONB ->> 'queue_message_id'
)::BIGINT
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-conflict-second',
  '45000000-0000-4000-8000-000000000309'
)::TEXT AS conflict_claim_while_leased
\gset

\set ON_ERROR_STOP off
SELECT platform.finish_durable_work(
  :'conflict_work_item_id',
  :'conflict_attempt_id',
  CAST(:'finish_unknown' AS platform.durable_work_finish_outcome),
  'synthetic:unknown-for-webhook',
  'synthetic:evidence:wrong-outcome:webhook',
  NULL,
  '45000000-0000-4000-8000-000000000310'
);
\set finish_webhook_unknown_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_durable_work(
  :'conflict_work_item_id',
  :'conflict_attempt_id',
  CAST(:'finish_conflict' AS platform.durable_work_finish_outcome),
  'synthetic:provider-conflict',
  'synthetic:evidence:conflict',
  NULL,
  '45000000-0000-4000-8000-000000000311'
)::TEXT AS conflict_finish
\gset

SELECT pg_sleep(2);
SELECT platform.claim_durable_work(
  1,
  'worker-conflict-after-finish',
  '45000000-0000-4000-8000-000000000312'
)::TEXT AS conflict_claim_after_finish
\gset

SELECT platform.enqueue_ai_draft_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000210',
  repeat('e', 64),
  2,
  '45000000-0000-4000-8000-000000000313'
)::TEXT AS enqueue_ai_first
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-ai-first',
  '45000000-0000-4000-8000-000000000314'
)::TEXT AS ai_claim_first
\gset

SELECT (:'ai_claim_first'::JSONB ->> 'work_item_id') AS ai_work_item_id
\gset
SELECT (:'ai_claim_first'::JSONB ->> 'attempt_id') AS ai_attempt_id_first
\gset

\set ON_ERROR_STOP off
SELECT platform.extend_durable_work_lease(
  :'ai_work_item_id',
  '45000000-0000-4000-8000-000000009999',
  2,
  '45000000-0000-4000-8000-000000000315'
);
\set extend_ai_wrong_attempt_state :SQLSTATE
\set ON_ERROR_STOP on

\set ON_ERROR_STOP off
SELECT platform.finish_durable_work(
  :'ai_work_item_id',
  :'ai_attempt_id_first',
  CAST(:'finish_unknown' AS platform.durable_work_finish_outcome),
  'synthetic:wrong-unknown-for-ai',
  'synthetic:evidence:wrong-outcome:ai',
  1,
  '45000000-0000-4000-8000-000000000316'
);
\set finish_ai_unknown_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_durable_work(
  :'ai_work_item_id',
  :'ai_attempt_id_first',
  CAST(:'finish_retry' AS platform.durable_work_finish_outcome),
  'synthetic:retryable-ai-failure',
  'synthetic:evidence:retry:ai',
  1,
  '45000000-0000-4000-8000-000000000317'
)::TEXT AS ai_finish_retry
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-ai-immediate-reclaim',
  '45000000-0000-4000-8000-000000000318'
)::TEXT AS ai_claim_immediate_reclaim
\gset

SELECT pg_sleep(2);
SELECT platform.claim_durable_work(
  1,
  'worker-ai-second',
  '45000000-0000-4000-8000-000000000319'
)::TEXT AS ai_claim_second
\gset

SELECT (:'ai_claim_second'::JSONB ->> 'work_item_id') AS ai_work_item_id_second
\gset
SELECT (:'ai_claim_second'::JSONB ->> 'attempt_id') AS ai_attempt_id_second
\gset

SELECT platform.finish_durable_work(
  :'ai_work_item_id_second',
  :'ai_attempt_id_second',
  CAST(:'finish_success' AS platform.durable_work_finish_outcome),
  NULL,
  'synthetic:evidence:success:ai',
  NULL,
  '45000000-0000-4000-8000-000000000320'
)::TEXT AS ai_finish_success
\gset

SELECT pg_sleep(2);
SELECT platform.claim_durable_work(
  1,
  'worker-ai-after-success',
  '45000000-0000-4000-8000-000000000321'
)::TEXT AS ai_claim_after_success
\gset

\set ON_ERROR_STOP off
SELECT platform.enqueue_manual_whatsapp_send(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000207',
  repeat('f', 64),
  2,
  '45000000-0000-4000-8000-000000000341'
);
\set enqueue_manual_multiple_attempts_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'enqueue_manual_multiple_attempts_state' <> '00000',
  'Manual WhatsApp send work must reject max_attempts > 1'
);

SELECT platform.enqueue_manual_whatsapp_send(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000207',
  repeat('f', 64),
  1,
  '45000000-0000-4000-8000-000000000322'
)::TEXT AS enqueue_manual_first
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-manual',
  '45000000-0000-4000-8000-000000000323'
)::TEXT AS manual_claim
\gset

SELECT (:'manual_claim'::JSONB ->> 'work_item_id') AS manual_work_item_id
\gset
SELECT (:'manual_claim'::JSONB ->> 'attempt_id') AS manual_attempt_id
\gset

\set ON_ERROR_STOP off
SELECT platform.finish_durable_work(
  :'manual_work_item_id',
  :'manual_attempt_id',
  CAST(:'finish_conflict' AS platform.durable_work_finish_outcome),
  'synthetic:wrong-conflict-for-manual',
  'synthetic:evidence:wrong-outcome:manual',
  NULL,
  '45000000-0000-4000-8000-000000000324'
);
\set finish_manual_conflict_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.finish_durable_work(
  :'manual_work_item_id',
  :'manual_attempt_id',
  CAST(:'finish_unknown' AS platform.durable_work_finish_outcome),
  'synthetic:provider-unknown',
  'synthetic:evidence:unknown',
  NULL,
  '45000000-0000-4000-8000-000000000325'
)::TEXT AS manual_finish_unknown
\gset

-- Unknown-result manual send is terminal/manual-review only. Even after the
-- lease window expires, it must not return to the active queue.
SELECT pg_sleep(2);
SELECT platform.claim_durable_work(
  1,
  'worker-manual-after-unknown',
  '45000000-0000-4000-8000-000000000326'
)::TEXT AS manual_claim_after_unknown
\gset

SELECT platform.enqueue_verified_webhook_work(
  :'org_a_id',
  '45000000-0000-4000-8000-000000000102',
  repeat('0', 64),
  1,
  '45000000-0000-4000-8000-000000000327'
)::TEXT AS enqueue_webhook_dlq
\gset

SELECT platform.claim_durable_work(
  1,
  'worker-dlq',
  '45000000-0000-4000-8000-000000000328'
)::TEXT AS dlq_claim
\gset

SELECT (:'dlq_claim'::JSONB ->> 'work_item_id') AS dlq_work_item_id
\gset
SELECT (:'dlq_claim'::JSONB ->> 'attempt_id') AS dlq_attempt_id
\gset

SELECT platform.finish_durable_work(
  :'dlq_work_item_id',
  :'dlq_attempt_id',
  CAST(:'finish_retry' AS platform.durable_work_finish_outcome),
  'synthetic:retry-exhausted',
  'synthetic:evidence:dead-letter',
  1,
  '45000000-0000-4000-8000-000000000329'
)::TEXT AS dlq_finish
\gset

SELECT pg_sleep(2);
SELECT platform.claim_durable_work(
  1,
  'worker-dlq-after-finish',
  '45000000-0000-4000-8000-000000000330'
)::TEXT AS dlq_claim_after_finish
\gset

RESET request.jwt.claims;

-- Admin review visibility and resolution.
SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT count(*)::TEXT AS admin_a_review_case_count
FROM platform.admin_work_review_cases(:'org_a_id')
\gset
SELECT to_jsonb(review_case)::TEXT AS admin_a_conflict_review_case
FROM platform.admin_work_review_cases(:'org_a_id') AS review_case
WHERE to_jsonb(review_case)::TEXT ~ 'conflict'
LIMIT 1
\gset
SELECT to_jsonb(review_case)::TEXT AS admin_a_unknown_review_case
FROM platform.admin_work_review_cases(:'org_a_id') AS review_case
WHERE to_jsonb(review_case)::TEXT ~ 'unknown'
LIMIT 1
\gset
SELECT count(*)::TEXT AS admin_a_conflict_case_count
FROM platform.admin_work_review_cases(:'org_a_id') AS review_case
WHERE to_jsonb(review_case)::TEXT ~ 'conflict'
\gset
SELECT count(*)::TEXT AS admin_a_unknown_case_count
FROM platform.admin_work_review_cases(:'org_a_id') AS review_case
WHERE to_jsonb(review_case)::TEXT ~ 'unknown'
\gset
RESET ROLE;

SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.admin_work_review_cases(:'org_a_id');
\set admin_b_review_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.admin_work_review_cases(:'org_a_id');
\set sales_review_read_state :SQLSTATE
SELECT platform.resolve_work_review_case(
  :'org_a_id',
  COALESCE(
    (:'admin_a_conflict_review_case'::JSONB ->> 'work_review_case_id')::UUID,
    (:'admin_a_conflict_review_case'::JSONB ->> 'case_id')::UUID,
    (:'admin_a_conflict_review_case'::JSONB ->> 'id')::UUID
  ),
  CAST(:'conflict_review_resolution' AS platform.work_review_resolution),
  'Non-admin resolution attempt',
  '45000000-0000-4000-8000-000000000331'
);
\set sales_review_resolve_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.admin_work_review_cases(:'org_a_id');
\set student_review_read_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'admin_a_claims';
SET ROLE authenticated;
SELECT platform.resolve_work_review_case(
  :'org_a_id',
  COALESCE(
    (:'admin_a_conflict_review_case'::JSONB ->> 'work_review_case_id')::UUID,
    (:'admin_a_conflict_review_case'::JSONB ->> 'case_id')::UUID,
    (:'admin_a_conflict_review_case'::JSONB ->> 'id')::UUID
  ),
  CAST(:'conflict_review_resolution' AS platform.work_review_resolution),
  'Synthetic admin resolution',
  '45000000-0000-4000-8000-000000000332'
)::TEXT AS review_resolution_result
\gset
SELECT count(*)::TEXT AS admin_a_review_case_count_after_resolution
FROM platform.admin_work_review_cases(:'org_a_id')
\gset
RESET ROLE;

SELECT count(*)::TEXT AS after_dead_letter_count
FROM platform_private.durable_work_dead_letters
\gset

SELECT count(*)::TEXT AS after_total_work_item_count
FROM platform_private.durable_work_items
\gset

SELECT pg_temp.assert_true(
  :'enqueue_stale_webhook_state' <> '00000'
    AND :'enqueue_webhook_mismatch_state' <> '00000'
    AND :'after_webhook_enqueue_count'::INTEGER =
        :'baseline_work_item_count'::INTEGER + 1
    AND COALESCE(
      (:'conflict_claim_while_leased'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND :'finish_webhook_unknown_state' <> '00000'
    AND :'finish_ai_unknown_state' <> '00000'
    AND :'extend_ai_wrong_attempt_state' <> '00000'
    AND :'enqueue_manual_multiple_attempts_state' <> '00000'
    AND :'finish_manual_conflict_state' <> '00000'
    AND COALESCE(
      (:'conflict_claim_after_finish'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND COALESCE(
      (:'ai_claim_immediate_reclaim'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND (:'ai_claim_second'::JSONB ->> 'work_item_id') =
        :'ai_work_item_id'
    AND (:'ai_claim_second'::JSONB ->> 'attempt_id') <>
        :'ai_attempt_id_first'
    AND COALESCE(
      (:'ai_claim_after_success'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND COALESCE(
      (:'manual_claim_after_unknown'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND COALESCE(
      (:'dlq_claim_after_finish'::JSONB ->> 'claimed')::BOOLEAN,
      FALSE
    ) = FALSE
    AND :'after_dead_letter_count'::INTEGER =
        :'baseline_dead_letter_count'::INTEGER + 1
    AND :'admin_a_review_case_count'::INTEGER =
        :'baseline_review_case_count'::INTEGER + 2
    AND :'admin_a_conflict_case_count'::INTEGER = 1
    AND :'admin_a_unknown_case_count'::INTEGER = 1
    AND :'admin_b_review_cross_org_state' <> '00000'
    AND :'sales_review_read_state' <> '00000'
    AND :'sales_review_resolve_state' <> '00000'
    AND :'student_review_read_state' <> '00000'
    AND :'admin_a_review_case_count_after_resolution'::INTEGER IN (
      :'admin_a_review_case_count'::INTEGER,
      :'admin_a_review_case_count'::INTEGER - 1
    )
    AND :'after_total_work_item_count'::INTEGER =
        :'baseline_work_item_count'::INTEGER + 4,
  'P2G queue replay/retry/manual-review/dead-letter contract failed'
);

SELECT pg_temp.assert_true(
  (:'conflict_payload'::JSONB ? 'v')
    AND (:'conflict_payload'::JSONB ? 'work_item_id')
    AND (:'conflict_payload'::JSONB ? 'kind')
    AND (
      :'conflict_payload'::JSONB
        - ARRAY['v', 'work_item_id', 'kind']
    ) = '{}'::JSONB,
  'P2G queue payload is not the exact pointer-only {v,work_item_id,kind} body'
);

SELECT pg_temp.assert_true(
  COALESCE(
    :'admin_a_conflict_review_case'::JSONB ->> 'status',
    :'admin_a_conflict_review_case'::JSONB ->> 'review_status'
  ) = :'review_status_open'
    AND COALESCE(
      :'admin_a_conflict_review_case'::JSONB ->> 'kind',
      :'admin_a_conflict_review_case'::JSONB ->> 'review_kind'
    ) ~ 'conflict'
    AND COALESCE(
      :'admin_a_unknown_review_case'::JSONB ->> 'kind',
      :'admin_a_unknown_review_case'::JSONB ->> 'review_kind'
    ) ~ 'unknown',
  'P2G manual-review kinds/statuses drifted from conflict+unknown open cases'
);

\echo 'P2G queue/review RLS acceptance passed'
