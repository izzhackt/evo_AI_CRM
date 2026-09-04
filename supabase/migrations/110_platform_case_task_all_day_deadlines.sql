-- V3-F canonical all-day and timed deadline semantics for case tasks.

BEGIN;

ALTER TABLE platform.case_tasks
  ADD COLUMN due_on DATE;
ALTER TABLE platform.case_tasks
  ADD CONSTRAINT case_tasks_single_deadline_kind_check CHECK (
    due_at IS NULL OR due_on IS NULL
  );

DROP INDEX platform.case_tasks_student_overdue_scan_idx;
CREATE INDEX case_tasks_student_timed_overdue_scan_idx
  ON platform.case_tasks (organization_id, due_at, id)
  WHERE student_visible
    AND due_at IS NOT NULL
    AND status IN ('open', 'in_progress', 'blocked');
CREATE INDEX case_tasks_student_all_day_overdue_scan_idx
  ON platform.case_tasks (organization_id, due_on, id)
  WHERE student_visible
    AND due_on IS NOT NULL
    AND status IN ('open', 'in_progress', 'blocked');

-- Replace the superseded signatures; no compatibility overload remains.
DROP FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
);
DROP FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, BOOLEAN, BIGINT, UUID
);

CREATE FUNCTION platform.create_case_task(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_task_type TEXT,
  p_title TEXT,
  p_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_due_on DATE,
  p_status platform.case_task_status,
  p_student_visible BOOLEAN,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  target_case platform.student_cases%ROWTYPE;
  assignee RECORD;
  created_case_task_id UUID := gen_random_uuid();
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Student case task created';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_task_type IS NULL
    OR btrim(p_task_type) = ''
    OR p_title IS NULL
    OR btrim(p_title) = ''
    OR p_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_status IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task type, title, assignee, priority, status and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_due_at IS NOT NULL AND p_due_on IS NOT NULL THEN
    RAISE EXCEPTION 'Task must use either a timed or all-day deadline, not both'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'student_case_id', p_student_case_id,
    'task_type', btrim(p_task_type),
    'title', btrim(p_title),
    'assignee_membership_id', p_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'due_on', p_due_on,
    'status', p_status,
    'student_visible', p_student_visible,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'task.create', 'case_task', NULL,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    p_student_case_id,
    'task.manage'
  );
  SELECT * INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_assignee_membership_id
  );
  IF actor.actor_role <> 'admin'
    AND p_assignee_membership_id <> actor.actor_membership_id
  THEN
    RAISE EXCEPTION 'Non-Admin case owner may assign a task only to self'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'task.create', 'case_task', NULL,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  INSERT INTO platform.case_tasks (
    id, organization_id, student_case_id, task_type, title,
    assignee_membership_id, priority, due_at, due_on, status, student_visible,
    created_by_membership_id, version
  ) VALUES (
    created_case_task_id, p_organization_id, p_student_case_id, btrim(p_task_type),
    btrim(p_title), p_assignee_membership_id, p_priority, p_due_at, p_due_on, p_status,
    p_student_visible, actor.actor_membership_id, 1
  )
  RETURNING updated_at INTO changed_at;

  INSERT INTO platform.case_task_events (
    organization_id, case_task_id, student_case_id, previous_status,
    new_status, previous_assignee_membership_id,
    new_assignee_membership_id, actor_membership_id, request_id
  ) VALUES (
    p_organization_id, created_case_task_id, p_student_case_id, NULL, p_status,
    NULL, p_assignee_membership_id, actor.actor_membership_id, p_request_id
  );

  result := replay_shape || jsonb_build_object(
    'case_task_id', created_case_task_id,
    'version', 1::BIGINT::TEXT,
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'task.create', 'case_task',
    created_case_task_id, NULL, result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;


CREATE FUNCTION platform.change_case_task(
  p_organization_id UUID,
  p_case_task_id UUID,
  p_new_status platform.case_task_status,
  p_new_assignee_membership_id UUID,
  p_priority platform.case_task_priority,
  p_due_at TIMESTAMPTZ,
  p_due_on DATE,
  p_student_visible BOOLEAN,
  p_expected_version BIGINT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preliminary_actor RECORD;
  actor RECORD;
  task_row platform.case_tasks%ROWTYPE;
  assignee RECORD;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  fixed_reason CONSTANT TEXT := 'Student case task changed';
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_new_status IS NULL
    OR p_new_assignee_membership_id IS NULL
    OR p_priority IS NULL
    OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION
      'Task status, assignee, priority and visibility are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_due_at IS NOT NULL AND p_due_on IS NOT NULL THEN
    RAISE EXCEPTION 'Task must use either a timed or all-day deadline, not both'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO preliminary_actor
  FROM platform_private.require_domain_actor(
    p_organization_id,
    'task.manage'
  );
  replay_shape := jsonb_build_object(
    'organization_id', p_organization_id,
    'case_task_id', p_case_task_id,
    'status', p_new_status,
    'assignee_membership_id', p_new_assignee_membership_id,
    'priority', p_priority,
    'due_at', p_due_at,
    'due_on', p_due_on,
    'student_visible', p_student_visible,
    'expected_version', p_expected_version::TEXT
  );
  replayed := platform_private.replay_audit(
    p_request_id, 'task.change', 'case_task', p_case_task_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT * INTO task_row
  FROM platform.case_tasks AS task
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case task is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id,
    task_row.student_case_id,
    'task.manage'
  );
  SELECT * INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id,
    p_new_assignee_membership_id
  );
  IF actor.actor_role <> 'admin'
    AND (
      task_row.assignee_membership_id <> actor.actor_membership_id
      OR p_new_assignee_membership_id <> actor.actor_membership_id
      OR task_row.priority <> p_priority
      OR task_row.due_at IS DISTINCT FROM p_due_at
      OR task_row.due_on IS DISTINCT FROM p_due_on
      OR task_row.student_visible <> p_student_visible
    )
  THEN
    RAISE EXCEPTION
      'A live non-Admin task assignee may change only own task status'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id, 'task.change', 'case_task', p_case_task_id,
    fixed_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF task_row.version <> p_expected_version
    OR task_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'case_task_version_conflict'
      USING ERRCODE = 'PT409';
  END IF;
  IF task_row.status = p_new_status
    AND task_row.assignee_membership_id = p_new_assignee_membership_id
    AND task_row.priority = p_priority
    AND task_row.due_at IS NOT DISTINCT FROM p_due_at
    AND task_row.due_on IS NOT DISTINCT FROM p_due_on
    AND task_row.student_visible = p_student_visible
  THEN
    RAISE EXCEPTION 'Task mutation must change at least one field'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.case_tasks AS task
  SET status = p_new_status,
      assignee_membership_id = p_new_assignee_membership_id,
      priority = p_priority,
      due_at = p_due_at,
      due_on = p_due_on,
      student_visible = p_student_visible,
      version = task_row.version + 1
  WHERE task.organization_id = p_organization_id
    AND task.id = p_case_task_id
  RETURNING task.version, task.updated_at INTO next_version, changed_at;

  -- This append-only event stream describes status/assignee transitions only.
  -- Deadline, priority and visibility-only mutations remain fully versioned and
  -- audited below, but must not manufacture an unchanged transition event.
  IF task_row.status IS DISTINCT FROM p_new_status
    OR task_row.assignee_membership_id IS DISTINCT FROM p_new_assignee_membership_id
  THEN
    INSERT INTO platform.case_task_events (
      organization_id, case_task_id, student_case_id, previous_status,
      new_status, previous_assignee_membership_id,
      new_assignee_membership_id, actor_membership_id, request_id
    ) VALUES (
      p_organization_id, p_case_task_id, task_row.student_case_id,
      task_row.status, p_new_status, task_row.assignee_membership_id,
      p_new_assignee_membership_id, actor.actor_membership_id, p_request_id
    );
  END IF;

  result := replay_shape || jsonb_build_object(
    'student_case_id', task_row.student_case_id,
    'version', next_version::TEXT,
    'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'task.change', 'case_task',
    p_case_task_id,
    jsonb_build_object(
      'status', task_row.status,
      'assignee_membership_id', task_row.assignee_membership_id,
      'priority', task_row.priority,
      'due_at', task_row.due_at,
      'due_on', task_row.due_on,
      'student_visible', task_row.student_visible,
      'version', task_row.version::TEXT
    ),
    result, fixed_reason, p_request_id
  );

  RETURN result;
END
$$;


REVOKE ALL ON FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID
) TO authenticated;

DROP FUNCTION platform.staff_case_task_queue(INTEGER);
CREATE FUNCTION platform.staff_case_task_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  case_task_id UUID,
  version TEXT,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  task_type TEXT,
  title TEXT,
  status platform.case_task_status,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  due_on DATE,
  student_visible BOOLEAN,
  assignee_membership_id UUID,
  assignee_display_name TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN
    RAISE EXCEPTION 'Task queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('task.manage');

  RETURN QUERY
  SELECT
    CASE
      WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
      WHEN case_task.due_on IS NOT NULL THEN
        case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
    END,
    case_task.organization_id,
    case_task.id,
    case_task.version::TEXT,
    case_task.student_case_id,
    student_case.student_display_name,
    student_case.state,
    case_task.task_type,
    case_task.title,
    case_task.status,
    case_task.priority,
    case_task.due_at,
    case_task.due_on,
    case_task.student_visible,
    case_task.assignee_membership_id,
    assignee_profile.display_name,
    case_task.created_at,
    case_task.updated_at
  FROM platform.case_tasks AS case_task
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = case_task.organization_id
    AND student_case.id = case_task.student_case_id
  JOIN platform.organization_memberships AS assignee_membership
    ON assignee_membership.organization_id = case_task.organization_id
    AND assignee_membership.id = case_task.assignee_membership_id
  JOIN platform.profiles AS assignee_profile
    ON assignee_profile.id = assignee_membership.profile_id
  WHERE case_task.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY
    CASE
      WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
      WHEN case_task.due_on IS NOT NULL THEN
        case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
    END,
    case_task.id
  LIMIT p_limit;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_task_queue(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_queue(INTEGER)
  TO authenticated;

CREATE OR REPLACE FUNCTION platform.staff_student_case_task_workspace(
  p_student_case_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  tasks_payload JSONB;
BEGIN
  SELECT * INTO actor
  FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  SELECT COALESCE(
    jsonb_agg(
      task.payload
      ORDER BY task.sort_deadline, task.sort_status,
        task.created_at DESC, task.case_task_id
    ),
    '[]'::JSONB
  )
  INTO tasks_payload
  FROM (
    SELECT
      case_task.id AS case_task_id,
      CASE
        WHEN case_task.due_at IS NOT NULL THEN case_task.due_at
        WHEN case_task.due_on IS NOT NULL THEN
          case_task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
        ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
      END AS sort_deadline,
      CASE WHEN case_task.status IN ('done', 'cancelled') THEN 1 ELSE 0 END
        AS sort_status,
      case_task.created_at,
      jsonb_build_object(
        'case_task_id', case_task.id,
        'version', case_task.version::TEXT,
        'task_type', case_task.task_type,
        'title', case_task.title,
        'status', case_task.status,
        'priority', case_task.priority,
        'due_at', case_task.due_at,
        'due_on', case_task.due_on,
        'student_visible', case_task.student_visible,
        'assignee_membership_id', assignee_membership.id,
        'assignee_display_name', assignee_profile.display_name,
        'creator_membership_id', creator_membership.id,
        'creator_display_name', creator_profile.display_name,
        'created_at', case_task.created_at,
        'updated_at', case_task.updated_at
      ) AS payload
    FROM platform.case_tasks AS case_task
    JOIN platform.organization_memberships AS assignee_membership
      ON assignee_membership.organization_id = case_task.organization_id
      AND assignee_membership.id = case_task.assignee_membership_id
    JOIN platform.profiles AS assignee_profile
      ON assignee_profile.id = assignee_membership.profile_id
    JOIN platform.organization_memberships AS creator_membership
      ON creator_membership.organization_id = case_task.organization_id
      AND creator_membership.id = case_task.created_by_membership_id
    JOIN platform.profiles AS creator_profile
      ON creator_profile.id = creator_membership.profile_id
    WHERE case_task.organization_id = actor.organization_id
      AND case_task.student_case_id = actor.student_case_id
  ) AS task;

  RETURN jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', actor.student_case_id,
    'tasks', tasks_payload,
    'assignees', platform_private.u7_workspace_assignees(actor.organization_id)
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_task_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_task_workspace(UUID)
  TO authenticated;

DROP FUNCTION platform.student_portal_tasks();
CREATE FUNCTION platform.student_portal_tasks()
RETURNS TABLE (
  case_task_id UUID,
  case_id UUID,
  task_type TEXT,
  title TEXT,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
  due_on DATE,
  task_status platform.case_task_status,
  updated_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    task.id,
    task.student_case_id,
    task.task_type,
    task.title,
    task.priority,
    task.due_at,
    task.due_on,
    task.status,
    task.updated_at
  FROM platform.case_tasks AS task
  WHERE task.student_visible
    AND private.platform_can_read_student_portal_case(
      task.organization_id,
      task.student_case_id
    )
  ORDER BY
    CASE
      WHEN task.due_at IS NOT NULL THEN task.due_at
      WHEN task.due_on IS NOT NULL THEN
        task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
    END,
    task.id
$$;

REVOKE ALL ON FUNCTION platform.student_portal_tasks()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_tasks()
  TO authenticated;

-- Keep one overdue worker. For all-day tasks the persisted projection and
-- transition-state timestamp is the deterministic local end boundary: midnight
-- after due_on in Asia/Bishkek. Timed deadlines keep their exact instant.
CREATE OR REPLACE FUNCTION platform.process_student_portal_overdue_notifications_v1(
  p_request_id UUID,
  p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clock_value TIMESTAMPTZ;
  replayed JSONB;
  replay_worker_id TEXT;
  enabled_organization_ids UUID[] := ARRAY[]::UUID[];
  organization_count INTEGER := 0;
  task_candidate_count INTEGER := 0;
  task_published_count INTEGER := 0;
  task_resolved_count INTEGER := 0;
  payment_candidate_count INTEGER := 0;
  payment_published_count INTEGER := 0;
  payment_resolved_count INTEGER := 0;
  candidate RECORD;
  previous_state
    platform_private.student_portal_overdue_transition_state%ROWTYPE;
  recipient_id UUID;
  notification_id UUID;
  next_version INTEGER;
  result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_id IS NULL
    OR p_worker_id !~ '^[a-z][a-z0-9:_-]{2,127}$'
  THEN
    RAISE EXCEPTION 'worker_id is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT run.result, run.worker_id
  INTO replayed, replay_worker_id
  FROM platform_private.student_portal_overdue_notification_runs AS run
  WHERE run.request_id = p_request_id;
  IF FOUND THEN
    IF replay_worker_id IS DISTINCT FROM p_worker_id THEN
      RAISE EXCEPTION
        'request_id is already bound to another worker_id'
        USING ERRCODE = '22023';
    END IF;
    RETURN replayed;
  END IF;

  clock_value := platform_private.student_portal_overdue_clock();

  SELECT COALESCE(
    array_agg(acquired.organization_id ORDER BY acquired.organization_id),
    ARRAY[]::UUID[]
  )
  INTO enabled_organization_ids
  FROM (
    SELECT control.organization_id
    FROM platform_private.student_portal_overdue_notification_runtime_controls AS control
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
    WHERE control.enabled
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
      AND owner_profile.status = 'active'
      AND organization.status = 'active'
      AND owner_bundle.status = 'published'
    ORDER BY control.organization_id
    FOR UPDATE OF control SKIP LOCKED
  ) AS acquired;
  organization_count := cardinality(enabled_organization_ids);

  FOR candidate IN
    SELECT
      task.organization_id,
      task.id AS source_record_id,
      task.student_case_id,
      task.title AS subject_label,
      task.due_at,
      task.due_on,
      CASE
        WHEN task.due_at IS NOT NULL THEN task.due_at
        WHEN task.due_on IS NOT NULL THEN
          (task.due_on + 1)::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
        ELSE NULL
      END AS effective_due_at,
      control.automation_owner_membership_id,
      (
        task.student_visible
        AND (
          (task.due_at IS NOT NULL AND task.due_at < clock_value)
          OR (
            task.due_on IS NOT NULL
            AND (clock_value AT TIME ZONE 'Asia/Bishkek')::DATE > task.due_on
          )
        )
        AND task.status IN ('open', 'in_progress', 'blocked')
      ) AS currently_overdue
    FROM platform.case_tasks AS task
    JOIN platform_private.student_portal_overdue_notification_runtime_controls AS control
      ON control.organization_id = task.organization_id
      AND control.enabled
      AND control.organization_id = ANY(enabled_organization_ids)
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
      AND owner_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
      AND owner_bundle.status = 'published'
    LEFT JOIN platform_private.student_portal_overdue_transition_state AS state
      ON state.organization_id = task.organization_id
      AND state.source_kind = 'task'
      AND state.source_record_id = task.id
    WHERE (
      task.student_visible
        AND (
          (task.due_at IS NOT NULL AND task.due_at < clock_value)
          OR (
            task.due_on IS NOT NULL
            AND (clock_value AT TIME ZONE 'Asia/Bishkek')::DATE > task.due_on
          )
        )
        AND task.status IN ('open', 'in_progress', 'blocked')
      AND COALESCE(state.is_overdue, FALSE) = FALSE
    ) OR (
      state.is_overdue
      AND NOT (
        task.student_visible
        AND (
          (task.due_at IS NOT NULL AND task.due_at < clock_value)
          OR (
            task.due_on IS NOT NULL
            AND (clock_value AT TIME ZONE 'Asia/Bishkek')::DATE > task.due_on
          )
        )
        AND task.status IN ('open', 'in_progress', 'blocked')
      )
    )
    ORDER BY
      task.organization_id,
      CASE
        WHEN task.due_at IS NOT NULL THEN task.due_at
        WHEN task.due_on IS NOT NULL THEN
          task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
        ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
      END,
      task.id
    LIMIT 50
    FOR UPDATE OF task SKIP LOCKED
  LOOP
    task_candidate_count := task_candidate_count + 1;

    SELECT state.*
    INTO previous_state
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = candidate.organization_id
      AND state.source_kind = 'task'
      AND state.source_record_id = candidate.source_record_id
    FOR UPDATE;

    IF candidate.currently_overdue THEN
      recipient_id := platform_private.live_student_portal_recipient(
        candidate.organization_id,
        candidate.student_case_id
      );
      IF recipient_id IS NULL THEN
        CONTINUE;
      END IF;
      IF char_length(btrim(candidate.subject_label)) NOT BETWEEN 1 AND 300
        OR candidate.subject_label ~ '[[:cntrl:]]'
      THEN
        RAISE EXCEPTION 'Student-visible task title is unsafe'
          USING ERRCODE = '22023';
      END IF;

      next_version := COALESCE(previous_state.transition_version, 0) + 1;
      notification_id := gen_random_uuid();

      INSERT INTO platform.notifications (
        id, organization_id, student_case_id, recipient_membership_id,
        category, title, body, dedupe_key, created_by_membership_id,
        created_at, updated_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'task.overdue', 'Task overdue',
        'Open the task in the Student Portal to review the next action.',
        'p6c:task:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT,
        candidate.automation_owner_membership_id, clock_value, clock_value
      );

      INSERT INTO platform.student_portal_overdue_notification_projection_v1 (
        notification_id, organization_id, student_case_id,
        recipient_membership_id, source_kind, source_record_id,
        transition_version, subject_label, detail, due_at, created_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'task', candidate.source_record_id, next_version,
        btrim(candidate.subject_label),
        'The task deadline has passed. Open the task to review the next action.',
        candidate.effective_due_at, clock_value
      );

      INSERT INTO platform.notification_events (
        organization_id, notification_id, student_case_id,
        recipient_membership_id, event_type, actor_membership_id, reason,
        request_id, created_at
      ) VALUES (
        candidate.organization_id, notification_id, candidate.student_case_id,
        recipient_id, 'created', candidate.automation_owner_membership_id,
        'Overdue task episode published to Student Portal',
        public.uuid_generate_v5(
          p_request_id,
          'p6c:task:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT
        ),
        clock_value
      );

      INSERT INTO platform_private.student_portal_overdue_transition_state (
        organization_id, source_kind, source_record_id, student_case_id,
        recipient_membership_id, is_overdue, transition_version,
        observed_due_at, first_overdue_at, resolved_at, updated_at
      ) VALUES (
        candidate.organization_id, 'task', candidate.source_record_id,
        candidate.student_case_id, recipient_id, TRUE, next_version,
        candidate.effective_due_at, clock_value, NULL, clock_value
      )
      ON CONFLICT (organization_id, source_kind, source_record_id)
      DO UPDATE SET
        student_case_id = EXCLUDED.student_case_id,
        recipient_membership_id = EXCLUDED.recipient_membership_id,
        is_overdue = TRUE,
        transition_version = EXCLUDED.transition_version,
        observed_due_at = EXCLUDED.observed_due_at,
        first_overdue_at = EXCLUDED.first_overdue_at,
        resolved_at = NULL,
        updated_at = EXCLUDED.updated_at;
      task_published_count := task_published_count + 1;
    ELSIF previous_state.is_overdue THEN
      UPDATE platform_private.student_portal_overdue_transition_state AS state
      SET is_overdue = FALSE,
          observed_due_at = COALESCE(candidate.effective_due_at, state.observed_due_at),
          resolved_at = clock_value,
          updated_at = clock_value
      WHERE state.organization_id = candidate.organization_id
        AND state.source_kind = 'task'
        AND state.source_record_id = candidate.source_record_id;
      task_resolved_count := task_resolved_count + 1;
    END IF;
  END LOOP;

  FOR candidate IN
    SELECT
      obligation.organization_id,
      obligation.id AS source_record_id,
      obligation.student_case_id,
      obligation.label AS subject_label,
      obligation.due_at,
      control.automation_owner_membership_id,
      (
        obligation.due_at < clock_value
        AND obligation.amount_minor - obligation.total_paid_minor
          + obligation.total_refunded_minor > 0
      ) AS currently_overdue
    FROM platform.payment_obligations AS obligation
    JOIN platform_private.student_portal_overdue_notification_runtime_controls AS control
      ON control.organization_id = obligation.organization_id
      AND control.enabled
      AND control.organization_id = ANY(enabled_organization_ids)
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
      AND owner_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
      AND owner_bundle.status = 'published'
    LEFT JOIN platform_private.student_portal_overdue_transition_state AS state
      ON state.organization_id = obligation.organization_id
      AND state.source_kind = 'payment'
      AND state.source_record_id = obligation.id
    WHERE (
      obligation.due_at < clock_value
      AND obligation.amount_minor - obligation.total_paid_minor
        + obligation.total_refunded_minor > 0
      AND COALESCE(state.is_overdue, FALSE) = FALSE
    ) OR (
      state.is_overdue
      AND NOT (
        obligation.due_at < clock_value
        AND obligation.amount_minor - obligation.total_paid_minor
          + obligation.total_refunded_minor > 0
      )
    )
    ORDER BY obligation.organization_id, obligation.due_at, obligation.id
    LIMIT 50
    FOR UPDATE OF obligation SKIP LOCKED
  LOOP
    payment_candidate_count := payment_candidate_count + 1;

    SELECT state.*
    INTO previous_state
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = candidate.organization_id
      AND state.source_kind = 'payment'
      AND state.source_record_id = candidate.source_record_id
    FOR UPDATE;

    IF candidate.currently_overdue THEN
      recipient_id := platform_private.live_student_portal_recipient(
        candidate.organization_id,
        candidate.student_case_id
      );
      IF recipient_id IS NULL THEN
        CONTINUE;
      END IF;
      IF char_length(btrim(candidate.subject_label)) NOT BETWEEN 1 AND 300
        OR candidate.subject_label ~ '[[:cntrl:]]'
      THEN
        RAISE EXCEPTION 'Student-visible payment label is unsafe'
          USING ERRCODE = '22023';
      END IF;

      next_version := COALESCE(previous_state.transition_version, 0) + 1;
      notification_id := gen_random_uuid();

      INSERT INTO platform.notifications (
        id, organization_id, student_case_id, recipient_membership_id,
        category, title, body, dedupe_key, created_by_membership_id,
        created_at, updated_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'payment.overdue', 'Payment overdue',
        'Open the finance section in the Student Portal to review the next action.',
        'p6c:payment:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT,
        candidate.automation_owner_membership_id, clock_value, clock_value
      );

      INSERT INTO platform.student_portal_overdue_notification_projection_v1 (
        notification_id, organization_id, student_case_id,
        recipient_membership_id, source_kind, source_record_id,
        transition_version, subject_label, detail, due_at, created_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'payment', candidate.source_record_id, next_version,
        btrim(candidate.subject_label),
        'The payment due time has passed. Open finance to review the next action.',
        candidate.due_at, clock_value
      );

      INSERT INTO platform.notification_events (
        organization_id, notification_id, student_case_id,
        recipient_membership_id, event_type, actor_membership_id, reason,
        request_id, created_at
      ) VALUES (
        candidate.organization_id, notification_id, candidate.student_case_id,
        recipient_id, 'created', candidate.automation_owner_membership_id,
        'Overdue payment episode published to Student Portal',
        public.uuid_generate_v5(
          p_request_id,
          'p6c:payment:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT
        ),
        clock_value
      );

      INSERT INTO platform_private.student_portal_overdue_transition_state (
        organization_id, source_kind, source_record_id, student_case_id,
        recipient_membership_id, is_overdue, transition_version,
        observed_due_at, first_overdue_at, resolved_at, updated_at
      ) VALUES (
        candidate.organization_id, 'payment', candidate.source_record_id,
        candidate.student_case_id, recipient_id, TRUE, next_version,
        candidate.due_at, clock_value, NULL, clock_value
      )
      ON CONFLICT (organization_id, source_kind, source_record_id)
      DO UPDATE SET
        student_case_id = EXCLUDED.student_case_id,
        recipient_membership_id = EXCLUDED.recipient_membership_id,
        is_overdue = TRUE,
        transition_version = EXCLUDED.transition_version,
        observed_due_at = EXCLUDED.observed_due_at,
        first_overdue_at = EXCLUDED.first_overdue_at,
        resolved_at = NULL,
        updated_at = EXCLUDED.updated_at;
      payment_published_count := payment_published_count + 1;
    ELSIF previous_state.is_overdue THEN
      UPDATE platform_private.student_portal_overdue_transition_state AS state
      SET is_overdue = FALSE,
          observed_due_at = candidate.due_at,
          resolved_at = clock_value,
          updated_at = clock_value
      WHERE state.organization_id = candidate.organization_id
        AND state.source_kind = 'payment'
        AND state.source_record_id = candidate.source_record_id;
      payment_resolved_count := payment_resolved_count + 1;
    END IF;
  END LOOP;

  result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'completed',
    'organizations_processed', organization_count,
    'task_candidates', task_candidate_count,
    'task_published', task_published_count,
    'task_resolved', task_resolved_count,
    'payment_candidates', payment_candidate_count,
    'payment_published', payment_published_count,
    'payment_resolved', payment_resolved_count
  );

  INSERT INTO platform_private.student_portal_overdue_notification_runs (
    request_id, worker_id, status, organizations_processed,
    task_candidates, task_published, task_resolved,
    payment_candidates, payment_published, payment_resolved,
    result, completed_at
  ) VALUES (
    p_request_id, p_worker_id, 'completed', organization_count,
    task_candidate_count, task_published_count, task_resolved_count,
    payment_candidate_count, payment_published_count,
    payment_resolved_count, result, clock_value
  );

  RETURN result;
END
$$;


REVOKE ALL ON FUNCTION platform.process_student_portal_overdue_notifications_v1(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.process_student_portal_overdue_notifications_v1(UUID, TEXT)
  TO service_role;

COMMENT ON COLUMN platform.case_tasks.due_on IS
  'Optional all-day deadline in the EVO organization timezone (Asia/Bishkek); mutually exclusive with due_at.';
COMMENT ON CONSTRAINT case_tasks_single_deadline_kind_check ON platform.case_tasks IS
  'A task is timed, all-day, or unscheduled, never both timed and all-day.';
COMMENT ON FUNCTION platform.create_case_task(
  UUID, UUID, TEXT, TEXT, UUID, platform.case_task_priority, TIMESTAMPTZ, DATE,
  platform.case_task_status, BOOLEAN, BIGINT, UUID
) IS 'Creates one canonical case task with an optional timed or all-day deadline and optimistic version zero.';
COMMENT ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID
) IS 'Changes one canonical case task with mutually exclusive deadline kinds and optimistic concurrency.';

CREATE OR REPLACE FUNCTION platform.staff_student_case_page(
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_student_case_id UUID DEFAULT NULL,
  p_state platform.student_case_state DEFAULT NULL,
  p_query TEXT DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL
)
RETURNS TABLE (
  access_mode TEXT,
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  language_assumption TEXT,
  funding_assumption TEXT,
  route_approval_status platform.route_approval_status,
  operational_stage TEXT,
  state platform.student_case_state,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  handoff_at TIMESTAMPTZ,
  next_action TEXT,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  applied_ozo_workflow_contract_version_id UUID,
  overdue_task_count BIGINT,
  overdue_obligation_count BIGINT,
  rejected_document_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 101 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_sort_at IS NULL) <> (p_before_student_case_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete student-case cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH visible AS MATERIALIZED (
    SELECT
      'full'::TEXT AS access_mode,
      student_case.updated_at AS sort_at,
      student_case.organization_id,
      student_case.id AS student_case_id,
      student_case.student_display_name,
      student_case.target_country,
      student_case.target_degree,
      student_case.program_direction,
      student_case.intake,
      student_case.language_assumption,
      student_case.funding_assumption,
      student_case.route_approval_status,
      student_case.operational_stage,
      student_case.state,
      student_case.created_at,
      student_case.updated_at,
      student_case.handoff_at,
      student_case.next_action,
      sales_profile.display_name AS responsible_sales_display_name,
      curator_profile.display_name AS current_curator_display_name,
      student_case.applied_ozo_workflow_contract_version_id
    FROM platform.current_actor_authority() AS authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
    JOIN platform.organization_memberships AS sales_membership
      ON sales_membership.organization_id = student_case.organization_id
     AND sales_membership.id = student_case.responsible_sales_membership_id
    JOIN platform.profiles AS sales_profile
      ON sales_profile.id = sales_membership.profile_id
    LEFT JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = student_case.organization_id
     AND curator_membership.id = student_case.current_curator_membership_id
    LEFT JOIN platform.profiles AS curator_profile
      ON curator_profile.id = curator_membership.profile_id
    WHERE private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )

    UNION ALL

    SELECT
      'sales_summary'::TEXT,
      student_case.handoff_at,
      student_case.organization_id,
      student_case.id,
      student_case.student_display_name,
      student_case.target_country,
      student_case.target_degree,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::platform.route_approval_status,
      NULL::TEXT,
      student_case.state,
      student_case.created_at,
      student_case.updated_at,
      student_case.handoff_at,
      NULL::TEXT,
      NULL::TEXT,
      curator_profile.display_name,
      NULL::UUID
    FROM platform.current_actor_authority() AS authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
    JOIN platform.organization_memberships AS sales_membership
      ON sales_membership.organization_id = student_case.organization_id
     AND sales_membership.id = student_case.responsible_sales_membership_id
    JOIN platform.profiles AS sales_profile
      ON sales_profile.id = sales_membership.profile_id
    JOIN platform.organization_memberships AS curator_membership
      ON curator_membership.organization_id = student_case.organization_id
     AND curator_membership.id = student_case.current_curator_membership_id
    JOIN platform.profiles AS curator_profile
      ON curator_profile.id = curator_membership.profile_id
    WHERE sales_profile.auth_user_id = (SELECT auth.uid())
      AND sales_membership.status = 'active'
      AND sales_membership."current_role" = 'sales'
      AND sales_profile.status = 'active'
      AND curator_membership.status = 'active'
      AND curator_membership."current_role" = 'curator'
      AND curator_profile.status = 'active'
      AND student_case.state IN ('active', 'closed')
      AND student_case.handoff_at IS NOT NULL
      AND private.platform_has_permission(
        student_case.organization_id,
        'case.read.summary'
      )
      AND NOT COALESCE(
        private.platform_can_read_student_case(
          student_case.organization_id,
          student_case.id
        ),
        FALSE
      )
  ),
  page AS MATERIALIZED (
    SELECT visible.*
    FROM visible
    WHERE (p_state IS NULL OR visible.state = p_state)
      AND (
        p_student_case_id IS NULL
        OR visible.student_case_id = p_student_case_id
      )
      AND (
        p_query IS NULL
        OR btrim(p_query) = ''
        OR strpos(
          lower(concat_ws(
            ' ',
            visible.student_display_name,
            visible.target_country,
            visible.target_degree,
            visible.program_direction
          )),
          lower(btrim(p_query))
        ) > 0
      )
      AND (
        p_before_sort_at IS NULL
        OR (visible.sort_at, visible.student_case_id)
          < (p_before_sort_at, p_before_student_case_id)
      )
    ORDER BY visible.sort_at DESC, visible.student_case_id DESC
    LIMIT p_limit
  )
  SELECT
    page.access_mode,
    page.sort_at,
    page.organization_id,
    page.student_case_id,
    page.student_display_name,
    page.target_country,
    page.target_degree,
    page.program_direction,
    page.intake,
    page.language_assumption,
    page.funding_assumption,
    page.route_approval_status,
    page.operational_stage,
    page.state,
    page.created_at,
    page.updated_at,
    page.handoff_at,
    page.next_action,
    page.responsible_sales_display_name,
    page.current_curator_display_name,
    page.applied_ozo_workflow_contract_version_id,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.case_tasks AS task
      WHERE task.organization_id = page.organization_id
        AND task.student_case_id = page.student_case_id
        AND (
          (task.due_at IS NOT NULL AND task.due_at < statement_timestamp())
          OR (
            task.due_on IS NOT NULL
            AND (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE
              > task.due_on
          )
        )
        AND task.status NOT IN ('done', 'cancelled')
    ) END,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = page.organization_id
        AND obligation.student_case_id = page.student_case_id
        AND obligation.due_at < statement_timestamp()
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    ) END,
    CASE WHEN page.access_mode = 'full' THEN (
      SELECT count(*)
      FROM platform.document_slots AS slot
      WHERE slot.organization_id = page.organization_id
        AND slot.student_case_id = page.student_case_id
        AND slot.status = 'rejected'
    ) END
  FROM page
  ORDER BY page.sort_at DESC, page.student_case_id DESC;
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.student_case_state, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.student_case_state, TEXT, UUID
) TO authenticated;

COMMENT ON FUNCTION platform.staff_student_case_page(
  INTEGER, TIMESTAMPTZ, UUID, platform.student_case_state, TEXT, UUID
) IS 'Current staff Student Case page with Bishkek-local all-day and exact-instant timed overdue counts.';

COMMIT;
