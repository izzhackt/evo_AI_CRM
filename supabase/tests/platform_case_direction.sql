\set ON_ERROR_STOP on
-- Boundary suite for migration 292 («Задать направление» делу студента).
-- Members are modelled like production after 155 (as in 244, 281 and 290):
-- invited staff have coarse role NULL and get permissions only from scoped
-- role assignments with the production keys. Cases come through 281's own
-- command; the fixtures that no command can produce (a case with no direction,
-- a closed case, a case bound to a playbook) are written as the table owner.
-- Proves:
--  S success: the Admin sets a direction on a case that has none (a pending case
--    without a curator) and changes a set one (CN -> MY); the Admissions Manager
--    (department scope) changes the case of its department. The receipt is the
--    committed row; admissions_version rises by exactly one; one audit_events row
--    `case.direction.set` carries only the direction codes and the versions;
--    NOTHING else changes: the whole case row but the direction, the version and
--    updated_at, the tasks, assignments, lifecycle events, obligations, payments,
--    applications and admissions events, the lead's interest_direction, and the
--    audit rows (+1 exactly).
--  N no-op and replay: the same value changes nothing (no version bump, no audit
--    row, no version check); the same request id with the same payload replays the
--    original receipt; the same id with another payload, another case or another
--    actor is refused (22023).
--  V version: a stale or overflowing expected version is PT409 and changes nothing.
--  I input: a value outside CN, MY, EUROPE, AE, TR (the six product countries
--    IT and CZ included, lower case, empty) and NULL arguments are 22023.
--  B bound: a case bound to a playbook refuses every value, the same one too
--    (22023 case_direction_playbook_bound), and nothing changes; an empty direction
--    on a bound case cannot exist (the table refuses it).
--  C closed: a closed case is refused (22023 case_direction_case_closed).
--  D denial (42501): the case's own curator, another curator, Sales, the Student,
--    a user without membership, the Admin of another organization (both
--    organization ids), the Admin asking with another organization id, an unknown
--    case, and the Admissions Manager on a pending case outside its reach; anon
--    and service_role have no EXECUTE.
--  L lockout: a manager whose role is scoped to the direction CN cannot set a CN
--    case to MY (22023 case_direction_actor_access_lost, everything rolled back);
--    the same when only ONE of the two rights (read the case, assign curators) is tied
--    to the direction: reading in the organization with assigning scoped to CN, and
--    the other way round;
--    it cannot see a case with no direction; once the Admin sets CN on that case it
--    sees it, and once the Admin moves it to MY it loses it (the visibility effect
--    of the direction, proved).
--  P posture: owner, definer, empty search_path, VOLATILE, ACL, only in platform;
--    the direction CHECK keeps its five values.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.n292_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29200000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n292_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N292: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n292_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The command as the current role; p_version and p_request are SQL literals.
CREATE FUNCTION pg_temp.n292_set(p_organization UUID, p_case UUID, p_direction TEXT, p_version TEXT, p_request UUID)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(%L, %L, %L, %s, %L)',
    p_organization, p_case, p_direction, p_version, p_request))
$$;
-- Everything the command must NOT change, read as the table owner.
CREATE FUNCTION pg_temp.n292_effects(p_case UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT jsonb_build_object(
    'row', (SELECT to_jsonb(c) - 'admissions_direction' - 'admissions_version' - 'updated_at'
      FROM platform.student_cases c WHERE c.id = p_case),
    'tasks', (SELECT count(*) FROM platform.case_tasks WHERE student_case_id = p_case),
    'assignments', (SELECT count(*) FROM platform.student_case_assignment_events WHERE student_case_id = p_case),
    'lifecycle', (SELECT count(*) FROM platform.student_case_lifecycle_events WHERE student_case_id = p_case),
    'obligations', (SELECT count(*) FROM platform.payment_obligations WHERE student_case_id = p_case),
    'payments', (SELECT count(*) FROM platform.payment_events WHERE student_case_id = p_case),
    'applications', (SELECT count(*) FROM platform.university_applications WHERE student_case_id = p_case),
    'admissions_events', (SELECT count(*) FROM platform_private.admissions_events WHERE student_case_id = p_case),
    'lead_interest', (SELECT l.interest_direction FROM platform.leads l
      WHERE l.id = (SELECT canonical_lead_id FROM platform.student_cases WHERE id = p_case)))
$$;
CREATE FUNCTION pg_temp.n292_audits() RETURNS BIGINT LANGUAGE SQL AS $$
  SELECT count(*) FROM platform.audit_events WHERE organization_id = pg_temp.n292_id(1)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n292_id(INTEGER), pg_temp.n292_assert(BOOLEAN, TEXT), pg_temp.n292_error(TEXT),
  pg_temp.n292_set(UUID, UUID, TEXT, TEXT, UUID) TO authenticated, anon, service_role;

SELECT 'N292_CASE_DIRECTION_SUITE_START' AS n292_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with 1 Admin (system); invited staff with coarse
-- role NULL: 2 Sales Manager, 3 Admissions A (own scope), 4 Admissions B (own
-- scope), 7 Admissions Manager (department), 9 Admissions Manager whose role is
-- scoped to the direction CN; 10 reads cases in the organization but assigns curators
-- only for the direction CN; 11 reads cases only for the direction CN but assigns curators
-- in the organization; 5 Student. Organization 2 has its own Admin (8).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n292_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n292_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL),
  (8, 'admin'), (9, NULL), (10, NULL), (11, NULL);
GRANT SELECT ON n292_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n292_id(1), 'N292 Fictional organization'),
  (pg_temp.n292_id(2), 'N292 Other organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n292_id(100 + n), 'n292-' || n || '@example.invalid', '{}'::JSONB FROM n292_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n292_id(199), 'n292-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n292_id(200 + n), pg_temp.n292_id(100 + n), 'N292 Actor ' || n, 'active', 1 FROM n292_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n292_id(300 + n), CASE WHEN a.n = 8 THEN pg_temp.n292_id(2) ELSE pg_temp.n292_id(1) END,
    pg_temp.n292_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n292_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n292_id(301), pg_temp.n292_id(308));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n292_id(401), pg_temp.n292_id(1), 'organization', pg_temp.n292_id(1), 1),
  (pg_temp.n292_id(402), pg_temp.n292_id(2), 'organization', pg_temp.n292_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n292_id(1), pg_temp.n292_id(301), pg_temp.n292_id(401), 1, 1, TRUE, 'system',
    'N292 synthetic organization scope', pg_temp.n292_id(601)),
  (pg_temp.n292_id(1), pg_temp.n292_id(305), pg_temp.n292_id(401), 1, 1, TRUE, 'system',
    'N292 synthetic Student organization scope', pg_temp.n292_id(605)),
  (pg_temp.n292_id(2), pg_temp.n292_id(308), pg_temp.n292_id(402), 1, 1, TRUE, 'system',
    'N292 synthetic other-organization scope', pg_temp.n292_id(608));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n292_id(901), pg_temp.n292_id(1), 'N292 Sales'),
  (pg_temp.n292_id(902), pg_temp.n292_id(1), 'N292 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n292_id(1), pg_temp.n292_id(302), pg_temp.n292_id(901)),
  (pg_temp.n292_id(1), pg_temp.n292_id(303), pg_temp.n292_id(902)),
  (pg_temp.n292_id(1), pg_temp.n292_id(304), pg_temp.n292_id(902)),
  (pg_temp.n292_id(1), pg_temp.n292_id(307), pg_temp.n292_id(902)),
  (pg_temp.n292_id(1), pg_temp.n292_id(309), pg_temp.n292_id(902));

-- Roles with the EXACT production permission keys (as 244's and 290's suites).
CREATE TEMP TABLE n292_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n292_roles VALUES
 (pg_temp.n292_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n292_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n292_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 -- A role that can be scoped to a direction holds only direction-capable keys (the staff.task.* keys cannot be).
 (pg_temp.n292_id(1106), 'Admissions direction head', '["case.curator.assign","case.read.full","case.read.summary","case.route.manage","case.workflow.read"]', 1160),
 -- The two halves of a head's authority, to be scoped differently (reading a case / assigning its curator).
 (pg_temp.n292_id(1107), 'Case reader', '["case.read.full","case.read.summary"]', 1170),
 (pg_temp.n292_id(1108), 'Direction assigner', '["case.curator.assign"]', 1180),
 (pg_temp.n292_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n292_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n292_grants VALUES
 (302, pg_temp.n292_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n292_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n292_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (303, pg_temp.n292_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n292_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n292_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n292_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n292_id(902), 'resourceKind', NULL)),
 (307, pg_temp.n292_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL)),
 -- 309: the direction head scoped to ONE direction (CN): it reads and assigns only cases whose direction is CN.
 (309, pg_temp.n292_id(1106), jsonb_build_object('kind', 'direction', 'key', 'CN', 'resourceKind', NULL)),
 (309, pg_temp.n292_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL)),
 -- 310: reads in the whole organization, assigns curators only for the direction CN.
 (310, pg_temp.n292_id(1107), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL)),
 (310, pg_temp.n292_id(1108), jsonb_build_object('kind', 'direction', 'key', 'CN', 'resourceKind', NULL)),
 -- 311: reads only the direction CN, assigns curators in the whole organization.
 (311, pg_temp.n292_id(1107), jsonb_build_object('kind', 'direction', 'key', 'CN', 'resourceKind', NULL)),
 (311, pg_temp.n292_id(1108), jsonb_build_object('kind', 'organization', 'key', pg_temp.n292_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n292_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n292_id(1);
GRANT SELECT ON n292_roles, n292_grants, n292_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n292_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n292_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n292_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n292_admin_setup';
SET LOCAL ROLE authenticated;
DO $n292_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n292_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n292_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N292 ' || r.label, 'description', 'Migration 292 synthetic role',
        'permissionKeys', r.keys), 'N292 create role', pg_temp.n292_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n292_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n292_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N292 publish role', pg_temp.n292_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n292_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id, g.scope::TEXT),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id, g.scope::TEXT)
      INTO items, bindings FROM n292_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n292_id(1), pg_temp.n292_id(m),
      (SELECT access_version FROM n292_versions WHERE membership_id = pg_temp.n292_id(m)), items, bindings,
      'N292 grant roles', pg_temp.n292_id(2000 + m));
  END LOOP;
END
$n292_roles$;
RESET ROLE;

UPDATE n292_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n292_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n292_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n292_admin FROM n292_actors WHERE n = 1 \gset
SELECT claims AS n292_sales FROM n292_actors WHERE n = 2 \gset
SELECT claims AS n292_a FROM n292_actors WHERE n = 3 \gset
SELECT claims AS n292_b FROM n292_actors WHERE n = 4 \gset
SELECT claims AS n292_student FROM n292_actors WHERE n = 5 \gset
SELECT claims AS n292_manager FROM n292_actors WHERE n = 7 \gset
SELECT claims AS n292_other_admin FROM n292_actors WHERE n = 8 \gset
SELECT claims AS n292_cn_manager FROM n292_actors WHERE n = 9 \gset
SELECT claims AS n292_split_a FROM n292_actors WHERE n = 10 \gset
SELECT claims AS n292_split_b FROM n292_actors WHERE n = 11 \gset
SELECT jsonb_build_object('sub', pg_temp.n292_id(199), 'role', 'authenticated')::TEXT AS n292_no_member \gset

-- ---------------------------------------------------------------------------
-- Cases, through the real 281 command as the Admin. 1 CN with curator A (changed
-- CN -> MY -> EUROPE below); 2 MY with curator B; 3 MY with no curator (pending;
-- its direction is cleared below); 4 CN with curator A (closed below); 5 CN with
-- curator A (bound to the CN playbook below); 6 CN with curator A (lockout).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5001), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student One', 'phone', '+996 555 292 001'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r1 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5002), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Two', 'phone', '+996 555 292 002'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n292_id(304)::TEXT)) AS n292_r2 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5003), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Three', 'phone', '+996 555 292 003'),
  'route', jsonb_build_object('country', 'MY'))) AS n292_r3 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5004), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Four', 'phone', '+996 555 292 004'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r4 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5005), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Five', 'phone', '+996 555 292 005'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r5 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5006), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Six', 'phone', '+996 555 292 006'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r6 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5007), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Seven', 'phone', '+996 555 292 007'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r7 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n292_id(1), pg_temp.n292_id(5008), jsonb_build_object(
  'student', jsonb_build_object('name', 'N292 Student Eight', 'phone', '+996 555 292 008'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n292_id(303)::TEXT)) AS n292_r8 \gset
RESET ROLE;
SELECT :'n292_r1'::JSONB ->> 'student_case_id' AS n292_case1 \gset
SELECT :'n292_r2'::JSONB ->> 'student_case_id' AS n292_case2 \gset
SELECT :'n292_r3'::JSONB ->> 'student_case_id' AS n292_case3 \gset
SELECT :'n292_r4'::JSONB ->> 'student_case_id' AS n292_case4 \gset
SELECT :'n292_r5'::JSONB ->> 'student_case_id' AS n292_case5 \gset
SELECT :'n292_r6'::JSONB ->> 'student_case_id' AS n292_case6 \gset
SELECT :'n292_r7'::JSONB ->> 'student_case_id' AS n292_case7 \gset
SELECT :'n292_r8'::JSONB ->> 'student_case_id' AS n292_case8 \gset
SELECT pg_temp.n292_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n292_id(303)
    AND c.admissions_direction = 'CN' AND c.admissions_playbook_version_id IS NULL
  FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID), 'fixture: case 1 is active with curator A and direction CN, no playbook');
SELECT pg_temp.n292_assert((SELECT c.state = 'pending' AND c.current_curator_membership_id IS NULL AND c.admissions_direction = 'MY'
  FROM platform.student_cases c WHERE c.id = :'n292_case3'::UUID), 'fixture: case 3 waits for a curator');

-- The cases carry a next step and a due day, so that clearing them would show in the 'nothing else changed' proofs.
UPDATE platform.student_cases SET next_action = 'N292 next step', next_action_due_on = DATE '2026-12-01'
  WHERE id IN (:'n292_case1'::UUID, :'n292_case3'::UUID, :'n292_case6'::UUID);
-- Case 3 has no direction (a sales-made case); case 4 is closed; case 5 is bound to the CN playbook.
UPDATE platform.student_cases SET admissions_direction = NULL WHERE id = :'n292_case3'::UUID;
UPDATE platform.student_cases SET state = 'closed', closed_at = statement_timestamp() WHERE id = :'n292_case4'::UUID;
UPDATE platform.student_cases SET admissions_playbook_version_id = (SELECT v.id FROM platform_private.admissions_playbook_versions v
      WHERE v.direction = 'CN' ORDER BY v.published_at DESC, v.id LIMIT 1),
    admissions_version = 1, admissions_outcome = 'active'
  WHERE id = :'n292_case5'::UUID;
SELECT pg_temp.n292_assert((SELECT c.admissions_direction IS NULL AND c.state = 'pending' AND c.admissions_version = 0
  FROM platform.student_cases c WHERE c.id = :'n292_case3'::UUID), 'fixture: case 3 has no direction and version 0');
SELECT pg_temp.n292_assert((SELECT c.state = 'closed' FROM platform.student_cases c WHERE c.id = :'n292_case4'::UUID), 'fixture: case 4 is closed');
SELECT pg_temp.n292_assert((SELECT c.admissions_playbook_version_id IS NOT NULL AND c.admissions_direction = 'CN' AND c.admissions_version = 1
  FROM platform.student_cases c WHERE c.id = :'n292_case5'::UUID), 'fixture: case 5 is bound to the CN playbook');
SELECT pg_temp.n292_assert((SELECT c.admissions_direction = 'CN' AND c.admissions_version = 0
  FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID), 'fixture: case 1 reads CN, version 0');

-- ---------------------------------------------------------------------------
-- B/bound table facts: an empty direction on a bound case cannot exist.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_assert(pg_temp.n292_error(format('UPDATE platform.student_cases SET admissions_direction = NULL WHERE id = %L',
    :'n292_case5')) ~ '^(55000|23514):', 'B: the table refuses an empty direction on a bound case (guard trigger or binding shape)');

-- ---------------------------------------------------------------------------
-- D. Denials (42501), checked first so nothing is changed by an allowed caller.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_audits() AS n292_audits_0 \gset
SET LOCAL request.jwt.claims TO :'n292_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7001)) ~ '^42501:',
  'D: the case''s own curator (case.route.manage, no case.curator.assign) is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7002)) ~ '^42501:',
  'D: another curator is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7003)) ~ '^42501:',
  'D: the Sales Manager is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7004)) ~ '^42501:',
  'D: the Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7005)) ~ '^42501:',
  'D: a user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7006)) ~ '^42501:',
  'D: the Admin of another organization is refused with this organization id');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(2), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7007)) ~ '^42501:',
  'D: the Admin of another organization is refused with its own organization id');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', '0', pg_temp.n292_id(7008)) ~ '^42501:',
  'D: the Admissions Manager cannot set the direction of a pending case outside its department''s reach');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(2), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7009)) ~ '^42501:',
  'D: the Admin asking with another organization id is refused');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), pg_temp.n292_id(9999), 'MY', '0', pg_temp.n292_id(7010)) ~ '^42501:',
  'D: an unknown case is refused like any other, no existence leak');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7011)) LIKE '42501:permission denied for %',
  'D: anon has no EXECUTE');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7012)) LIKE '42501:permission denied for %',
  'D: service_role has no EXECUTE');
RESET ROLE;
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_0'::BIGINT, 'D: no refusal wrote an audit row');
SELECT pg_temp.n292_assert((SELECT c.admissions_direction = 'CN' AND c.admissions_version = 0 FROM platform.student_cases c
  WHERE c.id = :'n292_case1'::UUID), 'D: no refusal changed the case');

-- ---------------------------------------------------------------------------
-- I. Input.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'IT', '0', pg_temp.n292_id(7101)) = '22023:case_direction_invalid'
    AND pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'CZ', '0', pg_temp.n292_id(7102)) = '22023:case_direction_invalid',
  'I: the six-country codes IT and CZ are not directions (they live in EUROPE)');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'cn', '0', pg_temp.n292_id(7103)) = '22023:case_direction_invalid'
    AND pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, '', '0', pg_temp.n292_id(7104)) = '22023:case_direction_invalid'
    AND pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'undecided', '0', pg_temp.n292_id(7105)) = '22023:case_direction_invalid'
    AND pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'unknown', '0', pg_temp.n292_id(7106)) = '22023:case_direction_invalid',
  'I: lower case, empty and made-up values are refused');
SELECT pg_temp.n292_assert(pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(NULL, %L, %L, 0, %L)', :'n292_case1', 'MY', pg_temp.n292_id(7107))) = '22023:case_direction_invalid'
    AND pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(%L, NULL, %L, 0, %L)', pg_temp.n292_id(1), 'MY', pg_temp.n292_id(7108))) = '22023:case_direction_invalid'
    AND pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(%L, %L, NULL, 0, %L)', pg_temp.n292_id(1), :'n292_case1', pg_temp.n292_id(7109))) = '22023:case_direction_invalid'
    AND pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(%L, %L, %L, NULL, %L)', pg_temp.n292_id(1), :'n292_case1', 'MY', pg_temp.n292_id(7110))) = '22023:case_direction_invalid'
    AND pg_temp.n292_error(format('SELECT platform.set_student_case_direction_v1(%L, %L, %L, 0, NULL)', pg_temp.n292_id(1), :'n292_case1', 'MY')) = '22023:case_direction_invalid',
  'I: NULL arguments are refused');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '-1', pg_temp.n292_id(7111)) = '22023:case_direction_invalid'
    AND pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '9223372036854775807', pg_temp.n292_id(7112)) = '22023:case_direction_invalid',
  'I: a negative or largest-bigint expected version is refused');
RESET ROLE;
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_0'::BIGINT, 'I: no invalid call wrote an audit row');

-- ---------------------------------------------------------------------------
-- B. A case bound to a playbook, and C. a closed case: refused, nothing changes.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_effects(:'n292_case5'::UUID) AS n292_fx5_before \gset
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case5'::UUID, 'MY', '1', pg_temp.n292_id(7201)) = '22023:case_direction_playbook_bound',
  'B: a bound case refuses another direction with the regulation message');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case5'::UUID, 'CN', '1', pg_temp.n292_id(7202)) = '22023:case_direction_playbook_bound',
  'B: a bound case refuses even the same direction');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case5'::UUID, 'EUROPE', '0', pg_temp.n292_id(7203)) = '22023:case_direction_playbook_bound',
  'B: a bound case refuses before it looks at the version');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case4'::UUID, 'MY', '0', pg_temp.n292_id(7204)) = '22023:case_direction_case_closed',
  'C: a closed case is refused');
RESET ROLE;
SELECT pg_temp.n292_assert(pg_temp.n292_effects(:'n292_case5'::UUID) = :'n292_fx5_before'::JSONB
    AND (SELECT c.admissions_direction = 'CN' AND c.admissions_version = 1 FROM platform.student_cases c WHERE c.id = :'n292_case5'::UUID)
    AND (SELECT c.admissions_direction = 'CN' AND c.admissions_version = 0 FROM platform.student_cases c WHERE c.id = :'n292_case4'::UUID)
    AND pg_temp.n292_audits() = :'n292_audits_0'::BIGINT,
  'B/C: the bound and the closed case are unchanged, no audit row');

-- ---------------------------------------------------------------------------
-- S. Success. The Admin sets a direction on a case that has none (case 3).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_effects(:'n292_case3'::UUID) AS n292_fx3_before \gset
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', 0, pg_temp.n292_id(7301)) AS n292_set3 \gset
RESET ROLE;
SELECT pg_temp.n292_assert(:'n292_set3'::JSONB ->> 'organization_id' = pg_temp.n292_id(1)::TEXT
    AND :'n292_set3'::JSONB ->> 'student_case_id' = :'n292_case3'
    AND :'n292_set3'::JSONB ->> 'admissions_direction' = 'CN'
    AND :'n292_set3'::JSONB ->> 'admissions_version' = '1'
    AND (:'n292_set3'::JSONB ->> 'changed')::BOOLEAN
    AND :'n292_set3'::JSONB ->> 'request_id' = pg_temp.n292_id(7301)::TEXT
    AND (:'n292_set3'::JSONB ->> 'changed_at') IS NOT NULL
    AND (SELECT count(*) = 7 FROM jsonb_object_keys(:'n292_set3'::JSONB)),
  'S: the receipt is the committed row (direction CN, version 1, changed, request id, time) in 7 keys');
SELECT pg_temp.n292_assert((SELECT c.admissions_direction = 'CN' AND c.admissions_version = 1 AND c.state = 'pending'
    AND c.current_curator_membership_id IS NULL AND c.admissions_playbook_version_id IS NULL
  FROM platform.student_cases c WHERE c.id = :'n292_case3'::UUID),
  'S: case 3 reads CN, version 1, still pending without a curator and without a playbook');
SELECT pg_temp.n292_assert(pg_temp.n292_effects(:'n292_case3'::UUID) = :'n292_fx3_before'::JSONB,
  'S: nothing else changed on case 3 (row but direction/version/updated_at, tasks, events, money, applications, lead interest)');
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_0'::BIGINT + 1, 'S: exactly one audit row was written');
SELECT pg_temp.n292_assert((SELECT a.action = 'case.direction.set' AND a.resource_type = 'student_case' AND a.resource_id = :'n292_case3'::UUID
    AND a.actor_kind = 'user' AND a.actor_membership_id = pg_temp.n292_id(301) AND a.resulting_version = 1
    AND a.before_state = '{"admissions_direction": null, "admissions_version": "0"}'::JSONB
    AND a.after_state = '{"admissions_direction": "CN", "admissions_version": "1"}'::JSONB
    AND a.reason = 'Case direction set'
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n292_id(7301)),
  'S: the audit row has the action, the case, the actor and only the direction codes and versions (empty -> CN)');

-- The Admin changes a set direction (case 1: CN -> MY, version 0 -> 1).
SELECT pg_temp.n292_effects(:'n292_case1'::UUID) AS n292_fx1_before \gset
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', 0, pg_temp.n292_id(7302)) AS n292_set1 \gset
RESET ROLE;
SELECT pg_temp.n292_assert(:'n292_set1'::JSONB ->> 'admissions_direction' = 'MY' AND :'n292_set1'::JSONB ->> 'admissions_version' = '1'
    AND (:'n292_set1'::JSONB ->> 'changed')::BOOLEAN
    AND (SELECT c.admissions_direction = 'MY' AND c.admissions_version = 1 AND c.current_curator_membership_id = pg_temp.n292_id(303)
        AND c.state = 'active' AND c.operational_stage = 'intake' AND c.admissions_playbook_version_id IS NULL
      FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID),
  'S: CN -> MY: the case reads MY, version 1; its curator, state and stage are the same');
SELECT pg_temp.n292_assert(pg_temp.n292_effects(:'n292_case1'::UUID) = :'n292_fx1_before'::JSONB,
  'S: nothing else changed on case 1 (target_country included: the free-text route is not rewritten)');
SELECT pg_temp.n292_assert((SELECT a.before_state = '{"admissions_direction": "CN", "admissions_version": "0"}'::JSONB
    AND a.after_state = '{"admissions_direction": "MY", "admissions_version": "1"}'::JSONB AND a.reason = 'Case direction changed'
    AND a.resulting_version = 1
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n292_id(7302)),
  'S: the audit row of a change has CN -> MY and the versions');
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_0'::BIGINT + 2, 'S: two writes, two audit rows');

-- The Admissions Manager of the department changes the case of its department (case 1: MY -> EUROPE, version 1 -> 2).
SELECT pg_temp.n292_effects(:'n292_case1'::UUID) AS n292_fx1_mid \gset
SET LOCAL request.jwt.claims TO :'n292_manager';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case1'::UUID, 'EUROPE', 1, pg_temp.n292_id(7303)) AS n292_set1b \gset
RESET ROLE;
SELECT pg_temp.n292_assert(:'n292_set1b'::JSONB ->> 'admissions_direction' = 'EUROPE' AND :'n292_set1b'::JSONB ->> 'admissions_version' = '2'
    AND (SELECT c.admissions_direction = 'EUROPE' AND c.admissions_version = 2 FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID)
    AND pg_temp.n292_effects(:'n292_case1'::UUID) = :'n292_fx1_mid'::JSONB
    AND (SELECT a.actor_membership_id = pg_temp.n292_id(307) FROM platform.audit_events a WHERE a.request_id = pg_temp.n292_id(7303)),
  'S: the Admissions Manager (department scope) changes the direction of its department''s case, nothing else changes, and is the audit actor');

-- ---------------------------------------------------------------------------
-- N. No-op and replay (case 1 now reads EUROPE, version 2).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_audits() AS n292_audits_1 \gset
SELECT updated_at AS n292_updated_1 FROM platform.student_cases WHERE id = :'n292_case1'::UUID \gset
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
-- The same value with a STALE version: nothing to overwrite, so no error.
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case1'::UUID, 'EUROPE', 0, pg_temp.n292_id(7401)) AS n292_noop \gset
-- The exact replay of the first write of case 3 (same request id, same payload).
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', 0, pg_temp.n292_id(7301)) AS n292_replay \gset
SELECT pg_temp.n292_assert(:'n292_noop'::JSONB ->> 'admissions_direction' = 'EUROPE' AND :'n292_noop'::JSONB ->> 'admissions_version' = '2'
    AND NOT (:'n292_noop'::JSONB ->> 'changed')::BOOLEAN AND :'n292_noop'::JSONB -> 'changed_at' = 'null'::JSONB
    AND (SELECT count(*) = 7 FROM jsonb_object_keys(:'n292_noop'::JSONB)),
  'N: the same value answers changed=false with the current version, in the same 7 keys');
SELECT pg_temp.n292_assert(:'n292_replay'::JSONB = :'n292_set3'::JSONB,
  'N: the exact replay returns the original receipt, time included');
-- The same request id with another payload / case / actor is a conflict.
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case3'::UUID, 'MY', '0', pg_temp.n292_id(7301)) = '22023:case_direction_request_conflict',
  'N: the same request id with another direction is a conflict');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case2'::UUID, 'CN', '0', pg_temp.n292_id(7301)) = '22023:case_direction_request_conflict',
  'N: the same request id on another case is a conflict');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', '5', pg_temp.n292_id(7301)) = '22023:case_direction_request_conflict',
  'N: the same request id with another expected version is a conflict');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'MY', '0', pg_temp.n292_id(7302)) = '22023:case_direction_request_conflict',
  'N: the request id of another actor''s write is a conflict even with the identical payload');
RESET ROLE;
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_1'::BIGINT
    AND (SELECT c.admissions_version = 2 AND c.updated_at = :'n292_updated_1'::TIMESTAMPTZ FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID)
    AND (SELECT c.admissions_direction = 'CN' AND c.admissions_version = 1 FROM platform.student_cases c WHERE c.id = :'n292_case3'::UUID),
  'N: the no-op, the replay and the conflicts changed nothing: no audit row, version and updated_at kept');

-- ---------------------------------------------------------------------------
-- V. Version: a stale expected version is PT409 (case 1 is at version 2).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'TR', '1', pg_temp.n292_id(7501)) = 'PT409:case_direction_version_conflict',
  'V: a stale expected version is a conflict');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case1'::UUID, 'TR', '3', pg_temp.n292_id(7502)) = 'PT409:case_direction_version_conflict',
  'V: an expected version ahead of the case is a conflict too');
RESET ROLE;
-- The largest bigint on the case cannot be incremented.
UPDATE platform.student_cases SET admissions_version = 9223372036854775807 WHERE id = :'n292_case2'::UUID;
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case2'::UUID, 'TR', '9223372036854775806', pg_temp.n292_id(7503)) = 'PT409:case_direction_version_conflict',
  'V: a case already at the largest bigint refuses (it cannot be incremented)');
RESET ROLE;
UPDATE platform.student_cases SET admissions_version = 0 WHERE id = :'n292_case2'::UUID;
SELECT pg_temp.n292_assert(pg_temp.n292_audits() = :'n292_audits_1'::BIGINT
    AND (SELECT c.admissions_direction = 'EUROPE' AND c.admissions_version = 2 FROM platform.student_cases c WHERE c.id = :'n292_case1'::UUID),
  'V: no conflict wrote an audit row or changed the case');

-- ---------------------------------------------------------------------------
-- L. Lockout and the visibility effect (case 6 is CN; 9 is a manager scoped to CN).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n292_cn_manager';
SET LOCAL ROLE authenticated;
SELECT private.platform_can_read_student_case(pg_temp.n292_id(1), :'n292_case6'::UUID) AS n292_cn_reads6 \gset
SELECT pg_temp.n292_assert(:'n292_cn_reads6' = 't', 'L: fixture: the CN-scoped manager reads a CN case');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case6'::UUID, 'MY', '0', pg_temp.n292_id(7601)) = '22023:case_direction_actor_access_lost',
  'L: the CN-scoped manager cannot move a CN case to MY: it would lose the case');
SELECT private.platform_can_read_student_case(pg_temp.n292_id(1), :'n292_case3'::UUID) AS n292_cn_reads3_before \gset
RESET ROLE;
SELECT pg_temp.n292_assert((SELECT c.admissions_direction = 'CN' AND c.admissions_version = 0 FROM platform.student_cases c WHERE c.id = :'n292_case6'::UUID)
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id = pg_temp.n292_id(7601)),
  'L: the refused lockout rolled back: direction and version kept, no audit row');
-- Case 3 is CN now (set above), so the CN manager reads it; move it away and the manager loses it, back and it returns.
SELECT pg_temp.n292_assert(:'n292_cn_reads3_before' = 't', 'L: the CN-scoped manager reads case 3 once the Admin has set CN on it');
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case3'::UUID, 'MY', 1, pg_temp.n292_id(7602)) AS n292_move3 \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_cn_manager';
SET LOCAL ROLE authenticated;
SELECT private.platform_can_read_student_case(pg_temp.n292_id(1), :'n292_case3'::UUID) AS n292_cn_reads3_after \gset
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', '2', pg_temp.n292_id(7603)) ~ '^42501:',
  'L: the CN-scoped manager cannot act on a case that left its direction');
RESET ROLE;
SELECT pg_temp.n292_assert(:'n292_cn_reads3_after' = 'f' AND (:'n292_move3'::JSONB ->> 'admissions_version') = '2',
  'L: CN -> MY took case 3 away from the CN-scoped manager (the direction decides who sees the case)');
-- A case with no direction is invisible to a direction-scoped manager.
UPDATE platform.student_cases SET admissions_direction = NULL, admissions_version = 0 WHERE id = :'n292_case3'::UUID;
SET LOCAL request.jwt.claims TO :'n292_cn_manager';
SET LOCAL ROLE authenticated;
SELECT private.platform_can_read_student_case(pg_temp.n292_id(1), :'n292_case3'::UUID) AS n292_cn_reads3_null \gset
SELECT pg_temp.n292_assert(:'n292_cn_reads3_null' = 'f', 'L: a case with no direction is invisible to a direction-scoped manager');
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case3'::UUID, 'CN', '0', pg_temp.n292_id(7604)) ~ '^42501:',
  'L: ... and it cannot set its direction either');
RESET ROLE;

-- Only ONE half of the authority is tied to the direction: the lockout guard must look at both rights.
SELECT pg_temp.n292_effects(:'n292_case7'::UUID) AS n292_fx7_before \gset
SELECT pg_temp.n292_effects(:'n292_case8'::UUID) AS n292_fx8_before \gset
SET LOCAL request.jwt.claims TO :'n292_split_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case7'::UUID, 'MY', '0', pg_temp.n292_id(7701)) = '22023:case_direction_actor_access_lost',
  'L: reading in the organization is not enough: assigning scoped to CN would be lost, so the move is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_split_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case8'::UUID, 'MY', '0', pg_temp.n292_id(7702)) = '22023:case_direction_actor_access_lost',
  'L: assigning in the organization is not enough: reading scoped to CN would be lost, so the move is refused');
RESET ROLE;
SELECT pg_temp.n292_assert(pg_temp.n292_effects(:'n292_case7'::UUID) = :'n292_fx7_before'::JSONB
    AND pg_temp.n292_effects(:'n292_case8'::UUID) = :'n292_fx8_before'::JSONB
    AND (SELECT count(*) = 2 FROM platform.student_cases c WHERE c.id IN (:'n292_case7'::UUID, :'n292_case8'::UUID)
      AND c.admissions_direction = 'CN' AND c.admissions_version = 0)
    AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id IN (pg_temp.n292_id(7701), pg_temp.n292_id(7702))),
  'L: both refused moves rolled back (direction CN, version 0, no audit row)');
-- Once the Admin has moved case 7 away from CN, the organization reader whose assigning right is tied to CN can still read
-- the case but can no longer act on it.
SET LOCAL request.jwt.claims TO :'n292_admin';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_direction_v1(pg_temp.n292_id(1), :'n292_case7'::UUID, 'MY', 0, pg_temp.n292_id(7703)) AS n292_move7 \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n292_split_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n292_assert(pg_temp.n292_set(pg_temp.n292_id(1), :'n292_case7'::UUID, 'CN', '1', pg_temp.n292_id(7704)) ~ '^42501:',
  'L: after the Admin moved case 7 to MY the organization reader without the assigning right for MY is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- P. Posture.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n292_assert((SELECT p.proowner = 'postgres'::regrole AND p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig = ARRAY['search_path=""'] AND p.proacl::TEXT = '{postgres=X/postgres,authenticated=X/postgres}'
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    FROM pg_proc p WHERE p.oid = 'platform.set_student_case_direction_v1(uuid,uuid,text,bigint,uuid)'::regprocedure),
  'P: postgres-owned SECURITY DEFINER VOLATILE with an empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.n292_assert((SELECT count(*) = 1 FROM pg_proc p WHERE p.proname = 'set_student_case_direction_v1'),
  'P: one function, no overloads, only in platform');
SELECT pg_temp.n292_assert((SELECT pg_get_constraintdef(k.oid) ~ '''CN''.*''MY''.*''EUROPE''.*''AE''.*''TR'''
    FROM pg_constraint k WHERE k.conrelid = 'platform.student_cases'::regclass AND k.conname = 'student_cases_admissions_direction_check'),
  'P: the direction CHECK keeps its five values (the command did not widen it)');

SELECT 'N292_CASE_DIRECTION_SUITE_PASSED' AS n292_suite_marker;
ROLLBACK;
