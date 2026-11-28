-- 384: «ИИ-агенты» — поиск по базе знаний на кыргызском, английском и по смыслу (28.11.2026, «мозг компании»).
--
-- Раньше `search_knowledge` (`platform.ai_agent_tool_search_knowledge_v1`, миграция 317) искал только полнотекстом по
-- русской конфигурации: русское стемирование не знает кыргызских и английских слов, и такой вопрос не находил ничего
-- (на продакшене 944 фрагмента из 1519 не на русском). Теперь поиск складывает три выдачи по правилу RRF
-- (reciprocal rank fusion: сумма вес / (60 + место) по каждой выдаче) и убирает повторы:
--   * fts_ru     — русский полнотекст, как раньше (фрагменты `ai_chunks.fts` и страницы вики `kb_nodes`); вес 2, чтобы
--                  русский запрос без вектора не стал хуже прежнего;
--   * fts_simple — полнотекст конфигурации `simple` (без стемирования и стоп-слов языка): точные слова кыргызского и
--                  английского текста; запрос из слов длиной от трёх букв без самых частых служебных слов, любое из слов
--                  (ИЛИ), порядок по ts_rank; вес 1. Фрагменты — новая вычисляемая колонка `ai_chunks.fts_simple` с GIN-
--                  индексом (1519 строк, ~1-3 МБ); страницы вики — уже существующий индекс `kb_nodes_search` (миграция 201,
--                  тот же `to_tsvector('simple', title || ' ' || description || ' ' || body)`), нового индекса не нужно;
--   * vector     — ближайшие по косинусу фрагменты (HNSW `ai_chunks_embedding_hnsw`, миграция 267), только если вызывающий
--                  передал вектор вопроса: необязательный четвёртый аргумент `p_query_embedding halfvec(1536)`. Вектор
--                  считает приложение (MCP-обработчик) тем же клиентом и моделью, что вектора фрагментов; без ключа
--                  аргумента нет и выдача остаётся полнотекстовой. Порог схожести 0.55 (1 - косинусное расстояние):
--                  ближайшие соседи ВСЕГДА есть, порог отсекает не относящееся к вопросу. Страницы вики векторов не имеют.
-- Фильтры прежние и не ослаблены: организация, `status = ready`, не заменённые документы, аудитория; у вики — только
-- области `internal` и `clients`, не удалённые и не в архиве (`secrets` и `raw` не выдаются никогда).
-- Ответ тот же (`results[]` с теми же полями), плюс `match`: `fts_ru` | `fts_simple` | `vector` — выдача, где
-- результат оказался выше всего.
--
-- `pg_trgm` не используется: ни одна миграция его не создаёт, а новых расширений здесь не ставим.
--
-- Сигнатура меняется (новый четвёртый аргумент с умолчанием): старая функция из трёх аргументов удаляется, старый вызов
-- `(org, key, args)` работает через умолчание. Права те же: только service_role. Число функций `ai_agent_tool_%` — 24, как было.
-- Повторное применение — a384_already_applied.

BEGIN;

DO $a384_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('platform_private.ai_chunks') AND a.attname = 'fts_simple' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'a384_already_applied';
  END IF;
  IF to_regclass('platform_private.ai_chunks') IS NULL
    OR to_regclass('platform_private.kb_nodes') IS NULL
    OR to_regprocedure('platform.ai_agent_tool_search_knowledge_v1(uuid,text,jsonb)') IS NULL
    OR to_regprocedure('platform_private.ai_agent_tool_begin(uuid,text,text,jsonb)') IS NULL
    OR to_regtype('public.halfvec') IS NULL THEN
    RAISE EXCEPTION 'a384_function_missing';
  END IF;
END
$a384_guard$;

-- ---------------------------------------------------------------------------
-- Простой полнотекст по фрагментам: те же веса и источники, что у `fts`, но конфигурация simple.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.ai_chunks
  ADD COLUMN fts_simple TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('pg_catalog.simple'::regconfig, section_path), 'A')
    || setweight(to_tsvector('pg_catalog.simple'::regconfig, context), 'C')
    || setweight(to_tsvector('pg_catalog.simple'::regconfig, COALESCE(index_text, content)), 'B')
  ) STORED;
CREATE INDEX ai_chunks_fts_simple_gin ON platform_private.ai_chunks USING gin (fts_simple);

-- ---------------------------------------------------------------------------
-- Запрос «любое из слов» для конфигурации simple. Слова берёт сам разбор текста (без регулярных выражений: они зависят
-- от локали базы), короткие и служебные отбрасываются, не больше двенадцати самых длинных. NULL — искать нечем.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.ai_agent_search_any_word_query(p_query TEXT)
RETURNS TSQUERY LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(pg_catalog.string_agg('(' || w.q::TEXT || ')', ' | ' ORDER BY pg_catalog.char_length(w.word) DESC, w.word), '')::TSQUERY
  FROM (
    SELECT t.word, pg_catalog.plainto_tsquery('pg_catalog.simple'::regconfig, t.word) AS q
    FROM (
      SELECT word FROM pg_catalog.unnest(pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, COALESCE(p_query, '')))) AS word
      WHERE pg_catalog.char_length(word) >= 3
        AND word <> ALL (ARRAY[
          'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'what', 'how', 'does', 'can', 'you', 'your', 'have', 'has', 'about', 'into',
          'что', 'как', 'для', 'это', 'при', 'или', 'про', 'над', 'под', 'без', 'его', 'она', 'они', 'все', 'так', 'чем', 'где', 'кто', 'есть', 'нужно', 'можно',
          'үчүн', 'жана', 'эмне', 'кандай', 'болот', 'бул', 'бар', 'же', 'жок', 'менен', 'деген', 'керек', 'болуп']::TEXT[])
      ORDER BY pg_catalog.char_length(word) DESC, word
      LIMIT 12
    ) t
  ) w
  WHERE pg_catalog.numnode(w.q) > 0
$$;
REVOKE ALL ON FUNCTION platform_private.ai_agent_search_any_word_query(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- ---------------------------------------------------------------------------
-- search_knowledge: три выдачи и слияние RRF.
-- ---------------------------------------------------------------------------
DROP FUNCTION platform.ai_agent_tool_search_knowledge_v1(UUID, TEXT, JSONB);

CREATE FUNCTION platform.ai_agent_tool_search_knowledge_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB,
  p_query_embedding public.halfvec DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_aud TEXT := COALESCE(p_args ->> 'audience', 'both'); v_limit INTEGER := COALESCE((p_args ->> 'limit')::INTEGER, 5);
  v_tq TSQUERY; v_sq TSQUERY; v_out JSONB;
  v_pool CONSTANT INTEGER := 30;          -- сколько мест берётся из каждой выдачи до слияния
  v_k CONSTANT DOUBLE PRECISION := 60;    -- константа RRF
  v_min_similarity CONSTANT DOUBLE PRECISION := 0.55;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'search_knowledge', p_args);
  IF p_query_embedding IS NOT NULL AND public.vector_dims(p_query_embedding) <> 1536 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_tq := pg_catalog.websearch_to_tsquery('pg_catalog.russian'::REGCONFIG, p_args ->> 'query');
  v_sq := platform_private.ai_agent_search_any_word_query(p_args ->> 'query');

  WITH ru_hits AS (
    SELECT 'agent_kb'::TEXT AS source, c.id AS chunk_id, NULL::UUID AS node_id, d.title,
      pg_catalog.ts_rank(c.fts, v_tq)::DOUBLE PRECISION AS rank
    FROM platform_private.ai_chunks c
    JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
    WHERE c.organization_id = p_organization_id AND d.status = 'ready' AND d.superseded_by_id IS NULL
      AND c.fts @@ v_tq AND (v_aud = 'both' OR d.audience = v_aud)
    UNION ALL
    SELECT 'crm_kb', NULL, n.id, n.title,
      pg_catalog.ts_rank(pg_catalog.to_tsvector('pg_catalog.russian'::REGCONFIG, n.title || ' ' || n.body), v_tq)::DOUBLE PRECISION
    FROM platform_private.kb_nodes n
    WHERE n.organization_id = p_organization_id AND n.kind = 'page' AND n.area IN ('internal', 'clients')
      AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND pg_catalog.to_tsvector('pg_catalog.russian'::REGCONFIG, n.title || ' ' || n.body) @@ v_tq
      AND (v_aud = 'both' OR (v_aud = 'client' AND n.area = 'clients') OR (v_aud = 'internal' AND n.area = 'internal'))
  ), simple_hits AS (
    SELECT 'agent_kb'::TEXT AS source, c.id AS chunk_id, NULL::UUID AS node_id, d.title,
      pg_catalog.ts_rank(c.fts_simple, v_sq)::DOUBLE PRECISION AS rank
    FROM platform_private.ai_chunks c
    JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
    WHERE v_sq IS NOT NULL AND c.organization_id = p_organization_id AND d.status = 'ready' AND d.superseded_by_id IS NULL
      AND c.fts_simple @@ v_sq AND (v_aud = 'both' OR d.audience = v_aud)
    UNION ALL
    SELECT 'crm_kb', NULL, n.id, n.title,
      pg_catalog.ts_rank(pg_catalog.to_tsvector('pg_catalog.simple'::REGCONFIG, n.title || ' ' || n.description || ' ' || n.body), v_sq)::DOUBLE PRECISION
    FROM platform_private.kb_nodes n
    WHERE v_sq IS NOT NULL AND n.organization_id = p_organization_id AND n.kind = 'page' AND n.area IN ('internal', 'clients') AND n.area <> 'secrets'
      AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND pg_catalog.to_tsvector('pg_catalog.simple'::REGCONFIG, n.title || ' ' || n.description || ' ' || n.body) @@ v_sq
      AND (v_aud = 'both' OR (v_aud = 'client' AND n.area = 'clients') OR (v_aud = 'internal' AND n.area = 'internal'))
  ), vector_hits AS (
    SELECT 'agent_kb'::TEXT AS source, c.id AS chunk_id, NULL::UUID AS node_id, d.title,
      (1 - (c.embedding OPERATOR(public.<=>) p_query_embedding))::DOUBLE PRECISION AS rank
    FROM platform_private.ai_chunks c
    JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
    WHERE p_query_embedding IS NOT NULL AND c.embedding IS NOT NULL
      AND c.organization_id = p_organization_id AND d.status = 'ready' AND d.superseded_by_id IS NULL
      AND (v_aud = 'both' OR d.audience = v_aud)
    ORDER BY c.embedding OPERATOR(public.<=>) p_query_embedding, c.id
    LIMIT v_pool
  ), legs AS (
    SELECT x.source, x.chunk_id, x.node_id, 'fts_ru'::TEXT AS leg, 2.0::DOUBLE PRECISION AS weight, x.rnk FROM (
      SELECT h.*, pg_catalog.row_number() OVER (ORDER BY h.rank DESC, h.title, h.chunk_id, h.node_id) AS rnk FROM ru_hits h) x WHERE x.rnk <= v_pool
    UNION ALL
    SELECT x.source, x.chunk_id, x.node_id, 'fts_simple', 1.0, x.rnk FROM (
      SELECT h.*, pg_catalog.row_number() OVER (ORDER BY h.rank DESC, h.title, h.chunk_id, h.node_id) AS rnk FROM simple_hits h) x WHERE x.rnk <= v_pool
    UNION ALL
    SELECT x.source, x.chunk_id, x.node_id, 'vector', 1.0, x.rnk FROM (
      SELECT h.*, pg_catalog.row_number() OVER (ORDER BY h.rank DESC, h.chunk_id) AS rnk FROM vector_hits h
      WHERE h.rank >= v_min_similarity) x
  ), fused AS (
    SELECT l.source, l.chunk_id, l.node_id,
      pg_catalog.sum(l.weight / (v_k + l.rnk)) AS score,
      (pg_catalog.array_agg(l.leg ORDER BY l.weight / (v_k + l.rnk) DESC, l.leg))[1] AS match
    FROM legs l
    GROUP BY l.source, l.chunk_id, l.node_id
  ), picked AS (
    SELECT f.*, r.title, r.path, r.body, r.audience, r.updated_at
    FROM fused f
    CROSS JOIN LATERAL (
      SELECT d.title, c.section_path AS path, c.content AS body, d.audience, d.updated_at
      FROM platform_private.ai_chunks c
      JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
      WHERE f.source = 'agent_kb' AND c.id = f.chunk_id AND c.organization_id = p_organization_id
      UNION ALL
      SELECT n.title, n.area,
        CASE WHEN f.match = 'fts_ru'
          THEN pg_catalog.ts_headline('pg_catalog.russian'::REGCONFIG, n.body, v_tq, 'StartSel=, StopSel=, MaxWords=140, MinWords=60, MaxFragments=2')
          ELSE pg_catalog.ts_headline('pg_catalog.simple'::REGCONFIG, n.body, v_sq, 'StartSel=, StopSel=, MaxWords=140, MinWords=60, MaxFragments=2') END,
        CASE n.area WHEN 'clients' THEN 'client' ELSE 'internal' END, n.updated_at
      FROM platform_private.kb_nodes n
      WHERE f.source = 'crm_kb' AND n.id = f.node_id AND n.organization_id = p_organization_id
    ) r
    ORDER BY f.score DESC, r.title, f.chunk_id, f.node_id
    LIMIT v_limit
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source', p.source, 'document_title', p.title, 'section_path', p.path,
      'text', pg_catalog.left(p.body, 1500), 'audience', p.audience, 'updated_at', p.updated_at,
      'approved_for_clients', p.audience = 'client', 'match', p.match) ORDER BY p.score DESC, p.title, p.chunk_id, p.node_id), '[]'::JSONB)
  INTO v_out
  FROM picked p;
  RETURN pg_catalog.jsonb_build_object('results', v_out);
END
$$;

REVOKE ALL ON FUNCTION platform.ai_agent_tool_search_knowledge_v1(UUID, TEXT, JSONB, public.halfvec)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_tool_search_knowledge_v1(UUID, TEXT, JSONB, public.halfvec) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
