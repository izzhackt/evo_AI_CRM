\set ON_ERROR_STOP on
-- Boundary suite for migration 309 (A4 «лёгкий опрос»: one RPC for the Student cabinet
-- tab and one for the CRM bell). Runs on the LATEST chain with members modelled like
-- production after 155: invited staff have coarse role NULL and get permissions only from
-- scoped role assignments with the production keys (as 281's and 306's suites); the Student
-- cabinets are the activated-case snapshots of 180/192/200 (replica-mode insert, every
-- CHECK and FK still applies). Commands run through the real RPCs as the real actor:
-- help question and answer, mark read, route / stage, payment obligation,
-- document slot and review, the cabinet chat, staff tasks and staff notifications.
-- Isolated synthetic SQL fixtures only; the transaction ends in ROLLBACK.
--
-- platform.student_portal_poll_v1(section) -> {access, unread, version}
--  S1 the contract: three keys exactly, access boolean, unread number, version a 32-hex
--     string; the same version on two calls for every section, and in any session TimeZone;
--  S2 what changes the version of which section: a new notification and a mark-as-read
--     (every section), a stage change (every section: the case row is in every version),
--     a payment obligation (payments, home, admission), a document slot
--     and a review (documents, home, admission), a cabinet chat message from either side
--     (messages only); nothing else is touched (payments never moves with the chat, the
--     documents never move with a payment, the notification list never moves with either);
--  S3 the access tiers: an assisted Student reads everything; a Student whose case is
--     only approved (pending) gets a version for every section but «messages», where the
--     chat refuses with 42501 and the answer is version = null instead of an error;
--  S4 access: Admin, Sales, Curator, another organization's Admin, a session with no
--     membership, a suspended Student and a Student with a blocked profile (fresh and
--     stale token) get exactly {"access": false}; a Student never sees another Student's
--     or another organization's rows or changes;
--  S5 posture: STABLE, SECURITY DEFINER, empty search_path, EXECUTE for authenticated only
--     (anon, service_role, supabase_auth_admin, evo_ai_agent refused with 42501); an invalid
--     section is 22023 with a constant message; the call runs inside a READ ONLY transaction;
--  S6 the answer carries no data value (no name, amount, message or answer text).
-- platform.staff_notifications_state_v1() -> {access, unread, version}
--  B1 Admin, Sales Manager and Curator (coarse role NULL) get access, unread = the page's
--     unread_count and version = md5 of the page staff_notifications_page_v2 returns;
--     stable on a repeat, changes with a new notification and with mark-as-read;
--  B2 the side effect stays: the poll CALLS the page, so the due-tomorrow (and the timed
--     within-24h) reminder is created by the poll itself, once, and neutralized when the
--     task is done;
--  B3 a Student and a session without membership get {"access": false}; anon, service_role,
--     supabase_auth_admin and evo_ai_agent are refused; VOLATILE, SECURITY DEFINER, empty
--     search_path; it cannot run in a READ ONLY transaction (it writes by design).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p309_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('30900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE TEMP TABLE p309_checks(n INTEGER);
CREATE FUNCTION pg_temp.p309_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P309: %', message; END IF;
  INSERT INTO p309_checks VALUES (1);
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p309_id(INTEGER) TO authenticated, anon, service_role;

SELECT 'P309_PORTAL_LIGHT_POLL_SUITE_START' AS p309_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. Organization one: 1 Admin (system), 2 Sales Manager and 3 Curator (coarse
-- role NULL, production roles below), 8 a second system Admin (the one who assigns tasks),
-- Students 4 (A, assisted), 5 (B, only approved: pending case), 6 (C, assisted, the
-- neighbour), 9 (E) and 10 (F), whose access is withdrawn later. Organization two:
-- 11 Admin, 13 Sales, 14 Curator and Student 7 (D). 12 is an Auth user with no membership.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p309_actors(n INTEGER, org INTEGER, coarse platform.business_role);
INSERT INTO p309_actors(n, org, coarse) VALUES
  (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, 'student'), (5, 1, 'student'),
  (6, 1, 'student'), (7, 2, 'student'), (8, 1, 'admin'), (9, 1, 'student'), (10, 1, 'student'),
  (11, 2, 'admin'), (13, 2, 'sales'), (14, 2, 'curator');

INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.p309_id(1), 'P309 Fictional organization one'),
  (pg_temp.p309_id(2), 'P309 Fictional organization two');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p309_id(100 + n), 'p309-' || n || '@example.invalid', '{}'::JSONB FROM p309_actors
  UNION ALL SELECT pg_temp.p309_id(112), 'p309-12@example.invalid', '{}'::JSONB;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p309_id(200 + n), pg_temp.p309_id(100 + n), 'P309 Actor ' || n, 'active', 1 FROM p309_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.p309_id(300 + a.n), pg_temp.p309_id(a.org), pg_temp.p309_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    COALESCE(a.coarse = 'admin', FALSE)
  FROM p309_actors a;

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.p309_id(401), pg_temp.p309_id(1), 'organization', pg_temp.p309_id(1), 1),
  (pg_temp.p309_id(402), pg_temp.p309_id(2), 'organization', pg_temp.p309_id(2), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.p309_id(410 + a.n), pg_temp.p309_id(a.org), 'student_case', pg_temp.p309_id(500 + a.n), 1
  FROM p309_actors a WHERE a.coarse = 'student';
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p309_id(a.org), pg_temp.p309_id(300 + a.n), pg_temp.p309_id(400 + a.org), 1, 1, TRUE, 'system',
    'P309 synthetic organization scope', pg_temp.p309_id(600 + a.n)
  FROM p309_actors a;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p309_id(a.org), pg_temp.p309_id(300 + a.n), pg_temp.p309_id(410 + a.n), 1, 1, TRUE, 'system',
    'P309 own case scope', pg_temp.p309_id(620 + a.n)
  FROM p309_actors a WHERE a.coarse = 'student';

-- Already-provisioned case snapshots (the p135/p192/p200 convention): the 042 BEFORE
-- trigger forbids pre-activated inserts, so replica mode skips it while every table
-- CHECK/FK still applies. Case n = 500 + the Student's number; B's case is pending.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, contract_confirmation_ref,
  contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version
)
SELECT pg_temp.p309_id(500 + a.n), pg_temp.p309_id(a.org), pg_temp.p309_id(300 + a.n),
  pg_temp.p309_id(300 + CASE WHEN a.org = 1 THEN 2 ELSE 13 END),
  pg_temp.p309_id(300 + CASE WHEN a.org = 1 THEN 3 ELSE 14 END),
  'synthetic:p309:assisted-' || a.n, 'synthetic:p309:contract-' || a.n,
  clock_timestamp(), 'P309 Student ' || a.n, 'China', 'Bachelor',
  'Engineering', '2027', 'approved', 'documents', 'active',
  clock_timestamp(), clock_timestamp(), pg_temp.p309_id(410 + a.n), 1
FROM p309_actors a WHERE a.coarse = 'student' AND a.n <> 5;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree,
  program_direction, operational_stage, state, portal_activated_at,
  current_scope_id, current_scope_version
) VALUES (
  pg_temp.p309_id(505), pg_temp.p309_id(1), pg_temp.p309_id(305), pg_temp.p309_id(302),
  'synthetic:p309:approved-cabinet', 'P309 Student 5', 'China', 'Bachelor',
  'Engineering', 'intake_review', 'pending', clock_timestamp(),
  pg_temp.p309_id(415), 1
);
SET LOCAL session_replication_role = origin;

-- Tokens come from the real hook on live rows (a Student carries the pre-scoped claims,
-- invited staff coarse role NULL, a user with no membership only sub and role).
CREATE FUNCTION pg_temp.p309_claims(p_user INTEGER) RETURNS TEXT LANGUAGE sql AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p309_id(100 + p_user),
    'claims', jsonb_build_object('sub', pg_temp.p309_id(100 + p_user), 'role', 'authenticated')))->'claims')::TEXT
$$;

-- Roles with the EXACT production permission keys (as 281's and 306's suites): Admissions for
-- the Curator (own scope, so it works its own cases), Sales Manager for the Sales member.
CREATE TEMP TABLE p309_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO p309_roles VALUES
 (pg_temp.p309_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.p309_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130);
CREATE TEMP TABLE p309_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO p309_grants VALUES
 (303, pg_temp.p309_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (302, pg_temp.p309_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.p309_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE p309_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.p309_id(1);
GRANT SELECT ON p309_roles, p309_grants, p309_versions TO authenticated;

SELECT pg_temp.p309_claims(1) AS p309_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p309_admin_setup';
SET LOCAL ROLE authenticated;
DO $p309_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM p309_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p309_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P309 ' || r.label, 'description', 'Migration 309 synthetic role',
        'permissionKeys', r.keys), 'P309 create role', pg_temp.p309_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p309_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p309_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P309 publish role', pg_temp.p309_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p309_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM p309_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.p309_id(1), pg_temp.p309_id(m),
      (SELECT access_version FROM p309_versions WHERE membership_id = pg_temp.p309_id(m)), items, bindings,
      'P309 grant roles', pg_temp.p309_id(2000 + m));
  END LOOP;
END
$p309_roles$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Helpers. A call "as user n" sets the claims (live, from the hook) and the database role
-- for that call only, then resets the role; an error leaves the role as it was.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p309_run(p_user INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.p309_claims(p_user), TRUE);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO r;
  RESET ROLE;
  RETURN r;
END
$$;
-- The SQLSTATE of the call, or 'ok'.
CREATE FUNCTION pg_temp.p309_try(p_user INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.p309_run(p_user, p_sql);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END
$$;
-- SQLSTATE and message of the call, or 'ok'.
CREATE FUNCTION pg_temp.p309_try_msg(p_user INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.p309_run(p_user, p_sql);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The same, as a database role without a user (anon, service_role, ...) or with explicit claims.
CREATE FUNCTION pg_temp.p309_try_role(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql;
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.p309_poll(p_user INTEGER, p_section TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.p309_run(p_user, format('SELECT platform.student_portal_poll_v1(%L)', p_section))::JSONB;
END
$$;
CREATE FUNCTION pg_temp.p309_poll_claims(p_claims TEXT, p_section TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  r := platform.student_portal_poll_v1(p_section);
  RESET ROLE;
  RETURN r;
END
$$;
CREATE FUNCTION pg_temp.p309_state(p_user INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.p309_run(p_user, 'SELECT platform.staff_notifications_state_v1()')::JSONB;
END
$$;
-- The bell page itself, as the same member.
CREATE FUNCTION pg_temp.p309_page(p_user INTEGER, p_org INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.p309_run(p_user,
    format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.p309_id(p_org)))::JSONB;
END
$$;

-- Snapshots of the answer for all seven sections, and the sections whose version moved
-- between two snapshots, in the canonical order.
CREATE TEMP TABLE p309_snap(label TEXT, user_n INTEGER, ord INTEGER, section TEXT, answer JSONB);
CREATE FUNCTION pg_temp.p309_take(p_label TEXT, p_user INTEGER) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO p309_snap(label, user_n, ord, section, answer)
  SELECT p_label, p_user, s.ord, s.name, pg_temp.p309_poll(p_user, CASE WHEN s.name = 'default' THEN NULL ELSE s.name END)
  FROM (VALUES (1, 'default'), (2, 'home'), (3, 'admission'), (4, 'documents'), (5, 'payments'),
    (6, 'notifications'), (7, 'messages')) AS s(ord, name)
$$;
CREATE FUNCTION pg_temp.p309_moved(p_from TEXT, p_to TEXT, p_user INTEGER) RETURNS TEXT LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(a.section, ',' ORDER BY a.ord), '')
  FROM p309_snap a JOIN p309_snap b ON b.user_n = a.user_n AND b.section = a.section
  WHERE a.label = p_from AND b.label = p_to AND a.user_n = p_user
    AND (a.answer -> 'version') IS DISTINCT FROM (b.answer -> 'version')
$$;
CREATE FUNCTION pg_temp.p309_version(p_label TEXT, p_user INTEGER, p_section TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT answer ->> 'version' FROM p309_snap WHERE label = p_label AND user_n = p_user AND section = p_section
$$;
-- A student's unread count straight from the source the bell reads.
CREATE FUNCTION pg_temp.p309_source_unread(p_user INTEGER) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT pg_temp.p309_run(p_user,
    'SELECT count(*) FILTER (WHERE read_at IS NULL) FROM platform.student_portal_notifications_v2()')::BIGINT
$$;

-- ===========================================================================
-- S5a. The catalog and the posture of both functions.
-- ===========================================================================
SELECT pg_temp.p309_assert(
  (SELECT p.prorettype = 'jsonb'::REGTYPE AND p.prosecdef AND p.provolatile = 's'
      AND p.proconfig @> ARRAY['search_path=""'] AND p.pronargs = 1 AND p.pronargdefaults = 1
      AND pg_get_function_arguments(p.oid) = 'p_section text DEFAULT NULL::text'
    FROM pg_proc p WHERE p.oid = 'platform.student_portal_poll_v1(text)'::REGPROCEDURE),
  'the Student poll is a STABLE SECURITY DEFINER JSONB function with an empty search_path and one defaulted section');
SELECT pg_temp.p309_assert(
  (SELECT p.prorettype = 'jsonb'::REGTYPE AND p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig = ARRAY['search_path=""'] AND p.pronargs = 0
    FROM pg_proc p WHERE p.oid = 'platform.staff_notifications_state_v1()'::REGPROCEDURE),
  'the staff poll is a VOLATILE SECURITY DEFINER JSONB function with exactly an empty search_path');
SELECT pg_temp.p309_assert(
  bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE')
    AND NOT has_function_privilege('service_role', f, 'EXECUTE')
    AND NOT has_function_privilege('supabase_auth_admin', f, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', f, 'EXECUTE')
    AND NOT has_function_privilege('public', f, 'EXECUTE')),
  'both polls are executable by authenticated and by no other role, PUBLIC included')
  FROM unnest(ARRAY['platform.student_portal_poll_v1(text)'::REGPROCEDURE,
    'platform.staff_notifications_state_v1()'::REGPROCEDURE]) AS f;
SELECT pg_temp.p309_assert(
  (SELECT bool_and(obj_description(f, 'pg_proc') IS NOT NULL)
    FROM unnest(ARRAY['platform.student_portal_poll_v1(text)'::REGPROCEDURE,
      'platform.staff_notifications_state_v1()'::REGPROCEDURE]) AS f)
  AND obj_description('platform.staff_notifications_state_v1()'::REGPROCEDURE, 'pg_proc') LIKE '%staff_notifications_page_v2%'
  AND obj_description('platform.staff_notifications_state_v1()'::REGPROCEDURE, 'pg_proc') LIKE '%reminders%',
  'both polls are commented, and the staff comment names the page it calls and the reminders it keeps alive');
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('student_portal_poll_v1', 'staff_notifications_state_v1')),
  'exactly one overload of each poll exists');

-- ===========================================================================
-- S1. The contract on a Student with an assisted case (A, 4) and nothing to read yet.
-- ===========================================================================
SELECT pg_temp.p309_take('a_base', 4);
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 7 AND bool_and((answer ->> 'access')::BOOLEAN AND answer ->> 'version' ~ '^[0-9a-f]{32}$'
      AND jsonb_typeof(answer -> 'access') = 'boolean' AND jsonb_typeof(answer -> 'unread') = 'number'
      AND jsonb_typeof(answer -> 'version') = 'string' AND (answer ->> 'unread')::INTEGER = 0)
    FROM p309_snap WHERE label = 'a_base' AND user_n = 4),
  'an assisted Student gets access, unread 0 and a 32-hex version for every section, messages included');
SELECT pg_temp.p309_assert(
  (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(answer) AS k) = ARRAY['access', 'unread', 'version'])
    FROM p309_snap WHERE label = 'a_base'),
  'the answer has exactly the keys access, unread and version');
SELECT pg_temp.p309_take('a_base_again', 4);
SELECT pg_temp.p309_assert(pg_temp.p309_moved('a_base', 'a_base_again', 4) = '',
  'two polls in a row give the same version for every section');
SELECT pg_temp.p309_assert(
  pg_temp.p309_poll(4) = pg_temp.p309_poll(4) AND pg_temp.p309_poll(4, 'home') = pg_temp.p309_poll(4, 'home'),
  'the whole answer repeats byte for byte');

-- The neighbours: C (6, same organization) and D (7, the other organization) before anything happens to A.
SELECT pg_temp.p309_take('c_base', 6);
SELECT pg_temp.p309_take('d_base', 7);
SELECT pg_temp.p309_assert(
  (SELECT bool_and((answer ->> 'access')::BOOLEAN AND (answer ->> 'unread')::INTEGER = 0 AND answer ->> 'version' ~ '^[0-9a-f]{32}$')
    FROM p309_snap WHERE label IN ('c_base', 'd_base')),
  'the neighbours of A (the same organization and the other one) have their own cabinets');

-- ===========================================================================
-- S2. What moves which version. A's changes, one at a time, each against the snapshot before.
-- ===========================================================================
-- (a) A asks a question: nothing the cabinet reads changes yet (a question is no notification).
SELECT r ->> 'id' AS p309_help_one
  FROM (SELECT pg_temp.p309_run(4, format('SELECT platform.create_case_help_request_v1(%L,%L,%L)',
    'P309 question one', 'P309 question body one', pg_temp.p309_id(801)))::JSONB AS r) q \gset
SELECT pg_temp.p309_take('a_asked', 4);
SELECT pg_temp.p309_assert(pg_temp.p309_moved('a_base', 'a_asked', 4) = '',
  'a question the Student asks moves no version and adds no unread');

-- (b) The Curator answers: a new notification reaches the Student. Every version moves.
SELECT pg_temp.p309_run(3, format('SELECT platform.answer_case_help_request_v1(%L,%L,%L,1,%L)',
  pg_temp.p309_id(504), :'p309_help_one', 'P309 answer text one', pg_temp.p309_id(802)));
SELECT pg_temp.p309_take('a_notified', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_asked', 'a_notified', 4) = 'default,home,admission,documents,payments,notifications,messages',
  'a new notification moves the version of every section');
SELECT pg_temp.p309_assert(
  (SELECT bool_and((answer ->> 'unread')::INTEGER = 1) FROM p309_snap WHERE label = 'a_notified')
    AND pg_temp.p309_source_unread(4) = 1,
  'unread is the number of unread rows of the source the bell reads');
SELECT id AS p309_notification_one FROM platform.notifications
  WHERE organization_id = pg_temp.p309_id(1) AND recipient_membership_id = pg_temp.p309_id(304)
    AND category = 'case_help.answer' \gset

-- (c) The Student reads it. Every version moves; replaying the same request moves nothing.
SELECT pg_temp.p309_run(4, format('SELECT platform.mark_own_student_portal_notification_read_v2(%L,%L)',
  :'p309_notification_one', pg_temp.p309_id(803)));
SELECT pg_temp.p309_take('a_read', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_notified', 'a_read', 4) = 'default,home,admission,documents,payments,notifications,messages'
    AND (SELECT bool_and((answer ->> 'unread')::INTEGER = 0) FROM p309_snap WHERE label = 'a_read')
    AND pg_temp.p309_source_unread(4) = 0,
  'marking the notification as read moves the version of every section and unread drops to 0');
SELECT pg_temp.p309_run(4, format('SELECT platform.mark_own_student_portal_notification_read_v2(%L,%L)',
  :'p309_notification_one', pg_temp.p309_id(803)));
SELECT pg_temp.p309_take('a_read_replayed', 4);
SELECT pg_temp.p309_assert(pg_temp.p309_moved('a_read', 'a_read_replayed', 4) = '',
  'replaying the mark-as-read request moves nothing');

-- (d) A second question and answer: several notifications, one of them read.
SELECT r ->> 'id' AS p309_help_two
  FROM (SELECT pg_temp.p309_run(4, format('SELECT platform.create_case_help_request_v1(%L,%L,%L)',
    'P309 question two', 'P309 question body two', pg_temp.p309_id(804)))::JSONB AS r) q \gset
SELECT pg_temp.p309_run(3, format('SELECT platform.answer_case_help_request_v1(%L,%L,%L,1,%L)',
  pg_temp.p309_id(504), :'p309_help_two', 'P309 answer text two', pg_temp.p309_id(805)));
SELECT pg_temp.p309_take('a_two', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_read_replayed', 'a_two', 4) = 'default,home,admission,documents,payments,notifications,messages'
    AND (SELECT bool_and((answer ->> 'unread')::INTEGER = 1) FROM p309_snap WHERE label = 'a_two')
    AND pg_temp.p309_source_unread(4) = 1,
  'a second notification arrives unread next to the read one: unread is 1, not 2');

-- (e) The stage is changed by staff: the case row is part of every version.
SELECT pg_temp.p309_run(1, format('SELECT platform.set_student_case_route(%L,%L,%L,%L,%L,%L,NULL,NULL,%L,%L,%L,%L,%L)',
  pg_temp.p309_id(1), pg_temp.p309_id(504), 'China', 'Bachelor', 'Engineering', '2027', 'approved', 'applications', NULL,
  'P309 stage change', pg_temp.p309_id(806)));
SELECT pg_temp.p309_take('a_stage', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_two', 'a_stage', 4) = 'default,home,admission,documents,payments,notifications,messages'
    AND (SELECT bool_and((answer ->> 'unread')::INTEGER = 1) FROM p309_snap WHERE label = 'a_stage'),
  'a stage change by staff moves the version of every section and leaves unread alone');

-- (f) A payment obligation: payments, home and admission read finance.
SELECT r ->> 'payment_obligation_id' AS p309_obligation
  FROM (SELECT pg_temp.p309_run(1, format('SELECT platform.create_payment_obligation(%L,%L,%L,%L,%s,%L,%L,%L,%L,%L)',
    pg_temp.p309_id(1), pg_temp.p309_id(504), 'P309 fee label', 'evo_service_fee', 123456, 'USD',
    (statement_timestamp() + INTERVAL '10 days')::TEXT, 'P309 pay now', 'P309 obligation reason', pg_temp.p309_id(807)))::JSONB AS r) q \gset
SELECT pg_temp.p309_take('a_obligation', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_stage', 'a_obligation', 4) = 'home,admission,payments',
  'a payment obligation moves payments, home and admission, and neither the documents, the notifications nor the chat');

-- (g) A document slot: documents, and home / admission through the Student action.
SELECT r ->> 'document_slot_id' AS p309_slot
  FROM (SELECT pg_temp.p309_run(1, format('SELECT platform.create_custom_document_slot(%L,%L,%L,%L,%L)',
    pg_temp.p309_id(1), pg_temp.p309_id(504), 'P309 slot label', 'P309 slot group', pg_temp.p309_id(809)))::JSONB AS r) q \gset
SELECT pg_temp.p309_take('a_slot', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_obligation', 'a_slot', 4) = 'home,admission,documents',
  'a new document slot moves documents, home and admission, and neither the payments, the notifications nor the chat');

-- (h) The Student submits a version of it (a fixture row, as 108's suite does: the upload
-- pipeline is a separate boundary), then staff review it through the real command.
INSERT INTO platform.document_versions (
  id, organization_id, student_case_id, document_slot_id, version_no,
  original_filename, declared_mime_type, byte_size, sha256_hex,
  ingest_evidence_ref, submitted_by_membership_id
) VALUES (
  pg_temp.p309_id(701), pg_temp.p309_id(1), pg_temp.p309_id(504), :'p309_slot', 1,
  'p309-letter.pdf', 'application/pdf', 1024, repeat('a', 64),
  'synthetic:p309:version', pg_temp.p309_id(304)
);
UPDATE platform.document_slots
  SET status = 'submitted', current_version_id = pg_temp.p309_id(701), current_version_no = 1
  WHERE id = :'p309_slot' AND organization_id = pg_temp.p309_id(1);
SELECT pg_temp.p309_take('a_submitted', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_slot', 'a_submitted', 4) = 'home,admission,documents',
  'a submitted version moves documents, home and admission only');
SELECT pg_temp.p309_run(1, format('SELECT platform.review_document_version(%L,%L,%L,%L,%L)',
  pg_temp.p309_id(1), pg_temp.p309_id(701), 'correction_required', 'P309 rework reason', pg_temp.p309_id(810)));
SELECT pg_temp.p309_take('a_reviewed', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_submitted', 'a_reviewed', 4) = 'home,admission,documents',
  'a review moves documents, home and admission, and neither the payments, the notifications nor the chat');
SELECT pg_temp.p309_assert(
  (SELECT (answer ->> 'unread')::INTEGER = 1 FROM p309_snap WHERE label = 'a_reviewed' AND section = 'default'),
  'the plain review sends no notification: unread did not move');

-- (i) The cabinet chat: the Student writes, then the Curator answers. Only «messages» moves.
SELECT pg_temp.p309_run(4, format('SELECT platform.portal_case_chat_post_v1(%L,%L)',
  pg_temp.p309_id(811), 'P309 chat text from the Student'));
SELECT pg_temp.p309_take('a_chat_in', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_reviewed', 'a_chat_in', 4) = 'messages',
  'a message from the Student moves the version of «messages» alone');
SELECT pg_temp.p309_run(3, format('SELECT platform.case_chat_command(%L,%L,%L,%L::JSONB)',
  pg_temp.p309_id(1), pg_temp.p309_id(504), pg_temp.p309_id(812),
  '{"mode":"post","body":"P309 chat text from the Curator","quotedMessageId":null,"attachmentKind":null,"attachmentId":null}'));
SELECT pg_temp.p309_take('a_chat_out', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_chat_in', 'a_chat_out', 4) = 'messages',
  'a message from staff moves the version of «messages» alone');
SELECT pg_temp.p309_assert(
  pg_temp.p309_version('a_chat_out', 4, 'payments') = pg_temp.p309_version('a_reviewed', 4, 'payments')
    AND pg_temp.p309_version('a_chat_out', 4, 'documents') = pg_temp.p309_version('a_reviewed', 4, 'documents')
    AND pg_temp.p309_version('a_chat_out', 4, 'notifications') = pg_temp.p309_version('a_reviewed', 4, 'notifications'),
  'the chat never moves payments, documents or notifications');

-- (j) The version does not depend on the session time zone, now that every section holds timestamps.
SET LOCAL TIME ZONE 'Asia/Bishkek';
SELECT pg_temp.p309_take('a_tz_bishkek', 4);
SET LOCAL TIME ZONE 'America/Los_Angeles';
SELECT pg_temp.p309_take('a_tz_la', 4);
SET LOCAL TIME ZONE 'UTC';
SELECT pg_temp.p309_take('a_tz_utc', 4);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_chat_out', 'a_tz_utc', 4) = ''
    AND pg_temp.p309_moved('a_tz_utc', 'a_tz_bishkek', 4) = ''
    AND pg_temp.p309_moved('a_tz_utc', 'a_tz_la', 4) = '',
  'the version is the same in every session time zone (UTC, Asia/Bishkek, America/Los_Angeles)');

-- ===========================================================================
-- S4a. The neighbours did not move while A changed: C (same organization, same Curator)
-- and D (the other organization). Then A is left alone while they change.
-- ===========================================================================
SELECT pg_temp.p309_take('c_after', 6);
SELECT pg_temp.p309_take('d_after', 7);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('c_base', 'c_after', 6) = '' AND pg_temp.p309_moved('d_base', 'd_after', 7) = ''
    AND (SELECT bool_and((answer ->> 'unread')::INTEGER = 0) FROM p309_snap WHERE label IN ('c_after', 'd_after')),
  'nothing that happened to A reached the Student next door or the Student of another organization');
SELECT pg_temp.p309_run(6, format('SELECT platform.portal_case_chat_post_v1(%L,%L)',
  pg_temp.p309_id(813), 'P309 chat text from the neighbour'));
SELECT pg_temp.p309_run(11, format('SELECT platform.create_payment_obligation(%L,%L,%L,%L,%s,%L,%L,%L,%L,%L)',
  pg_temp.p309_id(2), pg_temp.p309_id(507), 'P309 other fee', 'evo_service_fee', 5000, 'KGS',
  (statement_timestamp() + INTERVAL '5 days')::TEXT, 'P309 pay', 'P309 other reason', pg_temp.p309_id(814)));
SELECT pg_temp.p309_take('a_neighbours_moved', 4);
SELECT pg_temp.p309_take('c_chat', 6);
SELECT pg_temp.p309_take('d_obligation', 7);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_tz_utc', 'a_neighbours_moved', 4) = '',
  'A did not move when the neighbour wrote in the chat and the other organization got an obligation');
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('c_after', 'c_chat', 6) = 'messages'
    AND pg_temp.p309_moved('d_after', 'd_obligation', 7) = 'home,admission,payments',
  'the neighbours do move, each in its own sections');

-- ===========================================================================
-- S3. A Student whose case is only approved (pending): everything but the chat.
-- ===========================================================================
SELECT pg_temp.p309_take('b_base', 5);
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 7 AND bool_and((answer ->> 'access')::BOOLEAN AND jsonb_typeof(answer -> 'unread') = 'number')
      AND count(*) FILTER (WHERE jsonb_typeof(answer -> 'version') = 'string' AND answer ->> 'version' ~ '^[0-9a-f]{32}$') = 6
      AND count(*) FILTER (WHERE section = 'messages' AND jsonb_typeof(answer -> 'version') = 'null') = 1
      AND bool_and(answer ? 'version')
    FROM p309_snap WHERE label = 'b_base'),
  'a pending Student has access and a version for every section but «messages», where version is JSON null');
SELECT pg_temp.p309_assert(
  pg_temp.p309_try(5, 'SELECT platform.portal_case_chat_page_v1(NULL)') = '42501',
  'the null version is the chat refusing the pending Student with 42501 (the cause, shown directly)');
SELECT pg_temp.p309_take('b_again', 5);
SELECT pg_temp.p309_assert(pg_temp.p309_moved('b_base', 'b_again', 5) = '',
  'the pending Student''s versions are stable too');

-- ===========================================================================
-- S4b. Access: everyone who is not an active Student gets {"access": false}, no error.
-- ===========================================================================
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_poll(u, s) = '{"access": false}'::JSONB)
    FROM unnest(ARRAY[1, 2, 3, 8, 11, 13, 14, 12]) AS u,
      unnest(ARRAY[NULL, 'home', 'admission', 'documents', 'payments', 'notifications', 'messages']) AS s),
  'Admin, Sales, Curator, the other organization''s staff and a session without membership get exactly {"access": false} for every section');

-- Withdrawn access: E's membership is suspended, F's profile is blocked. Their old tokens
-- (taken while they were active) and fresh ones are both refused.
CREATE TEMP TABLE p309_old_tokens(n INTEGER, claims TEXT);
INSERT INTO p309_old_tokens SELECT n, pg_temp.p309_claims(n) FROM generate_series(9, 10) AS n;
SELECT pg_temp.p309_assert(
  (pg_temp.p309_poll(9) ->> 'access')::BOOLEAN AND (pg_temp.p309_poll(10) ->> 'access')::BOOLEAN,
  'E and F have access while they are active');
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.p309_id(309);
UPDATE platform.profiles SET status = 'blocked' WHERE id = pg_temp.p309_id(210);
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_poll(u, s) = '{"access": false}'::JSONB)
    FROM unnest(ARRAY[9, 10]) AS u, unnest(ARRAY[NULL, 'home', 'messages']) AS s)
  AND (SELECT bool_and(pg_temp.p309_poll_claims(t.claims, s) = '{"access": false}'::JSONB)
    FROM p309_old_tokens t, unnest(ARRAY[NULL, 'home', 'messages']) AS s),
  'a suspended membership and a blocked profile get {"access": false}, with a fresh token and with the one issued before');

-- ===========================================================================
-- S5b. Errors and roles.
-- ===========================================================================
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_try(4, format('SELECT platform.student_portal_poll_v1(%L)', s)) = '22023')
    FROM unnest(ARRAY['bogus', '', ' home', 'home ', 'HOME', 'Home', 'admission;', 'home,documents', 'documents%']) AS s),
  'any value outside the seven allowed sections is 22023 (empty, other case and padded values included)');
SELECT pg_temp.p309_assert(
  pg_temp.p309_try_msg(4, 'SELECT platform.student_portal_poll_v1(''bogus'')') = '22023:portal_poll_section_invalid',
  'the invalid-section message is constant and does not echo the value');
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_try_role(r, NULL, q) = '42501')
    FROM unnest(ARRAY['anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent']) AS r,
      unnest(ARRAY['SELECT platform.student_portal_poll_v1(NULL)', 'SELECT platform.student_portal_poll_v1(''home'')',
        'SELECT platform.staff_notifications_state_v1()']) AS q),
  'anon, service_role, supabase_auth_admin and evo_ai_agent are refused with 42501 on both polls');
SELECT pg_temp.p309_assert(
  pg_temp.p309_try(4, 'SELECT platform.student_portal_poll_v1(NULL)') = 'ok'
    AND pg_temp.p309_try(1, 'SELECT platform.staff_notifications_state_v1()') = 'ok',
  'authenticated may call both');

-- ===========================================================================
-- S6. Nothing but the three keys: no name, amount, message, answer or label is in any answer.
-- ===========================================================================
SELECT pg_temp.p309_take('a_final', 4);
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 7 AND bool_and(
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(answer) AS k) = ARRAY['access', 'unread', 'version']
      AND answer::TEXT !~* 'P309|China|Bachelor|Engineering|USD|slot|chat|answer|question|rework|letter|applications|amount')
    FROM p309_snap WHERE label = 'a_final'),
  'the answers hold three keys and none of the names, amounts, labels or texts of the data behind them');

-- ===========================================================================
-- B1. The CRM bell. The Students' help questions and chat messages above already sent staff
-- notifications to the Admins and the Curator; the Sales Manager and the other organization
-- hold none.
-- ===========================================================================
SELECT pg_temp.p309_assert(
  (SELECT bool_and((pg_temp.p309_state(u) ->> 'access')::BOOLEAN
      AND jsonb_typeof(pg_temp.p309_state(u) -> 'unread') = 'number'
      AND pg_temp.p309_state(u) ->> 'version' ~ '^[0-9a-f]{32}$'
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.p309_state(u)) AS k) = ARRAY['access', 'unread', 'version'])
    FROM unnest(ARRAY[1, 2, 3, 8, 11]) AS u)
  AND (SELECT bool_and((pg_temp.p309_state(u) ->> 'unread')::INTEGER = 0) FROM unnest(ARRAY[2, 11]) AS u)
  AND (SELECT bool_and((pg_temp.p309_state(u) ->> 'unread')::INTEGER > 0) FROM unnest(ARRAY[1, 3, 8]) AS u),
  'Admin, Sales Manager and Curator (coarse role NULL) and another organization''s Admin get access, a number and a 32-hex version');
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_state(u) ->> 'version' = md5(pg_temp.p309_page(u, o)::TEXT)
      AND (pg_temp.p309_state(u) ->> 'unread')::BIGINT = (pg_temp.p309_page(u, o) ->> 'unread_count')::BIGINT)
    FROM (VALUES (1, 1), (2, 1), (3, 1), (8, 1), (11, 2)) AS t(u, o)),
  'version is md5 of the page staff_notifications_page_v2 returns, and unread is its unread_count');

-- Staff 8 assigns a task to Admin 1, to the Sales Manager and to the Curator.
SELECT jsonb_build_object('a1', pg_temp.p309_state(1), 'a2', pg_temp.p309_state(2), 'a3', pg_temp.p309_state(3),
  'a8', pg_temp.p309_state(8), 'a11', pg_temp.p309_state(11))::TEXT AS p309_state_before \gset
SELECT r ->> 'staff_task_id' AS p309_task_admin
  FROM (SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,0,NULL,%L,%L,NULL,%L,%L,%L::DATE,NULL)',
    pg_temp.p309_id(1), 'create', pg_temp.p309_id(901), 'P309 task for the Admin', pg_temp.p309_id(301), 'open', 'normal',
    ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 5)::TEXT))::JSONB AS r) q \gset
SELECT r ->> 'staff_task_id' AS p309_task_sales
  FROM (SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,0,NULL,%L,%L,NULL,%L,%L,%L::DATE,NULL)',
    pg_temp.p309_id(1), 'create', pg_temp.p309_id(902), 'P309 task for the Sales Manager', pg_temp.p309_id(302), 'open', 'normal',
    ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 5)::TEXT))::JSONB AS r) q \gset
SELECT r ->> 'staff_task_id' AS p309_task_curator
  FROM (SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,0,NULL,%L,%L,NULL,%L,%L,%L::DATE,NULL)',
    pg_temp.p309_id(1), 'create', pg_temp.p309_id(903), 'P309 task for the Curator', pg_temp.p309_id(303), 'open', 'normal',
    ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 5)::TEXT))::JSONB AS r) q \gset
SELECT pg_temp.p309_assert(
  (SELECT bool_and((pg_temp.p309_state(u) ->> 'unread')::INTEGER = (:'p309_state_before'::JSONB -> ('a' || u) ->> 'unread')::INTEGER + 1
      AND pg_temp.p309_state(u) ->> 'version' IS DISTINCT FROM (:'p309_state_before'::JSONB -> ('a' || u) ->> 'version')
      AND pg_temp.p309_state(u) ->> 'version' = md5(pg_temp.p309_page(u, 1)::TEXT)
      AND (pg_temp.p309_state(u) ->> 'unread')::BIGINT = (pg_temp.p309_page(u, 1) ->> 'unread_count')::BIGINT)
    FROM unnest(ARRAY[1, 2, 3]) AS u),
  'a new notification moves the version of its recipient and raises unread by one (Admin, Sales Manager, Curator)');
SELECT pg_temp.p309_assert(
  pg_temp.p309_state(8) = (:'p309_state_before'::JSONB -> 'a8') AND pg_temp.p309_state(11) = (:'p309_state_before'::JSONB -> 'a11'),
  'the one who assigned the tasks and the other organization''s Admin did not move');
SELECT pg_temp.p309_assert(
  pg_temp.p309_state(1) = pg_temp.p309_state(1) AND pg_temp.p309_state(2) = pg_temp.p309_state(2)
    AND pg_temp.p309_state(3) = pg_temp.p309_state(3),
  'the bell answer repeats on a second call while nothing changes');

-- Mark as read: one notification (Sales) and all (Curator).
SELECT id AS p309_staff_notification_sales FROM platform.staff_notifications
  WHERE organization_id = pg_temp.p309_id(1) AND recipient_membership_id = pg_temp.p309_id(302) AND kind = 'task_assigned' \gset
SELECT pg_temp.p309_state(2) ->> 'version' AS p309_sales_version_unread \gset
SELECT pg_temp.p309_state(3) ->> 'version' AS p309_curator_version_unread \gset
SELECT pg_temp.p309_state(1) AS p309_admin_state_unread \gset
SELECT pg_temp.p309_run(2, format('SELECT platform.mark_staff_notification_read(%L,%L)', pg_temp.p309_id(1), :'p309_staff_notification_sales'));
SELECT pg_temp.p309_run(3, format('SELECT platform.mark_all_staff_notifications_read(%L)', pg_temp.p309_id(1)));
SELECT pg_temp.p309_assert(
  (pg_temp.p309_state(2) ->> 'unread')::INTEGER = 0 AND pg_temp.p309_state(2) ->> 'version' <> :'p309_sales_version_unread'
    AND (pg_temp.p309_state(3) ->> 'unread')::INTEGER = 0 AND pg_temp.p309_state(3) ->> 'version' <> :'p309_curator_version_unread'
    AND pg_temp.p309_state(1) = :'p309_admin_state_unread'::JSONB,
  'marking as read moves the version and drops unread, for one notification and for all, and only for the reader');
SELECT pg_temp.p309_state(1) ->> 'version' AS p309_admin_version_unread \gset
SELECT pg_temp.p309_run(1, format('SELECT platform.mark_all_staff_notifications_read(%L)', pg_temp.p309_id(1)));
SELECT pg_temp.p309_assert(
  (pg_temp.p309_state(1) ->> 'unread')::INTEGER = 0 AND pg_temp.p309_state(1) ->> 'version' <> :'p309_admin_version_unread'
    AND pg_temp.p309_state(1) ->> 'version' = md5(pg_temp.p309_page(1, 1)::TEXT),
  'the Admin''s mark-all-as-read drops its unread to 0 and moves its version to the new page''s');

-- ===========================================================================
-- B2. The side effect is kept: the poll itself creates the reminders.
-- ===========================================================================
-- A task due tomorrow (Bishkek day) for the Sales Manager, and a timed task due in two hours
-- for the Curator. No page has been read since they were created.
SELECT r ->> 'staff_task_id' AS p309_task_due_tomorrow, r ->> 'version' AS p309_task_due_tomorrow_version
  FROM (SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,0,NULL,%L,%L,NULL,%L,%L,%L::DATE,NULL)',
    pg_temp.p309_id(1), 'create', pg_temp.p309_id(904), 'P309 task due tomorrow', pg_temp.p309_id(302), 'open', 'normal',
    ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)::TEXT))::JSONB AS r) q \gset
SELECT r ->> 'staff_task_id' AS p309_task_due_soon
  FROM (SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,0,NULL,%L,%L,NULL,%L,%L,NULL,%L::TIMESTAMPTZ)',
    pg_temp.p309_id(1), 'create', pg_temp.p309_id(905), 'P309 task due soon', pg_temp.p309_id(303), 'open', 'normal',
    (statement_timestamp() + INTERVAL '2 hours')::TEXT))::JSONB AS r) q \gset
SELECT pg_temp.p309_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_notifications WHERE kind = 'task_due'
    AND staff_task_id IN (:'p309_task_due_tomorrow', :'p309_task_due_soon')),
  'before the first poll no reminder exists');
SELECT pg_temp.p309_state(2) AS p309_sales_state_after, pg_temp.p309_state(3) AS p309_curator_state_after \gset
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 1 AND bool_and(read_at IS NULL AND recipient_membership_id = pg_temp.p309_id(302)
      AND event_key = 'task-reminder:' || :'p309_task_due_tomorrow' || ':'
        || ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)::TEXT)
    FROM platform.staff_notifications WHERE kind = 'task_due' AND staff_task_id = :'p309_task_due_tomorrow'),
  'the poll itself created the due-tomorrow reminder, once, for the assignee');
SELECT pg_temp.p309_assert(
  (SELECT count(*) = 1 AND bool_and(read_at IS NULL AND recipient_membership_id = pg_temp.p309_id(303))
    FROM platform.staff_notifications WHERE kind = 'task_due' AND staff_task_id = :'p309_task_due_soon'),
  'the poll itself created the within-24-hours reminder of a timed task, once, for the assignee');
SELECT pg_temp.p309_assert(
  (:'p309_sales_state_after'::JSONB ->> 'unread')::INTEGER = 2 AND (:'p309_curator_state_after'::JSONB ->> 'unread')::INTEGER = 2,
  'the reminders count in unread (the assignment notification plus the reminder, for the Sales Manager and for the Curator)');
-- A second and a third poll create no duplicate and change nothing.
SELECT pg_temp.p309_assert(
  pg_temp.p309_state(2) = :'p309_sales_state_after'::JSONB AND pg_temp.p309_state(3) = :'p309_curator_state_after'::JSONB
    AND (SELECT count(*) = 2 FROM platform.staff_notifications WHERE kind = 'task_due'
      AND staff_task_id IN (:'p309_task_due_tomorrow', :'p309_task_due_soon')),
  'repeated polls create no second reminder and the answer stays the same');
-- The reminder is on the page the bell opens, and the poll's version is that page's.
SELECT pg_temp.p309_assert(
  EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.p309_page(2, 1) -> 'items') AS item
    WHERE item ->> 'kind' = 'task_due' AND item ->> 'staff_task_id' = :'p309_task_due_tomorrow')
  AND pg_temp.p309_state(2) ->> 'version' = md5(pg_temp.p309_page(2, 1)::TEXT),
  'the reminder is on the page and in the version');
-- Completing the task neutralizes the reminder through the next poll.
SELECT pg_temp.p309_run(8, format('SELECT platform.mutate_staff_task(%L,%L,%L,%s,%L,NULL,NULL,NULL,%L,NULL,NULL,NULL)',
  pg_temp.p309_id(1), 'status', pg_temp.p309_id(906), :'p309_task_due_tomorrow_version', :'p309_task_due_tomorrow', 'done'));
SELECT pg_temp.p309_state(2) AS p309_sales_state_done \gset
SELECT pg_temp.p309_assert(
  (SELECT read_at IS NOT NULL FROM platform.staff_notifications WHERE kind = 'task_due' AND staff_task_id = :'p309_task_due_tomorrow')
    AND (SELECT count(*) = 2 FROM platform.staff_notifications WHERE recipient_membership_id = pg_temp.p309_id(302)
      AND staff_task_id = :'p309_task_due_tomorrow' AND read_at IS NULL AND kind IN ('task_assigned', 'task_updated'))
    AND (:'p309_sales_state_done'::JSONB ->> 'unread')::INTEGER = 2
    AND :'p309_sales_state_done'::JSONB ->> 'version' IS DISTINCT FROM :'p309_sales_state_after'::JSONB ->> 'version'
    AND :'p309_sales_state_done'::JSONB ->> 'version' = md5(pg_temp.p309_page(2, 1)::TEXT),
  'completing the task neutralized its reminder through the poll: the reminder is read, the assignment and the update stay unread, the version moved');

-- ===========================================================================
-- B3. Who is refused, and what the posture says.
-- ===========================================================================
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_state(u) = '{"access": false}'::JSONB) FROM unnest(ARRAY[4, 5, 6, 7, 12]) AS u),
  'Students and a session without membership get exactly {"access": false} from the bell poll');
SELECT pg_temp.p309_assert(
  (SELECT bool_and(pg_temp.p309_state(u) = '{"access": false}'::JSONB) FROM unnest(ARRAY[9, 10]) AS u),
  'a suspended Student and a Student with a blocked profile get {"access": false} from the bell poll');
SELECT pg_temp.p309_assert(
  pg_temp.p309_try(4, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL)', pg_temp.p309_id(1))) = '42501',
  'the page the poll calls refuses a Student with 42501 (so a Student could never get staff data from the poll)');
SELECT pg_temp.p309_assert(
  pg_temp.p309_state(11) ->> 'unread' = '0' AND pg_temp.p309_state(11) ->> 'version' = md5(pg_temp.p309_page(11, 2)::TEXT),
  'the other organization''s Admin sees none of organization one''s notifications');

-- ===========================================================================
-- S5c. The Student poll in a READ ONLY transaction; the staff poll is not allowed there (it writes by design).
-- ===========================================================================
SELECT pg_temp.p309_take('a_before_readonly', 4);
SELECT pg_temp.p309_take('b_before_readonly', 5);
SET LOCAL transaction_read_only = on;
SELECT pg_temp.p309_assert(current_setting('transaction_read_only') = 'on', 'the transaction is READ ONLY');
SELECT pg_temp.p309_take('a_readonly', 4);
SELECT pg_temp.p309_take('b_readonly', 5);
SELECT pg_temp.p309_assert(
  pg_temp.p309_moved('a_before_readonly', 'a_readonly', 4) = '' AND pg_temp.p309_moved('b_before_readonly', 'b_readonly', 5) = ''
    AND (SELECT count(*) = 14 AND bool_and((answer ->> 'access')::BOOLEAN) FROM p309_snap WHERE label IN ('a_readonly', 'b_readonly')),
  'the Student poll works in a READ ONLY transaction, for the assisted and the pending Student, and writes nothing');
SELECT pg_temp.p309_assert(
  pg_temp.p309_try(1, 'SELECT platform.staff_notifications_state_v1()') = '25006',
  'the staff poll cannot run in a READ ONLY transaction: it writes reminders by design');

SELECT 'P309_PORTAL_LIGHT_POLL_SUITE_PASSED' AS p309_suite_marker, count(*) AS p309_checks FROM p309_checks;
ROLLBACK;
