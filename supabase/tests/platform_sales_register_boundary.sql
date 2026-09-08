\set ON_ERROR_STOP on
-- Actual schema/ACL/missing-session checks. No users or business rows created.
BEGIN;
DO $$
DECLARE routine REGPROCEDURE; relation REGCLASS; checked_role TEXT; namespace TEXT;
BEGIN
  FOR routine IN SELECT p.oid::REGPROCEDURE FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('platform','private') AND p.proname IN ('read_sales_register_v1','manage_sales_register_v1','manage_sales_register_target_v1','import_sales_register_v1') LOOP
    SELECT n.nspname INTO namespace FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=routine;
    IF (SELECT prosecdef FROM pg_proc WHERE oid=routine)<>(namespace='private') THEN RAISE EXCEPTION 'Sales wrapper privilege mismatch'; END IF;
    IF NOT (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=routine) THEN RAISE EXCEPTION 'Sales RPC search path is not pinned'; END IF;
    IF NOT has_function_privilege('authenticated',routine,'EXECUTE') THEN RAISE EXCEPTION 'Sales authenticated RPC grant missing'; END IF;
    FOREACH checked_role IN ARRAY ARRAY['anon','service_role','supabase_auth_admin'] LOOP
      IF has_function_privilege(checked_role,routine,'EXECUTE') THEN RAISE EXCEPTION 'Sales RPC grants too broad'; END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('platform','private')
    AND p.proname IN ('read_sales_register_v1','manage_sales_register_v1','manage_sales_register_target_v1','import_sales_register_v1'))<>8 THEN RAISE EXCEPTION 'Sales RPC missing'; END IF;
  FOR routine IN SELECT p.oid::REGPROCEDURE FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform_private'
    AND p.proname IN ('sales_register_actor','sales_register_fields','sales_register_row','register_completed_sales_handoff','sales_register_handoff_trigger') LOOP
    FOREACH checked_role IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      IF has_function_privilege(checked_role,routine,'EXECUTE') THEN RAISE EXCEPTION 'Sales private helper exposed'; END IF;
    END LOOP;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['platform_private.sales_register'::REGCLASS,'platform_private.sales_register_targets'::REGCLASS,'platform_private.sales_register_requests'::REGCLASS] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Sales table RLS missing'; END IF;
    FOREACH checked_role IN ARRAY ARRAY['anon','authenticated','service_role','supabase_auth_admin'] LOOP
      IF has_table_privilege(checked_role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Sales private table exposed'; END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='platform_private.sales_register_requests'::REGCLASS
    AND attname='reason' AND attnotnull AND NOT attisdropped) THEN RAISE EXCEPTION 'Private command reason missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='platform_private.sales_register_requests'::REGCLASS AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%length(btrim(reason)) >= 1%' AND pg_get_constraintdef(oid) LIKE '%length(btrim(reason)) <= 1000%') THEN
    RAISE EXCEPTION 'Private command reason bounds missing'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='platform_private' AND p.proname='sales_register_fields')<>1
    OR to_regprocedure('platform_private.sales_register_fields(jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Sales normalization helper must remain one private path'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='platform_private.sales_register'::REGCLASS AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%source_kind = ''pipeline''::text) AND (source_snapshot IS NOT NULL)%') THEN
    RAISE EXCEPTION 'Pipeline source null guard missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='platform.sales_admissions_handoffs'::REGCLASS AND tgname='sales_register_completed_handoff'
    AND tgfoid='platform_private.sales_register_handoff_trigger()'::REGPROCEDURE AND tgenabled='O' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Canonical handoff trigger missing'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{}',true);
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE command TEXT; actual_message TEXT;
BEGIN
  FOREACH command IN ARRAY ARRAY[
    'SELECT platform.read_sales_register_v1(NULL,2026)',
    'SELECT platform.manage_sales_register_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    'SELECT platform.manage_sales_register_target_v1(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    'SELECT platform.import_sales_register_v1(NULL,NULL,NULL)'
  ] LOOP
    BEGIN EXECUTE command; RAISE EXCEPTION 'Missing JWT unexpectedly passed sales RPC';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT;
      IF actual_message<>'sales_register_forbidden' THEN RAISE EXCEPTION 'Unexpected sales denial: %',actual_message; END IF;
    END;
  END LOOP;
END $$;
ROLLBACK;
SELECT 'sales_register_catalog_and_no_session_boundary_passed' AS result;
