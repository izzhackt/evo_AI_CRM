-- Native staff chat. Supabase is the only history/identity authority.
-- Realtime authorizes at join/token refresh, so broadcast ONLY invalidation:
-- https://supabase.com/docs/guides/realtime/authorization
-- https://supabase.com/docs/guides/realtime/broadcast
BEGIN;

CREATE TABLE platform.team_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id),
  channel_key TEXT NOT NULL CHECK (channel_key IN ('general', 'sales', 'admissions')),
  sequence_id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  author_membership_id UUID NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) <= 8000),
  parent_message_id UUID,
  mentioned_membership_ids UUID[] NOT NULL DEFAULT '{}',
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, channel_key, id),
  FOREIGN KEY (organization_id, author_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, channel_key, parent_message_id)
    REFERENCES platform.team_chat_messages(organization_id, channel_key, id),
  CHECK (id IS DISTINCT FROM parent_message_id),
  CHECK ((deleted_at IS NULL AND btrim(body) <> '') OR
    (deleted_at IS NOT NULL AND body = '' AND cardinality(mentioned_membership_ids) = 0)),
  CHECK (cardinality(mentioned_membership_ids) <= 20)
);
CREATE INDEX team_chat_history_idx ON platform.team_chat_messages
  (organization_id, channel_key, sequence_id DESC) WHERE parent_message_id IS NULL;
CREATE INDEX team_chat_thread_idx ON platform.team_chat_messages
  (organization_id, channel_key, parent_message_id, sequence_id);
CREATE INDEX team_chat_unread_idx ON platform.team_chat_messages
  (organization_id, channel_key, sequence_id) WHERE deleted_at IS NULL;
CREATE INDEX team_chat_search_idx ON platform.team_chat_messages
  USING GIN (to_tsvector('simple', body)) WHERE deleted_at IS NULL;

CREATE TABLE platform.team_chat_preferences (
  organization_id UUID NOT NULL,
  channel_key TEXT NOT NULL CHECK (channel_key IN ('general', 'sales', 'admissions')),
  membership_id UUID NOT NULL,
  read_sequence BIGINT NOT NULL DEFAULT 0 CHECK (read_sequence >= 0),
  muted BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (organization_id, channel_key, membership_id),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

-- A durable cursor includes edits/tombstones. Channel serialization happens
-- BEFORE allocating sequence IDs so an in-flight lower ID cannot be skipped.
CREATE TABLE platform_private.team_chat_changes (
  cursor BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  channel_key TEXT NOT NULL,
  message_id UUID NOT NULL,
  FOREIGN KEY (organization_id, channel_key, message_id)
    REFERENCES platform.team_chat_messages(organization_id, channel_key, id)
);
CREATE INDEX team_chat_changes_channel_idx ON platform_private.team_chat_changes
  (organization_id, channel_key, cursor);
CREATE TABLE platform_private.team_chat_receipts (
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  request_id UUID NOT NULL,
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  PRIMARY KEY (organization_id, actor_membership_id, request_id),
  FOREIGN KEY (organization_id, actor_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
);

CREATE FUNCTION platform_private.team_chat_can_access(p_organization_id UUID, p_channel_key TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id
      AND a.platform_role IN ('admin', 'sales', 'curator')
      AND (p_channel_key = 'general'
        OR (p_channel_key = 'sales' AND a.platform_role IN ('admin', 'sales'))
        OR (p_channel_key = 'admissions' AND a.platform_role IN ('admin', 'curator')))
  )
$$;

ALTER TABLE platform.team_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.team_chat_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.team_chat_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.team_chat_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_chat_messages_read ON platform.team_chat_messages FOR SELECT TO authenticated
  USING (platform_private.team_chat_can_access(organization_id, channel_key));
CREATE POLICY team_chat_preferences_read ON platform.team_chat_preferences FOR SELECT TO authenticated
  USING (platform_private.team_chat_can_access(organization_id, channel_key)
    AND membership_id = (SELECT a.membership_id FROM platform.current_actor_authority() a));
-- Only validated RPCs expose content; direct writes and private journal/receipts
-- are never a client surface (including service_role product bypass).
REVOKE ALL ON platform.team_chat_messages, platform.team_chat_preferences,
  platform_private.team_chat_changes, platform_private.team_chat_receipts
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE platform.team_chat_messages_sequence_id_seq,
  platform_private.team_chat_changes_cursor_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION platform_private.team_chat_message_json(p_message platform.team_chat_messages)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p_message.id, 'channelKey', p_message.channel_key,
    'sequence', p_message.sequence_id::TEXT,
    'authorMembershipId', p_message.author_membership_id,
    'authorName', p.display_name, 'body', p_message.body,
    'parentMessageId', p_message.parent_message_id,
    'mentionedMembershipIds', p_message.mentioned_membership_ids,
    'version', p_message.version::TEXT, 'createdAt', p_message.created_at,
    'editedAt', p_message.edited_at, 'deletedAt', p_message.deleted_at,
    'replyCount', (SELECT count(*) FROM platform.team_chat_messages r
      WHERE r.organization_id = p_message.organization_id
        AND r.channel_key = p_message.channel_key AND r.parent_message_id = p_message.id)
  ) FROM platform.organization_memberships m
    JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.id = p_message.author_membership_id AND m.organization_id = p_message.organization_id
$$;

CREATE FUNCTION platform.team_chat_channels(p_organization_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; result JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR actor.organization_id IS DISTINCT FROM p_organization_id
    OR actor.platform_role NOT IN ('admin', 'sales', 'curator') THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'key', c.key, 'muted', coalesce(p.muted, false),
    'preferenceVersion', coalesce(p.version, 0)::TEXT,
    'readSequence', coalesce(p.read_sequence, 0)::TEXT,
    'unreadCount', (SELECT count(*) FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = c.key
        AND m.sequence_id > coalesce(p.read_sequence, 0) AND m.deleted_at IS NULL
        AND m.author_membership_id <> actor.membership_id),
    'firstUnreadId', (SELECT m.id FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = c.key
        AND m.sequence_id > coalesce(p.read_sequence, 0) AND m.deleted_at IS NULL
        AND m.author_membership_id <> actor.membership_id ORDER BY m.sequence_id LIMIT 1)
  ) ORDER BY c.position) INTO result
  FROM (VALUES ('general', 1), ('sales', 2), ('admissions', 3)) c(key, position)
  LEFT JOIN platform.team_chat_preferences p ON p.organization_id = p_organization_id
    AND p.channel_key = c.key AND p.membership_id = actor.membership_id
  WHERE platform_private.team_chat_can_access(p_organization_id, c.key);
  RETURN coalesce(result, '[]'::JSONB);
END $$;

CREATE FUNCTION platform.team_chat_read_page(
  p_organization_id UUID, p_channel_key TEXT, p_mode TEXT DEFAULT 'latest',
  p_cursor BIGINT DEFAULT 0, p_message_id UUID DEFAULT NULL, p_query TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids UUID[]; rows JSONB; next_cursor BIGINT; has_more BOOLEAN := false;
  root_id UUID; watermark BIGINT; tail UUID;
BEGIN
  IF NOT platform_private.team_chat_can_access(p_organization_id, p_channel_key) THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('latest', 'before', 'changes', 'thread', 'search', 'message')
    OR p_cursor IS NULL OR p_cursor < 0 THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(c.cursor), 0) INTO watermark FROM platform_private.team_chat_changes c
    WHERE c.organization_id = p_organization_id AND c.channel_key = p_channel_key;
  SELECT m.id INTO tail FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
    ORDER BY m.sequence_id DESC LIMIT 1;
  IF p_mode = 'changes' THEN
    IF p_cursor > watermark THEN RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023'; END IF;
    SELECT array_agg(c.message_id), max(c.cursor) INTO ids, next_cursor FROM (
      SELECT ch.message_id, ch.cursor FROM platform_private.team_chat_changes ch
      WHERE ch.organization_id = p_organization_id AND ch.channel_key = p_channel_key AND ch.cursor > p_cursor
      ORDER BY ch.cursor LIMIT 100
    ) c;
    next_cursor := coalesce(next_cursor, watermark);
    has_more := next_cursor < watermark;
    -- Replies also invalidate their root's counter. IDs remain channel scoped.
    SELECT array_agg(DISTINCT id) INTO ids FROM (
      SELECT unnest(ids) id UNION
      SELECT m.parent_message_id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.id = ANY(ids) AND m.parent_message_id IS NOT NULL
    ) affected;
  ELSIF p_mode = 'message' THEN
    SELECT coalesce(m.parent_message_id, m.id) INTO root_id FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key AND m.id = p_message_id;
    IF root_id IS NULL THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    ids := ARRAY[root_id, p_message_id];
    next_cursor := 0;
  ELSE
    IF p_mode = 'thread' THEN
      SELECT m.id INTO root_id FROM platform.team_chat_messages m
        WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
          AND m.id = p_message_id AND m.parent_message_id IS NULL;
      IF root_id IS NULL THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    END IF;
    IF p_mode = 'search' AND (p_query IS NULL OR char_length(btrim(p_query)) NOT BETWEEN 2 AND 200) THEN
      RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(m.id ORDER BY m.sequence_id DESC) INTO ids FROM (
      SELECT m.id, m.sequence_id FROM platform.team_chat_messages m
      WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key
        AND (p_cursor = 0 OR m.sequence_id < p_cursor)
        AND CASE WHEN p_mode = 'thread' THEN m.parent_message_id = root_id
          WHEN p_mode = 'search' THEN m.deleted_at IS NULL
            AND to_tsvector('simple', m.body) @@ websearch_to_tsquery('simple', p_query)
          ELSE m.parent_message_id IS NULL END
      ORDER BY m.sequence_id DESC LIMIT 51
    ) m;
    has_more := coalesce(cardinality(ids), 0) > 50;
    ids := ids[1:50];
    SELECT coalesce(min(m.sequence_id), 0) INTO next_cursor FROM platform.team_chat_messages m WHERE m.id = ANY(ids);
  END IF;
  SELECT coalesce(jsonb_agg(platform_private.team_chat_message_json(m) ORDER BY m.sequence_id), '[]'::JSONB)
    INTO rows FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.channel_key = p_channel_key AND m.id = ANY(ids);
  RETURN jsonb_build_object('messages', rows, 'cursor', next_cursor::TEXT,
    'watermark', watermark::TEXT, 'hasMore', has_more, 'latestMessageId', tail, 'rootId', root_id);
END $$;

CREATE FUNCTION platform.team_chat_command(
  p_organization_id UUID, p_channel_key TEXT, p_request_id UUID, p_input JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; msg platform.team_chat_messages; parent platform.team_chat_messages;
  receipt platform_private.team_chat_receipts; prefs platform.team_chat_preferences;
  operation TEXT; allowed TEXT[]; mentions UUID[] := '{}'; recipient UUID;
  text_body TEXT; result JSONB; reason TEXT; before_version BIGINT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority();
  IF actor.membership_id IS NULL OR NOT platform_private.team_chat_can_access(p_organization_id, p_channel_key) THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  operation := p_input ->> 'operation';
  allowed := CASE operation
    WHEN 'post' THEN ARRAY['operation', 'body', 'parentMessageId', 'mentionedMembershipIds']
    WHEN 'edit' THEN ARRAY['operation', 'messageId', 'expectedVersion', 'body', 'mentionedMembershipIds']
    WHEN 'delete' THEN ARRAY['operation', 'messageId', 'expectedVersion']
    WHEN 'moderate' THEN ARRAY['operation', 'messageId', 'expectedVersion', 'reason']
    WHEN 'read' THEN ARRAY['operation', 'messageId']
    WHEN 'mute' THEN ARRAY['operation', 'muted', 'expectedVersion'] END;
  IF allowed IS NULL OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) k WHERE NOT k = ANY(allowed)) THEN
    RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
  END IF;
  -- Consistent lock order: per-actor request, then per-channel stream. Retrying
  -- one request on a different channel cannot produce a second mutation.
  PERFORM pg_advisory_xact_lock(hashtextextended('team-chat-request:' || actor.membership_id::TEXT || ':' || p_request_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('team-chat:' || p_organization_id::TEXT || ':' || p_channel_key, 0));
  IF NOT platform_private.team_chat_can_access(p_organization_id, p_channel_key) THEN
    RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO receipt FROM platform_private.team_chat_receipts r
    WHERE r.organization_id = p_organization_id AND r.actor_membership_id = actor.membership_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF receipt.input IS DISTINCT FROM (p_input || jsonb_build_object('channelKey', p_channel_key)) THEN
      RAISE EXCEPTION 'team_chat_request_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN receipt.result;
  END IF;
  IF operation IN ('post', 'edit') THEN
    text_body := btrim(p_input ->> 'body');
    IF jsonb_typeof(p_input -> 'body') IS DISTINCT FROM 'string'
      OR char_length(text_body) NOT BETWEEN 1 AND 8000
      OR text_body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' THEN
      RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_input -> 'mentionedMembershipIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_input -> 'mentionedMembershipIds') > 20 THEN
      RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(DISTINCT v::UUID), '{}') INTO mentions
      FROM jsonb_array_elements_text(p_input -> 'mentionedMembershipIds') v;
    FOREACH recipient IN ARRAY mentions LOOP
      IF recipient IS NULL OR NOT EXISTS (
        SELECT 1 FROM platform.organization_memberships m
        JOIN platform.profiles p ON p.id = m.profile_id
        JOIN platform.role_bundle_versions b ON b.id = m.current_bundle_id AND b.role = m.current_role
        WHERE m.organization_id = p_organization_id AND m.id = recipient
          AND m.status = 'active' AND p.status = 'active' AND b.status = 'published'
          AND m.current_role IN ('admin', 'sales', 'curator')
          AND (p_channel_key = 'general' OR m.current_role = 'admin'
            OR (p_channel_key = 'sales' AND m.current_role = 'sales')
            OR (p_channel_key = 'admissions' AND m.current_role = 'curator'))
      ) THEN RAISE EXCEPTION 'team_chat_recipient_forbidden' USING ERRCODE = '42501'; END IF;
    END LOOP;
  END IF;
  IF operation = 'post' THEN
    IF p_input ->> 'parentMessageId' IS NOT NULL THEN
      SELECT * INTO parent FROM platform.team_chat_messages m
        WHERE m.id = (p_input ->> 'parentMessageId')::UUID AND m.organization_id = p_organization_id
          AND m.channel_key = p_channel_key AND m.parent_message_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    END IF;
    INSERT INTO platform.team_chat_messages (organization_id, channel_key, author_membership_id, body, parent_message_id, mentioned_membership_ids)
    VALUES (p_organization_id, p_channel_key, actor.membership_id, text_body, parent.id, mentions) RETURNING * INTO msg;
  ELSIF operation IN ('edit', 'delete', 'moderate') THEN
    SELECT * INTO msg FROM platform.team_chat_messages m WHERE m.organization_id = p_organization_id
      AND m.channel_key = p_channel_key AND m.id = (p_input ->> 'messageId')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    IF (operation = 'moderate' AND actor.platform_role <> 'admin')
      OR (operation <> 'moderate' AND msg.author_membership_id <> actor.membership_id) THEN
      RAISE EXCEPTION 'team_chat_forbidden' USING ERRCODE = '42501';
    END IF;
    IF msg.version IS DISTINCT FROM (p_input ->> 'expectedVersion')::BIGINT OR msg.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'team_chat_version_conflict' USING ERRCODE = '40001';
    END IF;
    reason := btrim(p_input ->> 'reason');
    IF operation = 'moderate' AND (reason IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500) THEN
      RAISE EXCEPTION 'team_chat_reason_required' USING ERRCODE = '22023';
    END IF;
    before_version := msg.version;
    UPDATE platform.team_chat_messages m SET
      body = CASE WHEN operation = 'edit' THEN text_body ELSE '' END,
      mentioned_membership_ids = CASE WHEN operation = 'edit' THEN mentions ELSE '{}'::UUID[] END,
      version = m.version + 1,
      edited_at = CASE WHEN operation = 'edit' THEN clock_timestamp() ELSE m.edited_at END,
      deleted_at = CASE WHEN operation = 'edit' THEN NULL ELSE clock_timestamp() END
    WHERE m.id = msg.id RETURNING * INTO msg;
  ELSE
    INSERT INTO platform.team_chat_preferences (organization_id, channel_key, membership_id)
      VALUES (p_organization_id, p_channel_key, actor.membership_id) ON CONFLICT DO NOTHING;
    SELECT * INTO prefs FROM platform.team_chat_preferences p
      WHERE p.organization_id = p_organization_id AND p.channel_key = p_channel_key AND p.membership_id = actor.membership_id FOR UPDATE;
    IF operation = 'read' THEN
      SELECT * INTO msg FROM platform.team_chat_messages m WHERE m.id = (p_input ->> 'messageId')::UUID
        AND m.organization_id = p_organization_id AND m.channel_key = p_channel_key;
      IF NOT FOUND THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
      UPDATE platform.team_chat_preferences SET read_sequence = greatest(read_sequence, msg.sequence_id)
        WHERE organization_id = p_organization_id AND channel_key = p_channel_key AND membership_id = actor.membership_id;
    ELSE
      IF prefs.version IS DISTINCT FROM (p_input ->> 'expectedVersion')::BIGINT THEN
        RAISE EXCEPTION 'team_chat_version_conflict' USING ERRCODE = '40001';
      END IF;
      IF jsonb_typeof(p_input -> 'muted') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'team_chat_invalid' USING ERRCODE = '22023';
      END IF;
      UPDATE platform.team_chat_preferences SET muted = (p_input ->> 'muted')::BOOLEAN, version = version + 1
        WHERE organization_id = p_organization_id AND channel_key = p_channel_key AND membership_id = actor.membership_id;
    END IF;
  END IF;
  result := jsonb_build_object('requestId', p_request_id, 'channelKey', p_channel_key,
    'operation', operation, 'messageId', msg.id, 'version', msg.version::TEXT);
  IF operation IN ('post', 'edit', 'delete', 'moderate') THEN
    INSERT INTO platform_private.team_chat_changes (organization_id, channel_key, message_id)
      VALUES (p_organization_id, p_channel_key, msg.id);
    INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
      action, resource_type, resource_id, before_state, after_state, reason, request_id)
    VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
      'team.chat.' || operation, 'team_chat_message', msg.id,
      jsonb_build_object('version', before_version), result,
      CASE WHEN operation = 'moderate' THEN reason ELSE 'Staff chat ' || operation END, p_request_id);
    -- No message ID, author, body, membership or timestamps on stale sessions.
    PERFORM realtime.send(jsonb_build_object('refresh', true), 'invalidate',
      'team-chat:' || p_organization_id::TEXT || ':' || p_channel_key, true);
  END IF;
  INSERT INTO platform_private.team_chat_receipts VALUES (p_organization_id, actor.membership_id, p_request_id,
    p_input || jsonb_build_object('channelKey', p_channel_key), result);
  RETURN result;
END $$;

CREATE FUNCTION platform_private.team_chat_can_subscribe(p_topic TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    CROSS JOIN (VALUES ('general'), ('sales'), ('admissions')) c(key)
    WHERE p_topic = 'team-chat:' || a.organization_id::TEXT || ':' || c.key
      AND platform_private.team_chat_can_access(a.organization_id, c.key))
$$;
CREATE POLICY team_chat_broadcast_read ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND topic = (SELECT realtime.topic())
  AND (SELECT platform_private.team_chat_can_subscribe((SELECT realtime.topic()))));

REVOKE ALL ON FUNCTION platform_private.team_chat_can_access(UUID, TEXT),
  platform_private.team_chat_message_json(platform.team_chat_messages),
  platform_private.team_chat_can_subscribe(TEXT), platform.team_chat_channels(UUID),
  platform.team_chat_read_page(UUID, TEXT, TEXT, BIGINT, UUID, TEXT),
  platform.team_chat_command(UUID, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
-- OID-bound policies need EXECUTE; platform_private has no authenticated USAGE.
GRANT EXECUTE ON FUNCTION platform_private.team_chat_can_access(UUID, TEXT),
  platform_private.team_chat_can_subscribe(TEXT), platform.team_chat_channels(UUID),
  platform.team_chat_read_page(UUID, TEXT, TEXT, BIGINT, UUID, TEXT),
  platform.team_chat_command(UUID, TEXT, UUID, JSONB) TO authenticated;
COMMENT ON TABLE platform.team_chat_messages IS
  'Native staff-only text and one-level replies; independent from case/WhatsApp/Student data. Tombstones preserve replies.';
COMMIT;
