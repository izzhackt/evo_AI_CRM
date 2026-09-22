-- Add the creation time of the same authorized latest row as an outer field.
-- Preserve the seven-field nested preview for already deployed decoders.
BEGIN;

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
      ORDER BY m.sequence_id LIMIT 1),
    'latestPreview', latest.preview,
    'latestPreviewCreatedAt', latest.created_at
  ) ORDER BY c.position) INTO result
  FROM (VALUES ('general', 1), ('sales', 2), ('admissions', 3)) c(key, position)
  LEFT JOIN platform.team_chat_preferences p ON p.organization_id = p_organization_id
    AND p.channel_key = c.key AND p.membership_id = actor.membership_id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'id', m.id, 'sequence', m.sequence_id::TEXT, 'version', m.version::TEXT,
      'authorMembershipId', m.author_membership_id, 'authorName', author_profile.display_name,
      'bodyPreview', CASE WHEN m.deleted_at IS NULL THEN left(m.body, 240) ELSE '' END,
      'deletedAt', m.deleted_at
    ) AS preview, m.created_at
    FROM platform.team_chat_messages m
    JOIN platform.organization_memberships author_membership
      ON author_membership.id = m.author_membership_id
        AND author_membership.organization_id = m.organization_id
    JOIN platform.profiles author_profile ON author_profile.id = author_membership.profile_id
    WHERE m.organization_id = p_organization_id AND m.channel_key = c.key
    ORDER BY m.sequence_id DESC LIMIT 1
  ) latest ON true
  WHERE platform_private.team_chat_can_access(p_organization_id, c.key);
  RETURN coalesce(result, '[]'::JSONB);
END $$;

COMMIT;
