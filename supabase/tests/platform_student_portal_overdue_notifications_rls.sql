\set ON_ERROR_STOP on

-- P6C runs only in the disposable authorization database. The fixed clock,
-- tasks, obligation, payments and refund below are synthetic and roll back.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'P6C assertion failed: %', p_message;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_true(BOOLEAN, TEXT)
  TO authenticated, service_role;

SELECT pg_temp.assert_true(
  NOT has_table_privilege(
    'authenticated',
    'platform.student_portal_overdue_notification_projection_v1',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'platform_private.student_portal_overdue_notification_runs',
    'SELECT'
  )
  AND has_function_privilege(
    'service_role',
    'platform.process_student_portal_overdue_notifications_v1(uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'platform.process_student_portal_overdue_notifications_v1(uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'authenticated',
    'platform.student_portal_notifications_v2()',
    'EXECUTE'
  ),
  'private tables and service/public RPC grants must remain least privilege'
);

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
)::TEXT AS p6c_admin_setup_claims
\gset

-- Restore only the disposable Student fixture if an earlier boundary suite
-- intentionally revoked it, then restore its latest current scope grant.
SET request.jwt.claims TO :'p6c_admin_setup_claims';
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
    'Synthetic P6C restore after prior revocation proof',
    '46900000-0000-4000-8000-000000000001'
  )
  ELSE NULL::JSONB
END;
RESET ROLE;

SELECT platform_private.append_scope_event(
  :'org_a_id',
  :'student_a_membership_id',
  :'case_a_scope_id',
  :'case_a_scope_version'::BIGINT,
  TRUE,
  'service',
  NULL,
  'Synthetic P6C current Student case scope grant',
  '46900000-0000-4000-8000-000000000002'
);

SELECT
  profile.auth_user_id AS student_a_user_id,
  profile.access_version AS student_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.id = :'student_a_membership_id'
\gset

SELECT
  student_case.student_membership_id AS student_b_membership_id,
  profile.auth_user_id AS student_b_user_id,
  profile.access_version AS student_b_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = student_case.organization_id
  AND membership.id = student_case.student_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE student_case.organization_id = :'org_a_id'
  AND student_case.source_key = 'synthetic:amocrm:lead:b'
\gset

SELECT
  student_case.organization_id AS org_b_id,
  profile.auth_user_id AS student_org_b_user_id,
  profile.access_version AS student_org_b_access_version
FROM platform.student_cases AS student_case
JOIN platform.organization_memberships AS membership
  ON membership.organization_id = student_case.organization_id
  AND membership.id = student_case.student_membership_id
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE student_case.source_key = 'synthetic:amocrm:lead:org-b'
\gset

SELECT
  membership.id AS finance_a_membership_id,
  profile.auth_user_id AS finance_a_user_id,
  profile.access_version AS finance_a_access_version
FROM platform.organization_memberships AS membership
JOIN platform.profiles AS profile ON profile.id = membership.profile_id
WHERE membership.organization_id = :'org_a_id'
  AND membership.status = 'active'
  AND membership."current_role" = 'finance'
ORDER BY membership.id
LIMIT 1
\gset

SELECT
  jsonb_build_object(
    'sub', :'student_a_user_id', 'role', 'authenticated',
    'platform_role', 'student',
    'platform_access_version', :'student_a_access_version'::BIGINT
  )::TEXT AS student_a_claims,
  jsonb_build_object(
    'sub', :'student_b_user_id', 'role', 'authenticated',
    'platform_role', 'student',
    'platform_access_version', :'student_b_access_version'::BIGINT
  )::TEXT AS student_b_claims,
  jsonb_build_object(
    'sub', :'student_org_b_user_id', 'role', 'authenticated',
    'platform_role', 'student',
    'platform_access_version', :'student_org_b_access_version'::BIGINT
  )::TEXT AS student_org_b_claims,
  jsonb_build_object(
    'sub', :'finance_a_user_id', 'role', 'authenticated',
    'platform_role', 'finance',
    'platform_access_version', :'finance_a_access_version'::BIGINT
  )::TEXT AS finance_a_claims,
  jsonb_build_object('role', 'service_role')::TEXT AS service_claims
\gset

-- The production body remains statement_timestamp(). Replacing this private,
-- revoked helper inside the outer transaction gives deterministic due tests;
-- ROLLBACK restores the production definition.
CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT '2026-08-12T12:00:00Z'::TIMESTAMPTZ
$$;
REVOKE ALL ON FUNCTION platform_private.student_portal_overdue_clock()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

SELECT gen_random_uuid()::TEXT AS p6c_task_id,
       gen_random_uuid()::TEXT AS p6c_obligation_id
\gset

INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, status, student_visible,
  created_by_membership_id
) VALUES (
  :'p6c_task_id', :'org_a_id', :'case_a_id', 'p6c_fixture',
  'Submit synthetic P6C form', :'curator_a_membership_id', 'normal',
  '2026-08-13T12:00:00Z', 'open', TRUE, :'admin_a_membership_id'
);

INSERT INTO platform.payment_obligations (
  id, organization_id, student_case_id, label, category,
  amount_minor, currency, due_at, next_action, created_by_membership_id
) VALUES (
  :'p6c_obligation_id', :'org_a_id', :'case_a_id',
  'Synthetic P6C service payment', 'evo_service_fee',
  10000, 'KGS', '2026-08-13T12:00:00Z',
  'Review the synthetic payment', :'finance_a_membership_id'
);

-- Exact default-off proof: absence of a control still records an immutable
-- zero-result run, but publishes no row.
SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000010',
  'p6c:test-worker'
)::TEXT AS disabled_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'disabled_result'::JSONB ->> 'organizations_processed')::INTEGER = 0
  AND (SELECT count(*) FROM platform.student_portal_overdue_notification_projection_v1) = 0,
  'absent runtime control must fail closed without publication'
);

INSERT INTO platform_private.student_portal_overdue_notification_runtime_controls (
  organization_id, enabled, automation_owner_membership_id
) VALUES (
  :'org_a_id', TRUE, :'admin_a_membership_id'
);

-- Both sources are before due at the fixed clock.
SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000011',
  'p6c:test-worker'
)::TEXT AS before_due_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = :'org_a_id'
      AND (
        (state.source_kind = 'task' AND state.source_record_id = :'p6c_task_id')
        OR (
          state.source_kind = 'payment'
          AND state.source_record_id = :'p6c_obligation_id'
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.student_portal_overdue_notification_projection_v1 AS projection
    WHERE projection.organization_id = :'org_a_id'
      AND (
        (projection.source_kind = 'task' AND projection.source_record_id = :'p6c_task_id')
        OR (
          projection.source_kind = 'payment'
          AND projection.source_record_id = :'p6c_obligation_id'
        )
      )
  ),
  'before-due P6C sources must not synthesize state or notifications'
);

-- Advance only the private disposable clock. Payment obligation identity,
-- including due_at and totals, remains immutable and later changes only
-- through the accepted payment-event RPC.
CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT '2026-08-14T12:00:00Z'::TIMESTAMPTZ
$$;
REVOKE ALL ON FUNCTION platform_private.student_portal_overdue_clock()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000012',
  'p6c:test-worker'
)::TEXT AS first_overdue_result
\gset
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000012',
  'p6c:test-worker'
)::TEXT AS replay_result
\gset
SAVEPOINT expect_replay_worker_mismatch;
\set ON_ERROR_STOP off
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000012',
  'p6c:changed-worker'
);
\set replay_worker_mismatch_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_replay_worker_mismatch;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_replay_worker_mismatch;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000013',
  'p6c:test-worker'
)::TEXT AS duplicate_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  (:'first_overdue_result'::JSONB ->> 'task_published')::INTEGER >= 1
  AND (:'first_overdue_result'::JSONB ->> 'payment_published')::INTEGER >= 1
  AND :'replay_result'::JSONB = :'first_overdue_result'::JSONB
  AND :'replay_worker_mismatch_state' = '22023'
  AND (
    SELECT count(*)
    FROM platform_private.student_portal_overdue_notification_runs
    WHERE request_id = '46900000-0000-4000-8000-000000000012'
  ) = 1
  AND (
    SELECT count(*)
    FROM platform.student_portal_overdue_notification_projection_v1
    WHERE organization_id = :'org_a_id'
      AND transition_version = 1
      AND (
        (source_kind = 'task' AND source_record_id = :'p6c_task_id')
        OR (
          source_kind = 'payment'
          AND source_record_id = :'p6c_obligation_id'
        )
      )
  ) = 2,
  'first P6C episodes, immutable exact replay and a later run must remain deterministic'
);

SAVEPOINT expect_projection_update_denied;
\set ON_ERROR_STOP off
UPDATE platform.student_portal_overdue_notification_projection_v1
SET detail = detail || ' changed'
WHERE source_record_id = :'p6c_task_id';
\set projection_update_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_projection_update_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_projection_update_denied;

SAVEPOINT expect_run_delete_denied;
\set ON_ERROR_STOP off
DELETE FROM platform_private.student_portal_overdue_notification_runs
WHERE request_id = '46900000-0000-4000-8000-000000000012';
\set run_delete_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_run_delete_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_run_delete_denied;

SAVEPOINT expect_projection_truncate_denied;
\set ON_ERROR_STOP off
TRUNCATE TABLE platform.student_portal_overdue_notification_projection_v1;
\set projection_truncate_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_projection_truncate_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_projection_truncate_denied;
SELECT pg_temp.assert_true(
  :'projection_update_state' = '55000'
  AND :'run_delete_state' = '55000'
  AND :'projection_truncate_state' = '55000',
  'run audit and overdue projection must reject update/delete/truncate mutation'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1
    FROM platform.student_portal_overdue_notification_projection_v1
    WHERE organization_id = :'org_a_id'
      AND source_kind = 'task'
      AND source_record_id = :'p6c_task_id'
      AND transition_version = 1
  )
  AND EXISTS (
    SELECT 1
    FROM platform.student_portal_overdue_notification_projection_v1
    WHERE organization_id = :'org_a_id'
      AND source_kind = 'payment'
      AND source_record_id = :'p6c_obligation_id'
      AND transition_version = 1
  ),
  'the fixed producer must cover task then payment sources in one run'
);

-- Partial confirmed payment preserves the same active payment episode.
SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT (
  platform.record_payment_event(
    :'org_a_id', :'p6c_obligation_id', 'payment', NULL, 3000, 'KGS',
    '2026-08-12T10:00:00Z', 'synthetic:p6c:payment:partial',
    'synthetic:p6c:evidence:payment:partial', 'Synthetic partial payment',
    '46900000-0000-4000-8000-000000000020'
  ) ->> 'payment_event_id'
)::TEXT AS p6c_partial_payment_id
\gset
RESET ROLE;

SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000021', 'p6c:test-worker'
)::TEXT AS partial_result
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  (:'partial_result'::JSONB ->> 'payment_published')::INTEGER = 0
  AND (:'partial_result'::JSONB ->> 'payment_resolved')::INTEGER = 0,
  'partial payment must leave the existing overdue episode active'
);

-- Completion/full settlement resolves both states without deleting history.
SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT (
  platform.record_payment_event(
    :'org_a_id', :'p6c_obligation_id', 'payment', NULL, 7000, 'KGS',
    '2026-08-12T10:30:00Z', 'synthetic:p6c:payment:final',
    'synthetic:p6c:evidence:payment:final', 'Synthetic full settlement',
    '46900000-0000-4000-8000-000000000022'
  ) ->> 'payment_event_id'
)::TEXT AS p6c_final_payment_id
\gset
RESET ROLE;
UPDATE platform.case_tasks
SET due_at = NULL
WHERE organization_id = :'org_a_id' AND id = :'p6c_task_id';

SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000023', 'p6c:test-worker'
)::TEXT AS resolved_result
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  (:'resolved_result'::JSONB ->> 'task_resolved')::INTEGER >= 1
  AND (:'resolved_result'::JSONB ->> 'payment_resolved')::INTEGER >= 1
  AND (
    SELECT count(*)
    FROM platform_private.student_portal_overdue_transition_state
    WHERE organization_id = :'org_a_id'
      AND NOT is_overdue
      AND resolved_at IS NOT NULL
      AND (
        (source_kind = 'task' AND source_record_id = :'p6c_task_id')
        OR (
          source_kind = 'payment'
          AND source_record_id = :'p6c_obligation_id'
        )
      )
  ) = 2
  AND (
    SELECT observed_due_at = '2026-08-13T12:00:00Z'::TIMESTAMPTZ
    FROM platform_private.student_portal_overdue_transition_state
    WHERE source_kind = 'task' AND source_record_id = :'p6c_task_id'
  )
  AND (
    SELECT count(*)
    FROM platform.student_portal_overdue_notification_projection_v1
    WHERE organization_id = :'org_a_id'
      AND (
        (source_kind = 'task' AND source_record_id = :'p6c_task_id')
        OR (
          source_kind = 'payment'
          AND source_record_id = :'p6c_obligation_id'
        )
      )
  ) = 2,
  'due removal/full settlement must resolve without losing the last due or projection history'
);

-- Evidence-backed refund and task reopen create episode version two.
SET request.jwt.claims TO :'finance_a_claims';
SET ROLE authenticated;
SELECT platform.record_payment_event(
  :'org_a_id', :'p6c_obligation_id', 'refund', :'p6c_final_payment_id',
  1000, 'KGS', '2026-08-12T11:00:00Z',
  'synthetic:p6c:refund:reopen', 'synthetic:p6c:evidence:refund:reopen',
  'Synthetic evidence-backed refund',
  '46900000-0000-4000-8000-000000000024'
);
RESET ROLE;
UPDATE platform.case_tasks
SET due_at = '2026-08-11T12:00:00Z', status = 'open'
WHERE organization_id = :'org_a_id' AND id = :'p6c_task_id';

SET request.jwt.claims TO :'service_claims';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '46900000-0000-4000-8000-000000000025', 'p6c:test-worker'
)::TEXT AS reopened_result
\gset
RESET ROLE;
SELECT pg_temp.assert_true(
  (:'reopened_result'::JSONB ->> 'task_published')::INTEGER >= 1
  AND (:'reopened_result'::JSONB ->> 'payment_published')::INTEGER >= 1
  AND (
    SELECT bool_and(transition_version = 2 AND is_overdue)
    FROM platform_private.student_portal_overdue_transition_state
    WHERE organization_id = :'org_a_id'
      AND (
        (source_kind = 'task' AND source_record_id = :'p6c_task_id')
        OR (
          source_kind = 'payment'
          AND source_record_id = :'p6c_obligation_id'
        )
      )
  )
  AND (
    SELECT count(*)
    FROM platform.student_portal_overdue_notification_projection_v1
    WHERE organization_id = :'org_a_id'
      AND (
        (source_kind = 'task' AND source_record_id = :'p6c_task_id')
        OR (
          source_kind = 'payment'
          AND source_record_id = :'p6c_obligation_id'
        )
      )
  ) = 4,
  'reopened false-to-true transitions must publish exactly episode version two'
);

SELECT notification_id::TEXT AS p6c_task_notification_id
FROM platform.student_portal_overdue_notification_projection_v1
WHERE organization_id = :'org_a_id'
  AND source_kind = 'task'
  AND transition_version = 2
\gset

SET request.jwt.claims TO :'student_a_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_notifications_v2()
    WHERE category = 'task.overdue'
      AND event_code = 'overdue'
      AND subject_label = 'Submit synthetic P6C form'
      AND due_at IS NOT NULL) = 2
  AND (SELECT count(*) FROM platform.student_portal_notifications_v2()
    WHERE category = 'payment.overdue'
      AND event_code = 'overdue'
      AND subject_label = 'Synthetic P6C service payment'
      AND due_at IS NOT NULL) = 2,
  'Student A must see only safe actor-derived v2 overdue rows'
);
SAVEPOINT expect_legacy_ack_denied;
\set ON_ERROR_STOP off
SELECT platform.mark_own_notification_read(
  :'org_a_id', :'p6c_task_notification_id',
  '46900000-0000-4000-8000-000000000030'
);
\set legacy_ack_state :SQLSTATE
ROLLBACK TO SAVEPOINT expect_legacy_ack_denied;
\set ON_ERROR_STOP on
RELEASE SAVEPOINT expect_legacy_ack_denied;
SELECT platform.mark_own_student_portal_notification_read_v2(
  :'p6c_task_notification_id',
  '46900000-0000-4000-8000-000000000031'
)::TEXT AS p6c_ack_result
\gset
RESET ROLE;

SELECT pg_temp.assert_true(
  :'legacy_ack_state' = '42501'
  AND (:'p6c_ack_result'::JSONB ->> 'is_read')::BOOLEAN
  AND (
    SELECT read_at IS NOT NULL
    FROM platform.notifications
    WHERE id = :'p6c_task_notification_id'
  ),
  'legacy ack must reject P6C while v2 persists actor-derived read state'
);

SET request.jwt.claims TO :'student_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_notifications_v2()
    WHERE category IN ('task.overdue', 'payment.overdue')) = 0,
  'same-organization Student B must not see Student A notifications'
);
RESET ROLE;

SET request.jwt.claims TO :'student_org_b_claims';
SET ROLE authenticated;
SELECT pg_temp.assert_true(
  (SELECT count(*) FROM platform.student_portal_notifications_v2()
    WHERE category IN ('task.overdue', 'payment.overdue')) = 0,
  'cross-organization Student must not see Student A notifications'
);
RESET ROLE;

SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1
    FROM platform.notification_delivery_intents AS intent
    JOIN platform.student_portal_overdue_notification_projection_v1 AS projection
      ON projection.organization_id = intent.organization_id
      AND projection.notification_id = intent.notification_id
  )
  AND (
    SELECT count(*)
    FROM platform.notification_events AS event
    JOIN platform.student_portal_overdue_notification_projection_v1 AS projection
      ON projection.organization_id = event.organization_id
      AND projection.notification_id = event.notification_id
    WHERE event.event_type = 'created'
      AND projection.organization_id = :'org_a_id'
      AND (
        (projection.source_kind = 'task' AND projection.source_record_id = :'p6c_task_id')
        OR (
          projection.source_kind = 'payment'
          AND projection.source_record_id = :'p6c_obligation_id'
        )
      )
  ) = 4,
  'P6C must create in-app rows/events only and no delivery intent'
);

RESET request.jwt.claims;
ROLLBACK;
