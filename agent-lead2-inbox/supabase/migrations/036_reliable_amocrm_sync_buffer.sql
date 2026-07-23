-- ============================================================
-- 036_reliable_amocrm_sync_buffer.sql
--
-- Keep inbound WhatsApp durable even when amoCRM is missing or down.
-- Supabase remains a local inbox buffer; amoCRM remains canonical for
-- contact/lead identity after sync succeeds.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS crm_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS crm_sync_error text,
  ADD COLUMN IF NOT EXISTS crm_sync_attempted_at timestamptz;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_crm_sync_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_crm_sync_status_check
  CHECK (crm_sync_status IN ('pending', 'synced', 'not_configured', 'blocked'));

COMMENT ON COLUMN conversations.crm_sync_status IS
  'Local amoCRM sync state. Supabase buffers inbox messages; amoCRM remains canonical when this is synced.';
COMMENT ON COLUMN conversations.crm_sync_error IS
  'Last amoCRM sync error shown to operators for pending, not_configured, or blocked rows.';
COMMENT ON COLUMN conversations.crm_sync_attempted_at IS
  'Last time EVO Inbox attempted to sync this conversation to amoCRM.';

UPDATE conversations
SET
  crm_sync_status = CASE
    WHEN amo_lead_id IS NOT NULL THEN 'synced'
    ELSE crm_sync_status
  END,
  crm_sync_error = CASE
    WHEN amo_lead_id IS NOT NULL THEN NULL
    ELSE crm_sync_error
  END,
  crm_sync_attempted_at = COALESCE(crm_sync_attempted_at, amo_lead_synced_at)
WHERE amo_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_account_crm_sync_retry
  ON conversations (
    account_id,
    crm_sync_status,
    crm_sync_attempted_at ASC NULLS FIRST,
    updated_at ASC NULLS FIRST,
    id
  )
  WHERE crm_sync_status IN ('pending', 'not_configured');

CREATE INDEX IF NOT EXISTS idx_conversations_account_crm_sync_blocked
  ON conversations (account_id, crm_sync_status, updated_at DESC NULLS LAST, id)
  WHERE crm_sync_status = 'blocked';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS crm_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS crm_sync_error text,
  ADD COLUMN IF NOT EXISTS crm_sync_attempted_at timestamptz;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_crm_sync_status_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_crm_sync_status_check
  CHECK (crm_sync_status IN ('pending', 'synced', 'not_configured', 'blocked'));

COMMENT ON COLUMN messages.crm_sync_status IS
  'amoCRM sync state inherited from the conversation when this message was last processed.';
COMMENT ON COLUMN messages.crm_sync_error IS
  'Last amoCRM sync error attached to this message for operator visibility.';
COMMENT ON COLUMN messages.crm_sync_attempted_at IS
  'Last time EVO Inbox attempted to sync this message conversation to amoCRM.';

UPDATE messages AS m
SET
  crm_sync_status = c.crm_sync_status,
  crm_sync_error = c.crm_sync_error,
  crm_sync_attempted_at = c.crm_sync_attempted_at
FROM conversations AS c
WHERE m.conversation_id = c.id
  AND c.crm_sync_status = 'synced';

CREATE INDEX IF NOT EXISTS idx_messages_conversation_crm_sync_status
  ON messages (conversation_id, crm_sync_status, created_at, id);
