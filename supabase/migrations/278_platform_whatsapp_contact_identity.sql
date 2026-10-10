-- ============================================================
-- 278_platform_whatsapp_contact_identity.sql
--
-- «Продажи → WhatsApp»: the WhatsApp profile name and more digits of the
-- number instead of «WhatsApp ••••NNNN» (owner request 07.10.2026: «показывать
-- имя из профиля WhatsApp или больше цифр — да это тоже сделаем»). Two chats of
-- two different customers whose numbers end in the same four digits looked
-- identical. Additive only: no live routine is re-created, no table, column or
-- reader signature changes, so the running application keeps working between
-- this migration and its release.
--
--  1. Read side. platform.staff_whatsapp_contacts(org, conversation ids) gives,
--     for each requested WhatsApp chat the member may read in full
--     (communication.read.full and the same per-conversation check as the
--     queue), the contact name and the number masked on the server: the
--     country code and the last six digits, «+996 ••• 12 46 64». The full
--     number never leaves the database through it. Name: the client's own name
--     when it is not a placeholder of the WhatsApp chain (a name someone typed
--     wins) and the member may read that client (client.read), otherwise the
--     customer's latest WhatsApp profile (push) name from a verified customer
--     message, otherwise NULL (the screen says «WhatsApp»). Since 261 every
--     member with communication.read.full reads every sales chat; the client
--     name stays behind client.read. A row is returned only for a chat whose subject is still the
--     chain's generated subject and whose number is known; any other chat keeps
--     its subject on screen. The number's last four digits must agree with the
--     «WhatsApp ••••NNNN» subject, otherwise no number is shown.
--  2. Capture. A verified customer message (and the canonical client binding
--     of a chat) renames the chat's canonical client from a placeholder of the
--     WhatsApp chain («WhatsApp ••••NNNN», «WhatsApp контакт #…»/«<имя> #…» of a
--     LID chat, or this migration's «WhatsApp +996 ••• 12 46 64») to the
--     customer's profile name, or, with no usable profile name, to «WhatsApp»
--     with the masked number. A name that is not such a placeholder — typed by
--     a member, a manual lead, a website or intake name — is never touched; the
--     update is a compare-and-set on the old placeholder, so a concurrent edit
--     wins. The capture is cosmetic and can never fail or wait on the
--     projection of a message: its errors are caught and logged as a warning
--     (SQLSTATE only), a client row another transaction holds is skipped
--     (FOR NO KEY UPDATE SKIP LOCKED; the next customer message retries), and
--     it is silent during a history import page.
--  3. Backfill. Every existing WhatsApp chat with a canonical client is passed
--     through the same capture once (idempotent; a re-run changes nothing; a
--     client row locked at that moment is skipped and named by its next
--     customer message).
--
-- Profile names: WEBJS `_data.notifyName`, NOWEB `_data.pushName`, GOWS
-- `_data.Info.PushName`, read and sanitised by 259's waha_payload_push_name.
-- Only a verified `message`/`message.any` event of a customer message
-- (`fromMe` false, not an API echo) is used: a message sent from the sales phone
-- carries the sales account's own profile name, and the REST history import
-- carries none. A name of punctuation and spaces only («.») is no name.
--
-- Known limitations (deliberate, documented):
--  * A profile name captured once is the client's name from then on; a later
--    change of the WhatsApp profile name is not followed (it is no longer a
--    placeholder, and it cannot be told apart from a typed name). The chat
--    shows the client's name too.
--  * The CRM has no staff action that renames a client (the only writers of
--    platform.clients.display_name are 084's merge and this capture): a wrong,
--    business or joke profile name — an emoji-only name included — becomes
--    the client's name on lead cards and in the AI lead card and can be
--    corrected only by SQL until a rename action exists.
--  * The AI lead card (274's platform_private.ai_lead_card) reads
--    platform.clients.display_name: from the moment this migration is applied
--    (before any application release) every «Помочь с ответом» (P2) draft
--    request sends the profile first name (up to 60 characters) to the model
--    instead of no name. Applying 278 is that decision.
--  * A chat without a client (history import only) shows the profile name only
--    after its first live customer message.
--  * A LID chat without any known number keeps its subject («Имя #1a2b»).
--  * The masked number follows the E.164 country-code lengths (1: +1, +7;
--    2: the ITU two-digit codes; 3: the rest); at least one digit is always
--    hidden.
-- ============================================================

BEGIN;

-- The WAHA payload helpers this migration relies on are exactly migration
-- 259's (pinned as on production 07.10.2026).
DO $n278_pre$
DECLARE
  helper RECORD;
BEGIN
  FOR helper IN
    SELECT *
    FROM (VALUES
      ('platform_private.waha_payload_push_name(jsonb)', '88c460549a31c87b72e5f66962304086'),
      ('platform_private.resolve_waha_conversation_chat(jsonb,boolean,jsonb)', '9089a18ca27ddaa0cc461ab595765695'),
      ('platform_private.waha_payload_phone_chat_id(jsonb,boolean,text[])', 'eba01344c97aa78faa3c551f45c34875')
    ) AS pinned(signature, source_md5)
  LOOP
    IF (
      SELECT pg_catalog.md5(routine.prosrc)
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = pg_catalog.to_regprocedure(helper.signature)
    ) IS DISTINCT FROM helper.source_md5 THEN
      RAISE EXCEPTION
        'Migration 278 relies on % as migration 259 defined it; re-derive 278 from the current definition',
        helper.signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('platform.staff_whatsapp_contacts(uuid,uuid[])') IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS existing
      WHERE existing.tgname IN (
        'communication_messages_waha_contact_name',
        'communication_conversations_waha_contact_name'
      )
    )
  THEN
    RAISE EXCEPTION 'Migration 278 objects already exist' USING ERRCODE = '55000';
  END IF;
END
$n278_pre$;

-- ------------------------------------------------------------
-- 1. Pure helpers (private, definer, empty search_path, no client role).
-- ------------------------------------------------------------

-- «+996 ••• 12 46 64»: the country code and at most the last six digits of the
-- national number, in pairs from the right; at least one digit stays hidden.
CREATE FUNCTION platform_private.whatsapp_masked_phone(
  p_digits TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  country_length INTEGER;
  national TEXT;
  tail TEXT;
  grouped TEXT := '';
BEGIN
  IF p_digits !~ '^[1-9][0-9]{6,14}$' THEN
    RETURN NULL;
  END IF;

  country_length := CASE
    WHEN left(p_digits, 1) IN ('1', '7') THEN 1
    WHEN left(p_digits, 2) IN (
      '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43',
      '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56',
      '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84',
      '86', '90', '91', '92', '93', '94', '95', '98'
    ) THEN 2
    ELSE 3
  END;
  national := substr(p_digits, country_length + 1);
  tail := right(national, LEAST(6, length(national) - 1));

  WHILE length(tail) > 2 LOOP
    grouped := ' ' || right(tail, 2) || grouped;
    tail := left(tail, length(tail) - 2);
  END LOOP;

  RETURN '+' || left(p_digits, country_length) || ' ••• ' || tail || grouped;
END
$$;

-- The subject the WAHA chain gave a chat (259, 260): «WhatsApp ••••NNNN», or
-- for a LID chat without a number «<имя>|WhatsApp контакт #<4 hex of the id>».
CREATE FUNCTION platform_private.waha_generated_conversation_subject(
  p_subject TEXT,
  p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_subject ~ '^WhatsApp ••••[0-9]{4}$'
    OR (
      length(p_subject) > 6
      AND right(p_subject, 6) = ' #' || left(p_conversation_id::TEXT, 4)
    ),
    FALSE
  )
$$;

-- A client name that is a placeholder of the WhatsApp chain for this number
-- (or this chat's generated subject), never a typed name.
CREATE FUNCTION platform_private.waha_generated_client_name(
  p_name TEXT,
  p_phone_digits TEXT,
  p_conversation_subject TEXT,
  p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      p_phone_digits IS NOT NULL
      AND p_name IN (
        'WhatsApp ••••' || right(p_phone_digits, 4),
        'WhatsApp ' || platform_private.whatsapp_masked_phone(p_phone_digits)
      )
    )
    OR (
      p_name = p_conversation_subject
      AND platform_private.waha_generated_conversation_subject(
        p_conversation_subject,
        p_conversation_id
      )
    ),
    FALSE
  )
$$;

-- ------------------------------------------------------------
-- 2. Readers of one chat (private).
-- ------------------------------------------------------------

-- The customer's latest WhatsApp profile name: verified customer messages only
-- (the 20 newest customer messages of the chat; only their payloads are read).
CREATE FUNCTION platform_private.waha_conversation_push_name(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT named.name
  FROM (
    SELECT message.created_at, message.id, message.source_webhook_event_id AS event_id
    FROM platform.communication_messages AS message
    JOIN platform_private.provider_webhook_events AS event
      ON event.organization_id = message.organization_id
      AND event.id = message.source_webhook_event_id
    WHERE message.organization_id = p_organization_id
      AND message.conversation_id = p_conversation_id
      AND message.direction = 'inbound'
      AND event.provider = 'waha'
      AND event.verification_status = 'verified'
      AND event.event_type IN ('message', 'message.any')
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 20
  ) AS recent
  JOIN platform_private.provider_webhook_events AS source_event
    ON source_event.organization_id = p_organization_id
    AND source_event.id = recent.event_id
  CROSS JOIN LATERAL (
    SELECT source_event.raw_payload -> 'payload' AS payload
  ) AS evidence
  CROSS JOIN LATERAL (
    SELECT platform_private.waha_payload_push_name(evidence.payload) AS name
  ) AS named
  WHERE jsonb_typeof(evidence.payload) = 'object'
    AND evidence.payload -> 'fromMe' = 'false'::JSONB
    AND lower(COALESCE(btrim(evidence.payload ->> 'source'), '')) <> 'api'
    AND named.name IS NOT NULL
    AND named.name !~ '^[[:punct:][:space:]]*$'
  ORDER BY recent.created_at DESC, recent.id DESC
  LIMIT 1
$$;

-- The chat's phone number (digits): the canonical client's phone, the phone
-- chat it is bound to, or the phone WAHA itself reported for the chat in the
-- binding's source event or one of the 10 newest messages (259's resolution,
-- the own number never counts).
CREATE FUNCTION platform_private.waha_conversation_phone_digits(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  digits TEXT;
  evidence RECORD;
BEGIN
  SELECT regexp_replace(client.normalized_phone, '[^0-9]', '', 'g')
  INTO digits
  FROM platform.communication_conversations AS conversation
  JOIN platform.clients AS client
    ON client.organization_id = conversation.organization_id
    AND client.id = conversation.canonical_client_id
  WHERE conversation.organization_id = p_organization_id
    AND conversation.id = p_conversation_id;
  IF digits ~ '^[1-9][0-9]{6,14}$' THEN
    RETURN digits;
  END IF;

  SELECT split_part(binding.normalized_chat_id, '@', 1)
  INTO digits
  FROM platform_private.waha_direct_chat_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.conversation_id = p_conversation_id
    AND binding.normalized_chat_id ~ '^[1-9][0-9]{6,14}@c[.]us$'
  ORDER BY binding.created_at, binding.id
  LIMIT 1;
  IF digits IS NOT NULL THEN
    RETURN digits;
  END IF;

  FOR evidence IN
    SELECT event.raw_payload
    FROM (
      SELECT binding.source_webhook_event_id AS event_id, 0 AS rank,
        binding.created_at AS at, binding.id AS tie
      FROM platform_private.waha_direct_chat_bindings AS binding
      WHERE binding.organization_id = p_organization_id
        AND binding.conversation_id = p_conversation_id
      UNION ALL
      SELECT recent.source_webhook_event_id, 1, recent.created_at, recent.id
      FROM (
        SELECT message.source_webhook_event_id, message.created_at, message.id
        FROM platform.communication_messages AS message
        WHERE message.organization_id = p_organization_id
          AND message.conversation_id = p_conversation_id
          AND message.source_webhook_event_id IS NOT NULL
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 10
      ) AS recent
    ) AS source
    JOIN platform_private.provider_webhook_events AS event
      ON event.organization_id = p_organization_id
      AND event.id = source.event_id
    WHERE event.provider = 'waha'
      AND event.event_type IN ('message', 'message.any', 'history.message')
      AND jsonb_typeof(event.raw_payload -> 'payload') = 'object'
    ORDER BY source.rank, source.at DESC, source.tie DESC
  LOOP
    digits := split_part(
      COALESCE(
        platform_private.resolve_waha_conversation_chat(
          evidence.raw_payload -> 'payload',
          (evidence.raw_payload #> '{payload,fromMe}') = 'true'::JSONB,
          evidence.raw_payload -> 'me'
        ) ->> 'phone_chat_id',
        ''
      ),
      '@',
      1
    );
    IF digits ~ '^[1-9][0-9]{6,14}$' THEN
      RETURN digits;
    END IF;
  END LOOP;

  RETURN NULL;
END
$$;

-- Name and masked number of one WhatsApp chat whose subject is still the
-- chain's generated one; no row when the chat is not such a chat or no number
-- is known (the screen keeps the subject).
CREATE FUNCTION platform_private.waha_conversation_contact(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  contact_name TEXT,
  contact_phone TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation platform.communication_conversations%ROWTYPE;
  client_name TEXT;
  client_digits TEXT;
  digits TEXT;
BEGIN
  SELECT candidate.*
  INTO conversation
  FROM platform.communication_conversations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_conversation_id;

  IF conversation.id IS NULL
    OR conversation.waha_session_name IS NULL
    OR NOT platform_private.waha_generated_conversation_subject(
      conversation.subject,
      conversation.id
    )
  THEN
    RETURN;
  END IF;

  digits := platform_private.waha_conversation_phone_digits(
    p_organization_id,
    p_conversation_id
  );
  IF digits IS NULL
    OR (
      conversation.subject ~ '^WhatsApp ••••[0-9]{4}$'
      AND right(digits, 4) <> right(conversation.subject, 4)
    )
  THEN
    RETURN;
  END IF;

  SELECT btrim(client.display_name),
    NULLIF(regexp_replace(COALESCE(client.normalized_phone, ''), '[^0-9]', '', 'g'), '')
  INTO client_name, client_digits
  FROM platform.clients AS client
  WHERE client.organization_id = p_organization_id
    AND client.id = conversation.canonical_client_id;

  -- A typed or captured client name only for a member who may read that
  -- client; everyone else who reads the chat sees the profile name.
  IF client_name IS NOT NULL
    AND NOT platform_private.waha_generated_client_name(
      client_name,
      COALESCE(client_digits, digits),
      conversation.subject,
      conversation.id
    )
    AND COALESCE(
      private.platform_can_read_canonical_client(
        p_organization_id,
        conversation.canonical_client_id
      ),
      FALSE
    )
  THEN
    contact_name := client_name;
  ELSE
    contact_name := platform_private.waha_conversation_push_name(
      p_organization_id,
      p_conversation_id
    );
  END IF;
  contact_phone := platform_private.whatsapp_masked_phone(digits);
  RETURN NEXT;
END
$$;

-- ------------------------------------------------------------
-- 3. Capture into the canonical client.
-- ------------------------------------------------------------

-- Renames the chat's canonical client from a placeholder of the WhatsApp chain
-- to the profile name (or «WhatsApp <masked number>»). Returns what happened:
-- renamed | unchanged | kept (not a placeholder) | no_client | skipped |
-- busy (another transaction holds the client row; nothing waits).
CREATE FUNCTION platform_private.refresh_waha_client_contact_name(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conversation platform.communication_conversations%ROWTYPE;
  client platform.clients%ROWTYPE;
  digits TEXT;
  target_name TEXT;
BEGIN
  SELECT candidate.*
  INTO conversation
  FROM platform.communication_conversations AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_conversation_id;

  IF conversation.id IS NULL
    OR conversation.waha_session_name IS NULL
    OR conversation.canonical_client_id IS NULL
  THEN
    RETURN 'no_client';
  END IF;

  SELECT candidate.*
  INTO client
  FROM platform.clients AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = conversation.canonical_client_id;

  IF client.id IS NULL OR client.lifecycle_state = 'merged' THEN
    RETURN 'skipped';
  END IF;

  digits := NULLIF(
    regexp_replace(COALESCE(client.normalized_phone, ''), '[^0-9]', '', 'g'),
    ''
  );
  IF digits !~ '^[1-9][0-9]{6,14}$' THEN
    digits := NULL;
  END IF;

  IF NOT platform_private.waha_generated_client_name(
    client.display_name,
    digits,
    conversation.subject,
    conversation.id
  ) THEN
    RETURN 'kept';
  END IF;

  target_name := COALESCE(
    platform_private.waha_conversation_push_name(
      p_organization_id,
      p_conversation_id
    ),
    CASE
      WHEN digits IS NOT NULL
        THEN 'WhatsApp ' || platform_private.whatsapp_masked_phone(digits)
    END
  );

  IF target_name IS NULL OR target_name = client.display_name THEN
    RETURN 'unchanged';
  END IF;

  -- Never wait on a client row another transaction holds (a merge, a parallel
  -- projection, the backfill): the same row lock the UPDATE takes, or skip.
  PERFORM 1
  FROM platform.clients AS locked
  WHERE locked.organization_id = p_organization_id
    AND locked.id = client.id
  FOR NO KEY UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN 'busy';
  END IF;

  -- Compare-and-set on the placeholder read above: a concurrent rename wins.
  UPDATE platform.clients AS target
  SET display_name = target_name,
      normalized_name = platform_private.normalize_person_name(target_name)
  WHERE target.organization_id = p_organization_id
    AND target.id = client.id
    AND target.display_name = client.display_name
    AND target.lifecycle_state <> 'merged';

  RETURN CASE WHEN FOUND THEN 'renamed' ELSE 'unchanged' END;
END
$$;

-- Cosmetic: never fails the message projection and never waits on a client
-- row lock (see refresh_waha_client_contact_name). (A projected
-- customer message carries no session name of its own; the conversation does,
-- and the refresh checks it.)
CREATE FUNCTION platform_private.capture_waha_contact_name_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(current_setting('evo.waha_history_import', TRUE), '') = 'on' THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM platform_private.refresh_waha_client_contact_name(
      NEW.organization_id,
      NEW.conversation_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'WhatsApp contact name was not captured (SQLSTATE %)', SQLSTATE;
  END;
  RETURN NULL;
END
$$;

CREATE FUNCTION platform_private.capture_waha_contact_name_from_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.waha_session_name IS NULL
    OR COALESCE(current_setting('evo.waha_history_import', TRUE), '') = 'on'
  THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM platform_private.refresh_waha_client_contact_name(
      NEW.organization_id,
      NEW.id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'WhatsApp contact name was not captured (SQLSTATE %)', SQLSTATE;
  END;
  RETURN NULL;
END
$$;

CREATE TRIGGER communication_messages_waha_contact_name
  AFTER INSERT ON platform.communication_messages
  FOR EACH ROW
  WHEN (
    NEW.direction = 'inbound'
    AND NEW.source_webhook_event_id IS NOT NULL
  )
  EXECUTE FUNCTION platform_private.capture_waha_contact_name_from_message();

CREATE TRIGGER communication_conversations_waha_contact_name
  AFTER UPDATE OF canonical_client_id ON platform.communication_conversations
  FOR EACH ROW
  WHEN (
    NEW.canonical_client_id IS NOT NULL
    AND NEW.canonical_client_id IS DISTINCT FROM OLD.canonical_client_id
  )
  EXECUTE FUNCTION platform_private.capture_waha_contact_name_from_conversation();

-- ------------------------------------------------------------
-- 4. Staff reader.
-- ------------------------------------------------------------

CREATE FUNCTION platform.staff_whatsapp_contacts(
  p_organization_id UUID,
  p_conversation_ids UUID[]
)
RETURNS TABLE (
  conversation_id UUID,
  contact_name TEXT,
  contact_phone TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_organization_id IS NULL
    OR p_conversation_ids IS NULL
    OR cardinality(p_conversation_ids) < 1
    OR cardinality(p_conversation_ids) > 60
    OR array_position(p_conversation_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Organization and 1..60 conversation ids are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  WITH readable AS MATERIALIZED (
    SELECT DISTINCT requested.id
    FROM unnest(p_conversation_ids) AS requested(id)
    WHERE COALESCE(
      private.platform_can_read_communication_full(
        p_organization_id,
        requested.id
      ),
      FALSE
    )
  )
  SELECT readable.id, contact.contact_name, contact.contact_phone
  FROM readable
  CROSS JOIN LATERAL platform_private.waha_conversation_contact(
    p_organization_id,
    readable.id
  ) AS contact
  ORDER BY readable.id;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.whatsapp_masked_phone(TEXT),
  platform_private.waha_generated_conversation_subject(TEXT, UUID),
  platform_private.waha_generated_client_name(TEXT, TEXT, TEXT, UUID),
  platform_private.waha_conversation_push_name(UUID, UUID),
  platform_private.waha_conversation_phone_digits(UUID, UUID),
  platform_private.waha_conversation_contact(UUID, UUID),
  platform_private.refresh_waha_client_contact_name(UUID, UUID),
  platform_private.capture_waha_contact_name_from_message(),
  platform_private.capture_waha_contact_name_from_conversation()
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.staff_whatsapp_contacts(UUID, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_whatsapp_contacts(UUID, UUID[])
  TO authenticated;

COMMENT ON FUNCTION platform.staff_whatsapp_contacts(UUID, UUID[]) IS
  'Migration 278: contact name (a typed client name the member may read under client.read, else the latest WhatsApp profile name of a verified customer message, else NULL) and the number masked to the country code and last six digits for up to 60 WhatsApp chats the member reads in full; only chats whose subject is the WAHA chain''s generated one and whose number is known.';
COMMENT ON FUNCTION platform_private.refresh_waha_client_contact_name(UUID, UUID) IS
  'Migration 278: renames a WhatsApp chat''s canonical client from a WAHA-chain placeholder to the customer''s profile name (else «WhatsApp <masked number>»); never touches any other name.';

-- ------------------------------------------------------------
-- 5. Backfill: every existing WhatsApp chat with a canonical client, once.
-- ------------------------------------------------------------

DO $n278_backfill$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT conversation.organization_id, conversation.id
    FROM platform.communication_conversations AS conversation
    WHERE conversation.waha_session_name IS NOT NULL
      AND conversation.canonical_client_id IS NOT NULL
    ORDER BY conversation.organization_id, conversation.created_at, conversation.id
    LIMIT 10000
  LOOP
    PERFORM platform_private.refresh_waha_client_contact_name(
      target.organization_id,
      target.id
    );
  END LOOP;
END
$n278_backfill$;

COMMIT;
