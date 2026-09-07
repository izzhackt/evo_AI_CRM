-- ============================================================
-- 122_platform_inbox_waiting_projection.sql
--
-- Stage D2 Inbox queue projection:
--   (a) expose the first inbound message in the current unanswered tail;
--   (b) add an optional server-side waiting-only filter;
--   (c) keep the migration-119 search, ordering and keyset contract intact.
--
-- The sole return-shape addition is waiting_since. Existing callers may omit
-- p_waiting_only; its FALSE default preserves migration-119 row membership.
-- ============================================================

BEGIN;

DROP FUNCTION platform.staff_communication_snapshot(UUID, UUID);
DROP FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
);
DROP FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT
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
  p_waiting_only BOOLEAN DEFAULT FALSE
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
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_conversation_id IS NULL) THEN
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
        GREATEST(
          conversation.updated_at,
          COALESCE(latest_message.created_at, conversation.updated_at)
        ),
        conversation.id
      ) < (p_before_sort_at, p_before_conversation_id)
    )
  ORDER BY GREATEST(
    conversation.updated_at,
    COALESCE(latest_message.created_at, conversation.updated_at)
  ) DESC, conversation.id DESC
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
  p_waiting_only BOOLEAN DEFAULT FALSE
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
    p_waiting_only
  ) AS page
$$;

CREATE FUNCTION platform.staff_communication_snapshot(
  p_organization_id UUID,
  p_conversation_id UUID
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
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM platform.staff_communication_page(
    p_organization_id,
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_conversation_id,
    NULL,
    FALSE
  ) AS page
$$;

REVOKE ALL ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_communication_snapshot(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_communication_snapshot(UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_communication_page(
  UUID, INTEGER, TIMESTAMPTZ, UUID,
  platform.communication_queue, platform.communication_status, UUID, TEXT,
  BOOLEAN
) IS
  'Bounded communication queue with canonical search/keyset ordering and the first inbound message in the current unanswered tail; p_waiting_only filters that projection before LIMIT.';

COMMENT ON FUNCTION platform.staff_communication_snapshot(UUID, UUID) IS
  'One authorized communication summary by exact conversation id, including canonical waiting_since; never scans or downloads the full queue.';

COMMIT;
