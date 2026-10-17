\set ON_ERROR_STOP on
-- Boundary suite for migration 295 «Телефония Beeline KG» срез T5 (строки звонков в
-- «Ленте» лида и результат звонка одним нажатием; docs/EVO_TELEPHONY_PLAN_2026-10-16.md
-- §6.1, §9.1, §9.4, §11, §12; ADR 0033). Runs on the real chain right after 295
-- inside one transaction that is rolled back, with its own synthetic organizations,
-- members (modelled like production: invited staff have coarse role NULL, rights come
-- from scoped role assignments made through the REAL platform.staff_role_command /
-- staff_role_publish / staff_role_assignments_save and from the roles the real T2
-- provisioning creates), clients, leads, calls and legs: no provider, no real person,
-- no real phone, no recording, no production action.
--
-- Proves:
--  1. catalog and grants: the two public functions are SECURITY DEFINER with an empty
--     search_path, callable by authenticated only (not by PUBLIC, anon, service_role,
--     supabase_auth_admin, the AI agent role); the two helpers are closed to every
--     client role; the read is STABLE, the command VOLATILE;
--  2. the column and its lock: result_callback_on exists exactly when
--     result_code = 'callback' (CHECK both ways) and stays in 2020..2200;
--  3. the switch: with no settings row or ui_enabled = false the read answers
--     {enabled:false, calls:[]} and shows nothing (also for calls that exist); a
--     reader without lead.read, a Student and a member of another organization are
--     refused (42501) first, so the switch is not an existence oracle;
--  4. what a row carries: the exact key set, the masked phone, no full number, no
--     recording link, no https text anywhere in the answer, newest first, the leg
--     participants, the recording state, calls of the lead and calls of its client
--     that had no lead, nothing of another client or another organization, hasMore,
--     the since/until window, argument errors (22023);
--  5. visibility follows lead.read by lead: the department manager sees the lead of
--     his department, the other department's manager is refused, an organization-wide
--     reader, the supervisor and the Admin see it;
--  6. who may set a result (canSetResult / resultEditable): needs dial_enabled AND the
--     telephony.call.dial right; a manager only on a call he talked on; the supervisor
--     and the Admin on any visible answered call; a plain lead reader never; the
--     7-day offer window, the 24-hour change window, backfill rows and unanswered
--     calls closed;
--  7. telephony_set_result_v1: the error matrix (invalid code and date shape 22023,
--     switch off 55000, no right 42501, unreadable and unknown call P0002 without an
--     existence leak, another manager's call 42501, not answered / out of window
--     PT409, past and far dates 22023), saved / unchanged / changed results, the
--     callback day appears and disappears with the code, the audit event
--     (telephony.result.set on telephony_call, no number, no name), that nothing else
--     in the call row changes, and that a repeat writes nothing;
--  8. the two helpers as pure rules (window boundaries, the leg that counts as «talked»).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t295_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t295_auth_role$;

\echo T295_TELEPHONY_LEAD_FEED_SUITE_START

CREATE FUNCTION pg_temp.t295_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t295_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T295: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t295_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    result := jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
-- The SQLSTATE of an error answer ('ok' when the answer carries no error).
CREATE FUNCTION pg_temp.t295_code(p_answer JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_answer ? 'error' THEN split_part(p_answer ->> 'error', ':', 1) ELSE 'ok' END
$$;
-- A statement run and rolled back: 'ok' when it succeeds, the SQLSTATE when it fails.
CREATE FUNCTION pg_temp.t295_try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'T295 rollback' USING ERRCODE = 'PT999';
  EXCEPTION WHEN SQLSTATE 'PT999' THEN
    RETURN 'ok';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (active), organization 2 (active, another tenant).
--   actor 1  org 1 Admin (system admin)
--   actor 2  org 1 manager A  — «Телефония — менеджер» + lead.read for department A
--   actor 3  org 1 manager A2 — the same, department A
--   actor 4  org 1 manager B  — «Телефония — менеджер» + lead.read for department B
--   actor 5  org 1 supervisor — «Телефония — руководитель» + lead.read for the organization
--   actor 6  org 1 plain lead reader — lead.read for the organization, no telephony right
--   actor 7  org 1 Student
--   actor 8  org 1 staff without any role
--   actor 9  org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t295_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t295_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, NULL, FALSE), (7, 1, 'student', FALSE), (8, 1, NULL, FALSE), (9, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t295_id(1), 'T295 Fictional organization', 'active'),
  (pg_temp.t295_id(2), 'T295 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t295_id(100 + n), 't295-' || n || '@example.invalid', '{}'::JSONB FROM t295_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t295_id(200 + n), pg_temp.t295_id(100 + n), 'T295 Actor ' || n, 'active', 1 FROM t295_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t295_id(300 + a.n), pg_temp.t295_id(a.org), pg_temp.t295_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t295_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t295_id(300 + n) FROM t295_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t295_id(401), pg_temp.t295_id(1), 'organization', pg_temp.t295_id(1), 1),
  (pg_temp.t295_id(402), pg_temp.t295_id(2), 'organization', pg_temp.t295_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t295_id(1), pg_temp.t295_id(301), pg_temp.t295_id(401), 1, 1, TRUE, 'system', 'T295 synthetic scope', pg_temp.t295_id(601)),
  (pg_temp.t295_id(2), pg_temp.t295_id(309), pg_temp.t295_id(402), 1, 1, TRUE, 'system', 'T295 synthetic scope', pg_temp.t295_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t295_id(901), pg_temp.t295_id(1), 'T295 Sales A'),
  (pg_temp.t295_id(903), pg_temp.t295_id(1), 'T295 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t295_id(1), pg_temp.t295_id(302), pg_temp.t295_id(901)),
  (pg_temp.t295_id(1), pg_temp.t295_id(303), pg_temp.t295_id(901)),
  (pg_temp.t295_id(1), pg_temp.t295_id(304), pg_temp.t295_id(903));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t295_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t295_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t295_admin_setup \gset

-- The real T2 provisioning creates the two telephony roles in every active organization.
SELECT platform_private.telephony_rights_provision('T295 provision') IS NOT NULL AS t295_provisioned \gset
SELECT pg_temp.t295_assert(:'t295_provisioned'::BOOLEAN, 'the T2 provisioning ran');

-- The lead.read role: created and published by the Admin through the real RPCs.
SELECT pg_temp.t295_assert(
  pg_temp.t295_call('authenticated', :'t295_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T295 create role', %L::UUID)$q$,
    pg_temp.t295_id(1), pg_temp.t295_id(1101),
    jsonb_build_object('label', 'T295 lead access', 'description', 'T295 synthetic lead.read role',
      'permissionKeys', '["lead.read"]'::JSONB),
    pg_temp.t295_id(1111))) ->> 'status' = 'applied',
  'the Admin creates the lead.read role through the real RPC');
SELECT pg_temp.t295_call('authenticated', :'t295_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T295 publish role', %L::UUID)$q$,
    pg_temp.t295_id(1), pg_temp.t295_id(1101), pg_temp.t295_id(1), pg_temp.t295_id(1101), pg_temp.t295_id(1112))) ->> 'status' AS t295_published \gset
SELECT pg_temp.t295_assert(:'t295_published' = 'applied', 'the Admin publishes the lead.read role');

CREATE FUNCTION pg_temp.t295_telrole(p_label TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT id FROM platform.staff_role_definitions WHERE organization_id = pg_temp.t295_id(1) AND label = p_label
$$;
-- Role assignments of one member through staff_role_assignments_save; items are (role, scope kind, scope key).
CREATE FUNCTION pg_temp.t295_assign(p_actor INTEGER, p_req INTEGER, p_items JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_claims TEXT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t295_id(200 + p_actor);
  SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', i.kind, 'key', i.scope_key,
      'resourceKind', NULL)) ORDER BY r.id),
    jsonb_agg(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version) ORDER BY r.id)
  INTO items, bindings
  FROM jsonb_to_recordset(p_items) AS i(role_id UUID, kind TEXT, scope_key UUID)
  JOIN platform.staff_role_definitions r ON r.id = i.role_id
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id;
  v_claims := (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t295_id(101),
    'claims', jsonb_build_object('sub', pg_temp.t295_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
  RETURN pg_temp.t295_call('authenticated', v_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t295_id(1), pg_temp.t295_id(300 + p_actor), v_version, items, bindings, 'T295 assign',
    pg_temp.t295_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t295_assert(
  pg_temp.t295_assign(2, 1, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t295_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)),
    jsonb_build_object('role_id', pg_temp.t295_id(1101), 'kind', 'department', 'scope_key', pg_temp.t295_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t295_assign(3, 2, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t295_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)),
    jsonb_build_object('role_id', pg_temp.t295_id(1101), 'kind', 'department', 'scope_key', pg_temp.t295_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t295_assign(4, 3, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t295_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)),
    jsonb_build_object('role_id', pg_temp.t295_id(1101), 'kind', 'department', 'scope_key', pg_temp.t295_id(903)))) ->> 'status' = 'applied'
  AND pg_temp.t295_assign(5, 4, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t295_telrole('Телефония — руководитель'), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)),
    jsonb_build_object('role_id', pg_temp.t295_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)))) ->> 'status' = 'applied'
  AND pg_temp.t295_assign(6, 5, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t295_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t295_id(1)))) ->> 'status' = 'applied',
  'the Admin assigns the telephony and lead.read roles through staff_role_assignments_save');

CREATE TEMP TABLE t295_claims(n INTEGER PRIMARY KEY, claims TEXT NOT NULL);
INSERT INTO t295_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t295_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t295_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 9) n;
-- The statement as authenticated, with the JWT of the given actor.
CREATE FUNCTION pg_temp.t295_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t295_call('authenticated', (SELECT c.claims FROM t295_claims c WHERE c.n = p_actor), p_sql)
$$;
-- The feed read for a lead (fixture number), with optional extra named arguments.
CREATE FUNCTION pg_temp.t295_feed(p_actor INTEGER, p_lead INTEGER, p_extra TEXT DEFAULT '', p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t295_as(p_actor, format('SELECT platform.telephony_lead_calls_v1(%L::UUID, %L::UUID%s)',
    pg_temp.t295_id(p_org), pg_temp.t295_id(5000 + p_lead), p_extra))
$$;
-- The result command for a call (fixture number).
CREATE FUNCTION pg_temp.t295_result(p_actor INTEGER, p_call INTEGER, p_code TEXT, p_on TEXT DEFAULT NULL,
  p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t295_as(p_actor, format('SELECT platform.telephony_set_result_v1(%L::UUID, %L::UUID, %L, %L::DATE)',
    pg_temp.t295_id(p_org), pg_temp.t295_id(7000 + p_call), p_code, p_on))
$$;
-- The row of a call in a feed answer, by call number.
CREATE FUNCTION pg_temp.t295_row(p_feed JSONB, p_call INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT c FROM jsonb_array_elements(p_feed -> 'calls') c WHERE c ->> 'callId' = pg_temp.t295_id(7000 + p_call)::TEXT
$$;
-- The call numbers of a feed answer, in the order the answer gives them.
CREATE FUNCTION pg_temp.t295_order(p_feed JSONB) RETURNS INTEGER[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((substr(c ->> 'callId', 25)::INTEGER - 7000) ORDER BY ord), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(p_feed -> 'calls') WITH ORDINALITY AS t(c, ord)
$$;
-- The call numbers whose row says «result can be set or changed».
CREATE FUNCTION pg_temp.t295_editable(p_feed JSONB) RETURNS INTEGER[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((substr(c ->> 'callId', 25)::INTEGER - 7000) ORDER BY substr(c ->> 'callId', 25)::INTEGER), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(p_feed -> 'calls') c WHERE (c ->> 'resultEditable')::BOOLEAN
$$;

-- ---------------------------------------------------------------------------
-- Clients, leads, calls, legs.
--   client 1: lead 1 (owner manager A, department A) — the lead under test — and lead 3
--             (owner manager A2): the same client's call on lead 3 must not show on lead 1
--   client 2: lead 2 (owner manager B, department B)
--   client 3: no lead (a call from a client without a lead is part of no feed)
--   org 2: client 10, lead 10
-- Phones are synthetic; the full number must never reach an answer.
-- ---------------------------------------------------------------------------
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state) VALUES
  (pg_temp.t295_id(4001), pg_temp.t295_id(1), 'T295 Client One', platform_private.normalize_person_name('T295 Client One'),
    '+996700000001', platform_private.normalize_person_phone('+996700000001'), 'active'),
  (pg_temp.t295_id(4002), pg_temp.t295_id(1), 'T295 Client Two', platform_private.normalize_person_name('T295 Client Two'),
    '+996700000002', platform_private.normalize_person_phone('+996700000002'), 'active'),
  (pg_temp.t295_id(4003), pg_temp.t295_id(1), 'T295 Client Three', platform_private.normalize_person_name('T295 Client Three'),
    '+996700000003', platform_private.normalize_person_phone('+996700000003'), 'active'),
  (pg_temp.t295_id(4010), pg_temp.t295_id(2), 'T295 Client Ten', platform_private.normalize_person_name('T295 Client Ten'),
    '+996700000010', platform_private.normalize_person_phone('+996700000010'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state) VALUES
  (pg_temp.t295_id(5001), pg_temp.t295_id(1), pg_temp.t295_id(4001), pg_temp.t295_id(302), 'new', 'website', 'open'),
  (pg_temp.t295_id(5002), pg_temp.t295_id(1), pg_temp.t295_id(4002), pg_temp.t295_id(304), 'new', 'website', 'open'),
  (pg_temp.t295_id(5003), pg_temp.t295_id(1), pg_temp.t295_id(4001), pg_temp.t295_id(303), 'new', 'website', 'open'),
  (pg_temp.t295_id(5010), pg_temp.t295_id(2), pg_temp.t295_id(4010), pg_temp.t295_id(309), 'new', 'website', 'open');

-- A call: outcome NULL = ringing (no outcome yet). Ages are before «now» of the fixture.
CREATE FUNCTION pg_temp.t295_mk(p_k INTEGER, p_dir TEXT, p_outcome TEXT, p_age INTERVAL, p_client INTEGER, p_lead INTEGER,
  p_member INTEGER, p_via TEXT DEFAULT 'webhook', p_talk INTEGER DEFAULT NULL, p_org INTEGER DEFAULT 1,
  p_phone TEXT DEFAULT '+996700000001') RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - p_age;
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, talk_seconds, client_phone, membership_id, client_id, lead_id,
    match_state, created_via)
  VALUES (pg_temp.t295_id(7000 + p_k), pg_temp.t295_id(p_org), 't295-call-' || p_k, p_dir,
    CASE WHEN p_outcome IS NULL THEN 'ringing' ELSE 'ended' END, p_outcome,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE 'webhook' END,
    v_start, CASE WHEN p_outcome = 'answered' THEN v_start + INTERVAL '5 seconds' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE v_start + INTERVAL '3 minutes' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE v_start + INTERVAL '4 minutes' END,
    p_talk, p_phone,
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t295_id(300 + p_member) END,
    CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t295_id(4000 + p_client) END,
    CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t295_id(5000 + p_lead) END,
    CASE WHEN p_client IS NULL THEN 'unmatched' ELSE 'matched' END, p_via);
END
$$;
-- A leg of a call (fixture numbers); the member may be NULL (a group leg).
CREATE FUNCTION pg_temp.t295_leg(p_call INTEGER, p_member INTEGER, p_state TEXT, p_status TEXT DEFAULT NULL,
  p_accepted BOOLEAN DEFAULT FALSE, p_total INTEGER DEFAULT NULL, p_talk INTEGER DEFAULT NULL,
  p_link TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_at TIMESTAMPTZ;
BEGIN
  SELECT c.started_at INTO v_at FROM platform_private.telephony_calls c
    WHERE c.organization_id = pg_temp.t295_id(p_org) AND c.id = pg_temp.t295_id(7000 + p_call);
  INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, membership_id, state, status,
    leg_started_at, leg_start_source, accepted_at, webhook_total_seconds, talk_seconds, recording_link, recording_state)
  VALUES (pg_temp.t295_id(p_org), pg_temp.t295_id(7000 + p_call),
    CASE WHEN p_member IS NULL THEN '' ELSE 'u70' || p_member END,
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t295_id(300 + p_member) END,
    p_state, p_status, v_at, 'history', CASE WHEN p_accepted THEN v_at + INTERVAL '5 seconds' END, p_total, p_talk,
    p_link, CASE WHEN p_link IS NULL THEN 'none' ELSE 'available' END);
END
$$;

-- Calls of lead 1 / client 1, newest first by age:
--   9   in   ringing   —       30 s
--   1   out  answered  mgr A   2 h     talk 125, a recording (a secret link in the leg)
--   2   in   missed    —       3 h     two legs: A and A2 rang, nobody took it
--   6   out  busy      —       4 h
--   7   in   answered  mgr A   5 h     no lead yet, client 1 (a call before the lead existed)
--   10  out  answered  mgr A   6 h     result «reached» set 2 h ago
--   3   in   answered  mgr A2  1 d     talk 40
--   11  out  answered  mgr A   2 d     result «reached» set 30 h ago (change window closed)
--   5   in   answered  mgr A   49 h    backfill (primary import)
--   12  out  answered  mgr A2  3 d     A's leg was cancelled, A2 answered
--   4   out  answered  mgr A   10 d    outside the 7-day offer window
-- Elsewhere: 8 and 14 = client 2 / lead 2 (manager B); 15 = client 1 / lead 3 (manager A2);
-- 13 = client 3, no lead; 20 = organization 2.
SELECT pg_temp.t295_mk(1, 'out', 'answered', INTERVAL '2 hours', 1, 1, 2, 'webhook', 125);
SELECT pg_temp.t295_leg(1, 2, 'completed', 'success', TRUE, 130, 125, 'https://example.invalid/t295-secret-recording-1.mp3');
UPDATE platform_private.telephony_calls SET recording_state = 'available' WHERE id = pg_temp.t295_id(7001);
SELECT pg_temp.t295_mk(2, 'in', 'missed', INTERVAL '3 hours', 1, 1, NULL);
SELECT pg_temp.t295_leg(2, 2, 'missed', 'missed');
SELECT pg_temp.t295_leg(2, 3, 'missed', 'missed');
SELECT pg_temp.t295_mk(3, 'in', 'answered', INTERVAL '1 day', 1, 1, 3, 'webhook', 40);
SELECT pg_temp.t295_leg(3, 3, 'completed', 'success', TRUE, 45, 40);
SELECT pg_temp.t295_mk(4, 'out', 'answered', INTERVAL '10 days', 1, 1, 2, 'webhook', 60);
SELECT pg_temp.t295_leg(4, 2, 'completed', 'success', TRUE, 65, 60);
SELECT pg_temp.t295_mk(5, 'in', 'answered', INTERVAL '49 hours', 1, 1, 2, 'backfill', 30);
SELECT pg_temp.t295_leg(5, 2, 'completed', 'success', TRUE, 35, 30);
SELECT pg_temp.t295_mk(6, 'out', 'busy', INTERVAL '4 hours', 1, 1, NULL);
SELECT pg_temp.t295_leg(6, 2, 'completed', 'busy');
SELECT pg_temp.t295_mk(7, 'in', 'answered', INTERVAL '5 hours', 1, NULL, 2, 'webhook', 20);
SELECT pg_temp.t295_leg(7, 2, 'completed', 'success', TRUE, 25, 20);
SELECT pg_temp.t295_mk(9, 'in', NULL, INTERVAL '30 seconds', 1, 1, NULL);
SELECT pg_temp.t295_leg(9, 2, 'ringing');
SELECT pg_temp.t295_mk(10, 'out', 'answered', INTERVAL '6 hours', 1, 1, 2, 'webhook', 90);
SELECT pg_temp.t295_leg(10, 2, 'completed', 'success', TRUE, 95, 90);
UPDATE platform_private.telephony_calls SET result_code = 'reached', result_by = pg_temp.t295_id(302),
  result_at = clock_timestamp() - INTERVAL '2 hours' WHERE id = pg_temp.t295_id(7010);
SELECT pg_temp.t295_mk(11, 'out', 'answered', INTERVAL '2 days', 1, 1, 2, 'webhook', 90);
SELECT pg_temp.t295_leg(11, 2, 'completed', 'success', TRUE, 95, 90);
UPDATE platform_private.telephony_calls SET result_code = 'reached', result_by = pg_temp.t295_id(302),
  result_at = clock_timestamp() - INTERVAL '30 hours' WHERE id = pg_temp.t295_id(7011);
SELECT pg_temp.t295_mk(12, 'out', 'answered', INTERVAL '3 days', 1, 1, 3, 'webhook', 15);
SELECT pg_temp.t295_leg(12, 2, 'cancelled', 'cancel');
SELECT pg_temp.t295_leg(12, 3, 'completed', 'success', TRUE, 20, 15);
SELECT pg_temp.t295_mk(8, 'in', 'answered', INTERVAL '1 hour', 2, 2, 4, 'webhook', 50, 1, '+996700000002');
SELECT pg_temp.t295_leg(8, 4, 'completed', 'success', TRUE, 55, 50);
SELECT pg_temp.t295_mk(13, 'in', 'missed', INTERVAL '1 hour', 3, NULL, NULL, 'webhook', NULL, 1, '+996700000003');
SELECT pg_temp.t295_mk(20, 'in', 'answered', INTERVAL '1 hour', 10, 10, 9, 'webhook', 33, 2, '+996700000010');
SELECT pg_temp.t295_leg(20, 9, 'completed', 'success', TRUE, 38, 33, NULL, 2);
-- Call 15: the same client, the other lead (lead 3): it is lead 3's, not lead 1's.
SELECT pg_temp.t295_mk(15, 'out', 'answered', INTERVAL '20 minutes', 1, 3, 3, 'webhook', 33);
SELECT pg_temp.t295_leg(15, 3, 'completed', 'success', TRUE, 38, 33);
-- Call 14 (lead 2): one leg per kind, for the «talked» rule of the helper.
SELECT pg_temp.t295_mk(14, 'in', 'answered', INTERVAL '90 minutes', 2, 2, NULL, 'webhook', NULL, 1, '+996700000002');
SELECT pg_temp.t295_leg(14, 2, 'ringing');
SELECT pg_temp.t295_leg(14, 3, 'completed', 'busy');
SELECT pg_temp.t295_leg(14, 4, 'completed', 'success', FALSE, 0);
SELECT pg_temp.t295_leg(14, 5, 'completed', 'success', FALSE, 12);
SELECT pg_temp.t295_leg(14, 6, 'transferred');
SELECT pg_temp.t295_leg(14, 8, 'accepted', NULL, TRUE);
SELECT pg_temp.t295_assert((SELECT count(*) FROM platform_private.telephony_calls) = 16, 'sanity: the fixture holds 16 calls');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert((SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('telephony_lead_calls_v1', 'telephony_set_result_v1')),
  'the two public functions are owner-owned SECURITY DEFINER with an empty search_path');
SELECT pg_temp.t295_assert(
  (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)'::regprocedure) = 's'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_set_result_v1(uuid,uuid,text,date)'::regprocedure) = 'v',
  'the read is STABLE and the command VOLATILE');
SELECT pg_temp.t295_assert(
  has_function_privilege('authenticated', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')) = 0,
  'both public functions are executable by authenticated only');
SELECT pg_temp.t295_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform_private.telephony_result_window_open(text,text,timestamptz,text,timestamptz,timestamptz)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform_private.telephony_call_taken_by(uuid,uuid,uuid)', 'EXECUTE')) = 0
  AND NOT has_function_privilege('public', 'platform_private.telephony_result_window_open(text,text,timestamptz,text,timestamptz,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.telephony_call_taken_by(uuid,uuid,uuid)', 'EXECUTE'),
  'the two helpers are closed to PUBLIC and every client role');
SELECT pg_temp.t295_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_claim_work_v1', 'telephony_erase_person_v1', 'telephony_integration_health_v1',
    'telephony_lead_calls_v1', 'telephony_maintenance_plan_v1', 'telephony_project_work_v1',
    'telephony_purge_evidence_v1', 'telephony_receive_v1', 'telephony_reconcile_apply_v1',
    'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settle_calls_v1',
    'telephony_sync_extensions_v1'],
  'platform holds the eleven earlier public telephony functions (the four of T1b, the five of T4a, the two of T11a) and exactly these two new ones');
SELECT pg_temp.t295_assert('telephony.result.set' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'telephony_call' = ANY (platform_private.p7a_safe_audit_resource_types()),
  'the journal allowlist (T2) already knows telephony.result.set and telephony_call');

-- ---------------------------------------------------------------------------
-- 2. The callback day: present exactly when the result is «callback».
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert(
  pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_code = 'callback', result_by = '29500000-0000-4000-8000-000000000302',
    result_at = clock_timestamp() WHERE id = '29500000-0000-4000-8000-000000007013'$$) = '23514'
  AND pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_callback_on = DATE '2031-01-01'
    WHERE id = '29500000-0000-4000-8000-000000007013'$$) = '23514'
  AND pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_code = 'reached', result_by = '29500000-0000-4000-8000-000000000302',
    result_at = clock_timestamp(), result_callback_on = DATE '2031-01-01' WHERE id = '29500000-0000-4000-8000-000000007013'$$) = '23514'
  AND pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_code = 'callback', result_by = '29500000-0000-4000-8000-000000000302',
    result_at = clock_timestamp(), result_callback_on = DATE '1999-12-31' WHERE id = '29500000-0000-4000-8000-000000007013'$$) = '23514'
  AND pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_code = 'callback', result_by = '29500000-0000-4000-8000-000000000302',
    result_at = clock_timestamp(), result_callback_on = DATE '2200-01-02' WHERE id = '29500000-0000-4000-8000-000000007013'$$) = '23514'
  AND pg_temp.t295_try($$UPDATE platform_private.telephony_calls SET result_code = 'callback', result_by = '29500000-0000-4000-8000-000000000302',
    result_at = clock_timestamp(), result_callback_on = DATE '2031-01-01' WHERE id = '29500000-0000-4000-8000-000000007013'$$) = 'ok'
  AND (SELECT result_code IS NULL AND result_callback_on IS NULL FROM platform_private.telephony_calls
    WHERE id = pg_temp.t295_id(7013)),
  'a callback day exists exactly with result «callback» and stays in 2020..2200 (the valid write is rolled back)');
SELECT pg_temp.t295_assert((SELECT bool_and(result_callback_on IS NULL) FROM platform_private.telephony_calls),
  'no existing row carries a callback day');

-- ---------------------------------------------------------------------------
-- 3. The switch: no settings row, then ui_enabled = false.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_settings), 'sanity: no settings row exists');
SELECT pg_temp.t295_assert(
  pg_temp.t295_feed(1, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB
  AND pg_temp.t295_feed(2, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB
  AND pg_temp.t295_feed(5, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB,
  'without a settings row the read shows nothing even though calls exist (Admin, manager, supervisor)');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t295_id(1));
SELECT pg_temp.t295_assert(
  (SELECT NOT ui_enabled AND NOT dial_enabled FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t295_id(1))
  AND pg_temp.t295_feed(1, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB
  AND pg_temp.t295_feed(2, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB,
  'with ui_enabled = false (the default row) the read shows nothing');
-- Authority comes before the switch: the answer does not tell the unauthorised anything.
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_feed(4, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(7, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(8, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(9, 1)) = '42501',
  'switch off: manager B (other department), a Student, a member without roles and another organization are refused with 42501');
-- The command refuses by the switch only for a permitted caller; the rest see 42501.
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(2, 1, 'reached')) = '55000'
  AND pg_temp.t295_code(pg_temp.t295_result(1, 1, 'reached')) = '55000'
  AND pg_temp.t295_code(pg_temp.t295_result(6, 1, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(7, 1, 'reached')) = '42501',
  'switch off: the command answers 55000 to a permitted caller and 42501 to a reader without the right and a Student');

-- ---------------------------------------------------------------------------
-- 4. ui_enabled = true, dial_enabled = false: rows are shown, nothing can be set.
-- ---------------------------------------------------------------------------
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t295_id(1);
CREATE TEMP TABLE t295_feed_a AS SELECT pg_temp.t295_feed(2, 1) AS f;
SELECT pg_temp.t295_assert((SELECT f ->> 'enabled' = 'true' AND f ->> 'canSetResult' = 'false' AND f ->> 'hasMore' = 'false'
      AND jsonb_array_length(f -> 'calls') = 11 FROM t295_feed_a),
  'ui on, dial off: manager A reads 11 calls of lead 1, hasMore false, nothing can be set');
SELECT pg_temp.t295_assert(pg_temp.t295_order((SELECT f FROM t295_feed_a)) = ARRAY[9, 1, 2, 6, 7, 10, 3, 11, 5, 12, 4],
  'the calls come newest first: ' || pg_temp.t295_order((SELECT f FROM t295_feed_a))::TEXT);
SELECT pg_temp.t295_assert(cardinality(pg_temp.t295_editable((SELECT f FROM t295_feed_a))) = 0,
  'ui on, dial off: no row is editable');
SELECT pg_temp.t295_assert(
  NOT (pg_temp.t295_order((SELECT f FROM t295_feed_a)) && ARRAY[8, 13, 14, 15, 20]),
  'nothing of another client, of the same client''s other lead, of a client without a lead or of another organization leaks in');
SELECT pg_temp.t295_assert(pg_temp.t295_order(pg_temp.t295_feed(3, 3)) = ARRAY[15, 7],
  'lead 3 shows its own call and the client''s call from before any lead existed, not lead 1''s calls: '
    || pg_temp.t295_order(pg_temp.t295_feed(3, 3))::TEXT);
SELECT pg_temp.t295_assert((SELECT bool_and((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(c) k) = (
      SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(ARRAY[
      'answeredAt', 'callId', 'callbackOn', 'direction', 'endedAt', 'managerName', 'outcome', 'outcomeSource', 'participants',
      'phone', 'recording', 'resultAt', 'resultByName', 'resultCode', 'resultEditable', 'startedAt', 'state', 'talkSeconds']::TEXT[]) x))
    FROM jsonb_array_elements((SELECT f FROM t295_feed_a) -> 'calls') c),
  'every row carries exactly the documented 18 keys');
SELECT pg_temp.t295_assert(
  (SELECT f::TEXT NOT LIKE '%https%' AND f::TEXT NOT LIKE '%secret-recording%' AND f::TEXT NOT LIKE '%recording_link%'
      AND f::TEXT NOT LIKE '%client_phone%' AND f::TEXT NOT LIKE '%700000001%' AND f::TEXT NOT LIKE '%example.invalid%'
      AND f::TEXT NOT LIKE '%@%'
    FROM t295_feed_a),
  'no recording link, no https text, no e-mail and no full phone number anywhere in the answer');
SELECT pg_temp.t295_assert(
  (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'phone') = '+996 ••• 00 00 01'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'direction') = 'out'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'outcome') = 'answered'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'outcomeSource') = 'webhook'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'talkSeconds') = '125'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'managerName') = 'T295 Actor 2'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'recording') = 'available'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 2) ->> 'recording') = 'none'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 2) ->> 'managerName') IS NULL
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 2) ->> 'outcome') = 'missed'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 2) ->> 'direction') = 'in'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 9) ->> 'outcome') IS NULL
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 9) ->> 'state') = 'ringing',
  'the row carries the masked phone, direction, outcome, talk time, manager and the recording state, and a ringing call has no outcome');
SELECT pg_temp.t295_assert(
  (pg_temp.t295_row((SELECT f FROM t295_feed_a), 2) -> 'participants')
    = '[{"name": "T295 Actor 2", "state": "missed"}, {"name": "T295 Actor 3", "state": "missed"}]'::JSONB
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 7) -> 'participants') = '[{"name": "T295 Actor 2", "state": "completed"}]'::JSONB,
  'the participants are the legs with an employee, in leg order, name and state only');
SELECT pg_temp.t295_assert(
  (pg_temp.t295_row((SELECT f FROM t295_feed_a), 7) ->> 'startedAt') IS NOT NULL
  AND pg_temp.t295_row((SELECT f FROM t295_feed_a), 7) IS NOT NULL
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 7) ->> 'direction') = 'in',
  'the call from before the lead existed (no lead, same client) is in the feed');
SELECT pg_temp.t295_assert(
  (pg_temp.t295_row((SELECT f FROM t295_feed_a), 10) ->> 'resultCode') = 'reached'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 10) ->> 'resultByName') = 'T295 Actor 2'
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 10) ->> 'resultAt') IS NOT NULL
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 10) ->> 'callbackOn') IS NULL
  AND (pg_temp.t295_row((SELECT f FROM t295_feed_a), 1) ->> 'resultCode') IS NULL,
  'a set result shows its code, author and time; an unset one shows nothing');
-- A second read of the same lead is the same answer (STABLE, no side effect).
SELECT pg_temp.t295_assert(pg_temp.t295_feed(2, 1) = (SELECT f FROM t295_feed_a), 'the read is repeatable');

-- ---------------------------------------------------------------------------
-- 5. Visibility follows lead.read by lead.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_feed(4, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 2)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(7, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(8, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(9, 1)) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_feed(9, 10, '', 2)) = 'ok'
  AND pg_temp.t295_code(pg_temp.t295_feed(1, 10)) = '42501',
  'manager B cannot read lead 1, manager A cannot read lead 2, a Student, a member without roles and another organization are refused, a lead of another organization asked in this one is refused');
SELECT pg_temp.t295_assert(
  pg_temp.t295_order(pg_temp.t295_feed(1, 1)) = ARRAY[9, 1, 2, 6, 7, 10, 3, 11, 5, 12, 4]
  AND pg_temp.t295_order(pg_temp.t295_feed(3, 1)) = ARRAY[9, 1, 2, 6, 7, 10, 3, 11, 5, 12, 4]
  AND pg_temp.t295_order(pg_temp.t295_feed(5, 1)) = ARRAY[9, 1, 2, 6, 7, 10, 3, 11, 5, 12, 4]
  AND pg_temp.t295_order(pg_temp.t295_feed(6, 1)) = ARRAY[9, 1, 2, 6, 7, 10, 3, 11, 5, 12, 4]
  AND pg_temp.t295_order(pg_temp.t295_feed(4, 2)) = ARRAY[8, 14]
  AND pg_temp.t295_order(pg_temp.t295_feed(5, 2)) = ARRAY[8, 14],
  'the Admin, both department-A managers, the supervisor and the plain reader read lead 1; manager B and the supervisor read lead 2');
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_as(1, format('SELECT platform.telephony_lead_calls_v1(%L::UUID, %L::UUID)',
    pg_temp.t295_id(1), gen_random_uuid()))) = '42501',
  'an unknown lead is refused like an unreadable one');
-- Arguments.
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_feed(2, 1, ', p_limit => 0')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, ', p_limit => 101')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, ', p_limit => NULL')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, ', p_limit => 100')) = 'ok'
  AND pg_temp.t295_code(pg_temp.t295_as(2, format('SELECT platform.telephony_lead_calls_v1(NULL::UUID, %L::UUID)', pg_temp.t295_id(5001)))) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_as(2, format('SELECT platform.telephony_lead_calls_v1(%L::UUID, NULL::UUID)', pg_temp.t295_id(1)))) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, format(', p_since => %L::TIMESTAMPTZ, p_until => %L::TIMESTAMPTZ',
    clock_timestamp(), clock_timestamp() - INTERVAL '1 hour'))) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, format(', p_since => %L::TIMESTAMPTZ, p_until => %L::TIMESTAMPTZ',
    DATE '2031-01-01', DATE '2031-01-01'))) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_feed(2, 1, ', p_since => ''infinity''::TIMESTAMPTZ')) = '22023',
  'a limit outside 1..100, NULL ids, an empty or inverted window and an infinite bound are refused with 22023');
-- Limit and the window.
SELECT pg_temp.t295_assert(
  pg_temp.t295_order(pg_temp.t295_feed(2, 1, ', p_limit => 3')) = ARRAY[9, 1, 2]
  AND pg_temp.t295_feed(2, 1, ', p_limit => 3') ->> 'hasMore' = 'true'
  AND pg_temp.t295_feed(2, 1, ', p_limit => 11') ->> 'hasMore' = 'false'
  AND jsonb_array_length(pg_temp.t295_feed(2, 1, ', p_limit => 11') -> 'calls') = 11
  AND pg_temp.t295_feed(2, 1, ', p_limit => 10') ->> 'hasMore' = 'true'
  AND jsonb_array_length(pg_temp.t295_feed(2, 1, ', p_limit => 10') -> 'calls') = 10,
  'the limit cuts the newest first and hasMore is true exactly when more rows exist');
SELECT pg_temp.t295_assert(
  pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_since => %L::TIMESTAMPTZ, p_until => %L::TIMESTAMPTZ',
    clock_timestamp() - INTERVAL '270 minutes', clock_timestamp() - INTERVAL '60 minutes'))) = ARRAY[1, 2, 6]
  AND pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_until => %L::TIMESTAMPTZ',
    clock_timestamp() - INTERVAL '36 hours'))) = ARRAY[11, 5, 12, 4]
  AND pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_since => %L::TIMESTAMPTZ',
    clock_timestamp() - INTERVAL '270 minutes'))) = ARRAY[9, 1, 2, 6],
  'the window is «from» inclusive and «until» exclusive and combines with the rest');
-- The exact boundary: a call started exactly at «until» is in the next window, exactly at «since» in this one.
SELECT started_at AS t295_edge FROM platform_private.telephony_calls WHERE id = pg_temp.t295_id(7006) \gset
SELECT pg_temp.t295_assert(
  6 = ANY (pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_since => %L::TIMESTAMPTZ', :'t295_edge'))))
  AND NOT 6 = ANY (pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_until => %L::TIMESTAMPTZ', :'t295_edge'))))
  AND 6 = ANY (pg_temp.t295_order(pg_temp.t295_feed(2, 1, format(', p_until => %L::TIMESTAMPTZ',
    :'t295_edge'::TIMESTAMPTZ + INTERVAL '1 microsecond')))),
  'a call at the exact «until» belongs to the older window and a call at the exact «since» to this one');

-- ---------------------------------------------------------------------------
-- 6. Who may set a result.
-- ---------------------------------------------------------------------------
UPDATE platform_private.telephony_settings SET dial_enabled = TRUE WHERE organization_id = pg_temp.t295_id(1);
SELECT pg_temp.t295_assert(
  pg_temp.t295_feed(2, 1) ->> 'canSetResult' = 'true'
  AND pg_temp.t295_feed(3, 1) ->> 'canSetResult' = 'true'
  AND pg_temp.t295_feed(5, 1) ->> 'canSetResult' = 'true'
  AND pg_temp.t295_feed(1, 1) ->> 'canSetResult' = 'true'
  AND pg_temp.t295_feed(6, 1) ->> 'canSetResult' = 'false',
  'canSetResult is true for the manager, the supervisor and the Admin and false for a reader without the dial right');
SELECT pg_temp.t295_assert(
  pg_temp.t295_editable(pg_temp.t295_feed(2, 1)) = ARRAY[1, 7, 10],
  'manager A may set a result on his answered calls inside the windows: ' || pg_temp.t295_editable(pg_temp.t295_feed(2, 1))::TEXT);
SELECT pg_temp.t295_assert(
  pg_temp.t295_editable(pg_temp.t295_feed(3, 1)) = ARRAY[3, 12],
  'manager A2 may set a result on the two calls he answered: ' || pg_temp.t295_editable(pg_temp.t295_feed(3, 1))::TEXT);
SELECT pg_temp.t295_assert(
  pg_temp.t295_editable(pg_temp.t295_feed(5, 1)) = ARRAY[1, 3, 7, 10, 12]
  AND pg_temp.t295_editable(pg_temp.t295_feed(1, 1)) = ARRAY[1, 3, 7, 10, 12],
  'the supervisor and the Admin may set a result on every visible answered call inside the windows: '
    || pg_temp.t295_editable(pg_temp.t295_feed(5, 1))::TEXT);
SELECT pg_temp.t295_assert(
  cardinality(pg_temp.t295_editable(pg_temp.t295_feed(6, 1))) = 0
  AND pg_temp.t295_editable(pg_temp.t295_feed(4, 2)) = ARRAY[8],
  'a plain reader may set nothing; manager B may set the result of the call he answered on his lead');
-- The windows are closed by age: call 4 (10 d), call 5 (backfill), call 11 (result 30 h ago), unanswered 2, 6, 9.
SELECT pg_temp.t295_assert(
  NOT (ARRAY[2, 4, 5, 6, 9, 11] && pg_temp.t295_editable(pg_temp.t295_feed(5, 1))),
  'unanswered, backfill, over-age and over-changed calls are never editable, not even for the supervisor');

-- ---------------------------------------------------------------------------
-- 7. The command: errors first (nothing is written by any of them).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t295_before AS
  SELECT c.id, to_jsonb(c) AS row_state FROM platform_private.telephony_calls c;
SELECT count(*) AS t295_audit_before FROM platform.audit_events WHERE action = 'telephony.result.set' \gset
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(2, 1, 'no_answer')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'busy')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, NULL)) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'callback')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'reached', '2099-01-01')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'not_interested', '2099-01-01')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_as(2, format('SELECT platform.telephony_set_result_v1(NULL::UUID, %L::UUID, ''reached'', NULL)',
    pg_temp.t295_id(7001)))) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_as(2, format('SELECT platform.telephony_set_result_v1(%L::UUID, NULL::UUID, ''reached'', NULL)',
    pg_temp.t295_id(1)))) = '22023',
  'a code outside the three presses (no_answer is the system''s), a missing code, a callback without a day and a day without a callback are refused with 22023');
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(6, 1, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(7, 1, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(8, 1, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(9, 1, 'reached')) = '42501',
  'a reader without the dial right, a Student, a member without roles and another organization''s Admin are refused with 42501');
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(4, 1, 'reached')) = 'P0002'
  AND pg_temp.t295_code(pg_temp.t295_result(4, 7, 'reached')) = 'P0002'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 8, 'reached')) = 'P0002'
  AND pg_temp.t295_code(pg_temp.t295_result(1, 13, 'reached')) = 'P0002'
  AND pg_temp.t295_code(pg_temp.t295_result(1, 20, 'reached')) = 'P0002'
  AND pg_temp.t295_code(pg_temp.t295_result(1, 999, 'reached')) = 'P0002'
  AND pg_temp.t295_result(4, 1, 'reached') ->> 'error' = (pg_temp.t295_result(1, 999, 'reached') ->> 'error'),
  'a call on a lead the caller cannot read, a call with no lead of a client with none, a call of another organization and an unknown call all answer P0002 with the same text');
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(2, 3, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(3, 1, 'reached')) = '42501'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 12, 'reached')) = '42501',
  'a manager cannot set the result of a call another manager answered, nor of one where his own leg was only cancelled');
SELECT pg_temp.t295_assert(
  pg_temp.t295_result(5, 6, 'reached') ->> 'error' = 'PT409:telephony_result_not_answered'
  AND pg_temp.t295_result(5, 2, 'reached') ->> 'error' = 'PT409:telephony_result_not_answered'
  AND pg_temp.t295_result(5, 9, 'reached') ->> 'error' = 'PT409:telephony_result_not_answered'
  AND pg_temp.t295_result(1, 6, 'reached') ->> 'error' = 'PT409:telephony_result_not_answered',
  'an unanswered call (busy, missed, ringing) takes no result: PT409 «not_answered», even from the supervisor and the Admin');
SELECT pg_temp.t295_assert(
  pg_temp.t295_result(5, 4, 'reached') ->> 'error' = 'PT409:telephony_result_closed'
  AND pg_temp.t295_result(5, 5, 'reached') ->> 'error' = 'PT409:telephony_result_closed'
  AND pg_temp.t295_result(5, 11, 'not_interested') ->> 'error' = 'PT409:telephony_result_closed'
  AND pg_temp.t295_result(2, 4, 'reached') ->> 'error' = 'PT409:telephony_result_closed',
  'a call older than 7 days, a primary-import call and a result older than 24 hours are closed: PT409 «closed»');
SELECT pg_temp.t295_assert(
  pg_temp.t295_code(pg_temp.t295_result(2, 1, 'callback', ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1)::TEXT)) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'callback', ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 366)::TEXT)) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'callback', 'infinity')) = '22023'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 1, 'callback', '-infinity')) = '22023',
  'a callback day in the past (Bishkek), more than a year ahead or infinite is refused with 22023');
SELECT pg_temp.t295_assert(
  (SELECT count(*) FROM platform_private.telephony_calls c JOIN t295_before b ON b.id = c.id WHERE to_jsonb(c) = b.row_state)
    = (SELECT count(*) FROM platform_private.telephony_calls)
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.result.set') = :t295_audit_before,
  'none of the refusals changed a call or wrote a journal row');

-- ---------------------------------------------------------------------------
-- 7b. The command: saved, unchanged, changed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_result(2, 1, 'reached') AS t295_saved1 \gset
SELECT pg_temp.t295_assert(:'t295_saved1'::JSONB ->> 'status' = 'saved' AND :'t295_saved1'::JSONB ->> 'resultCode' = 'reached'
  AND :'t295_saved1'::JSONB ->> 'callbackOn' IS NULL AND :'t295_saved1'::JSONB ->> 'callId' = pg_temp.t295_id(7001)::TEXT,
  'manager A presses «Дозвонился»: saved');
SELECT pg_temp.t295_assert(
  (SELECT c.result_code = 'reached' AND c.result_by = pg_temp.t295_id(302) AND c.result_callback_on IS NULL
      AND c.result_at > clock_timestamp() - INTERVAL '1 minute' AND c.updated_at >= c.result_at
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7001)),
  'the call row carries the code, the author, the time and no day');
SELECT pg_temp.t295_assert(
  (SELECT to_jsonb(c) - 'result_code' - 'result_by' - 'result_at' - 'result_callback_on' - 'updated_at'
      = b.row_state - 'result_code' - 'result_by' - 'result_at' - 'result_callback_on' - 'updated_at'
    FROM platform_private.telephony_calls c JOIN t295_before b ON b.id = c.id WHERE c.id = pg_temp.t295_id(7001)),
  'nothing but the result columns and updated_at changed in the call row');
SELECT result_at AS t295_result_at FROM platform_private.telephony_calls WHERE id = pg_temp.t295_id(7001) \gset
SELECT count(*) AS t295_audit_1 FROM platform.audit_events WHERE action = 'telephony.result.set' \gset
SELECT pg_temp.t295_assert(:t295_audit_1 = :t295_audit_before + 1, 'one journal row for the first press');
-- The same press again changes nothing and writes nothing.
SELECT pg_temp.t295_result(2, 1, 'reached') AS t295_again \gset
SELECT pg_temp.t295_assert(:'t295_again'::JSONB ->> 'status' = 'unchanged'
  AND (SELECT result_at = :'t295_result_at'::TIMESTAMPTZ FROM platform_private.telephony_calls WHERE id = pg_temp.t295_id(7001))
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.result.set') = :t295_audit_1,
  'pressing the same result again answers «unchanged», keeps the time and writes no journal row');
-- Change it to «Перезвонить» with a day (tomorrow, Bishkek).
SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)::TEXT AS t295_tomorrow \gset
SELECT pg_temp.t295_result(2, 1, 'callback', :'t295_tomorrow') AS t295_cb \gset
SELECT pg_temp.t295_assert(:'t295_cb'::JSONB ->> 'status' = 'saved' AND :'t295_cb'::JSONB ->> 'callbackOn' = :'t295_tomorrow'
  AND (SELECT c.result_code = 'callback' AND c.result_callback_on = :'t295_tomorrow'::DATE
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7001)),
  '«Перезвонить» with a day is saved and the day is stored');
SELECT pg_temp.t295_assert(pg_temp.t295_result(2, 1, 'callback', :'t295_tomorrow') ->> 'status' = 'unchanged',
  'the same callback day again is «unchanged»');
SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 3)::TEXT AS t295_later \gset
SELECT pg_temp.t295_result(2, 1, 'callback', :'t295_later') AS t295_cb2 \gset
SELECT pg_temp.t295_assert(:'t295_cb2'::JSONB ->> 'status' = 'saved'
  AND (SELECT c.result_callback_on = :'t295_later'::DATE FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7001)),
  'another day for «Перезвонить» is a change');
SELECT pg_temp.t295_result(2, 1, 'not_interested') AS t295_ni \gset
SELECT pg_temp.t295_assert(:'t295_ni'::JSONB ->> 'status' = 'saved'
  AND (SELECT c.result_code = 'not_interested' AND c.result_callback_on IS NULL
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7001)),
  '«Не интересно» replaces the callback and clears its day');
-- Today (Bishkek) is allowed; the last allowed day is today + 365.
SELECT pg_temp.t295_assert(
  pg_temp.t295_result(2, 7, 'callback', ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE)::TEXT) ->> 'status' = 'saved'
  AND pg_temp.t295_result(2, 7, 'callback', ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 365)::TEXT) ->> 'status' = 'saved',
  'today and today + 365 are valid callback days');
-- The call before the lead existed takes a result for a reader of the client''s lead.
SELECT pg_temp.t295_assert(
  (SELECT c.lead_id IS NULL AND c.result_code = 'callback' FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7007)),
  'the result of the call without a lead is stored on that call');
-- The supervisor and the Admin set results on other managers'' calls; manager A2 on his own.
SELECT pg_temp.t295_result(5, 3, 'reached') AS t295_sup \gset
SELECT pg_temp.t295_assert(:'t295_sup'::JSONB ->> 'status' = 'saved'
  AND (SELECT c.result_by = pg_temp.t295_id(305) FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7003)),
  'the supervisor sets the result of a manager''s call and is its author');
SELECT pg_temp.t295_result(1, 12, 'callback', ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE)::TEXT) AS t295_adm \gset
SELECT pg_temp.t295_assert(:'t295_adm'::JSONB ->> 'status' = 'saved'
  AND (SELECT c.result_by = pg_temp.t295_id(301) AND c.result_code = 'callback'
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7012)),
  'the Admin sets a callback on a manager''s call');
SELECT pg_temp.t295_result(3, 12, 'reached') AS t295_a2 \gset
SELECT pg_temp.t295_assert(:'t295_a2'::JSONB ->> 'status' = 'saved'
  AND (SELECT c.result_by = pg_temp.t295_id(303) AND c.result_callback_on IS NULL
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t295_id(7012)),
  'the manager of the call changes the Admin''s press');
-- Manager B sets the result of the call he answered on his own lead; manager A cannot touch it.
SELECT pg_temp.t295_assert(
  pg_temp.t295_result(4, 8, 'not_interested') ->> 'status' = 'saved'
  AND pg_temp.t295_code(pg_temp.t295_result(2, 8, 'reached')) = 'P0002',
  'manager B sets his own call; manager A, who cannot read that lead, sees P0002');
-- The feed reflects the presses.
SELECT pg_temp.t295_assert(
  (pg_temp.t295_row(pg_temp.t295_feed(2, 1), 1) ->> 'resultCode') = 'not_interested'
  AND (pg_temp.t295_row(pg_temp.t295_feed(2, 1), 1) ->> 'resultByName') = 'T295 Actor 2'
  AND (pg_temp.t295_row(pg_temp.t295_feed(2, 1), 7) ->> 'resultCode') = 'callback'
  AND (pg_temp.t295_row(pg_temp.t295_feed(2, 1), 7) ->> 'callbackOn') = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 365)::TEXT
  AND (pg_temp.t295_row(pg_temp.t295_feed(2, 1), 3) ->> 'resultByName') = 'T295 Actor 5',
  'the feed shows the stored results, authors and callback day');
-- The audit rows: kind, resource, actor, and no phone number or name in the text.
SELECT pg_temp.t295_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.action = 'telephony.result.set') = :t295_audit_before + 10
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.result.set'
    AND NOT (e.resource_type = 'telephony_call' AND e.actor_kind = 'user' AND e.actor_principal LIKE 'auth:%'
      AND e.actor_membership_id IS NOT NULL AND e.actor_profile_id IS NOT NULL AND btrim(e.reason) <> ''
      AND e.organization_id = pg_temp.t295_id(1)))
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.result.set'
    AND (to_jsonb(e)::TEXT LIKE '%70000000%' OR to_jsonb(e)::TEXT LIKE '%T295 Actor%' OR to_jsonb(e)::TEXT LIKE '%T295 Client%'
      OR to_jsonb(e)::TEXT LIKE '%https%')),
  'ten journal rows (one per real change), all telephony_call, by a user principal, no number, no name, no link');
SELECT pg_temp.t295_assert(
  (SELECT e.before_state ->> 'resultCode' = 'reached' AND e.after_state ->> 'resultCode' = 'callback'
      AND e.after_state ->> 'callbackOn' = :'t295_tomorrow' AND e.after_state ->> 'direction' = 'out'
      AND e.after_state ->> 'leadId' = pg_temp.t295_id(5001)::TEXT
      AND e.actor_membership_id = pg_temp.t295_id(302) AND e.resource_id = pg_temp.t295_id(7001)
    FROM platform.audit_events e WHERE e.action = 'telephony.result.set' AND e.after_state ->> 'callbackOn' = :'t295_tomorrow'),
  'a change journals the old and the new code, the day, the direction and the lead id');
-- The change window of 24 hours: aged past it, the press is refused and the row is no longer editable.
UPDATE platform_private.telephony_calls SET result_at = clock_timestamp() - INTERVAL '25 hours' WHERE id = pg_temp.t295_id(7001);
SELECT pg_temp.t295_assert(
  pg_temp.t295_result(2, 1, 'reached') ->> 'error' = 'PT409:telephony_result_closed'
  AND NOT 1 = ANY (pg_temp.t295_editable(pg_temp.t295_feed(2, 1)))
  AND pg_temp.t295_result(5, 1, 'reached') ->> 'error' = 'PT409:telephony_result_closed',
  'a result older than 24 hours cannot be changed by the manager or the supervisor');
UPDATE platform_private.telephony_calls SET result_at = clock_timestamp() - INTERVAL '23 hours' WHERE id = pg_temp.t295_id(7001);
SELECT pg_temp.t295_assert(1 = ANY (pg_temp.t295_editable(pg_temp.t295_feed(2, 1)))
  AND pg_temp.t295_result(2, 1, 'reached') ->> 'status' = 'saved',
  'a result 23 hours old can still be changed');
-- A press after the switch is turned off is refused again.
UPDATE platform_private.telephony_settings SET dial_enabled = FALSE WHERE organization_id = pg_temp.t295_id(1);
SELECT pg_temp.t295_assert(pg_temp.t295_code(pg_temp.t295_result(2, 10, 'not_interested')) = '55000'
  AND pg_temp.t295_code(pg_temp.t295_result(1, 10, 'not_interested')) = '55000'
  AND cardinality(pg_temp.t295_editable(pg_temp.t295_feed(2, 1))) = 0
  AND pg_temp.t295_feed(2, 1) ->> 'canSetResult' = 'false',
  'turning dial_enabled off closes the command (55000) and the editable rows at once');
UPDATE platform_private.telephony_settings SET ui_enabled = FALSE WHERE organization_id = pg_temp.t295_id(1);
SELECT pg_temp.t295_assert(pg_temp.t295_feed(2, 1) = '{"enabled": false, "canSetResult": false, "hasMore": false, "calls": []}'::JSONB,
  'turning ui_enabled off hides the calls again');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE, dial_enabled = TRUE WHERE organization_id = pg_temp.t295_id(1);

-- ---------------------------------------------------------------------------
-- 8. The helpers as pure rules.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert(
  platform_private.telephony_result_window_open('answered', 'webhook', clock_timestamp() - INTERVAL '6 days 23 hours', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('answered', 'webhook', clock_timestamp() - INTERVAL '7 days 1 hour', NULL, NULL, clock_timestamp())
  AND platform_private.telephony_result_window_open('answered', 'webhook', clock_timestamp() - INTERVAL '30 days', 'reached',
    clock_timestamp() - INTERVAL '23 hours 59 minutes', clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('answered', 'webhook', clock_timestamp() - INTERVAL '30 days', 'reached',
    clock_timestamp() - INTERVAL '24 hours 1 minute', clock_timestamp())
  AND platform_private.telephony_result_window_open('answered', 'reconcile', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND platform_private.telephony_result_window_open('answered', 'dial', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('answered', 'backfill', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('missed', 'webhook', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('busy', 'webhook', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open(NULL, 'webhook', clock_timestamp() - INTERVAL '1 hour', NULL, NULL, clock_timestamp())
  AND NOT platform_private.telephony_result_window_open('answered', 'webhook', clock_timestamp() - INTERVAL '1 hour', 'no_answer',
    clock_timestamp() - INTERVAL '2 days', clock_timestamp()),
  'the window helper: 7 days to offer, 24 hours to change, answered and not primary-import only');
SELECT pg_temp.t295_assert(
  platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7001), pg_temp.t295_id(302))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7001), pg_temp.t295_id(303))
  AND platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7012), pg_temp.t295_id(303))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7012), pg_temp.t295_id(302))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7002), pg_temp.t295_id(302))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7001), NULL)
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(2), pg_temp.t295_id(7001), pg_temp.t295_id(302))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(999), pg_temp.t295_id(302)),
  'taken-by: the first answerer counts; a cancelled or merely rung leg, a missing member, another organization and an unknown call do not');
SELECT pg_temp.t295_assert(
  NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(302))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(303))
  AND NOT platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(304))
  AND platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(305))
  AND platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(306))
  AND platform_private.telephony_call_taken_by(pg_temp.t295_id(1), pg_temp.t295_id(7014), pg_temp.t295_id(308)),
  'taken-by by leg: ringing, busy and a Success leg with zero seconds do not count; Success with seconds, a transfer and an accepted leg do');

-- ---------------------------------------------------------------------------
-- 9. The migration did not touch what it must not: the ingest functions keep their ACL.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t295_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE')) = 0
  AND has_function_privilege('service_role', 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE'),
  'the service-only ingest function is still executable by service_role only');

\echo T295_TELEPHONY_LEAD_FEED_SUITE_END
SELECT 'T295_TELEPHONY_LEAD_FEED_SUITE_PASSED' AS t295_suite_marker;
ROLLBACK;
