\set ON_ERROR_STOP on
-- «Сегодня» — сроки вузов на 14 дней (Э3 плана редизайна, PLAN_CHANGES
-- 27.09.2026). The band reuses the EXISTING read
-- platform.admissions_deadline_page_v1 (145) — no migration. This suite runs
-- on the LATEST chain (after every migration) and proves the read's
-- authorization both ways with members modelled EXACTLY like production,
-- the fixture shape of the 244/248/249 suites
-- (supabase/tests/platform_case_decline_guard.sql): invited staff have
-- organization_memberships.current_role NULL, so
-- current_actor_authority().platform_role is NULL and the JWT says 'staff';
-- permissions come only from scoped role assignments with the production
-- permission keys: Admissions (35 keys, own scope), Admissions Manager (36
-- keys, department scope), Sales Manager (23 keys, department scope) and the
-- two «общие разделы» roles (organization scope). Only the system Admin
-- carries the coarse role.
-- Proves:
--  1. the gate is the application.manage permission (156's
--     require_admissions_runtime_actor, not a coarse role): a curator with the
--     production Admissions role passes with platform_role NULL; the Sales
--     Manager, a member holding case.read.full WITHOUT application.manage,
--     the Student, an authenticated user without membership and anon are
--     refused (42501);
--  2. rows are exactly the ACTIVE cases the caller may read
--     (private.platform_can_read_student_case, 248): a curator sees the
--     deadlines of the own case and never another curator's or the Admin's;
--     the Admissions Manager sees the cases curated in its department; the
--     Admin sees every active case; closed and pending cases never appear;
--  3. the application deadline of the band is the recorded
--     university_deadline_on of an application in preparation or ready
--     (a submitted application no longer carries it, even once passed),
--     within the p_due_from/p_due_to window the page asks for
--     (today - 7 .. today + 14: a deadline that passed without submission
--     stays in the band for a week, the finish review of 27.09);
--     an application without a program (program_name NULL since 190) is a
--     row with a NULL program — the adapter must accept it;
--  4. the read keeps SECURITY DEFINER, the empty search_path and its grants.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

DO $t3d_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$t3d_auth_role$;

CREATE FUNCTION pg_temp.t3d_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('e3d00000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.t3d_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'T3D: %', message; END IF;
END
$$;
-- SQLSTATE of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.t3d_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$$;
-- The Bishkek day, the same day the page reads with.
CREATE FUNCTION pg_temp.t3d_today() RETURNS DATE LANGUAGE SQL STABLE AS $$
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE
$$;
-- The band's call: today - 7 .. today + 14, first page of 100 (the adapter
-- asks for 101 to learn whether a next page exists). Returns sorted
-- application ids of the rows.
CREATE FUNCTION pg_temp.t3d_band() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(d.application_id ORDER BY d.application_id), ARRAY[]::UUID[])
  FROM platform.admissions_deadline_page_v1(101, NULL, NULL, pg_temp.t3d_today() - 7, pg_temp.t3d_today() + 14) AS d
$$;
CREATE FUNCTION pg_temp.t3d_band_error() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.t3d_error(format('SELECT count(*) FROM platform.admissions_deadline_page_v1(101, NULL, NULL, %L, %L)',
    pg_temp.t3d_today() - 7, pg_temp.t3d_today() + 14))
$$;
CREATE FUNCTION pg_temp.t3d_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.t3d_id(x) ORDER BY pg_temp.t3d_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t3d_id(INTEGER), pg_temp.t3d_assert(BOOLEAN, TEXT), pg_temp.t3d_error(TEXT),
  pg_temp.t3d_today(), pg_temp.t3d_band(), pg_temp.t3d_band_error(), pg_temp.t3d_ids(INTEGER[])
  TO authenticated, anon;

SELECT 'T3D_TODAY_UNIVERSITY_DEADLINES_SUITE_START' AS t3d_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (sales department), 3 Admissions Manager, 4 Admissions A,
-- 6 Admissions B (admissions department), 7 a case reader without
-- application.manage (admissions department); 5 Student (case 505).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t3d_actors(n INTEGER, coarse platform.business_role);
INSERT INTO t3d_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL);
GRANT SELECT ON t3d_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.t3d_id(1), 'T3D Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.t3d_id(100 + n), 't3d-' || n || '@example.invalid', '{}'::JSONB FROM t3d_actors;
-- An authenticated identity with no membership at all.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.t3d_id(199), 't3d-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.t3d_id(200 + n), pg_temp.t3d_id(100 + n), 'T3D Actor ' || n, 'active', 1 FROM t3d_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.t3d_id(300 + n), pg_temp.t3d_id(1), pg_temp.t3d_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM t3d_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.t3d_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.t3d_id(401), pg_temp.t3d_id(1), 'organization', pg_temp.t3d_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.t3d_id(1), pg_temp.t3d_id(301), pg_temp.t3d_id(401), 1, 1, TRUE, 'system',
    'T3D synthetic organization scope', pg_temp.t3d_id(601));

-- Departments in the production shape: sales (2), admissions (3, 4, 6, 7).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.t3d_id(901), pg_temp.t3d_id(1), 'T3D Sales'),
  (pg_temp.t3d_id(902), pg_temp.t3d_id(1), 'T3D Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.t3d_id(1), pg_temp.t3d_id(302), pg_temp.t3d_id(901)),
  (pg_temp.t3d_id(1), pg_temp.t3d_id(303), pg_temp.t3d_id(902)),
  (pg_temp.t3d_id(1), pg_temp.t3d_id(304), pg_temp.t3d_id(902)),
  (pg_temp.t3d_id(1), pg_temp.t3d_id(306), pg_temp.t3d_id(902)),
  (pg_temp.t3d_id(1), pg_temp.t3d_id(307), pg_temp.t3d_id(902));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin; 504 closed, curator A; 505 active, curator A, the Student's
-- own case; 506 pending without curator.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.t3d_id(420 + k), pg_temp.t3d_id(1), 'student_case', pg_temp.t3d_id(500 + k), 1
  FROM generate_series(1, 6) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at, closed_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.t3d_id(500 + f.k), pg_temp.t3d_id(1), pg_temp.t3d_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.t3d_id(f.curator) END,
  'synthetic:t3d:' || f.k, 'T3D Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  CASE WHEN f.state = 'closed' THEN clock_timestamp() END,
  pg_temp.t3d_id(420 + f.k), 1, 'documents',
  CASE f.k WHEN 5 THEN pg_temp.t3d_id(305) END,
  CASE f.k WHEN 5 THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, 304, 'closed'), (5, 304, 'active'),
  (6, NULL, 'pending'))
  AS f(k, curator, state);
-- Applications with recorded deadlines (days after the Bishkek today):
-- 801 501 preparation +3; 802 501 submitted +5 (the application deadline is
-- no longer the band's once submitted); 803 501 ready, no program, +10;
-- 804 501 preparation +20 (outside the window); 805 502 preparation +2;
-- 806 503 preparation +1; 807 504 (closed) preparation +4; 808 506
-- (pending) preparation +4; 809 505 preparation today; 810 501 preparation
-- yesterday (passed without submission: in the band); 811 501 submitted -3
-- (passed, but submitted: out); 812 501 preparation -8 (before the window);
-- 813 501 ready -7 (the window's first day).
INSERT INTO platform.university_applications(id, organization_id, student_case_id, institution_name, program_name,
  status, latest_evidence_reference, created_by_membership_id, university_deadline_on, country, degree)
SELECT pg_temp.t3d_id(800 + a.n), pg_temp.t3d_id(1), pg_temp.t3d_id(a.case_no), 'T3D University ' || a.n, a.program,
  a.status::platform.application_status, CASE WHEN a.status = 'submitted' THEN 'synthetic:t3d:evidence' END,
  pg_temp.t3d_id(301), pg_temp.t3d_today() + a.days, 'MY', 'bachelor'
FROM (VALUES (1, 501, 'T3D Program 1', 'preparation', 3), (2, 501, 'T3D Program 2', 'submitted', 5),
  (3, 501, NULL, 'ready', 10), (4, 501, 'T3D Program 4', 'preparation', 20), (5, 502, 'T3D Program 5', 'preparation', 2),
  (6, 503, 'T3D Program 6', 'preparation', 1), (7, 504, 'T3D Program 7', 'preparation', 4),
  (8, 506, 'T3D Program 8', 'preparation', 4), (9, 505, 'T3D Program 9', 'preparation', 0),
  (10, 501, 'T3D Program 10', 'preparation', -1), (11, 501, 'T3D Program 11', 'submitted', -3),
  (12, 501, 'T3D Program 12', 'preparation', -8), (13, 501, 'T3D Program 13', 'ready', -7))
  AS a(n, case_no, program, status, days);
SET LOCAL session_replication_role = origin;
-- The Student signs in to the organization and reads only the own case
-- (student_case scope), the provisioned portal shape.
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.t3d_id(1), pg_temp.t3d_id(305), pg_temp.t3d_id(401), 1, 1, TRUE, 'system',
    'T3D synthetic Student organization scope', pg_temp.t3d_id(604)),
  (pg_temp.t3d_id(1), pg_temp.t3d_id(305), pg_temp.t3d_id(425), 1, 1, TRUE, 'system',
    'T3D synthetic Student case scope', pg_temp.t3d_id(605));

-- Roles with the EXACT production permission keys (26.09 read-only audit),
-- plus one reader role: case.read.full and profile.read.full, no
-- application.manage.
CREATE TEMP TABLE t3d_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO t3d_roles VALUES
 (pg_temp.t3d_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.t3d_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.t3d_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.t3d_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.t3d_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 (pg_temp.t3d_id(1106), 'Case reader', '["case.read.full","profile.read.full"]', 1160);
CREATE TEMP TABLE t3d_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO t3d_grants VALUES
 (302, pg_temp.t3d_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.t3d_id(901), 'resourceKind', NULL)),
 (302, pg_temp.t3d_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.t3d_id(1), 'resourceKind', NULL)),
 (303, pg_temp.t3d_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.t3d_id(902), 'resourceKind', NULL)),
 (303, pg_temp.t3d_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t3d_id(1), 'resourceKind', NULL)),
 (304, pg_temp.t3d_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.t3d_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t3d_id(1), 'resourceKind', NULL)),
 (306, pg_temp.t3d_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.t3d_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t3d_id(1), 'resourceKind', NULL)),
 (307, pg_temp.t3d_id(1106), jsonb_build_object('kind', 'department', 'key', pg_temp.t3d_id(902), 'resourceKind', NULL)),
 (307, pg_temp.t3d_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.t3d_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE t3d_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.t3d_id(1);
GRANT SELECT ON t3d_roles, t3d_grants, t3d_versions TO authenticated;

SELECT pg_temp.t3d_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM t3d_roles)
  = ARRAY[35, 36, 23, 12, 16, 2], 'role bundles have the production key counts 35/36/23/12/16 and the 2-key reader');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.t3d_id(101),
  'claims', jsonb_build_object('sub', pg_temp.t3d_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS t3d_admin_setup \gset
SET LOCAL request.jwt.claims TO :'t3d_admin_setup';
SET LOCAL ROLE authenticated;
DO $t3d_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM t3d_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.t3d_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'T3D ' || r.label, 'description', 'Today deadlines synthetic role',
        'permissionKeys', r.keys), 'T3D create role', pg_temp.t3d_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.t3d_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.t3d_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'T3D publish role', pg_temp.t3d_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM t3d_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM t3d_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.t3d_id(1), pg_temp.t3d_id(m),
      (SELECT access_version FROM t3d_versions WHERE membership_id = pg_temp.t3d_id(m)), items, bindings,
      'T3D grant roles', pg_temp.t3d_id(2000 + m));
  END LOOP;
END
$t3d_roles$;
RESET ROLE;

SELECT jsonb_build_object('sub', pg_temp.t3d_id(199), 'role', 'authenticated')::TEXT AS t3d_no_member \gset
-- Claims minted by the installed token hook from the live rows, as a client
-- does after its token refresh.
CREATE FUNCTION pg_temp.t3d_as(n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
    'user_id', pg_temp.t3d_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.t3d_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
END
$$;
SELECT pg_temp.t3d_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.t3d_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.t3d_ids(302, 303, 304, 306, 307))), 'invited members have coarse role and bundle NULL');

-- ---------------------------------------------------------------------------
-- 1–2. Who reads which deadlines.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t3d_as(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert((SELECT count(*) = 1 AND bool_and(platform_role IS NULL AND membership_id = pg_temp.t3d_id(304))
  FROM platform.current_actor_authority()), 'Admissions A resolves with platform_role NULL');
SELECT pg_temp.t3d_assert(pg_temp.t3d_band() = pg_temp.t3d_ids(801, 803, 809, 810, 813),
  'Admissions A reads the deadlines of the own active cases only (501, 505): not 502, 503, closed 504 or pending 506');
SELECT pg_temp.t3d_assert((SELECT bool_and(d.deadline_kind = 'application' AND d.student_case_id IN (pg_temp.t3d_id(501), pg_temp.t3d_id(505))
    AND d.source_key = 'application:' || d.application_id::TEXT || ':application')
  FROM platform.admissions_deadline_page_v1(101, NULL, NULL, pg_temp.t3d_today() - 7, pg_temp.t3d_today() + 14) AS d),
  'every band row is an application deadline with its stable source key');
SELECT pg_temp.t3d_assert((SELECT d.program_name IS NULL AND d.university_name = 'T3D University 3'
    AND d.application_status = 'ready' AND d.deadline = pg_temp.t3d_today() + 10
  FROM platform.admissions_deadline_page_v1(101, NULL, NULL, pg_temp.t3d_today() - 7, pg_temp.t3d_today() + 14) AS d
  WHERE d.application_id = pg_temp.t3d_id(803)), 'an application without a program is a row with a NULL program');
SELECT pg_temp.t3d_assert((SELECT array_agg(d.application_id ORDER BY d.deadline, d.source_key COLLATE "C")
  FROM platform.admissions_deadline_page_v1(101, NULL, NULL, pg_temp.t3d_today() - 7, pg_temp.t3d_today() + 14) AS d)
  = ARRAY[pg_temp.t3d_id(813), pg_temp.t3d_id(810), pg_temp.t3d_id(809), pg_temp.t3d_id(801), pg_temp.t3d_id(803)],
  'rows come by deadline: passed ones first, then today');
SELECT pg_temp.t3d_assert((SELECT COALESCE(array_agg(d.application_id ORDER BY d.application_id), ARRAY[]::UUID[])
  FROM platform.admissions_deadline_page_v1(101, NULL, NULL, NULL, NULL) AS d)
  = pg_temp.t3d_ids(801, 803, 804, 809, 810, 812, 813),
  'without a window the curator also reads the later and the older passed deadline — the window is the page''s, the scope is the server''s');
SELECT pg_temp.t3d_assert(NOT (pg_temp.t3d_id(802) = ANY (pg_temp.t3d_band())),
  'a submitted application no longer carries the application deadline');
SELECT pg_temp.t3d_assert(pg_temp.t3d_id(810) = ANY (pg_temp.t3d_band()) AND pg_temp.t3d_id(813) = ANY (pg_temp.t3d_band()),
  'a deadline passed without submission stays in the band for 7 days (today - 7 .. today + 14)');
SELECT pg_temp.t3d_assert(NOT (pg_temp.t3d_id(811) = ANY (pg_temp.t3d_band())),
  'a submitted application''s passed deadline stays out');
SELECT pg_temp.t3d_assert(NOT (pg_temp.t3d_id(812) = ANY (pg_temp.t3d_band())),
  'a deadline passed before the window stays out');
RESET ROLE;

SELECT pg_temp.t3d_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band() = pg_temp.t3d_ids(805), 'Admissions B reads only the own case 502');
RESET ROLE;

SELECT pg_temp.t3d_as(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band() = pg_temp.t3d_ids(801, 803, 805, 809, 810, 813),
  'the Admissions Manager reads the active cases curated in its department, not the Admin''s 503');
RESET ROLE;

SELECT pg_temp.t3d_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band() = pg_temp.t3d_ids(801, 803, 805, 806, 809, 810, 813),
  'the Admin reads every active case; closed 504 and pending 506 never appear');
RESET ROLE;

-- Refusals: the gate is the permission, not the coarse role.
SELECT pg_temp.t3d_as(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band_error() = '42501', 'the Sales Manager (no application.manage) is refused');
RESET ROLE;
SELECT pg_temp.t3d_as(7);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert((SELECT count(*) FILTER (WHERE private.platform_can_read_student_case(pg_temp.t3d_id(1), pg_temp.t3d_id(500 + k))) >= 1
  FROM generate_series(1, 6) AS k), 'the case reader does read cases of its department');
SELECT pg_temp.t3d_assert(pg_temp.t3d_band_error() = '42501',
  'a member with case.read.full but without application.manage is refused — reading cases does not widen to this read');
RESET ROLE;
SELECT pg_temp.t3d_as(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band_error() = '42501', 'the Student is refused, even for the own case 505');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'t3d_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band_error() = '42501', 'an authenticated user without membership is refused');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t3d_assert(pg_temp.t3d_band_error() = '42501', 'an anonymous caller is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. The read keeps definer, search_path and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.t3d_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform.admissions_deadline_page_v1(integer,date,text,date,date)'::REGPROCEDURE),
  'admissions_deadline_page_v1: SECURITY DEFINER, empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.t3d_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform_private.admissions_deadline_rows(uuid)'::REGPROCEDURE),
  'the private row source stays without grants');

SELECT 'T3D_TODAY_UNIVERSITY_DEADLINES_SUITE_PASS' AS t3d_suite_marker;
ROLLBACK;
