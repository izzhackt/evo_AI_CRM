\set ON_ERROR_STOP on
-- Boundary suite for migration 321 «Тревога о связи WhatsApp продаж» (docs/PLAN_CHANGES.md «2026-10-26 · Тревога о
-- связи WhatsApp продаж (миграция 321)»; runbook docs/runbooks/whatsapp-go-live.md). Runs on the real chain right after
-- 321 inside one transaction that is rolled back, with its own synthetic organizations, members, webhook events and
-- staff tasks: no WAHA, no WhatsApp, no message to anyone, no real person, no production action. The functions are
-- called through the same request.jwt.claims role gate the service path uses.
--
-- Proves:
--  1. posture: both tables are closed to every API role (RLS forced); the four public functions are definer functions
--     with an empty search_path and EXECUTE for service_role only; the five helpers are closed to every API role; anon,
--     authenticated, supabase_auth_admin, the AI agent role, service_role without the service claim and a plain
--     session without claims are refused (42501); argument errors are 22023 (session, organization, kind, status,
--     reason, restart);
--  2. read: an empty state; the database clock; the last customer inbound is the newest VERIFIED `message.any` webhook
--     of the session with fromMe = false inside 30 days - not an own message, not a rejected delivery, not a session
--     status or an ack, not another session, not another organization, not older than 30 days;
--  3. observe: the first call creates the run, a call without restart keeps the run start and moves the last seen,
--     restart starts a new run; the order since <= last seen holds;
--  4. open: one staff task per active system admin who can receive tasks (a suspended admin is skipped) plus the optional
--     sales head if assignable (a student, an unknown id and an admin who is already a recipient add nothing); each
--     task with its event, receipt, notification and system journal row, creator = assignee, priority, Bishkek due date,
--     Russian copy by kind and status, no phone number in any text; a second open of the same kind is "already_open"
--     and writes nothing; both kinds can be open together; the unique index refuses a second open row; nobody to give
--     a task to is an error and leaves no alert and no task;
--  5. resolve: open tasks become done with an event and a system journal row, a task a human already closed or
--     cancelled is left as it is, the alert records the reason, a second resolve is "resolved: false", the next case is a
--     new alert, another organization is untouched, a wrong kind or reason is refused (22023).
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo A321_WHATSAPP_HEALTH_ALERTS_SUITE_START

CREATE FUNCTION pg_temp.a321_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a321_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A321: %', message; END IF;
END
$$;
-- The statement as a database role with the given JWT claims: 'ok' or the SQLSTATE.
CREATE FUNCTION pg_temp.a321_as(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
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
-- The JSONB result of a statement run as service_role with the service claim, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.a321_svc(p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
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
CREATE FUNCTION pg_temp.a321_read(p_org INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''crm_primary'')', pg_temp.a321_id(p_org)))
$$;
CREATE FUNCTION pg_temp.a321_observe(p_org INTEGER, p_status TEXT, p_restart BOOLEAN) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_svc(format('SELECT platform.whatsapp_health_observe_v1(%L, ''crm_primary'', %L, %L)',
    pg_temp.a321_id(p_org), p_status, p_restart))
$$;
CREATE FUNCTION pg_temp.a321_open(p_org INTEGER, p_kind TEXT, p_status TEXT, p_extra UUID DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_svc(format('SELECT platform.whatsapp_health_open_v1(%L, ''crm_primary'', %L, %L, %L)',
    pg_temp.a321_id(p_org), p_kind, p_status, p_extra))
$$;
CREATE FUNCTION pg_temp.a321_resolve(p_org INTEGER, p_kind TEXT, p_reason TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a321_svc(format('SELECT platform.whatsapp_health_resolve_v1(%L, ''crm_primary'', %L, %L)',
    pg_temp.a321_id(p_org), p_kind, p_reason))
$$;

-- ---------------------------------------------------------------------------
-- Fixture.
--   org 1 (under test): actor 1 system admin, actor 2 system admin, actor 3 suspended system admin,
--     actor 4 sales member given the task role (the "sales head" recipient), actor 5 student
--   org 2: only a suspended system admin (actor 6): nobody can receive a task
--   org 3: actor 7 system admin (isolation, and "the head is already an admin")
--   org 4: no members at all
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a321_actors(n INTEGER PRIMARY KEY, org INTEGER, sysadmin BOOLEAN, role TEXT, status TEXT);
INSERT INTO a321_actors VALUES (1, 1, TRUE, 'admin', 'active'), (2, 1, TRUE, 'admin', 'active'),
  (3, 1, TRUE, 'admin', 'suspended'), (4, 1, FALSE, 'sales', 'active'), (5, 1, FALSE, 'student', 'active'),
  (6, 2, TRUE, 'admin', 'suspended'), (7, 3, TRUE, 'admin', 'active');
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a321_id(1), 'A321 Fictional organization', 'active'),
  (pg_temp.a321_id(2), 'A321 Organization without a recipient', 'active'),
  (pg_temp.a321_id(3), 'A321 Other fictional organization', 'active'),
  (pg_temp.a321_id(4), 'A321 Organization without staff', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a321_id(100 + n), 'a321-' || n || '@example.invalid', '{}'::JSONB FROM a321_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a321_id(200 + n), pg_temp.a321_id(100 + n), 'A321 Actor ' || n, 'active', 1 FROM a321_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id,
  created_at)
  SELECT pg_temp.a321_id(300 + a.n), pg_temp.a321_id(a.org), pg_temp.a321_id(200 + a.n), a.status::platform.membership_status,
    a.role::platform.business_role,
    (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.role::platform.business_role AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 10:00:00+00' + make_interval(mins => a.n)
  FROM a321_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a321_id(300 + n) FROM a321_actors WHERE sysadmin);

-- The sales head: a sales member who holds a published role with staff.task.read and staff.task.complete, created and
-- assigned by the Admin through the real RPCs (as the telephony suite does).
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a321_id(401), pg_temp.a321_id(1), 'organization', pg_temp.a321_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a321_id(1), pg_temp.a321_id(301), pg_temp.a321_id(401), 1, 1, TRUE, 'system', 'A321 synthetic scope', pg_temp.a321_id(601));
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a321_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a321_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a321_admin_claims \gset
CREATE FUNCTION pg_temp.a321_staff(p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE);
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
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
SELECT pg_temp.a321_assert(
  pg_temp.a321_staff(:'a321_admin_claims', format(
    $q$SELECT platform.staff_role_command(%L::UUID, %L::UUID, 0, 'create', %L::JSONB, 'A321 create role', %L::UUID)$q$,
    pg_temp.a321_id(1), pg_temp.a321_id(1101),
    jsonb_build_object('label', 'A321 task access', 'description', 'A321 synthetic staff.task role',
      'permissionKeys', '["staff.task.read","staff.task.complete"]'::JSONB),
    pg_temp.a321_id(1111))) ->> 'status' = 'applied',
  'the Admin creates the task role through the real RPC');
SELECT pg_temp.a321_staff(:'a321_admin_claims', format(
    $q$SELECT platform.staff_role_publish(%L::UUID, %L::UUID, 1, platform.staff_role_impact(%L::UUID, %L::UUID, 1) ->> 'impactFingerprint', 'A321 publish role', %L::UUID)$q$,
    pg_temp.a321_id(1), pg_temp.a321_id(1101), pg_temp.a321_id(1), pg_temp.a321_id(1101), pg_temp.a321_id(1112))) ->> 'status' AS a321_published \gset
SELECT pg_temp.a321_assert(:'a321_published' = 'applied', 'the Admin publishes the task role');
SELECT (SELECT p.access_version FROM platform.profiles p WHERE p.id = pg_temp.a321_id(204)) AS a321_access_version \gset
SELECT pg_temp.a321_assert(
  pg_temp.a321_staff(:'a321_admin_claims', format(
    'SELECT platform.staff_role_assignments_save(%L::UUID, %L::UUID, %s, %L::JSONB, %L::JSONB, %L, %L::UUID)',
    pg_temp.a321_id(1), pg_temp.a321_id(304), :'a321_access_version',
    (SELECT jsonb_build_array(jsonb_build_object('roleId', r.id, 'scope', jsonb_build_object('kind', 'organization',
      'key', pg_temp.a321_id(1), 'resourceKind', NULL))) FROM platform.staff_role_definitions r WHERE r.id = pg_temp.a321_id(1101)),
    (SELECT jsonb_build_array(jsonb_build_object('roleId', r.id, 'roleVersion', r.version, 'bundleId', r.current_bundle_id,
      'bundleVersion', b.bundle_version))
     FROM platform.staff_role_definitions r JOIN platform.staff_role_bundle_bindings b
       ON b.organization_id = r.organization_id AND b.role_id = r.id AND b.bundle_id = r.current_bundle_id
     WHERE r.id = pg_temp.a321_id(1101)),
    'A321 assign', pg_temp.a321_id(5001))) ->> 'status' = 'applied',
  'the Admin gives the task role to the sales member through staff_role_assignments_save');

SELECT pg_temp.a321_assert(
  platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(301))
  AND platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(302))
  AND NOT platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(303))
  AND platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(304))
  AND NOT platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(305))
  AND NOT platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), pg_temp.a321_id(399))
  AND NOT platform_private.whatsapp_health_assignable(pg_temp.a321_id(1), NULL),
  'fixture: active admins and the sales member with the task role can receive a task; a suspended admin, a student, an unknown id and NULL cannot');

-- ---------------------------------------------------------------------------
-- 1. Posture and argument errors.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_assert(
  (SELECT count(*) = 2 FROM pg_class c WHERE c.oid IN ('platform_private.whatsapp_health_monitor'::REGCLASS,
    'platform_private.whatsapp_health_alerts'::REGCLASS) AND c.relrowsecurity AND c.relforcerowsecurity)
  AND NOT has_table_privilege('anon', 'platform_private.whatsapp_health_alerts', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'platform_private.whatsapp_health_alerts', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'platform_private.whatsapp_health_alerts', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'platform_private.whatsapp_health_monitor', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'platform_private.whatsapp_health_monitor', 'SELECT,INSERT,UPDATE,DELETE'),
  'posture: both tables are RLS-forced and closed to anon, authenticated and service_role');
SELECT pg_temp.a321_assert(
  (SELECT count(*) = 4 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'whatsapp\_health\_%\_v1'
      AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
  AND (SELECT count(*) = 5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'whatsapp\_health\_%'
      AND p.proconfig = ARRAY['search_path=""']
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'posture: four definer functions for service_role only, five closed helpers');

SELECT pg_temp.a321_assert(
  pg_temp.a321_as('anon', '{"role":"anon"}', format('SELECT platform.whatsapp_health_read_v1(%L)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('authenticated', '{"role":"authenticated"}', format('SELECT platform.whatsapp_health_read_v1(%L)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('supabase_auth_admin', '{"role":"service_role"}', format('SELECT platform.whatsapp_health_read_v1(%L)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('evo_ai_agent', '{"role":"service_role"}', format('SELECT platform.whatsapp_health_read_v1(%L)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('authenticated', '{"role":"service_role"}', format('SELECT platform.whatsapp_health_open_v1(%L, ''crm_primary'', ''silent'', ''WORKING'')', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('service_role', '{"role":"authenticated"}', format('SELECT platform.whatsapp_health_read_v1(%L)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('service_role', '', format('SELECT platform.whatsapp_health_observe_v1(%L, ''crm_primary'', ''WORKING'', FALSE)', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('service_role', '{"role":"authenticated"}', format('SELECT platform.whatsapp_health_resolve_v1(%L, ''crm_primary'', ''silent'', ''messages_arrived'')', pg_temp.a321_id(1))) = '42501'
  AND pg_temp.a321_as('service_role', '{"role":"service_role"}', format('SELECT platform_private.whatsapp_health_guard(%L, ''crm_primary'')', pg_temp.a321_id(1))) = '42501',
  'refused: anon, authenticated, supabase_auth_admin, the AI agent role, service_role without the service claim, an empty claim, and the closed helper');

SELECT pg_temp.a321_assert(
  pg_temp.a321_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''evo-inbox'')', pg_temp.a321_id(1))) ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_svc('SELECT platform.whatsapp_health_read_v1(NULL, ''crm_primary'')') ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''crm_primary'')', pg_temp.a321_id(99))) ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_observe(1, 'working', FALSE) ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_observe(1, 'WORKING; DROP', FALSE) ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_svc(format('SELECT platform.whatsapp_health_observe_v1(%L, ''crm_primary'', ''WORKING'', NULL)', pg_temp.a321_id(1))) ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_open(1, 'sleepy', 'FAILED') ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_open(1, 'silent', 'failed') ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_open(1, NULL, 'FAILED') ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_resolve(1, 'silent', 'because') ->> 'error' LIKE '22023:%'
  AND pg_temp.a321_resolve(1, 'other', 'working_again') ->> 'error' LIKE '22023:%'
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_alerts)
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_monitor),
  'argument errors are 22023 and write nothing');

-- ---------------------------------------------------------------------------
-- 2. Read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_read(1) AS a321_empty \gset
SELECT pg_temp.a321_assert(
  (:'a321_empty'::JSONB) -> 'monitor' = 'null'::JSONB AND (:'a321_empty'::JSONB) -> 'disconnected' = 'null'::JSONB
  AND (:'a321_empty'::JSONB) -> 'silent' = 'null'::JSONB AND (:'a321_empty'::JSONB) -> 'lastInboundAt' = 'null'::JSONB
  AND abs(extract(epoch FROM ((:'a321_empty'::JSONB ->> 'now')::TIMESTAMPTZ - clock_timestamp()))) < 5,
  'read: an empty state, the database clock: ' || :'a321_empty');

-- Webhook events of org 1: the two newest qualifying ones, then everything that must NOT count.
CREATE FUNCTION pg_temp.a321_event(p_n INTEGER, p_org INTEGER, p_session TEXT, p_type TEXT, p_status TEXT,
  p_from_me BOOLEAN, p_age INTERVAL) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type,
    provider_occurred_at, verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256,
    received_at, request_id)
  VALUES (pg_temp.a321_id(1000 + p_n), pg_temp.a321_id(p_org), 'waha', 'waha:' || p_session, NULL,
    CASE WHEN p_type = 'message.ack' THEN 'ack:1' END, 'a321-event-' || p_n, p_session, 'a321-event-' || p_n, p_type,
    clock_timestamp() - p_age, p_status::platform.webhook_verification_status,
    jsonb_build_object('event', p_type, 'session', p_session, 'payload', jsonb_build_object('fromMe', p_from_me)),
    '{"hmac_verified":true}', 'synthetic:a321', repeat('32', 32), clock_timestamp() - p_age, pg_temp.a321_id(2000 + p_n))
$$;
SELECT pg_temp.a321_event(1, 1, 'crm_primary', 'message.any', 'verified', FALSE, INTERVAL '5 hours');
SELECT pg_temp.a321_event(2, 1, 'crm_primary', 'message.any', 'verified', FALSE, INTERVAL '2 hours');
SELECT pg_temp.a321_event(3, 1, 'crm_primary', 'message.any', 'verified', TRUE, INTERVAL '30 minutes');
SELECT pg_temp.a321_event(4, 1, 'crm_primary', 'message.any', 'rejected', FALSE, INTERVAL '20 minutes');
SELECT pg_temp.a321_event(5, 1, 'crm_primary', 'session.status', 'verified', FALSE, INTERVAL '10 minutes');
SELECT pg_temp.a321_event(6, 1, 'crm_primary', 'message.ack', 'verified', FALSE, INTERVAL '5 minutes');
SELECT pg_temp.a321_event(7, 3, 'crm_primary', 'message.any', 'verified', FALSE, INTERVAL '1 minute');
SELECT pg_temp.a321_event(8, 2, 'crm_primary', 'message.any', 'verified', FALSE, INTERVAL '31 days');
SELECT pg_temp.a321_assert(
  (pg_temp.a321_read(1) ->> 'lastInboundAt')::TIMESTAMPTZ = (SELECT e.received_at FROM platform_private.provider_webhook_events e
    WHERE e.id = pg_temp.a321_id(1002))
  AND (pg_temp.a321_read(3) ->> 'lastInboundAt')::TIMESTAMPTZ = (SELECT e.received_at FROM platform_private.provider_webhook_events e
    WHERE e.id = pg_temp.a321_id(1007))
  AND pg_temp.a321_read(2) -> 'lastInboundAt' = 'null'::JSONB
  AND pg_temp.a321_read(4) -> 'lastInboundAt' = 'null'::JSONB,
  'read: the last customer inbound is the newest verified message.any with fromMe = false inside 30 days of the same organization');

-- ---------------------------------------------------------------------------
-- 3. Observe.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_observe(1, 'FAILED', FALSE) AS a321_obs1 \gset
SELECT pg_temp.a321_assert(
  (SELECT m.last_status = 'FAILED' AND m.since_at = m.last_seen_at FROM platform_private.whatsapp_health_monitor m
    WHERE m.organization_id = pg_temp.a321_id(1)) AND (:'a321_obs1'::JSONB ->> 'sinceAt') = (:'a321_obs1'::JSONB ->> 'lastSeenAt'),
  'observe: the first call creates the run: ' || :'a321_obs1');
SELECT pg_sleep(0.02);
SELECT pg_temp.a321_observe(1, 'STARTING', FALSE) AS a321_obs2 \gset
SELECT pg_temp.a321_assert(
  (:'a321_obs2'::JSONB ->> 'sinceAt') = (:'a321_obs1'::JSONB ->> 'sinceAt')
  AND (:'a321_obs2'::JSONB ->> 'lastSeenAt')::TIMESTAMPTZ > (:'a321_obs1'::JSONB ->> 'lastSeenAt')::TIMESTAMPTZ
  AND (SELECT m.last_status FROM platform_private.whatsapp_health_monitor m WHERE m.organization_id = pg_temp.a321_id(1)) = 'STARTING',
  'observe: without restart the run start is kept, the last seen and the status move: ' || :'a321_obs2');
SELECT pg_sleep(0.02);
SELECT pg_temp.a321_observe(1, 'WORKING', TRUE) AS a321_obs3 \gset
SELECT pg_temp.a321_assert(
  (:'a321_obs3'::JSONB ->> 'sinceAt')::TIMESTAMPTZ > (:'a321_obs2'::JSONB ->> 'sinceAt')::TIMESTAMPTZ
  AND (:'a321_obs3'::JSONB ->> 'sinceAt') = (:'a321_obs3'::JSONB ->> 'lastSeenAt')
  AND (SELECT count(*) = 1 FROM platform_private.whatsapp_health_monitor m WHERE m.organization_id = pg_temp.a321_id(1)),
  'observe: restart starts a new run, still one row: ' || :'a321_obs3');
SELECT pg_temp.a321_read(1) -> 'monitor' AS a321_monitor \gset
SELECT pg_temp.a321_assert(
  (:'a321_monitor'::JSONB ->> 'lastStatus') = 'WORKING' AND (:'a321_monitor'::JSONB ->> 'sinceAt') = (:'a321_obs3'::JSONB ->> 'sinceAt'),
  'read: returns the run: ' || :'a321_monitor');
SELECT pg_temp.a321_assert(
  pg_temp.a321_as('postgres', '', $q$UPDATE platform_private.whatsapp_health_monitor SET since_at = last_seen_at + INTERVAL '1 second'$q$) = '23514',
  'the run start cannot be later than the last seen');

-- ---------------------------------------------------------------------------
-- 4. Open.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a321_open(1, 'disconnected', 'FAILED', pg_temp.a321_id(304)) AS a321_open1 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open1'::JSONB ->> 'opened') = 'true' AND (:'a321_open1'::JSONB ->> 'tasks') = '3',
  'open: three recipients (two active system admins and the sales head; the suspended admin is skipped): ' || :'a321_open1');
SELECT pg_temp.a321_assert(
  (SELECT count(*) = 3 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1))
  AND (SELECT array_agg(t.assignee_membership_id ORDER BY t.assignee_membership_id) = ARRAY[pg_temp.a321_id(301), pg_temp.a321_id(302), pg_temp.a321_id(304)]
    FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1))
  AND (SELECT bool_and(t.creator_membership_id = t.assignee_membership_id AND t.status = 'open' AND t.priority = 'urgent'
      AND t.title = 'WhatsApp отключён — переподключите' AND t.version = 1
      AND t.due_on = (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE AND t.due_at IS NULL)
    FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1))
  AND (SELECT bool_and(t.description LIKE '%сессия остановилась с ошибкой%'
      AND t.description LIKE '%Настройки → Интеграции → Подключение WhatsApp%'
      AND t.description LIKE '%больше 10 минут%' AND t.description LIKE '%закроется сама%')
    FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)),
  'open: one urgent task per recipient (creator = assignee, due today in Bishkek), Russian copy for FAILED');
SELECT pg_temp.a321_assert(
  (SELECT count(*) = 3 FROM platform.staff_task_events e WHERE e.organization_id = pg_temp.a321_id(1) AND e.action = 'create' AND e.version = 1)
  AND (SELECT count(*) = 3 FROM platform_private.staff_task_receipts r WHERE r.organization_id = pg_temp.a321_id(1)
    AND r.request_payload ->> 'source' = 'whatsapp_health' AND r.request_payload ->> 'kind' = 'disconnected')
  AND (SELECT count(*) = 3 FROM platform.staff_notifications n WHERE n.organization_id = pg_temp.a321_id(1)
    AND n.kind = 'task_assigned' AND n.read_at IS NULL)
  AND (SELECT count(*) = 3 FROM platform.audit_events a WHERE a.organization_id = pg_temp.a321_id(1)
    AND a.actor_kind = 'system' AND a.actor_principal = 'whatsapp-health' AND a.action = 'staff.task.create'
    AND a.resource_type = 'staff_task'),
  'open: each task has its event, receipt, notification and system journal row');
SELECT pg_temp.a321_assert(
  (SELECT count(*) = 1 FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(1)
    AND a.kind = 'disconnected' AND a.opened_status = 'FAILED' AND a.resolved_at IS NULL AND cardinality(a.task_ids) = 3
    AND a.id = (:'a321_open1'::JSONB ->> 'alertId')::UUID
    AND a.task_ids @> (SELECT array_agg(t.id) FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)))
  AND (pg_temp.a321_read(1) -> 'disconnected' ->> 'id')::UUID = (:'a321_open1'::JSONB ->> 'alertId')::UUID
  AND pg_temp.a321_read(1) -> 'silent' = 'null'::JSONB,
  'open: one alert row with the three task ids; read shows it as the open disconnected alert');
SELECT pg_temp.a321_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.title ~ '[0-9]{6,}' OR t.description ~ '[0-9]{6,}' OR t.description ~ '\+[0-9]'),
  'open: no phone number or long digit run in any task text');

-- Dedupe: the same kind again writes nothing.
SELECT pg_temp.a321_open(1, 'disconnected', 'FAILED', pg_temp.a321_id(304)) AS a321_open2 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open2'::JSONB ->> 'opened') = 'false' AND (:'a321_open2'::JSONB ->> 'reason') = 'already_open'
  AND (SELECT count(*) = 3 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1))
  AND (SELECT count(*) = 1 FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(1)),
  'open: a second open of the same kind is already_open and writes nothing: ' || :'a321_open2');
SELECT pg_temp.a321_assert(
  pg_temp.a321_as('postgres', '', format($q$INSERT INTO platform_private.whatsapp_health_alerts (organization_id, session_name, kind, opened_status)
    VALUES (%L, 'crm_primary', 'disconnected', 'FAILED')$q$, pg_temp.a321_id(1))) = '23505',
  'the unique index refuses a second open alert of the same kind');
SELECT pg_temp.a321_assert(
  pg_temp.a321_as('postgres', '', format($q$INSERT INTO platform_private.whatsapp_health_alerts (organization_id, session_name, kind, opened_status)
    VALUES (%L, 'crm_primary', 'noise', 'FAILED')$q$, pg_temp.a321_id(1))) = '23514'
  AND pg_temp.a321_as('postgres', '', format($q$INSERT INTO platform_private.whatsapp_health_alerts (organization_id, session_name, kind, opened_status, resolved_at)
    VALUES (%L, 'crm_primary', 'silent', 'WORKING', clock_timestamp())$q$, pg_temp.a321_id(1))) = '23514',
  'the alert table refuses an unknown kind and a resolved row without a reason');

-- The other kind is its own alert; the silent copy and priority.
SELECT pg_temp.a321_open(1, 'silent', 'WORKING') AS a321_open3 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open3'::JSONB ->> 'opened') = 'true' AND (:'a321_open3'::JSONB ->> 'tasks') = '2'
  AND (SELECT count(*) = 2 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)
    AND t.title = 'WhatsApp молчит 3 часа в рабочее время — проверьте подключение' AND t.priority = 'high'
    AND t.description LIKE '%3 рабочих часа%' AND t.description LIKE '%пн–сб, 10:00–20:00 по Бишкеку%'
    AND t.description LIKE '%Настройки → Интеграции → Подключение WhatsApp%')
  AND (SELECT count(*) = 2 FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(1) AND a.resolved_at IS NULL),
  'open: the silent alert is separate, two admins only (no extra recipient), high priority, its own copy: ' || :'a321_open3');

-- The status words in the copy and the title for an unreachable service.
SELECT pg_temp.a321_assert(
  platform_private.whatsapp_health_text('disconnected', 'SCAN_QR_CODE') LIKE '%нужно заново отсканировать QR-код%'
  AND platform_private.whatsapp_health_text('disconnected', 'STOPPED') LIKE '%сессия остановлена%'
  AND platform_private.whatsapp_health_text('disconnected', 'STARTING') LIKE '%сессия не может запуститься%'
  AND platform_private.whatsapp_health_text('disconnected', 'PASSKEY_REQUIRED') LIKE '%ключом доступа%'
  AND platform_private.whatsapp_health_text('disconnected', 'PASSKEY_CONFIRMATION_REQUIRED') LIKE '%ключом доступа%'
  AND platform_private.whatsapp_health_text('disconnected', 'SOMETHING_NEW') LIKE '%статус сессии: SOMETHING_NEW%'
  AND platform_private.whatsapp_health_text('disconnected', 'UNREACHABLE') LIKE '%сообщите техническому администратору%'
  AND platform_private.whatsapp_health_text('disconnected', 'UNREACHABLE') NOT LIKE '%Подключение WhatsApp%'
  AND platform_private.whatsapp_health_title('disconnected', 'UNREACHABLE') = 'WhatsApp: сервис не отвечает — сообщите техническому администратору'
  AND platform_private.whatsapp_health_title('disconnected', 'SCAN_QR_CODE') = 'WhatsApp отключён — переподключите',
  'copy: the words for each WAHA status, and the unreachable service variant');

-- Extra recipients that add nothing: an admin who is already a recipient, a student, an unknown id.
SELECT pg_temp.a321_open(3, 'disconnected', 'SCAN_QR_CODE', pg_temp.a321_id(307)) AS a321_open4 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open4'::JSONB ->> 'tasks') = '1'
  AND (SELECT count(*) = 1 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(3)),
  'open: a recipient that is also a system admin gets one task, not two: ' || :'a321_open4');
SELECT pg_temp.a321_resolve(3, 'disconnected', 'working_again') AS a321_res_other \gset
SELECT pg_temp.a321_open(1, 'disconnected', 'FAILED', pg_temp.a321_id(305)) AS a321_open5 \gset
SELECT pg_temp.a321_assert((:'a321_open5'::JSONB ->> 'reason') = 'already_open', 'sanity: org 1 still has its open alert');
SELECT pg_temp.a321_resolve(1, 'disconnected', 'working_again') AS a321_res_pre \gset
SELECT pg_temp.a321_open(1, 'disconnected', 'FAILED', pg_temp.a321_id(305)) AS a321_open6 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open6'::JSONB ->> 'opened') = 'true' AND (:'a321_open6'::JSONB ->> 'tasks') = '2',
  'open: a student as the sales head adds nothing: ' || :'a321_open6');
SELECT pg_temp.a321_resolve(1, 'disconnected', 'working_again') AS a321_res_pre2 \gset
SELECT pg_temp.a321_open(1, 'disconnected', 'FAILED', pg_temp.a321_id(399)) AS a321_open7 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open7'::JSONB ->> 'opened') = 'true' AND (:'a321_open7'::JSONB ->> 'tasks') = '2',
  'open: an unknown sales head id adds nothing: ' || :'a321_open7');
SELECT pg_temp.a321_resolve(1, 'disconnected', 'working_again') AS a321_res_pre3 \gset

-- Nobody can receive a task: an error, no alert, no task.
SELECT pg_temp.a321_open(2, 'disconnected', 'FAILED') AS a321_none \gset
SELECT pg_temp.a321_assert(
  (:'a321_none'::JSONB ->> 'error') LIKE '55000:whatsapp_health_no_recipient%'
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(2))
  AND NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(2))
  AND pg_temp.a321_open(4, 'silent', 'WORKING') ->> 'error' LIKE '55000:whatsapp_health_no_recipient%',
  'open: no recipient is an error and leaves no alert and no task: ' || :'a321_none');

-- ---------------------------------------------------------------------------
-- 5. Resolve.
-- ---------------------------------------------------------------------------
-- A fresh disconnected alert: a human cancels one of the three tasks and another is already done.
SELECT pg_temp.a321_open(1, 'disconnected', 'STOPPED', pg_temp.a321_id(304)) AS a321_open8 \gset
SELECT pg_temp.a321_assert((:'a321_open8'::JSONB ->> 'tasks') = '3', 'resolve fixture: three tasks: ' || :'a321_open8');
CREATE TEMP TABLE a321_open8_tasks AS
  SELECT t.id, t.assignee_membership_id FROM platform.staff_tasks t
  WHERE t.id IN (SELECT unnest(a.task_ids) FROM platform_private.whatsapp_health_alerts a
    WHERE a.id = (:'a321_open8'::JSONB ->> 'alertId')::UUID);
UPDATE platform.staff_tasks SET status = 'cancelled', version = version + 1
  WHERE id = (SELECT id FROM a321_open8_tasks WHERE assignee_membership_id = pg_temp.a321_id(301));
UPDATE platform.staff_tasks SET status = 'done', version = version + 1
  WHERE id = (SELECT id FROM a321_open8_tasks WHERE assignee_membership_id = pg_temp.a321_id(302));
SELECT pg_temp.a321_resolve(1, 'disconnected', 'working_again') AS a321_res1 \gset
SELECT pg_temp.a321_assert(
  (:'a321_res1'::JSONB ->> 'resolved') = 'true' AND (:'a321_res1'::JSONB ->> 'tasksClosed') = '1'
  AND (SELECT t.status = 'cancelled' AND t.version = 2 FROM platform.staff_tasks t
    WHERE t.id = (SELECT id FROM a321_open8_tasks WHERE assignee_membership_id = pg_temp.a321_id(301)))
  AND (SELECT t.status = 'done' AND t.version = 2 FROM platform.staff_tasks t
    WHERE t.id = (SELECT id FROM a321_open8_tasks WHERE assignee_membership_id = pg_temp.a321_id(302)))
  AND (SELECT t.status = 'done' AND t.version = 2 FROM platform.staff_tasks t
    WHERE t.id = (SELECT id FROM a321_open8_tasks WHERE assignee_membership_id = pg_temp.a321_id(304)))
  AND (SELECT count(*) = 1 FROM platform.staff_task_events e WHERE e.action = 'status'
    AND e.staff_task_id IN (SELECT id FROM a321_open8_tasks) AND e.after_state ->> 'status' = 'done'
    AND e.before_state ->> 'status' = 'open')
  AND (SELECT count(*) = 1 FROM platform.audit_events a WHERE a.action = 'staff.task.status' AND a.actor_kind = 'system'
    AND a.actor_principal = 'whatsapp-health' AND a.resource_id IN (SELECT id FROM a321_open8_tasks)
    AND a.after_state ->> 'reason' = 'working_again'),
  'resolve: only the task still open is closed (done, event, system journal row); the human-cancelled and human-done tasks stay: ' || :'a321_res1');
SELECT pg_temp.a321_assert(
  (SELECT a.resolved_reason = 'working_again' AND a.resolved_at IS NOT NULL AND a.resolved_at >= a.opened_at
    FROM platform_private.whatsapp_health_alerts a WHERE a.id = (:'a321_open8'::JSONB ->> 'alertId')::UUID)
  AND pg_temp.a321_read(1) -> 'disconnected' = 'null'::JSONB
  AND (pg_temp.a321_read(1) -> 'silent' ->> 'id')::UUID = (:'a321_open3'::JSONB ->> 'alertId')::UUID,
  'resolve: the alert records the reason; the silent alert is untouched');

SELECT pg_temp.a321_resolve(1, 'disconnected', 'working_again') AS a321_res2 \gset
SELECT pg_temp.a321_assert(
  (:'a321_res2'::JSONB ->> 'resolved') = 'false' AND (:'a321_res2'::JSONB ->> 'tasksClosed') = '0',
  'resolve: a second resolve finds nothing: ' || :'a321_res2');

-- The next case is a new alert.
SELECT pg_temp.a321_open(1, 'disconnected', 'UNREACHABLE', pg_temp.a321_id(304)) AS a321_open9 \gset
SELECT pg_temp.a321_assert(
  (:'a321_open9'::JSONB ->> 'opened') = 'true' AND (:'a321_open9'::JSONB ->> 'alertId') <> (:'a321_open8'::JSONB ->> 'alertId')
  AND (SELECT count(*) FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(1)
    AND a.kind = 'disconnected') = 5
  AND (SELECT count(*) = 1 FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a321_id(1)
    AND a.kind = 'disconnected' AND a.resolved_at IS NULL)
  AND (SELECT count(*) = 3 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)
    AND t.title = 'WhatsApp: сервис не отвечает — сообщите техническому администратору' AND t.status = 'open'),
  'resolve: the next case is a new alert (unreachable copy), one open: ' || :'a321_open9');

-- The silent alert: resolved by messages; the request id of the close is unique per task version.
SELECT pg_temp.a321_resolve(1, 'silent', 'messages_arrived') AS a321_res3 \gset
SELECT pg_temp.a321_assert(
  (:'a321_res3'::JSONB ->> 'tasksClosed') = '2'
  AND (SELECT a.resolved_reason = 'messages_arrived' FROM platform_private.whatsapp_health_alerts a
    WHERE a.id = (:'a321_open3'::JSONB ->> 'alertId')::UUID)
  AND (SELECT count(*) = 2 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)
    AND t.title LIKE 'WhatsApp молчит%' AND t.status = 'done'),
  'resolve: the silent alert closes its two tasks: ' || :'a321_res3');

-- Isolation: org 3 was resolved on its own; org 1 and org 3 never touched each other's rows.
SELECT pg_temp.a321_assert(
  (:'a321_res_other'::JSONB ->> 'resolved') = 'true'
  AND (SELECT count(*) = 1 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(3) AND t.status = 'done')
  AND (SELECT count(*) = 0 FROM platform.staff_tasks t WHERE t.organization_id = pg_temp.a321_id(1)
    AND t.assignee_membership_id = pg_temp.a321_id(307)),
  'isolation: another organization has its own alert and tasks');

-- Quiet by default: nothing but the intended rows.
SELECT pg_temp.a321_assert(
  NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.actor_principal = 'whatsapp-health'
    AND a.action NOT IN ('staff.task.create', 'staff.task.status')),
  'the job writes only task create and status journal rows');

\echo A321_WHATSAPP_HEALTH_ALERTS_SUITE_PASSED
ROLLBACK;
