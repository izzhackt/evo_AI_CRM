-- Complete Student help replies using the existing notification/event and
-- immutable help-command ledgers. No external delivery or backfilled events.
-- https://supabase.com/docs/guides/database/functions
BEGIN;

CREATE UNIQUE INDEX notifications_case_help_answer_dedupe_idx
 ON platform.notifications (organization_id, recipient_membership_id, dedupe_key)
 WHERE category = 'case_help.answer';

CREATE OR REPLACE FUNCTION platform.answer_case_help_request_v1(p_case_id UUID,p_help_id UUID,p_answer TEXT,p_expected_version BIGINT,p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; h platform.case_help_requests%ROWTYPE; prior platform_private.case_help_commands%ROWTYPE; input JSONB; receipt JSONB; notification_id UUID;
BEGIN
 SELECT * INTO a FROM platform_private.require_case_operations_actor(p_case_id);
 PERFORM platform_private.require_case_operator(a.organization_id,a.student_case_id,'case.update.append');
 IF p_request_id IS NULL OR p_help_id IS NULL OR p_answer IS NULL OR length(btrim(p_answer)) NOT BETWEEN 1 AND 4000 OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'Invalid help answer' USING ERRCODE='22023'; END IF;
 input:=jsonb_build_object('operation','answer','caseId',a.student_case_id,'id',p_help_id,'answer',btrim(p_answer),'version',p_expected_version::TEXT);
 PERFORM pg_advisory_xact_lock(hashtextextended('case-help:'||p_request_id::TEXT,0));
 SELECT * INTO prior FROM platform_private.case_help_commands x WHERE x.request_id=p_request_id;
 IF FOUND THEN
  IF prior.organization_id<>a.organization_id OR prior.actor_membership_id<>a.membership_id OR prior.input<>input THEN RAISE EXCEPTION 'request_conflict' USING ERRCODE='23505'; END IF;
  RETURN prior.receipt;
 END IF;
 SELECT * INTO h FROM platform.case_help_requests x WHERE x.organization_id=a.organization_id AND x.student_case_id=a.student_case_id AND x.id=p_help_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Help request unavailable' USING ERRCODE='42501'; END IF;
 IF h.version<>p_expected_version THEN RAISE EXCEPTION 'stale' USING ERRCODE='40001'; END IF;
 UPDATE platform.case_help_requests SET answer=btrim(p_answer),status='answered',version=version+1,
  answered_by_membership_id=a.membership_id,answered_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
 receipt:=jsonb_build_object('id',h.id,'caseId',h.student_case_id,'version',h.version::TEXT,'requestId',p_request_id);
 INSERT INTO platform_private.case_help_commands VALUES(p_request_id,a.organization_id,a.membership_id,h.id,input,receipt,clock_timestamp());
 -- The command receipt and notification commit together. A retry returns above.
 INSERT INTO platform.notifications (
  organization_id, student_case_id, recipient_membership_id, category,
  title, body, dedupe_key, created_by_membership_id
 ) VALUES (
  h.organization_id, h.student_case_id, h.student_membership_id, 'case_help.answer',
  'Ответ на ваше обращение', 'Куратор ответил. Откройте обращение, чтобы прочитать ответ.',
  'case_help_answer:' || p_request_id::TEXT, a.membership_id
 ) RETURNING id INTO notification_id;
 INSERT INTO platform.notification_events (
  organization_id, notification_id, student_case_id, recipient_membership_id,
  event_type, actor_membership_id, reason, request_id
 ) VALUES (
  h.organization_id, notification_id, h.student_case_id, h.student_membership_id,
  'created', a.membership_id, 'Curator answered the Student case help request', p_request_id
 );
 RETURN receipt;
END $$;

-- One owner-filtered projection reused by the feed, read acknowledgement and
-- exact reply page. Command/event joins prevent arbitrary notifications from
-- being interpreted as authentic answers; content stays in the case help record.
CREATE FUNCTION platform_private.own_case_help_notifications()
RETURNS TABLE (
 notification_id UUID, help_request_id UUID, student_case_id UUID,
 category TEXT, event_code TEXT, subject_label TEXT, detail TEXT,
 due_at TIMESTAMPTZ, created_at TIMESTAMPTZ, read_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT n.id, h.id, h.student_case_id, n.category, 'case_help_answer'::TEXT,
  n.title, n.body, NULL::TIMESTAMPTZ, n.created_at, n.read_at
 FROM platform.current_actor_authority() a
 JOIN platform.notifications n
  ON n.organization_id = a.organization_id AND n.recipient_membership_id = a.membership_id
 JOIN platform.notification_events e
  ON e.organization_id = n.organization_id AND e.notification_id = n.id
  AND e.student_case_id = n.student_case_id AND e.recipient_membership_id = n.recipient_membership_id
  AND e.event_type = 'created'
 JOIN platform_private.case_help_commands command
  ON command.organization_id = n.organization_id AND command.request_id = e.request_id
  AND command.actor_membership_id = n.created_by_membership_id
  AND command.input->>'operation' = 'answer'
 JOIN platform.case_help_requests h
  ON h.organization_id = n.organization_id AND h.id = command.help_request_id
  AND h.student_case_id = n.student_case_id AND h.student_membership_id = a.membership_id
 WHERE a.platform_role = 'student' AND n.category = 'case_help.answer'
  AND n.dedupe_key = 'case_help_answer:' || command.request_id::TEXT
  AND private.platform_has_permission(a.organization_id, 'notification.read.self')
  AND private.platform_can_read_student_portal_case(n.organization_id, n.student_case_id)
$$;

CREATE FUNCTION platform.student_portal_help_reply_v1(p_notification_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result JSONB;
BEGIN
 SELECT jsonb_build_object('caseId', h.student_case_id, 'readAt', n.read_at, 'items', jsonb_build_array(
  jsonb_build_object('id', h.id, 'subject', h.subject, 'body', h.body, 'answer', h.answer,
   'status', h.status, 'version', h.version::TEXT, 'createdAt', h.created_at, 'answeredAt', h.answered_at)
 )) INTO result
 FROM platform_private.own_case_help_notifications() n
 JOIN platform.case_help_requests h ON h.id = n.help_request_id
 WHERE n.notification_id = p_notification_id;
 IF result IS NULL THEN RAISE EXCEPTION 'Reply unavailable' USING ERRCODE = '42501'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION platform.student_portal_notifications_v2()
RETURNS TABLE (
  notification_id UUID,
  category TEXT,
  event_code TEXT,
  subject_label TEXT,
  detail TEXT,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH authority AS MATERIALIZED (
    SELECT current_authority.*
    FROM platform.current_actor_authority() AS current_authority
    WHERE current_authority.platform_role = 'student'
      AND private.platform_has_permission(
        current_authority.organization_id,
        'notification.read.self'
      )
  ),
  readable_cases AS MATERIALIZED (
    SELECT student_case.organization_id, student_case.id AS student_case_id
    FROM authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
      AND student_case.student_membership_id = authority.membership_id
    WHERE private.platform_can_read_student_portal_case(
      student_case.organization_id,
      student_case.id
    )
  ),
  safe_rows AS (
    SELECT
      notification.id AS notification_id,
      notification.category,
      projection.review_decision::TEXT AS event_code,
      COALESCE(
        projection.requirement_label,
        requirement.label
      ) AS subject_label,
      document_review.reason AS detail,
      NULL::TIMESTAMPTZ AS due_at,
      notification.created_at,
      notification.read_at
    FROM authority
    JOIN readable_cases AS readable_case
      ON readable_case.organization_id = authority.organization_id
    JOIN platform.student_portal_notification_projection_v1 AS projection
      ON projection.organization_id = authority.organization_id
      AND projection.recipient_membership_id = authority.membership_id
      AND projection.student_case_id = readable_case.student_case_id
    JOIN platform.notifications AS notification
      ON notification.organization_id = projection.organization_id
      AND notification.id = projection.notification_id
      AND notification.student_case_id = projection.student_case_id
      AND notification.recipient_membership_id =
        projection.recipient_membership_id
    JOIN platform.document_reviews AS document_review
      ON document_review.organization_id = projection.organization_id
      AND document_review.id = projection.source_record_id
      AND document_review.student_case_id = projection.student_case_id
      AND document_review.document_slot_id = projection.document_slot_id
      AND document_review.document_version_id = projection.document_version_id
    JOIN platform.document_slots AS slot
      ON slot.organization_id = projection.organization_id
      AND slot.id = projection.document_slot_id
      AND slot.student_case_id = projection.student_case_id
      AND slot.requirement_id IS NOT DISTINCT FROM
        projection.document_requirement_id
    LEFT JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = slot.organization_id
      AND requirement.id = slot.requirement_id

    UNION ALL

    SELECT
      notification.id,
      notification.category,
      'overdue'::TEXT,
      overdue_projection.subject_label,
      overdue_projection.detail,
      overdue_projection.due_at,
      notification.created_at,
      notification.read_at
    FROM authority
    JOIN readable_cases AS readable_case
      ON readable_case.organization_id = authority.organization_id
    JOIN platform.student_portal_overdue_notification_projection_v1
      AS overdue_projection
      ON overdue_projection.organization_id = authority.organization_id
      AND overdue_projection.recipient_membership_id = authority.membership_id
      AND overdue_projection.student_case_id = readable_case.student_case_id
    JOIN platform.notifications AS notification
      ON notification.organization_id = overdue_projection.organization_id
      AND notification.id = overdue_projection.notification_id
      AND notification.student_case_id = overdue_projection.student_case_id
      AND notification.recipient_membership_id =
        overdue_projection.recipient_membership_id
    UNION ALL
    SELECT n.notification_id, n.category, n.event_code, n.subject_label,
      n.detail, n.due_at, n.created_at, n.read_at
    FROM platform_private.own_case_help_notifications() n
  )
  SELECT safe_rows.*
  FROM safe_rows
  ORDER BY safe_rows.created_at DESC, safe_rows.notification_id DESC
  LIMIT 500
$$;
CREATE OR REPLACE FUNCTION platform.mark_own_student_portal_notification_read_v2(
  p_notification_id UUID,
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
  target_notification platform.notifications%ROWTYPE;
  replayed JSONB;
  read_at_value TIMESTAMPTZ := statement_timestamp();
  fixed_reason CONSTANT TEXT := 'Student marked the Portal notification as read';
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);
  IF p_notification_id IS NULL THEN
    RAISE EXCEPTION 'notification_id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role = 'student';
  IF NOT FOUND OR NOT private.platform_has_permission(
    actor.organization_id,
    'notification.read.self'
  ) THEN
    RAISE EXCEPTION 'Notification is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT notification.*
  INTO target_notification
  FROM platform.notifications AS notification
  WHERE notification.organization_id = actor.organization_id
    AND notification.id = p_notification_id
    AND notification.recipient_membership_id = actor.membership_id
    AND private.platform_can_read_student_portal_case(
      notification.organization_id,
      notification.student_case_id
    )
    AND (
      EXISTS (
        SELECT 1
        FROM platform.student_portal_notification_projection_v1 AS projection
        WHERE projection.organization_id = notification.organization_id
          AND projection.notification_id = notification.id
          AND projection.student_case_id = notification.student_case_id
          AND projection.recipient_membership_id = notification.recipient_membership_id
      )
      OR EXISTS (
        SELECT 1
        FROM platform.student_portal_overdue_notification_projection_v1 AS projection
        WHERE projection.organization_id = notification.organization_id
          AND projection.notification_id = notification.id
          AND projection.student_case_id = notification.student_case_id
          AND projection.recipient_membership_id = notification.recipient_membership_id
      )
      OR EXISTS (
        SELECT 1 FROM platform_private.own_case_help_notifications() help
        WHERE help.notification_id = notification.id
      )
    )
  FOR UPDATE OF notification;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification is unavailable' USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.read',
    'notification',
    p_notification_id,
    fixed_reason,
    jsonb_build_object('notification_id', p_notification_id, 'is_read', TRUE)
  );
  IF replayed IS NOT NULL THEN
    RETURN replayed;
  END IF;

  IF target_notification.read_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Notification is already read; reuse the original request_id'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.notifications AS notification
  SET read_at = read_at_value
  WHERE notification.organization_id = actor.organization_id
    AND notification.id = p_notification_id;

  INSERT INTO platform.notification_events (
    organization_id, notification_id, student_case_id,
    recipient_membership_id, event_type, actor_membership_id,
    reason, request_id
  ) VALUES (
    actor.organization_id, p_notification_id,
    target_notification.student_case_id, actor.membership_id,
    'read', actor.membership_id, fixed_reason, p_request_id
  );

  result := jsonb_build_object(
    'notification_id', p_notification_id,
    'is_read', TRUE,
    'read_at', read_at_value
  );

  INSERT INTO platform.audit_events (
    organization_id, actor_kind, actor_profile_id, actor_principal,
    action, resource_type, resource_id, before_state, after_state,
    reason, request_id
  ) VALUES (
    actor.organization_id, 'user', actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    'notification.read', 'notification', p_notification_id,
    jsonb_build_object('read_at', target_notification.read_at),
    result, fixed_reason, p_request_id
  );
  RETURN result;
END
$$;
CREATE OR REPLACE FUNCTION platform.mark_own_notification_read(
  p_organization_id UUID,
  p_notification_id UUID,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform.student_portal_notification_projection_v1 AS projection
    WHERE projection.organization_id = p_organization_id
      AND projection.notification_id = p_notification_id
    UNION ALL
    SELECT 1
    FROM platform.student_portal_overdue_notification_projection_v1 AS projection
    WHERE projection.organization_id = p_organization_id
      AND projection.notification_id = p_notification_id
    UNION ALL
    SELECT 1 FROM platform.notifications notification
    WHERE notification.organization_id = p_organization_id
      AND notification.id = p_notification_id
      AND notification.category = 'case_help.answer'
  ) THEN
    RAISE EXCEPTION 'Notification is unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN platform_private.mark_own_notification_read_legacy_043(
    p_organization_id,
    p_notification_id,
    p_request_id
  );
END
$$;

REVOKE ALL ON FUNCTION platform_private.own_case_help_notifications()
 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION platform.student_portal_help_reply_v1(UUID)
 FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.student_portal_help_reply_v1(UUID) TO authenticated;
-- Replaced functions retain their existing restricted execute grants.
COMMIT;
