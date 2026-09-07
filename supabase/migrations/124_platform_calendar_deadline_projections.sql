-- ============================================================
-- 124_platform_calendar_deadline_projections.sql
--
-- D2 Calendar read projections:
--   (a) a bounded keyset page containing only undated case tasks;
--   (b) a bounded keyset page of explicit university application deadlines;
--   (c) the globally earliest visible active application deadline.
--
-- These are read-only projections. They neither infer deadlines nor create a
-- second task/application authority. Date values remain DATE throughout.
-- ============================================================

BEGIN;

CREATE INDEX university_applications_calendar_deadline_idx
  ON platform.university_applications (
    organization_id,
    university_deadline_on,
    id
  )
  WHERE university_deadline_on IS NOT NULL
    AND status IN ('preparation', 'ready', 'submitted', 'under_review', 'offer');

CREATE INDEX case_tasks_undated_calendar_idx
  ON platform.case_tasks (organization_id, id)
  WHERE due_at IS NULL AND due_on IS NULL;

CREATE FUNCTION private.staff_case_task_undated_page(
  p_limit INTEGER,
  p_after_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_after_case_task_id UUID DEFAULT NULL
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
  undated_sentinel CONSTANT TIMESTAMPTZ :=
    '9999-12-31 00:00:00+00'::TIMESTAMPTZ;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN
    RAISE EXCEPTION 'Undated task page limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  IF (p_after_sort_at IS NULL) <> (p_after_case_task_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete undated task cursor'
      USING ERRCODE = '22023';
  END IF;

  IF p_after_sort_at IS NOT NULL AND p_after_sort_at <> undated_sentinel THEN
    RAISE EXCEPTION 'Invalid undated task cursor sentinel'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('task.manage');

  RETURN QUERY
  SELECT
    undated_sentinel,
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
    AND case_task.due_at IS NULL
    AND case_task.due_on IS NULL
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
    AND (
      p_after_case_task_id IS NULL
      OR case_task.id > p_after_case_task_id
    )
  ORDER BY case_task.id
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_case_task_undated_page(
  p_limit INTEGER,
  p_after_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_after_case_task_id UUID DEFAULT NULL
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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_case_task_undated_page(
    p_limit,
    p_after_sort_at,
    p_after_case_task_id
  ) AS page
$$;

CREATE FUNCTION private.staff_application_deadline_page(
  p_limit INTEGER,
  p_after_deadline DATE DEFAULT NULL,
  p_after_application_id UUID DEFAULT NULL,
  p_due_from DATE DEFAULT NULL,
  p_due_to DATE DEFAULT NULL
)
RETURNS TABLE (
  application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  university_name TEXT,
  program_name TEXT,
  application_status platform.application_status,
  deadline DATE
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
    RAISE EXCEPTION 'Application deadline page limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  IF (p_after_deadline IS NULL) <> (p_after_application_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete application deadline cursor'
      USING ERRCODE = '22023';
  END IF;

  IF (
    p_after_deadline IS NOT NULL
    AND NOT pg_catalog.isfinite(p_after_deadline)
  ) OR (
    p_due_from IS NOT NULL
    AND NOT pg_catalog.isfinite(p_due_from)
  ) OR (
    p_due_to IS NOT NULL
    AND NOT pg_catalog.isfinite(p_due_to)
  ) OR (
    p_due_from IS NOT NULL
    AND p_due_to IS NOT NULL
    AND p_due_to < p_due_from
  ) THEN
    RAISE EXCEPTION 'Invalid application deadline bounds or cursor'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('application.manage');

  RETURN QUERY
  SELECT
    application.id,
    application.student_case_id,
    student_case.student_display_name,
    application.institution_name,
    application.program_name,
    application.status,
    application.university_deadline_on
  FROM platform.university_applications AS application
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = application.organization_id
    AND student_case.id = application.student_case_id
  WHERE application.organization_id = actor.organization_id
    AND student_case.state = 'active'
    AND application.university_deadline_on IS NOT NULL
    AND application.status IN (
      'preparation', 'ready', 'submitted', 'under_review', 'offer'
    )
    AND private.platform_can_read_student_case(
      application.organization_id,
      application.student_case_id
    )
    AND (
      p_due_from IS NULL
      OR application.university_deadline_on >= p_due_from
    )
    AND (
      p_due_to IS NULL
      OR application.university_deadline_on <= p_due_to
    )
    AND (
      p_after_deadline IS NULL
      OR (
        application.university_deadline_on,
        application.id
      ) > (p_after_deadline, p_after_application_id)
    )
  ORDER BY application.university_deadline_on, application.id
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.staff_application_deadline_page(
  p_limit INTEGER,
  p_after_deadline DATE DEFAULT NULL,
  p_after_application_id UUID DEFAULT NULL,
  p_due_from DATE DEFAULT NULL,
  p_due_to DATE DEFAULT NULL
)
RETURNS TABLE (
  application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  university_name TEXT,
  program_name TEXT,
  application_status platform.application_status,
  deadline DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_application_deadline_page(
    p_limit,
    p_after_deadline,
    p_after_application_id,
    p_due_from,
    p_due_to
  ) AS page
$$;

CREATE FUNCTION platform.staff_nearest_application_deadline()
RETURNS TABLE (
  application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  university_name TEXT,
  program_name TEXT,
  application_status platform.application_status,
  deadline DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT page.*
  FROM private.staff_application_deadline_page(1, NULL, NULL, NULL, NULL) AS page
$$;

REVOKE ALL ON FUNCTION private.staff_case_task_undated_page(
  INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_case_task_undated_page(
  INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.staff_application_deadline_page(
  INTEGER, DATE, UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_application_deadline_page(
  INTEGER, DATE, UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_nearest_application_deadline()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION private.staff_case_task_undated_page(
  INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_undated_page(
  INTEGER, TIMESTAMPTZ, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION private.staff_application_deadline_page(
  INTEGER, DATE, UUID, DATE, DATE
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_application_deadline_page(
  INTEGER, DATE, UUID, DATE, DATE
) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_nearest_application_deadline()
  TO authenticated;

COMMENT ON FUNCTION platform.staff_case_task_undated_page(
  INTEGER, TIMESTAMPTZ, UUID
) IS
  'Bounded Admissions-only page of undated tasks in migration-119 canonical (undated sentinel, case_task_id) ascending keyset order.';
COMMENT ON FUNCTION platform.staff_application_deadline_page(
  INTEGER, DATE, UUID, DATE, DATE
) IS
  'Bounded Admissions-only page of explicit application deadlines for visible active cases and active application statuses in (deadline, application_id) ascending keyset order.';
COMMENT ON FUNCTION platform.staff_nearest_application_deadline() IS
  'One-row globally earliest explicit application deadline across all visible active applications, independent of a selected calendar range.';

COMMIT;
