\set ON_ERROR_STOP on
-- Boundary suite for migration 266 («Продажи → WhatsApp» as a full chat, owner
-- decision 06.10.2026). Runs right after 266 with its own synthetic
-- organizations; no provider, Auth invitation, real person or production
-- action. Members are modelled like production (as in the 261 suite): the
-- invited Sales Manager has coarse role NULL and its permissions only through a
-- scoped role assignment with the production keys; the system Admin is the
-- intake owner of every new sales chat. Conversations come from the REAL WAHA
-- projection chain and every reply goes through the REAL manual-send chain
-- (request -> authority trigger -> exact claim -> finish), the readback through
-- the REAL reconciliation request -> service context -> finish.
--
-- Proves:
--  1. contract: the new readers are hardened definers executable by
--     authenticated only, the private routines by nobody, the v1 transcript page,
--     the latest-attempt reader and the 4-argument internal claim are unchanged;
--  2. several replies in a row: two request ids on one inbound message give two
--     authorizations and two work items; a replay of one id adds nothing; the
--     same id with another text is refused; the v1 key still gives exactly one
--     reply per inbound message (the running application keeps working);
--  3. the queue head is per conversation (D2): a send in another chat is claimed
--     while this chat's older item waits; inside a chat the order holds;
--  4. the author is the sender: authorization, audit actor and the sender
--     participant of the stored outbound message are the member who wrote it;
--  5. the chat state and the message page: latest inbound, non-accepted
--     attempts with their state, request id and author; origins client / crm /
--     phone and the CRM author's name; a read-only member reads them, a keyless
--     member, another organization's Admin and anon are refused;
--  6. reply-only and freshness: a newer customer message makes an older source
--     55000; an outbound or unknown source is refused;
--  7. duplicate guard: the text of an unresolved unknown attempt is refused
--     (55000 duplicate_of_unresolved) until a readback found nothing;
--  8. an OLDER unknown attempt (not the latest one) is reconciled without a
--     resend; another chat's attempt, a member without manual.send and another
--     organization are refused.
BEGIN;

DO $n266_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n266_auth_role$;

CREATE FUNCTION pg_temp.n266_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n266_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26600000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n266_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N266: %', message; END IF;
END
$$;
-- SQLSTATE (and, for 55000, the message head) of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n266_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || CASE WHEN SQLERRM LIKE 'duplicate_of_unresolved%' THEN ':duplicate' ELSE '' END;
END
$$;
CREATE FUNCTION pg_temp.n266_key_v1(p_conversation UUID, p_message UUID) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v1', 'manual_whatsapp_send',
    pg_temp.n266_id(1)::TEXT, p_conversation::TEXT, p_message::TEXT, 'staff-authored'])::TEXT, 'UTF8')), 'hex')
$$;
-- The key the application computes for one chat message (src/lib/platform-whatsapp-chat-actions.ts).
CREATE FUNCTION pg_temp.n266_key_v2(p_conversation UUID, p_message UUID, p_request UUID) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v2', 'manual_whatsapp_send',
    pg_temp.n266_id(1)::TEXT, p_conversation::TEXT, p_message::TEXT, 'staff-authored', p_request::TEXT])::TEXT, 'UTF8')), 'hex')
$$;
CREATE FUNCTION pg_temp.n266_send_sql(p_org UUID, p_conversation UUID, p_message UUID, p_text TEXT, p_request INTEGER) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL, %L, 'staff_chat_reply', %L, %L)$q$,
    p_org, p_conversation, p_message, p_text, pg_temp.n266_key_v2(p_conversation, p_message, pg_temp.n266_id(p_request)),
    pg_temp.n266_id(p_request))
$$;
-- One chat message of the current actor: SQLSTATE or 'ok'.
CREATE FUNCTION pg_temp.n266_try(p_conversation UUID, p_message UUID, p_text TEXT, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n266_error(pg_temp.n266_send_sql(pg_temp.n266_id(1), p_conversation, p_message, p_text, p_request))
$$;
-- One chat message of the current actor: the authorization result.
CREATE FUNCTION pg_temp.n266_send(p_conversation UUID, p_message UUID, p_text TEXT, p_request INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  EXECUTE pg_temp.n266_send_sql(pg_temp.n266_id(1), p_conversation, p_message, p_text, p_request) INTO result;
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.n266_reader(p_reader TEXT, p_conversation UUID, p_org INTEGER DEFAULT 1) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  EXECUTE format(CASE p_reader
    WHEN 'state' THEN 'SELECT count(*) FROM platform.staff_whatsapp_chat_state(%L, %L, 50)'
    WHEN 'page' THEN 'SELECT count(*) FROM platform.staff_whatsapp_message_page(%L, %L, 50)'
  END, pg_temp.n266_id(p_org), p_conversation) INTO n;
  RETURN 'rows:' || n;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
CREATE FUNCTION pg_temp.n266_reconcile(p_conversation UUID, p_attempt UUID, p_request INTEGER, p_org INTEGER DEFAULT 1)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n266_error(format($q$SELECT * FROM platform.request_manual_whatsapp_reconciliation(%L, %L, %L, %L, 'staff_requested_exact_waha_readback')$q$,
    pg_temp.n266_id(p_org), p_conversation, p_attempt, pg_temp.n266_id(p_request)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n266_id(INTEGER), pg_temp.n266_wid(INTEGER), pg_temp.n266_assert(BOOLEAN, TEXT),
  pg_temp.n266_error(TEXT), pg_temp.n266_key_v1(UUID, UUID), pg_temp.n266_key_v2(UUID, UUID, UUID),
  pg_temp.n266_send_sql(UUID, UUID, UUID, TEXT, INTEGER), pg_temp.n266_try(UUID, UUID, TEXT, INTEGER),
  pg_temp.n266_send(UUID, UUID, TEXT, INTEGER), pg_temp.n266_reader(TEXT, UUID, INTEGER),
  pg_temp.n266_reconcile(UUID, UUID, INTEGER, INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N266_WHATSAPP_CHAT_REPLIES_SUITE_START' AS n266_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Contract.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n266_assert((SELECT bool_and(r.prosecdef AND r.provolatile = 's' AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND pg_get_userbyid(r.proowner) = 'postgres'
    AND has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0))
  FROM pg_proc r WHERE r.oid IN ('platform.staff_whatsapp_chat_state(uuid,uuid,integer)'::regprocedure,
    'platform.staff_whatsapp_message_page(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure)),
  'the chat readers: stable definers, empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.n266_assert((SELECT bool_and(r.prosecdef AND r.proconfig @> ARRAY['search_path=""']::TEXT[]
    AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', r.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', r.oid, 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0))
  FROM pg_proc r WHERE r.oid IN ('platform_private.manual_whatsapp_send_attempt_states(uuid,uuid)'::regprocedure,
    'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid,uuid)'::regprocedure)),
  'the private routines: definers no client role may execute');
SELECT pg_temp.n266_assert((SELECT md5(prosrc) FROM pg_proc
    WHERE oid = 'platform_private.claim_next_manual_whatsapp_send_internal(uuid,integer,text,uuid)'::regprocedure)
    = '95d095c0c2023a910ff09ea5de98420a'
  AND (SELECT md5(prosrc) FROM pg_proc
    WHERE oid = 'platform.staff_conversation_message_page(uuid,uuid,integer,timestamp with time zone,uuid)'::regprocedure)
    = '511747ace33be04003f6b270fe3a2446'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'platform.staff_latest_manual_whatsapp_send_attempt(uuid,uuid)'::regprocedure)
    = '6973acf4529c5d00907b6221d1ef0b97',
  'the 4-argument internal claim, the v1 transcript page and the latest-attempt reader are untouched');
SELECT pg_temp.n266_assert(
  (SELECT has_function_privilege('authenticated', 'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'platform.request_manual_whatsapp_send_with_authorization(uuid,uuid,uuid,uuid,text,text,text,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'platform.claim_manual_whatsapp_send_item(uuid,uuid,integer,text,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'platform.request_manual_whatsapp_reconciliation(uuid,uuid,uuid,uuid,text)', 'EXECUTE')),
  'the patched routines keep their grants');

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1: 1 Admin (system; the intake owner = head of sales),
-- 2 Sales Manager (invited, coarse role NULL, department scope), 3 «WhatsApp
-- read only», 4 «Sales common» only (no WhatsApp keys). Organization 2: 5 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n266_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n266_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL), (5, 2, 'admin');
GRANT SELECT ON n266_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n266_id(1), 'N266 Fictional organization'),
  (pg_temp.n266_id(2), 'N266 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n266_id(100 + n), 'n266-' || n || '@example.invalid', '{}'::JSONB FROM n266_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n266_id(200 + n), pg_temp.n266_id(100 + n), 'N266 Actor ' || n, 'active', 1 FROM n266_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n266_id(300 + a.n), pg_temp.n266_id(a.org), pg_temp.n266_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n266_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n266_id(301), pg_temp.n266_id(305));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n266_id(401), pg_temp.n266_id(1), 'organization', pg_temp.n266_id(1), 1),
  (pg_temp.n266_id(402), pg_temp.n266_id(2), 'organization', pg_temp.n266_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.n266_id(1), pg_temp.n266_id(301), pg_temp.n266_id(401), 1, 1, TRUE, 'system',
    'N266 synthetic organization scope', pg_temp.n266_id(601)),
  (pg_temp.n266_id(2), pg_temp.n266_id(305), pg_temp.n266_id(402), 1, 1, TRUE, 'system',
    'N266 synthetic other-organization scope', pg_temp.n266_id(602));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n266_id(901), pg_temp.n266_id(1), 'N266 Sales');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n266_id(1), pg_temp.n266_id(302), pg_temp.n266_id(901));

CREATE TEMP TABLE n266_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n266_roles VALUES
 (pg_temp.n266_id(1101), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1110),
 (pg_temp.n266_id(1102), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1120),
 (pg_temp.n266_id(1103), 'WhatsApp read only', '["ai.draft.review","communication.read.full"]', 1130);
CREATE TEMP TABLE n266_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n266_grants VALUES
 (302, pg_temp.n266_id(1101), jsonb_build_object('kind', 'department', 'key', pg_temp.n266_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n266_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.n266_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n266_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n266_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.n266_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n266_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n266_id(1);
GRANT SELECT ON n266_roles, n266_grants, n266_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n266_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n266_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n266_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n266_admin_setup';
SET LOCAL ROLE authenticated;
DO $n266_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n266_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n266_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N266 ' || r.label, 'description', 'Migration 266 synthetic role',
        'permissionKeys', r.keys), 'N266 create role', pg_temp.n266_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n266_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n266_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N266 publish role', pg_temp.n266_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n266_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n266_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n266_id(1), pg_temp.n266_id(m),
      (SELECT access_version FROM n266_versions WHERE membership_id = pg_temp.n266_id(m)), items, bindings,
      'N266 grant roles', pg_temp.n266_id(2000 + m));
  END LOOP;
END
$n266_roles$;
RESET ROLE;

UPDATE n266_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n266_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n266_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n266_admin FROM n266_actors WHERE n = 1 \gset
SELECT claims AS n266_sales FROM n266_actors WHERE n = 2 \gset
SELECT claims AS n266_read FROM n266_actors WHERE n = 3 \gset
SELECT claims AS n266_keyless FROM n266_actors WHERE n = 4 \gset
SELECT claims AS n266_other_admin FROM n266_actors WHERE n = 5 \gset
SELECT pg_temp.n266_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n266_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'admin'], 'the JWT carries staff for invited members, admin for the system Admins');

-- Conversations through the REAL projection chain (the intake owner is the Admin).
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
CREATE FUNCTION pg_temp.n266_run(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.n266_id(1);
  event_id CONSTANT UUID := pg_temp.n266_wid(1000 + p_n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'n266-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', TIMESTAMPTZ '2026-10-06 07:00:00+00' + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:n266:' || p_n, lpad(to_hex(p_n + 4096), 64, '0'), pg_temp.n266_wid(1500 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('n266-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.n266_wid(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'n266', pg_temp.n266_wid(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.n266_id(301), pg_temp.n266_wid(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.n266_wid(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
CREATE FUNCTION pg_temp.n266_in(p_id TEXT, p_from TEXT, p_body TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', p_from, 'fromMe', false, 'source', 'app', 'body', p_body)
$$;
CREATE FUNCTION pg_temp.n266_out(p_id TEXT, p_to TEXT, p_body TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', 1788343200, 'from', '79962000000@c.us', 'to', p_to,
    'fromMe', true, 'source', 'app', 'body', p_body)
$$;
CREATE FUNCTION pg_temp.n266_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.n266_id(1) AND binding.normalized_chat_id = p_chat
$$;
-- The service role's exact claim and finish of one work item.
CREATE FUNCTION pg_temp.n266_claim(p_work UUID, p_n INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE result TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  BEGIN
    result := platform.claim_manual_whatsapp_send_item(pg_temp.n266_id(1), p_work, 60, 'n266-worker', pg_temp.n266_wid(4000 + p_n))::TEXT;
  EXCEPTION WHEN OTHERS THEN
    result := SQLSTATE;
  END;
  RESET ROLE;
  RETURN result;
END
$$;
CREATE FUNCTION pg_temp.n266_finish(p_claim JSONB, p_outcome TEXT, p_provider_id TEXT, p_n INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  SET LOCAL ROLE service_role;
  result := platform.finish_manual_whatsapp_send(pg_temp.n266_id(1), (p_claim ->> 'work_item_id')::UUID,
    (p_claim ->> 'attempt_id')::UUID, (p_claim ->> 'manual_send_authorization_id')::UUID,
    p_outcome::platform.durable_work_finish_outcome,
    CASE p_outcome WHEN 'unknown_result' THEN 'provider_timeout' WHEN 'terminal_error' THEN 'message_rejected' END,
    p_provider_id, CASE WHEN p_provider_id IS NULL THEN NULL ELSE statement_timestamp() END, pg_temp.n266_wid(5000 + p_n));
  RESET ROLE;
  RETURN result;
END
$$;

SELECT pg_temp.n266_run(1, pg_temp.n266_in('false_79962000001@c.us_N266AAAAAAAAAAAAAAA1', '79962000001@c.us', 'Здравствуйте, первый клиент')) AS r1 \gset
SELECT pg_temp.n266_run(2, pg_temp.n266_in('false_79962000002@c.us_N266AAAAAAAAAAAAAAA2', '79962000002@c.us', 'Здравствуйте, второй клиент')) AS r2 \gset
SELECT pg_temp.n266_run(3, pg_temp.n266_out('true_79962000001@c.us_N266PPPPPPPPPPPPPPP1', '79962000001@c.us', 'Ответ с телефона продаж')) AS r3 \gset
SELECT pg_temp.n266_assert((:'r1'::JSONB ->> 'disposition') = 'succeeded' AND (:'r2'::JSONB ->> 'disposition') = 'succeeded'
  AND (:'r3'::JSONB ->> 'disposition') = 'succeeded' AND (:'r3'::JSONB ->> 'direction') = 'outbound',
  'two customer messages and one phone-sent message project through the real chain');
SELECT pg_temp.n266_conv('79962000001@c.us') AS c1, pg_temp.n266_conv('79962000002@c.us') AS c2 \gset
SELECT m.id AS m1 FROM platform.communication_messages m WHERE m.conversation_id = :'c1' AND m.direction = 'inbound' \gset
SELECT m.id AS m2 FROM platform.communication_messages m WHERE m.conversation_id = :'c2' AND m.direction = 'inbound' \gset
SELECT m.id AS phone1 FROM platform.communication_messages m WHERE m.conversation_id = :'c1' AND m.direction = 'outbound' \gset
SELECT pg_temp.n266_assert((SELECT count(*) = 2 AND bool_and(queue = 'sales' AND responsible_sales_membership_id = pg_temp.n266_id(301))
  FROM platform.communication_conversations WHERE id IN (:'c1', :'c2')), 'two sales chats owned by the intake owner');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO platform_private.messaging_integration_health_events (organization_id, target, readiness, evidence_kind,
  reason, evidence_ref, request_id, observed_at)
VALUES (pg_temp.n266_id(1), 'waha', 'ready', 'provider_observed', 'N266 synthetic fresh WAHA readiness',
  'synthetic:n266:waha-ready', pg_temp.n266_id(3001), statement_timestamp());

-- ---------------------------------------------------------------------------
-- 2. Several replies in a row (the Sales Manager is not the chat's owner).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_send(:'c1', :'m1', 'Добрый день! Это первое сообщение', 3101)::TEXT AS s1 \gset
SELECT pg_temp.n266_send(:'c1', :'m1', 'И второе сообщение подряд', 3102)::TEXT AS s2 \gset
-- A replay of the first click (a lost answer) returns the same work item and adds nothing.
SELECT pg_temp.n266_send(:'c1', :'m1', 'Добрый день! Это первое сообщение', 3101)::TEXT AS s1_replay \gset
SELECT pg_temp.n266_try(:'c1', :'m1', 'Другой текст с тем же идентификатором', 3101) AS s1_other_text \gset
-- A key that does not bind this request id is refused.
SELECT pg_temp.n266_error(format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL, 'Чужой ключ', 'staff_chat_reply', %L, %L)$q$,
  pg_temp.n266_id(1), :'c1', :'m1', pg_temp.n266_key_v2(:'c1', :'m1', pg_temp.n266_id(3199)), pg_temp.n266_id(3104))) AS s_wrong_key \gset
RESET ROLE;
SELECT pg_temp.n266_assert((:'s1'::JSONB ->> 'work_item_id') IS NOT NULL AND (:'s2'::JSONB ->> 'work_item_id') IS NOT NULL
  AND (:'s1'::JSONB ->> 'work_item_id') <> (:'s2'::JSONB ->> 'work_item_id')
  AND (:'s1'::JSONB ->> 'source_message_id') = :'m1' AND (:'s2'::JSONB ->> 'source_message_id') = :'m1',
  'two request ids on one inbound message: two work items');
SELECT pg_temp.n266_assert(:'s1_replay'::JSONB = :'s1'::JSONB, 'the replay returns the stored result');
SELECT pg_temp.n266_assert(:'s1_other_text' NOT IN ('ok', '42501') AND :'s_wrong_key' = '22023',
  'the same id with another text and a key of another id are refused');
SELECT pg_temp.n266_assert((SELECT count(*) = 2 FROM platform.manual_send_authorizations WHERE conversation_id = :'c1'::UUID)
  AND (SELECT count(*) = 2 FROM platform_private.durable_work_items i JOIN platform.manual_send_authorizations a
    ON a.organization_id = i.organization_id AND a.id = i.manual_send_authorization_id WHERE a.conversation_id = :'c1'::UUID),
  'exactly two authorizations and two work items: the replay and the refusals added no row');

-- The v1 key (the running application) still gives exactly one reply per inbound message.
SET LOCAL request.jwt.claims TO :'n266_admin';
SET LOCAL ROLE authenticated;
SELECT platform.request_manual_whatsapp_send_with_authorization(pg_temp.n266_id(1), :'c1', :'m1', NULL,
  'Ответ прежним ключом', 'staff_confirmed_manual_send', pg_temp.n266_key_v1(:'c1', :'m1'), pg_temp.n266_id(3105))::TEXT AS s3 \gset
SELECT pg_temp.n266_error(format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL, 'Второй ответ прежним ключом', 'staff_confirmed_manual_send', %L, %L)$q$,
  pg_temp.n266_id(1), :'c1', :'m1', pg_temp.n266_key_v1(:'c1', :'m1'), pg_temp.n266_id(3106))) AS s3_second \gset
SELECT pg_temp.n266_send(:'c2', :'m2', 'Ответ второму клиенту', 3107)::TEXT AS t1 \gset
RESET ROLE;
SELECT pg_temp.n266_assert((:'s3'::JSONB ->> 'work_item_id') IS NOT NULL AND :'s3_second' = '22023',
  'v1 key: one reply, the second reply to the same message is refused as before');

-- ---------------------------------------------------------------------------
-- 3. The queue head is per conversation (D2).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n266_claim((:'t1'::JSONB ->> 'work_item_id')::UUID, 1) AS t1_claim \gset
SELECT pg_temp.n266_assert((:'t1_claim'::JSONB ->> 'claimed')::BOOLEAN
  AND (:'t1_claim'::JSONB ->> 'work_item_id') = (:'t1'::JSONB ->> 'work_item_id'),
  'a send in chat 2 is claimed although chat 1''s older items wait (before 266 the organization head blocked it)');
SELECT pg_temp.n266_claim((:'s2'::JSONB ->> 'work_item_id')::UUID, 2) AS s2_early \gset
SELECT pg_temp.n266_assert(:'s2_early' = '55000', 'inside a chat the order holds: the second message waits for the first');
SELECT pg_temp.n266_claim((:'s1'::JSONB ->> 'work_item_id')::UUID, 3) AS s1_claim \gset
SELECT pg_temp.n266_assert((:'s1_claim'::JSONB ->> 'claimed')::BOOLEAN AND (:'s1_claim'::JSONB ->> 'final_text') = 'Добрый день! Это первое сообщение',
  'the first message of chat 1 is claimed exactly');
SELECT pg_temp.n266_finish(:'s1_claim'::JSONB, 'succeeded', 'true_79962000001@c.us_N266CCCCCCCCCCCCCCC1', 1)::TEXT AS s1_finish \gset
SELECT pg_temp.n266_claim((:'s2'::JSONB ->> 'work_item_id')::UUID, 4) AS s2_claim \gset
SELECT pg_temp.n266_finish(:'s2_claim'::JSONB, 'unknown_result', NULL, 2)::TEXT AS s2_finish \gset
SELECT pg_temp.n266_claim((:'s3'::JSONB ->> 'work_item_id')::UUID, 5) AS s3_claim \gset
SELECT pg_temp.n266_finish(:'s3_claim'::JSONB, 'terminal_error', NULL, 3)::TEXT AS s3_finish \gset
SELECT pg_temp.n266_finish(:'t1_claim'::JSONB, 'succeeded', 'true_79962000002@c.us_N266CCCCCCCCCCCCCCC2', 4)::TEXT AS t1_finish \gset
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.n266_assert((:'s1_finish'::JSONB ->> 'state') = 'succeeded' AND (:'s2_finish'::JSONB ->> 'state') = 'unknown_manual_review'
  AND (:'s3_finish'::JSONB ->> 'state') = 'dead_lettered' AND (:'t1_finish'::JSONB ->> 'state') = 'succeeded',
  'the four sends settle: accepted, unknown, rejected, accepted');

-- ---------------------------------------------------------------------------
-- 4. The author is the sender.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n266_assert((SELECT a.authorized_by_membership_id = pg_temp.n266_id(302)
    AND a.authorized_by_profile_id = pg_temp.n266_id(202)
  FROM platform.manual_send_authorizations a WHERE a.id = (:'s1'::JSONB ->> 'manual_send_authorization_id')::UUID),
  'the authorization names the Sales Manager');
SELECT pg_temp.n266_assert((SELECT count(*) = 1 FROM platform.audit_events
    WHERE action = 'communication.manual.send.request' AND resource_id = (:'s1'::JSONB ->> 'work_item_id')::UUID
      AND actor_profile_id = pg_temp.n266_id(202) AND request_id = pg_temp.n266_id(3101))
  AND (SELECT count(*) = 1 FROM platform.audit_events
    WHERE action = 'communication.manual.authorize' AND resource_id = (:'s1'::JSONB ->> 'manual_send_authorization_id')::UUID
      AND actor_profile_id = pg_temp.n266_id(202)),
  'the audit events name the Sales Manager and carry the click''s request id');
SELECT pg_temp.n266_assert((SELECT count(*) = 1 AND bool_and(p.membership_id = pg_temp.n266_id(302) AND m.body_text = 'Добрый день! Это первое сообщение')
  FROM platform.communication_messages m
  JOIN platform.conversation_participants p ON p.organization_id = m.organization_id AND p.id = m.sender_participant_id
  WHERE m.manual_send_authorization_id = (:'s1'::JSONB ->> 'manual_send_authorization_id')::UUID),
  'the stored outbound message has the Sales Manager as its sender');

-- ---------------------------------------------------------------------------
-- 5. The chat state and the message page.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT to_jsonb(s)::TEXT AS c1_state FROM platform.staff_whatsapp_chat_state(pg_temp.n266_id(1), :'c1', 50) AS s \gset
SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.message_id)::TEXT AS c1_page
  FROM platform.staff_whatsapp_message_page(pg_temp.n266_id(1), :'c1', 50) AS p \gset
SELECT pg_temp.n266_error(format('SELECT * FROM platform.staff_whatsapp_chat_state(%L, %L, 51)', pg_temp.n266_id(1), :'c1')) AS bad_limit \gset
RESET ROLE;
SELECT pg_temp.n266_assert((:'c1_state'::JSONB ->> 'latest_inbound_message_id') = :'m1'
  AND jsonb_array_length(:'c1_state'::JSONB -> 'attempts') = 2
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'work_item_id') = (:'s2'::JSONB ->> 'work_item_id')
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'status') = 'unknown'
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'reconciliation_required')::BOOLEAN
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'request_id') = pg_temp.n266_id(3102)::TEXT
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'authorized_by_name') = 'N266 Actor 2'
  AND (:'c1_state'::JSONB -> 'attempts' -> 0 ->> 'final_text') = 'И второе сообщение подряд'
  AND (:'c1_state'::JSONB -> 'attempts' -> 1 ->> 'status') = 'rejected'
  AND (:'c1_state'::JSONB -> 'attempts' -> 1 ->> 'failure_code') = 'message_rejected'
  AND NOT ((:'c1_state'::JSONB -> 'attempts' -> 0) ?| ARRAY['raw_chat_id', 'waha_session_name', 'provider_message_id']),
  'chat state: latest inbound, the unknown and the rejected attempt with request id and author, no private identity');
SELECT pg_temp.n266_assert(:'bad_limit' = '22023', 'chat state limit is bounded to 50');
SELECT pg_temp.n266_assert((SELECT array_agg(e ->> 'origin' ORDER BY ord) FROM jsonb_array_elements(:'c1_page'::JSONB) WITH ORDINALITY AS x(e, ord))
    = ARRAY['client', 'phone', 'crm']
  AND (SELECT array_agg(e ->> 'sender_name' ORDER BY ord) FROM jsonb_array_elements(:'c1_page'::JSONB) WITH ORDINALITY AS x(e, ord))
    = ARRAY[NULL, NULL, 'N266 Actor 2']
  AND (SELECT array_agg(e ->> 'sender_membership_id' ORDER BY ord) FROM jsonb_array_elements(:'c1_page'::JSONB) WITH ORDINALITY AS x(e, ord))
    = ARRAY[NULL, NULL, pg_temp.n266_id(302)::TEXT]
  AND (SELECT bool_and(NOT (e ?| ARRAY['waha_message_id', 'waha_session_name', 'kommo_message_id'])) FROM jsonb_array_elements(:'c1_page'::JSONB) e),
  'message page: client, phone and CRM origins, the CRM author''s name, no provider identity');

SET LOCAL request.jwt.claims TO :'n266_read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_assert(pg_temp.n266_reader('state', :'c1') = 'rows:1' AND pg_temp.n266_reader('page', :'c1') = 'rows:3',
  'a read-only member reads the chat state and the page');
SELECT pg_temp.n266_assert(pg_temp.n266_try(:'c1', :'m1', 'Только чтение', 3201) = '42501', 'a read-only member cannot send');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n266_keyless';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_assert(pg_temp.n266_reader('state', :'c1') = '42501' AND pg_temp.n266_reader('page', :'c1') = '42501'
  AND pg_temp.n266_try(:'c1', :'m1', 'Без прав', 3202) = '42501', 'a member without WhatsApp keys reads and sends nothing');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n266_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_assert(pg_temp.n266_reader('state', :'c1') = '42501' AND pg_temp.n266_reader('state', :'c1', 2) = '42501'
  AND pg_temp.n266_reader('page', :'c1', 2) = '42501', 'another organization''s Admin is refused in both organizations');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.n266_assert(pg_temp.n266_reader('state', :'c1') = '42501' AND pg_temp.n266_reader('page', :'c1') = '42501',
  'anon cannot execute the chat readers');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6/7. Freshness, reply-only and the duplicate guard.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_try(:'c1', :'m1', 'И второе сообщение подряд', 3301) AS dup1 \gset
SELECT pg_temp.n266_try(:'c1', :'phone1', 'Ответ на исходящее', 3302) AS outbound_source \gset
SELECT pg_temp.n266_try(:'c1', pg_temp.n266_id(999), 'Ответ без источника', 3303) AS unknown_source \gset
SELECT pg_temp.n266_try(:'c1', :'m2', 'Источник из другого чата', 3304) AS foreign_source \gset
RESET ROLE;
SELECT pg_temp.n266_assert(:'dup1' = '55000:duplicate', 'the text of an unresolved unknown attempt is refused as a duplicate');
SELECT pg_temp.n266_assert(:'outbound_source' = '55000' AND :'unknown_source' = '55000' AND :'foreign_source' = '55000',
  'reply-only: an outbound, unknown or foreign source is refused');

-- The customer writes again; the older source is stale now.
SELECT pg_temp.n266_run(4, pg_temp.n266_in('false_79962000001@c.us_N266AAAAAAAAAAAAAAA4', '79962000001@c.us', 'Ещё вопрос')) AS r4 \gset
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT m.id AS m4 FROM platform.communication_messages m
  WHERE m.conversation_id = :'c1' AND m.direction = 'inbound' AND m.id <> :'m1' \gset
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_try(:'c1', :'m1', 'Ответ на старое сообщение', 3401) AS stale \gset
SELECT pg_temp.n266_send(:'c1', :'m4', 'Ответ на новый вопрос', 3402)::TEXT AS s4 \gset
RESET ROLE;
SELECT pg_temp.n266_assert(:'stale' = '55000', 'a newer customer message makes the older source stale (55000)');
SELECT pg_temp.n266_claim((:'s4'::JSONB ->> 'work_item_id')::UUID, 6) AS s4_claim \gset
SELECT pg_temp.n266_finish(:'s4_claim'::JSONB, 'succeeded', 'true_79962000001@c.us_N266CCCCCCCCCCCCCCC4', 5)::TEXT AS s4_finish \gset
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.n266_assert((:'s4_finish'::JSONB ->> 'state') = 'succeeded', 'the reply to the new message is accepted');

-- ---------------------------------------------------------------------------
-- 8. An OLDER unknown attempt is reconciled without a resend.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT attempt_id::TEXT AS latest_attempt FROM platform.staff_latest_manual_whatsapp_send_attempt(pg_temp.n266_id(1), :'c1') \gset
RESET ROLE;
SELECT pg_temp.n266_assert(:'latest_attempt' = (:'s4_claim'::JSONB ->> 'attempt_id') AND :'latest_attempt' <> (:'s2_claim'::JSONB ->> 'attempt_id'),
  'the unknown attempt is no longer the latest one (before 266 it could not be checked any more)');

SET LOCAL request.jwt.claims TO :'n266_read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_reconcile(:'c1', (:'s2_claim'::JSONB ->> 'attempt_id')::UUID, 3501) AS rec_read \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n266_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_reconcile(:'c1', (:'s2_claim'::JSONB ->> 'attempt_id')::UUID, 3502, 2) AS rec_other \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n266_reconcile(:'c2', (:'s2_claim'::JSONB ->> 'attempt_id')::UUID, 3503) AS rec_wrong_chat \gset
SELECT pg_temp.n266_reconcile(:'c1', (:'s1_claim'::JSONB ->> 'attempt_id')::UUID, 3504) AS rec_accepted \gset
SELECT r.reconciliation_request_id::TEXT AS rec_id, r.reconciliation_kind AS rec_kind
  FROM platform.request_manual_whatsapp_reconciliation(pg_temp.n266_id(1), :'c1', (:'s2_claim'::JSONB ->> 'attempt_id')::UUID,
    pg_temp.n266_id(3505), 'staff_requested_exact_waha_readback') AS r \gset
RESET ROLE;
SELECT pg_temp.n266_assert(:'rec_read' = '42501' AND :'rec_other' = '42501' AND :'rec_wrong_chat' = '42501',
  'a member without manual.send, another organization and another chat''s id are refused');
SELECT pg_temp.n266_assert(:'rec_accepted' = 'ok', 'an older accepted attempt may refresh its delivery state');
SELECT pg_temp.n266_assert(:'rec_kind' = 'unknown_recovery', 'the older unknown attempt gets an exact no-resend readback request');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
SET LOCAL ROLE service_role;
SELECT platform.manual_whatsapp_reconciliation_context(:'rec_id')::TEXT AS rec_context \gset
SELECT platform.finish_manual_whatsapp_reconciliation(:'rec_id', :'rec_context'::JSONB ->> 'waha_session_name',
  :'rec_context'::JSONB ->> 'raw_chat_id', :'rec_context'::JSONB ->> 'final_text_sha256', 0, NULL, NULL, NULL, NULL, NULL,
  pg_temp.n266_wid(6001))::TEXT AS rec_finish \gset
RESET ROLE;
SELECT pg_temp.n266_assert((:'rec_context'::JSONB ->> 'attempt_id') = (:'s2_claim'::JSONB ->> 'attempt_id')
  AND (:'rec_finish'::JSONB ->> 'outcome') = 'message_not_found', 'the readback of the older attempt found nothing');
SELECT pg_temp.n266_assert((SELECT count(*) = 0 FROM platform_private.durable_work_attempts a
    WHERE a.work_item_id = (:'s2'::JSONB ->> 'work_item_id')::UUID AND a.attempt_number > 1),
  'no resend: the work item still has its single attempt');

SET LOCAL request.jwt.claims TO :'n266_sales';
SET LOCAL ROLE authenticated;
SELECT (SELECT e FROM jsonb_array_elements(s.attempts) e WHERE e ->> 'work_item_id' = (:'s2'::JSONB ->> 'work_item_id'))::TEXT AS s2_state
  FROM platform.staff_whatsapp_chat_state(pg_temp.n266_id(1), :'c1', 50) AS s \gset
SELECT pg_temp.n266_try(:'c1', :'m4', 'И второе сообщение подряд', 3601) AS dup_after_check \gset
RESET ROLE;
SELECT pg_temp.n266_assert((:'s2_state'::JSONB ->> 'status') = 'unknown' AND (:'s2_state'::JSONB ->> 'latest_reconciliation_outcome') = 'message_not_found',
  'chat state shows the attempt as checked and not found');
SELECT pg_temp.n266_assert(:'dup_after_check' = 'ok', 'after a readback found nothing the same text may be sent again');

SELECT 'N266_WHATSAPP_CHAT_REPLIES_SUITE_PASSED' AS n266_suite_result;

ROLLBACK;
