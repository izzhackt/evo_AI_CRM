\set ON_ERROR_STOP on
-- Boundary suite for migration 259: the direct WAHA -> CRM ingress keeps the
-- whole sales WhatsApp correspondence in the CRM. Runs on the LATEST chain with
-- its own synthetic organization and Admin; no provider, Auth invitation, real
-- person or production action. Every message goes through the REAL projection
-- chain the webhook uses (enqueue, exact claim, project, finish).
--
-- Proves:
--  1. @lid chats: a LID customer is bound on the LID chat id (the id replies go
--     to) and gets a client WITHOUT a phone (never a number made of LID
--     digits), named by the sanitized push name or «WhatsApp контакт» plus a
--     suffix; a phone given by the payload's explicit alternative field becomes
--     the client's phone and the identity key, so the same person's @c.us chat
--     resolves to the same client and lead; a LID event whose payload names the
--     phone of an already bound @c.us chat reuses that conversation;
--  2. the c.us path is unchanged (client «WhatsApp ••••NNNN», +phone, lead);
--  3. typed media markers (photo, video, voice, audio, sticker, file with and
--     without a name), caption on the next line, handoff only for media-only,
--     the generic notice for an event with neither text nor media, re-delivery
--     idempotency, and a message projected by migration 060's rule is still
--     recognised;
--  4. messages sent from the phone/app (fromMe, source app): outbound rows under
--     private_waha_phone_binding in the same conversation, the CRM's own API
--     echo and an already manual-send-bound id are never projected, a
--     phone-sent message to an unknown chat is deferred (no conversation, no
--     client, no lead) and projected in order when the customer's first message
--     creates the conversation, ACKs update its status, and an unverified
--     origin is refused;
--  5. engine shapes (derived from the upstream source, see the PR description):
--     GOWS reports a direct chat with `from` = the chat in BOTH directions,
--     `to` = null and `_data.Info.{Chat,Sender,IsFromMe,SenderAlt,RecipientAlt,
--     PushName}`; WEBJS reports `from` = the own number and `to` = the customer
--     for a message sent from the phone. The customer chat of a phone-sent
--     message resolves from `to`, else `_data.Info.Chat`, else `from`; the own
--     number (the signed envelope's `me`, or an own device's `Info.Sender`) is
--     never a customer and never a customer's phone, also when an alternative
--     JID names it (devlikeapro/waha#2241); GOWS media kinds come from
--     `_data.Message`;
--  6. constraints and catalog: an outbound row needs a manual authorization or
--     the phone-sent identity AND its verified fromMe/app evidence; the new
--     private routines are definer, empty search_path and callable by no client
--     role, the touched ones keep their ACL; reply routing reads the bound id.
BEGIN;

DO $n259_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n259_auth_role$;

CREATE FUNCTION pg_temp.n259_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n259_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N259: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n259_message(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
END
$$;

SELECT 'N259_WAHA_LID_PHONE_MEDIA_SUITE_START' AS n259_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: one organization and one system Admin, the intake owner.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n259_id(1), 'N259 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES (pg_temp.n259_id(101), 'n259-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n259_id(201), pg_temp.n259_id(101), 'N259 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n259_id(301), pg_temp.n259_id(1), pg_temp.n259_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published'
      ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n259_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n259_id(401), pg_temp.n259_id(1), 'organization', pg_temp.n259_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n259_id(1), pg_temp.n259_id(301), pg_temp.n259_id(401), 1, 1, TRUE, 'system',
    'N259 synthetic organization scope', pg_temp.n259_id(601));

-- Clear the shared queue of earlier suites' leftovers so only this fixture is claimed.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();

-- Insert one verified WAHA event row (what persist_provider_webhook_event stores).
CREATE FUNCTION pg_temp.n259_event(p_n INTEGER, p_event TEXT, p_payload JSONB,
  p_occurred TIMESTAMPTZ DEFAULT NULL, p_me JSONB DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  event_id CONSTANT UUID := pg_temp.n259_id(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.n259_id(1), 'waha', 'waha:crm_primary', NULL,
    CASE WHEN p_event = 'message.ack' THEN lower(p_payload ->> 'ackName') END, 'n259-' || p_n, 'crm_primary',
    p_payload ->> 'id', p_event, COALESCE(p_occurred, TIMESTAMPTZ '2026-10-03 07:00:00+00' + p_n * INTERVAL '1 second'),
    'verified', jsonb_build_object('event', p_event, 'session', 'crm_primary', 'payload', p_payload)
      || CASE WHEN p_me IS NULL THEN '{}'::JSONB ELSE jsonb_build_object('me', p_me) END,
    '{"hmac_verified":true}', 'synthetic:n259:' || p_n, lpad(to_hex(p_n), 64, '0'), pg_temp.n259_id(1500 + p_n));
  RETURN event_id;
END
$$;

-- Enqueue, claim, project and finish one already inserted event (the real chain); returns the
-- projection result plus the finish state.
CREATE FUNCTION pg_temp.n259_work(p_n INTEGER, p_event TEXT, p_event_id UUID, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n259_id(1);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, p_event_id,
    encode(sha256(convert_to('n259-' || p_event || '-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n259_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n259', pg_temp.n259_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  IF p_event = 'message.ack' THEN
    proj := platform.project_claimed_waha_observation(org, work, attempt, pg_temp.n259_id(301), pg_temp.n259_id(2000 + p_n * 10 + 3));
    fin := platform.finish_waha_event_projection(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
      proj ->> 'error_code', proj ->> 'evidence_ref', CASE WHEN proj ->> 'disposition' = 'retryable_error' THEN 30 END,
      pg_temp.n259_id(2000 + p_n * 10 + 4));
  ELSE
    proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n259_id(301), pg_temp.n259_id(2000 + p_n * 10 + 3));
    fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
      proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n259_id(2000 + p_n * 10 + 4));
  END IF;
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state', 'work_item_id', work, 'event_id', p_event_id);
END
$$;

-- One verified WAHA event through the real chain; returns the projection result
-- plus the finish state. `p_n` makes every id unique.
CREATE FUNCTION pg_temp.n259_run(p_n INTEGER, p_event TEXT, p_payload JSONB,
  p_occurred TIMESTAMPTZ DEFAULT NULL, p_me JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.n259_work(p_n, p_event, pg_temp.n259_event(p_n, p_event, p_payload, p_occurred, p_me), p_payload);
END
$$;

-- The enqueue gate's answer for one event row: SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.n259_enqueue(p_event UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  PERFORM platform.enqueue_verified_webhook_work(pg_temp.n259_id(1), p_event,
    encode(sha256(convert_to('n259-gate-' || p_event::TEXT, 'UTF8')), 'hex'), 8, gen_random_uuid());
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;

-- A customer message and a message sent from the phone, as WAHA reports them.
CREATE FUNCTION pg_temp.n259_in(p_id TEXT, p_from TEXT, p_extra JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', p_from, 'fromMe', false, 'source', 'app') || p_extra
$$;
CREATE FUNCTION pg_temp.n259_out(p_id TEXT, p_to TEXT, p_extra JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', '79990000000@c.us', 'to', p_to,
    'fromMe', true, 'source', 'app') || p_extra
$$;
CREATE FUNCTION pg_temp.n259_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.n259_id(1) AND binding.normalized_chat_id = p_chat
$$;
CREATE FUNCTION pg_temp.n259_bodies(p_conversation UUID) RETURNS TEXT[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(m.direction || ':' || m.body_text ORDER BY m.created_at, m.id), ARRAY[]::TEXT[])
  FROM platform.communication_messages m WHERE m.conversation_id = p_conversation
$$;

-- ---------------------------------------------------------------------------
-- 2. The c.us path is unchanged.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n259_run(1, 'message.any', pg_temp.n259_in('false_79990000001@c.us_A1', '79990000001@c.us',
  '{"body":"Здравствуйте"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND NOT (:'r'::JSONB ->> 'human_review_required')::BOOLEAN, 'c.us text message projects');
SELECT pg_temp.n259_assert(
  (SELECT c.subject = 'WhatsApp ••••0001' AND cl.display_name = 'WhatsApp ••••0001' AND cl.phone = '+79990000001'
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n259_conv('79990000001@c.us') AND c.canonical_lead_id IS NOT NULL),
  'c.us: subject, client name and +phone exactly as before, lead created');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform.external_identifiers e
   WHERE e.organization_id = pg_temp.n259_id(1) AND e.external_object_type = 'direct_chat' AND e.external_identifier = 'crm_primary:79990000001@c.us'),
  'c.us: external identity is the phone chat id');
SELECT pg_temp.n259_assert(
  pg_temp.n259_bodies(pg_temp.n259_conv('79990000001@c.us')) = ARRAY['inbound:Здравствуйте'], 'c.us: one inbound message');

-- ---------------------------------------------------------------------------
-- 1. @lid chats.
-- ---------------------------------------------------------------------------
-- 1a. A LID customer without a phone and without a push name.
SELECT pg_temp.n259_run(2, 'message.any', pg_temp.n259_in('false_123456789012345@lid_L1', '123456789012345@lid',
  '{"body":"Hello from a LID"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded',
  'LID text message projects');
SELECT pg_temp.n259_assert(pg_temp.n259_conv('123456789012345@lid') IS NOT NULL,
  'the binding stays on the LID chat id (the id a reply is sent to)');
SELECT pg_temp.n259_assert(
  (SELECT c.subject LIKE 'WhatsApp контакт #____' AND cl.display_name = c.subject
     AND cl.phone IS NULL AND cl.normalized_phone IS NULL AND c.canonical_lead_id IS NOT NULL
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n259_conv('123456789012345@lid')),
  'LID without phone: «WhatsApp контакт #xxxx», NO phone, lead exists');
SELECT pg_temp.n259_assert(
  NOT EXISTS (SELECT 1 FROM platform.clients cl WHERE cl.organization_id = pg_temp.n259_id(1)
    AND (cl.phone LIKE '%123456789012345%' OR cl.normalized_phone LIKE '%123456789012345%' OR cl.display_name LIKE '%123456789012345%')),
  'no client carries LID digits as a phone or a name');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform.external_identifiers e
   WHERE e.organization_id = pg_temp.n259_id(1) AND e.external_object_type = 'direct_chat' AND e.external_identifier = 'crm_primary:123456789012345@lid'),
  'LID without phone: identity key is the LID chat');

-- 1b. A LID customer with a sanitized push name (control and bidi characters removed).
SELECT pg_temp.n259_run(3, 'message.any', pg_temp.n259_in('false_223456789012345@lid_L2', '223456789012345@lid',
  jsonb_build_object('body', 'Hi', '_data', jsonb_build_object('notifyName',
    E'  Анна‮ \n  Иванова​  ')))) AS r \gset
SELECT pg_temp.n259_assert(
  (SELECT c.subject LIKE 'Анна Иванова #____' AND cl.phone IS NULL
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n259_conv('223456789012345@lid')),
  'LID push name: sanitized, suffixed, no phone');

-- 1c. A LID customer whose payload names the phone (GOWS SenderAlt): the phone
-- becomes the client phone and the identity key; the binding stays on the LID.
SELECT pg_temp.n259_run(4, 'message.any', pg_temp.n259_in('false_323456789012345@lid_L3', '323456789012345@lid',
  jsonb_build_object('body', 'With a phone', '_data', jsonb_build_object('Info',
    jsonb_build_object('SenderAlt', '79990000003:7@s.whatsapp.net', 'PushName', 'Ignored')))) ) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND pg_temp.n259_conv('323456789012345@lid') IS NOT NULL
  AND pg_temp.n259_conv('79990000003@c.us') IS NULL, 'LID with a phone is bound on the LID, not on the phone');
SELECT pg_temp.n259_assert(
  (SELECT c.subject = 'WhatsApp ••••0003' AND cl.display_name = 'WhatsApp ••••0003' AND cl.phone = '+79990000003'
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id = pg_temp.n259_conv('323456789012345@lid')),
  'LID with phone alternative: client phone and label come from the phone');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform.external_identifiers e
   WHERE e.organization_id = pg_temp.n259_id(1) AND e.external_object_type = 'direct_chat' AND e.external_identifier = 'crm_primary:79990000003@c.us'),
  'LID with phone: identity key is the phone chat id');

-- 1d. The same person later writes from the phone chat id: NO second client or lead.
SELECT pg_temp.n259_run(5, 'message.any', pg_temp.n259_in('false_79990000003@c.us_C3', '79990000003@c.us',
  '{"body":"Now by phone"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND pg_temp.n259_conv('79990000003@c.us') IS NOT NULL
  AND pg_temp.n259_conv('79990000003@c.us') <> pg_temp.n259_conv('323456789012345@lid'),
  'the phone chat gets its own conversation');
SELECT pg_temp.n259_assert(
  (SELECT count(DISTINCT c.canonical_client_id) = 1 AND count(DISTINCT c.canonical_lead_id) = 1
   FROM platform.communication_conversations c
   WHERE c.id IN (pg_temp.n259_conv('323456789012345@lid'), pg_temp.n259_conv('79990000003@c.us'))),
  'the LID chat and the phone chat of one person share one client and one lead');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform.clients cl WHERE cl.organization_id = pg_temp.n259_id(1) AND cl.normalized_phone = '+79990000003'),
  'exactly one client holds that phone');

-- 1e. A LID event whose payload names the phone of an already bound c.us chat
-- reuses that conversation (no second binding); the reply target stays the bound id.
SELECT pg_temp.n259_run(6, 'message.any', pg_temp.n259_in('false_423456789012345@lid_L4', '423456789012345@lid',
  jsonb_build_object('body', 'Different id, same person', '_data', jsonb_build_object('key',
    jsonb_build_object('remoteJidAlt', '79990000001@s.whatsapp.net'))))) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000001@c.us')
  AND pg_temp.n259_conv('423456789012345@lid') IS NULL,
  'LID event naming a bound phone reuses that conversation and creates no binding');
SELECT pg_temp.n259_assert(
  pg_temp.n259_bodies(pg_temp.n259_conv('79990000001@c.us')) = ARRAY['inbound:Здравствуйте', 'inbound:Different id, same person'],
  'both messages are in the one conversation');

-- 1f. Candidates of the same kind that disagree are a conflict; an unsupported suffix is refused.
SELECT pg_temp.n259_run(7, 'message.any', pg_temp.n259_in('false_x_L5', '523456789012345@lid',
  jsonb_build_object('body', 'x', 'chatId', '623456789012345@lid'))) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'error_code' = 'waha_inbound_chat_conflict', 'two different LIDs conflict');
SELECT pg_temp.n259_run(8, 'message.any', pg_temp.n259_in('false_x_G1', '120363000000000001@g.us', '{"body":"x"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'error_code' = 'waha_inbound_unsupported_chat', 'a group chat is unsupported');

-- ---------------------------------------------------------------------------
-- 3. Typed media markers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n259_media(p_n INTEGER, p_chat TEXT, p_extra JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.n259_run(p_n, 'message.any', pg_temp.n259_in('false_media_' || p_n, p_chat, p_extra))
$$;
CREATE FUNCTION pg_temp.n259_last_body(p_conversation UUID) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT m.body_text FROM platform.communication_messages m WHERE m.conversation_id = p_conversation
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.n259_handoffs(p_conversation UUID) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.conversation_handoff_events h WHERE h.conversation_id = p_conversation
$$;

-- Media only, photo: marker is the whole message and the staff handoff exists.
SELECT pg_temp.n259_media(10, '79990000010@c.us', '{"body":"","hasMedia":true,"media":{"mimetype":"image/jpeg","filename":null}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Фото — откройте в WhatsApp продаж'
  AND (:'r'::JSONB ->> 'human_review_required')::BOOLEAN AND pg_temp.n259_handoffs(pg_temp.n259_conv('79990000010@c.us')) = 1
  AND :'r'::JSONB ->> 'finish_state' = 'succeeded', 'media-only photo: typed marker plus handoff');
-- With a caption: marker, caption on the next line, no handoff.
SELECT pg_temp.n259_media(11, '79990000010@c.us', '{"body":"Мой диплом","hasMedia":true,"media":{"mimetype":"image/png"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = E'📎 Фото — откройте в WhatsApp продаж\nМой диплом'
  AND NOT (:'r'::JSONB ->> 'human_review_required')::BOOLEAN AND pg_temp.n259_handoffs(pg_temp.n259_conv('79990000010@c.us')) = 1,
  'captioned photo: marker, caption on a new line, no extra handoff');
SELECT pg_temp.n259_media(12, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"video/mp4"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Видео — откройте в WhatsApp продаж', 'video');
SELECT pg_temp.n259_media(13, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"audio/ogg; codecs=opus"},"_data":{"type":"ptt"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Голосовое сообщение — откройте в WhatsApp продаж', 'voice message');
SELECT pg_temp.n259_media(14, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"audio/mpeg"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Аудио — откройте в WhatsApp продаж', 'audio');
SELECT pg_temp.n259_media(15, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"image/webp"},"_data":{"type":"sticker"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Стикер — откройте в WhatsApp продаж', 'sticker');
SELECT pg_temp.n259_media(16, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"application/pdf","filename":"passport  scan.pdf"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Файл: passport scan.pdf — откройте в WhatsApp продаж', 'file with its name');
SELECT pg_temp.n259_media(17, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"application/zip","filename":null}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Файл — откройте в WhatsApp продаж', 'file without a name');
SELECT pg_temp.n259_media(18, '79990000010@c.us', '{"hasMedia":true,"media":{"mimetype":"image/jpeg"},"_data":{"type":"document"},"body":"scan"}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = E'📎 Файл — откройте в WhatsApp продаж\nscan', 'a document sent as an image is a file');
-- The media object alone (hasMedia absent) is media too.
SELECT pg_temp.n259_media(19, '79990000010@c.us', '{"media":{"mimetype":"image/gif"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '📎 Фото — откройте в WhatsApp продаж', 'media object without hasMedia');
-- Neither text nor media: the generic notice and the handoff stay (honest, uninterpreted).
SELECT pg_temp.n259_media(20, '79990000010@c.us', '{"body":null}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000010@c.us')) = '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.'
  AND (:'r'::JSONB ->> 'human_review_required')::BOOLEAN, 'no text and no media keeps the generic notice');
-- The LID path shares the marker.
SELECT pg_temp.n259_media(21, '723456789012345@lid', '{"hasMedia":true,"media":{"mimetype":"video/mp4"}}') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('723456789012345@lid')) = '📎 Видео — откройте в WhatsApp продаж'
  AND pg_temp.n259_handoffs(pg_temp.n259_conv('723456789012345@lid')) = 1, 'LID media-only: marker and handoff on the first message');

-- Re-delivery of a finished work item is a no-op: nothing is added.
SELECT count(*) AS messages_before FROM platform.communication_messages WHERE organization_id = pg_temp.n259_id(1) \gset
SELECT pg_temp.n259_assert(
  (platform.claim_waha_webhook_work_item(pg_temp.n259_id(1), (:'r'::JSONB ->> 'work_item_id')::UUID, 60, 'n259', pg_temp.n259_id(9001))
    ->> 'claimed')::BOOLEAN IS NOT TRUE
  AND (SELECT count(*) FROM platform.communication_messages WHERE organization_id = pg_temp.n259_id(1)) = :messages_before,
  're-delivery of a projected event claims nothing and adds nothing');

-- A message stored by migration 060's rule (caption only) is still the same message.
SELECT pg_temp.n259_assert(
  platform_private.waha_message_content('{"body":"Мой диплом","hasMedia":true,"media":{"mimetype":"image/png"}}') ->> 'legacy_body' = 'Мой диплом'
  AND platform_private.waha_message_content('{"hasMedia":true,"media":{"mimetype":"image/png"}}') ->> 'legacy_body'
    = '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.',
  'the 060 body of a media message is known');

-- ---------------------------------------------------------------------------
-- 4. Messages sent from the phone / WhatsApp app.
-- ---------------------------------------------------------------------------
-- 4a. To a bound chat: an outbound message under its own identity, same conversation.
SELECT pg_temp.n259_run(30, 'message.any', pg_temp.n259_out('true_79990000001@c.us_P1', '79990000001@c.us',
  '{"body":"Ответ с телефона"}'), TIMESTAMPTZ '2026-10-03 11:00:00+00') AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000001@c.us'),
  'phone-sent message to a bound chat projects into its conversation');
SELECT pg_temp.n259_assert(
  (SELECT m.direction = 'outbound' AND m.message_identity_source = 'private_waha_phone_binding'
     AND m.manual_send_authorization_id IS NULL AND m.autonomous_reply_intent_id IS NULL
     AND m.created_at = TIMESTAMPTZ '2026-10-03 11:00:00+00' AND p.participant_kind = 'sales' AND NOT m.student_visible
   FROM platform.communication_messages m JOIN platform.conversation_participants p ON p.id = m.sender_participant_id
   WHERE m.id = (:'r'::JSONB ->> 'communication_message_id')::UUID),
  'phone-sent message: outbound, its own identity source, no authorization, sales participant, provider time');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform_private.waha_message_bindings b
   WHERE b.organization_id = pg_temp.n259_id(1) AND b.raw_message_id = 'true_79990000001@c.us_P1'),
  'phone-sent message has one private provider binding');
-- The helper is idempotent on its own: the same event again is a duplicate, not a second row.
SELECT pg_temp.n259_assert(
  platform_private.project_waha_phone_sent_message(pg_temp.n259_id(1), (:'r'::JSONB ->> 'event_id')::UUID,
    pg_temp.n259_conv('79990000001@c.us'), (:'r'::JSONB ->> 'sales_participant_id')::UUID) ->> 'outcome' = 'duplicate'
  AND (SELECT count(*) FROM platform.communication_messages m WHERE m.body_text = 'Ответ с телефона') = 1,
  'a phone-sent message is never inserted twice');

-- 4b. The CRM's own API send echoing back never even reaches the queue; the projection
-- guard behind it (and for an unverified origin) refuses to store it.
SELECT pg_temp.n259_event(31, 'message.any', pg_temp.n259_out('true_79990000001@c.us_API1', '79990000001@c.us',
  '{"body":"Sent from the CRM","source":"api"}')) AS ev_api \gset
SELECT pg_temp.n259_event(32, 'message.any', pg_temp.n259_out('true_79990000001@c.us_NS1', '79990000001@c.us',
  '{"body":"no source"}') - 'source') AS ev_nosrc \gset
SELECT pg_temp.n259_assert(pg_temp.n259_enqueue(:'ev_api') = '22023' AND pg_temp.n259_enqueue(:'ev_nosrc') = '22023',
  'the queue refuses a fromMe event whose origin is api or unknown');
SELECT pg_temp.n259_assert(
  platform_private.project_waha_phone_sent_message(pg_temp.n259_id(1), :'ev_api', pg_temp.n259_conv('79990000001@c.us'),
    (SELECT p.id FROM platform.conversation_participants p WHERE p.conversation_id = pg_temp.n259_conv('79990000001@c.us')
       AND p.participant_kind = 'sales')) ->> 'outcome' = 'crm_send_echo'
  AND platform_private.project_waha_phone_sent_message(pg_temp.n259_id(1), :'ev_nosrc', pg_temp.n259_conv('79990000001@c.us'),
    (SELECT p.id FROM platform.conversation_participants p WHERE p.conversation_id = pg_temp.n259_conv('79990000001@c.us')
       AND p.participant_kind = 'sales')) ->> 'outcome' = 'source_unverified'
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m WHERE m.body_text IN ('Sent from the CRM', 'no source')),
  'the projection guard: an api echo and an unverified origin store nothing');
-- ...and neither is an id that manual send already bound, even if the origin says app.
SET LOCAL session_replication_role = replica;
INSERT INTO platform_private.manual_send_provider_bindings(organization_id, manual_send_authorization_id, durable_work_item_id,
  durable_work_attempt_id, communication_message_id, waha_session_name, raw_message_id, provider_observed_at)
  VALUES (pg_temp.n259_id(1), pg_temp.n259_id(7001), pg_temp.n259_id(7002), pg_temp.n259_id(7003), pg_temp.n259_id(7004),
    'crm_primary', 'true_79990000001@c.us_MB1', TIMESTAMPTZ '2026-10-03 11:00:00+00');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.n259_run(37, 'message.any', pg_temp.n259_out('true_79990000001@c.us_MB1', '79990000001@c.us',
  '{"body":"Bound by manual send"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'crm_send_echo'
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m WHERE m.body_text = 'Bound by manual send'),
  'an id already bound by manual send is never projected as phone-sent');
-- An empty fromMe event is ignored.
SELECT pg_temp.n259_run(33, 'message.any', pg_temp.n259_out('true_79990000001@c.us_E1', '79990000001@c.us', '{"body":""}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'empty_message', 'empty phone-sent event is ignored');
-- Phone-sent media gets the typed marker too (no handoff for outgoing).
SELECT pg_temp.n259_run(34, 'message.any', pg_temp.n259_out('true_79990000001@c.us_M1', '79990000001@c.us',
  '{"hasMedia":true,"media":{"mimetype":"application/pdf","filename":"offer.pdf"}}'), TIMESTAMPTZ '2026-10-03 11:02:00+00') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000001@c.us')) = '📎 Файл: offer.pdf — откройте в WhatsApp продаж'
  AND NOT (:'r'::JSONB ->> 'human_review_required')::BOOLEAN, 'phone-sent media: typed marker, no handoff');

-- 4c. To a LID chat; the alternative field names the phone of the same chat.
SELECT pg_temp.n259_run(35, 'message.any', pg_temp.n259_out('true_323456789012345@lid_P2', '323456789012345@lid',
  '{"body":"To a LID chat"}'), TIMESTAMPTZ '2026-10-03 11:05:00+00') AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('323456789012345@lid'),
  'phone-sent message to a LID chat lands in the LID conversation');
SELECT pg_temp.n259_run(36, 'message.any', pg_temp.n259_out('true_x_P3', '923456789012345@lid',
  jsonb_build_object('body', 'Phone of a bound chat', '_data', jsonb_build_object('Info', jsonb_build_object('RecipientAlt', '79990000003@s.whatsapp.net')))),
  TIMESTAMPTZ '2026-10-03 11:06:00+00') AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000003@c.us')
  AND pg_temp.n259_conv('923456789012345@lid') IS NULL, 'RecipientAlt resolves a LID target to the bound phone chat');

-- 4d. To a chat with no conversation yet: deferred, nothing created, then
-- projected in order once the customer's first message creates the conversation.
SELECT count(*) AS clients_before FROM platform.clients WHERE organization_id = pg_temp.n259_id(1) \gset
SELECT count(*) AS leads_before FROM platform.leads WHERE organization_id = pg_temp.n259_id(1) \gset
SELECT count(*) AS conversations_before FROM platform.communication_conversations WHERE organization_id = pg_temp.n259_id(1) \gset
SELECT pg_temp.n259_run(40, 'message.any', pg_temp.n259_out('true_79990000040@c.us_D1', '79990000040@c.us',
  '{"body":"Первое исходящее"}'), TIMESTAMPTZ '2026-10-03 09:00:00+00') AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'deferred')::BOOLEAN AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'r'::JSONB ->> 'disposition' = 'succeeded', 'phone-sent message to an unknown chat is deferred');
SELECT pg_temp.n259_run(41, 'message.any', pg_temp.n259_out('true_79990000040@c.us_D2', '79990000040@c.us',
  '{"body":"Второе исходящее"}'), TIMESTAMPTZ '2026-10-03 09:30:00+00') AS r \gset
SELECT pg_temp.n259_assert(
  (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.n259_id(1)) = :clients_before
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n259_id(1)) = :leads_before
  AND (SELECT count(*) FROM platform.communication_conversations WHERE organization_id = pg_temp.n259_id(1)) = :conversations_before
  AND pg_temp.n259_conv('79990000040@c.us') IS NULL
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m WHERE m.body_text IN ('Первое исходящее', 'Второе исходящее')),
  'an outgoing-only chat creates no conversation, binding, client, lead or message');
SELECT pg_temp.n259_run(42, 'message.any', pg_temp.n259_in('false_79990000040@c.us_D3', '79990000040@c.us',
  '{"body":"Ответ клиента"}'), TIMESTAMPTZ '2026-10-03 10:00:00+00') AS r \gset
SELECT pg_temp.n259_assert(
  pg_temp.n259_bodies(pg_temp.n259_conv('79990000040@c.us')) =
    ARRAY['outbound:Первое исходящее', 'outbound:Второе исходящее', 'inbound:Ответ клиента'],
  'the first customer message creates the conversation and the earlier phone-sent messages are in it, in provider order');
SELECT pg_temp.n259_assert(:'r'::JSONB -> 'deferred_phone_sent' = '{"deferred":2,"projected":2,"dropped":0}'::JSONB,
  'the projection result records how many deferred messages were found, projected and dropped');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 1 FROM platform.communication_conversations c
   WHERE c.id = pg_temp.n259_conv('79990000040@c.us') AND c.canonical_lead_id IS NOT NULL)
  AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n259_id(1)) = :leads_before + 1,
  'the lead is created by the customer message, not by the outgoing messages');
-- A second customer message does not project them again.
SELECT pg_temp.n259_run(43, 'message.any', pg_temp.n259_in('false_79990000040@c.us_D4', '79990000040@c.us', '{"body":"Ещё"}'),
  TIMESTAMPTZ '2026-10-03 10:05:00+00') AS r \gset
SELECT pg_temp.n259_assert(array_length(pg_temp.n259_bodies(pg_temp.n259_conv('79990000040@c.us')), 1) = 4,
  'a later customer message adds exactly one row');

-- 4e. A deferred message to a LID chat that arrives later as a LID chat with a phone.
SELECT pg_temp.n259_run(44, 'message.any', pg_temp.n259_out('true_x_D5', '823456789012345@lid', '{"body":"Раньше"}'),
  TIMESTAMPTZ '2026-10-03 08:00:00+00') AS r \gset
SELECT pg_temp.n259_run(45, 'message.any', pg_temp.n259_in('false_823456789012345@lid_D6', '823456789012345@lid', '{"body":"Позже"}'),
  TIMESTAMPTZ '2026-10-03 08:30:00+00') AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_bodies(pg_temp.n259_conv('823456789012345@lid')) = ARRAY['outbound:Раньше', 'inbound:Позже'],
  'a deferred message to a LID chat is projected when that LID chat creates its conversation');

-- 4f. ACKs of a phone-sent message update its status like any bound outbound message.
SELECT pg_temp.n259_run(50, 'message.ack', jsonb_build_object('id', 'true_79990000001@c.us_P1', 'fromMe', true, 'ack', 3, 'ackName', 'READ',
  'to', '79990000001@c.us'), TIMESTAMPTZ '2026-10-03 11:10:00+00') AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (SELECT a.waha_ack_name = 'READ' FROM platform.waha_message_ack_current a
       JOIN platform_private.waha_message_bindings b ON b.communication_message_id = a.communication_message_id
       WHERE b.raw_message_id = 'true_79990000001@c.us_P1'),
  'an ACK of a phone-sent message is recorded');

-- 4g. More than 200 deferred messages: the 200 MOST RECENT are projected in chronological order
-- and the rest are counted as dropped, not silently lost.
SELECT count(pg_temp.n259_run(199 + k, 'message.any', pg_temp.n259_out('true_79990000200@c.us_B' || k, '79990000200@c.us',
  jsonb_build_object('body', 'D' || k)), TIMESTAMPTZ '2026-10-02 00:00:00+00' + k * INTERVAL '1 minute')) AS deferred_runs
FROM generate_series(1, 205) AS k \gset
SELECT pg_temp.n259_run(405, 'message.any', pg_temp.n259_in('false_79990000200@c.us_B0', '79990000200@c.us', '{"body":"Первый ответ клиента"}'),
  TIMESTAMPTZ '2026-10-03 00:00:00+00') AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB -> 'deferred_phone_sent' = '{"deferred":205,"projected":200,"dropped":5}'::JSONB,
  'beyond 200 deferred messages the drop is counted in the projection result');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 201 AND min(m.body_text) FILTER (WHERE m.direction = 'outbound') = 'D10'
     AND (array_agg(m.body_text ORDER BY m.created_at, m.id))[1] = 'D6'
     AND (array_agg(m.body_text ORDER BY m.created_at, m.id))[200] = 'D205'
     AND (array_agg(m.body_text ORDER BY m.created_at, m.id))[201] = 'Первый ответ клиента'
   FROM platform.communication_messages m WHERE m.conversation_id = pg_temp.n259_conv('79990000200@c.us')),
  'the newest 200 (D6..D205) are in the conversation in chronological order, D1..D5 are not');

-- 4h. ACKs with no message to update are observed, not retried; an ACK that may still find its binding is.
-- A deferred phone-sent message (its chat has no conversation) ...
SELECT pg_temp.n259_run(410, 'message.any', pg_temp.n259_out('true_79990000300@c.us_AD1', '79990000300@c.us', '{"body":"Deferred, then acked"}')) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'deferred')::BOOLEAN, 'the message is deferred');
SELECT pg_temp.n259_run(411, 'message.ack', jsonb_build_object('id', 'true_79990000300@c.us_AD1', 'fromMe', true, 'ack', 2, 'ackName', 'DEVICE',
  'to', '79990000300@c.us')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND :'r'::JSONB ->> 'ignored' = 'ack_without_projected_message'
  AND NOT EXISTS (SELECT 1 FROM platform_private.waha_event_projection_effects e WHERE e.work_item_id = (:'r'::JSONB ->> 'work_item_id')::UUID),
  'an ACK of a deferred phone-sent message is observed: no retry, no effect row');
-- ... and an id manual send already bound (the CRM's own send) are never retried.
SELECT pg_temp.n259_run(412, 'message.ack', jsonb_build_object('id', 'true_79990000001@c.us_MB1', 'fromMe', true, 'ack', 3, 'ackName', 'READ',
  'to', '79990000001@c.us')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'ignored' = 'ack_without_projected_message',
  'an ACK of a manual-send-bound id is observed, not retried');
-- An ACK whose message has no evidence at all, or whose original event was a CRM API send that is not bound yet,
-- keeps the retry (the binding may still appear).
SELECT pg_temp.n259_run(413, 'message.ack', jsonb_build_object('id', 'true_79990000001@c.us_UNKNOWN', 'fromMe', true, 'ack', 1, 'ackName', 'SERVER',
  'to', '79990000001@c.us')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'retryable_error' AND :'r'::JSONB ->> 'error_code' = 'waha_ack_binding_pending',
  'an ACK with no evidence of its message stays retryable');
SELECT pg_temp.n259_event(414, 'message.any', pg_temp.n259_out('true_79990000001@c.us_APIPEND', '79990000001@c.us',
  '{"body":"CRM send, binding not visible yet","source":"api"}')) AS ev_apipend \gset
SELECT pg_temp.n259_run(415, 'message.ack', jsonb_build_object('id', 'true_79990000001@c.us_APIPEND', 'fromMe', true, 'ack', 1, 'ackName', 'SERVER',
  'to', '79990000001@c.us')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'error_code' = 'waha_ack_binding_pending',
  'an ACK of a CRM API send whose binding is not visible yet stays retryable');

-- 4i. A phone-sent message to an EXISTING conversation whose ACK arrives before the message is projected:
-- the message is only not projected YET, so the ACK is retried (not observed and lost), and applied once the
-- message is bound. Only an original that the projection recorded as deferred answers an ACK as observed.
SELECT pg_temp.n259_out('true_79990000001@c.us_EARLY1', '79990000001@c.us', '{"body":"ACK arrives first"}') AS early_payload \gset
SELECT pg_temp.n259_event(420, 'message.any', :'early_payload'::JSONB, TIMESTAMPTZ '2026-10-03 12:00:00+00') AS ev_early \gset
SELECT pg_temp.n259_run(421, 'message.ack', jsonb_build_object('id', 'true_79990000001@c.us_EARLY1', 'fromMe', true, 'ack', 2, 'ackName', 'DEVICE',
  'to', '79990000001@c.us')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'retryable_error' AND :'r'::JSONB ->> 'error_code' = 'waha_ack_binding_pending'
  AND :'r'::JSONB ->> 'finish_state' = 'retry_wait',
  'an ACK of a phone-sent message that is merely not projected yet is retried, not observed');
SELECT (:'r'::JSONB ->> 'work_item_id')::UUID AS early_ack_work \gset
SELECT pg_temp.n259_work(422, 'message.any', :'ev_early'::UUID, :'early_payload'::JSONB) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000001@c.us'),
  'the message is then projected into its existing conversation');
-- The retry of the same ACK work item now finds the binding and applies the acknowledgement.
UPDATE platform_private.durable_work_items SET available_at = clock_timestamp() - INTERVAL '1 second' WHERE id = :'early_ack_work';
UPDATE pgmq.q_platform_work_v1 SET vt = clock_timestamp() - INTERVAL '1 second'
  WHERE msg_id = (SELECT queue_message_id FROM platform_private.durable_work_items WHERE id = :'early_ack_work');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE) AS jwt_claims \gset
SELECT platform.claim_waha_webhook_work_item(pg_temp.n259_id(1), :'early_ack_work', 60, 'n259', pg_temp.n259_id(9101)) AS retry_claim \gset
SELECT pg_temp.n259_assert((:'retry_claim'::JSONB ->> 'claimed')::BOOLEAN, 'the retried ACK work item is claimed again');
SELECT platform.project_claimed_waha_observation(pg_temp.n259_id(1), :'early_ack_work', (:'retry_claim'::JSONB ->> 'attempt_id')::UUID,
  pg_temp.n259_id(301), pg_temp.n259_id(9102)) AS retry_proj \gset
SELECT pg_temp.n259_assert(:'retry_proj'::JSONB ->> 'disposition' = 'succeeded' AND :'retry_proj'::JSONB ->> 'ignored' IS NULL
  AND (SELECT a.waha_ack_name = 'DEVICE' FROM platform.waha_message_ack_current a
       JOIN platform_private.waha_message_bindings b ON b.communication_message_id = a.communication_message_id
       WHERE b.raw_message_id = 'true_79990000001@c.us_EARLY1'),
  'after the message is bound the retried ACK is applied to it');

-- ---------------------------------------------------------------------------
-- 5. Engine shapes. Synthetic payloads built from the upstream source: GOWS
-- (WAHA getFromToParticipant over whatsmeow events.Message) reports a direct chat
-- with from = the CHAT in both directions, to = null and `_data.Info`; WEBJS
-- reports from = own, to = customer for a message sent from the phone.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n259_me() RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT '{"id":"79990000000@c.us","lid":"900000000000001@lid","jid":"79990000000:12@s.whatsapp.net","pushName":"EVO Sales"}'::JSONB
$$;
CREATE FUNCTION pg_temp.n259_rawjid(p_chat TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT replace(p_chat, '@c.us', '@s.whatsapp.net')
$$;
-- WAHA 2026.9.2 (GOWS getSourceDeviceByMsg) labels a message `api` exactly when the device in
-- `_data.Info.Sender` is the session's own linked device (the device of me.jid, 12 here) and `app` for any other
-- own device. So a message sent from the phone (`app`, the default) comes from the primary phone, device 0 (a
-- whatsmeow JID writes device 0 without a suffix), and only an `api` message comes from device 12.
CREATE FUNCTION pg_temp.n259_gows(p_id TEXT, p_chat TEXT, p_from_me BOOLEAN, p_extra JSONB DEFAULT '{}',
  p_info JSONB DEFAULT '{}', p_message JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_from_me::TEXT || '_' || p_chat || '_' || p_id, 'timestamp', 1788343200,
    'from', p_chat, 'to', NULL::TEXT, 'participant', NULL::TEXT, 'fromMe', p_from_me, 'source', 'app',
    'hasMedia', FALSE, 'media', NULL::TEXT,
    '_data', jsonb_build_object(
      'Info', jsonb_build_object('Chat', pg_temp.n259_rawjid(p_chat),
        'Sender', CASE WHEN NOT p_from_me THEN pg_temp.n259_rawjid(p_chat)
                       WHEN lower(COALESCE(p_extra ->> 'source', 'app')) = 'api' THEN '79990000000:12@s.whatsapp.net'
                       ELSE '79990000000@s.whatsapp.net' END,
        'IsFromMe', p_from_me, 'IsGroup', FALSE, 'SenderAlt', '', 'RecipientAlt', '', 'ID', p_id, 'PushName', '') || p_info,
      'Message', p_message)) || p_extra
$$;
SELECT pg_temp.n259_id(1) AS org \gset

-- 5a. A GOWS customer message: from = chat, to = null, Info.Chat the same chat as a raw JID.
SELECT pg_temp.n259_run(600, 'message.any', pg_temp.n259_gows('G600', '79990000601@c.us', FALSE,
  '{"body":"Здравствуйте (GOWS)"}', '{}', '{"conversation":"Здравствуйте (GOWS)"}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.n259_conv('79990000601@c.us') IS NOT NULL
  AND pg_temp.n259_bodies(pg_temp.n259_conv('79990000601@c.us')) = ARRAY['inbound:Здравствуйте (GOWS)']
  AND (SELECT cl.display_name = 'WhatsApp ••••0601' AND cl.phone = '+79990000601'
       FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
       WHERE c.id = pg_temp.n259_conv('79990000601@c.us')),
  'GOWS inbound c.us: from and Info.Chat agree, same client and conversation as any other engine');

-- 5b. A GOWS LID customer whose Info names the phone (with a device suffix): the phone is the client phone.
SELECT pg_temp.n259_run(601, 'message.any', pg_temp.n259_gows('G601', '623456789012345@lid', FALSE,
  '{"body":"LID with a phone"}', '{"SenderAlt":"79990000602:7@s.whatsapp.net","PushName":"Anna","AddressingMode":"lid"}'),
  NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND pg_temp.n259_conv('623456789012345@lid') IS NOT NULL
  AND (SELECT cl.phone = '+79990000602' AND c.subject = 'WhatsApp ••••0602'
       FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
       WHERE c.id = pg_temp.n259_conv('623456789012345@lid')),
  'GOWS LID with SenderAlt: bound on the LID, the phone comes from the alternative JID');

-- 5c. A GOWS LID customer whose SenderAlt is the empty string (what a Go empty JID marshals to): NO phone.
SELECT pg_temp.n259_run(602, 'message.any', pg_temp.n259_gows('G602', '723456789012346@lid', FALSE,
  '{"body":"LID without a phone"}', '{"PushName":"Борис"}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (SELECT c.subject LIKE 'Борис #____' AND cl.phone IS NULL AND cl.normalized_phone IS NULL
       FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
       WHERE c.id = pg_temp.n259_conv('723456789012346@lid')),
  'GOWS LID with an empty SenderAlt: named by the push name, no phone');

-- 5d. A message sent from the phone, GOWS shape (to = null, the chat in Info.Chat), to a bound chat, a bound LID chat,
-- and a LID chat whose RecipientAlt names the phone of a bound chat.
SELECT pg_temp.n259_run(603, 'message.any', pg_temp.n259_gows('P603', '79990000601@c.us', TRUE, '{"body":"Ответ с телефона (GOWS)"}'),
  TIMESTAMPTZ '2026-10-04 10:00:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000601@c.us')
  AND (SELECT m.message_identity_source = 'private_waha_phone_binding' FROM platform.communication_messages m
       WHERE m.id = (:'r'::JSONB ->> 'communication_message_id')::UUID),
  'GOWS phone-sent to a bound c.us chat: outbound, own identity, same conversation');
SELECT pg_temp.n259_run(604, 'message.any', pg_temp.n259_gows('P604', '623456789012345@lid', TRUE, '{"body":"К LID (GOWS)"}'),
  TIMESTAMPTZ '2026-10-04 10:01:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'direction' = 'outbound'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('623456789012345@lid'),
  'GOWS phone-sent to a bound LID chat lands in the LID conversation');
SELECT pg_temp.n259_run(605, 'message.any', pg_temp.n259_gows('P605', '823456789012347@lid', TRUE, '{"body":"Через RecipientAlt"}',
  '{"RecipientAlt":"79990000601@s.whatsapp.net"}'), TIMESTAMPTZ '2026-10-04 10:02:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000601@c.us')
  AND pg_temp.n259_conv('823456789012347@lid') IS NULL,
  'GOWS RecipientAlt resolves an unbound LID target to the bound phone chat');
SELECT pg_temp.n259_assert(
  pg_temp.n259_bodies(pg_temp.n259_conv('79990000601@c.us')) =
    ARRAY['inbound:Здравствуйте (GOWS)', 'outbound:Ответ с телефона (GOWS)', 'outbound:Через RecipientAlt'],
  'the GOWS conversation holds the customer message and both phone-sent messages in order');

-- 5e. A GOWS phone-sent message to a chat with no conversation is deferred; the customer's GOWS message projects it.
SELECT pg_temp.n259_run(606, 'message.any', pg_temp.n259_gows('P606', '79990000611@c.us', TRUE, '{"body":"Раньше (GOWS)"}'),
  TIMESTAMPTZ '2026-10-04 08:00:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'deferred')::BOOLEAN AND pg_temp.n259_conv('79990000611@c.us') IS NULL
  AND :'r'::JSONB -> 'deferred_chat_ids' = '["79990000611@c.us"]'::JSONB,
  'GOWS phone-sent to an unknown chat is deferred on that chat (nothing created)');
SELECT pg_temp.n259_run(607, 'message.any', pg_temp.n259_gows('G607', '79990000611@c.us', FALSE, '{"body":"Позже (GOWS)"}'),
  TIMESTAMPTZ '2026-10-04 08:30:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(
  pg_temp.n259_bodies(pg_temp.n259_conv('79990000611@c.us')) = ARRAY['outbound:Раньше (GOWS)', 'inbound:Позже (GOWS)']
  AND :'r'::JSONB -> 'deferred_phone_sent' = '{"deferred":1,"projected":1,"dropped":0}'::JSONB,
  'the GOWS customer message creates the conversation and the deferred phone-sent message follows in order');

-- 5f. The own number is never a customer's phone. WAHA 2026.8.1 mapped the own number to FOREIGN LIDs
-- (devlikeapro/waha#2241): a foreign LID arrives with the own phone as SenderAlt. With the own account known,
-- the alternative is ignored: each LID keeps its own client, none carries the own phone.
SELECT pg_temp.n259_run(608, 'message.any', pg_temp.n259_gows('G608', '923456789012341@lid', FALSE, '{"body":"Foreign 1"}',
  '{"SenderAlt":"79990000000:12@s.whatsapp.net","PushName":"Foreign One","AddressingMode":"lid"}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_run(609, 'message.any', pg_temp.n259_gows('G609', '923456789012342@lid', FALSE, '{"body":"Foreign 2"}',
  '{"SenderAlt":"79990000000@s.whatsapp.net","PushName":"Foreign Two","AddressingMode":"lid"}'), NULL, pg_temp.n259_me()) AS r2 \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded' AND :'r2'::JSONB ->> 'finish_state' = 'succeeded'
  AND pg_temp.n259_conv('923456789012341@lid') IS NOT NULL AND pg_temp.n259_conv('923456789012342@lid') IS NOT NULL
  AND pg_temp.n259_conv('79990000000@c.us') IS NULL,
  'a foreign LID whose SenderAlt is the own number is bound on its LID, never on the own phone chat');
SELECT pg_temp.n259_assert(
  (SELECT count(DISTINCT c.canonical_client_id) = 2 AND bool_and(cl.phone IS NULL AND cl.normalized_phone IS NULL)
     AND bool_and(c.subject LIKE 'Foreign % #____')
   FROM platform.communication_conversations c JOIN platform.clients cl ON cl.id = c.canonical_client_id
   WHERE c.id IN (pg_temp.n259_conv('923456789012341@lid'), pg_temp.n259_conv('923456789012342@lid'))),
  'two foreign LIDs with the own phone as alternative are two clients, none with a phone');
SELECT pg_temp.n259_assert(
  NOT EXISTS (SELECT 1 FROM platform.clients cl WHERE cl.organization_id = :'org' AND (cl.phone LIKE '%79990000000%' OR cl.normalized_phone LIKE '%79990000000%')),
  'no client anywhere carries the own number');
-- A phone-sent message to such a LID whose RecipientAlt is the own number still lands in that LID's conversation,
-- and a deferred one is deferred on the LID only (the own phone chat is not a deferral target).
SELECT pg_temp.n259_run(610, 'message.any', pg_temp.n259_gows('P610', '923456789012341@lid', TRUE, '{"body":"К Foreign 1"}',
  '{"RecipientAlt":"79990000000:12@s.whatsapp.net"}'), TIMESTAMPTZ '2026-10-04 11:00:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('923456789012341@lid'),
  'phone-sent to a foreign LID with the own phone as RecipientAlt lands in that LID conversation');
SELECT pg_temp.n259_run(611, 'message.any', pg_temp.n259_gows('P611', '923456789012343@lid', TRUE, '{"body":"К Foreign 3"}',
  '{"RecipientAlt":"79990000000@s.whatsapp.net"}'), TIMESTAMPTZ '2026-10-04 11:01:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'deferred')::BOOLEAN AND :'r'::JSONB -> 'deferred_chat_ids' = '["923456789012343@lid"]'::JSONB,
  'a deferral names the LID only, never the own phone chat');

-- 5g. The own number is never a customer chat: a note to self or a peer message is ignored (nothing to retry, nothing created).
SELECT count(*) AS own_conversations_before FROM platform.communication_conversations WHERE organization_id = :'org' \gset
SELECT pg_temp.n259_run(612, 'message.any', pg_temp.n259_gows('S612', '79990000000@c.us', TRUE, '{"body":"note to self"}'),
  NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat' AND :'r'::JSONB ->> 'disposition' = 'succeeded'
  AND :'r'::JSONB ->> 'finish_state' = 'succeeded', 'GOWS note to self (own phone chat) is ignored, not an error');
SELECT pg_temp.n259_run(613, 'message.any', pg_temp.n259_gows('S613', '900000000000001@lid', TRUE, '{"body":"note to self"}'),
  NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat', 'GOWS note to self (own LID chat) is ignored');
-- Without `me` the own account is still known from the message itself: an own device is the sender (Info.Sender).
SELECT pg_temp.n259_run(614, 'message.any', pg_temp.n259_gows('S614', '79990000000@c.us', TRUE, '{"body":"note to self"}')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat', 'a note to self is recognised from Info.Sender when the envelope has no me');
-- WEBJS note to self: to = own. A customer-side event whose sender is the own number is ignored too.
SELECT pg_temp.n259_run(615, 'message.any', pg_temp.n259_out('true_79990000000@c.us_S615', '79990000000@c.us', '{"body":"note to self"}'),
  NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat', 'WEBJS note to self (to = own) is ignored');
SELECT pg_temp.n259_run(616, 'message.any', pg_temp.n259_gows('S616', '79990000000@c.us', FALSE, '{"body":"from the own number"}'),
  NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat' AND :'r'::JSONB ->> 'finish_state' = 'succeeded',
  'an inbound event from the own number never creates a conversation');
SELECT pg_temp.n259_assert(
  (SELECT count(*) FROM platform.communication_conversations WHERE organization_id = :'org') = :own_conversations_before
  AND pg_temp.n259_conv('79990000000@c.us') IS NULL AND pg_temp.n259_conv('900000000000001@lid') IS NULL,
  'no conversation or binding for the own account');

-- 5h. `from` is the last resort for a phone-sent message with neither `to` nor Info.Chat, and only with a known own
-- account that it is not.
SELECT pg_temp.n259_run(617, 'message.any', jsonb_build_object('id', 'true_79990000601@c.us_FB1', 'timestamp', 1788343200,
  'from', '79990000601@c.us', 'fromMe', true, 'source', 'app', 'body', 'Только from'), TIMESTAMPTZ '2026-10-04 12:00:00+00',
  pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000601@c.us')
  AND :'r'::JSONB ->> 'direction' = 'outbound', 'from is used for a phone-sent message with no other chat field when the own account is known');
SELECT pg_temp.n259_run(618, 'message.any', jsonb_build_object('id', 'true_79990000601@c.us_FB2', 'timestamp', 1788343200,
  'from', '79990000601@c.us', 'fromMe', true, 'source', 'app', 'body', 'Только from, me неизвестен')) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'error_code' = 'waha_outbound_chat_required',
  'with no own account known `from` is not trusted: no chat');
SELECT pg_temp.n259_run(619, 'message.any', jsonb_build_object('id', 'true_79990000000@c.us_FB3', 'timestamp', 1788343200,
  'from', '79990000000@c.us', 'fromMe', true, 'source', 'app', 'body', 'from is own'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'ignored' = 'own_chat', 'from that is the own number is never a customer');

-- 5i. WEBJS shapes are unchanged with the own account known: from = own is not a candidate for a phone-sent message.
SELECT pg_temp.n259_run(620, 'message.any', pg_temp.n259_out('true_79990000601@c.us_W1', '79990000601@c.us',
  '{"body":"WEBJS с телефона"}'), TIMESTAMPTZ '2026-10-04 12:05:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert((:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000601@c.us')
  AND :'r'::JSONB ->> 'direction' = 'outbound', 'WEBJS phone-sent (from = own, to = customer) with the own account known');
SELECT pg_temp.n259_run(621, 'message.any', pg_temp.n259_in('false_79990000601@c.us_W2', '79990000601@c.us',
  jsonb_build_object('body', 'WEBJS входящее', 'to', '79990000000@c.us', '_data', jsonb_build_object('id',
    jsonb_build_object('fromMe', false, 'remote', '79990000601@c.us'), 'to', '79990000000@c.us', 'type', 'chat'))),
  TIMESTAMPTZ '2026-10-04 12:06:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (:'r'::JSONB ->> 'communication_conversation_id')::UUID = pg_temp.n259_conv('79990000601@c.us'),
  'WEBJS inbound (to = own) with the own account known');

-- 5j. Different chats of one kind in from and Info.Chat conflict, as for every other pair of chat fields.
SELECT pg_temp.n259_run(622, 'message.any', pg_temp.n259_gows('X622', '79990000621@c.us', FALSE, '{"body":"x"}',
  '{"Chat":"79990000622@s.whatsapp.net"}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'error_code' = 'waha_inbound_chat_conflict', 'from and Info.Chat that disagree are a conflict');

-- 5k. GOWS media: no `_data.type`; the kind comes from `_data.Message`, the name from `media.filename`
-- (WAHA reports {url: null, mimetype, filename} with downloadMedia off, `media` is null without media).
SELECT pg_temp.n259_assert(
  platform_private.waha_message_content(pg_temp.n259_gows('K1', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"image/jpeg","filename":null}}', '{}',
    '{"imageMessage":{"mimetype":"image/jpeg","JPEGThumbnail":"AAEC"}}')) ->> 'body' = '📎 Фото — откройте в WhatsApp продаж'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K2', '79990000630@c.us', FALSE,
    '{"body":"Мой диплом","hasMedia":true,"media":{"url":null,"mimetype":"image/jpeg","filename":null}}', '{}',
    '{"imageMessage":{"mimetype":"image/jpeg","caption":"Мой диплом"}}')) ->> 'body' = E'📎 Фото — откройте в WhatsApp продаж\nМой диплом'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K3', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"audio/ogg; codecs=opus","filename":null}}', '{}',
    '{"audioMessage":{"mimetype":"audio/ogg; codecs=opus","PTT":true}}')) ->> 'body' = '📎 Голосовое сообщение — откройте в WhatsApp продаж'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K4', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"audio/ogg","filename":null}}', '{}',
    '{"audioMessage":{"mimetype":"audio/ogg"}}')) ->> 'body' = '📎 Аудио — откройте в WhatsApp продаж'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K5', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"image/webp","filename":null}}', '{}',
    '{"stickerMessage":{"mimetype":"image/webp","isAnimated":false}}')) ->> 'body' = '📎 Стикер — откройте в WhatsApp продаж'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K6', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"video/mp4","filename":null}}', '{}',
    '{"videoMessage":{"mimetype":"video/mp4","gifPlayback":true}}')) ->> 'body' = '📎 Видео — откройте в WhatsApp продаж'
  AND platform_private.waha_message_content(pg_temp.n259_gows('K7', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"video/mp4","filename":null}}', '{}',
    '{"ptvMessage":{"mimetype":"video/mp4"}}')) ->> 'body' = '📎 Видео — откройте в WhatsApp продаж'
  -- A document whose mime type is an image is still a file (nothing downloads, the name is shown).
  AND platform_private.waha_message_content(pg_temp.n259_gows('K8', '79990000630@c.us', FALSE,
    '{"hasMedia":true,"media":{"url":null,"mimetype":"image/jpeg","filename":"passport scan.jpg"}}', '{}',
    '{"documentMessage":{"mimetype":"image/jpeg","fileName":"passport scan.jpg"}}')) ->> 'body' = '📎 Файл: passport scan.jpg — откройте в WhatsApp продаж'
  -- WEBJS keeps its `_data.type`, which wins when both are present.
  AND platform_private.waha_message_content('{"hasMedia":true,"media":{"mimetype":"audio/ogg"},"_data":{"type":"ptt"}}') ->> 'body'
    = '📎 Голосовое сообщение — откройте в WhatsApp продаж',
  'GOWS media kinds come from _data.Message; WEBJS _data.type is unchanged');
-- Through the real chain: a media-only GOWS photo keeps the staff handoff, a captioned one does not.
SELECT pg_temp.n259_run(623, 'message.any', pg_temp.n259_gows('K9', '79990000630@c.us', FALSE,
  '{"hasMedia":true,"media":{"url":null,"mimetype":"application/pdf","filename":"cv.pdf"}}', '{}',
  '{"documentMessage":{"mimetype":"application/pdf","fileName":"cv.pdf","JPEGThumbnail":"AAEC"}}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000630@c.us')) = '📎 Файл: cv.pdf — откройте в WhatsApp продаж'
  AND (:'r'::JSONB ->> 'human_review_required')::BOOLEAN AND pg_temp.n259_handoffs(pg_temp.n259_conv('79990000630@c.us')) = 1,
  'GOWS media-only file: marker with the name and the staff handoff');
SELECT pg_temp.n259_run(624, 'message.any', pg_temp.n259_gows('K10', '79990000630@c.us', FALSE,
  '{"body":"Резюме","hasMedia":true,"media":{"url":null,"mimetype":"application/pdf","filename":"cv.pdf"}}', '{}',
  '{"documentMessage":{"mimetype":"application/pdf","fileName":"cv.pdf","caption":"Резюме"}}'), NULL, pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(pg_temp.n259_last_body(pg_temp.n259_conv('79990000630@c.us')) = E'📎 Файл: cv.pdf — откройте в WhatsApp продаж\nРезюме'
  AND NOT (:'r'::JSONB ->> 'human_review_required')::BOOLEAN, 'GOWS captioned file: marker, caption on a new line, no extra handoff');

-- 5l. The ACK of a GOWS phone-sent message (WAHA reports from = chat, to = null, fromMe true) is recorded.
SELECT pg_temp.n259_run(625, 'message.ack', jsonb_build_object('id', 'true_79990000601@c.us_P603', 'from', '79990000601@c.us',
  'to', NULL::TEXT, 'participant', NULL::TEXT, 'fromMe', true, 'ack', 3, 'ackName', 'READ',
  '_data', jsonb_build_object('Chat', '79990000601@s.whatsapp.net', 'IsFromMe', false, 'Type', 'read')),
  TIMESTAMPTZ '2026-10-04 12:10:00+00', pg_temp.n259_me()) AS r \gset
SELECT pg_temp.n259_assert(:'r'::JSONB ->> 'disposition' = 'succeeded' AND :'r'::JSONB ->> 'finish_state' = 'succeeded'
  AND (SELECT a.waha_ack_name = 'READ' FROM platform.waha_message_ack_current a
       JOIN platform_private.waha_message_bindings b ON b.communication_message_id = a.communication_message_id
       WHERE b.raw_message_id = 'true_79990000601@c.us_P603'),
  'the ACK of a GOWS phone-sent message is recorded');

-- 5m. The helpers themselves.
SELECT pg_temp.n259_assert(
  platform_private.waha_own_chat_ids(pg_temp.n259_me(), '{}'::JSONB, FALSE) = ARRAY['79990000000@c.us', '900000000000001@lid']
  AND platform_private.waha_own_chat_ids(NULL, '{}'::JSONB, FALSE) = ARRAY[]::TEXT[]
  AND platform_private.waha_own_chat_ids('{"id":"not-a-jid"}'::JSONB, '{}'::JSONB, FALSE) = ARRAY[]::TEXT[]
  AND platform_private.waha_own_chat_ids(NULL, '{"_data":{"Info":{"IsFromMe":true,"Sender":"79990000000:12@s.whatsapp.net"}}}'::JSONB, TRUE)
    = ARRAY['79990000000@c.us']
  -- The sender counts only for a message an own device sent.
  AND platform_private.waha_own_chat_ids(NULL, '{"_data":{"Info":{"IsFromMe":true,"Sender":"79990000000:12@s.whatsapp.net"}}}'::JSONB, FALSE)
    = ARRAY[]::TEXT[]
  AND platform_private.waha_own_chat_ids(NULL, '{"_data":{"Info":{"IsFromMe":false,"Sender":"79990000999@s.whatsapp.net"}}}'::JSONB, TRUE)
    = ARRAY[]::TEXT[],
  'own account ids: me.id, me.lid, me.jid with the device removed, and the sender of an own-device message only');
SELECT pg_temp.n259_assert(
  platform_private.waha_payload_phone_chat_id('{"_data":{"Info":{"SenderAlt":"79990000000:12@s.whatsapp.net"}}}'::JSONB, FALSE,
    ARRAY['79990000000@c.us']) IS NULL
  AND platform_private.waha_payload_phone_chat_id('{"_data":{"Info":{"SenderAlt":"79990000000@s.whatsapp.net"},"key":{"remoteJidAlt":"79990000777@s.whatsapp.net"}}}'::JSONB,
    FALSE, ARRAY['79990000000@c.us']) = '79990000777@c.us'
  AND platform_private.waha_payload_phone_chat_id('{"_data":{"Info":{"SenderAlt":"79990000000@s.whatsapp.net"}}}'::JSONB, FALSE,
    ARRAY[]::TEXT[]) = '79990000000@c.us'
  AND platform_private.waha_payload_phone_chat_id('{"_data":{"Info":{"SenderAlt":""}}}'::JSONB, FALSE, ARRAY[]::TEXT[]) IS NULL,
  'an alternative equal to the own number is ignored (the next alternative is still read); with no own account nothing is hidden; an empty one is no phone');

-- 5n. The session's own linked device sending through the API (Info.Sender = me.jid, device 12, which WAHA labels
-- `api`) is the CRM's own send echoing back, not the phone: the queue refuses it and the projection guard stores
-- nothing. The same message labelled `app` from the phone (device 0) is the phone-sent one (5d).
SELECT pg_temp.n259_assert(
  pg_temp.n259_gows('A626', '79990000601@c.us', TRUE, '{"body":"x","source":"api"}') #>> '{_data,Info,Sender}'
    = '79990000000:12@s.whatsapp.net'
  AND pg_temp.n259_gows('A626', '79990000601@c.us', TRUE, '{"body":"x"}') #>> '{_data,Info,Sender}'
    = '79990000000@s.whatsapp.net',
  'the fixture follows WAHA''s labelling: device 12 sends api, the phone (device 0) sends app');
SELECT pg_temp.n259_event(626, 'message.any', pg_temp.n259_gows('A626', '79990000601@c.us', TRUE,
  '{"body":"Sent from the CRM (GOWS)","source":"api"}'), NULL, pg_temp.n259_me()) AS ev_gapi \gset
SELECT pg_temp.n259_assert(pg_temp.n259_enqueue(:'ev_gapi') = '22023',
  'the queue refuses a GOWS message from the session''s own linked device (source api)');
SELECT pg_temp.n259_assert(
  platform_private.project_waha_phone_sent_message(pg_temp.n259_id(1), :'ev_gapi', pg_temp.n259_conv('79990000601@c.us'),
    (SELECT p.id FROM platform.conversation_participants p WHERE p.conversation_id = pg_temp.n259_conv('79990000601@c.us')
       AND p.participant_kind = 'sales')) ->> 'outcome' = 'crm_send_echo'
  AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m WHERE m.body_text = 'Sent from the CRM (GOWS)'),
  'the projection guard: a GOWS api echo from the session''s own device is the CRM''s send and stores nothing');

-- ---------------------------------------------------------------------------
-- 6. Constraints and catalog.
-- ---------------------------------------------------------------------------
-- An outbound row needs a manual authorization or the phone-sent identity ...
SELECT pg_temp.n259_assert(
  (SELECT left(pg_temp.n259_message(format($sql$
    INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
      language, student_visible, message_identity_source, source_webhook_event_id, created_at)
    SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'outbound', 'forged',
      'undetermined', FALSE, 'private_waha_binding', m.source_webhook_event_id, now()
    FROM platform.communication_messages m WHERE m.body_text = 'Ответ с телефона'$sql$)), 6) = '23514 ')
  AND (SELECT left(pg_temp.n259_message(format($sql$
    INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
      language, student_visible, message_identity_source, source_webhook_event_id, created_at)
    SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'outbound', 'forged',
      'undetermined', FALSE, 'public_provider_id', m.source_webhook_event_id, now()
    FROM platform.communication_messages m WHERE m.body_text = 'Ответ с телефона'$sql$)), 6) = '23514 '),
  'an outbound row with another identity and no authorization is refused');
-- ... and its own verified fromMe/source=app evidence.
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.n259_assert(
  (SELECT left(pg_temp.n259_message(format($sql$
    WITH forged AS (
      INSERT INTO platform.communication_messages(id, organization_id, conversation_id, sender_participant_id, direction, body_text,
        language, student_visible, message_identity_source, source_webhook_event_id, created_at)
      SELECT gen_random_uuid(), m.organization_id, m.conversation_id, m.sender_participant_id, 'outbound', 'forged phone-sent',
        'undetermined', FALSE, 'private_waha_phone_binding', e.id, now()
      FROM platform.communication_messages m, platform_private.provider_webhook_events e
      WHERE m.body_text = 'Ответ с телефона' AND e.id = %L RETURNING id)
    SELECT count(*) FROM forged$sql$, pg_temp.n259_id(1000 + 2))), 6) = '23514 '),
  'a phone-sent row without its own bound fromMe/app event is refused');
SET CONSTRAINTS ALL DEFERRED;

-- The new private routines are definer, empty search_path, owner postgres and callable by no client role.
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 8 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
     AND p.proname IN ('normalize_waha_conversation_chat_id', 'waha_own_chat_ids', 'waha_payload_phone_chat_id', 'waha_payload_push_name',
       'resolve_waha_conversation_chat', 'waha_message_content', 'project_waha_phone_sent_message', 'backfill_waha_deferred_phone_sent')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('public'::NAME, p.oid, 'EXECUTE')),
  'the eight new private routines: SECURITY DEFINER, empty search_path, owner postgres, no client role can execute');
-- The touched routines keep their contract: the projector stays service-only, the private ones stay private.
SELECT pg_temp.n259_assert(
  has_function_privilege('service_role', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.bind_waha_chat_to_canonical(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.require_private_waha_message_binding()', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 'v'
       FROM pg_proc p WHERE p.oid = 'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE)
  AND (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
       FROM pg_proc p WHERE p.oid = 'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE),
  'projector, ACK projector, binding and canonical-link routines keep their grants and definer contract');
-- The ACK projector allow-list names the new source exactly once.
SELECT pg_temp.n259_assert(
  (SELECT (length(p.prosrc) - length(replace(p.prosrc, '''private_waha_phone_binding''', '')))
     / length('''private_waha_phone_binding''') = 1
   FROM pg_proc p WHERE p.oid = 'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE),
  'the ACK projector allow-list has the phone-sent identity once');
-- Reply routing: the manual-send claim takes the chat id from the binding as stored (so a LID chat is
-- replied to by its LID) and the binding accepts exactly the c.us and LID forms.
SELECT pg_temp.n259_assert(
  (SELECT position('''raw_chat_id'', chat_binding.normalized_chat_id' IN p.prosrc) > 0
     AND position('normalize_waha_direct_chat_id' IN p.prosrc) = 0
   FROM pg_proc p WHERE p.oid = 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)'::REGPROCEDURE)
  AND (SELECT pg_get_constraintdef(c.oid) LIKE '%@lid%' AND pg_get_constraintdef(c.oid) LIKE '%@c%'
       FROM pg_constraint c WHERE c.conname = 'waha_direct_chat_bindings_normalized_chat_id_check'),
  'reply routing reads the bound chat id as stored; the binding check allows c.us and LID');
SELECT pg_temp.n259_assert(
  (SELECT count(*) = 0 FROM platform_private.waha_direct_chat_bindings b
   WHERE b.organization_id = pg_temp.n259_id(1) AND b.normalized_chat_id !~ '^[0-9]+@(c[.]us|lid)$'),
  'every binding is a c.us or a LID chat');
SELECT pg_temp.n259_assert(
  pg_temp.n259_message($$INSERT INTO platform_private.waha_direct_chat_bindings(organization_id, waha_session_name, normalized_chat_id, conversation_id, source_webhook_event_id)
    SELECT organization_id, waha_session_name, '123@g.us', conversation_id, source_webhook_event_id FROM platform_private.waha_direct_chat_bindings
    WHERE organization_id = pg_temp.n259_id(1) AND waha_session_name = 'crm_primary' LIMIT 1$$) LIKE '23514%',
  'a group id can never be bound');

ROLLBACK;

SELECT 'platform migration 259 LID, phone-sent and media marker contract passed' AS result;
