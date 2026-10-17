\set ON_ERROR_STOP on
-- Boundary suite for migration 299 «Телефония Beeline KG» срез T10 (блок «Звонки» в
-- «Отчёте продаж»; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1, §9.1, §9.2, §10, §11, §12;
-- ADR 0033). Runs on the real chain right after 299 inside one transaction that is rolled
-- back, with its own synthetic organizations, members (modelled like production: invited
-- staff have coarse role NULL, rights come from scoped role assignments made through the
-- REAL platform.staff_role_assignments_save and from the roles the real T2 provisioning
-- creates), clients, leads, calls and legs: no provider, no real person, no real phone, no
-- real recording, no production action. All numbers are fictional.
--
-- Proves:
--  1. catalog and grants: the report is one STABLE SECURITY DEFINER function with an empty
--     search_path, executable by authenticated only (not anon, not service_role, not PUBLIC);
--     the two helpers are closed to every client role; the whole platform telephony catalog is
--     exactly the twenty-one earlier functions plus the report; the tables stay closed; the function names no
--     recording link and returns only masked numbers;
--  2. the helpers on fixed dates: working seconds across a night, a Sunday, before opening,
--     after closing, a reversed or empty span, NULLs and the 400-day cap; the callback deadline
--     (next working day, skipping Sunday, none without working days);
--  3. the switch and the rights: report.read.all (Admin, supervisor) and report.read.own
--     (manager) are served; the dial right alone, a member without roles, a Student and
--     another organization are refused (42501) whether the switch is on or off; anon and
--     service_role cannot execute; no settings row or ui_enabled = false answers
--     {"enabled": false} to the authorised only; invalid arguments are 22023;
--  4. the figures on a hand-built fixture: calls in/out per manager (once per call, an
--     employee whose leg was cancelled because a colleague answered is not counted) and for the
--     team (every call once); answered (talked on, not a webhook Success) and the team's
--     outcome answered; talk time and the calls it is known for; the result strip share (no
--     backfill, a client); the time to the first touch of new leads in working seconds
--     (across a night, a never-called lead, a lead reached later, medians, in time / late);
--     direct-student and phone-call leads left out; the missed block (callback in time, late,
--     none, after the deadline, anonymous and chain-answered calls left out, pending);
--     the unassigned row; the zero row of a mapped employee; calls without an outcome and
--     calls outside the period left out; the period bounds in Asia/Bishkek days;
--  5. scope: «own» sees one row, no team, no unassigned row and only its own missed list;
--     «all» sees everyone; another organization never leaks in either direction;
--  6. the missed list: newest first, masked number, lead and owner name, at most 50;
--  7. hygiene: no raw number, no link, no email in any answer; the report writes nothing.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

DO $t299_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t299_auth_role$;

\echo T299_TELEPHONY_REPORT_SUITE_START

CREATE FUNCTION pg_temp.t299_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t299_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T299: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or
-- {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.t299_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.t299_code(p_answer JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE WHEN p_answer ? 'error' THEN split_part(p_answer ->> 'error', ':', 1) ELSE 'ok' END
$$;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (active), organization 2 (active, another tenant).
--   actor 1  org 1 Admin (system admin)
--   actor 2  org 1 manager A  — «Телефония — менеджер» (report.read.own)
--   actor 3  org 1 manager A2 — the same
--   actor 4  org 1 manager B  — the same
--   actor 5  org 1 supervisor — «Телефония — руководитель» (report.read.all)
--   actor 6  org 1 member WITHOUT a telephony right, mapped to a PBX user (a zero row)
--   actor 7  org 1 Student
--   actor 8  org 1 staff without any role
--   actor 9  org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO t299_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, NULL, FALSE), (6, 1, NULL, FALSE), (7, 1, 'student', FALSE), (8, 1, NULL, FALSE), (9, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t299_id(1), 'T299 Fictional organization', 'active'),
  (pg_temp.t299_id(2), 'T299 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t299_id(100 + n), 't299-' || n || '@example.invalid', '{}'::JSONB FROM t299_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t299_id(200 + n), pg_temp.t299_id(100 + n), 'T299 Actor ' || n, 'active', 1 FROM t299_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t299_id(300 + a.n), pg_temp.t299_id(a.org), pg_temp.t299_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t299_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t299_id(300 + n) FROM t299_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t299_id(401), pg_temp.t299_id(1), 'organization', pg_temp.t299_id(1), 1),
  (pg_temp.t299_id(402), pg_temp.t299_id(2), 'organization', pg_temp.t299_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t299_id(1), pg_temp.t299_id(301), pg_temp.t299_id(401), 1, 1, TRUE, 'system', 'T299 synthetic scope', pg_temp.t299_id(601)),
  (pg_temp.t299_id(2), pg_temp.t299_id(309), pg_temp.t299_id(402), 1, 1, TRUE, 'system', 'T299 synthetic scope', pg_temp.t299_id(602));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t299_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t299_admin_setup \gset

-- The real T2 provisioning creates the two telephony roles in every active organization.
SELECT platform_private.telephony_rights_provision('T299 provision') IS NOT NULL AS t299_provisioned \gset
SELECT pg_temp.t299_assert(:'t299_provisioned'::BOOLEAN, 'the T2 provisioning ran');

CREATE FUNCTION pg_temp.t299_telrole(p_label TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT id FROM platform.staff_role_definitions WHERE organization_id = pg_temp.t299_id(1) AND label = p_label
$$;
-- Role assignment of one member through staff_role_assignments_save (organization scope).
CREATE FUNCTION pg_temp.t299_assign(p_actor INTEGER, p_req INTEGER, p_role UUID) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_claims TEXT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t299_id(200 + p_actor);
  SELECT jsonb_build_array(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', 'organization',
      'key', pg_temp.t299_id(1), 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version))
  INTO items, bindings
  FROM platform.staff_role_definitions r
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  WHERE r.id = p_role;
  v_claims := (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(101),
    'claims', jsonb_build_object('sub', pg_temp.t299_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
  RETURN pg_temp.t299_call('authenticated', v_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t299_id(1), pg_temp.t299_id(300 + p_actor), v_version, items, bindings, 'T299 assign',
    pg_temp.t299_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t299_assert(
  pg_temp.t299_assign(2, 1, pg_temp.t299_telrole('Телефония — менеджер')) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(3, 2, pg_temp.t299_telrole('Телефония — менеджер')) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(4, 3, pg_temp.t299_telrole('Телефония — менеджер')) ->> 'status' = 'applied'
  AND pg_temp.t299_assign(5, 4, pg_temp.t299_telrole('Телефония — руководитель')) ->> 'status' = 'applied',
  'the Admin assigns the manager and supervisor telephony roles through staff_role_assignments_save');

CREATE TEMP TABLE t299_claims(n INTEGER PRIMARY KEY, claims TEXT NOT NULL);
INSERT INTO t299_claims
  SELECT n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t299_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t299_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM generate_series(1, 9) n;
-- The statement as authenticated, with the JWT of the given actor.
CREATE FUNCTION pg_temp.t299_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_call('authenticated', (SELECT c.claims FROM t299_claims c WHERE c.n = p_actor), p_sql)
$$;

-- ---------------------------------------------------------------------------
-- Time. The fixture sits ten Bishkek days back (day 0), so every deadline has passed; the
-- settings make every day a working day, 10:00–20:00, 15 working minutes. Weekday-dependent
-- behaviour is proved on fixed dates in section 2.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_base AS SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 10) AS d0;
-- A Bishkek moment: day offset from day 0, hour, minute.
CREATE FUNCTION pg_temp.t299_at(p_day INTEGER, p_hh INTEGER, p_mm INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT ((b.d0 + p_day) + make_time(p_hh, p_mm, 0)) AT TIME ZONE 'Asia/Bishkek' FROM t299_base b
$$;
CREATE FUNCTION pg_temp.t299_d(p_day INTEGER) RETURNS DATE LANGUAGE SQL STABLE AS $$
  SELECT b.d0 + p_day FROM t299_base b
$$;

-- Organization 2 has NO settings row yet: the first assertion of section 3 relies on that.
INSERT INTO platform_private.telephony_settings(organization_id, ui_enabled, working_days, work_from, work_to, callback_work_minutes)
  VALUES (pg_temp.t299_id(1), TRUE, '{1,2,3,4,5,6,7}', '10:00', '20:00', 15);

-- ---------------------------------------------------------------------------
-- 3a. The switch with no settings row (organization 2), before its row exists.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t299_rep(p_actor INTEGER, p_from DATE, p_to DATE, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_as(p_actor, format('SELECT platform.telephony_report_v1(%L::UUID, %L::DATE, %L::DATE)',
    pg_temp.t299_id(p_org), p_from, p_to))
$$;
SELECT pg_temp.t299_assert(
  pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 2) = '{"enabled": false}'::JSONB,
  'no settings row: the authorised Admin of the organization gets {"enabled": false}');

-- ---------------------------------------------------------------------------
-- Clients, leads (organization 1), calls and legs.
--   client 1..4  phones +996700000001..4, leads 1..4 (owners A, A2, none, B)
--   client 5     lead 5 source phone_call (left out of the first-touch figures)
--   client 6     lead 6 source admissions_direct (left out)
--   client 7     lead 7 owner A, never called
--   client 8     lead 8 owner A2, created 19:55 on day 0, first touched 10:05 on day 1
--   client 9     lead 9 owner A, created long before the period (left out)
--   client 10    lead 10 owner A, created a minute ago (the «today» block)
--   client 11    lead 11 owner A2, created 12:30 on day 0, first touched by an ANSWERED INCOMING call at 12:40
--   org 2: client 20, lead 20
-- ---------------------------------------------------------------------------
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state)
  SELECT pg_temp.t299_id(4000 + k), pg_temp.t299_id(CASE WHEN k = 20 THEN 2 ELSE 1 END), 'T299 Client ' || k,
    platform_private.normalize_person_name('T299 Client ' || k), '+9967000000' || lpad(k::TEXT, 2, '0'),
    platform_private.normalize_person_phone('+9967000000' || lpad(k::TEXT, 2, '0')), 'active'
  FROM unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20]) k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, created_at) VALUES
  (pg_temp.t299_id(5001), pg_temp.t299_id(1), pg_temp.t299_id(4001), pg_temp.t299_id(302), 'new', 'website', 'open', pg_temp.t299_at(0, 10, 0)),
  (pg_temp.t299_id(5002), pg_temp.t299_id(1), pg_temp.t299_id(4002), pg_temp.t299_id(303), 'new', 'website', 'open', pg_temp.t299_at(0, 10, 5)),
  (pg_temp.t299_id(5003), pg_temp.t299_id(1), pg_temp.t299_id(4003), NULL, 'new', 'website', 'open', pg_temp.t299_at(0, 10, 10)),
  (pg_temp.t299_id(5004), pg_temp.t299_id(1), pg_temp.t299_id(4004), pg_temp.t299_id(304), 'new', 'website', 'open', pg_temp.t299_at(0, 10, 15)),
  (pg_temp.t299_id(5005), pg_temp.t299_id(1), pg_temp.t299_id(4005), pg_temp.t299_id(302), 'new', 'phone_call', 'open', pg_temp.t299_at(0, 10, 20)),
  (pg_temp.t299_id(5006), pg_temp.t299_id(1), pg_temp.t299_id(4006), pg_temp.t299_id(302), 'new', 'admissions_direct', 'open', pg_temp.t299_at(0, 10, 25)),
  (pg_temp.t299_id(5007), pg_temp.t299_id(1), pg_temp.t299_id(4007), pg_temp.t299_id(302), 'new', 'website', 'open', pg_temp.t299_at(0, 10, 30)),
  (pg_temp.t299_id(5008), pg_temp.t299_id(1), pg_temp.t299_id(4008), pg_temp.t299_id(303), 'new', 'website', 'open', pg_temp.t299_at(0, 19, 55)),
  (pg_temp.t299_id(5009), pg_temp.t299_id(1), pg_temp.t299_id(4009), pg_temp.t299_id(302), 'new', 'website', 'open', pg_temp.t299_at(-3, 10, 0)),
  (pg_temp.t299_id(5010), pg_temp.t299_id(1), pg_temp.t299_id(4010), pg_temp.t299_id(302), 'new', 'website', 'open', clock_timestamp() - INTERVAL '1 minute'),
  (pg_temp.t299_id(5011), pg_temp.t299_id(1), pg_temp.t299_id(4011), pg_temp.t299_id(303), 'new', 'website', 'open', pg_temp.t299_at(0, 12, 30)),
  (pg_temp.t299_id(5020), pg_temp.t299_id(2), pg_temp.t299_id(4020), pg_temp.t299_id(309), 'new', 'website', 'open', pg_temp.t299_at(0, 10, 0));

-- A call (fixture number): direction, outcome (NULL = still ringing), start, talk seconds, client number or NULL,
-- lead number or NULL, phone or NULL, created_via, outcome source, result code, organization.
CREATE FUNCTION pg_temp.t299_mk(p_k INTEGER, p_dir TEXT, p_outcome TEXT, p_at TIMESTAMPTZ, p_talk INTEGER,
  p_client INTEGER, p_lead INTEGER, p_phone TEXT, p_via TEXT DEFAULT 'webhook', p_source TEXT DEFAULT 'webhook',
  p_result TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, talk_seconds, client_phone, client_id, lead_id, match_state, created_via,
    result_code, result_by, result_at)
  VALUES (pg_temp.t299_id(7000 + p_k), pg_temp.t299_id(p_org), 't299-call-' || p_k, p_dir,
    CASE WHEN p_outcome IS NULL THEN 'ringing' ELSE 'ended' END, p_outcome,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE p_source END,
    p_at, CASE WHEN p_outcome = 'answered' THEN p_at + INTERVAL '5 seconds' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE p_at + INTERVAL '3 minutes' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE p_at + INTERVAL '4 minutes' END,
    p_talk, p_phone,
    CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t299_id(4000 + p_client) END,
    CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t299_id(5000 + p_lead) END,
    CASE WHEN p_client IS NULL THEN 'unmatched' ELSE 'matched' END, p_via,
    p_result, CASE WHEN p_result IS NULL THEN NULL ELSE pg_temp.t299_id(302) END,
    CASE WHEN p_result IS NULL THEN NULL ELSE p_at + INTERVAL '10 minutes' END);
END
$$;
-- A leg (call number, position, member or NULL, state, status, talk seconds, accepted). The first leg that was
-- accepted also makes the member the call's first answerer, as the real writers keep it.
CREATE FUNCTION pg_temp.t299_leg(p_k INTEGER, p_pos INTEGER, p_member INTEGER, p_state TEXT, p_status TEXT,
  p_talk INTEGER DEFAULT NULL, p_accepted BOOLEAN DEFAULT FALSE, p_org INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_at TIMESTAMPTZ;
BEGIN
  SELECT c.started_at INTO v_at FROM platform_private.telephony_calls c
    WHERE c.organization_id = pg_temp.t299_id(p_org) AND c.id = pg_temp.t299_id(7000 + p_k);
  INSERT INTO platform_private.telephony_call_legs(id, organization_id, call_id, pbx_user, membership_id, state, status,
    leg_started_at, leg_start_source, accepted_at, ended_at, webhook_total_seconds, talk_seconds)
  VALUES (pg_temp.t299_id(8000 + p_k * 10 + p_pos), pg_temp.t299_id(p_org), pg_temp.t299_id(7000 + p_k),
    CASE WHEN p_member IS NULL THEN '' ELSE 'u299_' || p_member END,
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t299_id(300 + p_member) END,
    p_state, p_status, v_at + (p_pos || ' seconds')::INTERVAL, 'history',
    CASE WHEN p_accepted THEN v_at + INTERVAL '5 seconds' END,
    CASE WHEN p_state = 'ringing' THEN NULL ELSE v_at + INTERVAL '3 minutes' END,
    CASE WHEN p_status = 'success' THEN COALESCE(p_talk, 0) + 10 END, p_talk);
  IF p_accepted AND p_member IS NOT NULL THEN
    UPDATE platform_private.telephony_calls c SET membership_id = pg_temp.t299_id(300 + p_member)
      WHERE c.organization_id = pg_temp.t299_id(p_org) AND c.id = pg_temp.t299_id(7000 + p_k) AND c.membership_id IS NULL;
  END IF;
END
$$;

-- Day 0 (local time):
--   c1  11:00 out answered by A, client 1 / lead 1, talk 120, result «reached»
--   c2  11:30 out busy, A, client 2 / lead 2
--   c3  12:00 in answered by A2 (A's leg was cancelled), client 1 / lead 1, talk 60
--   c4  13:00 in missed (A and A2 rang), client 2 / lead 2   → callback c5 in 10 min: in time
--   c5  13:10 out answered by A2, client 2 / lead 2, talk 90
--   c6  14:00 in missed (A rang), client 1 / lead 1         → callback c7 in 40 min: late
--   c7  14:40 out answered by A, client 1 / lead 1, talk 80, result «not_interested»
--   c8  15:00 in missed (A and A2 rang), client 3 / lead 3 (no owner) → no callback
--   c9  16:00 in missed (B rang), client 4 / lead 4          → answered only on day 3 (after the deadline)
--   c10 16:30 in missed, anonymous (no phone), B rang        → no callback possible: left out
--   c11 17:00 in missed (A rang), unmatched number 9, linked to c12 → the chain was answered: left out
--   c12 17:20 in answered by A, unmatched number 9, talk 50
--   c23 18:00 in answered by A, then transferred: B's leg rang and was missed (the outcome is answered, B did not answer), client 1 / lead 1, talk 40
--   c24 12:40 in answered by A2, client 11 / lead 11 (the first touch of lead 11 is this incoming call), talk 30
-- Day 1: c13 11:00 backfill out answered by A (talk 30); c14 11:30 reconcile out «no_answer_unknown», A;
--   c15 12:00 out still ringing (no outcome: left out); c16 10:05 out busy, A2, client 8 / lead 8.
-- Elsewhere: c17 two days before day 0 (outside the period); c9b day 3 10:00 out answered by B (talk 70);
--   c18 org 2; c19a day -5 23:59 and c19b day -4 00:00 (period bounds); c20 five minutes ago (pending).
SELECT pg_temp.t299_mk(1, 'out', 'answered', pg_temp.t299_at(0, 11, 0), 120, 1, 1, '+996700000001', p_result => 'reached');
SELECT pg_temp.t299_leg(1, 1, 2, 'completed', 'success', 120, TRUE);
SELECT pg_temp.t299_mk(2, 'out', 'busy', pg_temp.t299_at(0, 11, 30), NULL, 2, 2, '+996700000002');
SELECT pg_temp.t299_leg(2, 1, 2, 'completed', 'busy');
SELECT pg_temp.t299_mk(3, 'in', 'answered', pg_temp.t299_at(0, 12, 0), 60, 1, 1, '+996700000001');
SELECT pg_temp.t299_leg(3, 1, 2, 'cancelled', 'cancel');
SELECT pg_temp.t299_leg(3, 2, 3, 'completed', 'success', 60, TRUE);
SELECT pg_temp.t299_mk(4, 'in', 'missed', pg_temp.t299_at(0, 13, 0), NULL, 2, 2, '+996700000002');
SELECT pg_temp.t299_leg(4, 1, 2, 'missed', 'missed');
SELECT pg_temp.t299_leg(4, 2, 3, 'missed', 'missed');
SELECT pg_temp.t299_mk(5, 'out', 'answered', pg_temp.t299_at(0, 13, 10), 90, 2, 2, '+996700000002');
SELECT pg_temp.t299_leg(5, 1, 3, 'completed', 'success', 90, TRUE);
SELECT pg_temp.t299_mk(6, 'in', 'missed', pg_temp.t299_at(0, 14, 0), NULL, 1, 1, '+996700000001');
SELECT pg_temp.t299_leg(6, 1, 2, 'missed', 'missed');
SELECT pg_temp.t299_mk(7, 'out', 'answered', pg_temp.t299_at(0, 14, 40), 80, 1, 1, '+996700000001', p_result => 'not_interested');
SELECT pg_temp.t299_leg(7, 1, 2, 'completed', 'success', 80, TRUE);
SELECT pg_temp.t299_mk(8, 'in', 'missed', pg_temp.t299_at(0, 15, 0), NULL, 3, 3, '+996700000003');
SELECT pg_temp.t299_leg(8, 1, 2, 'missed', 'missed');
SELECT pg_temp.t299_leg(8, 2, 3, 'missed', 'missed');
SELECT pg_temp.t299_mk(9, 'in', 'missed', pg_temp.t299_at(0, 16, 0), NULL, 4, 4, '+996700000004');
SELECT pg_temp.t299_leg(9, 1, 4, 'missed', 'missed');
SELECT pg_temp.t299_mk(10, 'in', 'missed', pg_temp.t299_at(0, 16, 30), NULL, NULL, NULL, NULL);
SELECT pg_temp.t299_leg(10, 1, 4, 'missed', 'missed');
SELECT pg_temp.t299_mk(11, 'in', 'missed', pg_temp.t299_at(0, 17, 0), NULL, NULL, NULL, '+996700000099');
SELECT pg_temp.t299_leg(11, 1, 2, 'missed', 'missed');
SELECT pg_temp.t299_mk(12, 'in', 'answered', pg_temp.t299_at(0, 17, 20), 50, NULL, NULL, '+996700000099');
SELECT pg_temp.t299_leg(12, 1, 2, 'completed', 'success', 50, TRUE);
UPDATE platform_private.telephony_calls SET linked_call_id = pg_temp.t299_id(7012) WHERE id = pg_temp.t299_id(7011);
SELECT pg_temp.t299_mk(13, 'out', 'answered', pg_temp.t299_at(1, 11, 0), 30, 1, 1, '+996700000001', p_via => 'backfill', p_source => 'pull');
SELECT pg_temp.t299_leg(13, 1, 2, 'completed', 'success', 30, TRUE);
SELECT pg_temp.t299_mk(14, 'out', 'no_answer_unknown', pg_temp.t299_at(1, 11, 30), NULL, 2, 2, '+996700000002', p_via => 'reconcile', p_source => 'pull');
SELECT pg_temp.t299_leg(14, 1, 2, 'completed', 'notavailable');
SELECT pg_temp.t299_mk(15, 'out', NULL, pg_temp.t299_at(1, 12, 0), NULL, 1, 1, '+996700000001');
SELECT pg_temp.t299_leg(15, 1, 2, 'ringing', NULL);
SELECT pg_temp.t299_mk(16, 'out', 'busy', pg_temp.t299_at(1, 10, 5), NULL, 8, 8, '+996700000008');
SELECT pg_temp.t299_leg(16, 1, 3, 'completed', 'busy');
SELECT pg_temp.t299_mk(17, 'out', 'answered', pg_temp.t299_at(-2, 11, 0), 40, 1, 1, '+996700000001');
SELECT pg_temp.t299_leg(17, 1, 2, 'completed', 'success', 40, TRUE);
SELECT pg_temp.t299_mk(18, 'out', 'busy', pg_temp.t299_at(0, 11, 0), NULL, 20, 20, '+996700000020', p_org => 2);
SELECT pg_temp.t299_leg(18, 1, 9, 'completed', 'busy', p_org => 2);
SELECT pg_temp.t299_mk(19, 'out', 'answered', pg_temp.t299_at(-5, 23, 59), 11, NULL, NULL, '+996700000098');
SELECT pg_temp.t299_leg(19, 1, 2, 'completed', 'success', 11, TRUE);
SELECT pg_temp.t299_mk(21, 'out', 'answered', pg_temp.t299_at(-4, 0, 0), 12, NULL, NULL, '+996700000097');
SELECT pg_temp.t299_leg(21, 1, 2, 'completed', 'success', 12, TRUE);
SELECT pg_temp.t299_mk(22, 'out', 'answered', pg_temp.t299_at(3, 10, 0), 70, 4, 4, '+996700000004');
SELECT pg_temp.t299_leg(22, 1, 4, 'completed', 'success', 70, TRUE);
SELECT pg_temp.t299_mk(20, 'in', 'missed', clock_timestamp() - INTERVAL '5 minutes', NULL, 10, 10, '+996700000010');
SELECT pg_temp.t299_leg(20, 1, 2, 'missed', 'missed');
SELECT pg_temp.t299_mk(23, 'in', 'answered', pg_temp.t299_at(0, 18, 0), 40, 1, 1, '+996700000001');
SELECT pg_temp.t299_leg(23, 1, 2, 'completed', 'success', 40, TRUE);
SELECT pg_temp.t299_leg(23, 2, 4, 'missed', 'missed');
SELECT pg_temp.t299_mk(24, 'in', 'answered', pg_temp.t299_at(0, 12, 40), 30, 11, 11, '+996700000011');
SELECT pg_temp.t299_leg(24, 1, 3, 'completed', 'success', 30, TRUE);
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id, active)
  VALUES (pg_temp.t299_id(1), 'u299_6', '106', 'T299 idle', pg_temp.t299_id(306), TRUE);
SELECT pg_temp.t299_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t299_id(1)) = 23,
  'sanity: the fixture holds 23 calls in organization 1');

-- The main period: day 0 and day 1.
CREATE FUNCTION pg_temp.t299_main(p_actor INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t299_rep(p_actor, pg_temp.t299_d(0), pg_temp.t299_d(1))
$$;
-- The row of an actor in a report's managers, by fixture number.
CREATE FUNCTION pg_temp.t299_row(p_rep JSONB, p_actor INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT m FROM jsonb_array_elements(p_rep -> 'managers') m WHERE m ->> 'membershipId' = pg_temp.t299_id(300 + p_actor)::TEXT
$$;

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert((SELECT count(*) = 1 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 's')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname = 'telephony_report_v1'),
  'the report is one owner-owned STABLE SECURITY DEFINER function with an empty search_path');
SELECT pg_temp.t299_assert(
  has_function_privilege('authenticated', 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE')
  AND (SELECT count(*) FROM (VALUES ('anon'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform.telephony_report_v1(uuid,date,date)', 'EXECUTE')) = 0,
  'the report is executable by authenticated only');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role_name)
    WHERE has_function_privilege(r.role_name, 'platform_private.telephony_work_seconds_between(timestamptz,timestamptz,smallint[],time,time)', 'EXECUTE')
      OR has_function_privilege(r.role_name, 'platform_private.telephony_report_deadline(timestamptz,smallint[],time)', 'EXECUTE')) = 0
  AND NOT has_function_privilege('public', 'platform_private.telephony_work_seconds_between(timestamptz,timestamptz,smallint[],time,time)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'platform_private.telephony_report_deadline(timestamptz,smallint[],time)', 'EXECUTE'),
  'the two helpers are closed to PUBLIC and every client role');
SELECT pg_temp.t299_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_automation_tick_v1', 'telephony_claim_work_v1', 'telephony_erase_person_v1', 'telephony_extension_map_v1',
    'telephony_integration_health_v1', 'telephony_lead_calls_v1', 'telephony_lead_recordings_v1', 'telephony_maintenance_plan_v1',
    'telephony_manage_overview_v1', 'telephony_project_work_v1', 'telephony_purge_evidence_v1', 'telephony_receive_v1',
    'telephony_reconcile_apply_v1', 'telephony_recording_consume_v1', 'telephony_recording_grant_v1', 'telephony_recording_report_v1',
    'telephony_report_v1', 'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settings_save_v1',
    'telephony_settle_calls_v1', 'telephony_sync_extensions_v1'],
  'platform holds the twenty-one earlier public telephony functions (T1b four, T4a five, T11a two, T5 two, T4b three, T6 four, T8 one) and exactly one new one, telephony_report_v1: '
    || (SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C")::TEXT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'));
SELECT pg_temp.t299_assert(
  pg_temp.t299_call('authenticated', (SELECT c.claims FROM t299_claims c WHERE c.n = 1),
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_calls') ->> 'error' LIKE '42501:%'
  AND pg_temp.t299_call('authenticated', (SELECT c.claims FROM t299_claims c WHERE c.n = 1),
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_call_legs') ->> 'error' LIKE '42501:%'
  AND pg_temp.t299_call('service_role', '{"role":"service_role"}',
    'SELECT count(*)::TEXT::JSONB FROM platform_private.telephony_calls') ->> 'error' LIKE '42501:%',
  'the calls and the legs stay closed to authenticated and service_role');
SELECT pg_temp.t299_assert(
  (SELECT pg_get_functiondef(p.oid) NOT ILIKE '%recording_link%' AND pg_get_functiondef(p.oid) ILIKE '%whatsapp_masked_phone%'
     AND pg_get_functiondef(p.oid) !~* 'insert\s+into|update\s+platform|delete\s+from'
   FROM pg_proc p WHERE p.oid = 'platform.telephony_report_v1(uuid,date,date)'::regprocedure),
  'the report never names the recording link, masks every number and has no write statement');

-- ---------------------------------------------------------------------------
-- 2. The helpers on fixed dates (no dependence on today's date). Mon 2031-01-06, Tue 01-07,
-- Sat 01-11, Sun 01-12, Mon 01-13; working days Monday–Saturday {1..6}, 10:00–20:00 Bishkek (+06).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t299_ws(p_from TEXT, p_to TEXT, p_days SMALLINT[] DEFAULT '{1,2,3,4,5,6}') RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT platform_private.telephony_work_seconds_between(p_from::TIMESTAMPTZ, p_to::TIMESTAMPTZ, p_days, TIME '10:00', TIME '20:00')
$$;
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 10:30+06', '2031-01-06 10:45+06') = 900, 'work seconds: a quarter of an hour inside the day');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 09:00+06', '2031-01-06 10:10+06') = 600, 'work seconds: time before opening does not count');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 19:55+06', '2031-01-06 23:00+06') = 300, 'work seconds: time after closing does not count');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 19:55+06', '2031-01-07 10:05+06') = 600, 'work seconds: across a night, 5 + 5 minutes');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-11 19:55+06', '2031-01-13 10:05+06') = 600, 'work seconds: Sunday contributes nothing');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-12 11:00+06', '2031-01-12 18:00+06') = 0, 'work seconds: a whole Sunday is 0');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-12 11:00+06', '2031-01-12 18:00+06', '{1,2,3,4,5,6,7}') = 25200, 'work seconds: a Sunday that is a working day is 7 hours');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 10:00+06', '2031-01-07 10:00+06') = 36000, 'work seconds: one whole working day is 10 hours');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 10:30+06', '2031-01-06 10:30+06') = 0
  AND pg_temp.t299_ws('2031-01-06 10:45+06', '2031-01-06 10:30+06') = 0, 'work seconds: an empty or reversed span is 0');
SELECT pg_temp.t299_assert(platform_private.telephony_work_seconds_between(NULL, now(), '{1}', TIME '10:00', TIME '20:00') = 0
  AND platform_private.telephony_work_seconds_between(now(), NULL, '{1}', TIME '10:00', TIME '20:00') = 0
  AND platform_private.telephony_work_seconds_between(now() - INTERVAL '1 day', now(), NULL, TIME '10:00', TIME '20:00') = 0
  AND platform_private.telephony_work_seconds_between(now() - INTERVAL '1 day', now(), '{1,2,3,4,5,6,7}', TIME '20:00', TIME '10:00') = 0,
  'work seconds: NULLs and inverted hours are 0, never an error');
SELECT pg_temp.t299_assert(pg_temp.t299_ws('2031-01-06 10:00+06', '2032-06-01 10:00+06', '{1,2,3,4,5,6,7}') = 401 * 36000,
  'work seconds: a span of more than 400 days is capped at 401 whole days');
SELECT pg_temp.t299_assert(
  platform_private.telephony_report_deadline('2031-01-06 14:00+06', '{1,2,3,4,5,6}', TIME '20:00') = TIMESTAMPTZ '2031-01-07 20:00+06'
  AND platform_private.telephony_report_deadline('2031-01-06 23:30+06', '{1,2,3,4,5,6}', TIME '20:00') = TIMESTAMPTZ '2031-01-07 20:00+06'
  AND platform_private.telephony_report_deadline('2031-01-06 03:00+06', '{1,2,3,4,5,6}', TIME '20:00') = TIMESTAMPTZ '2031-01-07 20:00+06',
  'deadline: the end of the next working day after the local date, whatever the hour');
SELECT pg_temp.t299_assert(
  platform_private.telephony_report_deadline('2031-01-11 14:00+06', '{1,2,3,4,5,6}', TIME '20:00') = TIMESTAMPTZ '2031-01-13 20:00+06'
  AND platform_private.telephony_report_deadline('2031-01-12 14:00+06', '{1,2,3,4,5,6}', TIME '20:00') = TIMESTAMPTZ '2031-01-13 20:00+06'
  AND platform_private.telephony_report_deadline('2031-01-11 14:00+06', '{1,2,3,4,5,6,7}', TIME '20:00') = TIMESTAMPTZ '2031-01-12 20:00+06',
  'deadline: Saturday and Sunday skip the non-working Sunday');
SELECT pg_temp.t299_assert(
  platform_private.telephony_report_deadline('2031-01-06 14:00+06', '{}', TIME '20:00') IS NULL
  AND platform_private.telephony_report_deadline(NULL, '{1}', TIME '20:00') IS NULL,
  'deadline: no working days or no moment gives NULL');

-- ---------------------------------------------------------------------------
-- 3. The switch and the rights.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_main(1)) = 'ok' AND (pg_temp.t299_main(1) ->> 'scope') = 'all'
  AND pg_temp.t299_code(pg_temp.t299_main(5)) = 'ok' AND (pg_temp.t299_main(5) ->> 'scope') = 'all'
  AND pg_temp.t299_code(pg_temp.t299_main(2)) = 'ok' AND (pg_temp.t299_main(2) ->> 'scope') = 'own'
  AND (pg_temp.t299_main(3) ->> 'scope') = 'own' AND (pg_temp.t299_main(4) ->> 'scope') = 'own',
  'Admin and the supervisor are served with scope all, the managers with scope own');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_main(6)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_main(7)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_main(8)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 1)) = '42501',
  'a member without a telephony right, a Student, a member without roles and another organization are refused (42501)');
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_call('anon', '{"role":"anon"}', format('SELECT platform.telephony_report_v1(%L::UUID, %L::DATE, %L::DATE)',
    pg_temp.t299_id(1), pg_temp.t299_d(0), pg_temp.t299_d(1)))) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_call('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_report_v1(%L::UUID, %L::DATE, %L::DATE)',
    pg_temp.t299_id(1), pg_temp.t299_d(0), pg_temp.t299_d(1)))) = '42501',
  'anon and service_role cannot execute the report');
-- Arguments.
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_as(1, format('SELECT platform.telephony_report_v1(NULL, %L::DATE, %L::DATE)', pg_temp.t299_d(0), pg_temp.t299_d(1)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_as(1, format('SELECT platform.telephony_report_v1(%L::UUID, NULL, %L::DATE)', pg_temp.t299_id(1), pg_temp.t299_d(1)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_as(1, format('SELECT platform.telephony_report_v1(%L::UUID, %L::DATE, NULL)', pg_temp.t299_id(1), pg_temp.t299_d(1)))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_rep(1, pg_temp.t299_d(1), pg_temp.t299_d(0))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_rep(1, DATE '2019-12-31', DATE '2020-01-05')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_rep(1, pg_temp.t299_d(0), DATE '2200-01-02')) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_rep(1, pg_temp.t299_d(0), pg_temp.t299_d(366))) = '22023'
  AND pg_temp.t299_code(pg_temp.t299_rep(1, pg_temp.t299_d(0), pg_temp.t299_d(365))) = 'ok',
  'NULLs, a reversed span, a date before 2020 or after 2200 and more than 366 days are 22023; exactly 366 days is served');
-- The arguments are checked before the caller: a Student with good arguments is refused (42501), with bad ones he
-- gets the argument error — the order depends on nothing the caller could use to probe rights.
SELECT pg_temp.t299_assert(
  pg_temp.t299_code(pg_temp.t299_rep(7, pg_temp.t299_d(0), pg_temp.t299_d(1))) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_rep(7, pg_temp.t299_d(1), pg_temp.t299_d(0))) = '22023',
  'the argument check does not depend on the caller');
-- The switch off: the authorised get {"enabled": false}, the unauthorised still 42501.
UPDATE platform_private.telephony_settings SET ui_enabled = FALSE WHERE organization_id = pg_temp.t299_id(1);
SELECT pg_temp.t299_assert(
  pg_temp.t299_main(1) = '{"enabled": false}'::JSONB AND pg_temp.t299_main(5) = '{"enabled": false}'::JSONB
  AND pg_temp.t299_main(2) = '{"enabled": false}'::JSONB
  AND pg_temp.t299_code(pg_temp.t299_main(6)) = '42501' AND pg_temp.t299_code(pg_temp.t299_main(7)) = '42501'
  AND pg_temp.t299_code(pg_temp.t299_main(8)) = '42501',
  'ui_enabled = false: the authorised get {"enabled": false} and nothing else, the unauthorised stay 42501');
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t299_id(1);

-- ---------------------------------------------------------------------------
-- 4. The figures (the supervisor sees everyone).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_all AS SELECT pg_temp.t299_main(5) AS rep;
SELECT pg_temp.t299_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys((SELECT rep FROM t299_all)) k)
    = ARRAY['enabled', 'from', 'managers', 'missedList', 'missedMore', 'scope', 'slaMinutes', 'team', 'to', 'unassigned'],
  'the answer has exactly these ten keys');
SELECT pg_temp.t299_assert(
  (SELECT rep ->> 'from' FROM t299_all) = pg_temp.t299_d(0)::TEXT AND (SELECT rep ->> 'to' FROM t299_all) = pg_temp.t299_d(1)::TEXT
  AND (SELECT (rep ->> 'slaMinutes')::INTEGER FROM t299_all) = 15 AND (SELECT (rep ->> 'enabled')::BOOLEAN FROM t299_all),
  'the answer repeats the period and the callback minutes of the settings');
SELECT pg_temp.t299_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys((SELECT rep -> 'team' FROM t299_all)) k)
    = ARRAY['answered', 'calls', 'firstCall', 'missed', 'result', 'talk']
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys((SELECT pg_temp.t299_row(rep, 2) FROM t299_all)) k)
    = ARRAY['answered', 'calls', 'firstCall', 'membershipId', 'missed', 'name', 'result', 'talk']
  AND (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys((SELECT rep -> 'unassigned' FROM t299_all)) k)
    = ARRAY['firstCall', 'missed'],
  'the team, a manager and the unassigned row have their exact keys');

-- Team: every call once, by the call outcome.
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'calls' FROM t299_all) = '{"in": 10, "out": 7}'::JSONB,
  'team calls: 10 incoming and 7 outgoing (the still-ringing call and the calls outside the period are left out)');
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'answered' FROM t299_all) = '{"in": 4, "out": 4}'::JSONB,
  'team answered: 4 incoming and 4 outgoing, by the outcome answered');
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'talk' FROM t299_all) = '{"seconds": 500, "calls": 8}'::JSONB,
  'team talk: 500 seconds over 8 answered calls whose time is known');
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'result' FROM t299_all) = '{"eligible": 6, "set": 2}'::JSONB,
  'team result strip: 6 answered calls with a client and not from the import, 2 with a result');
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'firstCall' FROM t299_all) =
  '{"leads": 7, "called": 5, "reached": 4, "inTime": 2, "late": 5, "pending": 0, "medianCallSeconds": 3600, "medianReachSeconds": 7350}'::JSONB,
  'team first call: 7 new leads (the phone-call, direct-student and old leads are left out), 5 touched, 4 reached, 2 in time, 5 late, medians 3600 and 7350 working seconds: '
    || (SELECT rep -> 'team' -> 'firstCall' FROM t299_all)::TEXT);
SELECT pg_temp.t299_assert((SELECT rep -> 'team' -> 'missed' FROM t299_all) =
  '{"total": 4, "inTime": 1, "late": 1, "pending": 0, "without": 2}'::JSONB,
  'team missed: 4 (the anonymous and the chain-answered ones are left out), 1 in time, 1 late, 2 without a callback: '
    || (SELECT rep -> 'team' -> 'missed' FROM t299_all)::TEXT);

-- Managers: once per call and employee, talked on, not cancelled by a colleague's answer.
SELECT pg_temp.t299_assert((SELECT array_agg(m ->> 'name' ORDER BY ord) FROM t299_all, jsonb_array_elements(rep -> 'managers') WITH ORDINALITY AS t(m, ord))
  = ARRAY['T299 Actor 2', 'T299 Actor 3', 'T299 Actor 4', 'T299 Actor 6'],
  'the supervisor sees A, A2, B and the mapped idle member — by name, in that order — and not the Admin, the supervisor or an unmapped member');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 2) -> 'calls' FROM t299_all) = '{"in": 6, "out": 5}'::JSONB,
  'A calls: 6 incoming (the call a colleague answered is not counted) and 5 outgoing');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 2) -> 'answered' FROM t299_all) = '{"in": 2, "out": 3}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 2) -> 'talk' FROM t299_all) = '{"seconds": 320, "calls": 5}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 2) -> 'result' FROM t299_all) = '{"eligible": 3, "set": 2}'::JSONB,
  'A answered 2 + 3, talked 320 seconds over 5 calls, result strip 2 of 3');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 2) -> 'firstCall' FROM t299_all) =
  '{"leads": 2, "called": 1, "reached": 1, "inTime": 0, "late": 2, "pending": 0, "medianCallSeconds": 3600, "medianReachSeconds": 3600}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 2) -> 'missed' FROM t299_all) = '{"total": 1, "inTime": 0, "late": 1, "pending": 0, "without": 0}'::JSONB,
  'A first call: lead 1 touched after an hour, lead 7 never; missed: one callback after 40 minutes');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 3) -> 'calls' FROM t299_all) = '{"in": 4, "out": 2}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 3) -> 'answered' FROM t299_all) = '{"in": 2, "out": 1}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 3) -> 'talk' FROM t299_all) = '{"seconds": 180, "calls": 3}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 3) -> 'result' FROM t299_all) = '{"eligible": 3, "set": 0}'::JSONB,
  'A2 calls 4 + 2, answered 2 + 1, talked 180 seconds over 3 calls, result strip 0 of 3');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 3) -> 'firstCall' FROM t299_all) =
  '{"leads": 3, "called": 3, "reached": 2, "inTime": 2, "late": 1, "pending": 0, "medianCallSeconds": 600, "medianReachSeconds": 5850}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 3) -> 'missed' FROM t299_all) = '{"total": 1, "inTime": 1, "late": 0, "pending": 0, "without": 0}'::JSONB,
  'A2 first call: lead 8 touched in 10 working minutes across the night, lead 11 by an answered incoming call in 10, lead 2 after 85; missed: one callback in time');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 4) -> 'calls' FROM t299_all) = '{"in": 3, "out": 0}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 4) -> 'answered' FROM t299_all) = '{"in": 0, "out": 0}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 4) -> 'talk' FROM t299_all) = '{"seconds": 0, "calls": 0}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 4) -> 'result' FROM t299_all) = '{"eligible": 0, "set": 0}'::JSONB,
  'B calls: two missed incoming and the transfer he did not answer (its outcome is answered, he did not answer): nothing answered by him');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 4) -> 'firstCall' FROM t299_all) =
  '{"leads": 1, "called": 1, "reached": 1, "inTime": 0, "late": 1, "pending": 0, "medianCallSeconds": 107100, "medianReachSeconds": 107100}'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 4) -> 'missed' FROM t299_all) = '{"total": 1, "inTime": 0, "late": 0, "pending": 0, "without": 1}'::JSONB,
  'B first call: touched on day 3 (107100 working seconds); missed: the callback came after the deadline');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_row(rep, 6) FROM t299_all) = jsonb_build_object('membershipId', pg_temp.t299_id(306), 'name', 'T299 Actor 6',
    'calls', '{"in": 0, "out": 0}'::JSONB, 'answered', '{"in": 0, "out": 0}'::JSONB, 'talk', '{"seconds": 0, "calls": 0}'::JSONB,
    'result', '{"eligible": 0, "set": 0}'::JSONB,
    'firstCall', '{"leads": 0, "called": 0, "reached": 0, "inTime": 0, "late": 0, "pending": 0, "medianCallSeconds": null, "medianReachSeconds": null}'::JSONB,
    'missed', '{"total": 0, "inTime": 0, "late": 0, "pending": 0, "without": 0}'::JSONB),
  'a mapped employee with no activity gets a visible zero row');
SELECT pg_temp.t299_assert(
  (SELECT rep -> 'unassigned' FROM t299_all) = jsonb_build_object(
    'firstCall', '{"leads": 1, "called": 0, "reached": 0, "inTime": 0, "late": 1, "pending": 0, "medianCallSeconds": null, "medianReachSeconds": null}'::JSONB,
    'missed', '{"total": 1, "inTime": 0, "late": 0, "pending": 0, "without": 1}'::JSONB),
  'unassigned: the lead with no owner (never touched) and the missed call on it');
-- The shares add up where they should.
SELECT pg_temp.t299_assert(
  (SELECT sum((m -> 'firstCall' ->> 'leads')::INTEGER) + (rep -> 'unassigned' -> 'firstCall' ->> 'leads')::INTEGER
     = (rep -> 'team' -> 'firstCall' ->> 'leads')::INTEGER
   FROM t299_all, jsonb_array_elements(rep -> 'managers') m GROUP BY rep)
  AND (SELECT sum((m -> 'missed' ->> 'total')::INTEGER) + (rep -> 'unassigned' -> 'missed' ->> 'total')::INTEGER
     = (rep -> 'team' -> 'missed' ->> 'total')::INTEGER
   FROM t299_all, jsonb_array_elements(rep -> 'managers') m GROUP BY rep),
  'the managers and the unassigned row add up to the team in the lead and missed blocks');

-- The period and its bounds in Asia/Bishkek days.
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(0), pg_temp.t299_d(0)) -> 'team' -> 'calls') = '{"in": 10, "out": 4}'::JSONB
  AND (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(1), pg_temp.t299_d(1)) -> 'team' -> 'calls') = '{"in": 0, "out": 3}'::JSONB,
  'a one-day period holds exactly that Bishkek day: day 0 has 10 + 4, day 1 has the three outgoing');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(-5), pg_temp.t299_d(-5)) -> 'team' -> 'calls') = '{"in": 0, "out": 1}'::JSONB
  AND (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(-5), pg_temp.t299_d(-5)) -> 'team' -> 'talk') = '{"seconds": 11, "calls": 1}'::JSONB
  AND (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(-4), pg_temp.t299_d(-4)) -> 'team' -> 'talk') = '{"seconds": 12, "calls": 1}'::JSONB,
  '23:59 belongs to its day and 00:00 to the next one');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(3), pg_temp.t299_d(3)) -> 'team' -> 'calls') = '{"in": 0, "out": 1}'::JSONB
  AND (SELECT pg_temp.t299_row(pg_temp.t299_rep(5, pg_temp.t299_d(3), pg_temp.t299_d(3)), 4) -> 'answered') = '{"in": 0, "out": 1}'::JSONB
  AND (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(3), pg_temp.t299_d(3)) -> 'team' -> 'firstCall' ->> 'leads') = '0'
  AND (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(3), pg_temp.t299_d(3)) -> 'team' -> 'missed' ->> 'total') = '0',
  'day 3 holds B''s late callback only; no lead was created and nothing was missed that day');
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(5, pg_temp.t299_d(-30), pg_temp.t299_d(-20)) -> 'team') =
  jsonb_build_object('calls', '{"in": 0, "out": 0}'::JSONB, 'answered', '{"in": 0, "out": 0}'::JSONB,
    'talk', '{"seconds": 0, "calls": 0}'::JSONB, 'result', '{"eligible": 0, "set": 0}'::JSONB,
    'firstCall', '{"leads": 0, "called": 0, "reached": 0, "inTime": 0, "late": 0, "pending": 0, "medianCallSeconds": null, "medianReachSeconds": null}'::JSONB,
    'missed', '{"total": 0, "inTime": 0, "late": 0, "pending": 0, "without": 0}'::JSONB),
  'an empty period answers zeros and null medians, not an error');

-- ---------------------------------------------------------------------------
-- 5. Scope: «own» sees one row.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  (SELECT jsonb_typeof(pg_temp.t299_main(2) -> 'team') = 'null' AND jsonb_typeof(pg_temp.t299_main(2) -> 'unassigned') = 'null'
     AND jsonb_array_length(pg_temp.t299_main(2) -> 'managers') = 1),
  'own: no team, no unassigned row, one manager row');
SELECT pg_temp.t299_assert(
  pg_temp.t299_main(2) -> 'managers' -> 0 = pg_temp.t299_row((SELECT rep FROM t299_all), 2)
  AND pg_temp.t299_main(3) -> 'managers' -> 0 = pg_temp.t299_row((SELECT rep FROM t299_all), 3)
  AND pg_temp.t299_main(4) -> 'managers' -> 0 = pg_temp.t299_row((SELECT rep FROM t299_all), 4),
  'own: each manager''s row is exactly his row in the supervisor''s view');
SELECT pg_temp.t299_assert(
  pg_temp.t299_main(2) -> 'missedList' = '[]'::JSONB AND pg_temp.t299_main(3) -> 'missedList' = '[]'::JSONB
  AND jsonb_array_length(pg_temp.t299_main(4) -> 'missedList') = 1
  AND (pg_temp.t299_main(4) -> 'missedList' -> 0 ->> 'callId') = pg_temp.t299_id(7009)::TEXT,
  'own: the missed list holds only the calls on the leads he owns (B has one, A and A2 none without a callback)');
-- The own scope of a member with the dial right only is refused; and an own holder does not become «all».
SELECT pg_temp.t299_assert(
  (pg_temp.t299_main(2) ->> 'scope') = 'own'
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.t299_main(2) -> 'managers') m
       WHERE m ->> 'membershipId' <> pg_temp.t299_id(302)::TEXT) = 0,
  'own: no other member''s row appears');
-- A manager with no activity in the period still gets his own zero row.
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(4, pg_temp.t299_d(-30), pg_temp.t299_d(-20)) -> 'managers' -> 0 ->> 'membershipId') = pg_temp.t299_id(304)::TEXT
  AND jsonb_array_length(pg_temp.t299_rep(4, pg_temp.t299_d(-30), pg_temp.t299_d(-20)) -> 'managers') = 1,
  'own: a quiet period still has the manager''s zero row');

-- ---------------------------------------------------------------------------
-- 6. The missed list.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  (SELECT array_agg(i ->> 'callId' ORDER BY ord) FROM t299_all, jsonb_array_elements(rep -> 'missedList') WITH ORDINALITY AS t(i, ord))
    = ARRAY[pg_temp.t299_id(7009)::TEXT, pg_temp.t299_id(7008)::TEXT]
  AND (SELECT NOT (rep ->> 'missedMore')::BOOLEAN FROM t299_all),
  'the supervisor''s list holds the two missed calls without a callback, newest first, and no more');
SELECT pg_temp.t299_assert(
  (SELECT i FROM t299_all, jsonb_array_elements(rep -> 'missedList') i WHERE i ->> 'callId' = pg_temp.t299_id(7009)::TEXT)
    = jsonb_build_object('callId', pg_temp.t299_id(7009), 'startedAt', pg_temp.t299_at(0, 16, 0), 'phone', '+996 ••• 00 00 04',
      'leadId', pg_temp.t299_id(5004), 'ownerName', 'T299 Actor 4')
  AND (SELECT i FROM t299_all, jsonb_array_elements(rep -> 'missedList') i WHERE i ->> 'callId' = pg_temp.t299_id(7008)::TEXT)
    = jsonb_build_object('callId', pg_temp.t299_id(7008), 'startedAt', pg_temp.t299_at(0, 15, 0), 'phone', '+996 ••• 00 00 03',
      'leadId', pg_temp.t299_id(5003), 'ownerName', NULL),
  'a list item: the call, the time, the masked number, the lead and the owner''s name (null without an owner)');

-- ---------------------------------------------------------------------------
-- 4b. The «now» block: a missed call five minutes ago and a lead a minute old are still within their time.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t299_now(rep JSONB);
INSERT INTO t299_now SELECT pg_temp.t299_as(5, format('SELECT platform.telephony_report_v1(%L::UUID, %L::DATE, %L::DATE)', pg_temp.t299_id(1),
  (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1, (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE));
SELECT pg_temp.t299_assert(
  (SELECT rep -> 'team' -> 'missed' FROM t299_now) = '{"total": 1, "inTime": 0, "late": 0, "pending": 1, "without": 0}'::JSONB
  AND (SELECT rep -> 'team' -> 'firstCall' FROM t299_now) =
    '{"leads": 1, "called": 0, "reached": 0, "inTime": 0, "late": 0, "pending": 1, "medianCallSeconds": null, "medianReachSeconds": null}'::JSONB
  AND (SELECT rep -> 'missedList' FROM t299_now) = '[]'::JSONB
  AND (SELECT pg_temp.t299_row(rep, 2) -> 'missed' FROM t299_now) = '{"total": 1, "inTime": 0, "late": 0, "pending": 1, "without": 0}'::JSONB
  AND (SELECT rep -> 'team' -> 'calls' FROM t299_now) = '{"in": 1, "out": 0}'::JSONB,
  'recent missed call and recent lead: pending, not counted as failures, not in the list: ' || (SELECT rep::TEXT FROM t299_now));

-- ---------------------------------------------------------------------------
-- 5b. Another organization.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_settings(organization_id, ui_enabled, working_days, work_from, work_to, callback_work_minutes)
  VALUES (pg_temp.t299_id(2), TRUE, '{1,2,3,4,5,6,7}', '10:00', '20:00', 15);
SELECT pg_temp.t299_assert(
  (SELECT pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 2) -> 'team' -> 'calls') = '{"in": 0, "out": 1}'::JSONB
  AND (SELECT pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 2) -> 'team' -> 'firstCall' ->> 'leads') = '1'
  AND (SELECT jsonb_array_length(pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 2) -> 'managers')) = 1
  AND (SELECT pg_temp.t299_rep(9, pg_temp.t299_d(0), pg_temp.t299_d(1), 2) -> 'managers' -> 0 ->> 'name') = 'T299 Actor 9',
  'organization 2 sees its own call, lead and member only');
SELECT pg_temp.t299_assert(
  (SELECT rep -> 'team' -> 'calls' FROM t299_all) = '{"in": 10, "out": 7}'::JSONB
  AND NOT (SELECT rep::TEXT LIKE '%T299 Actor 9%' FROM t299_all),
  'organization 1 is unchanged by organization 2''s call and member');

-- ---------------------------------------------------------------------------
-- 7. Hygiene: no raw number, no link, no email; the report writes nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t299_assert(
  (SELECT bool_and(rep::TEXT !~ '99670000' AND rep::TEXT !~* 'https?:' AND rep::TEXT !~* 'example\.invalid' AND rep::TEXT !~ '@')
   FROM (SELECT rep FROM t299_all UNION ALL SELECT rep FROM t299_now UNION ALL SELECT pg_temp.t299_main(2) UNION ALL SELECT pg_temp.t299_main(4)) x),
  'no answer carries a raw number, a link or an email');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM platform.audit_events e WHERE e.organization_id = pg_temp.t299_id(1) AND e.action LIKE 'telephony.%') = 0,
  'reading the report writes no journal row');
SELECT pg_temp.t299_assert(
  (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t299_id(1)) = 23
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE organization_id = pg_temp.t299_id(1)) = 27,
  'the report changed no call and no leg');

\echo T299_TELEPHONY_REPORT_SUITE_END
SELECT 'T299_TELEPHONY_REPORT_SUITE_PASSED' AS t299_suite_marker;
ROLLBACK;
