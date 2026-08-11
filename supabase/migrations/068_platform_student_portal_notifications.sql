-- ============================================================
-- 068_platform_student_portal_notifications.sql
--
-- P6B: one durable, in-app-only Student Portal notification projection.
-- Negative document reviews publish atomically into the existing notification
-- and event ledgers. No delivery intent, provider state, communication row or
-- WhatsApp claim is created by this migration.
-- ============================================================

BEGIN;

-- Runtime publication is opt-in per organization. This table stays outside
-- the Data API and deliberately has no RLS policy: only SECURITY DEFINER
-- Platform functions owned by the migration role may inspect it. Absence of a
-- row is the fail-closed default.
CREATE TABLE platform_private.student_portal_notification_runtime_controls (
  organization_id UUID PRIMARY KEY
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE platform_private.student_portal_notification_runtime_controls
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_notification_runtime_controls
  FORCE ROW LEVEL SECURITY;

-- The source identity stays private. Browser callers receive only the narrow
-- actor-derived projection declared later in this migration.
CREATE UNIQUE INDEX document_reviews_portal_projection_identity_idx
  ON platform.document_reviews (
    organization_id,
    id,
    student_case_id,
    document_slot_id,
    document_version_id
  );

CREATE TABLE platform.student_portal_notification_projection_v1 (
  notification_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  projection_version SMALLINT NOT NULL DEFAULT 1
    CHECK (projection_version = 1),
  source_kind TEXT NOT NULL DEFAULT 'document_review'
    CHECK (source_kind = 'document_review'),
  source_record_id UUID NOT NULL,
  document_slot_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  document_requirement_id UUID NOT NULL,
  review_decision platform.document_review_decision NOT NULL
    CHECK (review_decision IN ('correction_required', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_portal_notification_projection_v1_source_key
    UNIQUE (organization_id, source_kind, source_record_id),
  CONSTRAINT student_portal_notification_projection_v1_notification_fkey
    FOREIGN KEY (
      organization_id,
      notification_id,
      student_case_id,
      recipient_membership_id
    )
    REFERENCES platform.notifications(
      organization_id,
      id,
      student_case_id,
      recipient_membership_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_notification_projection_v1_review_fkey
    FOREIGN KEY (
      organization_id,
      source_record_id,
      student_case_id,
      document_slot_id,
      document_version_id
    )
    REFERENCES platform.document_reviews(
      organization_id,
      id,
      student_case_id,
      document_slot_id,
      document_version_id
    )
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_notification_projection_v1_requirement_fkey
    FOREIGN KEY (organization_id, document_requirement_id)
    REFERENCES platform.document_requirements(organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX student_portal_notification_projection_v1_recipient_idx
  ON platform.student_portal_notification_projection_v1 (
    organization_id,
    recipient_membership_id,
    created_at DESC,
    notification_id
  );

CREATE INDEX student_portal_notification_projection_v1_case_idx
  ON platform.student_portal_notification_projection_v1 (
    organization_id,
    student_case_id,
    created_at DESC
  );

CREATE INDEX student_portal_notification_projection_v1_review_idx
  ON platform.student_portal_notification_projection_v1 (
    organization_id,
    source_record_id,
    student_case_id,
    document_slot_id,
    document_version_id
  );

CREATE INDEX student_portal_notification_projection_v1_requirement_idx
  ON platform.student_portal_notification_projection_v1 (
    organization_id,
    document_requirement_id
  );

ALTER TABLE platform.student_portal_notification_projection_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_portal_notification_projection_v1
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER student_portal_notification_projection_v1_append_only
  BEFORE UPDATE OR DELETE
  ON platform.student_portal_notification_projection_v1
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE TRIGGER student_portal_notification_projection_v1_no_truncate
  BEFORE TRUNCATE
  ON platform.student_portal_notification_projection_v1
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

-- Migration 043's accepted review implementation remains the one mutation
-- authority. Move it behind two explicit wrappers: the original public
-- signature preserves legacy review behavior with publication context cleared,
-- while the P6B wrapper is the only entry point allowed to arm publication.
ALTER FUNCTION platform.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) SET SCHEMA platform_private;

ALTER FUNCTION platform_private.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) RENAME TO review_document_version_legacy_043;

REVOKE ALL ON FUNCTION
  platform_private.review_document_version_legacy_043(
    UUID,
    UUID,
    platform.document_review_decision,
    TEXT,
    UUID
  ) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION platform.review_document_version(
  p_organization_id UUID,
  p_document_version_id UUID,
  p_decision platform.document_review_decision,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_context TEXT := current_setting(
    'platform_private.p6b_portal_notification_context',
    TRUE
  );
  result JSONB;
BEGIN
  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    '',
    TRUE
  );

  BEGIN
    result := platform_private.review_document_version_legacy_043(
      p_organization_id,
      p_document_version_id,
      p_decision,
      p_reason,
      p_request_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'platform_private.p6b_portal_notification_context',
      COALESCE(previous_context, ''),
      TRUE
    );
    RAISE;
  END;

  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    COALESCE(previous_context, ''),
    TRUE
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION
  platform.review_document_version_with_portal_notification_v1(
    p_organization_id UUID,
    p_document_version_id UUID,
    p_decision platform.document_review_decision,
    p_reason TEXT,
    p_request_id UUID
  )
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_context TEXT := current_setting(
    'platform_private.p6b_portal_notification_context',
    TRUE
  );
  publication_context TEXT;
  result JSONB;
BEGIN
  IF p_organization_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION
      'Organization and request identity are required for Portal publication'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM platform_private.student_portal_notification_runtime_controls AS control
  WHERE control.organization_id = p_organization_id
    AND control.enabled
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student Portal notification publication is disabled'
      USING ERRCODE = '55000';
  END IF;

  publication_context := p_organization_id::TEXT || ':' || p_request_id::TEXT;
  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    publication_context,
    TRUE
  );

  BEGIN
    result := platform_private.review_document_version_legacy_043(
      p_organization_id,
      p_document_version_id,
      p_decision,
      p_reason,
      p_request_id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'platform_private.p6b_portal_notification_context',
      COALESCE(previous_context, ''),
      TRUE
    );
    RAISE;
  END;

  PERFORM set_config(
    'platform_private.p6b_portal_notification_context',
    COALESCE(previous_context, ''),
    TRUE
  );
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.publish_document_review_portal_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient_membership_id UUID;
  requirement_id UUID;
  requirement_key TEXT;
  requirement_label TEXT;
  created_notification_id UUID := gen_random_uuid();
  notification_title TEXT;
  notification_body TEXT;
  fixed_event_reason CONSTANT TEXT :=
    'Negative document review published to Student Portal';
BEGIN
  IF current_setting(
      'platform_private.p6b_portal_notification_context',
      TRUE
    ) IS DISTINCT FROM
      NEW.organization_id::TEXT || ':' || NEW.request_id::TEXT
  THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_notification_runtime_controls AS control
    WHERE control.organization_id = NEW.organization_id
      AND control.enabled
  ) THEN
    RAISE EXCEPTION
      'Student Portal notification publication is disabled'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.decision NOT IN ('correction_required', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- The immutable 043 review RPC predates a browser-visible reason. Enforce
  -- the P6B publication boundary again at the producer so a caller cannot
  -- bypass the application parser with control characters or oversized text.
  IF NEW.reason IS NULL
    OR char_length(btrim(NEW.reason)) NOT BETWEEN 1 AND 2000
    OR NEW.reason ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Student Portal review reason must be 1..2000 control-free characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    student_case.student_membership_id,
    requirement.id,
    requirement.requirement_key,
    requirement.label
  INTO
    recipient_membership_id,
    requirement_id,
    requirement_key,
    requirement_label
  FROM platform.student_cases AS student_case
  JOIN platform.organization_memberships AS membership
    ON membership.organization_id = student_case.organization_id
    AND membership.id = student_case.student_membership_id
  JOIN platform.profiles AS profile
    ON profile.id = membership.profile_id
  JOIN platform.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN platform.role_bundle_versions AS bundle
    ON bundle.id = membership.current_bundle_id
    AND bundle.role = membership."current_role"
  JOIN platform.role_bundle_permissions AS portal_permission
    ON portal_permission.bundle_id = bundle.id
    AND portal_permission.bundle_role = bundle.role
    AND portal_permission.permission_key = 'portal.read.self'
  JOIN platform.role_bundle_permissions AS notification_permission
    ON notification_permission.bundle_id = bundle.id
    AND notification_permission.bundle_role = bundle.role
    AND notification_permission.permission_key = 'notification.read.self'
  JOIN platform.record_scopes AS student_case_scope
    ON student_case_scope.organization_id = student_case.organization_id
    AND student_case_scope.id = student_case.current_scope_id
    AND student_case_scope.scope_version = student_case.current_scope_version
    AND student_case_scope.scope_kind = 'student_case'
    AND student_case_scope.scope_key = student_case.id
    AND student_case_scope.is_active
  JOIN platform.membership_scope_assignments AS scope_assignment
    ON scope_assignment.organization_id = student_case_scope.organization_id
    AND scope_assignment.membership_id = membership.id
    AND scope_assignment.scope_id = student_case_scope.id
    AND scope_assignment.scope_version = student_case_scope.scope_version
  JOIN platform.document_slots AS slot
    ON slot.organization_id = student_case.organization_id
    AND slot.id = NEW.document_slot_id
    AND slot.student_case_id = student_case.id
    AND slot.current_version_id = NEW.document_version_id
  JOIN platform.document_versions AS document_version
    ON document_version.organization_id = slot.organization_id
    AND document_version.id = slot.current_version_id
    AND document_version.student_case_id = slot.student_case_id
    AND document_version.document_slot_id = slot.id
    AND document_version.version_no = slot.current_version_no
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  WHERE student_case.organization_id = NEW.organization_id
    AND student_case.id = NEW.student_case_id
    AND student_case.state IN ('active', 'closed')
    AND student_case.portal_activated_at IS NOT NULL
    AND membership.status = 'active'
    AND membership."current_role" = 'student'
    AND profile.status = 'active'
    AND organization.status = 'active'
    AND bundle.status = 'published'
    AND scope_assignment.granted
    AND NOT EXISTS (
      SELECT 1
      FROM platform.membership_scope_assignments AS later_assignment
      WHERE later_assignment.organization_id = scope_assignment.organization_id
        AND later_assignment.membership_id = scope_assignment.membership_id
        AND later_assignment.scope_id = scope_assignment.scope_id
        AND later_assignment.assignment_version >
          scope_assignment.assignment_version
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Negative document review requires one live Student Portal recipient'
      USING ERRCODE = '55000';
  END IF;

  IF char_length(btrim(requirement_key)) NOT BETWEEN 1 AND 128
    OR requirement_key ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Student Portal requirement key must be 1..128 control-free characters'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(btrim(requirement_label)) NOT BETWEEN 1 AND 300
    OR requirement_label ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION
      'Student Portal requirement label must be 1..300 control-free characters'
      USING ERRCODE = '22023';
  END IF;

  notification_title := CASE NEW.decision
    WHEN 'correction_required' THEN 'Document correction required'
    ELSE 'Document rejected'
  END;
  notification_body := requirement_label || ': ' || btrim(NEW.reason);

  INSERT INTO platform.notifications (
    id,
    organization_id,
    student_case_id,
    recipient_membership_id,
    category,
    title,
    body,
    dedupe_key,
    created_by_membership_id,
    created_at,
    updated_at
  )
  VALUES (
    created_notification_id,
    NEW.organization_id,
    NEW.student_case_id,
    recipient_membership_id,
    'document.review',
    notification_title,
    notification_body,
    'document_review:' || NEW.id::TEXT,
    NEW.reviewer_membership_id,
    NEW.created_at,
    NEW.created_at
  );

  INSERT INTO platform.student_portal_notification_projection_v1 (
    notification_id,
    organization_id,
    student_case_id,
    recipient_membership_id,
    source_record_id,
    document_slot_id,
    document_version_id,
    document_requirement_id,
    review_decision,
    created_at
  )
  VALUES (
    created_notification_id,
    NEW.organization_id,
    NEW.student_case_id,
    recipient_membership_id,
    NEW.id,
    NEW.document_slot_id,
    NEW.document_version_id,
    requirement_id,
    NEW.decision,
    NEW.created_at
  );

  INSERT INTO platform.notification_events (
    organization_id,
    notification_id,
    student_case_id,
    recipient_membership_id,
    event_type,
    actor_membership_id,
    reason,
    request_id,
    created_at
  )
  VALUES (
    NEW.organization_id,
    created_notification_id,
    NEW.student_case_id,
    recipient_membership_id,
    'created',
    NEW.reviewer_membership_id,
    fixed_event_reason,
    NEW.request_id,
    NEW.created_at
  );

  RETURN NEW;
END
$$;

CREATE TRIGGER document_reviews_publish_student_portal_notification
  AFTER INSERT
  ON platform.document_reviews
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.publish_document_review_portal_notification();

CREATE OR REPLACE FUNCTION platform.student_portal_notifications_v1()
RETURNS TABLE (
  notification_id UUID,
  category TEXT,
  review_decision platform.document_review_decision,
  requirement_key TEXT,
  requirement_label TEXT,
  reason TEXT,
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
    SELECT
      student_case.organization_id,
      student_case.id AS student_case_id
    FROM authority
    JOIN platform.student_cases AS student_case
      ON student_case.organization_id = authority.organization_id
      AND student_case.student_membership_id = authority.membership_id
    WHERE private.platform_can_read_student_portal_case(
      student_case.organization_id,
      student_case.id
    )
  )
  SELECT
    notification.id,
    notification.category,
    projection.review_decision,
    requirement.requirement_key,
    requirement.label,
    document_review.reason,
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
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = projection.organization_id
    AND requirement.id = projection.document_requirement_id
  ORDER BY notification.created_at DESC, notification.id DESC
  LIMIT 500
$$;

CREATE OR REPLACE FUNCTION platform.mark_own_student_portal_notification_read_v1(
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
  fixed_reason CONSTANT TEXT :=
    'Student marked the Portal notification as read';
  result JSONB;
BEGIN
  PERFORM platform_private.lock_p2e_request(p_request_id);

  IF p_notification_id IS NULL THEN
    RAISE EXCEPTION
      'notification_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO actor
  FROM platform.current_actor_authority() AS authority
  WHERE authority.platform_role = 'student';

  IF NOT FOUND
    OR NOT private.platform_has_permission(
      actor.organization_id,
      'notification.read.self'
    )
  THEN
    RAISE EXCEPTION
      'Notification is unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT notification.*
  INTO target_notification
  FROM platform.notifications AS notification
  JOIN platform.student_portal_notification_projection_v1 AS projection
    ON projection.organization_id = notification.organization_id
    AND projection.notification_id = notification.id
    AND projection.student_case_id = notification.student_case_id
    AND projection.recipient_membership_id =
      notification.recipient_membership_id
  WHERE notification.organization_id = actor.organization_id
    AND notification.id = p_notification_id
    AND notification.recipient_membership_id = actor.membership_id
    AND private.platform_can_read_student_portal_case(
      notification.organization_id,
      notification.student_case_id
    )
  FOR UPDATE OF notification;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Notification is unavailable'
      USING ERRCODE = '42501';
  END IF;

  replayed := platform_private.replay_audit(
    p_request_id,
    'notification.read',
    'notification',
    p_notification_id,
    fixed_reason,
    jsonb_build_object(
      'notification_id', p_notification_id,
      'is_read', TRUE
    )
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
    organization_id,
    notification_id,
    student_case_id,
    recipient_membership_id,
    event_type,
    actor_membership_id,
    reason,
    request_id
  )
  VALUES (
    actor.organization_id,
    p_notification_id,
    target_notification.student_case_id,
    actor.membership_id,
    'read',
    actor.membership_id,
    fixed_reason,
    p_request_id
  );

  result := jsonb_build_object(
    'notification_id', p_notification_id,
    'is_read', TRUE,
    'read_at', read_at_value
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
    actor.organization_id,
    'user',
    actor.profile_id,
    'auth:' || actor.auth_user_id::TEXT,
    'notification.read',
    'notification',
    p_notification_id,
    jsonb_build_object('read_at', target_notification.read_at),
    result,
    fixed_reason,
    p_request_id
  );

  RETURN result;
END
$$;

-- Keep the accepted 043 acknowledgement behavior for its two-intent legacy
-- rows, but remove it as an alternate path for the narrower P6B projection.
-- The original implementation becomes a private, non-executable delegate so
-- the additive wrapper does not duplicate or drift its established semantics.
ALTER FUNCTION platform.mark_own_notification_read(UUID, UUID, UUID)
  RENAME TO mark_own_notification_read_legacy_043;
ALTER FUNCTION platform.mark_own_notification_read_legacy_043(UUID, UUID, UUID)
  SET SCHEMA platform_private;

REVOKE ALL ON FUNCTION
  platform_private.mark_own_notification_read_legacy_043(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

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
  ) THEN
    RAISE EXCEPTION
      'Notification is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN platform_private.mark_own_notification_read_legacy_043(
    p_organization_id,
    p_notification_id,
    p_request_id
  );
END
$$;

-- Topic authorization is evaluated at private Realtime channel join time.
-- Both tenant and membership identifiers must match the one live JWT-bound
-- Student authority, and that Student must still own a Portal-readable case.
CREATE OR REPLACE FUNCTION platform_private.can_subscribe_student_portal_notifications(
  p_topic TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ (
      '^platform-portal-notifications:'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}:'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
      || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) THEN EXISTS (
      SELECT 1
      FROM platform.current_actor_authority() AS authority
      JOIN platform.student_cases AS student_case
        ON student_case.organization_id = authority.organization_id
        AND student_case.student_membership_id = authority.membership_id
      WHERE authority.organization_id = split_part(p_topic, ':', 2)::UUID
        AND authority.membership_id = split_part(p_topic, ':', 3)::UUID
        AND authority.platform_role = 'student'
        AND private.platform_has_permission(
          authority.organization_id,
          'notification.read.self'
        )
        AND private.platform_can_read_student_portal_case(
          student_case.organization_id,
          student_case.id
        )
    )
    ELSE FALSE
  END
$$;

CREATE OR REPLACE FUNCTION platform_private.broadcast_student_portal_notification_created()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(
    '{}'::JSONB,
    'invalidate',
    'platform-portal-notifications:'
      || NEW.organization_id::TEXT
      || ':'
      || NEW.recipient_membership_id::TEXT,
    TRUE
  );
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION platform_private.broadcast_student_portal_notification_read()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  projection RECORD;
BEGIN
  SELECT
    portal_projection.organization_id,
    portal_projection.recipient_membership_id
  INTO projection
  FROM platform.student_portal_notification_projection_v1
    AS portal_projection
  WHERE portal_projection.organization_id = NEW.organization_id
    AND portal_projection.notification_id = NEW.id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM realtime.send(
    '{}'::JSONB,
    'invalidate',
    'platform-portal-notifications:'
      || projection.organization_id::TEXT
      || ':'
      || projection.recipient_membership_id::TEXT,
    TRUE
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER student_portal_notification_projection_v1_realtime_invalidate
  AFTER INSERT
  ON platform.student_portal_notification_projection_v1
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_student_portal_notification_created();

CREATE TRIGGER student_portal_notification_read_realtime_invalidate
  AFTER UPDATE OF read_at
  ON platform.notifications
  FOR EACH ROW
  WHEN (OLD.read_at IS DISTINCT FROM NEW.read_at)
  EXECUTE FUNCTION
    platform_private.broadcast_student_portal_notification_read();

CREATE POLICY student_portal_notifications_broadcast_read
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND realtime.messages.topic = (SELECT realtime.topic())
  AND (
    SELECT platform_private.can_subscribe_student_portal_notifications(
      (SELECT realtime.topic())
    )
  )
);

-- Migration 053 previously joined every historical version, making the staff
-- review target ambiguous. Keep its exact return contract and authority while
-- binding the row to the slot's current version only.
CREATE OR REPLACE FUNCTION platform.staff_student_case_documents(
  p_student_case_id UUID
)
RETURNS TABLE (
  case_id UUID,
  document_slot_id UUID,
  document_requirement_id UUID,
  requirement_key TEXT,
  requirement_label TEXT,
  instructions TEXT,
  checklist_version BIGINT,
  slot_status platform.document_slot_status,
  deadline TIMESTAMPTZ,
  next_action TEXT,
  document_version_id UUID,
  version_no BIGINT,
  original_filename TEXT,
  declared_mime_type TEXT,
  byte_size BIGINT,
  submitted_at TIMESTAMPTZ,
  review_decision platform.document_review_decision,
  rework_reason TEXT,
  reviewed_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    slot.student_case_id,
    slot.id,
    requirement.id,
    requirement.requirement_key,
    requirement.label,
    requirement.instructions,
    requirement.checklist_version,
    slot.status,
    slot.deadline,
    slot.next_action,
    document_version.id,
    document_version.version_no,
    document_version.original_filename,
    document_version.declared_mime_type,
    document_version.byte_size,
    document_version.created_at,
    review.decision,
    CASE
      WHEN review.decision IN ('correction_required', 'rejected')
      THEN review.reason
      ELSE NULL
    END,
    review.created_at
  FROM platform.document_slots AS slot
  JOIN platform.document_requirements AS requirement
    ON requirement.organization_id = slot.organization_id
    AND requirement.id = slot.requirement_id
  LEFT JOIN platform.document_versions AS document_version
    ON document_version.organization_id = slot.organization_id
    AND document_version.id = slot.current_version_id
    AND document_version.document_slot_id = slot.id
    AND document_version.student_case_id = slot.student_case_id
    AND document_version.version_no = slot.current_version_no
  LEFT JOIN LATERAL (
    SELECT
      document_review.decision,
      document_review.reason,
      document_review.created_at
    FROM platform.document_reviews AS document_review
    WHERE document_review.organization_id = slot.organization_id
      AND document_review.document_version_id = document_version.id
    ORDER BY document_review.created_at DESC, document_review.id DESC
    LIMIT 1
  ) AS review ON TRUE
  WHERE slot.student_case_id = p_student_case_id
    AND private.platform_has_permission(
      slot.organization_id,
      'profile.read.full'
    )
    AND private.platform_can_read_student_case(
      slot.organization_id,
      slot.student_case_id
    )
  ORDER BY slot.deadline NULLS LAST, slot.id
$$;

-- Projection tables remain inaccessible through direct browser DML. The only
-- browser surface is the two reviewed actor-derived RPCs.
REVOKE ALL ON TABLE platform.student_portal_notification_projection_v1
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON TABLE
  platform_private.student_portal_notification_runtime_controls
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.review_document_version(
  UUID,
  UUID,
  platform.document_review_decision,
  TEXT,
  UUID
) TO authenticated;

REVOKE ALL ON FUNCTION
  platform.review_document_version_with_portal_notification_v1(
    UUID,
    UUID,
    platform.document_review_decision,
    TEXT,
    UUID
  ) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.review_document_version_with_portal_notification_v1(
    UUID,
    UUID,
    platform.document_review_decision,
    TEXT,
    UUID
  ) TO authenticated;

REVOKE ALL ON FUNCTION
  platform_private.review_document_version_legacy_043(
    UUID,
    UUID,
    platform.document_review_decision,
    TEXT,
    UUID
  ) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform.student_portal_notifications_v1()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_notifications_v1()
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.mark_own_student_portal_notification_read_v1(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.mark_own_student_portal_notification_read_v1(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.mark_own_notification_read(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.mark_own_notification_read(UUID, UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform_private.publish_document_review_portal_notification()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.can_subscribe_student_portal_notifications(TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
-- The OID-bound realtime.messages RLS policy executes this helper as the
-- authenticated reader and therefore requires function EXECUTE. The private
-- schema itself remains without authenticated USAGE, so callers still cannot
-- address this helper as a browser RPC or direct SQL surface.
GRANT EXECUTE ON FUNCTION
  platform_private.can_subscribe_student_portal_notifications(TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION
  platform_private.broadcast_student_portal_notification_created()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.broadcast_student_portal_notification_read()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE realtime.messages
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE realtime.messages FROM anon;
GRANT SELECT ON TABLE realtime.messages TO authenticated;
REVOKE ALL ON FUNCTION realtime.send(JSONB, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE platform.student_portal_notification_projection_v1 IS
  'Private immutable P6B source binding for durable in-app-only Student Portal notifications.';
COMMENT ON TABLE
  platform_private.student_portal_notification_runtime_controls IS
  'Private per-organization P6B publication switch; absence or enabled=false is disabled.';
COMMENT ON FUNCTION
  platform.review_document_version_with_portal_notification_v1(
    UUID,
    UUID,
    platform.document_review_decision,
    TEXT,
    UUID
  ) IS
  'Reviews one current document version and, only when explicitly enabled, atomically publishes the safe Student Portal notification projection.';
COMMENT ON FUNCTION platform.student_portal_notifications_v1() IS
  'Returns only the current Student actor own safe durable Portal notification fields.';
COMMENT ON FUNCTION
  platform.mark_own_student_portal_notification_read_v1(UUID, UUID) IS
  'Atomically marks one current Student actor own P6B notification read with durable event and audit evidence.';
COMMENT ON FUNCTION platform.mark_own_notification_read(UUID, UUID, UUID) IS
  'Preserves the accepted legacy two-intent acknowledgement while rejecting P6B notifications that require the narrower actor-derived RPC.';
COMMENT ON FUNCTION
  platform_private.can_subscribe_student_portal_notifications(TEXT) IS
  'Authorizes one exact membership-scoped private Student Portal notification topic from live JWT authority.';

COMMIT;
