\set ON_ERROR_STOP on
-- Boundary suite for migrations 271–273 («ИИ-агент» P2,
-- docs/EVO_AI_AGENT_PLAN_2026-10-06.md §4.5, §5, §7, §8, §13, §15 P2). Runs on
-- the real chain right after 273 inside one transaction that is rolled back,
-- with its own synthetic organizations and synthetic documents; no provider,
-- Gemini call, real person, real file or production action. Members are
-- modelled like production (invited staff have coarse role NULL; rights come
-- from scoped role assignments; the «общие разделы» role receives
-- ai.agent.use/manage from the 268 grant).
--
-- Proves:
--  1. catalog: the private bucket (25 MiB, 8 MIME types) and its RESTRICTIVE
--     policy (an authenticated session cannot write or read it even under a
--     permissive allow-all policy); 27 staff functions (26 authenticated-only,
--     storage_authorize service_role-only) and 30 agent functions, all hardened
--     definers; the agent role executes only those 30 and holds no table
--     privilege; the new tables are FORCE RLS without policies or grants;
--  2. upload: refused for a Student, another organization, a member without
--     rights, a member with ai.agent.use only, anon; without the company-material
--     mark, without the client confirmation, on a kind/MIME mismatch, with a
--     scan proof for other bytes or a stale one; duplicate PT409 with the
--     title in DETAIL; replay and request conflict; a replacement keeps the
--     audience, refuses a non-live target, a pending successor and a stale
--     version;
--  3. worker: content/pages/review items only under the lease, with path and
--     size limits; storage broker authorization (own object only, no '..', no
--     other document, no lease, wrong operation, reindex lease read-only);
--     index keeps review while items are open; swap-when-ready including a
--     failed new version; the personal-document stop and its override;
--     deletion mid-processing;
--  4. «Лист сверки»: rights, live documents only, expected status, confirm /
--     correct / dismiss / reopen, applying is unverified in search and live
--     sources, reindex on the base SHA with reused chunk IDs and vectors,
--     partial re-embedding, anchor_ambiguous back to open, stale SHA and
--     changed items PT409;
--  5. Laboratory: ticket purpose isolation both ways, rights (use / manage /
--     own proposal), the 20/min limit counts Lab, session revisions, ≤5
--     documents, `before` exactly once, apply of a document edit, a new
--     knowledge fragment, a rules change and an example, conflict PT409 and the
--     conflict status, «Не менять», example validity by rules, model and
--     document versions (an unrelated upload no longer stales examples),
--     example list and delete, maintenance.
BEGIN;

DO $p2_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$p2_auth_role$;

CREATE FUNCTION pg_temp.p2_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p2_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P2: %', message; END IF;
END
$$;
-- 'ok' or SQLSTATE:message[:detail] of a failing statement.
CREATE FUNCTION pg_temp.p2_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_detail TEXT;
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
  RETURN SQLSTATE || ':' || SQLERRM || CASE WHEN COALESCE(v_detail, '') <> '' THEN ':' || v_detail ELSE '' END;
END
$$;
-- The JSONB result of a call, or {"error": "SQLSTATE:message"}.
CREATE FUNCTION pg_temp.p2_call(sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  EXECUTE sql INTO result; RETURN COALESCE(result, 'null'::JSONB);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('error', SQLSTATE || ':' || SQLERRM);
END
$$;
CREATE FUNCTION pg_temp.p2_unit(k INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_agg(CASE WHEN i = k THEN 1 WHEN i = k + 1 THEN 0.2 ELSE 0 END ORDER BY i) FROM generate_series(1, 1536) i
$$;
CREATE FUNCTION pg_temp.p2_chunk(p_position INTEGER, p_content TEXT, p_k INTEGER, p_page INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('position', p_position, 'content', p_content, 'sectionPath', 'Прайс 2027',
    'context', 'Синтетический прайс', 'lang', 'ru', 'pageFrom', p_page, 'pageTo', p_page,
    'embedding', pg_temp.p2_unit(p_k)))
$$;
CREATE FUNCTION pg_temp.p2_sha(p_text TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;
-- A ClamAV proof as clamd-malware-scanner.ts writes it, for these bytes, now.
CREATE FUNCTION pg_temp.p2_proof(p_sha TEXT) RETURNS JSONB LANGUAGE SQL VOLATILE AS $$
  SELECT jsonb_build_object('engine', 'ClamAV', 'engineVersion', '1.4.3', 'signatureVersion', '27800',
    'protocol', 'clamd-zinstream-v1', 'sha256Hex', p_sha,
    'scannedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION pg_temp.p2_upload(p_org INTEGER, p_doc INTEGER, p_title TEXT, p_kind TEXT, p_mime TEXT,
  p_audience TEXT, p_client_confirmed BOOLEAN, p_company BOOLEAN, p_request INTEGER,
  p_replaces INTEGER DEFAULT NULL, p_replaces_version BIGINT DEFAULT NULL, p_sha TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT format('SELECT platform.ai_agent_document_upload_v1(%L, %L, %L, %L, %L, 1024, %L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.p2_id(p_org), pg_temp.p2_id(p_doc), p_title, p_kind, p_mime,
    COALESCE(p_sha, pg_temp.p2_sha('P2 synthetic bytes ' || p_doc)), p_audience, p_client_confirmed, p_company,
    CASE WHEN p_replaces IS NOT NULL THEN pg_temp.p2_id(p_replaces) END, p_replaces_version,
    pg_temp.p2_proof(COALESCE(p_sha, pg_temp.p2_sha('P2 synthetic bytes ' || p_doc))), pg_temp.p2_id(p_request))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p2_id(INTEGER), pg_temp.p2_assert(BOOLEAN, TEXT), pg_temp.p2_err(TEXT),
  pg_temp.p2_call(TEXT), pg_temp.p2_unit(INTEGER), pg_temp.p2_chunk(INTEGER, TEXT, INTEGER, INTEGER),
  pg_temp.p2_sha(TEXT), pg_temp.p2_proof(TEXT),
  pg_temp.p2_upload(INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, INTEGER, INTEGER, BIGINT, TEXT)
  TO authenticated, anon, service_role, evo_ai_agent;
-- The suite acts as the agent role (as Supavisor would log it in).
GRANT evo_ai_agent TO postgres WITH INHERIT FALSE, SET TRUE;

SELECT 'AI271_AI_AGENT_P2_SUITE_START' AS ai271_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.p2_assert((SELECT NOT b.public AND b.file_size_limit = 26214400
    AND b.allowed_mime_types::TEXT[] @> ARRAY['application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain', 'text/markdown',
      'image/png', 'image/jpeg'] AND cardinality(b.allowed_mime_types) = 8
  FROM storage.buckets b WHERE b.id = 'platform-ai-agent-knowledge'),
  'the knowledge bucket is private, 25 MiB, PDF/DOCX/XLSX/CSV/TXT/MD/PNG/JPEG only');
SELECT pg_temp.p2_assert((SELECT count(*) = 1 FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
    AND p.policyname = 'ai_agent_knowledge_server_only' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL'
    AND p.roles @> ARRAY['anon', 'authenticated']::NAME[]),
  'a RESTRICTIVE policy closes the bucket to anon and authenticated');
-- Even under a permissive allow-all policy the browser roles cannot reach it.
INSERT INTO storage.buckets(id, name, public) VALUES ('p2-probe-bucket', 'p2-probe-bucket', FALSE);
INSERT INTO storage.objects(bucket_id, name) VALUES ('platform-ai-agent-knowledge', 'p2-probe/original');
CREATE POLICY p2_probe_allow_all ON storage.objects FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err('INSERT INTO storage.objects(bucket_id, name) VALUES (''p2-probe-bucket'', ''x'')') = 'ok'
  AND pg_temp.p2_err('INSERT INTO storage.objects(bucket_id, name) VALUES (''platform-ai-agent-knowledge'', ''y'')') LIKE '42501:%'
  AND (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'platform-ai-agent-knowledge')
  AND pg_temp.p2_err('UPDATE storage.objects SET name = ''z'' WHERE bucket_id = ''platform-ai-agent-knowledge''') = 'ok'
  AND pg_temp.p2_err('DELETE FROM storage.objects WHERE bucket_id = ''platform-ai-agent-knowledge''') = 'ok',
  'authenticated writes another bucket under the probe policy but cannot write, read, rename or delete the agent bucket');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'platform-ai-agent-knowledge'
  AND name = 'p2-probe/original'), 'the server-side object survived the browser-role attempts');
DROP POLICY p2_probe_allow_all ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id IN ('platform-ai-agent-knowledge', 'p2-probe-bucket');
DELETE FROM storage.buckets WHERE id = 'p2-probe-bucket';

SELECT pg_temp.p2_assert((SELECT array_agg(p.proname ORDER BY p.proname) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND has_schema_privilege('evo_ai_agent', n.oid, 'USAGE')
      AND has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
  = ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1', 'budget_release_v1', 'budget_reserve_v1',
    'conversation_context_v1', 'document_claim_v1', 'document_content_put_v1', 'document_index_v1',
    'document_pages_put_v1', 'document_reindex_claim_v1', 'document_reindex_v1', 'document_stage_v1',
    'lab_apply_prepare_v1', 'lab_apply_v1', 'lab_documents_v1', 'lab_proposal_put_v1', 'lab_session_get_v1',
    'lab_session_put_v1', 'maintenance_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1', 'review_items_put_v1',
    'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1', 'work_finish_v1']::NAME[],
  'the only definer functions evo_ai_agent can execute are the 30 platform_ai_agent functions');
SELECT pg_temp.p2_assert(NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
    AND ((c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (has_table_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege('evo_ai_agent', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')))
    OR (c.relkind = 'S' AND has_sequence_privilege('evo_ai_agent', c.oid, 'USAGE, SELECT, UPDATE')))),
  'evo_ai_agent holds no privilege on any table, view or sequence (storage.objects included)');
SELECT pg_temp.p2_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_ai_agent' AND (has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  'no API role executes an agent function');
SELECT pg_temp.p2_assert((SELECT count(*) = 26 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT bool_or(has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))
    AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%' AND p.proname <> 'ai_agent_storage_authorize_v1'),
  'the 26 staff functions are hardened definers executable by authenticated only');
SELECT pg_temp.p2_assert((SELECT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE') AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=""']
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname = 'ai_agent_storage_authorize_v1'),
  'the storage broker authorization is a hardened definer for service_role only');
SELECT pg_temp.p2_assert(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_text_sha256', 'ai_document_mime_allowed', 'ai_occurs_once',
      'ai_document_review_status', 'ai_chunks_check', 'ai_chunks_replace', 'ai_document_json', 'ai_review_item_json',
      'ai_document_leased', 'ai_answer_live_sources', 'ai_member_can', 'ai_ticket_allowed', 'ai_redemption',
      'ai_replace_once', 'ai_example_stale', 'ai_example_valid', 'ai_lab_target_current', 'ai_lab_proposal_json',
      'ai_live_documents_map', 'ai_lab_proposals_guard')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE'))),
  'the new private helpers are executable by no API role and not by the agent');
SELECT pg_temp.p2_assert((SELECT count(*) = 18 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    AND NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
    AND NOT bool_or(EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'platform_private' AND p.tablename = c.relname))
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'platform_private' AND c.relkind = 'r' AND c.relname LIKE 'ai\_%'
    AND c.relname IN ('ai_rules_versions', 'ai_settings', 'ai_documents', 'ai_document_pages', 'ai_chunks',
      'ai_review_items', 'ai_golden_examples', 'ai_answers', 'ai_tickets', 'ai_prices', 'ai_usage_daily',
      'ai_usage_member_daily', 'ai_usage_calls', 'ai_budget_reservations', 'ai_rate_limits', 'ai_requests',
      'ai_lab_sessions', 'ai_lab_proposals')),
  'the 18 ai_* tables (16 of P1, ai_lab_sessions, ai_lab_proposals): FORCE RLS, no policy, no API-role grant');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_err('SELECT count(*) FROM platform_private.ai_lab_proposals') LIKE '42501:%'
  AND pg_temp.p2_err('SELECT count(*) FROM platform_private.ai_lab_sessions') LIKE '42501:%'
  AND pg_temp.p2_err('SELECT count(*) FROM storage.objects') LIKE '42501:%'
  AND pg_temp.p2_err('SELECT platform.ai_agent_storage_authorize_v1(NULL, NULL, NULL, NULL, NULL)') LIKE '42501:%',
  'the agent role reads no Lab table and no storage object directly and cannot call the broker authorization');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Fixture. Organization 1: 1 Admin (system); invited staff (coarse NULL):
--    2 «Продажи — общие разделы» (ai.agent.use + manage after the 268 grant),
--    3 a role with ai.agent.use only, 4 WhatsApp only (no AI right);
--    5 Student. Organization 2: 6 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p2_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO p2_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, NULL),
  (5, 1, 'student'), (6, 2, 'admin');
GRANT SELECT ON p2_actors TO authenticated, anon, evo_ai_agent;
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.p2_id(1), 'P2 Fictional organization'),
  (pg_temp.p2_id(2), 'P2 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p2_id(100 + n), 'p2-' || n || '@example.invalid', '{}'::JSONB FROM p2_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p2_id(200 + n), pg_temp.p2_id(100 + n), 'P2 Actor ' || n, 'active', 1 FROM p2_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.p2_id(300 + a.n), pg_temp.p2_id(a.org), pg_temp.p2_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM p2_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.p2_id(301), pg_temp.p2_id(306));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.p2_id(401), pg_temp.p2_id(1), 'organization', pg_temp.p2_id(1), 1),
  (pg_temp.p2_id(402), pg_temp.p2_id(2), 'organization', pg_temp.p2_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.p2_id(1), pg_temp.p2_id(301), pg_temp.p2_id(401), 1, 1, TRUE, 'system', 'P2 synthetic scope', pg_temp.p2_id(601)),
  (pg_temp.p2_id(2), pg_temp.p2_id(306), pg_temp.p2_id(402), 1, 1, TRUE, 'system', 'P2 synthetic scope', pg_temp.p2_id(602));

CREATE TEMP TABLE p2_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER, phase INTEGER);
INSERT INTO p2_roles VALUES
 (pg_temp.p2_id(1101), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1110, 1),
 (pg_temp.p2_id(1103), 'WhatsApp', '["communication.manual.send","communication.read.full"]', 1130, 1),
 (pg_temp.p2_id(1105), 'AI viewer', '["ai.agent.use","organization.read"]', 1150, 2);
CREATE TEMP TABLE p2_grants(membership INTEGER, role_id UUID, scope JSONB, phase INTEGER);
INSERT INTO p2_grants VALUES
 (302, pg_temp.p2_id(1101), jsonb_build_object('kind', 'organization', 'key', pg_temp.p2_id(1), 'resourceKind', NULL), 1),
 (304, pg_temp.p2_id(1103), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL), 1),
 (303, pg_temp.p2_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.p2_id(1), 'resourceKind', NULL), 2);
GRANT SELECT ON p2_roles, p2_grants TO authenticated;
CREATE FUNCTION pg_temp.p2_claims(p_n INTEGER) RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p2_id(100 + p_n),
    'claims', jsonb_build_object('sub', pg_temp.p2_id(100 + p_n), 'role', 'authenticated'))) -> 'claims')::TEXT
$$;
-- Publishes the roles of one phase and saves their assignments as the Admin.
CREATE FUNCTION pg_temp.p2_roles_phase(p_phase INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM p2_roles WHERE phase = p_phase ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p2_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P2 ' || r.label, 'description', 'Migration 271 synthetic role',
        'permissionKeys', r.keys), 'P2 create role', pg_temp.p2_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p2_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p2_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P2 publish role', pg_temp.p2_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p2_grants WHERE phase = p_phase ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM p2_grants g WHERE g.membership = m AND g.phase = p_phase;
    PERFORM platform.staff_role_assignments_save(pg_temp.p2_id(1), pg_temp.p2_id(m),
      (SELECT p.access_version FROM platform.organization_memberships om JOIN platform.profiles p ON p.id = om.profile_id
        WHERE om.id = pg_temp.p2_id(m)), items, bindings, 'P2 grant roles', pg_temp.p2_id(2000 + m));
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p2_roles_phase(INTEGER) TO authenticated;

SELECT pg_temp.p2_claims(1) AS p2_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p2_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_roles_phase(1);
RESET ROLE;
-- The 268 grant publishes ai.agent.use/manage into the «общие разделы» role.
SELECT pg_temp.p2_assert((SELECT count(*) >= 1 FROM jsonb_array_elements(
    platform_private.ai_agent_grant_common_roles('P2 grant') -> 'roles') e
  WHERE e ->> 'roleId' = pg_temp.p2_id(1101)::TEXT), 'the 268 grant publishes the AI rights into the common role');
SELECT pg_temp.p2_claims(1) AS p2_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p2_admin_setup';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_roles_phase(2);
RESET ROLE;
SELECT pg_temp.p2_assert(platform_private.staff_has_permission(pg_temp.p2_id(1), pg_temp.p2_id(302), 'ai.agent.manage')
  AND platform_private.staff_has_permission(pg_temp.p2_id(1), pg_temp.p2_id(303), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.p2_id(1), pg_temp.p2_id(303), 'ai.agent.manage')
  AND NOT platform_private.staff_has_permission(pg_temp.p2_id(1), pg_temp.p2_id(304), 'ai.agent.use')
  AND NOT platform_private.staff_has_permission(pg_temp.p2_id(1), pg_temp.p2_id(305), 'ai.agent.use'),
  'fixture: 2 manages, 3 only uses, 4 and the Student have no AI right');

UPDATE p2_actors a SET claims = pg_temp.p2_claims(a.n);
SELECT claims AS p2_admin FROM p2_actors WHERE n = 1 \gset
SELECT claims AS p2_manager FROM p2_actors WHERE n = 2 \gset
SELECT claims AS p2_viewer FROM p2_actors WHERE n = 3 \gset
SELECT claims AS p2_norights FROM p2_actors WHERE n = 4 \gset
SELECT claims AS p2_student FROM p2_actors WHERE n = 5 \gset
SELECT claims AS p2_other_admin FROM p2_actors WHERE n = 6 \gset

-- Consent (admin only, 269) for organization 1.
SET LOCAL request.jwt.claims TO :'p2_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_consent_record_v1(pg_temp.p2_id(1), 'grant', 'gemini-v1-2026-10-06',
  pg_temp.p2_id(3001)) ->> 'status') = 'granted', 'the Admin records the Gemini consent');
RESET ROLE;
-- Pending queue pointers of earlier suites never reach this worker.
DELETE FROM pgmq.q_ai_agent_work_v1;

SELECT 'AI271_FIXTURE_READY' AS ai271_marker;

-- ---------------------------------------------------------------------------
-- 3. Upload (271): rights, confirmations, type, scan proof, duplicate, replay.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p2_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3090)) LIKE '42501:%',
  'the Student cannot upload');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3090)) LIKE '42501:%',
  'another organization''s Admin cannot upload into organization 1');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_norights';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3090))
  LIKE '42501:ai_agent_forbidden%', 'a member without AI rights cannot upload');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3090))
  LIKE '42501:ai_agent_forbidden%', 'ai.agent.use alone cannot upload (manage)');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3090)) LIKE '42501:%',
  'anon cannot upload');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, FALSE, 3090))
  LIKE '22023:ai_document_company_material_required%', 'without «Это материал компании» the upload is refused');
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', FALSE, TRUE, 3090))
  LIKE '22023:ai_document_client_confirmation_required%', '«Для клиентов» needs the confirmation');
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'pdf', 'image/png', 'client', TRUE, TRUE, 3090))
  LIKE '22023:ai_document_type_mismatch%'
  AND pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'docx', 'application/vnd.ms-word.document.macroEnabled.12',
    'client', TRUE, TRUE, 3090)) LIKE '22023:ai_document_type_mismatch%'
  AND pg_temp.p2_err(pg_temp.p2_upload(1, 1090, 'Прайс', 'knowledge', 'text/markdown', 'client', TRUE, TRUE, 3090))
    LIKE '22023:ai_document_invalid_upload%',
  'a kind/MIME mismatch, a macro format and the knowledge kind are refused');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_document_upload_v1(%L, %L, ''Прайс'', ''csv'', ''text/csv'', 1024, %L, ''internal'', FALSE, TRUE, NULL, NULL, %L, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1090), pg_temp.p2_sha('A'), pg_temp.p2_proof(pg_temp.p2_sha('B')), pg_temp.p2_id(3090)))
    LIKE '22023:ai_document_scan_proof_invalid%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_upload_v1(%L, %L, ''Прайс'', ''csv'', ''text/csv'', 1024, %L, ''internal'', FALSE, TRUE, NULL, NULL, %L, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1090), pg_temp.p2_sha('A'),
    pg_temp.p2_proof(pg_temp.p2_sha('A')) || jsonb_build_object('scannedAt', '2026-01-01T00:00:00.000Z'), pg_temp.p2_id(3090)))
    LIKE '22023:ai_document_scan_proof_invalid%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_upload_v1(%L, %L, ''Прайс'', ''csv'', ''text/csv'', 26214401, %L, ''internal'', FALSE, TRUE, NULL, NULL, %L, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1090), pg_temp.p2_sha('A'), pg_temp.p2_proof(pg_temp.p2_sha('A')), pg_temp.p2_id(3090)))
    LIKE '22023:ai_document_invalid_upload%',
  'a scan proof of other bytes, a stale scan and a file over 25 MiB are refused');

SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1001, 'Прайс 2027', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3101)) AS u1001 \gset
SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1002, 'Политика возвратов', 'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'internal', FALSE, TRUE, 3102)) AS u1002 \gset
SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1003, 'Условия 2027 (скан)', 'pdf', 'application/pdf', 'client', TRUE, TRUE,
  3103)) AS u1003 \gset
SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1005, 'Анкета', 'image', 'image/jpeg', 'internal', FALSE, TRUE, 3105)) AS u1005 \gset
SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1006, 'Черновик', 'text', 'text/markdown', 'internal', FALSE, TRUE, 3106)) AS u1006 \gset
SELECT pg_temp.p2_assert((:'u1001'::JSONB ->> 'status') = 'queued' AND (:'u1001'::JSONB #>> '{document,status}') = 'queued'
  AND (:'u1001'::JSONB #>> '{document,source}') = 'upload' AND (:'u1001'::JSONB ->> 'replayed') = 'false'
  AND NOT (:'u1001'::JSONB -> 'document') ? 'storagePath'
  AND (:'u1002'::JSONB #>> '{document,audience}') = 'internal' AND (:'u1003'::JSONB ->> 'status') = 'queued'
  AND (:'u1005'::JSONB ->> 'status') = 'queued' AND (:'u1006'::JSONB ->> 'status') = 'queued',
  'five uploads are queued; the receipt has no storage path');
SELECT pg_temp.p2_assert((pg_temp.p2_call(pg_temp.p2_upload(1, 1001, 'Прайс 2027', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3101)) ->> 'replayed') = 'true',
  'the same request replays the receipt');
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1001, 'Прайс 2028', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3101))
  LIKE '23505:ai_request_conflict%', 'a reused request id with another payload is a conflict');
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1091, 'Копия прайса', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'client', TRUE, TRUE, 3191, NULL, NULL,
    pg_temp.p2_sha('P2 synthetic bytes 1001'))) = 'PT409:ai_document_duplicate:Прайс 2027',
  'a duplicate SHA-256 is refused PT409 with the existing title in DETAIL');
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1001, 'Другой', 'csv', 'text/csv', 'internal', FALSE, TRUE,
    3192, NULL, NULL, pg_temp.p2_sha('P2 other bytes'))) LIKE '23505:ai_document_id_taken%',
  'an existing document id is refused');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT d.storage_path = pg_temp.p2_id(1)::TEXT || '/' || pg_temp.p2_id(1001)::TEXT || '/original'
    AND d.byte_sha256 = pg_temp.p2_sha('P2 synthetic bytes 1001') AND d.scan_proof ->> 'engine' = 'ClamAV'
    AND d.source_ref = '{"kind":"upload","companyMaterial":true,"clientConfirmed":true}'::JSONB
    AND d.created_by = pg_temp.p2_id(302) AND d.content_md IS NULL
  FROM platform_private.ai_documents d WHERE d.id = pg_temp.p2_id(1001))
  AND (SELECT count(*) = 5 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'kind' = 'ingest'
    AND (q.message - ARRAY['v', 'kind', 'ref_id']) = '{}'::JSONB
    AND (q.message ->> 'ref_id')::UUID IN (pg_temp.p2_id(1001), pg_temp.p2_id(1002), pg_temp.p2_id(1003),
      pg_temp.p2_id(1005), pg_temp.p2_id(1006)))
  AND (SELECT count(*) = 1 FROM platform.audit_events e WHERE e.request_id = pg_temp.p2_id(3101)
    AND e.action = 'ai.agent.document.upload' AND e.resource_id = pg_temp.p2_id(1001)
    AND e.actor_profile_id = pg_temp.p2_id(202)),
  'the row holds {org}/{doc}/original, the SHA and ClamAV proof; one pointer-only ingest message each; one audit event');

-- ---------------------------------------------------------------------------
-- 4. Worker: content, pages, review items under the lease; the broker.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p2_text(k TEXT PRIMARY KEY, v TEXT);
INSERT INTO p2_text VALUES
  ('1001', E'# Прайс 2027\n\n## Лист «Программы»\n\n| Программа | Цена |\n|---|---|\n| Bachelor of Computer Science | 1 250,00 $ |\n| Master of Data Science | 2 100,00 $ |'),
  ('1002', E'# Политика возвратов\n\n## Сроки\n\nВозврат в течение 14 дней.'),
  ('1003', E'# Условия 2027\n\nСтоимость обучения: 1 250 $ в год. Оплата за год вперёд, в год один платёж.\n\nСтипендия: 2 500 $. Скидка 15 % при оплате до 1 марта; скидка 15 % для второго ребёнка.\n\nОбщежитие: 300 $ в месяц.'),
  ('1004', E'# Прайс 2027 (версия 2)\n\n| Программа | Цена |\n|---|---|\n| Bachelor of Computer Science | 1 300,00 $ |');
GRANT SELECT ON p2_text TO evo_ai_agent, authenticated, service_role;

SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.document_claim_v1(pg_temp.p2_id(1001), 'w1') AS c1001 \gset
SELECT pg_temp.p2_assert((:'c1001'::JSONB ->> 'claimed')::BOOLEAN AND (:'c1001'::JSONB ->> 'personalOverride') = 'false'
  AND (:'c1001'::JSONB ->> 'storagePath') LIKE '%/original' AND (:'c1001'::JSONB ->> 'stage') = 'extract'
  AND (:'c1001'::JSONB ->> 'byteSha256') = pg_temp.p2_sha('P2 synthetic bytes 1001'),
  'claim returns the original path, SHA and the personal-override flag');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.document_content_put_v1(%L, ''w2'', ''x'', 1)',
    pg_temp.p2_id(1001))) LIKE '42501:ai_document_not_leased%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_pages_put_v1(%L, ''w2'', %L)', pg_temp.p2_id(1001),
    '[{"pageNo":1,"method":"text","textMd":"x"}]')) LIKE '42501:ai_document_not_leased%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.review_items_put_v1(%L, ''w2'', %L)', pg_temp.p2_id(1001),
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'pageNo', 1, 'kind', 'number'))))
    LIKE '42501:ai_document_not_leased%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_content_put_v1(%L, ''w1'', %L, 1)',
    pg_temp.p2_id(1001), repeat('x', 2000001))) LIKE '22023:%',
  'content, pages and review items only under the own lease; content ≤ 2 000 000 characters');
SELECT platform_ai_agent.document_content_put_v1(pg_temp.p2_id(1001), 'w1', (SELECT v FROM p2_text WHERE k = '1001'), 1)
  AS cp1001 \gset
SELECT pg_temp.p2_assert((:'cp1001'::JSONB ->> 'contentSha256') = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1001')),
  'content_sha256 is the SHA-256 of the UTF-8 text');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.document_pages_put_v1(%L, ''w1'', %L)',
    pg_temp.p2_id(1001), jsonb_build_array(jsonb_build_object('pageNo', 1, 'method', 'text', 'textMd', 'x',
      'imagePath', pg_temp.p2_id(1)::TEXT || '/' || pg_temp.p2_id(1003)::TEXT || '/pages/1.png'))))
    LIKE '22023:ai_document_invalid_pages%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_pages_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1001),
    (SELECT jsonb_agg(jsonb_build_object('pageNo', i, 'method', 'text', 'textMd', 'x')) FROM generate_series(1, 51) i)))
    LIKE '22023:ai_document_invalid_pages%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_pages_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1001),
    '[{"pageNo":1,"method":"ocr","textMd":"x","lines":[{"text":"x","bbox":[0,0,1.5,1]}]}]')) LIKE '22023:%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_pages_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1001),
    '[{"pageNo":1,"method":"text","textMd":"x"},{"pageNo":1,"method":"text","textMd":"y"}]')) LIKE '22023:%',
  'pages: another document''s image path, 51 pages, a box outside 0..1 and a repeated page are refused');
SELECT pg_temp.p2_assert((platform_ai_agent.document_pages_put_v1(pg_temp.p2_id(1001), 'w1', jsonb_build_array(
    jsonb_build_object('pageNo', 1, 'sheetName', 'Программы', 'method', 'text',
      'textMd', (SELECT v FROM p2_text WHERE k = '1001')))) ->> 'pages')::INTEGER = 1,
  'the sheet is stored as page 1');
SELECT pg_temp.p2_assert((platform_ai_agent.document_index_v1(pg_temp.p2_id(1001), 'w1', jsonb_build_array(
    pg_temp.p2_chunk(0, 'Прайс 2027 › Программы: Bachelor of Computer Science — 1 250,00 $ в год', 21, 1),
    pg_temp.p2_chunk(1, 'Прайс 2027 › Программы: Master of Data Science — 2 100,00 $ в год', 23, 1))) ->> 'status')
  = 'ready', 'a document without review items is ready');
-- 1002: DOCX without page rows (the viewer falls back to the text).
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1002), 'w1') ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_content_put_v1(pg_temp.p2_id(1002), 'w1', (SELECT v FROM p2_text WHERE k = '1002'), NULL)
    ->> 'chars') IS NOT NULL
  AND (platform_ai_agent.document_index_v1(pg_temp.p2_id(1002), 'w1', jsonb_build_array(
    jsonb_build_object('position', 0, 'content', 'Политика возвратов › Сроки: возврат в течение 14 дней',
      'sectionPath', 'Политика возвратов › Сроки', 'embedding', pg_temp.p2_unit(31)))) ->> 'status') = 'ready',
  'the internal DOCX is indexed');
-- 1003: a three-page scan with OCR lines and review items.
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1003), 'w1') ->> 'claimed')::BOOLEAN,
  'the scan is leased by w1');
RESET ROLE;

-- The broker authorization (CRM server, service_role).
CREATE TEMP TABLE p2_paths AS SELECT pg_temp.p2_id(1)::TEXT || '/' || pg_temp.p2_id(1003)::TEXT || '/' AS p3,
  pg_temp.p2_id(1)::TEXT || '/' || pg_temp.p2_id(1001)::TEXT || '/' AS p1, gen_random_uuid() AS crop;
GRANT SELECT ON p2_paths TO service_role, authenticated, evo_ai_agent;
SET LOCAL ROLE service_role;
CREATE FUNCTION pg_temp.p2_auth(p_doc INTEGER, p_worker TEXT, p_op TEXT, p_path TEXT) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.p2_err(format('SELECT platform.ai_agent_storage_authorize_v1(%L, %L, %L, %L, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(p_doc), p_worker, p_op, p_path))
$$;
SELECT pg_temp.p2_assert((platform.ai_agent_storage_authorize_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 'w1', 'GET',
    (SELECT p3 FROM p2_paths) || 'original') ->> 'mimeType') = 'application/pdf'
  AND (platform.ai_agent_storage_authorize_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 'w1', 'PUT',
    (SELECT p3 FROM p2_paths) || 'pages/1.png') ->> 'maxBytes')::INTEGER = 8388608
  AND (platform.ai_agent_storage_authorize_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 'w1', 'PUT',
    (SELECT p3 || 'crops/' || crop || '.png' FROM p2_paths)) ->> 'object') = 'crop'
  AND (platform.ai_agent_storage_authorize_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 'w1', 'GET',
    (SELECT p3 FROM p2_paths) || 'pages/300.png') ->> 'pageNo')::INTEGER = 300,
  'under the lease: GET the original and pages, PUT pages and crops');
SELECT pg_temp.p2_assert(pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 || 'crops/' || crop || '.png' FROM p2_paths)) LIKE '42501:ai_storage_forbidden%'
  AND pg_temp.p2_auth(1003, 'w1', 'PUT', (SELECT p3 FROM p2_paths) || 'original') LIKE '42501:ai_storage_forbidden%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths) || '../' || pg_temp.p2_id(1001)::TEXT || '/original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p1 FROM p2_paths) || 'original') LIKE '42501:%'
  AND pg_temp.p2_auth(1001, 'w1', 'GET', (SELECT p1 FROM p2_paths) || 'original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w9', 'GET', (SELECT p3 FROM p2_paths) || 'original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths) || 'pages/301.png') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths) || 'pages/0.png') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths) || 'pages/1.png/../../original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'get', (SELECT p3 FROM p2_paths) || 'original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'DELETE', (SELECT p3 FROM p2_paths) || 'original') LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths)) LIKE '42501:%'
  AND pg_temp.p2_auth(1003, 'w1', 'GET', replace((SELECT p3 FROM p2_paths), pg_temp.p2_id(1)::TEXT, pg_temp.p2_id(2)::TEXT) || 'original') LIKE '42501:%',
  'refused: GET a crop, PUT the original, ''..'', another document, a ready document, another worker, page 301/0, a lowercase or DELETE operation, a listing, another organization');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_storage_authorize_v1(%L, %L, ''w1'', ''GET'', %L)',
  pg_temp.p2_id(1), pg_temp.p2_id(1003), (SELECT p3 FROM p2_paths) || 'original')) LIKE '42501:permission denied%',
  'a staff session cannot call the broker authorization');
RESET ROLE;

SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_content_put_v1(pg_temp.p2_id(1003), 'w1',
    (SELECT v FROM p2_text WHERE k = '1003'), 3) ->> 'pageCount')::INTEGER = 3
  AND (platform_ai_agent.document_pages_put_v1(pg_temp.p2_id(1003), 'w1', (SELECT jsonb_agg(jsonb_build_object(
      'pageNo', i, 'method', 'ocr', 'confidence', 0.91, 'width', 1654, 'height', 2339,
      'imagePath', (SELECT p3 FROM p2_paths) || 'pages/' || i || '.png',
      'textMd', split_part((SELECT v FROM p2_text WHERE k = '1003'), E'\n\n', i + 1),
      'lines', jsonb_build_array(jsonb_build_object('text', split_part((SELECT v FROM p2_text WHERE k = '1003'), E'\n\n', i + 1),
        'bbox', jsonb_build_array(0.08, 0.1, 0.92, 0.13), 'conf', 0.9)),
      'ocr', jsonb_build_object('tesseractMs', 4100, 'visionModel', 'gemini-3.8-flash')) ORDER BY i)
    FROM generate_series(1, 3) i)) ->> 'pages')::INTEGER = 3,
  'the scan stores its text, three OCR pages with normalised line boxes and images');
CREATE TEMP TABLE p2_items AS SELECT * FROM (VALUES ('A', gen_random_uuid(), 1, '1 250', 'Стоимость обучения: 1 250 $'),
  ('B', gen_random_uuid(), 2, '2 500', 'Стипендия: 2 500 $'), ('C', gen_random_uuid(), 3, '300', 'Общежитие: 300 $'),
  ('D', gen_random_uuid(), 2, '15 %', 'Скидка 15 %')) v(label, id, page, proposed, anchor);
GRANT SELECT ON p2_items TO evo_ai_agent, authenticated, service_role;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.review_items_put_v1(%L, ''w1'', %L)',
    pg_temp.p2_id(1003), jsonb_build_array(jsonb_build_object('id', (SELECT id FROM p2_items WHERE label = 'A'), 'pageNo', 1,
      'kind', 'number', 'cropPath', (SELECT p1 FROM p2_paths) || 'crops/' || (SELECT id FROM p2_items WHERE label = 'A') || '.png'))))
    LIKE '22023:ai_review_invalid_items%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.review_items_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1003),
    (SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'pageNo', 1, 'kind', 'number'))
      FROM generate_series(1, 501)))) LIKE '22023:ai_review_invalid_items%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.review_items_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1003),
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'pageNo', 4, 'kind', 'number'))))
    LIKE '22023:ai_review_invalid_items%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.review_items_put_v1(%L, ''w1'', %L)', pg_temp.p2_id(1003),
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'pageNo', 1, 'kind', 'number', 'value', '1'))))
    LIKE '22023:ai_review_invalid_items%',
  'review items: a crop of another document, 501 items, a page past the end and a worker-set value are refused');
SELECT pg_temp.p2_assert((platform_ai_agent.review_items_put_v1(pg_temp.p2_id(1003), 'w1', (SELECT jsonb_agg(
    jsonb_build_object('id', i.id, 'pageNo', i.page, 'kind', 'number', 'proposed', i.proposed, 'anchor', i.anchor,
      'valueIndex', 0, 'contextLabel', 'Условия 2027 › стр. ' || i.page,
      'bbox', jsonb_build_array(0.1, 0.2, 0.3, 0.25),
      'cropPath', (SELECT p3 FROM p2_paths) || 'crops/' || i.id || '.png',
      'candidates', jsonb_build_object('tesseract', replace(i.proposed, '5', 'S'), 'vision', i.proposed,
        'arbiter', NULL, 'arbiterModel', NULL)) ORDER BY i.label) FROM p2_items i)) ->> 'items')::INTEGER = 4
  AND (platform_ai_agent.review_items_put_v1(pg_temp.p2_id(1003), 'w1', jsonb_build_array(jsonb_build_object(
    'id', (SELECT id FROM p2_items WHERE label = 'A'), 'pageNo', 1, 'kind', 'number', 'proposed', '1 250',
    'anchor', 'Стоимость обучения: 1 250 $', 'valueIndex', 0,
    'candidates', jsonb_build_object('tesseract', '1 2S0', 'vision', '1 250'))))->> 'items')::INTEGER = 1,
  'four open review items with crops and three readings; a retried put of the same id overwrites the open item');
SELECT platform_ai_agent.document_index_v1(pg_temp.p2_id(1003), 'w1', jsonb_build_array(
    pg_temp.p2_chunk(0, 'Стоимость обучения: 1 250 $ в год. Оплата за год вперёд, в год один платёж.', 11, 1),
    pg_temp.p2_chunk(1, 'Стипендия: 2 500 $. Скидка 15 % при оплате до 1 марта; скидка 15 % для второго ребёнка.', 13, 2),
    pg_temp.p2_chunk(2, 'Общежитие: 300 $ в месяц.', 15, 3))) AS i1003 \gset
SELECT pg_temp.p2_assert((:'i1003'::JSONB ->> 'status') = 'review'
  AND (:'i1003'::JSONB ->> 'contentSha256') = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')),
  'open review items keep the indexed scan in review');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT candidates = '{"tesseract":"1 2S0","vision":"1 250"}'::JSONB AND status = 'open'
    AND crop_path IS NULL FROM platform_private.ai_review_items WHERE id = (SELECT id FROM p2_items WHERE label = 'A'))
  AND (SELECT count(*) = 4 FROM platform_private.ai_review_items WHERE document_id = pg_temp.p2_id(1003))
  AND (SELECT lines -> 0 -> 'bbox' = '[0.08, 0.1, 0.92, 0.13]'::JSONB AND image_path LIKE '%/pages/2.png'
    FROM platform_private.ai_document_pages WHERE document_id = pg_temp.p2_id(1003) AND page_no = 2),
  'stored: candidates without nulls, normalised line boxes, page image path');
SET LOCAL ROLE service_role;
SELECT pg_temp.p2_assert(pg_temp.p2_auth(1003, 'w1', 'GET', (SELECT p3 FROM p2_paths) || 'original') LIKE '42501:%',
  'after indexing the lease is gone and the broker refuses');
RESET ROLE;

SELECT 'AI271_WORKER_DONE' AS ai271_marker;

-- A Laboratory redemption of the use-only member: search the live knowledge.
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_ticket_v1(pg_temp.p2_id(1), 'laboratory', NULL, NULL) ->> 'ticket' AS p2_tv \gset
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.redeem_ticket_v1(:'p2_tv', 'laboratory') ->> 'redemptionId' AS p2_rv \gset
CREATE FUNCTION pg_temp.p2_search_docs(p_redemption UUID, p_k INTEGER, p_text TEXT) RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(DISTINCT (e ->> 'documentId')::UUID), '{}')
  FROM jsonb_array_elements(platform_ai_agent.search_v1(p_redemption, jsonb_build_array(pg_temp.p2_unit(p_k)),
    jsonb_build_array(p_text)) -> 'client') e
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p2_search_docs(UUID, INTEGER, TEXT) TO evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_id(1001) = ANY (pg_temp.p2_search_docs(:'p2_rv', 21, 'Bachelor of Computer Science'))
  AND NOT pg_temp.p2_id(1002) = ANY (pg_temp.p2_search_docs(:'p2_rv', 31, 'возврат в течение 14 дней')),
  'a Laboratory redemption searches the client knowledge; the internal DOCX is not a client result');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. Replacement: swap-when-ready, including a failed new version.
-- ---------------------------------------------------------------------------
SELECT row_version AS p2_rv1001 FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1001) \gset
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1004, 'Прайс 2027 v2', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'internal', FALSE, TRUE, 3104, 1001, :p2_rv1001))
    LIKE '22023:ai_document_invalid_upload%'
  AND pg_temp.p2_err(pg_temp.p2_upload(1, 1004, 'Прайс 2027 v2', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', NULL, FALSE, TRUE, 3104, 1001, :p2_rv1001 - 1))
    LIKE 'PT409:ai_document_version_conflict%'
  AND pg_temp.p2_err(pg_temp.p2_upload(1, 1004, 'Анкета v2', 'image', 'image/png', NULL, FALSE, TRUE, 3104, 1005, 1))
    LIKE 'PT409:ai_document_replacement_pending%',
  'a replacement keeps the audience, needs the current version and a live target');
SELECT pg_temp.p2_call(pg_temp.p2_upload(1, 1004, 'Прайс 2027 v2', 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', NULL, FALSE, TRUE, 3104, 1001, :p2_rv1001)) AS u1004 \gset
SELECT pg_temp.p2_assert((:'u1004'::JSONB #>> '{document,audience}') = 'client'
    AND (:'u1004'::JSONB #>> '{document,replacesId}') = pg_temp.p2_id(1001)::TEXT
  AND pg_temp.p2_err(pg_temp.p2_upload(1, 1008, 'Прайс 2027 v3', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', NULL, FALSE, TRUE, 3108, 1001, :p2_rv1001))
    LIKE 'PT409:ai_document_replacement_pending%'
  AND (platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1001)) #>> '{successor,id}') = pg_temp.p2_id(1004)::TEXT,
  'the new version inherits «Для клиентов»; a second replacement while one is pending is refused PT409');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1004), 'w1') ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_stage_v1(pg_temp.p2_id(1004), 'w1', 'extract', 20, 'parse_failed') ->> 'status') = 'failed'
  AND pg_temp.p2_id(1001) = ANY (pg_temp.p2_search_docs(:'p2_rv', 21, 'Bachelor of Computer Science')),
  'a failed new version leaves the old one in search');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT status = 'ready' AND superseded_by_id IS NULL FROM platform_private.ai_documents
  WHERE id = pg_temp.p2_id(1001)), 'the old version stays ready after the failure');
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(pg_temp.p2_upload(1, 1008, 'Прайс 2027 v3', 'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', NULL, FALSE, TRUE, 3108, 1001, :p2_rv1001))
    LIKE 'PT409:ai_document_replacement_pending%'
  AND (platform.ai_agent_document_retry_v1(pg_temp.p2_id(1), pg_temp.p2_id(1004),
    (platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1004)) #>> '{document,rowVersion}')::BIGINT,
    pg_temp.p2_id(3114)) ->> 'status') = 'queued',
  'a failed successor still blocks another replacement until it is retried or deleted; «Повторить» queues it');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1004), 'w1') ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_content_put_v1(pg_temp.p2_id(1004), 'w1', (SELECT v FROM p2_text WHERE k = '1004'), 1)
    ->> 'contentSha256') IS NOT NULL
  AND pg_temp.p2_id(1001) = ANY (pg_temp.p2_search_docs(:'p2_rv', 21, 'Bachelor of Computer Science')),
  'while the new version is processing the old one is still found');
SELECT platform_ai_agent.document_index_v1(pg_temp.p2_id(1004), 'w1', jsonb_build_array(
  pg_temp.p2_chunk(0, 'Прайс 2027 v2 › Программы: Bachelor of Computer Science — 1 300,00 $ в год', 25, 1))) AS i1004 \gset
SELECT pg_temp.p2_assert((:'i1004'::JSONB ->> 'status') = 'ready'
    AND (:'i1004'::JSONB ->> 'replacedId') = pg_temp.p2_id(1001)::TEXT
  AND pg_temp.p2_search_docs(:'p2_rv', 25, 'Bachelor of Computer Science') @> ARRAY[pg_temp.p2_id(1004)]
  AND NOT pg_temp.p2_id(1001) = ANY (pg_temp.p2_search_docs(:'p2_rv', 21, 'Bachelor of Computer Science')),
  'once the new version is indexed it replaces the old one in the same transaction');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT status = 'superseded' AND superseded_by_id = pg_temp.p2_id(1004) AND NOT autosend_allowed
    FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1001))
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1001)),
  'the old version is superseded and its chunks are gone');

-- ---------------------------------------------------------------------------
-- 6. The personal-document stop and «Это материал компании — продолжить».
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1005), 'w1') ->> 'personalOverride') = 'false'
  AND (platform_ai_agent.review_items_put_v1(pg_temp.p2_id(1005), 'w1', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'pageNo', 1, 'kind', 'number', 'proposed', '7')))->> 'items')::INTEGER = 1
  AND (platform_ai_agent.document_stage_v1(pg_temp.p2_id(1005), 'w1', 'extract', 5, 'personal_document_suspected')
    ->> 'status') = 'failed',
  'the worker stops a suspected applicant document before any provider call');
RESET ROLE;
SELECT row_version AS p2_rv1005 FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1005) \gset
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_document_confirm_company_v1(%L, %L, %s, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1005), :p2_rv1005, pg_temp.p2_id(3115))) LIKE '42501:ai_agent_forbidden%',
  'ai.agent.use alone cannot override the stop');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_document_retry_v1(%L, %L, %s, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1005), :p2_rv1005, pg_temp.p2_id(3116))) LIKE '22023:ai_document_personal_suspected%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_confirm_company_v1(%L, %L, %s, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1005), :p2_rv1005 - 1, pg_temp.p2_id(3117))) LIKE 'PT409:ai_document_version_conflict%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_confirm_company_v1(%L, %L, %s, %L)',
    pg_temp.p2_id(1), pg_temp.p2_id(1002),
    (platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1002)) #>> '{document,rowVersion}')::BIGINT,
    pg_temp.p2_id(3118))) LIKE '22023:ai_document_not_suspected%',
  '«Повторить» is not the way out of the stop; a stale version or a document not stopped is refused');
SELECT pg_temp.p2_assert((platform.ai_agent_document_confirm_company_v1(pg_temp.p2_id(1), pg_temp.p2_id(1005), :p2_rv1005,
    pg_temp.p2_id(3119)) ->> 'status') = 'queued', 'the manager confirms «Это материал компании»');
SELECT pg_temp.p2_assert((platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1005)) #>> '{personalOverride,byName}')
  = 'P2 Actor 2', 'the document is queued again with the decision and its author recorded');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT personal_override_by = pg_temp.p2_id(302) AND status = 'queued' AND error_code IS NULL
    FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1005))
  AND (SELECT count(*) = 2 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'ref_id' = pg_temp.p2_id(1005)::TEXT)
  AND (SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.p2_id(3119)
    AND action = 'ai.agent.document.override'),
  'the override is stored, audited and a new ingest pointer is queued');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1005), 'w1') ->> 'personalOverride') = 'true',
  'the next claim tells the worker the stop was overridden');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. Deletion mid-processing ends the work.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1006), 'w1') ->> 'claimed')::BOOLEAN,
  'the draft is being processed');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_document_delete_v1(pg_temp.p2_id(1), pg_temp.p2_id(1006),
    (platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1006)) #>> '{document,rowVersion}')::BIGINT,
    pg_temp.p2_id(3120)) ->> 'storagePath') = (SELECT replace(p3, pg_temp.p2_id(1003)::TEXT, pg_temp.p2_id(1006)::TEXT)
      FROM p2_paths) || 'original',
  'delete returns the storage path for the CRM to remove the prefix');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.document_content_put_v1(%L, ''w1'', ''x'', 1)',
    pg_temp.p2_id(1006))) LIKE 'P0002:ai_document_gone%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_stage_v1(%L, ''w1'', ''chunk'', 50)',
    pg_temp.p2_id(1006))) LIKE 'P0002:ai_document_gone%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.document_index_v1(%L, ''w1'', %L)', pg_temp.p2_id(1006),
    jsonb_build_array(pg_temp.p2_chunk(0, 'x', 1)))) LIKE 'P0002:ai_document_gone%'
  AND (platform_ai_agent.document_claim_v1(pg_temp.p2_id(1006), 'w1') ->> 'reason') = 'gone',
  'after the delete every worker call ends with ai_document_gone');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.p2_assert(pg_temp.p2_auth(1006, 'w1', 'PUT',
    (SELECT replace(p3, pg_temp.p2_id(1003)::TEXT, pg_temp.p2_id(1006)::TEXT) FROM p2_paths) || 'pages/1.png') LIKE '42501:%',
  'and the broker refuses its objects');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 8. The viewer: document, pages, chunk boxes and review items.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_document_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003)) AS d1003 \gset
SELECT platform.ai_agent_document_page_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 2) AS pg1003 \gset
SELECT pg_temp.p2_assert(jsonb_array_length(:'d1003'::JSONB -> 'pages') = 3
  AND (SELECT sum((e ->> 'openReviewCount')::INTEGER) = 4 AND bool_and((e ->> 'hasImage')::BOOLEAN)
    FROM jsonb_array_elements(:'d1003'::JSONB -> 'pages') e)
  AND (:'d1003'::JSONB #>> '{document,openReviewCount}')::INTEGER = 4 AND (:'d1003'::JSONB ->> 'canManage') = 'false'
  AND (:'d1003'::JSONB ->> 'contentSha256') = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')),
  'the document view: three pages with images and four open items; the use-only member cannot manage');
SELECT pg_temp.p2_assert((:'pg1003'::JSONB #>> '{page,textMd}') LIKE 'Стипендия%'
  AND (:'pg1003'::JSONB #>> '{page,imagePath}') LIKE '%/pages/2.png'
  AND jsonb_array_length(:'pg1003'::JSONB #> '{page,lines}') = 1
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(:'pg1003'::JSONB -> 'chunks') e WHERE (e ->> 'pageFrom')::INTEGER = 2)
  AND (SELECT array_agg(e ->> 'proposed' ORDER BY e ->> 'proposed') = ARRAY['15 %', '2 500']
    AND bool_and(e ->> 'cropPath' LIKE '%/crops/%.png' AND (e -> 'candidates') ? 'vision')
    FROM jsonb_array_elements(:'pg1003'::JSONB -> 'reviewItems') e),
  'a page: text, line boxes, the server-side image path, the chunk on the page and its two review items');
SELECT pg_temp.p2_assert((platform.ai_agent_document_page_v1(pg_temp.p2_id(1), pg_temp.p2_id(1002), 1)
    #>> '{page,textMd}') LIKE '# Политика возвратов%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_page_v1(%L, %L, 2)', pg_temp.p2_id(1), pg_temp.p2_id(1002)))
    LIKE 'P0002:ai_document_page_not_found%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_page_v1(%L, %L, 4)', pg_temp.p2_id(1), pg_temp.p2_id(1003)))
    LIKE 'P0002:ai_document_page_not_found%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_page_v1(%L, %L, 0)', pg_temp.p2_id(1), pg_temp.p2_id(1003)))
    LIKE '22023:%',
  'a document without page rows shows its text as page 1; missing pages are P0002');
SELECT pg_temp.p2_assert((SELECT (e ->> 'openReviewCount')::INTEGER = 4 AND (e ->> 'applyingReviewCount')::INTEGER = 0
  FROM jsonb_array_elements(platform.ai_agent_documents_v1(pg_temp.p2_id(1)) -> 'items') e
  WHERE e ->> 'id' = pg_temp.p2_id(1003)::TEXT), 'the list shows the open and applying counts');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_document_v1(%L, %L)', pg_temp.p2_id(1),
    pg_temp.p2_id(1003))) LIKE '42501:%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_v1(%L, %L)', pg_temp.p2_id(2), pg_temp.p2_id(1003)))
    LIKE 'P0002:ai_document_not_found%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_document_page_v1(%L, %L, 1)', pg_temp.p2_id(2), pg_temp.p2_id(1003)))
    LIKE 'P0002:%',
  'another organization''s Admin sees neither the document nor its pages');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_document_page_v1(%L, %L, 1)', pg_temp.p2_id(1),
    pg_temp.p2_id(1003))) LIKE '42501:%', 'the Student sees no page');
RESET ROLE;

SELECT 'AI271_FILES_DONE' AS ai271_marker;

-- ---------------------------------------------------------------------------
-- 9. «Лист сверки» (272).
-- ---------------------------------------------------------------------------
SELECT id AS p2_ia FROM p2_items WHERE label = 'A' \gset
SELECT id AS p2_ib FROM p2_items WHERE label = 'B' \gset
SELECT id AS p2_ic FROM p2_items WHERE label = 'C' \gset
SELECT id AS p2_id_d FROM p2_items WHERE label = 'D' \gset
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_review_v1(pg_temp.p2_id(1)) AS rv0 \gset
SELECT pg_temp.p2_assert(jsonb_array_length(:'rv0'::JSONB -> 'items') = 4
  AND (SELECT array_agg((e ->> 'pageNo')::INTEGER ORDER BY o) = ARRAY[1, 2, 2, 3]
    AND bool_and(e ->> 'documentId' = pg_temp.p2_id(1003)::TEXT AND e ->> 'documentTitle' = 'Условия 2027 (скан)'
      AND (e -> 'candidates') ? 'tesseract') AND count(*) FILTER (WHERE (e ->> 'hasCrop')::BOOLEAN) = 3
    FROM jsonb_array_elements(:'rv0'::JSONB -> 'items') WITH ORDINALITY AS i(e, o))
  AND (:'rv0'::JSONB -> 'counts') = '{"open": 4, "applying": 0}'::JSONB AND (:'rv0'::JSONB ->> 'canManage') = 'false',
  'the review sheet lists the four items of the live scan in page order (not the item of the document still processing)');
SELECT platform.ai_agent_review_v1(pg_temp.p2_id(1), jsonb_build_object('documentId', pg_temp.p2_id(1003), 'limit', 2))
  AS rv_page1 \gset
SELECT pg_temp.p2_assert(jsonb_array_length(:'rv_page1'::JSONB -> 'items') = 2 AND (:'rv_page1'::JSONB ->> 'hasMore') = 'true'
  AND jsonb_array_length(platform.ai_agent_review_v1(pg_temp.p2_id(1), jsonb_build_object('documentId', pg_temp.p2_id(1003),
    'limit', 2, 'before', :'rv_page1'::JSONB #>> '{items,1,id}')) -> 'items') = 2
  AND (platform.ai_agent_review_v1(pg_temp.p2_id(1), jsonb_build_object('documentId', pg_temp.p2_id(1003),
    'limit', 2, 'before', :'rv_page1'::JSONB #>> '{items,1,id}')) ->> 'hasMore') = 'false'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_v1(%L, ''{"status":"all"}'')', pg_temp.p2_id(1))) LIKE '22023:%',
  'the sheet pages by the item cursor; an unknown filter is refused');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''confirm'', NULL, ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ia', pg_temp.p2_id(3200))) LIKE '42501:ai_agent_forbidden%',
  'ai.agent.use alone cannot resolve an item');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_review_v1(%L)', pg_temp.p2_id(1))) LIKE '42501:%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''confirm'', NULL, ''open'', %L)',
    pg_temp.p2_id(2), :'p2_ia', pg_temp.p2_id(3200))) LIKE 'P0002:ai_review_not_found%',
  'another organization''s Admin neither reads nor resolves the items');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ia', 'confirm', NULL, 'open', pg_temp.p2_id(3201))
  AS rr_a \gset
SELECT pg_temp.p2_assert((:'rr_a'::JSONB #>> '{item,status}') = 'resolved' AND (:'rr_a'::JSONB #>> '{item,resolution}') = 'confirm'
  AND (:'rr_a'::JSONB #>> '{item,value}') = '1 250' AND (:'rr_a'::JSONB ->> 'documentStatus') = 'review'
  AND NOT (:'rr_a'::JSONB -> 'item') ? 'cropPath'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ia', 'confirm', NULL, 'open', pg_temp.p2_id(3201))
    ->> 'replayed') = 'true',
  '«Подтвердить» takes the proposed value and resolves at once; the same request replays');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''confirm'', NULL, ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ia', pg_temp.p2_id(3202))) LIKE 'PT409:ai_review_changed%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''reopen'', NULL, ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ib', pg_temp.p2_id(3202))) LIKE '22023:ai_review_invalid_action%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''correct'', %L, ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ib', E'2 600\n3 000', pg_temp.p2_id(3202))) LIKE '22023:%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''correct'', %L, ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ib', repeat('9', 201), pg_temp.p2_id(3202))) LIKE '22023:%'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''confirm'', ''1'', ''open'', %L)',
    pg_temp.p2_id(1), :'p2_ib', pg_temp.p2_id(3202))) LIKE '22023:%',
  'a stale expected status is PT409; an impossible transition, a multi-line or long correction and a value on confirm are refused');
SELECT pg_temp.p2_assert((platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ib', 'correct', ' 2 600 ', 'open',
    pg_temp.p2_id(3203)) #>> '{item,status}') = 'applying'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_id_d', 'correct', '20 %', 'open',
    pg_temp.p2_id(3204)) #>> '{item,value}') = '20 %'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ic', 'dismiss', NULL, 'open',
    pg_temp.p2_id(3205)) #>> '{item,status}') = 'dismissed',
  '«Исправить» puts two corrections into applying; «Оставить как есть» dismisses one');
SELECT pg_temp.p2_assert((platform.ai_agent_review_v1(pg_temp.p2_id(1)) -> 'counts') = '{"open": 0, "applying": 2}'::JSONB
  AND jsonb_array_length(platform.ai_agent_review_v1(pg_temp.p2_id(1), '{"status":"dismissed"}') -> 'items') = 1,
  'the tab count holds the two corrections in progress');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT status = 'review' FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1003))
  AND (SELECT value = '2 600' AND resolution = 'correct' AND resolved_by = pg_temp.p2_id(302) AND resolved_at IS NULL
    FROM platform_private.ai_review_items WHERE id = :'p2_ib')
  AND (SELECT count(*) = 2 FROM pgmq.q_ai_agent_work_v1 q WHERE q.message ->> 'kind' = 'reindex'
    AND q.message ->> 'ref_id' = pg_temp.p2_id(1003)::TEXT)
  AND (SELECT array_agg(action ORDER BY action) FROM platform.audit_events
    WHERE request_id IN (pg_temp.p2_id(3201), pg_temp.p2_id(3203), pg_temp.p2_id(3205)))
    = ARRAY['ai.agent.review.confirm', 'ai.agent.review.correct', 'ai.agent.review.dismiss'],
  'applying keeps the document in review; each correction queues a reindex pointer; every decision is audited');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((SELECT array_agg(e ->> 'status' ORDER BY e ->> 'status') = ARRAY['applying', 'applying']
    FROM jsonb_array_elements(platform_ai_agent.search_v1(:'p2_rv', jsonb_build_array(pg_temp.p2_unit(13)),
      '["Стипендия скидка"]') -> 'review') e WHERE e ->> 'pageNo' = '2'),
  'search returns the applying items as unverified numbers of the page');
RESET ROLE;
SELECT id AS p2_c0 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003) AND position = 0 \gset
SELECT id AS p2_c1 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003) AND position = 1 \gset
SELECT id AS p2_c2 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003) AND position = 2 \gset
SELECT id AS p2_c1004 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1004) LIMIT 1 \gset
SELECT knowledge_version AS p2_kv_before FROM platform_private.ai_settings WHERE organization_id = pg_temp.p2_id(1) \gset
CREATE TEMP TABLE p2_vectors AS SELECT id, embedding::TEXT AS v FROM platform_private.ai_chunks
  WHERE document_id = pg_temp.p2_id(1003);
SELECT pg_temp.p2_assert((platform_private.ai_answer_live_sources(pg_temp.p2_id(1),
    jsonb_build_object('sources', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', :p2_c1)))) -> 0 ->> 'unverified')
  = 'true', 'an answer source on a page with an applying correction is «Число не проверено»');

-- Reindex: lease, base SHA, reuse, partial re-embedding, anchor_ambiguous.
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.document_reindex_claim_v1(pg_temp.p2_id(1003), 'r1') AS rc1 \gset
SELECT pg_temp.p2_assert((:'rc1'::JSONB ->> 'claimed')::BOOLEAN AND jsonb_array_length(:'rc1'::JSONB -> 'decisions') = 2
  AND jsonb_array_length(:'rc1'::JSONB -> 'chunks') = 3
  AND (:'rc1'::JSONB ->> 'contentSha256') = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003'))
  AND (SELECT bool_and((e ->> 'hasEmbedding')::BOOLEAN) FROM jsonb_array_elements(:'rc1'::JSONB -> 'chunks') e)
  AND (platform_ai_agent.document_reindex_claim_v1(pg_temp.p2_id(1003), 'r2') ->> 'reason') = 'busy',
  'the reindex lease returns the text, SHA, chunks and the two pending corrections; a second worker is busy');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_review_resolve_v1(%L, %L, ''reopen'', NULL, ''applying'', %L)',
    pg_temp.p2_id(1), :'p2_id_d', pg_temp.p2_id(3206))) LIKE 'PT409:ai_review_applying%',
  'an applying item cannot be reopened while the reindex lease is live');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.p2_assert((platform.ai_agent_storage_authorize_v1(pg_temp.p2_id(1), pg_temp.p2_id(1003), 'r1', 'GET',
    (SELECT p3 FROM p2_paths) || 'pages/2.png') ->> 'allowed')::BOOLEAN
  AND pg_temp.p2_auth(1003, 'r1', 'PUT', (SELECT p3 FROM p2_paths) || 'pages/2.png') LIKE '42501:%',
  'the reindex lease reads pages through the broker but writes nothing');
RESET ROLE;
INSERT INTO p2_text VALUES ('1003b', replace((SELECT v FROM p2_text WHERE k = '1003'), 'Стипендия: 2 500 $', 'Стипендия: 2 600 $'));
SET LOCAL ROLE evo_ai_agent;
CREATE FUNCTION pg_temp.p2_reindex(p_base TEXT, p_chunks JSONB, p_applied JSONB, p_failed JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.p2_err(format('SELECT platform_ai_agent.document_reindex_v1(%L, ''r1'', %L, %L, %L, %L, %L)',
    pg_temp.p2_id(1003), p_base, (SELECT v FROM p2_text WHERE k = '1003b'), p_chunks, p_applied, p_failed))
$$;
SELECT pg_temp.p2_assert(pg_temp.p2_reindex(pg_temp.p2_sha('x'), jsonb_build_array(jsonb_build_object('position', 0,
      'reuse', :p2_c0)), jsonb_build_array(:'p2_ib'), '[]') LIKE 'PT409:ai_document_content_changed%'
  AND pg_temp.p2_reindex(pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')), jsonb_build_array(jsonb_build_object(
      'position', 0, 'reuse', :p2_c0)), jsonb_build_array(:'p2_ia'), '[]') LIKE 'PT409:ai_review_changed%'
  AND pg_temp.p2_reindex(pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')), jsonb_build_array(jsonb_build_object(
      'position', 0, 'reuse', :p2_c1004)), jsonb_build_array(:'p2_ib'), '[]') LIKE '22023:ai_document_invalid_chunks%'
  AND pg_temp.p2_reindex(pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')), jsonb_build_array(jsonb_build_object(
      'position', 0, 'content', 'без вектора')), jsonb_build_array(:'p2_ib'), '[]') LIKE '22023:ai_document_invalid_chunks%'
  AND pg_temp.p2_reindex(pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')), jsonb_build_array(
      jsonb_build_object('position', 0, 'reuse', :p2_c0), jsonb_build_object('position', 1, 'reuse', :p2_c0)),
      jsonb_build_array(:'p2_ib'), '[]') LIKE '22023:ai_document_invalid_chunks%',
  'reindex: a stale SHA and a non-applying item are PT409; reuse of another document''s chunk, a new chunk without a vector and a double reuse are refused');
SELECT platform_ai_agent.document_reindex_v1(pg_temp.p2_id(1003), 'r1',
  pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003')), (SELECT v FROM p2_text WHERE k = '1003b'),
  jsonb_build_array(jsonb_build_object('position', 0, 'reuse', :p2_c0),
    pg_temp.p2_chunk(1, 'Стипендия: 2 600 $. Скидка 15 % при оплате до 1 марта; скидка 15 % для второго ребёнка.', 17, 2),
    jsonb_build_object('position', 2, 'reuse', :p2_c2)),
  jsonb_build_array(:'p2_ib'), jsonb_build_array(jsonb_build_object('id', :'p2_id_d', 'code', 'anchor_ambiguous'))) AS ri1 \gset
SELECT pg_temp.p2_assert((:'ri1'::JSONB ->> 'changed')::BOOLEAN AND (:'ri1'::JSONB ->> 'reused')::INTEGER = 2
  AND (:'ri1'::JSONB ->> 'embedded')::INTEGER = 1 AND (:'ri1'::JSONB ->> 'applied')::INTEGER = 1
  AND (:'ri1'::JSONB ->> 'failed')::INTEGER = 1 AND (:'ri1'::JSONB ->> 'status') = 'review'
  AND (:'ri1'::JSONB ->> 'contentSha256') = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003b'))
  AND (:'ri1'::JSONB ->> 'knowledgeVersion')::BIGINT = :p2_kv_before + 1,
  'the reindex applies one correction, re-embeds one chunk, reuses two and bumps the knowledge version');
SELECT pg_temp.p2_assert((platform_ai_agent.document_reindex_claim_v1(pg_temp.p2_id(1003), 'r1') ->> 'reason') = 'idle'
  AND pg_temp.p2_reindex(pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003b')), jsonb_build_array(jsonb_build_object(
      'position', 0, 'reuse', :p2_c0)), '[]', jsonb_build_array(jsonb_build_object('id', :'p2_id_d', 'code', 'x')))
    LIKE '42501:ai_document_not_leased%',
  'nothing is left to apply; without the lease a reindex is refused');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT count(*) = 2 FROM platform_private.ai_chunks c JOIN p2_vectors v ON v.id = c.id
    WHERE c.document_id = pg_temp.p2_id(1003) AND c.embedding::TEXT = v.v AND c.id IN (:p2_c0, :p2_c2))
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_chunks WHERE id = :p2_c1)
  AND (SELECT content LIKE 'Стипендия: 2 600%' FROM platform_private.ai_chunks
    WHERE document_id = pg_temp.p2_id(1003) AND position = 1)
  AND (SELECT status = 'resolved' AND resolved_at IS NOT NULL AND value = '2 600' FROM platform_private.ai_review_items
    WHERE id = :'p2_ib')
  AND (SELECT status = 'open' AND resolution IS NULL AND resolved_by IS NULL AND error_code = 'anchor_ambiguous'
    AND value = '20 %' FROM platform_private.ai_review_items WHERE id = :'p2_id_d')
  AND (SELECT doc_version = 2 AND reindex_lease_owner IS NULL AND status = 'review'
    AND content_md = (SELECT v FROM p2_text WHERE k = '1003b') FROM platform_private.ai_documents
    WHERE id = pg_temp.p2_id(1003)),
  'reused chunks keep their IDs and vectors; the corrected value is in the text; the ambiguous anchor is open again with its code');
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ia', 'reopen', NULL, 'resolved',
    pg_temp.p2_id(3207)) #>> '{item,status}') = 'open'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ia', 'confirm', NULL, 'open',
    pg_temp.p2_id(3208)) ->> 'documentStatus') = 'review'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_id_d', 'dismiss', NULL, 'open',
    pg_temp.p2_id(3209)) ->> 'documentStatus') = 'ready',
  '«Открыть снова» and a new decision; with the last open item decided the document is ready');
SELECT pg_temp.p2_assert((platform.ai_agent_review_v1(pg_temp.p2_id(1)) -> 'counts') = '{"open": 0, "applying": 0}'::JSONB,
  '«Всё сверено»');
RESET ROLE;

SELECT 'AI272_REVIEW_DONE' AS ai272_marker;

-- ---------------------------------------------------------------------------
-- 10. Laboratory tickets (273): purposes, rights and isolation.
-- ---------------------------------------------------------------------------
-- Ticket as a staff member, redeemed as the agent (the CRM → agent path).
CREATE FUNCTION pg_temp.p2_redeem(p_claims TEXT, p_purpose TEXT, p_ref UUID) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_ticket TEXT; v_redemption UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  v_ticket := platform.ai_agent_ticket_v1(pg_temp.p2_id(1), p_purpose, NULL, p_ref) ->> 'ticket';
  SET LOCAL ROLE evo_ai_agent;
  v_redemption := (platform_ai_agent.redeem_ticket_v1(v_ticket, p_purpose) ->> 'redemptionId')::UUID;
  RESET ROLE;
  RETURN v_redemption;
END
$$;
CREATE FUNCTION pg_temp.p2_ticket_err(p_claims TEXT, p_purpose TEXT, p_conversation UUID, p_ref UUID) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_result TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  SET LOCAL ROLE authenticated;
  v_result := pg_temp.p2_err(format('SELECT platform.ai_agent_ticket_v1(%L, %L, %L, %L)', pg_temp.p2_id(1), p_purpose,
    p_conversation, p_ref));
  RESET ROLE;
  RETURN v_result;
END
$$;
SELECT pg_temp.p2_assert(pg_temp.p2_ticket_err(:'p2_viewer', 'laboratory', gen_random_uuid(), NULL) LIKE '22023:ai_ticket_invalid%'
  AND pg_temp.p2_ticket_err(:'p2_viewer', 'laboratory', NULL, gen_random_uuid()) LIKE '22023:ai_ticket_invalid%'
  AND pg_temp.p2_ticket_err(:'p2_viewer', 'lab_apply', NULL, gen_random_uuid()) LIKE '42501:ai_agent_forbidden%'
  AND pg_temp.p2_ticket_err(:'p2_viewer', 'autosend', NULL, NULL) LIKE '22023:ai_ticket_invalid_purpose%'
  AND pg_temp.p2_ticket_err(:'p2_norights', 'laboratory', NULL, NULL) LIKE '42501:ai_agent_forbidden%'
  AND pg_temp.p2_ticket_err(:'p2_student', 'laboratory', NULL, NULL) LIKE '42501:%'
  AND pg_temp.p2_ticket_err(:'p2_other_admin', 'laboratory', NULL, NULL) LIKE '42501:%'
  AND pg_temp.p2_ticket_err(:'p2_manager', 'lab_apply', NULL, NULL) LIKE '22023:ai_ticket_invalid%'
  AND pg_temp.p2_ticket_err(:'p2_manager', 'lab_apply', NULL, gen_random_uuid()) LIKE '42501:ai_lab_proposal_unavailable%',
  'laboratory needs ai.agent.use and no conversation; lab_apply needs ai.agent.manage and an own proposal');
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_ticket_v1(pg_temp.p2_id(1), 'laboratory', NULL, NULL) ->> 'ticket' AS p2_tv2 \gset
RESET ROLE;
-- A synthetic redeemed answer ticket (the answer path itself is proven by 269's suite).
INSERT INTO platform_private.ai_tickets(token_sha256, organization_id, membership_id, purpose, conversation_id,
  issued_at, expires_at, used_at)
VALUES (pg_temp.p2_sha('P2 answer ticket'), pg_temp.p2_id(1), pg_temp.p2_id(302), 'answer', gen_random_uuid(),
  clock_timestamp(), clock_timestamp() + INTERVAL '60 seconds', clock_timestamp());
SELECT id AS p2_ra FROM platform_private.ai_tickets WHERE token_sha256 = pg_temp.p2_sha('P2 answer ticket') \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''answer'')', :'p2_tv2'))
    LIKE '42501:ai_ticket_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.redeem_ticket_v1(%L, ''lab_apply'')', :'p2_tv2'))
    LIKE '42501:ai_ticket_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.conversation_context_v1(%L)', :'p2_rv')) LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.answer_claim_v1(%L, ''reply'', ''f1'')', :'p2_rv'))
    LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_session_get_v1(%L)', :'p2_ra')) LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_documents_v1(%L, ''{}''::UUID[])', :'p2_ra'))
    LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_proposal_put_v1(%L, ''{}'')', :'p2_ra'))
    LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_apply_prepare_v1(%L)', :'p2_rv')) LIKE '42501:ai_redemption_invalid%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_apply_v1(%L, NULL, NULL, NULL, NULL, %L)', :'p2_rv',
    pg_temp.p2_unit(1))) LIKE '42501:ai_redemption_invalid%',
  'a Laboratory ticket opens no conversation and no apply; an answer ticket opens no Laboratory function');
SELECT pg_temp.p2_assert((platform_ai_agent.rate_take_v1(:'p2_rv') ->> 'purpose') = 'laboratory'
  AND (platform_ai_agent.rate_take_v1(:'p2_rv') ->> 'status') = 'taken', 'a Laboratory redemption takes the rate limit');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT sum(hits) = 1 FROM platform_private.ai_rate_limits
  WHERE organization_id = pg_temp.p2_id(1) AND membership_id = pg_temp.p2_id(303)),
  'the Laboratory counts once per redemption toward the 20 per minute of the member');

-- ---------------------------------------------------------------------------
-- 11. Session (revision-checked, 2 hours) and the documents for the critique.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.lab_session_get_v1(:'p2_rv') ->> 'revision')::INTEGER = 0
  AND (platform_ai_agent.lab_session_put_v1(:'p2_rv', 0, '{"question":"Есть ли общежитие?"}') ->> 'revision')::INTEGER = 1
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_session_put_v1(%L, 0, ''{}'')', :'p2_rv'))
    LIKE 'PT409:ai_lab_session_changed%'
  AND (platform_ai_agent.lab_session_put_v1(:'p2_rv', 1, '{"question":"Есть ли общежитие?","answer":"Да"}')
    ->> 'revision')::INTEGER = 2
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_session_put_v1(%L, 2, %L)', :'p2_rv',
    jsonb_build_object('blob', repeat('x', 262145)))) LIKE '22023:ai_lab_session_invalid%'
  AND (platform_ai_agent.lab_session_get_v1(:'p2_rv') #>> '{payload,answer}') = 'Да',
  'the session advances by revision; a stale revision is PT409; more than 256 KB is refused');
SELECT platform_ai_agent.lab_documents_v1(:'p2_rv', ARRAY[pg_temp.p2_id(1003), pg_temp.p2_id(1001), pg_temp.p2_id(1002)])
  AS ld \gset
SELECT pg_temp.p2_assert((SELECT array_agg(e ->> 'documentId' ORDER BY e ->> 'documentId')
    FROM jsonb_array_elements(:'ld'::JSONB -> 'documents') e) = ARRAY[pg_temp.p2_id(1002)::TEXT, pg_temp.p2_id(1003)::TEXT]
  AND (:'ld'::JSONB -> 'unavailable') = jsonb_build_array(pg_temp.p2_id(1001))
  AND (SELECT e ->> 'contentMd' = (SELECT v FROM p2_text WHERE k = '1003b') AND (e ->> 'docVersion')::INTEGER = 2
    FROM jsonb_array_elements(:'ld'::JSONB -> 'documents') e WHERE e ->> 'documentId' = pg_temp.p2_id(1003)::TEXT)
  AND (:'ld'::JSONB -> 'rules') = 'null'::JSONB
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_documents_v1(%L, %L::UUID[])', :'p2_rv',
    ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()]))
    LIKE '22023:%',
  'up to five live documents with their text and version; the superseded one is unavailable; six are refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 12. Proposals: `before` exactly once, pinned target, one per member.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p2_doc_proposal(p_before TEXT, p_after TEXT, p_version INTEGER, p_sources JSONB,
  p_question TEXT, p_sha TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object('kind', 'document', 'documentId', pg_temp.p2_id(1003), 'docVersion', p_version,
    'contentSha256', p_sha,
    'before', p_before, 'after', p_after, 'question', p_question, 'answer', 'Обучение стоит 1 300 $ в год.',
    'finding', 'Цена устарела', 'why', 'Прайс 2027 обновлён', 'sources', p_sources)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p2_doc_proposal(TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT) TO evo_ai_agent;
CREATE TEMP TABLE p2_props(label TEXT PRIMARY KEY, id UUID);
GRANT SELECT, INSERT ON p2_props TO evo_ai_agent, authenticated;
SELECT content_sha256 AS p2_sha3b FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1003) \gset
SET LOCAL ROLE evo_ai_agent;
CREATE FUNCTION pg_temp.p2_put(p_redemption UUID, p_proposal JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.p2_err(format('SELECT platform_ai_agent.lab_proposal_put_v1(%L, %L)', p_redemption, p_proposal))
$$;
SELECT pg_temp.p2_assert(pg_temp.p2_put(:'p2_rv', pg_temp.p2_doc_proposal('в год', 'ежегодно', 2, '[]', 'Сколько стоит?', :'p2_sha3b'))
    LIKE '22023:ai_lab_edit_invalid%'
  AND pg_temp.p2_put(:'p2_rv', pg_temp.p2_doc_proposal('Нет такого текста', 'x', 2, '[]', 'Сколько стоит?', :'p2_sha3b'))
    LIKE '22023:ai_lab_edit_invalid%'
  AND pg_temp.p2_put(:'p2_rv', pg_temp.p2_doc_proposal('Стоимость обучения: 1 250 $', 'x', 1, '[]', 'Сколько стоит?', :'p2_sha3b'))
    LIKE 'PT409:ai_lab_changed%'
  AND pg_temp.p2_put(:'p2_rv', pg_temp.p2_doc_proposal('Стоимость обучения: 1 250 $', 'x', 2,
    jsonb_build_array(pg_temp.p2_id(1001)), 'Сколько стоит?', :'p2_sha3b')) LIKE 'PT409:ai_lab_changed%'
  AND pg_temp.p2_put(:'p2_rv', '{"kind":"knowledge","after":"x","audience":"client","question":"q","answer":"a","finding":"f"}')
    LIKE '22023:ai_lab_invalid_proposal%'
  AND pg_temp.p2_put(:'p2_rv', '{"kind":"example","before":"x","question":"q","answer":"a","finding":"f"}')
    LIKE '22023:ai_lab_invalid_proposal%'
  AND pg_temp.p2_put(:'p2_rv', '{"kind":"rules","before":"x","after":"y","question":"q","answer":"a","finding":"f"}')
    LIKE '22023:ai_lab_invalid_proposal%',
  'a `before` found twice or not at all, a stale version, a superseded source and malformed kinds are refused');
INSERT INTO p2_props SELECT 'Pv', (platform_ai_agent.lab_proposal_put_v1(:'p2_rv', jsonb_build_object('kind', 'example',
  'question', 'Есть ли общежитие?', 'answer', 'Да, общежитие стоит 300 $ в месяц.', 'finding', 'Не назвал цену',
  'sources', jsonb_build_array(pg_temp.p2_id(1003)))) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_assert(pg_temp.p2_ticket_err(:'p2_viewer', 'lab_apply', NULL, (SELECT id FROM p2_props WHERE label = 'Pv'))
    LIKE '42501:ai_agent_forbidden%'
  AND pg_temp.p2_ticket_err(:'p2_manager', 'lab_apply', NULL, (SELECT id FROM p2_props WHERE label = 'Pv'))
    LIKE '42501:ai_lab_proposal_unavailable%',
  'ai.agent.use proposes but cannot apply; a manager cannot apply someone else''s proposal');

-- Apply of a document edit.
SELECT pg_temp.p2_redeem(:'p2_manager', 'laboratory', NULL) AS p2_rm \gset
SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm1', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', pg_temp.p2_doc_proposal(
  'Стоимость обучения: 1 250 $', 'Стоимость обучения: 1 300 $', 2,
  jsonb_build_array(pg_temp.p2_id(1003), pg_temp.p2_id(1004)), 'Сколько стоит бакалавриат?', :'p2_sha3b')) ->> 'proposalId')::UUID;
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_lab_v1(pg_temp.p2_id(1)) #>> '{proposal,status}') = 'proposed'
  AND (platform.ai_agent_lab_v1(pg_temp.p2_id(1)) #>> '{proposal,before}') = 'Стоимость обучения: 1 250 $'
  AND (platform.ai_agent_lab_v1(pg_temp.p2_id(1)) ->> 'canManage') = 'true',
  'the card «Было/Стало» with the reference answer is shown to its author');
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm1')) AS p2_ra1 \gset
INSERT INTO p2_text VALUES ('1003c', replace((SELECT v FROM p2_text WHERE k = '1003b'), 'Стоимость обучения: 1 250 $',
  'Стоимость обучения: 1 300 $'));
SELECT id AS p2_c1b FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003) AND position = 1 \gset
SELECT knowledge_version AS p2_kv_lab FROM platform_private.ai_settings WHERE organization_id = pg_temp.p2_id(1) \gset
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.lab_apply_prepare_v1(:'p2_ra1') AS prep1 \gset
SELECT pg_temp.p2_assert((:'prep1'::JSONB ->> 'newContentMd') = (SELECT v FROM p2_text WHERE k = '1003c')
  AND (:'prep1'::JSONB ->> 'baseSha256') = :'p2_sha3b' AND jsonb_array_length(:'prep1'::JSONB #> '{document,chunks}') = 3
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.search_v1(%L, ''[]'', ''["x"]'')', :'p2_ra1')) LIKE '42501:%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_session_get_v1(%L)', :'p2_ra1')) LIKE '42501:%'
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.rate_take_v1(%L)', :'p2_ra1')) LIKE '42501:%',
  'prepare returns the exact new text, the base SHA and the current chunks; an apply ticket opens nothing else');
CREATE FUNCTION pg_temp.p2_apply(p_redemption UUID, p_base TEXT, p_content TEXT, p_new JSONB, p_chunks JSONB, p_k INTEGER)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.p2_err(format('SELECT platform_ai_agent.lab_apply_v1(%L, %L, %L, %L, %L, %L)', p_redemption, p_base,
    p_content, p_new, p_chunks, pg_temp.p2_unit(p_k)))
$$;
SELECT pg_temp.p2_assert(pg_temp.p2_apply(:'p2_ra1', :'p2_sha3b', 'другой текст', NULL, jsonb_build_array(
    jsonb_build_object('position', 0, 'reuse', :p2_c0)), 7) LIKE '22023:ai_lab_edit_invalid%'
  AND pg_temp.p2_apply(:'p2_ra1', pg_temp.p2_sha('x'), (SELECT v FROM p2_text WHERE k = '1003c'), NULL,
    jsonb_build_array(jsonb_build_object('position', 0, 'reuse', :p2_c0)), 7) LIKE 'PT409:ai_lab_changed%',
  'apply refuses another text (22023) and another base SHA (PT409)');
SELECT platform_ai_agent.lab_apply_v1(:'p2_ra1', :'p2_sha3b', (SELECT v FROM p2_text WHERE k = '1003c'), NULL,
  jsonb_build_array(pg_temp.p2_chunk(0, 'Стоимость обучения: 1 300 $ в год. Оплата за год вперёд, в год один платёж.', 19, 1),
    jsonb_build_object('position', 1, 'reuse', :p2_c1b), jsonb_build_object('position', 2, 'reuse', :p2_c2)),
  pg_temp.p2_unit(7)) AS ap1 \gset
SELECT pg_temp.p2_assert((:'ap1'::JSONB ->> 'status') = 'applied' AND (:'ap1'::JSONB ->> 'docVersion')::INTEGER = 3
  AND (:'ap1'::JSONB ->> 'reused')::INTEGER = 2 AND (:'ap1'::JSONB ->> 'embedded')::INTEGER = 1
  AND (:'ap1'::JSONB ->> 'knowledgeVersion')::BIGINT = :p2_kv_lab + 1
  AND pg_temp.p2_apply(:'p2_ra1', :'p2_sha3b', (SELECT v FROM p2_text WHERE k = '1003c'), NULL,
    jsonb_build_array(jsonb_build_object('position', 0, 'reuse', :p2_c2)), 7) LIKE 'PT409:ai_lab_changed%',
  '«Применить» edits the indexed text in place in one transaction; a second apply is PT409');
RESET ROLE;
SELECT (:'ap1'::JSONB ->> 'exampleId') AS p2_e1 \gset
SELECT pg_temp.p2_assert((SELECT edited_in_lab AND doc_version = 3 AND content_md = (SELECT v FROM p2_text WHERE k = '1003c')
    AND content_sha256 = pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003c')) AND status = 'ready'
    FROM platform_private.ai_documents WHERE id = pg_temp.p2_id(1003))
  AND (SELECT count(*) = 2 FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003)
    AND id IN (:p2_c1b, :p2_c2))
  AND (SELECT status = 'applied' AND decided_by = pg_temp.p2_id(302) AND result ->> 'exampleId' = :'p2_e1'
    FROM platform_private.ai_lab_proposals WHERE id = (SELECT id FROM p2_props WHERE label = 'Pm1'))
  AND (SELECT question = 'Сколько стоит бакалавриат?' AND answer = 'Обучение стоит 1 300 $ в год.'
    AND feedback = 'Цена устарела' AND rules_version_id IS NULL AND answer_model = 'gemini-3.8-flash'
    AND source_doc_versions = jsonb_build_object(pg_temp.p2_id(1003)::TEXT, '{"v":3,"a":"client"}'::JSONB,
      pg_temp.p2_id(1004)::TEXT, '{"v":1,"a":"client"}'::JSONB)
    AND client_only AND confirmed_by = pg_temp.p2_id(302) AND question_key LIKE 'q:%'
    FROM platform_private.ai_golden_examples WHERE id = :'p2_e1')
  AND (SELECT count(*) = 1 FROM platform.audit_events e JOIN platform_private.ai_tickets t ON t.id = e.request_id
    WHERE t.id = :'p2_ra1' AND e.action = 'ai.agent.lab.apply' AND e.actor_profile_id = pg_temp.p2_id(202)
      AND e.before_state ->> 'before' = 'Стоимость обучения: 1 250 $'
      AND e.after_state ->> 'after' = 'Стоимость обучения: 1 300 $'),
  'the document is «изменён в Лаборатории», reused chunks keep their IDs, the example pins rules, model and document versions, the change is audited');
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((SELECT count(*) = 1 FROM jsonb_array_elements(platform_ai_agent.search_v1(:'p2_rm',
    jsonb_build_array(pg_temp.p2_unit(7)), '["Сколько стоит бакалавриат"]') -> 'examples') e
  WHERE e ->> 'exampleId' = :'p2_e1' AND (e ->> 'similarity')::NUMERIC > 0.99),
  'the corrected answer is found as an example in the next search');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 13. Conflict: the target moved between the proposal and «Применить».
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm2', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', pg_temp.p2_doc_proposal(
  'Общежитие: 300 $ в месяц.', 'Общежитие: 320 $ в месяц.', 3, '[]', 'Сколько стоит общежитие?',
  pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003c')))) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm2')) AS p2_ra2 \gset
-- Meanwhile a «Лист сверки» correction changes the same document.
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ic', 'reopen', NULL, 'dismissed',
    pg_temp.p2_id(3301)) #>> '{item,status}') = 'open'
  AND (platform.ai_agent_review_resolve_v1(pg_temp.p2_id(1), :'p2_ic', 'correct', '310', 'open',
    pg_temp.p2_id(3302)) #>> '{item,status}') = 'applying',
  'a dismissed item is reopened and corrected');
RESET ROLE;
INSERT INTO p2_text VALUES ('1003d', replace((SELECT v FROM p2_text WHERE k = '1003c'), 'Общежитие: 300 $', 'Общежитие: 310 $'));
SELECT id AS p2_c0c FROM platform_private.ai_chunks WHERE document_id = pg_temp.p2_id(1003) AND position = 0 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_reindex_claim_v1(pg_temp.p2_id(1003), 'r1') ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_reindex_v1(pg_temp.p2_id(1003), 'r1', pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003c')),
    (SELECT v FROM p2_text WHERE k = '1003d'), jsonb_build_array(jsonb_build_object('position', 0, 'reuse', :p2_c0c),
      jsonb_build_object('position', 1, 'reuse', :p2_c1b), pg_temp.p2_chunk(2, 'Общежитие: 310 $ в месяц.', 27, 3)),
    jsonb_build_array(:'p2_ic'), '[]') ->> 'docVersion')::INTEGER = 4,
  'the correction is reindexed: version 4');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform_ai_agent.lab_apply_prepare_v1(%L)', :'p2_ra2'))
    LIKE 'PT409:ai_lab_changed%'
  AND pg_temp.p2_apply(:'p2_ra2', pg_temp.p2_sha((SELECT v FROM p2_text WHERE k = '1003c')),
    replace((SELECT v FROM p2_text WHERE k = '1003c'), 'Общежитие: 300 $ в месяц.', 'Общежитие: 320 $ в месяц.'), NULL,
    jsonb_build_array(jsonb_build_object('position', 0, 'reuse', :p2_c0c)), 9) LIKE 'PT409:ai_lab_changed%',
  'prepare and apply of a proposal whose document moved are PT409 ai_lab_changed');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_lab_v1(pg_temp.p2_id(1)) #>> '{proposal,status}') = 'conflict',
  'the next read shows «Знания или предложение изменились» (conflict)');
RESET ROLE;
SELECT pg_temp.p2_assert(pg_temp.p2_ticket_err(:'p2_manager', 'lab_apply', NULL, (SELECT id FROM p2_props WHERE label = 'Pm2'))
  LIKE 'PT409:ai_lab_changed%', 'a conflicting proposal gets no apply ticket');

-- ---------------------------------------------------------------------------
-- 14. A new knowledge fragment, rules and an example.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm3', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'knowledge',
  'title', 'Сроки подачи', 'audience', 'client', 'after', 'Подача документов на весенний набор — до 15 января.',
  'question', 'До какого числа подать документы?', 'answer', 'Документы на весенний набор принимаются до 15 января.',
  'finding', 'Не назван срок')) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm3')) AS p2_ra3 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.lab_apply_prepare_v1(:'p2_ra3') ->> 'newContentMd')
    = 'Подача документов на весенний набор — до 15 января.'
  AND pg_temp.p2_apply(:'p2_ra3', NULL, NULL, '{"title":"Другое"}', jsonb_build_array(pg_temp.p2_chunk(0, 'x', 41)), 43)
    LIKE '22023:ai_lab_edit_invalid%',
  'the new fragment is prepared; another title is refused');
SELECT platform_ai_agent.lab_apply_v1(:'p2_ra3', NULL, 'Подача документов на весенний набор — до 15 января.',
  '{"title":"Сроки подачи","audience":"client"}', jsonb_build_array(pg_temp.p2_chunk(0,
    'Сроки подачи: подача документов на весенний набор — до 15 января.', 41)), pg_temp.p2_unit(43)) AS ap3 \gset
SELECT pg_temp.p2_assert((:'ap3'::JSONB ->> 'status') = 'applied'
  AND (:'ap3'::JSONB ->> 'documentId')::UUID = ANY (pg_temp.p2_search_docs(:'p2_rm', 41, 'весенний набор')),
  'a new knowledge fragment becomes a ready, searchable document');
RESET ROLE;
SELECT (:'ap3'::JSONB ->> 'documentId') AS p2_lab_doc \gset
SELECT (:'ap3'::JSONB ->> 'exampleId') AS p2_e3 \gset
SELECT pg_temp.p2_assert((SELECT kind = 'knowledge' AND source = 'lab' AND status = 'ready' AND audience = 'client'
    AND source_ref ->> 'proposalId' = (SELECT id FROM p2_props WHERE label = 'Pm3')::TEXT AND doc_version = 1
    AND content_sha256 = pg_temp.p2_sha(content_md) AND NOT edited_in_lab
  FROM platform_private.ai_documents WHERE id = :'p2_lab_doc'), 'the fragment is a source lab knowledge document');

SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm4', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'rules',
  'after', 'Говорите вежливо. Цену называйте в долларах.', 'question', 'Как вы называете цену?',
  'answer', 'Цену называем в долларах США.', 'finding', 'Цена без валюты')) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm4')) AS p2_ra4 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT platform_ai_agent.lab_apply_v1(:'p2_ra4', NULL, NULL, NULL, NULL, pg_temp.p2_unit(45)) AS ap4 \gset
RESET ROLE;
SELECT (:'ap4'::JSONB ->> 'rulesVersionId') AS p2_r1 \gset
SELECT (:'ap4'::JSONB ->> 'exampleId') AS p2_e4 \gset
SELECT pg_temp.p2_assert((SELECT s.rules_version_id::TEXT = :'p2_r1' FROM platform_private.ai_settings s
    WHERE s.organization_id = pg_temp.p2_id(1))
  AND (SELECT r.source = 'lab' AND r.confirmed_by = pg_temp.p2_id(302) AND r.confirmed_at IS NOT NULL AND r.version = 1
    AND r.body = 'Говорите вежливо. Цену называйте в долларах.' FROM platform_private.ai_rules_versions r WHERE r.id = :'p2_r1')
  AND (SELECT rules_version_id::TEXT = :'p2_r1' AND source_doc_versions = '{}'::JSONB
    FROM platform_private.ai_golden_examples WHERE id = :'p2_e4'),
  'a rules change becomes a new confirmed current version; its example pins it');
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_rules_v1(pg_temp.p2_id(1)) #>> '{current,needsReview}') = 'false',
  'the rules page shows the Laboratory version as checked');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_put(:'p2_rm', jsonb_build_object('kind', 'rules', 'rulesVersionId', :'p2_r1',
    'before', 'грубо', 'after', 'мягко', 'question', 'q', 'answer', 'a', 'finding', 'f')) LIKE '22023:ai_lab_edit_invalid%'
  AND pg_temp.p2_put(:'p2_rm', jsonb_build_object('kind', 'rules', 'before', 'вежливо', 'after', 'мягко',
    'question', 'q', 'answer', 'a', 'finding', 'f')) LIKE '22023:ai_lab_invalid_proposal%'
  AND pg_temp.p2_put(:'p2_rm', jsonb_build_object('kind', 'rules', 'after', 'мягко', 'question', 'q', 'answer', 'a',
    'finding', 'f')) LIKE 'PT409:ai_lab_changed%',
  'a rules edit needs a `before` of the current version, pinned to it');
INSERT INTO p2_props SELECT 'Pm5', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'rules',
  'rulesVersionId', :'p2_r1', 'before', 'Говорите вежливо.', 'after', 'Говорите вежливо и кратко.',
  'question', 'Как отвечать?', 'answer', 'Коротко и вежливо.', 'finding', 'Слишком длинно')) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm5')) AS p2_ra5 \gset
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_rules_save_v1(pg_temp.p2_id(1), 'Говорите вежливо. Цену называйте в долларах США.',
  1, pg_temp.p2_id(3401)) ->> 'version')::INTEGER = 2, 'meanwhile the rules are saved by hand (version 2)');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_apply(:'p2_ra5', NULL, NULL, NULL, NULL, 49) LIKE 'PT409:ai_lab_changed%',
  'the rules proposal pinned to version 1 is PT409');
RESET ROLE;
SELECT current_setting('request.jwt.claims') IS NOT NULL AS p2_noop \gset

SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm6', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'example',
  'question', 'Есть ли рассрочка?', 'answer', 'Да, оплату можно разделить на два платежа.', 'finding', 'Не сказал о рассрочке',
  'sources', jsonb_build_array(pg_temp.p2_id(1004)))) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_redeem(:'p2_manager', 'lab_apply', (SELECT id FROM p2_props WHERE label = 'Pm6')) AS p2_ra6 \gset
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(pg_temp.p2_apply(:'p2_ra6', NULL, 'текст', NULL, NULL, 47) LIKE '22023:ai_lab_edit_invalid%',
  'an example carries no text');
SELECT platform_ai_agent.lab_apply_v1(:'p2_ra6', NULL, NULL, NULL, NULL, pg_temp.p2_unit(47)) AS ap6 \gset
RESET ROLE;
SELECT (:'ap6'::JSONB ->> 'exampleId') AS p2_e6 \gset

-- One proposal per member; «Не менять»; immutable content.
SET LOCAL ROLE evo_ai_agent;
INSERT INTO p2_props SELECT 'Pm7', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'example',
  'question', 'Q7', 'answer', 'A7', 'finding', 'F7')) ->> 'proposalId')::UUID;
INSERT INTO p2_props SELECT 'Pm8', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'example',
  'question', 'Q8', 'answer', 'A8', 'finding', 'F8')) ->> 'proposalId')::UUID;
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT status = 'expired' FROM platform_private.ai_lab_proposals
    WHERE id = (SELECT id FROM p2_props WHERE label = 'Pm7'))
  AND (SELECT count(*) = 1 FROM platform_private.ai_lab_proposals WHERE organization_id = pg_temp.p2_id(1)
    AND membership_id = pg_temp.p2_id(302) AND status = 'proposed'),
  'a new proposal expires the previous one: one proposed per member');
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('UPDATE platform_private.ai_lab_proposals SET after_text = ''x'' WHERE id = %L',
    (SELECT id FROM p2_props WHERE label = 'Pm8'))) LIKE '55000:ai_lab_proposal_immutable%'
  AND pg_temp.p2_err(format('UPDATE platform_private.ai_lab_proposals SET status = ''proposed'', decided_at = NULL WHERE id = %L',
    (SELECT id FROM p2_props WHERE label = 'Pm1'))) LIKE '55000:ai_lab_proposal_immutable%',
  'the proposal text is immutable and a decision is final');
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_lab_reject_v1(%L, %L, %L)', pg_temp.p2_id(1),
    (SELECT id FROM p2_props WHERE label = 'Pm8'), pg_temp.p2_id(3501))) LIKE 'P0002:ai_lab_proposal_unavailable%',
  'nobody rejects someone else''s proposal');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_lab_reject_v1(pg_temp.p2_id(1), (SELECT id FROM p2_props WHERE label = 'Pm8'),
    pg_temp.p2_id(3502)) ->> 'status') = 'rejected'
  AND (platform.ai_agent_lab_reject_v1(pg_temp.p2_id(1), (SELECT id FROM p2_props WHERE label = 'Pm8'),
    pg_temp.p2_id(3502)) ->> 'replayed') = 'true'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_lab_reject_v1(%L, %L, %L)', pg_temp.p2_id(1),
    (SELECT id FROM p2_props WHERE label = 'Pm8'), pg_temp.p2_id(3503))) LIKE 'PT409:ai_lab_changed%',
  '«Не менять» rejects once; the request replays; a second decision is PT409');
RESET ROLE;
SELECT pg_temp.p2_assert(pg_temp.p2_ticket_err(:'p2_manager', 'lab_apply', NULL, (SELECT id FROM p2_props WHERE label = 'Pm8'))
  LIKE 'PT409:ai_lab_changed%', 'a rejected proposal gets no apply ticket');

-- ---------------------------------------------------------------------------
-- 15. Examples are valid only while rules, model and document versions match.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_examples_v1(pg_temp.p2_id(1)) AS ex1 \gset
RESET ROLE;
CREATE FUNCTION pg_temp.p2_example(p_list JSONB, p_id TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT e FROM jsonb_array_elements(p_list -> 'items') e WHERE e ->> 'id' = p_id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p2_example(JSONB, TEXT) TO authenticated;
SELECT pg_temp.p2_assert(jsonb_array_length(:'ex1'::JSONB -> 'items') = 4
  AND (pg_temp.p2_example(:'ex1', :'p2_e1') -> 'stale') = jsonb_build_object('legacy', FALSE, 'rules', TRUE, 'model', FALSE,
    'documents', jsonb_build_array(pg_temp.p2_id(1003)))
  AND (pg_temp.p2_example(:'ex1', :'p2_e3') #>> '{stale,rules}') = 'true'
  AND (pg_temp.p2_example(:'ex1', :'p2_e3') #>> '{stale,documents}') = '[]'
  AND (pg_temp.p2_example(:'ex1', :'p2_e4') #>> '{stale,rules}') = 'true'
  AND (pg_temp.p2_example(:'ex1', :'p2_e6') ->> 'valid') = 'true'
  AND (SELECT bool_and((s ->> 'live')::BOOLEAN) AND bool_or(s ->> 'title' = 'Условия 2027 (скан)'
      AND (s ->> 'docVersion')::INTEGER = 3 AND (s ->> 'currentVersion')::INTEGER = 4)
    FROM jsonb_array_elements(pg_temp.p2_example(:'ex1', :'p2_e1') -> 'sources') s)
  AND (:'ex1'::JSONB ->> 'canManage') = 'false',
  'the list shows why each example stopped: a changed document, a new rules version; the latest one is valid');
-- An unrelated upload no longer stales the examples (269 filtered by knowledge_version).
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((pg_temp.p2_call(pg_temp.p2_upload(1, 1007, 'Общежития', 'csv', 'text/csv', 'client', TRUE, TRUE,
  3107)) ->> 'status') = 'queued', 'another document is uploaded');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.document_claim_v1(pg_temp.p2_id(1007), 'w1') ->> 'claimed')::BOOLEAN
  AND (platform_ai_agent.document_index_v1(pg_temp.p2_id(1007), 'w1', jsonb_build_array(pg_temp.p2_chunk(0,
    'Общежития: 4 корпуса', 51))) ->> 'status') = 'ready'
  AND (SELECT count(*) = 1 FROM jsonb_array_elements(platform_ai_agent.search_v1(:'p2_rm',
    jsonb_build_array(pg_temp.p2_unit(47)), '["рассрочка"]') -> 'examples') e WHERE e ->> 'exampleId' = :'p2_e6'),
  'after an unrelated upload (knowledge version +1) the example is still found');
SELECT pg_temp.p2_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(platform_ai_agent.search_v1(:'p2_rm',
    jsonb_build_array(pg_temp.p2_unit(7)), '["Сколько стоит бакалавриат"]') -> 'examples') e WHERE e ->> 'exampleId' = :'p2_e1'),
  'the example whose document changed is no longer used');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_settings_save_v1(pg_temp.p2_id(1), (platform.ai_agent_settings_v1(pg_temp.p2_id(1))
  ->> 'version')::BIGINT, '{"answerModel":"gemini-3.5-flash-lite"}', pg_temp.p2_id(3601)) ->> 'status') = 'applied',
  'the answer model changes');
SELECT pg_temp.p2_assert((pg_temp.p2_example(platform.ai_agent_examples_v1(pg_temp.p2_id(1)), :'p2_e6') #>> '{stale,model}') = 'true'
  AND jsonb_array_length(platform.ai_agent_examples_v1(pg_temp.p2_id(1), '{"valid":true}') -> 'items') = 0,
  'a model change stales every example');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert(jsonb_array_length(platform_ai_agent.search_v1(:'p2_rm', jsonb_build_array(pg_temp.p2_unit(47)),
  '["рассрочка"]') -> 'examples') = 0, 'and search uses none of them');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_settings_save_v1(pg_temp.p2_id(1), (platform.ai_agent_settings_v1(pg_temp.p2_id(1))
  ->> 'version')::BIGINT, '{"answerModel":"gemini-3.8-flash"}', pg_temp.p2_id(3602)) ->> 'status') = 'applied',
  'the model is restored');
SELECT pg_temp.p2_assert((SELECT array_agg(e ->> 'id') FROM jsonb_array_elements(platform.ai_agent_examples_v1(pg_temp.p2_id(1),
    '{"valid":true}') -> 'items') e) = ARRAY[:'p2_e6']
  AND jsonb_array_length(platform.ai_agent_examples_v1(pg_temp.p2_id(1), '{"valid":false,"limit":2}') -> 'items') = 2
  AND (platform.ai_agent_examples_v1(pg_temp.p2_id(1), '{"valid":false,"limit":2}') ->> 'hasMore') = 'true',
  'the same three facts make the example valid again; the list filters and pages');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert(pg_temp.p2_err(format('SELECT platform.ai_agent_example_delete_v1(%L, %L, %L)', pg_temp.p2_id(1),
  :'p2_e1', pg_temp.p2_id(3701))) LIKE '42501:ai_agent_forbidden%', 'ai.agent.use cannot delete an example');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p2_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_example_delete_v1(pg_temp.p2_id(1), :'p2_e1', pg_temp.p2_id(3702)) ->> 'status')
    = 'deleted'
  AND pg_temp.p2_err(format('SELECT platform.ai_agent_example_delete_v1(%L, %L, %L)', pg_temp.p2_id(1), :'p2_e1',
    pg_temp.p2_id(3703))) LIKE 'P0002:ai_example_not_found%',
  'the manager deletes an example once');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT count(*) = 1 FROM platform.audit_events WHERE request_id = pg_temp.p2_id(3702)
  AND action = 'ai.agent.example.delete' AND before_state ->> 'question' = 'Сколько стоит бакалавриат?'),
  'the deletion is audited with the question');

-- ---------------------------------------------------------------------------
-- 16. «Начать заново» and maintenance.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'p2_viewer';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p2_assert((platform.ai_agent_lab_v1(pg_temp.p2_id(1)) #>> '{session,revision}') = '2'
  AND (platform.ai_agent_lab_v1(pg_temp.p2_id(1)) #>> '{proposal,kind}') = 'example', 'the viewer''s check is still open');
SELECT pg_temp.p2_assert(platform.ai_agent_lab_discard_v1(pg_temp.p2_id(1)) = '{"discarded": true, "sessions": 1, "proposals": 1}'::JSONB
  AND (platform.ai_agent_lab_v1(pg_temp.p2_id(1)) -> 'session') = 'null'::JSONB,
  '«Начать заново» removes the session and expires the open proposal');
RESET ROLE;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.lab_session_put_v1(:'p2_rm', 0, '{"q":"x"}') ->> 'revision')::INTEGER = 1,
  'the manager has a session');
INSERT INTO p2_props SELECT 'Pm9', (platform_ai_agent.lab_proposal_put_v1(:'p2_rm', jsonb_build_object('kind', 'example',
  'question', 'Q9', 'answer', 'A9', 'finding', 'F9')) ->> 'proposalId')::UUID;
RESET ROLE;
-- Two and a half hours later (clocks moved back on the rows as the table owner).
SET LOCAL session_replication_role = replica;
UPDATE platform_private.ai_lab_sessions SET updated_at = clock_timestamp() - INTERVAL '3 hours',
  created_at = clock_timestamp() - INTERVAL '3 hours', expires_at = clock_timestamp() - INTERVAL '1 hour'
  WHERE organization_id = pg_temp.p2_id(1) AND membership_id = pg_temp.p2_id(302);
UPDATE platform_private.ai_lab_proposals SET created_at = clock_timestamp() - INTERVAL '3 hours',
  expires_at = clock_timestamp() - INTERVAL '1 hour' WHERE id = (SELECT id FROM p2_props WHERE label = 'Pm9');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE evo_ai_agent;
SELECT pg_temp.p2_assert((platform_ai_agent.lab_session_get_v1(:'p2_rm') ->> 'revision')::INTEGER = 0
  AND pg_temp.p2_err(format('SELECT platform_ai_agent.lab_session_put_v1(%L, 1, ''{}'')', :'p2_rm'))
    LIKE 'PT409:ai_lab_session_changed%',
  'an expired session reads as revision 0');
SELECT platform_ai_agent.maintenance_v1() AS mnt \gset
SELECT pg_temp.p2_assert((:'mnt'::JSONB ->> 'labSessions')::INTEGER >= 1 AND (:'mnt'::JSONB ->> 'labProposalsExpired')::INTEGER >= 1,
  'maintenance removes expired sessions and expires stale proposals');
RESET ROLE;
SELECT pg_temp.p2_assert((SELECT status = 'expired' AND decided_at IS NOT NULL FROM platform_private.ai_lab_proposals
    WHERE id = (SELECT id FROM p2_props WHERE label = 'Pm9'))
  AND NOT EXISTS (SELECT 1 FROM platform_private.ai_lab_sessions WHERE organization_id = pg_temp.p2_id(1)
    AND membership_id = pg_temp.p2_id(302)),
  'the expired proposal and session are gone from the open work');

SELECT 'AI273_AI_AGENT_P2_SUITE_PASSED' AS ai273_suite_marker;

ROLLBACK;
