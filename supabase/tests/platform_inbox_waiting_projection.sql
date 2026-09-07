\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 122. All rows are synthetic and
-- the transaction is rolled back; no managed Supabase project is touched.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.p122_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 122 assertion failed: %', p_message;
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p122_assert(BOOLEAN, TEXT)
  TO authenticated;

DO $catalog_contract$
DECLARE
  private_oid OID := pg_catalog.to_regprocedure(
    'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)'
  )::OID;
  public_oid OID := pg_catalog.to_regprocedure(
    'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)'
  )::OID;
BEGIN
  IF private_oid IS NULL OR public_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 122 communication page signature is missing';
  END IF;

  IF (
      SELECT routine.pronargdefaults
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = private_oid
    ) <> 7
    OR (
      SELECT routine.pronargdefaults
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = public_oid
    ) <> 7
  THEN
    RAISE EXCEPTION 'p_waiting_only is not backward-compatible DEFAULT FALSE';
  END IF;

  IF pg_catalog.to_regprocedure(
      'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text)'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Migration 119 communication overload remains callable';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'authenticated', public_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', private_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege('anon', public_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', public_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Migration 122 communication grants drifted';
  END IF;

  IF (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = 'staff_communication_page'
    ) <> 1
  THEN
    RAISE EXCEPTION 'Migration 122 exposed an ambiguous page overload';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p122_admin_bundle, bundle.version AS p122_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p122_sales_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p122_org 59912200-0000-4000-8000-000000000001
\set p122_org_scope 59912200-0000-4000-8000-000000000002
\set p122_admin_user 59912200-0000-4000-8000-000000000011
\set p122_sales_user 59912200-0000-4000-8000-000000000012
\set p122_admin_profile 59912200-0000-4000-8000-000000000021
\set p122_sales_profile 59912200-0000-4000-8000-000000000022
\set p122_admin_membership 59912200-0000-4000-8000-000000000031
\set p122_sales_membership 59912200-0000-4000-8000-000000000032
\set p122_event 59912200-0000-4000-8000-000000000101
\set p122_client 59912200-0000-4000-8000-000000000102
\set p122_conv_outbound 59912200-0000-4000-8000-000000000201
\set p122_conv_tail 59912200-0000-4000-8000-000000000202
\set p122_conv_never_outbound 59912200-0000-4000-8000-000000000203
\set p122_conv_equal_outbound 59912200-0000-4000-8000-000000000204
\set p122_participant_outbound 59912200-0000-4000-8000-000000000211
\set p122_participant_tail 59912200-0000-4000-8000-000000000212
\set p122_participant_never 59912200-0000-4000-8000-000000000213
\set p122_participant_equal 59912200-0000-4000-8000-000000000214

INSERT INTO platform.organizations (id, name)
VALUES (:'p122_org', 'Migration 122 Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES (
  :'p122_org_scope', :'p122_org', 'organization', :'p122_org', 1
);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p122_admin_user', 'p122-admin@example.invalid', '{}'::JSONB),
  (:'p122_sales_user', 'p122-sales@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p122_admin_profile', :'p122_admin_user', 'P122 Admin', 'active', 1),
  (:'p122_sales_profile', :'p122_sales_user', 'P122 Sales', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (
    :'p122_admin_membership', :'p122_org', :'p122_admin_profile',
    'active', 'admin', :'p122_admin_bundle'
  ),
  (
    :'p122_sales_membership', :'p122_org', :'p122_sales_profile',
    'active', 'sales', :'p122_sales_bundle'
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES (
  '59912200-0000-4000-8000-000000000041', :'p122_org',
  :'p122_admin_membership', :'p122_org_scope', 1, 1, TRUE, 'system', NULL,
  'P122 admin scope', '59912200-0000-4000-8000-000000000042'
);

SELECT pg_catalog.jsonb_build_object(
  'sub', :'p122_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p122_org',
  'platform_membership_id', :'p122_admin_membership',
  'platform_bundle_id', :'p122_admin_bundle',
  'platform_bundle_version', :'p122_admin_version'::INTEGER
)::TEXT AS p122_admin_claims
\gset

INSERT INTO platform_private.provider_webhook_events (
  id, organization_id, provider, provider_account_ref,
  provider_conversation_ref, provider_event_variant_ref,
  provider_request_id, waha_session_name, payload_id, event_type,
  provider_occurred_at, verification_status, raw_payload,
  verification_headers, verification_evidence_ref, payload_sha256, request_id
) VALUES (
  :'p122_event', :'p122_org', 'waha', 'waha:crm_primary', NULL, NULL,
  'synthetic:p122:event', 'crm_primary', 'p122-event', 'message.any',
  '2026-09-07 08:00:00+00', 'verified',
  '{"payload":{"fromMe":false,"secret":"provider-secret-needle"}}'::JSONB,
  '{"synthetic":true}'::JSONB, 'p122:verified-fixture', repeat('12', 32),
  '59912200-0000-4000-8000-000000000103'
);

INSERT INTO platform.clients (
  id, organization_id, display_name, normalized_name, phone,
  normalized_phone, created_at, updated_at
) VALUES (
  :'p122_client', :'p122_org', 'Айгүл Тестова',
  platform_private.normalize_person_name('Айгүл Тестова'),
  '+996 (555) 12-21-22',
  platform_private.normalize_person_phone('+996 (555) 12-21-22'),
  '2026-09-07 08:00:00+00', '2026-09-07 08:00:00+00'
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
    :'p122_conv_outbound', :'p122_org', NULL, :'p122_sales_membership',
    'provider_linked', NULL, 'sales', 'open', 'Newest answered', 'crm_primary',
    NULL, NULL, 122001, 122002, 122003, NULL, NULL, :'p122_org_scope', 1,
    :'p122_event', '2026-09-07 08:00:00+00', '2026-09-07 15:00:00+00'
  ),
  (
    :'p122_conv_tail', :'p122_org', NULL, :'p122_sales_membership',
    'provider_linked', NULL, 'sales', 'open', 'Priority waiting', 'crm_primary',
    NULL, NULL, 122011, 122012, 122013, NULL, NULL, :'p122_org_scope', 1,
    :'p122_event', '2026-09-07 08:00:00+00', '2026-09-07 14:00:00+00'
  ),
  (
    :'p122_conv_never_outbound', :'p122_org', NULL, :'p122_sales_membership',
    'provider_linked', NULL, 'sales', 'open', 'Canonical client', 'crm_primary',
    NULL, NULL, 122021, 122022, 122023, :'p122_client', NULL,
    :'p122_org_scope', 1, :'p122_event',
    '2026-09-07 08:00:00+00', '2026-09-07 13:00:00+00'
  ),
  (
    :'p122_conv_equal_outbound', :'p122_org', NULL, :'p122_sales_membership',
    'provider_linked', NULL, 'sales', 'open', 'Equal timestamp answered',
    'crm_primary', NULL, NULL, 122031, 122032, 122033, NULL, NULL,
    :'p122_org_scope', 1, :'p122_event',
    '2026-09-07 08:00:00+00', '2026-09-07 12:30:00+00'
  );

INSERT INTO platform.conversation_participants (
  id, organization_id, conversation_id, participant_kind, membership_id,
  external_subject_ref, source_webhook_event_id
) VALUES
  (
    :'p122_participant_outbound', :'p122_org', :'p122_conv_outbound',
    'customer', NULL, 'opaque:p122:outbound', :'p122_event'
  ),
  (
    :'p122_participant_tail', :'p122_org', :'p122_conv_tail',
    'customer', NULL, 'opaque:p122:tail', :'p122_event'
  ),
  (
    :'p122_participant_never', :'p122_org', :'p122_conv_never_outbound',
    'customer', NULL, 'opaque:p122:never', :'p122_event'
  ),
  (
    :'p122_participant_equal', :'p122_org', :'p122_conv_equal_outbound',
    'customer', NULL, 'opaque:p122:equal', :'p122_event'
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
    '59912200-0000-4000-8000-000000000301', :'p122_org',
    :'p122_conv_outbound', NULL, :'p122_participant_outbound', 'inbound',
    'Outbound source', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-301', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 14:30:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000311', :'p122_org',
    :'p122_conv_tail', NULL, :'p122_participant_tail', 'inbound',
    'provider-secret-needle', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-311', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 10:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000321', :'p122_org',
    :'p122_conv_never_outbound', NULL, :'p122_participant_never', 'inbound',
    'First without outbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-321', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 09:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000322', :'p122_org',
    :'p122_conv_never_outbound', NULL, :'p122_participant_never', 'inbound',
    'Second without outbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-322', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 10:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000331', :'p122_org',
    :'p122_conv_equal_outbound', NULL, :'p122_participant_equal', 'inbound',
    'Equal lower inbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-331', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 12:00:00+00'
  );

INSERT INTO platform.manual_send_authorizations (
  id, organization_id, conversation_id, ai_draft_id, source_message_id,
  final_text, final_text_sha256, authorized_by_profile_id,
  authorized_by_membership_id, reason, request_id
) VALUES
  (
    '59912200-0000-4000-8000-000000000401', :'p122_org',
    :'p122_conv_outbound', NULL,
    '59912200-0000-4000-8000-000000000301', 'Answered newest', repeat('41', 32),
    :'p122_admin_profile', :'p122_admin_membership', 'P122 outbound fixture',
    '59912200-0000-4000-8000-000000000411'
  ),
  (
    '59912200-0000-4000-8000-000000000402', :'p122_org',
    :'p122_conv_tail', NULL,
    '59912200-0000-4000-8000-000000000311', 'Tail boundary', repeat('42', 32),
    :'p122_admin_profile', :'p122_admin_membership', 'P122 tail fixture',
    '59912200-0000-4000-8000-000000000412'
  ),
  (
    '59912200-0000-4000-8000-000000000403', :'p122_org',
    :'p122_conv_equal_outbound', NULL,
    '59912200-0000-4000-8000-000000000331', 'Equal higher outbound',
    repeat('43', 32), :'p122_admin_profile', :'p122_admin_membership',
    'P122 equal-order fixture', '59912200-0000-4000-8000-000000000413'
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
    '59912200-0000-4000-8000-000000000302', :'p122_org',
    :'p122_conv_outbound', NULL, :'p122_participant_outbound', 'outbound',
    'Answered newest', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-302', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', '59912200-0000-4000-8000-000000000401',
    '2026-09-07 14:45:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000312', :'p122_org',
    :'p122_conv_tail', NULL, :'p122_participant_tail', 'outbound',
    'Tail boundary', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-312', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', '59912200-0000-4000-8000-000000000402',
    '2026-09-07 11:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000313', :'p122_org',
    :'p122_conv_tail', NULL, :'p122_participant_tail', 'inbound',
    'First tail inbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-313', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 12:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000314', :'p122_org',
    :'p122_conv_tail', NULL, :'p122_participant_tail', 'inbound',
    'Second tail inbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-314', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', NULL, '2026-09-07 12:00:00+00'
  ),
  (
    '59912200-0000-4000-8000-000000000332', :'p122_org',
    :'p122_conv_equal_outbound', NULL, :'p122_participant_equal', 'outbound',
    'Equal higher outbound', 'ru', FALSE, 'public_provider_id', 'crm_primary',
    'p122-message-332', NULL, NULL, NULL, NULL, NULL, NULL,
    :'p122_event', '59912200-0000-4000-8000-000000000403',
    '2026-09-07 12:00:00+00'
  );

SET request.jwt.claims TO :'p122_admin_claims';
SET ROLE authenticated;

SELECT pg_temp.p122_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(:'p122_org', 10) AS page
  ) = ARRAY[
    :'p122_conv_outbound'::UUID,
    :'p122_conv_tail'::UUID,
    :'p122_conv_never_outbound'::UUID,
    :'p122_conv_equal_outbound'::UUID
  ],
  'omitted p_waiting_only changed migration-119 membership or ordering'
);

SELECT pg_temp.p122_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      :'p122_org', 10, p_waiting_only => FALSE
    ) AS page
  ) = ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(:'p122_org', 10) AS page
  ),
  'explicit FALSE differs from the compatibility default'
);

SELECT pg_temp.p122_assert(
  (
    SELECT page.waiting_since = '2026-09-07 12:00:00+00'::TIMESTAMPTZ
      AND page.last_message_direction = 'inbound'
    FROM platform.staff_communication_page(
      :'p122_org', 10, p_conversation_id => :'p122_conv_tail'
    ) AS page
  ),
  'waiting_since is not the first inbound in the canonical equal-time tail'
);

SELECT pg_temp.p122_assert(
  (
    SELECT page.waiting_since = '2026-09-07 09:00:00+00'::TIMESTAMPTZ
    FROM platform.staff_communication_page(
      :'p122_org', 10, p_conversation_id => :'p122_conv_never_outbound'
    ) AS page
  ),
  'a never-answered conversation did not start at its first inbound'
);

SELECT pg_temp.p122_assert(
  (
    SELECT page.waiting_since IS NULL
      AND page.last_message_direction = 'outbound'
    FROM platform.staff_communication_page(
      :'p122_org', 10, p_conversation_id => :'p122_conv_equal_outbound'
    ) AS page
  ),
  'equal timestamps did not use message id as the canonical tie-breaker'
);

SELECT pg_temp.p122_assert(
  (
    SELECT snapshot.waiting_since = '2026-09-07 12:00:00+00'::TIMESTAMPTZ
    FROM platform.staff_communication_snapshot(
      :'p122_org', :'p122_conv_tail'
    ) AS snapshot
  ),
  'snapshot shape did not advance with the page shape'
);

SELECT pg_temp.p122_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      :'p122_org', 1, p_waiting_only => TRUE
    ) AS page
  ) = ARRAY[:'p122_conv_tail'::UUID],
  'waiting predicate ran after LIMIT or waiting duration replaced queue order'
);

SELECT pg_temp.p122_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      :'p122_org', 10,
      p_before_sort_at => '2026-09-07 14:00:00+00',
      p_before_conversation_id => :'p122_conv_tail',
      p_waiting_only => TRUE
    ) AS page
  ) = ARRAY[:'p122_conv_never_outbound'::UUID],
  'waiting filter changed canonical keyset cursor semantics'
);

SELECT pg_temp.p122_assert(
  ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      :'p122_org', 1, p_query => 'Айгүл'
    ) AS page
  ) = ARRAY[:'p122_conv_never_outbound'::UUID]
  AND ARRAY(
    SELECT page.conversation_id
    FROM platform.staff_communication_page(
      :'p122_org', 1, p_query => '555122122'
    ) AS page
  ) = ARRAY[:'p122_conv_never_outbound'::UUID],
  'canonical client name/phone search ran after LIMIT or drifted'
);

SELECT pg_temp.p122_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform.staff_communication_page(
      :'p122_org', 10, p_query => 'provider-secret-needle'
    ) AS page
  ),
  'search inspected message text or provider payload'
);

RESET ROLE;
ROLLBACK;

SELECT 'platform migration 122 inbox waiting projection passed' AS result;
