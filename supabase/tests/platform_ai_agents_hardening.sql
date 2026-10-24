\set ON_ERROR_STOP on
-- Boundary suite for migration 319: «ИИ-агенты», два пункта аудита стека 24.10.2026 (docs/PLAN_CHANGES.md
-- «2026-10-24 · ИИ-агенты: усиление по аудиту стека, база данных (миграция 319)»).
-- Runs on the real chain right after 319 inside one transaction that is rolled back, with its own synthetic
-- organizations and members; WhatsApp conversations come through the real WAHA projection chain. No provider, no
-- Claude / Anthropic call, no real person, no production action.
--
-- Proves:
--  1. posture: the three helpers are closed to every API role and have an empty search_path; the replaced functions
--     keep their grants and their number (9 staff + 16 runtime + 3 MCP + 24 tool); the bodies carry what 319 says
--     (audit inside the six reads, the key helper in the three writes, no audit in the action log);
--  2. (a) writes without a model key: the same create_task / add_note / post_digest repeated (whitespace and case
--     apart) is ONE row and the first answer (create_task with deduplicated=true); any other part of the call, another
--     agent, the 11th minute and an explicit model key are new / separate; a refused call is not cached; the lock
--     on the key is held until the end of the transaction;
--  3. (b) audit of the six sensitive reads inside the function: one row per read with the same action, object, actor
--     and after_state as before, none for the other reads and none for a refused read; if the audit insert fails the
--     read fails and nothing is served (no file link is created); the action log writes its row and no audit.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A319_AI_AGENTS_HARDENING_SUITE_START

CREATE FUNCTION pg_temp.a319_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a319_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A319: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a319_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a319_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a319_claims TO authenticated;
CREATE FUNCTION pg_temp.a319_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_call('authenticated', (SELECT claims FROM a319_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a319_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a319_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a319_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a319_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
-- A tool call as the service: tool name, agent key, args JSON text, organization.
CREATE FUNCTION pg_temp.a319_tool(p_tool TEXT, p_key TEXT, p_args TEXT DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_svc(format('SELECT platform.ai_agent_tool_%s_v1(%L, %L, %L::jsonb)', p_tool, pg_temp.a319_id(p_org), p_key, p_args))
$$;
CREATE FUNCTION pg_temp.a319_rt(p_fn TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_svc(format('SELECT platform.%s(%s)', p_fn, p_args))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a319_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   1 org 1 Admin (system admin)   2 org 1 Student   3 org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a319_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a319_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a319_id(1), 'A319 Fictional organization', 'active'),
  (pg_temp.a319_id(2), 'A319 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a319_id(100 + n), 'a319-' || n || '@example.invalid', '{}'::JSONB FROM a319_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a319_id(200 + n), pg_temp.a319_id(100 + n), 'A319 Actor ' || n, 'active', 1 FROM a319_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a319_id(300 + a.n), pg_temp.a319_id(a.org), pg_temp.a319_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a319_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a319_id(300 + n) FROM a319_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a319_id(401), pg_temp.a319_id(1), 'organization', pg_temp.a319_id(1), 1),
  (pg_temp.a319_id(402), pg_temp.a319_id(2), 'organization', pg_temp.a319_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a319_id(1), pg_temp.a319_id(301), pg_temp.a319_id(401), 1, 1, TRUE, 'system', 'A319 synthetic scope', pg_temp.a319_id(601)),
  (pg_temp.a319_id(2), pg_temp.a319_id(303), pg_temp.a319_id(402), 1, 1, TRUE, 'system', 'A319 synthetic scope', pg_temp.a319_id(602));

CREATE FUNCTION pg_temp.a319_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a319_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a319_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a319_claims(actor, claims) SELECT a.n, pg_temp.a319_claims_for(a.n) FROM a319_actors a;
SELECT pg_temp.a319_assert((SELECT count(*) = 3 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id') FROM a319_claims),
  'every fixture actor got real hook claims');

-- WhatsApp conversation through the REAL WAHA projection chain (the intake owner is the Admin).
CREATE TEMP TABLE a319_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
GRANT SELECT ON a319_clock TO authenticated, service_role;
CREATE FUNCTION pg_temp.a319_ago(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 - p_seconds * INTERVAL '1 second' FROM a319_clock
$$;
CREATE SEQUENCE pg_temp.a319_seq;
CREATE FUNCTION pg_temp.a319_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a319_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.a319_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.a319_id(20000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a319-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:a319:' || n, lpad(to_hex(3190000 + n), 64, '0'), pg_temp.a319_id(25000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a319-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.a319_id(30000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a319', pg_temp.a319_id(30000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a319_id(301), pg_temp.a319_id(30000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a319_id(30000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'A319: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
CREATE FUNCTION pg_temp.a319_in(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.a319_ago(p_seconds_ago);
  wid TEXT := 'false_' || chat || '_A319' || lpad(nextval('pg_temp.a319_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.a319_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', p_body), at);
  RETURN (SELECT m.id FROM platform.communication_messages m JOIN platform_private.waha_message_bindings b
    ON b.organization_id = m.organization_id AND b.communication_message_id = m.id WHERE b.raw_message_id = wid);
END
$$;
CREATE FUNCTION pg_temp.a319_conv(p_chat INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.a319_id(1) AND binding.normalized_chat_id = '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'
$$;
SELECT pg_temp.a319_in(1, 'Здравствуйте, хочу учиться в Китае', 7200) AS a319_m1 \gset
SELECT pg_temp.a319_in(1, 'Сколько стоит обучение?', 7100) AS a319_m2 \gset
SELECT pg_temp.a319_conv(1) AS a319_c1 \gset
SELECT pg_temp.a319_assert(:'a319_c1' IS NOT NULL AND (SELECT count(*) = 2 FROM platform.communication_messages WHERE conversation_id = :'a319_c1'::UUID),
  'fixture: a WhatsApp conversation with two messages through the real projection chain');

-- Seeded rows (owner, triggers off): a client, a lead, two cases of organization 1, a document, the chat of the case.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email, phone, normalized_phone,
  lifecycle_state, created_at, updated_at)
SELECT c.id, c.org, c.name, platform_private.normalize_person_name(c.name), c.email,
  platform_private.normalize_person_email(c.email), c.phone, platform_private.normalize_person_phone(c.phone), 'active', c.created, c.created
FROM (VALUES
  (pg_temp.a319_id(501), pg_temp.a319_id(1), 'A319 Клиент Один', 'a319.client1@example.invalid', '+996555319001', clock_timestamp() - INTERVAL '10 days'),
  (pg_temp.a319_id(502), pg_temp.a319_id(1), 'A319 Клиент Два', 'a319.client2@example.invalid', '+996555319002', clock_timestamp() - INTERVAL '12 days'),
  (pg_temp.a319_id(503), pg_temp.a319_id(2), 'A319 Чужой Клиент', NULL::TEXT, '+996555319003', clock_timestamp() - INTERVAL '1 day')
) AS c(id, org, name, email, phone, created);
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  interest_direction, created_at, updated_at) VALUES
  (pg_temp.a319_id(601), pg_temp.a319_id(1), pg_temp.a319_id(501), pg_temp.a319_id(301), 'qualified', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '5 days', clock_timestamp() - INTERVAL '1 day'),
  (pg_temp.a319_id(602), pg_temp.a319_id(1), pg_temp.a319_id(502), pg_temp.a319_id(301), 'new', 'whatsapp', 'open', 'MY',
    clock_timestamp() - INTERVAL '12 days', clock_timestamp() - INTERVAL '10 days'),
  (pg_temp.a319_id(603), pg_temp.a319_id(2), pg_temp.a319_id(503), NULL, 'new', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '1 day', clock_timestamp() - INTERVAL '1 day');
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, canonical_client_id, canonical_lead_id, next_action,
  created_at, updated_at) VALUES
  (pg_temp.a319_id(701), pg_temp.a319_id(1), pg_temp.a319_id(302), pg_temp.a319_id(301), pg_temp.a319_id(301), 'a319-case-1',
    'A319 Клиент Один', 'China', 'bachelor', 'CN', '2027-09', 'intake', 'active', clock_timestamp() - INTERVAL '3 days', NULL,
    pg_temp.a319_id(401), 1, 'CN', 'documents', pg_temp.a319_id(501), pg_temp.a319_id(601), 'Собрать документы',
    clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'),
  (pg_temp.a319_id(702), pg_temp.a319_id(1), NULL, pg_temp.a319_id(301), NULL, 'a319-case-2',
    'A319 Клиент Два', 'Malaysia', 'master', 'MY', '2027-02', 'intake', 'pending', NULL, NULL,
    pg_temp.a319_id(401), 1, 'MY', 'new', pg_temp.a319_id(502), pg_temp.a319_id(602), NULL,
    clock_timestamp() - INTERVAL '3 days', clock_timestamp() - INTERVAL '2 hours'),
  (pg_temp.a319_id(703), pg_temp.a319_id(2), NULL, pg_temp.a319_id(303), NULL, 'a319-case-3',
    'A319 Чужой Студент', 'China', 'bachelor', 'CN', NULL, 'intake', 'pending', NULL, NULL,
    pg_temp.a319_id(402), 1, 'CN', 'new', pg_temp.a319_id(503), pg_temp.a319_id(603), NULL,
    clock_timestamp() - INTERVAL '1 day', clock_timestamp() - INTERVAL '1 day');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a319_id(501), canonical_lead_id = pg_temp.a319_id(601)
  WHERE id = :'a319_c1'::UUID;
INSERT INTO platform.document_requirements (id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, created_by_membership_id) VALUES
  (pg_temp.a319_id(801), pg_temp.a319_id(1), 'China', 'bachelor', 'CN', 1, 'passport', 'Паспорт', 'Скан разворота', pg_temp.a319_id(301));
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status, deadline, current_version_id,
  current_version_no, created_by_membership_id, created_at, updated_at, intent_kind, display_label, group_label) VALUES
  (pg_temp.a319_id(811), pg_temp.a319_id(1), pg_temp.a319_id(701), pg_temp.a319_id(801), 'approved', NULL, pg_temp.a319_id(821), 1,
    pg_temp.a319_id(301), clock_timestamp() - INTERVAL '3 days', clock_timestamp() - INTERVAL '1 day', 'baseline', NULL, NULL);
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, integrity_status, malware_status, malware_scan_attestation_id, created_at) VALUES
  (pg_temp.a319_id(821), pg_temp.a319_id(1), pg_temp.a319_id(701), pg_temp.a319_id(811), 1, 'passport.pdf', 'application/pdf', 12345,
    repeat('a', 64), 'ev:821', pg_temp.a319_id(302), 'verified', 'clean', pg_temp.a319_id(861), clock_timestamp() - INTERVAL '2 days');
INSERT INTO platform_private.document_storage_bindings (id, organization_id, student_case_id, document_slot_id, document_version_id,
  upload_reservation_id, bucket_id, object_name) VALUES
  (pg_temp.a319_id(831), pg_temp.a319_id(1), pg_temp.a319_id(701), pg_temp.a319_id(811), pg_temp.a319_id(821), pg_temp.a319_id(841),
    'platform-documents', 'aa/' || repeat('1', 62));
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at) VALUES
  (pg_temp.a319_id(1061), pg_temp.a319_id(1), pg_temp.a319_id(701), pg_temp.a319_id(302), 'Какие документы ещё нужны?', clock_timestamp() - INTERVAL '90 minutes'),
  (pg_temp.a319_id(1062), pg_temp.a319_id(1), pg_temp.a319_id(701), pg_temp.a319_id(301), 'Пришлите аттестат, пожалуйста.', clock_timestamp() - INTERVAL '60 minutes');
SET LOCAL session_replication_role = origin;

-- The first read creates the 7 agents of each organization; two of them are switched on.
SELECT pg_temp.a319_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a319_id(1))) AS a319_list1 \gset
SELECT pg_temp.a319_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a319_id(2))) AS a319_list2 \gset
SELECT pg_temp.a319_assert(jsonb_array_length((:'a319_list1'::JSONB) -> 'agents') = 7 AND jsonb_array_length((:'a319_list2'::JSONB) -> 'agents') = 7,
  'the first read seeds 7 agents per organization');
CREATE FUNCTION pg_temp.a319_upd(p_key TEXT, p_patch TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_staff(1, format('SELECT platform.ai_agents_update_v1(%L, %L, %s, %L::jsonb, %L)', pg_temp.a319_id(1), p_key,
    (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a319_id(1) AND key = p_key),
    p_patch, pg_temp.a319_id(p_req)))
$$;
SELECT pg_temp.a319_upd('sales', '{"enabled":true}', 2001) AS a319_u1 \gset
SELECT pg_temp.a319_upd('director', '{"enabled":true}', 2002) AS a319_u2 \gset
SELECT pg_temp.a319_assert((:'a319_u1'::JSONB) ? 'configVersion' AND (:'a319_u2'::JSONB) ? 'configVersion',
  'the scenario agents are enabled: ' || :'a319_u1' || :'a319_u2');

-- ---------------------------------------------------------------------------
-- 1. Posture of what 319 adds and replaces.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a319_assert(
  (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_agent_auto_key', 'ai_agent_dedupe_once', 'ai_agent_audit_read')
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_agent_dedupe_once', 'ai_agent_audit_read') AND p.prosecdef),
  '319 posture: three helpers closed to every API role with an empty search_path, the two that write are definer functions');
SELECT pg_temp.a319_assert(
  (SELECT count(*) = 9 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 16 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_runtime\_%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_mcp\_%'
     AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 24 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_tool\_%'
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
     AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'the replaced functions keep their grants and their number: 9 staff, 16 runtime, 3 MCP, 24 tools (no new function in schema platform)');
SELECT pg_temp.a319_assert(
  (SELECT count(*) = 6 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('ai_agent_tool_get_client_card_v1', 'ai_agent_tool_get_lead_v1', 'ai_agent_tool_get_case_v1',
       'ai_agent_tool_get_document_file_v1', 'ai_agent_tool_get_conversation_v1', 'ai_agent_tool_get_case_chat_v1')
     AND strpos(p.prosrc, 'ai_agent_audit_read(') > 0)
  AND (SELECT count(*) = 3 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE
     AND p.proname IN ('ai_agent_tool_create_task_v1', 'ai_agent_tool_add_note_v1', 'ai_agent_tool_post_digest_v1')
     AND strpos(p.prosrc, 'ai_agent_dedupe_once(') > 0)
  AND (SELECT strpos(p.prosrc, 'ai_agent_audit(') = 0 AND strpos(p.prosrc, 'SET audit_event_id') = 0 FROM pg_proc p
     WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'ai_agent_mcp_log_v1'),
  'bodies: audit inside the six reads, the key helper in the three writes, no audit left in the action log');
-- The tool schema table (317) is untouched: the same 24 rows, 6 reads with audit = read.
SELECT pg_temp.a319_assert((SELECT count(*) = 24 AND count(*) FILTER (WHERE audit = 'read') = 6 AND count(*) FILTER (WHERE audit = 'write') = 5
  FROM platform_private.ai_agent_tool_schemas), 'the tool registry table is unchanged');

-- ---------------------------------------------------------------------------
-- 2. (a) Writes without a model key.
-- ---------------------------------------------------------------------------
SELECT count(*) AS a319_staff_tasks0 FROM platform.staff_tasks WHERE title LIKE '[ИИ%' \gset
SELECT count(*) AS a319_case_tasks0 FROM platform.case_tasks WHERE task_type = 'ai_agent' \gset
SELECT count(*) AS a319_notes0 FROM platform.case_notes WHERE body LIKE '[ИИ%' \gset
SELECT count(*) AS a319_digests0 FROM platform_private.ai_agent_digests \gset
SELECT count(*) AS a319_writes_audit0 FROM platform.audit_events WHERE action = 'ai.agent.tool.write' \gset

-- create_task: the same call repeated is one task and the first answer.
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t1 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t1b \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"  ПОЗВОНИТЬ   клиенту ","description":"клиент\nждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t1c \gset
SELECT pg_temp.a319_assert(
  (:'a319_t1'::JSONB) ->> 'kind' = 'staff' AND (:'a319_t1'::JSONB) ->> 'deduplicated' = 'false'
  AND (:'a319_t1b'::JSONB) = ((:'a319_t1'::JSONB) || '{"deduplicated":true}'::JSONB)
  AND (:'a319_t1c'::JSONB) = ((:'a319_t1'::JSONB) || '{"deduplicated":true}'::JSONB)
  AND (SELECT count(*) = :a319_staff_tasks0 + 1 FROM platform.staff_tasks WHERE title LIKE '[ИИ%')
  AND (SELECT count(*) = 1 FROM platform.staff_tasks WHERE id = ((:'a319_t1'::JSONB) ->> 'task_id')::UUID)
  AND (SELECT count(*) = 1 FROM platform.staff_task_events WHERE staff_task_id = ((:'a319_t1'::JSONB) ->> 'task_id')::UUID)
  AND (SELECT count(*) = :a319_writes_audit0 + 1 FROM platform.audit_events WHERE action = 'ai.agent.tool.write')
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE organization_id = pg_temp.a319_id(1) AND agent_key = 'sales'
      AND dedupe_key LIKE 'create\_task\_auto:%' AND char_length(dedupe_key) = 17 + 64),
  'create_task, no key: the same call (whitespace and case apart) is one task, one event, one journal row and the first answer with deduplicated=true: ' || :'a319_t1');

-- Any other part of the call is a new task.
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту 2","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t2 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Другое описание","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t3 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"low","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t4 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-02","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t5 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(602))) AS a319_t6 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', '{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01"}') AS a319_t7 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s","assignee_id":"%s"}', pg_temp.a319_id(601), pg_temp.a319_id(301))) AS a319_t8 \gset
SELECT pg_temp.a319_assert(
  (SELECT count(DISTINCT v ->> 'task_id') = 8 AND bool_and(v ->> 'deduplicated' = 'false')
   FROM unnest(ARRAY[:'a319_t1'::JSONB, :'a319_t2'::JSONB, :'a319_t3'::JSONB, :'a319_t4'::JSONB, :'a319_t5'::JSONB, :'a319_t6'::JSONB,
     :'a319_t7'::JSONB, :'a319_t8'::JSONB]) v)
  AND (SELECT count(*) = :a319_staff_tasks0 + 8 FROM platform.staff_tasks WHERE title LIKE '[ИИ%'),
  'create_task: another title, description, priority, due date, lead, no lead or an explicit assignee is a NEW task (each part of the call is in the key): '
  || (:'a319_t8'::JSONB)::TEXT);

-- create_task on a case: a case task, repeated once.
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Запросить аттестат","case_id":"%s","priority":"low","due_on":"2026-11-05"}', pg_temp.a319_id(701))) AS a319_c1t \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Запросить аттестат","case_id":"%s","priority":"low","due_on":"2026-11-05"}', pg_temp.a319_id(701))) AS a319_c1tb \gset
SELECT pg_temp.a319_assert(
  (:'a319_c1t'::JSONB) ->> 'kind' = 'case' AND (:'a319_c1tb'::JSONB) = ((:'a319_c1t'::JSONB) || '{"deduplicated":true}'::JSONB)
  AND (SELECT count(*) = :a319_case_tasks0 + 1 FROM platform.case_tasks WHERE task_type = 'ai_agent')
  AND (SELECT count(*) = 1 FROM platform.case_task_events WHERE case_task_id = ((:'a319_c1t'::JSONB) ->> 'task_id')::UUID),
  'create_task on a case: one case task and one event for the repeated call');

-- Another agent with the same call is its own task; an explicit key has its own namespace and keeps its 317 meaning.
SELECT pg_temp.a319_tool('create_task', 'director', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t9 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s","idempotency_key":"k-319-1"}', pg_temp.a319_id(601))) AS a319_k1 \gset
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Совсем другая задача","lead_id":"%s","idempotency_key":"k-319-1"}', pg_temp.a319_id(601))) AS a319_k1b \gset
SELECT pg_temp.a319_assert(
  (:'a319_t9'::JSONB) ->> 'deduplicated' = 'false' AND (:'a319_t9'::JSONB) ->> 'task_id' <> (:'a319_t1'::JSONB) ->> 'task_id'
  AND (:'a319_k1'::JSONB) ->> 'deduplicated' = 'false' AND (:'a319_k1'::JSONB) ->> 'task_id' <> (:'a319_t1'::JSONB) ->> 'task_id'
  AND (:'a319_k1b'::JSONB) = ((:'a319_k1'::JSONB) || '{"deduplicated":true}'::JSONB)
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE agent_key = 'sales' AND dedupe_key = 'create_task:k-319-1')
  AND (SELECT count(*) = 8 + 1 FROM platform_private.ai_agent_dedupe WHERE organization_id = pg_temp.a319_id(1) AND agent_key = 'sales'
      AND dedupe_key LIKE 'create\_task\_auto:%'),
  'create_task: the derived key is per agent; the model key wins over a different call (317) and does not meet the derived namespace');

-- Outside the 10-minute window the same call is a new task; a refused call is not cached.
UPDATE platform_private.ai_agent_dedupe SET created_at = clock_timestamp() - INTERVAL '11 minutes'
  WHERE agent_key = 'sales' AND dedupe_key LIKE 'create\_task\_auto:%' AND (result ->> 'task_id')::UUID = ((:'a319_t1'::JSONB) ->> 'task_id')::UUID;
SELECT pg_temp.a319_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_t10 \gset
SELECT count(*) AS a319_dedupe_before FROM platform_private.ai_agent_dedupe \gset
SELECT pg_temp.a319_assert(
  (:'a319_t10'::JSONB) ->> 'deduplicated' = 'false' AND (:'a319_t10'::JSONB) ->> 'task_id' <> (:'a319_t1'::JSONB) ->> 'task_id'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', format('{"title":"Чужое дело","case_id":"%s"}', pg_temp.a319_id(703)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', format('{"title":"Чужое дело","case_id":"%s"}', pg_temp.a319_id(703)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', '{"title":"Плохая дата","due_on":"2026-02-31"}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', '{"title":"Плохая дата","due_on":"2026-02-31"}')) = '22023'
  AND (SELECT count(*) = :a319_dedupe_before FROM platform_private.ai_agent_dedupe),
  'create_task: after 11 minutes the same call is a new task; a refused call (not found, bad date) is refused again and stores nothing');

-- add_note.
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00"}', pg_temp.a319_id(601))) AS a319_n1 \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00"}', pg_temp.a319_id(601))) AS a319_n1b \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"  КЛИЕНТ просил\nперезвонить   после 18:00 "}', pg_temp.a319_id(601))) AS a319_n1c \gset
SELECT pg_temp.a319_assert(
  (:'a319_n1'::JSONB) ? 'note_id' AND (:'a319_n1b'::JSONB) = (:'a319_n1'::JSONB) AND (:'a319_n1c'::JSONB) = (:'a319_n1'::JSONB)
  AND (SELECT count(*) = :a319_notes0 + 1 FROM platform.case_notes WHERE body LIKE '[ИИ%')
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE organization_id = pg_temp.a319_id(1) AND agent_key = 'sales'
      AND dedupe_key LIKE 'add\_note\_auto:%' AND char_length(dedupe_key) = 14 + 64),
  'add_note, no key: the same note (whitespace and case apart) on the same lead is one note and the first answer: ' || :'a319_n1');
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Другой текст заметки"}', pg_temp.a319_id(601))) AS a319_n2 \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"case_id":"%s","body":"Клиент просил перезвонить после 18:00"}', pg_temp.a319_id(701))) AS a319_n3 \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00"}', pg_temp.a319_id(602))) AS a319_n4 \gset
SELECT pg_temp.a319_tool('add_note', 'director', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00"}', pg_temp.a319_id(601))) AS a319_n5 \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00","idempotency_key":"k-319-n"}', pg_temp.a319_id(601))) AS a319_n6 \gset
SELECT pg_temp.a319_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Другой текст при том же ключе","idempotency_key":"k-319-n"}', pg_temp.a319_id(601))) AS a319_n6b \gset
SELECT pg_temp.a319_assert(
  (SELECT count(DISTINCT v ->> 'note_id') = 6 FROM unnest(ARRAY[:'a319_n1'::JSONB, :'a319_n2'::JSONB, :'a319_n3'::JSONB, :'a319_n4'::JSONB,
    :'a319_n5'::JSONB, :'a319_n6'::JSONB]) v)
  AND (:'a319_n6b'::JSONB) = (:'a319_n6'::JSONB)
  AND (SELECT count(*) = :a319_notes0 + 6 FROM platform.case_notes WHERE body LIKE '[ИИ%')
  AND pg_temp.a319_err(pg_temp.a319_tool('add_note', 'sales', '{"body":"x"}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('add_note', 'sales', format('{"case_id":"%s","body":"Чужое дело"}', pg_temp.a319_id(703)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('add_note', 'sales', format('{"case_id":"%s","body":"Чужое дело"}', pg_temp.a319_id(703)))) = 'P0002',
  'add_note: another text, a case instead of the lead, another lead, another agent are NEW notes; the model key still wins; refused calls store nothing');

-- post_digest: no model key at all; the derived key is the only dedupe.
CREATE FUNCTION pg_temp.a319_digest(p_key TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_tool('post_digest', p_key, p_args)
$$;
SELECT count(*) AS a319_w_before_d FROM platform.audit_events WHERE action = 'ai.agent.tool.write' \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d1 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d1b \gset
SELECT pg_temp.a319_digest('director', '{"period_to":"2026-10-18","period_from":"2026-10-12","metrics":{"series":[],"kpis":[{"value":2,"label":"Договоры"}]},"body_md":"## ПРОДАЖИ\n-  договоров:   2 ","title":"итоги  недели","kind":"weekly"}') AS a319_d1c \gset
SELECT pg_temp.a319_assert(
  (:'a319_d1'::JSONB) ? 'digest_id' AND (:'a319_d1b'::JSONB) = (:'a319_d1'::JSONB) AND (:'a319_d1c'::JSONB) = (:'a319_d1'::JSONB)
  AND (SELECT count(*) = :a319_digests0 + 1 FROM platform_private.ai_agent_digests)
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE organization_id = pg_temp.a319_id(1) AND agent_key = 'director'
      AND dedupe_key LIKE 'post\_digest\_auto:%' AND char_length(dedupe_key) = 17 + 64)
  AND (SELECT count(*) = :a319_w_before_d + 1 FROM platform.audit_events WHERE action = 'ai.agent.tool.write'),
  'post_digest: the same report (key order, whitespace and case apart) is one digest, one journal row and the first answer: ' || :'a319_d1');
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":3}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d2 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-19"}') AS a319_d3 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"daily","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d4 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели 2","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d5 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 3","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d6 \gset
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d7 \gset
SELECT pg_temp.a319_digest('sales', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d8 \gset
SELECT pg_temp.a319_assert(
  (SELECT count(DISTINCT v ->> 'digest_id') = 8 FROM unnest(ARRAY[:'a319_d1'::JSONB, :'a319_d2'::JSONB, :'a319_d3'::JSONB, :'a319_d4'::JSONB,
    :'a319_d5'::JSONB, :'a319_d6'::JSONB, :'a319_d7'::JSONB, :'a319_d8'::JSONB]) v)
  AND (SELECT count(*) = :a319_digests0 + 8 FROM platform_private.ai_agent_digests),
  'post_digest: another metrics value, period, kind, title, text, no metrics or another agent is a NEW report');
UPDATE platform_private.ai_agent_dedupe SET created_at = clock_timestamp() - INTERVAL '11 minutes'
  WHERE agent_key = 'director' AND dedupe_key LIKE 'post\_digest\_auto:%' AND (result ->> 'digest_id')::UUID = ((:'a319_d1'::JSONB) ->> 'digest_id')::UUID;
SELECT pg_temp.a319_digest('director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a319_d9 \gset
SELECT count(*) AS a319_dedupe_before2 FROM platform_private.ai_agent_dedupe \gset
SELECT pg_temp.a319_assert(
  (:'a319_d9'::JSONB) ->> 'digest_id' <> (:'a319_d1'::JSONB) ->> 'digest_id'
  AND pg_temp.a319_err(pg_temp.a319_digest('director', '{"kind":"note","title":"t","body_md":"b","period_from":"2026-10-19","period_to":"2026-10-12"}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_digest('director', '{"kind":"note","title":"t","body_md":"b","period_from":"2026-10-19","period_to":"2026-10-12"}')) = '22023'
  AND pg_temp.a319_msg(pg_temp.a319_digest('director', format('{"kind":"note","title":"t","body_md":"b","metrics":{"x":"%s"}}', repeat('z', 16400)))) = 'too_large'
  AND (SELECT count(*) = :a319_dedupe_before2 FROM platform_private.ai_agent_dedupe),
  'post_digest: after 11 minutes a new report; a reversed period and an over-size metrics object are refused and cache nothing');

-- The tools stay closed to staff and anon, and the arguments are still checked before the key is derived.
SELECT pg_temp.a319_assert(
  pg_temp.a319_err(pg_temp.a319_staff(1, format('SELECT platform.ai_agent_tool_create_task_v1(%L, ''sales'', ''{"title":"x"}''::jsonb)', pg_temp.a319_id(1)))) = '42501'
  AND pg_temp.a319_err(pg_temp.a319_anon(format('SELECT platform.ai_agent_tool_post_digest_v1(%L, ''sales'', ''{"kind":"note","title":"x","body_md":"y"}''::jsonb)', pg_temp.a319_id(1)))) = '42501'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', '{"title":""}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('create_task', 'sales', '{"title":"t","priority":"urgent"}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('post_digest', 'sales', '{"kind":"monthly","title":"t","body_md":"b"}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('add_note', 'sales', '{"body":"b","extra":1}')) = '22023',
  'the write tools stay closed to staff and anon (42501); bad arguments are still 22023');

-- The lock on the key is held until the end of the transaction (two equal calls queue up): after the helper returns,
-- one more advisory lock is held by this session.
SELECT count(*) AS a319_locks0 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() \gset
SELECT platform_private.ai_agent_dedupe_once(pg_temp.a319_id(1), 'sales', 'lock-probe-319') IS NULL AS a319_once_empty \gset
SELECT pg_temp.a319_assert(:'a319_once_empty'::BOOLEAN
  AND (SELECT count(*) = :a319_locks0 + 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()),
  'dedupe_once: an empty answer and the advisory lock of the key kept until the end of the transaction');

-- ---------------------------------------------------------------------------
-- 3. (b) The audit of the six sensitive reads is written by the read itself.
-- ---------------------------------------------------------------------------
SELECT count(*) AS a319_actions0 FROM platform_private.ai_agent_actions \gset
SELECT count(*) AS a319_read_audit0 FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read') \gset
SELECT pg_temp.a319_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a319_id(501))) AS a319_r1 \gset
SELECT pg_temp.a319_tool('get_client_card', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_r2 \gset
SELECT pg_temp.a319_tool('get_client_card', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(701))) AS a319_r3 \gset
SELECT pg_temp.a319_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_r4 \gset
SELECT pg_temp.a319_tool('get_case', 'sales', format('{"case_id":"%s","include":["documents"]}', pg_temp.a319_id(701))) AS a319_r5 \gset
SELECT pg_temp.a319_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a319_c1')) AS a319_r6 \gset
SELECT pg_temp.a319_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(701))) AS a319_r7 \gset
SELECT pg_temp.a319_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a319_id(821))) AS a319_r8 \gset
SELECT pg_temp.a319_tool('get_document_file', 'sales', format('{"slot_id":"%s"}', pg_temp.a319_id(811))) AS a319_r9 \gset
SELECT pg_temp.a319_assert(
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY[:'a319_r1'::JSONB, :'a319_r2'::JSONB, :'a319_r3'::JSONB, :'a319_r4'::JSONB, :'a319_r5'::JSONB,
    :'a319_r6'::JSONB, :'a319_r7'::JSONB, :'a319_r8'::JSONB, :'a319_r9'::JSONB]) v WHERE v ? 'error'),
  'the nine reads answer: ' || :'a319_r1' || :'a319_r8');
SELECT pg_temp.a319_assert(
  (:'a319_r1'::JSONB) -> 'client' ->> 'id' = pg_temp.a319_id(501)::TEXT AND (:'a319_r4'::JSONB) -> 'lead' ->> 'id' = pg_temp.a319_id(601)::TEXT
  AND (:'a319_r5'::JSONB) -> 'case' ->> 'id' = pg_temp.a319_id(701)::TEXT AND jsonb_array_length((:'a319_r6'::JSONB) -> 'messages') = 2
  AND jsonb_array_length((:'a319_r7'::JSONB) -> 'messages') = 2 AND (:'a319_r8'::JSONB) ? 'token' AND (:'a319_r9'::JSONB) ? 'token',
  'the tool answers keep their shape (client, lead, case, two chat messages, two case chat messages, a file token)');
SELECT pg_temp.a319_assert(
  (SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) - :a319_read_audit0 = 9
  AND (SELECT count(*) = 7 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read')
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.action = 'ai.agent.document.read' AND e.resource_type = 'student_case'
      AND e.resource_id = pg_temp.a319_id(701) AND e.reason = 'ИИ-агент открыл документ студента')
  AND (SELECT jsonb_agg(DISTINCT e.resource_type ORDER BY e.resource_type) = '["client","communication_conversation","lead","student_case"]'::JSONB
      FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read')
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read' AND e.resource_type = 'client' AND e.resource_id = pg_temp.a319_id(501))
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read' AND e.resource_type = 'lead' AND e.resource_id = pg_temp.a319_id(601))
  AND (SELECT count(*) = 3 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read' AND e.resource_type = 'student_case' AND e.resource_id = pg_temp.a319_id(701))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read' AND e.resource_type = 'communication_conversation' AND e.resource_id = :'a319_c1'::UUID)
  AND (SELECT bool_and(e.actor_kind = 'service' AND e.actor_principal = 'ai-agent:sales' AND e.actor_profile_id IS NULL AND e.actor_membership_id IS NULL
        AND e.organization_id = pg_temp.a319_id(1) AND e.after_state ->> 'agentKey' = 'sales' AND e.after_state ->> 'tool' IS NOT NULL
        AND (SELECT count(*) = 2 FROM jsonb_object_keys(e.after_state)) AND e.reason = ANY (ARRAY['ИИ-агент прочитал данные клиента', 'ИИ-агент открыл документ студента']))
      FROM platform.audit_events e WHERE e.action IN ('ai.agent.tool.read', 'ai.agent.document.read'))
  AND (SELECT count(*) = :a319_actions0 FROM platform_private.ai_agent_actions),
  'the six sensitive reads write their own journal row (nine for the nine calls: card x3, lead, case, chat, case chat, two document reads), object by the call, '
  'actor service ai-agent:sales, after_state = agent + tool; the action log is not involved');

-- Other reads write nothing; a refused read writes nothing.
SELECT pg_temp.a319_tool('search_clients', 'sales', '{"query":"Один"}') AS a319_o1 \gset
SELECT pg_temp.a319_tool('list_leads', 'sales', '{}') AS a319_o2 \gset
SELECT pg_temp.a319_tool('get_my_settings', 'sales', '{}') AS a319_o3 \gset
SELECT pg_temp.a319_tool('list_conversations', 'sales', '{"filter":"all"}') AS a319_o4 \gset
SELECT pg_temp.a319_assert(
  NOT ((:'a319_o1'::JSONB) ? 'error' OR (:'a319_o2'::JSONB) ? 'error' OR (:'a319_o3'::JSONB) ? 'error' OR (:'a319_o4'::JSONB) ? 'error')
  AND pg_temp.a319_err(pg_temp.a319_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(9999)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(603)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_case', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(703)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a319_id(503)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_client_card', 'sales', '{}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', pg_temp.a319_id(9999)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(703)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a319_id(9999)))) = 'P0002'
  AND pg_temp.a319_err(pg_temp.a319_tool('get_document_file', 'sales', '{}')) = '22023'
  AND (SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) - :a319_read_audit0 = 9,
  'the other reads and the refused reads (not found, another organization, bad arguments) write no read journal row');

-- Atomicity: when the journal insert fails, the read fails and nothing is served (no file link is created either).
SELECT count(*) AS a319_grants0 FROM platform_private.ai_agent_file_grants \gset
CREATE FUNCTION pg_temp.a319_block_read_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action IN ('ai.agent.tool.read', 'ai.agent.document.read') THEN
    RAISE EXCEPTION 'a319_journal_down';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER a319_block_read_audit BEFORE INSERT ON platform.audit_events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.a319_block_read_audit();
SELECT pg_temp.a319_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a319_id(501))) AS a319_f1 \gset
SELECT pg_temp.a319_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_f2 \gset
SELECT pg_temp.a319_tool('get_case', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(701))) AS a319_f3 \gset
SELECT pg_temp.a319_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a319_c1')) AS a319_f4 \gset
SELECT pg_temp.a319_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a319_id(701))) AS a319_f5 \gset
SELECT pg_temp.a319_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a319_id(821))) AS a319_f6 \gset
SELECT pg_temp.a319_assert(
  (SELECT bool_and(v ->> 'message' = 'a319_journal_down' AND v ->> 'error' = 'P0001' AND NOT (v ? 'token' OR v ? 'client' OR v ? 'lead' OR v ? 'case' OR v ? 'messages'))
   FROM unnest(ARRAY[:'a319_f1'::JSONB, :'a319_f2'::JSONB, :'a319_f3'::JSONB, :'a319_f4'::JSONB, :'a319_f5'::JSONB, :'a319_f6'::JSONB]) v)
  AND (SELECT count(*) = :a319_grants0 FROM platform_private.ai_agent_file_grants)
  AND (SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) - :a319_read_audit0 = 9
  AND pg_temp.a319_tool('search_clients', 'sales', '{"query":"Один"}') ? 'items',
  'a failing journal insert fails every one of the six reads with no data and no file link; reads that are not audited are unaffected');
-- The action log does not depend on the read journal any more: with the journal down it still writes its row.
SELECT pg_temp.a319_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', ''get_lead'', %L::jsonb, ''ok'', NULL, 4', pg_temp.a319_id(1),
  format('{"lead_id":"%s"}', pg_temp.a319_id(601)))) AS a319_l0 \gset
SELECT pg_temp.a319_assert((:'a319_l0'::JSONB) ? 'actionId' AND (SELECT count(*) = :a319_actions0 + 1 FROM platform_private.ai_agent_actions),
  'the action log writes its row while the read journal is down: ' || :'a319_l0');
DROP TRIGGER a319_block_read_audit ON platform.audit_events;
SELECT pg_temp.a319_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_f7 \gset
SELECT pg_temp.a319_assert(NOT ((:'a319_f7'::JSONB) ? 'error')
  AND (SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) - :a319_read_audit0 = 10,
  'with the journal back the read works and writes its row');

-- The action log: a row for every call, no read journal row and no link for the six tools (the reads wrote theirs).
CREATE FUNCTION pg_temp.a319_log(p_tool TEXT, p_args TEXT, p_status TEXT DEFAULT 'ok') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a319_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', %L, %L::jsonb, %L, NULL, 4', pg_temp.a319_id(1), p_tool, p_args, p_status))
$$;
SELECT count(*) AS a319_read_audit1 FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read') \gset
SELECT count(*) AS a319_actions1 FROM platform_private.ai_agent_actions \gset
SELECT pg_temp.a319_log('get_client_card', format('{"client_id":"%s"}', pg_temp.a319_id(501))) AS a319_g1 \gset
SELECT pg_temp.a319_log('get_lead', format('{"lead_id":"%s"}', pg_temp.a319_id(601))) AS a319_g2 \gset
SELECT pg_temp.a319_log('get_case', format('{"case_id":"%s","include":["documents"]}', pg_temp.a319_id(701))) AS a319_g3 \gset
SELECT pg_temp.a319_log('get_conversation', format('{"conversation_id":"%s"}', :'a319_c1')) AS a319_g4 \gset
SELECT pg_temp.a319_log('get_case_chat', format('{"case_id":"%s"}', pg_temp.a319_id(701))) AS a319_g5 \gset
SELECT pg_temp.a319_log('get_document_file', format('{"slot_id":"%s"}', pg_temp.a319_id(811))) AS a319_g6 \gset
SELECT pg_temp.a319_log('search_clients', '{"query":"аб"}') AS a319_g7 \gset
SELECT pg_temp.a319_log('get_case', format('{"case_id":"%s"}', pg_temp.a319_id(701)), 'error') AS a319_g8 \gset
SELECT pg_temp.a319_assert(
  (SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) = :a319_read_audit1
  AND (SELECT count(*) FROM platform_private.ai_agent_actions) - :a319_actions1 = 8
  AND (SELECT bool_and(x.audit_event_id IS NULL) FROM platform_private.ai_agent_actions x WHERE x.id > (SELECT max(id) - 8 FROM platform_private.ai_agent_actions))
  AND (:'a319_g1'::JSONB) ? 'actionId' AND (:'a319_g6'::JSONB) ? 'actionId'
  AND pg_temp.a319_err(pg_temp.a319_log('no_such_tool', '{}')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_log('get_lead', '{}', 'weird')) = '22023'
  AND pg_temp.a319_err(pg_temp.a319_staff(1, format('SELECT platform.ai_agent_mcp_log_v1(%L, ''sales'', ''get_lead'', ''{}''::jsonb, ''ok'', NULL, 1)', pg_temp.a319_id(1)))) = '42501',
  'the action log: eight rows for eight calls, no read journal row and no audit link, the checks and the closed grants as before');

\echo A319_AI_AGENTS_HARDENING_SUITE_PASSED
ROLLBACK;
