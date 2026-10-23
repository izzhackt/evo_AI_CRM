\set ON_ERROR_STOP on
-- Boundary suite for migration 318: «ИИ-агенты», три мелкие правки по ревью #1290 (docs/PLAN_CHANGES.md
-- «2026-10-23 · ИИ-агенты: ответы владельца в инструкциях, курсы для продаж, мелкие исправления (миграция 318)»).
-- Runs on the real chain right after 318 inside one transaction that is rolled back, with its own synthetic
-- organizations and members; sessions are the real custom_access_token_hook claims. No provider, no Claude /
-- Anthropic call, no real person, no production action.
--
-- Proves:
--  1. posture: the three helpers are closed to every API role; the two new runtime functions are definer with an
--     empty search_path and executable by service_role only; the lease columns exist and the table stays closed;
--  2. (a) a failed or pending re-sync does not block an agent whose Claude configuration exists:
--     run_authorize and dispatch_targets accept ok / pending / error with agent id + version + environment + vault +
--     credential, and still refuse never, a first sync that stopped before the agent exists, a lost credential
--     and an adopted agent id (version reset); an old-style `ok` row without version stays accepted; a disabled
--     agent is still refused; the staff reader shows the error text of the failed sync;
--  3. (b) send_message without idempotency_key: the same target and text (whitespace and case apart) gives the
--     same answer and one draft; another text, another target, another agent, and the 11th minute are new; the
--     derived keys are separate from the model's keys; with Auto on, a repeated portal send writes ONE chat message;
--     the replay of `needs_dispatch` follows the draft state (sent / sending / unknown / pending / discarded);
--  4. (c) the environment lease: known / claimed / busy, release by token only (wrong token changes nothing),
--     an expired lease is taken over, another organization is independent, the CHECK keeps the three columns
--     together, the functions are closed to staff and anon, an unknown agent is refused.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A318_AI_AGENTS_FOLLOWUPS_SUITE_START

CREATE FUNCTION pg_temp.a318_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('31800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a318_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A318: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a318_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE TEMP TABLE a318_claims(actor INTEGER PRIMARY KEY, claims TEXT);
GRANT SELECT ON a318_claims TO authenticated;
CREATE FUNCTION pg_temp.a318_staff(p_actor INTEGER, p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_call('authenticated', (SELECT claims FROM a318_claims WHERE actor = p_actor), p_sql)
$$;
CREATE FUNCTION pg_temp.a318_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_call('service_role', '{"role":"service_role"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a318_anon(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_call('anon', '{"role":"anon"}', p_sql)
$$;
CREATE FUNCTION pg_temp.a318_err(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'error'
$$;
CREATE FUNCTION pg_temp.a318_msg(p_result JSONB) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT p_result ->> 'message'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a318_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture. Organization 1 and 2 (active).
--   1 org 1 Admin (system admin)   2 org 1 Student   3 org 2 Admin (system admin)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE a318_actors(n INTEGER PRIMARY KEY, org INTEGER, coarse platform.business_role, sysadmin BOOLEAN);
INSERT INTO a318_actors VALUES (1, 1, 'admin', TRUE), (2, 1, 'student', FALSE), (3, 2, 'admin', TRUE);
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a318_id(1), 'A318 Fictional organization', 'active'),
  (pg_temp.a318_id(2), 'A318 Other fictional organization', 'active');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.a318_id(100 + n), 'a318-' || n || '@example.invalid', '{}'::JSONB FROM a318_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.a318_id(200 + n), pg_temp.a318_id(100 + n), 'A318 Actor ' || n, 'active', 1 FROM a318_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, created_at)
  SELECT pg_temp.a318_id(300 + a.n), pg_temp.a318_id(a.org), pg_temp.a318_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + a.n * INTERVAL '1 day'
  FROM a318_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (SELECT pg_temp.a318_id(300 + n) FROM a318_actors WHERE sysadmin);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.a318_id(401), pg_temp.a318_id(1), 'organization', pg_temp.a318_id(1), 1),
  (pg_temp.a318_id(402), pg_temp.a318_id(2), 'organization', pg_temp.a318_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.a318_id(1), pg_temp.a318_id(301), pg_temp.a318_id(401), 1, 1, TRUE, 'system', 'A318 synthetic scope', pg_temp.a318_id(601)),
  (pg_temp.a318_id(2), pg_temp.a318_id(303), pg_temp.a318_id(402), 1, 1, TRUE, 'system', 'A318 synthetic scope', pg_temp.a318_id(602));

CREATE FUNCTION pg_temp.a318_claims_for(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.a318_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.a318_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
INSERT INTO a318_claims(actor, claims) SELECT a.n, pg_temp.a318_claims_for(a.n) FROM a318_actors a;
SELECT pg_temp.a318_assert((SELECT count(*) = 3 AND bool_and(claims IS NOT NULL AND claims::JSONB ? 'platform_membership_id') FROM a318_claims),
  'every fixture actor got real hook claims');

-- Seeded rows (owner, triggers off): a client, a lead, two cases of organization 1 and one of organization 2.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.clients (id, organization_id, display_name, normalized_name, email, normalized_email, phone, normalized_phone,
  lifecycle_state, created_at, updated_at)
SELECT c.id, c.org, c.name, platform_private.normalize_person_name(c.name), c.email,
  platform_private.normalize_person_email(c.email), c.phone, platform_private.normalize_person_phone(c.phone), 'active', c.created, c.created
FROM (VALUES
  (pg_temp.a318_id(501), pg_temp.a318_id(1), 'A318 Клиент Один', 'a318.client1@example.invalid', '+996555318001', clock_timestamp() - INTERVAL '10 days'),
  (pg_temp.a318_id(502), pg_temp.a318_id(1), 'A318 Клиент Два', 'a318.client2@example.invalid', '+996555318002', clock_timestamp() - INTERVAL '12 days')
) AS c(id, org, name, email, phone, created);
INSERT INTO platform.leads (id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, lifecycle_state,
  interest_direction, created_at, updated_at) VALUES
  (pg_temp.a318_id(601), pg_temp.a318_id(1), pg_temp.a318_id(501), pg_temp.a318_id(301), 'qualified', 'website', 'open', 'CN',
    clock_timestamp() - INTERVAL '5 days', clock_timestamp() - INTERVAL '1 day'),
  (pg_temp.a318_id(602), pg_temp.a318_id(1), pg_temp.a318_id(502), pg_temp.a318_id(301), 'new', 'whatsapp', 'open', 'MY',
    clock_timestamp() - INTERVAL '12 days', clock_timestamp() - INTERVAL '10 days');
INSERT INTO platform.student_cases (id, organization_id, student_membership_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, program_direction, intake, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, admissions_direction, pipeline_stage, canonical_client_id, canonical_lead_id, next_action,
  created_at, updated_at) VALUES
  (pg_temp.a318_id(701), pg_temp.a318_id(1), pg_temp.a318_id(302), pg_temp.a318_id(301), pg_temp.a318_id(301), 'a318-case-1',
    'A318 Клиент Один', 'China', 'bachelor', 'CN', '2027-09', 'intake', 'active', clock_timestamp() - INTERVAL '3 days', NULL,
    pg_temp.a318_id(401), 1, 'CN', 'documents', pg_temp.a318_id(501), pg_temp.a318_id(601), 'Собрать документы',
    clock_timestamp() - INTERVAL '4 days', clock_timestamp() - INTERVAL '1 hour'),
  (pg_temp.a318_id(702), pg_temp.a318_id(1), NULL, pg_temp.a318_id(301), NULL, 'a318-case-2',
    'A318 Клиент Два', 'Malaysia', 'master', 'MY', '2027-02', 'intake', 'pending', NULL, NULL,
    pg_temp.a318_id(401), 1, 'MY', 'new', pg_temp.a318_id(502), pg_temp.a318_id(602), NULL,
    clock_timestamp() - INTERVAL '3 days', clock_timestamp() - INTERVAL '2 hours');
SET LOCAL session_replication_role = origin;

-- The first read creates the 7 agents of each organization.
SELECT pg_temp.a318_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a318_id(1))) AS a318_list1 \gset
SELECT pg_temp.a318_staff(3, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a318_id(2))) AS a318_list2 \gset
SELECT pg_temp.a318_assert(jsonb_array_length((:'a318_list1'::JSONB) -> 'agents') = 7 AND jsonb_array_length((:'a318_list2'::JSONB) -> 'agents') = 7,
  'the first read seeds 7 agents per organization');

-- ---------------------------------------------------------------------------
-- 1. Posture of what 318 adds.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a318_assert(
  (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_agent_claude_usable', 'ai_agent_send_text_norm', 'ai_agent_send_replay')
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname IN ('ai_agent_runtime_environment_claim_v1', 'ai_agent_runtime_environment_release_v1')
      AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[] AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 3 FROM information_schema.columns c WHERE c.table_schema = 'platform_private' AND c.table_name = 'ai_agents_org_settings'
      AND c.column_name IN ('environment_claim_token', 'environment_claim_until', 'environment_claim_key'))
  AND (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'platform_private.ai_agents_org_settings'::REGCLASS)
  AND NOT has_table_privilege('service_role', 'platform_private.ai_agents_org_settings', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'platform_private.ai_agents_org_settings', 'UPDATE'),
  '318 posture: three closed helpers, two service-only definer functions with an empty search_path, three lease columns, the table stays closed');
SELECT pg_temp.a318_assert(
  (SELECT count(*) = 9 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 16 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_runtime\_%'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'the replaced functions keep their grants: 9 staff for authenticated, 16 runtime (14 of 317 and two leases) for service_role');

-- ---------------------------------------------------------------------------
-- 2. (a) A failed or pending re-sync does not block an agent that has a Claude configuration.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a318_rt(p_fn TEXT, p_args TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_svc(format('SELECT platform.%s(%s)', p_fn, p_args))
$$;
CREATE FUNCTION pg_temp.a318_sync(p_key TEXT, p_result TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_rt('ai_agent_runtime_sync_record_v1', format('%L, %L, %L, %L::jsonb', pg_temp.a318_id(p_org), p_key, pg_temp.a318_id(300 + CASE p_org WHEN 1 THEN 1 ELSE 3 END), p_result))
$$;
CREATE FUNCTION pg_temp.a318_auth(p_key TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_staff(1, format('SELECT platform.ai_agents_run_authorize_v1(%L, %L)', pg_temp.a318_id(1), p_key))
$$;
CREATE FUNCTION pg_temp.a318_targets() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_rt('ai_agent_runtime_dispatch_targets_v1', format('%L, ''website_lead''', pg_temp.a318_id(1)))
$$;
CREATE FUNCTION pg_temp.a318_upd(p_key TEXT, p_patch TEXT, p_req INTEGER) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_staff(1, format('SELECT platform.ai_agents_update_v1(%L, %L, %s, %L::jsonb, %L)', pg_temp.a318_id(1), p_key,
    (SELECT config_version FROM platform_private.ai_agents WHERE organization_id = pg_temp.a318_id(1) AND key = p_key),
    p_patch, pg_temp.a318_id(p_req)))
$$;
CREATE FUNCTION pg_temp.a318_target_keys() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE(string_agg(e ->> 'key', ',' ORDER BY e ->> 'key'), '') FROM jsonb_array_elements(pg_temp.a318_targets()) e
$$;

-- Both agents of the scenario are enabled; `sales` fires on website leads.
SELECT pg_temp.a318_upd('sales', '{"enabled":true,"triggerWebsiteLead":true,"triggerWhatsappInbound":true}', 2001) AS a318_u1 \gset
SELECT pg_temp.a318_upd('curator-cn', '{"enabled":true}', 2002) AS a318_u2 \gset
SELECT pg_temp.a318_assert((:'a318_u1'::JSONB) ? 'configVersion' AND (:'a318_u2'::JSONB) ? 'configVersion', 'the scenario agents are enabled: ' || :'a318_u1' || :'a318_u2');

SELECT pg_temp.a318_assert(
  pg_temp.a318_msg(pg_temp.a318_auth('sales')) = 'agent_not_synced' AND pg_temp.a318_target_keys() = '',
  'never synced: agent_not_synced and not a dispatch target (as in 317)');

-- A first sync that stopped before the agent exists (environment and vault only, then the credential): still not synced.
SELECT pg_temp.a318_sync('sales', '{"status":"pending","environmentId":"env_a318","vaultId":"vlt_a318"}') AS a318_s0 \gset
SELECT pg_temp.a318_sync('sales', '{"status":"error","error":"Claude said no","credentialId":"vcrd_a318"}') AS a318_s0b \gset
SELECT pg_temp.a318_assert(
  pg_temp.a318_msg(pg_temp.a318_auth('sales')) = 'agent_not_synced' AND pg_temp.a318_target_keys() = '',
  'error before the agent was created (environment + vault + credential, no agent): still not synced');

-- The agent exists but the sync is still pending: usable.
SELECT pg_temp.a318_sync('sales', '{"status":"pending","claudeAgentId":"agent_a318sales","agentVersion":3,"mcpUrl":"https://crm.example.invalid/api/mcp/v1"}') AS a318_s1 \gset
SELECT pg_temp.a318_auth('sales') AS a318_a1 \gset
SELECT pg_temp.a318_assert(
  (:'a318_a1'::JSONB) ->> 'agentKey' = 'sales' AND (:'a318_a1'::JSONB) #>> '{claude,agentId}' = 'agent_a318sales'
  AND (:'a318_a1'::JSONB) #>> '{claude,agentVersion}' = '3' AND (:'a318_a1'::JSONB) #>> '{claude,environmentId}' = 'env_a318'
  AND (:'a318_a1'::JSONB) #>> '{claude,vaultId}' = 'vlt_a318' AND pg_temp.a318_target_keys() = 'sales'
  AND (SELECT sync_status = 'pending' FROM platform_private.ai_agents WHERE organization_id = pg_temp.a318_id(1) AND key = 'sales'),
  'pending with agent + version + environment + vault + credential: authorized and a dispatch target: ' || :'a318_a1');

-- Finished sync: as before.
SELECT pg_temp.a318_sync('sales', '{"status":"ok","claudeAgentId":"agent_a318sales","agentVersion":3,"environmentId":"env_a318","vaultId":"vlt_a318","credentialId":"vcrd_a318","configHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}') AS a318_s2 \gset
SELECT pg_temp.a318_assert(pg_temp.a318_auth('sales') ->> 'agentKey' = 'sales' AND pg_temp.a318_target_keys() = 'sales',
  'ok: authorized and a dispatch target, as in 317');

-- The re-sync fails: the last good configuration still works, and the staff reader shows the error.
SELECT pg_temp.a318_sync('sales', '{"status":"error","error":"Claude вернул ошибку: overloaded"}') AS a318_s3 \gset
SELECT pg_temp.a318_auth('sales') AS a318_a3 \gset
SELECT pg_temp.a318_staff(1, format('SELECT platform.ai_agents_get_v1(%L, ''sales'')', pg_temp.a318_id(1))) AS a318_g3 \gset
SELECT pg_temp.a318_assert(
  (:'a318_a3'::JSONB) ->> 'agentKey' = 'sales' AND (:'a318_a3'::JSONB) #>> '{claude,agentId}' = 'agent_a318sales'
  AND pg_temp.a318_target_keys() = 'sales'
  AND (:'a318_g3'::JSONB) #>> '{sync,status}' = 'error' AND (:'a318_g3'::JSONB) #>> '{sync,error}' = 'Claude вернул ошибку: overloaded'
  AND (:'a318_g3'::JSONB) #>> '{sync,claudeAgentId}' = 'agent_a318sales' AND (:'a318_g3'::JSONB) #>> '{sync,agentVersion}' = '3',
  'a failed re-sync does not block the agent; the reader still reports status error with the text and the ids');
SELECT pg_temp.a318_assert(
  (SELECT e #>> '{sync,status}' = 'error' FROM jsonb_array_elements(pg_temp.a318_staff(1, format('SELECT platform.ai_agents_list_v1(%L)', pg_temp.a318_id(1))) -> 'agents') e WHERE e ->> 'key' = 'sales'),
  'the hub list reports the failed sync of the usable agent');

-- A disabled agent is refused whatever its sync (the agent_disabled rule is first).
SELECT pg_temp.a318_upd('sales', '{"enabled":false}', 2003) AS a318_u3 \gset
SELECT pg_temp.a318_assert(pg_temp.a318_msg(pg_temp.a318_auth('sales')) = 'agent_disabled' AND pg_temp.a318_target_keys() = '',
  'disabled: agent_disabled and not a dispatch target, even with a usable configuration');
SELECT pg_temp.a318_upd('sales', '{"enabled":true}', 2004) AS a318_u4 \gset

-- A lost credential makes the error row unusable; the same row with status ok (317 rule: no credential check) stays usable.
SELECT pg_temp.a318_sync('sales', '{"status":"error","error":"x","credentialId":null}') AS a318_s4 \gset
SELECT pg_temp.a318_assert(pg_temp.a318_msg(pg_temp.a318_auth('sales')) = 'agent_not_synced' AND pg_temp.a318_target_keys() = '',
  'error without a credential: not usable');
SELECT pg_temp.a318_sync('sales', '{"status":"ok","error":null}') AS a318_s5 \gset
SELECT pg_temp.a318_assert(pg_temp.a318_auth('sales') ->> 'agentKey' = 'sales' AND pg_temp.a318_target_keys() = 'sales',
  'status ok keeps the 317 rule (ids only, no credential check): usable');
SELECT pg_temp.a318_sync('sales', '{"status":"ok","credentialId":"vcrd_a318"}') AS a318_s5b \gset

-- Adopting another Claude agent id resets the version and the status: not synced until the next sync.
SELECT pg_temp.a318_sync('sales', '{"status":"error","error":"y"}') AS a318_s6 \gset
SELECT pg_temp.a318_upd('sales', '{"claudeAgentId":"agent_adopted123"}', 2005) AS a318_u5 \gset
SELECT pg_temp.a318_assert(
  (:'a318_u5'::JSONB) -> 'changed' = '["claudeAgentId"]'::JSONB
  AND (SELECT sync_status = 'never' AND claude_agent_version IS NULL AND claude_agent_id = 'agent_adopted123'
      FROM platform_private.ai_agents WHERE organization_id = pg_temp.a318_id(1) AND key = 'sales')
  AND pg_temp.a318_msg(pg_temp.a318_auth('sales')) = 'agent_not_synced' AND pg_temp.a318_target_keys() = '',
  'an adopted agent id: version and status reset, not usable until synced');

-- An old-style ok row (no version, no credential): usable by the 317 rule.
SELECT pg_temp.a318_sync('curator-cn', '{"status":"ok","claudeAgentId":"agent_a318cn","environmentId":"env_a318","vaultId":"vlt_cn"}') AS a318_s7 \gset
SELECT pg_temp.a318_assert(pg_temp.a318_auth('curator-cn') ->> 'agentKey' = 'curator-cn'
  AND (SELECT claude_agent_version IS NULL AND claude_credential_id IS NULL FROM platform_private.ai_agents WHERE organization_id = pg_temp.a318_id(1) AND key = 'curator-cn'),
  'ok without version and credential is still authorized (the 317 behaviour is not narrowed)');
-- The helper itself on the stored rows: usable on the ok row, not on a never-synced one.
SELECT pg_temp.a318_assert(
  (SELECT platform_private.ai_agent_claude_usable(a) FROM platform_private.ai_agents a WHERE a.organization_id = pg_temp.a318_id(1) AND a.key = 'curator-cn')
  AND NOT (SELECT platform_private.ai_agent_claude_usable(a) FROM platform_private.ai_agents a WHERE a.organization_id = pg_temp.a318_id(1) AND a.key = 'curator-eu'),
  'helper: usable on an ok row with ids, not on a never-synced row');

-- ---------------------------------------------------------------------------
-- 3. (b) send_message without an idempotency key.
-- ---------------------------------------------------------------------------
-- Put `sales` back into a clean usable state; Auto stays OFF for the draft scenarios.
SELECT pg_temp.a318_sync('sales', '{"status":"ok","claudeAgentId":"agent_a318sales","agentVersion":3,"environmentId":"env_a318","vaultId":"vlt_a318","credentialId":"vcrd_a318"}') AS a318_s8 \gset
CREATE FUNCTION pg_temp.a318_send(p_key TEXT, p_args TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_svc(format('SELECT platform.ai_agent_tool_send_message_v1(%L, %L, %L::jsonb)', pg_temp.a318_id(p_org), p_key, p_args))
$$;
CREATE FUNCTION pg_temp.a318_drafts(p_case INTEGER, p_agent TEXT DEFAULT 'sales') RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform_private.ai_agent_drafts d WHERE d.organization_id = pg_temp.a318_id(1) AND d.student_case_id = pg_temp.a318_id(p_case) AND d.agent_key = p_agent
$$;

SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Добрый день! Пришлите, пожалуйста, аттестат.","reason":"Напоминание"}', pg_temp.a318_id(701))) AS a318_m1 \gset
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Добрый день! Пришлите, пожалуйста, аттестат.","reason":"Напоминание"}', pg_temp.a318_id(701))) AS a318_m1b \gset
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"  ДОБРЫЙ ДЕНЬ!\n\nПришлите,   пожалуйста,\tаттестат.  ","reason":"Иначе"}', pg_temp.a318_id(701))) AS a318_m1c \gset
SELECT pg_temp.a318_assert(
  (:'a318_m1'::JSONB) ->> 'status' = 'draft_created' AND (:'a318_m1'::JSONB) = (:'a318_m1b'::JSONB) AND (:'a318_m1'::JSONB) = (:'a318_m1c'::JSONB)
  AND pg_temp.a318_drafts(701) = 1
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE organization_id = pg_temp.a318_id(1) AND agent_key = 'sales'
      AND dedupe_key LIKE 'send_message_auto:%' AND char_length(dedupe_key) = 18 + 64),
  'no key: the same target and text (whitespace and case apart) is one draft and the same answer; the derived key is stored apart: ' || :'a318_m1');

SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Другой текст для того же дела"}', pg_temp.a318_id(701))) AS a318_m2 \gset
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Добрый день! Пришлите, пожалуйста, аттестат."}', pg_temp.a318_id(702))) AS a318_m3 \gset
SELECT pg_temp.a318_assert(
  (:'a318_m2'::JSONB) ->> 'draft_id' <> (:'a318_m1'::JSONB) ->> 'draft_id' AND (:'a318_m3'::JSONB) ->> 'draft_id' <> (:'a318_m1'::JSONB) ->> 'draft_id'
  AND pg_temp.a318_drafts(701) = 2 AND pg_temp.a318_drafts(702) = 1,
  'another text and another target are new drafts');

-- Another agent with the same text and target is its own message (the key is per agent).
SELECT pg_temp.a318_sync('curator-cn', '{"status":"ok","claudeAgentId":"agent_a318cn","agentVersion":1,"environmentId":"env_a318","vaultId":"vlt_cn","credentialId":"vcrd_cn"}') AS a318_s9 \gset
SELECT pg_temp.a318_send('curator-cn', format('{"channel":"portal","case_id":"%s","text":"Добрый день! Пришлите, пожалуйста, аттестат."}', pg_temp.a318_id(701))) AS a318_m4 \gset
SELECT pg_temp.a318_assert((:'a318_m4'::JSONB) ->> 'status' = 'draft_created' AND (:'a318_m4'::JSONB) ->> 'draft_id' <> (:'a318_m1'::JSONB) ->> 'draft_id'
  AND pg_temp.a318_drafts(701, 'curator-cn') = 1 AND pg_temp.a318_drafts(701) = 2,
  'the derived key is per agent');

-- The model's own key keeps its meaning and does not meet the derived namespace.
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Текст с ключом модели","idempotency_key":"k-318-1"}', pg_temp.a318_id(702))) AS a318_k1 \gset
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Совсем другой текст","idempotency_key":"k-318-1"}', pg_temp.a318_id(702))) AS a318_k1b \gset
SELECT pg_temp.a318_assert((:'a318_k1'::JSONB) = (:'a318_k1b'::JSONB) AND pg_temp.a318_drafts(702) = 2
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_dedupe WHERE agent_key = 'sales' AND dedupe_key = 'send_message:k-318-1')
  AND (SELECT count(*) = 3 FROM platform_private.ai_agent_dedupe WHERE agent_key = 'sales' AND dedupe_key LIKE 'send_message\_auto:%'),
  'an explicit key still wins over a different text (317), in its own namespace');

-- Outside the 10-minute window the same message is a new one.
UPDATE platform_private.ai_agent_dedupe SET created_at = clock_timestamp() - INTERVAL '11 minutes'
  WHERE agent_key = 'sales' AND dedupe_key LIKE 'send_message\_auto:%' AND (result ->> 'draft_id')::UUID = (:'a318_m2'::JSONB ->> 'draft_id')::UUID;
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Другой текст для того же дела"}', pg_temp.a318_id(701))) AS a318_m5 \gset
SELECT pg_temp.a318_assert((:'a318_m5'::JSONB) ->> 'status' = 'draft_created' AND (:'a318_m5'::JSONB) ->> 'draft_id' <> (:'a318_m2'::JSONB) ->> 'draft_id'
  AND pg_temp.a318_drafts(701) = 3,
  'after 10 minutes the same text is a new draft');
-- The three-pending cap still applies to the derived keys (the cap error is not cached).
SELECT pg_temp.a318_assert(pg_temp.a318_msg(pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Четвёртый разный текст"}', pg_temp.a318_id(701)))) = 'conflict'
  AND pg_temp.a318_drafts(701) = 3,
  'the cap of three pending drafts per target and agent still refuses a fourth');
SELECT pg_temp.a318_assert(pg_temp.a318_err(pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":""}', pg_temp.a318_id(701)))) = '22023'
  AND pg_temp.a318_err(pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"x","idempotency_key":""}', pg_temp.a318_id(701)))) = '22023'
  AND pg_temp.a318_err(pg_temp.a318_staff(1, format('SELECT platform.ai_agent_tool_send_message_v1(%L, ''sales'', ''{}''::jsonb)', pg_temp.a318_id(1)))) = '42501',
  'bad arguments are still 22023 before the key is derived; the tool stays closed to staff');

-- Auto ON: a repeated portal send writes exactly ONE chat message.
SELECT pg_temp.a318_upd('sales', '{"autoSend":true}', 2010) AS a318_auto \gset
SELECT pg_temp.a318_assert((:'a318_auto'::JSONB) -> 'changed' = '["autoSend"]'::JSONB, 'Auto switched on: ' || :'a318_auto');
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Напоминаю про аттестат (прямая отправка)."}', pg_temp.a318_id(701))) AS a318_d1 \gset
SELECT pg_temp.a318_send('sales', format('{"channel":"portal","case_id":"%s","text":"Напоминаю про аттестат (прямая отправка)."}', pg_temp.a318_id(701))) AS a318_d2 \gset
SELECT pg_temp.a318_assert((:'a318_d1'::JSONB) ->> 'status' = 'sent' AND (:'a318_d1'::JSONB) ->> 'mode' = 'direct' AND (:'a318_d1'::JSONB) = (:'a318_d2'::JSONB)
  AND (SELECT count(*) = 1 FROM platform.case_chat_messages WHERE student_case_id = pg_temp.a318_id(701) AND body LIKE 'Напоминаю про аттестат%')
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.action = 'ai.agent.message.send' AND e.resource_id = pg_temp.a318_id(701))
  AND (SELECT count(*) = 1 FROM platform_private.ai_agent_drafts WHERE text LIKE 'Напоминаю про аттестат%'),
  'Auto ON: the second identical call after a retry sends nothing: one chat message, one journal row, one draft: ' || :'a318_d1');
SELECT pg_temp.a318_upd('sales', '{"autoSend":false}', 2011) AS a318_auto_off \gset

-- The replay of needs_dispatch follows the draft state (a WhatsApp send in flight).
CREATE FUNCTION pg_temp.a318_replay_case(p_status TEXT, p_failure TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid(); v_out JSONB;
BEGIN
  INSERT INTO platform_private.ai_agent_drafts (id, organization_id, agent_key, channel, student_case_id, target_label, text, status, failure_code, sent_by_agent)
  VALUES (v_id, pg_temp.a318_id(1), 'sales', 'portal', pg_temp.a318_id(702), 'A318 Клиент Два', 'Replay ' || p_status, p_status, p_failure, TRUE);
  v_out := platform_private.ai_agent_send_replay(pg_temp.a318_id(1), jsonb_build_object('status', 'needs_dispatch', 'mode', 'direct',
    'draft_id', v_id, 'sender_membership_id', pg_temp.a318_id(301)));
  RETURN v_out || jsonb_build_object('_id', v_id);
END
$$;
SELECT pg_temp.a318_replay_case('approved', NULL) AS a318_r_approved,
  pg_temp.a318_replay_case('sent', NULL) AS a318_r_sent,
  pg_temp.a318_replay_case('sending', NULL) AS a318_r_sending,
  pg_temp.a318_replay_case('failed', 'unknown_result') AS a318_r_unknown,
  pg_temp.a318_replay_case('pending', 'whatsapp_unavailable') AS a318_r_pending,
  pg_temp.a318_replay_case('failed', 'provider_error') AS a318_r_failed,
  pg_temp.a318_replay_case('discarded', NULL) AS a318_r_discarded \gset
SELECT pg_temp.a318_assert(
  (:'a318_r_approved'::JSONB) ->> 'status' = 'needs_dispatch' AND (:'a318_r_approved'::JSONB) ->> 'sender_membership_id' = pg_temp.a318_id(301)::TEXT
  AND (:'a318_r_sent'::JSONB) - '_id' = jsonb_build_object('status', 'sent', 'mode', 'direct', 'draft_id', (:'a318_r_sent'::JSONB) ->> '_id')
  AND (:'a318_r_sending'::JSONB) ->> 'status' = 'queued_unknown' AND (:'a318_r_unknown'::JSONB) ->> 'status' = 'queued_unknown'
  AND (:'a318_r_pending'::JSONB) ->> 'status' = 'draft_created' AND (:'a318_r_pending'::JSONB) ->> 'hint' = 'Ждёт одобрения сотрудника в CRM'
  AND (:'a318_r_failed'::JSONB) ->> 'status' = 'draft_created' AND (:'a318_r_failed'::JSONB) ->> 'hint' LIKE 'Сообщение не отправлено%'
  AND (:'a318_r_discarded'::JSONB) ->> 'status' = 'draft_created'
  AND platform_private.ai_agent_send_replay(pg_temp.a318_id(1), '{"status":"sent","mode":"direct","draft_id":"x"}'::JSONB) = '{"status":"sent","mode":"direct","draft_id":"x"}'::JSONB
  AND platform_private.ai_agent_send_replay(pg_temp.a318_id(1), jsonb_build_object('status', 'needs_dispatch', 'draft_id', pg_temp.a318_id(9999))) ->> 'status' = 'needs_dispatch',
  'replay of needs_dispatch: approved stays dispatchable; sent -> sent; sending / unknown -> queued_unknown; pending -> draft_created; failed / discarded never claim "sent"');
SELECT pg_temp.a318_assert(platform_private.ai_agent_send_text_norm(E'  Привет,\n\n МИР\t! ') = 'привет, мир !'
  AND platform_private.ai_agent_send_text_norm('Привет, мир !') = 'привет, мир !',
  'text normalization: whitespace runs collapse, case folds, edges trim');

-- ---------------------------------------------------------------------------
-- 4. (c) The environment lease.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.a318_claim(p_key TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_rt('ai_agent_runtime_environment_claim_v1', format('%L, %L', pg_temp.a318_id(p_org), p_key))
$$;
CREATE FUNCTION pg_temp.a318_release(p_token TEXT, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a318_rt('ai_agent_runtime_environment_release_v1', format('%L, %L', pg_temp.a318_id(p_org), p_token))
$$;
-- Organization 1 already has an environment recorded by the scenarios above, so a lease is never needed there: the
-- first checks are on organization 2, which has none.
SELECT pg_temp.a318_assert(
  pg_temp.a318_err(pg_temp.a318_staff(1, format('SELECT platform.ai_agent_runtime_environment_claim_v1(%L, ''sales'')', pg_temp.a318_id(1)))) = '42501'
  AND pg_temp.a318_err(pg_temp.a318_anon(format('SELECT platform.ai_agent_runtime_environment_claim_v1(%L, ''sales'')', pg_temp.a318_id(1)))) = '42501'
  AND pg_temp.a318_err(pg_temp.a318_staff(1, format('SELECT platform.ai_agent_runtime_environment_release_v1(%L, %L)', pg_temp.a318_id(1), pg_temp.a318_id(7777)))) = '42501'
  AND pg_temp.a318_err(pg_temp.a318_anon(format('SELECT platform.ai_agent_runtime_environment_release_v1(%L, %L)', pg_temp.a318_id(1), pg_temp.a318_id(7777)))) = '42501'
  AND pg_temp.a318_err(pg_temp.a318_claim('nobody', 2)) = 'P0002'
  AND pg_temp.a318_err(pg_temp.a318_rt('ai_agent_runtime_environment_claim_v1', 'NULL, ''sales''')) = 'P0002'
  AND pg_temp.a318_err(pg_temp.a318_rt('ai_agent_runtime_environment_release_v1', format('%L, NULL', pg_temp.a318_id(2)))) = '22023'
  AND pg_temp.a318_err(pg_temp.a318_rt('ai_agent_runtime_environment_release_v1', format('NULL, %L', pg_temp.a318_id(7777)))) = '22023',
  'lease functions: closed to staff and anon (42501), an unknown agent or organization is P0002, a null token 22023');

SELECT pg_temp.a318_claim('sales', 2) AS a318_c1 \gset
SELECT (:'a318_c1'::JSONB ->> 'claimToken') AS a318_t1 \gset
SELECT pg_temp.a318_assert((:'a318_c1'::JSONB) ->> 'status' = 'claimed' AND :'a318_t1' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (SELECT environment_claim_token = :'a318_t1'::UUID AND environment_claim_key = 'sales'
      AND environment_claim_until BETWEEN clock_timestamp() + INTERVAL '2 minutes 50 seconds' AND clock_timestamp() + INTERVAL '3 minutes 5 seconds'
      FROM platform_private.ai_agents_org_settings WHERE organization_id = pg_temp.a318_id(2)),
  'the first syncing agent gets the lease (token, three minutes): ' || :'a318_c1');
SELECT pg_temp.a318_claim('curator-cn', 2) AS a318_c2 \gset
SELECT pg_temp.a318_assert((:'a318_c2'::JSONB) ->> 'status' = 'busy' AND ((:'a318_c2'::JSONB) ->> 'retryAfterSeconds')::INTEGER BETWEEN 1 AND 30
  AND NOT (:'a318_c2'::JSONB) ? 'claimToken',
  'a second agent of the same organization waits: busy: ' || :'a318_c2');
-- The other organization is independent.
SELECT pg_temp.a318_assert(pg_temp.a318_claim('curator-cn', 1) ->> 'status' = 'known' AND pg_temp.a318_claim('sales', 1) ->> 'environmentId' = 'env_a318',
  'an organization whose agents already record an environment answers known (organization 1), whatever organization 2 holds');
-- A wrong token releases nothing; the right one releases.
SELECT pg_temp.a318_assert(pg_temp.a318_release(pg_temp.a318_id(7777)::TEXT, 2) = '{"released":false}'::JSONB
  AND pg_temp.a318_claim('curator-cn', 2) ->> 'status' = 'busy'
  AND (SELECT environment_claim_token = :'a318_t1'::UUID FROM platform_private.ai_agents_org_settings WHERE organization_id = pg_temp.a318_id(2)),
  'a wrong token changes nothing: still busy for the others');
SELECT pg_temp.a318_release(:'a318_t1', 2) AS a318_rel1 \gset
SELECT pg_temp.a318_release(:'a318_t1', 2) AS a318_rel2 \gset
SELECT pg_temp.a318_assert((:'a318_rel1'::JSONB) = '{"released":true}'::JSONB AND (:'a318_rel2'::JSONB) = '{"released":false}'::JSONB
  AND (SELECT environment_claim_token IS NULL AND environment_claim_until IS NULL AND environment_claim_key IS NULL
      FROM platform_private.ai_agents_org_settings WHERE organization_id = pg_temp.a318_id(2)),
  'the right token releases the lease once');
-- After the release the next agent gets it, and an expired lease is taken over (the old token then releases nothing).
SELECT pg_temp.a318_claim('curator-cn', 2) AS a318_c3 \gset
SELECT (:'a318_c3'::JSONB ->> 'claimToken') AS a318_t3 \gset
UPDATE platform_private.ai_agents_org_settings SET environment_claim_until = clock_timestamp() - INTERVAL '1 minute' WHERE organization_id = pg_temp.a318_id(2);
SELECT pg_temp.a318_claim('sales', 2) AS a318_c4 \gset
SELECT (:'a318_c4'::JSONB ->> 'claimToken') AS a318_t4 \gset
SELECT pg_temp.a318_release(:'a318_t3', 2) AS a318_rel3 \gset
SELECT pg_temp.a318_assert((:'a318_c3'::JSONB) ->> 'status' = 'claimed' AND (:'a318_c4'::JSONB) ->> 'status' = 'claimed' AND :'a318_t3' <> :'a318_t4'
  AND (:'a318_rel3'::JSONB) = '{"released":false}'::JSONB
  AND (SELECT environment_claim_token = :'a318_t4'::UUID AND environment_claim_key = 'sales' FROM platform_private.ai_agents_org_settings WHERE organization_id = pg_temp.a318_id(2)),
  'the lease is free after release; an expired lease is taken over and the old holder cannot release the new one');
-- Once an agent records the environment, everyone else gets known and never needs the lease.
SELECT pg_temp.a318_sync('sales', '{"status":"pending","environmentId":"env_shared318"}', 2) AS a318_s10 \gset
SELECT pg_temp.a318_claim('curator-cn', 2) AS a318_k_held \gset
SELECT pg_temp.a318_release(:'a318_t4', 2) AS a318_rel4 \gset
SELECT pg_temp.a318_claim('curator-tr', 2) AS a318_k_free \gset
SELECT pg_temp.a318_assert((:'a318_k_held'::JSONB) = '{"status":"known","environmentId":"env_shared318"}'::JSONB
  AND (:'a318_rel4'::JSONB) = '{"released":true}'::JSONB
  AND (:'a318_k_free'::JSONB) = '{"status":"known","environmentId":"env_shared318"}'::JSONB,
  'a recorded environment is reused by every other agent (known), with or without a lease held');
-- The three columns move together.
DO $a318_check$
DECLARE v_state TEXT;
BEGIN
  BEGIN
    UPDATE platform_private.ai_agents_org_settings SET environment_claim_token = gen_random_uuid() WHERE organization_id = pg_temp.a318_id(2);
    v_state := 'accepted';
  EXCEPTION WHEN check_violation THEN
    v_state := 'check';
  END;
  PERFORM pg_temp.a318_assert(v_state = 'check', 'the CHECK keeps token, deadline and key together: ' || v_state);
END
$a318_check$;

\echo A318_AI_AGENTS_FOLLOWUPS_SUITE_PASSED
ROLLBACK;
