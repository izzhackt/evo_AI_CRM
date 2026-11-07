\set ON_ERROR_STOP on
-- Boundary suite for migration 342 «Кабинеты студентов создаёт администратор». Runs on the real chain right after 342
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. only an administrator gets a permission; a curator, a student and browser roles are refused;
--  2. the same request by the same admin returns the same permission; another admin's reuse of the request is a conflict;
--  3. the server completes a permission: login name.surname, one journal row student.account.create in the admin's name,
--     no password anywhere; a second completion returns the same login; a replay of the request says completed with
--     the login; browser roles cannot complete;
--  4. an old permission (over an hour) or a failed one cannot be completed; failing closes only an open permission;
--  5. catalog: SECURITY DEFINER, empty search_path, the grants, the closed table and the journal allowlist.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a342_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a342_auth_role$;

\echo A342_STUDENT_ACCOUNTS_SUITE_START

CREATE FUNCTION pg_temp.a342_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a342_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A342: %', message; END IF;
END
$$;
-- A signed-in account: {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a342_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a342_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a342_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
    SET LOCAL ROLE authenticated;
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
-- A bare role (service_role, anon, authenticated without a profile).
CREATE FUNCTION pg_temp.a342_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role)::TEXT, TRUE);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
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
GRANT EXECUTE ON FUNCTION pg_temp.a342_id(INTEGER) TO authenticated, anon, service_role;

-- Fixture: 101 and 104 system Admins, 102 a curator, 103 a student; 111, 112 new Auth users the server made.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a342_id(1), 'A342 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a342_id(100 + n), 'a342-' || n || '@example.invalid', '{}'::JSONB FROM unnest(ARRAY[1, 2, 3, 4, 11, 12]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a342_id(200 + n), pg_temp.a342_id(100 + n), 'A342 Person ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a342_id(300 + r.n), pg_temp.a342_id(1), pg_temp.a342_id(200 + r.n), 'active', r.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = r.role AND status = 'published' ORDER BY version DESC LIMIT 1),
    r.role = 'admin'
  FROM (VALUES (1, 'admin'::platform.business_role), (2, 'curator'::platform.business_role),
    (3, 'student'::platform.business_role), (4, 'admin'::platform.business_role)) AS r(n, role);

-- ---------------------------------------------------------------------------
-- 1. Only an administrator gets a permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a342_id(1), pg_temp.a342_id(901))) AS a342_permission \gset
SELECT pg_temp.a342_assert(:'a342_permission'::JSONB #>> '{ok,state}' = 'authorized'
    AND (SELECT count(*) = 1 AND bool_and(p.requested_by_membership_id = pg_temp.a342_id(301) AND p.student_case_id IS NULL)
      FROM platform_private.student_account_provisioning p WHERE p.organization_id = pg_temp.a342_id(1)),
  'the Admin gets one permission: ' || :'a342_permission');
SELECT pg_temp.a342_assert(pg_temp.a342_call(102, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(902))) ->> 'error' = '42501'
  AND pg_temp.a342_call(103, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(903))) ->> 'error' = '42501'
  AND pg_temp.a342_as('anon', format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(904))) ->> 'error' = '42501'
  AND pg_temp.a342_as('service_role', format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(905))) ->> 'error' = '42501',
  'a curator, a student, anon and the service get no permission');

-- ---------------------------------------------------------------------------
-- 2. The same request returns the same permission; another admin's reuse is a conflict.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a342_assert(pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(901))) #>> '{ok,provisioning_id}' = :'a342_permission'::JSONB #>> '{ok,provisioning_id}'
  AND pg_temp.a342_call(104, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(901))) ->> 'error' = '23505',
  'a replay returns the same permission; another admin cannot take the request');

-- ---------------------------------------------------------------------------
-- 3. The server completes a permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a342_assert(pg_temp.a342_call(101, format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
    :'a342_permission'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(111), 'aidai.chynarova')) ->> 'error' = '42501'
  AND pg_temp.a342_as('anon', format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
    :'a342_permission'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(111), 'aidai.chynarova')) ->> 'error' = '42501',
  'browser roles cannot complete a permission');
SELECT pg_temp.a342_as('service_role', format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
  :'a342_permission'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(111), 'aidai.chynarova')) AS a342_done \gset
SELECT pg_temp.a342_assert(:'a342_done'::JSONB #>> '{ok,login}' = 'aidai.chynarova'
    AND (SELECT p.state = 'completed' AND p.auth_user_id = pg_temp.a342_id(111) AND p.login = 'aidai.chynarova' AND p.finished_at IS NOT NULL
      FROM platform_private.student_account_provisioning p WHERE p.id = (:'a342_permission'::JSONB #>> '{ok,provisioning_id}')::UUID)
    AND (SELECT l.auth_user_id = pg_temp.a342_id(111) FROM platform_private.student_logins l WHERE l.login = 'aidai.chynarova'),
  'the server completes: the login is the new user''s: ' || :'a342_done');
SELECT pg_temp.a342_assert((SELECT count(*) = 1 AND bool_and(e.actor_profile_id = pg_temp.a342_id(201)
      AND e.actor_principal = 'auth:' || pg_temp.a342_id(101) AND e.resource_type = 'organization'
      AND e.after_state = jsonb_build_object('auth_user_id', pg_temp.a342_id(111)))
    FROM platform.audit_events e WHERE e.organization_id = pg_temp.a342_id(1) AND e.action = 'student.account.create')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'platform_private' AND c.table_name = 'student_account_provisioning' AND c.column_name ~ 'pass'),
  'one journal row in the admin''s name with the new user only; no password column');
SELECT pg_temp.a342_assert(pg_temp.a342_as('service_role', format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
    :'a342_permission'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(111), 'other.name')) #>> '{ok,login}' = 'aidai.chynarova'
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a342_id(1) AND e.action = 'student.account.create'),
  'a second completion of the same account returns the same login and writes nothing');
SELECT pg_temp.a342_assert(pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(901))) -> 'ok' = jsonb_build_object('provisioning_id',
    :'a342_permission'::JSONB #>> '{ok,provisioning_id}', 'state', 'completed', 'login', 'aidai.chynarova'),
  'a replay of a created account says completed with its login and nothing else');

-- ---------------------------------------------------------------------------
-- 4. Old and failed permissions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a342_id(1), pg_temp.a342_id(906))) AS a342_old \gset
UPDATE platform_private.student_account_provisioning SET created_at = statement_timestamp() - INTERVAL '2 hours'
  WHERE id = (:'a342_old'::JSONB #>> '{ok,provisioning_id}')::UUID;
SELECT pg_temp.a342_assert(pg_temp.a342_as('service_role', format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
    :'a342_old'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(112), 'late.student')) ->> 'error' = '55000',
  'a permission older than an hour cannot be completed');
SELECT pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
  pg_temp.a342_id(1), pg_temp.a342_id(907))) AS a342_failing \gset
SELECT pg_temp.a342_as('service_role', format('platform.fail_student_account_v1(%L::UUID)',
  :'a342_failing'::JSONB #>> '{ok,provisioning_id}')) AS a342_failed \gset
SELECT pg_temp.a342_assert(pg_temp.a342_as('service_role', format('platform.complete_student_account_v1(%L::UUID, %L::UUID, %L)',
    :'a342_failing'::JSONB #>> '{ok,provisioning_id}', pg_temp.a342_id(112), 'failed.student')) ->> 'error' = '55000'
  AND pg_temp.a342_call(101, format('platform.authorize_student_account_v1(%L::UUID, %L::UUID)',
    pg_temp.a342_id(1), pg_temp.a342_id(907))) #>> '{ok,state}' = 'failed'
  AND pg_temp.a342_as('anon', format('platform.fail_student_account_v1(%L::UUID)',
    :'a342_failing'::JSONB #>> '{ok,provisioning_id}')) ->> 'error' = '42501'
  AND (SELECT p.state = 'completed' FROM platform_private.student_account_provisioning p
    WHERE p.id = (:'a342_permission'::JSONB #>> '{ok,provisioning_id}')::UUID),
  'a failed permission cannot be completed, its replay says failed; only the server fails; a completed one stays');

-- ---------------------------------------------------------------------------
-- 5. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a342_assert(bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres')
    AND count(*) = 3, 'the three functions are SECURITY DEFINER with an empty search_path, owner postgres')
FROM pg_proc p WHERE p.oid IN ('platform.authorize_student_account_v1(uuid,uuid)'::REGPROCEDURE,
  'platform.complete_student_account_v1(uuid,uuid,text)'::REGPROCEDURE, 'platform.fail_student_account_v1(uuid)'::REGPROCEDURE);
SELECT pg_temp.a342_assert(
  has_function_privilege('authenticated', 'platform.authorize_student_account_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.authorize_student_account_v1(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.complete_student_account_v1(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.complete_student_account_v1(uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.fail_student_account_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.fail_student_account_v1(uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.student_account_provisioning', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.student_account_provisioning', 'SELECT')
  AND 'student.account.create' = ANY (platform_private.p7a_safe_audit_actions()),
  'grants: the admin asks, the server completes or fails; the table is closed; the journal allows student.account.create');

\echo A342_STUDENT_ACCOUNTS_SUITE_PASSED
ROLLBACK;
