\set ON_ERROR_STOP on
-- Boundary suite for migration 326 «WhatsApp продаж через Wazzup: дополнения этапа 1» (план этапа 1
-- docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.4, §5.6, §9, §12 A6). Runs on the real chain right after 326 inside one
-- transaction that is rolled back, with its own synthetic organizations, members and Wazzup elements: no Wazzup, no WhatsApp,
-- no message to anyone, no real person, no real number or key, no production action. The functions are called through the same
-- request.jwt.claims role gate the service path uses; the staff session is the real custom_access_token_hook claim.
--
-- Proves:
--  1. posture: the two new functions are definers with an empty search_path, STABLE, EXECUTE for service_role only; the staff
--     read stays a hardened definer for authenticated only; every other role (authenticated, anon, service_role without the
--     claim, the AI agent role) is refused (42501); argument errors are 22023;
--  2. the transport read: no row = none with both switches off and no channel; a bound channel with its kind, id, last four
--     digits and (once observed) the state word and time; the path words none / waha / wazzup and the AI / Gemini switches
--     as the operator command set them; another organization sees nothing of it; the answer holds no hash, number or key;
--  3. the staff read: `channel.last4` is there (four digits) next to the three old keys, nothing else changed (the five
--     top-level keys, receive-only under wazzup, the readers refused as before); no channel = null;
--  4. the stored events by id: the elements come back in the order asked, once each, as the persist function accepts them
--     (message / edit / deletion = message, a channel update = channel without the QR code, an unparsed event = NULL kind and
--     element); another organization, another provider, an unknown id are "missing"; the read writes nothing; and feeding
--     the elements back is a pure deduplication - no new event, no projection, no change of any daily counter (the filtered
--     elements are not stored, so a replay of stored events cannot count them again).
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo A326_WAZZUP_FOLLOWUPS_SUITE_START

CREATE FUNCTION pg_temp.a326_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a326_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A326: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a326_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB; saved TEXT := current_setting('request.jwt.claims', TRUE); v_state TEXT; v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', COALESCE(p_claims, ''), TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql INTO result;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    result := jsonb_build_object('error', v_state, 'message', v_message);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', COALESCE(saved, ''), TRUE);
  RETURN COALESCE(result, 'null'::JSONB);
END
$$;
CREATE FUNCTION pg_temp.a326_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a326_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE TEMP TABLE a326_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a326_claims TO authenticated;
CREATE FUNCTION pg_temp.a326_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_call('authenticated', (SELECT claims FROM a326_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a326_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a326_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture.
--   org 1 (under test): actor 1 system admin (reads everything), actor 2 a student-role member (no staff rights)
--   org 2: actor 3 system admin (isolation)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a326_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a326_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a326_id(1), 'A326 Fictional organization', 'active'),
  (pg_temp.a326_id(2), 'A326 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a326_id(100 + n), 'a326-' || n || '@example.invalid', '{}'::JSONB FROM a326_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a326_id(200 + n), pg_temp.a326_id(100 + n), 'A326 Actor ' || n, 'active', 1 FROM a326_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a326_id(300 + a.n), pg_temp.a326_id(a.org), pg_temp.a326_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a326_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a326_id(300 + n) FROM a326_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a326_id(401), pg_temp.a326_id(1), 'organization', pg_temp.a326_id(1), 1),
  (pg_temp.a326_id(402), pg_temp.a326_id(2), 'organization', pg_temp.a326_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a326_id(1), pg_temp.a326_id(301), pg_temp.a326_id(401), 1, 1, TRUE, 'system', 'A326 synthetic scope', pg_temp.a326_id(601)),
  (pg_temp.a326_id(2), pg_temp.a326_id(303), pg_temp.a326_id(402), 1, 1, TRUE, 'system', 'A326 synthetic scope', pg_temp.a326_id(602));
INSERT INTO a326_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a326_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.a326_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM a326_actors a;
SELECT pg_temp.a326_assert((SELECT count(*) = 3 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id') FROM a326_claims),
  'every fixture actor got real hook claims');

-- Wazzup fixtures: the channel id, the time base and the element builders. Numbers are synthetic (the invalid 996... range).
CREATE TEMP TABLE a326_clock(t0 TIMESTAMPTZ NOT NULL);
INSERT INTO a326_clock VALUES (date_trunc('second', clock_timestamp() - INTERVAL '2 hours'));
CREATE FUNCTION pg_temp.a326_channel() RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$ SELECT pg_temp.a326_id(9001) $$;
CREATE FUNCTION pg_temp.a326_ts(n INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT to_char((SELECT t0 FROM a326_clock) + n * INTERVAL '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
CREATE FUNCTION pg_temp.a326_msg(p_id TEXT, p_chat TEXT, p_text TEXT, p_n INTEGER, p_echo BOOLEAN DEFAULT FALSE,
  p_extra JSONB DEFAULT '{}'::JSONB) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('messageId', p_id, 'channelId', pg_temp.a326_channel()::TEXT, 'chatType', 'whatsapp',
    'chatId', p_chat, 'dateTime', pg_temp.a326_ts(p_n), 'type', 'text', 'isEcho', p_echo, 'text', p_text,
    'status', CASE WHEN p_echo THEN 'sent' ELSE 'inbound' END)) || p_extra
$$;
CREATE FUNCTION pg_temp.a326_el(p_kind TEXT, p_element JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('kind', p_kind, 'element', p_element)
$$;
CREATE FUNCTION pg_temp.a326_persist(p_elements JSONB, p_counters JSONB DEFAULT '{}'::JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, %L, ''current'', %L::jsonb, %L::jsonb)',
    pg_temp.a326_id(1), encode(sha256(convert_to(p_elements::TEXT, 'UTF8')), 'hex'), p_elements, p_counters))
$$;
CREATE FUNCTION pg_temp.a326_read_transport(p_org INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_svc(format('SELECT platform.whatsapp_transport_read_v1(%L)', pg_temp.a326_id(p_org)))
$$;
CREATE FUNCTION pg_temp.a326_cfg(p_transport TEXT, p_ai TEXT DEFAULT 'NULL', p_gemini TEXT DEFAULT 'NULL') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, %L, %s, %s, %L)',
    pg_temp.a326_id(1), p_transport, p_ai, p_gemini, gen_random_uuid()))
$$;
CREATE FUNCTION pg_temp.a326_staff_read(p_actor INTEGER, p_org INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a326_as(p_actor, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a326_id(p_org)))
$$;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a326_assert(
  (SELECT count(*) = 2 AND bool_and(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
      AND p.proowner = (SELECT x.proowner FROM pg_proc x WHERE x.oid = 'platform.whatsapp_transport_configure_v1(uuid,text,boolean,boolean,uuid)'::REGPROCEDURE))
   FROM pg_proc p WHERE p.oid IN ('platform.whatsapp_transport_read_v1(uuid)'::REGPROCEDURE,
     'platform.whatsapp_intake_events_read_v1(uuid,uuid[])'::REGPROCEDURE)),
  'posture: the two new functions are STABLE definers with an empty search_path, owned like the 325 ones, EXECUTE for service_role only');
SELECT pg_temp.a326_assert(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
   FROM pg_proc p WHERE p.oid = 'platform.staff_whatsapp_transport_v1(uuid)'::REGPROCEDURE),
  'posture: the staff transport read is still a hardened STABLE definer for authenticated only');
SELECT pg_temp.a326_assert(
  (SELECT count(*) = 9 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'platform' AND (p.proname LIKE 'wazzup\_%\_v1' OR p.proname = 'whatsapp_transport_configure_v1')),
  'the nine service functions of 325 are still exactly nine: the new ones do not take their names');
CREATE FUNCTION pg_temp.a326_calls() RETURNS TABLE (label TEXT, sql TEXT) LANGUAGE SQL AS $$
  VALUES
    ('transport', format('SELECT platform.whatsapp_transport_read_v1(%L)', pg_temp.a326_id(1))),
    ('events', format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY[%L]::uuid[])', pg_temp.a326_id(1), pg_temp.a326_id(7777)))
$$;
SELECT pg_temp.a326_assert(
  (SELECT bool_and(pg_temp.a326_err(pg_temp.a326_call('authenticated', a.claims, c.sql)) = '42501'
      AND pg_temp.a326_err(pg_temp.a326_anon(c.sql)) = '42501'
      AND pg_temp.a326_err(pg_temp.a326_call('service_role', NULL, c.sql)) = '42501'
      AND pg_temp.a326_err(pg_temp.a326_call('service_role', '{"role":"authenticated"}', c.sql)) = '42501'
      AND pg_temp.a326_err(pg_temp.a326_call('evo_ai_agent', NULL, c.sql)) = '42501')
   FROM pg_temp.a326_calls() c CROSS JOIN (SELECT claims FROM a326_claims WHERE actor = 1) a),
  'both new functions refuse authenticated (even the system admin), anon, service_role without the service claim and the AI agent role (42501)');
SELECT pg_temp.a326_assert(
  pg_temp.a326_err(pg_temp.a326_svc('SELECT platform.whatsapp_transport_read_v1(NULL)')) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(NULL, ARRAY[%L]::uuid[])', pg_temp.a326_id(7777)))) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, NULL)', pg_temp.a326_id(1)))) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY[]::uuid[])', pg_temp.a326_id(1)))) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY[%L, NULL]::uuid[])', pg_temp.a326_id(1), pg_temp.a326_id(7777)))) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 101)))', pg_temp.a326_id(1)))) = '22023'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 100)))', pg_temp.a326_id(1)))) IS NULL,
  'argument errors are 22023: a NULL organization, NULL / empty / NULL-containing / over-100 id lists; exactly 100 ids are fine');

-- ---------------------------------------------------------------------------
-- 2. The transport read.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a326_read_transport(1) AS a326_t0 \gset
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_t0'::JSONB) IS NULL
  AND (:'a326_t0'::JSONB ->> 'transport') = 'none' AND (:'a326_t0'::JSONB ->> 'aiTriggerEnabled') = 'false'
  AND (:'a326_t0'::JSONB ->> 'geminiEnabled') = 'false' AND (:'a326_t0'::JSONB -> 'channel') = 'null'::JSONB
  AND (:'a326_t0'::JSONB - ARRAY['transport', 'aiTriggerEnabled', 'geminiEnabled', 'channel']) = '{}'::JSONB,
  'no state row and no channel: the path is none, both switches are off, there is no channel, and exactly four keys: ' || :'a326_t0');

SELECT pg_temp.a326_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0042'', %L, %L)',
  pg_temp.a326_id(1), pg_temp.a326_channel(), repeat('b', 64), pg_temp.a326_id(7102))) AS a326_bind \gset
SELECT pg_temp.a326_read_transport(1) AS a326_t1 \gset
SELECT pg_temp.a326_assert((:'a326_t1'::JSONB ->> 'transport') = 'none'
  AND (:'a326_t1'::JSONB #>> '{channel,channelId}') = pg_temp.a326_channel()::TEXT
  AND (:'a326_t1'::JSONB #>> '{channel,transport}') = 'whatsapp' AND (:'a326_t1'::JSONB #>> '{channel,last4}') = '0042'
  AND (:'a326_t1'::JSONB #> '{channel,state}') = 'null'::JSONB AND (:'a326_t1'::JSONB #> '{channel,observedAt}') = 'null'::JSONB
  AND ((:'a326_t1'::JSONB -> 'channel') - ARRAY['channelId', 'transport', 'last4', 'state', 'observedAt']) = '{}'::JSONB,
  'a bound channel is shown with its id, kind and last four digits (state and time still empty), the path is still none: ' || :'a326_t1');

SELECT pg_temp.a326_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''phoneUnavailable'', %L)',
  pg_temp.a326_id(1), pg_temp.a326_channel(), clock_timestamp() - INTERVAL '3 minutes')) AS a326_obs \gset
SELECT pg_temp.a326_cfg('wazzup', 'true', 'NULL') AS a326_c1 \gset
SELECT pg_temp.a326_read_transport(1) AS a326_t2 \gset
SELECT pg_temp.a326_cfg('wazzup', 'NULL', 'true') AS a326_c2 \gset
SELECT pg_temp.a326_read_transport(1) AS a326_t3 \gset
-- While organization 1 is on wazzup with both switches on, another organization (and an unknown one) sees none of it.
SELECT pg_temp.a326_read_transport(2) AS a326_t_org2 \gset
SELECT pg_temp.a326_svc(format('SELECT platform.whatsapp_transport_read_v1(%L)', pg_temp.a326_id(8888))) AS a326_t_unknown \gset
SELECT pg_temp.a326_cfg('waha', 'false', 'false') AS a326_c3 \gset
SELECT pg_temp.a326_read_transport(1) AS a326_t4 \gset
SELECT pg_temp.a326_cfg('none') AS a326_c4 \gset
SELECT pg_temp.a326_read_transport(1) AS a326_t5 \gset
SELECT pg_temp.a326_assert(
  (:'a326_t2'::JSONB ->> 'transport') = 'wazzup' AND (:'a326_t2'::JSONB ->> 'aiTriggerEnabled') = 'true'
  AND (:'a326_t2'::JSONB ->> 'geminiEnabled') = 'false' AND (:'a326_t2'::JSONB #>> '{channel,state}') = 'phoneUnavailable'
  AND (:'a326_t2'::JSONB #>> '{channel,observedAt}') IS NOT NULL
  AND (:'a326_t3'::JSONB ->> 'transport') = 'wazzup' AND (:'a326_t3'::JSONB ->> 'aiTriggerEnabled') = 'true'
  AND (:'a326_t3'::JSONB ->> 'geminiEnabled') = 'true'
  AND (:'a326_t4'::JSONB ->> 'transport') = 'waha' AND (:'a326_t4'::JSONB ->> 'aiTriggerEnabled') = 'false'
  AND (:'a326_t4'::JSONB ->> 'geminiEnabled') = 'false' AND (:'a326_t4'::JSONB #>> '{channel,last4}') = '0042'
  AND (:'a326_t5'::JSONB ->> 'transport') = 'none',
  'the path words and both switches follow the operator command: wazzup (AI on, then Gemini on), waha, none; the channel state word and time come with it: '
  || :'a326_t3' || :'a326_t4');
-- Another organization sees none of it; an unknown organization is simply none (not an error).
SELECT pg_temp.a326_assert((:'a326_t_org2'::JSONB ->> 'transport') = 'none' AND (:'a326_t_org2'::JSONB ->> 'aiTriggerEnabled') = 'false'
  AND (:'a326_t_org2'::JSONB ->> 'geminiEnabled') = 'false' AND (:'a326_t_org2'::JSONB -> 'channel') = 'null'::JSONB
  AND pg_temp.a326_err(:'a326_t_unknown'::JSONB) IS NULL AND (:'a326_t_unknown'::JSONB ->> 'transport') = 'none'
  AND (:'a326_t_unknown'::JSONB -> 'channel') = 'null'::JSONB,
  'another organization (and an unknown one) has the path none, both switches off and no channel while organization 1 is on wazzup: ' || :'a326_t_org2');
SELECT pg_temp.a326_assert(NOT (:'a326_t3'::TEXT ~* 'sha|key|token|secret|bbbbbbbb|99600'),
  'the answer holds no hash, phone number, key or token: ' || :'a326_t3');
SELECT pg_temp.a326_assert((SELECT count(*) FROM platform_private.wazzup_operator_events) = 5
  AND (SELECT count(*) FROM platform_private.whatsapp_transport_state) = 1,
  'reading the path writes nothing (the journal has only the bind and the four commands)');

-- ---------------------------------------------------------------------------
-- 3. The staff read: last four digits, nothing else changed.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a326_cfg('wazzup') AS a326_c5 \gset
SELECT pg_temp.a326_staff_read(1, 1) AS a326_s1 \gset
SELECT pg_temp.a326_staff_read(3, 2) AS a326_s_org2 \gset
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_s1'::JSONB) IS NULL
  AND (:'a326_s1'::JSONB ->> 'activeTransport') = 'wazzup' AND (:'a326_s1'::JSONB ->> 'canReply') = 'false'
  AND (:'a326_s1'::JSONB ->> 'replyMode') = 'receive_only'
  AND (:'a326_s1'::JSONB - ARRAY['activeTransport', 'canReply', 'replyMode', 'channel', 'lastInboundAt']) = '{}'::JSONB
  AND (:'a326_s1'::JSONB #>> '{channel,last4}') = '0042' AND (:'a326_s1'::JSONB #>> '{channel,last4}') ~ '^[0-9]{4}$'
  AND (:'a326_s1'::JSONB #>> '{channel,transport}') = 'whatsapp' AND (:'a326_s1'::JSONB #>> '{channel,state}') = 'phoneUnavailable'
  AND (:'a326_s1'::JSONB #>> '{channel,observedAt}') IS NOT NULL
  AND ((:'a326_s1'::JSONB -> 'channel') - ARRAY['transport', 'last4', 'state', 'observedAt']) = '{}'::JSONB
  AND NOT (:'a326_s1'::TEXT ~* 'sha|bbbbbbbb|99600|channelId'),
  'the staff read: the channel has the three old keys plus last4 (four digits) and nothing more; the five top-level keys, receive-only and the state are unchanged: ' || :'a326_s1');
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_s_org2'::JSONB) IS NULL AND (:'a326_s_org2'::JSONB ->> 'activeTransport') = 'none'
  AND (:'a326_s_org2'::JSONB -> 'channel') = 'null'::JSONB,
  'no channel: the staff read still has channel = null: ' || :'a326_s_org2');
SELECT pg_temp.a326_cfg('none') AS a326_c6 \gset
SELECT pg_temp.a326_staff_read(1, 1) AS a326_s2 \gset
SELECT pg_temp.a326_assert((:'a326_s2'::JSONB ->> 'activeTransport') = 'none' AND (:'a326_s2'::JSONB ->> 'canReply') = 'true'
  AND (:'a326_s2'::JSONB ->> 'replyMode') = 'waha' AND (:'a326_s2'::JSONB #>> '{channel,last4}') = '0042',
  'under none the staff read says as before that a reply goes the old way; the channel keeps its last four digits: ' || :'a326_s2');
SELECT pg_temp.a326_assert(
  pg_temp.a326_err(pg_temp.a326_staff_read(2, 1)) = '42501'
  AND pg_temp.a326_err(pg_temp.a326_staff_read(3, 1)) = '42501'
  AND pg_temp.a326_err(pg_temp.a326_anon(format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a326_id(1)))) = '42501'
  AND pg_temp.a326_err(pg_temp.a326_svc(format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a326_id(1)))) = '42501'
  AND pg_temp.a326_err(pg_temp.a326_as(1, 'SELECT platform.staff_whatsapp_transport_v1(NULL)')) = '22023',
  'the staff read is refused as before: a member without the right, another organization, anon and the service role (42501); NULL is 22023');

-- ---------------------------------------------------------------------------
-- 4. The stored events by id, and a replay that changes nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a326_cfg('wazzup') AS a326_c7 \gset
CREATE TEMP TABLE a326_els(n INTEGER PRIMARY KEY, label TEXT, element JSONB);
INSERT INTO a326_els VALUES
  (1, 'inbound', pg_temp.a326_el('message', pg_temp.a326_msg('f326-in-1', '996000000301', 'Привет', 1))),
  (2, 'echo', pg_temp.a326_el('message', pg_temp.a326_msg('f326-echo-1', '996000000301', 'Здравствуйте', 2, TRUE))),
  (3, 'edited', pg_temp.a326_el('message', pg_temp.a326_msg('f326-in-1', '996000000301', 'Привет!', 1, FALSE, '{"isEdited": true}'::JSONB))),
  (4, 'deleted', pg_temp.a326_el('message', pg_temp.a326_msg('f326-in-1', '996000000301', NULL, 1, FALSE, '{"isDeleted": true}'::JSONB))),
  (5, 'channel', pg_temp.a326_el('channel', jsonb_build_object('channelId', pg_temp.a326_channel()::TEXT, 'state', 'active',
      'timestamp', 5, 'qrCode', 'synthetic-qr-payload'))),
  (6, 'other_channel', pg_temp.a326_el('message', pg_temp.a326_msg('f326-other-1', '996000000302', 'Чужой канал', 6, FALSE,
      jsonb_build_object('channelId', pg_temp.a326_id(9002)::TEXT)))),
  (7, 'group', pg_temp.a326_el('message', pg_temp.a326_msg('f326-group-1', '120000000000000001', 'Группа', 7, FALSE, '{"chatType": "whatsgroup"}'::JSONB))),
  (8, 'broken', pg_temp.a326_el('message', '"synthetic nonsense"'::JSONB));
SELECT pg_temp.a326_persist((SELECT jsonb_agg(element ORDER BY n) FROM a326_els)) AS a326_p1 \gset
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_p1'::JSONB) IS NULL AND (:'a326_p1'::JSONB ->> 'transportActive') = 'true'
  AND (:'a326_p1'::JSONB #>> '{counts,stored}') = '5' AND (:'a326_p1'::JSONB #>> '{counts,filtered}') = '2'
  AND (:'a326_p1'::JSONB #>> '{counts,unparsed}') = '1' AND (:'a326_p1'::JSONB #>> '{counts,failed}') = '0',
  'fixture: of eight elements five are stored (message, echo, edit, deletion, channel state), two are filtered (another channel, a group) and one is unparsed: ' || :'a326_p1');
-- The event ids by label (results are in element order: index 0 is element 1).
CREATE TEMP TABLE a326_ids(label TEXT PRIMARY KEY, id UUID, ord INTEGER);
INSERT INTO a326_ids
  SELECT e.label, (r.value ->> 'eventId')::UUID, e.n
  FROM a326_els e JOIN LATERAL (SELECT x.value FROM jsonb_array_elements(:'a326_p1'::JSONB -> 'results') x
    WHERE (x.value ->> 'index')::INTEGER = e.n - 1) r ON TRUE
  WHERE (r.value ->> 'eventId') IS NOT NULL;
SELECT pg_temp.a326_assert((SELECT count(*) = 6 FROM a326_ids)
  AND (SELECT count(*) = 6 FROM platform_private.provider_webhook_events e WHERE e.organization_id = pg_temp.a326_id(1) AND e.provider = 'wazzup'),
  'fixture: six events were written (five stored and one unparsed); the two filtered elements were only counted');

-- A foreign event of the same organization (another provider) and an event of another organization, and an unknown id.
INSERT INTO platform_private.provider_webhook_events (organization_id, provider, provider_account_ref, provider_conversation_ref,
  provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type, provider_occurred_at,
  verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id)
VALUES (pg_temp.a326_id(1), 'amocrm', 'amocrm:a326', NULL, NULL, 'a326-amo-1', NULL, 'a326-amo-1', 'message', clock_timestamp(),
  'verified', '{"synthetic": true}', '{}', 'synthetic:a326', repeat('c', 64), gen_random_uuid());
SELECT id AS a326_amo FROM platform_private.provider_webhook_events WHERE provider = 'amocrm' AND provider_request_id = 'a326-amo-1' \gset

-- Snapshot before reading and replaying.
CREATE TEMP TABLE a326_snap AS
  SELECT (SELECT count(*) FROM platform_private.provider_webhook_events) AS events,
    (SELECT count(*) FROM platform_private.wazzup_event_projections) AS projections,
    (SELECT count(*) FROM platform_private.wazzup_message_bindings) AS bindings,
    (SELECT COALESCE(jsonb_object_agg(c.counter, c.n), '{}'::JSONB) FROM (
       SELECT counter, sum(n) AS n FROM platform_private.wazzup_daily_counters
       WHERE organization_id = pg_temp.a326_id(1) GROUP BY counter) c) AS counters;
SELECT pg_temp.a326_assert((SELECT counters ->> 'filtered_inbound_channel' = '1' AND counters ->> 'filtered_inbound_chat_type' = '1'
    AND counters ->> 'unparsed' = '1' FROM a326_snap),
  'fixture: the counters have the two filtered elements and the unparsed one: ' || (SELECT counters::TEXT FROM a326_snap));

-- Ask in reverse order, with a repeated id, an unknown id and the foreign event.
SELECT pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY[%s]::uuid[])', pg_temp.a326_id(1),
  (SELECT string_agg(quote_literal(id), ', ' ORDER BY ord DESC) FROM a326_ids)
  || format(', %L, %L, %L', (SELECT id FROM a326_ids WHERE label = 'inbound'), pg_temp.a326_id(7777), :'a326_amo'))) AS a326_rd \gset
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_rd'::JSONB) IS NULL
  AND jsonb_array_length(:'a326_rd'::JSONB -> 'events') = 6
  AND (:'a326_rd'::JSONB ->> 'missing') = '2'
  AND (:'a326_rd'::JSONB - ARRAY['events', 'missing']) = '{}'::JSONB
  AND (SELECT bool_and(x.value - ARRAY['eventId', 'eventType', 'kind', 'element'] = '{}'::JSONB) FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x),
  'the stored events come back once each (a repeated id collapses), two ids are missing (the unknown one and the amoCRM event), the shapes are exact: ' || left(:'a326_rd', 400));
SELECT pg_temp.a326_assert(
  (SELECT array_agg(x.value ->> 'eventId' ORDER BY x.ordinality) FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') WITH ORDINALITY x)
    = (SELECT array_agg(id::TEXT ORDER BY ord DESC) FROM a326_ids),
  'the order is the order asked (here the reverse of the write order)');
SELECT pg_temp.a326_assert(
  (SELECT x.value ->> 'kind' = 'message' AND x.value ->> 'eventType' = 'message' AND x.value -> 'element' = (SELECT element -> 'element' FROM a326_els WHERE label = 'inbound')
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'inbound'))
  AND (SELECT x.value ->> 'kind' = 'message' AND x.value ->> 'eventType' = 'message' AND (x.value #>> '{element,isEcho}') = 'true'
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'echo'))
  AND (SELECT x.value ->> 'kind' = 'message' AND x.value ->> 'eventType' = 'message.edited' AND (x.value #>> '{element,isEdited}') = 'true'
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'edited'))
  AND (SELECT x.value ->> 'kind' = 'message' AND x.value ->> 'eventType' = 'message.deleted' AND (x.value #>> '{element,isDeleted}') = 'true'
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'deleted')),
  'a message, a seller echo, an edit and a deletion are all kind message, with their own event type and the stored element');
SELECT pg_temp.a326_assert(
  (SELECT x.value ->> 'kind' = 'channel' AND x.value ->> 'eventType' = 'channel.state' AND (x.value #>> '{element,state}') = 'active'
      AND NOT (x.value -> 'element' ? 'qrCode') AND NOT (x.value::TEXT ~* 'qr')
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'channel'))
  AND (SELECT x.value -> 'kind' = 'null'::JSONB AND x.value -> 'element' = 'null'::JSONB AND x.value ->> 'eventType' = 'unparsed'
     FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') x WHERE x.value ->> 'eventId' = (SELECT id::TEXT FROM a326_ids WHERE label = 'broken')),
  'a channel update is kind channel and the QR code was never stored; an unparsed event gives kind and element NULL (nothing to repeat)');
-- Another organization gets nothing of organization 1; the read writes nothing.
SELECT pg_temp.a326_svc(format('SELECT platform.whatsapp_intake_events_read_v1(%L, ARRAY[%s]::uuid[])', pg_temp.a326_id(2),
  (SELECT string_agg(quote_literal(id), ', ') FROM a326_ids))) AS a326_rd_org2 \gset
SELECT pg_temp.a326_assert(jsonb_array_length(:'a326_rd_org2'::JSONB -> 'events') = 0 AND (:'a326_rd_org2'::JSONB ->> 'missing') = '6',
  'another organization asking for the same ids gets none of them: ' || :'a326_rd_org2');
SELECT pg_temp.a326_assert(
  (SELECT s.events = (SELECT count(*) FROM platform_private.provider_webhook_events)
      AND s.projections = (SELECT count(*) FROM platform_private.wazzup_event_projections)
      AND s.bindings = (SELECT count(*) FROM platform_private.wazzup_message_bindings) FROM a326_snap s),
  'reading the events writes nothing');

-- The replay: the returned elements go back through the persist function as they are.
SELECT pg_temp.a326_persist((SELECT jsonb_agg(jsonb_build_object('kind', x.value ->> 'kind', 'element', x.value -> 'element')
    ORDER BY x.ordinality)
  FROM jsonb_array_elements(:'a326_rd'::JSONB -> 'events') WITH ORDINALITY x WHERE x.value ->> 'kind' IS NOT NULL)) AS a326_p2 \gset
SELECT pg_temp.a326_assert(pg_temp.a326_err(:'a326_p2'::JSONB) IS NULL AND (:'a326_p2'::JSONB ->> 'transportActive') = 'true'
  AND (:'a326_p2'::JSONB #>> '{counts,deduplicated}') = '5' AND (:'a326_p2'::JSONB #>> '{counts,stored}') = '0'
  AND (:'a326_p2'::JSONB #>> '{counts,filtered}') = '0' AND (:'a326_p2'::JSONB #>> '{counts,unparsed}') = '0'
  AND (:'a326_p2'::JSONB #>> '{counts,failed}') = '0'
  AND (SELECT bool_and(x.value ->> 'outcome' = 'deduplicated') FROM jsonb_array_elements(:'a326_p2'::JSONB -> 'results') x),
  'replay: all five stored events are deduplicated, none is stored, filtered or unparsed again: ' || :'a326_p2');
SELECT pg_temp.a326_assert(
  (SELECT s.events = (SELECT count(*) FROM platform_private.provider_webhook_events)
      AND s.projections = (SELECT count(*) FROM platform_private.wazzup_event_projections)
      AND s.bindings = (SELECT count(*) FROM platform_private.wazzup_message_bindings)
      AND s.counters = (SELECT COALESCE(jsonb_object_agg(c.counter, c.n), '{}'::JSONB) FROM (
        SELECT counter, sum(n) AS n FROM platform_private.wazzup_daily_counters
        WHERE organization_id = pg_temp.a326_id(1) GROUP BY counter) c) FROM a326_snap s),
  'replay: no new event, no projection, no binding and no daily counter moved (the filtered elements are not stored, so they are not replayed)');
-- Control: the counter check can fail. Delivering a filtered element again (as Wazzup itself might) is counted again - the
-- known remainder of the replay deviation, recorded in PLAN_CHANGES; a stored element is not.
SELECT pg_temp.a326_persist(jsonb_build_array((SELECT element FROM a326_els WHERE label = 'other_channel'))) AS a326_p3 \gset
SELECT pg_temp.a326_assert((:'a326_p3'::JSONB #>> '{counts,filtered}') = '1'
  AND (SELECT (SELECT sum(n) FROM platform_private.wazzup_daily_counters WHERE organization_id = pg_temp.a326_id(1)
        AND counter = 'filtered_inbound_channel') = 2),
  'control: a filtered element delivered again by the provider is counted again (so the unchanged counters above are a real result)');

SELECT 'A326_WAZZUP_FOLLOWUPS_SUITE_PASSED' AS a326_suite_marker;
ROLLBACK;
