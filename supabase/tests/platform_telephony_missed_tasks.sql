\set ON_ERROR_STOP on
-- Boundary suite for migration 297 «Телефония Beeline KG» срез T8 (задача «Перезвонить»
-- по пропущенному, «Недозвон» с каденсом, автозакрытие, задачи по результату звонка,
-- потолки автоматики; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1, §6.2, §9.1, §9.2, §9.4;
-- ADR 0033). Runs on the real chain right after 297 inside one transaction that is rolled
-- back, with its own synthetic organizations, members (roles through the REAL
-- platform.staff_role_command / staff_role_publish / staff_role_assignments_save),
-- clients, leads and calls: no provider, no real person, no real phone, no production
-- action. The tick is called through the same request.jwt.claims role gate the service
-- path uses.
--
-- Proves:
--  1. catalog and grants: platform now holds the full catalog of 17 public telephony
--     functions (sixteen earlier, one new); the new one is SECURITY DEFINER with
--     an empty search_path and EXECUTE for service_role only; every private helper is
--     closed to PUBLIC and every client role; anon, authenticated, supabase_auth_admin, the
--     AI agent role and a service_role without the service claim are refused (42501);
--     argument errors (22023);
--  2. schema: the automation mark pair and its closed list, the new link kind and counter;
--  3. working-hours math as pure rules: 19:55 + 15 -> tomorrow 10:10, 03:00 + 15 -> 10:15,
--     Sunday -> Monday, exactly at closing, a different week and hours, the local day
--     across midnight UTC, the cadence steps and their clamping, invalid arguments;
--  4. the switches: no settings row, projection off, automation flag off -> nothing is
--     read or written;
--  5. missed inbound calls: the task for the lead owner, the fallbacks (no owner, an owner
--     who cannot receive tasks, a suspended owner, no open lead with a previous owner, no
--     lead at all), one decision per call (a second tick changes nothing), repeated misses
--     raising the counter instead of the number of tasks, a task a human finished letting
--     the next miss create a new one, the chain and the later-answered rules, unmatched
--     numbers left to T9, ambiguous numbers going to the head as «Проверить звонок», the
--     two-hour age rule for webhook and reconcile rows, backfill and unsettled calls
--     untouched, a call without an outcome skipped, and no assignee at all skipped;
--  6. auto-close by an answered call: only the same client, only a call that began after the
--     call of the task, the staff task done with its event and journal row, the link closed
--     with the closing call, and a reconciled call turned answered closing its own task;
--  7. unanswered outbound calls: the «Недозвон» result without an author, the cadence
--     steps (+2 working hours, next working day 11:00, +2 working days, then the last
--     step), the previous task replaced, the hint to the head after five misses in seven
--     days, the answer restarting the cadence, pull rows and refused calls left alone;
--  8. results: «Перезвонить» + day creates the task at the start of that day for the one
--     who pressed it and replaces the open system tasks, a changed day gives a new task, a
--     changed result cancels it, a past day gives nothing, an answered call closes it only
--     from the chosen day, «Не интересно» closes every open «Перезвонить» of the client;
--  9. ceilings: the hourly and the daily ceiling stop both flags, raise the settings
--     version, light the stop state and the journal event, leave the call unmarked; merges and
--     button tasks do not count;
-- 10. isolation and failure: another organization is untouched; a failing call costs only
--     itself and leaves only a coded error; no phone number, link or name in any task text,
--     link or journal row made by the automation.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

DO $t297_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t297_auth_role$;

\echo T297_TELEPHONY_MISSED_TASKS_SUITE_START

CREATE FUNCTION pg_temp.t297_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t297_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T297: %', message; END IF;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t297_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
    result := 'ok';
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN result;
END
$$;
-- The JSONB result of a statement run as authenticated with the claims, or {"error": ...}.
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
-- A Bishkek local time as an instant: t297_at('2026-10-19 19:55').
CREATE FUNCTION pg_temp.t297_at(p_local TEXT) RETURNS TIMESTAMPTZ LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_local::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
$$;
CREATE FUNCTION pg_temp.t297_wm(p_local TEXT, p_minutes INTEGER, p_days SMALLINT[] DEFAULT '{1,2,3,4,5,6}',
  p_open TIME DEFAULT '10:00', p_close TIME DEFAULT '20:00') RETURNS TEXT LANGUAGE SQL AS $$
  SELECT to_char(platform_private.telephony_add_work_minutes(pg_temp.t297_at(p_local), p_minutes, p_days, p_open, p_close)
    AT TIME ZONE 'Asia/Bishkek', 'YYYY-MM-DD HH24:MI:SS')
$$;
CREATE FUNCTION pg_temp.t297_step(p_local TEXT, p_step JSONB, p_days SMALLINT[] DEFAULT '{1,2,3,4,5,6}',
  p_open TIME DEFAULT '10:00', p_close TIME DEFAULT '20:00') RETURNS TEXT LANGUAGE SQL AS $$
  SELECT to_char(platform_private.telephony_cadence_due(pg_temp.t297_at(p_local), p_step, p_days, p_open, p_close)
    AT TIME ZONE 'Asia/Bishkek', 'YYYY-MM-DD HH24:MI:SS')
$$;

-- The service path: the JWT role claim the public function checks.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (the one under test), 2 (another tenant, enabled too),
-- 3 (nobody to give a task to), 4 and 5 (ceilings).
--   actor 1  org 1 Admin A (system admin, created first)
--   actor 2  org 1 Admin B (system admin)
--   actor 3  org 1 sales S1 — the task role (staff.task.read / complete)
--   actor 4  org 1 sales S2 — the task role
--   actor 5  org 1 member with ONLY staff.task.complete (cannot receive a task: no read)
--   actor 11 org 1 member with ONLY staff.task.read (cannot receive a task: no complete)
--   actor 6  org 1 head — the task role; the escalation recipient
--   actor 7  org 2 Admin
--   actor 8  org 1 suspended member (lead owner who cannot work any more)
--   actor 9  org 4 Admin, actor 10 org 5 Admin
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t297_actors(n INTEGER PRIMARY KEY, org INTEGER, sysadmin BOOLEAN, status TEXT);
INSERT INTO t297_actors VALUES (1, 1, TRUE, 'active'), (2, 1, TRUE, 'active'), (3, 1, FALSE, 'active'),
  (4, 1, FALSE, 'active'), (5, 1, FALSE, 'active'), (6, 1, FALSE, 'active'), (7, 2, TRUE, 'active'),
  (8, 1, FALSE, 'suspended'), (9, 4, TRUE, 'active'), (10, 5, TRUE, 'active'), (11, 1, FALSE, 'active');
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t297_id(1), 'T297 Fictional organization', 'active'),
  (pg_temp.t297_id(2), 'T297 Other fictional organization', 'active'),
  (pg_temp.t297_id(3), 'T297 Organization without staff', 'active'),
  (pg_temp.t297_id(4), 'T297 Ceiling organization (hour)', 'active'),
  (pg_temp.t297_id(5), 'T297 Ceiling organization (day)', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t297_id(100 + n), 't297-' || n || '@example.invalid', '{}'::JSONB FROM t297_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t297_id(200 + n), pg_temp.t297_id(100 + n), 'T297 Actor ' || n, 'active', 1 FROM t297_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id,
  created_at)
  SELECT pg_temp.t297_id(300 + a.n), pg_temp.t297_id(a.org), pg_temp.t297_id(200 + a.n), a.status::platform.membership_status,
    CASE WHEN a.sysadmin THEN 'admin'::platform.business_role END,
    CASE WHEN a.sysadmin THEN (SELECT id FROM platform.role_bundle_versions
      WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 10:00:00+00' + make_interval(mins => a.n)
  FROM t297_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t297_id(300 + n) FROM t297_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t297_id(401), pg_temp.t297_id(1), 'organization', pg_temp.t297_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t297_id(1), pg_temp.t297_id(301), pg_temp.t297_id(401), 1, 1, TRUE, 'system', 'T297 synthetic scope', pg_temp.t297_id(601));

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t297_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t297_admin_setup \gset

-- The task role: created and published by the Admin through the real RPCs.
SELECT pg_temp.t297_assert(
  pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T297 create role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1101),
    jsonb_build_object('label', 'T297 task access', 'description', 'T297 synthetic staff.task role',
      'permissionKeys', '["staff.task.read","staff.task.complete"]'::JSONB),
    pg_temp.t297_id(1111))) ->> 'status' = 'applied'
  AND pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T297 create role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1102),
    jsonb_build_object('label', 'T297 complete only', 'description', 'T297 synthetic role without read',
      'permissionKeys', '["staff.task.complete"]'::JSONB),
    pg_temp.t297_id(1113))) ->> 'status' = 'applied'
  AND pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T297 create role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1103),
    jsonb_build_object('label', 'T297 read only', 'description', 'T297 synthetic role without complete',
      'permissionKeys', '["staff.task.read"]'::JSONB),
    pg_temp.t297_id(1114))) ->> 'status' = 'applied',
  'the Admin creates the task roles (read and complete, complete only, read only) through the real RPC');
SELECT pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T297 publish role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1101), pg_temp.t297_id(1), pg_temp.t297_id(1101), pg_temp.t297_id(1112))) ->> 'status' AS t297_published \gset
SELECT pg_temp.t297_assert(:'t297_published' = 'applied', 'the Admin publishes the task role');
SELECT pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T297 publish role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1102), pg_temp.t297_id(1), pg_temp.t297_id(1102), pg_temp.t297_id(1115))) ->> 'status' AS t297_published2 \gset
SELECT pg_temp.t297_call('authenticated', :'t297_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T297 publish role', %L::UUID)$q$,
    pg_temp.t297_id(1), pg_temp.t297_id(1103), pg_temp.t297_id(1), pg_temp.t297_id(1103), pg_temp.t297_id(1116))) ->> 'status' AS t297_published3 \gset
SELECT pg_temp.t297_assert(:'t297_published2' = 'applied' AND :'t297_published3' = 'applied', 'the Admin publishes the two narrow task roles');

CREATE FUNCTION pg_temp.t297_assign(p_actor INTEGER, p_req INTEGER, p_role INTEGER DEFAULT 1101) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT; v_claims TEXT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t297_id(200 + p_actor);
  SELECT jsonb_build_array(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', 'organization',
      'key', pg_temp.t297_id(1), 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version))
  INTO items, bindings
  FROM platform.staff_role_definitions r
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  WHERE r.id = pg_temp.t297_id(p_role);
  v_claims := (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(101),
    'claims', jsonb_build_object('sub', pg_temp.t297_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
  RETURN pg_temp.t297_call('authenticated', v_claims, format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t297_id(1), pg_temp.t297_id(300 + p_actor), v_version, items, bindings, 'T297 assign',
    pg_temp.t297_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t297_assert(
  pg_temp.t297_assign(3, 1) ->> 'status' = 'applied' AND pg_temp.t297_assign(4, 2) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(6, 3) ->> 'status' = 'applied'
  AND pg_temp.t297_assign(5, 4, 1102) ->> 'status' = 'applied' AND pg_temp.t297_assign(11, 5, 1103) ->> 'status' = 'applied',
  'the Admin gives the task role to S1, S2 and the head, and the narrow roles to the two members, through staff_role_assignments_save');

-- Eligibility facts the suite relies on: admins and the three task holders can receive a
-- task; the member who can only complete, the one who can only read and the suspended member
-- cannot.
SELECT pg_temp.t297_assert(
  platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(301))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(302))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(303))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(304))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(306))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(305))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(311))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), pg_temp.t297_id(308))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t297_id(1), NULL)
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t297_id(2), pg_temp.t297_id(303)),
  'only active staff with BOTH staff.task.read and staff.task.complete (or an Admin) can receive a task; another organization cannot');

-- ---------------------------------------------------------------------------
-- Clients and leads (client n has the phone +996700000nnn-style key from its number).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t297_phone(n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT '+99670000' || lpad(n::TEXT, 4, '0')
$$;
CREATE FUNCTION pg_temp.t297_client(p_n INTEGER, p_org INTEGER DEFAULT 1, p_phone TEXT DEFAULT NULL) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state)
  VALUES (pg_temp.t297_id(4000 + p_n), pg_temp.t297_id(p_org), 'T297 Client ' || p_n,
    platform_private.normalize_person_name('T297 Client ' || p_n), COALESCE(p_phone, pg_temp.t297_phone(p_n)),
    platform_private.normalize_person_phone(COALESCE(p_phone, pg_temp.t297_phone(p_n))), 'active')
$$;
CREATE FUNCTION pg_temp.t297_lead(p_n INTEGER, p_client INTEGER, p_owner INTEGER, p_org INTEGER DEFAULT 1,
  p_state TEXT DEFAULT 'open') RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  VALUES (pg_temp.t297_id(5000 + p_n), pg_temp.t297_id(p_org), pg_temp.t297_id(4000 + p_client),
    CASE WHEN p_owner IS NULL THEN NULL ELSE pg_temp.t297_id(300 + p_owner) END, 'new', 'website',
    p_state::platform.lead_lifecycle_state)
$$;
-- 1 S1's lead; 2 no owner; 3 the plain member's lead; 4 the suspended member's lead;
-- 5 only an archived lead of S2; 6 a client with no lead at all; 7 a client with no lead (results);
-- 8 cadence; 9-20 specials below; 21 and 22 share ONE phone (an ambiguous number).
SELECT pg_temp.t297_client(n) FROM generate_series(1, 27) n;
SELECT pg_temp.t297_lead(1, 1, 3);
SELECT pg_temp.t297_lead(2, 2, NULL);
SELECT pg_temp.t297_lead(3, 3, 5);
SELECT pg_temp.t297_lead(4, 4, 8);
SELECT pg_temp.t297_lead(5, 5, 4, 1, 'archived');
UPDATE platform.clients SET phone = '+996700007777', normalized_phone = platform_private.normalize_person_phone('+996700007777')
  WHERE id IN (pg_temp.t297_id(4021), pg_temp.t297_id(4022));
SELECT pg_temp.t297_lead(8, 8, 3);
SELECT pg_temp.t297_lead(9, 9, 3);
SELECT pg_temp.t297_lead(10, 10, 3);
SELECT pg_temp.t297_lead(11, 11, 3);
SELECT pg_temp.t297_lead(12, 12, 3);
SELECT pg_temp.t297_lead(13, 13, 3);
SELECT pg_temp.t297_lead(14, 14, 3);
SELECT pg_temp.t297_lead(15, 15, 3);
SELECT pg_temp.t297_lead(16, 16, 3);
SELECT pg_temp.t297_lead(17, 17, 3);
SELECT pg_temp.t297_lead(18, 18, 3);
SELECT pg_temp.t297_lead(19, 19, 3);
SELECT pg_temp.t297_lead(20, 20, 3);
-- 23 a lead nobody owns (admin fallback); 24 an archived lead of S2 next to the open lead 25 of S1;
-- 26 a client for the settings wiring check; 27 spare.
SELECT pg_temp.t297_lead(23, 23, NULL);
SELECT pg_temp.t297_lead(24, 24, 4, 1, 'archived');
SELECT pg_temp.t297_lead(25, 24, 3);
SELECT pg_temp.t297_lead(26, 26, 3);
-- Organization 2.
SELECT pg_temp.t297_client(90, 2);
SELECT pg_temp.t297_lead(90, 90, NULL, 2);
-- Organization 3 has no staff at all.
SELECT pg_temp.t297_client(91, 3);
SELECT pg_temp.t297_lead(91, 91, NULL, 3);
-- Organizations 4 and 5 (ceilings): four clients each, leads owned by their Admin.
SELECT pg_temp.t297_client(n, 4) FROM generate_series(100, 103) n;
SELECT pg_temp.t297_client(n, 5) FROM generate_series(110, 115) n;
SELECT pg_temp.t297_lead(n, n, 9, 4) FROM generate_series(100, 103) n;
SELECT pg_temp.t297_lead(n, n, 10, 5) FROM generate_series(110, 115) n;

-- A call. p_ago: how long ago it began; ended 30 s later; settled 90 s after that
-- (or p_settled_ago before now). Outcome NULL = still ringing.
CREATE FUNCTION pg_temp.t297_mk(p_k INTEGER, p_dir TEXT, p_outcome TEXT, p_ago INTERVAL, p_client INTEGER,
  p_lead INTEGER DEFAULT NULL, p_member INTEGER DEFAULT NULL, p_via TEXT DEFAULT 'webhook', p_org INTEGER DEFAULT 1,
  p_match TEXT DEFAULT NULL, p_settled_ago INTERVAL DEFAULT NULL, p_phone TEXT DEFAULT NULL, p_settle BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - p_ago;
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, client_phone, membership_id, client_id, lead_id, match_state, created_via)
  VALUES (pg_temp.t297_id(7000 + p_k), pg_temp.t297_id(p_org), 't297-call-' || p_k, p_dir,
    CASE WHEN p_outcome IS NULL THEN 'ringing' ELSE 'ended' END, p_outcome,
    CASE WHEN p_outcome IS NULL THEN NULL WHEN p_via = 'reconcile' THEN 'pull' ELSE 'webhook' END,
    v_start, CASE WHEN p_outcome = 'answered' THEN v_start + INTERVAL '5 seconds' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE v_start + INTERVAL '30 seconds' END,
    CASE WHEN NOT p_settle THEN NULL WHEN p_settled_ago IS NOT NULL THEN clock_timestamp() - p_settled_ago
      ELSE v_start + INTERVAL '120 seconds' END,
    COALESCE(p_phone, CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t297_phone(p_client) END),
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t297_id(300 + p_member) END,
    CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t297_id(4000 + p_client) END,
    CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t297_id(5000 + p_lead) END,
    COALESCE(p_match, CASE WHEN p_client IS NULL THEN 'unmatched' ELSE 'matched' END), p_via);
END
$$;
CREATE FUNCTION pg_temp.t297_tick(p_org INTEGER DEFAULT 1, p_limit INTEGER DEFAULT 100) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_automation_tick_v1(pg_temp.t297_id(p_org), p_limit)
$$;
CREATE FUNCTION pg_temp.t297_mark(p_k INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(c.automation_outcome, 'NULL') FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7000 + p_k)
$$;
-- The link row of a call by kind.
CREATE FUNCTION pg_temp.t297_link(p_k INTEGER, p_kind TEXT) RETURNS platform_private.telephony_task_links LANGUAGE SQL AS $$
  SELECT l FROM platform_private.telephony_task_links l
  WHERE l.call_id = pg_temp.t297_id(7000 + p_k) AND l.kind = p_kind ORDER BY l.created_at DESC, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t297_task(p_k INTEGER, p_kind TEXT) RETURNS platform.staff_tasks LANGUAGE SQL AS $$
  SELECT t FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
  WHERE l.call_id = pg_temp.t297_id(7000 + p_k) AND l.kind = p_kind ORDER BY l.created_at DESC, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t297_who(p_k INTEGER, p_kind TEXT) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (substr(t.assignee_membership_id::TEXT, 25)::INTEGER - 300) FROM platform_private.telephony_task_links l
  JOIN platform.staff_tasks t ON t.id = l.task_id WHERE l.call_id = pg_temp.t297_id(7000 + p_k) AND l.kind = p_kind
  ORDER BY l.created_at DESC, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t297_open(p_kind TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_task_links l
  WHERE l.organization_id = pg_temp.t297_id(p_org) AND l.closed_at IS NULL AND (p_kind IS NULL OR l.kind = p_kind)
$$;

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_automation_tick_v1', 'telephony_claim_work_v1', 'telephony_erase_person_v1',
    'telephony_extension_map_v1', 'telephony_integration_health_v1', 'telephony_lead_calls_v1',
    'telephony_maintenance_plan_v1', 'telephony_manage_overview_v1', 'telephony_project_work_v1',
    'telephony_purge_evidence_v1', 'telephony_receive_v1', 'telephony_reconcile_apply_v1',
    'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settings_save_v1',
    'telephony_settle_calls_v1', 'telephony_sync_extensions_v1'],
  'platform holds the full catalog of seventeen public telephony functions: the sixteen earlier ones (four of T1b, five of T4a, two of T11a, two of T5, three of T4b) and exactly one new');
SELECT pg_temp.t297_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.telephony_automation_tick_v1(uuid,integer)'::regprocedure),
  'the tick: owner-owned SECURITY DEFINER, empty search_path, VOLATILE, EXECUTE for service_role only');
SELECT pg_temp.t297_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  AND (SELECT bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('telephony_work_day_ok', 'telephony_add_work_minutes',
      'telephony_next_work_day_at', 'telephony_add_work_days', 'telephony_cadence_due', 'telephony_local_stamp',
      'telephony_task_assignee_ok', 'telephony_pick_assignee', 'telephony_head_assignee', 'telephony_call_responsible',
      'telephony_current_lead', 'telephony_open_link', 'telephony_task_create', 'telephony_task_merge',
      'telephony_task_close', 'telephony_ceiling_code', 'telephony_automation_trip', 'telephony_automation_missed',
      'telephony_automation_no_answer', 'telephony_automation_answered', 'telephony_automation_decide',
      'telephony_automation_result_callback')) = 22,
  'the 22 private helpers exist, no one is executable by PUBLIC or a client role, each has an empty search_path');
SELECT pg_temp.t297_assert((SELECT bool_and(
      pg_temp.t297_as(r.role, c.claims, format('SELECT platform.telephony_automation_tick_v1(%L)', pg_temp.t297_id(1))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"service_role"}'), ('{"role":"authenticated","sub":"29700000-0000-4000-8000-000000000101"}'), ('')) c(claims)),
  'anon, authenticated, supabase_auth_admin and the AI agent role are refused whatever the claims');
SELECT pg_temp.t297_assert((SELECT bool_and(pg_temp.t297_as('service_role', c.claims,
      format('SELECT platform.telephony_automation_tick_v1(%L)', pg_temp.t297_id(1))) = '42501')
    FROM (VALUES ('{"role":"authenticated"}'), ('{"role":"anon"}'), (''), ('{"sub":"29700000-0000-4000-8000-000000000101"}')) c(claims)),
  'service_role without the service claim is refused too (the role check is inside the function)');
SELECT pg_temp.t297_assert(
  pg_temp.t297_try(format('SELECT platform.telephony_automation_tick_v1(NULL)')) = '22023'
  AND pg_temp.t297_try(format('SELECT platform.telephony_automation_tick_v1(%L, 0)', pg_temp.t297_id(1))) = '22023'
  AND pg_temp.t297_try(format('SELECT platform.telephony_automation_tick_v1(%L, 1001)', pg_temp.t297_id(1))) = '22023'
  AND pg_temp.t297_try(format('SELECT platform.telephony_automation_tick_v1(%L, NULL)', pg_temp.t297_id(1))) = '22023'
  AND pg_temp.t297_try(format('SELECT platform.telephony_automation_tick_v1(%L)', pg_temp.t297_id(999))) = '22023',
  'a null or unknown organization and a limit outside 1..1000 are 22023');
SELECT pg_temp.t297_assert(pg_temp.t297_as('service_role', '{"role":"service_role"}',
    'SELECT platform_private.telephony_automation_decide(''29700000-0000-4000-8000-000000000001'', ''29700000-0000-4000-8000-000000007001'')') = '42501',
  'the decision helper is not callable by service_role');

-- ---------------------------------------------------------------------------
-- 2. Schema.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_mk(1, 'in', 'missed', INTERVAL '10 minutes', 1, 1, NULL, 'webhook', 1, NULL, NULL, NULL, FALSE);
SELECT pg_temp.t297_assert((SELECT automation_done_at IS NULL AND automation_outcome IS NULL
    FROM platform_private.telephony_calls WHERE id = pg_temp.t297_id(7001)),
  'a new call carries no automation mark');
SELECT pg_temp.t297_assert(
  pg_temp.t297_try($q$UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp()
    WHERE id = '29700000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t297_try($q$UPDATE platform_private.telephony_calls SET automation_outcome = 'task_created'
    WHERE id = '29700000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t297_try($q$UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(),
    automation_outcome = 'made_up' WHERE id = '29700000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t297_try($q$UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(),
    automation_outcome = 'task_created' WHERE id = '29700000-0000-4000-8000-000000007001'$q$) = 'ok',
  'the automation mark is both-or-neither and takes only the closed list');
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM pg_constraint WHERE conname = 'telephony_task_links_kind_check'
    AND pg_get_constraintdef(oid) LIKE '%no_answer_hint%' AND pg_get_constraintdef(oid) LIKE '%reached_followup%') = 1
  AND (SELECT column_default FROM information_schema.columns WHERE table_schema = 'platform_private'
    AND table_name = 'telephony_task_links' AND column_name = 'occurrences') = '1',
  'the link kinds gain no_answer_hint (reached_followup stays) and the counter starts at 1');
DELETE FROM platform_private.telephony_calls WHERE id = pg_temp.t297_id(7001);

-- ---------------------------------------------------------------------------
-- 3. Working-hours math (pure rules; Mon 2026-10-19, Sat 2026-10-17, Sun 2026-10-18).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_assert(
  pg_temp.t297_wm('2026-10-19 19:55', 15) = '2026-10-20 10:10:00'
  AND pg_temp.t297_wm('2026-10-19 03:00', 15) = '2026-10-19 10:15:00'
  AND pg_temp.t297_wm('2026-10-19 12:00', 15) = '2026-10-19 12:15:00'
  AND pg_temp.t297_wm('2026-10-19 19:45', 15) = '2026-10-19 20:00:00'
  AND pg_temp.t297_wm('2026-10-19 20:00', 15) = '2026-10-20 10:15:00'
  AND pg_temp.t297_wm('2026-10-19 09:59:30', 15) = '2026-10-19 10:15:00'
  AND pg_temp.t297_wm('2026-10-17 19:55', 15) = '2026-10-19 10:10:00'
  AND pg_temp.t297_wm('2026-10-18 11:00', 15) = '2026-10-19 10:15:00'
  AND pg_temp.t297_wm('2026-10-19 03:00', 0) = '2026-10-19 10:00:00'
  AND pg_temp.t297_wm('2026-10-19 10:00', 600) = '2026-10-19 20:00:00'
  AND pg_temp.t297_wm('2026-10-19 10:00', 601) = '2026-10-20 10:01:00'
  AND pg_temp.t297_wm('2026-10-31 19:55', 15) = '2026-11-02 10:10:00',
  'the plan examples (19:55 -> tomorrow 10:10, 03:00 -> 10:15), the opening and closing edges, Saturday and Sunday, a full day, a month end');
SELECT pg_temp.t297_assert(
  pg_temp.t297_wm('2026-10-23 19:55', 15, '{1,2,3,4,5}') = '2026-10-26 10:10:00'
  AND pg_temp.t297_wm('2026-10-24 12:00', 15, '{1,2,3,4,5}') = '2026-10-26 10:15:00'
  AND pg_temp.t297_wm('2026-10-19 08:00', 15, '{1,2,3,4,5,6}', '09:00', '18:00') = '2026-10-19 09:15:00'
  AND pg_temp.t297_wm('2026-10-19 17:50', 20, '{1,2,3,4,5,6}', '09:00', '18:00') = '2026-10-20 09:10:00'
  AND pg_temp.t297_wm('2026-10-18 10:00', 15, '{7}') = '2026-10-18 10:15:00'
  AND pg_temp.t297_wm('2026-10-20 10:00', 15, '{2}') = '2026-10-20 10:15:00'
  AND pg_temp.t297_wm('2026-10-20 19:55', 15, '{2}') = '2026-10-27 10:10:00',
  'another week, other hours and a single working day follow the settings');
SELECT pg_temp.t297_assert(
  to_char(platform_private.telephony_add_work_minutes('2026-10-18 20:00:00+00', 15, '{1,2,3,4,5,6}', '10:00', '20:00')
    AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') = '2026-10-19 04:15'
  AND to_char(platform_private.telephony_add_work_minutes('2026-10-19 13:55:00+00', 15, '{1,2,3,4,5,6}', '10:00', '20:00')
    AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') = '2026-10-20 04:10',
  'the local day decides, not the UTC day (Monday 02:00 local is Sunday 20:00 UTC)');
SELECT pg_temp.t297_assert(
  pg_temp.t297_step('2026-10-19 15:30', '{"unit":"work_hours","n":2}') = '2026-10-19 17:30:00'
  AND pg_temp.t297_step('2026-10-19 19:00', '{"unit":"work_hours","n":2}') = '2026-10-20 11:00:00'
  AND pg_temp.t297_step('2026-10-19 15:30', '{"unit":"next_work_day_at","at":"11:00"}') = '2026-10-20 11:00:00'
  AND pg_temp.t297_step('2026-10-17 15:30', '{"unit":"next_work_day_at","at":"11:00"}') = '2026-10-19 11:00:00'
  AND pg_temp.t297_step('2026-10-23 15:30', '{"unit":"next_work_day_at","at":"11:00"}', '{1,2,3,4,5}') = '2026-10-26 11:00:00'
  AND pg_temp.t297_step('2026-10-19 15:30', '{"unit":"next_work_day_at","at":"09:00"}') = '2026-10-20 10:00:00'
  AND pg_temp.t297_step('2026-10-19 15:30', '{"unit":"next_work_day_at","at":"23:30"}') = '2026-10-20 20:00:00'
  AND pg_temp.t297_step('2026-10-23 15:30', '{"unit":"work_days","n":2}') = '2026-10-26 15:30:00'
  AND pg_temp.t297_step('2026-10-22 15:30', '{"unit":"work_days","n":2}', '{1,2,3,4,5}') = '2026-10-26 15:30:00'
  AND pg_temp.t297_step('2026-10-19 03:10', '{"unit":"work_days","n":2}') = '2026-10-21 10:00:00'
  AND pg_temp.t297_step('2026-10-19 15:30', '{"unit":"work_days","n":1}') = '2026-10-20 15:30:00',
  'the three cadence units: +N working hours, the next working day at HH:MM (clamped to the working hours), +N working days at the same time');
SELECT pg_temp.t297_assert(
  pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(NULL, 15, '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), -1, '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), 10081, '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), 15, '{}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), 15, '{1,8}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), 15, '{1}', '20:00', '10:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_minutes(now(), 15, '{1}', NULL, '10:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_cadence_due(now(), '{"unit":"weeks","n":1}', '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_cadence_due(now(), '{"unit":"work_hours","n":99}', '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_add_work_days(now(), 31, '{1}', '10:00', '20:00')$q$) = '22023'
  AND pg_temp.t297_try($q$SELECT platform_private.telephony_next_work_day_at(now(), NULL, '{1}', '10:00', '20:00')$q$) = '22023',
  'a null instant, a negative or too long span, no or bad working days, closing before opening, a bad cadence step: 22023');
SELECT pg_temp.t297_assert(platform_private.telephony_local_stamp('2026-10-19 13:55:00+00') = '19.10 в 19:55',
  'the task text stamp is the local date and time');

-- ---------------------------------------------------------------------------
-- 4. The switches (organization 1 has calls waiting; nothing may happen while off).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_mk(1, 'in', 'missed', INTERVAL '10 minutes', 1, 1);
SELECT pg_temp.t297_assert(pg_temp.t297_tick() = '{"status":"disabled"}'::JSONB,
  'with no settings row the tick answers disabled');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t297_id(1));
SELECT pg_temp.t297_assert((SELECT NOT projection_enabled AND NOT missed_task_enabled AND NOT unknown_lead_enabled
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t297_id(1)),
  'every flag of a new settings row ships OFF');
UPDATE platform_private.telephony_settings SET missed_task_enabled = TRUE WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_assert(pg_temp.t297_tick() = '{"status":"disabled"}'::JSONB,
  'projection off: disabled even with the automation flag on');
UPDATE platform_private.telephony_settings SET projection_enabled = TRUE, missed_task_enabled = FALSE
  WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_assert(pg_temp.t297_tick() = '{"status":"disabled"}'::JSONB,
  'automation flag off: disabled even with the projection on');
SELECT pg_temp.t297_assert((SELECT count(*) FROM platform_private.telephony_task_links) = 0
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t297_id(1)) = 0
  AND pg_temp.t297_mark(1) = 'NULL',
  'while off nothing is created and the waiting call stays unmarked');
-- The bulk of the suite runs with working hours that cover the whole day, so every due time is
-- plain wall-clock arithmetic whatever the hour the suite runs at (section 11 checks that the
-- real hours and minutes of the settings drive the same function), and with the highest ceilings
-- the bulk makes dozens of tasks (sections 9 uses its own organizations for the ceilings).
UPDATE platform_private.telephony_settings SET missed_task_enabled = TRUE,
  escalation_membership_id = pg_temp.t297_id(306), working_days = '{1,2,3,4,5,6,7}', work_from = '00:00',
  work_to = '23:59:59', ceiling_tasks_hour = 300, ceiling_tasks_day = 1200
  WHERE organization_id = pg_temp.t297_id(1);
-- The first call is dealt with in section 5; its fixture row is kept.

-- ---------------------------------------------------------------------------
-- 5. Missed inbound calls.
-- ---------------------------------------------------------------------------
-- 1  client 1 / lead 1 (owner S1)         -> task for S1
-- 2  client 1 / lead 1, a second miss     -> merged (counter 2)
-- 3  client 2 / lead 2 (no owner)         -> the head
-- 4  client 3 / lead 3 (plain member)     -> the head (the owner cannot receive tasks)
-- 5  client 4 / lead 4 (suspended)        -> the head
-- 6  client 5, only an archived lead of S2 -> S2 (last owner), the call has no lead
-- 7  client 6, no lead at all             -> the head
-- 8  ambiguous (clients 7 and 8 share one phone) -> «Проверить звонок» for the head
-- 9  unmatched                            -> left to T9
-- 10/11 a chain: 10 missed, 11 (linked) answered by an employee -> chain
-- 12/13 client 9: 12 missed, 13 answered LATER -> later_answered / nothing
-- 14 old (settled 3 h ago); 15 reconcile started 3 h ago settled now; 16 reconcile 1 h ago -> task
-- 17 backfill, 18 not settled, 19 settled without an outcome
SELECT pg_temp.t297_tick() ->> 'status' AS t297_s \gset
SELECT pg_temp.t297_assert(:'t297_s' = 'ok', 'the tick runs once the flags are on');
SELECT pg_temp.t297_assert(
  pg_temp.t297_mark(1) = 'task_created' AND pg_temp.t297_who(1, 'missed_callback') = 3,
  'a missed inbound call of a lead owned by S1 creates one «Перезвонить» for S1');
SELECT pg_temp.t297_assert(
  (SELECT t.due_at BETWEEN c.ended_at + INTERVAL '14 minutes 59 seconds' AND c.ended_at + INTERVAL '15 minutes 6 seconds'
    FROM platform.staff_tasks t JOIN platform_private.telephony_task_links l ON l.task_id = t.id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE c.id = pg_temp.t297_id(7001)),
  'with working hours that cover the day the due time is the miss plus 15 minutes of wall clock');
SELECT pg_temp.t297_assert(
  (SELECT t.title = 'Перезвонить клиенту' AND t.status = 'open' AND t.priority = 'high'
      AND t.creator_membership_id = t.assignee_membership_id AND t.due_on IS NULL AND t.version = 1
      AND t.description LIKE 'Пропущенный входящий звонок %' AND t.description LIKE '% Пропущено звонков: 1.'
      AND t.due_at = platform_private.telephony_add_work_minutes(c.ended_at, 15, '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform.staff_tasks t JOIN platform_private.telephony_task_links l ON l.task_id = t.id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE c.id = pg_temp.t297_id(7001)),
  'the task: title, open, high priority, creator = assignee, one version, a due time of 15 working minutes after the miss');
SELECT pg_temp.t297_assert(
  (SELECT l.kind = 'missed_callback' AND l.scope_id = pg_temp.t297_id(5001) AND l.lead_id = pg_temp.t297_id(5001)
      AND l.client_id = pg_temp.t297_id(4001) AND l.occurrences = 1 AND l.closed_at IS NULL
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7001))
  AND (SELECT count(*) FROM platform.staff_task_events e JOIN platform_private.telephony_task_links l ON l.task_id = e.staff_task_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND e.action = 'create' AND e.version = 1) = 1
  AND (SELECT count(*) FROM platform_private.staff_task_receipts r JOIN platform_private.telephony_task_links l ON l.task_id = r.staff_task_id
    WHERE l.call_id = pg_temp.t297_id(7001)) = 1
  AND (SELECT count(*) FROM platform_private.staff_lead_task_links x JOIN platform_private.telephony_task_links l ON l.task_id = x.staff_task_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND x.lead_id = pg_temp.t297_id(5001)) = 1
  AND (SELECT count(*) FROM platform.staff_notifications n JOIN platform_private.telephony_task_links l ON l.task_id = n.staff_task_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND n.kind = 'task_assigned' AND n.recipient_membership_id = pg_temp.t297_id(303)) = 1
  AND (SELECT count(*) FROM platform.audit_events a JOIN platform_private.telephony_task_links l ON l.task_id = a.resource_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND a.action = 'staff.task.create' AND a.actor_kind = 'system'
      AND a.actor_principal = 'telephony-automation' AND a.resource_type = 'staff_task') = 1,
  'the link (lead scope), the create event, the receipt, the lead link, the «assigned» notification and one system journal row exist');
SELECT pg_temp.t297_tick() AS t297_again \gset
SELECT pg_temp.t297_assert((:'t297_again'::JSONB ->> 'created')::INTEGER = 0 AND (:'t297_again'::JSONB ->> 'merged')::INTEGER = 0
  AND (SELECT count(*) FROM platform_private.telephony_task_links) = 1
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t297_id(1)) = 1,
  'a second tick changes nothing: one decision per call (idempotent)');

-- A second miss of the same lead raises the counter, not the number of tasks.
SELECT pg_temp.t297_mk(2, 'in', 'missed', INTERVAL '5 minutes', 1, 1);
SELECT pg_temp.t297_tick() AS t297_merge \gset
SELECT pg_temp.t297_assert((:'t297_merge'::JSONB ->> 'merged')::INTEGER = 1 AND (:'t297_merge'::JSONB ->> 'created')::INTEGER = 0
  AND pg_temp.t297_mark(2) = 'task_merged'
  AND (SELECT count(*) FROM platform_private.telephony_task_links) = 1
  AND (SELECT l.occurrences = 2 FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7001))
  AND (SELECT t.version = 2 AND t.description LIKE '% Пропущено звонков: 2. Последний — %.'
      AND t.due_at = platform_private.telephony_add_work_minutes(c.ended_at, 15, '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform.staff_tasks t JOIN platform_private.telephony_task_links l ON l.task_id = t.id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE c.id = pg_temp.t297_id(7001))
  AND (SELECT count(*) FROM platform.staff_task_events e JOIN platform_private.telephony_task_links l ON l.task_id = e.staff_task_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND e.action = 'edit' AND e.version = 2) = 1
  AND (SELECT count(*) FROM platform.audit_events a JOIN platform_private.telephony_task_links l ON l.task_id = a.resource_id
    WHERE l.call_id = pg_temp.t297_id(7001) AND a.action = 'staff.task.edit' AND a.actor_kind = 'system') = 1,
  'a repeated miss raises the counter in the open task (version 2, an edit event, a journal row) and keeps the first due time');

-- Fallbacks of the responsible person.
SELECT pg_temp.t297_mk(3, 'in', 'missed', INTERVAL '9 minutes', 2, 2);
SELECT pg_temp.t297_mk(4, 'in', 'missed', INTERVAL '9 minutes', 3, 3);
SELECT pg_temp.t297_mk(5, 'in', 'missed', INTERVAL '9 minutes', 4, 4);
SELECT pg_temp.t297_mk(6, 'in', 'missed', INTERVAL '9 minutes', 5, NULL);
SELECT pg_temp.t297_mk(7, 'in', 'missed', INTERVAL '9 minutes', 6, NULL);
SELECT pg_temp.t297_mk(8, 'in', 'missed', INTERVAL '9 minutes', NULL, NULL, NULL, 'webhook', 1, 'ambiguous', NULL, '+996700007777');
SELECT pg_temp.t297_mk(9, 'in', 'missed', INTERVAL '9 minutes', NULL, NULL, NULL, 'webhook', 1, NULL, NULL, '+996700008888');
SELECT pg_temp.t297_tick() AS t297_fb \gset
SELECT pg_temp.t297_assert(
  pg_temp.t297_who(3, 'missed_callback') = 6 AND pg_temp.t297_who(4, 'missed_callback') = 6
  AND pg_temp.t297_who(5, 'missed_callback') = 6 AND pg_temp.t297_who(7, 'missed_callback') = 6,
  'no owner, an owner who cannot receive a task and a suspended owner fall to the head; no lead at all too');
SELECT pg_temp.t297_assert(
  pg_temp.t297_who(6, 'missed_callback') = 4
  AND (SELECT l.lead_id IS NULL AND l.client_id = pg_temp.t297_id(4005) AND l.scope_id = pg_temp.t297_id(4005)
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7006)),
  'a client without an open lead gives the task to the last owner of the client''s leads, scoped to the client');
SELECT pg_temp.t297_assert(
  pg_temp.t297_mark(8) = 'task_created' AND pg_temp.t297_who(8, 'verify_call') = 6
  AND (SELECT l.client_id IS NULL AND l.lead_id IS NULL AND l.scope_id = pg_temp.t297_id(7008)
      AND t.title = 'Проверить звонок' AND t.priority = 'normal'
      AND t.description LIKE '%номер % есть у нескольких клиентов%'
      AND t.description NOT LIKE '%996700007777%'
      AND t.due_at = platform_private.telephony_add_work_minutes(c.ended_at, 15, '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7008)),
  'an ambiguous number gives «Проверить звонок» to the head, scoped to the call, with a masked number only');
SELECT pg_temp.t297_assert(
  pg_temp.t297_mark(9) = 'skipped_unmatched'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7009)),
  'an unmatched number gets only a mark: the «Звонок» lead is slice T9');
SELECT pg_temp.t297_assert(pg_temp.t297_open('missed_callback') = 6 AND pg_temp.t297_open('verify_call') = 1
  AND (:'t297_fb'::JSONB ->> 'created')::INTEGER = 6 AND (:'t297_fb'::JSONB ->> 'skipped')::INTEGER = 1
  AND (:'t297_fb'::JSONB ->> 'failed')::INTEGER = 0,
  'six lead or client «Перезвонить» tasks and one «Проверить звонок» are open; the counters say so');

-- The assignee sees the task through the real task list that «Сегодня» and «Задачи» read.
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t297_id(106),
  'claims', jsonb_build_object('sub', pg_temp.t297_id(106), 'role', 'authenticated'))) -> 'claims')::TEXT AS t297_head_claims \gset
SELECT pg_temp.t297_call('authenticated', :'t297_head_claims', format(
  $q$SELECT jsonb_build_object('rows', (SELECT count(*) FROM platform.staff_task_list(%L::UUID, 'mine', 'active')),
    'generic', (SELECT count(*) FROM platform.staff_task_list(%L::UUID, 'mine', 'active')
      WHERE title IN ('Перезвонить клиенту', 'Проверить звонок') AND due_at IS NOT NULL AND status = 'open'),
    'other', (SELECT count(*) FROM platform.staff_task_list(%L::UUID, 'mine', 'active')
      WHERE assignee_membership_id <> %L::UUID))$q$,
  pg_temp.t297_id(1), pg_temp.t297_id(1), pg_temp.t297_id(1), pg_temp.t297_id(306))) AS t297_head_list \gset
SELECT pg_temp.t297_assert((:'t297_head_list'::JSONB ->> 'rows')::INTEGER = 5 AND (:'t297_head_list'::JSONB ->> 'generic')::INTEGER = 5
  AND (:'t297_head_list'::JSONB ->> 'other')::INTEGER = 0,
  'the head sees exactly the five open tasks made for him (four «Перезвонить», one «Проверить звонок») through staff_task_list');

-- The administrator fallback: with an escalation recipient who cannot receive tasks, or none, a
-- lead nobody owns goes to the earliest administrator (Admin A, not Admin B).
UPDATE platform_private.telephony_settings SET escalation_membership_id = pg_temp.t297_id(305)
  WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_mk(140, 'in', 'missed', INTERVAL '8 minutes', 23, 23);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_who(140, 'missed_callback') = 1,
  'the escalation recipient cannot receive tasks: the lead nobody owns goes to the earliest Admin');
UPDATE platform_private.telephony_settings SET escalation_membership_id = NULL WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_mk(141, 'in', 'missed', INTERVAL '8 minutes', 27, NULL);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_who(141, 'missed_callback') = 1,
  'no escalation recipient and no lead at all: the earliest Admin');
UPDATE platform_private.telephony_settings SET escalation_membership_id = pg_temp.t297_id(306)
  WHERE organization_id = pg_temp.t297_id(1);

-- The call of an archived lead belongs to the client''s open lead and its owner.
SELECT pg_temp.t297_mk(142, 'in', 'missed', INTERVAL '8 minutes', 24, 24);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_who(142, 'missed_callback') = 3
  AND (SELECT l.lead_id = pg_temp.t297_id(5025) AND l.scope_id = pg_temp.t297_id(5025)
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7142)),
  'a call matched to an archived lead is tasked on the client''s open lead, for that lead''s owner');

-- The chain rule, the later-answered rule.
SELECT pg_temp.t297_mk(10, 'in', 'missed', INTERVAL '25 minutes', 10, 10);
SELECT pg_temp.t297_mk(11, 'in', 'answered', INTERVAL '24 minutes', 10, 10, 3);
UPDATE platform_private.telephony_calls SET linked_call_id = pg_temp.t297_id(7011) WHERE id = pg_temp.t297_id(7010);
SELECT pg_temp.t297_mk(12, 'in', 'missed', INTERVAL '40 minutes', 9, 9);
SELECT pg_temp.t297_mk(13, 'in', 'answered', INTERVAL '30 minutes', 9, 9, 3);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(10) = 'skipped_chain' AND pg_temp.t297_mark(11) = 'nothing_to_do'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id IN (pg_temp.t297_id(7010), pg_temp.t297_id(7011))),
  'a missed call chained to an answered one is one contact: no task (rule 8)');
SELECT pg_temp.t297_assert(pg_temp.t297_mark(12) = 'later_answered' AND pg_temp.t297_mark(13) = 'nothing_to_do'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7012)),
  'a miss followed by an answered call of the same client gets no task');

-- Age rule, backfill, unsettled, no outcome.
SELECT pg_temp.t297_mk(14, 'in', 'missed', INTERVAL '4 hours', 11, 11, NULL, 'webhook', 1, NULL, INTERVAL '3 hours');
SELECT pg_temp.t297_mk(15, 'in', 'missed', INTERVAL '3 hours', 12, 12, NULL, 'reconcile', 1, NULL, INTERVAL '1 minute');
SELECT pg_temp.t297_mk(16, 'in', 'missed', INTERVAL '1 hour', 13, 13, NULL, 'reconcile');
SELECT pg_temp.t297_mk(17, 'in', 'missed', INTERVAL '10 minutes', 14, 14, NULL, 'backfill');
SELECT pg_temp.t297_mk(18, 'in', 'missed', INTERVAL '10 minutes', 15, 15, NULL, 'webhook', 1, NULL, NULL, NULL, FALSE);
SELECT pg_temp.t297_mk(19, 'in', NULL, INTERVAL '10 minutes', 16, 16);
UPDATE platform_private.telephony_calls SET settled_at = clock_timestamp() - INTERVAL '1 minute', needs_review = TRUE
  WHERE id = pg_temp.t297_id(7019);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(14) = 'skipped_old' AND pg_temp.t297_mark(15) = 'skipped_old'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id IN (pg_temp.t297_id(7014), pg_temp.t297_id(7015))),
  'a call settled more than two hours ago, and a reconcile row that began more than two hours ago, are not tasked');
SELECT pg_temp.t297_assert(pg_temp.t297_mark(16) = 'task_created' AND pg_temp.t297_who(16, 'missed_callback') = 3,
  'a reconcile row of the last two hours is tasked like a webhook row');
-- A reconcile row flagged for review (a possible duplicate of a webhook call) must not double the counter.
SELECT pg_temp.t297_mk(143, 'in', 'missed', INTERVAL '10 minutes', 2, 2, NULL, 'reconcile', 1, NULL, INTERVAL '1 minute');
UPDATE platform_private.telephony_calls SET needs_review = TRUE WHERE id = pg_temp.t297_id(7143);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(143) = 'skipped_outcome'
  AND (SELECT occurrences = 1 FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7003))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7143)),
  'a reconcile row flagged for review (a possible duplicate) creates nothing and does not raise a counter');
-- A webhook call flagged for review is still a real call (the flag only says a field was missing).
SELECT pg_temp.t297_mk(144, 'in', 'missed', INTERVAL '10 minutes', 5, NULL);
UPDATE platform_private.telephony_calls SET needs_review = TRUE WHERE id = pg_temp.t297_id(7144);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(144) = 'task_merged',
  'a webhook call flagged for review is still tasked (a message with a missing field is a real missed call)');
SELECT pg_temp.t297_assert(pg_temp.t297_mark(17) = 'NULL' AND pg_temp.t297_mark(18) = 'NULL'
  AND pg_temp.t297_mark(19) = 'skipped_outcome',
  'backfill and unsettled calls are never touched; a settled call with no outcome is skipped');

-- Nobody to give a task to (organization 3 has no staff): skipped, not an error.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, missed_task_enabled)
  VALUES (pg_temp.t297_id(3), TRUE, TRUE);
SELECT pg_temp.t297_mk(30, 'in', 'missed', INTERVAL '5 minutes', 91, 91, NULL, 'webhook', 3);
SELECT pg_temp.t297_tick(3) AS t297_o3 \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(30) = 'skipped_no_assignee' AND (:'t297_o3'::JSONB ->> 'failed')::INTEGER = 0
  AND (:'t297_o3'::JSONB ->> 'skipped')::INTEGER = 1
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.organization_id = pg_temp.t297_id(3)),
  'with nobody able to receive a task the call is marked skipped_no_assignee and nothing is created');

-- A task a human finished does not block the next one.
SELECT pg_temp.t297_mk(40, 'in', 'missed', INTERVAL '20 minutes', 17, 17);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(40) = 'task_created', 'client 17: a task is created');
UPDATE platform.staff_tasks SET status = 'done', version = version + 1
  WHERE id = (pg_temp.t297_task(40, 'missed_callback')).id;
SELECT pg_temp.t297_mk(41, 'in', 'missed', INTERVAL '5 minutes', 17, 17);
SELECT pg_temp.t297_tick() AS t297_done \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(41) = 'task_created'
  AND (SELECT closed_reason = 'task_done' AND closed_call_id IS NULL FROM platform_private.telephony_task_links
    WHERE call_id = pg_temp.t297_id(7040))
  AND (SELECT closed_at IS NULL AND occurrences = 1 FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7041))
  AND (pg_temp.t297_task(41, 'missed_callback')).id <> (pg_temp.t297_task(40, 'missed_callback')).id,
  'a task finished by a person closes its link (task_done) and the next miss creates a NEW task instead of merging');

-- ---------------------------------------------------------------------------
-- 6. Auto-close by an answered call.
-- ---------------------------------------------------------------------------
-- Client 1 has an open task (calls 1 and 2). An unrelated client's answer changes nothing.
SELECT pg_temp.t297_mk(50, 'out', 'answered', INTERVAL '3 minutes', 18, 18, 3);
SELECT pg_temp.t297_tick() AS t297_other \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(50) = 'nothing_to_do'
  AND (SELECT closed_at IS NULL FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7001)),
  'an answered call of another client closes nothing');
-- The answered call of client 1 began after the call of its task: the task closes.
SELECT pg_temp.t297_mk(51, 'out', 'answered', INTERVAL '2 minutes', 1, 1, 3);
SELECT pg_temp.t297_tick() AS t297_close \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(51) = 'tasks_closed' AND (:'t297_close'::JSONB ->> 'closed')::INTEGER = 1,
  'a later answered call of the client closes the open «Перезвонить»');
SELECT pg_temp.t297_assert(
  (SELECT t.status = 'done' AND t.version = 3 FROM platform.staff_tasks t WHERE t.id = (pg_temp.t297_task(1, 'missed_callback')).id)
  AND (SELECT l.closed_reason = 'answered_call' AND l.closed_call_id = pg_temp.t297_id(7051) AND l.closed_at IS NOT NULL
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7001))
  AND (SELECT count(*) FROM platform.staff_task_events e WHERE e.staff_task_id = (pg_temp.t297_task(1, 'missed_callback')).id
    AND e.action = 'status' AND e.version = 3) = 1
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.resource_id = (pg_temp.t297_task(1, 'missed_callback')).id
    AND a.action = 'staff.task.status' AND a.actor_kind = 'system' AND a.after_state ->> 'status' = 'done'
    AND a.after_state ->> 'callId' = pg_temp.t297_id(7051)::TEXT) = 1,
  'the staff task is done (version 3), with a status event and a system journal row; the link names the closing call');
SELECT pg_temp.t297_tick() AS t297_close2 \gset
-- Open «Перезвонить» now: calls 3, 4, 5, 6, 7 (fallback owners), 140, 141, 142 (admin fallback and the archived lead),
-- 16 (reconcile) and 41 (client 17, the second task).
SELECT pg_temp.t297_assert((:'t297_close2'::JSONB ->> 'closed')::INTEGER = 0 AND pg_temp.t297_open('missed_callback') = 10,
  'a repeated tick closes nothing more (idempotent)');
-- After the close a new miss opens a new task.
SELECT pg_temp.t297_mk(52, 'in', 'missed', INTERVAL '1 minute', 1, 1, NULL, 'webhook', 1, NULL, INTERVAL '10 seconds');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(52) = 'task_created' AND pg_temp.t297_open('missed_callback') = 11,
  'once the task is closed the open key is free: the next miss creates a new task');

-- An answered call that began BEFORE the call of the task does not close it.
SELECT pg_temp.t297_mk(53, 'in', 'missed', INTERVAL '20 minutes', 19, 19, NULL, 'webhook', 1, NULL, INTERVAL '15 minutes');
SELECT pg_temp.t297_mk(54, 'in', 'answered', INTERVAL '30 minutes', 19, 19, 3, 'webhook', 1, NULL, INTERVAL '5 minutes');
-- (54 began earlier and settled later; 53 is processed first and is not «later answered».)
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(53) = 'task_created' AND pg_temp.t297_mark(54) = 'nothing_to_do'
  AND (SELECT closed_at IS NULL FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7053)),
  'an answered call that began before the call of the task leaves the task open');

-- A reconciliation that turns the missed call into an answered one closes its own task.
SELECT pg_temp.t297_mk(55, 'in', 'missed', INTERVAL '8 minutes', 20, 20);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(55) = 'task_created', 'client 20: a task is created');
UPDATE platform_private.telephony_calls SET state = 'ended', outcome = 'answered', answered_at = started_at + INTERVAL '5 seconds',
  membership_id = pg_temp.t297_id(303), talk_seconds = 40 WHERE id = pg_temp.t297_id(7055);
SELECT pg_temp.t297_tick() AS t297_promoted \gset
SELECT pg_temp.t297_assert((:'t297_promoted'::JSONB ->> 'closed')::INTEGER = 1
  AND (SELECT l.closed_reason = 'answered_call' AND l.closed_call_id = pg_temp.t297_id(7055)
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7055))
  AND (pg_temp.t297_task(55, 'missed_callback')).status = 'done',
  'a call the reconciliation later finds answered closes the task made for it');

-- An unanswered outbound call the reconciliation later finds answered: the cadence task closes and
-- the automatic «Недозвон» is taken back (an answered call carries only the employee's result).
SELECT pg_temp.t297_mk(160, 'out', 'busy', INTERVAL '6 minutes', 27, NULL, NULL, 'webhook', 1, NULL, INTERVAL '5 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(160) = 'no_answer_task'
  AND (SELECT result_code = 'no_answer' FROM platform_private.telephony_calls WHERE id = pg_temp.t297_id(7160)),
  'client 27: an unanswered outbound call gets «Недозвон» and a cadence task');
UPDATE platform_private.telephony_calls SET state = 'ended', outcome = 'answered', answered_at = started_at + INTERVAL '5 seconds',
  membership_id = pg_temp.t297_id(303), talk_seconds = 20 WHERE id = pg_temp.t297_id(7160);
SELECT pg_temp.t297_tick() AS t297_promoted2 \gset
SELECT pg_temp.t297_assert((:'t297_promoted2'::JSONB ->> 'closed')::INTEGER = 1
  AND (SELECT result_code IS NULL AND result_at IS NULL AND result_by IS NULL
    FROM platform_private.telephony_calls WHERE id = pg_temp.t297_id(7160))
  AND (SELECT l.closed_reason = 'answered_call' FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7160) AND l.kind = 'no_answer_callback'),
  'a reconciled answer closes the cadence task and takes the automatic «Недозвон» back');

-- ---------------------------------------------------------------------------
-- 7. Unanswered outbound calls: «Недозвон» and the cadence (client 8 / lead 8, owner S1).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t297_mk(60, 'out', 'busy', INTERVAL '70 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '65 minutes');
SELECT pg_temp.t297_tick() AS t297_n1 \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(60) = 'no_answer_task' AND (:'t297_n1'::JSONB ->> 'created')::INTEGER = 1
  AND (SELECT c.result_code = 'no_answer' AND c.result_by IS NULL AND c.result_at IS NOT NULL AND c.result_callback_on IS NULL
    FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t297_id(7060))
  AND pg_temp.t297_who(60, 'no_answer_callback') = 3
  AND (SELECT t.title = 'Перезвонить клиенту: недозвон' AND t.priority = 'normal' AND t.status = 'open'
      AND t.description LIKE '%Недозвонов подряд: 1.'
      AND t.due_at = platform_private.telephony_cadence_due(c.ended_at, '{"unit":"work_hours","n":2}', '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7060))
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.resource_id = pg_temp.t297_id(7060)
    AND a.action = 'telephony.result.set' AND a.actor_kind = 'system' AND a.after_state ->> 'resultCode' = 'no_answer') = 1,
  'the first miss: result «Недозвон» without an author, a task in 2 working hours for the lead owner, one journal row');
SELECT pg_temp.t297_mk(61, 'out', 'unavailable', INTERVAL '60 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '55 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(61) = 'no_answer_task'
  AND (SELECT l.closed_reason = 'replaced' AND l.closed_call_id = pg_temp.t297_id(7061) FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7060))
  AND (pg_temp.t297_task(60, 'no_answer_callback')).status = 'cancelled'
  AND pg_temp.t297_open('no_answer_callback') = 1
  AND (SELECT t.description LIKE '%Недозвонов подряд: 2.'
      AND t.due_at = platform_private.telephony_cadence_due(c.ended_at, '{"unit":"next_work_day_at","at":"11:00"}', '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7061)),
  'the second miss replaces the previous task (cancelled, link replaced) and moves to the next working day at 11:00');
SELECT pg_temp.t297_mk(62, 'out', 'not_found', INTERVAL '50 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '45 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(
  (SELECT t.description LIKE '%Недозвонов подряд: 3.'
      AND t.due_at = platform_private.telephony_cadence_due(c.ended_at, '{"unit":"work_days","n":2}', '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7062))
  AND pg_temp.t297_open('no_answer_callback') = 1,
  'the third miss: +2 working days');
SELECT pg_temp.t297_mk(63, 'out', 'cancelled', INTERVAL '40 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '35 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(
  (SELECT t.description LIKE '%Недозвонов подряд: 4.'
      AND t.due_at = platform_private.telephony_cadence_due(c.ended_at, '{"unit":"work_days","n":2}', '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7063))
  AND pg_temp.t297_open('no_answer_hint') = 0,
  'the fourth miss stays on the last step; no hint yet (four misses)');
SELECT pg_temp.t297_mk(64, 'out', 'missed', INTERVAL '30 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '25 minutes');
SELECT pg_temp.t297_tick() AS t297_n5 \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(64) = 'no_answer_task' AND pg_temp.t297_open('no_answer_hint') = 1
  AND pg_temp.t297_who(64, 'no_answer_hint') = 6
  AND (SELECT t.title = 'Клиент не отвечает' AND t.description LIKE 'Недозвонов за семь дней: 5. %'
      AND l.scope_id = pg_temp.t297_id(5008)
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    WHERE l.call_id = pg_temp.t297_id(7064) AND l.kind = 'no_answer_hint'),
  'five misses in seven days: a hint (not a closure) for the head, scoped to the lead');
SELECT pg_temp.t297_mk(65, 'out', 'busy', INTERVAL '20 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '15 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(65) = 'no_answer_task' AND pg_temp.t297_open('no_answer_hint') = 1
  AND (SELECT lifecycle_state = 'open' FROM platform.leads WHERE id = pg_temp.t297_id(5008)),
  'the sixth miss adds no second hint, and the lead is never closed by the automation');
-- Five more misses (the 7th to 11th): the tenth meets an open hint and adds no second one.
SELECT pg_temp.t297_mk(91, 'out', 'busy', INTERVAL '19 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '18 minutes');
SELECT pg_temp.t297_mk(92, 'out', 'busy', INTERVAL '18 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '17 minutes');
SELECT pg_temp.t297_mk(93, 'out', 'busy', INTERVAL '17 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '16 minutes');
SELECT pg_temp.t297_mk(94, 'out', 'busy', INTERVAL '16 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '15 minutes 30 seconds');
SELECT pg_temp.t297_mk(95, 'out', 'busy', INTERVAL '15 minutes 30 seconds', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '15 minutes');
SELECT pg_temp.t297_tick() AS t297_n10 \gset
SELECT pg_temp.t297_assert((:'t297_n10'::JSONB ->> 'failed')::INTEGER = 0 AND pg_temp.t297_mark(94) = 'no_answer_task'
  AND pg_temp.t297_mark(95) = 'no_answer_task'
  AND pg_temp.t297_open('no_answer_hint') = 1 AND pg_temp.t297_open('no_answer_callback') = 1
  AND (SELECT t.description LIKE '%Недозвонов подряд: 11.' FROM platform_private.telephony_task_links l
    JOIN platform.staff_tasks t ON t.id = l.task_id WHERE l.call_id = pg_temp.t297_id(7095) AND l.kind = 'no_answer_callback')
  AND (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.kind = 'no_answer_hint') = 1,
  'the tenth miss finds the hint still open and makes no second one; the cadence stays on its last step');
-- An answered call (outbound) closes the cadence task and the hint, and restarts the count.
SELECT pg_temp.t297_mk(66, 'out', 'answered', INTERVAL '10 minutes', 8, 8, 3, 'webhook', 1, NULL, INTERVAL '5 minutes');
SELECT pg_temp.t297_tick() AS t297_a8 \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(66) = 'tasks_closed' AND pg_temp.t297_open('no_answer_callback') = 0
  AND pg_temp.t297_open('no_answer_hint') = 0
  AND (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.closed_reason = 'answered_call'
    AND l.closed_call_id = pg_temp.t297_id(7066) AND l.kind IN ('no_answer_callback', 'no_answer_hint')) = 2,
  'an answered call closes the cadence task and the hint');
SELECT pg_temp.t297_mk(67, 'out', 'busy', INTERVAL '2 minutes', 8, 8, NULL, 'webhook', 1, NULL, INTERVAL '1 minute');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(
  (SELECT t.description LIKE '%Недозвонов подряд: 1.'
      AND t.due_at = platform_private.telephony_cadence_due(c.ended_at, '{"unit":"work_hours","n":2}', '{1,2,3,4,5,6,7}', '00:00', '23:59:59')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7067)),
  'after the answer the cadence restarts at the first step');

-- A refused call, a reconcile row, an unmatched number and the other organization's client.
SELECT pg_temp.t297_mk(70, 'out', 'not_allowed', INTERVAL '6 minutes', 12, 12, NULL, 'webhook', 1, NULL, INTERVAL '5 minutes');
SELECT pg_temp.t297_mk(71, 'out', 'no_answer_unknown', INTERVAL '6 minutes', 13, 13, NULL, 'reconcile', 1, NULL, INTERVAL '5 minutes');
SELECT pg_temp.t297_mk(72, 'out', 'missed', INTERVAL '6 minutes', NULL, NULL, NULL, 'webhook', 1, NULL, INTERVAL '5 minutes', '+996700009999');
SELECT pg_temp.t297_mk(75, 'out', 'missed', INTERVAL '6 minutes', 13, 13, NULL, 'reconcile', 1, NULL, INTERVAL '5 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(70) = 'skipped_outcome' AND pg_temp.t297_mark(71) = 'skipped_outcome'
  AND pg_temp.t297_mark(75) = 'skipped_outcome'
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE id IN (pg_temp.t297_id(7070), pg_temp.t297_id(7071),
    pg_temp.t297_id(7075)) AND result_code IS NULL) = 3
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id IN (pg_temp.t297_id(7070),
    pg_temp.t297_id(7071), pg_temp.t297_id(7075))),
  'NotAllowed, a reconcile-only outcome and a reconcile row even with an exact-looking status get neither the «Недозвон» result nor a cadence');
SELECT pg_temp.t297_assert(pg_temp.t297_mark(72) = 'no_answer_marked'
  AND (SELECT result_code = 'no_answer' FROM platform_private.telephony_calls WHERE id = pg_temp.t297_id(7072))
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7072)),
  'an unanswered outbound call to a number that is nobody''s gets the result and no task');
-- An unanswered outbound attempt replaces an open «Перезвонить» for a missed call.
SELECT pg_temp.t297_mk(73, 'in', 'missed', INTERVAL '15 minutes', 14, 14);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(73) = 'task_created', 'client 14: a missed-call task is open');
SELECT pg_temp.t297_mk(74, 'out', 'busy', INTERVAL '2 minutes', 14, 14, NULL, 'webhook', 1, NULL, INTERVAL '1 minute');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(
  (SELECT closed_reason = 'replaced' AND closed_call_id = pg_temp.t297_id(7074) FROM platform_private.telephony_task_links
    WHERE call_id = pg_temp.t297_id(7073))
  AND pg_temp.t297_who(74, 'no_answer_callback') = 3,
  'a failed callback attempt replaces the open missed-call task by the cadence task');

-- ---------------------------------------------------------------------------
-- 8. Results of the button.
-- ---------------------------------------------------------------------------
-- Client 12 / lead 12: call 80 is a miss with an open task; call 81 is answered and S2 pressed
-- «Перезвонить» for the day after tomorrow (its own mark is preset so that only the result acts).
SELECT pg_temp.t297_mk(80, 'in', 'missed', INTERVAL '30 minutes', 12, 12, NULL, 'webhook', 1, NULL, INTERVAL '25 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(80) = 'task_created', 'client 12: a missed-call task is open');
SELECT pg_temp.t297_mk(81, 'out', 'answered', INTERVAL '20 minutes', 12, 12, 4, 'webhook', 1, NULL, INTERVAL '15 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do'
  WHERE id = pg_temp.t297_id(7081);
UPDATE platform_private.telephony_calls SET result_code = 'callback', result_by = pg_temp.t297_id(304),
  result_at = clock_timestamp(), result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 2)
  WHERE id = pg_temp.t297_id(7081);
SELECT pg_temp.t297_tick() AS t297_cb \gset
SELECT pg_temp.t297_assert((:'t297_cb'::JSONB ->> 'callback_tasks')::INTEGER = 1 AND pg_temp.t297_who(81, 'result_callback') = 4
  AND (SELECT t.title = 'Перезвонить клиенту' AND t.priority = 'normal'
      AND t.due_at = (((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 2) + TIME '00:00') AT TIME ZONE 'Asia/Bishkek'
      AND t.description LIKE 'Отмечено «Перезвонить» на %'
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    WHERE l.call_id = pg_temp.t297_id(7081) AND l.kind = 'result_callback')
  AND (SELECT l.lead_id = pg_temp.t297_id(5012) AND l.closed_at IS NULL FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7081) AND l.kind = 'result_callback'),
  '«Перезвонить» + a day creates a task at the start of that day for the person who pressed it');
SELECT pg_temp.t297_assert(
  (SELECT l.closed_reason = 'replaced' AND l.closed_call_id = pg_temp.t297_id(7081) FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7080)),
  'the open system «Перезвонить» of the lead is replaced by the chosen day');
SELECT pg_temp.t297_tick() AS t297_cb2 \gset
SELECT pg_temp.t297_assert((:'t297_cb2'::JSONB ->> 'callback_tasks')::INTEGER = 0
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7081)) = 1,
  'the task of a result is made once (idempotent)');
-- Another day: a new task, the old one replaced.
UPDATE platform_private.telephony_calls SET result_callback_on = result_callback_on + 1, result_at = clock_timestamp()
  WHERE id = pg_temp.t297_id(7081);
SELECT pg_temp.t297_tick() AS t297_cb3 \gset
SELECT pg_temp.t297_assert((:'t297_cb3'::JSONB ->> 'callback_tasks')::INTEGER = 1
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7081)) = 2
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7081) AND closed_at IS NULL) = 1
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7081)
    AND closed_reason = 'replaced') = 1,
  'a changed day makes a new task and replaces the old one');
-- The result is taken back (changed to «reached»): the task is cancelled.
UPDATE platform_private.telephony_calls SET result_code = 'reached', result_callback_on = NULL, result_at = clock_timestamp()
  WHERE id = pg_temp.t297_id(7081);
SELECT pg_temp.t297_tick() AS t297_cb4 \gset
SELECT pg_temp.t297_assert((:'t297_cb4'::JSONB ->> 'cancelled')::INTEGER = 1 AND pg_temp.t297_open('result_callback') = 0
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7081)
    AND closed_reason = 'cancelled' AND closed_call_id IS NULL) = 1,
  'a result changed to another code cancels the task made for «Перезвонить»');
-- A day in the past gives nothing.
SELECT pg_temp.t297_mk(82, 'out', 'answered', INTERVAL '19 minutes', 15, 15, 4, 'webhook', 1, NULL, INTERVAL '14 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'callback', result_by = pg_temp.t297_id(303), result_at = clock_timestamp(),
  result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1)
  WHERE id = pg_temp.t297_id(7082);
SELECT pg_temp.t297_tick() AS t297_cb5 \gset
SELECT pg_temp.t297_assert((:'t297_cb5'::JSONB ->> 'callback_tasks')::INTEGER = 0
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7082)),
  'a «Перезвонить» day already in the past makes no task');
-- A person who cannot receive tasks pressed it: the lead owner gets the task.
SELECT pg_temp.t297_mk(83, 'out', 'answered', INTERVAL '18 minutes', 16, 16, 4, 'webhook', 1, NULL, INTERVAL '13 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'callback', result_by = pg_temp.t297_id(305), result_at = clock_timestamp(),
  result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)
  WHERE id = pg_temp.t297_id(7083);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_who(83, 'result_callback') = 3,
  'when the person who pressed the result cannot receive tasks the lead owner gets it');
-- An answered call closes an explicit day only from that day: tomorrow stays, today closes.
SELECT pg_temp.t297_mk(84, 'in', 'answered', INTERVAL '4 minutes', 16, 16, 3, 'webhook', 1, NULL, INTERVAL '1 minute');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(84) = 'nothing_to_do'
  AND (SELECT closed_at IS NULL FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7083) AND kind = 'result_callback'),
  'an answered call before the chosen day leaves the explicit «Перезвонить» open');
SELECT pg_temp.t297_mk(85, 'out', 'answered', INTERVAL '17 minutes', 18, 18, 4, 'webhook', 1, NULL, INTERVAL '12 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'callback', result_by = pg_temp.t297_id(304), result_at = clock_timestamp() - INTERVAL '10 minutes',
  result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE)
  WHERE id = pg_temp.t297_id(7085);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert((SELECT closed_at IS NULL FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7085)
    AND kind = 'result_callback'), 'a «Перезвонить» for today is created and open');
SELECT pg_temp.t297_mk(86, 'in', 'answered', INTERVAL '3 minutes', 18, 18, 3, 'webhook', 1, NULL, INTERVAL '30 seconds');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(86) = 'tasks_closed'
  AND (SELECT closed_reason = 'answered_call' AND closed_call_id = pg_temp.t297_id(7086) FROM platform_private.telephony_task_links
    WHERE call_id = pg_temp.t297_id(7085) AND kind = 'result_callback'),
  'an answered call on the chosen day closes the explicit «Перезвонить»');
-- «Не интересно» closes every open «Перезвонить» of the client; the lead stays.
SELECT pg_temp.t297_mk(88, 'out', 'busy', INTERVAL '15 minutes', 6, NULL, NULL, 'webhook', 1, NULL, INTERVAL '10 minutes');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(88) = 'no_answer_task'
  AND (SELECT l.lead_id IS NULL AND l.scope_id = pg_temp.t297_id(4006) AND l.closed_at IS NULL
    FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7088) AND l.kind = 'no_answer_callback')
  AND (SELECT l.closed_reason = 'replaced' FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7007) AND l.kind = 'missed_callback'),
  'client 6 (no lead): the cadence task is scoped to the client and replaced the open missed-call task of call 7');
SELECT pg_temp.t297_mk(89, 'out', 'answered', INTERVAL '2 minutes', 6, NULL, 3, 'webhook', 1, NULL, INTERVAL '30 seconds');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'not_interested', result_by = pg_temp.t297_id(303), result_at = clock_timestamp()
  WHERE id = pg_temp.t297_id(7089);
SELECT pg_temp.t297_tick() AS t297_ni \gset
SELECT pg_temp.t297_assert((:'t297_ni'::JSONB ->> 'cancelled')::INTEGER = 1
  AND (SELECT l.closed_reason = 'cancelled' AND l.closed_call_id = pg_temp.t297_id(7089) FROM platform_private.telephony_task_links l
    WHERE l.call_id = pg_temp.t297_id(7088) AND l.kind = 'no_answer_callback')
  AND (pg_temp.t297_task(88, 'no_answer_callback')).status = 'cancelled',
  '«Не интересно» cancels the open «Перезвонить» of the client');
-- A result older than the task does not close it.
SELECT pg_temp.t297_mk(90, 'out', 'answered', INTERVAL '60 minutes', 3, 3, 3, 'webhook', 1, NULL, INTERVAL '58 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'not_interested', result_by = pg_temp.t297_id(303), result_at = clock_timestamp() - INTERVAL '50 minutes'
  WHERE id = pg_temp.t297_id(7090);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert((SELECT closed_at IS NULL FROM platform_private.telephony_task_links WHERE call_id = pg_temp.t297_id(7004)),
  'a «Не интересно» that is older than the task does not close it');

-- ---------------------------------------------------------------------------
-- 9. Ceilings.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, missed_task_enabled,
  unknown_lead_enabled, ceiling_tasks_hour, ceiling_tasks_day)
  VALUES (pg_temp.t297_id(4), TRUE, TRUE, TRUE, 2, 5);
SELECT pg_temp.t297_mk(100, 'in', 'missed', INTERVAL '9 minutes', 100, 100, NULL, 'webhook', 4);
SELECT pg_temp.t297_mk(101, 'in', 'missed', INTERVAL '8 minutes', 101, 101, NULL, 'webhook', 4);
SELECT pg_temp.t297_mk(102, 'in', 'missed', INTERVAL '7 minutes', 100, 100, NULL, 'webhook', 4);
SELECT pg_temp.t297_mk(103, 'in', 'missed', INTERVAL '6 minutes', 102, 102, NULL, 'webhook', 4);
SELECT pg_temp.t297_mk(104, 'in', 'missed', INTERVAL '5 minutes', 103, 103, NULL, 'webhook', 4);
SELECT pg_temp.t297_tick(4) AS t297_ceil \gset
SELECT pg_temp.t297_assert(:'t297_ceil'::JSONB ->> 'status' = 'stopped' AND :'t297_ceil'::JSONB ->> 'stop_code' = 'tasks_hour'
  AND (:'t297_ceil'::JSONB ->> 'created')::INTEGER = 2 AND (:'t297_ceil'::JSONB ->> 'merged')::INTEGER = 1,
  'the third new task in an hour trips the ceiling (a merge before it did not count)');
SELECT pg_temp.t297_assert(
  pg_temp.t297_open('missed_callback', 4) = 2 AND pg_temp.t297_mark(100) = 'task_created' AND pg_temp.t297_mark(101) = 'task_created'
  AND pg_temp.t297_mark(102) = 'task_merged' AND pg_temp.t297_mark(103) = 'NULL' AND pg_temp.t297_mark(104) = 'NULL'
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t297_id(4)) = 2,
  'two tasks exist; the call on which the ceiling fired and the one after it stay unmarked and create nothing');
SELECT pg_temp.t297_assert(
  (SELECT NOT missed_task_enabled AND NOT unknown_lead_enabled AND projection_enabled AND version = 2
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t297_id(4))
  AND (SELECT automation_stop_code = 'tasks_hour' AND automation_stopped_at IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t297_id(4))
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.organization_id = pg_temp.t297_id(4)
    AND a.action = 'telephony.automation.stop' AND a.resource_type = 'telephony_settings' AND a.actor_kind = 'system'
    AND a.after_state ->> 'code' = 'tasks_hour' AND (a.after_state ->> 'missedTaskEnabled')::BOOLEAN = FALSE
    AND (a.before_state ->> 'missedTaskEnabled')::BOOLEAN = TRUE) = 1,
  'both automation flags are off, the settings version rose, the stop state is lit and the journal says why');
SELECT pg_temp.t297_assert(pg_temp.t297_tick(4) = '{"status":"disabled"}'::JSONB
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t297_id(4)) = 2,
  'after the stop the tick does nothing until an administrator turns the flag on again');
-- Re-enabled by an administrator: the two-hour age rule keeps the old backlog out; a call after
-- the ceiling hour passes is handled again.
UPDATE platform_private.telephony_settings SET missed_task_enabled = TRUE, unknown_lead_enabled = TRUE,
  ceiling_tasks_hour = 4 WHERE organization_id = pg_temp.t297_id(4);
UPDATE platform_private.telephony_runtime_state SET automation_stopped_at = NULL, automation_stop_code = NULL
  WHERE organization_id = pg_temp.t297_id(4);
SELECT pg_temp.t297_tick(4) AS t297_ceil2 \gset
SELECT pg_temp.t297_assert(:'t297_ceil2'::JSONB ->> 'status' = 'ok' AND (:'t297_ceil2'::JSONB ->> 'created')::INTEGER = 2
  AND pg_temp.t297_mark(103) = 'task_created' AND pg_temp.t297_mark(104) = 'task_created',
  'after the administrator re-enables it the waiting calls are handled again (up to the new ceiling)');

-- The daily ceiling: tasks older than an hour still count for the day; a task made by the
-- result button is not an automatic task and is not counted.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, missed_task_enabled,
  ceiling_tasks_hour, ceiling_tasks_day) VALUES (pg_temp.t297_id(5), TRUE, TRUE, 3, 3);
SELECT pg_temp.t297_mk(110, 'in', 'missed', INTERVAL '30 minutes', 110, 110, NULL, 'webhook', 5, NULL, INTERVAL '29 minutes');
SELECT pg_temp.t297_mk(111, 'in', 'missed', INTERVAL '29 minutes', 111, 111, NULL, 'webhook', 5, NULL, INTERVAL '28 minutes');
SELECT pg_temp.t297_tick(5) AS t297_day1 \gset
SELECT pg_temp.t297_assert(:'t297_day1'::JSONB ->> 'status' = 'ok' AND (:'t297_day1'::JSONB ->> 'created')::INTEGER = 2,
  'two automatic tasks are under the daily ceiling of three');
UPDATE platform_private.telephony_task_links SET created_at = clock_timestamp() - INTERVAL '3 hours'
  WHERE organization_id = pg_temp.t297_id(5);
SELECT pg_temp.t297_mk(113, 'out', 'answered', INTERVAL '20 minutes', 113, 113, 10, 'webhook', 5, NULL, INTERVAL '19 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'callback', result_by = pg_temp.t297_id(310), result_at = clock_timestamp(),
  result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)
  WHERE id = pg_temp.t297_id(7113);
SELECT pg_temp.t297_mk(114, 'in', 'missed', INTERVAL '3 minutes', 114, 114, NULL, 'webhook', 5);
SELECT pg_temp.t297_tick(5) AS t297_day2 \gset
SELECT pg_temp.t297_assert(:'t297_day2'::JSONB ->> 'status' = 'ok' AND (:'t297_day2'::JSONB ->> 'created')::INTEGER = 1
  AND (:'t297_day2'::JSONB ->> 'callback_tasks')::INTEGER = 1 AND pg_temp.t297_mark(114) = 'task_created',
  'the task of the result button is not counted: with two older automatic tasks the third one is still allowed');
SELECT pg_temp.t297_mk(115, 'in', 'missed', INTERVAL '2 minutes', 115, 115, NULL, 'webhook', 5);
SELECT pg_temp.t297_tick(5) AS t297_day \gset
SELECT pg_temp.t297_assert(:'t297_day'::JSONB ->> 'status' = 'stopped' AND :'t297_day'::JSONB ->> 'stop_code' = 'tasks_day'
  AND pg_temp.t297_mark(115) = 'NULL'
  AND (SELECT automation_stop_code = 'tasks_day' FROM platform_private.telephony_runtime_state
    WHERE organization_id = pg_temp.t297_id(5))
  AND (SELECT NOT missed_task_enabled AND version = 2 FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t297_id(5)),
  'the daily ceiling counts the tasks of the last 24 hours, not only the last hour, and stops the automation');

-- ---------------------------------------------------------------------------
-- 10. Isolation, failure containment, privacy.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, missed_task_enabled)
  VALUES (pg_temp.t297_id(2), TRUE, TRUE);
SELECT pg_temp.t297_mk(120, 'in', 'missed', INTERVAL '5 minutes', 90, 90, NULL, 'webhook', 2);
SELECT pg_temp.t297_mk(121, 'in', 'missed', INTERVAL '5 minutes', 19, 19);
SELECT pg_temp.t297_tick(1);
SELECT pg_temp.t297_assert(pg_temp.t297_mark(120) = 'NULL' AND pg_temp.t297_mark(121) = 'task_merged',
  'the tick of one organization does not touch the calls of another');
SELECT pg_temp.t297_tick(2) AS t297_o2 \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(120) = 'task_created' AND pg_temp.t297_who(120, 'missed_callback') = 7
  AND (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.organization_id = pg_temp.t297_id(2)) = 1
  AND (SELECT count(*) FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.t297_id(2)) = 1
  AND (SELECT count(*) FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.t297_id(2)
    AND t.assignee_membership_id <> pg_temp.t297_id(307)) = 0,
  'organization 2 gets its own task for its own Admin (no owner, no escalation: the administrator)');

SELECT (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t297_id(1)) AS t297_leads_before,
  (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.t297_id(1)) AS t297_clients_before,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t297_id(1) AND lifecycle_state = 'open') AS t297_open_before \gset
-- A failing call costs only itself: a trigger refuses tasks for S2, the next call goes through.
CREATE FUNCTION pg_temp.t297_refuse() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignee_membership_id = '29700000-0000-4000-8000-000000000304' THEN
    RAISE EXCEPTION 'T297 refuses this assignee' USING ERRCODE = '23514', CONSTRAINT = 't297_refused';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER t297_refuse BEFORE INSERT ON platform.staff_tasks FOR EACH ROW EXECUTE FUNCTION pg_temp.t297_refuse();
SELECT pg_temp.t297_lead(130, 5, 4);
SELECT pg_temp.t297_mk(130, 'in', 'missed', INTERVAL '4 minutes', 5, 130);
SELECT pg_temp.t297_mk(131, 'in', 'missed', INTERVAL '3 minutes', 4, 4);
SELECT count(*) AS t297_s2_before FROM platform.staff_tasks WHERE assignee_membership_id = pg_temp.t297_id(304) \gset
SELECT pg_temp.t297_tick() AS t297_fail \gset
SELECT pg_temp.t297_assert((:'t297_fail'::JSONB ->> 'failed')::INTEGER = 1 AND pg_temp.t297_mark(130) = 'NULL'
  AND pg_temp.t297_mark(131) IN ('task_created', 'task_merged')
  AND :'t297_fail'::JSONB ->> 'last_error_code' = 'e23514_t297_refused'
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t297_id(7130))
  AND (SELECT count(*) FROM platform.staff_tasks WHERE assignee_membership_id = pg_temp.t297_id(304)) = :t297_s2_before,
  'a call that fails is rolled back whole and costs only itself; the error is a code (SQLSTATE and constraint name), never a message');
DROP TRIGGER t297_refuse ON platform.staff_tasks;
SELECT pg_temp.t297_tick() AS t297_retry \gset
SELECT pg_temp.t297_assert(pg_temp.t297_mark(130) = 'task_created' AND (:'t297_retry'::JSONB ->> 'failed')::INTEGER = 0,
  'the failed call is tried again by the next tick and goes through');

-- No phone, link or name in anything the automation wrote.
SELECT pg_temp.t297_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_tasks t JOIN platform_private.telephony_task_links l ON l.task_id = t.id
    WHERE (t.title || ' ' || COALESCE(t.description, '')) ~ '([0-9]{7,}|https?:|://|T297 Client)')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.actor_principal = 'telephony-automation'
    AND (a.after_state::TEXT || COALESCE(a.before_state::TEXT, '') || a.reason) ~ '(99670000|https?:|://|T297 Client)')
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE to_jsonb(l)::TEXT ~ '(99670000|https?:|://)'),
  'no task text, journal row or link made by the automation holds a phone number, a link or a client name');
-- The mask of the ambiguous task is the country and the tail, never the whole number.
SELECT pg_temp.t297_assert((SELECT t.description ~ 'номер \+996 [•]+ [0-9 ]+ есть' AND t.description !~ '[0-9]{7,}'
      AND regexp_replace(t.description, '[^0-9]', '', 'g') !~ '99670000[0-9]{4}'
    FROM platform.staff_tasks t JOIN platform_private.telephony_task_links l ON l.task_id = t.id
    WHERE l.call_id = pg_temp.t297_id(7008)),
  'the «Проверить звонок» text carries the masked number only');
-- The journal rows the automation wrote use only allowlisted actions and resource types.
SELECT pg_temp.t297_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.actor_principal = 'telephony-automation'
    AND (a.action <> ALL (platform_private.p7a_safe_audit_actions())
      OR a.resource_type <> ALL (platform_private.p7a_safe_audit_resource_types()))),
  'every journal row of the automation uses an action and a resource type of the journal allowlist');
-- Nothing outside the telephony and task tables was touched: the clients and leads are as made.
SELECT pg_temp.t297_assert(
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t297_id(1)) = :t297_leads_before + 1
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t297_id(1) AND lifecycle_state = 'open') = :t297_open_before + 1
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.t297_id(1)) = :t297_clients_before,
  'the automation creates no client or lead and closes no lead (the one added lead is the fixture''s own)');

-- ---------------------------------------------------------------------------
-- 11. The settings drive the times: real hours and days, minutes and cadence of the row.
-- ---------------------------------------------------------------------------
-- One working weekday only: the weekday three days from now (Bishkek). Whatever the hour and the
-- day the suite runs, the first working moment after a miss is then 10:00 three days from now.
SELECT (ARRAY[extract(isodow FROM ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 3))::SMALLINT])::TEXT AS t297_days \gset
UPDATE platform_private.telephony_settings SET working_days = :'t297_days'::SMALLINT[], work_from = '10:00', work_to = '20:00',
  callback_work_minutes = 7, no_answer_cadence = '[{"unit":"work_days","n":3}]'::JSONB
  WHERE organization_id = pg_temp.t297_id(1);
SELECT pg_temp.t297_mk(150, 'in', 'missed', INTERVAL '8 minutes', 26, 26);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(150) = 'task_created'
  AND (SELECT t.due_at = (((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 3) + TIME '10:07') AT TIME ZONE 'Asia/Bishkek'
      AND t.due_at = platform_private.telephony_add_work_minutes(c.ended_at, 7, :'t297_days'::SMALLINT[], '10:00', '20:00')
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7150)),
  'the callback span (7 minutes), the working weekday and the opening hour come from the settings row');
SELECT pg_temp.t297_mk(151, 'out', 'busy', INTERVAL '3 minutes', 26, 26, NULL, 'webhook', 1, NULL, INTERVAL '1 minute');
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(pg_temp.t297_mark(151) = 'no_answer_task'
  AND (SELECT t.due_at = platform_private.telephony_add_work_days(c.ended_at, 3, :'t297_days'::SMALLINT[], '10:00', '20:00')
      AND t.due_at >= c.ended_at + INTERVAL '14 days'
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE l.call_id = pg_temp.t297_id(7151) AND l.kind = 'no_answer_callback'),
  'the cadence comes from the settings row too: three working days of a one-day week is more than two weeks away');
-- The day of the button takes the opening hour of the settings row (10:00 here).
SELECT pg_temp.t297_mk(152, 'out', 'answered', INTERVAL '12 minutes', 26, 26, 4, 'webhook', 1, NULL, INTERVAL '11 minutes');
UPDATE platform_private.telephony_calls SET automation_done_at = clock_timestamp(), automation_outcome = 'nothing_to_do',
  result_code = 'callback', result_by = pg_temp.t297_id(304), result_at = clock_timestamp(),
  result_callback_on = ((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 3)
  WHERE id = pg_temp.t297_id(7152);
SELECT pg_temp.t297_tick();
SELECT pg_temp.t297_assert(
  (SELECT t.due_at = (((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 3) + TIME '10:00') AT TIME ZONE 'Asia/Bishkek'
    FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    WHERE l.call_id = pg_temp.t297_id(7152) AND l.kind = 'result_callback'),
  'the chosen day starts at the opening hour of the settings row (10:00)');

\echo T297_TELEPHONY_MISSED_TASKS_SUITE_END
\echo T297_TELEPHONY_MISSED_TASKS_SUITE_PASSED
ROLLBACK;
