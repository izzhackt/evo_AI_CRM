\set ON_ERROR_STOP on

-- This helper is intentionally invoked in two phases by the disposable
-- PostgreSQL authorization harness. The worker calls themselves run in two
-- separate psql processes between these phases, so the proof exercises real
-- row-lock/SKIP LOCKED behavior rather than two calls in one transaction.

\if :{?p6c_concurrency_setup}

BEGIN;

SELECT
  student_case.organization_id AS org_a_id,
  student_case.id AS case_a_id,
  student_case.student_membership_id AS student_a_membership_id,
  student_case.current_curator_membership_id AS curator_a_membership_id,
  student_case.current_scope_id AS case_a_scope_id,
  student_case.current_scope_version AS case_a_scope_version
FROM platform.student_cases AS student_case
WHERE student_case.source_key = 'synthetic:amocrm:lead:a'
\gset

SELECT
  membership.id AS admin_a_membership_id,
  profile.auth_user_id AS admin_a_user_id,
  profile.access_version AS admin_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'admin'
ORDER BY membership.id
LIMIT 1
\gset

SELECT jsonb_build_object(
  'sub', :'admin_a_user_id',
  'role', 'authenticated',
  'platform_role', 'admin',
  'platform_access_version', :'admin_a_access_version'::BIGINT
)::TEXT AS p6c_concurrency_admin_claims
\gset

-- Earlier migration-boundary suites deliberately exercise revocation. Restore
-- only the existing disposable Student fixture needed by this proof.
SET request.jwt.claims TO :'p6c_concurrency_admin_claims';
SET ROLE authenticated;
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM platform.organization_memberships AS membership
    WHERE membership.organization_id = :'org_a_id'
      AND membership.id = :'student_a_membership_id'
      AND membership.status <> 'active'
  )
  THEN platform.change_membership_status(
    :'org_a_id',
    :'student_a_membership_id',
    'active',
    'Synthetic P6C concurrent-worker fixture restore',
    '46906900-0000-4000-8000-000000000001'
  )
  ELSE NULL::JSONB
END;
RESET ROLE;
RESET request.jwt.claims;

SELECT platform_private.append_scope_event(
  :'org_a_id',
  :'student_a_membership_id',
  :'case_a_scope_id',
  :'case_a_scope_version'::BIGINT,
  TRUE,
  'service',
  NULL,
  'Synthetic P6C concurrent-worker current scope grant',
  '46906900-0000-4000-8000-000000000002'
);

INSERT INTO platform.case_tasks (
  id,
  organization_id,
  student_case_id,
  task_type,
  title,
  assignee_membership_id,
  priority,
  due_at,
  status,
  student_visible,
  created_by_membership_id
) VALUES (
  '46906900-0000-4000-8000-000000000010',
  :'org_a_id',
  :'case_a_id',
  'p6c_concurrency_fixture',
  'Synthetic concurrent overdue task',
  :'curator_a_membership_id',
  'normal',
  '2000-01-01T00:00:00Z',
  'open',
  TRUE,
  :'admin_a_membership_id'
);

INSERT INTO platform_private.student_portal_overdue_notification_runtime_controls (
  organization_id,
  enabled,
  automation_owner_membership_id
) VALUES (
  :'org_a_id',
  TRUE,
  :'admin_a_membership_id'
);

COMMIT;

\elif :{?p6c_concurrency_assert}

DO $$
DECLARE
  worker_a_completed_at TIMESTAMPTZ;
  worker_b_completed_at TIMESTAMPTZ;
BEGIN
  SELECT run.completed_at
  INTO worker_a_completed_at
  FROM platform_private.student_portal_overdue_notification_runs AS run
  WHERE run.request_id = '46906900-0000-4000-8000-000000000020'
    AND run.worker_id = 'p6c:concurrent-a'
    AND run.status = 'completed'
    AND run.organizations_processed = 1
    AND run.task_published >= 1;

  IF worker_a_completed_at IS NULL THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: lock-owning worker audit is missing';
  END IF;

  SELECT run.completed_at
  INTO worker_b_completed_at
  FROM platform_private.student_portal_overdue_notification_runs AS run
  WHERE run.request_id = '46906900-0000-4000-8000-000000000021'
    AND run.worker_id = 'p6c:concurrent-b'
    AND run.status = 'completed'
    AND run.organizations_processed = 0
    AND run.task_candidates = 0
    AND run.task_published = 0
    AND run.task_resolved = 0
    AND run.payment_candidates = 0
    AND run.payment_published = 0
    AND run.payment_resolved = 0;

  IF worker_b_completed_at IS NULL THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: overlapping worker did not fail closed';
  END IF;

  -- The shell harness proves temporal overlap by observing the readiness lock,
  -- waiting for B to return, and then verifying A is still alive. Do not order
  -- these rows by statement_timestamp(): psql sends A's multi-statement -c
  -- input as one query message, so A's run can retain that message's pre-sleep
  -- statement timestamp even though its processor call executes after B.

  IF (
    SELECT count(*)
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.source_kind = 'task'
      AND state.source_record_id =
        '46906900-0000-4000-8000-000000000010'
      AND state.is_overdue
      AND state.transition_version = 1
  ) <> 1 THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: expected one version-1 transition';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.student_portal_overdue_notification_projection_v1 AS projection
    WHERE projection.source_kind = 'task'
      AND projection.source_record_id =
        '46906900-0000-4000-8000-000000000010'
      AND projection.transition_version = 1
  ) <> 1 THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: expected one version-1 projection';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.notifications AS notification
    JOIN platform.student_portal_overdue_notification_projection_v1 AS projection
      ON projection.organization_id = notification.organization_id
      AND projection.notification_id = notification.id
    WHERE projection.source_kind = 'task'
      AND projection.source_record_id =
        '46906900-0000-4000-8000-000000000010'
  ) <> 1 THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: expected one notification';
  END IF;

  IF (
    SELECT count(*)
    FROM platform.notification_events AS event
    JOIN platform.student_portal_overdue_notification_projection_v1 AS projection
      ON projection.organization_id = event.organization_id
      AND projection.notification_id = event.notification_id
    WHERE projection.source_kind = 'task'
      AND projection.source_record_id =
        '46906900-0000-4000-8000-000000000010'
      AND event.event_type = 'created'
  ) <> 1 THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: expected one created event';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM platform.notification_delivery_intents AS intent
    JOIN platform.student_portal_overdue_notification_projection_v1 AS projection
      ON projection.organization_id = intent.organization_id
      AND projection.notification_id = intent.notification_id
    WHERE projection.source_kind = 'task'
      AND projection.source_record_id =
        '46906900-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: overdue row created a delivery intent';
  END IF;

  IF (
    SELECT count(*)
    FROM platform_private.student_portal_overdue_notification_runs AS run
    WHERE run.request_id IN (
      '46906900-0000-4000-8000-000000000020',
      '46906900-0000-4000-8000-000000000021'
    )
  ) <> 2 THEN
    RAISE EXCEPTION
      'P6C concurrency assertion failed: expected two durable run audits';
  END IF;
END
$$;

\else
\echo 'Set p6c_concurrency_setup=1 or p6c_concurrency_assert=1.'
\quit 3
\endif
