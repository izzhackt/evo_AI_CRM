-- ============================================================
-- 131_platform_student_portal_next_steps.sql
--
-- UX-8: keep one Student-self overview projection while making action
-- ownership explicit. Document lifecycle state proves a Student action; a
-- currently live staff assignee proves an EVO action. Free-text case wording
-- is intentionally not used to guess either owner.
-- SECURITY DEFINER/search_path and least-privilege grants follow:
-- https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/sql-createfunction.html
-- ============================================================

BEGIN;

DROP FUNCTION platform.student_portal_overview_v1();

CREATE FUNCTION platform.student_portal_overview_v1()
RETURNS TABLE (
  operational_stage TEXT,
  student_action_kind TEXT,
  student_action_label TEXT,
  student_action_due_at TIMESTAMPTZ,
  student_action_document_slot_id UUID,
  evo_action_task_id UUID,
  evo_action_title TEXT,
  evo_action_status platform.case_task_status,
  evo_action_due_at TIMESTAMPTZ,
  evo_action_due_on DATE,
  curator_display_name TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH authority AS MATERIALIZED (
    SELECT current_authority.*
    FROM platform.current_actor_authority() AS current_authority
    JOIN platform.organization_memberships AS student_membership
      ON student_membership.organization_id = current_authority.organization_id
      AND student_membership.id = current_authority.membership_id
      AND student_membership.status = 'active'
      AND student_membership."current_role" = 'student'
    JOIN platform.profiles AS student_profile
      ON student_profile.id = student_membership.profile_id
      AND student_profile.id = current_authority.profile_id
      AND student_profile.auth_user_id = current_authority.auth_user_id
      AND student_profile.auth_user_id = (SELECT auth.uid())
      AND student_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = student_membership.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = student_membership.current_bundle_id
      AND bundle.role = student_membership."current_role"
      AND bundle.status = 'published'
    WHERE current_authority.platform_role = 'student'
      AND private.platform_has_permission(
        current_authority.organization_id,
        'portal.read.self'
      )
      AND private.platform_has_scope(
        current_authority.organization_id,
        'organization'::platform.scope_kind,
        current_authority.organization_id
      )
  )
  SELECT
    student_case.operational_stage,
    student_action.action_kind,
    student_action.action_label,
    student_action.due_at,
    student_action.document_slot_id,
    evo_action.case_task_id,
    evo_action.title,
    evo_action.status,
    evo_action.due_at,
    evo_action.due_on,
    curator.display_name
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  LEFT JOIN LATERAL (
    SELECT curator_profile.display_name
    FROM platform.organization_memberships AS curator_membership
    JOIN platform.profiles AS curator_profile
      ON curator_profile.id = curator_membership.profile_id
      AND curator_profile.status = 'active'
    JOIN platform.role_bundle_versions AS curator_bundle
      ON curator_bundle.id = curator_membership.current_bundle_id
      AND curator_bundle.role = curator_membership."current_role"
      AND curator_bundle.status = 'published'
    WHERE curator_membership.organization_id = student_case.organization_id
      AND curator_membership.id = student_case.current_curator_membership_id
      AND curator_membership.status = 'active'
      AND curator_membership."current_role" = 'curator'
    LIMIT 1
  ) AS curator ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN slot.status = 'required' THEN 'upload_document'::TEXT
        ELSE 'replace_document'::TEXT
      END AS action_kind,
      COALESCE(slot.display_label, requirement.label) AS action_label,
      slot.deadline AS due_at,
      slot.id AS document_slot_id
    FROM platform.document_slots AS slot
    LEFT JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = slot.organization_id
      AND requirement.id = slot.requirement_id
    WHERE slot.organization_id = student_case.organization_id
      AND slot.student_case_id = student_case.id
      AND slot.removed_at IS NULL
      AND slot.status IN ('required', 'correction_required', 'rejected')
      AND private.platform_has_permission(
        slot.organization_id,
        'document.read.self'
      )
    ORDER BY slot.deadline NULLS LAST, slot.id
    LIMIT 1
  ) AS student_action ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      task.id AS case_task_id,
      task.title,
      task.status,
      task.due_at,
      task.due_on
    FROM platform.case_tasks AS task
    JOIN platform.organization_memberships AS assignee_membership
      ON assignee_membership.organization_id = task.organization_id
      AND assignee_membership.id = task.assignee_membership_id
      AND assignee_membership.status = 'active'
      AND assignee_membership."current_role" IN ('admin', 'sales', 'curator')
    JOIN platform.profiles AS assignee_profile
      ON assignee_profile.id = assignee_membership.profile_id
      AND assignee_profile.status = 'active'
    JOIN platform.role_bundle_versions AS assignee_bundle
      ON assignee_bundle.id = assignee_membership.current_bundle_id
      AND assignee_bundle.role = assignee_membership."current_role"
      AND assignee_bundle.status = 'published'
    WHERE task.organization_id = student_case.organization_id
      AND task.student_case_id = student_case.id
      AND task.student_visible
      AND task.status IN ('open', 'in_progress', 'blocked')
    ORDER BY
      CASE
        WHEN task.due_at IS NOT NULL THEN task.due_at
        WHEN task.due_on IS NOT NULL THEN
          task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
        ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
      END,
      task.id
    LIMIT 1
  ) AS evo_action ON TRUE
  WHERE student_case.state IN ('active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL
    AND private.platform_can_read_student_portal_case(
      student_case.organization_id,
      student_case.id
    )
    AND private.platform_has_permission(
      student_case.organization_id,
      'portal.read.self'
    )
    AND private.platform_has_scope(
      student_case.organization_id,
      'organization'::platform.scope_kind,
      student_case.organization_id
    )
    AND private.platform_has_scope(
      student_case.organization_id,
      'student_case'::platform.scope_kind,
      student_case.id
    )
  ORDER BY student_case.created_at, student_case.id
$$;

REVOKE ALL ON FUNCTION platform.student_portal_overview_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_overview_v1()
  TO authenticated;

COMMENT ON FUNCTION platform.student_portal_overview_v1() IS
  'Student-self V3 overview with explicit document-backed Student action and live staff-assigned EVO action.';

COMMIT;
