\set ON_ERROR_STOP on
-- Boundary suite for migration 274 («ИИ-агент» P3: память о клиенте и медиа в
-- контексте, docs/EVO_AI_AGENT_PLAN_2026-10-06.md §5.2–5.4, §6.1, §9, §13,
-- §15 P3). Runs on the real chain right after 274 inside one transaction that
-- is rolled back, with its own synthetic organizations; no provider, Gemini
-- call, real person, real phone or production action. Members are modelled
-- like production (invited staff have coarse role NULL; rights come from
-- scoped role assignments; the «общие разделы» role receives
-- ai.agent.use/manage from the 268 grant); every message comes from the REAL
-- WAHA projection chain (live inbound, phone-sent outbound, typed media
-- markers of 259).
--
-- Proves:
--  1. catalog: ai_client_memory is FORCE RLS without policies or grants
--     (agent included) and follows its conversation (ON DELETE CASCADE);
--     memory ships off; 30 staff functions (29 authenticated-only, the
--     storage broker service_role-only) and 34 agent functions, all hardened
--     definers; the agent executes only those 34; the 8 new helpers are
--     executable by nobody; the agent reads no table or queue directly;
--  2. off / no consent: inbound_since_v1, memory_due_v1, memory_context_v1
--     and memory_put_v1 refuse 42501; enabling without consent is PT412, a
--     stale version PT409, only ai.agent.manage toggles; the enable is
--     audited, replays and enqueues the summaries of the long chats (2 s
--     apart);
--  3. pointers: inbound_since_v1 returns only inbound messages of sales
--     conversations of enabled organizations (no curator chat, no text),
--     pages by (created_at, id); its cursor stays 5 minutes back, so a
--     message projected after the cursor passed its event time is still
--     returned; memory_due_v1 skips unknown and curator chats, enqueues
--     {v, kind:'memory', ref_id} only, once per 10 minutes;
--  4. due rules and the job: > 20 messages with ≥ 6 uncovered → summary of
--     the oldest 25 (window 20) → coveredCount 25; +3 messages refresh only
--     the interest, +6 refresh the summary; the batch is at most 80; the
--     interest changes at most once a minute (interestThrottled); an older
--     message (history import) makes the coverage inconsistent → rebuild;
--     the lease (busy), version PT409, boundary (own, outside the window,
--     matching count PT409, growing) and text guards (length, phones,
--     e-mails 22023);
--  5. media: the 259 markers become kinds photo/voice/file/sticker/video/
--     audio, the 060 and 061 markers unknown, 062 rows image → photo and
--     pdf → file; only the caption stays as text; no file name, marker or
--     phone reaches the agent; the answer context keeps `direction` and
--     carries memory; the WAHA placeholder «WhatsApp ••••NNNN» is no name;
--     the text guard stops bracketed and dotted phones;
--  6. staff: the view (ai.agent.use + the sales chat; live lead card),
--     refusals (no conversation access, no AI right, Student, another
--     organization, anon, curator chat); clear by ai.agent.use (Q9), replay,
--     conflict, audit without text, an immediate rebuild pointer; disable
--     purges the organization's memory; the agent refuses again and the
--     context carries no memory;
--  7. maintenance removes memory of curator chats, clears expired leases; a
--     revoked consent turns memory off and purges it at once (a held lease
--     cannot write), and a new consent does not turn it back on.
BEGIN;

DO $p3_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p3_auth_role$;

CREATE FUNCTION pg_temp.p3_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p3_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27400000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p3_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P3: %', message; END IF;
END
$$;
-- 'ok' or SQLSTATE:message[:detail] of a failing statement.
CREATE FUNCTION pg_temp.p3_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_detail TEXT;
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || CASE WHEN COALESCE(v_detail, '') <> '' THEN ':' || v_detail ELSE '' END;
END
$$;
-- The JSONB result of a call, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.p3_call(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  EXECUTE sql INTO result; RETURN COALESCE(result, 'null'::JSONB);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
END
$$;
CREATE FUNCTION pg_temp.p3_put(p_conv UUID, p_worker TEXT, p_version BIGINT, p_interest TEXT, p_summary TEXT,
  p_covered UUID, p_count INTEGER, p_interest_message UUID, p_model TEXT DEFAULT 'gemini-3.5-flash-lite')
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform_ai_agent.memory_put_v1(%L, %L, %L, %L, %L, %L, %L, %L, %L)', p_conv, p_worker,
    p_version, p_interest, p_summary, p_covered, p_count, p_interest_message, p_model)
$$;
CREATE FUNCTION pg_temp.p3_ctx(p_conv UUID, p_worker TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT format('SELECT platform_ai_agent.memory_context_v1(%L, %L, 120)', p_conv, p_worker)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p3_id(INTEGER), pg_temp.p3_wid(INTEGER), pg_temp.p3_assert(BOOLEAN, TEXT),
  pg_temp.p3_err(TEXT), pg_temp.p3_call(TEXT),
  pg_temp.p3_put(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, INTEGER, UUID, TEXT), pg_temp.p3_ctx(UUID, TEXT)
  TO authenticated, anon, service_role, evo_ai_agent;
-- The suite acts as the agent role (as Supavisor would log it in).
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

SELECT 'AI274_AI_AGENT_P3_SUITE_START' AS ai274_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p3_assert((SELECT c.relrowsecurity AND c.relforcerowsecurity
    AND NOT has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_table_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    AND NOT has_any_column_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = 'ai_client_memory')
  FROM pg_class c WHERE c.oid = 'platform_private.ai_client_memory'::regclass),
  'ai_client_memory: FORCE RLS, no policy, no grant to an API role or the agent');
SELECT pg_temp.p3_assert((SELECT con.confdeltype = 'c' AND con.confrelid = 'platform.communication_conversations'::regclass
  FROM pg_constraint con WHERE con.conrelid = 'platform_private.ai_client_memory'::regclass
    AND con.conname = 'ai_client_memory_conversation_fkey'),
  'a memory row belongs to its conversation and goes with it (ON DELETE CASCADE)');
SELECT pg_temp.p3_assert((SELECT pg_get_expr(d.adbin, d.adrelid) = 'false' FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'platform_private.ai_settings'::regclass AND a.attname = 'memory_enabled'),
  'memory ships off (memory_enabled DEFAULT false)');
SELECT pg_temp.p3_assert((SELECT array_agg(p.proname ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND has_schema_privilege('evo_ai_agent', n.oid, 'USAGE')
      AND has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  = ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1', 'budget_release_v1', 'budget_reserve_v1',
    'conversation_context_v1', 'document_claim_v1', 'document_content_put_v1', 'document_index_v1',
    'document_pages_put_v1', 'document_reindex_claim_v1', 'document_reindex_v1', 'document_stage_v1',
    'inbound_since_v1', 'lab_apply_prepare_v1', 'lab_apply_v1', 'lab_documents_v1', 'lab_proposal_put_v1',
    'lab_session_get_v1', 'lab_session_put_v1', 'maintenance_v1', 'memory_context_v1', 'memory_due_v1',
    'memory_put_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1', 'review_items_put_v1', 'search_v1',
    'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1', 'work_finish_v1']::NAME[],
  'the only definer functions evo_ai_agent can execute are the 34 platform_ai_agent functions');
SELECT pg_temp.p3_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_ai_agent' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR NOT p.prosecdef OR NOT p.proconfig @> ARRAY['search_path=""'])),
  'agent functions: hardened definers no API role executes');
SELECT pg_temp.p3_assert((SELECT count(*) = 29 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%' AND p.proname <> 'ai_agent_storage_authorize_v1'),
  'the 29 staff functions (26 of P2 + 3 memory functions) are hardened definers executable by authenticated only');
SELECT pg_temp.p3_assert((SELECT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname = 'ai_agent_storage_authorize_v1'),
  'the storage broker authorization stays service_role-only');
SELECT pg_temp.p3_assert((SELECT count(*) = 8 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_memory_gate', 'ai_dialog_messages', 'ai_message_view',
      'ai_lead_card', 'ai_memory_state', 'ai_memory_enqueue', 'ai_memory_text_ok', 'ai_memory_poke')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')),
  'the 8 new private helpers are executable by no API role and not by the agent');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT count(*) FROM platform_private.ai_client_memory') LIKE '42501:%'
  AND pg_temp.p3_err('SELECT count(*) FROM platform.communication_messages') LIKE '42501:%'
  AND pg_temp.p3_err('SELECT count(*) FROM pgmq.q_ai_agent_work_v1') LIKE '42501:%'
  AND pg_temp.p3_err('SELECT platform.ai_agent_memory_v1(NULL, NULL)') LIKE '42501:%'
  AND pg_temp.p3_err('SELECT platform_private.ai_memory_state(NULL)') LIKE '42501:%',
  'the agent reads no memory row, message or queue directly and calls no staff or private function');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Fixture. Organization 1: 1 Admin (system); invited staff (coarse NULL):
--    2 sales (WhatsApp at own + «Продажи — общие разделы»: use + manage after
--    the 268 grant), 3 ai.agent.use only (no conversation access), 4 WhatsApp
--    only (no AI right), 7 WhatsApp + ai.agent.use (no manage); 5 Student.
--    Organization 2: 6 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p3_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO p3_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL),
  (5, 1, 'student'), (6, 2, 'admin'), (7, 1, NULL);
GRANT SELECT ON p3_actors TO authenticated, anon, evo_ai_agent;
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p3_id(1), 'P3 Fictional organization'),
  (pg_temp.p3_id(2), 'P3 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p3_id(100 + n), 'p3-' || n || '@example.invalid', '{}'::JSONB FROM p3_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p3_id(200 + n), pg_temp.p3_id(100 + n), 'P3 Actor ' || n, 'active', 1 FROM p3_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p3_id(300 + a.n), pg_temp.p3_id(a.org), pg_temp.p3_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM p3_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.p3_id(301), pg_temp.p3_id(306));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.p3_id(401), pg_temp.p3_id(1), 'organization', pg_temp.p3_id(1), 1),
  (pg_temp.p3_id(402), pg_temp.p3_id(2), 'organization', pg_temp.p3_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.p3_id(1), pg_temp.p3_id(301), pg_temp.p3_id(401), 1, 1, TRUE, 'system', 'P3 synthetic scope', pg_temp.p3_id(601)),
  (pg_temp.p3_id(2), pg_temp.p3_id(306), pg_temp.p3_id(402), 1, 1, TRUE, 'system', 'P3 synthetic scope', pg_temp.p3_id(602));

CREATE TEMP TABLE p3_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER, phase INTEGER);
INSERT INTO p3_roles VALUES
 (pg_temp.p3_id(1101), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1110, 1),
 (pg_temp.p3_id(1103), 'WhatsApp', '["communication.manual.send","communication.read.full"]', 1130, 1),
 (pg_temp.p3_id(1105), 'AI viewer', '["ai.agent.use","organization.read"]', 1150, 2),
 (pg_temp.p3_id(1106), 'WhatsApp B', '["communication.manual.send","communication.read.full"]', 1160, 2);
CREATE TEMP TABLE p3_grants(membership INTEGER, role_id UUID, scope JSONB, phase INTEGER);
INSERT INTO p3_grants VALUES
 (302, pg_temp.p3_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 1),
 (302, pg_temp.p3_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.p3_id(1), 'resourceKind', NULL), 1),
 (304, pg_temp.p3_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 1),
 (303, pg_temp.p3_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.p3_id(1), 'resourceKind', NULL), 2),
 (307, pg_temp.p3_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.p3_id(1), 'resourceKind', NULL), 2),
 (307, pg_temp.p3_id(1106), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 2);
GRANT SELECT ON p3_roles, p3_grants TO authenticated;
CREATE FUNCTION pg_temp.p3_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p3_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.p3_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- Publishes the roles of one phase and saves their assignments as the Admin.
CREATE FUNCTION pg_temp.p3_roles_phase(p_phase INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM p3_roles WHERE phase = p_phase ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p3_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P3 ' || r.label, 'description', 'Migration 274 synthetic role',
        'permissionKeys', r.keys), 'P3 create role', pg_temp.p3_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p3_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p3_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P3 publish role', pg_temp.p3_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p3_grants WHERE phase = p_phase ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM p3_grants g WHERE g.membership = m AND g.phase = p_phase;
    PERFORM platform.staff_role_assignments_save(pg_temp.p3_id(1), pg_temp.p3_id(m),
      (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
        WHERE om.id = pg_temp.p3_id(m)), items, bindings, 'P3 grant roles', pg_temp.p3_id(2000 + m));
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p3_roles_phase(INTEGER) TO authenticated;

SELECT pg_temp.p3_claims(1) AS p3_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p3_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_roles_phase(1);
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT count(*) >= 1 FROM jsonb_array_elements(
    platform_private.ai_agent_grant_common_roles('P3 grant') -> 'roles') e
  WHERE e ->> 'roleId' = pg_temp.p3_id(1101)::TEXT), 'the 268 grant publishes the AI rights into the common role');
SELECT pg_temp.p3_claims(1) AS p3_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p3_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_roles_phase(2);
RESET ROLE;
SELECT pg_temp.p3_assert(platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(302), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(302), 'communication.read.full')
  AND platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(303), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(303), 'communication.read.full')
  AND NOT platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(304), 'ai.agent.use')
  AND platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(307), 'ai.agent.use')
  AND platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(307), 'communication.read.full')
  AND NOT platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(307), 'ai.agent.manage')
  AND NOT platform_private.staff_has_permission(pg_temp.p3_id(1), pg_temp.p3_id(305), 'ai.agent.use'),
  'fixture: 2 uses and manages, 3 uses without the chat, 4 has no AI right, 7 uses with the chat but cannot manage');

UPDATE p3_actors a SET claims = pg_temp.p3_claims(a.n);
SELECT claims AS p3_admin FROM p3_actors WHERE n = 1 \gset
SELECT claims AS p3_sales FROM p3_actors WHERE n = 2 \gset
SELECT claims AS p3_viewer FROM p3_actors WHERE n = 3 \gset
SELECT claims AS p3_wa FROM p3_actors WHERE n = 4 \gset
SELECT claims AS p3_student FROM p3_actors WHERE n = 5 \gset
SELECT claims AS p3_other_admin FROM p3_actors WHERE n = 6 \gset
SELECT claims AS p3_user FROM p3_actors WHERE n = 7 \gset

-- ---------------------------------------------------------------------------
-- 3. Conversations through the REAL WAHA projection chain. Times are two
--    hours back, ten seconds apart (created_at = the event time).
-- ---------------------------------------------------------------------------
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
DELETE FROM pgmq.q_ai_agent_work_v1;
CREATE TEMP TABLE p3_clock AS SELECT date_trunc('second', clock_timestamp()) - INTERVAL '2 hours' AS t0;
CREATE FUNCTION pg_temp.p3_at(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 + p_seconds * INTERVAL '1 second' FROM p3_clock
$$;
CREATE FUNCTION pg_temp.p3_event(p_n INTEGER, p_payload JSONB, p_at TIMESTAMPTZ) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE event_id CONSTANT UUID := pg_temp.p3_wid(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.p3_id(1), 'waha', 'waha:crm_primary', NULL, NULL, 'ai274-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:ai274:' || p_n, lpad(to_hex(2740000 + p_n), 64, '0'), pg_temp.p3_wid(1500 + p_n));
  RETURN event_id;
END
$$;
CREATE FUNCTION pg_temp.p3_run(p_n INTEGER, p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.p3_id(1);
  event_id UUID := pg_temp.p3_event(p_n, p_payload, p_at);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('ai274-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.p3_wid(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'ai274', pg_temp.p3_wid(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.p3_id(301), pg_temp.p3_wid(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.p3_wid(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
CREATE FUNCTION pg_temp.p3_in(p_n INTEGER, p_chat TEXT, p_body TEXT, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', 'false_' || p_chat || '_AI274' || lpad(p_n::TEXT, 15, '0'),
    'timestamp', extract(epoch FROM p_at)::BIGINT, 'from', p_chat, 'fromMe', false, 'source', 'app', 'body', p_body)
$$;
-- A message sent from the phone (fromMe) projects as an outbound staff message.
CREATE FUNCTION pg_temp.p3_out(p_n INTEGER, p_chat TEXT, p_body TEXT, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', 'true_' || p_chat || '_AI274' || lpad(p_n::TEXT, 15, '0'),
    'timestamp', extract(epoch FROM p_at)::BIGINT, 'from', '79967000000@c.us', 'to', p_chat, 'fromMe', true,
    'source', 'app', 'body', p_body)
$$;
-- A client media message as WAHA reports it: hasMedia, media {mimetype,
-- filename}, the caption in body, WEBJS _data.type for voice and stickers.
CREATE FUNCTION pg_temp.p3_media(p_n INTEGER, p_chat TEXT, p_caption TEXT, p_mime TEXT, p_filename TEXT, p_type TEXT,
  p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('id', 'false_' || p_chat || '_AI274' || lpad(p_n::TEXT, 15, '0'),
    'timestamp', extract(epoch FROM p_at)::BIGINT, 'from', p_chat, 'fromMe', false, 'source', 'app',
    'body', p_caption, 'hasMedia', true,
    'media', jsonb_strip_nulls(jsonb_build_object('mimetype', p_mime, 'filename', p_filename)),
    '_data', CASE WHEN p_type IS NOT NULL THEN jsonb_build_object('type', p_type) END))
$$;
CREATE FUNCTION pg_temp.p3_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.p3_id(1) AND binding.normalized_chat_id = p_chat
$$;
-- Message positions (oldest first), refreshed by the owner after each batch:
-- the agent role reads no message itself.
CREATE TEMP TABLE p3_msgs(conv UUID, pos INTEGER, id UUID, inbound BOOLEAN);
CREATE FUNCTION pg_temp.p3_reindex() RETURNS VOID LANGUAGE SQL AS $$
  DELETE FROM p3_msgs;
  INSERT INTO p3_msgs SELECT m.conversation_id,
    row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id), m.id, m.direction = 'inbound'
  FROM platform.communication_messages m WHERE m.organization_id = pg_temp.p3_id(1);
$$;
-- The p-th message of a conversation, oldest first; its latest client message.
CREATE FUNCTION pg_temp.p3_pos(p_conversation UUID, p_pos INTEGER) RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT x.id FROM p3_msgs x WHERE x.conv = p_conversation AND x.pos = p_pos
$$;
CREATE FUNCTION pg_temp.p3_latest_in(p_conversation UUID) RETURNS UUID LANGUAGE SQL STABLE AS $$
  SELECT x.id FROM p3_msgs x WHERE x.conv = p_conversation AND x.inbound ORDER BY x.pos DESC LIMIT 1
$$;
GRANT SELECT ON p3_msgs, p3_clock TO authenticated, evo_ai_agent;
GRANT EXECUTE ON FUNCTION pg_temp.p3_pos(UUID, INTEGER), pg_temp.p3_latest_in(UUID), pg_temp.p3_at(INTEGER)
  TO authenticated, evo_ai_agent;
CREATE TEMP TABLE p3_runs(n INTEGER PRIMARY KEY, result JSONB);

-- c1: 45 messages, odd from the client (3 photo + caption, 5 voice, 7 a PDF
-- with a file name, 9 a sticker), even from the phone.
DO $p3_c1$
DECLARE n INTEGER; chat CONSTANT TEXT := '79967400001@c.us';
BEGIN
  FOR n IN 1..45 LOOP
    INSERT INTO p3_runs VALUES (n, pg_temp.p3_run(n, CASE
      WHEN n = 3 THEN pg_temp.p3_media(n, chat, 'P3 подпись к фото', 'image/jpeg', NULL, NULL, pg_temp.p3_at(n * 10))
      WHEN n = 5 THEN pg_temp.p3_media(n, chat, NULL, 'audio/ogg; codecs=opus', NULL, 'ptt', pg_temp.p3_at(n * 10))
      WHEN n = 7 THEN pg_temp.p3_media(n, chat, NULL, 'application/pdf', 'P3-synthetic-passport-scan.pdf', NULL,
        pg_temp.p3_at(n * 10))
      WHEN n = 9 THEN pg_temp.p3_media(n, chat, NULL, 'image/webp', NULL, 'sticker', pg_temp.p3_at(n * 10))
      WHEN n % 2 = 1 THEN pg_temp.p3_in(n, chat, 'P3 клиент: сообщение ' || n, pg_temp.p3_at(n * 10))
      ELSE pg_temp.p3_out(n, chat, 'P3 менеджер: ответ ' || n, pg_temp.p3_at(n * 10)) END, pg_temp.p3_at(n * 10)));
  END LOOP;
  -- c2: one client message; the chat is handed to a curator below.
  INSERT INTO p3_runs VALUES (50, pg_temp.p3_run(50, pg_temp.p3_in(50, '79967400002@c.us', 'P3 клиент второго чата',
    pg_temp.p3_at(1500)), pg_temp.p3_at(1500)));
  -- c3: a short chat with a photo caption and a diploma PDF.
  INSERT INTO p3_runs VALUES (60, pg_temp.p3_run(60, pg_temp.p3_in(60, '79967400003@c.us', 'P3 клиент третьего чата',
    pg_temp.p3_at(2060)), pg_temp.p3_at(2060)));
  INSERT INTO p3_runs VALUES (61, pg_temp.p3_run(61, pg_temp.p3_media(61, '79967400003@c.us', 'P3 подпись: диплом',
    'image/png', NULL, NULL, pg_temp.p3_at(2061)), pg_temp.p3_at(2061)));
  INSERT INTO p3_runs VALUES (62, pg_temp.p3_run(62, pg_temp.p3_media(62, '79967400003@c.us', NULL, 'application/pdf',
    'P3-synthetic-diploma.pdf', NULL, pg_temp.p3_at(2062)), pg_temp.p3_at(2062)));
  -- c4: 102 client messages (the 80-message batch).
  FOR n IN 100..201 LOOP
    INSERT INTO p3_runs VALUES (n, pg_temp.p3_run(n, pg_temp.p3_in(n, '79967400004@c.us', 'P3 клиент четвёртого чата ' || n,
      pg_temp.p3_at(3000 + n)), pg_temp.p3_at(3000 + n)));
  END LOOP;
END
$p3_c1$;
SELECT pg_temp.p3_reindex();
SELECT pg_temp.p3_assert((SELECT bool_and(result ->> 'disposition' = 'succeeded') AND count(*) = 151 FROM p3_runs),
  'every synthetic message projects through the real chain');
SELECT pg_temp.p3_conv('79967400001@c.us') AS c1, pg_temp.p3_conv('79967400002@c.us') AS c2,
  pg_temp.p3_conv('79967400003@c.us') AS c3, pg_temp.p3_conv('79967400004@c.us') AS c4 \gset
SELECT pg_temp.p3_assert((SELECT count(*) = 45 AND count(*) FILTER (WHERE direction = 'inbound') = 23
    FROM platform.communication_messages WHERE conversation_id = :'c1')
  AND (SELECT count(*) = 3 FROM platform.communication_messages WHERE conversation_id = :'c3')
  AND (SELECT count(*) = 102 FROM platform.communication_messages WHERE conversation_id = :'c4')
  AND (SELECT count(*) = 4 AND bool_and(queue = 'sales') FROM platform.communication_conversations
    WHERE id IN (:'c1', :'c2', :'c3', :'c4')),
  'c1 has 45 messages (23 inbound), c3 3, c4 102; four sales conversations');
SELECT pg_temp.p3_assert((SELECT body_text = E'📎 Фото — откройте в WhatsApp продаж\nP3 подпись к фото'
    FROM platform.communication_messages WHERE id = pg_temp.p3_pos(:'c1', 3))
  AND (SELECT body_text = '📎 Голосовое сообщение — откройте в WhatsApp продаж'
    FROM platform.communication_messages WHERE id = pg_temp.p3_pos(:'c1', 5))
  AND (SELECT body_text = '📎 Файл: P3-synthetic-passport-scan.pdf — откройте в WhatsApp продаж'
    FROM platform.communication_messages WHERE id = pg_temp.p3_pos(:'c1', 7))
  AND (SELECT body_text = '📎 Стикер — откройте в WhatsApp продаж'
    FROM platform.communication_messages WHERE id = pg_temp.p3_pos(:'c1', 9)),
  'the chain stores the 259 markers (the file name is in the stored body)');

-- c2 becomes a curator-queue chat (the state 044's assignment trigger leaves).
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.p3_id(421), pg_temp.p3_id(1), 'student_case', pg_temp.p3_id(501), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.p3_id(501), pg_temp.p3_id(1), pg_temp.p3_id(301), pg_temp.p3_id(302),
  'synthetic:ai274:1', 'P3 Student 501', 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.p3_id(421), 1, 'new');
UPDATE platform.communication_conversations SET student_case_id = pg_temp.p3_id(501), queue = 'curator',
  current_curator_membership_id = pg_temp.p3_id(302), current_scope_id = pg_temp.p3_id(421), current_scope_version = 1,
  sales_authority_source = 'provider_linked', amocrm_account_id = 274, amocrm_lead_id = 274, amocrm_contact_id = 274
  WHERE id = :'c2';
-- A lead card for c1 (first name, interest, stage; never the phone).
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.p3_id(701), pg_temp.p3_id(1), 'Тестия Синтетова', platform_private.normalize_person_name('Тестия Синтетова'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, interest_direction)
  VALUES (pg_temp.p3_id(702), pg_temp.p3_id(1), pg_temp.p3_id(701), pg_temp.p3_id(301), 'new', 'website', 'MY');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.p3_id(701), canonical_lead_id = pg_temp.p3_id(702)
  WHERE id = :'c1';
SET LOCAL session_replication_role = origin;

SELECT 'AI274_FIXTURE_READY' AS ai274_marker;

-- ---------------------------------------------------------------------------
-- 4. Memory off, no consent: the four agent functions refuse; enabling needs
--    consent (PT412), the current version (PT409) and ai.agent.manage.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL)')
    LIKE '42501:ai_background_disabled%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[])', :'c1'))
    LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(:'c1', 'p3-w1')) LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, 'Интерес', NULL, NULL, NULL, pg_temp.p3_pos(:'c1', 45)))
    LIKE '42501:ai_memory_not_leased%',
  'memory off and no consent: inbound_since, due, context and put all refuse 42501');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') AS p3_view0 \gset
SELECT pg_temp.p3_assert((:'p3_view0'::JSONB ->> 'enabled')::BOOLEAN = FALSE
  AND (:'p3_view0'::JSONB ->> 'consentRecorded')::BOOLEAN = FALSE AND (:'p3_view0'::JSONB ->> 'active')::BOOLEAN = FALSE
  AND (:'p3_view0'::JSONB ->> 'canManage')::BOOLEAN AND (:'p3_view0'::JSONB ->> 'messageCount')::INTEGER = 45
  AND (:'p3_view0'::JSONB -> 'memory') = 'null'::JSONB
  AND (:'p3_view0'::JSONB ->> 'summaryDue')::BOOLEAN = FALSE
  AND (:'p3_view0'::JSONB -> 'lead') = '{"name":"Тестия","stage":"new","interestDirection":"MY"}'::JSONB
  AND :'p3_view0' NOT LIKE '%Синтетова%' AND :'p3_view0' NOT LIKE '%79967%',
  'the view: memory off, no consent, 45 messages, the live lead card without surname or phone');
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), (:'p3_view0'::JSONB ->> 'settingsVersion')::BIGINT, pg_temp.p3_id(3001))) LIKE 'PT412:ai_consent_required%',
  'enabling memory without a recorded consent is PT412');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert((platform.ai_agent_consent_record_v1(pg_temp.p3_id(1), 'grant', 'gemini-v1-2026-10-06',
  pg_temp.p3_id(3002)) ->> 'status') = 'granted', 'the Admin records the Gemini consent');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL)')
    LIKE '42501:ai_background_disabled%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[])', :'c1'))
    LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(:'c1', 'p3-w1')) LIKE '42501:ai_memory_disabled%',
  'consent alone does not enable memory');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'settingsVersion') AS p3_settings_v \gset
RESET ROLE;
-- Who may toggle: ai.agent.manage only.
SET LOCAL request.jwt.claims TO :'p3_user';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v', pg_temp.p3_id(3003))) LIKE '42501:ai_agent_forbidden%',
  'ai.agent.use without ai.agent.manage cannot toggle memory');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_wa';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v', pg_temp.p3_id(3003))) LIKE '42501:%', 'a member without AI rights cannot toggle');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v', pg_temp.p3_id(3003))) LIKE '42501:%', 'the Student cannot toggle');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v', pg_temp.p3_id(3003))) LIKE '42501:%', 'another organization''s Admin cannot toggle');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v', pg_temp.p3_id(3003))) LIKE '42501:%', 'anon cannot toggle');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
  pg_temp.p3_id(1), :'p3_settings_v'::BIGINT - 1, pg_temp.p3_id(3004))) LIKE 'PT409:ai_settings_version_conflict%',
  'a stale settings version is PT409');
SELECT platform.ai_agent_memory_toggle_v1(pg_temp.p3_id(1), TRUE, :'p3_settings_v', pg_temp.p3_id(3005)) AS p3_enable \gset
SELECT pg_temp.p3_assert((:'p3_enable'::JSONB ->> 'status') = 'applied'
  AND (:'p3_enable'::JSONB ->> 'memoryEnabled')::BOOLEAN
  AND (:'p3_enable'::JSONB ->> 'version')::BIGINT = :'p3_settings_v'::BIGINT + 1
  AND (:'p3_enable'::JSONB ->> 'enqueued')::INTEGER = 2
  AND NOT (:'p3_enable'::JSONB ->> 'replayed')::BOOLEAN
  AND (platform.ai_agent_memory_toggle_v1(pg_temp.p3_id(1), TRUE, :'p3_settings_v', pg_temp.p3_id(3005)) ->> 'replayed')::BOOLEAN,
  'a manager enables memory (version + 1) and the two long chats get a summary pointer; the same request replays');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT count(*) = 2
    AND array_agg(q.message ->> 'ref_id' ORDER BY q.message ->> 'ref_id')
      = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'c1', :'c4']) x)
    AND max(q.vt) - min(q.vt) BETWEEN INTERVAL '1.9 seconds' AND INTERVAL '3 seconds'
  FROM pgmq.q_ai_agent_work_v1 q),
  'enabling enqueues c1 (45) and c4 (102), 2 s apart, not c3 (3 messages) or the curator chat');
SELECT pg_temp.p3_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.p3_id(3005)
    AND action = 'ai.agent.memory.enable' AND resource_type = 'organization' AND actor_profile_id = pg_temp.p3_id(202))
  AND (SELECT memory_enabled FROM platform_private.ai_settings WHERE organization_id = pg_temp.p3_id(1)),
  'the enable is audited once');

-- ---------------------------------------------------------------------------
-- 5. Pointers: inbound_since_v1 and memory_due_v1.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert((SELECT jsonb_array_length(r -> 'items') = 0 AND NOT (r ->> 'hasMore')::BOOLEAN
    AND (r #>> '{next,afterAt}')::TIMESTAMPTZ BETWEEN clock_timestamp() - INTERVAL '6 minutes'
      AND clock_timestamp() - INTERVAL '4 minutes'
  FROM (SELECT platform_ai_agent.inbound_since_v1(NULL, NULL) AS r) x),
  'without a cursor only the last 5 minutes are read (the synthetic chats are older)');
SELECT platform_ai_agent.inbound_since_v1(pg_temp.p3_at(-3600), '00000000-0000-0000-0000-000000000000', 500) AS p3_all \gset
SELECT pg_temp.p3_assert(jsonb_array_length(:'p3_all'::JSONB -> 'items') = 128
  AND NOT (:'p3_all'::JSONB ->> 'hasMore')::BOOLEAN
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p3_all'::JSONB -> 'items') e
    WHERE (e - ARRAY['organizationId', 'conversationId', 'messageId', 'at']) <> '{}'::JSONB
      OR e ->> 'conversationId' = :'c2' OR e ->> 'organizationId' <> pg_temp.p3_id(1)::TEXT)
  AND (SELECT count(*) = 23 FROM jsonb_array_elements(:'p3_all'::JSONB -> 'items') e WHERE e ->> 'conversationId' = :'c1')
  AND :'p3_all' NOT LIKE '%P3 клиент%',
  'inbound pointers: 23 + 3 + 102 client messages of the sales chats, never the curator chat, no text');
SELECT platform_ai_agent.inbound_since_v1(pg_temp.p3_at(-3600), '00000000-0000-0000-0000-000000000000', 5) AS p3_page1 \gset
SELECT platform_ai_agent.inbound_since_v1((:'p3_page1'::JSONB #>> '{next,afterAt}')::TIMESTAMPTZ,
  (:'p3_page1'::JSONB #>> '{next,afterId}')::UUID, 5) AS p3_page2 \gset
SELECT pg_temp.p3_assert((:'p3_page1'::JSONB ->> 'hasMore')::BOOLEAN
  AND (SELECT jsonb_agg(e -> 'messageId') FROM jsonb_array_elements((:'p3_page1'::JSONB -> 'items')
      || (:'p3_page2'::JSONB -> 'items')) e)
    = (SELECT jsonb_agg(e -> 'messageId' ORDER BY o) FROM jsonb_array_elements(:'p3_all'::JSONB -> 'items')
      WITH ORDINALITY AS i(e, o) WHERE o <= 10),
  'pages of 5 follow (created_at, id) without gaps or repeats');
RESET ROLE;
-- A late projection: A (c5, 30 s ago) is polled, then B (c6, 40 s ago) is
-- written. The exact cursor after A would skip B; the returned one does not.
INSERT INTO p3_runs VALUES (400, pg_temp.p3_run(400, pg_temp.p3_in(400, '79967400005@c.us', 'P3 клиент пятого чата',
  clock_timestamp() - INTERVAL '30 seconds'), clock_timestamp() - INTERVAL '30 seconds'));
SELECT m.id AS p3_late_a FROM platform.communication_messages m
  WHERE m.conversation_id = pg_temp.p3_conv('79967400005@c.us') \gset
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.inbound_since_v1(clock_timestamp() - INTERVAL '2 minutes',
  '00000000-0000-0000-0000-000000000000', 200) AS p3_late1 \gset
RESET ROLE;
INSERT INTO p3_runs VALUES (401, pg_temp.p3_run(401, pg_temp.p3_in(401, '79967400006@c.us', 'P3 клиент шестого чата',
  clock_timestamp() - INTERVAL '40 seconds'), clock_timestamp() - INTERVAL '40 seconds'));
SELECT m.id AS p3_late_b FROM platform.communication_messages m
  WHERE m.conversation_id = pg_temp.p3_conv('79967400006@c.us') \gset
SELECT pg_temp.p3_assert((SELECT count(*) = 2 AND bool_and(result ->> 'disposition' = 'succeeded') FROM p3_runs
    WHERE n IN (400, 401))
  AND (SELECT created_at FROM platform.communication_messages WHERE id = :'p3_late_b')
    < (SELECT created_at FROM platform.communication_messages WHERE id = :'p3_late_a'),
  'A and B project through the real chain; B is written later with an earlier event time');
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.inbound_since_v1((:'p3_late1'::JSONB #>> '{next,afterAt}')::TIMESTAMPTZ,
  (:'p3_late1'::JSONB #>> '{next,afterId}')::UUID, 200) AS p3_late2 \gset
SELECT pg_temp.p3_assert((SELECT jsonb_agg(e -> 'messageId') FROM jsonb_array_elements(:'p3_late1'::JSONB -> 'items') e)
    = jsonb_build_array(:'p3_late_a') AND NOT (:'p3_late1'::JSONB ->> 'hasMore')::BOOLEAN
  AND (:'p3_late1'::JSONB #>> '{next,afterId}')::UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  AND (:'p3_late1'::JSONB #>> '{next,afterAt}')::TIMESTAMPTZ BETWEEN clock_timestamp() - INTERVAL '6 minutes'
    AND clock_timestamp() - INTERVAL '4 minutes'
  AND (SELECT jsonb_agg(e -> 'messageId') FROM jsonb_array_elements(:'p3_late2'::JSONB -> 'items') e)
    = jsonb_build_array(:'p3_late_b', :'p3_late_a')
  AND jsonb_array_length(platform_ai_agent.inbound_since_v1((:'p3_late1'::JSONB #>> '{items,0,at}')::TIMESTAMPTZ,
    :'p3_late_a'::UUID) -> 'items') = 0,
  'late projection: next stays 5 minutes back (max id), so B written after A was polled is returned (A again); the exact cursor would skip B');
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL, 0)') LIKE '22023:%'
  AND pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL, 501)') LIKE '22023:%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.inbound_since_v1(%L, NULL)', clock_timestamp())) LIKE '22023:%',
  'limit 1..500 and a whole cursor');
SELECT platform_ai_agent.memory_due_v1(ARRAY[:'c1', :'c2', :'c3', :'c4', pg_temp.p3_id(999)]::UUID[]) AS p3_due1 \gset
SELECT pg_temp.p3_assert((SELECT jsonb_object_agg(e ->> 'conversationId', e ->> 'status')
    FROM jsonb_array_elements(:'p3_due1'::JSONB -> 'items') e)
  = jsonb_build_object(:'c1', 'pending', :'c2', 'skipped', :'c3', 'enqueued', :'c4', 'pending',
    pg_temp.p3_id(999)::TEXT, 'skipped')
  AND (SELECT bool_and((e ->> 'delaySeconds')::INTEGER = 0) FROM jsonb_array_elements(:'p3_due1'::JSONB -> 'items') e
    WHERE e ->> 'status' = 'enqueued')
  AND :'p3_due1' NOT LIKE '%P3 клиент%',
  'due: c3 is enqueued at once, c1 and c4 are pending since the enable; the curator chat and an unknown id are skipped');
SELECT pg_temp.p3_assert((SELECT jsonb_agg(e ->> 'status') FROM jsonb_array_elements(
    platform_ai_agent.memory_due_v1(ARRAY[:'c1', :'c3', :'c4']::UUID[]) -> 'items') e) = '["pending","pending","pending"]'::JSONB,
  'a second poll within 10 minutes enqueues nothing');
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT platform_ai_agent.memory_due_v1(ARRAY[]::UUID[])') LIKE '22023:%'
  AND pg_temp.p3_err('SELECT platform_ai_agent.memory_due_v1(ARRAY[NULL]::UUID[])') LIKE '22023:%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L, %L]::UUID[])', :'c1', :'c1')) LIKE '22023:%'
  AND pg_temp.p3_err('SELECT platform_ai_agent.memory_due_v1(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 101)))')
    LIKE '22023:%',
  'due takes 1..100 distinct ids');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT count(*) = 3 AND bool_and((q.message - ARRAY['v', 'kind', 'ref_id']) = '{}'::JSONB
    AND q.message ->> 'v' = '1' AND q.message ->> 'kind' = 'memory')
    AND array_agg(q.message ->> 'ref_id' ORDER BY q.message ->> 'ref_id')
      = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:'c1', :'c3', :'c4']) x)
  FROM pgmq.q_ai_agent_work_v1 q),
  'the queue holds exactly three pointers {v, kind: memory, ref_id}, no text');
SELECT pg_temp.p3_assert((SELECT count(*) = 3 AND bool_and(enqueued_at IS NOT NULL AND interest IS NULL AND summary IS NULL
    AND covered_count = 0 AND version = 1 AND lease_owner IS NULL)
  FROM platform_private.ai_client_memory WHERE organization_id = pg_temp.p3_id(1)),
  'the pointers created empty memory rows marked enqueued');

-- ---------------------------------------------------------------------------
-- 6. The first summary of c1: window 20, the oldest 25 leave it.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.memory_context_v1(:'c1', 'p3-w1', 120) AS p3_ctx1 \gset
SELECT pg_temp.p3_assert((:'p3_ctx1'::JSONB ->> 'status') = 'claimed' AND (:'p3_ctx1'::JSONB ->> 'mode') = 'summary'
  AND NOT (:'p3_ctx1'::JSONB ->> 'rebuild')::BOOLEAN AND (:'p3_ctx1'::JSONB ->> 'interestDue')::BOOLEAN
  AND (:'p3_ctx1'::JSONB -> 'prior') = '{"interest":null,"summary":null,"coveredCount":0,"version":1}'::JSONB
  AND jsonb_array_length(:'p3_ctx1'::JSONB -> 'leaving') = 25 AND jsonb_array_length(:'p3_ctx1'::JSONB -> 'window') = 20
  AND (:'p3_ctx1'::JSONB #>> '{next,coveredCount}')::INTEGER = 25
  AND (:'p3_ctx1'::JSONB #>> '{next,coveredMessageId}')::UUID = pg_temp.p3_pos(:'c1', 25)
  AND (:'p3_ctx1'::JSONB #>> '{leaving,0,messageId}')::UUID = pg_temp.p3_pos(:'c1', 1)
  AND (:'p3_ctx1'::JSONB #>> '{window,0,messageId}')::UUID = pg_temp.p3_pos(:'c1', 26)
  AND (:'p3_ctx1'::JSONB #>> '{window,19,messageId}')::UUID = pg_temp.p3_pos(:'c1', 45)
  AND (:'p3_ctx1'::JSONB ->> 'interestMessageId')::UUID = pg_temp.p3_latest_in(:'c1')
  AND (:'p3_ctx1'::JSONB ->> 'messageCount')::INTEGER = 45
  AND (:'p3_ctx1'::JSONB #>> '{models,fast}') = 'gemini-3.5-flash-lite',
  'c1 (45 messages): summary mode, leaving = the oldest 25, window = the latest 20, next boundary 25');
SELECT pg_temp.p3_assert((:'p3_ctx1'::JSONB -> 'leaving' -> 2) = jsonb_build_object('messageId', pg_temp.p3_pos(:'c1', 3),
    'direction', 'inbound', 'role', 'client', 'at', :'p3_ctx1'::JSONB #> '{leaving,2,at}', 'text', 'P3 подпись к фото',
    'media', '[{"kind":"photo"}]'::JSONB)
  AND (:'p3_ctx1'::JSONB #> '{leaving,4,text}') = 'null'::JSONB
  AND (:'p3_ctx1'::JSONB #> '{leaving,4,media}') = '[{"kind":"voice"}]'::JSONB
  AND (:'p3_ctx1'::JSONB #> '{leaving,6,text}') = 'null'::JSONB
  AND (:'p3_ctx1'::JSONB #> '{leaving,6,media}') = '[{"kind":"file"}]'::JSONB
  AND (:'p3_ctx1'::JSONB #> '{leaving,8,media}') = '[{"kind":"sticker"}]'::JSONB
  AND (:'p3_ctx1'::JSONB #>> '{leaving,1,role}') = 'staff' AND (:'p3_ctx1'::JSONB #>> '{leaving,1,direction}') = 'outbound'
  AND (:'p3_ctx1'::JSONB #>> '{leaving,1,text}') = 'P3 менеджер: ответ 2'
  AND (:'p3_ctx1'::JSONB #> '{leaving,1,media}') = '[]'::JSONB
  AND :'p3_ctx1' NOT LIKE '%P3-synthetic-passport-scan%' AND :'p3_ctx1' NOT LIKE '%📎%'
  AND :'p3_ctx1' NOT LIKE '%откройте в WhatsApp%' AND :'p3_ctx1' NOT LIKE '%79967%'
  AND :'p3_ctx1' NOT LIKE '%Синтетова%',
  'media become kinds with the caption only; no file name, marker, phone or surname reaches the agent');
SELECT pg_temp.p3_assert((pg_temp.p3_call(pg_temp.p3_ctx(:'c1', 'p3-w2')) ->> 'status') = 'busy'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_context_v1(%L, %L, 10)', :'c1', 'p3-w2')) LIKE '22023:%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_context_v1(%L, %L, 120)', :'c1', ' ')) LIKE '22023:%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(:'c2', 'p3-w2')) LIKE '42501:ai_memory_not_sales%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(pg_temp.p3_id(999), 'p3-w2')) LIKE 'P0002:%',
  'another worker is busy; lease 30..900 and a worker ref; a curator chat 42501; an unknown chat P0002');

-- Put guards (lease p3-w1, version 1).
SELECT pg_temp.p3_assert(
  pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w2', 1, NULL, 'Сводка', pg_temp.p3_pos(:'c1', 25), 25, NULL))
    LIKE '42501:ai_memory_not_leased%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 2, NULL, 'Сводка', pg_temp.p3_pos(:'c1', 25), 25, NULL))
    LIKE 'PT409:ai_memory_version_conflict%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Сводка', pg_temp.p3_pos(:'c1', 30), 30, NULL))
    LIKE '22023:ai_memory_boundary_invalid%inside the window%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Сводка', pg_temp.p3_pos(:'c1', 25), 24, NULL))
    LIKE 'PT409:ai_memory_boundary_moved%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Сводка', pg_temp.p3_pos(:'c4', 1), 1, NULL))
    LIKE '22023:ai_memory_boundary_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, NULL, NULL, NULL, NULL)) LIKE '22023:ai_memory_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Сводка', NULL, NULL, NULL)) LIKE '22023:ai_memory_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, 'Интерес', NULL, NULL, NULL, NULL)) LIKE '22023:ai_memory_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, 'Интерес', NULL, NULL, NULL, pg_temp.p3_pos(:'c1', 44)))
    LIKE '22023:ai_memory_invalid%interest message%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, repeat('я', 141), NULL, NULL, NULL, pg_temp.p3_latest_in(:'c1')))
    LIKE '22023:ai_memory_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, repeat('я', 1501), pg_temp.p3_pos(:'c1', 25), 25, NULL))
    LIKE '22023:ai_memory_invalid%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Позвонить на +996 555 123 456',
    pg_temp.p3_pos(:'c1', 25), 25, NULL)) LIKE '22023:ai_memory_personal_data%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Почта p3.client@example.invalid',
    pg_temp.p3_pos(:'c1', 25), 25, NULL)) LIKE '22023:ai_memory_personal_data%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, 'ПИН 12345678901234', NULL, NULL, NULL,
    pg_temp.p3_latest_in(:'c1'))) LIKE '22023:ai_memory_personal_data%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w1', 1, NULL, 'Сводка', pg_temp.p3_pos(:'c1', 25), 25, NULL, 'gpt-4'))
    LIKE '22023:ai_memory_invalid%',
  'put guards: lease, version, boundary (window, count, other chat), shape, interest message, caps, phones, e-mails, PIN, model');
SELECT pg_temp.p3_put(:'c1', 'p3-w1', 1, E'Бакалавриат в Малайзии,\n бюджет до 5000 USD в год',
  'Сводка P3: клиент выбирает бакалавриат в Малайзии, прислал фото и документ; договорились прислать список программ.',
  pg_temp.p3_pos(:'c1', 25), 25, pg_temp.p3_latest_in(:'c1')) AS p3_put1_sql \gset
SELECT pg_temp.p3_call(:'p3_put1_sql') AS p3_put1 \gset
SELECT pg_temp.p3_assert((:'p3_put1'::JSONB ->> 'status') = 'saved' AND (:'p3_put1'::JSONB ->> 'version')::BIGINT = 2
  AND (:'p3_put1'::JSONB ->> 'coveredCount')::INTEGER = 25 AND NOT (:'p3_put1'::JSONB ->> 'interestThrottled')::BOOLEAN
  AND NOT (:'p3_put1'::JSONB ->> 'stillDue')::BOOLEAN,
  '45 messages → the first summary covers 25; nothing is still due');
SELECT pg_temp.p3_assert((pg_temp.p3_call(pg_temp.p3_put(:'c1', 'p3-w1', 2, NULL, 'Сводка ещё раз',
  pg_temp.p3_pos(:'c1', 25), 25, NULL)) ->> 'error') LIKE '42501:ai_memory_not_leased%',
  'the put released the lease: a second write needs a new claim');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT interest = 'Бакалавриат в Малайзии, бюджет до 5000 USD в год' AND covered_count = 25
    AND covered_message_id = pg_temp.p3_pos(:'c1', 25) AND interest_message_id = pg_temp.p3_latest_in(:'c1')
    AND interest_updated_at IS NOT NULL AND lease_owner IS NULL AND enqueued_at IS NULL AND version = 2
    AND model = 'gemini-3.5-flash-lite' AND summary LIKE 'Сводка P3:%'
  FROM platform_private.ai_client_memory WHERE conversation_id = :'c1'),
  'the row: interest on one line, coverage 25, lease and queue mark cleared');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert((platform_ai_agent.memory_due_v1(ARRAY[:'c1']::UUID[]) #>> '{items,0,status}') = 'not_due',
  'right after the put c1 is not due');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. +3 messages: only the interest (at most once a minute); +6: the summary.
-- ---------------------------------------------------------------------------
INSERT INTO p3_runs VALUES (301, pg_temp.p3_run(301, pg_temp.p3_in(301, '79967400001@c.us', 'P3 клиент: а магистратура?',
  pg_temp.p3_at(1001)), pg_temp.p3_at(1001)));
INSERT INTO p3_runs VALUES (302, pg_temp.p3_run(302, pg_temp.p3_out(302, '79967400001@c.us', 'P3 менеджер: есть программы',
  pg_temp.p3_at(1002)), pg_temp.p3_at(1002)));
INSERT INTO p3_runs VALUES (303, pg_temp.p3_run(303, pg_temp.p3_in(303, '79967400001@c.us', 'P3 клиент: интересна магистратура',
  pg_temp.p3_at(1003)), pg_temp.p3_at(1003)));
SELECT pg_temp.p3_reindex();
SELECT pg_temp.p3_assert((SELECT bool_and(result ->> 'disposition' = 'succeeded') FROM p3_runs WHERE n BETWEEN 301 AND 303),
  'three more messages in c1 (48)');
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.memory_due_v1(ARRAY[:'c1']::UUID[]) AS p3_due2 \gset
SELECT pg_temp.p3_assert((:'p3_due2'::JSONB #>> '{items,0,status}') = 'enqueued'
  AND (:'p3_due2'::JSONB #>> '{items,0,delaySeconds}')::INTEGER BETWEEN 1 AND 60,
  'a new client message makes the interest due, delayed to one minute after the last interest');
SELECT platform_ai_agent.memory_context_v1(:'c1', 'p3-w1', 120) AS p3_ctx2 \gset
SELECT pg_temp.p3_assert((:'p3_ctx2'::JSONB ->> 'mode') = 'interest' AND NOT (:'p3_ctx2'::JSONB ->> 'summaryDue')::BOOLEAN
  AND (:'p3_ctx2'::JSONB -> 'leaving') = '[]'::JSONB AND (:'p3_ctx2'::JSONB -> 'next') = 'null'::JSONB
  AND jsonb_array_length(:'p3_ctx2'::JSONB -> 'window') = 20
  AND (:'p3_ctx2'::JSONB #>> '{prior,coveredCount}')::INTEGER = 25
  AND (:'p3_ctx2'::JSONB #>> '{prior,summary}') LIKE 'Сводка P3:%'
  AND (:'p3_ctx2'::JSONB ->> 'interestMessageId')::UUID = pg_temp.p3_latest_in(:'c1'),
  '+3 messages (3 uncovered outside the window): interest only, no summary refresh');
SELECT pg_temp.p3_call(pg_temp.p3_put(:'c1', 'p3-w1', (:'p3_ctx2'::JSONB #>> '{prior,version}')::BIGINT,
  'Магистратура в Малайзии', NULL, NULL, NULL, pg_temp.p3_latest_in(:'c1'))) AS p3_put2 \gset
SELECT pg_temp.p3_assert((:'p3_put2'::JSONB ->> 'status') = 'saved' AND (:'p3_put2'::JSONB ->> 'interestThrottled')::BOOLEAN
  AND (:'p3_put2'::JSONB ->> 'stillDue')::BOOLEAN AND (:'p3_put2'::JSONB ->> 'delaySeconds')::INTEGER BETWEEN 1 AND 60,
  'a changed interest within 60 s is not written (interestThrottled) and is re-enqueued for later');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT interest = 'Бакалавриат в Малайзии, бюджет до 5000 USD в год'
    AND interest_message_id = pg_temp.p3_pos(:'c1', 45) AND enqueued_at IS NOT NULL AND lease_owner IS NULL
  FROM platform_private.ai_client_memory WHERE conversation_id = :'c1')
  AND (SELECT q.vt > clock_timestamp() + INTERVAL '1 second' FROM pgmq.q_ai_agent_work_v1 q
    WHERE q.message ->> 'ref_id' = :'c1' ORDER BY q.msg_id DESC LIMIT 1),
  'the old interest stays; the newest pointer of c1 is delayed');
-- A minute later (the last evaluation moved back as the table owner).
UPDATE platform_private.ai_client_memory SET interest_updated_at = interest_updated_at - INTERVAL '61 seconds'
  WHERE conversation_id = :'c1';
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.memory_context_v1(:'c1', 'p3-w1', 120) AS p3_ctx3 \gset
SELECT pg_temp.p3_call(pg_temp.p3_put(:'c1', 'p3-w1', (:'p3_ctx3'::JSONB #>> '{prior,version}')::BIGINT,
  'Магистратура в Малайзии', NULL, NULL, NULL, pg_temp.p3_latest_in(:'c1'))) AS p3_put3 \gset
SELECT pg_temp.p3_assert((:'p3_ctx3'::JSONB ->> 'mode') = 'interest' AND (:'p3_put3'::JSONB ->> 'status') = 'saved'
  AND NOT (:'p3_put3'::JSONB ->> 'interestThrottled')::BOOLEAN AND NOT (:'p3_put3'::JSONB ->> 'stillDue')::BOOLEAN,
  'after a minute the new interest is written');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT interest = 'Магистратура в Малайзии' AND covered_count = 25
    AND interest_message_id = pg_temp.p3_latest_in(:'c1')
  FROM platform_private.ai_client_memory WHERE conversation_id = :'c1'), 'the interest changed, the summary did not');

INSERT INTO p3_runs VALUES (304, pg_temp.p3_run(304, pg_temp.p3_out(304, '79967400001@c.us', 'P3 менеджер: какой бюджет?',
  pg_temp.p3_at(1004)), pg_temp.p3_at(1004)));
INSERT INTO p3_runs VALUES (305, pg_temp.p3_run(305, pg_temp.p3_in(305, '79967400001@c.us', 'P3 клиент: до 6000 в год',
  pg_temp.p3_at(1005)), pg_temp.p3_at(1005)));
INSERT INTO p3_runs VALUES (306, pg_temp.p3_run(306, pg_temp.p3_out(306, '79967400001@c.us', 'P3 менеджер: подберу варианты',
  pg_temp.p3_at(1006)), pg_temp.p3_at(1006)));
SELECT pg_temp.p3_reindex();
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert((platform_ai_agent.memory_due_v1(ARRAY[:'c1']::UUID[]) #>> '{items,0,status}') = 'enqueued',
  '+6 since the summary: due again');
SELECT platform_ai_agent.memory_context_v1(:'c1', 'p3-w3', 120) AS p3_ctx4 \gset
SELECT pg_temp.p3_assert((:'p3_ctx4'::JSONB ->> 'mode') = 'summary' AND (:'p3_ctx4'::JSONB ->> 'messageCount')::INTEGER = 51
  AND jsonb_array_length(:'p3_ctx4'::JSONB -> 'leaving') = 6
  AND (:'p3_ctx4'::JSONB #>> '{leaving,0,messageId}')::UUID = pg_temp.p3_pos(:'c1', 26)
  AND (:'p3_ctx4'::JSONB #>> '{prior,summary}') LIKE 'Сводка P3:%' AND (:'p3_ctx4'::JSONB #>> '{prior,coveredCount}')::INTEGER = 25
  AND (:'p3_ctx4'::JSONB #>> '{next,coveredCount}')::INTEGER = 31
  AND (:'p3_ctx4'::JSONB #>> '{next,coveredMessageId}')::UUID = pg_temp.p3_pos(:'c1', 31),
  '51 messages, 6 uncovered outside the window: summary of messages 26..31 with the prior summary');
SELECT pg_temp.p3_assert(pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w3', (:'p3_ctx4'::JSONB #>> '{prior,version}')::BIGINT,
    NULL, 'Сводка назад', pg_temp.p3_pos(:'c1', 25), 25, NULL)) LIKE '22023:ai_memory_boundary_invalid%coverage must grow%',
  'the coverage must grow');
SELECT pg_temp.p3_call(pg_temp.p3_put(:'c1', 'p3-w3', (:'p3_ctx4'::JSONB #>> '{prior,version}')::BIGINT,
  'Магистратура в Малайзии', 'Сводка P3 v2: магистратура в Малайзии, бюджет до 6000 в год; подобрать варианты.',
  pg_temp.p3_pos(:'c1', 31), 31, pg_temp.p3_latest_in(:'c1'))) AS p3_put4 \gset
SELECT pg_temp.p3_assert((:'p3_put4'::JSONB ->> 'status') = 'saved' AND (:'p3_put4'::JSONB ->> 'coveredCount')::INTEGER = 31
  AND NOT (:'p3_put4'::JSONB ->> 'stillDue')::BOOLEAN AND NOT (:'p3_put4'::JSONB ->> 'interestThrottled')::BOOLEAN,
  'the refreshed summary covers 31; the unchanged interest is not throttled');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. An older message (history import) breaks the coverage count → rebuild.
-- ---------------------------------------------------------------------------
INSERT INTO p3_runs VALUES (330, pg_temp.p3_run(330, pg_temp.p3_in(330, '79967400001@c.us', 'P3 клиент: старое сообщение',
  pg_temp.p3_at(-600)), pg_temp.p3_at(-600)));
SELECT pg_temp.p3_reindex();
SELECT pg_temp.p3_assert((SELECT result ->> 'disposition' = 'succeeded' FROM p3_runs WHERE n = 330)
  AND pg_temp.p3_pos(:'c1', 1) = (SELECT m.id FROM platform.communication_messages m WHERE m.conversation_id = :'c1'
    AND m.body_text = 'P3 клиент: старое сообщение'),
  'an older message lands before every other message of c1');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert((platform_ai_agent.memory_due_v1(ARRAY[:'c1']::UUID[]) #>> '{items,0,status}') = 'enqueued',
  'an inconsistent coverage makes the summary due');
SELECT platform_ai_agent.memory_context_v1(:'c1', 'p3-w4', 120) AS p3_ctx5 \gset
SELECT pg_temp.p3_assert((:'p3_ctx5'::JSONB ->> 'mode') = 'summary' AND (:'p3_ctx5'::JSONB ->> 'rebuild')::BOOLEAN
  AND (:'p3_ctx5'::JSONB #> '{prior,summary}') = 'null'::JSONB AND (:'p3_ctx5'::JSONB #>> '{prior,coveredCount}')::INTEGER = 0
  AND (:'p3_ctx5'::JSONB #>> '{prior,interest}') = 'Магистратура в Малайзии'
  AND jsonb_array_length(:'p3_ctx5'::JSONB -> 'leaving') = 32
  AND (:'p3_ctx5'::JSONB #>> '{leaving,0,text}') = 'P3 клиент: старое сообщение'
  AND (:'p3_ctx5'::JSONB #>> '{next,coveredCount}')::INTEGER = 32,
  'rebuild: the prior summary is dropped and the coverage starts from the first message');
SELECT pg_temp.p3_assert(pg_temp.p3_err(pg_temp.p3_put(:'c1', 'p3-w4', (:'p3_ctx5'::JSONB #>> '{prior,version}')::BIGINT,
    NULL, 'Сводка', pg_temp.p3_pos(:'c1', 32), 31, NULL)) LIKE 'PT409:ai_memory_boundary_moved%',
  'the old count for the old boundary no longer matches (PT409)');
SELECT pg_temp.p3_assert((pg_temp.p3_call(pg_temp.p3_put(:'c1', 'p3-w4', (:'p3_ctx5'::JSONB #>> '{prior,version}')::BIGINT,
    NULL, 'Сводка P3 v3: магистратура в Малайзии, бюджет до 6000 в год.',
    (:'p3_ctx5'::JSONB #>> '{next,coveredMessageId}')::UUID, 32, NULL)) ->> 'coveredCount')::INTEGER = 32,
  'the rebuilt summary covers 32');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 9. The batch is at most 80 (c4: 102 messages).
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.memory_context_v1(:'c4', 'p3-w5', 120) AS p3_ctx6 \gset
SELECT pg_temp.p3_assert((:'p3_ctx6'::JSONB ->> 'mode') = 'summary'
  AND jsonb_array_length(:'p3_ctx6'::JSONB -> 'leaving') = 80
  AND (:'p3_ctx6'::JSONB #>> '{next,coveredCount}')::INTEGER = 80
  AND (:'p3_ctx6'::JSONB #>> '{next,coveredMessageId}')::UUID = pg_temp.p3_pos(:'c4', 80),
  '82 messages outside the window: one batch takes the oldest 80');
SELECT pg_temp.p3_call(pg_temp.p3_put(:'c4', 'p3-w5', (:'p3_ctx6'::JSONB #>> '{prior,version}')::BIGINT,
  'Подготовительный курс', 'Сводка P3 c4: подготовительный курс.', pg_temp.p3_pos(:'c4', 80), 80,
  pg_temp.p3_latest_in(:'c4'))) AS p3_put6 \gset
SELECT pg_temp.p3_assert((:'p3_put6'::JSONB ->> 'status') = 'saved' AND NOT (:'p3_put6'::JSONB ->> 'stillDue')::BOOLEAN,
  'after 80 only 2 remain uncovered: not due');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 10. The answer context: messages through the same view, memory, lead.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p3_tickets(label TEXT PRIMARY KEY, ticket TEXT, redemption UUID);
GRANT SELECT, INSERT, UPDATE ON p3_tickets TO authenticated, evo_ai_agent;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
INSERT INTO p3_tickets(label, ticket) SELECT 't1', platform.ai_agent_ticket_v1(pg_temp.p3_id(1), 'answer', :'c1',
  pg_temp.p3_latest_in(:'c1')) ->> 'ticket';
INSERT INTO p3_tickets(label, ticket) SELECT 't3', platform.ai_agent_ticket_v1(pg_temp.p3_id(1), 'answer', :'c3',
  pg_temp.p3_latest_in(:'c3')) ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE p3_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID;
RESET ROLE;
SELECT redemption AS p3_red1 FROM p3_tickets WHERE label = 't1' \gset
SELECT redemption AS p3_red3 FROM p3_tickets WHERE label = 't3' \gset
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.conversation_context_v1(:'p3_red1') AS p3_answer1 \gset
SELECT platform_ai_agent.conversation_context_v1(:'p3_red3') AS p3_answer3 \gset
RESET ROLE;
SELECT pg_temp.p3_assert(jsonb_array_length(:'p3_answer1'::JSONB -> 'messages') = 20
  AND (:'p3_answer1'::JSONB #>> '{messages,19,messageId}')::UUID = pg_temp.p3_pos(:'c1', 52)
  AND (:'p3_answer1'::JSONB #>> '{messages,19,direction}') = 'outbound'
  AND (:'p3_answer1'::JSONB ->> 'latestInboundMessageId')::UUID = pg_temp.p3_latest_in(:'c1')
  AND (:'p3_answer1'::JSONB #>> '{memory,interest}') = 'Магистратура в Малайзии'
  AND (:'p3_answer1'::JSONB #>> '{memory,summary}') LIKE 'Сводка P3 v3:%'
  AND (:'p3_answer1'::JSONB #>> '{memory,coveredCount}')::INTEGER = 32
  AND (:'p3_answer1'::JSONB -> 'memory') ? 'updatedAt'
  AND (:'p3_answer1'::JSONB -> 'lead') = '{"name":"Тестия","stage":"new","interestDirection":"MY"}'::JSONB,
  'the answer context: the latest 20 with direction, the memory and the lead card');
SELECT pg_temp.p3_assert((:'p3_answer3'::JSONB -> 'memory') = 'null'::JSONB
  AND (:'p3_answer3'::JSONB -> 'lead') = '{"name":null,"stage":"new","interestDirection":null}'::JSONB
  AND (:'p3_answer3'::JSONB #> '{messages,1}') - 'at' = jsonb_build_object('messageId', pg_temp.p3_pos(:'c3', 2),
    'direction', 'inbound', 'role', 'client', 'text', 'P3 подпись: диплом', 'media', '[{"kind":"photo"}]'::JSONB)
  AND (:'p3_answer3'::JSONB #> '{messages,2}') - 'at' = jsonb_build_object('messageId', pg_temp.p3_pos(:'c3', 3),
    'direction', 'inbound', 'role', 'client', 'text', NULL, 'media', '[{"kind":"file"}]'::JSONB)
  AND :'p3_answer3' NOT LIKE '%P3-synthetic-diploma%' AND :'p3_answer3' NOT LIKE '%📎%'
  AND :'p3_answer3' NOT LIKE '%79967%' AND :'p3_answer3' NOT LIKE '%0003%',
  'c3 (an empty memory row; the chain''s own lead «WhatsApp ••••0003»): no memory, the placeholder is no name; caption and kind, no file name or marker');

-- ---------------------------------------------------------------------------
-- 11. ai_message_view on the remaining markers and on 062 media rows (as the
--     owner, on a real c1 message with another body).
-- ---------------------------------------------------------------------------
SELECT pg_temp.p3_assert((SELECT jsonb_agg(jsonb_build_object('text', v ->> 'text', 'media', v -> 'media') ORDER BY k)
    FROM (SELECT k, platform_private.ai_message_view(jsonb_populate_record(m, jsonb_build_object('body_text', b))) AS v
      FROM platform.communication_messages m,
        (VALUES (1, '📎 Видео — откройте в WhatsApp продаж'),
          (2, E'📎 Аудио — откройте в WhatsApp продаж\nP3 подпись к аудио'),
          (3, '📎 Файл — откройте в WhatsApp продаж'),
          (4, E'📎 Файл: P3 synthetic plan — откройте в WhatsApp продаж.docx — откройте в WhatsApp продаж\nP3 подпись к файлу'),
          (5, '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.'),
          (6, E'P3 обычный текст\nвторая строка'),
          (7, '📎 Фото — откройте где-нибудь ещё'),
          (8, '[Системное уведомление] Историческое исходящее медиа или сообщение без текста. Требуется загрузка медиа.'))
        AS b(k, b)
      WHERE m.id = pg_temp.p3_pos(:'c1', 12)) x)
  = jsonb_build_array(
    jsonb_build_object('text', NULL, 'media', '[{"kind":"video"}]'::JSONB),
    jsonb_build_object('text', 'P3 подпись к аудио', 'media', '[{"kind":"audio"}]'::JSONB),
    jsonb_build_object('text', NULL, 'media', '[{"kind":"file"}]'::JSONB),
    jsonb_build_object('text', 'P3 подпись к файлу', 'media', '[{"kind":"file"}]'::JSONB),
    jsonb_build_object('text', NULL, 'media', '[{"kind":"unknown"}]'::JSONB),
    jsonb_build_object('text', E'P3 обычный текст\nвторая строка', 'media', '[]'::JSONB),
    jsonb_build_object('text', '📎 Фото — откройте где-нибудь ещё', 'media', '[]'::JSONB),
    jsonb_build_object('text', NULL, 'media', '[{"kind":"unknown"}]'::JSONB)),
  'video, audio + caption, file with and without a name (the name never kept), the 060 and 061 markers → unknown, plain text kept');
INSERT INTO platform.communication_message_media (id, organization_id, conversation_id, communication_message_id, ordinal,
  media_kind, mime_type, file_name, file_size_bytes, archival_status, archived_at)
VALUES
  (pg_temp.p3_id(801), pg_temp.p3_id(1), :'c1', pg_temp.p3_pos(:'c1', 12), 0, 'image', 'image/jpeg',
    'P3-synthetic-photo.jpg', 2048, 'archived', statement_timestamp()),
  (pg_temp.p3_id(802), pg_temp.p3_id(1), :'c1', pg_temp.p3_pos(:'c1', 12), 1, 'pdf', 'application/pdf',
    'P3-synthetic-contract.pdf', 4096, 'archived', statement_timestamp());
SELECT pg_temp.p3_assert((SELECT v -> 'media' = '[{"kind":"photo"},{"kind":"file"}]'::JSONB
    AND v ->> 'text' = (SELECT body_text FROM platform.communication_messages WHERE id = pg_temp.p3_pos(:'c1', 12))
    AND v::TEXT NOT LIKE '%P3-synthetic-%' AND v::TEXT NOT LIKE '%image/jpeg%'
  FROM (SELECT platform_private.ai_message_view(m) AS v FROM platform.communication_messages m
    WHERE m.id = pg_temp.p3_pos(:'c1', 12)) x)
  AND (SELECT v -> 'media' = '[{"kind":"photo"},{"kind":"file"}]'::JSONB AND v -> 'text' = 'null'::JSONB
    FROM (SELECT platform_private.ai_message_view(jsonb_populate_record(m, jsonb_build_object('body_text',
        '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.'))) AS v
      FROM platform.communication_messages m WHERE m.id = pg_temp.p3_pos(:'c1', 12)) x),
  '062 rows give the kinds (image → photo, pdf → file) without file name or MIME, also behind the 060 marker');
SELECT pg_temp.p3_assert(platform_private.ai_memory_text_ok(NULL) AND platform_private.ai_memory_text_ok('Бюджет 1 500 000 сом')
  AND platform_private.ai_memory_text_ok('Учебный год 2026-2027, курс 12 345 678')
  AND NOT platform_private.ai_memory_text_ok('+996 555 123 456') AND NOT platform_private.ai_memory_text_ok('996555123456')
  AND NOT platform_private.ai_memory_text_ok('тел. 0555-12-34-56-7') AND NOT platform_private.ai_memory_text_ok('a@b.co')
  AND NOT platform_private.ai_memory_text_ok('ПИН 12345678901234')
  AND NOT platform_private.ai_memory_text_ok('+996 (555) 12-34-56') AND NOT platform_private.ai_memory_text_ok('0 (555) 123-456')
  AND NOT platform_private.ai_memory_text_ok('0555.12.34.56') AND NOT platform_private.ai_memory_text_ok('8(555)123456')
  AND platform_private.ai_memory_text_ok('Срок 06.10.2026, бюджет 1 500 000 сом'),
  'text guard: 8 digits and a date pass; 9+ digits with spaces, hyphens, brackets or dots and e-mails do not');

-- ---------------------------------------------------------------------------
-- 12. Staff: view, refusals, clear (ai.agent.use), audit without text.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') AS p3_view1 \gset
SELECT pg_temp.p3_assert((:'p3_view1'::JSONB ->> 'enabled')::BOOLEAN AND (:'p3_view1'::JSONB ->> 'active')::BOOLEAN
  AND (:'p3_view1'::JSONB ->> 'consentRecorded')::BOOLEAN AND (:'p3_view1'::JSONB ->> 'messageCount')::INTEGER = 52
  AND (:'p3_view1'::JSONB #>> '{memory,interest}') = 'Магистратура в Малайзии'
  AND (:'p3_view1'::JSONB #>> '{memory,coveredCount}')::INTEGER = 32
  AND NOT (:'p3_view1'::JSONB ->> 'summaryDue')::BOOLEAN AND NOT (:'p3_view1'::JSONB ->> 'interestDue')::BOOLEAN
  AND (:'p3_view1'::JSONB -> 'lead') = '{"name":"Тестия","stage":"new","interestDirection":"MY"}'::JSONB,
  'the view shows what the model sees: interest, summary, coverage, the live lead card');
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c2'))
  LIKE '42501:ai_conversation_unavailable%', 'a curator chat has no memory view');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c1'))
    LIKE '42501:ai_conversation_unavailable%'
  AND pg_temp.p3_err(format('SELECT platform.ai_agent_memory_clear_v1(%L, %L, %L)', pg_temp.p3_id(1), :'c1',
    pg_temp.p3_id(3101))) LIKE '42501:ai_conversation_unavailable%',
  'ai.agent.use without the conversation: no view, no clear');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_wa';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c1'))
  LIKE '42501:ai_agent_forbidden%', 'the conversation without ai.agent.use: no view');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c1'))
  LIKE '42501:%', 'the Student: no view');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c1'))
    LIKE '42501:%'
  AND pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(2), :'c1')) LIKE '42501:%',
  'another organization''s Admin: no view, neither through its own organization');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_v1(%L, %L)', pg_temp.p3_id(1), :'c1'))
  LIKE '42501:%', 'anon: no view');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_user';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert(NOT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'canManage')::BOOLEAN,
  'a member without ai.agent.manage sees the memory but cannot manage');
RESET ROLE;
SELECT count(*) AS p3_c1_pointers FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'ref_id' = :'c1' \gset
SET LOCAL request.jwt.claims TO :'p3_user';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_memory_clear_v1(pg_temp.p3_id(1), :'c1', pg_temp.p3_id(3102)) AS p3_clear \gset
SELECT pg_temp.p3_assert((:'p3_clear'::JSONB ->> 'status') = 'cleared' AND (:'p3_clear'::JSONB ->> 'deleted')::BOOLEAN
  AND (:'p3_clear'::JSONB ->> 'enqueued')::BOOLEAN AND NOT (:'p3_clear'::JSONB ->> 'replayed')::BOOLEAN
  AND (platform.ai_agent_memory_clear_v1(pg_temp.p3_id(1), :'c1', pg_temp.p3_id(3102)) ->> 'replayed')::BOOLEAN
  AND pg_temp.p3_err(format('SELECT platform.ai_agent_memory_clear_v1(%L, %L, %L)', pg_temp.p3_id(1), :'c4',
    pg_temp.p3_id(3102))) LIKE '23505:ai_request_conflict%'
  AND (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') -> 'memory') = 'null'::JSONB,
  'ai.agent.use clears the memory (Q9) and a rebuild is enqueued; the same request replays, another input conflicts; the view shows none');
RESET ROLE;
SELECT pg_temp.p3_assert((SELECT interest IS NULL AND summary IS NULL AND covered_message_id IS NULL AND covered_count = 0
    AND interest_message_id IS NULL AND version = 1 AND enqueued_at IS NOT NULL AND lease_owner IS NULL
    FROM platform_private.ai_client_memory WHERE conversation_id = :'c1')
  AND (SELECT count(*) = :'p3_c1_pointers'::INTEGER + 1 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'ref_id' = :'c1')
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p3_id(3102)
    AND e.action = 'ai.agent.memory.clear' AND e.resource_type = 'communication_conversation'
    AND e.resource_id = :'c1'::UUID AND e.actor_profile_id = pg_temp.p3_id(207)
    AND e.before_state = '{"hadInterest":true,"hadSummary":true,"coveredCount":32,"version":6}'::JSONB
    AND (e.before_state::TEXT || e.after_state::TEXT) NOT LIKE '%Магистратура%'
    AND (e.before_state::TEXT || e.after_state::TEXT) NOT LIKE '%Сводка%'),
  'the text is gone (an empty row marks the one new rebuild pointer); the audit has flags and counts only, never the text');

-- ---------------------------------------------------------------------------
-- 13. Disable purges the organization's memory; the agent refuses again.
-- ---------------------------------------------------------------------------
SELECT count(*) AS p3_rows_before FROM platform_private.ai_client_memory WHERE organization_id = pg_temp.p3_id(1) \gset
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'settingsVersion') AS p3_settings_v2 \gset
SELECT platform.ai_agent_memory_toggle_v1(pg_temp.p3_id(1), FALSE, :'p3_settings_v2', pg_temp.p3_id(3201)) AS p3_disable \gset
SELECT pg_temp.p3_assert((:'p3_disable'::JSONB ->> 'status') = 'applied'
  AND NOT (:'p3_disable'::JSONB ->> 'memoryEnabled')::BOOLEAN
  AND (:'p3_disable'::JSONB ->> 'deleted')::INTEGER = :'p3_rows_before'::INTEGER AND :'p3_rows_before'::INTEGER = 3
  AND (:'p3_disable'::JSONB ->> 'enqueued')::INTEGER = 0,
  'disabling deletes every memory row of the organization (c1''s rebuild row, c3, c4) and says how many');
RESET ROLE;
SELECT pg_temp.p3_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory WHERE organization_id = pg_temp.p3_id(1))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p3_id(3201)
    AND e.action = 'ai.agent.memory.disable' AND (e.after_state ->> 'deleted')::INTEGER = 3),
  'no memory row is left; the disable is audited with the count');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL)')
    LIKE '42501:ai_background_disabled%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[])', :'c1'))
    LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(:'c4', 'p3-w5')) LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(pg_temp.p3_put(:'c4', 'p3-w5', 1, 'Интерес', NULL, NULL, NULL, pg_temp.p3_latest_in(:'c4')))
    LIKE '42501:ai_memory_not_leased%',
  'memory off again: inbound_since, due, context and put refuse');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
INSERT INTO p3_tickets(label, ticket) SELECT 't4', platform.ai_agent_ticket_v1(pg_temp.p3_id(1), 'answer', :'c4',
  pg_temp.p3_latest_in(:'c4')) ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE p3_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 't4';
SELECT pg_temp.p3_assert((platform_ai_agent.conversation_context_v1((SELECT redemption FROM p3_tickets WHERE label = 't4'))
  -> 'memory') = 'null'::JSONB, 'with memory off the answer context carries no memory');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 14. Maintenance; a revoked consent stops a put.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'settingsVersion') AS p3_settings_v3 \gset
SELECT platform.ai_agent_memory_toggle_v1(pg_temp.p3_id(1), TRUE, :'p3_settings_v3', pg_temp.p3_id(3301)) AS p3_enable2 \gset
SELECT pg_temp.p3_assert((:'p3_enable2'::JSONB ->> 'status') = 'applied' AND (:'p3_enable2'::JSONB ->> 'enqueued')::INTEGER = 2,
  'memory enabled again: the long chats c1 (52) and c4 are enqueued');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert((SELECT jsonb_object_agg(e ->> 'conversationId', e ->> 'status') FROM jsonb_array_elements(
    platform_ai_agent.memory_due_v1(ARRAY[:'c1', :'c3', :'c4']::UUID[]) -> 'items') e)
  = jsonb_build_object(:'c1', 'pending', :'c3', 'enqueued', :'c4', 'pending'),
  'after the purge c3 is due again; c1 and c4 are already pending since the enable');
SELECT pg_temp.p3_assert((pg_temp.p3_call(pg_temp.p3_ctx(:'c4', 'p3-w7')) ->> 'status') = 'claimed'
  AND (pg_temp.p3_call(pg_temp.p3_ctx(:'c3', 'p3-w6')) ->> 'status') = 'claimed', 'c4 and c3 claimed');
RESET ROLE;
UPDATE platform_private.ai_client_memory SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE conversation_id = :'c4';
INSERT INTO platform_private.ai_client_memory (conversation_id, organization_id, interest, interest_message_id,
  interest_updated_at) VALUES (:'c2', pg_temp.p3_id(1), 'Интерес из прошлого', pg_temp.p3_pos(:'c2', 1), clock_timestamp());
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.maintenance_v1() AS p3_maint1 \gset
RESET ROLE;
SELECT pg_temp.p3_assert((:'p3_maint1'::JSONB ->> 'memoryDeleted')::INTEGER = 1
  AND (:'p3_maint1'::JSONB ->> 'memoryLeasesCleared')::INTEGER = 1
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory WHERE conversation_id = :'c2')
  AND (SELECT lease_owner IS NULL FROM platform_private.ai_client_memory WHERE conversation_id = :'c4')
  AND (SELECT lease_owner = 'p3-w6' FROM platform_private.ai_client_memory WHERE conversation_id = :'c3'),
  'maintenance deletes the curator chat''s memory and clears the expired lease only');
SELECT count(*) AS p3_rows_revoke FROM platform_private.ai_client_memory WHERE organization_id = pg_temp.p3_id(1) \gset
SET LOCAL request.jwt.claims TO :'p3_admin';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_consent_record_v1(pg_temp.p3_id(1), 'revoke', NULL, pg_temp.p3_id(3401)) AS p3_revoke \gset
SELECT pg_temp.p3_assert((:'p3_revoke'::JSONB ->> 'status') = 'revoked'
  AND NOT (:'p3_revoke'::JSONB ->> 'memoryEnabled')::BOOLEAN
  AND (:'p3_revoke'::JSONB ->> 'memoryDeleted')::INTEGER = :'p3_rows_revoke'::INTEGER
  AND :'p3_rows_revoke'::INTEGER = 3,
  'the Admin revokes the consent: memory turns off and its 3 rows (c1, c3, c4) go at once');
RESET ROLE;
SELECT pg_temp.p3_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_client_memory WHERE organization_id = pg_temp.p3_id(1))
  AND (SELECT NOT memory_enabled AND gemini_consent_at IS NULL FROM platform_private.ai_settings
    WHERE organization_id = pg_temp.p3_id(1))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p3_id(3401)
    AND e.action = 'ai.agent.consent.revoke' AND (e.before_state ->> 'memoryEnabled')::BOOLEAN
    AND (e.after_state ->> 'memoryDeleted')::INTEGER = 3),
  'no memory row is left, memory_enabled is false; the revoke is audited with the count');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err(pg_temp.p3_put(:'c3', 'p3-w6', 1, 'Интерес', NULL, NULL, NULL,
    pg_temp.p3_latest_in(:'c3'))) LIKE '42501:ai_memory_not_leased%'
  AND pg_temp.p3_err(pg_temp.p3_ctx(:'c3', 'p3-w6')) LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[])', :'c3'))
    LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL)') LIKE '42501:ai_background_disabled%',
  'consent revoked: the held lease is gone and cannot write; context, due and inbound_since refuse');
SELECT platform_ai_agent.maintenance_v1() AS p3_maint2 \gset
RESET ROLE;
SELECT pg_temp.p3_assert((:'p3_maint2'::JSONB ->> 'memoryDeleted')::INTEGER = 0,
  'maintenance finds nothing left to delete after the revoke');
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert((platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'active')::BOOLEAN = FALSE
  AND NOT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'enabled')::BOOLEAN
  AND NOT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'consentRecorded')::BOOLEAN,
  'the view: memory off, no consent');
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform.ai_agent_memory_toggle_v1(%L, TRUE, %L, %L)',
    pg_temp.p3_id(1), (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'settingsVersion')::BIGINT,
    pg_temp.p3_id(3402))) LIKE 'PT412:ai_consent_required%',
  'enabling again without consent is PT412');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert((platform.ai_agent_consent_record_v1(pg_temp.p3_id(1), 'grant', 'gemini-v1-2026-10-06',
  pg_temp.p3_id(3403)) ->> 'status') = 'granted', 'the Admin records the consent again');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p3_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p3_assert((platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'consentRecorded')::BOOLEAN
  AND NOT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'enabled')::BOOLEAN
  AND NOT (platform.ai_agent_memory_v1(pg_temp.p3_id(1), :'c1') ->> 'active')::BOOLEAN,
  'a new consent does not resume memory: it stays off until a manager enables it');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p3_assert(pg_temp.p3_err(format('SELECT platform_ai_agent.memory_due_v1(ARRAY[%L]::UUID[])', :'c1'))
    LIKE '42501:ai_memory_disabled%'
  AND pg_temp.p3_err('SELECT platform_ai_agent.inbound_since_v1(NULL, NULL)') LIKE '42501:ai_background_disabled%',
  'with the new consent but memory off the agent still refuses');
RESET ROLE;

SELECT 'AI274_AI_AGENT_P3_SUITE_PASSED' AS ai274_suite_result;

ROLLBACK;
