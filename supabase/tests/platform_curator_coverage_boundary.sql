\set ON_ERROR_STOP on

-- Catalog + missing-session proof only. No actor, customer, case or task rows
-- are inserted. Positive authority/race proof still requires genuine actors.
BEGIN;
DO $$
DECLARE routine REGPROCEDURE; relation REGCLASS; checked_role TEXT; definition TEXT;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'platform.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)'::REGPROCEDURE,
    'private.read_curator_coverage_workspace(uuid,uuid,uuid,uuid)'::REGPROCEDURE,
    'platform.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)'::REGPROCEDURE,
    'private.manage_case_coverage(text,uuid,uuid,uuid,bigint,uuid,date,uuid,bigint,jsonb,text,uuid)'::REGPROCEDURE
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid=p.pronamespace
      JOIN pg_roles AS owner_role ON owner_role.oid=p.proowner
      WHERE p.oid=routine AND owner_role.rolname='postgres'
        AND p.prosecdef=(n.nspname='private') AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'Coverage RPC invoker/definer/search path contract drifted: %',routine;
    END IF;
    IF NOT has_function_privilege('authenticated',routine,'EXECUTE') THEN
      RAISE EXCEPTION 'Authenticated coverage RPC grant missing: %',routine;
    END IF;
    FOREACH checked_role IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
      IF has_function_privilege(checked_role,routine,'EXECUTE') THEN
        RAISE EXCEPTION 'Unexpected coverage RPC grant: % %',checked_role,routine;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc AS p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) AS acl
      WHERE p.oid=routine AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC coverage RPC grant: %',routine;
    END IF;
  END LOOP;
  FOREACH routine IN ARRAY ARRAY[
    'platform_private.coverage_checked_tasks(uuid,uuid,jsonb)'::REGPROCEDURE,
    'platform_private.coverage_require_current_task_assignee(uuid,uuid,uuid,platform.case_task_status)'::REGPROCEDURE,
    'platform_private.coverage_create_task_body(uuid,uuid,text,text,uuid,platform.case_task_priority,timestamptz,date,platform.case_task_status,boolean,bigint,uuid)'::REGPROCEDURE,
    'platform_private.coverage_change_task_body(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamptz,date,boolean,bigint,uuid,text)'::REGPROCEDURE
  ] LOOP
    FOREACH checked_role IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      IF has_function_privilege(checked_role,routine,'EXECUTE') THEN
        RAISE EXCEPTION 'Private coverage helper exposed: % %',checked_role,routine;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['platform_private.case_curator_coverages'::REGCLASS,'platform_private.case_coverage_tasks'::REGCLASS] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION 'Coverage table RLS missing: %',relation;
    END IF;
    FOREACH checked_role IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      IF has_table_privilege(checked_role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
        RAISE EXCEPTION 'Private coverage table exposed: % %',checked_role,relation;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH routine IN ARRAY ARRAY[
    'private.create_case_task(uuid,uuid,text,text,uuid,platform.case_task_priority,timestamptz,date,platform.case_task_status,boolean,bigint,uuid)'::REGPROCEDURE,
    'private.change_case_task(uuid,uuid,platform.case_task_status,uuid,platform.case_task_priority,timestamptz,date,boolean,bigint,uuid,text)'::REGPROCEDURE
  ] LOOP
    definition:=pg_get_functiondef(routine);
    IF strpos(definition,'lock_student_case_note_assignment_domain')=0
      OR strpos(definition,'coverage_require_current_task_assignee')<=strpos(definition,'lock_student_case_note_assignment_domain') THEN
      RAISE EXCEPTION 'Coverage task guard is not serialized: %',routine;
    END IF;
  END LOOP;
END $$;

SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE actual_message TEXT;
BEGIN
  BEGIN
    PERFORM platform.read_curator_coverage_workspace('00000000-0000-4000-8000-000000000001',NULL,NULL,NULL);
    RAISE EXCEPTION 'Missing session read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF actual_message<>'Active scoped Admin permission case.curator.assign is required' THEN
      RAISE EXCEPTION 'Unexpected missing-session read denial: %',actual_message;
    END IF;
  END;
  BEGIN
    PERFORM platform.manage_case_coverage('start','00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',1,
      '00000000-0000-4000-8000-000000000004',CURRENT_DATE,NULL,0,'[]'::JSONB,'Boundary only',
      '00000000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'Missing session command unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF actual_message<>'Active scoped Admin permission case.curator.assign is required' THEN
      RAISE EXCEPTION 'Unexpected missing-session command denial: %',actual_message;
    END IF;
  END;
  BEGIN
    PERFORM platform.create_case_task('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
      'boundary','Boundary only','00000000-0000-4000-8000-000000000003','normal',NULL,NULL,'open',false,0,
      '00000000-0000-4000-8000-000000000005');
    RAISE EXCEPTION 'Missing session task command unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
    IF actual_message<>'Active task permission is required' THEN
      RAISE EXCEPTION 'Unexpected missing-session task denial: %',actual_message;
    END IF;
  END;
END $$;
RESET ROLE;
ROLLBACK;
