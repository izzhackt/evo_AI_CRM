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
--  5. constraints and catalog: an outbound row needs a manual authorization or
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
  p_occurred TIMESTAMPTZ DEFAULT NULL) RETURNS UUID LANGUAGE plpgsql AS $$
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
    'verified', jsonb_build_object('event', p_event, 'session', 'crm_primary', 'payload', p_payload),
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
  p_occurred TIMESTAMPTZ DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.n259_work(p_n, p_event, pg_temp.n259_event(p_n, p_event, p_payload, p_occurred), p_payload);
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
-- 5. Constraints and catalog.
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
  (SELECT count(*) = 7 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE
     AND p.proname IN ('normalize_waha_conversation_chat_id', 'waha_payload_phone_chat_id', 'waha_payload_push_name',
       'resolve_waha_conversation_chat', 'waha_message_content', 'project_waha_phone_sent_message', 'backfill_waha_deferred_phone_sent')
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner) = 'postgres'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('public'::NAME, p.oid, 'EXECUTE')),
  'the seven new private routines: SECURITY DEFINER, empty search_path, owner postgres, no client role can execute');
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
