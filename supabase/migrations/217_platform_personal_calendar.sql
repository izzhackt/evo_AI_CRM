BEGIN;

-- Calendar ownership is an additional projection boundary, not a new task
-- permission. The shared Tasks/case readers and every write command stay intact.
CREATE FUNCTION platform_private.personal_calendar_rows_v1(
  p_kind TEXT DEFAULT NULL, p_task_id UUID DEFAULT NULL
) RETURNS TABLE(sort_at TIMESTAMPTZ, kind TEXT, task_id UUID, task JSONB)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor RECORD; can_case BOOLEAN; can_staff BOOLEAN;
BEGIN
  SELECT a.organization_id, a.membership_id INTO actor
  FROM platform.current_actor_authority() AS a
  JOIN platform_private.staff_membership_identity(a.organization_id, a.membership_id) AS i ON TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Personal calendar is unavailable' USING ERRCODE = '42501';
  END IF;
  can_case := platform_private.staff_has_permission(actor.organization_id, actor.membership_id, 'task.manage');
  can_staff := platform_private.staff_has_permission(actor.organization_id, actor.membership_id, 'staff.task.read');
  IF NOT (can_case OR can_staff) THEN
    RAISE EXCEPTION 'Personal calendar is unavailable' USING ERRCODE = '42501';
  END IF;

  IF can_case AND (p_kind IS NULL OR p_kind = 'case') THEN
    RETURN QUERY
    SELECT deadline.sort_at, 'case'::TEXT, t.id, jsonb_build_object(
      'kind', 'case', 'task_id', t.id, 'organization_id', t.organization_id,
      'version', t.version::TEXT, 'title', t.title, 'details', NULL::TEXT,
      'status', t.status, 'priority', t.priority, 'due_on', t.due_on, 'due_at', t.due_at,
      'sort_at', deadline.sort_at, 'assignee_membership_id', t.assignee_membership_id,
      'assignee_display_name', p.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at,
      'student_case_id', c.id, 'student_display_name', c.student_display_name,
      'case_state', c.state, 'task_type', t.task_type, 'student_visible', t.student_visible)
    FROM platform.case_tasks AS t
    JOIN platform.student_cases AS c ON c.organization_id = t.organization_id AND c.id = t.student_case_id
    JOIN platform.organization_memberships AS m ON m.organization_id = t.organization_id AND m.id = t.assignee_membership_id
    JOIN platform.profiles AS p ON p.id = m.profile_id
    CROSS JOIN LATERAL (SELECT CASE WHEN t.due_at IS NOT NULL THEN t.due_at
      WHEN t.due_on IS NOT NULL THEN t.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ END AS sort_at) AS deadline
    WHERE t.organization_id = actor.organization_id AND t.assignee_membership_id = actor.membership_id
      AND (p_task_id IS NULL OR t.id = p_task_id)
      AND c.state IN ('active', 'closed') AND c.handoff_at IS NOT NULL
      AND platform_private.staff_can_access(t.organization_id, actor.membership_id, 'task.manage', 'task', t.id);
  END IF;

  IF can_staff AND (p_kind IS NULL OR p_kind = 'staff') THEN
    RETURN QUERY
    SELECT deadline.sort_at, 'staff'::TEXT, t.id, jsonb_build_object(
      'kind', 'staff', 'task_id', t.id, 'organization_id', t.organization_id,
      'version', t.version::TEXT, 'title', t.title, 'details', t.description,
      'status', t.status, 'priority', t.priority, 'due_on', t.due_on, 'due_at', t.due_at,
      'sort_at', deadline.sort_at, 'assignee_membership_id', t.assignee_membership_id,
      'assignee_display_name', p.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at)
    FROM platform.staff_tasks AS t
    JOIN platform.organization_memberships AS m ON m.organization_id = t.organization_id AND m.id = t.assignee_membership_id
    JOIN platform.profiles AS p ON p.id = m.profile_id
    CROSS JOIN LATERAL (SELECT CASE WHEN t.due_at IS NOT NULL THEN t.due_at
      WHEN t.due_on IS NOT NULL THEN t.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
      ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ END AS sort_at) AS deadline
    WHERE t.organization_id = actor.organization_id AND t.assignee_membership_id = actor.membership_id
      AND (p_task_id IS NULL OR t.id = p_task_id)
      AND platform_private.staff_can_access(t.organization_id, actor.membership_id, 'staff.task.read', 'staff_task', t.id);
  END IF;
END;
$$;

CREATE FUNCTION platform.staff_personal_calendar_page_v1(
  p_mode TEXT, p_due_from DATE DEFAULT NULL, p_due_to DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 100, p_after_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_after_kind TEXT DEFAULT NULL, p_after_task_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('dated', 'undated') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR ((p_after_sort_at IS NULL)::INTEGER + (p_after_kind IS NULL)::INTEGER + (p_after_task_id IS NULL)::INTEGER) NOT IN (0, 3)
    OR (p_after_kind IS NOT NULL AND p_after_kind NOT IN ('case', 'staff'))
    OR (p_after_sort_at IS NOT NULL AND NOT pg_catalog.isfinite(p_after_sort_at))
    OR (p_mode = 'dated' AND (p_due_from IS NULL OR p_due_to IS NULL
      OR NOT pg_catalog.isfinite(p_due_from) OR NOT pg_catalog.isfinite(p_due_to) OR p_due_from > p_due_to))
    OR (p_mode = 'undated' AND (p_due_from IS NOT NULL OR p_due_to IS NOT NULL
      OR (p_after_sort_at IS NOT NULL AND p_after_sort_at <> '9999-12-31 00:00:00+00'::TIMESTAMPTZ)))
  THEN RAISE EXCEPTION 'Invalid personal calendar page' USING ERRCODE = '22023'; END IF;

  WITH eligible AS MATERIALIZED (
    SELECT r.* FROM platform_private.personal_calendar_rows_v1() AS r
    WHERE CASE WHEN p_mode = 'undated' THEN r.task->>'due_on' IS NULL AND r.task->>'due_at' IS NULL
      ELSE (r.task->>'due_on' IS NOT NULL OR r.task->>'due_at' IS NOT NULL)
        AND (pg_catalog.timezone('Asia/Bishkek', r.sort_at)::DATE BETWEEN p_due_from AND p_due_to) END
  ), bounded AS MATERIALIZED (
    SELECT e.* FROM eligible AS e
    WHERE p_after_sort_at IS NULL OR (e.sort_at, e.kind, e.task_id) > (p_after_sort_at, p_after_kind, p_after_task_id)
    ORDER BY e.sort_at, e.kind, e.task_id LIMIT p_limit + 1
  ), numbered AS (
    SELECT b.*, row_number() OVER (ORDER BY b.sort_at, b.kind, b.task_id) AS position FROM bounded AS b
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(n.task ORDER BY n.sort_at, n.kind, n.task_id) FROM numbered AS n WHERE n.position <= p_limit), '[]'::JSONB),
    'total_count', (SELECT count(*) FROM eligible),
    'next_cursor', CASE WHEN (SELECT count(*) FROM bounded) > p_limit THEN
      (SELECT jsonb_build_object('sort_at', n.sort_at, 'kind', n.kind, 'task_id', n.task_id) FROM numbered AS n WHERE n.position = p_limit)
      ELSE NULL END) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION platform.staff_personal_calendar_target_v1(
  p_kind TEXT, p_task_id UUID, p_student_case_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE personal_task JSONB; case_target JSONB := NULL;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('case', 'staff') OR p_task_id IS NULL
    OR (p_kind = 'case' AND p_student_case_id IS NULL)
    OR (p_kind = 'staff' AND p_student_case_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Invalid personal calendar target' USING ERRCODE = '22023'; END IF;
  SELECT r.task INTO personal_task FROM platform_private.personal_calendar_rows_v1(p_kind, p_task_id) AS r;
  IF NOT FOUND OR (p_kind = 'case' AND (personal_task->>'student_case_id')::UUID IS DISTINCT FROM p_student_case_id) THEN
    RAISE EXCEPTION 'Personal calendar task is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'case' THEN
    -- One STABLE call keeps personal ownership and canonical control authority
    -- in the same snapshot. A later write still rechecks its own live authority.
    case_target := platform.staff_case_task_target((personal_task->>'organization_id')::UUID, p_student_case_id, p_task_id);
  END IF;
  RETURN jsonb_build_object('task', personal_task, 'case_target', case_target);
END;
$$;

REVOKE ALL ON FUNCTION platform_private.personal_calendar_rows_v1(TEXT,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_personal_calendar_page_v1(TEXT,DATE,DATE,INTEGER,TIMESTAMPTZ,TEXT,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_personal_calendar_target_v1(TEXT,UUID,UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_personal_calendar_page_v1(TEXT,DATE,DATE,INTEGER,TIMESTAMPTZ,TEXT,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_personal_calendar_target_v1(TEXT,UUID,UUID) TO authenticated;

COMMIT;
