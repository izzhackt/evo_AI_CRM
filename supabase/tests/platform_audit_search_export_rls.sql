\set ON_ERROR_STOP on

-- P7A runs after every earlier migration-specific suite has established the
-- shared synthetic two-organization authority fixtures. This transaction adds
-- only synthetic audit rows and rolls every probe back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P7A assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated;

\set p7a_admin_a_user_id '10000000-0000-4000-8000-000000000001'
\set p7a_sales_user_id '10000000-0000-4000-8000-000000000002'
\set p7a_blocked_user_id '10000000-0000-4000-8000-000000000006'
\set p7a_admin_b_user_id '10000000-0000-4000-8000-000000000008'

SELECT
  membership.organization_id AS p7a_org_a_id,
  membership.id AS p7a_admin_a_membership_id,
  profile.id AS p7a_admin_a_profile_id,
  profile.access_version AS p7a_admin_a_access_version,
  jsonb_build_object(
    'role', 'authenticated',
    'sub', profile.auth_user_id,
    'platform_role', membership."current_role"::TEXT,
    'platform_access_version', profile.access_version
  )::TEXT AS p7a_admin_a_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'p7a_admin_a_user_id'
\gset

SELECT jsonb_build_object(
  'role', 'authenticated',
  'sub', profile.auth_user_id,
  'platform_role', membership."current_role"::TEXT,
  'platform_access_version', profile.access_version
)::TEXT AS p7a_sales_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'p7a_sales_user_id'
\gset

SELECT jsonb_build_object(
  'role', 'authenticated',
  'sub', profile.auth_user_id,
  'platform_role', membership."current_role"::TEXT,
  'platform_access_version', profile.access_version
)::TEXT AS p7a_blocked_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'p7a_blocked_user_id'
\gset

SELECT
  membership.organization_id AS p7a_org_b_id,
  jsonb_build_object(
    'role', 'authenticated',
    'sub', profile.auth_user_id,
    'platform_role', membership."current_role"::TEXT,
    'platform_access_version', profile.access_version
  )::TEXT AS p7a_admin_b_claims
FROM platform.profiles AS profile
JOIN platform.organization_memberships AS membership
  ON membership.profile_id = profile.id
WHERE profile.auth_user_id = :'p7a_admin_b_user_id'
\gset

SELECT jsonb_build_object(
  'role', 'authenticated',
  'sub', :'p7a_admin_a_user_id'::UUID,
  'platform_role', 'admin',
  'platform_access_version', :'p7a_admin_a_access_version'::BIGINT - 1
)::TEXT AS p7a_stale_admin_claims
\gset

-- The raw row and private replay receipt are not browser/service tables. Only
-- the two authenticated RPCs retain API-role authority.
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'platform.audit_events', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform.audit_events', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform.audit_events', 'SELECT')
  AND NOT has_table_privilege(
    'authenticated',
    'platform_private.audit_export_replays',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.audit_export_replays',
    'SELECT'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid IN (
      'platform.audit_events'::REGCLASS,
      'platform_private.audit_export_replays'::REGCLASS
    )
  ),
  'raw audit/replay grants or policies remain exposed'
);

SELECT pg_temp.assert_true(
  (
    SELECT relation.relrowsecurity AND relation.relforcerowsecurity
    FROM pg_class AS relation
    WHERE relation.oid =
      'platform_private.audit_export_replays'::REGCLASS
  )
  AND has_function_privilege(
    'authenticated',
    'platform.search_audit_events(timestamptz,timestamptz,text[],text[],uuid,integer,timestamptz,uuid,timestamptz,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.export_audit_events(uuid,timestamptz,timestamptz,text[],text[],uuid,timestamptz,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'platform.search_audit_events(timestamptz,timestamptz,text[],text[],uuid,integer,timestamptz,uuid,timestamptz,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'platform.export_audit_events(uuid,timestamptz,timestamptz,text[],text[],uuid,timestamptz,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'platform.record_messaging_integration_health_event(uuid,platform.messaging_integration_target,platform.messaging_integration_readiness,platform.messaging_integration_evidence_kind,text,text,uuid)',
    'EXECUTE'
  ),
  'P7A function grants or retained internal writer grants drifted'
);

SELECT pg_temp.assert_true(
  (
    SELECT bool_and(
      pg_get_userbyid(routine.proowner) = 'postgres'
      AND routine.prosecdef
      AND array_to_string(routine.proconfig, ',') = 'search_path=""'
      AND (
        (routine.proname = 'search_audit_events' AND routine.provolatile = 's')
        OR (routine.proname = 'export_audit_events' AND routine.provolatile = 'v')
      )
    )
    FROM pg_proc AS routine
    JOIN pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname IN ('search_audit_events', 'export_audit_events')
  ),
  'P7A RPC owner/security/search-path/volatility posture drifted'
);

SELECT pg_temp.assert_true(
  position(
    'pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0))'
    IN lower(pg_get_functiondef(
      'platform.export_audit_events(uuid,timestamptz,timestamptz,text[],text[],uuid,timestamptz,uuid)'::REGPROCEDURE
    ))
  ) > 0
  AND to_regclass('platform.audit_events_org_created_id_idx') IS NOT NULL
  AND to_regclass('platform.audit_events_org_action_created_id_idx') IS NOT NULL
  AND to_regclass('platform.audit_events_org_type_created_id_idx') IS NOT NULL
  AND to_regclass('platform.audit_events_org_resource_created_id_idx') IS NOT NULL
  AND pg_get_indexdef(
    'platform.audit_events_org_resource_created_id_idx'::REGCLASS
  ) ~ 'USING btree \(organization_id, resource_id, created_at DESC, id DESC\)'
  AND to_regclass(
    'platform_private.audit_export_replays_org_membership_idx'
  ) IS NOT NULL
  AND to_regclass(
    'platform_private.audit_export_replays_actor_profile_idx'
  ) IS NOT NULL
  AND to_regclass(
    'platform_private.audit_export_replays_snapshot_idx'
  ) IS NOT NULL,
  'P7A request serialization or required indexes drifted'
);

SELECT pg_temp.assert_true(
  platform_private.p7a_safe_audit_actions() = ARRAY[
    'ai.control.set', 'ai.draft.generate', 'ai.draft.language.resolve',
    'ai.draft.record', 'ai.draft.request', 'ai.draft.request.knowledge',
    'ai.draft.review', 'ai.fact.record',
    'ai.memory.record', 'ai.qualification.record', 'ai.retrieval.preview',
    'application.create', 'application.status.change', 'audit.export',
    'autonomous.reply.control.set', 'case.create', 'case.curator.set',
    'case.handoff.create', 'case.lifecycle.change', 'case.route.change',
    'case.update.append', 'catalog.import.batch.create',
    'catalog.import.batch.review', 'catalog.import.batch.validate',
    'catalog.import.candidate.stage', 'communication.conversation.create',
    'communication.conversation.link', 'communication.manual.authorize',
    'communication.manual.send', 'communication.manual.send.request',
    'communication.message.record', 'communication.participant.record',
    'communication.provider.observe', 'communication.waha.history.begin',
    'communication.waha.history.complete',
    'communication.waha.history.pause', 'communication.waha.history.project',
    'communication.waha.project', 'communication.waha.project.retry',
    'contract.draft.generate', 'contract.draft.review',
    'contract.template.version.approve',
    'contract.template.version.create',
    'contract.template.version.retire', 'country.requirement.apply',
    'country.requirement.source.link',
    'country.requirement.version.approve',
    'country.requirement.version.create',
    'country.requirement.version.retire', 'decision.backlog.create',
    'decision.backlog.transition', 'document.download.grant',
    'document.download.sign.authorize', 'document.requirement.create',
    'document.requirement.retire', 'document.slot.create',
    'document.upload.finalize', 'document.upload.reserve',
    'document.validation.attest', 'document.version.record',
    'document.version.review', 'finance.obligation.create',
    'finance.payment.record', 'finance.stop.create', 'finance.stop.resolve',
    'knowledge.chunkset.publish', 'knowledge.version.publish',
    'knowledge.version.retire',
    'membership.provision', 'membership.role.change',
    'membership.scope.organization.assign',
    'membership.scope.organization.revoke', 'membership.status.change',
    'messaging.integration.health.record', 'notification.consent.set',
    'notification.create', 'notification.read', 'organization.bootstrap',
    'post.contract.item.update', 'post.contract.items.seed',
    'post.contract.report.generate', 'post.contract.report.review',
    'rbac.bundle.upgrade', 'student.profile.upsert', 'task.change',
    'task.create', 'visa.create', 'visa.status.change',
    'workflow.contract.create', 'workflow.source.link',
    'workflow.source.register', 'workflow.source.retire',
    'workflow.source.review', 'workflow.version.approve',
    'workflow.version.create', 'workflow.version.retire'
  ]::TEXT[]
  AND platform_private.p7a_safe_audit_resource_types() = ARRAY[
    'ai_draft', 'ai_draft_request', 'ai_draft_request_knowledge_selection',
    'ai_retrieval_request', 'approved_knowledge_chunk_set',
    'approved_knowledge_version', 'audit_export', 'case_task',
    'catalog_import_batch', 'catalog_import_candidate',
    'communication_conversation', 'communication_message',
    'contract_template_version', 'conversation_ai_control',
    'conversation_ai_fact',
    'conversation_ai_memory', 'conversation_ai_qualification',
    'conversation_participant', 'country_requirement_version',
    'country_requirement_version_source', 'decision_backlog',
    'document_requirement', 'document_slot',
    'document_version', 'durable_work_item', 'manual_send_authorization',
    'messaging_integration_health_event', 'notification',
    'notification_consent', 'organization', 'organization_membership',
    'payment_event', 'payment_obligation', 'post_contract_item',
    'post_contract_item_set', 'post_contract_report',
    'provider_reconciliation_event', 'source_registry', 'stop_factor',
    'student_case', 'student_case_contract_draft', 'student_case_update',
    'student_profile', 'university_application', 'visa_case',
    'waha_history_reconciliation_run', 'workflow_contract',
    'workflow_contract_version', 'workflow_contract_version_source'
  ]::TEXT[],
  'safe action/resource allowlists drifted'
);

-- Four eligible organization-A rows cover all fixed actor labels. One unknown
-- future action and one organization-B row must never enter the safe DTO.
INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state, reason,
  request_id, created_at
)
VALUES
  (
    '71000000-0000-4000-8000-000000000001', :'p7a_org_a_id', 'user',
    :'p7a_admin_a_profile_id', 'auth:+996555000001', 'case.create',
    'student_case', '71000000-0000-4000-8000-000000000101', NULL,
    '{"phone":"+996555000001","object_key":"private/a"}',
    '=PRIVATE +996555000001',
    '71000000-0000-4000-8000-000000000201',
    TIMESTAMPTZ '2040-01-01 10:00:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000002', :'p7a_org_a_id', 'service',
    NULL, 'service:provider-private', 'document.version.review',
    'document_version', '71000000-0000-4000-8000-000000000102',
    '{"provider_payload":{"token":"secret"}}',
    '{"private_topic":"org:phone:+996555000002"}',
    'Private provider reason +996555000002',
    '71000000-0000-4000-8000-000000000202',
    TIMESTAMPTZ '2040-01-01 10:01:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000003', :'p7a_org_a_id', 'service',
    NULL, 'service:future-private', 'secret.rotate', 'provider_secret',
    '71000000-0000-4000-8000-000000000103', NULL,
    '{"phone":"+996555000003"}', 'Unknown future reason',
    '71000000-0000-4000-8000-000000000203',
    TIMESTAMPTZ '2040-01-01 10:02:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000004', :'p7a_org_a_id', 'system',
    NULL, 'system:private-phone:+996555000004', 'notification.read',
    'notification', '71000000-0000-4000-8000-000000000104',
    '{"read_at":null}', '{"read_at":"2040-01-01T10:03:00Z"}',
    'System reason +996555000004',
    '71000000-0000-4000-8000-000000000204',
    TIMESTAMPTZ '2040-01-01 10:03:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000005', :'p7a_org_b_id', 'system',
    NULL, 'system:other-org-private', 'case.create', 'student_case',
    '71000000-0000-4000-8000-000000000105', NULL, '{}',
    'Other organization reason',
    '71000000-0000-4000-8000-000000000205',
    TIMESTAMPTZ '2040-01-01 10:05:00+00'
  ),
  (
    '71000000-0000-4000-8000-000000000000', :'p7a_org_a_id', 'system',
    NULL, 'system:cursor-filter-probe', 'document.version.review',
    'document_version', '71000000-0000-4000-8000-000000000100', NULL,
    '{}', 'Cursor filter probe',
    '71000000-0000-4000-8000-000000000200',
    TIMESTAMPTZ '2040-01-01 09:59:00+00'
  );

SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  NULL,
  NULL,
  NULL,
  2,
  NULL,
  NULL,
  NULL,
  NULL
)::TEXT AS p7a_page_one
\gset
RESET ROLE;

SELECT
  :'p7a_page_one'::JSONB ->> 'snapshot_created_at'
    AS p7a_snapshot_created_at,
  :'p7a_page_one'::JSONB ->> 'snapshot_id' AS p7a_snapshot_id,
  :'p7a_page_one'::JSONB ->> 'next_cursor_created_at'
    AS p7a_next_cursor_created_at,
  :'p7a_page_one'::JSONB ->> 'next_cursor_id' AS p7a_next_cursor_id
\gset

SELECT pg_temp.assert_true(
  (:'p7a_page_one'::JSONB ->> 'has_more')::BOOLEAN
  AND jsonb_array_length(:'p7a_page_one'::JSONB -> 'rows') = 2
  AND :'p7a_page_one'::JSONB ->> 'snapshot_id' =
    '71000000-0000-4000-8000-000000000004'
  AND :'p7a_page_one'::JSONB ->> 'next_cursor_id' =
    '71000000-0000-4000-8000-000000000002'
  AND NOT (:'p7a_page_one'::TEXT ~
    '(actor_principal|before_state|after_state|provider_payload|object_key|private_topic|\\+996|PRIVATE)')
  AND (
    SELECT bool_and((
      SELECT array_agg(key ORDER BY key)
      FROM jsonb_object_keys(row_value) AS key
    ) = ARRAY[
      'action', 'actor_display_label', 'actor_kind', 'audit_event_id',
      'changed_field_codes', 'created_at', 'reason_code', 'request_id',
      'resource_id', 'resource_type'
    ]::TEXT[])
    FROM jsonb_array_elements(:'p7a_page_one'::JSONB -> 'rows') AS row_value
  )
  AND (
    SELECT array_agg(row_value ->> 'actor_display_label' ORDER BY ordinal)
    FROM jsonb_array_elements(:'p7a_page_one'::JSONB -> 'rows')
      WITH ORDINALITY AS safe_row(row_value, ordinal)
  ) = ARRAY['System', 'Service']::TEXT[]
  AND (
    SELECT bool_and(row_value ->> 'reason_code' = 'restricted')
    FROM jsonb_array_elements(:'p7a_page_one'::JSONB -> 'rows') AS row_value
  ),
  'page one snapshot/order/safe DTO containment failed'
);

-- A later append must not move or duplicate the frozen second page.
INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state, reason,
  request_id, created_at
)
VALUES (
  '71000000-0000-4000-8000-000000000006', :'p7a_org_a_id', 'user',
  :'p7a_admin_a_profile_id', 'auth:late-private', 'finance.payment.record',
  'payment_event', '71000000-0000-4000-8000-000000000106', NULL,
  '{"phone":"+996555000006"}', 'Late append reason',
  '71000000-0000-4000-8000-000000000206',
  TIMESTAMPTZ '2040-01-01 10:04:00+00'
);

SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  NULL, NULL, NULL, 2,
  :'p7a_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_snapshot_id'::UUID,
  :'p7a_next_cursor_created_at'::TIMESTAMPTZ,
  :'p7a_next_cursor_id'::UUID
)::TEXT AS p7a_page_two
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT (:'p7a_page_two'::JSONB ->> 'has_more')::BOOLEAN
  AND jsonb_array_length(:'p7a_page_two'::JSONB -> 'rows') = 1
  AND :'p7a_page_two'::JSONB #>> '{rows,0,audit_event_id}' =
    '71000000-0000-4000-8000-000000000001'
  AND :'p7a_page_two'::JSONB #>> '{rows,0,actor_display_label}' = 'Staff',
  'frozen keyset continuation moved, duplicated, or leaked a mutable label'
);

-- Export consumes the snapshot returned by search; it never discovers a newer
-- boundary on its own.
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00'
)::TEXT AS p7a_export_search
\gset
RESET ROLE;
SELECT
  :'p7a_export_search'::JSONB ->> 'snapshot_created_at'
    AS p7a_export_snapshot_created_at,
  :'p7a_export_search'::JSONB ->> 'snapshot_id'
    AS p7a_export_snapshot_id
\gset

-- Organization B sees only its own matching row.
SET request.jwt.claims TO :'p7a_admin_b_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00'
)::TEXT AS p7a_org_b_search
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  jsonb_array_length(:'p7a_org_b_search'::JSONB -> 'rows') = 1
  AND :'p7a_org_b_search'::JSONB #>> '{rows,0,audit_event_id}' =
    '71000000-0000-4000-8000-000000000005',
  'cross-organization audit containment failed'
);

-- An Admin from organization B cannot reuse organization A's frozen snapshot
-- as an export boundary. The rejected mutation must leave neither a replay
-- receipt nor an audit.export event behind.
\set p7a_cross_org_export_request_id '71000000-0000-4000-8000-000000000303'
SET request.jwt.claims TO :'p7a_admin_b_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_cross_org_export_denied;
\set ON_ERROR_STOP off
SELECT platform.export_audit_events(
  :'p7a_cross_org_export_request_id',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  ARRAY['finance.payment.record'],
  ARRAY['payment_event'],
  '71000000-0000-4000-8000-000000000106',
  :'p7a_export_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_export_snapshot_id'::UUID
);
\set p7a_cross_org_export_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_cross_org_export_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_cross_org_export_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p7a_cross_org_export_state' = '22023'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.audit_export_replays
    WHERE request_id = :'p7a_cross_org_export_request_id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events
    WHERE request_id = :'p7a_cross_org_export_request_id'
      OR (
        action = 'audit.export'
        AND resource_id = :'p7a_cross_org_export_request_id'
      )
  ),
  'cross-organization Admin export wrote a receipt or audit event'
);

-- A currently authorized Admin loses both RPCs immediately when the exact
-- membership becomes inactive. Contain the lifecycle mutation and prove that
-- the denied export leaves no receipt or audit.export side effect.
\set p7a_inactive_export_request_id '71000000-0000-4000-8000-000000000304'
SAVEPOINT isolate_p7a_inactive_admin;
UPDATE platform.organization_memberships
SET status = 'inactive'
WHERE id = :'p7a_admin_a_membership_id';
SELECT pg_temp.assert_true(
  (
    SELECT status = 'inactive'::platform.membership_status
      AND "current_role" = 'admin'::platform.business_role
    FROM platform.organization_memberships
    WHERE id = :'p7a_admin_a_membership_id'
  ),
  'inactive Admin fixture did not retain the otherwise-authorized identity'
);
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_inactive_search_denied;
\set ON_ERROR_STOP off
SELECT platform.search_audit_events();
\set p7a_inactive_search_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_inactive_search_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_inactive_search_denied;
SAVEPOINT expect_p7a_inactive_export_denied;
\set ON_ERROR_STOP off
SELECT platform.export_audit_events(
  :'p7a_inactive_export_request_id',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  NULL, NULL, NULL,
  :'p7a_export_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_export_snapshot_id'::UUID
);
\set p7a_inactive_export_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_inactive_export_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_inactive_export_denied;
RESET ROLE;
SELECT pg_temp.assert_true(
  :'p7a_inactive_search_state' = '42501'
  AND :'p7a_inactive_export_state' = '42501'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.audit_export_replays
    WHERE request_id = :'p7a_inactive_export_request_id'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events
    WHERE request_id = :'p7a_inactive_export_request_id'
      AND action = 'audit.export'
  ),
  'inactive Admin retained P7A authority or wrote an export side effect'
);
ROLLBACK TO SAVEPOINT isolate_p7a_inactive_admin;
RELEASE SAVEPOINT isolate_p7a_inactive_admin;
SELECT pg_temp.assert_true(
  (
    SELECT status = 'active'::platform.membership_status
    FROM platform.organization_memberships
    WHERE id = :'p7a_admin_a_membership_id'
  ),
  'inactive Admin fixture containment did not restore the membership'
);

-- Non-Admin, blocked, stale, anonymous, service, raw-table, and
-- private-ledger paths all fail at SQL rather than relying on app guards.
SET request.jwt.claims TO :'p7a_sales_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_sales_denied;
\set ON_ERROR_STOP off
SELECT platform.search_audit_events();
\set p7a_sales_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_sales_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_sales_denied;
RESET ROLE;
SET request.jwt.claims TO :'p7a_blocked_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_blocked_denied;
\set ON_ERROR_STOP off
SELECT platform.search_audit_events();
\set p7a_blocked_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_blocked_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_blocked_denied;
RESET ROLE;
SET request.jwt.claims TO :'p7a_stale_admin_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_stale_denied;
\set ON_ERROR_STOP off
SELECT platform.search_audit_events();
\set p7a_stale_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_stale_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_stale_denied;
RESET ROLE;
SET request.jwt.claims = '{"role":"anon"}';
SET ROLE anon;
SAVEPOINT expect_p7a_anon_denied;
\set ON_ERROR_STOP off
SELECT platform.search_audit_events();
\set p7a_anon_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_anon_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_anon_denied;
RESET ROLE;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SAVEPOINT expect_p7a_service_denied;
\set ON_ERROR_STOP off
SELECT platform.export_audit_events(
  '71000000-0000-4000-8000-000000000301',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00'
);
\set p7a_service_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_service_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_service_denied;
RESET ROLE;
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_raw_table_denied;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform.audit_events;
\set p7a_raw_table_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_raw_table_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_raw_table_denied;
SAVEPOINT expect_p7a_private_ledger_denied;
\set ON_ERROR_STOP off
SELECT count(*) FROM platform_private.audit_export_replays;
\set p7a_private_ledger_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_private_ledger_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_p7a_private_ledger_denied;
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p7a_sales_state' = '42501'
  AND :'p7a_blocked_state' = '42501'
  AND :'p7a_stale_state' = '42501'
  AND :'p7a_anon_state' = '42501'
  AND :'p7a_service_state' = '42501'
  AND :'p7a_raw_table_state' = '42501'
  AND :'p7a_private_ledger_state' = '42501',
  'one or more unauthorized P7A SQL paths did not fail closed'
);

-- audit.read never replaces the live organization-scope grant. Append a newer
-- synthetic revocation, prove denial, then roll it back to retain the fixture.
SELECT
  scope.id AS p7a_org_scope_id,
  scope.scope_version AS p7a_org_scope_version,
  COALESCE(max(assignment.assignment_version), 0) + 1
    AS p7a_org_scope_next_assignment_version
FROM platform.record_scopes AS scope
LEFT JOIN platform.membership_scope_assignments AS assignment
  ON assignment.organization_id = scope.organization_id
  AND assignment.membership_id = :'p7a_admin_a_membership_id'
  AND assignment.scope_id = scope.id
WHERE scope.organization_id = :'p7a_org_a_id'
  AND scope.scope_kind = 'organization'
  AND scope.scope_key = :'p7a_org_a_id'
GROUP BY scope.id, scope.scope_version
\gset

SAVEPOINT p7a_revoked_org_scope;
INSERT INTO platform.membership_scope_assignments (
  organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason,
  request_id
)
VALUES (
  :'p7a_org_a_id', :'p7a_admin_a_membership_id', :'p7a_org_scope_id',
  :'p7a_org_scope_version', :'p7a_org_scope_next_assignment_version', FALSE,
  'system', NULL, 'P7A synthetic organization-scope revocation',
  '71000000-0000-4000-8000-000000000310'
);
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events();
\set p7a_revoked_org_scope_state :SQLSTATE
RESET ROLE;
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT p7a_revoked_org_scope;
RELEASE SAVEPOINT p7a_revoked_org_scope;

SELECT pg_temp.assert_true(
  :'p7a_revoked_org_scope_state' = '42501',
  'audit.read without a live organization scope reached P7A'
);

-- Malformed/oversized/out-of-scope filters and snapshot/cursor pairs use the
-- single documented invalid-parameter state.
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_page_size_invalid;
SELECT platform.search_audit_events(p_page_size => 101);
\set p7a_page_size_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_page_size_invalid;
RELEASE SAVEPOINT expect_p7a_page_size_invalid;
SAVEPOINT expect_p7a_action_filter_invalid;
SELECT platform.search_audit_events(p_actions => ARRAY['secret.rotate']);
\set p7a_action_filter_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_action_filter_invalid;
RELEASE SAVEPOINT expect_p7a_action_filter_invalid;
SAVEPOINT expect_p7a_empty_filter_invalid;
SELECT platform.search_audit_events(p_actions => ARRAY[]::TEXT[]);
\set p7a_empty_filter_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_empty_filter_invalid;
RELEASE SAVEPOINT expect_p7a_empty_filter_invalid;
SAVEPOINT expect_p7a_oversized_filter_invalid;
SELECT platform.search_audit_events(
  p_actions => array_fill('case.create'::TEXT, ARRAY[33])
);
\set p7a_oversized_filter_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_oversized_filter_invalid;
RELEASE SAVEPOINT expect_p7a_oversized_filter_invalid;
SAVEPOINT expect_p7a_partial_snapshot_invalid;
SELECT platform.search_audit_events(
  p_snapshot_created_at => TIMESTAMPTZ '2040-01-01 10:03:00+00'
);
\set p7a_partial_snapshot_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_partial_snapshot_invalid;
RELEASE SAVEPOINT expect_p7a_partial_snapshot_invalid;
SAVEPOINT expect_p7a_cross_snapshot_invalid;
SELECT platform.search_audit_events(
  p_start_at => TIMESTAMPTZ '2040-01-01 10:00:00+00',
  p_end_at => TIMESTAMPTZ '2040-01-01 11:00:00+00',
  p_snapshot_created_at => TIMESTAMPTZ '2040-01-01 10:05:00+00',
  p_snapshot_id => '71000000-0000-4000-8000-000000000005'
);
\set p7a_cross_snapshot_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_cross_snapshot_invalid;
RELEASE SAVEPOINT expect_p7a_cross_snapshot_invalid;
SAVEPOINT expect_p7a_cursor_after_snapshot_invalid;
SELECT platform.search_audit_events(
  p_start_at => TIMESTAMPTZ '2040-01-01 10:00:00+00',
  p_end_at => TIMESTAMPTZ '2040-01-01 11:00:00+00',
  p_snapshot_created_at => :'p7a_snapshot_created_at'::TIMESTAMPTZ,
  p_snapshot_id => :'p7a_snapshot_id'::UUID,
  p_cursor_created_at => TIMESTAMPTZ '2040-01-01 10:04:00+00',
  p_cursor_id => '71000000-0000-4000-8000-000000000006'
);
\set p7a_cursor_after_snapshot_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_cursor_after_snapshot_invalid;
RELEASE SAVEPOINT expect_p7a_cursor_after_snapshot_invalid;
SAVEPOINT expect_p7a_cursor_filter_invalid;
SELECT platform.search_audit_events(
  p_start_at => TIMESTAMPTZ '2040-01-01 09:00:00+00',
  p_end_at => TIMESTAMPTZ '2040-01-01 11:00:00+00',
  p_actions => ARRAY['case.create'],
  p_snapshot_created_at => TIMESTAMPTZ '2040-01-01 10:00:00+00',
  p_snapshot_id => '71000000-0000-4000-8000-000000000001',
  p_cursor_created_at => TIMESTAMPTZ '2040-01-01 09:59:00+00',
  p_cursor_id => '71000000-0000-4000-8000-000000000000'
);
\set p7a_cursor_filter_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_cursor_filter_invalid;
RELEASE SAVEPOINT expect_p7a_cursor_filter_invalid;
SAVEPOINT expect_p7a_long_window_invalid;
SELECT platform.export_audit_events(
  '71000000-0000-4000-8000-000000000302',
  TIMESTAMPTZ '2040-01-01 00:00:00+00',
  TIMESTAMPTZ '2040-02-02 00:00:00+00'
);
\set p7a_long_window_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_long_window_invalid;
RELEASE SAVEPOINT expect_p7a_long_window_invalid;
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p7a_page_size_state' = '22023'
  AND :'p7a_action_filter_state' = '22023'
  AND :'p7a_empty_filter_state' = '22023'
  AND :'p7a_oversized_filter_state' = '22023'
  AND :'p7a_partial_snapshot_state' = '22023'
  AND :'p7a_cross_snapshot_state' = '22023'
  AND :'p7a_cursor_after_snapshot_state' = '22023'
  AND :'p7a_cursor_filter_state' = '22023'
  AND :'p7a_long_window_state' = '22023',
  'P7A malformed filter/snapshot/cursor validation drifted'
);

-- Export the same frozen set, then mutate the live display name to a phone-like
-- value. Exact replay must remain byte/hash stable because labels are fixed.
\set p7a_export_request_id '71000000-0000-4000-8000-000000000401'
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.export_audit_events(
  :'p7a_export_request_id',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  NULL,
  NULL,
  NULL,
  :'p7a_export_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_export_snapshot_id'::UUID
)::TEXT AS p7a_first_export
\gset
RESET ROLE;

UPDATE platform.profiles
SET display_name = '+996 555 999 999 PRIVATE STAFF'
WHERE id = :'p7a_admin_a_profile_id';

SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.export_audit_events(
  :'p7a_export_request_id',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  NULL,
  NULL,
  NULL,
  :'p7a_export_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_export_snapshot_id'::UUID
)::TEXT AS p7a_replayed_export
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'p7a_first_export'::JSONB = :'p7a_replayed_export'::JSONB
  AND :'p7a_first_export'::TEXT = :'p7a_replayed_export'::TEXT
  AND (:'p7a_first_export'::JSONB ->> 'row_count')::INTEGER = 4
  AND :'p7a_first_export'::JSONB ->> 'snapshot_id' =
    '71000000-0000-4000-8000-000000000006'
  AND (:'p7a_first_export'::JSONB ->> 'row_set_sha256') ~
    '^[0-9a-f]{64}$'
  AND NOT (:'p7a_first_export'::TEXT ~
    '(actor_principal|before_state|after_state|provider_payload|object_key|private_topic|\\+996|PRIVATE STAFF)')
  AND (
    SELECT count(*)
    FROM platform_private.audit_export_replays
    WHERE request_id = :'p7a_export_request_id'
  ) = 1
  AND (
    SELECT count(*)
    FROM platform.audit_events
    WHERE request_id = :'p7a_export_request_id'
      AND action = 'audit.export'
  ) = 1,
  'exact export replay was not immutable, safe, and exactly-once'
);

SELECT pg_temp.assert_true(
  (
    SELECT before_state IS NULL
      AND (SELECT array_agg(key ORDER BY key)
        FROM jsonb_object_keys(after_state) AS key) =
        ARRAY['filters', 'row_count', 'row_set_sha256']::TEXT[]
      AND NOT (after_state::TEXT ~
        '(rows|audit_event_ids|actor_principal|before_state|after_state|\\+996)')
    FROM platform.audit_events
    WHERE request_id = :'p7a_export_request_id'
      AND action = 'audit.export'
  ),
  'audit.export event contains more than filters/count/hash'
);

-- The export event itself is visible later only through its fixed safe codes.
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2000-01-01 00:00:00+00',
  TIMESTAMPTZ '2100-01-01 00:00:00+00',
  ARRAY['audit.export'],
  ARRAY['audit_export'],
  :'p7a_export_request_id'
)::TEXT AS p7a_export_event_search
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  jsonb_array_length(:'p7a_export_event_search'::JSONB -> 'rows') = 1
  AND :'p7a_export_event_search'::JSONB #>> '{rows,0,reason_code}' =
    'audit_export_requested'
  AND (:'p7a_export_event_search'::JSONB #> '{rows,0,changed_field_codes}') =
    '["export_filters","export_row_count","export_row_set_sha256"]'::JSONB,
  'safe audit.export projection drifted'
);

-- Changed input under the same UUID and collision with an existing non-export
-- audit request both normalize to 22023 and append no ledger/event.
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_conflicting_replay;
SELECT platform.export_audit_events(
  :'p7a_export_request_id',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00',
  ARRAY['case.create'],
  NULL,
  NULL,
  :'p7a_export_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_export_snapshot_id'::UUID
);
\set p7a_conflicting_replay_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_conflicting_replay;
RELEASE SAVEPOINT expect_p7a_conflicting_replay;
SAVEPOINT expect_p7a_request_collision;
SELECT platform.export_audit_events(
  '71000000-0000-4000-8000-000000000201',
  TIMESTAMPTZ '2040-01-01 10:00:00+00',
  TIMESTAMPTZ '2040-01-01 11:00:00+00'
);
\set p7a_existing_request_collision_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_request_collision;
RELEASE SAVEPOINT expect_p7a_request_collision;
RESET ROLE;
\set ON_ERROR_STOP on

SELECT pg_temp.assert_true(
  :'p7a_conflicting_replay_state' = '22023'
  AND :'p7a_existing_request_collision_state' = '22023'
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.audit_export_replays
    WHERE request_id = '71000000-0000-4000-8000-000000000201'
  )
  AND (
    SELECT count(*)
    FROM platform.audit_events
    WHERE request_id = :'p7a_export_request_id'
  ) = 1,
  'conflicting/colliding request handling wrote side effects or leaked SQLSTATE'
);

-- Null is an explicit empty snapshot, not an instruction to resolve a fresh
-- boundary. A matching append between empty search and export stays excluded.
\set p7a_empty_export_request_id '71000000-0000-4000-8000-000000000402'
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.search_audit_events(
  TIMESTAMPTZ '2090-01-01 00:00:00+00',
  TIMESTAMPTZ '2090-01-02 00:00:00+00'
)::TEXT AS p7a_empty_search
\gset
RESET ROLE;
INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state, reason,
  request_id, created_at
)
VALUES (
  '71000000-0000-4000-8000-000000000007', :'p7a_org_a_id', 'system',
  NULL, 'system:empty-snapshot-race', 'case.create', 'student_case',
  '71000000-0000-4000-8000-000000000107', NULL, '{}',
  'P7A empty snapshot race probe',
  '71000000-0000-4000-8000-000000000207',
  TIMESTAMPTZ '2090-01-01 00:30:00+00'
);
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SELECT platform.export_audit_events(
  :'p7a_empty_export_request_id',
  TIMESTAMPTZ '2090-01-01 00:00:00+00',
  TIMESTAMPTZ '2090-01-02 00:00:00+00'
)::TEXT AS p7a_empty_export
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  :'p7a_empty_search'::JSONB -> 'snapshot_id' = 'null'::JSONB
  AND :'p7a_empty_search'::JSONB -> 'snapshot_created_at' = 'null'::JSONB
  AND :'p7a_empty_search'::JSONB -> 'next_cursor_id' = 'null'::JSONB
  AND :'p7a_empty_search'::JSONB -> 'next_cursor_created_at' = 'null'::JSONB
  AND NOT (:'p7a_empty_search'::JSONB ->> 'has_more')::BOOLEAN
  AND :'p7a_empty_search'::JSONB -> 'rows' = '[]'::JSONB
  AND (:'p7a_empty_export'::JSONB ->> 'row_count')::INTEGER = 0
  AND :'p7a_empty_export'::JSONB -> 'rows' = '[]'::JSONB
  AND :'p7a_empty_export'::JSONB -> 'snapshot_id' = 'null'::JSONB
  AND :'p7a_empty_export'::JSONB -> 'snapshot_created_at' = 'null'::JSONB
  AND :'p7a_empty_export'::JSONB ->> 'row_set_sha256' =
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  'empty export receipt/hash semantics drifted'
);

-- More than 5,000 eligible rows fail visibly rather than truncating, and no
-- receipt/event survives the failed transaction statement.
INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state, reason,
  request_id, created_at
)
SELECT
  gen_random_uuid(), :'p7a_org_a_id', 'system', NULL, 'system:p7a-cap-probe',
  'case.create', 'student_case', gen_random_uuid(), NULL, '{}',
  'P7A 5001 row cap probe', gen_random_uuid(),
  TIMESTAMPTZ '2042-01-01 00:00:00+00' +
    (sequence_number * INTERVAL '1 second')
FROM generate_series(1, 5001) AS sequence_number;

SELECT created_at AS p7a_over_cap_snapshot_created_at,
  id AS p7a_over_cap_snapshot_id
FROM platform.audit_events
WHERE organization_id = :'p7a_org_a_id'
  AND action = 'case.create'
  AND resource_type = 'student_case'
  AND created_at >= TIMESTAMPTZ '2042-01-01 00:00:00+00'
  AND created_at < TIMESTAMPTZ '2042-01-02 00:00:00+00'
ORDER BY created_at DESC, id DESC
LIMIT 1
\gset

\set p7a_over_cap_request_id '71000000-0000-4000-8000-000000000403'
\set ON_ERROR_STOP off
SET request.jwt.claims TO :'p7a_admin_a_claims';
SET ROLE authenticated;
SAVEPOINT expect_p7a_over_cap;
SELECT platform.export_audit_events(
  :'p7a_over_cap_request_id',
  TIMESTAMPTZ '2042-01-01 00:00:00+00',
  TIMESTAMPTZ '2042-01-02 00:00:00+00',
  NULL,
  NULL,
  NULL,
  :'p7a_over_cap_snapshot_created_at'::TIMESTAMPTZ,
  :'p7a_over_cap_snapshot_id'::UUID
);
\set p7a_over_cap_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_over_cap;
RELEASE SAVEPOINT expect_p7a_over_cap;
RESET ROLE;
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'p7a_over_cap_state' = '54000'
  AND NOT EXISTS (
    SELECT 1 FROM platform_private.audit_export_replays
    WHERE request_id = :'p7a_over_cap_request_id'
  )
  AND NOT EXISTS (
    SELECT 1 FROM platform.audit_events
    WHERE request_id = :'p7a_over_cap_request_id'
  ),
  'over-cap export truncated or retained side effects'
);

-- The private receipt itself remains append-only, including TRUNCATE.
\set ON_ERROR_STOP off
SAVEPOINT expect_p7a_replay_update_denied;
UPDATE platform_private.audit_export_replays
SET row_count = row_count
WHERE request_id = :'p7a_export_request_id';
\set p7a_replay_update_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_replay_update_denied;
RELEASE SAVEPOINT expect_p7a_replay_update_denied;
SAVEPOINT expect_p7a_replay_truncate_denied;
TRUNCATE platform_private.audit_export_replays;
\set p7a_replay_truncate_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_p7a_replay_truncate_denied;
RELEASE SAVEPOINT expect_p7a_replay_truncate_denied;
\set ON_ERROR_STOP on
SELECT pg_temp.assert_true(
  :'p7a_replay_update_state' = '55000'
  AND :'p7a_replay_truncate_state' = '55000',
  'private export replay receipt is not append-only'
);

ROLLBACK;
