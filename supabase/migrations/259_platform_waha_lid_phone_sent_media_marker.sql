-- ============================================================
-- 259_platform_waha_lid_phone_sent_media_marker.sql
--
-- Direct WAHA -> CRM ingress (no lead-agent, no amoCRM): the whole sales
-- WhatsApp correspondence lives in the CRM. Three projection gaps, one
-- migration, no provider call and no production action:
--
--  1. @lid direct chats. WhatsApp may report a customer by an opaque LID
--     (`<digits>@lid`) instead of the phone JID. The private direct-chat
--     binding now accepts `<digits>@lid` as well as `<digits>@c.us` and stays on
--     the chat id WAHA reports in `from` (the id a reply must be sent to; the
--     manual-send claim already returns the bound id unchanged). The phone is
--     read ONLY from the payload's explicit alternative-JID fields
--     (`_data.key.remoteJidAlt` for NOWEB, `_data.Info.SenderAlt` /
--     `_data.Info.RecipientAlt` for GOWS: WAHA 2026.8.1 release notes, "fill the
--     phone number (_data.Info.SenderAlt) from the LID store"). With no phone the
--     client has NO phone and is named by the sanitized push name or
--     «WhatsApp контакт» plus a short random suffix; LID digits are never turned
--     into a phone number. The canonical client/lead identity is keyed on the
--     phone chat id when a phone is known, so a chat reported as `@lid` with a
--     phone and the same person's `@c.us` chat resolve to ONE client and lead.
--  2. Messages the sales team sends from the phone / WhatsApp app (`fromMe`
--     with `source = 'app'`) are projected as OUTBOUND messages of the same
--     conversation under their own identity source `private_waha_phone_binding`
--     (not a manual-send authorization). `source = 'api'` events are the CRM's
--     own sends echoing back and are never projected, so nothing is duplicated;
--     a raw id already bound by manual send or by an earlier event is skipped.
--     A phone-sent message to a chat WITHOUT a conversation does not create a
--     conversation, binding or lead (every lead/conversation reader requires the
--     binding's source event to be an inbound customer message): it is recorded
--     as a deferred result and projected, in order, when the customer's first
--     inbound message creates the conversation (the 200 most recent per chat;
--     how many were deferred, projected and dropped is kept in that
--     projection's result).
--  3. Typed media marker: «📎 Фото|Видео|Голосовое сообщение|Аудио|Стикер —
--     откройте в WhatsApp продаж» or «📎 Файл: <имя> — откройте в WhatsApp
--     продаж», the caption on the next line. Media is never downloaded. A
--     media-only message keeps the staff handoff; empty, non-media events keep
--     the generic review notice.
--
-- Not changed: the history reconciliation, media archive and lead-agent
-- routines keep the c.us-only normalizer they were written against.
--
-- Known limitations (deliberate, documented):
--  * The LID <-> phone link is read only from the one event being projected.
--    A person first seen by LID alone keeps the LID identity and no phone; a
--    later event that names the phone does not rewrite that client. A later
--    `@c.us` chat of the same person is matched to the LID chat only when its
--    payload also names the LID; otherwise it is a separate conversation whose
--    client the existing duplicate-candidate review can flag by phone.
--  * Phone-alternative and push-name field names follow the WAHA release notes
--    and issues cited above and are engine specific; when none is present the
--    safe fallbacks (no phone, «WhatsApp контакт») apply.
--  * A phone-sent message is deferred without a time limit; the 200 most recent
--    per chat are projected into the conversation a customer message creates
--    and the rest are counted as dropped in that projection's result.
--  * ACKs of a phone-sent message whose projection recorded it as deferred (or
--    of a CRM API send whose provider id manual send already bound) are answered
--    as observed instead of retried: no projected message exists for them to
--    update, and they are not replayed when the message is backfilled, so a
--    backfilled message may show no delivery state. An ACK of a message that is
--    only not projected yet keeps the retry.
--  * Groups, Status, broadcast lists and channels are never conversations.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Chat identity grammar and payload helpers (private, definer, empty
--    search_path, executable by no client role).
-- ------------------------------------------------------------

CREATE FUNCTION platform_private.normalize_waha_conversation_chat_id(
  p_chat_id TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN lower(btrim(p_chat_id)) ~ '^[0-9]{5,32}@lid$' THEN
      lower(btrim(p_chat_id))
    ELSE platform_private.normalize_waha_direct_chat_id(p_chat_id)
  END
$$;

-- The phone JID of a LID chat, taken only from the explicit alternative
-- fields. For a message sent from the phone the sender is the sales account
-- itself, so only the recipient/remote alternatives are read.
CREATE FUNCTION platform_private.waha_payload_phone_chat_id(
  p_payload JSONB,
  p_from_me BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate TEXT;
  normalized TEXT;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  FOREACH candidate IN ARRAY ARRAY[
    CASE
      WHEN p_from_me IS TRUE THEN p_payload #>> '{_data,Info,RecipientAlt}'
      ELSE p_payload #>> '{_data,Info,SenderAlt}'
    END,
    p_payload #>> '{_data,key,remoteJidAlt}'
  ]
  LOOP
    IF candidate IS NOT NULL THEN
      -- A JID may carry a device suffix: 79990000000:12@s.whatsapp.net.
      normalized := platform_private.normalize_waha_direct_chat_id(
        regexp_replace(btrim(candidate), ':[0-9]+@', '@')
      );
      IF normalized ~ '^[1-9][0-9]{6,14}@c[.]us$' THEN
        RETURN normalized;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END
$$;

-- The customer's WhatsApp profile name, made safe to display: control,
-- zero-width and bidirectional-override characters removed, whitespace
-- collapsed, at most 60 characters. Engine-specific location: WEBJS
-- `_data.notifyName`, NOWEB `_data.pushName`, GOWS `_data.Info.PushName`.
CREATE FUNCTION platform_private.waha_payload_push_name(
  p_payload JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NULLIF(
    btrim(
      left(
        btrim(
          regexp_replace(
            regexp_replace(
              COALESCE(
                p_payload #>> '{_data,notifyName}',
                p_payload #>> '{_data,pushName}',
                p_payload #>> '{_data,Info,PushName}'
              ),
              E'[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
              '',
              'g'
            ),
            E'[[:space:][:cntrl:]]+',
            ' ',
            'g'
          )
        ),
        60
      )
    ),
    ''
  )
$$;

-- The one direct chat a message belongs to. `chat_id` is the id WAHA reports
-- (`from` for a customer message, `to` for one sent from the phone); that is
-- the id the binding is kept on and replies are sent to. `alt_chat_id` is the
-- same person's other form when the payload itself carries it (a LID chat with a
-- phone, or a phone chat with a LID); candidates of the same kind must agree.
CREATE FUNCTION platform_private.resolve_waha_conversation_chat(
  p_payload JSONB,
  p_from_me BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidates TEXT[];
  candidate TEXT;
  normalized TEXT;
  primary_chat TEXT;
  lid_chat TEXT;
  phone_chat TEXT;
BEGIN
  candidates := CASE
    WHEN p_from_me IS TRUE THEN ARRAY[
      NULLIF(btrim(p_payload ->> 'to'), ''),
      NULLIF(btrim(p_payload ->> 'chatId'), ''),
      NULLIF(btrim(p_payload #>> '{_data,to}'), ''),
      NULLIF(btrim(p_payload #>> '{_data,id,remote}'), '')
    ]
    ELSE ARRAY[
      NULLIF(btrim(p_payload ->> 'from'), ''),
      NULLIF(btrim(p_payload ->> 'chatId'), ''),
      NULLIF(btrim(p_payload #>> '{_data,from}'), ''),
      NULLIF(btrim(p_payload #>> '{_data,id,remote}'), '')
    ]
  END;

  FOREACH candidate IN ARRAY candidates LOOP
    IF candidate IS NULL THEN
      CONTINUE;
    END IF;

    normalized := platform_private.normalize_waha_conversation_chat_id(
      candidate
    );
    IF normalized IS NULL THEN
      RETURN jsonb_build_object('error', 'unsupported_chat');
    END IF;

    IF primary_chat IS NULL THEN
      primary_chat := normalized;
    END IF;

    IF normalized LIKE '%@lid' THEN
      IF lid_chat IS NULL THEN
        lid_chat := normalized;
      ELSIF lid_chat <> normalized THEN
        RETURN jsonb_build_object('error', 'chat_conflict');
      END IF;
    ELSIF phone_chat IS NULL THEN
      phone_chat := normalized;
    ELSIF phone_chat <> normalized THEN
      RETURN jsonb_build_object('error', 'chat_conflict');
    END IF;
  END LOOP;

  IF primary_chat IS NULL THEN
    RETURN jsonb_build_object('error', 'chat_required');
  END IF;

  IF phone_chat IS NULL THEN
    phone_chat := platform_private.waha_payload_phone_chat_id(
      p_payload,
      p_from_me
    );
  END IF;

  RETURN jsonb_build_object(
    'chat_id', primary_chat,
    'alt_chat_id', CASE
      WHEN primary_chat LIKE '%@lid' THEN phone_chat
      ELSE lid_chat
    END,
    'phone_chat_id', phone_chat,
    'lid_chat_id', lid_chat
  );
END
$$;

-- Message text and media marker. `body` is what the conversation stores: the
-- text, or for media a typed marker with the caption on the next line. WAHA
-- reports media as `hasMedia` and/or a `media` object with `mimetype` and
-- `filename`; the caption travels in `body`
-- (https://waha.devlike.pro/docs/how-to/receive-messages/). `legacy_body` is
-- what migration 060 stored for the same payload, so a re-delivery of a message
-- projected before this migration is still recognised as the same message.
CREATE FUNCTION platform_private.waha_message_content(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generic_marker CONSTANT TEXT :=
    '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.';
  text_body TEXT;
  has_media BOOLEAN;
  mime TEXT;
  data_type TEXT;
  file_name TEXT;
  kind TEXT;
  marker TEXT;
BEGIN
  text_body := CASE
    WHEN jsonb_typeof(p_payload -> 'body') = 'string'
      THEN NULLIF(btrim(p_payload ->> 'body'), '')
    ELSE NULL
  END;
  has_media := COALESCE(p_payload -> 'hasMedia' = 'true'::JSONB, FALSE)
    OR COALESCE(jsonb_typeof(p_payload -> 'media') = 'object', FALSE);

  IF NOT has_media THEN
    RETURN jsonb_build_object(
      'has_media', FALSE,
      'media_only', FALSE,
      'text', text_body,
      'body', text_body,
      'legacy_body', COALESCE(text_body, generic_marker)
    );
  END IF;

  mime := lower(
    COALESCE(
      NULLIF(btrim(p_payload #>> '{media,mimetype}'), ''),
      NULLIF(btrim(p_payload #>> '{_data,mimetype}'), ''),
      ''
    )
  );
  data_type := lower(COALESCE(NULLIF(btrim(p_payload #>> '{_data,type}'), ''), ''));
  file_name := NULLIF(
    btrim(
      left(
        btrim(
          regexp_replace(
            regexp_replace(
              COALESCE(
                p_payload #>> '{media,filename}',
                p_payload #>> '{_data,filename}'
              ),
              E'[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
              '',
              'g'
            ),
            E'[[:space:][:cntrl:]]+',
            ' ',
            'g'
          )
        ),
        120
      )
    ),
    ''
  );

  kind := CASE
    WHEN data_type = 'sticker' THEN 'Стикер'
    WHEN data_type = 'document' THEN 'Файл'
    WHEN data_type = 'ptt'
      OR (mime ~ '^audio/ogg' AND data_type = '') THEN 'Голосовое сообщение'
    WHEN mime ~ '^audio/' OR data_type = 'audio' THEN 'Аудио'
    WHEN mime ~ '^image/' OR data_type = 'image' THEN 'Фото'
    WHEN mime ~ '^video/' OR data_type IN ('video', 'gif') THEN 'Видео'
    ELSE 'Файл'
  END;
  marker := CASE
    WHEN kind = 'Файл' AND file_name IS NOT NULL
      THEN '📎 Файл: ' || file_name || ' — откройте в WhatsApp продаж'
    ELSE '📎 ' || kind || ' — откройте в WhatsApp продаж'
  END;

  RETURN jsonb_build_object(
    'has_media', TRUE,
    'media_only', text_body IS NULL,
    'media_kind', kind,
    'text', text_body,
    'body', marker || CASE
      WHEN text_body IS NULL THEN ''
      ELSE E'\n' || text_body
    END,
    'legacy_body', COALESCE(text_body, generic_marker)
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.normalize_waha_conversation_chat_id(TEXT),
  platform_private.waha_payload_phone_chat_id(JSONB, BOOLEAN),
  platform_private.waha_payload_push_name(JSONB),
  platform_private.resolve_waha_conversation_chat(JSONB, BOOLEAN),
  platform_private.waha_message_content(JSONB)
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ------------------------------------------------------------
-- 2. A LID chat can be bound; a phone-sent message is a distinct, evidenced
--    outbound source.
-- ------------------------------------------------------------

ALTER TABLE platform_private.waha_direct_chat_bindings
  DROP CONSTRAINT waha_direct_chat_bindings_normalized_chat_id_check;
ALTER TABLE platform_private.waha_direct_chat_bindings
  ADD CONSTRAINT waha_direct_chat_bindings_normalized_chat_id_check CHECK (
    normalized_chat_id ~ '^[0-9]+@c[.]us$'
    OR normalized_chat_id ~ '^[0-9]{5,32}@lid$'
  );

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_direction_shape_check;
ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_direction_shape_check CHECK (
    (
      direction = 'inbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
      AND autonomous_reply_intent_id IS NULL
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NULL
      AND message_identity_source = 'private_waha_history_binding'
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NOT NULL
      AND message_identity_source = 'private_autonomous_reply_binding'
    )
    OR (
      direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND autonomous_reply_intent_id IS NULL
      AND message_identity_source = 'private_waha_phone_binding'
    )
  );

ALTER TABLE platform.communication_messages
  DROP CONSTRAINT communication_messages_provider_identity_check;
ALTER TABLE platform.communication_messages
  ADD CONSTRAINT communication_messages_provider_identity_check CHECK (
    (
      message_identity_source = 'public_provider_id'
      AND autonomous_reply_intent_id IS NULL
      AND (waha_message_id IS NOT NULL OR kommo_message_id IS NOT NULL)
    )
    OR (
      message_identity_source = 'private_waha_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction = 'inbound'
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_waha_history_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction IN ('inbound', 'outbound')
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_autonomous_reply_binding'
      AND autonomous_reply_intent_id IS NOT NULL
      AND direction = 'outbound'
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_manual_send_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction = 'outbound'
      AND manual_send_authorization_id IS NOT NULL
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
    OR (
      message_identity_source = 'private_waha_phone_binding'
      AND autonomous_reply_intent_id IS NULL
      AND direction = 'outbound'
      AND manual_send_authorization_id IS NULL
      AND waha_session_name IS NULL
      AND waha_message_id IS NULL
      AND kommo_account_id IS NULL
      AND kommo_conversation_id IS NULL
      AND kommo_message_id IS NULL
      AND amocrm_account_id IS NULL
      AND amocrm_lead_id IS NULL
      AND amocrm_contact_id IS NULL
    )
  );

COMMENT ON COLUMN platform.communication_messages.message_identity_source IS
  'Immutable provenance: public provider id, signed inbound private WAHA binding, explicit read-only private WAHA history binding, or a message the sales team sent from the phone/app (private_waha_phone_binding, evidenced by a verified fromMe event with source app).';

-- The private binding behind a WAHA message stays exact. A phone-sent message
-- must additionally be proven by its own verified fromMe/source=app event.
CREATE OR REPLACE FUNCTION platform_private.require_private_waha_message_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  RETURN NEW;
END
$$;

-- A phone-sent message may be acknowledged like any other bound outbound
-- message: the new source joins the ACK projector's allow-list. An ACK with no
-- message to update (a deferred phone-sent message, a manual-send-bound id) is
-- answered as observed. The projector's owner, grants, definer, search_path and
-- volatility must not change.
DO $ack_phone_sent$
DECLARE
  target CONSTANT REGPROCEDURE :=
    'platform.project_claimed_waha_observation_p5e(uuid,uuid,uuid,uuid,uuid)'::REGPROCEDURE;
  definition TEXT := pg_catalog.pg_get_functiondef(target);
  needle CONSTANT TEXT :=
    E'''private_waha_binding'',\n          ''private_waha_history_binding''\n        )';
  replacement CONSTANT TEXT :=
    E'''private_waha_binding'',\n          ''private_waha_history_binding'',\n          ''private_waha_phone_binding''\n        )';
  -- An ACK for a message that has no private message binding is retried while
  -- the binding may still appear (a send racing its own binding). It is not
  -- retried when there is nothing to bind: the message is a phone-sent one
  -- whose projection RECORDED it as deferred (no conversation yet), or its id
  -- is already bound by manual send, whose ACK state is read back by the exact
  -- reconciliation, not by this projector. A phone-sent message that is merely
  -- not projected yet (in flight, awaiting a retry) has no such record, so its
  -- ACK keeps the retry and is applied once the message is bound.
  pending_needle CONSTANT TEXT :=
    E'      IF message_binding.id IS NULL THEN\n        error_code := ''waha_ack_binding_pending'';';
  pending_replacement CONSTANT TEXT :=
    E'      IF message_binding.id IS NULL\n        AND (\n          EXISTS (\n            SELECT 1\n            FROM platform_private.manual_send_provider_bindings AS manual_binding\n            WHERE manual_binding.organization_id = p_organization_id\n              AND manual_binding.waha_session_name = source_event.waha_session_name\n              AND manual_binding.raw_message_id = ack_raw_message_id\n          )\n          OR EXISTS (\n            SELECT 1\n            FROM platform_private.provider_webhook_events AS original\n            JOIN platform_private.waha_work_projection_effects AS deferred_effect\n              ON deferred_effect.organization_id = original.organization_id\n             AND deferred_effect.source_webhook_event_id = original.id\n            WHERE original.organization_id = p_organization_id\n              AND original.provider = ''waha''\n              AND original.waha_session_name = source_event.waha_session_name\n              AND original.verification_status = ''verified''\n              AND original.event_type IN (''message'', ''message.any'')\n              AND original.payload_id = ack_raw_message_id\n              AND original.raw_payload #> ''{payload,fromMe}'' = ''true''::JSONB\n              AND lower(COALESCE(original.raw_payload #>> ''{payload,source}'', '''')) = ''app''\n              AND deferred_effect.result ? ''deferred_chat_ids''\n          )\n        )\n      THEN\n        evidence_ref := ''waha-observation:'' || source_event.id::TEXT\n          || '':ack_without_projected_message'';\n        result := platform_private.p5b_projection_result(\n          p_organization_id,\n          p_work_item_id,\n          p_attempt_id,\n          ''succeeded'',\n          evidence_ref,\n          NULL\n        ) || jsonb_build_object(\n          ''ignored'', ''ack_without_projected_message''\n        );\n        -- An effect for an ACK must name its message; there is none.\n        persist_effect := FALSE;\n        EXIT project_observation;\n      END IF;\n\n' || pending_needle;
  before_contract RECORD;
  after_contract RECORD;
BEGIN
  IF (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, needle, ''))
  ) <> pg_catalog.length(needle)
  OR (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, pending_needle, ''))
  ) <> pg_catalog.length(pending_needle) THEN
    RAISE EXCEPTION
      'The ACK projector allow-list or pending-binding branch is not the expected single occurrence'
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO before_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  EXECUTE pg_catalog.replace(
    pg_catalog.replace(definition, needle, replacement),
    pending_needle,
    pending_replacement
  );

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO after_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  IF after_contract IS DISTINCT FROM before_contract THEN
    RAISE EXCEPTION
      'Migration 259 changed a protected routine contract'
      USING ERRCODE = '55000';
  END IF;
END
$ack_phone_sent$;

-- The durable queue admits only explicitly inbound message events. Admit also a
-- verified message sent from the phone/app (fromMe with source app); an own API
-- send and an event with missing direction evidence still fail closed. The
-- routine's owner, grants, definer, search_path and volatility must not change.
DO $enqueue_phone_sent$
DECLARE
  target CONSTANT REGPROCEDURE :=
    'platform.enqueue_verified_webhook_work(uuid,uuid,text,integer,uuid)'::REGPROCEDURE;
  definition TEXT := pg_catalog.pg_get_functiondef(target);
  needle CONSTANT TEXT :=
    E'    AND (\n      incoming_event.raw_payload #> ''{payload,fromMe}''\n        IS DISTINCT FROM ''false''::JSONB\n      OR lower(COALESCE(\n        incoming_event.raw_payload #>> ''{payload,source}'',\n        ''''\n      )) = ''api''\n    )';
  replacement CONSTANT TEXT :=
    E'    AND NOT COALESCE(\n      (\n        incoming_event.raw_payload #> ''{payload,fromMe}'' = ''false''::JSONB\n        AND lower(COALESCE(\n          incoming_event.raw_payload #>> ''{payload,source}'',\n          ''''\n        )) <> ''api''\n      )\n      OR (\n        incoming_event.raw_payload #> ''{payload,fromMe}'' = ''true''::JSONB\n        AND lower(COALESCE(\n          incoming_event.raw_payload #>> ''{payload,source}'',\n          ''''\n        )) = ''app''\n      ),\n      FALSE\n    )';
  before_contract RECORD;
  after_contract RECORD;
BEGIN
  IF (
    pg_catalog.length(definition)
    - pg_catalog.length(pg_catalog.replace(definition, needle, ''))
  ) <> pg_catalog.length(needle) THEN
    RAISE EXCEPTION
      'The WAHA enqueue direction gate is not the expected single occurrence'
      USING ERRCODE = '55000';
  END IF;

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO before_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  EXECUTE pg_catalog.replace(definition, needle, replacement);

  SELECT routine.proowner, routine.proacl, routine.prosecdef,
    routine.proconfig, routine.provolatile, routine.proleakproof,
    routine.proparallel
  INTO after_contract
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = target::OID;

  IF after_contract IS DISTINCT FROM before_contract THEN
    RAISE EXCEPTION
      'Migration 259 changed a protected routine contract'
      USING ERRCODE = '55000';
  END IF;
END
$enqueue_phone_sent$;

-- ------------------------------------------------------------
-- 3. Canonical client/lead identity for a verified inbound direct chat. The
--    chat id stays the binding; the identity key is the phone chat id when the
--    payload gives a phone, otherwise the LID chat itself. A LID without a phone
--    yields a client without a phone.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_private.bind_waha_chat_to_canonical(
  p_organization_id UUID,
  p_binding_id UUID
)
RETURNS VOID
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
BEGIN
  IF p_organization_id IS NULL OR p_binding_id IS NULL THEN
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
    AND event.id = binding.source_webhook_event_id;

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

  -- Other historical/future binding lanes may reuse this private table. They
  -- remain untouched; only a verified direct inbound ingress observation is
  -- canonical Sales intake. A chat first seen through a message the sales team
  -- sent from the phone is bound by projection only once a customer message
  -- exists, so it never reaches this point as an outgoing-only chat.
  IF source_event.provider <> 'waha'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB
    OR lower(COALESCE(btrim(payload ->> 'source'), '')) = 'api'
  THEN
    RETURN;
  END IF;

  chat := platform_private.resolve_waha_conversation_chat(payload, FALSE);

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

  -- Other verified WAHA lanes, including the legacy Lead-Agent sync path, may
  -- append the same private binding table. They must remain writable without
  -- acquiring the U3 canonical Sales identity contract.
  IF conversation.sales_authority_source <> 'platform_intake'
    OR conversation.queue <> 'sales'
    OR conversation.responsible_sales_membership_id IS NULL
  THEN
    RETURN;
  END IF;

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
    conversation.responsible_sales_membership_id,
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
END
$$;

-- ------------------------------------------------------------
-- 4. A message the sales team sent from the phone/app.
-- ------------------------------------------------------------

-- Projects one verified fromMe/source=app event as an outbound message of an
-- existing conversation. Idempotent: a raw message id that is already bound
-- (here or by manual send) is never inserted twice. Returns {outcome, ...}:
-- projected | duplicate | crm_send_echo | empty | source_unverified |
-- message_id_invalid | conflict.
CREATE FUNCTION platform_private.project_waha_phone_sent_message(
  p_organization_id UUID,
  p_source_event_id UUID,
  p_conversation_id UUID,
  p_sales_participant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_event platform_private.provider_webhook_events%ROWTYPE;
  payload JSONB;
  content JSONB;
  provider_source TEXT;
  message_raw_id TEXT;
  existing_binding platform_private.waha_message_bindings%ROWTYPE;
  existing_message platform.communication_messages%ROWTYPE;
  created_message_id UUID := gen_random_uuid();
BEGIN
  SELECT event.*
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = p_source_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:crm_primary'
    OR source_event.waha_session_name <> 'crm_primary'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
    OR jsonb_typeof(source_event.raw_payload -> 'payload') IS DISTINCT FROM 'object'
    OR source_event.raw_payload -> 'payload' -> 'fromMe' IS DISTINCT FROM 'true'::JSONB
  THEN
    RAISE EXCEPTION
      'Verified tenant-matched fromMe WAHA message evidence is required'
      USING ERRCODE = '42501';
  END IF;

  payload := source_event.raw_payload -> 'payload';
  provider_source := lower(COALESCE(btrim(payload ->> 'source'), ''));
  IF provider_source = 'api' THEN
    -- The CRM's own API send echoing back; its message is already the
    -- outbound row created by manual send.
    RETURN jsonb_build_object('outcome', 'crm_send_echo');
  ELSIF provider_source <> 'app' THEN
    RETURN jsonb_build_object('outcome', 'source_unverified');
  END IF;

  message_raw_id := NULLIF(btrim(payload ->> 'id'), '');
  IF message_raw_id IS NULL
    OR message_raw_id IS DISTINCT FROM source_event.payload_id
  THEN
    RETURN jsonb_build_object('outcome', 'message_id_invalid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform_private.manual_send_provider_bindings AS manual_binding
    WHERE manual_binding.organization_id = p_organization_id
      AND manual_binding.waha_session_name = source_event.waha_session_name
      AND manual_binding.raw_message_id = message_raw_id
  ) THEN
    RETURN jsonb_build_object('outcome', 'crm_send_echo');
  END IF;

  content := platform_private.waha_message_content(payload);
  IF (content ->> 'body') IS NULL THEN
    RETURN jsonb_build_object('outcome', 'empty');
  END IF;

  SELECT binding.*
  INTO existing_binding
  FROM platform_private.waha_message_bindings AS binding
  WHERE binding.organization_id = p_organization_id
    AND binding.waha_session_name = source_event.waha_session_name
    AND binding.raw_message_id = message_raw_id;

  IF existing_binding.id IS NOT NULL THEN
    SELECT message.*
    INTO existing_message
    FROM platform.communication_messages AS message
    WHERE message.organization_id = p_organization_id
      AND message.id = existing_binding.communication_message_id;

    IF existing_message.id IS NULL
      OR existing_message.conversation_id <> p_conversation_id
      OR existing_message.direction <> 'outbound'
      OR existing_message.message_identity_source <> 'private_waha_phone_binding'
      OR existing_message.body_text <> (content ->> 'body')
    THEN
      RETURN jsonb_build_object('outcome', 'conflict');
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'duplicate',
      'message_id', existing_message.id
    );
  END IF;

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
    created_message_id,
    p_organization_id,
    p_conversation_id,
    NULL,
    p_sales_participant_id,
    'outbound',
    content ->> 'body',
    'undetermined',
    FALSE,
    'private_waha_phone_binding',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    source_event.id,
    NULL,
    source_event.provider_occurred_at
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
    source_event.waha_session_name,
    message_raw_id,
    created_message_id,
    source_event.id
  );

  RETURN jsonb_build_object(
    'outcome', 'projected',
    'message_id', created_message_id
  );
END
$$;

-- Phone-sent messages that arrived before the conversation existed were
-- recorded as deferred results. When the customer's first message creates the
-- conversation, the 200 MOST RECENT of them are projected in chronological
-- order. Anything older is not projected; the count is returned so the
-- projection can keep it in its result (evidence, not a silent drop).
CREATE FUNCTION platform_private.backfill_waha_deferred_phone_sent(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_sales_participant_id UUID,
  p_chat_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  backfill_limit CONSTANT INTEGER := 200;
  deferred RECORD;
  deferred_count INTEGER;
  projected_count INTEGER := 0;
BEGIN
  SELECT count(DISTINCT effect.source_webhook_event_id)
  INTO deferred_count
  FROM platform_private.waha_work_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.result ? 'deferred_chat_ids'
    AND (effect.result -> 'deferred_chat_ids') ?| p_chat_ids;

  FOR deferred IN
    SELECT recent.event_id
    FROM (
      SELECT DISTINCT
        event.id AS event_id,
        event.provider_occurred_at AS occurred_at
      FROM platform_private.waha_work_projection_effects AS effect
      JOIN platform_private.provider_webhook_events AS event
        ON event.organization_id = effect.organization_id
       AND event.id = effect.source_webhook_event_id
      WHERE effect.organization_id = p_organization_id
        AND effect.result ? 'deferred_chat_ids'
        AND (effect.result -> 'deferred_chat_ids') ?| p_chat_ids
      ORDER BY event.provider_occurred_at DESC, event.id DESC
      LIMIT backfill_limit
    ) AS recent
    ORDER BY recent.occurred_at, recent.event_id
  LOOP
    IF platform_private.project_waha_phone_sent_message(
        p_organization_id,
        deferred.event_id,
        p_conversation_id,
        p_sales_participant_id
      ) ->> 'outcome' = 'projected'
    THEN
      projected_count := projected_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'deferred', deferred_count,
    'projected', projected_count,
    'dropped', GREATEST(deferred_count - backfill_limit, 0)
  );
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.project_waha_phone_sent_message(UUID, UUID, UUID, UUID),
  platform_private.backfill_waha_deferred_phone_sent(UUID, UUID, UUID, TEXT[])
FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE INDEX waha_work_projection_effects_deferred_chat_idx
  ON platform_private.waha_work_projection_effects
  USING GIN ((result -> 'deferred_chat_ids'))
  WHERE result ? 'deferred_chat_ids';

-- ------------------------------------------------------------
-- 5. The projection: LID chats, phone-sent messages and typed media markers.
--    The body is migration 060's with the two later edits (migration 102's
--    crm_primary session, migration 156's intake-owner eligibility) and the
--    changes above; request/claim handling and replay are unchanged.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform.project_claimed_waha_event(p_organization_id uuid, p_work_item_id uuid, p_attempt_id uuid, p_intake_sales_membership_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  work_item platform_private.durable_work_items%ROWTYPE;
  attempt platform_private.durable_work_attempts%ROWTYPE;
  source_event platform_private.provider_webhook_events%ROWTYPE;
  prior_request platform_private.waha_work_projection_requests%ROWTYPE;
  prior_effect platform_private.waha_work_projection_effects%ROWTYPE;
  binding platform_private.waha_direct_chat_bindings%ROWTYPE;
  conversation platform.communication_conversations%ROWTYPE;
  customer_participant platform.conversation_participants%ROWTYPE;
  sales_participant platform.conversation_participants%ROWTYPE;
  message_row platform.communication_messages%ROWTYPE;
  payload JSONB;
  input_sha256 TEXT;
  result JSONB;
  evidence_ref TEXT;
  error_code TEXT;
  persist_effect BOOLEAN := TRUE;
  resolved_chat_id TEXT;
  customer_subject_ref TEXT;
  inbound_body_text TEXT;
  human_review_required BOOLEAN := FALSE;
  human_review_marker CONSTANT TEXT :=
    '[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.';
  source_waha_message_id TEXT;
  created_conversation_id UUID := gen_random_uuid();
  created_scope_id UUID := gen_random_uuid();
  created_customer_participant_id UUID := gen_random_uuid();
  created_sales_participant_id UUID := gen_random_uuid();
  created_message_id UUID := gen_random_uuid();
  handoff_event_id UUID;
  from_me BOOLEAN := FALSE;
  provider_source TEXT;
  content JSONB;
  chat JSONB;
  chat_alt_id TEXT;
  phone_chat_id TEXT;
  conversation_subject TEXT;
  lock_key TEXT;
  outbound_result JSONB;
  deferred_backfill JSONB;
BEGIN
  PERFORM platform_private.require_p2g_service();

  IF p_organization_id IS NULL
    OR p_work_item_id IS NULL
    OR p_attempt_id IS NULL
    OR p_intake_sales_membership_id IS NULL
    OR p_request_id IS NULL
  THEN
    RAISE EXCEPTION
      'Organization, work, attempt, intake Sales membership and request are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('evo:p5b:projection-request:' || p_request_id::TEXT, 0)
  );

  input_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'work_item_id', p_work_item_id,
          'attempt_id', p_attempt_id,
          'intake_sales_membership_id',
            p_intake_sales_membership_id
        )::TEXT,
        'UTF8'
      )
    ),
    'hex'
  );

  SELECT *
  INTO prior_request
  FROM platform_private.waha_work_projection_requests AS request
  WHERE request.request_id = p_request_id;

  IF prior_request.request_id IS NOT NULL THEN
    IF prior_request.input_sha256 <> input_sha256 THEN
      RAISE EXCEPTION
        'request_id was already used for another WAHA projection'
        USING ERRCODE = '22023';
    END IF;
    RETURN prior_request.response;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.audit_events AS audit
    WHERE audit.request_id = p_request_id
  ) OR EXISTS (
    SELECT 1
    FROM platform_private.durable_work_idempotency AS idempotency
    WHERE idempotency.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION
      'request_id was already used for another mutation'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO work_item
  FROM platform_private.durable_work_items AS item
  WHERE item.organization_id = p_organization_id
    AND item.id = p_work_item_id
  FOR UPDATE;

  SELECT *
  INTO attempt
  FROM platform_private.durable_work_attempts AS candidate
  WHERE candidate.organization_id = p_organization_id
    AND candidate.id = p_attempt_id
    AND candidate.work_item_id = p_work_item_id
  FOR UPDATE;

  IF work_item.id IS NULL
    OR attempt.id IS NULL
    OR work_item.kind <> 'provider_webhook_process'
    OR work_item.source_webhook_event_id IS NULL
  THEN
    RAISE EXCEPTION
      'The tenant work item and attempt do not identify WAHA webhook work'
      USING ERRCODE = '42501';
  END IF;

  IF work_item.state <> 'leased'
    OR attempt.finished_at IS NOT NULL
    OR attempt.attempt_number <> work_item.attempt_count
    OR attempt.lease_expires_at <= clock_timestamp()
    OR work_item.leased_until <= clock_timestamp()
  THEN
    RAISE EXCEPTION
      'Only the current non-expired WAHA claim can be projected'
      USING ERRCODE = '55000';
  END IF;

  SELECT *
  INTO source_event
  FROM platform_private.provider_webhook_events AS event
  WHERE event.organization_id = p_organization_id
    AND event.id = work_item.source_webhook_event_id;

  IF source_event.id IS NULL
    OR source_event.provider <> 'waha'
    OR source_event.provider_account_ref <> 'waha:crm_primary'
    OR source_event.waha_session_name <> 'crm_primary'
    OR source_event.verification_status <> 'verified'
    OR source_event.event_type NOT IN ('message', 'message.any')
  THEN
    RAISE EXCEPTION
      'Verified tenant-matched inbound WAHA message evidence is required'
      USING ERRCODE = '42501';
  END IF;

  payload := source_event.raw_payload -> 'payload';

  -- Inbound conversation ownership always requires an active Sales member.
  IF source_event.event_type IN ('message', 'message.any')
    AND NOT platform_private.staff_intake_owner_is_eligible(p_organization_id,p_intake_sales_membership_id)
  THEN
    RAISE EXCEPTION
      'An authorized tenant intake Sales membership is required for inbound projection'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO prior_effect
  FROM platform_private.waha_work_projection_effects AS effect
  WHERE effect.organization_id = p_organization_id
    AND effect.work_item_id = p_work_item_id;

  IF prior_effect.id IS NOT NULL THEN
    result := prior_effect.result || jsonb_build_object(
      'attempt_id', p_attempt_id,
      'deduplicated', TRUE
    );

    RETURN platform_private.p5b_store_projection_result(
      p_organization_id,
      p_work_item_id,
      p_attempt_id,
      source_event.id,
      p_intake_sales_membership_id,
      p_request_id,
      input_sha256,
      result,
      FALSE
    );
  END IF;

  <<project_event>>
  BEGIN
    IF jsonb_typeof(source_event.raw_payload) <> 'object'
      OR jsonb_typeof(payload) <> 'object'
      OR source_event.raw_payload ->> 'event' IS DISTINCT FROM
        source_event.event_type
      OR source_event.raw_payload ->> 'session' IS DISTINCT FROM
        source_event.waha_session_name
    THEN
      error_code := 'waha_event_metadata_mismatch';
      evidence_ref := 'waha-projection:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'terminal_error',
        evidence_ref,
        error_code
      );
      EXIT project_event;
    END IF;

    IF source_event.event_type IN ('message', 'message.any') THEN
      IF payload -> 'fromMe' = 'true'::JSONB THEN
        from_me := TRUE;
      ELSIF payload -> 'fromMe' IS DISTINCT FROM 'false'::JSONB THEN
        error_code := 'waha_inbound_direction_unverified';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      provider_source := lower(COALESCE(btrim(payload ->> 'source'), ''));
      IF NOT from_me AND provider_source = 'api' THEN
        error_code := 'waha_inbound_api_source';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      ELSIF from_me AND provider_source = 'api' THEN
        -- The CRM's own API send echoing back: manual send already created
        -- its outbound message. Nothing to project.
        evidence_ref := 'waha-outbound-ignored:' || source_event.id::TEXT
          || ':crm_send_echo';
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'succeeded', evidence_ref, NULL
        ) || jsonb_build_object('ignored', 'crm_send_echo');
        EXIT project_event;
      ELSIF from_me AND provider_source <> 'app' THEN
        -- Without a verified origin a fromMe message could be the CRM's own
        -- send racing its provider binding; never guess.
        error_code := 'waha_outbound_source_unverified';
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      source_waha_message_id := NULLIF(btrim(payload ->> 'id'), '');
      IF source_waha_message_id IS NULL
        OR source_waha_message_id IS DISTINCT FROM source_event.payload_id
      THEN
        error_code := CASE WHEN from_me
          THEN 'waha_outbound_message_id_invalid'
          ELSE 'waha_inbound_message_id_invalid'
        END;
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      content := platform_private.waha_message_content(payload);
      inbound_body_text := content ->> 'body';

      IF from_me THEN
        IF inbound_body_text IS NULL THEN
          evidence_ref := 'waha-outbound-ignored:' || source_event.id::TEXT
            || ':empty_message';
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'succeeded', evidence_ref, NULL
          ) || jsonb_build_object('ignored', 'empty_message');
          EXIT project_event;
        END IF;
      ELSIF inbound_body_text IS NULL THEN
        -- No text and no media flag: P5B still does not interpret such an
        -- event. Preserve the raw event, expose only this fixed non-customer
        -- marker and create a durable staff handoff below.
        inbound_body_text := human_review_marker;
        human_review_required := TRUE;
      ELSIF (content ->> 'media_only')::BOOLEAN THEN
        -- Media without a caption: the typed marker is the whole message and
        -- the staff handoff stays. The media itself is not downloaded.
        human_review_required := TRUE;
      END IF;

      chat := platform_private.resolve_waha_conversation_chat(payload, from_me);
      IF chat ? 'error' THEN
        error_code := CASE WHEN from_me THEN 'waha_outbound_' ELSE 'waha_inbound_' END
          || (chat ->> 'error');
        evidence_ref := 'waha-projection:' || source_event.id::TEXT
          || ':' || error_code;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'terminal_error', evidence_ref, error_code
        );
        EXIT project_event;
      END IF;

      resolved_chat_id := chat ->> 'chat_id';
      chat_alt_id := chat ->> 'alt_chat_id';
      phone_chat_id := chat ->> 'phone_chat_id';

      -- One lock per form of the same person's chat, always in the same order,
      -- so concurrent events that reach the same person by different ids
      -- cannot create two conversations.
      FOR lock_key IN
        SELECT chat_key.value
        FROM unnest(ARRAY[resolved_chat_id, chat_alt_id]) AS chat_key(value)
        WHERE chat_key.value IS NOT NULL
        GROUP BY chat_key.value
        ORDER BY chat_key.value
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended(
            'evo:p5b:waha-chat:' || p_organization_id::TEXT || ':'
              || source_event.waha_session_name || ':' || lock_key,
            0
          )
        );
      END LOOP;

      SELECT *
      INTO binding
      FROM platform_private.waha_direct_chat_bindings AS candidate
      WHERE candidate.organization_id = p_organization_id
        AND candidate.waha_session_name = source_event.waha_session_name
        AND candidate.normalized_chat_id = resolved_chat_id;

      IF binding.id IS NULL AND chat_alt_id IS NOT NULL THEN
        -- The payload itself names the same person's other chat id.
        SELECT *
        INTO binding
        FROM platform_private.waha_direct_chat_bindings AS candidate
        WHERE candidate.organization_id = p_organization_id
          AND candidate.waha_session_name = source_event.waha_session_name
          AND candidate.normalized_chat_id = chat_alt_id;
      END IF;

      IF binding.id IS NULL AND from_me THEN
        -- A message sent from the phone to a chat without a conversation does
        -- not create a conversation, binding or lead: every reader requires
        -- the binding to come from an inbound customer message. It is kept as
        -- a deferred result and projected when that conversation exists.
        evidence_ref := 'waha-outbound-deferred:' || source_event.id::TEXT;
        result := platform_private.p5b_projection_result(
          p_organization_id, p_work_item_id, p_attempt_id,
          'succeeded', evidence_ref, NULL
        ) || jsonb_build_object(
          'deferred', TRUE,
          'deferred_chat_ids',
            to_jsonb(array_remove(ARRAY[resolved_chat_id, chat_alt_id], NULL)),
          'human_review_required', FALSE
        );
        EXIT project_event;
      END IF;

      IF binding.id IS NULL THEN
        -- Public rows receive an opaque random reference. The private binding
        -- remains the only place that maps it back to the WAHA chat id.
        customer_subject_ref :=
          'waha-participant:' || created_customer_participant_id::TEXT;

        IF resolved_chat_id LIKE '%@c.us' THEN
          conversation_subject := 'WhatsApp ••••' || right(
            split_part(resolved_chat_id, '@', 1),
            4
          );
        ELSIF phone_chat_id IS NOT NULL
          AND split_part(phone_chat_id, '@', 1) ~ '^[0-9]{7,15}$'
        THEN
          conversation_subject := 'WhatsApp ••••' || right(
            split_part(phone_chat_id, '@', 1),
            4
          );
        ELSE
          -- A LID without a phone: never a number made of LID digits. The
          -- short random suffix keeps two such contacts apart.
          conversation_subject := COALESCE(
            platform_private.waha_payload_push_name(payload),
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
          p_intake_sales_membership_id,
          created_scope_id,
          1,
          1,
          TRUE,
          'service',
          NULL,
          'Grant Sales access to one WAHA-only conversation',
          p_request_id
        );

        -- This is an additive, live-checked record-scope grant. Changing the
        -- profile access_version here would invalidate the operator's JWT on
        -- every new inbound chat even though no coarse role or revocation
        -- changed. Revocation/reassignment paths still rotate access_version.

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
          created_from_webhook_event_id
        )
        VALUES (
          created_conversation_id,
          p_organization_id,
          NULL,
          p_intake_sales_membership_id,
          'platform_intake',
          NULL,
          'sales',
          'open',
          conversation_subject,
          source_event.waha_session_name,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          created_scope_id,
          1,
          source_event.id
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
            customer_subject_ref,
            source_event.id
          ),
          (
            created_sales_participant_id,
            p_organization_id,
            created_conversation_id,
            'sales',
            p_intake_sales_membership_id,
            NULL,
            source_event.id
          );

        INSERT INTO platform_private.waha_direct_chat_bindings (
          organization_id,
          waha_session_name,
          normalized_chat_id,
          conversation_id,
          source_webhook_event_id
        )
        VALUES (
          p_organization_id,
          source_event.waha_session_name,
          resolved_chat_id,
          created_conversation_id,
          source_event.id
        );

        conversation.id := created_conversation_id;
        conversation.organization_id := p_organization_id;
        conversation.responsible_sales_membership_id :=
          p_intake_sales_membership_id;
        conversation.waha_session_name := source_event.waha_session_name;
        customer_participant.id := created_customer_participant_id;
        sales_participant.id := created_sales_participant_id;

        -- Messages the sales team sent from the phone before this first
        -- customer message belong to the same conversation.
        deferred_backfill := platform_private.backfill_waha_deferred_phone_sent(
          p_organization_id,
          created_conversation_id,
          created_sales_participant_id,
          array_remove(ARRAY[resolved_chat_id, chat_alt_id], NULL)
        );
      ELSE
        SELECT *
        INTO conversation
        FROM platform.communication_conversations AS candidate
        WHERE candidate.organization_id = p_organization_id
          AND candidate.id = binding.conversation_id;

        IF conversation.id IS NULL
          OR conversation.waha_session_name <>
            source_event.waha_session_name
          OR conversation.sales_authority_source <> 'platform_intake'
          OR conversation.queue <> 'sales'
          OR conversation.student_case_id IS NOT NULL
          OR conversation.current_curator_membership_id IS NOT NULL
        THEN
          RAISE EXCEPTION
            'A WAHA direct-chat binding cannot be reassigned or inferred'
            USING ERRCODE = '55000';
        END IF;

        SELECT *
        INTO customer_participant
        FROM platform.conversation_participants AS participant
        WHERE participant.organization_id = p_organization_id
          AND participant.conversation_id = conversation.id
          AND participant.participant_kind = 'customer'
        ORDER BY participant.created_at, participant.id
        LIMIT 1;

        SELECT *
        INTO sales_participant
        FROM platform.conversation_participants AS participant
        WHERE participant.organization_id = p_organization_id
          AND participant.conversation_id = conversation.id
          AND participant.participant_kind = 'sales'
          AND participant.membership_id =
            conversation.responsible_sales_membership_id
        ORDER BY participant.created_at, participant.id
        LIMIT 1;

        IF customer_participant.id IS NULL OR sales_participant.id IS NULL THEN
          RAISE EXCEPTION
            'Bound WAHA conversation participants are incomplete'
            USING ERRCODE = '55000';
        END IF;
      END IF;

      IF from_me THEN
        outbound_result := platform_private.project_waha_phone_sent_message(
          p_organization_id,
          source_event.id,
          conversation.id,
          sales_participant.id
        );

        IF outbound_result ->> 'outcome' IN ('projected', 'duplicate') THEN
          evidence_ref := 'waha-outbound-projected:' || source_event.id::TEXT;
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'succeeded', evidence_ref, NULL
          ) || jsonb_build_object(
            'communication_conversation_id', conversation.id,
            'communication_message_id',
              (outbound_result ->> 'message_id')::UUID,
            'sales_participant_id', sales_participant.id,
            'direction', 'outbound',
            'human_review_required', FALSE
          );
        ELSIF outbound_result ->> 'outcome' IN ('crm_send_echo', 'empty') THEN
          evidence_ref := 'waha-outbound-ignored:' || source_event.id::TEXT
            || ':' || (outbound_result ->> 'outcome');
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'succeeded', evidence_ref, NULL
          ) || jsonb_build_object('ignored', outbound_result ->> 'outcome');
        ELSE
          error_code := 'waha_outbound_' || (outbound_result ->> 'outcome');
          evidence_ref := 'waha-projection:' || source_event.id::TEXT
            || ':' || error_code;
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'terminal_error', evidence_ref, error_code
          );
        END IF;
        EXIT project_event;
      END IF;

      SELECT message.*
      INTO message_row
      FROM platform_private.waha_message_bindings AS message_binding
      JOIN platform.communication_messages AS message
        ON message.organization_id = message_binding.organization_id
       AND message.id = message_binding.communication_message_id
      WHERE message_binding.organization_id = p_organization_id
        AND message_binding.waha_session_name =
          source_event.waha_session_name
        AND message_binding.raw_message_id = source_waha_message_id;

      IF message_row.id IS NOT NULL THEN
        IF message_row.conversation_id <> conversation.id
          OR message_row.direction <> 'inbound'
          OR message_row.sender_participant_id <> customer_participant.id
          -- A message projected before migration 259 stored the caption (or
          -- the generic notice) without the typed media marker.
          OR message_row.body_text NOT IN (
            inbound_body_text,
            COALESCE(content ->> 'legacy_body', inbound_body_text)
          )
        THEN
          error_code := 'waha_inbound_message_conflict';
          evidence_ref := 'waha-projection:' || source_event.id::TEXT
            || ':' || error_code;
          result := platform_private.p5b_projection_result(
            p_organization_id, p_work_item_id, p_attempt_id,
            'terminal_error', evidence_ref, error_code
          );
          EXIT project_event;
        END IF;
      ELSE
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
          created_message_id,
          p_organization_id,
          conversation.id,
          NULL,
          customer_participant.id,
          'inbound',
          inbound_body_text,
          'undetermined',
          FALSE,
          'private_waha_binding',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          source_event.id,
          NULL,
          source_event.provider_occurred_at
        );
        message_row.id := created_message_id;

        INSERT INTO platform_private.waha_message_bindings (
          organization_id,
          waha_session_name,
          raw_message_id,
          communication_message_id,
          source_webhook_event_id
        )
        VALUES (
          p_organization_id,
          source_event.waha_session_name,
          source_waha_message_id,
          created_message_id,
          source_event.id
        );

        -- Queue activity is derived from the append-only message history below.
        -- Do not weaken the reviewed link/handoff/close transition guard merely
        -- to touch the parent conversation timestamp.
      END IF;

      IF human_review_required THEN
        INSERT INTO platform.conversation_handoff_events (
          organization_id,
          conversation_id,
          previous_student_case_id,
          new_student_case_id,
          previous_queue,
          new_queue,
          previous_owner_membership_id,
          new_owner_membership_id,
          source_webhook_event_id,
          student_case_assignment_event_id,
          reason,
          request_id
        )
        VALUES (
          p_organization_id,
          conversation.id,
          NULL,
          NULL,
          CASE
            WHEN binding.id IS NULL THEN NULL
            ELSE 'sales'::platform.communication_queue
          END,
          'sales',
          CASE
            WHEN binding.id IS NULL THEN NULL
            ELSE conversation.responsible_sales_membership_id
          END,
          conversation.responsible_sales_membership_id,
          source_event.id,
          NULL,
          'Inbound WAHA content without text requires staff review',
          source_event.id
        )
        RETURNING id INTO handoff_event_id;
      END IF;

      evidence_ref := CASE
        WHEN human_review_required
          THEN 'waha-inbound-human-review:' || source_event.id::TEXT
        ELSE 'waha-inbound-projected:' || source_event.id::TEXT
      END;
      result := platform_private.p5b_projection_result(
        p_organization_id,
        p_work_item_id,
        p_attempt_id,
        'succeeded',
        evidence_ref,
        NULL
      ) || jsonb_build_object(
        'communication_conversation_id', conversation.id,
        'communication_message_id', message_row.id,
        'customer_participant_id', customer_participant.id,
        'sales_participant_id', sales_participant.id,
        'human_review_required', human_review_required,
        'handoff_event_id', handoff_event_id
      ) || CASE
        WHEN deferred_backfill IS NULL THEN '{}'::JSONB
        ELSE jsonb_build_object('deferred_phone_sent', deferred_backfill)
      END;
    ELSE
      error_code := 'waha_event_type_unsupported';
      evidence_ref := 'waha-projection:' || source_event.id::TEXT
        || ':' || error_code;
      result := platform_private.p5b_projection_result(
        p_organization_id, p_work_item_id, p_attempt_id,
        'terminal_error', evidence_ref, error_code
      );
    END IF;
  END project_event;


  RETURN platform_private.p5b_store_projection_result(
    p_organization_id,
    p_work_item_id,
    p_attempt_id,
    source_event.id,
    p_intake_sales_membership_id,
    p_request_id,
    input_sha256,
    result,
    persist_effect
  );
END
$$;

COMMIT;
