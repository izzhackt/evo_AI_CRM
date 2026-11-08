\set ON_ERROR_STOP on
-- Boundary suite for migration 351 «Скорость кабинета и CRM». Runs on the LATEST chain inside one transaction that is
-- rolled back. Members are modelled like production after 155 (the fixture of 309: invited staff have coarse role NULL
-- and get permissions only from scoped role assignments with production keys; the Student cabinet is an activated-case
-- snapshot). Synthetic data only; no provider, no real person, no production action.
--
-- Migration 351 only rewrites HOW the access chain is evaluated (LANGUAGE sql -> plpgsql, one identity per call, one
-- pass over permissions in the snapshot, cheap predicates before a per-row check). This suite proves no decision moved:
--  1. the 15 rewritten functions keep SECURITY DEFINER, STABLE, an empty search_path and their EXECUTE grants; the new
--     staff_notification_visible_as is closed to anon, authenticated, service_role (as the original);
--  2. current_actor_authority: Admin, Sales Manager (coarse NULL), Curator and Student each get ONE row with their own
--     identity; a token that names another membership or organization, a stale access version and a user without a
--     membership get no row;
--  3. staff_access_snapshot: the permission list equals the list of staff_has_permission over every permission
--     definition (the old per-key evaluation) for Admin, Sales Manager and Curator; a Student gets NULL;
--  4. student_portal_cases: a Student reads exactly their own case, never the neighbour's; staff and a user without a
--     membership read none; a case not open for the cabinet is not read;
--  5. the bell page and poll answer staff and refuse a Student (full behaviour: suites 188 and 309).
BEGIN;

SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.p351_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('35500000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE TEMP TABLE p351_checks(n INTEGER);
CREATE FUNCTION pg_temp.p351_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'P351: %', message; END IF;
  INSERT INTO p351_checks VALUES (1);
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.p351_id(INTEGER) TO authenticated, anon, service_role;

SELECT 'P351_PORTAL_LIGHT_POLL_SUITE_START' AS p351_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. Organization one: 1 Admin (system), 2 Sales Manager and 3 Curator (coarse
-- role NULL, production roles below), 8 a second system Admin (the one who assigns tasks),
-- Students 4 (A, assisted), 5 (B, only approved: pending case), 6 (C, assisted, the
-- neighbour), 9 (E) and 10 (F), whose access is withdrawn later. Organization two:
-- 11 Admin, 13 Sales, 14 Curator and Student 7 (D). 12 is an Auth user with no membership.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE p351_actors(n INTEGER, org INTEGER, coarse platform.business_role);
INSERT INTO p351_actors(n, org, coarse) VALUES
  (1, 1, 'admin'), (2, 1, NULL), (3, 1, NULL), (4, 1, 'student'), (6, 1, 'student'),
  (11, 2, 'admin');

INSERT INTO platform.organizations(id, name) VALUES
  (pg_temp.p351_id(1), 'P351 Fictional organization one'),
  (pg_temp.p351_id(2), 'P351 Fictional organization two');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.p351_id(100 + n), 'p351-' || n || '@example.invalid', '{}'::JSONB FROM p351_actors
  UNION ALL SELECT pg_temp.p351_id(112), 'p351-12@example.invalid', '{}'::JSONB;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.p351_id(200 + n), pg_temp.p351_id(100 + n), 'P351 Actor ' || n, 'active', 1 FROM p351_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id, is_system_admin)
  SELECT pg_temp.p351_id(300 + a.n), pg_temp.p351_id(a.org), pg_temp.p351_id(200 + a.n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END,
    COALESCE(a.coarse = 'admin', FALSE)
  FROM p351_actors a;

INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.p351_id(401), pg_temp.p351_id(1), 'organization', pg_temp.p351_id(1), 1),
  (pg_temp.p351_id(402), pg_temp.p351_id(2), 'organization', pg_temp.p351_id(2), 1);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.p351_id(410 + a.n), pg_temp.p351_id(a.org), 'student_case', pg_temp.p351_id(500 + a.n), 1
  FROM p351_actors a WHERE a.coarse = 'student';
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p351_id(a.org), pg_temp.p351_id(300 + a.n), pg_temp.p351_id(400 + a.org), 1, 1, TRUE, 'system',
    'P351 synthetic organization scope', pg_temp.p351_id(600 + a.n)
  FROM p351_actors a;
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version, assignment_version, granted, actor_kind, reason, request_id)
  SELECT pg_temp.p351_id(a.org), pg_temp.p351_id(300 + a.n), pg_temp.p351_id(410 + a.n), 1, 1, TRUE, 'system',
    'P351 own case scope', pg_temp.p351_id(620 + a.n)
  FROM p351_actors a WHERE a.coarse = 'student';

-- Already-provisioned case snapshots (the p135/p192/p200 convention): the 042 BEFORE
-- trigger forbids pre-activated inserts, so replica mode skips it while every table
-- CHECK/FK still applies. Case n = 500 + the Student's number; B's case is pending.
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases (
  id, organization_id, student_membership_id, responsible_sales_membership_id,
  current_curator_membership_id, source_key, contract_confirmation_ref,
  contract_confirmed_at, student_display_name, target_country, target_degree,
  program_direction, intake, route_approval_status, operational_stage, state,
  handoff_at, portal_activated_at, current_scope_id, current_scope_version
)
SELECT pg_temp.p351_id(500 + a.n), pg_temp.p351_id(a.org), pg_temp.p351_id(300 + a.n),
  pg_temp.p351_id(300 + 2),
  pg_temp.p351_id(300 + 3),
  'synthetic:p351:assisted-' || a.n, 'synthetic:p351:contract-' || a.n,
  clock_timestamp(), 'P351 Student ' || a.n, 'China', 'Bachelor',
  'Engineering', '2027', 'approved', 'documents', 'active',
  clock_timestamp(), clock_timestamp(), pg_temp.p351_id(410 + a.n), 1
FROM p351_actors a WHERE a.coarse = 'student';
SET LOCAL session_replication_role = origin;

-- Tokens come from the real hook on live rows (a Student carries the pre-scoped claims,
-- invited staff coarse role NULL, a user with no membership only sub and role).
CREATE FUNCTION pg_temp.p351_claims(p_user INTEGER) RETURNS TEXT LANGUAGE sql AS $$
  SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.p351_id(100 + p_user),
    'claims', jsonb_build_object('sub', pg_temp.p351_id(100 + p_user), 'role', 'authenticated')))->'claims')::TEXT
$$;

-- Roles with the EXACT production permission keys (as 281's and 306's suites): Admissions for
-- the Curator (own scope, so it works its own cases), Sales Manager for the Sales member.
CREATE TEMP TABLE p351_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO p351_roles VALUES
 (pg_temp.p351_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.p351_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130);
CREATE TEMP TABLE p351_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO p351_grants VALUES
 (303, pg_temp.p351_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (302, pg_temp.p351_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.p351_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE p351_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.p351_id(1);
GRANT SELECT ON p351_roles, p351_grants, p351_versions TO authenticated;

SELECT pg_temp.p351_claims(1) AS p351_admin_setup \gset
SET LOCAL request.jwt.claims TO :'p351_admin_setup';
SET LOCAL ROLE authenticated;
DO $p351_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM p351_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.p351_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'P351 ' || r.label, 'description', 'Migration 309 synthetic role',
        'permissionKeys', r.keys), 'P351 create role', pg_temp.p351_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.p351_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.p351_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'P351 publish role', pg_temp.p351_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM p351_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM p351_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.p351_id(1), pg_temp.p351_id(m),
      (SELECT access_version FROM p351_versions WHERE membership_id = pg_temp.p351_id(m)), items, bindings,
      'P351 grant roles', pg_temp.p351_id(2000 + m));
  END LOOP;
END
$p351_roles$;
RESET ROLE;

CREATE FUNCTION pg_temp.p351_run(p_user INTEGER, p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', pg_temp.p351_claims(p_user), TRUE);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO r;
  RESET ROLE;
  RETURN r;
END
$$;
-- Same, with one claim replaced: how many authority rows does a doctored token get.
CREATE FUNCTION pg_temp.p351_tamper(p_user INTEGER, p_key TEXT, p_value TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE r TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', (pg_temp.p351_claims(p_user)::JSONB || jsonb_build_object(p_key, p_value))::TEXT, TRUE);
  SET LOCAL ROLE authenticated;
  SELECT count(*)::TEXT INTO r FROM platform.current_actor_authority();
  RESET ROLE;
  RETURN r;
END
$$;
CREATE FUNCTION pg_temp.p351_old_permissions(p_membership UUID) RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(d.permission_key ORDER BY d.permission_key), '[]'::JSONB)
  FROM platform.permission_definitions d
  WHERE platform_private.staff_has_permission(pg_temp.p351_id(1), p_membership, d.permission_key)
$$;

SELECT 'A351_PORTAL_SPEED_SUITE_START' AS p351_marker;

-- 1. Posture of the rewritten chain.
SELECT pg_temp.p351_assert((SELECT count(*) = 15 AND bool_and(l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 's'
    AND p.proconfig = ARRAY['search_path=""'])
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname, p.proname) IN (('platform_private','staff_membership_identity'),('platform_private','staff_has_permission'),
    ('platform_private','staff_context_can_access'),('platform_private','staff_access_evaluate'),('platform_private','staff_can_access'),
    ('platform_private','student_actor_pre_scoped_roles'),('platform_private','staff_can_access_for_actor'),
    ('platform_private','latest_membership_permission_grant'),('platform','current_actor_authority'),
    ('private','platform_has_permission'),('private','platform_has_scope'),('private','student_has_permission_pre_scoped_roles'),
    ('private','student_has_scope_pre_scoped_roles'),('private','platform_can_read_student_case'),
    ('private','platform_can_read_student_portal_case'))),
  'the 15 functions are plpgsql, SECURITY DEFINER, STABLE with an empty search_path');
SELECT pg_temp.p351_assert(
  (SELECT count(*) = 5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (('platform','current_actor_authority'),('private','platform_can_read_student_case'),
      ('private','platform_can_read_student_portal_case'),('private','platform_has_permission'),('private','platform_has_scope'))
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (SELECT count(*) = 10 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (('platform_private','staff_membership_identity'),('platform_private','staff_has_permission'),
      ('platform_private','staff_context_can_access'),('platform_private','staff_access_evaluate'),('platform_private','staff_can_access'),
      ('platform_private','student_actor_pre_scoped_roles'),('platform_private','staff_can_access_for_actor'),
      ('platform_private','latest_membership_permission_grant'),('private','student_has_permission_pre_scoped_roles'),
      ('private','student_has_scope_pre_scoped_roles'))
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
  'authenticated keeps EXECUTE on exactly the five functions it had; the ten private ones stay closed to authenticated and anon');
SELECT pg_temp.p351_assert(
  NOT has_function_privilege('authenticated', 'platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure, 'EXECUTE')
  AND (SELECT p.provolatile = 's' AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
       FROM pg_proc p WHERE p.oid = 'platform_private.staff_notification_visible_as(platform.staff_notifications,uuid)'::regprocedure),
  'staff_notification_visible_as is closed to anon, authenticated and service_role and is STABLE SECURITY DEFINER with an empty search_path');

-- 2. current_actor_authority: one row per real actor, none for anything else.
SELECT pg_temp.p351_assert(
  NOT EXISTS (SELECT 1 FROM (VALUES (1),(2),(3),(4),(6),(11)) v(u)
    WHERE pg_temp.p351_run(u, 'SELECT count(*)::TEXT FROM platform.current_actor_authority()') <> '1'),
  'Admin, Sales Manager, Curator, both Students and the other organization Admin each get exactly one authority row');
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(2, $q$SELECT membership_id::TEXT || '/' || COALESCE(platform_role::TEXT, 'null') FROM platform.current_actor_authority()$q$)
    = pg_temp.p351_id(302)::TEXT || '/null'
  AND pg_temp.p351_run(4, $q$SELECT membership_id::TEXT || '/' || platform_role::TEXT FROM platform.current_actor_authority()$q$)
    = pg_temp.p351_id(304)::TEXT || '/student'
  AND pg_temp.p351_run(1, $q$SELECT membership_id::TEXT || '/' || platform_role::TEXT FROM platform.current_actor_authority()$q$)
    = pg_temp.p351_id(301)::TEXT || '/admin',
  'each authority row carries the actor own membership and coarse role (staff NULL, Student, Admin)');
SELECT pg_temp.p351_assert(
  pg_temp.p351_tamper(2, 'platform_membership_id', pg_temp.p351_id(301)::TEXT) = '0'
  AND pg_temp.p351_tamper(2, 'platform_organization_id', pg_temp.p351_id(2)::TEXT) = '0'
  AND pg_temp.p351_tamper(4, 'platform_membership_id', pg_temp.p351_id(306)::TEXT) = '0'
  AND pg_temp.p351_tamper(4, 'platform_access_version', '999') = '0'
  AND pg_temp.p351_tamper(12, 'platform_membership_id', pg_temp.p351_id(301)::TEXT) = '0',
  'a token naming another membership or organization, a stale Student access version and a user with no membership get no authority row');

-- 3. staff_access_snapshot equals the old per-key evaluation; a Student gets NULL.
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(1, 'SELECT platform.staff_access_snapshot() -> ''permissions''')::JSONB = pg_temp.p351_old_permissions(pg_temp.p351_id(301))
  AND pg_temp.p351_run(2, 'SELECT platform.staff_access_snapshot() -> ''permissions''')::JSONB = pg_temp.p351_old_permissions(pg_temp.p351_id(302))
  AND pg_temp.p351_run(3, 'SELECT platform.staff_access_snapshot() -> ''permissions''')::JSONB = pg_temp.p351_old_permissions(pg_temp.p351_id(303)),
  'the snapshot permission list equals the per-key staff_has_permission list for Admin, Sales Manager and Curator');
SELECT pg_temp.p351_assert(
  jsonb_array_length(pg_temp.p351_old_permissions(pg_temp.p351_id(301))) > jsonb_array_length(pg_temp.p351_old_permissions(pg_temp.p351_id(302)))
  AND jsonb_array_length(pg_temp.p351_old_permissions(pg_temp.p351_id(302))) > 0
  AND pg_temp.p351_old_permissions(pg_temp.p351_id(302)) <> pg_temp.p351_old_permissions(pg_temp.p351_id(303)),
  'the three lists differ, so the equality above is not vacuous');
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(4, 'SELECT platform.staff_access_snapshot()::TEXT') IS NULL
  AND pg_temp.p351_run(12, 'SELECT platform.staff_access_snapshot()::TEXT') IS NULL,
  'a Student and a user with no membership get a NULL snapshot');
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(2, 'SELECT platform.staff_access_snapshot() ->> ''membershipId''') = pg_temp.p351_id(302)::TEXT
  AND pg_temp.p351_run(1, 'SELECT platform.staff_access_snapshot() ->> ''systemRole''') = 'admin'
  AND pg_temp.p351_run(2, 'SELECT platform.staff_access_snapshot() ->> ''systemRole''') = 'staff',
  'the snapshot keeps the identity keys of the old answer');

-- 4. student_portal_cases.
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(4, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '1'
  AND pg_temp.p351_run(4, 'SELECT case_id::TEXT FROM platform.student_portal_cases()') = pg_temp.p351_id(504)::TEXT
  AND pg_temp.p351_run(6, 'SELECT case_id::TEXT FROM platform.student_portal_cases()') = pg_temp.p351_id(506)::TEXT,
  'each Student reads exactly their own case');
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(1, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '0'
  AND pg_temp.p351_run(2, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '0'
  AND pg_temp.p351_run(11, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '0'
  AND pg_temp.p351_run(12, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '0',
  'Admin, Sales Manager, the other organization Admin and a user with no membership read no Student cabinet case');

-- 5. The bell page and poll keep answering staff and refusing a Student (full behaviour: suites 188 and 309).
SELECT pg_temp.p351_assert(
  pg_temp.p351_run(1, format('SELECT platform.staff_notifications_page_v2(%L, NULL, NULL) ->> ''unread_count''', pg_temp.p351_id(1))) = '0'
  AND pg_temp.p351_run(1, 'SELECT platform.staff_notifications_state_v1() ->> ''access''') = 'true'
  AND pg_temp.p351_run(4, 'SELECT platform.staff_notifications_state_v1() ->> ''access''') = 'false',
  'the bell page and poll answer staff and refuse a Student');

-- A case that is not open for the cabinet is not read by its own Student (the cheap predicate added before the check).
SET LOCAL session_replication_role = replica;
UPDATE platform.student_cases SET portal_activated_at = NULL WHERE id = pg_temp.p351_id(504);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.p351_assert(pg_temp.p351_run(4, 'SELECT count(*)::TEXT FROM platform.student_portal_cases()') = '0',
  'a case that is not open for the cabinet is not read by its Student');

SELECT pg_temp.p351_assert((SELECT count(*) >= 14 FROM p351_checks), 'enough assertions ran');
\echo A351_PORTAL_SPEED_SUITE_PASSED
ROLLBACK;
