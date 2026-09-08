-- UX-2: one canonical task command; Curators may edit the operational deadline
-- and priority of their own task in a currently authorized active case.
-- University application deadlines, assignment and student visibility are not
-- new Curator permissions. Reasons stay in the protected audit, not raw UI data.
-- RPC/security reference: https://supabase.com/docs/guides/database/functions

DROP FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID
);

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
  p_request_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  task_row platform.case_tasks%ROWTYPE;
  assignee RECORD;
  replayed JSONB;
  replay_shape JSONB;
  result JSONB;
  next_version BIGINT;
  changed_at TIMESTAMPTZ;
  change_reason TEXT;
BEGIN
  PERFORM platform_private.lock_p2d_request(p_request_id);

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'case_task_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF p_new_status IS NULL OR p_new_assignee_membership_id IS NULL
    OR p_priority IS NULL OR p_student_visible IS NULL
  THEN
    RAISE EXCEPTION 'Task status, assignee, priority and visibility are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_due_at IS NOT NULL AND p_due_on IS NOT NULL THEN
    RAISE EXCEPTION 'Task must use either a timed or all-day deadline, not both'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Task change reason must contain 1 to 1000 characters'
      USING ERRCODE = '22023';
  END IF;
  change_reason := COALESCE(btrim(p_reason), 'Student case task changed');

  PERFORM platform_private.require_domain_actor(p_organization_id, 'task.manage');
  SELECT * INTO task_row
  FROM platform.case_tasks AS task
  WHERE task.organization_id = p_organization_id AND task.id = p_case_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case task is unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor
  FROM platform_private.require_case_operator(
    p_organization_id, task_row.student_case_id, 'task.manage'
  );
  SELECT * INTO assignee
  FROM platform_private.require_live_task_assignee(
    p_organization_id, p_new_assignee_membership_id
  );
  IF actor.actor_role <> 'admin' AND (
    actor.actor_role <> 'curator'
    OR task_row.assignee_membership_id <> actor.actor_membership_id
    OR p_new_assignee_membership_id <> actor.actor_membership_id
    OR task_row.student_visible <> p_student_visible
  ) THEN
    RAISE EXCEPTION 'A live Curator may change only their own task without changing assignment or visibility'
      USING ERRCODE = '42501';
  END IF;

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
  -- Recheck current case/assignee authority even for a replay after reassignment.
  replayed := platform_private.replay_audit(
    p_request_id, 'task.change', 'case_task', p_case_task_id,
    change_reason, replay_shape
  );
  IF replayed IS NOT NULL THEN RETURN replayed; END IF;

  IF task_row.version <> p_expected_version
    OR task_row.version = 9223372036854775807
  THEN
    RAISE EXCEPTION 'case_task_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF actor.actor_role = 'curator' AND (
    task_row.priority IS DISTINCT FROM p_priority
    OR task_row.due_at IS DISTINCT FROM p_due_at
    OR task_row.due_on IS DISTINCT FROM p_due_on
  ) AND NOT EXISTS (
    SELECT 1 FROM platform.student_cases AS student_case
    WHERE student_case.organization_id = p_organization_id
      AND student_case.id = task_row.student_case_id
      AND student_case.state = 'active'
  ) THEN
    RAISE EXCEPTION 'Operational task edits require an active student case'
      USING ERRCODE = '42501';
  END IF;
  -- Temporary old-Admin rollback window; remove after owner acceptance (#687).
  IF p_reason IS NULL AND actor.actor_role <> 'admin' AND (
    task_row.priority IS DISTINCT FROM p_priority
    OR task_row.due_at IS DISTINCT FROM p_due_at
    OR task_row.due_on IS DISTINCT FROM p_due_on
  ) THEN
    RAISE EXCEPTION 'A reason is required to change a task deadline or priority'
      USING ERRCODE = '22023';
  END IF;
  IF task_row.status = p_new_status
    AND task_row.assignee_membership_id = p_new_assignee_membership_id
    AND task_row.priority = p_priority
    AND task_row.due_at IS NOT DISTINCT FROM p_due_at
    AND task_row.due_on IS NOT DISTINCT FROM p_due_on
    AND task_row.student_visible = p_student_visible
  THEN
    RAISE EXCEPTION 'Task mutation must change at least one field' USING ERRCODE = '22023';
  END IF;

  UPDATE platform.case_tasks AS task
  SET status = p_new_status,
      assignee_membership_id = p_new_assignee_membership_id,
      priority = p_priority,
      due_at = p_due_at,
      due_on = p_due_on,
      student_visible = p_student_visible,
      version = task_row.version + 1
  WHERE task.organization_id = p_organization_id AND task.id = p_case_task_id
  RETURNING task.version, task.updated_at INTO next_version, changed_at;

  -- Deadline/priority-only changes belong to audit, not a fabricated transition.
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
    'version', next_version::TEXT, 'changed_at', changed_at
  );
  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal, action,
    resource_type, resource_id, before_state, after_state, reason, request_id
  ) VALUES (
    p_organization_id, 'user', actor.actor_profile_id,
    'auth:' || actor.actor_auth_user_id::TEXT, 'task.change', 'case_task', p_case_task_id,
    jsonb_build_object(
      'status', task_row.status,
      'assignee_membership_id', task_row.assignee_membership_id,
      'priority', task_row.priority, 'due_at', task_row.due_at, 'due_on', task_row.due_on,
      'student_visible', task_row.student_visible, 'version', task_row.version::TEXT
    ), result, change_reason, p_request_id
  );
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT
) TO authenticated;

COMMENT ON FUNCTION platform.change_case_task(
  UUID, UUID, platform.case_task_status, UUID, platform.case_task_priority,
  TIMESTAMPTZ, DATE, BOOLEAN, BIGINT, UUID, TEXT
) IS 'Versioned, reason-audited task command: Admin controls or authorized own-task Curator status/priority/operational deadline edits; no Curator assignment/visibility changes.';
