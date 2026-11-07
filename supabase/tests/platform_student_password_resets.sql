\set ON_ERROR_STOP on
-- Boundary suite for migration 344 «Сброс пароля студента администратором». Runs on the real chain right after 344 inside
-- one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the card reads the student's login (and a non-technical e-mail) for the Admin only;
--  2. only a System Admin gets a reset permission, only for a case bound to a live Student; a case without a cabinet or
--     bound to a staff membership is refused; the Auth user comes from the binding; a replay returns the same row;
--  3. only the server completes it, within 10 minutes and while the admin keeps the same access: one journal row
--     student.password.reset in the admin's name; a replay writes nothing; failed and expired permissions stop;
--  4. catalog: SECURITY DEFINER, empty search_path, grants, the closed table and the journal allowlist.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a344_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a344_auth_role$;

\echo A344_STUDENT_PASSWORD_RESETS_SUITE_START

CREATE FUNCTION pg_temp.a344_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a344_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A344: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a344_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a344_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a344_id(p_who), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
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
CREATE FUNCTION pg_temp.a344_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.a344_authorize(p_who INTEGER, p_request INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a344_call(p_who, format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a344_id(1), pg_temp.a344_id(p_request), pg_temp.a344_id(p_case)))
$$;
CREATE FUNCTION pg_temp.a344_complete(p_role TEXT, p_reset UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a344_as(p_role, format('platform.complete_student_password_reset_v1(%L::UUID)', p_reset))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a344_id(INTEGER) TO authenticated, anon, service_role;

-- Fixture: 101 and 104 System Admins, 102 a curator, 103 a seller, 111 the student of case 401 (its cabinet is opened by
-- 343 below). 402 is open without a student; 405 is bound (insert-time trigger bypassed) to the seller's membership 303.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a344_id(1), 'A344 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a344_id(100 + n), 'a344-' || (100 + n) || '@example.invalid', '{}'::JSONB FROM unnest(ARRAY[1, 2, 3, 4, 11]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a344_id(200 + n), pg_temp.a344_id(100 + n), 'A344 Person ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a344_id(300 + r.n), pg_temp.a344_id(1), pg_temp.a344_id(200 + r.n), 'active', r.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = r.role AND status = 'published' ORDER BY version DESC LIMIT 1),
    r.role = 'admin'
  FROM (VALUES (1, 'admin'::platform.business_role), (2, 'curator'::platform.business_role), (3, 'sales'::platform.business_role),
    (4, 'admin'::platform.business_role)) AS r(n, role);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a344_id(501), pg_temp.a344_id(1), 'organization', pg_temp.a344_id(1), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a344_id(1000 + n), pg_temp.a344_id(1), 'student_case', pg_temp.a344_id(n), 1 FROM unnest(ARRAY[401, 402, 405]) AS n;
INSERT INTO platform.membership_scope_assignments(id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id)
  SELECT pg_temp.a344_id(600 + n), pg_temp.a344_id(1), pg_temp.a344_id(300 + n), pg_temp.a344_id(501), 1, 1, TRUE, 'system', NULL,
    'A344 Admin organization scope', pg_temp.a344_id(700 + n)
  FROM unnest(ARRAY[1, 4]) AS n;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, student_display_name, target_country, target_degree, program_direction,
  state, handoff_at, portal_activated_at, current_scope_id, current_scope_version)
SELECT pg_temp.a344_id(c.n), pg_temp.a344_id(1), CASE WHEN c.n = 405 THEN pg_temp.a344_id(303) END, pg_temp.a344_id(303),
  pg_temp.a344_id(302), 'synthetic:a344:' || c.n, 'A344 Student ' || c.n, 'China', 'Bachelor', 'Engineering', 'active',
  statement_timestamp(), CASE WHEN c.n = 405 THEN statement_timestamp() END, pg_temp.a344_id(1000 + c.n), 1
FROM (VALUES (401), (402), (405)) AS c(n);
SET LOCAL session_replication_role = origin;
-- Case 401 gets its cabinet through 343 itself.
SELECT pg_temp.a344_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
  pg_temp.a344_id(1), pg_temp.a344_id(890), pg_temp.a344_id(401))) #>> '{ok,provisioning_id}' AS a344_cabinet_permission \gset
SELECT pg_temp.a344_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
  :'a344_cabinet_permission', pg_temp.a344_id(111), 'aidai.chynarova')) AS a344_cabinet \gset
SELECT pg_temp.a344_assert(:'a344_cabinet'::JSONB #>> '{ok,login}' = 'aidai.chynarova', 'fixture: case 401 has its cabinet: ' || :'a344_cabinet');

-- ---------------------------------------------------------------------------
-- 1. The card reads how the student signs in.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a344_assert(pg_temp.a344_call(101, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
      pg_temp.a344_id(1), pg_temp.a344_id(401))) -> 'ok' = jsonb_build_object('state', 'open', 'refusal', 'student_case_has_cabinet',
      'login', 'aidai.chynarova', 'email', 'a344-111@example.invalid')
    AND pg_temp.a344_call(101, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
      pg_temp.a344_id(1), pg_temp.a344_id(402))) -> 'ok' = jsonb_build_object('state', 'none', 'refusal', NULL, 'login', NULL, 'email', NULL)
    AND pg_temp.a344_call(102, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
      pg_temp.a344_id(1), pg_temp.a344_id(401))) ->> 'error' = '42501',
  'the Admin reads the login and the e-mail of the student; nobody else');
UPDATE auth.users SET email = 'student-1@students.evoadmissions.invalid' WHERE id = pg_temp.a344_id(111);
SELECT pg_temp.a344_assert(pg_temp.a344_call(101, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
    pg_temp.a344_id(1), pg_temp.a344_id(401))) #>> '{ok,email}' IS NULL,
  'the technical placeholder e-mail is never shown');

-- ---------------------------------------------------------------------------
-- 2. Permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a344_assert(pg_temp.a344_authorize(102, 902, 401) ->> 'error' = '42501'
    AND pg_temp.a344_authorize(103, 902, 401) ->> 'error' = '42501'
    AND pg_temp.a344_as('anon', format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a344_id(1), pg_temp.a344_id(902), pg_temp.a344_id(401))) ->> 'error' = '42501'
    AND pg_temp.a344_as('service_role', format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a344_id(1), pg_temp.a344_id(902), pg_temp.a344_id(401))) ->> 'error' = '42501',
  'a curator, a seller, anon and the service get no permission');
SELECT pg_temp.a344_assert(pg_temp.a344_authorize(101, 902, 499) ->> 'error' = '22023'
    AND pg_temp.a344_authorize(101, 902, 402) ->> 'message' = 'student_case_no_cabinet'
    AND pg_temp.a344_authorize(101, 902, 405) ->> 'message' = 'student_case_no_cabinet',
  'an unknown case, a case without a student and a case bound to a staff membership are refused');
SELECT pg_temp.a344_authorize(101, 901, 401) AS a344_first \gset
SELECT pg_temp.a344_assert(:'a344_first'::JSONB #>> '{ok,state}' = 'authorized'
    AND :'a344_first'::JSONB #>> '{ok,auth_user_id}' = pg_temp.a344_id(111)::TEXT
    AND pg_temp.a344_authorize(101, 901, 401) #>> '{ok,reset_id}' = :'a344_first'::JSONB #>> '{ok,reset_id}'
    AND pg_temp.a344_authorize(104, 901, 401) ->> 'error' = '23505'
    AND pg_temp.a344_authorize(101, 901, 402) ->> 'error' = '23505',
  'the Admin gets the permission for the bound student; a replay returns it, another admin or case cannot take it');

-- ---------------------------------------------------------------------------
-- 3. Completion.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a344_assert(pg_temp.a344_call(101, format('platform.complete_student_password_reset_v1(%L::UUID)',
    :'a344_first'::JSONB #>> '{ok,reset_id}')) ->> 'error' = '42501'
  AND pg_temp.a344_complete('anon', (:'a344_first'::JSONB #>> '{ok,reset_id}')::UUID) ->> 'error' = '42501',
  'browser roles cannot complete a reset');
SELECT pg_temp.a344_complete('service_role', (:'a344_first'::JSONB #>> '{ok,reset_id}')::UUID) AS a344_done \gset
SELECT pg_temp.a344_complete('service_role', (:'a344_first'::JSONB #>> '{ok,reset_id}')::UUID) AS a344_again \gset
SELECT pg_temp.a344_assert(:'a344_done'::JSONB #>> '{ok,state}' = 'completed' AND :'a344_again'::JSONB #>> '{ok,state}' = 'completed'
    AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'student_case' AND e.resource_id = pg_temp.a344_id(401)
        AND e.actor_profile_id = pg_temp.a344_id(201) AND e.after_state = jsonb_build_object('auth_user_id', pg_temp.a344_id(111)))
      FROM platform.audit_events e WHERE e.organization_id = pg_temp.a344_id(1) AND e.action = 'student.password.reset'),
  'the server completes: one journal row in the admin''s name; a replay writes nothing');
SELECT pg_temp.a344_authorize(101, 903, 401) AS a344_failing \gset
SELECT pg_temp.a344_as('service_role', format('platform.fail_student_password_reset_v1(%L::UUID)',
  :'a344_failing'::JSONB #>> '{ok,reset_id}')) AS a344_failed \gset
SELECT pg_temp.a344_authorize(101, 904, 401) AS a344_old \gset
UPDATE platform_private.student_password_resets SET created_at = statement_timestamp() - INTERVAL '20 minutes'
  WHERE id = (:'a344_old'::JSONB #>> '{ok,reset_id}')::UUID;
SELECT pg_temp.a344_authorize(101, 905, 401) AS a344_changed \gset
UPDATE platform.profiles SET access_version = access_version + 1 WHERE id = pg_temp.a344_id(201);
SELECT pg_temp.a344_assert(pg_temp.a344_complete('service_role', (:'a344_failing'::JSONB #>> '{ok,reset_id}')::UUID) ->> 'error' = '55000'
    AND pg_temp.a344_complete('service_role', (:'a344_old'::JSONB #>> '{ok,reset_id}')::UUID) ->> 'error' = '55000'
    AND pg_temp.a344_complete('service_role', (:'a344_changed'::JSONB #>> '{ok,reset_id}')::UUID) ->> 'error' = '42501'
    AND pg_temp.a344_as('anon', format('platform.fail_student_password_reset_v1(%L::UUID)',
      :'a344_failing'::JSONB #>> '{ok,reset_id}')) ->> 'error' = '42501'
    AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a344_id(1)
      AND e.action = 'student.password.reset'),
  'failed, expired and changed-admin resets do not complete and write nothing; only the server fails');

-- ---------------------------------------------------------------------------
-- 4. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a344_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p WHERE p.oid IN ('platform.authorize_student_password_reset_v1(uuid,uuid,uuid)'::regprocedure,
      'platform.complete_student_password_reset_v1(uuid)'::regprocedure,
      'platform.fail_student_password_reset_v1(uuid)'::regprocedure,
      'platform.staff_student_case_cabinet_v1(uuid,uuid)'::regprocedure,
      'platform_private.student_case_bound_auth_user(uuid,uuid)'::regprocedure)),
  'all functions are SECURITY DEFINER with an empty search_path');
SELECT pg_temp.a344_assert(has_function_privilege('authenticated', 'platform.authorize_student_password_reset_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform.authorize_student_password_reset_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.complete_student_password_reset_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.complete_student_password_reset_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.fail_student_password_reset_v1(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'platform.staff_student_case_cabinet_v1(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform_private.student_case_bound_auth_user(uuid,uuid)', 'EXECUTE'),
  'grants: the admin authorizes and reads, only the server completes and fails, the helper is closed');
SELECT pg_temp.a344_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      WHERE c.oid = 'platform_private.student_password_resets'::regclass)
    AND NOT has_table_privilege('authenticated', 'platform_private.student_password_resets', 'SELECT')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'student_password_resets' AND c.column_name ~ 'pass')
    AND 'student.password.reset' = ANY (platform_private.p7a_safe_audit_actions()),
  'the table is closed and keeps no password; the journal allows student.password.reset');

\echo A344_STUDENT_PASSWORD_RESETS_SUITE_PASSED

ROLLBACK;
