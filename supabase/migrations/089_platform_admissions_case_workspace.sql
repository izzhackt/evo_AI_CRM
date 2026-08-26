BEGIN;

CREATE OR REPLACE FUNCTION platform_private.u7_require_case_workspace_actor(
  p_student_case_id UUID
)
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  organization_id UUID,
  student_case_id UUID,
  display_name TEXT,
  platform_role platform.business_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION
      'student_case_id is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    authority.auth_user_id,
    authority.profile_id,
    authority.membership_id,
    authority.organization_id,
    student_case.id,
    authority.display_name,
    authority.platform_role
  FROM platform.current_actor_authority() AS authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.id = p_student_case_id
  WHERE private.platform_has_permission(
      authority.organization_id,
      'case.read.full'
    )
    AND (
      (
        authority.platform_role = 'admin'
        AND private.platform_has_scope(
          authority.organization_id,
          'organization',
          authority.organization_id
        )
      )
      OR (
        authority.platform_role = 'curator'
        AND student_case.current_curator_membership_id = authority.membership_id
        AND private.platform_has_scope(
          authority.organization_id,
          'student_case',
          student_case.id
        )
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Exact live Admin or assigned Curator authority is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.u7_workspace_assignees(
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(assignee.payload ORDER BY assignee.sort_label, assignee.membership_id),
    '[]'::JSONB
  )
  FROM (
    SELECT
      lower(profile.display_name) AS sort_label,
      membership.id AS membership_id,
      jsonb_build_object(
        'membership_id', membership.id,
        'display_name', profile.display_name,
        'role', membership."current_role"
      ) AS payload
    FROM platform.organization_memberships AS membership
    JOIN platform.profiles AS profile
      ON profile.id = membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = membership.organization_id
    JOIN platform.role_bundle_versions AS bundle
      ON bundle.id = membership.current_bundle_id
      AND bundle.role = membership."current_role"
    WHERE membership.organization_id = p_organization_id
      AND membership.status = 'active'
      AND membership."current_role" IN ('admin', 'sales', 'curator')
      AND profile.status = 'active'
      AND organization.status = 'active'
      AND bundle.status = 'published'
    ORDER BY lower(profile.display_name), membership.id
    LIMIT 100
  ) AS assignee
$$;

CREATE OR REPLACE FUNCTION platform_private.u7_audit_reason_code(
  p_action TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_action
    WHEN 'case.create' THEN 'case_created'
    WHEN 'case.curator.set' THEN 'case_curator_changed'
    WHEN 'case.lifecycle.change' THEN 'case_state_changed'
    WHEN 'case.route.change' THEN 'case_route_changed'
    WHEN 'case.update.append' THEN 'case_update_recorded'
    WHEN 'task.create' THEN 'task_created'
    WHEN 'task.change' THEN 'task_changed'
    WHEN 'application.create' THEN 'application_created'
    WHEN 'application.status.change' THEN 'application_status_changed'
    WHEN 'visa.create' THEN 'visa_created'
    WHEN 'visa.status.change' THEN 'visa_status_changed'
    WHEN 'document.version.record' THEN 'document_uploaded'
    WHEN 'document.version.review' THEN 'document_review_recorded'
    WHEN 'document.validation.attest' THEN 'document_validation_attested'
    WHEN 'lead.admissions.handoff.completed' THEN 'admissions_handoff_completed'
    ELSE 'case_activity_recorded'
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.u7_audit_allowed_keys(
  p_resource_type TEXT,
  p_action TEXT
)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_resource_type = 'student_case' AND p_action = 'lead.admissions.handoff.completed' THEN
      ARRAY[
        'student_case_id',
        'admissions_owner_membership_id',
        'handoff_mode',
        'handoff_state',
        'gate_state',
        'gate_version'
      ]::TEXT[]
    WHEN p_resource_type = 'student_case' THEN
      ARRAY[
        'state',
        'current_curator_membership_id',
        'target_country',
        'target_degree',
        'program_direction',
        'intake',
        'route_approval_status'
      ]::TEXT[]
    WHEN p_resource_type = 'case_task' THEN
      ARRAY[
        'student_case_id',
        'source_key',
        'title',
        'status',
        'assignee_membership_id',
        'priority',
        'due_at',
        'student_visible'
      ]::TEXT[]
    WHEN p_resource_type = 'university_application' THEN
      ARRAY[
        'student_case_id',
        'institution_name',
        'program_name',
        'status'
      ]::TEXT[]
    WHEN p_resource_type = 'visa_case' THEN
      ARRAY[
        'student_case_id',
        'status'
      ]::TEXT[]
    WHEN p_resource_type = 'document_slot' THEN
      ARRAY[
        'student_case_id',
        'status',
        'current_version_no',
        'next_action'
      ]::TEXT[]
    WHEN p_resource_type = 'document_version' THEN
      ARRAY[
        'student_case_id',
        'document_slot_id',
        'version_no',
        'integrity_status',
        'malware_status',
        'review_decision'
      ]::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.u7_changed_field_codes(
  p_before JSONB,
  p_after JSONB,
  p_allowed_keys TEXT[]
)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(to_jsonb(changed.key) ORDER BY changed.key)
      FROM (
        SELECT allowed.key
        FROM unnest(COALESCE(p_allowed_keys, ARRAY[]::TEXT[])) AS allowed(key)
        WHERE COALESCE(p_before -> allowed.key, 'null'::JSONB)
          IS DISTINCT FROM COALESCE(p_after -> allowed.key, 'null'::JSONB)
      ) AS changed
    ),
    '[]'::JSONB
  )
$$;

REVOKE ALL ON FUNCTION platform_private.u7_require_case_workspace_actor(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.u7_workspace_assignees(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.u7_audit_reason_code(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.u7_audit_allowed_keys(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform_private.u7_changed_field_codes(JSONB, JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

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
    jsonb_agg(task.payload ORDER BY task.sort_due_at, task.sort_status, task.created_at DESC, task.case_task_id),
    '[]'::JSONB
  )
  INTO tasks_payload
  FROM (
    SELECT
      case_task.id AS case_task_id,
      COALESCE(case_task.due_at, '9999-12-31 00:00:00+00'::TIMESTAMPTZ) AS sort_due_at,
      CASE WHEN case_task.status IN ('done', 'cancelled') THEN 1 ELSE 0 END AS sort_status,
      case_task.created_at,
      jsonb_build_object(
        'case_task_id', case_task.id,
        'task_type', case_task.task_type,
        'title', case_task.title,
        'status', case_task.status,
        'priority', case_task.priority,
        'due_at', case_task.due_at,
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

CREATE OR REPLACE FUNCTION platform.staff_student_case_activity(
  p_student_case_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  updates_payload JSONB;
  audit_payload JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION
      'Invalid activity limit'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  SELECT COALESCE(
    jsonb_agg(update_row.payload ORDER BY update_row.occurred_at DESC, update_row.case_update_id DESC),
    '[]'::JSONB
  )
  INTO updates_payload
  FROM (
    SELECT
      case_update.id AS case_update_id,
      case_update.occurred_at,
      jsonb_build_object(
        'case_update_id', case_update.id,
        'source', case_update.source,
        'body', case_update.body,
        'student_visible', case_update.student_visible,
        'occurred_at', case_update.occurred_at,
        'author_membership_id', author_membership.id,
        'author_display_name', author_profile.display_name,
        'created_at', case_update.created_at
      ) AS payload
    FROM platform.student_case_updates AS case_update
    JOIN platform.organization_memberships AS author_membership
      ON author_membership.organization_id = case_update.organization_id
      AND author_membership.id = case_update.author_membership_id
    JOIN platform.profiles AS author_profile
      ON author_profile.id = author_membership.profile_id
    WHERE case_update.organization_id = actor.organization_id
      AND case_update.student_case_id = actor.student_case_id
    ORDER BY case_update.occurred_at DESC, case_update.id DESC
    LIMIT p_limit
  ) AS update_row;

  SELECT COALESCE(
    jsonb_agg(audit_row.payload ORDER BY audit_row.created_at DESC, audit_row.audit_event_id DESC),
    '[]'::JSONB
  )
  INTO audit_payload
  FROM (
    SELECT
      event.id AS audit_event_id,
      event.created_at,
      jsonb_build_object(
        'audit_event_id', event.id,
        'created_at', event.created_at,
        'action', event.action,
        'resource_type', event.resource_type,
        'resource_id', event.resource_id,
        'actor_kind', event.actor_kind,
        'actor_display_name', CASE event.actor_kind
          WHEN 'user'::platform.audit_actor_kind THEN COALESCE(actor_profile.display_name, 'Staff')
          WHEN 'service'::platform.audit_actor_kind THEN 'Service'
          ELSE 'System'
        END,
        'request_id', event.request_id,
        'reason_code', platform_private.u7_audit_reason_code(event.action),
        'changed_field_codes', platform_private.u7_changed_field_codes(
          event.before_state,
          event.after_state,
          platform_private.u7_audit_allowed_keys(event.resource_type, event.action)
        ),
        'change_summary', platform_private.u7_audit_reason_code(event.action)
      ) AS payload
    FROM platform.audit_events AS event
    LEFT JOIN platform.profiles AS actor_profile
      ON actor_profile.id = event.actor_profile_id
    WHERE event.organization_id = actor.organization_id
      AND event.action = ANY (
        ARRAY[
          'case.create',
          'case.curator.set',
          'case.lifecycle.change',
          'case.route.change',
          'case.update.append',
          'task.create',
          'task.change',
          'application.create',
          'application.status.change',
          'visa.create',
          'visa.status.change',
          'document.version.record',
          'document.version.review',
          'document.validation.attest',
          'lead.admissions.handoff.completed'
        ]::TEXT[]
      )
      AND (
        (event.resource_type = 'student_case' AND event.resource_id = actor.student_case_id)
        OR (
          event.resource_type = 'student_case_update'
          AND EXISTS (
            SELECT 1
            FROM platform.student_case_updates AS case_update
            WHERE case_update.organization_id = actor.organization_id
              AND case_update.id = event.resource_id
              AND case_update.student_case_id = actor.student_case_id
          )
        )
        OR (
          event.resource_type = 'case_task'
          AND EXISTS (
            SELECT 1
            FROM platform.case_tasks AS case_task
            WHERE case_task.organization_id = actor.organization_id
              AND case_task.id = event.resource_id
              AND case_task.student_case_id = actor.student_case_id
          )
        )
        OR (
          event.resource_type = 'university_application'
          AND EXISTS (
            SELECT 1
            FROM platform.university_applications AS application
            WHERE application.organization_id = actor.organization_id
              AND application.id = event.resource_id
              AND application.student_case_id = actor.student_case_id
          )
        )
        OR (
          event.resource_type = 'visa_case'
          AND EXISTS (
            SELECT 1
            FROM platform.visa_cases AS visa_case
            WHERE visa_case.organization_id = actor.organization_id
              AND visa_case.id = event.resource_id
              AND visa_case.student_case_id = actor.student_case_id
          )
        )
        OR (
          event.resource_type = 'document_slot'
          AND EXISTS (
            SELECT 1
            FROM platform.document_slots AS document_slot
            WHERE document_slot.organization_id = actor.organization_id
              AND document_slot.id = event.resource_id
              AND document_slot.student_case_id = actor.student_case_id
          )
        )
        OR (
          event.resource_type = 'document_version'
          AND EXISTS (
            SELECT 1
            FROM platform.document_versions AS document_version
            WHERE document_version.organization_id = actor.organization_id
              AND document_version.id = event.resource_id
              AND document_version.student_case_id = actor.student_case_id
          )
        )
      )
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT p_limit
  ) AS audit_row;

  RETURN jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', actor.student_case_id,
    'updates', updates_payload,
    'audit', audit_payload
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_student_case_task_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_task_workspace(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_student_case_task_workspace(UUID) IS
  'U7 exact-case Admin and assigned-Curator task workspace projection with active same-org assignee options only.';
COMMENT ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER) IS
  'U7 exact-case Admin and assigned-Curator activity projection with bounded case updates and safe child-resource audit summaries.';

COMMIT;
