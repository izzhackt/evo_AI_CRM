-- Add direct quotes without changing root-parent history, V1 commands or receipts.
-- Read current originals; never keep a copy of quoted text after edit/deletion.
BEGIN;

CREATE TABLE platform_private.team_chat_quotes (
  organization_id UUID NOT NULL,
  channel_key TEXT NOT NULL,
  message_id UUID NOT NULL,
  quoted_message_id UUID NOT NULL,
  PRIMARY KEY (organization_id, channel_key, message_id),
  FOREIGN KEY (organization_id, channel_key, message_id)
    REFERENCES platform.team_chat_messages(organization_id, channel_key, id),
  FOREIGN KEY (organization_id, channel_key, quoted_message_id)
    REFERENCES platform.team_chat_messages(organization_id, channel_key, id),
  CHECK (message_id <> quoted_message_id)
);
ALTER TABLE platform_private.team_chat_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.team_chat_quotes
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION platform.team_chat_post_v2(
  p_organization_id UUID, p_channel_key TEXT, p_request_id UUID, p_input JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  msg platform.team_chat_messages;
  target platform.team_chat_messages;
  receipt platform_private.team_chat_receipts;
  root_id UUID;
  quote_id UUID;
  mentions UUID[] := '{}';
  recipient UUID;
  text_body TEXT;
  canonical_input JSONB;
  result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL
    OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_channel_key IS NULL
    OR p_channel_key NOT IN ('general', 'sales', 'admissions')
    OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_input ?& ARRAY['body', 'quoteMessageId', 'mentionedMembershipIds'])
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) k
      WHERE k NOT IN ('body', 'quoteMessageId', 'mentionedMembershipIds')) THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  -- Share V1's lock namespaces and order, including cross-channel retries.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'team-chat-request:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'team-chat:' || p_organization_id::TEXT || ':' || p_channel_key, 0));
  IF platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  canonical_input := p_input || jsonb_build_object(
    'schemaVersion', 2, 'operation', 'post', 'channelKey', p_channel_key);
  SELECT * INTO receipt FROM platform_private.team_chat_receipts r
    WHERE r.organization_id = p_organization_id AND r.actor_membership_id = actor.membership_id
      AND r.request_id = p_request_id;
  IF FOUND THEN
    IF receipt.input IS DISTINCT FROM canonical_input THEN
      RAISE EXCEPTION 'team_chat_request_conflict' USING ERRCODE = '40001';
    END IF;
    -- The frozen result remains valid even if the target has since changed.
    RETURN receipt.result;
  END IF;

  text_body := btrim(p_input ->> 'body');
  IF jsonb_typeof(p_input -> 'body') IS DISTINCT FROM 'string'
    OR char_length(text_body) NOT BETWEEN 1 AND 8000
    OR char_length(p_input ->> 'body') > 8000
    OR (p_input ->> 'body') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_input -> 'mentionedMembershipIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_input -> 'mentionedMembershipIds') > 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_input -> 'mentionedMembershipIds') v
      WHERE jsonb_typeof(v) <> 'string'
        OR (v #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT v::UUID), '{}') INTO mentions
    FROM jsonb_array_elements_text(p_input -> 'mentionedMembershipIds') v;
  FOREACH recipient IN ARRAY mentions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = recipient
        AND platform_private.staff_can_access(p_organization_id, m.id,
          'team.chat.' || p_channel_key, 'organization', p_organization_id)
    ) THEN RAISE EXCEPTION 'team_chat_recipient_forbidden' USING ERRCODE = '42501'; END IF;
  END LOOP;

  IF p_input -> 'quoteMessageId' <> 'null'::JSONB THEN
    IF jsonb_typeof(p_input -> 'quoteMessageId') <> 'string'
      OR (p_input ->> 'quoteMessageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
    END IF;
    quote_id := (p_input ->> 'quoteMessageId')::UUID;
    SELECT * INTO target FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key AND m.id = quote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    root_id := coalesce(target.parent_message_id, target.id);
    IF NOT EXISTS (SELECT 1 FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
        AND m.id = root_id AND m.parent_message_id IS NULL) THEN
      RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  INSERT INTO platform.team_chat_messages
    (organization_id, channel_key, author_membership_id, body, parent_message_id, mentioned_membership_ids)
  VALUES (p_organization_id, p_channel_key, actor.membership_id, text_body, root_id, mentions)
    RETURNING * INTO msg;
  IF quote_id IS NOT NULL THEN
    INSERT INTO platform_private.team_chat_quotes VALUES (p_organization_id, p_channel_key, msg.id, quote_id);
  END IF;
  result := jsonb_build_object(
    'schemaVersion', 2, 'requestId', p_request_id, 'channelKey', p_channel_key,
    'operation', 'post', 'messageId', msg.id, 'version', msg.version::TEXT,
    'quoteMessageId', quote_id, 'rootParentMessageId', root_id);
  INSERT INTO platform_private.team_chat_changes (organization_id, channel_key, message_id)
    VALUES (p_organization_id, p_channel_key, msg.id);
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state, reason, request_id)
  VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
    'team.chat.post', 'team_chat_message', msg.id,
    jsonb_build_object('version', NULL::BIGINT), result, 'Staff chat post', p_request_id);
  -- Existing message-insert mention notifications stay intact. Broadcast only invalidation.
  PERFORM realtime.send(jsonb_build_object('refresh', true), 'invalidate',
    'team-chat:' || p_organization_id::TEXT || ':' || p_channel_key, true);
  INSERT INTO platform_private.team_chat_receipts
    VALUES (p_organization_id, actor.membership_id, p_request_id, canonical_input, result);
  RETURN result;
END $$;

-- The unchanged STABLE reader and all following bounded projections share the
-- caller's statement snapshot. Do not turn this into a VOLATILE wrapper.
CREATE FUNCTION platform.team_chat_read_timeline_v2(
  p_organization_id UUID, p_channel_key TEXT, p_mode TEXT DEFAULT 'latest',
  p_cursor BIGINT DEFAULT 0, p_message_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; page JSONB; rows JSONB; quotes JSONB; quote_ids UUID[];
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL
    OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR platform_private.team_chat_can_access(p_organization_id, p_channel_key) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  page := platform.team_chat_read_timeline(p_organization_id, p_channel_key, p_mode, p_cursor, p_message_id);
  SELECT coalesce(jsonb_agg(item.value || jsonb_build_object(
      'quoteMessageId', coalesce(q.quoted_message_id, m.parent_message_id)) ORDER BY item.ordinality), '[]'::JSONB),
    coalesce(array_agg(DISTINCT coalesce(q.quoted_message_id, m.parent_message_id))
      FILTER (WHERE coalesce(q.quoted_message_id, m.parent_message_id) IS NOT NULL), '{}'::UUID[])
    INTO rows, quote_ids
    FROM jsonb_array_elements(page -> 'messages') WITH ORDINALITY AS item(value, ordinality)
    JOIN platform.team_chat_messages m ON m.organization_id = p_organization_id
      AND m.channel_key = p_channel_key AND m.id = (item.value ->> 'id')::UUID
    LEFT JOIN platform_private.team_chat_quotes q ON q.organization_id = m.organization_id
      AND q.channel_key = m.channel_key AND q.message_id = m.id;
  IF jsonb_array_length(rows) <> jsonb_array_length(page -> 'messages') THEN
    RAISE EXCEPTION 'team_chat_incomplete_page' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', original.id, 'sequence', original.sequence_id::TEXT,
      'authorMembershipId', original.author_membership_id, 'authorName', profile.display_name,
      'version', original.version::TEXT, 'deletedAt', original.deleted_at,
      'bodyPreview', CASE WHEN original.deleted_at IS NULL THEN left(original.body, 240) ELSE '' END
    ) ORDER BY original.sequence_id), '[]'::JSONB) INTO quotes
    FROM platform.team_chat_messages original
    JOIN platform.organization_memberships author
      ON author.organization_id = original.organization_id AND author.id = original.author_membership_id
    JOIN platform.profiles profile ON profile.id = author.profile_id
    WHERE original.organization_id = p_organization_id AND original.channel_key = p_channel_key
      AND original.id = ANY(quote_ids);
  IF jsonb_array_length(quotes) <> cardinality(quote_ids) THEN
    RAISE EXCEPTION 'team_chat_incomplete_quotes' USING ERRCODE = 'P0002';
  END IF;
  RETURN page || jsonb_build_object('schemaVersion', 2, 'messages', rows, 'quotes', quotes);
END $$;

REVOKE ALL ON FUNCTION platform.team_chat_post_v2(UUID, TEXT, UUID, JSONB),
  platform.team_chat_read_timeline_v2(UUID, TEXT, TEXT, BIGINT, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.team_chat_post_v2(UUID, TEXT, UUID, JSONB),
  platform.team_chat_read_timeline_v2(UUID, TEXT, TEXT, BIGINT, UUID) TO authenticated;

COMMIT;
