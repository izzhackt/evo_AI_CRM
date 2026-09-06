\set ON_ERROR_STOP on

-- Migration 121 boundary proof. Fixtures are synthetic, isolated and removed
-- after the two-session race; no provider, Storage byte or production state is
-- touched.
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
  uploads_oid OID :=
    'platform_private.message_media_attachment_uploads'::REGCLASS;
  completions_oid OID :=
    'platform_private.message_media_attachment_completions'::REGCLASS;
  reserve_rpc_oid OID := (
    'platform.reserve_message_media_attachment(uuid,uuid,uuid,uuid,bigint,uuid)'::REGPROCEDURE
  )::OID;
  reserve_body_oid OID := (
    'private.reserve_message_media_attachment(uuid,uuid,uuid,uuid,bigint,uuid)'::REGPROCEDURE
  )::OID;
  upload_rpc_oid OID := (
    'platform.reserve_message_media_attachment_upload(uuid,text,text,text,text,text,timestamptz)'::REGPROCEDURE
  )::OID;
  upload_body_oid OID := (
    'private.reserve_message_media_attachment_upload(uuid,text,text,text,text,text,timestamptz)'::REGPROCEDURE
  )::OID;
  complete_rpc_oid OID := (
    'platform.complete_message_media_attachment(uuid,uuid,text,text,text,text,timestamptz)'::REGPROCEDURE
  )::OID;
  complete_body_oid OID := (
    'private.complete_message_media_attachment(uuid,uuid,text,text,text,text,timestamptz)'::REGPROCEDURE
  )::OID;
  actor_helper_oid OID := (
    'private.message_media_attachment_actor_is_current(uuid)'::REGPROCEDURE
  )::OID;
  checked_table OID;
  checked_invoker OID;
  checked_definer OID;
  checked_role TEXT;
BEGIN
  FOREACH checked_table IN ARRAY ARRAY[intents_oid, uploads_oid, completions_oid]
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

  FOREACH checked_invoker IN ARRAY ARRAY[
    reserve_rpc_oid, upload_rpc_oid, complete_rpc_oid
  ]
  LOOP
    IF NOT COALESCE((
      SELECT NOT routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.prokind = 'f'
        AND NOT routine.proretset
        AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND namespace.nspname = 'platform'
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE routine.oid = checked_invoker
    ), FALSE) THEN
      RAISE EXCEPTION 'exposed attachment entrypoint must be SECURITY INVOKER';
    END IF;
  END LOOP;

  FOREACH checked_definer IN ARRAY ARRAY[
    reserve_body_oid, upload_body_oid, complete_body_oid
  ]
  LOOP
    IF NOT COALESCE((
      SELECT routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.prokind = 'f'
        AND NOT routine.proretset
        AND pg_catalog.pg_get_function_result(routine.oid) = 'jsonb'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND namespace.nspname = 'private'
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE routine.oid = checked_definer
    ), FALSE) THEN
      RAISE EXCEPTION 'privileged attachment body must be private and hardened';
    END IF;
  END LOOP;

  IF NOT COALESCE((
    SELECT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.prokind = 'f'
      AND NOT routine.proretset
      AND pg_catalog.pg_get_function_result(routine.oid) = 'boolean'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND namespace.nspname = 'private'
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE routine.oid = actor_helper_oid
  ), FALSE) THEN
    RAISE EXCEPTION 'attachment actor helper must be private and hardened';
  END IF;

  FOREACH checked_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      checked_role, actor_helper_oid, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% unexpectedly executes attachment actor helper',
        checked_role;
    END IF;
  END LOOP;

  IF pg_catalog.pg_get_function_identity_arguments(reserve_rpc_oid) <>
    'p_conversation_id uuid, p_communication_media_id uuid, p_student_case_id uuid, p_document_slot_id uuid, p_expected_version bigint, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'reserve_message_media_attachment signature drifted';
  END IF;

  IF pg_catalog.pg_get_function_identity_arguments(upload_rpc_oid) <>
    'p_attachment_intent_id uuid, p_scan_result text, p_scanner_engine text, p_scanner_engine_version text, p_scanner_signature_version text, p_scanner_protocol text, p_scanned_at timestamp with time zone'
    OR pg_catalog.pg_get_function_identity_arguments(complete_rpc_oid) <>
    'p_attachment_intent_id uuid, p_upload_reservation_id uuid, p_scanner_engine text, p_scanner_engine_version text, p_scanner_signature_version text, p_scanner_protocol text, p_scanned_at timestamp with time zone'
  THEN
    RAISE EXCEPTION 'service attachment entrypoint signature drifted';
  END IF;

  IF pg_catalog.pg_get_functiondef(complete_body_oid) NOT LIKE '%FOR UPDATE%'
    OR pg_catalog.pg_get_functiondef(complete_body_oid)
      NOT LIKE '%upload_reservation_request_id%'
    OR pg_catalog.pg_get_functiondef(complete_body_oid)
      NOT LIKE '%document_upload_finalizations%'
    OR pg_catalog.pg_get_functiondef(complete_body_oid)
      NOT LIKE '%document_malware_scan_attestations%'
  THEN
    RAISE EXCEPTION 'completion causal lock/proof chain drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
      'authenticated', reserve_rpc_oid, 'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated', reserve_body_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege('anon', reserve_rpc_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', reserve_body_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege(
      'service_role', reserve_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'service_role', reserve_body_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin', reserve_rpc_oid, 'EXECUTE'
    )
    OR pg_catalog.has_function_privilege(
      'supabase_auth_admin', reserve_body_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'reserve_message_media_attachment grants drifted';
  END IF;

  FOREACH checked_invoker IN ARRAY ARRAY[upload_rpc_oid, complete_rpc_oid]
  LOOP
    IF NOT pg_catalog.has_function_privilege(
        'service_role', checked_invoker, 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege('anon', checked_invoker, 'EXECUTE')
      OR pg_catalog.has_function_privilege(
        'authenticated', checked_invoker, 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege(
        'supabase_auth_admin', checked_invoker, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'service attachment entrypoint grants drifted';
    END IF;
  END LOOP;

  FOREACH checked_definer IN ARRAY ARRAY[upload_body_oid, complete_body_oid]
  LOOP
    IF NOT pg_catalog.has_function_privilege(
        'service_role', checked_definer, 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege('anon', checked_definer, 'EXECUTE')
      OR pg_catalog.has_function_privilege(
        'authenticated', checked_definer, 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege(
        'supabase_auth_admin', checked_definer, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'private service attachment body grants drifted';
    END IF;
  END LOOP;

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
\set p121_audio_binding '59912100-0000-4000-8000-000000000555'
\set p121_audio_work '59912100-0000-4000-8000-000000000556'
\set p121_audio_effect '59912100-0000-4000-8000-000000000557'
\set p121_audio_attempt '59912100-0000-4000-8000-000000000558'
\set p121_c2_binding '59912100-0000-4000-8000-000000000559'
\set p121_c2_work '59912100-0000-4000-8000-000000000560'
\set p121_c2_effect '59912100-0000-4000-8000-000000000561'
\set p121_c2_attempt '59912100-0000-4000-8000-000000000562'
\set p121_c3_binding '59912100-0000-4000-8000-000000000563'
\set p121_c3_work '59912100-0000-4000-8000-000000000564'
\set p121_c3_effect '59912100-0000-4000-8000-000000000565'
\set p121_c3_attempt '59912100-0000-4000-8000-000000000566'

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
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'document.manage'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'organization.read'
  )
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p121_sales_bundle, bundle.version AS p121_sales_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'organization.read'
  )
ORDER BY bundle.version DESC LIMIT 1
\gset

SELECT bundle.id AS p121_curator_bundle, bundle.version AS p121_curator_bundle_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'document.manage'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'communication.read.full'
  )
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'organization.read'
  )
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

-- Model the config-provisioned private destination bucket in the disposable
-- catalog. Migrations intentionally do not write storage.buckets.
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) VALUES (
  'platform-documents', 'platform-documents', FALSE, 26214400,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

SELECT pg_temp.p121_assert(
  EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'platform-documents'
      AND bucket.name = 'platform-documents'
      AND NOT bucket.public
      AND bucket.file_size_limit = 26214400
      AND bucket.allowed_mime_types =
        ARRAY['application/pdf', 'image/jpeg', 'image/png']
  ),
  'private destination bucket contract drifted'
);

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
  ),
  (
    '59912100-0000-4000-8000-000000000708', :'p121_org_a',
    :'p121_sales_a_membership', :'p121_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 sales runtime scope',
    '59912100-0000-4000-8000-000000000808'
  ),
  (
    '59912100-0000-4000-8000-000000000709', :'p121_org_a',
    :'p121_curator_a_membership', :'p121_org_scope_a', 1, 1, TRUE,
    'system', NULL, 'Migration 121 Admissions runtime scope',
    '59912100-0000-4000-8000-000000000809'
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
  'waha:crm_primary', NULL, NULL, 'synthetic:p121:event:1',
  'crm_primary', 'p121-event-1', 'history.message',
  '2026-09-01T09:00:00+00:00', 'missing',
  '{"provenance":"api_history","read_only":true,"session":"crm_primary"}',
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
    'P121 case conversation', 'crm_primary', NULL, NULL,
    910000001, 910000002, 910000003,
    NULL, :'p121_conv_scope_1', 1, :'p121_event_1'
  ),
  (
    :'p121_conversation_2', :'p121_org_a', NULL,
    :'p121_sales_a_membership', 'provider_linked',
    NULL, 'sales', 'open',
    'P121 canonical lead conversation', 'crm_primary', NULL, NULL,
    910000004, 910000005, 910000006,
    :'p121_lead_a', :'p121_conv_scope_2', 1, :'p121_event_1'
  ),
  (
    :'p121_conversation_3', :'p121_org_a', NULL,
    :'p121_sales_a_membership', 'provider_linked',
    NULL, 'sales', 'open',
    'P121 unlinked conversation', 'crm_primary', NULL, NULL,
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
    FALSE, 'public_provider_id', 'crm_primary', 'p121-message-1', NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_2', :'p121_org_a', :'p121_conversation_1', :'p121_case_a',
    :'p121_participant_1', 'inbound', '[voice message]', 'undetermined',
    FALSE, 'public_provider_id', 'crm_primary', 'p121-message-2', NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_3', :'p121_org_a', :'p121_conversation_1', :'p121_case_a',
    :'p121_participant_1', 'inbound', '[pending media]', 'undetermined',
    FALSE, 'public_provider_id', 'crm_primary', 'p121-message-3', NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_4', :'p121_org_a', :'p121_conversation_2', NULL,
    :'p121_participant_2', 'inbound', '[lead media]', 'undetermined',
    FALSE, 'public_provider_id', 'crm_primary', 'p121-message-4', NULL, NULL, NULL,
    NULL, NULL, NULL, :'p121_event_1', NULL
  ),
  (
    :'p121_message_5', :'p121_org_a', :'p121_conversation_3', NULL,
    :'p121_participant_3', 'inbound', '[unlinked media]', 'undetermined',
    FALSE, 'public_provider_id', 'crm_primary', 'p121-message-5', NULL, NULL, NULL,
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
) VALUES
  (
    :'p121_media_binding', :'p121_org_a', :'p121_media_pdf',
    :'p121_message_1', :'p121_event_1', 'crm_primary', '77010000001@c.us',
    'p121-raw-message-1', 'platform-whatsapp-media',
    'aa/' || repeat('0', 62)
  ),
  (
    :'p121_audio_binding', :'p121_org_a', :'p121_media_audio',
    :'p121_message_2', :'p121_event_1', 'crm_primary', '77010000002@c.us',
    'p121-raw-message-2', 'platform-whatsapp-media',
    'ab/' || repeat('1', 62)
  ),
  (
    :'p121_c2_binding', :'p121_org_a', :'p121_media_c2_pdf',
    :'p121_message_4', :'p121_event_1', 'crm_primary', '77010000004@c.us',
    'p121-raw-message-4', 'platform-whatsapp-media',
    'ac/' || repeat('2', 62)
  ),
  (
    :'p121_c3_binding', :'p121_org_a', :'p121_media_c3_pdf',
    :'p121_message_5', :'p121_event_1', 'crm_primary', '77010000005@c.us',
    'p121-raw-message-5', 'platform-whatsapp-media',
    'ad/' || repeat('3', 62)
  );

INSERT INTO platform_private.waha_media_archive_work (
  id, organization_id, media_id, object_binding_id, state, attempt_count
) VALUES
  (
    :'p121_media_work', :'p121_org_a', :'p121_media_pdf',
    :'p121_media_binding', 'archived', 1
  ),
  (
    :'p121_audio_work', :'p121_org_a', :'p121_media_audio',
    :'p121_audio_binding', 'archived', 1
  ),
  (
    :'p121_c2_work', :'p121_org_a', :'p121_media_c2_pdf',
    :'p121_c2_binding', 'archived', 1
  ),
  (
    :'p121_c3_work', :'p121_org_a', :'p121_media_c3_pdf',
    :'p121_c3_binding', 'archived', 1
  );

INSERT INTO platform_private.waha_media_archive_effects (
  id, organization_id, work_id, attempt_id, outcome, error_code,
  media_kind, mime_type, file_name, file_size_bytes, sha256_hex,
  input_sha256, response, request_id
) VALUES
  (
    :'p121_media_effect', :'p121_org_a', :'p121_media_work',
    :'p121_media_attempt', 'archived', NULL,
    'pdf', 'application/pdf', 'offer.pdf', 2048, :'p121_media_sha',
    repeat('01', 32), '{"outcome":"archived"}',
    '59912100-0000-4000-8000-000000000902'
  ),
  (
    :'p121_audio_effect', :'p121_org_a', :'p121_audio_work',
    :'p121_audio_attempt', 'archived', NULL,
    'audio', 'audio/ogg', 'voice.ogg', 4096, repeat('ef', 32),
    repeat('02', 32), '{"outcome":"archived"}',
    '59912100-0000-4000-8000-000000000903'
  ),
  (
    :'p121_c2_effect', :'p121_org_a', :'p121_c2_work',
    :'p121_c2_attempt', 'archived', NULL,
    'pdf', 'application/pdf', 'lead-offer.pdf', 1024, repeat('bc', 32),
    repeat('03', 32), '{"outcome":"archived"}',
    '59912100-0000-4000-8000-000000000904'
  ),
  (
    :'p121_c3_effect', :'p121_org_a', :'p121_c3_work',
    :'p121_c3_attempt', 'archived', NULL,
    'pdf', 'application/pdf', 'unlinked.pdf', 1024, repeat('bd', 32),
    repeat('04', 32), '{"outcome":"archived"}',
    '59912100-0000-4000-8000-000000000905'
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
    'sub', :'p121_student_a_user',
    'role', 'authenticated',
    'platform_role', 'student',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_student_a_membership',
    'platform_bundle_id', :'p121_student_bundle',
    'platform_bundle_version', :'p121_student_bundle_version'::INTEGER
  )::TEXT AS p121_student_a_claims,
  jsonb_build_object(
    'sub', :'p121_admin_a_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_a',
    'platform_membership_id', :'p121_admin_a_membership',
    'platform_bundle_id', :'p121_admin_bundle',
    'platform_bundle_version', :'p121_admin_bundle_version'::INTEGER
  )::TEXT AS p121_admin_a_claims,
  jsonb_build_object(
    'sub', :'p121_admin_b_user',
    'role', 'authenticated',
    'platform_role', 'admin',
    'platform_access_version', 1,
    'platform_organization_id', :'p121_org_b',
    'platform_membership_id', :'p121_admin_b_membership',
    'platform_bundle_id', :'p121_admin_bundle',
    'platform_bundle_version', :'p121_admin_bundle_version'::INTEGER
  )::TEXT AS p121_admin_b_claims
\gset

SET ROLE anon;
SET request.jwt.claims TO '{}';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000911'
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
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000912'
    ))->>'sqlstate'
  ) = '42501',
  'sales must not reserve media attachments on an active case'
);

SET request.jwt.claims TO :'p121_student_a_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000914'
    ))->>'sqlstate'
  ) = '42501',
  'student must not reserve a staff media attachment intent'
);

SET request.jwt.claims TO :'p121_curator_unassigned_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000913'
    ))->>'sqlstate'
  ) = '42501',
  'Admissions without the current case assignment must fail closed'
);

SET request.jwt.claims TO :'p121_curator_a_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 2, '59912100-0000-4000-8000-000000000915'
    ))->>'sqlstate'
  ) = 'PT409',
  'stale document slot version must fail before attachment intent creation'
);

SELECT platform.reserve_message_media_attachment(
  :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
  :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000921'
)::TEXT AS p121_reserve
\gset

SELECT platform.reserve_message_media_attachment(
  :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
  :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000921'
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
    'slot_expected_version', '1',
    'media_mime_type', 'application/pdf',
    'media_file_name', 'offer.pdf',
    'media_file_size_bytes', 2048,
    'media_sha256_hex', :'p121_media_sha',
    'slot_status', 'required',
    'request_id', '59912100-0000-4000-8000-000000000921'::UUID
  )
  AND (
    SELECT pg_catalog.array_agg(receipt_key ORDER BY receipt_key)
    FROM pg_catalog.jsonb_object_keys(:'p121_reserve'::JSONB)
      AS receipt(receipt_key)
  ) = ARRAY[
    'attachment_intent_id', 'communication_media_id', 'conversation_id',
    'document_slot_id', 'media_file_name', 'media_file_size_bytes',
    'media_mime_type', 'media_sha256_hex', 'organization_id', 'request_id',
    'slot_expected_version', 'slot_status', 'student_case_id'
  ]::TEXT[]
  AND (:'p121_reserve'::JSONB ->> 'attachment_intent_id') IS NOT NULL
  AND position('object_name' IN :'p121_reserve') = 0
  AND position('platform-whatsapp-media' IN :'p121_reserve') = 0
  AND position('actor_auth_user_id' IN :'p121_reserve') = 0,
  'reserve must return one stable receipt without source or actor identity'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_audio', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000921'
    ))->>'sqlstate'
  ) = '23505',
  'same request id with changed media must fail as a replay conflict'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 2, '59912100-0000-4000-8000-000000000921'
    ))->>'sqlstate'
  ) = '23505',
  'same request id with a changed expected version must conflict'
);

SET request.jwt.claims TO :'p121_admin_a_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000921'
    ))->>'sqlstate'
  ) = '23505',
  'same request id replayed by another authorized actor must fail closed'
);

SET request.jwt.claims TO :'p121_admin_b_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000922'
    ))->>'sqlstate'
  ) = '42501',
  'an authenticated actor must not select another tenant through resource ids'
);

SET request.jwt.claims TO :'p121_curator_a_claims';

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_audio', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000923'
    ))->>'sqlstate'
  ) = '22023',
  'non-document media kinds must be rejected as unattachable'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_pending', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000924'
    ))->>'sqlstate'
  ) = '42501',
  'unarchived media must be unavailable for attachment'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_3', :'p121_media_c3_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000925'
    ))->>'sqlstate'
  ) = '42501',
  'media from an unlinked conversation must not attach to the case'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::bigint,%L::uuid)',
      :'p121_conversation_1', :'p121_media_c2_pdf', :'p121_case_a',
      :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000926'
    ))->>'sqlstate'
  ) = '42501',
  'a media and conversation mismatch must fail closed'
);

SET request.jwt.claims TO :'p121_admin_a_claims';

SELECT platform.reserve_message_media_attachment(
  :'p121_conversation_2', :'p121_media_c2_pdf', :'p121_case_a',
  :'p121_slot_a', 1, '59912100-0000-4000-8000-000000000927'
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
      'SELECT platform.reserve_message_media_attachment_upload(%L::uuid,%L,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      'clean', 'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = '42501',
  'authenticated actors must not execute the service upload RPC'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT statement_timestamp()::TEXT AS p121_scan_at
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

-- Prove that a pre-existing finalized version with the same hash cannot satisfy
-- a new attachment intent.
SELECT platform.reserve_document_upload_after_ingress_scan(
  :'p121_org_a'::UUID,
  :'p121_curator_a_user'::UUID,
  :'p121_slot_a'::UUID,
  'offer.pdf',
  'application/pdf',
  2048,
  :'p121_media_sha',
  'clean',
  'ClamAV',
  '1.5.4',
  '27890',
  'clamd-zinstream-v1',
  :'p121_scan_at'::TIMESTAMPTZ,
  '59912100-0000-4000-8000-000000000941'
)::TEXT AS p121_unrelated_reservation
\gset

RESET ROLE;
RESET request.jwt.claims;

INSERT INTO storage.objects (bucket_id, name, metadata, created_at)
VALUES (
  :'p121_unrelated_reservation'::JSONB ->> 'bucket_id',
  :'p121_unrelated_reservation'::JSONB ->> 'object_name',
  jsonb_build_object('size', 2048, 'mimetype', 'application/pdf'),
  statement_timestamp()
);

SELECT statement_timestamp()::TEXT AS p121_unrelated_stored_scan_at
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.finalize_document_upload_with_scan(
  :'p121_org_a'::UUID,
  (:'p121_unrelated_reservation'::JSONB ->> 'upload_reservation_id')::UUID,
  'ClamAV',
  '1.5.4',
  '27890',
  'clamd-zinstream-v1',
  :'p121_media_sha',
  :'p121_unrelated_stored_scan_at'::TIMESTAMPTZ,
  '59912100-0000-4000-8000-000000000942'
)::TEXT AS p121_unrelated_finalization
\gset

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_unrelated_reservation'::JSONB ->> 'upload_reservation_id',
      'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      :'p121_unrelated_stored_scan_at'
    ))->>'sqlstate'
  ) = '42501',
  'same-hash finalized version without the attachment upload edge must fail'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment_upload(%L::uuid,%L,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      'clean', 'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      :'p121_scan_at'
    ))->>'sqlstate'
  ) = 'PT409',
  'an intent must become stale when another finalization advances its slot'
);

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'p121_curator_a_claims';
SET ROLE authenticated;

SELECT platform.reserve_message_media_attachment(
  :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
  :'p121_slot_a', 2, '59912100-0000-4000-8000-000000000928'
)::TEXT AS p121_reserve
\gset

SELECT pg_temp.p121_assert(
  :'p121_reserve'::JSONB ->> 'slot_expected_version' = '2',
  'a new intent must capture the slot version after unrelated finalization'
);

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.reserve_message_media_attachment_upload(
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  'clean', 'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
  :'p121_scan_at'::TIMESTAMPTZ
)::TEXT AS p121_upload
\gset

SELECT platform.reserve_message_media_attachment_upload(
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  'clean', 'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
  :'p121_scan_at'::TIMESTAMPTZ
)::TEXT AS p121_upload_replay
\gset

SELECT pg_temp.p121_assert(
  :'p121_upload'::JSONB = :'p121_upload_replay'::JSONB
  AND :'p121_upload'::JSONB @> jsonb_build_object(
    'attachment_intent_id',
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
    'organization_id', :'p121_org_a'::UUID,
    'student_case_id', :'p121_case_a'::UUID,
    'document_slot_id', :'p121_slot_a'::UUID,
    'declared_mime_type', 'application/pdf',
    'byte_size', 2048,
    'sha256_hex', :'p121_media_sha',
    'storage_object_present', FALSE,
    'document_slot_published', FALSE
  )
  AND (:'p121_upload'::JSONB ->> 'document_version_id') IS NOT NULL
  AND (:'p121_upload'::JSONB ->> 'upload_reservation_id') IS NOT NULL
  AND (:'p121_upload'::JSONB ->> 'storage_binding_id') IS NOT NULL
  AND (:'p121_upload'::JSONB ->> 'document_version_id')
    IS DISTINCT FROM
      (:'p121_unrelated_reservation'::JSONB ->> 'document_version_id')
  AND (
    SELECT pg_catalog.array_agg(receipt_key ORDER BY receipt_key)
    FROM pg_catalog.jsonb_object_keys(:'p121_upload'::JSONB)
      AS receipt(receipt_key)
  ) = ARRAY[
    'attachment_intent_id', 'bucket_id', 'byte_size', 'declared_mime_type',
    'document_slot_id', 'document_slot_published', 'document_version_id',
    'expires_at', 'object_name', 'organization_id', 'sha256_hex',
    'storage_binding_id', 'storage_object_present', 'student_case_id',
    'upload_reservation_id', 'version_number'
  ]::TEXT[],
  'service reserve must bind a distinct exact version to the intent'
);

SELECT platform.reserve_message_media_attachment_upload(
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  'clean', 'ClamAV', '1.5.5', '27891', 'clamd-zinstream-v1',
  statement_timestamp()
)::TEXT AS p121_upload_fresh_rescan_replay
\gset

SELECT pg_temp.p121_assert(
  :'p121_upload_fresh_rescan_replay'::JSONB = :'p121_upload'::JSONB,
  'a valid fresh rescan must replay the first durable reservation receipt'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment_upload(%L::uuid,%L,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      'clean', 'ClamAV', '1.5.5', 'invalid-signature',
      'clamd-zinstream-v1', statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = '22023',
  'reservation replay must validate every fresh scanner proof'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_upload'::JSONB ->> 'upload_reservation_id',
      'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = '42501',
  'completion before the exact reserved Storage object exists must roll back'
);

RESET ROLE;
RESET request.jwt.claims;

SAVEPOINT p121_slot_version_changed;

UPDATE platform.document_slots AS slot
SET version = slot.version + 1
WHERE slot.organization_id = :'p121_org_a'
  AND slot.id = :'p121_slot_a';

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_upload'::JSONB ->> 'upload_reservation_id',
      'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = 'PT409',
  'completion must reject a slot version changed after upload reservation'
);

RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p121_slot_version_changed;
RELEASE SAVEPOINT p121_slot_version_changed;

SAVEPOINT p121_membership_revoked;

UPDATE platform.organization_memberships
SET status = 'inactive'
WHERE id = :'p121_curator_a_membership';

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.reserve_message_media_attachment_upload(%L::uuid,%L,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      'clean', 'ClamAV', '1.5.5', '27891', 'clamd-zinstream-v1',
      statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = '42501',
  'reservation replay must revalidate the exact intent actor membership'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_upload'::JSONB ->> 'upload_reservation_id',
      'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      statement_timestamp()::TEXT
    ))->>'sqlstate'
  ) = '42501',
  'completion must revalidate the exact intent actor membership'
);

RESET ROLE;
RESET request.jwt.claims;
ROLLBACK TO SAVEPOINT p121_membership_revoked;
RELEASE SAVEPOINT p121_membership_revoked;

INSERT INTO storage.objects (bucket_id, name, metadata, created_at)
VALUES (
  :'p121_upload'::JSONB ->> 'bucket_id',
  :'p121_upload'::JSONB ->> 'object_name',
  jsonb_build_object('size', 2048, 'mimetype', 'application/pdf'),
  statement_timestamp()
);

SELECT statement_timestamp()::TEXT AS p121_stored_scan_at
\gset

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.complete_message_media_attachment(
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  (:'p121_upload'::JSONB ->> 'upload_reservation_id')::UUID,
  'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
  :'p121_stored_scan_at'::TIMESTAMPTZ
)::TEXT AS p121_complete
\gset

SELECT platform.complete_message_media_attachment(
  (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  (:'p121_upload'::JSONB ->> 'upload_reservation_id')::UUID,
  'ClamAV', '1.5.5', '27891', 'clamd-zinstream-v1',
  statement_timestamp()
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
    'document_version_id',
      (:'p121_upload'::JSONB ->> 'document_version_id')::UUID,
    'upload_reservation_id',
      (:'p121_upload'::JSONB ->> 'upload_reservation_id')::UUID,
    'sha256_hex', :'p121_media_sha'
  )
  AND (:'p121_complete'::JSONB ->> 'upload_finalization_id') IS NOT NULL
  AND (:'p121_complete'::JSONB ->> 'malware_scan_attestation_id') IS NOT NULL
  AND (
    SELECT pg_catalog.array_agg(receipt_key ORDER BY receipt_key)
    FROM pg_catalog.jsonb_object_keys(:'p121_complete'::JSONB)
      AS receipt(receipt_key)
  ) = ARRAY[
    'attachment_completion_id', 'attachment_intent_id', 'communication_media_id',
    'completed_at', 'conversation_id', 'document_slot_id',
    'document_version_id', 'malware_scan_attestation_id', 'organization_id',
    'sha256_hex', 'student_case_id', 'upload_finalization_id',
    'upload_reservation_id', 'version_number'
  ]::TEXT[],
  'completion must record and replay one exact causal-chain receipt'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p121_assert(
  EXISTS (
    SELECT 1
    FROM platform_private.message_media_attachment_intents AS intent
    JOIN platform_private.message_media_attachment_uploads AS attachment_upload
      ON attachment_upload.organization_id = intent.organization_id
      AND attachment_upload.attachment_intent_id = intent.id
    JOIN platform_private.message_media_attachment_completions AS completion
      ON completion.organization_id = attachment_upload.organization_id
      AND completion.attachment_intent_id =
        attachment_upload.attachment_intent_id
      AND completion.attachment_upload_id = attachment_upload.id
      AND completion.document_version_id =
        attachment_upload.document_version_id
      AND completion.upload_reservation_id =
        attachment_upload.upload_reservation_id
    JOIN platform_private.document_upload_finalizations AS finalization
      ON finalization.organization_id = completion.organization_id
      AND finalization.id = completion.upload_finalization_id
      AND finalization.upload_reservation_id =
        attachment_upload.upload_reservation_id
      AND finalization.document_version_id =
        attachment_upload.document_version_id
    JOIN platform_private.document_malware_scan_attestations AS scan_proof
      ON scan_proof.organization_id = completion.organization_id
      AND scan_proof.id = completion.malware_scan_attestation_id
      AND scan_proof.upload_finalization_id = finalization.id
      AND scan_proof.document_version_id = completion.document_version_id
      AND scan_proof.scanned_sha256_hex = completion.sha256_hex
    JOIN platform.audit_events AS reserve_audit
      ON reserve_audit.organization_id = intent.organization_id
      AND reserve_audit.request_id = intent.request_id
      AND reserve_audit.action = 'document.media.attach.reserve'
      AND reserve_audit.resource_type = 'document_slot'
      AND reserve_audit.resource_id = intent.document_slot_id
      AND reserve_audit.after_state @> intent.response
    JOIN platform.audit_events AS completion_audit
      ON completion_audit.organization_id = completion.organization_id
      AND completion_audit.request_id = completion.request_id
      AND completion_audit.action = 'document.media.attach.complete'
      AND completion_audit.resource_type = 'document_version'
      AND completion_audit.resource_id = completion.document_version_id
      AND completion_audit.after_state = completion.response
    WHERE intent.id =
      (:'p121_reserve'::JSONB ->> 'attachment_intent_id')::UUID
      AND attachment_upload.upload_reservation_id =
        (:'p121_upload'::JSONB ->> 'upload_reservation_id')::UUID
  ),
  'intent, reservation, version, finalization and scan must join exactly'
);

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(format(
      'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_unrelated_reservation'::JSONB ->> 'upload_reservation_id',
      'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
      :'p121_stored_scan_at'
    ))->>'sqlstate'
  ) = '23505',
  'a completed intent must reject a competing reservation replay'
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
    pg_temp.p121_capture_error(format(
      'DELETE FROM platform_private.message_media_attachment_uploads WHERE attachment_intent_id = %L::uuid',
      :'p121_reserve'::JSONB ->> 'attachment_intent_id'
    ))->>'sqlstate'
  ) = '55000',
  'attachment upload edges must be append-only'
);

SELECT pg_temp.p121_assert(
  (
    pg_temp.p121_capture_error(
      'TRUNCATE platform_private.message_media_attachment_completions'
    )->>'sqlstate'
  ) = '55000',
  'attachment completions must reject truncate'
);

SELECT pg_temp.p121_assert(
  (
    SELECT count(*)
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'p121_org_a'
      AND event.action = 'document.media.attach.reserve'
  ) = 3
  AND (
    SELECT count(*)
    FROM platform.audit_events AS event
    WHERE event.organization_id = :'p121_org_a'
      AND event.action = 'document.media.attach.complete'
  ) = 1,
  'each real attachment reserve and completion must append one audit event'
);

-- Commit one uncompleted exact chain so two independent dblink sessions can
-- race an append-only case-scope revocation against service completion.
SET request.jwt.claims TO :'p121_curator_a_claims';
SET ROLE authenticated;

SELECT platform.reserve_message_media_attachment(
  :'p121_conversation_1', :'p121_media_pdf', :'p121_case_a',
  :'p121_slot_a', 3, '59912100-0000-4000-8000-000000000929'
)::TEXT AS p121_race_reserve
\gset

RESET ROLE;
RESET request.jwt.claims;
SELECT statement_timestamp()::TEXT AS p121_race_scan_at
\gset
SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;

SELECT platform.reserve_message_media_attachment_upload(
  (:'p121_race_reserve'::JSONB ->> 'attachment_intent_id')::UUID,
  'clean', 'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
  :'p121_race_scan_at'::TIMESTAMPTZ
)::TEXT AS p121_race_upload
\gset

RESET ROLE;
RESET request.jwt.claims;

-- Move only the test clock window so the explicit SQL expiry branch is
-- deterministic without sleeping for the production reservation duration.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.document_upload_reservations AS reservation
SET
  created_at = statement_timestamp() - INTERVAL '20 minutes',
  expires_at = statement_timestamp() - INTERVAL '10 minutes',
  ingress_scanned_at = statement_timestamp() - INTERVAL '20 minutes'
WHERE reservation.id =
  (:'p121_race_upload'::JSONB ->> 'upload_reservation_id')::UUID;
SET LOCAL session_replication_role = origin;

SET request.jwt.claims TO '{"role":"service_role"}';
SET ROLE service_role;
SELECT pg_temp.p121_capture_error(format(
  'SELECT platform.complete_message_media_attachment(%L::uuid,%L::uuid,%L,%L,%L,%L,%L::timestamptz)',
  :'p121_race_reserve'::JSONB ->> 'attachment_intent_id',
  :'p121_race_upload'::JSONB ->> 'upload_reservation_id',
  'ClamAV', '1.5.4', '27890', 'clamd-zinstream-v1',
  statement_timestamp()::TEXT
))::TEXT AS p121_race_expired_error
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p121_assert(
  :'p121_race_expired_error'::JSONB ->> 'sqlstate' = 'PT409'
  AND :'p121_race_expired_error'::JSONB ->> 'message'
    = 'attachment_reservation_expired',
  'an expired exact reservation must fail with its explicit recovery code'
);

-- Restore a live reservation and exact Storage catalog row so current
-- authority would complete successfully; only the concurrent revocation may
-- stop the race below.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.document_upload_reservations AS reservation
SET
  created_at = statement_timestamp(),
  expires_at = statement_timestamp() + INTERVAL '10 minutes',
  ingress_scanned_at = :'p121_race_scan_at'::TIMESTAMPTZ
WHERE reservation.id =
  (:'p121_race_upload'::JSONB ->> 'upload_reservation_id')::UUID;
SET LOCAL session_replication_role = origin;

INSERT INTO storage.objects (bucket_id, name, metadata, created_at)
VALUES (
  :'p121_race_upload'::JSONB ->> 'bucket_id',
  :'p121_race_upload'::JSONB ->> 'object_name',
  jsonb_build_object('size', 2048, 'mimetype', 'application/pdf'),
  statement_timestamp()
);

SELECT
  intent.upload_finalization_request_id::TEXT AS p121_race_finalize_request,
  intent.completion_request_id::TEXT AS p121_race_complete_request
FROM platform_private.message_media_attachment_intents AS intent
WHERE intent.id =
  (:'p121_race_reserve'::JSONB ->> 'attachment_intent_id')::UUID
\gset

COMMIT;

DO $dblink_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension
    WHERE extension.extname = 'dblink'
  ) THEN
    RAISE EXCEPTION
      'Migration 121 test requires a disposable database without dblink';
  END IF;
END
$dblink_boundary$;

CREATE SCHEMA p121_test_extensions AUTHORIZATION postgres;
CREATE EXTENSION dblink WITH SCHEMA p121_test_extensions;

SET ROLE supabase_admin;
SELECT p121_test_extensions.dblink_connect(
  'p121c_authority',
  format(
    'hostaddr=127.0.0.1 port=%s dbname=%s user=postgres application_name=p121c-authority options=-csearch_path=',
    current_setting('port'),
    current_database()
  )
);
SELECT p121_test_extensions.dblink_connect(
  'p121c_complete',
  format(
    'hostaddr=127.0.0.1 port=%s dbname=%s user=postgres application_name=p121c-complete options=-csearch_path=',
    current_setting('port'),
    current_database()
  )
);
RESET ROLE;

SELECT p121_test_extensions.dblink_exec(
  'p121c_authority',
  'SET statement_timeout = ''15s''; SET lock_timeout = ''5s'''
);
SELECT p121_test_extensions.dblink_exec(
  'p121c_complete',
  'SET statement_timeout = ''15s''; SET lock_timeout = ''10s'''
);

SELECT p121_test_extensions.dblink_exec(
  'p121c_complete',
  $remote$
    BEGIN;
    CREATE OR REPLACE FUNCTION pg_temp.p121c_capture_error(p_statement TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    AS $capture$
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
    $capture$;
    GRANT EXECUTE ON FUNCTION pg_temp.p121c_capture_error(TEXT)
      TO service_role;
    SET ROLE service_role;
    SET LOCAL request.jwt.claims = '{"role":"service_role"}';
  $remote$
);

SELECT p121_test_extensions.dblink_exec(
  'p121c_authority',
  'BEGIN'
);

SELECT p121_test_extensions.dblink_exec(
  'p121c_authority',
  format(
    $authority$
      DO $revoke$
      BEGIN
        PERFORM platform_private.append_scope_event(
          %L::UUID,
          %L::UUID,
          %L::UUID,
          2,
          FALSE,
          'system',
          NULL,
          'Migration 121 concurrent case-scope revocation',
          '59912100-0000-4000-8000-000000000930'::UUID
        );
      END
      $revoke$
    $authority$,
    :'p121_org_a',
    :'p121_curator_a_membership',
    :'p121_case_scope_a_v2'
  )
);

SELECT pg_temp.p121_assert(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity AS activity
    WHERE activity.application_name = 'p121c-authority'
      AND activity.state = 'idle in transaction'
  ),
  'scope revocation did not retain its transaction locks'
);

SELECT pg_temp.p121_assert(
  p121_test_extensions.dblink_send_query(
    'p121c_complete',
    format(
      $complete$
        SELECT pg_temp.p121c_capture_error(
          $command$
            SELECT platform.complete_message_media_attachment(
              %L::UUID,
              %L::UUID,
              'ClamAV',
              '1.5.4',
              '27890',
              'clamd-zinstream-v1',
              statement_timestamp()
            )
          $command$
        )::TEXT AS outcome
      $complete$,
      :'p121_race_reserve'::JSONB ->> 'attachment_intent_id',
      :'p121_race_upload'::JSONB ->> 'upload_reservation_id'
    )
  ) = 1,
  'concurrent completion query was not dispatched'
);

DO $wait_for_completion_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..50 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS completion_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p121c-authority'
        AND authority_activity.pid = ANY (
          pg_catalog.pg_blocking_pids(completion_activity.pid)
        )
      WHERE completion_activity.application_name = 'p121c-complete'
        AND completion_activity.state = 'active'
        AND completion_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 121 completion worker did not wait for scope revocation';
END
$wait_for_completion_lock$;

SELECT p121_test_extensions.dblink_exec('p121c_authority', 'COMMIT');

SELECT result.outcome AS p121c_completion_outcome
FROM p121_test_extensions.dblink_get_result('p121c_complete')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p121c_completion_result_drained
FROM p121_test_extensions.dblink_get_result('p121c_complete')
  AS result(outcome TEXT)
\gset

SELECT pg_temp.p121_assert(
  :'p121c_completion_result_drained'::INTEGER = 0
  AND :'p121c_completion_outcome'::JSONB ->> 'sqlstate' = '42501'
  AND :'p121c_completion_outcome'::JSONB ->> 'message'
    = 'The attachment actor no longer has current case authority'
  AND EXISTS (
    SELECT 1
    FROM platform.membership_scope_assignments AS assignment
    WHERE assignment.organization_id = :'p121_org_a'
      AND assignment.membership_id = :'p121_curator_a_membership'
      AND assignment.scope_id = :'p121_case_scope_a_v2'
      AND assignment.assignment_version = 2
      AND NOT assignment.granted
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.message_media_attachment_completions AS completion
    WHERE completion.attachment_intent_id =
      (:'p121_race_reserve'::JSONB ->> 'attachment_intent_id')::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform_private.document_upload_finalizations AS finalization
    WHERE finalization.upload_reservation_id =
      (:'p121_race_upload'::JSONB ->> 'upload_reservation_id')::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id IN (
      :'p121_race_finalize_request'::UUID,
      :'p121_race_complete_request'::UUID
    )
  )
  AND EXISTS (
    SELECT 1
    FROM platform.document_slots AS slot
    WHERE slot.organization_id = :'p121_org_a'
      AND slot.id = :'p121_slot_a'
      AND slot.version = 3
      AND slot.current_version_id =
        (:'p121_complete'::JSONB ->> 'document_version_id')::UUID
      AND slot.current_version_id IS DISTINCT FROM
        (:'p121_race_upload'::JSONB ->> 'document_version_id')::UUID
  ),
  'scope-revocation race did not fail closed before finalization'
);

SELECT p121_test_extensions.dblink_exec('p121c_complete', 'ROLLBACK');
SELECT p121_test_extensions.dblink_disconnect('p121c_complete');
SELECT p121_test_extensions.dblink_disconnect('p121c_authority');

-- Remove every committed synthetic row, including generated ledger/audit IDs.
BEGIN;
SET LOCAL session_replication_role = replica;
DO $cleanup$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT
      column_info.table_schema,
      column_info.table_name,
      pg_catalog.string_agg(
        pg_catalog.format(
          '%I::TEXT LIKE %L',
          column_info.column_name,
          '59912100-%'
        ),
        ' OR '
        ORDER BY column_info.ordinal_position
      ) AS predicate
    FROM information_schema.columns AS column_info
    JOIN information_schema.tables AS table_info
      ON table_info.table_schema = column_info.table_schema
      AND table_info.table_name = column_info.table_name
      AND table_info.table_type = 'BASE TABLE'
    WHERE column_info.table_schema IN (
      'auth', 'platform', 'platform_private', 'public'
    )
      AND column_info.data_type = 'uuid'
    GROUP BY column_info.table_schema, column_info.table_name
  LOOP
    EXECUTE pg_catalog.format(
      'DELETE FROM %I.%I WHERE %s',
      target.table_schema,
      target.table_name,
      target.predicate
    );
  END LOOP;
END
$cleanup$;
DELETE FROM storage.objects AS object
WHERE (object.bucket_id, object.name) IN (
  (
    :'p121_unrelated_reservation'::JSONB ->> 'bucket_id',
    :'p121_unrelated_reservation'::JSONB ->> 'object_name'
  ),
  (
    :'p121_upload'::JSONB ->> 'bucket_id',
    :'p121_upload'::JSONB ->> 'object_name'
  ),
  (
    :'p121_race_upload'::JSONB ->> 'bucket_id',
    :'p121_race_upload'::JSONB ->> 'object_name'
  )
);
DELETE FROM storage.buckets WHERE id = 'platform-documents';
COMMIT;

DROP EXTENSION dblink;
DROP SCHEMA p121_test_extensions;

SELECT 'platform message media case attach checks passed' AS result;
