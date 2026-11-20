\set ON_ERROR_STOP on
-- Boundary suite for migration 363 «Кабинет студенту открывает и его куратор». Runs on the real chain right after 363
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. the assigned curator of a case gets a permission for it; a curator with access to a case he does not curate, a
--     case without a curator, a seller, anon and the service get none; the System Admin keeps the 343 permission;
--  2. the server completes the curator's permission: the student is bound, the portal opened, the journal names the
--     curator and says «сотрудником»;
--  3. a curator reassigned between permission and completion is refused and nothing stays;
--  4. the card reads the cabinet for the curator of the case and the Admin only; the password reset (344) stays Admin-only;
--  5. catalog: the new helpers are SECURITY DEFINER with an empty search_path and closed to every API role.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a363_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a363_auth_role$;

\echo A363_CURATOR_STUDENT_CASE_ACCOUNTS_SUITE_START

CREATE FUNCTION pg_temp.a363_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('36300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a363_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A363: %', message; END IF;
END
$$;
-- A signed-in account (claims from the real token hook): {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a363_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a363_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a363_id(p_who), 'role', 'authenticated',
        'email', 'a363-' || p_who || '@example.invalid'))) -> 'claims')::TEXT, TRUE);
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
-- A bare role (service_role, anon).
CREATE FUNCTION pg_temp.a363_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.a363_authorize(p_who INTEGER, p_request INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a363_call(p_who, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a363_id(1), pg_temp.a363_id(p_request), pg_temp.a363_id(p_case)))
$$;
CREATE FUNCTION pg_temp.a363_complete(p_provisioning UUID, p_user INTEGER, p_base TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a363_as('service_role', format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
    p_provisioning, pg_temp.a363_id(p_user), p_base))
$$;
CREATE FUNCTION pg_temp.a363_cabinet(p_who INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a363_call(p_who, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
    pg_temp.a363_id(1), pg_temp.a363_id(p_case)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a363_id(INTEGER) TO authenticated, anon, service_role;

-- Fixture: 101 System Admin, 102 and 103 curators, 104 a seller; 111..113 new Auth users the server made.
-- Cases (all active, without a student): 401 curated by 102; 402 curated by 103, 102 also has access to it;
-- 403 curated by 102, reassigned to 103 in section 3; 404 without a curator.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a363_id(1), 'A363 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a363_id(100 + n), 'a363-' || (100 + n) || '@example.invalid', '{}'::JSONB
  FROM unnest(ARRAY[1, 2, 3, 4, 11, 12, 13]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a363_id(200 + n), pg_temp.a363_id(100 + n), 'A363 Person ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a363_id(300 + r.n), pg_temp.a363_id(1), pg_temp.a363_id(200 + r.n), 'active', r.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = r.role AND status = 'published' ORDER BY version DESC LIMIT 1),
    r.role = 'admin'
  FROM (VALUES (1, 'admin'::platform.business_role), (2, 'curator'::platform.business_role),
    (3, 'curator'::platform.business_role), (4, 'sales'::platform.business_role)) AS r(n, role);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a363_id(501), pg_temp.a363_id(1), 'organization', pg_temp.a363_id(1), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a363_id(1000 + n), pg_temp.a363_id(1), 'student_case', pg_temp.a363_id(n), 1
  FROM unnest(ARRAY[401, 402, 403, 404]) AS n;
-- The Admin has the organization; each curator the cases he works on (102: 401, 402, 403; 103: 402, 403); the seller 404.
INSERT INTO platform.membership_scope_assignments(id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id)
  SELECT pg_temp.a363_id(600 + a.k), pg_temp.a363_id(1), pg_temp.a363_id(a.who), pg_temp.a363_id(a.scope), 1, 1, TRUE, 'system', NULL,
    'A363 fixture scope', pg_temp.a363_id(700 + a.k)
  FROM (VALUES (1, 301, 501), (2, 302, 1401), (3, 302, 1402), (4, 302, 1403), (5, 303, 1402), (6, 303, 1403),
    (7, 304, 1404)) AS a(k, who, scope);
-- Cases normally come from the sale handoff; here only the insert-time transition trigger is bypassed, every table
-- constraint still holds.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, student_display_name, target_country, target_degree, program_direction,
  state, handoff_at, current_scope_id, current_scope_version)
SELECT pg_temp.a363_id(c.n), pg_temp.a363_id(1), NULL, pg_temp.a363_id(304),
  CASE WHEN c.curator IS NOT NULL THEN pg_temp.a363_id(c.curator) END, 'synthetic:a363:' || c.n, 'A363 Student ' || c.n,
  'Malaysia', 'Bachelor', 'Engineering', 'active', statement_timestamp(), pg_temp.a363_id(1000 + c.n), 1
FROM (VALUES (401, 302), (402, 303), (403, 302), (404, NULL)) AS c(n, curator);
SET LOCAL session_replication_role = origin;

SELECT pg_temp.a363_assert(platform_private.staff_can_access(pg_temp.a363_id(1), pg_temp.a363_id(302), 'case.read.full',
    'student_case', pg_temp.a363_id(402)),
  'fixture: curator 102 reads case 402 he does not curate (only curating opens a cabinet)');

-- ---------------------------------------------------------------------------
-- 1. Permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a363_authorize(102, 901, 401) AS a363_first \gset
SELECT pg_temp.a363_assert(:'a363_first'::JSONB #>> '{ok,state}' = 'authorized'
    AND (SELECT count(*) = 1 AND bool_and(p.requested_by_membership_id = pg_temp.a363_id(302)
        AND p.requested_by_profile_id = pg_temp.a363_id(202) AND p.requested_by_access_version = 1
        AND p.student_case_id = pg_temp.a363_id(401))
      FROM platform_private.student_case_account_provisioning p WHERE p.organization_id = pg_temp.a363_id(1)),
  'the curator of case 401 gets one permission for it: ' || :'a363_first');
SELECT pg_temp.a363_assert(pg_temp.a363_authorize(102, 901, 401) #>> '{ok,provisioning_id}' = :'a363_first'::JSONB #>> '{ok,provisioning_id}'
    AND pg_temp.a363_authorize(103, 901, 401) ->> 'error' IN ('42501', '23505'),
  'a replay returns the same permission; another curator cannot take the request');
SELECT pg_temp.a363_assert(pg_temp.a363_authorize(102, 902, 402) ->> 'error' = '42501'
    AND pg_temp.a363_authorize(102, 902, 404) ->> 'error' = '42501'
    AND pg_temp.a363_authorize(103, 902, 401) ->> 'error' = '42501'
    AND pg_temp.a363_authorize(104, 902, 404) ->> 'error' = '42501'
    AND pg_temp.a363_as('anon', format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a363_id(1), pg_temp.a363_id(902), pg_temp.a363_id(401))) ->> 'error' = '42501'
    AND pg_temp.a363_as('service_role', format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a363_id(1), pg_temp.a363_id(902), pg_temp.a363_id(401))) ->> 'error' = '42501'
    AND NOT EXISTS (SELECT 1 FROM platform_private.student_case_account_provisioning p
      WHERE p.request_id = pg_temp.a363_id(902)),
  'a case the curator only reads, a case without a curator, another curator, a seller, anon and the service get nothing');
SELECT pg_temp.a363_assert(pg_temp.a363_authorize(101, 903, 404) #>> '{ok,state}' = 'authorized',
  'the System Admin keeps the 343 permission, also for a case without a curator');

-- ---------------------------------------------------------------------------
-- 2. The server completes the curator's permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a363_complete((:'a363_first'::JSONB #>> '{ok,provisioning_id}')::UUID, 111, 'aidana.osmonova') AS a363_done \gset
SELECT pg_temp.a363_assert(:'a363_done'::JSONB #>> '{ok,login}' = 'aidana.osmonova'
    AND (SELECT c.student_membership_id IS NOT NULL AND c.portal_activated_at IS NOT NULL
      FROM platform.student_cases c WHERE c.id = pg_temp.a363_id(401))
    AND (SELECT count(*) = 1 AND bool_and(e.actor_profile_id = pg_temp.a363_id(202)
        AND e.reason = 'Кабинет студента создан сотрудником')
      FROM platform.audit_events e WHERE e.organization_id = pg_temp.a363_id(1) AND e.action = 'student.account.create')
    AND (SELECT count(*) = 1 AND bool_and(e.actor_profile_id = pg_temp.a363_id(202) AND e.reason = 'Кабинет студента от сотрудника')
      FROM platform.audit_events e WHERE e.organization_id = pg_temp.a363_id(1)
        AND e.action = 'student.portal.authority.activate' AND e.resource_id = pg_temp.a363_id(401)),
  'the server completes the curator''s permission: bound, portal open, the journal names the curator: ' || :'a363_done');

-- ---------------------------------------------------------------------------
-- 3. A curator reassigned between permission and completion.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a363_authorize(102, 904, 403) AS a363_moved \gset
SELECT pg_temp.a363_assert(:'a363_moved'::JSONB #>> '{ok,state}' = 'authorized', 'fixture: a permission for case 403');
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET current_curator_membership_id = pg_temp.a363_id(303) WHERE id = pg_temp.a363_id(403);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a363_complete((:'a363_moved'::JSONB #>> '{ok,provisioning_id}')::UUID, 113, 'bekzat.toktogulov') AS a363_refused \gset
SELECT pg_temp.a363_assert(:'a363_refused'::JSONB ->> 'error' = '42501'
    AND (SELECT c.student_membership_id IS NULL AND c.portal_activated_at IS NULL
      FROM platform.student_cases c WHERE c.id = pg_temp.a363_id(403))
    AND NOT EXISTS (SELECT 1 FROM platform_private.student_logins l WHERE l.auth_user_id = pg_temp.a363_id(113)),
  'a curator no longer on the case is refused and nothing stays: ' || :'a363_refused');

-- ---------------------------------------------------------------------------
-- 4. The card and the password reset.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a363_assert(pg_temp.a363_cabinet(102, 401) #>> '{ok,state}' = 'open'
    AND pg_temp.a363_cabinet(102, 401) #>> '{ok,login}' = 'aidana.osmonova'
    AND pg_temp.a363_cabinet(101, 401) #>> '{ok,state}' = 'open'
    AND pg_temp.a363_cabinet(103, 403) -> 'ok' = jsonb_build_object('state', 'none', 'refusal', NULL, 'login', NULL, 'email', NULL)
    AND pg_temp.a363_cabinet(102, 402) ->> 'error' = '42501'
    AND pg_temp.a363_cabinet(102, 403) ->> 'error' = '42501'
    AND pg_temp.a363_cabinet(104, 404) ->> 'error' = '42501',
  'the card reads the cabinet for the curator of the case and the Admin only');
SELECT pg_temp.a363_assert(pg_temp.a363_call(102, format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a363_id(1), pg_temp.a363_id(905), pg_temp.a363_id(401))) ->> 'error' = '42501'
    AND pg_temp.a363_call(101, format('platform.authorize_student_password_reset_v1(%L::UUID, %L::UUID, %L::UUID)',
      pg_temp.a363_id(1), pg_temp.a363_id(906), pg_temp.a363_id(401))) ? 'ok',
  'the password reset stays with the Admin');

-- ---------------------------------------------------------------------------
-- 5. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a363_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p WHERE p.oid IN ('platform_private.student_case_account_allowed(uuid,uuid,uuid)'::regprocedure,
      'platform_private.require_student_case_account_actor(uuid,uuid)'::regprocedure,
      'platform.authorize_student_case_account_v1(uuid,uuid,uuid)'::regprocedure,
      'platform.complete_student_case_account_v1(uuid,uuid,text)'::regprocedure,
      'platform.staff_student_case_cabinet_v1(uuid,uuid)'::regprocedure)),
  'all functions are SECURITY DEFINER with an empty search_path');
SELECT pg_temp.a363_assert(NOT has_function_privilege('authenticated', 'platform_private.student_case_account_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform_private.student_case_account_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform_private.student_case_account_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform_private.require_student_case_account_actor(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform_private.require_student_case_account_actor(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'platform.authorize_student_case_account_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.complete_student_case_account_v1(uuid,uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.complete_student_case_account_v1(uuid,uuid,text)', 'EXECUTE'),
  'grants: the helpers are closed, the 343 grants are unchanged');

\echo A363_CURATOR_STUDENT_CASE_ACCOUNTS_SUITE_PASSED

ROLLBACK;
