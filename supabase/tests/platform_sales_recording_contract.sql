\set ON_ERROR_STOP on
-- Catalog and actual denied RPC execution only. No synthetic users/business rows.
BEGIN;
DO $$
DECLARE fn REGPROCEDURE; forbidden_role TEXT; body TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'platform_private.staff_is_sales_manager(uuid,uuid)'::REGPROCEDURE,
    'platform_private.sales_register_new_snapshot(uuid,uuid)'::REGPROCEDURE
  ] LOOP
    FOREACH forbidden_role IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      IF has_function_privilege(forbidden_role,fn,'EXECUTE') THEN RAISE EXCEPTION 'private sales helper exposed'; END IF;
    END LOOP;
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=fn) THEN
      RAISE EXCEPTION 'sales helper security configuration'; END IF;
  END LOOP;
  fn:='platform.sales_register_write_access(uuid)'::REGPROCEDURE;
  IF NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN RAISE EXCEPTION 'write access RPC missing grant'; END IF;
  FOREACH forbidden_role IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
    IF has_function_privilege(forbidden_role,fn,'EXECUTE') THEN RAISE EXCEPTION 'write access RPC exposed'; END IF;
  END LOOP;
  IF has_table_privilege('authenticated','platform.staff_role_definitions','UPDATE') THEN
    RAISE EXCEPTION 'workflow binding is directly editable'; END IF;
  IF platform_private.staff_is_sales_manager(NULL,NULL) IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'missing identity admitted as manager'; END IF;
  SELECT prosrc INTO body FROM pg_proc WHERE oid='private.manage_sales_register_v1(uuid,text,uuid,bigint,jsonb,text,uuid)'::REGPROCEDURE;
  IF (length(body)-length(replace(body,'staff_is_sales_manager','')))/length('staff_is_sales_manager')<>2 THEN
    RAISE EXCEPTION 'historical writes lost initial or post-lock authority check'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE command TEXT; denial TEXT;
BEGIN
  FOREACH command IN ARRAY ARRAY[
    'SELECT platform.sales_register_write_access(NULL)',
    'SELECT platform.create_sales_report_handoff(NULL,NULL,NULL,NULL)',
    'SELECT platform.manage_sales_register_v1(NULL,''update'',NULL,NULL,NULL,NULL,NULL)'
  ] LOOP
    BEGIN
      EXECUTE command;
      RAISE EXCEPTION 'anonymous sales command was admitted';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      GET STACKED DIAGNOSTICS denial=MESSAGE_TEXT;
      IF denial<>'sales_register_forbidden' THEN RAISE EXCEPTION 'unexpected sales denial: %',denial; END IF;
    END;
  END LOOP;
END $$;
ROLLBACK;
SELECT 'sales_recording_catalog_and_missing_session_passed' AS result;
