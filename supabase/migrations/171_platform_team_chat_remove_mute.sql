-- Retire team-channel muting without deleting messages, read cursors or receipts.
-- Keep the inert preference columns and channel response shape for safe app rollback.
-- PostgreSQL CREATE OR REPLACE retains existing function ownership and grants.
BEGIN;

CREATE OR REPLACE FUNCTION platform.team_chat_command(
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
    WHEN 'read' THEN ARRAY['operation', 'messageId'] END;
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
    SELECT * INTO msg FROM platform.team_chat_messages m WHERE m.id = (p_input ->> 'messageId')::UUID
      AND m.organization_id = p_organization_id AND m.channel_key = p_channel_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'team_chat_not_found' USING ERRCODE = 'P0002'; END IF;
    UPDATE platform.team_chat_preferences SET read_sequence = greatest(read_sequence, msg.sequence_id)
      WHERE organization_id = p_organization_id AND channel_key = p_channel_key AND membership_id = actor.membership_id;
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

CREATE OR REPLACE FUNCTION platform_private.notify_staff_chat_mention() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_mentions UUID[] := '{}'; actor_membership UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN previous_mentions := OLD.mentioned_membership_ids; END IF;
  SELECT a.membership_id INTO actor_membership FROM platform.current_actor_authority() a;
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, message_id)
    SELECT NEW.organization_id, m.id, 'message:' || NEW.id::TEXT || ':' || NEW.version::TEXT, 'chat_mention', NEW.id
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active' AND p.status = 'active'
      AND m.current_role IN ('admin','sales','curator') AND m.id IS DISTINCT FROM actor_membership
      AND m.id = ANY(NEW.mentioned_membership_ids) AND NOT (m.id = ANY(previous_mentions))
      AND (NEW.channel_key = 'general' OR m.current_role = 'admin'
        OR (NEW.channel_key = 'sales' AND m.current_role = 'sales')
        OR (NEW.channel_key = 'admissions' AND m.current_role = 'curator'))
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END $$;

COMMIT;
