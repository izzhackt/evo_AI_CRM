-- ============================================================
-- 034_ai_gemini_provider.sql — Gemini provider for AI drafts
--
-- Adds Google Gemini as a first-class BYO-key provider for the
-- account-level AI assistant. The key stays in `ai_configs.api_key`
-- and remains AES-256-GCM-encrypted by the application, same as the
-- existing OpenAI and Anthropic providers.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'gemini'));
