\set ON_ERROR_STOP on
-- Boundary suite for migration 270 («ИИ-агент» P1, срез 5: источники
-- сохранённого ответа — из базы). Runs on the LATEST chain inside one
-- transaction that is rolled back, with its own synthetic organizations; no
-- provider, Gemini call, real person or production action. The conversation
-- comes from the REAL WAHA projection chain; documents, chunks and the stored
-- answer are written as the table owner (the agent's write path is proven by
-- supabase/tests/platform_ai_agent_p1.sql).
--
-- Proves:
--  1. platform.ai_agent_answer_current_v1 keeps its signature, definer,
--     empty search_path and EXECUTE for authenticated only; the staff
--     inventory is still the 15 functions of 269; the new private helper is
--     executable by no API role and not by the agent;
--  2. a stored answer whose agent JSON carries a forged quote, title and
--     audience is shown with the database text of its chunk, its document's
--     title and audience, pages and section, `live` true, in the agent's
--     order and numbering; the rest of the result (reply, reason, question,
--     citations, warnings) is unchanged;
--  3. an open «Лист сверки» item on the chunk's page marks the source
--     `unverified` and lists only the values that occur in the quote;
--  4. a superseded document is `live` false; a deleted document leaves the row
--     `missing` with no quote and no title; a chunk of ANOTHER organization or
--     a malformed chunk id is `missing` too — no foreign text is returned;
--  5. the access checks of 269 are unchanged: a member without ai.agent.use,
--     a Student, another organization's Admin and anon are refused.
BEGIN;

DO $ai270_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$ai270_auth_role$;

CREATE FUNCTION pg_temp.s_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.s_wid(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('27000000-0000-4000-9000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.s_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'AI270: %', message; END IF;
END
$$;
CREATE FUNCTION pg_temp.s_err(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s_id(INTEGER), pg_temp.s_wid(INTEGER), pg_temp.s_assert(BOOLEAN, TEXT),
  pg_temp.s_err(TEXT) TO authenticated, anon;

SELECT 'AI270_ANSWER_SOURCES_SUITE_START' AS ai270_suite_marker;

-- ---------------------------------------------------------------------------
-- 1. Catalog.
-- ---------------------------------------------------------------------------
SELECT pg_temp.s_assert((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform.ai_agent_answer_current_v1(uuid, uuid, text)'::regprocedure),
  'answer_current_v1: hardened definer, authenticated only');
SELECT pg_temp.s_assert((SELECT count(*) = 15 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%'), 'the staff inventory is still 15 functions');
SELECT pg_temp.s_assert((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('evo_ai_agent', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform_private.ai_answer_live_sources(uuid, jsonb)'::regprocedure),
  'the private source helper is executable by no API role and not by the agent');

-- ---------------------------------------------------------------------------
-- 2. Fixture. Organization 1: 1 Admin (system), 2 invited staff without any
--    role, 3 Student. Organization 2: 4 Admin.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ai270_actors(n INTEGER, org INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO ai270_actors(n, org, coarse) VALUES (1, 1, 'admin'), (2, 1, NULL), (3, 1, 'student'), (4, 2, 'admin');
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.s_id(1), 'AI270 Fictional organization'),
  (pg_temp.s_id(2), 'AI270 Other fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.s_id(100 + n), 'ai270-' || n || '@example.invalid', '{}'::JSONB FROM ai270_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.s_id(200 + n), pg_temp.s_id(100 + n), 'AI270 Actor ' || n, 'active', 1 FROM ai270_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.s_id(300 + a.n), pg_temp.s_id(a.org), pg_temp.s_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM ai270_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id IN (pg_temp.s_id(301), pg_temp.s_id(304));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.s_id(401), pg_temp.s_id(1), 'organization', pg_temp.s_id(1), 1),
  (pg_temp.s_id(402), pg_temp.s_id(2), 'organization', pg_temp.s_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id) VALUES
  (pg_temp.s_id(1), pg_temp.s_id(301), pg_temp.s_id(401), 1, 1, TRUE, 'system', 'AI270 synthetic scope', pg_temp.s_id(601)),
  (pg_temp.s_id(2), pg_temp.s_id(304), pg_temp.s_id(402), 1, 1, TRUE, 'system', 'AI270 synthetic scope', pg_temp.s_id(602));
UPDATE ai270_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.s_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.s_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS ai270_admin FROM ai270_actors WHERE n = 1 \gset
SELECT claims AS ai270_plain FROM ai270_actors WHERE n = 2 \gset
SELECT claims AS ai270_student FROM ai270_actors WHERE n = 3 \gset
SELECT claims AS ai270_other_admin FROM ai270_actors WHERE n = 4 \gset

-- One customer message through the REAL WAHA projection chain.
UPDATE pgmq.q_platform_work_v1 SET vt = pg_catalog.clock_timestamp() + INTERVAL '1 day'
  WHERE vt <= pg_catalog.clock_timestamp();
CREATE FUNCTION pg_temp.s_run(p_n INTEGER, p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  org CONSTANT UUID := pg_temp.s_id(1);
  event_id CONSTANT UUID := pg_temp.s_wid(1000 + p_n);
  enq JSONB; claim JSONB; proj JSONB; fin JSONB; work UUID; attempt UUID;
BEGIN
  INSERT INTO platform_private.provider_webhook_events (id, organization_id, provider, provider_account_ref,
    provider_conversation_ref, provider_event_variant_ref, provider_request_id, waha_session_name, payload_id,
    event_type, provider_occurred_at, verification_status, raw_payload, verification_headers,
    verification_evidence_ref, payload_sha256, request_id)
  VALUES (event_id, org, 'waha', 'waha:crm_primary', NULL, NULL, 'ai270-' || p_n, 'crm_primary',
    p_payload ->> 'id', 'message.any', TIMESTAMPTZ '2026-10-06 07:00:00+00' + p_n * INTERVAL '1 second',
    'verified', jsonb_build_object('event', 'message.any', 'session', 'crm_primary', 'payload', p_payload),
    '{"hmac_verified":true}', 'synthetic:ai270:' || p_n, lpad(to_hex(2700000 + p_n), 64, '0'), pg_temp.s_wid(1500 + p_n));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', TRUE);
  enq := platform.enqueue_verified_webhook_work(org, event_id,
    encode(sha256(convert_to('ai270-message.any-' || (p_payload ->> 'id'), 'UTF8')), 'hex'), 8, pg_temp.s_wid(2000 + p_n * 10 + 1));
  work := (enq ->> 'work_item_id')::UUID;
  claim := platform.claim_waha_webhook_work_item(org, work, 60, 'ai270', pg_temp.s_wid(2000 + p_n * 10 + 2));
  attempt := (claim ->> 'attempt_id')::UUID;
  proj := platform.project_claimed_waha_event(org, work, attempt, pg_temp.s_id(301), pg_temp.s_wid(2000 + p_n * 10 + 3));
  fin := platform.finish_waha_webhook_work(org, work, attempt, (proj ->> 'disposition')::platform.durable_work_finish_outcome,
    proj ->> 'error_code', proj ->> 'evidence_ref', NULL, pg_temp.s_wid(2000 + p_n * 10 + 4));
  RETURN proj || jsonb_build_object('finish_state', fin ->> 'state');
END
$$;
SELECT pg_temp.s_run(1, jsonb_build_object('id', 'false_79967000071@c.us_AI270AAAAAAAAAAAAAA1', 'timestamp', 1791270071,
  'from', '79967000071@c.us', 'fromMe', false, 'source', 'app', 'body', 'Сколько стоит обучение в Малайзии?')) AS r1 \gset
SELECT pg_temp.s_assert((:'r1'::JSONB ->> 'disposition') = 'succeeded', 'the customer message projects through the real chain');
SELECT binding.conversation_id AS c1 FROM platform_private.waha_direct_chat_bindings binding
  WHERE binding.organization_id = pg_temp.s_id(1) AND binding.normalized_chat_id = '79967000071@c.us' \gset
SELECT m.id AS m1 FROM platform.communication_messages m WHERE m.conversation_id = :'c1' AND m.direction = 'inbound'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1 \gset

-- Consent (Admin), then documents, chunks and one stored answer as the table owner.
SET LOCAL request.jwt.claims TO :'ai270_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.s_assert((platform.ai_agent_consent_record_v1(pg_temp.s_id(1), 'grant', 'gemini-v1', pg_temp.s_id(701))
  ->> 'status') = 'granted', 'the Admin records the consent');
RESET ROLE;
INSERT INTO platform_private.ai_documents(id, organization_id, title, kind, audience, status, source, page_count) VALUES
  (pg_temp.s_id(801), pg_temp.s_id(1), 'Прайс 2026', 'text', 'client', 'ready', 'upload', 2),
  (pg_temp.s_id(802), pg_temp.s_id(1), 'Правила скидок', 'text', 'internal', 'ready', 'upload', 1),
  (pg_temp.s_id(803), pg_temp.s_id(2), 'Чужой прайс', 'text', 'client', 'ready', 'upload', 1);
INSERT INTO platform_private.ai_chunks(organization_id, document_id, position, section_path, content, page_from, page_to)
VALUES
  (pg_temp.s_id(1), pg_temp.s_id(801), 0, 'Прайс 2026 › Малайзия', 'Обучение в Малайзии стоит 5000 долларов в год.', 2, 2),
  (pg_temp.s_id(1), pg_temp.s_id(802), 0, 'Скидки', 'Скидка до 15 процентов только с согласования руководителя.', 1, 1),
  (pg_temp.s_id(2), pg_temp.s_id(803), 0, 'Чужое', 'ЧУЖОЙ ТЕКСТ ДРУГОЙ ОРГАНИЗАЦИИ', 1, 1);
SELECT c.id AS chunk_client FROM platform_private.ai_chunks c WHERE c.document_id = pg_temp.s_id(801) \gset
SELECT c.id AS chunk_internal FROM platform_private.ai_chunks c WHERE c.document_id = pg_temp.s_id(802) \gset
SELECT c.id AS chunk_foreign FROM platform_private.ai_chunks c WHERE c.document_id = pg_temp.s_id(803) \gset
INSERT INTO platform_private.ai_answers(id, organization_id, conversation_id, source_message_id, intent,
  knowledge_fingerprint, status, result, model, cost_usd)
SELECT pg_temp.s_id(901), pg_temp.s_id(1), :'c1', :'m1', 'reply',
  platform_private.ai_knowledge_fingerprint(platform_private.ai_settings_row(pg_temp.s_id(1))), 'ready',
  jsonb_build_object('reply', 'Обучение стоит 5000 долларов в год.', 'reason', 'Из прайса; скидку не предлагать.',
    'question', 'На какую программу?', 'language', 'ru',
    'citations', jsonb_build_array(jsonb_build_object('n', 1, 'chunk_id', :'chunk_client'::BIGINT)),
    'reply_citations', jsonb_build_array(jsonb_build_object('n', 1, 'start', 0, 'end', 35)),
    'warnings', '[]'::JSONB,
    'sources', jsonb_build_array(
      jsonb_build_object('n', 1, 'chunk_id', :'chunk_client'::BIGINT, 'title', 'ПОДДЕЛКА', 'audience', 'internal',
        'quote', 'ПОДДЕЛАННАЯ ЦИТАТА АГЕНТА', 'page_from', 99, 'unverified_values', jsonb_build_array('1')),
      jsonb_build_object('n', 2, 'chunk_id', :'chunk_internal'::BIGINT, 'title', 'x', 'audience', 'client',
        'quote', 'ПОДДЕЛКА 2'),
      jsonb_build_object('n', 3, 'chunk_id', :'chunk_foreign'::BIGINT, 'quote', 'ПОДДЕЛКА 3'),
      jsonb_build_object('n', 4, 'chunk_id', 'not-a-number', 'quote', 'ПОДДЕЛКА 4'))),
  'gemini-3.8-flash', 0.007;

-- ---------------------------------------------------------------------------
-- 3. The view: sources from the database.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai270_admin';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_answer_current_v1(pg_temp.s_id(1), :'c1') AS v1 \gset
RESET ROLE;
SELECT pg_temp.s_assert((:'v1'::JSONB #>> '{answer,current}')::BOOLEAN
  AND (:'v1'::JSONB #>> '{answer,answerId}') = pg_temp.s_id(901)::TEXT
  AND (:'v1'::JSONB #>> '{answer,result,reply}') = 'Обучение стоит 5000 долларов в год.'
  AND (:'v1'::JSONB #>> '{answer,result,reason}') = 'Из прайса; скидку не предлагать.'
  AND (:'v1'::JSONB #>> '{answer,result,question}') = 'На какую программу?'
  AND jsonb_array_length(:'v1'::JSONB #> '{answer,result,citations}') = 1
  AND (:'v1'::JSONB #>> '{latestInboundMessageId}') = :'m1'
  AND (:'v1'::JSONB #>> '{lastMessageDirection}') = 'inbound'
  AND (:'v1'::JSONB #>> '{consentRecorded}')::BOOLEAN,
  'the saved answer is current; reply, reason, question and citations are as stored');
SELECT pg_temp.s_assert((SELECT array_agg((e ->> 'n')::INTEGER ORDER BY o) = ARRAY[1, 2, 3, 4]
  FROM jsonb_array_elements(:'v1'::JSONB #> '{answer,result,sources}') WITH ORDINALITY s(e, o)),
  'four source rows in the agent order and numbering');
SELECT pg_temp.s_assert((SELECT e ->> 'quote' = 'Обучение в Малайзии стоит 5000 долларов в год.'
    AND e ->> 'title' = 'Прайс 2026' AND e ->> 'audience' = 'client' AND (e ->> 'chunk_id')::BIGINT = :'chunk_client'
    AND e ->> 'document_id' = pg_temp.s_id(801)::TEXT AND (e ->> 'page_from')::INTEGER = 2
    AND e ->> 'section_path' = 'Прайс 2026 › Малайзия' AND (e ->> 'live')::BOOLEAN AND NOT (e ->> 'missing')::BOOLEAN
    AND NOT (e ->> 'unverified')::BOOLEAN AND e -> 'unverified_values' = '[]'::JSONB
  FROM jsonb_array_elements(:'v1'::JSONB #> '{answer,result,sources}') e WHERE e ->> 'n' = '1'),
  'source 1: the chunk text, document title, audience and page come from the database, not the agent');
SELECT pg_temp.s_assert((SELECT e ->> 'audience' = 'internal' AND e ->> 'title' = 'Правила скидок'
    AND e ->> 'quote' LIKE 'Скидка до 15 процентов%'
  FROM jsonb_array_elements(:'v1'::JSONB #> '{answer,result,sources}') e WHERE e ->> 'n' = '2'),
  'source 2: an internal chunk is shown as internal whatever the agent claimed');
SELECT pg_temp.s_assert((SELECT bool_and((e ->> 'missing')::BOOLEAN AND e ->> 'quote' IS NULL AND e ->> 'title' IS NULL
    AND NOT (e ->> 'live')::BOOLEAN)
  FROM jsonb_array_elements(:'v1'::JSONB #> '{answer,result,sources}') e WHERE (e ->> 'n') IS DISTINCT FROM '1'
    AND (e ->> 'n') IS DISTINCT FROM '2'),
  'a chunk of another organization or a malformed id is missing, with no text');
SELECT pg_temp.s_assert(position('ПОДДЕЛ' IN :'v1') = 0 AND position('ЧУЖОЙ' IN :'v1') = 0,
  'no forged agent text and no foreign text anywhere in the answer');

-- ---------------------------------------------------------------------------
-- 4. «Лист сверки», superseded and deleted documents.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.ai_review_items(organization_id, document_id, page_no, kind, value, proposed, anchor) VALUES
  (pg_temp.s_id(1), pg_temp.s_id(801), 2, 'number', '5000', '5000', 'стоит 5000 долларов'),
  (pg_temp.s_id(1), pg_temp.s_id(801), 2, 'number', '7777', NULL, 'нет в тексте'),
  (pg_temp.s_id(1), pg_temp.s_id(801), 1, 'number', '9999', NULL, 'другая страница');
SET LOCAL request.jwt.claims TO :'ai270_admin';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_answer_current_v1(pg_temp.s_id(1), :'c1', 'reply') AS v2 \gset
RESET ROLE;
SELECT pg_temp.s_assert((SELECT (e ->> 'unverified')::BOOLEAN AND e -> 'unverified_values' = '["5000"]'::JSONB
  FROM jsonb_array_elements(:'v2'::JSONB #> '{answer,result,sources}') e WHERE e ->> 'n' = '1'),
  'an open review item on the chunk page marks the source; only values present in the quote are listed');
UPDATE platform_private.ai_review_items SET status = 'resolved', resolved_at = clock_timestamp()
  WHERE document_id = pg_temp.s_id(801);
UPDATE platform_private.ai_documents SET status = 'superseded' WHERE id = pg_temp.s_id(801);
SET LOCAL request.jwt.claims TO :'ai270_admin';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_answer_current_v1(pg_temp.s_id(1), :'c1') AS v3 \gset
RESET ROLE;
SELECT pg_temp.s_assert((SELECT NOT (e ->> 'live')::BOOLEAN AND NOT (e ->> 'unverified')::BOOLEAN
    AND e ->> 'quote' LIKE 'Обучение в Малайзии%'
  FROM jsonb_array_elements(:'v3'::JSONB #> '{answer,result,sources}') e WHERE e ->> 'n' = '1'),
  'a superseded document: the source is shown with its text but not live; resolved items no longer mark it');
DELETE FROM platform_private.ai_documents WHERE id = pg_temp.s_id(801);
SET LOCAL request.jwt.claims TO :'ai270_admin';
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_answer_current_v1(pg_temp.s_id(1), :'c1') AS v4 \gset
RESET ROLE;
SELECT pg_temp.s_assert((SELECT (e ->> 'missing')::BOOLEAN AND e ->> 'quote' IS NULL AND e ->> 'title' IS NULL
    AND e ->> 'audience' IS NULL
  FROM jsonb_array_elements(:'v4'::JSONB #> '{answer,result,sources}') e WHERE e ->> 'n' = '1')
  AND (:'v4'::JSONB #>> '{answer,result,reply}') = 'Обучение стоит 5000 долларов в год.',
  'a deleted document leaves the row missing with no text; the stored reply stays');

-- ---------------------------------------------------------------------------
-- 5. Access is unchanged.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'ai270_plain';
SET LOCAL ROLE authenticated;
SELECT pg_temp.s_assert(pg_temp.s_err(format('SELECT platform.ai_agent_answer_current_v1(%L, %L)', pg_temp.s_id(1), :'c1'))
  LIKE '42501:%', 'a member without ai.agent.use is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai270_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.s_assert(pg_temp.s_err(format('SELECT platform.ai_agent_answer_current_v1(%L, %L)', pg_temp.s_id(1), :'c1'))
  LIKE '42501:%', 'a Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'ai270_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.s_assert(pg_temp.s_err(format('SELECT platform.ai_agent_answer_current_v1(%L, %L)', pg_temp.s_id(1), :'c1'))
  LIKE '42501:%' AND pg_temp.s_err(format('SELECT platform.ai_agent_answer_current_v1(%L, %L)', pg_temp.s_id(2), :'c1'))
  LIKE '42501:%', 'another organization''s Admin is refused, for either organization id');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.s_assert(pg_temp.s_err(format('SELECT platform.ai_agent_answer_current_v1(%L, %L)', pg_temp.s_id(1), :'c1'))
  LIKE '42501:%', 'anon is refused');
RESET ROLE;

SELECT 'AI270_ANSWER_SOURCES_SUITE_PASSED' AS ai270_suite_result;

ROLLBACK;
