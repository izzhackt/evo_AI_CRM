\set ON_ERROR_STOP on

-- BW8B catalog, ACL and function-shape proof at migration 060. Stateful queue
-- and resolver behavior belongs to platform_document_intake_runtime_rls.sql.
DO $$
DECLARE
  checked_routine REGPROCEDURE;
  checked_role TEXT;
  definition TEXT;
  operation_values TEXT[];
  service_routines REGPROCEDURE[] := ARRAY[
    'platform.claim_durable_work(integer,text,uuid)'::REGPROCEDURE,
    'platform.claim_document_validation_work(integer,text,uuid)'::REGPROCEDURE,
    'platform.resolve_document_validation_input(uuid,uuid,uuid)'::REGPROCEDURE
  ];
  private_routines REGPROCEDURE[] := ARRAY[
    'platform_private.claim_durable_work_shared(integer,text,uuid,platform.durable_work_kind)'::REGPROCEDURE
  ];
BEGIN
  SELECT array_agg(enumlabel::TEXT ORDER BY enumsortorder)
  INTO operation_values
  FROM pg_enum
  WHERE enumtypid = 'platform.durable_work_operation'::REGTYPE;

  IF NOT ('resolve_document_validation_input' = ANY(operation_values)) THEN
    RAISE EXCEPTION
      'BW8B resolver operation is absent from durable replay inventory';
  END IF;

  FOREACH checked_routine IN ARRAY service_routines LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS routine
      WHERE routine.oid = checked_routine
        AND routine.proowner = 'postgres'::REGROLE
        AND routine.prosecdef
        AND routine.provolatile = 'v'
        AND routine.proconfig = ARRAY['search_path=""']
    ) THEN
      RAISE EXCEPTION
        'BW8B public routine % lost owner/security/search-path shape',
        checked_routine;
    END IF;

    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(checked_role, checked_routine, 'EXECUTE') THEN
        RAISE EXCEPTION
          'BW8B public routine % leaks EXECUTE to %',
          checked_routine,
          checked_role;
      END IF;
    END LOOP;

    IF NOT has_function_privilege('service_role', checked_routine, 'EXECUTE')
    THEN
      RAISE EXCEPTION
        'BW8B public routine % is unavailable to service_role',
        checked_routine;
    END IF;
  END LOOP;

  FOREACH checked_routine IN ARRAY private_routines LOOP
    FOREACH checked_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role',
      'supabase_auth_admin'
    ] LOOP
      IF has_function_privilege(checked_role, checked_routine, 'EXECUTE') THEN
        RAISE EXCEPTION
          'BW8B private routine % leaks EXECUTE to %',
          checked_routine,
          checked_role;
      END IF;
    END LOOP;
  END LOOP;

  definition := pg_get_functiondef(
    'platform_private.claim_durable_work_shared(integer,text,uuid,platform.durable_work_kind)'::REGPROCEDURE
  );
  IF definition NOT LIKE '%pgmq.read(%'
    OR definition NOT LIKE
      '%jsonb_build_object(''kind'', p_kind_filter::TEXT)%'
    OR definition NOT LIKE '%WHEN p_kind_filter IS NULL THEN ''{}''::JSONB%'
    OR definition NOT LIKE
      '%''document_version_id'', work_item.source_document_version_id%'
    OR definition NOT LIKE
      '%''document_extraction_run_id'', work_item.source_extraction_run_id%'
    OR definition NOT LIKE
      '%''student_profile_export_id'', work_item.source_profile_export_id%'
    OR definition LIKE '%work_item.document_version_id%'
    OR definition LIKE '%work_item.document_extraction_run_id%'
    OR definition LIKE '%work_item.student_profile_export_id%'
  THEN
    RAISE EXCEPTION
      'BW8B shared claim filter or public source-pointer aliases drifted';
  END IF;

  definition := pg_get_functiondef(
    'platform.claim_durable_work(integer,text,uuid)'::REGPROCEDURE
  );
  IF definition NOT LIKE
      '%platform_private.claim_durable_work_shared(%'
    OR definition NOT LIKE '%p_request_id,%NULL%'
  THEN
    RAISE EXCEPTION 'BW8B generic claim no longer delegates with NULL filter';
  END IF;

  definition := pg_get_functiondef(
    'platform.claim_document_validation_work(integer,text,uuid)'::REGPROCEDURE
  );
  IF definition NOT LIKE
      '%platform_private.claim_durable_work_shared(%'
    OR definition NOT LIKE '%''document_validation''%'
  THEN
    RAISE EXCEPTION
      'BW8B validation claim no longer delegates with its exact kind';
  END IF;

  definition := pg_get_functiondef(
    'platform.resolve_document_validation_input(uuid,uuid,uuid)'::REGPROCEDURE
  );
  IF definition NOT LIKE '%document_upload_finalizations%'
    OR definition NOT LIKE '%document_storage_bindings%'
    OR definition NOT LIKE '%document_upload_reservations%'
    OR definition NOT LIKE '%slot_row.current_version_id%'
    OR definition NOT LIKE '%slot_row.current_version_no%'
    OR definition NOT LIKE '%FOR SHARE%'
    OR definition NOT LIKE '%platform_private.p2g_replay_request%'
    OR definition NOT LIKE '%expected_original_filename%'
    OR definition NOT LIKE '%expected_mime_type%'
    OR definition NOT LIKE '%expected_byte_size%'
    OR definition NOT LIKE '%expected_sha256_hex%'
    OR definition ~* 'storage\.objects|signed[_ ]?url|service[_ ]?key|raw[_ ]?bytes'
  THEN
    RAISE EXCEPTION
      'BW8B validation resolver boundary or replay/lock contract drifted';
  END IF;

  FOREACH checked_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'supabase_auth_admin'
  ] LOOP
    IF has_table_privilege(
      checked_role,
      'platform_private.document_storage_bindings',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    ) OR has_table_privilege(
      checked_role,
      'platform_private.document_upload_finalizations',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    ) OR has_table_privilege(
      checked_role,
      'platform_private.durable_work_idempotency',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
    ) THEN
      RAISE EXCEPTION
        'BW8B private validation/runtime ledger leaks table privileges to %',
        checked_role;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'platform_private'
      AND relation.relname IN (
        'document_storage_bindings',
        'document_upload_finalizations',
        'durable_work_idempotency'
      )
      AND relation.relkind = 'r'
      AND NOT (relation.relrowsecurity AND relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'BW8B private ledger lost ENABLE/FORCE RLS';
  END IF;
END
$$;

SELECT 'platform document intake runtime inventory passed' AS result;
