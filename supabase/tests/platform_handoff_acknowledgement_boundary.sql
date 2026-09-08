-- Schema and unauthenticated-boundary proof only; creates no actors/cases.
-- Successful real-curator, reassignment and retry proof remains a separate gate.
BEGIN;
DO $$
DECLARE api_role TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
    WHERE oid = 'platform.student_case_handoff_acknowledgements'::regclass
      AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'Acknowledgement RLS must be enabled and forced';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
    IF has_table_privilege(api_role, 'platform.student_case_handoff_acknowledgements', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'Unexpected direct acknowledgement privilege for %', api_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (
    'platform.staff_student_case_handoff_acknowledgement(uuid)'::regprocedure,
    'platform.staff_lead_handoff_acknowledgement(uuid)'::regprocedure,
    'platform.respond_student_case_handoff(uuid,uuid,uuid,uuid,text,text,date,uuid)'::regprocedure
  ) AND prosecdef) THEN
    RAISE EXCEPTION 'Exposed acknowledgement functions must be invoker-only';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'platform.student_case_handoff_acknowledgements'::regclass
      AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'Append-only and truncate triggers are required';
  END IF;
END
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{}', true);
DO $$
BEGIN
  BEGIN
    PERFORM platform.staff_student_case_handoff_acknowledgement('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'Anonymous acknowledgement read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM platform.staff_lead_handoff_acknowledgement('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'Anonymous Sales handoff excerpt unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM platform.respond_student_case_handoff(
      '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000', NULL, 'accepted', NULL, NULL,
      '00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'Anonymous acknowledgement write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
ROLLBACK;
