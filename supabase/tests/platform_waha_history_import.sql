\set ON_ERROR_STOP on
-- Boundary suite for migration 260: the WhatsApp history import, database lane.
-- Runs on the LATEST chain with its own synthetic organization and Admin; no
-- provider, Auth invitation, real person or production action. History goes
-- through the REAL service RPCs (begin, page, finish, preview); live messages go
-- through the REAL projection chain the webhook uses (enqueue, exact claim,
-- project, finish). Every phone number, chat id and message text is synthetic.
--
-- Proves:
--  1. a window run: begin/resume/replay, a closed option set, a bounded past
--     window, owner eligibility and the service-only guard;
--  2. a direct chat with a customer INBOUND message in the window becomes ONE
--     conversation shaped like a live one holding every window message of both
--     directions, under history.message / missing / api_history evidence and the
--     private_waha_history_binding identity, with the WhatsApp message times as
--     created_at (conversation created/updated from them), typed media markers
--     like live, no handoff, no client and no lead, an allow-listed copy of the
--     message (no ack, quoted text, thumbnail), never a media-archive candidate,
--     one summary realtime invalidation per resource instead of one per row, and
--     the same per-chat advisory lock keys as the live projection;
--  3. @lid chats: bound on the LID, phone only from an explicit alternative field,
--     push name only from a customer message, a LID naming the phone of a bound
--     chat joins that conversation;
--  4. what is skipped and counted, never stored: an outbound-only chat, groups,
--     the own account, CRM API sends and manual-send-bound ids, API-source
--     inbound, empty messages, messages outside the window, malformed messages,
--     ids already bound; a skipped chat leaves no evidence row;
--  5. idempotency: replay of a request, the same page again, a second run;
--  6. import then live: a live inbound lands in the imported conversation and
--     PROMOTES it (exactly one client and lead, same identity a new live chat
--     gets, evidence = the live event), the three lead readers list the
--     conversation, a second message creates nothing more, a live inbound or
--     fromMe/app event of an imported raw id is tolerated (no conflict, no
--     duplicate), lead_mode none never promotes, an outbound live message never
--     promotes;
--  7. live then import: ids already bound are skipped and counted, older history
--     joins the existing conversation, no second conversation or lead;
--  8. forgery guards: history never becomes verified evidence, the phone-sent
--     identity still needs a verified fromMe/app event, the history identity needs
--     history provenance and its observation, a history event cannot be queued;
--  9. the preview returns counts only (no text, id or digits of a chat), writes
--     nothing and agrees with the import; the Inbox orders imported chats by their
--     real last message;
-- 10. catalog: the new RPCs are service-only definer routines with an empty
--     search_path, the helpers are callable by nobody, the superseded v1 routines
--     are not callable, the patched routines keep their contract.
BEGIN;

DO $n260_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n260_auth_role$;

CREATE FUNCTION pg_temp.n260_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n260_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N260: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n260_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

SELECT 'N260_WAHA_HISTORY_IMPORT_SUITE_START' AS n260_suite_marker;

-- The window: the last 7 days up to now, and t0 = one hour after its start.
SELECT '26000000-0000-4000-8000-000000000001' AS org,
  date_trunc('second', statement_timestamp()) AS w_to,
  date_trunc('second', statement_timestamp()) - INTERVAL '7 days' AS w_from,
  (floor(extract(epoch FROM date_trunc('second', statement_timestamp()) - INTERVAL '7 days'))::BIGINT + 3600)::TEXT || '::BIGINT' AS t0 \gset

-- ---------------------------------------------------------------------------
-- Fixture: one organization and one system Admin, the intake owner.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n260_id(1), 'N260 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (pg_temp.n260_id(101), 'n260-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n260_id(201), pg_temp.n260_id(101), 'N260 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n260_id(301), pg_temp.n260_id(1), pg_temp.n260_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published'
      ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n260_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n260_id(401), pg_temp.n260_id(1), 'organization', pg_temp.n260_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n260_id(1), pg_temp.n260_id(301), pg_temp.n260_id(401), 1, 1, TRUE, 'system',
    'N260 synthetic organization scope', pg_temp.n260_id(601));

-- Clear the shared queue of earlier suites' leftovers so only this fixture is claimed.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();

SELECT jsonb_build_object('sub', pg_temp.n260_id(101), 'role', 'authenticated', 'platform_role', 'admin',
  'platform_access_version', p.access_version, 'platform_organization_id', m.organization_id,
  'platform_membership_id', m.id, 'platform_bundle_id', m.current_bundle_id, 'platform_bundle_version', b.version)::TEXT AS admin_claims
FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id WHERE m.id = pg_temp.n260_id(301) \gset

-- ---------------------------------------------------------------------------
-- Helpers: the history RPCs as the service role, REST-shaped messages, counts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n260_svc() RETURNS VOID LANGUAGE SQL AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE)
$$;
CREATE FUNCTION pg_temp.n260_me() RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT '{"id":"79990000000@c.us","lid":"900000000000001@lid"}'::JSONB
$$;
CREATE FUNCTION pg_temp.n260_begin(p_n INTEGER, p_options JSONB DEFAULT NULL, p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.n260_svc();
  RETURN platform.begin_waha_history_window_run(pg_temp.n260_id(1), 'crm_primary', 'GOWS', pg_temp.n260_id(301),
    COALESCE(p_from, current_setting('n260.w_from')::TIMESTAMPTZ), COALESCE(p_to, current_setting('n260.w_to')::TIMESTAMPTZ),
    COALESCE(p_options, jsonb_build_object('me', pg_temp.n260_me())), pg_temp.n260_id(4000 + p_n));
END
$$;
SELECT set_config('n260.w_from', :'w_from', FALSE) AS cfg_from, set_config('n260.w_to', :'w_to', FALSE) AS cfg_to \gset
CREATE FUNCTION pg_temp.n260_page(p_run UUID, p_n INTEGER, p_chat TEXT, p_msgs JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.n260_svc();
  RETURN platform.project_waha_history_window_page(pg_temp.n260_id(1), p_run, 'crm_primary', p_chat, p_msgs, p_n, 0,
    md5(p_run::TEXT || ':page:' || p_n::TEXT)::UUID);
END
$$;
CREATE FUNCTION pg_temp.n260_finish(p_run UUID, p_n INTEGER, p_outcome TEXT DEFAULT 'completed') RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.n260_svc();
  RETURN platform.finish_waha_history_window_run(pg_temp.n260_id(1), p_run, p_outcome, md5(p_run::TEXT || ':finish:' || p_n::TEXT)::UUID);
END
$$;
CREATE FUNCTION pg_temp.n260_preview(p_chat TEXT, p_msgs JSONB, p_options JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.n260_svc();
  RETURN platform.preview_waha_history_window_chat(pg_temp.n260_id(1), 'crm_primary', p_chat, p_msgs,
    current_setting('n260.w_from')::TIMESTAMPTZ, current_setting('n260.w_to')::TIMESTAMPTZ,
    COALESCE(p_options, jsonb_build_object('me', pg_temp.n260_me())));
END
$$;
-- One REST message the way GOWS reports a direct chat: from = the chat, to = null (both directions).
CREATE FUNCTION pg_temp.n260_msg(p_id TEXT, p_chat TEXT, p_from_me BOOLEAN, p_t BIGINT, p_body TEXT,
  p_extra JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', p_t, 'from', p_chat, 'to', NULL::TEXT, 'fromMe', p_from_me,
    'hasMedia', FALSE, 'body', p_body, 'ack', 3, 'ackName', 'READ') || p_extra
$$;
CREATE FUNCTION pg_temp.n260_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT b.conversation_id FROM platform_private.waha_direct_chat_bindings b
  WHERE b.organization_id = pg_temp.n260_id(1) AND b.normalized_chat_id = p_chat
$$;
CREATE FUNCTION pg_temp.n260_bodies(p_conversation UUID) RETURNS TEXT[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(m.direction || ':' || m.body_text ORDER BY m.created_at, m.id), ARRAY[]::TEXT[])
  FROM platform.communication_messages m WHERE m.conversation_id = p_conversation
$$;
CREATE FUNCTION pg_temp.n260_counts() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'events', (SELECT count(*) FROM platform_private.provider_webhook_events WHERE organization_id = pg_temp.n260_id(1)),
    'history_events', (SELECT count(*) FROM platform_private.provider_webhook_events
      WHERE organization_id = pg_temp.n260_id(1) AND event_type = 'history.message'),
    'messages', (SELECT count(*) FROM platform.communication_messages WHERE organization_id = pg_temp.n260_id(1)),
    'conversations', (SELECT count(*) FROM platform.communication_conversations WHERE organization_id = pg_temp.n260_id(1)),
    'bindings', (SELECT count(*) FROM platform_private.waha_direct_chat_bindings WHERE organization_id = pg_temp.n260_id(1)),
    'message_bindings', (SELECT count(*) FROM platform_private.waha_message_bindings WHERE organization_id = pg_temp.n260_id(1)),
    'clients', (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.n260_id(1)),
    'leads', (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n260_id(1)),
    'handoffs', (SELECT count(*) FROM platform.conversation_handoff_events WHERE organization_id = pg_temp.n260_id(1)),
    'observations', (SELECT count(*) FROM platform_private.waha_history_message_observations WHERE organization_id = pg_temp.n260_id(1)))
$$;
CREATE FUNCTION pg_temp.n260_realtime() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM realtime.messages WHERE topic = 'platform-messaging:' || pg_temp.n260_id(1)::TEXT
$$;

-- The live chain (copied from the 259 suite): one verified event through enqueue, claim, project, finish.
CREATE FUNCTION pg_temp.n260_event(p_n INTEGER, p_event TEXT, p_payload JSONB, p_occurred TIMESTAMPTZ DEFAULT NULL,
  p_me JSONB DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  event_id CONSTANT UUID := pg_temp.n260_id(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.n260_id(1), 'waha', 'waha:crm_primary', NULL,
    CASE WHEN p_event = 'message.ack' THEN lower(p_payload ->> 'ackName') END, 'n260-' || p_n, 'crm_primary',
    p_payload ->> 'id', p_event, COALESCE(p_occurred, current_setting('n260.w_to')::TIMESTAMPTZ + p_n * INTERVAL '1 second'),
    'verified', jsonb_build_object('event', p_event, 'session', 'crm_primary', 'payload', p_payload)
      || CASE WHEN p_me IS NULL THEN '{}'::JSONB ELSE jsonb_build_object('me', p_me) END,
    '{"hmac_verified":true}', 'synthetic:n260:' || p_n, lpad(to_hex(p_n), 64, '0'), pg_temp.n260_id(1500 + p_n));
  RETURN event_id;
END
$$;
CREATE FUNCTION pg_temp.n260_work(p_n INTEGER, p_event TEXT, p_event_id UUID, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n260_id(1);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, p_event_id,
    encode(sha256(convert_to('n260-' || p_event || '-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n260_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n260', pg_temp.n260_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n260_id(301), pg_temp.n260_id(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n260_id(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state', 'work_item_id', work, 'event_id', p_event_id);
END
$$;
CREATE FUNCTION pg_temp.n260_live(p_n INTEGER, p_payload JSONB, p_occurred TIMESTAMPTZ DEFAULT NULL, p_me JSONB DEFAULT NULL)
  RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.n260_work(p_n, 'message.any', pg_temp.n260_event(p_n, 'message.any', p_payload, p_occurred, p_me), p_payload);
END
$$;
-- A live webhook payload (WEBJS-like: inbound from = customer; phone-sent from = own, to = customer; both source app).
CREATE FUNCTION pg_temp.n260_live_in(p_id TEXT, p_chat TEXT, p_body TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', p_chat, 'fromMe', false, 'source', 'app', 'body', p_body)
$$;
CREATE FUNCTION pg_temp.n260_live_out(p_id TEXT, p_chat TEXT, p_body TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', '79990000000@c.us', 'to', p_chat, 'fromMe', true,
    'source', 'app', 'body', p_body)
$$;

-- A live delivery acknowledgement through the real chain.
CREATE FUNCTION pg_temp.n260_ack(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n260_id(1);
  ev UUID; enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  ev := pg_temp.n260_event(p_n, 'message.ack', p_payload);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, ev,
    encode(sha256(convert_to('n260-ack-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n260_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n260', pg_temp.n260_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_observation(org, work, attempt, pg_temp.n260_id(301), pg_temp.n260_id(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_event_projection(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', CASE WHEN proj ->> 'disposition' = 'retryable_error' THEN 30 END,
    pg_temp.n260_id(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;

-- ---------------------------------------------------------------------------
-- 1. A window run: begin, resume, replay and the closed input contract.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_begin(1) AS r \gset
SELECT (:'r'::JSONB ->> 'run_id')::UUID AS run_a \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'state' = 'running' AND NOT (:'r'::JSONB ->> 'resumed')::BOOLEAN
  AND (:'r'::JSONB ->> 'lead_mode') = 'promote' AND NOT (:'r'::JSONB ->> 'include_outbound_only')::BOOLEAN
  AND (:'r'::JSONB ->> 'chat_offset') = '0' AND NOT (:'r'::JSONB)::TEXT LIKE '%79990000000%',
  'begin: a running window run with the default options (promote, no outbound-only), the own number is not echoed');
SELECT pg_temp.n260_assert(
  (SELECT r.window_from = :'w_from'::TIMESTAMPTZ AND r.window_to = :'w_to'::TIMESTAMPTZ AND r.options ->> 'lead_mode' = 'promote'
     AND r.options #>> '{me,id}' = '79990000000@c.us' AND r.engine = 'GOWS' AND r.waha_session_name = 'crm_primary'
   FROM platform_private.waha_history_reconciliation_runs r WHERE r.id = :'run_a'),
  'the run keeps its window and normalised options as immutable evidence');
-- Replay of the same request returns the stored answer; the same id with another input is refused.
SELECT pg_temp.n260_assert(pg_temp.n260_begin(1) = :'r'::JSONB, 'a replayed begin returns the stored response');
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT platform.begin_waha_history_window_run(%L, 'crm_primary', 'WEBJS', %L, %L, %L, '{}', %L)$sql$,
    pg_temp.n260_id(1), pg_temp.n260_id(301), :'w_from', :'w_to', pg_temp.n260_id(4001))) LIKE '22023%',
  'a request id reused with another input is refused');
-- Resuming: the same window, options, engine and owner under a new request id returns the same run.
SELECT pg_temp.n260_begin(2) AS r2 \gset
SELECT pg_temp.n260_assert((:'r2'::JSONB ->> 'run_id')::UUID = :'run_a' AND (:'r2'::JSONB ->> 'resumed')::BOOLEAN,
  'begin with the same parameters resumes the unfinished run');
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT pg_temp.n260_begin(3, NULL, %L::timestamptz - interval '1 hour', NULL)$sql$, :'w_from')) LIKE '55000%',
  'a different window while a run is unfinished is refused');
-- The window and options contract.
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT pg_temp.n260_begin(4, NULL, %L::timestamptz - interval '40 days', NULL)$sql$, :'w_from')) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_begin(5, NULL, NULL, %L::timestamptz + interval '1 day')$sql$, :'w_to')) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_begin(6, NULL, %L, %L)$sql$, :'w_to', :'w_from')) LIKE '22023%'
  AND pg_temp.n260_message($sql$SELECT pg_temp.n260_begin(7, '{"include_outbound":true}')$sql$) LIKE '22023%'
  AND pg_temp.n260_message($sql$SELECT pg_temp.n260_begin(8, '{"lead_mode":"all"}')$sql$) LIKE '22023%'
  AND pg_temp.n260_message($sql$SELECT pg_temp.n260_begin(9, '{"me":{"id":"not-a-jid"}}')$sql$) LIKE '22023%'
  AND pg_temp.n260_message($sql$SELECT pg_temp.n260_begin(10, '{"me":{"phone":"79990000000@c.us"}}')$sql$) LIKE '22023%',
  'window over 31 days, a future window, an inverted window, an unknown option, a bad lead_mode and a bad own account are refused');
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT platform.begin_waha_history_window_run(%L, 'evo-inbox', 'GOWS', %L, %L, %L, '{}', %L)$sql$,
    pg_temp.n260_id(1), pg_temp.n260_id(301), :'w_from', :'w_to', pg_temp.n260_id(4011))) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT platform.begin_waha_history_window_run(%L, 'crm_primary', 'BAILEYS', %L, %L, %L, '{}', %L)$sql$,
    pg_temp.n260_id(1), pg_temp.n260_id(301), :'w_from', :'w_to', pg_temp.n260_id(4012))) LIKE '22023%',
  'only the crm_primary session and a known engine are accepted');
-- Not a service caller: refused before anything else.
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', TRUE);
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT platform.begin_waha_history_window_run(%L, 'crm_primary', 'GOWS', %L, %L, %L, '{}', %L)$sql$,
    pg_temp.n260_id(1), pg_temp.n260_id(301), :'w_from', :'w_to', pg_temp.n260_id(4013))) LIKE '42501%'
  AND pg_temp.n260_message(format($sql$SELECT platform.project_waha_history_window_page(%L, %L, 'crm_primary', NULL, '[]', 1, 0, %L)$sql$,
    pg_temp.n260_id(1), :'run_a', pg_temp.n260_id(5990))) LIKE '42501%'
  AND pg_temp.n260_message(format($sql$SELECT platform.preview_waha_history_window_chat(%L, 'crm_primary', NULL, '[]', %L, %L, '{}')$sql$,
    pg_temp.n260_id(1), :'w_from', :'w_to')) LIKE '42501%',
  'begin, page and preview require the service role');
SELECT pg_temp.n260_svc();
-- A run of another tenant is never found.
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT platform.project_waha_history_window_page(%L, %L, 'crm_primary', NULL, '[]', 1, 0, %L)$sql$,
    pg_temp.n260_id(2), :'run_a', pg_temp.n260_id(5991))) LIKE '42501%',
  'a page for another tenant than the run is refused');

-- ---------------------------------------------------------------------------
-- 2. A c.us chat: outbound before the first customer message, text, media, caption.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_counts() AS before_c1 \gset
SELECT pg_temp.n260_realtime() AS rt_before \gset
SELECT pg_temp.n260_page(:'run_a', 1, '79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000101@c.us_H3', '79990000101@c.us', TRUE, :t0 + 120, 'Ответ менеджера', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H2', '79990000101@c.us', FALSE, :t0 + 60, 'Здравствуйте, вопрос по поступлению',
    '{"_data":{"Info":{"Chat":"79990000101@s.whatsapp.net","IsFromMe":false,"PushName":"Customer One"},"Message":{"conversation":"raw protobuf body"}}}'),
  pg_temp.n260_msg('true_79990000101@c.us_H1', '79990000101@c.us', TRUE, :t0, 'Добрый день! Это EVO', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H4', '79990000101@c.us', FALSE, :t0 + 180, '',
    '{"hasMedia":true,"media":{"url":null,"mimetype":"image/jpeg","filename":null},"_data":{"Message":{"imageMessage":{"mimetype":"image/jpeg","JPEGThumbnail":"AAEC"}}}}'),
  pg_temp.n260_msg('false_79990000101@c.us_H5', '79990000101@c.us', FALSE, :t0 + 240, 'Мой диплом',
    '{"hasMedia":true,"media":{"mimetype":"image/png"},"replyTo":{"id":"x","body":"quoted secret"}}'))) AS r \gset
SELECT pg_temp.n260_counts() AS after_c1 \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_new' AND (:'r'::JSONB ->> 'conversation_created')::BOOLEAN
  AND (:'r'::JSONB ->> 'projected')::INT = 5 AND (:'r'::JSONB ->> 'projected_inbound')::INT = 3
  AND (:'r'::JSONB ->> 'projected_outbound')::INT = 2 AND (:'r'::JSONB ->> 'projected_media')::INT = 2
  AND (:'r'::JSONB ->> 'received')::INT = 5 AND (:'r'::JSONB ->> 'already_bound')::INT = 0
  AND NOT (:'r'::JSONB)::TEXT LIKE '%79990000101%' AND NOT (:'r'::JSONB)::TEXT LIKE '%Здравствуйте%',
  'chat 1: imported as a new conversation, 3 inbound + 2 outbound, 2 media, the answer carries counts only');
SELECT pg_temp.n260_assert(
  pg_temp.n260_bodies(pg_temp.n260_conv('79990000101@c.us')) = ARRAY[
    'outbound:Добрый день! Это EVO', 'inbound:Здравствуйте, вопрос по поступлению', 'outbound:Ответ менеджера',
    E'inbound:📎 Фото — откройте в WhatsApp продаж', E'inbound:📎 Фото — откройте в WhatsApp продаж\nМой диплом'],
  'chat 1: every window message in time order, outbound before the first customer message included, typed media markers like live');
SELECT pg_temp.n260_assert(
  (SELECT c.subject = 'WhatsApp ••••0101' AND c.status = 'open' AND c.queue = 'sales' AND c.sales_authority_source = 'platform_intake'
     AND c.responsible_sales_membership_id = pg_temp.n260_id(301) AND c.waha_session_name = 'crm_primary'
     AND c.canonical_client_id IS NULL AND c.canonical_lead_id IS NULL
     AND c.created_at = to_timestamp(:t0) AND c.updated_at = to_timestamp(:t0 + 240)
   FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('79990000101@c.us')),
  'chat 1: a live-shaped intake conversation created and updated at its MESSAGE times, no client, no lead');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 5 AND bool_and(m.message_identity_source = 'private_waha_history_binding' AND m.manual_send_authorization_id IS NULL
        AND m.autonomous_reply_intent_id IS NULL AND NOT m.student_visible AND m.created_at = to_timestamp(v.t)
        AND p.participant_kind::TEXT = CASE m.direction::TEXT WHEN 'outbound' THEN 'sales' ELSE 'customer' END)
   FROM (VALUES ('true_79990000101@c.us_H1', :t0), ('false_79990000101@c.us_H2', :t0 + 60), ('true_79990000101@c.us_H3', :t0 + 120),
     ('false_79990000101@c.us_H4', :t0 + 180), ('false_79990000101@c.us_H5', :t0 + 240)) AS v(raw, t)
   JOIN platform_private.waha_message_bindings b ON b.raw_message_id = v.raw
   JOIN platform.communication_messages m ON m.id = b.communication_message_id
   JOIN platform.conversation_participants p ON p.id = m.sender_participant_id),
  'chat 1: both directions carry the history identity, the WhatsApp message time and the right participant');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 5 AND bool_and(e.verification_status = 'missing' AND e.event_type = 'history.message'
        AND e.provider_account_ref = 'waha:crm_primary' AND e.waha_session_name = 'crm_primary'
        AND e.verification_headers ->> 'provenance' = 'api_history' AND e.verification_headers -> 'webhook_verified' = 'false'::JSONB
        AND e.verification_headers -> 'read_only' = 'true'::JSONB AND e.verification_headers ->> 'run_id' = :'run_a'
        AND e.verification_headers ->> 'engine' = 'GOWS' AND e.verification_headers ->> 'lead_mode' = 'promote'
        AND (e.verification_headers ->> 'window_from')::TIMESTAMPTZ = :'w_from'::TIMESTAMPTZ
        AND (e.verification_headers ->> 'window_to')::TIMESTAMPTZ = :'w_to'::TIMESTAMPTZ
        AND e.verification_evidence_ref = 'api-history-read:' || :'run_a'
        AND e.raw_payload ->> 'event' = 'history.message' AND e.raw_payload -> 'payload' ->> 'chatId' = '79990000101@c.us')
   FROM platform_private.waha_message_bindings b
   JOIN platform_private.provider_webhook_events e ON e.id = b.source_webhook_event_id
   WHERE b.communication_message_id IN (SELECT id FROM platform.communication_messages WHERE conversation_id = pg_temp.n260_conv('79990000101@c.us'))),
  'chat 1: one history.message evidence row per message, status missing, history provenance, never verified');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 0 FROM platform_private.provider_webhook_events e
   WHERE e.organization_id = pg_temp.n260_id(1) AND e.event_type = 'history.message'
     AND (e.raw_payload::TEXT LIKE '%JPEGThumbnail%' OR e.raw_payload::TEXT LIKE '%quoted secret%' OR e.raw_payload::TEXT LIKE '%raw protobuf body%'
       OR e.raw_payload -> 'payload' ? 'ack' OR e.raw_payload -> 'payload' ? 'replyTo' OR e.raw_payload -> 'payload' ? 'ackName')),
  'the stored copy is allow-listed: no ack, quoted text, raw protobuf body or thumbnail');
SELECT pg_temp.n260_assert(
  (SELECT e.raw_payload #>> '{payload,_data,Message,imageMessage}' = '{}' FROM platform_private.provider_webhook_events e
   WHERE e.organization_id = pg_temp.n260_id(1) AND e.payload_id = 'false_79990000101@c.us_H4')
  AND (SELECT e.raw_payload #>> '{payload,_data,Info,PushName}' = 'Customer One' FROM platform_private.provider_webhook_events e
   WHERE e.organization_id = pg_temp.n260_id(1) AND e.payload_id = 'false_79990000101@c.us_H2'),
  'the media kind of a GOWS message survives as the presence of its _data.Message object, the push name as reported');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 1 FROM platform_private.waha_direct_chat_bindings b
   JOIN platform_private.provider_webhook_events e ON e.id = b.source_webhook_event_id
   WHERE b.conversation_id = pg_temp.n260_conv('79990000101@c.us') AND e.event_type = 'history.message'
     AND e.payload_id = 'false_79990000101@c.us_H2')
  AND (SELECT c.created_from_webhook_event_id = b.source_webhook_event_id
       FROM platform.communication_conversations c JOIN platform_private.waha_direct_chat_bindings b ON b.conversation_id = c.id
       WHERE c.id = pg_temp.n260_conv('79990000101@c.us')),
  'the binding and the conversation come from the first customer INBOUND message');
SELECT pg_temp.n260_assert(
  (:'after_c1'::JSONB ->> 'clients') = (:'before_c1'::JSONB ->> 'clients') AND (:'after_c1'::JSONB ->> 'leads') = (:'before_c1'::JSONB ->> 'leads')
  AND (:'after_c1'::JSONB ->> 'handoffs') = (:'before_c1'::JSONB ->> 'handoffs')
  AND (:'after_c1'::JSONB ->> 'conversations')::INT = (:'before_c1'::JSONB ->> 'conversations')::INT + 1
  AND (:'after_c1'::JSONB ->> 'messages')::INT = (:'before_c1'::JSONB ->> 'messages')::INT + 5
  AND (:'after_c1'::JSONB ->> 'observations')::INT = (:'before_c1'::JSONB ->> 'observations')::INT + 5,
  'the import creates no client, no lead and no staff handoff (not even for media-only inbound), one conversation, five messages');
SELECT pg_temp.n260_assert(
  NOT EXISTS (SELECT 1 FROM platform.communication_messages m WHERE m.conversation_id = pg_temp.n260_conv('79990000101@c.us')
    AND platform_private.is_bound_waha_media_candidate(m.organization_id, m.id)),
  'an imported media message is never a media-archive candidate: nothing is downloaded');
SELECT pg_temp.n260_assert(pg_temp.n260_realtime() = :rt_before + 2,
  'one summary invalidation per resource (conversation, message) instead of one per imported row');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()
     AND ((l.classid::BIGINT << 32) | l.objid::BIGINT) = hashtextextended(
       'evo:p5b:waha-chat:' || pg_temp.n260_id(1)::TEXT || ':crm_primary:79990000101@c.us', 0)),
  'the page holds the SAME advisory lock key as the live projection for this chat');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 1 FROM platform_private.waha_history_reconciliation_checkpoints c WHERE c.run_id = :'run_a' AND c.chat_offset = 1
     AND c.projected_count = 5)
  AND (SELECT count(*) = 1 FROM platform.audit_events a WHERE a.request_id = md5(:'run_a' || ':page:1')::UUID
       AND a.action = 'communication.waha.history.project' AND a.after_state ->> 'projected' = '5'
       AND NOT a.after_state::TEXT LIKE '%79990000101%'),
  'a checkpoint and an audit event per page, counts only');

-- The Inbox sorts the imported chat by its LAST MESSAGE, not by the import time, and shows the unanswered
-- customer message as waiting since then.
SELECT set_config('request.jwt.claims', :'admin_claims', TRUE);
SET LOCAL ROLE authenticated;
SELECT jsonb_agg(jsonb_build_object('subject', p.subject, 'sort_at', p.sort_at, 'last_at', p.last_message_at,
  'waiting_since', p.waiting_since, 'direction', p.last_message_direction)) AS inbox
FROM platform.staff_communication_page(:'org'::UUID, 50) AS p \gset
RESET ROLE;
SELECT pg_temp.n260_svc();
SELECT pg_temp.n260_assert(
  (SELECT i.value ->> 'subject' = 'WhatsApp ••••0101' AND (i.value ->> 'sort_at')::TIMESTAMPTZ = to_timestamp(:t0 + 240)
     AND (i.value ->> 'last_at')::TIMESTAMPTZ = to_timestamp(:t0 + 240) AND i.value ->> 'direction' = 'inbound'
     AND (i.value ->> 'waiting_since')::TIMESTAMPTZ = to_timestamp(:t0 + 180)
   FROM jsonb_array_elements(:'inbox'::JSONB) AS i(value) WHERE i.value ->> 'subject' = 'WhatsApp ••••0101'),
  'Inbox: sort_at is the last message time, the unanswered customer messages show their real waiting since');

-- ---------------------------------------------------------------------------
-- 3. @lid chats.
-- ---------------------------------------------------------------------------
-- 3a. A GOWS LID chat whose message names the phone (SenderAlt): bound on the LID, labelled by the phone, NO client.
SELECT pg_temp.n260_counts() AS before_l1 \gset
SELECT pg_temp.n260_page(:'run_a', 2, '323456789012345@lid', jsonb_build_array(
  pg_temp.n260_msg('false_323456789012345@lid_L1', '323456789012345@lid', FALSE, :t0 + 300, 'LID with a phone',
    '{"_data":{"Info":{"SenderAlt":"79990000201:7@s.whatsapp.net","PushName":"Ivan"}}}'),
  pg_temp.n260_msg('true_323456789012345@lid_L2', '323456789012345@lid', TRUE, :t0 + 330, 'Ответ', '{"source":"app"}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_new' AND pg_temp.n260_conv('323456789012345@lid') IS NOT NULL
  AND pg_temp.n260_conv('79990000201@c.us') IS NULL
  AND (SELECT c.subject = 'WhatsApp ••••0201' AND c.canonical_client_id IS NULL AND c.canonical_lead_id IS NULL
       FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('323456789012345@lid'))
  AND (pg_temp.n260_counts() ->> 'clients') = (:'before_l1'::JSONB ->> 'clients'),
  'LID with a phone: bound on the LID chat (the id a reply goes to), labelled by the phone, no client and no lead');
-- 3b. A LID chat without a phone: the customer's own push name (never the sales account's), no number made of LID digits.
SELECT pg_temp.n260_page(:'run_a', 3, '423456789012345@lid', jsonb_build_array(
  pg_temp.n260_msg('true_423456789012345@lid_N0', '423456789012345@lid', TRUE, :t0 + 400, 'Первое от нас',
    '{"source":"app","_data":{"Info":{"PushName":"EVO Sales Own"}}}'),
  pg_temp.n260_msg('false_423456789012345@lid_N1', '423456789012345@lid', FALSE, :t0 + 420, 'No phone here',
    '{"_data":{"Info":{"PushName":"Борис","SenderAlt":""}}}'))) AS r \gset
SELECT pg_temp.n260_assert(
  (SELECT c.subject LIKE 'Борис #____' AND c.subject NOT LIKE '%EVO Sales Own%' AND c.subject NOT LIKE '%423456789012345%'
   FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('423456789012345@lid'))
  AND pg_temp.n260_bodies(pg_temp.n260_conv('423456789012345@lid')) = ARRAY['outbound:Первое от нас', 'inbound:No phone here'],
  'LID without a phone: named by the customer push name plus a suffix, never by the own name or LID digits');
-- 3b2. WAHA mapped the own number to FOREIGN LIDs (devlikeapro/waha#2241): a foreign LID whose SenderAlt is the own
-- number never gets the own phone: no phone, named by its push name, like live.
SELECT pg_temp.n260_page(:'run_a', 4, '923456789012341@lid', jsonb_build_array(
  pg_temp.n260_msg('false_923456789012341@lid_F1', '923456789012341@lid', FALSE, :t0 + 450, 'Foreign LID',
    '{"_data":{"Info":{"SenderAlt":"79990000000:12@s.whatsapp.net","PushName":"Foreign One"}}}'))) AS r \gset
SELECT pg_temp.n260_assert(
  (SELECT c.subject LIKE 'Foreign One #____' AND c.subject NOT LIKE '%0000%'
   FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('923456789012341@lid')),
  'a foreign LID whose alternative phone is the own number is labelled by its push name, never by the own number');

-- 3c. A LID chat whose message names the phone of an already bound c.us chat joins THAT conversation.
SELECT pg_temp.n260_counts() AS before_l3 \gset
SELECT pg_temp.n260_page(:'run_a', 5, '523456789012345@lid', jsonb_build_array(
  pg_temp.n260_msg('false_523456789012345@lid_J1', '523456789012345@lid', FALSE, :t0 + 500, 'Same person, other id',
    '{"_data":{"key":{"remoteJidAlt":"79990000101@s.whatsapp.net"}}}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_existing' AND NOT (:'r'::JSONB ->> 'conversation_created')::BOOLEAN
  AND pg_temp.n260_conv('523456789012345@lid') IS NULL
  AND (pg_temp.n260_counts() ->> 'conversations') = (:'before_l3'::JSONB ->> 'conversations')
  AND (pg_temp.n260_bodies(pg_temp.n260_conv('79990000101@c.us')))[6] = 'inbound:Same person, other id',
  'a LID naming a bound phone chat joins its conversation: no second conversation, no second binding');
SELECT pg_temp.n260_assert(
  (SELECT o.normalized_chat_id = '79990000101@c.us' FROM platform_private.waha_history_message_observations o
   WHERE o.raw_message_id = 'false_523456789012345@lid_J1'),
  'the observation names the chat of the bound conversation');

-- ---------------------------------------------------------------------------
-- 4. What is skipped, counted and never stored.
-- ---------------------------------------------------------------------------
-- 4a. An outbound-only chat (default run): nothing is created and no evidence row exists for it.
SELECT pg_temp.n260_counts() AS before_oo \gset
SELECT pg_temp.n260_page(:'run_a', 6, '79990000301@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000301@c.us_O1', '79990000301@c.us', TRUE, :t0 + 600, 'Cold outreach one', '{"source":"app"}'),
  pg_temp.n260_msg('true_79990000301@c.us_O2', '79990000301@c.us', TRUE, :t0 + 660, 'Cold outreach two', '{"source":"app"}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'skip_outbound_only' AND (:'r'::JSONB ->> 'projected')::INT = 0
  AND (:'r'::JSONB #>> '{skipped,outbound_only}')::INT = 2 AND pg_temp.n260_counts() = :'before_oo'::JSONB
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events e WHERE e.payload_id LIKE '%79990000301%'),
  'an outbound-only chat is skipped by default: nothing created, no evidence row, counted');
-- 4b. A group (and the other non-direct ids) never reaches the lane; nothing of it is stored.
SELECT pg_temp.n260_page(:'run_a', 7, '120363000000000001@g.us', jsonb_build_array(
  pg_temp.n260_msg('false_120363000000000001@g.us_G1', '120363000000000001@g.us', FALSE, :t0 + 700, 'Group chatter'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'skip_unsupported_chat' AND (:'r'::JSONB #>> '{skipped,unsupported_chat}')::INT = 1
  AND pg_temp.n260_counts() = :'before_oo'::JSONB, 'a group chat is skipped, nothing stored');
SELECT pg_temp.n260_page(:'run_a', 8, 'status@broadcast', '[]') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'skip_unsupported_chat', 'status@broadcast is not a direct chat');
-- 4c. A mixed page of a new chat: one good inbound message and one message of every skip reason.
SELECT pg_temp.n260_svc();
SET LOCAL session_replication_role = replica;
INSERT INTO platform_private.manual_send_provider_bindings(organization_id, manual_send_authorization_id, durable_work_item_id,
  durable_work_attempt_id, communication_message_id, waha_session_name, raw_message_id, provider_observed_at)
  VALUES (pg_temp.n260_id(1), pg_temp.n260_id(7001), pg_temp.n260_id(7002), pg_temp.n260_id(7003), pg_temp.n260_id(7004),
    'crm_primary', 'true_79990000401@c.us_MB1', to_timestamp(:t0 + 800));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.n260_page(:'run_a', 9, '79990000401@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000401@c.us_K1', '79990000401@c.us', FALSE, :t0 + 810, 'The only good message'),
  pg_temp.n260_msg('true_79990000401@c.us_API1', '79990000401@c.us', TRUE, :t0 + 820, 'Sent from the CRM', '{"source":"api"}'),
  pg_temp.n260_msg('true_79990000401@c.us_MB1', '79990000401@c.us', TRUE, :t0 + 830, 'Bound by manual send', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000401@c.us_APIIN', '79990000401@c.us', FALSE, :t0 + 840, 'API inbound', '{"source":"api"}'),
  pg_temp.n260_msg('false_79990000401@c.us_E1', '79990000401@c.us', FALSE, :t0 + 850, ''),
  pg_temp.n260_msg('false_79990000401@c.us_E2', '79990000401@c.us', FALSE, :t0 + 851, NULL),
  pg_temp.n260_msg('false_79990000401@c.us_OLD', '79990000401@c.us', FALSE, :t0 - 86400 * 2, 'Before the window'),
  pg_temp.n260_msg('false_79990000401@c.us_NEW', '79990000401@c.us', FALSE, extract(epoch FROM :'w_to'::TIMESTAMPTZ)::BIGINT + 600, 'After the window'),
  pg_temp.n260_msg('false_79990000401@c.us_MS', '79990000401@c.us', FALSE, (:t0 + 860) * 1000, 'Milliseconds, not seconds'),
  jsonb_build_object('id', 'false_79990000401@c.us_NOTS', 'from', '79990000401@c.us', 'fromMe', FALSE, 'body', 'No timestamp'),
  jsonb_build_object('timestamp', :t0 + 870, 'from', '79990000401@c.us', 'fromMe', FALSE, 'body', 'No id'),
  jsonb_build_object('id', 'false_79990000401@c.us_NOFM', 'timestamp', :t0 + 880, 'from', '79990000401@c.us', 'body', 'No direction'),
  pg_temp.n260_msg('false_79990000401@c.us_OTHER', '79990000402@c.us', FALSE, :t0 + 900, 'Another chat altogether'),
  '"not an object"'::JSONB)) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'projected')::INT = 1 AND (:'r'::JSONB ->> 'received')::INT = 14
  AND (:'r'::JSONB #>> '{skipped,crm_send}')::INT = 2 AND (:'r'::JSONB #>> '{skipped,api_source}')::INT = 1
  AND (:'r'::JSONB #>> '{skipped,empty}')::INT = 2 AND (:'r'::JSONB #>> '{skipped,out_of_window}')::INT = 2
  AND (:'r'::JSONB #>> '{skipped,invalid}')::INT = 4 AND (:'r'::JSONB #>> '{skipped,direction_unverified}')::INT = 1
  AND (:'r'::JSONB #>> '{skipped,chat_mismatch}')::INT = 1,
  'a mixed page: one message imported; CRM sends, API inbound, empty, out-of-window, malformed and a foreign chat each counted');
SELECT pg_temp.n260_assert(pg_temp.n260_bodies(pg_temp.n260_conv('79990000401@c.us')) = ARRAY['inbound:The only good message']
  AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events e WHERE e.event_type = 'history.message'
    AND e.payload_id IN ('true_79990000401@c.us_API1', 'true_79990000401@c.us_MB1', 'false_79990000401@c.us_APIIN', 'false_79990000401@c.us_E1',
      'false_79990000401@c.us_OLD', 'false_79990000401@c.us_NEW', 'false_79990000401@c.us_MS', 'false_79990000401@c.us_OTHER')),
  'skipped messages leave no message and no evidence row');
-- 4c2. The own account's chat (a note to self) is never a customer chat; nothing of it is stored.
SELECT pg_temp.n260_counts() AS before_own \gset
SELECT pg_temp.n260_page(:'run_a', 10, '79990000000@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000000@c.us_SELF', '79990000000@c.us', TRUE, :t0 + 890, 'Note to self', '{"source":"app"}'))) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB #>> '{skipped,own_chat}')::INT = 1 AND (:'r'::JSONB ->> 'projected')::INT = 0
  AND pg_temp.n260_counts() = :'before_own'::JSONB, 'a note to self (the own chat) is skipped, nothing stored');
-- 4d. The page contract: no repeated id, bounded size, monotonic cursor, a running run.
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 11, '79990000401@c.us', jsonb_build_array(
    pg_temp.n260_msg('dup', '79990000401@c.us', FALSE, %s, 'a'), pg_temp.n260_msg('dup', '79990000401@c.us', FALSE, %s, 'b')))$sql$,
    :'run_a', :t0 + 1, :t0 + 2)) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 8, '79990000401@c.us', '[]')$sql$, :'run_a')) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 1, '79990000401@c.us', '{}')$sql$, :'run_a')) LIKE '22023%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 11, '79990000401@c.us', (SELECT jsonb_agg(pg_temp.n260_msg('b' || g, '79990000401@c.us', FALSE, %s, 'x')) FROM generate_series(1, 501) g))$sql$,
    :'run_a', :t0 + 5)) LIKE '22023%',
  'a repeated raw id, a cursor that does not advance, a non-array and an oversized page are refused');

-- ---------------------------------------------------------------------------
-- 5. Idempotency.
-- ---------------------------------------------------------------------------
-- 5a. The same request returns the stored answer and writes nothing.
SELECT pg_temp.n260_counts() AS before_replay \gset
SELECT pg_temp.n260_assert(
  pg_temp.n260_page(:'run_a', 1, '79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000101@c.us_H3', '79990000101@c.us', TRUE, :t0 + 120, 'Ответ менеджера', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H2', '79990000101@c.us', FALSE, :t0 + 60, 'Здравствуйте, вопрос по поступлению',
    '{"_data":{"Info":{"Chat":"79990000101@s.whatsapp.net","IsFromMe":false,"PushName":"Customer One"},"Message":{"conversation":"raw protobuf body"}}}'),
  pg_temp.n260_msg('true_79990000101@c.us_H1', '79990000101@c.us', TRUE, :t0, 'Добрый день! Это EVO', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H4', '79990000101@c.us', FALSE, :t0 + 180, '',
    '{"hasMedia":true,"media":{"url":null,"mimetype":"image/jpeg","filename":null},"_data":{"Message":{"imageMessage":{"mimetype":"image/jpeg","JPEGThumbnail":"AAEC"}}}}'),
  pg_temp.n260_msg('false_79990000101@c.us_H5', '79990000101@c.us', FALSE, :t0 + 240, 'Мой диплом',
    '{"hasMedia":true,"media":{"mimetype":"image/png"},"replyTo":{"id":"x","body":"quoted secret"}}'))) ->> 'projected' = '5'
  AND pg_temp.n260_counts() = :'before_replay'::JSONB,
  'a replayed page returns the stored response and writes nothing');
-- 5b. The same page again under a new request: everything is already bound, nothing is added, the chat is not "new".
SELECT pg_temp.n260_page(:'run_a', 12, '79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000101@c.us_H1', '79990000101@c.us', TRUE, :t0, 'Добрый день! Это EVO', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H2', '79990000101@c.us', FALSE, :t0 + 60, 'Здравствуйте, вопрос по поступлению'),
  pg_temp.n260_msg('false_79990000101@c.us_H5', '79990000101@c.us', FALSE, :t0 + 240, 'Мой диплом', '{"hasMedia":true,"media":{"mimetype":"image/png"}}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'skip_nothing_eligible' AND (:'r'::JSONB ->> 'already_bound')::INT = 3
  AND (:'r'::JSONB ->> 'projected')::INT = 0 AND pg_temp.n260_counts() = :'before_replay'::JSONB,
  'the same messages again: all already bound, counted, nothing added (also when the body differs)');
-- 5c. A new body for an already imported id never aborts and never rewrites it.
SELECT pg_temp.n260_page(:'run_a', 13, '79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000101@c.us_H2', '79990000101@c.us', FALSE, :t0 + 61, 'EDITED text'))) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'already_bound')::INT = 1
  AND (pg_temp.n260_bodies(pg_temp.n260_conv('79990000101@c.us')))[2] = 'inbound:Здравствуйте, вопрос по поступлению',
  'an imported message is never rewritten and a different time or body does not abort the page');

-- ---------------------------------------------------------------------------
-- 6. Import, then live: promotion, readers, overlap tolerance.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_counts() AS before_live \gset
-- 6a. The first live inbound message of imported chat 1: it lands in the SAME conversation and PROMOTES it.
SELECT pg_temp.n260_live(1, pg_temp.n260_live_in('false_79990000101@c.us_LIVE1', '79990000101@c.us', 'Я снова пишу'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '10 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n260_conv('79990000101@c.us')
  AND (:'r'::JSONB ->> 'identity_promoted')::BOOLEAN
  AND (pg_temp.n260_counts() ->> 'conversations') = (:'before_live'::JSONB ->> 'conversations')
  AND (pg_temp.n260_bodies(pg_temp.n260_conv('79990000101@c.us')))[7] = 'inbound:Я снова пишу',
  'live inbound in an imported chat: same conversation, identity promoted, the message follows the history');
SELECT pg_temp.n260_assert(
  (SELECT c.canonical_client_id IS NOT NULL AND c.canonical_lead_id IS NOT NULL AND cl.display_name = 'WhatsApp ••••0101'
     AND cl.phone = '+79990000101' AND l.stage_key = 'new' AND l.current_owner_membership_id = pg_temp.n260_id(301)
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   JOIN platform.leads l ON l.id = c.canonical_lead_id WHERE c.id = pg_temp.n260_conv('79990000101@c.us'))
  AND (pg_temp.n260_counts() ->> 'clients')::INT = (:'before_live'::JSONB ->> 'clients')::INT + 1
  AND (pg_temp.n260_counts() ->> 'leads')::INT = (:'before_live'::JSONB ->> 'leads')::INT + 1,
  'promotion: exactly one client (with the phone) and one new lead, owned by the intake owner, like a new live chat');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 1 FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.n260_id(1)
     AND e.external_object_type = 'direct_chat' AND e.external_identifier = 'crm_primary:79990000101@c.us')
  AND (SELECT count(*) = 2 AND bool_and(s.evidence_type = 'webhook_verified' AND s.source_ref = 'waha-event:' || pg_temp.n260_id(1001)::TEXT)
       FROM platform.subject_provenance s WHERE s.organization_id = pg_temp.n260_id(1) AND s.source_system = 'waha'),
  'the identity evidence is the LIVE verified event, not a history row');
-- The lead readers list the promoted conversation (they require a verified-inbound binding source or a history source).
SELECT c.canonical_lead_id AS lead1 FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('79990000101@c.us') \gset
SELECT pg_temp.n260_conv('79990000101@c.us') AS conv1 \gset
SELECT set_config('request.jwt.claims', :'admin_claims', TRUE);
SET LOCAL ROLE authenticated;
SELECT (SELECT l.linked FROM platform.staff_canonical_lead_conversation_link(:'org'::UUID, :'lead1'::UUID, :'conv1'::UUID) AS l) AS lead_link,
  (SELECT d.linked_conversation_count FROM platform.staff_sales_lead_detail(:'lead1'::UUID) AS d) AS detail_count,
  (SELECT jsonb_array_length(d.linked_conversations) FROM platform.staff_sales_lead_detail(:'lead1'::UUID) AS d) AS detail_items,
  (SELECT p.linked_conversation_count FROM platform.staff_sales_lead_page(50) AS p WHERE p.lead_id = :'lead1'::UUID) AS page_count,
  (SELECT p.is_connected FROM platform.staff_sales_lead_page(50) AS p WHERE p.lead_id = :'lead1'::UUID) AS page_connected \gset
RESET ROLE;
SELECT pg_temp.n260_svc();
SELECT pg_temp.n260_assert(:'lead_link' = 't' AND :'detail_count' = '1' AND :'detail_items' = '1' AND :'page_count' = '1' AND :'page_connected' = 't',
  'the three lead readers list the promoted conversation (link, detail, page): a history binding source is accepted');
-- 6b. A second customer message creates nothing more.
SELECT pg_temp.n260_counts() AS before_second \gset
SELECT pg_temp.n260_live(2, pg_temp.n260_live_in('false_79990000101@c.us_LIVE2', '79990000101@c.us', 'И ещё одно'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '11 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND :'r'::JSONB -> 'identity_promoted' IS NULL
  AND (pg_temp.n260_counts() ->> 'clients') = (:'before_second'::JSONB ->> 'clients')
  AND (pg_temp.n260_counts() ->> 'leads') = (:'before_second'::JSONB ->> 'leads')
  AND (pg_temp.n260_counts() ->> 'conversations') = (:'before_second'::JSONB ->> 'conversations'),
  'a later customer message neither promotes again nor creates a second client or lead');
-- 6c. A live fromMe/app event of an IMPORTED raw id is a duplicate, never a terminal waha_outbound_conflict.
SELECT pg_temp.n260_counts() AS before_dup \gset
SELECT pg_temp.n260_live(3, pg_temp.n260_live_out('true_79990000101@c.us_H1', '79990000101@c.us', 'Добрый день! Это EVO (live body differs)'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '12 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'r'::JSONB ->> 'error_code' IS NULL AND :'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_message_id')::UUID = (SELECT b.communication_message_id FROM platform_private.waha_message_bindings b
       WHERE b.raw_message_id = 'true_79990000101@c.us_H1')
  AND (pg_temp.n260_counts() ->> 'messages') = (:'before_dup'::JSONB ->> 'messages'),
  'a live phone-sent event of an imported id: the existing message, no conflict, no duplicate');
SELECT pg_temp.n260_assert(
  (SELECT m.message_identity_source = 'private_waha_history_binding' FROM platform.communication_messages m
   JOIN platform_private.waha_message_bindings b ON b.communication_message_id = m.id WHERE b.raw_message_id = 'true_79990000101@c.us_H1'),
  'the imported message keeps its history identity');
-- 6d. A live fromMe/app event with a NEW id is projected as a phone-sent message (its own identity, not promotion).
SELECT pg_temp.n260_live(4, pg_temp.n260_live_out('true_79990000101@c.us_LIVEOUT', '79990000101@c.us', 'Ответ после запуска'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '13 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'direction' = 'outbound' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (SELECT m.message_identity_source = 'private_waha_phone_binding' FROM platform.communication_messages m
       WHERE m.id = (:'r'::JSONB ->> 'communication_message_id')::UUID),
  'a new live phone-sent message keeps the phone-sent identity (it needs its verified fromMe/app event)');
-- 6d2. Live delivery acknowledgements still update an IMPORTED outbound message (the ACK projector's allow-list has the history identity).
SELECT pg_temp.n260_ack(60, jsonb_build_object('id', 'true_79990000101@c.us_H3', 'fromMe', TRUE, 'ack', 3, 'ackName', 'READ',
  'to', '79990000101@c.us')) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (SELECT a.waha_ack_name = 'READ' FROM platform.waha_message_ack_current a
       JOIN platform_private.waha_message_bindings b ON b.communication_message_id = a.communication_message_id
       WHERE b.raw_message_id = 'true_79990000101@c.us_H3'),
  'a live ACK updates the delivery state of an imported outbound message');

-- 6e. A live INBOUND event of an imported raw id (the overlap near go-live) with the typed body of a different shape:
-- accepted without a body check, no duplicate; it is also the first live message of the LID chat, so it promotes it.
SELECT pg_temp.n260_counts() AS before_overlap \gset
SELECT pg_temp.n260_live(5, jsonb_build_object('id', 'false_323456789012345@lid_L1', 'timestamp', 1788343200,
  'from', '323456789012345@lid', 'fromMe', false, 'source', 'app', 'body', 'LID with a phone (live copy, other text)',
  '_data', jsonb_build_object('Info', jsonb_build_object('SenderAlt', '79990000201:7@s.whatsapp.net'))),
  :'w_to'::TIMESTAMPTZ + INTERVAL '14 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'r'::JSONB ->> 'error_code' IS NULL
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n260_conv('323456789012345@lid')
  AND (pg_temp.n260_counts() ->> 'messages') = (:'before_overlap'::JSONB ->> 'messages')
  AND (:'r'::JSONB ->> 'identity_promoted')::BOOLEAN,
  'a live inbound of an imported raw id: tolerated without a body check, no duplicate, and promotes the LID chat');
SELECT pg_temp.n260_assert(
  (SELECT cl.phone = '+79990000201' AND cl.display_name = 'WhatsApp ••••0201'
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n260_conv('323456789012345@lid')),
  'a LID chat promoted by a live event that names the phone gets the phone from that live event');
-- 6f. A LID chat without a phone: promotion makes a client without a phone, named by the conversation subject.
SELECT pg_temp.n260_live(6, jsonb_build_object('id', 'false_423456789012345@lid_LIVE', 'timestamp', 1788343200,
  'from', '423456789012345@lid', 'fromMe', false, 'source', 'app', 'body', 'Hello again'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '15 minutes') AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'identity_promoted')::BOOLEAN
  AND (SELECT cl.phone IS NULL AND cl.normalized_phone IS NULL AND cl.display_name = c.subject
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n260_conv('423456789012345@lid')),
  'promotion of a LID chat without a phone: a client without a phone, never a number made of LID digits');

-- ---------------------------------------------------------------------------
-- 7. Live, then import.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_live(10, pg_temp.n260_live_in('false_79990000501@c.us_LV1', '79990000501@c.us', 'Live first'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '20 minutes') AS r \gset
SELECT pg_temp.n260_live(11, pg_temp.n260_live_out('true_79990000501@c.us_LV2', '79990000501@c.us', 'Live phone-sent'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '21 minutes') AS r2 \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND :'r2'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.n260_conv('79990000501@c.us') IS NOT NULL
  AND (SELECT c.canonical_lead_id IS NOT NULL FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('79990000501@c.us')),
  'a live chat as before: conversation and lead from the first verified message');
SELECT pg_temp.n260_counts() AS before_lti \gset
SELECT pg_temp.n260_page(:'run_a', 14, '79990000501@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000501@c.us_OLD1', '79990000501@c.us', FALSE, :t0 + 2000, 'Older customer message'),
  pg_temp.n260_msg('true_79990000501@c.us_OLD2', '79990000501@c.us', TRUE, :t0 + 2060, 'Older answer', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000501@c.us_LV1', '79990000501@c.us', FALSE, :t0 + 3000, 'Live first'),
  pg_temp.n260_msg('true_79990000501@c.us_LV2', '79990000501@c.us', TRUE, :t0 + 3060, 'Live phone-sent', '{"source":"app"}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_existing' AND NOT (:'r'::JSONB ->> 'conversation_created')::BOOLEAN
  AND (:'r'::JSONB ->> 'projected')::INT = 2 AND (:'r'::JSONB ->> 'already_bound')::INT = 2
  AND (pg_temp.n260_counts() ->> 'conversations') = (:'before_lti'::JSONB ->> 'conversations')
  AND (pg_temp.n260_counts() ->> 'bindings') = (:'before_lti'::JSONB ->> 'bindings')
  AND (pg_temp.n260_counts() ->> 'clients') = (:'before_lti'::JSONB ->> 'clients')
  AND (pg_temp.n260_counts() ->> 'leads') = (:'before_lti'::JSONB ->> 'leads'),
  'live then import: the two live ids are skipped and counted, the older history joins the SAME conversation, no lead or client');
SELECT pg_temp.n260_assert(
  (SELECT count(*) FILTER (WHERE m.message_identity_source = 'private_waha_history_binding') = 2
      AND count(*) FILTER (WHERE m.message_identity_source = 'private_waha_binding') = 1
      AND count(*) FILTER (WHERE m.message_identity_source = 'private_waha_phone_binding') = 1
   FROM platform.communication_messages m WHERE m.conversation_id = pg_temp.n260_conv('79990000501@c.us')),
  'each message keeps the identity of the lane that bound it first');

-- ---------------------------------------------------------------------------
-- 8. A second run: outbound-only chats and conversation-only (lead_mode none).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_finish(:'run_a', 1) AS fin \gset
SELECT pg_temp.n260_assert(:'fin'::JSONB ->> 'state' = 'completed' AND (:'fin'::JSONB #>> '{totals,conversations_created}')::INT = 5
  AND (:'fin'::JSONB #>> '{totals,projected}')::INT = 5 + 2 + 2 + 1 + 1 + 1 + 2 AND (:'fin'::JSONB #>> '{totals,chats_skipped}')::INT >= 4
  AND (:'fin'::JSONB #>> '{totals,skipped,crm_send}')::INT = 2 AND (:'fin'::JSONB #>> '{totals,skipped,outbound_only}')::INT = 2
  AND (:'fin'::JSONB #>> '{totals,already_bound}')::INT >= 6 AND NOT (:'fin'::JSONB)::TEXT LIKE '%7999000%',
  'finish: totals (pages, conversations created, projected, skipped by reason, already bound), counts only');
SELECT pg_temp.n260_assert(pg_temp.n260_finish(:'run_a', 1) = :'fin'::JSONB, 'a replayed finish returns the stored answer');
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 99, '79990000101@c.us', '[]')$sql$, :'run_a')) LIKE '55000%'
  AND pg_temp.n260_message(format($sql$SELECT pg_temp.n260_finish(%L, 2)$sql$, :'run_a')) LIKE '55000%',
  'a finished run takes no more pages and cannot be finished twice');
SELECT pg_temp.n260_begin(20, jsonb_build_object('include_outbound_only', TRUE, 'lead_mode', 'none', 'me', pg_temp.n260_me())) AS rb \gset
SELECT (:'rb'::JSONB ->> 'run_id')::UUID AS run_b \gset
SELECT pg_temp.n260_assert(:'run_b' <> :'run_a' AND (:'rb'::JSONB ->> 'include_outbound_only')::BOOLEAN AND :'rb'::JSONB ->> 'lead_mode' = 'none',
  'a new run after a completed one, with outbound-only chats allowed and no promotion');
-- A re-run of the first window: everything is already bound.
SELECT pg_temp.n260_counts() AS before_rerun \gset
SELECT pg_temp.n260_page(:'run_b', 1, '79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000101@c.us_H1', '79990000101@c.us', TRUE, :t0, 'Добрый день! Это EVO', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000101@c.us_H5', '79990000101@c.us', FALSE, :t0 + 240, 'Мой диплом'))) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'already_bound')::INT = 2 AND (:'r'::JSONB ->> 'projected')::INT = 0
  AND pg_temp.n260_counts() = :'before_rerun'::JSONB, 'a second run over the same window adds nothing');
-- The outbound-only chat is imported now (conversation from its first message, no client, no lead).
SELECT pg_temp.n260_page(:'run_b', 2, '79990000301@c.us', jsonb_build_array(
  pg_temp.n260_msg('true_79990000301@c.us_O1', '79990000301@c.us', TRUE, :t0 + 600, 'Cold outreach one', '{"source":"app"}'),
  pg_temp.n260_msg('true_79990000301@c.us_O2', '79990000301@c.us', TRUE, :t0 + 660, 'Cold outreach two', '{"source":"app"}'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_new' AND (:'r'::JSONB ->> 'projected_outbound')::INT = 2
  AND (SELECT c.canonical_lead_id IS NULL AND c.canonical_client_id IS NULL AND c.created_at = to_timestamp(:t0 + 600)
       FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('79990000301@c.us'))
  AND (SELECT e.verification_headers ->> 'lead_mode' = 'none' FROM platform_private.waha_direct_chat_bindings b
       JOIN platform_private.provider_webhook_events e ON e.id = b.source_webhook_event_id WHERE b.normalized_chat_id = '79990000301@c.us'),
  'include_outbound_only: the chat is imported from its first message, no client, no lead; lead_mode none is on its evidence');
-- lead_mode none: the customer's first live message lands in the conversation and NEVER promotes it.
SELECT pg_temp.n260_counts() AS before_none \gset
SELECT pg_temp.n260_live(30, pg_temp.n260_live_in('false_79990000301@c.us_LIVE', '79990000301@c.us', 'A reply at last'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '30 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n260_conv('79990000301@c.us')
  AND :'r'::JSONB -> 'identity_promoted' IS NULL
  AND (SELECT c.canonical_lead_id IS NULL AND c.canonical_client_id IS NULL FROM platform.communication_conversations c
       WHERE c.id = pg_temp.n260_conv('79990000301@c.us'))
  AND (pg_temp.n260_counts() ->> 'clients') = (:'before_none'::JSONB ->> 'clients')
  AND (pg_temp.n260_counts() ->> 'leads') = (:'before_none'::JSONB ->> 'leads'),
  'lead_mode none: a live inbound in the imported chat never creates a client or a lead');
-- A third chat in the lead_mode none run; the run is then paused and resumed from its cursor.
SELECT pg_temp.n260_page(:'run_b', 3, '79990000601@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000601@c.us_P1', '79990000601@c.us', FALSE, :t0 + 4000, 'Promotable later'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'chat_outcome' = 'import_new', 'a lead_mode none run imported chat 601');

SELECT pg_temp.n260_finish(:'run_b', 2, 'paused') AS fin_b \gset
SELECT pg_temp.n260_assert(:'fin_b'::JSONB ->> 'state' = 'paused', 'a run can be paused');
SELECT pg_temp.n260_begin(21, jsonb_build_object('include_outbound_only', TRUE, 'lead_mode', 'none', 'me', pg_temp.n260_me())) AS rb2 \gset
SELECT pg_temp.n260_assert((:'rb2'::JSONB ->> 'run_id')::UUID = :'run_b' AND (:'rb2'::JSONB ->> 'resumed')::BOOLEAN
  AND (:'rb2'::JSONB ->> 'chat_offset') = '3', 'a paused run resumes from its durable cursor');
SELECT pg_temp.n260_finish(:'run_b', 3) AS fin_b2 \gset
SELECT pg_temp.n260_begin(22) AS rc \gset
SELECT (:'rc'::JSONB ->> 'run_id')::UUID AS run_c \gset
SELECT pg_temp.n260_page(:'run_c', 1, '79990000701@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000701@c.us_Q1', '79990000701@c.us', FALSE, :t0 + 5000, 'Question'),
  pg_temp.n260_msg('true_79990000701@c.us_Q2', '79990000701@c.us', TRUE, :t0 + 5060, 'Answer without a source field'))) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'projected_outbound')::INT = 1 AND (:'r'::JSONB ->> 'projected_inbound')::INT = 1,
  'REST history may not report `source`: an outgoing message without it is still imported as a staff message');
SELECT pg_temp.n260_counts() AS before_out_live \gset
SELECT pg_temp.n260_live(40, pg_temp.n260_live_out('true_79990000701@c.us_LO', '79990000701@c.us', 'Follow-up from the phone'),
  :'w_to'::TIMESTAMPTZ + INTERVAL '40 minutes') AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'direction' = 'outbound' AND :'r'::JSONB -> 'identity_promoted' IS NULL
  AND (SELECT c.canonical_lead_id IS NULL FROM platform.communication_conversations c WHERE c.id = pg_temp.n260_conv('79990000701@c.us'))
  AND (pg_temp.n260_counts() ->> 'leads') = (:'before_out_live'::JSONB ->> 'leads'),
  'a live outbound message never promotes an imported chat');

-- ---------------------------------------------------------------------------
-- 9. Forgery guards: history is never verified evidence.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 0 FROM platform_private.provider_webhook_events e
   WHERE e.event_type = 'history.message' AND (e.verification_status <> 'missing' OR e.verification_headers ->> 'provenance' <> 'api_history'
     OR e.verification_headers -> 'webhook_verified' <> 'false'::JSONB OR e.verification_evidence_ref NOT LIKE 'api-history-read:%'))
  AND (SELECT count(*) = 0 FROM platform.communication_messages m
       JOIN platform_private.provider_webhook_events e ON e.id = m.source_webhook_event_id
       WHERE e.event_type = 'history.message' AND m.message_identity_source <> 'private_waha_history_binding')
  AND (SELECT count(*) = 0 FROM platform.communication_messages m
       JOIN platform_private.provider_webhook_events e ON e.id = m.source_webhook_event_id
       WHERE e.event_type IN ('message', 'message.any') AND m.message_identity_source = 'private_waha_history_binding'),
  'history evidence is never verified, every history row carries the history identity and no live row does');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 0 FROM platform.communication_messages m
   WHERE m.message_identity_source = 'private_waha_phone_binding'
     AND NOT EXISTS (SELECT 1 FROM platform_private.provider_webhook_events e WHERE e.id = m.source_webhook_event_id
       AND e.verification_status = 'verified' AND e.raw_payload -> 'payload' -> 'fromMe' = 'true'::JSONB)),
  'the phone-sent identity exists only on rows backed by a verified fromMe event');
-- A history event can never be queued as verified webhook work.
SELECT e.id AS hist_event FROM platform_private.provider_webhook_events e
  WHERE e.organization_id = pg_temp.n260_id(1) AND e.event_type = 'history.message' ORDER BY e.id LIMIT 1 \gset
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT platform.enqueue_verified_webhook_work(%L, %L, repeat('a', 64), 8, %L)$sql$,
    pg_temp.n260_id(1), :'hist_event', pg_temp.n260_id(9901))) <> 'ok',
  'a history event is refused by the verified-work queue');
-- The DB-level provenance guard (checked at once here instead of at commit).
-- Fire every pending deferred provenance trigger now: each message the import and the live chain inserted so far must
-- satisfy it (a history row needs its history.message / missing / api_history event and observation).
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.n260_assert((SELECT count(*) > 20 FROM platform.communication_messages m WHERE m.organization_id = pg_temp.n260_id(1)),
  'every imported and live message satisfied the deferred provenance guard when it was fired');
-- (a) a history identity with no binding / observation, or on a verified live event.
SELECT pg_temp.n260_assert(
  (SELECT left(pg_temp.n260_message(format($sql$
    INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
      language, student_visible, message_identity_source, source_webhook_event_id, created_at)
    SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'inbound', 'forged history',
      'undetermined', FALSE, 'private_waha_history_binding', %L, now()
    FROM platform.communication_messages m WHERE m.body_text = 'Я снова пишу'$sql$, pg_temp.n260_id(1001))), 6) = '23514 ')
  AND (SELECT left(pg_temp.n260_message(format($sql$
    INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
      language, student_visible, message_identity_source, source_webhook_event_id, created_at)
    SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'inbound', 'forged history 2',
      'undetermined', FALSE, 'private_waha_history_binding', %L, now()
    FROM platform.communication_messages m WHERE m.body_text = 'Я снова пишу'$sql$, :'hist_event')), 6) = '23514 '),
  'a history identity row without its binding and observation is refused, on a live or a history event');
-- (b) the phone-sent identity still cannot be backed by a history event (it needs a VERIFIED fromMe/app event).
SELECT pg_temp.n260_assert(
  (SELECT left(pg_temp.n260_message(format($sql$
    WITH forged AS (
      INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
        language, student_visible, message_identity_source, source_webhook_event_id, created_at)
      SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'outbound', 'forged phone-sent',
        'undetermined', FALSE, 'private_waha_phone_binding', e.id, now()
      FROM platform.communication_messages m, platform_private.provider_webhook_events e
      WHERE m.body_text = 'Я снова пишу' AND e.id = %L RETURNING id)
    SELECT count(*) FROM forged$sql$, :'hist_event')), 6) = '23514 '),
  'a phone-sent row cannot be backed by a history event');
SET CONSTRAINTS ALL DEFERRED;
-- The constraint set of 259 is untouched: an outbound row needs an authorization or one of the two private identities.
SELECT pg_temp.n260_assert(
  (SELECT left(pg_temp.n260_message(format($sql$
    INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
      language, student_visible, message_identity_source, source_webhook_event_id, created_at)
    SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'outbound', 'forged',
      'undetermined', FALSE, 'private_waha_binding', m.source_webhook_event_id, now()
    FROM platform.communication_messages m WHERE m.body_text = 'Я снова пишу'$sql$)), 6) = '23514 '),
  'an outbound row with the inbound identity and no authorization is still refused');

-- ---------------------------------------------------------------------------
-- 10. The preview: counts only, no write, the same classification as the import.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_begin(23) AS rd \gset
SELECT pg_temp.n260_assert((:'rd'::JSONB ->> 'run_id')::UUID = :'run_c' AND (:'rd'::JSONB ->> 'resumed')::BOOLEAN, 'the third run is still the running one');
SELECT pg_temp.n260_counts() AS before_prev \gset
SELECT pg_temp.n260_preview('79990000801@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000801@c.us_V1', '79990000801@c.us', FALSE, :t0 + 6000, 'Secret preview text'),
  pg_temp.n260_msg('true_79990000801@c.us_V2', '79990000801@c.us', TRUE, :t0 + 6060, 'Secret answer', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000801@c.us_V3', '79990000801@c.us', FALSE, :t0 + 6120, '', '{"hasMedia":true,"media":{"mimetype":"video/mp4"}}'),
  pg_temp.n260_msg('true_79990000801@c.us_V4', '79990000801@c.us', TRUE, :t0 + 6180, 'Sent by the CRM', '{"source":"api"}'),
  pg_temp.n260_msg('false_79990000801@c.us_V5', '79990000801@c.us', FALSE, :t0 - 86400 * 30, 'Too old'))) AS pv \gset
SELECT pg_temp.n260_assert(pg_temp.n260_counts() = :'before_prev'::JSONB, 'the preview writes nothing');
SELECT pg_temp.n260_assert(:'pv'::JSONB ->> 'chat_kind' = 'c_us' AND :'pv'::JSONB ->> 'chat_outcome' = 'import_new'
  AND (:'pv'::JSONB ->> 'would_create_conversation')::BOOLEAN AND NOT (:'pv'::JSONB ->> 'conversation_exists')::BOOLEAN
  AND (:'pv'::JSONB ->> 'received')::INT = 5 AND (:'pv'::JSONB ->> 'would_import')::INT = 3
  AND (:'pv'::JSONB ->> 'would_import_inbound')::INT = 2 AND (:'pv'::JSONB ->> 'would_import_outbound')::INT = 1
  AND (:'pv'::JSONB ->> 'would_import_media')::INT = 1 AND (:'pv'::JSONB #>> '{skipped,crm_send}')::INT = 1
  AND (:'pv'::JSONB #>> '{skipped,out_of_window}')::INT = 1 AND NOT (:'pv'::JSONB ->> 'matches_active_client_phone')::BOOLEAN,
  'preview of a new chat: what would be created and skipped, by reason');
SELECT pg_temp.n260_assert(NOT (:'pv'::JSONB)::TEXT LIKE '%@%' AND NOT (:'pv'::JSONB)::TEXT LIKE '%Secret%'
  AND NOT (:'pv'::JSONB)::TEXT ~ '[0-9]{4,}' AND position('_V' IN (:'pv'::JSONB)::TEXT) = 0,
  'the preview contains no text, no chat or message id and no digits of a number');
SELECT pg_temp.n260_page(:'run_c', 2, '79990000801@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000801@c.us_V1', '79990000801@c.us', FALSE, :t0 + 6000, 'Secret preview text'),
  pg_temp.n260_msg('true_79990000801@c.us_V2', '79990000801@c.us', TRUE, :t0 + 6060, 'Secret answer', '{"source":"app"}'),
  pg_temp.n260_msg('false_79990000801@c.us_V3', '79990000801@c.us', FALSE, :t0 + 6120, '', '{"hasMedia":true,"media":{"mimetype":"video/mp4"}}'),
  pg_temp.n260_msg('true_79990000801@c.us_V4', '79990000801@c.us', TRUE, :t0 + 6180, 'Sent by the CRM', '{"source":"api"}'),
  pg_temp.n260_msg('false_79990000801@c.us_V5', '79990000801@c.us', FALSE, :t0 - 86400 * 30, 'Too old'))) AS r \gset
SELECT pg_temp.n260_assert((:'r'::JSONB ->> 'projected')::INT = (:'pv'::JSONB ->> 'would_import')::INT
  AND (:'r'::JSONB ->> 'projected_inbound')::INT = (:'pv'::JSONB ->> 'would_import_inbound')::INT
  AND (:'r'::JSONB ->> 'projected_outbound')::INT = (:'pv'::JSONB ->> 'would_import_outbound')::INT
  AND (:'r'::JSONB ->> 'projected_media')::INT = (:'pv'::JSONB ->> 'would_import_media')::INT
  AND (:'r'::JSONB -> 'skipped') = (:'pv'::JSONB -> 'skipped'),
  'the import does exactly what its preview said (same code path)');
-- A phone that already belongs to an active client is reported (a count/boolean, never the client).
SELECT pg_temp.n260_preview('79990000101@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990000101@c.us_PV9', '79990000101@c.us', FALSE, :t0 + 7000, 'x'))) AS pv2 \gset
SELECT pg_temp.n260_assert((:'pv2'::JSONB ->> 'matches_active_client_phone')::BOOLEAN AND (:'pv2'::JSONB ->> 'conversation_exists')::BOOLEAN
  AND :'pv2'::JSONB ->> 'chat_outcome' = 'import_existing' AND NOT (:'pv2'::JSONB ->> 'would_create_conversation')::BOOLEAN,
  'preview: an existing conversation and a phone that matches an active client are reported as booleans');
SELECT pg_temp.n260_preview('323456789012399@lid', jsonb_build_array(
  pg_temp.n260_msg('false_x_LP1', '323456789012399@lid', FALSE, :t0 + 7100, 'LID',
    '{"_data":{"Info":{"SenderAlt":"79990000901:3@s.whatsapp.net"}}}'))) AS pv3 \gset
SELECT pg_temp.n260_assert(:'pv3'::JSONB ->> 'chat_kind' = 'lid' AND (:'pv3'::JSONB ->> 'lid_chat_has_phone')::BOOLEAN
  AND NOT (:'pv3'::JSONB ->> 'matches_active_client_phone')::BOOLEAN, 'preview: a LID chat that names its phone');
SELECT pg_temp.n260_assert(pg_temp.n260_preview('120363000000000009@g.us', jsonb_build_array(pg_temp.n260_msg('g', '120363000000000009@g.us', FALSE, :t0, 'x')))
  ->> 'chat_kind' = 'unsupported', 'preview: a group is unsupported');

-- ---------------------------------------------------------------------------
-- 11. Inbox order: imported chats sort by their last message, whatever the import order.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_page(:'run_c', 3, '79990001001@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990001001@c.us_NEWER', '79990001001@c.us', FALSE, :t0 + 100000, 'Newer chat'))) AS r \gset
SELECT pg_temp.n260_page(:'run_c', 4, '79990001002@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990001002@c.us_OLDER', '79990001002@c.us', FALSE, :t0 + 90000, 'Older chat, imported LATER'))) AS r \gset
SELECT set_config('request.jwt.claims', :'admin_claims', TRUE);
SET LOCAL ROLE authenticated;
SELECT jsonb_agg(p.subject ORDER BY p.sort_at DESC, p.conversation_id) AS inbox_order
FROM platform.staff_communication_page(:'org'::UUID, 50) AS p
WHERE p.subject IN ('WhatsApp ••••1001', 'WhatsApp ••••1002') \gset
RESET ROLE;
SELECT pg_temp.n260_svc();
SELECT pg_temp.n260_assert(:'inbox_order'::JSONB = '["WhatsApp ••••1001", "WhatsApp ••••1002"]'::JSONB,
  'Inbox: the chat with the newer last message is first although it was imported first');

-- ---------------------------------------------------------------------------
-- 11b. The intake owner must stay eligible, exactly as for the live projection.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n260_id(102), 'n260-admin2@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n260_id(202), pg_temp.n260_id(102), 'N260 Admin 2', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n260_id(302), pg_temp.n260_id(1), pg_temp.n260_id(202), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n260_id(302);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n260_id(1), pg_temp.n260_id(302), pg_temp.n260_id(401), 1, 1, TRUE, 'system',
    'N260 second admin organization scope', pg_temp.n260_id(602));
SELECT pg_temp.n260_finish(:'run_c', 4) AS fin_c \gset
SELECT pg_temp.n260_svc();
SELECT (platform.begin_waha_history_window_run(pg_temp.n260_id(1), 'crm_primary', 'GOWS', pg_temp.n260_id(302), :'w_from'::TIMESTAMPTZ,
  :'w_to'::TIMESTAMPTZ, '{}', pg_temp.n260_id(4100)) ->> 'run_id')::UUID AS run_d \gset
SELECT pg_temp.n260_page(:'run_d', 1, '79990001101@c.us', jsonb_build_array(
  pg_temp.n260_msg('false_79990001101@c.us_E1', '79990001101@c.us', FALSE, :t0 + 8000, 'Owner is eligible'))) AS r \gset
SELECT pg_temp.n260_assert(:'r'::JSONB ->> 'projected' = '1'
  AND (SELECT c.responsible_sales_membership_id = pg_temp.n260_id(302) FROM platform.communication_conversations c
       WHERE c.id = pg_temp.n260_conv('79990001101@c.us')),
  'a run owned by another eligible intake member creates conversations owned by that member');
UPDATE platform.organization_memberships SET status = 'suspended' WHERE id = pg_temp.n260_id(302);
SELECT pg_temp.n260_assert(
  pg_temp.n260_message(format($sql$SELECT pg_temp.n260_page(%L, 2, '79990001101@c.us', jsonb_build_array(
    pg_temp.n260_msg('false_79990001101@c.us_E2', '79990001101@c.us', FALSE, %s, 'Owner suspended')))$sql$, :'run_d', :t0 + 8100)) LIKE '42501%'
  AND pg_temp.n260_message(format($sql$SELECT platform.begin_waha_history_window_run(%L, 'crm_primary', 'GOWS', %L, %L, %L, '{}', %L)$sql$,
    pg_temp.n260_id(1), pg_temp.n260_id(302), :'w_from', :'w_to', pg_temp.n260_id(4101))) LIKE '42501%',
  'a suspended intake owner can neither begin nor continue an import');

-- ---------------------------------------------------------------------------
-- 12. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 4 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('begin_waha_history_window_run', 'project_waha_history_window_page', 'finish_waha_history_window_run',
       'preview_waha_history_window_chat')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE') AND NOT has_function_privilege('public'::NAME, p.oid, 'EXECUTE')),
  'the four history RPCs: SECURITY DEFINER, empty search_path, owner postgres, executable by service_role only');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 11 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
     AND p.proname IN ('waha_history_text', 'normalize_waha_history_options', 'waha_history_allowlist_message', 'waha_history_prepare_page',
       'waha_history_plan_page', 'waha_history_binding_source_ok', 'waha_history_binding_promotable', 'acquire_waha_canonical_identity',
       'insert_waha_history_event', 'bind_waha_chat_to_canonical', 'require_private_waha_message_binding')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('public'::NAME, p.oid, 'EXECUTE')),
  'the helpers, the identity acquisition, the binding wrapper and the provenance trigger: definer, empty search_path, no client role can execute');
SELECT pg_temp.n260_assert(
  NOT has_function_privilege('service_role', 'platform.begin_waha_history_reconciliation(uuid,text,text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.project_waha_history_page(uuid,uuid,text,text,jsonb,integer,integer,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.finish_waha_history_reconciliation(uuid,uuid,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.project_waha_history_page(uuid,uuid,text,text,jsonb,integer,integer,uuid)', 'EXECUTE'),
  'the superseded v1 history routines are callable by no application role');
SELECT pg_temp.n260_assert(
  has_function_privilege('service_role', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 'v'
       FROM pg_proc p WHERE p.oid = 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE)
  AND has_function_privilege('authenticated', 'platform.staff_canonical_lead_conversation_link(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_canonical_lead_conversation_link(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.staff_sales_lead_detail(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.staff_sales_lead_detail(uuid)', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p
       WHERE p.oid = 'private.staff_sales_lead_page(integer,timestamptz,uuid,text,text,text,uuid,text,text)'::REGPROCEDURE),
  'the patched projector and lead readers keep their grants and definer contract');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 0 FROM pg_proc p WHERE p.pronamespace IN ('platform'::REGNAMESPACE, 'platform_private'::REGNAMESPACE, 'private'::REGNAMESPACE)
     AND p.prosrc LIKE '%waha_history_binding_source_ok%' AND p.prosrc LIKE '%verification_status = ''verified''%'
     AND p.proname NOT IN ('staff_canonical_lead_conversation_link', 'staff_sales_lead_detail', 'staff_sales_lead_page')
     AND p.proname NOT IN ('waha_history_binding_source_ok', 'waha_history_binding_promotable', 'insert_waha_history_event')),
  'only the three lead readers were widened to accept a history binding source');
SELECT pg_temp.n260_assert(
  (SELECT p.prosrc LIKE '%evo.waha_history_import%' AND p.prosecdef FROM pg_proc p
   WHERE p.oid = 'platform_private.broadcast_platform_messaging_invalidation()'::REGPROCEDURE)
  AND (SELECT pg_get_constraintdef(c.oid) LIKE '%@lid%' FROM pg_constraint c
       WHERE c.conname = 'waha_history_message_observations_normalized_chat_id_check'),
  'the realtime trigger honours the import page switch and the observation table admits LID chats');
SELECT pg_temp.n260_assert(
  (SELECT count(*) = 0 FROM pg_class c WHERE c.relnamespace = 'platform_private'::REGNAMESPACE AND c.relname LIKE 'waha_history%'
     AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))
  AND NOT has_table_privilege('service_role', 'platform_private.waha_history_reconciliation_runs', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.waha_history_message_observations', 'SELECT'),
  'the history tables keep forced RLS and no client grants');

SELECT 'N260_WAHA_HISTORY_IMPORT_SUITE_OK' AS n260_suite_result;

ROLLBACK;
