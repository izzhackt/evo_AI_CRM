-- Additive flat history/context reads. Keep v1 history, commands and read cursors intact.
-- STABLE gives the page, quotes, boundaries and change watermark one statement snapshot.
BEGIN;

CREATE INDEX team_chat_timeline_idx ON platform.team_chat_messages
  (organization_id, channel_key, sequence_id DESC);

CREATE FUNCTION platform.team_chat_read_timeline(
  p_organization_id UUID, p_channel_key TEXT, p_mode TEXT DEFAULT 'latest',
  p_cursor BIGINT DEFAULT 0, p_message_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ids UUID[] := '{}';
  rows JSONB;
  quotes JSONB;
  anchor_sequence BIGINT;
  before_cursor BIGINT := 0;
  after_cursor BIGINT := 0;
  has_before BOOLEAN := false;
  has_after BOOLEAN := false;
  watermark BIGINT;
  tail UUID;
BEGIN
  IF platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('latest', 'before', 'after', 'context')
    OR p_cursor IS NULL OR p_cursor < 0
    OR (p_mode IN ('latest', 'context') AND p_cursor <> 0)
    OR (p_mode IN ('before', 'after') AND p_cursor = 0)
    OR (p_mode = 'context' AND p_message_id IS NULL)
    OR (p_mode <> 'context' AND p_message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(c.cursor), 0) INTO watermark
    FROM platform_private.team_chat_changes c
    WHERE c.organization_id = p_organization_id AND c.channel_key = p_channel_key;
  SELECT m.id INTO tail FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
    ORDER BY m.sequence_id DESC LIMIT 1;

  IF p_mode = 'context' THEN
    SELECT m.sequence_id INTO anchor_sequence FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
        AND m.id = p_message_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT array_agg(page_rows.id) INTO ids FROM (
      (SELECT m.id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.sequence_id < anchor_sequence ORDER BY m.sequence_id DESC LIMIT 25)
      UNION ALL SELECT p_message_id
      UNION ALL
      (SELECT m.id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.sequence_id > anchor_sequence ORDER BY m.sequence_id ASC LIMIT 24)
    ) AS page_rows;
  ELSIF p_mode = 'after' THEN
    SELECT array_agg(page_rows.id) INTO ids FROM (
      SELECT m.id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.sequence_id > p_cursor ORDER BY m.sequence_id ASC LIMIT 50
    ) AS page_rows;
  ELSE
    SELECT array_agg(page_rows.id) INTO ids FROM (
      SELECT m.id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND (p_mode = 'latest' OR m.sequence_id < p_cursor)
        ORDER BY m.sequence_id DESC LIMIT 50
    ) AS page_rows;
  END IF;
  ids := coalesce(ids, '{}'::UUID[]);

  SELECT coalesce(jsonb_agg(platform_private.team_chat_message_json(m) ORDER BY m.sequence_id), '[]'::JSONB),
      coalesce(min(m.sequence_id), 0), coalesce(max(m.sequence_id), 0)
    INTO rows, before_cursor, after_cursor FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
      AND m.id = ANY(ids);

  -- Only immediate parents of this bounded page; never an arbitrary quote lookup.
  -- Tombstones expose no old body, and all metadata stays in the authorized channel.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', parent.id, 'sequence', parent.sequence_id::TEXT,
      'authorMembershipId', parent.author_membership_id, 'authorName', profile.display_name,
      'version', parent.version::TEXT, 'deletedAt', parent.deleted_at,
      'bodyPreview', CASE WHEN parent.deleted_at IS NULL THEN left(parent.body, 240) ELSE '' END
    ) ORDER BY parent.sequence_id), '[]'::JSONB) INTO quotes
    FROM platform.team_chat_messages parent
    JOIN platform.organization_memberships author
      ON author.organization_id = parent.organization_id AND author.id = parent.author_membership_id
    JOIN platform.profiles profile ON profile.id = author.profile_id
    WHERE parent.organization_id = p_organization_id AND parent.channel_key = p_channel_key
      AND parent.id IN (
        SELECT m.parent_message_id FROM platform.team_chat_messages m
          WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
            AND m.id = ANY(ids) AND m.parent_message_id IS NOT NULL
      );

  IF cardinality(ids) > 0 THEN
    SELECT EXISTS(SELECT 1 FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.sequence_id < before_cursor),
      EXISTS(SELECT 1 FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.sequence_id > after_cursor)
      INTO has_before, has_after;
  END IF;
  RETURN jsonb_build_object(
    'messages', rows, 'quotes', quotes,
    'beforeCursor', before_cursor::TEXT, 'afterCursor', after_cursor::TEXT,
    'hasBefore', has_before, 'hasAfter', has_after,
    'watermark', watermark::TEXT, 'latestMessageId', tail,
    'focusMessageId', CASE WHEN p_mode = 'context' THEN p_message_id ELSE NULL END
  );
END $$;

REVOKE ALL ON FUNCTION platform.team_chat_read_timeline(UUID, TEXT, TEXT, BIGINT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.team_chat_read_timeline(UUID, TEXT, TEXT, BIGINT, UUID)
  TO authenticated;
COMMENT ON FUNCTION platform.team_chat_read_timeline(UUID, TEXT, TEXT, BIGINT, UUID) IS
  'Authorized read-only flat history/context over original staff messages; never marks messages seen.';

COMMIT;
