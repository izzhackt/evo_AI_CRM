-- ============================================================
-- 279_platform_inbox_unanswered_first.sql
--
-- «Продажи → WhatsApp»: «Сортировка» — «Сначала новые» / «Неотвеченные»
-- (owner request 08.10.2026). In «Неотвеченные» the chats where the customer
-- wrote last and nobody answered yet come first, freshest first; every other
-- chat follows, freshest first. The list is paged on the server (50 rows), so
-- this order must be the reader's own keyset order: a sort of one loaded page
-- in the browser would leave awaiting chats of later pages behind.
--
-- Additive only. Migration 122's queue reader is re-created with two more
-- OPTIONAL parameters, exactly as 122 itself added p_waiting_only:
--   p_unanswered_first BOOLEAN DEFAULT FALSE
--   p_before_waiting   BOOLEAN DEFAULT NULL
-- A caller that omits them (the running application, the snapshot reader,
-- every existing suite) gets the same rows in the same order with the same
-- cursor as before: ORDER BY sort_at DESC, id DESC and the cursor
-- (sort_at, id) < (p_before_sort_at, p_before_conversation_id). Same return
-- shape (16 keys), same definer/invoker split, empty search_path, access
-- check, search, waiting projection and grants (EXECUTE for authenticated
-- only). The running application keeps working between this migration and
-- its release.
--
-- With p_unanswered_first => TRUE the order is
--   (waiting_since IS NOT NULL) DESC, sort_at DESC, id DESC
-- and the cursor is the tuple (waiting, sort_at, id) of the page's last row:
-- p_before_waiting is required with a cursor in that mode and refused
-- without it (22023), as an incomplete cursor already is. «Waiting» is 122's
-- own projection: the latest message of the chat is the customer's.
--
-- Within each group the key is sort_at, the time every row already shows
-- (GREATEST(conversation.updated_at, latest message time)). For an awaiting
-- chat the latest message IS the customer's newest message; on production
-- 08.10.2026 sort_at differed from it for 6 of 65 awaiting chats by at most
-- 1.6 s (the projection's own conversation update). Keeping one key keeps the
-- cursor exact and the shown times in order.
--
-- The 9-argument routines are replaced, not overloaded: two overloads would
-- make every 9-argument call ambiguous. Pre-image: the md5 of both live
-- bodies (production 08.10.2026) must be exactly migration 122's.
-- ============================================================

BEGIN;

DO $n279_pre$
BEGIN
  IF (
    SELECT pg_catalog.md5(routine.prosrc)
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(
      'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)'
    )
  ) IS DISTINCT FROM 'f543f9fdd2fbf59d8417f6d503a7371a'
    OR (
      SELECT pg_catalog.md5(routine.prosrc)
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = pg_catalog.to_regprocedure(
        'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean)'
      )
    ) IS DISTINCT FROM '851b2fc389cbf6495098ede7171f9aca'
  THEN
    RAISE EXCEPTION
      'Migration 279 replaces the queue reader exactly as migration 122 defined it; re-derive 279 from the current definition'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure(
      'platform.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'private.staff_communication_page(uuid,integer,timestamp with time zone,uuid,platform.communication_queue,platform.communication_status,uuid,text,boolean,boolean,boolean)'
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Migration 279 objects already exist' USING ERRCODE = '55000';
  END IF;
END
$n279_pre$;

DROP FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
);
DROP FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
);

CREATE FUNCTION private.staff_communication_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_conversation_id UUID DEFAULT NULL,
  p_queue platform.communication_queue DEFAULT NULL,
  p_status platform.communication_status DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL,
  p_waiting_only BOOLEAN DEFAULT FALSE,
  p_unanswered_first BOOLEAN DEFAULT FALSE,
  p_before_waiting BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ,
  last_message_direction platform.communication_direction,
  last_message_at TIMESTAMPTZ,
  waiting_since TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_query TEXT;
  normalized_phone_query TEXT;
  unanswered_first CONSTANT BOOLEAN := COALESCE(p_unanswered_first, FALSE);
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_conversation_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete conversation cursor' USING ERRCODE = '22023';
  END IF;

  -- «Неотвеченные»: the cursor carries the group of its row; elsewhere it
  -- has none.
  IF (unanswered_first AND (p_before_sort_at IS NULL) <> (p_before_waiting IS NULL))
    OR (NOT unanswered_first AND p_before_waiting IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Incomplete conversation cursor' USING ERRCODE = '22023';
  END IF;

  IF p_query IS NOT NULL
    AND pg_catalog.length(pg_catalog.btrim(p_query)) > 200
  THEN
    RAISE EXCEPTION 'Conversation query is too long' USING ERRCODE = '22023';
  END IF;

  normalized_query := NULLIF(
    pg_catalog.lower(pg_catalog.btrim(p_query)),
    ''
  );
  normalized_phone_query := CASE
    WHEN p_query IS NOT NULL
      AND pg_catalog.btrim(p_query) ~ '^[+0-9() ./-]+$'
    THEN NULLIF(
      pg_catalog.regexp_replace(p_query, '[^0-9]', '', 'g'),
      ''
    )
    ELSE NULL
  END;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at,
    GREATEST(
      conversation.updated_at,
      COALESCE(latest_message.created_at, conversation.updated_at)
    ) AS sort_at,
    latest_message.direction AS last_message_direction,
    latest_message.created_at AS last_message_at,
    waiting_message.created_at AS waiting_since
  FROM platform.communication_conversations AS conversation
  LEFT JOIN platform.clients AS canonical_client
    ON canonical_client.organization_id = conversation.organization_id
    AND canonical_client.id = conversation.canonical_client_id
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at, message.direction
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON TRUE
  LEFT JOIN LATERAL (
    SELECT message.id, message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND message.direction = 'outbound'
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_outbound ON latest_message.direction = 'inbound'
  LEFT JOIN LATERAL (
    SELECT message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND message.direction = 'inbound'
      AND (
        latest_outbound.id IS NULL
        OR (message.created_at, message.id)
          > (latest_outbound.created_at, latest_outbound.id)
      )
    ORDER BY message.created_at ASC, message.id ASC
    LIMIT 1
  ) AS waiting_message ON latest_message.direction = 'inbound'
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
    AND (p_queue IS NULL OR conversation.queue = p_queue)
    AND (p_status IS NULL OR conversation.status = p_status)
    AND (
      p_conversation_id IS NULL
      OR conversation.id = p_conversation_id
    )
    AND (
      normalized_query IS NULL
      OR pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.concat_ws(
          ' ',
          conversation.subject,
          canonical_client.display_name,
          canonical_client.phone,
          canonical_client.normalized_phone
        )),
        normalized_query
      ) > 0
      OR (
        normalized_phone_query IS NOT NULL
        AND pg_catalog.strpos(
          pg_catalog.regexp_replace(
            COALESCE(
              canonical_client.normalized_phone,
              canonical_client.phone,
              ''
            ),
            '[^0-9]',
            '',
            'g'
          ),
          normalized_phone_query
        ) > 0
      )
    )
    AND (
      NOT COALESCE(p_waiting_only, FALSE)
      OR waiting_message.created_at IS NOT NULL
    )
    AND (
      p_before_sort_at IS NULL
      OR (
        NOT unanswered_first
        AND (
          GREATEST(
            conversation.updated_at,
            COALESCE(latest_message.created_at, conversation.updated_at)
          ),
          conversation.id
        ) < (p_before_sort_at, p_before_conversation_id)
      )
      OR (
        unanswered_first
        AND (
          waiting_message.created_at IS NOT NULL,
          GREATEST(
            conversation.updated_at,
            COALESCE(latest_message.created_at, conversation.updated_at)
          ),
          conversation.id
        ) < (p_before_waiting, p_before_sort_at, p_before_conversation_id)
      )
    )
  ORDER BY
    -- FALSE for every row unless «Неотвеченные»: the default order is 122's.
    (unanswered_first AND waiting_message.created_at IS NOT NULL) DESC,
    GREATEST(
      conversation.updated_at,
      COALESCE(latest_message.created_at, conversation.updated_at)
    ) DESC,
    conversation.id DESC
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_communication_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_conversation_id UUID DEFAULT NULL,
  p_queue platform.communication_queue DEFAULT NULL,
  p_status platform.communication_status DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_query TEXT DEFAULT NULL,
  p_waiting_only BOOLEAN DEFAULT FALSE,
  p_unanswered_first BOOLEAN DEFAULT FALSE,
  p_before_waiting BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ,
  last_message_direction platform.communication_direction,
  last_message_at TIMESTAMPTZ,
  waiting_since TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_communication_page(
    p_organization_id,
    p_limit,
    p_before_sort_at,
    p_before_conversation_id,
    p_queue,
    p_status,
    p_conversation_id,
    p_query,
    p_waiting_only,
    p_unanswered_first,
    p_before_waiting
  ) AS page
$$;

REVOKE ALL ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN
) IS
  'Bounded communication queue with canonical search/keyset ordering and the first inbound message in the current unanswered tail; p_waiting_only filters that projection before LIMIT; p_unanswered_first (279) puts awaiting chats first with the cursor (p_before_waiting, p_before_sort_at, p_before_conversation_id).';

NOTIFY pgrst, 'reload schema';
COMMIT;
