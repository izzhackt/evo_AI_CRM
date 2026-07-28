-- ============================================================
-- 033_waha_manual_outbound_status.sql
--
-- WAHA manual outbound provider-result shadow state for EVO Inbox.
--
-- WAHA can accept POST /api/sendText without returning a stable provider id.
-- Keep the id columns nullable and store an explicit provider status so the
-- operator path does not invent message ids after an accepted send.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS waha_message_status text;

COMMENT ON COLUMN messages.waha_message_status IS
  'WAHA provider result for manual send, e.g. accepted or accepted_without_id. Null for non-WAHA messages.';
