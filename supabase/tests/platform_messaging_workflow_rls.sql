\set ON_ERROR_STOP on

-- P3C runs after migration 049 against the synthetic P2F fixture rows that
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

CREATE OR REPLACE FUNCTION pg_temp.assert_legacy_ai_request_denied(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_source_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM platform.request_ai_draft(
      p_organization_id,
      p_conversation_id,
      p_source_message_id,
      'en',
      'Superseded direct AI request must be denied',
      gen_random_uuid()
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
  END;

  RAISE EXCEPTION
    'P3C assertion failed: superseded request_ai_draft remained executable';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_legacy_manual_authorization_denied(
  p_organization_id UUID,
  p_ai_draft_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM platform.authorize_manual_send(
      p_organization_id,
      p_ai_draft_id,
      'Superseded direct manual authorization must be denied.',
      'Superseded direct manual authorization must be denied',
      gen_random_uuid()
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      RETURN;
  END;

  RAISE EXCEPTION
    'P3C assertion failed: superseded authorize_manual_send remained executable';
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  pg_temp.assert_legacy_ai_request_denied(UUID, UUID, UUID),
  pg_temp.assert_legacy_manual_authorization_denied(UUID, UUID)
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
      AND waha_readiness = 'unconfigured'
      AND waha_readiness_evidence_kind IS NULL
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

SET request.jwt.claims TO :'org_b_new_curator_after_reassignment_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_legacy_ai_request_denied(
  :'org_b_id',
  :'conversation_org_b_id',
  :'message_org_b_id'
);
SELECT pg_temp.assert_legacy_manual_authorization_denied(
  :'org_b_id',
  :'p3c_org_b_draft_id'
);
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
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Unconfigured WAHA health must fail closed',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000613'
);
\set p3c_waha_unconfigured_state :SQLSTATE
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
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Configured-unverified WAHA health must still fail closed',
  repeat('f', 64),
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
\set ON_ERROR_STOP off
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Local-only ready WAHA health must still fail closed',
  repeat('f', 64),
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
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Authorize and enqueue org B manual send',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000619'
)::TEXT AS p3c_org_b_manual_send_first
\gset
SELECT platform.request_manual_whatsapp_send_with_authorization(
  :'org_b_id',
  :'p3c_org_b_draft_id',
  'Synthetic org B reviewed reply.',
  'Authorize and enqueue org B manual send',
  repeat('f', 64),
  '44000000-0000-4000-8000-000000000619'
)::TEXT AS p3c_org_b_manual_send_replay
\gset
SELECT pg_temp.assert_true(
  (
    SELECT conversation_id = :'conversation_org_b_id'
      AND selected_knowledge_version_id = :'org_b_knowledge_v1_id'
      AND ai_readiness = 'ready'
      AND ai_readiness_evidence_kind = 'provider_observed'
      AND waha_readiness = 'ready'
      AND waha_readiness_evidence_kind = 'provider_observed'
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
  :'p3c_health_record_user_state' <> '00000'
    AND :'p3c_ai_unconfigured_state' <> '00000'
    AND :'p3c_ai_configured_unverified_state' <> '00000'
    AND :'p3c_ai_local_ready_state' <> '00000'
    AND :'p3c_ai_cross_org_state' <> '00000'
    AND :'p3c_org_b_ai_request_id' =
      (:'p3c_org_b_ai_request_replay'::JSONB ->> 'ai_draft_request_id')
    AND :'p3c_waha_unconfigured_state' <> '00000'
    AND :'p3c_waha_configured_unverified_state' <> '00000'
    AND :'p3c_waha_local_ready_state' <> '00000'
    AND (
      :'p3c_org_b_manual_send_first'::JSONB ->> 'work_item_id'
    ) = (
      :'p3c_org_b_manual_send_replay'::JSONB ->> 'work_item_id'
    )
    AND :'p3c_workflow_former_sales_state' <> '00000',
  'P3C readiness/idempotency/workflow contract failed'
);

\echo 'P3C messaging workflow RLS acceptance passed'
