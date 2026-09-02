-- ============================================================
-- 095_platform_admissions_storage_runtime.sql
--
-- P4 completes the authenticated Supabase read boundary for the Admissions
-- queues and groups private-document version history by its canonical slot.
-- It also exposes the missing case-bound finance-stop assertion while keeping
-- release an Admin-only operation. No second business or file authority is
-- introduced.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION platform_private.require_admissions_runtime_actor(
  p_permission_key TEXT
)
RETURNS TABLE (
  auth_user_id UUID,
  profile_id UUID,
  membership_id UUID,
  organization_id UUID,
  display_name TEXT,
  platform_role platform.business_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    authority.auth_user_id,
    authority.profile_id,
    authority.membership_id,
    authority.organization_id,
    authority.display_name,
    authority.platform_role
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role IN ('admin', 'curator')
    AND private.platform_has_permission(
      authority.organization_id,
      p_permission_key
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admissions runtime authority is required'
      USING ERRCODE = '42501';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION
  platform_private.require_admissions_runtime_actor(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.staff_case_task_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  case_task_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  task_type TEXT,
  title TEXT,
  status platform.case_task_status,
  priority platform.case_task_priority,
  due_at TIMESTAMPTZ,
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
    case_task.updated_at,
    case_task.organization_id,
    case_task.id,
    case_task.student_case_id,
    student_case.student_display_name,
    student_case.state,
    case_task.task_type,
    case_task.title,
    case_task.status,
    case_task.priority,
    case_task.due_at,
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
  ORDER BY case_task.updated_at DESC, case_task.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_visa_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  visa_case_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  status platform.visa_status,
  latest_evidence_reference TEXT,
  created_by_membership_id UUID,
  created_by_display_name TEXT,
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
    RAISE EXCEPTION 'Visa queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('visa.manage');

  RETURN QUERY
  SELECT
    visa_case.updated_at,
    visa_case.organization_id,
    visa_case.id,
    visa_case.student_case_id,
    student_case.student_display_name,
    student_case.state,
    visa_case.status,
    visa_case.latest_evidence_reference,
    visa_case.created_by_membership_id,
    creator_profile.display_name,
    visa_case.created_at,
    visa_case.updated_at
  FROM platform.visa_cases AS visa_case
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = visa_case.organization_id
    AND student_case.id = visa_case.student_case_id
  JOIN platform.organization_memberships AS creator_membership
    ON creator_membership.organization_id = visa_case.organization_id
    AND creator_membership.id = visa_case.created_by_membership_id
  JOIN platform.profiles AS creator_profile
    ON creator_profile.id = creator_membership.profile_id
  WHERE visa_case.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY visa_case.updated_at DESC, visa_case.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_document_queue(
  p_limit INTEGER
)
RETURNS TABLE (
  sort_at TIMESTAMPTZ,
  organization_id UUID,
  document_slot_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  case_state platform.student_case_state,
  document_requirement_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  current_version_id UUID,
  current_version_no TEXT,
  current_original_filename TEXT,
  current_declared_mime_type TEXT,
  current_byte_size TEXT,
  current_sha256_hex TEXT,
  current_integrity_status platform.document_integrity_status,
  current_malware_status platform.document_malware_status,
  current_review_decision platform.document_review_decision,
  current_review_reason TEXT,
  current_version_finalized_at TIMESTAMPTZ,
  download_ready BOOLEAN,
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
    RAISE EXCEPTION 'Document queue limit from 1 to 101 is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('document.read.full');

  RETURN QUERY
  SELECT
    slot.updated_at,
    slot.organization_id,
    slot.id,
    slot.student_case_id,
    student_case.student_display_name,
    student_case.state,
    requirement.id,
    requirement.requirement_key,
    requirement.label,
    slot.status,
    slot.deadline,
    slot.next_action,
    current_version.id,
    current_version.version_no::TEXT,
    current_version.original_filename,
    current_version.declared_mime_type,
    current_version.byte_size::TEXT,
    current_version.sha256_hex,
    current_version.integrity_status,
    current_version.malware_status,
    latest_review.decision,
    latest_review.reason,
    finalization.finalized_at,
    (
      finalization.id IS NOT NULL
      AND current_version.integrity_status = 'verified'
      AND current_version.malware_status = 'clean'
    ),
    slot.created_at,
    slot.updated_at
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = slot.organization_id
    AND student_case.id = slot.student_case_id
  LEFT JOIN platform.document_versions AS current_version
    ON current_version.organization_id = slot.organization_id
    AND current_version.id = slot.current_version_id
    AND current_version.student_case_id = slot.student_case_id
    AND current_version.document_slot_id = slot.id
  LEFT JOIN platform_private.document_upload_finalizations AS finalization
    ON finalization.organization_id = current_version.organization_id
    AND finalization.document_version_id = current_version.id
  LEFT JOIN LATERAL (
    SELECT
      review.decision,
      review.reason
    FROM platform.document_reviews AS review
    WHERE review.organization_id = current_version.organization_id
      AND review.document_version_id = current_version.id
    ORDER BY review.created_at DESC, review.id DESC
    LIMIT 1
  ) AS latest_review ON TRUE
  WHERE slot.organization_id = actor.organization_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
  ORDER BY slot.updated_at DESC, slot.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_student_case_document_workspace(
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
  target_case platform.student_cases%ROWTYPE;
  slots_payload JSONB;
BEGIN
  IF p_student_case_id IS NULL THEN
    RAISE EXCEPTION 'student_case_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform_private.require_admissions_runtime_actor('document.read.full');

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.handoff_at IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case documents are unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      slot_row.payload
      ORDER BY slot_row.sort_deadline NULLS LAST,
        slot_row.sort_label,
        slot_row.document_slot_id
    ),
    '[]'::JSONB
  )
  INTO slots_payload
  FROM (
    SELECT
      slot.id AS document_slot_id,
      slot.deadline AS sort_deadline,
      lower(requirement.label) AS sort_label,
      jsonb_build_object(
        'document_slot_id', slot.id,
        'document_requirement_id', requirement.id,
        'requirement_key', requirement.requirement_key,
        'requirement_label', requirement.label,
        'instructions', requirement.instructions,
        'checklist_version', requirement.checklist_version::TEXT,
        'slot_status', slot.status,
        'deadline', slot.deadline,
        'next_action', slot.next_action,
        'current_version_id', slot.current_version_id,
        'current_version_no', slot.current_version_no::TEXT,
        'created_at', slot.created_at,
        'updated_at', slot.updated_at,
        'versions', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'document_version_id', version.id,
                'version_no', version.version_no::TEXT,
                'original_filename', version.original_filename,
                'declared_mime_type', version.declared_mime_type,
                'byte_size', version.byte_size::TEXT,
                'sha256_hex', version.sha256_hex,
                'integrity_status', version.integrity_status,
                'malware_status', version.malware_status,
                'validation_updated_at', version.validation_updated_at,
                'submitted_by_membership_id',
                  version.submitted_by_membership_id,
                'submitted_by_display_name', submitter_profile.display_name,
                'storage_finalized', finalization.id IS NOT NULL,
                'finalized_at', finalization.finalized_at,
                'download_ready', (
                  finalization.id IS NOT NULL
                  AND version.integrity_status = 'verified'
                  AND version.malware_status = 'clean'
                ),
                'is_current', slot.current_version_id = version.id,
                'latest_review', CASE
                  WHEN latest_review.review_id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'decision', latest_review.decision,
                    'reason', latest_review.reason,
                    'reviewer_membership_id',
                      latest_review.reviewer_membership_id,
                    'reviewer_display_name',
                      latest_review.reviewer_display_name,
                    'reviewed_at', latest_review.reviewed_at
                  )
                END,
                'created_at', version.created_at,
                'updated_at', version.updated_at
              )
              ORDER BY version.version_no DESC, version.id
            ),
            '[]'::JSONB
          )
          FROM platform.document_versions AS version
          JOIN platform.organization_memberships AS submitter_membership
            ON submitter_membership.organization_id = version.organization_id
            AND submitter_membership.id = version.submitted_by_membership_id
          JOIN platform.profiles AS submitter_profile
            ON submitter_profile.id = submitter_membership.profile_id
          LEFT JOIN platform_private.document_upload_finalizations AS finalization
            ON finalization.organization_id = version.organization_id
            AND finalization.document_version_id = version.id
          LEFT JOIN LATERAL (
            SELECT
              review.id AS review_id,
              review.decision,
              review.reason,
              review.reviewer_membership_id,
              reviewer_profile.display_name AS reviewer_display_name,
              review.created_at AS reviewed_at
            FROM platform.document_reviews AS review
            JOIN platform.organization_memberships AS reviewer_membership
              ON reviewer_membership.organization_id = review.organization_id
              AND reviewer_membership.id = review.reviewer_membership_id
            JOIN platform.profiles AS reviewer_profile
              ON reviewer_profile.id = reviewer_membership.profile_id
            WHERE review.organization_id = version.organization_id
              AND review.document_version_id = version.id
            ORDER BY review.created_at DESC, review.id DESC
            LIMIT 1
          ) AS latest_review ON TRUE
          WHERE version.organization_id = slot.organization_id
            AND version.student_case_id = slot.student_case_id
            AND version.document_slot_id = slot.id
        )
      ) AS payload
    FROM platform.document_slots AS slot
    JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = slot.organization_id
      AND requirement.id = slot.requirement_id
    WHERE slot.organization_id = target_case.organization_id
      AND slot.student_case_id = target_case.id
  ) AS slot_row;

  RETURN jsonb_build_object(
    'organization_id', target_case.organization_id,
    'student_case_id', target_case.id,
    'case_state', target_case.state,
    'slots', slots_payload
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.assert_case_finance_stop_factor(
  p_student_case_id UUID,
  p_payment_obligation_id UUID,
  p_reason TEXT,
  p_blocked_action TEXT,
  p_next_action TEXT,
  p_evidence_ref TEXT,
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
  readable_case platform.student_cases%ROWTYPE;
  target_case platform.student_cases%ROWTYPE;
  replayed JSONB;
  created_stop_factor_id UUID := gen_random_uuid();
  result JSONB;
BEGIN
  IF p_request_id IS NULL
    OR p_student_case_id IS NULL
    OR p_payment_obligation_id IS NULL
    OR p_reason IS NULL
    OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_blocked_action IS NULL
    OR char_length(btrim(p_blocked_action)) NOT BETWEEN 1 AND 200
    OR p_blocked_action ~ '[[:cntrl:]]'
    OR p_next_action IS NULL
    OR char_length(btrim(p_next_action)) NOT BETWEEN 1 AND 1000
    OR p_next_action ~ '[[:cntrl:]]'
    OR p_evidence_ref IS NULL
    OR char_length(btrim(p_evidence_ref)) NOT BETWEEN 1 AND 1000
    OR p_evidence_ref ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'Complete finance stop fields and evidence are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM platform_private.lock_p2e_request(p_request_id);

  SELECT * INTO actor
  FROM platform.current_actor_authority();

  -- Assertion is an owner-approved fixed-role capability. It deliberately
  -- does not use finance.stop.manage because that legacy permission also
  -- authorizes release; release remains an explicit Admin-only boundary.
  IF NOT FOUND
    OR actor.platform_role NOT IN ('admin', 'curator')
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'case.read.full'
    )
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'finance.read.summary'
    )
  THEN
    RAISE EXCEPTION 'Finance stop assertion authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT student_case.* INTO readable_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student case finance control is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'finance.stop.create',
    'stop_factor',
    NULL,
    btrim(p_reason),
    jsonb_build_object(
      'organization_id', actor.organization_id,
      'student_case_id', p_student_case_id,
      'payment_obligation_id', p_payment_obligation_id,
      'reason', btrim(p_reason),
      'blocked_action', btrim(p_blocked_action),
      'next_action', btrim(p_next_action),
      'created_evidence_ref', btrim(p_evidence_ref),
      'status', 'active'
    )
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  SELECT student_case.* INTO target_case
  FROM platform.student_cases AS student_case
  WHERE student_case.organization_id = actor.organization_id
    AND student_case.id = p_student_case_id
    AND student_case.state = 'active'
    AND student_case.handoff_at IS NOT NULL
    AND student_case.current_curator_membership_id IS NOT NULL
    AND (
      actor.platform_role = 'admin'
      OR student_case.current_curator_membership_id = actor.membership_id
    )
    AND private.platform_can_read_student_case(
      student_case.organization_id,
      student_case.id
    )
    AND EXISTS (
      SELECT 1
      FROM platform.organization_memberships AS owner_membership
      JOIN platform.profiles AS owner_profile
        ON owner_profile.id = owner_membership.profile_id
      JOIN platform.role_bundle_versions AS owner_bundle
        ON owner_bundle.id = owner_membership.current_bundle_id
        AND owner_bundle.role = owner_membership."current_role"
      WHERE owner_membership.organization_id = student_case.organization_id
        AND owner_membership.id = student_case.current_curator_membership_id
        AND owner_membership.status = 'active'
        AND owner_membership."current_role" = 'curator'
        AND owner_profile.status = 'active'
        AND owner_bundle.status = 'published'
    )
  FOR UPDATE OF student_case;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active handed-off student case is required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM platform.payment_obligations AS obligation
  WHERE obligation.organization_id = target_case.organization_id
    AND obligation.id = p_payment_obligation_id
    AND obligation.student_case_id = target_case.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO platform.stop_factors (
    id,
    organization_id,
    student_case_id,
    payment_obligation_id,
    status,
    reason,
    owner_membership_id,
    blocked_action,
    next_action,
    created_evidence_ref,
    created_by_membership_id
  )
  VALUES (
    created_stop_factor_id,
    target_case.organization_id,
    target_case.id,
    p_payment_obligation_id,
    'active',
    btrim(p_reason),
    target_case.current_curator_membership_id,
    btrim(p_blocked_action),
    btrim(p_next_action),
    btrim(p_evidence_ref),
    actor.membership_id
  );

  INSERT INTO platform.stop_factor_events (
    organization_id,
    student_case_id,
    payment_obligation_id,
    stop_factor_id,
    previous_status,
    new_status,
    resolution_kind,
    resolution_payment_event_id,
    evidence_ref,
    reason,
    actor_membership_id,
    request_id
  )
  VALUES (
    target_case.organization_id,
    target_case.id,
    p_payment_obligation_id,
    created_stop_factor_id,
    NULL,
    'active',
    NULL,
    NULL,
    btrim(p_evidence_ref),
    btrim(p_reason),
    actor.membership_id,
    p_request_id
  );

  result := jsonb_build_object(
    'organization_id', target_case.organization_id,
    'stop_factor_id', created_stop_factor_id,
    'student_case_id', target_case.id,
    'payment_obligation_id', p_payment_obligation_id,
    'owner_membership_id', target_case.current_curator_membership_id,
    'reason', btrim(p_reason),
    'blocked_action', btrim(p_blocked_action),
    'next_action', btrim(p_next_action),
    'created_evidence_ref', btrim(p_evidence_ref),
    'status', 'active'
  );

  INSERT INTO platform.audit_events (
    organization_id,
    actor_kind,
    actor_profile_id,
    actor_principal,
    action,
    resource_type,
    resource_id,
    before_state,
    after_state,
    reason,
    request_id
  )
  VALUES (
    target_case.organization_id,
    'user',
    actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    'finance.stop.create',
    'stop_factor',
    created_stop_factor_id,
    NULL,
    result,
    btrim(p_reason),
    p_request_id
  );

  RETURN result;
END
$$;

-- The case-bound release surface is the only active staff release RPC. Make
-- its Admin-only rule explicit instead of relying on today's permission bundle
-- composition.
CREATE OR REPLACE FUNCTION platform.resolve_case_stop_factor(
  p_organization_id UUID,
  p_student_case_id UUID,
  p_stop_factor_id UUID,
  p_resolution_kind platform.stop_factor_resolution_kind,
  p_payment_event_id UUID,
  p_reason TEXT,
  p_evidence_ref TEXT,
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
BEGIN
  SELECT * INTO actor
  FROM platform.current_actor_authority();

  IF NOT FOUND
    OR actor.organization_id <> p_organization_id
    OR actor.platform_role <> 'admin'
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'finance.stop.manage'
    )
  THEN
    RAISE EXCEPTION 'Admin finance stop release authority is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_student_case_id IS NULL
    OR p_stop_factor_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM platform.stop_factors AS stop_factor
      WHERE stop_factor.organization_id = p_organization_id
        AND stop_factor.student_case_id = p_student_case_id
        AND stop_factor.id = p_stop_factor_id
    )
  THEN
    RAISE EXCEPTION 'Case-bound stop factor is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN platform.resolve_stop_factor(
    p_organization_id,
    p_stop_factor_id,
    p_resolution_kind,
    p_payment_event_id,
    p_reason,
    p_evidence_ref,
    p_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform.staff_case_task_queue(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_case_task_queue(INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_visa_queue(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_visa_queue(INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.staff_document_queue(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.staff_document_queue(INTEGER)
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.staff_student_case_document_workspace(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.staff_student_case_document_workspace(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION platform.assert_case_finance_stop_factor(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.assert_case_finance_stop_factor(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
)
  TO authenticated;

COMMENT ON FUNCTION platform.staff_case_task_queue(INTEGER) IS
  'P4 deterministic tenant-scoped task queue for Admin and assigned Admissions staff on handed-off cases.';
COMMENT ON FUNCTION platform.staff_visa_queue(INTEGER) IS
  'P4 deterministic tenant-scoped visa queue for Admin and assigned Admissions staff on handed-off cases.';
COMMENT ON FUNCTION platform.staff_document_queue(INTEGER) IS
  'P4 deterministic tenant-scoped private-document slot queue with current finalized Storage metadata and no object path.';
COMMENT ON FUNCTION platform.staff_student_case_document_workspace(UUID) IS
  'P4 exact-case private-document workspace grouped by slot with immutable version, checksum, review and Storage-finalization truth.';
COMMENT ON FUNCTION platform.assert_case_finance_stop_factor(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  UUID
) IS
  'P4 idempotent case-bound finance-stop assertion for Admin or the assigned Admissions owner of one active handed-off case.';
COMMENT ON FUNCTION platform.resolve_case_stop_factor(
  UUID,
  UUID,
  UUID,
  platform.stop_factor_resolution_kind,
  UUID,
  TEXT,
  TEXT,
  UUID
) IS
  'P4 Admin-only exact-case wrapper around the canonical audited finance-stop resolution path.';

COMMIT;
