-- ============================================================
-- 037_operator_drafts_and_waha_outbox.sql
--
-- Durable audit and provider acknowledgement boundary for the
-- controlled EVO Inbox manual-outbound proof.
--
-- Existing messages remain valid: every new provider field is
-- nullable except the zero-valued attempt counter. Provider and audit
-- evidence becomes server-write-only; account members retain read access.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- The composite key lets the draft table enforce that its account and
-- conversation belong together instead of relying only on route checks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_id_account_id
  ON conversations (id, account_id);

CREATE TABLE IF NOT EXISTS ai_drafts (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id           uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL,
  created_by           uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider             text NOT NULL,
  model                text NOT NULL,
  content_text         text NOT NULL,
  knowledge_chunk_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  knowledge_item_count integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_drafts_conversation_account_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations (id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT ai_drafts_knowledge_item_count_check
    CHECK (
      knowledge_item_count >= 0
      AND knowledge_item_count = cardinality(knowledge_chunk_ids)
    )
);

COMMENT ON TABLE ai_drafts IS
  'Append-only audit of AI drafts generated for an EVO Inbox operator.';
COMMENT ON COLUMN ai_drafts.created_by IS
  'Authenticated operator who requested the draft.';
COMMENT ON COLUMN ai_drafts.knowledge_chunk_ids IS
  'Exact knowledge chunks supplied as grounding evidence.';

CREATE INDEX IF NOT EXISTS idx_ai_drafts_account_conversation_created
  ON ai_drafts (account_id, conversation_id, created_at DESC, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_drafts_id_conversation_id
  ON ai_drafts (id, conversation_id);

ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_drafts_select ON ai_drafts;
CREATE POLICY ai_drafts_select
  ON ai_drafts
  FOR SELECT
  USING (is_account_member(account_id));

-- Authenticated members can inspect their account's audit history, but only
-- the already-authorized server service may append a draft record.
REVOKE INSERT, UPDATE, DELETE ON TABLE ai_drafts FROM anon, authenticated;
GRANT SELECT ON TABLE ai_drafts TO authenticated;
GRANT SELECT, INSERT ON TABLE ai_drafts TO service_role;
REVOKE UPDATE, DELETE ON TABLE ai_drafts FROM service_role;

CREATE OR REPLACE FUNCTION prevent_append_only_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS ai_drafts_immutable ON ai_drafts;
CREATE TRIGGER ai_drafts_immutable
  BEFORE UPDATE OR DELETE ON ai_drafts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_append_only_row_mutation();

-- ============================================================
-- Existing messages become the durable manual-send outbox.
-- messages.id is the client-generated request UUID and concurrency key.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_draft_id uuid,
  ADD COLUMN IF NOT EXISTS outbound_state text,
  ADD COLUMN IF NOT EXISTS outbound_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outbound_error_code text,
  ADD COLUMN IF NOT EXISTS outbound_error text,
  ADD COLUMN IF NOT EXISTS outbound_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS outbound_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS waha_chat_id text,
  ADD COLUMN IF NOT EXISTS waha_ack integer,
  ADD COLUMN IF NOT EXISTS waha_ack_name text,
  ADD COLUMN IF NOT EXISTS waha_ack_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_ai_draft_conversation_fkey'
      AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_ai_draft_conversation_fkey
      FOREIGN KEY (ai_draft_id, conversation_id)
      REFERENCES ai_drafts (id, conversation_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_outbound_state_check,
  DROP CONSTRAINT IF EXISTS messages_outbound_attempt_count_check,
  DROP CONSTRAINT IF EXISTS messages_waha_ack_check,
  DROP CONSTRAINT IF EXISTS messages_waha_ack_name_check,
  DROP CONSTRAINT IF EXISTS messages_waha_ack_pair_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_outbound_state_check
    CHECK (
      outbound_state IN (
        'queued',
        'dispatching',
        'accepted',
        'rejected',
        'unknown'
      )
    ),
  ADD CONSTRAINT messages_outbound_attempt_count_check
    CHECK (outbound_attempt_count >= 0),
  ADD CONSTRAINT messages_waha_ack_check
    CHECK (waha_ack BETWEEN -1 AND 4),
  ADD CONSTRAINT messages_waha_ack_name_check
    CHECK (
      waha_ack_name IN ('ERROR', 'PENDING', 'SERVER', 'DEVICE', 'READ', 'PLAYED')
    ),
  ADD CONSTRAINT messages_waha_ack_pair_check
    CHECK (
      (waha_ack IS NULL AND waha_ack_name IS NULL)
      OR (waha_ack = -1 AND waha_ack_name = 'ERROR')
      OR (waha_ack = 0 AND waha_ack_name = 'PENDING')
      OR (waha_ack = 1 AND waha_ack_name = 'SERVER')
      OR (waha_ack = 2 AND waha_ack_name = 'DEVICE')
      OR (waha_ack = 3 AND waha_ack_name = 'READ')
      OR (waha_ack = 4 AND waha_ack_name = 'PLAYED')
    );

COMMENT ON COLUMN messages.ai_draft_id IS
  'Optional immutable AI draft audit that the operator used or edited.';
COMMENT ON COLUMN messages.outbound_state IS
  'Durable WAHA dispatch phase: queued, dispatching, accepted, rejected, or unknown.';
COMMENT ON COLUMN messages.outbound_attempt_count IS
  'Number of provider dispatch attempts. Manual sends are never retried automatically.';
COMMENT ON COLUMN messages.outbound_error_code IS
  'Stable local/provider error category without secret response material.';
COMMENT ON COLUMN messages.outbound_error IS
  'Sanitized last provider-dispatch error for operator review.';
COMMENT ON COLUMN messages.waha_chat_id IS
  'Stable WAHA chat id used with waha_message_id for read-only reconciliation.';
COMMENT ON COLUMN messages.waha_ack IS
  'Authoritative WAHA acknowledgement after terminal-aware progression.';
COMMENT ON COLUMN messages.waha_ack_name IS
  'Canonical name corresponding to waha_ack.';

-- Migration 017 allowed account agents to modify any messages row directly.
-- That would let a browser forge or delete operator/provider audit evidence.
-- Current application writes already use a server-side service-role client,
-- so authenticated members keep read access only.
DROP POLICY IF EXISTS "Users can view own messages" ON messages;
DROP POLICY IF EXISTS "Service role can insert messages" ON messages;
DROP POLICY IF EXISTS messages_modify ON messages;
DROP POLICY IF EXISTS messages_select ON messages;

CREATE POLICY messages_select
  ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM conversations AS c
      WHERE c.id = messages.conversation_id
        AND is_account_member(c.account_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE messages
  FROM anon, authenticated;
GRANT SELECT ON TABLE messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE messages TO service_role;

CREATE INDEX IF NOT EXISTS idx_messages_waha_outbound_reconcile
  ON messages (outbound_state, waha_session_name, waha_message_id)
  WHERE
    waha_message_id IS NOT NULL
    AND waha_chat_id IS NOT NULL
    AND outbound_state IN ('accepted', 'unknown')
    AND (waha_ack IS NULL OR waha_ack < 3);

-- ============================================================
-- Immutable provider acknowledgement evidence.
-- ============================================================

CREATE TABLE IF NOT EXISTS waha_message_ack_events (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id         uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  waha_session_name  text NOT NULL,
  waha_message_id    text NOT NULL,
  ack                integer NOT NULL CHECK (ack BETWEEN -1 AND 4),
  ack_name           text NOT NULL
                       CHECK (ack_name IN (
                         'ERROR',
                         'PENDING',
                         'SERVER',
                         'DEVICE',
                         'READ',
                         'PLAYED'
                       )),
  source             text NOT NULL CHECK (source IN ('webhook', 'reconciliation')),
  provider_event_id  text,
  occurred_at        timestamptz NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waha_message_ack_events_ack_pair_check
    CHECK (
      (ack = -1 AND ack_name = 'ERROR')
      OR (ack = 0 AND ack_name = 'PENDING')
      OR (ack = 1 AND ack_name = 'SERVER')
      OR (ack = 2 AND ack_name = 'DEVICE')
      OR (ack = 3 AND ack_name = 'READ')
      OR (ack = 4 AND ack_name = 'PLAYED')
    ),
  CONSTRAINT waha_message_ack_events_scope_ack_key
    UNIQUE (account_id, waha_session_name, waha_message_id, ack)
);

COMMENT ON TABLE waha_message_ack_events IS
  'Append-only, duplicate-safe evidence of WAHA acknowledgement states.';

CREATE INDEX IF NOT EXISTS idx_waha_message_ack_events_message_recorded
  ON waha_message_ack_events (message_id, recorded_at, id);

ALTER TABLE waha_message_ack_events ENABLE ROW LEVEL SECURITY;

-- No authenticated policy exists. The signed webhook and cron route can write
-- only through record_waha_message_ack, whose account/session/provider lookup
-- scopes the affected message before inserting evidence.
REVOKE ALL ON TABLE waha_message_ack_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE waha_message_ack_events TO service_role;

DROP TRIGGER IF EXISTS waha_message_ack_events_immutable
  ON waha_message_ack_events;
CREATE TRIGGER waha_message_ack_events_immutable
  BEFORE UPDATE OR DELETE ON waha_message_ack_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_append_only_row_mutation();

CREATE OR REPLACE FUNCTION record_waha_message_ack(
  p_account_id uuid,
  p_session_name text,
  p_waha_message_id text,
  p_ack integer,
  p_ack_name text,
  p_ack_at timestamptz,
  p_source text DEFAULT 'webhook',
  p_provider_event_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
  v_ack_name text;
  v_ack_at timestamptz := COALESCE(p_ack_at, now());
BEGIN
  IF p_account_id IS NULL
    OR NULLIF(btrim(p_session_name), '') IS NULL
    OR NULLIF(btrim(p_waha_message_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'WAHA acknowledgement scope is incomplete'
      USING ERRCODE = '22023';
  END IF;

  v_ack_name := CASE p_ack
    WHEN -1 THEN 'ERROR'
    WHEN 0 THEN 'PENDING'
    WHEN 1 THEN 'SERVER'
    WHEN 2 THEN 'DEVICE'
    WHEN 3 THEN 'READ'
    WHEN 4 THEN 'PLAYED'
    ELSE NULL
  END;

  IF v_ack_name IS NULL OR upper(btrim(p_ack_name)) <> v_ack_name THEN
    RAISE EXCEPTION 'Invalid WAHA acknowledgement pair'
      USING ERRCODE = '22023';
  END IF;

  IF p_source NOT IN ('webhook', 'reconciliation') THEN
    RAISE EXCEPTION 'Invalid WAHA acknowledgement source'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.id
  INTO v_message_id
  FROM messages AS m
  JOIN conversations AS c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
    AND m.waha_session_name = p_session_name
    AND m.waha_message_id = p_waha_message_id
  FOR UPDATE OF m;

  IF v_message_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO waha_message_ack_events (
    account_id,
    message_id,
    waha_session_name,
    waha_message_id,
    ack,
    ack_name,
    source,
    provider_event_id,
    occurred_at
  ) VALUES (
    p_account_id,
    v_message_id,
    p_session_name,
    p_waha_message_id,
    p_ack,
    v_ack_name,
    p_source,
    NULLIF(btrim(p_provider_event_id), ''),
    v_ack_at
  )
  ON CONFLICT (account_id, waha_session_name, waha_message_id, ack)
  DO NOTHING;

  UPDATE messages AS m
  SET
    waha_ack = p_ack,
    waha_ack_name = v_ack_name,
    waha_ack_at = v_ack_at,
    status = CASE
      WHEN p_ack >= 3 THEN 'read'
      WHEN p_ack = 2 AND m.status <> 'read' THEN 'delivered'
      WHEN p_ack = 1 AND m.status IN ('sending', 'failed') THEN 'sent'
      WHEN p_ack = -1 AND m.status IN ('sending', 'sent', 'failed') THEN 'failed'
      ELSE m.status
    END,
    outbound_state = CASE
      WHEN p_ack >= 0
        AND m.outbound_state IN ('queued', 'dispatching', 'unknown')
        THEN 'accepted'
      WHEN p_ack = -1
        AND m.outbound_state IN (
          'queued',
          'dispatching',
          'unknown',
          'accepted'
        )
        THEN 'rejected'
      ELSE m.outbound_state
    END,
    outbound_completed_at = CASE
      WHEN m.outbound_state IN ('queued', 'dispatching', 'unknown')
        THEN COALESCE(m.outbound_completed_at, v_ack_at)
      ELSE m.outbound_completed_at
    END
  WHERE m.id = v_message_id
    AND (
      m.waha_ack IS NULL
      OR (p_ack = -1 AND m.waha_ack = 0)
      OR (p_ack >= 0 AND m.waha_ack >= 0 AND p_ack > m.waha_ack)
    );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION record_waha_message_ack(
  uuid,
  text,
  text,
  integer,
  text,
  timestamptz,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION record_waha_message_ack(
  uuid,
  text,
  text,
  integer,
  text,
  timestamptz,
  text,
  text
) TO service_role;
