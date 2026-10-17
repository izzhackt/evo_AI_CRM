\set ON_ERROR_STOP on
-- Boundary suite for migration 297 «Телефония Beeline KG» срез T6 (выдача и погашение
-- права слушать запись, учёт ответов источника, список записей звонков лида;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.4, §7, §11, §12; ADR 0033). Runs on the
-- real chain right after 297 inside one transaction that is rolled back, with its own
-- synthetic organizations, members (modelled like production: invited staff have coarse
-- role NULL, rights come from scoped role assignments made through the REAL
-- platform.staff_role_command / staff_role_publish / staff_role_assignments_save and from
-- the roles the real T2 provisioning creates), clients, leads, calls and legs: no provider,
-- no real person, no real phone, no real recording, no production action. The recording
-- links are fictional «example.invalid» addresses.
--
-- Proves:
--  1. catalog and grants: the four public functions are SECURITY DEFINER with an empty
--     search_path, grant and list callable by authenticated only, consume and report by
--     service_role only (and refused to the database role service_role without the service
--     claim); the helper is closed to every client role; the whole platform telephony
--     catalog is exactly the twenty known functions; the tables stay closed;
--  2. the switch and the rights: no settings row / ui_enabled = false refuses everyone
--     (42501), including the Admin; listen.all (Admin, supervisor) any recording; listen.own
--     (manager) a recording of a call he is on a leg of — ANY leg, also a leg that only
--     rang — and nothing else; the dial right, a plain lead reader, a Student, a member
--     without roles and another organization are refused; the answers do not tell the
--     unauthorised whether a leg exists (an unknown leg is P0002 only for a listen.all
--     holder); expired (PT410), unavailable and no-recording legs;
--  3. the grant: 15 minutes, 40 uses, reused while valid (same id, no journal row), a new one
--     after expiry or exhaustion, one journal row per NEW grant only (telephony.recording.
--     listen on telephony_call, no number, no name, no link, no Range-level rows), 30 new
--     grants per hour per employee with reuse still working and the limit per employee;
--  4. consume: only the exact keys, the link only here, the use counted atomically, wrong
--     employee / another organization / expired / exhausted / unknown grant refused, the
--     switch closes it, and a leg that stopped being available is refused WITHOUT counting
--     the use;
--  5. report: a 404 on a call younger than 360 days keeps the link and counts; three
--     answers over at least six hours make it unavailable (link kept); 360 days or more
--     clears the link and expires it; the call-level state follows the legs; ok resets
--     the counter; nothing else changes;
--  6. the lead list: the switch, visibility by lead.read, the calls of the lead and of its
--     client without a lead, only calls with a recording, legs with id and state, who may
--     listen, the argument errors, and no link, https text, number or name in the answer;
--  7. hygiene: the link is read by consume only (no other function names the column), it is
--     in the leg row only (never in the journal, grants or any answer).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t297_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t297_auth_role$;

\echo T297_TELEPHONY_RECORDINGS_SUITE_START

CREATE FUNCTION pg_temp.t297_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t297_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T297: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t297_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.t297_code(p_answer JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_answer ? 'error' THEN split_part(p_answer ->> 'error', ':', 1) ELSE 'ok' END
$$;
-- A statement run and rolled back: 'ok' when it succeeds, the SQLSTATE when it fails.
CREATE FUNCTION pg_temp.t297_try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'T297 rollback' USING ERRCODE = 'PT999';
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
CREATE TEMP TABLE t297_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t297_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, NULL, FALSE), (7, 1, 'student', FALSE), (8, 1, NULL, FALSE), (9, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t297_id(1), 'T297 Fictional organization', 'active'),
  (pg_temp.t297_id(2), 'T297 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t297_id(100 + n), 't297-' || n || '@example.invalid', '{}'::JSONB FROM t297_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t297_id(200 + n), pg_temp.t297_id(100 + n), 'T297 Actor ' || n, 'active', 1 FROM t297_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t297_id(300 + a.n), pg_temp.t297_id(a.org), pg_temp.t297_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t297_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t297_id(300 + n) FROM t297_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t297_id(401), pg_temp.t297_id(1), 'organization', pg_temp.t297_id(1), 1),
  (pg_temp.t297_id(402), pg_temp.t297_id(2), 'organization', pg_temp.t297_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t297_id(1), pg_temp.t297_id(301), pg_temp.t297_id(401), 1, 1, TRUE, 'system', 'T297 synthetic scope', pg_temp.t297_id(601)),
  (pg_temp.t297_id(2), pg_temp.t297_id(309), pg_temp.t297_id(402), 1, 1, TRUE, 'system', 'T297 synthetic scope', pg_temp.t297_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t297_id(901), pg_temp.t297_id(1), 'T297 Sales A'),
  (pg_temp.t297_id(903), pg_temp.t297_id(1), 'T297 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t297_id(1), pg_temp.t297_id(302), pg_temp.t297_id(901)),
  (pg_temp.t297_id(1), pg_temp.t297_id(303), pg_temp.t297_id(901)),
  (pg_temp.t297_id(1), pg_temp.t297_id(304), pg_temp.t297_id(903));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t297_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t297_admin_setup \gset

-- The real T2 provisioning creates the two telephony roles in every active organization.
SELECT platform_private.telephony_rights_provision('T297 provision') IS NOT NULL AS t297_provisioned \gset
SELECT pg_temp.t297_assert(:'t297_provisioned'::BOOLEAN, 'the T2 provisioning ran');

-- The lead.read role: created and published by the Admin through the real RPCs.
SELECT pg_temp.t297_assert(
  pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T297 create role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1101),
    jsonb_build_object('label', 'T297 lead access', 'description', 'T297 synthetic lead.read role',
      'permissionKeys', '["lead.read"]'::JSONB),
    pg_temp.t297_id(1111))) ->> 'status' = 'applied',
  'the Admin creates the lead.read role through the real RPC');
SELECT pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T297 publish role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1101), pg_temp.t297_id(1), pg_temp.t297_id(1101), pg_temp.t297_id(1112))) ->> 'status' AS t297_published \gset
SELECT pg_temp.t297_assert(:'t297_published' = 'applied', 'the Admin publishes the lead.read role');

CREATE FUNCTION pg_temp.t297_telrole(p_label TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT id FROM platform.staff_role_definitions WHERE organization_id = pg_temp.t297_id(1) AND label = p_label
$$;
-- Role assignments of one member through staff_role_assignments_save; items are (role, scope kind, scope key).
CREATE FUNCTION pg_temp.t297_assign(p_actor INTEGER, p_req INTEGER, p_items JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_claims TEXT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t297_id(200 + p_actor);
  SELECT jsonb_agg(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', i.kind, 'key', i.scope_key,
      'resourceKind', NULL)) ORDER BY r.id),
    jsonb_agg(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version) ORDER BY r.id)
  INTO items, bindings
  FROM jsonb_to_recordset(p_items) AS i(role_id UUID, kind TEXT, scope_key UUID)
  JOIN platform.staff_role_definitions r ON r.id = i.role_id
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id;
  v_claims := (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(101),
    'claims', jsonb_build_object('sub', pg_temp.t297_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
  RETURN pg_temp.t297_call('authenticated', v_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(300 + p_actor), v_version, items, bindings, 'T297 assign',
    pg_temp.t297_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t297_assert(
  pg_temp.t297_assign(2, 1, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t297_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)),
    jsonb_build_object('role_id', pg_temp.t297_id(1101), 'kind', 'department', 'scope_key', pg_temp.t297_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(3, 2, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t297_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)),
    jsonb_build_object('role_id', pg_temp.t297_id(1101), 'kind', 'department', 'scope_key', pg_temp.t297_id(901)))) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(4, 3, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t297_telrole('Телефония — менеджер'), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)),
    jsonb_build_object('role_id', pg_temp.t297_id(1101), 'kind', 'department', 'scope_key', pg_temp.t297_id(903)))) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(5, 4, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t297_telrole('Телефония — руководитель'), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)),
    jsonb_build_object('role_id', pg_temp.t297_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)))) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(6, 5, jsonb_build_array(
    jsonb_build_object('role_id', pg_temp.t297_id(1101), 'kind', 'organization', 'scope_key', pg_temp.t297_id(1)))) ->> 'status' = 'applied',
  'the Admin assigns the telephony and lead.read roles through staff_role_assignments_save');

CREATE TEMP TABLE t297_claims(n INTEGER PRIMARY KEY, claims TEXT NOT NULL);
INSERT INTO t297_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t297_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 9) n;
-- The statement as authenticated, with the JWT of the given actor.
CREATE FUNCTION pg_temp.t297_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_call('authenticated', (SELECT c.claims FROM t297_claims c WHERE c.n = p_actor), p_sql)
$$;
-- The statement as the server (service_role with the service claim).
CREATE FUNCTION pg_temp.t297_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_call('service_role', '{"role":"service_role"}', p_sql)
$$;
-- The legs of the fixture are numbered 8000 + call * 10 + position.
CREATE FUNCTION pg_temp.t297_leg_id(p_call INTEGER, p_pos INTEGER DEFAULT 1) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT pg_temp.t297_id(8000 + p_call * 10 + p_pos)
$$;
-- The grant for a leg (fixture numbers), as an actor.
CREATE FUNCTION pg_temp.t297_grant(p_actor INTEGER, p_call INTEGER, p_pos INTEGER DEFAULT 1, p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_as(p_actor, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, %L::UUID)',
    pg_temp.t297_id(p_org), pg_temp.t297_leg_id(p_call, p_pos)))
$$;
-- The consume for a grant id and an acting employee (fixture actor number), as the server.
CREATE FUNCTION pg_temp.t297_consume(p_grant UUID, p_actor INTEGER, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_svc(format('SELECT platform.telephony_recording_consume_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t297_id(p_org), p_grant, pg_temp.t297_id(300 + p_actor)))
$$;
-- The report for a leg (fixture numbers), as the server.
CREATE FUNCTION pg_temp.t297_report(p_call INTEGER, p_pos INTEGER, p_result TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_svc(format('SELECT platform.telephony_recording_report_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.t297_id(p_org), pg_temp.t297_leg_id(p_call, p_pos), p_result))
$$;
-- The list for a lead (fixture number) and an array of call numbers, as an actor.
CREATE FUNCTION pg_temp.t297_list(p_actor INTEGER, p_lead INTEGER, p_calls INTEGER[], p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t297_as(p_actor, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, %L::UUID[])',
    pg_temp.t297_id(p_org), pg_temp.t297_id(5000 + p_lead),
    (SELECT array_agg(pg_temp.t297_id(7000 + k)) FROM unnest(p_calls) k)))
$$;
-- The call numbers of a list answer, in the order the answer gives them.
CREATE FUNCTION pg_temp.t297_order(p_list JSONB) RETURNS INTEGER[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((substr(c ->> 'callId', 25)::INTEGER - 7000) ORDER BY ord), ARRAY[]::INTEGER[])
  FROM jsonb_array_elements(p_list -> 'calls') WITH ORDINALITY AS t(c, ord)
$$;
-- The row of a call in a list answer.
CREATE FUNCTION pg_temp.t297_row(p_list JSONB, p_call INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT c FROM jsonb_array_elements(p_list -> 'calls') c WHERE c ->> 'callId' = pg_temp.t297_id(7000 + p_call)::TEXT
$$;

-- ---------------------------------------------------------------------------
-- Clients, leads, calls, legs.
--   client 1: lead 1 (owner manager A, department A) — the lead under test — and lead 3
--             (owner manager A2): the same client's call on lead 3 must not show on lead 1
--   client 2: lead 2 (owner manager B, department B)
--   org 2: client 10, lead 10
-- ---------------------------------------------------------------------------
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state) VALUES
  (pg_temp.t297_id(4001), pg_temp.t297_id(1), 'T297 Client One', platform_private.normalize_person_name('T297 Client One'),
    '+996700000001', platform_private.normalize_person_phone('+996700000001'), 'active'),
  (pg_temp.t297_id(4002), pg_temp.t297_id(1), 'T297 Client Two', platform_private.normalize_person_name('T297 Client Two'),
    '+996700000002', platform_private.normalize_person_phone('+996700000002'), 'active'),
  (pg_temp.t297_id(4010), pg_temp.t297_id(2), 'T297 Client Ten', platform_private.normalize_person_name('T297 Client Ten'),
    '+996700000010', platform_private.normalize_person_phone('+996700000010'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state) VALUES
  (pg_temp.t297_id(5001), pg_temp.t297_id(1), pg_temp.t297_id(4001), pg_temp.t297_id(302), 'new', 'website', 'open'),
  (pg_temp.t297_id(5002), pg_temp.t297_id(1), pg_temp.t297_id(4002), pg_temp.t297_id(304), 'new', 'website', 'open'),
  (pg_temp.t297_id(5003), pg_temp.t297_id(1), pg_temp.t297_id(4001), pg_temp.t297_id(303), 'new', 'website', 'open'),
  (pg_temp.t297_id(5010), pg_temp.t297_id(2), pg_temp.t297_id(4010), pg_temp.t297_id(309), 'new', 'website', 'open');

-- A call (fixture number) of a client and a lead, started p_age ago.
CREATE FUNCTION pg_temp.t297_mk(p_k INTEGER, p_client INTEGER, p_lead INTEGER, p_age INTERVAL, p_org INTEGER DEFAULT 1,
  p_phone TEXT DEFAULT '+996700000001') RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - p_age;
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, talk_seconds, client_phone, client_id, lead_id, match_state, created_via)
  VALUES (pg_temp.t297_id(7000 + p_k), pg_temp.t297_id(p_org), 't297-call-' || p_k, 'in', 'ended', 'answered', 'webhook',
    v_start, v_start + INTERVAL '5 seconds', v_start + INTERVAL '3 minutes', v_start + INTERVAL '4 minutes', 60, p_phone,
    pg_temp.t297_id(4000 + p_client), CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t297_id(5000 + p_lead) END,
    'matched', 'webhook');
END
$$;
-- A leg (call number, position, member or NULL, recording state). A recording that is available or
-- temporarily unavailable carries a fictional link; expired or none carries none. The call-level state
-- follows the legs, as the real writers keep it.
CREATE FUNCTION pg_temp.t297_leg(p_call INTEGER, p_pos INTEGER, p_member INTEGER, p_rec TEXT, p_org INTEGER DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_at TIMESTAMPTZ;
BEGIN
  SELECT c.started_at INTO v_at FROM platform_private.telephony_calls c
    WHERE c.organization_id = pg_temp.t297_id(p_org) AND c.id = pg_temp.t297_id(7000 + p_call);
  INSERT INTO platform_private.telephony_call_legs(id, organization_id, call_id, pbx_user, membership_id, state, status,
    leg_started_at, leg_start_source, accepted_at, recording_link, recording_state)
  VALUES (pg_temp.t297_leg_id(p_call, p_pos), pg_temp.t297_id(p_org), pg_temp.t297_id(7000 + p_call),
    CASE WHEN p_member IS NULL THEN '' ELSE 'u96' || p_member END,
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t297_id(300 + p_member) END,
    CASE WHEN p_rec = 'none' AND p_pos = 1 AND p_member IS NOT NULL THEN 'missed' ELSE 'completed' END, 'success',
    v_at + (p_pos || ' seconds')::INTERVAL, 'history', v_at + INTERVAL '5 seconds',
    CASE WHEN p_rec IN ('available', 'unavailable')
      THEN 'https://example.invalid/t297-secret-recording-' || p_call || '-' || p_pos || '.mp3' END,
    p_rec);
  UPDATE platform_private.telephony_calls c SET recording_state = (
    SELECT CASE WHEN bool_or(l.recording_state = 'available') THEN 'available'
        WHEN bool_or(l.recording_state = 'unavailable') THEN 'unavailable'
        WHEN bool_or(l.recording_state = 'expired') THEN 'expired' ELSE 'none' END
      FROM platform_private.telephony_call_legs l WHERE l.organization_id = c.organization_id AND l.call_id = c.id)
    WHERE c.organization_id = pg_temp.t297_id(p_org) AND c.id = pg_temp.t297_id(7000 + p_call);
END
$$;

-- Calls of lead 1 / client 1 (newest first by age):
--   1   2 h     one leg, manager A, available
--   2   3 h     two legs: A rang and missed (no recording), A2 talked (available)
--   3   4 h     transfer: two legs with recordings, A (available) and A2 (available)
--   4   5 h     one leg, manager A, expired
--   5   6 h     one leg, manager A2, unavailable
--   6   7 h     one leg, manager A, no recording
--   11  1 day   no lead yet (client 1), one leg manager A, available
--   7   10 days one leg, manager A, available (young: the 404 counter path)
--   9   359 d 23 h 59 min  one leg, manager A, available (just under the 360-day rule)
--   10  360 days           one leg, manager A, available (exactly the 360-day rule)
--   8   400 days one leg, manager A, available (old)
--   14  400 days two legs, A and A2, both available (old; the call-level summary)
-- Elsewhere: 12 = client 2 / lead 2 (manager B, available); 13 = client 1 / lead 3 (A2, available); 20 = org 2.
SELECT pg_temp.t297_mk(1, 1, 1, INTERVAL '2 hours');
SELECT pg_temp.t297_leg(1, 1, 2, 'available');
SELECT pg_temp.t297_mk(2, 1, 1, INTERVAL '3 hours');
SELECT pg_temp.t297_leg(2, 1, 2, 'none');
SELECT pg_temp.t297_leg(2, 2, 3, 'available');
SELECT pg_temp.t297_mk(3, 1, 1, INTERVAL '4 hours');
SELECT pg_temp.t297_leg(3, 1, 2, 'available');
SELECT pg_temp.t297_leg(3, 2, 3, 'available');
SELECT pg_temp.t297_mk(4, 1, 1, INTERVAL '5 hours');
SELECT pg_temp.t297_leg(4, 1, 2, 'expired');
SELECT pg_temp.t297_mk(5, 1, 1, INTERVAL '6 hours');
SELECT pg_temp.t297_leg(5, 1, 3, 'unavailable');
SELECT pg_temp.t297_mk(6, 1, 1, INTERVAL '7 hours');
SELECT pg_temp.t297_leg(6, 1, 2, 'none');
SELECT pg_temp.t297_mk(11, 1, NULL, INTERVAL '1 day');
SELECT pg_temp.t297_leg(11, 1, 2, 'available');
SELECT pg_temp.t297_mk(7, 1, 1, INTERVAL '10 days');
SELECT pg_temp.t297_leg(7, 1, 2, 'available');
SELECT pg_temp.t297_mk(9, 1, 1, INTERVAL '359 days 23 hours 59 minutes');
SELECT pg_temp.t297_leg(9, 1, 2, 'available');
SELECT pg_temp.t297_mk(10, 1, 1, INTERVAL '360 days');
SELECT pg_temp.t297_leg(10, 1, 2, 'available');
SELECT pg_temp.t297_mk(8, 1, 1, INTERVAL '400 days');
SELECT pg_temp.t297_leg(8, 1, 2, 'available');
SELECT pg_temp.t297_mk(14, 1, 1, INTERVAL '401 days');
SELECT pg_temp.t297_leg(14, 1, 2, 'available');
SELECT pg_temp.t297_leg(14, 2, 3, 'available');
SELECT pg_temp.t297_mk(12, 2, 2, INTERVAL '1 hour', 1, '+996700000002');
SELECT pg_temp.t297_leg(12, 1, 4, 'available');
SELECT pg_temp.t297_mk(13, 1, 3, INTERVAL '30 minutes');
SELECT pg_temp.t297_leg(13, 1, 3, 'available');
SELECT pg_temp.t297_mk(20, 10, 10, INTERVAL '1 hour', 2, '+996700000010');
SELECT pg_temp.t297_leg(20, 1, 9, 'available', 2);
SELECT pg_temp.t297_assert((SELECT count(*) FROM platform_private.telephony_calls) = 15, 'sanity: the fixture holds 15 calls');
SELECT pg_temp.t297_assert((SELECT count(*) FROM platform_private.telephony_call_legs) = 18, 'sanity: the fixture holds 18 legs');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('telephony_recording_grant_v1', 'telephony_recording_consume_v1',
      'telephony_recording_report_v1', 'telephony_lead_recordings_v1')),
  'the four public functions are owner-owned SECURITY DEFINER with an empty search_path');
SELECT pg_temp.t297_assert(
  (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_recording_grant_v1(uuid,uuid)'::regprocedure) = 'v'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)'::regprocedure) = 'v'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_recording_report_v1(uuid,uuid,text)'::regprocedure) = 'v'
  AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])'::regprocedure) = 's',
  'grant, consume and report are VOLATILE, the list is STABLE');
SELECT pg_temp.t297_assert(
  has_function_privilege('authenticated', 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_recording_grant_v1(uuid,uuid)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])', 'EXECUTE')) = 0,
  'grant and list are executable by authenticated only');
SELECT pg_temp.t297_assert(
  has_function_privilege('service_role', 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_recording_consume_v1(uuid,uuid,uuid)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform.telephony_recording_report_v1(uuid,uuid,text)', 'EXECUTE')) = 0,
  'consume and report are executable by service_role only');
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform_private.telephony_recording_scope(uuid,uuid,uuid)', 'EXECUTE')) = 0
  AND NOT has_function_privilege('public', 'platform_private.telephony_recording_scope(uuid,uuid,uuid)', 'EXECUTE'),
  'the scope helper is closed to PUBLIC and every client role');
SELECT pg_temp.t297_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_claim_work_v1', 'telephony_erase_person_v1', 'telephony_extension_map_v1', 'telephony_integration_health_v1',
    'telephony_lead_calls_v1', 'telephony_lead_recordings_v1', 'telephony_maintenance_plan_v1', 'telephony_manage_overview_v1',
    'telephony_project_work_v1', 'telephony_purge_evidence_v1', 'telephony_receive_v1', 'telephony_reconcile_apply_v1',
    'telephony_recording_consume_v1', 'telephony_recording_grant_v1', 'telephony_recording_report_v1',
    'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settings_save_v1', 'telephony_settle_calls_v1',
    'telephony_sync_extensions_v1'],
  'platform holds the sixteen earlier public telephony functions (T1b four, T4a five, T11a two, T5 two, T4b three) and exactly these four new ones');
SELECT pg_temp.t297_assert('telephony.recording.listen' = ANY (platform_private.p7a_safe_audit_actions())
  AND 'telephony_call' = ANY (platform_private.p7a_safe_audit_resource_types()),
  'the journal allowlist (T2) already knows telephony.recording.listen and telephony_call');
SELECT pg_temp.t297_assert(
  pg_temp.t297_call('authenticated', (SELECT c.claims FROM t297_claims c WHERE c.n = 1),
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_recording_grants') ->> 'error' LIKE '42501:%'
  AND pg_temp.t297_call('service_role', '{"role":"service_role"}',
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_recording_grants') ->> 'error' LIKE '42501:%'
  AND pg_temp.t297_call('service_role', '{"role":"service_role"}',
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_call_legs') ->> 'error' LIKE '42501:%',
  'the grants and the legs (the only table that holds a link) stay closed to authenticated and service_role');
-- The database role service_role WITHOUT the service claim is refused inside the functions too.
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_call('service_role', '{"role":"authenticated"}', format(
    'SELECT platform.telephony_recording_consume_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(9999), pg_temp.t297_id(302)))) = '42501'
  AND pg_temp.t297_call('service_role', '{"role":"authenticated"}', format(
    'SELECT platform.telephony_recording_consume_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(9999), pg_temp.t297_id(302))) ->> 'error' = '42501:Service role is required'
  AND pg_temp.t297_call('service_role', '', format(
    'SELECT platform.telephony_recording_report_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.t297_id(1), pg_temp.t297_leg_id(1), 'ok')) ->> 'error' = '42501:Service role is required',
  'the role check is inside consume and report: service_role without the service claim is refused');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_recording_consume_v1(%L::UUID, %L::UUID, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(9999), pg_temp.t297_id(301)))) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_recording_report_v1(%L::UUID, %L::UUID, %L)',
    pg_temp.t297_id(1), pg_temp.t297_leg_id(1), 'ok'))) = '42501',
  'an authenticated Admin cannot call consume or report (no EXECUTE)');

-- ---------------------------------------------------------------------------
-- 2. The switch: no settings row, then ui_enabled = false.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_settings), 'sanity: no settings row exists');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_grant(1, 1)) = '42501' AND pg_temp.t297_code(pg_temp.t297_grant(2, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(5, 1)) = '42501'
  AND pg_temp.t297_grant(1, 1) ->> 'error' = '42501:telephony_recording_forbidden',
  'without a settings row everyone, the Admin and the supervisor included, is refused with one text');
SELECT pg_temp.t297_assert(
  pg_temp.t297_list(1, 1, ARRAY[1, 2]) = '{"enabled": false, "calls": []}'::JSONB
  AND pg_temp.t297_list(2, 1, ARRAY[1, 2]) = '{"enabled": false, "calls": []}'::JSONB,
  'without a settings row the list shows nothing even though recordings exist');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t297_id(1));
SELECT pg_temp.t297_assert(
  (SELECT NOT ui_enabled FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t297_id(1))
  AND pg_temp.t297_code(pg_temp.t297_grant(1, 1)) = '42501' AND pg_temp.t297_code(pg_temp.t297_grant(2, 1)) = '42501'
  AND pg_temp.t297_list(1, 1, ARRAY[1, 2]) = '{"enabled": false, "calls": []}'::JSONB,
  'with ui_enabled = false (the default row) the grant refuses and the list shows nothing');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_list(4, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(7, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(8, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(9, 1, ARRAY[1])) = '42501',
  'switch off: authority comes first — manager B (other department), a Student, a member without roles and another organization are refused by the list');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t297_id(1);
-- Organization 2 has its own settings row (its own switch).
INSERT INTO platform_private.telephony_settings(organization_id, ui_enabled) VALUES (pg_temp.t297_id(2), TRUE);

-- ---------------------------------------------------------------------------
-- 3. The list (state untouched so far).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t297_all(f JSONB);
INSERT INTO t297_all SELECT pg_temp.t297_list(1, 1, ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20]);
SELECT pg_temp.t297_assert((SELECT f ->> 'enabled' = 'true' FROM t297_all)
  AND pg_temp.t297_order((SELECT f FROM t297_all)) = ARRAY[1, 2, 3, 4, 5, 11, 7, 9, 10, 8, 14],
  'the Admin reads the recordings of lead 1 and of its client''s call without a lead, newest first: '
    || pg_temp.t297_order((SELECT f FROM t297_all))::TEXT);
SELECT pg_temp.t297_assert(NOT (pg_temp.t297_order((SELECT f FROM t297_all)) && ARRAY[6, 12, 13, 20]),
  'a call with no recording, another client''s call, the same client''s other lead and another organization do not leak in');
SELECT pg_temp.t297_assert(
  (SELECT bool_and((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(c) k) = ARRAY['callId', 'canListen', 'legs'])
    FROM jsonb_array_elements((SELECT f FROM t297_all) -> 'calls') c)
  AND (SELECT bool_and((SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(l) k) = ARRAY['legId', 'state'])
    FROM jsonb_array_elements((SELECT f FROM t297_all) -> 'calls') c, jsonb_array_elements(c -> 'legs') l)
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys((SELECT f FROM t297_all)) k) = ARRAY['calls', 'enabled'],
  'the answer, every call and every leg carry exactly the documented keys');
SELECT pg_temp.t297_assert(
  (SELECT f::TEXT NOT LIKE '%https%' AND f::TEXT NOT LIKE '%example.invalid%' AND f::TEXT NOT LIKE '%secret%'
      AND f::TEXT NOT LIKE '%recording_link%' AND f::TEXT NOT LIKE '%.mp3%' AND f::TEXT NOT LIKE '%700000001%'
      AND f::TEXT NOT LIKE '%T297 Actor%' AND f::TEXT NOT LIKE '%@%'
    FROM t297_all),
  'no link, https text, file name, number, name or e-mail anywhere in the list');
SELECT pg_temp.t297_assert(
  jsonb_array_length(pg_temp.t297_row((SELECT f FROM t297_all), 2) -> 'legs') = 1
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 2) -> 'legs' -> 0 ->> 'legId') = pg_temp.t297_leg_id(2, 2)::TEXT
  AND jsonb_array_length(pg_temp.t297_row((SELECT f FROM t297_all), 3) -> 'legs') = 2
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 3) -> 'legs' -> 0 ->> 'legId') = pg_temp.t297_leg_id(3, 1)::TEXT
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 3) -> 'legs' -> 1 ->> 'legId') = pg_temp.t297_leg_id(3, 2)::TEXT
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 4) -> 'legs' -> 0 ->> 'state') = 'expired'
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 5) -> 'legs' -> 0 ->> 'state') = 'unavailable'
  AND (pg_temp.t297_row((SELECT f FROM t297_all), 1) -> 'legs' -> 0 ->> 'state') = 'available',
  'legs are only those with a recording, in leg order, with their id and state (available, unavailable, expired)');
SELECT pg_temp.t297_assert(
  (pg_temp.t297_row(pg_temp.t297_list(1, 1, ARRAY[1, 2, 3, 4, 5, 11, 7, 9, 10, 8, 14]), 1) ->> 'canListen') = 'true'
  AND (SELECT bool_and((c ->> 'canListen')::BOOLEAN) FROM jsonb_array_elements((SELECT f FROM t297_all) -> 'calls') c)
  AND (SELECT bool_and((c ->> 'canListen')::BOOLEAN) FROM jsonb_array_elements(pg_temp.t297_list(5, 1, ARRAY[1, 2, 3, 4, 5, 11, 7, 8, 14]) -> 'calls') c),
  'the Admin and the supervisor (listen.all) may listen to every recording');
-- Manager A is on a leg of 1, 2 (a leg that only rang), 3, 4, 7, 8, 9, 10, 11, 14; not on 5.
CREATE TEMP TABLE t297_mgr_a(f JSONB);
INSERT INTO t297_mgr_a SELECT pg_temp.t297_list(2, 1, ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20]);
SELECT pg_temp.t297_assert(
  pg_temp.t297_order((SELECT f FROM t297_mgr_a)) = ARRAY[1, 2, 3, 4, 5, 11, 7, 9, 10, 8, 14]
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a), 1) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a), 2) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a), 3) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a), 11) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a), 5) ->> 'canListen') = 'false',
  'manager A may listen to a call he is on a leg of — also the call where his leg only rang (2) — and not to call 5');
CREATE TEMP TABLE t297_mgr_a2(f JSONB);
INSERT INTO t297_mgr_a2 SELECT pg_temp.t297_list(3, 1, ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 20]);
SELECT pg_temp.t297_assert(
  (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 1) ->> 'canListen') = 'false'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 2) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 3) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 5) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 14) ->> 'canListen') = 'true'
  AND (pg_temp.t297_row((SELECT f FROM t297_mgr_a2), 7) ->> 'canListen') = 'false',
  'manager A2 may listen only to the calls he is on (2, 3, 5, 14), not to the others');
SELECT pg_temp.t297_assert(
  pg_temp.t297_order(pg_temp.t297_list(6, 1, ARRAY[1, 2, 3, 4, 5, 11, 7, 8, 9, 10, 14])) = ARRAY[1, 2, 3, 4, 5, 11, 7, 9, 10, 8, 14]
  AND (SELECT bool_and(NOT (c ->> 'canListen')::BOOLEAN)
    FROM jsonb_array_elements(pg_temp.t297_list(6, 1, ARRAY[1, 2, 3, 4, 5, 11, 7, 8, 9, 10, 14]) -> 'calls') c),
  'a plain lead reader (no telephony right) sees that recordings exist and may listen to none');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_list(4, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(2, 2, ARRAY[12])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(7, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(8, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(9, 1, ARRAY[1])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(1, 10, ARRAY[20])) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_list(9, 10, ARRAY[20], 2)) = 'ok',
  'visibility follows lead.read: manager B cannot read lead 1, manager A cannot read lead 2, a Student, a member without roles, another organization and a lead of another organization are refused');
SELECT pg_temp.t297_assert(
  pg_temp.t297_order(pg_temp.t297_list(4, 2, ARRAY[12, 1])) = ARRAY[12]
  AND pg_temp.t297_order(pg_temp.t297_list(3, 3, ARRAY[13, 11, 1])) = ARRAY[13, 11]
  AND pg_temp.t297_order(pg_temp.t297_list(1, 1, ARRAY[3, 1])) = ARRAY[1, 3]
  AND pg_temp.t297_order(pg_temp.t297_list(1, 1, ARRAY[1, 1, 1])) = ARRAY[1]
  AND pg_temp.t297_order(pg_temp.t297_list(9, 10, ARRAY[20, 1], 2)) = ARRAY[20],
  'only the requested calls that belong to the lead (or to its client without a lead) come back; duplicates collapse; lead 3 shows its own call and the client''s call from before any lead');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, ARRAY[]::UUID[])',
    pg_temp.t297_id(1), pg_temp.t297_id(5001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, NULL::UUID[])',
    pg_temp.t297_id(1), pg_temp.t297_id(5001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, ARRAY[%L::UUID, NULL])',
    pg_temp.t297_id(1), pg_temp.t297_id(5001), pg_temp.t297_id(7001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101)))',
    pg_temp.t297_id(1), pg_temp.t297_id(5001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, %L::UUID, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 100)))',
    pg_temp.t297_id(1), pg_temp.t297_id(5001)))) = 'ok'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(NULL::UUID, %L::UUID, ARRAY[%L::UUID])',
    pg_temp.t297_id(5001), pg_temp.t297_id(7001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, NULL::UUID, ARRAY[%L::UUID])',
    pg_temp.t297_id(1), pg_temp.t297_id(7001)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_lead_recordings_v1(%L::UUID, gen_random_uuid(), ARRAY[%L::UUID])',
    pg_temp.t297_id(1), pg_temp.t297_id(7001)))) = '42501',
  'an empty, NULL, NULL-element or over-100 array and NULL ids are refused with 22023; 100 ids pass; an unknown lead is refused like an unreadable one');
SELECT pg_temp.t297_assert(pg_temp.t297_list(2, 1, ARRAY[1, 2, 3]) = pg_temp.t297_list(2, 1, ARRAY[1, 2, 3]),
  'the list is repeatable (STABLE, no side effect)');

-- ---------------------------------------------------------------------------
-- 4. The grant: the rights matrix and the state of the recording.
-- ---------------------------------------------------------------------------
SELECT count(*) AS t297_audit_0 FROM platform.audit_events WHERE action = 'telephony.recording.listen' \gset
SELECT pg_temp.t297_assert(:t297_audit_0 = 0, 'sanity: no listening is journaled yet');
SELECT pg_temp.t297_grant(1, 1) AS t297_g_admin \gset
SELECT pg_temp.t297_grant(5, 1) AS t297_g_sup \gset
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a \gset
SELECT pg_temp.t297_assert(
  :'t297_g_admin'::JSONB ->> 'status' = 'issued' AND :'t297_g_admin'::JSONB ->> 'scope' = 'all'
  AND :'t297_g_sup'::JSONB ->> 'status' = 'issued' AND :'t297_g_sup'::JSONB ->> 'scope' = 'all'
  AND :'t297_g_a'::JSONB ->> 'status' = 'issued' AND :'t297_g_a'::JSONB ->> 'scope' = 'own',
  'the Admin and the supervisor (all) and manager A on his own call (own) are granted');
SELECT pg_temp.t297_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(:'t297_g_a'::JSONB) k) = ARRAY['expiresAt', 'grantId', 'scope', 'status']
  AND :'t297_g_a'::JSONB::TEXT NOT LIKE '%https%' AND :'t297_g_a'::JSONB::TEXT NOT LIKE '%example.invalid%'
  AND :'t297_g_a'::JSONB::TEXT NOT LIKE '%mp3%',
  'the grant answer is exactly status, grantId, expiresAt, scope — no link');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_grant(3, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(4, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(6, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(7, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(8, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(9, 1)) = '42501',
  'manager A2 (not on the call), manager B, a plain lead reader, a Student, a member without roles and another organization are refused with 42501');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_grant(2, 2, 2)) = 'ok' AND pg_temp.t297_grant(2, 2, 2) ->> 'scope' = 'own'
  AND pg_temp.t297_code(pg_temp.t297_grant(3, 2, 2)) = 'ok'
  AND pg_temp.t297_code(pg_temp.t297_grant(2, 3, 1)) = 'ok' AND pg_temp.t297_code(pg_temp.t297_grant(2, 3, 2)) = 'ok'
  AND pg_temp.t297_code(pg_temp.t297_grant(3, 3, 1)) = 'ok' AND pg_temp.t297_code(pg_temp.t297_grant(3, 3, 2)) = 'ok',
  'a manager whose leg only rang (call 2) may listen to the recording another leg made; both legs of a transfer are open to both managers');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_grant(2, 5, 1)) = '42501'
  AND pg_temp.t297_code(pg_temp.t297_grant(3, 5, 1)) = 'P0002'
  AND pg_temp.t297_grant(3, 5, 1) ->> 'error' = 'P0002:telephony_recording_unavailable'
  AND pg_temp.t297_grant(1, 5, 1) ->> 'error' = 'P0002:telephony_recording_unavailable',
  'an unavailable recording is P0002 telephony_recording_unavailable — and 42501 to a manager who is not on the call');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(2, 4, 1) ->> 'error' = 'PT410:telephony_recording_expired'
  AND pg_temp.t297_grant(1, 4, 1) ->> 'error' = 'PT410:telephony_recording_expired'
  AND pg_temp.t297_grant(5, 4, 1) ->> 'error' = 'PT410:telephony_recording_expired'
  AND pg_temp.t297_code(pg_temp.t297_grant(3, 4, 1)) = '42501',
  'an expired recording is PT410 to the Admin, the supervisor and a manager on the call, and 42501 to a manager who is not');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(1, 6, 1) ->> 'error' = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_grant(2, 6, 1) ->> 'error' = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_grant(1, 2, 1) ->> 'error' = 'P0002:telephony_recording_not_found',
  'a leg with no recording (a leg that only rang too) is P0002 telephony_recording_not_found');
-- No existence leak: an unknown leg looks like «not allowed» to everyone who may not listen to everything.
SELECT pg_temp.t297_assert(
  pg_temp.t297_as(1, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(1))) ->> 'error'
    = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_as(5, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(1))) ->> 'error'
    = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_as(2, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(1))) ->> 'error'
    = '42501:telephony_recording_forbidden'
  AND pg_temp.t297_as(6, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(1))) ->> 'error'
    = '42501:telephony_recording_forbidden'
  AND pg_temp.t297_grant(2, 12, 1) ->> 'error' = '42501:telephony_recording_forbidden'
  AND pg_temp.t297_as(2, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(1))) ->> 'error'
    = pg_temp.t297_grant(2, 12, 1) ->> 'error',
  'an unknown leg is P0002 only to a listen.all holder; a manager gets the same 42501 text for an unknown leg and for a foreign one');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(9, 20, 1, 2) ->> 'status' = 'issued'
  AND pg_temp.t297_grant(9, 1, 1, 2) ->> 'error' = pg_temp.t297_as(9, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, gen_random_uuid())', pg_temp.t297_id(2))) ->> 'error'
  AND pg_temp.t297_code(pg_temp.t297_grant(1, 20, 1, 2)) = '42501',
  'another organization''s Admin listens to its own tenant''s recording and asking for an organization-1 leg is answered like an unknown leg; organization 1''s Admin is no member of organization 2');
SELECT pg_temp.t297_assert(
  pg_temp.t297_code(pg_temp.t297_as(1, 'SELECT platform.telephony_recording_grant_v1(NULL::UUID, gen_random_uuid())')) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_as(1, format('SELECT platform.telephony_recording_grant_v1(%L::UUID, NULL::UUID)', pg_temp.t297_id(1)))) = '22023',
  'NULL arguments are refused with 22023');
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.recording.listen')
    = (SELECT count(*) FROM platform_private.telephony_recording_grants),
  'one journal row per grant ever issued and none for any refusal');

-- ---------------------------------------------------------------------------
-- 5. The grant: lifetime, reuse, expiry, exhaustion, the journal and the hourly limit.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert(
  (SELECT abs(extract(epoch FROM (g.expires_at - g.granted_at)) - 900) < 0.001 AND g.max_uses = 40 AND g.use_count = 0
      AND g.last_used_at IS NULL AND g.membership_id = pg_temp.t297_id(302) AND g.leg_id = pg_temp.t297_leg_id(1)
      AND g.organization_id = pg_temp.t297_id(1)
    FROM platform_private.telephony_recording_grants g WHERE g.id = (:'t297_g_a'::JSONB ->> 'grantId')::UUID),
  'a grant lasts 15 minutes, allows 40 uses, is for that employee and that leg');
SELECT count(*) AS t297_audit_1 FROM platform.audit_events WHERE action = 'telephony.recording.listen' \gset
SELECT count(*) AS t297_grants_1 FROM platform_private.telephony_recording_grants \gset
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a2 \gset
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a3 \gset
SELECT pg_temp.t297_assert(
  :'t297_g_a2'::JSONB ->> 'status' = 'reused' AND :'t297_g_a2'::JSONB ->> 'grantId' = :'t297_g_a'::JSONB ->> 'grantId'
  AND :'t297_g_a3'::JSONB ->> 'status' = 'reused' AND :'t297_g_a3'::JSONB ->> 'grantId' = :'t297_g_a'::JSONB ->> 'grantId'
  AND :'t297_g_a2'::JSONB ->> 'expiresAt' = :'t297_g_a'::JSONB ->> 'expiresAt'
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.recording.listen') = :t297_audit_1
  AND (SELECT count(*) FROM platform_private.telephony_recording_grants) = :t297_grants_1,
  'asking again while the grant is valid returns the same grant (same id and expiry) and writes no journal row (Range requests do not multiply the journal)');
SELECT pg_temp.t297_assert(
  :'t297_g_admin'::JSONB ->> 'grantId' <> :'t297_g_a'::JSONB ->> 'grantId'
  AND :'t297_g_sup'::JSONB ->> 'grantId' <> :'t297_g_admin'::JSONB ->> 'grantId'
  AND (SELECT count(DISTINCT g.membership_id) FROM platform_private.telephony_recording_grants g
    WHERE g.leg_id = pg_temp.t297_leg_id(1)) = 3,
  'a grant is per employee and per leg: the Admin, the supervisor and manager A each have their own for the same leg');
-- The journal row of a new grant.
SELECT pg_temp.t297_assert(
  (SELECT e.resource_type = 'telephony_call' AND e.resource_id = pg_temp.t297_id(7001) AND e.actor_kind = 'user'
      AND e.actor_principal = 'auth:' || pg_temp.t297_id(102)::TEXT AND e.actor_membership_id = pg_temp.t297_id(302)
      AND e.actor_profile_id = pg_temp.t297_id(202) AND e.organization_id = pg_temp.t297_id(1)
      AND e.before_state = '{}'::JSONB AND btrim(e.reason) <> ''
      AND e.after_state ->> 'legId' = pg_temp.t297_leg_id(1)::TEXT AND e.after_state ->> 'scope' = 'own'
      AND e.after_state ->> 'direction' = 'in' AND e.after_state ->> 'grantId' = :'t297_g_a'::JSONB ->> 'grantId'
      AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(e.after_state) k) = ARRAY['direction', 'grantId', 'legId', 'scope']
    FROM platform.audit_events e WHERE e.action = 'telephony.recording.listen' AND e.actor_membership_id = pg_temp.t297_id(302)
      AND e.resource_id = pg_temp.t297_id(7001)),
  'the journal row names who (membership), which call (telephony_call), the leg, the grant, the scope and the direction — and nothing else');
SELECT pg_temp.t297_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.action = 'telephony.recording.listen'
    AND (to_jsonb(e)::TEXT LIKE '%70000000%' OR to_jsonb(e)::TEXT LIKE '%T297 Actor%' OR to_jsonb(e)::TEXT LIKE '%T297 Client%'
      OR to_jsonb(e)::TEXT LIKE '%https%' OR to_jsonb(e)::TEXT LIKE '%example.invalid%' OR to_jsonb(e)::TEXT LIKE '%.mp3%')),
  'no journal row of listening holds a number, a name or a link');
-- Expiry: a grant past its time is replaced by a new one (and journaled once).
UPDATE platform_private.telephony_recording_grants SET granted_at = clock_timestamp() - INTERVAL '20 minutes',
  expires_at = clock_timestamp() - INTERVAL '5 minutes' WHERE id = (:'t297_g_a'::JSONB ->> 'grantId')::UUID;
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a4 \gset
SELECT pg_temp.t297_assert(
  :'t297_g_a4'::JSONB ->> 'status' = 'issued' AND :'t297_g_a4'::JSONB ->> 'grantId' <> :'t297_g_a'::JSONB ->> 'grantId'
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.recording.listen') = :t297_audit_1 + 1,
  'after the 15 minutes a new grant is issued and the journal gets one new row');
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a5 \gset
SELECT pg_temp.t297_assert(:'t297_g_a5'::JSONB ->> 'status' = 'reused' AND :'t297_g_a5'::JSONB ->> 'grantId' = :'t297_g_a4'::JSONB ->> 'grantId',
  'the new grant is reused in turn');
-- Exhaustion: a grant with all 40 uses spent is replaced.
UPDATE platform_private.telephony_recording_grants SET use_count = max_uses, last_used_at = clock_timestamp()
  WHERE id = (:'t297_g_a4'::JSONB ->> 'grantId')::UUID;
SELECT pg_temp.t297_grant(2, 1) AS t297_g_a6 \gset
SELECT pg_temp.t297_assert(:'t297_g_a6'::JSONB ->> 'status' = 'issued' AND :'t297_g_a6'::JSONB ->> 'grantId' <> :'t297_g_a4'::JSONB ->> 'grantId'
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.recording.listen') = :t297_audit_1 + 2,
  'a grant with its 40 uses spent is replaced by a new one (one more journal row)');
-- Reuse never crosses employees: another employee''s valid grant is not handed out.
SELECT pg_temp.t297_assert(
  (SELECT g.membership_id FROM platform_private.telephony_recording_grants g WHERE g.id = (:'t297_g_a6'::JSONB ->> 'grantId')::UUID) = pg_temp.t297_id(302)
  AND (SELECT g.membership_id FROM platform_private.telephony_recording_grants g WHERE g.id = (:'t297_g_admin'::JSONB ->> 'grantId')::UUID) = pg_temp.t297_id(301),
  'a returned grant always belongs to the asking employee');

-- The hourly limit: 30 NEW grants an hour per employee; reuse still works; another employee is unaffected.
SELECT count(*) AS t297_a_hour FROM platform_private.telephony_recording_grants
  WHERE membership_id = pg_temp.t297_id(302) AND granted_at > clock_timestamp() - INTERVAL '1 hour' \gset
INSERT INTO platform_private.telephony_recording_grants(organization_id, membership_id, leg_id, granted_at, expires_at, max_uses,
  use_count, last_used_at)
  SELECT pg_temp.t297_id(1), pg_temp.t297_id(302), pg_temp.t297_leg_id(7), clock_timestamp() - INTERVAL '10 minutes',
    clock_timestamp() - INTERVAL '1 minute', 40, 1, clock_timestamp() - INTERVAL '5 minutes'
  FROM generate_series(1, 29 - :t297_a_hour);
SELECT pg_temp.t297_assert((SELECT count(*) FROM platform_private.telephony_recording_grants
    WHERE membership_id = pg_temp.t297_id(302) AND granted_at > clock_timestamp() - INTERVAL '1 hour') = 29,
  'sanity: manager A has 29 grants in the last hour');
SELECT pg_temp.t297_grant(2, 7) AS t297_g_30 \gset
SELECT pg_temp.t297_assert(:'t297_g_30'::JSONB ->> 'status' = 'issued', 'the 30th grant of the hour is issued');
SELECT count(*) AS t297_audit_2 FROM platform.audit_events WHERE action = 'telephony.recording.listen' \gset
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(2, 11) ->> 'error' = 'PT429:telephony_recording_rate_limited'
  AND pg_temp.t297_grant(2, 9) ->> 'error' = 'PT429:telephony_recording_rate_limited'
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.recording.listen') = :t297_audit_2,
  'the 31st new grant is refused PT429 and writes no journal row');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(2, 7) ->> 'status' = 'reused' AND pg_temp.t297_grant(2, 7) ->> 'grantId' = :'t297_g_30'::JSONB ->> 'grantId',
  'while the limit is reached, a leg that already has a valid grant is still served by it');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(3, 5) ->> 'error' = 'P0002:telephony_recording_unavailable'
  AND pg_temp.t297_grant(1, 11) ->> 'status' = 'issued' AND pg_temp.t297_grant(3, 11) ->> 'error' LIKE '42501:%',
  'the limit is per employee: the Admin (and manager A2 on his own rights) are not slowed by manager A');
UPDATE platform_private.telephony_recording_grants SET granted_at = clock_timestamp() - INTERVAL '2 hours',
  expires_at = clock_timestamp() - INTERVAL '105 minutes'
  WHERE membership_id = pg_temp.t297_id(302) AND granted_at > clock_timestamp() - INTERVAL '1 hour'
    AND expires_at < clock_timestamp() AND id <> (:'t297_g_30'::JSONB ->> 'grantId')::UUID;
SELECT pg_temp.t297_assert(pg_temp.t297_grant(2, 11) ->> 'status' = 'issued',
  'once the hour has passed for those grants the limit lets a new one through');

-- ---------------------------------------------------------------------------
-- 6. Consume: the only place the link is read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_grant(2, 1) AS t297_c_grant \gset
SELECT (:'t297_c_grant'::JSONB ->> 'grantId')::UUID AS t297_c_id \gset
SELECT use_count AS t297_c_uses0 FROM platform_private.telephony_recording_grants WHERE id = :'t297_c_id' \gset
SELECT pg_temp.t297_consume(:'t297_c_id', 2) AS t297_c1 \gset
SELECT pg_temp.t297_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(:'t297_c1'::JSONB) k) = ARRAY['callId', 'legId', 'link', 'notFoundCount']
  AND :'t297_c1'::JSONB ->> 'link' = 'https://example.invalid/t297-secret-recording-1-1.mp3'
  AND :'t297_c1'::JSONB ->> 'legId' = pg_temp.t297_leg_id(1)::TEXT AND :'t297_c1'::JSONB ->> 'callId' = pg_temp.t297_id(7001)::TEXT
  AND (:'t297_c1'::JSONB ->> 'notFoundCount')::INTEGER = 0,
  'consume returns exactly callId, legId, link and notFoundCount, with the stored link');
SELECT pg_temp.t297_assert(
  (SELECT g.use_count = :t297_c_uses0 + 1 AND g.last_used_at IS NOT NULL
    FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id'),
  'one consume counts one use and stamps the time');
SELECT pg_temp.t297_consume(:'t297_c_id', 2) AS t297_c2 \gset
SELECT pg_temp.t297_assert(:'t297_c2'::JSONB ->> 'link' = :'t297_c1'::JSONB ->> 'link'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id') = :t297_c_uses0 + 2,
  'a second consume counts a second use');
-- Wrong employee, wrong organization, unknown grant, NULLs: refused, no use counted.
SELECT pg_temp.t297_assert(
  pg_temp.t297_consume(:'t297_c_id', 3) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND pg_temp.t297_consume(:'t297_c_id', 1) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND pg_temp.t297_consume(:'t297_c_id', 9, 2) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND pg_temp.t297_consume(:'t297_c_id', 2, 2) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND pg_temp.t297_consume(pg_temp.t297_id(9999), 2) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_consume_v1(NULL::UUID, %L::UUID, %L::UUID)',
    :'t297_c_id', pg_temp.t297_id(302)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_consume_v1(%L::UUID, NULL::UUID, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(302)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_consume_v1(%L::UUID, %L::UUID, NULL::UUID)',
    pg_temp.t297_id(1), :'t297_c_id'))) = '22023'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id') = :t297_c_uses0 + 2,
  'another employee, the Admin, another organization (either side), an unknown grant and NULLs are refused and count nothing');
-- Expired and exhausted grants.
UPDATE platform_private.telephony_recording_grants SET use_count = 39 WHERE id = :'t297_c_id';
SELECT pg_temp.t297_consume(:'t297_c_id', 2) ->> 'link' IS NOT NULL AS t297_c_40 \gset
SELECT pg_temp.t297_consume(:'t297_c_id', 2) ->> 'error' AS t297_c_41 \gset
SELECT pg_temp.t297_assert(:'t297_c_40'::BOOLEAN
  AND :'t297_c_41' = '42501:telephony_recording_grant_invalid'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id') = 40,
  'the 40th use succeeds and the 41st is refused without exceeding the limit');
SELECT pg_temp.t297_grant(2, 1) AS t297_c_grant2 \gset
SELECT (:'t297_c_grant2'::JSONB ->> 'grantId')::UUID AS t297_c_id2 \gset
SELECT pg_temp.t297_assert(:'t297_c_grant2'::JSONB ->> 'status' = 'issued', 'a fresh grant follows the exhausted one');
UPDATE platform_private.telephony_recording_grants SET granted_at = clock_timestamp() - INTERVAL '20 minutes',
  expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = :'t297_c_id2';
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id2', 2) ->> 'error' = '42501:telephony_recording_grant_invalid'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id2') = 0,
  'an expired grant is refused and counts nothing');
-- The switch closes consume too.
SELECT pg_temp.t297_grant(2, 1) AS t297_c_grant3 \gset
SELECT (:'t297_c_grant3'::JSONB ->> 'grantId')::UUID AS t297_c_id3 \gset
UPDATE platform_private.telephony_settings SET ui_enabled = FALSE WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id3', 2) ->> 'error' = '42501:telephony_recording_forbidden'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id3') = 0
  AND pg_temp.t297_code(pg_temp.t297_grant(2, 1)) = '42501',
  'turning ui_enabled off closes consume and the grant at once, without counting a use');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id3', 2) ->> 'link' IS NOT NULL, 'with the switch back on the same grant works');
-- A leg that stopped being available after the grant: refused, the use is NOT counted (the exception rolls back).
SELECT pg_temp.t297_grant(2, 3, 2) AS t297_c_grant4 \gset
SELECT (:'t297_c_grant4'::JSONB ->> 'grantId')::UUID AS t297_c_id4 \gset
UPDATE platform_private.telephony_call_legs SET recording_link = NULL, recording_state = 'expired'
  WHERE id = pg_temp.t297_leg_id(3, 2);
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id4', 2) ->> 'error' = 'PT410:telephony_recording_expired'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id4') = 0
  AND (SELECT g.last_used_at IS NULL FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id4'),
  'a leg that expired after the grant: consume answers PT410 and the use is not counted');
UPDATE platform_private.telephony_call_legs SET recording_link = 'https://example.invalid/t297-secret-recording-3-2.mp3',
  recording_state = 'unavailable' WHERE id = pg_temp.t297_leg_id(3, 2);
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id4', 2) ->> 'error' = 'P0002:telephony_recording_unavailable'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id4') = 0,
  'an unavailable leg: P0002, no use counted');
UPDATE platform_private.telephony_call_legs SET recording_link = NULL, recording_state = 'none'
  WHERE id = pg_temp.t297_leg_id(3, 2);
SELECT pg_temp.t297_assert(pg_temp.t297_consume(:'t297_c_id4', 2) ->> 'error' = 'P0002:telephony_recording_not_found'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id4') = 0,
  'a leg that lost its recording: P0002 not found, no use counted');
UPDATE platform_private.telephony_call_legs SET recording_link = 'https://example.invalid/t297-secret-recording-3-2.mp3',
  recording_state = 'available' WHERE id = pg_temp.t297_leg_id(3, 2);
SELECT pg_temp.t297_consume(:'t297_c_id4', 2) ->> 'link' AS t297_c4_link \gset
SELECT pg_temp.t297_assert(:'t297_c4_link' = 'https://example.invalid/t297-secret-recording-3-2.mp3'
  AND (SELECT g.use_count FROM platform_private.telephony_recording_grants g WHERE g.id = :'t297_c_id4') = 1,
  'once the leg is available again the same grant works and counts one use');
-- A leg with a not-found counter carries it to the server.
UPDATE platform_private.telephony_call_legs SET not_found_count = 2, first_not_found_at = clock_timestamp() - INTERVAL '1 hour'
  WHERE id = pg_temp.t297_leg_id(3, 2);
SELECT pg_temp.t297_assert((pg_temp.t297_consume(:'t297_c_id4', 2) ->> 'notFoundCount')::INTEGER = 2,
  'consume tells the server how many 404 answers the leg already has');
UPDATE platform_private.telephony_call_legs SET not_found_count = 0, first_not_found_at = NULL WHERE id = pg_temp.t297_leg_id(3, 2);

-- ---------------------------------------------------------------------------
-- 7. Report: the answers of the source.
-- ---------------------------------------------------------------------------
-- 7a. A call younger than 360 days: the link stays, the counter grows, «unavailable» only after
--     three answers over at least six hours.
CREATE TEMP TABLE t297_snapshot AS
  SELECT l.id, md5(row(l.*)::TEXT) AS h FROM platform_private.telephony_call_legs l WHERE l.id <> pg_temp.t297_leg_id(7);
SELECT pg_temp.t297_report(7, 1, 'not_found') AS t297_r1 \gset
SELECT pg_temp.t297_assert(
  :'t297_r1'::JSONB ->> 'state' = 'available' AND (:'t297_r1'::JSONB ->> 'notFoundCount')::INTEGER = 1
  AND (:'t297_r1'::JSONB ->> 'changed')::BOOLEAN
  AND (SELECT l.recording_link = 'https://example.invalid/t297-secret-recording-7-1.mp3' AND l.recording_state = 'available'
      AND l.not_found_count = 1 AND l.first_not_found_at IS NOT NULL
    FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(7))
  AND (SELECT c.recording_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7007)) = 'available',
  'a 404 on a young call keeps the link, stays available and counts once');
SELECT first_not_found_at AS t297_first FROM platform_private.telephony_call_legs WHERE id = pg_temp.t297_leg_id(7) \gset
SELECT pg_temp.t297_report(7, 1, 'not_found') AS t297_r2 \gset
SELECT pg_temp.t297_report(7, 1, 'not_found') AS t297_r3 \gset
SELECT pg_temp.t297_assert(
  :'t297_r2'::JSONB ->> 'state' = 'available' AND (:'t297_r2'::JSONB ->> 'notFoundCount')::INTEGER = 2
  AND :'t297_r3'::JSONB ->> 'state' = 'available' AND (:'t297_r3'::JSONB ->> 'notFoundCount')::INTEGER = 3
  AND (SELECT l.first_not_found_at = :'t297_first'::TIMESTAMPTZ AND l.recording_link IS NOT NULL
    FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(7)),
  'three answers within minutes do not make the recording unavailable and the first-seen time is kept');
UPDATE platform_private.telephony_call_legs SET first_not_found_at = clock_timestamp() - INTERVAL '5 hours 59 minutes'
  WHERE id = pg_temp.t297_leg_id(7);
SELECT pg_temp.t297_assert(pg_temp.t297_report(7, 1, 'not_found') ->> 'state' = 'available',
  'a fourth answer 5 h 59 min after the first is still «available»');
UPDATE platform_private.telephony_call_legs SET first_not_found_at = clock_timestamp() - INTERVAL '6 hours'
  WHERE id = pg_temp.t297_leg_id(7);
SELECT pg_temp.t297_report(7, 1, 'not_found') AS t297_r5 \gset
SELECT pg_temp.t297_assert(
  :'t297_r5'::JSONB ->> 'state' = 'unavailable' AND (:'t297_r5'::JSONB ->> 'notFoundCount')::INTEGER = 5
  AND (SELECT l.recording_state = 'unavailable' AND l.recording_link = 'https://example.invalid/t297-secret-recording-7-1.mp3'
    FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(7))
  AND (SELECT c.recording_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7007)) = 'unavailable',
  'after three answers over six hours the recording is «unavailable» with the link KEPT, and the call follows');
SELECT pg_temp.t297_assert(
  pg_temp.t297_report(7, 1, 'not_found') ->> 'state' = 'unavailable'
  AND NOT (pg_temp.t297_report(7, 1, 'not_found') ->> 'changed')::BOOLEAN
  AND (SELECT l.not_found_count FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(7)) = 5
  AND pg_temp.t297_grant(1, 7) ->> 'error' = 'P0002:telephony_recording_unavailable',
  'an unavailable leg is no longer counted or changed by further answers, and nobody gets a grant for it');
-- 7b. «ok» resets the counter; a clean «ok» writes nothing.
SELECT pg_temp.t297_report(9, 1, 'not_found') AS t297_r9 \gset
SELECT pg_temp.t297_assert(
  :'t297_r9'::JSONB ->> 'state' = 'available' AND (:'t297_r9'::JSONB ->> 'notFoundCount')::INTEGER = 1
  AND (SELECT l.recording_link IS NOT NULL FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(9)),
  'a call 359 days 23 h 59 min old is still young: the link stays');
SELECT updated_at AS t297_upd FROM platform_private.telephony_call_legs WHERE id = pg_temp.t297_leg_id(9) \gset
SELECT pg_temp.t297_report(9, 1, 'ok') AS t297_ok1 \gset
SELECT pg_temp.t297_assert(
  :'t297_ok1'::JSONB ->> 'state' = 'available' AND (:'t297_ok1'::JSONB ->> 'notFoundCount')::INTEGER = 0
  AND (:'t297_ok1'::JSONB ->> 'changed')::BOOLEAN
  AND (SELECT l.not_found_count = 0 AND l.first_not_found_at IS NULL AND l.recording_state = 'available'
    FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(9)),
  '«ok» resets the counter and the first-seen time');
SELECT updated_at AS t297_upd2 FROM platform_private.telephony_call_legs WHERE id = pg_temp.t297_leg_id(9) \gset
SELECT pg_temp.t297_report(9, 1, 'ok') AS t297_ok2 \gset
SELECT pg_temp.t297_assert(NOT (:'t297_ok2'::JSONB ->> 'changed')::BOOLEAN
  AND (SELECT l.updated_at = :'t297_upd2'::TIMESTAMPTZ FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(9)),
  'an «ok» on a clean leg changes and writes nothing');
-- Three answers over six hours are needed, not six hours alone: an old first answer with one repeat is not enough.
UPDATE platform_private.telephony_call_legs SET not_found_count = 1, first_not_found_at = clock_timestamp() - INTERVAL '7 hours'
  WHERE id = pg_temp.t297_leg_id(9);
SELECT pg_temp.t297_report(9, 1, 'not_found') AS t297_r9b \gset
SELECT pg_temp.t297_assert(:'t297_r9b'::JSONB ->> 'state' = 'available' AND (:'t297_r9b'::JSONB ->> 'notFoundCount')::INTEGER = 2,
  'the second answer seven hours after the first is still «available»: three answers are needed');
SELECT pg_temp.t297_report(9, 1, 'not_found') AS t297_r9c \gset
SELECT pg_temp.t297_assert(:'t297_r9c'::JSONB ->> 'state' = 'unavailable' AND (:'t297_r9c'::JSONB ->> 'notFoundCount')::INTEGER = 3
  AND (SELECT l.recording_link IS NOT NULL FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(9)),
  'the third answer over more than six hours makes it «unavailable» with the link kept');
-- 7c. 360 days or more: expired, the link is cleared.
SELECT pg_temp.t297_report(10, 1, 'not_found') AS t297_r10 \gset
SELECT pg_temp.t297_assert(
  :'t297_r10'::JSONB ->> 'state' = 'expired' AND (:'t297_r10'::JSONB ->> 'notFoundCount')::INTEGER = 0
  AND (SELECT l.recording_link IS NULL AND l.recording_state = 'expired' AND l.not_found_count = 0
      AND l.first_not_found_at IS NULL AND l.recording_next_check_at IS NULL
    FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(10))
  AND (SELECT c.recording_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7010)) = 'expired',
  'a 404 on a call of 360 days clears the link, expires the leg and the call');
SELECT pg_temp.t297_assert(
  pg_temp.t297_grant(1, 10) ->> 'error' = 'PT410:telephony_recording_expired'
  AND pg_temp.t297_report(10, 1, 'not_found') ->> 'state' = 'expired'
  AND NOT (pg_temp.t297_report(10, 1, 'not_found') ->> 'changed')::BOOLEAN
  AND pg_temp.t297_report(10, 1, 'ok') ->> 'state' = 'expired',
  'an expired leg stays expired: no grant, and further answers change nothing');
SELECT pg_temp.t297_report(8, 1, 'not_found') AS t297_r8 \gset
SELECT pg_temp.t297_assert(:'t297_r8'::JSONB ->> 'state' = 'expired'
  AND (SELECT l.recording_link IS NULL FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(8)),
  'a 400-day-old call expires on the first 404');
-- 7d. The call-level state follows the legs: one expired leg of two keeps the call available.
SELECT pg_temp.t297_report(14, 1, 'not_found') AS t297_r14a \gset
SELECT pg_temp.t297_assert(:'t297_r14a'::JSONB ->> 'state' = 'expired'
  AND (SELECT c.recording_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7014)) = 'available'
  AND (SELECT l.recording_state FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(14, 2)) = 'available'
  AND (SELECT l.recording_link IS NOT NULL FROM platform_private.telephony_call_legs l WHERE l.id = pg_temp.t297_leg_id(14, 2)),
  'one of two legs expires: the call stays available and the other leg keeps its link');
SELECT pg_temp.t297_report(14, 2, 'not_found') AS t297_r14b \gset
SELECT pg_temp.t297_assert(:'t297_r14b'::JSONB ->> 'state' = 'expired'
  AND (SELECT c.recording_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7014)) = 'expired',
  'both legs expired: the call is expired');
-- 7e. Errors and what else changed.
SELECT pg_temp.t297_assert(
  pg_temp.t297_report(1, 1, 'gone') ->> 'error' LIKE '22023:%'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_report_v1(%L::UUID, %L::UUID, NULL)',
    pg_temp.t297_id(1), pg_temp.t297_leg_id(1)))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_report_v1(NULL::UUID, %L::UUID, %L)',
    pg_temp.t297_leg_id(1), 'ok'))) = '22023'
  AND pg_temp.t297_code(pg_temp.t297_svc(format('SELECT platform.telephony_recording_report_v1(%L::UUID, NULL::UUID, %L)',
    pg_temp.t297_id(1), 'ok'))) = '22023'
  AND pg_temp.t297_svc(format('SELECT platform.telephony_recording_report_v1(%L::UUID, gen_random_uuid(), %L)',
    pg_temp.t297_id(1), 'ok')) ->> 'error' = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_report(20, 1, 'not_found') ->> 'error' = 'P0002:telephony_recording_not_found'
  AND pg_temp.t297_report(1, 1, 'ok', 2) ->> 'error' = 'P0002:telephony_recording_not_found',
  'an unknown result or NULL is 22023; an unknown leg and a leg of another organization are P0002');
SELECT pg_temp.t297_assert(
  NOT EXISTS (SELECT 1 FROM t297_snapshot s JOIN platform_private.telephony_call_legs l ON l.id = s.id
    WHERE md5(row(l.*)::TEXT) <> s.h AND l.id NOT IN (pg_temp.t297_leg_id(9), pg_temp.t297_leg_id(10), pg_temp.t297_leg_id(8),
      pg_temp.t297_leg_id(14, 1), pg_temp.t297_leg_id(14, 2), pg_temp.t297_leg_id(3, 2))),
  'report touched only the legs it was asked about');
-- A cleared link cannot come back by report; only the reconciliation (293) can give a new one.
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM platform_private.telephony_call_legs l WHERE l.recording_state = 'expired' AND l.recording_link IS NOT NULL) = 0,
  'an expired leg never carries a link');
SELECT pg_temp.t297_assert((SELECT count(*) FROM platform_private.telephony_calls) = 15
  AND (SELECT count(*) FROM platform_private.telephony_call_legs) = 18,
  'consume and report create and delete no call or leg');

-- ---------------------------------------------------------------------------
-- 8. The list after the state moved: it reports what the legs say now.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert(
  (pg_temp.t297_row(pg_temp.t297_list(1, 1, ARRAY[7, 10, 14]), 7) -> 'legs' -> 0 ->> 'state') = 'unavailable'
  AND (pg_temp.t297_row(pg_temp.t297_list(1, 1, ARRAY[7, 10, 14]), 10) -> 'legs' -> 0 ->> 'state') = 'expired'
  AND (pg_temp.t297_row(pg_temp.t297_list(1, 1, ARRAY[7, 10, 14]), 14) -> 'legs' -> 0 ->> 'state') = 'expired'
  AND (pg_temp.t297_row(pg_temp.t297_list(1, 1, ARRAY[7, 10, 14]), 14) -> 'legs' -> 1 ->> 'state') = 'expired',
  'the list shows unavailable and expired legs as the report left them');

-- ---------------------------------------------------------------------------
-- 9. Hygiene: the link lives in one column and is read by consume only.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM information_schema.columns c
    WHERE c.table_schema IN ('platform', 'platform_private') AND c.column_name ILIKE '%recording_link%') = 1
  AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'platform_private'
    AND c.table_name = 'telephony_call_legs' AND c.column_name = 'recording_link'),
  'the recording link is one column, on the leg row');
SELECT pg_temp.t297_assert(
  (SELECT array_agg(column_name::TEXT ORDER BY column_name::TEXT COLLATE "C") FROM information_schema.columns c
    WHERE c.table_schema = 'platform_private' AND c.table_name = 'telephony_recording_grants')
  = ARRAY['expires_at', 'granted_at', 'id', 'last_used_at', 'leg_id', 'max_uses', 'membership_id', 'organization_id', 'use_count'],
  'a grant row has no column that could hold a link');
SELECT pg_temp.t297_assert(
  (SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('platform', 'platform_private') AND p.proname LIKE 'telephony\_%'
      AND pg_get_functiondef(p.oid) ILIKE '%recording_link%')
  = ARRAY['telephony_place_leg', 'telephony_receive_v1', 'telephony_reconcile_row', 'telephony_recording_consume_v1',
    'telephony_recording_report_v1'],
  'the link column is named by the three writers (ingest, projection, reconciliation), by consume (the only reader) and by report (which only clears it): '
    || (SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C")::TEXT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('platform', 'platform_private') AND p.proname LIKE 'telephony\_%'
        AND pg_get_functiondef(p.oid) ILIKE '%recording_link%'));
SELECT pg_temp.t297_assert(
  (SELECT length(d) - length(replace(d, 'recording_link', '')) = length('recording_link') AND d LIKE '%recording_link = NULL%'
    FROM (SELECT pg_get_functiondef('platform.telephony_recording_report_v1(uuid,uuid,text)'::regprocedure) AS d) x),
  'report names the link column once, to clear it — it never reads it');
SELECT pg_temp.t297_assert(
  (SELECT d NOT ILIKE '%recording_link%' AND d !~* 'select\s+\*\s+into\s+v_leg'
    FROM (SELECT pg_get_functiondef('platform.telephony_recording_grant_v1(uuid,uuid)'::regprocedure) AS d) x)
  AND (SELECT d NOT ILIKE '%recording_link%'
    FROM (SELECT pg_get_functiondef('platform.telephony_lead_recordings_v1(uuid,uuid,uuid[])'::regprocedure) AS d) x),
  'grant and list never name the link column and grant never loads a whole leg row');
SELECT pg_temp.t297_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE to_jsonb(e)::TEXT LIKE '%example.invalid%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_recording_grants g WHERE to_jsonb(g)::TEXT LIKE '%example.invalid%'
    OR to_jsonb(g)::TEXT LIKE '%https%'),
  'no journal row and no grant holds a link');
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM platform_private.telephony_call_legs l WHERE l.recording_link IS NOT NULL
    AND l.recording_link NOT LIKE 'https://example.invalid/t297-secret-recording-%') = 0
  AND (SELECT count(*) FROM platform_private.telephony_calls c WHERE to_jsonb(c)::TEXT LIKE '%example.invalid%') = 0,
  'the fictional links are on legs only and the call rows hold none');
-- The migration did not touch what it must not: the earlier telephony functions keep their ACL.
SELECT pg_temp.t297_assert(
  has_function_privilege('authenticated', 'platform.telephony_lead_calls_v1(uuid,uuid,integer,timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.telephony_set_result_v1(uuid,uuid,text,date)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.telephony_receive_v1(uuid,uuid,text,text,text,jsonb,text,jsonb)', 'EXECUTE'),
  'the earlier telephony functions keep their ACL');

\echo T297_TELEPHONY_RECORDINGS_SUITE_END
SELECT 'T297_TELEPHONY_RECORDINGS_SUITE_PASSED' AS t297_suite_marker;
ROLLBACK;
