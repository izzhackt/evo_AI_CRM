\set ON_ERROR_STOP on

-- Current-boundary contract for migration 106. Keep this catalog-only so the
-- exact authenticated RPC signature, hardening, and private/provider boundary
-- remain covered without introducing duplicate fixture setup.
BEGIN;

DO $catalog_contract$
DECLARE
  routine_oid OID := pg_catalog.to_regprocedure(
    'platform.staff_communication_command_context(uuid,uuid)'
  )::OID;
  routine_row pg_catalog.pg_proc%ROWTYPE;
  forbidden_role TEXT;
BEGIN
  IF routine_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 106 communication command-context RPC signature is missing';
  END IF;

  SELECT routine.*
  INTO STRICT routine_row
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = routine_oid;

  IF NOT routine_row.prosecdef
    OR routine_row.provolatile <> 's'
    OR routine_row.prokind <> 'f'
    OR NOT routine_row.proretset
    OR NOT (
      routine_row.proconfig @> ARRAY['search_path=""']::TEXT[]
    )
    OR routine_row.pronargdefaults <> 0
    OR pg_catalog.pg_get_function_result(routine_oid)
      <> 'TABLE(conversation_id uuid, canonical_lead_id uuid, canonical_client_id uuid, student_case_id uuid)'
  THEN
    RAISE EXCEPTION 'Migration 106 command-context RPC contract drifted';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    routine_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated lacks EXECUTE on migration 106 command-context RPC';
  END IF;

  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon',
    'service_role',
    'supabase_auth_admin'
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      forbidden_role,
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        '% unexpectedly has EXECUTE on migration 106 command-context RPC',
        forbidden_role;
    END IF;
  END LOOP;

  IF pg_catalog.obj_description(routine_oid, 'pg_proc')
    NOT LIKE '%never infers scope from provider identifiers%'
  THEN
    RAISE EXCEPTION 'Migration 106 command-context RPC comment drifted';
  END IF;
END
$catalog_contract$;

ROLLBACK;
