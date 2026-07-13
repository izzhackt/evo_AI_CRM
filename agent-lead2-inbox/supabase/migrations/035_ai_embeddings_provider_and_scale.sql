-- ============================================================
-- 035_ai_embeddings_provider_and_scale.sql
--
-- Issue #27: explicit knowledge retrieval provider selection plus
-- first production-scale indexes for EVO Inbox conversation/message
-- growth. Idempotent; safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS embeddings_provider text NOT NULL DEFAULT 'keyword';

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_embeddings_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_embeddings_provider_check
  CHECK (embeddings_provider IN ('keyword', 'gemini', 'openai'));

COMMENT ON COLUMN ai_configs.embeddings_provider IS
  'Knowledge retrieval mode: keyword-only fallback, Gemini embeddings, or OpenAI embeddings. Semantic provider keys remain encrypted in api_key or embeddings_api_key.';

-- Inbox list: account-scoped conversation ordering by newest activity.
CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message
  ON conversations (
    account_id,
    last_message_at DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    id
  );

-- Message timeline: fetch one conversation in chronological order.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON messages (conversation_id, created_at, id);
