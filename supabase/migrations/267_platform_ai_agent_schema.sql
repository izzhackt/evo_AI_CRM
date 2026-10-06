-- 267_platform_ai_agent_schema — «ИИ-агент» P1: роль evo_ai_agent, схема
-- platform_ai_agent, таблицы platform_private.ai_*, очередь ai_agent_work_v1 и
-- датированные цены Gemini. Контракт: docs/EVO_AI_AGENT_PLAN_2026-10-06.md
-- §4.4, §5.1–5.4, §10; ADR 0032.
--
-- Что делает:
--  * роль evo_ai_agent: NOLOGIN NOINHERIT NOBYPASSRLS, без членства в других
--    ролях, statement_timeout 15 s, idle_in_transaction_session_timeout 30 s.
--    LOGIN, пароль и CONNECTION LIMIT 10 задаёт оператор вне Git по отдельному
--    разрешению (план §4.4, §15 P0); миграция их не задаёт и не читает;
--  * схема platform_ai_agent (не входит в exposed-список PostgREST): USAGE
--    только у evo_ai_agent; функции появляются в 269;
--  * таблицы platform_private.ai_*: RLS ENABLE + FORCE без политик, все права
--    отозваны у PUBLIC, anon, authenticated, service_role, supabase_auth_admin.
--    Доступ только через SECURITY DEFINER-функции 269;
--  * ai_chunks: halfvec(1536) с HNSW (halfvec_cosine_ops, m 16,
--    ef_construction 64) и GENERATED tsvector `russian` (A — section_path,
--    C — context, B — coalesce(index_text, content)) с GIN;
--  * очереди pgmq ai_agent_work_v1 и ai_agent_dead_letter_v1 (поправка к
--    контракту P2G: роль агента физически не может взять работу
--    platform_work_v1);
--  * цены Gemini со страницы https://ai.google.dev/gemini-api/docs/pricing
--    (обновлена 2026-10-01, сверено 2026-10-06), включая удвоение Flash с
--    2027-01-01.
--
-- Безопасно для production: новые объекты, внешние ключи только на
-- platform.organizations; горячие таблицы (диалоги, сообщения, WAHA) не
-- блокируются и не меняются; объекты 030/054/065–067/075/091 не трогаются.
-- Повторный запуск — без изменений (IF NOT EXISTS, ON CONFLICT DO NOTHING,
-- проверки существующих объектов).
BEGIN;

-- ---------------------------------------------------------------------------
-- Предусловия: pgvector с halfvec, pgmq, конфигурация FTS russian.
-- ---------------------------------------------------------------------------
DO $ai267_preconditions$
DECLARE signature TEXT;
BEGIN
  IF to_regtype('public.halfvec') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_requires_pgvector_halfvec' USING ERRCODE = '0A000';
  END IF;
  IF to_regclass('pgmq.meta') IS NULL THEN
    RAISE EXCEPTION 'ai_agent_requires_pgmq' USING ERRCODE = '0A000';
  END IF;
  FOREACH signature IN ARRAY ARRAY[
    'pgmq.create(text)', 'pgmq.read(text,integer,integer,jsonb)', 'pgmq.send(text,jsonb,integer)',
    'pgmq.set_vt(text,bigint,integer)', 'pgmq.archive(text,bigint)'
  ] LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'ai_agent_requires_pgmq_signature %', signature USING ERRCODE = '0A000';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config c JOIN pg_catalog.pg_namespace n ON n.oid = c.cfgnamespace
    WHERE n.nspname = 'pg_catalog' AND c.cfgname = 'russian') THEN
    RAISE EXCEPTION 'ai_agent_requires_russian_text_search' USING ERRCODE = '0A000';
  END IF;
END
$ai267_preconditions$;

-- ---------------------------------------------------------------------------
-- Роль. Создаётся без входа; существующая роль принимается только с теми же
-- безопасными атрибутами и без членства в других ролях.
-- ---------------------------------------------------------------------------
DO $ai267_role$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'evo_ai_agent';
  IF NOT FOUND THEN
    CREATE ROLE evo_ai_agent NOLOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSIF r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit THEN
    RAISE EXCEPTION 'ai_agent_role_unsafe_attributes' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'evo_ai_agent')) THEN
    RAISE EXCEPTION 'ai_agent_role_must_not_be_a_member' USING ERRCODE = '55000';
  END IF;
END
$ai267_role$;

ALTER ROLE evo_ai_agent SET statement_timeout = '15s';
ALTER ROLE evo_ai_agent SET idle_in_transaction_session_timeout = '30s';
-- Пустой search_path: агент обращается к функциям только по полному имени.
ALTER ROLE evo_ai_agent SET search_path = '';
COMMENT ON ROLE evo_ai_agent IS
  'EVO AI agent service (plan 2026-10-06 §4.4). EXECUTE on platform_ai_agent functions only; LOGIN/password/CONNECTION LIMIT are set by an operator outside Git.';

-- ---------------------------------------------------------------------------
-- Схема функций агента.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS platform_ai_agent AUTHORIZATION postgres;
DO $ai267_schema_owner$
BEGIN
  IF (SELECT nspowner::regrole::TEXT FROM pg_catalog.pg_namespace WHERE nspname = 'platform_ai_agent') <> 'postgres' THEN
    RAISE EXCEPTION 'ai_agent_schema_owner_drift' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'platform_ai_agent') THEN
    RAISE EXCEPTION 'ai_agent_schema_must_hold_functions_only' USING ERRCODE = '55000';
  END IF;
END
$ai267_schema_owner$;
REVOKE ALL ON SCHEMA platform_ai_agent FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA platform_ai_agent TO evo_ai_agent;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_ai_agent
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_ai_agent
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_ai_agent
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform_ai_agent
  REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
COMMENT ON SCHEMA platform_ai_agent IS
  'Functions of the private AI agent service (role evo_ai_agent). Not exposed through PostgREST.';

-- ---------------------------------------------------------------------------
-- Таблицы (platform_private, только через функции).
-- ---------------------------------------------------------------------------

-- «Правила общения»: версии только добавляются (триггер ниже).
CREATE TABLE IF NOT EXISTS platform_private.ai_rules_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  version INTEGER NOT NULL CHECK (version > 0),
  body TEXT NOT NULL CHECK (btrim(body) <> '' AND octet_length(body) <= 32768),
  source TEXT NOT NULL CHECK (source IN ('seed', 'lab', 'manual')),
  source_ref JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(source_ref) = 'object' AND octet_length(source_ref::TEXT) <= 8192),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  CONSTRAINT ai_rules_versions_org_version_key UNIQUE (organization_id, version),
  CONSTRAINT ai_rules_versions_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT ai_rules_versions_confirmation_check CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);

-- Одна строка на организацию. ID моделей — явные, без алиасов (*latest*).
CREATE TABLE IF NOT EXISTS platform_private.ai_settings (
  organization_id UUID PRIMARY KEY REFERENCES platform.organizations(id),
  answer_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  fast_model TEXT NOT NULL DEFAULT 'gemini-3.5-flash-lite',
  vision_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  arbiter_model TEXT NOT NULL DEFAULT 'gemini-3.1-pro-preview',
  arbiter_fallback_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  embedding_model TEXT NOT NULL DEFAULT 'gemini-embedding-2',
  embedding_dim INTEGER NOT NULL DEFAULT 1536 CHECK (embedding_dim = 1536),
  precompute_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  memory_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_cap_usd NUMERIC(12, 2) NOT NULL DEFAULT 100
    CHECK (monthly_cap_usd >= 0 AND monthly_cap_usd <= 100000),
  rate_per_member_minute INTEGER NOT NULL DEFAULT 20 CHECK (rate_per_member_minute BETWEEN 1 AND 120),
  timezone TEXT NOT NULL DEFAULT 'Asia/Bishkek' CHECK (timezone = 'Asia/Bishkek'),
  rerank_mode TEXT NOT NULL DEFAULT 'off' CHECK (rerank_mode = 'off'),
  knowledge_version BIGINT NOT NULL DEFAULT 1 CHECK (knowledge_version > 0),
  rules_version_id UUID,
  gemini_consent_at TIMESTAMPTZ,
  gemini_consent_by UUID,
  gemini_consent_text_version TEXT CHECK (gemini_consent_text_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by UUID,
  CONSTRAINT ai_settings_models_check CHECK (
    answer_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$' AND fast_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'
    AND vision_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$' AND arbiter_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'
    AND arbiter_fallback_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'
    AND embedding_model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'
    AND concat_ws(' ', answer_model, fast_model, vision_model, arbiter_model, arbiter_fallback_model,
      embedding_model) NOT LIKE '%latest%'),
  CONSTRAINT ai_settings_consent_check CHECK (
    (gemini_consent_at IS NULL) = (gemini_consent_by IS NULL)
    AND (gemini_consent_at IS NULL) = (gemini_consent_text_version IS NULL)),
  CONSTRAINT ai_settings_rules_fkey FOREIGN KEY (organization_id, rules_version_id)
    REFERENCES platform_private.ai_rules_versions(organization_id, id)
);

-- Материалы «Информации для агента».
CREATE TABLE IF NOT EXISTS platform_private.ai_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240 AND title !~ '[\x00-\x1F\x7F]'),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'docx', 'xlsx', 'csv', 'pdf', 'image', 'knowledge')),
  audience TEXT NOT NULL DEFAULT 'client' CHECK (audience IN ('client', 'internal')),
  autosend_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'review', 'ready', 'failed', 'superseded')),
  stage TEXT CHECK (stage IN ('extract', 'ocr', 'structure', 'chunk', 'enrich', 'embed', 'index')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_code TEXT CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  storage_path TEXT CHECK (char_length(storage_path) BETWEEN 1 AND 512),
  byte_sha256 TEXT CHECK (byte_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size BIGINT CHECK (byte_size BETWEEN 0 AND 26214400),
  mime_type TEXT CHECK (char_length(mime_type) <= 160),
  content_md TEXT CHECK (char_length(content_md) <= 2000000),
  page_count INTEGER CHECK (page_count BETWEEN 0 AND 300),
  replaces_id UUID,
  superseded_by_id UUID,
  source TEXT NOT NULL CHECK (source IN ('upload', 'seed_kb', 'lab')),
  source_ref JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(source_ref) = 'object' AND octet_length(source_ref::TEXT) <= 8192),
  edited_in_lab BOOLEAN NOT NULL DEFAULT FALSE,
  doc_version INTEGER NOT NULL DEFAULT 1 CHECK (doc_version > 0),
  row_version BIGINT NOT NULL DEFAULT 1 CHECK (row_version > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner TEXT CHECK (char_length(lease_owner) BETWEEN 1 AND 200),
  lease_expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  indexed_at TIMESTAMPTZ,
  CONSTRAINT ai_documents_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT ai_documents_replaces_fkey FOREIGN KEY (organization_id, replaces_id)
    REFERENCES platform_private.ai_documents(organization_id, id) ON DELETE SET NULL (replaces_id),
  CONSTRAINT ai_documents_superseded_by_fkey FOREIGN KEY (organization_id, superseded_by_id)
    REFERENCES platform_private.ai_documents(organization_id, id) ON DELETE SET NULL (superseded_by_id),
  CONSTRAINT ai_documents_autosend_client_check CHECK (NOT autosend_allowed OR audience = 'client'),
  CONSTRAINT ai_documents_seed_kind_check CHECK (source <> 'seed_kb' OR kind = 'knowledge'),
  CONSTRAINT ai_documents_lease_check CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
-- Дубликат файла отклоняется среди не заменённых документов (§7).
CREATE UNIQUE INDEX IF NOT EXISTS ai_documents_live_sha_key
  ON platform_private.ai_documents (organization_id, byte_sha256)
  WHERE byte_sha256 IS NOT NULL AND status <> 'superseded';
-- Одна живая копия одной версии страницы «Базы знаний» (§14).
CREATE UNIQUE INDEX IF NOT EXISTS ai_documents_live_seed_key
  ON platform_private.ai_documents (organization_id, (source_ref ->> 'nodeId'), (source_ref ->> 'nodeVersion'))
  WHERE source = 'seed_kb' AND status <> 'superseded';
CREATE INDEX IF NOT EXISTS ai_documents_org_status_idx
  ON platform_private.ai_documents (organization_id, status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS platform_private.ai_document_pages (
  organization_id UUID NOT NULL,
  document_id UUID NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no BETWEEN 1 AND 300),
  sheet_name TEXT CHECK (char_length(sheet_name) <= 200),
  image_path TEXT CHECK (char_length(image_path) <= 512),
  width INTEGER CHECK (width > 0),
  height INTEGER CHECK (height > 0),
  method TEXT NOT NULL CHECK (method IN ('text', 'ocr')),
  confidence NUMERIC(5, 4) CHECK (confidence BETWEEN 0 AND 1),
  text_md TEXT NOT NULL DEFAULT '' CHECK (char_length(text_md) <= 200000),
  PRIMARY KEY (document_id, page_no),
  FOREIGN KEY (organization_id, document_id)
    REFERENCES platform_private.ai_documents(organization_id, id) ON DELETE CASCADE
);

-- Фрагменты для поиска.
CREATE TABLE IF NOT EXISTS platform_private.ai_chunks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  document_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 99999),
  section_path TEXT NOT NULL DEFAULT '' CHECK (char_length(section_path) <= 1000),
  content TEXT NOT NULL CHECK (btrim(content) <> '' AND char_length(content) <= 16000),
  context TEXT NOT NULL DEFAULT '' CHECK (char_length(context) <= 2000),
  lang TEXT NOT NULL DEFAULT 'ru' CHECK (lang IN ('ru', 'ky', 'en', 'other')),
  index_text TEXT CHECK (char_length(index_text) <= 16000),
  page_from INTEGER CHECK (page_from BETWEEN 1 AND 300),
  page_to INTEGER CHECK (page_to BETWEEN 1 AND 300 AND page_to >= page_from),
  sheet_name TEXT CHECK (char_length(sheet_name) <= 200),
  boxes JSONB CHECK (boxes IS NULL OR (jsonb_typeof(boxes) = 'array' AND octet_length(boxes::TEXT) <= 65536)),
  tokens INTEGER CHECK (tokens BETWEEN 0 AND 8192),
  embedding public.halfvec(1536),
  fts TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('pg_catalog.russian'::regconfig, section_path), 'A')
    || setweight(to_tsvector('pg_catalog.russian'::regconfig, context), 'C')
    || setweight(to_tsvector('pg_catalog.russian'::regconfig, COALESCE(index_text, content)), 'B')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_chunks_document_position_key UNIQUE (document_id, position),
  CONSTRAINT ai_chunks_document_fkey FOREIGN KEY (organization_id, document_id)
    REFERENCES platform_private.ai_documents(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_chunks_embedding_hnsw
  ON platform_private.ai_chunks USING hnsw (embedding public.halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS ai_chunks_fts_gin ON platform_private.ai_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS ai_chunks_org_document_idx ON platform_private.ai_chunks (organization_id, document_id);

-- «Лист сверки» (заполняется в P2; поиск P1 уже возвращает открытые пункты).
CREATE TABLE IF NOT EXISTS platform_private.ai_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  document_id UUID NOT NULL,
  page_no INTEGER NOT NULL CHECK (page_no BETWEEN 1 AND 300),
  bbox JSONB CHECK (bbox IS NULL OR jsonb_typeof(bbox) = 'array'),
  crop_path TEXT CHECK (char_length(crop_path) <= 512),
  kind TEXT NOT NULL CHECK (kind IN ('number', 'text')),
  candidates JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(candidates) = 'object' AND octet_length(candidates::TEXT) <= 16384),
  proposed TEXT CHECK (char_length(proposed) <= 2000),
  value TEXT CHECK (char_length(value) <= 2000),
  anchor TEXT CHECK (char_length(anchor) <= 2000),
  value_index INTEGER CHECK (value_index >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_review_items_document_fkey FOREIGN KEY (organization_id, document_id)
    REFERENCES platform_private.ai_documents(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_review_items_resolution_check CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ai_review_items_open_idx
  ON platform_private.ai_review_items (document_id, page_no) WHERE status = 'open';

-- Подтверждённые примеры ответов (наполняются Лабораторией в P2).
CREATE TABLE IF NOT EXISTS platform_private.ai_golden_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  question_key TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 1 AND 200),
  question TEXT NOT NULL CHECK (btrim(question) <> '' AND char_length(question) <= 4000),
  answer TEXT NOT NULL CHECK (btrim(answer) <> '' AND char_length(answer) <= 8000),
  feedback TEXT NOT NULL DEFAULT '' CHECK (char_length(feedback) <= 4000),
  embedding public.halfvec(1536),
  knowledge_version BIGINT NOT NULL CHECK (knowledge_version > 0),
  source_document_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(source_document_ids) <= 50),
  client_only BOOLEAN NOT NULL DEFAULT TRUE,
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_by UUID NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_golden_examples_question_key UNIQUE (organization_id, question_key)
);

-- Ответы и их кэш (хранятся 90 дней).
CREATE TABLE IF NOT EXISTS platform_private.ai_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  conversation_id UUID NOT NULL,
  source_message_id UUID,
  intent TEXT NOT NULL CHECK (intent IN ('reply', 'followup')),
  knowledge_fingerprint TEXT NOT NULL CHECK (knowledge_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'superseded')),
  result JSONB CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::TEXT) <= 262144)),
  error_code TEXT CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  flight_owner TEXT CHECK (char_length(flight_owner) BETWEEN 1 AND 200),
  heartbeat_at TIMESTAMPTZ,
  requested_by UUID,
  model TEXT CHECK (char_length(model) <= 80),
  cost_usd NUMERIC(12, 6) CHECK (cost_usd >= 0),
  timings JSONB CHECK (timings IS NULL OR (jsonb_typeof(timings) = 'object' AND octet_length(timings::TEXT) <= 4096)),
  inserted_at TIMESTAMPTZ,
  inserted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ai_answers_identity_key UNIQUE NULLS NOT DISTINCT
    (organization_id, conversation_id, intent, source_message_id, knowledge_fingerprint),
  CONSTRAINT ai_answers_ready_check CHECK (status <> 'ready' OR result IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_answers_conversation_idx
  ON platform_private.ai_answers (organization_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_answers_created_idx ON platform_private.ai_answers (created_at);

-- Одноразовые билеты CRM → агент. Хранится только SHA-256 токена.
CREATE TABLE IF NOT EXISTS platform_private.ai_tickets (
  token_sha256 TEXT PRIMARY KEY CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  membership_id UUID NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('answer')),
  conversation_id UUID,
  ref_id UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  rate_taken_at TIMESTAMPTZ,
  CONSTRAINT ai_tickets_lifetime_check CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
  CONSTRAINT ai_tickets_answer_check CHECK (purpose <> 'answer' OR conversation_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ai_tickets_expires_idx ON platform_private.ai_tickets (expires_at);

-- Датированные цены (USD за 1 млн токенов), общие для организаций.
CREATE TABLE IF NOT EXISTS platform_private.ai_prices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model TEXT NOT NULL CHECK (model ~ '^gemini-[a-z0-9][a-z0-9.-]{0,70}$'),
  kind TEXT NOT NULL CHECK (kind IN ('input', 'output', 'cached', 'audio_input', 'embedding')),
  usd_per_million NUMERIC(12, 6) NOT NULL CHECK (usd_per_million >= 0),
  effective_from DATE NOT NULL,
  effective_to DATE CHECK (effective_to >= effective_from),
  source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
  checked_at DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  CONSTRAINT ai_prices_model_kind_from_key UNIQUE (model, kind, effective_from)
);

-- Журнал расходов: день по Asia/Bishkek.
CREATE TABLE IF NOT EXISTS platform_private.ai_usage_daily (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  day DATE NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  answers INTEGER NOT NULL DEFAULT 0 CHECK (answers >= 0),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  thinking_tokens BIGINT NOT NULL DEFAULT 0 CHECK (thinking_tokens >= 0),
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0 AND estimated_cost_usd <= cost_usd),
  estimated BOOLEAN NOT NULL DEFAULT FALSE,
  unpriced_calls INTEGER NOT NULL DEFAULT 0 CHECK (unpriced_calls >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, day, purpose, model)
);
CREATE TABLE IF NOT EXISTS platform_private.ai_usage_member_daily (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  day DATE NOT NULL,
  membership_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 80),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  answers INTEGER NOT NULL DEFAULT 0 CHECK (answers >= 0),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  thinking_tokens BIGINT NOT NULL DEFAULT 0 CHECK (thinking_tokens >= 0),
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0 AND estimated_cost_usd <= cost_usd),
  estimated BOOLEAN NOT NULL DEFAULT FALSE,
  unpriced_calls INTEGER NOT NULL DEFAULT 0 CHECK (unpriced_calls >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, day, membership_id, purpose, model)
);
-- Повтор записи одного вызова (тот же call_id) не считается дважды.
CREATE TABLE IF NOT EXISTS platform_private.ai_usage_calls (
  organization_id UUID NOT NULL,
  call_id UUID NOT NULL,
  day DATE NOT NULL,
  cost_usd NUMERIC(12, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, call_id)
);
CREATE INDEX IF NOT EXISTS ai_usage_calls_created_idx ON platform_private.ai_usage_calls (created_at);

-- Резерв стоимости под месячный лимит (как бюджет распознавания 162).
CREATE TABLE IF NOT EXISTS platform_private.ai_budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  purpose TEXT NOT NULL,
  usd NUMERIC(12, 6) NOT NULL CHECK (usd > 0 AND usd <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_budget_reservations_open_idx
  ON platform_private.ai_budget_reservations (organization_id, created_at) WHERE settled_at IS NULL;

-- Счётчики лимита «20 ответов в минуту на сотрудника» (UNLOGGED: потеря при
-- аварийном перезапуске только обнуляет текущую минуту).
CREATE UNLOGGED TABLE IF NOT EXISTS platform_private.ai_rate_limits (
  organization_id UUID NOT NULL,
  membership_id UUID NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (organization_id, membership_id, window_start)
);

-- Квитанции команд сотрудников (повтор по request_id).
CREATE TABLE IF NOT EXISTS platform_private.ai_requests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  request_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.]{0,63}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, request_id)
);

-- «Правила общения» только добавляются; подтверждение ставится один раз.
CREATE OR REPLACE FUNCTION platform_private.ai_rules_versions_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['confirmed_at', 'confirmed_by']) = (to_jsonb(OLD) - ARRAY['confirmed_at', 'confirmed_by']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ai_rules_versions_append_only' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION platform_private.ai_rules_versions_guard()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
DROP TRIGGER IF EXISTS ai_rules_versions_append_only ON platform_private.ai_rules_versions;
CREATE TRIGGER ai_rules_versions_append_only BEFORE UPDATE OR DELETE ON platform_private.ai_rules_versions
  FOR EACH ROW EXECUTE FUNCTION platform_private.ai_rules_versions_guard();
DROP TRIGGER IF EXISTS ai_rules_versions_no_truncate ON platform_private.ai_rules_versions;
CREATE TRIGGER ai_rules_versions_no_truncate BEFORE TRUNCATE ON platform_private.ai_rules_versions
  FOR EACH STATEMENT EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- RLS включён и принудителен, политик нет; права отозваны у всех ролей API.
DO $ai267_lockdown$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_rules_versions', 'ai_settings', 'ai_documents', 'ai_document_pages', 'ai_chunks',
    'ai_review_items', 'ai_golden_examples', 'ai_answers', 'ai_tickets', 'ai_prices', 'ai_usage_daily',
    'ai_usage_member_daily', 'ai_usage_calls', 'ai_budget_reservations', 'ai_rate_limits', 'ai_requests'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform_private.%I FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = 'platform_private' AND tablename = t) THEN
      RAISE EXCEPTION 'ai_agent_table_has_policies: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
  REVOKE ALL ON SEQUENCE platform_private.ai_chunks_id_seq, platform_private.ai_prices_id_seq
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
END
$ai267_lockdown$;

-- Строка настроек для каждой организации; новые организации получают её
-- при первом обращении (platform_private.ai_settings_row, 269).
INSERT INTO platform_private.ai_settings (organization_id)
SELECT o.id FROM platform.organizations o
ON CONFLICT (organization_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Цены Gemini (paid tier, USD за 1 млн токенов). Источник — официальная
-- страница цен, обновлена 2026-10-01, сверено 2026-10-06. Flash удваивается с
-- 2027-01-01. Pro preview — тариф промптов ≤ 200k токенов (длиннее агент не
-- отправляет). Аудио Flash-Lite входит в цену входа.
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.ai_prices
  (model, kind, usd_per_million, effective_from, effective_to, source_url, checked_at, note)
VALUES
  ('gemini-3.8-flash', 'input', 0.75, DATE '2026-10-01', DATE '2026-12-31',
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier'),
  ('gemini-3.8-flash', 'input', 1.50, DATE '2027-01-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; announced doubling'),
  ('gemini-3.8-flash', 'output', 3.75, DATE '2026-10-01', DATE '2026-12-31',
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; output incl. thinking'),
  ('gemini-3.8-flash', 'output', 7.50, DATE '2027-01-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; announced doubling'),
  ('gemini-3.8-flash', 'cached', 0.075, DATE '2026-10-01', DATE '2026-12-31',
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; context caching'),
  ('gemini-3.8-flash', 'cached', 0.15, DATE '2027-01-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; announced doubling'),
  ('gemini-3.5-flash-lite', 'input', 0.30, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; text/image/video/audio'),
  ('gemini-3.5-flash-lite', 'audio_input', 0.30, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; audio included in input price'),
  ('gemini-3.5-flash-lite', 'output', 2.50, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; output incl. thinking'),
  ('gemini-3.5-flash-lite', 'cached', 0.03, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; context caching'),
  ('gemini-3.1-pro-preview', 'input', 2.00, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; prompts <= 200k tokens'),
  ('gemini-3.1-pro-preview', 'output', 12.00, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; prompts <= 200k tokens'),
  ('gemini-3.1-pro-preview', 'cached', 0.20, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; prompts <= 200k tokens'),
  ('gemini-embedding-2', 'embedding', 0.20, DATE '2026-10-01', NULL,
    'https://ai.google.dev/gemini-api/docs/pricing', DATE '2026-10-06', 'paid tier; text input')
ON CONFLICT (model, kind, effective_from) DO NOTHING;

-- Периоды одной цены не пересекаются.
DO $ai267_prices$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_private.ai_prices a JOIN platform_private.ai_prices b
    ON a.model = b.model AND a.kind = b.kind AND a.id < b.id
    AND daterange(a.effective_from, a.effective_to, '[]') && daterange(b.effective_from, b.effective_to, '[]')) THEN
    RAISE EXCEPTION 'ai_prices_overlap' USING ERRCODE = '23P01';
  END IF;
END
$ai267_prices$;

-- ---------------------------------------------------------------------------
-- Очередь агента: только указатели {v, kind, ref_id}; повтор до трёх попыток
-- по read_ct, затем dead-letter (обёртки — в 269).
-- ---------------------------------------------------------------------------
DO $ai267_queues$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'ai_agent_work_v1') THEN
    PERFORM pgmq.create('ai_agent_work_v1');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = 'ai_agent_dead_letter_v1') THEN
    PERFORM pgmq.create('ai_agent_dead_letter_v1');
  END IF;
END
$ai267_queues$;
-- Только объекты двух новых очередей (без правки ACL живой platform_work_v1).
DO $ai267_queue_acl$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT c.oid::REGCLASS AS rel, c.relkind FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgmq' AND c.relkind IN ('r', 'p', 'S')
      AND c.relname ~ '^[qa]_ai_agent_(work|dead_letter)_v1(_msg_id_seq)?$' LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent',
      CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.rel);
  END LOOP;
END
$ai267_queue_acl$;

COMMIT;
