-- 273_platform_ai_agent_lab — «ИИ-агент» P2: «Лаборатория».
-- Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md §5.2 (ai_lab_sessions,
-- ai_golden_examples), §5.3 (lab_*), §8, §13 (Q9: проверять может каждый
-- сотрудник с ai.agent.use, «Применить» — ai.agent.manage), §15 P2.
--
-- Что делает:
--  * цели билета laboratory (ai.agent.use, без диалога) и lab_apply
--    (ai.agent.manage, ref_id — СВОЁ предложение в статусе proposed). Билет
--    одной цели не годится для функций другой; погашение перепроверяет право
--    сотрудника (активный сотрудник, не студент) и согласие на Gemini;
--  * ai_lab_sessions — текущая проверка сотрудника (PK организация+сотрудник,
--    revision, payload ≤ 256 KB, живёт 2 ч); ai_lab_proposals — одно
--    предложение «было/стало» на сотрудника (document, knowledge, rules,
--    example), цель закреплена версией и SHA документа или версией правил,
--    источники — версией и аудиторией каждого документа (source_versions),
--    содержимое неизменяемо; статусы proposed → applied, rejected, expired,
--    conflict. Время строки (created/updated/expires) берётся одним
--    clock_timestamp(), иначе проверка «≤ 2 ч» падала бы на микросекундах;
--  * ai_golden_examples: rules_version_id, answer_model, source_doc_versions
--    {doc: {v, a}}. Пример действует, только пока совпадают все три (правила,
--    модель ответа, версия и аудитория каждого документа-источника); это
--    заменяет фильтр 269 по knowledge_version, из-за которого любая загрузка
--    гасила все примеры;
--  * lab_apply_v1 — одна транзакция без сетевых вызовов: своё неистёкшее
--    предложение с неизменной целью и неизменными источниками (версия и
--    аудитория каждого документа; иначе PT409 ai_lab_changed; статус
--    conflict/expired записывает следующее чтение ai_agent_lab_v1); документ
--    с ожидающей новой версией не правится (правка пропала бы при замене);
--    правка документа — новая doc_version на месте (edited_in_lab), новый
--    фрагмент — новый документ source lab, правила — новая подтверждённая
--    версия становится текущей; пример upsert; аудит было/стало; повтор тем
--    же погашением после потерянного ответа отдаёт сохранённый итог;
--  * search_v1, rate_take_v1, redeem_ticket_v1, ai_redemption, ticket_v1 и
--    maintenance_v1 заменяются с прежними сигнатурами.
-- Повторный запуск в той же точке цепочки ничего не меняет.
BEGIN;

SELECT '[0]'::public.halfvec IS NOT NULL AS ai273_vector_loaded;

-- ---------------------------------------------------------------------------
-- Таблицы и столбцы.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_private.ai_tickets
  DROP CONSTRAINT IF EXISTS ai_tickets_purpose_check,
  ADD CONSTRAINT ai_tickets_purpose_check CHECK (purpose IN ('answer', 'laboratory', 'lab_apply')),
  DROP CONSTRAINT IF EXISTS ai_tickets_purpose_shape_check,
  ADD CONSTRAINT ai_tickets_purpose_shape_check CHECK ((purpose = 'answer') = (conversation_id IS NOT NULL)
    AND (purpose <> 'lab_apply' OR ref_id IS NOT NULL) AND (purpose <> 'laboratory' OR ref_id IS NULL));

CREATE TABLE IF NOT EXISTS platform_private.ai_lab_sessions (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::TEXT) <= 262144),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (organization_id, membership_id),
  CONSTRAINT ai_lab_sessions_lifetime_check CHECK (expires_at > updated_at AND expires_at <= updated_at + INTERVAL '2 hours')
);
CREATE INDEX IF NOT EXISTS ai_lab_sessions_expires_idx ON platform_private.ai_lab_sessions (expires_at);

CREATE TABLE IF NOT EXISTS platform_private.ai_lab_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('document', 'knowledge', 'rules', 'example')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'rejected', 'expired', 'conflict')),
  target_document_id UUID,
  target_doc_version INTEGER CHECK (target_doc_version > 0),
  target_content_sha256 TEXT CHECK (target_content_sha256 ~ '^[0-9a-f]{64}$'),
  target_rules_version_id UUID,
  before_text TEXT CHECK (char_length(before_text) BETWEEN 1 AND 6000),
  after_text TEXT CHECK (char_length(after_text) <= 6000),
  title TEXT CHECK (char_length(btrim(title)) BETWEEN 1 AND 240 AND title !~ '[\x00-\x1F\x7F]'),
  audience TEXT CHECK (audience IN ('client', 'internal')),
  question TEXT NOT NULL CHECK (btrim(question) <> '' AND char_length(question) <= 4000),
  answer TEXT NOT NULL CHECK (btrim(answer) <> '' AND char_length(answer) <= 8000),
  finding TEXT NOT NULL CHECK (btrim(finding) <> '' AND char_length(finding) <= 4000),
  why TEXT NOT NULL DEFAULT '' CHECK (char_length(why) <= 4000),
  sources JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 20),
  -- {doc: {v, a}} источников на момент предложения: эталонный ответ написан
  -- по этим версиям, «Применить» перепроверяет их.
  source_versions JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(source_versions) = 'object' AND octet_length(source_versions::TEXT) <= 16384),
  proposal_sha256 TEXT NOT NULL CHECK (proposal_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  result JSONB CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::TEXT) <= 4096)),
  CONSTRAINT ai_lab_proposals_lifetime_check CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '2 hours'),
  CONSTRAINT ai_lab_proposals_decision_check CHECK ((status = 'proposed') = (decided_at IS NULL)),
  CONSTRAINT ai_lab_proposals_shape_check CHECK (CASE kind
    WHEN 'document' THEN target_document_id IS NOT NULL AND target_doc_version IS NOT NULL
      AND target_content_sha256 IS NOT NULL AND before_text IS NOT NULL AND after_text IS NOT NULL
      AND before_text <> after_text AND target_rules_version_id IS NULL AND title IS NULL AND audience IS NULL
    WHEN 'knowledge' THEN btrim(after_text) <> '' AND title IS NOT NULL AND audience IS NOT NULL
      AND before_text IS NULL AND target_document_id IS NULL AND target_doc_version IS NULL
      AND target_content_sha256 IS NULL AND target_rules_version_id IS NULL
    WHEN 'rules' THEN btrim(after_text) <> '' AND (before_text IS NULL OR target_rules_version_id IS NOT NULL)
      AND target_document_id IS NULL AND target_doc_version IS NULL AND target_content_sha256 IS NULL
      AND title IS NULL AND audience IS NULL
    ELSE before_text IS NULL AND after_text IS NULL AND target_document_id IS NULL AND target_doc_version IS NULL
      AND target_content_sha256 IS NULL AND target_rules_version_id IS NULL AND title IS NULL AND audience IS NULL END)
);
-- Одно предложение proposed на сотрудника.
CREATE UNIQUE INDEX IF NOT EXISTS ai_lab_proposals_one_proposed_key
  ON platform_private.ai_lab_proposals (organization_id, membership_id) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS ai_lab_proposals_member_idx
  ON platform_private.ai_lab_proposals (organization_id, membership_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_lab_proposals_expires_idx
  ON platform_private.ai_lab_proposals (expires_at) WHERE status = 'proposed';

-- Содержимое предложения неизменяемо; меняется только решение, один раз.
CREATE OR REPLACE FUNCTION platform_private.ai_lab_proposals_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'proposed'
    AND (to_jsonb(NEW) - ARRAY['status', 'decided_at', 'decided_by', 'result'])
      = (to_jsonb(OLD) - ARRAY['status', 'decided_at', 'decided_by', 'result']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_lab_proposal_immutable' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION platform_private.ai_lab_proposals_guard()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
DROP TRIGGER IF EXISTS ai_lab_proposals_immutable ON platform_private.ai_lab_proposals;
CREATE TRIGGER ai_lab_proposals_immutable BEFORE UPDATE ON platform_private.ai_lab_proposals
  FOR EACH ROW EXECUTE FUNCTION platform_private.ai_lab_proposals_guard();

ALTER TABLE platform_private.ai_golden_examples
  ADD COLUMN IF NOT EXISTS rules_version_id UUID,
  ADD COLUMN IF NOT EXISTS answer_model TEXT CHECK (answer_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'),
  ADD COLUMN IF NOT EXISTS source_doc_versions JSONB CHECK (source_doc_versions IS NULL
    OR (jsonb_typeof(source_doc_versions) = 'object' AND octet_length(source_doc_versions::TEXT) <= 16384));
DO $ai273_examples_fkey$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'ai_golden_examples_rules_fkey'
    AND conrelid = 'platform_private.ai_golden_examples'::REGCLASS) THEN
    ALTER TABLE platform_private.ai_golden_examples ADD CONSTRAINT ai_golden_examples_rules_fkey
      FOREIGN KEY (organization_id, rules_version_id) REFERENCES platform_private.ai_rules_versions(organization_id, id);
  END IF;
END
$ai273_examples_fkey$;

DO $ai273_lockdown$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_lab_sessions', 'ai_lab_proposals'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform_private.%I FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'platform_private' AND tablename = t) THEN
      RAISE EXCEPTION 'ai_agent_table_has_policies: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$ai273_lockdown$;

-- ---------------------------------------------------------------------------
-- Помощники (platform_private, без грантов).
-- ---------------------------------------------------------------------------

-- Активный сотрудник (не студент) с правом уровня организации.
CREATE OR REPLACE FUNCTION platform_private.ai_member_can(p_organization_id UUID, p_membership_id UUID,
  p_permission_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(p_organization_id IS NOT NULL AND p_membership_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM platform_private.staff_membership_identity(p_organization_id, p_membership_id))
    AND platform_private.staff_can_access(p_organization_id, p_membership_id, p_permission_key, 'organization',
      p_organization_id), FALSE)
$$;

-- Доступ по билету его цели: answer — диалог продаж (269), laboratory —
-- ai.agent.use, lab_apply — ai.agent.manage и своё предложение.
CREATE OR REPLACE FUNCTION platform_private.ai_ticket_allowed(p_ticket platform_private.ai_tickets)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(CASE p_ticket.purpose
    WHEN 'answer' THEN platform_private.ai_conversation_allowed(p_ticket.organization_id, p_ticket.membership_id,
      p_ticket.conversation_id)
    WHEN 'laboratory' THEN platform_private.ai_member_can(p_ticket.organization_id, p_ticket.membership_id, 'ai.agent.use')
    WHEN 'lab_apply' THEN platform_private.ai_member_can(p_ticket.organization_id, p_ticket.membership_id,
        'ai.agent.manage')
      AND EXISTS (SELECT 1 FROM platform_private.ai_lab_proposals p WHERE p.organization_id = p_ticket.organization_id
        AND p.id = p_ticket.ref_id AND p.membership_id = p_ticket.membership_id)
  END, FALSE)
$$;

-- Погашенный билет этой цели, годный ещё 5 минут; доступ перепроверяется.
CREATE OR REPLACE FUNCTION platform_private.ai_redemption(p_redemption_id UUID, p_purpose TEXT)
RETURNS platform_private.ai_tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets;
BEGIN
  SELECT * INTO v_ticket FROM platform_private.ai_tickets t WHERE t.id = p_redemption_id;
  IF NOT FOUND OR v_ticket.used_at IS NULL OR v_ticket.used_at < clock_timestamp() - INTERVAL '5 minutes'
    OR v_ticket.purpose IS DISTINCT FROM p_purpose OR NOT platform_private.ai_ticket_allowed(v_ticket) THEN
    RAISE EXCEPTION 'ai_redemption_invalid' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(v_ticket.organization_id));
  RETURN v_ticket;
END
$$;

-- Первое вхождение before заменяется на after.
CREATE OR REPLACE FUNCTION platform_private.ai_replace_once(p_text TEXT, p_before TEXT, p_after TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT overlay(p_text PLACING p_after FROM strpos(p_text, p_before) FOR char_length(p_before))
$$;

-- Почему пример больше не действует: правила, модель ответа, документы.
CREATE OR REPLACE FUNCTION platform_private.ai_example_stale(p_example platform_private.ai_golden_examples,
  p_settings platform_private.ai_settings)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('legacy', p_example.source_doc_versions IS NULL,
    'rules', p_example.rules_version_id IS DISTINCT FROM p_settings.rules_version_id,
    'model', p_example.answer_model IS DISTINCT FROM p_settings.answer_model,
    'documents', COALESCE((SELECT jsonb_agg(e.key ORDER BY e.key)
      FROM jsonb_each(COALESCE(p_example.source_doc_versions, '{}'::JSONB)) e
      LEFT JOIN platform_private.ai_documents d ON d.organization_id = p_example.organization_id
        AND d.id = CASE WHEN e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN e.key::UUID END
      WHERE d.id IS NULL OR d.status NOT IN ('ready', 'review') OR d.superseded_by_id IS NOT NULL
        OR d.doc_version IS DISTINCT FROM CASE WHEN (e.value ->> 'v') ~ '^[0-9]{1,9}$' THEN (e.value ->> 'v')::INTEGER END
        OR d.audience IS DISTINCT FROM e.value ->> 'a'), '[]'::JSONB))
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_example_valid(p_example platform_private.ai_golden_examples,
  p_settings platform_private.ai_settings)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s ->> 'legacy' = 'false' AND s ->> 'rules' = 'false' AND s ->> 'model' = 'false' AND s -> 'documents' = '[]'::JSONB
  FROM (SELECT platform_private.ai_example_stale(p_example, p_settings) AS s) x
$$;

-- Живые документы организации по списку ID (для источников и примеров).
CREATE OR REPLACE FUNCTION platform_private.ai_live_documents_map(p_organization_id UUID, p_ids UUID[])
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(d.id::TEXT, jsonb_build_object('v', d.doc_version, 'a', d.audience)), '{}'::JSONB)
  FROM platform_private.ai_documents d
  WHERE d.organization_id = p_organization_id AND d.id = ANY (p_ids)
    AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL
$$;

-- Цель предложения не изменилась (у документа нет ожидающей новой версии,
-- 271 ai_document_successor_pending), источники живы в тех же версиях и
-- аудиториях.
CREATE OR REPLACE FUNCTION platform_private.ai_lab_target_current(p_proposal platform_private.ai_lab_proposals)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(CASE p_proposal.kind
      WHEN 'document' THEN EXISTS (SELECT 1 FROM platform_private.ai_documents d
        WHERE d.organization_id = p_proposal.organization_id AND d.id = p_proposal.target_document_id
          AND d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL
          AND d.doc_version = p_proposal.target_doc_version AND d.content_sha256 = p_proposal.target_content_sha256)
        AND NOT platform_private.ai_document_successor_pending(p_proposal.organization_id, p_proposal.target_document_id)
      WHEN 'rules' THEN (SELECT s.rules_version_id FROM platform_private.ai_settings s
        WHERE s.organization_id = p_proposal.organization_id) IS NOT DISTINCT FROM p_proposal.target_rules_version_id
      ELSE TRUE END, FALSE)
    AND platform_private.ai_live_documents_map(p_proposal.organization_id,
      ARRAY(SELECT x::UUID FROM jsonb_array_elements_text(p_proposal.sources) x)) = p_proposal.source_versions
$$;

CREATE OR REPLACE FUNCTION platform_private.ai_lab_proposal_json(p_proposal platform_private.ai_lab_proposals)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', p_proposal.id, 'kind', p_proposal.kind, 'status', p_proposal.status,
    'documentId', p_proposal.target_document_id, 'docVersion', p_proposal.target_doc_version,
    'contentSha256', p_proposal.target_content_sha256, 'rulesVersionId', p_proposal.target_rules_version_id,
    'documentTitle', (SELECT d.title FROM platform_private.ai_documents d
      WHERE d.organization_id = p_proposal.organization_id AND d.id = p_proposal.target_document_id),
    'before', p_proposal.before_text, 'after', p_proposal.after_text, 'title', p_proposal.title,
    'audience', p_proposal.audience, 'question', p_proposal.question, 'answer', p_proposal.answer,
    'finding', p_proposal.finding, 'why', p_proposal.why, 'sources', p_proposal.sources,
    'sourceVersions', p_proposal.source_versions,
    'proposalSha256', p_proposal.proposal_sha256, 'createdAt', p_proposal.created_at,
    'expiresAt', p_proposal.expires_at, 'decidedAt', p_proposal.decided_at, 'result', p_proposal.result)
$$;

DO $ai273_private_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform_private' AND p.proname IN ('ai_member_can', 'ai_ticket_allowed', 'ai_redemption',
      'ai_replace_once', 'ai_example_stale', 'ai_example_valid', 'ai_lab_target_current', 'ai_lab_proposal_json',
      'ai_live_documents_map') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
END
$ai273_private_acl$;

-- ===========================================================================
-- Сотрудники (platform, authenticated).
-- ===========================================================================

-- Билет CRM → агент (269) с целями laboratory и lab_apply.
CREATE OR REPLACE FUNCTION platform.ai_agent_ticket_v1(p_organization_id UUID, p_purpose TEXT,
  p_conversation_id UUID, p_ref_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_bytes BYTEA; v_ticket platform_private.ai_tickets; v_now TIMESTAMPTZ := clock_timestamp();
  v_proposal platform_private.ai_lab_proposals;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id,
    CASE WHEN p_purpose = 'lab_apply' THEN 'ai.agent.manage' ELSE 'ai.agent.use' END);
  IF p_purpose IS NULL OR p_purpose NOT IN ('answer', 'laboratory', 'lab_apply') THEN
    RAISE EXCEPTION 'ai_ticket_invalid_purpose' USING ERRCODE = '22023';
  END IF;
  IF p_purpose = 'answer' THEN
    IF NOT platform_private.ai_conversation_allowed(p_organization_id, v_actor.membership_id, p_conversation_id) THEN
      RAISE EXCEPTION 'ai_conversation_unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_ref_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM platform.communication_messages m
      WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
        AND m.id = p_ref_id AND m.direction = 'inbound') THEN
      RAISE EXCEPTION 'ai_ticket_invalid_message' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_conversation_id IS NOT NULL OR (p_purpose = 'laboratory' AND p_ref_id IS NOT NULL)
      OR (p_purpose = 'lab_apply' AND p_ref_id IS NULL) THEN
      RAISE EXCEPTION 'ai_ticket_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_purpose = 'lab_apply' THEN
      SELECT * INTO v_proposal FROM platform_private.ai_lab_proposals p
      WHERE p.organization_id = p_organization_id AND p.id = p_ref_id;
      IF NOT FOUND OR v_proposal.membership_id <> v_actor.membership_id THEN
        RAISE EXCEPTION 'ai_lab_proposal_unavailable' USING ERRCODE = '42501';
      END IF;
      IF v_proposal.status <> 'proposed' OR v_proposal.expires_at <= v_now THEN
        RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(p_organization_id));
  -- Не больше 60 билетов в минуту на сотрудника, всех целей вместе (§6.8).
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_ticket:' || p_organization_id::TEXT || ':'
    || v_actor.membership_id::TEXT, 269));
  IF (SELECT count(*) FROM (SELECT 1 FROM platform_private.ai_tickets t
      WHERE t.organization_id = p_organization_id AND t.membership_id = v_actor.membership_id
        AND t.issued_at > v_now - INTERVAL '60 seconds' LIMIT 60) x) >= 60 THEN
    RAISE EXCEPTION 'ai_ticket_rate_limited' USING ERRCODE = 'PT429';
  END IF;
  DELETE FROM platform_private.ai_tickets t WHERE t.token_sha256 IN (
    SELECT o.token_sha256 FROM platform_private.ai_tickets o
    WHERE o.expires_at < clock_timestamp() - INTERVAL '1 day' LIMIT 100);
  v_bytes := decode(replace(gen_random_uuid()::TEXT, '-', '') || replace(gen_random_uuid()::TEXT, '-', ''), 'hex');
  INSERT INTO platform_private.ai_tickets (token_sha256, organization_id, membership_id, purpose,
    conversation_id, ref_id, issued_at, expires_at)
  VALUES (encode(sha256(v_bytes), 'hex'), p_organization_id, v_actor.membership_id, p_purpose,
    p_conversation_id, p_ref_id, v_now, v_now + INTERVAL '60 seconds')
  RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('ticket', encode(v_bytes, 'hex'), 'expiresAt', v_ticket.expires_at,
    'purpose', v_ticket.purpose, 'conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id);
END
$$;

-- Текущая проверка сотрудника: сессия и последнее предложение. Истёкшее
-- предложение становится expired, с изменившейся целью — conflict.
CREATE OR REPLACE FUNCTION platform.ai_agent_lab_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_session platform_private.ai_lab_sessions; v_proposal platform_private.ai_lab_proposals;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  UPDATE platform_private.ai_lab_proposals p SET
    status = CASE WHEN p.expires_at <= clock_timestamp() THEN 'expired' ELSE 'conflict' END,
    decided_at = clock_timestamp()
  WHERE p.organization_id = p_organization_id AND p.membership_id = v_actor.membership_id AND p.status = 'proposed'
    AND (p.expires_at <= clock_timestamp() OR NOT platform_private.ai_lab_target_current(p));
  SELECT * INTO v_session FROM platform_private.ai_lab_sessions s
  WHERE s.organization_id = p_organization_id AND s.membership_id = v_actor.membership_id
    AND s.expires_at > clock_timestamp();
  SELECT * INTO v_proposal FROM platform_private.ai_lab_proposals p
  WHERE p.organization_id = p_organization_id AND p.membership_id = v_actor.membership_id
    AND p.created_at > clock_timestamp() - INTERVAL '2 hours'
  ORDER BY p.created_at DESC, p.id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'session', CASE WHEN v_session.organization_id IS NULL THEN NULL ELSE jsonb_build_object(
      'revision', v_session.revision, 'payload', v_session.payload, 'expiresAt', v_session.expires_at) END,
    'proposal', CASE WHEN v_proposal.id IS NULL THEN NULL ELSE platform_private.ai_lab_proposal_json(v_proposal) END,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

-- «Начать заново»: сессия удаляется, незавершённое предложение — expired.
CREATE OR REPLACE FUNCTION platform.ai_agent_lab_discard_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_sessions INTEGER; v_proposals INTEGER;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  DELETE FROM platform_private.ai_lab_sessions s
  WHERE s.organization_id = p_organization_id AND s.membership_id = v_actor.membership_id;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  UPDATE platform_private.ai_lab_proposals p SET status = 'expired', decided_at = clock_timestamp(),
    decided_by = v_actor.membership_id
  WHERE p.organization_id = p_organization_id AND p.membership_id = v_actor.membership_id AND p.status = 'proposed';
  GET DIAGNOSTICS v_proposals = ROW_COUNT;
  RETURN jsonb_build_object('discarded', TRUE, 'sessions', v_sessions, 'proposals', v_proposals);
END
$$;

-- «Не менять»: своё предложение proposed → rejected, знания не трогаются.
CREATE OR REPLACE FUNCTION platform.ai_agent_lab_reject_v1(p_organization_id UUID, p_proposal_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_proposal platform_private.ai_lab_proposals;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('proposalId', p_proposal_id));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'lab.reject', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_proposal FROM platform_private.ai_lab_proposals p
  WHERE p.organization_id = p_organization_id AND p.id = p_proposal_id AND p.membership_id = v_actor.membership_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_lab_proposal_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF v_proposal.status <> 'proposed' THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = v_proposal.status;
  END IF;
  UPDATE platform_private.ai_lab_proposals p SET status = 'rejected', decided_at = clock_timestamp(),
    decided_by = v_actor.membership_id
  WHERE p.id = v_proposal.id;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'lab.reject', v_fp,
    jsonb_build_object('status', 'rejected', 'proposalId', v_proposal.id, 'kind', v_proposal.kind),
    'ai.agent.lab.reject', 'ai_lab_proposal', v_proposal.id,
    jsonb_build_object('status', v_proposal.status, 'proposalSha256', v_proposal.proposal_sha256),
    'ИИ-агент: предложение Лаборатории не применено («Не менять»)');
END
$$;

-- Подтверждённые примеры и действуют ли они (правила, модель, документы).
CREATE OR REPLACE FUNCTION platform.ai_agent_examples_v1(p_organization_id UUID, p_query JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_settings platform_private.ai_settings; v_limit INTEGER; v_before UUID;
  v_cursor_at TIMESTAMPTZ; v_cursor_id UUID; v_valid BOOLEAN; v_items JSONB;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object'
    OR (p_query - ARRAY['limit', 'before', 'valid']) <> '{}'::JSONB
    OR (p_query ? 'limit' AND (jsonb_typeof(p_query -> 'limit') <> 'number' OR (p_query ->> 'limit') !~ '^[0-9]{1,3}$'))
    OR (p_query ? 'valid' AND jsonb_typeof(p_query -> 'valid') <> 'boolean')
    OR (p_query ? 'before' AND (jsonb_typeof(p_query -> 'before') <> 'string'
      OR (p_query ->> 'before') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
    RAISE EXCEPTION 'ai_examples_invalid_query' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_settings FROM platform_private.ai_settings s WHERE s.organization_id = p_organization_id;
  v_limit := least(200, greatest(1, COALESCE((p_query ->> 'limit')::INTEGER, 50)));
  v_valid := (p_query ->> 'valid')::BOOLEAN;
  v_before := (p_query ->> 'before')::UUID;
  IF v_before IS NOT NULL THEN
    SELECT g.confirmed_at, g.id INTO v_cursor_at, v_cursor_id FROM platform_private.ai_golden_examples g
    WHERE g.organization_id = p_organization_id AND g.id = v_before;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_examples_invalid_query' USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.confirmed_at DESC, x.id DESC), '[]'::JSONB) INTO v_items FROM (
    SELECT g.confirmed_at, g.id, jsonb_build_object('id', g.id, 'question', g.question, 'answer', g.answer,
        'feedback', g.feedback, 'clientOnly', g.client_only, 'confirmedAt', g.confirmed_at,
        'confirmedByName', (SELECT p.display_name FROM platform.organization_memberships m
          JOIN platform.profiles p ON p.id = m.profile_id
          WHERE m.organization_id = g.organization_id AND m.id = g.confirmed_by),
        'valid', platform_private.ai_example_valid(g, v_settings),
        'stale', platform_private.ai_example_stale(g, v_settings),
        'rulesVersionId', g.rules_version_id, 'answerModel', g.answer_model,
        'sources', (SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId', e.key, 'title', d.title,
            'docVersion', (e.value ->> 'v')::INTEGER, 'audience', e.value ->> 'a',
            'currentVersion', d.doc_version,
            'live', COALESCE(d.status IN ('ready', 'review') AND d.superseded_by_id IS NULL, FALSE)) ORDER BY e.key),
            '[]'::JSONB)
          FROM jsonb_each(COALESCE(g.source_doc_versions, '{}'::JSONB)) e
          LEFT JOIN platform_private.ai_documents d ON d.organization_id = g.organization_id
            AND d.id = CASE WHEN e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN e.key::UUID END)) AS j
    FROM platform_private.ai_golden_examples g
    WHERE g.organization_id = p_organization_id
      AND (v_before IS NULL OR (g.confirmed_at, g.id) < (v_cursor_at, v_cursor_id))
      AND (v_valid IS NULL OR platform_private.ai_example_valid(g, v_settings) = v_valid)
    ORDER BY g.confirmed_at DESC, g.id DESC LIMIT v_limit + 1) x;
  RETURN jsonb_build_object(
    'items', (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::JSONB)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS i(e, o) WHERE o <= v_limit),
    'hasMore', jsonb_array_length(v_items) > v_limit,
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id));
END
$$;

CREATE OR REPLACE FUNCTION platform.ai_agent_example_delete_v1(p_organization_id UUID, p_example_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_fp TEXT; v_replay JSONB; v_example platform_private.ai_golden_examples;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  v_fp := platform_private.ai_fingerprint(jsonb_build_object('exampleId', p_example_id));
  v_replay := platform_private.ai_request_replay(p_organization_id, p_request_id, v_actor.membership_id,
    'example.delete', v_fp);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  DELETE FROM platform_private.ai_golden_examples g
  WHERE g.organization_id = p_organization_id AND g.id = p_example_id RETURNING * INTO v_example;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_example_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN platform_private.ai_request_finish(p_organization_id, p_request_id, v_actor.membership_id,
    v_actor.profile_id, v_actor.auth_user_id, 'example.delete', v_fp,
    jsonb_build_object('status', 'deleted', 'exampleId', v_example.id),
    'ai.agent.example.delete', 'ai_golden_example', v_example.id,
    jsonb_build_object('question', v_example.question, 'answer', v_example.answer,
      'confirmedAt', v_example.confirmed_at),
    'ИИ-агент: удалён подтверждённый пример');
END
$$;

-- ===========================================================================
-- Агент (platform_ai_agent, evo_ai_agent).
-- ===========================================================================

-- Погашение билета (269): доступ — по цели билета.
CREATE OR REPLACE FUNCTION platform_ai_agent.redeem_ticket_v1(p_ticket TEXT, p_purpose TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash TEXT; v_ticket platform_private.ai_tickets;
BEGIN
  IF p_ticket IS NULL OR p_ticket !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ai_ticket_invalid' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(sha256(decode(p_ticket, 'hex')), 'hex');
  SELECT * INTO v_ticket FROM platform_private.ai_tickets t WHERE t.token_sha256 = v_hash FOR UPDATE;
  IF NOT FOUND OR v_ticket.used_at IS NOT NULL OR v_ticket.expires_at <= clock_timestamp()
    OR v_ticket.purpose IS DISTINCT FROM p_purpose OR NOT platform_private.ai_ticket_allowed(v_ticket) THEN
    RAISE EXCEPTION 'ai_ticket_invalid' USING ERRCODE = '42501';
  END IF;
  PERFORM platform_private.ai_require_consent(platform_private.ai_settings_row(v_ticket.organization_id));
  UPDATE platform_private.ai_tickets t SET used_at = clock_timestamp() WHERE t.token_sha256 = v_hash
  RETURNING * INTO v_ticket;
  RETURN jsonb_build_object('redemptionId', v_ticket.id, 'organizationId', v_ticket.organization_id,
    'membershipId', v_ticket.membership_id, 'purpose', v_ticket.purpose,
    'conversationId', v_ticket.conversation_id, 'refId', v_ticket.ref_id,
    'validUntil', v_ticket.used_at + INTERVAL '5 minutes');
END
$$;

-- Лимит 20 в минуту на сотрудника: ответы и Лаборатория вместе.
CREATE OR REPLACE FUNCTION platform_ai_agent.rate_take_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_purpose TEXT;
BEGIN
  SELECT t.purpose INTO v_purpose FROM platform_private.ai_tickets t WHERE t.id = p_redemption_id;
  v_ticket := platform_private.ai_redemption(p_redemption_id,
    CASE WHEN v_purpose = 'laboratory' THEN 'laboratory' ELSE 'answer' END);
  PERFORM platform_private.ai_rate_take(v_ticket);
  RETURN jsonb_build_object('status', 'taken', 'redemptionId', v_ticket.id, 'purpose', v_ticket.purpose);
END
$$;

-- Гибридный поиск (269/272) по билету answer или laboratory; примеры —
-- только действующие (правила, модель, версии документов). Непроверенные
-- пункты отдаются со всеми прочтениями: в цитате может стоять любое из них.
CREATE OR REPLACE FUNCTION platform_ai_agent.search_v1(p_redemption_id UUID, p_query_embeddings JSONB,
  p_query_texts JSONB, p_limit INTEGER DEFAULT 8, p_internal_limit INTEGER DEFAULT 3)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
SET hnsw.iterative_scan = relaxed_order SET hnsw.ef_search = 100 AS $$
DECLARE v_ticket platform_private.ai_tickets; v_settings platform_private.ai_settings; v_purpose TEXT;
  v_vectors public.halfvec[]; v_texts TEXT[]; v_client JSONB; v_internal JSONB; v_review JSONB; v_examples JSONB;
BEGIN
  SELECT t.purpose INTO v_purpose FROM platform_private.ai_tickets t WHERE t.id = p_redemption_id;
  v_ticket := platform_private.ai_redemption(p_redemption_id,
    CASE WHEN v_purpose = 'laboratory' THEN 'laboratory' ELSE 'answer' END);
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
      'value', r.value, 'proposed', r.proposed, 'candidates', r.candidates, 'anchor', r.anchor, 'status', r.status)
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
      AND g.embedding IS NOT NULL AND platform_private.ai_example_valid(g, v_settings)
      AND 1 - (g.embedding OPERATOR(public.<=>) v_vectors[1]) >= 0.80
    ORDER BY g.embedding OPERATOR(public.<=>) v_vectors[1] LIMIT 3) x;

  RETURN jsonb_build_object('client', v_client, 'internal', v_internal, 'review', v_review,
    'examples', v_examples, 'knowledgeVersion', v_settings.knowledge_version,
    'fingerprint', platform_private.ai_knowledge_fingerprint(v_settings), 'purpose', v_ticket.purpose);
END
$$;

-- Рабочая память проверки (вопрос, ответ, источники, разбор) — 2 часа.
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_session_get_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_session platform_private.ai_lab_sessions;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'laboratory');
  SELECT * INTO v_session FROM platform_private.ai_lab_sessions s
  WHERE s.organization_id = v_ticket.organization_id AND s.membership_id = v_ticket.membership_id
    AND s.expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('revision', 0, 'payload', '{}'::JSONB, 'expiresAt', NULL);
  END IF;
  RETURN jsonb_build_object('revision', v_session.revision, 'payload', v_session.payload,
    'expiresAt', v_session.expires_at);
END
$$;

-- Запись с проверкой ревизии (истёкшая сессия — ревизия 0).
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_session_put_v1(p_redemption_id UUID, p_expected_revision BIGINT,
  p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_current BIGINT; v_session platform_private.ai_lab_sessions;
  v_now TIMESTAMPTZ;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'laboratory');
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR octet_length(p_payload::TEXT) > 262144 THEN
    RAISE EXCEPTION 'ai_lab_session_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_lab_session:' || v_ticket.organization_id::TEXT || ':'
    || v_ticket.membership_id::TEXT, 273));
  -- Одно время на строку: lifetime_check сравнивает expires_at с updated_at.
  v_now := clock_timestamp();
  SELECT CASE WHEN s.expires_at > v_now THEN s.revision ELSE 0 END INTO v_current
  FROM platform_private.ai_lab_sessions s
  WHERE s.organization_id = v_ticket.organization_id AND s.membership_id = v_ticket.membership_id;
  IF COALESCE(v_current, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'ai_lab_session_changed' USING ERRCODE = 'PT409', DETAIL = COALESCE(v_current, 0)::TEXT;
  END IF;
  INSERT INTO platform_private.ai_lab_sessions AS s (organization_id, membership_id, revision, payload, created_at,
    updated_at, expires_at)
  VALUES (v_ticket.organization_id, v_ticket.membership_id, p_expected_revision + 1, p_payload, v_now,
    v_now, v_now + INTERVAL '2 hours')
  ON CONFLICT (organization_id, membership_id) DO UPDATE SET revision = EXCLUDED.revision, payload = EXCLUDED.payload,
    created_at = CASE WHEN p_expected_revision = 0 THEN EXCLUDED.created_at ELSE s.created_at END,
    updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at
  RETURNING * INTO v_session;
  RETURN jsonb_build_object('revision', v_session.revision, 'expiresAt', v_session.expires_at);
END
$$;

-- Тексты до 5 живых документов (точное «было/стало» берётся из них) и
-- текущие «Правила общения».
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_documents_v1(p_redemption_id UUID, p_document_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_settings platform_private.ai_settings;
  v_rules platform_private.ai_rules_versions;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'laboratory');
  IF p_document_ids IS NULL OR cardinality(p_document_ids) > 5 OR array_position(p_document_ids, NULL) IS NOT NULL
    OR cardinality(p_document_ids) <> (SELECT count(DISTINCT i) FROM unnest(p_document_ids) i) THEN
    RAISE EXCEPTION 'ai_lab_invalid_documents' USING ERRCODE = '22023';
  END IF;
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
  SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = v_ticket.organization_id AND r.id = v_settings.rules_version_id;
  RETURN jsonb_build_object(
    'documents', (SELECT COALESCE(jsonb_agg(jsonb_build_object('documentId', d.id, 'title', d.title, 'kind', d.kind,
        'audience', d.audience, 'docVersion', d.doc_version, 'contentSha256', d.content_sha256,
        'contentMd', d.content_md, 'editedInLab', d.edited_in_lab) ORDER BY u.ord), '[]'::JSONB)
      FROM unnest(p_document_ids) WITH ORDINALITY AS u(id, ord)
      JOIN platform_private.ai_documents d ON d.id = u.id
      WHERE d.organization_id = v_ticket.organization_id AND d.status IN ('ready', 'review')
        AND d.superseded_by_id IS NULL),
    'unavailable', (SELECT COALESCE(jsonb_agg(u.id ORDER BY u.ord), '[]'::JSONB)
      FROM unnest(p_document_ids) WITH ORDINALITY AS u(id, ord)
      WHERE NOT EXISTS (SELECT 1 FROM platform_private.ai_documents d WHERE d.id = u.id
        AND d.organization_id = v_ticket.organization_id AND d.status IN ('ready', 'review')
        AND d.superseded_by_id IS NULL)),
    'rules', CASE WHEN v_rules.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_rules.id,
      'version', v_rules.version, 'body', v_rules.body, 'needsReview', v_rules.confirmed_at IS NULL) END);
END
$$;

-- Предложение одной правки. Цель должна совпадать с текущей (иначе PT409
-- ai_lab_changed), before — встречаться в тексте ровно один раз (иначе 22023
-- ai_lab_edit_invalid). Прежнее незавершённое предложение сотрудника — expired.
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_proposal_put_v1(p_redemption_id UUID, p_proposal JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_kind TEXT; v_doc platform_private.ai_documents;
  v_settings platform_private.ai_settings; v_rules platform_private.ai_rules_versions; v_new TEXT;
  v_sources UUID[]; v_source_map JSONB; v_row platform_private.ai_lab_proposals; v_now TIMESTAMPTZ;
  v_uuid CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'laboratory');
  v_kind := p_proposal ->> 'kind';
  IF p_proposal IS NULL OR jsonb_typeof(p_proposal) <> 'object'
    OR (p_proposal - ARRAY['kind', 'documentId', 'docVersion', 'contentSha256', 'rulesVersionId', 'before', 'after',
      'title', 'audience', 'question', 'answer', 'finding', 'why', 'sources']) <> '{}'::JSONB
    OR v_kind IS NULL OR v_kind NOT IN ('document', 'knowledge', 'rules', 'example')
    OR EXISTS (SELECT 1 FROM jsonb_each(p_proposal) e WHERE e.key <> 'sources' AND e.key <> 'docVersion'
      AND jsonb_typeof(e.value) NOT IN ('string', 'null'))
    OR jsonb_typeof(p_proposal -> 'question') IS DISTINCT FROM 'string'
    OR char_length(p_proposal ->> 'question') > 4000 OR btrim(p_proposal ->> 'question') = ''
    OR jsonb_typeof(p_proposal -> 'answer') IS DISTINCT FROM 'string'
    OR char_length(p_proposal ->> 'answer') > 8000 OR btrim(p_proposal ->> 'answer') = ''
    OR jsonb_typeof(p_proposal -> 'finding') IS DISTINCT FROM 'string'
    OR char_length(p_proposal ->> 'finding') > 4000 OR btrim(p_proposal ->> 'finding') = ''
    OR char_length(p_proposal ->> 'why') > 4000
    OR char_length(p_proposal ->> 'before') > 6000 OR char_length(p_proposal ->> 'after') > 6000
    OR (p_proposal ? 'sources' AND (jsonb_typeof(p_proposal -> 'sources') <> 'array'
      OR jsonb_array_length(p_proposal -> 'sources') > 20
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_proposal -> 'sources') s
        WHERE jsonb_typeof(s) <> 'string' OR (s #>> '{}') !~ v_uuid)
      OR (SELECT count(DISTINCT s) FROM jsonb_array_elements_text(p_proposal -> 'sources') s)
        <> jsonb_array_length(p_proposal -> 'sources')))
    OR (p_proposal ? 'documentId' AND COALESCE(p_proposal ->> 'documentId', '') !~ v_uuid)
    OR (p_proposal ? 'rulesVersionId' AND jsonb_typeof(p_proposal -> 'rulesVersionId') <> 'null'
      AND (p_proposal ->> 'rulesVersionId') !~ v_uuid)
    OR (p_proposal ? 'docVersion' AND (jsonb_typeof(p_proposal -> 'docVersion') <> 'number'
      OR (p_proposal ->> 'docVersion') !~ '^[1-9][0-9]{0,8}$'))
    OR (p_proposal ? 'contentSha256' AND COALESCE(p_proposal ->> 'contentSha256', '') !~ '^[0-9a-f]{64}$')
    OR (p_proposal ? 'audience' AND COALESCE(p_proposal ->> 'audience', '') NOT IN ('client', 'internal'))
    OR (CASE v_kind
      WHEN 'document' THEN NOT (p_proposal ?& ARRAY['documentId', 'docVersion', 'contentSha256', 'before', 'after'])
        OR p_proposal ?| ARRAY['rulesVersionId', 'title', 'audience']
        OR (p_proposal ->> 'before') IS NULL OR (p_proposal ->> 'before') = '' OR (p_proposal ->> 'after') IS NULL
        OR (p_proposal ->> 'before') = (p_proposal ->> 'after')
      WHEN 'knowledge' THEN NOT (p_proposal ?& ARRAY['after', 'title', 'audience'])
        OR p_proposal ?| ARRAY['documentId', 'docVersion', 'contentSha256', 'rulesVersionId', 'before']
        OR btrim(COALESCE(p_proposal ->> 'after', '')) = ''
        OR char_length(btrim(COALESCE(p_proposal ->> 'title', ''))) NOT BETWEEN 1 AND 240
        OR (p_proposal ->> 'title') ~ '[\x00-\x1F\x7F]'
      WHEN 'rules' THEN NOT (p_proposal ? 'after') OR btrim(COALESCE(p_proposal ->> 'after', '')) = ''
        OR p_proposal ?| ARRAY['documentId', 'docVersion', 'contentSha256', 'title', 'audience']
        OR ((p_proposal ->> 'before') IS NOT NULL AND ((p_proposal ->> 'before') = ''
          OR (p_proposal ->> 'rulesVersionId') IS NULL))
      ELSE p_proposal ?| ARRAY['documentId', 'docVersion', 'contentSha256', 'rulesVersionId', 'before', 'after',
        'title', 'audience'] END) THEN
    RAISE EXCEPTION 'ai_lab_invalid_proposal' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(s::UUID), '{}') INTO v_sources
  FROM jsonb_array_elements_text(COALESCE(p_proposal -> 'sources', '[]'::JSONB)) s;
  -- Версия и аудитория каждого источника закрепляются: ответ написан по ним.
  v_source_map := platform_private.ai_live_documents_map(v_ticket.organization_id, v_sources);
  IF (SELECT count(*) FROM jsonb_object_keys(v_source_map)) <> cardinality(v_sources) THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'sources';
  END IF;
  IF v_kind = 'document' THEN
    SELECT * INTO v_doc FROM platform_private.ai_documents d
    WHERE d.organization_id = v_ticket.organization_id AND d.id = (p_proposal ->> 'documentId')::UUID;
    IF NOT FOUND OR v_doc.status NOT IN ('ready', 'review') OR v_doc.superseded_by_id IS NOT NULL
      OR v_doc.doc_version <> (p_proposal ->> 'docVersion')::INTEGER
      OR v_doc.content_sha256 IS DISTINCT FROM p_proposal ->> 'contentSha256' THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'document';
    END IF;
    IF platform_private.ai_document_successor_pending(v_ticket.organization_id, v_doc.id) THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'replacement_pending';
    END IF;
    IF NOT platform_private.ai_occurs_once(v_doc.content_md, p_proposal ->> 'before') THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'before must occur exactly once';
    END IF;
    v_new := platform_private.ai_replace_once(v_doc.content_md, p_proposal ->> 'before', p_proposal ->> 'after');
    IF char_length(v_new) > 2000000 OR btrim(v_new) = '' THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'content size';
    END IF;
  ELSIF v_kind = 'rules' THEN
    v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
    IF v_settings.rules_version_id IS DISTINCT FROM (p_proposal ->> 'rulesVersionId')::UUID THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'rules';
    END IF;
    SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
    WHERE r.organization_id = v_ticket.organization_id AND r.id = v_settings.rules_version_id;
    IF (p_proposal ->> 'before') IS NOT NULL AND NOT platform_private.ai_occurs_once(v_rules.body, p_proposal ->> 'before') THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'before must occur exactly once';
    END IF;
    v_new := CASE WHEN v_rules.id IS NULL THEN p_proposal ->> 'after'
      WHEN (p_proposal ->> 'before') IS NULL THEN v_rules.body || E'\n\n' || (p_proposal ->> 'after')
      ELSE platform_private.ai_replace_once(v_rules.body, p_proposal ->> 'before', p_proposal ->> 'after') END;
    IF octet_length(v_new) > 32768 OR btrim(v_new) = '' THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'rules size';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ai_lab_proposal:' || v_ticket.organization_id::TEXT || ':'
    || v_ticket.membership_id::TEXT, 273));
  -- Одно время на строку: lifetime_check сравнивает expires_at с created_at.
  v_now := clock_timestamp();
  UPDATE platform_private.ai_lab_proposals p SET status = 'expired', decided_at = v_now
  WHERE p.organization_id = v_ticket.organization_id AND p.membership_id = v_ticket.membership_id
    AND p.status = 'proposed';
  INSERT INTO platform_private.ai_lab_proposals (organization_id, membership_id, kind, target_document_id,
    target_doc_version, target_content_sha256, target_rules_version_id, before_text, after_text, title, audience,
    question, answer, finding, why, sources, source_versions, proposal_sha256, created_at, expires_at)
  VALUES (v_ticket.organization_id, v_ticket.membership_id, v_kind, (p_proposal ->> 'documentId')::UUID,
    (p_proposal ->> 'docVersion')::INTEGER, p_proposal ->> 'contentSha256',
    CASE WHEN v_kind = 'rules' THEN v_settings.rules_version_id END, p_proposal ->> 'before', p_proposal ->> 'after',
    btrim(p_proposal ->> 'title'), p_proposal ->> 'audience', btrim(p_proposal ->> 'question'), p_proposal ->> 'answer',
    btrim(p_proposal ->> 'finding'), COALESCE(p_proposal ->> 'why', ''), to_jsonb(v_sources), v_source_map,
    platform_private.ai_fingerprint(jsonb_build_object('v', 1, 'kind', v_kind,
      'documentId', p_proposal ->> 'documentId', 'docVersion', p_proposal -> 'docVersion',
      'contentSha256', p_proposal ->> 'contentSha256', 'rulesVersionId', v_settings.rules_version_id,
      'before', p_proposal ->> 'before', 'after', p_proposal ->> 'after', 'title', p_proposal ->> 'title',
      'audience', p_proposal ->> 'audience', 'question', p_proposal ->> 'question', 'answer', p_proposal ->> 'answer',
      'sources', v_source_map)),
    v_now, v_now + INTERVAL '2 hours')
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('status', 'proposed', 'proposalId', v_row.id, 'kind', v_row.kind,
    'proposalSha256', v_row.proposal_sha256, 'expiresAt', v_row.expires_at, 'newContentChars', char_length(v_new));
END
$$;

-- Подготовка «Применить» (билет lab_apply): предложение, итоговый текст и
-- текущие фрагменты документа — эмбеддинги агент готовит вне транзакции.
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_apply_prepare_v1(p_redemption_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_proposal platform_private.ai_lab_proposals;
  v_doc platform_private.ai_documents; v_settings platform_private.ai_settings;
  v_rules platform_private.ai_rules_versions; v_new TEXT; v_document JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'lab_apply');
  SELECT * INTO v_proposal FROM platform_private.ai_lab_proposals p
  WHERE p.organization_id = v_ticket.organization_id AND p.id = v_ticket.ref_id
    AND p.membership_id = v_ticket.membership_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_lab_proposal_unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_proposal.status <> 'proposed' OR v_proposal.expires_at <= clock_timestamp()
    OR NOT platform_private.ai_lab_target_current(v_proposal) THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409';
  END IF;
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);
  IF v_proposal.kind = 'document' THEN
    SELECT * INTO v_doc FROM platform_private.ai_documents d WHERE d.id = v_proposal.target_document_id;
    v_new := platform_private.ai_replace_once(v_doc.content_md, v_proposal.before_text, v_proposal.after_text);
    v_document := jsonb_build_object('documentId', v_doc.id, 'title', v_doc.title, 'kind', v_doc.kind,
      'audience', v_doc.audience, 'docVersion', v_doc.doc_version, 'contentSha256', v_doc.content_sha256,
      'chunks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('chunkId', c.id, 'position', c.position,
          'sectionPath', c.section_path, 'content', c.content, 'context', c.context, 'lang', c.lang,
          'indexText', c.index_text, 'pageFrom', c.page_from, 'pageTo', c.page_to, 'sheetName', c.sheet_name,
          'boxes', c.boxes, 'tokens', c.tokens, 'hasEmbedding', c.embedding IS NOT NULL) ORDER BY c.position),
          '[]'::JSONB)
        FROM platform_private.ai_chunks c WHERE c.document_id = v_doc.id));
  ELSIF v_proposal.kind = 'knowledge' THEN
    v_new := v_proposal.after_text;
  ELSIF v_proposal.kind = 'rules' THEN
    SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
    WHERE r.organization_id = v_ticket.organization_id AND r.id = v_settings.rules_version_id;
    v_new := CASE WHEN v_rules.id IS NULL THEN v_proposal.after_text
      WHEN v_proposal.before_text IS NULL THEN v_rules.body || E'\n\n' || v_proposal.after_text
      ELSE platform_private.ai_replace_once(v_rules.body, v_proposal.before_text, v_proposal.after_text) END;
  END IF;
  RETURN jsonb_build_object('proposal', platform_private.ai_lab_proposal_json(v_proposal),
    'newContentMd', v_new, 'baseSha256', CASE WHEN v_proposal.kind = 'document' THEN v_doc.content_sha256
      WHEN v_proposal.kind = 'rules' THEN platform_private.ai_text_sha256(v_rules.body) END,
    'document', v_document,
    'models', jsonb_build_object('answer', v_settings.answer_model, 'fast', v_settings.fast_model,
      'embedding', v_settings.embedding_model));
END
$$;

-- «Применить»: одна транзакция без сетевых вызовов (§8).
CREATE OR REPLACE FUNCTION platform_ai_agent.lab_apply_v1(p_redemption_id UUID, p_base_sha TEXT, p_content TEXT,
  p_new_document JSONB, p_chunks JSONB, p_question_embedding JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ticket platform_private.ai_tickets; v_proposal platform_private.ai_lab_proposals;
  v_doc platform_private.ai_documents; v_settings platform_private.ai_settings;
  v_rules platform_private.ai_rules_versions; v_new_rules platform_private.ai_rules_versions;
  v_identity RECORD; v_new TEXT; v_chunks JSONB; v_doc_id UUID; v_ids UUID[]; v_map JSONB; v_knowledge BIGINT;
  v_example_id UUID; v_key TEXT; v_result JSONB;
BEGIN
  v_ticket := platform_private.ai_redemption(p_redemption_id, 'lab_apply');
  IF p_question_embedding IS NULL OR jsonb_typeof(p_question_embedding) <> 'array'
    OR jsonb_array_length(p_question_embedding) <> 1536
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_question_embedding) e WHERE jsonb_typeof(e) <> 'number')
    OR (p_base_sha IS NOT NULL AND p_base_sha !~ '^[0-9a-f]{64}$')
    OR (p_new_document IS NOT NULL AND (jsonb_typeof(p_new_document) <> 'object'
      OR (p_new_document - ARRAY['title', 'audience']) <> '{}'::JSONB)) THEN
    RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_proposal FROM platform_private.ai_lab_proposals p
  WHERE p.organization_id = v_ticket.organization_id AND p.id = v_ticket.ref_id
    AND p.membership_id = v_ticket.membership_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_lab_proposal_unavailable' USING ERRCODE = '42501';
  END IF;
  -- Повтор этим же погашением (ответ потерялся): итог уже записан этим
  -- билетом — отдаётся он, а не «изменилось».
  IF v_proposal.status = 'applied' AND EXISTS (SELECT 1 FROM platform.audit_events e
    WHERE e.request_id = v_ticket.id AND e.organization_id = v_ticket.organization_id
      AND e.action = 'ai.agent.lab.apply' AND e.resource_id = v_proposal.id) THEN
    RETURN v_proposal.result || jsonb_build_object('replayed', TRUE);
  END IF;
  IF v_proposal.status <> 'proposed' OR v_proposal.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'proposal';
  END IF;
  SELECT * INTO v_identity FROM platform_private.staff_membership_identity(v_ticket.organization_id,
    v_ticket.membership_id);
  -- Порядок блокировок как у индексации: документы (цель и источники — по ID,
  -- чтобы два «Применить» не ждали друг друга по кругу), затем ai_settings
  -- (ai_bump_knowledge); строку настроек заранее блокирует только правка правил.
  PERFORM 1 FROM platform_private.ai_documents d
  WHERE d.organization_id = v_ticket.organization_id
    AND (d.id = v_proposal.target_document_id
      OR d.id IN (SELECT x::UUID FROM jsonb_array_elements_text(v_proposal.sources) x))
  ORDER BY d.id FOR UPDATE;
  -- Эталонный ответ написан по этим версиям источников: другая версия или
  -- аудитория — PT409, иначе пример закрепился бы за текстом, которого он не видел.
  IF platform_private.ai_live_documents_map(v_ticket.organization_id,
      ARRAY(SELECT x::UUID FROM jsonb_array_elements_text(v_proposal.sources) x))
    IS DISTINCT FROM v_proposal.source_versions THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'sources';
  END IF;
  v_settings := platform_private.ai_settings_row(v_ticket.organization_id);

  IF v_proposal.kind = 'document' THEN
    SELECT * INTO v_doc FROM platform_private.ai_documents d
    WHERE d.organization_id = v_ticket.organization_id AND d.id = v_proposal.target_document_id FOR UPDATE;
    IF NOT FOUND OR v_doc.status NOT IN ('ready', 'review') OR v_doc.superseded_by_id IS NOT NULL
      OR v_doc.doc_version <> v_proposal.target_doc_version
      OR v_doc.content_sha256 IS DISTINCT FROM v_proposal.target_content_sha256
      OR p_base_sha IS DISTINCT FROM v_proposal.target_content_sha256
      OR NOT platform_private.ai_occurs_once(v_doc.content_md, v_proposal.before_text) THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'document';
    END IF;
    IF platform_private.ai_document_successor_pending(v_ticket.organization_id, v_doc.id) THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'replacement_pending';
    END IF;
    v_new := platform_private.ai_replace_once(v_doc.content_md, v_proposal.before_text, v_proposal.after_text);
    IF p_content IS DISTINCT FROM v_new OR p_new_document IS NOT NULL THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'content';
    END IF;
    PERFORM platform_private.ai_chunks_check(p_chunks, TRUE, TRUE);
    v_chunks := platform_private.ai_chunks_replace(v_doc.organization_id, v_doc.id, p_chunks);
    UPDATE platform_private.ai_documents d SET content_md = v_new,
      content_sha256 = platform_private.ai_text_sha256(v_new), doc_version = d.doc_version + 1,
      edited_in_lab = TRUE, indexed_at = clock_timestamp(), status = platform_private.ai_document_review_status(d.id),
      row_version = d.row_version + 1, updated_at = statement_timestamp(), updated_by = v_ticket.membership_id
    WHERE d.id = v_doc.id RETURNING * INTO v_doc;
    v_doc_id := v_doc.id;
  ELSIF v_proposal.kind = 'knowledge' THEN
    IF p_base_sha IS NOT NULL OR (p_content IS NOT NULL AND p_content <> v_proposal.after_text)
      OR (p_new_document ? 'title' AND p_new_document ->> 'title' IS DISTINCT FROM v_proposal.title)
      OR (p_new_document ? 'audience' AND p_new_document ->> 'audience' IS DISTINCT FROM v_proposal.audience) THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'content';
    END IF;
    PERFORM platform_private.ai_chunks_check(p_chunks, FALSE, TRUE);
    INSERT INTO platform_private.ai_documents (organization_id, title, kind, audience, status, stage, progress,
      content_md, content_sha256, source, source_ref, created_by, updated_by, indexed_at)
    VALUES (v_ticket.organization_id, v_proposal.title, 'knowledge', v_proposal.audience, 'ready', 'index', 100,
      v_proposal.after_text, platform_private.ai_text_sha256(v_proposal.after_text), 'lab',
      jsonb_build_object('kind', 'lab', 'proposalId', v_proposal.id), v_ticket.membership_id, v_ticket.membership_id,
      clock_timestamp())
    RETURNING * INTO v_doc;
    v_chunks := platform_private.ai_chunks_replace(v_doc.organization_id, v_doc.id, p_chunks);
    v_doc_id := v_doc.id;
  ELSIF v_proposal.kind = 'rules' THEN
    SELECT * INTO v_settings FROM platform_private.ai_settings s
    WHERE s.organization_id = v_ticket.organization_id FOR UPDATE;
    IF v_settings.rules_version_id IS DISTINCT FROM v_proposal.target_rules_version_id THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'rules';
    END IF;
    SELECT * INTO v_rules FROM platform_private.ai_rules_versions r
    WHERE r.organization_id = v_ticket.organization_id AND r.id = v_settings.rules_version_id;
    IF v_proposal.before_text IS NOT NULL AND NOT platform_private.ai_occurs_once(v_rules.body, v_proposal.before_text) THEN
      RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'rules';
    END IF;
    v_new := CASE WHEN v_rules.id IS NULL THEN v_proposal.after_text
      WHEN v_proposal.before_text IS NULL THEN v_rules.body || E'\n\n' || v_proposal.after_text
      ELSE platform_private.ai_replace_once(v_rules.body, v_proposal.before_text, v_proposal.after_text) END;
    IF (p_content IS NOT NULL AND p_content <> v_new) OR p_chunks IS NOT NULL OR p_new_document IS NOT NULL
      OR (p_base_sha IS NOT NULL AND p_base_sha IS DISTINCT FROM platform_private.ai_text_sha256(v_rules.body))
      OR octet_length(v_new) > 32768 THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'rules';
    END IF;
    INSERT INTO platform_private.ai_rules_versions (organization_id, version, body, source, source_ref, created_by,
      confirmed_at, confirmed_by)
    VALUES (v_ticket.organization_id, COALESCE((SELECT max(r.version) FROM platform_private.ai_rules_versions r
        WHERE r.organization_id = v_ticket.organization_id), 0) + 1, v_new, 'lab',
      jsonb_build_object('kind', 'lab', 'proposalId', v_proposal.id), v_ticket.membership_id, statement_timestamp(),
      v_ticket.membership_id)
    RETURNING * INTO v_new_rules;
    UPDATE platform_private.ai_settings s SET rules_version_id = v_new_rules.id, version = s.version + 1,
      updated_at = statement_timestamp(), updated_by = v_ticket.membership_id
    WHERE s.organization_id = v_ticket.organization_id;
  ELSE
    IF p_base_sha IS NOT NULL OR p_content IS NOT NULL OR p_chunks IS NOT NULL OR p_new_document IS NOT NULL THEN
      RAISE EXCEPTION 'ai_lab_edit_invalid' USING ERRCODE = '22023', DETAIL = 'example';
    END IF;
  END IF;

  -- Источники примера: живые документы предложения (проверены выше) и
  -- правленый/новый документ в его новой версии.
  SELECT COALESCE(array_agg(DISTINCT x), '{}') INTO v_ids FROM (
    SELECT s::UUID AS x FROM jsonb_array_elements_text(v_proposal.sources) s
    UNION SELECT v_doc_id WHERE v_doc_id IS NOT NULL) y;
  v_map := platform_private.ai_live_documents_map(v_ticket.organization_id, v_ids);
  IF (SELECT count(*) FROM jsonb_object_keys(v_map)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'ai_lab_changed' USING ERRCODE = 'PT409', DETAIL = 'sources';
  END IF;
  v_knowledge := platform_private.ai_bump_knowledge(v_ticket.organization_id);
  SELECT * INTO v_settings FROM platform_private.ai_settings s WHERE s.organization_id = v_ticket.organization_id;
  v_key := 'q:' || encode(sha256(convert_to(lower(regexp_replace(btrim(v_proposal.question), '\s+', ' ', 'g')),
    'UTF8')), 'hex');
  INSERT INTO platform_private.ai_golden_examples AS g (organization_id, question_key, question, answer, feedback,
    embedding, knowledge_version, source_document_ids, client_only, needs_review, confirmed_by, confirmed_at,
    rules_version_id, answer_model, source_doc_versions)
  VALUES (v_ticket.organization_id, v_key, v_proposal.question, v_proposal.answer, v_proposal.finding,
    (p_question_embedding::TEXT)::public.halfvec(1536), v_knowledge, v_ids,
    COALESCE((SELECT bool_and(e.value ->> 'a' = 'client') FROM jsonb_each(v_map) e), TRUE), FALSE,
    v_ticket.membership_id, statement_timestamp(), v_settings.rules_version_id, v_settings.answer_model, v_map)
  ON CONFLICT (organization_id, question_key) DO UPDATE SET question = EXCLUDED.question, answer = EXCLUDED.answer,
    feedback = EXCLUDED.feedback, embedding = EXCLUDED.embedding, knowledge_version = EXCLUDED.knowledge_version,
    source_document_ids = EXCLUDED.source_document_ids, client_only = EXCLUDED.client_only, needs_review = FALSE,
    confirmed_by = EXCLUDED.confirmed_by, confirmed_at = EXCLUDED.confirmed_at,
    rules_version_id = EXCLUDED.rules_version_id, answer_model = EXCLUDED.answer_model,
    source_doc_versions = EXCLUDED.source_doc_versions
  RETURNING g.id INTO v_example_id;

  v_result := jsonb_build_object('status', 'applied', 'kind', v_proposal.kind, 'proposalId', v_proposal.id,
    'documentId', v_doc_id, 'docVersion', v_doc.doc_version, 'rulesVersionId', v_new_rules.id,
    'rulesVersion', v_new_rules.version, 'exampleId', v_example_id, 'knowledgeVersion', v_knowledge,
    'chunkCount', (v_chunks ->> 'chunkCount')::INTEGER, 'reused', (v_chunks ->> 'reused')::INTEGER,
    'embedded', (v_chunks ->> 'embedded')::INTEGER);
  UPDATE platform_private.ai_lab_proposals p SET status = 'applied', decided_at = clock_timestamp(),
    decided_by = v_ticket.membership_id, result = jsonb_strip_nulls(v_result)
  WHERE p.id = v_proposal.id;
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (v_ticket.organization_id, 'user', v_identity.profile_id, 'auth:' || v_identity.auth_user_id::TEXT,
    'ai.agent.lab.apply', 'ai_lab_proposal', v_proposal.id,
    jsonb_build_object('kind', v_proposal.kind, 'documentId', v_proposal.target_document_id,
      'docVersion', v_proposal.target_doc_version, 'contentSha256', v_proposal.target_content_sha256,
      'rulesVersionId', v_proposal.target_rules_version_id, 'before', v_proposal.before_text,
      'proposalSha256', v_proposal.proposal_sha256),
    jsonb_strip_nulls(v_result || jsonb_build_object('after', v_proposal.after_text, 'title', v_proposal.title,
      'audience', v_proposal.audience, 'question', v_proposal.question)),
    'ИИ-агент: правка из Лаборатории', v_ticket.id);
  RETURN jsonb_strip_nulls(v_result) || jsonb_build_object('replayed', FALSE);
END
$$;

-- Уборка (269) + Лаборатория: истёкшие сессии, истёкшие предложения,
-- решённые предложения старше 90 дней.
CREATE OR REPLACE FUNCTION platform_ai_agent.maintenance_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tickets INTEGER; v_answers INTEGER; v_rates INTEGER; v_calls INTEGER; v_reservations INTEGER;
  v_sessions INTEGER; v_expired INTEGER; v_proposals INTEGER;
BEGIN
  DELETE FROM platform_private.ai_tickets t WHERE t.token_sha256 IN (SELECT o.token_sha256
    FROM platform_private.ai_tickets o WHERE o.expires_at < clock_timestamp() - INTERVAL '1 day' LIMIT 5000);
  GET DIAGNOSTICS v_tickets = ROW_COUNT;
  DELETE FROM platform_private.ai_answers a WHERE a.id IN (SELECT o.id FROM platform_private.ai_answers o
    WHERE o.created_at < clock_timestamp() - INTERVAL '90 days' LIMIT 5000);
  GET DIAGNOSTICS v_answers = ROW_COUNT;
  DELETE FROM platform_private.ai_rate_limits l WHERE l.window_start < clock_timestamp() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_rates = ROW_COUNT;
  DELETE FROM platform_private.ai_usage_calls c WHERE (c.organization_id, c.call_id) IN (SELECT o.organization_id,
    o.call_id FROM platform_private.ai_usage_calls o WHERE o.created_at < clock_timestamp() - INTERVAL '3 days' LIMIT 5000);
  GET DIAGNOSTICS v_calls = ROW_COUNT;
  DELETE FROM platform_private.ai_budget_reservations b WHERE b.id IN (SELECT o.id
    FROM platform_private.ai_budget_reservations o WHERE o.created_at < clock_timestamp() - INTERVAL '1 day' LIMIT 5000);
  GET DIAGNOSTICS v_reservations = ROW_COUNT;
  DELETE FROM platform_private.ai_lab_sessions s WHERE (s.organization_id, s.membership_id) IN (SELECT o.organization_id,
    o.membership_id FROM platform_private.ai_lab_sessions o WHERE o.expires_at < clock_timestamp() LIMIT 5000);
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  UPDATE platform_private.ai_lab_proposals p SET status = 'expired', decided_at = clock_timestamp()
  WHERE p.id IN (SELECT o.id FROM platform_private.ai_lab_proposals o
    WHERE o.status = 'proposed' AND o.expires_at < clock_timestamp() LIMIT 5000);
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  DELETE FROM platform_private.ai_lab_proposals p WHERE p.id IN (SELECT o.id FROM platform_private.ai_lab_proposals o
    WHERE o.status <> 'proposed' AND o.created_at < clock_timestamp() - INTERVAL '90 days' LIMIT 5000);
  GET DIAGNOSTICS v_proposals = ROW_COUNT;
  RETURN jsonb_build_object('tickets', v_tickets, 'answers', v_answers, 'rateWindows', v_rates,
    'usageCalls', v_calls, 'reservations', v_reservations, 'labSessions', v_sessions,
    'labProposalsExpired', v_expired, 'labProposalsDeleted', v_proposals);
END
$$;

-- ===========================================================================
-- Гранты и состав функций.
-- ===========================================================================
DO $ai273_acl$
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
$ai273_acl$;

DO $ai273_inventory$
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
      'ai_agent_document_upload_v1', 'ai_agent_document_v1', 'ai_agent_documents_v1', 'ai_agent_example_delete_v1',
      'ai_agent_examples_v1', 'ai_agent_lab_discard_v1', 'ai_agent_lab_reject_v1', 'ai_agent_lab_v1',
      'ai_agent_review_resolve_v1', 'ai_agent_review_v1', 'ai_agent_rules_confirm_v1', 'ai_agent_rules_save_v1',
      'ai_agent_rules_v1', 'ai_agent_seed_from_kb_v1', 'ai_agent_settings_save_v1', 'ai_agent_settings_v1',
      'ai_agent_spend_v1', 'ai_agent_storage_authorize_v1', 'ai_agent_ticket_v1']
    OR v_agent IS DISTINCT FROM ARRAY['answer_claim_v1', 'answer_finish_v1', 'answer_heartbeat_v1',
      'budget_release_v1', 'budget_reserve_v1', 'conversation_context_v1', 'document_claim_v1',
      'document_content_put_v1', 'document_index_v1', 'document_pages_put_v1', 'document_reindex_claim_v1',
      'document_reindex_v1', 'document_stage_v1', 'lab_apply_prepare_v1', 'lab_apply_v1', 'lab_documents_v1',
      'lab_proposal_put_v1', 'lab_session_get_v1', 'lab_session_put_v1', 'maintenance_v1', 'rate_take_v1', 'ready_v1',
      'redeem_ticket_v1', 'review_items_put_v1', 'search_v1', 'settings_v1', 'usage_record_v1', 'work_claim_v1',
      'work_extend_v1', 'work_finish_v1'] THEN
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
$ai273_inventory$;

COMMENT ON FUNCTION platform_ai_agent.lab_apply_v1(UUID, TEXT, TEXT, JSONB, JSONB, JSONB) IS
  'AI agent P2: apply the caller''s own unexpired Laboratory proposal in one transaction (document edit in place, new knowledge document or confirmed rules version) and upsert its golden example; PT409 ai_lab_changed when the target moved.';
COMMENT ON FUNCTION platform.ai_agent_ticket_v1(UUID, TEXT, UUID, UUID) IS
  'AI agent: one-time 60 s ticket for the private agent service. answer: ai.agent.use + the sales conversation; laboratory: ai.agent.use; lab_apply: ai.agent.manage + the caller''s own proposed proposal. Consent required.';

NOTIFY pgrst, 'reload schema';
COMMIT;
