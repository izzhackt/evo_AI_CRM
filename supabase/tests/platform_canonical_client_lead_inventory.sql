\set ON_ERROR_STOP on

-- U2 catalog, authority-version and ACL contract. The suite is transactional
-- and leaves the disposable sequential database unchanged.
BEGIN;

DO $inventory$
DECLARE
  table_name TEXT;
  routine_signature TEXT;
  routine_oid OID;
  routine_row pg_proc%ROWTYPE;
  forbidden_role TEXT;
  missing_permission TEXT;
  unexpected_permission TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'clients',
    'leads',
    'external_identifiers',
    'subject_provenance'
  ] LOOP
    IF to_regclass('platform.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'U2 exposed table is missing: platform.%', table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform'
        AND relation.relname = table_name
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'U2 exposed table lacks forced RLS: %', table_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_any_column_privilege(
        forbidden_role,
        ('platform.' || table_name)::REGCLASS,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) OR has_table_privilege(
        forbidden_role,
        ('platform.' || table_name)::REGCLASS,
        'DELETE'
      ) THEN
        RAISE EXCEPTION '% unexpectedly has U2 table access on %',
          forbidden_role,
          table_name;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'client_duplicate_candidates',
    'client_duplicate_resolutions',
    'client_aliases'
  ] LOOP
    IF to_regclass('platform_private.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'U2 private table is missing: %', table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'platform_private'
        AND relation.relname = table_name
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'U2 private table lacks forced RLS: %', table_name;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_any_column_privilege(
        forbidden_role,
        ('platform_private.' || table_name)::REGCLASS,
        'SELECT,INSERT,UPDATE,REFERENCES'
      ) OR has_table_privilege(
        forbidden_role,
        ('platform_private.' || table_name)::REGCLASS,
        'DELETE'
      ) THEN
        RAISE EXCEPTION '% unexpectedly has U2 private table access on %',
          forbidden_role,
          table_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT has_column_privilege(
      'authenticated', 'platform.clients', 'display_name', 'SELECT'
    )
    OR NOT has_column_privilege(
      'authenticated', 'platform.clients', 'email', 'SELECT'
    )
    OR has_column_privilege(
      'authenticated', 'platform.clients', 'normalized_email', 'SELECT'
    )
    OR NOT has_column_privilege(
      'authenticated', 'platform.leads', 'stage_key', 'SELECT'
    )
    OR has_table_privilege(
      'authenticated', 'platform.clients', 'INSERT,UPDATE,DELETE'
    )
    OR has_table_privilege(
      'authenticated', 'platform.leads', 'INSERT,UPDATE,DELETE'
    )
    OR NOT has_table_privilege(
      'authenticated', 'platform.external_identifiers', 'SELECT'
    )
    OR NOT has_table_privilege(
      'authenticated', 'platform.subject_provenance', 'SELECT'
    )
  THEN
    RAISE EXCEPTION 'U2 authenticated table/column grants drifted';
  END IF;

  IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'platform.external_identifiers'::REGCLASS
        AND conname = 'external_identifiers_provider_key'
        AND contype = 'u'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'platform.external_identifiers'::REGCLASS
        AND conname = 'external_identifiers_one_subject_check'
        AND contype = 'c'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'platform.subject_provenance'::REGCLASS
        AND conname = 'subject_provenance_one_subject_check'
        AND contype = 'c'
    )
    OR to_regclass('platform.clients_active_strong_identity_key') IS NULL
    OR to_regclass('platform.clients_updated_page_idx') IS NULL
    OR to_regclass('platform.leads_updated_page_idx') IS NULL
    OR to_regclass('platform.student_cases_canonical_client_idx') IS NULL
    OR to_regclass(
      'platform.communication_conversations_canonical_lead_idx'
    ) IS NULL
  THEN
    RAISE EXCEPTION 'U2 integrity or keyset index contract is incomplete';
  END IF;

  IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'platform.student_cases'::REGCLASS
        AND conname = 'student_cases_canonical_client_fkey'
        AND contype = 'f'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'platform.student_cases'::REGCLASS
        AND conname = 'student_cases_canonical_lead_fkey'
        AND contype = 'f'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid =
        'platform.communication_conversations'::REGCLASS
        AND conname =
          'communication_conversations_canonical_client_fkey'
        AND contype = 'f'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid =
        'platform.communication_conversations'::REGCLASS
        AND conname =
          'communication_conversations_canonical_lead_fkey'
        AND contype = 'f'
    )
  THEN
    RAISE EXCEPTION 'U2 same-organization module bindings are incomplete';
  END IF;

  FOR routine_signature IN
    SELECT unnest(ARRAY[
      'platform.staff_canonical_lead_page(integer,timestamp with time zone,uuid,text,platform.lead_lifecycle_state,text)',
      'platform.staff_canonical_lead_detail(uuid)',
      'platform.staff_canonical_client_page(integer,timestamp with time zone,uuid,platform.client_lifecycle_state,text)',
      'platform.staff_canonical_client_detail(uuid)'
    ])
  LOOP
    routine_oid := to_regprocedure(routine_signature)::OID;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'U2 read RPC is missing: %', routine_signature;
    END IF;

    SELECT routine.* INTO STRICT routine_row
    FROM pg_proc AS routine
    WHERE routine.oid = routine_oid;

    IF NOT routine_row.prosecdef
      OR routine_row.provolatile <> 's'
      OR NOT routine_row.proretset
      OR NOT (
        routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
      )
      OR NOT has_function_privilege(
        'authenticated', routine_oid, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'U2 read RPC hardening drifted: %',
        routine_signature;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes U2 read RPC %',
          forbidden_role,
          routine_signature;
      END IF;
    END LOOP;
  END LOOP;

  routine_oid := to_regprocedure(
    'platform.resolve_client_duplicate(uuid,uuid,uuid,text,uuid)'
  )::OID;
  SELECT routine.* INTO STRICT routine_row
  FROM pg_proc AS routine WHERE routine.oid = routine_oid;
  IF routine_oid IS NULL
    OR NOT routine_row.prosecdef
    OR routine_row.provolatile <> 'v'
    OR NOT (
      routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
    )
    OR NOT has_function_privilege(
      'authenticated', routine_oid, 'EXECUTE'
    )
    OR has_function_privilege('anon', routine_oid, 'EXECUTE')
    OR has_function_privilege('service_role', routine_oid, 'EXECUTE')
    OR has_function_privilege(
      'supabase_auth_admin', routine_oid, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'U2 Admin resolution RPC ACL/hardening drifted';
  END IF;

  FOR routine_signature IN
    SELECT unnest(ARRAY[
      'platform_private.create_or_link_client(uuid,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)',
      'platform_private.create_or_link_lead(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)',
      'platform_private.lock_external_identity(uuid,text,text,text)',
      'platform_private.create_ambiguous_candidates(uuid,uuid)',
      'platform_private.resolve_canonical_client_id(uuid,uuid)',
      'platform_private.visible_canonical_leads()',
      'platform_private.visible_canonical_clients()'
    ])
  LOOP
    routine_oid := to_regprocedure(routine_signature)::OID;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION 'U2 private helper is missing: %', routine_signature;
    END IF;

    FOREACH forbidden_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly executes U2 private helper %',
          forbidden_role,
          routine_signature;
      END IF;
    END LOOP;
  END LOOP;

  IF (
    SELECT count(*)
    FROM platform.role_bundle_versions AS bundle
    WHERE bundle.version = 12
      AND bundle.status = 'published'
  ) <> 5 THEN
    RAISE EXCEPTION 'U2 must publish exactly five v12 role bundles';
  END IF;

  SELECT permission.permission_key
  INTO missing_permission
  FROM (
    SELECT v11.role, v11_permission.permission_key
    FROM platform.role_bundle_versions AS v11
    JOIN platform.role_bundle_permissions AS v11_permission
      ON v11_permission.bundle_id = v11.id
    WHERE v11.version = 11
    EXCEPT
    SELECT v12.role, v12_permission.permission_key
    FROM platform.role_bundle_versions AS v12
    JOIN platform.role_bundle_permissions AS v12_permission
      ON v12_permission.bundle_id = v12.id
    WHERE v12.version = 12
  ) AS permission
  LIMIT 1;

  IF missing_permission IS NOT NULL THEN
    RAISE EXCEPTION 'v12 failed to copy v11 permission %',
      missing_permission;
  END IF;

  SELECT permission.permission_key
  INTO unexpected_permission
  FROM (
    SELECT v12.role, v12_permission.permission_key
    FROM platform.role_bundle_versions AS v12
    JOIN platform.role_bundle_permissions AS v12_permission
      ON v12_permission.bundle_id = v12.id
    WHERE v12.version = 12
    EXCEPT
    (
      SELECT v11.role, v11_permission.permission_key
      FROM platform.role_bundle_versions AS v11
      JOIN platform.role_bundle_permissions AS v11_permission
        ON v11_permission.bundle_id = v11.id
      WHERE v11.version = 11
      UNION ALL
      SELECT role_name::platform.business_role, permission_key
      FROM (VALUES
        ('admin', 'client.read'),
        ('admin', 'lead.read'),
        ('admin', 'client.duplicate.resolve'),
        ('sales', 'client.read'),
        ('sales', 'lead.read'),
        ('curator', 'client.read'),
        ('curator', 'lead.read')
      ) AS additions(role_name, permission_key)
    )
  ) AS permission
  LIMIT 1;

  IF unexpected_permission IS NOT NULL THEN
    RAISE EXCEPTION 'v12 has unexpected permission %',
      unexpected_permission;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
    WHERE bundle.version = 11
  ) THEN
    RAISE EXCEPTION 'A current membership was not rebound from v11 to v12';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS event
    WHERE event.reason = 'U2 immutable RBAC bundle upgrade'
      AND (
        (event.after_state ->> 'access_version')::BIGINT
          <> (event.before_state ->> 'access_version')::BIGINT + 1
        OR event.after_state ->> 'bundle_id' IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'U2 bundle audit did not record access_version +1';
  END IF;
END
$inventory$;

DO $invalid_inputs$
BEGIN
  BEGIN
    PERFORM * FROM platform.staff_canonical_lead_page(102);
    RAISE EXCEPTION 'Lead page accepted oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.staff_canonical_client_page(0);
    RAISE EXCEPTION 'Client page accepted zero limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.staff_canonical_lead_page(
      10,
      statement_timestamp(),
      NULL
    );
    RAISE EXCEPTION 'Lead page accepted incomplete cursor';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM * FROM platform.staff_canonical_client_page(
      10,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'Client page accepted incomplete cursor';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END
$invalid_inputs$;

ROLLBACK;

SELECT 'platform migration 084 canonical inventory passed' AS result;
