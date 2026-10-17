\set ON_ERROR_STOP on
-- Boundary suite for migration 287 (дописать и закрыть дела прямого импорта,
-- platform.update_admissions_direct_case_v1). Members are modelled like
-- production after 155, as in the suite of migration 281: invited staff have
-- coarse role NULL and get permissions only from scoped role assignments with
-- the production keys (Admissions, Admissions Manager, Sales Manager). The
-- roles are created without case.create.direct and 281's own publication
-- function adds it, so the Admissions Manager holds the right the import
-- checks yet is still refused as the update actor (only the Admin may be).
-- Proves: the service-only boundary (a user JWT, authenticated, anon, a
-- non-Admin actor, a Student and a stranger refused); only cases created by
-- the IMPORT (a case made by the staff form, a random id refused); the strict
-- payload (any extra or forbidden key, country and money included, is named;
-- nothing is written by a refused call); the overwrite of the name, phone,
-- e-mail and birth date (the client, the case, the профиль and the анкета
-- fields) and that an absent, null or blank value changes nothing; a phone or
-- e-mail that belongs to another client is not written and is reported
-- without personal data while the other parts apply; parents, education and
-- route; the board stage (version, journal) and that the same stage is no
-- change; the curator (assignment, the same curator is no change, an
-- ineligible one refused); the amoCRM lead id (a binding, a repeat, a conflict
-- that applies nothing); the note; the closure for every outcome, an already
-- closed case, a case without a curator and the curator in the same call;
-- replay and PT409; the journal principals and request ids; the before_state
-- kept per call (the previous values of exactly what the call changed, never in
-- the answer or the journal, unchanged by a replay); that money, sales and the
-- receipts of 281 are untouched; and the posture of the new objects.
-- Review round 1 (PR #1213), each failing before its fix:
--  P1 the previous values of a changed анкета field are the WHOLE row (review
--     state, reviewer, source document and page): after overwriting a confirmed,
--     document-backed field it is written back without a CHECK error;
--  P2 a phone another client stores as 0…, 996… or 9 digits is a conflict;
--  P3 a second organization: a foreign actor, case or client is refused, and a
--     client of another organization is no conflict;
--  P4 the function takes the case-domain, request, contact and amoCRM
--     identity advisory locks (pg_locks of the calling transaction);
--  P5 the board stage moves only a case in work (active): a waiting case is
--     refused as not active;
--  P6 a client reused by 281 (exact e-mail and phone) is not renamed or
--     re-contacted from one case: reported as client_reused, the rest applies.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.n287_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28700000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n287_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N287: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n287_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The update as the service path calls it: actor n (default the Admin, 301),
-- fixed source and reason; the payload and the reference are the variables.
CREATE FUNCTION pg_temp.n287_call(p_case UUID, p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301) RETURNS JSONB
LANGUAGE SQL AS $$
  SELECT platform.update_admissions_direct_case_v1(pg_temp.n287_id(1), pg_temp.n287_id(p_actor), p_case,
    'n287-amocrm-update', p_ref, p_payload, 'Дополнение дел данными amoCRM по поручению владельца')
$$;
CREATE FUNCTION pg_temp.n287_try(p_case UUID, p_ref TEXT, p_payload JSONB, p_actor INTEGER DEFAULT 301) RETURNS TEXT
LANGUAGE SQL AS $$
  SELECT pg_temp.n287_error(format('SELECT pg_temp.n287_call(%L, %L, %L::JSONB, %s)', p_case, p_ref, p_payload::TEXT, p_actor))
$$;
CREATE FUNCTION pg_temp.n287_import(p_ref TEXT, p_payload JSONB) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.import_admissions_student_case_v1(pg_temp.n287_id(1), pg_temp.n287_id(301), 'n287-amocrm', p_ref, p_payload,
    'Импорт клиентов из amoCRM по поручению владельца')
$$;
-- The request ids of one update call (the 281 pattern): the base, and the
-- operation's suffix.
CREATE FUNCTION pg_temp.n287_base(p_ref TEXT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:admissions-direct-update:' || pg_temp.n287_id(1)::TEXT || ':n287-amocrm-update:' || p_ref)
$$;
CREATE FUNCTION pg_temp.n287_op(p_ref TEXT, p_op TEXT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5(pg_temp.n287_base(p_ref), 'admissions-direct-update:' || p_op)
$$;
-- Does THIS transaction hold the advisory lock taken with this key text? (the
-- locks of a transaction live until it ends, so a call's locks can be read
-- from pg_locks right after it).
CREATE FUNCTION pg_temp.n287_holds(p_key TEXT) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND l.classid::BIGINT = ((hashtextextended(p_key, 0) >> 32) & 4294967295)
      AND l.objid::BIGINT = (hashtextextended(p_key, 0) & 4294967295))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n287_id(INTEGER), pg_temp.n287_assert(BOOLEAN, TEXT), pg_temp.n287_error(TEXT),
  pg_temp.n287_holds(TEXT),
  pg_temp.n287_call(UUID, TEXT, JSONB, INTEGER), pg_temp.n287_try(UUID, TEXT, JSONB, INTEGER),
  pg_temp.n287_import(TEXT, JSONB), pg_temp.n287_base(TEXT), pg_temp.n287_op(TEXT, TEXT)
  TO authenticated, anon, service_role;

SELECT 'N287_ADMISSIONS_DIRECT_UPDATE_SUITE_START' AS n287_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager (sales department), 3 Admissions Manager, 4 Admissions A and
-- 6 Admissions B (admissions department); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n287_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n287_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL);
GRANT SELECT ON n287_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n287_id(1), 'N287 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n287_id(100 + n), 'n287-' || n || '@example.invalid', '{}'::JSONB FROM n287_actors;
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n287_id(200 + n), pg_temp.n287_id(100 + n), 'N287 Actor ' || n, 'active', 1 FROM n287_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n287_id(300 + n), pg_temp.n287_id(1), pg_temp.n287_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n287_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n287_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n287_id(401), pg_temp.n287_id(1), 'organization', pg_temp.n287_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n287_id(1), pg_temp.n287_id(301), pg_temp.n287_id(401), 1, 1, TRUE, 'system',
    'N287 synthetic organization scope', pg_temp.n287_id(601));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n287_id(901), pg_temp.n287_id(1), 'N287 Sales'),
  (pg_temp.n287_id(902), pg_temp.n287_id(1), 'N287 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n287_id(1), pg_temp.n287_id(302), pg_temp.n287_id(901)),
  (pg_temp.n287_id(1), pg_temp.n287_id(303), pg_temp.n287_id(902)),
  (pg_temp.n287_id(1), pg_temp.n287_id(304), pg_temp.n287_id(902)),
  (pg_temp.n287_id(1), pg_temp.n287_id(306), pg_temp.n287_id(902));

-- Roles with the EXACT production permission keys (as 244's and 281's suites),
-- without case.create.direct: 281's publication function adds it below.
CREATE TEMP TABLE n287_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n287_roles VALUES
 (pg_temp.n287_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n287_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n287_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130);
CREATE TEMP TABLE n287_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n287_grants VALUES
 (302, pg_temp.n287_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n287_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n287_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n287_id(902), 'resourceKind', NULL)),
 (304, pg_temp.n287_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n287_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL));
CREATE TEMP TABLE n287_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n287_id(1);
GRANT SELECT ON n287_roles, n287_grants, n287_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n287_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n287_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n287_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n287_admin_setup';
SET LOCAL ROLE authenticated;
DO $n287_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n287_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n287_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N287 ' || r.label, 'description', 'Migration 287 synthetic role',
        'permissionKeys', r.keys), 'N287 create role', pg_temp.n287_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n287_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n287_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N287 publish role', pg_temp.n287_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n287_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n287_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n287_id(1), pg_temp.n287_id(m),
      (SELECT access_version FROM n287_versions WHERE membership_id = pg_temp.n287_id(m)), items, bindings,
      'N287 grant roles', pg_temp.n287_id(2000 + m));
  END LOOP;
END
$n287_roles$;
RESET ROLE;

-- 281's publication of case.create.direct into the roles that may curate.
SELECT platform_private.admissions_direct_grant_curator_roles('N287 publication') AS n287_grant \gset
SELECT pg_temp.n287_assert(platform_private.staff_has_permission(pg_temp.n287_id(1), pg_temp.n287_id(303), 'case.create.direct')
  AND platform_private.staff_has_permission(pg_temp.n287_id(1), pg_temp.n287_id(304), 'case.create.direct')
  AND NOT platform_private.staff_has_permission(pg_temp.n287_id(1), pg_temp.n287_id(302), 'case.create.direct'),
  'fixture: the Admissions Manager and the curators hold case.create.direct, Sales does not');

UPDATE n287_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n287_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n287_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n287_admin FROM n287_actors WHERE n = 1 \gset
SELECT claims AS n287_a FROM n287_actors WHERE n = 4 \gset

-- ---------------------------------------------------------------------------
-- Fixture cases: the real import (service path), one case made by the staff
-- form (not an import), and clients that already hold a phone or an e-mail.
-- ---------------------------------------------------------------------------
-- A client the import will REUSE (281: the same e-mail and phone), for P6.
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Shared Person', 'n287-shared@example.invalid',
  '+996 555 287 800', 'n287-fixture', 'client', 'shared-1', 'staff_recorded', statement_timestamp()) AS n287_shared_client \gset
-- A SECOND organization with its own Admin, for P3.
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n287_id(2), 'N287 Second organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n287_id(110), 'n287-org2-admin@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n287_id(210), pg_temp.n287_id(110), 'N287 Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n287_id(310), pg_temp.n287_id(2), pg_temp.n287_id(210), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n287_id(310);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n287_id(402), pg_temp.n287_id(2), 'organization', pg_temp.n287_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n287_id(2), pg_temp.n287_id(310), pg_temp.n287_id(402), 1, 1, TRUE, 'system',
    'N287 synthetic organization scope', pg_temp.n287_id(602));

SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
-- X1: the main case (curator A, stage new, a phone and an e-mail).
SELECT pg_temp.n287_import('x1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student X',
  'phone', '+996 555 287 001', 'email', 'n287-x@example.invalid'),
  'route', jsonb_build_object('country', 'CN', 'degree', 'Бакалавриат', 'program', 'Computer Science'),
  'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_x1 \gset
-- Y1, Y2, Y3: waiting for a curator.
SELECT pg_temp.n287_import('y1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student Y1'),
  'route', jsonb_build_object('country', 'MY'))) AS n287_y1 \gset
SELECT pg_temp.n287_import('y2', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student Y2'),
  'route', jsonb_build_object('country', 'MY'))) AS n287_y2 \gset
SELECT pg_temp.n287_import('y3', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student Y3'),
  'route', jsonb_build_object('country', 'CN'))) AS n287_y3 \gset
-- Z1..Z4: closed in the closure section; V: the second case for amoCRM ids;
-- M1: a case with money, for the "money is untouched" proof.
SELECT pg_temp.n287_import('z1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Close 1'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_z1 \gset
SELECT pg_temp.n287_import('z2', jsonb_build_object('student', jsonb_build_object('name', 'N287 Close 2'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_z2 \gset
SELECT pg_temp.n287_import('z3', jsonb_build_object('student', jsonb_build_object('name', 'N287 Close 3'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_z3 \gset
SELECT pg_temp.n287_import('z4', jsonb_build_object('student', jsonb_build_object('name', 'N287 Close 4'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_z4 \gset
SELECT pg_temp.n287_import('v1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student V'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_v1 \gset
SELECT pg_temp.n287_import('m1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Student Money'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT, 'pipelineStage', 'documents',
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 150000, 'currency', 'USD'), 'signedOn', '2026-09-01',
    'payments', jsonb_build_array(jsonb_build_object('amountMinor', 50000, 'currency', 'USD', 'paidOn', '2026-09-05'))))) AS n287_m1 \gset
-- L1: the case of the lock proof; C1: confirmed, document-backed анкета fields;
-- R1: the case whose client the import reused; O2: a case of the second organization.
SELECT pg_temp.n287_import('l1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Lock Case'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_l1 \gset
SELECT pg_temp.n287_import('c1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Confirmed Case',
  'phone', '+996 555 287 601', 'email', 'n287-confirmed@example.invalid', 'birthDate', '2007-07-07'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_c1 \gset
SELECT pg_temp.n287_import('r1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Reused Student',
  'phone', '+996 555 287 800', 'email', 'n287-shared@example.invalid'),
  'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_r1 \gset
SELECT platform.import_admissions_student_case_v1(pg_temp.n287_id(2), pg_temp.n287_id(310), 'n287-amocrm', 'o2',
  jsonb_build_object('student', jsonb_build_object('name', 'N287 Org2 Student', 'phone', '+996 555 287 700',
    'email', 'n287-org2@example.invalid'), 'route', jsonb_build_object('country', 'CN')),
  'Импорт клиентов из amoCRM по поручению владельца') AS n287_o2 \gset
RESET ROLE;
SELECT :'n287_x1'::JSONB ->> 'student_case_id' AS n287_case_x1, :'n287_x1'::JSONB ->> 'client_id' AS n287_client_x1,
  :'n287_x1'::JSONB ->> 'lead_id' AS n287_lead_x1 \gset
SELECT :'n287_y1'::JSONB ->> 'student_case_id' AS n287_case_y1 \gset
SELECT :'n287_y2'::JSONB ->> 'student_case_id' AS n287_case_y2 \gset
SELECT :'n287_y3'::JSONB ->> 'student_case_id' AS n287_case_y3 \gset
SELECT :'n287_z1'::JSONB ->> 'student_case_id' AS n287_case_z1 \gset
SELECT :'n287_z2'::JSONB ->> 'student_case_id' AS n287_case_z2 \gset
SELECT :'n287_z3'::JSONB ->> 'student_case_id' AS n287_case_z3 \gset
SELECT :'n287_z4'::JSONB ->> 'student_case_id' AS n287_case_z4 \gset
SELECT :'n287_v1'::JSONB ->> 'student_case_id' AS n287_case_v1, :'n287_v1'::JSONB ->> 'lead_id' AS n287_lead_v1 \gset
SELECT :'n287_m1'::JSONB ->> 'student_case_id' AS n287_case_m1 \gset
SELECT :'n287_l1'::JSONB ->> 'student_case_id' AS n287_case_l1 \gset
SELECT :'n287_c1'::JSONB ->> 'student_case_id' AS n287_case_c1 \gset
SELECT :'n287_r1'::JSONB ->> 'student_case_id' AS n287_case_r1, :'n287_r1'::JSONB ->> 'client_id' AS n287_client_r1 \gset
SELECT :'n287_o2'::JSONB ->> 'student_case_id' AS n287_case_o2, :'n287_o2'::JSONB ->> 'client_id' AS n287_client_o2 \gset
SELECT pg_temp.n287_assert((:'n287_r1'::JSONB ->> 'client_reused')::BOOLEAN AND :'n287_client_r1' = :'n287_shared_client'
  AND :'n287_o2'::JSONB ->> 'status' = 'created' AND :'n287_o2'::JSONB ->> 'organization_id' = pg_temp.n287_id(2)::TEXT,
  'fixture: the import reused the shared client; the second organization has its own imported case');
SELECT pg_temp.n287_assert((SELECT bool_and(c.state = 'active') FROM platform.student_cases c
      WHERE c.id IN (:'n287_case_x1'::UUID, :'n287_case_z1'::UUID, :'n287_case_v1'::UUID, :'n287_case_m1'::UUID))
  AND (SELECT bool_and(c.state = 'pending') FROM platform.student_cases c
      WHERE c.id IN (:'n287_case_y1'::UUID, :'n287_case_y2'::UUID, :'n287_case_y3'::UUID)),
  'fixture: the imported cases are active (with a curator) or pending (without)');

-- A case made by the staff FORM (a receipt without an import source).
SET LOCAL request.jwt.claims TO :'n287_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n287_id(1), pg_temp.n287_id(5001), jsonb_build_object(
  'student', jsonb_build_object('name', 'N287 Form Student'), 'route', jsonb_build_object('country', 'MY'),
  'curatorMembershipId', pg_temp.n287_id(304)::TEXT)) AS n287_form \gset
RESET ROLE;
SELECT :'n287_form'::JSONB ->> 'student_case_id' AS n287_case_form \gset
SELECT pg_temp.n287_assert((SELECT r.import_source IS NULL FROM platform_private.admissions_direct_case_receipts r
  WHERE r.student_case_id = :'n287_case_form'::UUID), 'fixture: the form case has a receipt without an import source');

-- Another client that already holds a phone and an e-mail (and one that holds
-- only an e-mail), and amoCRM ids bound elsewhere.
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Phone Holder', 'n287-holder@example.invalid',
  '+996 555 287 999', 'n287-fixture', 'client', 'holder-1', 'staff_recorded', statement_timestamp()) AS n287_holder \gset
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Email Holder', 'n287-mail-only@example.invalid',
  NULL, 'n287-fixture', 'client', 'holder-2', 'staff_recorded', statement_timestamp()) AS n287_mail_holder \gset
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Amo Client', NULL, '+996 555 287 998',
  'amocrm', 'lead', '4000003', 'imported', statement_timestamp()) AS n287_amo_client \gset
-- Clients of sales and the website keep the number as typed: 0…, 996…, 9 digits.
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Local Holder', NULL, '0555 287 997',
  'n287-fixture', 'client', 'holder-local', 'staff_recorded', statement_timestamp()) AS n287_holder_local \gset
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Intl Holder', NULL, '996 555 287 996',
  'n287-fixture', 'client', 'holder-intl', 'staff_recorded', statement_timestamp()) AS n287_holder_intl \gset
SELECT platform_private.create_or_link_client(pg_temp.n287_id(1), 'N287 Bare Holder', NULL, '555 287 995',
  'n287-fixture', 'client', 'holder-bare', 'staff_recorded', statement_timestamp()) AS n287_holder_bare \gset
SELECT pg_temp.n287_assert((SELECT array_agg(c.normalized_phone ORDER BY c.display_name) FROM platform.clients c
    WHERE c.id IN (:'n287_holder_local'::UUID, :'n287_holder_intl'::UUID, :'n287_holder_bare'::UUID))
  = ARRAY['555287995', '996555287996', '0555287997'], 'fixture: the holders keep their numbers as typed');

CREATE TEMP TABLE n287_before AS SELECT
  (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.n287_id(1)) AS register_rows,
  (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n287_id(1)) AS handoffs,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n287_id(1) AND lifecycle_state = 'open') AS open_leads,
  (SELECT count(*) FROM platform_private.admissions_direct_case_receipts WHERE organization_id = pg_temp.n287_id(1)) AS receipts,
  (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.n287_id(1)) AS clients,
  (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.n287_id(1)) AS cases,
  (SELECT md5(COALESCE(string_agg(t.row_text, '|' ORDER BY t.row_text), '')) FROM (
    SELECT o.student_case_id::TEXT || o.amount_minor::TEXT || o.total_paid_minor::TEXT || o.currency AS row_text
    FROM platform.payment_obligations o WHERE o.organization_id = pg_temp.n287_id(1)
    UNION ALL SELECT e.student_case_id::TEXT || e.amount_minor::TEXT || e.event_type FROM platform.payment_events e
      WHERE e.organization_id = pg_temp.n287_id(1)) t) AS money_md5;
GRANT SELECT ON n287_before TO service_role;

-- ---------------------------------------------------------------------------
-- 1. The service-only boundary and the actor.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n287_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a1', '{"note":"x"}'::JSONB)
  LIKE '42501:permission denied for function update_admissions_direct_case_v1',
  'authenticated, even the Admin, cannot execute the update');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a2', '{"note":"x"}'::JSONB) LIKE '42501:permission denied for %',
  'anon cannot execute the update');
RESET ROLE;
-- The service role carrying a user identity is refused.
SET LOCAL request.jwt.claims TO :'n287_admin';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a3', '{"note":"x"}'::JSONB) = '42501:admissions_direct_forbidden',
  'the service role carrying a user JWT (a sub) is refused');
RESET ROLE;
-- A sub claim alone (the role is service_role) is refused, and so is an
-- authenticated or anon role claim without a sub.
SET LOCAL request.jwt.claims TO '{"role":"service_role","sub":"28700000-0000-4000-8000-000000000101"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a3b', '{"note":"x"}'::JSONB) = '42501:admissions_direct_forbidden',
  'a sub claim alone is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"authenticated"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a3c', '{"note":"x"}'::JSONB) = '42501:admissions_direct_forbidden',
  'an authenticated role claim without a sub is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a4', '{"note":"x"}'::JSONB, 302) = '42501:admissions_direct_forbidden',
  'a Sales Manager membership cannot be the actor');
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a5', '{"note":"x"}'::JSONB, 303) = '42501:admissions_direct_forbidden',
  'the Admissions Manager holds case.create.direct but is not the Admin: refused');
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a6', '{"note":"x"}'::JSONB, 304) = '42501:admissions_direct_forbidden',
  'a curator cannot be the actor');
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a7', '{"note":"x"}'::JSONB, 305) = '42501:admissions_direct_forbidden',
  'a Student membership cannot be the actor');
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'a8', '{"note":"x"}'::JSONB, 999) = '42501:admissions_direct_forbidden',
  'a membership that does not exist cannot be the actor');
SELECT pg_temp.n287_assert(pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(NULL, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(301), :'n287_case_x1', 'n287-amocrm-update', 'a9', '{"note":"x"}', 'N287'))
  = '42501:admissions_direct_forbidden', 'no organization is refused');
-- Only a case the IMPORT created.
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_form'::UUID, 'a10', '{"note":"x"}'::JSONB)
  = '42501:admissions_direct_update_not_imported_case', 'a case made by the staff form is not touched');
SELECT pg_temp.n287_assert(pg_temp.n287_try(pg_temp.n287_id(777), 'a11', '{"note":"x"}'::JSONB)
  = '42501:admissions_direct_update_not_imported_case', 'a case that does not exist is not touched');
SELECT pg_temp.n287_assert(pg_temp.n287_try(pg_temp.n287_id(1), 'a12', '{"note":"x"}'::JSONB)
  = '42501:admissions_direct_update_not_imported_case', 'an id that is no case of the organization is not touched');
-- P3: a second organization. The case of the other organization, an actor of
-- the other organization and an organization the actor does not belong to are
-- refused; only the matching triple works.
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_o2'::UUID, 'a13', '{"note":"N287 foreign"}'::JSONB)
    = '42501:admissions_direct_update_not_imported_case'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(2), pg_temp.n287_id(301), :'n287_case_o2', 'n287-amocrm-update', 'a14', '{"note":"N287 foreign"}', 'N287'))
    = '42501:admissions_direct_forbidden'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(1), pg_temp.n287_id(310), :'n287_case_x1', 'n287-amocrm-update', 'a15', '{"note":"N287 foreign"}', 'N287'))
    = '42501:admissions_direct_forbidden'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(2), pg_temp.n287_id(310), :'n287_case_x1', 'n287-amocrm-update', 'a16', '{"note":"N287 foreign"}', 'N287'))
    = '42501:admissions_direct_update_not_imported_case',
  'P3: a foreign case, a foreign actor and a foreign organization are refused');
SELECT platform.update_admissions_direct_case_v1(pg_temp.n287_id(2), pg_temp.n287_id(310), :'n287_case_o2'::UUID,
  'n287-amocrm-update', 'a17', '{"note":"N287 org2 note"}'::JSONB, 'N287') AS n287_a17 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates
      WHERE organization_id = pg_temp.n287_id(1))
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes WHERE student_case_id IN (:'n287_case_x1'::UUID, :'n287_case_form'::UUID)),
  'the refused calls wrote nothing');
SELECT pg_temp.n287_assert(:'n287_a17'::JSONB -> 'changed' = '["note"]'::JSONB
  AND EXISTS (SELECT 1 FROM platform.case_notes n WHERE n.organization_id = pg_temp.n287_id(2) AND n.body = 'N287 org2 note'),
  'P3: the second organization''s own Admin updates the second organization''s own case');

-- ---------------------------------------------------------------------------
-- 2. The strict payload: every refusal names its key; nothing is written.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n287_audit_mark AS SELECT count(*) AS audit_rows FROM platform.audit_events;
GRANT SELECT ON n287_audit_mark TO service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert((SELECT array_agg(pg_temp.n287_try(:'n287_case_x1'::UUID, 'b' || x.i, x.payload) ORDER BY x.i)
  FROM (VALUES
    (1, '{"country":"CN"}'::JSONB),
    (2, '{"route":{"country":"CN"}}'),
    (3, '{"money":{"cost":{"amountMinor":100,"currency":"USD"}}}'),
    (4, '{"payments":[{"amountMinor":1,"currency":"USD","paidOn":"2026-09-01"}]}'),
    (5, '{"student":{"age":17}}'),
    (6, '{"parents":{"mother":{"relation":"mother"}}}'),
    (7, '{"close":{"outcome":"enrolled","extra":1}}'),
    (8, '{"weird key!":1}'),
    (9, '{"parents":{"guardian":{"firstName":"x"}}}'),
    (10, '{"education":{"level":"x"}}')
  ) AS x(i, payload))
  = ARRAY['22023:admissions_direct_invalid:country', '22023:admissions_direct_invalid:country',
    '22023:admissions_direct_invalid:money', '22023:admissions_direct_invalid:payments',
    '22023:admissions_direct_invalid:age', '22023:admissions_direct_invalid:relation',
    '22023:admissions_direct_invalid:extra', '22023:admissions_direct_invalid:payload',
    '22023:admissions_direct_invalid:guardian', '22023:admissions_direct_invalid:level'],
  'an extra or forbidden key (country, money, payments included) is refused by its own name');
SELECT pg_temp.n287_assert((SELECT array_agg(pg_temp.n287_try(:'n287_case_x1'::UUID, 'c' || x.i, x.payload) ORDER BY x.i)
  FROM (VALUES
    (1, '{"student":{"phone":"555 123"}}'::JSONB),
    (2, '{"student":{"phone":"+7 701 123 45 67 доб. 2"}}'),
    (3, '{"student":{"email":"nope"}}'),
    (4, '{"student":{"birthDate":"2099-01-01"}}'),
    (5, '{"student":{"birthDate":"2007-13-45"}}'),
    (6, '{"student":{"firstName":123}}'),
    (7, '{"parents":{"mother":{"phone":"8 701 123 45 67"}}}'),
    (8, '{"parents":{"father":{"phone":"0555/123/456"}}}'),
    (9, '{"pipelineStage":"bogus"}'),
    (10, '{"curatorMembershipId":"not-a-uuid"}'),
    (11, '{"amoLeadId":"abc"}'),
    (12, '{"amoLeadId":"0123"}'),
    (13, '{"amoLeadId":"123456789012345678901"}'),
    (14, '{"amoLeadId":true}'),
    (15, '{"close":{"outcome":"bogus"}}'),
    (16, '{"close":{"outcome":"other"}}'),
    (17, '{"close":{"outcome":"enrolled","note":"reason"}}'),
    (18, '{"close":{}}'),
    (19, '{"close":{"outcome":"other","note":"two\nlines"}}'),
    (20, '{"student":"text"}')
  ) AS x(i, payload))
  = ARRAY['22023:admissions_direct_invalid:phone', '22023:admissions_direct_invalid:phone',
    '22023:admissions_direct_invalid:email', '22023:admissions_direct_invalid:birthDate',
    '22023:admissions_direct_invalid:birthDate', '22023:admissions_direct_invalid:firstName',
    '22023:admissions_direct_invalid:motherPhone', '22023:admissions_direct_invalid:fatherPhone',
    '22023:admissions_direct_invalid:pipelineStage', '22023:admissions_direct_invalid:curator',
    '22023:admissions_direct_invalid:amoLeadId', '22023:admissions_direct_invalid:amoLeadId',
    '22023:admissions_direct_invalid:amoLeadId', '22023:admissions_direct_invalid:amoLeadId',
    '22023:admissions_direct_invalid:outcome', '22023:admissions_direct_invalid:closeNote',
    '22023:admissions_direct_invalid:closeNote', '22023:admissions_direct_invalid:outcome',
    '22023:admissions_direct_invalid:closeNote', '22023:admissions_direct_invalid:student'],
  'a bad value is refused by its key');
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'd1', jsonb_build_object('note', repeat('x', 3501)))
    = '22023:admissions_direct_invalid:note'
  AND pg_temp.n287_try(:'n287_case_x1'::UUID, 'd2', '[]'::JSONB) = '22023:admissions_direct_invalid:payload'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(1), pg_temp.n287_id(301), :'n287_case_x1', 'Bad Source', 'd3', '{}', 'N287')) = '22023:admissions_direct_invalid:updateSource'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(1), pg_temp.n287_id(301), :'n287_case_x1', 'n287-amocrm-update', ' ', '{}', 'N287')) = '22023:admissions_direct_invalid:externalRef'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(1), pg_temp.n287_id(301), :'n287_case_x1', 'n287-amocrm-update', 'd4', '{}', '  ')) = '22023:admissions_direct_invalid:reason',
  'the note limit, a non-object payload, the source label, the reference and the reason are validated');
RESET ROLE;
SELECT pg_temp.n287_assert((SELECT count(*) FROM platform.audit_events) = (SELECT audit_rows FROM n287_audit_mark)
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates WHERE organization_id = pg_temp.n287_id(1))
  AND (SELECT c.pipeline_stage = 'new' AND c.student_display_name = 'N287 Student X' FROM platform.student_cases c
    WHERE c.id = :'n287_case_x1'::UUID),
  'the refused payloads wrote nothing (no audit, no receipt, the case unchanged)');

-- ---------------------------------------------------------------------------
-- 2b. P4 The locks of one call. A transaction keeps its advisory locks until it
-- ends, so what a call took is read from pg_locks right after it. Before this
-- first successful call the transaction holds none of them (the refused calls
-- above rolled their locks back with their savepoints).
-- ---------------------------------------------------------------------------
SELECT pg_temp.n287_assert(NOT pg_temp.n287_holds('platform:student-case-note-assignment:organization:' || pg_temp.n287_id(1)::TEXT)
  AND NOT pg_temp.n287_holds('evo:p2d:request:' || pg_temp.n287_base('lk1')::TEXT)
  AND NOT pg_temp.n287_holds('manual-lead-contact:' || pg_temp.n287_id(1)::TEXT || ':+996700287555')
  AND NOT pg_temp.n287_holds('manual-lead-contact:' || pg_temp.n287_id(1)::TEXT || ':n287-lock@example.invalid')
  AND NOT pg_temp.n287_holds(pg_temp.n287_id(1)::TEXT || E'\x1f' || 'amocrm' || E'\x1f' || 'lead' || E'\x1f' || '4000020'),
  'P4 fixture: none of the call''s locks is held before it');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_l1'::UUID, 'lk1', jsonb_build_object('student', jsonb_build_object(
  'phone', '+996 700 287 555', 'email', 'N287-Lock@Example.INVALID'), 'amoLeadId', '4000020')) AS n287_lk1 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_lk1'::JSONB -> 'changed' = '["student","amoLeadId"]'::JSONB,
  'P4: the lock call changed the contacts and bound the amoCRM id');
SELECT pg_temp.n287_assert(
  pg_temp.n287_holds('platform:student-case-note-assignment:organization:' || pg_temp.n287_id(1)::TEXT),
  'P4: the call takes the organization''s case-domain lock');
SELECT pg_temp.n287_assert(pg_temp.n287_holds('evo:p2d:request:' || pg_temp.n287_base('lk1')::TEXT),
  'P4: the call takes the request lock of its (source, reference)');
SELECT pg_temp.n287_assert((SELECT bool_and(pg_temp.n287_holds('manual-lead-contact:' || pg_temp.n287_id(1)::TEXT || ':' || k))
    AND count(*) = 8
  FROM unnest(platform_private.admissions_direct_phone_keys('+996700287555') || ARRAY['n287-lock@example.invalid']) k),
  'P4: the call takes the contact lock of every spelling of the phone and of the e-mail (the 281 / 143 keys)');
SELECT pg_temp.n287_assert(pg_temp.n287_holds(pg_temp.n287_id(1)::TEXT || E'\x1f' || 'amocrm' || E'\x1f' || 'lead' || E'\x1f' || '4000020'),
  'P4: the call takes the external identity lock of the amoCRM id');

-- ---------------------------------------------------------------------------
-- 3. Overwrite: name, phone, e-mail, birth date.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n287_assert((SELECT p.revision = 1 AND p.preferred_display_name = 'N287 Student X'
  FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID), 'fixture: the профиль is at revision 1');
CREATE TEMP TABLE n287_snap AS SELECT
  (SELECT jsonb_object_agg(f.field_key, to_jsonb(f) - 'organization_id' - 'student_case_id' - 'student_profile_id' - 'field_key')
    FROM platform.student_profile_fields f WHERE f.student_case_id = :'n287_case_x1'::UUID) AS fields,
  (SELECT to_jsonb(p) FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID) AS profile;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u1', jsonb_build_object('student', jsonb_build_object(
  'firstName', 'Айбек', 'lastName', 'Токтогулов', 'phone', '0700 287 011', 'email', 'N287-New@Example.INVALID',
  'birthDate', '2007-03-04'))) AS n287_u1 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u1'::JSONB ->> 'status' = 'updated' AND :'n287_u1'::JSONB -> 'changed' = '["student"]'::JSONB
  AND NOT (:'n287_u1'::JSONB ->> 'replayed')::BOOLEAN AND NOT (:'n287_u1'::JSONB ? 'contact_conflict')
  AND NOT (:'n287_u1'::JSONB ? 'closed') AND :'n287_u1'::JSONB ->> 'student_case_id' = :'n287_case_x1',
  'u1: the answer names the changed part');
SELECT pg_temp.n287_assert((SELECT cl.display_name = 'Айбек Токтогулов' AND cl.normalized_name = platform_private.normalize_person_name('Айбек Токтогулов')
    AND cl.phone = '+996700287011' AND cl.normalized_phone = '+996700287011'
    AND cl.email = 'N287-New@Example.INVALID' AND cl.normalized_email = 'n287-new@example.invalid'
  FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID), 'u1: the client carries the new name, phone and e-mail');
SELECT pg_temp.n287_assert((SELECT c.student_display_name = 'Айбек Токтогулов' FROM platform.student_cases c
  WHERE c.id = :'n287_case_x1'::UUID), 'u1: the case shows the new name');
SELECT pg_temp.n287_assert((SELECT p.revision = 2 AND p.preferred_display_name = 'Айбек Токтогулов'
    AND p.date_of_birth = DATE '2007-03-04' AND p.updated_by_membership_id = pg_temp.n287_id(301)
  FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID),
  'u1: the профиль is at revision 2 with the name and the birth date');
SELECT pg_temp.n287_assert((SELECT array_agg(f.field_key || '=' || COALESCE(f.value, '∅') || '/' || f.review_state || '/' || f.profile_revision
    ORDER BY f.field_key)
  FROM platform.student_profile_fields f WHERE f.student_case_id = :'n287_case_x1'::UUID
    AND f.field_key IN ('student_first_name', 'student_last_name', 'mobile_phone', 'student_email', 'date_of_birth'))
  = ARRAY['date_of_birth=∅/needs_review/2', 'mobile_phone=+996700287011/needs_review/2',
    'student_email=n287-new@example.invalid/needs_review/2', 'student_first_name=Айбек/needs_review/2',
    'student_last_name=Токтогулов/needs_review/2'], 'u1: the анкета fields are canonical and wait for review');
SELECT pg_temp.n287_assert((SELECT bool_and(f.value IS NULL OR f.value = platform_private.normalize_student_profile_field_value(f.field_key, f.value))
  FROM platform.student_profile_fields f WHERE f.organization_id = pg_temp.n287_id(1)), 'u1: every анкета value is in its canonical form');
SELECT pg_temp.n287_assert((SELECT l.lifecycle_state = 'converted' AND l.current_owner_membership_id IS NULL AND l.source_key = 'admissions_direct'
  FROM platform.leads l WHERE l.id = :'n287_lead_x1'::UUID)
  AND (SELECT count(*) FROM platform.clients WHERE organization_id = pg_temp.n287_id(1)) = (SELECT clients FROM n287_before)
  AND (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.n287_id(1)) = (SELECT cases FROM n287_before),
  'u1: no client, lead or case was created; the lead stays converted');
SELECT pg_temp.n287_assert((SELECT a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n287_id(201)
    AND a.actor_membership_id = pg_temp.n287_id(301) AND a.actor_kind = 'user'
    AND a.reason = 'Дополнение дел данными amoCRM по поручению владельца' AND a.resource_type = 'student_profile'
    AND a.after_state -> 'updated_field_names' @> '["client_display_name","client_phone","client_email","student_display_name","preferred_display_name","date_of_birth","student_first_name","student_last_name","mobile_phone","student_email"]'::JSONB
    AND (a.after_state ->> 'revision')::INTEGER = 2 AND (a.before_state ->> 'revision')::INTEGER = 1
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u1', 'profile') AND a.action = 'student.profile.upsert'),
  'u1: student.profile.upsert is journaled for the service principal with the Admin profile, the reason and the field names');
SELECT pg_temp.n287_assert((SELECT count(*) = 1 FROM platform.audit_events a
    WHERE a.request_id IN (pg_temp.n287_base('u1'), pg_temp.n287_op('u1', 'profile'), pg_temp.n287_op('u1', 'route'),
      pg_temp.n287_op('u1', 'pipeline'), pg_temp.n287_op('u1', 'assign'), pg_temp.n287_op('u1', 'amo'),
      pg_temp.n287_op('u1', 'note'), pg_temp.n287_op('u1', 'close'))),
  'u1: one journal row for one changed part');
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u1', 'profile')
    AND (a.after_state::TEXT ~ '70028701' OR a.before_state::TEXT ~ '70028701' OR a.after_state::TEXT ~ 'Example')),
  'u1: the journal row carries no phone or e-mail value');
-- The previous values of exactly what u1 changed are kept (in the backend
-- table only): the client, the case name, the профиль, and every анкета field
-- as the WHOLE row it was (or "did not exist").
SELECT pg_temp.n287_assert((SELECT u.before_state = jsonb_build_object(
    'client', jsonb_build_object('display_name', 'N287 Student X', 'phone', '+996555287001', 'normalized_phone', '+996555287001',
      'email', 'n287-x@example.invalid', 'normalized_email', 'n287-x@example.invalid'),
    'case', jsonb_build_object('student_display_name', 'N287 Student X'),
    'profile', jsonb_build_object('revision', 1, 'updated_by_membership_id', s.profile -> 'updated_by_membership_id',
      'updated_at', s.profile -> 'updated_at', 'preferred_display_name', 'N287 Student X', 'date_of_birth', NULL),
    'fields', jsonb_build_object(
      'student_first_name', jsonb_build_object('existed', FALSE),
      'student_last_name', jsonb_build_object('existed', FALSE),
      'mobile_phone', jsonb_build_object('existed', TRUE) || (s.fields -> 'mobile_phone'),
      'student_email', jsonb_build_object('existed', TRUE) || (s.fields -> 'student_email'),
      'date_of_birth', jsonb_build_object('existed', FALSE)))
  FROM platform_private.admissions_direct_case_updates u, n287_snap s
  WHERE u.organization_id = pg_temp.n287_id(1) AND u.update_source = 'n287-amocrm-update' AND u.external_ref = 'u1'),
  'u1: before_state holds the old values of exactly the changed parts, the fields as whole rows');
SELECT pg_temp.n287_assert((SELECT u.before_state #> '{fields,mobile_phone}' ?& ARRAY['existed', 'value', 'review_state',
      'profile_revision', 'reviewed_at', 'reviewed_by_membership_id', 'source_document_version_id', 'source_document_slot_id',
      'source_page', 'updated_at']
    AND NOT (u.before_state #> '{fields,mobile_phone}' ?| ARRAY['organization_id', 'student_case_id', 'student_profile_id', 'field_key'])
  FROM platform_private.admissions_direct_case_updates u
  WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'u1'),
  'u1: a field snapshot carries every column that can be restored (and none of the identity columns)');
SELECT pg_temp.n287_assert(NOT (:'n287_u1'::JSONB ? 'before_state'),
  'u1: the answer never carries the before_state');
SELECT md5(u.before_state::TEXT) AS n287_u1_before_md5 FROM platform_private.admissions_direct_case_updates u
  WHERE u.organization_id = pg_temp.n287_id(1) AND u.update_source = 'n287-amocrm-update' AND u.external_ref = 'u1' \gset

-- A partial update: the last name alone, the first name stays (both are known).
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u2', jsonb_build_object('student', jsonb_build_object('lastName', 'Сыдыков'))) AS n287_u2 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u2'::JSONB -> 'changed' = '["student"]'::JSONB
  AND (SELECT cl.display_name = 'Айбек Сыдыков' AND cl.phone = '+996700287011' AND cl.normalized_email = 'n287-new@example.invalid'
    FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID)
  AND (SELECT p.revision = 3 FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID),
  'u2: the last name alone gives "first last" from the known first name; the other contacts stay');
-- Absent, null and blank values change nothing.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u3', jsonb_build_object('student', jsonb_build_object(
  'email', '', 'phone', NULL, 'name', '  ', 'birthDate', NULL), 'route', jsonb_build_object('degree', ' '), 'note', '   ')) AS n287_u3 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u3b', '{}'::JSONB) AS n287_u3b \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u3'::JSONB -> 'changed' = '[]'::JSONB AND :'n287_u3b'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT cl.display_name = 'Айбек Сыдыков' AND cl.normalized_email = 'n287-new@example.invalid'
    AND cl.normalized_phone = '+996700287011' FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID)
  AND (SELECT p.revision = 3 FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id IN (pg_temp.n287_op('u3', 'profile'), pg_temp.n287_op('u3', 'route'),
    pg_temp.n287_op('u3', 'note'), pg_temp.n287_op('u3b', 'profile'))),
  'u3: an absent, null or blank value (and an empty payload) changes nothing and journals nothing');
SELECT pg_temp.n287_assert((SELECT bool_and(u.before_state = '{}'::JSONB) AND count(*) = 2
  FROM platform_private.admissions_direct_case_updates u
  WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref IN ('u3', 'u3b')),
  'u3: a call that changed nothing keeps an empty before_state');
-- The full name wins over the parts.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u4', jsonb_build_object('student', jsonb_build_object('name', 'N287 Full Name'))) AS n287_u4 \gset
-- The phone it already holds, in another spelling, is no change.
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u4b', jsonb_build_object('student', jsonb_build_object('phone', '+996 700 287 011'))) AS n287_u4b \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u4'::JSONB -> 'changed' = '["student"]'::JSONB
  AND (SELECT cl.display_name = 'N287 Full Name' FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID)
  AND (SELECT f.value = 'Айбек' FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_x1'::UUID AND f.field_key = 'student_first_name')
  AND :'n287_u4b'::JSONB -> 'changed' = '[]'::JSONB AND NOT (:'n287_u4b'::JSONB ? 'contact_conflict'),
  'u4: the full name is the display name; the same phone in another spelling is no change and no conflict');

-- ---------------------------------------------------------------------------
-- 4. A phone or an e-mail of ANOTHER client is not written and is reported.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u5', jsonb_build_object('student', jsonb_build_object(
  'phone', '0555 287 999', 'birthDate', '2007-03-05'))) AS n287_u5 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u6', jsonb_build_object('student', jsonb_build_object(
  'email', 'N287-Mail-Only@example.invalid', 'firstName', 'Айбек'))) AS n287_u6 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u7', jsonb_build_object('student', jsonb_build_object(
  'phone', '996555287999', 'email', 'n287-holder@example.invalid'))) AS n287_u7 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u5'::JSONB -> 'contact_conflict'
    = jsonb_build_array(jsonb_build_object('field', 'phone', 'reason', 'other_client', 'other_client_id', :'n287_holder'::UUID))
  AND :'n287_u5'::JSONB -> 'changed' = '["student"]'::JSONB
  AND (SELECT cl.normalized_phone = '+996700287011' FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID)
  AND (SELECT f.value = '+996700287011' FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_x1'::UUID AND f.field_key = 'mobile_phone')
  AND (SELECT p.date_of_birth = DATE '2007-03-05' FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID),
  'u5: another client''s phone (in another spelling) is reported, not written; the birth date still applies');
SELECT pg_temp.n287_assert(:'n287_u6'::JSONB -> 'contact_conflict'
    = jsonb_build_array(jsonb_build_object('field', 'email', 'reason', 'other_client', 'other_client_id', :'n287_mail_holder'::UUID))
  AND :'n287_u6'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT cl.normalized_email = 'n287-new@example.invalid' FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID)
  AND (SELECT f.value = 'n287-new@example.invalid' FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_x1'::UUID AND f.field_key = 'student_email'),
  'u6: another client''s e-mail is reported, not written');
SELECT pg_temp.n287_assert(jsonb_array_length(:'n287_u7'::JSONB -> 'contact_conflict') = 2
  AND (SELECT array_agg(c ->> 'field' ORDER BY c ->> 'field') FROM jsonb_array_elements(:'n287_u7'::JSONB -> 'contact_conflict') c)
    = ARRAY['email', 'phone'] AND :'n287_u7'::JSONB -> 'changed' = '[]'::JSONB,
  'u7: both contacts in conflict are reported');
SELECT pg_temp.n287_assert(position('287999' IN :'n287_u5'::TEXT || :'n287_u6'::TEXT || :'n287_u7'::TEXT) = 0
  AND position('holder' IN :'n287_u5'::TEXT || :'n287_u6'::TEXT || :'n287_u7'::TEXT) = 0,
  'u5-u7: the report carries no phone or e-mail value');
SELECT pg_temp.n287_assert((SELECT count(*) = 1 FROM platform.clients WHERE normalized_phone = '+996555287999' OR normalized_phone = '0555287999'
    OR normalized_phone = '996555287999'),
  'u5-u7: the other client keeps its number; no client took it');

-- P2: the other client stores the number as typed by sales or the website
-- (0…, 996…, 9 digits): found through every spelling of the new number.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u7a', '{"student":{"phone":"+996 555 287 997"}}'::JSONB) AS n287_u7a \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u7b', '{"student":{"phone":"0555 287 996"}}'::JSONB) AS n287_u7b \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u7c', '{"student":{"phone":"996 555 287 995"}}'::JSONB) AS n287_u7c \gset
RESET ROLE;
SELECT pg_temp.n287_assert(
  :'n287_u7a'::JSONB -> 'contact_conflict' = jsonb_build_array(jsonb_build_object('field', 'phone', 'reason', 'other_client',
    'other_client_id', :'n287_holder_local'::UUID))
  AND :'n287_u7b'::JSONB -> 'contact_conflict' = jsonb_build_array(jsonb_build_object('field', 'phone', 'reason', 'other_client',
    'other_client_id', :'n287_holder_intl'::UUID))
  AND :'n287_u7c'::JSONB -> 'contact_conflict' = jsonb_build_array(jsonb_build_object('field', 'phone', 'reason', 'other_client',
    'other_client_id', :'n287_holder_bare'::UUID))
  AND :'n287_u7a'::JSONB -> 'changed' = '[]'::JSONB AND :'n287_u7b'::JSONB -> 'changed' = '[]'::JSONB
  AND :'n287_u7c'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT cl.normalized_phone = '+996700287011' FROM platform.clients cl WHERE cl.id = :'n287_client_x1'::UUID),
  'P2: a number held as 0…, 996… or 9 digits by another client is a conflict whatever the spelling sent');

-- P3: a client of ANOTHER organization is no conflict.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_v1'::UUID, 'u7d', '{"student":{"phone":"+996 555 287 700","email":"n287-org2@example.invalid"}}'::JSONB) AS n287_u7d \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u7d'::JSONB -> 'changed' = '["student"]'::JSONB AND NOT (:'n287_u7d'::JSONB ? 'contact_conflict')
  AND (SELECT cl.normalized_phone = '+996555287700' AND cl.normalized_email = 'n287-org2@example.invalid'
    FROM platform.clients cl WHERE cl.id = (:'n287_v1'::JSONB ->> 'client_id')::UUID)
  AND (SELECT cl.normalized_phone = '+996555287700' FROM platform.clients cl WHERE cl.id = :'n287_client_o2'::UUID),
  'P3: the number and e-mail of a client of the other organization are no conflict (each organization keeps its own)');

-- P6: the import reused an existing client (exact e-mail and phone): that client
-- is shared with other subjects, so it is neither renamed nor given other
-- contacts from one case; the case itself and the other parts still apply.
SELECT jsonb_build_object('display_name', cl.display_name, 'phone', cl.phone, 'normalized_phone', cl.normalized_phone,
  'email', cl.email, 'normalized_email', cl.normalized_email) AS n287_shared_before
FROM platform.clients cl WHERE cl.id = :'n287_shared_client'::UUID \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_r1'::UUID, 'rc1', jsonb_build_object('student', jsonb_build_object(
  'name', 'N287 Reused Renamed', 'phone', '+996 700 287 801', 'email', 'n287-shared-new@example.invalid',
  'birthDate', '2008-01-01'), 'pipelineStage', 'visa')) AS n287_rc1 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_rc1'::JSONB -> 'changed' = '["student","pipelineStage"]'::JSONB
  AND :'n287_rc1'::JSONB -> 'contact_conflict' = jsonb_build_array(
    jsonb_build_object('field', 'name', 'reason', 'client_reused'),
    jsonb_build_object('field', 'phone', 'reason', 'client_reused'),
    jsonb_build_object('field', 'email', 'reason', 'client_reused'))
  AND (SELECT jsonb_build_object('display_name', cl.display_name, 'phone', cl.phone, 'normalized_phone', cl.normalized_phone,
      'email', cl.email, 'normalized_email', cl.normalized_email) = :'n287_shared_before'::JSONB
    FROM platform.clients cl WHERE cl.id = :'n287_shared_client'::UUID),
  'P6: a reused client keeps its name, phone and e-mail; the answer says client_reused for each');
SELECT pg_temp.n287_assert((SELECT c.student_display_name = 'N287 Reused Renamed' AND c.pipeline_stage = 'visa'
    FROM platform.student_cases c WHERE c.id = :'n287_case_r1'::UUID)
  AND (SELECT p.preferred_display_name = 'N287 Reused Renamed' AND p.date_of_birth = DATE '2008-01-01'
    FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_r1'::UUID)
  AND (SELECT f.value = '+996700287801' FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_r1'::UUID AND f.field_key = 'mobile_phone')
  AND (SELECT u.before_state ? 'client' FROM platform_private.admissions_direct_case_updates u WHERE u.external_ref = 'rc1') IS FALSE,
  'P6: the case, its профиль, its анкета and its stage are updated; nothing of the client is recorded as changed');

-- P1: a CONFIRMED, document-backed анкета field overwritten by the update is
-- put back from before_state without a CHECK error, source document included.
INSERT INTO platform.document_slots(id, organization_id, student_case_id, status, created_by_membership_id, intent_kind,
  display_label, group_label)
  VALUES (pg_temp.n287_id(7001), pg_temp.n287_id(1), :'n287_case_c1'::UUID, 'required', pg_temp.n287_id(301), 'custom',
    'N287 passport', 'N287');
INSERT INTO platform.document_versions(id, organization_id, student_case_id, document_slot_id, version_no, original_filename,
  declared_mime_type, byte_size, sha256_hex, ingest_evidence_ref, submitted_by_membership_id)
  VALUES (pg_temp.n287_id(7002), pg_temp.n287_id(1), :'n287_case_c1'::UUID, pg_temp.n287_id(7001), 1, 'n287.pdf',
    'application/pdf', 100, repeat('a', 64), 'n287-evidence', pg_temp.n287_id(301));
UPDATE platform.student_profile_fields f SET review_state = 'confirmed', reviewed_at = TIMESTAMPTZ '2026-10-01 10:00:00+00',
  reviewed_by_membership_id = pg_temp.n287_id(301), source_document_version_id = pg_temp.n287_id(7002),
  source_document_slot_id = pg_temp.n287_id(7001), source_page = 2
WHERE f.student_case_id = :'n287_case_c1'::UUID AND f.field_key IN ('student_email', 'date_of_birth');
SELECT jsonb_object_agg(f.field_key, to_jsonb(f)) AS n287_c1_rows FROM platform.student_profile_fields f
  WHERE f.student_case_id = :'n287_case_c1'::UUID AND f.field_key IN ('student_email', 'date_of_birth') \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_c1'::UUID, 'cf1', '{"student":{"email":"n287-confirmed-new@example.invalid","birthDate":"2007-08-08"}}'::JSONB) AS n287_cf1 \gset
RESET ROLE;
SELECT pg_temp.n287_assert((SELECT f.review_state = 'needs_review' AND f.reviewed_at IS NULL AND f.source_document_version_id IS NULL
    AND f.value = 'n287-confirmed-new@example.invalid'
  FROM platform.student_profile_fields f WHERE f.student_case_id = :'n287_case_c1'::UUID AND f.field_key = 'student_email'),
  'P1 fixture: the update did overwrite the confirmed, document-backed field (the review is reset)');
SELECT pg_temp.n287_assert((SELECT u.before_state #> '{fields,student_email}' ->> 'review_state' = 'confirmed'
    AND u.before_state #> '{fields,student_email}' ->> 'source_document_version_id' = pg_temp.n287_id(7002)::TEXT
    AND u.before_state #> '{fields,student_email}' ->> 'source_document_slot_id' = pg_temp.n287_id(7001)::TEXT
    AND (u.before_state #> '{fields,student_email}' ->> 'source_page')::INTEGER = 2
    AND u.before_state #> '{fields,student_email}' ->> 'reviewed_by_membership_id' = pg_temp.n287_id(301)::TEXT
    AND (u.before_state #> '{fields,student_email}' ->> 'reviewed_at')::TIMESTAMPTZ = TIMESTAMPTZ '2026-10-01 10:00:00+00'
  FROM platform_private.admissions_direct_case_updates u WHERE u.external_ref = 'cf1'),
  'P1: before_state holds the confirmed review and the source document of the overwritten field');
-- Write both rows back exactly as before_state has them.
UPDATE platform.student_profile_fields f SET value = r.value, review_state = r.review_state, profile_revision = r.profile_revision,
  reviewed_at = r.reviewed_at, reviewed_by_membership_id = r.reviewed_by_membership_id,
  source_document_version_id = r.source_document_version_id, source_document_slot_id = r.source_document_slot_id,
  source_page = r.source_page, updated_at = r.updated_at
FROM platform_private.admissions_direct_case_updates u
CROSS JOIN LATERAL jsonb_each(u.before_state -> 'fields') AS b(field_key, snapshot)
CROSS JOIN LATERAL jsonb_populate_record(NULL::platform.student_profile_fields, b.snapshot) AS r
WHERE u.external_ref = 'cf1' AND f.student_case_id = :'n287_case_c1'::UUID AND f.field_key = b.field_key
  AND (b.snapshot ->> 'existed')::BOOLEAN;
SELECT pg_temp.n287_assert((SELECT jsonb_object_agg(f.field_key, to_jsonb(f)) = :'n287_c1_rows'::JSONB
  FROM platform.student_profile_fields f
  WHERE f.student_case_id = :'n287_case_c1'::UUID AND f.field_key IN ('student_email', 'date_of_birth')),
  'P1: written back from before_state, both rows equal what they were (confirmed, reviewer, source document and page)');

-- ---------------------------------------------------------------------------
-- 5. Parents, education and route.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u9', jsonb_build_object('parents', jsonb_build_object(
  'mother', jsonb_build_object('firstName', 'Айгуль', 'lastName', 'Токтогулова', 'phone', '0555 287 021'),
  'father', jsonb_build_object('firstName', 'Бакыт')))) AS n287_u9 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u9b', jsonb_build_object('parents', jsonb_build_object(
  'mother', jsonb_build_object('firstName', 'Айгуль')))) AS n287_u9b \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u9'::JSONB -> 'changed' = '["parents"]'::JSONB AND :'n287_u9b'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT array_agg(f.field_key || '=' || f.value ORDER BY f.field_key) FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_x1'::UUID AND (f.field_key LIKE 'mother\_%' OR f.field_key LIKE 'father\_%'))
    = ARRAY['father_first_name=Бакыт', 'mother_first_name=Айгуль', 'mother_last_name=Токтогулова', 'mother_mobile_phone=+996555287021'],
  'u9: mother and father are written as анкета fields, the phone canonical; the same values again change nothing');
SELECT pg_temp.n287_assert((SELECT a.after_state -> 'updated_field_names'
    @> '["father_first_name","mother_first_name","mother_last_name","mother_mobile_phone"]'::JSONB
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u9', 'profile')), 'u9: the parents are journaled by field name');

SELECT pg_temp.n287_assert((SELECT c.target_country = 'CN' AND c.admissions_direction = 'CN' AND c.target_degree = 'Бакалавриат'
    AND c.program_direction = 'Computer Science' AND c.intake IS NULL FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID),
  'fixture: the route before the update');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u10', jsonb_build_object(
  'education', jsonb_build_object('current', '11 класс', 'english', 'IELTS 6.5', 'chinese', 'HSK 4'),
  'route', jsonb_build_object('degree', 'Магистратура', 'program', 'Engineering', 'intake', 'Сентябрь 2027'))) AS n287_u10 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u11', jsonb_build_object('education', jsonb_build_object('english', 'IELTS 7.0'))) AS n287_u11 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u10'::JSONB -> 'changed' = '["education","route"]'::JSONB
  AND (SELECT c.target_degree = 'Магистратура' AND c.program_direction = 'Engineering' AND c.intake = 'Сентябрь 2027'
    AND c.language_assumption = 'IELTS 7.0; HSK 4' AND c.target_country = 'CN' AND c.admissions_direction = 'CN'
    FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID),
  'u10-u11: education and route are written to the case; the country and the direction are not touched');
SELECT pg_temp.n287_assert(:'n287_u11'::JSONB -> 'changed' = '["education"]'::JSONB
  AND (SELECT p.current_education_summary = '11 класс' AND p.language_summary = 'IELTS 7.0; HSK 4'
    FROM platform.student_profiles p WHERE p.student_case_id = :'n287_case_x1'::UUID)
  AND (SELECT array_agg(f.field_key || '=' || f.value ORDER BY f.field_key) FROM platform.student_profile_fields f
    WHERE f.student_case_id = :'n287_case_x1'::UUID AND f.field_key IN ('current_study_status', 'english_level', 'chinese_level_hsk',
      'program_level', 'field_major'))
    = ARRAY['chinese_level_hsk=HSK 4', 'current_study_status=11 класс', 'english_level=IELTS 7.0', 'field_major=Engineering',
      'program_level=Магистратура'],
  'u10-u11: the профиль summaries and the анкета fields follow; an English level alone keeps the known Chinese level');
SELECT pg_temp.n287_assert((SELECT a.after_state -> 'updated_field_names'
    @> '["target_degree","program_direction","intake","language_assumption"]'::JSONB
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u10', 'route') AND a.action = 'case.route.change'
    AND a.actor_principal = 'service:admissions-import' AND a.resource_id = :'n287_case_x1'::UUID),
  'u10: case.route.change is journaled with the changed columns');
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform.student_profile_fields f WHERE f.student_case_id = :'n287_case_x1'::UUID
    AND f.field_key IN ('program_level', 'field_major', 'english_level') AND f.review_state <> 'needs_review'),
  'u10: the written fields wait for review');
SELECT pg_temp.n287_assert((SELECT u.before_state -> 'case' = jsonb_build_object('target_degree', 'Бакалавриат',
      'program_direction', 'Computer Science', 'intake', NULL, 'language_assumption', NULL)
    AND u.before_state -> 'profile' @> jsonb_build_object('revision', 6, 'current_education_summary', NULL, 'language_summary', NULL)
    AND u.before_state #> '{profile}' ?& ARRAY['updated_by_membership_id', 'updated_at']
    AND u.before_state #> '{fields,program_level}' @> jsonb_build_object('existed', TRUE, 'value', 'Бакалавриат',
      'review_state', 'needs_review', 'profile_revision', 1)
    AND u.before_state #> '{fields,english_level}' = '{"existed":false}'::JSONB
    AND NOT (u.before_state ? 'client') AND NOT (u.before_state ? 'pipeline') AND NOT (u.before_state ? 'curator')
  FROM platform_private.admissions_direct_case_updates u
  WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'u10'),
  'u10: before_state holds the old route, education and fields (and nothing of what was not changed)');

-- ---------------------------------------------------------------------------
-- 6. The board stage.
-- ---------------------------------------------------------------------------
SELECT c.pipeline_version AS n287_version_before FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u12', '{"pipelineStage":"documents"}'::JSONB) AS n287_u12 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u13', '{"pipelineStage":"documents"}'::JSONB) AS n287_u13 \gset
SELECT pg_temp.n287_try(:'n287_case_y1'::UUID, 'u13y', '{"pipelineStage":"shortlist"}'::JSONB) AS n287_u13y \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u12'::JSONB -> 'changed' = '["pipelineStage"]'::JSONB AND :'n287_u12'::JSONB ->> 'pipeline_stage' = 'documents'
  AND (SELECT c.pipeline_stage = 'documents' AND c.pipeline_hidden_at IS NULL AND c.pipeline_version = :n287_version_before + 1
    FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID),
  'u12: the case moves on the board and its position version grows by one');
SELECT pg_temp.n287_assert((SELECT a.before_state = '{"pipeline_stage":"new","pipeline_hidden":false}'::JSONB
    AND a.after_state ->> 'pipeline_stage' = 'documents' AND (a.after_state ->> 'pipeline_version')::BIGINT = :n287_version_before + 1
    AND a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n287_id(201)
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u12', 'pipeline') AND a.action = 'case.pipeline.move'),
  'u12: case.pipeline.move is journaled with the before and after position');
SELECT pg_temp.n287_assert((SELECT u.before_state = jsonb_build_object('pipeline', jsonb_build_object(
      'pipeline_stage', 'new', 'pipeline_hidden', FALSE, 'pipeline_version', :n287_version_before))
  FROM platform_private.admissions_direct_case_updates u WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'u12'),
  'u12: before_state holds the previous stage and position version');
SELECT pg_temp.n287_assert(:'n287_u13'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT c.pipeline_version = :n287_version_before + 1 FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u13', 'pipeline')),
  'u13: the same stage is no change: no new version, no journal row');
SELECT pg_temp.n287_assert(:'n287_u13y' = '55000:admissions_direct_update_case_not_active'
  AND (SELECT c.pipeline_stage = 'new' AND c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'n287_case_y1'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates u WHERE u.external_ref = 'u13y'),
  'P5: the board stage moves a case in work only: a case waiting for a curator is refused as not active, nothing written');
SET LOCAL request.jwt.claims TO :'n287_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n287_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_admissions_pipeline_board_v1() -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n287_case_x1' AND r ->> 'pipeline_stage' = 'documents'
      AND r ->> 'student_display_name' = 'N287 Full Name'),
  'the board shows the case in its new column under its new name');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. The curator.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_y1'::UUID, 'u14', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_u14 \gset
SELECT pg_temp.n287_call(:'n287_case_y1'::UUID, 'u15', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_u15 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u16', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(306)::TEXT)) AS n287_u16 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u14'::JSONB -> 'changed' = '["curatorMembershipId"]'::JSONB AND :'n287_u14'::JSONB ->> 'state' = 'active'
  AND (SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n287_id(306) AND c.handoff_at IS NOT NULL
      AND c.pipeline_stage = 'new'
    FROM platform.student_cases c WHERE c.id = :'n287_case_y1'::UUID)
  AND (SELECT e.event_type = 'assigned' AND e.new_curator_membership_id = pg_temp.n287_id(306)
      AND e.actor_membership_id = pg_temp.n287_id(301)
    FROM platform.student_case_assignment_events e WHERE e.request_id = pg_temp.n287_op('u14', 'assign'))
  AND NOT ('needs_curator' = ANY (platform_private.admissions_attention_flags(:'n287_case_y1'::UUID))),
  'u14: a waiting case takes the curator and becomes active (no longer in «Ждут куратора»)');
SELECT pg_temp.n287_assert((SELECT a.actor_principal = 'auth:' || pg_temp.n287_id(101)::TEXT AND a.actor_profile_id = pg_temp.n287_id(201)
    AND a.reason = 'Дополнение дел данными amoCRM по поручению владельца'
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u14', 'assign') AND a.action = 'case.curator.set'),
  'u14: case.curator.set is written by the shared e1 as auth:<Admin> (documented), tied to the call by its request id');
SELECT pg_temp.n287_assert((SELECT u.before_state = jsonb_build_object('curator', jsonb_build_object(
      'current_curator_membership_id', NULL, 'state', 'pending'))
  FROM platform_private.admissions_direct_case_updates u WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'u14'),
  'u14: before_state holds the waiting state without a curator');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_y1'::UUID, 'u14s', '{"pipelineStage":"shortlist"}'::JSONB) AS n287_u14s \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u14s'::JSONB -> 'changed' = '["pipelineStage"]'::JSONB
  AND (SELECT c.pipeline_stage = 'shortlist' FROM platform.student_cases c WHERE c.id = :'n287_case_y1'::UUID),
  'P5: once the curator is assigned the same case takes its board stage');
SELECT pg_temp.n287_assert(:'n287_u15'::JSONB -> 'changed' = '[]'::JSONB
  AND NOT EXISTS (SELECT 1 FROM platform.student_case_assignment_events e WHERE e.request_id = pg_temp.n287_op('u15', 'assign')),
  'u15: the same curator is no change and no error');
SELECT pg_temp.n287_assert((SELECT u.before_state = jsonb_build_object('curator', jsonb_build_object(
      'current_curator_membership_id', pg_temp.n287_id(304), 'state', 'active'))
  FROM platform_private.admissions_direct_case_updates u WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'u16'),
  'u16: before_state holds the previous curator');
SELECT pg_temp.n287_assert(:'n287_u16'::JSONB -> 'changed' = '["curatorMembershipId"]'::JSONB
  AND (SELECT e.event_type = 'reassigned' AND e.previous_curator_membership_id = pg_temp.n287_id(304)
      AND e.new_curator_membership_id = pg_temp.n287_id(306)
    FROM platform.student_case_assignment_events e WHERE e.request_id = pg_temp.n287_op('u16', 'assign'))
  AND (SELECT c.current_curator_membership_id = pg_temp.n287_id(306) FROM platform.student_cases c WHERE c.id = :'n287_case_x1'::UUID),
  'u16: another curator is assigned (reassigned) by the shared helper');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_y2'::UUID, 'u17a', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(302)::TEXT))
    = '22023:admissions_direct_invalid:curator'
  AND pg_temp.n287_try(:'n287_case_y2'::UUID, 'u17b', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(305)::TEXT))
    = '22023:admissions_direct_invalid:curator'
  AND pg_temp.n287_try(:'n287_case_y2'::UUID, 'u17c', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(999)::TEXT))
    = '22023:admissions_direct_invalid:curator',
  'a Sales Manager, a Student and a stranger are not eligible curators');
RESET ROLE;
SELECT pg_temp.n287_assert((SELECT c.state = 'pending' FROM platform.student_cases c WHERE c.id = :'n287_case_y2'::UUID),
  'the refused curator left the case waiting');

-- ---------------------------------------------------------------------------
-- 8. The amoCRM lead id.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u18', '{"amoLeadId":"4000001"}'::JSONB) AS n287_u18 \gset
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u19', '{"amoLeadId":4000001}'::JSONB) AS n287_u19 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u18'::JSONB -> 'changed' = '["amoLeadId"]'::JSONB
  AND (SELECT e.lead_id = :'n287_lead_x1'::UUID AND e.client_id IS NULL AND e.source_ref = 'n287-amocrm-update:u18'
      AND e.imported_at IS NOT NULL
    FROM platform.external_identifiers e WHERE e.organization_id = pg_temp.n287_id(1) AND e.source_system = 'amocrm'
      AND e.external_object_type = 'lead' AND e.external_identifier = '4000001')
  AND (SELECT count(*) = 1 FROM platform.subject_provenance p WHERE p.lead_id = :'n287_lead_x1'::UUID
      AND p.source_system = 'amocrm' AND p.evidence_type = 'imported'),
  'u18: the amoCRM lead id is bound to the lead of the case, with imported provenance');
SELECT pg_temp.n287_assert((SELECT a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n287_id(201)
    AND a.resource_type = 'lead' AND a.resource_id = :'n287_lead_x1'::UUID
    AND a.after_state ->> 'external_identifier' = '4000001'
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u18', 'amo') AND a.action = 'lead.amocrm.link'),
  'u18: lead.amocrm.link is journaled for the service principal');
SELECT pg_temp.n287_assert(:'n287_u19'::JSONB -> 'changed' = '[]'::JSONB
  AND (SELECT count(*) = 1 FROM platform.external_identifiers e WHERE e.source_system = 'amocrm' AND e.external_identifier = '4000001'),
  'u19: the same binding again (a JSON number) does nothing and is no error');
-- Conflicts apply nothing (the whole call is atomic).
SELECT n.pipeline_version AS n287_v1_version FROM platform.student_cases n WHERE n.id = :'n287_case_v1'::UUID \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_v1'::UUID, 'u20', '{"amoLeadId":"4000001","pipelineStage":"visa","note":"N287 must not exist"}'::JSONB)
    = 'PT409:admissions_direct_update_amo_conflict'
  AND pg_temp.n287_try(:'n287_case_x1'::UUID, 'u21', '{"amoLeadId":"4000002","note":"N287 must not exist"}'::JSONB)
    = 'PT409:admissions_direct_update_amo_conflict'
  AND pg_temp.n287_try(:'n287_case_v1'::UUID, 'u22', '{"amoLeadId":"4000003","pipelineStage":"visa"}'::JSONB)
    = 'PT409:admissions_direct_update_amo_conflict',
  'an amoCRM id bound to another lead or to a client, or another id on a bound lead, is a conflict');
RESET ROLE;
SELECT pg_temp.n287_assert((SELECT c.pipeline_version = :n287_v1_version AND c.pipeline_stage = 'new' FROM platform.student_cases c
    WHERE c.id = :'n287_case_v1'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes n WHERE n.body = 'N287 must not exist')
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates u WHERE u.external_ref IN ('u20', 'u21', 'u22'))
  AND NOT EXISTS (SELECT 1 FROM platform.external_identifiers e WHERE e.lead_id = :'n287_lead_v1'::UUID AND e.source_system = 'amocrm'),
  'the conflict applied nothing: no stage, no note, no receipt, no binding');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_v1'::UUID, 'u23', '{"amoLeadId":4000009}'::JSONB) AS n287_u23 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u23'::JSONB -> 'changed' = '["amoLeadId"]'::JSONB
  AND EXISTS (SELECT 1 FROM platform.external_identifiers e WHERE e.external_identifier = '4000009' AND e.lead_id = :'n287_lead_v1'::UUID),
  'a JSON number is bound as its digits');

-- ---------------------------------------------------------------------------
-- 9. The note.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u24', jsonb_build_object('note', E' N287 amoCRM note\nsecond line ')) AS n287_u24 \gset
SELECT pg_temp.n287_call(:'n287_case_v1'::UUID, 'u25', jsonb_build_object('note', repeat('y', 3500))) AS n287_u25 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_u24'::JSONB -> 'changed' = '["note"]'::JSONB
  AND (SELECT n.body = E'N287 amoCRM note\nsecond line' AND n.created_by_membership_id = pg_temp.n287_id(301)
    FROM platform.case_notes n WHERE n.student_case_id = :'n287_case_x1'::UUID),
  'u24: the note is added to the case by the Admin membership, trimmed');
SELECT pg_temp.n287_assert((SELECT a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n287_id(201)
    AND a.resource_type = 'student_case' AND (a.after_state ->> 'body_chars')::INTEGER = char_length(E'N287 amoCRM note\nsecond line')
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n287_op('u24', 'note') AND a.action = 'note.create'),
  'u24: note.create is journaled for the service principal');
SELECT pg_temp.n287_assert(:'n287_u25'::JSONB -> 'changed' = '["note"]'::JSONB
  AND (SELECT char_length(n.body) = 3500 FROM platform.case_notes n WHERE n.student_case_id = :'n287_case_v1'::UUID),
  'u25: a note of 3500 characters is accepted');

-- ---------------------------------------------------------------------------
-- 10. Closing, last.
-- ---------------------------------------------------------------------------
SELECT c.admissions_version AS n287_z1_version FROM platform.student_cases c WHERE c.id = :'n287_case_z1'::UUID \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_z1'::UUID, 'k1', '{"close":{"outcome":"enrolled"},"note":"N287 closing note"}'::JSONB) AS n287_k1 \gset
SELECT pg_temp.n287_call(:'n287_case_z2'::UUID, 'k2', '{"close":{"outcome":"declined"}}'::JSONB) AS n287_k2 \gset
SELECT pg_temp.n287_call(:'n287_case_z3'::UUID, 'k3', '{"close":{"outcome":"not_admitted"},"pipelineStage":"arrived"}'::JSONB) AS n287_k3 \gset
SELECT pg_temp.n287_call(:'n287_case_z4'::UUID, 'k4', '{"close":{"outcome":"other","note":"N287 moved to another country"}}'::JSONB) AS n287_k4 \gset
RESET ROLE;
SELECT pg_temp.n287_assert(:'n287_k1'::JSONB -> 'changed' = '["note","close"]'::JSONB AND (:'n287_k1'::JSONB ->> 'closed')::BOOLEAN
  AND :'n287_k1'::JSONB ->> 'state' = 'closed' AND NOT (:'n287_k1'::JSONB ? 'already_closed')
  AND :'n287_k3'::JSONB -> 'changed' = '["pipelineStage","close"]'::JSONB AND :'n287_k3'::JSONB ->> 'pipeline_stage' = 'arrived'
  AND :'n287_k2'::JSONB -> 'changed' = '["close"]'::JSONB AND :'n287_k4'::JSONB -> 'changed' = '["close"]'::JSONB,
  'k1-k4: the closing is the last change of the call (after the note and the stage)');
SELECT pg_temp.n287_assert((SELECT c.state = 'closed' AND c.closed_at IS NOT NULL AND c.admissions_version = :n287_z1_version + 1
    AND c.current_curator_membership_id = pg_temp.n287_id(304) AND c.admissions_playbook_version_id IS NULL
  FROM platform.student_cases c WHERE c.id = :'n287_case_z1'::UUID),
  'k1: the case is closed, the version grows by one, the curator stays');
SELECT pg_temp.n287_assert((SELECT array_agg(a.after_state ->> 'outcome' || '/' || COALESCE(a.after_state ->> 'note', '∅') ORDER BY a.resource_id::TEXT)
    FROM platform.audit_events a WHERE a.action = 'case.lifecycle.change' AND a.resource_id IN (
      :'n287_case_z1'::UUID, :'n287_case_z2'::UUID, :'n287_case_z3'::UUID, :'n287_case_z4'::UUID))
  = (SELECT array_agg(x.v ORDER BY x.id::TEXT) FROM (VALUES
      (:'n287_case_z1'::UUID, 'enrolled/∅'), (:'n287_case_z2'::UUID, 'declined/∅'), (:'n287_case_z3'::UUID, 'not_admitted/∅'),
      (:'n287_case_z4'::UUID, 'other/N287 moved to another country')) AS x(id, v)),
  'k1-k4: every outcome (and the reason of «other») is journaled as case.lifecycle.change');
SELECT pg_temp.n287_assert((SELECT a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n287_id(201)
    AND a.actor_membership_id = pg_temp.n287_id(301) AND a.reason = 'Дополнение дел данными amoCRM по поручению владельца'
    AND a.resulting_version = :n287_z1_version + 1 AND a.request_id = pg_temp.n287_op('k1', 'close')
  FROM platform.audit_events a WHERE a.action = 'case.lifecycle.change' AND a.resource_id = :'n287_case_z1'::UUID),
  'k1: the closing row carries the service principal, the Admin profile, the reason and the new version');
SELECT pg_temp.n287_assert((SELECT e.event_type = 'closed' AND e.previous_state = 'active' AND e.new_state = 'closed'
    AND e.actor_membership_id = pg_temp.n287_id(301) AND e.reason = 'Case finished: enrolled'
  FROM platform.student_case_lifecycle_events e WHERE e.student_case_id = :'n287_case_z1'::UUID AND e.event_type = 'closed'),
  'k1: the lifecycle event is written (active -> closed)');
SELECT pg_temp.n287_assert((SELECT u.before_state = jsonb_build_object('close', jsonb_build_object('state', 'active',
      'closed_at', NULL, 'admissions_version', :'n287_z1_version', 'admissions_outcome', NULL))
  FROM platform_private.admissions_direct_case_updates u WHERE u.organization_id = pg_temp.n287_id(1) AND u.external_ref = 'k1'),
  'k1: before_state holds the state before the closing (the note it also added is not a value to restore)');
-- The read behind «Завершено» (staff_student_case_closure_v1) joins the
-- lifecycle event to the journal row by request id: it finds the outcome.
SELECT pg_temp.n287_assert((SELECT audit.after_state ->> 'outcome' = 'enrolled' AND closer.display_name = 'N287 Actor 1'
  FROM platform.student_case_lifecycle_events AS event
  LEFT JOIN platform.organization_memberships AS m ON m.organization_id = event.organization_id AND m.id = event.actor_membership_id
  LEFT JOIN platform.profiles AS closer ON closer.id = m.profile_id
  LEFT JOIN platform.audit_events AS audit ON audit.request_id = event.request_id AND audit.action = 'case.lifecycle.change'
    AND audit.resource_type = 'student_case' AND audit.resource_id = event.student_case_id
  WHERE event.student_case_id = :'n287_case_z1'::UUID AND event.event_type = 'closed'),
  'k1: the closure read of the case sees the outcome and who closed it');
-- Already closed: nothing, no error.
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_z1'::UUID, 'k5', '{"close":{"outcome":"declined"}}'::JSONB) AS n287_k5 \gset
SELECT pg_temp.n287_call(:'n287_case_z1'::UUID, 'k6', '{"close":{"outcome":"enrolled"},"pipelineStage":"new"}'::JSONB) AS n287_k6 \gset
RESET ROLE;
SELECT pg_temp.n287_assert((:'n287_k5'::JSONB ->> 'already_closed')::BOOLEAN AND :'n287_k5'::JSONB -> 'changed' = '[]'::JSONB
  AND NOT (:'n287_k5'::JSONB ? 'closed')
  AND (SELECT count(*) = 1 FROM platform.student_case_lifecycle_events e WHERE e.student_case_id = :'n287_case_z1'::UUID AND e.event_type = 'closed')
  AND (SELECT c.admissions_version = :n287_z1_version + 1 FROM platform.student_cases c WHERE c.id = :'n287_case_z1'::UUID),
  'k5: an already closed case is left as it is (already_closed), the first outcome stays');
SELECT pg_temp.n287_assert((:'n287_k6'::JSONB ->> 'already_closed')::BOOLEAN AND :'n287_k6'::JSONB -> 'changed' = '[]'::JSONB,
  'k6: the stage a closed case already has is no change, the closing again reports already_closed');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
-- The board stage of a CLOSED case is not moved; its data can still be completed.
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_z2'::UUID, 'k7', '{"pipelineStage":"visa"}'::JSONB)
    = '55000:admissions_direct_update_case_closed'
  AND (pg_temp.n287_call(:'n287_case_z2'::UUID, 'k8', '{"student":{"birthDate":"2008-01-02"}}'::JSONB) -> 'changed') = '["student"]'::JSONB,
  'a closed case does not move on the board but its data can still be completed');
-- A case without a curator cannot be closed, and nothing else of the call applies.
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_y2'::UUID, 'k9',
    '{"note":"N287 must not exist","pipelineStage":"visa","close":{"outcome":"declined"}}'::JSONB)
  = '55000:admissions_direct_update_case_not_active'
  AND pg_temp.n287_try(:'n287_case_y2'::UUID, 'k9b', '{"note":"N287 must not exist","close":{"outcome":"declined"}}'::JSONB)
  = '55000:admissions_direct_update_case_not_active', 'a case without a curator is not closed (with or without a stage in the call)');
SELECT pg_temp.n287_call(:'n287_case_y3'::UUID, 'k10', jsonb_build_object('curatorMembershipId', pg_temp.n287_id(304)::TEXT,
  'pipelineStage', 'visa', 'close', jsonb_build_object('outcome', 'enrolled'))) AS n287_k10 \gset
RESET ROLE;
SELECT pg_temp.n287_assert((SELECT c.state = 'pending' AND c.pipeline_stage = 'new' FROM platform.student_cases c WHERE c.id = :'n287_case_y2'::UUID)
  AND NOT EXISTS (SELECT 1 FROM platform.case_notes n WHERE n.body = 'N287 must not exist')
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates u WHERE u.external_ref = 'k9'),
  'k9: the refused closing applied nothing of the call');
SELECT pg_temp.n287_assert(:'n287_k10'::JSONB -> 'changed' = '["curatorMembershipId","pipelineStage","close"]'::JSONB
  AND (SELECT c.state = 'closed' AND c.current_curator_membership_id = pg_temp.n287_id(304) AND c.pipeline_stage = 'visa'
    FROM platform.student_cases c WHERE c.id = :'n287_case_y3'::UUID)
  AND (SELECT array_agg(a.action ORDER BY a.action) FROM platform.audit_events a
    WHERE a.request_id IN (pg_temp.n287_op('k10', 'assign'), pg_temp.n287_op('k10', 'pipeline'), pg_temp.n287_op('k10', 'close')))
    = ARRAY['case.curator.set', 'case.lifecycle.change', 'case.pipeline.move'],
  'k10: the curator, the stage and the closing in one call: a waiting case is activated first and closed last');

-- ---------------------------------------------------------------------------
-- 11. Replay, conflict and the receipts.
-- ---------------------------------------------------------------------------
SELECT count(*) AS n287_audit_before_replay FROM platform.audit_events \gset
SELECT count(*) AS n287_updates_before_replay FROM platform_private.admissions_direct_case_updates \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_x1'::UUID, 'u1', jsonb_build_object('student', jsonb_build_object(
  'firstName', 'Айбек', 'lastName', 'Токтогулов', 'phone', '0700 287 011', 'email', 'N287-New@Example.INVALID',
  'birthDate', '2007-03-04'))) AS n287_replay \gset
SELECT pg_temp.n287_call(:'n287_case_z1'::UUID, 'k1', '{"close":{"outcome":"enrolled"},"note":"N287 closing note"}'::JSONB) AS n287_replay_close \gset
RESET ROLE;
SELECT pg_temp.n287_assert((:'n287_replay'::JSONB ->> 'replayed')::BOOLEAN AND (:'n287_replay'::JSONB - 'replayed') = (:'n287_u1'::JSONB - 'replayed')
  AND (:'n287_replay_close'::JSONB ->> 'replayed')::BOOLEAN AND (:'n287_replay_close'::JSONB ->> 'closed')::BOOLEAN
  AND (SELECT count(*) FROM platform.audit_events) = :n287_audit_before_replay
  AND (SELECT count(*) FROM platform_private.admissions_direct_case_updates) = :n287_updates_before_replay,
  'the same reference and body return the same result, marked replayed, and write nothing (even long after the state moved on)');
SELECT pg_temp.n287_assert(NOT (:'n287_replay'::JSONB ? 'before_state') AND NOT (:'n287_replay_close'::JSONB ? 'before_state')
  AND (SELECT md5(u.before_state::TEXT) = :'n287_u1_before_md5' FROM platform_private.admissions_direct_case_updates u
    WHERE u.organization_id = pg_temp.n287_id(1) AND u.update_source = 'n287-amocrm-update' AND u.external_ref = 'u1'),
  'a replay returns no before_state and leaves the kept one exactly as the first call wrote it');
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_assert(pg_temp.n287_try(:'n287_case_x1'::UUID, 'u1', jsonb_build_object('student', jsonb_build_object('name', 'N287 Other')))
    = 'PT409:admissions_direct_update_conflict'
  AND pg_temp.n287_try(:'n287_case_v1'::UUID, 'u1', jsonb_build_object('student', jsonb_build_object(
    'firstName', 'Айбек', 'lastName', 'Токтогулов', 'phone', '0700 287 011', 'email', 'N287-New@Example.INVALID',
    'birthDate', '2007-03-04'))) = 'PT409:admissions_direct_update_conflict'
  AND pg_temp.n287_error(format('SELECT platform.update_admissions_direct_case_v1(%L, %L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n287_id(1), pg_temp.n287_id(301), :'n287_case_x1', 'n287-amocrm-update', 'u24',
    jsonb_build_object('note', E' N287 amoCRM note\nsecond line ')::TEXT, 'Другая причина')) = 'PT409:admissions_direct_update_conflict',
  'another body, another case or another reason under the same pair is a conflict');
-- The same reference under another source is another request.
SELECT pg_temp.n287_assert((platform.update_admissions_direct_case_v1(pg_temp.n287_id(1), pg_temp.n287_id(301), :'n287_case_x1'::UUID,
    'n287-other-source', 'u1', '{"student":{"name":"N287 Other Source"}}'::JSONB, 'N287') -> 'changed') = '["student"]'::JSONB,
  'the same reference under another update source is another request');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 12. The journal of every call.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n287_assert((SELECT bool_and(a.actor_principal = 'service:admissions-import' AND a.actor_kind = 'user'
      AND a.actor_profile_id = pg_temp.n287_id(201) AND a.actor_membership_id = pg_temp.n287_id(301))
    AND count(*) >= 15
  FROM platform.audit_events a WHERE a.organization_id = pg_temp.n287_id(1)
    AND a.action IN ('student.profile.upsert', 'case.route.change', 'case.pipeline.move', 'lead.amocrm.link', 'note.create',
      'case.lifecycle.change')),
  'every journal row of the update carries the service principal, the Admin profile and membership');
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a
    WHERE a.organization_id = pg_temp.n287_id(1) AND a.action = 'case.curator.set'
      AND a.reason = 'Дополнение дел данными amoCRM по поручению владельца'
      AND a.actor_principal <> 'auth:' || pg_temp.n287_id(101)::TEXT)
  AND (SELECT count(*) FROM platform.audit_events a WHERE a.action = 'case.curator.set'
    AND a.reason = 'Дополнение дел данными amoCRM по поручению владельца') >= 3,
  'the curator rows are the shared helper''s auth:<Admin> rows, as in 281');
SELECT pg_temp.n287_assert((SELECT count(DISTINCT a.request_id) = count(*) FROM platform.audit_events a WHERE a.organization_id = pg_temp.n287_id(1)),
  'request ids are unique');

-- ---------------------------------------------------------------------------
-- 13. Money, sales and 281's receipts are untouched.
-- ---------------------------------------------------------------------------
SELECT md5(COALESCE(string_agg(t.row_text, '|' ORDER BY t.row_text), '')) AS n287_money_now FROM (
  SELECT o.student_case_id::TEXT || o.amount_minor::TEXT || o.total_paid_minor::TEXT || o.currency AS row_text
  FROM platform.payment_obligations o WHERE o.organization_id = pg_temp.n287_id(1)
  UNION ALL SELECT e.student_case_id::TEXT || e.amount_minor::TEXT || e.event_type FROM platform.payment_events e
    WHERE e.organization_id = pg_temp.n287_id(1)) t \gset
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n287_call(:'n287_case_m1'::UUID, 'm1', jsonb_build_object(
  'student', jsonb_build_object('name', 'N287 Money Renamed', 'birthDate', '2006-06-06'),
  'pipelineStage', 'visa', 'curatorMembershipId', pg_temp.n287_id(306)::TEXT, 'amoLeadId', '4000010', 'note', 'N287 money case note',
  'close', jsonb_build_object('outcome', 'enrolled'))) AS n287_m1_update \gset
RESET ROLE;
SELECT md5(COALESCE(string_agg(t.row_text, '|' ORDER BY t.row_text), '')) AS n287_money_after FROM (
  SELECT o.student_case_id::TEXT || o.amount_minor::TEXT || o.total_paid_minor::TEXT || o.currency AS row_text
  FROM platform.payment_obligations o WHERE o.organization_id = pg_temp.n287_id(1)
  UNION ALL SELECT e.student_case_id::TEXT || e.amount_minor::TEXT || e.event_type FROM platform.payment_events e
    WHERE e.organization_id = pg_temp.n287_id(1)) t \gset
SELECT pg_temp.n287_assert(:'n287_m1_update'::JSONB -> 'changed' = '["student","curatorMembershipId","pipelineStage","amoLeadId","note","close"]'::JSONB
  AND :'n287_money_now' = :'n287_money_after' AND :'n287_money_now' = (SELECT money_md5 FROM n287_before)
  AND (SELECT o.total_paid_minor = 50000 AND o.amount_minor = 150000 FROM platform.payment_obligations o
    WHERE o.student_case_id = :'n287_case_m1'::UUID)
  AND (SELECT s.fields ->> 'service_cost_minor' = '150000' FROM platform_private.lead_sale_conditions s WHERE s.lead_id = (:'n287_m1'::JSONB ->> 'lead_id')::UUID),
  'the tranches, payments and the contract cost of a case with money are exactly as they were after a full update and closing');
SELECT pg_temp.n287_assert((SELECT
    (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.n287_id(1)) = b.register_rows
    AND (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n287_id(1)) = b.handoffs
    AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n287_id(1) AND lifecycle_state = 'open') = b.open_leads
    AND (SELECT count(*) FROM platform_private.admissions_direct_case_receipts WHERE organization_id = pg_temp.n287_id(1)) = b.receipts
    AND (SELECT count(*) FROM platform.student_cases WHERE organization_id = pg_temp.n287_id(1)) = b.cases
  FROM n287_before b), 'no sales record, handoff, open lead, receipt of 281 or case was added');
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform.leads l WHERE l.id IN (
    SELECT r.lead_id FROM platform_private.admissions_direct_case_receipts r WHERE r.organization_id = pg_temp.n287_id(1))
    AND (l.lifecycle_state <> 'converted' OR l.current_owner_membership_id IS NOT NULL)),
  'every lead of a direct case stays converted and without a sales owner');

-- ---------------------------------------------------------------------------
-- 14. Posture of the new objects.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n287_assert(
  has_function_privilege('service_role', 'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.admissions_direct_update_object(jsonb,text,text[])', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.admissions_direct_update_object(jsonb,text,text[])', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.admissions_direct_case_updates', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.admissions_direct_case_updates', 'SELECT')
  AND NOT has_table_privilege('anon', 'platform_private.admissions_direct_case_updates', 'SELECT'),
  'grants: the update for service_role only; the helper and the receipts table for nobody');
SELECT pg_temp.n287_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] FROM pg_proc p
  WHERE p.oid = 'platform.update_admissions_direct_case_v1(uuid,uuid,uuid,text,text,jsonb,text)'::regprocedure),
  'SECURITY DEFINER with the empty search_path');
SELECT pg_temp.n287_assert((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid = 'platform_private.admissions_direct_case_updates'::regclass), 'receipts: forced RLS');
SELECT pg_temp.n287_assert((SELECT c.is_nullable = 'NO' FROM information_schema.columns c
    WHERE c.table_schema = 'platform_private' AND c.table_name = 'admissions_direct_case_updates' AND c.column_name = 'before_state')
  AND pg_temp.n287_error(format('INSERT INTO platform_private.admissions_direct_case_updates (organization_id, update_source, external_ref, student_case_id, actor_membership_id, payload_md5, result, before_state) VALUES (%L, %L, %L, %L, %L, %L, %L::JSONB, NULL)',
    pg_temp.n287_id(1), 'n287-x', 'x', :'n287_case_x1', pg_temp.n287_id(301), repeat('a', 32), '{}')) LIKE '23502:%',
  'receipts: before_state is NOT NULL');
SELECT pg_temp.n287_assert(NOT EXISTS (SELECT 1 FROM platform.audit_events a WHERE a.organization_id = pg_temp.n287_id(1)
    AND a.actor_principal = 'service:admissions-import' AND a.action <> 'case.create'
    AND (a.before_state::TEXT ~ '(Bakalavr|Бакалавриат|Computer Science|n287-x@|555287001|N287 Student X)'
      OR a.after_state::TEXT ~ '(Бакалавриат|Computer Science|n287-x@|555287001|n287-new@|700287011)')),
  'the journal still carries no previous or new contact, name or route value');
SELECT pg_temp.n287_assert(pg_temp.n287_error(format('UPDATE platform_private.admissions_direct_case_updates SET external_ref = %L', 'forged')) <> 'ok'
  AND pg_temp.n287_error('DELETE FROM platform_private.admissions_direct_case_updates') <> 'ok'
  AND pg_temp.n287_error('TRUNCATE platform_private.admissions_direct_case_updates') <> 'ok'
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_updates WHERE external_ref = 'forged'),
  'receipts are append-only');
SELECT pg_temp.n287_assert((SELECT count(*) FROM platform_private.admissions_direct_case_updates
    WHERE organization_id = pg_temp.n287_id(1) AND update_source = 'n287-amocrm-update') >= 30
  AND (SELECT bool_and(u.payload_md5 ~ '^[0-9a-f]{32}$' AND jsonb_typeof(u.result) = 'object' AND NOT (u.result ? 'replayed'))
    FROM platform_private.admissions_direct_case_updates u),
  'each accepted call left one receipt (fingerprint and result, without the replay flag)');

SELECT 'N287_ADMISSIONS_DIRECT_UPDATE_SUITE_PASSED' AS n287_suite_marker;
ROLLBACK;
