\set ON_ERROR_STOP on

-- Post-153 regression in the disposable authorization database only. Synthetic
-- upstream identities/cases are fixtures, not live Auth or customer acceptance.
-- Help creation, answers, projections and acknowledgements use the real RPCs
-- under authenticated roles with all guards/triggers enabled, then roll back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p153_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('59153000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.p153_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P153: %', message; END IF;
END $$;
CREATE FUNCTION pg_temp.p153_error(statement TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.p153_id(INTEGER), pg_temp.p153_assert(BOOLEAN, TEXT),
  pg_temp.p153_error(TEXT) TO authenticated;

SELECT pg_temp.p153_assert(
  has_function_privilege('authenticated', 'platform.student_portal_help_reply_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.student_portal_help_reply_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform.student_portal_help_reply_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.own_case_help_notifications()', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.case_help_commands', 'SELECT'),
  'reply access must use the owner-filtered authenticated API');

CREATE TEMP TABLE p153_actors(n INTEGER, org UUID, role platform.business_role, claims TEXT);
INSERT INTO p153_actors(n, org, role)
SELECT n, pg_temp.p153_id(CASE WHEN n IN (6, 8, 9) THEN 2 ELSE 1 END), role::platform.business_role
FROM (VALUES (1, 'admin'), (2, 'sales'), (3, 'curator'), (4, 'student'),
  (5, 'student'), (6, 'student'), (7, 'curator'), (8, 'sales'), (9, 'curator')) actor(n, role);
INSERT INTO platform.organizations(id, name)
VALUES (pg_temp.p153_id(1), 'P153 isolated organization A'),
  (pg_temp.p153_id(2), 'P153 isolated organization B');
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT pg_temp.p153_id(100 + n), 'p153-' || n || '@example.invalid', '{}'::JSONB FROM p153_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
SELECT pg_temp.p153_id(200 + n), pg_temp.p153_id(100 + n), 'P153 actor ' || n, 'active', 1 FROM p153_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
SELECT pg_temp.p153_id(300 + n), org, pg_temp.p153_id(200 + n), 'active', actor.role,
  (SELECT id FROM platform.role_bundle_versions WHERE role = actor.role AND status = 'published' ORDER BY version DESC LIMIT 1)
FROM p153_actors actor;
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
VALUES (pg_temp.p153_id(401), pg_temp.p153_id(1), 'organization', pg_temp.p153_id(1), 1),
  (pg_temp.p153_id(402), pg_temp.p153_id(2), 'organization', pg_temp.p153_id(2), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
SELECT pg_temp.p153_id(410 + n), org, 'student_case', pg_temp.p153_id(500 + n), 1
FROM p153_actors WHERE role = 'student';
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id,
  scope_version, assignment_version, granted, actor_kind, reason, request_id)
SELECT org, pg_temp.p153_id(300 + n), pg_temp.p153_id(CASE WHEN n IN (6, 8, 9) THEN 402 ELSE 401 END),
  1, 1, TRUE, 'system', 'P153 synthetic organization scope', pg_temp.p153_id(600 + n) FROM p153_actors;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id,
  scope_version, assignment_version, granted, actor_kind, reason, request_id)
SELECT org, pg_temp.p153_id(300 + n), pg_temp.p153_id(410 + n), 1, 1, TRUE,
  'system', 'P153 own case scope', pg_temp.p153_id(620 + n) FROM p153_actors WHERE role = 'student';
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id,
  scope_version, assignment_version, granted, actor_kind, reason, request_id)
SELECT pg_temp.p153_id(1), pg_temp.p153_id(303), pg_temp.p153_id(410 + n), 1, 1, TRUE,
  'system', 'P153 assigned curator scope', pg_temp.p153_id(640 + n) FROM generate_series(4, 5) n;

-- Seed only the accepted upstream case snapshot. The notification behavior
-- under test below never disables triggers or writes its own receipt/event.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, student_membership_id,
  responsible_sales_membership_id, current_curator_membership_id, source_key,
  contract_confirmation_ref, contract_confirmed_at,
  student_display_name, target_country, target_degree, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version)
SELECT pg_temp.p153_id(500 + n), org, pg_temp.p153_id(300 + n),
  CASE WHEN n = 6 THEN pg_temp.p153_id(308) ELSE pg_temp.p153_id(302) END,
  CASE WHEN n = 6 THEN pg_temp.p153_id(309) ELSE pg_temp.p153_id(303) END,
  'synthetic:p153:' || n, 'synthetic:p153:contract:' || n, clock_timestamp(),
  'P153 student ' || n, 'China', 'Bachelor', 'documents', 'active',
  clock_timestamp(), clock_timestamp(), pg_temp.p153_id(410 + n), 1
FROM p153_actors WHERE role = 'student';
SET LOCAL session_replication_role = origin;

UPDATE p153_actors actor SET claims = jsonb_build_object(
  'sub', profile.auth_user_id, 'role', 'authenticated', 'platform_role', actor.role,
  'platform_access_version', profile.access_version, 'platform_organization_id', membership.organization_id,
  'platform_membership_id', membership.id, 'platform_bundle_id', bundle.id, 'platform_bundle_version', bundle.version
)::TEXT
FROM platform.profiles profile
JOIN platform.organization_memberships membership ON membership.profile_id = profile.id
JOIN platform.role_bundle_versions bundle ON bundle.id = membership.current_bundle_id
WHERE profile.id = pg_temp.p153_id(200 + actor.n);
SELECT claims AS p153_owner FROM p153_actors WHERE n = 4 \gset
SELECT claims AS p153_neighbor FROM p153_actors WHERE n = 5 \gset
SELECT claims AS p153_foreign FROM p153_actors WHERE n = 6 \gset
SELECT claims AS p153_curator FROM p153_actors WHERE n = 3 \gset
SELECT claims AS p153_unassigned FROM p153_actors WHERE n = 7 \gset

SET LOCAL request.jwt.claims TO :'p153_owner';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(case_id = pg_temp.p153_id(504))
  FROM platform.student_portal_cases()), 'owner has a valid activated case before help commands');
SELECT platform.create_case_help_request_v1('P153 document question', 'P153 body for the exact reply', pg_temp.p153_id(801))::TEXT AS p153_create \gset
SELECT (:'p153_create'::JSONB ->> 'id') AS p153_help \gset
SELECT platform.create_case_help_request_v1('P153 unrelated question', 'Must not appear in the exact reply', pg_temp.p153_id(802))::TEXT AS p153_other_create \gset
SELECT pg_temp.p153_assert(NOT EXISTS (SELECT 1 FROM platform.student_portal_notifications_v2()
  WHERE category = 'case_help.answer'), 'creating a question is not an answered notification');

RESET ROLE;
SET LOCAL request.jwt.claims TO :'p153_unassigned';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p153_assert(pg_temp.p153_error(format(
  'SELECT platform.answer_case_help_request_v1(%L,%L,%L,1,%L)',
  pg_temp.p153_id(504), :'p153_help', 'Unassigned answer', pg_temp.p153_id(803))) = '42501',
  'an unassigned curator cannot answer this case');

RESET ROLE;
SET LOCAL request.jwt.claims TO :'p153_curator';
SET LOCAL ROLE authenticated;
SELECT platform.answer_case_help_request_v1(pg_temp.p153_id(504), :'p153_help',
  'P153 approved technical answer', 1, pg_temp.p153_id(804))::TEXT AS p153_answer \gset
SELECT pg_temp.p153_assert(:'p153_answer'::JSONB = jsonb_build_object(
  'id', :'p153_help'::UUID, 'caseId', pg_temp.p153_id(504), 'version', '2', 'requestId', pg_temp.p153_id(804)),
  'answer receipt identifies the exact case, question and new revision');
SELECT pg_temp.p153_assert(platform.answer_case_help_request_v1(pg_temp.p153_id(504), :'p153_help',
  'P153 approved technical answer', 1, pg_temp.p153_id(804)) = :'p153_answer'::JSONB,
  'same answer request replays its original receipt');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format(
  'SELECT platform.answer_case_help_request_v1(%L,%L,%L,1,%L)',
  pg_temp.p153_id(504), :'p153_help', 'Changed replay payload', pg_temp.p153_id(804))) = '23505',
  'reusing a command identity with different content is rejected');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format(
  'SELECT platform.answer_case_help_request_v1(%L,%L,%L,1,%L)',
  pg_temp.p153_id(504), :'p153_help', 'Stale second answer', pg_temp.p153_id(805))) = '40001',
  'a stale independent answer cannot overwrite the newer revision');

RESET ROLE;
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(
  recipient_membership_id = pg_temp.p153_id(304) AND student_case_id = pg_temp.p153_id(504)
  AND created_by_membership_id = pg_temp.p153_id(303) AND dedupe_key = 'case_help_answer:' || pg_temp.p153_id(804)::TEXT)
  FROM platform.notifications WHERE organization_id = pg_temp.p153_id(1) AND category = 'case_help.answer'),
  'one answered notification targets only the original question owner');
SELECT id AS p153_notification FROM platform.notifications
WHERE organization_id = pg_temp.p153_id(1) AND dedupe_key = 'case_help_answer:' || pg_temp.p153_id(804)::TEXT \gset
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(event_type = 'created'
  AND recipient_membership_id = pg_temp.p153_id(304) AND student_case_id = pg_temp.p153_id(504)
  AND actor_membership_id = pg_temp.p153_id(303) AND request_id = pg_temp.p153_id(804))
  FROM platform.notification_events WHERE notification_id = :'p153_notification'),
  'answer and exact replay create one owner-bound event');
SELECT pg_temp.p153_assert((SELECT count(*) = 1 FROM platform_private.case_help_commands
  WHERE organization_id = pg_temp.p153_id(1) AND input ->> 'operation' = 'answer'),
  'failed answers and replay create no extra command receipts');
SELECT pg_temp.p153_assert((SELECT version = 2 AND answer = 'P153 approved technical answer'
  FROM platform.case_help_requests WHERE id = :'p153_help'), 'failed commands leave the confirmed answer intact');

-- A valid same-organization Student and a valid foreign-organization Student
-- must both be denied. Checking their own cases rules out an invalid-session
-- false positive in the privacy assertions.
SET LOCAL request.jwt.claims TO :'p153_neighbor';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(case_id = pg_temp.p153_id(505))
  FROM platform.student_portal_cases()), 'neighbor has a valid separate case');
SELECT pg_temp.p153_assert(NOT EXISTS (SELECT 1 FROM platform.student_portal_notifications_v2()
  WHERE notification_id = :'p153_notification'), 'neighbor feed excludes owner notification');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format('SELECT platform.student_portal_help_reply_v1(%L)', :'p153_notification')) = '42501',
  'neighbor cannot read the exact reply by notification ID');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format('SELECT platform.mark_own_student_portal_notification_read_v2(%L,%L)',
  :'p153_notification', pg_temp.p153_id(806))) = '42501', 'neighbor cannot mark the owner notification read');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'p153_foreign';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(case_id = pg_temp.p153_id(506))
  FROM platform.student_portal_cases()), 'foreign Student has a valid separate organization case');
SELECT pg_temp.p153_assert(NOT EXISTS (SELECT 1 FROM platform.student_portal_notifications_v2()
  WHERE notification_id = :'p153_notification'), 'foreign organization feed excludes owner notification');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format('SELECT platform.student_portal_help_reply_v1(%L)', :'p153_notification')) = '42501',
  'foreign organization cannot read the exact reply');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format('SELECT platform.mark_own_student_portal_notification_read_v2(%L,%L)',
  :'p153_notification', pg_temp.p153_id(807))) = '42501', 'foreign organization cannot acknowledge the reply');

RESET ROLE;
SET LOCAL request.jwt.claims TO :'p153_owner';
SET LOCAL ROLE authenticated;
SELECT pg_temp.p153_assert((SELECT count(*) = 1 AND bool_and(event_code = 'case_help_answer'
  AND category = 'case_help.answer' AND read_at IS NULL AND due_at IS NULL)
  FROM platform.student_portal_notifications_v2() WHERE notification_id = :'p153_notification'),
  'owner feed exposes one unread reply notification');
SELECT platform.student_portal_help_reply_v1(:'p153_notification')::TEXT AS p153_detail \gset
SELECT pg_temp.p153_assert((SELECT array_agg(key ORDER BY key) = ARRAY['caseId','items','readAt']::TEXT[]
  FROM jsonb_object_keys(:'p153_detail'::JSONB) key)
  AND :'p153_detail'::JSONB ->> 'caseId' = pg_temp.p153_id(504)::TEXT
  AND :'p153_detail'::JSONB -> 'readAt' = 'null'::JSONB
  AND jsonb_array_length(:'p153_detail'::JSONB -> 'items') = 1
  AND :'p153_detail'::JSONB #>> '{items,0,id}' = :'p153_help'
  AND :'p153_detail'::JSONB #>> '{items,0,subject}' = 'P153 document question'
  AND :'p153_detail'::JSONB #>> '{items,0,body}' = 'P153 body for the exact reply'
  AND :'p153_detail'::JSONB #>> '{items,0,answer}' = 'P153 approved technical answer'
  AND :'p153_detail'::JSONB #>> '{items,0,status}' = 'answered'
  AND :'p153_detail'::JSONB #>> '{items,0,version}' = '2',
  'exact detail contains only the selected question and its confirmed answer');
SELECT pg_temp.p153_assert((SELECT array_agg(key ORDER BY key) = ARRAY[
  'answer','answeredAt','body','createdAt','id','status','subject','version']::TEXT[]
  FROM jsonb_object_keys(:'p153_detail'::JSONB #> '{items,0}') key),
  'reply DTO excludes internal staff, membership and command fields');
SELECT pg_temp.p153_assert(pg_temp.p153_error(format('SELECT platform.mark_own_notification_read(%L,%L,%L)',
  pg_temp.p153_id(1), :'p153_notification', pg_temp.p153_id(808))) = '42501',
  'generic legacy acknowledgement cannot bypass the Portal-specific command');
SELECT platform.mark_own_student_portal_notification_read_v2(:'p153_notification', pg_temp.p153_id(809))::TEXT AS p153_read \gset
SELECT pg_temp.p153_assert(:'p153_read'::JSONB ->> 'notification_id' = :'p153_notification'
  AND :'p153_read'::JSONB -> 'is_read' = 'true'::JSONB
  AND (:'p153_read'::JSONB ->> 'read_at')::TIMESTAMPTZ IS NOT NULL,
  'mark-read returns the confirmed notification identity and timestamp');
SELECT pg_temp.p153_assert(platform.mark_own_student_portal_notification_read_v2(:'p153_notification', pg_temp.p153_id(809)) = :'p153_read'::JSONB,
  'same read command replays the original timestamp');
SELECT pg_temp.p153_assert((SELECT read_at = (:'p153_read'::JSONB ->> 'read_at')::TIMESTAMPTZ
  FROM platform.student_portal_notifications_v2() WHERE notification_id = :'p153_notification')
  AND (platform.student_portal_help_reply_v1(:'p153_notification') ->> 'readAt')::TIMESTAMPTZ
    = (:'p153_read'::JSONB ->> 'read_at')::TIMESTAMPTZ,
  'fresh feed and exact detail reads preserve acknowledgement');

RESET ROLE;
SELECT pg_temp.p153_assert((SELECT read_at = (:'p153_read'::JSONB ->> 'read_at')::TIMESTAMPTZ
  FROM platform.notifications WHERE id = :'p153_notification'), 'read timestamp is persisted on the canonical notification');
SELECT pg_temp.p153_assert((SELECT count(*) = 2 AND count(*) FILTER (WHERE event_type = 'created') = 1
  AND count(*) FILTER (WHERE event_type = 'read') = 1 FROM platform.notification_events WHERE notification_id = :'p153_notification'),
  'exact replays and denied requests produce neither duplicate nor foreign events');
SELECT pg_temp.p153_assert((SELECT count(*) = 1 FROM platform.audit_events
  WHERE organization_id = pg_temp.p153_id(1) AND action = 'notification.read' AND resource_id = :'p153_notification'),
  'exact read replay creates one audited acknowledgement');
ROLLBACK;
