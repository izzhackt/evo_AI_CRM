-- ============================================================
-- 069_platform_student_portal_overdue_notifications.sql
--
-- P6C: disabled-by-default, bounded task-then-payment overdue transition
-- publication for the durable Student Portal notification feed.
-- ============================================================

BEGIN;

CREATE TABLE platform_private.student_portal_overdue_notification_runtime_controls (
  organization_id UUID PRIMARY KEY
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  automation_owner_membership_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_portal_overdue_runtime_owner_fkey
    FOREIGN KEY (organization_id, automation_owner_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE platform_private.student_portal_overdue_transition_state (
  organization_id UUID NOT NULL,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('task', 'payment')),
  source_record_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  is_overdue BOOLEAN NOT NULL,
  transition_version INTEGER NOT NULL DEFAULT 0
    CHECK (transition_version >= 0),
  observed_due_at TIMESTAMPTZ NOT NULL,
  first_overdue_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, source_kind, source_record_id),
  CONSTRAINT student_portal_overdue_transition_case_fkey
    FOREIGN KEY (organization_id, student_case_id)
    REFERENCES platform.student_cases(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_overdue_transition_recipient_fkey
    FOREIGN KEY (organization_id, recipient_membership_id)
    REFERENCES platform.organization_memberships(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT student_portal_overdue_transition_shape_check CHECK (
    (
      is_overdue
      AND transition_version > 0
      AND first_overdue_at IS NOT NULL
      AND resolved_at IS NULL
    )
    OR (
      NOT is_overdue
      AND transition_version > 0
      AND first_overdue_at IS NOT NULL
      AND resolved_at IS NOT NULL
    )
  )
);

CREATE INDEX student_portal_overdue_transition_active_idx
  ON platform_private.student_portal_overdue_transition_state (
    organization_id,
    source_kind,
    source_record_id
  )
  WHERE is_overdue;

-- The worker scans across enabled tenants by exact due time. Keep equality
-- columns first and the range/order columns last; exclude permanently
-- irrelevant source rows from these hot-path indexes.
CREATE INDEX case_tasks_student_overdue_scan_idx
  ON platform.case_tasks (organization_id, due_at, id)
  WHERE student_visible
    AND due_at IS NOT NULL
    AND status IN ('open', 'in_progress', 'blocked');

CREATE INDEX payment_obligations_overdue_scan_idx
  ON platform.payment_obligations (organization_id, due_at, id)
  WHERE amount_minor - total_paid_minor + total_refunded_minor > 0;

CREATE TABLE platform_private.student_portal_overdue_notification_runs (
  request_id UUID PRIMARY KEY,
  worker_id TEXT NOT NULL CHECK (
    worker_id ~ '^[a-z][a-z0-9:_-]{2,127}$'
  ),
  status TEXT NOT NULL CHECK (status = 'completed'),
  organizations_processed INTEGER NOT NULL CHECK (organizations_processed >= 0),
  task_candidates INTEGER NOT NULL CHECK (task_candidates BETWEEN 0 AND 50),
  task_published INTEGER NOT NULL CHECK (task_published BETWEEN 0 AND 50),
  task_resolved INTEGER NOT NULL CHECK (task_resolved BETWEEN 0 AND 50),
  payment_candidates INTEGER NOT NULL CHECK (payment_candidates BETWEEN 0 AND 50),
  payment_published INTEGER NOT NULL CHECK (payment_published BETWEEN 0 AND 50),
  payment_resolved INTEGER NOT NULL CHECK (payment_resolved BETWEEN 0 AND 50),
  result JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_portal_overdue_run_task_counts_check CHECK (
    task_published + task_resolved <= task_candidates
  ),
  CONSTRAINT student_portal_overdue_run_payment_counts_check CHECK (
    payment_published + payment_resolved <= payment_candidates
  )
);

CREATE TABLE platform.student_portal_overdue_notification_projection_v1 (
  notification_id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  student_case_id UUID NOT NULL,
  recipient_membership_id UUID NOT NULL,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('task', 'payment')),
  source_record_id UUID NOT NULL,
  transition_version INTEGER NOT NULL CHECK (transition_version > 0),
  subject_label TEXT NOT NULL CHECK (
    char_length(btrim(subject_label)) BETWEEN 1 AND 300
    AND subject_label !~ '[[:cntrl:]]'
  ),
  detail TEXT NOT NULL CHECK (
    char_length(btrim(detail)) BETWEEN 1 AND 500
    AND detail !~ '[[:cntrl:]]'
  ),
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT student_portal_overdue_projection_episode_key
    UNIQUE (
      organization_id,
      source_kind,
      source_record_id,
      transition_version
    ),
  CONSTRAINT student_portal_overdue_projection_notification_fkey
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
    ON DELETE RESTRICT
);

CREATE INDEX student_portal_overdue_projection_recipient_idx
  ON platform.student_portal_overdue_notification_projection_v1 (
    organization_id,
    recipient_membership_id,
    created_at DESC,
    notification_id
  );

ALTER TABLE
  platform_private.student_portal_overdue_notification_runtime_controls
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE
  platform_private.student_portal_overdue_notification_runtime_controls
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_overdue_transition_state
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_overdue_transition_state
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_overdue_notification_runs
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.student_portal_overdue_notification_runs
  FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.student_portal_overdue_notification_projection_v1
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.student_portal_overdue_notification_projection_v1
  FORCE ROW LEVEL SECURITY;

CREATE TRIGGER student_portal_overdue_runs_append_only
  BEFORE UPDATE OR DELETE
  ON platform_private.student_portal_overdue_notification_runs
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_portal_overdue_runs_no_truncate
  BEFORE TRUNCATE
  ON platform_private.student_portal_overdue_notification_runs
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_portal_overdue_projection_append_only
  BEFORE UPDATE OR DELETE
  ON platform.student_portal_overdue_notification_projection_v1
  FOR EACH ROW
  EXECUTE FUNCTION platform_private.block_append_only_mutation();
CREATE TRIGGER student_portal_overdue_projection_no_truncate
  BEFORE TRUNCATE
  ON platform.student_portal_overdue_notification_projection_v1
  FOR EACH STATEMENT
  EXECUTE FUNCTION platform_private.block_append_only_mutation();

CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT statement_timestamp()
$$;

CREATE OR REPLACE FUNCTION platform_private.live_student_portal_recipient(
  p_organization_id UUID,
  p_student_case_id UUID
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT membership.id
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
  WHERE student_case.organization_id = p_organization_id
    AND student_case.id = p_student_case_id
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
    )
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.process_student_portal_overdue_notifications_v1(
  p_request_id UUID,
  p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  clock_value TIMESTAMPTZ;
  replayed JSONB;
  replay_worker_id TEXT;
  enabled_organization_ids UUID[] := ARRAY[]::UUID[];
  organization_count INTEGER := 0;
  task_candidate_count INTEGER := 0;
  task_published_count INTEGER := 0;
  task_resolved_count INTEGER := 0;
  payment_candidate_count INTEGER := 0;
  payment_published_count INTEGER := 0;
  payment_resolved_count INTEGER := 0;
  candidate RECORD;
  previous_state
    platform_private.student_portal_overdue_transition_state%ROWTYPE;
  recipient_id UUID;
  notification_id UUID;
  next_version INTEGER;
  result JSONB;
BEGIN
  IF (SELECT auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role is required' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_worker_id IS NULL
    OR p_worker_id !~ '^[a-z][a-z0-9:_-]{2,127}$'
  THEN
    RAISE EXCEPTION 'worker_id is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT run.result, run.worker_id
  INTO replayed, replay_worker_id
  FROM platform_private.student_portal_overdue_notification_runs AS run
  WHERE run.request_id = p_request_id;
  IF FOUND THEN
    IF replay_worker_id IS DISTINCT FROM p_worker_id THEN
      RAISE EXCEPTION
        'request_id is already bound to another worker_id'
        USING ERRCODE = '22023';
    END IF;
    RETURN replayed;
  END IF;

  clock_value := platform_private.student_portal_overdue_clock();

  SELECT COALESCE(
    array_agg(acquired.organization_id ORDER BY acquired.organization_id),
    ARRAY[]::UUID[]
  )
  INTO enabled_organization_ids
  FROM (
    SELECT control.organization_id
    FROM platform_private.student_portal_overdue_notification_runtime_controls AS control
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
    WHERE control.enabled
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
      AND owner_profile.status = 'active'
      AND organization.status = 'active'
      AND owner_bundle.status = 'published'
    ORDER BY control.organization_id
    FOR UPDATE OF control SKIP LOCKED
  ) AS acquired;
  organization_count := cardinality(enabled_organization_ids);

  FOR candidate IN
    SELECT
      task.organization_id,
      task.id AS source_record_id,
      task.student_case_id,
      task.title AS subject_label,
      task.due_at,
      control.automation_owner_membership_id,
      (
        task.student_visible
        AND task.due_at IS NOT NULL
        AND task.due_at < clock_value
        AND task.status IN ('open', 'in_progress', 'blocked')
      ) AS currently_overdue
    FROM platform.case_tasks AS task
    JOIN platform_private.student_portal_overdue_notification_runtime_controls AS control
      ON control.organization_id = task.organization_id
      AND control.enabled
      AND control.organization_id = ANY(enabled_organization_ids)
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
      AND owner_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
      AND owner_bundle.status = 'published'
    LEFT JOIN platform_private.student_portal_overdue_transition_state AS state
      ON state.organization_id = task.organization_id
      AND state.source_kind = 'task'
      AND state.source_record_id = task.id
    WHERE (
      task.student_visible
      AND task.due_at IS NOT NULL
      AND task.due_at < clock_value
      AND task.status IN ('open', 'in_progress', 'blocked')
      AND COALESCE(state.is_overdue, FALSE) = FALSE
    ) OR (
      state.is_overdue
      AND NOT (
        task.student_visible
        AND task.due_at IS NOT NULL
        AND task.due_at < clock_value
        AND task.status IN ('open', 'in_progress', 'blocked')
      )
    )
    ORDER BY task.organization_id, task.due_at NULLS LAST, task.id
    LIMIT 50
    FOR UPDATE OF task SKIP LOCKED
  LOOP
    task_candidate_count := task_candidate_count + 1;

    SELECT state.*
    INTO previous_state
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = candidate.organization_id
      AND state.source_kind = 'task'
      AND state.source_record_id = candidate.source_record_id
    FOR UPDATE;

    IF candidate.currently_overdue THEN
      recipient_id := platform_private.live_student_portal_recipient(
        candidate.organization_id,
        candidate.student_case_id
      );
      IF recipient_id IS NULL THEN
        CONTINUE;
      END IF;
      IF char_length(btrim(candidate.subject_label)) NOT BETWEEN 1 AND 300
        OR candidate.subject_label ~ '[[:cntrl:]]'
      THEN
        RAISE EXCEPTION 'Student-visible task title is unsafe'
          USING ERRCODE = '22023';
      END IF;

      next_version := COALESCE(previous_state.transition_version, 0) + 1;
      notification_id := gen_random_uuid();

      INSERT INTO platform.notifications (
        id, organization_id, student_case_id, recipient_membership_id,
        category, title, body, dedupe_key, created_by_membership_id,
        created_at, updated_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'task.overdue', 'Task overdue',
        'Open the task in the Student Portal to review the next action.',
        'p6c:task:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT,
        candidate.automation_owner_membership_id, clock_value, clock_value
      );

      INSERT INTO platform.student_portal_overdue_notification_projection_v1 (
        notification_id, organization_id, student_case_id,
        recipient_membership_id, source_kind, source_record_id,
        transition_version, subject_label, detail, due_at, created_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'task', candidate.source_record_id, next_version,
        btrim(candidate.subject_label),
        'The task due time has passed. Open the task to review the next action.',
        candidate.due_at, clock_value
      );

      INSERT INTO platform.notification_events (
        organization_id, notification_id, student_case_id,
        recipient_membership_id, event_type, actor_membership_id, reason,
        request_id, created_at
      ) VALUES (
        candidate.organization_id, notification_id, candidate.student_case_id,
        recipient_id, 'created', candidate.automation_owner_membership_id,
        'Overdue task episode published to Student Portal',
        public.uuid_generate_v5(
          p_request_id,
          'p6c:task:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT
        ),
        clock_value
      );

      INSERT INTO platform_private.student_portal_overdue_transition_state (
        organization_id, source_kind, source_record_id, student_case_id,
        recipient_membership_id, is_overdue, transition_version,
        observed_due_at, first_overdue_at, resolved_at, updated_at
      ) VALUES (
        candidate.organization_id, 'task', candidate.source_record_id,
        candidate.student_case_id, recipient_id, TRUE, next_version,
        candidate.due_at, clock_value, NULL, clock_value
      )
      ON CONFLICT (organization_id, source_kind, source_record_id)
      DO UPDATE SET
        student_case_id = EXCLUDED.student_case_id,
        recipient_membership_id = EXCLUDED.recipient_membership_id,
        is_overdue = TRUE,
        transition_version = EXCLUDED.transition_version,
        observed_due_at = EXCLUDED.observed_due_at,
        first_overdue_at = EXCLUDED.first_overdue_at,
        resolved_at = NULL,
        updated_at = EXCLUDED.updated_at;
      task_published_count := task_published_count + 1;
    ELSIF previous_state.is_overdue THEN
      UPDATE platform_private.student_portal_overdue_transition_state AS state
      SET is_overdue = FALSE,
          observed_due_at = COALESCE(candidate.due_at, state.observed_due_at),
          resolved_at = clock_value,
          updated_at = clock_value
      WHERE state.organization_id = candidate.organization_id
        AND state.source_kind = 'task'
        AND state.source_record_id = candidate.source_record_id;
      task_resolved_count := task_resolved_count + 1;
    END IF;
  END LOOP;

  FOR candidate IN
    SELECT
      obligation.organization_id,
      obligation.id AS source_record_id,
      obligation.student_case_id,
      obligation.label AS subject_label,
      obligation.due_at,
      control.automation_owner_membership_id,
      (
        obligation.due_at < clock_value
        AND obligation.amount_minor - obligation.total_paid_minor
          + obligation.total_refunded_minor > 0
      ) AS currently_overdue
    FROM platform.payment_obligations AS obligation
    JOIN platform_private.student_portal_overdue_notification_runtime_controls AS control
      ON control.organization_id = obligation.organization_id
      AND control.enabled
      AND control.organization_id = ANY(enabled_organization_ids)
    JOIN platform.organization_memberships AS owner_membership
      ON owner_membership.organization_id = control.organization_id
      AND owner_membership.id = control.automation_owner_membership_id
      AND owner_membership.status = 'active'
      AND owner_membership."current_role" = 'admin'
    JOIN platform.profiles AS owner_profile
      ON owner_profile.id = owner_membership.profile_id
      AND owner_profile.status = 'active'
    JOIN platform.organizations AS organization
      ON organization.id = control.organization_id
      AND organization.status = 'active'
    JOIN platform.role_bundle_versions AS owner_bundle
      ON owner_bundle.id = owner_membership.current_bundle_id
      AND owner_bundle.role = owner_membership."current_role"
      AND owner_bundle.status = 'published'
    LEFT JOIN platform_private.student_portal_overdue_transition_state AS state
      ON state.organization_id = obligation.organization_id
      AND state.source_kind = 'payment'
      AND state.source_record_id = obligation.id
    WHERE (
      obligation.due_at < clock_value
      AND obligation.amount_minor - obligation.total_paid_minor
        + obligation.total_refunded_minor > 0
      AND COALESCE(state.is_overdue, FALSE) = FALSE
    ) OR (
      state.is_overdue
      AND NOT (
        obligation.due_at < clock_value
        AND obligation.amount_minor - obligation.total_paid_minor
          + obligation.total_refunded_minor > 0
      )
    )
    ORDER BY obligation.organization_id, obligation.due_at, obligation.id
    LIMIT 50
    FOR UPDATE OF obligation SKIP LOCKED
  LOOP
    payment_candidate_count := payment_candidate_count + 1;

    SELECT state.*
    INTO previous_state
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = candidate.organization_id
      AND state.source_kind = 'payment'
      AND state.source_record_id = candidate.source_record_id
    FOR UPDATE;

    IF candidate.currently_overdue THEN
      recipient_id := platform_private.live_student_portal_recipient(
        candidate.organization_id,
        candidate.student_case_id
      );
      IF recipient_id IS NULL THEN
        CONTINUE;
      END IF;
      IF char_length(btrim(candidate.subject_label)) NOT BETWEEN 1 AND 300
        OR candidate.subject_label ~ '[[:cntrl:]]'
      THEN
        RAISE EXCEPTION 'Student-visible payment label is unsafe'
          USING ERRCODE = '22023';
      END IF;

      next_version := COALESCE(previous_state.transition_version, 0) + 1;
      notification_id := gen_random_uuid();

      INSERT INTO platform.notifications (
        id, organization_id, student_case_id, recipient_membership_id,
        category, title, body, dedupe_key, created_by_membership_id,
        created_at, updated_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'payment.overdue', 'Payment overdue',
        'Open the finance section in the Student Portal to review the next action.',
        'p6c:payment:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT,
        candidate.automation_owner_membership_id, clock_value, clock_value
      );

      INSERT INTO platform.student_portal_overdue_notification_projection_v1 (
        notification_id, organization_id, student_case_id,
        recipient_membership_id, source_kind, source_record_id,
        transition_version, subject_label, detail, due_at, created_at
      ) VALUES (
        notification_id, candidate.organization_id, candidate.student_case_id,
        recipient_id, 'payment', candidate.source_record_id, next_version,
        btrim(candidate.subject_label),
        'The payment due time has passed. Open finance to review the next action.',
        candidate.due_at, clock_value
      );

      INSERT INTO platform.notification_events (
        organization_id, notification_id, student_case_id,
        recipient_membership_id, event_type, actor_membership_id, reason,
        request_id, created_at
      ) VALUES (
        candidate.organization_id, notification_id, candidate.student_case_id,
        recipient_id, 'created', candidate.automation_owner_membership_id,
        'Overdue payment episode published to Student Portal',
        public.uuid_generate_v5(
          p_request_id,
          'p6c:payment:' || candidate.source_record_id::TEXT || ':' || next_version::TEXT
        ),
        clock_value
      );

      INSERT INTO platform_private.student_portal_overdue_transition_state (
        organization_id, source_kind, source_record_id, student_case_id,
        recipient_membership_id, is_overdue, transition_version,
        observed_due_at, first_overdue_at, resolved_at, updated_at
      ) VALUES (
        candidate.organization_id, 'payment', candidate.source_record_id,
        candidate.student_case_id, recipient_id, TRUE, next_version,
        candidate.due_at, clock_value, NULL, clock_value
      )
      ON CONFLICT (organization_id, source_kind, source_record_id)
      DO UPDATE SET
        student_case_id = EXCLUDED.student_case_id,
        recipient_membership_id = EXCLUDED.recipient_membership_id,
        is_overdue = TRUE,
        transition_version = EXCLUDED.transition_version,
        observed_due_at = EXCLUDED.observed_due_at,
        first_overdue_at = EXCLUDED.first_overdue_at,
        resolved_at = NULL,
        updated_at = EXCLUDED.updated_at;
      payment_published_count := payment_published_count + 1;
    ELSIF previous_state.is_overdue THEN
      UPDATE platform_private.student_portal_overdue_transition_state AS state
      SET is_overdue = FALSE,
          observed_due_at = candidate.due_at,
          resolved_at = clock_value,
          updated_at = clock_value
      WHERE state.organization_id = candidate.organization_id
        AND state.source_kind = 'payment'
        AND state.source_record_id = candidate.source_record_id;
      payment_resolved_count := payment_resolved_count + 1;
    END IF;
  END LOOP;

  result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'completed',
    'organizations_processed', organization_count,
    'task_candidates', task_candidate_count,
    'task_published', task_published_count,
    'task_resolved', task_resolved_count,
    'payment_candidates', payment_candidate_count,
    'payment_published', payment_published_count,
    'payment_resolved', payment_resolved_count
  );

  INSERT INTO platform_private.student_portal_overdue_notification_runs (
    request_id, worker_id, status, organizations_processed,
    task_candidates, task_published, task_resolved,
    payment_candidates, payment_published, payment_resolved,
    result, completed_at
  ) VALUES (
    p_request_id, p_worker_id, 'completed', organization_count,
    task_candidate_count, task_published_count, task_resolved_count,
    payment_candidate_count, payment_published_count,
    payment_resolved_count, result, clock_value
  );

  RETURN result;
END
$$;

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
      requirement.label AS subject_label,
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
      AND notification.recipient_membership_id = projection.recipient_membership_id
    JOIN platform.document_reviews AS document_review
      ON document_review.organization_id = projection.organization_id
      AND document_review.id = projection.source_record_id
      AND document_review.student_case_id = projection.student_case_id
    JOIN platform.document_requirements AS requirement
      ON requirement.organization_id = projection.organization_id
      AND requirement.id = projection.document_requirement_id

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
    JOIN platform.student_portal_overdue_notification_projection_v1 AS overdue_projection
      ON overdue_projection.organization_id = authority.organization_id
      AND overdue_projection.recipient_membership_id = authority.membership_id
      AND overdue_projection.student_case_id = readable_case.student_case_id
    JOIN platform.notifications AS notification
      ON notification.organization_id = overdue_projection.organization_id
      AND notification.id = overdue_projection.notification_id
      AND notification.student_case_id = overdue_projection.student_case_id
      AND notification.recipient_membership_id = overdue_projection.recipient_membership_id
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

-- Extend the accepted legacy acknowledgement containment to P6C rows while
-- preserving the private P6B delegate installed by migration 068.
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

CREATE OR REPLACE FUNCTION
  platform_private.broadcast_student_portal_overdue_notification_created()
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

CREATE TRIGGER student_portal_overdue_projection_realtime_invalidate
  AFTER INSERT
  ON platform.student_portal_overdue_notification_projection_v1
  FOR EACH ROW
  EXECUTE FUNCTION
    platform_private.broadcast_student_portal_overdue_notification_created();

REVOKE ALL ON TABLE
  platform_private.student_portal_overdue_notification_runtime_controls,
  platform_private.student_portal_overdue_transition_state,
  platform_private.student_portal_overdue_notification_runs
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON TABLE platform.student_portal_overdue_notification_projection_v1
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION platform_private.student_portal_overdue_clock()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.live_student_portal_recipient(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION
  platform_private.broadcast_student_portal_overdue_notification_created()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION
  platform.process_student_portal_overdue_notifications_v1(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.process_student_portal_overdue_notifications_v1(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION platform.student_portal_notifications_v2()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION platform.student_portal_notifications_v2()
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.mark_own_student_portal_notification_read_v2(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.mark_own_student_portal_notification_read_v2(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION
  platform.mark_own_notification_read(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION
  platform.mark_own_notification_read(UUID, UUID, UUID)
  TO authenticated;

COMMENT ON TABLE
  platform_private.student_portal_overdue_notification_runtime_controls IS
  'Private P6C per-organization switch and live Admin automation owner; absent or enabled=false is disabled.';
COMMENT ON TABLE
  platform_private.student_portal_overdue_transition_state IS
  'Private P6C false-to-true overdue episode state; resolution never deletes history.';
COMMENT ON TABLE
  platform_private.student_portal_overdue_notification_runs IS
  'Private immutable P6C request/result replay and worker audit.';
COMMENT ON TABLE
  platform.student_portal_overdue_notification_projection_v1 IS
  'Deny-by-default P6C source/version binding for safe actor-derived Portal notification projection.';
COMMENT ON FUNCTION
  platform.process_student_portal_overdue_notifications_v1(UUID, TEXT) IS
  'Service-only fixed 50-task then 50-payment overdue transition producer with immutable request replay.';
COMMENT ON FUNCTION platform.student_portal_notifications_v2() IS
  'Returns the current Student actor own safe P6B/P6C notification union.';
COMMENT ON FUNCTION
  platform.mark_own_student_portal_notification_read_v2(UUID, UUID) IS
  'Actor-derived acknowledgement for the current Student own P6B/P6C notification.';

COMMIT;
