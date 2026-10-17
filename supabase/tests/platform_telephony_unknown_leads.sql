\set ON_ERROR_STOP on
-- Boundary suite for migration 300 «Телефония Beeline KG» срез T9 (неизвестный входящий номер →
-- клиент и лид «Звонок», известный клиент без открытого лида → задача последнему владельцу,
-- потолки автоматики, очередь «Заявок» v3 с вкладкой «Звонки»;
-- docs/EVO_TELEPHONY_PLAN_2026-10-16.md §6.1, §6.2, §9.1, §9.3, §12, §18.2; ADR 0033). Runs on
-- the real chain right after 300 inside one transaction that is rolled back, with its own
-- synthetic organizations, members (roles through the REAL platform.staff_role_command /
-- staff_role_publish / staff_role_assignments_save), clients, leads and calls: no provider, no
-- real person, no real phone, no production action. The tick is called through the same
-- request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. catalog and grants: platform holds the full catalog of public telephony functions (the
--     twenty-five earlier ones, among them the four dial functions of T7 and the missed-call tick
--     of T8, and the new tick); the tick
--     is SECURITY DEFINER with an empty search_path and EXECUTE for service_role only; every
--     private helper is closed to PUBLIC and every client role; anon, authenticated,
--     supabase_auth_admin, the AI agent role and a service_role without the service claim are
--     refused (42501); argument errors (22023); the queue v3 is STABLE, definer, EXECUTE for
--     authenticated only, and v2 and v1 are still there;
--  2. schema: the intake mark pair, its closed list and the new task-link kind;
--  3. the switches: no settings row, projection off, the unknown-lead flag off -> nothing is
--     read or written;
--  4. an unknown inbound number (answered or missed) becomes a client («Звонок» + mask, never
--     the number) and a lead (phone_call, stage new, no owner, channel «не известно», no touch)
--     with provenance; repeated calls of the same number in one tick and a client that appeared
--     in the meantime attach to the existing lead instead of making a new one; an anonymous
--     caller, an outbound call, an ambiguous number, a call without an outcome, a reconciled
--     duplicate, a call older than two hours (webhook or reconcile), an unsettled call and an
--     imported one create nothing; a webhook call with needs_review is a real call; one
--     decision per call (a second tick changes nothing) and a callid bound to one external
--     identity;
--  5. a known client without an open lead: an answered inbound call gives ONE task (through the
--     missed-call slice's own helpers, a link of the new kind) to the last lead owner (archived or
--     converted leads count), falling back to the escalation recipient, then to an Admin, due in
--     working minutes; a missed call is left to the missed-call slice; one open task per client
--     and a task of the other slice counts; nothing for a client with an open lead; nobody to
--     give it to is skipped without an error;
--  6. ceilings: the hourly and the daily lead ceiling and the task ceiling (own tasks plus the
--     other slice's links) stop both flags, raise the settings version, light the stop state and
--     the journal event, and leave the call unmarked; attaching to a lead does not count;
--  7. failure and isolation: a failing call costs only itself and leaves only a coded error;
--     another organization is untouched; no number, link or name in any task, event or journal
--     row made by the intake;
--  8. the queue v3: equal to v2 for the earlier sources, the «Звонки» tab only with telephony
--     ui_enabled (no rows, no number, no manual phone_call lead before), counts, waiting and
--     «take», paging with cursor version 3 (a v2 cursor is refused), roles without lead.read
--     see no calls, students and strangers are refused, another organization never leaks;
--  9. the hand-off to the missed-call slice: a missed unknown call gets exactly one «Перезвонить»
--     task for the escalation recipient on the created lead, when the intake runs first.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

DO $t300_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t300_auth_role$;

\echo T300_TELEPHONY_UNKNOWN_LEADS_SUITE_START

CREATE FUNCTION pg_temp.t300_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('30010000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t300_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T300: %', message; END IF;
END
$$;
-- The statement as a role with the given JWT claims; SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.t300_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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
-- The JSONB result of a statement run as the role with the claims, or {"error": ...}.
CREATE FUNCTION pg_temp.t300_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.t300_try(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'T300 rollback' USING ERRCODE = 'PT999';
  EXCEPTION WHEN SQLSTATE 'PT999' THEN
    RETURN 'ok';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$$;

-- The service path: the JWT role claim the public function checks.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 (the one under test), 2 (another tenant), 3 (nobody to give a task
-- to), 4 and 5 (lead ceilings), 6 (task ceiling), 7 (suspended: a call that fails).
--   actor 1  org 1 Admin A (system admin, created first)
--   actor 2  org 1 Admin B (system admin)
--   actor 3  org 1 sales S1 — the task role (staff.task.read / complete)
--   actor 4  org 1 sales S2 — the task role
--   actor 5  org 1 member with ONLY staff.task.complete (cannot receive a task: no read)
--   actor 6  org 1 head — the task role; the escalation recipient
--   actor 7  org 2 Admin
--   actor 8  org 1 suspended member (lead owner who cannot work any more)
--   actor 9  org 4 Admin, actor 10 org 5 Admin, actor 12 org 6 Admin
--   actor 11 org 1 Student
--   actor 13 org 1 invited member with no role at all (reads nothing)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t300_actors(n INTEGER PRIMARY KEY, org INTEGER, sysadmin BOOLEAN, status TEXT, coarse TEXT);
INSERT INTO t300_actors VALUES (1, 1, TRUE, 'active', 'admin'), (2, 1, TRUE, 'active', 'admin'), (3, 1, FALSE, 'active', NULL),
  (4, 1, FALSE, 'active', NULL), (5, 1, FALSE, 'active', NULL), (6, 1, FALSE, 'active', NULL), (7, 2, TRUE, 'active', 'admin'),
  (8, 1, FALSE, 'suspended', NULL), (9, 4, TRUE, 'active', 'admin'), (10, 5, TRUE, 'active', 'admin'),
  (11, 1, FALSE, 'active', 'student'), (12, 6, TRUE, 'active', 'admin'), (13, 1, FALSE, 'active', NULL);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.t300_id(1), 'T300 Fictional organization', 'active'),
  (pg_temp.t300_id(2), 'T300 Other fictional organization', 'active'),
  (pg_temp.t300_id(3), 'T300 Organization without staff', 'active'),
  (pg_temp.t300_id(4), 'T300 Ceiling organization (leads, hour)', 'active'),
  (pg_temp.t300_id(5), 'T300 Ceiling organization (leads, day)', 'active'),
  (pg_temp.t300_id(6), 'T300 Ceiling organization (tasks)', 'active'),
  (pg_temp.t300_id(7), 'T300 Suspended organization', 'suspended');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t300_id(100 + n), 't300-' || n || '@example.invalid', '{}'::JSONB FROM t300_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t300_id(200 + n), pg_temp.t300_id(100 + n), 'T300 Actor ' || n, 'active', 1 FROM t300_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id,
  created_at)
  SELECT pg_temp.t300_id(300 + a.n), pg_temp.t300_id(a.org), pg_temp.t300_id(200 + a.n), a.status::platform.membership_status,
    a.coarse::platform.business_role,
    CASE WHEN a.coarse IS NOT NULL THEN (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse::platform.business_role AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 10:00:00+00' + make_interval(mins => a.n)
  FROM t300_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.t300_id(300 + n) FROM t300_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.t300_id(401), pg_temp.t300_id(1), 'organization', pg_temp.t300_id(1), 1),
  (pg_temp.t300_id(402), pg_temp.t300_id(2), 'organization', pg_temp.t300_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.t300_id(1), pg_temp.t300_id(301), pg_temp.t300_id(401), 1, 1, TRUE, 'system', 'T300 synthetic scope', pg_temp.t300_id(601)),
  (pg_temp.t300_id(2), pg_temp.t300_id(307), pg_temp.t300_id(402), 1, 1, TRUE, 'system', 'T300 synthetic scope', pg_temp.t300_id(602));

CREATE FUNCTION pg_temp.t300_claims(p_actor INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t300_id(100 + p_actor),
    'claims', jsonb_build_object('sub', pg_temp.t300_id(100 + p_actor), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
SELECT pg_temp.t300_claims(1) AS t300_admin_setup \gset

-- The task roles: created and published by the Admin through the real RPCs.
SELECT pg_temp.t300_assert(
  pg_temp.t300_call('authenticated', :'t300_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T300 create role', %L::UUID)$q$,
    pg_temp.t300_id(1), pg_temp.t300_id(1101),
    jsonb_build_object('label', 'T300 task access', 'description', 'T300 synthetic staff.task role',
      'permissionKeys', '["staff.task.read","staff.task.complete"]'::JSONB),
    pg_temp.t300_id(1111))) ->> 'status' = 'applied'
  AND pg_temp.t300_call('authenticated', :'t300_admin_setup', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'T300 create role', %L::UUID)$q$,
    pg_temp.t300_id(1), pg_temp.t300_id(1102),
    jsonb_build_object('label', 'T300 complete only', 'description', 'T300 synthetic role without read',
      'permissionKeys', '["staff.task.complete"]'::JSONB),
    pg_temp.t300_id(1113))) ->> 'status' = 'applied',
  'the Admin creates the task roles (read and complete, complete only) through the real RPC');
SELECT pg_temp.t300_call('authenticated', :'t300_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T300 publish role', %L::UUID)$q$,
    pg_temp.t300_id(1), pg_temp.t300_id(1101), pg_temp.t300_id(1), pg_temp.t300_id(1101), pg_temp.t300_id(1112))) ->> 'status' AS t300_published \gset
SELECT pg_temp.t300_call('authenticated', :'t300_admin_setup', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'T300 publish role', %L::UUID)$q$,
    pg_temp.t300_id(1), pg_temp.t300_id(1102), pg_temp.t300_id(1), pg_temp.t300_id(1102), pg_temp.t300_id(1115))) ->> 'status' AS t300_published2 \gset
SELECT pg_temp.t300_assert(:'t300_published' = 'applied' AND :'t300_published2' = 'applied', 'the Admin publishes the task roles');

CREATE FUNCTION pg_temp.t300_assign(p_actor INTEGER, p_req INTEGER, p_role INTEGER DEFAULT 1101) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE items JSONB; bindings JSONB; v_version BIGINT;
BEGIN
  SELECT p.access_version INTO v_version FROM platform.profiles p WHERE p.id = pg_temp.t300_id(200 + p_actor);
  SELECT jsonb_build_array(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', 'organization',
      'key', pg_temp.t300_id(1), 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version))
  INTO items, bindings
  FROM platform.staff_role_definitions r
  JOIN platform.staff_role_bundle_bindings b ON b.organization_id = r.organization_id AND b.role_id = r.id
    AND b.bundle_id = r.current_bundle_id
  WHERE r.id = pg_temp.t300_id(p_role);
  RETURN pg_temp.t300_call('authenticated', pg_temp.t300_claims(1), format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.t300_id(1), pg_temp.t300_id(300 + p_actor), v_version, items, bindings, 'T300 assign',
    pg_temp.t300_id(5000 + p_req)));
END
$$;
SELECT pg_temp.t300_assert(
  pg_temp.t300_assign(3, 1) ->> 'status' = 'applied' AND pg_temp.t300_assign(4, 2) ->> 'status' = 'applied'
  AND pg_temp.t300_assign(6, 3) ->> 'status' = 'applied'
  AND pg_temp.t300_assign(5, 4, 1102) ->> 'status' = 'applied',
  'the Admin gives the task role to S1, S2 and the head, and the complete-only role to one member, through staff_role_assignments_save');

-- Eligibility facts the suite relies on (the missed-call slice's own helper decides who may receive a task).
SELECT pg_temp.t300_assert(
  platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(301))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(302))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(303))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(304))
  AND platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(306))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(305))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(308))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(311))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), pg_temp.t300_id(313))
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(1), NULL)
  AND NOT platform_private.telephony_task_assignee_ok(pg_temp.t300_id(2), pg_temp.t300_id(303)),
  'only an active member with BOTH staff.task.read and staff.task.complete (or an Admin) can receive a task; a Student, a member without roles, a suspended one and another organization cannot');

-- ---------------------------------------------------------------------------
-- Clients, leads and calls.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t300_phone(n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT '+99670100' || lpad(n::TEXT, 4, '0')
$$;
-- A number nobody in the fixture has.
CREATE FUNCTION pg_temp.t300_unknown(n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT '+99655500' || lpad(n::TEXT, 4, '0')
$$;
CREATE FUNCTION pg_temp.t300_client(p_n INTEGER, p_org INTEGER DEFAULT 1, p_phone TEXT DEFAULT NULL) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state)
  VALUES (pg_temp.t300_id(4000 + p_n), pg_temp.t300_id(p_org), 'T300 Client ' || p_n,
    platform_private.normalize_person_name('T300 Client ' || p_n), COALESCE(p_phone, pg_temp.t300_phone(p_n)),
    platform_private.normalize_person_phone(COALESCE(p_phone, pg_temp.t300_phone(p_n))), 'active')
$$;
CREATE FUNCTION pg_temp.t300_lead(p_n INTEGER, p_client INTEGER, p_owner INTEGER, p_org INTEGER DEFAULT 1,
  p_state TEXT DEFAULT 'open', p_source TEXT DEFAULT 'website', p_updated TIMESTAMPTZ DEFAULT NULL) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
    updated_at)
  VALUES (pg_temp.t300_id(5000 + p_n), pg_temp.t300_id(p_org), pg_temp.t300_id(4000 + p_client),
    CASE WHEN p_owner IS NULL THEN NULL ELSE pg_temp.t300_id(300 + p_owner) END, 'new', p_source,
    p_state::platform.lead_lifecycle_state, COALESCE(p_updated, statement_timestamp()))
$$;
-- 1 open lead of S1; 2 two closed leads (older S1, newer S2 -> S2 is the last owner); 3 closed lead of the
-- suspended member; 4 closed lead of the member who cannot receive tasks; 5 and 6 no lead at all;
-- 7 closed lead of S2 (a missed call); 9 closed lead of S2 (another slice's task is open); 10 a converted
-- lead of S1 whose client appears after the call; 21 and 22 share ONE phone; 23 the phone of an
-- unmatched call that is claimed by a manual phone_call lead before the tick.
SELECT pg_temp.t300_client(n) FROM generate_series(1, 10) n;
SELECT pg_temp.t300_client(21, 1, '+996701009999');
SELECT pg_temp.t300_client(22, 1, '+996701009999');
SELECT pg_temp.t300_lead(1, 1, 3);
SELECT pg_temp.t300_lead(21, 2, 3, 1, 'archived', 'website', now() - INTERVAL '10 days');
SELECT pg_temp.t300_lead(22, 2, 4, 1, 'archived', 'website', now() - INTERVAL '2 days');
SELECT pg_temp.t300_lead(3, 3, 8, 1, 'archived');
SELECT pg_temp.t300_lead(4, 4, 5, 1, 'archived');
SELECT pg_temp.t300_lead(7, 7, 4, 1, 'archived');
SELECT pg_temp.t300_lead(9, 9, 4, 1, 'archived');
-- Organization 2 (another tenant): a client with an open lead and a phone_call lead of its own.
SELECT pg_temp.t300_client(90, 2);
SELECT pg_temp.t300_lead(90, 90, NULL, 2, 'open', 'phone_call');
SELECT pg_temp.t300_client(91, 2);
SELECT pg_temp.t300_lead(91, 91, NULL, 2, 'open', 'website');

-- A call. p_ago: how long ago it began; ended 30 s later; settled 90 s after that (or p_settled_ago
-- before now). Outcome NULL = still ringing. p_phone NULL with p_client NULL = an anonymous caller.
CREATE FUNCTION pg_temp.t300_mk(p_k INTEGER, p_dir TEXT, p_outcome TEXT, p_ago INTERVAL, p_phone TEXT,
  p_client INTEGER DEFAULT NULL, p_lead INTEGER DEFAULT NULL, p_via TEXT DEFAULT 'webhook', p_org INTEGER DEFAULT 1,
  p_match TEXT DEFAULT NULL, p_settled_ago INTERVAL DEFAULT NULL, p_settle BOOLEAN DEFAULT TRUE, p_review BOOLEAN DEFAULT FALSE,
  p_member INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_start TIMESTAMPTZ := clock_timestamp() - p_ago;
BEGIN
  INSERT INTO platform_private.telephony_calls(id, organization_id, pbx_callid, direction, state, outcome, outcome_source,
    started_at, answered_at, ended_at, settled_at, client_phone, membership_id, client_id, lead_id, match_state, created_via,
    needs_review)
  VALUES (pg_temp.t300_id(7000 + p_k), pg_temp.t300_id(p_org), 't300-call-' || p_k, p_dir,
    CASE WHEN p_outcome IS NULL THEN 'ringing' ELSE 'ended' END, p_outcome,
    CASE WHEN p_outcome IS NULL THEN NULL WHEN p_via = 'reconcile' THEN 'pull' ELSE 'webhook' END,
    v_start, CASE WHEN p_outcome = 'answered' THEN v_start + INTERVAL '5 seconds' END,
    CASE WHEN p_outcome IS NULL THEN NULL ELSE v_start + INTERVAL '30 seconds' END,
    CASE WHEN NOT p_settle THEN NULL WHEN p_settled_ago IS NOT NULL THEN clock_timestamp() - p_settled_ago
      ELSE v_start + INTERVAL '120 seconds' END,
    COALESCE(p_phone, CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t300_phone(p_client) END),
    CASE WHEN p_member IS NULL THEN NULL ELSE pg_temp.t300_id(300 + p_member) END,
    CASE WHEN p_client IS NULL THEN NULL ELSE pg_temp.t300_id(4000 + p_client) END,
    CASE WHEN p_lead IS NULL THEN NULL ELSE pg_temp.t300_id(5000 + p_lead) END,
    COALESCE(p_match, CASE WHEN p_client IS NULL THEN 'unmatched' ELSE 'matched' END), p_via, p_review);
END
$$;
CREATE FUNCTION pg_temp.t300_tick(p_org INTEGER DEFAULT 1, p_limit INTEGER DEFAULT 100) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.telephony_intake_tick_v1(pg_temp.t300_id(p_org), p_limit)
$$;
CREATE FUNCTION pg_temp.t300_mark(p_k INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(c.intake_outcome, 'NULL') FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t300_id(7000 + p_k)
$$;
CREATE FUNCTION pg_temp.t300_lead_of(p_k INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT c.lead_id FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t300_id(7000 + p_k)
$$;
CREATE FUNCTION pg_temp.t300_client_of(p_k INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT c.client_id FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t300_id(7000 + p_k)
$$;
CREATE FUNCTION pg_temp.t300_state_of(p_k INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT c.match_state FROM platform_private.telephony_calls c WHERE c.id = pg_temp.t300_id(7000 + p_k)
$$;
-- Number of active clients of an organization with this number.
CREATE FUNCTION pg_temp.t300_clients_with(p_phone TEXT, p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.clients c WHERE c.organization_id = pg_temp.t300_id(p_org) AND c.lifecycle_state = 'active'
    AND c.normalized_phone = ANY (platform_private.person_phone_match_keys(p_phone))
$$;
CREATE FUNCTION pg_temp.t300_phone_call_leads(p_org INTEGER DEFAULT 1) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.leads l WHERE l.organization_id = pg_temp.t300_id(p_org) AND l.source_key = 'phone_call'
$$;
-- The link of the client task made for a call, and its staff task.
CREATE FUNCTION pg_temp.t300_link(p_k INTEGER) RETURNS platform_private.telephony_task_links LANGUAGE SQL AS $$
  SELECT l FROM platform_private.telephony_task_links l
  WHERE l.call_id = pg_temp.t300_id(7000 + p_k) AND l.kind = 'client_no_lead' ORDER BY l.created_at DESC, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t300_task(p_k INTEGER) RETURNS platform.staff_tasks LANGUAGE SQL AS $$
  SELECT t FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
  WHERE l.call_id = pg_temp.t300_id(7000 + p_k) AND l.kind = 'client_no_lead' ORDER BY l.created_at DESC, l.id LIMIT 1
$$;
CREATE FUNCTION pg_temp.t300_who(p_k INTEGER) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (substr(t.assignee_membership_id::TEXT, 25)::INTEGER - 300) FROM platform_private.telephony_task_links l
  JOIN platform.staff_tasks t ON t.id = l.task_id WHERE l.call_id = pg_temp.t300_id(7000 + p_k) AND l.kind = 'client_no_lead'
  ORDER BY l.created_at DESC, l.id LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 1. Catalog and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t300_assert((SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'telephony\_%')
  = (SELECT array_agg(x ORDER BY x COLLATE "C") FROM unnest(ARRAY['telephony_claim_work_v1', 'telephony_erase_person_v1',
    'telephony_extension_map_v1', 'telephony_integration_health_v1', 'telephony_lead_calls_v1', 'telephony_lead_recordings_v1',
    'telephony_maintenance_plan_v1', 'telephony_manage_overview_v1', 'telephony_project_work_v1', 'telephony_purge_evidence_v1',
    'telephony_receive_v1', 'telephony_reconcile_apply_v1', 'telephony_recording_consume_v1', 'telephony_recording_grant_v1',
    'telephony_recording_report_v1', 'telephony_runtime_mark_v1', 'telephony_set_result_v1', 'telephony_settings_save_v1',
    'telephony_settle_calls_v1', 'telephony_sync_extensions_v1', 'telephony_automation_tick_v1', 'telephony_intake_tick_v1',
    'telephony_dial_options_v1', 'telephony_dial_begin_v1', 'telephony_dial_target_v1', 'telephony_dial_finish_v1']) x),
  'platform holds the full catalog of public telephony functions: the twenty-five earlier ones (T1b four, T4a five, T11a two, T5 two, T4b three, T6 four, T7 four, T8 one) and exactly one new');
SELECT pg_temp.t300_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 'v'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.telephony_intake_tick_v1(uuid,integer)'::regprocedure),
  'the tick: owner-owned SECURITY DEFINER, empty search_path, VOLATILE, EXECUTE for service_role only');
SELECT pg_temp.t300_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_get_userbyid(p.proowner) = 'postgres' AND p.provolatile = 's'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
    FROM pg_proc p WHERE p.oid = 'platform.staff_requests_queue_v3(uuid,text,text,integer,jsonb)'::regprocedure),
  'the queue v3: owner-owned SECURITY DEFINER, empty search_path, STABLE, EXECUTE for authenticated only');
SELECT pg_temp.t300_assert(
  to_regprocedure('platform.staff_requests_queue_v2(uuid,text,text,integer,jsonb)') IS NOT NULL
  AND to_regprocedure('platform.staff_requests_queue_v1(uuid,text,text,text,integer,jsonb)') IS NOT NULL,
  'v2 (250) and v1 (221) stay for the previous application release (removed by a later migration after acceptance)');
SELECT pg_temp.t300_assert(
  (SELECT array_agg(p.proname::TEXT ORDER BY p.proname COLLATE "C") FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_intake\_%')
  = ARRAY['telephony_intake_ceiling_code', 'telephony_intake_decide'],
  'the two private intake helpers exist (everything else is the missed-call slice''s: assignees, tasks, links, stop)');
SELECT pg_temp.t300_assert((SELECT bool_and(NOT has_function_privilege(r.role, p.oid, 'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_intake\_%')
  AND (SELECT bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[] AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_private' AND p.proname LIKE 'telephony\_intake\_%'),
  'no private intake helper is executable by PUBLIC or a client role, and each has an empty search_path');
SELECT pg_temp.t300_assert((SELECT bool_and(
      pg_temp.t300_as(r.role, c.claims, format('SELECT platform.telephony_intake_tick_v1(%L)', pg_temp.t300_id(1))) = '42501')
    FROM (VALUES ('anon'), ('authenticated'), ('supabase_auth_admin'), ('evo_ai_agent')) r(role)
    CROSS JOIN (VALUES ('{"role":"service_role"}'), ('{"role":"authenticated","sub":"30010000-0000-4000-8000-000000000101"}'), ('')) c(claims)),
  'anon, authenticated, supabase_auth_admin and the AI agent role are refused whatever the claims');
SELECT pg_temp.t300_assert((SELECT bool_and(pg_temp.t300_as('service_role', c.claims,
      format('SELECT platform.telephony_intake_tick_v1(%L)', pg_temp.t300_id(1))) = '42501')
    FROM (VALUES ('{"role":"authenticated"}'), ('{"role":"anon"}'), (''), ('{"sub":"30010000-0000-4000-8000-000000000101"}')) c(claims)),
  'service_role without the service claim is refused too (the role check is inside the function)');
SELECT pg_temp.t300_assert(
  pg_temp.t300_try(format('SELECT platform.telephony_intake_tick_v1(NULL)')) = '22023'
  AND pg_temp.t300_try(format('SELECT platform.telephony_intake_tick_v1(%L, 0)', pg_temp.t300_id(1))) = '22023'
  AND pg_temp.t300_try(format('SELECT platform.telephony_intake_tick_v1(%L, 1001)', pg_temp.t300_id(1))) = '22023'
  AND pg_temp.t300_try(format('SELECT platform.telephony_intake_tick_v1(%L, NULL)', pg_temp.t300_id(1))) = '22023'
  AND pg_temp.t300_try(format('SELECT platform.telephony_intake_tick_v1(%L)', pg_temp.t300_id(999))) = '22023',
  'a null or unknown organization and a limit outside 1..1000 are 22023');
SELECT pg_temp.t300_assert(
  pg_temp.t300_as('service_role', '{"role":"service_role"}',
    'SELECT platform_private.telephony_intake_decide(''30010000-0000-4000-8000-000000000001'', ''30010000-0000-4000-8000-000000007001'')') = '42501'
  AND pg_temp.t300_as('authenticated', '{"role":"authenticated"}',
    'SELECT platform_private.telephony_intake_ceiling_code(''30010000-0000-4000-8000-000000000001'', ''leads'')') = '42501',
  'the decision and ceiling helpers are not callable by service_role or authenticated');

-- ---------------------------------------------------------------------------
-- 2. Schema.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t300_mk(1, 'in', 'missed', INTERVAL '10 minutes', pg_temp.t300_unknown(901), NULL, NULL, 'webhook', 1, NULL, NULL, FALSE);
SELECT pg_temp.t300_assert((SELECT intake_done_at IS NULL AND intake_outcome IS NULL
    FROM platform_private.telephony_calls WHERE id = pg_temp.t300_id(7001)),
  'a new call carries no intake mark');
SELECT pg_temp.t300_assert(
  pg_temp.t300_try($q$UPDATE platform_private.telephony_calls SET intake_done_at = clock_timestamp()
    WHERE id = '30010000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t300_try($q$UPDATE platform_private.telephony_calls SET intake_outcome = 'lead_created'
    WHERE id = '30010000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t300_try($q$UPDATE platform_private.telephony_calls SET intake_done_at = clock_timestamp(),
    intake_outcome = 'made_up' WHERE id = '30010000-0000-4000-8000-000000007001'$q$) = '23514'
  AND pg_temp.t300_try($q$UPDATE platform_private.telephony_calls SET intake_done_at = clock_timestamp(),
    intake_outcome = 'lead_created' WHERE id = '30010000-0000-4000-8000-000000007001'$q$) = 'ok'
  AND pg_temp.t300_try($q$UPDATE platform_private.telephony_calls SET intake_done_at = clock_timestamp(),
    intake_outcome = 'client_task_created' WHERE id = '30010000-0000-4000-8000-000000007001'$q$) = 'ok',
  'the intake mark is both-or-neither and takes only the closed list');
SELECT pg_temp.t300_assert(
  (SELECT pg_get_constraintdef(oid) LIKE '%client_no_lead%' AND pg_get_constraintdef(oid) LIKE '%no_answer_hint%'
      AND pg_get_constraintdef(oid) LIKE '%missed_callback%' AND pg_get_constraintdef(oid) LIKE '%verify_call%'
      AND pg_get_constraintdef(oid) LIKE '%reached_followup%' AND pg_get_constraintdef(oid) LIKE '%result_callback%'
      AND pg_get_constraintdef(oid) LIKE '%no_answer_callback%'
    FROM pg_constraint WHERE conname = 'telephony_task_links_kind_check'),
  'the task-link kinds keep every kind of the missed-call slice and gain client_no_lead');
SELECT pg_temp.t300_assert(
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'platform_private' AND tablename = 'telephony_calls'
    AND indexname IN ('telephony_calls_intake_idx', 'telephony_calls_intake_done_idx')) = 2,
  'the two partial indexes (unprocessed settled inbound calls; decided calls for the ceilings) exist');
DELETE FROM platform_private.telephony_calls WHERE id = pg_temp.t300_id(7001);

-- ---------------------------------------------------------------------------
-- 3. The switches: nothing may happen while off.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t300_mk(1, 'in', 'missed', INTERVAL '10 minutes', pg_temp.t300_unknown(1));
SELECT pg_temp.t300_assert(pg_temp.t300_tick() = '{"status":"disabled"}'::JSONB,
  'with no settings row the tick answers disabled');
INSERT INTO platform_private.telephony_settings(organization_id, escalation_membership_id)
  VALUES (pg_temp.t300_id(1), pg_temp.t300_id(306));
SELECT pg_temp.t300_assert(pg_temp.t300_tick() = '{"status":"disabled"}'::JSONB,
  'the default settings row (every flag off) answers disabled');
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = TRUE WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_assert(pg_temp.t300_tick() = '{"status":"disabled"}'::JSONB,
  'the automation flag without projection answers disabled (projection is the base)');
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = FALSE, projection_enabled = TRUE
  WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_assert(pg_temp.t300_tick() = '{"status":"disabled"}'::JSONB,
  'projection without the automation flag answers disabled');
UPDATE platform_private.telephony_settings SET missed_task_enabled = TRUE WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_assert(pg_temp.t300_tick() = '{"status":"disabled"}'::JSONB,
  'the missed-call flag does not open the unknown-number intake');
SELECT pg_temp.t300_assert(pg_temp.t300_mark(1) = 'NULL' AND pg_temp.t300_phone_call_leads() = 0
  AND pg_temp.t300_clients_with(pg_temp.t300_unknown(1)) = 0 AND pg_temp.t300_state_of(1) = 'unmatched',
  'while off, the eligible unknown call is untouched: no mark, no client, no lead');
UPDATE platform_private.telephony_settings SET missed_task_enabled = FALSE, unknown_lead_enabled = TRUE
  WHERE organization_id = pg_temp.t300_id(1);
DELETE FROM platform_private.telephony_calls WHERE id = pg_temp.t300_id(7001);

-- ---------------------------------------------------------------------------
-- 4. An unknown inbound number becomes a client and a lead.
--   10 answered, unknown number A   11 missed, unknown number B   12 and 13 the same number A again
--   14 anonymous caller   15 outbound to an unknown number   16 ambiguous number (two clients)
--   17 settled without an outcome   18 reconciled duplicate   19 webhook call with needs_review
--   20 older than two hours (webhook)   21 reconcile started three hours ago   22 unsettled
--   23 imported (backfill)   24 a client appeared between the call and the tick
--   25 matched to a client with an open lead   26 already created
-- ---------------------------------------------------------------------------
SELECT pg_temp.t300_mk(10, 'in', 'answered', INTERVAL '40 minutes', pg_temp.t300_unknown(10), NULL, NULL, 'webhook', 1, NULL, NULL, TRUE, FALSE, 3);
SELECT pg_temp.t300_mk(11, 'in', 'missed', INTERVAL '38 minutes', pg_temp.t300_unknown(11));
SELECT pg_temp.t300_mk(12, 'in', 'missed', INTERVAL '30 minutes', pg_temp.t300_unknown(10));
SELECT pg_temp.t300_mk(13, 'in', 'answered', INTERVAL '20 minutes', pg_temp.t300_unknown(10), NULL, NULL, 'webhook', 1, NULL, NULL, TRUE, FALSE, 4);
SELECT pg_temp.t300_mk(14, 'in', 'missed', INTERVAL '19 minutes', NULL);
SELECT pg_temp.t300_mk(15, 'out', 'answered', INTERVAL '18 minutes', pg_temp.t300_unknown(15));
SELECT pg_temp.t300_mk(16, 'in', 'missed', INTERVAL '17 minutes', '+996701009999', NULL, NULL, 'webhook', 1, 'ambiguous');
SELECT pg_temp.t300_mk(17, 'in', NULL, INTERVAL '16 minutes', pg_temp.t300_unknown(17));
SELECT pg_temp.t300_mk(18, 'in', 'missed', INTERVAL '15 minutes', pg_temp.t300_unknown(18), NULL, NULL, 'reconcile', 1, NULL, NULL, TRUE, TRUE);
SELECT pg_temp.t300_mk(19, 'in', 'missed', INTERVAL '14 minutes', pg_temp.t300_unknown(19), NULL, NULL, 'webhook', 1, NULL, NULL, TRUE, TRUE);
SELECT pg_temp.t300_mk(20, 'in', 'missed', INTERVAL '4 hours', pg_temp.t300_unknown(20));
SELECT pg_temp.t300_mk(21, 'in', 'missed', INTERVAL '3 hours', pg_temp.t300_unknown(21), NULL, NULL, 'reconcile', 1, NULL, INTERVAL '10 minutes');
SELECT pg_temp.t300_mk(22, 'in', 'missed', INTERVAL '12 minutes', pg_temp.t300_unknown(22), NULL, NULL, 'webhook', 1, NULL, NULL, FALSE);
SELECT pg_temp.t300_mk(23, 'in', 'missed', INTERVAL '11 minutes', pg_temp.t300_unknown(23), NULL, NULL, 'backfill');
SELECT pg_temp.t300_mk(24, 'in', 'missed', INTERVAL '25 minutes', pg_temp.t300_unknown(24));
SELECT pg_temp.t300_client(23, 1, pg_temp.t300_unknown(24));
SELECT pg_temp.t300_lead(23, 23, 3, 1, 'open', 'phone_call');
SELECT pg_temp.t300_mk(25, 'in', 'missed', INTERVAL '9 minutes', NULL, 1, 1);
SELECT pg_temp.t300_mk(26, 'in', 'missed', INTERVAL '8 minutes', NULL, 1, 1, 'webhook', 1, 'created');

SELECT pg_temp.t300_tick() AS t300_first \gset
SELECT pg_temp.t300_assert((:'t300_first')::JSONB = jsonb_build_object('status', 'ok', 'stop_code', NULL, 'created', 3, 'attached', 3,
    'tasks', 0, 'skipped', 8, 'failed', 0, 'last_error_code', NULL),
  'the first tick: 3 leads made, 3 calls attached, 8 skipped (two of them by age), none failed: ' || :'t300_first');
SELECT pg_temp.t300_assert(
  pg_temp.t300_mark(10) = 'lead_created' AND pg_temp.t300_mark(11) = 'lead_created' AND pg_temp.t300_mark(19) = 'lead_created'
  AND pg_temp.t300_mark(12) = 'lead_attached' AND pg_temp.t300_mark(13) = 'lead_attached' AND pg_temp.t300_mark(24) = 'lead_attached'
  AND pg_temp.t300_mark(14) = 'skipped_phone' AND pg_temp.t300_mark(16) = 'nothing_to_do'
  AND pg_temp.t300_mark(17) = 'skipped_outcome' AND pg_temp.t300_mark(18) = 'skipped_outcome'
  AND pg_temp.t300_mark(20) = 'skipped_old' AND pg_temp.t300_mark(21) = 'skipped_old'
  AND pg_temp.t300_mark(25) = 'nothing_to_do' AND pg_temp.t300_mark(26) = 'nothing_to_do'
  AND pg_temp.t300_mark(15) = 'NULL' AND pg_temp.t300_mark(22) = 'NULL' AND pg_temp.t300_mark(23) = 'NULL',
  'each call has its mark; the outbound, the unsettled and the imported call are not even selected');
SELECT pg_temp.t300_assert(
  pg_temp.t300_state_of(10) = 'created' AND pg_temp.t300_client_of(10) IS NOT NULL AND pg_temp.t300_lead_of(10) IS NOT NULL
  AND pg_temp.t300_state_of(11) = 'created' AND pg_temp.t300_lead_of(11) IS DISTINCT FROM pg_temp.t300_lead_of(10)
  AND pg_temp.t300_state_of(19) = 'created',
  'a created call carries its client and lead and match_state created (answered, missed and needs_review webhook alike)');
SELECT pg_temp.t300_assert(
  pg_temp.t300_state_of(12) = 'matched' AND pg_temp.t300_lead_of(12) = pg_temp.t300_lead_of(10)
  AND pg_temp.t300_client_of(12) = pg_temp.t300_client_of(10)
  AND pg_temp.t300_state_of(13) = 'matched' AND pg_temp.t300_lead_of(13) = pg_temp.t300_lead_of(10)
  AND pg_temp.t300_clients_with(pg_temp.t300_unknown(10)) = 1,
  'the same number calling again attaches to the created client and lead: one client, one lead');
SELECT pg_temp.t300_assert(
  pg_temp.t300_state_of(24) = 'matched' AND pg_temp.t300_lead_of(24) = pg_temp.t300_id(5023)
  AND pg_temp.t300_client_of(24) = pg_temp.t300_id(4023) AND pg_temp.t300_clients_with(pg_temp.t300_unknown(24)) = 1,
  'a client who appeared after the call settled (a manual phone_call lead) is attached to, not duplicated');
SELECT pg_temp.t300_assert(
  pg_temp.t300_clients_with(pg_temp.t300_unknown(15)) = 0 AND pg_temp.t300_clients_with(pg_temp.t300_unknown(17)) = 0
  AND pg_temp.t300_clients_with(pg_temp.t300_unknown(18)) = 0 AND pg_temp.t300_clients_with(pg_temp.t300_unknown(20)) = 0
  AND pg_temp.t300_clients_with(pg_temp.t300_unknown(21)) = 0 AND pg_temp.t300_clients_with(pg_temp.t300_unknown(22)) = 0
  AND pg_temp.t300_clients_with(pg_temp.t300_unknown(23)) = 0
  AND pg_temp.t300_state_of(14) = 'unmatched' AND pg_temp.t300_state_of(16) = 'ambiguous',
  'outbound, ambiguous, anonymous, no-outcome, reconciled-duplicate, old, unsettled and imported calls made no client');
SELECT pg_temp.t300_assert(
  pg_temp.t300_phone_call_leads() = 4
  AND (SELECT count(*) FROM platform.clients c WHERE c.organization_id = pg_temp.t300_id(1) AND c.display_name LIKE 'Звонок %') = 3,
  'three new phone_call leads and clients, plus the manual phone_call lead of the fixture');
-- The lead and the client as the plan says (§9.3): phone_call, stage new, no owner, open; the name is
-- a mask, never the number; the number is the client phone; the channel is «не известно».
SELECT pg_temp.t300_assert(
  (SELECT l.source_key = 'phone_call' AND l.stage_key = 'new' AND l.current_owner_membership_id IS NULL
      AND l.lifecycle_state = 'open' AND l.client_id = pg_temp.t300_client_of(10)
    FROM platform.leads l WHERE l.id = pg_temp.t300_lead_of(10))
  AND (SELECT c.normalized_phone = pg_temp.t300_unknown(10) AND c.lifecycle_state = 'active'
      AND c.display_name LIKE 'Звонок +996 %' AND c.display_name NOT LIKE '%' || substr(pg_temp.t300_unknown(10), 2) || '%'
      AND c.email IS NULL
    FROM platform.clients c WHERE c.id = pg_temp.t300_client_of(10)),
  'the lead is phone_call / new / no owner / open; the client is «Звонок» + a mask with the number in its phone field only');
SELECT pg_temp.t300_assert(
  platform_private.lead_channel_json(pg_temp.t300_id(1), pg_temp.t300_lead_of(10)) ->> 'channel' = 'unknown'
  AND (SELECT count(*) FROM platform_private.lead_attribution_touches t WHERE t.lead_id = pg_temp.t300_lead_of(10)) = 0,
  'the channel «Откуда узнал» is unknown and no attribution touch is invented');
SELECT pg_temp.t300_assert(
  (SELECT count(*) FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.t300_id(1) AND e.source_system = 'beeline_pbx'
    AND e.external_object_type = 'call_caller' AND e.client_id IS NOT NULL) = 3
  AND (SELECT count(*) FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.t300_id(1) AND e.source_system = 'beeline_pbx'
    AND e.external_object_type = 'call_lead' AND e.lead_id IS NOT NULL) = 3
  AND (SELECT count(*) FROM platform.subject_provenance p WHERE p.organization_id = pg_temp.t300_id(1) AND p.source_system = 'beeline_pbx'
    AND p.evidence_type = 'call_received' AND p.source_ref LIKE 'telephony-call:%') = 6,
  'each created client and lead is bound to its call id (external identity) and carries one provenance row');
-- Idempotency by call: a second tick decides nothing; a direct re-decision of a created call changes nothing.
SELECT pg_temp.t300_tick() AS t300_second \gset
SELECT pg_temp.t300_assert((:'t300_second')::JSONB = jsonb_build_object('status', 'ok', 'stop_code', NULL, 'created', 0, 'attached', 0,
    'tasks', 0, 'skipped', 0, 'failed', 0, 'last_error_code', NULL)
  AND pg_temp.t300_phone_call_leads() = 4 AND pg_temp.t300_mark(10) = 'lead_created',
  'a second tick changes nothing: one decision per call');
SELECT pg_temp.t300_assert(
  platform_private.telephony_intake_decide(pg_temp.t300_id(1), pg_temp.t300_id(7010)) = 'nothing_to_do'
  AND pg_temp.t300_phone_call_leads() = 4 AND pg_temp.t300_clients_with(pg_temp.t300_unknown(10)) = 1,
  'deciding a created call again makes no second client or lead');
SELECT pg_temp.t300_assert(
  (SELECT platform_private.create_or_link_client(pg_temp.t300_id(1), 'Звонок again', NULL, pg_temp.t300_unknown(10), 'beeline_pbx',
      'call_caller', 't300-call-10', 'call_received', now(), NULL, 'x'))
    = pg_temp.t300_client_of(10)
  AND (SELECT platform_private.create_or_link_lead(pg_temp.t300_id(1), pg_temp.t300_client_of(10), NULL, 'new', 'phone_call',
      'beeline_pbx', 'call_lead', 't300-call-10', 'call_received', now(), NULL, 'x'))
    = pg_temp.t300_lead_of(10),
  'the same call id gives the same client and lead even through the canonical functions (idempotent by callid)');
-- Several tick limits: a limit of one call walks the backlog oldest first.
SELECT pg_temp.t300_mk(30, 'in', 'missed', INTERVAL '7 minutes', pg_temp.t300_unknown(30));
SELECT pg_temp.t300_mk(31, 'in', 'missed', INTERVAL '6 minutes', pg_temp.t300_unknown(31));
SELECT pg_temp.t300_tick(1, 1) AS t300_r1 \gset
SELECT pg_temp.t300_assert(((:'t300_r1')::JSONB ->> 'created')::INTEGER = 1 AND pg_temp.t300_mark(30) = 'lead_created'
  AND pg_temp.t300_mark(31) = 'NULL', 'a limit of one handles the oldest call only');
SELECT pg_temp.t300_tick(1, 1) AS t300_r2 \gset
SELECT pg_temp.t300_assert(((:'t300_r2')::JSONB ->> 'created')::INTEGER = 1 AND pg_temp.t300_mark(31) = 'lead_created',
  'the next tick handles the next call');

-- ---------------------------------------------------------------------------
-- 5. A known client without an open lead (§6.2, §18.2 question 12): one task for the last lead
--    owner, no new lead; a missed call is left to the missed-call slice.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t300_mk(40, 'in', 'answered', INTERVAL '50 minutes', NULL, 2, NULL, 'webhook', 1, NULL, NULL, TRUE, FALSE, 3);
SELECT pg_temp.t300_mk(41, 'in', 'answered', INTERVAL '45 minutes', NULL, 2, NULL, 'webhook', 1, NULL, NULL, TRUE, FALSE, 3);
SELECT pg_temp.t300_tick() AS t300_t1 \gset
SELECT pg_temp.t300_assert((:'t300_t1')::JSONB ->> 'tasks' = '1' AND pg_temp.t300_mark(40) = 'client_task_created'
  AND pg_temp.t300_mark(41) = 'client_task_exists' AND pg_temp.t300_who(40) = 4
  AND pg_temp.t300_phone_call_leads() = 6,
  'the first answered call of a client with no open lead makes ONE task for the LAST lead owner (S2, not S1); the next one while it is open makes none; no new lead');
SELECT pg_temp.t300_assert(
  (SELECT l.kind = 'client_no_lead' AND l.client_id = pg_temp.t300_id(4002) AND l.lead_id IS NULL AND l.scope_id = pg_temp.t300_id(4002)
      AND l.closed_at IS NULL AND l.call_id = pg_temp.t300_id(7040) AND l.occurrences = 1
    FROM (SELECT (pg_temp.t300_link(40)).*) l),
  'the link: kind client_no_lead, subject = the client (no lead), open, tied to the call');
SELECT pg_temp.t300_assert(
  (SELECT t.title = 'Клиент позвонил, открытого лида нет' AND t.status = 'open' AND t.priority = 'normal'
      AND t.creator_membership_id = t.assignee_membership_id AND t.version = 1
      AND t.due_at = platform_private.telephony_add_work_minutes(c.ended_at, 15, '{1,2,3,4,5,6}', '10:00', '20:00')
      AND t.description LIKE 'Входящий звонок % от клиента без открытого лида (номер +996 ••• %). Откройте карточку клиента и решите, нужен ли новый лид.'
      AND t.description NOT LIKE '%' || substr(pg_temp.t300_phone(2), 2) || '%'
    FROM (SELECT (pg_temp.t300_task(40)).*) t, platform_private.telephony_calls c WHERE c.id = pg_temp.t300_id(7040)),
  'the task is an ordinary open staff task: title, normal priority, due in 15 working minutes from the end of the call, creator = assignee, the number only as a mask');
SELECT pg_temp.t300_assert(
  (SELECT count(*) FROM platform.staff_task_events e WHERE e.staff_task_id = (pg_temp.t300_task(40)).id AND e.action = 'create') = 1
  AND (SELECT count(*) FROM platform.staff_notifications n WHERE n.staff_task_id = (pg_temp.t300_task(40)).id
    AND n.kind = 'task_assigned' AND n.recipient_membership_id = pg_temp.t300_id(304)) = 1
  AND (SELECT count(*) FROM platform_private.staff_task_receipts r WHERE r.staff_task_id = (pg_temp.t300_task(40)).id) = 1
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.resource_id = (pg_temp.t300_task(40)).id
    AND a.action = 'staff.task.create' AND a.actor_kind = 'system'
    AND a.actor_principal = 'telephony-automation' AND a.resource_type = 'staff_task') = 1,
  'the task carries its create event, the «назначена» notification, its receipt and one journal row from the system');
-- A human finishes the task: the next answered call of the client makes a new one.
UPDATE platform.staff_tasks SET status = 'done', version = version + 1 WHERE id = (pg_temp.t300_task(40)).id;
SELECT pg_temp.t300_mk(42, 'in', 'answered', INTERVAL '40 minutes', NULL, 2, NULL, 'webhook', 1, NULL, NULL, TRUE, FALSE, 3);
SELECT pg_temp.t300_tick();
SELECT pg_temp.t300_assert(pg_temp.t300_mark(42) = 'client_task_created' AND pg_temp.t300_who(42) = 4
  AND (SELECT count(*) FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    WHERE l.client_id = pg_temp.t300_id(4002) AND l.kind = 'client_no_lead' AND l.closed_at IS NULL AND t.status = 'open') = 1
  AND (SELECT l.closed_reason FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t300_id(7040)
    AND l.kind = 'client_no_lead') = 'task_done',
  'a task finished by a human closes its link (task_done) and lets the next call make a new one (one open at a time)');

-- Fallbacks for the recipient.
SELECT pg_temp.t300_mk(43, 'in', 'answered', INTERVAL '39 minutes', NULL, 3);
SELECT pg_temp.t300_mk(44, 'in', 'answered', INTERVAL '38 minutes', NULL, 4);
SELECT pg_temp.t300_mk(45, 'in', 'answered', INTERVAL '37 minutes', NULL, 5);
SELECT pg_temp.t300_tick();
SELECT pg_temp.t300_assert(
  pg_temp.t300_mark(43) = 'client_task_created' AND pg_temp.t300_who(43) = 6
  AND pg_temp.t300_mark(44) = 'client_task_created' AND pg_temp.t300_who(44) = 6
  AND pg_temp.t300_mark(45) = 'client_task_created' AND pg_temp.t300_who(45) = 6,
  'a last owner who is suspended or cannot receive tasks, and a client with no lead at all, go to the escalation recipient');
UPDATE platform_private.telephony_settings SET escalation_membership_id = NULL WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_mk(46, 'in', 'answered', INTERVAL '36 minutes', NULL, 6);
SELECT pg_temp.t300_tick();
SELECT pg_temp.t300_assert(pg_temp.t300_mark(46) = 'client_task_created' AND pg_temp.t300_who(46) = 1,
  'with no escalation recipient the earliest Admin gets it');
UPDATE platform_private.telephony_settings SET escalation_membership_id = pg_temp.t300_id(306) WHERE organization_id = pg_temp.t300_id(1);

-- A missed call is not this slice's: the missed-call slice gives it a «Перезвонить».
SELECT pg_temp.t300_mk(47, 'in', 'missed', INTERVAL '35 minutes', NULL, 7);
-- Another slice's open callback task for the client counts as the task.
SELECT pg_temp.t300_mk(48, 'in', 'answered', INTERVAL '34 minutes', NULL, 9);
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority)
  VALUES (pg_temp.t300_id(8001), pg_temp.t300_id(1), pg_temp.t300_id(304), pg_temp.t300_id(304), 'T300 callback of the other slice',
    'open', 'high');
INSERT INTO platform_private.telephony_task_links(organization_id, kind, task_id, call_id, client_id, scope_id)
  VALUES (pg_temp.t300_id(1), 'missed_callback', pg_temp.t300_id(8001), pg_temp.t300_id(7047), pg_temp.t300_id(4009), pg_temp.t300_id(4009));
-- A client with an open lead: nothing.
SELECT pg_temp.t300_mk(49, 'in', 'answered', INTERVAL '33 minutes', NULL, 1, 1);
-- An unmatched call whose number now belongs to a client with only a converted lead: attached, then the task.
SELECT pg_temp.t300_lead(10, 10, 3, 1, 'converted');
SELECT pg_temp.t300_mk(50, 'in', 'answered', INTERVAL '32 minutes', pg_temp.t300_phone(10));
SELECT pg_temp.t300_tick() AS t300_t2 \gset
SELECT pg_temp.t300_assert(
  pg_temp.t300_mark(47) = 'nothing_to_do' AND pg_temp.t300_who(47) IS NULL
  AND pg_temp.t300_mark(48) = 'client_task_exists'
  AND pg_temp.t300_mark(49) = 'nothing_to_do'
  AND pg_temp.t300_mark(50) = 'client_task_created' AND pg_temp.t300_who(50) = 3
  AND pg_temp.t300_state_of(50) = 'matched' AND pg_temp.t300_client_of(50) = pg_temp.t300_id(4010) AND pg_temp.t300_lead_of(50) IS NULL
  AND pg_temp.t300_phone_call_leads() = 6,
  'a missed call is left to the missed-call slice; the other slice''s open callback counts; an open lead needs nothing; an unmatched call that now matches a client without an open lead is attached and tasked');

-- Nobody to give it to (organization 3 has no staff): skipped without an error.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled)
  VALUES (pg_temp.t300_id(3), TRUE, TRUE);
SELECT pg_temp.t300_client(92, 3);
SELECT pg_temp.t300_mk(52, 'in', 'answered', INTERVAL '31 minutes', NULL, 92, NULL, 'webhook', 3);
SELECT pg_temp.t300_tick(3) AS t300_r3 \gset
SELECT pg_temp.t300_assert(((:'t300_r3')::JSONB ->> 'failed') = '0' AND pg_temp.t300_mark(52) = 'skipped_no_assignee'
  AND (SELECT count(*) FROM platform.staff_tasks WHERE organization_id = pg_temp.t300_id(3)) = 0,
  'with nobody able to receive the task the call is skipped, not failed');

-- ---------------------------------------------------------------------------
-- 6. Ceilings (§9.1): an over-ceiling call rolls back, the tick stops, both flags go off.
-- ---------------------------------------------------------------------------
-- 6a. Leads per hour (organization 4): two leads fit, the third trips.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled, ceiling_leads_hour,
  ceiling_leads_day, missed_task_enabled) VALUES (pg_temp.t300_id(4), TRUE, TRUE, 2, 10, TRUE);
SELECT pg_temp.t300_mk(60, 'in', 'missed', INTERVAL '30 minutes', pg_temp.t300_unknown(60), NULL, NULL, 'webhook', 4);
SELECT pg_temp.t300_mk(61, 'in', 'answered', INTERVAL '29 minutes', pg_temp.t300_unknown(61), NULL, NULL, 'webhook', 4);
SELECT pg_temp.t300_mk(62, 'in', 'missed', INTERVAL '28 minutes', pg_temp.t300_unknown(62), NULL, NULL, 'webhook', 4);
SELECT pg_temp.t300_mk(63, 'in', 'missed', INTERVAL '27 minutes', pg_temp.t300_unknown(60), NULL, NULL, 'webhook', 4);
SELECT pg_temp.t300_tick(4) AS t300_trip1 \gset
SELECT pg_temp.t300_assert((:'t300_trip1')::JSONB = jsonb_build_object('status', 'stopped', 'stop_code', 'leads_hour', 'created', 2,
    'attached', 0, 'tasks', 0, 'skipped', 0, 'failed', 0, 'last_error_code', NULL),
  'the third lead of the hour trips the ceiling: ' || :'t300_trip1');
SELECT pg_temp.t300_assert(
  pg_temp.t300_mark(60) = 'lead_created' AND pg_temp.t300_mark(61) = 'lead_created' AND pg_temp.t300_mark(62) = 'NULL'
  AND pg_temp.t300_mark(63) = 'NULL' AND pg_temp.t300_clients_with(pg_temp.t300_unknown(62), 4) = 0
  AND pg_temp.t300_phone_call_leads(4) = 2,
  'the over-ceiling call is rolled back whole and stays unmarked (and so does everything after it)');
SELECT pg_temp.t300_assert(
  (SELECT NOT s.unknown_lead_enabled AND NOT s.missed_task_enabled AND s.projection_enabled AND s.version = 2
    FROM platform_private.telephony_settings s WHERE s.organization_id = pg_temp.t300_id(4))
  AND (SELECT r.automation_stop_code = 'leads_hour' AND r.automation_stopped_at IS NOT NULL
    FROM platform_private.telephony_runtime_state r WHERE r.organization_id = pg_temp.t300_id(4))
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.organization_id = pg_temp.t300_id(4)
    AND a.action = 'telephony.automation.stop' AND a.resource_type = 'telephony_settings' AND a.actor_kind = 'system'
    AND a.after_state ->> 'code' = 'leads_hour' AND a.after_state ->> 'unknownLeadEnabled' = 'false') = 1,
  'both automation flags are off, the settings version grew, the stop state shows the code and the journal has one stop event');
SELECT pg_temp.t300_tick(4) AS t300_r4 \gset
SELECT pg_temp.t300_assert(((:'t300_r4')::JSONB) = '{"status":"disabled"}'::JSONB, 'after the stop the tick is disabled until an Admin re-enables');
-- The admin re-enables after the check: the hour is still full, so it stops again; once the window moves it goes on.
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = TRUE WHERE organization_id = pg_temp.t300_id(4);
SELECT pg_temp.t300_tick(4) AS t300_r5 \gset
SELECT pg_temp.t300_assert(((:'t300_r5')::JSONB) ->> 'stop_code' = 'leads_hour' AND pg_temp.t300_mark(62) = 'NULL',
  're-enabling inside the same hour stops again at once');
UPDATE platform_private.telephony_calls SET intake_done_at = intake_done_at - INTERVAL '2 hours'
  WHERE organization_id = pg_temp.t300_id(4) AND intake_outcome = 'lead_created';
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = TRUE WHERE organization_id = pg_temp.t300_id(4);
SELECT pg_temp.t300_tick(4) AS t300_r6 \gset
SELECT pg_temp.t300_assert(((:'t300_r6')::JSONB) ->> 'status' = 'ok' AND pg_temp.t300_mark(62) = 'lead_created'
  AND pg_temp.t300_mark(63) = 'lead_attached' AND pg_temp.t300_phone_call_leads(4) = 3,
  'two hours later the hour is free: the held call becomes a lead and the repeated number attaches (attaching never counts)');

-- 6b. Leads per day (organization 5): three leads in the last day already, the hour is empty.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled, ceiling_leads_hour,
  ceiling_leads_day) VALUES (pg_temp.t300_id(5), TRUE, TRUE, 3, 3);
SELECT pg_temp.t300_mk(n, 'in', 'missed', INTERVAL '6 hours', pg_temp.t300_unknown(n), NULL, NULL, 'webhook', 5) FROM generate_series(70, 72) n;
UPDATE platform_private.telephony_calls SET intake_done_at = clock_timestamp() - INTERVAL '5 hours', intake_outcome = 'lead_created'
  WHERE organization_id = pg_temp.t300_id(5);
SELECT pg_temp.t300_mk(73, 'in', 'missed', INTERVAL '5 minutes', pg_temp.t300_unknown(73), NULL, NULL, 'webhook', 5);
SELECT pg_temp.t300_tick(5) AS t300_r7 \gset
SELECT pg_temp.t300_assert(((:'t300_r7')::JSONB) ->> 'stop_code' = 'leads_day' AND pg_temp.t300_mark(73) = 'NULL'
  AND pg_temp.t300_phone_call_leads(5) = 0,
  'the daily ceiling counts the last 24 hours and trips with its own code');
SELECT pg_temp.t300_assert((SELECT r.automation_stop_code FROM platform_private.telephony_runtime_state r
    WHERE r.organization_id = pg_temp.t300_id(5)) = 'leads_day', 'the stop state carries the daily code');

-- 6c. Tasks (organization 6): own tasks plus the missed-call slice's links share the task ceiling.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled, ceiling_tasks_hour,
  ceiling_tasks_day) VALUES (pg_temp.t300_id(6), TRUE, TRUE, 1, 10);
SELECT pg_temp.t300_client(100, 6);
SELECT pg_temp.t300_client(101, 6);
SELECT pg_temp.t300_client(102, 6);
SELECT pg_temp.t300_mk(80, 'in', 'answered', INTERVAL '20 minutes', NULL, 100, NULL, 'webhook', 6);
SELECT pg_temp.t300_mk(81, 'in', 'answered', INTERVAL '19 minutes', NULL, 101, NULL, 'webhook', 6);
SELECT pg_temp.t300_tick(6) AS t300_trip2 \gset
SELECT pg_temp.t300_assert((:'t300_trip2')::JSONB ->> 'stop_code' = 'tasks_hour' AND (:'t300_trip2')::JSONB ->> 'tasks' = '1'
  AND pg_temp.t300_mark(80) = 'client_task_created' AND pg_temp.t300_mark(81) = 'NULL'
  AND pg_temp.t300_who(80) = 12
  AND (SELECT count(*) FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.t300_id(6)) = 1
  AND (SELECT r.automation_stop_code FROM platform_private.telephony_runtime_state r WHERE r.organization_id = pg_temp.t300_id(6)) = 'tasks_hour',
  'the second task of the hour trips the task ceiling; the held call has no task');
-- Another slice's link counts toward the same ceiling.
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = TRUE, ceiling_tasks_hour = 2 WHERE organization_id = pg_temp.t300_id(6);
SELECT pg_temp.t300_mk(82, 'in', 'missed', INTERVAL '18 minutes', NULL, 102, NULL, 'webhook', 6);
INSERT INTO platform.staff_tasks(id, organization_id, creator_membership_id, assignee_membership_id, title, status, priority)
  VALUES (pg_temp.t300_id(8002), pg_temp.t300_id(6), pg_temp.t300_id(312), pg_temp.t300_id(312), 'T300 callback of the other slice', 'open', 'high');
INSERT INTO platform_private.telephony_task_links(organization_id, kind, task_id, call_id, client_id, scope_id)
  VALUES (pg_temp.t300_id(6), 'missed_callback', pg_temp.t300_id(8002), pg_temp.t300_id(7082), pg_temp.t300_id(4102), pg_temp.t300_id(4102));
SELECT pg_temp.t300_tick(6) AS t300_r8 \gset
SELECT pg_temp.t300_assert(((:'t300_r8')::JSONB) ->> 'stop_code' = 'tasks_hour' AND pg_temp.t300_mark(81) = 'NULL',
  'one own task plus one link of the missed-call slice fill a ceiling of two');
UPDATE platform_private.telephony_task_links SET created_at = created_at - INTERVAL '2 hours' WHERE task_id = pg_temp.t300_id(8002);
UPDATE platform_private.telephony_settings SET unknown_lead_enabled = TRUE WHERE organization_id = pg_temp.t300_id(6);
SELECT pg_temp.t300_tick(6) AS t300_r9 \gset
SELECT pg_temp.t300_assert(((:'t300_r9')::JSONB) ->> 'status' = 'ok' AND pg_temp.t300_mark(81) = 'client_task_created',
  'when the link leaves the hour the held call gets its task');

-- ---------------------------------------------------------------------------
-- 7. Failure and isolation.
-- ---------------------------------------------------------------------------
-- A suspended organization cannot get a client: the call fails alone, with a coded error only.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled)
  VALUES (pg_temp.t300_id(7), TRUE, TRUE);
SELECT pg_temp.t300_mk(90, 'in', 'missed', INTERVAL '10 minutes', pg_temp.t300_unknown(90), NULL, NULL, 'webhook', 7);
SELECT pg_temp.t300_tick(7) AS t300_failed \gset
SELECT pg_temp.t300_assert((:'t300_failed')::JSONB ->> 'status' = 'ok' AND (:'t300_failed')::JSONB ->> 'failed' = '1'
  AND (:'t300_failed')::JSONB ->> 'created' = '0' AND (:'t300_failed')::JSONB ->> 'last_error_code' ~ '^e23503'
  AND (:'t300_failed')::JSONB ->> 'last_error_code' !~ '[0-9]{9}'
  AND pg_temp.t300_mark(90) = 'NULL' AND pg_temp.t300_phone_call_leads(7) = 0,
  'a failing call is counted, coded by SQLSTATE only (no number, no text) and stays unmarked');
-- Another tenant: its settings are on, its call waits until its own tick; org 1 ticks never touch it.
INSERT INTO platform_private.telephony_settings(organization_id, projection_enabled, unknown_lead_enabled, ui_enabled)
  VALUES (pg_temp.t300_id(2), TRUE, TRUE, TRUE);
SELECT pg_temp.t300_mk(91, 'in', 'missed', INTERVAL '10 minutes', pg_temp.t300_unknown(91), NULL, NULL, 'webhook', 2);
SELECT pg_temp.t300_tick(1);
SELECT pg_temp.t300_assert(pg_temp.t300_mark(91) = 'NULL' AND pg_temp.t300_phone_call_leads(2) = 1,
  'a tick of organization 1 leaves the call of organization 2 alone');
SELECT pg_temp.t300_tick(2) AS t300_r10 \gset
SELECT pg_temp.t300_assert(((:'t300_r10')::JSONB) ->> 'created' = '1' AND pg_temp.t300_mark(91) = 'lead_created'
  AND pg_temp.t300_phone_call_leads(2) = 2 AND pg_temp.t300_phone_call_leads(1) = 6,
  'organization 2 ticks on its own: its lead belongs to it, organization 1 gained nothing');
-- No number, link or name in anything the intake wrote besides the client record.
SELECT pg_temp.t300_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.title LIKE '%99670%' OR t.description LIKE '%99670%'
    OR t.description LIKE '%99655%' OR t.description LIKE '%http%')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.actor_principal = 'telephony-automation'
    AND (to_jsonb(a)::TEXT LIKE '%99670%' OR to_jsonb(a)::TEXT LIKE '%99655%' OR to_jsonb(a)::TEXT LIKE '%http%'))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_task_events e WHERE (to_jsonb(e)::TEXT LIKE '%9967010%' OR to_jsonb(e)::TEXT LIKE '%9965550%')
    AND e.staff_task_id IN (SELECT task_id FROM platform_private.telephony_task_links WHERE kind = 'client_no_lead'))
  AND NOT EXISTS (SELECT 1 FROM platform_private.staff_task_receipts r WHERE (to_jsonb(r)::TEXT LIKE '%9967010%' OR to_jsonb(r)::TEXT LIKE '%9965550%')
    AND r.staff_task_id IN (SELECT task_id FROM platform_private.telephony_task_links WHERE kind = 'client_no_lead')),
  'no full number, link or name in any task, task event, receipt or journal row the intake made');

-- ---------------------------------------------------------------------------
-- 8. The queue v3 («Заявки»): v2 plus phone_call leads and the «Звонки» tab, only with telephony ui_enabled.
-- ---------------------------------------------------------------------------
-- Earlier-source leads in organization 1: an unowned website lead and an unowned whatsapp lead (and the
-- owned website lead 1 of the fixture).
SELECT pg_temp.t300_client(41);
SELECT pg_temp.t300_client(42);
SELECT pg_temp.t300_lead(41, 41, NULL, 1, 'open', 'website');
SELECT pg_temp.t300_lead(42, 42, NULL, 1, 'open', 'whatsapp');
CREATE FUNCTION pg_temp.t300_q(p_actor INTEGER, p_source TEXT DEFAULT 'all', p_status TEXT DEFAULT 'all', p_limit INTEGER DEFAULT 50,
  p_cursor JSONB DEFAULT NULL, p_org INTEGER DEFAULT 1, p_version INTEGER DEFAULT 3) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.t300_call('authenticated', pg_temp.t300_claims(p_actor), format(
    'SELECT platform.staff_requests_queue_v%s(%L::UUID, %L, %L, %s, %L::JSONB)', p_version, pg_temp.t300_id(p_org), p_source, p_status,
    p_limit, p_cursor));
END
$$;
-- Sorted kind:id of a page's rows.
CREATE FUNCTION pg_temp.t300_keys(page JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'kind') || ':' || (r ->> 'id') ORDER BY (r ->> 'kind') || ':' || (r ->> 'id')), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(page -> 'rows') AS r
$$;
CREATE FUNCTION pg_temp.t300_sorted(p_keys TEXT[]) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) FROM unnest(p_keys) k
$$;
CREATE FUNCTION pg_temp.t300_lead_key(p_k INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'lead:' || pg_temp.t300_lead_of(p_k)::TEXT
$$;
-- The sorted keys of the given calls' leads.
CREATE FUNCTION pg_temp.t300_lead_keys(VARIADIC p_ks INTEGER[]) RETURNS TEXT[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(pg_temp.t300_lead_key(k) ORDER BY pg_temp.t300_lead_key(k)), ARRAY[]::TEXT[]) FROM unnest(p_ks) k
$$;

-- 8a. Telephony ui OFF (the default row): v3 equals v2 and shows no call at all, not even a manual phone_call lead.
SELECT pg_temp.t300_q(1, 'all', 'all', 50, NULL, 1, 2) AS t300_v2_off \gset
SELECT pg_temp.t300_q(1, 'all', 'all', 50) AS t300_v3_off \gset
SELECT pg_temp.t300_assert((:'t300_v3_off')::JSONB ->> 'version' = '3' AND (:'t300_v3_off')::JSONB -> 'phoneCalls' = 'false'::JSONB
  AND (:'t300_v3_off')::JSONB -> 'counts' -> 'phone_call' = 'null'::JSONB
  AND pg_temp.t300_keys((:'t300_v3_off')::JSONB) = pg_temp.t300_keys((:'t300_v2_off')::JSONB)
  AND ((:'t300_v3_off')::JSONB -> 'counts') - 'phone_call' = (:'t300_v2_off')::JSONB -> 'counts'
  AND (:'t300_v3_off')::JSONB -> 'latestAt' = (:'t300_v2_off')::JSONB -> 'latestAt'
  AND (:'t300_v3_off')::JSONB -> 'states' = (:'t300_v2_off')::JSONB -> 'states',
  'with telephony ui off, v3 shows exactly what v2 shows, with no phone_call number and no phone_call row (even though six exist)');
SELECT pg_temp.t300_assert(pg_temp.t300_phone_call_leads() = 6
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'t300_v3_off')::JSONB -> 'rows') r WHERE r ->> 'source' = 'phone_call'),
  'sanity: phone_call leads exist, none of them is in the off read');
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 50) AS t300_v3_off_tab \gset
SELECT pg_temp.t300_assert((:'t300_v3_off_tab')::JSONB -> 'rows' = '[]'::JSONB AND (:'t300_v3_off_tab')::JSONB -> 'latestAt' = 'null'::JSONB
  AND (:'t300_v3_off_tab')::JSONB -> 'counts' -> 'phone_call' = 'null'::JSONB AND (:'t300_v3_off_tab')::JSONB -> 'phoneCalls' = 'false'::JSONB,
  'an old link to the «Звонки» tab with telephony off gets an empty read with no number');

-- 8b. Telephony ui ON: the tab, its number, the rows.
UPDATE platform_private.telephony_settings SET ui_enabled = TRUE WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_q(1, 'phone_call', 'waiting', 50) AS t300_tab_waiting \gset
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 50) AS t300_tab_all \gset
SELECT pg_temp.t300_assert(
  (:'t300_tab_waiting')::JSONB -> 'phoneCalls' = 'true'::JSONB
  AND pg_temp.t300_keys((:'t300_tab_waiting')::JSONB) = pg_temp.t300_lead_keys(10, 11, 19, 30, 31)
  AND (:'t300_tab_waiting')::JSONB -> 'counts' -> 'phone_call' = '5'::JSONB
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'t300_tab_waiting')::JSONB -> 'rows') r
    WHERE r ->> 'source' <> 'phone_call' OR r -> 'owner' <> 'null'::JSONB OR r -> 'take' = 'null'::JSONB OR (r ->> 'handedOff') <> 'false'),
  '«Ждут разбора» in «Звонки» is exactly the five unowned phone_call leads of the intake, each with «take» for the Admin');
SELECT pg_temp.t300_assert(
  pg_temp.t300_keys((:'t300_tab_all')::JSONB)
    = pg_temp.t300_sorted(pg_temp.t300_lead_keys(10, 11, 19, 30, 31) || ('lead:' || pg_temp.t300_id(5023)::TEXT))
  AND (:'t300_tab_all')::JSONB -> 'counts' -> 'phone_call' = '6'::JSONB
  AND (SELECT r -> 'owner' ->> 'membershipId' = pg_temp.t300_id(303)::TEXT AND r -> 'take' = 'null'::JSONB
    FROM jsonb_array_elements((:'t300_tab_all')::JSONB -> 'rows') r WHERE r ->> 'id' = pg_temp.t300_id(5023)::TEXT),
  '«Все» in «Звонки» adds the manual phone_call lead with its owner and no «take»');
SELECT pg_temp.t300_assert(
  (SELECT (r ->> 'phone') = pg_temp.t300_unknown(10) AND (r ->> 'personName') LIKE 'Звонок +996 %'
    FROM jsonb_array_elements((:'t300_tab_all')::JSONB -> 'rows') r WHERE r ->> 'id' = pg_temp.t300_lead_of(10)::TEXT),
  'a row names the person by the mask and carries the phone, as for the other lead sources');
SELECT pg_temp.t300_q(1, 'all', 'all', 50) AS t300_v3_on \gset
SELECT pg_temp.t300_q(1, 'all', 'all', 50, NULL, 1, 2) AS t300_v2_on \gset
SELECT pg_temp.t300_assert(
  ((:'t300_v3_on')::JSONB -> 'counts') - 'phone_call' = (:'t300_v2_on')::JSONB -> 'counts'
  AND ((:'t300_v3_on')::JSONB -> 'counts' ->> 'phone_call') = '6'
  AND pg_temp.t300_keys((:'t300_v3_on')::JSONB)
    = pg_temp.t300_sorted(pg_temp.t300_keys((:'t300_v2_on')::JSONB) || pg_temp.t300_keys((:'t300_tab_all')::JSONB))
  AND (:'t300_v2_on')::JSONB -> 'rows' = (SELECT COALESCE(jsonb_agg(r ORDER BY r ->> 'occurredAt' DESC, r ->> 'id' DESC), '[]'::JSONB)
    FROM jsonb_array_elements((:'t300_v2_on')::JSONB -> 'rows') r WHERE r ->> 'source' <> 'phone_call'),
  '«Все» of v3 is the rows of v2 plus the six phone_call leads; v2 itself never shows a phone_call row');
SELECT pg_temp.t300_assert(
  pg_temp.t300_q(1, 'phone_call', 'all', 50, NULL, 1, 2) ->> 'error' LIKE '22023:%',
  'v2 does not know the «phone_call» source (the previous release behaves as before)');
SELECT pg_temp.t300_q(1, 'all', 'waiting', 50) AS t300_all_waiting \gset
SELECT pg_temp.t300_assert(
  (:'t300_all_waiting')::JSONB -> 'counts' -> 'phone_call' = '5'::JSONB
  AND (SELECT count(*) FROM jsonb_array_elements((:'t300_all_waiting')::JSONB -> 'rows') r WHERE r ->> 'source' = 'phone_call') = 5
  AND (:'t300_all_waiting')::JSONB -> 'counts' -> 'website' = '1'::JSONB AND (:'t300_all_waiting')::JSONB -> 'counts' -> 'whatsapp' = '1'::JSONB,
  '«Ждут разбора» in «Все» counts the five calls next to the unowned website and WhatsApp leads');
SELECT pg_temp.t300_assert(
  (:'t300_tab_waiting')::JSONB ->> 'latestAt' = (SELECT to_char(max(l.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM platform.leads l WHERE l.organization_id = pg_temp.t300_id(1) AND l.source_key = 'phone_call' AND l.id <> pg_temp.t300_id(5023)),
  'the last request of the tab is the newest phone_call lead');

-- 8c. Paging: cursor version 3, bound to the source; a v2 cursor and a mismatched cursor are refused.
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 2) AS t300_p1 \gset
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 2, (:'t300_p1')::JSONB -> 'nextCursor') AS t300_p2 \gset
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 2, (:'t300_p2')::JSONB -> 'nextCursor') AS t300_p3 \gset
SELECT pg_temp.t300_assert(
  jsonb_array_length((:'t300_p1')::JSONB -> 'rows') = 2 AND jsonb_array_length((:'t300_p2')::JSONB -> 'rows') = 2
  AND jsonb_array_length((:'t300_p3')::JSONB -> 'rows') = 2 AND (:'t300_p3')::JSONB -> 'nextCursor' = 'null'::JSONB
  AND (:'t300_p1')::JSONB -> 'previousCursor' = 'null'::JSONB AND (:'t300_p2')::JSONB -> 'previousCursor' <> 'null'::JSONB
  AND (:'t300_p1')::JSONB -> 'nextCursor' ->> 'v' = '3' AND (:'t300_p1')::JSONB -> 'nextCursor' ->> 'source' = 'phone_call'
  AND (pg_temp.t300_keys((:'t300_p1')::JSONB) || pg_temp.t300_keys((:'t300_p2')::JSONB) || pg_temp.t300_keys((:'t300_p3')::JSONB))
    @> pg_temp.t300_keys((:'t300_tab_all')::JSONB)
  AND cardinality(pg_temp.t300_keys((:'t300_p1')::JSONB) || pg_temp.t300_keys((:'t300_p2')::JSONB) || pg_temp.t300_keys((:'t300_p3')::JSONB)) = 6,
  'three pages of two walk the six phone_call leads once each with version-3 cursors bound to the tab');
SELECT pg_temp.t300_q(1, 'phone_call', 'all', 2, (:'t300_p2')::JSONB -> 'previousCursor') AS t300_back \gset
SELECT pg_temp.t300_assert(pg_temp.t300_keys((:'t300_back')::JSONB) = pg_temp.t300_keys((:'t300_p1')::JSONB),
  'the previous cursor walks back to the first page');
SELECT pg_temp.t300_assert(
  pg_temp.t300_q(1, 'phone_call', 'all', 2, ((:'t300_p1')::JSONB -> 'nextCursor') || '{"v":2}') ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, 'phone_call', 'all', 2, ((:'t300_p1')::JSONB -> 'nextCursor') || '{"source":"website"}') ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, 'phone_call', 'all', 2, ((:'t300_p1')::JSONB -> 'nextCursor') || '{"kind":"application"}') ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, 'website', 'all', 2, (:'t300_p1')::JSONB -> 'nextCursor') ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, 'phone_call', 'all', 2, ((:'t300_p1')::JSONB -> 'nextCursor') || '{"extra":1}') ->> 'error' LIKE '22023:%',
  'a version-2 cursor, a cursor of another tab, another kind or with an extra key is refused with 22023');
SELECT pg_temp.t300_assert(
  pg_temp.t300_q(1, 'calls') ->> 'error' LIKE '22023:%' AND pg_temp.t300_q(1, 'all', 'pending') ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, 'all', 'all', 0) ->> 'error' LIKE '22023:%' AND pg_temp.t300_q(1, 'all', 'all', 51) ->> 'error' LIKE '22023:%'
  AND pg_temp.t300_q(1, NULL) ->> 'error' LIKE '22023:%',
  'an unknown source, an unknown state and a limit outside 1..50 are 22023');

-- 8d. The shape is exact.
SELECT pg_temp.t300_assert(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((:'t300_v3_on')::JSONB) k)
    = ARRAY['counts', 'latestAt', 'limit', 'nextCursor', 'organizationId', 'phoneCalls', 'previousCursor', 'rows', 'source', 'states',
      'status', 'version']
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((:'t300_v3_on')::JSONB -> 'counts') k)
    = ARRAY['application', 'consultation', 'phone_call', 'website', 'whatsapp']
  AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((:'t300_tab_all')::JSONB -> 'rows' -> 0) k)
    = ARRAY['email', 'handedOff', 'id', 'kind', 'leadId', 'occurredAt', 'owner', 'personName', 'phone', 'source', 'take'],
  'the response, its counts and a lead row carry exactly the keys the application contract parses');

-- 8e. Who sees the calls.
SELECT pg_temp.t300_assert(
  pg_temp.t300_q(11) ->> 'error' LIKE '42501:%' AND pg_temp.t300_q(1, 'all', 'all', 50, NULL, 2) ->> 'error' LIKE '42501:%'
  AND pg_temp.t300_as('anon', '{"role":"anon"}', format('SELECT platform.staff_requests_queue_v3(%L, %L, %L, 50)',
    pg_temp.t300_id(1), 'all', 'all')) = '42501'
  AND pg_temp.t300_as('service_role', '{"role":"service_role"}', format('SELECT platform.staff_requests_queue_v3(%L, %L, %L, 50)',
    pg_temp.t300_id(1), 'all', 'all')) = '42501',
  'a Student, the wrong organization, anon and service_role cannot read the queue');
SELECT pg_temp.t300_q(3) AS t300_s1_page \gset
SELECT pg_temp.t300_q(13, 'phone_call') AS t300_nobody_page \gset
SELECT pg_temp.t300_assert(
  (:'t300_s1_page')::JSONB -> 'states' ->> 'lead' = 'forbidden' AND (:'t300_s1_page')::JSONB -> 'phoneCalls' = 'false'::JSONB
  AND (:'t300_s1_page')::JSONB -> 'rows' = '[]'::JSONB AND (:'t300_s1_page')::JSONB -> 'counts' -> 'phone_call' = 'null'::JSONB
  AND (:'t300_nobody_page')::JSONB -> 'phoneCalls' = 'false'::JSONB AND (:'t300_nobody_page')::JSONB -> 'rows' = '[]'::JSONB
  AND (:'t300_nobody_page')::JSONB -> 'counts' -> 'phone_call' = 'null'::JSONB,
  'a member who cannot read leads sees no call, no number and no row, however the switch stands');
SELECT pg_temp.t300_q(7, 'phone_call', 'all', 50, NULL, 2) AS t300_org2_page \gset
SELECT pg_temp.t300_assert(
  jsonb_array_length((:'t300_org2_page')::JSONB -> 'rows') = 2 AND (:'t300_org2_page')::JSONB -> 'counts' -> 'phone_call' = '2'::JSONB
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'t300_org2_page')::JSONB -> 'rows') r
    WHERE r ->> 'id' IN (SELECT lead_id::TEXT FROM platform_private.telephony_calls WHERE organization_id = pg_temp.t300_id(1) AND lead_id IS NOT NULL))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'t300_tab_all')::JSONB -> 'rows') r
    WHERE r ->> 'id' IN (pg_temp.t300_id(5090)::TEXT, pg_temp.t300_lead_of(91)::TEXT)),
  'each organization sees its own phone_call leads only');
-- A lead that is no longer open leaves the tab and its number.
UPDATE platform.leads SET lifecycle_state = 'archived' WHERE id = pg_temp.t300_lead_of(31);
SELECT pg_temp.t300_q(1, 'phone_call', 'all') AS t300_after_close \gset
SELECT pg_temp.t300_assert((:'t300_after_close')::JSONB -> 'counts' -> 'phone_call' = '5'::JSONB
  AND NOT (pg_temp.t300_lead_key(31) = ANY (pg_temp.t300_keys((:'t300_after_close')::JSONB))),
  'a closed phone_call lead leaves the tab and the count');
-- Turning telephony ui off again hides the calls again.
UPDATE platform_private.telephony_settings SET ui_enabled = FALSE WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_q(1, 'all', 'all') AS t300_off_again \gset
SELECT pg_temp.t300_assert((:'t300_off_again')::JSONB -> 'phoneCalls' = 'false'::JSONB AND (:'t300_off_again')::JSONB -> 'counts' -> 'phone_call' = 'null'::JSONB
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'t300_off_again')::JSONB -> 'rows') r WHERE r ->> 'source' = 'phone_call'),
  'switching telephony ui off hides the calls at once');

-- ---------------------------------------------------------------------------
-- 9. The hand-off to the missed-call slice (T8): a MISSED unknown call becomes a lead here and one
--    «Перезвонить» task there (for the escalation recipient: the lead has no owner). The order matters and is
--    the maintenance script's order: the intake first, then the missed-call tick; if the missed-call tick sees
--    the call first it leaves it for this slice and no task is made.
-- ---------------------------------------------------------------------------
UPDATE platform_private.telephony_settings SET projection_enabled = TRUE, unknown_lead_enabled = TRUE, missed_task_enabled = TRUE
  WHERE organization_id = pg_temp.t300_id(1);
SELECT pg_temp.t300_mk(95, 'in', 'missed', INTERVAL '5 minutes', pg_temp.t300_unknown(95));
SELECT pg_temp.t300_mk(96, 'in', 'answered', INTERVAL '4 minutes', pg_temp.t300_unknown(96));
SELECT pg_temp.t300_tick() AS t300_h1 \gset
SELECT pg_temp.t300_assert((:'t300_h1')::JSONB ->> 'created' = '2', 'the intake made the two leads first');
SELECT platform.telephony_automation_tick_v1(pg_temp.t300_id(1), 100) AS t300_h2 \gset
SELECT pg_temp.t300_assert((:'t300_h2')::JSONB ->> 'status' = 'ok', 'the missed-call tick runs after the intake: ' || :'t300_h2');
SELECT pg_temp.t300_assert(
  (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t300_id(7095) AND l.kind = 'missed_callback'
    AND l.lead_id = pg_temp.t300_lead_of(95) AND l.closed_at IS NULL) = 1
  AND (SELECT t.assignee_membership_id FROM platform_private.telephony_task_links l JOIN platform.staff_tasks t ON t.id = l.task_id
    WHERE l.call_id = pg_temp.t300_id(7095) AND l.kind = 'missed_callback') = pg_temp.t300_id(306)
  AND (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t300_id(7096)) = 0,
  'a missed unknown call gets exactly one «Перезвонить» for the escalation recipient on the created lead; the answered one gets none');
-- The wrong order: the missed-call tick first leaves an unknown number for this slice and makes no task.
SELECT pg_temp.t300_mk(97, 'in', 'missed', INTERVAL '3 minutes', pg_temp.t300_unknown(97));
SELECT platform.telephony_automation_tick_v1(pg_temp.t300_id(1), 100);
SELECT pg_temp.t300_tick();
SELECT pg_temp.t300_assert(
  (SELECT automation_outcome FROM platform_private.telephony_calls WHERE id = pg_temp.t300_id(7097)) = 'skipped_unmatched'
  AND pg_temp.t300_mark(97) = 'lead_created'
  AND (SELECT count(*) FROM platform_private.telephony_task_links l WHERE l.call_id = pg_temp.t300_id(7097)) = 0,
  'in the wrong order the lead is still made but nobody is told: the maintenance script runs the intake first');
-- The task ceiling and the kinds of the two slices share one count: T8 tasks and client_no_lead links add up.
SELECT pg_temp.t300_assert(
  platform_private.telephony_intake_ceiling_code(pg_temp.t300_id(1), 'tasks') IS NULL
  AND platform_private.telephony_intake_ceiling_code(pg_temp.t300_id(1), 'leads') IS NULL
  AND pg_temp.t300_try($q$SELECT platform_private.telephony_intake_ceiling_code('30010000-0000-4000-8000-000000000001', 'x')$q$) = '22023',
  'the ceilings are quiet at this volume, and an unknown ceiling kind is 22023');

\echo T300_TELEPHONY_UNKNOWN_LEADS_SUITE_END
\echo T300_TELEPHONY_UNKNOWN_LEADS_SUITE_PASSED
ROLLBACK;
