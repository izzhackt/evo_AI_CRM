-- Real PostgreSQL catalog/anonymous-boundary checks, with no created actors/data.
-- This does not certify the positive staff timeline or browser workflow.
BEGIN;
DO $$
DECLARE api_role TEXT;
BEGIN
  IF to_regprocedure('platform.staff_student_case_activity(uuid,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Superseded activity signature remains';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid =
    'platform.staff_student_case_activity(uuid,integer,timestamptz,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'Activity Data API must be invoker-only';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
    IF has_function_privilege(api_role,
      'platform.staff_student_case_activity(uuid,integer,timestamptz,uuid)', 'EXECUTE')
      OR has_function_privilege(api_role,
        'private.staff_student_case_activity(uuid,integer,timestamptz,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected activity execute privilege: %', api_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated',
    'platform.staff_student_case_activity(uuid,integer,timestamptz,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Staff activity entry point is inaccessible';
  END IF;
END
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{}', true);
DO $$
DECLARE message TEXT;
BEGIN
  BEGIN
    PERFORM platform.staff_student_case_activity(NULL, 50, NULL, NULL);
    RAISE EXCEPTION 'Activity without a session unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS message = MESSAGE_TEXT;
    IF message <> 'Authenticated staff required' THEN
      RAISE EXCEPTION 'Unexpected boundary failure instead of actor guard: %', message;
    END IF;
  END;
END
$$;
ROLLBACK;
