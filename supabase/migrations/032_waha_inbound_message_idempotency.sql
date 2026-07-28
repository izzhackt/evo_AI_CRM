-- ============================================================
-- 032_waha_inbound_message_idempotency.sql
--
-- WAHA inbound message shadow identifiers for EVO Inbox.
--
-- `messages.message_id` is shared with the legacy Meta Cloud path and is not
-- unique in this schema. WAHA inbound delivery therefore gets provider-specific
-- nullable shadow columns plus a partial unique index. Existing messages remain
-- untouched; only rows written by the WAHA inbound service populate these
-- columns.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS waha_session_name text,
  ADD COLUMN IF NOT EXISTS waha_message_id text;

COMMENT ON COLUMN messages.waha_session_name IS
  'WAHA session that delivered this inbound message. Null for non-WAHA messages.';
COMMENT ON COLUMN messages.waha_message_id IS
  'Raw WAHA payload.id for inbound webhook idempotency. Null for non-WAHA messages.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_waha_session_message_id
  ON messages (waha_session_name, waha_message_id)
  WHERE waha_session_name IS NOT NULL AND waha_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_waha_session
  ON messages (waha_session_name)
  WHERE waha_session_name IS NOT NULL;
