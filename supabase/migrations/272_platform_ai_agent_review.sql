-- 272_platform_ai_agent_review — «ИИ-агент» P2: «Лист сверки».
-- Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md §7 («Лист сверки»), §13,
-- §15 P2. Столбцы и статус applying пункта добавлены в 271 (их пишет воркер).
--
-- Что делает:
--  * ai_agent_review_v1 (ai.agent.use) — пункты живых документов (ready/review,
--    не заменённых) с вырезкой, тремя прочтениями (tesseract, vision, arbiter,
--    arbiterModel), предложенным значением и счётчиками для вкладки;
--  * ai_agent_review_resolve_v1 (ai.agent.manage) с request_id и ожидаемым
--    статусом: «Подтвердить» (confirm) — предложенное значение, пункт решён
--    сразу и число больше не помечается; «Исправить» (correct) — одна строка
--    ≤ 200 символов → applying и указатель reindex (переиндексация решает
--    пункт или возвращает его в open с кодом, 271); «Оставить как есть»
--    (dismiss); «Открыть снова» (reopen; у applying — только без живой аренды
--    переиндексации). Статус документа ready ↔ review пересчитывается;
--  * search_v1 и ai_answer_live_sources (269/270, сигнатуры прежние): open и
--    applying — «Число не проверено».
-- Повторный запуск в той же точке цепочки ничего не меняет; после 273 —
-- откат проверкой состава.
BEGIN;

SELECT '[0]'::public.halfvec IS NOT NULL AS ai272_vector_loaded;

-- Пункты «Листа сверки». Порядок: документы от новых к старым, страница,
-- позиция числа; курсор before — ID последнего показанного пункта.
CREATE OR REPLACE FUNCTION platform.ai_agent_review_v1(p_organization_id UUID, p_query JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_statuses TEXT[]; v_document UUID; v_limit INTEGER; v_before UUID;
  v_k1 NUMERIC; v_k2 UUID; v_k3 INTEGER; v_k4 INTEGER; v_k5 UUID; v_items JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object'
    OR (p_query - ARRAY['status', 'documentId', 'limit', 'before']) <> '{}'::JSONB
    OR (p_query ? 'status' AND (jsonb_typeof(p_query -> 'status') <> 'string'
      OR (p_query ->> 'status') NOT IN ('pending', 'open', 'applying', 'resolved', 'dismissed')))
    OR (p_query ? 'documentId' AND (jsonb_typeof(p_query -> 'documentId') <> 'string'
      OR (p_query ->> 'documentId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    OR (p_query ? 'before' AND (jsonb_typeof(p_query -> 'before') <> 'string'
      OR (p_query ->> 'before') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    OR (p_query ? 'limit' AND (jsonb_typeof(p_query -> 'limit') <> 'number'
      OR (p_query ->> 'limit') !~ '^[0-9]{1,3}$')) THEN
    RAISE EXCEPTION 'ai_review_invalid_query' USING ERRCODE = '22023';
  END IF;
  v_statuses := CASE WHEN COALESCE(p_query ->> 'status', 'pending') = 'pending' THEN ARRAY['open', 'applying']
    ELSE ARRAY[p_query ->> 'status'] END;
  v_document := (p_query ->> 'documentId')::UUID;
  v_limit := least(200, greatest(1, COALESCE((p_query ->> 'limit')::INTEGER, 50)));
  v_before := (p_query ->> 'before')::UUID;
  IF v_before IS NOT NULL THEN
    SELECT -extract(EPOCH FROM d.created_at) AS k1, d.id AS k2, r.page_no AS k3,
      COALESCE(r.value_index, 2147483647) AS k4, r.id AS k5 INTO v_k1, v_k2, v_k3, v_k4, v_k5
    FROM platform_private.ai_review_items r JOIN platform_private.ai_documents d ON d.id = r.document_id
    WHERE r.organization_id = p_organization_id AND r.id = v_before;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_review_invalid_query' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.k1, x.k2, x.k3, x.k4, x.k5), '[]'::JSONB) INTO v_items FROM (
    SELECT (platform_private.ai_review_item_json(r) || jsonb_build_object('documentTitle', d.title,
        'documentKind', d.kind, 'docVersion', d.doc_version, 'documentStatus', d.status)) AS j,
      -extract(EPOCH FROM d.created_at) AS k1, d.id AS k2, r.page_no AS k3, COALESCE(r.value_index, 2147483647) AS k4,
      r.id AS k5
    FROM platform_private.ai_review_items r JOIN platform_private.ai_documents d ON d.id = r.document_id
    WHERE r.organization_id = p_organization_id AND d.organization_id = p_organization_id
      AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL AND r.status = ANY (v_statuses)
      AND (v_document IS NULL OR r.document_id = v_document)
      AND (v_before IS NULL OR (-extract(EPOCH FROM d.created_at), d.id, r.page_no, COALESCE(r.value_index, 2147483647), r.id)
        > (v_k1, v_k2, v_k3, v_k4, v_k5))
    ORDER BY 2, 3, 4, 5, 6 LIMIT v_limit + 1) x;
  RETURN jsonb_build_object(
    'items', (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::JSONB)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS i(e, o) WHERE o <= v_limit),
    'hasMore', jsonb_array_length(v_items) > v_limit,
    'counts', (SELECT jsonb_build_object('open', count(*) FILTER (WHERE r.status = 'open'),
        'applying', count(*) FILTER (WHERE r.status = 'applying'))
      FROM platform_private.ai_review_items r JOIN platform_private.ai_documents d ON d.id = r.document_id
      WHERE r.organization_id = p_organization_id AND r.status IN ('open', 'applying')
        AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL),
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

-- Решение по пункту. Блокировки: документ, затем пункт (как переиндексация).
CREATE OR REPLACE FUNCTION platform.ai_agent_review_resolve_v1(p_organization_id UUID, p_item_id UUID,
  p_action TEXT, p_value TEXT, p_expected_status TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_value TEXT; v_document_id UUID;
  v_doc platform_private.ai_documents; v_item platform_private.ai_review_items; v_new platform_private.ai_review_items;
  v_doc_status TEXT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_value := btrim(p_value);
  IF p_item_id IS NULL OR p_action IS NULL OR p_action NOT IN ('confirm', 'correct', 'dismiss', 'reopen')
    OR p_expected_status IS NULL OR p_expected_status NOT IN ('open', 'applying', 'resolved', 'dismissed')
    OR (p_action = 'correct' AND (v_value IS NULL OR char_length(v_value) NOT BETWEEN 1 AND 200
      OR v_value ~ '[\x00-\x1F\x7F]'))
    OR (p_action <> 'correct' AND p_value IS NOT NULL) THEN
    RAISE EXCEPTION 'ai_review_invalid_action' USING ERRCODE = '22023';
  END IF;
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('itemId', p_item_id, 'action', p_action,
    'value', v_value, 'expectedStatus', p_expected_status));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'review.' || p_action, v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT r.document_id INTO v_document_id FROM platform_private.ai_review_items r
  WHERE r.organization_id = p_organization_id AND r.id = p_item_id;
  SELECT * INTO v_doc FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = v_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status NOT IN ('ready', 'review') OR v_doc.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'ai_review_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_item FROM platform_private.ai_review_items r
  WHERE r.organization_id = p_organization_id AND r.id = p_item_id AND r.document_id = v_doc.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_review_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'ai_review_changed' USING ERRCODE = 'PT409', DETAIL = v_item.status;
  END IF;
  IF (p_action IN ('confirm', 'correct', 'dismiss') AND v_item.status <> 'open')
    OR (p_action = 'reopen' AND v_item.status = 'open') THEN
    RAISE EXCEPTION 'ai_review_invalid_action' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'confirm' AND v_item.proposed IS NULL THEN
    RAISE EXCEPTION 'ai_review_nothing_proposed' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'correct' AND v_doc.content_md IS NULL THEN
    RAISE EXCEPTION 'ai_review_not_correctable' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reopen' AND v_item.status = 'applying' AND v_doc.reindex_lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'ai_review_applying' USING ERRCODE = 'PT409';
  END IF;

  UPDATE platform_private.ai_review_items r SET
    status = CASE p_action WHEN 'confirm' THEN 'resolved' WHEN 'correct' THEN 'applying' WHEN 'dismiss' THEN 'dismissed'
      ELSE 'open' END,
    resolution = CASE p_action WHEN 'reopen' THEN NULL ELSE p_action END,
    value = CASE p_action WHEN 'confirm' THEN r.proposed WHEN 'correct' THEN v_value
      WHEN 'reopen' THEN CASE WHEN r.status = 'applying' THEN NULL ELSE r.value END ELSE r.value END,
    resolved_by = CASE WHEN p_action = 'reopen' THEN NULL ELSE v_actor.membership_id END,
    resolved_at = CASE WHEN p_action IN ('confirm', 'dismiss') THEN clock_timestamp() END,
    error_code = NULL
  WHERE r.id = v_item.id RETURNING * INTO v_new;
  v_doc_status := platform_private.ai_document_review_status(v_doc.id);
  IF v_doc_status <> v_doc.status THEN
    UPDATE platform_private.ai_documents d SET status = v_doc_status, row_version = d.row_version + 1,
      updated_at = statement_timestamp()
    WHERE d.id = v_doc.id;
  END IF;
  IF p_action = 'correct' THEN
    PERFORM platform_private.ai_enqueue('reindex', v_doc.id);
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'review.' || p_action, v_fp,
    jsonb_build_object('status', 'applied', 'action', p_action,
      'item', platform_private.ai_review_item_json(v_new) - 'cropPath', 'documentId', v_doc.id,
      'documentStatus', v_doc_status),
    'ai.agent.review.' || p_action, 'ai_review_item', v_item.id,
    jsonb_build_object('status', v_item.status, 'resolution', v_item.resolution, 'value', v_item.value,
      'proposed', v_item.proposed, 'documentId', v_doc.id, 'pageNo', v_item.page_no),
    CASE p_action WHEN 'confirm' THEN 'ИИ-агент: значение в «Листе сверки» подтверждено'
      WHEN 'correct' THEN 'ИИ-агент: значение в «Листе сверки» исправлено'
      WHEN 'dismiss' THEN 'ИИ-агент: значение в «Листе сверки» оставлено как есть'
      ELSE 'ИИ-агент: пункт «Листа сверки» открыт снова' END);
END
$$;

-- Источники ответа из базы (270): open и applying — «не проверено».
CREATE OR REPLACE FUNCTION platform_private.ai_answer_live_sources(p_organization_id UUID, p_result JSONB)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'n', x.n, 'chunk_id', x.chunk_id, 'document_id', x.document_id, 'title', x.title, 'audience', x.audience,
      'page_from', x.page_from, 'page_to', x.page_to, 'sheet_name', x.sheet_name, 'section_path', x.section_path,
      'quote', x.quote, 'live', x.live, 'missing', x.document_id IS NULL,
      'unverified', x.open_values IS NOT NULL,
      'unverified_values', COALESCE((SELECT jsonb_agg(v.value ORDER BY v.value) FROM (
          SELECT DISTINCT btrim(val) AS value FROM unnest(x.open_values) val
          WHERE btrim(val) <> '' AND x.quote IS NOT NULL AND strpos(x.quote, btrim(val)) > 0) v), '[]'::JSONB))
    ORDER BY x.ord), '[]'::JSONB)
  FROM (
    SELECT s.ord,
      CASE WHEN jsonb_typeof(s.e -> 'n') = 'number' AND (s.e ->> 'n') ~ '^[0-9]{1,3}$' THEN (s.e ->> 'n')::INTEGER END AS n,
      c.id AS chunk_id, d.id AS document_id, d.title, d.audience, c.page_from, c.page_to, c.sheet_name,
      c.section_path, left(c.content, 4000) AS quote,
      COALESCE(d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL, FALSE) AS live,
      (SELECT array_agg(COALESCE(r.value, r.proposed)) FROM platform_private.ai_review_items r
        WHERE d.id IS NOT NULL AND r.organization_id = p_organization_id AND r.document_id = d.id
          AND r.status IN ('open', 'applying') AND r.page_no BETWEEN COALESCE(c.page_from, 1) AND COALESCE(c.page_to, 300)
          AND COALESCE(r.value, r.proposed) IS NOT NULL) AS open_values
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_result -> 'sources') = 'array'
        THEN p_result -> 'sources' ELSE '[]'::JSONB END) WITH ORDINALITY AS s(e, ord)
    LEFT JOIN platform_private.ai_chunks c ON c.organization_id = p_organization_id
      AND c.id = CASE WHEN jsonb_typeof(s.e -> 'chunk_id') = 'number' AND (s.e ->> 'chunk_id') ~ '^[0-9]{1,18}$'
        THEN (s.e ->> 'chunk_id')::BIGINT END
    LEFT JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
  ) x
$$;
REVOKE ALL ON FUNCTION platform_private.ai_answer_live_sources(UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- Гибридный поиск (269); пункты «Листа сверки» open и applying отдаются как
-- непроверенные, со статусом.
CREATE OR REPLACE FUNCTION platform_ai_agent.search_v1(p_redemption_id UUID, p_query_embeddings JSONB,
  p_query_texts JSONB, p_limit INTEGER DEFAULT 8, p_internal_limit INTEGER DEFAULT 3)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
SET hnsw.iterative_scan = relaxed_order SET hnsw.ef_search = 100 AS $$
DECLARE v_ticket platform_private.ai_tickets; v_settings platform_private.ai_settings;
  v_vectors public.halfvec[]; v_texts TEXT[]; v_client JSONB; v_internal JSONB; v_review JSONB; v_examples JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'answer');
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8 OR p_internal_limit IS NULL OR p_internal_limit NOT BETWEEN 0 AND 3
    OR p_query_embeddings IS NULL OR jsonb_typeof(p_query_embeddings) <> 'array'
    OR jsonb_array_length(p_query_embeddings) > 4
    OR p_query_texts IS NULL OR jsonb_typeof(p_query_texts) <> 'array' OR jsonb_array_length(p_query_texts) > 4
    OR jsonb_array_length(p_query_embeddings) + jsonb_array_length(p_query_texts) = 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_embeddings) e
      WHERE jsonb_typeof(e) <> 'array' OR jsonb_array_length(e) <> 1536)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_query_texts) e
      WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'ai_search_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg((e::TEXT)::public.halfvec(1536) ORDER BY o) INTO v_vectors
  FROM jsonb_array_elements(p_query_embeddings) WITH ORDINALITY AS a(e, o);
  SELECT array_agg(e #>> '{}' ORDER BY o) INTO v_texts
  FROM jsonb_array_elements(p_query_texts) WITH ORDINALITY AS a(e, o);

  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.pick), '[]'::JSONB) INTO v_client FROM (
    SELECT jsonb_build_object('chunkId', c.id, 'documentId', d.id, 'title', d.title, 'audience', d.audience,
        'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name, 'sectionPath', c.section_path,
        'context', c.context, 'content', c.content, 'lang', c.lang, 'score', ranked.score) AS j,
      row_number() OVER (ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id) AS pick
    FROM (SELECT s.chunk_id, s.score, row_number() OVER (PARTITION BY ch.document_id ORDER BY s.score DESC, s.chunk_id) AS doc_rank
      FROM platform_private.ai_search_rank(v_ticket.organization_id, 'client', v_vectors, v_texts) s
      JOIN platform_private.ai_chunks ch ON ch.id = s.chunk_id) ranked
    JOIN platform_private.ai_chunks c ON c.id = ranked.chunk_id
    JOIN platform_private.ai_documents d ON d.id = c.document_id
    ORDER BY (ranked.doc_rank > 2), ranked.score DESC, c.id LIMIT p_limit) x;

  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.score DESC, x.id), '[]'::JSONB) INTO v_internal FROM (
    SELECT c.id, s.score, jsonb_build_object('chunkId', c.id, 'documentId', d.id, 'title', d.title,
        'audience', d.audience, 'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name,
        'sectionPath', c.section_path, 'context', c.context, 'content', c.content, 'lang', c.lang,
        'score', s.score) AS j
    FROM platform_private.ai_search_rank(v_ticket.organization_id, 'internal', v_vectors[1:1], v_texts[1:1]) s
    JOIN platform_private.ai_chunks c ON c.id = s.chunk_id
    JOIN platform_private.ai_documents d ON d.id = c.document_id
    ORDER BY s.score DESC, c.id LIMIT p_internal_limit) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId', r.document_id, 'pageNo', r.page_no, 'kind', r.kind,
      'value', r.value, 'proposed', r.proposed, 'anchor', r.anchor, 'status', r.status)
      ORDER BY r.document_id, r.page_no, r.id), '[]'::JSONB)
  INTO v_review
  FROM platform_private.ai_review_items r
  WHERE r.organization_id = v_ticket.organization_id AND r.status IN ('open', 'applying') AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_client || v_internal) e
    WHERE (e ->> 'documentId')::UUID = r.document_id
      AND r.page_no BETWEEN COALESCE((e ->> 'pageFrom')::INTEGER, 1) AND COALESCE((e ->> 'pageTo')::INTEGER, 300));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('exampleId', x.id, 'question', x.question, 'answer', x.answer,
      'similarity', x.similarity) ORDER BY x.similarity DESC, x.id), '[]'::JSONB)
  INTO v_examples
  FROM (SELECT g.id, g.question, g.answer, 1 - (g.embedding OPERATOR(public.<=>) v_vectors[1]) AS similarity
    FROM platform_private.ai_golden_examples g
    WHERE v_vectors IS NOT NULL AND g.organization_id = v_ticket.organization_id AND NOT g.needs_review
      AND g.embedding IS NOT NULL AND g.knowledge_version = v_settings.knowledge_version
      AND 1 - (g.embedding OPERATOR(public.<=>) v_vectors[1]) >= 0.80
    ORDER BY g.embedding OPERATOR(public.<=>) v_vectors[1] LIMIT 3) x;

  RETURN jsonb_build_object('client', v_client, 'internal', v_internal, 'review', v_review,
    'examples', v_examples, 'knowledgeVersion', v_settings.knowledge_version,
    'fingerprint', platform_private.ai_knowledge_fingerprint(v_settings));
END
$$;

-- ===========================================================================
-- Гранты и состав функций.
-- ===========================================================================
DO $ai272_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%\_v1' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', f,
      CASE WHEN f = 'platform.ai_agent_storage_authorize_v1(uuid,uuid,text,text,text)'::REGPROCEDURE
        THEN 'service_role' ELSE 'authenticated' END);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_ai_agent' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO evo_ai_agent', f);
  END LOOP;
END
$ai272_acl$;

DO $ai272_inventory$
DECLARE v_staff TEXT[]; v_agent TEXT[];
BEGIN
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_staff FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%';
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_agent FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform_ai_agent';
  IF v_staff IS DISTINCT FROM ARRAY['ai_agent_answer_current_v1', 'ai_agent_answer_insert_v1',
      'ai_agent_consent_record_v1', 'ai_agent_document_confirm_company_v1', 'ai_agent_document_delete_v1',
      'ai_agent_document_page_v1', 'ai_agent_document_retry_v1', 'ai_agent_document_update_v1',
      'ai_agent_document_upload_v1', 'ai_agent_document_v1', 'ai_agent_documents_v1', 'ai_agent_review_resolve_v1',
      'ai_agent_review_v1', 'ai_agent_rules_confirm_v1', 'ai_agent_rules_save_v1', 'ai_agent_rules_v1',
      'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1', 'ai_agent_settings_v1', 'ai_agent_spend_v1',
      'ai_agent_storage_authorize_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1',
      'document_content_put_v1', 'document_index_v1', 'document_pages_put_v1', 'document_reindex_claim_v1',
      'document_reindex_v1', 'document_stage_v1', 'maintenance_v1', 'rate_take_v1', 'ready_v1', 'redeem_ticket_v1',
      'review_items_put_v1', 'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1', 'work_extend_v1',
      'work_finish_v1'] THEN
    RAISE EXCEPTION 'ai_agent_function_inventory_drift' USING ERRCODE = '55000',
      DETAIL = format('staff=%s agent=%s', v_staff, v_agent);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform_ai_agent' OR (n.nspname = 'platform' AND p.proname LIKE 'ai\_agent\_%'))
      AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig))))
  THEN
    RAISE EXCEPTION 'ai_agent_function_not_hardened' USING ERRCODE = '55000';
  END IF;
END
$ai272_inventory$;

COMMENT ON FUNCTION platform.ai_agent_review_resolve_v1(UUID, UUID, TEXT, TEXT, TEXT, UUID) IS
  'AI agent P2: «Лист сверки» decision (confirm/correct/dismiss/reopen) on the expected status; correct queues a reindex of the live document.';

NOTIFY pgrst, 'reload schema';
COMMIT;
