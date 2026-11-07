\set ON_ERROR_STOP on
-- Boundary suite for migration 346 «Удаление аккаунта знает таблицы входа по логину». Runs on the real chain right after
-- 346 inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves (a real cabinet made by the Admin through 342: permission, then the server's completion with a login):
--  1. such an account without a case is simple again: no reason, nothing named as other records; its login and the
--     record of who created it are in the closure, so the automatic deletion erases them with the account;
--  2. the own-table list names all four new tables once, and registration links (341) stay outside it;
--  3. catalog: the closure keeps SECURITY DEFINER and an empty search_path.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a346_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a346_auth_role$;

\echo A346_ACCOUNT_DELETION_LOGIN_TABLES_SUITE_START

CREATE FUNCTION pg_temp.a346_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a346_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A346: %', message; END IF;
END
$$;
-- A signed-in account or a bare role: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a346_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    IF p_who IS NULL THEN
      PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::TEXT, TRUE);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
        'user_id', pg_temp.a346_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a346_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE 'SELECT to_jsonb((' || p_sql || '))' INTO result;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', TRUE);
    RETURN jsonb_build_object('ok', result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object('error', v_state, 'message', v_message);
  END;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a346_id(INTEGER) TO authenticated, service_role;

-- Fixture: 101 the system Admin; 111 the new Auth user the server made for the cabinet.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a346_id(1), 'A346 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a346_id(100 + n), 'a346-' || n || '@example.invalid', '{}'::JSONB FROM unnest(ARRAY[1, 11]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a346_id(201), pg_temp.a346_id(101), 'A346 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  VALUES (pg_temp.a346_id(301), pg_temp.a346_id(1), pg_temp.a346_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE);

SELECT pg_temp.a346_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a346_id(1), pg_temp.a346_id(901))) #>> '{ok,provisioning_id}' AS a346_permission \gset
SELECT pg_temp.a346_call(NULL, format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
  :'a346_permission', pg_temp.a346_id(111), 'aidai.chynarova')) AS a346_cabinet \gset
SELECT pg_temp.a346_assert(:'a346_cabinet'::JSONB #>> '{ok,login}' = 'aidai.chynarova'
    AND EXISTS (SELECT 1 FROM platform_private.student_logins WHERE auth_user_id = pg_temp.a346_id(111))
    AND EXISTS (SELECT 1 FROM platform_private.student_account_provisioning WHERE auth_user_id = pg_temp.a346_id(111)),
  'fixture: the Admin made a cabinet with a login: ' || :'a346_cabinet');

-- ---------------------------------------------------------------------------
-- 1. The cabinet without a case is a simple account again.
-- ---------------------------------------------------------------------------
SELECT platform_private.account_deletion_check(pg_temp.a346_id(1), pg_temp.a346_id(111)) AS a346_check \gset
SELECT pg_temp.a346_assert(:'a346_check'::JSONB -> 'reasons' = '[]'::JSONB
    AND COALESCE(:'a346_check'::JSONB #> '{closure,other}', '[]'::JSONB) = '[]'::JSONB
    AND (:'a346_check'::JSONB #> '{closure,rows}') ? 'platform_private.student_logins'
    AND (:'a346_check'::JSONB #> '{closure,rows}') ? 'platform_private.student_account_provisioning',
  'no reason and no other records; the login and the creation record go with the account: ' || :'a346_check');

-- ---------------------------------------------------------------------------
-- 2. The own-table list.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a346_assert((SELECT bool_and((length(src) - length(replace(src, quote_literal(name), ''))) / length(quote_literal(name)) = 1)
      FROM (SELECT pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure) AS src) d
      CROSS JOIN unnest(ARRAY['platform_private.student_logins', 'platform_private.student_account_provisioning',
        'platform_private.student_case_account_provisioning', 'platform_private.student_password_resets']) AS name)
    AND strpos(pg_get_functiondef('platform_private.account_deletion_closure(uuid,uuid)'::regprocedure),
      'platform_private.student_registration_links') = 0,
  'all four new tables are own, once each; registration links stay with the lead');

-- ---------------------------------------------------------------------------
-- 3. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a346_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    FROM pg_proc p WHERE p.oid = 'platform_private.account_deletion_closure(uuid,uuid)'::regprocedure),
  'the closure keeps SECURITY DEFINER and an empty search_path');

\echo A346_ACCOUNT_DELETION_LOGIN_TABLES_SUITE_PASSED

ROLLBACK;
