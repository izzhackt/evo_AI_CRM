BEGIN;

-- Replace the unused two-array U7 projection with one paged, allowlisted stream.
-- No before/after payload, document upload author/time or message body is exposed.
DROP FUNCTION platform.staff_student_case_activity(UUID, INTEGER);

CREATE FUNCTION private.staff_student_case_activity(
  p_student_case_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_before_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor RECORD;
  result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated staff required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
    OR (p_before_at IS NULL) <> (p_before_id IS NULL)
    OR (p_before_at IS NOT NULL AND NOT isfinite(p_before_at)) THEN
    RAISE EXCEPTION 'Invalid activity page' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor
    FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);

  WITH audited AS (
    SELECT event.id, event.created_at, event.action, target.kind, target.id AS target_id,
      CASE WHEN event.action = 'task.change' THEN
        platform_private.u7_changed_field_codes(event.before_state, event.after_state,
          ARRAY['status','priority','due_at','due_on','assignee_membership_id']::TEXT[])
        ELSE '[]'::JSONB END AS changed_fields
    FROM platform.audit_events AS event
    CROSS JOIN LATERAL (
      SELECT 'overview'::TEXT AS kind, p_student_case_id AS id
      WHERE event.resource_type = 'student_case' AND event.resource_id = p_student_case_id
        AND event.action = ANY(ARRAY['case.create','case.curator.set','case.lifecycle.change',
          'case.route.change','lead.admissions.handoff.completed',
          'case.handoff.acknowledge','case.handoff.clarification',
          'case.coverage.start','case.coverage.return']::TEXT[])
      UNION ALL
      SELECT 'task', task.id FROM platform.case_tasks AS task
      WHERE event.resource_type = 'case_task' AND event.resource_id = task.id
        AND task.organization_id = actor.organization_id AND task.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['task.create','task.change']::TEXT[])
      UNION ALL
      SELECT 'overview', application.id FROM platform.university_applications AS application
      WHERE event.resource_type = 'university_application' AND event.resource_id = application.id
        AND application.organization_id = actor.organization_id AND application.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['application.create','application.details.update','application.status.change']::TEXT[])
      UNION ALL
      SELECT 'overview', visa.id FROM platform.visa_cases AS visa
      WHERE event.resource_type = 'visa_case' AND event.resource_id = visa.id
        AND visa.organization_id = actor.organization_id AND visa.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['visa.create','visa.status.change']::TEXT[])
      UNION ALL
      SELECT 'documents', slot.id FROM platform.document_slots AS slot
      WHERE event.resource_type = 'document_slot' AND event.resource_id = slot.id
        AND slot.organization_id = actor.organization_id AND slot.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['document.slot.create','document.slot.custom.create','document.slot.metadata.change']::TEXT[])
      UNION ALL
      SELECT 'documents', version.document_slot_id FROM platform.document_versions AS version
      WHERE event.resource_type = 'document_version' AND event.resource_id = version.id
        AND version.organization_id = actor.organization_id AND version.student_case_id = p_student_case_id
        AND event.action = ANY(ARRAY['document.version.record','document.version.review','document.validation.attest']::TEXT[])
      UNION ALL
      SELECT 'money', obligation.id FROM platform.payment_obligations AS obligation
      WHERE event.resource_type = 'payment_obligation' AND event.resource_id = obligation.id
        AND obligation.organization_id = actor.organization_id AND obligation.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = 'finance.obligation.create'
      UNION ALL
      SELECT 'money', payment.id FROM platform.payment_events AS payment
      WHERE event.resource_type = 'payment_event' AND event.resource_id = payment.id
        AND payment.organization_id = actor.organization_id AND payment.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = 'finance.payment.record'
      UNION ALL
      SELECT 'money', stop.id FROM platform.stop_factors AS stop
      WHERE event.resource_type = 'stop_factor' AND event.resource_id = stop.id
        AND stop.organization_id = actor.organization_id AND stop.student_case_id = p_student_case_id
        AND private.platform_has_permission(actor.organization_id, 'finance.read.summary')
        AND event.action = ANY(ARRAY['finance.stop.create','finance.stop.resolve']::TEXT[])
      UNION ALL
      SELECT 'conversation', conversation.id FROM platform.communication_conversations AS conversation
      WHERE event.resource_type = 'communication_conversation' AND event.resource_id = conversation.id
        AND conversation.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
        AND private.platform_can_read_communication_full(actor.organization_id, conversation.id)
        AND event.action = ANY(ARRAY['communication.conversation.create','communication.conversation.link']::TEXT[])
      UNION ALL
      SELECT 'conversation', message.conversation_id FROM platform.communication_messages AS message
      JOIN platform.communication_conversations AS conversation
        ON conversation.organization_id = message.organization_id AND conversation.id = message.conversation_id
      WHERE event.resource_type = 'communication_message' AND event.resource_id = message.id
        AND message.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
        AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
        AND event.action = 'communication.message.record'
    ) AS target
    WHERE event.organization_id = actor.organization_id
      AND (p_before_at IS NULL OR (event.created_at, event.id) < (p_before_at, p_before_id))
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT p_limit + 1
  ), message_records AS (
    -- Provider workers can persist a verified message without the old record RPC.
    -- Use only canonical metadata and omit records already represented by audit.
    SELECT message.id, message.created_at, 'communication.message.record'::TEXT AS action,
      'conversation'::TEXT AS kind, message.conversation_id AS target_id, '[]'::JSONB AS changed_fields
    FROM platform.communication_messages AS message
    JOIN platform.communication_conversations AS conversation
      ON conversation.organization_id = message.organization_id AND conversation.id = message.conversation_id
    WHERE message.organization_id = actor.organization_id AND conversation.student_case_id = p_student_case_id
      AND private.platform_can_read_communication_full(actor.organization_id, message.conversation_id)
      AND (p_before_at IS NULL OR (message.created_at, message.id) < (p_before_at, p_before_id))
      AND NOT EXISTS (SELECT 1 FROM platform.audit_events AS event
        WHERE event.organization_id = actor.organization_id AND event.resource_type = 'communication_message'
          AND event.resource_id = message.id AND event.action = 'communication.message.record')
    ORDER BY message.created_at DESC, message.id DESC LIMIT p_limit + 1
  ), scoped AS (
    SELECT * FROM (SELECT * FROM audited UNION ALL SELECT * FROM message_records) AS combined
    ORDER BY created_at DESC, id DESC LIMIT p_limit + 1
  ), numbered AS (
    SELECT *, row_number() OVER (ORDER BY created_at DESC, id DESC) AS ordinal FROM scoped
  )
  SELECT jsonb_build_object(
    'organization_id', actor.organization_id,
    'student_case_id', p_student_case_id,
    'events', COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'action', action, 'target_kind', kind, 'target_id', target_id,
      'occurred_at', CASE WHEN kind = 'documents' THEN NULL ELSE created_at END,
      'changed_fields', changed_fields
    ) ORDER BY created_at DESC, id DESC) FILTER (WHERE ordinal <= p_limit), '[]'::JSONB),
    'next_cursor', CASE WHEN count(*) > p_limit THEN
      (SELECT jsonb_build_object('at', created_at, 'id', id) FROM numbered WHERE ordinal = p_limit)
      ELSE NULL END
  ) INTO result FROM numbered;
  RETURN result;
END
$$;

CREATE FUNCTION platform.staff_student_case_activity(
  p_student_case_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_before_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT private.staff_student_case_activity(p_student_case_id, p_limit, p_before_at, p_before_id)
$$;

REVOKE ALL ON FUNCTION private.staff_student_case_activity(UUID, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.staff_student_case_activity(UUID, INTEGER, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER, TIMESTAMPTZ, UUID) TO authenticated;

COMMENT ON FUNCTION platform.staff_student_case_activity(UUID, INTEGER, TIMESTAMPTZ, UUID) IS
  'UX-4 one exact-case allowlisted activity stream; stable keyset pagination, no raw audit or message bodies, no document author/time.';
COMMIT;
