\set ON_ERROR_STOP on
-- Boundary suite for migration 385: пометка «Тестовый лид» (docs/PLAN_CHANGES.md, ночь 28.11.2026, «ИИ-агенты: мозг компании,
-- досье и предохранители»).
-- Runs on the real chain right after 385 inside one transaction that is rolled back, with its own synthetic organization and
-- member. Leads come through the REAL website intake (`receive_website_lead`), conversations through the real WAHA projection
-- chain. No provider, no Claude / Anthropic call, no real person, no production action.
--
-- Proves:
--  1. posture: the column (boolean, not null, default false); the staff write and read for authenticated only; the hook
--     function for service_role only; none of them for anon;
--  2. the write: marks and unmarks; each change leaves ONE journal row (lead.testflag.change, before/after); the same value is
--     "unchanged" and writes nothing; a replay of the request id returns the first receipt without a second row; the same id
--     with another value is a conflict; a closed lead can be marked; no membership / anon are refused; an unknown lead is refused;
--  3. the flag reader returns only the test leads among the named ones (and refuses a stranger);
--  4. the hook function: a website request on a test lead and a WhatsApp chat of a test lead are "test", the ordinary lead and
--     a missing / malformed ref are not; a staff role cannot call it;
--  5. the agent tools: list_leads and funnel_stats do not see a test lead (created, stale, by stage), list_conversations does not
--     list its chat, and everything comes back when the flag is removed; get_lead by an explicit id still answers;
--  6. the sales funnel screen (current_sales_funnel) counts open leads without the test one.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- The Supabase auth.role() helper receive_website_lead calls first (absent from the bare test image); created inside this
-- transaction only, as in the 262 and 303 suites.
DO $a385_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$a385_auth_role$;

\echo A385_LEADS_IS_TEST_SUITE_START

CREATE FUNCTION pg_temp.a385_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a385_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A385: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.a385_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a385_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a385_claims TO authenticated;
CREATE FUNCTION pg_temp.a385_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_call('authenticated', (SELECT claims FROM a385_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a385_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a385_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a385_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture: one organization, one system admin (the intake owner), one outsider with no membership.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a385_id(1), 'A385 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.a385_id(101), 'a385-1@example.invalid', '{}'::JSONB);
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.a385_id(102), 'a385-2@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a385_id(201), pg_temp.a385_id(101), 'A385 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  VALUES (pg_temp.a385_id(301), pg_temp.a385_id(1), pg_temp.a385_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-02 00:00:00+00');
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a385_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a385_id(401), pg_temp.a385_id(1), 'organization', pg_temp.a385_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a385_id(1), pg_temp.a385_id(301), pg_temp.a385_id(401), 1, 1, TRUE, 'system', 'A385 synthetic scope', pg_temp.a385_id(601));
INSERT INTO a385_claims(actor, claims)
  SELECT 1, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a385_id(101),
    'claims', jsonb_build_object('sub', pg_temp.a385_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a385_assert((SELECT claims::JSONB ? 'platform_membership_id' FROM a385_claims WHERE actor = 1), 'the admin got real hook claims');
-- A signed-in user who belongs to no organization.
INSERT INTO a385_claims(actor, claims)
  VALUES (2, jsonb_build_object('sub', pg_temp.a385_id(102), 'role', 'authenticated')::TEXT);

-- An Admissions-like member: lead.read but NOT lead.sales.workflow.manage (production permission keys, as in 262's suite).
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.a385_id(103), 'a385-3@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a385_id(203), pg_temp.a385_id(103), 'A385 Reader', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.a385_id(303), pg_temp.a385_id(1), pg_temp.a385_id(203), 'active', NULL, NULL);
CREATE TEMP TABLE a385_versions AS SELECT access_version FROM platform.profiles WHERE id = pg_temp.a385_id(203);
GRANT SELECT ON a385_versions TO authenticated;
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a385_id(101),
  'claims', jsonb_build_object('sub', pg_temp.a385_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS a385_admin_setup \gset
SET LOCAL request.jwt.claims TO :'a385_admin_setup';
SET LOCAL ROLE authenticated;
DO $a385_roles$
DECLARE published JSONB; role_id CONSTANT UUID := pg_temp.a385_id(1101);
BEGIN
  PERFORM platform.staff_role_command(pg_temp.a385_id(1), role_id, 0, 'create',
    jsonb_build_object('label', 'A385 Reader', 'description', 'Migration 385 synthetic role',
      'permissionKeys', '["client.read","lead.read","staff.task.read"]'::JSONB), 'A385 create role', pg_temp.a385_id(1111));
  published := platform.staff_role_publish(pg_temp.a385_id(1), role_id, 1,
    platform.staff_role_impact(pg_temp.a385_id(1), role_id, 1) ->> 'impactFingerprint', 'A385 publish role', pg_temp.a385_id(1112));
  PERFORM platform.staff_role_assignments_save(pg_temp.a385_id(1), pg_temp.a385_id(303),
    (SELECT access_version FROM a385_versions),
    jsonb_build_array(jsonb_build_object('roleId', role_id, 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.a385_id(1), 'resourceKind', NULL))),
    jsonb_build_array(jsonb_build_object('roleId', role_id, 'roleVersion', 2, 'bundleId', (published ->> 'bundleId')::UUID, 'bundleVersion', 1)),
    'A385 grant role', pg_temp.a385_id(1113));
END
$a385_roles$;
RESET ROLE;
RESET request.jwt.claims;
INSERT INTO a385_claims(actor, claims)
  SELECT 3, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a385_id(103),
    'claims', jsonb_build_object('sub', pg_temp.a385_id(103), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a385_assert(
  platform_private.staff_has_permission(pg_temp.a385_id(1), pg_temp.a385_id(303), 'lead.read')
  AND NOT platform_private.staff_has_permission(pg_temp.a385_id(1), pg_temp.a385_id(303), 'lead.sales.workflow.manage'),
  'fixture: the reader member has lead.read but not the Sales workflow');

-- Leads through the REAL website intake: A (ordinary) and B (to be marked as test); one IP hash per call (5 per 10 minutes).
CREATE FUNCTION pg_temp.a385_site(p_req INTEGER, p_phone TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_svc(format(
    'SELECT platform.receive_website_lead(%L, %L, %L, ''A385 Fictional Applicant'', %L, 20, ''Бишкек'', ''China'', TRUE, %L, NULL)',
    pg_temp.a385_id(1), pg_temp.a385_id(301), pg_temp.a385_id(1000 + p_req), p_phone, lpad(to_hex(p_req), 64, '0')))
$$;
SELECT pg_temp.a385_site(1, '+996555385001') AS a385_s1, pg_temp.a385_site(2, '+996555385002') AS a385_s2 \gset
SELECT pg_temp.a385_assert((:'a385_s1'::JSONB ->> 'status') = 'accepted' AND (:'a385_s2'::JSONB ->> 'status') = 'accepted',
  'fixture: two website enquiries accepted (' || :'a385_s1' || ' ' || :'a385_s2' || ')');
SELECT r.lead_id AS a385_lead_a FROM platform_private.website_lead_receipts r WHERE r.request_id = pg_temp.a385_id(1001) \gset
SELECT r.lead_id AS a385_lead_b FROM platform_private.website_lead_receipts r WHERE r.request_id = pg_temp.a385_id(1002) \gset
SELECT pg_temp.a385_assert(:'a385_lead_a' <> :'a385_lead_b', 'fixture: two distinct leads');
-- WhatsApp chats through the REAL WAHA projection chain, one per lead.
CREATE TEMP TABLE a385_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
GRANT SELECT ON a385_clock TO authenticated, service_role;
CREATE SEQUENCE pg_temp.a385_seq;
CREATE FUNCTION pg_temp.a385_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a385_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.a385_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.a385_id(20000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a385-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:a385:' || n, lpad(to_hex(3850000 + n), 64, '0'), pg_temp.a385_id(25000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a385-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.a385_id(30000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a385', pg_temp.a385_id(30000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a385_id(301), pg_temp.a385_id(30000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a385_id(30000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'A385: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
CREATE FUNCTION pg_temp.a385_chat(p_chat INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996790' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := (SELECT t0 FROM a385_clock) - INTERVAL '600 seconds';
  wid TEXT := 'false_' || chat || '_A385' || lpad(nextval('pg_temp.a385_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.a385_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', 'Сообщение клиента ' || p_chat), at);
  RETURN (SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
    WHERE binding.organization_id = pg_temp.a385_id(1) AND binding.normalized_chat_id = chat);
END
$$;
SELECT pg_temp.a385_chat(1) AS a385_chat_a, pg_temp.a385_chat(2) AS a385_chat_b \gset
SELECT pg_temp.a385_assert(:'a385_chat_a' IS NOT NULL AND :'a385_chat_b' IS NOT NULL AND :'a385_chat_a' <> :'a385_chat_b',
  'fixture: two WhatsApp conversations through the real projection chain');
-- The projection of a first chat creates its own WhatsApp lead: those two are the chat leads; the website pair is the intake pair.
SELECT cv.canonical_lead_id AS a385_wa_a FROM platform.communication_conversations cv WHERE cv.id = :'a385_chat_a'::UUID \gset
SELECT cv.canonical_lead_id AS a385_wa_b FROM platform.communication_conversations cv WHERE cv.id = :'a385_chat_b'::UUID \gset
SELECT pg_temp.a385_assert(:'a385_wa_a' <> '' AND :'a385_wa_b' <> '' AND :'a385_wa_a' <> :'a385_wa_b'
  AND (SELECT count(*) = 4 FROM platform.leads WHERE organization_id = pg_temp.a385_id(1)), 'fixture: four leads in all (two website, two WhatsApp), each chat on its own lead');
-- All four look stale (a week and more without activity); direct write, triggers off.
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET updated_at = clock_timestamp() - INTERVAL '10 days' WHERE organization_id = pg_temp.a385_id(1);
SET LOCAL session_replication_role = origin;

-- The sales agent on, so its tools answer (the same call the MCP server makes, service_role).
SELECT pg_temp.a385_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a385_id(1))) AS a385_list \gset
SELECT pg_temp.a385_staff(1, format('SELECT platform.ai_agents_update_v1(%L, ''sales'', %s, ''{"enabled":true}''::jsonb, %L)', pg_temp.a385_id(1),
  (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a385_id(1) AND key = 'sales'),
  pg_temp.a385_id(2001))) AS a385_enable \gset
SELECT pg_temp.a385_assert((SELECT enabled FROM platform_private.ai_agents WHERE organization_id = pg_temp.a385_id(1) AND key = 'sales'),
  'fixture: the sales agent is on (' || :'a385_enable' || ')');

CREATE FUNCTION pg_temp.a385_tool(p_tool TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_svc(format('SELECT platform.ai_agent_tool_%s_v1(%L, ''sales'', %L::jsonb)', p_tool, pg_temp.a385_id(1), p_args))
$$;
CREATE FUNCTION pg_temp.a385_mark(p_actor INTEGER, p_lead UUID, p_flag BOOLEAN, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_staff(p_actor, format('SELECT platform.set_lead_is_test_v1(%L, %L, %L::boolean, %L)',
    pg_temp.a385_id(1), p_lead, p_flag, pg_temp.a385_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a385_event(p_kind TEXT, p_ref TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_svc(format('SELECT to_jsonb(platform.ai_agent_runtime_event_lead_is_test_v1(%L, %L, %L))', pg_temp.a385_id(1), p_kind, p_ref))
$$;
CREATE FUNCTION pg_temp.a385_lead_ids(p_result JSONB) RETURNS TEXT[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(i ->> 'lead_id' ORDER BY i ->> 'lead_id'), '{}') FROM jsonb_array_elements(p_result -> 'items') i
$$;
CREATE FUNCTION pg_temp.a385_sorted(p TEXT[]) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(x ORDER BY x) FROM unnest(p) x
$$;
CREATE FUNCTION pg_temp.a385_funnel(p_actor INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a385_staff(p_actor, format('SELECT platform.current_sales_funnel(%L)', pg_temp.a385_id(1)))
$$;
CREATE FUNCTION pg_temp.a385_audits(p_lead UUID) RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.a385_id(1) AND action = 'lead.testflag.change' AND resource_id = p_lead
$$;
SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1, 'YYYY-MM-DD') AS a385_from,
  to_char((clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1, 'YYYY-MM-DD') AS a385_to \gset
SELECT format('{"from":"%s","to":"%s"}', :'a385_from', :'a385_to') AS a385_period \gset

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_assert(
  (SELECT count(*) = 1 FROM information_schema.columns c WHERE c.table_schema = 'platform' AND c.table_name = 'leads'
      AND c.column_name = 'is_test' AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'false')
  AND (SELECT count(*) = 2 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
      AND p.proname IN ('set_lead_is_test_v1', 'staff_lead_test_flags_v1') AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
      AND p.proname = 'ai_agent_runtime_event_lead_is_test_v1' AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 0 FROM platform.leads WHERE is_test),
  '385 posture: the column, two staff functions for authenticated only, the event hook for service_role only; nobody is a test lead yet');

-- Before any mark: both leads everywhere.
SELECT pg_temp.a385_tool('list_leads', '{"state":"all"}') AS a385_l0 \gset
SELECT pg_temp.a385_assert(pg_temp.a385_lead_ids(:'a385_l0'::JSONB) = pg_temp.a385_sorted(ARRAY[:'a385_lead_a', :'a385_lead_b', :'a385_wa_a', :'a385_wa_b']),
  'before the mark list_leads shows all four leads: ' || :'a385_l0');
SELECT pg_temp.a385_tool('funnel_stats', :'a385_period') AS a385_f0 \gset
SELECT pg_temp.a385_assert((:'a385_f0'::JSONB ->> 'created_leads') = '4' AND (:'a385_f0'::JSONB ->> 'stale_leads_older_than_7d') = '4',
  'before the mark funnel_stats counts all four leads (created and stale): ' || :'a385_f0');
SELECT pg_temp.a385_funnel(1) AS a385_sf0 \gset
SELECT pg_temp.a385_assert((:'a385_sf0'::JSONB ->> 'lead_count') = '4', 'before the mark the sales funnel screen counts all four open leads: ' || :'a385_sf0');
SELECT pg_temp.a385_tool('list_conversations', '{"filter":"all","queue":"all"}') AS a385_c0 \gset
SELECT pg_temp.a385_assert(jsonb_array_length((:'a385_c0'::JSONB) -> 'items') = 2, 'before the mark list_conversations shows both chats: ' || :'a385_c0');

-- ---------------------------------------------------------------------------
-- 2. The write.
-- ---------------------------------------------------------------------------
-- A member without the Sales workflow, a stranger and anon are refused; nothing changes.
SELECT pg_temp.a385_mark(3, :'a385_lead_b'::UUID, TRUE, 3001) AS a385_m_reader \gset
SELECT pg_temp.a385_mark(2, :'a385_lead_b'::UUID, TRUE, 3002) AS a385_m_stranger \gset
SELECT pg_temp.a385_call('anon', '', format('SELECT platform.set_lead_is_test_v1(%L, %L, TRUE, %L)', pg_temp.a385_id(1), :'a385_lead_b', pg_temp.a385_id(3003))) AS a385_m_anon \gset
SELECT pg_temp.a385_assert(
  (:'a385_m_reader'::JSONB ->> 'error') = '42501' AND (:'a385_m_reader'::JSONB ->> 'message') = 'lead_test_flag_forbidden'
  AND (:'a385_m_stranger'::JSONB ->> 'error') = '42501'
  AND (:'a385_m_anon'::JSONB ->> 'error') = '42501'
  AND pg_temp.a385_audits(:'a385_lead_b'::UUID) = 0 AND (SELECT count(*) = 0 FROM platform.leads WHERE is_test),
  'no Sales-workflow right, no membership, anon: refused, nothing written: ' || :'a385_m_reader' || :'a385_m_stranger' || :'a385_m_anon');
-- Invalid input and an unknown lead.
SELECT pg_temp.a385_staff(1, format('SELECT platform.set_lead_is_test_v1(%L, %L, NULL, %L)', pg_temp.a385_id(1), :'a385_lead_b', pg_temp.a385_id(3004))) AS a385_m_null \gset
SELECT pg_temp.a385_mark(1, pg_temp.a385_id(9999), TRUE, 3005) AS a385_m_unknown \gset
SELECT pg_temp.a385_assert((:'a385_m_null'::JSONB ->> 'error') = '22023' AND (:'a385_m_unknown'::JSONB ->> 'error') = '42501',
  'a NULL flag is invalid (22023); an unknown lead is refused like a forbidden one (42501)');

-- Mark B as test.
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, TRUE, 3010) AS a385_m1 \gset
SELECT pg_temp.a385_assert(
  (:'a385_m1'::JSONB ->> 'is_test') = 'true' AND (:'a385_m1'::JSONB ->> 'changed') = 'true'
  AND (SELECT is_test FROM platform.leads WHERE id = :'a385_lead_b'::UUID) AND NOT (SELECT is_test FROM platform.leads WHERE id = :'a385_lead_a'::UUID)
  AND pg_temp.a385_audits(:'a385_lead_b'::UUID) = 1
  AND (SELECT e.before_state ->> 'is_test' = 'false' AND e.after_state ->> 'is_test' = 'true' AND e.actor_membership_id = pg_temp.a385_id(301)
      FROM platform.audit_events e WHERE e.request_id = pg_temp.a385_id(3010) AND e.action = 'lead.testflag.change'),
  'marking writes the flag and ONE journal row with before/after and the actor: ' || :'a385_m1');
-- The chat lead of B is a test lead too.
SELECT pg_temp.a385_mark(1, :'a385_wa_b'::UUID, TRUE, 3012) AS a385_m1w \gset
SELECT pg_temp.a385_assert((:'a385_m1w'::JSONB ->> 'changed') = 'true' AND (SELECT count(*) = 2 FROM platform.leads WHERE is_test), 'the chat lead of the second side is marked too');
-- Replay of the same request: the first receipt, no second row.
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, TRUE, 3010) AS a385_m1r \gset
SELECT pg_temp.a385_assert((:'a385_m1r'::JSONB ->> 'is_test') = 'true' AND (:'a385_m1r'::JSONB ->> 'changed') = 'true'
  AND (:'a385_m1r'::JSONB ->> 'changed_at') = (:'a385_m1'::JSONB ->> 'changed_at') AND pg_temp.a385_audits(:'a385_lead_b'::UUID) = 1,
  'the same request id replays the first receipt without a second journal row: ' || :'a385_m1r');
-- The same id with the other value is a conflict.
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, FALSE, 3010) AS a385_m1c \gset
SELECT pg_temp.a385_assert((:'a385_m1c'::JSONB ->> 'error') = '22023' AND (:'a385_m1c'::JSONB ->> 'message') = 'lead_test_flag_request_conflict'
  AND (SELECT is_test FROM platform.leads WHERE id = :'a385_lead_b'::UUID), 'the same request id with the other value is a conflict and changes nothing');
-- The same value under a new id: unchanged, no row.
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, TRUE, 3011) AS a385_m1u \gset
SELECT pg_temp.a385_assert((:'a385_m1u'::JSONB ->> 'changed') = 'false' AND (:'a385_m1u'::JSONB ->> 'is_test') = 'true'
  AND pg_temp.a385_audits(:'a385_lead_b'::UUID) = 1, 'the value already set: "unchanged", no new journal row');

-- ---------------------------------------------------------------------------
-- 3. The flag reader.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_staff(1, format('SELECT platform.staff_lead_test_flags_v1(%L, %L::uuid[])', pg_temp.a385_id(1),
  format('{%s,%s}', :'a385_lead_a', :'a385_lead_b'))) AS a385_flags \gset
SELECT pg_temp.a385_assert((:'a385_flags'::JSONB -> 'test_lead_ids') = jsonb_build_array(:'a385_lead_b'::TEXT)
  AND pg_temp.a385_staff(2, format('SELECT platform.staff_lead_test_flags_v1(%L, ''{}''::uuid[])', pg_temp.a385_id(1))) ->> 'error' = '42501'
  AND pg_temp.a385_staff(3, format('SELECT platform.staff_lead_test_flags_v1(%L, %L::uuid[])', pg_temp.a385_id(1), format('{%s}', :'a385_lead_b'))) ->> 'error' IS NULL,
  'the reader names only the test lead among the asked ones; a stranger is refused; a lead.read member may ask: ' || :'a385_flags');

-- ---------------------------------------------------------------------------
-- 4. The event hook.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_assert(
  pg_temp.a385_event('website_lead', pg_temp.a385_id(1002)::TEXT) = 'true'::JSONB
  AND pg_temp.a385_event('website_lead', pg_temp.a385_id(1001)::TEXT) = 'false'::JSONB
  AND pg_temp.a385_event('whatsapp_inbound', :'a385_chat_b') = 'true'::JSONB
  AND pg_temp.a385_event('whatsapp_inbound', :'a385_chat_a') = 'false'::JSONB
  AND pg_temp.a385_event('whatsapp_inbound', NULL) = 'false'::JSONB
  AND pg_temp.a385_event('whatsapp_inbound', 'not-a-uuid') = 'false'::JSONB
  AND pg_temp.a385_event('website_lead', pg_temp.a385_id(9998)::TEXT) = 'false'::JSONB
  AND pg_temp.a385_event('command', pg_temp.a385_id(1002)::TEXT) ->> 'error' = '22023'
  AND pg_temp.a385_staff(1, format('SELECT to_jsonb(platform.ai_agent_runtime_event_lead_is_test_v1(%L, ''website_lead'', NULL))', pg_temp.a385_id(1))) ->> 'error' = '42501',
  'the hook: the test lead''s enquiry and chat are test, the ordinary ones, an unknown ref and no ref are not; an unknown kind is refused; staff cannot call it: '
  || pg_temp.a385_event('website_lead', pg_temp.a385_id(1002)::TEXT)::TEXT || pg_temp.a385_event('website_lead', pg_temp.a385_id(1001)::TEXT)::TEXT
  || pg_temp.a385_event('whatsapp_inbound', :'a385_chat_b')::TEXT || pg_temp.a385_event('whatsapp_inbound', :'a385_chat_a')::TEXT
  || pg_temp.a385_event('whatsapp_inbound', NULL)::TEXT || pg_temp.a385_event('whatsapp_inbound', 'not-a-uuid')::TEXT
  || pg_temp.a385_event('website_lead', pg_temp.a385_id(9998)::TEXT)::TEXT || pg_temp.a385_event('command', pg_temp.a385_id(1002)::TEXT)::TEXT);
-- A second enquiry with the phone of the test lead lands on the same open lead: still a test event.
SELECT pg_temp.a385_site(3, '+996555385002') AS a385_s3 \gset
SELECT pg_temp.a385_assert((SELECT r.lead_id FROM platform_private.website_lead_receipts r WHERE r.request_id = pg_temp.a385_id(1003)) = :'a385_lead_b'::UUID
  AND pg_temp.a385_event('website_lead', pg_temp.a385_id(1003)::TEXT) = 'true'::JSONB,
  'a new enquiry with the test lead''s phone resolves to the test lead: its event is a test event too');

-- ---------------------------------------------------------------------------
-- 5. The agent tools do not see the test lead.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_tool('list_leads', '{"state":"all"}') AS a385_l1 \gset
SELECT pg_temp.a385_assert(pg_temp.a385_lead_ids(:'a385_l1'::JSONB) = pg_temp.a385_sorted(ARRAY[:'a385_lead_a', :'a385_wa_a']), 'list_leads: only the two ordinary leads: ' || :'a385_l1');
SELECT pg_temp.a385_tool('list_leads', '{"state":"open","source":"website"}') AS a385_l1b \gset
SELECT pg_temp.a385_assert(pg_temp.a385_lead_ids(:'a385_l1b'::JSONB) = ARRAY[:'a385_lead_a']::TEXT[], 'list_leads with the website filter: only the ordinary lead');
SELECT pg_temp.a385_tool('funnel_stats', :'a385_period') AS a385_f1 \gset
SELECT pg_temp.a385_assert((:'a385_f1'::JSONB ->> 'created_leads') = '2' AND (:'a385_f1'::JSONB ->> 'stale_leads_older_than_7d') = '2'
  AND (:'a385_f1'::JSONB #>> '{by_stage,0,count}') = '2' AND jsonb_array_length((:'a385_f1'::JSONB) -> 'by_stage') = 1,
  'funnel_stats: created, stale and by stage count the ordinary lead only: ' || :'a385_f1');
SELECT pg_temp.a385_tool('list_conversations', '{"filter":"all","queue":"all"}') AS a385_c1 \gset
SELECT pg_temp.a385_assert(jsonb_array_length((:'a385_c1'::JSONB) -> 'items') = 1 AND (:'a385_c1'::JSONB #>> '{items,0,conversation_id}') = :'a385_chat_a',
  'list_conversations: only the ordinary lead''s chat: ' || :'a385_c1');
SELECT pg_temp.a385_tool('get_lead', format('{"lead_id":"%s"}', :'a385_lead_b')) AS a385_gl \gset
SELECT pg_temp.a385_assert((:'a385_gl'::JSONB ->> 'error') IS NULL, 'get_lead by an explicit id still answers for the test lead (an explicit read is not a wake-up): ' || left(:'a385_gl', 120));

-- ---------------------------------------------------------------------------
-- 6. The sales funnel screen.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_funnel(1) AS a385_sf1 \gset
SELECT pg_temp.a385_assert((:'a385_sf1'::JSONB ->> 'lead_count') = '2' AND (:'a385_sf1'::JSONB #>> '{stages,0,count}') = '2',
  'current_sales_funnel counts the ordinary open lead only: ' || :'a385_sf1');

-- ---------------------------------------------------------------------------
-- 7. A closed lead can be marked; the flag comes off and everything returns.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, FALSE, 3020) AS a385_m2 \gset
SELECT pg_temp.a385_assert((:'a385_m2'::JSONB ->> 'is_test') = 'false' AND (:'a385_m2'::JSONB ->> 'changed') = 'true'
  AND NOT (SELECT is_test FROM platform.leads WHERE id = :'a385_lead_b'::UUID) AND pg_temp.a385_audits(:'a385_lead_b'::UUID) = 2
  AND pg_temp.a385_event('website_lead', pg_temp.a385_id(1002)::TEXT) = 'false'::JSONB,
  'unmarking works, leaves a second journal row, and the lead is an ordinary event source again: ' || :'a385_m2');
SELECT pg_temp.a385_mark(1, :'a385_wa_b'::UUID, FALSE, 3023) AS a385_m2w \gset
SELECT pg_temp.a385_tool('list_leads', '{"state":"all"}') AS a385_l2 \gset
SELECT pg_temp.a385_tool('funnel_stats', :'a385_period') AS a385_f2 \gset
SELECT pg_temp.a385_tool('list_conversations', '{"filter":"all","queue":"all"}') AS a385_c2 \gset
SELECT pg_temp.a385_funnel(1) AS a385_sf2 \gset
SELECT pg_temp.a385_assert(jsonb_array_length((:'a385_l2'::JSONB) -> 'items') = 4 AND (:'a385_f2'::JSONB ->> 'created_leads') = '4'
  AND jsonb_array_length((:'a385_c2'::JSONB) -> 'items') = 2 AND (:'a385_sf2'::JSONB ->> 'lead_count') = '4',
  'after unmarking all leads, both chats and the funnel come back');
-- Close B (the lifecycle command is its own RPC; here the row is set the way it stores a closed lead) and mark it again.
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET lifecycle_state = 'disqualified' WHERE id = :'a385_lead_b'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a385_mark(1, :'a385_lead_b'::UUID, TRUE, 3021) AS a385_m3 \gset
SELECT pg_temp.a385_assert((:'a385_m3'::JSONB ->> 'is_test') = 'true' AND (:'a385_m3'::JSONB ->> 'changed') = 'true', 'a closed lead can be marked: ' || :'a385_m3');
-- An archived lead cannot.
SET LOCAL session_replication_role = replica;
UPDATE platform.leads SET lifecycle_state = 'archived' WHERE id = :'a385_lead_a'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a385_mark(1, :'a385_lead_a'::UUID, TRUE, 3022) AS a385_m4 \gset
SELECT pg_temp.a385_assert((:'a385_m4'::JSONB ->> 'error') = 'PT409' AND (:'a385_m4'::JSONB ->> 'message') = 'lead_test_flag_state_conflict'
  AND NOT (SELECT is_test FROM platform.leads WHERE id = :'a385_lead_a'::UUID), 'an archived lead cannot be marked (PT409), nothing changes: ' || :'a385_m4');

-- ---------------------------------------------------------------------------
-- 8. The patched bodies carry the rule exactly where it belongs (the end-of-chain run repeats this on the latest definitions).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a385_assert(
  (SELECT count(*) = 4 FROM pg_proc p WHERE p.oid IN (
    'platform.ai_agent_tool_list_leads_v1(uuid,text,jsonb)'::REGPROCEDURE, 'platform.ai_agent_tool_funnel_stats_v1(uuid,text,jsonb)'::REGPROCEDURE,
    'platform.ai_agent_tool_list_conversations_v1(uuid,text,jsonb)'::REGPROCEDURE, 'platform.current_sales_funnel(uuid)'::REGPROCEDURE)
    AND strpos(p.prosrc, 'is_test') > 0)
  AND (SELECT (length(p.prosrc) - length(replace(p.prosrc, 'is_test', ''))) / length('is_test') = 2
      FROM pg_proc p WHERE p.oid = 'platform.ai_agent_tool_funnel_stats_v1(uuid,text,jsonb)'::REGPROCEDURE),
  'four bodies carry the test rule; funnel_stats carries it in both places (created and stale)');

\echo A385_LEADS_IS_TEST_SUITE_PASSED
ROLLBACK;
