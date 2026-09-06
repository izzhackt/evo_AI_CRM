\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 119. Every row is synthetic and
-- the transaction is rolled back; no managed Supabase project is touched.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.p119_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 119 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p119_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN pg_catalog.jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p119_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p119_capture_error(TEXT)
  TO authenticated, service_role;

-- The exposed functions are invoker wrappers. Their private helpers retain
-- the privileged bodies, and only authenticated staff can execute either hop.
DO $catalog_contract$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  FOR contract IN
    SELECT *
    FROM (
      VALUES
        (
          'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text)',
          TRUE,
          6
        ),
        (
          'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text)',
          FALSE,
          6
        ),
        (
          'platform.staff_communication_snapshot(uuid,uuid)',
          FALSE,
          0
        ),
        (
          'private.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
          TRUE,
          8
        ),
        (
          'platform.staff_sales_lead_page(integer,timestamp with time zone,uuid,text,text,text,uuid,text,text)',
          FALSE,
          8
        ),
        (
          'private.staff_case_task_queue(integer,timestamp with time zone,uuid,date,date)',
          TRUE,
          4
        ),
        (
          'platform.staff_case_task_queue(integer,timestamp with time zone,uuid,date,date)',
          FALSE,
          4
        )
    ) AS expected(signature, security_definer, default_argument_count)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature)::OID;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 119 RPC signature is missing: %',
        contract.signature;
    END IF;

    SELECT routine.*
    INTO STRICT routine_row
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid;

    IF routine_row.prosecdef IS DISTINCT FROM contract.security_definer
      OR routine_row.provolatile <> 's'
      OR routine_row.prokind <> 'f'
      OR NOT routine_row.proretset
      OR routine_row.proconfig IS DISTINCT FROM
        ARRAY['search_path=""']::TEXT[]
      OR routine_row.pronargdefaults <> contract.default_argument_count
    THEN
      RAISE EXCEPTION 'Migration 119 hardening/default contract drifted: %',
        contract.signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated lost EXECUTE on %', contract.signature;
    END IF;

    IF (
      SELECT pg_catalog.count(*) = 2
        AND pg_catalog.bool_and(
          acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
          AND acl.grantor = routine_row.proowner
          AND acl.grantee IN (
            routine_row.proowner,
            'authenticated'::REGROLE::OID
          )
        )
        AND pg_catalog.count(*) FILTER (
          WHERE acl.grantee = routine_row.proowner
        ) = 1
        AND pg_catalog.count(*) FILTER (
          WHERE acl.grantee = 'authenticated'::REGROLE::OID
        ) = 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          routine_row.proacl,
          pg_catalog.acldefault('f', routine_row.proowner)
        )
      ) AS acl
    ) IS DISTINCT FROM TRUE
    THEN
      RAISE EXCEPTION 'Migration 119 exact function ACL drifted: %',
        contract.signature;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF pg_catalog.has_function_privilege(
        forbidden_role, routine_oid, 'EXECUTE'
      ) THEN
        RAISE EXCEPTION '% unexpectedly has EXECUTE on %',
          forbidden_role,
          contract.signature;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.to_regprocedure(
      'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid)'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'platform.staff_case_task_queue(integer)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'A superseded migration 078/110 overload remains callable';
  END IF;

  IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = 'staff_communication_page'
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = 'staff_sales_lead_page'
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = 'staff_case_task_queue'
    ) <> 1
  THEN
    RAISE EXCEPTION 'Migration 119 exposed an ambiguous RPC overload';
  END IF;
END
$catalog_contract$;

-- Reuse the published role bundles instead of pinning a historical version.
SELECT bundle.id AS p119_admin_bundle, bundle.version AS p119_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p119_sales_bundle, bundle.version AS p119_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p119_curator_bundle, bundle.version AS p119_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p119_student_bundle, bundle.version AS p119_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p119_org 59911900-0000-4000-8000-000000000001
\set p119_org_scope 59911900-0000-4000-8000-000000000002
\set p119_case_scope 59911900-0000-4000-8000-000000000003
\set p119_case 59911900-0000-4000-8000-000000000004
\set p119_foreign_org 59911900-0000-4000-8000-000000000006
\set p119_foreign_org_scope 59911900-0000-4000-8000-000000000007

\set p119_admin_user 59911900-0000-4000-8000-000000000011
\set p119_sales_user 59911900-0000-4000-8000-000000000012
\set p119_sales_other_user 59911900-0000-4000-8000-000000000013
\set p119_curator_user 59911900-0000-4000-8000-000000000014
\set p119_student_user 59911900-0000-4000-8000-000000000015
\set p119_foreign_admin_user 59911900-0000-4000-8000-000000000016

\set p119_admin_profile 59911900-0000-4000-8000-000000000021
\set p119_sales_profile 59911900-0000-4000-8000-000000000022
\set p119_sales_other_profile 59911900-0000-4000-8000-000000000023
\set p119_curator_profile 59911900-0000-4000-8000-000000000024
\set p119_student_profile 59911900-0000-4000-8000-000000000025
\set p119_foreign_admin_profile 59911900-0000-4000-8000-000000000026

\set p119_admin_membership 59911900-0000-4000-8000-000000000031
\set p119_sales_membership 59911900-0000-4000-8000-000000000032
\set p119_sales_other_membership 59911900-0000-4000-8000-000000000033
\set p119_curator_membership 59911900-0000-4000-8000-000000000034
\set p119_student_membership 59911900-0000-4000-8000-000000000035
\set p119_foreign_admin_membership 59911900-0000-4000-8000-000000000036

INSERT INTO platform.organizations (id, name)
VALUES
  (:'p119_org', 'Migration 119 Organization'),
  (:'p119_foreign_org', 'Migration 119 Foreign Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p119_org_scope', :'p119_org', 'organization', :'p119_org', 1),
  (:'p119_case_scope', :'p119_org', 'student_case', :'p119_case', 1),
  (
    :'p119_foreign_org_scope', :'p119_foreign_org',
    'organization', :'p119_foreign_org', 1
  );

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p119_admin_user', 'p119-admin@example.invalid', '{}'::JSONB),
  (:'p119_sales_user', 'p119-sales@example.invalid', '{}'::JSONB),
  (:'p119_sales_other_user', 'p119-sales-other@example.invalid', '{}'::JSONB),
  (:'p119_curator_user', 'p119-curator@example.invalid', '{}'::JSONB),
  (:'p119_student_user', 'p119-student@example.invalid', '{}'::JSONB),
  (
    :'p119_foreign_admin_user',
    'p119-foreign-admin@example.invalid',
    '{}'::JSONB
  );

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p119_admin_profile', :'p119_admin_user', 'P119 Admin', 'active', 1),
  (:'p119_sales_profile', :'p119_sales_user', 'P119 Sales', 'active', 1),
  (:'p119_sales_other_profile', :'p119_sales_other_user', 'P119 Sales Other', 'active', 1),
  (:'p119_curator_profile', :'p119_curator_user', 'P119 Curator', 'active', 1),
  (:'p119_student_profile', :'p119_student_user', 'P119 Student', 'active', 1),
  (
    :'p119_foreign_admin_profile', :'p119_foreign_admin_user',
    'P119 Foreign Admin', 'active', 1
  );

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p119_admin_membership', :'p119_org', :'p119_admin_profile', 'active', 'admin', :'p119_admin_bundle'),
  (:'p119_sales_membership', :'p119_org', :'p119_sales_profile', 'active', 'sales', :'p119_sales_bundle'),
  (:'p119_sales_other_membership', :'p119_org', :'p119_sales_other_profile', 'active', 'sales', :'p119_sales_bundle'),
  (:'p119_curator_membership', :'p119_org', :'p119_curator_profile', 'active', 'curator', :'p119_curator_bundle'),
  (:'p119_student_membership', :'p119_org', :'p119_student_profile', 'active', 'student', :'p119_student_bundle'),
  (
    :'p119_foreign_admin_membership', :'p119_foreign_org',
    :'p119_foreign_admin_profile', 'active', 'admin', :'p119_admin_bundle'
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911900-0000-4000-8000-000000000041', :'p119_org', :'p119_admin_membership', :'p119_org_scope', 1, 1, TRUE, 'system', NULL, 'P119 admin scope', '59911900-0000-4000-8000-000000000141'),
  ('59911900-0000-4000-8000-000000000042', :'p119_org', :'p119_sales_membership', :'p119_org_scope', 1, 1, TRUE, 'system', NULL, 'P119 sales scope', '59911900-0000-4000-8000-000000000142'),
  ('59911900-0000-4000-8000-000000000043', :'p119_org', :'p119_sales_other_membership', :'p119_org_scope', 1, 1, TRUE, 'system', NULL, 'P119 other sales scope', '59911900-0000-4000-8000-000000000143'),
  ('59911900-0000-4000-8000-000000000044', :'p119_org', :'p119_curator_membership', :'p119_case_scope', 1, 1, TRUE, 'system', NULL, 'P119 curator scope', '59911900-0000-4000-8000-000000000144'),
  ('59911900-0000-4000-8000-000000000045', :'p119_org', :'p119_student_membership', :'p119_case_scope', 1, 1, TRUE, 'system', NULL, 'P119 student scope', '59911900-0000-4000-8000-000000000145'),
  (
    '59911900-0000-4000-8000-000000000046', :'p119_foreign_org',
    :'p119_foreign_admin_membership', :'p119_foreign_org_scope', 1, 1,
    TRUE, 'system', NULL, 'P119 foreign admin scope',
    '59911900-0000-4000-8000-000000000146'
  );

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p119_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p119_org',
  'platform_membership_id', :'p119_admin_membership',
  'platform_bundle_id', :'p119_admin_bundle',
  'platform_bundle_version', :'p119_admin_version'::INTEGER
)::TEXT AS p119_admin_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p119_sales_user', 'role', 'authenticated',
  'platform_role', 'sales', 'platform_access_version', 1,
  'platform_organization_id', :'p119_org',
  'platform_membership_id', :'p119_sales_membership',
  'platform_bundle_id', :'p119_sales_bundle',
  'platform_bundle_version', :'p119_sales_version'::INTEGER
)::TEXT AS p119_sales_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p119_curator_user', 'role', 'authenticated',
  'platform_role', 'curator', 'platform_access_version', 1,
  'platform_organization_id', :'p119_org',
  'platform_membership_id', :'p119_curator_membership',
  'platform_bundle_id', :'p119_curator_bundle',
  'platform_bundle_version', :'p119_curator_version'::INTEGER
)::TEXT AS p119_curator_claims
\gset
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p119_foreign_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p119_foreign_org',
  'platform_membership_id', :'p119_foreign_admin_membership',
  'platform_bundle_id', :'p119_admin_bundle',
  'platform_bundle_version', :'p119_admin_version'::INTEGER
)::TEXT AS p119_foreign_admin_claims
\gset

-- Communication fixtures: one canonical-client conversation with a persisted
-- inbound message and one subject-only conversation without messages.
\set p119_client 59911900-0000-4000-8000-000000000101
\set p119_event 59911900-0000-4000-8000-000000000201
\set p119_conversation_client 59911900-0000-4000-8000-000000000211
\set p119_conversation_subject 59911900-0000-4000-8000-000000000212
\set p119_participant 59911900-0000-4000-8000-000000000221
\set p119_message_older 59911900-0000-4000-8000-000000000230
\set p119_message 59911900-0000-4000-8000-000000000231
\set p119_message_tie_winner 59911900-0000-4000-8000-000000000232

INSERT INTO platform.clients (
  id, organization_id, display_name, normalized_name, phone,
  normalized_phone, created_at, updated_at
) VALUES (
  :'p119_client', :'p119_org', 'Айгүл Садыкова',
  platform_private.normalize_person_name('Айгүл Садыкова'),
  '+996 (555) 12-34-56',
  platform_private.normalize_person_phone('+996 (555) 12-34-56'),
  '2026-09-01 08:00:00+00', '2026-09-01 08:00:00+00'
);

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256, request_id
) VALUES (
  :'p119_event', :'p119_org', 'waha', 'waha:crm_primary', NULL, NULL,
  'synthetic:p119:event', 'crm_primary', 'p119-message', 'message.any',
  '2026-09-05 12:00:00+00', 'verified',
  '{"payload":{"fromMe":false,"source":"webhook"}}'::JSONB,
  '{"synthetic":true}'::JSONB, 'p119:verified-fixture', repeat('ab', 32),
  '59911900-0000-4000-8000-000000000202'
);

INSERT INTO platform.communication_conversations (
  id, organization_id, student_case_id, responsible_sales_membership_id,
  sales_authority_source, current_curator_membership_id, queue, status,
  subject, waha_session_name, kommo_account_id, kommo_conversation_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  canonical_client_id, canonical_lead_id, current_scope_id,
  current_scope_version, created_from_webhook_event_id, created_at, updated_at
) VALUES
  (
    :'p119_conversation_client', :'p119_org', NULL,
    :'p119_sales_membership', 'provider_linked', NULL, 'sales', 'open',
    'General consultation', 'crm_primary', NULL, NULL,
    119001, 119002, 119003, :'p119_client', NULL,
    :'p119_org_scope', 1, :'p119_event',
    '2026-09-05 09:00:00+00', '2026-09-05 09:00:00+00'
  ),
  (
    :'p119_conversation_subject', :'p119_org', NULL,
    :'p119_sales_membership', 'provider_linked', NULL, 'sales', 'open',
    'Priority Visa Subject', 'crm_primary', NULL, NULL,
    119011, 119012, 119013, NULL, NULL,
    :'p119_org_scope', 1, :'p119_event',
    '2026-09-05 10:00:00+00', '2026-09-05 10:00:00+00'
  );

INSERT INTO platform.conversation_participants (
  id, organization_id, conversation_id, participant_kind, membership_id,
  external_subject_ref, source_webhook_event_id
) VALUES (
  :'p119_participant', :'p119_org', :'p119_conversation_client',
  'customer', NULL, 'opaque:p119:customer', :'p119_event'
);

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id, created_at
) VALUES
  (
    :'p119_message_older', :'p119_org', :'p119_conversation_client', NULL,
    :'p119_participant', 'inbound', 'Synthetic P119 older', 'ru', FALSE,
    'public_provider_id', 'crm_primary', 'p119-message-older',
    NULL, NULL, NULL, NULL, NULL, NULL, :'p119_event', NULL,
    '2026-09-05 11:00:00+00'
  ),
  (
    :'p119_message', :'p119_org', :'p119_conversation_client', NULL,
    :'p119_participant', 'inbound', 'Synthetic P119 tied lower id', 'ru', FALSE,
    'public_provider_id', 'crm_primary', 'p119-message-lower',
    NULL, NULL, NULL, NULL, NULL, NULL, :'p119_event', NULL,
    '2026-09-05 12:34:56+00'
  );

INSERT INTO platform.manual_send_authorizations (
  id, organization_id, conversation_id, ai_draft_id, source_message_id,
  final_text, final_text_sha256, authorized_by_profile_id,
  authorized_by_membership_id, reason, request_id
) VALUES (
  '59911900-0000-4000-8000-000000000240', :'p119_org',
  :'p119_conversation_client', NULL, :'p119_message',
  'Synthetic P119 tied higher id', repeat('cd', 32),
  :'p119_admin_profile', :'p119_admin_membership',
  'Prove latest-message UUID tie-breaking',
  '59911900-0000-4000-8000-000000000241'
);

INSERT INTO platform.communication_messages (
  id, organization_id, conversation_id, student_case_id,
  sender_participant_id, direction, body_text, language, student_visible,
  message_identity_source, waha_session_name, waha_message_id,
  kommo_account_id, kommo_conversation_id, kommo_message_id,
  amocrm_account_id, amocrm_lead_id, amocrm_contact_id,
  source_webhook_event_id, manual_send_authorization_id, created_at
) VALUES (
  :'p119_message_tie_winner', :'p119_org',
  :'p119_conversation_client', NULL,
  :'p119_participant', 'outbound', 'Synthetic P119 tied higher id',
  'ru', FALSE, 'public_provider_id', 'crm_primary', 'p119-message-winner',
  NULL, NULL, NULL, NULL, NULL, NULL, :'p119_event',
  '59911900-0000-4000-8000-000000000240',
  '2026-09-05 12:34:56+00'
);

SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p119_assert(
  (
    SELECT page.conversation_id = :'p119_conversation_client'::UUID
      AND page.last_message_direction = 'outbound'
      AND page.last_message_at = '2026-09-05 12:34:56+00'::TIMESTAMPTZ
      AND page.sort_at = '2026-09-05 12:34:56+00'::TIMESTAMPTZ
    FROM platform.staff_communication_page(
      p_organization_id => :'p119_org',
      p_limit => 10,
      p_query => '  САДЫКОВА  '
    ) AS page
  ),
  'canonical-client search or latest-message facts drifted'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      p_organization_id => :'p119_org',
      p_limit => 10,
      p_query => '+996 (555) 123-456'
    ) AS page
  ) = ARRAY[:'p119_conversation_client'::UUID],
  'formatted canonical-client phone search drifted'
);

SELECT pg_temp.p119_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_communication_page(
      p_organization_id => :'p119_org',
      p_limit => 10,
      p_query => 'no-such-name 555'
    ) AS page
  ),
  'mixed text query was incorrectly reduced to a partial phone match'
);

SELECT pg_temp.p119_assert(
  (
    SELECT snapshot.conversation_id = :'p119_conversation_subject'::UUID
      AND snapshot.last_message_direction IS NULL
      AND snapshot.last_message_at IS NULL
    FROM platform.staff_communication_snapshot(
      :'p119_org', :'p119_conversation_subject'
    ) AS snapshot
  ),
  'message-free snapshot did not return an exact NULL fact pair'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      p_organization_id => :'p119_org',
      p_limit => 10,
      p_query => 'priority visa'
    ) AS page
  ) = ARRAY[:'p119_conversation_subject'::UUID],
  'stored-subject search drifted'
);

SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_communication_page('
    || quote_literal(:'p119_org') || '::UUID, 10, p_query => repeat(''x'', 201))'
)::TEXT AS p119_long_query_error
\gset

RESET ROLE;
SELECT pg_temp.p119_assert(
  :'p119_long_query_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p119_long_query_error'::JSONB ->> 'message'
      = 'Conversation query is too long',
  'oversized communication search did not fail before reading data'
);

SET request.jwt.claims TO :'p119_foreign_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_communication_page('
    || quote_literal(:'p119_org') || '::UUID, 10)'
)::TEXT AS p119_cross_org_communication_wrapper
\gset
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM private.staff_communication_page('
    || quote_literal(:'p119_org') || '::UUID, 10)'
)::TEXT AS p119_cross_org_communication_helper
\gset
RESET ROLE;

SELECT pg_temp.p119_assert(
  :'p119_cross_org_communication_wrapper'::JSONB ->> 'sqlstate' = '42501'
    AND :'p119_cross_org_communication_helper'::JSONB ->> 'sqlstate'
      = '42501',
  'foreign organization crossed the communication wrapper/helper boundary'
);

-- Sales stage age comes only from canonical workflow receipts plus matching
-- audit events. Creation is the fallback for a never-transitioned lead;
-- owner-only commands do not reset a later stage re-entry.
\set p119_lead_fallback 59911900-0000-4000-8000-000000000102
\set p119_lead_reentry 59911900-0000-4000-8000-000000000103
\set p119_sales_request_1 59911900-0000-4000-8000-000000000401
\set p119_sales_request_2 59911900-0000-4000-8000-000000000402
\set p119_sales_request_3 59911900-0000-4000-8000-000000000403
\set p119_sales_request_4 59911900-0000-4000-8000-000000000404

INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id,
  stage_key, source_key, lifecycle_state, created_at, updated_at
) VALUES
  (
    :'p119_lead_fallback', :'p119_org', NULL, :'p119_sales_membership',
    'new', 'p119', 'open',
    '2026-09-01 06:00:00+00', '2026-09-01 06:00:00+00'
  ),
  (
    :'p119_lead_reentry', :'p119_org', NULL, :'p119_sales_membership',
    'new', 'p119', 'open',
    '2026-09-01 07:00:00+00', '2026-09-01 07:00:00+00'
  );

SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT platform.mutate_sales_lead_workflow(
  :'p119_lead_reentry', 1, :'p119_sales_request_1',
  'qualified', :'p119_sales_membership', NULL, NULL, TRUE,
  'P119 first qualification'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p119_lead_reentry', 2, :'p119_sales_request_2',
  'contacting', :'p119_sales_membership', NULL, NULL, TRUE,
  'P119 leave qualification'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p119_lead_reentry', 3, :'p119_sales_request_3',
  'qualified', :'p119_sales_membership', NULL, NULL, TRUE,
  'P119 re-enter qualification'
);
SELECT platform.mutate_sales_lead_workflow(
  :'p119_lead_reentry', 4, :'p119_sales_request_4',
  'qualified', :'p119_sales_other_membership', NULL, NULL, TRUE,
  'P119 owner-only change'
);

RESET ROLE;
SELECT receipt.created_at::TEXT AS p119_reentry_at
FROM platform_private.sales_lead_workflow_receipts AS receipt
WHERE receipt.request_id = :'p119_sales_request_3'
\gset
SELECT receipt.created_at::TEXT AS p119_owner_only_at
FROM platform_private.sales_lead_workflow_receipts AS receipt
WHERE receipt.request_id = :'p119_sales_request_4'
\gset
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p119_assert(
  (
    SELECT page.stage_entered_at = lead.created_at
    FROM platform.staff_sales_lead_page(20) AS page
    JOIN platform.leads AS lead ON lead.id = page.lead_id
    WHERE page.lead_id = :'p119_lead_fallback'
  ),
  'never-transitioned lead did not fall back to immutable created_at'
);

SELECT pg_temp.p119_assert(
  (
    SELECT page.stage_key = 'qualified'
      AND page.current_owner_membership_id
        = :'p119_sales_other_membership'::UUID
      AND page.stage_entered_at = :'p119_reentry_at'::TIMESTAMPTZ
      AND page.stage_entered_at <> :'p119_owner_only_at'::TIMESTAMPTZ
    FROM platform.staff_sales_lead_page(20) AS page
    WHERE page.lead_id = :'p119_lead_reentry'
  ),
  'current-stage re-entry or owner-only stage age semantics drifted'
);

RESET ROLE;

-- A lead with no workflow receipt is a creation baseline only at version 1.
-- This regression must fail both the old INNER LATERAL join (which omitted the
-- lead) and a naive LEFT LATERAL join whose NULL request id never trips the
-- final PL/pgSQL guard.
SAVEPOINT p119_no_receipt_state_drift;
UPDATE platform.leads
SET
  stage_key = 'contacting',
  workflow_version = 2
WHERE id = :'p119_lead_fallback';
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_no_receipt_state_drift_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_no_receipt_state_drift;
SELECT pg_temp.p119_assert(
  :'p119_no_receipt_state_drift_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_no_receipt_state_drift_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a version-2 lead with no receipt or normalization proof did not fail closed'
);

-- A version-1 creation baseline stops being trustworthy as soon as workflow
-- action state appears without the canonical mutation receipt/audit pair.
SAVEPOINT p119_no_receipt_action_drift;
UPDATE platform.leads
SET
  next_action_text = 'Unproven synthetic action',
  next_action_due_date = '2026-09-10'
WHERE id = :'p119_lead_fallback';
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_no_receipt_action_drift_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_no_receipt_action_drift;
SELECT pg_temp.p119_assert(
  :'p119_no_receipt_action_drift_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_no_receipt_action_drift_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a version-1 lead with unproven next-action state did not fail closed'
);

-- Migration 086 legitimately advanced an existing new_inbound lead to
-- version 2 without a workflow receipt. Preserve only that exact audited
-- one-time normalization as a proven creation baseline.
\set p119_normalization_request 59911900-0000-4000-8000-000000000405
SAVEPOINT p119_legacy_normalization;
UPDATE platform.leads
SET workflow_version = 2
WHERE id = :'p119_lead_fallback';
INSERT INTO platform.audit_events (
  organization_id, actor_kind, actor_profile_id, actor_principal,
  action, resource_type, resource_id, before_state, after_state,
  reason, request_id, created_at, resulting_version
) VALUES (
  :'p119_org', 'system', NULL, 'migration:086_platform_sales_workflow',
  'lead.sales.stage.normalized', 'lead', :'p119_lead_fallback',
  pg_catalog.jsonb_build_object(
    'stage_key', 'new_inbound', 'workflow_version', 1
  ),
  pg_catalog.jsonb_build_object('stage_key', 'new', 'workflow_version', 2),
  'U4 normalizes the sole U3 legacy Sales stage',
  :'p119_normalization_request', '2026-09-02 06:00:00+00', 2
);
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_assert(
  (
    SELECT page.stage_key = 'new'
      AND page.workflow_version = 2
      AND page.stage_entered_at = lead.created_at
    FROM platform.staff_sales_lead_page(20) AS page
    JOIN platform.leads AS lead ON lead.id = page.lead_id
    WHERE page.lead_id = :'p119_lead_fallback'
  ),
  'the exact migration-086 normalization baseline was rejected or re-aged'
);
RESET ROLE;

SET LOCAL session_replication_role = replica;
UPDATE platform.audit_events
SET reason = 'tampered normalization evidence'
WHERE request_id = :'p119_normalization_request';
SET LOCAL session_replication_role = origin;
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_malformed_normalization_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_legacy_normalization;
SELECT pg_temp.p119_assert(
  :'p119_malformed_normalization_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_malformed_normalization_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'malformed migration-086 normalization evidence was accepted'
);

SET request.jwt.claims TO :'p119_foreign_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_assert(
  (SELECT pg_catalog.count(*) FROM platform.staff_sales_lead_page(20)) = 0
    AND (
      SELECT pg_catalog.count(*)
      FROM private.staff_sales_lead_page(20)
    ) = 0,
  'foreign organization crossed the Sales wrapper/helper boundary'
);
RESET ROLE;

-- A direct current-row stage drift must not reuse an older receipt timestamp.
-- The savepoint restores both stage_key and the updated_at trigger side effect.
SAVEPOINT p119_direct_stage_drift;
UPDATE platform.leads
SET stage_key = 'contacting'
WHERE id = :'p119_lead_reentry';
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_direct_stage_drift_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_direct_stage_drift;
SELECT pg_temp.p119_assert(
  :'p119_direct_stage_drift_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_direct_stage_drift_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'direct lead-stage drift reused stale transition evidence'
);

-- Match migration 111's exact-pair integrity contract: even when the receipt
-- and audit both exist, a corrupted durable result must fail the read closed.
SAVEPOINT p119_corrupt_receipt_pair;
SET LOCAL session_replication_role = replica;
UPDATE platform_private.sales_lead_workflow_receipts
SET result = result || pg_catalog.jsonb_build_object(
  'stage_key', 'contacting'
)
WHERE request_id = :'p119_sales_request_4';
SET LOCAL session_replication_role = origin;
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_corrupt_receipt_pair_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_corrupt_receipt_pair;
SELECT pg_temp.p119_assert(
  :'p119_corrupt_receipt_pair_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_corrupt_receipt_pair_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a corrupted receipt/audit pair did not fail the queue closed'
);

-- A receipt whose paired audit row disappeared is the other half of the
-- migration-111 parity contract and must fail before stage age is projected.
SAVEPOINT p119_receipt_without_audit;
SET LOCAL session_replication_role = replica;
DELETE FROM platform.audit_events
WHERE request_id = :'p119_sales_request_4';
SET LOCAL session_replication_role = origin;
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_receipt_without_audit_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_receipt_without_audit;
SELECT pg_temp.p119_assert(
  :'p119_receipt_without_audit_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_receipt_without_audit_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'a receipt without its audit event did not fail the queue closed'
);

-- The reverse ledger mismatch is equally fatal: an audit without its private
-- receipt must not be treated as reusable current-stage evidence.
SAVEPOINT p119_corrupt_sales_ledger;
INSERT INTO platform.audit_events (
  organization_id, actor_kind, actor_profile_id, actor_principal, action,
  resource_type, resource_id, before_state, after_state, reason, request_id,
  created_at, actor_membership_id, resulting_version
) VALUES (
  :'p119_org', 'user', :'p119_admin_profile',
  'auth:' || :'p119_admin_user'::TEXT,
  'lead.sales.workflow.changed', 'lead', :'p119_lead_reentry',
  pg_catalog.jsonb_build_object('stage_key', 'qualified', 'workflow_version', 5),
  pg_catalog.jsonb_build_object('stage_key', 'contacting', 'workflow_version', 6),
  'P119 orphan audit corruption',
  '59911900-0000-4000-8000-000000000490',
  '2026-09-05 13:00:00+00', :'p119_admin_membership', 6
);
SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_sales_lead_page(20)'
)::TEXT AS p119_corrupt_sales_error
\gset
RESET ROLE;
ROLLBACK TO SAVEPOINT p119_corrupt_sales_ledger;
SELECT pg_temp.p119_assert(
  :'p119_corrupt_sales_error'::JSONB ->> 'sqlstate' = '23514'
    AND :'p119_corrupt_sales_error'::JSONB ->> 'message'
      = 'sales_stage_entry_evidence_inconsistent',
  'visible sales ledger corruption did not fail the queue closed'
);

-- Admissions fixtures cover both deadline kinds, unscheduled work, a real
-- keyset continuation and inclusive Bishkek-day filters.
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p119_case', :'p119_org', :'p119_student_membership',
  :'p119_sales_membership', NULL,
  'synthetic:p119:case', 'contract:p119', '2026-09-01 08:00:00+00',
  'P119 Student', 'United Kingdom', 'Bachelor', 'Business', '2027',
  'approved', 'contract_confirmed', 'pending', NULL,
  NULL, 'Read the complete task queue',
  :'p119_case_scope', 1
);

SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p119_org',
  :'p119_case',
  :'p119_curator_membership',
  'Activate the isolated migration 119 case through the real lifecycle',
  '59911900-0000-4000-8000-000000000491'
);
RESET ROLE;

-- Scope reassignment deliberately invalidates the curator's prior authority
-- snapshot, so the positive queue path must use a freshly issued claim set.
SELECT pg_catalog.jsonb_build_object(
  'sub', :'p119_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p119_org',
  'platform_membership_id', :'p119_curator_membership',
  'platform_bundle_id', :'p119_curator_bundle',
  'platform_bundle_version', :'p119_curator_version'::INTEGER
)::TEXT AS p119_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p119_curator_profile'
\gset

\set p119_task_all_day 59911900-0000-4000-8000-000000000301
\set p119_task_timed 59911900-0000-4000-8000-000000000302
\set p119_task_next_day 59911900-0000-4000-8000-000000000303
\set p119_task_unscheduled 59911900-0000-4000-8000-000000000304

INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, due_on, status,
  student_visible, created_by_membership_id, created_at, updated_at
) VALUES
  (
    :'p119_task_all_day', :'p119_org', :'p119_case', 'documents',
    'P119 all-day', :'p119_curator_membership', 'normal', NULL,
    '2026-09-10', 'open', TRUE, :'p119_curator_membership',
    '2026-09-01 11:00:00+00', '2026-09-01 11:00:00+00'
  ),
  (
    :'p119_task_timed', :'p119_org', :'p119_case', 'meeting',
    'P119 timed', :'p119_curator_membership', 'high',
    -- Same sort key as the all-day task: Bishkek midnight is 18:00 UTC on
    -- the preceding day. UUID must therefore break the keyset tie.
    '2026-09-09 18:00:00+00', NULL, 'open', TRUE,
    :'p119_curator_membership',
    '2026-09-01 11:01:00+00', '2026-09-01 11:01:00+00'
  ),
  (
    :'p119_task_next_day', :'p119_org', :'p119_case', 'documents',
    'P119 next day', :'p119_curator_membership', 'normal', NULL,
    '2026-09-11', 'open', TRUE, :'p119_curator_membership',
    '2026-09-01 11:02:00+00', '2026-09-01 11:02:00+00'
  ),
  (
    :'p119_task_unscheduled', :'p119_org', :'p119_case', 'follow_up',
    'P119 unscheduled', :'p119_curator_membership', 'low', NULL,
    NULL, 'open', FALSE, :'p119_curator_membership',
    '2026-09-01 11:03:00+00', '2026-09-01 11:03:00+00'
  );

SET request.jwt.claims TO :'p119_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT queue.case_task_id
    FROM platform.staff_case_task_queue(2) AS queue
  ) = ARRAY[
    :'p119_task_all_day'::UUID,
    :'p119_task_timed'::UUID
  ],
  'first Admissions task page drifted from canonical deadline order'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT queue.case_task_id
    FROM platform.staff_case_task_queue(
      10,
      '2026-09-09 18:00:00+00'::TIMESTAMPTZ,
      :'p119_task_all_day',
      NULL,
      NULL
    ) AS queue
  ) = ARRAY[
    :'p119_task_timed'::UUID,
    :'p119_task_next_day'::UUID,
    :'p119_task_unscheduled'::UUID
  ],
  'Admissions task cursor did not continue through an equal-deadline UUID tie'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT queue.case_task_id
    FROM platform.staff_case_task_queue(
      10, NULL, NULL, '2026-09-10', '2026-09-10'
    ) AS queue
  ) = ARRAY[
    :'p119_task_all_day'::UUID,
    :'p119_task_timed'::UUID
  ],
  'inclusive Bishkek due-day bounds drifted for timed/all-day tasks'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT queue.case_task_id
    FROM platform.staff_case_task_queue(
      10, NULL, NULL, '2026-09-11', NULL
    ) AS queue
  ) = ARRAY[:'p119_task_next_day'::UUID]
    AND ARRAY(
      SELECT queue.case_task_id
      FROM platform.staff_case_task_queue(
        10, NULL, NULL, NULL, '2026-09-10'
      ) AS queue
    ) = ARRAY[
      :'p119_task_all_day'::UUID,
      :'p119_task_timed'::UUID
    ],
  'one-sided Admissions due-day bounds drifted'
);

SELECT pg_temp.p119_assert(
  ARRAY(
    SELECT pg_catalog.to_jsonb(wrapper_row)
    FROM platform.staff_case_task_queue(10) AS wrapper_row
  ) = ARRAY(
    SELECT pg_catalog.to_jsonb(helper_row)
    FROM private.staff_case_task_queue(10) AS helper_row
  ),
  'cursorless Admissions wrapper changed the canonical helper row contract'
);

SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_case_task_queue(0)'
)::TEXT AS p119_bad_task_limit
\gset
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_case_task_queue('
    || '10, TIMESTAMPTZ ''2026-09-10 05:00:00+00'', NULL, NULL, NULL)'
)::TEXT AS p119_bad_task_cursor
\gset
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_case_task_queue('
    || '10, NULL, NULL, DATE ''2026-09-11'', DATE ''2026-09-10'')'
)::TEXT AS p119_bad_task_bounds
\gset
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_case_task_queue('
    || '10, NULL, NULL, DATE ''-infinity'', DATE ''2026-09-10'')'
)::TEXT AS p119_infinite_task_bounds
\gset

RESET ROLE;
SELECT pg_temp.p119_assert(
  :'p119_bad_task_limit'::JSONB ->> 'sqlstate' = '22023'
    AND :'p119_bad_task_cursor'::JSONB ->> 'sqlstate' = '22023'
    AND :'p119_bad_task_bounds'::JSONB ->> 'sqlstate' = '22023'
    AND :'p119_infinite_task_bounds'::JSONB ->> 'sqlstate' = '22023',
  'Admissions task queue accepted an invalid limit/cursor/due bound'
);

SET request.jwt.claims TO :'p119_foreign_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_assert(
  (SELECT pg_catalog.count(*) FROM platform.staff_case_task_queue(10)) = 0
    AND (
      SELECT pg_catalog.count(*)
      FROM private.staff_case_task_queue(10)
    ) = 0,
  'foreign organization crossed the Admissions wrapper/helper boundary'
);
RESET ROLE;

SET request.jwt.claims TO :'p119_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM platform.staff_case_task_queue(10)'
)::TEXT AS p119_sales_task_denial
\gset
SELECT pg_temp.p119_capture_error(
  'SELECT * FROM private.staff_case_task_queue(10)'
)::TEXT AS p119_sales_private_task_denial
\gset
RESET ROLE;

SELECT pg_temp.p119_assert(
  :'p119_sales_task_denial'::JSONB ->> 'sqlstate' = '42501'
    AND :'p119_sales_private_task_denial'::JSONB ->> 'sqlstate' = '42501',
  'Sales was not denied the Admissions wrapper/helper queue'
);

ROLLBACK;

SELECT 'platform migration 119 queue-read extensions passed' AS result;
