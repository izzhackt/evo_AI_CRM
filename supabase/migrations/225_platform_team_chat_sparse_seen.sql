-- Sparse per-actor read state. Preserve the legacy read_sequence floor and
-- every existing message/command/receipt; this does not switch the chat UI.
BEGIN;

CREATE TABLE platform_private.team_chat_seen (
  organization_id UUID NOT NULL,
  channel_key TEXT NOT NULL,
  membership_id UUID NOT NULL,
  message_id UUID NOT NULL,
  PRIMARY KEY (organization_id, channel_key, membership_id, message_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, channel_key, message_id)
    REFERENCES platform.team_chat_messages(organization_id, channel_key, id)
);
ALTER TABLE platform_private.team_chat_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.team_chat_seen
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.team_chat_mark_seen(
  p_organization_id UUID, p_channel_key TEXT, p_message_ids UUID[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; read_floor BIGINT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL
    OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_message_ids IS NULL OR array_ndims(p_message_ids) IS DISTINCT FROM 1
    OR cardinality(p_message_ids) NOT BETWEEN 1 AND 50
    OR EXISTS (SELECT 1 FROM unnest(p_message_ids) id WHERE id IS NULL)
    OR (SELECT count(DISTINCT id) FROM unnest(p_message_ids) id) <> cardinality(p_message_ids) THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;

  -- Share the existing command's channel lock so edits/deletion/legacy read
  -- cannot race the batch validation and floor snapshot. No request journal:
  -- set union is idempotent for identical, reordered and overlapping batches.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'team-chat:' || p_organization_id::TEXT || ':' || p_channel_key, 0));
  IF platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
      AND m.id = ANY(p_message_ids)) <> cardinality(p_message_ids) THEN
    RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce((SELECT p.read_sequence FROM platform.team_chat_preferences p
    WHERE p.organization_id = p_organization_id AND p.channel_key = p_channel_key
      AND p.membership_id = actor.membership_id), 0) INTO read_floor;
  INSERT INTO platform_private.team_chat_seen
    (organization_id, channel_key, membership_id, message_id)
  SELECT p_organization_id, p_channel_key, actor.membership_id, m.id
  FROM platform.team_chat_messages m
  WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
    AND m.id = ANY(p_message_ids) AND m.sequence_id > read_floor
    AND m.author_membership_id <> actor.membership_id AND m.deleted_at IS NULL
  ON CONFLICT (organization_id, channel_key, membership_id, message_id) DO NOTHING;

  -- Acknowledge all validated IDs, including harmless own/deleted/already-read
  -- no-ops. The client must validate the complete set before accepting success.
  RETURN jsonb_build_object('channelKey', p_channel_key, 'messageIds', to_jsonb(p_message_ids));
END $$;
REVOKE ALL ON FUNCTION platform.team_chat_mark_seen(UUID, TEXT, UUID[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.team_chat_mark_seen(UUID, TEXT, UUID[]) TO authenticated;

-- Preserve the existing channels DTO and migration156's custom-staff authority.
-- Only the two unread predicates gain the same per-actor sparse exclusion.
CREATE OR REPLACE FUNCTION platform.team_chat_channels(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR actor.platform_role = 'student' THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'key', c.key, 'muted', coalesce(p.muted, false),
    'preferenceVersion', coalesce(p.version, 0)::TEXT,
    'readSequence', coalesce(p.read_sequence, 0)::TEXT,
    'unreadCount', (SELECT count(*) FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = c.key
        AND m.sequence_id > coalesce(p.read_sequence, 0) AND m.deleted_at IS NULL
        AND m.author_membership_id <> actor.membership_id
        AND NOT EXISTS (SELECT 1 FROM platform_private.team_chat_seen s
          WHERE s.organization_id = m.organization_id AND s.channel_key = m.channel_key
            AND s.membership_id = actor.membership_id AND s.message_id = m.id)),
    'firstUnreadId', (SELECT m.id FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = c.key
        AND m.sequence_id > coalesce(p.read_sequence, 0) AND m.deleted_at IS NULL
        AND m.author_membership_id <> actor.membership_id
        AND NOT EXISTS (SELECT 1 FROM platform_private.team_chat_seen s
          WHERE s.organization_id = m.organization_id AND s.channel_key = m.channel_key
            AND s.membership_id = actor.membership_id AND s.message_id = m.id)
      ORDER BY m.sequence_id LIMIT 1)
  ) ORDER BY c.position) INTO result
  FROM (VALUES ('general', 1), ('sales', 2), ('admissions', 3)) c(key, position)
  LEFT JOIN platform.team_chat_preferences p ON p.organization_id = p_organization_id
    AND p.channel_key = c.key AND p.membership_id = actor.membership_id
  WHERE platform_private.team_chat_can_access(p_organization_id, c.key);
  RETURN coalesce(result, '[]'::JSONB);
END $$;

COMMIT;
