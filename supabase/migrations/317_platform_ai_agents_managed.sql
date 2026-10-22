-- 317: «ИИ-агенты» на Claude Managed Agents - база данных (часть A контракта
-- docs/design/ai-agents/contract.md; ADR 0035; docs/PLAN_CHANGES.md «2026-10-22 · ИИ-агенты на
-- Claude Managed Agents: план»). Решение владельца 22.10.2026: отдел «ИИ-агенты» управляется из
-- CRM, у каждого агента свои переключатели «Включён» и «Авто», инструментам доступно всё,
-- ограничения - промптом, расходы задаёт владелец в Claude Console.
--
-- Forward-only. Новые объекты: восемь закрытых таблиц `platform_private.ai_agent*` (+ справочник
-- схем инструментов), функции сотрудника `platform.ai_agents_*_v1` (EXECUTE только authenticated),
-- функции рантайма CRM `platform.ai_agent_runtime_*_v1`, MCP `platform.ai_agent_mcp_*_v1` и
-- 24 инструмента `platform.ai_agent_tool_<имя>_v1` (EXECUTE только service_role). Все функции
-- SECURITY DEFINER с пустым search_path; таблицы FORCE RLS без политик и без грантов API.
--
--  A) Данные. `ai_agents` (7 агентов каталога на организацию, сид дословно по contract.ts),
--     `ai_agents_org_settings` (ответственный сотрудник: от его имени пишутся задачи, заметки
--     и сообщения агентов), `ai_agent_runs`, `ai_agent_actions`, `ai_agent_drafts`,
--     `ai_agent_digests`, `ai_agent_file_grants`, `ai_agent_dedupe`.
--  B) Токен MCP хранится только как SHA-256 (текущий и прежний с окном 10 минут при ротации);
--     токен файла (`get_document_file`) - тоже только SHA-256, срок 10 минут, не более 3 раз.
--  C) Отправка клиентам (`send_message`): при выключенном «Авто» и без кода полномочия создаётся
--     ЧЕРНОВИК; «Авто» или код полномочия открытого запуска - прямая отправка, но предохранители
--     (сотрудник писал в чат за 30 минут; 6 в час на чат, 60 в час на организацию; последнее
--     входящее всё ещё последнее; отправитель имеет право) живут в базе, а не в промпте.
--     WhatsApp идёт тем же каноническим путём, что ручная отправка и автоответчик (276):
--     `manual_send_authorizations` с новым видом `ai_agent` -> очередь -> WAHA -> итог.
--     Триггер-страж 276 пересоздаётся: ветки `manual` и `ai_autosend` - байт в байт, новая ветка
--     `ai_agent`.
--  D) Журнал платформы: 11 действий `ai.agent.*` и 3 типа объектов `ai_agent`, `ai_agent_run`,
--     `ai_agent_draft` (rename-and-union, как 311 и 316). Актор действий агента - `service` с
--     принципалом `ai-agent:<ключ>`; в записи нет текстов инструкций, сообщений и документов.
--
-- Порядок выката. Приложение без миграции показывает «Раздел готовится», MCP отвечает 503;
-- миграция может идти до приложения. Повторный запуск: a317_already_applied (55000).
BEGIN;

-- ---------------------------------------------------------------------------
-- Якоря: объекты, на которые опирается миграция, md5 заменяемого стража (276) и свободные имена.
-- ---------------------------------------------------------------------------
DO $a317_anchor$
BEGIN
  IF to_regclass('platform.audit_events') IS NULL
    OR to_regclass('platform.organizations') IS NULL
    OR to_regclass('platform.organization_memberships') IS NULL
    OR to_regclass('platform.profiles') IS NULL
    OR to_regclass('platform.manual_send_authorizations') IS NULL
    OR to_regclass('platform.communication_conversations') IS NULL
    OR to_regclass('platform.communication_messages') IS NULL
    OR to_regclass('platform.case_chat_messages') IS NULL
    OR to_regclass('platform.case_chat_threads') IS NULL
    OR to_regclass('platform.case_notes') IS NULL
    OR to_regclass('platform.case_tasks') IS NULL
    OR to_regclass('platform.case_task_events') IS NULL
    OR to_regclass('platform.staff_tasks') IS NULL
    OR to_regclass('platform.staff_task_events') IS NULL
    OR to_regclass('platform.staff_notifications') IS NULL
    OR to_regclass('platform_private.staff_task_receipts') IS NULL
    OR to_regclass('platform_private.staff_lead_task_links') IS NULL
    OR to_regclass('platform_private.sales_register') IS NULL
    OR to_regclass('platform_private.telephony_calls') IS NULL
    OR to_regclass('platform_private.ai_chunks') IS NULL
    OR to_regclass('platform_private.kb_nodes') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions()') IS NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types()') IS NULL
    OR to_regprocedure('platform_private.ai_staff_actor(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.require_p2g_service()') IS NULL
    OR to_regprocedure('platform_private.staff_membership_identity(uuid,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_access(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.staff_can_receive_assignment(uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('platform_private.p3c_request_child_id(uuid,text)') IS NULL
    OR to_regprocedure('platform_private.p3c_enqueue_authenticated_work(uuid,platform.durable_work_kind,uuid,uuid,text,integer,uuid,platform.durable_work_operation,uuid,uuid,text)') IS NULL
    OR to_regprocedure('platform_private.guard_ai_autosend_authorization()') IS NULL
    OR to_regprocedure('platform_private.ai_message_view(platform.communication_messages)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'manual_send_authorizations' AND c.column_name = 'kind')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'platform' AND c.table_name = 'organization_memberships' AND c.column_name = 'is_system_admin')
  THEN
    RAISE EXCEPTION 'a317_anchor_drift: the 276 / 311 / 316 objects this migration builds on are missing' USING ERRCODE = '55000';
  END IF;
  IF to_regclass('platform_private.ai_agents') IS NOT NULL
    OR to_regclass('platform_private.ai_agent_runs') IS NOT NULL
    OR to_regprocedure('platform.ai_agents_list_v1(uuid)') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()') IS NOT NULL
    OR to_regprocedure('platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()') IS NOT NULL
    OR 'ai.agent.config.change' = ANY (platform_private.p7a_safe_audit_actions())
    OR 'ai_agent' = ANY (platform_private.p7a_safe_audit_resource_types())
  THEN
    RAISE EXCEPTION 'a317_already_applied' USING ERRCODE = '55000';
  END IF;
  -- 276: the insert guard of manual_send_authorizations is exactly the definition this migration
  -- replaces (branches `manual` and `ai_autosend` are carried over byte for byte).
  IF (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
      WHERE p.oid = to_regprocedure('platform_private.guard_ai_autosend_authorization()'))
        IS DISTINCT FROM '4ac36850d9688724c7332296137baebd' THEN
    RAISE EXCEPTION 'a317_anchor_drift: platform_private.guard_ai_autosend_authorization is not the 276 definition' USING ERRCODE = '55000';
  END IF;
END
$a317_anchor$;

-- ---------------------------------------------------------------------------
-- Помощники таблиц (без грантов): cron из 5 полей, SHA-256 hex.
-- ---------------------------------------------------------------------------
CREATE FUNCTION platform_private.ai_agents_cron_ok(p_cron TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_cron IS NOT NULL AND char_length(p_cron) <= 100
    AND p_cron ~ '^[0-9*/,-]+( [0-9*/,-]+){4}$'
$$;

CREATE FUNCTION platform_private.ai_agent_sha256(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- A.1 Таблицы. Ссылки на людей и дела - обычные uuid без внешних ключей: стирание аккаунта (280)
-- и склейка клиентов не должны упираться в строки отдела «ИИ-агенты».
-- ---------------------------------------------------------------------------
CREATE TABLE platform_private.ai_agents (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL,
  group_key TEXT NOT NULL,
  sort_order SMALLINT NOT NULL,
  title TEXT NOT NULL,
  role_line TEXT NOT NULL,
  direction TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_send BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
  instructions_override TEXT,
  schedule_cron TEXT,
  schedule_tz TEXT NOT NULL DEFAULT 'Asia/Bishkek',
  schedule_prompt_override TEXT,
  trigger_website_lead BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_whatsapp_inbound BOOLEAN NOT NULL DEFAULT FALSE,
  run_budget_usd NUMERIC(8, 2) NOT NULL DEFAULT 5.00,
  claude_agent_id TEXT,
  claude_environment_id TEXT,
  claude_vault_id TEXT,
  claude_credential_id TEXT,
  claude_deployment_id TEXT,
  claude_mcp_url TEXT,
  claude_agent_version INTEGER,
  synced_config_hash TEXT,
  mcp_token_sha256 TEXT,
  mcp_token_prev_sha256 TEXT,
  mcp_token_prev_until TIMESTAMPTZ,
  mcp_token_rotated_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'never',
  sync_error TEXT,
  synced_at TIMESTAMPTZ,
  config_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by_membership_id UUID,
  CONSTRAINT ai_agents_org_key_key UNIQUE (organization_id, key),
  CONSTRAINT ai_agents_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,31}$'
    AND key IN ('director', 'sales', 'curator-cn', 'curator-my', 'curator-eu', 'curator-ae', 'curator-tr')),
  CONSTRAINT ai_agents_group_check CHECK (group_key IN ('sales', 'analytics', 'curators')),
  CONSTRAINT ai_agents_title_check CHECK (char_length(title) BETWEEN 1 AND 120 AND char_length(role_line) BETWEEN 1 AND 240),
  CONSTRAINT ai_agents_direction_check CHECK (direction IS NULL OR direction IN ('CN', 'MY', 'EUROPE', 'AE', 'TR')),
  CONSTRAINT ai_agents_model_check CHECK (model IN ('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5')),
  CONSTRAINT ai_agents_instructions_check CHECK (instructions_override IS NULL OR char_length(instructions_override) <= 60000),
  CONSTRAINT ai_agents_cron_check CHECK (schedule_cron IS NULL OR platform_private.ai_agents_cron_ok(schedule_cron)),
  CONSTRAINT ai_agents_schedule_tz_check CHECK (char_length(schedule_tz) BETWEEN 1 AND 64),
  CONSTRAINT ai_agents_schedule_prompt_check CHECK (schedule_prompt_override IS NULL OR char_length(schedule_prompt_override) <= 8000),
  CONSTRAINT ai_agents_budget_check CHECK (run_budget_usd BETWEEN 0 AND 100),
  CONSTRAINT ai_agents_claude_ids_check CHECK (
    (claude_agent_id IS NULL OR char_length(claude_agent_id) <= 200)
    AND (claude_environment_id IS NULL OR char_length(claude_environment_id) <= 200)
    AND (claude_vault_id IS NULL OR char_length(claude_vault_id) <= 200)
    AND (claude_credential_id IS NULL OR char_length(claude_credential_id) <= 200)
    AND (claude_deployment_id IS NULL OR char_length(claude_deployment_id) <= 200)
    AND (claude_mcp_url IS NULL OR char_length(claude_mcp_url) <= 2048)),
  CONSTRAINT ai_agents_config_hash_check CHECK (synced_config_hash IS NULL OR synced_config_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_agents_token_check CHECK ((mcp_token_sha256 IS NULL OR mcp_token_sha256 ~ '^[0-9a-f]{64}$')
    AND (mcp_token_prev_sha256 IS NULL OR mcp_token_prev_sha256 ~ '^[0-9a-f]{64}$')),
  CONSTRAINT ai_agents_sync_status_check CHECK (sync_status IN ('never', 'pending', 'ok', 'error')),
  CONSTRAINT ai_agents_sync_error_check CHECK (sync_error IS NULL OR char_length(sync_error) <= 500),
  CONSTRAINT ai_agents_version_check CHECK (config_version >= 1)
);
CREATE UNIQUE INDEX ai_agents_token_current_key ON platform_private.ai_agents (mcp_token_sha256) WHERE mcp_token_sha256 IS NOT NULL;
CREATE UNIQUE INDEX ai_agents_token_prev_key ON platform_private.ai_agents (mcp_token_prev_sha256) WHERE mcp_token_prev_sha256 IS NOT NULL;

CREATE TABLE platform_private.ai_agents_org_settings (
  organization_id UUID NOT NULL PRIMARY KEY REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  responsible_membership_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE platform_private.ai_agent_runs (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key TEXT NOT NULL,
  claude_session_id TEXT,
  trigger_kind TEXT NOT NULL,
  dedupe_key TEXT,
  started_by_membership_id UUID,
  send_authority BOOLEAN NOT NULL DEFAULT FALSE,
  send_authority_sha256 TEXT,
  prompt_preview TEXT,
  status TEXT NOT NULL DEFAULT 'starting',
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ended_at TIMESTAMPTZ,
  model TEXT,
  agent_version INTEGER,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  active_seconds NUMERIC,
  summary TEXT,
  error_code TEXT,
  error_message TEXT,
  event_count INTEGER,
  last_reconciled_at TIMESTAMPTZ,
  CONSTRAINT ai_agent_runs_agent_fkey FOREIGN KEY (organization_id, agent_key)
    REFERENCES platform_private.ai_agents(organization_id, key) ON DELETE RESTRICT,
  CONSTRAINT ai_agent_runs_trigger_check CHECK (trigger_kind IN ('command', 'schedule', 'website_lead', 'whatsapp_inbound')),
  CONSTRAINT ai_agent_runs_status_check CHECK (status IN
    ('starting', 'running', 'completed', 'failed', 'budget_reached', 'interrupted', 'needs_attention')),
  CONSTRAINT ai_agent_runs_authority_check CHECK ((send_authority AND send_authority_sha256 ~ '^[0-9a-f]{64}$')
    OR (NOT send_authority AND send_authority_sha256 IS NULL)),
  CONSTRAINT ai_agent_runs_text_check CHECK ((prompt_preview IS NULL OR char_length(prompt_preview) <= 500)
    AND (summary IS NULL OR char_length(summary) <= 4000)
    AND (error_code IS NULL OR char_length(error_code) <= 64)
    AND (error_message IS NULL OR char_length(error_message) <= 500)),
  CONSTRAINT ai_agent_runs_numbers_check CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0
    AND cost_cents >= 0 AND (active_seconds IS NULL OR active_seconds >= 0))
);
CREATE UNIQUE INDEX ai_agent_runs_session_key ON platform_private.ai_agent_runs (claude_session_id) WHERE claude_session_id IS NOT NULL;
CREATE UNIQUE INDEX ai_agent_runs_dedupe_key ON platform_private.ai_agent_runs (organization_id, agent_key, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ai_agent_runs_agent_idx ON platform_private.ai_agent_runs (organization_id, agent_key, started_at DESC);
CREATE INDEX ai_agent_runs_open_idx ON platform_private.ai_agent_runs (organization_id, status) WHERE status IN ('starting', 'running');

CREATE TABLE platform_private.ai_agent_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  agent_key TEXT NOT NULL,
  run_id UUID REFERENCES platform_private.ai_agent_runs(id),
  tool TEXT NOT NULL,
  args_summary TEXT NOT NULL DEFAULT '',
  result_status TEXT NOT NULL,
  error_code TEXT,
  duration_ms INTEGER,
  audit_event_id UUID,
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_agent_actions_status_check CHECK (result_status IN ('ok', 'error', 'denied')),
  CONSTRAINT ai_agent_actions_text_check CHECK (char_length(args_summary) <= 300 AND char_length(tool) BETWEEN 1 AND 64
    AND (error_code IS NULL OR char_length(error_code) <= 64))
);
CREATE INDEX ai_agent_actions_agent_idx ON platform_private.ai_agent_actions (organization_id, agent_key, at DESC);
CREATE INDEX ai_agent_actions_run_idx ON platform_private.ai_agent_actions (run_id);

CREATE TABLE platform_private.ai_agent_drafts (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key TEXT NOT NULL,
  run_id UUID REFERENCES platform_private.ai_agent_runs(id),
  channel TEXT NOT NULL,
  conversation_id UUID,
  student_case_id UUID,
  lead_id UUID,
  target_label TEXT,
  source_message_id UUID,
  text TEXT NOT NULL,
  edited_text TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_code TEXT,
  decided_by_membership_id UUID,
  decided_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sent_by_agent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by_membership_id UUID,
  provider JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_agent_drafts_org_id_key UNIQUE (organization_id, id),
  CONSTRAINT ai_agent_drafts_agent_fkey FOREIGN KEY (organization_id, agent_key)
    REFERENCES platform_private.ai_agents(organization_id, key) ON DELETE RESTRICT,
  CONSTRAINT ai_agent_drafts_channel_check CHECK (channel IN ('whatsapp', 'portal')),
  CONSTRAINT ai_agent_drafts_target_check CHECK ((channel = 'whatsapp' AND conversation_id IS NOT NULL AND student_case_id IS NULL)
    OR (channel = 'portal' AND student_case_id IS NOT NULL AND conversation_id IS NULL)),
  CONSTRAINT ai_agent_drafts_text_check CHECK (char_length(text) BETWEEN 1 AND (CASE channel WHEN 'whatsapp' THEN 4000 ELSE 8000 END)
    AND text !~ E'[\\x01-\\x09\\x0B-\\x1F\\x7F]'
    AND (edited_text IS NULL OR (char_length(edited_text) BETWEEN 1 AND (CASE channel WHEN 'whatsapp' THEN 4000 ELSE 8000 END)
      AND edited_text !~ E'[\\x01-\\x09\\x0B-\\x1F\\x7F]'))),
  CONSTRAINT ai_agent_drafts_label_check CHECK ((target_label IS NULL OR char_length(target_label) <= 120)
    AND (reason IS NULL OR char_length(reason) <= 300) AND (failure_code IS NULL OR char_length(failure_code) <= 64)),
  CONSTRAINT ai_agent_drafts_status_check CHECK (status IN ('pending', 'approved', 'sending', 'sent', 'discarded', 'failed', 'expired')),
  CONSTRAINT ai_agent_drafts_provider_check CHECK (provider IS NULL OR (jsonb_typeof(provider) = 'object' AND octet_length(provider::TEXT) <= 2048))
);
CREATE INDEX ai_agent_drafts_status_idx ON platform_private.ai_agent_drafts (organization_id, status, created_at DESC);
CREATE INDEX ai_agent_drafts_agent_idx ON platform_private.ai_agent_drafts (organization_id, agent_key, created_at DESC);
CREATE INDEX ai_agent_drafts_conversation_idx ON platform_private.ai_agent_drafts (organization_id, conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX ai_agent_drafts_case_idx ON platform_private.ai_agent_drafts (organization_id, student_case_id) WHERE student_case_id IS NOT NULL;

CREATE TABLE platform_private.ai_agent_digests (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key TEXT NOT NULL,
  run_id UUID REFERENCES platform_private.ai_agent_runs(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  metrics JSONB,
  period_from DATE,
  period_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_agent_digests_agent_fkey FOREIGN KEY (organization_id, agent_key)
    REFERENCES platform_private.ai_agents(organization_id, key) ON DELETE RESTRICT,
  CONSTRAINT ai_agent_digests_kind_check CHECK (kind IN ('weekly', 'daily', 'alert', 'note')),
  CONSTRAINT ai_agent_digests_text_check CHECK (char_length(title) BETWEEN 1 AND 160 AND char_length(body_md) BETWEEN 1 AND 30000),
  CONSTRAINT ai_agent_digests_metrics_check CHECK (metrics IS NULL OR (jsonb_typeof(metrics) = 'object' AND octet_length(metrics::TEXT) <= 16384)),
  CONSTRAINT ai_agent_digests_period_check CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to)
);
CREATE INDEX ai_agent_digests_agent_idx ON platform_private.ai_agent_digests (organization_id, agent_key, created_at DESC);

CREATE TABLE platform_private.ai_agent_file_grants (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  document_version_id UUID NOT NULL,
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  file_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_agent_file_grants_token_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_agent_file_grants_uses_check CHECK (used_count >= 0 AND max_uses BETWEEN 1 AND 10 AND byte_size >= 0)
);

CREATE TABLE platform_private.ai_agent_dedupe (
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  agent_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, agent_key, dedupe_key),
  CONSTRAINT ai_agent_dedupe_key_check CHECK (char_length(dedupe_key) BETWEEN 1 AND 200)
);
CREATE INDEX ai_agent_dedupe_created_idx ON platform_private.ai_agent_dedupe (created_at);

-- Схемы входа инструментов: зеркало AI_AGENT_TOOLS (src/lib/ai-agents/contract.ts); совпадение
-- проверяет tests/ai-agents-db-contract.test.mjs. БД перепроверяет каждый вызов по этой схеме.
CREATE TABLE platform_private.ai_agent_tool_schemas (
  tool TEXT NOT NULL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('read', 'write')),
  audit TEXT NOT NULL CHECK (audit IN ('none', 'read', 'write')),
  input_schema JSONB NOT NULL CHECK (jsonb_typeof(input_schema) = 'object')
);

DO $a317_lockdown$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_agents', 'ai_agents_org_settings', 'ai_agent_runs', 'ai_agent_actions', 'ai_agent_drafts',
    'ai_agent_digests', 'ai_agent_file_grants', 'ai_agent_dedupe', 'ai_agent_tool_schemas'] LOOP
    EXECUTE format('ALTER TABLE platform_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE platform_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform_private.%I FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', t);
  END LOOP;
  REVOKE ALL ON SEQUENCE platform_private.ai_agent_actions_id_seq
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;
END
$a317_lockdown$;

INSERT INTO platform_private.ai_agent_tool_schemas (tool, kind, audit, input_schema) VALUES
  ('search_clients', 'read', 'none', $j${"type":"object","properties":{"query":{"type":"string","minLength":2,"maxLength":80,"description":"Name, phone digits or e-mail fragment (2+ chars)."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."},"cursor":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":["query"],"additionalProperties":false}$j$::jsonb),
  ('get_client_card', 'read', 'read', $j${"type":"object","properties":{"client_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Client id."},"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('list_leads', 'read', 'none', $j${"type":"object","properties":{"stage":{"type":"string","minLength":1,"maxLength":64,"description":"Pipeline stage key."},"source":{"type":"string","minLength":1,"maxLength":64,"description":"Source key, e.g. website or whatsapp."},"owner_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Responsible staff id (membership)."},"state":{"type":"string","enum":["open","won","lost","all"],"default":"open","description":"Lead state."},"direction":{"type":"string","enum":["CN","MY","EUROPE","AE","TR"],"description":"Direction of interest."},"created_from":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Created on/after (YYYY-MM-DD)"},"created_to":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Created on/before (YYYY-MM-DD)"},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."},"cursor":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('get_lead', 'read', 'read', $j${"type":"object","properties":{"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."}},"required":["lead_id"],"additionalProperties":false}$j$::jsonb),
  ('list_student_cases', 'read', 'none', $j${"type":"object","properties":{"direction":{"type":"string","enum":["CN","MY","EUROPE","AE","TR"],"description":"Staff direction."},"country":{"type":"string","minLength":1,"maxLength":80,"description":"Target country (as stored)."},"stage":{"type":"string","minLength":1,"maxLength":64,"description":"operational_stage or pipeline_stage key."},"curator_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Curator staff id (membership)."},"state":{"type":"string","enum":["pending","active","closed","all"],"default":"active","description":"Case state."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."},"cursor":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('get_case', 'read', 'read', $j${"type":"object","properties":{"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"include":{"type":"array","items":{"type":"string","enum":["documents","applications","payments","tasks","notes","profile"]},"minItems":1,"maxItems":6,"description":"Sections to include (default documents, applications, payments, tasks)."}},"required":["case_id"],"additionalProperties":false}$j$::jsonb),
  ('get_document_file', 'read', 'read', $j${"type":"object","properties":{"document_version_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Document version id (from get_case)."},"slot_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Document slot id: the latest version is used."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('list_conversations', 'read', 'none', $j${"type":"object","properties":{"filter":{"type":"string","enum":["unanswered","recent","all"],"default":"unanswered","description":"Which chats."},"queue":{"type":"string","enum":["sales","admissions","all"],"default":"sales","description":"Conversation queue."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."},"cursor":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('get_conversation', 'read', 'read', $j${"type":"object","properties":{"conversation_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Conversation id."},"limit":{"type":"integer","minimum":1,"maximum":60,"default":30,"description":"Messages to return."},"before":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":["conversation_id"],"additionalProperties":false}$j$::jsonb),
  ('get_case_chat', 'read', 'read', $j${"type":"object","properties":{"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"limit":{"type":"integer","minimum":1,"maximum":60,"default":30,"description":"Messages to return."},"before":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":["case_id"],"additionalProperties":false}$j$::jsonb),
  ('sales_report', 'read', 'none', $j${"type":"object","properties":{"from_month":{"type":"string","pattern":"^\\d{4}-(0[1-9]|1[0-2])$","description":"First report month (YYYY-MM)"},"to_month":{"type":"string","pattern":"^\\d{4}-(0[1-9]|1[0-2])$","description":"Last report month (default = from_month) (YYYY-MM)"},"group_by":{"type":"string","enum":["month","country","manager","direction"],"default":"month","description":"Grouping."}},"required":["from_month"],"additionalProperties":false}$j$::jsonb),
  ('payments_summary', 'read', 'none', $j${"type":"object","properties":{"from":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period start (YYYY-MM-DD)"},"to":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period end (YYYY-MM-DD)"},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Limit to one case."},"status":{"type":"string","minLength":1,"maxLength":40,"description":"Obligation status."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('funnel_stats', 'read', 'none', $j${"type":"object","properties":{"from":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period start (YYYY-MM-DD)"},"to":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period end (YYYY-MM-DD)"},"source":{"type":"string","minLength":1,"maxLength":64,"description":"Source key."},"direction":{"type":"string","enum":["CN","MY","EUROPE","AE","TR"],"description":"Direction."}},"required":["from","to"],"additionalProperties":false}$j$::jsonb),
  ('list_tasks', 'read', 'none', $j${"type":"object","properties":{"assignee_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Assignee staff id (membership)."},"status":{"type":"string","enum":["open","done","all"],"default":"open","description":"Task status."},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."},"due_before":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Due on/before (YYYY-MM-DD)"},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."},"cursor":{"type":"string","minLength":1,"maxLength":400,"description":"Opaque next_cursor from the previous page. Курсор предыдущей страницы."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('search_catalog', 'read', 'none', $j${"type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":120,"description":"Name fragment."},"country":{"type":"string","minLength":1,"maxLength":80,"description":"Country (as stored)."},"city":{"type":"string","minLength":1,"maxLength":80,"description":"City."},"degree":{"type":"string","minLength":1,"maxLength":40,"description":"Degree level."},"language":{"type":"string","minLength":1,"maxLength":40,"description":"Teaching language."},"limit":{"type":"integer","minimum":1,"maximum":50,"default":10,"description":"Max institutions."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('search_knowledge', 'read', 'none', $j${"type":"object","properties":{"query":{"type":"string","minLength":2,"maxLength":200,"description":"Question or keywords."},"audience":{"type":"string","enum":["client","internal","both"],"default":"both","description":"Knowledge audience."},"limit":{"type":"integer","minimum":1,"maximum":10,"default":5,"description":"Max passages."}},"required":["query"],"additionalProperties":false}$j$::jsonb),
  ('recent_calls', 'read', 'none', $j${"type":"object","properties":{"days":{"type":"integer","minimum":1,"maximum":30,"default":7,"description":"Look back days."},"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."},"direction":{"type":"string","enum":["inbound","outbound"],"description":"Call direction."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20,"description":"Max items per page. Макс. строк на странице."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('list_staff', 'read', 'none', $j${"type":"object","properties":{"role":{"type":"string","minLength":1,"maxLength":60,"description":"Role label fragment."},"direction":{"type":"string","enum":["CN","MY","EUROPE","AE","TR"],"description":"Direction."}},"required":[],"additionalProperties":false}$j$::jsonb),
  ('get_my_settings', 'read', 'none', $j${"type":"object","properties":{},"required":[],"additionalProperties":false}$j$::jsonb),
  ('create_task', 'write', 'write', $j${"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":300,"description":"Task title."},"description":{"type":"string","minLength":1,"maxLength":4000,"description":"Details."},"assignee_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Assignee staff id (membership); default: the case curator or the responsible admin."},"due_on":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Due date (YYYY-MM-DD)"},"priority":{"type":"string","enum":["low","normal","high"],"default":"normal","description":"Priority."},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."},"idempotency_key":{"type":"string","minLength":1,"maxLength":120,"description":"Repeat-safe key (10 min)."}},"required":["title"],"additionalProperties":false}$j$::jsonb),
  ('add_note', 'write', 'write', $j${"type":"object","properties":{"lead_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Lead id."},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id."},"body":{"type":"string","minLength":1,"maxLength":3500,"description":"Note text."},"idempotency_key":{"type":"string","minLength":1,"maxLength":120,"description":"Repeat-safe key (10 min)."}},"required":["body"],"additionalProperties":false}$j$::jsonb),
  ('send_message', 'write', 'write', $j${"type":"object","properties":{"channel":{"type":"string","enum":["whatsapp","portal"],"description":"Channel."},"conversation_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"WhatsApp conversation id (channel=whatsapp)."},"case_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Student case id (channel=portal)."},"text":{"type":"string","minLength":1,"maxLength":8000,"description":"Message text."},"reason":{"type":"string","minLength":1,"maxLength":300,"description":"Why this message (shown to staff)."},"authority_code":{"type":"string","minLength":1,"maxLength":80,"description":"Code from the staff message that grants immediate sending."},"idempotency_key":{"type":"string","minLength":1,"maxLength":120,"description":"Repeat-safe key (10 min)."}},"required":["channel","text"],"additionalProperties":false}$j$::jsonb),
  ('post_digest', 'write', 'write', $j${"type":"object","properties":{"kind":{"type":"string","enum":["weekly","daily","alert","note"],"description":"Report kind."},"title":{"type":"string","minLength":1,"maxLength":160,"description":"Title."},"body_md":{"type":"string","minLength":1,"maxLength":30000,"description":"Report body in Markdown."},"metrics":{"type":"object","description":"Optional chart data: {kpis:[{label,value,unit?}], series:[{label, points:[{x,y}]}]}."},"period_from":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period start (YYYY-MM-DD)"},"period_to":{"type":"string","pattern":"^\\d{4}-\\d{2}-\\d{2}$","description":"Period end (YYYY-MM-DD)"}},"required":["kind","title","body_md"],"additionalProperties":false}$j$::jsonb),
  ('notify_staff', 'write', 'write', $j${"type":"object","properties":{"staff_id":{"type":"string","pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$","description":"Staff id (membership)."},"role":{"type":"string","minLength":1,"maxLength":60,"description":"Role label fragment."},"direction":{"type":"string","enum":["CN","MY","EUROPE","AE","TR"],"description":"Direction."},"title":{"type":"string","minLength":1,"maxLength":200,"description":"Short title."},"body":{"type":"string","minLength":1,"maxLength":3000,"description":"Details."},"dedupe_key":{"type":"string","minLength":1,"maxLength":120,"description":"Repeat limiter key (24 h)."}},"required":["title","body"],"additionalProperties":false}$j$::jsonb)
;

-- ---------------------------------------------------------------------------
-- A.2 Помощники (platform_private, без грантов) и сид каталога.
-- ---------------------------------------------------------------------------

-- Ответственный сотрудник организации: настроенный, если он ещё действующий сотрудник (не студент),
-- иначе самый давний действующий системный администратор. NULL - нет никого.
CREATE FUNCTION platform_private.ai_agents_responsible(p_organization_id UUID)
RETURNS UUID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT s.responsible_membership_id
     FROM platform_private.ai_agents_org_settings s
     JOIN platform.organization_memberships m ON m.organization_id = s.organization_id AND m.id = s.responsible_membership_id
     JOIN platform.profiles p ON p.id = m.profile_id
     WHERE s.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
       AND m."current_role" IS DISTINCT FROM 'student'),
    (SELECT m.id
     FROM platform.organization_memberships m
     JOIN platform.profiles p ON p.id = m.profile_id
     WHERE m.organization_id = p_organization_id AND m.is_system_admin AND m.status = 'active' AND p.status = 'active'
     ORDER BY m.created_at, m.id LIMIT 1))
$$;

-- 7 строк каталога + строка настроек организации (идемпотентно). Значения - AI_AGENT_CATALOG
-- (src/lib/ai-agents/contract.ts) дословно.
CREATE FUNCTION platform_private.ai_agents_ensure_rows(p_organization_id UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_admin UUID;
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;
  -- Fast path on every call: seven agents and a settings row with a responsible member.
  IF (SELECT count(*) FROM platform_private.ai_agents a WHERE a.organization_id = p_organization_id) >= 7
    AND EXISTS (SELECT 1 FROM platform_private.ai_agents_org_settings s
      WHERE s.organization_id = p_organization_id AND s.responsible_membership_id IS NOT NULL) THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM platform_private.ai_agents a WHERE a.organization_id = p_organization_id) < 7 THEN
    INSERT INTO platform_private.ai_agents (organization_id, key, group_key, sort_order, title, role_line, direction,
      schedule_cron, schedule_tz, trigger_website_lead, trigger_whatsapp_inbound)
    SELECT p_organization_id, c.key, c.group_key, c.sort_order, c.title, c.role_line, c.direction,
      c.schedule_cron, c.schedule_tz, c.trigger_website_lead, c.trigger_whatsapp_inbound
    FROM (VALUES
      ('director', 'analytics', 10::SMALLINT, 'Директор / Аналитик',
        'Считает продажи, воронку и поступление, раз в неделю присылает отчёт руководству',
        NULL::TEXT, '0 9 * * 1'::TEXT, 'Asia/Bishkek', FALSE, FALSE),
      ('sales', 'sales', 20::SMALLINT, 'Продажи (Closer)',
        'Разбирает новые заявки и чаты WhatsApp, готовит ответы и ведёт лид до договора',
        NULL, NULL, 'Asia/Bishkek', TRUE, TRUE),
      ('curator-cn', 'curators', 30::SMALLINT, 'Куратор Китай',
        'Ведёт студентов по Китаю: документы, CSCA, подача, собеседования, виза',
        'CN', NULL, 'Asia/Bishkek', FALSE, FALSE),
      ('curator-my', 'curators', 40::SMALLINT, 'Куратор Малайзия',
        'Ведёт студентов по Малайзии: документы, университеты, EMGS, виза, прилёт',
        'MY', NULL, 'Asia/Bishkek', FALSE, FALSE),
      ('curator-eu', 'curators', 50::SMALLINT, 'Куратор Европа',
        'Европа (Италия, Чехия): инструкции пока нет, агент выключен',
        'EUROPE', NULL, 'Asia/Bishkek', FALSE, FALSE),
      ('curator-ae', 'curators', 60::SMALLINT, 'Куратор ОАЭ',
        'ОАЭ: инструкции пока нет, агент выключен',
        'AE', NULL, 'Asia/Bishkek', FALSE, FALSE),
      ('curator-tr', 'curators', 70::SMALLINT, 'Куратор Турция',
        'Турция: инструкции пока нет, агент выключен',
        'TR', NULL, 'Asia/Bishkek', FALSE, FALSE)
    ) AS c(key, group_key, sort_order, title, role_line, direction, schedule_cron, schedule_tz,
      trigger_website_lead, trigger_whatsapp_inbound)
    WHERE EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id)
    ON CONFLICT (organization_id, key) DO NOTHING;
  END IF;
  SELECT m.id INTO v_admin
  FROM platform.organization_memberships m
  JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.is_system_admin AND m.status = 'active' AND p.status = 'active'
  ORDER BY m.created_at, m.id LIMIT 1;
  INSERT INTO platform_private.ai_agents_org_settings (organization_id, responsible_membership_id)
  SELECT p_organization_id, v_admin
  WHERE EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;
  IF v_admin IS NOT NULL THEN
    UPDATE platform_private.ai_agents_org_settings s
    SET responsible_membership_id = v_admin, updated_at = clock_timestamp()
    WHERE s.organization_id = p_organization_id AND s.responsible_membership_id IS NULL;
  END IF;
END
$$;

-- Подмножество JSON Schema из contract.ts: type (object, string, integer, array, boolean), properties,
-- required, additionalProperties, enum, minLength, maxLength, minimum, maximum, pattern, items,
-- minItems, maxItems. Ложь на любое расхождение (в том числе JSON null).
CREATE FUNCTION platform_private.ai_agent_json_valid(p_schema JSONB, p_value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE t TEXT; k TEXT; v JSONB; s JSONB; txt TEXT; num NUMERIC; n INTEGER;
BEGIN
  IF p_schema IS NULL OR jsonb_typeof(p_schema) <> 'object' THEN
    RETURN FALSE;
  END IF;
  t := p_schema ->> 'type';
  IF t = 'object' THEN
    IF jsonb_typeof(p_value) <> 'object' THEN
      RETURN FALSE;
    END IF;
    IF jsonb_typeof(p_schema -> 'required') = 'array' THEN
      FOR k IN SELECT jsonb_array_elements_text(p_schema -> 'required') LOOP
        IF NOT p_value ? k THEN
          RETURN FALSE;
        END IF;
      END LOOP;
    END IF;
    FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_value) e LOOP
      s := p_schema -> 'properties' -> k;
      IF s IS NULL THEN
        IF (p_schema -> 'additionalProperties') IS NOT DISTINCT FROM 'false'::JSONB THEN
          RETURN FALSE;
        END IF;
        CONTINUE;
      END IF;
      IF NOT platform_private.ai_agent_json_valid(s, v) THEN
        RETURN FALSE;
      END IF;
    END LOOP;
  ELSIF t = 'string' THEN
    IF jsonb_typeof(p_value) <> 'string' THEN
      RETURN FALSE;
    END IF;
    txt := p_value #>> '{}';
    IF (p_schema ? 'minLength' AND char_length(txt) < (p_schema ->> 'minLength')::INTEGER)
      OR (p_schema ? 'maxLength' AND char_length(txt) > (p_schema ->> 'maxLength')::INTEGER)
      OR (p_schema ? 'pattern' AND txt !~ (p_schema ->> 'pattern'))
      OR (jsonb_typeof(p_schema -> 'enum') = 'array' AND NOT (p_schema -> 'enum') @> to_jsonb(txt)) THEN
      RETURN FALSE;
    END IF;
  ELSIF t = 'integer' THEN
    IF jsonb_typeof(p_value) <> 'number' THEN
      RETURN FALSE;
    END IF;
    num := (p_value #>> '{}')::NUMERIC;
    IF num <> trunc(num)
      OR (p_schema ? 'minimum' AND num < (p_schema ->> 'minimum')::NUMERIC)
      OR (p_schema ? 'maximum' AND num > (p_schema ->> 'maximum')::NUMERIC) THEN
      RETURN FALSE;
    END IF;
  ELSIF t = 'boolean' THEN
    RETURN jsonb_typeof(p_value) = 'boolean';
  ELSIF t = 'array' THEN
    IF jsonb_typeof(p_value) <> 'array' THEN
      RETURN FALSE;
    END IF;
    n := jsonb_array_length(p_value);
    IF (p_schema ? 'minItems' AND n < (p_schema ->> 'minItems')::INTEGER)
      OR (p_schema ? 'maxItems' AND n > (p_schema ->> 'maxItems')::INTEGER) THEN
      RETURN FALSE;
    END IF;
    IF jsonb_typeof(p_schema -> 'items') = 'object' THEN
      FOR v IN SELECT e.value FROM jsonb_array_elements(p_value) e LOOP
        IF NOT platform_private.ai_agent_json_valid(p_schema -> 'items', v) THEN
          RETURN FALSE;
        END IF;
      END LOOP;
    END IF;
  ELSE
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END
$$;

-- Маски контактов: +996*****12 (код и две последние цифры), a***@domain.
CREATE FUNCTION platform_private.ai_agent_mask_phone(p_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN d.digits IS NULL OR char_length(d.digits) < 6 THEN NULL
    ELSE '+' || left(d.digits, 3) || repeat('*', greatest(char_length(d.digits) - 5, 3)) || right(d.digits, 2) END
  FROM (SELECT NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '') AS digits) d
$$;

CREATE FUNCTION platform_private.ai_agent_mask_email(p_email TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_email IS NULL OR position('@' IN p_email) < 2 THEN NULL
    ELSE left(p_email, 1) || '***@' || substring(p_email FROM position('@' IN p_email) + 1) END
$$;

-- Курсор keyset-страницы: base64url(JSON {t, id}) последней отданной строки.
CREATE FUNCTION platform_private.ai_agent_cursor_encode(p_t TIMESTAMPTZ, p_id UUID)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT translate(encode(convert_to(jsonb_build_object('t', p_t, 'id', p_id)::TEXT, 'UTF8'), 'base64'),
    E'+/=\n', '-_')
$$;

CREATE FUNCTION platform_private.ai_agent_cursor_decode(p_cursor TEXT)
RETURNS TABLE (t TIMESTAMPTZ, id UUID) LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE b TEXT; v JSONB;
BEGIN
  IF p_cursor IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    b := translate(p_cursor, '-_', '+/');
    b := b || repeat('=', (4 - char_length(b) % 4) % 4);
    v := convert_from(decode(b, 'base64'), 'UTF8')::JSONB;
    t := (v ->> 't')::TIMESTAMPTZ;
    id := (v ->> 'id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END;
  IF t IS NULL OR id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  RETURN NEXT;
END
$$;

-- Текст сообщения/заметки: переводы строк в \n, табуляции в пробелы, края обрезаны.
CREATE FUNCTION platform_private.ai_agent_clean_text(p_text TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT btrim(replace(replace(replace(p_text, E'\r\n', E'\n'), E'\r', E'\n'), E'\t', ' '), E' \n')
$$;

CREATE FUNCTION platform_private.ai_agent_text_ok(p_text TEXT, p_max INTEGER)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_text IS NOT NULL AND char_length(p_text) BETWEEN 1 AND p_max AND p_text !~ E'[\\x01-\\x09\\x0B-\\x1F\\x7F]'
$$;

CREATE FUNCTION platform_private.ai_agent_member_name(p_organization_id UUID, p_membership_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.display_name
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.id = p_membership_id
$$;

-- Строка журнала платформы: сотрудник (user) или служба агента (service, ai-agent:<ключ>).
CREATE FUNCTION platform_private.ai_agent_audit(p_organization_id UUID, p_membership_id UUID, p_agent_key TEXT,
  p_action TEXT, p_resource_type TEXT, p_resource_id UUID, p_before JSONB, p_after JSONB, p_reason TEXT,
  p_request_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_profile UUID; v_auth UUID; v_id UUID := gen_random_uuid();
BEGIN
  IF p_membership_id IS NOT NULL THEN
    SELECT p.id, p.auth_user_id INTO v_profile, v_auth
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id;
  END IF;
  IF v_profile IS NOT NULL THEN
    INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_profile_id, actor_membership_id,
      actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (v_id, p_organization_id, 'user', v_profile, p_membership_id, 'auth:' || v_auth::TEXT, p_action,
      p_resource_type, p_resource_id, p_before, COALESCE(p_after, '{}'::JSONB), p_reason,
      COALESCE(p_request_id, gen_random_uuid()));
  ELSE
    INSERT INTO platform.audit_events (id, organization_id, actor_kind, actor_profile_id, actor_membership_id,
      actor_principal, action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (v_id, p_organization_id, 'service', NULL, NULL, 'ai-agent:' || COALESCE(p_agent_key, 'system'), p_action,
      p_resource_type, p_resource_id, p_before, COALESCE(p_after, '{}'::JSONB), p_reason,
      COALESCE(p_request_id, gen_random_uuid()));
  END IF;
  RETURN v_id;
END
$$;

-- Повторы записи (idempotency_key, dedupe_key): прежний ответ в окне, иначе NULL. Старые строки
-- чистятся по случаю (не более 100 за раз).
CREATE FUNCTION platform_private.ai_agent_dedupe_get(p_organization_id UUID, p_agent_key TEXT, p_dedupe_key TEXT,
  p_window INTERVAL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
  DELETE FROM platform_private.ai_agent_dedupe d WHERE d.ctid IN (
    SELECT x.ctid FROM platform_private.ai_agent_dedupe x WHERE x.created_at < clock_timestamp() - INTERVAL '2 days' LIMIT 100);
  SELECT d.result INTO v_result FROM platform_private.ai_agent_dedupe d
  WHERE d.organization_id = p_organization_id AND d.agent_key = p_agent_key AND d.dedupe_key = p_dedupe_key
    AND d.created_at > clock_timestamp() - p_window;
  RETURN v_result;
END
$$;

CREATE FUNCTION platform_private.ai_agent_dedupe_put(p_organization_id UUID, p_agent_key TEXT, p_dedupe_key TEXT,
  p_result JSONB)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO platform_private.ai_agent_dedupe (organization_id, agent_key, dedupe_key, result)
  VALUES (p_organization_id, p_agent_key, p_dedupe_key, p_result)
  ON CONFLICT (organization_id, agent_key, dedupe_key)
  DO UPDATE SET result = EXCLUDED.result, created_at = clock_timestamp()
$$;

-- Начало каждого инструмента: служба, строки каталога, агент существует и включён (кроме
-- get_my_settings), аргументы - объект, проходящий схему инструмента. Ошибки - коды без значений.
CREATE FUNCTION platform_private.ai_agent_tool_begin(p_organization_id UUID, p_agent_key TEXT, p_tool TEXT, p_args JSONB)
RETURNS platform_private.ai_agents LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_schema JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_agent_key IS NULL OR p_args IS NULL OR jsonb_typeof(p_args) <> 'object' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_agent_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT a.enabled AND p_tool <> 'get_my_settings' THEN
    RAISE EXCEPTION 'agent_disabled' USING ERRCODE = '55000';
  END IF;
  SELECT s.input_schema INTO v_schema FROM platform_private.ai_agent_tool_schemas s WHERE s.tool = p_tool;
  IF v_schema IS NULL OR NOT platform_private.ai_agent_json_valid(v_schema, p_args) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  RETURN a;
END
$$;

-- Единственный открытый запуск агента (starting/running) или NULL, если их нет или больше одного.
CREATE FUNCTION platform_private.ai_agent_open_run(p_organization_id UUID, p_agent_key TEXT)
RETURNS platform_private.ai_agent_runs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r platform_private.ai_agent_runs; n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM platform_private.ai_agent_runs x
  WHERE x.organization_id = p_organization_id AND x.agent_key = p_agent_key AND x.status IN ('starting', 'running');
  IF n <> 1 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM platform_private.ai_agent_runs x
  WHERE x.organization_id = p_organization_id AND x.agent_key = p_agent_key AND x.status IN ('starting', 'running');
  RETURN r;
END
$$;

-- Состояние WhatsApp сессии продаж по записанному вебхуками здоровью: connected | disconnected | unknown.
CREATE FUNCTION platform_private.ai_agent_whatsapp_state(p_organization_id UUID, p_session TEXT DEFAULT 'crm_primary')
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT CASE WHEN h.status = 'WORKING' THEN 'connected' ELSE 'disconnected' END
    FROM platform.waha_session_health h
    WHERE h.organization_id = p_organization_id AND h.waha_session_name = p_session), 'unknown')
$$;

-- ---------------------------------------------------------------------------
-- A.3 Сборщики JSON и функции сотрудника (authenticated; ответы - camelCase, формы contract.ts).
-- ---------------------------------------------------------------------------

CREATE FUNCTION platform_private.ai_agent_stats(p_organization_id UUID, p_agent_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); v_last RECORD; v_per_day JSONB;
BEGIN
  SELECT r.started_at, r.status INTO v_last FROM platform_private.ai_agent_runs r
  WHERE r.organization_id = p_organization_id AND r.agent_key = p_agent_key ORDER BY r.started_at DESC, r.id DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(COALESCE(c.n, 0) ORDER BY d.day), '[]'::JSONB) INTO v_per_day
  FROM generate_series((v_now AT TIME ZONE 'Asia/Bishkek')::DATE - 13, (v_now AT TIME ZONE 'Asia/Bishkek')::DATE,
    INTERVAL '1 day') AS d(day)
  LEFT JOIN (SELECT (r.started_at AT TIME ZONE 'Asia/Bishkek')::DATE AS day, count(*)::INTEGER AS n
    FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_agent_key AND r.started_at >= v_now - INTERVAL '15 days'
    GROUP BY 1) c ON c.day = d.day::DATE;
  RETURN jsonb_build_object(
    'runs7d', (SELECT count(*) FROM platform_private.ai_agent_runs r WHERE r.organization_id = p_organization_id
      AND r.agent_key = p_agent_key AND r.started_at >= v_now - INTERVAL '7 days'),
    'runsRunning', (SELECT count(*) FROM platform_private.ai_agent_runs r WHERE r.organization_id = p_organization_id
      AND r.agent_key = p_agent_key AND r.status IN ('starting', 'running')),
    'failed7d', (SELECT count(*) FROM platform_private.ai_agent_runs r WHERE r.organization_id = p_organization_id
      AND r.agent_key = p_agent_key AND r.status = 'failed' AND r.started_at >= v_now - INTERVAL '7 days'),
    'actions7d', (SELECT count(*) FROM platform_private.ai_agent_actions x WHERE x.organization_id = p_organization_id
      AND x.agent_key = p_agent_key AND x.at >= v_now - INTERVAL '7 days'),
    'costCents7d', (SELECT COALESCE(sum(r.cost_cents), 0) FROM platform_private.ai_agent_runs r
      WHERE r.organization_id = p_organization_id AND r.agent_key = p_agent_key AND r.started_at >= v_now - INTERVAL '7 days'),
    'draftsPending', (SELECT count(*) FROM platform_private.ai_agent_drafts d WHERE d.organization_id = p_organization_id
      AND d.agent_key = p_agent_key AND d.status = 'pending' AND d.expires_at >= v_now),
    'lastRunAt', v_last.started_at,
    'lastRunStatus', v_last.status,
    'lastDigestAt', (SELECT max(g.created_at) FROM platform_private.ai_agent_digests g
      WHERE g.organization_id = p_organization_id AND g.agent_key = p_agent_key),
    'runsPerDay14', v_per_day);
END
$$;

CREATE FUNCTION platform_private.ai_agent_list_item(a platform_private.ai_agents)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'key', a.key, 'groupKey', a.group_key, 'sortOrder', a.sort_order, 'title', a.title, 'roleLine', a.role_line,
    'direction', a.direction, 'enabled', a.enabled, 'autoSend', a.auto_send, 'model', a.model,
    'scheduleCron', a.schedule_cron, 'scheduleTz', a.schedule_tz,
    'hasInstructionsOverride', a.instructions_override IS NOT NULL,
    'sync', jsonb_build_object('status', a.sync_status, 'error', a.sync_error, 'syncedAt', a.synced_at,
      'agentVersion', a.claude_agent_version, 'claudeAgentId', a.claude_agent_id,
      'environmentId', a.claude_environment_id, 'vaultId', a.claude_vault_id, 'deploymentId', a.claude_deployment_id,
      'configHash', a.synced_config_hash, 'mcpUrl', a.claude_mcp_url,
      'tokenFingerprint', left(a.mcp_token_sha256, 12), 'tokenRotatedAt', a.mcp_token_rotated_at),
    'stats', platform_private.ai_agent_stats(a.organization_id, a.key))
$$;

CREATE FUNCTION platform_private.ai_agent_digest_json(d platform_private.ai_agent_digests)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', d.id, 'agentKey', d.agent_key, 'runId', d.run_id, 'kind', d.kind, 'title', d.title,
    'bodyMd', d.body_md, 'metrics', d.metrics, 'periodFrom', d.period_from, 'periodTo', d.period_to,
    'createdAt', d.created_at)
$$;

CREATE FUNCTION platform_private.ai_agent_run_json(r platform_private.ai_agent_runs)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', r.id, 'agentKey', r.agent_key, 'status', r.status, 'triggerKind', r.trigger_kind,
    'startedAt', r.started_at, 'endedAt', r.ended_at,
    'durationSeconds', CASE WHEN r.active_seconds IS NOT NULL THEN round(r.active_seconds)::INTEGER
      WHEN r.ended_at IS NOT NULL THEN round(extract(epoch FROM r.ended_at - r.started_at))::INTEGER END,
    'promptPreview', r.prompt_preview, 'summary', r.summary, 'errorCode', r.error_code,
    'errorMessage', r.error_message, 'model', r.model, 'agentVersion', r.agent_version,
    'sessionId', r.claude_session_id, 'inputTokens', r.input_tokens, 'outputTokens', r.output_tokens,
    'cacheReadTokens', r.cache_read_tokens, 'costCents', r.cost_cents, 'sendAuthority', r.send_authority,
    'startedByName', platform_private.ai_agent_member_name(r.organization_id, r.started_by_membership_id),
    'actionsCount', (SELECT count(*) FROM platform_private.ai_agent_actions x WHERE x.run_id = r.id),
    'draftsCount', (SELECT count(*) FROM platform_private.ai_agent_drafts d WHERE d.run_id = r.id))
$$;

CREATE FUNCTION platform_private.ai_agent_action_json(x platform_private.ai_agent_actions)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', x.id::TEXT, 'agentKey', x.agent_key, 'runId', x.run_id, 'tool', x.tool,
    'argsSummary', x.args_summary, 'resultStatus', x.result_status, 'errorCode', x.error_code,
    'durationMs', x.duration_ms, 'at', x.at)
$$;

-- «Устарел» вычисляется при чтении, без записи: pending с истёкшим сроком.
CREATE FUNCTION platform_private.ai_agent_draft_status(d platform_private.ai_agent_drafts)
RETURNS TEXT LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT CASE WHEN d.status = 'pending' AND d.expires_at < clock_timestamp() THEN 'expired' ELSE d.status END
$$;

CREATE FUNCTION platform_private.ai_agent_draft_json(d platform_private.ai_agent_drafts)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', d.id, 'agentKey', d.agent_key, 'runId', d.run_id, 'channel', d.channel,
    'status', platform_private.ai_agent_draft_status(d), 'text', d.text, 'editedText', d.edited_text,
    'targetLabel', d.target_label, 'conversationId', d.conversation_id, 'studentCaseId', d.student_case_id,
    'leadId', d.lead_id, 'reason', d.reason, 'failureCode', d.failure_code,
    'sourceMessage', (SELECT jsonb_build_object('text', left(m.body_text, 400), 'at', m.created_at)
      FROM platform.communication_messages m WHERE m.organization_id = d.organization_id AND m.id = d.source_message_id),
    'createdAt', d.created_at, 'expiresAt', d.expires_at,
    'decidedByName', platform_private.ai_agent_member_name(d.organization_id, d.decided_by_membership_id),
    'decidedAt', d.decided_at, 'sentAt', d.sent_at, 'sentByAgent', d.sent_by_agent)
$$;

CREATE FUNCTION platform_private.ai_agent_detail(a platform_private.ai_agents)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now TIMESTAMPTZ := clock_timestamp(); v_charts JSONB; v_digest platform_private.ai_agent_digests;
BEGIN
  v_charts := jsonb_build_object(
    'runsPerDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'),
        'count', COALESCE(c.n, 0), 'failed', COALESCE(c.f, 0)) ORDER BY d.day), '[]'::JSONB)
      FROM generate_series((v_now AT TIME ZONE 'Asia/Bishkek')::DATE - 29, (v_now AT TIME ZONE 'Asia/Bishkek')::DATE,
        INTERVAL '1 day') AS d(day)
      LEFT JOIN (SELECT (r.started_at AT TIME ZONE 'Asia/Bishkek')::DATE AS day, count(*)::INTEGER AS n,
          (count(*) FILTER (WHERE r.status = 'failed'))::INTEGER AS f
        FROM platform_private.ai_agent_runs r
        WHERE r.organization_id = a.organization_id AND r.agent_key = a.key AND r.started_at >= v_now - INTERVAL '31 days'
        GROUP BY 1) c ON c.day = d.day::DATE),
    'spendPerDay', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'),
        'count', COALESCE(c.n, 0), 'costCents', COALESCE(c.cents, 0)) ORDER BY d.day), '[]'::JSONB)
      FROM generate_series((v_now AT TIME ZONE 'Asia/Bishkek')::DATE - 29, (v_now AT TIME ZONE 'Asia/Bishkek')::DATE,
        INTERVAL '1 day') AS d(day)
      LEFT JOIN (SELECT (r.started_at AT TIME ZONE 'Asia/Bishkek')::DATE AS day, count(*)::INTEGER AS n,
          COALESCE(sum(r.cost_cents), 0)::INTEGER AS cents
        FROM platform_private.ai_agent_runs r
        WHERE r.organization_id = a.organization_id AND r.agent_key = a.key AND r.started_at >= v_now - INTERVAL '31 days'
        GROUP BY 1) c ON c.day = d.day::DATE),
    'actionsByTool', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tool', t.tool, 'count', t.n) ORDER BY t.n DESC, t.tool), '[]'::JSONB)
      FROM (SELECT x.tool, count(*)::INTEGER AS n FROM platform_private.ai_agent_actions x
        WHERE x.organization_id = a.organization_id AND x.agent_key = a.key AND x.at >= v_now - INTERVAL '30 days'
        GROUP BY x.tool ORDER BY count(*) DESC, x.tool LIMIT 12) t));
  SELECT * INTO v_digest FROM platform_private.ai_agent_digests g
  WHERE g.organization_id = a.organization_id AND g.agent_key = a.key ORDER BY g.created_at DESC, g.id DESC LIMIT 1;
  RETURN platform_private.ai_agent_list_item(a) || jsonb_build_object(
    'instructionsOverride', a.instructions_override, 'schedulePromptOverride', a.schedule_prompt_override,
    'triggerWebsiteLead', a.trigger_website_lead, 'triggerWhatsappInbound', a.trigger_whatsapp_inbound,
    'runBudgetUsd', a.run_budget_usd, 'configVersion', a.config_version, 'charts', v_charts,
    'lastDigest', CASE WHEN v_digest.id IS NULL THEN NULL ELSE platform_private.ai_agent_digest_json(v_digest) END);
END
$$;

CREATE FUNCTION platform_private.ai_agent_key_known(p_key TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_key IN ('director', 'sales', 'curator-cn', 'curator-my', 'curator-eu', 'curator-ae', 'curator-tr')
$$;

-- platform.ai_agents_list_v1: хаб - 7 агентов без текстов инструкций, сводка, права сотрудника.
CREATE FUNCTION platform.ai_agents_list_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_agents JSONB; v_responsible UUID;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  v_responsible := platform_private.ai_agents_responsible(p_organization_id);
  SELECT COALESCE(jsonb_agg(platform_private.ai_agent_list_item(a) ORDER BY a.sort_order, a.key), '[]'::JSONB) INTO v_agents
  FROM platform_private.ai_agents a WHERE a.organization_id = p_organization_id;
  RETURN jsonb_build_object(
    'agents', v_agents,
    'org', jsonb_build_object('responsibleMembershipId', v_responsible,
      'responsibleName', platform_private.ai_agent_member_name(p_organization_id, v_responsible)),
    'summary', jsonb_build_object(
      'enabled', (SELECT count(*) FROM jsonb_array_elements(v_agents) e WHERE (e ->> 'enabled')::BOOLEAN),
      'runs7d', (SELECT COALESCE(sum((e -> 'stats' ->> 'runs7d')::BIGINT), 0) FROM jsonb_array_elements(v_agents) e),
      'costCents7d', (SELECT COALESCE(sum((e -> 'stats' ->> 'costCents7d')::BIGINT), 0) FROM jsonb_array_elements(v_agents) e),
      'draftsPending', (SELECT COALESCE(sum((e -> 'stats' ->> 'draftsPending')::BIGINT), 0) FROM jsonb_array_elements(v_agents) e)),
    'canManage', platform_private.staff_can_access(p_organization_id, v_actor.membership_id, 'ai.agent.manage',
      'organization', p_organization_id),
    'isAdmin', v_actor.is_admin,
    'now', clock_timestamp());
END
$$;

CREATE FUNCTION platform.ai_agents_get_v1(p_organization_id UUID, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; a platform_private.ai_agents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN platform_private.ai_agent_detail(a);
END
$$;

-- platform.ai_agents_update_v1: настройки агента - только системный администратор (допущение A1).
-- Патч - AiAgentUpdatePatch; в журнале нет текстов инструкций и промптов.
CREATE FUNCTION platform.ai_agents_update_v1(p_organization_id UUID, p_key TEXT, p_expected_version BIGINT,
  p_patch JSONB, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD; a platform_private.ai_agents; k TEXT; v JSONB; v_sha TEXT; v_prior platform.audit_events;
  v_changed TEXT[] := ARRAY[]::TEXT[]; v_before JSONB := '{}'::JSONB; v_after JSONB := '{}'::JSONB;
  n_enabled BOOLEAN; n_auto BOOLEAN; n_model TEXT; n_instr TEXT; n_cron TEXT; n_tz TEXT; n_prompt TEXT;
  n_trig_site BOOLEAN; n_trig_wa BOOLEAN; n_budget NUMERIC(8, 2); n_agent_id TEXT; v_text TEXT;
  v_agent_changed BOOLEAN := FALSE; v_new_version BIGINT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF NOT v_actor.is_admin THEN
    RAISE EXCEPTION 'ai_agent_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
    OR p_patch = '{}'::JSONB THEN
    RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
  END IF;
  IF NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_sha := platform_private.ai_agent_sha256(p_patch::TEXT);
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'ai.agent.config.change'
      AND v_prior.resource_id = a.id AND v_prior.actor_membership_id IS NOT DISTINCT FROM v_actor.membership_id
      AND v_prior.after_state ->> 'patchSha256' = v_sha THEN
      RETURN jsonb_build_object('key', a.key, 'configVersion', (v_prior.after_state ->> 'configVersion')::BIGINT,
        'changed', v_prior.after_state -> 'changed');
    END IF;
    RAISE EXCEPTION 'ai_agent_request_conflict' USING ERRCODE = '40001';
  END IF;
  IF a.config_version <> p_expected_version THEN
    RAISE EXCEPTION 'ai_agent_version_conflict' USING ERRCODE = '40001';
  END IF;

  n_enabled := a.enabled; n_auto := a.auto_send; n_model := a.model; n_instr := a.instructions_override;
  n_cron := a.schedule_cron; n_tz := a.schedule_tz; n_prompt := a.schedule_prompt_override;
  n_trig_site := a.trigger_website_lead; n_trig_wa := a.trigger_whatsapp_inbound; n_budget := a.run_budget_usd;
  n_agent_id := a.claude_agent_id;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_patch) e LOOP
    IF k IN ('enabled', 'autoSend', 'triggerWebsiteLead', 'triggerWhatsappInbound') THEN
      IF jsonb_typeof(v) <> 'boolean' THEN
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
      IF k = 'enabled' THEN n_enabled := (v #>> '{}')::BOOLEAN;
      ELSIF k = 'autoSend' THEN n_auto := (v #>> '{}')::BOOLEAN;
      ELSIF k = 'triggerWebsiteLead' THEN n_trig_site := (v #>> '{}')::BOOLEAN;
      ELSE n_trig_wa := (v #>> '{}')::BOOLEAN;
      END IF;
    ELSIF k = 'model' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5') THEN
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
      n_model := v #>> '{}';
    ELSIF k IN ('instructionsOverride', 'schedulePromptOverride') THEN
      IF jsonb_typeof(v) = 'null' THEN
        v_text := NULL;
      ELSIF jsonb_typeof(v) = 'string' THEN
        v_text := v #>> '{}';
        IF char_length(v_text) > (CASE k WHEN 'instructionsOverride' THEN 60000 ELSE 8000 END) THEN
          RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
        END IF;
        IF btrim(v_text, E' \t\r\n') = '' THEN
          v_text := NULL;
        END IF;
      ELSE
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
      IF k = 'instructionsOverride' THEN n_instr := v_text; ELSE n_prompt := v_text; END IF;
    ELSIF k = 'scheduleCron' THEN
      IF jsonb_typeof(v) = 'null' THEN
        n_cron := NULL;
      ELSIF jsonb_typeof(v) = 'string' AND platform_private.ai_agents_cron_ok(v #>> '{}') THEN
        n_cron := v #>> '{}';
      ELSE
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
    ELSIF k = 'scheduleTz' THEN
      IF jsonb_typeof(v) <> 'string' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = (v #>> '{}')) THEN
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
      n_tz := v #>> '{}';
    ELSIF k = 'runBudgetUsd' THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::NUMERIC < 0 OR (v #>> '{}')::NUMERIC > 100 THEN
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
      n_budget := round((v #>> '{}')::NUMERIC, 2);
    ELSIF k = 'claudeAgentId' THEN
      IF jsonb_typeof(v) = 'null' THEN
        n_agent_id := NULL;
      ELSIF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^agent_[A-Za-z0-9]{8,64}$' THEN
        n_agent_id := v #>> '{}';
      ELSE
        RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'ai_agent_invalid_patch' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF n_enabled IS DISTINCT FROM a.enabled THEN v_changed := array_append(v_changed, 'enabled');
    v_before := v_before || jsonb_build_object('enabled', a.enabled); v_after := v_after || jsonb_build_object('enabled', n_enabled); END IF;
  IF n_auto IS DISTINCT FROM a.auto_send THEN v_changed := array_append(v_changed, 'autoSend');
    v_before := v_before || jsonb_build_object('autoSend', a.auto_send); v_after := v_after || jsonb_build_object('autoSend', n_auto); END IF;
  IF n_model IS DISTINCT FROM a.model THEN v_changed := array_append(v_changed, 'model');
    v_before := v_before || jsonb_build_object('model', a.model); v_after := v_after || jsonb_build_object('model', n_model); END IF;
  IF n_instr IS DISTINCT FROM a.instructions_override THEN v_changed := array_append(v_changed, 'instructionsOverride'); END IF;
  IF n_cron IS DISTINCT FROM a.schedule_cron THEN v_changed := array_append(v_changed, 'scheduleCron');
    v_before := v_before || jsonb_build_object('scheduleCron', a.schedule_cron); v_after := v_after || jsonb_build_object('scheduleCron', n_cron); END IF;
  IF n_tz IS DISTINCT FROM a.schedule_tz THEN v_changed := array_append(v_changed, 'scheduleTz');
    v_before := v_before || jsonb_build_object('scheduleTz', a.schedule_tz); v_after := v_after || jsonb_build_object('scheduleTz', n_tz); END IF;
  IF n_prompt IS DISTINCT FROM a.schedule_prompt_override THEN v_changed := array_append(v_changed, 'schedulePromptOverride'); END IF;
  IF n_trig_site IS DISTINCT FROM a.trigger_website_lead THEN v_changed := array_append(v_changed, 'triggerWebsiteLead');
    v_before := v_before || jsonb_build_object('triggerWebsiteLead', a.trigger_website_lead);
    v_after := v_after || jsonb_build_object('triggerWebsiteLead', n_trig_site); END IF;
  IF n_trig_wa IS DISTINCT FROM a.trigger_whatsapp_inbound THEN v_changed := array_append(v_changed, 'triggerWhatsappInbound');
    v_before := v_before || jsonb_build_object('triggerWhatsappInbound', a.trigger_whatsapp_inbound);
    v_after := v_after || jsonb_build_object('triggerWhatsappInbound', n_trig_wa); END IF;
  IF n_budget IS DISTINCT FROM a.run_budget_usd THEN v_changed := array_append(v_changed, 'runBudgetUsd');
    v_before := v_before || jsonb_build_object('runBudgetUsd', a.run_budget_usd); v_after := v_after || jsonb_build_object('runBudgetUsd', n_budget); END IF;
  IF n_agent_id IS DISTINCT FROM a.claude_agent_id THEN v_changed := array_append(v_changed, 'claudeAgentId'); v_agent_changed := TRUE; END IF;

  IF cardinality(v_changed) = 0 THEN
    RETURN jsonb_build_object('key', a.key, 'configVersion', a.config_version, 'changed', '[]'::JSONB);
  END IF;
  v_new_version := a.config_version + 1;
  UPDATE platform_private.ai_agents x SET
    enabled = n_enabled, auto_send = n_auto, model = n_model, instructions_override = n_instr,
    schedule_cron = n_cron, schedule_tz = n_tz, schedule_prompt_override = n_prompt,
    trigger_website_lead = n_trig_site, trigger_whatsapp_inbound = n_trig_wa, run_budget_usd = n_budget,
    claude_agent_id = n_agent_id,
    claude_agent_version = CASE WHEN v_agent_changed THEN NULL ELSE x.claude_agent_version END,
    synced_config_hash = CASE WHEN v_agent_changed THEN NULL ELSE x.synced_config_hash END,
    sync_status = CASE WHEN v_agent_changed THEN 'never' ELSE x.sync_status END,
    sync_error = CASE WHEN v_agent_changed THEN NULL ELSE x.sync_error END,
    config_version = v_new_version, updated_at = clock_timestamp(), updated_by_membership_id = v_actor.membership_id
  WHERE x.id = a.id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, v_actor.membership_id, a.key, 'ai.agent.config.change',
    'ai_agent', a.id, v_before,
    v_after || jsonb_build_object('agentKey', a.key, 'changed', to_jsonb(v_changed), 'configVersion', v_new_version,
      'patchSha256', v_sha),
    'ИИ-агент: изменены настройки', p_request_id);
  RETURN jsonb_build_object('key', a.key, 'configVersion', v_new_version, 'changed', to_jsonb(v_changed));
END
$$;

CREATE FUNCTION platform.ai_agents_runs_list_v1(p_organization_id UUID, p_key TEXT, p_limit INTEGER DEFAULT 30,
  p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_limit INTEGER := least(greatest(COALESCE(p_limit, 30), 1), 100); v_runs JSONB; v_n INTEGER;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(platform_private.ai_agent_run_json(r) ORDER BY r.started_at DESC, r.id DESC), '[]'::JSONB), count(*)
  INTO v_runs, v_n
  FROM (SELECT x.* FROM platform_private.ai_agent_runs x
    WHERE x.organization_id = p_organization_id AND x.agent_key = p_key AND (p_before IS NULL OR x.started_at < p_before)
    ORDER BY x.started_at DESC, x.id DESC LIMIT v_limit + 1) r;
  IF v_n > v_limit THEN
    SELECT COALESCE(jsonb_agg(e.value ORDER BY e.ord), '[]'::JSONB) INTO v_runs
    FROM jsonb_array_elements(v_runs) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  END IF;
  RETURN jsonb_build_object('runs', v_runs, 'hasMore', v_n > v_limit);
END
$$;

CREATE FUNCTION platform.ai_agents_run_get_v1(p_organization_id UUID, p_run_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; r platform_private.ai_agent_runs;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  SELECT * INTO r FROM platform_private.ai_agent_runs x WHERE x.organization_id = p_organization_id AND x.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('run', platform_private.ai_agent_run_json(r),
    'actions', (SELECT COALESCE(jsonb_agg(platform_private.ai_agent_action_json(x) ORDER BY x.at, x.id), '[]'::JSONB)
      FROM (SELECT y.* FROM platform_private.ai_agent_actions y WHERE y.run_id = r.id ORDER BY y.at, y.id LIMIT 200) x),
    'drafts', (SELECT COALESCE(jsonb_agg(platform_private.ai_agent_draft_json(d) ORDER BY d.created_at, d.id), '[]'::JSONB)
      FROM platform_private.ai_agent_drafts d WHERE d.run_id = r.id));
END
$$;

CREATE FUNCTION platform.ai_agents_drafts_list_v1(p_organization_id UUID, p_key TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_limit INTEGER := least(greatest(COALESCE(p_limit, 50), 1), 100);
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF (p_key IS NOT NULL AND NOT platform_private.ai_agent_key_known(p_key))
    OR (p_status IS NOT NULL AND p_status NOT IN ('pending', 'approved', 'sending', 'sent', 'discarded', 'failed', 'expired')) THEN
    RAISE EXCEPTION 'ai_agent_invalid_filter' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'drafts', (SELECT COALESCE(jsonb_agg(platform_private.ai_agent_draft_json(d) ORDER BY d.created_at DESC, d.id DESC), '[]'::JSONB)
      FROM (SELECT x.* FROM platform_private.ai_agent_drafts x
        WHERE x.organization_id = p_organization_id AND (p_key IS NULL OR x.agent_key = p_key)
          AND (p_status IS NULL OR platform_private.ai_agent_draft_status(x) = p_status)
        ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit) d),
    'counts', (SELECT jsonb_object_agg(s.status, COALESCE(c.n, 0))
      FROM (VALUES ('pending'), ('approved'), ('sending'), ('sent'), ('discarded'), ('failed'), ('expired')) s(status)
      LEFT JOIN (SELECT platform_private.ai_agent_draft_status(x) AS status, count(*) AS n
        FROM platform_private.ai_agent_drafts x
        WHERE x.organization_id = p_organization_id AND (p_key IS NULL OR x.agent_key = p_key)
        GROUP BY 1) c ON c.status = s.status));
END
$$;

-- platform.ai_agents_draft_decide_v1: одобрить (с правкой текста) или отклонить черновик.
CREATE FUNCTION platform.ai_agents_draft_decide_v1(p_organization_id UUID, p_draft_id UUID, p_decision TEXT,
  p_edited_text TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor RECORD; d platform_private.ai_agent_drafts; v_prior platform.audit_events; v_edited TEXT; v_max INTEGER;
  v_edit_sha TEXT;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.manage');
  IF p_draft_id IS NULL OR p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approve', 'discard') THEN
    RAISE EXCEPTION 'ai_agent_invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_edit_sha := platform_private.ai_agent_sha256(COALESCE(p_edited_text, ''));
  SELECT * INTO v_prior FROM platform.audit_events e WHERE e.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.organization_id = p_organization_id AND v_prior.action = 'ai.agent.draft.decide'
      AND v_prior.resource_id = d.id AND v_prior.actor_membership_id IS NOT DISTINCT FROM v_actor.membership_id
      AND v_prior.after_state ->> 'decision' = p_decision AND v_prior.after_state ->> 'editSha256' = v_edit_sha THEN
      RETURN jsonb_build_object('draftId', d.id, 'agentKey', d.agent_key, 'channel', d.channel,
        'status', platform_private.ai_agent_draft_status(d), 'text', COALESCE(d.edited_text, d.text),
        'conversationId', d.conversation_id, 'studentCaseId', d.student_case_id,
        'approverMembershipId', d.decided_by_membership_id);
    END IF;
    RAISE EXCEPTION 'ai_agent_request_conflict' USING ERRCODE = '40001';
  END IF;
  IF platform_private.ai_agent_draft_status(d) <> 'pending' THEN
    RAISE EXCEPTION 'ai_agent_draft_not_pending' USING ERRCODE = '55000';
  END IF;
  IF p_decision = 'approve' THEN
    -- No text passed: the draft is approved as staff last saw it (an earlier edit stays). A text equal to the
    -- agent's own clears the edit.
    v_edited := d.edited_text;
    IF p_edited_text IS NOT NULL THEN
      v_max := CASE d.channel WHEN 'whatsapp' THEN 4000 ELSE 8000 END;
      v_edited := platform_private.ai_agent_clean_text(p_edited_text);
      IF NOT platform_private.ai_agent_text_ok(v_edited, v_max) THEN
        RAISE EXCEPTION 'ai_agent_invalid_text' USING ERRCODE = '22023';
      END IF;
      IF v_edited = d.text THEN
        v_edited := NULL;
      END IF;
    END IF;
    UPDATE platform_private.ai_agent_drafts x SET status = 'approved', edited_text = v_edited, failure_code = NULL,
      decided_by_membership_id = v_actor.membership_id, decided_at = clock_timestamp()
    WHERE x.id = d.id RETURNING * INTO d;
  ELSE
    UPDATE platform_private.ai_agent_drafts x SET status = 'discarded', decided_by_membership_id = v_actor.membership_id,
      decided_at = clock_timestamp()
    WHERE x.id = d.id RETURNING * INTO d;
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, v_actor.membership_id, d.agent_key, 'ai.agent.draft.decide',
    'ai_agent_draft', d.id, jsonb_build_object('status', 'pending'),
    jsonb_build_object('agentKey', d.agent_key, 'channel', d.channel, 'decision', p_decision, 'status', d.status,
      'edited', d.edited_text IS NOT NULL, 'editSha256', v_edit_sha),
    'ИИ-агент: решение по сообщению', p_request_id);
  RETURN jsonb_build_object('draftId', d.id, 'agentKey', d.agent_key, 'channel', d.channel, 'status', d.status,
    'text', COALESCE(d.edited_text, d.text), 'conversationId', d.conversation_id, 'studentCaseId', d.student_case_id,
    'approverMembershipId', d.decided_by_membership_id);
END
$$;

CREATE FUNCTION platform.ai_agents_digests_list_v1(p_organization_id UUID, p_key TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 10)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; v_limit INTEGER := least(greatest(COALESCE(p_limit, 10), 1), 50);
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id, 'ai.agent.use');
  IF p_key IS NOT NULL AND NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('digests', (SELECT COALESCE(jsonb_agg(platform_private.ai_agent_digest_json(g)
      ORDER BY g.created_at DESC, g.id DESC), '[]'::JSONB)
    FROM (SELECT x.* FROM platform_private.ai_agent_digests x
      WHERE x.organization_id = p_organization_id AND (p_key IS NULL OR x.agent_key = p_key)
      ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit) g));
END
$$;

-- platform.ai_agents_run_authorize_v1: сервер приложения спрашивает, можно ли запустить поручение.
CREATE FUNCTION platform.ai_agents_run_authorize_v1(p_organization_id UUID, p_key TEXT,
  p_send_authority BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor RECORD; a platform_private.ai_agents;
BEGIN
  SELECT * INTO v_actor FROM platform_private.ai_staff_actor(p_organization_id,
    CASE WHEN COALESCE(p_send_authority, FALSE) THEN 'ai.agent.manage' ELSE 'ai.agent.use' END);
  IF NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT a.enabled THEN
    RAISE EXCEPTION 'agent_disabled' USING ERRCODE = '55000';
  END IF;
  IF a.claude_agent_id IS NULL OR a.claude_vault_id IS NULL OR a.claude_environment_id IS NULL OR a.sync_status <> 'ok' THEN
    RAISE EXCEPTION 'agent_not_synced' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM platform_private.ai_agent_runs r WHERE r.organization_id = p_organization_id
      AND r.agent_key = p_key AND r.trigger_kind = 'command' AND r.status IN ('starting', 'running')) >= 3 THEN
    RAISE EXCEPTION 'run_in_progress' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('agentKey', a.key, 'title', a.title, 'enabled', a.enabled, 'autoSend', a.auto_send,
    'model', a.model, 'runBudgetUsd', a.run_budget_usd, 'membershipId', v_actor.membership_id,
    'claude', jsonb_build_object('agentId', a.claude_agent_id, 'agentVersion', a.claude_agent_version,
      'environmentId', a.claude_environment_id, 'vaultId', a.claude_vault_id));
END
$$;

-- ---------------------------------------------------------------------------
-- A.4 Функции рантайма CRM (service_role; ответы - camelCase).
-- ---------------------------------------------------------------------------

CREATE FUNCTION platform.ai_agent_runtime_get_v1(p_organization_id UUID, p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN platform_private.ai_agent_detail(a) || jsonb_build_object(
    'claudeAgentId', a.claude_agent_id, 'claudeAgentVersion', a.claude_agent_version,
    'environmentId', a.claude_environment_id, 'vaultId', a.claude_vault_id, 'credentialId', a.claude_credential_id,
    'deploymentId', a.claude_deployment_id, 'mcpUrl', a.claude_mcp_url, 'configHash', a.synced_config_hash,
    'tokenFingerprint', left(a.mcp_token_sha256, 12), 'syncStatus', a.sync_status);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_sync_record_v1(p_organization_id UUID, p_key TEXT, p_actor_membership_id UUID,
  p_result JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; k TEXT; v JSONB; v_status TEXT; v_error TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) OR p_result IS NULL
    OR jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result -> 'status') <> 'string'
    OR (p_result ->> 'status') NOT IN ('pending', 'ok', 'error') THEN
    RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_result) e LOOP
    IF k NOT IN ('status', 'error', 'claudeAgentId', 'agentVersion', 'environmentId', 'vaultId', 'credentialId',
        'deploymentId', 'mcpUrl', 'configHash') THEN
      RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
    END IF;
    IF k = 'agentVersion' THEN
      IF jsonb_typeof(v) NOT IN ('number', 'null') OR (jsonb_typeof(v) = 'number' AND
        ((v #>> '{}')::NUMERIC <> trunc((v #>> '{}')::NUMERIC) OR (v #>> '{}')::NUMERIC < 0 OR (v #>> '{}')::NUMERIC > 2147483647)) THEN
        RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
      END IF;
    ELSIF k = 'configHash' THEN
      IF NOT (jsonb_typeof(v) = 'null' OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[0-9a-f]{64}$')) THEN
        RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
      END IF;
    ELSIF k <> 'status' THEN
      IF NOT (jsonb_typeof(v) = 'null' OR (jsonb_typeof(v) = 'string'
        AND char_length(v #>> '{}') <= (CASE k WHEN 'mcpUrl' THEN 2048 WHEN 'error' THEN 500 ELSE 200 END))) THEN
        RAISE EXCEPTION 'ai_agent_invalid_sync' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_status := p_result ->> 'status';
  v_error := CASE WHEN v_status = 'error' THEN left(COALESCE(p_result ->> 'error', 'sync_failed'), 500) END;
  UPDATE platform_private.ai_agents x SET
    sync_status = v_status, sync_error = v_error,
    synced_at = CASE WHEN v_status = 'ok' THEN clock_timestamp() ELSE x.synced_at END,
    claude_agent_id = CASE WHEN p_result ? 'claudeAgentId' THEN p_result ->> 'claudeAgentId' ELSE x.claude_agent_id END,
    claude_agent_version = CASE WHEN p_result ? 'agentVersion' THEN (p_result ->> 'agentVersion')::INTEGER ELSE x.claude_agent_version END,
    claude_environment_id = CASE WHEN p_result ? 'environmentId' THEN p_result ->> 'environmentId' ELSE x.claude_environment_id END,
    claude_vault_id = CASE WHEN p_result ? 'vaultId' THEN p_result ->> 'vaultId' ELSE x.claude_vault_id END,
    claude_credential_id = CASE WHEN p_result ? 'credentialId' THEN p_result ->> 'credentialId' ELSE x.claude_credential_id END,
    claude_deployment_id = CASE WHEN p_result ? 'deploymentId' THEN p_result ->> 'deploymentId' ELSE x.claude_deployment_id END,
    claude_mcp_url = CASE WHEN p_result ? 'mcpUrl' THEN p_result ->> 'mcpUrl' ELSE x.claude_mcp_url END,
    synced_config_hash = CASE WHEN p_result ? 'configHash' THEN p_result ->> 'configHash' ELSE x.synced_config_hash END,
    updated_at = clock_timestamp()
  WHERE x.id = a.id;
  IF v_status IN ('ok', 'error') THEN
    PERFORM platform_private.ai_agent_audit(p_organization_id, p_actor_membership_id, a.key, 'ai.agent.sync', 'ai_agent',
      a.id, NULL, jsonb_build_object('agentKey', a.key, 'status', v_status, 'agentVersion', p_result -> 'agentVersion'),
      'ИИ-агент: синхронизация с Claude');
  END IF;
  RETURN jsonb_build_object('ok', TRUE, 'syncStatus', v_status);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_token_set_v1(p_organization_id UUID, p_key TEXT, p_actor_membership_id UUID,
  p_new_sha256 TEXT, p_mode TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) OR p_mode IS NULL
    OR p_mode NOT IN ('stage', 'restore', 'clear')
    OR (p_mode = 'stage' AND (p_new_sha256 IS NULL OR p_new_sha256 !~ '^[0-9a-f]{64}$'))
    OR (p_mode <> 'stage' AND p_new_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'ai_agent_invalid_token_op' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_mode = 'stage' THEN
    IF p_new_sha256 IN (COALESCE(a.mcp_token_sha256, ''), COALESCE(a.mcp_token_prev_sha256, '')) THEN
      RAISE EXCEPTION 'ai_agent_invalid_token_op' USING ERRCODE = '22023';
    END IF;
    UPDATE platform_private.ai_agents x SET mcp_token_prev_sha256 = x.mcp_token_sha256,
      mcp_token_prev_until = CASE WHEN x.mcp_token_sha256 IS NULL THEN NULL
        ELSE v_now + INTERVAL '10 minutes' END,
      mcp_token_sha256 = p_new_sha256, mcp_token_rotated_at = v_now, updated_at = v_now
    WHERE x.id = a.id RETURNING * INTO a;
  ELSIF p_mode = 'restore' THEN
    UPDATE platform_private.ai_agents x SET mcp_token_sha256 = x.mcp_token_prev_sha256, mcp_token_prev_sha256 = NULL,
      mcp_token_prev_until = NULL, updated_at = v_now
    WHERE x.id = a.id RETURNING * INTO a;
  ELSE
    UPDATE platform_private.ai_agents x SET mcp_token_sha256 = NULL, mcp_token_prev_sha256 = NULL,
      mcp_token_prev_until = NULL, updated_at = v_now
    WHERE x.id = a.id RETURNING * INTO a;
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, p_actor_membership_id, a.key, 'ai.agent.token.rotate',
    'ai_agent', a.id, NULL, jsonb_build_object('agentKey', a.key, 'mode', p_mode, 'tokenFingerprint', left(a.mcp_token_sha256, 12)),
    'ИИ-агент: обновлён токен доступа');
  RETURN jsonb_build_object('tokenFingerprint', left(a.mcp_token_sha256, 12));
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_run_reserve_v1(p_organization_id UUID, p_key TEXT, p_trigger_kind TEXT,
  p_dedupe_key TEXT, p_started_by_membership_id UUID, p_send_authority_sha256 TEXT, p_prompt_preview TEXT,
  p_model TEXT, p_agent_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_id UUID; v_existing UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) OR p_trigger_kind IS NULL
    OR p_trigger_kind NOT IN ('command', 'schedule', 'website_lead', 'whatsapp_inbound')
    OR (p_send_authority_sha256 IS NOT NULL AND p_send_authority_sha256 !~ '^[0-9a-f]{64}$')
    OR (p_dedupe_key IS NOT NULL AND char_length(p_dedupe_key) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_dedupe_key IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_key AND r.dedupe_key = p_dedupe_key;
    IF FOUND THEN
      RETURN jsonb_build_object('reserved', FALSE, 'reason', 'duplicate', 'existingRunId', v_existing);
    END IF;
  END IF;
  IF p_trigger_kind IN ('website_lead', 'whatsapp_inbound') THEN
    SELECT r.id INTO v_existing FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_key AND r.trigger_kind = p_trigger_kind
      AND r.status IN ('starting', 'running') ORDER BY r.started_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('reserved', FALSE, 'reason', 'run_in_progress', 'existingRunId', v_existing);
    END IF;
  END IF;
  INSERT INTO platform_private.ai_agent_runs (organization_id, agent_key, trigger_kind, dedupe_key, started_by_membership_id,
    send_authority, send_authority_sha256, prompt_preview, model, agent_version)
  VALUES (p_organization_id, p_key, p_trigger_kind, p_dedupe_key, p_started_by_membership_id,
    p_send_authority_sha256 IS NOT NULL, p_send_authority_sha256, left(p_prompt_preview, 500),
    COALESCE(p_model, a.model), COALESCE(p_agent_version, a.claude_agent_version))
  RETURNING id INTO v_id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, p_started_by_membership_id, p_key, 'ai.agent.run.start',
    'ai_agent_run', v_id,
    NULL, jsonb_build_object('agentKey', p_key, 'trigger', p_trigger_kind, 'model', COALESCE(p_model, a.model),
      'sendAuthority', p_send_authority_sha256 IS NOT NULL),
    'ИИ-агент: запуск');
  RETURN jsonb_build_object('reserved', TRUE, 'runId', v_id);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_run_update_v1(p_organization_id UUID, p_run_id UUID, p_patch JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r platform_private.ai_agent_runs; k TEXT; v JSONB; v_new TEXT; v_terminal CONSTANT TEXT[] :=
    ARRAY['completed', 'failed', 'budget_reached', 'interrupted', 'needs_attention'];
  v_ended TIMESTAMPTZ; v_set_ended BOOLEAN := FALSE;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_run_id IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(p_patch) e LOOP
    IF k NOT IN ('sessionId', 'status', 'endedAt', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'costCents',
        'activeSeconds', 'summary', 'errorCode', 'errorMessage', 'eventCount', 'lastReconciledAt') THEN
      RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
    END IF;
    IF k IN ('inputTokens', 'outputTokens', 'cacheReadTokens', 'costCents', 'eventCount', 'activeSeconds') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::NUMERIC < 0 OR (v #>> '{}')::NUMERIC > 9000000000000 THEN
        RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('sessionId', 'status', 'summary', 'errorCode', 'errorMessage', 'endedAt', 'lastReconciledAt') THEN
      IF jsonb_typeof(v) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;
  SELECT * INTO r FROM platform_private.ai_agent_runs x WHERE x.organization_id = p_organization_id AND x.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_new := COALESCE(p_patch ->> 'status', r.status);
  IF v_new NOT IN ('starting', 'running', 'completed', 'failed', 'budget_reached', 'interrupted', 'needs_attention') THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  IF v_new <> r.status AND NOT (
    (r.status = 'starting' AND v_new <> 'starting')
    OR (r.status = 'running' AND v_new = ANY (v_terminal))
    OR (r.status IN ('needs_attention', 'completed') AND v_new = 'running')) THEN
    RAISE EXCEPTION 'ai_agent_run_transition' USING ERRCODE = '55000';
  END IF;
  IF p_patch ? 'endedAt' THEN
    v_ended := (p_patch ->> 'endedAt')::TIMESTAMPTZ;
    v_set_ended := TRUE;
  ELSIF v_new = ANY (v_terminal) AND r.ended_at IS NULL THEN
    v_ended := clock_timestamp();
    v_set_ended := TRUE;
  ELSIF v_new IN ('starting', 'running') AND r.ended_at IS NOT NULL THEN
    v_ended := NULL;
    v_set_ended := TRUE;
  END IF;
  UPDATE platform_private.ai_agent_runs x SET
    claude_session_id = CASE WHEN p_patch ? 'sessionId' THEN left(p_patch ->> 'sessionId', 200) ELSE x.claude_session_id END,
    status = v_new,
    ended_at = CASE WHEN v_set_ended THEN v_ended ELSE x.ended_at END,
    input_tokens = CASE WHEN p_patch ? 'inputTokens' THEN (p_patch ->> 'inputTokens')::BIGINT ELSE x.input_tokens END,
    output_tokens = CASE WHEN p_patch ? 'outputTokens' THEN (p_patch ->> 'outputTokens')::BIGINT ELSE x.output_tokens END,
    cache_read_tokens = CASE WHEN p_patch ? 'cacheReadTokens' THEN (p_patch ->> 'cacheReadTokens')::BIGINT ELSE x.cache_read_tokens END,
    cost_cents = CASE WHEN p_patch ? 'costCents' THEN least((p_patch ->> 'costCents')::NUMERIC, 2147483647)::INTEGER ELSE x.cost_cents END,
    active_seconds = CASE WHEN p_patch ? 'activeSeconds' THEN (p_patch ->> 'activeSeconds')::NUMERIC ELSE x.active_seconds END,
    summary = CASE WHEN p_patch ? 'summary' THEN left(p_patch ->> 'summary', 4000) ELSE x.summary END,
    error_code = CASE WHEN p_patch ? 'errorCode' THEN left(p_patch ->> 'errorCode', 64) ELSE x.error_code END,
    error_message = CASE WHEN p_patch ? 'errorMessage' THEN left(p_patch ->> 'errorMessage', 500) ELSE x.error_message END,
    event_count = CASE WHEN p_patch ? 'eventCount' THEN least((p_patch ->> 'eventCount')::NUMERIC, 2147483647)::INTEGER ELSE x.event_count END,
    last_reconciled_at = CASE WHEN p_patch ? 'lastReconciledAt' THEN (p_patch ->> 'lastReconciledAt')::TIMESTAMPTZ ELSE x.last_reconciled_at END
  WHERE x.id = r.id RETURNING * INTO r;
  IF r.status = ANY (v_terminal) AND NOT EXISTS (SELECT 1 FROM platform.audit_events e
      WHERE e.organization_id = r.organization_id AND e.resource_id = r.id AND e.action = 'ai.agent.run.finish') THEN
    PERFORM platform_private.ai_agent_audit(r.organization_id, NULL, r.agent_key, 'ai.agent.run.finish', 'ai_agent_run', r.id,
      NULL, jsonb_build_object('agentKey', r.agent_key, 'status', r.status, 'costCents', r.cost_cents,
        'actions', (SELECT count(*) FROM platform_private.ai_agent_actions a WHERE a.run_id = r.id)),
      'ИИ-агент: запуск закончен');
  END IF;
  RETURN jsonb_build_object('ok', TRUE);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_run_get_v1(p_organization_id UUID, p_run_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r platform_private.ai_agent_runs; a platform_private.ai_agents;
BEGIN
  PERFORM platform_private.require_p2g_service();
  SELECT * INTO r FROM platform_private.ai_agent_runs x WHERE x.organization_id = p_organization_id AND x.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_run_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = r.organization_id AND x.key = r.agent_key;
  RETURN platform_private.ai_agent_run_json(r) || jsonb_build_object('agent', jsonb_build_object(
    'key', a.key, 'title', a.title, 'claudeAgentId', a.claude_agent_id, 'vaultId', a.claude_vault_id,
    'environmentId', a.claude_environment_id, 'model', a.model, 'enabled', a.enabled));
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_runs_open_v1(p_organization_id UUID, p_key TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 20)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('runId', r.id, 'agentKey', r.agent_key, 'sessionId', r.claude_session_id,
      'status', r.status, 'startedAt', r.started_at, 'lastReconciledAt', r.last_reconciled_at)
      ORDER BY r.started_at, r.id)
    FROM (SELECT x.* FROM platform_private.ai_agent_runs x
      WHERE x.organization_id = p_organization_id AND x.status IN ('starting', 'running')
        AND (p_key IS NULL OR x.agent_key = p_key)
      ORDER BY x.started_at, x.id LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100)) r), '[]'::JSONB);
END
$$;

-- Запуск по расписанию, найденный при сверке: находит запись по id сессии или создаёт и привязывает
-- «сиротские» действия агента (run_id IS NULL) того же окна.
CREATE FUNCTION platform.ai_agent_runtime_scheduled_run_upsert_v1(p_organization_id UUID, p_key TEXT, p_session_id TEXT,
  p_started_at TIMESTAMPTZ, p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; r platform_private.ai_agent_runs; v_status TEXT; v_created BOOLEAN := FALSE;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR NOT platform_private.ai_agent_key_known(p_key) OR p_session_id IS NULL
    OR char_length(p_session_id) NOT BETWEEN 1 AND 200 OR p_started_at IS NULL THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  v_status := CASE WHEN p_status IN ('starting', 'running', 'completed', 'failed', 'budget_reached', 'interrupted',
    'needs_attention') THEN p_status ELSE 'running' END;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  SELECT * INTO a FROM platform_private.ai_agents x WHERE x.organization_id = p_organization_id AND x.key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM platform_private.ai_agent_runs x WHERE x.claude_session_id = p_session_id;
  IF NOT FOUND THEN
    INSERT INTO platform_private.ai_agent_runs (organization_id, agent_key, claude_session_id, trigger_kind, status,
      started_at, ended_at, model, agent_version)
    VALUES (p_organization_id, p_key, p_session_id, 'schedule', v_status, p_started_at,
      CASE WHEN v_status IN ('completed', 'failed', 'budget_reached', 'interrupted', 'needs_attention') THEN clock_timestamp() END,
      a.model, a.claude_agent_version)
    RETURNING * INTO r;
    v_created := TRUE;
    PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_key, 'ai.agent.run.start', 'ai_agent_run', r.id, NULL,
      jsonb_build_object('agentKey', p_key, 'trigger', 'schedule', 'model', a.model, 'sendAuthority', FALSE),
      'ИИ-агент: запуск по расписанию');
  ELSIF r.organization_id <> p_organization_id OR r.agent_key <> p_key THEN
    RAISE EXCEPTION 'ai_agent_run_conflict' USING ERRCODE = '55000';
  END IF;
  UPDATE platform_private.ai_agent_actions x SET run_id = r.id
  WHERE x.organization_id = p_organization_id AND x.agent_key = p_key AND x.run_id IS NULL
    AND x.at >= r.started_at - INTERVAL '1 minute'
    AND x.at <= COALESCE(r.ended_at, clock_timestamp() + INTERVAL '2 minutes');
  RETURN jsonb_build_object('runId', r.id, 'created', v_created);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_dispatch_targets_v1(p_organization_id UUID, p_trigger_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_trigger_kind IS NULL OR p_trigger_kind NOT IN ('website_lead', 'whatsapp_inbound') THEN
    RAISE EXCEPTION 'ai_agent_invalid_run' USING ERRCODE = '22023';
  END IF;
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('key', a.key, 'title', a.title, 'model', a.model,
      'claudeAgentId', a.claude_agent_id, 'agentVersion', a.claude_agent_version, 'environmentId', a.claude_environment_id,
      'vaultId', a.claude_vault_id, 'runBudgetUsd', a.run_budget_usd, 'autoSend', a.auto_send) ORDER BY a.sort_order, a.key)
    FROM platform_private.ai_agents a
    WHERE a.organization_id = p_organization_id AND a.enabled AND a.sync_status = 'ok'
      AND a.claude_agent_id IS NOT NULL AND a.claude_vault_id IS NOT NULL AND a.claude_environment_id IS NOT NULL
      AND ((p_trigger_kind = 'website_lead' AND a.trigger_website_lead)
        OR (p_trigger_kind = 'whatsapp_inbound' AND a.trigger_whatsapp_inbound))), '[]'::JSONB);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_draft_get_v1(p_organization_id UUID, p_draft_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d platform_private.ai_agent_drafts;
BEGIN
  PERFORM platform_private.require_p2g_service();
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('id', d.id, 'agentKey', d.agent_key, 'channel', d.channel, 'status', d.status, 'text', d.text,
    'finalText', COALESCE(d.edited_text, d.text), 'conversationId', d.conversation_id, 'studentCaseId', d.student_case_id,
    'sourceMessageId', d.source_message_id, 'decidedByMembershipId', d.decided_by_membership_id,
    'failureCode', d.failure_code);
END
$$;

-- Журнал платформы об отправке сообщения агентом (объект - чат или дело).
CREATE FUNCTION platform_private.ai_agent_audit_message_send(d platform_private.ai_agent_drafts, p_sender UUID)
RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.ai_agent_audit(d.organization_id, NULL, d.agent_key, 'ai.agent.message.send',
    CASE d.channel WHEN 'whatsapp' THEN 'communication_conversation' ELSE 'student_case' END,
    CASE d.channel WHEN 'whatsapp' THEN d.conversation_id ELSE d.student_case_id END,
    NULL, jsonb_build_object('agentKey', d.agent_key, 'channel', d.channel, 'draftId', d.id,
      'sentByAgent', d.sent_by_agent, 'senderMembershipId', p_sender),
    'ИИ-агент: сообщение отправлено');
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_draft_mark_v1(p_organization_id UUID, p_draft_id UUID, p_status TEXT,
  p_failure_code TEXT, p_sent_by_membership_id UUID, p_provider JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d platform_private.ai_agent_drafts; v_provider JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_draft_id IS NULL OR p_status IS NULL OR p_status NOT IN ('pending', 'failed', 'sent')
    OR (p_failure_code IS NOT NULL AND p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$')
    OR (p_provider IS NOT NULL AND jsonb_typeof(p_provider) <> 'object') THEN
    RAISE EXCEPTION 'ai_agent_invalid_draft_op' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Повтор того же итога.
  IF d.status = p_status AND p_status IN ('sent', 'failed') THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', d.status, 'replayed', TRUE);
  END IF;
  v_provider := COALESCE(d.provider, '{}'::JSONB) || COALESCE(
    (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(COALESCE(p_provider, '{}'::JSONB)) e
     WHERE e.key IN ('messageId', 'authorizationId', 'workItemId') AND jsonb_typeof(e.value) = 'string'), '{}'::JSONB);
  IF d.status = 'approved' AND p_status = 'pending'
    AND p_failure_code IN ('whatsapp_unavailable', 'rate_limited', 'staff_active', 'sender_unavailable') THEN
    UPDATE platform_private.ai_agent_drafts x SET status = 'pending', failure_code = p_failure_code
    WHERE x.id = d.id RETURNING * INTO d;
  ELSIF d.status = 'approved' AND p_status = 'failed' AND p_failure_code IS NOT NULL THEN
    UPDATE platform_private.ai_agent_drafts x SET status = 'failed', failure_code = p_failure_code
    WHERE x.id = d.id RETURNING * INTO d;
  ELSIF d.status = 'sending' AND p_status = 'failed' AND p_failure_code IS NOT NULL THEN
    UPDATE platform_private.ai_agent_drafts x SET status = 'failed', failure_code = p_failure_code, provider = v_provider
    WHERE x.id = d.id RETURNING * INTO d;
  ELSIF d.status = 'sending' AND p_status = 'sent' THEN
    UPDATE platform_private.ai_agent_drafts x SET status = 'sent', failure_code = NULL, sent_at = clock_timestamp(),
      sent_by_membership_id = COALESCE(p_sent_by_membership_id, x.sent_by_membership_id), provider = v_provider
    WHERE x.id = d.id RETURNING * INTO d;
    PERFORM platform_private.ai_agent_audit_message_send(d, d.sent_by_membership_id);
  ELSE
    RAISE EXCEPTION 'ai_agent_draft_transition' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('ok', TRUE, 'status', d.status, 'replayed', FALSE);
END
$$;

-- Запись сообщения в чат дела - ровно как case_chat_command (режим post, 191): сообщение, заголовок
-- ветки «Ждём студента», сигнал realtime. Автор - отправитель. Одобренный черновик -> sent.
CREATE FUNCTION platform_private.ai_agent_portal_post(p_organization_id UUID, p_draft_id UUID, p_sender UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d platform_private.ai_agent_drafts; c platform.student_cases; msg platform.case_chat_messages; v_text TEXT;
BEGIN
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.channel <> 'portal' THEN
    RAISE EXCEPTION 'ai_agent_draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF d.status = 'sent' AND d.provider ? 'messageId' THEN
    SELECT * INTO msg FROM platform.case_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.id = (d.provider ->> 'messageId')::UUID;
    RETURN jsonb_build_object('messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT, 'replayed', TRUE);
  END IF;
  IF d.status <> 'approved' THEN
    RAISE EXCEPTION 'not_approved' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = d.student_case_id;
  IF NOT FOUND OR c.state = 'closed' THEN
    RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_sender IS NULL OR NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = p_sender AND m.status = 'active' AND p.status = 'active'
        AND m."current_role" IS DISTINCT FROM 'student'
        AND platform_private.staff_can_access(m.organization_id, m.id, 'case.update.append', 'student_case', c.id)) THEN
    RAISE EXCEPTION 'sender_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('case-chat:' || p_organization_id::TEXT || ':' || c.id::TEXT, 0));
  v_text := COALESCE(d.edited_text, d.text);
  INSERT INTO platform.case_chat_messages (organization_id, student_case_id, author_membership_id, body)
  VALUES (p_organization_id, c.id, p_sender, v_text) RETURNING * INTO msg;
  INSERT INTO platform.case_chat_threads (organization_id, student_case_id, last_message_at, last_message_sequence_id,
    await_state, await_set_by_membership_id, await_set_at)
  VALUES (p_organization_id, c.id, msg.created_at, msg.sequence_id, 'awaiting_student', p_sender, clock_timestamp())
  ON CONFLICT (organization_id, student_case_id) DO UPDATE SET
    last_message_at = EXCLUDED.last_message_at, last_message_sequence_id = EXCLUDED.last_message_sequence_id,
    await_state = EXCLUDED.await_state, await_set_by_membership_id = EXCLUDED.await_set_by_membership_id,
    await_set_at = EXCLUDED.await_set_at;
  PERFORM realtime.send(jsonb_build_object('refresh', TRUE), 'invalidate',
    'case-chat:' || p_organization_id::TEXT || ':' || c.id::TEXT, TRUE);
  UPDATE platform_private.ai_agent_drafts x SET status = 'sent', failure_code = NULL, sent_at = clock_timestamp(),
    sent_by_membership_id = p_sender, provider = jsonb_build_object('messageId', msg.id::TEXT)
  WHERE x.id = d.id RETURNING * INTO d;
  PERFORM platform_private.ai_agent_audit_message_send(d, p_sender);
  RETURN jsonb_build_object('messageId', msg.id, 'sequenceId', msg.sequence_id::TEXT, 'replayed', FALSE);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_portal_send_v1(p_organization_id UUID, p_draft_id UUID, p_sender_membership_id UUID,
  p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_draft_id IS NULL OR p_sender_membership_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'ai_agent_invalid_draft_op' USING ERRCODE = '22023';
  END IF;
  RETURN platform_private.ai_agent_portal_post(p_organization_id, p_draft_id, p_sender_membership_id);
END
$$;

CREATE FUNCTION platform.ai_agent_runtime_org_settings_v1(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_responsible UUID;
BEGIN
  PERFORM platform_private.require_p2g_service();
  PERFORM platform_private.ai_agents_ensure_rows(p_organization_id);
  v_responsible := platform_private.ai_agents_responsible(p_organization_id);
  RETURN jsonb_build_object('responsibleMembershipId', v_responsible,
    'responsibleName', platform_private.ai_agent_member_name(p_organization_id, v_responsible));
END
$$;

-- ---------------------------------------------------------------------------
-- A.5 MCP (service_role) и инструменты. Входы и выходы инструментов - snake_case.
-- ---------------------------------------------------------------------------

-- A.5.1 Вспомогательные функции MCP-сервера ----------------------------------

CREATE FUNCTION platform.ai_agent_mcp_auth_v1(p_token_sha256 TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM platform_private.ai_agents x
  WHERE x.mcp_token_sha256 = p_token_sha256
    OR (x.mcp_token_prev_sha256 = p_token_sha256 AND x.mcp_token_prev_until > clock_timestamp())
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('organizationId', a.organization_id, 'agentKey', a.key, 'title', a.title,
    'direction', a.direction, 'enabled', a.enabled, 'autoSend', a.auto_send);
END
$$;

-- Сводка аргументов для таблицы действий (до 300 символов): ключи и короткие скаляры; тексты, курсоры,
-- ключи повторов и код полномочия заменены длиной.
CREATE FUNCTION platform_private.ai_agent_args_summary(p_args JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(COALESCE(string_agg(e.key || '=' || CASE
      WHEN e.key IN ('text', 'body', 'body_md', 'description', 'query', 'title', 'reason', 'metrics', 'authority_code',
        'idempotency_key', 'dedupe_key', 'cursor', 'before')
        THEN '<' || char_length(CASE WHEN jsonb_typeof(e.value) = 'string' THEN e.value #>> '{}' ELSE e.value::TEXT END) || ' симв.>'
      WHEN jsonb_typeof(e.value) = 'string' THEN
        CASE WHEN char_length(e.value #>> '{}') <= 40 THEN e.value #>> '{}'
          ELSE '<' || char_length(e.value #>> '{}') || ' симв.>' END
      WHEN jsonb_typeof(e.value) = 'array' THEN '[' || jsonb_array_length(e.value) || ']'
      WHEN jsonb_typeof(e.value) = 'object' THEN '{…}'
      ELSE e.value::TEXT END, '; ' ORDER BY e.key), ''), 300)
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::JSONB END) e
$$;

CREATE FUNCTION platform.ai_agent_mcp_log_v1(p_organization_id UUID, p_agent_key TEXT, p_tool TEXT, p_args JSONB,
  p_status TEXT, p_error_code TEXT, p_duration_ms INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run platform_private.ai_agent_runs; v_action BIGINT; v_audit UUID; v_args JSONB := COALESCE(p_args, '{}'::JSONB);
  v_type TEXT; v_id UUID; v_case UUID; v_act TEXT;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_agent_key IS NULL OR p_tool IS NULL OR p_status IS NULL
    OR p_status NOT IN ('ok', 'error', 'denied')
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_tool_schemas s WHERE s.tool = p_tool)
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_agents a WHERE a.organization_id = p_organization_id AND a.key = p_agent_key) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  INSERT INTO platform_private.ai_agent_actions (organization_id, agent_key, run_id, tool, args_summary, result_status,
    error_code, duration_ms)
  VALUES (p_organization_id, p_agent_key, v_run.id, p_tool, platform_private.ai_agent_args_summary(v_args), p_status,
    left(p_error_code, 64), p_duration_ms)
  RETURNING id INTO v_action;
  IF p_status = 'ok' AND p_tool IN ('get_client_card', 'get_lead', 'get_case', 'get_document_file', 'get_conversation', 'get_case_chat') THEN
    -- Объект записи по приоритету: версия/слот документа -> дело; дело; лид; клиент; чат.
    BEGIN
      IF v_args ? 'document_version_id' THEN
        SELECT v.student_case_id INTO v_case FROM platform.document_versions v
        WHERE v.organization_id = p_organization_id AND v.id = (v_args ->> 'document_version_id')::UUID;
        v_type := 'student_case'; v_id := v_case;
      ELSIF v_args ? 'slot_id' THEN
        SELECT s.student_case_id INTO v_case FROM platform.document_slots s
        WHERE s.organization_id = p_organization_id AND s.id = (v_args ->> 'slot_id')::UUID;
        v_type := 'student_case'; v_id := v_case;
      ELSIF v_args ? 'case_id' THEN
        v_type := 'student_case'; v_id := (v_args ->> 'case_id')::UUID;
      ELSIF v_args ? 'lead_id' THEN
        v_type := 'lead'; v_id := (v_args ->> 'lead_id')::UUID;
      ELSIF v_args ? 'client_id' THEN
        v_type := 'client'; v_id := (v_args ->> 'client_id')::UUID;
      ELSIF v_args ? 'conversation_id' THEN
        v_type := 'communication_conversation'; v_id := (v_args ->> 'conversation_id')::UUID;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      v_id := NULL;
    END;
    IF v_id IS NOT NULL THEN
      v_act := CASE WHEN p_tool = 'get_document_file' THEN 'ai.agent.document.read' ELSE 'ai.agent.tool.read' END;
      v_audit := platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, v_act, v_type, v_id, NULL,
        jsonb_build_object('agentKey', p_agent_key, 'tool', p_tool),
        CASE WHEN p_tool = 'get_document_file' THEN 'ИИ-агент открыл документ студента' ELSE 'ИИ-агент прочитал данные клиента' END);
      UPDATE platform_private.ai_agent_actions x SET audit_event_id = v_audit WHERE x.id = v_action;
    END IF;
  END IF;
  RETURN jsonb_build_object('actionId', v_action);
END
$$;

CREATE FUNCTION platform.ai_agent_mcp_file_resolve_v1(p_token_sha256 TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g platform_private.ai_agent_file_grants;
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE platform_private.ai_agent_file_grants x SET used_count = x.used_count + 1
  WHERE x.token_sha256 = p_token_sha256 AND x.expires_at > clock_timestamp() AND x.used_count < x.max_uses
  RETURNING * INTO g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('bucket', g.storage_bucket, 'path', g.storage_path, 'mimeType', g.mime_type,
    'byteSize', g.byte_size, 'fileName', g.file_name);
END
$$;

-- Общие помощники инструментов -----------------------------------------------

-- Дата YYYY-MM-DD или NULL; невозможная дата - invalid_arguments.
CREATE FUNCTION platform_private.ai_agent_arg_date(p_args JSONB, p_key TEXT)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF NOT p_args ? p_key THEN
    RETURN NULL;
  END IF;
  RETURN (p_args ->> p_key)::DATE;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
END
$$;

-- Сумма из минорных единиц в строку с точкой: 12345 -> "123.45".
CREATE FUNCTION platform_private.ai_agent_money(p_minor NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT to_char(COALESCE(p_minor, 0) / 100, 'FM999999999999990.00')
$$;

-- Страница keyset: строки {t, id, item} (до limit+1) -> {items, next_cursor}.
CREATE FUNCTION platform_private.ai_agent_page_result(p_rows JSONB, p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE n INTEGER := COALESCE(jsonb_array_length(p_rows), 0); v_items JSONB; v_next TEXT;
BEGIN
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= p_limit;
  IF n > p_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((p_rows -> (p_limit - 1) ->> 't')::TIMESTAMPTZ,
      (p_rows -> (p_limit - 1) ->> 'id')::UUID);
  END IF;
  RETURN jsonb_build_object('items', v_items, 'next_cursor', v_next);
END
$$;

-- Чат без ответа: последнее сообщение входящее.
CREATE FUNCTION platform_private.ai_agent_conv_last(p_organization_id UUID, p_conversation_id UUID)
RETURNS TABLE (at TIMESTAMPTZ, direction TEXT, body TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.created_at, m.direction::TEXT, m.body_text
  FROM platform.communication_messages m
  WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1
$$;

-- A.5.3 Инструменты чтения ----------------------------------------------------

CREATE FUNCTION platform.ai_agent_tool_search_clients_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_q TEXT; v_like TEXT; v_digits TEXT; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'search_clients', p_args);
  v_q := lower(btrim(p_args ->> 'query'));
  IF char_length(v_q) < 2 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', c.created_at, 'id', c.id, 'item', jsonb_build_object(
      'client_id', c.id, 'name', c.display_name,
      'phone_masked', platform_private.ai_agent_mask_phone(c.phone), 'email_masked', platform_private.ai_agent_mask_email(c.email),
      'lifecycle', c.lifecycle_state::TEXT,
      'lead_ids', COALESCE((SELECT jsonb_agg(l.id) FROM (SELECT x.id FROM platform.leads x
        WHERE x.organization_id = c.organization_id AND x.client_id = c.id ORDER BY x.created_at DESC LIMIT 10) l), '[]'::JSONB),
      'case_ids', COALESCE((SELECT jsonb_agg(s.id) FROM (SELECT x.id FROM platform.student_cases x
        WHERE x.organization_id = c.organization_id AND x.canonical_client_id = c.id ORDER BY x.created_at DESC LIMIT 10) s), '[]'::JSONB),
      'created_at', c.created_at)) ORDER BY c.created_at DESC, c.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.clients x
    WHERE x.organization_id = p_organization_id AND x.lifecycle_state <> 'merged'
      AND (lower(x.display_name) LIKE v_like OR lower(COALESCE(x.email, '')) LIKE v_like
        OR (char_length(v_digits) >= 4 AND regexp_replace(COALESCE(x.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_digits || '%'))
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) c;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_client_card_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_client UUID; v_c platform.clients; v_lead UUID;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_client_card', p_args);
  IF (p_args ? 'client_id')::INTEGER + (p_args ? 'lead_id')::INTEGER + (p_args ? 'case_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'client_id' THEN
    v_client := (p_args ->> 'client_id')::UUID;
  ELSIF p_args ? 'lead_id' THEN
    SELECT l.client_id INTO v_client FROM platform.leads l
    WHERE l.organization_id = p_organization_id AND l.id = (p_args ->> 'lead_id')::UUID;
  ELSE
    SELECT COALESCE(s.canonical_client_id, (SELECT l.client_id FROM platform.leads l
      WHERE l.organization_id = s.organization_id AND l.id = s.canonical_lead_id)) INTO v_client
    FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
  END IF;
  SELECT * INTO v_c FROM platform.clients c WHERE c.organization_id = p_organization_id AND c.id = v_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', v_c.id, 'name', v_c.display_name,
      'phone_masked', platform_private.ai_agent_mask_phone(v_c.phone), 'email_masked', platform_private.ai_agent_mask_email(v_c.email)),
    'leads', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'stage', l.stage_key, 'source', l.source_key,
        'state', CASE l.lifecycle_state::TEXT WHEN 'converted' THEN 'won' WHEN 'disqualified' THEN 'lost' ELSE l.lifecycle_state::TEXT END,
        'owner_name', platform_private.ai_agent_member_name(l.organization_id, l.current_owner_membership_id),
        'created_at', l.created_at) ORDER BY l.created_at DESC)
      FROM (SELECT x.* FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.client_id = v_c.id
        ORDER BY x.created_at DESC LIMIT 20) l), '[]'::JSONB),
    'cases', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'country', s.target_country, 'degree', s.target_degree,
        'direction', s.admissions_direction, 'operational_stage', s.operational_stage,
        'curator_name', platform_private.ai_agent_member_name(s.organization_id, s.current_curator_membership_id),
        'state', s.state::TEXT) ORDER BY s.created_at DESC)
      FROM (SELECT x.* FROM platform.student_cases x WHERE x.organization_id = p_organization_id
        AND (x.canonical_client_id = v_c.id OR x.canonical_lead_id IN (SELECT l.id FROM platform.leads l
          WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id))
        ORDER BY x.created_at DESC LIMIT 20) s), '[]'::JSONB),
    'conversations', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status::TEXT, 'queue', v.queue::TEXT,
        'last_message_at', v.last_at, 'unanswered', v.unanswered) ORDER BY v.last_at DESC NULLS LAST)
      FROM (SELECT cv.id, cv.status, cv.queue, lm.at AS last_at, COALESCE(lm.direction = 'inbound', FALSE) AS unanswered
        FROM platform.communication_conversations cv
        LEFT JOIN LATERAL platform_private.ai_agent_conv_last(cv.organization_id, cv.id) lm ON TRUE
        WHERE cv.organization_id = p_organization_id AND cv.canonical_client_id = v_c.id
        ORDER BY lm.at DESC NULLS LAST LIMIT 10) v), '[]'::JSONB),
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = p_organization_id
        AND (x.lead_id IN (SELECT l.id FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id)
          OR x.student_case_id IN (SELECT s.id FROM platform.student_cases s WHERE s.organization_id = p_organization_id
            AND (s.canonical_client_id = v_c.id OR s.canonical_lead_id IN (SELECT l.id FROM platform.leads l
              WHERE l.organization_id = p_organization_id AND l.client_id = v_c.id))))
        ORDER BY x.created_at DESC LIMIT 10) n), '[]'::JSONB));
END
$$;

CREATE FUNCTION platform.ai_agent_tool_list_leads_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB;
  v_state TEXT := COALESCE(p_args ->> 'state', 'open'); v_from DATE; v_to DATE;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_leads', p_args);
  v_from := platform_private.ai_agent_arg_date(p_args, 'created_from');
  v_to := platform_private.ai_agent_arg_date(p_args, 'created_to');
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', l.created_at, 'id', l.id, 'item', jsonb_build_object(
      'lead_id', l.id, 'client_id', l.client_id,
      'name', (SELECT c.display_name FROM platform.clients c WHERE c.organization_id = l.organization_id AND c.id = l.client_id),
      'stage', l.stage_key, 'source', l.source_key,
      'state', CASE l.lifecycle_state::TEXT WHEN 'converted' THEN 'won' WHEN 'disqualified' THEN 'lost' ELSE l.lifecycle_state::TEXT END,
      'owner_name', platform_private.ai_agent_member_name(l.organization_id, l.current_owner_membership_id),
      'direction', l.interest_direction, 'created_at', l.created_at, 'last_activity_at', l.updated_at,
      'has_unanswered_chat', EXISTS (SELECT 1 FROM platform.communication_conversations cv
        CROSS JOIN LATERAL platform_private.ai_agent_conv_last(cv.organization_id, cv.id) lm
        WHERE cv.organization_id = l.organization_id AND cv.canonical_lead_id = l.id AND cv.status = 'open'
          AND lm.direction = 'inbound'))) ORDER BY l.created_at DESC, l.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.leads x
    WHERE x.organization_id = p_organization_id
      AND (v_state = 'all' OR x.lifecycle_state::TEXT = CASE v_state WHEN 'open' THEN 'open' WHEN 'won' THEN 'converted' ELSE 'disqualified' END)
      AND (NOT p_args ? 'stage' OR x.stage_key = p_args ->> 'stage')
      AND (NOT p_args ? 'source' OR x.source_key = p_args ->> 'source')
      AND (NOT p_args ? 'owner_id' OR x.current_owner_membership_id = (p_args ->> 'owner_id')::UUID)
      AND (NOT p_args ? 'direction' OR x.interest_direction = p_args ->> 'direction')
      AND (v_from IS NULL OR (x.created_at AT TIME ZONE 'Asia/Bishkek')::DATE >= v_from)
      AND (v_to IS NULL OR (x.created_at AT TIME ZONE 'Asia/Bishkek')::DATE <= v_to)
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) l;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_lead_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; l platform.leads; c platform.clients; v_conditions JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_lead', p_args);
  SELECT * INTO l FROM platform.leads x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'lead_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM platform.clients x WHERE x.organization_id = p_organization_id AND x.id = l.client_id;
  SELECT s.fields INTO v_conditions FROM platform_private.lead_sale_conditions s
  WHERE s.organization_id = p_organization_id AND s.lead_id = l.id;
  RETURN jsonb_build_object(
    'lead', jsonb_build_object('id', l.id, 'client_id', l.client_id, 'stage', l.stage_key, 'source', l.source_key,
      'state', CASE l.lifecycle_state::TEXT WHEN 'converted' THEN 'won' WHEN 'disqualified' THEN 'lost' ELSE l.lifecycle_state::TEXT END,
      'owner_name', platform_private.ai_agent_member_name(l.organization_id, l.current_owner_membership_id),
      'direction', l.interest_direction, 'next_action', l.next_action_text, 'next_action_due', l.next_action_due_date,
      'created_at', l.created_at, 'updated_at', l.updated_at),
    'client', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'name', c.display_name,
      'phone_masked', platform_private.ai_agent_mask_phone(c.phone), 'email_masked', platform_private.ai_agent_mask_email(c.email)) END,
    'stage_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', h.desired_stage_key, 'at', h.created_at) ORDER BY h.created_at)
      FROM (SELECT r.desired_stage_key, r.created_at FROM platform_private.sales_lead_workflow_receipts r
        WHERE r.organization_id = p_organization_id AND r.lead_id = l.id ORDER BY r.created_at DESC LIMIT 30) h), '[]'::JSONB),
    'sale_conditions', v_conditions,
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = p_organization_id AND x.lead_id = l.id
        ORDER BY x.created_at DESC LIMIT 10) n), '[]'::JSONB),
    'open_tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id', t.id, 'title', left(t.title, 200),
        'assignee_name', platform_private.ai_agent_member_name(t.organization_id, t.assignee_membership_id),
        'status', t.status::TEXT, 'priority', t.priority::TEXT, 'due_on', COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE))
        ORDER BY t.created_at DESC)
      FROM (SELECT x.* FROM platform.staff_tasks x
        WHERE x.organization_id = p_organization_id AND x.status IN ('open', 'in_progress', 'blocked')
          AND x.id IN (SELECT k.staff_task_id FROM platform_private.staff_lead_task_links k
            WHERE k.organization_id = p_organization_id AND k.lead_id = l.id)
        ORDER BY x.created_at DESC LIMIT 20) t), '[]'::JSONB),
    'conversation_ids', COALESCE((SELECT jsonb_agg(cv.id ORDER BY cv.created_at DESC) FROM platform.communication_conversations cv
      WHERE cv.organization_id = p_organization_id AND cv.canonical_lead_id = l.id), '[]'::JSONB),
    'calls_count', (SELECT count(*) FROM platform_private.telephony_calls tc
      WHERE tc.organization_id = p_organization_id AND tc.lead_id = l.id));
END
$$;

CREATE FUNCTION platform.ai_agent_tool_list_student_cases_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB;
  v_state TEXT := COALESCE(p_args ->> 'state', 'active');
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_student_cases', p_args);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', s.updated_at, 'id', s.id, 'item', jsonb_build_object(
      'case_id', s.id, 'student_name', s.student_display_name, 'country', s.target_country, 'degree', s.target_degree,
      'direction', s.admissions_direction, 'operational_stage', s.operational_stage, 'pipeline_stage', s.pipeline_stage,
      'curator_name', platform_private.ai_agent_member_name(s.organization_id, s.current_curator_membership_id),
      'next_action', s.next_action, 'state', s.state::TEXT,
      'docs', (SELECT jsonb_build_object('required', count(*), 'approved', count(*) FILTER (WHERE d.status = 'approved'),
          'submitted', count(*) FILTER (WHERE d.status = 'submitted'), 'missing', count(*) FILTER (WHERE d.status = 'required'),
          'correction', count(*) FILTER (WHERE d.status IN ('correction_required', 'rejected')))
        FROM platform.document_slots d WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL),
      'nearest_deadline', (SELECT min(d.deadline) FROM platform.document_slots d
        WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL
          AND d.status <> 'approved' AND d.deadline IS NOT NULL),
      'updated_at', s.updated_at)) ORDER BY s.updated_at DESC, s.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.student_cases x
    WHERE x.organization_id = p_organization_id
      AND (v_state = 'all' OR x.state::TEXT = v_state)
      AND (NOT p_args ? 'direction' OR x.admissions_direction = p_args ->> 'direction')
      AND (NOT p_args ? 'country' OR lower(COALESCE(x.target_country, '')) = lower(p_args ->> 'country'))
      AND (NOT p_args ? 'stage' OR x.operational_stage = p_args ->> 'stage' OR x.pipeline_stage = p_args ->> 'stage')
      AND (NOT p_args ? 'curator_id' OR x.current_curator_membership_id = (p_args ->> 'curator_id')::UUID)
      AND (v_ct IS NULL OR (x.updated_at, x.id) < (v_ct, v_cid))
    ORDER BY x.updated_at DESC, x.id DESC LIMIT v_limit + 1) s;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_case_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_inc TEXT[]; v_out JSONB; v_money JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_inc := CASE WHEN p_args ? 'include' THEN ARRAY(SELECT jsonb_array_elements_text(p_args -> 'include'))
    ELSE ARRAY['documents', 'applications', 'payments', 'tasks'] END;
  v_out := jsonb_build_object('case', jsonb_build_object('id', s.id, 'student_name', s.student_display_name,
      'country', s.target_country, 'degree', s.target_degree, 'direction', s.admissions_direction,
      'program_direction', s.program_direction, 'intake', s.intake, 'operational_stage', s.operational_stage,
      'pipeline_stage', s.pipeline_stage, 'state', s.state::TEXT, 'next_action', s.next_action,
      'next_action_due_on', s.next_action_due_on,
      'curator_name', platform_private.ai_agent_member_name(s.organization_id, s.current_curator_membership_id),
      'sales_name', platform_private.ai_agent_member_name(s.organization_id, s.responsible_sales_membership_id),
      'handoff_at', s.handoff_at, 'created_at', s.created_at, 'updated_at', s.updated_at));
  IF 'documents' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'slot_id', d.id, 'requirement', COALESCE(d.display_label, r.label), 'status', d.status::TEXT, 'deadline', d.deadline,
        'latest_version_id', d.current_version_id, 'reviewed_at', rv.created_at, 'review_note', left(rv.reason, 300),
        'mime_type', v.declared_mime_type, 'byte_size', v.byte_size, 'uploaded_at', v.created_at)
        ORDER BY d.created_at, d.id)
      FROM platform.document_slots d
      LEFT JOIN platform.document_requirements r ON r.organization_id = d.organization_id AND r.id = d.requirement_id
      LEFT JOIN platform.document_versions v ON v.organization_id = d.organization_id AND v.id = d.current_version_id
      LEFT JOIN LATERAL (SELECT y.created_at, y.reason FROM platform.document_reviews y
        WHERE y.organization_id = d.organization_id AND y.document_version_id = d.current_version_id
        ORDER BY y.created_at DESC, y.id DESC LIMIT 1) rv ON TRUE
      WHERE d.organization_id = s.organization_id AND d.student_case_id = s.id AND d.removed_at IS NULL), '[]'::JSONB));
  END IF;
  IF 'applications' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('applications', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'institution', u.institution_name, 'program', u.program_name, 'status', u.status::TEXT,
        'is_primary', u.is_primary, 'deadline', u.university_deadline_on, 'country', u.country, 'degree', u.degree)
        ORDER BY u.created_at)
      FROM platform.university_applications u
      WHERE u.organization_id = s.organization_id AND u.student_case_id = s.id), '[]'::JSONB));
  END IF;
  IF 'payments' = ANY (v_inc) THEN
    SELECT jsonb_build_object(
      'obligations', COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'label', left(o.label, 200), 'category', o.category::TEXT,
        'amount', platform_private.ai_agent_money(o.amount_minor), 'currency', o.currency,
        'due_on', (o.due_at AT TIME ZONE 'Asia/Bishkek')::DATE,
        'paid', platform_private.ai_agent_money(o.total_paid_minor - o.total_refunded_minor),
        'status', CASE WHEN o.total_paid_minor - o.total_refunded_minor >= o.amount_minor THEN 'paid'
          WHEN o.due_at IS NOT NULL AND o.due_at < clock_timestamp() THEN 'overdue'
          WHEN o.total_paid_minor - o.total_refunded_minor > 0 THEN 'partial' ELSE 'open' END) ORDER BY o.created_at), '[]'::JSONB),
      'overdue_count', count(*) FILTER (WHERE o.due_at IS NOT NULL AND o.due_at < clock_timestamp()
        AND o.total_paid_minor - o.total_refunded_minor < o.amount_minor))
    INTO v_money
    FROM platform.payment_obligations o
    WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id AND o.archived_at IS NULL;
    v_out := v_out || jsonb_build_object('payments', v_money || jsonb_build_object(
      'total_due', COALESCE((SELECT jsonb_object_agg(t.currency, platform_private.ai_agent_money(t.v)) FROM (
        SELECT o.currency, sum(greatest(o.amount_minor - (o.total_paid_minor - o.total_refunded_minor), 0)) AS v
        FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id
          AND o.archived_at IS NULL GROUP BY o.currency) t), '{}'::JSONB),
      'total_paid', COALESCE((SELECT jsonb_object_agg(t.currency, platform_private.ai_agent_money(t.v)) FROM (
        SELECT o.currency, sum(o.total_paid_minor - o.total_refunded_minor) AS v
        FROM platform.payment_obligations o WHERE o.organization_id = s.organization_id AND o.student_case_id = s.id
          AND o.archived_at IS NULL GROUP BY o.currency) t), '{}'::JSONB)));
  END IF;
  IF 'tasks' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', left(t.title, 200), 'status', t.status::TEXT, 'priority', t.priority::TEXT,
        'due_on', COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE),
        'assignee_name', platform_private.ai_agent_member_name(t.organization_id, t.assignee_membership_id))
        ORDER BY t.created_at DESC)
      FROM (SELECT x.* FROM platform.case_tasks x WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
        AND x.status IN ('open', 'in_progress', 'blocked') ORDER BY x.created_at DESC LIMIT 30) t), '[]'::JSONB));
  END IF;
  IF 'notes' = ANY (v_inc) THEN
    v_out := v_out || jsonb_build_object('notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', n.created_at,
        'author', platform_private.ai_agent_member_name(n.organization_id, n.created_by_membership_id),
        'body', left(n.body, 500)) ORDER BY n.created_at DESC)
      FROM (SELECT x.* FROM platform.case_notes x WHERE x.organization_id = s.organization_id AND x.student_case_id = s.id
        ORDER BY x.created_at DESC LIMIT 20) n), '[]'::JSONB));
  END IF;
  IF 'profile' = ANY (v_inc) THEN
    -- Только безопасные поля профиля: без даты рождения, паспортных и родительских данных.
    v_out := v_out || jsonb_build_object('profile', (SELECT jsonb_build_object(
        'preferred_name', p.preferred_display_name, 'communication_language', p.communication_language,
        'citizenship_country', p.citizenship_country, 'residency_country', p.residency_country,
        'education', left(p.current_education_summary, 500), 'academic', left(p.academic_summary, 500),
        'language', left(p.language_summary, 500), 'budget_band', p.budget_band, 'next_step', left(p.next_step, 300))
      FROM platform.student_profiles p WHERE p.organization_id = s.organization_id AND p.student_case_id = s.id));
  END IF;
  RETURN v_out;
END
$$;

-- Ссылка на файл документа: токен (32 случайных байта, base64url, 43 символа) отдаётся один раз, в БД
-- хранится только SHA-256; срок 10 минут, не более 3 использований.
CREATE FUNCTION platform.ai_agent_tool_get_document_file_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_version UUID; v platform.document_versions; b platform_private.document_storage_bindings;
  v_token TEXT; v_ttl INTEGER := 600; v_max_bytes CONSTANT BIGINT := 26214400;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_document_file', p_args);
  IF (p_args ? 'document_version_id')::INTEGER + (p_args ? 'slot_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'document_version_id' THEN
    v_version := (p_args ->> 'document_version_id')::UUID;
  ELSE
    SELECT s.current_version_id INTO v_version FROM platform.document_slots s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'slot_id')::UUID AND s.removed_at IS NULL;
  END IF;
  SELECT * INTO v FROM platform.document_versions x WHERE x.organization_id = p_organization_id AND x.id = v_version;
  IF NOT FOUND OR v.malware_status::TEXT <> 'clean' THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO b FROM platform_private.document_storage_bindings x
  WHERE x.organization_id = p_organization_id AND x.document_version_id = v.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v.byte_size > v_max_bytes THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  v_token := translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), E'+/=\n', '-_');
  v_token := left(v_token, 43);
  INSERT INTO platform_private.ai_agent_file_grants (organization_id, agent_key, token_sha256, document_version_id,
    storage_bucket, storage_path, mime_type, byte_size, file_name, expires_at, max_uses)
  VALUES (p_organization_id, p_agent_key, platform_private.ai_agent_sha256(v_token), v.id, b.bucket_id, b.object_name,
    v.declared_mime_type, v.byte_size, left(v.original_filename, 200), clock_timestamp() + make_interval(secs => v_ttl), 3);
  RETURN jsonb_build_object('token', v_token, 'file_name', left(v.original_filename, 200), 'mime_type', v.declared_mime_type,
    'byte_size', v.byte_size, 'expires_in_seconds', v_ttl);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_list_conversations_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB;
  v_filter TEXT := COALESCE(p_args ->> 'filter', 'unanswered'); v_queue TEXT := COALESCE(p_args ->> 'queue', 'sales');
  v_queue_enum TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_conversations', p_args);
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  v_queue_enum := CASE v_queue WHEN 'sales' THEN 'sales' WHEN 'admissions' THEN 'curator' ELSE NULL END;
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', q.last_at, 'id', q.id, 'item', jsonb_build_object(
      'conversation_id', q.id, 'lead_id', q.canonical_lead_id, 'case_id', q.student_case_id,
      'contact_name', COALESCE((SELECT c.display_name FROM platform.clients c
        WHERE c.organization_id = q.organization_id AND c.id = q.canonical_client_id), left(q.subject, 120)),
      'status', q.status::TEXT, 'queue', CASE q.queue::TEXT WHEN 'curator' THEN 'admissions' ELSE q.queue::TEXT END,
      'last_message_at', q.last_at, 'last_direction', q.last_dir, 'last_text_preview', left(q.last_body, 200),
      'unanswered_minutes', CASE WHEN q.last_dir = 'inbound' THEN floor(extract(epoch FROM clock_timestamp() - q.last_at) / 60)::INTEGER END,
      'staff_last_replied_at', (SELECT max(m.created_at) FROM platform.communication_messages m
        WHERE m.organization_id = q.organization_id AND m.conversation_id = q.id AND m.direction = 'outbound'))
    ) ORDER BY q.last_at DESC, q.id DESC)
  INTO v_rows
  FROM (SELECT cv.*, lm.at AS last_at, lm.direction AS last_dir, lm.body AS last_body
    FROM platform.communication_conversations cv
    CROSS JOIN LATERAL platform_private.ai_agent_conv_last(cv.organization_id, cv.id) lm
    WHERE cv.organization_id = p_organization_id
      AND (v_queue_enum IS NULL OR cv.queue::TEXT = v_queue_enum)
      AND (v_filter = 'all'
        OR (v_filter = 'unanswered' AND cv.status = 'open' AND lm.direction = 'inbound')
        OR (v_filter = 'recent' AND lm.at >= clock_timestamp() - INTERVAL '7 days'))
      AND (v_ct IS NULL OR (lm.at, cv.id) < (v_ct, v_cid))
    ORDER BY lm.at DESC, cv.id DESC LIMIT v_limit + 1) q;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

-- Источник сообщения: client | crm | ai_agent | phone | history | other.
CREATE FUNCTION platform_private.ai_agent_message_origin(m platform.communication_messages)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN m.direction = 'inbound' THEN 'client'
    WHEN m.message_identity_source = 'private_waha_history_binding' THEN 'history'
    WHEN m.manual_send_authorization_id IS NULL THEN 'phone'
    ELSE COALESCE((SELECT CASE a.kind WHEN 'ai_agent' THEN 'ai_agent' WHEN 'manual' THEN 'crm' ELSE 'other' END
      FROM platform.manual_send_authorizations a
      WHERE a.organization_id = m.organization_id AND a.id = m.manual_send_authorization_id), 'other') END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_conversation_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; cv platform.communication_conversations; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_state TEXT; v_latest UUID; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_conversation', p_args);
  SELECT * INTO cv FROM platform.communication_conversations x
  WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'conversation_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at, 'direction', m.direction::TEXT, 'origin', platform_private.ai_agent_message_origin(m),
      'text', left(COALESCE(platform_private.ai_message_view(m) ->> 'text', ''), 2000),
      'media_kind', (platform_private.ai_message_view(m) -> 'media' -> 0 ->> 'kind'))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.communication_messages x
    WHERE x.organization_id = p_organization_id AND x.conversation_id = cv.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  -- Новейшие - внизу.
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, cv.waha_session_name);
  v_latest := platform_private.ai_latest_inbound(p_organization_id, cv.id);
  RETURN jsonb_build_object(
    'conversation', jsonb_build_object('id', cv.id, 'status', cv.status::TEXT,
      'queue', CASE cv.queue::TEXT WHEN 'curator' THEN 'admissions' ELSE cv.queue::TEXT END,
      'lead_id', cv.canonical_lead_id, 'case_id', cv.student_case_id,
      'contact_name', COALESCE((SELECT c.display_name FROM platform.clients c
        WHERE c.organization_id = cv.organization_id AND c.id = cv.canonical_client_id), left(cv.subject, 120)),
      'whatsapp_state', v_state),
    'messages', v_items,
    'can_reply', cv.status = 'open' AND v_latest IS NOT NULL AND v_state <> 'disconnected',
    'latest_inbound_message_id', v_latest,
    'next_cursor', v_next);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_case_chat_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; s platform.student_cases; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID;
  v_rows JSONB; v_items JSONB; v_next TEXT; v_n INTEGER;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_case_chat', p_args);
  SELECT * INTO s FROM platform.student_cases x WHERE x.organization_id = p_organization_id AND x.id = (p_args ->> 'case_id')::UUID;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 30);
  IF p_args ? 'before' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'before') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', m.created_at, 'id', m.id, 'item', jsonb_build_object(
      'id', m.id, 'at', m.created_at,
      'author', CASE WHEN m.author_membership_id IS NOT DISTINCT FROM s.student_membership_id THEN 'student'
        WHEN EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d WHERE d.organization_id = m.organization_id
          AND d.student_case_id = m.student_case_id AND d.provider ->> 'messageId' = m.id::TEXT) THEN 'ai_agent'
        ELSE 'staff' END,
      'author_name', platform_private.ai_agent_member_name(m.organization_id, m.author_membership_id),
      'text', left(m.body, 2000))) ORDER BY m.created_at DESC, m.id DESC)
  INTO v_rows
  FROM (SELECT x.* FROM platform.case_chat_messages x
    WHERE x.organization_id = p_organization_id AND x.student_case_id = s.id
      AND (v_ct IS NULL OR (x.created_at, x.id) < (v_ct, v_cid))
    ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1) m;
  v_n := COALESCE(jsonb_array_length(v_rows), 0);
  IF v_n > v_limit THEN
    v_next := platform_private.ai_agent_cursor_encode((v_rows -> (v_limit - 1) ->> 't')::TIMESTAMPTZ,
      (v_rows -> (v_limit - 1) ->> 'id')::UUID);
  END IF;
  SELECT COALESCE(jsonb_agg(e.value -> 'item' ORDER BY e.ord DESC), '[]'::JSONB) INTO v_items
  FROM jsonb_array_elements(COALESCE(v_rows, '[]'::JSONB)) WITH ORDINALITY e(value, ord) WHERE e.ord <= v_limit;
  RETURN jsonb_build_object('messages', v_items, 'next_cursor', v_next);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_sales_report_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_from DATE; v_to DATE; v_group TEXT := COALESCE(p_args ->> 'group_by', 'month'); v_rows JSONB; v_totals JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'sales_report', p_args);
  BEGIN
    v_from := (p_args ->> 'from_month' || '-01')::DATE;
    v_to := (COALESCE(p_args ->> 'to_month', p_args ->> 'from_month') || '-01')::DATE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END;
  IF v_to < v_from OR v_to > v_from + INTERVAL '36 months' THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  WITH base AS (
    SELECT CASE v_group WHEN 'month' THEN to_char(r.report_month, 'YYYY-MM')
        WHEN 'country' THEN COALESCE(NULLIF(btrim(r.fields ->> 'country'), ''), '—')
        WHEN 'manager' THEN COALESCE(NULLIF(btrim(r.fields ->> 'manager_label'), ''), '—')
        ELSE COALESCE(NULLIF(btrim(r.fields ->> 'direction'), ''), '—') END AS grp,
      r.withdrawn_at IS NOT NULL AS withdrawn,
      NULLIF(r.fields ->> 'service_cost_minor', '')::BIGINT AS cost_minor, r.fields ->> 'service_cost_currency' AS cost_cur,
      NULLIF(r.fields ->> 'paid_minor', '')::BIGINT AS paid_minor, r.fields ->> 'paid_currency' AS paid_cur
    FROM platform_private.sales_register r
    WHERE r.organization_id = p_organization_id AND NOT r.archived AND r.report_month BETWEEN v_from AND v_to),
  per_group AS (
    SELECT b.grp, count(*) FILTER (WHERE NOT b.withdrawn) AS contracts, count(*) FILTER (WHERE b.withdrawn) AS withdrawn
    FROM base b GROUP BY b.grp),
  cost AS (
    SELECT b.grp, jsonb_object_agg(b.cost_cur, platform_private.ai_agent_money(b.s)) AS j
    FROM (SELECT grp, cost_cur, sum(cost_minor) AS s FROM base WHERE NOT withdrawn AND cost_cur IS NOT NULL GROUP BY grp, cost_cur) b
    GROUP BY b.grp),
  paid AS (
    SELECT b.grp, jsonb_object_agg(b.paid_cur, platform_private.ai_agent_money(b.s)) AS j
    FROM (SELECT grp, paid_cur, sum(paid_minor) AS s FROM base WHERE NOT withdrawn AND paid_cur IS NOT NULL GROUP BY grp, paid_cur) b
    GROUP BY b.grp)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', g.grp, 'label', g.grp, 'contracts', g.contracts, 'withdrawn', g.withdrawn,
      'amount_total_by_currency', COALESCE(c.j, '{}'::JSONB), 'paid_by_currency', COALESCE(p.j, '{}'::JSONB)) ORDER BY g.grp), '[]'::JSONB)
  INTO v_rows
  FROM per_group g LEFT JOIN cost c ON c.grp = g.grp LEFT JOIN paid p ON p.grp = g.grp;
  SELECT jsonb_build_object(
    'contracts', COALESCE((SELECT sum((e ->> 'contracts')::BIGINT) FROM jsonb_array_elements(v_rows) e), 0),
    'withdrawn', COALESCE((SELECT sum((e ->> 'withdrawn')::BIGINT) FROM jsonb_array_elements(v_rows) e), 0),
    'amount_total_by_currency', COALESCE((SELECT jsonb_object_agg(t.cur, platform_private.ai_agent_money(t.s)) FROM (
        SELECT k.key AS cur, sum((replace(k.value #>> '{}', '.', ''))::BIGINT) AS s
        FROM jsonb_array_elements(v_rows) e, jsonb_each(e -> 'amount_total_by_currency') k GROUP BY k.key) t), '{}'::JSONB),
    'paid_by_currency', COALESCE((SELECT jsonb_object_agg(t.cur, platform_private.ai_agent_money(t.s)) FROM (
        SELECT k.key AS cur, sum((replace(k.value #>> '{}', '.', ''))::BIGINT) AS s
        FROM jsonb_array_elements(v_rows) e, jsonb_each(e -> 'paid_by_currency') k GROUP BY k.key) t), '{}'::JSONB))
  INTO v_totals;
  RETURN jsonb_build_object('rows', v_rows, 'totals', v_totals,
    'source_note', 'Отчёт продаж EVO CRM (строки отчёта без архива); отозванные продажи считаются отдельно');
END
$$;

CREATE FUNCTION platform.ai_agent_tool_payments_summary_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_from DATE; v_to DATE; v_case UUID; v_status TEXT := p_args ->> 'status'; v_by_status JSONB;
  v_overdue JSONB; v_received JSONB; v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'payments_summary', p_args);
  v_from := COALESCE(platform_private.ai_agent_arg_date(p_args, 'from'), (v_now AT TIME ZONE 'Asia/Bishkek')::DATE - 30);
  v_to := COALESCE(platform_private.ai_agent_arg_date(p_args, 'to'), (v_now AT TIME ZONE 'Asia/Bishkek')::DATE);
  IF v_to < v_from THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_case := (p_args ->> 'case_id')::UUID;
  WITH o AS (
    SELECT x.*, CASE WHEN x.total_paid_minor - x.total_refunded_minor >= x.amount_minor THEN 'paid'
        WHEN x.due_at IS NOT NULL AND x.due_at < v_now THEN 'overdue'
        WHEN x.total_paid_minor - x.total_refunded_minor > 0 THEN 'partial' ELSE 'open' END AS st
    FROM platform.payment_obligations x
    WHERE x.organization_id = p_organization_id AND x.archived_at IS NULL AND (v_case IS NULL OR x.student_case_id = v_case)),
  f AS (SELECT * FROM o WHERE v_status IS NULL OR st = v_status),
  per_cur AS (SELECT st, currency, count(*) AS n, sum(amount_minor) AS amt FROM f GROUP BY st, currency),
  per_st AS (SELECT st, sum(n) AS n, jsonb_object_agg(currency, platform_private.ai_agent_money(amt)) AS m FROM per_cur GROUP BY st)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('status', st, 'count', n, 'amount_by_currency', m) ORDER BY st), '[]'::JSONB)
  INTO v_by_status FROM per_st;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('case_id', t.student_case_id, 'student_name', t.name,
      'amount', platform_private.ai_agent_money(t.left_minor), 'currency', t.currency,
      'due_on', (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE,
      'days_overdue', floor(extract(epoch FROM v_now - t.due_at) / 86400)::INTEGER) ORDER BY t.due_at), '[]'::JSONB)
  INTO v_overdue
  FROM (SELECT x.student_case_id, x.currency, x.due_at,
      x.amount_minor - (x.total_paid_minor - x.total_refunded_minor) AS left_minor,
      (SELECT s.student_display_name FROM platform.student_cases s WHERE s.organization_id = x.organization_id AND s.id = x.student_case_id) AS name
    FROM platform.payment_obligations x
    WHERE x.organization_id = p_organization_id AND x.archived_at IS NULL AND (v_case IS NULL OR x.student_case_id = v_case)
      AND x.due_at IS NOT NULL AND x.due_at < v_now AND x.total_paid_minor - x.total_refunded_minor < x.amount_minor
    ORDER BY x.due_at LIMIT 50) t;
  SELECT COALESCE(jsonb_object_agg(r.currency, platform_private.ai_agent_money(r.net)), '{}'::JSONB) INTO v_received
  FROM (SELECT e.currency, sum(CASE e.event_type::TEXT WHEN 'payment' THEN e.amount_minor ELSE -e.amount_minor END) AS net
    FROM platform.payment_events e
    WHERE e.organization_id = p_organization_id AND (v_case IS NULL OR e.student_case_id = v_case)
      AND (e.occurred_at AT TIME ZONE 'Asia/Bishkek')::DATE BETWEEN v_from AND v_to
    GROUP BY e.currency) r;
  RETURN jsonb_build_object('obligations_by_status', v_by_status, 'overdue', v_overdue,
    'received_in_period', jsonb_build_object('from', v_from, 'to', v_to, 'net_by_currency', v_received));
END
$$;

CREATE FUNCTION platform.ai_agent_tool_funnel_stats_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_from DATE; v_to DATE; v_created BIGINT; v_cases BIGINT; v_by_stage JSONB; v_by_source JSONB; v_stale BIGINT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'funnel_stats', p_args);
  v_from := platform_private.ai_agent_arg_date(p_args, 'from');
  v_to := platform_private.ai_agent_arg_date(p_args, 'to');
  IF v_to < v_from OR v_to > v_from + 800 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  WITH f AS (
    SELECT l.* FROM platform.leads l
    WHERE l.organization_id = p_organization_id
      AND (l.created_at AT TIME ZONE 'Asia/Bishkek')::DATE BETWEEN v_from AND v_to
      AND (NOT p_args ? 'source' OR l.source_key = p_args ->> 'source')
      AND (NOT p_args ? 'direction' OR l.interest_direction = p_args ->> 'direction'))
  SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM platform.student_cases s
      WHERE s.organization_id = f.organization_id AND s.canonical_lead_id = f.id)),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', x.k, 'count', x.n) ORDER BY x.n DESC, x.k)
      FROM (SELECT stage_key AS k, count(*) AS n FROM f GROUP BY stage_key) x), '[]'::JSONB),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('source', x.k, 'count', x.n) ORDER BY x.n DESC, x.k)
      FROM (SELECT source_key AS k, count(*) AS n FROM f GROUP BY source_key) x), '[]'::JSONB)
  INTO v_created, v_cases, v_by_stage, v_by_source FROM f;
  SELECT count(*) INTO v_stale FROM platform.leads l
  WHERE l.organization_id = p_organization_id AND l.lifecycle_state = 'open'
    AND l.updated_at < clock_timestamp() - INTERVAL '7 days'
    AND (NOT p_args ? 'source' OR l.source_key = p_args ->> 'source')
    AND (NOT p_args ? 'direction' OR l.interest_direction = p_args ->> 'direction');
  RETURN jsonb_build_object('created_leads', v_created, 'by_stage', v_by_stage, 'by_source', v_by_source,
    'conversion', jsonb_build_object('lead_to_case', CASE WHEN v_created > 0 THEN round(v_cases::NUMERIC / v_created, 4) END,
      'leads_with_case', v_cases),
    'stale_leads_older_than_7d', v_stale);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_list_tasks_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER; v_ct TIMESTAMPTZ; v_cid UUID; v_rows JSONB; v_status TEXT := COALESCE(p_args ->> 'status', 'open');
  v_due DATE;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_tasks', p_args);
  v_due := platform_private.ai_agent_arg_date(p_args, 'due_before');
  v_limit := COALESCE((p_args ->> 'limit')::INTEGER, 20);
  IF p_args ? 'cursor' THEN
    SELECT d.t, d.id INTO v_ct, v_cid FROM platform_private.ai_agent_cursor_decode(p_args ->> 'cursor') d;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('t', u.created_at, 'id', u.id, 'item', jsonb_build_object(
      'task_id', u.id, 'kind', u.kind, 'title', left(u.title, 200),
      'assignee_name', platform_private.ai_agent_member_name(p_organization_id, u.assignee),
      'status', u.status, 'priority', u.priority, 'due_on', u.due_on, 'case_id', u.case_id, 'lead_id', u.lead_id,
      'created_at', u.created_at)) ORDER BY u.created_at DESC, u.id DESC)
  INTO v_rows
  FROM (SELECT * FROM (
      SELECT t.id, 'staff'::TEXT AS kind, t.title, t.assignee_membership_id AS assignee, t.status::TEXT AS status,
        t.priority::TEXT AS priority, COALESCE(t.due_on, (t.due_at AT TIME ZONE 'Asia/Bishkek')::DATE) AS due_on,
        NULL::UUID AS case_id, (SELECT k.lead_id FROM platform_private.staff_lead_task_links k
          WHERE k.organization_id = t.organization_id AND k.staff_task_id = t.id LIMIT 1) AS lead_id, t.created_at
      FROM platform.staff_tasks t WHERE t.organization_id = p_organization_id AND NOT p_args ? 'case_id'
      UNION ALL
      SELECT c.id, 'case', c.title, c.assignee_membership_id, c.status::TEXT, c.priority::TEXT,
        COALESCE(c.due_on, (c.due_at AT TIME ZONE 'Asia/Bishkek')::DATE), c.student_case_id, NULL::UUID, c.created_at
      FROM platform.case_tasks c WHERE c.organization_id = p_organization_id AND NOT p_args ? 'lead_id') w
    WHERE (v_status = 'all' OR (v_status = 'open' AND w.status IN ('open', 'in_progress', 'blocked'))
        OR (v_status = 'done' AND w.status = 'done'))
      AND (NOT p_args ? 'assignee_id' OR w.assignee = (p_args ->> 'assignee_id')::UUID)
      AND (NOT p_args ? 'case_id' OR w.case_id = (p_args ->> 'case_id')::UUID)
      AND (NOT p_args ? 'lead_id' OR w.lead_id = (p_args ->> 'lead_id')::UUID)
      AND (v_due IS NULL OR w.due_on <= v_due)
      AND (v_ct IS NULL OR (w.created_at, w.id) < (v_ct, v_cid))
    ORDER BY w.created_at DESC, w.id DESC LIMIT v_limit + 1) u;
  RETURN platform_private.ai_agent_page_result(v_rows, v_limit);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_search_catalog_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_limit INTEGER := COALESCE((p_args ->> 'limit')::INTEGER, 10); v_like TEXT; v_out JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'search_catalog', p_args);
  v_like := '%' || replace(replace(replace(lower(COALESCE(p_args ->> 'query', '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.institution_name, 'country', i.country_code, 'city', i.city,
      'programs', i.programs, 'costs', i.costs) ORDER BY i.institution_name, i.id), '[]'::JSONB)
  INTO v_out
  FROM (SELECT ci.id, ci.institution_name, ci.country_code, ci.city,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pr.value ->> 'id', 'name', pr.value ->> 'title',
          'degree', pr.value ->> 'level', 'language', pr.value ->> 'language'))
        FROM (SELECT p.value FROM jsonb_array_elements(COALESCE((SELECT u.content -> 'programs'
            FROM platform_private.university_catalog_publications u
            WHERE u.organization_id = ci.organization_id AND u.institution_id = ci.id AND u.status = 'published'
            ORDER BY u.version DESC LIMIT 1), '[]'::JSONB)) p
          WHERE (NOT p_args ? 'degree' OR lower(p.value ->> 'level') = lower(p_args ->> 'degree'))
            AND (NOT p_args ? 'language' OR lower(COALESCE(p.value ->> 'language', '')) = lower(p_args ->> 'language'))
          LIMIT 20) pr), '[]'::JSONB) AS programs,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', k.cost_kind, 'amount', platform_private.ai_agent_money(k.amount_min_minor),
          'amount_max', CASE WHEN k.amount_max_minor IS NULL THEN NULL ELSE platform_private.ai_agent_money(k.amount_max_minor) END,
          'currency', k.currency, 'period', k.period, 'program_id', k.program_id, 'study_level', k.study_level,
          'checked_on', k.verified_on) ORDER BY k.cost_kind, k.verified_on DESC)
        FROM (SELECT x.* FROM platform.catalog_costs x WHERE x.organization_id = ci.organization_id AND x.institution_id = ci.id
            AND x.status = 'published' AND (NOT p_args ? 'degree' OR x.study_level IS NULL OR x.study_level = lower(p_args ->> 'degree'))
          ORDER BY x.cost_kind, x.verified_on DESC LIMIT 20) k), '[]'::JSONB) AS costs
    FROM platform.catalog_institutions ci
    WHERE ci.organization_id = p_organization_id
      AND (NOT p_args ? 'query' OR lower(ci.institution_name) LIKE v_like)
      AND (NOT p_args ? 'country' OR lower(ci.country_code) = lower(p_args ->> 'country'))
      AND (NOT p_args ? 'city' OR lower(COALESCE(ci.city, '')) = lower(p_args ->> 'city'))
    ORDER BY ci.institution_name, ci.id LIMIT v_limit) i
  WHERE (NOT (p_args ? 'degree' OR p_args ? 'language') OR jsonb_array_length(i.programs) > 0);
  RETURN jsonb_build_object('institutions', v_out);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_search_knowledge_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_aud TEXT := COALESCE(p_args ->> 'audience', 'both'); v_limit INTEGER := COALESCE((p_args ->> 'limit')::INTEGER, 5);
  v_tq tsquery; v_out JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'search_knowledge', p_args);
  v_tq := websearch_to_tsquery('pg_catalog.russian'::REGCONFIG, p_args ->> 'query');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', r.source, 'document_title', r.title, 'section_path', r.path,
      'text', left(r.body, 1500), 'audience', r.audience, 'updated_at', r.updated_at,
      'approved_for_clients', r.audience = 'client') ORDER BY r.rank DESC, r.title), '[]'::JSONB)
  INTO v_out
  FROM (
    SELECT * FROM (
      SELECT 'agent_kb'::TEXT AS source, d.title, c.section_path AS path, c.content AS body, d.audience, d.updated_at,
        ts_rank(c.fts, v_tq) AS rank
      FROM platform_private.ai_chunks c
      JOIN platform_private.ai_documents d ON d.organization_id = c.organization_id AND d.id = c.document_id
      WHERE c.organization_id = p_organization_id AND d.status = 'ready' AND d.superseded_by_id IS NULL
        AND c.fts @@ v_tq AND (v_aud = 'both' OR d.audience = v_aud)
      UNION ALL
      SELECT 'crm_kb', n.title, n.area, ts_headline('pg_catalog.russian'::REGCONFIG, n.body, v_tq,
          'StartSel=, StopSel=, MaxWords=140, MinWords=60, MaxFragments=2'),
        CASE n.area WHEN 'clients' THEN 'client' ELSE 'internal' END, n.updated_at,
        ts_rank(to_tsvector('pg_catalog.russian'::REGCONFIG, n.title || ' ' || n.body), v_tq)
      FROM platform_private.kb_nodes n
      WHERE n.organization_id = p_organization_id AND n.kind = 'page' AND n.area IN ('internal', 'clients')
        AND n.deleted_at IS NULL AND n.archived_at IS NULL
        AND to_tsvector('pg_catalog.russian'::REGCONFIG, n.title || ' ' || n.body) @@ v_tq
        AND (v_aud = 'both' OR (v_aud = 'client' AND n.area = 'clients') OR (v_aud = 'internal' AND n.area = 'internal'))
    ) u ORDER BY u.rank DESC, u.title LIMIT v_limit) r;
  RETURN jsonb_build_object('results', v_out);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_recent_calls_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_days INTEGER := COALESCE((p_args ->> 'days')::INTEGER, 7); v_limit INTEGER := COALESCE((p_args ->> 'limit')::INTEGER, 20);
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'recent_calls', p_args);
  RETURN jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object('call_id', t.id, 'at', t.started_at,
      'direction', CASE t.direction WHEN 'in' THEN 'inbound' ELSE 'outbound' END, 'status', t.state,
      'duration_s', t.talk_seconds, 'lead_id', t.lead_id,
      'client_name', (SELECT c.display_name FROM platform.clients c WHERE c.organization_id = t.organization_id AND c.id = t.client_id),
      'staff_name', platform_private.ai_agent_member_name(t.organization_id, t.membership_id),
      'result', t.result_code) ORDER BY t.started_at DESC, t.id DESC)
    FROM (SELECT x.* FROM platform_private.telephony_calls x
      WHERE x.organization_id = p_organization_id AND x.started_at >= clock_timestamp() - make_interval(days => v_days)
        AND (NOT p_args ? 'lead_id' OR x.lead_id = (p_args ->> 'lead_id')::UUID)
        AND (NOT p_args ? 'direction' OR x.direction = CASE p_args ->> 'direction' WHEN 'inbound' THEN 'in' ELSE 'out' END)
      ORDER BY x.started_at DESC, x.id DESC LIMIT v_limit) t), '[]'::JSONB));
END
$$;

CREATE FUNCTION platform.ai_agent_tool_list_staff_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_like TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'list_staff', p_args);
  v_like := '%' || replace(replace(replace(lower(COALESCE(p_args ->> 'role', '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN jsonb_build_object('items', COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.name,
      'roles', s.roles, 'directions', s.directions, 'active', TRUE) ORDER BY s.name, s.id)
    FROM (SELECT m.id, p.display_name AS name,
        COALESCE((SELECT jsonb_agg(DISTINCT d.label) FROM platform.staff_role_assignments ra
          JOIN platform.staff_role_definitions d ON d.organization_id = ra.organization_id AND d.id = ra.role_id
          WHERE ra.organization_id = m.organization_id AND ra.membership_id = m.id AND ra.revoked_at IS NULL), '[]'::JSONB) AS roles,
        COALESCE((SELECT jsonb_agg(sd.direction_code ORDER BY sd.direction_code) FROM platform.staff_direction_assignments sd
          WHERE sd.organization_id = m.organization_id AND sd.membership_id = m.id), '[]'::JSONB) AS directions
      FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.status = 'active' AND p.status = 'active'
        AND m."current_role" IS DISTINCT FROM 'student') s
    WHERE (NOT p_args ? 'role' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.roles) r WHERE lower(r) LIKE v_like))
      AND (NOT p_args ? 'direction' OR s.directions @> to_jsonb(p_args ->> 'direction'))), '[]'::JSONB));
END
$$;

CREATE FUNCTION platform.ai_agent_tool_get_my_settings_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a platform_private.ai_agents; v_resp UUID;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'get_my_settings', p_args);
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  RETURN jsonb_build_object('agent_key', a.key, 'title', a.title, 'direction', a.direction, 'enabled', a.enabled,
    'auto_send', a.auto_send, 'now_utc', clock_timestamp(), 'timezone', a.schedule_tz,
    'whatsapp_state', platform_private.ai_agent_whatsapp_state(p_organization_id),
    'responsible_staff_name', platform_private.ai_agent_member_name(p_organization_id, v_resp));
END
$$;

-- A.5.3 Инструменты записи -----------------------------------------------------

-- Действующий сотрудник организации (не студент), которому можно поставить задачу.
CREATE FUNCTION platform_private.ai_agent_staff_assignable(p_organization_id UUID, p_membership_id UUID)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_membership_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id AND m.status = 'active' AND p.status = 'active'
      AND m."current_role" IS DISTINCT FROM 'student'
      AND platform_private.staff_can_receive_assignment(m.organization_id, m.id, 'staff.task.read', 'staff_task', NULL)
      AND platform_private.staff_can_receive_assignment(m.organization_id, m.id, 'staff.task.complete', 'staff_task', NULL))
$$;

-- Задача сотруднику: как ai_autosend_call_task (276) - задача, событие, уведомление, квитанция, связь с лидом.
CREATE FUNCTION platform_private.ai_agent_make_staff_task(p_organization_id UUID, p_creator UUID, p_assignee UUID,
  p_title TEXT, p_description TEXT, p_priority TEXT, p_due_on DATE, p_lead_id UUID, p_agent_key TEXT)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task platform.staff_tasks; v_request UUID := gen_random_uuid(); v_event UUID; v_profile UUID;
  v_at TIMESTAMPTZ := clock_timestamp(); v_payload JSONB; v_result JSONB;
BEGIN
  SELECT m.profile_id INTO v_profile FROM platform.organization_memberships m
  WHERE m.organization_id = p_organization_id AND m.id = p_creator;
  INSERT INTO platform.staff_tasks (organization_id, creator_membership_id, assignee_membership_id, title, description,
    status, priority, due_on, created_at, updated_at)
  VALUES (p_organization_id, p_creator, p_assignee, p_title, p_description, 'open', p_priority::platform.case_task_priority,
    p_due_on, v_at, v_at)
  RETURNING * INTO v_task;
  v_payload := jsonb_build_object('operation', 'create', 'source', 'ai_agent', 'agent_key', p_agent_key);
  v_result := jsonb_build_object('staff_task_id', v_task.id, 'version', v_task.version::TEXT, 'request_id', v_request,
    'changed_at', v_at);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id, actor_profile_id, action,
    version, before_state, after_state, request_id, created_at)
  VALUES (p_organization_id, v_task.id, p_creator, v_profile, 'create', v_task.version, NULL, to_jsonb(v_task), v_request, v_at)
  RETURNING id INTO v_event;
  IF p_assignee = p_creator THEN
    INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
    VALUES (p_organization_id, p_assignee, 'task:' || v_event::TEXT, 'task_assigned', v_task.id)
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  END IF;
  INSERT INTO platform_private.staff_task_receipts (request_id, organization_id, actor_membership_id, staff_task_id,
    request_payload, result)
  VALUES (v_request, p_organization_id, p_creator, v_task.id, v_payload, v_result);
  IF p_lead_id IS NOT NULL THEN
    INSERT INTO platform_private.staff_lead_task_links (request_id, organization_id, actor_membership_id, staff_task_id,
      lead_id, input, result)
    VALUES (v_request, p_organization_id, p_creator, v_task.id, p_lead_id, v_payload, v_result);
  END IF;
  RETURN v_task.id;
END
$$;

CREATE FUNCTION platform.ai_agent_tool_create_task_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_resp UUID; v_idem TEXT; v_prior JSONB; v_case platform.student_cases; v_assignee UUID;
  v_title TEXT; v_desc TEXT; v_due DATE; v_priority TEXT := COALESCE(p_args ->> 'priority', 'normal'); v_task UUID;
  v_kind TEXT; v_result JSONB; v_lead UUID; v_profile UUID;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'create_task', p_args);
  v_idem := p_args ->> 'idempotency_key';
  IF v_idem IS NOT NULL THEN
    v_prior := platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key, 'create_task:' || v_idem,
      INTERVAL '10 minutes');
    IF v_prior IS NOT NULL THEN
      RETURN v_prior || jsonb_build_object('deduplicated', TRUE);
    END IF;
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  IF v_resp IS NULL THEN
    RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
  END IF;
  v_title := '[ИИ «' || a.title || '»] ' || btrim(p_args ->> 'title');
  v_desc := NULLIF(btrim(p_args ->> 'description'), '');
  v_due := platform_private.ai_agent_arg_date(p_args, 'due_on');
  IF p_args ? 'case_id' THEN
    SELECT * INTO v_case FROM platform.student_cases s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p_args ? 'lead_id' THEN
    v_lead := (p_args ->> 'lead_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p_args ? 'assignee_id' THEN
    v_assignee := (p_args ->> 'assignee_id')::UUID;
    IF NOT platform_private.ai_agent_staff_assignable(p_organization_id, v_assignee) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_case.id IS NOT NULL AND platform_private.ai_agent_staff_assignable(p_organization_id, v_case.current_curator_membership_id) THEN
    v_assignee := v_case.current_curator_membership_id;
  ELSE
    v_assignee := v_resp;
  END IF;
  IF v_case.id IS NOT NULL THEN
    v_kind := 'case';
    SELECT m.profile_id INTO v_profile FROM platform.organization_memberships m WHERE m.organization_id = p_organization_id AND m.id = v_resp;
    INSERT INTO platform.case_tasks (organization_id, student_case_id, task_type, title, assignee_membership_id, priority,
      due_on, status, student_visible, created_by_membership_id)
    VALUES (p_organization_id, v_case.id, 'ai_agent', v_title, v_assignee, v_priority::platform.case_task_priority, v_due,
      'open', FALSE, v_resp)
    RETURNING id INTO v_task;
    INSERT INTO platform.case_task_events (organization_id, case_task_id, student_case_id, previous_status, new_status,
      previous_assignee_membership_id, new_assignee_membership_id, actor_membership_id, request_id)
    VALUES (p_organization_id, v_task, v_case.id, NULL, 'open', NULL, v_assignee, v_resp, gen_random_uuid());
  ELSE
    v_kind := 'staff';
    v_task := platform_private.ai_agent_make_staff_task(p_organization_id, v_resp, v_assignee, v_title, v_desc, v_priority,
      v_due, v_lead, p_agent_key);
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write',
    CASE v_kind WHEN 'case' THEN 'case_task' ELSE 'staff_task' END, v_task, NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'create_task', 'taskId', v_task),
    'ИИ-агент изменил данные: создана задача');
  v_result := jsonb_build_object('task_id', v_task, 'kind', v_kind,
    'assignee_name', platform_private.ai_agent_member_name(p_organization_id, v_assignee), 'deduplicated', FALSE);
  IF v_idem IS NOT NULL THEN
    PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, 'create_task:' || v_idem, v_result);
  END IF;
  RETURN v_result;
END
$$;

CREATE FUNCTION platform.ai_agent_tool_add_note_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_resp UUID; v_idem TEXT; v_prior JSONB; v_body TEXT; v_lead UUID; v_case UUID; v_note UUID; v_result JSONB;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'add_note', p_args);
  IF (p_args ? 'lead_id')::INTEGER + (p_args ? 'case_id')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_idem := p_args ->> 'idempotency_key';
  IF v_idem IS NOT NULL THEN
    v_prior := platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key, 'add_note:' || v_idem, INTERVAL '10 minutes');
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  IF v_resp IS NULL THEN
    RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
  END IF;
  v_body := btrim('[ИИ «' || a.title || '»] ' || platform_private.ai_agent_clean_text(p_args ->> 'body'));
  IF char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'lead_id' THEN
    v_lead := (p_args ->> 'lead_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.organization_id = p_organization_id AND l.id = v_lead) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_case := (p_args ->> 'case_id')::UUID;
    IF NOT EXISTS (SELECT 1 FROM platform.student_cases s WHERE s.organization_id = p_organization_id AND s.id = v_case) THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO platform.case_notes (organization_id, lead_id, student_case_id, body, created_by_membership_id)
  VALUES (p_organization_id, v_lead, v_case, v_body, v_resp)
  RETURNING id INTO v_note;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write',
    CASE WHEN v_lead IS NOT NULL THEN 'lead' ELSE 'student_case' END, COALESCE(v_lead, v_case), NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'add_note', 'noteId', v_note),
    'ИИ-агент изменил данные: добавлена заметка');
  v_result := jsonb_build_object('note_id', v_note);
  IF v_idem IS NOT NULL THEN
    PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, 'add_note:' || v_idem, v_result);
  END IF;
  RETURN v_result;
END
$$;

CREATE FUNCTION platform.ai_agent_tool_post_digest_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_run platform_private.ai_agent_runs; v_from DATE; v_to DATE; v_id UUID;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'post_digest', p_args);
  v_from := platform_private.ai_agent_arg_date(p_args, 'period_from');
  v_to := platform_private.ai_agent_arg_date(p_args, 'period_to');
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  IF p_args ? 'metrics' AND octet_length((p_args -> 'metrics')::TEXT) > 16384 THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  INSERT INTO platform_private.ai_agent_digests (organization_id, agent_key, run_id, kind, title, body_md, metrics, period_from, period_to)
  VALUES (p_organization_id, p_agent_key, v_run.id, p_args ->> 'kind', btrim(p_args ->> 'title'), p_args ->> 'body_md',
    p_args -> 'metrics', v_from, v_to)
  RETURNING id INTO v_id;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write', 'ai_agent', a.id, NULL,
    jsonb_build_object('agentKey', p_agent_key, 'tool', 'post_digest', 'digestId', v_id, 'kind', p_args ->> 'kind'),
    'ИИ-агент изменил данные: опубликован отчёт');
  RETURN jsonb_build_object('digest_id', v_id);
END
$$;

CREATE FUNCTION platform.ai_agent_tool_notify_staff_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_resp UUID; v_like TEXT; v_ids UUID[]; v_id UUID; v_task UUID; v_created JSONB := '[]'::JSONB;
  v_dedupe TEXT := p_args ->> 'dedupe_key'; v_skipped BOOLEAN := FALSE; v_today DATE := (clock_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE;
  v_title TEXT; v_desc TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'notify_staff', p_args);
  IF (p_args ? 'staff_id')::INTEGER + (p_args ? 'role')::INTEGER + (p_args ? 'direction')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_resp := platform_private.ai_agents_responsible(p_organization_id);
  IF v_resp IS NULL THEN
    RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
  END IF;
  IF p_args ? 'staff_id' THEN
    v_ids := ARRAY[(p_args ->> 'staff_id')::UUID];
  ELSIF p_args ? 'role' THEN
    v_like := '%' || replace(replace(replace(lower(p_args ->> 'role'), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    SELECT COALESCE(array_agg(DISTINCT ra.membership_id), ARRAY[]::UUID[]) INTO v_ids
    FROM platform.staff_role_assignments ra
    JOIN platform.staff_role_definitions d ON d.organization_id = ra.organization_id AND d.id = ra.role_id
    WHERE ra.organization_id = p_organization_id AND ra.revoked_at IS NULL AND lower(d.label) LIKE v_like;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT sd.membership_id), ARRAY[]::UUID[]) INTO v_ids
    FROM platform.staff_direction_assignments sd
    WHERE sd.organization_id = p_organization_id AND sd.direction_code = p_args ->> 'direction';
  END IF;
  IF cardinality(v_ids) > 10 THEN
    RAISE EXCEPTION 'too_large' USING ERRCODE = '54001';
  END IF;
  SELECT COALESCE(array_agg(x.id ORDER BY x.id), ARRAY[]::UUID[]) INTO v_ids
  FROM unnest(v_ids) AS x(id) WHERE platform_private.ai_agent_staff_assignable(p_organization_id, x.id);
  IF cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  v_title := '[ИИ] ' || btrim(p_args ->> 'title');
  v_desc := btrim(p_args ->> 'body');
  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_dedupe IS NOT NULL AND platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key,
        'notify:' || v_dedupe || ':' || v_id::TEXT, INTERVAL '24 hours') IS NOT NULL THEN
      v_skipped := TRUE;
      CONTINUE;
    END IF;
    v_task := platform_private.ai_agent_make_staff_task(p_organization_id, v_resp, v_id, v_title, v_desc, 'high', v_today,
      NULL, p_agent_key);
    v_created := v_created || jsonb_build_array(jsonb_build_object('staff_id', v_id, 'task_id', v_task));
    IF v_dedupe IS NOT NULL THEN
      PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, 'notify:' || v_dedupe || ':' || v_id::TEXT,
        jsonb_build_object('task_id', v_task));
    END IF;
    PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.tool.write', 'staff_task', v_task,
      NULL, jsonb_build_object('agentKey', p_agent_key, 'tool', 'notify_staff', 'taskId', v_task),
      'ИИ-агент изменил данные: уведомление сотруднику');
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'deduplicated', v_skipped);
END
$$;

-- ---------------------------------------------------------------------------
-- A.6 Отправка клиентам: авторизация WhatsApp вида `ai_agent` (раздел F), send_message.
-- ---------------------------------------------------------------------------

-- F.1 manual_send_authorizations: новый вид и ровно один источник (276: те же имена ограничений).
ALTER TABLE platform.manual_send_authorizations ADD COLUMN ai_agent_draft_id UUID;
ALTER TABLE platform.manual_send_authorizations DROP CONSTRAINT IF EXISTS manual_send_authorizations_kind_check;
ALTER TABLE platform.manual_send_authorizations ADD CONSTRAINT manual_send_authorizations_kind_check
  CHECK (kind IN ('manual', 'ai_autosend', 'ai_agent'));
ALTER TABLE platform.manual_send_authorizations DROP CONSTRAINT IF EXISTS manual_send_authorizations_one_source_check;
ALTER TABLE platform.manual_send_authorizations ADD CONSTRAINT manual_send_authorizations_one_source_check CHECK (
  (kind = 'manual' AND ai_autosend_decision_id IS NULL AND ai_agent_draft_id IS NULL)
  OR (kind = 'ai_autosend' AND ai_autosend_decision_id IS NOT NULL AND ai_draft_id IS NULL AND ai_agent_draft_id IS NULL)
  OR (kind = 'ai_agent' AND ai_agent_draft_id IS NOT NULL AND ai_autosend_decision_id IS NULL AND ai_draft_id IS NULL));
ALTER TABLE platform.manual_send_authorizations ADD CONSTRAINT manual_send_authorizations_ai_agent_draft_fkey
  FOREIGN KEY (organization_id, ai_agent_draft_id) REFERENCES platform_private.ai_agent_drafts(organization_id, id)
  ON DELETE RESTRICT;
CREATE UNIQUE INDEX manual_send_authorizations_ai_agent_draft_key
  ON platform.manual_send_authorizations (organization_id, ai_agent_draft_id) WHERE ai_agent_draft_id IS NOT NULL;

-- F.2 Страж вставки. Ветки `manual` и `ai_autosend` - как в 276 (md5 исходника закреплён якорем); новая
-- ветка `ai_agent`: GUC, одобренный черновик, текст и SHA-256 черновика, диалог и сообщение, отправитель.
CREATE OR REPLACE FUNCTION platform_private.guard_ai_autosend_authorization()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'manual' THEN
    RETURN NEW;
  END IF;
  IF NEW.kind = 'ai_agent' THEN
    IF COALESCE(current_setting('evo.ai_agent_authorize', TRUE), '') <> 'on'
      OR COALESCE(current_setting('evo.ai_agent_sender', TRUE), '') <> NEW.authorized_by_membership_id::TEXT
      OR NOT EXISTS (SELECT 1 FROM platform_private.ai_agent_drafts d
        WHERE d.organization_id = NEW.organization_id AND d.id = NEW.ai_agent_draft_id AND d.channel = 'whatsapp'
          AND d.status = 'approved' AND d.conversation_id = NEW.conversation_id AND d.source_message_id = NEW.source_message_id
          AND COALESCE(d.edited_text, d.text) = NEW.final_text
          AND encode(sha256(convert_to(COALESCE(d.edited_text, d.text), 'UTF8')), 'hex') = NEW.final_text_sha256) THEN
      RAISE EXCEPTION 'ai_agent_authorization_forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('evo.ai_autosend_authorize', TRUE), '') <> 'on'
    OR NOT EXISTS (SELECT 1 FROM platform_private.ai_autosend_log l
      JOIN platform_private.ai_autosend_settings s ON s.organization_id = l.organization_id
      WHERE l.organization_id = NEW.organization_id AND l.id = NEW.ai_autosend_decision_id
        AND l.conversation_id = NEW.conversation_id AND l.client_message_id = NEW.source_message_id
        AND l.status = 'scheduled' AND l.text = NEW.final_text AND l.text_sha256 = NEW.final_text_sha256
        AND s.responsible_membership_id = NEW.authorized_by_membership_id) THEN
    RAISE EXCEPTION 'ai_autosend_authorization_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION platform_private.guard_ai_autosend_authorization()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent;

-- F.3 Помощники предохранителей (без грантов).

-- Сотрудник (не агент) писал в диалог за последние N минут: исходящее не агента, либо ручная авторизация.
CREATE FUNCTION platform_private.ai_agent_staff_active(p_organization_id UUID, p_conversation_id UUID, p_minutes INTEGER)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.communication_messages m
      WHERE m.organization_id = p_organization_id AND m.conversation_id = p_conversation_id AND m.direction = 'outbound'
        AND m.created_at > clock_timestamp() - make_interval(mins => p_minutes)
        AND NOT EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
          WHERE a.organization_id = m.organization_id AND a.id = m.manual_send_authorization_id
            AND a.kind IN ('ai_agent', 'ai_autosend')))
    OR EXISTS (SELECT 1 FROM platform.manual_send_authorizations a
      WHERE a.organization_id = p_organization_id AND a.conversation_id = p_conversation_id AND a.kind = 'manual'
        AND a.authorized_at > clock_timestamp() - make_interval(mins => p_minutes))
$$;

-- Лимиты WhatsApp в час: 6 на диалог, 60 на организацию (считаются отправки агентов, кроме черновика p_exclude).
CREATE FUNCTION platform_private.ai_agent_rate_limited(p_organization_id UUID, p_conversation_id UUID, p_exclude UUID)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM platform_private.ai_agent_drafts d
      WHERE d.organization_id = p_organization_id AND d.conversation_id = p_conversation_id AND d.channel = 'whatsapp'
        AND d.sent_by_agent AND d.status IN ('approved', 'sending', 'sent') AND d.id IS DISTINCT FROM p_exclude
        AND d.created_at > clock_timestamp() - INTERVAL '1 hour') >= 6
    OR (SELECT count(*) FROM platform_private.ai_agent_drafts d
      WHERE d.organization_id = p_organization_id AND d.channel = 'whatsapp'
        AND d.sent_by_agent AND d.status IN ('approved', 'sending', 'sent') AND d.id IS DISTINCT FROM p_exclude
        AND d.created_at > clock_timestamp() - INTERVAL '1 hour') >= 60
$$;

CREATE FUNCTION platform_private.ai_agent_whatsapp_sender_ok(p_organization_id UUID, p_membership_id UUID, p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_membership_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = p_organization_id AND m.id = p_membership_id AND m.status = 'active' AND p.status = 'active'
      AND m."current_role" IS DISTINCT FROM 'student'
      AND platform_private.staff_can_access(m.organization_id, m.id, 'communication.manual.send', 'conversation', p_conversation_id))
$$;

-- F.4 platform.ai_agent_runtime_whatsapp_authorize_v1 - по образцу ai_autosend_authorize_v1 (276).
CREATE FUNCTION platform.ai_agent_runtime_whatsapp_authorize_v1(p_organization_id UUID, p_draft_id UUID,
  p_sender_membership_id UUID, p_provider_status TEXT, p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d platform_private.ai_agent_drafts; v_conv platform.communication_conversations; v_member RECORD; v_text TEXT; v_sha TEXT;
  v_authz platform.manual_send_authorizations; v_item RECORD; v_authz_id UUID; v_key TEXT; v_enqueue JSONB; v_reason TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM platform_private.require_p2g_service();
  IF p_organization_id IS NULL OR p_draft_id IS NULL OR p_sender_membership_id IS NULL OR p_request_id IS NULL
    OR p_provider_status IS NULL OR p_provider_status !~ '^[A-Z][A-Z_]{0,39}$' THEN
    RAISE EXCEPTION 'ai_agent_authorize_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_agent_draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_conv FROM platform.communication_conversations c
  WHERE c.organization_id = p_organization_id AND c.id = d.conversation_id;
  IF FOUND THEN
    -- Тот же порядок блокировок, что у цепочки автоответчика: чат (advisory), затем черновик.
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_agent_draft:' || v_conv.id::TEXT, 317));
  END IF;
  SELECT * INTO d FROM platform_private.ai_agent_drafts x WHERE x.organization_id = p_organization_id AND x.id = p_draft_id FOR UPDATE;

  -- Повтор начатой отправки: прежняя авторизация и работа.
  IF d.status = 'sending' THEN
    SELECT * INTO v_authz FROM platform.manual_send_authorizations a
    WHERE a.organization_id = p_organization_id AND a.ai_agent_draft_id = d.id;
    IF FOUND THEN
      SELECT i.id, i.state, i.queue_message_id, i.business_key_sha256 INTO v_item
      FROM platform_private.durable_work_items i
      WHERE i.organization_id = p_organization_id AND i.manual_send_authorization_id = v_authz.id
      ORDER BY i.created_at LIMIT 1;
      RETURN jsonb_build_object('authorized', TRUE, 'replayed', TRUE, 'organization_id', v_authz.organization_id,
        'manual_send_authorization_id', v_authz.id, 'communication_conversation_id', v_authz.conversation_id,
        'source_message_id', v_authz.source_message_id, 'ai_draft_id', NULL, 'ai_agent_draft_id', d.id,
        'final_text', v_authz.final_text, 'final_text_sha256', v_authz.final_text_sha256,
        'authorized_by_membership_id', v_authz.authorized_by_membership_id, 'state', 'manual_send_authorized',
        'requested_by_membership_id', v_authz.authorized_by_membership_id, 'work_item_id', v_item.id,
        'work_state', v_item.state, 'queue_message_id', v_item.queue_message_id,
        'business_key_sha256', v_item.business_key_sha256, 'waha_readiness', 'ready',
        'waha_readiness_evidence_kind', 'provider_observed', 'waha_readiness_fresh', TRUE,
        'waha_readiness_observed_at', v_authz.authorized_at);
    END IF;
  END IF;
  IF d.channel <> 'whatsapp' OR d.status <> 'approved' THEN
    RETURN jsonb_build_object('authorized', FALSE, 'reason', 'not_approved');
  END IF;
  v_reason := NULL;
  IF p_provider_status <> 'WORKING' THEN
    v_reason := 'whatsapp_unavailable';
  ELSIF v_conv.id IS NULL OR v_conv.status <> 'open' THEN
    v_reason := 'conversation_closed';
  ELSIF d.source_message_id IS DISTINCT FROM platform_private.ai_latest_inbound(p_organization_id, v_conv.id) THEN
    v_reason := 'conversation_moved_on';
  ELSIF NOT platform_private.ai_agent_whatsapp_sender_ok(p_organization_id, p_sender_membership_id, v_conv.id) THEN
    v_reason := 'sender_unavailable';
  ELSIF d.sent_by_agent AND platform_private.ai_agent_staff_active(p_organization_id, v_conv.id, 30) THEN
    v_reason := 'staff_active';
  ELSIF d.sent_by_agent AND platform_private.ai_agent_rate_limited(p_organization_id, v_conv.id, d.id) THEN
    v_reason := 'rate_limited';
  END IF;
  IF v_reason IS NOT NULL THEN
    IF v_reason IN ('whatsapp_unavailable', 'rate_limited', 'staff_active', 'sender_unavailable') THEN
      UPDATE platform_private.ai_agent_drafts x SET status = 'pending', failure_code = v_reason WHERE x.id = d.id;
    ELSE
      UPDATE platform_private.ai_agent_drafts x SET status = 'failed', failure_code = v_reason WHERE x.id = d.id;
    END IF;
    RETURN jsonb_build_object('authorized', FALSE, 'reason', v_reason);
  END IF;

  SELECT m.id, m.profile_id, p.auth_user_id INTO v_member
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = p_organization_id AND m.id = p_sender_membership_id;
  v_text := COALESCE(d.edited_text, d.text);
  v_sha := platform_private.ai_agent_sha256(v_text);
  v_authz_id := gen_random_uuid();
  PERFORM set_config('evo.ai_agent_authorize', 'on', TRUE);
  PERFORM set_config('evo.ai_agent_sender', v_member.id::TEXT, TRUE);
  INSERT INTO platform.manual_send_authorizations (id, organization_id, conversation_id, source_message_id, ai_draft_id,
    final_text, final_text_sha256, authorized_by_profile_id, authorized_by_membership_id, reason, request_id, kind,
    ai_agent_draft_id)
  VALUES (v_authz_id, p_organization_id, v_conv.id, d.source_message_id, NULL, v_text, v_sha, v_member.profile_id,
    v_member.id, 'ai_agent', platform_private.p3c_request_child_id(p_request_id, 'ai-agent-authorize'), 'ai_agent', d.id);
  PERFORM set_config('evo.ai_agent_authorize', '', TRUE);
  PERFORM set_config('evo.ai_agent_sender', '', TRUE);
  v_key := encode(sha256(convert_to(array_to_json(ARRAY['evo-platform-work-v1', 'ai_agent', p_organization_id::TEXT,
    v_conv.id::TEXT, d.source_message_id::TEXT, d.id::TEXT])::TEXT, 'UTF8')), 'hex');
  v_enqueue := platform_private.p3c_enqueue_authenticated_work(p_organization_id, 'manual_whatsapp_send', NULL,
    v_authz_id, v_key, 1, platform_private.p3c_request_child_id(p_request_id, 'ai-agent-enqueue'),
    'enqueue_manual_whatsapp_send', v_member.profile_id, v_member.auth_user_id,
    'Enqueue one AI-agent WhatsApp send for the exact current inbound cycle');
  UPDATE platform_private.ai_agent_drafts x SET status = 'sending', failure_code = NULL,
    provider = COALESCE(x.provider, '{}'::JSONB) || jsonb_build_object('authorizationId', v_authz_id::TEXT,
      'workItemId', v_enqueue ->> 'work_item_id')
  WHERE x.id = d.id;
  RETURN jsonb_build_object('authorized', TRUE, 'replayed', FALSE, 'organization_id', p_organization_id,
    'manual_send_authorization_id', v_authz_id, 'communication_conversation_id', v_conv.id,
    'source_message_id', d.source_message_id, 'ai_draft_id', NULL, 'ai_agent_draft_id', d.id, 'final_text', v_text,
    'final_text_sha256', v_sha, 'authorized_by_membership_id', v_member.id, 'state', 'manual_send_authorized',
    'requested_by_membership_id', v_member.id, 'work_item_id', v_enqueue -> 'work_item_id',
    'work_state', v_enqueue -> 'state', 'queue_message_id', v_enqueue -> 'queue_message_id',
    'business_key_sha256', v_key, 'waha_readiness', 'ready', 'waha_readiness_evidence_kind', 'provider_observed',
    'waha_readiness_fresh', TRUE, 'waha_readiness_observed_at', v_now);
END
$$;

-- F.5 platform.ai_agent_tool_send_message_v1 (A.6): черновик или прямая отправка по правилам базы.
CREATE FUNCTION platform.ai_agent_tool_send_message_v1(p_organization_id UUID, p_agent_key TEXT, p_args JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a platform_private.ai_agents; v_idem TEXT; v_prior JSONB; v_channel TEXT := p_args ->> 'channel'; v_text TEXT; v_max INTEGER;
  v_conv platform.communication_conversations; v_case platform.student_cases; v_source UUID; v_label TEXT; v_lead UUID;
  v_run platform_private.ai_agent_runs; v_auth_run platform_private.ai_agent_runs; v_code TEXT; v_direct BOOLEAN := FALSE;
  v_sender UUID; v_resp UUID; v_fail TEXT; v_draft platform_private.ai_agent_drafts; v_post JSONB; v_result JSONB; v_state TEXT;
  v_mode TEXT; v_status TEXT; v_hint TEXT;
BEGIN
  a := platform_private.ai_agent_tool_begin(p_organization_id, p_agent_key, 'send_message', p_args);
  IF NOT ((v_channel = 'whatsapp' AND p_args ? 'conversation_id' AND NOT p_args ? 'case_id')
    OR (v_channel = 'portal' AND p_args ? 'case_id' AND NOT p_args ? 'conversation_id')) THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  v_idem := p_args ->> 'idempotency_key';
  IF v_idem IS NOT NULL THEN
    v_prior := platform_private.ai_agent_dedupe_get(p_organization_id, p_agent_key, 'send_message:' || v_idem, INTERVAL '10 minutes');
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;
  v_max := CASE v_channel WHEN 'whatsapp' THEN 4000 ELSE 8000 END;
  v_text := platform_private.ai_agent_clean_text(p_args ->> 'text');
  IF NOT platform_private.ai_agent_text_ok(v_text, v_max) THEN
    RAISE EXCEPTION 'text_invalid' USING ERRCODE = '55000';
  END IF;
  IF v_channel = 'whatsapp' THEN
    SELECT * INTO v_conv FROM platform.communication_conversations c
    WHERE c.organization_id = p_organization_id AND c.id = (p_args ->> 'conversation_id')::UUID;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_conv.status <> 'open' THEN
      RAISE EXCEPTION 'conversation_closed' USING ERRCODE = '55000';
    END IF;
    v_source := platform_private.ai_latest_inbound(p_organization_id, v_conv.id);
    IF v_source IS NULL THEN
      RAISE EXCEPTION 'no_inbound_message' USING ERRCODE = '55000';
    END IF;
    v_label := left(COALESCE((SELECT c.display_name FROM platform.clients c
      WHERE c.organization_id = v_conv.organization_id AND c.id = v_conv.canonical_client_id), v_conv.subject), 120);
    v_lead := v_conv.canonical_lead_id;
  ELSE
    SELECT * INTO v_case FROM platform.student_cases s
    WHERE s.organization_id = p_organization_id AND s.id = (p_args ->> 'case_id')::UUID;
    IF NOT FOUND OR v_case.state = 'closed' THEN
      RAISE EXCEPTION 'target_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_label := left(v_case.student_display_name, 120);
    v_lead := v_case.canonical_lead_id;
  END IF;

  -- Режим: Авто агента или код полномочия открытого запуска с таким же SHA-256.
  v_run := platform_private.ai_agent_open_run(p_organization_id, p_agent_key);
  v_code := p_args ->> 'authority_code';
  IF v_code IS NOT NULL THEN
    SELECT * INTO v_auth_run FROM platform_private.ai_agent_runs r
    WHERE r.organization_id = p_organization_id AND r.agent_key = p_agent_key AND r.status IN ('starting', 'running')
      AND r.send_authority AND r.send_authority_sha256 = platform_private.ai_agent_sha256(v_code)
    ORDER BY r.started_at DESC LIMIT 1;
    IF FOUND THEN
      v_direct := TRUE;
    END IF;
  END IF;
  IF a.auto_send THEN
    v_direct := TRUE;
  END IF;
  IF v_run.id IS NULL AND v_auth_run.id IS NOT NULL THEN
    v_run := v_auth_run;
  END IF;

  IF v_direct THEN
    -- Отправитель: инициатор запуска с кодом полномочия, иначе ответственный.
    v_sender := CASE WHEN v_auth_run.id IS NOT NULL AND platform_private.ai_agent_staff_assignable(p_organization_id,
        v_auth_run.started_by_membership_id) THEN v_auth_run.started_by_membership_id END;
    IF v_sender IS NULL THEN
      v_resp := platform_private.ai_agents_responsible(p_organization_id);
      IF v_resp IS NULL THEN
        RAISE EXCEPTION 'ai_agent_responsible_missing' USING ERRCODE = '55000';
      END IF;
      v_sender := v_resp;
    END IF;
    IF v_channel = 'whatsapp' THEN
      v_state := platform_private.ai_agent_whatsapp_state(p_organization_id, v_conv.waha_session_name);
      IF v_state = 'disconnected' THEN
        v_fail := 'whatsapp_unavailable';
      ELSIF NOT platform_private.ai_agent_whatsapp_sender_ok(p_organization_id, v_sender, v_conv.id) THEN
        v_fail := 'sender_unavailable';
      ELSIF platform_private.ai_agent_staff_active(p_organization_id, v_conv.id, 30) THEN
        v_fail := 'staff_active';
      ELSIF platform_private.ai_agent_rate_limited(p_organization_id, v_conv.id, NULL) THEN
        v_fail := 'rate_limited';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM platform.organization_memberships m
        WHERE m.organization_id = p_organization_id AND m.id = v_sender AND m.status = 'active'
          AND platform_private.staff_can_access(m.organization_id, m.id, 'case.update.append', 'student_case', v_case.id)) THEN
      v_fail := 'sender_unavailable';
    END IF;
    IF v_fail IS NOT NULL THEN
      v_direct := FALSE;
    END IF;
  END IF;

  IF NOT v_direct THEN
    IF (SELECT count(*) FROM platform_private.ai_agent_drafts x
        WHERE x.organization_id = p_organization_id AND x.agent_key = p_agent_key AND x.status = 'pending'
          AND x.expires_at > clock_timestamp()
          AND ((v_channel = 'whatsapp' AND x.conversation_id = v_conv.id) OR (v_channel = 'portal' AND x.student_case_id = v_case.id))) >= 3 THEN
      RAISE EXCEPTION 'conflict' USING ERRCODE = '55000';
    END IF;
    INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, run_id, channel, conversation_id, student_case_id,
      lead_id, target_label, source_message_id, text, reason, status, failure_code)
    VALUES (p_organization_id, p_agent_key, v_run.id, v_channel, v_conv.id, v_case.id, v_lead, v_label, v_source, v_text,
      left(p_args ->> 'reason', 300), 'pending', v_fail)
    RETURNING * INTO v_draft;
    v_mode := 'draft'; v_status := 'draft_created';
    v_hint := CASE WHEN v_fail IS NULL THEN 'Ждёт одобрения сотрудника в CRM'
      ELSE 'Сообщение ждёт одобрения сотрудника: ' || COALESCE(CASE v_fail
        WHEN 'whatsapp_unavailable' THEN 'WhatsApp сейчас не подключён'
        WHEN 'sender_unavailable' THEN 'отправитель не может писать в этот чат'
        WHEN 'staff_active' THEN 'в чате уже отвечает сотрудник'
        WHEN 'rate_limited' THEN 'достигнут лимит отправки' END, v_fail) END;
    v_result := jsonb_build_object('status', v_status, 'mode', v_mode, 'draft_id', v_draft.id, 'hint', v_hint);
  ELSE
    INSERT INTO platform_private.ai_agent_drafts (organization_id, agent_key, run_id, channel, conversation_id, student_case_id,
      lead_id, target_label, source_message_id, text, reason, status, sent_by_agent)
    VALUES (p_organization_id, p_agent_key, v_run.id, v_channel, v_conv.id, v_case.id, v_lead, v_label, v_source, v_text,
      left(p_args ->> 'reason', 300), 'approved', TRUE)
    RETURNING * INTO v_draft;
    v_mode := 'direct';
    IF v_channel = 'portal' THEN
      v_post := platform_private.ai_agent_portal_post(p_organization_id, v_draft.id, v_sender);
      v_result := jsonb_build_object('status', 'sent', 'mode', 'direct', 'draft_id', v_draft.id,
        'message_id', v_post ->> 'messageId', 'sender_membership_id', v_sender);
    ELSE
      v_result := jsonb_build_object('status', 'needs_dispatch', 'mode', 'direct', 'draft_id', v_draft.id,
        'sender_membership_id', v_sender);
    END IF;
  END IF;
  PERFORM platform_private.ai_agent_audit(p_organization_id, NULL, p_agent_key, 'ai.agent.draft.create', 'ai_agent_draft',
    v_draft.id, NULL, jsonb_build_object('agentKey', p_agent_key, 'channel', v_channel, 'mode', v_mode,
      'failureCode', v_fail, 'sentByAgent', v_direct),
    CASE WHEN v_direct THEN 'ИИ-агент подготовил сообщение к отправке' ELSE 'ИИ-агент подготовил сообщение (черновик)' END);
  IF v_idem IS NOT NULL THEN
    PERFORM platform_private.ai_agent_dedupe_put(p_organization_id, p_agent_key, 'send_message:' || v_idem, v_result);
  END IF;
  RETURN v_result;
END
$$;

-- ---------------------------------------------------------------------------
-- A.7 Журнал платформы: 11 действий и 3 типа объектов (rename-and-union, как 311 и 316).
-- ---------------------------------------------------------------------------
ALTER FUNCTION platform_private.p7a_safe_audit_actions()
  RENAME TO p7a_safe_audit_actions_pre_ai_agents_managed;
CREATE FUNCTION platform_private.p7a_safe_audit_actions()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.action ORDER BY allowed.action)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()
      || ARRAY[
    'ai.agent.config.change',
    'ai.agent.document.read',
    'ai.agent.draft.create',
    'ai.agent.draft.decide',
    'ai.agent.message.send',
    'ai.agent.run.finish',
    'ai.agent.run.start',
    'ai.agent.sync',
    'ai.agent.token.rotate',
    'ai.agent.tool.read',
    'ai.agent.tool.write'
      ]::TEXT[]
  ) AS allowed(action)
$$;

ALTER FUNCTION platform_private.p7a_safe_audit_resource_types()
  RENAME TO p7a_safe_audit_resource_types_pre_ai_agents_managed;
CREATE FUNCTION platform_private.p7a_safe_audit_resource_types()
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.array_agg(DISTINCT allowed.resource_type ORDER BY allowed.resource_type)
  FROM pg_catalog.unnest(
    platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()
      || ARRAY[
    'ai_agent',
    'ai_agent_draft',
    'ai_agent_run'
      ]::TEXT[]
  ) AS allowed(resource_type)
$$;

REVOKE ALL ON FUNCTION
  platform_private.p7a_safe_audit_actions_pre_ai_agents_managed(),
  platform_private.p7a_safe_audit_actions(),
  platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed(),
  platform_private.p7a_safe_audit_resource_types()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Права функций: сотрудник - authenticated; рантайм, MCP и инструменты - service_role; помощники -
-- никому. Строки каталога для всех организаций.
-- ---------------------------------------------------------------------------
DO $a317_acl$
DECLARE f REGPROCEDURE;
BEGIN
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
        OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%'))
      OR (n.nspname = 'platform_private' AND (p.proname LIKE 'ai\_agents\_%' OR p.proname LIKE 'ai\_agent\_%')
        AND p.proname <> 'ai_agent_grant_common_roles') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin, evo_ai_agent', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.proname LIKE 'ai\_agents\_%\_v1' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOR f IN SELECT p.oid::REGPROCEDURE FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND (p.proname LIKE 'ai\_agent\_runtime\_%' OR p.proname LIKE 'ai\_agent\_mcp\_%'
      OR p.proname LIKE 'ai\_agent\_tool\_%') LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$a317_acl$;

-- Триггер-страж остаётся закрытым (его права снимались выше при замене).
SELECT platform_private.ai_agents_ensure_rows(o.id) FROM platform.organizations o;

-- ---------------------------------------------------------------------------
-- Проверка в конце: сид, таблицы, права, allowlist.
-- ---------------------------------------------------------------------------
DO $a317_verify$
DECLARE
  t TEXT; f RECORD; v_expected_fn INTEGER := 0; v_staff INTEGER; v_service INTEGER;
BEGIN
  IF (SELECT count(*) FROM platform_private.ai_agents) <> 7 * (SELECT count(*) FROM platform.organizations)
    OR (SELECT count(*) FROM platform_private.ai_agents_org_settings) <> (SELECT count(*) FROM platform.organizations)
    OR (SELECT count(*) FROM platform_private.ai_agent_tool_schemas) <> 24 THEN
    RAISE EXCEPTION 'a317_verify_seed' USING ERRCODE = '55000';
  END IF;
  FOREACH t IN ARRAY ARRAY['ai_agents', 'ai_agents_org_settings', 'ai_agent_runs', 'ai_agent_actions', 'ai_agent_drafts',
    'ai_agent_digests', 'ai_agent_file_grants', 'ai_agent_dedupe', 'ai_agent_tool_schemas'] LOOP
    IF NOT (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_catalog.pg_class c
        WHERE c.oid = ('platform_private.' || t)::REGCLASS)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies x WHERE x.schemaname = 'platform_private' AND x.tablename = t)
      OR has_table_privilege('anon', 'platform_private.' || t, 'SELECT')
      OR has_table_privilege('authenticated', 'platform_private.' || t, 'SELECT')
      OR has_table_privilege('service_role', 'platform_private.' || t, 'SELECT')
      OR has_table_privilege('authenticated', 'platform_private.' || t, 'INSERT')
      OR has_table_privilege('service_role', 'platform_private.' || t, 'INSERT') THEN
      RAISE EXCEPTION 'a317_verify_table: %', t USING ERRCODE = '55000';
    END IF;
  END LOOP;
  FOR f IN SELECT p.oid, p.proname, n.nspname, p.prosecdef, p.proconfig FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
        OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%'))
      OR (n.nspname = 'platform_private' AND p.proname LIKE 'ai\_agent%' AND p.proname <> 'ai_agent_grant_common_roles'
        AND p.proname NOT LIKE 'ai\_agent\_answer%') LOOP
    IF f.nspname = 'platform' THEN
      v_expected_fn := v_expected_fn + 1;
    END IF;
    -- Определитель с пустым search_path (кроме чистых SQL-функций масок и т. п., которые тоже закреплены).
    IF f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR has_function_privilege('anon', f.oid, 'EXECUTE') OR has_function_privilege('supabase_auth_admin', f.oid, 'EXECUTE')
      OR has_function_privilege('evo_ai_agent', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'a317_verify_function: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform_private' AND (has_function_privilege('authenticated', f.oid, 'EXECUTE')
      OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'a317_verify_helper_grant: %', f.proname USING ERRCODE = '55000';
    END IF;
    IF f.nspname = 'platform' THEN
      IF NOT f.prosecdef THEN
        RAISE EXCEPTION 'a317_verify_definer: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
        OR has_function_privilege('service_role', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a317_verify_staff_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
      IF f.proname NOT LIKE 'ai\_agents\_%\_v1' AND (NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', f.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'a317_verify_service_grant: %', f.proname USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE p.proname LIKE 'ai\_agents\_%\_v1'),
    count(*) FILTER (WHERE p.proname NOT LIKE 'ai\_agents\_%\_v1')
  INTO v_staff, v_service
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'platform' AND (p.proname LIKE 'ai\_agents\_%\_v1' OR p.proname LIKE 'ai\_agent\_runtime\_%'
    OR p.proname LIKE 'ai\_agent\_mcp\_%' OR p.proname LIKE 'ai\_agent\_tool\_%');
  -- 9 функций сотрудника; 14 рантайма (с авторизацией WhatsApp), 3 MCP и 24 инструмента.
  IF v_staff <> 9 OR v_service <> 14 + 3 + 24 THEN
    RAISE EXCEPTION 'a317_verify_counts: % / %', v_staff, v_service USING ERRCODE = '55000';
  END IF;
  -- Журнал: ровно 11 действий и 3 типа добавлены, прежние списки целы, обёртки закрыты.
  IF cardinality(platform_private.p7a_safe_audit_actions())
      <> cardinality(platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()) + 11
    OR cardinality(platform_private.p7a_safe_audit_resource_types())
      <> cardinality(platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()) + 3
    OR NOT ('ai.agent.config.change' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('ai.agent.document.read' = ANY (platform_private.p7a_safe_audit_actions()))
    OR NOT ('ai_agent_draft' = ANY (platform_private.p7a_safe_audit_resource_types()))
    OR 'ai.agent.config.change' = ANY (platform_private.p7a_safe_audit_actions_pre_ai_agents_managed())
    OR NOT ('client' = ANY (platform_private.p7a_safe_audit_resource_types_pre_ai_agents_managed()))
    OR NOT ('case.direction.set' = ANY (platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()))
    OR has_function_privilege('authenticated', 'platform_private.p7a_safe_audit_actions()'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('anon', 'platform_private.p7a_safe_audit_resource_types()'::REGPROCEDURE, 'EXECUTE')
    OR has_function_privilege('service_role',
      'platform_private.p7a_safe_audit_actions_pre_ai_agents_managed()'::REGPROCEDURE, 'EXECUTE') THEN
    RAISE EXCEPTION 'a317_verify_allowlist' USING ERRCODE = '55000';
  END IF;
  -- Авторизация: вид ai_agent разрешён, страж пересоздан и закрыт.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid = 'platform.manual_send_authorizations'::REGCLASS
      AND c.conname = 'manual_send_authorizations_kind_check' AND pg_get_constraintdef(c.oid) LIKE '%ai_agent%')
    OR has_function_privilege('authenticated', 'platform_private.guard_ai_autosend_authorization()'::REGPROCEDURE, 'EXECUTE') THEN
    RAISE EXCEPTION 'a317_verify_authorization' USING ERRCODE = '55000';
  END IF;
END
$a317_verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
