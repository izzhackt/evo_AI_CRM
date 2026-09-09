-- R2: standalone staff tasks in the existing Platform authority.
-- Read policies never derive task access from a channel or department alone.
-- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
-- https://supabase.com/docs/guides/database/functions (definer search_path/grants)
BEGIN;

CREATE TABLE platform.staff_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  creator_membership_id UUID NOT NULL,
  assignee_membership_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 1000
    AND regexp_replace(title, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]'),
  description TEXT CHECK (description IS NULL OR (char_length(description) BETWEEN 1 AND 10000
    AND regexp_replace(description, E'[\n\r\t]', '', 'g') !~ '[[:cntrl:]]')),
  status platform.case_task_status NOT NULL DEFAULT 'open',
  priority platform.case_task_priority NOT NULL DEFAULT 'normal',
  due_on DATE,
  due_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  source_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, creator_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assignee_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  CHECK (due_on IS NULL OR due_at IS NULL),
  CHECK (due_on IS NULL OR (isfinite(due_on) AND due_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')),
  CHECK (due_at IS NULL OR (isfinite(due_at) AND due_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00' AND due_at < TIMESTAMPTZ '10000-01-01 00:00:00+00')),
  -- 142 replaces this with the channel-authorized provenance contract.
  CONSTRAINT staff_tasks_source_pending CHECK (source_message_id IS NULL)
);
CREATE INDEX staff_tasks_assignee_idx ON platform.staff_tasks (organization_id, assignee_membership_id, updated_at DESC, id DESC);
CREATE INDEX staff_tasks_creator_idx ON platform.staff_tasks (organization_id, creator_membership_id, updated_at DESC, id DESC);
CREATE INDEX staff_tasks_list_idx ON platform.staff_tasks (organization_id, updated_at DESC, id DESC);

CREATE TABLE platform.staff_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  staff_task_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  actor_profile_id UUID NOT NULL REFERENCES platform.profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('create', 'edit', 'status')),
  version BIGINT NOT NULL CHECK (version > 0),
  before_state JSONB,
  after_state JSONB NOT NULL,
  request_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (organization_id, staff_task_id) REFERENCES platform.staff_tasks(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, staff_task_id, version)
);
CREATE TABLE platform_private.staff_task_receipts (
  request_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  actor_membership_id UUID NOT NULL,
  staff_task_id UUID NOT NULL,
  request_payload JSONB NOT NULL,
  result JSONB NOT NULL,
  FOREIGN KEY (organization_id, staff_task_id) REFERENCES platform.staff_tasks(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES platform.organization_memberships(organization_id, id) ON DELETE RESTRICT
);
CREATE INDEX staff_task_events_actor_idx ON platform.staff_task_events (organization_id, actor_membership_id);
CREATE INDEX staff_task_events_profile_idx ON platform.staff_task_events (actor_profile_id);
CREATE INDEX staff_task_receipts_task_idx ON platform_private.staff_task_receipts (organization_id, staff_task_id);
CREATE INDEX staff_task_receipts_actor_idx ON platform_private.staff_task_receipts (organization_id, actor_membership_id);
CREATE TRIGGER staff_task_events_append_only BEFORE UPDATE OR DELETE ON platform.staff_task_events
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER staff_task_receipts_append_only BEFORE UPDATE OR DELETE ON platform_private.staff_task_receipts
  FOR EACH ROW EXECUTE FUNCTION platform_private.block_append_only_mutation();

ALTER TABLE platform.staff_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.staff_task_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_task_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.staff_task_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.staff_tasks, platform.staff_task_events, platform_private.staff_task_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON platform.staff_tasks, platform.staff_task_events TO authenticated;

CREATE POLICY staff_tasks_read ON platform.staff_tasks FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = staff_tasks.organization_id
      AND a.platform_role IN ('admin', 'sales', 'curator')
      AND (a.platform_role = 'admin' OR a.membership_id IN (staff_tasks.creator_membership_id, staff_tasks.assignee_membership_id)))
);
CREATE POLICY staff_task_events_read ON platform.staff_task_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM platform.staff_tasks t
    WHERE t.organization_id = staff_task_events.organization_id AND t.id = staff_task_events.staff_task_id)
);

CREATE FUNCTION platform.mutate_staff_task(
  p_organization_id UUID, p_operation TEXT, p_request_id UUID, p_expected_version BIGINT,
  p_staff_task_id UUID DEFAULT NULL, p_title TEXT DEFAULT NULL,
  p_assignee_membership_id UUID DEFAULT NULL, p_description TEXT DEFAULT NULL,
  p_status platform.case_task_status DEFAULT NULL,
  p_priority platform.case_task_priority DEFAULT NULL, p_due_on DATE DEFAULT NULL,
  p_due_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor RECORD;
  task_row platform.staff_tasks%ROWTYPE;
  prior platform_private.staff_task_receipts%ROWTYPE;
  assignee RECORD;
  payload JSONB;
  previous JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
  WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin', 'sales', 'curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;
  -- Serialize against staff suspension/role changes, then recheck the exact JWT.
  PERFORM 1 FROM platform.profiles WHERE id = actor.profile_id FOR SHARE;
  PERFORM 1 FROM platform.organization_memberships WHERE id = actor.membership_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.membership_id = actor.membership_id)
  THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;

  IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN ('create', 'edit', 'status')
    OR p_expected_version IS NULL OR p_expected_version < 0 OR p_status IS NULL
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE = '22023'; END IF;
  IF (p_operation = 'create' AND (p_staff_task_id IS NOT NULL OR p_expected_version <> 0 OR p_status <> 'open'))
    OR (p_operation <> 'create' AND (p_staff_task_id IS NULL OR p_expected_version < 1))
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE = '22023'; END IF;
  IF p_operation = 'status' AND (p_title IS NOT NULL OR p_assignee_membership_id IS NOT NULL
    OR p_description IS NOT NULL OR p_priority IS NOT NULL OR p_due_on IS NOT NULL OR p_due_at IS NOT NULL)
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE = '22023'; END IF;
  IF p_operation <> 'status' AND (p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 1000
    OR regexp_replace(p_title, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
    OR p_assignee_membership_id IS NULL OR p_priority IS NULL
    OR char_length(COALESCE(p_description, '')) > 10000
    OR regexp_replace(COALESCE(p_description, ''), E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]'
    OR (p_due_on IS NOT NULL AND p_due_at IS NOT NULL)
    OR (p_due_on IS NOT NULL AND (NOT isfinite(p_due_on) OR p_due_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'))
    OR (p_due_at IS NOT NULL AND (NOT isfinite(p_due_at) OR p_due_at < TIMESTAMPTZ '0001-01-01 00:00:00+00' OR p_due_at >= TIMESTAMPTZ '10000-01-01 00:00:00+00')))
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE = '22023'; END IF;

  payload := jsonb_build_object('operation', p_operation, 'task_id', p_staff_task_id,
    'expected_version', p_expected_version::TEXT, 'title', btrim(p_title),
    'assignee_membership_id', p_assignee_membership_id, 'description', NULLIF(btrim(p_description), ''),
    'status', p_status, 'priority', p_priority, 'due_on', p_due_on, 'due_at', p_due_at);
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-task:' || p_request_id::TEXT, 0));
  SELECT * INTO prior FROM platform_private.staff_task_receipts WHERE request_id = p_request_id;
  IF FOUND AND (prior.organization_id IS DISTINCT FROM p_organization_id
    OR prior.actor_membership_id IS DISTINCT FROM actor.membership_id OR prior.request_payload IS DISTINCT FROM payload)
  THEN RAISE EXCEPTION 'staff_task_request_id_conflict' USING ERRCODE = '23505'; END IF;

  IF p_operation <> 'create' OR prior.request_id IS NOT NULL THEN
    SELECT * INTO task_row FROM platform.staff_tasks t
      WHERE t.organization_id = p_organization_id AND t.id = COALESCE(p_staff_task_id, prior.staff_task_id) FOR UPDATE;
    IF NOT FOUND OR (actor.platform_role <> 'admin'
      AND actor.membership_id NOT IN (task_row.creator_membership_id, task_row.assignee_membership_id))
    THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;
    IF p_operation = 'edit' AND actor.platform_role <> 'admin' AND actor.membership_id <> task_row.creator_membership_id
    THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;
  END IF;
  -- Replays return only the receipt; current row authority is still required.
  IF prior.request_id IS NOT NULL THEN RETURN prior.result; END IF;

  IF p_operation <> 'status' THEN
    SELECT m.id, m."current_role" AS role INTO assignee FROM platform.organization_memberships m
      JOIN platform.profiles p ON p.id = m.profile_id
      WHERE m.organization_id = p_organization_id AND m.id = p_assignee_membership_id
        AND m.status = 'active' AND p.status = 'active' AND m."current_role" IN ('admin', 'sales', 'curator')
      FOR SHARE OF m, p;
    IF NOT FOUND OR (actor.platform_role <> 'admin' AND assignee.role <> actor.platform_role)
    THEN RAISE EXCEPTION 'staff_task_assignee_forbidden' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_operation <> 'create' AND (task_row.version <> p_expected_version OR task_row.version = 9223372036854775807)
  THEN RAISE EXCEPTION 'staff_task_version_conflict' USING ERRCODE = 'PT409'; END IF;
  IF p_operation = 'create' THEN
    INSERT INTO platform.staff_tasks (organization_id, creator_membership_id, assignee_membership_id,
      title, description, status, priority, due_on, due_at, created_at, updated_at)
    VALUES (p_organization_id, actor.membership_id, p_assignee_membership_id, btrim(p_title),
      NULLIF(btrim(p_description), ''), p_status, p_priority, p_due_on, p_due_at, changed_at, changed_at)
    RETURNING * INTO task_row;
  ELSE
    previous := to_jsonb(task_row);
    IF p_operation = 'status' THEN
      UPDATE platform.staff_tasks SET status = p_status, version = version + 1, updated_at = changed_at
        WHERE id = task_row.id RETURNING * INTO task_row;
    ELSE
      UPDATE platform.staff_tasks SET title = btrim(p_title), description = NULLIF(btrim(p_description), ''),
        assignee_membership_id = p_assignee_membership_id, status = p_status, priority = p_priority,
        due_on = p_due_on, due_at = p_due_at, version = version + 1, updated_at = changed_at
        WHERE id = task_row.id RETURNING * INTO task_row;
    END IF;
  END IF;
  result := jsonb_build_object('staff_task_id', task_row.id, 'version', task_row.version::TEXT,
    'request_id', p_request_id, 'changed_at', changed_at);
  INSERT INTO platform.staff_task_events (organization_id, staff_task_id, actor_membership_id,
    actor_profile_id, action, version, before_state, after_state, request_id, created_at)
  VALUES (p_organization_id, task_row.id, actor.membership_id, actor.profile_id, p_operation,
    task_row.version, previous, to_jsonb(task_row), p_request_id, changed_at);
  -- Global audit stores identifiers only; task content stays within task visibility.
  INSERT INTO platform.audit_events (organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state, reason, request_id,
    created_at, actor_membership_id, resulting_version)
  VALUES (p_organization_id, 'user', actor.profile_id, 'auth:' || actor.auth_user_id::TEXT,
    'staff.task.' || p_operation, 'staff_task', task_row.id, NULL, result,
    'Staff task ' || p_operation, p_request_id, changed_at, actor.membership_id, task_row.version);
  INSERT INTO platform_private.staff_task_receipts VALUES (p_request_id, p_organization_id,
    actor.membership_id, task_row.id, payload, result);
  RETURN result;
END;
$$;

CREATE FUNCTION platform.staff_task_list(
  p_organization_id UUID, p_view TEXT DEFAULT 'mine', p_status TEXT DEFAULT 'active',
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL, p_before_id UUID DEFAULT NULL,
  p_task_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 51
) RETURNS TABLE (
  id UUID, organization_id UUID, creator_membership_id UUID, creator_display_name TEXT,
  assignee_membership_id UUID, assignee_display_name TEXT, title TEXT, description TEXT,
  status platform.case_task_status, priority platform.case_task_priority,
  due_on DATE, due_at TIMESTAMPTZ, version TEXT, source_message_id UUID,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD;
BEGIN
  SELECT * INTO actor FROM platform.current_actor_authority() a
    WHERE a.organization_id = p_organization_id AND a.platform_role IN ('admin', 'sales', 'curator');
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_task_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_view IS NULL OR p_view NOT IN ('mine', 'created', 'all') OR p_status IS NULL
    OR p_status NOT IN ('active', 'overdue', 'completed', 'all') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
    OR ((p_before_updated_at IS NULL) <> (p_before_id IS NULL))
  THEN RAISE EXCEPTION 'staff_task_invalid' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT t.id, t.organization_id, t.creator_membership_id, cp.display_name,
    t.assignee_membership_id, ap.display_name, t.title, t.description, t.status, t.priority,
    t.due_on, t.due_at, t.version::TEXT, t.source_message_id, t.created_at, t.updated_at
  FROM platform.staff_tasks t
    JOIN platform.organization_memberships cm ON cm.organization_id = t.organization_id AND cm.id = t.creator_membership_id
    JOIN platform.profiles cp ON cp.id = cm.profile_id
    JOIN platform.organization_memberships am ON am.organization_id = t.organization_id AND am.id = t.assignee_membership_id
    JOIN platform.profiles ap ON ap.id = am.profile_id
  WHERE t.organization_id = p_organization_id
    AND (actor.platform_role = 'admin' OR actor.membership_id IN (t.creator_membership_id, t.assignee_membership_id))
    AND (p_task_id IS NULL OR t.id = p_task_id)
    AND (p_task_id IS NOT NULL OR p_view = 'all' OR (p_view = 'mine' AND t.assignee_membership_id = actor.membership_id)
      OR (p_view = 'created' AND t.creator_membership_id = actor.membership_id))
    AND (p_task_id IS NOT NULL OR p_status = 'all'
      OR (p_status = 'completed' AND t.status IN ('done', 'cancelled'))
      OR (p_status = 'active' AND t.status NOT IN ('done', 'cancelled'))
      OR (p_status = 'overdue' AND t.status NOT IN ('done', 'cancelled')
        AND (t.due_at < statement_timestamp() OR t.due_on < (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE)))
    AND (p_before_updated_at IS NULL OR (t.updated_at, t.id) < (p_before_updated_at, p_before_id))
  ORDER BY t.updated_at DESC, t.id DESC LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION platform.mutate_staff_task(UUID,TEXT,UUID,BIGINT,UUID,TEXT,UUID,TEXT,platform.case_task_status,platform.case_task_priority,DATE,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.mutate_staff_task(UUID,TEXT,UUID,BIGINT,UUID,TEXT,UUID,TEXT,platform.case_task_status,platform.case_task_priority,DATE,TIMESTAMPTZ) TO authenticated;
REVOKE ALL ON FUNCTION platform.staff_task_list(UUID,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.staff_task_list(UUID,TEXT,TEXT,TIMESTAMPTZ,UUID,UUID,INTEGER) TO authenticated;
COMMIT;
