\set ON_ERROR_STOP on
-- Boundary suite for migration 289 «Телефония Beeline KG» срез T1b (приём,
-- проекция, ноги, окно успокоения, очередь, сопоставление телефона;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §5.1, §5.2, §6.1, §6.2; ADR 0033).
-- Runs on the real chain right after 289 inside one transaction that is rolled
-- back, with its own synthetic organizations, members, clients, leads, PBX users
-- and messages: no provider, no real person, no real phone, no recording, no
-- production action. The public functions are called through the same
-- request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. catalog and grants: exactly four platform.telephony_*_v1 functions, SECURITY
--     DEFINER, empty search_path, EXECUTE only for service_role; every
--     platform_private.telephony_* helper closed to PUBLIC and the five client
--     roles; anon, authenticated, supabase_auth_admin, the AI agent role and a
--     service_role without the service claim are refused with 42501; the real
--     service_role path works;
--  2. the flag: without a settings row, and with projection_enabled = false,
--     intake stores evidence and queued work only (no call, leg or chronology
--     row) and claim, project and settle refuse without a change; once the flag
--     opens the stored backlog projects;
--  3. evidence: validation ok / incomplete with the missing names (callid, user,
--     phone, type, direction, over-long callid), the 19-field white list (token,
--     link and unknown keys are dropped), control characters and over-long
--     values, case-insensitive cmd, slots, argument errors, request replay;
--  4. idempotency: a repeated message is 'deduplicated' (one evidence row, one
--     work row, one chronology row); the same callid with another user, status
--     or start is kept; the key is per organization;
--  5. the fields lock (23514): a legitimate link-like value yields exactly one
--     'rejected' evidence row with the form (names and lengths, never values,
--     foreign names invalid_name_N), cmd bad_<cmd>, no work, no call, an
--     ordinary answer and no value anywhere; unknown commands keep only their
--     form;
--  6. legs and calls (rules 1–8): answered by an employee, history after events,
--     events out of order, no duplicate leg on replay, group call with CANCELLED
--     legs, greeting-only and group-name 'Success' are not answered, employee
--     'Success' with zero seconds is not answered, an outgoing ACCEPTED is not an
--     answer, answer irreversible, outcome precedence, two legs of one user,
--     the key transition of a leg (event time -> history start), incomplete
--     messages flag needs_review (and diversion/duration/wait do not), temporary
--     call key, internal calls (no row, counter), second_callid links and the
--     chain answers as one contact, cross-organization isolation;
--  7. the recording link lives only in the leg (and not in evidence, work,
--     chronology, calls, errors or answers);
--  8. phone matching: spellings, one client, newest open lead, closed lead,
--     ambiguous, inactive and other-organization clients, re-match while
--     unsettled and freeze after settling;
--  9. queue: a projection failure keeps evidence, leg and link and moves the
--     work to retry_wait with a coded error (no message, no value); backoff,
--     lease, expiry, lease loss, dead letter; the writer's error capture for a
--     NOT NULL, CHECK and UNIQUE violation inside the leg writer with a link and
--     a phone in play (PLAN_CHANGES T1a, point 13);
-- 10. the quiet window: nothing settles before 90 s; a determined outcome
--     settles; a silent incoming call is missed; an answered call settles with
--     open legs; a silent outgoing call waits and after an hour is flagged.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo T289_TELEPHONY_INGEST_SUITE_START

CREATE FUNCTION pg_temp.t289_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t289_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T289: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.t289_state(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t289_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.t289_hex() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT encode(sha256(gen_random_uuid()::TEXT::BYTEA), 'hex')
$$;

CREATE TEMP TABLE t289_tables(name TEXT);
INSERT INTO t289_tables VALUES ('telephony_settings'), ('telephony_runtime_state'), ('telephony_extensions'),
  ('telephony_pbx_events'), ('telephony_event_work'), ('telephony_dial_requests'), ('telephony_calls'),
  ('telephony_call_legs'), ('telephony_call_events'), ('telephony_recording_grants'), ('telephony_task_links');
-- Which tables hold a needle anywhere in any column ('' = none).
CREATE FUNCTION pg_temp.t289_leak(p_needle TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; found TEXT := '';
BEGIN
  FOR t IN SELECT name FROM t289_tables ORDER BY name LOOP
    EXECUTE format('SELECT count(*) FROM platform_private.%I x WHERE to_jsonb(x)::TEXT LIKE %L', t, '%' || p_needle || '%') INTO n;
    IF n > 0 THEN found := found || t || ' '; END IF;
  END LOOP;
  RETURN btrim(found);
END
$$;

-- Message builders. Missing parts are NULL and omitted from the request.
CREATE FUNCTION pg_temp.t289_recv(p_cmd TEXT, p_fields JSONB, p_link TEXT DEFAULT NULL, p_org INTEGER DEFAULT 1,
  p_slot TEXT DEFAULT 'current') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_receive_v1(pg_temp.t289_id(p_org), gen_random_uuid(), p_cmd, p_slot, pg_temp.t289_hex(),
    jsonb_strip_nulls(p_fields), p_link, NULL)
$$;
CREATE FUNCTION pg_temp.t289_e(p_type TEXT, p_callid TEXT, p_user TEXT, p_phone TEXT, p_dir TEXT DEFAULT 'in',
  p_extra JSONB DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t289_recv('event', jsonb_build_object('cmd', 'event', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'direction', p_dir) || p_extra, NULL, p_org)
$$;
CREATE FUNCTION pg_temp.t289_h(p_callid TEXT, p_user TEXT, p_phone TEXT, p_type TEXT, p_status TEXT, p_start TEXT,
  p_dur INTEGER, p_wait INTEGER DEFAULT 5, p_link TEXT DEFAULT NULL, p_extra JSONB DEFAULT '{}',
  p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.t289_recv('history', jsonb_build_object('cmd', 'history', 'type', p_type, 'callid', p_callid,
    'user', p_user, 'phone', p_phone, 'status', p_status, 'start', p_start, 'duration', p_dur, 'wait', p_wait,
    'diversion', '996312000000') || p_extra, p_link, p_org)
$$;
-- Read helpers.
CREATE FUNCTION pg_temp.t289_call(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS platform_private.telephony_calls
LANGUAGE SQL AS $$
  SELECT c FROM platform_private.telephony_calls c WHERE c.organization_id = pg_temp.t289_id(p_org) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t289_legs(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_call_legs l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = pg_temp.t289_id(p_org) AND c.pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t289_leg(p_callid TEXT, p_user TEXT, p_org INTEGER DEFAULT 1) RETURNS platform_private.telephony_call_legs
LANGUAGE SQL AS $$
  SELECT l FROM platform_private.telephony_call_legs l
  JOIN platform_private.telephony_calls c ON c.organization_id = l.organization_id AND c.id = l.call_id
  WHERE c.organization_id = pg_temp.t289_id(p_org) AND c.pbx_callid = p_callid AND l.pbx_user = p_user
  ORDER BY l.leg_started_at, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t289_events(p_callid TEXT, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.telephony_call_events e
  JOIN platform_private.telephony_calls c ON c.organization_id = e.organization_id AND c.id = e.call_id
  WHERE c.organization_id = pg_temp.t289_id(p_org) AND c.pbx_callid = p_callid
$$;
-- Move a call's last message into the past (the quiet window, aging).
CREATE FUNCTION pg_temp.t289_age(p_callid TEXT, p_seconds INTEGER, p_org INTEGER DEFAULT 1) RETURNS VOID LANGUAGE SQL AS $$
  UPDATE platform_private.telephony_calls SET last_message_at = clock_timestamp() - make_interval(secs => p_seconds)
  WHERE organization_id = pg_temp.t289_id(p_org) AND pbx_callid = p_callid
$$;
CREATE FUNCTION pg_temp.t289_all_rows() RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE t TEXT; n BIGINT; total BIGINT := 0;
BEGIN
  FOR t IN SELECT name FROM t289_tables WHERE name NOT IN ('telephony_settings', 'telephony_extensions') LOOP
    EXECUTE format('SELECT count(*) FROM platform_private.%I', t) INTO n;
    total := total + n;
  END LOOP;
  RETURN total;
END
$$;

-- The service path: the JWT role claim the public functions check.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 (members 301 and 302; PBX users u701 -> 301, u702 ->
-- 302, u703 unmapped; clients and leads for the matching) and organization 2
-- (member 305, PBX user u701 -> 305).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t289_id(1), 'T289 Fictional organization'),
  (pg_temp.t289_id(2), 'T289 Other fictional organization');
CREATE TEMP TABLE t289_actors(n INTEGER, org INTEGER);
INSERT INTO t289_actors VALUES (1, 1), (2, 1), (5, 2);
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t289_id(100 + n), 't289-' || n || '@example.invalid', '{}'::JSONB FROM t289_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t289_id(200 + n), pg_temp.t289_id(100 + n), 'T289 Actor ' || n, 'active', 1 FROM t289_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t289_id(300 + n), pg_temp.t289_id(org), pg_temp.t289_id(200 + n), 'active', NULL, NULL FROM t289_actors;
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id) VALUES
  (pg_temp.t289_id(1), 'u701', '701', 'T289 PBX user 1', pg_temp.t289_id(301)),
  (pg_temp.t289_id(1), 'u702', '702', 'T289 PBX user 2', pg_temp.t289_id(302)),
  (pg_temp.t289_id(1), 'u703', '703', 'T289 PBX user 3', NULL),
  (pg_temp.t289_id(2), 'u701', '701', 'T289 PBX user 1 (other organization)', pg_temp.t289_id(305));

INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state) VALUES
  (pg_temp.t289_id(701), pg_temp.t289_id(1), 'T289 Client A', platform_private.normalize_person_name('T289 Client A'),
    '+996555000111', platform_private.normalize_person_phone('+996555000111'), 'active'),
  (pg_temp.t289_id(703), pg_temp.t289_id(1), 'T289 Client B', platform_private.normalize_person_name('T289 Client B'),
    '0555000222', platform_private.normalize_person_phone('0555000222'), 'active'),
  (pg_temp.t289_id(705), pg_temp.t289_id(1), 'T289 Client C', platform_private.normalize_person_name('T289 Client C'),
    '+996555000333', platform_private.normalize_person_phone('+996555000333'), 'active'),
  (pg_temp.t289_id(706), pg_temp.t289_id(1), 'T289 Client D', platform_private.normalize_person_name('T289 Client D'),
    '+996555000444', platform_private.normalize_person_phone('+996555000444'), 'active'),
  (pg_temp.t289_id(707), pg_temp.t289_id(1), 'T289 Client E1', platform_private.normalize_person_name('T289 Client E1'),
    '+996555000555', platform_private.normalize_person_phone('+996555000555'), 'active'),
  (pg_temp.t289_id(708), pg_temp.t289_id(1), 'T289 Client E2', platform_private.normalize_person_name('T289 Client E2'),
    '+996555000555', platform_private.normalize_person_phone('+996555000555'), 'active'),
  (pg_temp.t289_id(709), pg_temp.t289_id(1), 'T289 Client F', platform_private.normalize_person_name('T289 Client F'),
    '+996555000666', platform_private.normalize_person_phone('+996555000666'), 'inactive'),
  (pg_temp.t289_id(711), pg_temp.t289_id(1), 'T289 Client G', platform_private.normalize_person_name('T289 Client G'),
    '555000777', platform_private.normalize_person_phone('555000777'), 'active'),
  (pg_temp.t289_id(710), pg_temp.t289_id(2), 'T289 Client A other org', platform_private.normalize_person_name('T289 Client A other org'),
    '+996555000111', platform_private.normalize_person_phone('+996555000111'), 'active'),
  (pg_temp.t289_id(720), pg_temp.t289_id(2), 'T289 Client H other org', platform_private.normalize_person_name('T289 Client H other org'),
    '+996555000888', platform_private.normalize_person_phone('+996555000888'), 'active');
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, updated_at) VALUES
  (pg_temp.t289_id(702), pg_temp.t289_id(1), pg_temp.t289_id(701), pg_temp.t289_id(301), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t289_id(704), pg_temp.t289_id(1), pg_temp.t289_id(703), pg_temp.t289_id(301), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t289_id(712), pg_temp.t289_id(1), pg_temp.t289_id(705), pg_temp.t289_id(301), 'new', 'website', 'open', '2031-01-01 10:00:00+00'),
  (pg_temp.t289_id(713), pg_temp.t289_id(1), pg_temp.t289_id(705), pg_temp.t289_id(302), 'new', 'website', 'open', '2031-02-01 10:00:00+00'),
  (pg_temp.t289_id(714), pg_temp.t289_id(1), pg_temp.t289_id(706), pg_temp.t289_id(301), 'new', 'website', 'disqualified', '2031-02-01 10:00:00+00'),
  (pg_temp.t289_id(715), pg_temp.t289_id(1), pg_temp.t289_id(707), pg_temp.t289_id(301), 'new', 'website', 'open', '2031-02-01 10:00:00+00'),
  (pg_temp.t289_id(717), pg_temp.t289_id(1), pg_temp.t289_id(711), pg_temp.t289_id(301), 'new', 'website', 'open', '2031-02-01 10:00:00+00'),
  (pg_temp.t289_id(716), pg_temp.t289_id(2), pg_temp.t289_id(710), pg_temp.t289_id(305), 'new', 'website', 'open', '2031-02-01 10:00:00+00');

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_claim_work_v1', 'telephony_project_work_v1', 'telephony_receive_v1', 'telephony_settle_calls_v1'],
  'exactly four public telephony functions exist in platform');
SELECT pg_temp.t289_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%'),
  'the public functions: SECURITY DEFINER, empty search_path, owner postgres, EXECUTE for service_role only');
SELECT pg_temp.t289_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  = ARRAY['telephony_cadence_ok', 'telephony_cadence_step_ok', 'telephony_chain_answered', 'telephony_clean_text',
    'telephony_error_code', 'telephony_fields_ok', 'telephony_form_shape_of', 'telephony_form_shape_ok',
    'telephony_leg_state_merge', 'telephony_leg_state_rank', 'telephony_match_phone', 'telephony_names_ok',
    'telephony_parse_ts', 'telephony_phone_e164', 'telephony_place_leg', 'telephony_prefixes_ok',
    'telephony_project_event', 'telephony_projection_enabled', 'telephony_recompute_call', 'telephony_resolve_user',
    'telephony_status_word', 'telephony_store_rejected', 'telephony_to_int', 'telephony_working_days_ok'],
  'the private telephony helpers are exactly the seven of T1a and seventeen of T1b');
SELECT pg_temp.t289_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%')
  AND (SELECT bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_%'),
  'no private telephony helper is executable by PUBLIC or any client role, and each has an empty search_path');
SELECT pg_temp.t289_assert((SELECT bool_and(pg_temp.t289_as(r.role, c.claims, format(
      'SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''current'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_id(1), pg_temp.t289_hex())) = '42501'
    AND pg_temp.t289_as(r.role, c.claims, format('SELECT platform.telephony_claim_work_v1(%L, ''o'')', pg_temp.t289_id(1))) = '42501'
    AND pg_temp.t289_as(r.role, c.claims, format('SELECT platform.telephony_project_work_v1(%L, %L, ''o'')', pg_temp.t289_id(1), pg_temp.t289_id(9))) = '42501'
    AND pg_temp.t289_as(r.role, c.claims, format('SELECT platform.telephony_settle_calls_v1(%L)', pg_temp.t289_id(1))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"service_role"}'), ('{"role":"authenticated","sub":"28900000-0000-4000-8000-000000000101"}'), ('')) c(claims)),
  'anon, authenticated, supabase_auth_admin and the AI agent role are refused by every public function, whatever the claims');
SELECT pg_temp.t289_assert((SELECT bool_and(pg_temp.t289_as('service_role', c.claims, s.stmt) = '42501')
    FROM (VALUES ('{"role":"authenticated"}'), ('{"role":"anon"}'), (''), ('{"sub":"28900000-0000-4000-8000-000000000101"}')) c(claims)
    CROSS JOIN (VALUES
      (format('SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''current'', %L, ''{}'', NULL, NULL)', pg_temp.t289_id(1), pg_temp.t289_hex())),
      (format('SELECT platform.telephony_claim_work_v1(%L, ''o'')', pg_temp.t289_id(1))),
      (format('SELECT platform.telephony_project_work_v1(%L, %L, ''o'')', pg_temp.t289_id(1), pg_temp.t289_id(9))),
      (format('SELECT platform.telephony_settle_calls_v1(%L)', pg_temp.t289_id(1)))) s(stmt)),
  'the database role service_role without the service claim is refused too (the role check is inside the function)');
SELECT pg_temp.t289_assert(pg_temp.t289_as('service_role', '{"role":"service_role"}',
    'SELECT platform_private.telephony_phone_e164(''996555000111'')') = '42501',
  'a private helper is not callable by service_role');
SELECT pg_temp.t289_assert(pg_temp.t289_as('service_role', '{"role":"service_role"}',
    'SELECT * FROM platform_private.telephony_calls') = '42501',
  'the tables stay closed to service_role');

-- ---------------------------------------------------------------------------
-- 2. The flag. Organization 1 has no settings row yet. (Every action and its
-- check are separate statements: a statement does not see what a function
-- called by that same statement wrote.)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t289_r(k TEXT PRIMARY KEY, r JSONB);
CREATE FUNCTION pg_temp.t289_put(p_key TEXT, p_value JSONB) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO t289_r VALUES (p_key, p_value) ON CONFLICT (k) DO UPDATE SET r = EXCLUDED.r
$$;
CREATE FUNCTION pg_temp.t289_get(p_key TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT r FROM t289_r WHERE k = p_key
$$;

SELECT pg_temp.t289_assert(NOT platform_private.telephony_projection_enabled(pg_temp.t289_id(1)),
  'no settings row means projection is off');
SELECT pg_temp.t289_put('off1', pg_temp.t289_e('INCOMING', 'off-1', 'u701', '996555000111')),
  pg_temp.t289_put('off1h', pg_temp.t289_h('off-1', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 60, 5,
    'https://records.example.invalid/t289-off-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('off1')->>'projection' = 'disabled' AND pg_temp.t289_get('off1h')->>'projection' = 'disabled'
  AND pg_temp.t289_get('off1')->>'work_state' = 'queued',
  'without a settings row intake reports projection disabled and the work queued');
SELECT pg_temp.t289_assert((SELECT count(*) FROM platform_private.telephony_pbx_events) = 2
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state = 'queued' AND attempt_count = 0) = 2
  AND (SELECT count(*) FROM platform_private.telephony_calls) = 0
  AND (SELECT count(*) FROM platform_private.telephony_call_legs) = 0
  AND (SELECT count(*) FROM platform_private.telephony_call_events) = 0,
  'evidence and queued work are stored, and no call, leg or chronology row exists');
SELECT pg_temp.t289_assert((SELECT w.has_link FROM platform_private.telephony_event_work w
    JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.cmd = 'history')
  AND pg_temp.t289_leak('t289-off-link') = '',
  'the link is not stored anywhere while projection is off (only has_link); reconciliation restores it');
SELECT pg_temp.t289_put('off_claim', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a')),
  pg_temp.t289_put('off_project', platform.telephony_project_work_v1(pg_temp.t289_id(1), pg_temp.t289_id(9), 'owner-a')),
  pg_temp.t289_put('off_settle', platform.telephony_settle_calls_v1(pg_temp.t289_id(1)));
SELECT pg_temp.t289_assert(pg_temp.t289_get('off_claim')->>'status' = 'disabled' AND pg_temp.t289_get('off_claim')->'items' = '[]'::JSONB
  AND pg_temp.t289_get('off_project')->>'status' = 'disabled' AND pg_temp.t289_get('off_settle')->>'status' = 'disabled'
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state = 'queued' AND attempt_count = 0) = 2,
  'claim, project and settle refuse without a settings row and change nothing');
INSERT INTO platform_private.telephony_settings(organization_id) VALUES (pg_temp.t289_id(1));
SELECT pg_temp.t289_put('off2_claim', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a')),
  pg_temp.t289_put('off2_settle', platform.telephony_settle_calls_v1(pg_temp.t289_id(1))),
  pg_temp.t289_put('off2', pg_temp.t289_e('INCOMING', 'off-2', 'u701', '996555000111'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('off2_claim')->>'status' = 'disabled' AND pg_temp.t289_get('off2_settle')->>'status' = 'disabled'
  AND pg_temp.t289_get('off2')->>'projection' = 'disabled' AND (SELECT count(*) FROM platform_private.telephony_calls) = 0,
  'a settings row with projection_enabled = false is still off');
UPDATE platform_private.telephony_settings SET projection_enabled = TRUE WHERE organization_id = pg_temp.t289_id(1);
-- The stored backlog (off-1 x2, off-2) projects once the flag opens: retry path, no link.
SELECT pg_temp.t289_put('backlog_claim', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 2));
SELECT pg_temp.t289_assert(jsonb_array_length(pg_temp.t289_get('backlog_claim')->'items') = 2
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state = 'leased' AND attempt_count = 1 AND lease_owner = 'owner-a') = 2,
  'the claim leases the backlog (state leased, attempt 1) once the flag opens, two at a time');
SELECT pg_temp.t289_put('backlog_project', (SELECT jsonb_agg(platform.telephony_project_work_v1(pg_temp.t289_id(1), w.id, 'owner-a') ORDER BY w.id)
  FROM platform_private.telephony_event_work w WHERE w.state = 'leased'));
SELECT pg_temp.t289_assert((SELECT bool_and(i->>'status' = 'succeeded') FROM jsonb_array_elements(pg_temp.t289_get('backlog_project')) i)
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'off-1') = 1
  AND pg_temp.t289_legs('off-1') = 1
  AND (SELECT (pg_temp.t289_leg('off-1', 'u701')).recording_state) = 'none'
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state = 'succeeded' AND completed_at IS NOT NULL) = 2,
  'the backlog projects into one call with one leg; the link lost while projection was off is not invented');
SELECT pg_temp.t289_put('backlog_claim2', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 5));
SELECT pg_temp.t289_put('backlog_project2', (SELECT jsonb_agg(platform.telephony_project_work_v1(pg_temp.t289_id(1), w.id, 'owner-a') ORDER BY w.id)
  FROM platform_private.telephony_event_work w WHERE w.state = 'leased'));
SELECT pg_temp.t289_assert(jsonb_array_length(pg_temp.t289_get('backlog_claim2')->'items') = 1
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'off-2') = 1
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state <> 'succeeded') = 0,
  'the last stored message projects on the next claim; the queue is empty');

-- ---------------------------------------------------------------------------
-- 3. Evidence and validation.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_put('ev1', pg_temp.t289_recv('event', jsonb_build_object('cmd', 'event', 'type', 'INCOMING', 'callid', 'ev-1',
  'user', 'u701', 'phone', '996555000111', 'direction', 'in', 'crm_token', 't289-token-should-never-persist',
  'link', 'https://records.example.invalid/t289-field-link.mp3', 'surprise', 'x')));
SELECT pg_temp.t289_assert(pg_temp.t289_get('ev1')->>'status' = 'stored' AND pg_temp.t289_get('ev1')->>'validation_state' = 'ok'
  AND pg_temp.t289_get('ev1')->>'dropped_fields' = '3' AND pg_temp.t289_get('ev1')->'missing_fields' = '[]'::JSONB,
  'a complete event is stored ok; the token, a link key and an unknown key are dropped and counted');
SELECT pg_temp.t289_assert(pg_temp.t289_leak('t289-token-should-never-persist') = ''
  AND pg_temp.t289_leak('t289-field-link') = ''
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events e, jsonb_object_keys(e.fields) k
    WHERE k NOT IN ('cmd', 'type', 'user', 'phone', 'diversion', 'start', 'duration', 'callid', 'status', 'ext', 'group',
      'groupRealName', 'telnum', 'telnum_name', 'rating', 'wait', 'missedStatus', 'direction', 'second_callid', 'internal')),
  'no token or link text anywhere and every stored field key is on the white list');
SELECT pg_temp.t289_assert((SELECT e.validation_state = 'ok' AND e.event_type = 'INCOMING' AND e.pbx_callid = 'ev-1'
      AND e.token_slot = 'current' AND e.has_link = FALSE AND e.body_sha256 ~ '^[0-9a-f]{64}$' AND e.dedup_key ~ '^[0-9a-f]{64}$'
      AND e.fields = jsonb_build_object('cmd', 'event', 'type', 'INCOMING', 'callid', 'ev-1', 'user', 'u701',
        'phone', '996555000111', 'direction', 'in')
    FROM platform_private.telephony_pbx_events e WHERE e.pbx_callid = 'ev-1'),
  'the stored evidence row carries the typed columns and exactly the clean fields');
-- Incomplete messages.
SELECT pg_temp.t289_put('inc1', pg_temp.t289_recv('event', jsonb_build_object('cmd', 'event', 'type', 'ACCEPTED', 'callid', 'inc-1', 'user', 'u701'))),
  pg_temp.t289_put('inc2', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'phone', '996555000111', 'direction', 'in', 'user', '   '))),
  pg_temp.t289_put('inc3', pg_temp.t289_recv('event', jsonb_build_object('type', 'IN COMING!', 'callid', 'inc-3', 'user', 'u701',
    'phone', '996555000111', 'direction', 'sideways'))),
  pg_temp.t289_put('inc4', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'callid', repeat('c', 201), 'user', 'u701',
    'phone', '996555000111', 'direction', 'in'))),
  pg_temp.t289_put('inc5', pg_temp.t289_recv('history', jsonb_build_object('type', 'in', 'callid', 'inc-5', 'user', 'u701',
    'phone', '996555000111', 'status', 'Success')));
SELECT pg_temp.t289_assert(pg_temp.t289_get('inc1')->>'validation_state' = 'incomplete' AND pg_temp.t289_get('inc1')->'missing_fields' = '["direction", "phone"]'::JSONB,
  'an event without phone and direction is incomplete with exactly those names');
SELECT pg_temp.t289_assert(pg_temp.t289_get('inc2')->'missing_fields' = '["callid", "user"]'::JSONB,
  'an event without callid and with a blank user is incomplete (callid, user)');
SELECT pg_temp.t289_assert(pg_temp.t289_get('inc3')->'missing_fields' = '["direction", "type"]'::JSONB,
  'a type or direction of the wrong shape counts as missing');
SELECT pg_temp.t289_assert(pg_temp.t289_get('inc4')->'missing_fields' = '["callid"]'::JSONB AND pg_temp.t289_get('inc4')->>'validation_state' = 'incomplete'
  AND (SELECT e.pbx_callid IS NULL AND NOT (e.fields ? 'callid') FROM platform_private.telephony_pbx_events e
    WHERE e.id = (pg_temp.t289_get('inc4')->>'event_id')::UUID),
  'a callid longer than 200 characters is dropped as missing (never truncated into another id)');
SELECT pg_temp.t289_assert(pg_temp.t289_get('inc5')->'missing_fields' = '["diversion", "duration", "start", "wait"]'::JSONB,
  'a history without diversion, duration, start and wait lists all four');
-- Value cleaning, case, rating, slot.
SELECT pg_temp.t289_put('clean1', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'callid', 'clean-1', 'user', 'u701',
    'phone', '996555000111', 'direction', 'in', 'groupRealName', E'  Sales\tteam\n' || repeat('z', 3000)))),
  pg_temp.t289_put('case1', pg_temp.t289_recv('EVENT', jsonb_build_object('type', 'INCOMING', 'callid', 'case-1', 'user', 'u701',
    'phone', '996555000111', 'direction', 'in'))),
  pg_temp.t289_put('rate1', pg_temp.t289_recv('rating', jsonb_build_object('cmd', 'rating', 'callid', 'rate-1', 'phone', '996555000111',
    'rating', 4, 'user', 'u701', 'ext', '701'))),
  pg_temp.t289_put('slot1', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'callid', 'slot-1', 'user', 'u701',
    'phone', '996555000111', 'direction', 'in'), NULL, 1, 'next'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('clean1')->>'status' = 'stored'
  AND (SELECT char_length(fields->>'groupRealName') = 2048 AND (fields->>'groupRealName') LIKE 'Salesteam%'
    FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'clean-1'),
  'values are trimmed, lose control characters and are cut at 2048');
SELECT pg_temp.t289_assert(pg_temp.t289_get('case1')->>'status' = 'stored'
  AND (SELECT cmd = 'event' FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'case-1'),
  'the command is read case-insensitively');
SELECT pg_temp.t289_assert(pg_temp.t289_get('rate1')->>'status' = 'stored' AND pg_temp.t289_get('rate1')->>'validation_state' = 'ok'
  AND pg_temp.t289_get('rate1')->>'projection' = 'not_applicable' AND pg_temp.t289_get('rate1')->>'work_state' = 'succeeded'
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'rate-1') = 0,
  'a rating is stored as evidence and its work succeeds, with no call');
SELECT pg_temp.t289_assert(pg_temp.t289_get('slot1')->>'status' = 'stored'
  AND (SELECT token_slot = 'next' FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'slot-1'),
  'the rotation slot "next" is stored');
SELECT pg_temp.t289_assert(pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''third'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_id(1), pg_temp.t289_hex())) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''current'', ''nothex'', ''{}'', NULL, NULL)',
      pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(NULL, gen_random_uuid(), ''event'', ''current'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_hex())) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, NULL, ''event'', ''current'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_id(1), pg_temp.t289_hex())) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), NULL, ''current'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_id(1), pg_temp.t289_hex())) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''current'', %L, ''{}'', NULL, NULL)',
      pg_temp.t289_id(99), pg_temp.t289_hex())) = '22023',
  'a bad slot, hash, missing argument or unknown organization is refused with 22023');
-- Request replay.
SELECT pg_temp.t289_put('rp1', platform.telephony_receive_v1(pg_temp.t289_id(1), pg_temp.t289_id(9001), 'event', 'current',
  pg_temp.t289_hex(), jsonb_build_object('type', 'INCOMING', 'callid', 'replay-1', 'user', 'u701', 'phone', '996555000111',
  'direction', 'in'), NULL, NULL));
SELECT pg_temp.t289_put('rp2', platform.telephony_receive_v1(pg_temp.t289_id(1), pg_temp.t289_id(9001), 'event', 'current',
  pg_temp.t289_hex(), jsonb_build_object('type', 'INCOMING', 'callid', 'replay-1', 'user', 'u701', 'phone', '996555000111',
  'direction', 'in'), NULL, NULL));
SELECT pg_temp.t289_assert(pg_temp.t289_get('rp1')->>'status' = 'stored' AND pg_temp.t289_get('rp2')->>'status' = 'replayed'
  AND pg_temp.t289_get('rp1')->>'event_id' = pg_temp.t289_get('rp2')->>'event_id'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'replay-1') = 1,
  'the same request id is never written twice (replayed, same event)');
SELECT pg_temp.t289_assert(pg_temp.t289_state(format('SELECT platform.telephony_receive_v1(%L, %L, ''event'', ''current'', %L, ''{}'', NULL, NULL)',
    pg_temp.t289_id(2), pg_temp.t289_id(9001), pg_temp.t289_hex())) = '22023',
  'a request id already used by another organization is refused');

-- ---------------------------------------------------------------------------
-- 4. Idempotency.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_put('dup1a', pg_temp.t289_e('INCOMING', 'dup-1', 'u701', '996555000111')),
  pg_temp.t289_put('dup1b', pg_temp.t289_e('INCOMING', 'dup-1', 'u701', '996555000111'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('dup1a')->>'status' = 'stored'
  AND pg_temp.t289_get('dup1b')->>'status' = 'deduplicated' AND pg_temp.t289_get('dup1b')->>'work_state' = 'succeeded'
  AND pg_temp.t289_get('dup1a')->>'event_id' = pg_temp.t289_get('dup1b')->>'event_id'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'dup-1') = 1
  AND (SELECT count(*) FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'dup-1') = 1
  AND pg_temp.t289_events('dup-1') = 1 AND pg_temp.t289_legs('dup-1') = 1,
  'a repeated event is deduplicated: one evidence row, one work row, one chronology row, one leg');
SELECT pg_temp.t289_put('dup2a', pg_temp.t289_h('dup-2', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 60)),
  pg_temp.t289_put('dup2b', pg_temp.t289_h('dup-2', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 61, 9,
    'https://records.example.invalid/t289-dup-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('dup2a')->>'status' = 'stored' AND pg_temp.t289_get('dup2b')->>'status' = 'deduplicated'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'dup-2') = 1
  AND pg_temp.t289_leak('t289-dup-link') = '',
  'a history repeat that differs only in duration, wait or link is the same message (key per plan 5.1)');
SELECT pg_temp.t289_put('dup3', jsonb_build_array(
  pg_temp.t289_h('dup-3', 'u701', '996555000111', 'in', 'missed', '20200107T090000Z', 30),
  pg_temp.t289_h('dup-3', 'u702', '996555000111', 'in', 'missed', '20200107T090000Z', 30),
  pg_temp.t289_h('dup-3', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 30),
  pg_temp.t289_h('dup-3', 'u701', '996555000111', 'in', 'missed', '20200107T091500Z', 30)));
SELECT pg_temp.t289_assert((SELECT bool_and(i->>'status' = 'stored') FROM jsonb_array_elements(pg_temp.t289_get('dup3')) i)
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'dup-3') = 4,
  'messages with one callid and a different user, status or start are all kept');
SELECT pg_temp.t289_put('dup1c', pg_temp.t289_e('INCOMING', 'dup-1', 'u701', '996555000111', 'in', '{}', 2));
SELECT pg_temp.t289_assert(pg_temp.t289_get('dup1c')->>'status' = 'stored'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'dup-1') = 2
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'dup-1') = 1,
  'the dedup key is per organization (organization 2 has no settings row: stored, not projected)');

-- ---------------------------------------------------------------------------
-- 5. The fields lock (23514) and unknown commands.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t289_before AS SELECT
  (SELECT count(*) FROM platform_private.telephony_event_work) AS work_rows,
  (SELECT count(*) FROM platform_private.telephony_calls) AS call_rows;
SELECT pg_temp.t289_put('lock1', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'callid', 'lock-1', 'user', 'u701',
  'phone', '996555000111', 'direction', 'in', 'groupRealName', 'see http://t289-lock-value.example.invalid/x')));
SELECT pg_temp.t289_assert(pg_temp.t289_get('lock1')->>'status' = 'rejected' AND pg_temp.t289_get('lock1')->>'reason' = 'fields_check'
  AND pg_temp.t289_get('lock1')->>'validation_state' = 'rejected'
  AND pg_temp.t289_get('lock1')->>'reason_code' = 'e23514_telephony_pbx_events_fields_check' AND pg_temp.t289_get('lock1') ? 'event_id'
  AND pg_temp.t289_get('lock1')::TEXT NOT LIKE '%t289-lock-value%',
  'a link-like value in a legitimate field is answered "rejected", not raised, with a coded reason');
SELECT pg_temp.t289_assert((SELECT count(*) = 1 AND bool_and(e.validation_state = 'rejected' AND e.cmd = 'bad_event' AND e.fields IS NULL
        AND e.dedup_key IS NULL AND e.pbx_callid IS NULL AND e.second_callid IS NULL AND e.event_type IS NULL
        AND cardinality(e.missing_fields) = 0 AND e.token_slot = 'current'
        AND e.form_shape = jsonb_build_object('callid', 6, 'direction', 2, 'groupRealName', 44, 'phone', 12, 'type', 8, 'user', 4))
    FROM platform_private.telephony_pbx_events e WHERE e.validation_state = 'rejected' AND e.cmd = 'bad_event')
  AND pg_temp.t289_leak('t289-lock-value') = ''
  AND pg_temp.t289_leak('lock-1') = ''
  AND (SELECT count(*) FROM platform_private.telephony_event_work) = (SELECT work_rows FROM t289_before)
  AND (SELECT count(*) FROM platform_private.telephony_calls) = (SELECT call_rows FROM t289_before),
  'exactly one rejected row: names and lengths only, no values, no work, no call');
SELECT pg_temp.t289_put('lock2', pg_temp.t289_recv('history', jsonb_build_object('type', 'in', 'callid', 'lock-2', 'user', 'u701', 'phone', '996555000111',
    'status', 'Success', 'start', '20200107T090000Z', 'duration', 5, 'wait', 1, 'diversion', '996312000000',
    'groupRealName', 'planning.mp3'), 'https://records.example.invalid/t289-lock-link.mp3')),
  pg_temp.t289_put('lock3', pg_temp.t289_recv('rating', jsonb_build_object('callid', 'lock-3', 'phone', '996555000111', 'rating', 5,
    'user', 'u701', 'ext', 'ftp:t289'))),
  pg_temp.t289_put('lock4', pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'callid', 'lock-4', 'user', 'u701',
    'phone', '996555000111', 'direction', 'in', 'groupRealName', 'Security during recorded secretary')));
SELECT pg_temp.t289_assert(pg_temp.t289_get('lock2')->>'status' = 'rejected' AND pg_temp.t289_get('lock2')->>'reason' = 'fields_check'
  AND (SELECT cmd = 'bad_history' AND has_link FROM platform_private.telephony_pbx_events WHERE cmd = 'bad_history')
  AND pg_temp.t289_leak('t289-lock-link') = '',
  'a value ending in .mp3 trips the lock: a rejected history row; the link is dropped (has_link only)');
SELECT pg_temp.t289_assert(pg_temp.t289_get('lock3')->>'status' = 'rejected'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE cmd = 'bad_rating') = 1,
  'a rating trips the lock the same way (bad_rating)');
SELECT pg_temp.t289_assert(pg_temp.t289_get('lock4')->>'status' = 'stored',
  'ordinary words that contain url/uri/record/secret are no value pattern: stored ok');
-- Unknown commands keep only their form.
SELECT pg_temp.t289_put('unk1', platform.telephony_receive_v1(pg_temp.t289_id(1), gen_random_uuid(), 'foo', 'current', pg_temp.t289_hex(), NULL, NULL,
    jsonb_build_object('callid', 7, 'https://x.example.invalid/a b', 12, 'phone', 99999999, 'x y', 3))),
  pg_temp.t289_put('unk2', platform.telephony_receive_v1(pg_temp.t289_id(1), gen_random_uuid(), 'contact', 'current', pg_temp.t289_hex(),
    jsonb_build_object('callid', 'k1', 'phone', '996555000111'), NULL, NULL)),
  pg_temp.t289_put('unk3', platform.telephony_receive_v1(pg_temp.t289_id(1), gen_random_uuid(), E'Evil\ncmd' || repeat('x', 40), 'current',
    pg_temp.t289_hex(), NULL, NULL, NULL));
SELECT pg_temp.t289_assert(pg_temp.t289_get('unk1')->>'status' = 'rejected' AND pg_temp.t289_get('unk1')->>'reason' = 'unknown_cmd'
  AND (SELECT e.cmd = 'foo' AND e.validation_state = 'rejected' AND e.fields IS NULL
      AND e.form_shape = jsonb_build_object('callid', 7, 'phone', 99999, 'invalid_name_1', 12, 'invalid_name_2', 3)
    FROM platform_private.telephony_pbx_events e WHERE e.cmd = 'foo')
  AND pg_temp.t289_leak('x.example.invalid') = '',
  'an unknown command stores its form: foreign names become invalid_name_N and long lengths are capped');
SELECT pg_temp.t289_assert(pg_temp.t289_get('unk2')->>'status' = 'rejected'
  AND (SELECT form_shape = jsonb_build_object('callid', 2, 'phone', 12) FROM platform_private.telephony_pbx_events WHERE cmd = 'contact')
  AND pg_temp.t289_get('unk3')->>'status' = 'rejected'
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE cmd = '' AND validation_state = 'rejected') = 1,
  'contact is not stored as a call; a command with control characters or over 32 characters is stored as the empty command');
SELECT pg_temp.t289_assert(pg_temp.t289_all_rows() > 0, 'sanity: rows exist before the call scenarios');

-- ---------------------------------------------------------------------------
-- 6. Legs and calls.
-- ---------------------------------------------------------------------------
-- 6.1 An incoming call answered by an employee, step by step.
SELECT pg_temp.t289_e('INCOMING', 'in-1', 'u701', '996555000111');
SELECT pg_temp.t289_assert((SELECT c.state = 'ringing' AND c.outcome IS NULL AND c.direction = 'in' AND c.client_phone = '+996555000111'
      AND c.match_state = 'matched' AND c.client_id = pg_temp.t289_id(701) AND c.lead_id = pg_temp.t289_id(702)
      AND NOT c.needs_review AND c.created_via = 'webhook' AND c.settled_at IS NULL AND c.answered_at IS NULL
    FROM (SELECT (pg_temp.t289_call('in-1')).*) c)
  AND pg_temp.t289_legs('in-1') = 1 AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).state) = 'ringing'
  AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).membership_id) = pg_temp.t289_id(301)
  AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).leg_start_source) = 'event',
  'INCOMING: one ringing call and leg, phone normalized, client and open lead matched');
SELECT pg_temp.t289_e('ACCEPTED', 'in-1', 'u701', '996555000111');
SELECT pg_temp.t289_assert((SELECT c.state = 'answered' AND c.outcome = 'answered' AND c.outcome_source = 'webhook'
      AND c.answered_at IS NOT NULL AND c.membership_id = pg_temp.t289_id(301) AND c.ended_at IS NULL
    FROM (SELECT (pg_temp.t289_call('in-1')).*) c)
  AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).state) = 'accepted'
  AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).accepted_at) IS NOT NULL AND pg_temp.t289_legs('in-1') = 1,
  'ACCEPTED by a PBX employee: answered, first answerer recorded, same leg');
SELECT pg_temp.t289_e('COMPLETED', 'in-1', 'u701', '996555000111');
SELECT pg_temp.t289_assert((SELECT c.state = 'ended' AND c.outcome = 'answered' AND c.ended_at IS NOT NULL
    FROM (SELECT (pg_temp.t289_call('in-1')).*) c)
  AND (SELECT (pg_temp.t289_leg('in-1', 'u701')).state) = 'completed',
  'COMPLETED: every known leg ended, the call is ended and still answered');
SELECT pg_temp.t289_h('in-1', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 95, 12,
  'https://records.example.invalid/t289-in1-link.mp3');
SELECT pg_temp.t289_assert((SELECT l.leg_started_at = '2020-01-07T09:00:00Z' AND l.leg_start_source = 'history' AND l.status = 'success'
      AND l.webhook_total_seconds = 95 AND l.wait_seconds = 12 AND l.recording_state = 'available'
      AND l.recording_link = 'https://records.example.invalid/t289-in1-link.mp3' AND l.talk_seconds IS NULL
    FROM (SELECT (pg_temp.t289_leg('in-1', 'u701')).*) l)
  AND pg_temp.t289_legs('in-1') = 1
  AND (SELECT c.webhook_total_seconds = 95 AND c.wait_seconds = 12 AND c.talk_seconds IS NULL AND c.recording_state = 'available'
      AND c.outcome = 'answered' AND c.state = 'ended' AND c.started_at = '2020-01-07T09:00:00Z'
    FROM (SELECT (pg_temp.t289_call('in-1')).*) c)
  AND pg_temp.t289_events('in-1') = 4,
  'history after the events moves the leg key to the history start (no second leg), keeps the answer, totals and the link; talk time stays empty');
SELECT pg_temp.t289_assert(pg_temp.t289_leak('t289-in1-link') = 'telephony_call_legs',
  'the recording link exists in the leg and in no other table');
SELECT pg_temp.t289_e('INCOMING', 'in-1', 'u701', '996555000111'), pg_temp.t289_e('ACCEPTED', 'in-1', 'u701', '996555000111'),
  pg_temp.t289_e('COMPLETED', 'in-1', 'u701', '996555000111'),
  pg_temp.t289_h('in-1', 'u701', '996555000111', 'in', 'Success', '20200107T090000Z', 95, 12);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('in-1') = 1 AND pg_temp.t289_events('in-1') = 4
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'in-1') = 4,
  'replaying all four messages adds no evidence, no leg and no chronology row');

-- 6.2 History first, events later (out of order): one leg.
SELECT pg_temp.t289_h('ooo-1', 'u701', '996555000111', 'in', 'Success', '20200107T100000Z', 70, 4);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('ooo-1') = 1 AND (SELECT (pg_temp.t289_call('ooo-1')).outcome) = 'answered'
  AND (SELECT (pg_temp.t289_call('ooo-1')).state) = 'ended',
  'a history alone answers the call through an employee Success with a total above zero');
SELECT pg_temp.t289_e('INCOMING', 'ooo-1', 'u701', '996555000111'), pg_temp.t289_e('ACCEPTED', 'ooo-1', 'u701', '996555000111'),
  pg_temp.t289_e('COMPLETED', 'ooo-1', 'u701', '996555000111');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('ooo-1') = 1 AND pg_temp.t289_events('ooo-1') = 4
  AND (SELECT (pg_temp.t289_leg('ooo-1', 'u701')).leg_started_at) = '2020-01-07T10:00:00Z'
  AND (SELECT (pg_temp.t289_leg('ooo-1', 'u701')).leg_start_source) = 'history',
  'events after the history attach to the same leg: no duplicate, the history start stays the key');
-- 6.3 ACCEPTED before INCOMING, COMPLETED before ACCEPTED.
SELECT pg_temp.t289_e('ACCEPTED', 'ooo-2', 'u701', '996555000111'), pg_temp.t289_e('INCOMING', 'ooo-2', 'u701', '996555000111');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('ooo-2') = 1 AND (SELECT (pg_temp.t289_leg('ooo-2', 'u701')).state) = 'accepted'
  AND (SELECT (pg_temp.t289_call('ooo-2')).outcome) = 'answered',
  'ACCEPTED then INCOMING: one leg that is never downgraded to ringing');
SELECT pg_temp.t289_e('COMPLETED', 'ooo-3', 'u701', '996555000111'), pg_temp.t289_e('ACCEPTED', 'ooo-3', 'u701', '996555000111'),
  pg_temp.t289_e('INCOMING', 'ooo-3', 'u701', '996555000111');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('ooo-3') = 1 AND (SELECT (pg_temp.t289_leg('ooo-3', 'u701')).state) = 'completed'
  AND (SELECT (pg_temp.t289_call('ooo-3')).state) = 'ended' AND (SELECT (pg_temp.t289_call('ooo-3')).outcome) = 'answered'
  AND pg_temp.t289_events('ooo-3') = 3,
  'COMPLETED, ACCEPTED, INCOMING in reverse: one completed leg, an answered ended call');

-- 6.4 Rule 1: only an employee answers.
SELECT pg_temp.t289_h('greet-1', '', '996555000999', 'in', 'Success', '20200107T110000Z', 25, 24);
SELECT pg_temp.t289_h('greet-2', 'Sales', '996555000999', 'in', 'Success', '20200107T110100Z', 25, 24, NULL, '{"groupRealName":"Sales"}');
SELECT pg_temp.t289_h('greet-3', 'u701', '996555000999', 'in', 'Success', '20200107T110200Z', 0, 0);
SELECT pg_temp.t289_h('greet-4', 'ivr', '996555000999', 'in', 'Success', '20200107T110300Z', 30, 5);
SELECT pg_temp.t289_h('greet-5', 'unknown-person', '996555000999', 'in', 'Success', '20200107T110400Z', 30, 5);
SELECT pg_temp.t289_h('greet-6', 'u701', '996555000999', 'in', 'Success', '20200107T110500Z', 30, 5);
SELECT pg_temp.t289_assert((SELECT bool_and(c.outcome = 'missed' AND c.state = 'ended') FROM platform_private.telephony_calls c
    WHERE c.pbx_callid IN ('greet-1', 'greet-2', 'greet-3', 'greet-4', 'greet-5') AND c.organization_id = pg_temp.t289_id(1))
  AND (SELECT (pg_temp.t289_call('greet-6')).outcome) = 'answered',
  'Success with no user, a group name, ivr, a user outside the directory or zero seconds is NOT an answer; an employee with seconds is');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('greet-1')).needs_review) AND NOT (SELECT (pg_temp.t289_call('greet-2')).needs_review)
  AND (SELECT (pg_temp.t289_leg('greet-1', '')).state) = 'completed',
  'a greeting-only history without a user is flagged for review (user is a critical field); the leg exists with an empty user');

-- 6.5 A group call: three legs, CANCELLED belongs to the leg, one answers.
SELECT pg_temp.t289_e('INCOMING', 'grp-1', 'u701', '996555000999', 'in', '{"groupRealName":"T289 Group"}'),
  pg_temp.t289_e('INCOMING', 'grp-1', 'u702', '996555000999', 'in', '{"groupRealName":"T289 Group"}'),
  pg_temp.t289_e('INCOMING', 'grp-1', 'u703', '996555000999', 'in', '{"groupRealName":"T289 Group"}');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('grp-1') = 3 AND (SELECT (pg_temp.t289_call('grp-1')).state) = 'ringing'
  AND (SELECT (pg_temp.t289_leg('grp-1', 'u702')).group_name) = 'T289 Group',
  'a group call: one call, one leg per employee');
SELECT pg_temp.t289_e('CANCELLED', 'grp-1', 'u701', '996555000999'), pg_temp.t289_e('CANCELLED', 'grp-1', 'u703', '996555000999');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('grp-1')).state) = 'ringing' AND (SELECT (pg_temp.t289_call('grp-1')).outcome) IS NULL
  AND (SELECT (pg_temp.t289_leg('grp-1', 'u701')).state) = 'cancelled',
  'CANCELLED ends the leg, not the call: the third leg still rings');
SELECT pg_temp.t289_e('ACCEPTED', 'grp-1', 'u702', '996555000999'), pg_temp.t289_e('COMPLETED', 'grp-1', 'u702', '996555000999');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('grp-1')).state) = 'ended' AND (SELECT (pg_temp.t289_call('grp-1')).outcome) = 'answered'
  AND (SELECT (pg_temp.t289_call('grp-1')).membership_id) = pg_temp.t289_id(302) AND pg_temp.t289_legs('grp-1') = 3
  AND (SELECT (pg_temp.t289_call('grp-1')).match_state) = 'unmatched',
  'the answer by one employee ends the call as answered; the first answerer is recorded');
SELECT pg_temp.t289_h('grp-1', 'u701', '996555000999', 'in', 'Cancel', '20200107T120000Z', 20, 20),
  pg_temp.t289_h('grp-1', 'u703', '996555000999', 'in', 'missed', '20200107T120000Z', 20, 20),
  pg_temp.t289_h('grp-1', 'u702', '996555000999', 'in', 'Success', '20200107T120000Z', 60, 8);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('grp-1') = 3 AND (SELECT (pg_temp.t289_call('grp-1')).outcome) = 'answered'
  AND (SELECT (pg_temp.t289_leg('grp-1', 'u701')).state) = 'cancelled'
  AND (SELECT (pg_temp.t289_leg('grp-1', 'u703')).state) = 'cancelled'
  AND (SELECT (pg_temp.t289_leg('grp-1', 'u702')).leg_start_source) = 'history',
  'histories for the three legs: still three legs, still answered (rule 2), no key collision');

-- 6.6 Rule 2: an answer is never undone by a later leg.
SELECT pg_temp.t289_e('INCOMING', 'irr-1', 'u701', '996555000999'), pg_temp.t289_e('ACCEPTED', 'irr-1', 'u701', '996555000999'),
  pg_temp.t289_e('INCOMING', 'irr-1', 'u702', '996555000999'), pg_temp.t289_e('CANCELLED', 'irr-1', 'u702', '996555000999'),
  pg_temp.t289_h('irr-1', 'u702', '996555000999', 'in', 'missed', '20200107T130000Z', 15, 15),
  pg_temp.t289_e('COMPLETED', 'irr-1', 'u701', '996555000999');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('irr-1')).outcome) = 'answered' AND (SELECT (pg_temp.t289_call('irr-1')).state) = 'ended'
  AND (SELECT (pg_temp.t289_call('irr-1')).membership_id) = pg_temp.t289_id(301),
  'A answers, B (transfer target) is cancelled or missed: the call stays answered');
SELECT pg_temp.t289_h('irr-2', 'u701', '996555000999', 'in', 'Success', '20200107T131000Z', 40, 3),
  pg_temp.t289_h('irr-2', 'u701', '996555000999', 'in', 'missed', '20200107T131500Z', 10, 10);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('irr-2')).outcome) = 'answered' AND pg_temp.t289_legs('irr-2') = 2,
  'a later missed leg of the same employee in the same call does not undo the answer');

-- 6.7 Rule 3: precedence among outcomes without an answer.
SELECT pg_temp.t289_h('prec-1', 'u701', '996555000999', 'out', 'missed', '20200107T140000Z', 30, 30),
  pg_temp.t289_h('prec-1', 'u702', '996555000999', 'out', 'Busy', '20200107T140000Z', 30, 30);
SELECT pg_temp.t289_h('prec-2', 'u701', '996555000999', 'out', 'missed', '20200107T140100Z', 30, 30),
  pg_temp.t289_h('prec-2', 'u702', '996555000999', 'out', 'Cancel', '20200107T140100Z', 30, 30);
SELECT pg_temp.t289_h('prec-3', 'u701', '996555000999', 'out', 'NotAvailable', '20200107T140200Z', 5, 5),
  pg_temp.t289_h('prec-3', 'u702', '996555000999', 'out', 'NotFound', '20200107T140200Z', 5, 5);
SELECT pg_temp.t289_h('prec-4', 'u701', '996555000999', 'out', 'NotAllowed', '20200107T140300Z', 5, 5),
  pg_temp.t289_h('prec-4', 'u702', '996555000999', 'out', 'Cancel', '20200107T140300Z', 5, 5);
SELECT pg_temp.t289_h('prec-5', 'u701', '996555000999', 'out', 'NotFound', '20200107T140400Z', 5, 5),
  pg_temp.t289_h('prec-5', 'u702', '996555000999', 'out', 'NotAllowed', '20200107T140400Z', 5, 5);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('prec-1')).outcome) = 'busy' AND (SELECT (pg_temp.t289_call('prec-2')).outcome) = 'cancelled'
  AND (SELECT (pg_temp.t289_call('prec-3')).outcome) = 'unavailable' AND (SELECT (pg_temp.t289_call('prec-4')).outcome) = 'not_allowed'
  AND (SELECT (pg_temp.t289_call('prec-5')).outcome) = 'not_found',
  'busy > unavailable > not_found > not_allowed > cancelled > missed');
SELECT pg_temp.t289_assert((SELECT bool_and(c.outcome_source = 'webhook' AND c.state = 'ended' AND c.direction = 'out')
    FROM platform_private.telephony_calls c WHERE c.pbx_callid LIKE 'prec-%' AND c.organization_id = pg_temp.t289_id(1)),
  'webhook outcomes are marked as exact (outcome_source webhook) and the direction comes from history type');

-- 6.8 An outgoing ACCEPTED is not an answer (whose handset is unknown).
SELECT pg_temp.t289_e('OUTGOING', 'out-1', 'u701', '996555000999', 'out'), pg_temp.t289_e('ACCEPTED', 'out-1', 'u701', '996555000999', 'out');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('out-1')).outcome) IS NULL AND (SELECT (pg_temp.t289_call('out-1')).state) = 'ringing'
  AND (SELECT (pg_temp.t289_leg('out-1', 'u701')).state) = 'accepted' AND (SELECT (pg_temp.t289_call('out-1')).direction) = 'out',
  'outgoing: ACCEPTED marks the leg but the call is not answered yet');
SELECT pg_temp.t289_h('out-1', 'u701', '996555000999', 'out', 'Success', '20200107T150000Z', 48, 6);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('out-1')).outcome) = 'answered' AND pg_temp.t289_legs('out-1') = 1,
  'outgoing: history Success from the employee answers it');
SELECT pg_temp.t289_e('OUTGOING', 'out-2', 'u701', '996555000999', 'out'), pg_temp.t289_e('ACCEPTED', 'out-2', 'u701', '996555000999', 'out'),
  pg_temp.t289_h('out-2', 'u701', '996555000999', 'out', 'Busy', '20200107T150100Z', 12, 12);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('out-2')).outcome) = 'busy' AND (SELECT (pg_temp.t289_call('out-2')).answered_at) IS NULL,
  'outgoing: an ACCEPTED followed by Busy is a busy call, never answered');

-- 6.9 Two participations of one employee in one call are two legs.
-- (the dedup key has no time part: a second ring that differs in nothing is the same message;
-- here the second INCOMING carries the extension, which is part of the key)
SELECT pg_temp.t289_e('INCOMING', 'two-1', 'u701', '996555000999'), pg_temp.t289_e('CANCELLED', 'two-1', 'u701', '996555000999'),
  pg_temp.t289_e('INCOMING', 'two-1', 'u701', '996555000999', 'in', '{"ext":"701"}');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('two-1') = 2 AND (SELECT (pg_temp.t289_call('two-1')).state) = 'ringing',
  'INCOMING, CANCELLED, INCOMING for one employee: two legs and a ringing call');
SELECT pg_temp.t289_e('ACCEPTED', 'two-1', 'u701', '996555000999');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('two-1') = 2 AND (SELECT count(*) FROM platform_private.telephony_call_legs l
    JOIN platform_private.telephony_calls c ON c.id = l.call_id WHERE c.pbx_callid = 'two-1' AND l.state = 'accepted') = 1
  AND (SELECT (pg_temp.t289_call('two-1')).outcome) = 'answered',
  'the next ACCEPTED belongs to the open leg, not to the cancelled one');
-- 6.10 Two histories of one user with different starts are two legs; replays do not add.
SELECT pg_temp.t289_h('hist-1', 'u701', '996555000999', 'in', 'missed', '20200107T160000Z', 10, 10),
  pg_temp.t289_h('hist-1', 'u701', '996555000999', 'in', 'Success', '20200107T160100Z', 50, 5),
  pg_temp.t289_h('hist-1', 'u701', '996555000999', 'in', 'missed', '20200107T160000Z', 10, 10);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('hist-1') = 2 AND (SELECT (pg_temp.t289_call('hist-1')).outcome) = 'answered',
  'two histories with different starts are two legs, the repeat of the first is deduplicated');
-- 6.11 The key transition across several event legs: history picks the nearest event leg.
SELECT pg_temp.t289_e('INCOMING', 'key-1', 'u702', '996555000999'), pg_temp.t289_e('ACCEPTED', 'key-1', 'u702', '996555000999'),
  pg_temp.t289_h('key-1', 'u702', '996555000999', 'in', 'Success', '20200107T170000Z', 33, 5);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('key-1') = 1 AND (SELECT (pg_temp.t289_leg('key-1', 'u702')).leg_started_at) = '2020-01-07T17:00:00Z'
  AND (SELECT (pg_temp.t289_call('key-1')).started_at) = '2020-01-07T17:00:00Z',
  'the leg key moves from the event time to the history start; the call start takes the earlier history start');

-- 6.12 Incomplete messages flag the call; diversion, duration and wait do not.
SELECT pg_temp.t289_recv('event', jsonb_build_object('type', 'INCOMING', 'phone', '996555000111', 'direction', 'in', 'user', 'u701'));
SELECT pg_temp.t289_assert((SELECT count(*) = 2 AND bool_and(c.needs_review AND c.pbx_callid ~ '^tmp:[0-9a-f]{32}$' AND c.client_phone = '+996555000111')
    FROM platform_private.telephony_calls c WHERE c.pbx_callid LIKE 'tmp:%'),
  'messages without callid (here two: blank user and user u701) get a distinct temporary key tmp:<hash> and needs_review');
SELECT pg_temp.t289_e('INCOMING', 'inc-u1', NULL, '996555000111');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('inc-u1')).needs_review) AND pg_temp.t289_legs('inc-u1') = 1
  AND (SELECT (pg_temp.t289_leg('inc-u1', '')).group_name) IS NULL,
  'a message without user: a leg with the empty user, needs_review');
SELECT pg_temp.t289_e('INCOMING', 'inc-p1', 'u701', NULL);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('inc-p1')).needs_review) AND (SELECT (pg_temp.t289_call('inc-p1')).client_phone) IS NULL
  AND (SELECT (pg_temp.t289_call('inc-p1')).match_state) = 'unmatched',
  'an anonymous caller: no phone, unmatched, needs_review');
SELECT pg_temp.t289_recv('history', jsonb_build_object('type', 'in', 'callid', 'inc-h1', 'user', 'u701', 'phone', '996555000111',
  'status', 'Success', 'start', '20200107T180000Z'));
SELECT pg_temp.t289_assert(NOT (SELECT (pg_temp.t289_call('inc-h1')).needs_review)
  AND (SELECT validation_state FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'inc-h1') = 'incomplete'
  AND (SELECT (pg_temp.t289_call('inc-h1')).outcome) = 'missed',
  'a history missing only diversion, duration and wait is evidence-incomplete but not needs_review; without seconds an employee Success is not an answer (rule 1)');
-- A direction guess is corrected by the first message that carries one.
SELECT pg_temp.t289_recv('event', jsonb_build_object('type', 'ACCEPTED', 'callid', 'dir-1', 'user', 'u701', 'phone', '996555000111'));
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('dir-1')).direction) = 'in' AND (SELECT (pg_temp.t289_call('dir-1')).needs_review),
  'no direction anywhere: provisional in, needs_review');
SELECT pg_temp.t289_e('OUTGOING', 'dir-1', 'u701', '996555000111', 'out');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('dir-1')).direction) = 'out',
  'the first message with a direction corrects the guess');
SELECT pg_temp.t289_e('INCOMING', 'dir-2', 'u701', '996555000111', 'in');
SELECT pg_temp.t289_e('OUTGOING', 'dir-2', 'u702', '996555000111', 'out');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('dir-2')).direction) = 'in',
  'with a clean first event the direction is not rewritten by a later one (rule 7)');

-- 6.13 Internal calls: no row, a counter, no number, no link.
SELECT pg_temp.t289_assert((SELECT count(*) FROM platform_private.telephony_runtime_state WHERE internal_calls_total > 0) = 0, 'no internal call counted yet');
SELECT pg_temp.t289_e('INCOMING', 'int-1', 'u701', '702', 'out'), pg_temp.t289_e('OUTGOING', 'int-2', 'u702', '703', 'out'),
  pg_temp.t289_e('INCOMING', 'int-3', 'u701', ' 7 ', 'in');
SELECT pg_temp.t289_h('int-1', 'u701', '702', 'out', 'Success', '20200107T190000Z', 40, 2, 'https://records.example.invalid/t289-int-link.mp3');
SELECT pg_temp.t289_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid LIKE 'int-%') = 0
  AND (SELECT internal_calls_total FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t289_id(1)) = 3
  AND (SELECT bool_and(NOT (fields ? 'phone') AND fields->>'internal' = '1' AND NOT has_link)
    FROM platform_private.telephony_pbx_events WHERE pbx_callid LIKE 'int-%')
  AND pg_temp.t289_leak('t289-int-link') = ''
  AND (SELECT (e.validation_state = 'ok') FROM platform_private.telephony_pbx_events e WHERE e.pbx_callid = 'int-2' LIMIT 1),
  'a short number or an extension: no call row, three counted, evidence without the number (internal marker) and without the link');
SELECT pg_temp.t289_e('INCOMING', 'int-4', 'u701', 'anonymous');
SELECT pg_temp.t289_assert(pg_temp.t289_legs('int-4') = 1 AND (SELECT (pg_temp.t289_call('int-4')).client_phone) IS NULL
  AND (SELECT internal_calls_total FROM platform_private.telephony_runtime_state WHERE organization_id = pg_temp.t289_id(1)) = 3,
  'a non-numeric caller id is not an internal call');

-- 6.14 second_callid: the pair is linked; the chain answers as one contact.
SELECT pg_temp.t289_e('INCOMING', 'tr-1', 'u701', '996555000999'), pg_temp.t289_e('ACCEPTED', 'tr-1', 'u701', '996555000999'),
  pg_temp.t289_e('TRANSFERRED', 'tr-1', 'u701', '996555000999', 'in', '{"second_callid":"tr-2"}');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('tr-1')).linked_call_id) = (SELECT (pg_temp.t289_call('tr-2')).id)
  AND (SELECT (pg_temp.t289_call('tr-2')).direction) = 'in' AND (SELECT (pg_temp.t289_call('tr-2')).client_phone) IS NULL
  AND pg_temp.t289_legs('tr-2') = 0 AND (SELECT (pg_temp.t289_call('tr-2')).outcome) IS NULL
  AND (SELECT (pg_temp.t289_leg('tr-1', 'u701')).state) = 'transferred',
  'TRANSFERRED with second_callid links the pair and prepares the second call (direction only) without inventing legs or a number');
SELECT pg_temp.t289_e('INCOMING', 'tr-2', 'u702', '996555000999'), pg_temp.t289_e('CANCELLED', 'tr-2', 'u702', '996555000999'),
  pg_temp.t289_h('tr-2', 'u702', '996555000999', 'in', 'missed', '20200107T200000Z', 20, 20);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('tr-1')).outcome) = 'answered' AND (SELECT (pg_temp.t289_call('tr-2')).outcome) = 'cancelled'
  AND pg_temp.t289_legs('tr-2') = 1 AND (SELECT (pg_temp.t289_call('tr-1')).state) = 'ended',
  'A answered and transferred, B did not take it: A is answered, B has its own outcome');
SELECT pg_temp.t289_assert(platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-2')).id))
  AND platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-1')).id)),
  'the chain is one contact: answered from either end');
-- The link arrives after the second call already exists.
SELECT pg_temp.t289_e('INCOMING', 'tr-4', 'u702', '996555000999'), pg_temp.t289_e('CANCELLED', 'tr-4', 'u702', '996555000999'),
  pg_temp.t289_e('INCOMING', 'tr-3', 'u701', '996555000999'), pg_temp.t289_e('ACCEPTED', 'tr-3', 'u701', '996555000999');
SELECT pg_temp.t289_assert(NOT platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-4')).id)),
  'unlinked calls of one number are not a chain');
SELECT pg_temp.t289_e('TRANSFERRED', 'tr-3', 'u701', '996555000999', 'in', '{"second_callid":"tr-4"}');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('tr-3')).linked_call_id) = (SELECT (pg_temp.t289_call('tr-4')).id)
  AND platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-4')).id))
  AND pg_temp.t289_legs('tr-4') = 1,
  'a late link between two existing calls makes the chain answered for the second call');
SELECT pg_temp.t289_e('TRANSFERRED', 'tr-5', 'u701', '996555000999', 'in', '{"second_callid":"tr-5"}');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('tr-5')).linked_call_id) IS NULL,
  'a call is never linked to itself');
SELECT pg_temp.t289_e('TRANSFERRED', 'tr-4', 'u702', '996555000999', 'in', '{"second_callid":"tr-3"}');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('tr-4')).linked_call_id) IS NULL
  AND platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-4')).id)),
  'a link back to the call that links here is not taken (no two-call cycle); the chain still resolves');
-- A chain through another number is not one contact.
SELECT pg_temp.t289_e('INCOMING', 'tr-6', 'u701', '996555000111'), pg_temp.t289_e('ACCEPTED', 'tr-6', 'u701', '996555000111'),
  pg_temp.t289_e('TRANSFERRED', 'tr-6', 'u701', '996555000111', 'in', '{"second_callid":"tr-7"}'),
  pg_temp.t289_e('INCOMING', 'tr-7', 'u702', '996555000222'), pg_temp.t289_e('CANCELLED', 'tr-7', 'u702', '996555000222');
SELECT pg_temp.t289_assert(NOT platform_private.telephony_chain_answered(pg_temp.t289_id(1), (SELECT (pg_temp.t289_call('tr-7')).id)),
  'a linked call with another client number is not part of the contact');

-- 6.15 Cross-organization isolation.
SELECT pg_temp.t289_e('INCOMING', 'iso-1', 'u701', '996555000111', 'in', '{}', 2);
SELECT pg_temp.t289_assert(pg_temp.t289_legs('iso-1', 2) = 0 AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'iso-1') = 0,
  'organization 2 has no settings row: stored, not projected');
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled) VALUES (pg_temp.t289_id(2), TRUE);
SELECT pg_temp.t289_e('INCOMING', 'iso-2', 'u701', '996555000111', 'in', '{}', 2);
SELECT pg_temp.t289_e('ACCEPTED', 'iso-2', 'u701', '996555000111', 'in', '{}', 2);
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('iso-2', 2)).membership_id) = pg_temp.t289_id(305)
  AND (SELECT (pg_temp.t289_call('iso-2', 2)).client_id) = pg_temp.t289_id(710)
  AND (SELECT (pg_temp.t289_call('iso-2', 2)).lead_id) = pg_temp.t289_id(716)
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'iso-2') = 1,
  'organization 2 resolves its own PBX user, client and lead for the same login and number');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('in-1', 1)).client_id) = pg_temp.t289_id(701),
  'organization 1 still matches its own client');

-- 6.16 Smaller rules: an unknown event type, the missed status, the group name, an empty directory.
SELECT pg_temp.t289_put('unk_type', pg_temp.t289_e('RINGING', 'unk-type-1', 'u701', '996555000999'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('unk_type')->>'status' = 'stored' AND pg_temp.t289_get('unk_type')->>'projection' = 'not_applicable'
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'unk-type-1') = 0,
  'an event of an unknown type is kept as evidence and creates no call or leg');
SELECT pg_temp.t289_h('ms-1', 'u701', '996555000999', 'in', 'missed', '20200107T230000Z', 20, 20, NULL, '{"missedStatus":"3"}');
SELECT pg_temp.t289_h('ms-2', 'u701', '996555000999', 'in', 'missed', '20200107T230100Z', 20, 20, NULL, '{"missedStatus":"9"}');
SELECT pg_temp.t289_h('ms-3', 'u701', '996555000999', 'in', 'missed', '20200107T000200Z', 20, 20, NULL, '{"group":"42","telnum_name":"T289 main line"}');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('ms-1')).pbx_missed_status) = 3 AND (SELECT (pg_temp.t289_call('ms-2')).pbx_missed_status) IS NULL
  AND (SELECT (pg_temp.t289_leg('ms-3', 'u701')).group_name) IS NULL AND (SELECT (pg_temp.t289_call('ms-3')).company_number_name) = 'T289 main line'
  AND (SELECT (pg_temp.t289_call('ms-3')).company_number) = '996312000000',
  'missedStatus 1-4 is kept as the PBX hint, 9 is ignored; a group id is not a group name; the number name and number are kept');
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t289_id(3), 'T289 Third fictional organization');
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled) VALUES (pg_temp.t289_id(3), TRUE);
SELECT pg_temp.t289_put('dir1', pg_temp.t289_e('INCOMING', 'dir-empty-1', 'u701', '996555000999', 'in', '{}', 3));
SELECT pg_temp.t289_assert(pg_temp.t289_get('dir1')->>'projection' = 'queued' AND pg_temp.t289_get('dir1')->>'work_state' = 'retry_wait'
  AND (SELECT w.last_error_code = 'etl001' FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id
    WHERE e.pbx_callid = 'dir-empty-1') AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'dir-empty-1') = 0,
  'with an empty PBX user directory nothing is projected (every call would come out missed): the work waits with code etl001');
INSERT INTO platform_private.telephony_extensions(organization_id, pbx_user, extension, pbx_display_name, membership_id)
  VALUES (pg_temp.t289_id(3), 'u701', '701', 'T289 PBX user (third organization)', NULL);
UPDATE platform_private.telephony_event_work SET next_attempt_at = clock_timestamp() - INTERVAL '1 second'
  WHERE organization_id = pg_temp.t289_id(3);
SELECT pg_temp.t289_put('dir_claim', platform.telephony_claim_work_v1(pg_temp.t289_id(3), 'owner-a', 5));
SELECT pg_temp.t289_put('dir_project', platform.telephony_project_work_v1(pg_temp.t289_id(3),
  (pg_temp.t289_get('dir_claim')->'items'->0->>'work_id')::UUID, 'owner-a'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('dir_project')->>'status' = 'succeeded'
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'dir-empty-1') = 1,
  'once the directory has a user the waiting work projects');

-- ---------------------------------------------------------------------------
-- 7. Phone matching.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_assert(
  (SELECT (m).m_state = 'matched' AND (m).m_client_id = pg_temp.t289_id(701) AND (m).m_lead_id = pg_temp.t289_id(702)
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000111') m) s),
  'matched: the E.164 spelling, one client, its one open lead');
SELECT pg_temp.t289_assert(
  (SELECT (m).m_state = 'matched' AND (m).m_client_id = pg_temp.t289_id(703) AND (m).m_lead_id = pg_temp.t289_id(704)
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000222') m) s)
  AND (SELECT (m).m_client_id = pg_temp.t289_id(711) AND (m).m_lead_id = pg_temp.t289_id(717)
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000777') m) s),
  'matched across spellings stored by other intakes: national 0… and bare nine digits');
SELECT pg_temp.t289_assert(
  (SELECT (m).m_state = 'matched' AND (m).m_lead_id = pg_temp.t289_id(713)
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000333') m) s),
  'several open leads: the most recently updated one');
SELECT pg_temp.t289_assert(
  (SELECT (m).m_state = 'matched' AND (m).m_client_id = pg_temp.t289_id(706) AND (m).m_lead_id IS NULL
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000444') m) s),
  'only a closed lead: the client matches, the lead stays empty (no lead is created)');
SELECT pg_temp.t289_assert(
  (SELECT (m).m_state = 'ambiguous' AND (m).m_client_id IS NULL AND (m).m_lead_id IS NULL
    FROM (SELECT platform_private.telephony_match_phone(pg_temp.t289_id(1), '+996555000555') m) s),
  'two clients with the number: ambiguous, no automatic link');
SELECT pg_temp.t289_assert(
  (SELECT bool_and(m.m_state = 'unmatched' AND m.m_client_id IS NULL AND m.m_lead_id IS NULL)
    FROM unnest(ARRAY['+996555000666', '+996555000888', '+996555009999', NULL, 'not a number']) v(p)
    CROSS JOIN LATERAL platform_private.telephony_match_phone(pg_temp.t289_id(1), v.p) m),
  'an inactive client, another organization''s client, an unknown number, no number and garbage are unmatched');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('grp-1')).match_state) = 'unmatched'
  AND (SELECT (pg_temp.t289_call('dup-2')).match_state) = 'matched',
  'the projection applies the matching result to the call');
-- Re-match while unsettled; frozen once settled.
SELECT pg_temp.t289_e('INCOMING', 'rem-1', 'u701', '996555000123');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('rem-1')).match_state) = 'unmatched', 'a new number starts unmatched');
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone)
  VALUES (pg_temp.t289_id(730), pg_temp.t289_id(1), 'T289 Client late', platform_private.normalize_person_name('T289 Client late'),
    '+996555000123', platform_private.normalize_person_phone('+996555000123'));
SELECT pg_temp.t289_e('ACCEPTED', 'rem-1', 'u701', '996555000123');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('rem-1')).match_state) = 'matched'
  AND (SELECT (pg_temp.t289_call('rem-1')).client_id) = pg_temp.t289_id(730) AND (SELECT (pg_temp.t289_call('rem-1')).lead_id) IS NULL,
  'a client that appears while the call is unsettled is found by the next message');
SELECT pg_temp.t289_e('INCOMING', 'rem-2', 'u701', '996555000124');
SELECT pg_temp.t289_age('rem-2', 100);
SELECT pg_temp.t289_put('rem2_settle', platform.telephony_settle_calls_v1(pg_temp.t289_id(1)));
SELECT pg_temp.t289_assert((pg_temp.t289_get('rem2_settle')->>'settled')::INTEGER >= 1 AND (SELECT (pg_temp.t289_call('rem-2')).settled_at) IS NOT NULL,
  'rem-2 settles');
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone)
  VALUES (pg_temp.t289_id(731), pg_temp.t289_id(1), 'T289 Client later', platform_private.normalize_person_name('T289 Client later'),
    '+996555000124', platform_private.normalize_person_phone('+996555000124'));
SELECT pg_temp.t289_e('COMPLETED', 'rem-2', 'u701', '996555000124');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('rem-2')).match_state) = 'unmatched',
  'a settled call keeps its matching (decisions already used it)');

-- ---------------------------------------------------------------------------
-- 8. Time: the quiet window.
-- ---------------------------------------------------------------------------
-- First settle everything that exists, so the checks below count only fresh calls.
SELECT pg_temp.t289_e('INCOMING', 'win-1', 'u701', '996555000999'), pg_temp.t289_e('CANCELLED', 'win-1', 'u701', '996555000999');
SELECT pg_temp.t289_e('INCOMING', 'win-2', 'u701', '996555000999');
SELECT pg_temp.t289_e('INCOMING', 'win-3', 'u701', '996555000999'), pg_temp.t289_e('ACCEPTED', 'win-3', 'u701', '996555000999');
SELECT pg_temp.t289_e('OUTGOING', 'win-4', 'u701', '996555000999', 'out');
SELECT pg_temp.t289_put('win_a', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('win-1')).state) = 'ended' AND (SELECT (pg_temp.t289_call('win-1')).outcome) = 'cancelled'
  AND (SELECT (pg_temp.t289_call('win-1')).settled_at) IS NULL AND (SELECT (pg_temp.t289_call('win-2')).settled_at) IS NULL
  AND (SELECT (pg_temp.t289_call('win-3')).settled_at) IS NULL,
  'nothing settles before 90 seconds of quiet, even with an ended call');
SELECT pg_temp.t289_age('win-1', 80), pg_temp.t289_age('win-2', 80), pg_temp.t289_age('win-3', 80), pg_temp.t289_age('win-4', 80);
SELECT pg_temp.t289_put('win_b', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('win-1')).settled_at) IS NULL AND (SELECT (pg_temp.t289_call('win-2')).settled_at) IS NULL
  AND (SELECT (pg_temp.t289_call('win-3')).settled_at) IS NULL AND (SELECT (pg_temp.t289_call('win-4')).settled_at) IS NULL,
  '80 seconds of quiet is not enough');
SELECT pg_temp.t289_age('win-1', 100), pg_temp.t289_age('win-2', 100), pg_temp.t289_age('win-3', 100), pg_temp.t289_age('win-4', 100);
SELECT pg_temp.t289_put('win_c', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert(pg_temp.t289_get('win_c')->>'status' = 'ok' AND (pg_temp.t289_get('win_c')->>'settled')::INTEGER >= 3
  AND (pg_temp.t289_get('win_c')->>'waiting')::INTEGER >= 1 AND pg_temp.t289_get('win_c')->>'failed' = '0',
  'after 100 seconds the calls with an outcome settle; the silent outgoing call waits');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('win-1')).settled_at) IS NOT NULL AND (SELECT (pg_temp.t289_call('win-1')).outcome) = 'cancelled'
  AND (SELECT (pg_temp.t289_call('win-2')).settled_at) IS NOT NULL AND (SELECT (pg_temp.t289_call('win-2')).outcome) = 'missed'
  AND (SELECT (pg_temp.t289_call('win-2')).state) = 'ended' AND (SELECT (pg_temp.t289_call('win-2')).ended_at) IS NOT NULL
  AND (SELECT (pg_temp.t289_leg('win-2', 'u701')).state) = 'missed' AND (SELECT (pg_temp.t289_leg('win-2', 'u701')).ended_at) IS NOT NULL
  AND (SELECT (pg_temp.t289_call('win-2')).outcome_source) = 'webhook',
  'a silent incoming call is missed and its open leg is closed as missed');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('win-3')).settled_at) IS NOT NULL AND (SELECT (pg_temp.t289_call('win-3')).state) = 'answered'
  AND (SELECT (pg_temp.t289_call('win-3')).outcome) = 'answered' AND (SELECT (pg_temp.t289_leg('win-3', 'u701')).state) = 'accepted',
  'an answered call settles with its leg still open (talking): state stays answered');
SELECT pg_temp.t289_assert((SELECT (pg_temp.t289_call('win-4')).settled_at) IS NULL AND (SELECT (pg_temp.t289_call('win-4')).outcome) IS NULL
  AND NOT (SELECT (pg_temp.t289_call('win-4')).needs_review),
  'a silent outgoing call has no invented outcome and waits for the reconciliation');
SELECT pg_temp.t289_put('win_d', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert((pg_temp.t289_get('win_d')->>'settled')::INTEGER = 0,
  'a second tick settles nothing new');
SELECT pg_temp.t289_age('win-4', 3700);
SELECT pg_temp.t289_put('win_e', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert(pg_temp.t289_get('win_e')->>'flagged' = '1'
  AND (SELECT (pg_temp.t289_call('win-4')).settled_at) IS NOT NULL AND (SELECT (pg_temp.t289_call('win-4')).needs_review)
  AND (SELECT (pg_temp.t289_call('win-4')).outcome) IS NULL,
  'after an hour of silence an unresolved outgoing call is settled with needs_review (no outcome, no decisions)');
-- The limit and the organization scope.
SELECT pg_temp.t289_e('INCOMING', 'lim-1', 'u701', '996555000999'), pg_temp.t289_e('INCOMING', 'lim-2', 'u701', '996555000999'),
  pg_temp.t289_e('INCOMING', 'lim-3', 'u701', '996555000999');
SELECT pg_temp.t289_age('lim-1', 400), pg_temp.t289_age('lim-2', 300), pg_temp.t289_age('lim-3', 200);
SELECT pg_temp.t289_put('lim_a', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 2));
SELECT pg_temp.t289_assert((pg_temp.t289_get('lim_a')->>'settled')::INTEGER = 2
  AND (SELECT (pg_temp.t289_call('lim-1')).settled_at) IS NOT NULL AND (SELECT (pg_temp.t289_call('lim-2')).settled_at) IS NOT NULL
  AND (SELECT (pg_temp.t289_call('lim-3')).settled_at) IS NULL,
  'the limit is honoured, oldest first');
SELECT pg_temp.t289_put('lim_b', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 2));
SELECT pg_temp.t289_assert((pg_temp.t289_get('lim_b')->>'settled')::INTEGER = 1 AND (SELECT (pg_temp.t289_call('lim-3')).settled_at) IS NOT NULL,
  'the next tick takes the rest');
SELECT pg_temp.t289_age('iso-2', 500, 2);
SELECT pg_temp.t289_put('iso_settle', platform.telephony_settle_calls_v1(pg_temp.t289_id(2), 100));
SELECT pg_temp.t289_assert((pg_temp.t289_get('iso_settle')->>'settled')::INTEGER = 1 AND (SELECT (pg_temp.t289_call('iso-2', 2)).settled_at) IS NOT NULL,
  'the tick settles only the organization it is called for');
SELECT pg_temp.t289_assert(pg_temp.t289_state(format('SELECT platform.telephony_settle_calls_v1(%L, 0)', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_settle_calls_v1(%L, 1001)', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state('SELECT platform.telephony_settle_calls_v1(NULL)') = '22023',
  'settle refuses a bad limit or organization with 22023');
-- A transfer target that never speaks is flagged after an hour, with no invented outcome.
SELECT pg_temp.t289_e('TRANSFERRED', 'ph-1', 'u701', '996555000999', 'in', '{"second_callid":"ph-2"}');
SELECT pg_temp.t289_age('ph-1', 3700), pg_temp.t289_age('ph-2', 3700);
SELECT pg_temp.t289_put('ph_settle', platform.telephony_settle_calls_v1(pg_temp.t289_id(1), 1000));
SELECT pg_temp.t289_assert((pg_temp.t289_get('ph_settle')->>'flagged')::INTEGER >= 1
  AND (SELECT (pg_temp.t289_call('ph-2')).needs_review) AND (SELECT (pg_temp.t289_call('ph-2')).outcome) IS NULL
  AND (SELECT (pg_temp.t289_call('ph-2')).settled_at) IS NOT NULL,
  'a transfer target that never speaks is flagged, not settled with an invented outcome');

-- ---------------------------------------------------------------------------
-- 9. The queue: failures keep the evidence, the leg and the link.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t289_fault_call() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.pbx_callid LIKE 'fault-%' THEN
    RAISE EXCEPTION 'T289 secret detail 996555000111 https://records.example.invalid/t289-fault-link.mp3' USING ERRCODE = 'XX001',
      DETAIL = 'Failing row contains (996555000111, https://records.example.invalid/t289-fault-link.mp3)';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER t289_fault_call BEFORE INSERT ON platform_private.telephony_calls
  FOR EACH ROW EXECUTE FUNCTION pg_temp.t289_fault_call();
-- Intake with a failing projection: evidence stays, the answer is ordinary, the work retries.
SELECT pg_temp.t289_put('f1', pg_temp.t289_h('fault-1', 'u701', '996555000111', 'in', 'Success', '20200107T210000Z', 30, 3,
  'https://records.example.invalid/t289-fault-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('f1')->>'status' = 'stored' AND pg_temp.t289_get('f1')->>'projection' = 'queued'
  AND pg_temp.t289_get('f1')->>'work_state' = 'retry_wait' AND pg_temp.t289_get('f1')::TEXT NOT LIKE '%996555000111%'
  AND pg_temp.t289_get('f1')::TEXT NOT LIKE '%t289-fault%' AND pg_temp.t289_get('f1')::TEXT NOT LIKE '%secret%',
  'a failing projection is answered "stored / queued / retry_wait", carrying no message or value');
SELECT pg_temp.t289_assert((SELECT w.state = 'retry_wait' AND w.attempt_count = 1 AND w.last_error_code = 'exx001'
      AND w.next_attempt_at > clock_timestamp() + INTERVAL '50 seconds' AND w.next_attempt_at <= clock_timestamp() + INTERVAL '61 seconds'
      AND w.has_link AND w.lease_owner IS NULL AND w.completed_at IS NULL
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'fault-1')
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'fault-1') = 0
  AND pg_temp.t289_leak('t289-fault-link') = '',
  'work is retry_wait, attempt 1, a code of the SQLSTATE only (exx001), due in 60 s; the failed call insert left no row and no link text');
SELECT pg_temp.t289_put('f_claim0', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_assert(pg_temp.t289_get('f_claim0')->'items' = '[]'::JSONB, 'nothing is claimed before the backoff has passed');
UPDATE platform_private.telephony_event_work SET next_attempt_at = clock_timestamp() - INTERVAL '1 second' WHERE state = 'retry_wait';
SELECT pg_temp.t289_put('f_claim1', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_assert(jsonb_array_length(pg_temp.t289_get('f_claim1')->'items') = 1 AND pg_temp.t289_get('f_claim1')->'items'->0->>'attempt' = '2'
  AND (SELECT w.state = 'leased' AND w.lease_owner = 'owner-a' AND w.attempt_count = 2
      AND w.lease_expires_at > clock_timestamp() + INTERVAL '100 seconds'
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'fault-1'),
  'a due retry is leased: attempt 2, owner, 120-second lease');
SELECT pg_temp.t289_put('f_other', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('f_claim1')->'items'->0->>'work_id')::UUID, 'owner-b')),
  pg_temp.t289_put('f_unknown', platform.telephony_project_work_v1(pg_temp.t289_id(1), pg_temp.t289_id(9), 'owner-a'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('f_other')->>'status' = 'lease_lost' AND pg_temp.t289_get('f_unknown')->>'status' = 'not_found'
  AND (SELECT state FROM platform_private.telephony_event_work WHERE id = (pg_temp.t289_get('f_claim1')->'items'->0->>'work_id')::UUID) = 'leased',
  'another owner cannot project a leased item (lease_lost, no change); an unknown id is not_found');
SELECT pg_temp.t289_put('f_fail2', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('f_claim1')->'items'->0->>'work_id')::UUID, 'owner-a'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('f_fail2')->>'status' = 'retry_wait' AND pg_temp.t289_get('f_fail2')->>'error_code' = 'exx001'
  AND pg_temp.t289_get('f_fail2')->>'attempt' = '2' AND pg_temp.t289_get('f_fail2')::TEXT NOT LIKE '%996555000111%'
  AND (SELECT w.state = 'retry_wait' AND w.attempt_count = 2 AND w.lease_owner IS NULL AND w.lease_expires_at IS NULL
      AND w.next_attempt_at > clock_timestamp() + INTERVAL '110 seconds' AND w.next_attempt_at <= clock_timestamp() + INTERVAL '121 seconds'
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'fault-1'),
  'a second failure: retry_wait, attempt 2, backoff 120 s');
DROP TRIGGER t289_fault_call ON platform_private.telephony_calls;
UPDATE platform_private.telephony_event_work SET next_attempt_at = clock_timestamp() - INTERVAL '1 second' WHERE state = 'retry_wait';
SELECT pg_temp.t289_put('f_claim2', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_put('f_ok', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('f_claim2')->'items'->0->>'work_id')::UUID, 'owner-a'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('f_ok')->>'status' = 'succeeded' AND pg_temp.t289_get('f_ok')->>'projection' = 'projected'
  AND (SELECT w.state = 'succeeded' AND w.completed_at IS NOT NULL AND w.last_error_code IS NULL AND w.lease_owner IS NULL
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'fault-1')
  AND (SELECT (pg_temp.t289_call('fault-1')).outcome) = 'answered' AND pg_temp.t289_legs('fault-1') = 1
  AND (SELECT (pg_temp.t289_leg('fault-1', 'u701')).recording_state) = 'none',
  'once the cause is gone the retry succeeds; the link of the first attempt was not kept (no leg could be placed), reconciliation restores it');
-- Leases: expiry, reclaim, exhaustion.
SELECT pg_temp.t289_e('INCOMING', 'lease-1', 'u701', '996555000999');
UPDATE platform_private.telephony_event_work SET state = 'retry_wait', attempt_count = 1, last_error_code = 'exx001',
  next_attempt_at = clock_timestamp() - INTERVAL '1 second', completed_at = NULL
  WHERE event_id = (SELECT id FROM platform_private.telephony_pbx_events WHERE pbx_callid = 'lease-1');
SELECT pg_temp.t289_put('l_claim1', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 1));
UPDATE platform_private.telephony_event_work SET lease_expires_at = clock_timestamp() - INTERVAL '1 second' WHERE state = 'leased';
SELECT pg_temp.t289_put('l_claim2', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-b', 1));
SELECT pg_temp.t289_put('l_late', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('l_claim1')->'items'->0->>'work_id')::UUID, 'owner-a'));
SELECT pg_temp.t289_put('l_done', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('l_claim2')->'items'->0->>'work_id')::UUID, 'owner-b'));
SELECT pg_temp.t289_assert(jsonb_array_length(pg_temp.t289_get('l_claim2')->'items') = 1 AND pg_temp.t289_get('l_claim2')->'items'->0->>'attempt' = '3'
  AND pg_temp.t289_get('l_claim1')->'items'->0->>'work_id' = pg_temp.t289_get('l_claim2')->'items'->0->>'work_id'
  AND pg_temp.t289_get('l_late')->>'status' = 'lease_lost' AND pg_temp.t289_get('l_done')->>'status' = 'succeeded',
  'an expired lease is reclaimed by another owner (attempt 3); the first owner has lost it');
SELECT pg_temp.t289_e('INCOMING', 'lease-2', 'u701', '996555000999');
UPDATE platform_private.telephony_event_work w SET state = 'leased', lease_owner = 'owner-a', attempt_count = max_attempts,
  lease_expires_at = clock_timestamp() - INTERVAL '1 second', completed_at = NULL, last_error_code = NULL
  FROM platform_private.telephony_pbx_events e WHERE e.id = w.event_id AND e.pbx_callid = 'lease-2';
SELECT pg_temp.t289_put('l_claim3', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-c', 50));
SELECT pg_temp.t289_assert(pg_temp.t289_get('l_claim3')->'items' = '[]'::JSONB
  AND (SELECT w.state = 'dead_lettered' AND w.last_error_code = 'lease_expired' AND w.completed_at IS NOT NULL AND w.lease_owner IS NULL
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'lease-2'),
  'an expired lease with the attempts used up is a dead letter (lease_expired)');
-- Dead letter after max_attempts, and the limit of the claim.
CREATE TRIGGER t289_fault_call BEFORE INSERT ON platform_private.telephony_calls
  FOR EACH ROW EXECUTE FUNCTION pg_temp.t289_fault_call();
SELECT pg_temp.t289_e('INCOMING', 'fault-2', 'u701', '996555000999'), pg_temp.t289_e('INCOMING', 'fault-3', 'u701', '996555000999'),
  pg_temp.t289_e('INCOMING', 'fault-4', 'u701', '996555000999');
UPDATE platform_private.telephony_event_work w SET max_attempts = 2, next_attempt_at = clock_timestamp() - INTERVAL '3 seconds'
  FROM platform_private.telephony_pbx_events e WHERE e.id = w.event_id AND e.pbx_callid = 'fault-2';
UPDATE platform_private.telephony_event_work w SET next_attempt_at = clock_timestamp() - INTERVAL '2 seconds'
  FROM platform_private.telephony_pbx_events e WHERE e.id = w.event_id AND e.pbx_callid IN ('fault-3', 'fault-4');
SELECT pg_temp.t289_put('d_claim1', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 1));
SELECT pg_temp.t289_assert(jsonb_array_length(pg_temp.t289_get('d_claim1')->'items') = 1
  AND (SELECT count(*) FROM platform_private.telephony_event_work WHERE state = 'leased') = 1,
  'the claim limit is honoured');
SELECT pg_temp.t289_put('d_fail1', platform.telephony_project_work_v1(pg_temp.t289_id(1), (pg_temp.t289_get('d_claim1')->'items'->0->>'work_id')::UUID, 'owner-a'));
UPDATE platform_private.telephony_event_work SET next_attempt_at = clock_timestamp() - INTERVAL '1 second' WHERE state = 'retry_wait';
SELECT pg_temp.t289_put('d_claim2', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_put('d_fail2', (SELECT jsonb_agg(platform.telephony_project_work_v1(pg_temp.t289_id(1), (i->>'work_id')::UUID, 'owner-a'))
  FROM jsonb_array_elements(pg_temp.t289_get('d_claim2')->'items') i));
SELECT pg_temp.t289_assert((SELECT bool_and(i->>'status' IN ('retry_wait', 'dead_lettered')) FROM jsonb_array_elements(pg_temp.t289_get('d_fail2')) i)
  AND (SELECT w.state = 'dead_lettered' AND w.attempt_count = 2 AND w.max_attempts = 2 AND w.last_error_code = 'exx001'
      AND w.completed_at IS NOT NULL AND w.lease_owner IS NULL
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'fault-2'),
  'after max_attempts failures the item is a dead letter with its code');
SELECT pg_temp.t289_put('d_claim3', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.t289_get('d_claim3')->'items') i
    WHERE (i->>'work_id')::UUID = (SELECT w.id FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id
      WHERE e.pbx_callid = 'fault-2')),
  'a dead letter is never claimed again');
DROP TRIGGER t289_fault_call ON platform_private.telephony_calls;
SELECT pg_temp.t289_assert(pg_temp.t289_state(format('SELECT platform.telephony_claim_work_v1(%L, '''')', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_claim_work_v1(%L, ''o'', 0)', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_claim_work_v1(%L, ''o'', 101)', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_claim_work_v1(%L, ''o'', 5, 5)', pg_temp.t289_id(1))) = '22023'
  AND pg_temp.t289_state('SELECT platform.telephony_claim_work_v1(NULL, ''o'')') = '22023'
  AND pg_temp.t289_state(format('SELECT platform.telephony_project_work_v1(%L, NULL, ''o'')', pg_temp.t289_id(1))) = '22023',
  'claim and project refuse bad arguments with 22023');

-- 9b. The writer's error capture (PLAN_CHANGES T1a, point 13): a NOT NULL, a CHECK
-- and a UNIQUE violation inside the leg writer, with a link and a phone in play.
CREATE FUNCTION pg_temp.t289_fault_leg() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE other RECORD;
BEGIN
  IF NEW.pbx_user = 'inj_nn' THEN
    NEW.leg_started_at := NULL;
  ELSIF NEW.pbx_user = 'inj_ck' AND NEW.recording_link IS NOT NULL THEN
    NEW.recording_state := 'none';
  ELSIF NEW.pbx_user = 'inj_uq' THEN
    SELECT l.pbx_user AS u, l.leg_started_at AS t INTO other FROM platform_private.telephony_call_legs l
    WHERE l.call_id = NEW.call_id AND l.id <> NEW.id LIMIT 1;
    IF FOUND THEN NEW.pbx_user := other.u; NEW.leg_started_at := other.t; END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER t289_fault_leg BEFORE INSERT ON platform_private.telephony_call_legs
  FOR EACH ROW EXECUTE FUNCTION pg_temp.t289_fault_leg();
SELECT pg_temp.t289_put('cap1', pg_temp.t289_h('cap-1', 'inj_nn', '996555000321', 'in', 'Success', '20200107T220000Z', 30, 3, 'https://records.example.invalid/t289-cap1-link.mp3')),
  pg_temp.t289_put('cap2', pg_temp.t289_h('cap-2', 'inj_ck', '996555000322', 'in', 'Success', '20200107T220100Z', 30, 3, 'https://records.example.invalid/t289-cap2-link.mp3')),
  pg_temp.t289_put('cap3a', pg_temp.t289_h('cap-3', 'u701', '996555000323', 'in', 'missed', '20200107T220200Z', 30, 3)),
  pg_temp.t289_put('cap3', pg_temp.t289_h('cap-3', 'inj_uq', '996555000323', 'in', 'Success', '20200107T220300Z', 30, 3, 'https://records.example.invalid/t289-cap3-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('cap1')->>'work_state' = 'retry_wait' AND pg_temp.t289_get('cap2')->>'work_state' = 'retry_wait'
  AND pg_temp.t289_get('cap3')->>'work_state' = 'retry_wait' AND pg_temp.t289_get('cap3a')->>'work_state' = 'succeeded'
  AND pg_temp.t289_get('cap1')::TEXT || pg_temp.t289_get('cap2')::TEXT || pg_temp.t289_get('cap3')::TEXT NOT LIKE '%996555000%'
  AND pg_temp.t289_get('cap1')::TEXT || pg_temp.t289_get('cap2')::TEXT || pg_temp.t289_get('cap3')::TEXT NOT LIKE '%records%',
  'each injected violation leaves the answer ordinary (stored, retry_wait) and free of the number and the link');
SELECT pg_temp.t289_assert(
  (SELECT w.state = 'retry_wait' AND w.attempt_count = 1 AND w.has_link AND w.completed_at IS NULL
      AND w.last_error_code = 'e23502_leg_started_at'
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'cap-1')
  AND (SELECT w.last_error_code = 'e23514_telephony_call_legs_recording_check'
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id WHERE e.pbx_callid = 'cap-2')
  AND (SELECT w.last_error_code = 'e23505_telephony_call_legs_key'
    FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id
    WHERE e.pbx_callid = 'cap-3' AND e.fields->>'user' = 'inj_uq')
  AND (SELECT bool_and(w.last_error_code ~ '^[a-z][a-z0-9_]{0,63}$') FROM platform_private.telephony_event_work w
    WHERE w.last_error_code LIKE 'e235%'),
  'NOT NULL, CHECK and UNIQUE violations in the leg writer are stored as SQLSTATE plus column or constraint name only');
SELECT pg_temp.t289_assert(pg_temp.t289_leak('t289-cap1-link') = '' AND pg_temp.t289_leak('t289-cap2-link') = ''
  AND pg_temp.t289_leak('t289-cap3-link') = ''
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_event_work w
    WHERE w.last_error_code LIKE '%996555000%' OR w.last_error_code LIKE '%records%' OR w.last_error_code LIKE '%http%')
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE pbx_callid IN ('cap-1', 'cap-2')) = 2
  AND (SELECT count(*) FROM platform_private.telephony_call_legs l JOIN platform_private.telephony_calls c ON c.id = l.call_id
    WHERE c.pbx_callid IN ('cap-1', 'cap-2') AND l.pbx_user IN ('inj_nn', 'inj_ck')) = 0,
  'neither the link nor the number is in any stored error; the evidence of each failed message stays and no half-written leg is left');
DROP TRIGGER t289_fault_leg ON platform_private.telephony_call_legs;
SELECT pg_temp.t289_put('cap4', pg_temp.t289_h('cap-4', 'u701', '996555000324', 'in', 'Success', '20200107T220400Z', 30, 3,
  'https://records.example.invalid/t289-cap4-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('cap4')->>'projection' = 'projected' AND pg_temp.t289_leak('t289-cap4-link') = 'telephony_call_legs',
  'with the injection gone, the same shape of message projects and the link lands in the leg only');

-- 9c. A failure after the leg exists: the leg and its link stay (plan 5.2).
CREATE FUNCTION pg_temp.t289_fault_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'history' AND EXISTS (SELECT 1 FROM platform_private.telephony_calls c
    WHERE c.id = NEW.call_id AND c.pbx_callid = 'keep-1') THEN
    RAISE EXCEPTION 'T289 chronology fault 996555000325' USING ERRCODE = 'XX002';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER t289_fault_event BEFORE INSERT ON platform_private.telephony_call_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.t289_fault_event();
SELECT pg_temp.t289_put('keep1', pg_temp.t289_h('keep-1', 'u701', '996555000325', 'in', 'Success', '20200107T230000Z', 30, 3,
  'https://records.example.invalid/t289-keep-link.mp3'));
SELECT pg_temp.t289_assert(pg_temp.t289_get('keep1')->>'projection' = 'queued' AND pg_temp.t289_get('keep1')->>'work_state' = 'retry_wait'
  AND (SELECT l.recording_link = 'https://records.example.invalid/t289-keep-link.mp3' AND l.recording_state = 'available'
    FROM (SELECT (pg_temp.t289_leg('keep-1', 'u701')).*) l)
  AND pg_temp.t289_leak('t289-keep-link') = 'telephony_call_legs'
  AND (SELECT w.last_error_code FROM platform_private.telephony_event_work w JOIN platform_private.telephony_pbx_events e ON e.id = w.event_id
    WHERE e.pbx_callid = 'keep-1') = 'exx002'
  AND pg_temp.t289_events('keep-1') = 0,
  'a failure after the leg exists: the leg and its link stay, the chronology of the message is rolled back, the work retries');
DROP TRIGGER t289_fault_event ON platform_private.telephony_call_events;
UPDATE platform_private.telephony_event_work w SET next_attempt_at = clock_timestamp() - INTERVAL '1 second'
  FROM platform_private.telephony_pbx_events e WHERE e.id = w.event_id AND e.pbx_callid = 'keep-1';
SELECT pg_temp.t289_put('k_claim', platform.telephony_claim_work_v1(pg_temp.t289_id(1), 'owner-a', 50));
SELECT pg_temp.t289_put('k_project', (SELECT jsonb_agg(platform.telephony_project_work_v1(pg_temp.t289_id(1), (i->>'work_id')::UUID, 'owner-a'))
  FROM jsonb_array_elements(pg_temp.t289_get('k_claim')->'items') i));
SELECT pg_temp.t289_assert((SELECT bool_and(i->>'status' = 'succeeded') FROM jsonb_array_elements(pg_temp.t289_get('k_project')) i)
  AND pg_temp.t289_legs('keep-1') = 1 AND pg_temp.t289_events('keep-1') = 1 AND (SELECT (pg_temp.t289_call('keep-1')).outcome) = 'answered'
  AND (SELECT (pg_temp.t289_leg('keep-1', 'u701')).recording_state) = 'available',
  'the retry completes the projection onto the same leg (no duplicate) and the link is still there');

-- ---------------------------------------------------------------------------
-- 10. The real service role path (grants, not only the claim).
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_assert(pg_temp.t289_as('service_role', '{"role":"service_role"}', format(
    'SELECT platform.telephony_receive_v1(%L, gen_random_uuid(), ''event'', ''current'', %L, ''{"type":"INCOMING","callid":"svc-1","user":"u701","phone":"996555000111","direction":"in"}'', NULL, NULL)',
    pg_temp.t289_id(1), pg_temp.t289_hex())) = 'ok'
  AND pg_temp.t289_as('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_claim_work_v1(%L, ''svc'')', pg_temp.t289_id(1))) = 'ok'
  AND pg_temp.t289_as('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_settle_calls_v1(%L)', pg_temp.t289_id(1))) = 'ok'
  AND pg_temp.t289_as('service_role', '{"role":"service_role"}', format('SELECT platform.telephony_project_work_v1(%L, %L, ''svc'')', pg_temp.t289_id(1), pg_temp.t289_id(9))) = 'ok',
  'through the database role service_role with the service claim all four public functions work');
SELECT pg_temp.t289_assert((SELECT count(*) FROM platform_private.telephony_calls WHERE pbx_callid = 'svc-1') = 1,
  'the intake through the service role created its call');

-- ---------------------------------------------------------------------------
-- 11. Final posture: no secret anywhere, nothing but the white list in evidence,
-- the append-only guards still hold.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t289_assert(pg_temp.t289_leak('t289-token-should-never-persist') = '' AND pg_temp.t289_leak('crm_token') = ''
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_call_legs WHERE recording_link IS NOT NULL AND recording_link NOT LIKE 'https://records.example.invalid/%')
  AND (SELECT count(*) FROM platform_private.telephony_call_legs WHERE recording_link IS NOT NULL) >= 2,
  'no token anywhere; every stored link is in a leg');
SELECT pg_temp.t289_assert(NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events e WHERE e.fields IS NOT NULL AND e.fields::TEXT ~* '(://|\.mp3)')
  AND NOT EXISTS (SELECT 1 FROM platform_private.telephony_pbx_events e WHERE e.form_shape IS NOT NULL AND e.form_shape::TEXT ~* '(://|\.mp3|@)'),
  'no stored evidence field or form shape holds a link');
SELECT pg_temp.t289_assert(pg_temp.t289_state('UPDATE platform_private.telephony_pbx_events SET cmd = cmd') = '55000'
  AND pg_temp.t289_state('DELETE FROM platform_private.telephony_call_events') = '55000'
  AND pg_temp.t289_state('TRUNCATE platform_private.telephony_call_events') = '55000',
  'the append-only guards of T1a still hold after the new writers');
SELECT pg_temp.t289_assert((SELECT count(*) FROM platform_private.telephony_pbx_events WHERE validation_state = 'rejected') >= 5
  AND (SELECT count(*) FROM platform_private.telephony_pbx_events WHERE validation_state = 'incomplete') >= 5
  AND (SELECT count(*) FROM platform_private.telephony_calls WHERE state = 'ended') >= 10,
  'sanity: the suite exercised rejected, incomplete and ended rows');

\echo T289_TELEPHONY_INGEST_SUITE_END
SELECT 'T289_TELEPHONY_INGEST_SUITE_PASSED' AS t289_suite_marker;
ROLLBACK;
