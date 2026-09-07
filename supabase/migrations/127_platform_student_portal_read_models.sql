-- ============================================================
-- 127_platform_student_portal_read_models.sql
--
-- Stage E2: additive, Student-self projections for the V3 Portal.
-- Existing student_portal_* signatures, document/notification projections,
-- RLS and the private Storage pipeline remain unchanged.
-- ============================================================

BEGIN;

CREATE FUNCTION platform.student_portal_overview_v1()
RETURNS TABLE (
  operational_stage TEXT,
  next_action TEXT,
  next_action_due_at TIMESTAMPTZ,
  next_action_due_on DATE,
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
    COALESCE(next_task.title, student_case.next_action),
    next_task.due_at,
    next_task.due_on,
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
    SELECT task.title, task.due_at, task.due_on
    FROM platform.case_tasks AS task
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
  ) AS next_task ON TRUE
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

CREATE FUNCTION platform.student_portal_applications_v2()
RETURNS TABLE (
  application_id UUID,
  institution_name TEXT,
  program_name TEXT,
  application_status platform.application_status,
  is_primary BOOLEAN,
  university_deadline_on DATE
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
    application.id,
    application.institution_name,
    application.program_name,
    application.status,
    application.is_primary,
    application.university_deadline_on
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  JOIN platform.university_applications AS application
    ON application.organization_id = student_case.organization_id
    AND application.student_case_id = student_case.id
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
  ORDER BY
    application.is_primary DESC,
    application.university_deadline_on NULLS LAST,
    application.id
$$;

CREATE FUNCTION platform.student_portal_application_timeline_v1(
  p_application_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (
  previous_status platform.application_status,
  new_status platform.application_status,
  occurred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_application_id IS NULL THEN
    RAISE EXCEPTION 'application_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Application timeline limit from 1 to 100 is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
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
    event.previous_status,
    event.new_status,
    event.created_at
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  JOIN platform.university_applications AS application
    ON application.organization_id = student_case.organization_id
    AND application.student_case_id = student_case.id
    AND application.id = p_application_id
  JOIN platform.university_application_events AS event
    ON event.organization_id = application.organization_id
    AND event.application_id = application.id
    AND event.student_case_id = application.student_case_id
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
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.student_portal_visa_cases_v2()
RETURNS TABLE (
  visa_case_id UUID,
  visa_status platform.visa_status
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
  SELECT visa.id, visa.status
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  JOIN platform.visa_cases AS visa
    ON visa.organization_id = student_case.organization_id
    AND visa.student_case_id = student_case.id
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
  ORDER BY visa.id
$$;

CREATE FUNCTION platform.student_portal_visa_timeline_v1(
  p_visa_case_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (
  previous_status platform.visa_status,
  new_status platform.visa_status,
  occurred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_visa_case_id IS NULL THEN
    RAISE EXCEPTION 'visa_case_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Visa timeline limit from 1 to 100 is required'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
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
  SELECT event.previous_status, event.new_status, event.created_at
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  JOIN platform.visa_cases AS visa
    ON visa.organization_id = student_case.organization_id
    AND visa.student_case_id = student_case.id
    AND visa.id = p_visa_case_id
  JOIN platform.visa_case_events AS event
    ON event.organization_id = visa.organization_id
    AND event.visa_case_id = visa.id
    AND event.student_case_id = visa.student_case_id
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
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT p_limit;
END
$$;

CREATE FUNCTION platform.student_portal_finance_v2()
RETURNS TABLE (
  obligation_label TEXT,
  category platform.obligation_category,
  amount_minor BIGINT,
  paid_minor BIGINT,
  refunded_minor BIGINT,
  outstanding_minor BIGINT,
  currency TEXT,
  due_at TIMESTAMPTZ,
  derived_status platform.obligation_status,
  overdue BOOLEAN,
  next_action TEXT
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
      AND private.platform_has_permission(
        current_authority.organization_id,
        'finance.read.self'
      )
      AND private.platform_has_scope(
        current_authority.organization_id,
        'organization'::platform.scope_kind,
        current_authority.organization_id
      )
  )
  SELECT
    obligation.label,
    obligation.category,
    obligation.amount_minor,
    obligation.total_paid_minor,
    obligation.total_refunded_minor,
    obligation.amount_minor
      - obligation.total_paid_minor
      + obligation.total_refunded_minor,
    obligation.currency,
    obligation.due_at,
    platform_private.derive_obligation_status(
      obligation.amount_minor,
      obligation.total_paid_minor,
      obligation.total_refunded_minor,
      obligation.due_at,
      transaction_timestamp()
    ),
    (
      obligation.due_at < transaction_timestamp()
      AND obligation.amount_minor
        - obligation.total_paid_minor
        + obligation.total_refunded_minor > 0
    ),
    obligation.next_action
  FROM authority
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = authority.organization_id
    AND student_case.student_membership_id = authority.membership_id
  JOIN platform.payment_obligations AS obligation
    ON obligation.organization_id = student_case.organization_id
    AND obligation.student_case_id = student_case.id
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
    AND private.platform_has_permission(
      student_case.organization_id,
      'finance.read.self'
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
  ORDER BY obligation.due_at, obligation.id
$$;

REVOKE ALL ON FUNCTION platform.student_portal_overview_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_portal_applications_v2()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform.student_portal_application_timeline_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_portal_visa_cases_v2()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_portal_visa_timeline_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.student_portal_finance_v2()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION platform.student_portal_overview_v1()
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.student_portal_applications_v2()
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  platform.student_portal_application_timeline_v1(UUID, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.student_portal_visa_cases_v2()
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.student_portal_visa_timeline_v1(UUID, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION platform.student_portal_finance_v2()
  TO authenticated;

COMMENT ON FUNCTION platform.student_portal_overview_v1() IS
  'Student-self V3 Portal overview with one canonical task-backed next action.';
COMMENT ON FUNCTION platform.student_portal_applications_v2() IS
  'Student-self applications with canonical primary and university deadline facts.';
COMMENT ON FUNCTION
  platform.student_portal_application_timeline_v1(UUID, INTEGER) IS
  'Bounded Student-self application status timeline without evidence, notes or actor identity.';
COMMENT ON FUNCTION platform.student_portal_visa_cases_v2() IS
  'Student-self visa status projection for the V3 Portal.';
COMMENT ON FUNCTION platform.student_portal_visa_timeline_v1(UUID, INTEGER) IS
  'Bounded Student-self visa status timeline without evidence, notes or actor identity.';
COMMENT ON FUNCTION platform.student_portal_finance_v2() IS
  'Student-self finance projection with exact canonical minor-unit totals.';

COMMIT;
