\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 110. All data is synthetic and
-- rolled back; no managed Supabase project is touched.
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p110_assert(
  p_condition BOOLEAN,
  p_message TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 110 assertion failed: %', p_message;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.p110_capture_error(p_statement TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE p_statement;
  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    );
END
$$;

GRANT EXECUTE ON FUNCTION pg_temp.p110_assert(BOOLEAN, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.p110_capture_error(TEXT)
  TO authenticated;

DO $catalog_contract$
DECLARE
  routine_oid OID;
  routine_count INTEGER;
  forbidden_role TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'platform'
      AND table_name = 'case_tasks'
      AND column_name = 'due_on'
      AND data_type = 'date'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'platform.case_tasks.due_on DATE is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'platform.case_tasks'::REGCLASS
      AND constraint_row.conname = 'case_tasks_single_deadline_kind_check'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%due_at IS NULL%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%due_on IS NULL%'
  ) THEN
    RAISE EXCEPTION 'single deadline-kind constraint is missing';
  END IF;

  IF to_regclass('platform.case_tasks_student_overdue_scan_idx') IS NOT NULL
    OR to_regclass('platform.case_tasks_student_timed_overdue_scan_idx') IS NULL
    OR to_regclass('platform.case_tasks_student_all_day_overdue_scan_idx') IS NULL
  THEN
    RAISE EXCEPTION 'case task overdue indexes do not match migration 110';
  END IF;

  SELECT count(*), (array_agg(routine.oid))[1]
  INTO routine_count, routine_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'platform'
    AND routine.proname = 'create_case_task';

  IF routine_count <> 1
    OR routine_oid IS NULL
    OR pg_get_function_identity_arguments(routine_oid) <>
      'p_organization_id uuid, p_student_case_id uuid, p_task_type text, p_title text, p_assignee_membership_id uuid, p_priority platform.case_task_priority, p_due_at timestamp with time zone, p_due_on date, p_status platform.case_task_status, p_student_visible boolean, p_expected_version bigint, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'create_case_task signature drifted';
  END IF;
  IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lacks create_case_task execute';
  END IF;
  FOREACH forbidden_role IN ARRAY ARRAY[
    'anon', 'service_role', 'supabase_auth_admin'
  ] LOOP
    IF has_function_privilege(forbidden_role, routine_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% unexpectedly executes create_case_task', forbidden_role;
    END IF;
  END LOOP;

  SELECT count(*), (array_agg(routine.oid))[1]
  INTO routine_count, routine_oid
  FROM pg_catalog.pg_proc AS routine
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = 'platform'
    AND routine.proname = 'change_case_task';

  IF routine_count <> 1
    OR routine_oid IS NULL
    OR pg_get_function_identity_arguments(routine_oid) <>
      'p_organization_id uuid, p_case_task_id uuid, p_new_status platform.case_task_status, p_new_assignee_membership_id uuid, p_priority platform.case_task_priority, p_due_at timestamp with time zone, p_due_on date, p_student_visible boolean, p_expected_version bigint, p_request_id uuid'
  THEN
    RAISE EXCEPTION 'change_case_task signature drifted';
  END IF;
  IF NOT has_function_privilege('authenticated', routine_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lacks change_case_task execute';
  END IF;
END
$catalog_contract$;

SELECT bundle.id AS p110_admin_bundle, bundle.version AS p110_admin_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'admin' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p110_sales_bundle, bundle.version AS p110_sales_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'sales' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p110_curator_bundle, bundle.version AS p110_curator_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'curator' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset
SELECT bundle.id AS p110_student_bundle, bundle.version AS p110_student_version
FROM platform.role_bundle_versions AS bundle
WHERE bundle.role = 'student' AND bundle.status = 'published'
ORDER BY bundle.version DESC
LIMIT 1
\gset

\set p110_org 59911000-0000-4000-8000-000000000001
\set p110_org_scope 59911000-0000-4000-8000-000000000002
\set p110_case_scope 59911000-0000-4000-8000-000000000003
\set p110_case 59911000-0000-4000-8000-000000000004
\set p110_admin_user 59911000-0000-4000-8000-000000000011
\set p110_sales_user 59911000-0000-4000-8000-000000000012
\set p110_curator_user 59911000-0000-4000-8000-000000000013
\set p110_student_user 59911000-0000-4000-8000-000000000014
\set p110_admin_profile 59911000-0000-4000-8000-000000000021
\set p110_sales_profile 59911000-0000-4000-8000-000000000022
\set p110_curator_profile 59911000-0000-4000-8000-000000000023
\set p110_student_profile 59911000-0000-4000-8000-000000000024
\set p110_admin_membership 59911000-0000-4000-8000-000000000031
\set p110_sales_membership 59911000-0000-4000-8000-000000000032
\set p110_curator_membership 59911000-0000-4000-8000-000000000033
\set p110_student_membership 59911000-0000-4000-8000-000000000034

INSERT INTO platform.organizations (id, name)
VALUES (:'p110_org', 'Migration 110 Organization');

INSERT INTO platform.record_scopes (
  id, organization_id, scope_kind, scope_key, scope_version
) VALUES
  (:'p110_org_scope', :'p110_org', 'organization', :'p110_org', 1),
  (:'p110_case_scope', :'p110_org', 'student_case', :'p110_case', 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'p110_admin_user', 'p110-admin@example.invalid', '{}'::JSONB),
  (:'p110_sales_user', 'p110-sales@example.invalid', '{}'::JSONB),
  (:'p110_curator_user', 'p110-curator@example.invalid', '{}'::JSONB),
  (:'p110_student_user', 'p110-student@example.invalid', '{}'::JSONB);

INSERT INTO platform.profiles (
  id, auth_user_id, display_name, status, access_version
) VALUES
  (:'p110_admin_profile', :'p110_admin_user', 'Migration 110 Admin', 'active', 1),
  (:'p110_sales_profile', :'p110_sales_user', 'Migration 110 Sales', 'active', 1),
  (:'p110_curator_profile', :'p110_curator_user', 'Migration 110 Curator', 'active', 1),
  (:'p110_student_profile', :'p110_student_user', 'Migration 110 Student', 'active', 1);

INSERT INTO platform.organization_memberships (
  id, organization_id, profile_id, status, "current_role", current_bundle_id
) VALUES
  (:'p110_admin_membership', :'p110_org', :'p110_admin_profile', 'active', 'admin', :'p110_admin_bundle'),
  (:'p110_sales_membership', :'p110_org', :'p110_sales_profile', 'active', 'sales', :'p110_sales_bundle'),
  (:'p110_curator_membership', :'p110_org', :'p110_curator_profile', 'active', 'curator', :'p110_curator_bundle'),
  (:'p110_student_membership', :'p110_org', :'p110_student_profile', 'active', 'student', :'p110_student_bundle');

INSERT INTO platform.membership_scope_assignments (
  id, organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, actor_profile_id, reason, request_id
) VALUES
  ('59911000-0000-4000-8000-000000000041', :'p110_org', :'p110_admin_membership', :'p110_org_scope', 1, 1, TRUE, 'system', NULL, 'Migration 110 Admin org scope', '59911000-0000-4000-8000-000000000141'),
  ('59911000-0000-4000-8000-000000000042', :'p110_org', :'p110_sales_membership', :'p110_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 110 Sales case scope', '59911000-0000-4000-8000-000000000142'),
  ('59911000-0000-4000-8000-000000000043', :'p110_org', :'p110_curator_membership', :'p110_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 110 Curator case scope', '59911000-0000-4000-8000-000000000143'),
  ('59911000-0000-4000-8000-000000000044', :'p110_org', :'p110_student_membership', :'p110_case_scope', 1, 1, TRUE, 'system', NULL, 'Migration 110 Student case scope', '59911000-0000-4000-8000-000000000144');

INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id,
  source_key, contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, program_direction,
  intake, route_approval_status, operational_stage, state, handoff_at,
  portal_activated_at, next_action, current_scope_id, current_scope_version
) VALUES (
  :'p110_case', :'p110_org', :'p110_student_membership',
  :'p110_sales_membership', NULL,
  'synthetic:p110:case', 'contract:p110', '2026-09-04T09:00:00Z',
  'Migration 110 Student', 'United Kingdom', 'Bachelor', 'Business',
  '2027', 'approved', 'contract_confirmed', 'pending',
  NULL, NULL,
  'Verify all-day deadlines', :'p110_case_scope', 1
);

SELECT jsonb_build_object(
  'sub', :'p110_admin_user', 'role', 'authenticated',
  'platform_role', 'admin', 'platform_access_version', 1,
  'platform_organization_id', :'p110_org',
  'platform_membership_id', :'p110_admin_membership',
  'platform_bundle_id', :'p110_admin_bundle',
  'platform_bundle_version', :'p110_admin_version'::INTEGER
)::TEXT AS p110_admin_claims
\gset
SET request.jwt.claims TO :'p110_admin_claims';
SET ROLE authenticated;

SELECT platform.assign_student_case_curator(
  :'p110_org',
  :'p110_case',
  :'p110_curator_membership',
  'Activate the isolated migration 110 case through the real lifecycle',
  '59911000-0000-4000-8000-000000000145'
);

RESET ROLE;
SELECT jsonb_build_object(
  'sub', :'p110_sales_user', 'role', 'authenticated',
  'platform_role', 'sales',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p110_org',
  'platform_membership_id', :'p110_sales_membership',
  'platform_bundle_id', :'p110_sales_bundle',
  'platform_bundle_version', :'p110_sales_version'::INTEGER
)::TEXT AS p110_sales_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p110_sales_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p110_curator_user', 'role', 'authenticated',
  'platform_role', 'curator',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p110_org',
  'platform_membership_id', :'p110_curator_membership',
  'platform_bundle_id', :'p110_curator_bundle',
  'platform_bundle_version', :'p110_curator_version'::INTEGER
)::TEXT AS p110_curator_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p110_curator_profile'
\gset
SELECT jsonb_build_object(
  'sub', :'p110_student_user', 'role', 'authenticated',
  'platform_role', 'student',
  'platform_access_version', profile.access_version,
  'platform_organization_id', :'p110_org',
  'platform_membership_id', :'p110_student_membership',
  'platform_bundle_id', :'p110_student_bundle',
  'platform_bundle_version', :'p110_student_version'::INTEGER
)::TEXT AS p110_student_claims
FROM platform.profiles AS profile
WHERE profile.id = :'p110_student_profile'
\gset

SET request.jwt.claims TO :'p110_admin_claims';
SET ROLE authenticated;

SELECT platform.create_case_task(
  p_organization_id => :'p110_org',
  p_student_case_id => :'p110_case',
  p_task_type => 'deadline',
  p_title => 'All-day task',
  p_assignee_membership_id => :'p110_curator_membership',
  p_priority => 'high',
  p_due_at => NULL,
  p_due_on => '2026-09-04',
  p_status => 'open',
  p_student_visible => TRUE,
  p_expected_version => 0,
  p_request_id => '59911000-0000-4000-8000-000000000201'
)::TEXT AS p110_all_day_create
\gset
SELECT :'p110_all_day_create'::JSONB ->> 'case_task_id' AS p110_all_day_task
\gset

SELECT platform.create_case_task(
  :'p110_org', :'p110_case', 'deadline', 'All-day task',
  :'p110_curator_membership', 'high', NULL, '2026-09-04', 'open', TRUE, 0,
  '59911000-0000-4000-8000-000000000201'
)::TEXT AS p110_all_day_replay
\gset

SELECT platform.create_case_task(
  :'p110_org', :'p110_case', 'deadline', 'Timed task',
  :'p110_curator_membership', 'normal', '2026-09-04T17:30:00Z', NULL,
  'open', TRUE, 0, '59911000-0000-4000-8000-000000000202'
)::TEXT AS p110_timed_create
\gset
SELECT :'p110_timed_create'::JSONB ->> 'case_task_id' AS p110_timed_task
\gset

SELECT platform.create_case_task(
  :'p110_org', :'p110_case', 'follow_up', 'Unscheduled task',
  :'p110_curator_membership', 'low', NULL, NULL, 'open', TRUE, 0,
  '59911000-0000-4000-8000-000000000203'
)::TEXT AS p110_unscheduled_create
\gset
SELECT :'p110_unscheduled_create'::JSONB ->> 'case_task_id' AS p110_unscheduled_task
\gset

SELECT pg_temp.p110_capture_error(format(
  'SELECT platform.create_case_task(%L::UUID, %L::UUID, %L, %L, %L::UUID, '
    || '%L::platform.case_task_priority, %L::TIMESTAMPTZ, %L::DATE, '
    || '%L::platform.case_task_status, TRUE, 0, %L::UUID)',
  :'p110_org', :'p110_case', 'deadline', 'Invalid dual deadline',
  :'p110_curator_membership', 'normal', '2026-09-04T17:00:00Z',
  '2026-09-04', 'open', '59911000-0000-4000-8000-000000000204'
))::TEXT AS p110_both_error
\gset

SELECT platform.change_case_task(
  :'p110_org', :'p110_all_day_task', 'in_progress',
  :'p110_curator_membership', 'high', NULL, '2026-09-05', TRUE, 1,
  '59911000-0000-4000-8000-000000000205'
)::TEXT AS p110_change
\gset
SELECT platform.change_case_task(
  :'p110_org', :'p110_all_day_task', 'in_progress',
  :'p110_curator_membership', 'high', NULL, '2026-09-05', TRUE, 1,
  '59911000-0000-4000-8000-000000000205'
)::TEXT AS p110_change_replay
\gset

SELECT pg_temp.p110_capture_error(format(
  'SELECT platform.change_case_task(%L::UUID, %L::UUID, '
    || '%L::platform.case_task_status, %L::UUID, '
    || '%L::platform.case_task_priority, NULL, %L::DATE, TRUE, 2, %L::UUID)',
  :'p110_org', :'p110_all_day_task', 'in_progress',
  :'p110_curator_membership', 'high', '2026-09-05',
  '59911000-0000-4000-8000-000000000206'
))::TEXT AS p110_noop_error
\gset
SELECT pg_temp.p110_capture_error(format(
  'SELECT platform.change_case_task(%L::UUID, %L::UUID, '
    || '%L::platform.case_task_status, %L::UUID, '
    || '%L::platform.case_task_priority, NULL, %L::DATE, TRUE, 1, %L::UUID)',
  :'p110_org', :'p110_all_day_task', 'done',
  :'p110_curator_membership', 'high', '2026-09-06',
  '59911000-0000-4000-8000-000000000207'
))::TEXT AS p110_stale_error
\gset

SELECT platform.change_case_task(
  :'p110_org', :'p110_all_day_task', 'in_progress',
  :'p110_curator_membership', 'high', NULL, '2026-09-04', TRUE, 2,
  '59911000-0000-4000-8000-000000000208'
);

SELECT pg_temp.p110_assert(
  :'p110_all_day_create'::JSONB = :'p110_all_day_replay'::JSONB
    AND :'p110_all_day_create'::JSONB ->> 'due_on' = '2026-09-04'
    AND :'p110_all_day_create'::JSONB -> 'due_at' = 'null'::JSONB
    AND :'p110_timed_create'::JSONB ->> 'due_at'
      = '2026-09-04T17:30:00+00:00'
    AND :'p110_timed_create'::JSONB -> 'due_on' = 'null'::JSONB
    AND :'p110_unscheduled_create'::JSONB -> 'due_at' = 'null'::JSONB
    AND :'p110_unscheduled_create'::JSONB -> 'due_on' = 'null'::JSONB
    AND :'p110_both_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p110_change'::JSONB = :'p110_change_replay'::JSONB
    AND :'p110_change'::JSONB ->> 'version' = '2'
    AND :'p110_change'::JSONB ->> 'due_on' = '2026-09-05'
    AND :'p110_noop_error'::JSONB ->> 'sqlstate' = '22023'
    AND :'p110_noop_error'::JSONB ->> 'message'
      = 'Task mutation must change at least one field'
    AND :'p110_stale_error'::JSONB ->> 'sqlstate' = 'PT409'
    AND (
      SELECT count(*)
      FROM platform.case_task_events AS event
      WHERE event.organization_id = :'p110_org'
        AND event.case_task_id = :'p110_all_day_task'
    ) = 2,
  'deadline kinds, replay, version and no-op behavior drifted'
);

SELECT pg_temp.p110_capture_error(
  'SELECT * FROM platform.staff_case_task_queue(10)'
)::TEXT AS p110_admin_queue_error
\gset
SELECT pg_temp.p110_assert(
  :'p110_admin_queue_error'::JSONB ->> 'ok' = 'true',
  'Admin must read the task queue'
);

SELECT pg_temp.p110_assert(
  (
    SELECT array_agg(queue.case_task_id ORDER BY queue.sort_at, queue.case_task_id)
    FROM platform.staff_case_task_queue(10) AS queue
    WHERE queue.case_task_id IN (
      :'p110_all_day_task', :'p110_timed_task', :'p110_unscheduled_task'
    )
  ) = ARRAY[
    :'p110_all_day_task'::UUID,
    :'p110_timed_task'::UUID,
    :'p110_unscheduled_task'::UUID
  ],
  'staff queue must sort all-day at local-day start, then timed, then null'
);

SELECT pg_temp.p110_assert(
  (
    SELECT workspace -> 'tasks' -> 0 ->> 'case_task_id'
    FROM (
      SELECT platform.staff_student_case_task_workspace(:'p110_case') AS workspace
    ) AS projected
  ) = :'p110_all_day_task'
    AND (
      SELECT workspace -> 'tasks' -> 0 ->> 'due_on'
      FROM (
        SELECT platform.staff_student_case_task_workspace(:'p110_case') AS workspace
      ) AS projected
    ) = '2026-09-04',
  'case workspace must expose and sort the all-day deadline'
);

RESET ROLE;
SET request.jwt.claims TO :'p110_curator_claims';
SET ROLE authenticated;
SELECT platform.create_case_task(
  :'p110_org', :'p110_case', 'follow_up', 'Curator-owned task',
  :'p110_curator_membership', 'normal', NULL, NULL, 'open', FALSE, 0,
  '59911000-0000-4000-8000-000000000209'
);

RESET ROLE;
SET request.jwt.claims TO :'p110_sales_claims';
SET ROLE authenticated;
SELECT pg_temp.p110_capture_error(format(
  'SELECT platform.create_case_task(%L::UUID, %L::UUID, %L, %L, %L::UUID, '
    || '%L::platform.case_task_priority, NULL, %L::DATE, '
    || '%L::platform.case_task_status, FALSE, 0, %L::UUID)',
  :'p110_org', :'p110_case', 'follow_up', 'Forbidden Sales task',
  :'p110_sales_membership', 'normal', '2026-09-04', 'open',
  '59911000-0000-4000-8000-000000000210'
))::TEXT AS p110_sales_create_error
\gset
SELECT pg_temp.p110_capture_error(
  'SELECT * FROM platform.staff_case_task_queue(10)'
)::TEXT AS p110_sales_queue_error
\gset
SELECT pg_temp.p110_assert(
  :'p110_sales_create_error'::JSONB ->> 'sqlstate' = '42501'
    AND :'p110_sales_queue_error'::JSONB ->> 'sqlstate' = '42501',
  'Sales must be denied the Admissions task mutation and queue'
);

RESET ROLE;
SET request.jwt.claims TO :'p110_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p110_assert(
  (
    SELECT array_agg(task.case_task_id ORDER BY
      CASE
        WHEN task.due_at IS NOT NULL THEN task.due_at
        WHEN task.due_on IS NOT NULL THEN
          task.due_on::TIMESTAMP AT TIME ZONE 'Asia/Bishkek'
        ELSE '9999-12-31 00:00:00+00'::TIMESTAMPTZ
      END,
      task.case_task_id
    )
    FROM platform.student_portal_tasks() AS task
  ) = ARRAY[
    :'p110_all_day_task'::UUID,
    :'p110_timed_task'::UUID,
    :'p110_unscheduled_task'::UUID
  ],
  'student projection must expose all three deadline kinds in canonical order'
);

RESET ROLE;

INSERT INTO platform_private.student_portal_overdue_notification_runtime_controls (
  organization_id, enabled, automation_owner_membership_id
) VALUES (:'p110_org', TRUE, :'p110_admin_membership');

CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT '2026-09-04T17:00:00Z'::TIMESTAMPTZ $$;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '59911000-0000-4000-8000-000000000301', 'p110:before-timed'
);
RESET ROLE;
SELECT pg_temp.p110_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = :'p110_org' AND state.source_kind = 'task'
  ),
  'neither deadline may be overdue before its boundary'
);
CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT '2026-09-04T17:45:00Z'::TIMESTAMPTZ $$;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '59911000-0000-4000-8000-000000000302', 'p110:after-timed'
);
RESET ROLE;
SELECT pg_temp.p110_assert(
  EXISTS (
    SELECT 1
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = :'p110_org'
      AND state.source_kind = 'task'
      AND state.source_record_id = :'p110_timed_task'
      AND state.is_overdue
      AND state.observed_due_at = '2026-09-04T17:30:00Z'
  ) AND NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = :'p110_org'
      AND state.source_kind = 'task'
      AND state.source_record_id = :'p110_all_day_task'
  ),
  'timed deadline must flip by instant while all-day remains open'
);
CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT '2026-09-04T17:59:59Z'::TIMESTAMPTZ $$;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '59911000-0000-4000-8000-000000000303', 'p110:before-local-midnight'
);
RESET ROLE;
SELECT pg_temp.p110_assert(
  NOT EXISTS (
    SELECT 1
    FROM platform_private.student_portal_overdue_transition_state AS state
    WHERE state.organization_id = :'p110_org'
      AND state.source_kind = 'task'
      AND state.source_record_id = :'p110_all_day_task'
  ),
  'all-day deadline must not flip before Bishkek local day ends'
);
CREATE OR REPLACE FUNCTION platform_private.student_portal_overdue_clock()
RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT '2026-09-04T18:00:00Z'::TIMESTAMPTZ $$;
SET request.jwt.claims = '{"role":"service_role"}';
SET ROLE service_role;
SELECT platform.process_student_portal_overdue_notifications_v1(
  '59911000-0000-4000-8000-000000000304', 'p110:after-local-midnight'
)::TEXT AS p110_boundary_run
\gset
SELECT platform.process_student_portal_overdue_notifications_v1(
  '59911000-0000-4000-8000-000000000304', 'p110:after-local-midnight'
)::TEXT AS p110_boundary_replay
\gset
RESET ROLE;
SELECT pg_temp.p110_assert(
  :'p110_boundary_run'::JSONB = :'p110_boundary_replay'::JSONB
    AND EXISTS (
      SELECT 1
      FROM platform_private.student_portal_overdue_transition_state AS state
      WHERE state.organization_id = :'p110_org'
        AND state.source_kind = 'task'
        AND state.source_record_id = :'p110_all_day_task'
        AND state.is_overdue
        AND state.observed_due_at = '2026-09-04T18:00:00Z'
    )
    AND EXISTS (
      SELECT 1
      FROM platform.student_portal_overdue_notification_projection_v1 AS projection
      WHERE projection.organization_id = :'p110_org'
        AND projection.source_kind = 'task'
        AND projection.source_record_id = :'p110_all_day_task'
        AND projection.due_at = '2026-09-04T18:00:00Z'
    ),
  'all-day overdue transition must use one replay-safe local end boundary'
);
SET request.jwt.claims TO :'p110_admin_claims';
SET ROLE authenticated;
SELECT student_case.overdue_task_count AS p110_overdue_before
FROM platform.staff_student_case_page(
  10, NULL, NULL, NULL, NULL, :'p110_case'
) AS student_case
\gset

RESET ROLE;
INSERT INTO platform.case_tasks (
  id, organization_id, student_case_id, task_type, title,
  assignee_membership_id, priority, due_at, due_on, status,
  student_visible, created_by_membership_id
) VALUES (
  '59911000-0000-4000-8000-000000000211', :'p110_org', :'p110_case',
  'deadline', 'Past all-day dashboard proof', :'p110_curator_membership',
  'normal', NULL, '2000-01-01', 'open', FALSE, :'p110_admin_membership'
);

SET request.jwt.claims TO :'p110_admin_claims';
SET ROLE authenticated;
SELECT pg_temp.p110_assert(
  (
    SELECT student_case.overdue_task_count
    FROM platform.staff_student_case_page(
      10, NULL, NULL, NULL, NULL, :'p110_case'
    ) AS student_case
  ) = :'p110_overdue_before'::BIGINT + 1,
  'staff Student Case read model must count a past all-day task'
);

RESET ROLE;
ROLLBACK;

\echo 'Migration 110 all-day case-task deadline acceptance passed.'
