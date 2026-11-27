\set ON_ERROR_STOP on
-- Boundary suite for migration 379: «ИИ-агенты», два предохранителя базы данных (docs/PLAN_CHANGES.md, ночь 28.11.2026,
-- «мозг компании, досье и предохранители»).
-- Runs on the real chain right after 379 inside one transaction that is rolled back, with its own synthetic organization
-- and member; WhatsApp conversations come through the real WAHA projection chain. No provider, no Claude / Anthropic
-- call, no real person, no production action.
--
-- Proves:
--  1. posture: the run table has the two target columns and the CHECK that keeps them to one target of a run that has
--     send authority; run_reserve is ONE function with eleven arguments for service_role only; a nine-argument call
--     (old callers) still works; a bad target (both, without a code, unknown conversation, unknown case) is refused;
--  2. (a) a disabled agent has no Auto: switching the agent off in the same patch or alone clears auto_send (and the
--     change is journalled as autoSend), a patch that turns Auto on for a disabled agent changes nothing, enabling and
--     Auto in one patch works, an agent that is on keeps its Auto;
--  3. (b) the send authority code is bound to a target: no target on the run - the first right use binds its chat, the
--     same code to another chat makes a draft (not an error) and leaves the binding; a target named at the reservation is
--     respected (the same chat sends, another chat makes a draft); a case target does not send to a chat; a wrong code,
--     no code and a finished run behave as before; the daily rules of the send (receive-only, staff active) are unchanged.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A379_AI_AGENTS_SAFEGUARDS_SUITE_START

CREATE FUNCTION pg_temp.a379_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('37900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a379_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A379: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a379_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a379_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a379_claims TO authenticated;
CREATE FUNCTION pg_temp.a379_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a379_call('authenticated', (SELECT claims FROM a379_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a379_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a379_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a379_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a379_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture: one organization, one system admin (the intake owner and the sender of direct messages).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name, status) VALUES (pg_temp.a379_id(1), 'A379 Fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.a379_id(101), 'a379-1@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.a379_id(201), pg_temp.a379_id(101), 'A379 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  VALUES (pg_temp.a379_id(301), pg_temp.a379_id(1), pg_temp.a379_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1),
    TIMESTAMPTZ '2026-01-02 00:00:00+00');
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.a379_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.a379_id(401), pg_temp.a379_id(1), 'organization', pg_temp.a379_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_id(401), 1, 1, TRUE, 'system', 'A379 synthetic scope', pg_temp.a379_id(601));
INSERT INTO a379_claims(actor, claims)
  SELECT 1, (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a379_id(101),
    'claims', jsonb_build_object('sub', pg_temp.a379_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT pg_temp.a379_assert((SELECT claims::JSONB ? 'platform_membership_id' FROM a379_claims WHERE actor = 1), 'the admin got real hook claims');

-- A student case (owner, triggers off) for the case target.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, next_action, created_at, updated_at)
VALUES (pg_temp.a379_id(701), pg_temp.a379_id(1), NULL, pg_temp.a379_id(301), NULL, 'a379-case-1',
  'A379 Клиент Один', 'Malaysia', 'master', 'MY', '2027-02', 'intake', 'pending', NULL, NULL,
  pg_temp.a379_id(401), 1, 'MY', 'new', NULL, clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour');
SET LOCAL session_replication_role = origin;

-- WhatsApp conversations through the REAL WAHA projection chain (the intake owner is the admin).
CREATE TEMP TABLE a379_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
GRANT SELECT ON a379_clock TO authenticated, service_role;
CREATE FUNCTION pg_temp.a379_ago(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 - p_seconds * INTERVAL '1 second' FROM a379_clock
$$;
CREATE SEQUENCE pg_temp.a379_seq;
CREATE FUNCTION pg_temp.a379_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a379_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.a379_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.a379_id(20000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a379-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:a379:' || n, lpad(to_hex(3790000 + n), 64, '0'), pg_temp.a379_id(25000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a379-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.a379_id(30000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a379', pg_temp.a379_id(30000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a379_id(301), pg_temp.a379_id(30000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a379_id(30000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'A379: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
-- A fresh chat with one client message: returns the conversation id.
CREATE FUNCTION pg_temp.a379_chat(p_chat INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996790' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.a379_ago(600);
  wid TEXT := 'false_' || chat || '_A379' || lpad(nextval('pg_temp.a379_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.a379_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', 'Сообщение клиента ' || p_chat), at);
  RETURN (SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
    WHERE binding.organization_id = pg_temp.a379_id(1) AND binding.normalized_chat_id = chat);
END
$$;
SELECT pg_temp.a379_chat(1) AS a379_chat_a, pg_temp.a379_chat(2) AS a379_chat_b \gset
SELECT pg_temp.a379_assert(:'a379_chat_a' IS NOT NULL AND :'a379_chat_b' IS NOT NULL AND :'a379_chat_a' <> :'a379_chat_b',
  'fixture: two WhatsApp conversations through the real projection chain');

-- The connected WhatsApp session (health row): direct sending is possible.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.waha_session_health (organization_id, waha_session_name, status, observed_at)
  VALUES (pg_temp.a379_id(1), 'crm_primary', 'WORKING', clock_timestamp());
SET LOCAL session_replication_role = origin;

-- The first read creates the agents of the organization.
SELECT pg_temp.a379_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a379_id(1))) AS a379_list \gset
SELECT pg_temp.a379_assert(jsonb_array_length((:'a379_list'::JSONB) -> 'agents') = 7, 'the first read seeds 7 agents');

CREATE FUNCTION pg_temp.a379_upd(p_key TEXT, p_patch TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a379_staff(1, format('SELECT platform.ai_agents_update_v1(%L, %L, %s, %L::jsonb, %L)', pg_temp.a379_id(1), p_key,
    (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a379_id(1) AND key = p_key),
    p_patch, pg_temp.a379_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a379_flags(p_key TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT enabled::TEXT || '/' || auto_send::TEXT FROM platform_private.ai_agents WHERE organization_id = pg_temp.a379_id(1) AND key = p_key
$$;
CREATE FUNCTION pg_temp.a379_rt(p_fn TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a379_svc(format('SELECT platform.%s(%s)', p_fn, p_args))
$$;
CREATE FUNCTION pg_temp.a379_send(p_key TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a379_svc(format('SELECT platform.ai_agent_tool_send_message_v1(%L, %L, %L::jsonb)', pg_temp.a379_id(1), p_key, p_args))
$$;
CREATE FUNCTION pg_temp.a379_sha(p_code TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a379_assert(
  (SELECT count(*) = 2 FROM information_schema.columns c WHERE c.table_schema = 'platform_private' AND c.table_name = 'ai_agent_runs'
      AND c.column_name IN ('authority_conversation_id', 'authority_case_id') AND c.is_nullable = 'YES' AND c.data_type = 'uuid')
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'ai_agent_runtime_run_reserve_v1'
      AND p.pronargs = 11 AND p.pronargdefaults = 2 AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 17 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_runtime\_%'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 9 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agents\_%\_v1'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 24 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%'
      AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  '379 posture: two nullable uuid target columns, ONE eleven-argument reserve for service_role only, the family counts unchanged (9 staff, 17 runtime, 24 tools)');

-- ---------------------------------------------------------------------------
-- 2. (a) A disabled agent has no Auto.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'false/false', 'a fresh agent is off without Auto');
-- Enabling and Auto in ONE patch works.
SELECT pg_temp.a379_upd('sales', '{"enabled":true,"autoSend":true}', 2001) AS a379_u1 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'true/true' AND (:'a379_u1'::JSONB) -> 'changed' ? 'autoSend',
  'enabled + Auto in one patch: both on');
-- A change that leaves the agent on keeps its Auto.
SELECT pg_temp.a379_upd('sales', '{"triggerWhatsappInbound":true}', 2002) AS a379_u2 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'true/true', 'another change while on: Auto stays');
-- Switching the agent off clears Auto in the same write and says so.
SELECT pg_temp.a379_upd('sales', '{"enabled":false}', 2003) AS a379_u3 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'false/false'
  AND (:'a379_u3'::JSONB) -> 'changed' ? 'enabled' AND (:'a379_u3'::JSONB) -> 'changed' ? 'autoSend'
  AND (SELECT e.after_state ->> 'autoSend' = 'false' AND e.before_state ->> 'autoSend' = 'true' FROM platform.audit_events e
      WHERE e.request_id = pg_temp.a379_id(2003) AND e.action = 'ai.agent.config.change'),
  'switching off clears Auto and the audit row records autoSend true -> false');
-- Turning Auto on for a disabled agent changes nothing (and is not an error).
SELECT pg_temp.a379_upd('sales', '{"autoSend":true}', 2004) AS a379_u4 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'false/false' AND (:'a379_u4'::JSONB) -> 'changed' = '[]'::JSONB
  AND (:'a379_u4'::JSONB) ->> 'error' IS NULL,
  'Auto on a disabled agent: nothing changes');
SELECT pg_temp.a379_upd('sales', '{"enabled":false,"autoSend":true}', 2005) AS a379_u5 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'false/false', 'off and Auto in one patch: still no Auto');
-- Switching on later does not bring Auto back.
SELECT pg_temp.a379_upd('sales', '{"enabled":true}', 2006) AS a379_u6 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'true/false', 'enabled again: Auto stays off until someone turns it on');
-- A directly stored leftover (the state 379 cleans once) is cleared by the next write that switches the agent off.
SET LOCAL session_replication_role = replica;
UPDATE platform_private.ai_agents SET enabled = FALSE, auto_send = TRUE WHERE organization_id = pg_temp.a379_id(1) AND key = 'curator-cn';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a379_upd('curator-cn', '{"model":"claude-haiku-5-5"}', 2007) AS a379_u7 \gset
SELECT pg_temp.a379_assert(pg_temp.a379_flags('curator-cn') = 'false/false',
  'a disabled agent with a stored Auto: the next settings write clears it');

-- ---------------------------------------------------------------------------
-- 3. (b) The send authority code belongs to a target.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a379_assert(pg_temp.a379_flags('sales') = 'true/false', 'sales is on, Auto off for the authority scenarios');

-- 3.1 Reservation checks: positional nine-argument call still works; bad targets are refused.
SELECT pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL',
  pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('CODE-379-A'))) AS a379_r1 \gset
SELECT (:'a379_r1'::JSONB ->> 'runId')::UUID AS a379_run1 \gset
SELECT pg_temp.a379_assert((:'a379_r1'::JSONB ->> 'reserved') = 'true'
  AND (SELECT r.send_authority AND r.authority_conversation_id IS NULL AND r.authority_case_id IS NULL
      FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run1'),
  'the old nine-argument reservation works and leaves the target empty');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a379_run1'::UUID;
SELECT pg_temp.a379_assert(
  pg_temp.a379_err(pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, %L, %L',
    pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('X'), :'a379_chat_a', pg_temp.a379_id(701)))) = '22023'
  AND pg_temp.a379_err(pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, NULL, NULL, NULL, NULL, %L, NULL',
    pg_temp.a379_id(1), pg_temp.a379_id(301), :'a379_chat_a'))) = '22023'
  AND pg_temp.a379_err(pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, %L, NULL',
    pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('X'), pg_temp.a379_id(9999)))) = '22023'
  AND pg_temp.a379_err(pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, NULL, %L',
    pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('X'), pg_temp.a379_id(9998)))) = '22023'
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_runs WHERE agent_key = 'sales'),
  'bad targets are refused (22023) and write no run: both targets, a target without a code, an unknown conversation, an unknown case');
-- The table keeps one target and only for a run with authority.
SELECT pg_temp.a379_assert(
  (SELECT count(*) = 0 FROM (
    SELECT 1 FROM platform_private.ai_agent_runs WHERE FALSE) x)
  AND (SELECT count(*) = 2 FROM pg_constraint c WHERE c.conrelid = 'platform_private.ai_agent_runs'::REGCLASS
      AND c.conname IN ('ai_agent_runs_authority_check', 'ai_agent_runs_authority_target_check')),
  'the run table carries both authority constraints');
DO $a379_check$
BEGIN
  BEGIN
    UPDATE platform_private.ai_agent_runs SET authority_conversation_id = pg_temp.a379_id(1), authority_case_id = pg_temp.a379_id(2)
      WHERE id = (SELECT id FROM platform_private.ai_agent_runs LIMIT 1);
    RAISE EXCEPTION 'A379: two targets were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO platform_private.ai_agent_runs (organization_id, agent_key, trigger_kind, send_authority, authority_case_id)
      VALUES (pg_temp.a379_id(1), 'sales', 'command', FALSE, pg_temp.a379_id(701));
    RAISE EXCEPTION 'A379: a target without send authority was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$a379_check$;

-- 3.2 No target on the run: the first right use binds its chat; the same code to another chat is a draft.
SELECT pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL',
  pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('CODE-379-B'))) AS a379_r2 \gset
SELECT (:'a379_r2'::JSONB ->> 'runId')::UUID AS a379_run2 \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Без кода"}', :'a379_chat_a')) AS a379_s0 \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Неверный код","authority_code":"WRONG"}', :'a379_chat_a')) AS a379_s1 \gset
SELECT pg_temp.a379_assert((:'a379_s0'::JSONB) ->> 'status' = 'draft_created' AND (:'a379_s1'::JSONB) ->> 'status' = 'draft_created'
  AND (SELECT r.authority_conversation_id IS NULL AND r.authority_case_id IS NULL FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run2'),
  'no code and a wrong code: drafts as before, and they bind nothing');
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Чат А по приказу","authority_code":"CODE-379-B"}', :'a379_chat_a')) AS a379_s2 \gset
SELECT pg_temp.a379_assert((:'a379_s2'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a379_s2'::JSONB) ->> 'mode' = 'direct'
  AND (:'a379_s2'::JSONB) ->> 'sender_membership_id' = pg_temp.a379_id(301)::TEXT
  AND (SELECT r.authority_conversation_id = :'a379_chat_a'::UUID AND r.authority_case_id IS NULL
      FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run2')
  AND (SELECT d.status = 'approved' AND d.sent_by_agent AND d.run_id = :'a379_run2' AND d.conversation_id = :'a379_chat_a'::UUID
      FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a379_s2'::JSONB) ->> 'draft_id')::UUID),
  'the first right use sends and binds its chat to the run: ' || :'a379_s2');
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Чат Б тем же кодом","authority_code":"CODE-379-B"}', :'a379_chat_b')) AS a379_s3 \gset
SELECT pg_temp.a379_assert((:'a379_s3'::JSONB) ->> 'status' = 'draft_created' AND (:'a379_s3'::JSONB) ->> 'mode' = 'draft'
  AND (:'a379_s3'::JSONB) ->> 'error' IS NULL
  AND (SELECT d.status = 'pending' AND NOT d.sent_by_agent AND d.conversation_id = :'a379_chat_b'::UUID AND d.failure_code IS NULL
      FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a379_s3'::JSONB) ->> 'draft_id')::UUID)
  AND (SELECT r.authority_conversation_id = :'a379_chat_a'::UUID FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run2'),
  'the same code to another chat is a plain draft (no error), the binding stays on the first chat: ' || :'a379_s3');
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Ещё раз чат А"}', :'a379_chat_a') ::TEXT) AS a379_s4a \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Ещё раз чат А по приказу","authority_code":"CODE-379-B"}', :'a379_chat_a')) AS a379_s4 \gset
SELECT pg_temp.a379_assert((:'a379_s4a'::JSONB) ->> 'status' = 'draft_created' AND (:'a379_s4'::JSONB) ->> 'status' = 'needs_dispatch',
  'the bound chat keeps sending with the code; without the code it is a draft');
-- The cap of three pending drafts per chat and agent is not what this suite measures: clear the pending ones.
SET LOCAL session_replication_role = replica;
DELETE FROM platform_private.ai_agent_drafts WHERE status = 'pending';
SET LOCAL session_replication_role = origin;
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a379_run2'::UUID;
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"После запуска","authority_code":"CODE-379-B"}', :'a379_chat_a')) AS a379_s5 \gset
SELECT pg_temp.a379_assert((:'a379_s5'::JSONB) ->> 'status' = 'draft_created', 'a finished run: the code is just a wrong code (as before)');

-- 3.3 A target named at the reservation is respected.
SELECT pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, %L, NULL',
  pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('CODE-379-C'), :'a379_chat_b')) AS a379_r3 \gset
SELECT (:'a379_r3'::JSONB ->> 'runId')::UUID AS a379_run3 \gset
SELECT pg_temp.a379_assert((:'a379_r3'::JSONB ->> 'reserved') = 'true'
  AND (SELECT r.authority_conversation_id = :'a379_chat_b'::UUID AND r.authority_case_id IS NULL AND r.send_authority
      FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run3'),
  'the target is written at the reservation');
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Чат А: цель — Б","authority_code":"CODE-379-C"}', :'a379_chat_a')) AS a379_s6 \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Чат Б: цель — Б","authority_code":"CODE-379-C"}', :'a379_chat_b')) AS a379_s7 \gset
SELECT pg_temp.a379_assert((:'a379_s6'::JSONB) ->> 'status' = 'draft_created' AND (:'a379_s7'::JSONB) ->> 'status' = 'needs_dispatch'
  AND (SELECT r.authority_conversation_id = :'a379_chat_b'::UUID FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run3'),
  'a named target: another chat gets a draft, the named chat sends; the target is never rebound');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a379_run3'::UUID;

-- 3.4 A case target never sends to a chat.
SELECT pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, NULL, %L',
  pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('CODE-379-D'), pg_temp.a379_id(701))) AS a379_r4 \gset
SELECT (:'a379_r4'::JSONB ->> 'runId')::UUID AS a379_run4 \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Цель — дело, пишем в чат","authority_code":"CODE-379-D"}', :'a379_chat_a')) AS a379_s8 \gset
SELECT pg_temp.a379_assert((:'a379_s8'::JSONB) ->> 'status' = 'draft_created'
  AND (SELECT r.authority_case_id = pg_temp.a379_id(701) AND r.authority_conversation_id IS NULL FROM platform_private.ai_agent_runs r WHERE r.id = :'a379_run4'),
  'a code given for a case does not send to a chat, and it is not rebound to the chat');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a379_run4'::UUID;

-- 3.5 Auto of the agent is not touched by the binding: with Auto on, another chat still sends (the agent's own switch).
SELECT pg_temp.a379_upd('sales', '{"autoSend":true}', 2010) AS a379_u10 \gset
SELECT pg_temp.a379_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL, %L, NULL',
  pg_temp.a379_id(1), pg_temp.a379_id(301), pg_temp.a379_sha('CODE-379-E'), :'a379_chat_a')) AS a379_r5 \gset
SELECT pg_temp.a379_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Авто агента, чужой чат","authority_code":"CODE-379-E"}', :'a379_chat_b')) AS a379_s9 \gset
SELECT pg_temp.a379_assert((:'a379_s9'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a379_s9'::JSONB) ->> 'mode' = 'direct'
  AND (SELECT d.sent_by_agent FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a379_s9'::JSONB) ->> 'draft_id')::UUID),
  'the agent''s own Auto still sends to any chat: the target binds only the code');
SELECT pg_temp.a379_upd('sales', '{"autoSend":false}', 2011) AS a379_u11 \gset
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE status IN ('starting', 'running');

\echo A379_AI_AGENTS_SAFEGUARDS_SUITE_PASSED
ROLLBACK;
