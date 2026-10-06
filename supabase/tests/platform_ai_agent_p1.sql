\set ON_ERROR_STOP on
-- Boundary suite for migrations 267–269 («ИИ-агент» P1,
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.3–4.4, §5, §6, §10, §13–§15). Runs on
-- the LATEST chain inside one transaction that is rolled back, with its own
-- synthetic organizations; no provider, Gemini call, real person or
-- production action. Members are modelled like production (invited staff have
-- coarse role NULL; permissions come from scoped role assignments with the
-- production keys of the «общие разделы» roles); conversations and messages come
-- from the REAL WAHA projection chain.
--
-- Proves:
--  1. the role evo_ai_agent: NOLOGIN, NOINHERIT, no BYPASSRLS/CREATEROLE/
--     CREATEDB, member of no role, statement/idle timeouts; USAGE only on
--     platform_ai_agent; no privilege on any table, view or sequence of any
--     schema; the only SECURITY DEFINER functions it can execute are the 18
--     platform_ai_agent functions; a direct SELECT of ai_chunks,
--     communication_messages, the pgmq queue or kb_nodes is refused 42501;
--     every ai_* table has FORCE RLS, no policy and no API-role grant;
--  2. rights (268): the grant publishes ai.agent.use/manage into the
--     organization-only roles with the staff_role_publish steps (new bundle
--     version, binding, role version, assignments moved with the same scope,
--     access versions bumped, migration audit), leaves a role with own-capable
--     permissions and the WhatsApp role untouched, and a second run changes
--     nothing;
--  3. tickets: refused without consent (PT412), for a member without
--     ai.agent.use, without access to the conversation, for a curator-queue
--     chat, a Student, another organization and anon; a ticket is 64 hex, only
--     its SHA-256 is stored, it lives 60 s, redeems once, not after expiry and
--     not for another purpose; at most 60 tickets per member per minute
--     (PT429 ai_ticket_rate_limited);
--  4. no dialog text without a ticket: every one of the 18 agent functions
--     called without a valid redemption raises or returns no message text and
--     no phone; a redemption older than 5 minutes or of a member who lost access
--     is refused; the valid context holds the last messages and a lead card
--     without the phone;
--  5. seeding: non-admin refused 42501; nodes outside the allowlist (working
--     material, other root, area raw, file, deleted, archived ancestor) refused
--     all-or-nothing; allowlisted pages become queued documents with the
--     audience of their import mark and a pointer-only queue message; replay
--     and unchanged re-seed create nothing; rules seed → unconfirmed current
--     rules; no agent function reads the knowledge base;
--  6. worker indexing through the queue, search (client chunks only in the
--     client list, internal branch, FTS fallback, open review items);
--  7. one generator per answer key, cache hit without a rate take, citations
--     only to client chunks of live documents (not superseded), supersede on a
--     new inbound (claim PT409, heartbeat/finish → superseded), stale insert
--     PT409, fingerprint change by a rules save; a follow-up is anchored to the
--     last outbound message too and is stale after a newer staff message;
--  8. rate limit 20/min (21st PT429, one take per redemption);
--  9. spend: prices by day (Flash doubles on 2027-01-01), costs, replay, unpriced
--     model, spend_v1 sums equal SUM over ai_usage_daily, budget cap PT402; the
--     cap cannot be bypassed with an unpriced model: settings refuse a model
--     without today's price (22023), a reservation is refused while a
--     configured model is unpriced (PT402 ai_model_unpriced), and an unpriced
--     call is booked at its reservation, not at 0;
-- 10. settings, rules (append-only), documents, consent revoke.
BEGIN;

DO $ai267_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$ai267_auth_role$;

CREATE FUNCTION pg_temp.ai_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.ai_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('26700000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.ai_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'AI267: %', message; END IF;
END
$$;
-- 'ok' or SQLSTATE:message of a failing statement.
CREATE FUNCTION pg_temp.ai_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The JSONB result of a call, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.ai_call(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  EXECUTE sql INTO result; RETURN COALESCE(result, 'null'::JSONB);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
END
$$;
CREATE FUNCTION pg_temp.ai_unit(k INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_agg(CASE WHEN i = k THEN 1 WHEN i = k + 1 THEN 0.2 ELSE 0 END ORDER BY i) FROM generate_series(1, 1536) i
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ai_id(INTEGER), pg_temp.ai_wid(INTEGER), pg_temp.ai_assert(BOOLEAN, TEXT),
  pg_temp.ai_err(TEXT), pg_temp.ai_call(TEXT), pg_temp.ai_unit(INTEGER)
  TO authenticated, anon, service_role, evo_ai_agent;
-- The suite acts as the agent role (as Supavisor would log it in).
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

SELECT 'AI267_AI_AGENT_P1_SUITE_START' AS ai267_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. The role and the catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.ai_assert((SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
    AND rolconfig @> ARRAY['statement_timeout=15s', 'idle_in_transaction_session_timeout=30s']
  FROM pg_roles WHERE rolname = 'evo_ai_agent'), 'evo_ai_agent: NOLOGIN NOINHERIT, no bypass/create, timeouts');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM pg_auth_members m
  WHERE m.member = 'evo_ai_agent'::regrole), 'evo_ai_agent is a member of no role');
SELECT pg_temp.ai_assert(has_schema_privilege('evo_ai_agent', 'platform_ai_agent', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'platform_ai_agent', 'CREATE')
  AND NOT has_schema_privilege('evo_ai_agent', 'platform', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'platform_private', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'pgmq', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'storage', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'auth', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'private', 'USAGE')
  AND NOT has_schema_privilege('evo_ai_agent', 'public', 'CREATE'),
  'evo_ai_agent: USAGE on platform_ai_agent only; nothing on platform, platform_private, pgmq, storage, auth, private');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND ((c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (has_table_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))
    OR (c.relkind = 'S' AND has_sequence_privilege('evo_ai_agent', c.oid, 'USAGE, SELECT, UPDATE')))),
  'evo_ai_agent holds no privilege on any table, view or sequence of any schema');
SELECT pg_temp.ai_assert((SELECT array_agg(p.proname ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND has_schema_privilege('evo_ai_agent', n.oid, 'USAGE')
      AND has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  = ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1', 'budget_reserve_v1',
    'conversation_context_v1', 'document_claim_v1', 'document_index_v1', 'document_stage_v1', 'maintenance_v1',
    'rate_take_v1', 'ready_v1', 'redeem_ticket_v1', 'search_v1', 'settings_v1', 'usage_record_v1',
    'work_claim_v1', 'work_extend_v1', 'work_finish_v1']::NAME[],
  'the only definer functions evo_ai_agent can execute are the 18 platform_ai_agent functions');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_ai_agent' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  'no API role executes an agent function');
SELECT pg_temp.ai_assert((SELECT count(*) = 15 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%'),
  'the 15 staff functions are hardened definers executable by authenticated only');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_private' AND (p.proname LIKE 'ai\_agent\_%' OR p.proname IN ('ai_settings_row',
      'ai_knowledge_fingerprint', 'ai_fingerprint', 'ai_local_day', 'ai_staff_actor', 'ai_admin_actor',
      'ai_conversation_allowed', 'ai_latest_inbound', 'ai_require_consent', 'ai_request_replay', 'ai_request_finish',
      'ai_bump_knowledge', 'ai_enqueue', 'ai_price', 'ai_purpose_group', 'ai_redemption', 'ai_rate_take',
      'ai_document_json', 'ai_search_rank', 'ai_rules_versions_guard'))
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))),
  'private ai_* helpers are executable by no API role and not by the agent');
SELECT pg_temp.ai_assert((SELECT count(*) = 16 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = c.relname))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'platform_private' AND c.relkind = 'r' AND c.relname IN ('ai_rules_versions', 'ai_settings',
    'ai_documents', 'ai_document_pages', 'ai_chunks', 'ai_review_items', 'ai_golden_examples', 'ai_answers', 'ai_tickets',
    'ai_prices', 'ai_usage_daily', 'ai_usage_member_daily', 'ai_usage_calls', 'ai_budget_reservations', 'ai_rate_limits',
    'ai_requests')),
  'the 16 ai_* tables: FORCE RLS, no policy, no API-role grant');
SELECT pg_temp.ai_assert((SELECT relpersistence = 'u' FROM pg_class WHERE oid = 'platform_private.ai_rate_limits'::regclass),
  'rate counters are UNLOGGED');
SELECT pg_temp.ai_assert((SELECT count(*) = 2 FROM pgmq.meta WHERE queue_name IN ('ai_agent_work_v1', 'ai_agent_dead_letter_v1')),
  'the agent queue and its dead letter exist');
SELECT pg_temp.ai_assert((SELECT count(*) = 1 FROM pg_indexes WHERE schemaname = 'platform_private'
    AND indexname = 'ai_chunks_embedding_hnsw' AND indexdef LIKE '%hnsw%halfvec_cosine_ops%m=''16''%ef_construction=''64''%')
  AND (SELECT format_type(atttypid, atttypmod) = 'halfvec(1536)' FROM pg_attribute
    WHERE attrelid = 'platform_private.ai_chunks'::regclass AND attname = 'embedding')
  AND (SELECT pg_get_expr(adbin, adrelid) LIKE '%russian%section_path%''A''%context%''C''%index_text%content%''B''%'
    FROM pg_attrdef WHERE adrelid = 'platform_private.ai_chunks'::regclass
      AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'platform_private.ai_chunks'::regclass AND attname = 'fts')),
  'chunks: halfvec(1536) with HNSW cosine m16/ef64 and a russian FTS A/C/B');
SELECT pg_temp.ai_assert((SELECT count(*) = 14 FROM platform_private.ai_prices)
  AND platform_private.ai_price('gemini-3.8-flash', 'input', DATE '2026-12-31') = 0.75
  AND platform_private.ai_price('gemini-3.8-flash', 'input', DATE '2027-01-01') = 1.50
  AND platform_private.ai_price('gemini-3.8-flash', 'output', DATE '2027-01-01') = 7.50
  AND platform_private.ai_price('gemini-embedding-2', 'embedding', DATE '2026-10-06') = 0.20
  AND platform_private.ai_price('gemini-3.8-flash', 'input', DATE '2026-09-30') IS NULL,
  'dated prices: Flash doubles on 2027-01-01, nothing before 2026-10-01');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_ai_agent' AND (p.prosrc LIKE '%kb\_%' OR p.prosrc LIKE '%knowledge_library%')),
  'no agent function reads the knowledge base');

-- A direct read as the agent role is refused everywhere.
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err('SELECT count(*) FROM platform_private.ai_chunks') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT count(*) FROM platform.communication_messages') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT count(*) FROM pgmq.q_ai_agent_work_v1') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT count(*) FROM platform_private.kb_nodes') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT count(*) FROM platform_private.ai_tickets') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT pgmq.read(''ai_agent_work_v1'', 1, 1)') LIKE '42501:%'
  AND pg_temp.ai_err('SELECT platform.ai_agent_settings_v1(NULL)') LIKE '42501:%',
  'the agent role reads no table, no queue and no CRM function directly');
SELECT pg_temp.ai_assert((platform_ai_agent.ready_v1() ->> 'queue')::BOOLEAN, 'ready_v1 sees the queue');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Fixture. Organization 1: 1 Admin (system); invited staff (coarse NULL):
--    2 sales (WhatsApp at own + «Продажи — общие разделы» at organization),
--    3 «Сопровождение — общие разделы» only, 4 WhatsApp only; 5 Student.
--    Organization 2: 6 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ai267_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO ai267_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL),
  (5, 1, 'student'), (6, 2, 'admin');
GRANT SELECT ON ai267_actors TO authenticated, anon, evo_ai_agent;
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.ai_id(1), 'AI267 Fictional organization'),
  (pg_temp.ai_id(2), 'AI267 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.ai_id(100 + n), 'ai267-' || n || '@example.invalid', '{}'::JSONB FROM ai267_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.ai_id(200 + n), pg_temp.ai_id(100 + n), 'AI267 Actor ' || n, 'active', 1 FROM ai267_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.ai_id(300 + a.n), pg_temp.ai_id(a.org), pg_temp.ai_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM ai267_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.ai_id(301), pg_temp.ai_id(306));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.ai_id(401), pg_temp.ai_id(1), 'organization', pg_temp.ai_id(1), 1),
  (pg_temp.ai_id(402), pg_temp.ai_id(2), 'organization', pg_temp.ai_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.ai_id(1), pg_temp.ai_id(301), pg_temp.ai_id(401), 1, 1, TRUE, 'system', 'AI267 synthetic scope', pg_temp.ai_id(601)),
  (pg_temp.ai_id(2), pg_temp.ai_id(306), pg_temp.ai_id(402), 1, 1, TRUE, 'system', 'AI267 synthetic scope', pg_temp.ai_id(602));

-- Roles with the production keys (the «общие разделы» roles of 173) before 268.
CREATE TEMP TABLE ai267_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO ai267_roles VALUES
 (pg_temp.ai_id(1101), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1110),
 (pg_temp.ai_id(1102), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1120),
 (pg_temp.ai_id(1103), 'WhatsApp', '["communication.manual.send","communication.read.full"]', 1130),
 (pg_temp.ai_id(1104), 'Sales', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","document.read.sales","finance.read.summary","lead.read","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1140);
CREATE TEMP TABLE ai267_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO ai267_grants VALUES
 (302, pg_temp.ai_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (302, pg_temp.ai_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.ai_id(1), 'resourceKind', NULL)),
 (303, pg_temp.ai_id(1102), jsonb_build_object('kind', 'organization', 'key', pg_temp.ai_id(1), 'resourceKind', NULL)),
 (304, pg_temp.ai_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE ai267_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.ai_id(1);
GRANT SELECT ON ai267_roles, ai267_grants, ai267_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.ai_id(101),
  'claims', jsonb_build_object('sub', pg_temp.ai_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS ai267_admin_setup \gset
SET LOCAL request.jwt.claims TO :'ai267_admin_setup';
SET LOCAL ROLE authenticated;
DO $ai267_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM ai267_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.ai_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'AI267 ' || r.label, 'description', 'Migration 268 synthetic role',
        'permissionKeys', r.keys), 'AI267 create role', pg_temp.ai_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.ai_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.ai_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'AI267 publish role', pg_temp.ai_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM ai267_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM ai267_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.ai_id(1), pg_temp.ai_id(m),
      (SELECT access_version FROM ai267_versions WHERE membership_id = pg_temp.ai_id(m)), items, bindings,
      'AI267 grant roles', pg_temp.ai_id(2000 + m));
  END LOOP;
END
$ai267_roles$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. Rights (268): before, during and after the grant.
-- ---------------------------------------------------------------------------
SELECT pg_temp.ai_assert(NOT platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(302), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(303), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(301), 'ai.agent.use')
  AND platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(301), 'ai.agent.manage'),
  'before the grant: the new roles lack ai.agent.*; the system Admin has them by itself');
CREATE TEMP TABLE ai267_before AS
  SELECT r.id, r.version, r.current_bundle_id, p.access_version AS member_version
  FROM platform.staff_role_definitions r
  LEFT JOIN platform.staff_role_assignments a ON a.role_id = r.id AND a.revoked_at IS NULL
  LEFT JOIN platform.organization_memberships m ON m.id = a.membership_id
  LEFT JOIN platform.profiles p ON p.id = m.profile_id
  WHERE r.organization_id = pg_temp.ai_id(1);
SELECT platform_private.ai_agent_grant_common_roles('AI267 grant') AS ai267_grant \gset
SELECT pg_temp.ai_assert((SELECT array_agg(e ->> 'roleId' ORDER BY e ->> 'roleId') FROM jsonb_array_elements(:'ai267_grant'::JSONB -> 'roles') e
    WHERE e ->> 'organizationId' = pg_temp.ai_id(1)::TEXT)
  = ARRAY[pg_temp.ai_id(1101)::TEXT, pg_temp.ai_id(1102)::TEXT],
  'the grant publishes the two organization-only roles and nothing else');
SELECT pg_temp.ai_assert((SELECT bool_and(r.version = b.version + 1 AND r.current_bundle_id <> b.current_bundle_id
    AND r.draft_permission_keys @> ARRAY['ai.agent.use', 'ai.agent.manage'])
  FROM platform.staff_role_definitions r JOIN (SELECT DISTINCT id, version, current_bundle_id FROM ai267_before) b ON b.id = r.id
  WHERE r.id IN (pg_temp.ai_id(1101), pg_temp.ai_id(1102))),
  'each granted role has a new current bundle, version + 1 and the keys in its draft');
SELECT pg_temp.ai_assert((SELECT bool_and(r.version = b.version AND r.current_bundle_id = b.current_bundle_id)
  FROM platform.staff_role_definitions r JOIN (SELECT DISTINCT id, version, current_bundle_id FROM ai267_before) b ON b.id = r.id
  WHERE r.id IN (pg_temp.ai_id(1103), pg_temp.ai_id(1104))),
  'the WhatsApp role and the own-capable Sales role (no assignments) are untouched');
SELECT pg_temp.ai_assert((SELECT array_agg(bp.permission_key ORDER BY bp.permission_key)
    FROM platform.staff_role_definitions r JOIN platform.role_bundle_permissions bp ON bp.bundle_id = r.current_bundle_id
    WHERE r.id = pg_temp.ai_id(1101))
  = (SELECT array_agg(k ORDER BY k) FROM jsonb_array_elements_text((SELECT keys FROM ai267_roles WHERE role_id = pg_temp.ai_id(1101))
      || '["ai.agent.use","ai.agent.manage"]'::JSONB) k)
  AND (SELECT b.status = 'published' AND bb.bundle_version = 2 FROM platform.staff_role_definitions r
    JOIN platform.role_bundle_versions b ON b.id = r.current_bundle_id
    JOIN platform.staff_role_bundle_bindings bb ON bb.bundle_id = r.current_bundle_id WHERE r.id = pg_temp.ai_id(1101)),
  'the new bundle = the published permissions + the two keys, published, binding version 2');
SELECT pg_temp.ai_assert((SELECT count(*) = 2 FROM platform.staff_role_assignments a
    WHERE a.role_id IN (pg_temp.ai_id(1101), pg_temp.ai_id(1102)) AND a.revoked_at IS NULL
      AND a.scope_kind = 'organization' AND a.scope_key = pg_temp.ai_id(1)::TEXT
      AND a.bundle_id = (SELECT current_bundle_id FROM platform.staff_role_definitions WHERE id = a.role_id))
  AND (SELECT count(*) = 2 FROM platform.staff_role_assignments a
    WHERE a.role_id IN (pg_temp.ai_id(1101), pg_temp.ai_id(1102)) AND a.revoked_at IS NOT NULL),
  'the assignments moved to the new bundle with the same organization scope; the old ones are revoked');
SELECT pg_temp.ai_assert(platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(302), 'ai.agent.use')
  AND platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(302), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(303), 'ai.agent.use')
  AND platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(302), 'communication.read.full')
  AND NOT platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(304), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.ai_id(1), pg_temp.ai_id(305), 'ai.agent.use'),
  'after the grant: both common-role members hold ai.agent.*, the WhatsApp-only member and the Student do not');
SELECT pg_temp.ai_assert((SELECT bool_and(p.access_version = v.access_version + 2) FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id JOIN ai267_versions v ON v.membership_id = m.id
    WHERE m.id IN (pg_temp.ai_id(302), pg_temp.ai_id(303)))
  AND (SELECT count(*) = 2 FROM platform.audit_events e WHERE e.organization_id = pg_temp.ai_id(1)
    AND e.action = 'staff.roles.migrated' AND e.actor_principal = 'migration:268' AND e.resource_type = 'staff_role'),
  'access versions bumped (assignment + grant) and one migration audit event per role');
CREATE TEMP TABLE ai267_bundle_count AS SELECT count(*) AS n FROM platform.role_bundle_versions;
SELECT pg_temp.ai_assert((SELECT jsonb_array_length(platform_private.ai_agent_grant_common_roles('AI267 again') -> 'roles') = 0)
  AND (SELECT count(*) FROM platform.role_bundle_versions) = (SELECT n FROM ai267_bundle_count),
  'a second run publishes nothing (idempotent)');

UPDATE ai267_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.ai_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.ai_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS ai267_admin FROM ai267_actors WHERE n = 1 \gset
SELECT claims AS ai267_sales FROM ai267_actors WHERE n = 2 \gset
SELECT claims AS ai267_common FROM ai267_actors WHERE n = 3 \gset
SELECT claims AS ai267_wa FROM ai267_actors WHERE n = 4 \gset
SELECT claims AS ai267_student FROM ai267_actors WHERE n = 5 \gset
SELECT claims AS ai267_other_admin FROM ai267_actors WHERE n = 6 \gset

-- ---------------------------------------------------------------------------
-- 4. Conversations through the REAL WAHA projection chain.
-- ---------------------------------------------------------------------------
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
CREATE FUNCTION pg_temp.ai_event(p_n INTEGER, p_payload JSONB) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE event_id CONSTANT UUID := pg_temp.ai_wid(1000 + p_n);
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, pg_temp.ai_id(1), 'waha', 'waha:crm_primary', NULL, NULL, 'ai267-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', TIMESTAMPTZ '2026-10-06 07:00:00+00' + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:ai267:' || p_n, lpad(to_hex(2670000 + p_n), 64, '0'), pg_temp.ai_wid(1500 + p_n));
  RETURN event_id;
END
$$;
CREATE FUNCTION pg_temp.ai_run(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.ai_id(1);
  event_id UUID := pg_temp.ai_event(p_n, p_payload);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('ai267-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.ai_wid(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'ai267', pg_temp.ai_wid(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.ai_id(301), pg_temp.ai_wid(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.ai_wid(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
CREATE FUNCTION pg_temp.ai_in(p_id TEXT, p_from TEXT, p_body TEXT, p_ts BIGINT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', p_ts, 'from', p_from, 'fromMe', false, 'source', 'app', 'body', p_body)
$$;
-- A message sent from the phone (fromMe) projects as an outbound staff message.
CREATE FUNCTION pg_temp.ai_out(p_id TEXT, p_to TEXT, p_body TEXT, p_ts BIGINT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('id', p_id, 'timestamp', p_ts, 'from', '79967000000@c.us', 'to', p_to, 'fromMe', true,
    'source', 'app', 'body', p_body)
$$;
CREATE FUNCTION pg_temp.ai_conv(p_chat TEXT) RETURNS UUID LANGUAGE SQL AS $$
  SELECT binding.conversation_id FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.ai_id(1) AND binding.normalized_chat_id = p_chat
$$;
CREATE FUNCTION pg_temp.ai_latest(p_conversation UUID) RETURNS UUID LANGUAGE SQL AS $$
  SELECT m.id FROM platform.communication_messages m WHERE m.conversation_id = p_conversation AND m.direction = 'inbound'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ai_latest(UUID) TO authenticated, evo_ai_agent;

SELECT pg_temp.ai_run(1, pg_temp.ai_in('false_79967000001@c.us_AI267AAAAAAAAAAAAAA1', '79967000001@c.us',
  'N267 SECRET CLIENT TEXT: хочу учиться в Малайзии', 1791270001)) AS r1 \gset
SELECT pg_temp.ai_run(2, pg_temp.ai_in('false_79967000002@c.us_AI267AAAAAAAAAAAAAA2', '79967000002@c.us',
  'Здравствуйте, второй клиент', 1791270002)) AS r2 \gset
SELECT pg_temp.ai_assert((:'r1'::JSONB ->> 'disposition') = 'succeeded' AND (:'r2'::JSONB ->> 'disposition') = 'succeeded',
  'two customer messages project through the real chain');
SELECT pg_temp.ai_conv('79967000001@c.us') AS c1, pg_temp.ai_conv('79967000002@c.us') AS c2 \gset
SELECT pg_temp.ai_latest(:'c1') AS m1, pg_temp.ai_latest(:'c2') AS m2 \gset
SELECT pg_temp.ai_assert((SELECT count(*) = 2 AND bool_and(queue = 'sales') FROM platform.communication_conversations
  WHERE id IN (:'c1', :'c2')), 'two sales-queue conversations');

-- Conversation 2 becomes a curator-queue chat (the state 044's assignment
-- trigger leaves), written as the table owner with a synthetic active case.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.ai_id(421), pg_temp.ai_id(1), 'student_case', pg_temp.ai_id(501), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.ai_id(501), pg_temp.ai_id(1), pg_temp.ai_id(301), pg_temp.ai_id(302),
  'synthetic:ai267:1', 'AI267 Student 501', 'MY', 'Bachelor', 'contract_confirmed', 'active', clock_timestamp(),
  pg_temp.ai_id(421), 1, 'new');
UPDATE platform.communication_conversations SET student_case_id = pg_temp.ai_id(501), queue = 'curator',
  current_curator_membership_id = pg_temp.ai_id(302), current_scope_id = pg_temp.ai_id(421), current_scope_version = 1,
  sales_authority_source = 'provider_linked', amocrm_account_id = 267, amocrm_lead_id = 267, amocrm_contact_id = 267
  WHERE id = :'c2';
-- A lead card for conversation 1 (name, interest, stage; the phone is never sent).
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.ai_id(701), pg_temp.ai_id(1), 'Айгерим Тестова', platform_private.normalize_person_name('Айгерим Тестова'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key, interest_direction)
  VALUES (pg_temp.ai_id(702), pg_temp.ai_id(1), pg_temp.ai_id(701), pg_temp.ai_id(301), 'new', 'website', 'MY');
UPDATE platform.communication_conversations SET canonical_client_id = pg_temp.ai_id(701), canonical_lead_id = pg_temp.ai_id(702)
  WHERE id = :'c1';
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 5. Consent (admin only) gates every ticket.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE 'PT412:ai_consent_required%', 'no consent → no ticket (PT412)');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_consent_record_v1(%L, ''grant'', ''v1'', %L)',
  pg_temp.ai_id(1), pg_temp.ai_id(3001))) LIKE '42501:ai_admin_required%',
  'a member with ai.agent.manage cannot record the Gemini consent');
SELECT pg_temp.ai_assert((platform.ai_agent_settings_v1(pg_temp.ai_id(1)) #>> '{consent,recorded}')::BOOLEAN = FALSE
  AND (platform.ai_agent_settings_v1(pg_temp.ai_id(1)) ->> 'canManage')::BOOLEAN,
  'settings show no consent and manage rights for the sales member');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((platform.ai_agent_consent_record_v1(pg_temp.ai_id(1), 'grant', 'gemini-2026-10', pg_temp.ai_id(3002))
  ->> 'status') = 'granted', 'the Admin records the consent');
SELECT pg_temp.ai_assert((platform.ai_agent_consent_record_v1(pg_temp.ai_id(1), 'grant', 'gemini-2026-10', pg_temp.ai_id(3002))
  ->> 'replayed')::BOOLEAN, 'the same request replays');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.ai_id(3002)
  AND action = 'ai.agent.consent.grant' AND actor_profile_id = pg_temp.ai_id(201)), 'the consent is audited once');

-- ---------------------------------------------------------------------------
-- 6. Tickets.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ai267_tickets(label TEXT PRIMARY KEY, ticket TEXT, redemption UUID);
GRANT SELECT, INSERT, UPDATE ON ai267_tickets TO authenticated, evo_ai_agent;
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 't1', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
INSERT INTO ai267_tickets(label, ticket) SELECT 't2', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
INSERT INTO ai267_tickets(label, ticket) SELECT 't3', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''laboratory'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '22023:%', 'an unknown purpose is refused');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m2')) LIKE '22023:ai_ticket_invalid_message%', 'a message of another conversation is refused');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, NULL)',
  pg_temp.ai_id(1), :'c2')) LIKE '42501:ai_conversation_unavailable%', 'a curator-queue chat gets no ticket');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT bool_and(ticket ~ '^[0-9a-f]{64}$') FROM ai267_tickets)
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_tickets t JOIN ai267_tickets x ON t.token_sha256 = x.ticket)
  AND (SELECT count(*) = 3 FROM platform_private.ai_tickets t JOIN ai267_tickets x
    ON t.token_sha256 = encode(sha256(decode(x.ticket, 'hex')), 'hex')
    WHERE t.expires_at - t.issued_at = INTERVAL '60 seconds' AND t.used_at IS NULL
      AND t.membership_id = pg_temp.ai_id(302) AND t.ref_id = :'m1'),
  'a ticket is 64 hex; only its SHA-256 is stored; it lives 60 s and is bound to the member and message');
SET LOCAL request.jwt.claims TO :'ai267_common';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '42501:ai_conversation_unavailable%',
  'ai.agent.use without communication.read.full: no ticket');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_wa';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '42501:ai_agent_forbidden%', 'communication.read.full without ai.agent.use: no ticket');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '42501:%', 'the Student gets no ticket');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '42501:%', 'another organization''s Admin gets no ticket');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m1')) LIKE '42501:%', 'anon gets no ticket');
RESET ROLE;

-- Redemption: once, within 60 s, for the same purpose.
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 't1';
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')',
  (SELECT ticket FROM ai267_tickets WHERE label = 't1'))) LIKE '42501:ai_ticket_invalid%', 'a ticket redeems only once');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''laboratory'')',
  (SELECT ticket FROM ai267_tickets WHERE label = 't2'))) LIKE '42501:ai_ticket_invalid%', 'another purpose is refused');
SELECT pg_temp.ai_assert(pg_temp.ai_err('SELECT platform_ai_agent.redeem_ticket_v1(''' || repeat('a', 64) || ''', ''answer'')')
  LIKE '42501:ai_ticket_invalid%' AND pg_temp.ai_err('SELECT platform_ai_agent.redeem_ticket_v1(''not-hex'', ''answer'')')
  LIKE '42501:ai_ticket_invalid%', 'an unknown or malformed ticket is refused');
RESET ROLE;
-- 61 seconds later (clock moved back on the row as the table owner).
UPDATE platform_private.ai_tickets t SET issued_at = t.issued_at - INTERVAL '61 seconds',
  expires_at = t.expires_at - INTERVAL '61 seconds'
  FROM ai267_tickets x WHERE x.label = 't3' AND t.token_sha256 = encode(sha256(decode(x.ticket, 'hex')), 'hex');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')',
  (SELECT ticket FROM ai267_tickets WHERE label = 't3'))) LIKE '42501:ai_ticket_invalid%', 'an expired ticket is refused');
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 't2';
RESET ROLE;
SELECT redemption AS red1 FROM ai267_tickets WHERE label = 't1' \gset
SELECT redemption AS red2 FROM ai267_tickets WHERE label = 't2' \gset

-- ---------------------------------------------------------------------------
-- 7. No dialog text without a valid redemption.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.conversation_context_v1(:'red1') AS ai267_context \gset
SELECT pg_temp.ai_assert((:'ai267_context'::JSONB -> 'messages') @> '[{"role":"client"}]'
  AND :'ai267_context' LIKE '%N267 SECRET CLIENT TEXT%'
  AND (:'ai267_context'::JSONB ->> 'latestInboundMessageId') = :'m1'
  AND (:'ai267_context'::JSONB -> 'lead') = '{"name":"Айгерим","stage":"new","interestDirection":"MY"}'::JSONB
  AND :'ai267_context' NOT LIKE '%79967%' AND :'ai267_context' NOT LIKE '%Тестова%',
  'a valid redemption reads the messages and a lead card without phone or surname');
CREATE TEMP TABLE ai267_no_ticket(fn TEXT PRIMARY KEY, result JSONB);
GRANT SELECT, INSERT ON ai267_no_ticket TO evo_ai_agent;
INSERT INTO ai267_no_ticket SELECT f, pg_temp.ai_call(sql) FROM (VALUES
 ('answer_claim_v1', format('SELECT platform_ai_agent.answer_claim_v1(%L, ''reply'', ''w'')', gen_random_uuid())),
 ('answer_finish_v1', format('SELECT platform_ai_agent.answer_finish_v1(%L, ''w'', ''failed'', NULL, NULL, NULL, NULL, ''x'')', gen_random_uuid())),
 ('answer_heartbeat_v1', format('SELECT platform_ai_agent.answer_heartbeat_v1(%L, ''w'')', gen_random_uuid())),
 ('budget_reserve_v1', format('SELECT platform_ai_agent.budget_reserve_v1(%L, ''answer'', 0.0001)', pg_temp.ai_id(1))),
 ('conversation_context_v1', format('SELECT platform_ai_agent.conversation_context_v1(%L)', gen_random_uuid())),
 ('document_claim_v1', format('SELECT platform_ai_agent.document_claim_v1(%L, ''w'', 60)', gen_random_uuid())),
 ('document_index_v1', format('SELECT platform_ai_agent.document_index_v1(%L, ''w'', ''[{"position":0,"content":"x"}]'')', gen_random_uuid())),
 ('document_stage_v1', format('SELECT platform_ai_agent.document_stage_v1(%L, ''w'', ''chunk'', 0)', gen_random_uuid())),
 ('maintenance_v1', 'SELECT platform_ai_agent.maintenance_v1()'),
 ('rate_take_v1', format('SELECT platform_ai_agent.rate_take_v1(%L)', gen_random_uuid())),
 ('ready_v1', 'SELECT platform_ai_agent.ready_v1()'),
 ('redeem_ticket_v1', format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')', repeat('0', 64))),
 ('search_v1', format('SELECT platform_ai_agent.search_v1(%L, ''[]'', ''["Малайзия"]'')', gen_random_uuid())),
 ('settings_v1', format('SELECT platform_ai_agent.settings_v1(%L)', pg_temp.ai_id(1))),
 ('usage_record_v1', format('SELECT platform_ai_agent.usage_record_v1(%L, %L, ''probe'', ''gemini-3.8-flash'', 1, 0, 0, 0, FALSE)',
   pg_temp.ai_id(1), gen_random_uuid())),
 ('work_claim_v1', 'SELECT platform_ai_agent.work_claim_v1(30, ''ai267-probe'')'),
 ('work_extend_v1', 'SELECT platform_ai_agent.work_extend_v1(0, 30)'),
 ('work_finish_v1', 'SELECT platform_ai_agent.work_finish_v1(0, ''done'')')) AS calls(f, sql);
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT array_agg(fn::NAME ORDER BY fn) FROM ai267_no_ticket)
  = (SELECT array_agg(p.proname ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'platform_ai_agent'::regnamespace),
  'every agent function is called without a ticket');
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM ai267_no_ticket WHERE result::TEXT LIKE '%N267 SECRET%'
  OR result::TEXT LIKE '%79967%' OR result::TEXT LIKE '%Айгерим%'),
  'no agent function returns message text, phone or lead without a redemption');
SELECT pg_temp.ai_assert((SELECT bool_and(result ->> 'error' LIKE '42501:%') FROM ai267_no_ticket
  WHERE fn IN ('answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1', 'conversation_context_v1',
    'rate_take_v1', 'redeem_ticket_v1', 'search_v1')),
  'the interactive functions refuse 42501 without a redemption');
-- A ticket issued but not redeemed, or redeemed more than 5 minutes ago, reads nothing.
SELECT t.id AS ai267_unredeemed FROM platform_private.ai_tickets t JOIN ai267_tickets x
  ON t.token_sha256 = encode(sha256(decode(x.ticket, 'hex')), 'hex') WHERE x.label = 't3' \gset
UPDATE platform_private.ai_tickets SET used_at = clock_timestamp() - INTERVAL '6 minutes' WHERE id = :'red2';
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.conversation_context_v1(%L)', :'ai267_unredeemed'))
  LIKE '42501:ai_redemption_invalid%' AND pg_temp.ai_err(format('SELECT platform_ai_agent.conversation_context_v1(%L)', :'red2'))
  LIKE '42501:ai_redemption_invalid%', 'an unredeemed ticket or a redemption older than 5 minutes reads nothing');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. Seeding from the knowledge base (admin only, closed allowlist).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.kb_nodes(id, organization_id, area, parent_id, kind, title, body, source, updated_by,
  archived_at, deleted_at) VALUES
 (pg_temp.ai_id(801), pg_temp.ai_id(1), 'internal', NULL, 'folder', 'ИИ-ассистент', '', '{}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(802), pg_temp.ai_id(1), 'internal', NULL, 'folder', 'Компания', '', '{}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(803), pg_temp.ai_id(1), 'internal', NULL, 'folder', 'Страны и поступление', '', '{}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(804), pg_temp.ai_id(1), 'internal', NULL, 'folder', 'Панель управления', '', '{}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(805), pg_temp.ai_id(1), 'raw', NULL, 'folder', 'Страны и поступление', '', '{}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(806), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(803), 'folder', 'Архив', '', '{}', pg_temp.ai_id(301), clock_timestamp(), NULL),
 (pg_temp.ai_id(811), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(803), 'page', 'Малайзия: стоимость',
   'Обучение в Малайзии стоит 5000 долларов в год. Виза оформляется за 30 дней.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(812), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(802), 'page', 'Скидки',
   'Скидка до 15 процентов только с согласования руководителя.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(813), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(803), 'page', 'Рабочие заметки', 'Черновик.',
   '{"classification":"internal_working_material"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(814), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(804), 'page', 'Панель', 'Служебное.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(815), pg_temp.ai_id(1), 'raw', pg_temp.ai_id(805), 'page', 'Сырой экспорт', 'Сырое.',
   '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(816), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(802), 'file', 'Прайс.pdf', '',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(817), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(802), 'page', 'Удалённая', 'Удалено.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.ai_id(301), NULL, clock_timestamp()),
 (pg_temp.ai_id(818), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(806), 'page', 'В архивной папке', 'Старое.',
   '{"classification":"historically_approved_internal_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(819), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(801), 'page', 'Правила ответов',
   'Отвечайте вежливо и кратко.', '{"classification":"historically_approved_general_client_knowledge"}', pg_temp.ai_id(301), NULL, NULL),
 (pg_temp.ai_id(820), pg_temp.ai_id(1), 'internal', pg_temp.ai_id(801), 'page', 'Продажи и ответы',
   'Сначала квалифицируйте клиента: страна, уровень, бюджет.', '{"classification":"historically_approved_internal_knowledge"}',
   pg_temp.ai_id(301), NULL, NULL);

SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_seed_from_kb_v1(%L, ARRAY[%L]::UUID[], ''document'', %L)',
  pg_temp.ai_id(1), pg_temp.ai_id(811), pg_temp.ai_id(3101))) LIKE '42501:ai_admin_required%',
  'a member with ai.agent.manage cannot copy from the knowledge base');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((SELECT bool_and(pg_temp.ai_err(format(
    'SELECT platform.ai_agent_seed_from_kb_v1(%L, ARRAY[%L, %L]::UUID[], ''document'', %L)',
    pg_temp.ai_id(1), pg_temp.ai_id(811), pg_temp.ai_id(n), gen_random_uuid())) LIKE '42501:ai_seed_node_not_allowed%')
  FROM unnest(ARRAY[813, 814, 815, 816, 817, 818, 801, 999]) n),
  'working material, another root, area raw, a file, a deleted page, an archived ancestor, a folder and an unknown node are refused all-or-nothing');
SELECT platform.ai_agent_seed_from_kb_v1(pg_temp.ai_id(1), ARRAY[pg_temp.ai_id(811), pg_temp.ai_id(812)], 'document',
  pg_temp.ai_id(3102)) AS ai267_seed \gset
SELECT pg_temp.ai_assert((platform.ai_agent_seed_from_kb_v1(pg_temp.ai_id(1), ARRAY[pg_temp.ai_id(811), pg_temp.ai_id(812)],
  'document', pg_temp.ai_id(3102)) ->> 'replayed')::BOOLEAN, 'the same seed request replays');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_seed_from_kb_v1(%L, ARRAY[%L]::UUID[], ''document'', %L)',
  pg_temp.ai_id(1), pg_temp.ai_id(811), pg_temp.ai_id(3102))) LIKE '23505:ai_request_conflict%',
  'the same request id with other input is a conflict');
SELECT pg_temp.ai_assert(jsonb_array_length(platform.ai_agent_seed_from_kb_v1(pg_temp.ai_id(1),
  ARRAY[pg_temp.ai_id(811)], 'document', pg_temp.ai_id(3103)) -> 'unchangedNodeIds') = 1,
  'an unchanged page is not copied twice');
SELECT platform.ai_agent_seed_from_kb_v1(pg_temp.ai_id(1), ARRAY[pg_temp.ai_id(819), pg_temp.ai_id(820)], 'rules',
  pg_temp.ai_id(3104)) AS ai267_rules_seed \gset
RESET ROLE;
SELECT d.id AS doc1 FROM platform_private.ai_documents d WHERE d.source_ref ->> 'nodeId' = pg_temp.ai_id(811)::TEXT \gset
SELECT d.id AS doc2 FROM platform_private.ai_documents d WHERE d.source_ref ->> 'nodeId' = pg_temp.ai_id(812)::TEXT \gset
SELECT pg_temp.ai_assert((SELECT count(*) = 2 FROM platform_private.ai_documents WHERE organization_id = pg_temp.ai_id(1))
  AND (SELECT audience = 'client' AND status = 'queued' AND kind = 'knowledge' AND source = 'seed_kb'
    AND NOT autosend_allowed AND content_md LIKE 'Обучение в Малайзии%' AND source_ref ->> 'nodeVersion' = '1'
    FROM platform_private.ai_documents WHERE id = :'doc1')
  AND (SELECT audience = 'internal' FROM platform_private.ai_documents WHERE id = :'doc2'),
  'two queued knowledge documents; audience from the import mark; autosend off');
SELECT pg_temp.ai_assert((SELECT count(*) = 2 FROM pgmq.q_ai_agent_work_v1 q
    WHERE q.message ->> 'ref_id' IN (:'doc1', :'doc2'))
  AND NOT EXISTS (SELECT 1 FROM pgmq.q_ai_agent_work_v1 q
    WHERE (q.message - ARRAY['v', 'kind', 'ref_id']) <> '{}'::JSONB OR q.message ->> 'kind' NOT IN ('seed', 'ingest', 'reindex', 'memory', 'autosend')),
  'one pointer-only queue message per document');
SELECT pg_temp.ai_assert((SELECT s.rules_version_id = (:'ai267_rules_seed'::JSONB ->> 'rulesVersionId')::UUID
    AND r.source = 'seed' AND r.confirmed_at IS NULL AND r.body LIKE '# Правила ответов%# Продажи и ответы%'
  FROM platform_private.ai_settings s JOIN platform_private.ai_rules_versions r ON r.id = s.rules_version_id
  WHERE s.organization_id = pg_temp.ai_id(1)),
  'the rules seed becomes the current, unconfirmed version, in the given order');
SELECT pg_temp.ai_assert((SELECT count(*) = 3 FROM platform.audit_events WHERE organization_id = pg_temp.ai_id(1)
  AND action = 'ai.agent.seed'), 'every seed command is audited');

-- ---------------------------------------------------------------------------
-- 9. The worker indexes through the queue.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ai267_work(msg_id BIGINT, ref_id UUID);
GRANT SELECT, INSERT ON ai267_work TO evo_ai_agent;
SET LOCAL ROLE evo_ai_agent;
DO $ai267_claims$
DECLARE r JSONB; i INTEGER;
BEGIN
  FOR i IN 1..10 LOOP
    r := platform_ai_agent.work_claim_v1(30, 'ai267-worker');
    EXIT WHEN NOT (r ->> 'claimed')::BOOLEAN;
    IF r ->> 'kind' = 'seed' THEN
      INSERT INTO ai267_work VALUES ((r ->> 'msgId')::BIGINT, (r ->> 'refId')::UUID);
    END IF;
  END LOOP;
END
$ai267_claims$;
SELECT pg_temp.ai_assert((SELECT count(*) = 2 FROM ai267_work WHERE ref_id IN (:'doc1', :'doc2')), 'the worker claims both seed pointers');
SELECT pg_temp.ai_assert((platform_ai_agent.document_claim_v1(:'doc1', 'ai267-worker', 120) ->> 'contentMd') LIKE 'Обучение в Малайзии%',
  'the worker leases the document and gets its copied text');
SELECT pg_temp.ai_assert((platform_ai_agent.document_claim_v1(:'doc1', 'other-worker', 120) ->> 'reason') = 'busy',
  'another worker cannot take a leased document');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.document_index_v1(%L, ''other-worker'', ''[{"position":0,"content":"x"}]'')',
  :'doc1')) LIKE '42501:ai_document_not_leased%', 'only the lease holder indexes');
SELECT pg_temp.ai_assert((platform_ai_agent.document_stage_v1(:'doc1', 'ai267-worker', 'embed', 60) ->> 'progress') = '60', 'stage and progress');
SELECT pg_temp.ai_assert((platform_ai_agent.document_index_v1(:'doc1', 'ai267-worker', jsonb_build_array(
  jsonb_build_object('position', 0, 'sectionPath', 'Малайзия › Стоимость', 'content', 'Обучение в Малайзии стоит 5000 долларов в год.',
    'context', 'Цены Малайзии', 'lang', 'ru', 'pageFrom', 1, 'pageTo', 1, 'tokens', 12, 'embedding', pg_temp.ai_unit(1)),
  jsonb_build_object('position', 1, 'sectionPath', 'Малайзия › Виза', 'content', 'Виза оформляется за 30 дней.',
    'lang', 'ru', 'pageFrom', 1, 'pageTo', 1, 'embedding', pg_temp.ai_unit(10))))
  ->> 'status') = 'ready', 'the client document is indexed and ready');
SELECT pg_temp.ai_assert((platform_ai_agent.document_claim_v1(:'doc2', 'ai267-worker', 120) ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_index_v1(:'doc2', 'ai267-worker', jsonb_build_array(
    jsonb_build_object('position', 0, 'sectionPath', 'Скидки', 'content', 'Скидка до 15 процентов только с согласования руководителя.',
      'lang', 'ru', 'embedding', pg_temp.ai_unit(1)))) ->> 'status') = 'ready', 'the internal document is indexed');
SELECT pg_temp.ai_assert((SELECT bool_and((platform_ai_agent.work_finish_v1(msg_id, 'done') ->> 'finished')::BOOLEAN) FROM ai267_work),
  'the queue messages are finished');
RESET ROLE;
SELECT c.id AS chunk_client FROM platform_private.ai_chunks c WHERE c.document_id = :'doc1' AND c.position = 0 \gset
SELECT c.id AS chunk_internal FROM platform_private.ai_chunks c WHERE c.document_id = :'doc2' \gset
SELECT pg_temp.ai_assert((SELECT knowledge_version = 3 FROM platform_private.ai_settings WHERE organization_id = pg_temp.ai_id(1)),
  'two indexings bumped the knowledge version twice');
INSERT INTO platform_private.ai_review_items(organization_id, document_id, page_no, kind, value, proposed, anchor)
  VALUES (pg_temp.ai_id(1), :'doc1', 1, 'number', '5000', '5000', 'стоит 5000 долларов');

-- ---------------------------------------------------------------------------
-- 10. Search.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 's1', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 's1';
SELECT redemption AS red_s1 FROM ai267_tickets WHERE label = 's1' \gset
SELECT platform_ai_agent.search_v1(:'red_s1', jsonb_build_array(pg_temp.ai_unit(1)),
  '["Сколько стоит обучение в Малайзии?"]') AS ai267_search \gset
SELECT pg_temp.ai_assert((:'ai267_search'::JSONB -> 'client' -> 0 ->> 'chunkId')::BIGINT = :'chunk_client'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'ai267_search'::JSONB -> 'client') e WHERE e ->> 'audience' <> 'client')
  AND (:'ai267_search'::JSONB -> 'internal' -> 0 ->> 'chunkId')::BIGINT = :'chunk_internal'
  AND jsonb_array_length(:'ai267_search'::JSONB -> 'internal') = 1
  AND (:'ai267_search'::JSONB -> 'review' -> 0 ->> 'value') = '5000',
  'hybrid search: client chunks first, internal branch separate, open review items on the same page');
SELECT pg_temp.ai_assert((platform_ai_agent.search_v1(:'red_s1', '[]', '["какая скидка"]') -> 'internal' -> 0 ->> 'chunkId')::BIGINT
  = :'chunk_internal' AND jsonb_array_length(platform_ai_agent.search_v1(:'red_s1', '[]', '["какая скидка"]') -> 'client') = 0,
  'FTS-only query: the internal rule is found, never in the client list');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.search_v1(%L, ''[[1,2]]'', ''[]'')', :'red_s1'))
  LIKE '22023:ai_search_invalid%', 'a malformed embedding is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 11. Answers: one generator per key, citations, supersede and 409.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.answer_claim_v1(:'red_s1', 'reply', 'flight-a') AS ai267_claim_a \gset
SELECT pg_temp.ai_assert((:'ai267_claim_a'::JSONB ->> 'status') = 'claimed' AND (:'ai267_claim_a'::JSONB ->> 'sourceMessageId') = :'m1',
  'the first claim owns the generation');
SELECT (:'ai267_claim_a'::JSONB ->> 'answerId') AS answer_a \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 's2', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 's2';
SELECT redemption AS red_s2 FROM ai267_tickets WHERE label = 's2' \gset
SELECT pg_temp.ai_assert((platform_ai_agent.answer_claim_v1(:'red_s2', 'reply', 'flight-b') ->> 'status') = 'busy',
  'a second generator for the same key is told busy');
SELECT pg_temp.ai_assert((platform_ai_agent.answer_heartbeat_v1(:'answer_a', 'flight-a') ->> 'status') = 'pending'
  AND pg_temp.ai_err(format('SELECT platform_ai_agent.answer_heartbeat_v1(%L, ''flight-b'')', :'answer_a')) LIKE '42501:%',
  'only the owner heartbeats');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format($q$SELECT platform_ai_agent.answer_finish_v1(%L, 'flight-a', 'ready',
  jsonb_build_object('reply', 'Скидка 15%%', 'citations', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', %s))),
  'gemini-3.8-flash', 0.001, '{}', NULL)$q$, :'answer_a', :'chunk_internal')) LIKE '22023:ai_citation_invalid%',
  'a citation marker on an internal chunk is refused');
RESET ROLE;
UPDATE platform_private.ai_documents SET status = 'superseded' WHERE id = :'doc1';
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format($q$SELECT platform_ai_agent.answer_finish_v1(%L, 'flight-a', 'ready',
    jsonb_build_object('reply', 'Обучение стоит 5000 [1]', 'citations', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', %s))),
    'gemini-3.8-flash', 0.001, '{}', NULL)$q$, :'answer_a', :'chunk_client')) LIKE '22023:ai_citation_invalid%'
  AND pg_temp.ai_err(format($q$SELECT platform_ai_agent.answer_finish_v1(%L, 'flight-a', 'ready',
    jsonb_build_object('reply', 'Обучение стоит 5000', 'sources', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', %s))),
    'gemini-3.8-flash', 0.001, '{}', NULL)$q$, :'answer_a', :'chunk_client')) LIKE '22023:ai_citation_invalid%',
  'a citation or source in a superseded document is refused');
RESET ROLE;
UPDATE platform_private.ai_documents SET status = 'ready' WHERE id = :'doc1';
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert((platform_ai_agent.answer_finish_v1(:'answer_a', 'flight-a', 'ready',
  jsonb_build_object('reply', 'Обучение стоит 5000 долларов в год [1].', 'reason', 'Из прайса', 'question', 'На какой уровень?',
    'citations', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', :'chunk_client'::BIGINT)),
    'sources', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', :'chunk_client'::BIGINT)),
    'guard', jsonb_build_object('internal_chunk_ids', jsonb_build_array(:'chunk_internal'::BIGINT))),
  'gemini-3.8-flash', 0.007, '{"firstTextMs":2100}', NULL) ->> 'status') = 'ready', 'the owner finishes a cited answer');
RESET ROLE;
SELECT COALESCE(sum(hits), 0) AS hits_before FROM platform_private.ai_rate_limits WHERE membership_id = pg_temp.ai_id(302) \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert((platform_ai_agent.answer_claim_v1(:'red_s2', 'reply', 'flight-b') ->> 'status') = 'ready',
  'a later claim for the same key is a cache hit');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT COALESCE(sum(hits), 0) FROM platform_private.ai_rate_limits WHERE membership_id = pg_temp.ai_id(302))
  = :'hits_before'::BIGINT, 'a cache hit takes no rate slot');
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1') #>> '{answer,current}')::BOOLEAN
  AND (platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1') #>> '{answer,result,reply}') LIKE 'Обучение стоит%',
  're-opening shows the saved, current answer');
SELECT pg_temp.ai_assert((platform.ai_agent_answer_insert_v1(pg_temp.ai_id(1), :'answer_a') ->> 'text') LIKE 'Обучение стоит%'
  AND (platform.ai_agent_answer_insert_v1(pg_temp.ai_id(1), :'answer_a', 'question') ->> 'text') = 'На какой уровень?',
  'insert returns the reply and the question');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_common';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_answer_insert_v1(%L, %L)', pg_temp.ai_id(1), :'answer_a'))
  LIKE '42501:%', 'a member who cannot read the conversation cannot insert its answer');
RESET ROLE;

-- The customer writes again: the saved answer is stale.
SELECT pg_temp.ai_run(3, pg_temp.ai_in('false_79967000001@c.us_AI267AAAAAAAAAAAAAA3', '79967000001@c.us',
  'А сколько стоит общежитие?', 1791270003)) AS r3 \gset
SELECT pg_temp.ai_latest(:'c1') AS m3 \gset
SELECT pg_temp.ai_assert(:'m3' <> :'m1', 'a new inbound message is the latest');
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(NOT (platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1') #>> '{answer,current}')::BOOLEAN,
  'after a new customer message the saved answer is not current');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_answer_insert_v1(%L, %L)', pg_temp.ai_id(1), :'answer_a'))
  LIKE 'PT409:stale_answer%', 'insert of a stale answer is refused 409');
INSERT INTO ai267_tickets(label, ticket) SELECT 's3', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m1') ->> 'ticket';
INSERT INTO ai267_tickets(label, ticket) SELECT 's4', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m3') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label IN ('s3', 's4');
SELECT redemption AS red_s3 FROM ai267_tickets WHERE label = 's3' \gset
SELECT redemption AS red_s4 FROM ai267_tickets WHERE label = 's4' \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.answer_claim_v1(%L, ''reply'', ''flight-c'')', :'red_s3'))
  LIKE 'PT409:superseded%', 'a request for the old message is superseded (409)');
SELECT platform_ai_agent.answer_claim_v1(:'red_s4', 'reply', 'flight-d') ->> 'answerId' AS answer_d \gset
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT status = 'superseded' FROM platform_private.ai_answers WHERE id = :'answer_a'),
  'the claim for the new message marked the old answer superseded');
SELECT pg_temp.ai_run(4, pg_temp.ai_in('false_79967000001@c.us_AI267AAAAAAAAAAAAAA4', '79967000001@c.us',
  'И ещё про визу', 1791270004)) AS r4 \gset
SELECT pg_temp.ai_latest(:'c1') AS m4 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert((platform_ai_agent.answer_heartbeat_v1(:'answer_d', 'flight-d') ->> 'status') = 'superseded',
  'a heartbeat after a new message reports superseded');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format($q$SELECT platform_ai_agent.answer_finish_v1(%L, 'flight-d', 'ready',
  '{"reply":"x"}', NULL, NULL, NULL, NULL)$q$, :'answer_d')) LIKE '42501:ai_answer_not_owned%',
  'a superseded generation cannot be finished');
RESET ROLE;
-- A generation that ends after a newer message is stored as superseded.
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 's5', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m4') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 's5';
SELECT redemption AS red_s5 FROM ai267_tickets WHERE label = 's5' \gset
SELECT platform_ai_agent.answer_claim_v1(:'red_s5', 'reply', 'flight-e') ->> 'answerId' AS answer_e \gset
RESET ROLE;
SELECT pg_temp.ai_run(5, pg_temp.ai_in('false_79967000001@c.us_AI267AAAAAAAAAAAAAA5', '79967000001@c.us',
  'Спасибо', 1791270005)) AS r5 \gset
SELECT pg_temp.ai_latest(:'c1') AS m5 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert((platform_ai_agent.answer_finish_v1(:'answer_e', 'flight-e', 'ready', '{"reply":"Виза за 30 дней."}',
  'gemini-3.8-flash', 0.001, NULL, NULL) ->> 'status') = 'superseded', 'a finish after a newer message is stored superseded');
RESET ROLE;
-- A current answer becomes stale when the rules (fingerprint) change.
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 's6', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m5') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 's6';
SELECT redemption AS red_s6 FROM ai267_tickets WHERE label = 's6' \gset
SELECT platform_ai_agent.answer_claim_v1(:'red_s6', 'reply', 'flight-f') ->> 'answerId' AS answer_f \gset
SELECT pg_temp.ai_assert((platform_ai_agent.answer_finish_v1(:'answer_f', 'flight-f', 'ready', '{"reply":"Пожалуйста!"}',
  'gemini-3.8-flash', 0.001, NULL, NULL) ->> 'status') = 'ready', 'a current answer for the latest message');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1') #>> '{answer,current}')::BOOLEAN,
  'it is current');
SELECT platform.ai_agent_rules_v1(pg_temp.ai_id(1)) #>> '{current,version}' AS rules_version \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_rules_save_v1(%L, ''Новые правила'', 99, %L)',
  pg_temp.ai_id(1), pg_temp.ai_id(3201))) LIKE 'PT409:ai_rules_version_conflict%', 'a stale rules version is refused 409');
SELECT pg_temp.ai_assert((platform.ai_agent_rules_save_v1(pg_temp.ai_id(1), 'Отвечайте тепло и по делу.', :'rules_version'::INTEGER,
  pg_temp.ai_id(3202)) ->> 'status') = 'applied', 'a member with ai.agent.manage saves a new rules version');
SELECT pg_temp.ai_assert(NOT (platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1') #>> '{answer,current}')::BOOLEAN
  AND pg_temp.ai_err(format('SELECT platform.ai_agent_answer_insert_v1(%L, %L)', pg_temp.ai_id(1), :'answer_f'))
    LIKE 'PT409:stale_answer%', 'new rules change the fingerprint: the answer is stale');
RESET ROLE;
-- A follow-up («Подготовить продолжение», staff wrote last) is anchored to the
-- last inbound AND the last outbound message: after a newer staff message
-- (e.g. the follow-up itself was sent) it is stale, refused 409 and not reused.
SELECT pg_temp.ai_run(6, pg_temp.ai_out('true_79967000001@c.us_AI267BBBBBBBBBBBBBB6', '79967000001@c.us',
  'Добрый день! Вы успели посмотреть программы?', 1791270006)) AS r6 \gset
SELECT pg_temp.ai_assert((:'r6'::JSONB ->> 'disposition') = 'succeeded' AND (:'r6'::JSONB ->> 'direction') = 'outbound'
  AND (:'r6'::JSONB ->> 'communication_conversation_id')::UUID = :'c1'::UUID, 'a staff message from the phone is outbound in c1');
SELECT (:'r6'::JSONB ->> 'communication_message_id') AS o6 \gset
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 'f1', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m5') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 'f1';
SELECT redemption AS red_f1 FROM ai267_tickets WHERE label = 'f1' \gset
SELECT platform_ai_agent.answer_claim_v1(:'red_f1', 'followup', 'flight-g') AS ai267_claim_g \gset
SELECT pg_temp.ai_assert((:'ai267_claim_g'::JSONB ->> 'status') = 'claimed' AND (:'ai267_claim_g'::JSONB ->> 'sourceMessageId') = :'m5'
  AND (:'ai267_claim_g'::JSONB ->> 'sourceOutboundMessageId') = :'o6',
  'a follow-up is anchored to the last inbound and the last outbound message');
SELECT (:'ai267_claim_g'::JSONB ->> 'answerId') AS answer_g \gset
SELECT pg_temp.ai_assert((platform_ai_agent.answer_finish_v1(:'answer_g', 'flight-g', 'ready', '{"reply":"Напомню о программах."}',
  'gemini-3.8-flash', 0.001, NULL, NULL) ->> 'status') = 'ready', 'the follow-up is ready');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1', 'followup') #>> '{answer,current}')::BOOLEAN,
  'the follow-up is current while staff wrote nothing newer');
RESET ROLE;
SELECT pg_temp.ai_run(7, pg_temp.ai_out('true_79967000001@c.us_AI267BBBBBBBBBBBBBB7', '79967000001@c.us',
  'Напомню о программах.', 1791270007)) AS r7 \gset
SELECT (:'r7'::JSONB ->> 'communication_message_id') AS o7 \gset
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(NOT (platform.ai_agent_answer_current_v1(pg_temp.ai_id(1), :'c1', 'followup') #>> '{answer,current}')::BOOLEAN
  AND pg_temp.ai_err(format('SELECT platform.ai_agent_answer_insert_v1(%L, %L)', pg_temp.ai_id(1), :'answer_g'))
    LIKE 'PT409:stale_answer%', 'after a newer staff message the follow-up is stale and its insert is refused 409');
INSERT INTO ai267_tickets(label, ticket) SELECT 'f2', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m5') ->> 'ticket';
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label = 'f2';
SELECT redemption AS red_f2 FROM ai267_tickets WHERE label = 'f2' \gset
SELECT platform_ai_agent.answer_claim_v1(:'red_f2', 'followup', 'flight-h') AS ai267_claim_h \gset
SELECT pg_temp.ai_assert((:'ai267_claim_h'::JSONB ->> 'status') = 'claimed'
  AND (:'ai267_claim_h'::JSONB ->> 'sourceOutboundMessageId') = :'o7'
  AND (:'ai267_claim_h'::JSONB ->> 'answerId') <> :'answer_g', 'a new follow-up is generated, not the stale one reused');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT status = 'superseded' FROM platform_private.ai_answers WHERE id = :'answer_g'),
  'the stale follow-up is marked superseded');

-- ---------------------------------------------------------------------------
-- 12. Rate limit: 20 answers per minute per member; the 21st is PT429.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai267_admin';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket)
  SELECT 'rate' || i, platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m5') ->> 'ticket'
  FROM generate_series(1, 21) i;
RESET ROLE;
DO $ai267_minute$
BEGIN
  IF extract(second FROM clock_timestamp()) > 50 THEN
    PERFORM pg_sleep(61 - extract(second FROM clock_timestamp()));
  END IF;
END
$ai267_minute$;
CREATE TEMP TABLE ai267_rate(i INTEGER, outcome TEXT);
GRANT SELECT, INSERT ON ai267_rate TO evo_ai_agent;
SET LOCAL ROLE evo_ai_agent;
UPDATE ai267_tickets SET redemption = (platform_ai_agent.redeem_ticket_v1(ticket, 'answer') ->> 'redemptionId')::UUID
  WHERE label LIKE 'rate%';
INSERT INTO ai267_rate SELECT substr(label, 5)::INTEGER,
  pg_temp.ai_err(format('SELECT platform_ai_agent.rate_take_v1(%L)', redemption))
  FROM ai267_tickets WHERE label LIKE 'rate%' ORDER BY substr(label, 5)::INTEGER;
SELECT pg_temp.ai_assert((SELECT count(*) FILTER (WHERE outcome = 'ok') = 20
    AND count(*) FILTER (WHERE outcome LIKE 'PT429:ai_rate_limited%') = 1 FROM ai267_rate),
  '20 answers per minute pass, the 21st is PT429');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.rate_take_v1(%L)',
  (SELECT t.redemption FROM ai267_tickets t JOIN ai267_rate r ON 'rate' || r.i = t.label WHERE r.outcome = 'ok' LIMIT 1))) = 'ok',
  'a second take for the same redemption counts nothing');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT sum(hits) = 20 FROM platform_private.ai_rate_limits WHERE membership_id = pg_temp.ai_id(301))
  AND (SELECT count(*) = 20 FROM platform_private.ai_tickets t JOIN ai267_tickets x ON x.redemption = t.id
    WHERE x.label LIKE 'rate%' AND t.rate_taken_at IS NOT NULL), 'exactly 20 slots and 20 marked redemptions');
-- Ticket issuance: at most 60 per member per minute (the CRM route cannot flood ai_tickets).
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT count(*) FILTER (WHERE x.o = 'ok') AS tickets_ok,
  count(*) FILTER (WHERE x.o LIKE 'PT429:ai_ticket_rate_limited%') AS tickets_limited
FROM (SELECT pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)', pg_temp.ai_id(1), :'c1', :'m5')) AS o
  FROM generate_series(1, 70)) x \gset
RESET ROLE;
SELECT pg_temp.ai_assert(:'tickets_ok'::INTEGER BETWEEN 1 AND 60 AND :'tickets_ok'::INTEGER + :'tickets_limited'::INTEGER = 70
  AND (SELECT count(*) <= 60 FROM platform_private.ai_tickets WHERE membership_id = pg_temp.ai_id(302)
    AND issued_at > clock_timestamp() - INTERVAL '60 seconds'),
  'at most 60 tickets per member per minute; the rest PT429 ai_ticket_rate_limited');

-- ---------------------------------------------------------------------------
-- 13. Spend and budget.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT gen_random_uuid() AS call_a \gset
SELECT platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), :'call_a', 'answer', 'gemini-3.8-flash', 10000, 4000, 500, 100,
  FALSE, TRUE, :'red_s1') AS ai267_usage_a \gset
SELECT pg_temp.ai_assert((platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), :'call_a', 'answer', 'gemini-3.8-flash', 10000,
  4000, 500, 100, FALSE, TRUE, :'red_s1') ->> 'status') = 'replayed', 'the same call id is not counted twice');
SELECT platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), gen_random_uuid(), 'embed_query', 'gemini-embedding-2', 20, 0, 0, 0,
  TRUE, FALSE, :'red_s1') AS ai267_usage_b \gset
SELECT platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), gen_random_uuid(), 'enrich', 'gemini-9-unknown', 100, 0, 10, 0,
  FALSE, FALSE) AS ai267_usage_c \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.usage_record_v1(%L, %L, ''chat'', ''gemini-3.8-flash'', 1, 0, 0, 0, FALSE)',
  pg_temp.ai_id(1), gen_random_uuid())) LIKE '22023:%' AND pg_temp.ai_err(format(
  'SELECT platform_ai_agent.usage_record_v1(%L, %L, ''answer'', ''gemini-3.8-flash'', 1, 2, 0, 0, FALSE)',
  pg_temp.ai_id(1), gen_random_uuid())) LIKE '22023:%', 'unknown purpose or cached > input is refused');
RESET ROLE;
SELECT platform_private.ai_local_day(clock_timestamp()) AS today \gset
SELECT pg_temp.ai_assert((:'ai267_usage_a'::JSONB ->> 'costUsd')::NUMERIC = round((6000 * platform_private.ai_price('gemini-3.8-flash', 'input', :'today')
    + 4000 * platform_private.ai_price('gemini-3.8-flash', 'cached', :'today')
    + 600 * platform_private.ai_price('gemini-3.8-flash', 'output', :'today')) / 1000000.0, 6)
  AND (:'ai267_usage_b'::JSONB ->> 'costUsd')::NUMERIC = round(20 * 0.20 / 1000000.0, 6)
  AND (:'ai267_usage_b'::JSONB ->> 'estimated')::BOOLEAN
  AND (:'ai267_usage_c'::JSONB ->> 'costUsd')::NUMERIC = 0 AND (:'ai267_usage_c'::JSONB ->> 'unpriced')::BOOLEAN,
  'costs: (input − cached)·in + cached·cache + (output + thinking)·out at the day''s price; embedding estimate; unpriced model');
SELECT pg_temp.ai_assert((SELECT calls = 1 AND answers = 1 AND input_tokens = 10000 AND thinking_tokens = 100
    FROM platform_private.ai_usage_member_daily WHERE membership_id = pg_temp.ai_id(302) AND purpose = 'answer')
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_usage_member_daily WHERE purpose = 'enrich'
    AND organization_id = pg_temp.ai_id(1)),
  'interactive calls are attributed to the member, background ones are not');
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_spend_v1(pg_temp.ai_id(1)) AS ai267_spend \gset
RESET ROLE;
SELECT pg_temp.ai_assert((:'ai267_spend'::JSONB ->> 'monthUsd')::NUMERIC = (SELECT sum(cost_usd) FROM platform_private.ai_usage_daily
    WHERE organization_id = pg_temp.ai_id(1) AND day >= date_trunc('month', :'today'::DATE))
  AND (:'ai267_spend'::JSONB ->> 'todayUsd')::NUMERIC = (SELECT sum(cost_usd) FROM platform_private.ai_usage_daily
    WHERE organization_id = pg_temp.ai_id(1) AND day = :'today')
  AND (SELECT sum((e ->> 'usd')::NUMERIC) FROM jsonb_array_elements(:'ai267_spend'::JSONB -> 'byPurpose') e)
    = (:'ai267_spend'::JSONB ->> 'monthUsd')::NUMERIC
  AND (SELECT sum((e ->> 'usd')::NUMERIC) FROM jsonb_array_elements(:'ai267_spend'::JSONB -> 'byGroup') e)
    = (:'ai267_spend'::JSONB ->> 'monthUsd')::NUMERIC
  AND (:'ai267_spend'::JSONB ->> 'answers')::INTEGER = 1
  AND (:'ai267_spend'::JSONB ->> 'averageAnswerUsd')::NUMERIC
    = (:'ai267_usage_a'::JSONB ->> 'costUsd')::NUMERIC + (:'ai267_usage_b'::JSONB ->> 'costUsd')::NUMERIC
  AND (:'ai267_spend'::JSONB ->> 'monthEstimated')::BOOLEAN
  AND (:'today'::DATE >= DATE '2027-01-01' OR :'ai267_spend'::JSONB -> 'priceChanges'
    @> '[{"model":"gemini-3.8-flash","kind":"input","effectiveFrom":"2027-01-01","usdPerMillion":1.50,"previousUsdPerMillion":0.75}]'),
  '«Расходы» equal SUM over the journal; by purpose and group add up; average answer price; the 2027 price change');
-- Budget: a cap just above this month's spend.
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT (platform.ai_agent_settings_v1(pg_temp.ai_id(1)) ->> 'version')::BIGINT AS settings_version \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"monthlyCapUsd":1}'', %L)',
  pg_temp.ai_id(1), :'settings_version'::BIGINT - 1, pg_temp.ai_id(3301))) LIKE 'PT409:ai_settings_version_conflict%',
  'a stale settings version is refused 409');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"answerModel":"gemini-flash-latest"}'', %L)',
  pg_temp.ai_id(1), :'settings_version', pg_temp.ai_id(3302))) LIKE '22023:%', 'a model alias is refused');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"embeddingModel":"gemini-embedding-001"}'', %L)',
  pg_temp.ai_id(1), :'settings_version', pg_temp.ai_id(3303))) LIKE '22023:ai_embedding_model_locked%',
  'the embedding model is locked while vectors exist');
SELECT pg_temp.ai_assert((platform.ai_agent_settings_save_v1(pg_temp.ai_id(1), :'settings_version',
  jsonb_build_object('monthlyCapUsd', ceil(((:'ai267_spend'::JSONB ->> 'monthUsd')::NUMERIC + 0.01) * 100) / 100), pg_temp.ai_id(3304))
  ->> 'status') = 'applied', 'the monthly cap is lowered');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_wa';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, 1, ''{"monthlyCapUsd":1}'', %L)',
  pg_temp.ai_id(1), pg_temp.ai_id(3305))) LIKE '42501:%' AND pg_temp.ai_err(format('SELECT platform.ai_agent_spend_v1(%L)',
  pg_temp.ai_id(1))) LIKE '42501:%', 'a member without ai.agent.* reads and changes nothing');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.budget_reserve_v1(pg_temp.ai_id(1), 'answer', 0.004) ->> 'reservationId' AS reservation \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.budget_reserve_v1(%L, ''answer'', 0.02)', pg_temp.ai_id(1)))
  LIKE 'PT402:ai_budget_exhausted%', 'beyond the monthly cap the reservation is refused PT402');
SELECT pg_temp.ai_assert((platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), gen_random_uuid(), 'answer', 'gemini-3.8-flash', 100, 0, 10, 0,
  FALSE, TRUE, NULL, :'reservation') ->> 'status') = 'recorded', 'a recorded call settles its reservation');
RESET ROLE;
SELECT pg_temp.ai_assert((SELECT settled_at IS NOT NULL FROM platform_private.ai_budget_reservations WHERE id = :'reservation'),
  'the reservation is settled');
-- The cap cannot be bypassed with an unpriced model (review of 8bbc66759).
-- (a) Settings refuse a newly chosen model without a price valid today: a
-- generating model needs input and output prices, the embedding model the
-- embedding price (also a renamed id such as gemini-embedding-2-preview);
-- a priced model is accepted.
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT (platform.ai_agent_settings_v1(pg_temp.ai_id(1)) ->> 'version')::BIGINT AS settings_version2 \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"answerModel":"gemini-2.5-pro","monthlyCapUsd":1}'', %L)',
    pg_temp.ai_id(1), :'settings_version2', pg_temp.ai_id(3306))) LIKE '22023:ai_settings_unpriced_model%'
  AND pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"answerModel":"gemini-embedding-2"}'', %L)',
    pg_temp.ai_id(1), :'settings_version2', pg_temp.ai_id(3307))) LIKE '22023:ai_settings_unpriced_model%'
  AND pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"embeddingModel":"gemini-embedding-2-preview"}'', %L)',
    pg_temp.ai_id(1), :'settings_version2', pg_temp.ai_id(3308))) LIKE '22023:ai_embedding_model_locked%',
  'a model without today''s price (or without an output price) cannot be chosen');
SELECT pg_temp.ai_assert((platform.ai_agent_settings_save_v1(pg_temp.ai_id(1), :'settings_version2',
    '{"arbiterFallbackModel":"gemini-3.1-pro-preview"}', pg_temp.ai_id(3309)) ->> 'status') = 'applied'
  AND (platform.ai_agent_settings_v1(pg_temp.ai_id(1)) -> 'unpricedModels') = '[]'::JSONB,
  'a priced model is accepted; no configured model is unpriced');
RESET ROLE;
-- Without vectors (organization 2) a renamed embedding id is refused for its missing price.
SET LOCAL request.jwt.claims TO :'ai267_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_settings_save_v1(%L, %s, ''{"embeddingModel":"gemini-embedding-2-preview"}'', %L)',
    pg_temp.ai_id(2), (platform.ai_agent_settings_v1(pg_temp.ai_id(2)) ->> 'version')::BIGINT, pg_temp.ai_id(3310)))
    LIKE '22023:ai_settings_unpriced_model%',
  'a renamed embedding id without a price is refused (deviation 8)');
RESET ROLE;
-- (b) A call of an unpriced model is booked at its reservation, not at 0.
SELECT COALESCE(sum(cost_usd), 0) AS month_before FROM platform_private.ai_usage_daily
  WHERE organization_id = pg_temp.ai_id(1) AND day >= date_trunc('month', :'today'::DATE) \gset
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.budget_reserve_v1(pg_temp.ai_id(1), 'enrich', 0.003) ->> 'reservationId' AS reservation_u \gset
SELECT platform_ai_agent.usage_record_v1(pg_temp.ai_id(1), gen_random_uuid(), 'enrich', 'gemini-9-unknown', 5000000, 0,
  2000000, 0, FALSE, FALSE, NULL, :'reservation_u') AS ai267_usage_u \gset
RESET ROLE;
SELECT pg_temp.ai_assert((:'ai267_usage_u'::JSONB ->> 'costUsd')::NUMERIC = 0.003 AND (:'ai267_usage_u'::JSONB ->> 'unpriced')::BOOLEAN
  AND (:'ai267_usage_u'::JSONB ->> 'estimated')::BOOLEAN
  AND (SELECT settled_at IS NOT NULL FROM platform_private.ai_budget_reservations WHERE id = :'reservation_u')
  AND (SELECT sum(cost_usd) FROM platform_private.ai_usage_daily WHERE organization_id = pg_temp.ai_id(1)
    AND day >= date_trunc('month', :'today'::DATE)) = :'month_before'::NUMERIC + 0.003,
  'an unpriced call is booked at its reservation estimate and the month grows');
-- (c) While a configured model has no price today (a price period ended, a
-- legacy value), no budget is reserved, and «Настройки» name the model.
UPDATE platform_private.ai_settings SET answer_model = 'gemini-2.5-pro' WHERE organization_id = pg_temp.ai_id(1);
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.budget_reserve_v1(%L, ''answer'', 0.0001)', pg_temp.ai_id(1)))
  LIKE 'PT402:ai_model_unpriced%', 'no reservation while a configured model is unpriced (PT402)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.ai_assert((platform.ai_agent_settings_v1(pg_temp.ai_id(1)) -> 'unpricedModels') = '["gemini-2.5-pro"]'::JSONB,
  'the settings name the unpriced model');
RESET ROLE;
UPDATE platform_private.ai_settings SET answer_model = 'gemini-3.8-flash' WHERE organization_id = pg_temp.ai_id(1);

-- ---------------------------------------------------------------------------
-- 14. Rules, documents, settings reads.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai267_sales';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_rules_v1(pg_temp.ai_id(1)) AS ai267_rules \gset
SELECT pg_temp.ai_assert((:'ai267_rules'::JSONB #>> '{current,body}') = 'Отвечайте тепло и по делу.'
  AND (:'ai267_rules'::JSONB #>> '{current,needsReview}')::BOOLEAN AND jsonb_array_length(:'ai267_rules'::JSONB -> 'versions') = 2,
  'rules: the current text and two versions');
SELECT pg_temp.ai_assert((platform.ai_agent_rules_confirm_v1(pg_temp.ai_id(1), (:'ai267_rules'::JSONB #>> '{current,id}')::UUID,
  pg_temp.ai_id(3401)) ->> 'status') = 'confirmed' AND pg_temp.ai_err(format('SELECT platform.ai_agent_rules_confirm_v1(%L, %L, %L)',
  pg_temp.ai_id(1), :'ai267_rules'::JSONB #>> '{current,id}', pg_temp.ai_id(3402))) LIKE 'PT409:%',
  '«Проверено» once');
SELECT platform.ai_agent_documents_v1(pg_temp.ai_id(1)) AS ai267_docs \gset
SELECT pg_temp.ai_assert(jsonb_array_length(:'ai267_docs'::JSONB -> 'items') = 2 AND :'ai267_docs' NOT LIKE '%contentMd%'
  AND (SELECT (e ->> 'chunkCount')::INTEGER = 2 AND (e ->> 'openReviewCount')::INTEGER = 1
    FROM jsonb_array_elements(:'ai267_docs'::JSONB -> 'items') e WHERE e ->> 'id' = :'doc1'),
  'the document list: two documents with counts, without text');
SELECT (SELECT (e ->> 'rowVersion')::BIGINT FROM jsonb_array_elements(:'ai267_docs'::JSONB -> 'items') e WHERE e ->> 'id' = :'doc2') AS doc2_version \gset
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_document_update_v1(%L, %L, %s, ''{"audience":"client"}'', %L)',
  pg_temp.ai_id(1), :'doc2', :'doc2_version', pg_temp.ai_id(3501))) LIKE '22023:ai_document_client_confirmation_required%',
  'making a document client-facing needs confirmation');
SELECT pg_temp.ai_assert((platform.ai_agent_document_update_v1(pg_temp.ai_id(1), :'doc2', :'doc2_version',
  '{"audience":"client","confirmClient":true}', pg_temp.ai_id(3502)) #>> '{document,audience}') = 'client',
  'with confirmation the audience changes');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_document_retry_v1(%L, %L, %s, %L)',
  pg_temp.ai_id(1), :'doc2', :'doc2_version'::BIGINT + 1, pg_temp.ai_id(3503))) LIKE '22023:ai_document_not_failed%',
  'only a failed document is retried');
SELECT pg_temp.ai_assert((platform.ai_agent_document_delete_v1(pg_temp.ai_id(1), :'doc2', :'doc2_version'::BIGINT + 1,
  pg_temp.ai_id(3504)) ->> 'status') = 'deleted', 'a document is deleted');
RESET ROLE;
SELECT pg_temp.ai_assert(NOT EXISTS (SELECT 1 FROM platform_private.ai_chunks WHERE document_id = :'doc2')
  AND (SELECT count(*) = 3 FROM platform.audit_events WHERE request_id IN (pg_temp.ai_id(3502), pg_temp.ai_id(3504), pg_temp.ai_id(3202))),
  'its chunks are gone; document and rules changes are audited');
SELECT pg_temp.ai_assert(pg_temp.ai_err('UPDATE platform_private.ai_rules_versions SET body = ''x''') LIKE '55000:%'
  AND pg_temp.ai_err('DELETE FROM platform_private.ai_rules_versions') LIKE '55000:%',
  'rules versions are append-only even for the table owner');

-- ---------------------------------------------------------------------------
-- 15. Access lost after redemption; consent revoked.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.conversation_context_v1(%L)', :'red_s6')) = 'ok',
  'before: the redemption reads the context');
RESET ROLE;
UPDATE platform.staff_role_assignments SET revoked_at = clock_timestamp()
  WHERE membership_id = pg_temp.ai_id(302) AND role_id = pg_temp.ai_id(1103) AND revoked_at IS NULL;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.conversation_context_v1(%L)', :'red_s6'))
  LIKE '42501:ai_redemption_invalid%', 'after the member loses the conversation the redemption reads nothing');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai267_admin';
SET LOCAL ROLE authenticated;
INSERT INTO ai267_tickets(label, ticket) SELECT 'late', platform.ai_agent_ticket_v1(pg_temp.ai_id(1), 'answer', :'c1', :'m5') ->> 'ticket';
SELECT pg_temp.ai_assert((platform.ai_agent_consent_record_v1(pg_temp.ai_id(1), 'revoke', NULL, pg_temp.ai_id(3601)) ->> 'status') = 'revoked',
  'the Admin revokes the consent');
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform.ai_agent_ticket_v1(%L, ''answer'', %L, %L)',
  pg_temp.ai_id(1), :'c1', :'m5')) LIKE 'PT412:%', 'no ticket after the revoke');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.ai_assert(pg_temp.ai_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')',
    (SELECT ticket FROM ai267_tickets WHERE label = 'late'))) LIKE 'PT412:%'
  AND pg_temp.ai_err(format('SELECT platform_ai_agent.budget_reserve_v1(%L, ''answer'', 0.0001)', pg_temp.ai_id(1))) LIKE 'PT412:%',
  'after the revoke a ticket issued before does not redeem and no budget is reserved');
RESET ROLE;

SELECT 'AI267_AI_AGENT_P1_SUITE_PASSED' AS ai267_suite_result;

ROLLBACK;
