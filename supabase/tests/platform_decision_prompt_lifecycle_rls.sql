\set ON_ERROR_STOP on

-- BW4 authorization and lifecycle proof. This suite reuses only synthetic
-- rows created by the earlier disposable migration-boundary tests. It never
-- calls an external provider and never imports customer data.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'BW4 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

-- Resolve every identity from durable fixture rows because each boundary
-- test runs in a fresh psql session. Claims always carry the current access
-- version produced by migration 054 unless a test deliberately makes it stale.
SELECT
  membership.organization_id AS bw4_org_a,
  membership.id AS bw4_admin_a_membership,
  profile.auth_user_id AS bw4_admin_a_user,
  profile.access_version AS bw4_admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000001'
\gset

SELECT
  membership.organization_id AS bw4_org_b,
  membership.id AS bw4_admin_b_membership,
  profile.auth_user_id AS bw4_admin_b_user,
  profile.access_version AS bw4_admin_b_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS bw4_case_a,
  student_case.current_curator_membership_id AS bw4_curator_a_membership,
  student_case.responsible_sales_membership_id AS bw4_sales_a_membership
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw4_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT student_case.id AS bw4_case_b
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'bw4_org_a'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT conversation.id AS bw4_conversation_a
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'bw4_org_a'
  AND conversation.student_case_id = :'bw4_case_a'
  AND conversation.status = 'open'
ORDER BY conversation.created_at, conversation.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS bw4_curator_a_user,
  profile.access_version AS bw4_curator_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw4_org_a'
  AND membership.id = :'bw4_curator_a_membership'
\gset

SELECT
  profile.auth_user_id AS bw4_sales_a_user,
  profile.access_version AS bw4_sales_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw4_org_a'
  AND membership.id = :'bw4_sales_a_membership'
\gset

SELECT
  profile.auth_user_id AS bw4_finance_a_user,
  profile.access_version AS bw4_finance_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw4_org_a'
  AND membership."current_role" = 'finance'
  AND membership.status = 'active'
ORDER BY membership.created_at, membership.id
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS bw4_student_a_user,
  profile.access_version AS bw4_student_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw4_org_a'
  AND membership."current_role" = 'student'
  AND membership.status = 'active'
ORDER BY membership.created_at, membership.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', :'bw4_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'bw4_admin_a_access_version'::BIGINT
)::TEXT AS bw4_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_admin_b_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'bw4_admin_b_access_version'::BIGINT
)::TEXT AS bw4_admin_b_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_admin_a_user',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version',
    (:'bw4_admin_a_access_version'::BIGINT - 1)
)::TEXT AS bw4_stale_admin_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_curator_a_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'bw4_curator_a_access_version'::BIGINT
)::TEXT AS bw4_curator_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_sales_a_user',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'bw4_sales_a_access_version'::BIGINT
)::TEXT AS bw4_sales_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_finance_a_user',
  'role', 'authenticated',
  'platform_role', 'finance',
  'platform_access_version', :'bw4_finance_a_access_version'::BIGINT
)::TEXT AS bw4_finance_a_claims
\gset
SELECT jsonb_build_object(
  'sub', :'bw4_student_a_user',
  'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', :'bw4_student_a_access_version'::BIGINT
)::TEXT AS bw4_student_a_claims
\gset

-- Create a dedicated reviewed, PII-free evidence source in the same tenant as
-- the communication fixture. Earlier suites intentionally use other tenants.
SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
SELECT platform.register_workflow_source(
  :'bw4_org_a',
  'src_44444444444444444444444444444444',
  'google_document',
  'https://docs.google.com/document/d/bw4-synthetic-evidence/edit',
  'revision20260802bw4',
  'Register synthetic BW4 evidence source',
  '54000000-0000-4000-8000-000000000501'
)::TEXT AS bw4_reviewed_source
\gset
SELECT platform.review_workflow_source(
  :'bw4_org_a',
  :'bw4_reviewed_source',
  'reviewed',
  'Approve synthetic BW4 evidence source',
  '54000000-0000-4000-8000-000000000502'
);
RESET ROLE;

-- Create the no-case conversation through the real service RPC so its Sales
-- owner receives a fresh conversation scope and access-version rotation.
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
SELECT
  '54000000-0000-4000-8000-000000000811',
  event.organization_id,
  event.provider,
  event.provider_account_ref,
  event.provider_conversation_ref,
  event.provider_event_variant_ref,
  'bw4-synthetic-provider-request-811',
  'synthetic-bw4-no-case-session',
  'bw4-synthetic-payload-811',
  event.event_type,
  statement_timestamp(),
  'verified',
  '{"synthetic":true,"boundary":"bw4-no-case"}'::JSONB,
  '{}'::JSONB,
  'synthetic:verification:bw4:no-case',
  encode(
    sha256(
      convert_to(
        '{"synthetic":true,"boundary":"bw4-no-case"}',
        'UTF8'
      )
    ),
    'hex'
  ),
  '54000000-0000-4000-8000-000000000812'
FROM platform_private.provider_webhook_events AS event
WHERE event.organization_id = :'bw4_org_a'
  AND event.provider = 'waha'
  AND event.verification_status = 'verified'
ORDER BY event.received_at DESC, event.id DESC
LIMIT 1;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.create_communication_conversation(
  :'bw4_org_a',
  NULL,
  :'bw4_sales_a_membership',
  'Synthetic BW4 no-case conversation',
  'synthetic-bw4-no-case-session',
  940001,
  'synthetic-bw4-no-case-conversation',
  950001,
  960001,
  970001,
  '54000000-0000-4000-8000-000000000811',
  '54000000-0000-4000-8000-000000000813'
)::TEXT AS bw4_no_case_conversation
\gset
RESET ROLE;

SELECT
  (:'bw4_no_case_conversation'::JSONB
    ->> 'communication_conversation_id') AS bw4_no_case_conversation_id
\gset

SELECT jsonb_build_object(
  'sub', profile.auth_user_id,
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version
)::TEXT AS bw4_sales_a_claims
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'bw4_org_a'
  AND membership.id = :'bw4_sales_a_membership'
\gset

-- Admin creates the immutable anchor and first unresolved version. An exact
-- request replay returns the same identifiers, while changed input under the
-- same UUID fails instead of silently accepting a different mutation.
SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a',
  :'bw4_conversation_a',
  :'bw4_case_a',
  'Which synthetic admissions route is approved?',
  'admin',
  'general',
  NULL,
  NULL,
  NULL,
  NULL,
  'Create synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000101'
)::TEXT AS bw4_decision_created
\gset
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a',
  :'bw4_conversation_a',
  :'bw4_case_a',
  'Which synthetic admissions route is approved?',
  'admin',
  'general',
  NULL,
  NULL,
  NULL,
  NULL,
  'Create synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000101'
)::TEXT AS bw4_decision_replay
\gset
RESET ROLE;

SELECT
  (:'bw4_decision_created'::JSONB ->> 'decision_backlog_id')
    AS bw4_decision_id
\gset

SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a',
  'Changed question under the same request UUID?',
  'admin', 'general', NULL, NULL, NULL, NULL,
  'Create synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000101'
);
\set bw4_changed_replay_state :SQLSTATE
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_b',
  'Cross-case decision must fail',
  'admin', 'general', NULL, NULL, NULL, NULL,
  'Reject synthetic cross-case decision',
  '54000000-0000-4000-8000-000000000102'
);
\set bw4_cross_case_state :SQLSTATE
SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_decision_id', 2,
  'answered',
  'Which synthetic admissions route is approved?',
  'Synthetic reviewed BW4 answer.',
  'admin', 'general', NULL, NULL,
  :'bw4_reviewed_source', 'synthetic:evidence:bw4:answer',
  'Answer synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000103'
);
\set bw4_optimistic_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_decision_id', 1,
  'answered',
  'Which synthetic admissions route is approved?',
  'Synthetic reviewed BW4 answer.',
  'admin', 'general', NULL, NULL,
  :'bw4_reviewed_source', 'synthetic:evidence:bw4:answer',
  'Answer synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000104'
)::TEXT AS bw4_decision_answered
\gset
SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_decision_id', 2,
  'retired',
  'Which synthetic admissions route is approved?',
  'Synthetic reviewed BW4 answer.',
  'admin', 'general', NULL, NULL,
  :'bw4_reviewed_source', 'synthetic:evidence:bw4:answer',
  'Retire synthetic BW4 decision',
  '54000000-0000-4000-8000-000000000105'
)::TEXT AS bw4_decision_retired
\gset
\set ON_ERROR_STOP off
SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_decision_id', 3,
  'unresolved',
  'Which synthetic admissions route is approved?',
  NULL,
  'admin', 'general', NULL, NULL,
  NULL, NULL,
  'Retired decisions are terminal',
  '54000000-0000-4000-8000-000000000106'
);
\set bw4_retired_terminal_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- A non-Admin may never forge another role as the decision owner even if the
-- caller otherwise owns the live conversation.
SET request.jwt.claims TO :'bw4_curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a',
  'Curator owner forgery must fail',
  'sales', 'general', NULL, NULL, NULL, NULL,
  'Reject synthetic owner forgery',
  '54000000-0000-4000-8000-000000000107'
);
\set bw4_owner_forgery_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Stale claims, another tenant, Finance, and Student all fail before any
-- decision content is returned. Browser roles also lack direct table writes.
SET request.jwt.claims TO :'bw4_stale_admin_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
);
\set bw4_stale_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_admin_b_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
);
\set bw4_cross_org_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_finance_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
);
\set bw4_finance_workspace_state :SQLSTATE
INSERT INTO platform.decision_backlogs (
  organization_id, conversation_id, student_case_id
) VALUES (
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a'
);
\set bw4_direct_insert_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_student_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
);
\set bw4_student_workspace_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
)::TEXT AS bw4_workspace_a
\gset
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_no_case_conversation_id'
)::TEXT AS bw4_workspace_no_case
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw4_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
)::TEXT AS bw4_workspace_curator
\gset
RESET ROLE;

SET request.jwt.claims TO :'bw4_sales_a_claims';
SET ROLE authenticated;
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_no_case_conversation_id'
)::TEXT AS bw4_workspace_sales_no_case
\gset
RESET ROLE;

-- Raw prompt content stays backend-private. Anonymous and non-Admin callers
-- cannot execute the Admin catalog; an authorized Admin receives metadata,
-- never the stored prompt-policy or business-context body.
SET request.jwt.claims TO '{"role":"anon"}';
SET ROLE anon;
\set ON_ERROR_STOP off
SELECT platform.admin_ai_prompt_artifact_catalog(:'bw4_org_b');
\set bw4_anon_prompt_catalog_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_sales_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.admin_ai_prompt_artifact_catalog(:'bw4_org_a');
\set bw4_non_admin_prompt_catalog_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'bw4_admin_b_claims';
SET ROLE authenticated;
SELECT platform.publish_ai_prompt_artifact_version(
  :'bw4_org_b',
  'prompt_policy',
  'Synthetic Lead Manager Prompt Policy v1',
  'BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK policy content',
  'synthetic:prompt-policy:bw4:v1',
  'Publish synthetic BW4 prompt policy',
  '54000000-0000-4000-8000-000000000201'
)::TEXT AS bw4_prompt_policy
\gset
SELECT platform.publish_ai_prompt_artifact_version(
  :'bw4_org_b',
  'business_context',
  'Synthetic EVO Business Context v1',
  'BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK business context',
  'synthetic:business-context:bw4:v1',
  'Publish synthetic BW4 business context',
  '54000000-0000-4000-8000-000000000202'
)::TEXT AS bw4_business_context
\gset
SELECT platform.admin_ai_prompt_artifact_catalog(:'bw4_org_b')::TEXT
  AS bw4_prompt_catalog
\gset
RESET ROLE;

SELECT
  (:'bw4_prompt_policy'::JSONB ->> 'prompt_artifact_version_id')
    AS bw4_prompt_policy_id,
  (:'bw4_business_context'::JSONB ->> 'prompt_artifact_version_id')
    AS bw4_business_context_id
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.ai_prompt_artifact_versions;
\set bw4_service_raw_prompt_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Add one new synthetic inbound message to the already provider-ready org B
-- conversation. The row is copied from the existing provider shape so this
-- remains a database-only fixture with no network or provider assertion.
SELECT
  conversation.id AS bw4_conversation_b,
  conversation.student_case_id AS bw4_case_org_b
FROM platform.communication_conversations AS conversation
JOIN platform.student_cases AS student_case
  ON student_case.organization_id = conversation.organization_id
  AND student_case.id = conversation.student_case_id
WHERE conversation.organization_id = :'bw4_org_b'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
  AND conversation.status = 'open'
ORDER BY conversation.created_at, conversation.id
LIMIT 1
\gset

SELECT participant.id AS bw4_customer_participant_b
FROM platform.conversation_participants AS participant
WHERE participant.organization_id = :'bw4_org_b'
  AND participant.conversation_id = :'bw4_conversation_b'
  AND participant.participant_kind = 'customer'
ORDER BY participant.created_at, participant.id
LIMIT 1
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
SELECT
  '54000000-0000-4000-8000-000000000701',
  event.organization_id,
  event.provider,
  event.provider_account_ref,
  event.provider_conversation_ref,
  event.provider_event_variant_ref,
  'bw4-synthetic-provider-request-701',
  event.waha_session_name,
  'bw4-synthetic-payload-701',
  event.event_type,
  statement_timestamp(),
  'verified',
  '{"synthetic":true,"boundary":"bw4"}'::JSONB,
  '{}'::JSONB,
  'synthetic:verification:bw4:701',
  encode(
    sha256(convert_to('{"synthetic":true,"boundary":"bw4"}', 'UTF8')),
    'hex'
  ),
  '54000000-0000-4000-8000-000000000702'
FROM platform_private.provider_webhook_events AS event
WHERE event.organization_id = :'bw4_org_b'
  AND event.provider = 'waha'
  AND event.verification_status = 'verified'
ORDER BY event.received_at DESC, event.id DESC
LIMIT 1;

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
SELECT
  '54000000-0000-4000-8000-000000000703',
  message.organization_id,
  message.conversation_id,
  message.student_case_id,
  :'bw4_customer_participant_b',
  'inbound',
  'Synthetic BW4 prompt pin request.',
  'en',
  FALSE,
  message.waha_session_name,
  'bw4-synthetic-waha-message-703',
  message.kommo_account_id,
  NULL,
  NULL,
  message.amocrm_account_id,
  message.amocrm_lead_id,
  message.amocrm_contact_id,
  '54000000-0000-4000-8000-000000000701',
  NULL,
  statement_timestamp()
FROM platform.communication_messages AS message
WHERE message.organization_id = :'bw4_org_b'
  AND message.conversation_id = :'bw4_conversation_b'
  AND message.direction = 'inbound'
ORDER BY message.created_at DESC, message.id DESC
LIMIT 1;

SELECT knowledge.id AS bw4_org_b_knowledge
FROM platform.approved_knowledge_versions AS knowledge
WHERE knowledge.organization_id = :'bw4_org_b'
  AND knowledge.status = 'approved'
ORDER BY knowledge.version DESC, knowledge.approved_at DESC, knowledge.id DESC
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS bw4_curator_b_user,
  profile.access_version AS bw4_curator_b_access_version
FROM platform.communication_conversations AS conversation
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = conversation.organization_id
  AND membership.id = conversation.current_curator_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE conversation.organization_id = :'bw4_org_b'
  AND conversation.id = :'bw4_conversation_b'
\gset

SELECT jsonb_build_object(
  'sub', :'bw4_curator_b_user',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'bw4_curator_b_access_version'::BIGINT
)::TEXT AS bw4_curator_b_claims
\gset

SET request.jwt.claims TO :'bw4_curator_b_claims';
SET ROLE authenticated;
SELECT platform.request_ai_draft_with_knowledge(
  :'bw4_org_b',
  :'bw4_conversation_b',
  '54000000-0000-4000-8000-000000000703',
  'en',
  :'bw4_org_b_knowledge',
  'Request synthetic BW4 pinned AI draft',
  '54000000-0000-4000-8000-000000000704'
)::TEXT AS bw4_ai_request
\gset
RESET ROLE;

SELECT
  (:'bw4_ai_request'::JSONB ->> 'ai_draft_request_id') AS bw4_ai_request_id
\gset

SELECT pg_temp.assert_true(
  (
    SELECT selection.prompt_policy_artifact_version_id =
        :'bw4_prompt_policy_id'
      AND selection.business_context_artifact_version_id =
        :'bw4_business_context_id'
    FROM platform.ai_draft_request_prompt_selections AS selection
    WHERE selection.organization_id = :'bw4_org_b'
      AND selection.ai_draft_request_id = :'bw4_ai_request_id'
  ),
  'AI request did not persist the exact approved prompt artifact pins'
);

SET request.jwt.claims TO :'bw4_admin_b_claims';
SET ROLE authenticated;
SELECT platform.retire_ai_prompt_artifact_version(
  :'bw4_org_b',
  :'bw4_prompt_policy_id',
  1,
  'Retire pinned policy after request',
  '54000000-0000-4000-8000-000000000705'
)::TEXT AS bw4_prompt_policy_retired
\gset
SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_b', :'bw4_conversation_b'
)::TEXT AS bw4_workspace_b
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  jsonb_typeof(
    :'bw4_workspace_a'::JSONB -> 'available_requirements'
  ) = 'array'
    AND jsonb_array_length(
      :'bw4_workspace_a'::JSONB -> 'available_requirements'
    ) = (
      SELECT count(*)
      FROM (
        SELECT country_version.id
        FROM platform.student_cases AS student_case
        JOIN platform.country_requirement_versions AS country_version
          ON country_version.organization_id = student_case.organization_id
          AND country_version.id =
            student_case.applied_country_requirement_version_id
        WHERE student_case.organization_id = :'bw4_org_a'
          AND student_case.id = :'bw4_case_a'
        UNION ALL
        SELECT slot.requirement_id
        FROM platform.document_slots AS slot
        WHERE slot.organization_id = :'bw4_org_a'
          AND slot.student_case_id = :'bw4_case_a'
      ) AS expected_requirement
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_workspace_a'::JSONB -> 'available_requirements'
      ) AS item(value)
      WHERE (
        SELECT count(*)
        FROM jsonb_object_keys(item.value)
      ) <> 3
        OR NOT item.value ?& ARRAY[
          'requirement_kind', 'requirement_id', 'label'
        ]
        OR char_length(item.value ->> 'label') NOT BETWEEN 1 AND 240
        OR (
          item.value ->> 'requirement_kind' = 'country_requirement'
          AND NOT EXISTS (
            SELECT 1
            FROM platform.student_cases AS student_case
            WHERE student_case.organization_id = :'bw4_org_a'
              AND student_case.id = :'bw4_case_a'
              AND student_case.applied_country_requirement_version_id =
                (item.value ->> 'requirement_id')::UUID
          )
        )
        OR (
          item.value ->> 'requirement_kind' = 'document_requirement'
          AND NOT EXISTS (
            SELECT 1
            FROM platform.document_slots AS slot
            WHERE slot.organization_id = :'bw4_org_a'
              AND slot.student_case_id = :'bw4_case_a'
              AND slot.requirement_id =
                (item.value ->> 'requirement_id')::UUID
          )
        )
        OR item.value ->> 'requirement_kind' NOT IN (
          'country_requirement', 'document_requirement'
        )
    )
    AND :'bw4_workspace_no_case'::JSONB -> 'student_case_id' = 'null'::JSONB
    AND :'bw4_workspace_no_case'::JSONB -> 'available_requirements' =
      '[]'::JSONB
    AND :'bw4_workspace_curator'::JSONB -> 'available_requirements' =
      :'bw4_workspace_a'::JSONB -> 'available_requirements'
    AND :'bw4_workspace_curator'::JSONB ->> 'actor_role' = 'curator'
    AND :'bw4_workspace_sales_no_case'::JSONB -> 'available_requirements' =
      '[]'::JSONB
    AND :'bw4_workspace_sales_no_case'::JSONB ->> 'actor_role' = 'sales'
    AND :'bw4_workspace_sales_no_case'::JSONB -> 'allowed_owner_roles' =
      '["sales"]'::JSONB,
  'available requirements escaped the exact bound case or no-case shape'
);

SELECT pg_temp.assert_true(
  (:'bw4_decision_created'::JSONB ->> 'decision_backlog_id') =
    (:'bw4_decision_replay'::JSONB ->> 'decision_backlog_id')
    AND :'bw4_changed_replay_state' = '22023'
    AND :'bw4_cross_case_state' = '42501'
    AND :'bw4_optimistic_state' = '40001'
    AND (:'bw4_decision_answered'::JSONB ->> 'status') = 'answered'
    AND (:'bw4_decision_retired'::JSONB ->> 'status') = 'retired'
    AND :'bw4_retired_terminal_state' = '22023'
    AND :'bw4_owner_forgery_state' = '42501'
    AND :'bw4_stale_workspace_state' = '42501'
    AND :'bw4_cross_org_workspace_state' = '42501'
    AND :'bw4_finance_workspace_state' = '42501'
    AND :'bw4_student_workspace_state' = '42501'
    AND :'bw4_direct_insert_state' = '42501'
    AND :'bw4_service_raw_prompt_state' = '42501'
    AND :'bw4_anon_prompt_catalog_state' = '42501'
    AND :'bw4_non_admin_prompt_catalog_state' = '42501'
    AND position(
      'BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK'
      IN :'bw4_prompt_catalog'
    ) = 0
    AND :'bw4_prompt_catalog'::JSONB ->> 'organization_id' = :'bw4_org_b'
    AND :'bw4_prompt_catalog'::JSONB ->> 'artifact_key' =
      'lead_manager.default'
    AND jsonb_array_length(
      :'bw4_prompt_catalog'::JSONB -> 'artifacts'
    ) = 2
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_prompt_catalog'::JSONB -> 'artifacts'
      ) AS artifact(value)
      CROSS JOIN LATERAL jsonb_object_keys(artifact.value) AS field(key)
      WHERE field.key NOT IN (
        'prompt_artifact_version_id',
        'artifact_kind',
        'artifact_key',
        'title',
        'version',
        'status',
        'content_sha256',
        'provenance_ref',
        'approved_at',
        'retired_at',
        'created_at'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_prompt_catalog'::JSONB -> 'artifacts'
      ) AS artifact(value)
      WHERE NOT (
        artifact.value ? 'prompt_artifact_version_id'
        AND artifact.value ? 'artifact_kind'
        AND artifact.value ? 'artifact_key'
        AND artifact.value ? 'title'
        AND artifact.value ? 'version'
        AND artifact.value ? 'status'
        AND artifact.value ? 'content_sha256'
        AND artifact.value ? 'provenance_ref'
        AND artifact.value ? 'approved_at'
        AND artifact.value ? 'retired_at'
        AND artifact.value ? 'created_at'
        AND artifact.value ->> 'artifact_key' = 'lead_manager.default'
        AND artifact.value ->> 'status' = 'approved'
        AND artifact.value ->> 'content_sha256' ~ '^[0-9a-f]{64}$'
      )
    )
    AND (
      SELECT array_agg(
        artifact.value ->> 'artifact_kind'
        ORDER BY artifact.value ->> 'artifact_kind'
      )
      FROM jsonb_array_elements(
        :'bw4_prompt_catalog'::JSONB -> 'artifacts'
      ) AS artifact(value)
    ) = ARRAY['business_context', 'prompt_policy']::TEXT[]
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_prompt_catalog'::JSONB -> 'artifacts'
      ) AS artifact(value)
      WHERE artifact.value ->> 'prompt_artifact_version_id' =
        :'bw4_prompt_policy_id'
        AND artifact.value ->> 'artifact_kind' = 'prompt_policy'
        AND artifact.value ->> 'title' =
          'Synthetic Lead Manager Prompt Policy v1'
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_prompt_catalog'::JSONB -> 'artifacts'
      ) AS artifact(value)
      WHERE artifact.value ->> 'prompt_artifact_version_id' =
        :'bw4_business_context_id'
        AND artifact.value ->> 'artifact_kind' = 'business_context'
        AND artifact.value ->> 'title' =
          'Synthetic EVO Business Context v1'
    )
    AND position(
      'BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK'
      IN :'bw4_workspace_b'
    ) = 0
    AND (
      :'bw4_workspace_b'::JSONB
        -> 'pinned_prompt_artifacts'
        -> 'prompt_policy'
        ->> 'prompt_artifact_version_id'
    ) = :'bw4_prompt_policy_id'
    AND (
      :'bw4_workspace_b'::JSONB
        -> 'pinned_prompt_artifacts'
        -> 'prompt_policy'
        ->> 'status'
    ) = 'retired'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS audit
      WHERE audit.organization_id IN (:'bw4_org_a', :'bw4_org_b')
        AND (
          COALESCE(audit.before_state, '{}'::JSONB)::TEXT
          || COALESCE(audit.after_state, '{}'::JSONB)::TEXT
          || COALESCE(audit.reason, '')
        ) LIKE '%BW4_RAW_PROMPT_SENTINEL_MUST_NOT_LEAK%'
    ),
  'BW4 lifecycle, authorization, prompt pin, or raw-content boundary failed'
);

-- The repository deliberately accepts at most 100 decisions per conversation
-- and 100 immutable versions per decision. Exercise those exact database
-- boundaries through the authenticated RPCs so a valid 101st row can never
-- make the whole workspace projection fail closed in the application.
CREATE OR REPLACE FUNCTION pg_temp.seed_bw4_decision_entry_boundary(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_student_case_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  item INTEGER;
BEGIN
  FOR item IN 2..100 LOOP
    PERFORM platform.create_decision_backlog_entry(
      p_organization_id,
      p_conversation_id,
      p_student_case_id,
      format('Bounded decision %s', item),
      'admin',
      'general',
      NULL,
      NULL,
      NULL,
      NULL,
      format('Create bounded decision %s', item),
      (
        '54000000-0000-4000-8100-'
        || lpad(item::TEXT, 12, '0')
      )::UUID
    );
  END LOOP;
  RETURN 99;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.seed_bw4_decision_version_boundary(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_decision_backlog_id UUID,
  p_source_registry_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  item INTEGER;
BEGIN
  FOR item IN 2..100 LOOP
    PERFORM platform.transition_decision_backlog_entry(
      p_organization_id,
      p_conversation_id,
      p_decision_backlog_id,
      item - 1,
      (
        CASE WHEN item % 2 = 0 THEN 'answered' ELSE 'unresolved' END
      )::platform.decision_backlog_status,
      'Bounded decision 100',
      CASE
        WHEN item % 2 = 0 THEN 'Synthetic bounded answer.'
        ELSE NULL
      END,
      'admin',
      'general',
      NULL,
      NULL,
      CASE WHEN item % 2 = 0 THEN p_source_registry_id ELSE NULL END,
      CASE
        WHEN item % 2 = 0 THEN 'synthetic:evidence:bw4:boundary'
        ELSE NULL
      END,
      format('Append bounded decision version %s', item),
      (
        '54000000-0000-4000-8200-'
        || lpad(item::TEXT, 12, '0')
      )::UUID
    );
  END LOOP;
  RETURN 99;
END
$$;

GRANT EXECUTE ON FUNCTION
  pg_temp.seed_bw4_decision_entry_boundary(UUID, UUID, UUID),
  pg_temp.seed_bw4_decision_version_boundary(UUID, UUID, UUID, UUID)
TO authenticated;

SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
SELECT pg_temp.seed_bw4_decision_entry_boundary(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a'
) AS bw4_bounded_entries_seeded
\gset
RESET ROLE;

SELECT backlog.id AS bw4_bounded_decision_id
FROM platform.decision_backlogs AS backlog
JOIN platform.decision_backlog_versions AS version
  ON version.organization_id = backlog.organization_id
  AND version.decision_backlog_id = backlog.id
  AND version.effective_version = 1
WHERE backlog.organization_id = :'bw4_org_a'
  AND backlog.conversation_id = :'bw4_conversation_a'
  AND version.question = 'Bounded decision 100'
\gset

SET request.jwt.claims TO :'bw4_admin_a_claims';
SET ROLE authenticated;
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a',
  'Bounded decision 100',
  'admin', 'general', NULL, NULL, NULL, NULL,
  'Create bounded decision 100',
  '54000000-0000-4000-8100-000000000100'
)::TEXT AS bw4_bounded_entry_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.create_decision_backlog_entry(
  :'bw4_org_a', :'bw4_conversation_a', :'bw4_case_a',
  'Bounded decision 101 must fail',
  'admin', 'general', NULL, NULL, NULL, NULL,
  'Reject bounded decision 101',
  '54000000-0000-4000-8101-000000000101'
);
\set bw4_entry_101_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.seed_bw4_decision_version_boundary(
  :'bw4_org_a',
  :'bw4_conversation_a',
  :'bw4_bounded_decision_id',
  :'bw4_reviewed_source'
) AS bw4_bounded_versions_seeded
\gset

SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a',
  :'bw4_conversation_a',
  :'bw4_bounded_decision_id',
  99,
  'answered',
  'Bounded decision 100',
  'Synthetic bounded answer.',
  'admin',
  'general',
  NULL,
  NULL,
  :'bw4_reviewed_source',
  'synthetic:evidence:bw4:boundary',
  'Append bounded decision version 100',
  '54000000-0000-4000-8200-000000000100'
)::TEXT AS bw4_bounded_version_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.transition_decision_backlog_entry(
  :'bw4_org_a',
  :'bw4_conversation_a',
  :'bw4_bounded_decision_id',
  100,
  'unresolved',
  'Bounded decision 100',
  NULL,
  'admin',
  'general',
  NULL,
  NULL,
  NULL,
  NULL,
  'Reject bounded decision version 101',
  '54000000-0000-4000-8201-000000000101'
);
\set bw4_version_101_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.staff_conversation_bw4_workspace(
  :'bw4_org_a', :'bw4_conversation_a'
)::TEXT AS bw4_workspace_at_boundary
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'bw4_bounded_entries_seeded' = '99'
    AND :'bw4_bounded_versions_seeded' = '99'
    AND :'bw4_entry_101_state' = '22023'
    AND :'bw4_version_101_state' = '22023'
    AND (
      :'bw4_bounded_entry_replay'::JSONB ->> 'decision_backlog_id'
    ) = :'bw4_bounded_decision_id'
    AND (
      :'bw4_bounded_version_replay'::JSONB ->> 'effective_version'
    ) = '100'
    AND jsonb_array_length(
      :'bw4_workspace_at_boundary'::JSONB -> 'decisions'
    ) = 100
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_workspace_at_boundary'::JSONB -> 'decisions'
      ) AS decision(value)
      WHERE decision.value ->> 'decision_backlog_id' =
          :'bw4_bounded_decision_id'
        AND decision.value ->> 'current_effective_version' = '100'
        AND jsonb_array_length(decision.value -> 'versions') = 100
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        :'bw4_workspace_at_boundary'::JSONB -> 'decisions'
      ) AS decision(value)
      CROSS JOIN LATERAL jsonb_array_elements(
        decision.value -> 'versions'
      ) AS version(value)
      WHERE version.value ->> 'status' = 'unresolved'
    )
    AND :'bw4_workspace_at_boundary'::JSONB -> 'handoff' =
      :'bw4_workspace_a'::JSONB -> 'handoff'
    AND :'bw4_workspace_at_boundary'::JSONB -> 'reviewed_sources' =
      :'bw4_workspace_a'::JSONB -> 'reviewed_sources'
    AND :'bw4_workspace_at_boundary'::JSONB -> 'active_prompt_artifacts' =
      :'bw4_workspace_a'::JSONB -> 'active_prompt_artifacts'
    AND :'bw4_workspace_at_boundary'::JSONB -> 'allowed_owner_roles' =
      :'bw4_workspace_a'::JSONB -> 'allowed_owner_roles'
    AND (
      :'bw4_workspace_at_boundary'::JSONB ->> 'can_manage_decisions'
    )::BOOLEAN,
  '100-entry/version boundary hid decisions, evidence, handoff, or controls'
);

\echo 'BW4 decision and prompt lifecycle RLS acceptance passed'
