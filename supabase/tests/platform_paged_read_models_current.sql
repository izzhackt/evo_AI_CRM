\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 078. This suite is intentionally
-- catalog- and RPC-only: it does not depend on fixtures left by historical
-- suites, and it leaves the sequential disposable database unchanged.
BEGIN;

DO $$
DECLARE
  contract RECORD;
  routine_oid OID;
  routine_row pg_proc%ROWTYPE;
  forbidden_role TEXT;
  overload_count INTEGER;
BEGIN
  FOR contract IN
    SELECT *
    FROM (
      VALUES
        (
          'platform.staff_student_case_page(integer,timestamp with time zone,uuid,platform.student_case_state,text,uuid)',
          'staff_student_case_page',
          5
        ),
        (
          'platform.staff_student_case_read_snapshot(uuid)',
          'staff_student_case_read_snapshot',
          0
        ),
        (
          'platform.staff_application_page(integer,timestamp with time zone,uuid,platform.application_status,uuid,uuid)',
          'staff_application_page',
          5
        ),
        (
          'platform.staff_application_snapshot(uuid)',
          'staff_application_snapshot',
          0
        ),
        (
          'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid)',
          'staff_communication_page',
          5
        ),
        (
          'platform.staff_communication_snapshot(uuid,uuid)',
          'staff_communication_snapshot',
          0
        ),
        (
          'platform.staff_conversation_message_page(uuid,uuid,integer,timestamp with time zone,uuid)',
          'staff_conversation_message_page',
          2
        )
    ) AS expected(signature, routine_name, default_argument_count)
  LOOP
    routine_oid := pg_catalog.to_regprocedure(contract.signature)::OID;
    IF routine_oid IS NULL THEN
      RAISE EXCEPTION
        'Migration 078 RPC signature is missing: %',
        contract.signature;
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
        routine_row.proconfig
          @> ARRAY['search_path=""']::TEXT[]
      )
      OR routine_row.pronargdefaults <> contract.default_argument_count
    THEN
      RAISE EXCEPTION
        'Migration 078 hardened read contract drifted for %',
        contract.signature;
    END IF;

    SELECT count(*)
    INTO overload_count
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'platform'
      AND routine.proname = contract.routine_name;

    IF overload_count <> 1 THEN
      RAISE EXCEPTION
        'Migration 078 RPC % has % overloads; expected exactly one',
        contract.routine_name,
        overload_count;
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      'authenticated',
      routine_oid,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'authenticated lacks EXECUTE on migration 078 RPC %',
        contract.signature;
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
          '% unexpectedly has EXECUTE on migration 078 RPC %',
          forbidden_role,
          contract.signature;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

DO $$
DECLARE
  obsolete_routine_name TEXT;
BEGIN
  FOREACH obsolete_routine_name IN ARRAY ARRAY[
    'staff_student_case_queue',
    'staff_student_case_snapshot',
    'staff_application_queue',
    'staff_communication_queue',
    'staff_conversation_messages',
    'sales_handoff_summaries'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'platform'
        AND routine.proname = obsolete_routine_name
    ) THEN
      RAISE EXCEPTION
        'Obsolete unbounded RPC still exists after migration 078: %',
        obsolete_routine_name;
    END IF;
  END LOOP;
END
$$;

-- The limit is part of the public RPC contract. These calls fail before actor
-- lookup, proving that callers cannot request an unbounded response.
DO $$
BEGIN
  BEGIN
    PERFORM * FROM platform.staff_student_case_page(102);
    RAISE EXCEPTION 'student-case page accepted an oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM * FROM platform.staff_application_page(102);
    RAISE EXCEPTION 'application page accepted an oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_communication_page(
      '78000000-0000-4000-8000-000000000001',
      102
    );
    RAISE EXCEPTION 'communication page accepted an oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;

  BEGIN
    PERFORM *
    FROM platform.staff_conversation_message_page(
      '78000000-0000-4000-8000-000000000001',
      '78000000-0000-4000-8000-000000000002',
      202
    );
    RAISE EXCEPTION 'message page accepted an oversized limit';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    NULL;
  END;
END
$$;

ROLLBACK;

SELECT 'platform migration 078 current read-model contract passed' AS result;
