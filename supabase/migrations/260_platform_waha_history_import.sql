-- ============================================================
-- 260_platform_waha_history_import.sql
--
-- WhatsApp history import, database lane (part 1 of 2). After the sales phone is
-- paired, WAHA stores the synced history and serves it over its REST API; it is
-- NOT pushed as webhooks. This migration adds the service-only RPCs that project
-- a bounded, fixed time window of that history into the CRM so the Inbox shows
-- it exactly like live messages. No provider call, no send and no production
-- action: the REST client (part 2) is a separate change.
--
-- Trust. History read over the REST API is not HMAC-verified and is never made to
-- look verified. Each message is kept as its own evidence row:
--   provider_webhook_events.event_type = 'history.message',
--   verification_status = 'missing',
--   verification_headers = {provenance: 'api_history', webhook_verified: false,
--     read_only: true, engine, run_id, window_from, window_to, lead_mode},
--   evidence_ref = 'api-history-read:<run_id>'.
-- It cannot collide with a live `message.any` of the same raw id (the business key
-- includes the event type), so a later real delivery is never refused. Imported
-- messages, in BOTH directions, carry message_identity_source
-- 'private_waha_history_binding'; 'private_waha_phone_binding' stays reserved for
-- a verified fromMe/source=app webhook event and migration 259's forgery guard is
-- untouched. The history provenance branch that migration 082 dropped from
-- require_private_waha_message_binding is restored (DB-level proof that a history
-- row has a history.message / missing / api_history source and an observation).
--
-- What the import creates. A direct chat (`@c.us` or `@lid`) with at least one
-- customer INBOUND message in the window gets one conversation shaped exactly
-- like a live one (record scope, intake assignment, customer and sales
-- participants, private direct-chat binding) holding every window message of the
-- chat in both directions, with the WhatsApp message times as created_at and the
-- conversation created/updated from those times (not from the import time), so
-- the Inbox orders it by its real last message. A chat with only our own messages
-- in the window is skipped by default (run option include_outbound_only). Groups,
-- Status, broadcast lists and channels never reach the lane. Media is the same
-- typed marker as live (platform_private.waha_message_content), never downloaded,
-- and no staff handoff is created for it. The import creates NO client and NO
-- lead, and never uses the verified-webhook identity path.
--
-- Promotion. A customer who writes again after go-live in an imported chat is a
-- lead like any new chat: the live projection, on a verified inbound message of a
-- conversation with a history binding and no client or lead, acquires the same
-- canonical client and lead a new live chat gets (run option lead_mode 'promote',
-- the default; 'none' keeps imported chats conversation-only). The identity
-- evidence is the live verified event, never the history row. The three lead
-- readers that required a verified-inbound binding source also accept the
-- history source, so the promoted lead lists its conversation. Promotion runs
-- only after the live inbound message passed its conflict check and is stored,
-- and never blocks live ingestion: the lead owner is the imported owner while
-- still eligible, else the live intake member, else promotion is skipped and the
-- message stays stored (result key identity_promotion_skipped). (The alternative,
-- a staging map that adopts imported messages at the first live message, would
-- add a table and block replies until adoption; this change is smaller.)
--
-- Live/import overlap (tolerance patches to migration 259's functions, with
-- single-occurrence and protected-contract guards, the pattern 259 itself uses):
--   * a live fromMe/source=app event whose raw id was imported is a duplicate, not
--     a terminal waha_outbound_conflict;
--   * a live inbound whose raw id was imported is accepted without a body check
--     (a REST body may lack what the typed marker needs);
--   * an import page skips raw ids already bound (live first, or an earlier run),
--     counts them and never aborts;
--   * the import takes the SAME per-chat advisory lock keys as the live
--     projection, for every form (LID and phone) of the chat.
-- Every imported row is also written under one history.message evidence row per
-- raw id, so a re-run (same or another run) adds nothing.
--
-- Operational limits (documented, not hidden): the import cannot be rolled back
-- inside the app (messages, bindings and conversations are append-only), so the
-- importer must dry-run first (platform.preview_waha_history_window_chat returns
-- counts only) and pilot a few chats; window_to must not be later than the first
-- CRM-sent message of the session (a CRM API send read back from history before
-- its own binding exists would be imported as a staff message and then block that
-- send's binding); the first page of a chat must contain its first inbound
-- message; history depth and field parity with webhooks are WAHA properties that
-- need one real sample per engine.
--
-- The v1 history routines (061/102) are c.us-only, use another advisory-lock
-- namespace, keep only normalized fields and abort on overlap; they are
-- superseded and their service_role EXECUTE is revoked so that only this lane is
-- callable. Nothing in the application calls them (their client was removed).
--
-- Written against migration 259 as of PR #1137 head 362fff638; if that
-- migration changes, the needle guards below fail closed instead of patching a
-- different definition, and the two routines this migration replaces wholesale
-- (require_private_waha_message_binding, bind_waha_chat_to_canonical) are pinned
-- by the md5 of their 259 source and refuse to be replaced if it differs.
--
-- The run options must name the own account (`me`, at least its id): the own
-- number is never imported as a customer chat.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Schema: a window run, and @lid chats in the observation table.
-- ------------------------------------------------------------

-- A window run is a v1 run plus its fixed window and options (immutable evidence;
-- the append-only trigger blocks updates, so the columns are set at insert).
ALTER TABLE platform_private.waha_history_reconciliation_runs
  ADD COLUMN window_from TIMESTAMPTZ,
  ADD COLUMN window_to TIMESTAMPTZ,
  ADD COLUMN options JSONB,
  ADD CONSTRAINT waha_history_reconciliation_runs_window_check CHECK (
    (window_from IS NULL AND window_to IS NULL AND options IS NULL)
    OR (
      window_from IS NOT NULL
      AND window_to IS NOT NULL
      AND window_to > window_from
      AND jsonb_typeof(options) = 'object'
    )
  );

ALTER TABLE platform_private.waha_history_message_observations
  DROP CONSTRAINT waha_history_message_observations_normalized_chat_id_check,
  ADD CONSTRAINT waha_history_message_observations_normalized_chat_id_check CHECK (
    normalized_chat_id ~ '^[0-9]+@c[.]us$'
    OR normalized_chat_id ~ '^[0-9]{5,32}@lid$'
  );

-- ------------------------------------------------------------
-- 2. Provenance guard: restore the history branch, keep migration 259's
--    phone-sent forgery guard byte for byte.
-- ------------------------------------------------------------

DO $provenance_guard$
DECLARE
  target CONSTANT REGPROCEDURE :=
    'platform_private.require_private_waha_message_binding()'::REGPROCEDURE;
  before_contract RECORD;
  after_contract RECORD;
BEGIN
  -- This routine is replaced wholesale below, so its pre-image is pinned: the
  -- body must be exactly the one migration 259 left (PR #1137 head 362fff638).
  -- If 259's forgery guard is edited later, this fails closed instead of the
  -- edit being silently overwritten: re-derive the replacement from the new 259
  -- and update the digest in the same change.
  IF (
    SELECT pg_catalog.md5(routine.prosrc)
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = target::OID
  ) IS DISTINCT FROM '7160e60decbaae5db0885b8bdd06c6d9' THEN
    RAISE EXCEPTION
      'Migration 260 replaces require_private_waha_message_binding(), which is not the migration 259 definition it was written against; re-derive it from the current definition'
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO before_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION platform_private.require_private_waha_message_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.message_identity_source IN (
      'private_waha_binding',
      'private_waha_phone_binding'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id
       AND source_event.id = binding.source_webhook_event_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND binding.waha_session_name = 'crm_primary'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:crm_primary'
        AND source_event.waha_session_name = 'crm_primary'
        AND source_event.payload_id = binding.raw_message_id
        AND (
          NEW.message_identity_source = 'private_waha_binding'
          OR (
            source_event.verification_status = 'verified'
            AND source_event.event_type IN ('message', 'message.any')
            AND source_event.raw_payload -> 'payload' -> 'fromMe'
              = 'true'::JSONB
            AND lower(
              COALESCE(
                btrim(source_event.raw_payload -> 'payload' ->> 'source'),
                ''
              )
            ) = 'app'
          )
        )
    )
  THEN
    RAISE EXCEPTION
      'A private WAHA message requires its exact canonical provider binding'
      USING ERRCODE = '23514';
  END IF;

  -- A history message needs explicit read-only API provenance and its private
  -- observation. It can never satisfy the phone-sent branch above: that one
  -- requires a VERIFIED webhook event.
  IF NEW.message_identity_source = 'private_waha_history_binding'
    AND NOT EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS binding
      JOIN platform_private.provider_webhook_events AS source_event
        ON source_event.organization_id = binding.organization_id
       AND source_event.id = binding.source_webhook_event_id
      JOIN platform_private.waha_history_message_observations AS observation
        ON observation.organization_id = binding.organization_id
       AND observation.source_event_id = binding.source_webhook_event_id
       AND observation.communication_message_id = binding.communication_message_id
      WHERE binding.organization_id = NEW.organization_id
        AND binding.communication_message_id = NEW.id
        AND binding.source_webhook_event_id = NEW.source_webhook_event_id
        AND binding.waha_session_name = 'crm_primary'
        AND source_event.provider = 'waha'
        AND source_event.provider_account_ref = 'waha:crm_primary'
        AND source_event.waha_session_name = 'crm_primary'
        AND source_event.event_type = 'history.message'
        AND source_event.payload_id = binding.raw_message_id
        AND source_event.verification_status = 'missing'
        AND source_event.verification_headers ->> 'provenance' = 'api_history'
        AND source_event.verification_headers -> 'webhook_verified'
          = 'false'::JSONB
        AND source_event.verification_headers -> 'read_only' = 'true'::JSONB
        AND observation.waha_session_name = binding.waha_session_name
        AND observation.raw_message_id = binding.raw_message_id
    )
  THEN
    RAISE EXCEPTION
      'A history WAHA message requires explicit read-only API provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$
  $definition$;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO after_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  IF after_contract IS DISTINCT FROM before_contract THEN
    RAISE EXCEPTION
      'Migration 260 changed a protected routine contract'
      USING ERRCODE = '55000';
  END IF;
END
$provenance_guard$;

COMMENT ON COLUMN platform.communication_messages.message_identity_source IS
  'Immutable provenance: public provider id, signed inbound private WAHA binding, a private WAHA history binding (read-only REST history, never a verified webhook, either direction; proven by a history.message / missing / api_history evidence row and its observation), or a message the sales team sent from the phone/app (private_waha_phone_binding, evidenced by a verified fromMe event with source app).';

-- ------------------------------------------------------------
-- 3. Private helpers (definer, empty search_path, executable by no client role).
-- ------------------------------------------------------------

CREATE FUNCTION platform_private.waha_history_text(
  p_value JSONB,
  p_max INTEGER
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) = 'string' THEN left(p_value #>> '{}', p_max)
  END
$$;

-- The run options, validated and normalised: a closed set of keys, so a typo is
-- refused instead of silently ignored. `me` is the session's own account
-- (GET /api/sessions/<name> `me`: `id`, `lid`, `jid`) and is REQUIRED (at least its
-- id): with it the own number is never a customer and never a customer's phone,
-- exactly as for live events.
CREATE FUNCTION platform_private.normalize_waha_history_options(
  p_options JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  options JSONB := COALESCE(p_options, '{}'::JSONB);
  include_outbound_only BOOLEAN := FALSE;
  lead_mode TEXT := 'promote';
  me JSONB := NULL;
  me_key TEXT;
  me_value TEXT;
BEGIN
  IF jsonb_typeof(options) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(options) AS option_key(value)
      WHERE option_key.value NOT IN ('include_outbound_only', 'lead_mode', 'me')
    )
  THEN
    RAISE EXCEPTION
      'History options must be an object with include_outbound_only, lead_mode and me only'
      USING ERRCODE = '22023';
  END IF;

  IF options ? 'include_outbound_only' THEN
    IF jsonb_typeof(options -> 'include_outbound_only') <> 'boolean' THEN
      RAISE EXCEPTION 'include_outbound_only must be a boolean'
        USING ERRCODE = '22023';
    END IF;
    include_outbound_only := (options ->> 'include_outbound_only')::BOOLEAN;
  END IF;

  IF options ? 'lead_mode' THEN
    IF jsonb_typeof(options -> 'lead_mode') <> 'string'
      OR options ->> 'lead_mode' NOT IN ('promote', 'none')
    THEN
      RAISE EXCEPTION 'lead_mode must be promote or none'
        USING ERRCODE = '22023';
    END IF;
    lead_mode := options ->> 'lead_mode';
  END IF;

  -- The own account is REQUIRED: without it the own number could be imported as
  -- a customer chat. The importer always reads it from the session.
  IF NOT (options ? 'me')
    OR jsonb_typeof(options -> 'me') <> 'object'
    OR NOT (options -> 'me' ? 'id')
  THEN
    RAISE EXCEPTION 'me (the own account, at least its id) is required'
      USING ERRCODE = '22023';
  END IF;

  IF options ? 'me' AND jsonb_typeof(options -> 'me') <> 'null' THEN
    IF jsonb_typeof(options -> 'me') <> 'object' THEN
      RAISE EXCEPTION 'me must be an object' USING ERRCODE = '22023';
    END IF;
    me := '{}'::JSONB;
    FOR me_key IN SELECT me_entry.value FROM jsonb_object_keys(options -> 'me') AS me_entry(value)
    LOOP
      me_value := options -> 'me' ->> me_key;
      IF me_key NOT IN ('id', 'lid', 'jid')
        OR jsonb_typeof(options -> 'me' -> me_key) <> 'string'
        OR me_value !~ '^[0-9]{5,32}(:[0-9]{1,5})?@(c[.]us|lid|s[.]whatsapp[.]net)$'
      THEN
        RAISE EXCEPTION 'me may name only the own id, lid and jid'
          USING ERRCODE = '22023';
      END IF;
      me := me || jsonb_build_object(me_key, me_value);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'include_outbound_only', include_outbound_only,
    'lead_mode', lead_mode,
    'me', me
  );
END
$$;

-- The stored copy of one WAHA REST message: ONLY the fields the projection
-- helpers read, in the shape of a webhook `payload`, so imported evidence is read
-- by migration 259's helpers like a live event. Volatile and large parts
-- (ack, quoted message, thumbnails, link previews, raw protobuf bodies) are
-- dropped; the media kind of a GOWS message survives as the presence of the
-- `_data.Message.<kind>` object (plus the voice and GIF flags). `chatId` is the
-- chat the history was read from.
CREATE FUNCTION platform_private.waha_history_allowlist_message(
  p_message JSONB,
  p_chat_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  data JSONB := CASE
    WHEN jsonb_typeof(p_message -> '_data') = 'object' THEN p_message -> '_data'
    ELSE '{}'::JSONB
  END;
  info JSONB := CASE
    WHEN jsonb_typeof(data -> 'Info') = 'object' THEN data -> 'Info'
    ELSE '{}'::JSONB
  END;
  inner_message JSONB := CASE
    WHEN jsonb_typeof(data -> 'Message') = 'object' THEN data -> 'Message'
    ELSE '{}'::JSONB
  END;
BEGIN
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'id', platform_private.waha_history_text(p_message -> 'id', 1000),
    'timestamp', CASE
      WHEN jsonb_typeof(p_message -> 'timestamp') = 'number'
        THEN p_message -> 'timestamp'
    END,
    'from', platform_private.waha_history_text(p_message -> 'from', 256),
    'to', platform_private.waha_history_text(p_message -> 'to', 256),
    'chatId', p_chat_id,
    'fromMe', CASE
      WHEN jsonb_typeof(p_message -> 'fromMe') = 'boolean' THEN p_message -> 'fromMe'
    END,
    'source', platform_private.waha_history_text(p_message -> 'source', 16),
    'body', platform_private.waha_history_text(p_message -> 'body', 100001),
    'hasMedia', CASE
      WHEN jsonb_typeof(p_message -> 'hasMedia') = 'boolean' THEN p_message -> 'hasMedia'
    END,
    'media', CASE
      WHEN jsonb_typeof(p_message -> 'media') = 'object' THEN jsonb_build_object(
        'mimetype', platform_private.waha_history_text(p_message #> '{media,mimetype}', 128),
        'filename', platform_private.waha_history_text(p_message #> '{media,filename}', 256)
      )
    END,
    '_data', jsonb_build_object(
      'type', platform_private.waha_history_text(data -> 'type', 32),
      'mimetype', platform_private.waha_history_text(data -> 'mimetype', 128),
      'filename', platform_private.waha_history_text(data -> 'filename', 256),
      'from', platform_private.waha_history_text(data -> 'from', 256),
      'to', platform_private.waha_history_text(data -> 'to', 256),
      'id', CASE
        WHEN jsonb_typeof(data -> 'id') = 'object' THEN jsonb_build_object(
          'remote', platform_private.waha_history_text(data #> '{id,remote}', 256)
        )
      END,
      'notifyName', platform_private.waha_history_text(data -> 'notifyName', 200),
      'pushName', platform_private.waha_history_text(data -> 'pushName', 200),
      'Info', jsonb_build_object(
        'Chat', platform_private.waha_history_text(info -> 'Chat', 256),
        'Sender', platform_private.waha_history_text(info -> 'Sender', 256),
        'IsFromMe', CASE
          WHEN jsonb_typeof(info -> 'IsFromMe') = 'boolean' THEN info -> 'IsFromMe'
        END,
        'SenderAlt', platform_private.waha_history_text(info -> 'SenderAlt', 256),
        'RecipientAlt', platform_private.waha_history_text(info -> 'RecipientAlt', 256),
        'PushName', platform_private.waha_history_text(info -> 'PushName', 200)
      ),
      'key', CASE
        WHEN jsonb_typeof(data -> 'key') = 'object' THEN jsonb_build_object(
          'remoteJidAlt', platform_private.waha_history_text(data #> '{key,remoteJidAlt}', 256)
        )
      END,
      'Message', jsonb_build_object(
        'stickerMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'stickerMessage') = 'object' THEN '{}'::JSONB
        END,
        'documentMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'documentMessage') = 'object' THEN '{}'::JSONB
        END,
        'audioMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'audioMessage') = 'object' THEN jsonb_build_object(
            'PTT', CASE WHEN inner_message #> '{audioMessage,PTT}' = 'true'::JSONB THEN TRUE END
          )
        END,
        'imageMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'imageMessage') = 'object' THEN '{}'::JSONB
        END,
        'videoMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'videoMessage') = 'object' THEN jsonb_build_object(
            'gifPlayback', CASE
              WHEN inner_message #> '{videoMessage,gifPlayback}' = 'true'::JSONB THEN TRUE
            END
          )
        END,
        'ptvMessage', CASE
          WHEN jsonb_typeof(inner_message -> 'ptvMessage') = 'object' THEN '{}'::JSONB
        END
      )
    )
  ));
END
$$;

-- The pure half of one history page (no table read): every message is parsed,
-- window-checked, allow-listed, given its typed body and its chat, or counted
-- under ONE skip reason. The apply and the preview RPCs both start here, so a
-- dry run classifies exactly like the import. Returns
-- {chat_id, received, skipped{...}, messages[...], lock_forms[...]}.
CREATE FUNCTION platform_private.waha_history_prepare_page(
  p_chat_id TEXT,
  p_messages JSONB,
  p_me JSONB,
  p_window_from TIMESTAMPTZ,
  p_window_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_chat TEXT;
  skipped JSONB := jsonb_build_object(
    'invalid', 0,
    'direction_unverified', 0,
    'out_of_window', 0,
    'api_source', 0,
    'crm_send', 0,
    'empty', 0,
    'own_chat', 0,
    'unsupported_chat', 0,
    'chat_mismatch', 0,
    'foreign_conversation', 0,
    'outbound_only', 0
  );
  received INTEGER := jsonb_array_length(p_messages);
  prepared JSONB[] := ARRAY[]::JSONB[];
  sorted JSONB[];
  item JSONB;
  raw_id TEXT;
  ts_text TEXT;
  ts_epoch NUMERIC;
  from_me BOOLEAN;
  occurred_at TIMESTAMPTZ;
  provider_source TEXT;
  payload JSONB;
  content JSONB;
  chat JSONB;
  reason TEXT;
  forms TEXT[];
  lock_forms JSONB;
BEGIN
  IF p_chat_id IS NOT NULL THEN
    normalized_chat := platform_private.normalize_waha_conversation_chat_id(p_chat_id);
  END IF;

  IF normalized_chat IS NULL THEN
    -- A group, Status, broadcast list or channel (or no chat at all): nothing of
    -- it is read, stored or counted by content.
    RETURN jsonb_build_object(
      'chat_id', NULL,
      'received', received,
      'skipped', jsonb_set(skipped, '{unsupported_chat}', to_jsonb(received)),
      'messages', '[]'::JSONB,
      'lock_forms', '[]'::JSONB
    );
  END IF;

  FOR item IN SELECT element.value FROM jsonb_array_elements(p_messages) AS element(value)
  LOOP
    reason := NULL;
    payload := NULL;
    content := NULL;
    chat := NULL;

    IF jsonb_typeof(item) <> 'object' THEN
      reason := 'invalid';
    ELSE
      raw_id := NULLIF(btrim(platform_private.waha_history_text(item -> 'id', 1001)), '');
      IF raw_id IS NULL OR char_length(raw_id) > 1000 THEN
        reason := 'invalid';
      ELSIF jsonb_typeof(item -> 'timestamp') IS DISTINCT FROM 'number' THEN
        reason := 'invalid';
      ELSE
        -- Unix SECONDS, as the WAHA REST API reports them; milliseconds or
        -- garbage fall outside the range and are refused, not guessed.
        ts_text := item ->> 'timestamp';
        ts_epoch := floor(ts_text::NUMERIC);
        IF ts_epoch < 1230768000 OR ts_epoch > 4102444800 THEN
          reason := 'invalid';
        ELSIF jsonb_typeof(item -> 'body') = 'string'
          AND char_length(item ->> 'body') > 100000
        THEN
          reason := 'invalid';
        END IF;
      END IF;
    END IF;

    IF reason IS NULL THEN
      IF jsonb_typeof(item -> 'fromMe') IS DISTINCT FROM 'boolean' THEN
        reason := 'direction_unverified';
      END IF;
    END IF;

    IF reason IS NULL THEN
      from_me := (item ->> 'fromMe')::BOOLEAN;
      occurred_at := to_timestamp(ts_epoch::DOUBLE PRECISION);
      provider_source := lower(COALESCE(btrim(item ->> 'source'), ''));
      IF occurred_at < p_window_from OR occurred_at > p_window_to THEN
        reason := 'out_of_window';
      ELSIF from_me AND provider_source = 'api' THEN
        -- The CRM's own API send read back from history: manual send already
        -- owns that message.
        reason := 'crm_send';
      ELSIF NOT from_me AND provider_source = 'api' THEN
        reason := 'api_source';
      END IF;
    END IF;

    IF reason IS NULL THEN
      payload := platform_private.waha_history_allowlist_message(item, normalized_chat);
      content := platform_private.waha_message_content(payload);
      IF (content ->> 'body') IS NULL THEN
        -- No text and no media: a protocol or system message, not conversation.
        reason := 'empty';
      END IF;
    END IF;

    IF reason IS NULL THEN
      chat := platform_private.resolve_waha_conversation_chat(payload, from_me, p_me);
      IF chat ->> 'error' = 'own_chat' THEN
        reason := 'own_chat';
      ELSIF chat ->> 'error' IN ('unsupported_chat', 'chat_required') THEN
        reason := 'unsupported_chat';
      ELSIF chat ? 'error' THEN
        reason := 'chat_mismatch';
      END IF;
    END IF;

    IF reason IS NOT NULL THEN
      skipped := jsonb_set(
        skipped,
        ARRAY[reason],
        to_jsonb(COALESCE((skipped ->> reason)::INTEGER, 0) + 1)
      );
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT form.value ORDER BY form.value), ARRAY[]::TEXT[])
    INTO forms
    FROM unnest(ARRAY[
      chat ->> 'chat_id',
      chat ->> 'alt_chat_id',
      chat ->> 'phone_chat_id',
      chat ->> 'lid_chat_id'
    ]) AS form(value)
    WHERE form.value IS NOT NULL;

    prepared := prepared || jsonb_build_object(
      'raw_id', raw_id,
      'ts_epoch', ts_epoch,
      'from_me', from_me,
      'payload', payload,
      'content', content,
      'chat', chat,
      'forms', to_jsonb(forms)
    );
  END LOOP;

  SELECT COALESCE(array_agg(entry.value ORDER BY (entry.value ->> 'ts_epoch')::NUMERIC,
    entry.value ->> 'raw_id'), ARRAY[]::JSONB[])
  INTO sorted
  FROM unnest(prepared) AS entry(value);

  SELECT COALESCE(jsonb_agg(DISTINCT form.value ORDER BY form.value), '[]'::JSONB)
  INTO lock_forms
  FROM unnest(sorted) AS entry(value)
  CROSS JOIN LATERAL jsonb_array_elements_text(entry.value -> 'forms') AS form(value);

  RETURN jsonb_build_object(
    'chat_id', normalized_chat,
    'received', received,
    'skipped', skipped,
    'messages', to_jsonb(sorted),
    'lock_forms', lock_forms
  );
END
$$;

-- The database half of one page: which prepared messages are already bound (live
-- first, or an earlier run), which were sent by the CRM itself, which conversation
-- the page belongs to and whether the chat is imported at all. Reads only, so the
-- preview shares it. The caller holds the chat locks when it will write.
CREATE FUNCTION platform_private.waha_history_plan_page(
  p_organization_id UUID,
  p_waha_session_name TEXT,
  p_prepared JSONB,
  p_include_outbound_only BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  skipped JSONB := p_prepared -> 'skipped';
  already_bound INTEGER := 0;
  eligible JSONB[] := ARRAY[]::JSONB[];
  kept JSONB[] := ARRAY[]::JSONB[];
  entry JSONB;
  creator JSONB;
  anchor JSONB;
  bound_chat platform_private.waha_direct_chat_bindings%ROWTYPE;
  bound_conversation platform.communication_conversations%ROWTYPE;
  page_forms TEXT[];
  outcome TEXT;
BEGIN
  IF p_prepared ->> 'chat_id' IS NULL THEN
    RETURN jsonb_build_object(
      'chat_outcome', 'skip_unsupported_chat',
      'skipped', skipped,
      'already_bound', 0,
      'eligible', '[]'::JSONB
    );
  END IF;

  FOR entry IN SELECT element.value FROM jsonb_array_elements(p_prepared -> 'messages') AS element(value)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM platform_private.waha_message_bindings AS message_binding
      WHERE message_binding.organization_id = p_organization_id
        AND message_binding.waha_session_name = p_waha_session_name
        AND message_binding.raw_message_id = entry ->> 'raw_id'
    ) THEN
      already_bound := already_bound + 1;
      CONTINUE;
    END IF;

    IF (entry -> 'from_me') = 'true'::JSONB AND EXISTS (
      SELECT 1
      FROM platform_private.manual_send_provider_bindings AS manual_binding
      WHERE manual_binding.organization_id = p_organization_id
        AND manual_binding.waha_session_name = p_waha_session_name
        AND manual_binding.raw_message_id = entry ->> 'raw_id'
    ) THEN
      skipped := jsonb_set(skipped, '{crm_send}',
        to_jsonb((skipped ->> 'crm_send')::INTEGER + 1));
      CONTINUE;
    END IF;

    eligible := eligible || entry;
  END LOOP;

  -- The chat is created by its first customer INBOUND message (or, only when the
  -- run asks for it, by its first message of any direction). The same message
  -- anchors the lookup of an existing conversation.
  FOREACH entry IN ARRAY eligible LOOP
    IF (entry -> 'from_me') = 'false'::JSONB THEN
      creator := entry;
      EXIT;
    END IF;
  END LOOP;
  IF creator IS NULL AND p_include_outbound_only AND cardinality(eligible) > 0 THEN
    creator := eligible[1];
  END IF;
  anchor := COALESCE(creator, eligible[1]);

  IF anchor IS NULL THEN
    RETURN jsonb_build_object(
      'chat_outcome', 'skip_nothing_eligible',
      'skipped', skipped,
      'already_bound', already_bound,
      'eligible', '[]'::JSONB
    );
  END IF;

  SELECT candidate.*
  INTO bound_chat
  FROM platform_private.waha_direct_chat_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.waha_session_name = p_waha_session_name
    AND candidate.normalized_chat_id = anchor #>> '{chat,chat_id}';

  IF bound_chat.id IS NULL AND (anchor #>> '{chat,alt_chat_id}') IS NOT NULL THEN
    SELECT candidate.*
    INTO bound_chat
    FROM platform_private.waha_direct_chat_bindings AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.waha_session_name = p_waha_session_name
      AND candidate.normalized_chat_id = anchor #>> '{chat,alt_chat_id}';
  END IF;

  IF bound_chat.id IS NOT NULL THEN
    SELECT candidate.*
    INTO bound_conversation
    FROM platform.communication_conversations AS candidate
    WHERE candidate.organization_id = p_organization_id
      AND candidate.id = bound_chat.conversation_id;

    IF bound_conversation.id IS NULL
      OR bound_conversation.waha_session_name <> p_waha_session_name
      OR bound_conversation.sales_authority_source <> 'platform_intake'
      OR bound_conversation.queue <> 'sales'
      OR bound_conversation.student_case_id IS NOT NULL
      OR bound_conversation.current_curator_membership_id IS NOT NULL
    THEN
      -- A conversation already moved out of the Sales intake is never written to
      -- by history (live raises there; an import must not stop on one chat).
      RETURN jsonb_build_object(
        'chat_outcome', 'skip_foreign_conversation',
        'skipped', jsonb_set(skipped, '{foreign_conversation}',
          to_jsonb(cardinality(eligible))),
        'already_bound', already_bound,
        'eligible', '[]'::JSONB
      );
    END IF;
    outcome := 'import_existing';
  ELSIF creator IS NULL THEN
    RETURN jsonb_build_object(
      'chat_outcome', 'skip_outbound_only',
      'skipped', jsonb_set(skipped, '{outbound_only}', to_jsonb(cardinality(eligible))),
      'already_bound', already_bound,
      'eligible', '[]'::JSONB
    );
  ELSE
    outcome := 'import_new';
  END IF;

  -- One page is one conversation: a message whose chat forms never meet the
  -- anchor's (or the bound chat's) is counted and left out, never given a second
  -- conversation and never an abort.
  SELECT COALESCE(array_agg(DISTINCT form.value), ARRAY[]::TEXT[])
  INTO page_forms
  FROM (
    SELECT jsonb_array_elements_text(anchor -> 'forms') AS value
    UNION ALL
    SELECT bound_chat.normalized_chat_id WHERE bound_chat.id IS NOT NULL
  ) AS form(value);

  FOREACH entry IN ARRAY eligible LOOP
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(entry -> 'forms') AS form(value)
      WHERE form.value = ANY (page_forms)
    ) THEN
      kept := kept || entry;
    ELSE
      skipped := jsonb_set(skipped, '{chat_mismatch}',
        to_jsonb((skipped ->> 'chat_mismatch')::INTEGER + 1));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'chat_outcome', outcome,
    'binding_id', bound_chat.id,
    'conversation_id', bound_chat.conversation_id,
    'creator_raw_id', creator ->> 'raw_id',
    'anchor_chat', anchor -> 'chat',
    'skipped', skipped,
    'already_bound', already_bound,
    'eligible', to_jsonb(kept)
  );
END
$$;

-- A binding whose source is a history evidence row (any direction), and the
-- stricter question the promotion asks: was it imported with lead_mode 'promote'.
-- The lead readers use the first, the live projection the second.
CREATE FUNCTION platform_private.waha_history_binding_source_ok(
  p_organization_id UUID,
  p_source_event_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.provider_webhook_events AS source_event
    WHERE source_event.organization_id = p_organization_id
      AND source_event.id = p_source_event_id
      AND source_event.provider = 'waha'
      AND source_event.provider_account_ref = 'waha:crm_primary'
      AND source_event.waha_session_name = 'crm_primary'
      AND source_event.event_type = 'history.message'
      AND source_event.verification_status = 'missing'
      AND source_event.verification_headers ->> 'provenance' = 'api_history'
      AND source_event.verification_headers -> 'webhook_verified' = 'false'::JSONB
      AND source_event.verification_headers -> 'read_only' = 'true'::JSONB
  )
$$;

CREATE FUNCTION platform_private.waha_history_binding_promotable(
  p_organization_id UUID,
  p_binding_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM platform_private.waha_direct_chat_bindings AS chat_binding
    JOIN platform_private.provider_webhook_events AS source_event
      ON source_event.organization_id = chat_binding.organization_id
     AND source_event.id = chat_binding.source_webhook_event_id
    WHERE chat_binding.organization_id = p_organization_id
      AND chat_binding.id = p_binding_id
      AND platform_private.waha_history_binding_source_ok(
        source_event.organization_id,
        source_event.id
      )
      AND source_event.verification_headers ->> 'lead_mode' = 'promote'
  )
$$;

REVOKE ALL ON FUNCTION
  platform_private.waha_history_text(JSONB, INTEGER),
  platform_private.normalize_waha_history_options(JSONB),
  platform_private.waha_history_allowlist_message(JSONB, TEXT),
  platform_private.waha_history_prepare_page(TEXT, JSONB, JSONB, TIMESTAMPTZ, TIMESTAMPTZ),
  platform_private.waha_history_plan_page(UUID, TEXT, JSONB, BOOLEAN),
  platform_private.waha_history_binding_source_ok(UUID, UUID),
  platform_private.waha_history_binding_promotable(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ------------------------------------------------------------
-- 4. Canonical identity acquisition, split so the promotion can use a LIVE
--    verified event. bind_waha_chat_to_canonical keeps its signature and its
--    trigger behaviour: it now delegates with the binding's own source event.
-- ------------------------------------------------------------

CREATE FUNCTION platform_private.acquire_waha_canonical_identity(
  p_organization_id UUID,
  p_binding_id UUID,
  p_source_event_id UUID,
  p_owner_membership_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  payload JSONB;
  chat JSONB;
  phone_digits TEXT;
  identity_chat_id TEXT;
  display_name TEXT;
  external_identity TEXT;
  source_ref TEXT;
  resolved_client_id UUID;
  resolved_lead_id UUID;
  lead_owner_membership_id UUID;
BEGIN
  IF p_organization_id IS NULL
    OR p_binding_id IS NULL
    OR p_source_event_id IS NULL
  THEN
    RAISE EXCEPTION 'WAHA canonical binding identity is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.*
  INTO binding
  FROM platform_private.waha_direct_chat_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_binding_id;

  IF binding.id IS NULL THEN
    RAISE EXCEPTION 'WAHA direct-chat binding is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = binding.organization_id
    AND event.id = p_source_event_id;

  SELECT candidate.*
  INTO conversation
  FROM platform.communication_conversations AS candidate
  WHERE candidate.organization_id = binding.organization_id
    AND candidate.id = binding.conversation_id
  FOR UPDATE;

  payload := source_event.raw_payload -> 'payload';
  IF source_event.id IS NULL OR conversation.id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical source or conversation is unavailable'
      USING ERRCODE = '23503';
  END IF;

  -- Only a verified direct inbound ingress observation is canonical Sales
  -- intake. A history row never is; the promotion passes the live event.
  IF source_event.provider <> 'waha'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB
    OR lower(COALESCE(btrim(payload ->> 'source'), '')) = 'api'
  THEN
    RETURN FALSE;
  END IF;

  chat := platform_private.resolve_waha_conversation_chat(
    payload,
    FALSE,
    source_event.raw_payload -> 'me'
  );

  IF source_event.waha_session_name <> binding.waha_session_name
    OR chat ? 'error'
    OR binding.normalized_chat_id NOT IN (
      chat ->> 'chat_id',
      COALESCE(chat ->> 'alt_chat_id', '')
    )
    OR conversation.waha_session_name <> binding.waha_session_name
  THEN
    RAISE EXCEPTION
      'Only one verified direct inbound WAHA intake may acquire canonical identity'
      USING ERRCODE = '23514';
  END IF;

  IF conversation.sales_authority_source <> 'platform_intake'
    OR conversation.queue <> 'sales'
    OR conversation.responsible_sales_membership_id IS NULL
  THEN
    RETURN FALSE;
  END IF;

  -- The lead owner is the conversation's responsible member, or, for a promotion
  -- whose imported owner is no longer eligible, the live intake member the caller
  -- already proved eligible.
  lead_owner_membership_id := COALESCE(
    p_owner_membership_id,
    conversation.responsible_sales_membership_id
  );

  IF binding.normalized_chat_id LIKE '%@c.us' THEN
    phone_digits := regexp_replace(
      split_part(binding.normalized_chat_id, '@', 1),
      '[^0-9]',
      '',
      'g'
    );
    IF phone_digits !~ '^[0-9]{7,15}$' THEN
      RAISE EXCEPTION 'WAHA direct-chat phone identity is invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- A LID is not a phone number. Only a phone WAHA itself reported for this
    -- chat is used; otherwise the client has no phone.
    phone_digits := NULLIF(
      split_part(COALESCE(chat ->> 'phone_chat_id', ''), '@', 1),
      ''
    );
    IF phone_digits !~ '^[0-9]{7,15}$' THEN
      phone_digits := NULL;
    END IF;
  END IF;

  identity_chat_id := CASE
    WHEN phone_digits IS NOT NULL THEN phone_digits || '@c.us'
    ELSE binding.normalized_chat_id
  END;
  external_identity :=
    binding.waha_session_name || ':' || identity_chat_id;
  display_name := CASE
    WHEN phone_digits IS NOT NULL THEN 'WhatsApp ••••' || right(phone_digits, 4)
    ELSE conversation.subject
  END;
  source_ref := 'waha-event:' || source_event.id::TEXT;

  resolved_client_id := platform_private.create_or_link_client(
    binding.organization_id,
    display_name,
    NULL,
    CASE WHEN phone_digits IS NOT NULL THEN '+' || phone_digits ELSE NULL END,
    'waha',
    'direct_chat',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  resolved_lead_id := platform_private.create_or_link_lead(
    binding.organization_id,
    resolved_client_id,
    lead_owner_membership_id,
    'new',
    'whatsapp',
    'waha',
    'sales_intake',
    external_identity,
    'webhook_verified',
    source_event.provider_occurred_at,
    NULL,
    source_ref
  );

  IF (
    conversation.canonical_client_id IS NOT NULL
    AND conversation.canonical_client_id <> resolved_client_id
  ) OR (
    conversation.canonical_lead_id IS NOT NULL
    AND conversation.canonical_lead_id <> resolved_lead_id
  ) THEN
    RAISE EXCEPTION
      'Existing canonical conversation identity conflicts with exact WAHA identity'
      USING ERRCODE = '23514';
  END IF;

  UPDATE platform.communication_conversations AS target
  SET canonical_client_id = resolved_client_id,
      canonical_lead_id = resolved_lead_id
  WHERE target.organization_id = binding.organization_id
    AND target.id = binding.conversation_id
    AND (
      target.canonical_client_id IS DISTINCT FROM resolved_client_id
      OR target.canonical_lead_id IS DISTINCT FROM resolved_lead_id
    );

  RETURN TRUE;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.acquire_waha_canonical_identity(UUID, UUID, UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $bind_wrapper$
DECLARE
  target CONSTANT REGPROCEDURE :=
    'platform_private.bind_waha_chat_to_canonical(uuid,uuid)'::REGPROCEDURE;
  before_contract RECORD;
  after_contract RECORD;
BEGIN
  -- Replaced wholesale below: pin the pre-image (see the provenance guard above).
  IF (
    SELECT pg_catalog.md5(routine.prosrc)
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = target::OID
  ) IS DISTINCT FROM '48a88db060fbfab6892ecc96838b08ae' THEN
    RAISE EXCEPTION
      'Migration 260 replaces bind_waha_chat_to_canonical(), which is not the migration 259 definition it was written against; re-derive it from the current definition'
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO before_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION platform_private.bind_waha_chat_to_canonical(
  p_organization_id UUID,
  p_binding_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  binding_event_id UUID;
BEGIN
  IF p_organization_id IS NULL OR p_binding_id IS NULL THEN
    RAISE EXCEPTION 'WAHA canonical binding identity is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.source_webhook_event_id
  INTO binding_event_id
  FROM platform_private.waha_direct_chat_bindings AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_binding_id;

  IF binding_event_id IS NULL THEN
    RAISE EXCEPTION 'WAHA direct-chat binding is unavailable'
      USING ERRCODE = '23503';
  END IF;

  -- The binding's own source event: the trigger path is unchanged.
  PERFORM platform_private.acquire_waha_canonical_identity(
    p_organization_id,
    p_binding_id,
    binding_event_id
  );
END
$fn$
  $definition$;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO after_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  IF after_contract IS DISTINCT FROM before_contract THEN
    RAISE EXCEPTION
      'Migration 260 changed a protected routine contract'
      USING ERRCODE = '55000';
  END IF;
END
$bind_wrapper$;

-- ------------------------------------------------------------
-- 5. Tolerance and promotion patches to migration 259's functions. Each needle
--    must be a single occurrence in the stored definition and the routine's
--    owner, grants, definer, search_path and volatility must not change.
-- ------------------------------------------------------------

CREATE FUNCTION pg_temp.n260_patch(
  p_target REGPROCEDURE,
  p_needles TEXT[],
  p_replacements TEXT[],
  p_label TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  patched TEXT := pg_catalog.pg_get_functiondef(p_target);
  before_contract RECORD;
  after_contract RECORD;
  i INTEGER;
BEGIN
  IF cardinality(p_needles) <> cardinality(p_replacements) THEN
    RAISE EXCEPTION 'Migration 260 patch % is malformed', p_label
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO before_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = p_target::OID;

  FOR i IN 1..cardinality(p_needles) LOOP
    IF pg_catalog.length(p_needles[i]) = 0
      OR (
        pg_catalog.length(patched)
        - pg_catalog.length(pg_catalog.replace(patched, p_needles[i], ''))
      ) <> pg_catalog.length(p_needles[i])
    THEN
      RAISE EXCEPTION
        'Migration 260 patch %: needle % is not the expected single occurrence',
        p_label, i
        USING ERRCODE = '55000';
    END IF;
    patched := pg_catalog.replace(patched, p_needles[i], p_replacements[i]);
  END LOOP;

  EXECUTE patched;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO after_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = p_target::OID;

  IF after_contract IS DISTINCT FROM before_contract THEN
    RAISE EXCEPTION
      'Migration 260 changed a protected routine contract (%)', p_label
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- 5a. A live fromMe/source=app event whose raw id was imported is a duplicate of
--     the imported outbound message, not a terminal waha_outbound_conflict.
SELECT pg_temp.n260_patch(
  'platform_private.project_waha_phone_sent_message(uuid,uuid,uuid,uuid)'::REGPROCEDURE,
  ARRAY[
    $needle$
      OR existing_message.message_identity_source <> 'private_waha_phone_binding'
      OR existing_message.body_text <> (content ->> 'body')
$needle$
  ],
  ARRAY[
    $replacement$
      OR (
        existing_message.message_identity_source <> 'private_waha_history_binding'
        AND (
          existing_message.message_identity_source <> 'private_waha_phone_binding'
          OR existing_message.body_text <> (content ->> 'body')
        )
      )
$replacement$
  ],
  'project_waha_phone_sent_message'
);

-- 5b. The live projection: an inbound message whose raw id was imported is
--     accepted without a body comparison (REST history may lack what the typed
--     marker needs), and a verified inbound message in a conversation imported
--     with lead_mode 'promote' that has no client and no lead acquires the same
--     canonical identity a new live chat gets, from the LIVE verified event.
SELECT pg_temp.n260_patch(
  'platform.project_claimed_waha_event(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE,
  ARRAY[
    $needle$
  deferred_backfill JSONB;
BEGIN
$needle$,
    $needle$
          OR message_row.body_text NOT IN (
            inbound_body_text,
            COALESCE(content ->> 'legacy_body', inbound_body_text)
          )
$needle$,
    $needle$
        -- Queue activity is derived from the append-only message history below.
        -- Do not weaken the reviewed link/handoff/close transition guard merely
        -- to touch the parent conversation timestamp.
      END IF;

      IF human_review_required THEN
$needle$,
    $needle$
      ) || CASE
        WHEN deferred_backfill IS NULL THEN '{}'::JSONB
        ELSE jsonb_build_object('deferred_phone_sent', deferred_backfill)
      END;
$needle$
  ],
  ARRAY[
    $replacement$
  deferred_backfill JSONB;
  identity_promoted BOOLEAN := FALSE;
  promotion_skipped BOOLEAN := FALSE;
  promotion_owner UUID;
BEGIN
$replacement$,
    $replacement$
          OR (
            message_row.message_identity_source IS DISTINCT FROM 'private_waha_history_binding'
            AND message_row.body_text NOT IN (
              inbound_body_text,
              COALESCE(content ->> 'legacy_body', inbound_body_text)
            )
          )
$replacement$,
    $replacement$
        -- Queue activity is derived from the append-only message history below.
        -- Do not weaken the reviewed link/handoff/close transition guard merely
        -- to touch the parent conversation timestamp.
      END IF;

      -- PROMOTION: a verified customer message in a bound conversation that
      -- history created without a client or lead. It runs only here, after the
      -- inbound conflict check passed and the message is stored (an inbound
      -- whose raw id was imported as outbound ends the event above and never
      -- promotes), and it must never block live ingestion: the lead owner is the
      -- imported owner when still eligible, else the live intake member (already
      -- proven eligible for this event), else promotion is skipped and the
      -- message stays stored. The identity evidence is this live event; the
      -- history rows stay history.
      IF binding.id IS NOT NULL
        AND conversation.canonical_client_id IS NULL
        AND conversation.canonical_lead_id IS NULL
        AND platform_private.waha_history_binding_promotable(
          p_organization_id,
          binding.id
        )
      THEN
        promotion_owner := CASE
          WHEN platform_private.staff_intake_owner_is_eligible(
            p_organization_id,
            conversation.responsible_sales_membership_id
          ) THEN conversation.responsible_sales_membership_id
          WHEN platform_private.staff_intake_owner_is_eligible(
            p_organization_id,
            p_intake_sales_membership_id
          ) THEN p_intake_sales_membership_id
        END;

        IF promotion_owner IS NULL THEN
          promotion_skipped := TRUE;
        ELSE
          identity_promoted := platform_private.acquire_waha_canonical_identity(
            p_organization_id,
            binding.id,
            source_event.id,
            promotion_owner
          );
        END IF;
      END IF;

      IF human_review_required THEN
$replacement$,
    $replacement$
      ) || CASE
        WHEN deferred_backfill IS NULL THEN '{}'::JSONB
        ELSE jsonb_build_object('deferred_phone_sent', deferred_backfill)
      END || CASE
        WHEN identity_promoted THEN jsonb_build_object('identity_promoted', TRUE)
        ELSE '{}'::JSONB
      END || CASE
        WHEN promotion_skipped
          THEN jsonb_build_object('identity_promotion_skipped', 'no_eligible_owner')
        ELSE '{}'::JSONB
      END;
$replacement$
  ],
  'project_claimed_waha_event'
);

-- 5c. One realtime invalidation per history page instead of one per imported row
--     (the page sends its own summary). Only INSERTs inside an import page are
--     affected; the setting is transaction-local.
SELECT pg_temp.n260_patch(
  'platform_private.broadcast_platform_messaging_invalidation()'::REGPROCEDURE,
  ARRAY[
    $needle$
  PERFORM realtime.send(
    jsonb_build_object('resource', TG_ARGV[0]),
$needle$
  ],
  ARRAY[
    $replacement$
  IF TG_OP = 'INSERT'
    AND COALESCE(current_setting('evo.waha_history_import', TRUE), '') = 'on'
  THEN
    RETURN NEW;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('resource', TG_ARGV[0]),
$replacement$
  ],
  'broadcast_platform_messaging_invalidation'
);

-- ------------------------------------------------------------
-- 6. The lead readers also accept a history binding source. The predicate
--    "the binding's source event is a verified inbound customer message" is
--    wrapped, not weakened: `(<the same four conditions> OR history source)`.
--    A conversation only carries a lead after a verified live message promoted
--    it, so the lead link is still verified evidence.
-- ------------------------------------------------------------

DO $lead_readers$
DECLARE
  reader RECORD;
  definition TEXT;
  found INTEGER;
  before_contract RECORD;
  after_contract RECORD;
  predicate CONSTANT TEXT :=
    'AND (source_event\.verification_status = ''verified''\s+AND source_event\.event_type IN \(''message'', ''message\.any''\)\s+AND source_event\.raw_payload -> ''payload'' -> ''fromMe''\s*= ''false''::JSONB\s+AND (?:pg_catalog\.)?lower\(\s*COALESCE\(\s*(?:pg_catalog\.)?btrim\(\s*source_event\.raw_payload -> ''payload'' ->> ''source''\s*\),\s*''''\s*\)\s*\) <> ''api'')';
BEGIN
  FOR reader IN
    SELECT signature.value AS target, signature.expected AS expected
    FROM (VALUES
      ('platform.staff_canonical_lead_conversation_link(uuid,uuid,uuid)', 1),
      ('platform.staff_sales_lead_detail(uuid)', 2),
      ('private.staff_sales_lead_page(integer,timestamptz,uuid,text,text,text,uuid,text,text)', 2)
    ) AS signature(value, expected)
  LOOP
    definition := pg_catalog.pg_get_functiondef(reader.target::REGPROCEDURE);
    SELECT count(*)::INTEGER
    INTO found
    FROM regexp_matches(definition, predicate, 'g');

    IF found <> reader.expected THEN
      RAISE EXCEPTION
        'Migration 260: % has % verified-inbound binding predicates, expected %',
        reader.target, found, reader.expected
        USING ERRCODE = '55000';
    END IF;

    SELECT routine.proowner, routine.proacl, routine.prosecdef,
      routine.proconfig, routine.provolatile, routine.proleakproof,
      routine.proparallel
    INTO before_contract
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = reader.target::REGPROCEDURE::OID;

    EXECUTE regexp_replace(
      definition,
      predicate,
      'AND (\1 OR platform_private.waha_history_binding_source_ok(source_event.organization_id, source_event.id))',
      'g'
    );

    SELECT routine.proowner, routine.proacl, routine.prosecdef,
      routine.proconfig, routine.provolatile, routine.proleakproof,
      routine.proparallel
    INTO after_contract
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = reader.target::REGPROCEDURE::OID;

    IF after_contract IS DISTINCT FROM before_contract THEN
      RAISE EXCEPTION
        'Migration 260 changed a protected routine contract (%)', reader.target
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$lead_readers$;

DROP FUNCTION pg_temp.n260_patch(REGPROCEDURE, TEXT[], TEXT[], TEXT);

-- ------------------------------------------------------------
-- 7. The history evidence row of one message.
-- ------------------------------------------------------------

-- One `history.message` row per raw id, shaped like a webhook envelope
-- ({event, session, payload[, me]}) so migration 259's helpers read it. It is
-- NOT a message.any and never claims a verified webhook. An orphan row of the
-- same raw id (cannot occur inside one transaction) is reused if it is itself
-- history evidence and refused otherwise.
CREATE FUNCTION platform_private.insert_waha_history_event(
  p_organization_id UUID,
  p_run_id UUID,
  p_engine TEXT,
  p_window_from TIMESTAMPTZ,
  p_window_to TIMESTAMPTZ,
  p_lead_mode TEXT,
  p_me JSONB,
  p_entry JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  raw_envelope JSONB;
  payload_digest TEXT;
  stored platform_private.provider_webhook_events%ROWTYPE;
  new_event_id UUID := gen_random_uuid();
  raw_message_id TEXT := p_entry ->> 'raw_id';
BEGIN
  raw_envelope := jsonb_build_object(
    'event', 'history.message',
    'session', 'crm_primary',
    'payload', p_entry -> 'payload'
  ) || CASE
    WHEN p_me IS NULL OR jsonb_typeof(p_me) <> 'object' THEN '{}'::JSONB
    ELSE jsonb_build_object('me', p_me)
  END;
  payload_digest := encode(sha256(convert_to(raw_envelope::TEXT, 'UTF8')), 'hex');

  INSERT INTO platform_private.provider_webhook_events (
    id,
    organization_id,
    provider,
    provider_account_ref,
    provider_conversation_ref,
    provider_event_variant_ref,
    provider_request_id,
    waha_session_name,
    payload_id,
    event_type,
    provider_occurred_at,
    verification_status,
    raw_payload,
    verification_headers,
    verification_evidence_ref,
    payload_sha256,
    request_id
  )
  VALUES (
    new_event_id,
    p_organization_id,
    'waha',
    'waha:crm_primary',
    NULL,
    NULL,
    'api-history:' || encode(
      sha256(
        convert_to(
          p_organization_id::TEXT || ':crm_primary:' || raw_message_id,
          'UTF8'
        )
      ),
      'hex'
    ),
    'crm_primary',
    raw_message_id,
    'history.message',
    to_timestamp((p_entry ->> 'ts_epoch')::DOUBLE PRECISION),
    'missing',
    raw_envelope,
    jsonb_build_object(
      'provenance', 'api_history',
      'webhook_verified', FALSE,
      'read_only', TRUE,
      'engine', p_engine,
      'run_id', p_run_id,
      'window_from', p_window_from,
      'window_to', p_window_to,
      'lead_mode', p_lead_mode
    ),
    'api-history-read:' || p_run_id::TEXT,
    payload_digest,
    gen_random_uuid()
  )
  ON CONFLICT DO NOTHING;

  SELECT event.*
  INTO stored
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.provider = 'waha'
    AND event.provider_account_ref = 'waha:crm_primary'
    AND event.waha_session_name = 'crm_primary'
    AND event.event_type = 'history.message'
    AND event.payload_id = raw_message_id;

  IF stored.id IS NULL
    OR NOT platform_private.waha_history_binding_source_ok(
      p_organization_id,
      stored.id
    )
  THEN
    RAISE EXCEPTION
      'A WAHA history evidence row could not be stored for a message'
      USING ERRCODE = '23505';
  END IF;

  RETURN jsonb_build_object(
    'id', stored.id,
    'payload_sha256', stored.payload_sha256
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.insert_waha_history_event(
    UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, JSONB
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ------------------------------------------------------------
-- 8. Service-only RPCs: begin a window run, project one page of one chat, finish
--    the run, and a counts-only preview of a chat.
-- ------------------------------------------------------------

CREATE FUNCTION platform.begin_waha_history_window_run(
  p_organization_id UUID,
  p_waha_session_name TEXT,
  p_engine TEXT,
  p_intake_sales_membership_id UUID,
  p_window_from TIMESTAMPTZ,
  p_window_to TIMESTAMPTZ,
  p_options JSONB,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_engine TEXT := btrim(p_engine);
  run_options JSONB;
  input_sha256 TEXT;
  replayed JSONB;
  selected_run platform_private.waha_history_reconciliation_runs%ROWTYPE;
  selected_state TEXT;
  start_chat_offset INTEGER := 0;
  start_message_offset INTEGER := 0;
  resumed BOOLEAN := FALSE;
  response JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_waha_session_name IS DISTINCT FROM 'crm_primary'
    OR COALESCE(normalized_engine, '') NOT IN ('NOWEB', 'GOWS', 'WEBJS')
    OR p_intake_sales_membership_id IS NULL
    OR p_window_from IS NULL
    OR p_window_to IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid organization, the crm_primary session, engine, window, intake owner and request are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_window_to <= p_window_from
    OR p_window_to - p_window_from > INTERVAL '31 days'
    OR p_window_to > statement_timestamp() + INTERVAL '5 minutes'
  THEN
    RAISE EXCEPTION
      'The history window must be a past period of at most 31 days'
      USING ERRCODE = '22023';
  END IF;

  run_options := platform_private.normalize_waha_history_options(p_options);

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'waha_session_name', p_waha_session_name,
          'engine', normalized_engine,
          'intake_sales_membership_id', p_intake_sales_membership_id,
          'window_from', p_window_from,
          'window_to', p_window_to,
          'options', run_options
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'begin',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);

  -- The same owner eligibility the live projection requires.
  IF NOT platform_private.staff_intake_owner_is_eligible(
    p_organization_id,
    p_intake_sales_membership_id
  ) THEN
    RAISE EXCEPTION
      'An authorized tenant intake Sales membership is required for history import'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'evo:p5c:history-run:' || p_organization_id::TEXT || ':crm_primary',
      0
    )
  );

  SELECT run.*
  INTO selected_run
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.waha_session_name = 'crm_primary'
  ORDER BY run.started_at DESC, run.id DESC
  LIMIT 1;

  IF selected_run.id IS NOT NULL THEN
    SELECT lifecycle.state
    INTO selected_state
    FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
    WHERE lifecycle.organization_id = selected_run.organization_id
      AND lifecycle.run_id = selected_run.id
    ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
    LIMIT 1;

    IF selected_state IS NULL THEN
      RAISE EXCEPTION 'WAHA history run is missing lifecycle evidence'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF selected_run.id IS NULL OR selected_state = 'completed' THEN
    selected_run.id := gen_random_uuid();

    INSERT INTO platform_private.waha_history_reconciliation_runs (
      id,
      organization_id,
      waha_session_name,
      engine,
      intake_sales_membership_id,
      source_provenance,
      start_request_id,
      window_from,
      window_to,
      options
    )
    VALUES (
      selected_run.id,
      p_organization_id,
      'crm_primary',
      normalized_engine,
      p_intake_sales_membership_id,
      'api_history',
      p_request_id,
      p_window_from,
      p_window_to,
      run_options
    );

    INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
      organization_id,
      run_id,
      state,
      request_id,
      evidence
    )
    VALUES (
      p_organization_id,
      selected_run.id,
      'running',
      p_request_id,
      jsonb_build_object(
        'provenance', 'api_history',
        'read_only', TRUE,
        'engine', normalized_engine,
        'window_from', p_window_from,
        'window_to', p_window_to,
        'include_outbound_only', run_options -> 'include_outbound_only',
        'lead_mode', run_options -> 'lead_mode'
      )
    );
  ELSE
    IF selected_run.window_from IS DISTINCT FROM p_window_from
      OR selected_run.window_to IS DISTINCT FROM p_window_to
      OR selected_run.options IS DISTINCT FROM run_options
      OR selected_run.engine IS DISTINCT FROM normalized_engine
      OR selected_run.intake_sales_membership_id IS DISTINCT FROM
        p_intake_sales_membership_id
    THEN
      RAISE EXCEPTION
        'An unfinished history run exists; resume it with the same window, options, engine and intake owner, or finish it first'
        USING ERRCODE = '55000';
    END IF;

    resumed := TRUE;
    SELECT checkpoint.chat_offset, checkpoint.message_offset
    INTO start_chat_offset, start_message_offset
    FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
    WHERE checkpoint.organization_id = p_organization_id
      AND checkpoint.run_id = selected_run.id
    ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
    LIMIT 1;
    start_chat_offset := COALESCE(start_chat_offset, 0);
    start_message_offset := COALESCE(start_message_offset, 0);

    IF selected_state = 'paused' THEN
      INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
        organization_id,
        run_id,
        state,
        request_id,
        evidence
      )
      VALUES (
        p_organization_id,
        selected_run.id,
        'running',
        p_request_id,
        jsonb_build_object(
          'provenance', 'api_history',
          'read_only', TRUE,
          'resumed_from', 'paused'
        )
      );
    END IF;
  END IF;

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', selected_run.id,
    'state', 'running',
    'resumed', resumed,
    'window_from', p_window_from,
    'window_to', p_window_to,
    'include_outbound_only', run_options -> 'include_outbound_only',
    'lead_mode', run_options -> 'lead_mode',
    'chat_offset', start_chat_offset,
    'message_offset', start_message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'begin',
    p_organization_id,
    selected_run.id,
    response
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-waha-history',
    'communication.waha.history.begin',
    'waha_history_reconciliation_run',
    selected_run.id,
    NULL,
    response,
    'Begin or resume a read-only WAHA history window import',
    p_request_id
  );

  RETURN response;
END
$$;

CREATE FUNCTION platform.project_waha_history_window_page(
  p_organization_id UUID,
  p_run_id UUID,
  p_waha_session_name TEXT,
  p_raw_chat_id TEXT,
  p_messages JSONB,
  p_next_chat_offset INTEGER,
  p_next_message_offset INTEGER,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row platform_private.waha_history_reconciliation_runs%ROWTYPE;
  run_state TEXT;
  run_me JSONB;
  run_lead_mode TEXT;
  run_include_outbound_only BOOLEAN;
  current_chat_offset INTEGER := 0;
  current_message_offset INTEGER := 0;
  input_sha256 TEXT;
  replayed JSONB;
  prepared JSONB;
  plan JSONB;
  outcome TEXT;
  lock_form TEXT;
  entry JSONB;
  creator_entry JSONB;
  first_inbound JSONB;
  event_ref JSONB;
  creator_event JSONB;
  bound_chat_id TEXT;
  target_conversation_id UUID;
  customer_participant platform.conversation_participants%ROWTYPE;
  sales_participant platform.conversation_participants%ROWTYPE;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  created_customer_participant_id UUID := gen_random_uuid();
  created_sales_participant_id UUID := gen_random_uuid();
  conversation_subject TEXT;
  phone_chat TEXT;
  message_id UUID;
  entry_time TIMESTAMPTZ;
  first_time TIMESTAMPTZ;
  last_time TIMESTAMPTZ;
  conversation_created BOOLEAN := FALSE;
  projected_count INTEGER := 0;
  projected_inbound INTEGER := 0;
  projected_outbound INTEGER := 0;
  projected_media INTEGER := 0;
  response JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_run_id IS NULL
    OR p_waha_session_name IS DISTINCT FROM 'crm_primary'
    OR p_messages IS NULL
    OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_messages) > 500
    OR pg_column_size(p_messages) > 5242880
    OR (p_raw_chat_id IS NOT NULL AND char_length(p_raw_chat_id) > 256)
    OR p_next_chat_offset IS NULL
    OR p_next_chat_offset < 0
    OR p_next_message_offset IS NULL
    OR p_next_message_offset < 0
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid tenant run, the crm_primary session, a bounded message page, offsets and request are required'
      USING ERRCODE = '22023';
  END IF;

  -- Identifiers are compared the way the preparation normalises them (trimmed),
  -- so two whitespace variants of one id are refused here, with a clear reason,
  -- instead of failing later on the unique raw-id binding.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_messages) AS item(value)
    WHERE jsonb_typeof(item.value) = 'object'
      AND NULLIF(
        btrim(platform_private.waha_history_text(item.value -> 'id', 1001)),
        ''
      ) IS NOT NULL
    GROUP BY NULLIF(
      btrim(platform_private.waha_history_text(item.value -> 'id', 1001)),
      ''
    )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A history page cannot repeat a raw message identifier'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'run_id', p_run_id,
          'waha_session_name', p_waha_session_name,
          'raw_chat_id', p_raw_chat_id,
          'messages', p_messages,
          'next_chat_offset', p_next_chat_offset,
          'next_message_offset', p_next_message_offset
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'project_page',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);

  SELECT run.*
  INTO run_row
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.id = p_run_id
    AND run.waha_session_name = 'crm_primary'
    AND run.window_from IS NOT NULL
  FOR SHARE;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION 'Tenant/session-matched history window run is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-run-id:' || p_run_id::TEXT, 0)
  );

  SELECT lifecycle.state
  INTO run_state
  FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
  WHERE lifecycle.organization_id = p_organization_id
    AND lifecycle.run_id = p_run_id
  ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
  LIMIT 1;

  IF run_state IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'Only a running history import can project a page'
      USING ERRCODE = '55000';
  END IF;

  IF NOT platform_private.staff_intake_owner_is_eligible(
    p_organization_id,
    run_row.intake_sales_membership_id
  ) THEN
    RAISE EXCEPTION
      'An authorized tenant intake Sales membership is required for history import'
      USING ERRCODE = '42501';
  END IF;

  run_me := NULLIF(run_row.options -> 'me', 'null'::JSONB);
  run_lead_mode := run_row.options ->> 'lead_mode';
  run_include_outbound_only :=
    (run_row.options ->> 'include_outbound_only')::BOOLEAN;

  SELECT checkpoint.chat_offset, checkpoint.message_offset
  INTO current_chat_offset, current_message_offset
  FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.organization_id = p_organization_id
    AND checkpoint.run_id = p_run_id
  ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
  LIMIT 1;
  current_chat_offset := COALESCE(current_chat_offset, 0);
  current_message_offset := COALESCE(current_message_offset, 0);

  IF NOT (
    p_next_chat_offset > current_chat_offset
    OR (
      p_next_chat_offset = current_chat_offset
      AND p_next_message_offset > current_message_offset
    )
  ) THEN
    RAISE EXCEPTION 'History cursor must advance monotonically'
      USING ERRCODE = '22023';
  END IF;

  prepared := platform_private.waha_history_prepare_page(
    p_raw_chat_id,
    p_messages,
    run_me,
    run_row.window_from,
    run_row.window_to
  );

  -- The SAME per-chat advisory lock keys as the live projection, for every form
  -- of the chat (LID and phone), in one global order: live and import cannot
  -- create two conversations for one person and cannot deadlock each other.
  FOR lock_form IN
    SELECT form.value
    FROM jsonb_array_elements_text(prepared -> 'lock_forms') AS form(value)
    ORDER BY form.value
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'evo:p5b:waha-chat:' || p_organization_id::TEXT || ':crm_primary:' || lock_form,
        0
      )
    );
  END LOOP;

  plan := platform_private.waha_history_plan_page(
    p_organization_id,
    'crm_primary',
    prepared,
    COALESCE(run_include_outbound_only, FALSE)
  );
  outcome := plan ->> 'chat_outcome';

  IF outcome IN ('import_new', 'import_existing')
    AND jsonb_array_length(plan -> 'eligible') > 0
  THEN
    -- Transaction-local: the row triggers stay silent for this page; one summary
    -- invalidation per resource is sent below.
    PERFORM set_config('evo.waha_history_import', 'on', TRUE);

    first_time := to_timestamp(((plan -> 'eligible' -> 0) ->> 'ts_epoch')::DOUBLE PRECISION);
    last_time := to_timestamp((
      (plan -> 'eligible' -> (jsonb_array_length(plan -> 'eligible') - 1)) ->> 'ts_epoch'
    )::DOUBLE PRECISION);

    IF outcome = 'import_new' THEN
      SELECT element.value
      INTO creator_entry
      FROM jsonb_array_elements(plan -> 'eligible') AS element(value)
      WHERE element.value ->> 'raw_id' = plan ->> 'creator_raw_id';

      -- A customer name comes from a customer message only: on an outgoing
      -- message the profile name is the sales account's own.
      SELECT element.value
      INTO first_inbound
      FROM jsonb_array_elements(plan -> 'eligible') AS element(value)
      WHERE (element.value -> 'from_me') = 'false'::JSONB
      LIMIT 1;

      creator_event := platform_private.insert_waha_history_event(
        p_organization_id,
        p_run_id,
        run_row.engine,
        run_row.window_from,
        run_row.window_to,
        run_lead_mode,
        run_me,
        creator_entry
      );

      bound_chat_id := creator_entry #>> '{chat,chat_id}';
      phone_chat := creator_entry #>> '{chat,phone_chat_id}';
      IF bound_chat_id LIKE '%@c.us' THEN
        conversation_subject := 'WhatsApp ••••' || right(
          split_part(bound_chat_id, '@', 1),
          4
        );
      ELSIF phone_chat IS NOT NULL
        AND split_part(phone_chat, '@', 1) ~ '^[0-9]{7,15}$'
      THEN
        conversation_subject := 'WhatsApp ••••' || right(
          split_part(phone_chat, '@', 1),
          4
        );
      ELSE
        -- A LID without a phone: never a number made of LID digits. The short
        -- random suffix keeps two such contacts apart.
        conversation_subject := COALESCE(
          platform_private.waha_payload_push_name(first_inbound -> 'payload'),
          'WhatsApp контакт'
        ) || ' #' || left(created_conversation_id::TEXT, 4);
      END IF;

      INSERT INTO platform.record_scopes (
        id,
        organization_id,
        scope_kind,
        scope_key,
        scope_version,
        is_active
      )
      VALUES (
        created_scope_id,
        p_organization_id,
        'conversation',
        created_conversation_id,
        1,
        TRUE
      );

      INSERT INTO platform.membership_scope_assignments (
        organization_id,
        membership_id,
        scope_id,
        scope_version,
        assignment_version,
        granted,
        actor_kind,
        actor_profile_id,
        reason,
        request_id
      )
      VALUES (
        p_organization_id,
        run_row.intake_sales_membership_id,
        created_scope_id,
        1,
        1,
        TRUE,
        'service',
        NULL,
        'Grant Sales access to one history-imported WAHA conversation',
        p_request_id
      );

      -- The conversation is shaped exactly like a live one; its times are the
      -- message times of the history, not the import time.
      INSERT INTO platform.communication_conversations (
        id,
        organization_id,
        student_case_id,
        responsible_sales_membership_id,
        sales_authority_source,
        current_curator_membership_id,
        queue,
        status,
        subject,
        waha_session_name,
        kommo_account_id,
        kommo_conversation_id,
        amocrm_account_id,
        amocrm_lead_id,
        amocrm_contact_id,
        current_scope_id,
        current_scope_version,
        created_from_webhook_event_id,
        created_at,
        updated_at
      )
      VALUES (
        created_conversation_id,
        p_organization_id,
        NULL,
        run_row.intake_sales_membership_id,
        'platform_intake',
        NULL,
        'sales',
        'open',
        conversation_subject,
        'crm_primary',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        created_scope_id,
        1,
        (creator_event ->> 'id')::UUID,
        first_time,
        last_time
      );

      INSERT INTO platform.conversation_participants (
        id,
        organization_id,
        conversation_id,
        participant_kind,
        membership_id,
        external_subject_ref,
        source_webhook_event_id
      )
      VALUES
        (
          created_customer_participant_id,
          p_organization_id,
          created_conversation_id,
          'customer',
          NULL,
          'waha-participant:' || created_customer_participant_id::TEXT,
          (creator_event ->> 'id')::UUID
        ),
        (
          created_sales_participant_id,
          p_organization_id,
          created_conversation_id,
          'sales',
          run_row.intake_sales_membership_id,
          NULL,
          (creator_event ->> 'id')::UUID
        );

      -- The binding's source is a history row, so the canonical-link trigger
      -- returns without creating a client or a lead.
      INSERT INTO platform_private.waha_direct_chat_bindings (
        organization_id,
        waha_session_name,
        normalized_chat_id,
        conversation_id,
        source_webhook_event_id
      )
      VALUES (
        p_organization_id,
        'crm_primary',
        bound_chat_id,
        created_conversation_id,
        (creator_event ->> 'id')::UUID
      );

      target_conversation_id := created_conversation_id;
      customer_participant.id := created_customer_participant_id;
      sales_participant.id := created_sales_participant_id;
      conversation_created := TRUE;
    ELSE
      target_conversation_id := (plan ->> 'conversation_id')::UUID;

      SELECT chat_binding.normalized_chat_id
      INTO bound_chat_id
      FROM platform_private.waha_direct_chat_bindings AS chat_binding
      WHERE chat_binding.organization_id = p_organization_id
        AND chat_binding.id = (plan ->> 'binding_id')::UUID;

      SELECT participant.*
      INTO customer_participant
      FROM platform.conversation_participants AS participant
      WHERE participant.organization_id = p_organization_id
        AND participant.conversation_id = target_conversation_id
        AND participant.participant_kind = 'customer'
      ORDER BY participant.created_at, participant.id
      LIMIT 1;

      SELECT participant.*
      INTO sales_participant
      FROM platform.conversation_participants AS participant
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = participant.organization_id
       AND conversation.id = participant.conversation_id
      WHERE participant.organization_id = p_organization_id
        AND participant.conversation_id = target_conversation_id
        AND participant.participant_kind = 'sales'
        AND participant.membership_id = conversation.responsible_sales_membership_id
      ORDER BY participant.created_at, participant.id
      LIMIT 1;

      IF customer_participant.id IS NULL OR sales_participant.id IS NULL THEN
        RAISE EXCEPTION 'Bound WAHA conversation participants are incomplete'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    FOR entry IN
      SELECT element.value
      FROM jsonb_array_elements(plan -> 'eligible') WITH ORDINALITY AS element(value, ord)
      ORDER BY element.ord
    LOOP
      IF conversation_created
        AND entry ->> 'raw_id' = plan ->> 'creator_raw_id'
      THEN
        event_ref := creator_event;
      ELSE
        event_ref := platform_private.insert_waha_history_event(
          p_organization_id,
          p_run_id,
          run_row.engine,
          run_row.window_from,
          run_row.window_to,
          run_lead_mode,
          run_me,
          entry
        );
      END IF;

      entry_time := to_timestamp((entry ->> 'ts_epoch')::DOUBLE PRECISION);
      message_id := gen_random_uuid();

      INSERT INTO platform.communication_messages (
        id,
        organization_id,
        conversation_id,
        student_case_id,
        sender_participant_id,
        direction,
        body_text,
        language,
        student_visible,
        message_identity_source,
        waha_session_name,
        waha_message_id,
        kommo_account_id,
        kommo_conversation_id,
        kommo_message_id,
        amocrm_account_id,
        amocrm_lead_id,
        amocrm_contact_id,
        source_webhook_event_id,
        manual_send_authorization_id,
        created_at
      )
      VALUES (
        message_id,
        p_organization_id,
        target_conversation_id,
        NULL,
        CASE
          WHEN (entry -> 'from_me') = 'true'::JSONB THEN sales_participant.id
          ELSE customer_participant.id
        END,
        CASE
          WHEN (entry -> 'from_me') = 'true'::JSONB
            THEN 'outbound'::platform.communication_direction
          ELSE 'inbound'::platform.communication_direction
        END,
        entry #>> '{content,body}',
        'undetermined',
        FALSE,
        'private_waha_history_binding',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        (event_ref ->> 'id')::UUID,
        NULL,
        entry_time
      );

      INSERT INTO platform_private.waha_message_bindings (
        organization_id,
        waha_session_name,
        raw_message_id,
        communication_message_id,
        source_webhook_event_id
      )
      VALUES (
        p_organization_id,
        'crm_primary',
        entry ->> 'raw_id',
        message_id,
        (event_ref ->> 'id')::UUID
      );

      INSERT INTO platform_private.waha_history_message_observations (
        organization_id,
        run_id,
        waha_session_name,
        normalized_chat_id,
        raw_message_id,
        direction,
        provider_occurred_at,
        source_event_id,
        communication_message_id,
        payload_sha256,
        page_request_id
      )
      VALUES (
        p_organization_id,
        p_run_id,
        'crm_primary',
        bound_chat_id,
        entry ->> 'raw_id',
        CASE
          WHEN (entry -> 'from_me') = 'true'::JSONB
            THEN 'outbound'::platform.communication_direction
          ELSE 'inbound'::platform.communication_direction
        END,
        entry_time,
        (event_ref ->> 'id')::UUID,
        message_id,
        event_ref ->> 'payload_sha256',
        p_request_id
      );

      INSERT INTO platform_private.waha_history_projection_effects (
        organization_id,
        run_id,
        source_event_id,
        communication_message_id,
        disposition,
        payload_sha256,
        page_request_id
      )
      VALUES (
        p_organization_id,
        p_run_id,
        (event_ref ->> 'id')::UUID,
        message_id,
        'projected',
        event_ref ->> 'payload_sha256',
        p_request_id
      );

      projected_count := projected_count + 1;
      IF (entry -> 'from_me') = 'true'::JSONB THEN
        projected_outbound := projected_outbound + 1;
      ELSE
        projected_inbound := projected_inbound + 1;
      END IF;
      IF (entry #> '{content,has_media}') = 'true'::JSONB THEN
        projected_media := projected_media + 1;
      END IF;
    END LOOP;

    PERFORM set_config('evo.waha_history_import', 'off', TRUE);

    IF conversation_created THEN
      PERFORM realtime.send(
        jsonb_build_object('resource', 'conversation'),
        'invalidate',
        'platform-messaging:' || p_organization_id::TEXT,
        TRUE
      );
    END IF;
    IF projected_count > 0 THEN
      PERFORM realtime.send(
        jsonb_build_object('resource', 'message'),
        'invalidate',
        'platform-messaging:' || p_organization_id::TEXT,
        TRUE
      );
    END IF;
  END IF;

  INSERT INTO platform_private.waha_history_reconciliation_checkpoints (
    organization_id,
    run_id,
    chat_offset,
    message_offset,
    projected_count,
    page_request_id
  )
  VALUES (
    p_organization_id,
    p_run_id,
    p_next_chat_offset,
    p_next_message_offset,
    projected_count,
    p_request_id
  );

  -- Counts and enums only: no chat id, message id or text is ever returned,
  -- stored in the replay table or written to the audit journal.
  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', p_run_id,
    'state', 'running',
    'chat_outcome', outcome,
    'conversation_created', conversation_created,
    'received', prepared -> 'received',
    'projected', projected_count,
    'projected_inbound', projected_inbound,
    'projected_outbound', projected_outbound,
    'projected_media', projected_media,
    'already_bound', plan -> 'already_bound',
    'skipped', plan -> 'skipped',
    'chat_offset', p_next_chat_offset,
    'message_offset', p_next_message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'project_page',
    p_organization_id,
    p_run_id,
    response
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-waha-history',
    'communication.waha.history.project',
    'waha_history_reconciliation_run',
    p_run_id,
    jsonb_build_object(
      'chat_offset', current_chat_offset,
      'message_offset', current_message_offset
    ),
    response,
    'Project one read-only WAHA history page of one direct chat and advance its durable cursor atomically',
    p_request_id
  );

  RETURN response;
END
$$;

CREATE FUNCTION platform.finish_waha_history_window_run(
  p_organization_id UUID,
  p_run_id UUID,
  p_outcome TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_row platform_private.waha_history_reconciliation_runs%ROWTYPE;
  run_state TEXT;
  last_chat_offset INTEGER := 0;
  last_message_offset INTEGER := 0;
  totals JSONB;
  skipped_totals JSONB;
  input_sha256 TEXT;
  replayed JSONB;
  response JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_run_id IS NULL
    OR p_outcome IS NULL
    OR p_outcome NOT IN ('completed', 'paused')
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Valid tenant run, completed/paused outcome and request are required'
      USING ERRCODE = '22023';
  END IF;

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'run_id', p_run_id,
          'outcome', p_outcome
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-request:' || p_request_id::TEXT, 0)
  );
  replayed := platform_private.waha_history_replay_request(
    p_request_id,
    'finish',
    input_sha256
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  PERFORM platform_private.assert_waha_history_request_unused(p_request_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5c:history-run-id:' || p_run_id::TEXT, 0)
  );

  SELECT run.*
  INTO run_row
  FROM platform_private.waha_history_reconciliation_runs AS run
  WHERE run.organization_id = p_organization_id
    AND run.id = p_run_id
    AND run.waha_session_name = 'crm_primary'
    AND run.window_from IS NOT NULL;

  IF run_row.id IS NULL THEN
    RAISE EXCEPTION 'Tenant/session-matched history window run is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT lifecycle.state
  INTO run_state
  FROM platform_private.waha_history_reconciliation_lifecycle AS lifecycle
  WHERE lifecycle.organization_id = p_organization_id
    AND lifecycle.run_id = p_run_id
  ORDER BY lifecycle.observed_at DESC, lifecycle.id DESC
  LIMIT 1;

  IF run_state IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'Only a running history import can be finished or paused'
      USING ERRCODE = '55000';
  END IF;

  SELECT checkpoint.chat_offset, checkpoint.message_offset
  INTO last_chat_offset, last_message_offset
  FROM platform_private.waha_history_reconciliation_checkpoints AS checkpoint
  WHERE checkpoint.organization_id = p_organization_id
    AND checkpoint.run_id = p_run_id
  ORDER BY checkpoint.checkpointed_at DESC, checkpoint.id DESC
  LIMIT 1;
  last_chat_offset := COALESCE(last_chat_offset, 0);
  last_message_offset := COALESCE(last_message_offset, 0);

  SELECT jsonb_build_object(
    'pages', count(*),
    'conversations_created',
      count(*) FILTER (WHERE (page.response ->> 'conversation_created')::BOOLEAN),
    'chats_skipped',
      count(*) FILTER (WHERE page.response ->> 'chat_outcome' LIKE 'skip\_%'),
    'projected', COALESCE(sum((page.response ->> 'projected')::INTEGER), 0),
    'projected_inbound',
      COALESCE(sum((page.response ->> 'projected_inbound')::INTEGER), 0),
    'projected_outbound',
      COALESCE(sum((page.response ->> 'projected_outbound')::INTEGER), 0),
    'projected_media',
      COALESCE(sum((page.response ->> 'projected_media')::INTEGER), 0),
    'already_bound',
      COALESCE(sum((page.response ->> 'already_bound')::INTEGER), 0)
  )
  INTO totals
  FROM platform_private.waha_history_reconciliation_requests AS page
  WHERE page.organization_id = p_organization_id
    AND page.run_id = p_run_id
    AND page.operation = 'project_page';

  SELECT COALESCE(jsonb_object_agg(reason.key, reason.total), '{}'::JSONB)
  INTO skipped_totals
  FROM (
    SELECT counter.key, sum(counter.value::INTEGER) AS total
    FROM platform_private.waha_history_reconciliation_requests AS page
    CROSS JOIN LATERAL jsonb_each_text(page.response -> 'skipped') AS counter(key, value)
    WHERE page.organization_id = p_organization_id
      AND page.run_id = p_run_id
      AND page.operation = 'project_page'
    GROUP BY counter.key
  ) AS reason;

  response := jsonb_build_object(
    'organization_id', p_organization_id,
    'run_id', p_run_id,
    'state', p_outcome,
    'window_from', run_row.window_from,
    'window_to', run_row.window_to,
    'totals', totals || jsonb_build_object('skipped', skipped_totals),
    'chat_offset', last_chat_offset,
    'message_offset', last_message_offset
  );

  INSERT INTO platform_private.waha_history_reconciliation_lifecycle (
    organization_id,
    run_id,
    state,
    request_id,
    evidence
  )
  VALUES (
    p_organization_id,
    p_run_id,
    p_outcome,
    p_request_id,
    response || jsonb_build_object('provenance', 'api_history', 'read_only', TRUE)
  );

  INSERT INTO platform_private.waha_history_reconciliation_requests (
    request_id,
    input_sha256,
    operation,
    organization_id,
    run_id,
    response
  )
  VALUES (
    p_request_id,
    input_sha256,
    'finish',
    p_organization_id,
    p_run_id,
    response
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    p_organization_id,
    'service',
    NULL,
    'service:platform-waha-history',
    CASE
      WHEN p_outcome = 'completed' THEN 'communication.waha.history.complete'
      ELSE 'communication.waha.history.pause'
    END,
    'waha_history_reconciliation_run',
    p_run_id,
    jsonb_build_object('state', run_state),
    response,
    'Finish or pause a read-only WAHA history window import without provider mutation',
    p_request_id
  );

  RETURN response;
END
$$;

-- Counts only, no message text and no identifier: what importing one chat's page
-- would do, computed by the SAME prepare/plan functions the import uses. Reads
-- nothing it could not read as the import and writes nothing.
CREATE FUNCTION platform.preview_waha_history_window_chat(
  p_organization_id UUID,
  p_waha_session_name TEXT,
  p_raw_chat_id TEXT,
  p_messages JSONB,
  p_window_from TIMESTAMPTZ,
  p_window_to TIMESTAMPTZ,
  p_options JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  run_options JSONB;
  prepared JSONB;
  plan JSONB;
  chat_kind TEXT;
  anchor_chat JSONB;
  phone_digits TEXT;
  eligible_count INTEGER;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_waha_session_name IS DISTINCT FROM 'crm_primary'
    OR p_messages IS NULL
    OR jsonb_typeof(p_messages) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_messages) > 500
    OR pg_column_size(p_messages) > 5242880
    OR (p_raw_chat_id IS NOT NULL AND char_length(p_raw_chat_id) > 256)
    OR p_window_from IS NULL
    OR p_window_to IS NULL
    OR p_window_to <= p_window_from
    OR p_window_to - p_window_from > INTERVAL '31 days'
  THEN
    RAISE EXCEPTION
      'Valid organization, the crm_primary session, a bounded message page and a window of at most 31 days are required'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_messages) AS item(value)
    WHERE jsonb_typeof(item.value) = 'object'
      AND NULLIF(
        btrim(platform_private.waha_history_text(item.value -> 'id', 1001)),
        ''
      ) IS NOT NULL
    GROUP BY NULLIF(
      btrim(platform_private.waha_history_text(item.value -> 'id', 1001)),
      ''
    )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A history page cannot repeat a raw message identifier'
      USING ERRCODE = '22023';
  END IF;

  run_options := platform_private.normalize_waha_history_options(p_options);

  prepared := platform_private.waha_history_prepare_page(
    p_raw_chat_id,
    p_messages,
    NULLIF(run_options -> 'me', 'null'::JSONB),
    p_window_from,
    p_window_to
  );
  plan := platform_private.waha_history_plan_page(
    p_organization_id,
    'crm_primary',
    prepared,
    (run_options ->> 'include_outbound_only')::BOOLEAN
  );

  chat_kind := CASE
    WHEN prepared ->> 'chat_id' IS NULL THEN 'unsupported'
    WHEN prepared ->> 'chat_id' LIKE '%@lid' THEN 'lid'
    ELSE 'c_us'
  END;
  anchor_chat := plan -> 'anchor_chat';
  eligible_count := jsonb_array_length(plan -> 'eligible');

  phone_digits := CASE
    WHEN chat_kind = 'c_us' THEN split_part(prepared ->> 'chat_id', '@', 1)
    WHEN anchor_chat ->> 'phone_chat_id' IS NOT NULL
      THEN split_part(anchor_chat ->> 'phone_chat_id', '@', 1)
  END;

  RETURN jsonb_build_object(
    'chat_kind', chat_kind,
    'chat_outcome', plan ->> 'chat_outcome',
    'lid_chat_has_phone', chat_kind = 'lid'
      AND anchor_chat ->> 'phone_chat_id' IS NOT NULL,
    'conversation_exists', plan ->> 'conversation_id' IS NOT NULL,
    'would_create_conversation', plan ->> 'chat_outcome' = 'import_new',
    'matches_active_client_phone', phone_digits IS NOT NULL AND EXISTS (
      SELECT 1
      FROM platform.clients AS client
      WHERE client.organization_id = p_organization_id
        AND client.lifecycle_state = 'active'
        AND client.normalized_phone = '+' || phone_digits
    ),
    'received', prepared -> 'received',
    'would_import', eligible_count,
    'would_import_inbound', (
      SELECT count(*)
      FROM jsonb_array_elements(plan -> 'eligible') AS element(value)
      WHERE (element.value -> 'from_me') = 'false'::JSONB
    ),
    'would_import_outbound', (
      SELECT count(*)
      FROM jsonb_array_elements(plan -> 'eligible') AS element(value)
      WHERE (element.value -> 'from_me') = 'true'::JSONB
    ),
    'would_import_media', (
      SELECT count(*)
      FROM jsonb_array_elements(plan -> 'eligible') AS element(value)
      WHERE (element.value #> '{content,has_media}') = 'true'::JSONB
    ),
    'already_bound', plan -> 'already_bound',
    'skipped', plan -> 'skipped'
  );
END
$$;

-- ------------------------------------------------------------
-- 9. Grants: the new RPCs are service-only; the superseded v1 routines are not
--    callable by any application role any more.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION
  platform.begin_waha_history_window_run(
    UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, UUID
  ),
  platform.project_waha_history_window_page(
    UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
  ),
  platform.finish_waha_history_window_run(UUID, UUID, TEXT, UUID),
  platform.preview_waha_history_window_chat(
    UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
  )
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.begin_waha_history_window_run(
    UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, UUID
  ),
  platform.project_waha_history_window_page(
    UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
  ),
  platform.finish_waha_history_window_run(UUID, UUID, TEXT, UUID),
  platform.preview_waha_history_window_chat(
    UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
  )
TO service_role;

REVOKE ALL ON FUNCTION
  platform.begin_waha_history_reconciliation(UUID, TEXT, TEXT, UUID, UUID),
  platform.project_waha_history_page(
    UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
  ),
  platform.finish_waha_history_reconciliation(UUID, UUID, TEXT, UUID)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMENT ON FUNCTION platform.begin_waha_history_window_run(
  UUID, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, UUID
) IS
  'Service-only: begins or resumes (same window, options, engine and intake owner) the one read-only WAHA history window import of the crm_primary session. Options: include_outbound_only (default false), lead_mode promote|none (default promote), me (own account ids).';
COMMENT ON FUNCTION platform.project_waha_history_window_page(
  UUID, UUID, TEXT, TEXT, JSONB, INTEGER, INTEGER, UUID
) IS
  'Service-only: atomically projects one bounded page of one direct chat of read-only REST history into the CRM with history.message / missing / api_history evidence and private_waha_history_binding identity in both directions, skipping raw ids already bound, and advances the durable cursor. Returns counts only.';
COMMENT ON FUNCTION platform.finish_waha_history_window_run(UUID, UUID, TEXT, UUID) IS
  'Service-only: persists completed/paused evidence for a history window run and returns its totals (counts only).';
COMMENT ON FUNCTION platform.preview_waha_history_window_chat(
  UUID, TEXT, TEXT, JSONB, TIMESTAMPTZ, TIMESTAMPTZ, JSONB
) IS
  'Service-only dry run: what importing one chat page would do, computed by the import code; returns counts and booleans only (no text, no identifier) and writes nothing.';
COMMENT ON TABLE platform_private.waha_history_reconciliation_runs IS
  'Append-only tenant/session-bound read-only WAHA history run identity (v1 reconciliation runs, and window runs with window_from/window_to/options); application enablement remains disabled by default.';

COMMIT;
