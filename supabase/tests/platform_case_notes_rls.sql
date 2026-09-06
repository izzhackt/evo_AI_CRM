\set ON_ERROR_STOP on

-- Focused current-boundary acceptance for migration 117 (append-only case
-- notes). The synthetic organization, identities, leads and cases exist only
-- inside this rolled-back transaction.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p117_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 117 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p117_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p117_assert(BOOLEAN, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p117_capture_error(TEXT)
  TO anon, authenticated, service_role;

DO $catalog_contract$
DECLARE
  routine_oid OID;
  routine_count INTEGER;
  forbidden_role TEXT;
  expected_signature TEXT;
  rpc_name TEXT;
  private_name TEXT;
  private_signature TEXT;
  private_authenticated BOOLEAN;
  api_role TEXT;
  table_privilege TEXT;
BEGIN
  IF to_regclass('platform.case_notes') IS NULL THEN
    RAISE EXCEPTION 'platform.case_notes is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'case_notes'
      AND column_name = 'body'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'case_notes'
      AND column_name = 'created_by_membership_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'case_notes body/author contract drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform'
      AND relation.relname = 'case_notes'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'case_notes RLS is not enabled and forced';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'platform'
      AND policy.tablename = 'case_notes'
  ) THEN
    RAISE EXCEPTION
      'case_notes unexpectedly has an RLS policy; access is RPC-only';
  END IF;

  FOREACH api_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    FOREACH table_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(
        api_role,
        'platform.case_notes',
        table_privilege
      ) THEN
        RAISE EXCEPTION '% unexpectedly holds % on case_notes',
          api_role, table_privilege;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'platform.case_notes'::REGCLASS
      AND trigger_row.tgname = 'case_notes_append_only'
      AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'platform.case_notes'::REGCLASS
      AND trigger_row.tgname = 'case_notes_append_only_truncate'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'case_notes row or truncate append-only trigger is missing';
  END IF;

  FOR rpc_name, expected_signature IN
    SELECT * FROM (VALUES
      (
        'create_case_note',
        'p_organization_id uuid, p_lead_id uuid, p_student_case_id uuid, p_body text, p_request_id uuid'
      ),
      (
        'list_case_notes',
        'p_lead_id uuid, p_student_case_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_note_id uuid'
      ),
      (
        'assign_student_case_curator',
        'p_organization_id uuid, p_student_case_id uuid, p_curator_membership_id uuid, p_reason text, p_request_id uuid'
      )
    ) AS expected(rpc_name, expected_signature)
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = rpc_name;

    IF routine_count <> 1
      OR routine_oid IS NULL
      OR pg_get_function_identity_arguments(routine_oid) <> expected_signature
    THEN
      RAISE EXCEPTION 'platform.% signature or single-path contract drifted',
        rpc_name;
    END IF;

    IF NOT COALESCE((
      SELECT NOT routine.prosecdef
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = routine_oid
    ), FALSE) THEN
      RAISE EXCEPTION 'platform.% execution contract drifted', rpc_name;
    END IF;

    IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated lacks EXECUTE on platform.%', rpc_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes platform.%',
          forbidden_role, rpc_name;
      END IF;
    END LOOP;
  END LOOP;

  FOR private_name, private_signature, private_authenticated IN
    SELECT * FROM (VALUES
      (
        'create_case_note',
        'p_organization_id uuid, p_lead_id uuid, p_student_case_id uuid, p_body text, p_request_id uuid',
        TRUE
      ),
      (
        'list_case_notes',
        'p_lead_id uuid, p_student_case_id uuid, p_limit integer, p_before_created_at timestamp with time zone, p_before_note_id uuid',
        TRUE
      ),
      (
        'assign_student_case_curator',
        'p_organization_id uuid, p_student_case_id uuid, p_curator_membership_id uuid, p_reason text, p_request_id uuid',
        TRUE
      ),
      ('require_lead_note_actor', 'p_organization_id uuid, p_lead_id uuid', FALSE),
      (
        'require_lead_note_mutation_actor',
        'p_organization_id uuid, p_lead_id uuid',
        FALSE
      ),
      (
        'require_student_case_note_mutation_actor',
        'p_organization_id uuid, p_student_case_id uuid',
        FALSE
      ),
      ('forbid_case_note_change', '', FALSE)
    ) AS expected(private_name, private_signature, private_authenticated)
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = private_name;

    IF routine_count <> 1
      OR routine_oid IS NULL
      OR pg_get_function_identity_arguments(routine_oid) <> private_signature
      OR NOT COALESCE((
        SELECT routine.prosecdef
          AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = routine_oid
      ), FALSE)
    THEN
      RAISE EXCEPTION 'private.% privileged-body contract drifted', private_name;
    END IF;

    IF has_function_privilege('authenticated', routine_oid, 'EXECUTE')
      IS DISTINCT FROM private_authenticated
    THEN
      RAISE EXCEPTION 'private.% authenticated grant drifted', private_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes private.%',
          forbidden_role, private_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = 'require_lead_note_actor'
      AND routine.provolatile = 's'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = 'require_lead_note_mutation_actor'
      AND routine.provolatile = 'v'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = 'require_student_case_note_mutation_actor'
      AND routine.provolatile = 'v'
  ) THEN
    RAISE EXCEPTION 'case-note read/mutation volatility boundary drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = 'assign_student_case_curator'
      AND NOT routine.prosecdef
      AND routine.provolatile = 'v'
      AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.strpos(
        routine.prosrc,
        'private.assign_student_case_curator'
      ) > 0
  ) THEN
    RAISE EXCEPTION
      'platform.assign_student_case_curator invoker boundary drifted';
  END IF;

  SELECT count(*), (array_agg(routine.oid))[1]
  INTO routine_count, routine_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'private'
    AND routine.proname = 'assign_student_case_curator';
  IF routine_count <> 1
    OR routine_oid IS NULL
    OR pg_get_function_identity_arguments(routine_oid) <>
      'p_organization_id uuid, p_student_case_id uuid, p_curator_membership_id uuid, p_reason text, p_request_id uuid'
    OR NOT COALESCE((
      SELECT routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        AND pg_catalog.strpos(
          routine.prosrc,
          'lock_student_case_note_assignment_domain'
        ) > 0
        AND pg_catalog.strpos(
          routine.prosrc,
          'lock_student_case_note_assignment_domain'
        ) < pg_catalog.strpos(routine.prosrc, 'lock_p2d_request')
        AND pg_catalog.strpos(routine.prosrc, 'lock_p2d_request')
          < pg_catalog.strpos(
            routine.prosrc,
            'require_case_assignment_admin_locked'
          )
        AND pg_catalog.strpos(
          routine.prosrc,
          'require_case_assignment_admin_locked'
        ) < pg_catalog.strpos(
          routine.prosrc,
          'assign_student_case_curator_body'
        )
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = routine_oid
    ), FALSE)
    OR NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE')
  THEN
    RAISE EXCEPTION
      'serialized private.assign_student_case_curator contract drifted';
  END IF;
  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% unexpectedly executes private Curator coordinator',
        forbidden_role;
    END IF;
  END LOOP;

  FOR private_name, private_signature IN
    SELECT * FROM (VALUES
      (
        'assign_student_case_curator_body',
        'p_organization_id uuid, p_student_case_id uuid, p_curator_membership_id uuid, p_reason text, p_request_id uuid'
      ),
      (
        'lock_student_case_note_assignment_domain',
        'p_organization_id uuid'
      ),
      (
        'require_case_assignment_admin_locked',
        'p_organization_id uuid'
      )
    ) AS expected(private_name, private_signature)
  LOOP
    SELECT count(*), (array_agg(routine.oid))[1]
    INTO routine_count, routine_oid
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform_private'
      AND routine.proname = private_name;

    IF routine_count <> 1
      OR routine_oid IS NULL
      OR pg_get_function_identity_arguments(routine_oid) <> private_signature
      OR NOT COALESCE((
        SELECT routine.prosecdef
          AND routine.provolatile = 'v'
          AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
        FROM pg_catalog.pg_proc AS routine
        WHERE routine.oid = routine_oid
      ), FALSE)
    THEN
      RAISE EXCEPTION 'platform_private.% serialization contract drifted',
        private_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ]
    LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes platform_private.%',
          forbidden_role, private_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = 'create_case_note'
      AND pg_catalog.strpos(
        routine.prosrc,
        'lock_student_case_note_assignment_domain'
      ) > 0
      AND pg_catalog.strpos(
        routine.prosrc,
        'lock_student_case_note_assignment_domain'
      ) < pg_catalog.strpos(routine.prosrc, 'lock_p2d_request')
  ) THEN
    RAISE EXCEPTION
      'student-case note domain lock must precede its request lock';
  END IF;

  SELECT count(*), (array_agg(routine.oid))[1]
  INTO routine_count, routine_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'private'
    AND routine.proname = 'assert_case_note_request_actor';
  IF routine_count <> 1
    OR routine_oid IS NULL
    OR pg_get_function_identity_arguments(routine_oid) <>
      'p_request_id uuid, p_organization_id uuid, p_actor_profile_id uuid, p_actor_auth_user_id uuid'
    OR NOT COALESCE((
      SELECT NOT routine.prosecdef
        AND routine.provolatile = 's'
        AND routine.proconfig @> ARRAY['search_path=""']::TEXT[]
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = routine_oid
    ), FALSE)
  THEN
    RAISE EXCEPTION
      'private.assert_case_note_request_actor execution contract drifted';
  END IF;
  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
  ]
  LOOP
    IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% unexpectedly executes private actor replay guard',
        forbidden_role;
    END IF;
  END LOOP;

  SELECT routine.oid
  INTO routine_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'platform_private'
    AND routine.proname = 'p7a_safe_audit_actions';
  IF routine_oid IS NULL OR (
    SELECT routine.prosecdef
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = routine_oid
  ) THEN
    RAISE EXCEPTION 'audit action composition must remain SECURITY INVOKER';
  END IF;

  IF NOT ('note.create' = ANY (platform_private.p7a_safe_audit_actions())) THEN
    RAISE EXCEPTION 'note.create is absent from the Admin audit journal';
  END IF;
  IF NOT ('lead' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR NOT (
      'student_case' = ANY (platform_private.p7a_safe_audit_resource_types())
    )
  THEN
    RAISE EXCEPTION 'note subject resource types left the Admin journal';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p117_admin_bundle, bundle.version AS p117_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'lead.sales.workflow.manage'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_sales_bundle, bundle.version AS p117_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'lead.sales.workflow.manage'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_curator_bundle, bundle.version AS p117_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p117_student_bundle, bundle.version AS p117_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p117_org 59911700-0000-4000-8000-000000000001
\set p117_other_org 59911700-0000-4000-8000-000000000002
\set p117_org_scope 59911700-0000-4000-8000-000000000003
\set p117_case_scope 59911700-0000-4000-8000-000000000004
\set p117_case 59911700-0000-4000-8000-000000000005
\set p117_admin_user 59911700-0000-4000-8000-000000000011
\set p117_sales_user 59911700-0000-4000-8000-000000000012
\set p117_sales_two_user 59911700-0000-4000-8000-000000000013
\set p117_curator_user 59911700-0000-4000-8000-000000000014
\set p117_student_user 59911700-0000-4000-8000-000000000015
\set p117_admin_profile 59911700-0000-4000-8000-000000000021
\set p117_sales_profile 59911700-0000-4000-8000-000000000022
\set p117_sales_two_profile 59911700-0000-4000-8000-000000000023
\set p117_curator_profile 59911700-0000-4000-8000-000000000024
\set p117_student_profile 59911700-0000-4000-8000-000000000025
\set p117_admin_membership 59911700-0000-4000-8000-000000000031
\set p117_sales_membership 59911700-0000-4000-8000-000000000032
\set p117_sales_two_membership 59911700-0000-4000-8000-000000000033
\set p117_curator_membership 59911700-0000-4000-8000-000000000034
\set p117_student_membership 59911700-0000-4000-8000-000000000035
\set p117_lead_owned 59911700-0000-4000-8000-000000000061
\set p117_lead_unowned 59911700-0000-4000-8000-000000000062
\set p117_lead_foreign_owner 59911700-0000-4000-8000-000000000063

INSERT INTO platform.organizations (id, name) VALUES
  (:'p117_org', 'Migration 117 Organization'),
  (:'p117_other_org', 'Migration 117 Other Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p117_org_scope', :'p117_org', 'organization', :'p117_org', 1),
  (:'p117_case_scope', :'p117_org', 'student_case', :'p117_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p117_admin_user', 'p117-admin@example.invalid', '{}'::JSONB),
  (:'p117_sales_user', 'p117-sales@example.invalid', '{}'::JSONB),
  (:'p117_sales_two_user', 'p117-sales-two@example.invalid', '{}'::JSONB),
  (:'p117_curator_user', 'p117-curator@example.invalid', '{}'::JSONB),
  (:'p117_student_user', 'p117-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p117_admin_profile', :'p117_admin_user', 'Migration 117 Admin', 'active', 1),
  (:'p117_sales_profile', :'p117_sales_user', 'Migration 117 Sales', 'active', 1),
  (:'p117_sales_two_profile', :'p117_sales_two_user', 'Migration 117 Second Sales', 'active', 1),
  (:'p117_curator_profile', :'p117_curator_user', 'Migration 117 Curator', 'active', 1),
  (:'p117_student_profile', :'p117_student_user', 'Migration 117 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p117_admin_membership', :'p117_org', :'p117_admin_profile', 'active', 'admin', :'p117_admin_bundle'),
  (:'p117_sales_membership', :'p117_org', :'p117_sales_profile', 'active', 'sales', :'p117_sales_bundle'),
  (:'p117_sales_two_membership', :'p117_org', :'p117_sales_two_profile', 'active', 'sales', :'p117_sales_bundle'),
  (:'p117_curator_membership', :'p117_org', :'p117_curator_profile', 'active', 'curator', :'p117_curator_bundle'),
  (:'p117_student_membership', :'p117_org', :'p117_student_profile', 'active', 'student', :'p117_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911700-0000-4000-8000-000000000041', :'p117_org', :'p117_admin_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Admin org scope', '59911700-0000-4000-8000-000000000141'),
  ('59911700-0000-4000-8000-000000000042', :'p117_org', :'p117_sales_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Sales org scope', '59911700-0000-4000-8000-000000000142'),
  ('59911700-0000-4000-8000-000000000043', :'p117_org', :'p117_sales_two_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Second Sales org scope', '59911700-0000-4000-8000-000000000143'),
  ('59911700-0000-4000-8000-000000000044', :'p117_org', :'p117_curator_membership', :'p117_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Curator org scope', '59911700-0000-4000-8000-000000000144'),
  ('59911700-0000-4000-8000-000000000045', :'p117_org', :'p117_sales_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Sales case scope', '59911700-0000-4000-8000-000000000145'),
  ('59911700-0000-4000-8000-000000000046', :'p117_org', :'p117_curator_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Curator case scope', '59911700-0000-4000-8000-000000000146'),
  ('59911700-0000-4000-8000-000000000047', :'p117_org', :'p117_student_membership', :'p117_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 117 Student case scope', '59911700-0000-4000-8000-000000000147');

INSERT INTO platform.leads (
  id, organization_id, client_id, current_owner_membership_id,
  stage_key, source_key, lifecycle_state
) VALUES
  (:'p117_lead_owned', :'p117_org', NULL, :'p117_sales_membership', 'new', 'whatsapp', 'open'),
  (:'p117_lead_unowned', :'p117_org', NULL, NULL, 'new', 'whatsapp', 'open'),
  (:'p117_lead_foreign_owner', :'p117_org', NULL, :'p117_sales_two_membership', 'new', 'whatsapp', 'open');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p117_case', :'p117_org', :'p117_student_membership',
  :'p117_sales_membership', NULL,
  'synthetic:p117:case', 'contract:p117', '2026-09-05T09:00:00Z',
  'Migration 117 Student', 'United Kingdom', 'Bachelor', 'Business',
  '2031', 'approved', 'contract_confirmed', 'pending', NULL, NULL,
  'Record the first case note', :'p117_case_scope', 1
);

SELECT jsonb_build_object(
  'sub', :'p117_admin_user', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_admin_membership',
  'platform_bundle_id', :'p117_admin_bundle',
  'platform_bundle_version', :'p117_admin_version'::INTEGER
)::TEXT AS p117_admin_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_admin_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p117_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_sales_membership',
  'platform_bundle_id', :'p117_sales_bundle',
  'platform_bundle_version', :'p117_sales_version'::INTEGER
)::TEXT AS p117_sales_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_sales_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p117_sales_two_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_sales_two_membership',
  'platform_bundle_id', :'p117_sales_bundle',
  'platform_bundle_version', :'p117_sales_version'::INTEGER
)::TEXT AS p117_sales_two_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_sales_two_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p117_student_user', 'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_student_membership',
  'platform_bundle_id', :'p117_student_bundle',
  'platform_bundle_version', :'p117_student_version'::INTEGER
)::TEXT AS p117_student_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_student_profile'
\gset

-- Sales writes and replays a note on an owned lead; the same request id with
-- a different body is a conflict, not a second note.
SET request.jwt.claims TO :'p117_sales_claims';
SET ROLE authenticated;

SELECT platform.create_case_note(
  p_organization_id => :'p117_org',
  p_lead_id => :'p117_lead_owned',
  p_student_case_id => NULL,
  p_body => E'First contact done.\nStudent asks about UK foundation year.',
  p_request_id => '59911700-0000-4000-8000-000000000201'
)::TEXT AS p117_lead_note_create
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL,
  E'First contact done.\nStudent asks about UK foundation year.',
  '59911700-0000-4000-8000-000000000201'
)::TEXT AS p117_lead_note_replay
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Different body, same request',
  '59911700-0000-4000-8000-000000000201'
))::TEXT AS p117_request_conflict_error
\gset

SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL, 'Second note on the owned lead.',
  '59911700-0000-4000-8000-000000000202'
)::TEXT AS p117_lead_note_two
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_owned', NULL, 'Third note on the owned lead.',
  '59911700-0000-4000-8000-000000000203'
)::TEXT AS p117_lead_note_three
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_unowned', NULL, 'Unowned leads accept sales notes.',
  '59911700-0000-4000-8000-000000000204'
)::TEXT AS p117_unowned_lead_note
\gset

-- A second Sales actor may access the same unowned lead, but must never
-- recover the first actor's mutation result from an exact request-id replay.
RESET ROLE;
SET request.jwt.claims TO :'p117_sales_two_claims';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_unowned', 'Unowned leads accept sales notes.',
  '59911700-0000-4000-8000-000000000204'
))::TEXT AS p117_cross_actor_replay_error
\gset
RESET ROLE;
SET request.jwt.claims TO :'p117_sales_claims';
SET ROLE authenticated;

-- Validation and authority failures stay closed.
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_foreign_owner', 'Not my lead',
  '59911700-0000-4000-8000-000000000205'
))::TEXT AS p117_foreign_owner_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', :'p117_case', 'Two subjects',
  '59911700-0000-4000-8000-000000000206'
))::TEXT AS p117_two_subjects_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, NULL, %L, %L::UUID)',
  :'p117_org', 'No subject',
  '59911700-0000-4000-8000-000000000207'
))::TEXT AS p117_no_subject_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', '   ',
  '59911700-0000-4000-8000-000000000208'
))::TEXT AS p117_blank_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', E'\n\t\r',
  '59911700-0000-4000-8000-000000000250'
))::TEXT AS p117_control_whitespace_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', U&'\00A0',
  '59911700-0000-4000-8000-000000000251'
))::TEXT AS p117_unicode_whitespace_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', repeat('a', 4001),
  '59911700-0000-4000-8000-000000000209'
))::TEXT AS p117_long_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', E'bell\x07character',
  '59911700-0000-4000-8000-000000000210'
))::TEXT AS p117_control_body_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, NULL)',
  :'p117_org', :'p117_lead_owned', 'Missing request id'
))::TEXT AS p117_null_request_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_other_org', :'p117_lead_owned', 'Cross-organization write',
  '59911700-0000-4000-8000-000000000211'
))::TEXT AS p117_cross_org_error
\gset

-- Sales writes on the pending case it owns.
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Pending case note from Sales.',
  '59911700-0000-4000-8000-000000000212'
)::TEXT AS p117_case_note_sales
\gset

-- Direct table access is closed even for an authorized staff session.
SELECT pg_temp.p117_capture_error(
  'SELECT count(*) FROM platform.case_notes'
)::TEXT AS p117_direct_select_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'INSERT INTO platform.case_notes '
    || '(organization_id, lead_id, body, created_by_membership_id) '
    || 'VALUES (%L::UUID, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Direct insert',
  :'p117_sales_membership'
))::TEXT AS p117_direct_insert_error
\gset

RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_lead_note_create'::JSONB = :'p117_lead_note_replay'::JSONB
    AND :'p117_lead_note_create'::JSONB ->> 'lead_id' = :'p117_lead_owned'
    AND :'p117_lead_note_create'::JSONB -> 'student_case_id' = 'null'::JSONB
    AND :'p117_lead_note_create'::JSONB ->> 'created_by_membership_id'
      = :'p117_sales_membership'
    AND (:'p117_lead_note_create'::JSONB ->> 'body') LIKE E'%\n%'
    AND :'p117_request_conflict_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_cross_actor_replay_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_foreign_owner_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_two_subjects_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_no_subject_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_blank_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_control_whitespace_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_unicode_whitespace_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_long_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_control_body_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_null_request_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_cross_org_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_direct_select_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_direct_insert_error'::JSONB ->> 'sqlstate' = '42501',
  'lead note create/replay/validation/tenancy/direct-access contract drifted'
);

SELECT pg_temp.p117_assert(
  (
    SELECT count(*)
    FROM platform.case_notes AS note
    WHERE note.organization_id = :'p117_org'
  ) = 5
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id = '59911700-0000-4000-8000-000000000201'
        AND event.action = 'note.create'
        AND event.resource_type = 'lead'
        AND event.resource_id = :'p117_lead_owned'
        AND event.before_state IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id = '59911700-0000-4000-8000-000000000212'
        AND event.action = 'note.create'
        AND event.resource_type = 'student_case'
        AND event.resource_id = :'p117_case'
    ),
  'note durable state or Admin-journal audit facts drifted'
);

-- Keyset listing: newest-first, complete cursor, no duplicates across pages.
SET ROLE authenticated;
SELECT pg_temp.p117_assert(
  (
    WITH full_page AS (
      SELECT
        page.case_note_id,
        page.created_at,
        page.author_display_name,
        row_number() OVER () AS position
      FROM platform.list_case_notes(:'p117_lead_owned', NULL, 101) AS page
    ),
    first_page AS (
      SELECT page.case_note_id, page.created_at,
        row_number() OVER () AS position
      FROM platform.list_case_notes(:'p117_lead_owned', NULL, 2) AS page
    ),
    cursor_row AS (
      SELECT * FROM first_page WHERE position = 2
    ),
    second_page AS (
      SELECT page.case_note_id
      FROM cursor_row
      CROSS JOIN LATERAL platform.list_case_notes(
        :'p117_lead_owned', NULL, 101,
        cursor_row.created_at, cursor_row.case_note_id
      ) AS page
    )
    SELECT (SELECT count(*) FROM full_page) = 3
      AND (SELECT count(*) FROM first_page) = 2
      AND (SELECT bool_and(author_display_name = 'Migration 117 Sales')
        FROM full_page)
      AND NOT EXISTS (
        SELECT 1
        FROM full_page AS later
        JOIN full_page AS earlier ON earlier.position = later.position + 1
        WHERE (earlier.created_at, earlier.case_note_id)
          > (later.created_at, later.case_note_id)
      )
      AND (SELECT array_agg(case_note_id ORDER BY position) FROM first_page)
        = (
          SELECT array_agg(case_note_id ORDER BY position)
          FROM full_page WHERE position <= 2
        )
      AND (SELECT array_agg(case_note_id) FROM second_page)
        = (
          SELECT array_agg(case_note_id ORDER BY position)
          FROM full_page WHERE position = 3
        )
  ),
  'lead note keyset pagination drifted'
);

SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 0)',
  :'p117_lead_owned'
))::TEXT AS p117_zero_limit_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 102)',
  :'p117_lead_owned'
))::TEXT AS p117_high_limit_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, %L::UUID, 10)',
  :'p117_lead_owned', :'p117_case'
))::TEXT AS p117_list_two_subjects_error
\gset
SELECT pg_temp.p117_capture_error(
  'SELECT count(*) FROM platform.list_case_notes(NULL, NULL, 10)'
)::TEXT AS p117_list_no_subject_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10, '
    || 'statement_timestamp(), NULL)',
  :'p117_lead_owned'
))::TEXT AS p117_half_cursor_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10)',
  :'p117_lead_foreign_owner'
))::TEXT AS p117_list_foreign_owner_error
\gset

RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_zero_limit_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_high_limit_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_two_subjects_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_no_subject_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_half_cursor_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117_list_foreign_owner_error'::JSONB ->> 'sqlstate' = '42501',
  'list validation or lead visibility contract drifted'
);

-- The Student never reads or writes staff notes.
RESET request.jwt.claims;
SET request.jwt.claims TO :'p117_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Student note attempt',
  '59911700-0000-4000-8000-000000000213'
))::TEXT AS p117_student_create_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(NULL, %L::UUID, 10)',
  :'p117_case'
))::TEXT AS p117_student_list_error
\gset
RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_student_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_student_list_error'::JSONB ->> 'sqlstate' = '42501',
  'student unexpectedly touched staff case notes'
);

-- Handoff: curator fails before assignment, owns the case after it, and the
-- former Sales owner then fails closed while Admin remains the superset.
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_curator_membership',
  'platform_bundle_id', :'p117_curator_bundle',
  'platform_bundle_version', :'p117_curator_version'::INTEGER
)::TEXT AS p117_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117_curator_profile'
\gset

SET request.jwt.claims TO :'p117_curator_claims';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Curator note before handoff',
  '59911700-0000-4000-8000-000000000214'
))::TEXT AS p117_curator_pending_error
\gset

RESET ROLE;
RESET request.jwt.claims;
SET request.jwt.claims TO :'p117_admin_claims';
SET ROLE authenticated;
SELECT platform.assign_student_case_curator(
  :'p117_org', :'p117_case', :'p117_curator_membership',
  'Activate migration 117 case',
  '59911700-0000-4000-8000-000000000215'
);
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Admin note after handoff.',
  '59911700-0000-4000-8000-000000000216'
)::TEXT AS p117_case_note_admin
\gset
SELECT platform.create_case_note(
  :'p117_org', :'p117_lead_foreign_owner', NULL,
  'Admin can note every lead of the organization.',
  '59911700-0000-4000-8000-000000000217'
)::TEXT AS p117_admin_foreign_lead_note
\gset

RESET ROLE;
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_curator_membership',
  'platform_bundle_id', :'p117_curator_bundle',
  'platform_bundle_version', :'p117_curator_version'::INTEGER
)::TEXT AS p117_curator_claims_active
FROM platform.profiles AS profile
WHERE profile.id = :'p117_curator_profile'
\gset
SET request.jwt.claims TO :'p117_curator_claims_active';
SET ROLE authenticated;
SELECT platform.create_case_note(
  :'p117_org', NULL, :'p117_case', 'Curator note after handoff.',
  '59911700-0000-4000-8000-000000000218'
)::TEXT AS p117_case_note_curator
\gset
SELECT count(*) AS p117_curator_case_note_count
FROM platform.list_case_notes(NULL, :'p117_case', 101)
\gset

RESET ROLE;
RESET request.jwt.claims;
SELECT jsonb_build_object(
  'sub', :'p117_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117_org',
  'platform_membership_id', :'p117_sales_membership',
  'platform_bundle_id', :'p117_sales_bundle',
  'platform_bundle_version', :'p117_sales_version'::INTEGER
)::TEXT AS p117_sales_claims_after
FROM platform.profiles AS profile
WHERE profile.id = :'p117_sales_profile'
\gset
SET request.jwt.claims TO :'p117_sales_claims_after';
SET ROLE authenticated;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, NULL, %L::UUID, %L, %L::UUID)',
  :'p117_org', :'p117_case', 'Sales after handoff',
  '59911700-0000-4000-8000-000000000219'
))::TEXT AS p117_sales_active_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(NULL, %L::UUID, 10)',
  :'p117_case'
))::TEXT AS p117_sales_active_list_error
\gset
RESET ROLE;
RESET request.jwt.claims;

SELECT pg_temp.p117_assert(
  :'p117_curator_pending_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_case_note_admin'::JSONB ->> 'student_case_id' = :'p117_case'
    AND :'p117_admin_foreign_lead_note'::JSONB ->> 'lead_id'
      = :'p117_lead_foreign_owner'
    AND :'p117_case_note_curator'::JSONB ->> 'created_by_membership_id'
      = :'p117_curator_membership'
    AND :'p117_curator_case_note_count'::BIGINT = 3
    AND :'p117_sales_active_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_sales_active_list_error'::JSONB ->> 'sqlstate' = '42501',
  'handoff authority rotation for case notes drifted'
);

-- Notes are append-only facts even for privileged sessions.
SELECT pg_temp.p117_capture_error(format(
  'UPDATE platform.case_notes SET body = %L WHERE organization_id = %L::UUID',
  'Rewritten history', :'p117_org'
))::TEXT AS p117_update_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'DELETE FROM platform.case_notes WHERE organization_id = %L::UUID',
  :'p117_org'
))::TEXT AS p117_delete_error
\gset
SELECT pg_temp.p117_capture_error(
  'TRUNCATE platform.case_notes'
)::TEXT AS p117_truncate_error
\gset
SELECT pg_temp.p117_assert(
  :'p117_update_error'::JSONB ->> 'sqlstate' = '55000'
    AND :'p117_delete_error'::JSONB ->> 'sqlstate' = '55000'
    AND :'p117_truncate_error'::JSONB ->> 'sqlstate' = '55000',
  'case notes were not append-only'
);

-- anon holds no door at all.
SET ROLE anon;
SELECT pg_temp.p117_capture_error(format(
  'SELECT platform.create_case_note(%L::UUID, %L::UUID, NULL, %L, %L::UUID)',
  :'p117_org', :'p117_lead_owned', 'Anonymous note',
  '59911700-0000-4000-8000-000000000220'
))::TEXT AS p117_anon_create_error
\gset
SELECT pg_temp.p117_capture_error(format(
  'SELECT count(*) FROM platform.list_case_notes(%L::UUID, NULL, 10)',
  :'p117_lead_owned'
))::TEXT AS p117_anon_list_error
\gset
RESET ROLE;
SELECT pg_temp.p117_assert(
  :'p117_anon_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117_anon_list_error'::JSONB ->> 'sqlstate' = '42501',
  'anon unexpectedly reached case notes'
);

RESET request.jwt.claims;
ROLLBACK;

-- Real second-session races prove the mutation lock order against the actual
-- Sales workflow and actor-authority writers. dblink and the fixture-scoped
-- pause trigger are test-only and removed again.
CREATE OR REPLACE FUNCTION pg_temp.p117c_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 117 concurrency assertion failed: %', p_message;
  END IF;
END
$$;

DO $dblink_boundary$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension AS extension
    WHERE extension.extname = 'dblink'
  ) THEN
    RAISE EXCEPTION 'Migration 117 test requires a disposable database without dblink';
  END IF;
END
$dblink_boundary$;
CREATE SCHEMA p117_test_extensions AUTHORIZATION postgres;
CREATE EXTENSION dblink WITH SCHEMA p117_test_extensions;

BEGIN;

\set p117c_org 59911799-0000-4000-8000-000000000001
\set p117c_org_scope 59911799-0000-4000-8000-000000000002
\set p117c_case_scope 59911799-0000-4000-8000-000000000003
\set p117c_case_two_scope 59911799-0000-4000-8000-000000000004
\set p117c_case_three_scope 59911799-0000-4000-8000-000000000005
\set p117c_sales_user 59911799-0000-4000-8000-000000000011
\set p117c_sales_two_user 59911799-0000-4000-8000-000000000012
\set p117c_admin_user 59911799-0000-4000-8000-000000000013
\set p117c_curator_user 59911799-0000-4000-8000-000000000014
\set p117c_student_user 59911799-0000-4000-8000-000000000015
\set p117c_admin_two_user 59911799-0000-4000-8000-000000000016
\set p117c_sales_profile 59911799-0000-4000-8000-000000000021
\set p117c_sales_two_profile 59911799-0000-4000-8000-000000000022
\set p117c_admin_profile 59911799-0000-4000-8000-000000000023
\set p117c_curator_profile 59911799-0000-4000-8000-000000000024
\set p117c_student_profile 59911799-0000-4000-8000-000000000025
\set p117c_admin_two_profile 59911799-0000-4000-8000-000000000026
\set p117c_sales_membership 59911799-0000-4000-8000-000000000031
\set p117c_sales_two_membership 59911799-0000-4000-8000-000000000032
\set p117c_admin_membership 59911799-0000-4000-8000-000000000033
\set p117c_curator_membership 59911799-0000-4000-8000-000000000034
\set p117c_student_membership 59911799-0000-4000-8000-000000000035
\set p117c_admin_two_membership 59911799-0000-4000-8000-000000000036
\set p117c_lead 59911799-0000-4000-8000-000000000041
\set p117c_actor_lead 59911799-0000-4000-8000-000000000042
\set p117c_case 59911799-0000-4000-8000-000000000043
\set p117c_case_two 59911799-0000-4000-8000-000000000044
\set p117c_case_three 59911799-0000-4000-8000-000000000045

SELECT bundle.id AS p117c_sales_bundle, bundle.version AS p117c_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1
    FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'lead.sales.workflow.manage'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p117c_admin_bundle, bundle.version AS p117c_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin'
  AND bundle.status = 'published'
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.read.full'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'case.curator.assign'
  )
  AND EXISTS (
    SELECT 1 FROM platform.role_bundle_permissions AS permission
    WHERE permission.bundle_id = bundle.id
      AND permission.bundle_role = bundle.role
      AND permission.permission_key = 'scope.manage'
  )
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p117c_curator_bundle,
       bundle.version AS p117c_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

SELECT bundle.id AS p117c_student_bundle
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student'
  AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

INSERT INTO platform.organizations (id, name)
VALUES (:'p117c_org', 'Migration 117 concurrency organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p117c_org_scope', :'p117c_org', 'organization', :'p117c_org', 1),
  (:'p117c_case_scope', :'p117c_org', 'student_case', :'p117c_case', 1),
  (
    :'p117c_case_two_scope', :'p117c_org', 'student_case', :'p117c_case_two', 1
  ),
  (
    :'p117c_case_three_scope', :'p117c_org', 'student_case',
    :'p117c_case_three', 1
  );

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p117c_sales_user', 'p117c-sales@example.invalid', '{}'::JSONB),
  (:'p117c_sales_two_user', 'p117c-sales-two@example.invalid', '{}'::JSONB),
  (:'p117c_admin_user', 'p117c-admin@example.invalid', '{}'::JSONB),
  (:'p117c_curator_user', 'p117c-curator@example.invalid', '{}'::JSONB),
  (:'p117c_student_user', 'p117c-student@example.invalid', '{}'::JSONB),
  (:'p117c_admin_two_user', 'p117c-admin-two@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (
    :'p117c_sales_profile', :'p117c_sales_user',
    'Migration 117 concurrency Sales', 'active', 1
  ),
  (
    :'p117c_sales_two_profile', :'p117c_sales_two_user',
    'Migration 117 concurrency second Sales', 'active', 1
  ),
  (
    :'p117c_admin_profile', :'p117c_admin_user',
    'Migration 117 concurrency Admin', 'active', 1
  ),
  (
    :'p117c_curator_profile', :'p117c_curator_user',
    'Migration 117 concurrency Curator', 'active', 1
  ),
  (
    :'p117c_student_profile', :'p117c_student_user',
    'Migration 117 concurrency Student', 'active', 1
  ),
  (
    :'p117c_admin_two_profile', :'p117c_admin_two_user',
    'Migration 117 concurrency second Admin', 'active', 1
  );

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (
    :'p117c_sales_membership', :'p117c_org', :'p117c_sales_profile',
    'active', 'sales', :'p117c_sales_bundle'
  ),
  (
    :'p117c_sales_two_membership', :'p117c_org', :'p117c_sales_two_profile',
    'active', 'sales', :'p117c_sales_bundle'
  ),
  (
    :'p117c_admin_membership', :'p117c_org', :'p117c_admin_profile',
    'active', 'admin', :'p117c_admin_bundle'
  ),
  (
    :'p117c_curator_membership', :'p117c_org', :'p117c_curator_profile',
    'active', 'curator', :'p117c_curator_bundle'
  ),
  (
    :'p117c_student_membership', :'p117c_org', :'p117c_student_profile',
    'active', 'student', :'p117c_student_bundle'
  ),
  (
    :'p117c_admin_two_membership', :'p117c_org', :'p117c_admin_two_profile',
    'active', 'admin', :'p117c_admin_bundle'
  );

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  (
    '59911799-0000-4000-8000-000000000051', :'p117c_org',
    :'p117c_sales_membership', :'p117c_org_scope', 1, 1, TRUE, 'system', NULL,
    'Migration 117 concurrency first Sales scope',
    '59911799-0000-4000-8000-000000000061'
  ),
  (
    '59911799-0000-4000-8000-000000000052', :'p117c_org',
    :'p117c_sales_two_membership', :'p117c_org_scope', 1, 1, TRUE, 'system',
    NULL, 'Migration 117 concurrency second Sales scope',
    '59911799-0000-4000-8000-000000000062'
  ),
  (
    '59911799-0000-4000-8000-000000000053', :'p117c_org',
    :'p117c_admin_membership', :'p117c_org_scope', 1, 1, TRUE, 'system', NULL,
    'Migration 117 concurrency Admin scope',
    '59911799-0000-4000-8000-000000000063'
  ),
  (
    '59911799-0000-4000-8000-000000000054', :'p117c_org',
    :'p117c_sales_membership', :'p117c_case_scope', 1, 1, TRUE, 'system', NULL,
    'Migration 117 concurrency Sales case scope',
    '59911799-0000-4000-8000-000000000064'
  ),
  (
    '59911799-0000-4000-8000-000000000055', :'p117c_org',
    :'p117c_sales_membership', :'p117c_case_two_scope', 1, 1, TRUE, 'system',
    NULL, 'Migration 117 concurrency second Sales case scope',
    '59911799-0000-4000-8000-000000000065'
  ),
  (
    '59911799-0000-4000-8000-000000000056', :'p117c_org',
    :'p117c_sales_membership', :'p117c_case_three_scope', 1, 1, TRUE,
    'system', NULL, 'Migration 117 concurrency third Sales case scope',
    '59911799-0000-4000-8000-000000000066'
  ),
  (
    '59911799-0000-4000-8000-000000000057', :'p117c_org',
    :'p117c_admin_two_membership', :'p117c_org_scope', 1, 1, TRUE, 'system',
    NULL, 'Migration 117 concurrency second Admin scope',
    '59911799-0000-4000-8000-000000000067'
  );

INSERT INTO platform.leads (
  id, organization_id, current_owner_membership_id,
  stage_key, source_key, lifecycle_state
) VALUES
  (
    :'p117c_lead', :'p117c_org', :'p117c_sales_membership',
    'new', 'whatsapp', 'open'
  ),
  (
    :'p117c_actor_lead', :'p117c_org', NULL,
    'new', 'whatsapp', 'open'
  );

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES
  (
    :'p117c_case', :'p117c_org', :'p117c_student_membership',
    :'p117c_sales_membership', NULL,
    'synthetic:p117:concurrency-case', 'contract:p117:concurrency',
    '2026-09-07T09:00:00Z', 'Migration 117 concurrency Student',
    'United Kingdom', 'Bachelor', 'Business', '2031', 'approved',
    'contract_confirmed', 'pending', NULL, NULL, 'Assign the Curator',
    :'p117c_case_scope', 1
  ),
  (
    :'p117c_case_two', :'p117c_org', :'p117c_student_membership',
    :'p117c_sales_membership', NULL,
    'synthetic:p117:concurrency-case-two', 'contract:p117:concurrency-two',
    '2026-09-07T09:01:00Z', 'Migration 117 concurrency Student Two',
    'United Kingdom', 'Bachelor', 'Business', '2031', 'approved',
    'contract_confirmed', 'pending', NULL, NULL, 'Assign the Curator',
    :'p117c_case_two_scope', 1
  ),
  (
    :'p117c_case_three', :'p117c_org', :'p117c_student_membership',
    :'p117c_sales_membership', NULL,
    'synthetic:p117:concurrency-case-three', 'contract:p117:concurrency-three',
    '2026-09-07T09:02:00Z', 'Migration 117 concurrency Student Three',
    'United Kingdom', 'Bachelor', 'Business', '2031', 'approved',
    'contract_confirmed', 'pending', NULL, NULL, 'Assign the Curator',
    :'p117c_case_three_scope', 1
  );

COMMIT;

SELECT jsonb_build_object(
  'sub', :'p117c_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117c_org',
  'platform_membership_id', :'p117c_sales_membership',
  'platform_bundle_id', :'p117c_sales_bundle',
  'platform_bundle_version', :'p117c_sales_version'::INTEGER
)::TEXT AS p117c_sales_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117c_sales_profile'
\gset

SELECT jsonb_build_object(
  'sub', :'p117c_admin_user', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117c_org',
  'platform_membership_id', :'p117c_admin_membership',
  'platform_bundle_id', :'p117c_admin_bundle',
  'platform_bundle_version', :'p117c_admin_version'::INTEGER
)::TEXT AS p117c_admin_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117c_admin_profile'
\gset

SELECT jsonb_build_object(
  'sub', :'p117c_admin_two_user', 'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117c_org',
  'platform_membership_id', :'p117c_admin_two_membership',
  'platform_bundle_id', :'p117c_admin_bundle',
  'platform_bundle_version', :'p117c_admin_version'::INTEGER
)::TEXT AS p117c_admin_two_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117c_admin_two_profile'
\gset

-- The Supabase image deliberately keeps the migration actor non-superuser.
-- Enter its provider-owned extension-admin role only for opening these local,
-- test-only dblink sessions, then immediately return to the migration actor.
SET ROLE supabase_admin;
SELECT p117_test_extensions.dblink_connect(
  'p117c_authority',
  format(
    'hostaddr=127.0.0.1 port=%s dbname=%s user=postgres application_name=p117c-authority options=-csearch_path=',
    current_setting('port'),
    current_database()
  )
);
SELECT p117_test_extensions.dblink_connect(
  'p117c_note',
  format(
    'hostaddr=127.0.0.1 port=%s dbname=%s user=postgres application_name=p117c-note options=-csearch_path=',
    current_setting('port'),
    current_database()
  )
);
RESET ROLE;

-- Keep every remote wait finite so a regression fails the harness instead of
-- leaving the authorization runner blocked indefinitely.
SELECT p117_test_extensions.dblink_exec(
  'p117c_authority',
  'SET statement_timeout = ''15s''; SET lock_timeout = ''5s'''
);
SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  'SET statement_timeout = ''15s''; SET lock_timeout = ''10s'''
);

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      CREATE OR REPLACE FUNCTION pg_temp.p117c_capture_error(p_statement TEXT)
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $capture$
      BEGIN
        EXECUTE p_statement;
        RETURN jsonb_build_object('ok', TRUE);
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', FALSE,
            'sqlstate', SQLSTATE,
            'message', SQLERRM
          );
      END
      $capture$;
      GRANT EXECUTE ON FUNCTION pg_temp.p117c_capture_error(TEXT)
        TO authenticated;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_sales_claims'
  )
);

-- The BEFORE UPDATE hook runs only for this fixture and only inside the
-- marked workflow transaction. mutate_sales_lead_workflow already owns the
-- lead row when it reaches the hook, so PgSleep is an exact synchronization
-- point after the production function's FOR UPDATE.
CREATE FUNCTION p117_test_extensions.p117c_pause_workflow_after_lead_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.organization_id =
      '59911799-0000-4000-8000-000000000001'::UUID
    AND NEW.id = '59911799-0000-4000-8000-000000000041'::UUID
    AND OLD.stage_key = 'new'
    AND NEW.stage_key = 'contacting'
    AND pg_catalog.current_setting(
      'evo_test.p117_pause_workflow',
      TRUE
    ) = 'on'
  THEN
    PERFORM pg_catalog.pg_sleep(3);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER p117c_pause_workflow_after_lead_lock
  BEFORE UPDATE ON platform.leads
  FOR EACH ROW
  EXECUTE FUNCTION
    p117_test_extensions.p117c_pause_workflow_after_lead_lock();

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_exec(
    'p117c_authority',
    format(
      $remote$
        BEGIN;
        SET LOCAL evo_test.p117_pause_workflow = 'on';
        SET ROLE authenticated;
        SET LOCAL request.jwt.claims = %L;
      $remote$,
      :'p117c_admin_claims'
    )
  ) = 'SET',
  'Admin workflow transaction did not begin'
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_authority',
    $workflow$
      SELECT platform.mutate_sales_lead_workflow(
        '59911799-0000-4000-8000-000000000041'::UUID,
        1,
        '59911799-0000-4000-8000-000000000075'::UUID,
        'contacting',
        '59911799-0000-4000-8000-000000000032'::UUID,
        NULL,
        NULL,
        TRUE,
        'Migration 117 real workflow concurrency proof'
      )::TEXT AS outcome
    $workflow$
  ) = 1,
  'Admin workflow query was not dispatched'
);

DO $wait_for_workflow_lead_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.application_name = 'p117c-authority'
        AND activity.state = 'active'
        AND activity.wait_event = 'PgSleep'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 117 Sales workflow never held the fixture lead row';
END
$wait_for_workflow_lead_lock$;

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $note$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.create_case_note(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000041'::UUID,
            NULL,
            'A note concurrent with the real Sales workflow.',
            '59911799-0000-4000-8000-000000000071'::UUID
          )
        $command$
      )::TEXT AS outcome
    $note$
  ) = 1,
  'concurrent Sales note query was not dispatched'
);

DO $wait_for_note_on_workflow_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS note_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p117c-authority'
       AND authority_activity.pid = ANY (
         pg_catalog.pg_blocking_pids(note_activity.pid)
       )
      WHERE note_activity.application_name = 'p117c-note'
        AND note_activity.state = 'active'
        AND note_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 117 note worker did not wait on the Sales workflow';
END
$wait_for_note_on_workflow_lock$;

SELECT result.outcome AS p117c_workflow_outcome
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_workflow_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_exec(
    'p117c_authority',
    'COMMIT'
  ) = 'COMMIT',
  'Admin workflow transaction did not commit'
);

SELECT result.outcome AS p117c_note_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note') AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_note_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note') AS result(outcome TEXT)
\gset
SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_exec(
    'p117c_note',
    'COMMIT'
  ) = 'COMMIT',
  'concurrent Sales note transaction did not commit'
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_exec(
    'p117c_authority',
    'RESET ROLE'
  ) = 'RESET',
  'workflow worker role did not reset'
);
SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_exec(
    'p117c_note',
    'RESET ROLE'
  ) = 'RESET',
  'note worker role did not reset'
);

DROP TRIGGER p117c_pause_workflow_after_lead_lock ON platform.leads;
DROP FUNCTION p117_test_extensions.p117c_pause_workflow_after_lead_lock();

SELECT pg_temp.p117c_assert(
  :'p117c_workflow_result_drained'::INTEGER = 0
    AND :'p117c_note_result_drained'::INTEGER = 0
    AND :'p117c_workflow_outcome'::JSONB ->> 'request_id' =
      '59911799-0000-4000-8000-000000000075'
    AND :'p117c_workflow_outcome'::JSONB ->> 'organization_id' = :'p117c_org'
    AND :'p117c_workflow_outcome'::JSONB ->> 'lead_id' = :'p117c_lead'
    AND :'p117c_workflow_outcome'::JSONB ->> 'stage_key' = 'contacting'
    AND :'p117c_workflow_outcome'::JSONB ->> 'current_owner_membership_id' =
      :'p117c_sales_two_membership'
    AND (:'p117c_workflow_outcome'::JSONB ->> 'workflow_version')::BIGINT = 2
    AND :'p117c_note_outcome'::JSONB ->> 'ok' = 'false'
    AND :'p117c_note_outcome'::JSONB ->> 'sqlstate' = '42501',
  'real Admin workflow or stale-owner note result drifted'
);

SELECT pg_temp.p117c_assert(
  EXISTS (
    SELECT 1
    FROM platform.leads AS lead
    WHERE lead.organization_id = :'p117c_org'
      AND lead.id = :'p117c_lead'
      AND lead.current_owner_membership_id = :'p117c_sales_two_membership'
      AND lead.stage_key = 'contacting'
      AND lead.workflow_version = 2
  ),
  'real Admin workflow did not commit the reassigned lead state'
);

SELECT pg_temp.p117c_assert(
  EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id =
        '59911799-0000-4000-8000-000000000075'::UUID
      AND event.action = 'lead.sales.workflow.changed'
      AND event.resource_type = 'lead'
      AND event.resource_id = :'p117c_lead'
      AND event.actor_membership_id = :'p117c_admin_membership'
      AND event.resulting_version = 2
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.request_id =
        '59911799-0000-4000-8000-000000000071'::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.case_notes AS note
    WHERE note.organization_id = :'p117c_org'
      AND note.lead_id = :'p117c_lead'
  ),
  'real Admin workflow audit or stale-owner fail-closed evidence drifted'
);

SELECT pg_temp.p117c_assert(
  EXISTS (
    SELECT 1
    FROM platform_private.sales_lead_workflow_receipts AS receipt
    WHERE receipt.request_id =
      '59911799-0000-4000-8000-000000000075'::UUID
      AND receipt.organization_id = :'p117c_org'
      AND receipt.actor_membership_id = :'p117c_admin_membership'
      AND receipt.actor_profile_id = :'p117c_admin_profile'
      AND receipt.lead_id = :'p117c_lead'
      AND receipt.expected_workflow_version = 1
      AND receipt.desired_stage_key = 'contacting'
      AND receipt.desired_owner_membership_id = :'p117c_sales_two_membership'
      AND receipt.desired_next_action_text IS NULL
      AND receipt.desired_next_action_due_date IS NULL
      AND receipt.clear_next_action
      AND receipt.requested_reason =
        'Migration 117 real workflow concurrency proof'
      AND receipt.resulting_workflow_version = 2
      AND receipt.result = :'p117c_workflow_outcome'::JSONB
  ),
  'real Admin workflow receipt drifted'
);

-- Repeat the race against the actor authority itself. The lead is owned by
-- nobody, so the owner rule is deliberately irrelevant while a concurrent
-- profile suspension holds the actor's row lock. create_case_note must wait in
-- require_domain_actor, observe the committed suspension and fail without a
-- note or success audit.

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      CREATE OR REPLACE FUNCTION pg_temp.p117c_capture_error(p_statement TEXT)
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $capture$
      BEGIN
        EXECUTE p_statement;
        RETURN jsonb_build_object('ok', TRUE);
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', FALSE,
            'sqlstate', SQLSTATE,
            'message', SQLERRM
          );
      END
      $capture$;
      GRANT EXECUTE ON FUNCTION pg_temp.p117c_capture_error(TEXT)
        TO authenticated;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_sales_claims'
  )
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_authority',
    $authority$
      WITH changed AS (
        UPDATE platform.profiles
        SET status = 'blocked'
        WHERE id = '59911799-0000-4000-8000-000000000021'::UUID
        -- Evaluate the sleep in RETURNING so the row is already locked. A
        -- sleep in the outer SELECT can be scheduled before the data-changing
        -- CTE and would not establish a deterministic concurrency boundary.
        RETURNING status, pg_catalog.pg_sleep(5) AS held
      )
      SELECT changed.status::TEXT AS profile_status
      FROM changed
    $authority$
  ) = 1,
  'actor-suspension query was not dispatched'
);

DO $wait_for_actor_authority_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS activity
      WHERE activity.application_name = 'p117c-authority'
        AND activity.state = 'active'
        AND activity.wait_event = 'PgSleep'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 117 actor-suspension worker never held the profile row';
END
$wait_for_actor_authority_lock$;

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $note$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.create_case_note(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000042'::UUID,
            NULL,
            'A suspended actor must not write this note.',
            '59911799-0000-4000-8000-000000000072'::UUID
          )
        $command$
      )::TEXT AS outcome
    $note$
  ) = 1,
  'stale-actor note query was not dispatched'
);

SELECT result.profile_status AS p117c_committed_profile_status
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(profile_status TEXT)
\gset
SELECT count(*) AS p117c_actor_authority_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(profile_status TEXT)
\gset

SELECT result.outcome AS p117c_actor_note_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note') AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_actor_note_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note') AS result(outcome TEXT)
\gset

SELECT pg_temp.p117c_assert(
  :'p117c_committed_profile_status' = 'blocked'
    AND :'p117c_actor_authority_result_drained'::INTEGER = 0
    AND :'p117c_actor_note_result_drained'::INTEGER = 0
    AND :'p117c_actor_note_outcome'::JSONB ->> 'sqlstate' = '42501'
    AND NOT EXISTS (
      SELECT 1
      FROM platform.case_notes AS note
      WHERE note.organization_id = :'p117c_org'
        AND note.lead_id = :'p117c_actor_lead'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id =
        '59911799-0000-4000-8000-000000000072'::UUID
    ),
  'actor-authority race did not fail closed'
);

-- Prove case-note creation and Curator assignment cannot form an ABBA
-- deadlock. The assignment worker holds the shared organization-domain lock
-- before the Admin actor/profile/membership/organization rows, then the note
-- worker enters create_case_note. The note must wait on the domain boundary
-- without holding participant or case rows, so assignment can complete first.
SELECT p117_test_extensions.dblink_exec('p117c_note', 'ROLLBACK');

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      CREATE OR REPLACE FUNCTION pg_temp.p117c_capture_error(p_statement TEXT)
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $capture$
      BEGIN
        EXECUTE p_statement;
        RETURN jsonb_build_object('ok', TRUE);
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', FALSE,
            'sqlstate', SQLSTATE,
            'message', SQLERRM
          );
      END
      $capture$;
      GRANT EXECUTE ON FUNCTION pg_temp.p117c_capture_error(TEXT)
        TO authenticated;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_admin_claims'
  )
);

SELECT p117_test_extensions.dblink_exec(
  'p117c_authority',
  format(
    $remote$
      BEGIN;
      CREATE OR REPLACE FUNCTION pg_temp.p117c_capture_error(p_statement TEXT)
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $capture$
      BEGIN
        EXECUTE p_statement;
        RETURN jsonb_build_object('ok', TRUE);
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', FALSE,
            'sqlstate', SQLSTATE,
            'message', SQLERRM
          );
      END
      $capture$;
      DO $hold_domain$
      BEGIN
        PERFORM
          platform_private.lock_student_case_note_assignment_domain(
            '59911799-0000-4000-8000-000000000001'::UUID
          );
      END
      $hold_domain$;
      DO $hold_actor$
      BEGIN
        PERFORM membership.id
        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile
          ON profile.id = membership.profile_id
        JOIN platform.organizations AS organization
          ON organization.id = membership.organization_id
        WHERE membership.organization_id =
            '59911799-0000-4000-8000-000000000001'::UUID
          AND membership.id =
            '59911799-0000-4000-8000-000000000033'::UUID
        FOR UPDATE OF membership, profile, organization;
      END
      $hold_actor$;
      GRANT EXECUTE ON FUNCTION pg_temp.p117c_capture_error(TEXT)
        TO authenticated;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_admin_claims'
  )
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $note$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.create_case_note(
            '59911799-0000-4000-8000-000000000001'::UUID,
            NULL,
            '59911799-0000-4000-8000-000000000043'::UUID,
            'Admin note concurrent with Curator assignment.',
            '59911799-0000-4000-8000-000000000073'::UUID
          )
        $command$
      )::TEXT AS outcome
    $note$
  ) = 1,
  'case-note deadlock worker was not dispatched'
);

DO $wait_for_case_note_domain_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS note_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p117c-authority'
       AND authority_activity.pid = ANY (
         pg_catalog.pg_blocking_pids(note_activity.pid)
       )
      WHERE note_activity.application_name = 'p117c-note'
        AND note_activity.state = 'active'
        AND note_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 117 case-note worker did not wait on organization domain';
END
$wait_for_case_note_domain_lock$;

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_authority',
    $assignment$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.assign_student_case_curator(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000043'::UUID,
            '59911799-0000-4000-8000-000000000034'::UUID,
            'Assign Curator while an Admin records a note.',
            '59911799-0000-4000-8000-000000000074'::UUID
          )
        $command$
      )::TEXT AS outcome
    $assignment$
  ) = 1,
  'Curator-assignment deadlock worker was not dispatched'
);

SELECT result.outcome AS p117c_assignment_outcome
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_assignment_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'COMMIT');

SELECT result.outcome AS p117c_case_note_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_case_note_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_note', 'COMMIT');

SELECT pg_temp.p117c_assert(
  :'p117c_assignment_outcome'::JSONB ->> 'ok' = 'true'
    AND :'p117c_case_note_outcome'::JSONB ->> 'ok' = 'true'
    AND :'p117c_assignment_result_drained'::INTEGER = 0
    AND :'p117c_case_note_result_drained'::INTEGER = 0
    AND EXISTS (
      SELECT 1
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = :'p117c_org'
        AND student_case.id = :'p117c_case'
        AND student_case.current_curator_membership_id =
          :'p117c_curator_membership'
        AND student_case.state = 'active'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.case_notes AS note
      WHERE note.organization_id = :'p117c_org'
        AND note.student_case_id = :'p117c_case'
        AND note.body = 'Admin note concurrent with Curator assignment.'
    ),
  'case-note creation and Curator assignment deadlocked or lost a write'
);

-- The current Curator is the missing actor permutation from the generic
-- Admin-note race above. Hold the assignment side's organization-domain lock
-- and actor rows, start a real Curator note, then execute a same-current no-op
-- assignment. The note must wait before owning Curator rows; the
-- assignment must reject normally instead of PostgreSQL choosing a deadlock
-- victim, and the still-current Curator must then be allowed to record a note.
SELECT jsonb_build_object(
  'sub', :'p117c_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p117c_org',
  'platform_membership_id', :'p117c_curator_membership',
  'platform_bundle_id', :'p117c_curator_bundle',
  'platform_bundle_version', :'p117c_curator_version'::INTEGER
)::TEXT AS p117c_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p117c_curator_profile'
\gset

SELECT p117_test_extensions.dblink_exec('p117c_note', 'RESET ROLE');
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'RESET ROLE');

SELECT p117_test_extensions.dblink_exec(
  'p117c_authority',
  format(
    $remote$
      BEGIN;
      SET LOCAL request.jwt.claims = %L;
      DO $hold_domain$
      BEGIN
        PERFORM
          platform_private.lock_student_case_note_assignment_domain(
            '59911799-0000-4000-8000-000000000001'::UUID
          );
      END
      $hold_domain$;
      DO $hold_actor$
      BEGIN
        PERFORM membership.id
        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile
          ON profile.id = membership.profile_id
        JOIN platform.organizations AS organization
          ON organization.id = membership.organization_id
        WHERE membership.organization_id =
            '59911799-0000-4000-8000-000000000001'::UUID
          AND membership.id =
            '59911799-0000-4000-8000-000000000033'::UUID
        FOR UPDATE OF membership, profile, organization;
      END
      $hold_actor$;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_admin_claims',
    :'p117c_admin_claims'
  )
);

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_curator_claims'
  )
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $note$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.create_case_note(
            '59911799-0000-4000-8000-000000000001'::UUID,
            NULL,
            '59911799-0000-4000-8000-000000000043'::UUID,
            'Curator note concurrent with same-current reassignment.',
            '59911799-0000-4000-8000-000000000076'::UUID
          )
        $command$
      )::TEXT AS outcome
    $note$
  ) = 1,
  'same-current Curator note worker was not dispatched'
);

DO $wait_for_same_current_domain_lock$
DECLARE
  attempt INTEGER;
  worker_state JSONB;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS note_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p117c-authority'
       AND authority_activity.pid = ANY (
         pg_catalog.pg_blocking_pids(note_activity.pid)
       )
      WHERE note_activity.application_name = 'p117c-note'
        AND note_activity.state = 'active'
        AND note_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'application_name', activity.application_name,
      'state', activity.state,
      'wait_event_type', activity.wait_event_type,
      'wait_event', activity.wait_event,
      'blocking_pids', pg_catalog.pg_blocking_pids(activity.pid),
      'query', pg_catalog.left(activity.query, 160)
    )
    ORDER BY activity.application_name
  )
  INTO worker_state
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.application_name IN ('p117c-note', 'p117c-authority');
  RAISE EXCEPTION
    'Migration 117 current-Curator note did not wait on organization domain: %',
    worker_state;
END
$wait_for_same_current_domain_lock$;

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_authority',
    $assignment$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.assign_student_case_curator(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000043'::UUID,
            '59911799-0000-4000-8000-000000000034'::UUID,
            'Reject a concurrent same-current Curator assignment.',
            '59911799-0000-4000-8000-000000000077'::UUID
          )
        $command$
      )::TEXT AS outcome
    $assignment$
  ) = 1,
  'same-current Curator assignment worker was not dispatched'
);

SELECT result.outcome AS p117c_same_current_assignment_outcome
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_same_current_assignment_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'COMMIT');

SELECT result.outcome AS p117c_same_current_note_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_same_current_note_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_note', 'COMMIT');

SELECT pg_temp.p117c_assert(
  :'p117c_same_current_assignment_outcome'::JSONB ->> 'ok' = 'false'
    AND :'p117c_same_current_assignment_outcome'::JSONB ->> 'sqlstate' = '22023'
    AND :'p117c_same_current_note_outcome'::JSONB ->> 'ok' = 'true'
    AND :'p117c_same_current_assignment_result_drained'::INTEGER = 0
    AND :'p117c_same_current_note_result_drained'::INTEGER = 0
    AND EXISTS (
      SELECT 1
      FROM platform.case_notes AS note
      WHERE note.organization_id = :'p117c_org'
        AND note.student_case_id = :'p117c_case'
        AND note.body =
          'Curator note concurrent with same-current reassignment.'
    ),
  'current-Curator note and same-current reassignment deadlocked or drifted'
);

-- The same organization-domain order must hold when the assignment targets a
-- Curator who is writing on a different case. The assignment wins this
-- schedule and bumps that Curator's access version; after waiting, the stale
-- note must fail closed with 42501 (never 40P01) and leave no note or audit
-- artifact.
SELECT p117_test_extensions.dblink_exec('p117c_note', 'RESET ROLE');
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'RESET ROLE');

SELECT p117_test_extensions.dblink_exec(
  'p117c_authority',
  format(
    $remote$
      BEGIN;
      SET LOCAL request.jwt.claims = %L;
      DO $hold_domain$
      BEGIN
        PERFORM
          platform_private.lock_student_case_note_assignment_domain(
            '59911799-0000-4000-8000-000000000001'::UUID
          );
      END
      $hold_domain$;
      DO $hold_actor$
      BEGIN
        PERFORM membership.id
        FROM platform.organization_memberships AS membership
        JOIN platform.profiles AS profile
          ON profile.id = membership.profile_id
        JOIN platform.organizations AS organization
          ON organization.id = membership.organization_id
        WHERE membership.organization_id =
            '59911799-0000-4000-8000-000000000001'::UUID
          AND membership.id =
            '59911799-0000-4000-8000-000000000033'::UUID
        FOR UPDATE OF membership, profile, organization;
      END
      $hold_actor$;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_admin_claims',
    :'p117c_admin_claims'
  )
);

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_curator_claims'
  )
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $note$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.create_case_note(
            '59911799-0000-4000-8000-000000000001'::UUID,
            NULL,
            '59911799-0000-4000-8000-000000000043'::UUID,
            'Curator note concurrent with a cross-case assignment.',
            '59911799-0000-4000-8000-000000000078'::UUID
          )
        $command$
      )::TEXT AS outcome
    $note$
  ) = 1,
  'cross-case Curator note worker was not dispatched'
);

DO $wait_for_cross_case_domain_lock$
DECLARE
  attempt INTEGER;
  note_outcome TEXT;
  worker_state JSONB;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS note_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p117c-authority'
       AND authority_activity.pid = ANY (
         pg_catalog.pg_blocking_pids(note_activity.pid)
       )
      WHERE note_activity.application_name = 'p117c-note'
        AND note_activity.state = 'active'
        AND note_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'application_name', activity.application_name,
      'state', activity.state,
      'wait_event_type', activity.wait_event_type,
      'wait_event', activity.wait_event,
      'blocking_pids', pg_catalog.pg_blocking_pids(activity.pid),
      'query', pg_catalog.left(activity.query, 160)
    )
    ORDER BY activity.application_name
  )
  INTO worker_state
  FROM pg_catalog.pg_stat_activity AS activity
  WHERE activity.application_name IN ('p117c-note', 'p117c-authority');

  IF p117_test_extensions.dblink_is_busy('p117c_note') = 0 THEN
    SELECT result.outcome
    INTO note_outcome
    FROM p117_test_extensions.dblink_get_result('p117c_note')
      AS result(outcome TEXT);
  END IF;

  RAISE EXCEPTION
    'Migration 117 cross-case note did not wait on organization domain; state: %, outcome: %',
    worker_state,
    note_outcome;
END
$wait_for_cross_case_domain_lock$;

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_authority',
    $assignment$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.assign_student_case_curator(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000044'::UUID,
            '59911799-0000-4000-8000-000000000034'::UUID,
            'Assign the Curator while they write on another case.',
            '59911799-0000-4000-8000-000000000079'::UUID
          )
        $command$
      )::TEXT AS outcome
    $assignment$
  ) = 1,
  'cross-case Curator assignment worker was not dispatched'
);

SELECT result.outcome AS p117c_cross_case_assignment_outcome
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_cross_case_assignment_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_authority')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'COMMIT');

SELECT result.outcome AS p117c_cross_case_note_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_cross_case_note_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_note', 'COMMIT');

SELECT pg_temp.p117c_assert(
  :'p117c_cross_case_assignment_outcome'::JSONB ->> 'ok' = 'true'
    AND :'p117c_cross_case_note_outcome'::JSONB ->> 'ok' = 'false'
    AND :'p117c_cross_case_note_outcome'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117c_cross_case_assignment_result_drained'::INTEGER = 0
    AND :'p117c_cross_case_note_result_drained'::INTEGER = 0
    AND EXISTS (
      SELECT 1
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = :'p117c_org'
        AND student_case.id = :'p117c_case_two'
        AND student_case.current_curator_membership_id =
          :'p117c_curator_membership'
        AND student_case.state = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.case_notes AS note
      WHERE note.organization_id = :'p117c_org'
        AND note.student_case_id = :'p117c_case'
        AND note.body =
          'Curator note concurrent with a cross-case assignment.'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.request_id =
        '59911799-0000-4000-8000-000000000078'::UUID
    ),
  'cross-case target-Curator note race did not serialize and fail closed'
);

-- A real organization-scope revocation locks the assigning Admin membership,
-- records the revocation and bumps that profile's access_version. Dispatch an
-- assignment with the now-stale JWT while the revocation transaction still
-- owns those rows. The assignment must visibly wait, then repeat its complete
-- Admin authority check after the lock and fail before touching the pending
-- case. This is the exact preflight-to-row-lock race that the legacy body did
-- not close on its own.
SELECT p117_test_extensions.dblink_exec('p117c_note', 'RESET ROLE');
SELECT p117_test_extensions.dblink_exec('p117c_authority', 'RESET ROLE');

SELECT p117_test_extensions.dblink_exec(
  'p117c_authority',
  format(
    $remote$
      BEGIN;
      SET LOCAL request.jwt.claims = %L;
      SET ROLE authenticated;
      DO $revoke$
      BEGIN
        PERFORM platform.revoke_organization_scope(
          '59911799-0000-4000-8000-000000000001'::UUID,
          '59911799-0000-4000-8000-000000000036'::UUID,
          'Migration 117 concurrent Admin authority revocation',
          '59911799-0000-4000-8000-000000000080'::UUID
        );
      END
      $revoke$;
    $remote$,
    :'p117c_admin_claims'
  )
);

SELECT pg_temp.p117c_assert(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_stat_activity AS activity
    WHERE activity.application_name = 'p117c-authority'
      AND activity.state = 'idle in transaction'
  ),
  'Admin scope revocation did not retain its actor authority locks'
);

SELECT p117_test_extensions.dblink_exec(
  'p117c_note',
  format(
    $remote$
      BEGIN;
      SET ROLE authenticated;
      SET LOCAL request.jwt.claims = %L;
    $remote$,
    :'p117c_admin_two_claims'
  )
);

SELECT pg_temp.p117c_assert(
  p117_test_extensions.dblink_send_query(
    'p117c_note',
    $assignment$
      SELECT pg_temp.p117c_capture_error(
        $command$
          SELECT platform.assign_student_case_curator(
            '59911799-0000-4000-8000-000000000001'::UUID,
            '59911799-0000-4000-8000-000000000045'::UUID,
            '59911799-0000-4000-8000-000000000034'::UUID,
            'Stale Admin authority must not assign this case',
            '59911799-0000-4000-8000-000000000081'::UUID
          )
        $command$
      )::TEXT AS outcome
    $assignment$
  ) = 1,
  'stale-Admin assignment worker was not dispatched'
);

DO $wait_for_stale_admin_authority_lock$
DECLARE
  attempt INTEGER;
BEGIN
  FOR attempt IN 1..80 LOOP
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_stat_activity AS assignment_activity
      JOIN pg_catalog.pg_stat_activity AS authority_activity
        ON authority_activity.application_name = 'p117c-authority'
       AND authority_activity.pid = ANY (
         pg_catalog.pg_blocking_pids(assignment_activity.pid)
       )
      WHERE assignment_activity.application_name = 'p117c-note'
        AND assignment_activity.state = 'active'
        AND assignment_activity.wait_event_type = 'Lock'
    ) THEN
      RETURN;
    END IF;
    PERFORM pg_catalog.pg_sleep(0.05);
  END LOOP;
  RAISE EXCEPTION
    'Migration 117 assignment did not wait for Admin scope revocation';
END
$wait_for_stale_admin_authority_lock$;

SELECT p117_test_extensions.dblink_exec('p117c_authority', 'COMMIT');

SELECT result.outcome AS p117c_stale_admin_assignment_outcome
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT count(*) AS p117c_stale_admin_assignment_result_drained
FROM p117_test_extensions.dblink_get_result('p117c_note')
  AS result(outcome TEXT)
\gset
SELECT p117_test_extensions.dblink_exec('p117c_note', 'COMMIT');

SELECT pg_temp.p117c_assert(
  :'p117c_stale_admin_assignment_outcome'::JSONB ->> 'ok' = 'false'
    AND :'p117c_stale_admin_assignment_outcome'::JSONB ->> 'sqlstate' = '42501'
    AND :'p117c_stale_admin_assignment_result_drained'::INTEGER = 0
    AND EXISTS (
      SELECT 1
      FROM platform.profiles AS profile
      WHERE profile.id = :'p117c_admin_two_profile'
        AND profile.access_version = 2
    )
    AND (
      SELECT assignment.granted
      FROM platform.membership_scope_assignments AS assignment
      WHERE assignment.organization_id = :'p117c_org'
        AND assignment.membership_id = :'p117c_admin_two_membership'
        AND assignment.scope_id = :'p117c_org_scope'
      ORDER BY assignment.assignment_version DESC
      LIMIT 1
    ) IS FALSE
    AND EXISTS (
      SELECT 1
      FROM platform.student_cases AS student_case
      WHERE student_case.organization_id = :'p117c_org'
        AND student_case.id = :'p117c_case_three'
        AND student_case.current_curator_membership_id IS NULL
        AND student_case.state = 'pending'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.student_case_assignment_events AS event
      WHERE event.organization_id = :'p117c_org'
        AND event.request_id =
          '59911799-0000-4000-8000-000000000081'::UUID
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform.audit_events AS event
      WHERE event.organization_id = :'p117c_org'
        AND event.request_id =
          '59911799-0000-4000-8000-000000000081'::UUID
    ),
  'stale Admin authority assignment did not wait and fail closed'
);

SELECT p117_test_extensions.dblink_disconnect('p117c_note');
SELECT p117_test_extensions.dblink_disconnect('p117c_authority');

-- Remove the committed test fixture before the remaining migrations/tests.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM platform.case_notes WHERE organization_id = :'p117c_org';
DELETE FROM platform_private.sales_lead_workflow_receipts
WHERE organization_id = :'p117c_org';
DELETE FROM platform.audit_events WHERE organization_id = :'p117c_org';
DELETE FROM platform.student_case_assignment_events
WHERE organization_id = :'p117c_org';
DELETE FROM platform.student_case_lifecycle_events
WHERE organization_id = :'p117c_org';
DELETE FROM platform.student_cases WHERE organization_id = :'p117c_org';
DELETE FROM platform.leads WHERE organization_id = :'p117c_org';
DELETE FROM platform.membership_scope_assignments
WHERE organization_id = :'p117c_org';
DELETE FROM platform.organization_memberships
WHERE organization_id = :'p117c_org';
DELETE FROM platform.profiles
WHERE id IN (
  :'p117c_sales_profile', :'p117c_sales_two_profile', :'p117c_admin_profile',
  :'p117c_curator_profile', :'p117c_student_profile',
  :'p117c_admin_two_profile'
);
DELETE FROM auth.users
WHERE id IN (
  :'p117c_sales_user', :'p117c_sales_two_user', :'p117c_admin_user',
  :'p117c_curator_user', :'p117c_student_user', :'p117c_admin_two_user'
);
DELETE FROM platform.record_scopes WHERE organization_id = :'p117c_org';
DELETE FROM platform.organizations WHERE id = :'p117c_org';
COMMIT;

DROP EXTENSION dblink;
DROP SCHEMA p117_test_extensions;

SELECT 'platform migration 117 case notes and authority race verified' AS result;
