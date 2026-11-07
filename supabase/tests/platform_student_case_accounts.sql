\set ON_ERROR_STOP on
-- Boundary suite for migration 343 «Кабинет студенту, у которого уже есть дело». Runs on the real chain right after 343
-- inside one transaction that is rolled back. Synthetic data only; no provider, no real person, no production action.
--
-- Proves:
--  1. only a System Admin gets a permission, for an open case of the own organization without a student and without an
--     invite; the same request returns the same permission, another admin or another case is a conflict;
--  2. the server completes it: login name.surname, a Student profile and membership, organization and exact case scope,
--     the case bound and its portal opened, the access version raised, one «student.account.create» and one
--     «student.portal.authority.activate»; the new student then sees exactly this case; a replay changes nothing;
--  3. a pending case opens the same way and stays pending;
--  4. a failed, expired or changed-admin permission is not completed; a case bound in between refuses and nothing stays;
--  5. the trigger 215 lets the bind through only for an open row marked in the same transaction; a real e-mail invite
--     still binds through it; the card reads the cabinet state and the reason for the Admin only;
--  6. catalog: SECURITY DEFINER, empty search_path, grants, the closed table.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $a343_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a343_auth_role$;
-- The invite path of section 5 needs these Auth columns; the CI harness stub has none of them (126/185 convention).
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

\echo A343_STUDENT_CASE_ACCOUNTS_SUITE_START

CREATE FUNCTION pg_temp.a343_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('34300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a343_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A343: %', message; END IF;
END
$$;
-- A signed-in account (claims from the real token hook): {"ok": result} or {"error": SQLSTATE, "message": text}.
CREATE FUNCTION pg_temp.a343_call(p_who INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; v_state TEXT; v_message TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
      'user_id', pg_temp.a343_id(p_who), 'claims', jsonb_build_object('sub', pg_temp.a343_id(p_who), 'role', 'authenticated',
        'email', 'a343-' || p_who || '@example.invalid'))) -> 'claims')::TEXT, TRUE);
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
CREATE FUNCTION pg_temp.a343_as(p_role TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.a343_authorize(p_who INTEGER, p_request INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a343_call(p_who, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a343_id(1), pg_temp.a343_id(p_request), pg_temp.a343_id(p_case)))
$$;
CREATE FUNCTION pg_temp.a343_complete(p_role TEXT, p_provisioning UUID, p_user INTEGER, p_base TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a343_as(p_role, format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
    p_provisioning, pg_temp.a343_id(p_user), p_base))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a343_id(INTEGER) TO authenticated, anon, service_role;

-- Fixture: 101 and 104 System Admins, 102 a curator, 103 a seller, 105 a student already bound to case 406;
-- 111..114 new Auth users the server made. Cases: 401, 407, 409, 410 active; 402 pending; 403 closed;
-- 404 active with an e-mail invite; 406 active and already bound.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.a343_id(1), 'A343 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a343_id(100 + n), 'a343-' || (100 + n) || '@example.invalid', '{}'::JSONB
  FROM unnest(ARRAY[1, 2, 3, 4, 5, 11, 12, 13, 14]) AS n;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a343_id(200 + n), pg_temp.a343_id(100 + n), 'A343 Person ' || n, 'active', 1 FROM unnest(ARRAY[1, 2, 3, 4, 5]) AS n;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.a343_id(300 + r.n), pg_temp.a343_id(1), pg_temp.a343_id(200 + r.n), 'active', r.role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = r.role AND status = 'published' ORDER BY version DESC LIMIT 1),
    r.role = 'admin'
  FROM (VALUES (1, 'admin'::platform.business_role), (2, 'curator'::platform.business_role), (3, 'sales'::platform.business_role),
    (4, 'admin'::platform.business_role), (5, 'student'::platform.business_role)) AS r(n, role);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a343_id(501), pg_temp.a343_id(1), 'organization', pg_temp.a343_id(1), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.a343_id(1000 + n), pg_temp.a343_id(1), 'student_case', pg_temp.a343_id(n), 1
  FROM unnest(ARRAY[401, 402, 403, 404, 406, 407, 409, 410]) AS n;
INSERT INTO platform.membership_scope_assignments(id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id)
  SELECT pg_temp.a343_id(600 + n), pg_temp.a343_id(1), pg_temp.a343_id(300 + n), pg_temp.a343_id(501), 1, 1, TRUE, 'system', NULL,
    'A343 Admin organization scope', pg_temp.a343_id(700 + n)
  FROM unnest(ARRAY[1, 4]) AS n;
-- Cases normally come from the sale handoff, docs intake or the analyst import; here only the insert-time transition
-- trigger is bypassed, every table constraint still holds.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, student_display_name, target_country, target_degree, program_direction,
  state, handoff_at, portal_activated_at, closed_at, current_scope_id, current_scope_version)
SELECT pg_temp.a343_id(c.n), pg_temp.a343_id(1), CASE WHEN c.n = 406 THEN pg_temp.a343_id(305) END, pg_temp.a343_id(303),
  CASE WHEN c.state <> 'pending' THEN pg_temp.a343_id(302) END, 'synthetic:a343:' || c.n, 'A343 Student ' || c.n,
  'China', 'Bachelor', 'Engineering', c.state::platform.student_case_state,
  CASE WHEN c.state <> 'pending' THEN statement_timestamp() END,
  CASE WHEN c.n = 406 THEN statement_timestamp() END,
  CASE WHEN c.state = 'closed' THEN statement_timestamp() END,
  pg_temp.a343_id(1000 + c.n), 1
FROM (VALUES (401, 'active'), (402, 'pending'), (403, 'closed'), (404, 'active'), (406, 'active'), (407, 'active'),
  (409, 'active'), (410, 'active')) AS c(n, state);
SET LOCAL session_replication_role = origin;
-- 404 gets a real e-mail invite receipt through the invite command itself (admin 104: admin 101 changes in section 4).
SELECT pg_temp.a343_call(104, format(
  'platform.prepare_student_portal_provisioning(%L::UUID, %L::UUID, %L, %L, %L, NULL::UUID, %L, %L::UUID)',
  pg_temp.a343_id(1), pg_temp.a343_id(404), 'a343-invite@example.invalid', 'A343 Student 404', 'normal_u6',
  'A343 invite fixture', pg_temp.a343_id(899))) -> 'ok' AS a343_invite \gset
SELECT pg_temp.a343_assert(:'a343_invite'::JSONB ->> 'provisioning_state' = 'prepared',
  'fixture: the e-mail invite of case 404 is prepared: ' || :'a343_invite');
CREATE FUNCTION pg_temp.a343_cabinet(p_who INTEGER, p_case INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a343_call(p_who, format('platform.staff_student_case_cabinet_v1(%L::UUID, %L::UUID)',
    pg_temp.a343_id(1), pg_temp.a343_id(p_case)))
$$;

-- ---------------------------------------------------------------------------
-- 1. Permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a343_assert(pg_temp.a343_authorize(102, 902, 401) ->> 'error' = '42501'
  AND pg_temp.a343_authorize(103, 902, 401) ->> 'error' = '42501'
  AND pg_temp.a343_as('anon', format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a343_id(1), pg_temp.a343_id(902), pg_temp.a343_id(401))) ->> 'error' = '42501'
  AND pg_temp.a343_as('service_role', format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a343_id(1), pg_temp.a343_id(902), pg_temp.a343_id(401))) ->> 'error' = '42501'
  AND pg_temp.a343_call(101, format('platform.authorize_student_case_account_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.a343_id(2), pg_temp.a343_id(902), pg_temp.a343_id(401))) ->> 'error' = '42501',
  'a curator, a seller, anon, the service and an admin of another organization get no permission');
SELECT pg_temp.a343_authorize(101, 901, 401) AS a343_first \gset
SELECT pg_temp.a343_assert(:'a343_first'::JSONB #>> '{ok,state}' = 'authorized'
    AND (SELECT count(*) = 1 AND bool_and(p.requested_by_membership_id = pg_temp.a343_id(301)
        AND p.requested_by_access_version = 1 AND p.student_case_id = pg_temp.a343_id(401) AND p.auth_user_id IS NULL)
      FROM platform_private.student_case_account_provisioning p WHERE p.organization_id = pg_temp.a343_id(1)),
  'the Admin gets one permission for case 401: ' || :'a343_first');
SELECT pg_temp.a343_assert(pg_temp.a343_authorize(101, 901, 401) #>> '{ok,provisioning_id}' = :'a343_first'::JSONB #>> '{ok,provisioning_id}'
    AND pg_temp.a343_authorize(104, 901, 401) ->> 'error' = '23505'
    AND pg_temp.a343_authorize(101, 901, 407) ->> 'error' = '23505',
  'a replay returns the same permission; another admin or another case cannot take the request');
SELECT pg_temp.a343_assert(pg_temp.a343_authorize(101, 903, 499) ->> 'error' = '22023'
    AND pg_temp.a343_authorize(101, 903, 406) ->> 'message' = 'student_case_has_cabinet'
    AND pg_temp.a343_authorize(101, 903, 403) ->> 'message' = 'student_case_closed'
    AND pg_temp.a343_authorize(101, 903, 404) ->> 'message' = 'student_case_invite_exists'
    AND pg_temp.a343_authorize(101, 903, 406) ->> 'error' = 'PT409',
  'unknown, bound, closed and invited cases are refused');
SELECT pg_temp.a343_assert(pg_temp.a343_cabinet(101, 401) -> 'ok' = jsonb_build_object('state', 'none', 'refusal', NULL)
    AND pg_temp.a343_cabinet(101, 404) -> 'ok' = jsonb_build_object('state', 'none', 'refusal', 'student_case_invite_exists')
    AND pg_temp.a343_cabinet(101, 403) -> 'ok' = jsonb_build_object('state', 'none', 'refusal', 'student_case_closed')
    AND pg_temp.a343_cabinet(101, 406) -> 'ok' = jsonb_build_object('state', 'open', 'refusal', 'student_case_has_cabinet')
    AND pg_temp.a343_cabinet(101, 499) ->> 'ok' IS NULL
    AND pg_temp.a343_cabinet(102, 401) ->> 'error' = '42501',
  'the card reads the cabinet state and the reason for the Admin only');
SELECT pg_temp.a343_assert((SELECT platform_private.student_case_account_refusal(jsonb_populate_record(c,
      jsonb_build_object('responsible_sales_membership_id', NULL, 'canonical_lead_id', pg_temp.a343_id(498),
        'source_key', 'lead-cabinet:' || pg_temp.a343_id(498)::TEXT)))
    FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(402)) = 'student_case_unsupported'
  AND (SELECT platform_private.student_case_account_refusal(c) FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(402)) IS NULL,
  'a lead cabinet without a seller cannot take a student (CHECK 281); an open case with a seller can');

-- ---------------------------------------------------------------------------
-- 2. The server completes a permission.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a343_assert(pg_temp.a343_call(101, format('platform.complete_student_case_account_v1(%L::UUID, %L::UUID, %L)',
    :'a343_first'::JSONB #>> '{ok,provisioning_id}', pg_temp.a343_id(111), 'aidai.chynarova')) ->> 'error' = '42501'
  AND pg_temp.a343_complete('anon', (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID, 111, 'aidai.chynarova') ->> 'error' = '42501',
  'browser roles cannot complete a permission');
SELECT pg_temp.a343_complete('service_role', (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID, 111, 'aidai.chynarova') AS a343_done \gset
SELECT (SELECT p.student_membership_id FROM platform_private.student_case_account_provisioning p
  WHERE p.id = (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID) AS a343_membership \gset
SELECT pg_temp.a343_assert(:'a343_done'::JSONB #>> '{ok,login}' = 'aidai.chynarova'
    AND (SELECT p.state = 'completed' AND p.auth_user_id = pg_temp.a343_id(111) AND p.login = 'aidai.chynarova'
        AND p.student_profile_id IS NOT NULL AND p.bind_transaction_id IS NOT NULL AND p.finished_at IS NOT NULL
      FROM platform_private.student_case_account_provisioning p WHERE p.id = (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID)
    AND (SELECT l.auth_user_id = pg_temp.a343_id(111) FROM platform_private.student_logins l WHERE l.login = 'aidai.chynarova'),
  'the server completes with the login: ' || :'a343_done');
SELECT pg_temp.a343_assert((SELECT m.status = 'active' AND m."current_role" = 'student' AND b.status = 'published'
      AND pr.auth_user_id = pg_temp.a343_id(111) AND pr.display_name = 'A343 Student 401' AND pr.access_version > 1
    FROM platform.organization_memberships m JOIN platform.profiles pr ON pr.id = m.profile_id
    JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id
    WHERE m.id = :'a343_membership'::UUID)
  AND (SELECT c.student_membership_id = :'a343_membership'::UUID AND c.portal_activated_at IS NOT NULL AND c.state = 'active'
    FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(401))
  AND (SELECT count(*) = 2 AND bool_and(a.granted) FROM platform.membership_scope_assignments a
    WHERE a.membership_id = :'a343_membership'::UUID AND a.scope_id IN (pg_temp.a343_id(501), pg_temp.a343_id(1401))),
  'a Student membership on the case name, organization and exact case scope, the case bound and its portal open');
SELECT pg_temp.a343_assert((SELECT count(*) = 1 AND bool_and(e.after_state = jsonb_build_object('auth_user_id', pg_temp.a343_id(111))
      AND e.resource_type = 'organization' AND e.actor_profile_id = pg_temp.a343_id(201))
    FROM platform.audit_events e WHERE e.organization_id = pg_temp.a343_id(1) AND e.action = 'student.account.create')
  AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'student_case' AND e.resource_id = pg_temp.a343_id(401)
      AND e.after_state ->> 'student_membership_id' = :'a343_membership' AND e.before_state ->> 'student_membership_id' IS NULL)
    FROM platform.audit_events e WHERE e.organization_id = pg_temp.a343_id(1) AND e.action = 'student.portal.authority.activate')
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a343_id(1) AND e.action = 'membership.provision'
    AND e.resource_id = :'a343_membership'::UUID),
  'one account, one activation and one membership row in the journal, in the admin''s name');
SELECT pg_temp.a343_assert(pg_temp.a343_call(111, 'SELECT count(*) FROM platform.current_actor_authority() a WHERE a.platform_role = ''student''')
    #>> '{ok}' = '1'
  AND pg_temp.a343_call(111, 'SELECT jsonb_agg(jsonb_build_array(p.case_id, p.case_state)) FROM platform.student_portal_cases() p')
    -> 'ok' = jsonb_build_array(jsonb_build_array(pg_temp.a343_id(401), 'active')),
  'the new student signs in as a Student and sees exactly case 401');
SELECT pg_temp.a343_assert(pg_temp.a343_cabinet(101, 401) #>> '{ok,state}' = 'open',
  'after the completion the card reads the cabinet as open');
SELECT pg_temp.a343_assert(pg_temp.a343_complete('service_role', (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID, 111, 'other.name')
      #>> '{ok,login}' = 'aidai.chynarova'
    AND pg_temp.a343_complete('service_role', (:'a343_first'::JSONB #>> '{ok,provisioning_id}')::UUID, 112, 'other.name')
      ->> 'error' = '55000'
    AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a343_id(1)
      AND e.action = 'student.portal.authority.activate'),
  'a replay returns the same login and writes nothing; another user cannot take the finished permission');

-- ---------------------------------------------------------------------------
-- 3. A pending case.
-- ---------------------------------------------------------------------------
-- Each command is its own statement: a check in the same statement reads the snapshot taken before the call.
SELECT pg_temp.a343_authorize(101, 904, 402) AS a343_pending \gset
SELECT pg_temp.a343_complete('service_role', (:'a343_pending'::JSONB #>> '{ok,provisioning_id}')::UUID, 112,
  'aidai.chynarova') AS a343_pending_done \gset
SELECT pg_temp.a343_assert(:'a343_pending_done'::JSONB #>> '{ok,login}' = 'aidai.chynarova2'
  AND (SELECT c.state = 'pending' AND c.portal_activated_at IS NOT NULL AND c.current_curator_membership_id IS NULL
    FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(402))
  AND pg_temp.a343_call(112, 'SELECT jsonb_agg(jsonb_build_array(p.case_id, p.case_state)) FROM platform.student_portal_cases() p')
    -> 'ok' = jsonb_build_array(jsonb_build_array(pg_temp.a343_id(402), 'pending')),
  'a pending case opens the same way and stays pending; the next login of the same name gets a number');

-- ---------------------------------------------------------------------------
-- 4. Failed, expired, changed admin, case bound in between.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a343_authorize(101, 905, 407) AS a343_failing \gset
SELECT pg_temp.a343_as('service_role', format('platform.fail_student_case_account_v1(%L::UUID)',
  :'a343_failing'::JSONB #>> '{ok,provisioning_id}')) AS a343_failed \gset
SELECT pg_temp.a343_assert((SELECT p.state = 'failed' AND p.finished_at IS NOT NULL FROM platform_private.student_case_account_provisioning p
      WHERE p.id = (:'a343_failing'::JSONB #>> '{ok,provisioning_id}')::UUID)
    AND pg_temp.a343_complete('service_role', (:'a343_failing'::JSONB #>> '{ok,provisioning_id}')::UUID, 113, 'late.one') ->> 'error' = '55000'
    AND pg_temp.a343_as('anon', format('platform.fail_student_case_account_v1(%L::UUID)',
      :'a343_failing'::JSONB #>> '{ok,provisioning_id}')) ->> 'error' = '42501'
    AND pg_temp.a343_authorize(101, 905, 407) #>> '{ok,state}' = 'failed',
  'a failed permission cannot be completed and its replay says failed; only the server fails');
SELECT pg_temp.a343_authorize(101, 906, 409) AS a343_old \gset
UPDATE platform_private.student_case_account_provisioning SET created_at = statement_timestamp() - INTERVAL '2 hours'
  WHERE id = (:'a343_old'::JSONB #>> '{ok,provisioning_id}')::UUID;
SELECT pg_temp.a343_authorize(101, 907, 409) AS a343_changed \gset
UPDATE platform.profiles SET access_version = access_version + 1 WHERE id = pg_temp.a343_id(201);
SELECT pg_temp.a343_assert(pg_temp.a343_complete('service_role', (:'a343_old'::JSONB #>> '{ok,provisioning_id}')::UUID, 113, 'late.one')
      ->> 'error' = '55000'
    AND pg_temp.a343_complete('service_role', (:'a343_changed'::JSONB #>> '{ok,provisioning_id}')::UUID, 113, 'late.one')
      ->> 'error' = '42501'
    AND (SELECT c.student_membership_id IS NULL FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(409))
    AND NOT EXISTS (SELECT 1 FROM platform.profiles p WHERE p.auth_user_id = pg_temp.a343_id(113)),
  'an hour-old permission or an admin whose access changed cannot complete; nothing is written');
SELECT pg_temp.a343_authorize(101, 908, 410) AS a343_race_a \gset
SELECT pg_temp.a343_authorize(101, 909, 410) AS a343_race_b \gset
SELECT pg_temp.a343_complete('service_role', (:'a343_race_a'::JSONB #>> '{ok,provisioning_id}')::UUID, 113, 'first.one')
  AS a343_race_a_done \gset
SELECT pg_temp.a343_complete('service_role', (:'a343_race_b'::JSONB #>> '{ok,provisioning_id}')::UUID, 114, 'second.one')
  AS a343_race_b_done \gset
SELECT pg_temp.a343_assert(:'a343_race_a_done'::JSONB #>> '{ok,login}' = 'first.one'
    AND :'a343_race_b_done'::JSONB ->> 'message' = 'student_case_has_cabinet'
    AND NOT EXISTS (SELECT 1 FROM platform.profiles p WHERE p.auth_user_id = pg_temp.a343_id(114))
    AND NOT EXISTS (SELECT 1 FROM platform_private.student_logins l WHERE l.auth_user_id = pg_temp.a343_id(114))
    AND (SELECT p.state = 'authorized' FROM platform_private.student_case_account_provisioning p
      WHERE p.id = (:'a343_race_b'::JSONB #>> '{ok,provisioning_id}')::UUID),
  'two permissions for one case: the second completion refuses and leaves no login, profile or membership');

-- ---------------------------------------------------------------------------
-- 5. Trigger 215.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a343_try_bind(p_case UUID, p_membership UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  UPDATE platform.student_cases SET student_membership_id = p_membership WHERE id = p_case;
  RETURN 'bound';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- Student 105 (membership 305, bound to 406) stands in for a fresh account; 407 has a failed permission only.
INSERT INTO platform_private.student_case_account_provisioning(id, organization_id, request_id, student_case_id,
  requested_by_membership_id, requested_by_profile_id, requested_by_auth_user_id, requested_by_access_version, state,
  auth_user_id, student_profile_id, student_membership_id, bind_transaction_id)
VALUES (pg_temp.a343_id(950), pg_temp.a343_id(1), pg_temp.a343_id(950), pg_temp.a343_id(407), pg_temp.a343_id(301),
  pg_temp.a343_id(201), pg_temp.a343_id(101), 1, 'authorized', pg_temp.a343_id(105), pg_temp.a343_id(205), pg_temp.a343_id(305),
  '1'::xid8);
SELECT set_config('platform.student_case_account_bind_id', pg_temp.a343_id(950)::TEXT, TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) AS a343_other_transaction \gset
SELECT set_config('platform.student_case_account_bind_id', (:'a343_first'::JSONB #>> '{ok,provisioning_id}'), TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) AS a343_finished_row \gset
SELECT set_config('platform.student_case_account_bind_id', 'not-a-uuid', TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) AS a343_garbage \gset
SELECT set_config('platform.student_case_account_bind_id', '', TRUE) AS a343_guc_set \gset
SELECT set_config('platform.student_portal_bind_receipt_id', pg_temp.a343_id(950)::TEXT, TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) AS a343_invite_branch \gset
SELECT set_config('platform.student_portal_bind_receipt_id', '', TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_assert(:'a343_other_transaction' = '40001' AND :'a343_finished_row' = '40001'
    AND :'a343_garbage' = '40001' AND :'a343_invite_branch' = '40001',
  'the trigger refuses a row of another transaction, a finished row, garbage and a non-invite id under the invite name: '
    || :'a343_other_transaction' || ' ' || :'a343_finished_row' || ' ' || :'a343_garbage' || ' ' || :'a343_invite_branch');
-- The same row marked in this transaction, but finished: the state is a gate too.
UPDATE platform_private.student_case_account_provisioning SET bind_transaction_id = pg_catalog.pg_current_xact_id(),
    state = 'completed', login = 'state.gate', finished_at = statement_timestamp()
  WHERE id = pg_temp.a343_id(950);
SELECT set_config('platform.student_case_account_bind_id', pg_temp.a343_id(950)::TEXT, TRUE) AS a343_guc_set \gset
SELECT pg_temp.a343_assert(pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) = '40001',
  'a finished row marked in this very transaction is refused: the state is a gate');
UPDATE platform_private.student_case_account_provisioning SET state = 'authorized', login = NULL, finished_at = NULL
  WHERE id = pg_temp.a343_id(950);
SELECT pg_temp.a343_assert(pg_temp.a343_try_bind(pg_temp.a343_id(407), pg_temp.a343_id(305)) = 'bound',
  'the same row open and marked in this transaction passes: the transaction mark is the gate');
SELECT set_config('platform.student_case_account_bind_id', '', TRUE) AS a343_guc_set \gset
-- The e-mail invite still binds through the patched trigger: the real 126/185 path for case 404 (claim, the invited
-- Auth user, success, finalize as the service).
SELECT pg_temp.a343_as('service_role', format('platform.claim_student_portal_invite(%L::UUID, %L::UUID, %s, %s)',
  :'a343_invite'::JSONB ->> 'receipt_id', pg_temp.a343_id(960), :'a343_invite'::JSONB ->> 'receipt_version',
  :'a343_invite'::JSONB ->> 'invite_generation')) AS a343_claimed \gset
INSERT INTO auth.users(id, email, raw_user_meta_data, confirmation_sent_at)
  VALUES (pg_temp.a343_id(115), 'a343-invite@example.invalid', '{}'::JSONB, statement_timestamp());
SELECT pg_temp.a343_as('service_role', format('platform.record_student_portal_invite_success(%L::UUID, %L::UUID, %s, %s, %L::UUID, 3600)',
  :'a343_invite'::JSONB ->> 'receipt_id', pg_temp.a343_id(960), :'a343_claimed'::JSONB #>> '{ok,receipt_version}',
  :'a343_claimed'::JSONB #>> '{ok,invite_generation}', pg_temp.a343_id(115))) AS a343_succeeded \gset
SELECT pg_temp.a343_as('service_role', format('platform.finalize_student_portal_authority(%L::UUID, %s, %s)',
  :'a343_invite'::JSONB ->> 'receipt_id', :'a343_succeeded'::JSONB #>> '{ok,receipt_version}',
  :'a343_claimed'::JSONB #>> '{ok,invite_generation}')) AS a343_finalized \gset
SELECT pg_temp.a343_assert(:'a343_finalized'::JSONB ? 'ok'
    AND (SELECT c.student_membership_id IS NOT NULL FROM platform.student_cases c WHERE c.id = pg_temp.a343_id(404))
    AND pg_temp.a343_cabinet(101, 404) #>> '{ok,state}' IN ('bound', 'open'),
  'the e-mail invite of case 404 still binds its student through the patched trigger: ' || :'a343_finalized');
SELECT pg_temp.a343_assert(position($guard$receipt.provisioning_state = 'invite_succeeded'$guard$
      IN pg_get_functiondef('platform_private.guard_student_case_identity_e1()'::regprocedure)) > 0
    AND position('platform.sales_handoff_owner_sync_receipt_id'
      IN pg_get_functiondef('platform_private.guard_student_case_identity_e1()'::regprocedure)) > 0
    AND position('student_case_account_bind_allowed'
      IN pg_get_functiondef('platform_private.guard_student_case_identity_e1()'::regprocedure)) > 0,
  'the trigger keeps the invite and the sale branches and adds the account branch');

-- ---------------------------------------------------------------------------
-- 6. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a343_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
    FROM pg_proc p WHERE p.oid IN ('platform.authorize_student_case_account_v1(uuid,uuid,uuid)'::regprocedure,
      'platform.complete_student_case_account_v1(uuid,uuid,text)'::regprocedure,
      'platform.fail_student_case_account_v1(uuid)'::regprocedure,
      'platform.staff_student_case_cabinet_v1(uuid,uuid)'::regprocedure,
      'platform_private.student_case_account_bind_allowed(uuid,uuid,uuid)'::regprocedure,
      'platform_private.student_case_account_refusal(platform.student_cases)'::regprocedure)),
  'all functions are SECURITY DEFINER with an empty search_path');
SELECT pg_temp.a343_assert(has_function_privilege('authenticated', 'platform.authorize_student_case_account_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform.authorize_student_case_account_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform.authorize_student_case_account_v1(uuid,uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.complete_student_case_account_v1(uuid,uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.complete_student_case_account_v1(uuid,uuid,text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.fail_student_case_account_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.fail_student_case_account_v1(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'platform.staff_student_case_cabinet_v1(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'platform.staff_student_case_cabinet_v1(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform_private.student_case_account_bind_allowed(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform_private.student_case_account_refusal(platform.student_cases)', 'EXECUTE'),
  'grants: the admin authorizes, only the server completes and fails, the helpers are closed');
SELECT pg_temp.a343_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c
      WHERE c.oid = 'platform_private.student_case_account_provisioning'::regclass)
    AND NOT has_table_privilege('authenticated', 'platform_private.student_case_account_provisioning', 'SELECT')
    AND NOT has_table_privilege('service_role', 'platform_private.student_case_account_provisioning', 'SELECT')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform_private' AND c.table_name = 'student_case_account_provisioning' AND c.column_name ~ 'pass'),
  'the table is closed to every API role and has no password column');

\echo A343_STUDENT_CASE_ACCOUNTS_SUITE_PASSED

ROLLBACK;
