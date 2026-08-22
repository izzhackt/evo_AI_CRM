BEGIN;

-- Connected Platform queues must never depend on PostgREST's response-row cap.
-- These indexes match the stable keyset cursors exposed by the read models below.
CREATE INDEX student_cases_updated_page_idx
  ON platform.student_cases (organization_id, updated_at DESC, id DESC);

CREATE INDEX university_applications_updated_page_idx
  ON platform.university_applications (
    organization_id,
    updated_at DESC,
    id DESC
  );

CREATE INDEX communication_conversations_updated_page_idx
  ON platform.communication_conversations (
    organization_id,
    updated_at DESC,
    id DESC
  );

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
        AND task.due_at < statement_timestamp()
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

CREATE OR REPLACE FUNCTION platform.staff_student_case_read_snapshot(
  p_student_case_id UUID
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
  rejected_document_count BIGINT,
  student_case_op_handoff_id UUID,
  op_workflow_contract_version_id UUID,
  approved_commercial_fields JSONB,
  unresolved_questions JSONB,
  promises JSONB,
  handoff_next_step TEXT,
  handoff_due_at TIMESTAMPTZ,
  handoff_responsible_role platform.business_role,
  handoff_created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    page.*,
    CASE WHEN page.access_mode = 'full' THEN handoff.id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.op_workflow_contract_version_id END,
    CASE WHEN page.access_mode = 'full'
      THEN handoff.approved_commercial_fields END,
    CASE WHEN page.access_mode = 'full' THEN handoff.unresolved_questions END,
    CASE WHEN page.access_mode = 'full' THEN handoff.promises END,
    CASE WHEN page.access_mode = 'full' THEN handoff.next_step END,
    CASE WHEN page.access_mode = 'full' THEN handoff.due_at END,
    CASE WHEN page.access_mode = 'full' THEN handoff.responsible_role END,
    CASE WHEN page.access_mode = 'full' THEN handoff.created_at END
  FROM platform.staff_student_case_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_student_case_id
  ) AS page
  LEFT JOIN platform.student_case_op_handoffs AS handoff
    ON page.access_mode = 'full'
   AND handoff.organization_id = page.organization_id
   AND handoff.student_case_id = page.student_case_id
$$;

CREATE OR REPLACE FUNCTION platform.staff_application_page(
  p_limit INTEGER,
  p_before_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_before_application_id UUID DEFAULT NULL,
  p_status platform.application_status DEFAULT NULL,
  p_student_case_id UUID DEFAULT NULL,
  p_application_id UUID DEFAULT NULL
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
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

  IF (p_before_updated_at IS NULL) <> (p_before_application_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete application cursor' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS MATERIALIZED (
    SELECT application.*
    FROM platform.current_actor_authority() AS authority
    JOIN platform.university_applications AS application
      ON application.organization_id = authority.organization_id
    WHERE private.platform_can_read_student_case(
      application.organization_id,
      application.student_case_id
    )
      AND (p_status IS NULL OR application.status = p_status)
      AND (
        p_student_case_id IS NULL
        OR application.student_case_id = p_student_case_id
      )
      AND (p_application_id IS NULL OR application.id = p_application_id)
      AND (
        p_before_updated_at IS NULL
        OR (application.updated_at, application.id)
          < (p_before_updated_at, p_before_application_id)
      )
    ORDER BY application.updated_at DESC, application.id DESC
    LIMIT p_limit
  )
  SELECT
    application.organization_id,
    application.id,
    application.student_case_id,
    student_case.student_display_name,
    student_case.target_country,
    student_case.target_degree,
    student_case.program_direction,
    student_case.intake,
    application.institution_name,
    application.program_name,
    application.status,
    application.latest_evidence_reference,
    application.created_at,
    application.updated_at,
    sales_profile.display_name,
    curator_profile.display_name,
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.document_slots AS slot
      WHERE slot.organization_id = application.organization_id
        AND slot.student_case_id = application.student_case_id
        AND slot.status <> 'approved'
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.case_tasks AS task
      WHERE task.organization_id = application.organization_id
        AND task.student_case_id = application.student_case_id
        AND task.status NOT IN ('done', 'cancelled')
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
    ),
    (
      SELECT count(*) FROM platform.payment_obligations AS obligation
      WHERE obligation.organization_id = application.organization_id
        AND obligation.student_case_id = application.student_case_id
        AND obligation.total_paid_minor - obligation.total_refunded_minor
          < obligation.amount_minor
    )
  FROM page AS application
  JOIN platform.student_cases AS student_case
    ON student_case.organization_id = application.organization_id
   AND student_case.id = application.student_case_id
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
  ORDER BY application.updated_at DESC, application.id DESC;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_application_snapshot(
  p_university_application_id UUID
)
RETURNS TABLE (
  organization_id UUID,
  university_application_id UUID,
  student_case_id UUID,
  student_display_name TEXT,
  target_country TEXT,
  target_degree TEXT,
  program_direction TEXT,
  intake TEXT,
  institution_name TEXT,
  program_name TEXT,
  status platform.application_status,
  latest_evidence_reference TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  responsible_sales_display_name TEXT,
  current_curator_display_name TEXT,
  document_count BIGINT,
  open_document_count BIGINT,
  task_count BIGINT,
  open_task_count BIGINT,
  payment_obligation_count BIGINT,
  outstanding_payment_obligation_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT page.*
  FROM platform.staff_application_page(
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_university_application_id
  ) AS page
$$;

CREATE OR REPLACE FUNCTION platform.staff_communication_page(
  p_organization_id UUID,
  p_limit INTEGER,
  p_before_sort_at TIMESTAMPTZ DEFAULT NULL,
  p_before_conversation_id UUID DEFAULT NULL,
  p_queue platform.communication_queue DEFAULT NULL,
  p_status platform.communication_status DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ
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

  IF (p_before_sort_at IS NULL) <> (p_before_conversation_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete conversation cursor' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  RETURN QUERY
  SELECT
    conversation.id,
    conversation.student_case_id,
    conversation.queue,
    conversation.status,
    conversation.subject,
    conversation.waha_session_name,
    conversation.kommo_account_id,
    conversation.kommo_conversation_id,
    conversation.amocrm_account_id,
    conversation.amocrm_lead_id,
    conversation.amocrm_contact_id,
    conversation.created_at,
    GREATEST(
      conversation.updated_at,
      COALESCE(latest_message.created_at, conversation.updated_at)
    ) AS sort_at
  FROM platform.communication_conversations AS conversation
  LEFT JOIN LATERAL (
    SELECT message.created_at
    FROM platform.communication_messages AS message
    WHERE message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON TRUE
  WHERE conversation.organization_id = p_organization_id
    AND private.platform_can_read_communication_full(
      conversation.organization_id,
      conversation.id
    )
    AND (p_queue IS NULL OR conversation.queue = p_queue)
    AND (p_status IS NULL OR conversation.status = p_status)
    AND (
      p_conversation_id IS NULL
      OR conversation.id = p_conversation_id
    )
    AND (
      p_before_sort_at IS NULL
      OR (
        GREATEST(
          conversation.updated_at,
          COALESCE(latest_message.created_at, conversation.updated_at)
        ),
        conversation.id
      ) < (p_before_sort_at, p_before_conversation_id)
    )
  ORDER BY GREATEST(
    conversation.updated_at,
    COALESCE(latest_message.created_at, conversation.updated_at)
  ) DESC, conversation.id DESC
  LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION platform.staff_communication_snapshot(
  p_organization_id UUID,
  p_conversation_id UUID
)
RETURNS TABLE (
  conversation_id UUID,
  student_case_id UUID,
  queue platform.communication_queue,
  status platform.communication_status,
  subject TEXT,
  waha_session_name TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  sort_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT page.*
  FROM platform.staff_communication_page(
    p_organization_id,
    1,
    NULL,
    NULL,
    NULL,
    NULL,
    p_conversation_id
  ) AS page
$$;

CREATE OR REPLACE FUNCTION platform.staff_conversation_message_page(
  p_organization_id UUID,
  p_conversation_id UUID,
  p_limit INTEGER,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_message_id UUID DEFAULT NULL
)
RETURNS TABLE (
  message_id UUID,
  conversation_id UUID,
  direction platform.communication_direction,
  body_text TEXT,
  language platform.communication_message_language,
  student_visible BOOLEAN,
  waha_session_name TEXT,
  waha_message_id TEXT,
  kommo_account_id BIGINT,
  kommo_conversation_id TEXT,
  kommo_message_id TEXT,
  amocrm_account_id BIGINT,
  amocrm_lead_id BIGINT,
  amocrm_contact_id BIGINT,
  created_at TIMESTAMPTZ,
  media JSONB,
  waha_ack_name TEXT,
  waha_ack_observed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 201 THEN
    RAISE EXCEPTION 'Invalid page limit' USING ERRCODE = '22023';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_message_id IS NULL) THEN
    RAISE EXCEPTION 'Incomplete message cursor' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.require_domain_actor_read(
    p_organization_id,
    'communication.read.full'
  );

  IF NOT COALESCE(
    private.platform_can_read_communication_full(
      p_organization_id,
      p_conversation_id
    ),
    FALSE
  ) THEN
    RAISE EXCEPTION
      'Communication conversation is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    message.id,
    message.conversation_id,
    message.direction,
    message.body_text,
    message.language,
    message.student_visible,
    message.waha_session_name,
    message.waha_message_id,
    message.kommo_account_id,
    message.kommo_conversation_id,
    message.kommo_message_id,
    message.amocrm_account_id,
    message.amocrm_lead_id,
    message.amocrm_contact_id,
    message.created_at,
    COALESCE(media_rows.media, '[]'::JSONB),
    ack_current.waha_ack_name,
    ack_current.waha_ack_observed_at
  FROM platform.communication_messages AS message
  LEFT JOIN platform.waha_message_ack_current AS ack_current
    ON ack_current.organization_id = message.organization_id
   AND ack_current.communication_message_id = message.id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bounded_media.id,
        'ordinal', bounded_media.ordinal,
        'media_kind', bounded_media.media_kind,
        'mime_type', bounded_media.mime_type,
        'file_name', bounded_media.file_name,
        'file_size_bytes', bounded_media.file_size_bytes,
        'archival_status', bounded_media.archival_status,
        'created_at', bounded_media.created_at,
        'archived_at', bounded_media.archived_at
      )
      ORDER BY bounded_media.ordinal, bounded_media.id
    ) AS media
    FROM (
      SELECT media_row.*
      FROM platform.communication_message_media AS media_row
      WHERE media_row.organization_id = message.organization_id
        AND media_row.communication_message_id = message.id
      ORDER BY media_row.ordinal, media_row.id
      LIMIT 16
    ) AS bounded_media
  ) AS media_rows ON TRUE
  WHERE message.organization_id = p_organization_id
    AND message.conversation_id = p_conversation_id
    AND (
      p_before_created_at IS NULL
      OR (message.created_at, message.id)
        < (p_before_created_at, p_before_message_id)
    )
  ORDER BY message.created_at DESC, message.id DESC
  LIMIT p_limit;
END
$$;

-- The connected product now has one canonical bounded read contract per
-- surface. These unbounded compatibility RPCs are intentionally removed only
-- after their bounded page/snapshot replacements have been created.
DROP FUNCTION platform.staff_student_case_queue();
DROP FUNCTION platform.staff_student_case_snapshot(UUID);
DROP FUNCTION platform.staff_application_queue();
DROP FUNCTION platform.staff_communication_queue(UUID);
DROP FUNCTION platform.staff_conversation_messages(UUID, UUID);
DROP FUNCTION platform.sales_handoff_summaries();

REVOKE ALL ON FUNCTION
  platform.staff_student_case_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.student_case_state,
    TEXT,
    UUID
  ),
  platform.staff_student_case_read_snapshot(UUID),
  platform.staff_application_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.application_status,
    UUID,
    UUID
  ),
  platform.staff_communication_page(
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.communication_queue,
    platform.communication_status,
    UUID
  ),
  platform.staff_communication_snapshot(UUID, UUID),
  platform.staff_conversation_message_page(
    UUID,
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID
  )
FROM PUBLIC, anon, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION
  platform.staff_student_case_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.student_case_state,
    TEXT,
    UUID
  ),
  platform.staff_student_case_read_snapshot(UUID),
  platform.staff_application_page(
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.application_status,
    UUID,
    UUID
  ),
  platform.staff_communication_page(
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID,
    platform.communication_queue,
    platform.communication_status,
    UUID
  ),
  platform.staff_communication_snapshot(UUID, UUID),
  platform.staff_conversation_message_page(
    UUID,
    UUID,
    INTEGER,
    TIMESTAMPTZ,
    UUID
  )
TO authenticated;

COMMENT ON FUNCTION platform.staff_student_case_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  platform.student_case_state,
  TEXT,
  UUID
) IS
  'Bounded role-scoped student-case read model with server-side filters and a stable (sort_at,id) keyset cursor.';

COMMENT ON FUNCTION platform.staff_student_case_read_snapshot(UUID) IS
  'One canonical role-scoped student-case detail projection for full and post-handoff summary access.';

COMMENT ON FUNCTION platform.staff_application_page(
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  platform.application_status,
  UUID,
  UUID
) IS
  'Bounded role-scoped application read model with filters applied before stable (updated_at,id) keyset pagination.';

COMMENT ON FUNCTION platform.staff_communication_page(
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID,
  platform.communication_queue,
  platform.communication_status,
  UUID
) IS
  'Bounded communication queue preserving latest-observation ordering with server-side queue/status filters and a stable keyset cursor.';

COMMENT ON FUNCTION platform.staff_communication_snapshot(UUID, UUID) IS
  'One authorized communication summary by exact conversation id; never scans or downloads the full queue.';

COMMENT ON FUNCTION platform.staff_conversation_message_page(
  UUID,
  UUID,
  INTEGER,
  TIMESTAMPTZ,
  UUID
) IS
  'Bounded newest-first message page with a stable (created_at,id) cursor and safe media metadata only.';

COMMIT;
