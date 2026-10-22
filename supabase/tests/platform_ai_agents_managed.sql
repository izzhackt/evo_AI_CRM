\set ON_ERROR_STOP on
-- Boundary suite for migration 317: «ИИ-агенты» на Claude Managed Agents (docs/design/ai-agents/contract.md,
-- часть A; docs/PLAN_CHANGES.md «2026-10-22 · ИИ-агенты на Claude Managed Agents: план»). Runs on the real
-- chain right after 317 inside one transaction that is rolled back, with its own synthetic organizations and
-- members; sessions are the real custom_access_token_hook claims; WhatsApp conversations come through the
-- REAL WAHA projection chain; the send path goes through the REAL canonical chain up to the work item. No
-- provider, no Claude/Anthropic call, no real person, no production action.
--
-- Proves:
--  1. catalog: nine closed tables (FORCE RLS, no policy, no API grants), the 9 staff / 14 runtime / 3 MCP / 24 tool
--     functions (definer, empty search_path, grants by audience), the tool schema table equals the contract
--     (count and a spot check; the full equality is tests/ai-agents-db-contract.test.mjs), the seed (7 agents per
--     organization, values of contract.ts, responsible = the oldest system Admin), the one-source CHECK and the guard;
--  2. staff functions: the permission matrix (Admin, AI manager, AI viewer, curator, student, other organization,
--     anon, service_role), settings only for the system Admin, the version token, replay and conflict by request id,
--     every validation, the journal row without texts, runs / drafts / digests readers, draft decisions;
--  3. runtime functions: sync record, token stage / restore / clear and the previous-token window, MCP auth,
--     run authorization states, reserve (duplicate, in progress) / update (forward-only, one finish row) / get / open /
--     scheduled upsert (orphans linked) / dispatch targets;
--  4. the 24 tools, one scenario each (shape, masks, black list, cursor, invalid arguments, disabled agent), the
--     action log with its argument summary and the journal rows for sensitive reads;
--  5. send_message: draft with Auto off, the 3-pending limit, direct portal with Auto on and with an authority code,
--     direct WhatsApp up to the work item through the real canonical chain (authorization kind ai_agent, replay),
--     the fuses (staff active, rate limit, moved on, closed, unavailable provider, sender unavailable), the insert guard;
--  6. file grants (use count, expiry, wrong token), the journal allowlist (11 actions, 3 types, previous lists intact).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A317_AI_AGENTS_MANAGED_SUITE_START

CREATE FUNCTION pg_temp.a317_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a317_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A317: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a317_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a317_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a317_claims TO authenticated;
-- staff (authenticated with the actor's claims) / service / anon
CREATE FUNCTION pg_temp.a317_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_call('authenticated', (SELECT claims FROM a317_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a317_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a317_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a317_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a317_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
-- A tool call as the service: tool name, agent key, args JSON text.
CREATE FUNCTION pg_temp.a317_tool(p_tool TEXT, p_key TEXT, p_args TEXT DEFAULT '{}', p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_svc(format('SELECT platform.ai_agent_tool_%s_v1(%L, %L, %L::jsonb)', p_tool, pg_temp.a317_id(p_org), p_key, p_args))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a317_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   1 org 1 Admin (system admin)              6 org 2 Admin (system admin)
--   2 org 1 invited staff «Tasks» (can take tasks, no AI rights)    3 org 1 invited staff «AI viewer»  (ai.agent.use)
--   4 org 1 invited staff «AI manager» (ai.agent.manage + use)    5 org 1 Student
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a317_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a317_actors VALUES (1, 1, 'admin', TRUE), (2, 1, NULL, FALSE), (3, 1, NULL, FALSE), (4, 1, NULL, FALSE),
  (5, 1, 'student', FALSE), (6, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a317_id(1), 'A317 Fictional organization', 'active'),
  (pg_temp.a317_id(2), 'A317 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a317_id(100 + n), 'a317-' || n || '@example.invalid', '{}'::JSONB FROM a317_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a317_id(200 + n), pg_temp.a317_id(100 + n), 'A317 Actor ' || n, 'active', 1 FROM a317_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a317_id(300 + a.n), pg_temp.a317_id(a.org), pg_temp.a317_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a317_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a317_id(300 + n) FROM a317_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a317_id(401), pg_temp.a317_id(1), 'organization', pg_temp.a317_id(1), 1),
  (pg_temp.a317_id(402), pg_temp.a317_id(2), 'organization', pg_temp.a317_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a317_id(1), pg_temp.a317_id(301), pg_temp.a317_id(401), 1, 1, TRUE, 'system', 'A317 synthetic scope', pg_temp.a317_id(601)),
  (pg_temp.a317_id(2), pg_temp.a317_id(306), pg_temp.a317_id(402), 1, 1, TRUE, 'system', 'A317 synthetic scope', pg_temp.a317_id(602)),
  (pg_temp.a317_id(1), pg_temp.a317_id(302), pg_temp.a317_id(401), 1, 1, TRUE, 'system', 'A317 synthetic scope', pg_temp.a317_id(603));

CREATE FUNCTION pg_temp.a317_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a317_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a317_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a317_claims(actor, claims) SELECT a.n, pg_temp.a317_claims_for(a.n) FROM a317_actors a;

-- Two published roles for the invited staff (members modelled like production: coarse role NULL, rights from roles).
CREATE TEMP TABLE a317_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO a317_roles VALUES
  (pg_temp.a317_id(1101), 'AI viewer', '["ai.agent.use","organization.read"]', 1120),
  (pg_temp.a317_id(1102), 'AI manager', '["ai.agent.manage","ai.agent.use","organization.read"]', 1130),
  (pg_temp.a317_id(1103), 'Tasks', '["staff.task.complete","staff.task.edit","staff.task.read"]', 1140);
CREATE TEMP TABLE a317_grants(membership INTEGER, role_id UUID, own BOOLEAN);
INSERT INTO a317_grants VALUES (3, pg_temp.a317_id(1101), FALSE), (4, pg_temp.a317_id(1102), FALSE), (2, pg_temp.a317_id(1103), TRUE);
CREATE TEMP TABLE a317_bundles(role_id UUID, bundle_id UUID);
GRANT SELECT ON a317_roles, a317_grants TO authenticated;
GRANT SELECT, INSERT ON a317_bundles TO authenticated;
CREATE FUNCTION pg_temp.a317_roles_phase() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; m INTEGER; published JSONB; items JSONB; bindings JSONB;
BEGIN
  FOR r IN SELECT * FROM a317_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.a317_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'A317 ' || r.label, 'description', 'Migration 317 synthetic role',
        'permissionKeys', r.keys), 'A317 create role', pg_temp.a317_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.a317_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.a317_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'A317 publish role', pg_temp.a317_id(r.request_base + 2));
    INSERT INTO a317_bundles VALUES (r.role_id, (published ->> 'bundleId')::UUID);
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM a317_grants ORDER BY 1 LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id,
        'scope', CASE WHEN g.own THEN jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)
          ELSE jsonb_build_object('kind', 'organization', 'key', pg_temp.a317_id(1), 'resourceKind', NULL) END) ORDER BY g.role_id), '[]'::JSONB),
      COALESCE(jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2, 'bundleId', b.bundle_id,
        'bundleVersion', 1) ORDER BY g.role_id), '[]'::JSONB)
    INTO items, bindings FROM a317_grants g JOIN a317_bundles b ON b.role_id = g.role_id WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.a317_id(1), pg_temp.a317_id(300 + m),
      (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
        WHERE om.id = pg_temp.a317_id(300 + m)), items, bindings, 'A317 grant roles', pg_temp.a317_id(1200 + m));
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a317_roles_phase() TO authenticated;
SELECT claims AS a317_admin_claims FROM a317_claims WHERE actor = 1 \gset
SET LOCAL request.jwt.claims TO :'a317_admin_claims';
SET LOCAL ROLE authenticated;
SELECT pg_temp.a317_roles_phase();
RESET ROLE;
UPDATE a317_claims c SET claims = pg_temp.a317_claims_for(c.actor);

SELECT pg_temp.a317_assert((SELECT count(*) = 6 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id')
    FROM a317_claims), 'every fixture actor got real hook claims');
SELECT pg_temp.a317_assert(
  platform_private.staff_has_permission(pg_temp.a317_id(1), pg_temp.a317_id(303), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.a317_id(1), pg_temp.a317_id(303), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.a317_id(1), pg_temp.a317_id(304), 'ai.agent.manage')
  AND NOT platform_private.staff_has_permission(pg_temp.a317_id(1), pg_temp.a317_id(302), 'ai.agent.use'),
  'fixture: 3 uses, 4 manages, the curator has neither');

-- ---------------------------------------------------------------------------
-- 1. Catalog and posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_assert((SELECT count(*) = 9 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
      AND bool_and(NOT has_table_privilege('authenticated', c.oid, 'SELECT') AND NOT has_table_privilege('service_role', c.oid, 'SELECT')
        AND NOT has_table_privilege('anon', c.oid, 'SELECT') AND NOT has_table_privilege('service_role', c.oid, 'INSERT'))
      AND NOT EXISTS (SELECT 1 FROM pg_policies x WHERE x.schemaname = 'platform_private' AND x.tablename LIKE 'ai\_agent%')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform_private' AND c.relkind = 'r' AND (c.relname LIKE 'ai\_agents%' OR c.relname LIKE 'ai\_agent\_%')
      AND c.relname IN ('ai_agents', 'ai_agents_org_settings', 'ai_agent_runs', 'ai_agent_actions', 'ai_agent_drafts',
        'ai_agent_digests', 'ai_agent_file_grants', 'ai_agent_dedupe', 'ai_agent_tool_schemas')),
  'nine closed tables: FORCE RLS, no policy, no API grants');
SELECT pg_temp.a317_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1'
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) = 9
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_runtime\_%'
     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) = 14
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_mcp\_%'
     AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) = 3
  AND (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_tool\_%\_v1'
     AND p.prosecdef AND p.provolatile = 'v' AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) = 24,
  '9 staff + 14 runtime + 3 MCP + 24 tool functions, definer with empty search_path, grants by audience');
SELECT pg_temp.a317_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname LIKE 'ai\_agent%' AND p.proname <> 'ai_agent_grant_common_roles'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))) = 0,
  'the platform_private helpers of 317 are closed to every API role');
SELECT pg_temp.a317_assert((SELECT count(*) = 24 FROM platform_private.ai_agent_tool_schemas)
  AND (SELECT input_schema -> 'properties' -> 'limit' ->> 'maximum' = '100' AND input_schema ->> 'additionalProperties' = 'false'
      FROM platform_private.ai_agent_tool_schemas WHERE tool = 'search_clients')
  AND (SELECT kind = 'write' AND audit = 'write' FROM platform_private.ai_agent_tool_schemas WHERE tool = 'send_message')
  AND (SELECT audit = 'read' FROM platform_private.ai_agent_tool_schemas WHERE tool = 'get_document_file'),
  'tool schema table: 24 rows copied from the contract');

-- The guard keeps the 276 branch and the one-source CHECK knows three kinds.
SELECT pg_temp.a317_assert((SELECT p.prosrc LIKE '%ai_autosend_authorization_forbidden%'
      AND p.prosrc LIKE '%s.responsible_membership_id = NEW.authorized_by_membership_id%'
      AND p.prosrc LIKE '%ai_agent_authorization_forbidden%' AND p.prosecdef
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'platform_private.guard_ai_autosend_authorization()'::REGPROCEDURE)
  AND (SELECT count(*) = 1 FROM pg_trigger t WHERE t.tgrelid = 'platform.manual_send_authorizations'::REGCLASS
      AND t.tgname = 'manual_send_authorizations_ai_autosend_guard' AND NOT t.tgisinternal),
  'the insert guard is replaced in place and stays closed');
DO $a317_check$
DECLARE r JSONB := '[]'::JSONB; v_state TEXT;
BEGIN
  SET LOCAL session_replication_role = replica;
  -- The CHECK in isolation (triggers off): each bad combination is refused with 23514, the good ones pass the CHECK.
  FOR v_state IN SELECT unnest(ARRAY['manual+agent', 'agent+none', 'autosend+agent', 'unknown-kind']) LOOP
    BEGIN
      INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256,
        authorized_by_profile_id, authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id,
        ai_autosend_decision_id)
      VALUES (pg_temp.a317_id(1), pg_temp.a317_id(9001), 'x', repeat('a', 64), pg_temp.a317_id(201), pg_temp.a317_id(301), 'r',
        gen_random_uuid(), pg_temp.a317_id(9002),
        CASE v_state WHEN 'manual+agent' THEN 'manual' WHEN 'agent+none' THEN 'ai_agent' WHEN 'autosend+agent' THEN 'ai_autosend' ELSE 'zzz' END,
        CASE WHEN v_state IN ('manual+agent', 'autosend+agent') THEN pg_temp.a317_id(9003) END,
        CASE WHEN v_state = 'autosend+agent' THEN pg_temp.a317_id(9004) END);
      r := r || to_jsonb(v_state || ':accepted');
    EXCEPTION WHEN check_violation THEN
      r := r || to_jsonb(v_state || ':check');
    END;
  END LOOP;
  PERFORM pg_temp.a317_assert(r = '["manual+agent:check","agent+none:check","autosend+agent:check","unknown-kind:check"]'::JSONB,
    'the one-source CHECK refuses every bad kind/source combination: ' || r::TEXT);
  SET LOCAL session_replication_role = origin;
END
$a317_check$;

-- ---------------------------------------------------------------------------
-- 2. Seed: the first read creates the 7 agents of the catalog and the settings row (organization by organization).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_assert((SELECT count(*) = 0 FROM platform_private.ai_agents WHERE organization_id IN (pg_temp.a317_id(1), pg_temp.a317_id(2))),
  'the fixture organizations start with no agent rows');
SELECT pg_temp.a317_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) AS a317_list1 \gset
SELECT pg_temp.a317_assert((:'a317_list1'::JSONB) ? 'agents' AND jsonb_array_length((:'a317_list1'::JSONB) -> 'agents') = 7,
  'Admin reads the hub: 7 agents: ' || left(:'a317_list1', 200));
CREATE TEMP TABLE a317_catalog(key TEXT, group_key TEXT, sort_order INTEGER, title TEXT, role_line TEXT, direction TEXT, cron TEXT,
  tz TEXT, trig_site BOOLEAN, trig_wa BOOLEAN);
INSERT INTO a317_catalog VALUES
  ('director', 'analytics', 10, 'Директор / Аналитик', 'Считает продажи, воронку и поступление, раз в неделю присылает отчёт руководству', NULL, '0 9 * * 1', 'Asia/Bishkek', FALSE, FALSE),
  ('sales', 'sales', 20, 'Продажи (Closer)', 'Разбирает новые заявки и чаты WhatsApp, готовит ответы и ведёт лид до договора', NULL, NULL, 'Asia/Bishkek', TRUE, TRUE),
  ('curator-cn', 'curators', 30, 'Куратор Китай', 'Ведёт студентов по Китаю: документы, CSCA, подача, собеседования, виза', 'CN', NULL, 'Asia/Bishkek', FALSE, FALSE),
  ('curator-my', 'curators', 40, 'Куратор Малайзия', 'Ведёт студентов по Малайзии: документы, университеты, EMGS, виза, прилёт', 'MY', NULL, 'Asia/Bishkek', FALSE, FALSE),
  ('curator-eu', 'curators', 50, 'Куратор Европа', 'Европа (Италия, Чехия): инструкции пока нет, агент выключен', 'EUROPE', NULL, 'Asia/Bishkek', FALSE, FALSE),
  ('curator-ae', 'curators', 60, 'Куратор ОАЭ', 'ОАЭ: инструкции пока нет, агент выключен', 'AE', NULL, 'Asia/Bishkek', FALSE, FALSE),
  ('curator-tr', 'curators', 70, 'Куратор Турция', 'Турция: инструкции пока нет, агент выключен', 'TR', NULL, 'Asia/Bishkek', FALSE, FALSE);
SELECT pg_temp.a317_assert((SELECT count(*) = 7 FROM platform_private.ai_agents a JOIN a317_catalog c ON c.key = a.key
      WHERE a.organization_id = pg_temp.a317_id(1) AND a.group_key = c.group_key AND a.sort_order = c.sort_order AND a.title = c.title
        AND a.role_line = c.role_line AND a.direction IS NOT DISTINCT FROM c.direction AND a.schedule_cron IS NOT DISTINCT FROM c.cron
        AND a.schedule_tz = c.tz AND a.trigger_website_lead = c.trig_site AND a.trigger_whatsapp_inbound = c.trig_wa
        AND NOT a.enabled AND NOT a.auto_send AND a.model = 'claude-sonnet-5-5' AND a.run_budget_usd = 5.00 AND a.config_version = 1
        AND a.sync_status = 'never' AND a.instructions_override IS NULL AND a.mcp_token_sha256 IS NULL),
  'the seed is the contract catalog verbatim; everything off, Sonnet 5.5, budget 5, never synced');
SELECT pg_temp.a317_assert((SELECT s.responsible_membership_id = pg_temp.a317_id(301) FROM platform_private.ai_agents_org_settings s
      WHERE s.organization_id = pg_temp.a317_id(1)),
  'the responsible member is the oldest active system Admin of the organization');
SELECT pg_temp.a317_staff(6, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(2))) AS a317_list2 \gset
SELECT pg_temp.a317_assert((SELECT count(*) = 7 FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(2))
  AND (SELECT s.responsible_membership_id = pg_temp.a317_id(306) FROM platform_private.ai_agents_org_settings s WHERE s.organization_id = pg_temp.a317_id(2))
  AND (SELECT count(*) = 14 FROM platform_private.ai_agents WHERE organization_id IN (pg_temp.a317_id(1), pg_temp.a317_id(2))),
  'organization 2 has its own 7 rows and its own responsible member');
SELECT pg_temp.a317_assert(
  (SELECT bool_and(NOT (e ? 'instructionsOverride') AND e ? 'sync' AND e ? 'stats' AND jsonb_array_length(e -> 'stats' -> 'runsPerDay14') = 14
        AND (e ->> 'hasInstructionsOverride') = 'false' AND e ->> 'model' = 'claude-sonnet-5-5')
      FROM jsonb_array_elements((:'a317_list1'::JSONB) -> 'agents') e)
  AND (:'a317_list1'::JSONB) -> 'summary' = '{"enabled":0,"runs7d":0,"costCents7d":0,"draftsPending":0}'::JSONB
  AND (:'a317_list1'::JSONB) ->> 'isAdmin' = 'true' AND (:'a317_list1'::JSONB) ->> 'canManage' = 'true'
  AND (:'a317_list1'::JSONB) -> 'org' ->> 'responsibleName' = 'A317 Actor 1'
  AND (SELECT array_agg(e ->> 'key' ORDER BY ord) FROM jsonb_array_elements((:'a317_list1'::JSONB) -> 'agents') WITH ORDINALITY x(e, ord)
      ) = ARRAY['director', 'sales', 'curator-cn', 'curator-my', 'curator-eu', 'curator-ae', 'curator-tr'],
  'the hub shape: no instruction text, sync info, 14-day sparkline, summary, rights, order of the catalog');

-- ---------------------------------------------------------------------------
-- 3. Permission matrix of the staff functions.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a317_matrix(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r TEXT := ''; a INTEGER; v JSONB;
BEGIN
  FOREACH a IN ARRAY ARRAY[1, 3, 4, 2, 5, 6] LOOP
    v := pg_temp.a317_staff(a, p_sql);
    r := r || a || ':' || COALESCE(v ->> 'error', 'ok') || ' ';
  END LOOP;
  r := r || 'anon:' || COALESCE(pg_temp.a317_anon(p_sql) ->> 'error', 'ok') || ' svc:' || COALESCE(pg_temp.a317_svc(p_sql) ->> 'error', 'ok');
  RETURN r;
END
$$;
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1)))
    = '1:ok 3:ok 4:ok 2:42501 5:42501 6:42501 anon:42501 svc:42501',
  'list: Admin, viewer and manager read; curator, student, other organization, anon and service are refused: '
    || pg_temp.a317_matrix(format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))));
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a317_id(1)))
    = '1:ok 3:ok 4:ok 2:42501 5:42501 6:42501 anon:42501 svc:42501', 'get: same matrix');
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_runs_list_v1(%L, ''sales'')', pg_temp.a317_id(1)))
    = '1:ok 3:ok 4:ok 2:42501 5:42501 6:42501 anon:42501 svc:42501', 'runs list: same matrix');
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_drafts_list_v1(%L)', pg_temp.a317_id(1)))
    = '1:ok 3:ok 4:ok 2:42501 5:42501 6:42501 anon:42501 svc:42501', 'drafts list: same matrix');
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_digests_list_v1(%L)', pg_temp.a317_id(1)))
    = '1:ok 3:ok 4:ok 2:42501 5:42501 6:42501 anon:42501 svc:42501', 'digests list: same matrix');
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1)))
    LIKE '1:55000 3:55000 4:55000 2:42501 5:42501 6:42501 anon:42501 svc:42501',
  'run authorize: the right is checked first (everyone with use reaches the disabled-agent refusal): '
    || pg_temp.a317_matrix(format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1))));
SELECT pg_temp.a317_assert(pg_temp.a317_matrix(format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'', true)', pg_temp.a317_id(1)))
    = '1:55000 3:42501 4:55000 2:42501 5:42501 6:42501 anon:42501 svc:42501',
  'run authorize with send authority needs ai.agent.manage: the viewer is refused: '
    || pg_temp.a317_matrix(format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'', true)', pg_temp.a317_id(1))));
SELECT pg_temp.a317_assert(
  (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) ->> 'canManage') = 'false'
  AND (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) ->> 'isAdmin') = 'false'
  AND (pg_temp.a317_staff(4, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) ->> 'canManage') = 'true'
  AND (pg_temp.a317_staff(4, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) ->> 'isAdmin') = 'false',
  'the hub reports canManage and isAdmin per actor');
-- A foreign key / unknown agent.
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_get_v1(%L, ''nope'')', pg_temp.a317_id(1)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_runs_list_v1(%L, ''nope'')', pg_temp.a317_id(1)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_drafts_list_v1(%L, ''nope'')', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_get_v1(%L, %L)', pg_temp.a317_id(1), pg_temp.a317_id(9999)))) = 'P0002',
  'unknown agent key / run: P0002; bad draft filter: 22023');
SELECT pg_temp.a317_staff(1, format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a317_id(1))) AS a317_sales \gset
SELECT pg_temp.a317_assert((:'a317_sales'::JSONB) ? 'instructionsOverride' AND (:'a317_sales'::JSONB) ? 'charts'
  AND jsonb_array_length((:'a317_sales'::JSONB) -> 'charts' -> 'runsPerDay') = 30
  AND jsonb_array_length((:'a317_sales'::JSONB) -> 'charts' -> 'spendPerDay') = 30
  AND (:'a317_sales'::JSONB) -> 'charts' -> 'actionsByTool' = '[]'::JSONB
  AND (:'a317_sales'::JSONB) -> 'lastDigest' = 'null'::JSONB
  AND (:'a317_sales'::JSONB) ->> 'triggerWebsiteLead' = 'true' AND (:'a317_sales'::JSONB) ->> 'runBudgetUsd' = '5.00'
  AND (:'a317_sales'::JSONB) ->> 'configVersion' = '1',
  'the agent page: instruction field, 30-day charts, last digest, triggers, budget, version');

-- ---------------------------------------------------------------------------
-- 4. ai_agents_update_v1: only the system Admin; version token; replay; validations; journal without texts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a317_upd(p_actor INTEGER, p_key TEXT, p_version BIGINT, p_patch TEXT, p_req INTEGER, p_org INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_staff(p_actor, format('SELECT platform.ai_agents_update_v1(%L, %L, %s, %L::jsonb, %L)',
    pg_temp.a317_id(p_org), p_key, p_version, p_patch, pg_temp.a317_id(p_req)))
$$;
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_upd(4, 'sales', 1, '{"enabled":true}', 2001)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_upd(3, 'sales', 1, '{"enabled":true}', 2002)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_upd(6, 'sales', 1, '{"enabled":true}', 2003)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_upd(2, 'sales', 1, '{"enabled":true}', 2004)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_anon(format('SELECT platform.ai_agents_update_v1(%L, ''sales'', 1, ''{"enabled":true}''::jsonb, %L)',
    pg_temp.a317_id(1), pg_temp.a317_id(2005)))) = '42501'
  AND (SELECT NOT enabled FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'settings change: the AI manager (not an Admin), the viewer, the curator, another organization and anon are refused; nothing changed');
SELECT pg_temp.a317_upd(1, 'sales', 1, '{"enabled":true,"model":"claude-opus-5-5"}', 2010) AS a317_u1 \gset
SELECT pg_temp.a317_assert((:'a317_u1'::JSONB) = '{"key":"sales","configVersion":2,"changed":["enabled","model"]}'::JSONB,
  'the Admin enables the agent and changes the model: ' || :'a317_u1');
SELECT pg_temp.a317_assert((SELECT enabled AND model = 'claude-opus-5-5' AND config_version = 2
      AND updated_by_membership_id = pg_temp.a317_id(301) FROM platform_private.ai_agents
      WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'the row follows the patch and records who changed it');
-- Replay by request id (same data -> the stored receipt; other data -> 40001).
SELECT pg_temp.a317_assert(pg_temp.a317_upd(1, 'sales', 1, '{"enabled":true,"model":"claude-opus-5-5"}', 2010) = :'a317_u1'::JSONB
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.a317_id(2010))
  AND pg_temp.a317_err(pg_temp.a317_upd(1, 'sales', 1, '{"enabled":false}', 2010)) = '40001'
  AND pg_temp.a317_msg(pg_temp.a317_upd(1, 'sales', 1, '{"enabled":false}', 2010)) = 'ai_agent_request_conflict'
  AND (SELECT config_version = 2 FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'replay with the same request id returns the stored receipt without a second row; other data is a conflict');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_upd(1, 'sales', 1, '{"autoSend":true}', 2011)) = '40001'
  AND pg_temp.a317_msg(pg_temp.a317_upd(1, 'sales', 1, '{"autoSend":true}', 2012)) = 'ai_agent_version_conflict',
  'a stale version token is refused (40001)');
-- Every validation is 22023.
SELECT pg_temp.a317_assert((
  SELECT bool_and(pg_temp.a317_err(pg_temp.a317_upd(1, 'sales', 2, p.patch, 2100 + p.n)) = '22023')
  FROM (VALUES (1, '{}'), (2, '{"unknown":1}'), (3, '{"enabled":"yes"}'), (4, '{"autoSend":1}'), (5, '{"model":"gpt-5"}'),
    (6, '{"model":5}'), (7, '{"scheduleCron":"* * *"}'), (8, '{"scheduleCron":"a b c d e"}'), (9, '{"scheduleTz":"Mars/Phobos"}'),
    (10, '{"scheduleTz":5}'), (11, '{"runBudgetUsd":101}'), (12, '{"runBudgetUsd":-1}'), (13, '{"runBudgetUsd":"5"}'),
    (14, '{"claudeAgentId":"agent-1"}'), (15, '{"claudeAgentId":"agent_short"}'), (16, '{"instructionsOverride":5}'),
    (17, format('{"instructionsOverride":"%s"}', repeat('x', 60001))), (18, format('{"schedulePromptOverride":"%s"}', repeat('y', 8001))),
    (19, '{"triggerWebsiteLead":null}'), (20, '[]'), (21, '{"enabled":true,"model":"x"}')) p(n, patch)),
  'every bad patch is 22023 ai_agent_invalid_patch (empty, extra key, wrong types, model, cron, timezone, budget, agent id, long texts)');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_update_v1(%L, ''sales'', NULL, ''{"enabled":true}''::jsonb, %L)',
    pg_temp.a317_id(1), pg_temp.a317_id(2150)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_upd(1, 'nope', 1, '{"enabled":true}', 2151)) = 'P0002'
  AND (SELECT config_version = 2 FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'a missing version token is 22023, an unknown agent P0002; the version did not move');
-- Texts and the journal: the instruction goes in, the journal row carries no text.
SELECT pg_temp.a317_upd(1, 'sales', 2,
  '{"instructionsOverride":"SECRET-INSTRUCTION-TEXT-317","scheduleCron":"0 8 * * 1-5","scheduleTz":"Asia/Bishkek","schedulePromptOverride":"SECRET-PROMPT-317","runBudgetUsd":12.345,"triggerWhatsappInbound":false}', 2020) AS a317_u2 \gset
SELECT pg_temp.a317_assert((:'a317_u2'::JSONB) ->> 'configVersion' = '3'
  AND (:'a317_u2'::JSONB) -> 'changed' @> '["instructionsOverride","scheduleCron","schedulePromptOverride","runBudgetUsd","triggerWhatsappInbound"]'::JSONB
  AND NOT (:'a317_u2'::JSONB) -> 'changed' @> '["scheduleTz"]'::JSONB,
  'texts, cron, budget and trigger changed; the unchanged timezone is not listed: ' || :'a317_u2');
SELECT pg_temp.a317_assert((SELECT instructions_override = 'SECRET-INSTRUCTION-TEXT-317' AND schedule_prompt_override = 'SECRET-PROMPT-317'
      AND schedule_cron = '0 8 * * 1-5' AND run_budget_usd = 12.35 AND NOT trigger_whatsapp_inbound
      FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales')
  AND (SELECT count(*) = 2 FROM platform.audit_events WHERE action = 'ai.agent.config.change' AND organization_id = pg_temp.a317_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events e WHERE e.organization_id = pg_temp.a317_id(1)
      AND (e.after_state::TEXT LIKE '%SECRET-%' OR COALESCE(e.before_state::TEXT, '') LIKE '%SECRET-%' OR e.reason LIKE '%SECRET-%'))
  AND (SELECT e.actor_kind = 'user' AND e.actor_membership_id = pg_temp.a317_id(301) AND e.resource_type = 'ai_agent'
        AND e.after_state ->> 'agentKey' = 'sales' AND e.after_state ? 'patchSha256' AND e.after_state ->> 'runBudgetUsd' = '12.35'
        FROM platform.audit_events e WHERE e.request_id = pg_temp.a317_id(2020)),
  'the journal row is by the Admin, about the agent, with changed keys, safe values and a hash: no instruction or prompt text anywhere');
SELECT pg_temp.a317_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) AS a317_list3 \gset
SELECT pg_temp.a317_assert(NOT ((:'a317_list3'::JSONB)::TEXT LIKE '%SECRET-%')
  AND (SELECT (e ->> 'hasInstructionsOverride') = 'true' FROM jsonb_array_elements((:'a317_list3'::JSONB) -> 'agents') e WHERE e ->> 'key' = 'sales')
  AND (:'a317_list3'::JSONB) -> 'summary' ->> 'enabled' = '1',
  'the hub shows only that an override exists, never its text; the summary counts the enabled agent');
SELECT pg_temp.a317_assert((pg_temp.a317_staff(1, format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a317_id(1))) ->> 'instructionsOverride') = 'SECRET-INSTRUCTION-TEXT-317'
  AND pg_temp.a317_err(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a317_id(1)))) IS NULL,
  'the agent page returns the override text to staff with the right to read the section');
-- Blank override becomes NULL; a no-op patch does not move the version or the journal.
SELECT pg_temp.a317_upd(1, 'sales', 3, '{"instructionsOverride":"   \n","schedulePromptOverride":null}', 2030) AS a317_u3 \gset
SELECT pg_temp.a317_assert((:'a317_u3'::JSONB) ->> 'configVersion' = '4'
  AND (SELECT instructions_override IS NULL AND schedule_prompt_override IS NULL FROM platform_private.ai_agents
      WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'a blank instruction becomes NULL (the repository text is used again)');
SELECT pg_temp.a317_upd(1, 'sales', 4, '{"enabled":true,"model":"claude-opus-5-5"}', 2031) AS a317_u4 \gset
SELECT pg_temp.a317_assert((:'a317_u4'::JSONB) = '{"key":"sales","configVersion":4,"changed":[]}'::JSONB
  AND (SELECT count(*) = 3 FROM platform.audit_events WHERE action = 'ai.agent.config.change' AND organization_id = pg_temp.a317_id(1)),
  'a patch that changes nothing returns the same version and writes no journal row');
-- Model back to the default and the agent off, so the later scenarios start clean.
SELECT pg_temp.a317_upd(1, 'sales', 4, '{"model":"claude-sonnet-5-5","enabled":false,"scheduleCron":null,"runBudgetUsd":5,"triggerWhatsappInbound":true}', 2032) AS a317_u5 \gset
SELECT pg_temp.a317_assert((:'a317_u5'::JSONB) ->> 'configVersion' = '5', 'back to the defaults: ' || :'a317_u5');

-- ---------------------------------------------------------------------------
-- 5. Runtime: sync record, tokens, MCP auth, run authorization.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a317_rt(p_fn TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_svc(format('SELECT platform.%s(%s)', p_fn, p_args))
$$;
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_runtime_get_v1(%L, ''sales'')', pg_temp.a317_id(1)))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_anon(format('SELECT platform.ai_agent_runtime_get_v1(%L, ''sales'')', pg_temp.a317_id(1)))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_mcp_auth_v1(%L)', repeat('a', 64)))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_tool_get_my_settings_v1(%L, ''sales'', ''{}''::jsonb)', pg_temp.a317_id(1)))) = '42501',
  'runtime, MCP and tool functions are closed to staff sessions and anon (42501)');
SELECT pg_temp.a317_rt('ai_agent_runtime_get_v1', format('%L, ''sales''', pg_temp.a317_id(1))) AS a317_rg \gset
SELECT pg_temp.a317_assert((:'a317_rg'::JSONB) ->> 'syncStatus' = 'never' AND (:'a317_rg'::JSONB) ->> 'claudeAgentId' IS NULL
  AND (:'a317_rg'::JSONB) ? 'tokenFingerprint' AND (:'a317_rg'::JSONB) ? 'charts' AND (:'a317_rg'::JSONB) ->> 'configVersion' = '5',
  'runtime_get returns the full configuration with the Claude ids empty before the first sync');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', NULL, ''{"status":"weird"}''::jsonb', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', NULL, ''{"status":"ok","extra":1}''::jsonb', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', NULL, ''{"status":"ok","configHash":"zz"}''::jsonb', pg_temp.a317_id(1)))) = '22023',
  'sync_record refuses an unknown status, key or hash (22023)');
SELECT pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', %L, %L::jsonb', pg_temp.a317_id(1), pg_temp.a317_id(301),
  format('{"status":"pending","claudeAgentId":"agent_ABCDEFGH12","environmentId":"env_1","vaultId":"vlt_1"}'))) AS a317_s0 \gset
SELECT pg_temp.a317_assert((:'a317_s0'::JSONB) = '{"ok":true,"syncStatus":"pending"}'::JSONB
  AND (SELECT count(*) = 0 FROM platform.audit_events WHERE action = 'ai.agent.sync' AND organization_id = pg_temp.a317_id(1)),
  'a pending sync stores the ids it already has and writes no journal row');
SELECT pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', %L, %L::jsonb', pg_temp.a317_id(1), pg_temp.a317_id(301),
  format('{"status":"ok","agentVersion":3,"deploymentId":"dep_1","credentialId":"cred_1","mcpUrl":"https://crm.example.invalid/api/mcp/v1","configHash":"%s"}', repeat('c', 64)))) AS a317_s1 \gset
SELECT pg_temp.a317_assert((:'a317_s1'::JSONB) = '{"ok":true,"syncStatus":"ok"}'::JSONB
  AND (SELECT a.sync_status = 'ok' AND a.synced_at IS NOT NULL AND a.claude_agent_id = 'agent_ABCDEFGH12' AND a.claude_environment_id = 'env_1'
        AND a.claude_vault_id = 'vlt_1' AND a.claude_agent_version = 3 AND a.claude_deployment_id = 'dep_1' AND a.claude_credential_id = 'cred_1'
        AND a.synced_config_hash = repeat('c', 64) AND a.claude_mcp_url LIKE 'https://crm.example.invalid/%' AND a.sync_error IS NULL
      FROM platform_private.ai_agents a WHERE a.organization_id = pg_temp.a317_id(1) AND a.key = 'sales')
  AND (SELECT count(*) = 1 AND bool_and(e.actor_kind = 'user' AND e.actor_membership_id = pg_temp.a317_id(301) AND e.resource_type = 'ai_agent')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.sync' AND e.organization_id = pg_temp.a317_id(1)),
  'an ok sync keeps the earlier ids (absent keys do not erase), adds the new ones, stamps the time and journals once, by the Admin');
SELECT pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''curator-cn'', NULL, ''{"status":"error","error":"Claude said no"}''::jsonb', pg_temp.a317_id(1))) AS a317_s2 \gset
SELECT pg_temp.a317_assert((SELECT sync_status = 'error' AND sync_error = 'Claude said no' AND synced_at IS NULL FROM platform_private.ai_agents
      WHERE organization_id = pg_temp.a317_id(1) AND key = 'curator-cn')
  AND (SELECT e.actor_kind = 'service' AND e.actor_principal = 'ai-agent:curator-cn' AND e.actor_profile_id IS NULL
      FROM platform.audit_events e WHERE e.action = 'ai.agent.sync' AND e.resource_id = (SELECT id FROM platform_private.ai_agents
        WHERE organization_id = pg_temp.a317_id(1) AND key = 'curator-cn')),
  'an error sync stores the message and is journalled by the service actor ai-agent:<key>');
-- Changing the Claude agent id resets the sync state (staff function).
SELECT pg_temp.a317_upd(1, 'sales', 5, '{"claudeAgentId":"agent_ZZZZZZZZ99"}', 2040) AS a317_u6 \gset
SELECT pg_temp.a317_assert((SELECT a.sync_status = 'never' AND a.claude_agent_version IS NULL AND a.synced_config_hash IS NULL
        AND a.claude_agent_id = 'agent_ZZZZZZZZ99' AND a.claude_vault_id = 'vlt_1'
      FROM platform_private.ai_agents a WHERE a.organization_id = pg_temp.a317_id(1) AND a.key = 'sales'),
  'a new Claude agent id resets version, hash and sync status but keeps the vault and environment');
SELECT pg_temp.a317_rt('ai_agent_runtime_sync_record_v1', format('%L, ''sales'', NULL, ''{"status":"ok","claudeAgentId":"agent_ABCDEFGH12","agentVersion":4}''::jsonb', pg_temp.a317_id(1))) AS a317_s3 \gset

-- Tokens: stage / previous-token window / restore / clear; MCP auth.
CREATE FUNCTION pg_temp.a317_tok(p_n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('a317-token-' || p_n, 'UTF8')), 'hex')
$$;
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, %L, ''stage''', pg_temp.a317_id(1), 'nothex'))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, NULL, ''stage''', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, %L, ''clear''', pg_temp.a317_id(1), pg_temp.a317_tok(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, NULL, ''bogus''', pg_temp.a317_id(1)))) = '22023',
  'token_set refuses a bad hash, a missing hash, a hash with clear and an unknown mode');
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', %L, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_id(301), pg_temp.a317_tok(1))) AS a317_t1 \gset
SELECT pg_temp.a317_assert((:'a317_t1'::JSONB) ->> 'tokenFingerprint' = left(pg_temp.a317_tok(1), 12)
  AND (SELECT mcp_token_sha256 = pg_temp.a317_tok(1) AND mcp_token_prev_sha256 IS NULL AND mcp_token_rotated_at IS NOT NULL
      FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales'),
  'the first token is staged as current; the answer is the 12-hex fingerprint only');
SELECT pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(1))) AS a317_au1 \gset
SELECT pg_temp.a317_assert((:'a317_au1'::JSONB) = jsonb_build_object('organizationId', pg_temp.a317_id(1), 'agentKey', 'sales',
    'title', 'Продажи (Closer)', 'direction', NULL, 'enabled', FALSE, 'autoSend', FALSE)
  AND pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(99))) = 'null'::JSONB
  AND pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', 'short')) = 'null'::JSONB
  AND pg_temp.a317_rt('ai_agent_mcp_auth_v1', 'NULL') = 'null'::JSONB,
  'MCP auth: the current token resolves to the agent (disabled is still reported, the server refuses it); unknown / malformed / NULL give nothing: ' || :'a317_au1');
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', %L, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_id(301), pg_temp.a317_tok(2))) AS a317_t2 \gset
SELECT pg_temp.a317_assert((SELECT mcp_token_sha256 = pg_temp.a317_tok(2) AND mcp_token_prev_sha256 = pg_temp.a317_tok(1)
        AND mcp_token_prev_until > clock_timestamp() + INTERVAL '9 minutes' AND mcp_token_prev_until <= clock_timestamp() + INTERVAL '10 minutes 5 seconds'
      FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales')
  AND (pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(1))) ->> 'agentKey') = 'sales'
  AND (pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(2))) ->> 'agentKey') = 'sales',
  'rotation: the new token is current, the old one is the previous token for 10 minutes and both resolve');
UPDATE platform_private.ai_agents SET mcp_token_prev_until = clock_timestamp() - INTERVAL '1 second'
  WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales';
SELECT pg_temp.a317_assert(pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(1))) = 'null'::JSONB
  AND (pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(2))) ->> 'agentKey') = 'sales',
  'after the window the previous token no longer resolves');
UPDATE platform_private.ai_agents SET mcp_token_prev_until = clock_timestamp() + INTERVAL '5 minutes'
  WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales';
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, NULL, ''restore''', pg_temp.a317_id(1))) AS a317_t3 \gset
SELECT pg_temp.a317_assert((SELECT mcp_token_sha256 = pg_temp.a317_tok(1) AND mcp_token_prev_sha256 IS NULL AND mcp_token_prev_until IS NULL
      FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales')
  AND pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(2))) = 'null'::JSONB,
  'restore puts the previous token back as current and forgets the failed one');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_tok(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''director'', NULL, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_tok(1)))) = '23505',
  'staging the current token again is refused; another agent cannot take a token already in use (unique index)');
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, NULL, ''clear''', pg_temp.a317_id(1))) AS a317_t4 \gset
SELECT pg_temp.a317_assert((SELECT mcp_token_sha256 IS NULL AND mcp_token_prev_sha256 IS NULL FROM platform_private.ai_agents
      WHERE organization_id = pg_temp.a317_id(1) AND key = 'sales')
  AND pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(1))) = 'null'::JSONB
  AND (SELECT count(*) = 4 AND bool_and(e.after_state ->> 'agentKey' = 'sales' AND NOT (e.after_state::TEXT LIKE '%' || pg_temp.a317_tok(1) || '%'))
      FROM platform.audit_events e WHERE e.action = 'ai.agent.token.rotate' AND e.organization_id = pg_temp.a317_id(1)),
  'clear drops both tokens; every token operation is journalled and no hash is in the journal');
-- A fresh token for the scenarios that follow (also makes the sales agent reachable over MCP).
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''sales'', NULL, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_tok(10))) AS a317_t5 \gset
SELECT pg_temp.a317_rt('ai_agent_runtime_token_set_v1', format('%L, ''director'', NULL, %L, ''stage''', pg_temp.a317_id(1), pg_temp.a317_tok(11))) AS a317_t6 \gset
SELECT pg_temp.a317_assert((pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(11))) ->> 'agentKey') = 'director'
  AND (pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(10))) ->> 'agentKey') = 'sales',
  'two agents, two tokens, each resolves to its own agent');

-- Run authorization: disabled -> not synced -> ok.
SELECT pg_temp.a317_assert(pg_temp.a317_msg(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1)))) = 'agent_disabled',
  'a disabled agent is refused: agent_disabled');
SELECT pg_temp.a317_upd(1, 'director', 1, '{"enabled":true}', 2049) AS a317_u7a \gset
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''director'')', pg_temp.a317_id(1)))) = '55000'
  AND pg_temp.a317_msg(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''director'')', pg_temp.a317_id(1)))) = 'agent_not_synced',
  'enabled but never synced: agent_not_synced');
SELECT pg_temp.a317_upd(1, 'sales', 6, '{"enabled":true}', 2050) AS a317_u7 \gset
SELECT pg_temp.a317_assert(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1))) = jsonb_build_object(
    'agentKey', 'sales', 'title', 'Продажи (Closer)', 'enabled', TRUE, 'autoSend', FALSE, 'model', 'claude-sonnet-5-5', 'runBudgetUsd', 5.00,
    'membershipId', pg_temp.a317_id(301), 'claude', jsonb_build_object('agentId', 'agent_ABCDEFGH12', 'agentVersion', 4,
      'environmentId', 'env_1', 'vaultId', 'vlt_1')),
  'a synced enabled agent is authorized: the answer names the member and the Claude ids: '
    || pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1)))::TEXT);
SELECT pg_temp.a317_assert((pg_temp.a317_staff(4, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'', true)', pg_temp.a317_id(1))) ->> 'membershipId') = pg_temp.a317_id(304)::TEXT
  AND pg_temp.a317_err(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'', true)', pg_temp.a317_id(1)))) = '42501'
  AND (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1))) ->> 'membershipId') = pg_temp.a317_id(303)::TEXT,
  'the send-authority variant needs the manage right; the viewer may start an ordinary run');

-- ---------------------------------------------------------------------------
-- 6. Runs: reserve (duplicate, in progress), update (forward-only, one finish row), get, open, scheduled upsert,
--    dispatch targets, the action log and the argument summary.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''bogus'', NULL, NULL, NULL, NULL, NULL, NULL', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, NULL, ''nothex'', NULL, NULL, NULL', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''nope'', ''command'', NULL, NULL, NULL, NULL, NULL, NULL', pg_temp.a317_id(1)))) = '22023',
  'reserve refuses a bad trigger kind, a bad authority hash and an unknown agent');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, %L, ''claude-sonnet-5-5'', 4',
  pg_temp.a317_id(1), pg_temp.a317_id(301), encode(sha256(convert_to('CODE-317-A', 'UTF8')), 'hex'),
  'Покажи свои настройки SECRET-PREVIEW-TEXT')) AS a317_r1 \gset
SELECT (:'a317_r1'::JSONB ->> 'runId')::UUID AS a317_run1 \gset
SELECT pg_temp.a317_assert((:'a317_r1'::JSONB) ->> 'reserved' = 'true'
  AND (SELECT r.status = 'starting' AND r.trigger_kind = 'command' AND r.send_authority AND r.started_by_membership_id = pg_temp.a317_id(301)
        AND r.model = 'claude-sonnet-5-5' AND r.agent_version = 4 AND r.agent_key = 'sales'
        AND r.send_authority_sha256 = encode(sha256(convert_to('CODE-317-A', 'UTF8')), 'hex')
      FROM platform_private.ai_agent_runs r WHERE r.id = :'a317_run1')
  AND (SELECT count(*) = 1 AND bool_and(e.action = 'ai.agent.run.start' AND e.resource_type = 'ai_agent_run' AND e.actor_membership_id = pg_temp.a317_id(301)
        AND NOT e.after_state::TEXT LIKE '%SECRET%' AND NOT e.after_state::TEXT LIKE '%CODE-317%')
      FROM platform.audit_events e WHERE e.resource_id = :'a317_run1'),
  'a command run is reserved: starting, authority flag and hash stored (never the code), journalled by the initiator without text');
-- Website-lead runs: dedupe key and one open run per agent and kind.
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''website_lead'', ''lead:317-1'', NULL, NULL, ''Новая заявка'', NULL, NULL', pg_temp.a317_id(1))) AS a317_r2 \gset
SELECT (:'a317_r2'::JSONB ->> 'runId')::UUID AS a317_run2 \gset
SELECT pg_temp.a317_assert((:'a317_r2'::JSONB) ->> 'reserved' = 'true'
  AND pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''website_lead'', ''lead:317-1'', NULL, NULL, NULL, NULL, NULL', pg_temp.a317_id(1)))
    = jsonb_build_object('reserved', FALSE, 'reason', 'duplicate', 'existingRunId', :'a317_run2'::UUID)
  AND pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''website_lead'', ''lead:317-2'', NULL, NULL, NULL, NULL, NULL', pg_temp.a317_id(1)))
    = jsonb_build_object('reserved', FALSE, 'reason', 'run_in_progress', 'existingRunId', :'a317_run2'::UUID)
  AND (pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''whatsapp_inbound'', ''chat:317-1'', NULL, NULL, NULL, NULL, NULL', pg_temp.a317_id(1))) ->> 'reserved') = 'true',
  'an event run: the same dedupe key is a duplicate, a second open run of the same kind is in progress, another kind is free');
-- Update: forward-only transitions, the finish row once.
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"bogus":1}''::jsonb', pg_temp.a317_id(1), :'a317_run1'))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"inputTokens":-1}''::jsonb', pg_temp.a317_id(1), :'a317_run1'))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"zzz"}''::jsonb', pg_temp.a317_id(1), :'a317_run1'))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"running"}''::jsonb', pg_temp.a317_id(1), pg_temp.a317_id(9998)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"running"}''::jsonb', pg_temp.a317_id(2), :'a317_run1'))) = 'P0002',
  'update refuses an unknown key, a negative number, an unknown status, an unknown run and another organization');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"running","sessionId":"sess_317_1","eventCount":3}''::jsonb', pg_temp.a317_id(1), :'a317_run1')) AS a317_ru1 \gset
SELECT pg_temp.a317_assert((:'a317_ru1'::JSONB) = '{"ok":true}'::JSONB
  AND (SELECT status = 'running' AND claude_session_id = 'sess_317_1' AND event_count = 3 AND ended_at IS NULL FROM platform_private.ai_agent_runs WHERE id = :'a317_run1'),
  'starting -> running with the session id');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"starting"}''::jsonb', pg_temp.a317_id(1), :'a317_run1'))) = '55000'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"sessionId":"sess_317_1"}''::jsonb', pg_temp.a317_id(1), :'a317_run2'))) = '23505',
  'a run cannot go back to starting; a session id belongs to one run (unique)');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, %L::jsonb', pg_temp.a317_id(1), :'a317_run1',
  '{"status":"completed","inputTokens":1200,"outputTokens":340,"cacheReadTokens":900,"costCents":7,"activeSeconds":12.5,"summary":"Готово, настройки показаны"}')) AS a317_ru2 \gset
SELECT pg_temp.a317_assert((SELECT status = 'completed' AND ended_at IS NOT NULL AND input_tokens = 1200 AND output_tokens = 340
        AND cache_read_tokens = 900 AND cost_cents = 7 AND active_seconds = 12.5 AND summary LIKE 'Готово%'
      FROM platform_private.ai_agent_runs WHERE id = :'a317_run1')
  AND (SELECT count(*) = 1 AND bool_and(e.after_state ->> 'status' = 'completed' AND e.actor_kind = 'service' AND e.actor_principal = 'ai-agent:sales')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.run.finish' AND e.resource_id = :'a317_run1'),
  'completed stamps the end and the usage and journals the finish once, by the service actor');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"running"}''::jsonb', pg_temp.a317_id(1), :'a317_run1')) AS a317_ru3 \gset
SELECT pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"completed","costCents":9}''::jsonb', pg_temp.a317_id(1), :'a317_run1')) AS a317_ru4 \gset
SELECT pg_temp.a317_assert((SELECT status = 'completed' AND cost_cents = 9 FROM platform_private.ai_agent_runs WHERE id = :'a317_run1')
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.run.finish' AND e.resource_id = :'a317_run1')
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_update_v1', format('%L, %L, ''{"status":"failed"}''::jsonb', pg_temp.a317_id(1), :'a317_run1'))) = '55000',
  'a conversation continues (completed -> running -> completed) with one finish row; completed -> failed is refused');
SELECT pg_temp.a317_assert((pg_temp.a317_rt('ai_agent_runtime_run_get_v1', format('%L, %L', pg_temp.a317_id(1), :'a317_run1')) ->> 'status') = 'completed'
  AND (pg_temp.a317_rt('ai_agent_runtime_run_get_v1', format('%L, %L', pg_temp.a317_id(1), :'a317_run1')) -> 'agent' ->> 'claudeAgentId') = 'agent_ABCDEFGH12'
  AND (pg_temp.a317_rt('ai_agent_runtime_run_get_v1', format('%L, %L', pg_temp.a317_id(1), :'a317_run1')) -> 'agent' ->> 'enabled') = 'true'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_run_get_v1', format('%L, %L', pg_temp.a317_id(2), :'a317_run1'))) = 'P0002',
  'run_get returns the run with its agent block; another organization does not see it');
-- Open runs and dispatch targets.
SELECT pg_temp.a317_assert((SELECT count(*) = 2 FROM jsonb_array_elements(pg_temp.a317_rt('ai_agent_runtime_runs_open_v1', format('%L', pg_temp.a317_id(1)))) e
      WHERE e ->> 'agentKey' = 'sales' AND e ->> 'status' = 'starting')
  AND jsonb_array_length(pg_temp.a317_rt('ai_agent_runtime_runs_open_v1', format('%L, ''director''', pg_temp.a317_id(1)))) = 0
  AND jsonb_array_length(pg_temp.a317_rt('ai_agent_runtime_runs_open_v1', format('%L', pg_temp.a317_id(2)))) = 0,
  'runs_open lists the open runs of the organization (and of one agent) only');
SELECT pg_temp.a317_assert(
  (SELECT jsonb_array_length(t) = 1 AND t -> 0 ->> 'key' = 'sales' AND t -> 0 ->> 'claudeAgentId' = 'agent_ABCDEFGH12'
      AND t -> 0 ->> 'vaultId' = 'vlt_1' AND t -> 0 ->> 'environmentId' = 'env_1' AND t -> 0 ->> 'autoSend' = 'false'
    FROM (SELECT pg_temp.a317_rt('ai_agent_runtime_dispatch_targets_v1', format('%L, ''website_lead''', pg_temp.a317_id(1))) AS t) x)
  AND jsonb_array_length(pg_temp.a317_rt('ai_agent_runtime_dispatch_targets_v1', format('%L, ''whatsapp_inbound''', pg_temp.a317_id(1)))) = 1
  AND jsonb_array_length(pg_temp.a317_rt('ai_agent_runtime_dispatch_targets_v1', format('%L, ''website_lead''', pg_temp.a317_id(2)))) = 0
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_runtime_dispatch_targets_v1', format('%L, ''command''', pg_temp.a317_id(1)))) = '22023',
  'dispatch targets: enabled + synced + the trigger flag only; the director (never synced) and other organizations are not targets');
-- Scheduled runs found by the reconciliation: created once, orphan actions linked.
SELECT pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''director'', ''get_my_settings'', ''{}''::jsonb, ''ok'', NULL, 5', pg_temp.a317_id(1))) AS a317_l0 \gset
SELECT pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''director'', ''funnel_stats'', %L::jsonb, ''error'', ''invalid_arguments'', 7', pg_temp.a317_id(1), '{"from":"2026-10-01","to":"2026-10-07","source":"website"}')) AS a317_l1 \gset
UPDATE platform_private.ai_agent_actions SET at = clock_timestamp() - INTERVAL '10 seconds' WHERE agent_key = 'director';
SELECT pg_temp.a317_assert((SELECT count(*) = 2 AND bool_and(run_id IS NULL) FROM platform_private.ai_agent_actions WHERE agent_key = 'director')
  AND (SELECT argsummary FROM (SELECT args_summary AS argsummary FROM platform_private.ai_agent_actions WHERE tool = 'funnel_stats') x) = 'from=2026-10-01; source=website; to=2026-10-07',
  'with no open run the action rows are orphans; the argument summary keeps short scalars');
SELECT pg_temp.a317_rt('ai_agent_runtime_scheduled_run_upsert_v1', format('%L, ''director'', ''sess_sched_1'', %L, ''completed''', pg_temp.a317_id(1), clock_timestamp() - INTERVAL '1 minute')) AS a317_su1 \gset
SELECT pg_temp.a317_assert((:'a317_su1'::JSONB) ->> 'created' = 'true'
  AND (SELECT r.trigger_kind = 'schedule' AND r.status = 'completed' AND r.ended_at IS NOT NULL AND r.dedupe_key IS NULL
      FROM platform_private.ai_agent_runs r WHERE r.id = ((:'a317_su1'::JSONB) ->> 'runId')::UUID)
  AND (SELECT count(*) = 2 AND bool_and(run_id = ((:'a317_su1'::JSONB) ->> 'runId')::UUID) FROM platform_private.ai_agent_actions WHERE agent_key = 'director')
  AND (pg_temp.a317_rt('ai_agent_runtime_scheduled_run_upsert_v1', format('%L, ''director'', ''sess_sched_1'', %L, ''completed''', pg_temp.a317_id(1), clock_timestamp()))
      = jsonb_build_object('runId', (:'a317_su1'::JSONB) ->> 'runId', 'created', FALSE))
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE action = 'ai.agent.run.start' AND resource_id = ((:'a317_su1'::JSONB) ->> 'runId')::UUID),
  'a scheduled run found later is created once (trigger schedule), links the orphan actions and journals its start once');
-- The action log: one open run is the run of the action; the summary hides texts and secrets.
SELECT pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', ''search_clients'', %L::jsonb, ''ok'', NULL, 12', pg_temp.a317_id(1),
  '{"query":"айбек SECRET-QUERY","limit":5,"cursor":"abcdef"}')) AS a317_l2 \gset
SELECT pg_temp.a317_assert((SELECT x.run_id IS NULL AND x.args_summary = 'cursor=<6 симв.>; limit=5; query=<18 симв.>' AND x.result_status = 'ok' AND x.duration_ms = 12
      FROM platform_private.ai_agent_actions x WHERE x.id = ((:'a317_l2'::JSONB) ->> 'actionId')::BIGINT),
  'two open runs of the agent: the action is not attached to either; cursor and query are replaced by their length: '
    || (SELECT x.args_summary FROM platform_private.ai_agent_actions x WHERE x.id = ((:'a317_l2'::JSONB) ->> 'actionId')::BIGINT));
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a317_run2' AND status = 'starting';
SELECT pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', ''send_message'', %L::jsonb, ''error'', ''whatsapp_unavailable'', 3', pg_temp.a317_id(1),
  '{"channel":"whatsapp","text":"секретный текст","authority_code":"CODE-317-A","idempotency_key":"k1","reason":"r"}')) AS a317_l3 \gset
SELECT pg_temp.a317_assert((SELECT count(*) = 1 FROM platform_private.ai_agent_runs WHERE agent_key = 'sales' AND status IN ('starting', 'running'))
  AND (SELECT x.args_summary = 'authority_code=<10 симв.>; channel=whatsapp; idempotency_key=<2 симв.>; reason=<1 симв.>; text=<15 симв.>' AND x.error_code = 'whatsapp_unavailable'
        AND x.result_status = 'error' AND x.run_id = (SELECT id FROM platform_private.ai_agent_runs WHERE agent_key = 'sales' AND status IN ('starting', 'running'))
      FROM platform_private.ai_agent_actions x WHERE x.id = ((:'a317_l3'::JSONB) ->> 'actionId')::BIGINT)
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_actions x WHERE x.args_summary LIKE '%CODE-317%' OR x.args_summary LIKE '%секретный%' OR x.args_summary LIKE '%SECRET%'),
  'exactly one open run: the action belongs to it; the authority code, the message text and the key never reach the summary');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', ''no_such_tool'', ''{}''::jsonb, ''ok'', NULL, 1', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', ''search_clients'', ''{}''::jsonb, ''weird'', NULL, 1', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''nope'', ''search_clients'', ''{}''::jsonb, ''ok'', NULL, 1', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_mcp_log_v1(%L, ''sales'', ''search_clients'', ''{}''::jsonb, ''ok'', NULL, 1)', pg_temp.a317_id(1)))) = '42501',
  'the log refuses an unknown tool, status or agent and every non-service caller');
-- The cap of three open command runs (staff authorization).
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, NULL, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(304))) AS a317_cap1 \gset
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, NULL, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(304))) AS a317_cap2 \gset
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, NULL, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(304))) AS a317_cap3 \gset
SELECT pg_temp.a317_assert((SELECT count(*) = 3 FROM platform_private.ai_agent_runs WHERE agent_key = 'sales' AND trigger_kind = 'command' AND status IN ('starting', 'running'))
  AND pg_temp.a317_msg(pg_temp.a317_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, ''sales'')', pg_temp.a317_id(1)))) = 'run_in_progress',
  'three open command runs: the fourth is refused (run_in_progress)');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE agent_key = 'sales' AND status IN ('starting', 'running');
SELECT pg_temp.a317_assert((SELECT count(*) = 0 FROM platform_private.ai_agent_runs WHERE status IN ('starting', 'running')),
  'all runs closed for the scenarios that follow');
-- The staff readers see the runs: ordering, paging and the counters.
SELECT pg_temp.a317_staff(3, format('SELECT platform.ai_agents_runs_list_v1(%L, ''sales'', 2)', pg_temp.a317_id(1))) AS a317_rl \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_rl'::JSONB) -> 'runs') = 2 AND (:'a317_rl'::JSONB) ->> 'hasMore' = 'true'
  AND (SELECT bool_and(e ->> 'agentKey' = 'sales') FROM jsonb_array_elements((:'a317_rl'::JSONB) -> 'runs') e)
  AND ((:'a317_rl'::JSONB) -> 'runs' -> 0 ->> 'startedAt')::TIMESTAMPTZ >= ((:'a317_rl'::JSONB) -> 'runs' -> 1 ->> 'startedAt')::TIMESTAMPTZ
  AND jsonb_array_length(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_runs_list_v1(%L, ''sales'', 100)', pg_temp.a317_id(1))) -> 'runs') = 6
  AND pg_temp.a317_staff(3, format('SELECT platform.ai_agents_runs_list_v1(%L, ''sales'', 100)', pg_temp.a317_id(1))) ->> 'hasMore' = 'false',
  'runs list: newest first, limit + hasMore, six runs of the sales agent so far');
SELECT pg_temp.a317_staff(3, format('SELECT platform.ai_agents_run_get_v1(%L, %L)', pg_temp.a317_id(1), :'a317_run1')) AS a317_rg1 \gset
SELECT pg_temp.a317_assert((:'a317_rg1'::JSONB) -> 'run' ->> 'status' = 'completed' AND (:'a317_rg1'::JSONB) -> 'run' ->> 'startedByName' = 'A317 Actor 1'
  AND (:'a317_rg1'::JSONB) -> 'run' ->> 'sendAuthority' = 'true' AND NOT ((:'a317_rg1'::JSONB)::TEXT LIKE '%send_authority_sha256%')
  AND NOT ((:'a317_rg1'::JSONB)::TEXT LIKE '%' || encode(sha256(convert_to('CODE-317-A', 'UTF8')), 'hex') || '%')
  AND (:'a317_rg1'::JSONB) -> 'run' ->> 'durationSeconds' IS NOT NULL AND (:'a317_rg1'::JSONB) -> 'run' ->> 'costCents' = '9',
  'the run page: who started it, authority flag only (no hash), duration, spend');
SELECT pg_temp.a317_staff(1, format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a317_id(1))) AS a317_sales2 \gset
SELECT pg_temp.a317_assert((:'a317_sales2'::JSONB) -> 'stats' ->> 'runs7d' = '6' AND (:'a317_sales2'::JSONB) -> 'stats' ->> 'costCents7d' = '9'
  AND (:'a317_sales2'::JSONB) -> 'stats' ->> 'runsRunning' = '0' AND (:'a317_sales2'::JSONB) -> 'stats' ->> 'actions7d' = '2'
  AND (:'a317_sales2'::JSONB) -> 'stats' ->> 'lastRunStatus' = 'completed'
  AND (SELECT sum((e ->> 'count')::INTEGER) = 6 FROM jsonb_array_elements((:'a317_sales2'::JSONB) -> 'charts' -> 'runsPerDay') e)
  AND (SELECT sum((e ->> 'costCents')::INTEGER) = 9 FROM jsonb_array_elements((:'a317_sales2'::JSONB) -> 'charts' -> 'spendPerDay') e)
  AND (:'a317_sales2'::JSONB) -> 'charts' -> 'actionsByTool' -> 0 ->> 'count' = '1'
  AND (SELECT sum(v::INTEGER) = 6 FROM jsonb_array_elements_text((:'a317_sales2'::JSONB) -> 'stats' -> 'runsPerDay14') v),
  'the agent page numbers: runs, spend, actions, last status; the charts add up to the same totals: ' || ((:'a317_sales2'::JSONB) -> 'stats')::TEXT);

-- ---------------------------------------------------------------------------
-- 7. Domain fixture for the tools. WhatsApp conversations come through the REAL WAHA projection chain (the intake
--    owner is the Admin); the rest is seeded as the owner with triggers off (synthetic rows only).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a317_clock AS SELECT date_trunc('second', clock_timestamp()) AS t0;
GRANT SELECT ON a317_clock TO authenticated, service_role;
CREATE FUNCTION pg_temp.a317_ago(p_seconds INTEGER) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE AS $$
  SELECT t0 - p_seconds * INTERVAL '1 second' FROM a317_clock
$$;
CREATE SEQUENCE pg_temp.a317_seq;
CREATE FUNCTION pg_temp.a317_run(p_payload JSONB, p_at TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.a317_id(1);
  n CONSTANT INTEGER := nextval('pg_temp.a317_seq')::INTEGER;
  event_id CONSTANT UUID := pg_temp.a317_id(20000 + n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'a317-' || n, 'crm_primary',
    p_payload ->> 'id', 'message.any', p_at,
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:a317:' || n, lpad(to_hex(3170000 + n), 64, '0'), pg_temp.a317_id(25000 + n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('a317-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8,
    pg_temp.a317_id(30000 + n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'a317', pg_temp.a317_id(30000 + n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.a317_id(301), pg_temp.a317_id(30000 + n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.a317_id(30000 + n * 10 + 4));
  IF proj ->> 'disposition' IS DISTINCT FROM 'succeeded' THEN
    RAISE EXCEPTION 'A317: projection failed: %', proj;
  END IF;
  RETURN proj;
END
$$;
CREATE FUNCTION pg_temp.a317_in(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.a317_ago(p_seconds_ago);
  wid TEXT := 'false_' || chat || '_A317' || lpad(nextval('pg_temp.a317_seq')::TEXT, 15, '0');
BEGIN
  PERFORM pg_temp.a317_run(jsonb_build_object('id', wid, 'timestamp', extract(epoch FROM at)::BIGINT, 'from', chat,
    'fromMe', false, 'source', 'app', 'body', p_body), at);
  RETURN (SELECT m.id FROM platform.communication_messages m JOIN platform_private.waha_message_bindings b
    ON b.organization_id = m.organization_id AND b.communication_message_id = m.id WHERE b.raw_message_id = wid);
END
$$;
CREATE FUNCTION pg_temp.a317_out(p_chat INTEGER, p_body TEXT, p_seconds_ago INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE chat TEXT := '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'; at TIMESTAMPTZ := pg_temp.a317_ago(p_seconds_ago);
BEGIN
  PERFORM pg_temp.a317_run(jsonb_build_object('id', 'true_' || chat || '_A317' || lpad(nextval('pg_temp.a317_seq')::TEXT, 15, '0'),
    'timestamp', extract(epoch FROM at)::BIGINT, 'from', '79967700000@c.us', 'to', chat, 'fromMe', true, 'source', 'app',
    'body', p_body), at);
END
$$;
CREATE FUNCTION pg_temp.a317_conv(p_chat INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.a317_id(1) AND binding.normalized_chat_id = '7996770' || lpad(p_chat::TEXT, 4, '0') || '@c.us'
$$;
CREATE TEMP TABLE a317_m(label TEXT PRIMARY KEY, id UUID);
GRANT SELECT ON a317_m TO authenticated, service_role;
INSERT INTO a317_m VALUES ('c1a', pg_temp.a317_in(1, 'Здравствуйте, хочу учиться в Китае', 7200));
INSERT INTO a317_m VALUES ('c1b', pg_temp.a317_in(1, 'Сколько стоит обучение?', 7100));
INSERT INTO a317_m VALUES ('c2a', pg_temp.a317_in(2, 'Добрый день', 7000));
SELECT pg_temp.a317_out(2, 'Здравствуйте! Чем помочь?', 6900);
INSERT INTO a317_m VALUES ('c3a', pg_temp.a317_in(3, 'Вопрос по документам', 6800));
SELECT pg_temp.a317_conv(1) AS a317_c1, pg_temp.a317_conv(2) AS a317_c2, pg_temp.a317_conv(3) AS a317_c3 \gset
SELECT pg_temp.a317_assert(:'a317_c1' IS NOT NULL AND :'a317_c2' IS NOT NULL AND :'a317_c3' IS NOT NULL
  AND (SELECT count(*) = 3 FROM platform.communication_messages WHERE conversation_id = :'a317_c1'::UUID
      OR conversation_id = :'a317_c2'::UUID OR conversation_id = :'a317_c3'::UUID) IS NOT NULL
  AND (SELECT count(*) = 2 FROM platform.communication_messages WHERE conversation_id = :'a317_c1'::UUID AND direction = 'inbound'),
  'fixture: three WhatsApp conversations through the real projection chain');

-- Seeded rows (owner, triggers off): clients, leads, cases, documents, payments, register, catalog, knowledge, calls.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email, phone, normalized_phone,
  lifecycle_state, created_at, updated_at)
SELECT c.id, c.org, c.name, platform_private.normalize_person_name(c.name), c.email,
  platform_private.normalize_person_email(c.email), c.phone, platform_private.normalize_person_phone(c.phone), 'active', c.created, c.created
FROM (VALUES
  (pg_temp.a317_id(501), pg_temp.a317_id(1), 'A317 Клиент Один', 'a317.client1@example.invalid', '+996555317001', pg_temp.a317_ago(86400 * 10)),
  (pg_temp.a317_id(502), pg_temp.a317_id(1), 'A317 Клиент Два', 'a317.client2@example.invalid', '+996555317002', pg_temp.a317_ago(86400 * 12)),
  (pg_temp.a317_id(503), pg_temp.a317_id(2), 'A317 Чужой Клиент', NULL::TEXT, '+996555317003', pg_temp.a317_ago(86400))
) AS c(id, org, name, email, phone, created);
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  next_action_text, next_action_due_date, interest_direction, created_at, updated_at) VALUES
  (pg_temp.a317_id(601), pg_temp.a317_id(1), pg_temp.a317_id(501), pg_temp.a317_id(302), 'qualified', 'website', 'open',
    'Позвонить клиенту', (clock_timestamp() + INTERVAL '1 day')::DATE, 'CN', pg_temp.a317_ago(86400 * 5), pg_temp.a317_ago(86400)),
  (pg_temp.a317_id(602), pg_temp.a317_id(1), pg_temp.a317_id(502), pg_temp.a317_id(302), 'new', 'whatsapp', 'open',
    NULL, NULL, 'MY', pg_temp.a317_ago(86400 * 12), pg_temp.a317_ago(86400 * 10)),
  (pg_temp.a317_id(603), pg_temp.a317_id(2), pg_temp.a317_id(503), NULL, 'new', 'website', 'open', NULL, NULL, 'CN',
    pg_temp.a317_ago(86400), pg_temp.a317_ago(86400)),
  (pg_temp.a317_id(604), pg_temp.a317_id(1), pg_temp.a317_id(502), pg_temp.a317_id(301), 'potential', 'website', 'converted',
    NULL, NULL, 'MY', pg_temp.a317_ago(86400 * 40), pg_temp.a317_ago(86400 * 30));
INSERT INTO platform_private.sales_lead_workflow_receipts (request_id, organization_id, actor_membership_id, actor_profile_id, lead_id,
  expected_workflow_version, desired_stage_key, clear_next_action, resulting_workflow_version, result, created_at) VALUES
  (pg_temp.a317_id(3001), pg_temp.a317_id(1), pg_temp.a317_id(301), pg_temp.a317_id(201), pg_temp.a317_id(601), 1, 'new', TRUE, 2, '{}', pg_temp.a317_ago(86400 * 4)),
  (pg_temp.a317_id(3002), pg_temp.a317_id(1), pg_temp.a317_id(301), pg_temp.a317_id(201), pg_temp.a317_id(601), 2, 'qualified', TRUE, 3, '{}', pg_temp.a317_ago(86400 * 2));
INSERT INTO platform_private.lead_sale_conditions (lead_id, organization_id, fields, updated_by_membership_id) VALUES
  (pg_temp.a317_id(601), pg_temp.a317_id(1), '{"program":"Computer Science","price_note":"по прайсу"}', pg_temp.a317_id(301));
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, canonical_client_id, canonical_lead_id, next_action,
  created_at, updated_at) VALUES
  (pg_temp.a317_id(701), pg_temp.a317_id(1), pg_temp.a317_id(305), pg_temp.a317_id(301), pg_temp.a317_id(302), 'a317-case-1',
    'A317 Клиент Один', 'China', 'bachelor', 'CN', '2027-09', 'intake', 'active', pg_temp.a317_ago(86400 * 3), NULL, pg_temp.a317_id(401), 1, 'CN', 'documents',
    pg_temp.a317_id(501), pg_temp.a317_id(601), 'Собрать документы', pg_temp.a317_ago(86400 * 4), pg_temp.a317_ago(3600)),
  (pg_temp.a317_id(702), pg_temp.a317_id(1), NULL, pg_temp.a317_id(301), NULL, 'a317-case-2',
    'A317 Клиент Два', 'Malaysia', 'master', 'MY', '2027-02', 'intake', 'pending', NULL, NULL, pg_temp.a317_id(401), 1, 'MY', 'new',
    pg_temp.a317_id(502), pg_temp.a317_id(602), NULL, pg_temp.a317_ago(86400 * 3), pg_temp.a317_ago(7200)),
  (pg_temp.a317_id(703), pg_temp.a317_id(2), NULL, pg_temp.a317_id(306), NULL, 'a317-case-3', 'A317 Чужой Студент', 'China', 'bachelor', 'CN', NULL,
    'intake', 'pending', NULL, NULL, pg_temp.a317_id(402), 1, 'CN', 'new', pg_temp.a317_id(503), pg_temp.a317_id(603), NULL,
    pg_temp.a317_ago(86400), pg_temp.a317_ago(86400)),
  (pg_temp.a317_id(704), pg_temp.a317_id(1), NULL, pg_temp.a317_id(301), pg_temp.a317_id(302), 'a317-case-4', 'A317 Закрытое Дело', 'China', 'bachelor', 'CN', NULL,
    'intake', 'closed', pg_temp.a317_ago(86400 * 45), pg_temp.a317_ago(86400 * 40), pg_temp.a317_id(401), 1, 'CN', 'new', NULL, NULL, NULL,
    pg_temp.a317_ago(86400 * 50), pg_temp.a317_ago(86400 * 40));
-- Conversations belong to the people above.
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a317_id(501), canonical_lead_id = pg_temp.a317_id(601)
  WHERE id = :'a317_c1'::UUID;
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.a317_id(502), canonical_lead_id = pg_temp.a317_id(602)
  WHERE id = :'a317_c2'::UUID;
-- The projection chain created its own client and open lead for every new number: drop them so the counts below are the fixture's.
UPDATE platform.communication_conversations SET canonical_client_id = NULL, canonical_lead_id = NULL WHERE id = :'a317_c3'::UUID;
DELETE FROM platform.leads WHERE organization_id = pg_temp.a317_id(1)
  AND id NOT IN (pg_temp.a317_id(601), pg_temp.a317_id(602), pg_temp.a317_id(604));
DELETE FROM platform.clients WHERE organization_id = pg_temp.a317_id(1) AND id NOT IN (pg_temp.a317_id(501), pg_temp.a317_id(502));
-- Documents of case 701: an approved passport, a missing certificate, an oversized and an infected file.
INSERT INTO platform.document_requirements (id, organization_id, target_country, target_degree, program_direction, checklist_version,
  requirement_key, label, instructions, created_by_membership_id) VALUES
  (pg_temp.a317_id(801), pg_temp.a317_id(1), 'China', 'bachelor', 'CN', 1, 'passport', 'Паспорт', 'Скан разворота', pg_temp.a317_id(301)),
  (pg_temp.a317_id(802), pg_temp.a317_id(1), 'China', 'bachelor', 'CN', 1, 'certificate', 'Аттестат', 'Скан аттестата', pg_temp.a317_id(301));
INSERT INTO platform.document_slots (id, organization_id, student_case_id, requirement_id, status, deadline, current_version_id,
  current_version_no, created_by_membership_id, created_at, updated_at, intent_kind, display_label, group_label) VALUES
  (pg_temp.a317_id(811), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(801), 'approved', NULL, pg_temp.a317_id(821), 1, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 3), pg_temp.a317_ago(86400), 'baseline', NULL, NULL),
  (pg_temp.a317_id(812), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(802), 'required', clock_timestamp() + INTERVAL '5 days', NULL, NULL, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 3), pg_temp.a317_ago(86400 * 3), 'baseline', NULL, NULL),
  (pg_temp.a317_id(813), pg_temp.a317_id(1), pg_temp.a317_id(701), NULL, 'submitted', NULL, pg_temp.a317_id(823), 1, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 2), pg_temp.a317_ago(86400 * 2), 'custom', 'Огромный файл', 'Прочее'),
  (pg_temp.a317_id(814), pg_temp.a317_id(1), pg_temp.a317_id(701), NULL, 'submitted', NULL, pg_temp.a317_id(824), 1, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 2), pg_temp.a317_ago(86400 * 2), 'custom', 'Заражённый файл', 'Прочее');
-- The 25 MiB column limit would hide the tool's own size check: lift it inside this rolled-back transaction.
ALTER TABLE platform.document_versions DROP CONSTRAINT document_versions_byte_size_check;
INSERT INTO platform.document_versions (id, organization_id, student_case_id, document_slot_id, version_no, original_filename, declared_mime_type,
  byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id, integrity_status, malware_status, malware_scan_attestation_id, created_at) VALUES
  (pg_temp.a317_id(821), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(811), 1, 'passport.pdf', 'application/pdf', 12345, repeat('a', 64), 'ev:821', pg_temp.a317_id(305), 'verified', 'clean', pg_temp.a317_id(861), pg_temp.a317_ago(86400 * 2)),
  (pg_temp.a317_id(823), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(813), 1, 'huge.pdf', 'application/pdf', 30000000, repeat('b', 64), 'ev:823', pg_temp.a317_id(305), 'verified', 'clean', pg_temp.a317_id(863), pg_temp.a317_ago(86400 * 2)),
  (pg_temp.a317_id(824), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(814), 1, 'virus.pdf', 'application/pdf', 100, repeat('c', 64), 'ev:824', pg_temp.a317_id(305), 'verified', 'infected', NULL, pg_temp.a317_ago(86400 * 2));
INSERT INTO platform_private.document_storage_bindings (id, organization_id, student_case_id, document_slot_id, document_version_id,
  upload_reservation_id, bucket_id, object_name) VALUES
  (pg_temp.a317_id(831), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(811), pg_temp.a317_id(821), pg_temp.a317_id(841), 'platform-documents', 'aa/' || repeat('1', 62)),
  (pg_temp.a317_id(833), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(813), pg_temp.a317_id(823), pg_temp.a317_id(843), 'platform-documents', 'bb/' || repeat('2', 62)),
  (pg_temp.a317_id(834), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(814), pg_temp.a317_id(824), pg_temp.a317_id(844), 'platform-documents', 'cc/' || repeat('3', 62));
INSERT INTO platform.document_reviews (id, organization_id, student_case_id, document_slot_id, document_version_id, decision, reason,
  reviewer_membership_id, request_id, created_at) VALUES
  (pg_temp.a317_id(851), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(811), pg_temp.a317_id(821), 'approved', 'Читается, срок действия в порядке', pg_temp.a317_id(302), pg_temp.a317_id(852), pg_temp.a317_ago(86400));
-- Money: one overdue service-fee obligation (400 of 1000 paid), one paid third-party cost.
INSERT INTO platform.payment_obligations (id, organization_id, student_case_id, label, category, amount_minor, currency, due_at,
  total_paid_minor, created_by_membership_id, created_at) VALUES
  (pg_temp.a317_id(901), pg_temp.a317_id(1), pg_temp.a317_id(701), 'Первый платёж', 'evo_service_fee', 100000, 'USD', clock_timestamp() - INTERVAL '3 days', 40000, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 4)),
  (pg_temp.a317_id(902), pg_temp.a317_id(1), pg_temp.a317_id(701), 'Вступительный взнос', 'third_party_cost', 50000, 'USD', clock_timestamp() + INTERVAL '10 days', 50000, pg_temp.a317_id(301), pg_temp.a317_ago(86400 * 4));
INSERT INTO platform.payment_events (id, organization_id, student_case_id, payment_obligation_id, event_type, amount_minor, currency,
  occurred_at, source_key, actor_membership_id, request_id) VALUES
  (pg_temp.a317_id(911), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(901), 'payment', 40000, 'USD', pg_temp.a317_ago(86400 * 2), 'manual', pg_temp.a317_id(301), pg_temp.a317_id(912)),
  (pg_temp.a317_id(913), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(902), 'payment', 50000, 'USD', pg_temp.a317_ago(86400), 'manual', pg_temp.a317_id(301), pg_temp.a317_id(914));
INSERT INTO platform.university_applications (id, organization_id, student_case_id, institution_name, program_name, status, is_primary,
  university_deadline_on, country, degree, created_by_membership_id) VALUES
  (pg_temp.a317_id(1001), pg_temp.a317_id(1), pg_temp.a317_id(701), 'Test University of Hangzhou', 'Computer Science', 'preparation', TRUE,
    (clock_timestamp() + INTERVAL '20 days')::DATE, 'CN', 'bachelor', pg_temp.a317_id(301));
INSERT INTO platform.student_profiles (id, organization_id, student_case_id, consent_status, created_by_membership_id, updated_by_membership_id,
  preferred_display_name, citizenship_country, current_education_summary, date_of_birth) VALUES
  (pg_temp.a317_id(1051), pg_temp.a317_id(1), pg_temp.a317_id(701), 'not_recorded', pg_temp.a317_id(301), pg_temp.a317_id(301),
    'Клиент', 'KG', 'Школа №1, 11 класс', DATE '2008-05-17');
-- Chat of the case.
INSERT INTO platform.case_chat_messages (id, organization_id, student_case_id, author_membership_id, body, created_at) VALUES
  (pg_temp.a317_id(1061), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(305), 'Какие документы ещё нужны?', pg_temp.a317_ago(5000)),
  (pg_temp.a317_id(1062), pg_temp.a317_id(1), pg_temp.a317_id(701), pg_temp.a317_id(302), 'Пришлите аттестат, пожалуйста.', pg_temp.a317_ago(4000));
-- Sales register (September 2026): three sales and one withdrawn.
INSERT INTO platform_private.sales_register (id, organization_id, report_month, fields, withdrawn_at, withdrawal_kind, withdrawn_by_membership_id) VALUES
  (pg_temp.a317_id(1101), pg_temp.a317_id(1), DATE '2026-09-01', '{"applicant_name":"П1","country":"China","direction":"CN","manager_label":"Менеджер А","service_cost_minor":100000,"service_cost_currency":"USD","paid_minor":40000,"paid_currency":"USD"}', NULL, NULL, NULL),
  (pg_temp.a317_id(1102), pg_temp.a317_id(1), DATE '2026-09-01', '{"applicant_name":"П2","country":"Malaysia","direction":"MY","manager_label":"Менеджер Б","service_cost_minor":80000,"service_cost_currency":"USD","paid_minor":80000,"paid_currency":"USD"}', NULL, NULL, NULL),
  (pg_temp.a317_id(1103), pg_temp.a317_id(1), DATE '2026-10-01', '{"applicant_name":"П3","country":"China","direction":"CN","manager_label":"Менеджер А","service_cost_minor":5000000,"service_cost_currency":"KGS","paid_minor":0,"paid_currency":"KGS"}', NULL, NULL, NULL),
  (pg_temp.a317_id(1104), pg_temp.a317_id(1), DATE '2026-09-01', '{"applicant_name":"П4","country":"China","direction":"CN","manager_label":"Менеджер А","service_cost_minor":90000,"service_cost_currency":"USD","paid_minor":0,"paid_currency":"USD"}', pg_temp.a317_ago(86400), 'unpaid', pg_temp.a317_id(301)),
  (pg_temp.a317_id(1105), pg_temp.a317_id(2), DATE '2026-09-01', '{"applicant_name":"Чужой","country":"China","direction":"CN","manager_label":"Чужой","service_cost_minor":999999,"service_cost_currency":"USD","paid_minor":0,"paid_currency":"USD"}', NULL, NULL, NULL);
-- Catalog: one institution with a published program and published costs.
INSERT INTO platform.catalog_institutions (id, organization_id, institution_kind, institution_name, country_code, city, source_registry_id,
  source_revision, import_batch_id, source_record_key, approved_by_membership_id) VALUES
  (pg_temp.a317_id(1201), pg_temp.a317_id(1), 'university', 'Test University of Hangzhou', 'CN', 'Hangzhou', pg_temp.a317_id(1291), 'revision-317', pg_temp.a317_id(1292), 'rec_' || repeat('a', 32), pg_temp.a317_id(301));
INSERT INTO platform_private.university_catalog_publications (id, organization_id, institution_id, base_version, version, content, source_registry_id,
  status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at) VALUES
  (pg_temp.a317_id(1211), pg_temp.a317_id(1), pg_temp.a317_id(1201), 0, 1,
    '{"name":"Test University of Hangzhou","country":"CN","city":"Hangzhou","overview":"Synthetic overview","websiteUrl":"https://university.edu","sourceUrl":"https://university.edu/admissions","verifiedOn":"2026-09-10","notes":"","photoKey":null,"programs":[{"id":"cs","title":"Computer Science","level":"bachelor","duration":null,"language":"en","summary":"Synthetic program","sourceUrl":"https://university.edu/programs/cs","intakes":[{"label":"Autumn","startDate":null,"startMonth":null,"applicationDeadline":null,"deadlineTime":null,"timezone":null,"status":"unknown","note":"","sourceUrl":"https://university.edu/admissions","verifiedOn":"2026-09-10"}]}]}'::JSONB,
    pg_temp.a317_id(1291), 'published', 'synthetic', pg_temp.a317_id(301), pg_temp.a317_id(301), clock_timestamp());
INSERT INTO platform.catalog_costs (id, organization_id, institution_id, program_id, study_level, teaching_language, cost_kind, period,
  amount_min_minor, currency, source_kind, source_name, source_url, verified_on, status, published_at, published_by_membership_id, request_id,
  created_by_membership_id, updated_by_membership_id) VALUES
  (pg_temp.a317_id(1221), pg_temp.a317_id(1), pg_temp.a317_id(1201), 'cs', 'bachelor', 'en', 'tuition', 'year', 450000, 'USD', 'official',
    'Official site', 'https://university.edu/fees', DATE '2026-09-10', 'published', clock_timestamp(), pg_temp.a317_id(301), pg_temp.a317_id(1222),
    pg_temp.a317_id(301), pg_temp.a317_id(301));
-- Knowledge: a client document, an internal document, CRM wiki pages (clients / internal / raw / deleted).
INSERT INTO platform_private.ai_documents (id, organization_id, title, kind, audience, status, source) VALUES
  (pg_temp.a317_id(1301), pg_temp.a317_id(1), 'Цены Китай', 'knowledge', 'client', 'ready', 'seed_kb'),
  (pg_temp.a317_id(1302), pg_temp.a317_id(1), 'Внутренний регламент', 'text', 'internal', 'ready', 'upload'),
  (pg_temp.a317_id(1303), pg_temp.a317_id(1), 'Устаревший документ', 'text', 'client', 'superseded', 'upload');
INSERT INTO platform_private.ai_chunks (organization_id, document_id, position, section_path, content, context, lang) VALUES
  (pg_temp.a317_id(1), pg_temp.a317_id(1301), 1, 'Китай / Стоимость', 'Стоимость обучения в Китае начинается от трёх тысяч долларов в год', '', 'ru'),
  (pg_temp.a317_id(1), pg_temp.a317_id(1302), 1, 'Регламент', 'Внутренний регламент куратора: проверять паспорт студента перед подачей', '', 'ru'),
  (pg_temp.a317_id(1), pg_temp.a317_id(1303), 1, 'Старое', 'Стоимость обучения в Китае начиналась от двух тысяч долларов', '', 'ru');
INSERT INTO platform_private.kb_nodes (id, organization_id, area, kind, title, body, updated_by, deleted_at) VALUES
  (pg_temp.a317_id(1311), pg_temp.a317_id(1), 'clients', 'page', 'Виза в Китай', 'Для визы нужен паспорт и приглашение университета', pg_temp.a317_id(301), NULL),
  (pg_temp.a317_id(1312), pg_temp.a317_id(1), 'internal', 'page', 'Порядок звонков', 'Звонить клиенту нужно в течение часа после заявки', pg_temp.a317_id(301), NULL),
  (pg_temp.a317_id(1313), pg_temp.a317_id(1), 'raw', 'page', 'Сырой архив', 'сырой архив содержит слово ZETAQ приглашение', pg_temp.a317_id(301), NULL),
  (pg_temp.a317_id(1314), pg_temp.a317_id(1), 'internal', 'page', 'Удалено', 'удалённая страница про приглашение', pg_temp.a317_id(301), clock_timestamp());
-- Calls, staff directions, the WhatsApp session health.
INSERT INTO platform_private.telephony_calls (id, organization_id, pbx_callid, direction, state, outcome, outcome_source, started_at, ended_at, talk_seconds,
  client_phone, client_id, lead_id, membership_id, match_state, created_via, result_code, result_at, result_by) VALUES
  (pg_temp.a317_id(1401), pg_temp.a317_id(1), 'pbx-317-1', 'in', 'ended', 'answered', 'webhook', pg_temp.a317_ago(86400), pg_temp.a317_ago(86400 - 90), 60,
    '+996555317001', pg_temp.a317_id(501), pg_temp.a317_id(601), pg_temp.a317_id(302), 'matched', 'webhook', 'reached', pg_temp.a317_ago(86000), pg_temp.a317_id(302));
INSERT INTO platform.staff_direction_assignments (organization_id, membership_id, direction_code) VALUES
  (pg_temp.a317_id(1), pg_temp.a317_id(302), 'CN'), (pg_temp.a317_id(1), pg_temp.a317_id(304), 'MY');
INSERT INTO platform.waha_session_health (organization_id, waha_session_name, status, observed_at) VALUES
  (pg_temp.a317_id(1), 'crm_primary', 'WORKING', clock_timestamp());
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a317_assert((SELECT count(*) = 2 FROM platform_private.ai_chunks c WHERE c.organization_id = pg_temp.a317_id(1) AND c.document_id IN (pg_temp.a317_id(1301), pg_temp.a317_id(1302))),
  'fixture: domain rows are in');

-- ---------------------------------------------------------------------------
-- 8. The tools. Common rules first, then one scenario per tool. Organization 2 gets its sales agent switched on so that
--    its (separate) data can be asked for.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_upd(6, 'sales', 1, '{"enabled":true}', 2900, 2) AS a317_u_org2 \gset
SELECT pg_temp.a317_upd(6, 'director', 1, '{"enabled":true}', 2901, 2) AS a317_u_org2b \gset
SELECT pg_temp.a317_assert(
  pg_temp.a317_msg(pg_temp.a317_tool('search_clients', 'curator-cn', '{"query":"аб"}')) = 'agent_disabled'
  AND pg_temp.a317_err(pg_temp.a317_tool('search_clients', 'curator-cn', '{"query":"аб"}')) = '55000'
  AND pg_temp.a317_err(pg_temp.a317_tool('search_clients', 'nope', '{"query":"аб"}')) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('search_clients', 'sales', '[]')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_svc(format('SELECT platform.ai_agent_tool_search_clients_v1(%L, ''sales'', NULL)', pg_temp.a317_id(1)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('search_clients', 'sales', '{"query":"аб"}', 9)) = 'P0002',
  'common: a disabled agent is refused (55000 agent_disabled), an unknown agent or organization is P0002, non-object arguments are 22023');
SELECT pg_temp.a317_assert((
  SELECT bool_and(pg_temp.a317_err(pg_temp.a317_tool(v.tool, 'sales', v.args)) = '22023')
  FROM (VALUES
    ('search_clients', '{"query":"аб","zzz":1}'), ('search_clients', '{"query":"а"}'), ('search_clients', '{}'),
    ('search_clients', '{"query":"аб","limit":101}'), ('search_clients', '{"query":"аб","limit":0}'),
    ('search_clients', '{"query":"аб","limit":"5"}'), ('search_clients', '{"query":"аб","limit":2.5}'),
    ('search_clients', '{"query":"аб","cursor":null}'), ('list_leads', '{"state":"zzz"}'),
    ('list_leads', '{"owner_id":"not-a-uuid"}'), ('list_leads', '{"created_from":"2026-1-1"}'),
    ('list_leads', '{"created_from":"2026-13-45"}'), ('get_lead', '{"lead_id":"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"}'),
    ('get_lead', '{}'), ('get_case', '{"case_id":"31700000-0000-4000-8000-000000000701","include":[]}'),
    ('get_case', '{"case_id":"31700000-0000-4000-8000-000000000701","include":["secrets"]}'),
    ('get_case', '{"case_id":"31700000-0000-4000-8000-000000000701","include":"documents"}'),
    ('get_conversation', '{"conversation_id":"31700000-0000-4000-8000-000000000701","limit":61}'),
    ('sales_report', '{"from_month":"2026-9"}'), ('sales_report', '{"from_month":"2026-13"}'), ('sales_report', '{}'),
    ('funnel_stats', '{"from":"2026-10-01"}'), ('list_conversations', '{"queue":"all-of-them"}'),
    ('search_catalog', '{"limit":51}'), ('search_knowledge', '{"query":"аб","audience":"everyone"}'),
    ('search_knowledge', '{"query":"аб","limit":11}'), ('recent_calls', '{"days":31}'), ('recent_calls', '{"direction":"sideways"}'),
    ('list_staff', '{"direction":"XX"}'), ('get_my_settings', '{"x":1}'), ('create_task', '{"title":""}'),
    ('create_task', '{"title":"t","priority":"urgent"}'), ('add_note', '{"body":"b","extra":1}'),
    ('post_digest', '{"kind":"monthly","title":"t","body_md":"b"}'), ('post_digest', '{"kind":"note","title":"t"}'),
    ('notify_staff', '{"title":"t"}'), ('send_message', '{"channel":"sms","text":"t"}'), ('send_message', '{"channel":"whatsapp"}'),
    ('get_document_file', '{"slot_id":"x"}'), ('get_client_card', '{"client_id":5}')) AS v(tool, args)),
  'common: the tool schemas are enforced by the database (unknown keys, wrong types and bounds, patterns, enums, required keys: 22023)');

-- search_clients ---------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('search_clients', 'sales', '{"query":"Один"}') AS a317_t1 \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_t1'::JSONB) -> 'items') = 1 AND (:'a317_t1'::JSONB) -> 'next_cursor' = 'null'::JSONB
  AND (:'a317_t1'::JSONB) -> 'items' -> 0 ->> 'client_id' = pg_temp.a317_id(501)::TEXT
  AND (:'a317_t1'::JSONB) -> 'items' -> 0 ->> 'name' = 'A317 Клиент Один' AND (:'a317_t1'::JSONB) -> 'items' -> 0 ->> 'lifecycle' = 'active'
  AND (:'a317_t1'::JSONB) -> 'items' -> 0 ->> 'phone_masked' ~ '^\+996\*+01$' AND (:'a317_t1'::JSONB) -> 'items' -> 0 ->> 'email_masked' = 'a***@example.invalid'
  AND (:'a317_t1'::JSONB) -> 'items' -> 0 -> 'lead_ids' = jsonb_build_array(pg_temp.a317_id(601))
  AND (:'a317_t1'::JSONB) -> 'items' -> 0 -> 'case_ids' = jsonb_build_array(pg_temp.a317_id(701))
  AND NOT ((:'a317_t1'::JSONB)::TEXT LIKE '%555317001%' OR (:'a317_t1'::JSONB)::TEXT LIKE '%aibek.testov%'),
  'search_clients: found by name, contacts masked, linked lead and case ids, no raw phone or e-mail: ' || :'a317_t1');
SELECT pg_temp.a317_assert(
  jsonb_array_length(pg_temp.a317_tool('search_clients', 'sales', '{"query":"317001"}') -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('search_clients', 'sales', '{"query":"A317.CLIENT1"}') -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('search_clients', 'sales', '{"query":"Чужой"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_clients', 'sales', '{"query":"%%"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_clients', 'sales', '{"query":"Чужой"}', 2) -> 'items') = 1,
  'search_clients: by phone digits and by e-mail fragment (case-insensitive), another organization never, LIKE wildcards are plain text');
SELECT pg_temp.a317_tool('search_clients', 'sales', '{"query":"example","limit":1}') AS a317_p1 \gset
SELECT pg_temp.a317_tool('search_clients', 'sales', format('{"query":"example","limit":1,"cursor":%s}', to_json((:'a317_p1'::JSONB) ->> 'next_cursor'))) AS a317_p2 \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_p1'::JSONB) -> 'items') = 1 AND (:'a317_p1'::JSONB) ->> 'next_cursor' IS NOT NULL
  AND jsonb_array_length((:'a317_p2'::JSONB) -> 'items') = 1 AND (:'a317_p2'::JSONB) -> 'next_cursor' = 'null'::JSONB
  AND (:'a317_p1'::JSONB) -> 'items' -> 0 ->> 'client_id' <> (:'a317_p2'::JSONB) -> 'items' -> 0 ->> 'client_id'
  AND ((:'a317_p1'::JSONB) -> 'items' -> 0 ->> 'created_at')::TIMESTAMPTZ >= ((:'a317_p2'::JSONB) -> 'items' -> 0 ->> 'created_at')::TIMESTAMPTZ
  AND pg_temp.a317_err(pg_temp.a317_tool('search_clients', 'sales', '{"query":"example","cursor":"!!!"}')) = '22023',
  'search_clients: keyset paging by cursor (newest first, no repeat), a broken cursor is 22023');

-- get_client_card --------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a317_id(501))) AS a317_cc \gset
SELECT pg_temp.a317_assert((:'a317_cc'::JSONB) -> 'client' ->> 'name' = 'A317 Клиент Один' AND (:'a317_cc'::JSONB) -> 'client' ->> 'email_masked' = 'a***@example.invalid'
  AND jsonb_array_length((:'a317_cc'::JSONB) -> 'leads') = 1 AND (:'a317_cc'::JSONB) -> 'leads' -> 0 ->> 'stage' = 'qualified'
  AND (:'a317_cc'::JSONB) -> 'leads' -> 0 ->> 'state' = 'open' AND (:'a317_cc'::JSONB) -> 'leads' -> 0 ->> 'owner_name' = 'A317 Actor 2'
  AND jsonb_array_length((:'a317_cc'::JSONB) -> 'cases') = 1 AND (:'a317_cc'::JSONB) -> 'cases' -> 0 ->> 'curator_name' = 'A317 Actor 2'
  AND (:'a317_cc'::JSONB) -> 'cases' -> 0 ->> 'direction' = 'CN' AND (:'a317_cc'::JSONB) -> 'cases' -> 0 ->> 'state' = 'active'
  AND jsonb_array_length((:'a317_cc'::JSONB) -> 'conversations') = 1 AND (:'a317_cc'::JSONB) -> 'conversations' -> 0 ->> 'unanswered' = 'true'
  AND (:'a317_cc'::JSONB) -> 'notes' = '[]'::JSONB AND NOT ((:'a317_cc'::JSONB)::TEXT LIKE '%555317001%'),
  'client card: contacts masked, the lead / case / conversation of the client, curator and owner names, unanswered flag');
SELECT pg_temp.a317_assert(
  (pg_temp.a317_tool('get_client_card', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) -> 'client' ->> 'name') = 'A317 Клиент Один'
  AND (pg_temp.a317_tool('get_client_card', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(701))) -> 'client' ->> 'name') = 'A317 Клиент Один'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_client_card', 'sales', '{}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_client_card', 'sales', format('{"lead_id":"%s","client_id":"%s"}', pg_temp.a317_id(601), pg_temp.a317_id(501)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a317_id(503)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a317_id(9999)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_client_card', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(603)))) = 'P0002',
  'client card: by lead or case too; exactly one id is required; another organization or an unknown id is not found');

-- list_leads -------------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('list_leads', 'sales', '{}') AS a317_ll \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_ll'::JSONB) -> 'items') = 2
  AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'lead_id' = pg_temp.a317_id(601)::TEXT AND (:'a317_ll'::JSONB) -> 'items' -> 1 ->> 'lead_id' = pg_temp.a317_id(602)::TEXT
  AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'name' = 'A317 Клиент Один' AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'owner_name' = 'A317 Actor 2'
  AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'direction' = 'CN' AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'has_unanswered_chat' = 'true'
  AND (:'a317_ll'::JSONB) -> 'items' -> 1 ->> 'has_unanswered_chat' = 'false' AND (:'a317_ll'::JSONB) -> 'items' -> 0 ->> 'state' = 'open',
  'list_leads: open leads of the organization only, newest first, owner and unanswered flags');
SELECT pg_temp.a317_assert(
  (pg_temp.a317_tool('list_leads', 'sales', '{"state":"won"}') -> 'items' -> 0 ->> 'lead_id') = pg_temp.a317_id(604)::TEXT
  AND (pg_temp.a317_tool('list_leads', 'sales', '{"state":"won"}') -> 'items' -> 0 ->> 'state') = 'won'
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', '{"state":"all"}') -> 'items') = 3
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', '{"state":"lost"}') -> 'items') = 0
  AND (pg_temp.a317_tool('list_leads', 'sales', '{"stage":"qualified"}') -> 'items' -> 0 ->> 'lead_id') = pg_temp.a317_id(601)::TEXT
  AND (pg_temp.a317_tool('list_leads', 'sales', '{"source":"whatsapp"}') -> 'items' -> 0 ->> 'lead_id') = pg_temp.a317_id(602)::TEXT
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', format('{"owner_id":"%s"}', pg_temp.a317_id(302))) -> 'items') = 2
  AND (pg_temp.a317_tool('list_leads', 'sales', '{"direction":"MY"}') -> 'items' -> 0 ->> 'lead_id') = pg_temp.a317_id(602)::TEXT
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', format('{"created_from":"%s"}', (clock_timestamp() - INTERVAL '6 days')::DATE)) -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', format('{"created_to":"%s"}', (clock_timestamp() - INTERVAL '6 days')::DATE)) -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_leads', 'sales', '{}', 2) -> 'items') = 1
  AND (pg_temp.a317_tool('list_leads', 'sales', '{"limit":1}') ->> 'next_cursor') IS NOT NULL,
  'list_leads: filters by state, stage, source, owner, direction and creation dates; another organization has its own lead; paging');

-- get_lead ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) AS a317_gl \gset
SELECT pg_temp.a317_assert((:'a317_gl'::JSONB) -> 'lead' ->> 'stage' = 'qualified' AND (:'a317_gl'::JSONB) -> 'lead' ->> 'next_action' = 'Позвонить клиенту'
  AND (:'a317_gl'::JSONB) -> 'client' ->> 'name' = 'A317 Клиент Один' AND (:'a317_gl'::JSONB) -> 'client' ->> 'phone_masked' ~ '^\+996\*+01$'
  AND (SELECT array_agg(e ->> 'stage' ORDER BY ord) = ARRAY['new', 'qualified'] FROM jsonb_array_elements((:'a317_gl'::JSONB) -> 'stage_history') WITH ORDINALITY x(e, ord))
  AND (:'a317_gl'::JSONB) -> 'sale_conditions' ->> 'program' = 'Computer Science'
  AND (:'a317_gl'::JSONB) -> 'notes' = '[]'::JSONB AND (:'a317_gl'::JSONB) -> 'open_tasks' = '[]'::JSONB
  AND (:'a317_gl'::JSONB) -> 'conversation_ids' = jsonb_build_array(:'a317_c1'::UUID) AND (:'a317_gl'::JSONB) ->> 'calls_count' = '1'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(603)))) = 'P0002',
  'get_lead: the lead with its history, sale conditions, conversation ids and call count; another organization is not found');

-- list_student_cases -----------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('list_student_cases', 'sales', '{}') AS a317_lc \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_lc'::JSONB) -> 'items') = 1 AND (:'a317_lc'::JSONB) -> 'items' -> 0 ->> 'case_id' = pg_temp.a317_id(701)::TEXT
  AND (:'a317_lc'::JSONB) -> 'items' -> 0 -> 'docs' = '{"required":4,"approved":1,"submitted":2,"missing":1,"correction":0}'::JSONB
  AND (:'a317_lc'::JSONB) -> 'items' -> 0 ->> 'nearest_deadline' IS NOT NULL AND (:'a317_lc'::JSONB) -> 'items' -> 0 ->> 'curator_name' = 'A317 Actor 2'
  AND (:'a317_lc'::JSONB) -> 'items' -> 0 ->> 'pipeline_stage' = 'documents' AND (:'a317_lc'::JSONB) -> 'items' -> 0 ->> 'next_action' = 'Собрать документы',
  'list_student_cases: active cases of the organization with document counters and the nearest deadline: ' || ((:'a317_lc'::JSONB) -> 'items' -> 0)::TEXT);
SELECT pg_temp.a317_assert(
  jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', '{"state":"all"}') -> 'items') = 3
  AND (pg_temp.a317_tool('list_student_cases', 'sales', '{"state":"pending"}') -> 'items' -> 0 ->> 'case_id') = pg_temp.a317_id(702)::TEXT
  AND (pg_temp.a317_tool('list_student_cases', 'sales', '{"state":"closed"}') -> 'items' -> 0 ->> 'case_id') = pg_temp.a317_id(704)::TEXT
  AND (pg_temp.a317_tool('list_student_cases', 'sales', '{"state":"all","direction":"MY"}') -> 'items' -> 0 ->> 'case_id') = pg_temp.a317_id(702)::TEXT
  AND jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', '{"country":"CHINA"}') -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', '{"stage":"documents"}') -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', '{"stage":"intake"}') -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', format('{"curator_id":"%s"}', pg_temp.a317_id(302))) -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_student_cases', 'sales', '{"state":"all"}', 2) -> 'items') = 1,
  'list_student_cases: filters by state, direction, country, stage (operational or pipeline), curator');

-- get_case ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('get_case', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(701))) AS a317_gc \gset
SELECT pg_temp.a317_assert((:'a317_gc'::JSONB) -> 'case' ->> 'student_name' = 'A317 Клиент Один' AND (:'a317_gc'::JSONB) -> 'case' ->> 'curator_name' = 'A317 Actor 2'
  AND (:'a317_gc'::JSONB) -> 'case' ->> 'sales_name' = 'A317 Actor 1' AND NOT ((:'a317_gc'::JSONB) ? 'notes') AND NOT ((:'a317_gc'::JSONB) ? 'profile')
  AND jsonb_array_length((:'a317_gc'::JSONB) -> 'documents') = 4
  AND (SELECT e ->> 'requirement' = 'Паспорт' AND e ->> 'status' = 'approved' AND e ->> 'review_note' LIKE 'Читается%' AND e ->> 'mime_type' = 'application/pdf'
        AND e ->> 'byte_size' = '12345' AND e ->> 'latest_version_id' = pg_temp.a317_id(821)::TEXT AND e ->> 'reviewed_at' IS NOT NULL
      FROM jsonb_array_elements((:'a317_gc'::JSONB) -> 'documents') e WHERE e ->> 'slot_id' = pg_temp.a317_id(811)::TEXT)
  AND (SELECT e ->> 'status' = 'required' AND e ->> 'deadline' IS NOT NULL AND e ->> 'latest_version_id' IS NULL
      FROM jsonb_array_elements((:'a317_gc'::JSONB) -> 'documents') e WHERE e ->> 'slot_id' = pg_temp.a317_id(812)::TEXT)
  AND (:'a317_gc'::JSONB) -> 'applications' -> 0 ->> 'institution' = 'Test University of Hangzhou' AND (:'a317_gc'::JSONB) -> 'applications' -> 0 ->> 'status' = 'preparation'
  AND (:'a317_gc'::JSONB) -> 'payments' -> 'total_due' = '{"USD":"600.00"}'::JSONB AND (:'a317_gc'::JSONB) -> 'payments' -> 'total_paid' = '{"USD":"900.00"}'::JSONB
  AND (:'a317_gc'::JSONB) -> 'payments' ->> 'overdue_count' = '1' AND jsonb_array_length((:'a317_gc'::JSONB) -> 'payments' -> 'obligations') = 2
  AND (SELECT e ->> 'status' = 'overdue' AND e ->> 'amount' = '1000.00' AND e ->> 'paid' = '400.00'
      FROM jsonb_array_elements((:'a317_gc'::JSONB) -> 'payments' -> 'obligations') e WHERE e ->> 'label' = 'Первый платёж')
  AND (:'a317_gc'::JSONB) -> 'tasks' = '[]'::JSONB
  AND NOT ((:'a317_gc'::JSONB)::TEXT ~ 'payment_evidence|receipt|passport_number|bank'),
  'get_case: documents with review, applications, payments with totals and overdue, tasks; default sections only; no bank or evidence fields' || :'a317_gc');
SELECT pg_temp.a317_tool('get_case', 'sales', format('{"case_id":"%s","include":["profile","notes"]}', pg_temp.a317_id(701))) AS a317_gc2 \gset
SELECT pg_temp.a317_assert((:'a317_gc2'::JSONB) -> 'profile' ->> 'preferred_name' = 'Клиент' AND (:'a317_gc2'::JSONB) -> 'profile' ->> 'citizenship_country' = 'KG'
  AND NOT ((:'a317_gc2'::JSONB)::TEXT LIKE '%2008%' OR (:'a317_gc2'::JSONB)::TEXT LIKE '%date_of_birth%') AND (:'a317_gc2'::JSONB) -> 'notes' = '[]'::JSONB
  AND NOT ((:'a317_gc2'::JSONB) ? 'documents') AND NOT ((:'a317_gc2'::JSONB) ? 'payments')
  AND pg_temp.a317_err(pg_temp.a317_tool('get_case', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(703)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_case', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(9999)))) = 'P0002',
  'get_case: the profile section carries safe fields only (no birth date); sections are chosen by include; another organization is not found');

-- get_document_file ------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(821))) AS a317_df \gset
SELECT (:'a317_df'::JSONB) ->> 'token' AS a317_ftoken \gset
SELECT pg_temp.a317_assert(char_length(:'a317_ftoken') = 43 AND :'a317_ftoken' ~ '^[A-Za-z0-9_-]{43}$'
  AND (:'a317_df'::JSONB) ->> 'file_name' = 'passport.pdf' AND (:'a317_df'::JSONB) ->> 'mime_type' = 'application/pdf'
  AND (:'a317_df'::JSONB) ->> 'byte_size' = '12345' AND (:'a317_df'::JSONB) ->> 'expires_in_seconds' = '600'
  AND NOT ((:'a317_df'::JSONB)::TEXT ~ 'platform-documents|bucket|storage')
  AND (SELECT g.token_sha256 = encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex') AND g.storage_bucket = 'platform-documents'
        AND g.used_count = 0 AND g.max_uses = 3 AND g.expires_at BETWEEN clock_timestamp() + INTERVAL '9 minutes' AND clock_timestamp() + INTERVAL '10 minutes 5 seconds'
        AND g.agent_key = 'sales' AND g.document_version_id = pg_temp.a317_id(821)
      FROM platform_private.ai_agent_file_grants g),
  'get_document_file: a 43-character one-time token for 10 minutes; only its SHA-256 is stored; the answer carries no storage path');
SELECT pg_temp.a317_assert(
  (pg_temp.a317_tool('get_document_file', 'sales', format('{"slot_id":"%s"}', pg_temp.a317_id(811))) ->> 'file_name') = 'passport.pdf'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', '{}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"slot_id":"%s","document_version_id":"%s"}', pg_temp.a317_id(811), pg_temp.a317_id(821)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"slot_id":"%s"}', pg_temp.a317_id(812)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(824)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(9999)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(821)), 2)) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(823)))) = '54001'
  AND pg_temp.a317_msg(pg_temp.a317_tool('get_document_file', 'sales', format('{"document_version_id":"%s"}', pg_temp.a317_id(823)))) = 'too_large',
  'get_document_file: by slot too; both or neither id, a slot without a file, an infected file, an unknown or another organization version are refused; over 25 MiB is too_large');
SELECT pg_temp.a317_assert((SELECT count(*) = 2 FROM platform_private.ai_agent_file_grants),
  'only the two successful calls created grants');

-- list_conversations / get_conversation / get_case_chat ------------------------------------------------------------
SELECT pg_temp.a317_tool('list_conversations', 'sales', '{}') AS a317_lv \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_lv'::JSONB) -> 'items') = 2
  AND (SELECT e ->> 'last_text_preview' = 'Сколько стоит обучение?' AND e ->> 'last_direction' = 'inbound' AND e ->> 'lead_id' = pg_temp.a317_id(601)::TEXT
      AND e ->> 'contact_name' = 'A317 Клиент Один' AND (e ->> 'unanswered_minutes')::INTEGER >= 118 AND e ->> 'staff_last_replied_at' IS NULL
      AND e ->> 'queue' = 'sales' AND e ->> 'status' = 'open'
      FROM jsonb_array_elements((:'a317_lv'::JSONB) -> 'items') e WHERE e ->> 'conversation_id' = :'a317_c1')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'a317_lv'::JSONB) -> 'items') e WHERE e ->> 'conversation_id' = :'a317_c2'),
  'list_conversations: unanswered chats only (the chat whose last message is ours is not listed), preview, minutes, names');
SELECT pg_temp.a317_assert(
  jsonb_array_length(pg_temp.a317_tool('list_conversations', 'sales', '{"filter":"all"}') -> 'items') = 3
  AND jsonb_array_length(pg_temp.a317_tool('list_conversations', 'sales', '{"filter":"recent"}') -> 'items') = 3
  AND jsonb_array_length(pg_temp.a317_tool('list_conversations', 'sales', '{"queue":"admissions","filter":"all"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('list_conversations', 'sales', '{"queue":"all","filter":"all"}') -> 'items') = 3
  AND (SELECT e ->> 'staff_last_replied_at' IS NOT NULL AND e ->> 'last_direction' = 'outbound' AND e ->> 'unanswered_minutes' IS NULL
      FROM jsonb_array_elements(pg_temp.a317_tool('list_conversations', 'sales', '{"filter":"all"}') -> 'items') e WHERE e ->> 'conversation_id' = :'a317_c2')
  AND jsonb_array_length(pg_temp.a317_tool('list_conversations', 'sales', '{"filter":"all"}', 2) -> 'items') = 0,
  'list_conversations: all / recent / queue filters, our last reply is recorded, another organization sees nothing');
SELECT pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c1')) AS a317_gv \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_gv'::JSONB) -> 'messages') = 2
  AND (:'a317_gv'::JSONB) -> 'messages' -> 0 ->> 'text' = 'Здравствуйте, хочу учиться в Китае' AND (:'a317_gv'::JSONB) -> 'messages' -> 1 ->> 'text' = 'Сколько стоит обучение?'
  AND (:'a317_gv'::JSONB) -> 'messages' -> 0 ->> 'origin' = 'client' AND (:'a317_gv'::JSONB) -> 'messages' -> 0 ->> 'direction' = 'inbound'
  AND (:'a317_gv'::JSONB) -> 'conversation' ->> 'whatsapp_state' = 'connected' AND (:'a317_gv'::JSONB) ->> 'can_reply' = 'true'
  AND (:'a317_gv'::JSONB) ->> 'latest_inbound_message_id' = (SELECT id::TEXT FROM a317_m WHERE label = 'c1b')
  AND (:'a317_gv'::JSONB) -> 'conversation' ->> 'contact_name' = 'A317 Клиент Один' AND (:'a317_gv'::JSONB) -> 'conversation' ->> 'queue' = 'sales'
  AND (:'a317_gv'::JSONB) -> 'next_cursor' = 'null'::JSONB,
  'get_conversation: messages oldest first, client origin, WhatsApp state, can_reply, the latest inbound id');
SELECT pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s","limit":1}', :'a317_c1')) AS a317_gv2 \gset
SELECT pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s","limit":1,"before":%s}', :'a317_c1', to_json((:'a317_gv2'::JSONB) ->> 'next_cursor'))) AS a317_gv3 \gset
SELECT pg_temp.a317_assert((:'a317_gv2'::JSONB) -> 'messages' -> 0 ->> 'text' = 'Сколько стоит обучение?' AND (:'a317_gv2'::JSONB) ->> 'next_cursor' IS NOT NULL
  AND (:'a317_gv3'::JSONB) -> 'messages' -> 0 ->> 'text' = 'Здравствуйте, хочу учиться в Китае' AND (:'a317_gv3'::JSONB) -> 'next_cursor' = 'null'::JSONB
  AND (pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c2')) -> 'messages' -> 1 ->> 'origin') = 'phone'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', pg_temp.a317_id(9999)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c1'), 2)) = 'P0002',
  'get_conversation: the newest message first when limited, older ones through before; a message sent from the phone is origin phone; other organization not found');
SELECT pg_temp.a317_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(701))) AS a317_gh \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_gh'::JSONB) -> 'messages') = 2
  AND (:'a317_gh'::JSONB) -> 'messages' -> 0 ->> 'author' = 'student' AND (:'a317_gh'::JSONB) -> 'messages' -> 0 ->> 'author_name' = 'A317 Actor 5'
  AND (:'a317_gh'::JSONB) -> 'messages' -> 1 ->> 'author' = 'staff' AND (:'a317_gh'::JSONB) -> 'messages' -> 1 ->> 'text' = 'Пришлите аттестат, пожалуйста.'
  AND pg_temp.a317_err(pg_temp.a317_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(703)))) = 'P0002',
  'get_case_chat: the portal chat of the case oldest first with the author side');

-- sales_report -----------------------------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-09"}') AS a317_sr \gset
SELECT pg_temp.a317_assert((:'a317_sr'::JSONB) -> 'rows' -> 0 ->> 'key' = '2026-09' AND (:'a317_sr'::JSONB) -> 'rows' -> 0 ->> 'contracts' = '2'
  AND (:'a317_sr'::JSONB) -> 'rows' -> 0 ->> 'withdrawn' = '1'
  AND (:'a317_sr'::JSONB) -> 'rows' -> 0 -> 'amount_total_by_currency' = '{"USD":"1800.00"}'::JSONB
  AND (:'a317_sr'::JSONB) -> 'rows' -> 0 -> 'paid_by_currency' = '{"USD":"1200.00"}'::JSONB
  AND (:'a317_sr'::JSONB) -> 'totals' ->> 'contracts' = '2' AND (:'a317_sr'::JSONB) -> 'totals' -> 'amount_total_by_currency' = '{"USD":"1800.00"}'::JSONB
  AND (:'a317_sr'::JSONB) ->> 'source_note' IS NOT NULL AND NOT ((:'a317_sr'::JSONB)::TEXT LIKE '%9999.99%'),
  'sales_report by month: contracts and withdrawn counted apart, amounts by currency; the other organization''s row is not in it: ' || :'a317_sr');
SELECT pg_temp.a317_assert(
  (SELECT jsonb_object_agg(e ->> 'key', e ->> 'contracts') = '{"China":"1","Malaysia":"1"}'::JSONB
    FROM jsonb_array_elements(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-09","group_by":"country"}') -> 'rows') e)
  AND (SELECT jsonb_object_agg(e ->> 'key', e ->> 'contracts') = '{"Менеджер А":"1","Менеджер Б":"1"}'::JSONB
    FROM jsonb_array_elements(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-09","group_by":"manager"}') -> 'rows') e)
  AND (pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-09","to_month":"2026-10","group_by":"direction"}') -> 'totals' -> 'amount_total_by_currency')
    = '{"KGS":"50000.00","USD":"1800.00"}'::JSONB
  AND jsonb_array_length(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-09","to_month":"2026-10"}') -> 'rows') = 2
  AND jsonb_array_length(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2025-01"}') -> 'rows') = 0
  AND pg_temp.a317_err(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2026-10","to_month":"2026-09"}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('sales_report', 'director', '{"from_month":"2020-01","to_month":"2026-10"}')) = '22023',
  'sales_report: grouping by country, manager and direction, a month range with two currencies, an empty period, a reversed or too long range');

-- payments_summary / funnel_stats ----------------------------------------------------------------------------------
SELECT pg_temp.a317_tool('payments_summary', 'director', '{}') AS a317_ps \gset
SELECT pg_temp.a317_assert((SELECT jsonb_object_agg(e ->> 'status', e ->> 'count') = '{"overdue":"1","paid":"1"}'::JSONB FROM jsonb_array_elements((:'a317_ps'::JSONB) -> 'obligations_by_status') e)
  AND jsonb_array_length((:'a317_ps'::JSONB) -> 'overdue') = 1 AND (:'a317_ps'::JSONB) -> 'overdue' -> 0 ->> 'amount' = '600.00'
  AND (:'a317_ps'::JSONB) -> 'overdue' -> 0 ->> 'student_name' = 'A317 Клиент Один' AND (:'a317_ps'::JSONB) -> 'overdue' -> 0 ->> 'days_overdue' = '3'
  AND (:'a317_ps'::JSONB) -> 'overdue' -> 0 ->> 'case_id' = pg_temp.a317_id(701)::TEXT
  AND (:'a317_ps'::JSONB) -> 'received_in_period' -> 'net_by_currency' = '{"USD":"900.00"}'::JSONB
  AND (pg_temp.a317_tool('payments_summary', 'director', '{"status":"paid"}') -> 'obligations_by_status' -> 0 ->> 'status') = 'paid'
  AND jsonb_array_length(pg_temp.a317_tool('payments_summary', 'director', '{}', 2) -> 'overdue') = 0
  AND (pg_temp.a317_tool('payments_summary', 'director', format('{"case_id":"%s","from":"2026-01-01","to":"2026-01-02"}', pg_temp.a317_id(701))) -> 'received_in_period' -> 'net_by_currency') = '{}'::JSONB
  AND pg_temp.a317_err(pg_temp.a317_tool('payments_summary', 'director', '{"from":"2026-10-05","to":"2026-10-01"}')) = '22023',
  'payments_summary: statuses, the overdue list with the remaining amount, money received in the period, filters; no bank details' || :'a317_ps');
SELECT pg_temp.a317_tool('funnel_stats', 'director', format('{"from":"%s","to":"%s"}', (clock_timestamp() - INTERVAL '30 days')::DATE, clock_timestamp()::DATE)) AS a317_fs \gset
SELECT pg_temp.a317_assert((:'a317_fs'::JSONB) ->> 'created_leads' = '2'
  AND (SELECT jsonb_object_agg(e ->> 'stage', e ->> 'count') = '{"new":"1","qualified":"1"}'::JSONB FROM jsonb_array_elements((:'a317_fs'::JSONB) -> 'by_stage') e)
  AND (SELECT jsonb_object_agg(e ->> 'source', e ->> 'count') = '{"website":"1","whatsapp":"1"}'::JSONB FROM jsonb_array_elements((:'a317_fs'::JSONB) -> 'by_source') e)
  AND (:'a317_fs'::JSONB) -> 'conversion' ->> 'lead_to_case' = '1.0000' AND (:'a317_fs'::JSONB) ->> 'stale_leads_older_than_7d' = '1'
  AND (pg_temp.a317_tool('funnel_stats', 'director', format('{"from":"%s","to":"%s","source":"website"}', (clock_timestamp() - INTERVAL '30 days')::DATE, clock_timestamp()::DATE)) ->> 'created_leads') = '1'
  AND (pg_temp.a317_tool('funnel_stats', 'director', format('{"from":"%s","to":"%s"}', (clock_timestamp() - INTERVAL '30 days')::DATE, clock_timestamp()::DATE), 2) ->> 'created_leads') = '1'
  AND (pg_temp.a317_tool('funnel_stats', 'director', '{"from":"2020-01-01","to":"2020-01-02"}') -> 'conversion') = '{"lead_to_case":null,"leads_with_case":0}'::JSONB
  AND pg_temp.a317_err(pg_temp.a317_tool('funnel_stats', 'director', '{"from":"2026-10-05","to":"2026-10-01"}')) = '22023',
  'funnel_stats: leads of the period by stage and source, conversion to cases, stale leads, filters; a period without leads has no rate');

-- search_catalog / search_knowledge / recent_calls / list_staff / get_my_settings -----------------------------------
SELECT pg_temp.a317_tool('search_catalog', 'sales', '{"query":"hangzhou"}') AS a317_sc \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_sc'::JSONB) -> 'institutions') = 1
  AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 ->> 'name' = 'Test University of Hangzhou' AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 ->> 'country' = 'CN'
  AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 -> 'programs' = '[{"id":"cs","name":"Computer Science","degree":"bachelor","language":"en"}]'::JSONB
  AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 -> 'costs' -> 0 ->> 'amount' = '4500.00' AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 -> 'costs' -> 0 ->> 'currency' = 'USD'
  AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 -> 'costs' -> 0 ->> 'kind' = 'tuition' AND (:'a317_sc'::JSONB) -> 'institutions' -> 0 -> 'costs' -> 0 ->> 'checked_on' = '2026-09-10',
  'search_catalog: institution, published programs and costs with the check date');
SELECT pg_temp.a317_assert(
  jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{"country":"cn","degree":"bachelor","language":"EN"}') -> 'institutions') = 1
  AND jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{"country":"kg"}') -> 'institutions') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{"degree":"master"}') -> 'institutions') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{"language":"ru"}') -> 'institutions') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{"city":"hangzhou"}') -> 'institutions') = 1
  AND jsonb_array_length(pg_temp.a317_tool('search_catalog', 'sales', '{}', 2) -> 'institutions') = 0,
  'search_catalog: country / city / degree / language filters; another organization has no catalog');
SELECT pg_temp.a317_assert(
  (SELECT bool_and(e ->> 'source' = 'agent_kb' AND e ->> 'document_title' = 'Цены Китай' AND e ->> 'audience' = 'client' AND e ->> 'approved_for_clients' = 'true')
     AND count(*) = 1 FROM jsonb_array_elements(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"стоимость обучения в Китае"}') -> 'results') e)
  AND (SELECT e ->> 'document_title' = 'Внутренний регламент' AND e ->> 'audience' = 'internal' AND e ->> 'approved_for_clients' = 'false'
     FROM jsonb_array_elements(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"регламент куратора"}') -> 'results') e)
  AND jsonb_array_length(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"регламент куратора","audience":"client"}') -> 'results') = 0
  AND (SELECT e ->> 'document_title' = 'Внутренний регламент' FROM jsonb_array_elements(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"регламент куратора","audience":"internal"}') -> 'results') e)
  AND jsonb_array_length(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"регламент куратора"}', 2) -> 'results') = 0,
  'search_knowledge: client and internal materials with the audience flag; the superseded document never; the audience filter works');
SELECT pg_temp.a317_assert(
  (SELECT count(*) = 1 AND bool_and(e ->> 'source' = 'crm_kb' AND e ->> 'document_title' = 'Виза в Китай' AND e ->> 'audience' = 'client' AND e ->> 'approved_for_clients' = 'true')
     FROM jsonb_array_elements(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"приглашение университета","audience":"client"}') -> 'results') e)
  AND jsonb_array_length(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"ZETAQ"}') -> 'results') = 0
  AND jsonb_array_length(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"удалённая страница"}') -> 'results') = 0
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(pg_temp.a317_tool('search_knowledge', 'sales', '{"query":"звонить клиенту час","audience":"internal"}') -> 'results') e
      WHERE e ->> 'document_title' = 'Порядок звонков' AND e ->> 'audience' = 'internal'),
  'search_knowledge: the CRM wiki pages of the client and internal areas; the raw archive and deleted pages are never returned');
SELECT pg_temp.a317_tool('recent_calls', 'director', '{"days":2}') AS a317_rc \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_rc'::JSONB) -> 'items') = 1 AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'direction' = 'inbound'
  AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'status' = 'ended' AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'duration_s' = '60'
  AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'client_name' = 'A317 Клиент Один' AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'staff_name' = 'A317 Actor 2'
  AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'result' = 'reached' AND (:'a317_rc'::JSONB) -> 'items' -> 0 ->> 'lead_id' = pg_temp.a317_id(601)::TEXT
  AND NOT ((:'a317_rc'::JSONB)::TEXT ~ '99655531|pbx-317|recording')
  AND jsonb_array_length(pg_temp.a317_tool('recent_calls', 'director', '{"days":2,"direction":"outbound"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('recent_calls', 'director', '{"days":1}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('recent_calls', 'director', format('{"lead_id":"%s"}', pg_temp.a317_id(602))) -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('recent_calls', 'director', '{"days":2}', 2) -> 'items') = 0,
  'recent_calls: the call with names and result, no number, call id or recording; filters by direction and lead');
SELECT pg_temp.a317_tool('list_staff', 'director', '{}') AS a317_st \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_st'::JSONB) -> 'items') = 4
  AND NOT ((:'a317_st'::JSONB)::TEXT LIKE '%A317 Actor 5%')
  AND (SELECT e -> 'roles' = '["A317 AI manager"]'::JSONB AND e -> 'directions' = '["MY"]'::JSONB AND e ->> 'active' = 'true' FROM jsonb_array_elements((:'a317_st'::JSONB) -> 'items') e
      WHERE e ->> 'staff_id' = pg_temp.a317_id(304)::TEXT)
  AND (pg_temp.a317_tool('list_staff', 'director', '{"role":"ai manager"}') -> 'items' -> 0 ->> 'staff_id') = pg_temp.a317_id(304)::TEXT
  AND (pg_temp.a317_tool('list_staff', 'director', '{"direction":"CN"}') -> 'items' -> 0 ->> 'staff_id') = pg_temp.a317_id(302)::TEXT
  AND jsonb_array_length(pg_temp.a317_tool('list_staff', 'director', '{"role":"A317 nobody"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('list_staff', 'director', '{}', 2) -> 'items') = 1,
  'list_staff: active staff without the student, roles and directions, filters; another organization lists its own Admin only');
SELECT pg_temp.a317_tool('get_my_settings', 'sales') AS a317_ms \gset
SELECT pg_temp.a317_assert((:'a317_ms'::JSONB) ->> 'agent_key' = 'sales' AND (:'a317_ms'::JSONB) ->> 'enabled' = 'true' AND (:'a317_ms'::JSONB) ->> 'auto_send' = 'false'
  AND (:'a317_ms'::JSONB) ->> 'timezone' = 'Asia/Bishkek' AND (:'a317_ms'::JSONB) ->> 'whatsapp_state' = 'connected'
  AND (:'a317_ms'::JSONB) ->> 'responsible_staff_name' = 'A317 Actor 1' AND (:'a317_ms'::JSONB) ->> 'now_utc' IS NOT NULL AND (:'a317_ms'::JSONB) -> 'direction' = 'null'::JSONB
  AND (pg_temp.a317_tool('get_my_settings', 'curator-cn') ->> 'enabled') = 'false' AND (pg_temp.a317_tool('get_my_settings', 'curator-cn') ->> 'direction') = 'CN'
  AND (pg_temp.a317_tool('get_my_settings', 'sales', '{}', 2) ->> 'whatsapp_state') = 'unknown' AND (pg_temp.a317_tool('get_my_settings', 'sales', '{}', 2) ->> 'enabled') = 'true',
  'get_my_settings: the agent''s own switches, time zone, WhatsApp state and responsible person; answers even when the agent is off');

-- ---------------------------------------------------------------------------
-- 9. Write tools: create_task, add_note, post_digest, notify_staff.
-- ---------------------------------------------------------------------------
-- create_task: staff task by default (assignee = the responsible member), case task with a case, a named assignee.
SELECT pg_temp.a317_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","description":"Клиент ждёт ответа","priority":"high","due_on":"2026-11-01","lead_id":"%s","idempotency_key":"k-ct-1"}', pg_temp.a317_id(601))) AS a317_ct1 \gset
SELECT (:'a317_ct1'::JSONB ->> 'task_id')::UUID AS a317_task1 \gset
SELECT pg_temp.a317_assert((:'a317_ct1'::JSONB) ->> 'kind' = 'staff' AND (:'a317_ct1'::JSONB) ->> 'assignee_name' = 'A317 Actor 1' AND (:'a317_ct1'::JSONB) ->> 'deduplicated' = 'false'
  AND (SELECT t.title = '[ИИ «Продажи (Closer)»] Позвонить клиенту' AND t.description = 'Клиент ждёт ответа' AND t.priority = 'high' AND t.status = 'open'
        AND t.creator_membership_id = pg_temp.a317_id(301) AND t.assignee_membership_id = pg_temp.a317_id(301) AND t.due_on = DATE '2026-11-01'
      FROM platform.staff_tasks t WHERE t.id = :'a317_task1')
  AND (SELECT count(*) = 1 FROM platform.staff_task_events e WHERE e.staff_task_id = :'a317_task1' AND e.action = 'create' AND e.actor_membership_id = pg_temp.a317_id(301))
  AND (SELECT count(*) = 1 FROM platform_private.staff_task_receipts r WHERE r.staff_task_id = :'a317_task1')
  AND (SELECT count(*) = 1 FROM platform_private.staff_lead_task_links k WHERE k.staff_task_id = :'a317_task1' AND k.lead_id = pg_temp.a317_id(601))
  AND (SELECT count(*) = 1 FROM platform.staff_notifications n WHERE n.staff_task_id = :'a317_task1' AND n.kind = 'task_assigned' AND n.recipient_membership_id = pg_temp.a317_id(301))
  AND (SELECT count(*) = 1 AND bool_and(e.actor_kind = 'service' AND e.actor_principal = 'ai-agent:sales' AND e.resource_type = 'staff_task' AND e.after_state ->> 'tool' = 'create_task')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.write' AND e.resource_id = :'a317_task1'),
  'create_task: a staff task made by the responsible member with the agent''s prefix, event, receipt, lead link, bell and journal row: ' || :'a317_ct1');
SELECT pg_temp.a317_assert(
  (pg_temp.a317_tool('create_task', 'sales', format('{"title":"Позвонить клиенту","lead_id":"%s","idempotency_key":"k-ct-1"}', pg_temp.a317_id(601)))
    = (:'a317_ct1'::JSONB || '{"deduplicated":true}'::JSONB))
  AND (SELECT count(*) = 1 FROM platform.staff_tasks t WHERE t.title LIKE '[ИИ «Продажи (Closer)»] Позвонить клиенту'),
  'create_task: the same idempotency key returns the same task and creates nothing');
SELECT pg_temp.a317_tool('create_task', 'sales', format('{"title":"Проверить документы","assignee_id":"%s"}', pg_temp.a317_id(302))) AS a317_ct2 \gset
SELECT pg_temp.a317_assert((:'a317_ct2'::JSONB) ->> 'assignee_name' = 'A317 Actor 2'
  AND (SELECT count(*) = 1 FROM platform.staff_notifications n WHERE n.staff_task_id = ((:'a317_ct2'::JSONB) ->> 'task_id')::UUID AND n.recipient_membership_id = pg_temp.a317_id(302)),
  'create_task: a named assignee gets the task and the bell');
SELECT pg_temp.a317_tool('create_task', 'sales', format('{"title":"Запросить аттестат","case_id":"%s","priority":"low","due_on":"2026-11-05"}', pg_temp.a317_id(701))) AS a317_ct3 \gset
SELECT pg_temp.a317_assert((:'a317_ct3'::JSONB) ->> 'kind' = 'case' AND (:'a317_ct3'::JSONB) ->> 'assignee_name' = 'A317 Actor 2'
  AND (SELECT t.title = '[ИИ «Продажи (Closer)»] Запросить аттестат' AND t.priority = 'low' AND t.task_type = 'ai_agent' AND NOT t.student_visible
        AND t.created_by_membership_id = pg_temp.a317_id(301) AND t.assignee_membership_id = pg_temp.a317_id(302) AND t.due_on = DATE '2026-11-05' AND t.status = 'open'
      FROM platform.case_tasks t WHERE t.id = ((:'a317_ct3'::JSONB) ->> 'task_id')::UUID)
  AND (SELECT count(*) = 1 FROM platform.case_task_events e WHERE e.case_task_id = ((:'a317_ct3'::JSONB) ->> 'task_id')::UUID AND e.new_assignee_membership_id = pg_temp.a317_id(302))
  AND (SELECT count(*) = 1 FROM platform.staff_notifications n WHERE n.case_task_id = ((:'a317_ct3'::JSONB) ->> 'task_id')::UUID AND n.recipient_membership_id = pg_temp.a317_id(302))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.write' AND e.resource_type = 'case_task' AND e.resource_id = ((:'a317_ct3'::JSONB) ->> 'task_id')::UUID),
  'create_task with a case: a case task for the curator of the case, not visible to the student, event, bell and journal row');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_tool('create_task', 'sales', format('{"title":"x","assignee_id":"%s"}', pg_temp.a317_id(305)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('create_task', 'sales', format('{"title":"x","assignee_id":"%s"}', pg_temp.a317_id(9999)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('create_task', 'sales', format('{"title":"x","case_id":"%s"}', pg_temp.a317_id(703)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('create_task', 'sales', format('{"title":"x","lead_id":"%s"}', pg_temp.a317_id(603)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('create_task', 'sales', '{"title":"x","due_on":"2026-02-31"}')) = '22023'
  AND (SELECT count(*) = 2 FROM platform.staff_tasks t WHERE t.title LIKE '[ИИ%'),
  'create_task: a student or an unknown member as assignee, another organization''s case or lead, an impossible date are refused and create nothing');
-- add_note
SELECT pg_temp.a317_tool('add_note', 'sales', format('{"lead_id":"%s","body":"Клиент просил перезвонить после 18:00","idempotency_key":"k-an-1"}', pg_temp.a317_id(601))) AS a317_an1 \gset
SELECT pg_temp.a317_assert((SELECT n.body = '[ИИ «Продажи (Closer)»] Клиент просил перезвонить после 18:00' AND n.lead_id = pg_temp.a317_id(601) AND n.student_case_id IS NULL
        AND n.created_by_membership_id = pg_temp.a317_id(301)
      FROM platform.case_notes n WHERE n.id = ((:'a317_an1'::JSONB) ->> 'note_id')::UUID)
  AND pg_temp.a317_tool('add_note', 'sales', format('{"lead_id":"%s","body":"другой текст","idempotency_key":"k-an-1"}', pg_temp.a317_id(601))) = :'a317_an1'::JSONB
  AND (SELECT count(*) = 1 FROM platform.case_notes WHERE body LIKE '[ИИ%')
  AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'lead' AND e.resource_id = pg_temp.a317_id(601) AND e.after_state ->> 'noteId' = ((:'a317_an1'::JSONB) ->> 'note_id'))
      FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.write' AND e.after_state ->> 'tool' = 'add_note'),
  'add_note on a lead: the prefixed note by the responsible member; the same key does not add a second one; one journal row about the lead');
SELECT pg_temp.a317_tool('add_note', 'sales', format('{"case_id":"%s","body":"Документы получены"}', pg_temp.a317_id(701))) AS a317_an2 \gset
SELECT pg_temp.a317_assert((SELECT n.student_case_id = pg_temp.a317_id(701) AND n.lead_id IS NULL FROM platform.case_notes n WHERE n.id = ((:'a317_an2'::JSONB) ->> 'note_id')::UUID)
  AND pg_temp.a317_err(pg_temp.a317_tool('add_note', 'sales', '{"body":"x"}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('add_note', 'sales', format('{"lead_id":"%s","case_id":"%s","body":"x"}', pg_temp.a317_id(601), pg_temp.a317_id(701)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('add_note', 'sales', format('{"case_id":"%s","body":"x"}', pg_temp.a317_id(703)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('add_note', 'sales', format('{"lead_id":"%s","body":"x"}', pg_temp.a317_id(9999)))) = 'P0002'
  AND jsonb_array_length(pg_temp.a317_tool('get_lead', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) -> 'notes') = 1
  AND jsonb_array_length(pg_temp.a317_tool('get_case', 'sales', format('{"case_id":"%s","include":["notes"]}', pg_temp.a317_id(701))) -> 'notes') = 1
  AND jsonb_array_length(pg_temp.a317_tool('get_client_card', 'sales', format('{"client_id":"%s"}', pg_temp.a317_id(501))) -> 'notes') = 2,
  'add_note on a case; exactly one of lead / case; another organization not found; the readers show the notes');
-- post_digest
SELECT pg_temp.a317_tool('post_digest', 'director', '{"kind":"weekly","title":"Итоги недели","body_md":"## Продажи\n- договоров: 2","metrics":{"kpis":[{"label":"Договоры","value":2}],"series":[{"label":"Заявки","points":[{"x":"пн","y":3}]}]},"period_from":"2026-10-12","period_to":"2026-10-18"}') AS a317_pd1 \gset
SELECT pg_temp.a317_assert((SELECT d.kind = 'weekly' AND d.title = 'Итоги недели' AND d.body_md LIKE '## Продажи%' AND d.metrics -> 'kpis' -> 0 ->> 'value' = '2'
        AND d.period_from = DATE '2026-10-12' AND d.period_to = DATE '2026-10-18' AND d.run_id IS NULL AND d.agent_key = 'director'
      FROM platform_private.ai_agent_digests d WHERE d.id = ((:'a317_pd1'::JSONB) ->> 'digest_id')::UUID)
  AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'ai_agent' AND e.after_state ->> 'kind' = 'weekly' AND NOT e.after_state::TEXT LIKE '%Итоги%')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.write' AND e.after_state ->> 'tool' = 'post_digest'),
  'post_digest: stored with the chart data and the period, no run attached when none is open; the journal row carries the kind only');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_tool('post_digest', 'director', '{"kind":"note","title":"t","body_md":"b","period_from":"2026-10-19","period_to":"2026-10-12"}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('post_digest', 'director', format('{"kind":"note","title":"t","body_md":"b","metrics":{"x":"%s"}}', repeat('z', 16400)))) = '54001'
  AND pg_temp.a317_msg(pg_temp.a317_tool('post_digest', 'director', format('{"kind":"note","title":"t","body_md":"b","metrics":{"x":"%s"}}', repeat('z', 16400)))) = 'too_large'
  AND pg_temp.a317_err(pg_temp.a317_tool('post_digest', 'director', '{"kind":"note","title":"t","body_md":"b","metrics":[1]}')) = '22023'
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_digests),
  'post_digest: a reversed period, a non-object or an over-16-KiB metrics object are refused and store nothing');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''director'', ''command'', NULL, %L, NULL, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(301))) AS a317_dr \gset
SELECT pg_temp.a317_tool('post_digest', 'director', '{"kind":"alert","title":"Сигнал","body_md":"Просрочен платёж"}') AS a317_pd2 \gset
SELECT pg_temp.a317_assert((SELECT d.run_id = ((:'a317_dr'::JSONB) ->> 'runId')::UUID FROM platform_private.ai_agent_digests d WHERE d.id = ((:'a317_pd2'::JSONB) ->> 'digest_id')::UUID),
  'post_digest: with exactly one open run the digest belongs to it');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = ((:'a317_dr'::JSONB) ->> 'runId')::UUID;
SELECT pg_temp.a317_staff(3, format('SELECT platform.ai_agents_digests_list_v1(%L, ''director'')', pg_temp.a317_id(1))) AS a317_dl \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_dl'::JSONB) -> 'digests') = 2 AND (:'a317_dl'::JSONB) -> 'digests' -> 0 ->> 'kind' = 'alert'
  AND (:'a317_dl'::JSONB) -> 'digests' -> 1 ->> 'bodyMd' LIKE '## Продажи%' AND (:'a317_dl'::JSONB) -> 'digests' -> 1 -> 'metrics' -> 'kpis' -> 0 ->> 'label' = 'Договоры'
  AND jsonb_array_length(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_digests_list_v1(%L, ''sales'')', pg_temp.a317_id(1))) -> 'digests') = 0
  AND jsonb_array_length(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_digests_list_v1(%L, NULL, 1)', pg_temp.a317_id(1))) -> 'digests') = 1
  AND (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_get_v1(%L, ''director'')', pg_temp.a317_id(1))) -> 'lastDigest' ->> 'kind') = 'alert'
  AND (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) -> 'agents' -> 0 -> 'stats' ->> 'lastDigestAt') IS NOT NULL,
  'the staff readers show the reports: newest first, with chart data, filtered by agent, last digest on the agent page and in the hub');
-- notify_staff
SELECT pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","title":"Срочно: клиент ждёт","body":"Ответьте в чате","dedupe_key":"dk-1"}', pg_temp.a317_id(302))) AS a317_nf1 \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_nf1'::JSONB) -> 'created') = 1 AND (:'a317_nf1'::JSONB) ->> 'deduplicated' = 'false'
  AND (:'a317_nf1'::JSONB) -> 'created' -> 0 ->> 'staff_id' = pg_temp.a317_id(302)::TEXT
  AND (SELECT t.title = '[ИИ] Срочно: клиент ждёт' AND t.description = 'Ответьте в чате' AND t.priority = 'high' AND t.assignee_membership_id = pg_temp.a317_id(302)
        AND t.creator_membership_id = pg_temp.a317_id(301) AND t.due_on = (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE
      FROM platform.staff_tasks t WHERE t.id = ((:'a317_nf1'::JSONB) -> 'created' -> 0 ->> 'task_id')::UUID)
  AND (SELECT count(*) = 1 FROM platform.staff_notifications n WHERE n.staff_task_id = ((:'a317_nf1'::JSONB) -> 'created' -> 0 ->> 'task_id')::UUID
      AND n.recipient_membership_id = pg_temp.a317_id(302) AND n.kind = 'task_assigned'),
  'notify_staff: a high-priority task due today for the person, with the bell');
SELECT pg_temp.a317_assert(
  pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","title":"Срочно: клиент ждёт","body":"Ответьте в чате","dedupe_key":"dk-1"}', pg_temp.a317_id(302))) = '{"created":[],"deduplicated":true}'::JSONB
  AND (SELECT count(*) = 1 FROM platform.staff_tasks t WHERE t.title = '[ИИ] Срочно: клиент ждёт')
  AND jsonb_array_length(pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","title":"Срочно: клиент ждёт","body":"Ответьте в чате","dedupe_key":"dk-2"}', pg_temp.a317_id(302))) -> 'created') = 1,
  'notify_staff: the same dedupe key is silent for 24 hours; another key notifies again');
SELECT pg_temp.a317_assert(
  jsonb_array_length(pg_temp.a317_tool('notify_staff', 'sales', '{"direction":"CN","title":"Направление","body":"Тест"}') -> 'created') = 1
  AND (pg_temp.a317_tool('notify_staff', 'sales', '{"direction":"CN","title":"Направление 2","body":"Тест"}') -> 'created' -> 0 ->> 'staff_id') = pg_temp.a317_id(302)::TEXT
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', '{"role":"A317 AI manager","title":"t","body":"b"}')) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', '{"direction":"TR","title":"t","body":"b"}')) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","title":"t","body":"b"}', pg_temp.a317_id(305)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","title":"t","body":"b"}', pg_temp.a317_id(306)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', '{"title":"t","body":"b"}')) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', format('{"staff_id":"%s","direction":"CN","title":"t","body":"b"}', pg_temp.a317_id(302)))) = '22023',
  'notify_staff: by direction; a role whose members cannot take tasks, an empty direction, a student, another organization''s member: not found; exactly one selector');
-- More than ten recipients are refused (11 curators in the TR direction).
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a317_id(7000 + g), 'a317-tr-' || g || '@example.invalid', '{}'::JSONB FROM generate_series(1, 11) g;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a317_id(7100 + g), pg_temp.a317_id(7000 + g), 'A317 TR ' || g, 'active', 1 FROM generate_series(1, 11) g;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.a317_id(7200 + g), pg_temp.a317_id(1), pg_temp.a317_id(7100 + g), 'active', 'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published' ORDER BY version DESC LIMIT 1)
  FROM generate_series(1, 11) g;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.staff_direction_assignments (organization_id, membership_id, direction_code)
  SELECT pg_temp.a317_id(1), pg_temp.a317_id(7200 + g), 'TR' FROM generate_series(1, 11) g;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_tool('notify_staff', 'sales', '{"direction":"TR","title":"t","body":"b"}')) = '54001'
  AND (SELECT count(*) = 0 FROM platform.staff_tasks WHERE title = '[ИИ] t'),
  'notify_staff: eleven recipients are too many (too_large) and nobody is notified');
-- list_tasks sees what the agent made
SELECT pg_temp.a317_tool('list_tasks', 'sales', '{}') AS a317_lt \gset
SELECT pg_temp.a317_assert((SELECT count(*) FROM jsonb_array_elements((:'a317_lt'::JSONB) -> 'items') e WHERE e ->> 'kind' = 'staff') = 6
  AND (SELECT count(*) FROM jsonb_array_elements((:'a317_lt'::JSONB) -> 'items') e WHERE e ->> 'kind' = 'case') = 1
  AND (SELECT e ->> 'title' = '[ИИ «Продажи (Closer)»] Запросить аттестат' AND e ->> 'assignee_name' = 'A317 Actor 2' AND e ->> 'priority' = 'low'
      AND e ->> 'due_on' = '2026-11-05' AND e ->> 'case_id' = pg_temp.a317_id(701)::TEXT
      FROM jsonb_array_elements((:'a317_lt'::JSONB) -> 'items') e WHERE e ->> 'kind' = 'case')
  AND (SELECT e ->> 'lead_id' = pg_temp.a317_id(601)::TEXT FROM jsonb_array_elements((:'a317_lt'::JSONB) -> 'items') e WHERE e ->> 'title' LIKE '%Позвонить клиенту')
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(701))) -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) -> 'items') = 1
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', format('{"assignee_id":"%s"}', pg_temp.a317_id(302))) -> 'items') = 6
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', '{"status":"done"}') -> 'items') = 0
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', '{"due_before":"2026-11-02"}') -> 'items') = 5
  AND jsonb_array_length(pg_temp.a317_tool('list_tasks', 'sales', '{}', 2) -> 'items') = 0
  AND (pg_temp.a317_tool('list_tasks', 'sales', '{"limit":2}') ->> 'next_cursor') IS NOT NULL,
  'list_tasks: staff and case tasks with names, lead / case links and the filters; paging; another organization has none: ' || (SELECT count(*)::TEXT FROM jsonb_array_elements((:'a317_lt'::JSONB) -> 'items')));

-- ---------------------------------------------------------------------------
-- 10. send_message: drafts, staff decisions, the canonical WhatsApp chain, direct sending and the fuses.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a317_send(p_key TEXT, p_args TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_tool('send_message', p_key, p_args, p_org)
$$;
CREATE FUNCTION pg_temp.a317_draft(p_id UUID) RETURNS platform_private.ai_agent_drafts LANGUAGE SQL AS $$
  SELECT d FROM platform_private.ai_agent_drafts d WHERE d.id = p_id
$$;
CREATE FUNCTION pg_temp.a317_decide(p_actor INTEGER, p_draft UUID, p_decision TEXT, p_edit TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_staff(p_actor, format('SELECT platform.ai_agents_draft_decide_v1(%L, %L, %L, %L, %L)',
    pg_temp.a317_id(1), p_draft, p_decision, p_edit, pg_temp.a317_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a317_wa(p_draft UUID, p_sender UUID, p_status TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_svc(format('SELECT platform.ai_agent_runtime_whatsapp_authorize_v1(%L, %L, %L, %L, %L)',
    pg_temp.a317_id(1), p_draft, p_sender, p_status, pg_temp.a317_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a317_set(p_key TEXT, p_patch TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_upd(1, p_key, (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a317_id(1) AND key = p_key), p_patch, p_req)
$$;
-- A fresh chat with one client message: returns the conversation id.
CREATE FUNCTION pg_temp.a317_chat(p_chat INTEGER, p_seconds_ago INTEGER DEFAULT 600) RETURNS UUID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.a317_in(p_chat, 'Сообщение клиента ' || p_chat, p_seconds_ago);
  RETURN pg_temp.a317_conv(p_chat);
END
$$;

-- 10.1 Auto OFF: the message becomes a draft. -------------------------------------------------------------------------
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Здравствуйте! Обучение стоит от 3000 долларов в год.","reason":"Ответ на вопрос о цене","idempotency_key":"k-sm-1"}', :'a317_c1')) AS a317_d1r \gset
SELECT (:'a317_d1r'::JSONB ->> 'draft_id')::UUID AS a317_d1 \gset
SELECT pg_temp.a317_assert((:'a317_d1r'::JSONB) ->> 'status' = 'draft_created' AND (:'a317_d1r'::JSONB) ->> 'mode' = 'draft'
  AND (:'a317_d1r'::JSONB) ->> 'hint' = 'Ждёт одобрения сотрудника в CRM'
  AND (SELECT d.status = 'pending' AND d.channel = 'whatsapp' AND d.conversation_id = :'a317_c1'::UUID AND d.student_case_id IS NULL
        AND d.source_message_id = (SELECT id FROM a317_m WHERE label = 'c1b') AND d.target_label = 'A317 Клиент Один' AND d.lead_id = pg_temp.a317_id(601)
        AND d.text LIKE 'Здравствуйте! Обучение%' AND d.reason = 'Ответ на вопрос о цене' AND NOT d.sent_by_agent AND d.edited_text IS NULL
        AND d.expires_at BETWEEN clock_timestamp() + INTERVAL '6 days 23 hours' AND clock_timestamp() + INTERVAL '7 days 1 hour' AND d.agent_key = 'sales'
      FROM platform_private.ai_agent_drafts d WHERE d.id = :'a317_d1')
  AND (SELECT count(*) = 1 AND bool_and(e.actor_principal = 'ai-agent:sales' AND e.resource_type = 'ai_agent_draft' AND e.after_state ->> 'mode' = 'draft'
        AND NOT e.after_state::TEXT LIKE '%Здравствуйте%')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.draft.create' AND e.resource_id = :'a317_d1')
  AND pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"другой","idempotency_key":"k-sm-1"}', :'a317_c1')) = :'a317_d1r'::JSONB
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_drafts),
  'Auto OFF: a draft is created (pending, the last inbound message as its anchor, the lead, the label, seven days to live) and journalled without text; the same key returns it');
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Второй вариант ответа"}', :'a317_c1')) AS a317_d2r \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Третий вариант ответа"}', :'a317_c1')) AS a317_d3r \gset
SELECT (:'a317_d2r'::JSONB ->> 'draft_id')::UUID AS a317_d2, (:'a317_d3r'::JSONB ->> 'draft_id')::UUID AS a317_d3 \gset
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Четвёртый"}', :'a317_c1'))) = '55000'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Четвёртый"}', :'a317_c1'))) = 'conflict'
  AND (SELECT count(*) = 3 FROM platform_private.ai_agent_drafts WHERE conversation_id = :'a317_c1'::UUID)
  AND pg_temp.a317_send('curator-cn', format('{"channel":"whatsapp","conversation_id":"%s","text":"Другого агента"}', :'a317_c1')) ->> 'error' = '55000',
  'at most three pending drafts per chat and agent (conflict); a disabled other agent cannot write at all');
SELECT pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Добрый день! Пришлите, пожалуйста, аттестат."}', pg_temp.a317_id(701))) AS a317_p1r \gset
SELECT (:'a317_p1r'::JSONB ->> 'draft_id')::UUID AS a317_p1 \gset
SELECT pg_temp.a317_assert((:'a317_p1r'::JSONB) ->> 'status' = 'draft_created'
  AND (SELECT d.channel = 'portal' AND d.student_case_id = pg_temp.a317_id(701) AND d.conversation_id IS NULL AND d.source_message_id IS NULL AND d.target_label = 'A317 Клиент Один'
      FROM platform_private.ai_agent_drafts d WHERE d.id = :'a317_p1')
  AND (SELECT count(*) = 0 FROM platform.case_chat_messages WHERE body LIKE 'Добрый день!%'),
  'Auto OFF, portal: a draft, nothing in the student chat');
-- Errors of the send tool.
-- A chat with no client message left (the only one removed with triggers off).
SELECT pg_temp.a317_chat(4, 5000) AS a317_c4 \gset
SET LOCAL session_replication_role = replica;
DELETE FROM platform.communication_messages WHERE conversation_id = :'a317_c4'::UUID;
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a317_assert(
  pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Привет"}', :'a317_c4'))) = 'no_inbound_message'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Привет"}', pg_temp.a317_id(9999)))) = 'target_not_found'
  AND pg_temp.a317_err(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Привет"}', :'a317_c1'), 2)) IS NOT NULL
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Привет"}', pg_temp.a317_id(704)))) = 'target_not_found'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Привет"}', pg_temp.a317_id(703)))) = 'target_not_found'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"   \n  "}', :'a317_c3'))) = 'text_invalid'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"%s"}', :'a317_c3', repeat('я', 4001)))) = 'text_invalid'
  AND pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Привет\u0001"}', :'a317_c3'))) = 'text_invalid'
  AND pg_temp.a317_err(pg_temp.a317_send('sales', format('{"channel":"whatsapp","case_id":"%s","text":"Привет"}', pg_temp.a317_id(701)))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_send('sales', format('{"channel":"portal","conversation_id":"%s","text":"Привет"}', :'a317_c1'))) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","conversation_id":"%s","text":"Привет"}', pg_temp.a317_id(701), :'a317_c1'))) = '22023'
  AND (SELECT count(*) = 4 FROM platform_private.ai_agent_drafts),
  'send_message refusals: no client message to answer, unknown / other-organization / closed targets, empty / too long / control-character text, a wrong target pair; none leaves a draft');
SELECT pg_temp.a317_chat(20) AS a317_c20 \gset
UPDATE platform.communication_conversations SET status = 'closed' WHERE id = :'a317_c20'::UUID;
SELECT pg_temp.a317_assert(pg_temp.a317_msg(pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Привет"}', :'a317_c20'))) = 'conversation_closed',
  'a closed chat: conversation_closed');

-- 10.2 Staff decisions on drafts ------------------------------------------------------------------------------------------
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_decide(3, :'a317_d1', 'approve', NULL, 3001)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_decide(2, :'a317_d1', 'approve', NULL, 3002)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_decide(6, :'a317_d1', 'approve', NULL, 3003)) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_anon(format('SELECT platform.ai_agents_draft_decide_v1(%L, %L, ''approve'', NULL, %L)', pg_temp.a317_id(1), :'a317_d1', pg_temp.a317_id(3004)))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_decide(4, :'a317_d1', 'maybe', NULL, 3005)) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_decide(4, pg_temp.a317_id(9999), 'approve', NULL, 3006)) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_decide(4, :'a317_d1', 'approve', E'плохой\u0001текст', 3007)) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_decide(4, :'a317_d1', 'approve', repeat('я', 4001), 3008)) = '22023'
  AND (SELECT status = 'pending' FROM platform_private.ai_agent_drafts WHERE id = :'a317_d1'),
  'decide: the viewer, the Tasks member, another organization and anon are refused; a bad decision, an unknown draft, a bad edit are refused; the draft stays pending');
SELECT pg_temp.a317_decide(4, :'a317_d1', 'approve', 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.', 3010) AS a317_dec1 \gset
SELECT pg_temp.a317_assert((:'a317_dec1'::JSONB) ->> 'status' = 'approved' AND (:'a317_dec1'::JSONB) ->> 'channel' = 'whatsapp'
  AND (:'a317_dec1'::JSONB) ->> 'text' = 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.' AND (:'a317_dec1'::JSONB) ->> 'conversationId' = :'a317_c1'
  AND (:'a317_dec1'::JSONB) ->> 'approverMembershipId' = pg_temp.a317_id(304)::TEXT AND (:'a317_dec1'::JSONB) ->> 'agentKey' = 'sales'
  AND (SELECT d.status = 'approved' AND d.edited_text LIKE '%в Китае%' AND d.decided_by_membership_id = pg_temp.a317_id(304) AND d.decided_at IS NOT NULL
      FROM platform_private.ai_agent_drafts d WHERE d.id = :'a317_d1')
  AND pg_temp.a317_decide(4, :'a317_d1', 'approve', 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.', 3010) = :'a317_dec1'::JSONB
  AND pg_temp.a317_err(pg_temp.a317_decide(4, :'a317_d1', 'discard', NULL, 3010)) = '40001'
  AND pg_temp.a317_msg(pg_temp.a317_decide(4, :'a317_d1', 'discard', NULL, 3011)) = 'ai_agent_draft_not_pending'
  AND (SELECT count(*) = 1 AND bool_and(e.actor_membership_id = pg_temp.a317_id(304) AND e.after_state ->> 'decision' = 'approve' AND e.after_state ->> 'edited' = 'true'
        AND NOT e.after_state::TEXT LIKE '%Китае%')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.draft.decide' AND e.resource_id = :'a317_d1'),
  'approve with an edit by the AI manager: approved, the edited text is final, journalled by the member without text; replay returns the receipt, a second decision is refused');
SELECT pg_temp.a317_decide(1, :'a317_d2', 'discard', NULL, 3020) AS a317_dec2 \gset
SELECT pg_temp.a317_assert((:'a317_dec2'::JSONB) ->> 'status' = 'discarded'
  AND (SELECT status = 'discarded' AND edited_text IS NULL FROM platform_private.ai_agent_drafts WHERE id = :'a317_d2')
  AND (pg_temp.a317_decide(1, :'a317_d3', 'approve', (SELECT text FROM platform_private.ai_agent_drafts WHERE id = :'a317_d3'), 3021) ->> 'text') = 'Третий вариант ответа'
  AND (SELECT edited_text IS NULL FROM platform_private.ai_agent_drafts WHERE id = :'a317_d3'),
  'discard by the Admin; approving with the unchanged text keeps no edit');
-- Back to pending for the later scenarios: an expired draft cannot be decided.
UPDATE platform_private.ai_agent_drafts SET status = 'pending', decided_by_membership_id = NULL, decided_at = NULL, expires_at = clock_timestamp() - INTERVAL '1 hour' WHERE id = :'a317_d3';
SELECT pg_temp.a317_staff(3, format('SELECT platform.ai_agents_drafts_list_v1(%L)', pg_temp.a317_id(1))) AS a317_dl2 \gset
SELECT pg_temp.a317_assert(pg_temp.a317_msg(pg_temp.a317_decide(4, :'a317_d3', 'approve', NULL, 3022)) = 'ai_agent_draft_not_pending'
  AND (:'a317_dl2'::JSONB) -> 'counts' = '{"pending":1,"approved":1,"sending":0,"sent":0,"discarded":1,"failed":0,"expired":1}'::JSONB
  AND (SELECT e ->> 'status' = 'expired' FROM jsonb_array_elements((:'a317_dl2'::JSONB) -> 'drafts') e WHERE e ->> 'id' = :'a317_d3')
  AND (SELECT e -> 'sourceMessage' ->> 'text' = 'Сколько стоит обучение?' AND e ->> 'targetLabel' = 'A317 Клиент Один' AND e ->> 'decidedByName' = 'A317 Actor 4' AND e ->> 'editedText' LIKE '%в Китае%'
      FROM jsonb_array_elements((:'a317_dl2'::JSONB) -> 'drafts') e WHERE e ->> 'id' = :'a317_d1')
  AND jsonb_array_length(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_drafts_list_v1(%L, ''sales'', ''expired'')', pg_temp.a317_id(1))) -> 'drafts') = 1
  AND jsonb_array_length(pg_temp.a317_staff(3, format('SELECT platform.ai_agents_drafts_list_v1(%L, ''director'')', pg_temp.a317_id(1))) -> 'drafts') = 0
  AND (pg_temp.a317_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a317_id(1))) -> 'summary' ->> 'draftsPending') = '1',
  'an expired draft cannot be decided and reads as expired; the list carries the anchor message, label, editor and counts; the hub counts live pending drafts only');
UPDATE platform_private.ai_agent_drafts SET status = 'discarded' WHERE id = :'a317_d3';

-- 10.3 The canonical WhatsApp chain for an approved draft (kind ai_agent) ----------------------------------------------
SELECT pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'STOPPED', 3101) AS a317_w0 \gset
SELECT pg_temp.a317_assert((:'a317_w0'::JSONB) = '{"authorized":false,"reason":"whatsapp_unavailable"}'::JSONB
  AND (SELECT status = 'pending' AND failure_code = 'whatsapp_unavailable' FROM platform_private.ai_agent_drafts WHERE id = :'a317_d1')
  AND (SELECT count(*) = 0 FROM platform.manual_send_authorizations WHERE kind = 'ai_agent'),
  'WhatsApp is not working: no authorization, the draft goes back to staff with the reason');
SELECT pg_temp.a317_decide(4, :'a317_d1', 'approve', NULL, 3030) AS a317_dec3 \gset
SELECT pg_temp.a317_assert((:'a317_dec3'::JSONB) ->> 'status' = 'approved' AND (SELECT failure_code IS NULL FROM platform_private.ai_agent_drafts WHERE id = :'a317_d1'),
  'the member approves again; the old failure code is cleared');
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'working', 3102)) = '22023'
  AND pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_runtime_whatsapp_authorize_v1(%L, %L, %L, ''WORKING'', %L)', pg_temp.a317_id(1), :'a317_d1', pg_temp.a317_id(301), pg_temp.a317_id(3103)))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_wa(pg_temp.a317_id(9999), pg_temp.a317_id(301), 'WORKING', 3104)) = 'P0002',
  'authorize: a malformed provider status is 22023, a staff session 42501, an unknown draft P0002');
SELECT pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'WORKING', 3105) AS a317_w1 \gset
SELECT pg_temp.a317_assert((:'a317_w1'::JSONB) ->> 'authorized' = 'true' AND (:'a317_w1'::JSONB) ->> 'replayed' = 'false' AND (:'a317_w1'::JSONB) ->> 'state' = 'manual_send_authorized'
  AND (:'a317_w1'::JSONB) ->> 'final_text' = 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.'
  AND (:'a317_w1'::JSONB) ->> 'final_text_sha256' = encode(sha256(convert_to('Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.', 'UTF8')), 'hex')
  AND (:'a317_w1'::JSONB) ->> 'communication_conversation_id' = :'a317_c1' AND (:'a317_w1'::JSONB) ->> 'authorized_by_membership_id' = pg_temp.a317_id(301)::TEXT
  AND (:'a317_w1'::JSONB) ->> 'work_state' = 'queued' AND (:'a317_w1'::JSONB) ->> 'ai_agent_draft_id' = :'a317_d1' AND (:'a317_w1'::JSONB) -> 'ai_draft_id' = 'null'::JSONB
  AND (:'a317_w1'::JSONB) ->> 'waha_readiness' = 'ready' AND (:'a317_w1'::JSONB) ->> 'work_item_id' IS NOT NULL AND (:'a317_w1'::JSONB) ->> 'queue_message_id' IS NOT NULL,
  'authorize: the same answer shape as the autoresponder path: authorization, text hash, work item queued: ' || :'a317_w1');
SELECT (:'a317_w1'::JSONB ->> 'manual_send_authorization_id')::UUID AS a317_az1, (:'a317_w1'::JSONB ->> 'work_item_id')::UUID AS a317_wi1 \gset
SELECT pg_temp.a317_assert((SELECT a.kind = 'ai_agent' AND a.ai_agent_draft_id = :'a317_d1' AND a.ai_draft_id IS NULL AND a.ai_autosend_decision_id IS NULL AND a.reason = 'ai_agent'
        AND a.source_message_id = (SELECT id FROM a317_m WHERE label = 'c1b') AND a.authorized_by_membership_id = pg_temp.a317_id(301) AND a.conversation_id = :'a317_c1'::UUID
        AND a.authorized_access_version IS NOT NULL
      FROM platform.manual_send_authorizations a WHERE a.id = :'a317_az1')
  AND (SELECT i.kind::TEXT = 'manual_whatsapp_send' AND i.state::TEXT = 'queued' AND i.manual_send_authorization_id = :'a317_az1'
      FROM platform_private.durable_work_items i WHERE i.id = :'a317_wi1')
  AND (SELECT status = 'sending' AND provider ->> 'authorizationId' = :'a317_az1' AND provider ->> 'workItemId' = :'a317_wi1' FROM platform_private.ai_agent_drafts WHERE id = :'a317_d1')
  AND pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'WORKING', 3105) ->> 'replayed' = 'true'
  AND pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'WORKING', 3106) ->> 'manual_send_authorization_id' = :'a317_az1'
  AND pg_temp.a317_wa(:'a317_d1', pg_temp.a317_id(301), 'STOPPED', 3107) ->> 'work_item_id' = :'a317_wi1'
  AND (SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE kind = 'ai_agent')
  AND (SELECT count(*) = 1 FROM platform_private.durable_work_items WHERE manual_send_authorization_id = :'a317_az1'),
  'the stored authorization is kind ai_agent bound to the draft; one work item; a repeat (any request id, any status) returns the same authorization and creates nothing');
-- The insert guard: no way around the function.
SELECT pg_temp.a317_assert((SELECT bool_and(r = '42501') FROM (
    SELECT pg_temp.a317_err(pg_temp.a317_call('postgres', NULL, format($q$
      INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
        authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
      VALUES (%L, %L, 'x', %L, %L, %L, 'r', gen_random_uuid(), %L, 'ai_agent', %L) RETURNING to_jsonb(1)$q$,
      pg_temp.a317_id(1), :'a317_c2', repeat('a', 64), pg_temp.a317_id(201), pg_temp.a317_id(301), (SELECT id FROM a317_m WHERE label = 'c2a'), :'a317_d1'))) AS r) x),
  'the guard: an ai_agent row without the function''s switch is refused (42501)');
-- The CRM claims the item and finishes it with a synthetic provider id (the real exact claim / finish path).
SELECT pg_temp.a317_svc(format('SELECT platform.claim_manual_whatsapp_send_item(%L, %L, 60, %L, %L)', pg_temp.a317_id(1), :'a317_wi1', 'ai-agent-test', pg_temp.a317_id(3110))) AS a317_cl1 \gset
SELECT pg_temp.a317_assert((:'a317_cl1'::JSONB ->> 'claimed')::BOOLEAN AND (:'a317_cl1'::JSONB) ->> 'final_text' = 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.',
  'the exact claim of the canonical path hands out the stored text of the agent''s authorization: ' || :'a317_cl1');
SELECT pg_temp.a317_svc(format('SELECT platform.finish_manual_whatsapp_send(%L, %L, %L, %L, %L, NULL, %L, %L, %L)', pg_temp.a317_id(1), :'a317_wi1',
  (:'a317_cl1'::JSONB) ->> 'attempt_id', :'a317_az1', 'succeeded', 'true_79967700001@c.us_A317SENT000000000001', clock_timestamp(), pg_temp.a317_id(3111))) AS a317_fn1 \gset
SELECT pg_temp.a317_assert((:'a317_fn1'::JSONB) ->> 'state' = 'succeeded'
  AND (SELECT count(*) = 1 FROM platform.communication_messages m WHERE m.manual_send_authorization_id = :'a317_az1'::UUID AND m.direction = 'outbound' AND m.conversation_id = :'a317_c1'::UUID
      AND m.body_text = 'Здравствуйте! Обучение в Китае стоит от 3000 долларов в год.'),
  'finish: the outbound message exists in the chat with the authorization of the agent: ' || :'a317_fn1');
SELECT pg_temp.a317_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''sent'', NULL, %L, %L::jsonb)', pg_temp.a317_id(1), :'a317_d1', pg_temp.a317_id(301),
  format('{"messageId":"true_79967700001@c.us_A317SENT000000000001","text":"must be dropped","extra":1}'))) AS a317_mk1 \gset
SELECT pg_temp.a317_assert((:'a317_mk1'::JSONB) = '{"ok":true,"status":"sent","replayed":false}'::JSONB
  AND (SELECT d.status = 'sent' AND d.sent_at IS NOT NULL AND d.sent_by_membership_id = pg_temp.a317_id(301) AND d.provider ->> 'messageId' LIKE 'true_%'
        AND NOT (d.provider ? 'text') AND NOT (d.provider ? 'extra') AND d.provider ->> 'authorizationId' = :'a317_az1'
      FROM platform_private.ai_agent_drafts d WHERE d.id = :'a317_d1')
  AND (SELECT count(*) = 1 AND bool_and(e.resource_type = 'communication_conversation' AND e.resource_id = :'a317_c1'::UUID AND e.actor_principal = 'ai-agent:sales'
        AND NOT e.after_state::TEXT LIKE '%Китае%')
      FROM platform.audit_events e WHERE e.action = 'ai.agent.message.send' AND e.after_state ->> 'draftId' = :'a317_d1')
  AND (pg_temp.a317_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''sent'', NULL, NULL, NULL)', pg_temp.a317_id(1), :'a317_d1')) ->> 'replayed') = 'true'
  AND pg_temp.a317_err(pg_temp.a317_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''pending'', ''staff_active'', NULL, NULL)', pg_temp.a317_id(1), :'a317_d1'))) = '55000'
  AND pg_temp.a317_err(pg_temp.a317_svc(format('SELECT platform.ai_agent_runtime_draft_mark_v1(%L, %L, ''sent'', NULL, NULL, NULL)', pg_temp.a317_id(1), :'a317_p1'))) = '55000',
  'draft_mark sent: only the provider keys are kept, one journal row about the chat without text; a repeat is a replay; illegal transitions are 55000');
SELECT pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c1')) AS a317_gv5 \gset
SELECT pg_temp.a317_assert((SELECT e ->> 'origin' = 'ai_agent' AND e ->> 'text' LIKE '%в Китае%' FROM jsonb_array_elements((:'a317_gv5'::JSONB) -> 'messages') e WHERE e ->> 'direction' = 'outbound'),
  'get_conversation marks the agent''s message origin ai_agent');
SELECT pg_temp.a317_assert((SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE kind = 'ai_agent')
  AND (SELECT count(*) = 1 FROM platform_private.manual_send_provider_bindings b WHERE b.manual_send_authorization_id = :'a317_az1'::UUID),
  'the provider binding of the finished send exists for the agent''s authorization');

-- 10.4 Auto ON: direct sending ----------------------------------------------------------------------------------------
SELECT pg_temp.a317_set('sales', '{"autoSend":true}', 3200) AS a317_auto \gset
SELECT pg_temp.a317_assert((:'a317_auto'::JSONB) -> 'changed' = '["autoSend"]'::JSONB
  AND (pg_temp.a317_rt('ai_agent_mcp_auth_v1', format('%L', pg_temp.a317_tok(10))) ->> 'autoSend') = 'true',
  'Auto switched on by the Admin (the MCP auth now reports it)');
SELECT pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Добрый день, клиент! Жду аттестат.","reason":"Напоминание"}', pg_temp.a317_id(701))) AS a317_ps1 \gset
SELECT pg_temp.a317_assert((:'a317_ps1'::JSONB) ->> 'status' = 'sent' AND (:'a317_ps1'::JSONB) ->> 'mode' = 'direct'
  AND (:'a317_ps1'::JSONB) ->> 'sender_membership_id' = pg_temp.a317_id(301)::TEXT
  AND (SELECT m.body = 'Добрый день, клиент! Жду аттестат.' AND m.author_membership_id = pg_temp.a317_id(301) AND m.student_case_id = pg_temp.a317_id(701)
      FROM platform.case_chat_messages m WHERE m.id = ((:'a317_ps1'::JSONB) ->> 'message_id')::UUID)
  AND (SELECT d.status = 'sent' AND d.sent_by_agent AND d.sent_by_membership_id = pg_temp.a317_id(301) AND d.provider ->> 'messageId' = (:'a317_ps1'::JSONB) ->> 'message_id'
      FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a317_ps1'::JSONB) ->> 'draft_id')::UUID)
  AND (SELECT t.await_state = 'awaiting_student' AND t.last_message_sequence_id IS NOT NULL FROM platform.case_chat_threads t WHERE t.student_case_id = pg_temp.a317_id(701))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.message.send' AND e.resource_type = 'student_case' AND e.resource_id = pg_temp.a317_id(701))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.draft.create' AND e.after_state ->> 'mode' = 'direct' AND e.after_state ->> 'sentByAgent' = 'true')
  AND (SELECT e ->> 'author' = 'ai_agent' AND e ->> 'author_name' = 'A317 Actor 1'
      FROM jsonb_array_elements(pg_temp.a317_tool('get_case_chat', 'sales', format('{"case_id":"%s"}', pg_temp.a317_id(701))) -> 'messages') e WHERE e ->> 'text' LIKE 'Добрый день, клиент%'),
  'Auto ON, portal: written to the student chat at once, by the responsible member, the thread waits for the student; the reader marks the message ai_agent: ' || :'a317_ps1');
-- A second call with the same text but a different key is a new message; the same key is the same message.
SELECT pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Повтор","idempotency_key":"k-ps-2"}', pg_temp.a317_id(701))) AS a317_ps2a \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Повтор","idempotency_key":"k-ps-2"}', pg_temp.a317_id(701))) AS a317_ps2b \gset
SELECT pg_temp.a317_assert((:'a317_ps2a'::JSONB) = (:'a317_ps2b'::JSONB) AND (:'a317_ps2a'::JSONB) ->> 'status' = 'sent'
  AND (SELECT count(*) = 2 FROM platform.case_chat_messages WHERE body IN ('Повтор', 'Добрый день, клиент! Жду аттестат.') AND author_membership_id = pg_temp.a317_id(301)),
  'direct portal send is repeat-safe by idempotency key');
-- WhatsApp direct: chat 2 (the last staff message is two hours old).
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Добрый день! Чем могу помочь?"}', :'a317_c2')) AS a317_ws1 \gset
SELECT (:'a317_ws1'::JSONB ->> 'draft_id')::UUID AS a317_dw1 \gset
SELECT pg_temp.a317_assert((:'a317_ws1'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a317_ws1'::JSONB) ->> 'mode' = 'direct'
  AND (:'a317_ws1'::JSONB) ->> 'sender_membership_id' = pg_temp.a317_id(301)::TEXT
  AND (SELECT d.status = 'approved' AND d.sent_by_agent AND d.decided_by_membership_id IS NULL AND d.source_message_id = (SELECT id FROM a317_m WHERE label = 'c2a')
      FROM platform_private.ai_agent_drafts d WHERE d.id = :'a317_dw1'),
  'Auto ON, WhatsApp: the draft is born approved for dispatch (no staff decision): ' || :'a317_ws1');
SELECT pg_temp.a317_wa(:'a317_dw1', pg_temp.a317_id(301), 'WORKING', 3210) AS a317_ww1 \gset
SELECT pg_temp.a317_assert((:'a317_ww1'::JSONB) ->> 'authorized' = 'true' AND (SELECT status = 'sending' FROM platform_private.ai_agent_drafts WHERE id = :'a317_dw1'),
  'the CRM''s authorization then queues it');
-- The fuses of direct WhatsApp sending. Each uses its own chat.
SELECT pg_temp.a317_chat(5) AS a317_c5 \gset
SELECT pg_temp.a317_out(5, 'Ответил сотрудник с телефона', 60);
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Автоответ"}', :'a317_c5')) AS a317_f1 \gset
SELECT pg_temp.a317_assert((:'a317_f1'::JSONB) ->> 'status' = 'draft_created' AND (:'a317_f1'::JSONB) ->> 'mode' = 'draft'
  AND (:'a317_f1'::JSONB) ->> 'hint' LIKE '%в чате уже отвечает сотрудник%'
  AND (SELECT status = 'pending' AND failure_code = 'staff_active' AND NOT sent_by_agent FROM platform_private.ai_agent_drafts WHERE id = ((:'a317_f1'::JSONB) ->> 'draft_id')::UUID),
  'fuse: a staff message in the chat within 30 minutes turns a direct send into a draft (staff_active)');
SELECT pg_temp.a317_chat(6) AS a317_c6 \gset
INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, channel, conversation_id, text, status, sent_by_agent, created_at)
  SELECT pg_temp.a317_id(1), 'sales', 'whatsapp', :'a317_c6'::UUID, 'Прошлое сообщение ' || g, 'sent', TRUE, clock_timestamp() - INTERVAL '10 minutes' FROM generate_series(1, 6) g;
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Седьмое за час"}', :'a317_c6')) AS a317_f2 \gset
SELECT pg_temp.a317_assert((:'a317_f2'::JSONB) ->> 'status' = 'draft_created'
  AND (SELECT failure_code = 'rate_limited' FROM platform_private.ai_agent_drafts WHERE id = ((:'a317_f2'::JSONB) ->> 'draft_id')::UUID),
  'fuse: six agent messages to one chat within an hour: the seventh is a draft (rate_limited)');
UPDATE platform_private.ai_agent_drafts SET created_at = clock_timestamp() - INTERVAL '2 hours' WHERE conversation_id = :'a317_c6'::UUID AND status = 'sent';
SELECT pg_temp.a317_chat(7) AS a317_c7 \gset
INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, channel, conversation_id, text, status, sent_by_agent, created_at)
  SELECT pg_temp.a317_id(1), 'sales', 'whatsapp', pg_temp.a317_id(9100 + g), 'Орг ' || g, 'sent', TRUE, clock_timestamp() - INTERVAL '5 minutes' FROM generate_series(1, 60) g;
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Шестьдесят первое"}', :'a317_c7')) AS a317_f3 \gset
SELECT pg_temp.a317_assert((SELECT failure_code = 'rate_limited' FROM platform_private.ai_agent_drafts WHERE id = ((:'a317_f3'::JSONB) ->> 'draft_id')::UUID)
  AND (:'a317_f3'::JSONB) ->> 'mode' = 'draft',
  'fuse: sixty agent messages within an hour in the organization: the next is a draft (rate_limited)');
UPDATE platform_private.ai_agent_drafts SET created_at = clock_timestamp() - INTERVAL '2 hours' WHERE status = 'sent' AND text LIKE 'Орг %';
UPDATE platform.waha_session_health SET status = 'STOPPED' WHERE organization_id = pg_temp.a317_id(1);
SELECT pg_temp.a317_chat(8) AS a317_c8 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"WhatsApp выключен"}', :'a317_c8')) AS a317_f4 \gset
SELECT pg_temp.a317_assert((SELECT failure_code = 'whatsapp_unavailable' FROM platform_private.ai_agent_drafts WHERE id = ((:'a317_f4'::JSONB) ->> 'draft_id')::UUID)
  AND (:'a317_f4'::JSONB) ->> 'hint' LIKE '%WhatsApp сейчас не подключён%'
  AND (pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c8')) -> 'conversation' ->> 'whatsapp_state') = 'disconnected'
  AND (pg_temp.a317_tool('get_conversation', 'sales', format('{"conversation_id":"%s"}', :'a317_c8')) ->> 'can_reply') = 'false'
  AND (pg_temp.a317_tool('get_my_settings', 'sales') ->> 'whatsapp_state') = 'disconnected',
  'fuse: the recorded WhatsApp session is down: a direct send becomes a draft; the readers say so (disconnected, cannot reply)');
UPDATE platform.waha_session_health SET status = 'WORKING' WHERE organization_id = pg_temp.a317_id(1);
-- At authorization time: the conversation moved on, was closed, the sender cannot write.
SELECT pg_temp.a317_chat(9) AS a317_c9 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Ответ на старое"}', :'a317_c9'))->>'draft_id' AS a317_dm \gset
SELECT pg_temp.a317_in(9, 'Клиент написал ещё', 30);
SELECT pg_temp.a317_wa(:'a317_dm'::UUID, pg_temp.a317_id(301), 'WORKING', 3220) AS a317_w5 \gset
SELECT pg_temp.a317_assert((:'a317_w5'::JSONB) = '{"authorized":false,"reason":"conversation_moved_on"}'::JSONB
  AND (SELECT status = 'failed' AND failure_code = 'conversation_moved_on' FROM platform_private.ai_agent_drafts WHERE id = :'a317_dm'::UUID)
  AND (SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE kind = 'ai_agent' AND ai_agent_draft_id = :'a317_dw1'::UUID),
  'a newer client message makes the answer stale: no authorization, the draft fails with conversation_moved_on');
SELECT pg_temp.a317_chat(10) AS a317_c10 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Ответ в закрытый"}', :'a317_c10'))->>'draft_id' AS a317_dcl \gset
UPDATE platform.communication_conversations SET status = 'closed' WHERE id = :'a317_c10'::UUID;
SELECT pg_temp.a317_wa(:'a317_dcl'::UUID, pg_temp.a317_id(301), 'WORKING', 3221) AS a317_w6 \gset
SELECT pg_temp.a317_assert((:'a317_w6'::JSONB) = '{"authorized":false,"reason":"conversation_closed"}'::JSONB
  AND (SELECT status = 'failed' AND failure_code = 'conversation_closed' FROM platform_private.ai_agent_drafts WHERE id = :'a317_dcl'::UUID),
  'a closed chat at authorization: conversation_closed');
SELECT pg_temp.a317_chat(11) AS a317_c11 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Не тот отправитель"}', :'a317_c11'))->>'draft_id' AS a317_dsn \gset
SELECT pg_temp.a317_wa(:'a317_dsn'::UUID, pg_temp.a317_id(305), 'WORKING', 3222) AS a317_w7 \gset
SELECT pg_temp.a317_assert((:'a317_w7'::JSONB) = '{"authorized":false,"reason":"sender_unavailable"}'::JSONB
  AND (SELECT status = 'pending' AND failure_code = 'sender_unavailable' FROM platform_private.ai_agent_drafts WHERE id = :'a317_dsn'::UUID)
  AND pg_temp.a317_wa(:'a317_dsn'::UUID, pg_temp.a317_id(301), 'WORKING', 3223) ->> 'reason' = 'not_approved'
  AND (SELECT count(*) = 1 FROM platform.manual_send_authorizations WHERE kind = 'ai_agent' AND ai_agent_draft_id = :'a317_dw1'::UUID),
  'a sender who cannot write in the chat (a student): sender_unavailable, the draft returns to staff; a pending draft is not_approved');
-- Direct sending at authorization re-checks the fuses (staff arrived after the draft was born).
SELECT pg_temp.a317_chat(12) AS a317_c12 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Пока никто не писал"}', :'a317_c12'))->>'draft_id' AS a317_dsa \gset
SELECT pg_temp.a317_out(12, 'Сотрудник вмешался', 20);
SELECT pg_temp.a317_wa(:'a317_dsa'::UUID, pg_temp.a317_id(301), 'WORKING', 3224) AS a317_w8 \gset
SELECT pg_temp.a317_assert((:'a317_w8'::JSONB) = '{"authorized":false,"reason":"staff_active"}'::JSONB
  AND (SELECT status = 'pending' AND failure_code = 'staff_active' FROM platform_private.ai_agent_drafts WHERE id = :'a317_dsa'::UUID),
  'a staff message between the draft and the send: staff_active at authorization, the draft goes to staff');

-- 10.5 Auto OFF + authority code of a run: "send now by the employee's order" -----------------------------------------
SELECT pg_temp.a317_set('sales', '{"autoSend":false}', 3300) AS a317_off \gset
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(301),
  encode(sha256(convert_to('CODE-317-B', 'UTF8')), 'hex'))) AS a317_ar \gset
SELECT (:'a317_ar'::JSONB ->> 'runId')::UUID AS a317_arun \gset
SELECT pg_temp.a317_chat(13) AS a317_c13 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Без кода"}', :'a317_c13')) AS a317_a0 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Неверный код","authority_code":"WRONG"}', :'a317_c13')) AS a317_a1 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"По приказу сотрудника","authority_code":"CODE-317-B"}', :'a317_c13')) AS a317_a2 \gset
SELECT pg_temp.a317_assert((:'a317_a0'::JSONB) ->> 'status' = 'draft_created' AND (:'a317_a1'::JSONB) ->> 'status' = 'draft_created'
  AND (:'a317_a2'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a317_a2'::JSONB) ->> 'sender_membership_id' = pg_temp.a317_id(301)::TEXT
  AND (SELECT d.status = 'approved' AND d.sent_by_agent AND d.run_id = :'a317_arun' FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a317_a2'::JSONB) ->> 'draft_id')::UUID)
  AND (SELECT d.run_id = :'a317_arun' FROM platform_private.ai_agent_drafts d WHERE d.id = ((:'a317_a0'::JSONB) ->> 'draft_id')::UUID),
  'Auto OFF: no code or a wrong code makes a draft; the right code of the open run with send authority sends directly in the initiator''s name');
SELECT pg_temp.a317_chat(14) AS a317_c14 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Письмо по приказу","authority_code":"CODE-317-B"}', pg_temp.a317_id(701))) AS a317_a3 \gset
SELECT pg_temp.a317_assert((:'a317_a3'::JSONB) ->> 'status' = 'sent' AND (SELECT m.author_membership_id = pg_temp.a317_id(301) FROM platform.case_chat_messages m WHERE m.id = ((:'a317_a3'::JSONB) ->> 'message_id')::UUID),
  'the same code sends to the student chat directly');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE id = :'a317_arun';
SELECT pg_temp.a317_assert((pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"После запуска","authority_code":"CODE-317-B"}', pg_temp.a317_id(701))) ->> 'status') = 'draft_created',
  'a code works only while its run is open: after the run it is just a wrong code');
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, NULL, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(301))) AS a317_ar2 \gset
SELECT pg_temp.a317_assert((pg_temp.a317_send('sales', format('{"channel":"portal","case_id":"%s","text":"Run без права","authority_code":"CODE-317-B"}', pg_temp.a317_id(701))) ->> 'status') = 'draft_created',
  'a run without send authority never sends by code');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE status IN ('starting', 'running');
-- An initiator who cannot write to the chat: the send falls back to a draft (no exception).
SELECT pg_temp.a317_rt('ai_agent_runtime_run_reserve_v1', format('%L, ''sales'', ''command'', NULL, %L, %L, NULL, NULL, NULL', pg_temp.a317_id(1), pg_temp.a317_id(304),
  encode(sha256(convert_to('CODE-317-C', 'UTF8')), 'hex'))) AS a317_ar3 \gset
SELECT pg_temp.a317_chat(15) AS a317_c15 \gset
SELECT pg_temp.a317_send('sales', format('{"channel":"whatsapp","conversation_id":"%s","text":"Приказ от менеджера без права","authority_code":"CODE-317-C"}', :'a317_c15')) AS a317_a4 \gset
SELECT pg_temp.a317_assert((:'a317_a4'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a317_a4'::JSONB) ->> 'sender_membership_id' = pg_temp.a317_id(301)::TEXT,
  'a code whose initiator cannot be assigned work: the responsible member is the sender: ' || :'a317_a4');
UPDATE platform_private.ai_agent_runs SET status = 'completed', ended_at = clock_timestamp() WHERE status IN ('starting', 'running');

-- 10.6 The insert guard, exactly: an approved draft of the agent (born approved by Auto / a code) is in hand; only the function
--      that sets both switches for the right sender, with the stored text, gets through.
SELECT ((:'a317_a2'::JSONB) ->> 'draft_id')::UUID AS a317_dg \gset
CREATE TEMP TABLE a317_probe AS SELECT :'a317_dg'::UUID AS draft_id;
DO $a317_guard$
DECLARE
  d platform_private.ai_agent_drafts := pg_temp.a317_draft((SELECT draft_id FROM a317_probe));
  v_text TEXT; v_sha TEXT; v_seen TEXT := '';
BEGIN
  v_text := COALESCE(d.edited_text, d.text);
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  PERFORM pg_temp.a317_assert(d.status = 'approved' AND d.sent_by_agent, 'the probe draft is approved by the agent path');
  -- (1) no switches at all
  BEGIN
    INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
      authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
    VALUES (d.organization_id, d.conversation_id, v_text, v_sha, pg_temp.a317_id(201), pg_temp.a317_id(301), 'ai_agent', gen_random_uuid(),
      d.source_message_id, 'ai_agent', d.id);
    v_seen := v_seen || 'no-switch:accepted ';
  EXCEPTION WHEN insufficient_privilege THEN
    v_seen := v_seen || 'no-switch:refused ';
  END;
  -- (2) the authorize switch without the sender switch
  PERFORM set_config('evo.ai_agent_authorize', 'on', TRUE);
  BEGIN
    INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
      authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
    VALUES (d.organization_id, d.conversation_id, v_text, v_sha, pg_temp.a317_id(201), pg_temp.a317_id(301), 'ai_agent', gen_random_uuid(),
      d.source_message_id, 'ai_agent', d.id);
    v_seen := v_seen || 'no-sender:accepted ';
  EXCEPTION WHEN insufficient_privilege THEN
    v_seen := v_seen || 'no-sender:refused ';
  END;
  -- (3) both switches, another sender than the one named
  PERFORM set_config('evo.ai_agent_sender', pg_temp.a317_id(302)::TEXT, TRUE);
  BEGIN
    INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
      authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
    VALUES (d.organization_id, d.conversation_id, v_text, v_sha, pg_temp.a317_id(201), pg_temp.a317_id(301), 'ai_agent', gen_random_uuid(),
      d.source_message_id, 'ai_agent', d.id);
    v_seen := v_seen || 'other-sender:accepted ';
  EXCEPTION WHEN insufficient_privilege THEN
    v_seen := v_seen || 'other-sender:refused ';
  END;
  -- (4) both switches, the right sender, another text
  PERFORM set_config('evo.ai_agent_sender', pg_temp.a317_id(301)::TEXT, TRUE);
  BEGIN
    INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
      authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
    VALUES (d.organization_id, d.conversation_id, v_text || ' (изменено)', encode(sha256(convert_to(v_text || ' (изменено)', 'UTF8')), 'hex'),
      pg_temp.a317_id(201), pg_temp.a317_id(301), 'ai_agent', gen_random_uuid(), d.source_message_id, 'ai_agent', d.id);
    v_seen := v_seen || 'other-text:accepted ';
  EXCEPTION WHEN insufficient_privilege THEN
    v_seen := v_seen || 'other-text:refused ';
  END;
  -- (5) everything right: accepted (rolled back by the probe exception)
  BEGIN
    INSERT INTO platform.manual_send_authorizations (organization_id, conversation_id, final_text, final_text_sha256, authorized_by_profile_id,
      authorized_by_membership_id, reason, request_id, source_message_id, kind, ai_agent_draft_id)
    VALUES (d.organization_id, d.conversation_id, v_text, v_sha, pg_temp.a317_id(201), pg_temp.a317_id(301), 'ai_agent', gen_random_uuid(),
      d.source_message_id, 'ai_agent', d.id);
    v_seen := v_seen || 'right:accepted';
    RAISE EXCEPTION 'a317_probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'a317_probe_rollback' THEN RAISE; END IF;
  END;
  PERFORM set_config('evo.ai_agent_authorize', '', TRUE);
  PERFORM set_config('evo.ai_agent_sender', '', TRUE);
  PERFORM pg_temp.a317_assert(v_seen = 'no-switch:refused no-sender:refused other-sender:refused other-text:refused right:accepted',
    'the insert guard: only the exact right insert passes: ' || v_seen);
END
$a317_guard$;
SELECT pg_temp.a317_assert((SELECT count(*) = 0 FROM platform.manual_send_authorizations WHERE ai_agent_draft_id = :'a317_dg'::UUID),
  'the probe left nothing behind');

-- ---------------------------------------------------------------------------
-- 11. The canonical path is unchanged for the others; the chat reader copes with the agent's message (known gap G1).
-- ---------------------------------------------------------------------------
-- Fresh WAHA readiness for the manual send (the agent's path takes the provider status from the CRM instead).
INSERT INTO platform_private.messaging_integration_health_events (organization_id, target, readiness, evidence_kind, reason, evidence_ref,
  request_id, observed_at)
VALUES (pg_temp.a317_id(1), 'waha', 'ready', 'provider_observed', 'A317 synthetic fresh WAHA readiness', 'synthetic:a317:waha-ready',
  pg_temp.a317_id(3399), statement_timestamp());
SELECT pg_temp.a317_chat(30, 60) AS a317_c30 \gset
SELECT (SELECT id FROM platform.communication_messages WHERE conversation_id = :'a317_c30'::UUID AND direction = 'inbound') AS a317_m30 \gset
SELECT pg_temp.a317_staff(1, format($q$SELECT platform.request_manual_whatsapp_send_with_authorization(%L, %L, %L, NULL,
  'Ручной ответ сотрудника', 'staff_chat_reply', %L, %L)$q$, pg_temp.a317_id(1), :'a317_c30', :'a317_m30',
  encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v2', 'manual_whatsapp_send', pg_temp.a317_id(1)::TEXT,
    :'a317_c30'::TEXT, :'a317_m30'::TEXT, 'staff-authored', pg_temp.a317_id(3400)::TEXT])::TEXT, 'UTF8')), 'hex'),
  pg_temp.a317_id(3400))) AS a317_man \gset
SELECT pg_temp.a317_assert((SELECT count(*) = 18 FROM jsonb_object_keys(:'a317_man'::JSONB))
  AND (SELECT a.kind = 'manual' AND a.ai_agent_draft_id IS NULL AND a.ai_autosend_decision_id IS NULL FROM platform.manual_send_authorizations a
      WHERE a.id = (:'a317_man'::JSONB ->> 'manual_send_authorization_id')::UUID),
  'manual sends are unchanged: the 18-key result, kind manual, no agent draft: ' || :'a317_man');
SELECT pg_temp.a317_staff(1, format('SELECT jsonb_agg(row_to_json(p)::JSONB ORDER BY p.created_at) FROM platform.staff_whatsapp_message_page(%L, %L, 50) p',
  pg_temp.a317_id(1), :'a317_c1')) AS a317_page \gset
SELECT pg_temp.a317_assert((SELECT count(*) = 3 FROM jsonb_array_elements(:'a317_page'::JSONB))
  AND (SELECT e ->> 'origin' <> 'autoreply' AND e ->> 'sender_membership_id' = pg_temp.a317_id(301)::TEXT
      FROM jsonb_array_elements(:'a317_page'::JSONB) e WHERE e ->> 'direction' = 'outbound'),
  'the chat transcript reads a chat with an agent message: it shows as an ordinary CRM send by the member (gap G1: no agent label in the feed)');

-- ---------------------------------------------------------------------------
-- 12. File grants (the link of get_document_file): use count, expiry, wrong token.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_staff(1, format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex')))) = '42501'
  AND pg_temp.a317_err(pg_temp.a317_anon(format('SELECT platform.ai_agent_mcp_file_resolve_v1(%L)', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex')))) = '42501',
  'the file resolver is closed to staff and anon');
SELECT pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex'))) AS a317_fr1 \gset
SELECT pg_temp.a317_assert((:'a317_fr1'::JSONB) = '{"bucket":"platform-documents","path":"aa/11111111111111111111111111111111111111111111111111111111111111","mimeType":"application/pdf","byteSize":12345,"fileName":"passport.pdf"}'::JSONB,
  'the resolver returns the storage object of the grant and counts the use: ' || :'a317_fr1');
SELECT pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex'))) AS a317_fr2 \gset
SELECT pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex'))) AS a317_fr3 \gset
SELECT pg_temp.a317_assert((SELECT used_count = 3 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex'))
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex')))) = 'P0002'
  AND (SELECT used_count = 3 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = encode(sha256(convert_to(:'a317_ftoken', 'UTF8')), 'hex')),
  'the fourth use is refused (three uses per link) and is not counted');
SELECT pg_temp.a317_assert(
  pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', repeat('0', 64)))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', 'nothex'))) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', 'NULL')) = 'P0002'
  AND pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', :'a317_ftoken'))) = 'P0002',
  'an unknown, malformed, empty token or the token itself instead of its hash resolves nothing');
SELECT pg_temp.a317_tool('get_document_file', 'sales', format('{"slot_id":"%s"}', pg_temp.a317_id(811))) ->> 'token' AS a317_ftoken2 \gset
UPDATE platform_private.ai_agent_file_grants SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE token_sha256 = encode(sha256(convert_to(:'a317_ftoken2', 'UTF8')), 'hex');
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_rt('ai_agent_mcp_file_resolve_v1', format('%L', encode(sha256(convert_to(:'a317_ftoken2', 'UTF8')), 'hex')))) = 'P0002'
  AND (SELECT used_count = 0 FROM platform_private.ai_agent_file_grants WHERE token_sha256 = encode(sha256(convert_to(:'a317_ftoken2', 'UTF8')), 'hex')),
  'an expired link resolves nothing and is not counted');

-- ---------------------------------------------------------------------------
-- 13. The action log writes the journal for the six sensitive reads (and only for them, and only when they succeed).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a317_log(p_tool TEXT, p_args TEXT, p_status TEXT DEFAULT 'ok') RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a317_rt('ai_agent_mcp_log_v1', format('%L, ''sales'', %L, %L::jsonb, %L, NULL, 4', pg_temp.a317_id(1), p_tool, p_args, p_status))
$$;
SELECT count(*) AS a317_before FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read') \gset
SELECT pg_temp.a317_log('get_client_card', format('{"client_id":"%s"}', pg_temp.a317_id(501))) AS a317_g1 \gset
SELECT pg_temp.a317_log('get_client_card', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) AS a317_g2 \gset
SELECT pg_temp.a317_log('get_client_card', format('{"case_id":"%s"}', pg_temp.a317_id(701))) AS a317_g3 \gset
SELECT pg_temp.a317_log('get_lead', format('{"lead_id":"%s"}', pg_temp.a317_id(601))) AS a317_g4 \gset
SELECT pg_temp.a317_log('get_case', format('{"case_id":"%s","include":["documents"]}', pg_temp.a317_id(701))) AS a317_g5 \gset
SELECT pg_temp.a317_log('get_conversation', format('{"conversation_id":"%s"}', :'a317_c1')) AS a317_g6 \gset
SELECT pg_temp.a317_log('get_case_chat', format('{"case_id":"%s"}', pg_temp.a317_id(701))) AS a317_g7 \gset
SELECT pg_temp.a317_log('get_document_file', format('{"document_version_id":"%s"}', pg_temp.a317_id(821))) AS a317_g8 \gset
SELECT pg_temp.a317_log('get_document_file', format('{"slot_id":"%s"}', pg_temp.a317_id(811))) AS a317_g9 \gset
SELECT pg_temp.a317_log('search_clients', '{"query":"аб"}') AS a317_g10 \gset
SELECT pg_temp.a317_log('get_case', format('{"case_id":"%s"}', pg_temp.a317_id(701)), 'error') AS a317_g11 \gset
SELECT pg_temp.a317_log('list_leads', '{}') AS a317_g12 \gset
SELECT pg_temp.a317_log('get_lead', '{}') AS a317_g13 \gset
SELECT pg_temp.a317_assert((SELECT count(*) FROM platform.audit_events WHERE action IN ('ai.agent.tool.read', 'ai.agent.document.read')) - :a317_before = 9
  AND (SELECT count(*) = 7 FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read')
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.action = 'ai.agent.document.read' AND e.resource_type = 'student_case' AND e.resource_id = pg_temp.a317_id(701))
  AND (SELECT jsonb_agg(DISTINCT e.resource_type ORDER BY e.resource_type) = '["client","communication_conversation","lead","student_case"]'::JSONB
      FROM platform.audit_events e WHERE e.action = 'ai.agent.tool.read')
  AND (SELECT bool_and(e.actor_kind = 'service' AND e.actor_principal = 'ai-agent:sales' AND e.actor_profile_id IS NULL AND e.actor_membership_id IS NULL
        AND e.after_state ->> 'agentKey' = 'sales' AND e.after_state ->> 'tool' IS NOT NULL AND (SELECT count(*) = 2 FROM jsonb_object_keys(e.after_state)))
      FROM platform.audit_events e WHERE e.action IN ('ai.agent.tool.read', 'ai.agent.document.read'))
  AND (SELECT count(*) = 9 FROM platform_private.ai_agent_actions x WHERE x.audit_event_id IS NOT NULL)
  AND (SELECT bool_and(x.audit_event_id IS NULL) FROM platform_private.ai_agent_actions x WHERE x.tool IN ('search_clients', 'list_leads') OR x.result_status = 'error'),
  'sensitive reads: nine journal rows (card ×3, lead, case, chat, case chat, two document reads), object by priority, after_state = agent + tool; other tools and failed reads write none');

-- ---------------------------------------------------------------------------
-- 14. The journal allowlist and the real journal reader.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a317_assert(
  (SELECT bool_and(a = ANY (platform_private.p7a_safe_audit_actions())) FROM unnest(ARRAY['ai.agent.config.change', 'ai.agent.sync', 'ai.agent.token.rotate',
    'ai.agent.run.start', 'ai.agent.run.finish', 'ai.agent.tool.read', 'ai.agent.tool.write', 'ai.agent.draft.create', 'ai.agent.draft.decide',
    'ai.agent.message.send', 'ai.agent.document.read']) a)
  AND (SELECT bool_and(t = ANY (platform_private.p7a_safe_audit_resource_types())) FROM unnest(ARRAY['ai_agent', 'ai_agent_run', 'ai_agent_draft']) t)
  AND cardinality(platform_private.p7a_safe_audit_actions()) = cardinality(platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()) + 11
  AND cardinality(platform_private.p7a_safe_audit_resource_types()) = cardinality(platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()) + 3
  AND NOT 'ai.agent.config.change' = ANY (platform_private.p7a_safe_audit_actions_pre_ai_agents_managed())
  AND 'case.direction.set' = ANY (platform_private.p7a_safe_audit_actions()) AND 'client' = ANY (platform_private.p7a_safe_audit_resource_types())
  AND 'whatsapp.connect.qr' = ANY (platform_private.p7a_safe_audit_actions())
  AND NOT has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()'::REGPROCEDURE, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()'::REGPROCEDURE, 'EXECUTE')
  AND (SELECT count(DISTINCT action) = 11 FROM platform.audit_events WHERE action LIKE 'ai.agent.%' AND action NOT LIKE 'ai.agent.autosend.%'),
  'journal: the 11 actions and 3 object types are in the allowlists, the previous lists are intact, the wrappers are closed; all eleven actions were written by this suite');
SELECT pg_temp.a317_staff(1, format('SELECT platform.search_audit_events(NULL, NULL, ARRAY[''ai.agent.config.change'', ''ai.agent.tool.read'', ''ai.agent.message.send'', ''ai.agent.draft.create'']::TEXT[], NULL, NULL, 100)')) AS a317_journal \gset
SELECT pg_temp.a317_assert(jsonb_array_length((:'a317_journal'::JSONB) -> 'rows') >= 4
  AND (SELECT bool_and(e ->> 'actor_display_label' = CASE e ->> 'action' WHEN 'ai.agent.config.change' THEN 'Staff' ELSE 'Service' END)
      FROM jsonb_array_elements((:'a317_journal'::JSONB) -> 'rows') e)
  AND (SELECT bool_and((SELECT count(*) = 10 FROM jsonb_object_keys(e))) FROM jsonb_array_elements((:'a317_journal'::JSONB) -> 'rows') e)
  AND NOT ((:'a317_journal'::JSONB)::TEXT ~ 'SECRET|Китае|Здравствуйте|passport'),
  'the real journal reader shows the agent''s rows to the Admin: staff label for settings, service label for the agent, ten safe keys, no texts: '
    || jsonb_array_length((:'a317_journal'::JSONB) -> 'rows'));
SELECT pg_temp.a317_assert(pg_temp.a317_err(pg_temp.a317_staff(3, format('SELECT platform.search_audit_events(NULL, NULL, NULL, NULL, NULL, 10)'))) = '42501',
  'the journal stays closed to staff without the audit right');

\echo A317_AI_AGENTS_MANAGED_SUITE_PASSED
ROLLBACK;
