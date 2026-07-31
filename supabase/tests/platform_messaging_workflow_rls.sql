\set ON_ERROR_STOP on

-- P3C runs after migration 050 against the synthetic P2F fixture rows that
-- were intentionally persisted by the earlier exact-boundary acceptance
-- suite. Re-resolve every identity from durable rows because each test file
-- executes in a fresh psql session.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P3C assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO service_role;

SELECT
  membership.organization_id AS org_b_id,
  profile.access_version AS admin_b_access_version
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000008'
\gset

SELECT
  student_case.id AS org_b_case_id,
  student_case.current_curator_membership_id
    AS org_b_current_curator_membership_id,
  student_case.responsible_sales_membership_id
    AS org_b_sales_membership_id
FROM platform.student_cases AS student_case
WHERE student_case.organization_id = :'org_b_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT conversation.id AS conversation_org_b_id
FROM platform.communication_conversations AS conversation
WHERE conversation.organization_id = :'org_b_id'
  AND conversation.student_case_id = :'org_b_case_id'
ORDER BY conversation.created_at
LIMIT 1
\gset

SELECT message.id AS message_org_b_id
FROM platform.communication_messages AS message
WHERE message.organization_id = :'org_b_id'
  AND message.conversation_id = :'conversation_org_b_id'
  AND message.direction = 'inbound'
ORDER BY message.created_at DESC, message.id DESC
LIMIT 1
\gset

SELECT
  profile.auth_user_id AS org_b_new_curator_user_id,
  profile.access_version AS org_b_new_curator_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_b_id'
  AND membership.id = :'org_b_current_curator_membership_id'
\gset

SELECT
  profile.auth_user_id AS org_b_sales_user_id,
  profile.access_version AS org_b_sales_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile
  ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_b_id'
  AND membership.id = :'org_b_sales_membership_id'
\gset

SELECT profile.access_version AS curator_a_access_version
FROM platform.profiles AS profile
WHERE profile.auth_user_id = '10000000-0000-4000-8000-000000000002'
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000008',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_b_access_version'::BIGINT
)::TEXT AS admin_b_claims
\gset

SELECT jsonb_build_object(
  'sub', :'org_b_new_curator_user_id',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'org_b_new_curator_access_version'::BIGINT
)::TEXT AS org_b_new_curator_after_reassignment_claims
\gset

SELECT jsonb_build_object(
  'sub', :'org_b_sales_user_id',
  'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', :'org_b_sales_access_version'::BIGINT
)::TEXT AS org_b_sales_after_assignment_claims
\gset

SELECT jsonb_build_object(
  'sub', '10000000-0000-4000-8000-000000000002',
  'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', :'curator_a_access_version'::BIGINT
)::TEXT AS curator_a_claims
\gset

-- P3C additive workflow: no-row health projects as unconfigured with nullable
-- evidence, only service_role may append health evidence, and authenticated
-- wrappers stay fail-closed until the latest health row is both ready and
-- provider-observed.
SET request.jwt.claims TO :'admin_b_claims';
SET ROLE authenticated;
SELECT platform.publish_approved_knowledge_version(
  :'org_b_id',
  'synthetic.orgb.admissions.general',
  'Synthetic org B admissions knowledge',
  1,
  'Synthetic org B approved knowledge v1.',
  encode(
    sha256(convert_to('Synthetic org B approved knowledge v1.', 'UTF8')),
    'hex'
  ),
  'synthetic:provenance:knowledge:org-b:v1',
  'Publish org B knowledge for P3C workflow proof',
  '44000000-0000-4000-8000-000000000601'
)::TEXT AS org_b_knowledge_v1_first
\gset
RESET ROLE;

SELECT
  (:'org_b_knowledge_v1_first'::JSONB
    ->> 'approved_knowledge_version_id') AS org_b_knowledge_v1_id
\gset

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT ai_readiness = 'unconfigured'
      AND ai_readiness_evidence_kind IS NULL
      AND NOT ai_readiness_fresh
      AND waha_readiness = 'unconfigured'
      AND waha_readiness_evidence_kind IS NULL
      AND NOT waha_readiness_fresh
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'default workflow health projection must stay unconfigured with nullable evidence'
);
\set ON_ERROR_STOP off
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'ai',
  'configured_unverified',
  'configuration_check',
  'Authenticated staff must not append health evidence',
  'synthetic:health:forbidden:user',
  '44000000-0000-4000-8000-000000000602'
);
\set p3c_health_record_user_state :SQLSTATE
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Unconfigured AI health must fail closed',
  '44000000-0000-4000-8000-000000000603'
);
\set p3c_ai_unconfigured_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

\set ON_ERROR_STOP off
INSERT INTO platform_private.messaging_integration_health_events (
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
VALUES (
  :'org_b_id',
  'ai',
  'ready',
  'provider_observed',
  'Synthetic future observation must be rejected',
  'synthetic:health:ai:future-rejected',
  '44000000-0000-4000-8000-000000000631',
  statement_timestamp() + INTERVAL '2 minutes'
);
\set p3c_future_health_state :SQLSTATE
\set ON_ERROR_STOP on

INSERT INTO platform_private.messaging_integration_health_events (
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
VALUES (
  :'org_b_id',
  'ai',
  'ready',
  'provider_observed',
  'Synthetic stale provider-observed AI readiness',
  'synthetic:health:ai:stale',
  '44000000-0000-4000-8000-000000000632',
  statement_timestamp() - INTERVAL '6 minutes'
);

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Stale provider-observed AI health must fail closed',
  '44000000-0000-4000-8000-000000000633'
);
\set p3c_ai_stale_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'ai',
  'configured_unverified',
  'configuration_check',
  'Synthetic AI configuration present but not provider-observed',
  'synthetic:health:ai:configured',
  '44000000-0000-4000-8000-000000000604'
)::TEXT AS p3c_ai_health_configured
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Configured-unverified AI health must still fail closed',
  '44000000-0000-4000-8000-000000000605'
);
\set p3c_ai_configured_unverified_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'ai',
  'ready',
  'local_non_provider',
  'Synthetic local AI readiness without provider observation',
  'synthetic:health:ai:local-ready',
  '44000000-0000-4000-8000-000000000606'
)::TEXT AS p3c_ai_health_local_ready
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT ai_readiness = 'ready'
      AND ai_readiness_evidence_kind = 'local_non_provider'
      AND NOT ai_readiness_fresh
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'Fresh local-only AI health must not be projected as provider-fresh'
);
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Local-only ready AI health must still fail closed',
  '44000000-0000-4000-8000-000000000607'
);
\set p3c_ai_local_ready_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'ai',
  'ready',
  'provider_observed',
  'Synthetic provider-observed AI readiness',
  'synthetic:health:ai:provider-ready',
  '44000000-0000-4000-8000-000000000608'
)::TEXT AS p3c_ai_health_provider_ready
\gset
RESET ROLE;

SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Cross-tenant curator must not request org B AI workflow',
  '44000000-0000-4000-8000-000000000609'
);
\set p3c_ai_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Request org B AI draft with selected knowledge',
  '44000000-0000-4000-8000-000000000610'
)::TEXT AS p3c_org_b_ai_request_first
\gset
SELECT platform.request_ai_draft_with_knowledge(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'en',
  :'org_b_knowledge_v1_id',
  'Request org B AI draft with selected knowledge',
  '44000000-0000-4000-8000-000000000610'
)::TEXT AS p3c_org_b_ai_request_replay
\gset
RESET ROLE;

SELECT
  (:'p3c_org_b_ai_request_first'::JSONB ->> 'ai_draft_request_id')
    AS p3c_org_b_ai_request_id,
  (:'p3c_org_b_ai_request_first'::JSONB ->> 'work_item_id')
    AS p3c_org_b_ai_work_item_id
\gset

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT latest_outbox_work_item_id = :'p3c_org_b_ai_work_item_id'
      AND latest_outbox_kind = 'ai_draft_generate'
      AND latest_outbox_work_state = 'queued'
      AND latest_outbox_attempt_count = 0
      AND latest_outbox_max_attempts = 1
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'AI draft outbox must remain visible before a manual authorization exists'
);
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_ai_draft(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  'confident',
  'en',
  :'org_b_knowledge_v1_id',
  'Synthetic org B draft before manual send.',
  'synthetic:ai-provider',
  'synthetic:model:org-b',
  'synthetic:prompt-policy:org-b',
  jsonb_build_object(
    'source_message_id', :'message_org_b_id',
    'knowledge_version_ids', jsonb_build_array(:'org_b_knowledge_v1_id')
  ),
  encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'source_message_id', :'message_org_b_id',
          'knowledge_version_ids', jsonb_build_array(:'org_b_knowledge_v1_id')
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  ),
  '44000000-0000-4000-8000-000000000611'
)::TEXT AS p3c_org_b_draft_first
\gset
RESET ROLE;

SELECT
  (:'p3c_org_b_draft_first'::JSONB ->> 'ai_draft_id') AS p3c_org_b_draft_id
\gset

SELECT encode(
  sha256(
    convert_to(
      array_to_json(
        ARRAY[
          'evo-platform-work-v1',
          'manual_whatsapp_send',
          :'org_b_id',
          :'conversation_org_b_id',
          :'message_org_b_id',
          :'p3c_org_b_draft_id'
        ]
      )::TEXT,
      'UTF8'
    )
  ),
  'hex'
) AS p3c_org_b_ai_manual_business_key
\gset

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT platform.review_ai_draft(
  :'org_b_id',
  :'p3c_org_b_draft_id',
  'approved',
  'Synthetic org B reviewed reply.',
  'Approve org B P3C draft for manual send',
  '44000000-0000-4000-8000-000000000612'
)::TEXT AS p3c_org_b_review_first
\gset
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Unconfigured WAHA health must fail closed',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000613'
);
\set p3c_waha_unconfigured_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

INSERT INTO platform_private.messaging_integration_health_events (
  organization_id,
  target,
  readiness,
  evidence_kind,
  reason,
  evidence_ref,
  request_id,
  observed_at
)
VALUES (
  :'org_b_id',
  'waha',
  'ready',
  'provider_observed',
  'Synthetic stale provider-observed WAHA readiness',
  'synthetic:health:waha:stale',
  '44000000-0000-4000-8000-000000000634',
  statement_timestamp() - INTERVAL '6 minutes'
);

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Stale provider-observed WAHA health must fail closed',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000635'
);
\set p3c_waha_stale_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'waha',
  'configured_unverified',
  'configuration_check',
  'Synthetic WAHA configuration present but not provider-observed',
  'synthetic:health:waha:configured',
  '44000000-0000-4000-8000-000000000614'
)::TEXT AS p3c_waha_health_configured
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Configured-unverified WAHA health must still fail closed',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000615'
);
\set p3c_waha_configured_unverified_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'waha',
  'ready',
  'local_non_provider',
  'Synthetic local WAHA readiness without provider observation',
  'synthetic:health:waha:local-ready',
  '44000000-0000-4000-8000-000000000616'
)::TEXT AS p3c_waha_health_local_ready
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT waha_readiness = 'ready'
      AND waha_readiness_evidence_kind = 'local_non_provider'
      AND NOT waha_readiness_fresh
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'Fresh local-only WAHA health must not be projected as provider-fresh'
);
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Local-only ready WAHA health must still fail closed',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000617'
);
\set p3c_waha_local_ready_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.record_messaging_integration_health_event(
  :'org_b_id',
  'waha',
  'ready',
  'provider_observed',
  'Synthetic provider-observed WAHA readiness',
  'synthetic:health:waha:provider-ready',
  '44000000-0000-4000-8000-000000000618'
)::TEXT AS p3c_waha_health_provider_ready
\gset
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Authorize and enqueue org B manual send',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000619'
)::TEXT AS p3c_org_b_manual_send_first
\gset
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Authorize and enqueue org B manual send',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000619'
)::TEXT AS p3c_org_b_manual_send_replay
\gset
SELECT pg_temp.assert_true(
  (
    SELECT conversation_id = :'conversation_org_b_id'
      AND selected_knowledge_version_id = :'org_b_knowledge_v1_id'
      AND ai_readiness = 'ready'
      AND ai_readiness_evidence_kind = 'provider_observed'
      AND ai_readiness_fresh
      AND waha_readiness = 'ready'
      AND waha_readiness_evidence_kind = 'provider_observed'
      AND waha_readiness_fresh
      AND latest_ai_draft_request_id = :'p3c_org_b_ai_request_id'
      AND latest_ai_draft_requested_language = 'en'
      AND latest_ai_draft_detection_status = 'confident'
      AND latest_ai_draft_failure_outcome IS NULL
      AND latest_manual_send_authorization_id = (
        :'p3c_org_b_manual_send_first'::JSONB
          ->> 'manual_send_authorization_id'
      )::UUID
      AND latest_outbox_work_item_id = (
        :'p3c_org_b_manual_send_first'::JSONB
          ->> 'work_item_id'
      )::UUID
      AND latest_outbox_kind = 'manual_whatsapp_send'
      AND latest_outbox_work_state = 'queued'
      AND latest_outbox_attempt_count = 0
      AND latest_outbox_max_attempts = 1
      AND latest_audit_action = 'communication.manual.send.request'
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'P3C workflow projection failed to expose the guarded org B workflow chain'
);
RESET ROLE;

-- A newer inbound message starts a new workflow cycle. Every AI/request/manual
-- state from the previous message must disappear from the staff projection,
-- and a new request must not authorize the old draft.
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
  '44000000-0000-4000-8000-000000000640',
  message.organization_id,
  message.conversation_id,
  message.student_case_id,
  message.sender_participant_id,
  'inbound',
  'Synthetic org B newer inbound cycle.',
  'en',
  FALSE,
  message.waha_session_name,
  message.waha_message_id || '-p3c-new-cycle',
  message.kommo_account_id,
  message.kommo_conversation_id,
  message.kommo_message_id || '-p3c-new-cycle',
  message.amocrm_account_id,
  message.amocrm_lead_id,
  message.amocrm_contact_id,
  message.source_webhook_event_id,
  NULL,
  statement_timestamp() + INTERVAL '1 second'
FROM platform.communication_messages AS message
WHERE message.organization_id = :'org_b_id'
  AND message.id = :'message_org_b_id';

SELECT
  '44000000-0000-4000-8000-000000000640'::UUID
    AS p3c_org_b_new_message_id
\gset

SELECT encode(
  sha256(
    convert_to(
      array_to_json(
        ARRAY[
          'evo-platform-work-v1',
          'manual_whatsapp_send',
          :'org_b_id',
          :'conversation_org_b_id',
          :'p3c_org_b_new_message_id',
          'staff-authored'
        ]
      )::TEXT,
      'UTF8'
    )
  ),
  'hex'
) AS p3c_org_b_direct_manual_business_key
\gset

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (
    SELECT latest_inbound_message_id = :'p3c_org_b_new_message_id'
      AND selected_knowledge_version_id IS NULL
      AND latest_ai_draft_request_id IS NULL
      AND latest_ai_draft_id IS NULL
      AND latest_manual_send_authorization_id IS NULL
      AND latest_outbox_work_item_id IS NULL
      AND latest_audit_action IS NULL
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'new inbound cycle must hide stale AI/manual/outbox/audit state'
);

\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic stale draft must not send.',
  'Old draft cannot authorize after newer inbound',
  :'p3c_org_b_ai_manual_business_key',
  '44000000-0000-4000-8000-000000000641'
);
\set p3c_stale_inbound_draft_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Cross-organization callers must be rejected even with a correctly shaped
-- current-cycle request.
SET request.jwt.claims TO :'curator_a_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Synthetic cross-organization message.',
  'Cross-org direct manual send must fail',
  :'p3c_org_b_direct_manual_business_key',
  '44000000-0000-4000-8000-000000000642'
);
\set p3c_direct_cross_org_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

-- Closed conversations cannot be authorized. Keep the state change in a
-- transaction and roll it back after capturing the expected denial.
BEGIN;
UPDATE platform.communication_conversations
SET status = 'closed'
WHERE organization_id = :'org_b_id'
  AND id = :'conversation_org_b_id';

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Synthetic closed-conversation message.',
  'Closed direct manual send must fail',
  :'p3c_org_b_direct_manual_business_key',
  '44000000-0000-4000-8000-000000000643'
);
\set p3c_direct_closed_state :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK;
RESET ROLE;

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Synthetic staff-authored direct reply.',
  'Mismatched business key must fail',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000644'
);
\set p3c_direct_business_key_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Synthetic staff-authored direct reply.',
  'Authorize direct staff-written current-cycle reply',
  :'p3c_org_b_direct_manual_business_key',
  '44000000-0000-4000-8000-000000000645'
)::TEXT AS p3c_org_b_direct_send_first
\gset
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Synthetic staff-authored direct reply.',
  'Authorize direct staff-written current-cycle reply',
  :'p3c_org_b_direct_manual_business_key',
  '44000000-0000-4000-8000-000000000645'
)::TEXT AS p3c_org_b_direct_send_replay
\gset

\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'conversation_org_b_id',
  :'p3c_org_b_new_message_id',
  NULL,
  'Changed text must not replay.',
  'Authorize direct staff-written current-cycle reply',
  :'p3c_org_b_direct_manual_business_key',
  '44000000-0000-4000-8000-000000000645'
);
\set p3c_direct_changed_replay_state :SQLSTATE
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  (
    SELECT latest_inbound_message_id = :'p3c_org_b_new_message_id'
      AND selected_knowledge_version_id IS NULL
      AND latest_ai_draft_request_id IS NULL
      AND latest_ai_draft_id IS NULL
      AND latest_manual_send_authorization_id = (
        :'p3c_org_b_direct_send_first'::JSONB
          ->> 'manual_send_authorization_id'
      )::UUID
      AND latest_outbox_work_item_id = (
        :'p3c_org_b_direct_send_first'::JSONB
          ->> 'work_item_id'
      )::UUID
      AND latest_outbox_kind = 'manual_whatsapp_send'
      AND latest_outbox_work_state = 'queued'
      AND latest_outbox_attempt_count = 0
      AND latest_outbox_max_attempts = 1
      AND latest_audit_action = 'communication.manual.send.request'
    FROM platform.staff_conversation_workflow(
      :'org_b_id',
      :'conversation_org_b_id'
    )
  ),
  'direct staff-written manual send did not bind to current cycle/outbox/audit'
);
RESET ROLE;

SET request.jwt.claims TO :'org_b_sales_after_assignment_claims';
SET ROLE authenticated;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.staff_conversation_workflow(
  :'org_b_id',
  :'conversation_org_b_id'
);
\set p3c_workflow_former_sales_state :SQLSTATE
\set ON_ERROR_STOP on
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p3c_future_health_state' = '22023'
    AND :'p3c_health_record_user_state' <> '00000'
    AND :'p3c_ai_unconfigured_state' <> '00000'
    AND :'p3c_ai_stale_state' = '55000'
    AND :'p3c_ai_configured_unverified_state' <> '00000'
    AND :'p3c_ai_local_ready_state' <> '00000'
    AND :'p3c_ai_cross_org_state' <> '00000'
    AND :'p3c_org_b_ai_request_id' =
      (:'p3c_org_b_ai_request_replay'::JSONB ->> 'ai_draft_request_id')
    AND :'p3c_waha_unconfigured_state' <> '00000'
    AND :'p3c_waha_stale_state' = '55000'
    AND :'p3c_waha_configured_unverified_state' <> '00000'
    AND :'p3c_waha_local_ready_state' <> '00000'
    AND (
      :'p3c_org_b_manual_send_first'::JSONB ->> 'work_item_id'
    ) = (
      :'p3c_org_b_manual_send_replay'::JSONB ->> 'work_item_id'
    )
    AND :'p3c_stale_inbound_draft_state' = '55000'
    AND :'p3c_direct_cross_org_state' = '42501'
    AND :'p3c_direct_closed_state' = '55000'
    AND :'p3c_direct_business_key_state' = '22023'
    AND :'p3c_direct_changed_replay_state' = '22023'
    AND (
      :'p3c_org_b_direct_send_first'::JSONB ->> 'work_item_id'
    ) = (
      :'p3c_org_b_direct_send_replay'::JSONB ->> 'work_item_id'
    )
    AND (
      :'p3c_org_b_direct_send_first'::JSONB ->> 'ai_draft_id'
    ) IS NULL
    AND (
      :'p3c_org_b_direct_send_first'::JSONB ->> 'source_message_id'
    ) = :'p3c_org_b_new_message_id'
    AND :'p3c_workflow_former_sales_state' <> '00000',
  'P3C readiness/idempotency/workflow contract failed'
);

\echo 'P3C messaging workflow RLS acceptance passed'
