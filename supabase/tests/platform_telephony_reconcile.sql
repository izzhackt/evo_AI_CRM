\set ON_ERROR_STOP on
-- Boundary suite for migration 293 «Телефония Beeline KG» срез T4a (сверка по
-- истории ВАТС, первичный импорт, справочник сотрудников ВАТС, состояние и
-- здоровье фоновой работы; docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.3, §5.4,
-- §6.1, §6.3, §7.3; ADR 0033). Runs on the real chain right after 293 inside one
-- transaction that is rolled back, with its own synthetic organizations, members,
-- clients, leads, PBX users and history rows: no PBX call, no real person, no
-- real phone, no recording, no production action. The public functions are
-- called through the same request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. catalog and grants: the five new platform.telephony_*_v1 functions are
--     SECURITY DEFINER with an empty search_path and EXECUTE for service_role
--     only; the three new private helpers are closed to PUBLIC and every client
--     role; anon, authenticated, supabase_auth_admin, the AI agent role and a
--     service_role without the service claim are refused with 42501;
--  2. schema: the import flag ships OFF; the new runtime columns ship empty; the
--     facts and counters columns refuse links, texts, unknown names, signs and
--     over-long values;
--  3. the directory sync (GET /users): rows by login without case, ivr/fax,
--     duplicates and non-objects skipped, an empty or useless list changes
--     nothing, the EVO employee is never assigned, a partial list never
--     deactivates, a complete list deactivates (not deletes) the missing ones,
--     a returning user reactivates unless the EVO employee is held by another
--     active PBX user;
--  4. the maintenance plan: no settings row means every call-writing job is off;
--     the directory and the probe run before the projection flag; the reconcile,
--     daily and import windows by the database clock; the import needs its own
--     flag and stops at 22.10.2025;
--  5. the history apply (GET /history/json): closed by the projection flag and,
--     for the import, by its own flag; argument errors; created calls with the
--     pull outcome (never 'busy' and the like), the answer rule per direction
--     and destination, a greeting is not an answer, an unknown status asks for
--     review, invalid rows counted, a repeat changes nothing; the link only in
--     the leg; a webhook call is completed (talk time, wait, destination, link)
--     but its exact outcome is never overwritten, an answer is irreversible and
--     only the reconciliation can promote a missed call to answered; a call
--     still ringing is closed by the reconciliation; a possible duplicate is
--     created but flagged; the 360-day link rule; the import drops unmatched and
--     ambiguous numbers without a trace, creates nothing else and keeps the
--     link; a failing row costs only itself and leaves only a coded error;
--     organizations are isolated;
--  6. the run mark: the times, the forward-only reconcile cursor, the
--     backward-only import cursor with its floor, the coded PBX error, the
--     filtered facts and counters;
--  7. the health data: numbers, times and words only, with no phone, login or
--     link.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo T293_TELEPHONY_RECONCILE_SUITE_START

CREATE FUNCTION pg_temp.t293_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29300000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t293_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T293: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.t293_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t293_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.t293_hex() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex')
$$;
-- History start in the PBX form (ISO, UTC) and the webhook form, relative to one
-- fixed anchor, so the same call carries the same start in every batch.
CREATE TEMP TABLE t293_anchor(t TIMESTAMPTZ);
INSERT INTO t293_anchor VALUES (clock_timestamp());
CREATE FUNCTION pg_temp.t293_iso(p_minutes_ago NUMERIC) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT to_char((SELECT t FROM t293_anchor) - make_interval(secs => (p_minutes_ago * 60)::DOUBLE PRECISION), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
CREATE FUNCTION pg_temp.t293_wh(p_minutes_ago NUMERIC) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT to_char((SELECT t FROM t293_anchor) - make_interval(secs => (p_minutes_ago * 60)::DOUBLE PRECISION), 'YYYYMMDD"T"HH24MISS"Z"')
$$;

CREATE TEMP TABLE t293_tables(name TEXT);
INSERT INTO t293_tables VALUES ('telephony_settings'), ('telephony_runtime_state'), ('telephony_extensions'),
  ('telephony_pbx_events'), ('telephony_event_work'), ('telephony_dial_requests'), ('telephony_calls'),
  ('telephony_call_legs'), ('telephony_call_events'), ('telephony_recording_grants'), ('telephony_task_links');
-- Which tables hold a needle anywhere in any column ('' = none).
CREATE FUNCTION pg_temp.t293_leak(p_needle TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; found TEXT := '';
BEGIN
  FOR t IN SELECT name FROM t293_tables ORDER BY name LOOP
    EXECUTE format('SELECT count(*) FROM platform_private.%I x WHERE to_jsonb(x)::TEXT LIKE %L', t, '%' || p_needle || '%') INTO n;
    IF n > 0 THEN found := found || t || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

CREATE TEMP TABLE t293_r(k TEXT PRIMARY KEY, r JSONB);
CREATE FUNCTION pg_temp.t293_put(p_key TEXT, p_value JSONB) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO t293_r VALUES (p_key, p_value) ON CONFLICT (k) DO UPDATE SET r = EXCLUDED.r
$$;
CREATE FUNCTION pg_temp.t293_get(p_key TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT r FROM t293_r WHERE k = p_key
$$;

-- One GET /history/json row. Missing parts are NULL and omitted.
CREATE FUNCTION pg_temp.t293_row(p_uid TEXT, p_type TEXT, p_status TEXT, p_client TEXT, p_user TEXT, p_dest TEXT,
  p_start TEXT, p_wait INTEGER, p_dur INTEGER, p_record TEXT DEFAULT NULL, p_group TEXT DEFAULT NULL,
  p_missed INTEGER DEFAULT NULL, p_extra JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('uid', p_uid, 'type', p_type, 'status', p_status, 'client', p_client,
    'user', p_user, 'destination', p_dest, 'start', p_start, 'wait', p_wait, 'duration', p_dur, 'record', p_record,
    'group_name', p_group, 'missedStatus', p_missed, 'diversion', '996312000000', 'telnum_name', 'T293 Main number')
    || p_extra)
$$;
CREATE FUNCTION pg_temp.t293_apply(p_mode TEXT, p_rows JSONB, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_reconcile_apply_v1(pg_temp.t293_id(p_org), p_mode, p_rows)
$$;
-- Webhook builders (the T1b intake), to prepare calls the reconciliation completes.
CREATE FUNCTION pg_temp.t293_recv(p_cmd TEXT, p_fields JSONB, p_link TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT platform.telephony_receive_v1(pg_temp.t293_id(p_org), gen_random_uuid(), p_cmd, 'current', pg_temp.t293_hex(),
    jsonb_strip_nulls(p_fields), p_link, NULL)
$$;
CREATE FUNCTION pg_temp.t293_e(p_type TEXT, p_callid TEXT, p_user TEXT, p_phone TEXT, p_dir TEXT DEFAULT 'in') RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT pg_temp.t293_recv('event', jsonb_build_object('cmd', 'event', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'direction', p_dir))
$$;
CREATE FUNCTION pg_temp.t293_h(p_callid TEXT, p_user TEXT, p_phone TEXT, p_type TEXT, p_status TEXT, p_start TEXT,
  p_dur INTEGER, p_wait INTEGER DEFAULT 5, p_link TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t293_recv('history', jsonb_build_object('cmd', 'history', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'status', p_status, 'start', p_start, 'duration', p_dur, 'wait', p_wait,
    'diversion', '996312000000'), p_link)
$$;
-- Read helpers.
CREATE FUNCTION pg_temp.t293_call(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS platform_private.telephony_calls
LANGUAGE SQL AS $$
  SELECT c FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t293_id(p_org) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t293_legs(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_call_legs l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = pg_temp.t293_id(p_org) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t293_leg(p_callid TEXT, p_user TEXT, p_org INTEGER DEFAULT 1) RETURNS platform_private.telephony_call_legs
LANGUAGE SQL AS $$
  SELECT l FROM platform_private.telephony_call_legs l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = pg_temp.t293_id(p_org) AND c.pbx_callid = p_callid AND l.pbx_user = p_user
  ORDER BY l.leg_started_at, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t293_events(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_call_events e
  JOIN platform_private.telephony_calls c ON c.organization_id = e.organization_id AND c.id = e.call_id
  WHERE c.organization_id = pg_temp.t293_id(p_org) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t293_call_rows() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT (SELECT count(*) FROM platform_private.telephony_calls)
    + (SELECT count(*) FROM platform_private.telephony_call_legs)
    + (SELECT count(*) FROM platform_private.telephony_call_events)
$$;

-- The service path: the JWT role claim the public functions check.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: members 301 and 302, PBX users u701 -> 301, u702 ->
-- 302, u703 unmapped; clients A (one open lead), B, an ambiguous pair E1/E2.
-- Organization 2: member 305, PBX user u701 -> 305, client A with the same phone.
-- Organization 3 (directory, plan and mark tests): members 306-308, no extensions.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t293_id(1), 'T293 Fictional organization'),
  (pg_temp.t293_id(2), 'T293 Other fictional organization'), (pg_temp.t293_id(3), 'T293 Directory organization');
CREATE TEMP TABLE t293_actors(n INTEGER, org INTEGER);
INSERT INTO t293_actors VALUES (1, 1), (2, 1), (5, 2), (6, 3), (7, 3), (8, 3);
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t293_id(100 + n), 't293-' || n || '@example.invalid', '{}'::JSONB FROM t293_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t293_id(200 + n), pg_temp.t293_id(100 + n), 'T293 Actor ' || n, 'active', 1 FROM t293_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t293_id(300 + n), pg_temp.t293_id(org), pg_temp.t293_id(200 + n), 'active', NULL, NULL FROM t293_actors;
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id) VALUES
  (pg_temp.t293_id(1), 'u701', '701', 'T293 PBX user 1', pg_temp.t293_id(301)),
  (pg_temp.t293_id(1), 'u702', '702', 'T293 PBX user 2', pg_temp.t293_id(302)),
  (pg_temp.t293_id(1), 'u703', '703', 'T293 PBX user 3', NULL),
  (pg_temp.t293_id(2), 'u701', '701', 'T293 PBX user 1 (other organization)', pg_temp.t293_id(305));
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state) VALUES
  (pg_temp.t293_id(701), pg_temp.t293_id(1), 'T293 Client A', platform_private.normalize_person_name('T293 Client A'),
    '+996555000111', platform_private.normalize_person_phone('+996555000111'), 'active'),
  (pg_temp.t293_id(703), pg_temp.t293_id(1), 'T293 Client B', platform_private.normalize_person_name('T293 Client B'),
    '0555000222', platform_private.normalize_person_phone('0555000222'), 'active'),
  (pg_temp.t293_id(707), pg_temp.t293_id(1), 'T293 Client E1', platform_private.normalize_person_name('T293 Client E1'),
    '+996555000555', platform_private.normalize_person_phone('+996555000555'), 'active'),
  (pg_temp.t293_id(708), pg_temp.t293_id(1), 'T293 Client E2', platform_private.normalize_person_name('T293 Client E2'),
    '+996555000555', platform_private.normalize_person_phone('+996555000555'), 'active'),
  (pg_temp.t293_id(710), pg_temp.t293_id(2), 'T293 Client A other org', platform_private.normalize_person_name('T293 Client A other org'),
    '+996555000111', platform_private.normalize_person_phone('+996555000111'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, updated_at) VALUES
  (pg_temp.t293_id(702), pg_temp.t293_id(1), pg_temp.t293_id(701), pg_temp.t293_id(301), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t293_id(704), pg_temp.t293_id(1), pg_temp.t293_id(703), pg_temp.t293_id(301), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t293_id(716), pg_temp.t293_id(2), pg_temp.t293_id(710), pg_temp.t293_id(305), 'new', 'website', 'open', '2031-02-01 10:00:00+00');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t293_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_claim_work_v1', 'telephony_integration_health_v1', 'telephony_maintenance_plan_v1',
    'telephony_project_work_v1', 'telephony_receive_v1', 'telephony_reconcile_apply_v1', 'telephony_runtime_mark_v1',
    'telephony_settle_calls_v1', 'telephony_sync_extensions_v1'],
  'exactly nine public telephony functions exist in platform (four of T1b, five of T4a)');
SELECT pg_temp.t293_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'),
  'the public functions: SECURITY DEFINER, empty search_path, owner postgres, EXECUTE for service_role only');
SELECT pg_temp.t293_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%'
      AND p.proname IN ('telephony_summary_ok', 'telephony_facts_ok', 'telephony_reconcile_row'))
  = ARRAY['telephony_facts_ok', 'telephony_reconcile_row', 'telephony_summary_ok'],
  'the three new private helpers exist');
SELECT pg_temp.t293_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  AND (SELECT bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%'),
  'no private telephony helper is executable by PUBLIC or any client role, and each has an empty search_path');
SELECT pg_temp.t293_assert((SELECT bool_and(
      pg_temp.t293_as(r.role, c.claims, format('SELECT platform.telephony_maintenance_plan_v1(%L)', pg_temp.t293_id(1))) = '42501'
    AND pg_temp.t293_as(r.role, c.claims, format('SELECT platform.telephony_sync_extensions_v1(%L, ''[]'')', pg_temp.t293_id(1))) = '42501'
    AND pg_temp.t293_as(r.role, c.claims, format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', ''[]'')', pg_temp.t293_id(1))) = '42501'
    AND pg_temp.t293_as(r.role, c.claims, format('SELECT platform.telephony_runtime_mark_v1(%L, ''tick'')', pg_temp.t293_id(1))) = '42501'
    AND pg_temp.t293_as(r.role, c.claims, format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t293_id(1))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"service_role"}'), ('{"role":"authenticated","sub":"29300000-0000-4000-8000-000000000101"}'), ('')) c(claims)),
  'anon, authenticated, supabase_auth_admin and the AI agent role are refused by every T4a function, whatever the claims');
SELECT pg_temp.t293_assert((SELECT bool_and(pg_temp.t293_as('service_role', c.claims, s.stmt) = '42501')
    FROM (VALUES ('{"role":"authenticated"}'), ('{"role":"anon"}'), (''), ('{"sub":"29300000-0000-4000-8000-000000000101"}')) c(claims)
    CROSS JOIN (VALUES
      (format('SELECT platform.telephony_maintenance_plan_v1(%L)', pg_temp.t293_id(1))),
      (format('SELECT platform.telephony_sync_extensions_v1(%L, ''[]'')', pg_temp.t293_id(1))),
      (format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', ''[]'')', pg_temp.t293_id(1))),
      (format('SELECT platform.telephony_runtime_mark_v1(%L, ''tick'')', pg_temp.t293_id(1))),
      (format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t293_id(1)))) s(stmt)),
  'the database role service_role without the service claim is refused too (the role check is inside the function)');
SELECT pg_temp.t293_assert(pg_temp.t293_as('service_role', '{"role":"service_role"}',
    'SELECT platform_private.telephony_reconcile_row(''29300000-0000-4000-8000-000000000001'', ''reconcile'', ''{}'')') = '42501',
  'the row writer is not callable by service_role');
SELECT pg_temp.t293_assert(pg_temp.t293_as('service_role', '{"role":"service_role"}',
    'SELECT * FROM platform_private.telephony_runtime_state') = '42501',
  'the tables stay closed to service_role');

-- ---------------------------------------------------------------------------
-- 2. Schema: the new flag and columns, the shape locks.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t293_id(3));
SELECT pg_temp.t293_assert((SELECT backfill_enabled = FALSE AND projection_enabled = FALSE
    FROM platform_private.telephony_settings WHERE organization_id = pg_temp.t293_id(3)),
  'the import flag ships OFF next to the others');
INSERT INTO platform_private.telephony_runtime_state(organization_id) VALUES (pg_temp.t293_id(3));
SELECT pg_temp.t293_assert((SELECT users_sync_run_at IS NULL AND users_sync_success_at IS NULL AND reconcile_daily_run_at IS NULL
      AND reconcile_daily_success_at IS NULL AND backfill_run_at IS NULL AND probe_run_at IS NULL AND probe_success_at IS NULL
      AND pbx_facts IS NULL AND mode_summaries = '{}'::JSONB
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(3)),
  'the new runtime columns ship empty');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"timezone_name":"Asia/Bishkek","timezone_offset_minutes":360,"users_used":5,"users_total":5,"groups_total":2,"record_service":true,"record_external":true,"record_inner":false,"record_exceptions":0}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = 'ok'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"timezone_name":"https://x.example.invalid"}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"login":"u701"}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"users_used":"five"}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"record_service":"yes"}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '[1]'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET pbx_facts = '{"users_total":-1}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = 'ok',
  'pbx_facts takes the closed list of names with numbers, flags and one zone name; links, logins, texts and arrays are refused');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":{"rows":12,"created":1},"users":{"inserted":5}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = 'ok'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":{"rows":"12"}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":{"rows":-1}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":{"rows":1.5}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"other":{"rows":1}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":{"Rows!":1}}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514'
  AND pg_temp.t293_state($q$UPDATE platform_private.telephony_runtime_state SET mode_summaries = '{"reconcile":5}'::JSONB
    WHERE organization_id = pg_temp.t293_id(3)$q$) = '23514',
  'mode_summaries takes only the four modes with integer counters');
UPDATE platform_private.telephony_runtime_state SET pbx_facts = NULL, mode_summaries = '{}'::JSONB
  WHERE organization_id = pg_temp.t293_id(3);

-- ---------------------------------------------------------------------------
-- 3. The directory sync (organization 3 starts with no PBX user).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t293_put('s_empty', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), '[]'::JSONB, TRUE)),
  pg_temp.t293_put('s_junk', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3),
    '[1, "x", {"name":"no login"}, {"login":"ivr"}, {"login":"FAX"}, {"login":"   "}]'::JSONB, TRUE));
SELECT pg_temp.t293_assert(pg_temp.t293_get('s_empty')->>'status' = 'empty' AND pg_temp.t293_get('s_junk')->>'status' = 'empty'
  AND (pg_temp.t293_get('s_junk')->>'invalid')::INT = 6
  AND (SELECT count(*) FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3)) = 0,
  'an empty list and a list with no usable login change nothing (a PBX failure never empties the directory)');
SELECT pg_temp.t293_put('s1', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), jsonb_build_array(
  jsonb_build_object('login', 'U801', 'name', 'T293 Employee One', 'ext', '801', 'role', 'admin', 'email', 'x@example.invalid', 'mobile', '996555009901'),
  jsonb_build_object('login', 'u802', 'name', 'T293 Employee Two', 'ext', '802'),
  jsonb_build_object('login', 'u803', 'name', E'T293 Employee\tThree', 'ext', 803),
  jsonb_build_object('login', 'U801', 'name', 'duplicate in the same list'),
  jsonb_build_object('login', 'ivr'), jsonb_build_object('login', 'Fax')), TRUE));
SELECT pg_temp.t293_assert(pg_temp.t293_get('s1')->>'status' = 'ok' AND (pg_temp.t293_get('s1')->>'inserted')::INT = 3
  AND (pg_temp.t293_get('s1')->>'invalid')::INT = 3 AND (pg_temp.t293_get('s1')->>'received')::INT = 6
  AND (pg_temp.t293_get('s1')->>'active')::INT = 3
  AND (SELECT count(*) FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3)) = 3
  AND (SELECT bool_and(membership_id IS NULL AND active AND last_seen_in_users_at IS NOT NULL)
    FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3)),
  'new users are inserted by login; ivr, fax, a duplicate login in one list are skipped; nobody is assigned an EVO employee');
SELECT pg_temp.t293_assert((SELECT pbx_user = 'U801' AND extension = '801' AND pbx_display_name = 'T293 Employee One'
    FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3) AND lower(pbx_user) = 'u801')
  AND (SELECT extension = '803' AND pbx_display_name = 'T293 EmployeeThree' FROM platform_private.telephony_extensions
    WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u803'),
  'the login keeps the PBX spelling, control characters leave the name, a numeric extension is read as text');
SELECT pg_temp.t293_assert(pg_temp.t293_leak('x@example.invalid') = '' AND pg_temp.t293_leak('996555009901') = '',
  'the e-mail and the mobile of a PBX user are never read into the directory');
-- Assign an EVO employee (this is what an administrator does in T4b), then sync again.
UPDATE platform_private.telephony_extensions SET membership_id = pg_temp.t293_id(306)
  WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'U801';
UPDATE platform_private.telephony_extensions SET membership_id = pg_temp.t293_id(307)
  WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u802';
SELECT pg_temp.t293_put('s2', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), jsonb_build_array(
  jsonb_build_object('login', 'u801', 'name', 'T293 Employee One Renamed', 'ext', '811'),
  jsonb_build_object('login', 'U802', 'name', 'T293 Employee Two', 'ext', '802'),
  jsonb_build_object('login', 'u804', 'name', 'T293 Employee Four', 'ext', '804')), FALSE));
SELECT pg_temp.t293_assert((pg_temp.t293_get('s2')->>'inserted')::INT = 1 AND (pg_temp.t293_get('s2')->>'updated')::INT = 1
  AND (pg_temp.t293_get('s2')->>'deactivated')::INT = 0
  AND (SELECT extension = '811' AND pbx_display_name = 'T293 Employee One Renamed' AND membership_id = pg_temp.t293_id(306) AND pbx_user = 'U801'
    FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3) AND lower(pbx_user) = 'u801')
  AND (SELECT count(*) FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3)) = 4
  AND (SELECT active FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u803'),
  'a login matches without case, a rename updates, the assigned employee stays, and a partial list deactivates nobody');
SELECT pg_temp.t293_put('s3', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), jsonb_build_array(
  jsonb_build_object('login', 'u801', 'ext', '811', 'name', 'T293 Employee One Renamed'),
  jsonb_build_object('login', 'u802', 'ext', '802', 'name', 'T293 Employee Two')), TRUE));
SELECT pg_temp.t293_assert((pg_temp.t293_get('s3')->>'deactivated')::INT = 2 AND (pg_temp.t293_get('s3')->>'active')::INT = 2
  AND (SELECT NOT active AND membership_id IS NULL FROM platform_private.telephony_extensions
    WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u803')
  AND (SELECT count(*) FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3)) = 4,
  'a complete list deactivates the users that are gone (u803, u804) and deletes nobody');
-- A deactivated user with an assigned employee returns; the employee is free -> active again.
UPDATE platform_private.telephony_extensions SET active = FALSE
  WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u802';
SELECT pg_temp.t293_put('s4', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), jsonb_build_array(
  jsonb_build_object('login', 'u801', 'ext', '811', 'name', 'T293 Employee One Renamed'),
  jsonb_build_object('login', 'u802', 'ext', '802', 'name', 'T293 Employee Two'),
  jsonb_build_object('login', 'u803', 'ext', '803', 'name', 'T293 Employee Three')), TRUE));
SELECT pg_temp.t293_assert((pg_temp.t293_get('s4')->>'reactivated')::INT = 2 AND (pg_temp.t293_get('s4')->>'conflicts')::INT = 0
  AND (SELECT active AND membership_id = pg_temp.t293_id(307) FROM platform_private.telephony_extensions
    WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u802')
  AND (SELECT active AND membership_id IS NULL FROM platform_private.telephony_extensions
    WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u803'),
  'returning users reactivate; an assigned employee comes back with the user');
-- Conflict: u802 is gone and u805 took its employee; u802 comes back but stays inactive.
UPDATE platform_private.telephony_extensions SET active = FALSE
  WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u802';
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id)
  VALUES (pg_temp.t293_id(3), 'u805', '805', 'T293 Employee Five', pg_temp.t293_id(307));
SELECT pg_temp.t293_put('s5', platform.telephony_sync_extensions_v1(pg_temp.t293_id(3), jsonb_build_array(
  jsonb_build_object('login', 'u801', 'ext', '811', 'name', 'T293 Employee One Renamed'),
  jsonb_build_object('login', 'u802', 'ext', '802', 'name', 'T293 Employee Two'),
  jsonb_build_object('login', 'u805', 'ext', '805', 'name', 'T293 Employee Five')), FALSE));
SELECT pg_temp.t293_assert((pg_temp.t293_get('s5')->>'conflicts')::INT = 1 AND (pg_temp.t293_get('s5')->>'reactivated')::INT = 0
  AND (SELECT NOT active AND membership_id = pg_temp.t293_id(307) FROM platform_private.telephony_extensions
    WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u802')
  AND (SELECT active FROM platform_private.telephony_extensions WHERE organization_id = pg_temp.t293_id(3) AND pbx_user = 'u805'),
  'a returning user whose employee another active user holds stays inactive (counted as a conflict, never an error)');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state(format('SELECT platform.telephony_sync_extensions_v1(%L, ''{}''::JSONB, TRUE)', pg_temp.t293_id(3))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_sync_extensions_v1(%L, NULL, TRUE)', pg_temp.t293_id(3))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_sync_extensions_v1(%L, ''[]''::JSONB, NULL)', pg_temp.t293_id(3))) = '22023'
  AND pg_temp.t293_state('SELECT platform.telephony_sync_extensions_v1(NULL, ''[]''::JSONB, TRUE)') = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_sync_extensions_v1(%L, ''[]''::JSONB, TRUE)', pg_temp.t293_id(99))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_sync_extensions_v1(%L, %L::JSONB, TRUE)', pg_temp.t293_id(3),
    (SELECT jsonb_agg(jsonb_build_object('login', 'l' || g)) FROM generate_series(1, 201) g)::TEXT)) = '22023',
  'argument errors: not an array, NULL, no flag, no organization, an unknown organization and more than 200 users');

-- ---------------------------------------------------------------------------
-- 4. The maintenance plan (organization 3 has settings and state rows; the
-- directory is active and there is no cursor).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t293_put('p_none', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(2)));
SELECT pg_temp.t293_assert(pg_temp.t293_get('p_none')->>'status' = 'ok'
  AND NOT (pg_temp.t293_get('p_none')->>'projection_enabled')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_none')->>'backfill_enabled')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_none')->>'outbound_paused')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_none')->>'retry_due')::BOOLEAN AND NOT (pg_temp.t293_get('p_none')->>'settle_due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_none')->'reconcile'->>'due')::BOOLEAN AND NOT (pg_temp.t293_get('p_none')->'daily'->>'due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_none')->'backfill'->>'due')::BOOLEAN
  AND (pg_temp.t293_get('p_none')->>'users_due')::BOOLEAN AND (pg_temp.t293_get('p_none')->>'probe_due')::BOOLEAN
  AND (pg_temp.t293_get('p_none')->>'directory_active')::INT = 1,
  'no settings row: nothing that writes calls is due; the directory and the probe are (read-only requests)');
SELECT pg_temp.t293_assert(pg_temp.t293_state(format('SELECT platform.telephony_maintenance_plan_v1(%L)', pg_temp.t293_id(99))) = '22023'
  AND pg_temp.t293_state('SELECT platform.telephony_maintenance_plan_v1(NULL)') = '22023',
  'the plan refuses an unknown or NULL organization');
SELECT pg_temp.t293_put('p_off', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert(NOT (pg_temp.t293_get('p_off')->>'projection_enabled')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_off')->'reconcile'->>'due')::BOOLEAN AND NOT (pg_temp.t293_get('p_off')->'backfill'->>'due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_off')->>'retry_due')::BOOLEAN
  AND (pg_temp.t293_get('p_off')->>'directory_active')::INT = 3,
  'a settings row with the projection OFF keeps reconcile, import, retry and settle off (the import flag alone is not enough)');
UPDATE platform_private.telephony_settings SET projection_enabled = TRUE WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_on', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_on')->>'retry_due')::BOOLEAN AND (pg_temp.t293_get('p_on')->>'settle_due')::BOOLEAN
  AND (pg_temp.t293_get('p_on')->'reconcile'->>'due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_on')->'backfill'->>'due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_on')->'daily'->>'due')::BOOLEAN,
  'projection ON: retry, settle and reconcile are due; the import is not (its flag is off); daily waits for a cursor');
SELECT pg_temp.t293_assert(
  (pg_temp.t293_get('p_on')->'reconcile'->>'window_end')::TIMESTAMPTZ = (pg_temp.t293_get('p_on')->>'now')::TIMESTAMPTZ
  AND (pg_temp.t293_get('p_on')->'reconcile'->>'window_start')::TIMESTAMPTZ
    = (pg_temp.t293_get('p_on')->>'now')::TIMESTAMPTZ - INTERVAL '2 hours',
  'without a cursor the reconcile window is the last two hours');
-- A cursor one hour ago: the window starts two hours before it and ends now.
SELECT pg_temp.t293_put('m_cur1', platform.telephony_runtime_mark_v1(pg_temp.t293_id(3), 'reconcile_ok',
  clock_timestamp() - INTERVAL '1 hour', NULL, '{"rows":3}'::JSONB));
SELECT pg_temp.t293_put('p_cur1', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert(NOT (pg_temp.t293_get('p_cur1')->'reconcile'->>'due')::BOOLEAN,
  'a reconcile that just ran is not due again before ten minutes');
UPDATE platform_private.telephony_runtime_state SET reconcile_run_at = clock_timestamp() - INTERVAL '11 minutes'
  WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_cur2', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_cur2')->'reconcile'->>'due')::BOOLEAN
  AND (pg_temp.t293_get('p_cur2')->'reconcile'->>'window_start')::TIMESTAMPTZ
    = (SELECT reconcile_cursor_at - INTERVAL '2 hours' FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(3))
  AND (pg_temp.t293_get('p_cur2')->'reconcile'->>'window_end')::TIMESTAMPTZ = (pg_temp.t293_get('p_cur2')->>'now')::TIMESTAMPTZ,
  'with a cursor the window runs from cursor minus two hours to now');
-- A cursor 30 hours back: at most 24 hours per run, and the next run does not wait ten minutes.
UPDATE platform_private.telephony_runtime_state SET reconcile_cursor_at = clock_timestamp() - INTERVAL '30 hours',
  reconcile_run_at = clock_timestamp() - INTERVAL '2 minutes' WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_lag', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_lag')->'reconcile'->>'due')::BOOLEAN
  AND (pg_temp.t293_get('p_lag')->'reconcile'->>'window_end')::TIMESTAMPTZ
    = (pg_temp.t293_get('p_lag')->'reconcile'->>'window_start')::TIMESTAMPTZ + INTERVAL '24 hours'
  AND (pg_temp.t293_get('p_lag')->'reconcile'->>'window_end')::TIMESTAMPTZ < (pg_temp.t293_get('p_lag')->>'now')::TIMESTAMPTZ,
  'a reconcile that fell more than a day behind catches up in windows of at most 24 hours, without the ten-minute wait');
-- Daily: due only after 03:00 in Bishkek, once a day, after a first cursor exists.
UPDATE platform_private.telephony_runtime_state SET reconcile_cursor_at = clock_timestamp() - INTERVAL '1 hour',
  reconcile_daily_success_at = NULL, reconcile_daily_run_at = NULL WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_day', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert(
  (pg_temp.t293_get('p_day')->'daily'->>'due')::BOOLEAN
    = (extract(hour FROM (pg_temp.t293_get('p_day')->>'now')::TIMESTAMPTZ AT TIME ZONE 'Asia/Bishkek') >= 3)
  AND (pg_temp.t293_get('p_day')->'daily'->>'window_end')::TIMESTAMPTZ
    = (date_trunc('day', (pg_temp.t293_get('p_day')->>'now')::TIMESTAMPTZ AT TIME ZONE 'Asia/Bishkek')) AT TIME ZONE 'Asia/Bishkek'
  AND (pg_temp.t293_get('p_day')->'daily'->>'window_start')::TIMESTAMPTZ
    = (pg_temp.t293_get('p_day')->'daily'->>'window_end')::TIMESTAMPTZ - INTERVAL '24 hours',
  'the daily window is yesterday in Asia/Bishkek, due only from 03:00 local time');
UPDATE platform_private.telephony_runtime_state SET reconcile_daily_success_at = clock_timestamp()
  WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_assert(NOT (platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3))->'daily'->>'due')::BOOLEAN,
  'a daily run that succeeded today is not due again');
-- The import: its own flag, windows going back from now, the floor 22.10.2025.
UPDATE platform_private.telephony_settings SET backfill_enabled = TRUE WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_bf1', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_bf1')->'backfill'->>'due')::BOOLEAN
  AND (pg_temp.t293_get('p_bf1')->'backfill'->>'window_end')::TIMESTAMPTZ = (pg_temp.t293_get('p_bf1')->>'now')::TIMESTAMPTZ
  AND (pg_temp.t293_get('p_bf1')->'backfill'->>'window_start')::TIMESTAMPTZ
    = (pg_temp.t293_get('p_bf1')->>'now')::TIMESTAMPTZ - INTERVAL '24 hours'
  AND NOT (pg_temp.t293_get('p_bf1')->'backfill'->>'done')::BOOLEAN,
  'with both flags the import is due and starts with the last 24 hours');
SELECT pg_temp.t293_put('m_bf1', platform.telephony_runtime_mark_v1(pg_temp.t293_id(3), 'backfill_ok',
  '2025-10-22 02:00:00+00', NULL, '{"rows":1}'::JSONB));
UPDATE platform_private.telephony_runtime_state SET backfill_run_at = clock_timestamp() - INTERVAL '2 minutes'
  WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_bf2', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_bf2')->'backfill'->>'due')::BOOLEAN
  AND (pg_temp.t293_get('p_bf2')->'backfill'->>'window_end')::TIMESTAMPTZ = TIMESTAMPTZ '2025-10-22 02:00:00+00'
  AND (pg_temp.t293_get('p_bf2')->'backfill'->>'window_start')::TIMESTAMPTZ = TIMESTAMPTZ '2025-10-21 18:00:00+00',
  'the last import window stops at 22.10.2025 00:00 Bishkek (not a day earlier)');
SELECT pg_temp.t293_put('m_bf2', platform.telephony_runtime_mark_v1(pg_temp.t293_id(3), 'backfill_ok',
  '2025-10-21 18:00:00+00', NULL, '{"rows":0}'::JSONB));
SELECT pg_temp.t293_assert((SELECT backfill_done_at IS NOT NULL AND backfill_cursor_at = TIMESTAMPTZ '2025-10-21 18:00:00+00'
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(3)),
  'reaching the floor marks the import done');
UPDATE platform_private.telephony_runtime_state SET backfill_run_at = clock_timestamp() - INTERVAL '2 minutes'
  WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_bf3', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert(NOT (pg_temp.t293_get('p_bf3')->'backfill'->>'due')::BOOLEAN AND (pg_temp.t293_get('p_bf3')->'backfill'->>'done')::BOOLEAN,
  'a finished import is never due again');
-- Outbound pause and an empty directory.
UPDATE platform_private.telephony_settings SET outbound_paused = TRUE WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_assert((platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3))->>'outbound_paused')::BOOLEAN,
  'the plan reports the outbound pause (the script then makes no PBX request)');
UPDATE platform_private.telephony_settings SET outbound_paused = FALSE WHERE organization_id = pg_temp.t293_id(3);
-- Everything else is due again (no recent run, the daily and the import not done), so only the directory decides.
UPDATE platform_private.telephony_runtime_state SET reconcile_run_at = NULL, reconcile_daily_success_at = NULL,
  reconcile_daily_run_at = NULL, backfill_run_at = NULL, backfill_done_at = NULL, backfill_cursor_at = NULL
  WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_assert((platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3))->'reconcile'->>'due')::BOOLEAN
  AND (platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3))->'backfill'->>'due')::BOOLEAN,
  'precondition: with an active directory the reconcile and the import are due');
UPDATE platform_private.telephony_extensions SET active = FALSE WHERE organization_id = pg_temp.t293_id(3);
SELECT pg_temp.t293_put('p_dir', platform.telephony_maintenance_plan_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('p_dir')->>'directory_active')::INT = 0
  AND NOT (pg_temp.t293_get('p_dir')->'reconcile'->>'due')::BOOLEAN AND NOT (pg_temp.t293_get('p_dir')->'daily'->>'due')::BOOLEAN
  AND NOT (pg_temp.t293_get('p_dir')->'backfill'->>'due')::BOOLEAN AND (pg_temp.t293_get('p_dir')->>'users_due')::BOOLEAN,
  'an empty directory blocks reconcile, daily and import (nobody could be recognised as answering) and keeps the sync due');

-- ---------------------------------------------------------------------------
-- 5. The history apply (organization 1).
-- ---------------------------------------------------------------------------
-- 5a. Closed while the projection flag is off (no settings row).
SELECT pg_temp.t293_put('a_off', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-off-1', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(30), 5, 40))));
SELECT pg_temp.t293_assert(pg_temp.t293_get('a_off')->>'status' = 'disabled' AND pg_temp.t293_get('a_off')->>'reason' = 'projection'
  AND pg_temp.t293_call_rows() = 0,
  'without a settings row the apply refuses and writes nothing');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t293_id(1));
SELECT pg_temp.t293_put('a_off2', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-off-2', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(30), 5, 40))));
SELECT pg_temp.t293_assert(pg_temp.t293_get('a_off2')->>'status' = 'disabled' AND pg_temp.t293_call_rows() = 0,
  'with the projection OFF the apply refuses and writes nothing');
UPDATE platform_private.telephony_settings SET projection_enabled = TRUE WHERE organization_id = pg_temp.t293_id(1);
SELECT pg_temp.t293_put('a_bf_off', pg_temp.t293_apply('backfill', jsonb_build_array(
  pg_temp.t293_row('r-bf-off', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(600), 5, 40))));
SELECT pg_temp.t293_assert(pg_temp.t293_get('a_bf_off')->>'status' = 'disabled' AND pg_temp.t293_get('a_bf_off')->>'reason' = 'backfill'
  AND pg_temp.t293_call_rows() = 0,
  'the import mode needs its own flag even when the projection is ON');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, ''sideways'', ''[]'')', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, NULL, ''[]'')', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', NULL)', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', ''{}''::JSONB)', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state('SELECT platform.telephony_reconcile_apply_v1(NULL, ''reconcile'', ''[]'')') = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', ''[]'')', pg_temp.t293_id(99))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_reconcile_apply_v1(%L, ''reconcile'', %L::JSONB)', pg_temp.t293_id(1),
    (SELECT jsonb_agg(jsonb_build_object('uid', 'x' || g)) FROM generate_series(1, 101) g)::TEXT)) = '22023',
  'argument errors: an unknown mode, NULLs, an object instead of an array, an unknown organization, more than 100 rows');
-- Org 3's directory is now empty -> directory_empty (it has the projection flag ON).
SELECT pg_temp.t293_assert(pg_temp.t293_apply('reconcile', jsonb_build_array(
    pg_temp.t293_row('r-dir', 'in', 'success', '996555000111', 'u801', 'user', pg_temp.t293_iso(30), 5, 40)), 3)->>'status' = 'directory_empty'
  AND pg_temp.t293_call_rows() = 0,
  'an empty directory refuses with directory_empty and writes nothing');

-- 5b. New calls: the pull outcome and the answer rule.
SELECT pg_temp.t293_put('a1', pg_temp.t293_apply('reconcile', jsonb_build_array(
  -- incoming answered by u701, with a recording link; the client has an open lead
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 125,
    'https://records.example.invalid/t293-link-in-ans.mp3'),
  -- incoming missed by a group
  pg_temp.t293_row('r-in-grp', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(48), 15, 0, NULL, 'T293 Sales'),
  -- incoming that stopped at the greeting: success but nobody answered
  pg_temp.t293_row('r-in-hello', 'in', 'success', '996555009001', NULL, 'hello', pg_temp.t293_iso(46), 8, 12),
  -- incoming to the menu
  pg_temp.t293_row('r-in-ivr', 'in', 'Success', '996555009002', 'ivr', 'ivr', pg_temp.t293_iso(45), 8, 30),
  -- incoming success whose destination is not the employee
  pg_temp.t293_row('r-in-vm', 'in', 'success', '996555009003', NULL, 'vm', pg_temp.t293_iso(44), 8, 20),
  -- outgoing answered
  pg_temp.t293_row('r-out-ans', 'out', 'success', '996555000111', 'u702', NULL, pg_temp.t293_iso(40), 4, 300),
  -- outgoing without a conversation
  pg_temp.t293_row('r-out-no', 'out', 'noanswer', '996555009004', 'u702', NULL, pg_temp.t293_iso(38), 25, 0),
  -- outgoing success with zero talk time is not an answer
  pg_temp.t293_row('r-out-zero', 'out', 'success', '996555009005', 'u701', NULL, pg_temp.t293_iso(36), 3, 0),
  -- an unknown status asks for review
  pg_temp.t293_row('r-in-odd', 'in', 'strange', '996555009006', NULL, 'group', pg_temp.t293_iso(34), 3, 0),
  -- anonymous caller, the PBX user of the answer is not in the directory yet
  pg_temp.t293_row('r-in-anon', 'in', 'success', '', 'u999', 'user', pg_temp.t293_iso(32), 2, 15)
)));
SELECT pg_temp.t293_assert(pg_temp.t293_get('a1')->>'status' = 'ok' AND (pg_temp.t293_get('a1')->>'received')::INT = 10
  AND (pg_temp.t293_get('a1')->>'created')::INT = 10 AND (pg_temp.t293_get('a1')->>'failed')::INT = 0
  AND (pg_temp.t293_get('a1')->>'links_set')::INT = 1 AND pg_temp.t293_get('a1')->'error_codes' = '[]'::JSONB,
  'ten new calls are created, one link is set, nothing failed');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'pull' AND c.state = 'ended' AND c.direction = 'in'
      AND c.created_via = 'reconcile' AND c.settled_at IS NOT NULL AND c.answered_at IS NOT NULL AND c.ended_at IS NOT NULL
      AND c.talk_seconds = 125 AND c.wait_seconds = 6 AND c.pbx_destination = 'user' AND c.membership_id = pg_temp.t293_id(301)
      AND c.client_phone = '+996555000111' AND c.company_number = '996312000000' AND c.company_number_name = 'T293 Main number'
      AND c.match_state = 'matched' AND c.client_id = pg_temp.t293_id(701) AND c.lead_id = pg_temp.t293_id(702)
      AND c.recording_state = 'available' AND NOT c.needs_review AND c.webhook_total_seconds IS NULL
    FROM pg_temp.t293_call('r-in-ans') c),
  'an incoming call answered by an employee: pull outcome answered, settled, talk time, employee, client, lead, recording');
SELECT pg_temp.t293_assert((SELECT l.state = 'completed' AND l.status = 'success' AND l.leg_start_source = 'pull' AND l.talk_seconds = 125
      AND l.membership_id = pg_temp.t293_id(301) AND l.recording_state = 'available'
      AND l.recording_link = 'https://records.example.invalid/t293-link-in-ans.mp3' AND l.accepted_at IS NOT NULL
    FROM pg_temp.t293_leg('r-in-ans', 'u701') l)
  AND pg_temp.t293_legs('r-in-ans') = 1 AND pg_temp.t293_events('r-in-ans') = 1
  AND (SELECT e.source = 'pull' AND e.event_type = 'reconcile' AND e.pbx_event_id IS NULL
    FROM platform_private.telephony_call_events e JOIN platform_private.telephony_calls c ON c.id = e.call_id AND c.pbx_callid = 'r-in-ans'),
  'the leg is completed with the link; one pull chronology row, no webhook evidence reference');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'missed' AND c.outcome_source = 'pull' AND c.state = 'ended' AND c.membership_id IS NULL
      AND c.answered_at IS NULL AND c.pbx_destination = 'group' AND c.match_state = 'matched' AND c.client_id = pg_temp.t293_id(703)
      AND c.lead_id = pg_temp.t293_id(704) AND c.talk_seconds = 0 AND c.recording_state = 'none'
    FROM pg_temp.t293_call('r-in-grp') c)
  AND (SELECT l.state = 'missed' AND l.group_name = 'T293 Sales' AND l.recording_link IS NULL
    FROM pg_temp.t293_leg('r-in-grp', '') l),
  'a missed group call: missed (pull), no employee, a leg without a user carrying the group name');
SELECT pg_temp.t293_assert((SELECT bool_and(c.outcome = 'missed' AND c.membership_id IS NULL AND c.answered_at IS NULL)
    FROM platform_private.telephony_calls c WHERE c.pbx_callid IN ('r-in-hello', 'r-in-ivr', 'r-in-vm'))
  AND (SELECT c.pbx_destination FROM pg_temp.t293_call('r-in-hello') c) = 'hello'
  AND (SELECT l.pbx_user FROM pg_temp.t293_leg('r-in-ivr', 'ivr') l) = 'ivr'
  AND (SELECT c.match_state FROM pg_temp.t293_call('r-in-hello') c) = 'unmatched',
  'a greeting, a menu and a voicemail ending are missed even with status success and talk seconds');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.membership_id = pg_temp.t293_id(302) AND c.talk_seconds = 300
      AND c.direction = 'out' AND c.pbx_destination IS NULL
    FROM pg_temp.t293_call('r-out-ans') c)
  AND (SELECT c.outcome = 'no_answer_unknown' AND c.outcome_source = 'pull' AND c.membership_id IS NULL
    FROM pg_temp.t293_call('r-out-no') c)
  AND (SELECT c.outcome = 'no_answer_unknown' FROM pg_temp.t293_call('r-out-zero') c),
  'outgoing: answered needs success and talk time; otherwise no_answer_unknown (never busy, cancelled or the like)');
SELECT pg_temp.t293_assert((SELECT c.needs_review AND c.outcome = 'missed' FROM pg_temp.t293_call('r-in-odd') c)
  AND (SELECT NOT c.needs_review FROM pg_temp.t293_call('r-in-grp') c)
  AND (SELECT c.outcome = 'answered' AND c.client_phone IS NULL AND c.match_state = 'unmatched' AND c.membership_id IS NULL
    FROM pg_temp.t293_call('r-in-anon') c)
  AND (SELECT l.pbx_user = 'u999' AND l.state = 'completed' AND l.membership_id IS NULL FROM pg_temp.t293_leg('r-in-anon', 'u999') l),
  'an unknown status asks for review; an anonymous caller keeps no phone; an answering user missing from the directory has no employee');
-- Idempotency: the same batch again changes nothing.
SELECT pg_temp.t293_put('a1_rows', jsonb_build_object('n', pg_temp.t293_call_rows()));
SELECT pg_temp.t293_put('a2', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 125,
    'https://records.example.invalid/t293-link-in-ans.mp3'),
  pg_temp.t293_row('r-in-grp', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(48), 15, 0, NULL, 'T293 Sales'),
  pg_temp.t293_row('r-out-ans', 'out', 'success', '996555000111', 'u702', NULL, pg_temp.t293_iso(40), 4, 300))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a2')->>'unchanged')::INT = 3 AND (pg_temp.t293_get('a2')->>'created')::INT = 0
  AND (pg_temp.t293_get('a2')->>'updated')::INT = 0 AND (pg_temp.t293_get('a2')->>'links_set')::INT = 0
  AND pg_temp.t293_call_rows() = (pg_temp.t293_get('a1_rows')->>'n')::BIGINT,
  'applying the same rows again changes nothing (no row, leg or chronology is added)');
-- Invalid rows are counted and leave nothing.
SELECT pg_temp.t293_put('a3', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row(NULL, 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(20), 5, 40),
  pg_temp.t293_row('tmp:abc', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(20), 5, 40),
  pg_temp.t293_row('r-bad-type', 'sideways', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(20), 5, 40),
  pg_temp.t293_row('r-no-type', NULL, 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(20), 5, 40),
  pg_temp.t293_row('r-bad-start', 'in', 'success', '996555000111', 'u701', 'user', 'yesterday', 5, 40),
  pg_temp.t293_row('r-no-start', 'in', 'success', '996555000111', 'u701', 'user', NULL, 5, 40),
  pg_temp.t293_row('r-future', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(-3000), 5, 40),
  '42'::JSONB, '"text"'::JSONB, 'null'::JSONB, '[1]'::JSONB)));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a3')->>'invalid')::INT = 11 AND (pg_temp.t293_get('a3')->>'received')::INT = 11
  AND (pg_temp.t293_get('a3')->>'created')::INT = 0 AND pg_temp.t293_call_rows() = (pg_temp.t293_get('a1_rows')->>'n')::BIGINT,
  'rows without an id, a direction or a readable start, a future start and non-objects are counted invalid and leave nothing');

-- 5c. The link lives in the leg only; nothing leaks into answers or other tables.
SELECT pg_temp.t293_assert(pg_temp.t293_leak('t293-link-in-ans') = 'telephony_call_legs'
  AND position('t293-link' IN pg_temp.t293_get('a1')::TEXT) = 0 AND position('t293-link' IN pg_temp.t293_get('a2')::TEXT) = 0
  AND position('996555' IN pg_temp.t293_get('a1')::TEXT) = 0,
  'the recording link is stored in one table only (the leg) and neither it nor a phone appears in the answers');
SELECT pg_temp.t293_assert(pg_temp.t293_leak('996555000111') = 'telephony_calls',
  'the client phone appears only in the call row');

-- 5d. A link refresh: changes while the call is young; old calls are not revived.
SELECT pg_temp.t293_put('a4', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 125,
    'https://records.example.invalid/t293-link-in-ans-2.mp3'),
  pg_temp.t293_row('r-in-grp', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(48), 15, 0,
    'https://records.example.invalid/t293-link-late.mp3', 'T293 Sales'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a4')->>'links_set')::INT = 2 AND (pg_temp.t293_get('a4')->>'updated')::INT = 2
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-in-ans-2.mp3' AND l.recording_state = 'available'
    FROM pg_temp.t293_leg('r-in-ans', 'u701') l)
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-late.mp3' FROM pg_temp.t293_leg('r-in-grp', '') l)
  AND (SELECT c.recording_state = 'available' FROM pg_temp.t293_call('r-in-grp') c)
  AND pg_temp.t293_leak('t293-link-in-ans.mp3') = '' AND pg_temp.t293_leak('t293-link-late') = 'telephony_call_legs',
  'a changed link replaces the old one on a young call; a link that appears later is attached; the old link is gone');
-- A call older than 360 days: the link is not refreshed, and an expired leg is never revived.
SELECT pg_temp.t293_put('a5', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-old', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 365), 6, 90,
    'https://records.example.invalid/t293-link-old-1.mp3'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a5')->>'created')::INT = 1
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-old-1.mp3' FROM pg_temp.t293_leg('r-old', 'u701') l),
  'a first sighting stores the link whatever the age of the call');
SELECT pg_temp.t293_put('a6', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-old', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 365), 6, 90,
    'https://records.example.invalid/t293-link-old-2.mp3'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a6')->>'links_set')::INT = 0
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-old-1.mp3' FROM pg_temp.t293_leg('r-old', 'u701') l),
  'a call older than 360 days keeps its link (the reconciliation stops refreshing it)');
UPDATE platform_private.telephony_call_legs SET recording_state = 'expired', recording_link = NULL
  WHERE id = (SELECT (pg_temp.t293_leg('r-in-ans', 'u701')).id);
SELECT pg_temp.t293_put('a7', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 125,
    'https://records.example.invalid/t293-link-revived.mp3'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a7')->>'links_set')::INT = 0
  AND (SELECT l.recording_state = 'expired' AND l.recording_link IS NULL FROM pg_temp.t293_leg('r-in-ans', 'u701') l)
  AND pg_temp.t293_leak('t293-link-revived') = '',
  'an expired leg is not revived by a later link');
-- A link that is not https, too long or with spaces is ignored (the row still lands).
SELECT pg_temp.t293_put('a8', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-link-http', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(15), 6, 20, 'http://records.example.invalid/t293-plain.mp3'),
  pg_temp.t293_row('r-link-long', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(14), 6, 20,
    'https://records.example.invalid/' || repeat('a', 1100)),
  pg_temp.t293_row('r-link-space', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(13), 6, 20,
    'https://records.example.invalid/t293 space.mp3'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('a8')->>'created')::INT = 3 AND (pg_temp.t293_get('a8')->>'links_set')::INT = 0
  AND (SELECT bool_and(l.recording_link IS NULL AND l.recording_state = 'none')
    FROM platform_private.telephony_call_legs l JOIN platform_private.telephony_calls c ON c.id = l.call_id
    WHERE c.pbx_callid IN ('r-link-http', 'r-link-long', 'r-link-space')),
  'a link that is not https, is over 1024 characters or contains a space is ignored and the call is still created');

-- 5e. A webhook call is completed, its exact outcome is not overwritten.
SELECT pg_temp.t293_put('w1a', pg_temp.t293_e('INCOMING', 'w-ans', 'u701', '996555000111')),
  pg_temp.t293_put('w2a', pg_temp.t293_e('INCOMING', 'w-miss', 'u701', '996555000111')),
  pg_temp.t293_put('w3a', pg_temp.t293_e('INCOMING', 'w-ring', 'u701', '996555000222')),
  pg_temp.t293_put('w4a', pg_temp.t293_e('INCOMING', 'w-dup', 'u701', '996555000111'));
SELECT pg_temp.t293_put('w1b', pg_temp.t293_e('ACCEPTED', 'w-ans', 'u701', '996555000111')),
  pg_temp.t293_put('w1c', pg_temp.t293_h('w-ans', 'u701', '996555000111', 'in', 'Success', pg_temp.t293_wh(25), 140, 7)),
  pg_temp.t293_put('w2b', pg_temp.t293_h('w-miss', 'u701', '996555000111', 'in', 'missed', pg_temp.t293_wh(24), 20, 20)),
  pg_temp.t293_put('w4b', pg_temp.t293_h('w-dup', 'u701', '996555000111', 'in', 'Success', pg_temp.t293_wh(10), 30, 4));
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'webhook' AND c.talk_seconds IS NULL
      AND c.created_via = 'webhook' AND c.pbx_destination IS NULL
    FROM pg_temp.t293_call('w-ans') c)
  AND (SELECT c.outcome = 'missed' AND c.outcome_source = 'webhook' FROM pg_temp.t293_call('w-miss') c)
  AND (SELECT c.outcome IS NULL AND c.state = 'ringing' FROM pg_temp.t293_call('w-ring') c),
  'precondition: the webhook gave an exact answered call, an exact missed call and a call still ringing');
SELECT pg_temp.t293_put('b1', pg_temp.t293_apply('reconcile', jsonb_build_array(
  -- completes the answered call: talk time, wait, destination, a link
  pg_temp.t293_row('w-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(25), 7, 118,
    'https://records.example.invalid/t293-link-w-ans.mp3'),
  -- tries to say "missed" for a call the webhook answered: ignored, only completed
  pg_temp.t293_row('w-miss', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(24), 20, 33),
  -- closes the call that is still ringing
  pg_temp.t293_row('w-ring', 'in', 'missed', '996555000222', NULL, 'offtime', pg_temp.t293_iso(23), 4, 0))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('b1')->>'created')::INT = 0 AND (pg_temp.t293_get('b1')->>'updated')::INT = 3
  AND (pg_temp.t293_get('b1')->>'links_set')::INT = 1 AND (pg_temp.t293_get('b1')->>'failed')::INT = 0,
  'three existing calls are updated, none is created, one link is attached');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'webhook' AND c.talk_seconds = 118
      AND c.pbx_destination = 'user' AND c.wait_seconds = 7 AND c.recording_state = 'available' AND c.created_via = 'webhook'
      AND c.membership_id = pg_temp.t293_id(301)
    FROM pg_temp.t293_call('w-ans') c)
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-w-ans.mp3' AND l.talk_seconds = 118
    FROM pg_temp.t293_leg('w-ans', 'u701') l)
  AND pg_temp.t293_legs('w-ans') = 1 AND pg_temp.t293_leak('t293-link-w-ans') = 'telephony_call_legs',
  'the exact webhook answer stays (source webhook) and is completed with the talk time, the destination and the link');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'pull' AND c.membership_id = pg_temp.t293_id(301)
      AND c.talk_seconds = 33 AND c.state = 'ended'
    FROM pg_temp.t293_call('w-miss') c)
  AND (SELECT l.state = 'completed' FROM pg_temp.t293_leg('w-miss', 'u701') l),
  'only the reconciliation can promote an exact missed call to answered (the source becomes pull)');
SELECT pg_temp.t293_assert((SELECT c.outcome = 'missed' AND c.outcome_source = 'pull' AND c.state = 'ended'
      AND c.settled_at IS NOT NULL AND c.pbx_destination = 'offtime' AND c.ended_at IS NOT NULL
    FROM pg_temp.t293_call('w-ring') c)
  AND (SELECT bool_and(l.state = 'missed') FROM platform_private.telephony_call_legs l
    JOIN platform_private.telephony_calls c ON c.id = l.call_id AND c.pbx_callid = 'w-ring'),
  'a call still ringing is closed by the reconciliation: its open leg ends missed and the call is settled (pull)');
-- The reverse: the PBX says "missed" for a call the webhook answered. Nothing downgrades.
SELECT pg_temp.t293_put('b2', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('w-ans', 'in', 'missed', '996555000111', NULL, 'group', pg_temp.t293_iso(25), 7, 0, NULL, 'T293 Sales'))));
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'webhook' AND c.talk_seconds = 118 AND c.membership_id = pg_temp.t293_id(301)
    FROM pg_temp.t293_call('w-ans') c)
  AND (SELECT l.state = 'completed' FROM pg_temp.t293_leg('w-ans', 'u701') l),
  'an answer is irreversible: a later "missed" from the PBX changes nothing');
-- A pull call: missed first, answered later; an answered pull call is never downgraded.
SELECT pg_temp.t293_put('b3', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-grp', 'in', 'success', '996555000222', 'u702', 'user', pg_temp.t293_iso(48), 15, 61))));
SELECT pg_temp.t293_assert((SELECT c.outcome = 'answered' AND c.outcome_source = 'pull' AND c.membership_id = pg_temp.t293_id(302)
      AND c.talk_seconds = 61 AND c.answered_at IS NOT NULL
    FROM pg_temp.t293_call('r-in-grp') c)
  AND pg_temp.t293_legs('r-in-grp') = 2
  AND (SELECT l.state = 'completed' AND l.talk_seconds = 61 FROM pg_temp.t293_leg('r-in-grp', 'u702') l),
  'a pull-created missed call is promoted to answered when the PBX later names the answering employee');
SELECT pg_temp.t293_put('b4b', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-grp', 'in', 'success', '996555000222', 'u702', 'user', pg_temp.t293_iso(48), 15, 61))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('b4b')->>'unchanged')::INT = 1 AND pg_temp.t293_legs('r-in-grp') = 2,
  'the row that made the call answered, applied again, changes nothing');
SELECT pg_temp.t293_put('b4', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-grp', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(48), 15, 0, NULL, 'T293 Sales'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('b4')->>'created')::INT = 0
  AND (SELECT c.outcome = 'answered' AND c.talk_seconds = 61 AND c.membership_id = pg_temp.t293_id(302)
    FROM pg_temp.t293_call('r-in-grp') c) AND pg_temp.t293_legs('r-in-grp') = 2,
  'an answered pull call is not downgraded by a later "missed" and gets no extra leg');
-- A possible duplicate (a webhook call at about the same minute with another id).
SELECT pg_temp.t293_put('b5', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-dup-uid', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(10), 4, 28))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('b5')->>'created')::INT = 1 AND (pg_temp.t293_get('b5')->>'suspected_duplicates')::INT = 1
  AND (SELECT c.needs_review FROM pg_temp.t293_call('r-dup-uid') c)
  AND (SELECT NOT c.needs_review FROM pg_temp.t293_call('w-dup') c),
  'a row that may be the webhook call under another id is created but flagged for review and counted');

-- 5f. Matching: an ambiguous number is not attached.
SELECT pg_temp.t293_put('c1', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-amb', 'in', 'missed', '996555000555', NULL, 'group', pg_temp.t293_iso(9), 4, 0))));
SELECT pg_temp.t293_assert((SELECT c.match_state = 'ambiguous' AND c.client_id IS NULL AND c.lead_id IS NULL FROM pg_temp.t293_call('r-amb') c),
  'a number shared by two clients stays ambiguous, with no client or lead attached');
SELECT pg_temp.t293_assert((SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.t293_id(1)) = 4
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.t293_id(1)) = 2,
  'the reconciliation creates no client and no lead');

-- 5g. The import (backfill): own flag, matched numbers only, link kept.
UPDATE platform_private.telephony_settings SET backfill_enabled = TRUE WHERE organization_id = pg_temp.t293_id(1);
SELECT pg_temp.t293_put('d_before', jsonb_build_object('calls', (SELECT count(*) FROM platform_private.telephony_calls),
  'legs', (SELECT count(*) FROM platform_private.telephony_call_legs),
  'clients', (SELECT count(*) FROM platform.clients), 'leads', (SELECT count(*) FROM platform.leads)));
SELECT pg_temp.t293_put('d1', pg_temp.t293_apply('backfill', jsonb_build_array(
  pg_temp.t293_row('bf-known-in', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 40), 6, 77,
    'https://records.example.invalid/t293-link-bf-1.mp3'),
  pg_temp.t293_row('bf-known-miss', 'in', 'missed', '+996 555 000 222', NULL, 'group', pg_temp.t293_iso(60 * 24 * 41), 6, 0),
  pg_temp.t293_row('bf-unknown', 'in', 'success', '996555008888', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 42), 6, 50,
    'https://records.example.invalid/t293-link-bf-unknown.mp3'),
  pg_temp.t293_row('bf-ambiguous', 'in', 'success', '996555000555', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 43), 6, 50,
    'https://records.example.invalid/t293-link-bf-amb.mp3'),
  pg_temp.t293_row('bf-anon', 'in', 'success', '', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 44), 6, 50,
    'https://records.example.invalid/t293-link-bf-anon.mp3'),
  pg_temp.t293_row('bf-out-known', 'out', 'success', '0555000222', 'u702', NULL, pg_temp.t293_iso(60 * 24 * 45), 6, 12))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('d1')->>'mode') = 'backfill' AND (pg_temp.t293_get('d1')->>'created')::INT = 3
  AND (pg_temp.t293_get('d1')->>'dropped')::INT = 3 AND (pg_temp.t293_get('d1')->>'links_set')::INT = 1,
  'the import creates the three calls of known clients and drops the unknown, ambiguous and anonymous ones');
SELECT pg_temp.t293_assert((SELECT c.created_via = 'backfill' AND c.outcome_source = 'pull' AND c.match_state = 'matched'
      AND c.client_id = pg_temp.t293_id(701) AND c.recording_state = 'available' AND c.outcome = 'answered'
    FROM pg_temp.t293_call('bf-known-in') c)
  AND (SELECT l.recording_link = 'https://records.example.invalid/t293-link-bf-1.mp3' FROM pg_temp.t293_leg('bf-known-in', 'u701') l)
  AND (SELECT c.created_via = 'backfill' AND c.client_id = pg_temp.t293_id(703) FROM pg_temp.t293_call('bf-out-known') c)
  AND (SELECT e.event_type = 'backfill' FROM platform_private.telephony_call_events e
    JOIN platform_private.telephony_calls c ON c.id = e.call_id AND c.pbx_callid = 'bf-known-in'),
  'an imported call is marked backfill with the pull outcome, the client and the link; its chronology row says backfill');
SELECT pg_temp.t293_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls
      WHERE pbx_callid IN ('bf-unknown', 'bf-ambiguous', 'bf-anon'))
  AND pg_temp.t293_leak('t293-link-bf-unknown') = '' AND pg_temp.t293_leak('t293-link-bf-amb') = ''
  AND pg_temp.t293_leak('t293-link-bf-anon') = '' AND pg_temp.t293_leak('996555008888') = '',
  'dropped rows leave no call, no leg, no link and no phone anywhere');
SELECT pg_temp.t293_assert((SELECT count(*) FROM platform.clients) = (pg_temp.t293_get('d_before')->>'clients')::BIGINT
  AND (SELECT count(*) FROM platform.leads) = (pg_temp.t293_get('d_before')->>'leads')::BIGINT
  AND (SELECT count(*) FROM platform_private.telephony_calls) = (pg_temp.t293_get('d_before')->>'calls')::BIGINT + 3,
  'the import creates no client, no lead and no other call');
-- An existing call is enriched by the import even when its number is unknown.
SELECT pg_temp.t293_put('d2', pg_temp.t293_apply('backfill', jsonb_build_array(
  pg_temp.t293_row('r-in-anon', 'in', 'success', '', 'u999', 'user', pg_temp.t293_iso(32), 2, 15),
  pg_temp.t293_row('bf-known-in', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(60 * 24 * 40), 6, 77,
    'https://records.example.invalid/t293-link-bf-1.mp3'))));
SELECT pg_temp.t293_assert((pg_temp.t293_get('d2')->>'dropped')::INT = 0 AND (pg_temp.t293_get('d2')->>'unchanged')::INT = 2,
  'the import applies to calls that already exist (nothing dropped) and a repeat changes nothing');

-- 5h. A failing row costs only itself and leaves a coded error, not a value.
CREATE FUNCTION pg_temp.t293_poison() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.group_name = 'T293 POISON' THEN
    RAISE EXCEPTION 'poison for the test: 996555007777 and https://records.example.invalid/t293-poison-text.mp3'
      USING ERRCODE = '23514', CONSTRAINT = 't293_poison_constraint';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER t293_poison BEFORE INSERT ON platform_private.telephony_call_legs
  FOR EACH ROW EXECUTE FUNCTION pg_temp.t293_poison();
SELECT pg_temp.t293_put('f1', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('f-ok-1', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(8), 4, 0, NULL, 'T293 Sales'),
  pg_temp.t293_row('f-bad', 'in', 'missed', '996555007777', NULL, 'group', pg_temp.t293_iso(7), 4, 0,
    'https://records.example.invalid/t293-poison-link.mp3', 'T293 POISON'),
  pg_temp.t293_row('f-ok-2', 'in', 'missed', '996555000222', NULL, 'group', pg_temp.t293_iso(6), 4, 0, NULL, 'T293 Sales'))));
DROP TRIGGER t293_poison ON platform_private.telephony_call_legs;
SELECT pg_temp.t293_assert((pg_temp.t293_get('f1')->>'created')::INT = 2 AND (pg_temp.t293_get('f1')->>'failed')::INT = 1
  AND pg_temp.t293_get('f1')->'error_codes' = '["e23514_t293_poison_constraint"]'::JSONB
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid IN ('f-ok-1', 'f-ok-2')) = 2
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_calls WHERE pbx_callid = 'f-bad')
  AND position('996555007777' IN pg_temp.t293_get('f1')::TEXT) = 0 AND position('t293-poison' IN pg_temp.t293_get('f1')::TEXT) = 0
  AND pg_temp.t293_leak('t293-poison') = '' AND pg_temp.t293_leak('996555007777') = '',
  'a row that fails rolls back alone: its neighbours land, the answer carries only a coded error, and no value or link survives');

-- 5i. Organizations are isolated (the same PBX id in organization 2).
SELECT pg_temp.t293_put('g1', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 31,
    'https://records.example.invalid/t293-link-org2.mp3')), 2));
SELECT pg_temp.t293_assert((pg_temp.t293_get('g1')->>'status') = 'disabled',
  'organization 2 has no settings row: the apply is off there');
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled) VALUES (pg_temp.t293_id(2), TRUE);
SELECT pg_temp.t293_put('g2', pg_temp.t293_apply('reconcile', jsonb_build_array(
  pg_temp.t293_row('r-in-ans', 'in', 'success', '996555000111', 'u701', 'user', pg_temp.t293_iso(50), 6, 31,
    'https://records.example.invalid/t293-link-org2.mp3')), 2));
SELECT pg_temp.t293_assert((pg_temp.t293_get('g2')->>'created')::INT = 1
  AND (SELECT c.talk_seconds = 31 AND c.membership_id = pg_temp.t293_id(305) AND c.client_id = pg_temp.t293_id(710)
    FROM pg_temp.t293_call('r-in-ans', 2) c)
  AND (SELECT c.talk_seconds = 125 AND c.membership_id = pg_temp.t293_id(301) FROM pg_temp.t293_call('r-in-ans', 1) c),
  'the same PBX id is a separate call in another organization; the first one is untouched');

-- ---------------------------------------------------------------------------
-- 6. The run mark.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t293_put('k_tick', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'tick'));
SELECT pg_temp.t293_assert(pg_temp.t293_get('k_tick')->>'status' = 'ok'
  AND (SELECT retry_run_at IS NOT NULL AND settle_run_at IS NOT NULL AND reconcile_cursor_at IS NULL AND last_pbx_ok_at IS NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'a tick creates the state row and stamps only the retry and settle times');
SELECT pg_temp.t293_put('k_users', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'users_ok', NULL, NULL,
  '{"users":5,"inserted":2,"deactivated":0,"conflicts":0,"secret_count":9,"rows":"x"}'::JSONB)),
  pg_temp.t293_put('k_probe', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'probe_ok', NULL, NULL, NULL,
    '{"timezone_name":"Asia/Bishkek","timezone_offset_minutes":360,"users_used":5,"users_total":5,"groups_total":2,"record_service":true,"record_external":true,"record_inner":true,"record_exceptions":1,"login":"u701","link":"https://x.example.invalid"}'::JSONB));
SELECT pg_temp.t293_assert((SELECT users_sync_run_at IS NOT NULL AND users_sync_success_at IS NOT NULL AND probe_run_at IS NOT NULL
      AND probe_success_at IS NOT NULL AND last_pbx_ok_at IS NOT NULL AND last_pbx_error_at IS NULL
      AND mode_summaries = '{"users": {"users": 5, "inserted": 2, "deactivated": 0, "conflicts": 0}}'::JSONB
      AND pbx_facts = '{"timezone_name":"Asia/Bishkek","timezone_offset_minutes":360,"users_used":5,"users_total":5,"groups_total":2,"record_service":true,"record_external":true,"record_inner":true,"record_exceptions":1}'::JSONB
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'ok marks stamp the times; unknown counters, text counters, a login and a link are dropped; the facts keep only the closed names');
SELECT pg_temp.t293_put('k_rec1', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'reconcile_ok', clock_timestamp() - INTERVAL '30 minutes',
  NULL, '{"rows":10,"created":2,"updated":1,"unchanged":7}'::JSONB));
SELECT pg_temp.t293_put('k_cur1', jsonb_build_object('at', (SELECT reconcile_cursor_at FROM platform_private.telephony_runtime_state
  WHERE organization_id = pg_temp.t293_id(1))));
SELECT pg_temp.t293_put('k_rec2', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'reconcile_ok', clock_timestamp() - INTERVAL '90 minutes',
  NULL, '{"rows":4}'::JSONB));
SELECT pg_temp.t293_assert((SELECT reconcile_cursor_at = (pg_temp.t293_get('k_cur1')->>'at')::TIMESTAMPTZ AND reconcile_success_at IS NOT NULL
      AND reconcile_run_at IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'the reconcile cursor only moves forward (an older value is ignored)');
SELECT pg_temp.t293_put('k_rec3', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'reconcile_ok', clock_timestamp() - INTERVAL '5 minutes',
  NULL, '{"rows":1}'::JSONB));
SELECT pg_temp.t293_assert((SELECT reconcile_cursor_at > (pg_temp.t293_get('k_cur1')->>'at')::TIMESTAMPTZ
      AND mode_summaries->'reconcile' = '{"rows": 1}'::JSONB AND mode_summaries ? 'users'
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'a newer cursor advances it; a mode keeps only its last counters and the other modes are not touched');
SELECT pg_temp.t293_put('k_cursor_e', jsonb_build_object('at', (SELECT reconcile_cursor_at FROM platform_private.telephony_runtime_state
  WHERE organization_id = pg_temp.t293_id(1))));
SELECT pg_temp.t293_put('k_err', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'reconcile_error', clock_timestamp() + INTERVAL '30 minutes',
  'pbx_invalid_token', '{"rows":99}'::JSONB));
SELECT pg_temp.t293_assert((SELECT last_pbx_error_at IS NOT NULL AND last_pbx_error_code = 'pbx_invalid_token'
      AND reconcile_cursor_at = (pg_temp.t293_get('k_cursor_e')->>'at')::TIMESTAMPTZ
      AND mode_summaries->'reconcile' = '{"rows": 1}'::JSONB AND reconcile_run_at IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'an error mark stores the coded error and moves neither a cursor nor the counters');
SELECT pg_temp.t293_put('k_err2', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'users_error', NULL, 'Not A Code; DROP'));
SELECT pg_temp.t293_assert((SELECT last_pbx_error_code = 'unknown_error' FROM platform_private.telephony_runtime_state
    WHERE organization_id = pg_temp.t293_id(1)),
  'an error code of the wrong shape becomes unknown_error (nothing free-form is stored)');
SELECT pg_temp.t293_put('k_ok2', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'probe_ok'));
SELECT pg_temp.t293_assert((SELECT last_pbx_ok_at >= last_pbx_error_at AND last_pbx_error_code IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'a later ok does not erase the last error (the screen compares the two times)');
SELECT pg_temp.t293_put('k_bf1', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'backfill_ok', clock_timestamp() - INTERVAL '10 days',
  NULL, '{"rows":2}'::JSONB)),
  pg_temp.t293_put('k_bf2', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'backfill_ok', clock_timestamp() - INTERVAL '5 days'));
SELECT pg_temp.t293_assert((SELECT backfill_cursor_at < now() - INTERVAL '9 days' AND backfill_done_at IS NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'the import cursor only moves backward (a later value is ignored)');
SELECT pg_temp.t293_put('k_bf3', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'backfill_ok', '2024-01-01 00:00:00+00'));
SELECT pg_temp.t293_assert((SELECT backfill_cursor_at = TIMESTAMPTZ '2025-10-21 18:00:00+00' AND backfill_done_at IS NOT NULL
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'a cursor past the floor is held at 22.10.2025 00:00 Bishkek and ends the import');
SELECT pg_temp.t293_put('k_daily', platform.telephony_runtime_mark_v1(pg_temp.t293_id(1), 'daily_ok', NULL, NULL, '{"rows":7}'::JSONB));
SELECT pg_temp.t293_assert((SELECT reconcile_daily_run_at IS NOT NULL AND reconcile_daily_success_at IS NOT NULL
      AND mode_summaries->'daily' = '{"rows": 7}'::JSONB
    FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t293_id(1)),
  'a daily mark stamps its own times and counters');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state(format('SELECT platform.telephony_runtime_mark_v1(%L, ''sideways'')', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_runtime_mark_v1(%L, NULL)', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state('SELECT platform.telephony_runtime_mark_v1(NULL, ''tick'')') = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_runtime_mark_v1(%L, ''tick'')', pg_temp.t293_id(99))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_runtime_mark_v1(%L, ''reconcile_ok'', clock_timestamp() + INTERVAL ''3 hours'')', pg_temp.t293_id(1))) = '22023'
  AND pg_temp.t293_state(format('SELECT platform.telephony_runtime_mark_v1(%L, ''reconcile_ok'', TIMESTAMPTZ ''2010-01-01 00:00:00+00'')', pg_temp.t293_id(1))) = '22023',
  'an unknown event, NULLs, an unknown organization, a cursor in the future or before 2020 are refused');

-- ---------------------------------------------------------------------------
-- 7. The health data.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t293_put('h1', platform.telephony_integration_health_v1(pg_temp.t293_id(1)));
SELECT pg_temp.t293_assert(pg_temp.t293_get('h1')->>'status' = 'ok'
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.t293_get('h1')) k)
    = ARRAY['automation_stop', 'directory', 'divergence', 'evidence', 'flags', 'internal_calls_total', 'last_event_at', 'now',
      'pbx', 'schedule', 'status', 'summaries', 'work'],
  'the health answer has the agreed top-level keys');
SELECT pg_temp.t293_assert((pg_temp.t293_get('h1')->'flags'->>'projection_enabled')::BOOLEAN
  AND (pg_temp.t293_get('h1')->'flags'->>'backfill_enabled')::BOOLEAN AND NOT (pg_temp.t293_get('h1')->'flags'->>'outbound_paused')::BOOLEAN
  AND (pg_temp.t293_get('h1')->'directory'->>'active')::INT = 3 AND (pg_temp.t293_get('h1')->'directory'->>'unmapped')::INT = 1
  AND (pg_temp.t293_get('h1')->'directory'->>'inactive')::INT = 0
  AND pg_temp.t293_get('h1')->'pbx'->>'last_error_code' = 'unknown_error'
  AND (pg_temp.t293_get('h1')->'pbx'->'facts'->>'users_used')::INT = 5
  AND pg_temp.t293_get('h1')->'schedule'->>'backfill_done_at' IS NOT NULL
  AND (pg_temp.t293_get('h1')->'schedule'->>'reconcile_lag_seconds')::BIGINT BETWEEN 0 AND 3600,
  'flags, directory counts (active, unmapped), the last coded error, the facts and the schedule are reported');
SELECT pg_temp.t293_assert((pg_temp.t293_get('h1')->'divergence'->>'window_hours')::INT = 24
  AND (pg_temp.t293_get('h1')->'divergence'->>'reconciled_calls')::INT
    = (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t293_id(1) AND created_via = 'reconcile'
        AND started_at >= clock_timestamp() - INTERVAL '24 hours')
  AND (pg_temp.t293_get('h1')->'divergence'->>'calls')::INT
    = (SELECT count(*) FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t293_id(1)
        AND created_via IN ('webhook', 'reconcile', 'dial') AND started_at >= clock_timestamp() - INTERVAL '24 hours')
  AND (pg_temp.t293_get('h1')->'divergence'->>'reconciled_calls')::INT > 0
  AND (pg_temp.t293_get('h1')->'divergence'->>'calls')::INT > (pg_temp.t293_get('h1')->'divergence'->>'reconciled_calls')::INT,
  'the divergence counts calls that only the reconciliation brought, against all calls of the last 24 hours (imports excluded)');
-- Leak checks below look for a whole phone number (996 and nine more digits, every number of this suite, written with or
-- without spaces, brackets, plus and hyphens), not for the
-- bare substring '996': the health answer carries a dozen timestamps with random microseconds, so '996' appeared in them
-- by chance in a few runs out of a hundred and failed the required Migration boundary check at random (18.10.2026).
-- Evidence of the last 24 hours: all, rejected after the key check, incomplete; and the automation stop.
SELECT pg_temp.t293_assert(pg_temp.t293_get('h1')->'evidence'->>'window_hours' = '24'
  AND (pg_temp.t293_get('h1')->'evidence'->>'received')::INT
    = (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE organization_id = pg_temp.t293_id(1))
  AND (pg_temp.t293_get('h1')->'evidence'->>'received')::INT >= 3
  AND (pg_temp.t293_get('h1')->'evidence'->>'rejected')::INT = 0
  AND (pg_temp.t293_get('h1')->'evidence'->>'incomplete')::INT = 0
  AND pg_temp.t293_get('h1')->'automation_stop' = '{"code": null, "stopped_at": null}'::JSONB,
  'the health answer counts the evidence of the last 24 hours (all, rejected, incomplete) and reports no automation stop');
SELECT pg_temp.t293_put('h_ev1', platform.telephony_receive_v1(pg_temp.t293_id(1), gen_random_uuid(), 'event', 'current', pg_temp.t293_hex(),
    '{"cmd":"event","type":"INCOMING","callid":"h-ev-1"}'::JSONB, NULL, NULL)),
  pg_temp.t293_put('h_ev2', platform.telephony_receive_v1(pg_temp.t293_id(1), gen_random_uuid(), 'event', 'current', pg_temp.t293_hex(),
    '{"cmd":"event","type":"INCOMING","callid":"h-ev-2","user":"u701","phone":"996555000111","direction":"in","groupRealName":"https://x.example.invalid/a.mp3"}'::JSONB, NULL, NULL));
UPDATE platform_private.telephony_runtime_state SET automation_stopped_at = clock_timestamp(), automation_stop_code = 'leads_hour'
  WHERE organization_id = pg_temp.t293_id(1);
SELECT pg_temp.t293_put('h2', platform.telephony_integration_health_v1(pg_temp.t293_id(1)));
SELECT pg_temp.t293_assert(pg_temp.t293_get('h_ev1')->>'validation_state' = 'incomplete' AND pg_temp.t293_get('h_ev2')->>'status' = 'rejected'
  AND (pg_temp.t293_get('h2')->'evidence'->>'incomplete')::INT = 1 AND (pg_temp.t293_get('h2')->'evidence'->>'rejected')::INT = 1
  AND (pg_temp.t293_get('h2')->'evidence'->>'received')::INT = (pg_temp.t293_get('h1')->'evidence'->>'received')::INT + 2
  AND pg_temp.t293_get('h2')->'automation_stop'->>'code' = 'leads_hour' AND pg_temp.t293_get('h2')->'automation_stop'->>'stopped_at' IS NOT NULL
  AND position('x.example.invalid' IN pg_temp.t293_get('h2')::TEXT) = 0 AND regexp_replace(pg_temp.t293_get('h2')::TEXT, '[ ()+-]', '', 'g') !~ '996[0-9]{9}',
  'rejected and incomplete messages and the automation stop show up as counts and a code, never as values');
SELECT pg_temp.t293_assert(pg_temp.t293_get('h2')->'work' = (SELECT COALESCE(jsonb_object_agg(w.state, w.n), '{}'::JSONB)
    FROM (SELECT state, count(*) AS n FROM platform_private.telephony_event_work WHERE organization_id = pg_temp.t293_id(1) GROUP BY state) w),
  'the queue is reported as counts by state');
SELECT pg_temp.t293_assert(regexp_replace(pg_temp.t293_get('h2')::TEXT, '[ ()+-]', '', 'g') !~ '996[0-9]{9}' AND position('https' IN pg_temp.t293_get('h2')::TEXT) = 0
  AND position('u701' IN pg_temp.t293_get('h2')::TEXT) = 0 AND position('t293' IN pg_temp.t293_get('h2')::TEXT) = 0
  AND position('@' IN pg_temp.t293_get('h2')::TEXT) = 0,
  'the health answer holds no phone, login, link, name or e-mail');
SELECT pg_temp.t293_put('h0', platform.telephony_integration_health_v1(pg_temp.t293_id(2)));
SELECT pg_temp.t293_put('h99', platform.telephony_integration_health_v1(pg_temp.t293_id(3)));
SELECT pg_temp.t293_assert(NOT (pg_temp.t293_get('h0')->'flags'->>'backfill_enabled')::BOOLEAN
  AND (pg_temp.t293_get('h0')->'directory'->>'active')::INT = 1 AND pg_temp.t293_get('h0')->'pbx'->>'last_ok_at' IS NULL
  AND pg_temp.t293_get('h0')->'schedule'->>'reconcile_cursor_at' IS NULL AND pg_temp.t293_get('h0')->'schedule'->>'reconcile_lag_seconds' IS NULL
  AND (pg_temp.t293_get('h99')->'directory'->>'active')::INT = 0 AND (pg_temp.t293_get('h99')->'directory'->>'inactive')::INT = 5,
  'an organization with no run yet reports empty times; a deactivated directory is counted as inactive');
SELECT pg_temp.t293_assert(
  pg_temp.t293_state(format('SELECT platform.telephony_integration_health_v1(%L)', pg_temp.t293_id(99))) = '22023'
  AND pg_temp.t293_state('SELECT platform.telephony_integration_health_v1(NULL)') = '22023',
  'the health read refuses an unknown or NULL organization');

\echo T293_TELEPHONY_RECONCILE_SUITE_PASSED
ROLLBACK;
