-- Native staff notifications and an atomic, authorized message-to-task command.
-- No provider dispatch, Student notification changes or external message payloads.
BEGIN;

ALTER TABLE platform.staff_tasks DROP CONSTRAINT staff_tasks_source_pending;
ALTER TABLE platform.staff_tasks ADD CONSTRAINT staff_tasks_source_message_fk
  FOREIGN KEY (source_message_id) REFERENCES platform.team_chat_messages(id) ON DELETE RESTRICT;

CREATE TABLE platform_private.staff_chat_task_links (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  staff_task_id UUID NOT NULL UNIQUE,
  message_id UUID NOT NULL REFERENCES platform.team_chat_messages(id),
  message_version BIGINT NOT NULL,
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organization_id, staff_task_id) REFERENCES platform.staff_tasks(organization_id, id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id, id)
);
ALTER TABLE platform_private.staff_chat_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_chat_task_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform_private.staff_chat_task_links FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER staff_chat_task_links_append_only BEFORE UPDATE OR DELETE ON platform_private.staff_chat_task_links
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Reassignment must not copy a department message's derived task to another
-- department. This also protects direct calls to the ordinary task command.
CREATE FUNCTION platform_private.check_staff_task_source() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE channel TEXT; assignee_role platform.business_role;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.source_message_id IS NOT NULL
    AND NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
  THEN RAISE EXCEPTION 'staff_task_source_immutable' USING ERRCODE = '42501'; END IF;
  IF NEW.source_message_id IS NULL THEN RETURN NEW; END IF;
  SELECT m.channel_key INTO channel FROM platform.team_chat_messages m
    WHERE m.organization_id = NEW.organization_id AND m.id = NEW.source_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' OR OLD.source_message_id IS NULL
    OR NEW.assignee_membership_id IS DISTINCT FROM OLD.assignee_membership_id THEN
    SELECT m.current_role INTO assignee_role FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = NEW.organization_id AND m.id = NEW.assignee_membership_id
        AND m.status = 'active' AND p.status = 'active' FOR SHARE OF m, p;
    IF NOT FOUND OR assignee_role NOT IN ('admin', 'sales', 'curator')
      OR (channel = 'sales' AND assignee_role NOT IN ('admin', 'sales'))
      OR (channel = 'admissions' AND assignee_role NOT IN ('admin', 'curator'))
    THEN RAISE EXCEPTION 'staff_task_source_assignee_forbidden' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_tasks_source_guard BEFORE INSERT OR UPDATE ON platform.staff_tasks
  FOR EACH ROW EXECUTE FUNCTION platform_private.check_staff_task_source();

CREATE FUNCTION platform.create_staff_task_from_chat(
  p_organization_id UUID, p_request_id UUID, p_message_id UUID,
  p_message_version BIGINT, p_title TEXT, p_assignee_membership_id UUID,
  p_description TEXT DEFAULT NULL, p_priority platform.case_task_priority DEFAULT 'normal',
  p_due_on DATE DEFAULT NULL, p_due_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; message platform.team_chat_messages%ROWTYPE;
  prior platform_private.staff_chat_task_links%ROWTYPE; payload JSONB; receipt JSONB; task_id UUID;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_message_id IS NULL OR p_message_version IS NULL OR p_message_version < 1
  THEN RAISE EXCEPTION 'staff_task_source_invalid' USING ERRCODE = '22023'; END IF;
  -- Same lock namespace/order as the canonical task command; no duplicate task
  -- can appear if a browser retries after losing the successful HTTP response.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-task:' || p_request_id::TEXT, 0));
  SELECT * INTO message FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.id = p_message_id;
  IF NOT FOUND OR NOT platform_private.team_chat_can_access(p_organization_id, message.channel_key)
  THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('team-chat:' || p_organization_id::TEXT || ':' || message.channel_key, 0));
  SELECT * INTO STRICT message FROM platform.team_chat_messages m
    WHERE m.organization_id = p_organization_id AND m.id = p_message_id FOR SHARE;
  payload := jsonb_build_object('message_id', p_message_id, 'message_version', p_message_version::TEXT,
    'title', btrim(p_title), 'assignee_membership_id', p_assignee_membership_id,
    'description', NULLIF(btrim(p_description), ''), 'priority', p_priority, 'due_on', p_due_on, 'due_at', p_due_at);
  SELECT * INTO prior FROM platform_private.staff_chat_task_links WHERE request_id = p_request_id;
  IF FOUND THEN
    IF prior.organization_id IS DISTINCT FROM p_organization_id OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id
      OR prior.input IS DISTINCT FROM payload
    THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE = '23505'; END IF;
    IF NOT EXISTS (SELECT 1 FROM platform.staff_tasks t WHERE t.organization_id = p_organization_id
      AND t.id = prior.staff_task_id AND (actor.platform_role = 'admin'
        OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id)))
    THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE = '42501'; END IF;
    RETURN prior.result;
  END IF;
  IF EXISTS (SELECT 1 FROM platform_private.staff_task_receipts WHERE request_id = p_request_id)
  THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE = '23505'; END IF;
  IF message.deleted_at IS NOT NULL OR message.version <> p_message_version
  THEN RAISE EXCEPTION 'staff_task_source_changed' USING ERRCODE = 'PT409'; END IF;
  receipt := platform.mutate_staff_task(p_organization_id, 'create', p_request_id, 0,
    NULL, p_title, p_assignee_membership_id, p_description, 'open', p_priority, p_due_on, p_due_at);
  task_id := (receipt->>'staff_task_id')::UUID;
  UPDATE platform.staff_tasks SET source_message_id = p_message_id WHERE id = task_id;
  INSERT INTO platform_private.staff_chat_task_links
    (request_id, organization_id, actor_membership_id, staff_task_id, message_id, message_version, input, result)
    VALUES (p_request_id, p_organization_id, actor.membership_id, task_id, p_message_id, p_message_version, payload, receipt);
  INSERT INTO platform_private.team_chat_changes (organization_id, channel_key, message_id)
    VALUES (p_organization_id, message.channel_key, p_message_id);
  PERFORM realtime.send(jsonb_build_object('refresh', true), 'invalidate',
    'team-chat:' || p_organization_id::TEXT || ':' || message.channel_key, true);
  -- The task's create event records creation; this immutable link ledger records
  -- the subsequent provenance binding in the SAME transaction, without text.
  RETURN receipt;
END $$;

CREATE TABLE platform.staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task_assigned', 'task_updated', 'chat_mention')),
  staff_task_id UUID,
  message_id UUID REFERENCES platform.team_chat_messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ,
  UNIQUE (organization_id, recipient_membership_id, event_key),
  FOREIGN KEY (organization_id, recipient_membership_id) REFERENCES platform.organization_memberships(organization_id, id),
  FOREIGN KEY (organization_id, staff_task_id) REFERENCES platform.staff_tasks(organization_id, id),
  CHECK ((kind = 'chat_mention' AND message_id IS NOT NULL AND staff_task_id IS NULL)
    OR (kind <> 'chat_mention' AND staff_task_id IS NOT NULL AND message_id IS NULL))
);
CREATE INDEX staff_notifications_recipient_idx ON platform.staff_notifications
  (organization_id, recipient_membership_id, created_at DESC, id DESC);
CREATE INDEX staff_notifications_unread_idx ON platform.staff_notifications
  (organization_id, recipient_membership_id) WHERE read_at IS NULL;
ALTER TABLE platform.staff_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_notifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.staff_notifications FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION platform.team_chat_task_links(p_organization_id UUID, p_message_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; links JSONB;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_source_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_message_ids IS NULL OR cardinality(p_message_ids) > 100
  THEN RAISE EXCEPTION 'staff_task_source_invalid' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('message_id', t.source_message_id, 'staff_task_id', t.id)
    ORDER BY t.created_at, t.id), '[]') INTO links
  FROM platform.staff_tasks t JOIN platform.team_chat_messages m ON m.id = t.source_message_id
  WHERE t.organization_id = p_organization_id AND m.organization_id = p_organization_id
    AND t.source_message_id = ANY(p_message_ids) AND m.deleted_at IS NULL
    AND platform_private.team_chat_can_access(p_organization_id, m.channel_key)
    AND (actor.platform_role = 'admin' OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id));
  RETURN links;
END $$;

-- Provenance is independently authorized; task access never grants channel access.
CREATE FUNCTION platform.staff_task_chat_source(p_organization_id UUID, p_task_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('message_id', m.id, 'channel_key', m.channel_key)
  FROM platform.staff_tasks t JOIN platform.team_chat_messages m ON m.id = t.source_message_id
  JOIN platform.current_actor_authority() a ON a.organization_id = t.organization_id
  WHERE t.organization_id = p_organization_id AND m.organization_id = p_organization_id
    AND t.id = p_task_id AND a.platform_role IN ('admin','sales','curator')
    AND (a.platform_role = 'admin' OR a.membership_id IN (t.creator_membership_id, t.assignee_membership_id))
    AND platform_private.team_chat_can_access(p_organization_id, m.channel_key)
$$;

CREATE FUNCTION platform_private.staff_notification_visible(n platform.staff_notifications)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = n.organization_id AND a.membership_id = n.recipient_membership_id
      AND a.platform_role IN ('admin','sales','curator') AND (
        (n.staff_task_id IS NOT NULL AND EXISTS (SELECT 1 FROM platform.staff_tasks t
          WHERE t.organization_id = n.organization_id AND t.id = n.staff_task_id
            AND (a.platform_role = 'admin' OR a.membership_id IN (t.creator_membership_id, t.assignee_membership_id))))
        OR (n.message_id IS NOT NULL AND EXISTS (SELECT 1 FROM platform.team_chat_messages m
          WHERE m.organization_id = n.organization_id AND m.id = n.message_id AND m.deleted_at IS NULL
            AND a.membership_id = ANY(m.mentioned_membership_ids)
            AND platform_private.team_chat_can_access(n.organization_id, m.channel_key)))
      ))
$$;

CREATE FUNCTION platform_private.notify_staff_task_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE task_row platform.staff_tasks%ROWTYPE;
BEGIN
  SELECT * INTO STRICT task_row FROM platform.staff_tasks t WHERE t.id = NEW.staff_task_id;
  INSERT INTO platform.staff_notifications (organization_id, recipient_membership_id, event_key, kind, staff_task_id)
    SELECT NEW.organization_id, m.id, 'task:' || NEW.id::TEXT,
      CASE WHEN m.id = task_row.assignee_membership_id AND
        (NEW.action = 'create' OR NEW.before_state->>'assignee_membership_id' IS DISTINCT FROM task_row.assignee_membership_id::TEXT)
      THEN 'task_assigned' ELSE 'task_updated' END, task_row.id
    FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active' AND p.status = 'active'
      AND m.current_role IN ('admin','sales','curator') AND m.id <> NEW.actor_membership_id
      AND m.id IN (task_row.creator_membership_id, task_row.assignee_membership_id)
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_task_event_notifications AFTER INSERT ON platform.staff_task_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.notify_staff_task_event();

CREATE FUNCTION platform_private.notify_staff_chat_mention() RETURNS TRIGGER
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
      AND NOT EXISTS (SELECT 1 FROM platform.team_chat_preferences pref WHERE pref.organization_id = NEW.organization_id
        AND pref.channel_key = NEW.channel_key AND pref.membership_id = m.id AND pref.muted)
    ON CONFLICT (organization_id, recipient_membership_id, event_key) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER team_chat_mention_notifications AFTER INSERT OR UPDATE ON platform.team_chat_messages
  FOR EACH ROW EXECUTE FUNCTION platform_private.notify_staff_chat_mention();

CREATE FUNCTION platform.staff_notifications_page(
  p_organization_id UUID, p_before_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; items JSONB; unread_count BIGINT;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin','sales','curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE = '42501'; END IF;
  IF (p_before_at IS NULL) <> (p_before_id IS NULL)
  THEN RAISE EXCEPTION 'staff_notifications_cursor_invalid' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO unread_count FROM platform.staff_notifications n
    WHERE n.organization_id = p_organization_id AND n.recipient_membership_id = actor.membership_id
      AND n.read_at IS NULL AND platform_private.staff_notification_visible(n);
  SELECT COALESCE(jsonb_agg(q.item ORDER BY q.created_at DESC, q.id DESC), '[]') INTO items FROM (
    SELECT n.created_at, n.id, jsonb_build_object('id', n.id, 'kind', n.kind,
      'created_at', n.created_at, 'read_at', n.read_at, 'staff_task_id', n.staff_task_id,
      'message_id', n.message_id, 'channel_key', m.channel_key, 'parent_message_id', m.parent_message_id) AS item
    FROM platform.staff_notifications n LEFT JOIN platform.team_chat_messages m ON m.id = n.message_id
    WHERE n.organization_id = p_organization_id AND n.recipient_membership_id = actor.membership_id
      AND platform_private.staff_notification_visible(n)
      AND (p_before_at IS NULL OR (n.created_at, n.id) < (p_before_at, p_before_id))
    ORDER BY n.created_at DESC, n.id DESC LIMIT 51
  ) q;
  RETURN jsonb_build_object('items', items, 'unread_count', unread_count::TEXT);
END $$;

CREATE FUNCTION platform.mark_staff_notification_read(p_organization_id UUID, p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE row platform.staff_notifications%ROWTYPE;
BEGIN
  SELECT * INTO row FROM platform.staff_notifications n
    WHERE n.organization_id = p_organization_id AND n.id = p_notification_id FOR UPDATE;
  IF NOT FOUND OR NOT platform_private.staff_notification_visible(row)
  THEN RAISE EXCEPTION 'staff_notifications_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE platform.staff_notifications SET read_at = COALESCE(read_at, clock_timestamp()) WHERE id = row.id;
  RETURN jsonb_build_object('id', row.id, 'read', true);
END $$;

REVOKE ALL ON FUNCTION platform_private.check_staff_task_source(),
  platform_private.staff_notification_visible(platform.staff_notifications),
  platform_private.notify_staff_task_event(), platform_private.notify_staff_chat_mention()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.create_staff_task_from_chat(UUID,UUID,UUID,BIGINT,TEXT,UUID,TEXT,platform.case_task_priority,DATE,TIMESTAMPTZ),
  platform.team_chat_task_links(UUID,UUID[]), platform.staff_task_chat_source(UUID,UUID),
  platform.staff_notifications_page(UUID,TIMESTAMPTZ,UUID), platform.mark_staff_notification_read(UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.create_staff_task_from_chat(UUID,UUID,UUID,BIGINT,TEXT,UUID,TEXT,platform.case_task_priority,DATE,TIMESTAMPTZ),
  platform.team_chat_task_links(UUID,UUID[]), platform.staff_task_chat_source(UUID,UUID),
  platform.staff_notifications_page(UUID,TIMESTAMPTZ,UUID), platform.mark_staff_notification_read(UUID,UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
