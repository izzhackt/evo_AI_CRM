\set ON_ERROR_STOP on
-- Boundary suite for migrations 324 and 325 «WhatsApp продаж через Wazzup: приём и запрет отправки» (план этапа 1
-- docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md, срез W1: база данных). Runs on the real chain right after 325 inside one
-- transaction that is rolled back, with its own synthetic organizations, members, Wazzup elements and clients: no Wazzup,
-- no WhatsApp, no message to anyone, no real person, no real number or key, no production action. The functions are
-- called through the same request.jwt.claims role gate the service path uses; staff sessions are the real
-- custom_access_token_hook claims; the WAHA side of the send paths goes through the REAL projection and the REAL
-- manual-send chain.
--
-- Proves:
--  1. posture: the eight new tables are RLS-forced and closed to every API role; the nine service functions are definers
--     with an empty search_path and EXECUTE for service_role only; the staff read is executable by authenticated only;
--     the helpers by nobody; anon, authenticated, service_role without the claim and a plain session are refused (42501);
--     argument errors are 22023; the 25 replaced bodies kept their owner, ACL, definer, volatility and search_path;
--  2. the model: the provider checks accept the wazzup shapes and still refuse malformed rows of the other providers;
--     a conversation belongs to exactly one transport; the Wazzup channel of a conversation is immutable; the chat
--     bindings are append-only; a message binding changes only its deletion mark, once; a Wazzup message without its exact
--     binding is refused at commit;
--  3. the operator commands: bind the channel (one channel, replay by request id, another input under the same id is
--     refused), switch the transport (needs a bound channel, send_enabled stays false, replay), provision and resolve the
--     key through Vault (replay, rotation, the hash is checked), observe the channel state;
--  4. the intake write: nothing is written unless the transport is wazzup; dedupe by message id; two different edits are
--     two events, the same edit once; two states of the channel are two events; a batch of 150 goes in two portions; a
--     broken element becomes an `unparsed` event and the rest are stored; another channel and other chat types are only
--     counted; the QR code is never stored; an element that fails on write does not stop the others;
--  5. the projection: a new number gets a conversation and a client but no lead; seller replies become outbound messages,
--     automatic echoes do not (the chat stays unanswered), a reply before the conversation waits and is added in order;
--     media marks are the 259 marks (the agent sees photo / voice / file); edits are ignored; a deletion hides the text
--     from the agent (also when it came before the message); an invalid chat id and a conversation handed to a curator go
--     to review; the sweep works in time order, retries failures up to 8 times and reports the age of the oldest
--     unprocessed event; a deletion takes the chat lock the message projection takes (so it cannot miss a message being
--     projected in another transaction); the sweep never waits (a busy count in its answer), adds the automatic echoes once
--     at the end, and a failure never overwrites an outcome that is already final nor aborts the pass when its own record
--     cannot be written;
--  6. the identity: a student with a direct case (rule 316) keeps their client and lead; a client with one open lead gets
--     it, with two - the client without a lead; an imported client is matched, not duplicated; two clients on one number
--     leave the conversation without a client and closed to the agent; a student who declined the AI helpers is closed to
--     the agent when found by number;
--  7. the send gates on all six paths: with the transport wazzup (and for a Wazzup conversation) the agent tool makes a
--     `receive_only` draft in Auto and with an authority code and never `needs_dispatch`, the authorization is refused, the
--     draft mark accepts the code, the night autoresponder says `receive_only` at due, commit and authorize, the manual
--     reply is refused before any authorization, an authorized item is not claimed (and is claimed once the gate opens);
--     without Wazzup the WAHA behaviour is as before except that an unknown channel state makes a draft;
--  8. the Gemini gates: a Wazzup conversation gives the poller no pointer, no ticket, no memory, no night summary, no U9 proposal, and the
--     autoresponder says `wazzup_ai_off`; a WAHA conversation is unchanged; switching the flag on opens them - except for the
--     ambiguous conversation (two clients on one number), which stays closed to Gemini on every path whatever the flag;
--  9. the agent reading: `receive_only` and `can_reply = false`, `identity_unresolved`, the deleted message without text, in the
--     list too: no preview when the latest message was deleted by the client;
-- 10. the health alert (321): the wazzup session, the `gap` kind and the new reasons; switching the transport closes the
--     `crm_primary` alerts (and leaving wazzup closes the wazzup ones); crm_primary is unchanged;
-- 11. the list name and number (278), the staff transport read, and the hidden origin: a Wazzup trace is invisible to
--     the table reads and to the client and lead cards, as a WAHA one is.
-- 12. the operator's selection of the event ids for check A6 (runbook, section 4): the inbound events of the test client's
--     conversation inside the A2-A5 window, nothing of other conversations, no seller replies, [from, to) bounds.
BEGIN;

SET LOCAL TIME ZONE 'UTC';
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

\echo A325_WAZZUP_INTAKE_SUITE_START

CREATE FUNCTION pg_temp.a325_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('32500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a325_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A325: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a325_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.a325_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a325_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a325_agent(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_call('evo_ai_agent', NULL, p_sql)
$$;
CREATE TEMP TABLE a325_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a325_claims TO authenticated;
CREATE FUNCTION pg_temp.a325_as(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_call('authenticated', (SELECT claims FROM a325_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a325_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a325_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a325_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture.
--   org 1 (under test): actor 1 system admin (the intake owner, reads everything), actor 2 a student-role member (no staff
--     rights: an ineligible owner, refused readers), actor 4 a student with a cabinet (consent scenarios)
--   org 2: actor 3 system admin (isolation)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a325_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a325_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 2, 'admin', TRUE), (4, 1, 'student', FALSE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a325_id(1), 'A325 Fictional organization', 'active'),
  (pg_temp.a325_id(2), 'A325 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a325_id(100 + n), 'a325-' || n || '@example.invalid', '{}'::JSONB FROM a325_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a325_id(200 + n), pg_temp.a325_id(100 + n), 'A325 Actor ' || n, 'active', 1 FROM a325_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a325_id(300 + a.n), pg_temp.a325_id(a.org), pg_temp.a325_id(200 + a.n), 'active', a.coarse,
    (SELECT id FROM platform.role_bundle_versions WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a325_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a325_id(300 + n) FROM a325_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a325_id(401), pg_temp.a325_id(1), 'organization', pg_temp.a325_id(1), 1),
  (pg_temp.a325_id(402), pg_temp.a325_id(2), 'organization', pg_temp.a325_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a325_id(1), pg_temp.a325_id(301), pg_temp.a325_id(401), 1, 1, TRUE, 'system', 'A325 synthetic scope', pg_temp.a325_id(601)),
  (pg_temp.a325_id(2), pg_temp.a325_id(303), pg_temp.a325_id(402), 1, 1, TRUE, 'system', 'A325 synthetic scope', pg_temp.a325_id(602));
INSERT INTO a325_claims(actor, claims)
  SELECT a.n, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a325_id(100 + a.n),
    'claims', jsonb_build_object('sub', pg_temp.a325_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT
  FROM a325_actors a;
SELECT pg_temp.a325_assert((SELECT count(*) = 4 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id') FROM a325_claims),
  'every fixture actor got real hook claims');
SELECT pg_temp.a325_assert(platform_private.staff_intake_owner_is_eligible(pg_temp.a325_id(1), pg_temp.a325_id(301))
  AND NOT platform_private.staff_intake_owner_is_eligible(pg_temp.a325_id(1), pg_temp.a325_id(302)),
  'fixture: the system Admin is an eligible intake owner, the student-role member is not');

-- Wazzup fixtures: the channel id, the time base and the element builders. Numbers are synthetic (the invalid 996... range).
CREATE TEMP TABLE a325_clock(t0 TIMESTAMPTZ NOT NULL);
INSERT INTO a325_clock VALUES (date_trunc('second', clock_timestamp() - INTERVAL '2 hours'));
CREATE FUNCTION pg_temp.a325_channel() RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$ SELECT pg_temp.a325_id(9001) $$;
CREATE FUNCTION pg_temp.a325_ts(n INTEGER) RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT to_char((SELECT t0 FROM a325_clock) + n * INTERVAL '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
-- One Wazzup message element.
CREATE FUNCTION pg_temp.a325_msg(p_id TEXT, p_chat TEXT, p_text TEXT, p_n INTEGER, p_echo BOOLEAN DEFAULT FALSE,
  p_extra JSONB DEFAULT '{}'::JSONB) RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('messageId', p_id, 'channelId', pg_temp.a325_channel()::TEXT, 'chatType', 'whatsapp',
    'chatId', p_chat, 'dateTime', pg_temp.a325_ts(p_n), 'type', 'text', 'isEcho', p_echo, 'text', p_text,
    'status', CASE WHEN p_echo THEN 'sent' ELSE 'inbound' END)) || p_extra
$$;
CREATE FUNCTION pg_temp.a325_el(p_message JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_build_object('kind', 'message', 'element', p_message)
$$;
CREATE FUNCTION pg_temp.a325_persist(p_elements JSONB, p_counters JSONB DEFAULT '{}'::JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, %L, ''current'', %L::jsonb, %L::jsonb)',
    pg_temp.a325_id(1), encode(sha256(convert_to(p_elements::TEXT, 'UTF8')), 'hex'), p_elements, p_counters))
$$;
CREATE FUNCTION pg_temp.a325_event(p_message_id TEXT, p_type TEXT DEFAULT 'message') RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT e.id FROM platform_private.provider_webhook_events e
  WHERE e.organization_id = pg_temp.a325_id(1) AND e.provider = 'wazzup' AND e.event_type = p_type AND e.payload_id = p_message_id
  ORDER BY e.received_at DESC, e.id DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.a325_project(p_event UUID, p_owner INTEGER DEFAULT 301) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_project_event_v1(%L, %L, %L, %L)', pg_temp.a325_id(1), p_event,
    pg_temp.a325_id(p_owner), gen_random_uuid()))
$$;
CREATE FUNCTION pg_temp.a325_sweep(p_owner INTEGER DEFAULT 301, p_limit INTEGER DEFAULT 100) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_projection_sweep_v1(%L, %L, %s)', pg_temp.a325_id(1),
    pg_temp.a325_id(p_owner), p_limit))
$$;
-- Persist the elements and sweep: the result of the sweep.
CREATE FUNCTION pg_temp.a325_ingest(p_messages JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE r JSONB;
BEGIN
  r := pg_temp.a325_persist((SELECT jsonb_agg(pg_temp.a325_el(m.value)) FROM jsonb_array_elements(p_messages) m));
  IF r ? 'error' OR NOT (r ->> 'transportActive')::BOOLEAN THEN
    RAISE EXCEPTION 'A325 ingest: %', r;
  END IF;
  RETURN pg_temp.a325_sweep();
END
$$;
CREATE FUNCTION pg_temp.a325_state(p_message_id TEXT, p_type TEXT DEFAULT 'message') RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT p.state FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event(p_message_id, p_type)
$$;
CREATE FUNCTION pg_temp.a325_conv(p_digits TEXT) RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT b.conversation_id FROM platform_private.wazzup_chat_bindings b
  WHERE b.organization_id = pg_temp.a325_id(1) AND b.chat_digits = p_digits
$$;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_assert(
  (SELECT count(*) = 8 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
      AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('evo_ai_agent', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
   FROM pg_class c WHERE c.oid IN ('platform_private.wazzup_channels'::REGCLASS, 'platform_private.wazzup_chat_bindings'::REGCLASS,
     'platform_private.wazzup_message_bindings'::REGCLASS, 'platform_private.wazzup_event_projections'::REGCLASS,
     'platform_private.wazzup_daily_counters'::REGCLASS, 'platform_private.whatsapp_transport_state'::REGCLASS,
     'platform_private.wazzup_api_key_bindings'::REGCLASS, 'platform_private.wazzup_operator_events'::REGCLASS)),
  'posture: the eight new tables are RLS-forced and closed to anon, authenticated, service_role and the AI agent role');
SELECT pg_temp.a325_assert(
  (SELECT count(*) = 9 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'platform' AND (p.proname LIKE 'wazzup\_%\_v1' OR p.proname = 'whatsapp_transport_configure_v1')),
  'posture: nine service functions, definers with an empty search_path, EXECUTE for service_role only');
SELECT pg_temp.a325_assert(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
   FROM pg_proc p WHERE p.oid = 'platform.staff_whatsapp_transport_v1(uuid)'::REGPROCEDURE),
  'posture: the staff transport read is a hardened definer for authenticated only');
SELECT pg_temp.a325_assert(
  (SELECT count(*) >= 25 AND bool_and(p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'platform_private' AND (p.proname LIKE 'wazzup\_%' OR p.proname IN ('whatsapp_send_allowed', 'whatsapp_gemini_allowed',
     'whatsapp_intake_direct_case_match', 'whatsapp_intake_phone_match', 'acquire_wazzup_canonical_identity',
     'require_private_wazzup_message_binding', 'whatsapp_alert_title_for', 'whatsapp_alert_text_for'))),
  'posture: every helper has an empty search_path and no grant to any role');
-- Every service function refuses the other roles and a missing claim (42501), anon and a plain session included.
CREATE FUNCTION pg_temp.a325_calls() RETURNS TABLE (label TEXT, sql TEXT) LANGUAGE SQL AS $$
  VALUES
    ('persist', format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', ''[]''::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1))),
    ('project', format('SELECT platform.wazzup_project_event_v1(%L, %L, %L, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7777), pg_temp.a325_id(301), pg_temp.a325_id(7778))),
    ('sweep', format('SELECT platform.wazzup_projection_sweep_v1(%L, %L, 10)', pg_temp.a325_id(1), pg_temp.a325_id(301))),
    ('bind', format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0000'', repeat(''b'', 64), %L)', pg_temp.a325_id(1), pg_temp.a325_channel(), pg_temp.a325_id(7779))),
    ('observe', format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''active'', NULL)', pg_temp.a325_id(1), pg_temp.a325_channel())),
    ('configure', format('SELECT platform.whatsapp_transport_configure_v1(%L, ''none'', NULL, NULL, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7780))),
    ('provision', format('SELECT platform.wazzup_api_key_provision_v1(%L, ''0123456789abcdef-synthetic'', %L)', pg_temp.a325_id(1), pg_temp.a325_id(7781))),
    ('resolve', format('SELECT platform.wazzup_api_key_resolve_v1(%L)', pg_temp.a325_id(1))),
    ('counts', format('SELECT platform.wazzup_daily_counts_v1(%L, CURRENT_DATE)', pg_temp.a325_id(1)))
$$;
SELECT pg_temp.a325_assert(
  (SELECT bool_and(pg_temp.a325_err(pg_temp.a325_call('authenticated', a.claims, c.sql)) = '42501'
      AND pg_temp.a325_err(pg_temp.a325_anon(c.sql)) = '42501'
      AND pg_temp.a325_err(pg_temp.a325_call('service_role', NULL, c.sql)) = '42501'
      AND pg_temp.a325_err(pg_temp.a325_call('service_role', '{"role":"authenticated"}', c.sql)) = '42501'
      AND pg_temp.a325_err(pg_temp.a325_call('evo_ai_agent', NULL, c.sql)) = '42501')
   FROM pg_temp.a325_calls() c CROSS JOIN (SELECT claims FROM a325_claims WHERE actor = 1) a),
  'every service function refuses authenticated, anon, service_role without the service claim and the AI agent role (42501)');
SELECT pg_temp.a325_assert(
  pg_temp.a325_err(pg_temp.a325_as(2, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1)))) = '42501'
  AND pg_temp.a325_err(pg_temp.a325_as(3, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1)))) = '42501'
  AND pg_temp.a325_err(pg_temp.a325_anon(format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1)))) = '42501'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1)))) = '42501'
  AND pg_temp.a325_err(pg_temp.a325_as(1, 'SELECT platform.staff_whatsapp_transport_v1(NULL)')) = '22023',
  'the staff transport read refuses a keyless member, another organization''s Admin, anon and service_role; a null organization is 22023');
-- Argument errors are 22023 (the claim is right).
SELECT pg_temp.a325_assert(
  pg_temp.a325_err(pg_temp.a325_svc('SELECT platform.wazzup_webhook_persist_v1(NULL, repeat(''a'', 64), ''current'', ''[]''::jsonb, ''{}''::jsonb)')) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, ''xyz'', ''current'', ''[]''::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''other'', ''[]''::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', ''{}''::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', (SELECT jsonb_agg(jsonb_build_object(''kind'', ''message'', ''element'', ''{}''::jsonb)) FROM generate_series(1, 101)), ''{}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', ''[{"kind":"status","element":{}}]''::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', ''[]''::jsonb, ''{"surprise":1}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''a'', 64), ''current'', ''[]''::jsonb, ''{"status":-1}''::jsonb)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_project_event_v1(NULL, %L, %L, %L)', pg_temp.a325_id(7777), pg_temp.a325_id(301), pg_temp.a325_id(7778)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_project_event_v1(%L, %L, %L, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7777), pg_temp.a325_id(301), pg_temp.a325_id(7778)))) = '42501'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_projection_sweep_v1(%L, %L, 0)', pg_temp.a325_id(1), pg_temp.a325_id(301)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_projection_sweep_v1(%L, %L, 501)', pg_temp.a325_id(1), pg_temp.a325_id(301)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''telegram'', ''0000'', repeat(''b'', 64), %L)', pg_temp.a325_id(1), pg_temp.a325_channel(), pg_temp.a325_id(7779)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''12345'', repeat(''b'', 64), %L)', pg_temp.a325_id(1), pg_temp.a325_channel(), pg_temp.a325_id(7779)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''1234'', ''not-a-hash'', %L)', pg_temp.a325_id(1), pg_temp.a325_channel(), pg_temp.a325_id(7779)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''bad state!'', NULL)', pg_temp.a325_id(1), pg_temp.a325_channel()))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''telegram'', NULL, NULL, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7780)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''none'', NULL, NULL, NULL)', pg_temp.a325_id(1)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, ''short'', %L)', pg_temp.a325_id(1), pg_temp.a325_id(7781)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, E''0123456789abcdef\n'', %L)', pg_temp.a325_id(1), pg_temp.a325_id(7781)))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_resolve_v1(NULL)'))) = '22023'
  AND pg_temp.a325_err(pg_temp.a325_svc(format('SELECT platform.wazzup_daily_counts_v1(%L, NULL)', pg_temp.a325_id(1)))) = '22023',
  'argument errors are 22023: organization, hash, slot, shape, 101 elements, unknown kind, unknown counter, negative counter, sweep limit, channel, state word, transport, request id, key');

-- ---------------------------------------------------------------------------
-- 2. The model. Direct writes as the owner: the checks and triggers are the database's own.
-- ---------------------------------------------------------------------------
-- 'ok' when the statement(s) are accepted, otherwise the SQLSTATE; whatever was written is rolled back either way.
CREATE FUNCTION pg_temp.a325_try(p_sql TEXT, p_then TEXT DEFAULT NULL) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  IF p_then IS NOT NULL THEN
    EXECUTE p_then;
  END IF;
  RAISE EXCEPTION 'a325 rollback' USING ERRCODE = 'P0909';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'P0909' THEN
    RETURN 'ok';
  END IF;
  RETURN SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.a325_event_sql(p_provider TEXT, p_account TEXT, p_session TEXT, p_event_type TEXT, p_variant TEXT,
  p_request TEXT, p_payload TEXT DEFAULT 'a325-shape') RETURNS TEXT LANGUAGE SQL AS $$
  SELECT format($q$INSERT INTO platform_private.provider_webhook_events (organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type,
    provider_occurred_at, verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id)
    VALUES (%L, %L, %L, NULL, %L, %L, %L, %L, %L, clock_timestamp(), 'verified', '{}', '{}', 'synthetic:a325', repeat('c', 64), gen_random_uuid())$q$,
    pg_temp.a325_id(2), p_provider, p_account, p_variant, p_request, p_session, p_payload, p_event_type)
$$;
SELECT pg_temp.a325_assert(
  pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message', NULL, 'shape-1')) = 'ok'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message.edited', repeat('d', 64), 'shape-2')) = 'ok'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'channel.state', repeat('e', 64), 'shape-3')) = 'ok'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'unparsed', NULL, 'shape-4')) = 'ok',
  'the wazzup shapes are accepted: message and unparsed without a variant, edit / deletion / channel state with a SHA-256 variant');
SELECT pg_temp.a325_assert(
  pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, 'crm_primary', 'message', NULL, 'bad-1')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:not-a-channel', NULL, 'message', NULL, 'bad-2')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message.ack', NULL, 'bad-3')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message.edited', NULL, 'bad-4')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message', repeat('d', 64), 'bad-5')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message.deleted', 'short', 'bad-6')) = '23514',
  'malformed wazzup rows are refused: a session, a bad account, an unknown event type, a missing or extra variant');
SELECT pg_temp.a325_assert(
  pg_temp.a325_try(pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message', NULL, 'shape-1'),
    pg_temp.a325_event_sql('wazzup', 'wazzup:' || pg_temp.a325_channel()::TEXT, NULL, 'message', NULL, 'shape-1b')) = '23505',
  'the business key: a second wazzup message event with the same message id is a unique violation');
SELECT pg_temp.a325_assert(
  pg_temp.a325_try(pg_temp.a325_event_sql('waha', 'waha:crm_primary', NULL, 'message.any', NULL, 'waha-1')) = '22023'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('waha', 'waha:crm_primary', 'crm_primary', 'message.any', repeat('d', 64), 'waha-2')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('waha', 'waha:crm_primary', 'crm_primary', 'message.ack', NULL, 'waha-3')) = '23514'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('waha', 'waha:crm_primary', 'crm_primary', 'message.any', NULL, 'waha-4')) = 'ok'
  AND pg_temp.a325_try(pg_temp.a325_event_sql('kommo', 'kommo:1', NULL, 'message.any', NULL, 'kommo-1')) = '23514',
  'the WAHA and kommo shapes are unchanged: a session is required, message.any takes no variant, message.ack requires one');
SELECT pg_temp.a325_assert(
  pg_temp.a325_try($q$INSERT INTO platform_private.wazzup_channels (organization_id, channel_id, transport, phone_last4, phone_sha256, request_id)
    VALUES ($q$ || quote_literal(pg_temp.a325_id(1)) || $q$, gen_random_uuid(), 'telegram', '0000', repeat('b', 64), gen_random_uuid())$q$) = '23514'
  AND pg_temp.a325_try($q$INSERT INTO platform_private.whatsapp_transport_state (organization_id, active_transport) VALUES ($q$
    || quote_literal(pg_temp.a325_id(1)) || $q$, 'telegram')$q$) = '23514'
  AND pg_temp.a325_try($q$INSERT INTO platform_private.whatsapp_transport_state (organization_id, active_transport, send_enabled) VALUES ($q$
    || quote_literal(pg_temp.a325_id(1)) || $q$, 'wazzup', TRUE)$q$) = '23514',
  'the new tables'' checks: a transport and a channel kind are from a closed list; send_enabled can never be true under wazzup in stage 1');

-- ---------------------------------------------------------------------------
-- 3. The operator commands: channel, transport, key, state.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', NULL, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7101))) AS a325_cfg_nochannel \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_cfg_nochannel'::JSONB) = '55000' AND pg_temp.a325_msg(:'a325_cfg_nochannel'::JSONB) = 'wazzup_channel_missing'
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_transport_state) AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_operator_events),
  'the wazzup path cannot be switched on without a bound channel: nothing is written: ' || :'a325_cfg_nochannel');
-- Nothing is written while the transport is not wazzup (no state row = none).
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('inactive-1', '996000000101', 'Привет', 1)))) AS a325_inactive \gset
SELECT pg_temp.a325_assert((:'a325_inactive'::JSONB ->> 'transportActive') = 'false' AND (:'a325_inactive'::JSONB -> 'results') = '[]'::JSONB
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND organization_id = pg_temp.a325_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_daily_counters),
  'transport none: the persist answers transportActive = false and writes no event and no counter: ' || :'a325_inactive');

SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0042'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), repeat('b', 64), pg_temp.a325_id(7102))) AS a325_bind \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0042'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), repeat('b', 64), pg_temp.a325_id(7102))) AS a325_bind_again \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0043'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), repeat('b', 64), pg_temp.a325_id(7102))) AS a325_bind_other \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0042'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(9999), repeat('b', 64), pg_temp.a325_id(7103))) AS a325_bind_second \gset
SELECT pg_temp.a325_assert((:'a325_bind'::JSONB ->> 'channelId') = pg_temp.a325_channel()::TEXT AND (:'a325_bind'::JSONB ->> 'last4') = '0042'
  AND (:'a325_bind'::JSONB ->> 'replayed') = 'false'
  AND (:'a325_bind_again'::JSONB ->> 'replayed') = 'true' AND (:'a325_bind_again'::JSONB - 'replayed') = (:'a325_bind'::JSONB - 'replayed')
  AND pg_temp.a325_err(:'a325_bind_other'::JSONB) = '22023'
  AND pg_temp.a325_err(:'a325_bind_second'::JSONB) = '55000' AND pg_temp.a325_msg(:'a325_bind_second'::JSONB) = 'wazzup_channel_already_bound'
  AND (SELECT count(*) = 1 FROM platform_private.wazzup_channels WHERE organization_id = pg_temp.a325_id(1) AND channel_id = pg_temp.a325_channel()
       AND transport = 'whatsapp' AND phone_last4 = '0042' AND state IS NULL)
  AND (SELECT count(*) = 1 AND bool_and(after_state ?& ARRAY['channelId', 'transport', 'last4'] AND NOT (after_state ? 'phone'))
       FROM platform_private.wazzup_operator_events WHERE action = 'channel.bind'),
  'bind: one channel; the replay returns the same; another input under the same request id is 22023; a second channel is refused; the journal keeps no phone: '
  || :'a325_bind' || :'a325_bind_second');
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''wapi'', ''0042'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), repeat('b', 64), pg_temp.a325_id(7104))) AS a325_rebind \gset
SELECT pg_temp.a325_assert((:'a325_rebind'::JSONB ->> 'transport') = 'wapi'
  AND (SELECT transport = 'wapi' FROM platform_private.wazzup_channels WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT before_state ->> 'transport' = 'whatsapp' FROM platform_private.wazzup_operator_events WHERE request_id = pg_temp.a325_id(7104)),
  'the same channel can be re-bound with its real kind; the journal keeps the previous value');
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_bind_v1(%L, %L, ''whatsapp'', ''0042'', %L, %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), repeat('b', 64), pg_temp.a325_id(7105))) AS a325_rebind2 \gset
-- Channel state: the word and the time; an older observation does not overwrite a newer one; an unknown channel changes nothing.
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''init'', %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), clock_timestamp() - INTERVAL '10 minutes')) AS a325_obs1 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''active'', %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), clock_timestamp() - INTERVAL '5 minutes')) AS a325_obs2 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''qr'', %L)',
  pg_temp.a325_id(1), pg_temp.a325_channel(), clock_timestamp() - INTERVAL '20 minutes')) AS a325_obs_old \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_channel_observe_v1(%L, %L, ''active'', NULL)',
  pg_temp.a325_id(1), pg_temp.a325_id(9998))) AS a325_obs_unknown \gset
SELECT pg_temp.a325_assert((:'a325_obs1'::JSONB ->> 'updated') = 'true' AND (:'a325_obs2'::JSONB ->> 'updated') = 'true'
  AND (:'a325_obs_old'::JSONB ->> 'updated') = 'false' AND (:'a325_obs_unknown'::JSONB ->> 'updated') = 'false'
  AND (SELECT state = 'active' AND observed_at > clock_timestamp() - INTERVAL '6 minutes' FROM platform_private.wazzup_channels),
  'observe: the newest state wins, an older observation and an unknown channel change nothing');
SELECT pg_temp.a325_assert(NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_monitor WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'wazzup'),
  'the observation of the channel state does not touch the 321 series');

-- The transport: a bound channel exists, so the path can be switched; flags are changed without a release.
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', NULL, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7111))) AS a325_cfg1 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', NULL, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7111))) AS a325_cfg1_again \gset
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', true, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7111))) AS a325_cfg1_other \gset
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', true, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7112))) AS a325_cfg2 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', false, NULL, %L)',
  pg_temp.a325_id(1), pg_temp.a325_id(7113))) AS a325_cfg3 \gset
SELECT pg_temp.a325_assert((:'a325_cfg1'::JSONB ->> 'transport') = 'wazzup' AND (:'a325_cfg1'::JSONB ->> 'sendEnabled') = 'false'
  AND (:'a325_cfg1'::JSONB ->> 'aiTriggerEnabled') = 'false' AND (:'a325_cfg1'::JSONB ->> 'geminiEnabled') = 'false'
  AND (:'a325_cfg1'::JSONB ->> 'version') = '1' AND (:'a325_cfg1'::JSONB ->> 'replayed') = 'false'
  AND (:'a325_cfg1_again'::JSONB ->> 'replayed') = 'true' AND (:'a325_cfg1_again'::JSONB ->> 'version') = '1'
  AND pg_temp.a325_err(:'a325_cfg1_other'::JSONB) = '22023'
  AND (:'a325_cfg2'::JSONB ->> 'aiTriggerEnabled') = 'true' AND (:'a325_cfg2'::JSONB ->> 'geminiEnabled') = 'false' AND (:'a325_cfg2'::JSONB ->> 'version') = '2'
  AND (:'a325_cfg3'::JSONB ->> 'aiTriggerEnabled') = 'false' AND (:'a325_cfg3'::JSONB ->> 'version') = '3'
  AND (SELECT active_transport = 'wazzup' AND NOT send_enabled AND NOT ai_trigger_enabled AND NOT gemini_enabled AND version = 3
      FROM platform_private.whatsapp_transport_state WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = 3 FROM platform_private.wazzup_operator_events WHERE action = 'transport.configure'),
  'transport: wazzup is switched on with send_enabled false; a replay returns the stored answer, another input under the same id is 22023, an unset flag keeps its value, every change is journaled: '
  || :'a325_cfg1' || :'a325_cfg2');
SELECT pg_temp.a325_assert(pg_temp.a325_try(format('UPDATE platform_private.whatsapp_transport_state SET send_enabled = TRUE WHERE organization_id = %L',
    pg_temp.a325_id(1))) = '23514'
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_operator_events SET action = ''channel.bind'' WHERE organization_id = %L',
    pg_temp.a325_id(1))) = '55000'
  AND pg_temp.a325_try(format('DELETE FROM platform_private.wazzup_operator_events WHERE organization_id = %L', pg_temp.a325_id(1))) = '55000',
  'the database refuses send_enabled under wazzup; the operator journal is append-only');

-- The key: Vault holds the value, the table a hash.
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_resolve_v1(%L)', pg_temp.a325_id(1))) AS a325_key_none \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, %L, %L)', pg_temp.a325_id(1),
  'a325-synthetic-key-0000000001', pg_temp.a325_id(7121))) AS a325_key1 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, %L, %L)', pg_temp.a325_id(1),
  'a325-synthetic-key-0000000001', pg_temp.a325_id(7121))) AS a325_key1_again \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, %L, %L)', pg_temp.a325_id(1),
  'a325-synthetic-key-0000000002', pg_temp.a325_id(7121))) AS a325_key1_other \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, %L, %L)', pg_temp.a325_id(1),
  'a325-synthetic-key-0000000001', pg_temp.a325_id(7122))) AS a325_key1_same \gset
SELECT secret_id AS a325_secret_id FROM (SELECT api_key_secret_id AS secret_id FROM platform_private.wazzup_api_key_bindings
  WHERE organization_id = pg_temp.a325_id(1)) x \gset
SELECT pg_temp.a325_assert((:'a325_key_none'::JSONB ->> 'ready') = 'false' AND (:'a325_key_none'::JSONB ->> 'reasonCode') = 'missing_binding'
  AND (:'a325_key1'::JSONB ->> 'ready') = 'true' AND (:'a325_key1'::JSONB ->> 'changed') = 'true' AND (:'a325_key1'::JSONB ->> 'bindingVersion') = '1'
  AND (:'a325_key1'::JSONB ->> 'apiKeySha256') = encode(sha256(convert_to('a325-synthetic-key-0000000001', 'UTF8')), 'hex')
  AND (:'a325_key1_again'::JSONB ->> 'replayed') = 'true' AND pg_temp.a325_err(:'a325_key1_other'::JSONB) = '22023'
  AND (:'a325_key1_same'::JSONB ->> 'changed') = 'false' AND (:'a325_key1_same'::JSONB ->> 'bindingVersion') = '1'
  AND (SELECT decrypted_secret = 'a325-synthetic-key-0000000001' FROM vault.decrypted_secrets WHERE id = :'a325_secret_id'::UUID)
  AND (SELECT name = 'evo-wazzup-api-key-' || pg_temp.a325_id(1)::TEXT FROM vault.secrets WHERE id = :'a325_secret_id'::UUID),
  'key: provisioned into Vault, replay and an unchanged key change nothing, another key under the same request id is 22023: ' || :'a325_key1');
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_provision_v1(%L, %L, %L)', pg_temp.a325_id(1),
  'a325-synthetic-key-0000000002', pg_temp.a325_id(7123))) AS a325_key2 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_resolve_v1(%L)', pg_temp.a325_id(1))) AS a325_key_resolved \gset
SELECT pg_temp.a325_assert((:'a325_key2'::JSONB ->> 'changed') = 'true' AND (:'a325_key2'::JSONB ->> 'bindingVersion') = '2'
  AND (SELECT api_key_secret_id = :'a325_secret_id'::UUID FROM platform_private.wazzup_api_key_bindings WHERE organization_id = pg_temp.a325_id(1))
  AND (:'a325_key_resolved'::JSONB ->> 'ready') = 'true' AND (:'a325_key_resolved'::JSONB ->> 'apiKey') = 'a325-synthetic-key-0000000002'
  AND (:'a325_key_resolved'::JSONB ->> 'bindingVersion') = '2'
  AND pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_resolve_v1(%L)', pg_temp.a325_id(2))) ->> 'reasonCode' = 'missing_binding',
  'key rotation: the same Vault secret takes the new value, the version grows, the resolver returns the key to service_role only: ' || (:'a325_key_resolved'::JSONB - 'apiKey')::TEXT);
SELECT vault.update_secret(:'a325_secret_id'::UUID, 'a325-synthetic-key-TAMPERED', NULL, NULL) IS NOT NULL AS a325_tampered \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_api_key_resolve_v1(%L)', pg_temp.a325_id(1))) AS a325_key_bad \gset
SELECT pg_temp.a325_assert((:'a325_key_bad'::JSONB ->> 'ready') = 'false' AND (:'a325_key_bad'::JSONB ->> 'reasonCode') = 'secret_hash_mismatch'
  AND NOT (:'a325_key_bad'::JSONB ? 'apiKey'),
  'a Vault value that does not match the stored hash is never returned: ' || :'a325_key_bad');
SELECT vault.update_secret(:'a325_secret_id'::UUID, 'a325-synthetic-key-0000000002', NULL, NULL) IS NOT NULL AS a325_restored \gset
SELECT pg_temp.a325_assert(
  NOT EXISTS (SELECT 1 FROM platform_private.wazzup_operator_events e WHERE e::TEXT LIKE '%a325-synthetic-key%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_api_key_bindings b WHERE b::TEXT LIKE '%a325-synthetic-key%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events e WHERE e::TEXT LIKE '%a325-synthetic-key%'),
  'the key value is in Vault only: no journal row, binding row or event carries it');

-- ---------------------------------------------------------------------------
-- 4. The intake write.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте, хочу учиться в Китае', 10,
  FALSE, jsonb_build_object('contact', jsonb_build_object('name', 'Айгерим', 'avatarUri', 'https://example.invalid/a.png')))))) AS a325_p1 \gset
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте, хочу учиться в Китае', 10,
  FALSE, jsonb_build_object('contact', jsonb_build_object('name', 'Айгерим', 'avatarUri', 'https://example.invalid/a.png')))))) AS a325_p1_again \gset
SELECT pg_temp.a325_assert((:'a325_p1'::JSONB ->> 'transportActive') = 'true' AND (:'a325_p1'::JSONB #>> '{counts,stored}') = '1'
  AND (:'a325_p1'::JSONB #>> '{results,0,outcome}') = 'stored'
  AND (:'a325_p1_again'::JSONB #>> '{results,0,outcome}') = 'deduplicated'
  AND (:'a325_p1_again'::JSONB #>> '{results,0,eventId}') = (:'a325_p1'::JSONB #>> '{results,0,eventId}')
  AND (SELECT count(*) = 1 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = 1 FROM platform_private.wazzup_event_projections p WHERE p.state = 'pending'),
  'one message: stored once with a pending projection, the same batch again is a dedupe: ' || :'a325_p1');
SELECT pg_temp.a325_assert((SELECT e.provider = 'wazzup' AND e.provider_account_ref = 'wazzup:' || pg_temp.a325_channel()::TEXT
      AND e.provider_conversation_ref IS NULL AND e.waha_session_name IS NULL AND e.event_type = 'message' AND e.payload_id = 'm-1'
      AND e.provider_event_variant_ref IS NULL AND e.provider_request_id = 'message:m-1' AND e.verification_status = 'verified'
      AND e.verification_headers = '{"url_token":"current","signature":"absent"}'::JSONB
      AND e.verification_evidence_ref = 'wazzup-batch-sha256:' || encode(sha256(convert_to(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101',
        'Здравствуйте, хочу учиться в Китае', 10, FALSE, jsonb_build_object('contact', jsonb_build_object('name', 'Айгерим', 'avatarUri', 'https://example.invalid/a.png')))))::TEXT, 'UTF8')), 'hex')
      AND e.provider_occurred_at = (SELECT t0 + INTERVAL '10 seconds' FROM a325_clock)
      AND e.raw_payload ->> 'chatId' = '996000000101' AND e.payload_sha256 ~ '^[0-9a-f]{64}$'
   FROM platform_private.provider_webhook_events e WHERE e.id = pg_temp.a325_event('m-1')),
  'the stored event carries the wazzup identity, the verified status, the url-token slot, the batch evidence and the message time');
-- The second URL token slot (rotation) is recorded as such.
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_webhook_persist_v1(%L, repeat(''c'', 64), ''next'', %L::jsonb, ''{}''::jsonb)', pg_temp.a325_id(1),
  jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('m-next', '996000000101', 'Ещё одно', 11))))) AS a325_pnext \gset
SELECT pg_temp.a325_assert((:'a325_pnext'::JSONB #>> '{results,0,outcome}') = 'stored'
  AND (SELECT verification_headers ->> 'url_token' = 'next' FROM platform_private.provider_webhook_events WHERE id = pg_temp.a325_event('m-next')),
  'a message that came with the NEXT token is recorded with url_token = next');

-- Edits, deletions, channel states: variants are the SHA-256 of the element.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте (правка 1)', 12, FALSE, '{"isEdited": true}')),
  pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте (правка 2)', 13, FALSE, '{"isEdited": true}')),
  pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте (правка 1)', 12, FALSE, '{"isEdited": true}')),
  pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте, хочу учиться в Китае', 14, FALSE, '{"isDeleted": true}')),
  pg_temp.a325_el(pg_temp.a325_msg('m-1', '996000000101', 'Здравствуйте, хочу учиться в Китае', 14, FALSE, '{"isDeleted": true}')))) AS a325_p2 \gset
SELECT pg_temp.a325_assert((:'a325_p2'::JSONB #>> '{counts,stored}') = '3' AND (:'a325_p2'::JSONB #>> '{counts,deduplicated}') = '2'
  AND (SELECT count(*) = 2 AND count(DISTINCT provider_event_variant_ref) = 2 AND bool_and(provider_event_variant_ref ~ '^[0-9a-f]{64}$')
      FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND event_type = 'message.edited' AND payload_id = 'm-1')
  AND (SELECT count(*) = 1 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND event_type = 'message.deleted' AND payload_id = 'm-1')
  AND (SELECT count(*) = 1 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND event_type = 'message' AND payload_id = 'm-1'),
  'two different edits are two events, the same edit and the same deletion are deduplicated, the original message event is untouched: ' || :'a325_p2');
SELECT pg_temp.a325_persist(jsonb_build_array(
  jsonb_build_object('kind', 'channel', 'element', jsonb_build_object('channelId', pg_temp.a325_channel()::TEXT, 'state', 'active', 'timestamp', 1)),
  jsonb_build_object('kind', 'channel', 'element', jsonb_build_object('channelId', pg_temp.a325_channel()::TEXT, 'state', 'phoneUnavailable', 'timestamp', 2)),
  jsonb_build_object('kind', 'channel', 'element', jsonb_build_object('channelId', pg_temp.a325_channel()::TEXT, 'state', 'active', 'timestamp', 1)),
  jsonb_build_object('kind', 'channel', 'element', jsonb_build_object('channelId', pg_temp.a325_channel()::TEXT, 'state', 'qr', 'timestamp', 3,
    'qr', 'QRBASE64-SYNTHETIC', 'qrCode', 'QRBASE64-SYNTHETIC-2', 'QrLink', 'https://example.invalid/qr')),
  jsonb_build_object('kind', 'channel', 'element', jsonb_build_object('channelId', pg_temp.a325_id(9998)::TEXT, 'state', 'active')))) AS a325_p3 \gset
SELECT pg_temp.a325_assert((:'a325_p3'::JSONB #>> '{counts,stored}') = '3' AND (:'a325_p3'::JSONB #>> '{counts,deduplicated}') = '1'
  AND (:'a325_p3'::JSONB #>> '{counts,filtered}') = '1'
  AND (SELECT count(*) = 3 AND count(DISTINCT provider_event_variant_ref) = 3 AND bool_and(payload_id = pg_temp.a325_channel()::TEXT)
      FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND event_type = 'channel.state')
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events e WHERE e.provider = 'wazzup'
      AND (e.raw_payload::TEXT ILIKE '%QRBASE64%' OR e.raw_payload::TEXT ILIKE '%qrlink%' OR e.raw_payload ? 'qr' OR e.raw_payload ? 'qrCode'))
  AND (SELECT raw_payload ->> 'state' = 'qr' AND raw_payload ->> 'timestamp' = '3' FROM platform_private.provider_webhook_events
      WHERE provider = 'wazzup' AND event_type = 'channel.state' AND raw_payload ->> 'state' = 'qr'),
  'channel states: two states are two events, a repeat is a dedupe, another channel is only counted; the QR code is never stored, the other fields are: ' || :'a325_p3');
-- Another channel, other chat types and a message to another channel are only counted.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('f-1', '996000000102', 'Чужой канал', 20, FALSE, jsonb_build_object('channelId', pg_temp.a325_id(9997)::TEXT))),
  pg_temp.a325_el(pg_temp.a325_msg('f-2', '120363000000000001@g.us', 'Группа', 21, FALSE, '{"chatType": "whatsgroup"}')),
  pg_temp.a325_el(pg_temp.a325_msg('f-3', '996000000103', 'Telegram', 22, TRUE, '{"chatType": "telegram"}')),
  pg_temp.a325_el(pg_temp.a325_msg('f-4', '996000000104', 'Чужой канал, эхо', 23, TRUE, jsonb_build_object('channelId', pg_temp.a325_id(9997)::TEXT))))) AS a325_p4 \gset
SELECT pg_temp.a325_assert((:'a325_p4'::JSONB #>> '{counts,filtered}') = '4' AND (:'a325_p4'::JSONB #>> '{counts,stored}') = '0'
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND payload_id LIKE 'f-%')
  AND (SELECT jsonb_object_agg(counter, n) FROM platform_private.wazzup_daily_counters WHERE organization_id = pg_temp.a325_id(1))
    = jsonb_build_object('filtered_inbound_channel', 1, 'filtered_inbound_chat_type', 1, 'filtered_outbound', 2, 'filtered_channel_update', 1),
  'another channel and other chat types are only counted (no event, no number, no text): ' || :'a325_p4');
-- A broken element becomes an unparsed event, the rest of the batch is stored, a repeat is a dedupe.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('ok-1', '996000000105', 'Нормальное сообщение', 30)),
  pg_temp.a325_el(jsonb_build_object('chatId', '996000000106', 'text', 'без идентификатора')),
  jsonb_build_object('kind', 'message', 'element', to_jsonb('просто строка'::TEXT)),
  pg_temp.a325_el(pg_temp.a325_msg('ok-2', '996000000107', 'Ещё нормальное', 31)),
  pg_temp.a325_el(jsonb_build_object('messageId', 'no-echo-flag', 'channelId', pg_temp.a325_channel()::TEXT, 'chatType', 'whatsapp', 'chatId', '996000000108', 'text', 'без isEcho')))) AS a325_p5 \gset
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(jsonb_build_object('chatId', '996000000106', 'text', 'без идентификатора')))) AS a325_p5_again \gset
SELECT pg_temp.a325_assert((:'a325_p5'::JSONB #>> '{counts,stored}') = '2' AND (:'a325_p5'::JSONB #>> '{counts,unparsed}') = '3'
  AND (:'a325_p5_again'::JSONB #>> '{results,0,outcome}') = 'deduplicated'
  AND (SELECT count(*) = 3 AND bool_and(provider_account_ref = 'wazzup:' || pg_temp.a325_channel()::TEXT AND payload_id LIKE 'sha256:%'
        AND provider_event_variant_ref IS NULL AND provider_request_id LIKE 'unparsed:%')
      FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND event_type = 'unparsed')
  AND (SELECT count(*) = 3 AND bool_and(p.state = 'pending') FROM platform_private.wazzup_event_projections p
      JOIN platform_private.provider_webhook_events e ON e.id = p.event_id WHERE e.event_type = 'unparsed')
  AND (SELECT n = 3 FROM platform_private.wazzup_daily_counters WHERE counter = 'unparsed'),
  'a broken element is stored as unparsed (no chat, no text read), its siblings are stored, a repeat does not count twice: ' || :'a325_p5');
-- 150 elements arrive in two portions of 100 and 50.
SELECT pg_temp.a325_persist((SELECT jsonb_agg(pg_temp.a325_el(pg_temp.a325_msg('bulk-' || lpad(g::TEXT, 4, '0'), '9960000002' || lpad((g % 90)::TEXT, 2, '0'),
  'Массовое ' || g, 40 + g)) ORDER BY g) FROM generate_series(1, 100) g)) AS a325_bulk1 \gset
SELECT pg_temp.a325_persist((SELECT jsonb_agg(pg_temp.a325_el(pg_temp.a325_msg('bulk-' || lpad(g::TEXT, 4, '0'), '9960000002' || lpad((g % 90)::TEXT, 2, '0'),
  'Массовое ' || g, 40 + g)) ORDER BY g) FROM generate_series(101, 150) g)) AS a325_bulk2 \gset
SELECT pg_temp.a325_assert((:'a325_bulk1'::JSONB #>> '{counts,stored}') = '100' AND (:'a325_bulk2'::JSONB #>> '{counts,stored}') = '50'
  AND (SELECT count(*) = 150 FROM platform_private.provider_webhook_events WHERE provider = 'wazzup' AND payload_id LIKE 'bulk-%')
  AND (SELECT count(*) = 150 FROM platform_private.wazzup_event_projections p JOIN platform_private.provider_webhook_events e ON e.id = p.event_id
      WHERE e.payload_id LIKE 'bulk-%' AND p.state = 'pending'),
  'a batch of 150 elements goes in two portions: all 150 stored, each with a pending projection');
-- An element that fails on write does not stop the others (a trigger of this suite makes one payload id fail).
CREATE FUNCTION pg_temp.a325_boom() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payload_id = 'boom' THEN RAISE EXCEPTION 'synthetic write failure' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER a325_boom BEFORE INSERT ON platform_private.provider_webhook_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.a325_boom();
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('after-1', '996000000111', 'до', 200)),
  pg_temp.a325_el(pg_temp.a325_msg('boom', '996000000112', 'сбой записи', 201)),
  pg_temp.a325_el(pg_temp.a325_msg('after-2', '996000000113', 'после', 202)))) AS a325_pfail \gset
DROP TRIGGER a325_boom ON platform_private.provider_webhook_events;
SELECT pg_temp.a325_assert((:'a325_pfail'::JSONB #>> '{counts,stored}') = '2' AND (:'a325_pfail'::JSONB #>> '{counts,failed}') = '1'
  AND (:'a325_pfail'::JSONB #>> '{results,1,outcome}') = 'element_failed' AND (:'a325_pfail'::JSONB #>> '{results,1,code}') = 'P0001'
  AND (:'a325_pfail'::JSONB #>> '{results,1,sha256}') ~ '^[0-9a-f]{64}$' AND NOT ((:'a325_pfail'::JSONB -> 'results' -> 1) ? 'text')
  AND (:'a325_pfail'::JSONB #>> '{results,0,outcome}') = 'stored' AND (:'a325_pfail'::JSONB #>> '{results,2,outcome}') = 'stored'
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events WHERE payload_id = 'boom')
  AND (SELECT n = 1 FROM platform_private.wazzup_daily_counters WHERE counter = 'element_failed'),
  'a write failure of one element is reported with its SHA-256 and a code only; the others are stored; it is counted: ' || :'a325_pfail');
-- The route''s own counters and the time of an element.
SELECT pg_temp.a325_persist('[]'::JSONB, '{"status": 12, "ignored_subscription": 2}'::JSONB) AS a325_pcount \gset
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('t-bad', '996000000121', 'время не разобрано', 0, FALSE, '{"dateTime": "not a date"}')),
  pg_temp.a325_el(pg_temp.a325_msg('t-future', '996000000122', 'время в будущем', 0, FALSE, jsonb_build_object('dateTime', to_char(clock_timestamp() + INTERVAL '3 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))),
  pg_temp.a325_el(pg_temp.a325_msg('t-old', '996000000123', 'старое', 0, FALSE, '{"dateTime": "2014-01-01T00:00:00Z"}')))) AS a325_ptime \gset
SELECT pg_temp.a325_assert((SELECT n = 12 FROM platform_private.wazzup_daily_counters WHERE counter = 'status')
  AND (SELECT n = 2 FROM platform_private.wazzup_daily_counters WHERE counter = 'ignored_subscription')
  AND (SELECT bool_and(e.provider_occurred_at BETWEEN clock_timestamp() - INTERVAL '1 minute' AND clock_timestamp())
      FROM platform_private.provider_webhook_events e WHERE e.payload_id IN ('t-bad', 't-future', 't-old')),
  'the route counters are added; an unreadable, a future or an impossible element time falls back to the arrival time');
-- The daily reconciliation read agrees with the stored events.
SELECT (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE AS a325_today \gset
SELECT pg_temp.a325_svc(format('SELECT platform.wazzup_daily_counts_v1(%L, %L)', pg_temp.a325_id(1), :'a325_today')) AS a325_counts \gset
SELECT pg_temp.a325_assert((:'a325_counts'::JSONB ->> 'inboundStored')::BIGINT = (SELECT count(*) FROM platform_private.provider_webhook_events e
      WHERE e.organization_id = pg_temp.a325_id(1) AND e.provider = 'wazzup' AND e.event_type = 'message' AND e.raw_payload ->> 'isEcho' = 'false'
        AND (e.provider_occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE = :'a325_today'::DATE)
  AND (:'a325_counts'::JSONB -> 'counters' ->> 'filtered_inbound_channel') = '1' AND (:'a325_counts'::JSONB -> 'counters' ->> 'status') = '12'
  AND (:'a325_counts'::JSONB ->> 'inboundTotal')::BIGINT = (:'a325_counts'::JSONB ->> 'inboundStored')::BIGINT + 1 + 1,
  'the daily counts: stored inbound messages of the Bishkek day plus the filtered inbound ones, only numbers: ' || :'a325_counts');
-- Clear the queue: the projection sections below start from an empty queue.
UPDATE platform_private.wazzup_event_projections SET state = 'ignored', last_code = 'a325_fixture' WHERE state = 'pending';
SELECT pg_temp.a325_assert((pg_temp.a325_sweep() ->> 'processed') = '0', 'the queue is empty before the projection sections');

-- ---------------------------------------------------------------------------
-- 5. The projection. The agent tools read the result as production does.
-- ---------------------------------------------------------------------------
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a325_id(1));
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE organization_id = pg_temp.a325_id(1) AND key = 'sales';
CREATE FUNCTION pg_temp.a325_get(p_conv UUID, p_limit INTEGER DEFAULT 30) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_tool_get_conversation_v1(%L, ''sales'', %L::jsonb)', pg_temp.a325_id(1),
    jsonb_build_object('conversation_id', p_conv, 'limit', p_limit)))
$$;
CREATE FUNCTION pg_temp.a325_list(p_filter TEXT DEFAULT 'unanswered') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_tool_list_conversations_v1(%L, ''sales'', %L::jsonb)', pg_temp.a325_id(1),
    jsonb_build_object('filter', p_filter, 'limit', 50)))
$$;
CREATE FUNCTION pg_temp.a325_in_list(p_list JSONB, p_conv UUID) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT i.value FROM jsonb_array_elements(p_list -> 'items') i WHERE i.value ->> 'conversation_id' = p_conv::TEXT
$$;
CREATE FUNCTION pg_temp.a325_msgs(p_conv UUID) RETURNS TABLE (direction TEXT, source TEXT, body TEXT) LANGUAGE SQL STABLE AS $$
  SELECT m.direction::TEXT, m.message_identity_source, m.body_text FROM platform.communication_messages m
  WHERE m.conversation_id = p_conv ORDER BY m.created_at, m.id
$$;

-- A. A new number: a conversation and a client, no lead.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('a-1', '996000000201', 'Здравствуйте, интересует Малайзия', 100,
  FALSE, '{"contact": {"name": "Бекзат"}}'))) AS a325_sa \gset
SELECT pg_temp.a325_conv('996000000201') AS a325_ca \gset
SELECT pg_temp.a325_assert((:'a325_sa'::JSONB ->> 'processed') = '1' AND (:'a325_sa'::JSONB #>> '{outcomes,projected}') = '1'
  AND (:'a325_sa'::JSONB ->> 'newInbound') = '1' AND (:'a325_sa'::JSONB ->> 'oldestPendingSeconds') IS NULL
  AND pg_temp.a325_state('a-1') = 'projected' AND :'a325_ca' IS NOT NULL,
  'the sweep projects the first message of a new number: ' || :'a325_sa');
SELECT pg_temp.a325_assert(
  (SELECT c.queue = 'sales' AND c.status = 'open' AND c.sales_authority_source = 'platform_intake'
      AND c.responsible_sales_membership_id = pg_temp.a325_id(301) AND c.waha_session_name IS NULL AND c.wazzup_channel_id = pg_temp.a325_channel()
      AND c.subject = 'WhatsApp ••••0201' AND c.canonical_client_id IS NOT NULL AND c.canonical_lead_id IS NULL AND c.student_case_id IS NULL
      AND c.current_curator_membership_id IS NULL AND c.created_from_webhook_event_id = pg_temp.a325_event('a-1')
   FROM platform.communication_conversations c WHERE c.id = :'a325_ca'::UUID)
  AND (SELECT cl.display_name = 'Бекзат' AND cl.normalized_phone = '+996000000201' AND cl.lifecycle_state = 'active'
   FROM platform.clients cl JOIN platform.communication_conversations c ON c.canonical_client_id = cl.id WHERE c.id = :'a325_ca'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.leads l JOIN platform.communication_conversations c ON c.canonical_client_id = l.client_id WHERE c.id = :'a325_ca'::UUID)
  AND (SELECT identity_state = 'new_client' AND channel_id = pg_temp.a325_channel() AND source_webhook_event_id = pg_temp.a325_event('a-1')
      FROM platform_private.wazzup_chat_bindings WHERE conversation_id = :'a325_ca'::UUID)
  AND (SELECT count(*) = 1 FROM platform.external_identifiers x JOIN platform.communication_conversations c ON c.canonical_client_id = x.client_id
      WHERE c.id = :'a325_ca'::UUID AND x.source_system = 'wazzup' AND x.external_object_type = 'direct_chat'
        AND x.external_identifier = 'wazzup:' || pg_temp.a325_channel()::TEXT || ':996000000201')
  AND (SELECT count(*) = 1 FROM platform.subject_provenance sp JOIN platform.communication_conversations c ON c.canonical_client_id = sp.client_id
      WHERE c.id = :'a325_ca'::UUID AND sp.source_system = 'wazzup' AND sp.evidence_type = 'webhook_verified'
        AND sp.source_ref = 'wazzup-event:' || pg_temp.a325_event('a-1')::TEXT)
  AND (SELECT count(*) = 1 FROM platform.conversation_participants WHERE conversation_id = :'a325_ca'::UUID AND participant_kind = 'customer'
      AND external_subject_ref LIKE 'wazzup-participant:%' AND membership_id IS NULL)
  AND (SELECT count(*) = 1 FROM platform.conversation_participants WHERE conversation_id = :'a325_ca'::UUID AND participant_kind = 'sales'
      AND membership_id = pg_temp.a325_id(301))
  AND (SELECT count(*) = 1 FROM platform.record_scopes s JOIN platform.communication_conversations c ON c.current_scope_id = s.id
      JOIN platform.membership_scope_assignments a ON a.scope_id = s.id AND a.membership_id = pg_temp.a325_id(301) AND a.granted
      WHERE c.id = :'a325_ca'::UUID AND s.scope_kind = 'conversation' AND s.scope_key = c.id),
  'a new number: a sales conversation owned by the intake owner (platform_intake, no WAHA session, the Wazzup channel), a client from the profile name with the number, the Wazzup identity and trace, and NO lead; the owner gets the conversation scope');
SELECT pg_temp.a325_assert(
  (SELECT count(*) = 1 AND bool_and(direction = 'inbound' AND source = 'private_wazzup_binding'
      AND body = 'Здравствуйте, интересует Малайзия') FROM pg_temp.a325_msgs(:'a325_ca'::UUID))
  AND (SELECT m.created_at = (SELECT t0 + INTERVAL '100 seconds' FROM a325_clock) AND NOT m.student_visible AND m.language = 'undetermined'
      AND m.waha_session_name IS NULL AND m.waha_message_id IS NULL AND m.manual_send_authorization_id IS NULL AND m.student_case_id IS NULL
      AND m.source_webhook_event_id = pg_temp.a325_event('a-1')
   FROM platform.communication_messages m WHERE m.conversation_id = :'a325_ca'::UUID)
  AND (SELECT b.kind = 'inbound' AND b.wazzup_message_id = 'a-1' AND b.sender_deleted_at IS NULL AND b.channel_id = pg_temp.a325_channel()
   FROM platform_private.wazzup_message_bindings b JOIN platform.communication_messages m ON m.id = b.communication_message_id WHERE m.conversation_id = :'a325_ca'::UUID)
  AND (SELECT p.conversation_id = :'a325_ca'::UUID AND p.message_id IS NOT NULL AND p.last_code = 'conversation_created' AND p.attempts = 1
   FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('a-1')),
  'the message: inbound, private_wazzup_binding, the text, the message time, not visible to the student, no WAHA identity, bound to its event');
-- Projecting the same event again is a no-op.
SELECT pg_temp.a325_project(pg_temp.a325_event('a-1')) AS a325_re \gset
SELECT pg_temp.a325_assert((:'a325_re'::JSONB ->> 'outcome') = 'projected' AND (:'a325_re'::JSONB ->> 'deduplicated') = 'true'
  AND (:'a325_re'::JSONB ->> 'newInbound') = 'false'
  AND (SELECT count(*) = 1 FROM platform.communication_messages WHERE conversation_id = :'a325_ca'::UUID)
  AND (SELECT count(*) = 1 FROM platform.communication_conversations WHERE wazzup_channel_id IS NOT NULL),
  'projecting the same event again changes nothing: ' || :'a325_re');
-- The second message of the same person goes to the same conversation; nobody new is created.
SELECT count(*) AS a325_clients0 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('a-2', '996000000201', 'Мне 17 лет', 101))) AS a325_sa2 \gset
SELECT pg_temp.a325_assert((SELECT count(*) = 2 FROM platform.communication_messages WHERE conversation_id = :'a325_ca'::UUID)
  AND (SELECT count(*) = :a325_clients0 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = 1 FROM platform_private.wazzup_chat_bindings WHERE chat_digits = '996000000201')
  AND (:'a325_sa2'::JSONB ->> 'newInbound') = '1' AND pg_temp.a325_state('a-2') = 'projected',
  'the second message of the same number joins the same conversation: no new conversation, client or binding');
-- A seller reply: an echo with an author.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('a-3', '996000000201', 'Добрый день! Какой город вас интересует?', 102, TRUE,
  '{"authorId": "seller-1", "authorName": "Продавец Первый"}'))) AS a325_sa3 \gset
SELECT pg_temp.a325_assert((:'a325_sa3'::JSONB ->> 'newInbound') = '0'
  AND (SELECT count(*) = 1 FROM pg_temp.a325_msgs(:'a325_ca'::UUID) WHERE direction = 'outbound' AND source = 'private_wazzup_echo_binding'
      AND body = 'Добрый день! Какой город вас интересует?')
  AND (SELECT m.manual_send_authorization_id IS NULL AND m.sender_participant_id = (SELECT p.id FROM platform.conversation_participants p
        WHERE p.conversation_id = m.conversation_id AND p.participant_kind = 'sales')
        AND platform_private.ai_agent_message_origin(m) = 'phone'
      FROM platform.communication_messages m WHERE m.conversation_id = :'a325_ca'::UUID AND m.direction = 'outbound')
  AND (SELECT b.kind = 'staff_echo' FROM platform_private.wazzup_message_bindings b WHERE b.wazzup_message_id = 'a-3'),
  'a reply of a seller (an echo with an author) is an outbound message of the same conversation, sent by the sales participant, with no EVO authorization; the agent sees it as sent outside EVO');
SELECT pg_temp.a325_assert(
  pg_temp.a325_in_list(pg_temp.a325_list('unanswered'), :'a325_ca'::UUID) IS NULL
  AND (pg_temp.a325_in_list(pg_temp.a325_list('all'), :'a325_ca'::UUID) ->> 'last_direction') = 'outbound'
  AND (pg_temp.a325_in_list(pg_temp.a325_list('all'), :'a325_ca'::UUID) ->> 'staff_last_replied_at') IS NOT NULL,
  'with the seller reply the chat is answered: it leaves the unanswered list');
-- An automatic echo (the out-of-hours auto reply, a Salesbot) is not a reply: the chat stays unanswered.
SELECT pg_temp.a325_ingest(jsonb_build_array(
  pg_temp.a325_msg('a-4', '996000000201', 'Ответьте, пожалуйста, на вопрос о стоимости', 110),
  pg_temp.a325_msg('a-5', '996000000201', 'Мы сейчас не работаем, ответим утром', 111, TRUE, '{"sentFromApp": false}'),
  pg_temp.a325_msg('a-6', '996000000201', 'Автоматическое сообщение системы', 112, TRUE, '{"authorId": "", "sentFromApp": false}'))) AS a325_sa4 \gset
SELECT pg_temp.a325_assert((:'a325_sa4'::JSONB #>> '{outcomes,ignored_auto_echo}') = '2' AND (:'a325_sa4'::JSONB #>> '{outcomes,projected}') = '1'
  AND pg_temp.a325_state('a-5') = 'ignored_auto_echo' AND pg_temp.a325_state('a-6') = 'ignored_auto_echo'
  AND (SELECT count(*) = 4 FROM platform.communication_messages WHERE conversation_id = :'a325_ca'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_message_bindings WHERE wazzup_message_id IN ('a-5', 'a-6'))
  AND (SELECT n = 2 FROM platform_private.wazzup_daily_counters WHERE counter = 'auto_echo')
  AND (pg_temp.a325_in_list(pg_temp.a325_list('unanswered'), :'a325_ca'::UUID) ->> 'last_direction') = 'inbound'
  AND (pg_temp.a325_in_list(pg_temp.a325_list('unanswered'), :'a325_ca'::UUID) ->> 'unanswered_minutes') IS NOT NULL,
  'automatic echoes are not projected (raw event + counter only): the chat stays unanswered for the agent: ' || :'a325_sa4');
-- A reply from the seller''s app (no author id, sentFromApp) answers the chat again.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('a-7', '996000000201', 'Стоимость от 3000 долларов в год', 113, TRUE,
  '{"sentFromApp": true}'))) AS a325_sa5 \gset
SELECT pg_temp.a325_assert(pg_temp.a325_in_list(pg_temp.a325_list('unanswered'), :'a325_ca'::UUID) IS NULL
  AND (SELECT count(*) = 5 FROM platform.communication_messages WHERE conversation_id = :'a325_ca'::UUID),
  'a reply with sentFromApp = true is a seller reply too: the chat is answered');

-- B. A seller reply that came before the first message of the chat waits and is added in order.
SELECT pg_temp.a325_ingest(jsonb_build_array(
  pg_temp.a325_msg('b-1', '996000000202', 'Звоню вам, перезвоните', 120, TRUE, '{"authorId": "seller-2"}'),
  pg_temp.a325_msg('b-2', '996000000202', 'Я на связи до 20:00', 121, TRUE, '{"sentFromApp": true}'),
  pg_temp.a325_msg('b-3', '996000000202', 'Автоответ', 122, TRUE))) AS a325_sb1 \gset
SELECT pg_temp.a325_assert((:'a325_sb1'::JSONB #>> '{outcomes,deferred}') = '2' AND (:'a325_sb1'::JSONB #>> '{outcomes,ignored_auto_echo}') = '1'
  AND pg_temp.a325_state('b-1') = 'deferred' AND pg_temp.a325_state('b-2') = 'deferred'
  AND pg_temp.a325_conv('996000000202') IS NULL
  AND NOT EXISTS (SELECT 1 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1) AND normalized_phone = '+996000000202')
  AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_message_bindings WHERE wazzup_message_id LIKE 'b-%'),
  'a seller reply to a chat without a conversation creates no conversation and no client: it waits (deferred): ' || :'a325_sb1');
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('b-4', '996000000202', 'Да, перезвоните мне после обеда', 125,
  FALSE, '{"contact": {"name": "..."}}'))) AS a325_sb2 \gset
SELECT pg_temp.a325_conv('996000000202') AS a325_cb \gset
SELECT pg_temp.a325_assert((:'a325_sb2'::JSONB ->> 'newInbound') = '1'
  AND (SELECT array_agg(direction || ':' || body ORDER BY ord) = ARRAY['outbound:Звоню вам, перезвоните', 'outbound:Я на связи до 20:00',
      'inbound:Да, перезвоните мне после обеда'] FROM (SELECT row_number() OVER () AS ord, * FROM pg_temp.a325_msgs(:'a325_cb'::UUID)) x)
  AND pg_temp.a325_state('b-1') = 'projected' AND pg_temp.a325_state('b-2') = 'projected'
  AND (SELECT p.last_code = 'backfilled' AND p.conversation_id = :'a325_cb'::UUID FROM platform_private.wazzup_event_projections p
      WHERE p.event_id = pg_temp.a325_event('b-1'))
  AND (pg_temp.a325_sweep() ->> 'processed') = '0'
  AND (SELECT cl.display_name = 'WhatsApp ••••0202' FROM platform.clients cl JOIN platform.communication_conversations c ON c.canonical_client_id = cl.id
      WHERE c.id = :'a325_cb'::UUID)
  AND pg_temp.a325_in_list(pg_temp.a325_list('unanswered'), :'a325_cb'::UUID) IS NOT NULL,
  'at the first customer message the waiting replies are added in order of time; a punctuation-only profile name is no name (the placeholder stays); the chat is unanswered: '
  || :'a325_sb2');

-- B2. The operator's selection of the event ids for check A6 (docs/runbooks/wazzup-whatsapp.md, section 4): the events of the TEST
-- client's conversation, inbound only, inside the A2-A5 window - never "the latest events". The key is the id of the CONVERSATION,
-- the one id the operator can see (the Inbox address /v3/inbox?conversation=<id>); the card address (/v3/profile?id=<id>) carries a
-- LEAD id, which no conversation has, so it would find nothing. The text between the markers is the runbook's query word for word
-- (tests/platform-wazzup-packaging.test.mjs compares them); the psql variables are the ones the runbook sets with `-v`.
SELECT c.id AS test_conversation FROM platform.communication_conversations c WHERE c.id = :'a325_ca'::UUID \gset
SELECT (t0 + INTERVAL '100 seconds') AS window_from, (t0 + INTERVAL '126 seconds') AS window_to FROM a325_clock \gset
CREATE TEMP TABLE a325_a6 AS
-- A6_EVENT_IDS_BEGIN
select distinct b.source_webhook_event_id
  from platform.communication_conversations c
  join platform.communication_messages m on m.organization_id = c.organization_id and m.conversation_id = c.id
  join platform_private.wazzup_message_bindings b on b.organization_id = m.organization_id and b.communication_message_id = m.id
 where c.id = :'test_conversation'::uuid
   and c.wazzup_channel_id is not null
   and b.kind = 'inbound'
   and m.created_at >= :'window_from'::timestamptz and m.created_at < :'window_to'::timestamptz
 order by 1
-- A6_EVENT_IDS_END
;
SELECT pg_temp.a325_assert(
  (SELECT array_agg(source_webhook_event_id ORDER BY source_webhook_event_id) FROM a325_a6)
    = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.a325_event('a-1'), pg_temp.a325_event('a-2'), pg_temp.a325_event('a-4')]) x),
  'A6 ids: exactly the three inbound events of the test client''s conversation - not the seller replies (a-3, a-7: staff_echo), not the '
  || 'automatic echoes (never stored), and not the inbound event of the OTHER conversation (b-4) that lies inside the same window');
-- The window is [from, to): the lower bound is inclusive, the upper exclusive.
SELECT (t0 + INTERVAL '101 seconds') AS window_from, (t0 + INTERVAL '110 seconds') AS window_to FROM a325_clock \gset
DROP TABLE a325_a6;
CREATE TEMP TABLE a325_a6 AS
select distinct b.source_webhook_event_id
  from platform.communication_conversations c
  join platform.communication_messages m on m.organization_id = c.organization_id and m.conversation_id = c.id
  join platform_private.wazzup_message_bindings b on b.organization_id = m.organization_id and b.communication_message_id = m.id
 where c.id = :'test_conversation'::uuid
   and c.wazzup_channel_id is not null
   and b.kind = 'inbound'
   and m.created_at >= :'window_from'::timestamptz and m.created_at < :'window_to'::timestamptz
 order by 1
;
SELECT pg_temp.a325_assert(
  (SELECT array_agg(source_webhook_event_id) FROM a325_a6) = ARRAY[pg_temp.a325_event('a-2')],
  'A6 ids: the window [101 s, 110 s) holds only a-2 (a-1 at 100 s is before it, a-4 at 110 s is not inside the upper bound)');
-- The other conversation has its own single inbound event; an unknown client and a client without a Wazzup conversation give nothing.
SELECT c.id AS test_conversation FROM platform.communication_conversations c WHERE c.id = :'a325_cb'::UUID \gset
SELECT (t0 + INTERVAL '100 seconds') AS window_from, (t0 + INTERVAL '126 seconds') AS window_to FROM a325_clock \gset
DROP TABLE a325_a6;
CREATE TEMP TABLE a325_a6 AS
select distinct b.source_webhook_event_id
  from platform.communication_conversations c
  join platform.communication_messages m on m.organization_id = c.organization_id and m.conversation_id = c.id
  join platform_private.wazzup_message_bindings b on b.organization_id = m.organization_id and b.communication_message_id = m.id
 where c.id = :'test_conversation'::uuid
   and c.wazzup_channel_id is not null
   and b.kind = 'inbound'
   and m.created_at >= :'window_from'::timestamptz and m.created_at < :'window_to'::timestamptz
 order by 1
;
SELECT pg_temp.a325_assert((SELECT array_agg(source_webhook_event_id) FROM a325_a6) = ARRAY[pg_temp.a325_event('b-4')],
  'A6 ids: the other conversation gives only its own inbound event (b-4), its waiting seller replies are staff_echo');
SELECT pg_temp.a325_id(9999) AS test_conversation \gset
DROP TABLE a325_a6;
CREATE TEMP TABLE a325_a6 AS
select distinct b.source_webhook_event_id
  from platform.communication_conversations c
  join platform.communication_messages m on m.organization_id = c.organization_id and m.conversation_id = c.id
  join platform_private.wazzup_message_bindings b on b.organization_id = m.organization_id and b.communication_message_id = m.id
 where c.id = :'test_conversation'::uuid
   and c.wazzup_channel_id is not null
   and b.kind = 'inbound'
   and m.created_at >= :'window_from'::timestamptz and m.created_at < :'window_to'::timestamptz
 order by 1
;
SELECT pg_temp.a325_assert((SELECT count(*) = 0 FROM a325_a6), 'A6 ids: an unknown conversation gives no event');
-- An id that is not a conversation id gives nothing, however real it is: the client id of the test conversation, as the lead id of the
-- card address (/v3/profile?id=<lead>) would. The operator who takes the number from the card sees the count 0 and does not continue.
SELECT c.canonical_client_id AS test_conversation FROM platform.communication_conversations c WHERE c.id = :'a325_ca'::UUID \gset
SELECT (t0 + INTERVAL '100 seconds') AS window_from, (t0 + INTERVAL '126 seconds') AS window_to FROM a325_clock \gset
DROP TABLE a325_a6;
CREATE TEMP TABLE a325_a6 AS
select distinct b.source_webhook_event_id
  from platform.communication_conversations c
  join platform.communication_messages m on m.organization_id = c.organization_id and m.conversation_id = c.id
  join platform_private.wazzup_message_bindings b on b.organization_id = m.organization_id and b.communication_message_id = m.id
 where c.id = :'test_conversation'::uuid
   and c.wazzup_channel_id is not null
   and b.kind = 'inbound'
   and m.created_at >= :'window_from'::timestamptz and m.created_at < :'window_to'::timestamptz
 order by 1
;
SELECT pg_temp.a325_assert(:'test_conversation'::UUID <> :'a325_ca'::UUID AND (SELECT count(*) = 0 FROM a325_a6),
  'A6 ids: the client id of the test conversation (an id that is not a conversation id, like the lead id of the card address) gives no event');
DROP TABLE a325_a6;

-- C. Media marks are the 259 marks: the agent sees photo / voice / file; no file is downloaded.
SELECT pg_temp.a325_ingest(jsonb_build_array(
  pg_temp.a325_msg('c-1', '996000000203', NULL, 130, FALSE, '{"type": "image", "contentUri": "https://example.invalid/f/1.jpg"}'),
  pg_temp.a325_msg('c-2', '996000000203', NULL, 131, FALSE, '{"type": "audio", "contentUri": "https://example.invalid/f/2.ogg"}'),
  pg_temp.a325_msg('c-3', '996000000203', 'Выписка из банка', 132, FALSE, '{"type": "document", "contentUri": "https://example.invalid/f/3.pdf"}'),
  pg_temp.a325_msg('c-4', '996000000203', NULL, 133, FALSE, '{"type": "video", "contentUri": "https://example.invalid/f/4.mp4"}'),
  pg_temp.a325_msg('c-5', '996000000203', 'BEGIN:VCARD secret-contact-details', 134, FALSE, '{"type": "vcard"}'),
  pg_temp.a325_msg('c-6', '996000000203', '42.87,74.59', 135, FALSE, '{"type": "geo"}'),
  pg_temp.a325_msg('c-7', '996000000203', NULL, 136, FALSE, '{"type": "unsupported"}'),
  pg_temp.a325_msg('c-8', '996000000203', NULL, 137, FALSE, '{"type": "missing_call"}'),
  pg_temp.a325_msg('c-9', '996000000203', NULL, 138, FALSE, '{"type": "text"}'),
  pg_temp.a325_msg('c-10', '996000000203', 'Картинка с подписью', 139, FALSE, '{"type": "image", "contentUri": "https://example.invalid/f/10.jpg"}'))) AS a325_sc \gset
SELECT pg_temp.a325_conv('996000000203') AS a325_cc \gset
SELECT pg_temp.a325_get(:'a325_cc'::UUID) AS a325_gc \gset
SELECT pg_temp.a325_assert((SELECT array_agg(body ORDER BY ord) = ARRAY[
      '📎 Фото — откройте в WhatsApp продаж', '📎 Голосовое сообщение — откройте в WhatsApp продаж',
      E'📎 Файл — откройте в WhatsApp продаж\nВыписка из банка', '📎 Видео — откройте в WhatsApp продаж',
      '📎 Файл: контакт — откройте в WhatsApp продаж', '📎 Файл: геопозиция — откройте в WhatsApp продаж',
      '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.',
      'Пропущенный звонок WhatsApp',
      '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.',
      E'📎 Фото — откройте в WhatsApp продаж\nКартинка с подписью']
      FROM (SELECT row_number() OVER () AS ord, * FROM pg_temp.a325_msgs(:'a325_cc'::UUID)) x)
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages WHERE conversation_id = :'a325_cc'::UUID AND (body_text LIKE '%secret-contact%' OR body_text LIKE '%42.87%' OR body_text LIKE '%example.invalid%')),
  'media marks: exactly the 259 format (photo, voice, file, video, contact, geo), a caption on the next line, the unsupported notice, a missed call; a contact''s details, coordinates and file links are not copied: ' || :'a325_sc');
SELECT pg_temp.a325_assert((SELECT array_agg(m.value ->> 'media_kind' ORDER BY ord) = ARRAY['photo', 'voice', 'file', 'video', 'file', 'file', 'unknown', NULL, 'unknown', 'photo']
      FROM jsonb_array_elements(:'a325_gc'::JSONB -> 'messages') WITH ORDINALITY m(value, ord))
  AND (SELECT (array_agg(m.value ->> 'text' ORDER BY ord))[3] = 'Выписка из банка' AND (array_agg(m.value ->> 'text' ORDER BY ord))[10] = 'Картинка с подписью'
      FROM jsonb_array_elements(:'a325_gc'::JSONB -> 'messages') WITH ORDINALITY m(value, ord))
  AND (SELECT count(*) = 7 FROM platform.conversation_handoff_events h WHERE h.conversation_id = :'a325_cc'::UUID
      AND h.reason = 'Inbound Wazzup content without text requires staff review')
  AND (SELECT count(*) = 1 FROM platform.conversation_handoff_events h WHERE h.conversation_id = :'a325_cc'::UUID AND h.previous_queue IS NULL
      AND h.source_webhook_event_id = pg_temp.a325_event('c-1'))
  AND (SELECT bool_and(h.new_queue = 'sales' AND h.new_owner_membership_id = pg_temp.a325_id(301)) FROM platform.conversation_handoff_events h
      WHERE h.conversation_id = :'a325_cc'::UUID),
  'the agent reads the marks as media kinds (photo, voice, file, video, unknown); a media message without a caption (and the unsupported or empty ones) hands the chat to the owner for review (seven of them here), the first one as a new conversation: '
  || (:'a325_gc'::JSONB -> 'messages')::TEXT);
-- The night autoresponder decides "only media" by the same view (276: an empty text is media_only): the marks keep that working.
SELECT pg_temp.a325_assert((SELECT array_agg(COALESCE(btrim(platform_private.ai_message_view(m) ->> 'text'), '') = '' ORDER BY m.created_at, m.id)
      = ARRAY[TRUE, TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, FALSE]
    FROM platform.communication_messages m WHERE m.conversation_id = :'a325_cc'::UUID),
  'the AI view reads a mark without a caption as an empty text (media_only for the autoresponder) and a captioned one, a text or a missed call as text');
-- An echo with media is a reply; a system echo is nothing.
SELECT pg_temp.a325_ingest(jsonb_build_array(
  pg_temp.a325_msg('c-11', '996000000203', NULL, 140, TRUE, '{"type": "image", "contentUri": "https://example.invalid/f/11.jpg", "authorId": "seller-1"}'),
  pg_temp.a325_msg('c-12', '996000000203', NULL, 141, TRUE, '{"type": "system", "authorId": "seller-1"}'))) AS a325_sc2 \gset
SELECT pg_temp.a325_assert(pg_temp.a325_state('c-11') = 'projected' AND pg_temp.a325_state('c-12') = 'ignored'
  AND (SELECT count(*) = 1 FROM pg_temp.a325_msgs(:'a325_cc'::UUID) WHERE direction = 'outbound' AND body = '📎 Фото — откройте в WhatsApp продаж')
  AND (SELECT count(*) = 7 FROM platform.conversation_handoff_events h WHERE h.conversation_id = :'a325_cc'::UUID),
  'a seller''s photo is an outbound mark (no review); a system echo is ignored');

-- D. Edits are not projected; a deletion hides the text from the agent, also when it came before the message.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('a-4', '996000000201', 'Ответьте, пожалуйста (исправлено)', 150, FALSE, '{"isEdited": true}')))) AS a325_pe \gset
SELECT pg_temp.a325_sweep() AS a325_se \gset
SELECT pg_temp.a325_assert((:'a325_se'::JSONB #>> '{outcomes,ignored}') = '1'
  AND (SELECT p.last_code = 'edit_not_projected' FROM platform_private.wazzup_event_projections p
      WHERE p.event_id = pg_temp.a325_event('a-4', 'message.edited'))
  AND (SELECT count(*) = 1 FROM pg_temp.a325_msgs(:'a325_ca'::UUID) WHERE body = 'Ответьте, пожалуйста, на вопрос о стоимости'),
  'an edit is kept as a raw event and is not projected: the stored text stays');
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('a-1', '996000000201', 'Здравствуйте, интересует Малайзия', 151, FALSE, '{"isDeleted": true}')))) AS a325_pd \gset
SELECT pg_temp.a325_sweep() AS a325_sd \gset
SELECT pg_temp.a325_get(:'a325_ca'::UUID) AS a325_gd \gset
SELECT pg_temp.a325_assert((:'a325_sd'::JSONB #>> '{outcomes,projected}') = '1'
  AND (SELECT p.last_code = 'deleted_marked' FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('a-1', 'message.deleted'))
  AND (SELECT b.sender_deleted_at = (SELECT t0 + INTERVAL '151 seconds' FROM a325_clock) FROM platform_private.wazzup_message_bindings b WHERE b.wazzup_message_id = 'a-1')
  AND (SELECT (m.value -> 'text') = 'null'::JSONB AND (m.value ->> 'deleted') = 'true' FROM jsonb_array_elements(:'a325_gd'::JSONB -> 'messages') m
      WHERE m.value ->> 'origin' = 'client' ORDER BY m.value ->> 'at' LIMIT 1)
  AND (SELECT count(*) = 4 FROM jsonb_array_elements(:'a325_gd'::JSONB -> 'messages') m WHERE NOT (m.value ? 'deleted') AND m.value ->> 'text' <> '')
  AND NOT (:'a325_gd'::TEXT LIKE '%интересует Малайзия%'),
  'a deletion by the customer: the message stays in the staff feed, the agent gets text null and deleted = true (and no other message changes): ' || :'a325_gd');
-- The deletion that came before the message is applied when the message is projected.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('d-1', '996000000204', 'Секретный текст удалённого сообщения', 160, FALSE, '{"isDeleted": true}')))) AS a325_pd2 \gset
SELECT pg_temp.a325_sweep() AS a325_sd2 \gset
-- The deletion takes the chat lock of the message projection (transaction level, so it is still held here): another
-- transaction that is projecting this chat's message cannot be missed by it. Nothing else touched this chat before.
CREATE FUNCTION pg_temp.a325_chat_locked(p_digits TEXT) RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_locks l CROSS JOIN LATERAL (SELECT hashtextextended('evo:wazzup:chat:' || pg_temp.a325_id(1)::TEXT || ':'
      || pg_temp.a325_channel()::TEXT || ':' || p_digits, 0) AS k) key
    WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND l.classid::BIGINT = ((key.k >> 32) & 4294967295) AND l.objid::BIGINT = (key.k & 4294967295))
$$;
SELECT pg_temp.a325_assert(pg_temp.a325_chat_locked('996000000204') AND NOT pg_temp.a325_chat_locked('996000000298'),
  'a deletion that no message waits for yet still takes the chat lock of its chat (and the lock of a chat nobody touched is not held)');
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('d-1', '996000000204', 'Секретный текст удалённого сообщения', 160),
  pg_temp.a325_msg('d-2', '996000000204', 'Второе сообщение остаётся видимым', 161))) AS a325_sd3 \gset
SELECT pg_temp.a325_conv('996000000204') AS a325_cd \gset
SELECT pg_temp.a325_get(:'a325_cd'::UUID) AS a325_gd2 \gset
SELECT pg_temp.a325_assert((:'a325_sd2'::JSONB #>> '{outcomes,projected}') = '1'
  AND (SELECT p.last_code = 'deleted_noted' FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('d-1', 'message.deleted'))
  AND (SELECT b.sender_deleted_at IS NOT NULL FROM platform_private.wazzup_message_bindings b WHERE b.wazzup_message_id = 'd-1')
  AND NOT (:'a325_gd2'::TEXT LIKE '%Секретный текст%') AND (:'a325_gd2'::TEXT LIKE '%Второе сообщение остаётся видимым%')
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'a325_gd2'::JSONB -> 'messages') m WHERE (m.value ->> 'deleted') = 'true'),
  'a deletion that arrived before the message hides it from the agent as soon as the message is projected');
-- The inline projection of a deletion (the webhook path, which waits for the lock) takes the same lock.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('dl-2', '996000000602', 'Удалено до проекции, путь приёма', 162, FALSE, '{"isDeleted": true}')))) AS a325_pdl2 \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('dl-2', 'message.deleted')) AS a325_sdl2 \gset
SELECT pg_temp.a325_assert((:'a325_sdl2'::JSONB ->> 'code') = 'deleted_noted' AND pg_temp.a325_chat_locked('996000000602'),
  'the inline projection of a deletion also takes the chat lock: ' || :'a325_sdl2');

-- The client deletes the message he has just sent, so it is the latest one: the list gives the agent no preview of it either.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('lp-1', '996000000601', 'ПРЕВЬЮ-СЕКРЕТ клиент удалил только что отправленное', 165))) AS a325_slp \gset
SELECT pg_temp.a325_conv('996000000601') AS a325_clp \gset
SELECT pg_temp.a325_assert(pg_temp.a325_chat_locked('996000000601'), 'the projection of a message takes the chat lock of its chat (the lock the deletion shares)');
SELECT pg_temp.a325_list('all') AS a325_lp0 \gset
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('lp-1', '996000000601', 'ПРЕВЬЮ-СЕКРЕТ клиент удалил только что отправленное', 166, FALSE, '{"isDeleted": true}')))) AS a325_plp \gset
SELECT pg_temp.a325_sweep() AS a325_slp2 \gset
SELECT pg_temp.a325_list('all') AS a325_lp1, pg_temp.a325_list() AS a325_lp2, pg_temp.a325_get(:'a325_clp'::UUID) AS a325_lp3 \gset
SELECT pg_temp.a325_assert((pg_temp.a325_in_list(:'a325_lp0'::JSONB, :'a325_clp'::UUID) ->> 'last_text_preview') LIKE 'ПРЕВЬЮ-СЕКРЕТ%'
  AND NOT (pg_temp.a325_in_list(:'a325_lp0'::JSONB, :'a325_clp'::UUID) ? 'last_deleted')
  AND (pg_temp.a325_in_list(:'a325_lp1'::JSONB, :'a325_clp'::UUID) -> 'last_text_preview') = 'null'::JSONB
  AND (pg_temp.a325_in_list(:'a325_lp1'::JSONB, :'a325_clp'::UUID) ->> 'last_deleted') = 'true'
  AND (pg_temp.a325_in_list(:'a325_lp2'::JSONB, :'a325_clp'::UUID) -> 'last_text_preview') = 'null'::JSONB
  AND (pg_temp.a325_in_list(:'a325_lp2'::JSONB, :'a325_clp'::UUID) ->> 'last_deleted') = 'true'
  AND (pg_temp.a325_in_list(:'a325_lp2'::JSONB, :'a325_clp'::UUID) ->> 'last_direction') = 'inbound'
  AND NOT (:'a325_lp1'::TEXT LIKE '%ПРЕВЬЮ-СЕКРЕТ%') AND NOT (:'a325_lp2'::TEXT LIKE '%ПРЕВЬЮ-СЕКРЕТ%')
  AND (SELECT (m.value -> 'text') = 'null'::JSONB AND (m.value ->> 'deleted') = 'true' FROM jsonb_array_elements(:'a325_lp3'::JSONB -> 'messages') m LIMIT 1),
  'the client deleted the message he had just sent (the latest one): before the deletion the list shows its preview, after it - in the "all" and the default "unanswered" lists alike - no preview and last_deleted = true; the read says text null and deleted');
-- A newer message brings the preview back (the deleted one is no longer the latest); an older deleted message never hides it.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('lp-2', '996000000601', 'Новое сообщение после удаления', 167))) AS a325_slp3 \gset
SELECT pg_temp.a325_list('all') AS a325_lp4 \gset
SELECT pg_temp.a325_assert((pg_temp.a325_in_list(:'a325_lp4'::JSONB, :'a325_clp'::UUID) ->> 'last_text_preview') = 'Новое сообщение после удаления'
  AND NOT (pg_temp.a325_in_list(:'a325_lp4'::JSONB, :'a325_clp'::UUID) ? 'last_deleted')
  AND (pg_temp.a325_in_list(:'a325_lp4'::JSONB, :'a325_ca'::UUID) ->> 'last_text_preview') IS NOT NULL
  AND NOT (pg_temp.a325_in_list(:'a325_lp4'::JSONB, :'a325_ca'::UUID) ? 'last_deleted'),
  'a newer message brings the preview back; a deleted message that is not the latest (a-1 of the first chat) does not hide the preview of the latest');

-- E. Invalid chat ids and conversations that left sales go to review.
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('e-1', 'abc-not-a-number', 'Чат не номером', 170),
  pg_temp.a325_msg('e-2', '12345', 'Короткий номер', 171))) AS a325_se1 \gset
SELECT pg_temp.a325_assert((:'a325_se1'::JSONB #>> '{outcomes,needs_review}') = '2'
  AND (SELECT bool_and(p.last_code = 'chat_id_invalid') FROM platform_private.wazzup_event_projections p
      WHERE p.event_id IN (pg_temp.a325_event('e-1'), pg_temp.a325_event('e-2')))
  AND NOT EXISTS (SELECT 1 FROM platform_private.wazzup_chat_bindings WHERE chat_digits IN ('12345')),
  'a chat id that is not a phone number is kept for review: no conversation, no client: ' || :'a325_se1');

-- F. The sweep and its failures; the transport gate of the projection; a conversation that left sales.
-- An ineligible intake owner fails the event with a code, nothing is half-written, and the retry by an eligible owner works.
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('f-own', '996000000301', 'Первое сообщение владельцу', 300)))) AS a325_pf0 \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('f-own'), 302) AS a325_pf1 \gset
SELECT pg_temp.a325_assert((:'a325_pf1'::JSONB ->> 'outcome') = 'failed' AND (:'a325_pf1'::JSONB ->> 'code') = 'wazzup_intake_owner_ineligible'
  AND (SELECT p.state = 'failed' AND p.attempts = 1 AND p.last_code = 'wazzup_intake_owner_ineligible' AND p.conversation_id IS NULL
      FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('f-own'))
  AND pg_temp.a325_conv('996000000301') IS NULL AND NOT EXISTS (SELECT 1 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1) AND normalized_phone = '+996000000301'),
  'an ineligible owner fails the event with a fixed code; no conversation, client or binding is left behind: ' || :'a325_pf1');
SELECT pg_temp.a325_sweep() AS a325_pf2 \gset
SELECT pg_temp.a325_assert((:'a325_pf2'::JSONB #>> '{outcomes,projected}') = '1' AND pg_temp.a325_state('f-own') = 'projected'
  AND (SELECT p.attempts = 2 FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('f-own'))
  AND pg_temp.a325_conv('996000000301') IS NOT NULL,
  'the sweep retries a failed event and projects it with an eligible owner (the second attempt)');
-- The sweep itself survives failing events: with an ineligible owner every event fails (a code, an attempt) and the loop goes on.
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('sf-1', '996000000310', 'Первый для проверки сбоя', 302)),
  pg_temp.a325_el(pg_temp.a325_msg('sf-2', '996000000311', 'Второй для проверки сбоя', 303)))) AS a325_psf \gset
SELECT pg_temp.a325_sweep(302) AS a325_ssf1 \gset
SELECT pg_temp.a325_sweep(301) AS a325_ssf2 \gset
SELECT pg_temp.a325_assert((:'a325_ssf1'::JSONB ->> 'processed') = '2' AND (:'a325_ssf1'::JSONB #>> '{outcomes,failed}') = '2'
  AND (:'a325_ssf1'::JSONB ->> 'oldestPendingSeconds') IS NOT NULL
  AND (:'a325_ssf2'::JSONB #>> '{outcomes,projected}') = '2' AND pg_temp.a325_state('sf-1') = 'projected' AND pg_temp.a325_state('sf-2') = 'projected'
  AND (SELECT bool_and(p.attempts = 2) FROM platform_private.wazzup_event_projections p
      WHERE p.event_id IN (pg_temp.a325_event('sf-1'), pg_temp.a325_event('sf-2'))),
  'a sweep with an ineligible owner fails both events and finishes; the next sweep with an eligible owner projects both: ' || :'a325_ssf1');
-- Eight attempts are the limit: an exhausted failure is not picked again and is reported.
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('f-cap', '996000000302', 'Попытки', 301)))) AS a325_pf3 \gset
UPDATE platform_private.wazzup_event_projections SET state = 'failed', attempts = 8, last_code = 'wazzup_intake_owner_ineligible'
  WHERE event_id = pg_temp.a325_event('f-cap');
SELECT pg_temp.a325_sweep() AS a325_pf4 \gset
UPDATE platform_private.wazzup_event_projections SET attempts = 7 WHERE event_id = pg_temp.a325_event('f-cap');
SELECT pg_temp.a325_sweep() AS a325_pf5 \gset
SELECT pg_temp.a325_assert((:'a325_pf4'::JSONB ->> 'processed') = '0' AND (:'a325_pf4'::JSONB ->> 'failedExhausted') = '1'
  AND (:'a325_pf5'::JSONB ->> 'processed') = '1' AND pg_temp.a325_state('f-cap') = 'projected' AND (:'a325_pf5'::JSONB ->> 'failedExhausted') = '0',
  'a failure with 8 attempts is not retried (and is counted); with 7 it is');
-- Time order: the oldest message first, whatever the order of arrival; the limit is respected.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('o-3', '996000000303', 'Третье по времени', 410)),
  pg_temp.a325_el(pg_temp.a325_msg('o-1', '996000000304', 'Первое по времени', 405)),
  pg_temp.a325_el(pg_temp.a325_msg('o-2', '996000000305', 'Второе по времени', 407)))) AS a325_po \gset
SELECT pg_temp.a325_sweep(301, 1) AS a325_so1 \gset
SELECT pg_temp.a325_state('o-1') AS a325_o1_a, pg_temp.a325_state('o-2') AS a325_o2_a, pg_temp.a325_state('o-3') AS a325_o3_a \gset
SELECT pg_temp.a325_sweep(301, 1) AS a325_so2 \gset
SELECT pg_temp.a325_state('o-2') AS a325_o2_b, pg_temp.a325_state('o-3') AS a325_o3_b \gset
SELECT pg_temp.a325_assert(:'a325_o1_a' = 'projected' AND :'a325_o2_a' = 'pending' AND :'a325_o3_a' = 'pending'
  AND :'a325_o2_b' = 'projected' AND :'a325_o3_b' = 'pending' AND (:'a325_so1'::JSONB ->> 'processed') = '1',
  'the sweep goes by the time of the message, not by arrival, and respects its limit');
SELECT pg_temp.a325_sweep() AS a325_so3 \gset
-- The age of the oldest unprocessed event is reported.
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('age-1', '996000000306', 'Свежее', 420)),
  pg_temp.a325_el(pg_temp.a325_msg('age-2', '996000000307', 'Старое необработанное', 421)))) AS a325_pa \gset
UPDATE platform_private.wazzup_event_projections SET created_at = clock_timestamp() - INTERVAL '20 minutes'
  WHERE event_id = pg_temp.a325_event('age-2');
SELECT pg_temp.a325_sweep(301, 1) AS a325_sa1 \gset
SELECT pg_temp.a325_sweep() AS a325_sa2 \gset
SELECT pg_temp.a325_assert((:'a325_sa1'::JSONB ->> 'oldestPendingSeconds')::INTEGER BETWEEN 1195 AND 1300 AND (:'a325_sa2'::JSONB ->> 'oldestPendingSeconds') IS NULL
  AND pg_temp.a325_state('age-1') = 'projected' AND pg_temp.a325_state('age-2') = 'projected',
  'the sweep reports the age of the oldest unprocessed event (about twenty minutes here), then nothing');
-- The projection too refuses to work unless the transport is wazzup (a late sweep must not create conversations).
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('ti-1', '996000000308', 'Пока путь выключен', 430)))) AS a325_pt0 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''none'', NULL, NULL, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7131))) AS a325_pt1 \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('ti-1')) AS a325_pt2 \gset
SELECT pg_temp.a325_sweep() AS a325_pt3 \gset
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('ti-2', '996000000309', 'И это не запишется', 431)))) AS a325_pt4 \gset
SELECT pg_temp.a325_assert((:'a325_pt1'::JSONB ->> 'transport') = 'none' AND (:'a325_pt2'::JSONB ->> 'outcome') = 'transport_inactive'
  AND (:'a325_pt3'::JSONB ->> 'transportActive') = 'false' AND (:'a325_pt4'::JSONB ->> 'transportActive') = 'false'
  AND pg_temp.a325_state('ti-1') = 'pending' AND pg_temp.a325_conv('996000000308') IS NULL AND pg_temp.a325_event('ti-2') IS NULL,
  'transport none: the projection and the sweep do nothing, the persist stores nothing; the pending event waits');
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, ''wazzup'', NULL, NULL, %L)', pg_temp.a325_id(1), pg_temp.a325_id(7132))) AS a325_pt5 \gset
SELECT pg_temp.a325_sweep() AS a325_pt6 \gset
SELECT pg_temp.a325_assert((:'a325_pt5'::JSONB ->> 'transport') = 'wazzup' AND (:'a325_pt5'::JSONB ->> 'version')::INTEGER = 5
  AND (:'a325_pt5'::JSONB ->> 'aiTriggerEnabled') = 'false' AND (:'a325_pt6'::JSONB #>> '{outcomes,projected}') = '1' AND pg_temp.a325_conv('996000000308') IS NOT NULL,
  'back on wazzup the waiting event is projected');
-- A conversation handed to a curator: the next message does not open a new sales conversation.
SET LOCAL session_replication_role = replica;
UPDATE platform.communication_conversations SET queue = 'curator', student_case_id = pg_temp.a325_id(9801), current_curator_membership_id = pg_temp.a325_id(302),
  sales_authority_source = 'provider_linked', amocrm_account_id = 1, amocrm_lead_id = 98001, amocrm_contact_id = 98002
  WHERE id = :'a325_cc'::UUID;
SET LOCAL session_replication_role = origin;
SELECT count(*) AS a325_cc_msgs FROM platform.communication_messages WHERE conversation_id = :'a325_cc'::UUID \gset
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('cur-1', '996000000203', 'Написал после передачи куратору', 440))) AS a325_scur \gset
SELECT pg_temp.a325_assert((:'a325_scur'::JSONB #>> '{outcomes,needs_review}') = '1' AND (:'a325_scur'::JSONB ->> 'newInbound') = '0'
  AND (SELECT p.last_code = 'conversation_not_sales' AND p.conversation_id = :'a325_cc'::UUID FROM platform_private.wazzup_event_projections p
      WHERE p.event_id = pg_temp.a325_event('cur-1'))
  AND (SELECT count(*) = :a325_cc_msgs FROM platform.communication_messages WHERE conversation_id = :'a325_cc'::UUID)
  AND (SELECT count(*) = 1 FROM platform_private.wazzup_chat_bindings WHERE chat_digits = '996000000203'),
  'after the conversation went to a curator the new message goes to review: nothing is stored, no new conversation (stage 1)');

-- F2. The sweep never waits and never overwrites a final outcome; a failure that cannot even be recorded does not abort the pass.
-- (The waiting itself - a chat or an event held by ANOTHER transaction - needs a second session; it is proven by the two-session run
-- of the migration's review, the suite proves the single-session half: the shapes, the conditional record, the deferred count.)
-- The failure record: a pending event becomes failed (one attempt, then two); a final outcome is left exactly as it is.
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('fr-1', '996000000603', 'Для проверки записи сбоя', 450)))) AS a325_pfr \gset
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('fr-1'), 'wazzup_probe') AS a325_fr1 \gset
SELECT p.state AS a325_fr1_state, p.attempts AS a325_fr1_n, p.last_code AS a325_fr1_code FROM platform_private.wazzup_event_projections p
  WHERE p.event_id = pg_temp.a325_event('fr-1') \gset
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('fr-1'), 'wazzup_probe_two') AS a325_fr2 \gset
SELECT pg_temp.a325_state('a-2') AS a325_fr_a2_before, (SELECT p.attempts FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('a-2')) AS a325_fr_a2_n,
  (SELECT p.last_code FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('a-2')) AS a325_fr_a2_code \gset
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('a-2'), 'wazzup_probe') AS a325_fr3 \gset
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('c-12'), 'wazzup_probe') AS a325_fr4 \gset
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('a-5'), 'wazzup_probe') AS a325_fr5 \gset
SELECT pg_temp.a325_assert(:'a325_fr1_state' = 'failed' AND :'a325_fr1_n' = '1' AND :'a325_fr1_code' = 'wazzup_probe'
  AND (SELECT p.state = 'failed' AND p.attempts = 2 AND p.last_code = 'wazzup_probe_two' FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('fr-1'))
  AND pg_temp.a325_state('a-2') = :'a325_fr_a2_before' AND pg_temp.a325_state('a-2') = 'projected'
  AND (SELECT p.attempts = :a325_fr_a2_n AND p.last_code IS NOT DISTINCT FROM :'a325_fr_a2_code' FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('a-2'))
  AND pg_temp.a325_state('c-12') = 'ignored' AND pg_temp.a325_state('a-5') = 'ignored_auto_echo',
  'the failure record turns a pending event into failed (attempts 1, then 2) and leaves projected / ignored / ignored_auto_echo outcomes untouched (no state change, no attempt)');
UPDATE platform_private.wazzup_event_projections SET state = 'needs_review', last_code = 'a325_probe' WHERE event_id = pg_temp.a325_event('fr-1');
SELECT platform_private.wazzup_projection_fail(pg_temp.a325_id(1), pg_temp.a325_event('fr-1'), 'wazzup_probe_three') AS a325_fr6 \gset
SELECT pg_temp.a325_assert((SELECT p.state = 'needs_review' AND p.last_code = 'a325_probe' AND p.attempts = 2 FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('fr-1')),
  'a needs_review outcome is final too: a late failure record does not turn it into failed');
UPDATE platform_private.wazzup_event_projections SET state = 'ignored', last_code = 'a325_fixture' WHERE event_id = pg_temp.a325_event('fr-1');
-- A failure whose own record cannot be written (a trigger of this suite makes every write of a failed outcome fail): the caller gets the
-- failure and the pass goes on; the event stays as it was and the next pass retries it.
CREATE FUNCTION pg_temp.a325_nofail() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'synthetic record failure' USING ERRCODE = 'P0001';
END
$$;
CREATE TRIGGER a325_nofail BEFORE INSERT OR UPDATE ON platform_private.wazzup_event_projections
  FOR EACH ROW WHEN (NEW.state = 'failed') EXECUTE FUNCTION pg_temp.a325_nofail();
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('nf-1', '996000000604', 'Первый, сбой не записывается', 451)),
  pg_temp.a325_el(pg_temp.a325_msg('nf-2', '996000000605', 'Второй, сбой не записывается', 452)))) AS a325_pnf \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('nf-1'), 302) AS a325_nf1 \gset
SELECT pg_temp.a325_sweep(302) AS a325_nf2 \gset
DROP TRIGGER a325_nofail ON platform_private.wazzup_event_projections;
SELECT pg_temp.a325_sweep() AS a325_nf3 \gset
SELECT pg_temp.a325_assert((:'a325_nf1'::JSONB ->> 'outcome') = 'failed' AND (:'a325_nf1'::JSONB ->> 'code') = 'wazzup_intake_owner_ineligible'
  AND (:'a325_nf1'::JSONB ->> 'recorded') = 'false'
  AND NOT (:'a325_nf2'::JSONB ? 'error') AND (:'a325_nf2'::JSONB ->> 'processed') = '2' AND (:'a325_nf2'::JSONB #>> '{outcomes,failed}') = '2'
  AND (:'a325_nf3'::JSONB #>> '{outcomes,projected}') = '2' AND pg_temp.a325_state('nf-1') = 'projected' AND pg_temp.a325_state('nf-2') = 'projected'
  AND (SELECT bool_and(p.attempts = 1) FROM platform_private.wazzup_event_projections p
      WHERE p.event_id IN (pg_temp.a325_event('nf-1'), pg_temp.a325_event('nf-2'))),
  'when even the failure record cannot be written the inline call reports failed (recorded = false) instead of raising, the sweep finishes its pass, the events stay as they were and the next pass projects them: ' || :'a325_nf1' || :'a325_nf2');
-- A busy chat: the lock helper is replaced (inside this transaction, restored below) by one that refuses to be taken without waiting, as if
-- another transaction were projecting the chat. The sweep must not wait: the events stay exactly as they were (pending, no attempt, nothing
-- written: no conversation, no client, no binding) and are counted as busy; the inline call - which waits - is not affected by the helper
-- refusing only the no-wait mode. A deletion is held back the same way. Restoring the helper lets the next pass project them.
SELECT pg_get_functiondef('platform_private.wazzup_chat_lock(uuid,uuid,text,boolean)'::REGPROCEDURE) AS a325_lock_def \gset
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('bz-1', '996000000609', 'Занятый чат, первое', 456)),
  pg_temp.a325_el(pg_temp.a325_msg('bz-2', '996000000610', 'Занятый чат, второе', 457)),
  pg_temp.a325_el(pg_temp.a325_msg('bz-1', '996000000609', 'Занятый чат, первое', 458, FALSE, '{"isDeleted": true}')))) AS a325_pbz \gset
SELECT count(*) AS a325_bz_conv0 FROM platform.communication_conversations WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT count(*) AS a325_bz_cli0 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT count(*) AS a325_bz_msg0 FROM platform.communication_messages WHERE organization_id = pg_temp.a325_id(1) \gset
CREATE OR REPLACE FUNCTION platform_private.wazzup_chat_lock(p_organization_id UUID, p_channel_id UUID, p_digits TEXT, p_wait BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT p_wait $$;
SELECT pg_temp.a325_sweep() AS a325_bz1 \gset
SELECT pg_temp.a325_assert((:'a325_bz1'::JSONB ->> 'busy') = '3' AND (:'a325_bz1'::JSONB ->> 'processed') = '0' AND (:'a325_bz1'::JSONB -> 'outcomes') = '{}'::JSONB
  AND (:'a325_bz1'::JSONB ->> 'newInbound') = '0' AND (:'a325_bz1'::JSONB ->> 'oldestPendingSeconds') IS NOT NULL
  AND (SELECT bool_and(p.state = 'pending' AND p.attempts = 0 AND p.last_code IS NULL AND p.conversation_id IS NULL AND p.message_id IS NULL)
      FROM platform_private.wazzup_event_projections p WHERE p.event_id IN (pg_temp.a325_event('bz-1'), pg_temp.a325_event('bz-2'), pg_temp.a325_event('bz-1', 'message.deleted')))
  AND (SELECT count(*) = :a325_bz_conv0 FROM platform.communication_conversations WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = :a325_bz_cli0 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = :a325_bz_msg0 FROM platform.communication_messages WHERE organization_id = pg_temp.a325_id(1))
  AND pg_temp.a325_conv('996000000609') IS NULL AND pg_temp.a325_conv('996000000610') IS NULL,
  'a sweep over busy chats waits for nothing: the two messages and the deletion stay pending with no attempt, nothing is written, and they are reported as busy (3): ' || :'a325_bz1');
SELECT pg_temp.a325_project(pg_temp.a325_event('bz-1')) AS a325_bz2 \gset
SELECT pg_temp.a325_assert((:'a325_bz2'::JSONB ->> 'outcome') = 'projected' AND pg_temp.a325_state('bz-1') = 'projected',
  'the inline call, which waits for the chat, is not held back by the no-wait refusal and projects the message: ' || :'a325_bz2');
:a325_lock_def ;
SELECT pg_temp.a325_sweep() AS a325_bz3 \gset
SELECT pg_temp.a325_assert((:'a325_bz3'::JSONB ->> 'busy') = '0' AND (:'a325_bz3'::JSONB ->> 'processed') = '2' AND (:'a325_bz3'::JSONB #>> '{outcomes,projected}') = '2'
  AND pg_temp.a325_state('bz-2') = 'projected' AND pg_temp.a325_state('bz-1', 'message.deleted') = 'projected'
  AND (SELECT p.last_code = 'deleted_noted' FROM platform_private.wazzup_event_projections p WHERE p.event_id = pg_temp.a325_event('bz-1', 'message.deleted'))
  AND (SELECT b.sender_deleted_at IS NOT NULL FROM platform_private.wazzup_message_bindings b WHERE b.wazzup_message_id = 'bz-1'),
  'with the lock free again the next pass projects what it held back; the deletion stored with its message was already applied when the message was projected: ' || :'a325_bz3');
-- A projection row that another transaction is working on is skipped, not waited for (the row is absent here, which is how a single session sees
-- the skipped branch: the real lock needs a second session); the inline mode does not skip, it carries on and writes the outcome.
SELECT pg_temp.a325_persist(jsonb_build_array(pg_temp.a325_el(pg_temp.a325_msg('rl-1', '996000000613', 'Строка итога занята', 459)))) AS a325_prl \gset
SELECT pg_temp.a325_event('rl-1') AS a325_rl_ev \gset
DELETE FROM platform_private.wazzup_event_projections WHERE event_id = :'a325_rl_ev'::UUID;
SELECT platform_private.wazzup_project_one(pg_temp.a325_id(1), :'a325_rl_ev'::UUID, pg_temp.a325_id(301), gen_random_uuid(), TRUE) AS a325_rl1 \gset
SELECT NOT EXISTS (SELECT 1 FROM platform_private.wazzup_event_projections WHERE event_id = :'a325_rl_ev'::UUID) AND pg_temp.a325_conv('996000000613') IS NULL AS a325_rl_untouched \gset
SELECT platform_private.wazzup_project_one(pg_temp.a325_id(1), :'a325_rl_ev'::UUID, pg_temp.a325_id(301), gen_random_uuid(), FALSE) AS a325_rl2 \gset
SELECT pg_temp.a325_assert((:'a325_rl1'::JSONB ->> 'outcome') = 'busy' AND (:'a325_rl1'::JSONB ->> 'code') = 'row_locked' AND :'a325_rl_untouched'::BOOLEAN
  AND (:'a325_rl2'::JSONB ->> 'outcome') = 'projected' AND pg_temp.a325_state('rl-1') = 'projected',
  'the no-wait mode skips an event whose projection row is not available to it (busy, row_locked, nothing written); the inline mode projects it: ' || :'a325_rl1' || :'a325_rl2');
-- The answer of the sweep names what it skipped (nothing here: no other transaction holds anything), and the automatic echoes are counted
-- exactly once on either path: the sweep adds them at the end of the pass, the inline projection adds each as it goes.
SELECT n AS a325_ae0 FROM platform_private.wazzup_daily_counters WHERE counter = 'auto_echo' \gset
SELECT pg_temp.a325_persist(jsonb_build_array(
  pg_temp.a325_el(pg_temp.a325_msg('ae-1', '996000000606', 'Нерабочее время', 453, TRUE)),
  pg_temp.a325_el(pg_temp.a325_msg('ae-2', '996000000607', 'Нерабочее время', 454, TRUE)),
  pg_temp.a325_el(pg_temp.a325_msg('ae-3', '996000000608', 'Нерабочее время', 455, TRUE)))) AS a325_pae \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('ae-1')) AS a325_ae1 \gset
SELECT n AS a325_ae2 FROM platform_private.wazzup_daily_counters WHERE counter = 'auto_echo' \gset
SELECT pg_temp.a325_project(pg_temp.a325_event('ae-1')) AS a325_ae1b \gset
SELECT pg_temp.a325_sweep() AS a325_ae3 \gset
SELECT n AS a325_ae4 FROM platform_private.wazzup_daily_counters WHERE counter = 'auto_echo' \gset
SELECT pg_temp.a325_sweep() AS a325_ae5 \gset
SELECT n AS a325_ae6 FROM platform_private.wazzup_daily_counters WHERE counter = 'auto_echo' \gset
SELECT pg_temp.a325_assert((:'a325_ae1'::JSONB ->> 'outcome') = 'ignored_auto_echo' AND (:'a325_ae1'::JSONB ->> 'countDeferred') = 'false'
  AND :a325_ae2 = :a325_ae0 + 1 AND (:'a325_ae1b'::JSONB ->> 'deduplicated') = 'true'
  AND (:'a325_ae3'::JSONB #>> '{outcomes,ignored_auto_echo}') = '2' AND (:'a325_ae3'::JSONB ->> 'busy') = '0' AND (:'a325_ae3'::JSONB ->> 'processed') = '2'
  AND :a325_ae4 = :a325_ae0 + 3 AND (:'a325_ae5'::JSONB ->> 'processed') = '0' AND (:'a325_ae5'::JSONB ->> 'busy') = '0' AND :a325_ae6 = :a325_ae4,
  'automatic echoes are counted once: inline one by one (a repeat is a dedupe and counts nothing), in a sweep pass once at the end for the whole pass; an empty pass counts nothing and reports busy = 0: ' || :'a325_ae3');

-- G. The identity of a new number.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, phone, normalized_phone, lifecycle_state, created_at, updated_at)
SELECT c.id, pg_temp.a325_id(1), c.name, platform_private.normalize_person_name(c.name), c.phone, platform_private.normalize_person_phone(c.phone), 'active',
  clock_timestamp() - INTERVAL '30 days', clock_timestamp() - INTERVAL '30 days'
FROM (VALUES
  (pg_temp.a325_id(501), 'A325 Студент Один', '+996000000401'), (pg_temp.a325_id(502), 'A325 Клиент Два', '+996000000402'),
  (pg_temp.a325_id(503), 'A325 Импорт Три', '+996000000403'), (pg_temp.a325_id(504), 'A325 Клиент Четыре', '+996000000404'),
  (pg_temp.a325_id(505), 'A325 Тёзка Пять', '+996000000405'), (pg_temp.a325_id(515), 'A325 Тёзка Пять Дубль', '+996000000405'),
  (pg_temp.a325_id(506), 'A325 Студент Шесть', '+996000000406'), (pg_temp.a325_id(516), 'A325 Студент Шесть Брат', '+996000000406'),
  (pg_temp.a325_id(507), 'A325 Студент Семь', '+996000000407')) AS c(id, name, phone);
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state, interest_direction, created_at, updated_at)
SELECT l.id, pg_temp.a325_id(1), l.client, pg_temp.a325_id(301), 'new', 'website', l.state::platform.lead_lifecycle_state, 'CN', clock_timestamp() - INTERVAL '20 days', clock_timestamp() - INTERVAL '2 days'
FROM (VALUES
  (pg_temp.a325_id(601), pg_temp.a325_id(501), 'open'), (pg_temp.a325_id(612), pg_temp.a325_id(502), 'open'), (pg_temp.a325_id(602), pg_temp.a325_id(502), 'converted'),
  (pg_temp.a325_id(603), pg_temp.a325_id(503), 'open'), (pg_temp.a325_id(604), pg_temp.a325_id(504), 'open'), (pg_temp.a325_id(614), pg_temp.a325_id(504), 'open'),
  (pg_temp.a325_id(606), pg_temp.a325_id(506), 'open'), (pg_temp.a325_id(616), pg_temp.a325_id(516), 'open'), (pg_temp.a325_id(607), pg_temp.a325_id(507), 'open')) AS l(id, client, state);
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id, source_key,
  student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at, current_scope_id, current_scope_version,
  admissions_direction, pipeline_stage, canonical_client_id, canonical_lead_id, created_at, updated_at)
SELECT s.id, pg_temp.a325_id(1), s.student, pg_temp.a325_id(301), pg_temp.a325_id(301), s.source_key, s.name, 'China', 'bachelor', 'CN', '2027-09', 'intake', s.state::platform.student_case_state,
  clock_timestamp() - INTERVAL '3 days', CASE WHEN s.state = 'closed' THEN clock_timestamp() - INTERVAL '1 day' END, pg_temp.a325_id(401), 1, 'CN', 'documents', s.client, s.lead,
  clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'
FROM (VALUES
  (pg_temp.a325_id(701), NULL::UUID, 'admissions-direct:a325-701', 'A325 Студент Один', 'active', pg_temp.a325_id(501), pg_temp.a325_id(601)),
  (pg_temp.a325_id(702), NULL::UUID, 'admissions-direct:a325-702', 'A325 Клиент Два', 'closed', pg_temp.a325_id(502), pg_temp.a325_id(602)),
  (pg_temp.a325_id(706), NULL::UUID, 'admissions-direct:a325-706', 'A325 Студент Шесть', 'active', pg_temp.a325_id(506), pg_temp.a325_id(606)),
  (pg_temp.a325_id(716), NULL::UUID, 'admissions-direct:a325-716', 'A325 Студент Шесть Брат', 'active', pg_temp.a325_id(516), pg_temp.a325_id(616)),
  (pg_temp.a325_id(707), pg_temp.a325_id(304), 'admissions-direct:a325-707', 'A325 Студент Семь', 'active', pg_temp.a325_id(507), pg_temp.a325_id(607))
) AS s(id, student, source_key, name, state, client, lead);
SET LOCAL session_replication_role = origin;
SELECT count(*) AS a325_clients1 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT count(*) AS a325_leads1 FROM platform.leads WHERE organization_id = pg_temp.a325_id(1) \gset
CREATE FUNCTION pg_temp.a325_ident(p_digits TEXT) RETURNS TABLE (state TEXT, client UUID, lead UUID, outcome TEXT, code TEXT) LANGUAGE SQL STABLE AS $$
  SELECT b.identity_state, c.canonical_client_id, c.canonical_lead_id, p.state, p.last_code
  FROM platform_private.wazzup_chat_bindings b JOIN platform.communication_conversations c ON c.id = b.conversation_id
  JOIN platform_private.wazzup_event_projections p ON p.event_id = b.source_webhook_event_id
  WHERE b.chat_digits = p_digits
$$;
SELECT pg_temp.a325_ingest(jsonb_build_array(
  pg_temp.a325_msg('g-1', '996000000401', 'Я студент, пишу снова', 500), pg_temp.a325_msg('g-2', '996000000402', 'Дело закрыто, но номер известен', 501),
  pg_temp.a325_msg('g-3', '996000000403', 'Клиент из импорта amoCRM', 502), pg_temp.a325_msg('g-4', '996000000404', 'Два открытых лида', 503),
  pg_temp.a325_msg('g-5', '996000000405', 'Один номер на двоих', 504), pg_temp.a325_msg('g-6', '996000000406', 'Два студента на одном номере', 505),
  pg_temp.a325_msg('g-7', '996000000407', 'Студент без согласия на ИИ', 506))) AS a325_sg \gset
SELECT pg_temp.a325_assert((:'a325_sg'::JSONB #>> '{outcomes,projected}') = '5' AND (:'a325_sg'::JSONB #>> '{outcomes,needs_review}') = '2',
  'seven identity cases are projected: five normally, two (the ambiguous numbers) for review: ' || :'a325_sg');
SELECT pg_temp.a325_assert(
  (SELECT i.state = 'matched_case' AND i.client = pg_temp.a325_id(501) AND i.lead = pg_temp.a325_id(601) AND i.outcome = 'projected' FROM pg_temp.a325_ident('996000000401') i)
  AND (SELECT i.state = 'matched_phone' AND i.client = pg_temp.a325_id(502) AND i.lead = pg_temp.a325_id(612) AND i.outcome = 'projected' FROM pg_temp.a325_ident('996000000402') i)
  AND (SELECT i.state = 'matched_phone' AND i.client = pg_temp.a325_id(503) AND i.lead = pg_temp.a325_id(603) FROM pg_temp.a325_ident('996000000403') i)
  AND (SELECT i.state = 'matched_phone' AND i.client = pg_temp.a325_id(504) AND i.lead IS NULL AND i.outcome = 'projected' FROM pg_temp.a325_ident('996000000404') i)
  AND (SELECT i.state = 'ambiguous' AND i.client IS NULL AND i.lead IS NULL AND i.outcome = 'needs_review' AND i.code = 'identity_ambiguous' FROM pg_temp.a325_ident('996000000405') i)
  AND (SELECT i.state = 'ambiguous' AND i.client IS NULL AND i.lead IS NULL AND i.outcome = 'needs_review' FROM pg_temp.a325_ident('996000000406') i)
  AND (SELECT i.state = 'matched_case' AND i.client = pg_temp.a325_id(507) AND i.lead = pg_temp.a325_id(607) FROM pg_temp.a325_ident('996000000407') i)
  AND (SELECT count(*) = :a325_clients1 FROM platform.clients WHERE organization_id = pg_temp.a325_id(1))
  AND (SELECT count(*) = :a325_leads1 FROM platform.leads WHERE organization_id = pg_temp.a325_id(1)),
  'identity: a student with one direct case keeps client and lead (316); a closed case falls back to the number and its single open lead; an imported client is matched (single open lead); a client with two open leads gets no lead; two clients on one number, or two students, are ambiguous (no client, no lead); NOTHING new is created for any of them');
SELECT pg_temp.a325_assert(
  (SELECT count(*) = 2 FROM platform.subject_provenance sp WHERE sp.source_system = 'wazzup' AND sp.source_ref = 'wazzup-event:' || pg_temp.a325_event('g-1')::TEXT
      AND (sp.client_id = pg_temp.a325_id(501) OR sp.lead_id = pg_temp.a325_id(601)))
  AND (SELECT count(*) = 1 FROM platform.subject_provenance sp WHERE sp.source_system = 'wazzup' AND sp.source_ref = 'wazzup-event:' || pg_temp.a325_event('g-4')::TEXT)
  AND NOT EXISTS (SELECT 1 FROM platform.subject_provenance sp WHERE sp.source_system = 'wazzup' AND sp.source_ref IN
      ('wazzup-event:' || pg_temp.a325_event('g-5')::TEXT, 'wazzup-event:' || pg_temp.a325_event('g-6')::TEXT))
  AND NOT EXISTS (SELECT 1 FROM platform.external_identifiers WHERE source_system = 'wazzup' AND external_identifier LIKE '%99600000040%'),
  'a trace of Wazzup is left on the matched client and lead (the event is named), none on an ambiguous number, and no external identity is made for a match');
-- An ambiguous conversation: the message is kept for staff, the agent is shut out.
SELECT pg_temp.a325_conv('996000000405') AS a325_camb \gset
SELECT pg_temp.a325_get(:'a325_camb'::UUID) AS a325_gamb \gset
SELECT pg_temp.a325_list('all') AS a325_lamb \gset
SELECT pg_temp.a325_assert((SELECT count(*) = 1 FROM pg_temp.a325_msgs(:'a325_camb'::UUID) WHERE body = 'Один номер на двоих' AND direction = 'inbound')
  AND pg_temp.a325_err(:'a325_gamb'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_gamb'::JSONB) = 'identity_unresolved'
  AND (pg_temp.a325_in_list(:'a325_lamb'::JSONB, :'a325_camb'::UUID) -> 'last_text_preview') = 'null'::JSONB
  AND (pg_temp.a325_in_list(:'a325_lamb'::JSONB, :'a325_camb'::UUID) ->> 'identity_unresolved') = 'true'
  AND NOT (:'a325_lamb'::TEXT LIKE '%Один номер на двоих%')
  AND (SELECT count(*) = 0 FROM platform.audit_events e WHERE e.resource_id = :'a325_camb'::UUID AND e.action = 'ai.agent.tool.read'),
  'an ambiguous conversation: the message is stored for staff; get_conversation is refused (identity_unresolved, no audit row of a read); the list shows no text and says why');
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('g-5b', '996000000405', 'И ещё одно сообщение', 510),
  pg_temp.a325_msg('g-5c', '996000000405', 'Ответ продавца', 511, TRUE, '{"authorId": "seller-1"}'))) AS a325_sg2 \gset
SELECT pg_temp.a325_assert((:'a325_sg2'::JSONB #>> '{outcomes,needs_review}') = '1' AND (:'a325_sg2'::JSONB #>> '{outcomes,projected}') = '1'
  AND (SELECT count(*) = 3 FROM pg_temp.a325_msgs(:'a325_camb'::UUID)) AND (SELECT count(*) = 1 FROM platform_private.wazzup_chat_bindings WHERE chat_digits = '996000000405'),
  'later messages of the ambiguous number stay in the same conversation (the inbound one again for review, the seller reply as a reply)');
-- The student who declined the AI helpers is found by number: the consent gate of 320 closes the chat for the agent.
SELECT pg_temp.a325_conv('996000000407') AS a325_cs7 \gset
SELECT pg_temp.a325_conv('996000000401') AS a325_cs1 \gset
INSERT INTO platform_private.student_ai_consents (organization_id, auth_user_id, status, policy_version, source)
VALUES (pg_temp.a325_id(1), pg_temp.a325_id(104), 'declined', platform_private.student_ai_consent_policy_version(), 'ios');
SELECT pg_temp.a325_get(:'a325_cs7'::UUID) AS a325_gs7 \gset
SELECT pg_temp.a325_list('all') AS a325_ls7 \gset
SELECT pg_temp.a325_get(:'a325_cs1'::UUID) AS a325_gs1 \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_gs7'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_gs7'::JSONB) = 'ai_consent_missing'
  AND (pg_temp.a325_in_list(:'a325_ls7'::JSONB, :'a325_cs7'::UUID) -> 'last_text_preview') = 'null'::JSONB
  AND (pg_temp.a325_in_list(:'a325_ls7'::JSONB, :'a325_cs7'::UUID) ->> 'ai_consent_missing') = 'true'
  AND NOT (:'a325_ls7'::TEXT LIKE '%Студент без согласия на ИИ%')
  AND NOT (:'a325_gs1'::JSONB ? 'error') AND jsonb_array_length(:'a325_gs1'::JSONB -> 'messages') = 1,
  'a student who declined the AI helpers, found by number, is closed to the agent (the 320 gate sees the client of the Wazzup conversation); a student without a cabinet is not: ' || :'a325_gs7');
UPDATE platform_private.student_ai_consents SET status = 'granted' WHERE auth_user_id = pg_temp.a325_id(104);
SELECT pg_temp.a325_assert(NOT (pg_temp.a325_get(:'a325_cs7'::UUID) ? 'error'), 'with a grant on the current text the same chat opens');
DELETE FROM platform_private.student_ai_consents WHERE auth_user_id = pg_temp.a325_id(104);

-- The chat of an identified student: the owner and the staff gates of the conversation (immutability, bindings).
SELECT pg_temp.a325_assert(
  pg_temp.a325_try(format('UPDATE platform.communication_conversations SET wazzup_channel_id = %L WHERE id = %L', pg_temp.a325_id(9996), :'a325_ca'))
    IN ('55000', '23503')
  AND pg_temp.a325_try(format('UPDATE platform.communication_conversations SET wazzup_channel_id = NULL, waha_session_name = %L WHERE id = %L', 'crm_primary', :'a325_ca')) = '55000'
  AND pg_temp.a325_try(format('UPDATE platform.communication_conversations SET waha_session_name = %L WHERE id = %L', 'crm_primary', :'a325_ca')) IN ('55000', '23514')
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_chat_bindings SET identity_state = ''ambiguous'' WHERE conversation_id = %L', :'a325_ca')) = '55000'
  AND pg_temp.a325_try(format('DELETE FROM platform_private.wazzup_chat_bindings WHERE conversation_id = %L', :'a325_ca')) = '55000'
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_message_bindings SET wazzup_message_id = ''other'' WHERE wazzup_message_id = ''a-2''')) = '55000'
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_message_bindings SET sender_deleted_at = NULL WHERE wazzup_message_id = ''a-1''')) = '55000'
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_message_bindings SET sender_deleted_at = clock_timestamp() WHERE wazzup_message_id = ''a-1''')) = '55000'
  AND pg_temp.a325_try(format('UPDATE platform_private.wazzup_message_bindings SET sender_deleted_at = clock_timestamp() WHERE wazzup_message_id = ''a-2''')) = 'ok'
  AND pg_temp.a325_try(format('DELETE FROM platform_private.wazzup_message_bindings WHERE wazzup_message_id = ''a-2''')) = '55000'
  AND pg_temp.a325_try('TRUNCATE platform_private.wazzup_message_bindings') = '55000',
  'the model locks: the Wazzup channel of a conversation cannot be rewritten, a conversation keeps exactly one transport, chat bindings are append-only, a message binding only gets its deletion mark, once');
-- A Wazzup message without its exact binding is refused at commit; with it, accepted.
SELECT pg_temp.a325_try(format($q$INSERT INTO platform.communication_messages (organization_id, conversation_id, sender_participant_id, direction, body_text, language,
    student_visible, message_identity_source, source_webhook_event_id, created_at)
  SELECT %L, c.id, p.id, 'inbound', 'без привязки', 'undetermined', FALSE, 'private_wazzup_binding', c.created_from_webhook_event_id, clock_timestamp()
  FROM platform.communication_conversations c JOIN platform.conversation_participants p ON p.conversation_id = c.id AND p.participant_kind = 'customer'
  WHERE c.id = %L$q$, pg_temp.a325_id(1), :'a325_ca'), 'SET CONSTRAINTS ALL IMMEDIATE') AS a325_nobind \gset
SELECT pg_temp.a325_assert(:'a325_nobind' = '23514', 'a private_wazzup_binding message with no binding row is refused (23514) when the deferred check runs: ' || :'a325_nobind');
SELECT pg_temp.a325_try(format($q$INSERT INTO platform.communication_messages (organization_id, conversation_id, sender_participant_id, direction, body_text, language,
    student_visible, message_identity_source, source_webhook_event_id, manual_send_authorization_id, created_at)
  SELECT %L, c.id, p.id, 'outbound', 'исходящее с поддельным происхождением', 'undetermined', FALSE, 'private_wazzup_echo_binding', c.created_from_webhook_event_id, NULL, clock_timestamp()
  FROM platform.communication_conversations c JOIN platform.conversation_participants p ON p.conversation_id = c.id AND p.participant_kind = 'sales'
  WHERE c.id = %L$q$, pg_temp.a325_id(1), :'a325_ca'), 'SET CONSTRAINTS ALL IMMEDIATE') AS a325_nobind2 \gset
SELECT pg_temp.a325_assert(:'a325_nobind2' = '23514', 'an outbound echo-source message with no binding is refused as well: ' || :'a325_nobind2');
-- The binding row of a message of one chat cannot be borrowed by a message of another event or another direction.
SELECT pg_temp.a325_try(format($q$WITH m AS (INSERT INTO platform.communication_messages (id, organization_id, conversation_id, sender_participant_id, direction, body_text, language,
    student_visible, message_identity_source, source_webhook_event_id, created_at)
  SELECT gen_random_uuid(), %L, c.id, p.id, 'inbound', 'поддельное', 'undetermined', FALSE, 'private_wazzup_binding', e.id, clock_timestamp()
  FROM platform.communication_conversations c JOIN platform.conversation_participants p ON p.conversation_id = c.id AND p.participant_kind = 'customer'
  JOIN platform_private.provider_webhook_events e ON e.payload_id = 'a-3' AND e.event_type = 'message'
  WHERE c.id = %L RETURNING id, source_webhook_event_id)
  INSERT INTO platform_private.wazzup_message_bindings (organization_id, channel_id, wazzup_message_id, communication_message_id, source_webhook_event_id, kind)
  SELECT %L, %L, 'a-3-fake', m.id, m.source_webhook_event_id, 'inbound' FROM m$q$, pg_temp.a325_id(1), :'a325_ca', pg_temp.a325_id(1), pg_temp.a325_channel()),
  'SET CONSTRAINTS ALL IMMEDIATE') AS a325_borrow \gset
SELECT pg_temp.a325_assert(:'a325_borrow' IN ('23514', '23505'), 'an inbound message bound to the event of a seller echo is refused: ' || :'a325_borrow');

-- ---------------------------------------------------------------------------
-- 7. The send gates on all six paths. The WAHA side is built through the REAL projection chain and the REAL manual-send chain.
-- ---------------------------------------------------------------------------
CREATE TEMP SEQUENCE a325_req START 8000;
CREATE FUNCTION pg_temp.a325_cfg(p_transport TEXT, p_ai TEXT DEFAULT 'NULL', p_gemini TEXT DEFAULT 'NULL') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_transport_configure_v1(%L, %L, %s, %s, %L)', pg_temp.a325_id(1), p_transport, p_ai, p_gemini,
    pg_temp.a325_id(nextval('a325_req')::INTEGER)))
$$;
CREATE FUNCTION pg_temp.a325_health(p_status TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM platform.waha_session_health WHERE organization_id = pg_temp.a325_id(1);
  IF p_status IS NOT NULL THEN
    INSERT INTO platform.waha_session_health (organization_id, waha_session_name, status, observed_at)
    VALUES (pg_temp.a325_id(1), 'crm_primary', p_status, clock_timestamp());
  END IF;
END
$$;
-- A WAHA customer message through the real chain (as the 266 suite does); the intake owner is the Admin.
CREATE FUNCTION pg_temp.a325_waha_run(p_n INTEGER, p_chat TEXT, p_body TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a325_id(1); event_id CONSTANT UUID := pg_temp.a325_id(5000 + p_n); payload JSONB;
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  payload := jsonb_build_object('id', 'false_' || p_chat || '@c.us_A325W' || lpad(p_n::TEXT, 12, '0'), 'timestamp', 1788343200 + p_n,
    'from', p_chat || '@c.us', 'fromMe', false, 'source', 'app', 'body', p_body);
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref, provider_conversation_ref,
    provider_event_variant_ref, provider_request_id, waha_session_name, payload_id, event_type, provider_occurred_at, verification_status,
    raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a325-waha-' || p_n, 'crm_primary', payload ->> 'id', 'message.any',
    clock_timestamp() - INTERVAL '3 minutes' + p_n * INTERVAL '1 second', 'verified',
    jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', payload),
    '{"hmac_verified":true}', 'synthetic:a325:' || p_n, lpad(to_hex(p_n + 4096), 64, '0'), pg_temp.a325_id(5500 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a325-message.any-' || (payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.a325_id(6000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a325', pg_temp.a325_id(6000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a325_id(301), pg_temp.a325_id(6000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a325_id(6000 + p_n * 10 + 4));
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day' WHERE vt <= pg_catalog.clock_timestamp();
SELECT pg_temp.a325_waha_run(1, '996000000501', 'Здравствуйте, это чат WAHA') AS a325_w1 \gset
SELECT pg_temp.a325_waha_run(2, '996000000502', 'Второй чат WAHA') AS a325_w2 \gset
SELECT pg_temp.a325_waha_run(3, '996000000503', 'Третий чат WAHA') AS a325_w3 \gset
SELECT pg_temp.a325_assert((:'a325_w1'::JSONB ->> 'disposition') = 'succeeded' AND (:'a325_w2'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'a325_w3'::JSONB ->> 'disposition') = 'succeeded', 'three WAHA chats project through the real chain: ' || :'a325_w1');
SELECT b.conversation_id AS a325_cw1 FROM platform_private.waha_direct_chat_bindings b WHERE b.organization_id = pg_temp.a325_id(1) AND b.normalized_chat_id = '996000000501@c.us' \gset
SELECT b.conversation_id AS a325_cw2 FROM platform_private.waha_direct_chat_bindings b WHERE b.organization_id = pg_temp.a325_id(1) AND b.normalized_chat_id = '996000000502@c.us' \gset
SELECT b.conversation_id AS a325_cw3 FROM platform_private.waha_direct_chat_bindings b WHERE b.organization_id = pg_temp.a325_id(1) AND b.normalized_chat_id = '996000000503@c.us' \gset
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO platform_private.messaging_integration_health_events (organization_id, target, readiness, evidence_kind, reason, evidence_ref, request_id, observed_at)
VALUES (pg_temp.a325_id(1), 'waha', 'ready', 'provider_observed', 'A325 synthetic fresh WAHA readiness', 'synthetic:a325:waha-ready', pg_temp.a325_id(3001), statement_timestamp());
SELECT pg_temp.a325_assert((SELECT bool_and(c.waha_session_name = 'crm_primary' AND c.wazzup_channel_id IS NULL AND c.queue = 'sales')
    FROM platform.communication_conversations c WHERE c.id IN (:'a325_cw1'::UUID, :'a325_cw2'::UUID, :'a325_cw3'::UUID)),
  'the WAHA conversations keep their session and have no Wazzup channel');

CREATE FUNCTION pg_temp.a325_send(p_conv UUID, p_text TEXT, p_code TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_tool_send_message_v1(%L, ''sales'', %L::jsonb)', pg_temp.a325_id(1),
    jsonb_strip_nulls(jsonb_build_object('channel', 'whatsapp', 'conversation_id', p_conv, 'text', p_text, 'reason', 'A325 проверка', 'authority_code', p_code))))
$$;
CREATE FUNCTION pg_temp.a325_draft(p_result JSONB) RETURNS TABLE (status TEXT, failure_code TEXT, sent_by_agent BOOLEAN) LANGUAGE SQL STABLE AS $$
  SELECT d.status, d.failure_code, d.sent_by_agent FROM platform_private.ai_agent_drafts d WHERE d.id = (p_result ->> 'draft_id')::UUID
$$;
UPDATE platform_private.ai_agents SET auto_send = TRUE WHERE organization_id = pg_temp.a325_id(1) AND key = 'sales';
-- (the Wazzup conversation a is the one of section 5: a-7 is its last message; the agent wants to answer the next one)
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('s-1', '996000000201', 'Есть ли скидки?', 600))) AS a325_ss0 \gset

-- 1. The agent tool send_message: Auto on, the transport is wazzup.
SELECT pg_temp.a325_health('WORKING');
SELECT pg_temp.a325_cfg('wazzup') AS a325_c_w \gset
SELECT pg_temp.a325_send(:'a325_cw1'::UUID, 'Добрый день! Чем помочь? (Auto, WAHA, путь Wazzup)') AS a325_t1 \gset
SELECT pg_temp.a325_send(:'a325_ca'::UUID, 'Скидки есть, расскажу подробнее (Auto, беседа Wazzup)') AS a325_t2 \gset
INSERT INTO platform_private.ai_agent_runs (organization_id, agent_key, trigger_kind, started_by_membership_id, send_authority, send_authority_sha256, status)
VALUES (pg_temp.a325_id(1), 'sales', 'command', pg_temp.a325_id(301), TRUE, platform_private.ai_agent_sha256('a325-authority-code'), 'running');
UPDATE platform_private.ai_agents SET auto_send = FALSE WHERE organization_id = pg_temp.a325_id(1) AND key = 'sales';
SELECT pg_temp.a325_send(:'a325_cw2'::UUID, 'Сообщение по коду полномочия (WAHA, путь Wazzup)', 'a325-authority-code') AS a325_t3 \gset
SELECT pg_temp.a325_send(:'a325_ca'::UUID, 'Сообщение по коду полномочия (беседа Wazzup)', 'a325-authority-code') AS a325_t4 \gset
SELECT pg_temp.a325_assert(
  (:'a325_t1'::JSONB ->> 'status') = 'draft_created' AND (:'a325_t1'::JSONB ->> 'mode') = 'draft' AND (:'a325_t1'::JSONB ->> 'hint') LIKE '%только на чтение%'
  AND (SELECT d.status = 'pending' AND d.failure_code = 'receive_only' AND NOT d.sent_by_agent FROM pg_temp.a325_draft(:'a325_t1'::JSONB) d)
  AND (:'a325_t2'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.status = 'pending' AND d.failure_code = 'receive_only' FROM pg_temp.a325_draft(:'a325_t2'::JSONB) d)
  AND (:'a325_t3'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.status = 'pending' AND d.failure_code = 'receive_only' AND NOT d.sent_by_agent FROM pg_temp.a325_draft(:'a325_t3'::JSONB) d)
  AND (:'a325_t4'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.status = 'pending' AND d.failure_code = 'receive_only' FROM pg_temp.a325_draft(:'a325_t4'::JSONB) d)
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = pg_temp.a325_id(1) AND d.status IN ('approved', 'sending', 'sent') AND d.channel = 'whatsapp')
  AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations WHERE organization_id = pg_temp.a325_id(1) AND kind = 'ai_agent'),
  'transport wazzup: the agent in Auto and with an authority code gets a receive_only draft - for a WAHA chat and for a Wazzup chat alike - never needs_dispatch, no authorization: '
  || :'a325_t1' || :'a325_t4');
-- The transport is switched off: a WAHA chat as before, a Wazzup chat still closed (the channel of the conversation).
SELECT pg_temp.a325_cfg('none') AS a325_c_n \gset
UPDATE platform_private.ai_agents SET auto_send = TRUE WHERE organization_id = pg_temp.a325_id(1) AND key = 'sales';
SELECT pg_temp.a325_send(:'a325_cw1'::UUID, 'Добрый день! Чем помочь? (Auto, WAHA, связь есть)') AS a325_t5 \gset
SELECT pg_temp.a325_send(:'a325_ca'::UUID, 'Скидки есть (Auto, беседа Wazzup, путь выключен)') AS a325_t6 \gset
SELECT pg_temp.a325_health(NULL);
SELECT pg_temp.a325_send(:'a325_cw2'::UUID, 'Состояние канала неизвестно (Auto, WAHA)') AS a325_t7 \gset
SELECT pg_temp.a325_health('FAILED');
SELECT pg_temp.a325_send(:'a325_cw3'::UUID, 'Канал отключён (Auto, WAHA)') AS a325_t8 \gset
SELECT pg_temp.a325_health('WORKING');
SELECT pg_temp.a325_assert(
  (:'a325_t5'::JSONB ->> 'status') = 'needs_dispatch' AND (:'a325_t5'::JSONB ->> 'mode') = 'direct'
  AND (SELECT d.status = 'approved' AND d.sent_by_agent AND d.failure_code IS NULL FROM pg_temp.a325_draft(:'a325_t5'::JSONB) d)
  AND (:'a325_t6'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.status = 'pending' AND d.failure_code = 'receive_only' FROM pg_temp.a325_draft(:'a325_t6'::JSONB) d)
  AND (:'a325_t7'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.status = 'pending' AND d.failure_code = 'whatsapp_unavailable' AND NOT d.sent_by_agent FROM pg_temp.a325_draft(:'a325_t7'::JSONB) d)
  AND (:'a325_t8'::JSONB ->> 'status') = 'draft_created' AND (SELECT d.failure_code = 'whatsapp_unavailable' FROM pg_temp.a325_draft(:'a325_t8'::JSONB) d),
  'without Wazzup: a connected WAHA chat is sent as before (needs_dispatch); a Wazzup chat is still a receive_only draft; an UNKNOWN channel state (no health row) is a draft, not needs_dispatch; a disconnected one is a draft: '
  || :'a325_t5' || :'a325_t6' || :'a325_t7');

-- 2. The authorization of an approved draft (317).
CREATE FUNCTION pg_temp.a325_approved_draft(p_conv UUID, p_text TEXT, p_status TEXT DEFAULT 'approved') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO platform_private.ai_agent_drafts (id, organization_id, agent_key, channel, conversation_id, target_label, source_message_id, text, status, sent_by_agent)
  VALUES (v_id, pg_temp.a325_id(1), 'sales', 'whatsapp', p_conv, 'A325', platform_private.ai_latest_inbound(pg_temp.a325_id(1), p_conv), p_text, p_status, TRUE);
  RETURN v_id;
END
$$;
CREATE FUNCTION pg_temp.a325_authorize(p_draft UUID, p_status TEXT DEFAULT 'WORKING') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_runtime_whatsapp_authorize_v1(%L, %L, %L, %L, %L)', pg_temp.a325_id(1), p_draft,
    pg_temp.a325_id(301), p_status, pg_temp.a325_id(nextval('a325_req')::INTEGER)))
$$;
SELECT pg_temp.a325_cfg('wazzup') AS a325_c_w2 \gset
SELECT pg_temp.a325_approved_draft(:'a325_cw1'::UUID, 'Одобренный черновик WAHA') AS a325_d1 \gset
SELECT pg_temp.a325_approved_draft(:'a325_ca'::UUID, 'Одобренный черновик Wazzup') AS a325_d2 \gset
SELECT pg_temp.a325_authorize(:'a325_d1'::UUID) AS a325_au1 \gset
SELECT pg_temp.a325_authorize(:'a325_d2'::UUID) AS a325_au2 \gset
SELECT pg_temp.a325_assert((:'a325_au1'::JSONB ->> 'authorized') = 'false' AND (:'a325_au1'::JSONB ->> 'reason') = 'receive_only'
  AND (:'a325_au2'::JSONB ->> 'authorized') = 'false' AND (:'a325_au2'::JSONB ->> 'reason') = 'receive_only'
  AND (SELECT status = 'pending' AND failure_code = 'receive_only' FROM platform_private.ai_agent_drafts WHERE id = :'a325_d1'::UUID)
  AND (SELECT status = 'pending' AND failure_code = 'receive_only' FROM platform_private.ai_agent_drafts WHERE id = :'a325_d2'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations WHERE organization_id = pg_temp.a325_id(1) AND ai_agent_draft_id IN (:'a325_d1'::UUID, :'a325_d2'::UUID))
  AND NOT EXISTS (SELECT 1 FROM platform_private.durable_work_items WHERE organization_id = pg_temp.a325_id(1) AND kind = 'manual_whatsapp_send'),
  'transport wazzup: the authorization of an approved draft (a WAHA chat with the session WORKING, and a Wazzup chat) is refused with receive_only, the draft waits as pending, nothing is authorized or queued: '
  || :'a325_au1');
-- A started send ('sending') is refused too (no replay of the old authorization) and its draft is not touched.
SELECT pg_temp.a325_approved_draft(:'a325_cw2'::UUID, 'Уже в отправке', 'sending') AS a325_d3 \gset
SELECT pg_temp.a325_authorize(:'a325_d3'::UUID) AS a325_au3 \gset
SELECT pg_temp.a325_assert((:'a325_au3'::JSONB ->> 'reason') = 'receive_only'
  AND (SELECT status = 'sending' AND failure_code IS NULL FROM platform_private.ai_agent_drafts WHERE id = :'a325_d3'::UUID),
  'a draft already in "sending" gets the same refusal and keeps its status');
-- The draft mark accepts the code and leaves the draft pending; an unknown code is still a bad transition.
SELECT pg_temp.a325_approved_draft(:'a325_cw3'::UUID, 'Для отметки') AS a325_d4 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''pending'', ''receive_only'', NULL, NULL)', pg_temp.a325_id(1), :'a325_d4')) AS a325_dm1 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''pending'', ''something_else'', NULL, NULL)', pg_temp.a325_id(1),
  pg_temp.a325_approved_draft(:'a325_cw3'::UUID, 'Для отметки 2'))) AS a325_dm2 \gset
SELECT pg_temp.a325_assert((:'a325_dm1'::JSONB ->> 'ok') = 'true' AND (:'a325_dm1'::JSONB ->> 'status') = 'pending'
  AND (SELECT status = 'pending' AND failure_code = 'receive_only' FROM platform_private.ai_agent_drafts WHERE id = :'a325_d4'::UUID)
  AND pg_temp.a325_err(:'a325_dm2'::JSONB) = '55000',
  'the draft mark keeps an approved draft pending with receive_only; a code outside the list is still refused as a bad transition: ' || :'a325_dm1');

-- 3. The night autoresponder (due, commit, authorize). It needs the organization''s Gemini consent and the autoresponder switched on.
INSERT INTO platform_private.ai_settings (organization_id, gemini_consent_at, gemini_consent_by, gemini_consent_text_version)
VALUES (pg_temp.a325_id(1), clock_timestamp(), pg_temp.a325_id(301), 'a325')
ON CONFLICT (organization_id) DO UPDATE SET gemini_consent_at = EXCLUDED.gemini_consent_at, gemini_consent_by = EXCLUDED.gemini_consent_by,
  gemini_consent_text_version = EXCLUDED.gemini_consent_text_version;
INSERT INTO platform_private.ai_autosend_settings (organization_id, enabled, shadow_mode, responsible_membership_id, enabled_at, enabled_by)
VALUES (pg_temp.a325_id(1), TRUE, FALSE, pg_temp.a325_id(301), clock_timestamp(), pg_temp.a325_id(301))
ON CONFLICT (organization_id) DO UPDATE SET enabled = TRUE, shadow_mode = FALSE, responsible_membership_id = EXCLUDED.responsible_membership_id,
  enabled_at = EXCLUDED.enabled_at, enabled_by = EXCLUDED.enabled_by;
CREATE FUNCTION pg_temp.a325_check(p_conv UUID, p_stage TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT platform_private.ai_autosend_check(jsonb_populate_record(NULL::platform_private.ai_autosend_log,
    jsonb_build_object('id', gen_random_uuid(), 'organization_id', pg_temp.a325_id(1), 'conversation_id', p_conv,
      'client_message_id', platform_private.ai_latest_inbound(pg_temp.a325_id(1), p_conv),
      'interval_start', clock_timestamp() - INTERVAL '1 hour', 'interval_end', clock_timestamp() + INTERVAL '1 hour',
      'mode', 'live', 'kind', 'answer', 'status', 'considering')), p_stage, NULL, NULL)
$$;
SELECT pg_temp.a325_cfg('wazzup') AS a325_c_w3 \gset
SELECT array_agg(pg_temp.a325_check(:'a325_cw1'::UUID, s) ORDER BY ord) AS a325_ck_waha, array_agg(pg_temp.a325_check(:'a325_ca'::UUID, s) ORDER BY ord) AS a325_ck_wz
FROM unnest(ARRAY['due', 'commit', 'authorize']) WITH ORDINALITY AS t(s, ord) \gset
SELECT pg_temp.a325_assert(:'a325_ck_waha' = '{receive_only,receive_only,receive_only}' AND :'a325_ck_wz' = '{wazzup_ai_off,wazzup_ai_off,wazzup_ai_off}',
  'transport wazzup: the autoresponder says receive_only for a WAHA chat and wazzup_ai_off for a Wazzup chat on every stage (due, commit, authorize): ' || :'a325_ck_waha' || :'a325_ck_wz');
SELECT pg_temp.a325_cfg('wazzup', 'NULL', 'true') AS a325_c_g \gset
SELECT array_agg(pg_temp.a325_check(:'a325_ca'::UUID, s) ORDER BY ord) AS a325_ck_wz2 FROM unnest(ARRAY['due', 'commit', 'authorize']) WITH ORDINALITY AS t(s, ord) \gset
SELECT array_agg(pg_temp.a325_check(:'a325_camb'::UUID, s) ORDER BY ord) AS a325_ck_amb FROM unnest(ARRAY['due', 'commit', 'authorize']) WITH ORDINALITY AS t(s, ord) \gset
SELECT pg_temp.a325_assert(:'a325_ck_wz2' = '{receive_only,receive_only,receive_only}' AND :'a325_ck_amb' = '{wazzup_ai_off,wazzup_ai_off,wazzup_ai_off}',
  'with the Gemini flag on, a Wazzup chat is still closed for sending (receive_only on every stage) and the ambiguous chat is still closed to Gemini (wazzup_ai_off): ' || :'a325_ck_wz2' || :'a325_ck_amb');
SELECT pg_temp.a325_cfg('none', 'NULL', 'false') AS a325_c_n2 \gset
SELECT array_agg(pg_temp.a325_check(:'a325_cw1'::UUID, s) ORDER BY ord) AS a325_ck_waha2, array_agg(pg_temp.a325_check(:'a325_ca'::UUID, s) ORDER BY ord) AS a325_ck_wz3
FROM unnest(ARRAY['due', 'commit', 'authorize']) WITH ORDINALITY AS t(s, ord) \gset
SELECT pg_temp.a325_assert(:'a325_ck_waha2' NOT LIKE '%receive_only%' AND :'a325_ck_waha2' NOT LIKE '%wazzup_ai_off%'
  AND :'a325_ck_wz3' = '{wazzup_ai_off,wazzup_ai_off,wazzup_ai_off}',
  'without Wazzup the autoresponder decides a WAHA chat by its own rules (no receive_only, no wazzup_ai_off: ' || :'a325_ck_waha2' || '); a Wazzup chat stays closed to Gemini');
SELECT pg_temp.a325_assert(platform_private.ai_autosend_reason_ru('receive_only') = 'WhatsApp подключён только на чтение'
  AND platform_private.ai_autosend_reason_ru('wazzup_ai_off') = 'Тексты чатов Wazzup не передаются в Gemini'
  AND platform_private.ai_autosend_reason_ru('ai_consent_missing') = 'Студент не дал согласия на ИИ-помощников'
  AND platform_private.ai_autosend_reason_ru('paused') = 'Автоответчик на паузе', 'the reason words: the two new ones are in Russian, the old ones are unchanged');

-- 4. The manual reply of a staff member (050) and the exact claim (266) of work authorized BEFORE the switch.
CREATE FUNCTION pg_temp.a325_manual(p_conv UUID, p_text TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_source UUID := platform_private.ai_latest_inbound(pg_temp.a325_id(1), p_conv);
BEGIN
  RETURN pg_temp.a325_as(1, format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL, %L, 'staff_confirmed_manual_send', %L, %L)$q$,
    pg_temp.a325_id(1), p_conv, v_source, p_text,
    encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v1', 'manual_whatsapp_send', pg_temp.a325_id(1)::TEXT, p_conv::TEXT, v_source::TEXT,
      'staff-authored'])::TEXT, 'UTF8')), 'hex'), pg_temp.a325_id(p_req)));
END
$$;
-- Before the switch (transport none): the reply to the WAHA chat is authorized and queued (control), the Wazzup chat is refused.
SELECT pg_temp.a325_manual(:'a325_cw1'::UUID, 'Ответ сотрудника до переключения', 3101) AS a325_m1 \gset
SELECT pg_temp.a325_manual(:'a325_ca'::UUID, 'Ответ сотрудника в чат Wazzup', 3102) AS a325_m2 \gset
SELECT pg_temp.a325_assert((:'a325_m1'::JSONB ->> 'work_item_id') IS NOT NULL AND (:'a325_m1'::JSONB ->> 'work_state') IN ('queued', 'leased')
  AND pg_temp.a325_err(:'a325_m2'::JSONB) = '55000' AND pg_temp.a325_msg(:'a325_m2'::JSONB) LIKE 'receive_only%',
  'transport none: a staff reply in a WAHA chat is authorized and queued as always; in a Wazzup chat it is refused (the conversation''s channel): ' || :'a325_m1' || :'a325_m2');
-- An agent authorization made before the switch (a second WAHA chat), also queued.
SELECT pg_temp.a325_approved_draft(:'a325_cw2'::UUID, 'Одобренный до переключения') AS a325_d5 \gset
SELECT pg_temp.a325_authorize(:'a325_d5'::UUID) AS a325_au5 \gset
SELECT pg_temp.a325_assert((:'a325_au5'::JSONB ->> 'authorized') = 'true' AND (:'a325_au5'::JSONB ->> 'work_item_id') IS NOT NULL
  AND (SELECT status = 'sending' FROM platform_private.ai_agent_drafts WHERE id = :'a325_d5'::UUID),
  'transport none: an approved agent draft of a WAHA chat is authorized and queued as before: ' || :'a325_au5');
SELECT (:'a325_m1'::JSONB ->> 'work_item_id')::UUID AS a325_work1, (:'a325_au5'::JSONB ->> 'work_item_id')::UUID AS a325_work2 \gset
SELECT i.queue_message_id AS a325_qm1 FROM platform_private.durable_work_items i WHERE i.id = :'a325_work1'::UUID \gset
SELECT q.vt AS a325_vt1 FROM pgmq.q_platform_work_v1 q WHERE q.msg_id = :a325_qm1 \gset
-- The switch: the manual reply is refused before any authorization, the queued items are not claimed.
SELECT pg_temp.a325_cfg('wazzup') AS a325_c_w4 \gset
SELECT count(*) AS a325_auth_n FROM platform.manual_send_authorizations WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT pg_temp.a325_manual(:'a325_cw3'::UUID, 'Ответ после переключения', 3103) AS a325_m3 \gset
SELECT pg_temp.a325_manual(:'a325_cw1'::UUID, 'Ответ после переключения 2', 3104) AS a325_m4 \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_m3'::JSONB) = '55000' AND pg_temp.a325_msg(:'a325_m3'::JSONB) LIKE 'receive_only%'
  AND pg_temp.a325_err(:'a325_m4'::JSONB) = '55000' AND pg_temp.a325_msg(:'a325_m4'::JSONB) LIKE 'receive_only%'
  AND (SELECT count(*) = :a325_auth_n FROM platform.manual_send_authorizations WHERE organization_id = pg_temp.a325_id(1)),
  'transport wazzup: a staff reply in a WAHA chat (the session WORKING) is refused with receive_only before any authorization row: ' || :'a325_m3');
SELECT pg_temp.a325_svc(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, ''a325-worker'', %L)', pg_temp.a325_id(1), :'a325_work1', pg_temp.a325_id(4101))) AS a325_cl1 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, ''a325-worker'', %L)', pg_temp.a325_id(1), :'a325_work2', pg_temp.a325_id(4102))) AS a325_cl2 \gset
SELECT pg_temp.a325_assert((:'a325_cl1'::JSONB ->> 'claimed') = 'false' AND (SELECT count(*) = 3 FROM jsonb_object_keys(:'a325_cl1'::JSONB))
  AND (:'a325_cl1'::JSONB ->> 'queue') = 'platform_work_v1' AND (:'a325_cl1'::JSONB ->> 'requested_work_item_id') = :'a325_work1'
  AND (:'a325_cl2'::JSONB ->> 'claimed') = 'false' AND (SELECT count(*) = 3 FROM jsonb_object_keys(:'a325_cl2'::JSONB))
  AND (SELECT i.state = 'queued' AND i.attempt_count = 0 FROM platform_private.durable_work_items i WHERE i.id = :'a325_work1'::UUID)
  AND (SELECT i.state = 'queued' AND i.attempt_count = 0 FROM platform_private.durable_work_items i WHERE i.id = :'a325_work2'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.durable_work_attempts a WHERE a.work_item_id IN (:'a325_work1'::UUID, :'a325_work2'::UUID))
  AND (SELECT q.vt = :'a325_vt1'::TIMESTAMPTZ FROM pgmq.q_platform_work_v1 q WHERE q.msg_id = :a325_qm1),
  'transport wazzup: work authorized before the switch is not claimed (the answer is the usual "nothing to claim", exactly its three keys), its state, attempts and queue message are untouched: '
  || :'a325_cl1');
-- The control: the gate opens (transport none) and the very same item is claimed.
SELECT pg_temp.a325_cfg('none') AS a325_c_n3 \gset
SELECT pg_temp.a325_svc(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, ''a325-worker'', %L)', pg_temp.a325_id(1), :'a325_work1', pg_temp.a325_id(4103))) AS a325_cl3 \gset
SELECT pg_temp.a325_assert((:'a325_cl3'::JSONB ->> 'claimed') = 'true' AND (:'a325_cl3'::JSONB ->> 'work_item_id') = :'a325_work1'
  AND (:'a325_cl3'::JSONB ->> 'final_text') = 'Ответ сотрудника до переключения' AND (:'a325_cl3'::JSONB ->> 'waha_session_name') = 'crm_primary'
  AND (SELECT i.state = 'leased' AND i.attempt_count = 1 FROM platform_private.durable_work_items i WHERE i.id = :'a325_work1'::UUID),
  'transport none again: the same item is claimed exactly (the claim itself is unchanged): ' || (:'a325_cl3'::JSONB - 'final_text')::TEXT);
SELECT pg_temp.a325_cfg('wazzup', 'NULL', 'NULL') AS a325_c_w5 \gset
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE organization_id = pg_temp.a325_id(1);

-- ---------------------------------------------------------------------------
-- 8. The Gemini gates: a Wazzup conversation hands no text to Gemini until the owner says yes; a WAHA conversation is unchanged.
-- ---------------------------------------------------------------------------
UPDATE platform_private.ai_settings SET memory_enabled = TRUE WHERE organization_id = pg_temp.a325_id(1);
SELECT pg_temp.a325_cfg('wazzup', 'NULL', 'false') AS a325_g0 \gset
SELECT pg_temp.a325_assert((:'a325_g0'::JSONB ->> 'transport') = 'wazzup' AND (:'a325_g0'::JSONB ->> 'geminiEnabled') = 'false'
  AND platform_private.ai_memory_gate(pg_temp.a325_id(1)) AND NOT platform_private.whatsapp_gemini_allowed(pg_temp.a325_id(1), :'a325_ca'::UUID)
  AND platform_private.whatsapp_gemini_allowed(pg_temp.a325_id(1), :'a325_cw1'::UUID)
  AND NOT platform_private.whatsapp_gemini_allowed(pg_temp.a325_id(1), :'a325_camb'::UUID)
  AND NOT platform_private.whatsapp_send_allowed(pg_temp.a325_id(1), :'a325_ca'::UUID) AND NOT platform_private.whatsapp_send_allowed(pg_temp.a325_id(1), :'a325_cw1'::UUID)
  AND platform_private.whatsapp_send_allowed(pg_temp.a325_id(1), NULL) IS FALSE AND platform_private.whatsapp_send_allowed(pg_temp.a325_id(2), NULL),
  'the gates themselves: Gemini closed for a Wazzup conversation and open for a WAHA one; sending closed for both under wazzup (and for no conversation at all in that organization), open in another organization');
-- The poller: no pointer to a Wazzup message.
CREATE FUNCTION pg_temp.a325_poll() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_agent('SELECT platform_ai_agent.inbound_since_v1(''2000-01-01T00:00:00Z''::timestamptz, ''00000000-0000-0000-0000-000000000000''::uuid, 500)')
$$;
SELECT pg_temp.a325_poll() AS a325_poll1 \gset
SELECT pg_temp.a325_assert(NOT (:'a325_poll1'::JSONB ? 'error') AND jsonb_array_length(:'a325_poll1'::JSONB -> 'items') >= 3
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'a325_poll1'::JSONB -> 'items') i WHERE i ->> 'conversationId' = :'a325_cw1')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'a325_poll1'::JSONB -> 'items') i
      JOIN platform.communication_conversations c ON c.id = (i ->> 'conversationId')::UUID WHERE c.wazzup_channel_id IS NOT NULL),
  'P3 poller: the WAHA conversations are listed, no message of a Wazzup conversation is: ' || (SELECT count(*) FROM jsonb_array_elements(:'a325_poll1'::JSONB -> 'items'))::TEXT || ' items');
-- Memory: nothing is queued, claimed or read for a Wazzup chat.
SELECT platform_private.ai_memory_poke(:'a325_ca'::UUID, FALSE, 0) AS a325_mp_wz \gset
SELECT platform_private.ai_memory_poke(:'a325_cw1'::UUID, FALSE, 0) AS a325_mp_waha \gset
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.memory_context_v1(%L, ''a325-worker'', 120)', :'a325_ca')) AS a325_mc_wz \gset
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.memory_context_v1(%L, ''a325-worker'', 120)', :'a325_cw1')) AS a325_mc_waha \gset
SELECT pg_temp.a325_assert((:'a325_mp_wz'::JSONB ->> 'status') = 'skipped' AND (:'a325_mp_wz'::JSONB ->> 'reason') = 'wazzup_ai_off'
  AND COALESCE(:'a325_mp_waha'::JSONB ->> 'reason', '') <> 'wazzup_ai_off' AND (:'a325_mp_waha'::JSONB ->> 'status') <> 'skipped'
  AND (:'a325_mc_wz'::JSONB ->> 'status') = 'none' AND (:'a325_mc_wz'::JSONB ->> 'reason') = 'wazzup_ai_off' AND NOT (:'a325_mc_wz'::JSONB ? 'window')
  AND COALESCE(:'a325_mc_waha'::JSONB ->> 'reason', '') <> 'wazzup_ai_off'
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory m WHERE m.conversation_id = :'a325_ca'::UUID AND (m.enqueued_at IS NOT NULL OR m.lease_owner IS NOT NULL)),
  'P3 memory: a Wazzup chat is not queued (skipped, wazzup_ai_off), its claim reads nothing (none, wazzup_ai_off); the WAHA chat is unaffected: ' || :'a325_mp_wz' || :'a325_mc_wz');
-- The night summary: the Wazzup chat is left out.
CREATE TEMP TABLE a325_ids AS SELECT :'a325_ca'::UUID AS ca, :'a325_cw1'::UUID AS cw1;
CREATE FUNCTION pg_temp.a325_summary(p_status TEXT DEFAULT 'pending') RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO platform_private.ai_autosend_summaries (id, organization_id, interval_start, interval_end, shadow_night, counts, items, status)
  VALUES (v_id, pg_temp.a325_id(1), clock_timestamp() - INTERVAL '10 hours', clock_timestamp() - INTERVAL '1 hour', FALSE, '{}'::JSONB,
    jsonb_build_array(jsonb_build_object('conversationId', (SELECT ca FROM a325_ids)), jsonb_build_object('conversationId', (SELECT cw1 FROM a325_ids))), p_status);
  RETURN v_id;
END
$$;
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, ''a325-worker'', 120)', pg_temp.a325_summary())) AS a325_sm1 \gset
SELECT pg_temp.a325_assert((:'a325_sm1'::JSONB ->> 'status') = 'claimed' AND jsonb_array_length(:'a325_sm1'::JSONB -> 'chats') = 1
  AND (:'a325_sm1'::JSONB #>> '{chats,0,conversationId}') = :'a325_cw1',
  'P4 night summary: the Wazzup chat is not in the text handed to Gemini, the WAHA chat is: ' || (:'a325_sm1'::JSONB - 'models')::TEXT);
-- The window "help with the answer" (P1): no ticket, and an issued ticket stops working.
SELECT count(*) AS a325_tickets0 FROM platform_private.ai_tickets WHERE organization_id = pg_temp.a325_id(1) \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)', pg_temp.a325_id(1), :'a325_ca')) AS a325_tk_wz \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)', pg_temp.a325_id(1), :'a325_cw1')) AS a325_tk_waha \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_tk_wz'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_tk_wz'::JSONB) = 'wazzup_ai_off'
  AND (:'a325_tk_waha'::JSONB ->> 'ticket') ~ '^[0-9a-f]{64}$'
  AND (SELECT count(*) = :a325_tickets0 + 1 FROM platform_private.ai_tickets WHERE organization_id = pg_temp.a325_id(1)),
  'P1 window: a Wazzup chat gets no ticket (wazzup_ai_off, no ticket row, the quota is not spent); a WAHA chat does: ' || :'a325_tk_wz');
CREATE FUNCTION pg_temp.a325_ticket_ok(p_conv UUID) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT platform_private.ai_ticket_allowed(jsonb_populate_record(NULL::platform_private.ai_tickets, jsonb_build_object('token_sha256', repeat('a', 64),
    'organization_id', pg_temp.a325_id(1), 'membership_id', pg_temp.a325_id(301), 'purpose', 'answer', 'conversation_id', p_conv,
    'issued_at', clock_timestamp(), 'expires_at', clock_timestamp() + INTERVAL '1 minute')))
$$;
SELECT pg_temp.a325_assert(NOT pg_temp.a325_ticket_ok(:'a325_ca'::UUID) AND pg_temp.a325_ticket_ok(:'a325_cw1'::UUID)
  AND (SELECT NOT platform_private.ai_ticket_allowed(jsonb_populate_record(NULL::platform_private.ai_tickets, jsonb_build_object('token_sha256', repeat('a', 64),
    'organization_id', pg_temp.a325_id(1), 'membership_id', pg_temp.a325_id(301), 'purpose', 'answer', 'conversation_id', NULL,
    'issued_at', clock_timestamp(), 'expires_at', clock_timestamp() + INTERVAL '1 minute')))),
  'P1: an already issued ticket of a Wazzup chat is not honoured (the live check), a WAHA one is');
-- U9 (066), the legacy proposals: the staff request and the service context are refused for a Wazzup chat, a WAHA chat is unchanged.
CREATE FUNCTION pg_temp.a325_u9_request(p_conv UUID, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_as(1, format('SELECT to_jsonb(r) FROM platform.request_gemini_proposal(%L, %L, %L, %L, ''gemini-3.7-flash'', 2, ''u9-gemini-human-review-v1'', ''A325 check'') r',
    pg_temp.a325_id(1), p_conv, platform_private.ai_latest_inbound(pg_temp.a325_id(1), p_conv), pg_temp.a325_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a325_u9_begin(p_conv UUID, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT to_jsonb(b) FROM platform.begin_gemini_proposal(%L, %L, %L, %L, ''gemini-3.7-flash'', 2, ''u9-gemini-human-review-v1'') b',
    pg_temp.a325_id(1), p_conv, platform_private.ai_latest_inbound(pg_temp.a325_id(1), p_conv), pg_temp.a325_id(p_req)))
$$;
SELECT pg_temp.a325_u9_request(:'a325_ca'::UUID, 9101) AS a325_u9_r_wz, pg_temp.a325_u9_begin(:'a325_ca'::UUID, 9101) AS a325_u9_b_wz \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_u9_r_wz'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_u9_r_wz'::JSONB) = 'wazzup_ai_off'
  AND pg_temp.a325_err(:'a325_u9_b_wz'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_u9_b_wz'::JSONB) = 'wazzup_ai_off'
  AND NOT EXISTS (SELECT 1 FROM platform_private.gemini_proposal_request_receipts WHERE organization_id = pg_temp.a325_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform_private.gemini_proposal_requests WHERE organization_id = pg_temp.a325_id(1)),
  'U9: a Wazzup chat gets no proposal request and the service gets no message text (wazzup_ai_off), nothing is stored: ' || :'a325_u9_r_wz' || :'a325_u9_b_wz');
SELECT pg_temp.a325_u9_request(:'a325_cw1'::UUID, 9102) AS a325_u9_r_waha \gset
SELECT pg_temp.a325_u9_begin(:'a325_cw1'::UUID, 9102) AS a325_u9_b_waha \gset
SELECT pg_temp.a325_assert(NOT (:'a325_u9_r_waha'::JSONB ? 'error') AND NOT (:'a325_u9_b_waha'::JSONB ? 'error')
  AND (SELECT count(*) = 1 FROM platform_private.gemini_proposal_request_receipts WHERE organization_id = pg_temp.a325_id(1)),
  'U9: a WAHA chat is unchanged: the request is taken and the service gets the context: ' || :'a325_u9_r_waha' || left(:'a325_u9_b_waha', 120));

-- The owner says yes: the same paths open for the Wazzup chat (sending stays closed - checked in section 7).
SELECT pg_temp.a325_cfg('wazzup', 'NULL', 'true') AS a325_g1 \gset
SELECT pg_temp.a325_poll() AS a325_poll2 \gset
SELECT platform_private.ai_memory_poke(:'a325_ca'::UUID, FALSE, 0) AS a325_mp_wz2 \gset
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.memory_context_v1(%L, ''a325-worker'', 120)', :'a325_ca')) AS a325_mc_wz2 \gset
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, ''a325-worker'', 120)', pg_temp.a325_summary())) AS a325_sm2 \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)', pg_temp.a325_id(1), :'a325_ca')) AS a325_tk_wz2 \gset
SELECT pg_temp.a325_assert((:'a325_g1'::JSONB ->> 'geminiEnabled') = 'true' AND pg_temp.a325_ticket_ok(:'a325_ca'::UUID)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(:'a325_poll2'::JSONB -> 'items') i
      JOIN platform.communication_conversations c ON c.id = (i ->> 'conversationId')::UUID WHERE c.wazzup_channel_id IS NOT NULL)
  AND COALESCE(:'a325_mp_wz2'::JSONB ->> 'reason', '') <> 'wazzup_ai_off' AND COALESCE(:'a325_mc_wz2'::JSONB ->> 'reason', '') <> 'wazzup_ai_off'
  AND jsonb_array_length(:'a325_sm2'::JSONB -> 'chats') = 2 AND (:'a325_tk_wz2'::JSONB ->> 'ticket') ~ '^[0-9a-f]{64}$',
  'with gemini_enabled = true (an operator command, no release) the poller, the memory, the night summary and the window open for Wazzup chats');
-- ... but the conversation whose client is unresolved (two clients on one number) stays closed to Gemini on every path, flag on: the
-- 320 consent check treats it as "no student, allowed", so this is the gate's own refusal.
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.memory_context_v1(%L, ''a325-worker'', 120)', :'a325_camb')) AS a325_mc_amb \gset
SELECT platform_private.ai_memory_poke(:'a325_camb'::UUID, FALSE, 0) AS a325_mp_amb \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)', pg_temp.a325_id(1), :'a325_camb')) AS a325_tk_amb \gset
SELECT pg_temp.a325_u9_request(:'a325_camb'::UUID, 9104) AS a325_u9_r_amb, pg_temp.a325_u9_begin(:'a325_camb'::UUID, 9104) AS a325_u9_b_amb \gset
CREATE TEMP TABLE a325_ids_amb AS SELECT :'a325_camb'::UUID AS camb;
CREATE FUNCTION pg_temp.a325_summary_amb() RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO platform_private.ai_autosend_summaries (id, organization_id, interval_start, interval_end, shadow_night, counts, items, status)
  VALUES (v_id, pg_temp.a325_id(1), clock_timestamp() - INTERVAL '10 hours', clock_timestamp() - INTERVAL '1 hour', FALSE, '{}'::JSONB,
    jsonb_build_array(jsonb_build_object('conversationId', (SELECT camb FROM a325_ids_amb)), jsonb_build_object('conversationId', (SELECT ca FROM a325_ids))), 'pending');
  RETURN v_id;
END
$$;
SELECT pg_temp.a325_agent(format('SELECT platform_ai_agent.autosend_summary_context_v1(%L, ''a325-worker'', 120)', pg_temp.a325_summary_amb())) AS a325_sm_amb \gset
SELECT pg_temp.a325_assert(NOT platform_private.whatsapp_gemini_allowed(pg_temp.a325_id(1), :'a325_camb'::UUID)
  AND platform_private.ai_agent_conversation_ai_allowed(pg_temp.a325_id(1), :'a325_camb'::UUID)
  AND NOT pg_temp.a325_ticket_ok(:'a325_camb'::UUID)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'a325_poll2'::JSONB -> 'items') i WHERE (i ->> 'conversationId')::UUID = :'a325_camb'::UUID)
  AND (:'a325_mp_amb'::JSONB ->> 'status') = 'skipped' AND (:'a325_mp_amb'::JSONB ->> 'reason') = 'wazzup_ai_off'
  AND (:'a325_mc_amb'::JSONB ->> 'status') = 'none' AND (:'a325_mc_amb'::JSONB ->> 'reason') = 'wazzup_ai_off' AND NOT (:'a325_mc_amb'::JSONB ? 'window')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory m WHERE m.conversation_id = :'a325_camb'::UUID AND (m.enqueued_at IS NOT NULL OR m.lease_owner IS NOT NULL))
  AND pg_temp.a325_err(:'a325_tk_amb'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_tk_amb'::JSONB) = 'wazzup_ai_off'
  AND pg_temp.a325_err(:'a325_u9_r_amb'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_u9_r_amb'::JSONB) = 'wazzup_ai_off'
  AND pg_temp.a325_err(:'a325_u9_b_amb'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_u9_b_amb'::JSONB) = 'wazzup_ai_off'
  AND jsonb_array_length(:'a325_sm_amb'::JSONB -> 'chats') = 1 AND (:'a325_sm_amb'::JSONB #>> '{chats,0,conversationId}') = :'a325_ca'
  AND NOT (:'a325_sm_amb'::TEXT LIKE '%Один номер на двоих%'),
  'with the Gemini flag on the ambiguous conversation (two clients on one number) is STILL closed to Gemini: no poller pointer, no queued memory, no claimed window, no ticket (and a live ticket is not honoured), no U9 context, not in the night summary - while the 320 consent check alone would allow it: ' || :'a325_mc_amb' || :'a325_tk_amb');
SELECT pg_temp.a325_u9_request(:'a325_ca'::UUID, 9103) AS a325_u9_r_wz2, pg_temp.a325_u9_begin(:'a325_ca'::UUID, 9103) AS a325_u9_b_wz2 \gset
SELECT pg_temp.a325_assert(NOT (:'a325_u9_r_wz2'::JSONB ? 'error') AND NOT (:'a325_u9_b_wz2'::JSONB ? 'error'),
  'U9: with the Gemini flag on the Wazzup chat is taken like a WAHA one: ' || :'a325_u9_r_wz2' || left(:'a325_u9_b_wz2', 120));
SELECT pg_temp.a325_cfg('wazzup', 'NULL', 'false') AS a325_g2 \gset
SELECT pg_temp.a325_u9_begin(:'a325_ca'::UUID, 9103) AS a325_u9_replay \gset
SELECT pg_temp.a325_assert(pg_temp.a325_err(:'a325_u9_replay'::JSONB) = '42501' AND pg_temp.a325_msg(:'a325_u9_replay'::JSONB) = 'wazzup_ai_off',
  'U9: switching the flag off stops even the replay of a stored context: ' || :'a325_u9_replay');

-- ---------------------------------------------------------------------------
-- 9. What the agent reads: receive_only, can_reply, the answer for an unknown channel state is unchanged without Wazzup.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_get(:'a325_cw1'::UUID) AS a325_r_waha_wz, pg_temp.a325_get(:'a325_ca'::UUID) AS a325_r_wz_wz \gset
SELECT pg_temp.a325_cfg('none') AS a325_r0 \gset
SELECT pg_temp.a325_get(:'a325_cw1'::UUID) AS a325_r_waha_up, pg_temp.a325_get(:'a325_ca'::UUID) AS a325_r_wz_none \gset
SELECT pg_temp.a325_health(NULL);
SELECT pg_temp.a325_get(:'a325_cw1'::UUID) AS a325_r_waha_unknown \gset
SELECT pg_temp.a325_health('FAILED');
SELECT pg_temp.a325_get(:'a325_cw1'::UUID) AS a325_r_waha_down \gset
SELECT pg_temp.a325_health('WORKING');
SELECT pg_temp.a325_cfg('wazzup') AS a325_r1 \gset
SELECT pg_temp.a325_assert(
  (:'a325_r_waha_wz'::JSONB #>> '{conversation,whatsapp_state}') = 'receive_only' AND (:'a325_r_waha_wz'::JSONB ->> 'can_reply') = 'false'
  AND (:'a325_r_wz_wz'::JSONB #>> '{conversation,whatsapp_state}') = 'receive_only' AND (:'a325_r_wz_wz'::JSONB ->> 'can_reply') = 'false'
  AND (:'a325_r_waha_up'::JSONB #>> '{conversation,whatsapp_state}') = 'connected' AND (:'a325_r_waha_up'::JSONB ->> 'can_reply') = 'true'
  AND (:'a325_r_wz_none'::JSONB #>> '{conversation,whatsapp_state}') = 'receive_only' AND (:'a325_r_wz_none'::JSONB ->> 'can_reply') = 'false'
  AND (:'a325_r_waha_unknown'::JSONB #>> '{conversation,whatsapp_state}') = 'unknown' AND (:'a325_r_waha_unknown'::JSONB ->> 'can_reply') = 'true'
  AND (:'a325_r_waha_down'::JSONB #>> '{conversation,whatsapp_state}') = 'disconnected' AND (:'a325_r_waha_down'::JSONB ->> 'can_reply') = 'false',
  'get_conversation: under wazzup both kinds of chat are receive_only with can_reply = false; a Wazzup chat stays so without the path; a WAHA chat reads connected / unknown / disconnected as before');

-- ---------------------------------------------------------------------------
-- 10. The connection alert (321) for the wazzup session.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a325_wh(p_fn TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a325_svc(format('SELECT platform.%s(%L, %s)', p_fn, pg_temp.a325_id(1), p_args))
$$;
CREATE FUNCTION pg_temp.a325_wh_tasks(p_alert UUID) RETURNS TABLE (title TEXT, description TEXT, priority TEXT, status TEXT) LANGUAGE SQL STABLE AS $$
  SELECT t.title, t.description, t.priority::TEXT, t.status::TEXT FROM platform.staff_tasks t
  WHERE t.id IN (SELECT unnest(a.task_ids) FROM platform_private.whatsapp_health_alerts a WHERE a.id = p_alert)
$$;
SELECT pg_temp.a325_wh('whatsapp_health_observe_v1', '''wazzup'', ''WORKING'', false, false') AS a325_h1 \gset
SELECT pg_temp.a325_wh('whatsapp_health_observe_v1', '''other'', ''WORKING'', false, false') AS a325_h2 \gset
SELECT pg_temp.a325_wh('whatsapp_health_read_v1', '''wazzup''') AS a325_h3 \gset
SELECT pg_temp.a325_assert(NOT (:'a325_h1'::JSONB ? 'error') AND pg_temp.a325_err(:'a325_h2'::JSONB) = '22023'
  AND (:'a325_h3'::JSONB #>> '{monitor,lastStatus}') = 'WORKING' AND (:'a325_h3'::JSONB -> 'gap') = 'null'::JSONB
  AND (:'a325_h3'::JSONB -> 'disconnected') = 'null'::JSONB AND (:'a325_h3'::JSONB -> 'silent') = 'null'::JSONB
  AND (SELECT count(*) = 1 FROM platform_private.whatsapp_health_monitor WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'wazzup')
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_monitor WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'crm_primary'),
  'the wazzup session is observed in its own series (321 guard); an unknown session is still 22023; the read carries the new gap field: ' || :'a325_h3');
-- The last customer inbound of Wazzup: the newest verified `message` event with isEcho = false inside 30 days.
SELECT max(e.received_at) AS a325_last_in FROM platform_private.provider_webhook_events e WHERE e.organization_id = pg_temp.a325_id(1)
  AND e.provider = 'wazzup' AND e.event_type = 'message' AND e.verification_status = 'verified' AND e.raw_payload ->> 'isEcho' = 'false' \gset
SELECT max(e.received_at) AS a325_last_any FROM platform_private.provider_webhook_events e WHERE e.organization_id = pg_temp.a325_id(1)
  AND e.provider = 'wazzup' \gset
SELECT pg_temp.a325_assert(:'a325_last_in' IS NOT NULL AND (:'a325_h3'::JSONB ->> 'lastInboundAt')::TIMESTAMPTZ = :'a325_last_in'::TIMESTAMPTZ
  AND (SELECT count(*) > 0 FROM platform_private.provider_webhook_events e WHERE e.organization_id = pg_temp.a325_id(1) AND e.provider = 'wazzup'
      AND (e.event_type <> 'message' OR e.raw_payload ->> 'isEcho' = 'true')),
  'the last inbound of the wazzup session is the newest message event with isEcho = false (edits, deletions, states and echoes do not count)');
INSERT INTO platform_private.provider_webhook_events (organization_id, provider, provider_account_ref, provider_event_variant_ref, provider_request_id, payload_id,
  event_type, provider_occurred_at, verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id, received_at)
VALUES
  (pg_temp.a325_id(2), 'wazzup', 'wazzup:' || pg_temp.a325_id(9002)::TEXT, NULL, 'message:old-in', 'old-in', 'message', clock_timestamp() - INTERVAL '31 days', 'verified',
    '{"isEcho": false}', '{}', 'synthetic:a325', repeat('a', 64), gen_random_uuid(), clock_timestamp() - INTERVAL '31 days'),
  (pg_temp.a325_id(2), 'wazzup', 'wazzup:' || pg_temp.a325_id(9002)::TEXT, NULL, 'message:old-echo', 'old-echo', 'message', clock_timestamp() - INTERVAL '1 day', 'verified',
    '{"isEcho": true}', '{}', 'synthetic:a325', repeat('a', 64), gen_random_uuid(), clock_timestamp() - INTERVAL '1 day');
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''wazzup'')', pg_temp.a325_id(2))) AS a325_h4 \gset
INSERT INTO platform_private.provider_webhook_events (organization_id, provider, provider_account_ref, provider_event_variant_ref, provider_request_id, payload_id,
  event_type, provider_occurred_at, verification_status, raw_payload, verification_headers, verification_evidence_ref, payload_sha256, request_id, received_at)
VALUES (pg_temp.a325_id(2), 'wazzup', 'wazzup:' || pg_temp.a325_id(9002)::TEXT, NULL, 'message:new-in', 'new-in', 'message', clock_timestamp() - INTERVAL '29 days', 'verified',
  '{"isEcho": false}', '{}', 'synthetic:a325', repeat('a', 64), gen_random_uuid(), clock_timestamp() - INTERVAL '29 days');
SELECT pg_temp.a325_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''wazzup'')', pg_temp.a325_id(2))) AS a325_h5 \gset
SELECT pg_temp.a325_assert((:'a325_h4'::JSONB -> 'lastInboundAt') = 'null'::JSONB AND (:'a325_h5'::JSONB ->> 'lastInboundAt') IS NOT NULL
  AND (:'a325_h5'::JSONB ->> 'lastInboundAt')::TIMESTAMPTZ BETWEEN clock_timestamp() - INTERVAL '29 days 1 minute' AND clock_timestamp() - INTERVAL '28 days 23 hours'
  AND (pg_temp.a325_svc(format('SELECT platform.whatsapp_health_read_v1(%L, ''wazzup'')', pg_temp.a325_id(1))) ->> 'lastInboundAt')::TIMESTAMPTZ = :'a325_last_in'::TIMESTAMPTZ,
  'the 30-day window and the organization bound: a 31-day-old inbound and an echo do not count, a 29-day-old one does, another organization''s events never reach this one');
SELECT (pg_temp.a325_wh('whatsapp_health_read_v1', '''crm_primary''') ->> 'lastInboundAt') IS NOT NULL AS a325_h6 \gset
SELECT pg_temp.a325_assert(:'a325_h6'::BOOLEAN, 'the crm_primary read still takes its last inbound from the WAHA message.any events');

-- Open: the wazzup words by kind and status; one open alert per kind; the same behaviour of the old kinds for crm_primary.
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''wazzup'', ''disconnected'', ''PHONE_UNAVAILABLE'', NULL') AS a325_o1 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''wazzup'', ''disconnected'', ''PHONE_UNAVAILABLE'', NULL') AS a325_o1b \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''wazzup'', ''silent'', ''WORKING'', NULL') AS a325_o2 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''wazzup'', ''gap'', ''COUNTS_MISMATCH'', NULL') AS a325_o3 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''crm_primary'', ''gap'', ''COUNTS_MISMATCH'', NULL') AS a325_o4 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''wazzup'', ''other'', ''WORKING'', NULL') AS a325_o5 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''crm_primary'', ''disconnected'', ''FAILED'', NULL') AS a325_o6 \gset
SELECT pg_temp.a325_wh('whatsapp_health_open_v1', '''crm_primary'', ''silent'', ''WORKING'', NULL') AS a325_o7 \gset
SELECT pg_temp.a325_assert((:'a325_o1'::JSONB ->> 'opened') = 'true' AND (:'a325_o1'::JSONB ->> 'tasks') = '1'
  AND (:'a325_o1b'::JSONB ->> 'opened') = 'false' AND (:'a325_o1b'::JSONB ->> 'reason') = 'already_open'
  AND (:'a325_o2'::JSONB ->> 'opened') = 'true' AND (:'a325_o3'::JSONB ->> 'opened') = 'true'
  AND pg_temp.a325_err(:'a325_o4'::JSONB) = '22023' AND pg_temp.a325_err(:'a325_o5'::JSONB) = '22023'
  AND (:'a325_o6'::JSONB ->> 'opened') = 'true' AND (:'a325_o7'::JSONB ->> 'opened') = 'true'
  AND (SELECT count(*) = 3 FROM platform_private.whatsapp_health_alerts WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'wazzup' AND resolved_at IS NULL)
  AND (SELECT count(*) = 2 FROM platform_private.whatsapp_health_alerts WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'crm_primary' AND resolved_at IS NULL),
  'wazzup alerts: disconnected, silent and gap are each opened once (a repeat is already_open); gap is refused for crm_primary and an unknown kind everywhere (22023); crm_primary opens its two kinds as before: '
  || :'a325_o1' || :'a325_o4');
SELECT a.id AS a325_al_dis FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a325_id(1) AND a.session_name = 'wazzup' AND a.kind = 'disconnected' AND a.resolved_at IS NULL \gset
SELECT a.id AS a325_al_sil FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a325_id(1) AND a.session_name = 'wazzup' AND a.kind = 'silent' AND a.resolved_at IS NULL \gset
SELECT a.id AS a325_al_gap FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a325_id(1) AND a.session_name = 'wazzup' AND a.kind = 'gap' AND a.resolved_at IS NULL \gset
SELECT a.id AS a325_al_crm FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a325_id(1) AND a.session_name = 'crm_primary' AND a.kind = 'disconnected' AND a.resolved_at IS NULL \gset
SELECT a.id AS a325_al_crm_s FROM platform_private.whatsapp_health_alerts a WHERE a.organization_id = pg_temp.a325_id(1) AND a.session_name = 'crm_primary' AND a.kind = 'silent' AND a.resolved_at IS NULL \gset
SELECT pg_temp.a325_assert(
  (SELECT t.title = 'WhatsApp через Wazzup отключён — проверьте канал' AND t.priority = 'urgent' AND t.status = 'open'
      AND t.description LIKE '%через Wazzup%' AND t.description LIKE '%телефон продаж не на связи%' AND t.description LIKE '%кабинет Wazzup%'
      AND t.description NOT LIKE '%WAHA%' AND t.description !~ '[0-9]{4,}' FROM pg_temp.a325_wh_tasks(:'a325_al_dis'::UUID) t)
  AND (SELECT t.title = 'WhatsApp через Wazzup молчит 3 часа в рабочее время — проверьте подключение' AND t.priority = 'high'
      AND t.description LIKE '%Wazzup%' AND t.description NOT LIKE '%WAHA%' AND t.description LIKE '%3 рабочих часа%' FROM pg_temp.a325_wh_tasks(:'a325_al_sil'::UUID) t)
  AND (SELECT t.title = 'В EVO меньше входящих WhatsApp, чем в amoCRM — проверьте приём' AND t.priority = 'high'
      AND t.description LIKE '%сверка%' AND t.description NOT LIKE '%WAHA%' AND t.description !~ '[0-9]{4,}' FROM pg_temp.a325_wh_tasks(:'a325_al_gap'::UUID) t)
  AND (SELECT t.title = platform_private.whatsapp_health_title('disconnected', 'FAILED') AND t.description = platform_private.whatsapp_health_text('disconnected', 'FAILED')
      AND t.description LIKE '%сессия остановилась с ошибкой%' FROM pg_temp.a325_wh_tasks(:'a325_al_crm'::UUID) t)
  AND (SELECT t.title = platform_private.whatsapp_health_title('silent', 'WORKING') AND t.description = platform_private.whatsapp_health_text('silent', 'WORKING')
      AND t.priority = 'high' FROM pg_temp.a325_wh_tasks(:'a325_al_crm_s'::UUID) t),
  'the task words: wazzup has its own for each kind and status (no WAHA, no number), crm_primary gets exactly the 321 words');
SELECT pg_temp.a325_assert(
  (SELECT bool_and(platform_private.whatsapp_alert_text_for('wazzup', 'disconnected', s) !~ '[0-9]{4,}' AND platform_private.whatsapp_alert_text_for('wazzup', 'disconnected', s) NOT LIKE '%WAHA%'
      AND platform_private.whatsapp_alert_title_for('wazzup', 'disconnected', s) LIKE 'WhatsApp через Wazzup%')
   FROM unnest(ARRAY['PHONE_UNAVAILABLE', 'SCAN_QR_CODE', 'OPEN_ELSEWHERE', 'NOT_PAID', 'UNAUTHORIZED', 'DISABLED', 'FOREIGN_PHONE', 'WAIT_FOR_PASSWORD', 'BLOCKED',
     'ON_MODERATION', 'REJECTED', 'STARTING', 'CHANNEL_MISSING', 'KEY_REJECTED', 'UNREACHABLE', 'SOMETHING_NEW']) s)
  AND platform_private.whatsapp_alert_text_for('wazzup', 'disconnected', 'NOT_PAID') LIKE '%не оплачен%'
  AND platform_private.whatsapp_alert_title_for('wazzup', 'disconnected', 'KEY_REJECTED') LIKE '%сообщите техническому администратору'
  AND platform_private.whatsapp_alert_text_for('crm_primary', 'disconnected', 'FAILED') = platform_private.whatsapp_health_text('disconnected', 'FAILED'),
  'every Wazzup status word has words in Russian and none carries a long number; an unknown word still gets a sentence');
-- Resolve: the new reasons; a task the alert opened is closed with its event and journal row.
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''wazzup'', ''gap'', ''counts_match''') AS a325_r1 \gset
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''wazzup'', ''silent'', ''messages_arrived''') AS a325_r2 \gset
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''wazzup'', ''gap'', ''counts_match''') AS a325_r3 \gset
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''wazzup'', ''disconnected'', ''because''') AS a325_r4 \gset
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''wazzup'', ''nothing'', ''counts_match''') AS a325_r5 \gset
SELECT pg_temp.a325_wh('whatsapp_health_resolve_v1', '''crm_primary'', ''gap'', ''counts_match''') AS a325_r6 \gset
SELECT pg_temp.a325_assert((:'a325_r1'::JSONB ->> 'resolved') = 'true' AND (:'a325_r1'::JSONB ->> 'tasksClosed') = '1'
  AND (:'a325_r2'::JSONB ->> 'resolved') = 'true' AND (:'a325_r3'::JSONB ->> 'resolved') = 'false'
  AND pg_temp.a325_err(:'a325_r4'::JSONB) = '22023' AND pg_temp.a325_err(:'a325_r5'::JSONB) = '22023' AND (:'a325_r6'::JSONB ->> 'resolved') = 'false'
  AND (SELECT a.resolved_reason = 'counts_match' FROM platform_private.whatsapp_health_alerts a WHERE a.id = :'a325_al_gap'::UUID)
  AND (SELECT a.resolved_reason = 'messages_arrived' FROM platform_private.whatsapp_health_alerts a WHERE a.id = :'a325_al_sil'::UUID)
  AND (SELECT t.status = 'done' FROM pg_temp.a325_wh_tasks(:'a325_al_gap'::UUID) t)
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a325_id(1) AND e.action = 'staff.task.status' AND e.reason = 'WhatsApp: задача закрыта автоматически'
      AND e.after_state ->> 'kind' = 'gap' AND e.after_state ->> 'reason' = 'counts_match')
  AND (SELECT count(*) = 1 FROM platform_private.whatsapp_health_alerts WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'wazzup' AND resolved_at IS NULL AND kind = 'disconnected'),
  'resolve: counts_match closes a gap alert and its task (journal row included), messages_arrived the silent one; a second resolve finds nothing; a bad reason or kind is 22023; gap on crm_primary finds nothing');
-- Switching the transport closes the alerts nobody checks any more.
SELECT pg_temp.a325_cfg('none') AS a325_sw1 \gset
SELECT pg_temp.a325_assert((:'a325_sw1'::JSONB ->> 'closedAlerts') = '1'
  AND (SELECT a.resolved_reason = 'transport_switched' FROM platform_private.whatsapp_health_alerts a WHERE a.id = :'a325_al_dis'::UUID)
  AND (SELECT t.status = 'done' FROM pg_temp.a325_wh_tasks(:'a325_al_dis'::UUID) t)
  AND (SELECT count(*) = 2 FROM platform_private.whatsapp_health_alerts WHERE organization_id = pg_temp.a325_id(1) AND session_name = 'crm_primary' AND resolved_at IS NULL),
  'leaving wazzup closes the open wazzup alert (transport_switched, its task done); the crm_primary alerts stay open: ' || :'a325_sw1');
SELECT pg_temp.a325_cfg('wazzup') AS a325_sw2 \gset
SELECT pg_temp.a325_assert((:'a325_sw2'::JSONB ->> 'closedAlerts') = '2'
  AND (SELECT count(*) = 2 AND bool_and(a.resolved_reason = 'transport_switched') FROM platform_private.whatsapp_health_alerts a
      WHERE a.id IN (:'a325_al_crm'::UUID, :'a325_al_crm_s'::UUID))
  AND (SELECT bool_and(t.status = 'done') FROM pg_temp.a325_wh_tasks(:'a325_al_crm'::UUID) t)
  AND (SELECT bool_and(t.status = 'done') FROM pg_temp.a325_wh_tasks(:'a325_al_crm_s'::UUID) t)
  AND NOT EXISTS (SELECT 1 FROM platform_private.whatsapp_health_alerts WHERE organization_id = pg_temp.a325_id(1) AND resolved_at IS NULL)
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a325_id(1) AND e.action = 'staff.task.status' AND e.after_state ->> 'reason' = 'transport_switched'
      AND e.after_state ->> 'alertId' IN (:'a325_al_crm', :'a325_al_crm_s')),
  'switching to wazzup closes the open crm_primary alerts (the stuck FAILED session of the old path) with their tasks and journal rows: ' || :'a325_sw2');
SELECT pg_temp.a325_cfg('wazzup') AS a325_sw3 \gset
SELECT pg_temp.a325_assert((:'a325_sw3'::JSONB ->> 'closedAlerts') = '0', 'a switch that changes nothing closes nothing');

-- ---------------------------------------------------------------------------
-- 11. The name and number in the chat list (278), the staff transport read, the hidden origin.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a325_ingest(jsonb_build_array(pg_temp.a325_msg('g-5d', '996000000405', 'Имя из профиля Wazzup', 520, FALSE, '{"contact": {"name": "Тёзка Wazzup"}}'),
  pg_temp.a325_msg('g-2b', '996000000402', 'Ещё одно сообщение', 521, FALSE, '{"contact": {"name": "996000000402"}}'))) AS a325_sn \gset
SELECT pg_temp.a325_conv('996000000402') AS a325_cs2 \gset
SELECT pg_temp.a325_as(1, format('SELECT jsonb_agg(to_jsonb(c)) FROM platform.staff_whatsapp_contacts(%L, ARRAY[%L, %L, %L, %L, %L]::uuid[]) c', pg_temp.a325_id(1),
  :'a325_ca', :'a325_cb', :'a325_camb', :'a325_cw1', :'a325_cs1')) AS a325_names \gset
SELECT pg_temp.a325_assert(
  (SELECT x ->> 'contact_name' = 'Бекзат' AND x ->> 'contact_phone' = platform_private.whatsapp_masked_phone('996000000201')
      FROM jsonb_array_elements(:'a325_names'::JSONB) x WHERE x ->> 'conversation_id' = :'a325_ca')
  AND (SELECT x ->> 'contact_name' = 'Тёзка Wazzup' AND x ->> 'contact_phone' = platform_private.whatsapp_masked_phone('996000000405')
      FROM jsonb_array_elements(:'a325_names'::JSONB) x WHERE x ->> 'conversation_id' = :'a325_camb')
  AND (SELECT (x -> 'contact_name') = 'null'::JSONB AND x ->> 'contact_phone' = platform_private.whatsapp_masked_phone('996000000202')
      FROM jsonb_array_elements(:'a325_names'::JSONB) x WHERE x ->> 'conversation_id' = :'a325_cb')
  AND (SELECT x ->> 'contact_phone' IS NOT NULL FROM jsonb_array_elements(:'a325_names'::JSONB) x WHERE x ->> 'conversation_id' = :'a325_cw1')
  AND (SELECT x ->> 'contact_name' = 'A325 Студент Один' OR x ->> 'contact_name' IS NULL FROM jsonb_array_elements(:'a325_names'::JSONB) x WHERE x ->> 'conversation_id' = :'a325_cs1')
  AND NOT (:'a325_names'::TEXT ~ '99600000[0-9]{4}'),
  'the chat list: a Wazzup chat gets its client''s name (for a reader of the client) or the profile name from Wazzup, a placeholder client and a number-only profile name give no name, the number is masked: '
  || :'a325_names');
SELECT pg_temp.a325_assert((SELECT cl.display_name = 'A325 Клиент Два' FROM platform.clients cl WHERE cl.id = pg_temp.a325_id(502))
  AND (SELECT count(*) = 2 FROM pg_temp.a325_msgs(:'a325_cs2'::UUID)),
  'a matched client keeps its own name: the profile name of a matched number does not rename it');
-- The staff read of the path.
SELECT pg_temp.a325_persist(jsonb_build_array(jsonb_build_object('kind', 'channel', 'element',
  jsonb_build_object('channelId', pg_temp.a325_channel()::TEXT, 'state', 'phoneUnavailable', 'timestamp', 9)))) AS a325_pch \gset
SELECT pg_temp.a325_sweep() AS a325_sch \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1))) AS a325_tr1 \gset
SELECT pg_temp.a325_cfg('none') AS a325_sw4 \gset
SELECT pg_temp.a325_as(1, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(1))) AS a325_tr2 \gset
SELECT pg_temp.a325_as(3, format('SELECT platform.staff_whatsapp_transport_v1(%L)', pg_temp.a325_id(2))) AS a325_tr3 \gset
SELECT pg_temp.a325_cfg('wazzup') AS a325_sw5 \gset
SELECT pg_temp.a325_assert((:'a325_tr1'::JSONB ->> 'activeTransport') = 'wazzup' AND (:'a325_tr1'::JSONB ->> 'canReply') = 'false'
  AND (:'a325_tr1'::JSONB ->> 'replyMode') = 'receive_only' AND (:'a325_tr1'::JSONB #>> '{channel,state}') = 'phoneUnavailable'
  AND (:'a325_tr1'::JSONB #>> '{channel,transport}') = 'whatsapp' AND (:'a325_tr1'::JSONB #>> '{channel,observedAt}') IS NOT NULL
  AND (:'a325_tr1'::JSONB ->> 'lastInboundAt') IS NOT NULL
  AND (:'a325_tr1'::JSONB - ARRAY['activeTransport', 'canReply', 'replyMode', 'channel', 'lastInboundAt']) = '{}'::JSONB
  AND (:'a325_tr1'::JSONB -> 'channel') - ARRAY['transport', 'state', 'observedAt', 'last4'] = '{}'::JSONB -- last4: migration 326, absent at the 325 boundary
  AND (:'a325_tr2'::JSONB ->> 'activeTransport') = 'none' AND (:'a325_tr2'::JSONB ->> 'canReply') = 'true' AND (:'a325_tr2'::JSONB ->> 'replyMode') = 'waha'
  AND (:'a325_tr2'::JSONB -> 'lastInboundAt') = 'null'::JSONB
  AND pg_temp.a325_err(:'a325_tr3'::JSONB) IS NULL AND (:'a325_tr3'::JSONB ->> 'activeTransport') = 'none' AND (:'a325_tr3'::JSONB -> 'channel') = 'null'::JSONB,
  'the staff transport read: the path, receive-only, the channel state from the Wazzup channel update, no key / webhook / number; none = as before; another organization has no Wazzup: ' || :'a325_tr1');
-- A Wazzup trace is hidden like a WAHA one: table reads, client and lead cards.
INSERT INTO platform.subject_provenance (organization_id, client_id, source_system, evidence_type, observed_at, source_ref)
VALUES (pg_temp.a325_id(1), pg_temp.a325_id(501), 'website', 'form_submitted', clock_timestamp() - INTERVAL '30 days', 'a325-visible-ref');
INSERT INTO platform.subject_provenance (organization_id, lead_id, source_system, evidence_type, observed_at, source_ref)
VALUES (pg_temp.a325_id(1), pg_temp.a325_id(601), 'website', 'form_submitted', clock_timestamp() - INTERVAL '30 days', 'a325-visible-ref-lead');
INSERT INTO platform.external_identifiers (organization_id, source_system, external_object_type, external_identifier, client_id, observed_at)
VALUES (pg_temp.a325_id(1), 'website', 'form', 'a325-visible-external', pg_temp.a325_id(501), clock_timestamp() - INTERVAL '30 days');
SELECT pg_temp.a325_as(1, 'SELECT jsonb_build_object(''prov_wazzup'', (SELECT count(*) FROM platform.subject_provenance WHERE source_system = ''wazzup''),
  ''prov_other'', (SELECT count(*) FROM platform.subject_provenance WHERE source_system = ''website''),
  ''ext_wazzup'', (SELECT count(*) FROM platform.external_identifiers WHERE source_system = ''wazzup''),
  ''ext_other'', (SELECT count(*) FROM platform.external_identifiers WHERE source_system = ''website''))') AS a325_vis \gset
SELECT pg_temp.a325_as(1, format('SELECT to_jsonb(d) FROM platform.staff_canonical_client_detail(%L) d', pg_temp.a325_id(501))) AS a325_cd \gset
SELECT pg_temp.a325_as(1, format('SELECT to_jsonb(d) FROM platform.staff_canonical_lead_detail(%L) d', pg_temp.a325_id(601))) AS a325_ld \gset
SELECT pg_temp.a325_assert((SELECT count(*) > 0 FROM platform.subject_provenance WHERE source_system = 'wazzup')
  AND (SELECT count(*) > 0 FROM platform.external_identifiers WHERE source_system = 'wazzup')
  AND (:'a325_vis'::JSONB ->> 'prov_wazzup') = '0' AND (:'a325_vis'::JSONB ->> 'ext_wazzup') = '0'
  AND (:'a325_vis'::JSONB ->> 'prov_other')::INTEGER >= 1 AND (:'a325_vis'::JSONB ->> 'ext_other')::INTEGER >= 1,
  'the table reads of staff: the Wazzup provenance and external identities exist but are invisible (as the WAHA ones), other sources are visible: ' || :'a325_vis');
SELECT pg_temp.a325_assert(NOT (:'a325_cd'::JSONB ? 'error') AND NOT (:'a325_ld'::JSONB ? 'error')
  AND (:'a325_cd'::TEXT LIKE '%a325-visible-ref%') AND (:'a325_cd'::TEXT LIKE '%a325-visible-external%') AND NOT (:'a325_cd'::TEXT ILIKE '%wazzup%')
  AND (:'a325_ld'::TEXT LIKE '%a325-visible-ref-lead%') AND NOT (:'a325_ld'::TEXT ILIKE '%wazzup%'),
  'the client and lead cards list the other traces but no Wazzup one: ' || left(:'a325_cd', 300));

SELECT 'A325_WAZZUP_INTAKE_SUITE_PASSED' AS a325_suite_marker;
ROLLBACK;
