-- 270_platform_ai_agent_answer_sources — «ИИ-агент» P1, срез 5 (CRM):
-- сохранённый ответ отдаёт источники из базы, а не из JSON агента.
--
-- Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md §6.4 («Цитаты в карточке —
-- оригинальный текст из ai_chunks. Модель цитату не повторяет») и заметки
-- приватного сервиса (README, «What the CRM must do»): answer_finish_v1 (269)
-- проверяет, что каждый chunk_id принадлежит организации и что маркеры [n]
-- ведут на клиентские фрагменты действующих документов, но текст `quote`,
-- `title` и `audience`, присланный агентом, не проверяет. Окно ИИ показывает
-- сотруднику «оригинальную цитату», поэтому ответ сотруднику собирается здесь.
--
-- platform.ai_agent_answer_current_v1 (269) заменяется с той же сигнатурой,
-- правами и проверками доступа. Отличие одно: в `result.sources` каждой строке
-- агента (по её `n` и `chunk_id`) соответствует строка из ai_chunks /
-- ai_documents ЭТОЙ организации: `title`, `audience`, страницы, лист, раздел и
-- `quote` (первые 4000 символов фрагмента) — из базы; `live` — документ ещё
-- действует (ready/review, не заменён); `missing` — фрагмента больше нет
-- (документ удалён) — тогда цитаты нет; `unverified` — на страницах фрагмента
-- есть открытые пункты «Листа сверки»; `unverified_values` — значения этих
-- пунктов, которые есть в тексте фрагмента. Текст `quote`/`title`/`audience`
-- агента не возвращается никогда. Остальной `result` (reply, reason, question,
-- citations, reply_citations, warnings, language) — как сохранил агент.
-- Список функций сотрудников (инвентарь 269) не меняется.
BEGIN;

-- Источники ответа из базы. Чужой или неизвестный chunk_id — `missing`,
-- без текста (answer_finish_v1 такого не пропускает; это вторая линия).
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
          AND r.status = 'open' AND r.page_no BETWEEN COALESCE(c.page_from, 1) AND COALESCE(c.page_to, 300)
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

-- Сохранённый ответ и флаг его актуальности (повторное открытие без Gemini);
-- источники — из базы (см. шапку).
CREATE OR REPLACE FUNCTION platform.ai_agent_answer_current_v1(p_organization_id UUID, p_conversation_id UUID,
  p_intent TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_latest UUID; v_last_direction TEXT;
  v_answer platform_private.ai_answers; v_fingerprint TEXT; v_current BOOLEAN;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_intent IS NOT NULL AND p_intent NOT IN ('reply', 'followup') THEN
    RAISE EXCEPTION 'ai_answer_invalid_intent' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
    RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  v_settings := platform_private.ai_settings_row(p_organization_id);
  v_fingerprint := platform_private.ai_knowledge_fingerprint(v_settings);
  v_latest := platform_private.ai_latest_inbound(p_organization_id, p_conversation_id);
  SELECT m.direction::TEXT INTO v_last_direction FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  SELECT * INTO v_answer FROM platform_private.ai_answers a
  WHERE a.organization_id = p_organization_id AND a.conversation_id = p_conversation_id
    AND (p_intent IS NULL OR a.intent = p_intent)
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('answer', NULL, 'latestInboundMessageId', v_latest,
      'lastMessageDirection', v_last_direction, 'consentRecorded', v_settings.gemini_consent_at IS NOT NULL);
  END IF;
  v_current := v_answer.status = 'ready' AND platform_private.ai_answer_anchored(v_answer)
    AND v_answer.knowledge_fingerprint = v_fingerprint;
  RETURN jsonb_build_object('answer', jsonb_build_object('answerId', v_answer.id, 'status', v_answer.status,
      'intent', v_answer.intent, 'sourceMessageId', v_answer.source_message_id,
      'sourceOutboundMessageId', v_answer.source_outbound_message_id,
      'result', CASE WHEN v_answer.status = 'ready' THEN v_answer.result || jsonb_build_object('sources',
        platform_private.ai_answer_live_sources(p_organization_id, v_answer.result)) END,
      'errorCode', v_answer.error_code, 'model', v_answer.model, 'createdAt', v_answer.created_at,
      'insertedAt', v_answer.inserted_at, 'current', v_current),
    'latestInboundMessageId', v_latest, 'lastMessageDirection', v_last_direction,
    'consentRecorded', v_settings.gemini_consent_at IS NOT NULL);
END
$$;
REVOKE ALL ON FUNCTION platform.ai_agent_answer_current_v1(UUID, UUID, TEXT)
  FROM PUBLIC, anon, service_role, supabase_auth_admin, evo_ai_agent;
GRANT EXECUTE ON FUNCTION platform.ai_agent_answer_current_v1(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION platform.ai_agent_answer_current_v1(UUID, UUID, TEXT) IS
  'AI agent P1: the saved answer of a sales conversation and whether it is current; sources (title, audience, quote) are read from the database, never from the agent JSON (270).';

NOTIFY pgrst, 'reload schema';
COMMIT;
