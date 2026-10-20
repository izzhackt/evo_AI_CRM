\set ON_ERROR_STOP on
-- Boundary suite for migration 311 «Телефония Beeline KG» срез T7b (звонок из «Позвонить»
-- привязывается к своему набору; первичный импорт — только последние 30 суток;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.4, §6.1, §9.4, §14 шаг 11; ADR 0033). Runs on the
-- real chain right after 311 inside one transaction that is rolled back, with its own synthetic
-- organizations, members, clients, leads, PBX users and calls: no provider, no real person, no
-- real phone, no production action. Events enter through the REAL intake
-- (platform.telephony_receive_v1 with projection on), the quiet window is passed by ageing
-- last_message_at, the calls settle through the REAL settle function and the decision is made by
-- the REAL minute tick of T8; the maintenance plan and the run mark are called through the same
-- request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. catalog and grants: five new private functions (the 30-day floor, the call chain, the dial
--     bind, the employee-answered check, the insert trigger function), all closed to PUBLIC and
--     every client role with an empty search_path; no new PUBLIC telephony function in `platform`;
--     the four replaced functions keep their grants (service_role only / closed) and their
--     role checks; the automation mark list gained exactly skipped_dial_unanswered;
--  2. the first-import window: the floor is now - 30 days and never earlier than 22.10.2025
--     (fixed dates, both sides of the boundary, NULL stays NULL); the real plan and mark walk the
--     whole import in 30 daily windows ending at the floor, the cursor is held at the floor, a
--     cursor left behind by a pause is marked done by the plan itself, a switched-off flag writes
--     nothing, the cursor still only moves backward, the old plan keys are all still there;
--  3. the dial binding through the real path: a call whose events arrive AFTER the dial result
--     is bound by the insert trigger; a call that arrived BEFORE the result is bound by the result
--     (finish); a dial without a call id is found by employee + number + time; a call outside the
--     window, by another employee, or for a dial that already has its call is NOT bound; the
--     bind is idempotent and a repeated result changes nothing; org boundaries, direction,
--     needs_review and a not-yet-sent dial never bind; a transfer chain carries the dial;
--  4. the decision: the employee did not pick up their own leg -> no «Недозвон», no task, the
--     mark skipped_dial_unanswered, the result stays empty; the employee picked up and the client
--     did not -> the normal «Недозвон» and cadence task; a second tick changes nothing; calls
--     that are not from the Call button keep the old rules; created_via is untouched; the
--     journal and the task texts carry no call id.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

DO $t311_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t311_auth_role$;

\echo T311_TELEPHONY_DIAL_BIND_SUITE_START

CREATE FUNCTION pg_temp.t311_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t311_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T311: %', message; END IF;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t311_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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
-- A statement run and rolled back: 'ok' when it succeeds, the SQLSTATE when it fails.
CREATE FUNCTION pg_temp.t311_try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'T311 rollback' USING ERRCODE = 'PT999';
  EXCEPTION WHEN SQLSTATE 'PT999' THEN
    RETURN 'ok';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

-- The service path: the JWT role claim the public functions check.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (the dial and the decision), 2 (another tenant), 3-7 (the import).
--   actor 1  org 1 Admin A — owner of every lead, receives the tasks
--   actor 2  org 1 Admin B — the PBX user m701 (the employee who dials)
--   actor 3  org 1 Admin C — the PBX user m702 (another employee)
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t311_id(1), 'T311 Fictional organization', 'active'),
  (pg_temp.t311_id(2), 'T311 Other fictional organization', 'active'),
  (pg_temp.t311_id(3), 'T311 Import organization (a full walk)', 'active'),
  (pg_temp.t311_id(4), 'T311 Import organization (a paused import)', 'active'),
  (pg_temp.t311_id(5), 'T311 Import organization (flag off)', 'active'),
  (pg_temp.t311_id(6), 'T311 Import organization (cursor far back)', 'active'),
  (pg_temp.t311_id(7), 'T311 Import organization (cursor only backward)', 'active');
CREATE TEMP TABLE t311_actors(n INTEGER PRIMARY KEY);
INSERT INTO t311_actors VALUES (1), (2), (3);
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t311_id(100 + n), 't311-' || n || '@example.invalid', '{}'::JSONB FROM t311_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t311_id(200 + n), pg_temp.t311_id(100 + n), 'T311 Actor ' || n, 'active', 1 FROM t311_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id,
  created_at)
  SELECT pg_temp.t311_id(300 + a.n), pg_temp.t311_id(1), pg_temp.t311_id(200 + a.n), 'active',
    'admin'::platform.business_role,
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 10:00:00+00' + make_interval(mins => a.n)
  FROM t311_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t311_id(300 + n) FROM t311_actors);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t311_id(401), pg_temp.t311_id(1), 'organization', pg_temp.t311_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t311_id(1), pg_temp.t311_id(301), pg_temp.t311_id(401), 1, 1, TRUE, 'system', 'T311 synthetic scope', pg_temp.t311_id(601));

-- The PBX directory of organization 1 (m701 -> actor 2, m702 -> actor 3) and one active user in each import
-- organization (the plan needs a non-empty directory).
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id) VALUES
  (pg_temp.t311_id(1), 'm701', '701', 'T311 PBX user 1', pg_temp.t311_id(302)),
  (pg_temp.t311_id(1), 'm702', '702', 'T311 PBX user 2', pg_temp.t311_id(303)),
  (pg_temp.t311_id(3), 'i701', '701', 'T311 import user', NULL),
  (pg_temp.t311_id(4), 'i701', '701', 'T311 import user', NULL),
  (pg_temp.t311_id(5), 'i701', '701', 'T311 import user', NULL),
  (pg_temp.t311_id(6), 'i701', '701', 'T311 import user', NULL),
  (pg_temp.t311_id(7), 'i701', '701', 'T311 import user', NULL);
-- Organization 1: projection and the automation on, working hours around the clock and high ceilings
-- (the suite makes a handful of tasks at whatever hour it runs); organizations 3-7: projection on.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, missed_task_enabled, working_days,
  work_from, work_to, ceiling_tasks_hour, ceiling_tasks_day)
  VALUES (pg_temp.t311_id(1), TRUE, TRUE, '{1,2,3,4,5,6,7}', '00:00', '23:59:59', 300, 1200);
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, backfill_enabled) VALUES
  (pg_temp.t311_id(3), TRUE, TRUE), (pg_temp.t311_id(4), TRUE, TRUE), (pg_temp.t311_id(5), TRUE, FALSE),
  (pg_temp.t311_id(6), TRUE, TRUE), (pg_temp.t311_id(7), TRUE, TRUE);

-- Clients 1-14 of organization 1 (phone +99655510nnnn), each with one open lead owned by actor 1.
CREATE FUNCTION pg_temp.t311_phone(n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT '+99655510' || lpad(n::TEXT, 4, '0')
$$;
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state)
  SELECT pg_temp.t311_id(4000 + n), pg_temp.t311_id(1), 'T311 Client ' || n, platform_private.normalize_person_name('T311 Client ' || n),
    pg_temp.t311_phone(n), platform_private.normalize_person_phone(pg_temp.t311_phone(n)), 'active'
  FROM generate_series(1, 14) n;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state)
  SELECT pg_temp.t311_id(5000 + n), pg_temp.t311_id(1), pg_temp.t311_id(4000 + n), pg_temp.t311_id(301), 'new', 'website', 'open'
  FROM generate_series(1, 14) n;

-- A dial request row (status requested) of client n by PBX user p_user (actor 2 for m701, 3 for m702).
CREATE FUNCTION pg_temp.t311_dial(p_n INTEGER, p_user TEXT DEFAULT 'm701') RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform_private.telephony_dial_requests(id, organization_id, request_id, membership_id, client_id, lead_id,
    pbx_user, client_phone, status)
  VALUES (pg_temp.t311_id(8000 + p_n), pg_temp.t311_id(1), pg_temp.t311_id(8500 + p_n),
    CASE p_user WHEN 'm701' THEN pg_temp.t311_id(302) ELSE pg_temp.t311_id(303) END,
    pg_temp.t311_id(4000 + p_n), pg_temp.t311_id(5000 + p_n), p_user, pg_temp.t311_phone(p_n), 'requested')
$$;
-- The result of the dial through the REAL service function.
CREATE FUNCTION pg_temp.t311_finish(p_n INTEGER, p_outcome TEXT, p_callid TEXT DEFAULT NULL, p_user TEXT DEFAULT 'm701')
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_dial_finish_v1(pg_temp.t311_id(1), pg_temp.t311_id(8000 + p_n),
    CASE p_user WHEN 'm701' THEN pg_temp.t311_id(302) ELSE pg_temp.t311_id(303) END, p_outcome, p_callid,
    CASE WHEN p_outcome = 'sent' THEN 200 END,
    CASE WHEN p_outcome IN ('failed', 'unconfirmed') THEN 'pbx_timeout' END, NULL)
$$;
-- PBX messages through the REAL intake. An event and a history row.
CREATE FUNCTION pg_temp.t311_ev(p_type TEXT, p_callid TEXT, p_user TEXT, p_client INTEGER, p_dir TEXT DEFAULT 'out')
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := platform.telephony_receive_v1(pg_temp.t311_id(1), gen_random_uuid(), 'event', 'current',
    encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex'),
    jsonb_build_object('cmd', 'event', 'type', p_type, 'callid', p_callid, 'user', p_user,
      'phone', ltrim(pg_temp.t311_phone(p_client), '+'), 'direction', p_dir), NULL, NULL);
  IF r ->> 'projection' <> 'projected' THEN RAISE EXCEPTION 'T311 event not projected: %', r; END IF;
END
$$;
CREATE FUNCTION pg_temp.t311_hist(p_callid TEXT, p_user TEXT, p_client INTEGER, p_status TEXT, p_dur INTEGER DEFAULT 0)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := platform.telephony_receive_v1(pg_temp.t311_id(1), gen_random_uuid(), 'history', 'current',
    encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex'),
    jsonb_build_object('cmd', 'history', 'type', 'out', 'callid', p_callid, 'user', p_user,
      'phone', ltrim(pg_temp.t311_phone(p_client), '+'), 'status', p_status,
      'start', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'), 'duration', p_dur, 'wait', 0,
      'diversion', '996312000000'), NULL, NULL);
  IF r ->> 'projection' <> 'projected' THEN RAISE EXCEPTION 'T311 history not projected: %', r; END IF;
END
$$;
-- Pass the quiet window of the calls, settle them (REAL settle) and take the REAL minute tick.
CREATE FUNCTION pg_temp.t311_settle() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_settle_calls_v1(pg_temp.t311_id(1))
$$;
CREATE FUNCTION pg_temp.t311_tick() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_automation_tick_v1(pg_temp.t311_id(1), 100)
$$;
CREATE FUNCTION pg_temp.t311_quiet() RETURNS VOID LANGUAGE SQL AS $$
  UPDATE platform_private.telephony_calls SET last_message_at = clock_timestamp() - INTERVAL '200 seconds'
  WHERE organization_id = pg_temp.t311_id(1) AND settled_at IS NULL
$$;
CREATE FUNCTION pg_temp.t311_call(p_callid TEXT) RETURNS platform_private.telephony_calls LANGUAGE SQL AS $$
  SELECT c FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t311_tasks(p_callid TEXT) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_task_links l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = p_callid
$$;

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t311_assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('telephony_backfill_floor', 'telephony_call_chain',
      'telephony_dial_bind', 'telephony_dial_employee_answered', 'telephony_calls_bind_dial_row')) = 5
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('telephony_backfill_floor', 'telephony_call_chain',
      'telephony_dial_bind', 'telephony_dial_employee_answered', 'telephony_calls_bind_dial_row')) = 0,
  'the five new functions exist, in platform_private only (no new function in the exposed platform schema)');
SELECT pg_temp.t311_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE')
      AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname IN ('telephony_backfill_floor', 'telephony_call_chain',
      'telephony_dial_bind', 'telephony_dial_employee_answered', 'telephony_calls_bind_dial_row',
      'telephony_automation_decide')),
  'the new helpers and the replaced decision are executable by no client role and not by PUBLIC, each with an empty search_path');
SELECT pg_temp.t311_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p WHERE p.oid IN ('platform.telephony_maintenance_plan_v1(uuid)'::regprocedure,
      'platform.telephony_runtime_mark_v1(uuid,text,timestamptz,text,jsonb,jsonb)'::regprocedure,
      'platform.telephony_dial_finish_v1(uuid,uuid,uuid,text,text,integer,text,text)'::regprocedure)),
  'the three replaced public functions keep their posture: owner-owned SECURITY DEFINER, empty search_path, VOLATILE, EXECUTE for service_role only');
SELECT pg_temp.t311_assert(
  (SELECT bool_and(pg_temp.t311_as(r.role, c.claims, format('SELECT platform.telephony_maintenance_plan_v1(%L)', pg_temp.t311_id(1))) = '42501'
      AND pg_temp.t311_as(r.role, c.claims, format('SELECT platform.telephony_runtime_mark_v1(%L, ''tick'')', pg_temp.t311_id(1))) = '42501'
      AND pg_temp.t311_as(r.role, c.claims, format('SELECT platform.telephony_dial_finish_v1(%L, %L, %L, ''failed'', NULL, NULL, ''pbx_timeout'', NULL)',
        pg_temp.t311_id(1), pg_temp.t311_id(8001), pg_temp.t311_id(302))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"service_role"}'), ('{"role":"authenticated","sub":"31100000-0000-4000-8000-000000000101"}'), ('')) c(claims))
  AND (SELECT bool_and(pg_temp.t311_as('service_role', c.claims, format('SELECT platform.telephony_maintenance_plan_v1(%L)', pg_temp.t311_id(1))) = '42501'
      AND pg_temp.t311_as('service_role', c.claims, format('SELECT platform.telephony_runtime_mark_v1(%L, ''tick'')', pg_temp.t311_id(1))) = '42501')
    FROM (VALUES ('{"role":"authenticated"}'), ('{"role":"anon"}'), ('')) c(claims)),
  'the client roles are refused whatever the claims, and service_role without the service claim is refused too (the role checks survived the replacement)');
SELECT pg_temp.t311_assert(
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'platform_private.telephony_calls'::regclass
      AND conname = 'telephony_calls_automation_check'
      AND pg_get_constraintdef(oid) LIKE '%skipped_dial_unanswered%' AND pg_get_constraintdef(oid) LIKE '%later_answered%'
      AND pg_get_constraintdef(oid) LIKE '%skipped_no_assignee%') = 1,
  'the automation mark list gained skipped_dial_unanswered and kept the earlier labels');
SELECT pg_temp.t311_assert(
  (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'platform_private.telephony_calls'::regclass
     AND t.tgname = 'telephony_calls_bind_dial_insert' AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 1) = 1) = 1,
  'one enabled BEFORE INSERT row trigger binds the dial on the calls table');

-- ---------------------------------------------------------------------------
-- 2. The first import: the last 30 days, never earlier than 22.10.2025.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t311_assert(
  platform_private.telephony_backfill_floor(TIMESTAMPTZ '2026-10-20 12:00:00+00') = TIMESTAMPTZ '2026-09-20 12:00:00+00'
  AND platform_private.telephony_backfill_floor(TIMESTAMPTZ '2025-11-05 00:00:00+00') = TIMESTAMPTZ '2025-10-21 18:00:00+00'
  AND platform_private.telephony_backfill_floor(TIMESTAMPTZ '2025-11-20 18:00:00+00') = TIMESTAMPTZ '2025-10-21 18:00:00+00'
  AND platform_private.telephony_backfill_floor(TIMESTAMPTZ '2025-11-21 00:00:00+00') = TIMESTAMPTZ '2025-10-22 00:00:00+00'
  AND platform_private.telephony_backfill_floor(TIMESTAMPTZ '2026-03-01 00:00:00+00') = TIMESTAMPTZ '2026-01-30 00:00:00+00'
  AND platform_private.telephony_backfill_floor(NULL) IS NULL,
  'the floor is now - 30 days (a plain month back, across a month end), and the old 22.10.2025 00:00 Bishkek constant is the lowest it ever gets');
SELECT pg_temp.t311_assert((SELECT p.provolatile = 's' AND p.proisstrict
    FROM pg_proc p WHERE p.oid = 'platform_private.telephony_backfill_floor(timestamptz)'::regprocedure),
  'the floor is STABLE and STRICT (it depends on the session time zone for days; NULL stays NULL)');

-- A full walk through the REAL plan and the REAL mark (organization 3).
CREATE TEMP TABLE t311_walk(n INTEGER, win_start TIMESTAMPTZ, win_end TIMESTAMPTZ);
SELECT clock_timestamp() AS t311_walk_at \gset
DO $t311_walk_do$
DECLARE
  p JSONB; n INTEGER := 0; v_org UUID := pg_temp.t311_id(3);
BEGIN
  LOOP
    p := platform.telephony_maintenance_plan_v1(v_org);
    EXIT WHEN NOT (p -> 'backfill' ->> 'due')::BOOLEAN OR n >= 100;
    n := n + 1;
    INSERT INTO t311_walk VALUES (n, (p -> 'backfill' ->> 'window_start')::TIMESTAMPTZ, (p -> 'backfill' ->> 'window_end')::TIMESTAMPTZ);
    PERFORM platform.telephony_runtime_mark_v1(v_org, 'backfill_ok', (p -> 'backfill' ->> 'window_start')::TIMESTAMPTZ, NULL,
      '{"rows":0}'::JSONB);
    -- The script runs once a minute: step the run time back so the next plan finds the import due.
    UPDATE platform_private.telephony_runtime_state SET backfill_run_at = clock_timestamp() - INTERVAL '2 minutes'
      WHERE organization_id = v_org;
  END LOOP;
END
$t311_walk_do$;
SELECT pg_temp.t311_assert((SELECT count(*) FROM t311_walk) = 30
  AND (SELECT win_end - win_start = INTERVAL '24 hours' FROM t311_walk WHERE n = 1)
  AND (SELECT abs(extract(epoch FROM (win_end - :'t311_walk_at'::TIMESTAMPTZ))) < 60 FROM t311_walk WHERE n = 1)
  AND (SELECT bool_and(a.win_start = b.win_end) FROM t311_walk a JOIN t311_walk b ON b.n = a.n + 1),
  'the import walks 30 daily windows back from now, each one ending where the previous one began (no gap, no overlap)');
SELECT pg_temp.t311_assert(
  (SELECT abs(extract(epoch FROM (win_start - (:'t311_walk_at'::TIMESTAMPTZ - INTERVAL '30 days')))) < 60 FROM t311_walk WHERE n = 30)
  AND (SELECT min(win_start) > TIMESTAMPTZ '2025-10-21 18:00:00+00' FROM t311_walk),
  'the last window stops at now - 30 days (not a year back, not before the old constant)');
SELECT pg_temp.t311_assert((SELECT backfill_done_at IS NOT NULL
      AND abs(extract(epoch FROM (backfill_cursor_at - (:'t311_walk_at'::TIMESTAMPTZ - INTERVAL '30 days')))) < 60
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(3))
  AND NOT (platform.telephony_maintenance_plan_v1(pg_temp.t311_id(3)) -> 'backfill' ->> 'due')::BOOLEAN
  AND (platform.telephony_maintenance_plan_v1(pg_temp.t311_id(3)) -> 'backfill' ->> 'done')::BOOLEAN,
  'the cursor sits at the floor, the import is marked done and is never due again');
SELECT pg_temp.t311_assert(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(platform.telephony_maintenance_plan_v1(pg_temp.t311_id(3))) k)
    = ARRAY['backfill', 'backfill_enabled', 'daily', 'directory_active', 'now', 'outbound_paused', 'probe_due',
      'projection_enabled', 'reconcile', 'retry_due', 'settle_due', 'status', 'users_due'],
  'the plan answers with exactly the keys it had before (the script is unchanged)');

-- A paused import: the cursor stays behind the floor that moved on (a 31-day-old cursor) -> done by the plan.
INSERT INTO platform_private.telephony_runtime_state(organization_id, backfill_cursor_at, backfill_run_at)
  VALUES (pg_temp.t311_id(4), clock_timestamp() - INTERVAL '31 days', clock_timestamp() - INTERVAL '2 minutes');
-- The plan runs in its own statement: a row it writes is not visible to the same statement's snapshot.
SELECT platform.telephony_maintenance_plan_v1(pg_temp.t311_id(4)) AS t311_paused_plan \gset
SELECT pg_temp.t311_assert(
  NOT (:'t311_paused_plan'::JSONB -> 'backfill' ->> 'due')::BOOLEAN
  AND (:'t311_paused_plan'::JSONB -> 'backfill' ->> 'done')::BOOLEAN
  AND (SELECT backfill_done_at IS NOT NULL FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(4)),
  'an import whose cursor was left behind by a pause is complete: not due, reported done, and marked done in the state');
-- The same cursor with the flag OFF: nothing is written.
INSERT INTO platform_private.telephony_runtime_state(organization_id, backfill_cursor_at)
  VALUES (pg_temp.t311_id(5), clock_timestamp() - INTERVAL '31 days');
SELECT platform.telephony_maintenance_plan_v1(pg_temp.t311_id(5)) AS t311_off_plan \gset
SELECT pg_temp.t311_assert(
  NOT (:'t311_off_plan'::JSONB -> 'backfill' ->> 'due')::BOOLEAN
  AND (SELECT backfill_done_at IS NULL FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(5)),
  'with the import flag off the plan writes nothing');
UPDATE platform_private.telephony_settings SET projection_enabled = FALSE WHERE organization_id = pg_temp.t311_id(5);
UPDATE platform_private.telephony_settings SET backfill_enabled = TRUE WHERE organization_id = pg_temp.t311_id(5);
SELECT platform.telephony_maintenance_plan_v1(pg_temp.t311_id(5)) AS t311_off_plan2 \gset
SELECT pg_temp.t311_assert(
  NOT (:'t311_off_plan2'::JSONB -> 'backfill' ->> 'due')::BOOLEAN
  AND (SELECT backfill_done_at IS NULL FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(5)),
  'with the projection off the plan writes nothing either');

-- The mark: a cursor far back is held at the floor and ends the import; a later value is ignored.
SELECT platform.telephony_runtime_mark_v1(pg_temp.t311_id(6), 'backfill_ok', clock_timestamp() - INTERVAL '400 days');
SELECT pg_temp.t311_assert((SELECT backfill_done_at IS NOT NULL
      AND abs(extract(epoch FROM (backfill_cursor_at - (clock_timestamp() - INTERVAL '30 days')))) < 60
      AND backfill_cursor_at > clock_timestamp() - INTERVAL '31 days'
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(6)),
  'a cursor a year back is held at now - 30 days and ends the import');
SELECT platform.telephony_runtime_mark_v1(pg_temp.t311_id(7), 'backfill_ok', clock_timestamp() - INTERVAL '10 days');
SELECT platform.telephony_runtime_mark_v1(pg_temp.t311_id(7), 'backfill_ok', clock_timestamp() - INTERVAL '5 days');
SELECT pg_temp.t311_assert((SELECT backfill_done_at IS NULL AND backfill_cursor_at < clock_timestamp() - INTERVAL '9 days'
      AND backfill_cursor_at > clock_timestamp() - INTERVAL '11 days'
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t311_id(7)),
  'the cursor still only moves backward (a later value is ignored) and a cursor inside the window does not end the import');
SELECT pg_temp.t311_assert(pg_temp.t311_try(format('SELECT platform.telephony_runtime_mark_v1(%L, ''backfill_ok'', %L)',
    pg_temp.t311_id(7), clock_timestamp() + INTERVAL '2 hours')) = '22023',
  'a cursor in the future is still refused');

-- ---------------------------------------------------------------------------
-- 3. The dial binding and the decision, through the real intake, settle and tick.
-- ---------------------------------------------------------------------------
-- 1  client 1: the dial result FIRST, then the events (trigger); the employee does not pick up      -> skipped
-- 2  client 2: the events FIRST, then the dial result (finish binds); the employee does not pick up -> skipped
-- 3  client 3: the employee picks up, the client does not                                         -> «Недозвон» + task
-- 5  client 5: the dial has NO call id (unconfirmed); another call id comes (fallback), no pick-up -> skipped
-- 6  client 6: the dial is 10 minutes old (outside the window)                                    -> normal rules
-- 7  client 7: the dial is for m701 but m702 made the call                                        -> normal rules
-- 1b client 1 again: a second call of m701 to the same client while the dial already has its call -> normal rules
-- 5b client 5 again: the same, for the fallback-bound dial                                         -> normal rules
-- 4  client 4: a plain outbound call (no dial at all)                                              -> normal rules
SELECT pg_temp.t311_dial(n) FROM unnest(ARRAY[1, 2, 3, 5, 6, 7]) n;
SELECT pg_temp.t311_finish(1, 'sent', 'tdb-1');
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-1', 'm701', 1);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-1', 'm701', 1);
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-1')).dial_request_id = pg_temp.t311_id(8001)
  AND (pg_temp.t311_call('tdb-1')).created_via = 'webhook' AND (pg_temp.t311_call('tdb-1')).direction = 'out',
  'a call whose events come after the dial result gets its dial at once (insert trigger); created_via stays webhook');

SELECT pg_temp.t311_ev('OUTGOING', 'tdb-2', 'm701', 2);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-2', 'm701', 2);
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-2')).dial_request_id IS NULL
  AND (SELECT status FROM platform_private.telephony_dial_requests WHERE id = pg_temp.t311_id(8002)) = 'requested',
  'events that come before the dial result are not bound yet');
SELECT pg_temp.t311_finish(2, 'sent', 'tdb-2');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-2')).dial_request_id = pg_temp.t311_id(8002),
  'the dial result binds the call that already arrived with that call id');

SELECT pg_temp.t311_finish(3, 'sent', 'tdb-3');
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-3', 'm701', 3);
SELECT pg_temp.t311_ev('ACCEPTED', 'tdb-3', 'm701', 3);
SELECT pg_temp.t311_hist('tdb-3', 'm701', 3, 'missed', 0);
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-3')).dial_request_id = pg_temp.t311_id(8003)
  AND (pg_temp.t311_call('tdb-3')).outcome = 'missed' AND (pg_temp.t311_call('tdb-3')).outcome_source = 'webhook'
  AND (SELECT l.accepted_at IS NOT NULL FROM platform_private.telephony_call_legs l
    WHERE l.call_id = (pg_temp.t311_call('tdb-3')).id AND l.pbx_user = 'm701'),
  'the employee leg was accepted and the call ended without a client answer (missed, exact webhook outcome)');

SELECT pg_temp.t311_finish(5, 'unconfirmed');
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-5-evt', 'm701', 5);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-5-evt', 'm701', 5);
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-5-evt')).dial_request_id IS NULL
  AND (SELECT pbx_callid IS NULL AND status = 'unconfirmed' FROM platform_private.telephony_dial_requests WHERE id = pg_temp.t311_id(8005)),
  'a dial without a call id leaves the arriving call unbound until the decision looks for it');

SELECT pg_temp.t311_finish(6, 'unconfirmed');
UPDATE platform_private.telephony_dial_requests SET created_at = clock_timestamp() - INTERVAL '10 minutes',
  updated_at = clock_timestamp() - INTERVAL '10 minutes' WHERE id = pg_temp.t311_id(8006);
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-6', 'm701', 6);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-6', 'm701', 6);
SELECT pg_temp.t311_finish(7, 'unconfirmed');
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-7', 'm702', 7);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-7', 'm702', 7);
-- A plain outbound call: no dial at all.
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-4', 'm701', 4);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-4', 'm701', 4);
-- The second calls of m701 to clients 1 and 5.
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-1b', 'm701', 1);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-1b', 'm701', 1);
SELECT pg_temp.t311_ev('OUTGOING', 'tdb-5b', 'm701', 5);
SELECT pg_temp.t311_ev('CANCELLED', 'tdb-5b', 'm701', 5);

SELECT pg_temp.t311_quiet();
SELECT pg_temp.t311_settle() AS t311_settled \gset
SELECT pg_temp.t311_assert((:'t311_settled'::JSONB ->> 'settled')::INTEGER = 9 AND (:'t311_settled'::JSONB ->> 'failed')::INTEGER = 0
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t311_id(1) AND settled_at IS NOT NULL
    AND automation_done_at IS NULL) = 9,
  'the nine calls settled through the real quiet-window tick and wait for a decision');

-- The tick takes settled calls oldest first (then by id): make the SECOND calls of clients 1 and 5 come BEFORE the
-- first ones, the order that would let a later call steal the dial of an earlier one.
UPDATE platform_private.telephony_calls SET settled_at = settled_at - INTERVAL '5 seconds'
  WHERE organization_id = pg_temp.t311_id(1) AND pbx_callid IN ('tdb-1b', 'tdb-5b');
SELECT pg_temp.t311_tick() AS t311_tick1 \gset
SELECT pg_temp.t311_assert((:'t311_tick1'::JSONB ->> 'status') = 'ok' AND (:'t311_tick1'::JSONB ->> 'failed')::INTEGER = 0
  AND (:'t311_tick1'::JSONB ->> 'skipped')::INTEGER = 3 AND (:'t311_tick1'::JSONB ->> 'created')::INTEGER = 6,
  'the tick decided nine calls: three skipped as «not picked up by the employee», six cadence tasks, none failed');

-- The employee did not pick up: nothing for the client.
SELECT pg_temp.t311_assert(
  (pg_temp.t311_call('tdb-1')).automation_outcome = 'skipped_dial_unanswered'
  AND (pg_temp.t311_call('tdb-2')).automation_outcome = 'skipped_dial_unanswered'
  AND (pg_temp.t311_call('tdb-5-evt')).automation_outcome = 'skipped_dial_unanswered',
  'the employee did not pick up their own leg: «вызов не принят сотрудником» (by the call id, by the late result, by the fallback key)');
SELECT pg_temp.t311_assert(
  (pg_temp.t311_call('tdb-1')).result_code IS NULL AND (pg_temp.t311_call('tdb-2')).result_code IS NULL
  AND (pg_temp.t311_call('tdb-5-evt')).result_code IS NULL
  AND (pg_temp.t311_call('tdb-1')).result_at IS NULL AND (pg_temp.t311_call('tdb-1')).result_by IS NULL
  AND pg_temp.t311_tasks('tdb-1') = 0 AND pg_temp.t311_tasks('tdb-2') = 0 AND pg_temp.t311_tasks('tdb-5-evt') = 0
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.action = 'telephony.result.set'
    AND a.resource_id IN ((pg_temp.t311_call('tdb-1')).id, (pg_temp.t311_call('tdb-2')).id, (pg_temp.t311_call('tdb-5-evt')).id)),
  'no «Недозвон» result, no journal row of one and no task for the client when the employee did not pick up');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-5-evt')).dial_request_id = pg_temp.t311_id(8005),
  'the fallback key (employee leg, client number, time) found the dial of a call without a call id');
-- The employee picked up, the client did not: the normal rules.
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-3')).automation_outcome = 'no_answer_task'
  AND (pg_temp.t311_call('tdb-3')).result_code = 'no_answer' AND (pg_temp.t311_call('tdb-3')).result_by IS NULL
  AND pg_temp.t311_tasks('tdb-3') = 1 AND (pg_temp.t311_call('tdb-3')).dial_request_id = pg_temp.t311_id(8003)
  AND EXISTS (SELECT 1 FROM platform_private.telephony_task_links l WHERE l.call_id = (pg_temp.t311_call('tdb-3')).id
    AND l.kind = 'no_answer_callback' AND l.closed_at IS NULL),
  'the employee picked up and the client did not: «Недозвон» without an author and the cadence task, as before');
-- Not from the Call button: the old rules.
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-4')).automation_outcome = 'no_answer_task'
  AND (pg_temp.t311_call('tdb-4')).dial_request_id IS NULL AND (pg_temp.t311_call('tdb-4')).result_code = 'no_answer',
  'a plain outbound call (no dial) keeps the old rules');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-6')).automation_outcome = 'no_answer_task' AND (pg_temp.t311_call('tdb-6')).dial_request_id IS NULL
  AND (pg_temp.t311_call('tdb-7')).automation_outcome = 'no_answer_task' AND (pg_temp.t311_call('tdb-7')).dial_request_id IS NULL,
  'a call outside the time window, and a call by another employee, are not taken for the dial (old rules)');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-1b')).automation_outcome = 'no_answer_task' AND (pg_temp.t311_call('tdb-1b')).dial_request_id IS NULL
  AND (pg_temp.t311_call('tdb-5b')).automation_outcome = 'no_answer_task' AND (pg_temp.t311_call('tdb-5b')).dial_request_id IS NULL
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t311_id(1) AND dial_request_id IS NOT NULL) = 4,
  'a dial has ONE call: a second call to the same client (the first one has the call id, the other was bound by the fallback) is not bound and keeps the old rules');
SELECT pg_temp.t311_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t311_id(1)
    AND created_via <> 'webhook') = 0,
  'created_via is untouched on every call (the link is dial_request_id)');

-- Idempotency: a second tick, a repeated result, a repeated bind change nothing.
CREATE TEMP TABLE t311_snapshot AS
  SELECT c.pbx_callid, c.dial_request_id, c.automation_outcome, c.automation_done_at, c.result_code, c.result_at, c.updated_at
  FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1);
SELECT count(*) AS t311_tasks_before FROM platform.staff_tasks WHERE organization_id = pg_temp.t311_id(1) \gset
SELECT count(*) AS t311_links_before FROM platform_private.telephony_task_links WHERE organization_id = pg_temp.t311_id(1) \gset
SELECT pg_temp.t311_tick() AS t311_tick2 \gset
SELECT pg_temp.t311_assert((:'t311_tick2'::JSONB ->> 'created')::INTEGER = 0 AND (:'t311_tick2'::JSONB ->> 'skipped')::INTEGER = 0
  AND (:'t311_tick2'::JSONB ->> 'marked')::INTEGER = 0 AND (:'t311_tick2'::JSONB ->> 'failed')::INTEGER = 0
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t311_id(1)) = :t311_tasks_before
  AND (SELECT count(*) FROM platform_private.telephony_task_links WHERE organization_id = pg_temp.t311_id(1)) = :t311_links_before,
  'a second tick decides nothing and creates nothing (one decision per call)');
SELECT pg_temp.t311_assert(pg_temp.t311_finish(1, 'sent', 'tdb-1') = '{"status":"sent","changed":false}'::JSONB
  AND pg_temp.t311_finish(2, 'sent', 'tdb-2') = '{"status":"sent","changed":false}'::JSONB
  AND (SELECT count(*) FROM platform.audit_events WHERE action = 'telephony.dial' AND resource_id = pg_temp.t311_id(8001)) = 1,
  'a repeated dial result changes nothing and writes no second journal row');
SELECT pg_temp.t311_assert(platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-1')).id) = pg_temp.t311_id(8001)
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-1')).id) = pg_temp.t311_id(8001)
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-5-evt')).id) = pg_temp.t311_id(8005)
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-4')).id) IS NULL
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-1b')).id) IS NULL,
  'binding again returns the same dial (or none) every time');
SELECT pg_temp.t311_assert(NOT EXISTS (
    SELECT 1 FROM t311_snapshot s JOIN platform_private.telephony_calls c ON c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = s.pbx_callid
    WHERE (c.dial_request_id, c.automation_outcome, c.automation_done_at, c.result_code, c.result_at, c.updated_at)
      IS DISTINCT FROM (s.dial_request_id, s.automation_outcome, s.automation_done_at, s.result_code, s.result_at, s.updated_at)),
  'no call row changed through the second tick, the repeated result and the repeated binds');
SELECT pg_temp.t311_assert(pg_temp.t311_try(format($q$UPDATE platform_private.telephony_calls SET dial_request_id = %L
    WHERE organization_id = %L AND pbx_callid = 'tdb-1b'$q$, pg_temp.t311_id(8001), pg_temp.t311_id(1))) = '23505',
  'the database itself refuses a second call for one dial (unique index of the schema)');

-- No call id, number or login in the journal, the task texts or the audit of the dial.
SELECT pg_temp.t311_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.t311_id(1)
    AND (to_jsonb(a)::TEXT LIKE '%tdb-%' OR to_jsonb(a)::TEXT LIKE '%99655510%' OR to_jsonb(a)::TEXT LIKE '%m701%'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.t311_id(1)
    AND (to_jsonb(t)::TEXT LIKE '%tdb-%' OR to_jsonb(t)::TEXT LIKE '%99655510%')),
  'no call id, client number or PBX login in the journal or in any task the automation made');

-- ---------------------------------------------------------------------------
-- 4. The binding rules at the table (direct rows), the chain and the employee check.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t311_dial(n) FROM generate_series(8, 14) n;
SELECT pg_temp.t311_finish(8, 'sent', 'tdb-8');
SELECT pg_temp.t311_finish(9, 'sent', 'tdb-9');
SELECT pg_temp.t311_finish(10, 'sent', 'tdb-12');
SELECT pg_temp.t311_finish(11, 'unconfirmed');
SELECT pg_temp.t311_finish(12, 'sent', 'tdb-13x');
-- Not bound: another organization, an inbound call, a call in doubt (needs_review), a dial not sent yet.
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, created_via)
  VALUES (pg_temp.t311_id(2), 'tdb-8', 'out', clock_timestamp(), pg_temp.t311_phone(8), 'webhook');
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, created_via)
  VALUES (pg_temp.t311_id(1), 'tdb-12', 'in', clock_timestamp(), pg_temp.t311_phone(10), 'webhook');
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, needs_review, created_via)
  VALUES (pg_temp.t311_id(1), 'tdb-9', 'out', clock_timestamp(), pg_temp.t311_phone(9), TRUE, 'webhook');
SELECT pg_temp.t311_assert((SELECT dial_request_id IS NULL FROM platform_private.telephony_calls
      WHERE organization_id = pg_temp.t311_id(2) AND pbx_callid = 'tdb-8')
  AND (pg_temp.t311_call('tdb-12')).dial_request_id IS NULL AND (pg_temp.t311_call('tdb-9')).dial_request_id IS NULL,
  'the insert trigger does not bind across organizations, to an inbound call or to a call in doubt');
-- Bound: an outbound call of the same organization with the call id of a sent dial.
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, created_via)
  VALUES (pg_temp.t311_id(1), 'tdb-8', 'out', clock_timestamp(), pg_temp.t311_phone(8), 'webhook');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-8')).dial_request_id = pg_temp.t311_id(8008),
  'an outbound call with the call id of a sent dial of its own organization is bound at insertion');
-- A call in doubt that later turns clear is bound by the lookup (the decision), not by the trigger.
UPDATE platform_private.telephony_calls SET needs_review = FALSE WHERE organization_id = pg_temp.t311_id(1) AND pbx_callid = 'tdb-9';
SELECT pg_temp.t311_assert(platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-9')).id) = pg_temp.t311_id(8009)
  AND (pg_temp.t311_call('tdb-9')).dial_request_id = pg_temp.t311_id(8009),
  'the lookup binds a call by the call id of a sent dial (exact key) when the trigger had left it alone');
-- An inbound call is never a dial; neither is an unknown id.
SELECT pg_temp.t311_assert(platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-12')).id) IS NULL
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), pg_temp.t311_id(9999)) IS NULL
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(2), (pg_temp.t311_call('tdb-9')).id) IS NULL,
  'an inbound call, an unknown call and a call asked for from another organization have no dial');

-- A transfer chain: X (the dial call id) carries the dial, Y (linked by the transfer) belongs to the same contact.
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, created_via)
  VALUES (pg_temp.t311_id(1), 'tdb-13x', 'out', clock_timestamp(), pg_temp.t311_phone(12), 'webhook');
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, linked_call_id, created_via)
  SELECT pg_temp.t311_id(1), 'tdb-13y', 'out', clock_timestamp(), pg_temp.t311_phone(12), c.id, 'webhook'
  FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = 'tdb-13x';
INSERT INTO platform_private.telephony_calls(organization_id, pbx_callid, direction, started_at, client_phone, created_via)
  VALUES (pg_temp.t311_id(1), 'tdb-13z', 'out', clock_timestamp(), pg_temp.t311_phone(12), 'webhook');
SELECT pg_temp.t311_assert((pg_temp.t311_call('tdb-13x')).dial_request_id = pg_temp.t311_id(8012)
  AND (pg_temp.t311_call('tdb-13y')).dial_request_id IS NULL
  AND (SELECT count(*) FROM platform_private.telephony_call_chain(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-13y')).id)) = 2
  AND (SELECT count(*) FROM platform_private.telephony_call_chain(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-13z')).id)) = 1
  AND (SELECT count(*) FROM platform_private.telephony_call_chain(pg_temp.t311_id(2), (pg_temp.t311_call('tdb-13y')).id)) = 0,
  'the chain follows linked_call_id both ways inside the organization; an unlinked call is its own chain');
SELECT pg_temp.t311_assert(platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-13y')).id) = pg_temp.t311_id(8012)
  AND (pg_temp.t311_call('tdb-13y')).dial_request_id IS NULL
  AND platform_private.telephony_dial_bind(pg_temp.t311_id(1), (pg_temp.t311_call('tdb-13z')).id) IS NULL,
  'a call linked to the dial call by a transfer belongs to the same dial (the link itself stays on the first call); an unlinked one does not');

-- The employee check across the chain (legs inserted directly).
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, state, leg_started_at, leg_start_source)
  SELECT pg_temp.t311_id(1), c.id, 'M701', 'cancelled', clock_timestamp(), 'event'
  FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = 'tdb-13x';
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, state, leg_started_at, leg_start_source)
  SELECT pg_temp.t311_id(1), c.id, 'm702', 'accepted', clock_timestamp(), 'event'
  FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = 'tdb-13y';
SELECT pg_temp.t311_assert(NOT platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13y')).id),
  'a cancelled leg of the employee and an accepted leg of ANOTHER employee are not an answer of the employee');
INSERT INTO platform_private.telephony_call_legs(organization_id, call_id, pbx_user, state, leg_started_at, leg_start_source)
  SELECT pg_temp.t311_id(1), c.id, 'm701', 'ringing', clock_timestamp() + INTERVAL '1 second', 'event'
  FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t311_id(1) AND c.pbx_callid = 'tdb-13y';
SELECT pg_temp.t311_assert(NOT platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13y')).id),
  'a ringing leg of the employee is not an answer either');
UPDATE platform_private.telephony_call_legs SET accepted_at = clock_timestamp()
  WHERE organization_id = pg_temp.t311_id(1) AND call_id = (pg_temp.t311_call('tdb-13x')).id AND pbx_user = 'M701';
SELECT pg_temp.t311_assert(platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13y')).id)
  AND platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012), (pg_temp.t311_call('tdb-13x')).id)
  AND NOT platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012), (pg_temp.t311_call('tdb-13z')).id)
  AND NOT platform_private.telephony_dial_employee_answered(pg_temp.t311_id(2), pg_temp.t311_id(8012), (pg_temp.t311_call('tdb-13y')).id),
  'ACCEPTED on the employee''s own leg (any call of the chain, login in any case) is an answer; an unlinked call and another organization are not');
UPDATE platform_private.telephony_call_legs SET accepted_at = NULL, state = 'completed'
  WHERE organization_id = pg_temp.t311_id(1) AND call_id = (pg_temp.t311_call('tdb-13x')).id AND pbx_user = 'M701';
SELECT pg_temp.t311_assert(platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13x')).id),
  'a completed leg of the employee is an answer');
UPDATE platform_private.telephony_call_legs SET state = 'missed', talk_seconds = 12
  WHERE organization_id = pg_temp.t311_id(1) AND call_id = (pg_temp.t311_call('tdb-13x')).id AND pbx_user = 'M701';
SELECT pg_temp.t311_assert(platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13x')).id),
  'talk time on the employee''s leg is an answer');
UPDATE platform_private.telephony_call_legs SET talk_seconds = NULL, status = 'success', webhook_total_seconds = 30
  WHERE organization_id = pg_temp.t311_id(1) AND call_id = (pg_temp.t311_call('tdb-13x')).id AND pbx_user = 'M701';
SELECT pg_temp.t311_assert(platform_private.telephony_dial_employee_answered(pg_temp.t311_id(1), pg_temp.t311_id(8012),
      (pg_temp.t311_call('tdb-13x')).id),
  'Success with a duration on the employee''s leg is an answer');

-- The automation label is a closed list.
SELECT pg_temp.t311_assert(pg_temp.t311_try(format($q$UPDATE platform_private.telephony_calls
    SET automation_done_at = clock_timestamp(), automation_outcome = 'skipped_dial_unanswered'
    WHERE organization_id = %L AND pbx_callid = 'tdb-13z'$q$, pg_temp.t311_id(1))) = 'ok'
  AND pg_temp.t311_try(format($q$UPDATE platform_private.telephony_calls
    SET automation_done_at = clock_timestamp(), automation_outcome = 'skipped_something_else'
    WHERE organization_id = %L AND pbx_callid = 'tdb-13z'$q$, pg_temp.t311_id(1))) = '23514',
  'the new mark is accepted, an unknown one is still refused by the constraint');

\echo T311_TELEPHONY_DIAL_BIND_SUITE_END
\echo T311_TELEPHONY_DIAL_BIND_SUITE_PASSED
ROLLBACK;
