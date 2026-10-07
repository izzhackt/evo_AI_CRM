\set ON_ERROR_STOP on
-- Boundary suite for migration 278 («Продажи → WhatsApp»: the WhatsApp profile
-- name and the country code plus the last six digits instead of «WhatsApp
-- ••••NNNN», owner request 07.10.2026). Runs right after 278 with its own
-- synthetic organizations; every number, name and message is invented. Chats
-- come from the REAL WAHA projection chain (verified event -> enqueue -> claim
-- -> project -> finish) and the REAL history import (begin run -> page), the
-- reader is called as members whose claims come from the real access-token
-- hook.
--
-- Proves:
--  1. contract: the reader is a stable definer with an empty search_path,
--     EXECUTE for authenticated only; every helper is a definer nobody may
--     execute; the triggers are AFTER row triggers on the right events; the 259
--     helpers 278 relies on are unchanged; the queue reader keeps its 16 keys;
--  2. masking: «+996 ••• 12 46 64» (country code by E.164 length, at most six
--     digits, at least one hidden) and the placeholder detectors;
--  3. capture on the live chain: GOWS `_data.Info.PushName`, WEBJS
--     `_data.notifyName`, a LID chat with its phone in `SenderAlt`; a «.» name
--     is no name («WhatsApp +996 ••• 90 46 64»); the sales phone's own profile
--     name never names a customer; a later profile name does not replace a
--     captured one; a typed name is never replaced; the chat subject is not
--     touched;
--  4. history import: a chat without a client gets its number from the
--     history evidence (no name: the REST history has none); the customer's
--     first live message promotes it and names the new client;
--  5. the reader: two customers whose numbers end in the same four digits read
--     differently; a typed name wins — for a member who may read the client;
--     a member who reads sales chats without client.read (261) sees the
--     profile name instead; unknown, foreign-organization and
--     non-WhatsApp-subject ids give no row; refusals (keyless member, another
--     organization's Admin, anon, service_role, 0 / 61 / NULL ids);
--  6. the capture never fails a projection: a rename the database refuses is
--     a warning, the message is stored;
--  7. backfill: idempotent, renames a pre-278 placeholder, keeps typed names;
--  8. the AI lead card now gets the profile first name and still none for a
--     placeholder.
BEGIN;

DO $n278_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n278_auth_role$;

CREATE FUNCTION pg_temp.n278_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n278_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N278: %', message; END IF;
END
$$;

SELECT 'N278_WHATSAPP_CONTACT_IDENTITY_SUITE_START' AS n278_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Contract.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n278_assert((SELECT r.prosecdef AND r.provolatile = 's' AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND pg_get_userbyid(r.proowner) = 'postgres'
    AND has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0)
  FROM pg_proc r WHERE r.oid = 'platform.staff_whatsapp_contacts(uuid,uuid[])'::regprocedure),
  'the reader: a stable definer, empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.n278_assert((SELECT count(*) = 9 AND bool_and(r.prosecdef AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0))
  FROM pg_proc r WHERE r.oid IN (
    'platform_private.whatsapp_masked_phone(text)'::regprocedure,
    'platform_private.waha_generated_conversation_subject(text,uuid)'::regprocedure,
    'platform_private.waha_generated_client_name(text,text,text,uuid)'::regprocedure,
    'platform_private.waha_conversation_push_name(uuid,uuid)'::regprocedure,
    'platform_private.waha_conversation_phone_digits(uuid,uuid)'::regprocedure,
    'platform_private.waha_conversation_contact(uuid,uuid)'::regprocedure,
    'platform_private.refresh_waha_client_contact_name(uuid,uuid)'::regprocedure,
    'platform_private.capture_waha_contact_name_from_message()'::regprocedure,
    'platform_private.capture_waha_contact_name_from_conversation()'::regprocedure)),
  'the helpers: definers with an empty search_path no client role may execute');
SELECT pg_temp.n278_assert(
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'communication_messages_waha_contact_name'
     AND t.tgrelid = 'platform.communication_messages'::regclass)
    = 'CREATE TRIGGER communication_messages_waha_contact_name AFTER INSERT ON platform.communication_messages FOR EACH ROW WHEN (((new.direction = ''inbound''::platform.communication_direction) AND (new.source_webhook_event_id IS NOT NULL))) EXECUTE FUNCTION platform_private.capture_waha_contact_name_from_message()'
  AND (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'communication_conversations_waha_contact_name'
     AND t.tgrelid = 'platform.communication_conversations'::regclass)
    = 'CREATE TRIGGER communication_conversations_waha_contact_name AFTER UPDATE OF canonical_client_id ON platform.communication_conversations FOR EACH ROW WHEN (((new.canonical_client_id IS NOT NULL) AND (new.canonical_client_id IS DISTINCT FROM old.canonical_client_id))) EXECUTE FUNCTION platform_private.capture_waha_contact_name_from_conversation()',
  'the capture triggers: AFTER row triggers on a customer message with evidence and on a canonical client binding');
SELECT pg_temp.n278_assert(
  (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform_private.waha_payload_push_name(jsonb)'::regprocedure)
    = '88c460549a31c87b72e5f66962304086'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform_private.resolve_waha_conversation_chat(jsonb,boolean,jsonb)'::regprocedure)
    = '9089a18ca27ddaa0cc461ab595765695'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform_private.waha_payload_phone_chat_id(jsonb,boolean,text[])'::regprocedure)
    = 'eba01344c97aa78faa3c551f45c34875',
  'the 259 payload helpers are exactly the production definitions 278 was written against');
SELECT pg_temp.n278_assert(
  (SELECT prosrc FROM pg_proc WHERE oid = 'platform_private.refresh_waha_client_contact_name(uuid,uuid)'::regprocedure)
    ~ 'FOR NO KEY UPDATE SKIP LOCKED;\s+IF NOT FOUND THEN\s+RETURN ''busy'';',
  'the capture never waits on a client row another transaction holds (skips it as busy)');
SELECT pg_temp.n278_assert(
  (SELECT pronargs = 9 AND cardinality(proallargtypes) = 25
   FROM pg_proc WHERE oid = 'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)'::regprocedure),
  'the queue reader keeps its 9 arguments and 16 result keys (the running application checks them exactly)');

-- ---------------------------------------------------------------------------
-- 2. Masking and placeholder detection.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n278_assert(
  platform_private.whatsapp_masked_phone('996700124664') = '+996 ••• 12 46 64'
  AND platform_private.whatsapp_masked_phone('79991234567') = '+7 ••• 23 45 67'
  AND platform_private.whatsapp_masked_phone('14155550123') = '+1 ••• 55 01 23'
  AND platform_private.whatsapp_masked_phone('971501234567') = '+971 ••• 23 45 67'
  AND platform_private.whatsapp_masked_phone('601123456789') = '+60 ••• 45 67 89'
  AND platform_private.whatsapp_masked_phone('4930123456') = '+49 ••• 12 34 56'
  AND platform_private.whatsapp_masked_phone('9967001') = '+996 ••• 0 01'
  AND platform_private.whatsapp_masked_phone('0123456789') IS NULL
  AND platform_private.whatsapp_masked_phone('+996700124664') IS NULL
  AND platform_private.whatsapp_masked_phone(NULL) IS NULL,
  'masking: country code by E.164 length, at most six digits in pairs, at least one hidden, digits only');
SELECT pg_temp.n278_assert(
  platform_private.waha_generated_conversation_subject('WhatsApp ••••4664', pg_temp.n278_id(9))
  AND platform_private.waha_generated_conversation_subject('WhatsApp контакт #' || left(pg_temp.n278_id(9)::TEXT, 4), pg_temp.n278_id(9))
  AND platform_private.waha_generated_conversation_subject('Айгуль #' || left(pg_temp.n278_id(9)::TEXT, 4), pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_conversation_subject('Группа #abcd', pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_conversation_subject('Аружан Примерова', pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_conversation_subject(NULL, pg_temp.n278_id(9)),
  'the generated chat subjects of 259/260 and nothing else');
SELECT pg_temp.n278_assert(
  platform_private.waha_generated_client_name('WhatsApp ••••4664', '996700124664', 'WhatsApp ••••4664', pg_temp.n278_id(9))
  AND platform_private.waha_generated_client_name('WhatsApp +996 ••• 12 46 64', '996700124664', 'WhatsApp ••••4664', pg_temp.n278_id(9))
  AND platform_private.waha_generated_client_name('WhatsApp контакт #' || left(pg_temp.n278_id(9)::TEXT, 4), NULL,
    'WhatsApp контакт #' || left(pg_temp.n278_id(9)::TEXT, 4), pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_client_name('WhatsApp ••••1111', '996700124664', 'WhatsApp ••••4664', pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_client_name('WhatsApp ••••4664', NULL, 'WhatsApp ••••1111', pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_client_name('Айгуль', '996700124664', 'WhatsApp ••••4664', pg_temp.n278_id(9))
  AND NOT platform_private.waha_generated_client_name('WhatsApp', '996700124664', 'WhatsApp ••••4664', pg_temp.n278_id(9)),
  'a client placeholder is the chain''s name for THIS number (or this chat''s generated subject), never a typed name');

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system; the intake owner), 2 a member
-- without any permission, 3 a member with only communication.read.full and
-- communication.manual.send at the `own` scope (reads every sales chat since
-- 261, no client.read). Organization 2: 5 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n278_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n278_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (5, 2, 'admin');
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n278_id(1), 'N278 Fictional organization'),
  (pg_temp.n278_id(2), 'N278 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n278_id(100 + n), 'n278-' || n || '@example.invalid', '{}'::JSONB FROM n278_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n278_id(200 + n), pg_temp.n278_id(100 + n), 'N278 Actor ' || n, 'active', 1 FROM n278_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n278_id(300 + a.n), pg_temp.n278_id(a.org), pg_temp.n278_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n278_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n278_id(301), pg_temp.n278_id(305));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n278_id(401), pg_temp.n278_id(1), 'organization', pg_temp.n278_id(1), 1),
  (pg_temp.n278_id(402), pg_temp.n278_id(2), 'organization', pg_temp.n278_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.n278_id(1), pg_temp.n278_id(301), pg_temp.n278_id(401), 1, 1, TRUE, 'system',
    'N278 synthetic organization scope', pg_temp.n278_id(601)),
  (pg_temp.n278_id(2), pg_temp.n278_id(305), pg_temp.n278_id(402), 1, 1, TRUE, 'system',
    'N278 synthetic other-organization scope', pg_temp.n278_id(602));
UPDATE n278_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n278_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n278_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;

-- Member 3's role, created, published and assigned by the Admin through the
-- real role commands (as the 261 suite), then fresh claims for everyone.
CREATE TEMP TABLE n278_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n278_id(1);
GRANT SELECT ON n278_versions TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.n278_id(INTEGER) TO authenticated;
SELECT claims AS n278_admin_setup FROM n278_actors WHERE n = 1 \gset
SET LOCAL request.jwt.claims TO :'n278_admin_setup';
SET LOCAL ROLE authenticated;
DO $n278_roles$
DECLARE published JSONB;
BEGIN
  PERFORM platform.staff_role_command(pg_temp.n278_id(1), pg_temp.n278_id(5101), 0, 'create',
    jsonb_build_object('label', 'N278 WhatsApp only', 'description', 'Migration 278 synthetic role',
      'permissionKeys', '["communication.manual.send","communication.read.full"]'::JSONB),
    'N278 create role', pg_temp.n278_id(5111));
  published := platform.staff_role_publish(pg_temp.n278_id(1), pg_temp.n278_id(5101), 1,
    platform.staff_role_impact(pg_temp.n278_id(1), pg_temp.n278_id(5101), 1) ->> 'impactFingerprint',
    'N278 publish role', pg_temp.n278_id(5112));
  PERFORM platform.staff_role_assignments_save(pg_temp.n278_id(1), pg_temp.n278_id(303),
    (SELECT access_version FROM n278_versions WHERE membership_id = pg_temp.n278_id(303)),
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.n278_id(5101),
      'scope', jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', pg_temp.n278_id(5101), 'roleVersion', 2,
      'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
    'N278 grant role', pg_temp.n278_id(5113));
END
$n278_roles$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE) AS n278_setup_reset \gset
UPDATE n278_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n278_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n278_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;

-- The reader as one actor: its rows as JSON, or the SQLSTATE of the refusal.
CREATE FUNCTION pg_temp.n278_read(p_role TEXT, p_claims TEXT, p_org UUID, p_ids UUID[]) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.conversation_id), '[]'::JSONB)::TEXT INTO result
    FROM platform.staff_whatsapp_contacts(p_org, p_ids) AS c;
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.n278_admin(p_ids UUID[]) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 1), pg_temp.n278_id(1), p_ids)::JSONB
$$;

-- The live chain (as in the 259/260/266 suites): one verified event through enqueue, claim, project, finish.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
CREATE FUNCTION pg_temp.n278_live(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n278_id(1);
  event_id CONSTANT UUID := pg_temp.n278_id(1000 + p_n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'n278-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', current_setting('n278.w_to')::TIMESTAMPTZ + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:n278:' || p_n, lpad(to_hex(p_n + 8192), 64, '0'), pg_temp.n278_id(1500 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('n278-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n278_id(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n278', pg_temp.n278_id(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n278_id(301), pg_temp.n278_id(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n278_id(2000 + p_n * 10 + 4));
  PERFORM set_config('request.jwt.claims', '', TRUE);
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
-- A customer message: from = the chat, `_data` engine-specific (push name, alternative phone).
CREATE FUNCTION pg_temp.n278_in(p_id TEXT, p_chat TEXT, p_data JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', p_chat, 'fromMe', false, 'source', 'app',
    'body', 'Здравствуйте', '_data', p_data)
$$;
-- A message sent from the sales phone (WEBJS shape: from = own, to = customer), carrying the OWN profile name.
CREATE FUNCTION pg_temp.n278_out(p_id TEXT, p_chat TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', '996700000000@c.us', 'to', p_chat,
    'fromMe', true, 'source', 'app', 'body', 'Ответ с телефона', '_data', '{"notifyName":"EVO Sales Own","Info":{"PushName":"EVO Sales Own"}}'::JSONB)
$$;
CREATE FUNCTION pg_temp.n278_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT b.conversation_id FROM platform_private.waha_direct_chat_bindings b
  WHERE b.organization_id = pg_temp.n278_id(1) AND b.normalized_chat_id = p_chat
$$;
CREATE FUNCTION pg_temp.n278_client(p_chat TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT cl.display_name FROM platform.communication_conversations c
  JOIN platform.clients cl ON cl.organization_id = c.organization_id AND cl.id = c.canonical_client_id
  WHERE c.id = pg_temp.n278_conv(p_chat)
$$;
CREATE FUNCTION pg_temp.n278_ok(p_result JSONB) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT p_result ->> 'disposition' = 'succeeded' AND p_result ->> 'finish_state' = 'succeeded'
$$;
SELECT set_config('n278.w_to', date_trunc('second', statement_timestamp())::TEXT, FALSE) AS cfg_to \gset

-- ---------------------------------------------------------------------------
-- 3. Capture on the live chain.
-- ---------------------------------------------------------------------------
-- A: GOWS, phone chat, profile name «Айгуль».
SELECT pg_temp.n278_live(1, pg_temp.n278_in('n278-a-1', '996700124664@c.us',
  '{"Info":{"PushName":"Айгуль","IsFromMe":false}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB)
  AND pg_temp.n278_client('996700124664@c.us') = 'Айгуль'
  AND (SELECT c.subject = 'WhatsApp ••••4664' FROM platform.communication_conversations c WHERE c.id = pg_temp.n278_conv('996700124664@c.us'))
  AND (SELECT cl.normalized_name = 'айгуль' AND cl.phone = '+996700124664' FROM platform.clients cl
       JOIN platform.communication_conversations c ON c.canonical_client_id = cl.id WHERE c.id = pg_temp.n278_conv('996700124664@c.us')),
  'A: the new client is named by the GOWS profile name (normalized name follows), the chat subject is untouched');
-- B: another customer whose number ends in the same four digits, profile name «.».
SELECT pg_temp.n278_live(2, pg_temp.n278_in('n278-b-1', '996555904664@c.us',
  '{"Info":{"PushName":" . ","IsFromMe":false}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB)
  AND pg_temp.n278_client('996555904664@c.us') = 'WhatsApp +996 ••• 90 46 64'
  AND (SELECT c.subject = 'WhatsApp ••••4664' FROM platform.communication_conversations c WHERE c.id = pg_temp.n278_conv('996555904664@c.us')),
  'B: a punctuation-only profile name is no name: «WhatsApp» with six digits, distinct from A');
-- The sales phone answers B: its own profile name never names the customer.
SELECT pg_temp.n278_live(3, pg_temp.n278_out('n278-b-2', '996555904664@c.us')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB)
  AND (SELECT count(*) = 1 FROM platform.communication_messages m
       WHERE m.conversation_id = pg_temp.n278_conv('996555904664@c.us') AND m.direction = 'outbound')
  AND pg_temp.n278_client('996555904664@c.us') = 'WhatsApp +996 ••• 90 46 64'
  AND platform_private.waha_conversation_push_name(pg_temp.n278_id(1), pg_temp.n278_conv('996555904664@c.us')) IS NULL,
  'B: a phone-sent message (own profile name) is projected and names nobody');
-- C: a LID chat; WAHA gives the phone in SenderAlt and the profile name.
SELECT pg_temp.n278_live(4, pg_temp.n278_in('n278-c-1', '100000000000003@lid',
  '{"Info":{"PushName":"Бакыт","SenderAlt":"996777334455:3@s.whatsapp.net","IsFromMe":false}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB)
  AND pg_temp.n278_client('100000000000003@lid') = 'Бакыт'
  AND (SELECT cl.phone = '+996777334455' FROM platform.clients cl JOIN platform.communication_conversations c
       ON c.canonical_client_id = cl.id WHERE c.id = pg_temp.n278_conv('100000000000003@lid')),
  'C: a LID chat with its phone in SenderAlt is named by its profile name');
-- D: WEBJS notifyName, then a member types a name, then a new profile name arrives.
SELECT pg_temp.n278_live(5, pg_temp.n278_in('n278-d-1', '79991234567@c.us', '{"notifyName":"Тимур"}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB) AND pg_temp.n278_client('79991234567@c.us') = 'Тимур',
  'D: the WEBJS notifyName is the profile name');
UPDATE platform.clients cl SET display_name = 'Тимур Тестов', normalized_name = platform_private.normalize_person_name('Тимур Тестов')
FROM platform.communication_conversations c WHERE c.id = pg_temp.n278_conv('79991234567@c.us') AND cl.id = c.canonical_client_id;
SELECT pg_temp.n278_live(6, pg_temp.n278_in('n278-d-2', '79991234567@c.us', '{"notifyName":"Timur NEW"}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB) AND pg_temp.n278_client('79991234567@c.us') = 'Тимур Тестов',
  'D: a typed name is never replaced by a profile name');
-- A writes again under a changed profile name: the captured name stays (documented limitation).
SELECT pg_temp.n278_live(7, pg_temp.n278_in('n278-a-2', '996700124664@c.us',
  '{"Info":{"PushName":"Айгуль К.","IsFromMe":false}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB) AND pg_temp.n278_client('996700124664@c.us') = 'Айгуль'
  AND platform_private.waha_conversation_push_name(pg_temp.n278_id(1), pg_temp.n278_conv('996700124664@c.us')) = 'Айгуль К.',
  'A: a captured profile name is the client''s name from then on; the latest profile name is still readable');

-- ---------------------------------------------------------------------------
-- 4. History import: no client until the first live customer message.
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE) AS svc \gset
SELECT platform.begin_waha_history_window_run(pg_temp.n278_id(1), 'crm_primary', 'GOWS', pg_temp.n278_id(301),
  current_setting('n278.w_to')::TIMESTAMPTZ - INTERVAL '7 days', current_setting('n278.w_to')::TIMESTAMPTZ,
  '{"me":{"id":"996700000000@c.us"}}'::JSONB, pg_temp.n278_id(4001)) ->> 'run_id' AS run \gset
SELECT platform.project_waha_history_window_page(pg_temp.n278_id(1), :'run', 'crm_primary', '100000000000005@lid',
  jsonb_build_array(jsonb_build_object('id', 'false_100000000000005@lid_H1',
    'timestamp', floor(extract(epoch FROM current_setting('n278.w_to')::TIMESTAMPTZ - INTERVAL '2 days'))::BIGINT,
    'from', '100000000000005@lid', 'to', NULL, 'fromMe', false, 'hasMedia', false, 'body', 'Вопрос из истории',
    '_data', '{"Info":{"SenderAlt":"996700554664@s.whatsapp.net","PushName":""}}'::JSONB)),
  1, 0, pg_temp.n278_id(4002)) AS page \gset
SELECT set_config('request.jwt.claims', '', TRUE) AS reset_claims \gset
SELECT pg_temp.n278_assert(:'page'::JSONB ->> 'chat_outcome' = 'import_new'
  AND (SELECT c.canonical_client_id IS NULL AND c.subject = 'WhatsApp ••••4664'
       FROM platform.communication_conversations c WHERE c.id = pg_temp.n278_conv('100000000000005@lid'))
  AND COALESCE(current_setting('evo.waha_history_import', TRUE), '') <> 'on',
  'E: the history import creates a chat without a client (its subject ends in the same four digits as A and B)');
SELECT pg_temp.n278_assert(
  pg_temp.n278_admin(ARRAY[pg_temp.n278_conv('100000000000005@lid')]) = jsonb_build_array(jsonb_build_object(
    'conversation_id', pg_temp.n278_conv('100000000000005@lid'), 'contact_name', NULL, 'contact_phone', '+996 ••• 55 46 64')),
  'E: without a client the number comes from the history evidence (SenderAlt); the history has no profile name');
SELECT pg_temp.n278_live(8, pg_temp.n278_in('n278-e-2', '100000000000005@lid',
  '{"Info":{"PushName":"Эрмек","SenderAlt":"996700554664@s.whatsapp.net","IsFromMe":false}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB) AND pg_temp.n278_client('100000000000005@lid') = 'Эрмек',
  'E: the first live customer message promotes the chat and names the new client');

-- ---------------------------------------------------------------------------
-- 5. The reader.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n278_admin(ARRAY[pg_temp.n278_conv('996700124664@c.us'), pg_temp.n278_conv('996555904664@c.us'),
  pg_temp.n278_conv('100000000000003@lid'), pg_temp.n278_conv('79991234567@c.us'), pg_temp.n278_conv('100000000000005@lid'),
  pg_temp.n278_conv('996700124664@c.us'), pg_temp.n278_id(9999)]) AS rows \gset
SELECT pg_temp.n278_assert(
  (SELECT jsonb_object_agg(r.value ->> 'conversation_id', jsonb_build_array(r.value -> 'contact_name', r.value -> 'contact_phone'))
   FROM jsonb_array_elements(:'rows'::JSONB) r(value))
  = jsonb_build_object(
      pg_temp.n278_conv('996700124664@c.us'), jsonb_build_array('Айгуль', '+996 ••• 12 46 64'),
      pg_temp.n278_conv('996555904664@c.us'), jsonb_build_array(NULL, '+996 ••• 90 46 64'),
      pg_temp.n278_conv('100000000000003@lid'), jsonb_build_array('Бакыт', '+996 ••• 33 44 55'),
      pg_temp.n278_conv('79991234567@c.us'), jsonb_build_array('Тимур Тестов', '+7 ••• 23 45 67'),
      pg_temp.n278_conv('100000000000005@lid'), jsonb_build_array('Эрмек', '+996 ••• 55 46 64'))
  AND jsonb_array_length(:'rows'::JSONB) = 5
  AND :'rows'::JSONB::TEXT NOT LIKE '%996700124664%' AND :'rows'::JSONB::TEXT NOT LIKE '%700124%',
  'the reader: one row per chat (duplicates and unknown ids dropped); three chats ending in 4664 read differently; a typed name wins; the full number never appears');
-- The chat subject still drives the running application's queue reader.
SELECT pg_temp.n278_conv('996700124664@c.us') AS conv_a, pg_temp.n278_conv('996555904664@c.us') AS conv_b,
  pg_temp.n278_conv('100000000000003@lid') AS conv_c, pg_temp.n278_conv('100000000000005@lid') AS conv_e,
  (SELECT claims FROM n278_actors WHERE n = 1) AS admin_claims \gset
SELECT set_config('request.jwt.claims', :'admin_claims', TRUE) AS admin_set \gset
SET LOCAL ROLE authenticated;
SELECT count(*) AS page_rows, count(*) FILTER (WHERE p.subject = 'WhatsApp ••••4664') AS page_generated
FROM platform.staff_communication_page('27800000-0000-4000-8000-000000000001'::UUID, 50) p
WHERE p.conversation_id IN (:'conv_a', :'conv_b', :'conv_c', :'conv_e') \gset
RESET ROLE;
SELECT set_config('request.jwt.claims', '', TRUE) AS admin_reset \gset
SELECT pg_temp.n278_assert(:page_rows = 4 AND :page_generated = 3,
  'the queue reader is unchanged: the subjects keep their generated value (A, B, E end in 4664; C in 4455)');
-- Member 3 reads the sales chats (261) but not their clients: the profile
-- name, never the client's name (A: captured «Айгуль» -> latest profile
-- «Айгуль К.»; D: typed «Тимур Тестов» -> profile «Timur NEW»).
SELECT pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 3), pg_temp.n278_id(1),
  ARRAY[pg_temp.n278_conv('996700124664@c.us'), pg_temp.n278_conv('996555904664@c.us'),
    pg_temp.n278_conv('79991234567@c.us')]) AS member_rows \gset
SELECT pg_temp.n278_assert(
  (SELECT jsonb_object_agg(r.value ->> 'conversation_id', jsonb_build_array(r.value -> 'contact_name', r.value -> 'contact_phone'))
   FROM jsonb_array_elements(:'member_rows'::JSONB) r(value))
  = jsonb_build_object(
      pg_temp.n278_conv('996700124664@c.us'), jsonb_build_array('Айгуль К.', '+996 ••• 12 46 64'),
      pg_temp.n278_conv('996555904664@c.us'), jsonb_build_array(NULL, '+996 ••• 90 46 64'),
      pg_temp.n278_conv('79991234567@c.us'), jsonb_build_array('Timur NEW', '+7 ••• 23 45 67'))
  AND :'member_rows' NOT LIKE '%Тимур Тестов%',
  'a member who reads sales chats without client.read sees the profile name and the number, never the client''s name');
SELECT pg_temp.n278_assert(
  pg_temp.n278_admin(ARRAY[pg_temp.n278_id(9998)]) = '[]'::JSONB,
  'an id that is no readable WhatsApp chat gives no row');
-- Refusals.
SELECT pg_temp.n278_assert(
  pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 2), pg_temp.n278_id(1),
    ARRAY[pg_temp.n278_conv('996700124664@c.us')]) = '42501'
  AND pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 5), pg_temp.n278_id(1),
    ARRAY[pg_temp.n278_conv('996700124664@c.us')]) = '42501'
  AND pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 5), pg_temp.n278_id(2),
    ARRAY[pg_temp.n278_conv('996700124664@c.us')]) = '[]'
  AND pg_temp.n278_read('anon', '{"role":"anon"}', pg_temp.n278_id(1), ARRAY[pg_temp.n278_conv('996700124664@c.us')]) = '42501'
  AND pg_temp.n278_read('service_role', '{"role":"service_role"}', pg_temp.n278_id(1),
    ARRAY[pg_temp.n278_conv('996700124664@c.us')]) = '42501',
  'a member without communication.read.full, another organization''s Admin, anon and the service role are refused; another organization reads nothing of this one');
SELECT pg_temp.n278_assert(
  pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 1), pg_temp.n278_id(1), ARRAY[]::UUID[]) = '22023'
  AND pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 1), pg_temp.n278_id(1),
    ARRAY(SELECT pg_temp.n278_id(8000 + g) FROM generate_series(1, 61) g)) = '22023'
  AND pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 1), pg_temp.n278_id(1),
    ARRAY[pg_temp.n278_conv('996700124664@c.us'), NULL]) = '22023'
  AND pg_temp.n278_read('authenticated', (SELECT claims FROM n278_actors WHERE n = 1), pg_temp.n278_id(1),
    ARRAY(SELECT pg_temp.n278_id(8000 + g) FROM generate_series(1, 60) g)) = '[]',
  'input: 1..60 ids without NULL');

-- ---------------------------------------------------------------------------
-- 6. The capture never fails a projection.
-- ---------------------------------------------------------------------------
ALTER TABLE platform.clients ADD CONSTRAINT n278_refuse_name CHECK (display_name <> 'Отказ Базы') NOT VALID;
SELECT pg_temp.n278_live(9, pg_temp.n278_in('n278-f-1', '79990001234@c.us', '{"Info":{"PushName":"Отказ Базы"}}')) AS r \gset
SELECT pg_temp.n278_assert(pg_temp.n278_ok(:'r'::JSONB)
  AND (SELECT count(*) = 1 FROM platform.communication_messages m WHERE m.conversation_id = pg_temp.n278_conv('79990001234@c.us'))
  AND pg_temp.n278_client('79990001234@c.us') IN ('WhatsApp ••••1234', 'WhatsApp +7 ••• 00 12 34'),
  'F: a rename the database refuses is only a warning: the message is stored and the client keeps a placeholder');
ALTER TABLE platform.clients DROP CONSTRAINT n278_refuse_name;

-- ---------------------------------------------------------------------------
-- 7. Backfill: the migration's loop is idempotent and renames pre-278 placeholders.
-- ---------------------------------------------------------------------------
UPDATE platform.clients cl SET display_name = 'WhatsApp ••••4664', normalized_name = platform_private.normalize_person_name('WhatsApp ••••4664')
FROM platform.communication_conversations c WHERE c.id = pg_temp.n278_conv('996700124664@c.us') AND cl.id = c.canonical_client_id;
CREATE FUNCTION pg_temp.n278_backfill() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_object_agg(outcome, n) FROM (
    SELECT platform_private.refresh_waha_client_contact_name(c.organization_id, c.id) AS outcome, count(*) AS n
    FROM platform.communication_conversations c
    WHERE c.organization_id = pg_temp.n278_id(1) AND c.waha_session_name IS NOT NULL AND c.canonical_client_id IS NOT NULL
    GROUP BY 1) s
$$;
SELECT pg_temp.n278_backfill() AS first_pass \gset
SELECT pg_temp.n278_backfill() AS second_pass \gset
SELECT pg_temp.n278_assert(
  :'first_pass'::JSONB = '{"renamed": 2, "unchanged": 1, "kept": 3}'::JSONB
  AND :'second_pass'::JSONB = '{"unchanged": 1, "kept": 5}'::JSONB
  AND pg_temp.n278_client('996700124664@c.us') = 'Айгуль К.' AND pg_temp.n278_client('79991234567@c.us') = 'Тимур Тестов'
  AND pg_temp.n278_client('79990001234@c.us') = 'Отказ Базы',
  'backfill: a pre-278 placeholder takes the LATEST profile name once, typed and captured names are kept, a second pass changes nothing');

-- ---------------------------------------------------------------------------
-- 8. The AI lead card (274) now gets the profile first name («Айгуль К.» -> «Айгуль»); a placeholder still gives none.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n278_assert(
  platform_private.ai_lead_card(pg_temp.n278_id(1), pg_temp.n278_conv('996700124664@c.us')) ->> 'name' = 'Айгуль'
  AND platform_private.ai_lead_card(pg_temp.n278_id(1), pg_temp.n278_conv('100000000000003@lid')) ->> 'name' = 'Бакыт'
  AND platform_private.ai_lead_card(pg_temp.n278_id(1), pg_temp.n278_conv('996555904664@c.us')) ->> 'name' IS NULL,
  'the AI lead card: the profile first name, none for «WhatsApp +996 ••• …»');

SELECT 'N278_WHATSAPP_CONTACT_IDENTITY_SUITE_PASSED' AS n278_suite_result;

ROLLBACK;
