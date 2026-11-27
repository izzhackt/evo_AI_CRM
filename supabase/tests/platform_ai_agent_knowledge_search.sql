\set ON_ERROR_STOP on
-- Boundary suite for migration 384: «ИИ-агенты» — search_knowledge по русскому, simple и вектору (docs/PLAN_CHANGES.md,
-- ночь 28.11.2026, «мозг компании»).
-- Runs on the real chain right after 384 inside one transaction that is rolled back, with its own synthetic organization,
-- synthetic texts and synthetic unit vectors. No provider, no embedding call, no Claude / Anthropic call, no real person.
--
-- Proves:
--  1. posture: the old three-argument function is gone, the four-argument one has one default, is SECURITY DEFINER with an
--     empty search_path and runs for service_role only; the tool family is still 24; the helper is closed to every role;
--     `fts_simple` is a generated column with its GIN index; the old three-argument call still works;
--  2. Russian query: the same fragment first as before, match = fts_ru, with and without a query vector;
--  3. Kyrgyz and English questions (words the Russian AND-query cannot match) find their fragment through `simple`;
--     a CRM wiki page is found the same way;
--  4. nothing leaks: a draft or superseded document, the raw wiki area, a deleted page, another organization, and the
--     internal audience for a client-only search never come out - by text and by vector;
--  5. the query vector: the nearest fragment comes out with match = vector for a query no word of which is in any
--     text; a vector orthogonal to everything (below the similarity threshold) adds nothing; a vector of the wrong
--     length is refused (22023); the wiki (no vectors) is unaffected.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

\echo A384_AI_AGENT_KNOWLEDGE_SEARCH_SUITE_START

CREATE FUNCTION pg_temp.a384_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('38400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.a384_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'A384: %', message; END IF;
END
$$;
-- The JSONB result of a statement run as a role with the given JWT claims, or {"error": SQLSTATE, "message": ...}.
CREATE FUNCTION pg_temp.a384_call(p_role TEXT, p_claims TEXT, p_sql TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.a384_svc(p_sql TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a384_call('service_role', '{"role":"service_role"}', p_sql)
$$;
-- A unit vector of 1536 numbers: 1 at the place i, 0 elsewhere (two different places are orthogonal: similarity 0).
CREATE FUNCTION pg_temp.a384_vec(p_i INTEGER, p_dims INTEGER DEFAULT 1536) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT '[' || string_agg(CASE WHEN g = p_i THEN '1' ELSE '0' END, ',' ORDER BY g) || ']' FROM generate_series(1, p_dims) g
$$;
-- search_knowledge as the service: agent key, args JSON text, organization number, optional query vector (place or NULL).
CREATE FUNCTION pg_temp.a384_search(p_args TEXT, p_vec INTEGER DEFAULT NULL, p_org INTEGER DEFAULT 1) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT pg_temp.a384_svc(CASE WHEN p_vec IS NULL
    THEN format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', %L::jsonb)', pg_temp.a384_id(p_org), p_args)
    ELSE format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', %L::jsonb, %L::public.halfvec)', pg_temp.a384_id(p_org), p_args, pg_temp.a384_vec(p_vec)) END)
$$;
-- Titles of the results, in order, joined by ' | ' ('' for none; the error code when the call failed).
CREATE FUNCTION pg_temp.a384_titles(p_result JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT CASE WHEN p_result ? 'error' THEN 'ERROR ' || (p_result ->> 'error')
    ELSE COALESCE((SELECT string_agg(e ->> 'document_title', ' | ' ORDER BY o) FROM jsonb_array_elements(p_result -> 'results') WITH ORDINALITY t(e, o)), '') END
$$;
CREATE FUNCTION pg_temp.a384_matches(p_result JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT COALESCE((SELECT string_agg(e ->> 'match', ',' ORDER BY o) FROM jsonb_array_elements(p_result -> 'results') WITH ORDINALITY t(e, o)), '')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.a384_id(INTEGER) TO authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixture: two organizations, the sales agent of organization 1 is on.
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name, status) VALUES
  (pg_temp.a384_id(1), 'A384 Fictional organization', 'active'),
  (pg_temp.a384_id(2), 'A384 Other fictional organization', 'active');
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a384_id(1));
SELECT platform_private.ai_agents_ensure_rows(pg_temp.a384_id(2));
SET LOCAL session_replication_role = replica;
UPDATE platform_private.ai_agents SET enabled = TRUE WHERE key = 'sales' AND organization_id IN (pg_temp.a384_id(1), pg_temp.a384_id(2));

INSERT INTO platform_private.ai_documents (id, organization_id, title, kind, audience, status, source) VALUES
  (pg_temp.a384_id(1301), pg_temp.a384_id(1), 'Цены Китай', 'knowledge', 'client', 'ready', 'seed_kb'),
  (pg_temp.a384_id(1302), pg_temp.a384_id(1), 'Жатакана КР', 'knowledge', 'client', 'ready', 'seed_kb'),
  (pg_temp.a384_id(1303), pg_temp.a384_id(1), 'Dormitory EN', 'knowledge', 'client', 'ready', 'seed_kb'),
  (pg_temp.a384_id(1304), pg_temp.a384_id(1), 'Внутренний регламент', 'text', 'internal', 'ready', 'upload'),
  (pg_temp.a384_id(1305), pg_temp.a384_id(1), 'Черновик общежития', 'text', 'client', 'review', 'upload'),
  (pg_temp.a384_id(1306), pg_temp.a384_id(1), 'Старое общежитие', 'text', 'client', 'superseded', 'upload'),
  (pg_temp.a384_id(1307), pg_temp.a384_id(2), 'Dormitory other org', 'knowledge', 'client', 'ready', 'seed_kb');
-- Unit vectors: Китай 1, жатакана 2, dormitory 3, регламент 4, черновик 5, старое 6, чужая организация 7.
INSERT INTO platform_private.ai_chunks (organization_id, document_id, position, section_path, content, context, lang, embedding) VALUES
  (pg_temp.a384_id(1), pg_temp.a384_id(1301), 1, 'Китай / Стоимость', 'Стоимость обучения в Китае начинается от трёх тысяч долларов в год', '', 'ru', pg_temp.a384_vec(1)::public.halfvec),
  (pg_temp.a384_id(1), pg_temp.a384_id(1302), 1, 'Кыргызстан / Жатакана', 'Жатакана акысы айына эки жүз доллар түзөт, төлөм ар айдын башында', '', 'ky', pg_temp.a384_vec(2)::public.halfvec),
  (pg_temp.a384_id(1), pg_temp.a384_id(1303), 1, 'Dormitory', 'The dormitory fee is two hundred dollars per month for international students', '', 'en', pg_temp.a384_vec(3)::public.halfvec),
  (pg_temp.a384_id(1), pg_temp.a384_id(1304), 1, 'Регламент', 'Внутренний регламент куратора: проверять паспорт студента перед подачей', '', 'ru', pg_temp.a384_vec(4)::public.halfvec),
  (pg_temp.a384_id(1), pg_temp.a384_id(1305), 1, 'Черновик', 'Draft dormitory fee is one dollar and the dormitory is free', '', 'en', pg_temp.a384_vec(5)::public.halfvec),
  (pg_temp.a384_id(1), pg_temp.a384_id(1306), 1, 'Старое', 'Old dormitory fee was one thousand dollars per month', '', 'en', pg_temp.a384_vec(6)::public.halfvec),
  (pg_temp.a384_id(2), pg_temp.a384_id(1307), 1, 'Other', 'Other organization dormitory fee is five hundred dollars per month', '', 'en', pg_temp.a384_vec(7)::public.halfvec);
INSERT INTO platform_private.kb_nodes (id, organization_id, area, kind, title, body, updated_by, deleted_at) VALUES
  (pg_temp.a384_id(1311), pg_temp.a384_id(1), 'clients', 'page', 'Visa guide', 'Invitation letter and passport copy are needed for the student visa application', pg_temp.a384_id(9), NULL),
  (pg_temp.a384_id(1312), pg_temp.a384_id(1), 'raw', 'page', 'Raw archive', 'Raw export mentions the invitation letter and the passport copy', pg_temp.a384_id(9), NULL),
  (pg_temp.a384_id(1313), pg_temp.a384_id(1), 'internal', 'page', 'Deleted page', 'Deleted page about invitation letter and passport copy', pg_temp.a384_id(9), clock_timestamp()),
  (pg_temp.a384_id(1314), pg_temp.a384_id(1), 'internal', 'page', 'Порядок звонков', 'Звонить клиенту нужно в течение часа после заявки', pg_temp.a384_id(9), NULL);
INSERT INTO platform_private.kb_nodes (id, organization_id, area, kind, title, body, updated_by) VALUES
  (pg_temp.a384_id(1315), pg_temp.a384_id(1), 'secrets', 'secret', 'Secret about dormitory invitation passport', '', pg_temp.a384_id(9));
SET LOCAL session_replication_role = origin;
SELECT pg_temp.a384_assert((SELECT count(*) = 6 FROM platform_private.ai_chunks c WHERE c.organization_id = pg_temp.a384_id(1)
    AND c.fts_simple IS NOT NULL AND c.embedding IS NOT NULL),
  'fixture: six chunks of organization 1 with the simple vector and an embedding');

-- ---------------------------------------------------------------------------
-- 1. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a384_assert(
  to_regprocedure('platform.ai_agent_tool_search_knowledge_v1(uuid,text,jsonb)') IS NULL
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'ai_agent_tool_search_knowledge_v1'
      AND p.pronargs = 4 AND p.pronargdefaults = 1 AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND p.proargtypes::TEXT = concat_ws(' ', 'uuid'::REGTYPE::OID, 'text'::REGTYPE::OID, 'jsonb'::REGTYPE::OID, 'public.halfvec'::REGTYPE::OID)
      AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 24 FROM pg_proc p WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname LIKE 'ai\_agent\_tool\_%'
      AND p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 1 FROM pg_proc p WHERE p.pronamespace = 'platform_private'::REGNAMESPACE AND p.proname = 'ai_agent_search_any_word_query'
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
  AND (SELECT a.attgenerated = 's' FROM pg_attribute a WHERE a.attrelid = 'platform_private.ai_chunks'::REGCLASS AND a.attname = 'fts_simple')
  AND (SELECT count(*) = 1 FROM pg_indexes i WHERE i.schemaname = 'platform_private' AND i.tablename = 'ai_chunks'
      AND i.indexname = 'ai_chunks_fts_simple_gin' AND i.indexdef LIKE '%USING gin (fts_simple)%'),
  '384 posture: one four-argument search_knowledge (one default) for service_role only, 24 tools, a closed helper, the generated fts_simple with its GIN index');

-- ---------------------------------------------------------------------------
-- 2. The Russian query keeps its first result (same fragment first as before 384), with and without a vector.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a384_search('{"query":"стоимость обучения в Китае"}') AS a384_ru \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_ru'::JSONB) = 'Цены Китай' AND pg_temp.a384_matches(:'a384_ru'::JSONB) = 'fts_ru'
  AND (:'a384_ru'::JSONB) -> 'results' -> 0 ->> 'source' = 'agent_kb' AND (:'a384_ru'::JSONB) -> 'results' -> 0 ->> 'audience' = 'client'
  AND (:'a384_ru'::JSONB) -> 'results' -> 0 ->> 'approved_for_clients' = 'true'
  AND (:'a384_ru'::JSONB) -> 'results' -> 0 ->> 'section_path' = 'Китай / Стоимость'
  AND (:'a384_ru'::JSONB) -> 'results' -> 0 ->> 'text' LIKE 'Стоимость обучения в Китае%',
  'a Russian question: the same fragment, the same fields, match = fts_ru');
SELECT pg_temp.a384_search('{"query":"стоимость обучения в Китае"}', 2) AS a384_ru_v \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_ru_v'::JSONB) LIKE 'Цены Китай%' AND pg_temp.a384_matches(:'a384_ru_v'::JSONB) LIKE 'fts_ru%'
  AND (:'a384_ru_v'::JSONB) -> 'results' -> 0 ->> 'document_title' = 'Цены Китай',
  'a Russian question with a query vector of another fragment: the Russian hit is still first');
SELECT pg_temp.a384_assert(
  pg_temp.a384_titles(pg_temp.a384_svc(format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', %L::jsonb)', pg_temp.a384_id(1), '{"query":"регламент куратора"}')))
    = 'Внутренний регламент'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"регламент куратора","audience":"client"}')) = ''
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"регламент куратора","audience":"internal"}')) = 'Внутренний регламент'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"звонить клиенту час","audience":"internal"}')) = 'Порядок звонков'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"звонить клиенту час","audience":"client"}')) = '',
  'the three-argument call still works; the audience filter holds on the Russian path (fragments and wiki)');

-- ---------------------------------------------------------------------------
-- 3. Kyrgyz and English questions: found by `simple` (the Russian AND-query cannot match them).
-- ---------------------------------------------------------------------------
SELECT pg_temp.a384_search('{"query":"Жатакана үчүн канча акча төлөйм?"}') AS a384_ky \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_ky'::JSONB) = 'Жатакана КР' AND pg_temp.a384_matches(:'a384_ky'::JSONB) = 'fts_simple'
  AND (:'a384_ky'::JSONB) -> 'results' -> 0 ->> 'approved_for_clients' = 'true',
  'a Kyrgyz question finds the Kyrgyz fragment (fts_simple)');
SELECT pg_temp.a384_search('{"query":"How much is the dormitory fee in Bishkek?"}') AS a384_en \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_en'::JSONB) = 'Dormitory EN' AND pg_temp.a384_matches(:'a384_en'::JSONB) = 'fts_simple',
  'an English question finds the English fragment and not the draft, the superseded text, or the other organization (fts_simple)');
SELECT pg_temp.a384_search('{"query":"invitation passport requirements"}') AS a384_wiki \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_wiki'::JSONB) = 'Visa guide' AND pg_temp.a384_matches(:'a384_wiki'::JSONB) = 'fts_simple'
  AND (:'a384_wiki'::JSONB) -> 'results' -> 0 ->> 'source' = 'crm_kb' AND (:'a384_wiki'::JSONB) -> 'results' -> 0 ->> 'audience' = 'client'
  AND (:'a384_wiki'::JSONB) -> 'results' -> 0 ->> 'approved_for_clients' = 'true' AND (:'a384_wiki'::JSONB) -> 'results' -> 0 ->> 'section_path' = 'clients',
  'an English question finds the client wiki page (crm_kb); the raw area, the deleted page and the secret never');
SELECT pg_temp.a384_assert(
  pg_temp.a384_titles(pg_temp.a384_search('{"query":"the and for with"}')) = ''
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq yyyxxx"}')) = ''
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"dormitory fee","limit":1}')) = 'Dormitory EN'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"Жатакана","audience":"internal"}')) = ''
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"dormitory fee month"}', NULL, 2)) = 'Dormitory other org',
  'only service words find nothing; unknown words find nothing; the limit works; the audience filter and the organization boundary hold on the simple path');

-- ---------------------------------------------------------------------------
-- 4. Nothing leaks, by text and by vector.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a384_assert(
  NOT (pg_temp.a384_search('{"query":"dormitory fee free draft old thousand"}')::TEXT ~ 'Черновик|Старое|Other|Secret')
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 5)) = ''       -- the draft's own vector
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 6)) = ''       -- the superseded document's own vector
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 7)) = ''       -- the other organization's own vector
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq","audience":"client"}', 4)) = ''  -- an internal fragment by vector, client audience
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq","audience":"internal"}', 4)) = 'Внутренний регламент'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 4)) = 'Внутренний регламент'
  AND NOT (pg_temp.a384_search('{"query":"passport invitation dormitory","limit":10}', 3)::TEXT ~ 'Raw archive|Deleted page|Secret|Черновик|Старое|Other'),
  'a draft, a superseded document, another organization, the raw area, a deleted page and the secrets never come out; the audience filter holds by vector');

-- ---------------------------------------------------------------------------
-- 5. The query vector.
-- ---------------------------------------------------------------------------
SELECT pg_temp.a384_search('{"query":"zzzqqq"}', 3) AS a384_vec3 \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_vec3'::JSONB) = 'Dormitory EN' AND pg_temp.a384_matches(:'a384_vec3'::JSONB) = 'vector'
  AND (:'a384_vec3'::JSONB) -> 'results' -> 0 ->> 'section_path' = 'Dormitory'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 2)) = 'Жатакана КР'
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 1)) = 'Цены Китай',
  'with a query vector the nearest fragment comes out (match = vector) though no word of the query is in any text');
SELECT pg_temp.a384_assert(pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}', 100)) = ''
  AND pg_temp.a384_titles(pg_temp.a384_search('{"query":"zzzqqq"}')) = '',
  'a vector similar to nothing (below the 0.55 threshold) and no vector at all add nothing');
-- A text hit and a vector hit of different fragments: both come out, the text hit first (weight 2 against 1, equal places).
SELECT pg_temp.a384_search('{"query":"жатакана"}', 3) AS a384_mix \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_mix'::JSONB) = 'Жатакана КР | Dormitory EN'
  AND pg_temp.a384_matches(:'a384_mix'::JSONB) ~ '^fts_(ru|simple),vector$',
  'a text hit and a vector hit of different fragments are merged: the text hit first, the vector hit after it');
-- The same fragment found by text and by vector is returned once.
SELECT pg_temp.a384_search('{"query":"dormitory fee"}', 3) AS a384_dup \gset
SELECT pg_temp.a384_assert(pg_temp.a384_titles(:'a384_dup'::JSONB) = 'Dormitory EN' AND jsonb_array_length((:'a384_dup'::JSONB) -> 'results') = 1,
  'the same fragment from the text and the vector search is returned once');
-- A vector of the wrong length is refused as invalid arguments; so is a bad query argument as before.
SELECT pg_temp.a384_assert(
  pg_temp.a384_svc(format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', ''{"query":"zzzqqq"}''::jsonb, %L::public.halfvec)',
    pg_temp.a384_id(1), pg_temp.a384_vec(3, 8))) ->> 'error' = '22023'
  AND pg_temp.a384_svc(format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', ''{"query":"аб","limit":11}''::jsonb)', pg_temp.a384_id(1))) ->> 'error' = '22023'
  AND pg_temp.a384_svc(format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', ''{"query":"аб","vec":[1]}''::jsonb)', pg_temp.a384_id(1))) ->> 'error' = '22023',
  'a vector of the wrong length is 22023; the tool schema still refuses unknown keys and out-of-range limits');
-- Nobody but the service can search.
SELECT pg_temp.a384_assert(
  pg_temp.a384_call('authenticated', '{"role":"authenticated"}', format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', ''{"query":"dormitory"}''::jsonb)', pg_temp.a384_id(1))) ->> 'error' = '42501'
  AND pg_temp.a384_call('anon', '{"role":"anon"}', format('SELECT platform.ai_agent_tool_search_knowledge_v1(%L, ''sales'', ''{"query":"dormitory"}''::jsonb, NULL)', pg_temp.a384_id(1))) ->> 'error' = '42501',
  'authenticated and anon cannot call the search');

\echo A384_AI_AGENT_KNOWLEDGE_SEARCH_SUITE_PASSED
ROLLBACK;
