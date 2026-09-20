\set ON_ERROR_STOP on

-- Current-boundary acceptance for migration 188 (OTH-2 staff tasks +
-- notifications: case-task assignment notifications, the v2 enriched page,
-- mark-all-read and the lazily-materialized due-tomorrow reminder). Runs at
-- the 188 checkpoint against the full current schema (155's scoped-staff-role
-- model is already live), same convention as platform_cabinet_invites.sql
-- (185). Every Auth row, case and task below is synthetic SQL evidence; no
-- provider call is exercised.
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p187_id(n INTEGER) RETURNS UUID
LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('18700000-0000-4000-8000-'||lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p187_assert(p_condition BOOLEAN, p_message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 188 assertion failed: %', p_message;
  END IF;
END
$$;
CREATE FUNCTION pg_temp.p187_error(p_statement TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_statement;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p187_id(INTEGER), pg_temp.p187_assert(BOOLEAN, TEXT),
  pg_temp.p187_error(TEXT) TO authenticated, service_role;

SELECT 'P187_NOTIFICATIONS_V2_SUITE_START' AS p187_suite_marker;

-- ---------------------------------------------------------------------------
-- Seed: organization; admin (is_system_admin bypasses every task.manage /
-- staff.task.* scope check, same as platform_cabinet_invites.sql); two
-- curators (A = the tested assignee/recipient, B = an isolation control for
-- mark-all); one student (negative boundary).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations (id, name) VALUES (pg_temp.p187_id(1), 'Migration 187 synthetic organization');
INSERT INTO platform.record_scopes (id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p187_id(2), pg_temp.p187_id(1), 'organization', pg_temp.p187_id(1), 1);

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (pg_temp.p187_id(101), 'p187-admin@example.invalid', '{}'::JSONB),
  (pg_temp.p187_id(102), 'p187-curator-a@example.invalid', '{}'::JSONB),
  (pg_temp.p187_id(103), 'p187-curator-b@example.invalid', '{}'::JSONB),
  (pg_temp.p187_id(104), 'p187-student@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles (id, auth_user_id, display_name, status, access_version) VALUES
  (pg_temp.p187_id(201), pg_temp.p187_id(101), 'P187 Admin', 'active', 1),
  (pg_temp.p187_id(202), pg_temp.p187_id(102), 'P187 Curator A', 'active', 1),
  (pg_temp.p187_id(203), pg_temp.p187_id(103), 'P187 Curator B', 'active', 1),
  (pg_temp.p187_id(204), pg_temp.p187_id(104), 'P187 Student', 'active', 1);
INSERT INTO platform.organization_memberships (id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
VALUES
  (pg_temp.p187_id(301), pg_temp.p187_id(1), pg_temp.p187_id(201), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1), TRUE),
  (pg_temp.p187_id(302), pg_temp.p187_id(1), pg_temp.p187_id(202), 'active', 'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE),
  (pg_temp.p187_id(303), pg_temp.p187_id(1), pg_temp.p187_id(203), 'active', 'curator',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'curator' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE),
  (pg_temp.p187_id(304), pg_temp.p187_id(1), pg_temp.p187_id(204), 'active', 'student',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'student' AND status = 'published' ORDER BY version DESC LIMIT 1), FALSE);

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p187_id(101),
  'claims', jsonb_build_object('sub', pg_temp.p187_id(101), 'role', 'authenticated')))->'claims')::TEXT AS p187_admin_claims \gset

-- ---------------------------------------------------------------------------
-- Grant both curators a published task-work role (org scope): 156's
-- require_task_assignee only accepts assignees holding task.manage or
-- task.create through the 155/173 role surface, and the staff-task branch
-- checks staff.task.* the same way. Same grant idiom as
-- platform_cabinet_invites.sql; claims for the curators are derived AFTER
-- the grants below, so their access versions are already current.
-- ---------------------------------------------------------------------------
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;
SELECT platform.staff_role_command(
  pg_temp.p187_id(1), pg_temp.p187_id(701), 0, 'create',
  jsonb_build_object(
    'label', 'P187 Task work',
    'description', 'Migration 188 synthetic curator task role',
    'permissionKeys', jsonb_build_array('case.read.full', 'task.create', 'task.manage', 'staff.task.read', 'staff.task.create', 'staff.task.complete')
  ),
  'P187 create task-work role', pg_temp.p187_id(711)
) AS p187_role_created \gset
SELECT platform.staff_role_impact(pg_temp.p187_id(1), pg_temp.p187_id(701), 1)
  ->> 'impactFingerprint' AS p187_role_impact \gset
SELECT platform.staff_role_publish(
  pg_temp.p187_id(1), pg_temp.p187_id(701), 1, :'p187_role_impact',
  'P187 publish task-work role', pg_temp.p187_id(712)
) AS p187_role_published \gset
SELECT (:'p187_role_published'::JSONB ->> 'bundleId') AS p187_role_bundle_id \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p187_id(1), pg_temp.p187_id(302), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p187_id(701), 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.p187_id(1)::TEXT, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p187_id(701), 'roleVersion', 2, 'bundleId', :'p187_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P187 grant curator A task work', pg_temp.p187_id(713)
) AS p187_curator_a_granted \gset
SELECT platform.staff_role_assignments_save(
  pg_temp.p187_id(1), pg_temp.p187_id(303), 1,
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p187_id(701), 'scope', jsonb_build_object('kind', 'organization', 'key', pg_temp.p187_id(1)::TEXT, 'resourceKind', NULL))),
  jsonb_build_array(jsonb_build_object('roleId', pg_temp.p187_id(701), 'roleVersion', 2, 'bundleId', :'p187_role_bundle_id'::UUID, 'bundleVersion', 1)),
  'P187 grant curator B task work', pg_temp.p187_id(714)
) AS p187_curator_b_granted \gset
RESET ROLE;
RESET request.jwt.claims;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p187_id(102),
  'claims', jsonb_build_object('sub', pg_temp.p187_id(102), 'role', 'authenticated')))->'claims')::TEXT AS p187_curator_a_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p187_id(103),
  'claims', jsonb_build_object('sub', pg_temp.p187_id(103), 'role', 'authenticated')))->'claims')::TEXT AS p187_curator_b_claims \gset
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p187_id(104),
  'claims', jsonb_build_object('sub', pg_temp.p187_id(104), 'role', 'authenticated')))->'claims')::TEXT AS p187_student_claims \gset

-- Active case owned/curated by Curator A -- the same insert-time trigger
-- bypass platform_cabinet_invites.sql (185) uses for an already-active case.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (id, organization_id, current_curator_membership_id,
  responsible_sales_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state,
  handoff_at, current_scope_id, current_scope_version)
VALUES (pg_temp.p187_id(601), pg_temp.p187_id(1), pg_temp.p187_id(302),
  pg_temp.p187_id(301),
  'synthetic:p187:case', 'P187 Student Case', 'China', 'Bachelor', 'documents', 'active',
  statement_timestamp(), pg_temp.p187_id(2), 1);
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (1) case-task assignment: creating a case task assigned to Curator A
-- notifies exactly Curator A, never the acting Admin.
-- ===========================================================================
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;

SELECT platform.create_case_task(pg_temp.p187_id(1), pg_temp.p187_id(601), 'follow_up',
  'P187 first case task', pg_temp.p187_id(302), 'normal', NULL, NULL, 'open', FALSE, 0,
  pg_temp.p187_id(701))::TEXT AS p187_task_one_created \gset
SELECT (:'p187_task_one_created'::JSONB ->> 'case_task_id')::UUID AS p187_task_one \gset

RESET ROLE;

SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'case_task_assigned'
      AND case_task_id = :'p187_task_one' AND recipient_membership_id = pg_temp.p187_id(302)
      AND student_case_id = pg_temp.p187_id(601) AND actor_membership_id = pg_temp.p187_id(301)),
  'assigning a case task did not notify exactly the new assignee, carrying case/actor identifiers');
SELECT pg_temp.p187_assert(
  NOT EXISTS (SELECT 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'case_task_assigned'
      AND recipient_membership_id = pg_temp.p187_id(301)),
  'the acting Admin must never be notified of their own assignment');

-- A second, distinct case task assigned to Curator B -- isolates the
-- mark-all-read boundary below from Curator A's own rows.
SELECT platform.create_case_task(pg_temp.p187_id(1), pg_temp.p187_id(601), 'follow_up',
  'P187 curator B case task', pg_temp.p187_id(303), 'normal', NULL, NULL, 'open', FALSE, 0,
  pg_temp.p187_id(702))::TEXT AS p187_task_b_created \gset
SELECT (:'p187_task_b_created'::JSONB ->> 'case_task_id')::UUID AS p187_task_b \gset
RESET ROLE;

-- ===========================================================================
-- (1b) reassign-away-and-back: a case task assigned to Curator A, reassigned
-- to Curator B, then reassigned back to Curator A must notify Curator A
-- TWICE (create-time event + reassign-back event) with distinct event_keys,
-- not once. The pre-fix key ('case-task:'||case_task_id||':assignee:'||
-- new_assignee) was identical for the create-time event and the
-- reassign-back event (both have new_assignee = Curator A), so the second
-- insert silently collided on ON CONFLICT DO NOTHING. The fixed key
-- ('case-task:'||case_task_events.id) is unique per event, so both survive.
-- ===========================================================================
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;

SELECT platform.create_case_task(pg_temp.p187_id(1), pg_temp.p187_id(601), 'follow_up',
  'P187 reassign-cycle case task', pg_temp.p187_id(302), 'normal', NULL, NULL, 'open', FALSE, 0,
  pg_temp.p187_id(707))::TEXT AS p187_task_cycle_created \gset
SELECT (:'p187_task_cycle_created'::JSONB ->> 'case_task_id')::UUID AS p187_task_cycle \gset

-- Reassign A -> B (version 1 -> 2).
SELECT platform.change_case_task(pg_temp.p187_id(1), :'p187_task_cycle', 'open',
  pg_temp.p187_id(303), 'normal', NULL, NULL, FALSE, 1, pg_temp.p187_id(708))::TEXT AS p187_task_cycle_to_b \gset

-- Reassign B -> A (version 2 -> 3): the collision case.
SELECT platform.change_case_task(pg_temp.p187_id(1), :'p187_task_cycle', 'open',
  pg_temp.p187_id(302), 'normal', NULL, NULL, FALSE, 2, pg_temp.p187_id(709))::TEXT AS p187_task_cycle_back_to_a \gset

RESET ROLE;

SELECT pg_temp.p187_assert(
  (SELECT count(*) = 2 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'case_task_assigned'
      AND case_task_id = :'p187_task_cycle' AND recipient_membership_id = pg_temp.p187_id(302)),
  'reassigning a case task away and back to the same Curator must notify them twice, not collide on a stale event_key');
SELECT pg_temp.p187_assert(
  (SELECT count(DISTINCT event_key) = 2 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'case_task_assigned'
      AND case_task_id = :'p187_task_cycle' AND recipient_membership_id = pg_temp.p187_id(302)),
  'the two reassign-back notifications for Curator A must carry distinct event_keys');
SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'case_task_assigned'
      AND case_task_id = :'p187_task_cycle' AND recipient_membership_id = pg_temp.p187_id(303)),
  'Curator B must have exactly one notification for the single reassignment to them');

-- ===========================================================================
-- (2) v2 page as the assignee returns the enriched row.
-- ===========================================================================
SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1))::TEXT AS p187_page_one \gset
RESET ROLE;

SELECT pg_temp.p187_assert(
  (SELECT item->>'kind' = 'case_task_assigned' AND item->>'case_task_id' = :'p187_task_one'::TEXT
     AND item->>'student_case_id' = pg_temp.p187_id(601)::TEXT
     AND item->>'subject_title' = 'P187 first case task'
     AND item->>'student_display_name' = 'P187 Student Case'
     AND item->>'actor_display_name' = 'P187 Admin'
     AND item->>'read_at' IS NULL
   FROM jsonb_array_elements(:'p187_page_one'::JSONB -> 'items') item
   WHERE item->>'case_task_id' = :'p187_task_one'::TEXT),
  'v2 page did not return the enriched case_task_assigned row for its assignee');

-- ===========================================================================
-- (3) mark-all clears only the caller's own unread rows.
-- ===========================================================================
SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.mark_all_staff_notifications_read(pg_temp.p187_id(1))::TEXT AS p187_marked_a \gset
RESET ROLE;

SELECT pg_temp.p187_assert(
  (SELECT count(*) = 0 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND recipient_membership_id = pg_temp.p187_id(302) AND read_at IS NULL),
  'mark-all did not clear every unread row for the calling recipient');
SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND recipient_membership_id = pg_temp.p187_id(303)
      AND kind = 'case_task_assigned' AND case_task_id = :'p187_task_b' AND read_at IS NULL),
  'mark-all must not touch a different recipient''s unread row');

-- ===========================================================================
-- (4) due-tomorrow reminder: materializes, is idempotent across two calls,
-- disappears (is marked read) once the task completes, and is replaced by a
-- fresh key (old key read, new key present) when the due changes.
-- ===========================================================================
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;
SELECT platform.mutate_staff_task(pg_temp.p187_id(1), 'create', pg_temp.p187_id(703), 0, NULL,
  'P187 staff task due tomorrow', pg_temp.p187_id(302), NULL, 'open', 'normal',
  ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1), NULL)::TEXT AS p187_staff_task_created \gset
SELECT (:'p187_staff_task_created'::JSONB ->> 'staff_task_id')::UUID AS p187_staff_task \gset
RESET ROLE;

SELECT 'task-reminder:' || :'p187_staff_task' || ':' ||
  ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)::TEXT AS p187_reminder_key_one \gset

SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1))::TEXT AS p187_page_two \gset
RESET ROLE;

SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_staff_task'
      AND recipient_membership_id = pg_temp.p187_id(302) AND event_key = :'p187_reminder_key_one'),
  'a task due tomorrow did not materialize exactly one task_due reminder');
SELECT pg_temp.p187_assert(
  (SELECT item->>'kind' = 'task_due' AND item->>'staff_task_id' = :'p187_staff_task'::TEXT
     AND item->>'subject_title' = 'P187 staff task due tomorrow'
   FROM jsonb_array_elements(:'p187_page_two'::JSONB -> 'items') item
   WHERE item->>'staff_task_id' = :'p187_staff_task'::TEXT AND item->>'kind' = 'task_due'),
  'the materialized reminder did not carry its enriched subject_title');

-- Idempotent: a second read must not create a duplicate live reminder.
SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1));
RESET ROLE;
SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_staff_task'),
  'a second page read created a duplicate reminder for the same due value');

-- Completing the task neutralizes its reminder (read, never actionable again).
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;
SELECT platform.mutate_staff_task(pg_temp.p187_id(1), 'status', pg_temp.p187_id(704),
  (:'p187_staff_task_created'::JSONB ->> 'version')::BIGINT, :'p187_staff_task', NULL, NULL, NULL,
  'done', NULL, NULL, NULL);
RESET ROLE;
SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1));
RESET ROLE;
SELECT pg_temp.p187_assert(
  (SELECT read_at IS NOT NULL FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_staff_task'),
  'completing the reminded task did not neutralize its live reminder');

-- A second, independent task: materialize its reminder, then change its due
-- while it stays inside the reminder window -- the old key must end up read
-- and a new key must be present, never both live at once.
SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;
SELECT platform.mutate_staff_task(pg_temp.p187_id(1), 'create', pg_temp.p187_id(705), 0, NULL,
  'P187 staff task due-change probe', pg_temp.p187_id(302), NULL, 'open', 'normal',
  ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1), NULL)::TEXT AS p187_probe_created \gset
SELECT (:'p187_probe_created'::JSONB ->> 'staff_task_id')::UUID AS p187_probe_task \gset
RESET ROLE;
SELECT 'task-reminder:' || :'p187_probe_task' || ':' ||
  ((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)::TEXT AS p187_probe_key_old \gset

SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1));
RESET ROLE;
SELECT pg_temp.p187_assert(
  (SELECT read_at IS NULL FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_probe_task'
      AND event_key = :'p187_probe_key_old'),
  'the due-change probe reminder did not materialize unread first');

SET request.jwt.claims TO :'p187_admin_claims';
SET ROLE authenticated;
SELECT platform.mutate_staff_task(pg_temp.p187_id(1), 'edit', pg_temp.p187_id(706),
  (:'p187_probe_created'::JSONB ->> 'version')::BIGINT, :'p187_probe_task',
  'P187 staff task due-change probe', pg_temp.p187_id(302), NULL, 'open', 'normal', NULL,
  (statement_timestamp() + INTERVAL '2 hours'))::TEXT AS p187_probe_edited \gset
RESET ROLE;
-- mutate_staff_task's own result payload carries no due_at (140:192-193) --
-- read the exact stored value back so the expected key can never drift from
-- what platform.staff_notifications_page_v2 itself computes from the row.
SELECT due_at::TEXT AS p187_probe_due_at FROM platform.staff_tasks WHERE id = :'p187_probe_task' \gset
SELECT 'task-reminder:' || :'p187_probe_task' || ':' || :'p187_probe_due_at' AS p187_probe_key_new \gset

SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page_v2(pg_temp.p187_id(1));
RESET ROLE;
SELECT pg_temp.p187_assert(
  (SELECT read_at IS NOT NULL FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_probe_task'
      AND event_key = :'p187_probe_key_old'),
  'changing the due did not neutralize the stale reminder key');
SELECT pg_temp.p187_assert(
  (SELECT count(*) = 1 FROM platform.staff_notifications
    WHERE organization_id = pg_temp.p187_id(1) AND kind = 'task_due' AND staff_task_id = :'p187_probe_task'
      AND event_key = :'p187_probe_key_new' AND read_at IS NULL),
  'changing the due did not materialize exactly one fresh, unread reminder key');

-- ===========================================================================
-- (5) A Student gets 42501 / no rows from either new RPC.
-- ===========================================================================
SET request.jwt.claims TO :'p187_student_claims';
SET ROLE authenticated;
SELECT pg_temp.p187_assert(
  pg_temp.p187_error(format('SELECT platform.staff_notifications_page_v2(%L)', pg_temp.p187_id(1))) = '42501',
  'a Student must be refused the v2 notification page');
SELECT pg_temp.p187_assert(
  pg_temp.p187_error(format('SELECT platform.mark_all_staff_notifications_read(%L)', pg_temp.p187_id(1))) = '42501',
  'a Student must be refused mark-all-read');
RESET ROLE;

-- ===========================================================================
-- (6) The pre-existing v1 page never returns a new kind, for any caller who
-- has both legacy and new-kind rows outstanding.
-- ===========================================================================
SET request.jwt.claims TO :'p187_curator_a_claims';
SET ROLE authenticated;
SELECT platform.staff_notifications_page(pg_temp.p187_id(1))::TEXT AS p187_legacy_page \gset
RESET ROLE;
SELECT pg_temp.p187_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'p187_legacy_page'::JSONB -> 'items') item
    WHERE item->>'kind' IN ('case_task_assigned', 'task_due')),
  'the pre-existing staff_notifications_page returned a kind introduced by this migration');

SELECT 'P187_NOTIFICATIONS_V2_SUITE_PASSED' AS p187_suite_marker;

ROLLBACK;
