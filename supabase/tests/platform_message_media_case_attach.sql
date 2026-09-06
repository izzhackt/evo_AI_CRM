\set ON_ERROR_STOP on

-- Migration 121 boundary proof. Fixtures are synthetic, isolated and rolled
-- back; no provider, Storage byte or production state is touched.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p121_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 121 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p121_capture_error(
  p_statement TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'sqlstate', SQLSTATE,
    'message', SQLERRM
  );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p121_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p121_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  intents_oid OID :=
    'platform_private.message_media_attachment_intents'::REGCLASS;
  completions_oid OID :=
    'platform_private.message_media_attachment_completions'::REGCLASS;
  reserve_rpc_oid OID := (
    'platform.reserve_message_media_attachment(uuid,uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE
  )::OID;
  complete_rpc_oid OID := (
    'platform.complete_message_media_attachment(uuid,uuid,uuid,uuid)'::REGPROCEDURE
  )::OID;
  checked_table OID;
  checked_role TEXT;
BEGIN
  FOREACH checked_table IN ARRAY ARRAY[intents_oid, completions_oid]
  LOOP
    IF NOT (
      SELECT class.relrowsecurity AND class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
      WHERE class.oid = checked_table
    ) THEN
      RAISE EXCEPTION 'attachment ledger RLS must be enabled and forced';
    END IF;

    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(checked_role, checked_table, 'SELECT')
        OR pg_catalog.has_table_privilege(checked_role, checked_table, 'INSERT')
        OR pg_catalog.has_table_privilege(checked_role, checked_table, 'UPDATE')
        OR pg_catalog.has_table_privilege(checked_role, checked_table, 'DELETE')
      THEN
        RAISE EXCEPTION '% unexpectedly holds attachment ledger privileges',
          checked_role;
      END IF;
    END LOOP;

    IF (
      SELECT count(*)
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = checked_table
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgfoid =
          'platform_private.block_append_only_mutation()'::REGPROCEDURE
    ) <> 2 THEN
      RAISE EXCEPTION 'attachment ledger append-only triggers drifted';
    END IF;
  END LOOP;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND NOT routine.proretset
      AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = reserve_rpc_oid
  ) THEN
    RAISE EXCEPTION 'reserve_message_media_attachment hardening drifted';
  END IF;

  IF pg_catalog.pg_get_function_identity_arguments(reserve_rpc_oid) <>
    'p_organization_id uuid, p_conversation_id uuid, p_communication_media_id uuid, p_student_case_id uuid, p_document_slot_id uuid, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'reserve_message_media_attachment signature drifted';
  END IF;

  IF NOT (
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND NOT routine.proretset
      AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = complete_rpc_oid
  ) THEN
    RAISE EXCEPTION 'complete_message_media_attachment hardening drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'authenticated', reserve_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege('anon', reserve_rpc_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'service_role', reserve_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin', reserve_rpc_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'reserve_message_media_attachment grants drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'service_role', complete_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege('anon', complete_rpc_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'authenticated', complete_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin', complete_rpc_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'complete_message_media_attachment grants drifted';
  END IF;

  IF NOT (
    'document.media.attach.reserve'
      = ANY(platform_private.p7a_safe_audit_actions())
    AND 'document.media.attach.complete'
      = ANY(platform_private.p7a_safe_audit_actions())
    AND platform_private.p7a_safe_audit_actions() = (
      SELECT array_agg(DISTINCT action ORDER BY action)
      FROM unnest(platform_private.p7a_safe_audit_actions()) AS item(action)
    )
  ) THEN
    RAISE EXCEPTION 'media attachment audit actions are incomplete';
  END IF;
END
$catalog_contract$;

\set p121_org_a '59912100-0000-4000-8000-000000000001'
\set p121_org_b '59912100-0000-4000-8000-000000000002'
\set p121_case_a '59912100-0000-4000-8000-000000000011'
\set p121_org_scope_a '59912100-0000-4000-8000-000000000021'
\set p121_org_scope_b '59912100-0000-4000-8000-000000000022'
\set p121_case_scope_a '59912100-0000-4000-8000-000000000023'
\set p121_case_scope_a_v2 '59912100-0000-4000-8000-000000000024'
\set p121_conv_scope_1 '59912100-0000-4000-8000-000000000025'
\set p121_conv_scope_2 '59912100-0000-4000-8000-000000000026'
\set p121_conv_scope_3 '59912100-0000-4000-8000-000000000027'

\set p121_admin_a_user '59912100-0000-4000-8000-000000000101'
\set p121_sales_a_user '59912100-0000-4000-8000-000000000102'
\set p121_curator_a_user '59912100-0000-4000-8000-000000000103'
\set p121_student_a_user '59912100-0000-4000-8000-000000000104'
\set p121_curator_unassigned_user '59912100-0000-4000-8000-000000000105'
\set p121_admin_b_user '59912100-0000-4000-8000-000000000106'

\set p121_admin_a_profile '59912100-0000-4000-8000-000000000201'
\set p121_sales_a_profile '59912100-0000-4000-8000-000000000202'
\set p121_curator_a_profile '59912100-0000-4000-8000-000000000203'
\set p121_student_a_profile '59912100-0000-4000-8000-000000000204'
\set p121_curator_unassigned_profile '59912100-0000-4000-8000-000000000205'
\set p121_admin_b_profile '59912100-0000-4000-8000-000000000206'

\set p121_admin_a_membership '59912100-0000-4000-8000-000000000301'
\set p121_sales_a_membership '59912100-0000-4000-8000-000000000302'
\set p121_curator_a_membership '59912100-0000-4000-8000-000000000303'
\set p121_student_a_membership '59912100-0000-4000-8000-000000000304'
\set p121_curator_unassigned_membership '59912100-0000-4000-8000-000000000305'
\set p121_admin_b_membership '59912100-0000-4000-8000-000000000306'

\set p121_requirement_a '59912100-0000-4000-8000-000000000401'
\set p121_slot_a '59912100-0000-4000-8000-000000000402'
\set p121_lead_a '59912100-0000-4000-8000-000000000411'

\set p121_event_1 '59912100-0000-4000-8000-000000000501'
\set p121_conversation_1 '59912100-0000-4000-8000-000000000511'
\set p121_conversation_2 '59912100-0000-4000-8000-000000000512'
\set p121_conversation_3 '59912100-0000-4000-8000-000000000513'
\set p121_participant_1 '59912100-0000-4000-8000-000000000521'
\set p121_participant_2 '59912100-0000-4000-8000-000000000522'
\set p121_participant_3 '59912100-0000-4000-8000-000000000523'
\set p121_message_1 '59912100-0000-4000-8000-000000000531'
\set p121_message_2 '59912100-0000-4000-8000-000000000532'
\set p121_message_3 '59912100-0000-4000-8000-000000000533'
\set p121_message_4 '59912100-0000-4000-8000-000000000534'
\set p121_message_5 '59912100-0000-4000-8000-000000000535'
\set p121_media_pdf '59912100-0000-4000-8000-000000000541'
\set p121_media_audio '59912100-0000-4000-8000-000000000542'
\set p121_media_pending '59912100-0000-4000-8000-000000000543'
\set p121_media_c2_pdf '59912100-0000-4000-8000-000000000544'
\set p121_media_c3_pdf '59912100-0000-4000-8000-000000000545'
\set p121_media_binding '59912100-0000-4000-8000-000000000551'
\set p121_media_work '59912100-0000-4000-8000-000000000552'
\set p121_media_effect '59912100-0000-4000-8000-000000000553'
\set p121_media_attempt '59912100-0000-4000-8000-000000000554'

\set p121_version_1 '59912100-0000-4000-8000-000000000601'
\set p121_version_2 '59912100-0000-4000-8000-000000000602'
\set p121_reservation_1 '59912100-0000-4000-8000-000000000611'
\set p121_binding_1 '59912100-0000-4000-8000-000000000612'
\set p121_finalize_audit_1 '59912100-0000-4000-8000-000000000613'
\set p121_finalization_1 '59912100-0000-4000-8000-000000000614'
\set p121_attestation_1 '59912100-0000-4000-8000-000000000615'

SELECT repeat('ab', 32) AS p121_media_sha
\gset
SELECT repeat('cd', 32) AS p121_other_sha
\gset

SELECT bundle.id AS p121_admin_bundle, bundle.version AS p121_admin_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p121_sales_bundle, bundle.version AS p121_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p121_curator_bundle, bundle.version AS p121_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p121_student_bundle, bundle.version AS p121_student_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p121_org_a', 'Migration 121 Organization A'),
  (:'p121_org_b', 'Migration 121 Organization B');

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (:'p121_admin_a_user', 'p121-admin-a@example.invalid', '{}'),
  (:'p121_sales_a_user', 'p121-sales-a@example.invalid', '{}'),
  (:'p121_curator_a_user', 'p121-curator-a@example.invalid', '{}'),
  (:'p121_student_a_user', 'p121-student-a@example.invalid', '{}'),
  (
    :'p121_curator_unassigned_user',
    'p121-curator-unassigned@example.invalid',
    '{}'
  ),
  (:'p121_admin_b_user', 'p121-admin-b@example.invalid', '{}');

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
)
VALUES
  (:'p121_admin_a_profile', :'p121_admin_a_user', 'P121 Admin A', 'active', 1),
  (:'p121_sales_a_profile', :'p121_sales_a_user', 'P121 Sales A', 'active', 1),
  (
    :'p121_curator_a_profile', :'p121_curator_a_user',
    'P121 Admissions A', 'active', 1
  ),
  (
    :'p121_student_a_profile', :'p121_student_a_user',
    'P121 Student A', 'active', 1
  ),
  (
    :'p121_curator_unassigned_profile', :'p121_curator_unassigned_user',
    'P121 Unassigned Admissions', 'active', 1
  ),
  (:'p121_admin_b_profile', :'p121_admin_b_user', 'P121 Admin B', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
)
VALUES
  (
    :'p121_admin_a_membership', :'p121_org_a', :'p121_admin_a_profile',
    'active', 'admin', :'p121_admin_bundle'
  ),
  (
    :'p121_sales_a_membership', :'p121_org_a', :'p121_sales_a_profile',
    'active', 'sales', :'p121_sales_bundle'
  ),
  (
    :'p121_curator_a_membership', :'p121_org_a', :'p121_curator_a_profile',
    'active', 'curator', :'p121_curator_bundle'
  ),
  (
    :'p121_student_a_membership', :'p121_org_a', :'p121_student_a_profile',
    'active', 'student', :'p121_student_bundle'
  ),
  (
    :'p121_curator_unassigned_membership', :'p121_org_a',
    :'p121_curator_unassigned_profile', 'active', 'curator',
    :'p121_curator_bundle'
  ),
  (
    :'p121_admin_b_membership', :'p121_org_b', :'p121_admin_b_profile',
    'active', 'admin', :'p121_admin_bundle'
  );

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p121_org_scope_a', :'p121_org_a', 'organization', :'p121_org_a', 1),
  (:'p121_org_scope_b', :'p121_org_b', 'organization', :'p121_org_b', 1),
  (:'p121_case_scope_a', :'p121_org_a', 'student_case', :'p121_case_a', 1),
  (
    :'p121_conv_scope_1', :'p121_org_a', 'conversation',
    :'p121_conversation_1', 1
  ),
  (
    :'p121_conv_scope_2', :'p121_org_a', 'conversation',
    :'p121_conversation_2', 1
  ),
  (
    :'p121_conv_scope_3', :'p121_org_a', 'conversation',
    :'p121_conversation_3', 1
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59912100-0000-4000-8000-000000000701', :'p121_org_a',
    :'p121_admin_a_membership', :'p121_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 org admin scope',
    '59912100-0000-4000-8000-000000000801'
  ),
  (
    '59912100-0000-4000-8000-000000000702', :'p121_org_b',
    :'p121_admin_b_membership', :'p121_org_scope_b', 1, 1, TRUE,
    'system', NULL, 'Migration 121 org admin scope',
    '59912100-0000-4000-8000-000000000802'
  ),
  (
    '59912100-0000-4000-8000-000000000703', :'p121_org_a',
    :'p121_sales_a_membership', :'p121_case_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 sales case scope',
    '59912100-0000-4000-8000-000000000803'
  ),
  (
    '59912100-0000-4000-8000-000000000704', :'p121_org_a',
    :'p121_curator_a_membership', :'p121_case_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 curator case scope',
    '59912100-0000-4000-8000-000000000804'
  ),
  (
    '59912100-0000-4000-8000-000000000705', :'p121_org_a',
    :'p121_curator_unassigned_membership', :'p121_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 unassigned Admissions runtime scope',
    '59912100-0000-4000-8000-000000000805'
  );

INSERT INTO platform.leads (
  id, organization_id, stage_key, source_key
)
VALUES (:'p121_lead_a', :'p121_org_a', 'new', 'whatsapp');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, closed_at, next_action, current_scope_id,
  current_scope_version, canonical_lead_id
)
VALUES (
  :'p121_case_a', :'p121_org_a', :'p121_student_a_membership',
  :'p121_sales_a_membership', NULL,
  'synthetic:p121:case:a', 'synthetic:p121:contract:a', statement_timestamp(),
  'P121 Student A', 'United Kingdom', 'Bachelor', 'Business',
  '2027 Fall', 'approved', 'contract_confirmed', 'pending', NULL,
  NULL, NULL, 'Prepare handoff', :'p121_case_scope_a', 1,
  :'p121_lead_a'
);

UPDATE platform.record_scopes AS scope
SET is_active = FALSE
WHERE scope.id = :'p121_case_scope_a';

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
)
VALUES
  (:'p121_case_scope_a_v2', :'p121_org_a', 'student_case', :'p121_case_a', 2);

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
)
VALUES
  (
    '59912100-0000-4000-8000-000000000706', :'p121_org_a',
    :'p121_curator_a_membership', :'p121_case_scope_a_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 121 active curator case scope',
    '59912100-0000-4000-8000-000000000806'
  ),
  (
    '59912100-0000-4000-8000-000000000707', :'p121_org_a',
    :'p121_curator_unassigned_membership', :'p121_case_scope_a_v2', 2, 1, TRUE,
    'system', NULL, 'Migration 121 unassigned Admissions case scope',
    '59912100-0000-4000-8000-000000000807'
  );

UPDATE platform.student_cases AS student_case
SET
  current_curator_membership_id = :'p121_curator_a_membership',
  operational_stage = 'documents',
  state = 'active',
  handoff_at = statement_timestamp(),
  portal_activated_at = statement_timestamp(),
  next_action = 'Collect documents',
  current_scope_id = :'p121_case_scope_a_v2',
  current_scope_version = 2
WHERE student_case.id = :'p121_case_a';

INSERT INTO platform.document_requirements (
  id, organization_id, target_country, target_degree, program_direction,
  checklist_version, requirement_key, label, instructions, status,
  created_by_membership_id
)
VALUES (
  :'p121_requirement_a', :'p121_org_a', 'United Kingdom', 'Bachelor',
  'Business', 1, 'passport', 'Passport', 'Upload a clear passport scan.',
  'active', :'p121_admin_a_membership'
);

INSERT INTO platform.document_slots (
  id, organization_id, student_case_id, requirement_id, status,
  created_by_membership_id
)
VALUES (
  :'p121_slot_a', :'p121_org_a', :'p121_case_a',
  :'p121_requirement_a', 'required', :'p121_curator_a_membership'
);

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256,
  request_id
) VALUES (
  :'p121_event_1', :'p121_org_a', 'waha',
  'waha:evo-inbox', NULL, NULL, 'synthetic:p121:event:1',
  'evo-inbox', 'p121-event-1', 'history.message',
  '2026-09-01T09:00:00+00:00', 'missing',
  '{"provenance":"api_history","read_only":true,"session":"evo-inbox"}',
  '{"provenance":"api_history","webhook_verified":false,"read_only":true}',
  'api-history-read:p121-test', repeat('ef', 32),
  '59912100-0000-4000-8000-000000000901'
);

-- Conversation 1 is directly case-bound in the curator queue. Conversation 2
-- carries only the case's canonical lead. Conversation 3 is unlinked.
INSERT INTO platform.communication_conversations (
  id, organization_id, student_case_id, responsible_sales_membership_id,
  sales_authority_source, current_curator_membership_id, queue, status,
  subject, waha_session_name, kommo_account_id, kommo_conversation_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  canonical_lead_id, current_scope_id, current_scope_version,
  created_from_webhook_event_id
)
VALUES
  (
    :'p121_conversation_1', :'p121_org_a', :'p121_case_a',
    :'p121_sales_a_membership', 'provider_linked',
    :'p121_curator_a_membership', 'curator', 'open',
    'P121 case conversation', 'evo-inbox', NULL, NULL,
    910000001, 910000002, 910000003,
    NULL, :'p121_conv_scope_1', 1, :'p121_event_1'
  ),
  (
    :'p121_conversation_2', :'p121_org_a', NULL,
    :'p121_sales_a_membership', 'provider_linked',
    NULL, 'sales', 'open',
    'P121 canonical lead conversation', 'evo-inbox', NULL, NULL,
    910000004, 910000005, 910000006,
    :'p121_lead_a', :'p121_conv_scope_2', 1, :'p121_event_1'
  ),
  (
    :'p121_conversation_3', :'p121_org_a', NULL,
    :'p121_sales_a_membership', 'provider_linked',
    NULL, 'sales', 'open',
    'P121 unlinked conversation', 'evo-inbox', NULL, NULL,
    910000007, 910000008, 910000009,
    NULL, :'p121_conv_scope_3', 1, :'p121_event_1'
  );

INSERT INTO platform.conversation_participants (
  id, organization_id, conversation_id, participant_kind,
  membership_id, external_subject_ref, source_webhook_event_id
)
VALUES
  (
    :'p121_participant_1', :'p121_org_a', :'p121_conversation_1',
    'customer', NULL, 'opaque:p121:customer:1', :'p121_event_1'
  ),
  (
    :'p121_participant_2', :'p121_org_a', :'p121_conversation_2',
    'customer', NULL, 'opaque:p121:customer:2', :'p121_event_1'
  ),
  (
    :'p121_participant_3', :'p121_org_a', :'p121_conversation_3',
    'customer', NULL, 'opaque:p121:customer:3', :'p121_event_1'
  );

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id
)
VALUES
  (
    :'p121_message_1', :'p121_org_a', :'p121_conversation_1', :'p121_case_a',
    :'p121_participant_1', 'inbound', '[media message]', 'undetermined',
    FALSE, 'private_waha_binding', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_2', :'p121_org_a', :'p121_conversation_1', :'p121_case_a',
    :'p121_participant_1', 'inbound', '[voice message]', 'undetermined',
    FALSE, 'private_waha_binding', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_3', :'p121_org_a', :'p121_conversation_1', :'p121_case_a',
    :'p121_participant_1', 'inbound', '[pending media]', 'undetermined',
    FALSE, 'private_waha_binding', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_4', :'p121_org_a', :'p121_conversation_2', NULL,
    :'p121_participant_2', 'inbound', '[lead media]', 'undetermined',
    FALSE, 'private_waha_binding', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_5', :'p121_org_a', :'p121_conversation_3', NULL,
    :'p121_participant_3', 'inbound', '[unlinked media]', 'undetermined',
    FALSE, 'private_waha_binding', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  );

INSERT INTO platform.communication_message_media (
  id, organization_id, conversation_id, communication_message_id, ordinal,
  media_kind, mime_type, file_name, file_size_bytes, archival_status,
  archived_at
)
VALUES
  (
    :'p121_media_pdf', :'p121_org_a', :'p121_conversation_1',
    :'p121_message_1', 0, 'pdf', 'application/pdf', 'offer.pdf', 2048,
    'archived', statement_timestamp()
  ),
  (
    :'p121_media_audio', :'p121_org_a', :'p121_conversation_1',
    :'p121_message_2', 0, 'audio', 'audio/ogg', 'voice.ogg', 4096,
    'archived', statement_timestamp()
  ),
  (
    :'p121_media_pending', :'p121_org_a', :'p121_conversation_1',
    :'p121_message_3', 0, 'file', NULL, NULL, NULL, 'pending', NULL
  ),
  (
    :'p121_media_c2_pdf', :'p121_org_a', :'p121_conversation_2',
    :'p121_message_4', 0, 'pdf', 'application/pdf', 'lead-offer.pdf', 1024,
    'archived', statement_timestamp()
  ),
  (
    :'p121_media_c3_pdf', :'p121_org_a', :'p121_conversation_3',
    :'p121_message_5', 0, 'pdf', 'application/pdf', 'unlinked.pdf', 1024,
    'archived', statement_timestamp()
  );

-- Private archive evidence for the primary media object: the completion RPC
-- must verify the copied document hash against this exact archived hash.
INSERT INTO platform_private.waha_media_object_bindings (
  id, organization_id, media_id, communication_message_id,
  source_webhook_event_id, waha_session_name, raw_chat_id, raw_message_id,
  bucket_id, object_name
) VALUES (
  :'p121_media_binding', :'p121_org_a', :'p121_media_pdf',
  :'p121_message_1', :'p121_event_1', 'evo-inbox', '77010000001@c.us',
  'p121-raw-message-1', 'platform-whatsapp-media',
  'aa/' || repeat('0', 62)
);

INSERT INTO platform_private.waha_media_archive_work (
  id, organization_id, media_id, object_binding_id, state, attempt_count
) VALUES (
  :'p121_media_work', :'p121_org_a', :'p121_media_pdf',
  :'p121_media_binding', 'archived', 1
);

INSERT INTO platform_private.waha_media_archive_effects (
  id, organization_id, work_id, attempt_id, outcome, error_code,
  media_kind, mime_type, file_name, file_size_bytes, sha256_hex,
  input_sha256, response, request_id
) VALUES (
  :'p121_media_effect', :'p121_org_a', :'p121_media_work',
  :'p121_media_attempt', 'archived', NULL,
  'pdf', 'application/pdf', 'offer.pdf', 2048, :'p121_media_sha',
  repeat('01', 32), '{"outcome":"archived"}',
  '59912100-0000-4000-8000-000000000902'
);

SELECT
  jsonb_build_object(
    'sub', :'p121_curator_a_user',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_curator_a_membership',
    'platform_bundle_id', :'p121_curator_bundle',
    'platform_bundle_version', :'p121_curator_bundle_version'::INTEGER
  )::TEXT AS p121_curator_a_claims,
  jsonb_build_object(
    'sub', :'p121_curator_unassigned_user',
    'role', 'authenticated',
    'platform_role', 'curator',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_curator_unassigned_membership',
    'platform_bundle_id', :'p121_curator_bundle',
    'platform_bundle_version', :'p121_curator_bundle_version'::INTEGER
  )::TEXT AS p121_curator_unassigned_claims,
  jsonb_build_object(
    'sub', :'p121_sales_a_user',
    'role', 'authenticated',
    'platform_role', 'sales',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_sales_a_membership',
    'platform_bundle_id', :'p121_sales_bundle',
    'platform_bundle_version', :'p121_sales_bundle_version'::INTEGER
  )::TEXT AS p121_sales_a_claims,
  jsonb_build_object(
    'sub', :'p121_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_admin_a_membership',
    'platform_bundle_id', :'p121_admin_bundle',
    'platform_bundle_version', :'p121_admin_bundle_version'::INTEGER
  )::TEXT AS p121_admin_a_claims
\gset

SET ROLE anon;
SET request.jwt.claims TO '{}';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_pdf',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000911'
    ))->>'sqlstate'
  ) = '42501',
  'anon must not execute the media attach reserve RPC'
);

RESET ROLE;
SET request.jwt.claims TO :'p121_sales_a_claims';
SET ROLE authenticated;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_pdf',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000912'
    ))->>'sqlstate'
  ) = '42501',
  'sales must not reserve media attachments on an active case'
);

SET request.jwt.claims TO :'p121_curator_unassigned_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_pdf',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000913'
    ))->>'sqlstate'
  ) = '42501',
  'Admissions without the current case assignment must fail closed'
);

SET request.jwt.claims TO :'p121_curator_a_claims';

SELECT platform.reserve_message_media_attachment(
  :'p121_org_a', :'p121_conversation_1', :'p121_media_pdf',
  :'p121_case_a', :'p121_slot_a',
  '59912100-0000-4000-8000-000000000921'
)::TEXT AS p121_reserve
\gset

SELECT platform.reserve_message_media_attachment(
  :'p121_org_a', :'p121_conversation_1', :'p121_media_pdf',
  :'p121_case_a', :'p121_slot_a',
  '59912100-0000-4000-8000-000000000921'
)::TEXT AS p121_reserve_replay
\gset

SELECT pg_temp.p121_assert(
  :'p121_reserve'::JSONB = :'p121_reserve_replay'::JSONB
  AND :'p121_reserve'::JSONB @> jsonb_build_object(
    'organization_id', :'p121_org_a'::UUID,
    'conversation_id', :'p121_conversation_1'::UUID,
    'communication_media_id', :'p121_media_pdf'::UUID,
    'student_case_id', :'p121_case_a'::UUID,
    'document_slot_id', :'p121_slot_a'::UUID,
    'media_mime_type', 'application/pdf',
    'media_file_name', 'offer.pdf',
    'media_file_size_bytes', '2048',
    'slot_status', 'required',
    'request_id', '59912100-0000-4000-8000-000000000921'::UUID
  )
  AND (:'p121_reserve'::JSONB ->> 'attachment_intent_id') IS NOT NULL
  AND position('object_name' IN :'p121_reserve') = 0
  AND position('platform-whatsapp-media' IN :'p121_reserve') = 0,
  'reserve must return one stable receipt without object identity'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_audio',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000921'
    ))->>'sqlstate'
  ) = '22023',
  'same request id with a changed payload must fail closed'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_audio',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000922'
    ))->>'sqlstate'
  ) = '22023',
  'non-document media kinds must be rejected as unattachable'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_pending',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000923'
    ))->>'sqlstate'
  ) = '42501',
  'unarchived media must be unavailable for attachment'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_3', :'p121_media_c3_pdf',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000924'
    ))->>'sqlstate'
  ) = '42501',
  'media from an unlinked conversation must not attach to the case'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a', :'p121_conversation_1', :'p121_media_c2_pdf',
      :'p121_case_a', :'p121_slot_a',
      '59912100-0000-4000-8000-000000000925'
    ))->>'sqlstate'
  ) = '42501',
  'a media/conversation mismatch must fail closed'
);

SET request.jwt.claims TO :'p121_admin_a_claims';

SELECT platform.reserve_message_media_attachment(
  :'p121_org_a', :'p121_conversation_2', :'p121_media_c2_pdf',
  :'p121_case_a', :'p121_slot_a',
  '59912100-0000-4000-8000-000000000926'
)::TEXT AS p121_admin_reserve
\gset

SELECT pg_temp.p121_assert(
  :'p121_admin_reserve'::JSONB @> jsonb_build_object(
    'conversation_id', :'p121_conversation_2'::UUID,
    'communication_media_id', :'p121_media_c2_pdf'::UUID,
    'student_case_id', :'p121_case_a'::UUID,
    'media_file_name', 'lead-offer.pdf'
  ),
  'admin must attach media from a canonical-lead-linked conversation'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id'),
      :'p121_version_1',
      '59912100-0000-4000-8000-000000000931'
    ))->>'sqlstate'
  ) = '42501',
  'authenticated actors must not execute the completion RPC'
);

RESET ROLE;
RESET request.jwt.claims;

-- Publish one document version through the canonical pipeline shape: version,
-- reservation, storage binding, finalization and a durable clean scan proof.
INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id,
  integrity_status, malware_status
) VALUES (
  :'p121_version_1', :'p121_org_a', :'p121_case_a', :'p121_slot_a', 1,
  'offer.pdf', 'application/pdf', 2048, :'p121_media_sha',
  'storage-reservation:' || :'p121_reservation_1', :'p121_curator_a_membership',
  'pending', 'pending'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id'),
      :'p121_version_1',
      '59912100-0000-4000-8000-000000000932'
    ))->>'sqlstate'
  ) = '55000',
  'completion without a durable clean scan proof must fail closed'
);

RESET ROLE;
RESET request.jwt.claims;

INSERT INTO platform_private.document_upload_reservations (
  id, request_id, organization_id, student_case_id, document_slot_id,
  document_version_id, uploader_profile_id, uploader_membership_id,
  uploader_auth_user_id, bucket_id, object_name, declared_mime_type,
  byte_size, sha256_hex, expires_at, ingress_scan_required
) VALUES (
  :'p121_reservation_1', '59912100-0000-4000-8000-000000000941',
  :'p121_org_a', :'p121_case_a', :'p121_slot_a', :'p121_version_1',
  :'p121_curator_a_profile', :'p121_curator_a_membership',
  :'p121_curator_a_user', 'platform-documents',
  'bb/' || repeat('1', 62), 'application/pdf', 2048, :'p121_media_sha',
  statement_timestamp() + INTERVAL '10 minutes', FALSE
);

INSERT INTO platform_private.document_storage_bindings (
  id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_reservation_id, bucket_id, object_name
) VALUES (
  :'p121_binding_1', :'p121_org_a', :'p121_case_a', :'p121_slot_a',
  :'p121_version_1', :'p121_reservation_1', 'platform-documents',
  'bb/' || repeat('1', 62)
);

INSERT INTO platform.audit_events (
  id, organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state, reason,
  request_id
) VALUES (
  :'p121_finalize_audit_1', :'p121_org_a', 'service', NULL, 'service_role',
  'document.upload.finalize', 'document_version', :'p121_version_1',
  NULL, '{"synthetic":true}', 'Migration 121 synthetic finalization',
  '59912100-0000-4000-8000-000000000942'
);

INSERT INTO platform_private.document_upload_finalizations (
  id, request_id, organization_id, upload_reservation_id, student_case_id,
  document_version_id, document_slot_id, finalization_audit_event_id,
  bucket_id, object_name, published_version_no, object_created_at
) VALUES (
  :'p121_finalization_1', '59912100-0000-4000-8000-000000000943',
  :'p121_org_a', :'p121_reservation_1', :'p121_case_a', :'p121_version_1',
  :'p121_slot_a', :'p121_finalize_audit_1', 'platform-documents',
  'bb/' || repeat('1', 62), 1, statement_timestamp()
);

INSERT INTO platform_private.document_malware_scan_attestations (
  id, request_id, organization_id, student_case_id, document_slot_id,
  document_version_id, upload_finalization_id, scanned_sha256_hex,
  scanner_engine, scanner_engine_version, scanner_signature_version,
  scanner_protocol, scanned_at
) VALUES (
  :'p121_attestation_1', '59912100-0000-4000-8000-000000000944',
  :'p121_org_a', :'p121_case_a', :'p121_slot_a', :'p121_version_1',
  :'p121_finalization_1', :'p121_media_sha', 'ClamAV', '1.5.4', '27890',
  'clamd-zinstream-v1', statement_timestamp()
);

UPDATE platform.document_versions
SET
  integrity_status = 'verified',
  malware_status = 'clean',
  malware_scan_attestation_id = :'p121_attestation_1',
  validation_updated_at = statement_timestamp()
WHERE organization_id = :'p121_org_a'
  AND id = :'p121_version_1';

-- A second published version whose hash does not match any archived media.
INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id,
  integrity_status, malware_status
) VALUES (
  :'p121_version_2', :'p121_org_a', :'p121_case_a', :'p121_slot_a', 2,
  'lead-offer.pdf', 'application/pdf', 1024, :'p121_other_sha',
  'storage-reservation:synthetic-p121-2', :'p121_curator_a_membership',
  'pending', 'pending'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      '59912100-0000-4000-8000-000000000999',
      :'p121_version_1',
      '59912100-0000-4000-8000-000000000933'
    ))->>'sqlstate'
  ) = '42501',
  'an unknown attachment intent must fail closed'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      (:'p121_admin_reserve'::JSONB ->> 'attachment_intent_id'),
      :'p121_version_2',
      '59912100-0000-4000-8000-000000000934'
    ))->>'sqlstate'
  ) = '22000',
  'completion must require the exact archived media content hash'
);

SELECT platform.complete_message_media_attachment(
  :'p121_org_a',
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  :'p121_version_1',
  '59912100-0000-4000-8000-000000000935'
)::TEXT AS p121_complete
\gset

SELECT platform.complete_message_media_attachment(
  :'p121_org_a',
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  :'p121_version_1',
  '59912100-0000-4000-8000-000000000935'
)::TEXT AS p121_complete_replay
\gset

SELECT pg_temp.p121_assert(
  :'p121_complete'::JSONB = :'p121_complete_replay'::JSONB
  AND :'p121_complete'::JSONB @> jsonb_build_object(
    'organization_id', :'p121_org_a'::UUID,
    'attachment_intent_id',
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
    'communication_media_id', :'p121_media_pdf'::UUID,
    'student_case_id', :'p121_case_a'::UUID,
    'document_slot_id', :'p121_slot_a'::UUID,
    'document_version_id', :'p121_version_1'::UUID,
    'sha256_hex', :'p121_media_sha',
    'request_id', '59912100-0000-4000-8000-000000000935'::UUID
  ),
  'completion must record and replay one exact receipt'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      (:'p121_admin_reserve'::JSONB ->> 'attachment_intent_id'),
      :'p121_version_1',
      '59912100-0000-4000-8000-000000000935'
    ))->>'sqlstate'
  ) = '23505',
  'same request id with different completion inputs must fail closed'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      :'p121_org_a',
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id'),
      :'p121_version_1',
      '59912100-0000-4000-8000-000000000936'
    ))->>'sqlstate'
  ) = '23505',
  'an already-completed intent must reject a second completion'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'UPDATE platform_private.message_media_attachment_intents SET media_file_name = %L WHERE request_id = %L::uuid',
      'tampered.pdf', '59912100-0000-4000-8000-000000000921'
    ))->>'sqlstate'
  ) = '55000',
  'attachment intents must be append-only'
);

SELECT pg_temp.p121_assert(
  (
    SELECT count(*)
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'p121_org_a'
      AND event.action = 'document.media.attach.reserve'
  ) = 2
  AND (
    SELECT count(*)
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'p121_org_a'
      AND event.action = 'document.media.attach.complete'
  ) = 1,
  'each real reserve and completion must append exactly one audit event'
);

ROLLBACK;

SELECT 'platform message media case attach checks passed' AS result;
