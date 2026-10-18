\set ON_ERROR_STOP on
-- Boundary suite for migration 306 (подсказка «Похоже на»: номер лида или дела
-- записан как телефон родителя в анкете другого студента, #1198 пункт 2; решение
-- владельца 18.10.2026). Members are modelled like production after 155 (as in
-- 281's suite): invited staff have coarse role NULL and get permissions only from
-- scoped role assignments with the production keys. Cases come through the real
-- «Добавить студента» command (the parent phone is stored exactly as that path
-- stores it), leads through the real manual command and the website receiver.
-- Proves:
--  H1 the match: a lead typed in another spelling finds the case whose анкета has
--     the number as mother or father (+996 and national «0…», digits-only as a
--     student types it in the portal), relation mother | father | both, a near
--     miss does not match, ordering (in work first, then newest);
--  H2 nothing merges: the hint adds no client, lead, case, анкета row, candidate
--     or journal entry; the lead and the case keep their own clients;
--  H3 the same person is no lookalike: a case whose parent phone is its own
--     student's number, and its own converted lead, return nothing;
--  H4 the authorization matrix. Subject: a lead is read by who reads the lead
--     (Admin, its Sales owner), a case by who reads the case (Admin, the
--     Admissions Manager of its department, its curator); anyone else, an
--     unknown id, the Student, no membership, anon, service_role and another
--     organization get 42501. Matches: only the cases the same member reads in
--     full AND whose анкета it reads (profile.read.full): the Sales Manager sees
--     nothing, a curator only its own cases, the Manager of one department not
--     the other department's, and a waiting (curator-less) case that the Manager
--     reads but whose анкета it does not is left out;
--  H5 tenancy: another organization's case with the same number is never listed;
--  H6 the contract: exactly one subject (22023), constant error messages, no
--     phone or name in the answer keys, no RAISE of NOTICE|LOG, a read-only
--     SECURITY DEFINER with an empty search_path, EXECUTE for authenticated only.
-- Isolated synthetic SQL fixtures only.
BEGIN;

-- The Supabase auth.role() helper receive_website_lead calls first (absent
-- from the bare test image); created inside this transaction only, as in
-- 262's suite.
DO $n306_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n306_auth_role$;

CREATE FUNCTION pg_temp.n306_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('30600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n306_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N306: %', message; END IF;
END
$$;
-- A student for the real direct command: name, own phone, one parent and a curator (or none).
CREATE FUNCTION pg_temp.n306_student(p_name TEXT, p_phone TEXT, p_relation TEXT, p_parent_phone TEXT, p_curator INTEGER)
RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'student', jsonb_build_object('name', p_name, 'phone', p_phone),
    'parent', CASE WHEN p_parent_phone IS NULL THEN NULL ELSE jsonb_build_object('relation', p_relation, 'phone', p_parent_phone) END,
    'route', jsonb_build_object('country', 'MY'),
    'curatorMembershipId', CASE WHEN p_curator IS NULL THEN NULL ELSE pg_temp.n306_id(p_curator)::TEXT END))
$$;
-- The answer as «relation:name» in answer order joined by «|» ('' for none), or «ERR sqlstate:message».
CREATE FUNCTION pg_temp.n306_hint(p_org UUID, p_lead UUID, p_case UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer JSONB;
BEGIN
  answer := platform.read_parent_phone_lookalikes_v1(p_org, p_lead, p_case);
  RETURN COALESCE((SELECT string_agg((e ->> 'relation') || ':' || (e ->> 'studentName'), '|' ORDER BY o)
    FROM jsonb_array_elements(answer) WITH ORDINALITY AS t(e, o)), '');
EXCEPTION WHEN OTHERS THEN RETURN 'ERR ' || SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.n306_raw(p_org UUID, p_lead UUID, p_case UUID) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT platform.read_parent_phone_lookalikes_v1(p_org, p_lead, p_case)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n306_id(INTEGER), pg_temp.n306_assert(BOOLEAN, TEXT),
  pg_temp.n306_student(TEXT, TEXT, TEXT, TEXT, INTEGER), pg_temp.n306_hint(UUID, UUID, UUID),
  pg_temp.n306_raw(UUID, UUID, UUID) TO authenticated, anon, service_role;

SELECT 'N306_PARENT_PHONE_LOOKALIKES_SUITE_START' AS n306_suite_marker;


-- ---------------------------------------------------------------------------
-- Fixture: 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager (sales department), 3 Admissions Manager, 4 Admissions A and
-- 6 Admissions B (admissions department), 7 Admissions C (a second admissions
-- department), 8 the Admissions Manager keys in an «own» scope (admissions
-- department); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n306_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n306_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, NULL), (9, NULL);
GRANT SELECT ON n306_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n306_id(1), 'N306 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n306_id(100 + n), 'n306-' || n || '@example.invalid', '{}'::JSONB FROM n306_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n306_id(199), 'n306-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n306_id(200 + n), pg_temp.n306_id(100 + n), 'N306 Actor ' || n, 'active', 1 FROM n306_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n306_id(300 + n), pg_temp.n306_id(1), pg_temp.n306_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n306_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n306_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n306_id(401), pg_temp.n306_id(1), 'organization', pg_temp.n306_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n306_id(1), pg_temp.n306_id(301), pg_temp.n306_id(401), 1, 1, TRUE, 'system',
    'N306 synthetic organization scope', pg_temp.n306_id(601)),
  (pg_temp.n306_id(1), pg_temp.n306_id(305), pg_temp.n306_id(401), 1, 1, TRUE, 'system',
    'N306 synthetic Student organization scope', pg_temp.n306_id(605));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n306_id(901), pg_temp.n306_id(1), 'N306 Sales'),
  (pg_temp.n306_id(902), pg_temp.n306_id(1), 'N306 Admissions'),
  (pg_temp.n306_id(903), pg_temp.n306_id(1), 'N306 Admissions 2');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n306_id(1), pg_temp.n306_id(302), pg_temp.n306_id(901)),
  (pg_temp.n306_id(1), pg_temp.n306_id(303), pg_temp.n306_id(902)),
  (pg_temp.n306_id(1), pg_temp.n306_id(304), pg_temp.n306_id(902)),
  (pg_temp.n306_id(1), pg_temp.n306_id(306), pg_temp.n306_id(902)),
  (pg_temp.n306_id(1), pg_temp.n306_id(307), pg_temp.n306_id(903)),
  (pg_temp.n306_id(1), pg_temp.n306_id(308), pg_temp.n306_id(902));

-- Roles with the EXACT production permission keys (as 244's suite), without
-- case.create.direct: the migration's publication adds it.
CREATE TEMP TABLE n306_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n306_roles VALUES
 (pg_temp.n306_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n306_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n306_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n306_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150),
 (pg_temp.n306_id(1106), 'Profile reader', '["client.read","lead.read","profile.read.full"]', 1160);
CREATE TEMP TABLE n306_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n306_grants VALUES
 (302, pg_temp.n306_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n306_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n306_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n306_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n306_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n306_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n306_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n306_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n306_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n306_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (307, pg_temp.n306_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL)),
 (308, pg_temp.n306_id(1102), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (308, pg_temp.n306_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL)),
 (309, pg_temp.n306_id(1106), jsonb_build_object('kind', 'organization', 'key', pg_temp.n306_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n306_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n306_id(1);
GRANT SELECT ON n306_roles, n306_grants, n306_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n306_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n306_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n306_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n306_admin_setup';
SET LOCAL ROLE authenticated;
DO $n306_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n306_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n306_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N306 ' || r.label, 'description', 'Migration 281 synthetic role',
        'permissionKeys', r.keys), 'N306 create role', pg_temp.n306_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n306_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n306_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N306 publish role', pg_temp.n306_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n306_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n306_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n306_id(1), pg_temp.n306_id(m),
      (SELECT access_version FROM n306_versions WHERE membership_id = pg_temp.n306_id(m)), items, bindings,
      'N306 grant roles', pg_temp.n306_id(2000 + m));
  END LOOP;
END
$n306_roles$;
RESET ROLE;

-- Curators may name each other only after the publication of case.create.direct
-- (the migration did it for the live roles); the fixture roles need the same.
SELECT platform_private.admissions_direct_grant_curator_roles('N306 publication') AS n306_grant \gset

-- Claims from live rows after the publication bumped access versions.
UPDATE n306_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n306_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n306_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n306_admin FROM n306_actors WHERE n = 1 \gset
SELECT claims AS n306_sales_manager FROM n306_actors WHERE n = 2 \gset
SELECT claims AS n306_manager FROM n306_actors WHERE n = 3 \gset
SELECT claims AS n306_a FROM n306_actors WHERE n = 4 \gset
SELECT claims AS n306_student FROM n306_actors WHERE n = 5 \gset
SELECT claims AS n306_b FROM n306_actors WHERE n = 6 \gset
SELECT claims AS n306_c FROM n306_actors WHERE n = 7 \gset
SELECT claims AS n306_own_manager FROM n306_actors WHERE n = 8 \gset
SELECT claims AS n306_profile_reader FROM n306_actors WHERE n = 9 \gset
SELECT jsonb_build_object('sub', pg_temp.n306_id(199), 'role', 'authenticated')::TEXT AS n306_no_member \gset
SELECT pg_temp.n306_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n306_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'staff', 'staff'], 'claims: admin, staff and student');


-- One call as another session: sets the claims and the database role for the call only.
CREATE FUNCTION pg_temp.n306_as(p_role TEXT, p_claims TEXT, p_org UUID, p_lead UUID, p_case UUID) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE answer TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, TRUE);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  answer := pg_temp.n306_hint(p_org, p_lead, p_case);
  EXECUTE 'RESET ROLE';
  RETURN answer;
END
$$;

-- ---------------------------------------------------------------------------
-- Another organization, with its own Admin (tenancy).
-- ---------------------------------------------------------------------------
INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n306_id(2), 'N306 Other organization');
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n306_id(110), 'n306-org2@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  VALUES (pg_temp.n306_id(210), pg_temp.n306_id(110), 'N306 Org2 Admin', 'active', 1);
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  VALUES (pg_temp.n306_id(310), pg_temp.n306_id(2), pg_temp.n306_id(210), 'active', 'admin',
    (SELECT id FROM platform.role_bundle_versions WHERE role = 'admin' AND status = 'published' ORDER BY version DESC LIMIT 1));
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n306_id(310);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n306_id(402), pg_temp.n306_id(2), 'organization', pg_temp.n306_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n306_id(2), pg_temp.n306_id(310), pg_temp.n306_id(402), 1, 1, TRUE, 'system',
    'N306 synthetic organization scope', pg_temp.n306_id(610));
SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n306_id(110),
  'claims', jsonb_build_object('sub', pg_temp.n306_id(110), 'role', 'authenticated'))) -> 'claims')::TEXT AS n306_org2_admin \gset

-- ---------------------------------------------------------------------------
-- Cases through the real «Добавить студента» command, as the Admin. Family A
-- (+996 777 302 100): mother of One (curator A), mother of Three (curator B),
-- father of Six (curator C, another department), mother of the waiting case
-- Waiting (no curator). Seven has the number next to it. Family B
-- (+996 700 302 200): father of Two (curator B), father of Ten (curator C),
-- mother of Eleven (curator A), mother of the waiting case Waiting Too; the
-- applicant has that number as its OWN phone (a student who gave a parent's
-- number: the issue's case, created, not merged). Family C (+996 705 302 300):
-- father of Thirteen. Self Parent gave its own number as its mother's.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n306_admin';
SET LOCAL ROLE authenticated;
SELECT r ->> 'student_case_id' AS n306_s1, r ->> 'lead_id' AS n306_s1_lead, r ->> 'client_id' AS n306_s1_client
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7001),
    pg_temp.n306_student('N306 Student One', '+996 555 302 001', 'mother', '+996 777 302 100', 304)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s3
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7002),
    pg_temp.n306_student('N306 Student Three', '+996 555 302 003', 'mother', '+996 777 302 100', 306)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s6
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7003),
    pg_temp.n306_student('N306 Student Six', '+996 555 302 006', 'father', '+996 777 302 100', 307)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s7
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7004),
    pg_temp.n306_student('N306 Student Seven', '+996 555 302 007', 'mother', '+996 777 302 101', 304)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s9
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7005),
    pg_temp.n306_student('N306 Waiting', '+996 555 302 009', 'mother', '+996 777 302 100', NULL)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s2
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7006),
    pg_temp.n306_student('N306 Student Two', '+996 555 302 002', 'father', '+996 700 302 200', 306)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s10
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7007),
    pg_temp.n306_student('N306 Student Ten', '+996 555 302 010', 'father', '+996 700 302 200', 307)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s11
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7008),
    pg_temp.n306_student('N306 Student Eleven', '+996 555 302 011', 'mother', '+996 700 302 200', 304)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s12
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7009),
    pg_temp.n306_student('N306 Waiting Too', '+996 555 302 012', 'mother', '+996 700 302 200', NULL)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s5, r ->> 'lead_id' AS n306_s5_lead, r ->> 'client_id' AS n306_s5_client
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7010),
    pg_temp.n306_student('N306 Applicant', '+996 700 302 200', NULL, NULL, 304)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s13
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7011),
    pg_temp.n306_student('N306 Student Thirteen', '+996 555 302 013', 'father', '+996 705 302 300', 304)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_s4, r ->> 'lead_id' AS n306_s4_lead
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(1), pg_temp.n306_id(7012),
    pg_temp.n306_student('N306 Self Parent', '+996 555 302 004', 'mother', '+996 555 302 004', 304)) AS r) q \gset
RESET ROLE;

-- The other organization has the same family number on its own case, and its
-- own applicant with that number as its own phone.
SET LOCAL request.jwt.claims TO :'n306_org2_admin';
SET LOCAL ROLE authenticated;
SELECT r ->> 'student_case_id' AS n306_o2_y
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(2), pg_temp.n306_id(7101),
    pg_temp.n306_student('N306 Other Org Child', '+996 555 302 301', 'mother', '+996 777 302 100', NULL)) AS r) q \gset
SELECT r ->> 'student_case_id' AS n306_o2_x
  FROM (SELECT platform.create_admissions_student_case_v1(pg_temp.n306_id(2), pg_temp.n306_id(7102),
    pg_temp.n306_student('N306 Other Org Applicant', '+996 777 302 100', NULL, NULL, NULL)) AS r) q \gset
RESET ROLE;

SELECT pg_temp.n306_assert((SELECT count(*) = 12 FROM platform.student_cases WHERE organization_id = pg_temp.n306_id(1)
    AND id IN (:'n306_s1'::UUID, :'n306_s2'::UUID, :'n306_s3'::UUID, :'n306_s4'::UUID, :'n306_s5'::UUID,
      :'n306_s6'::UUID, :'n306_s7'::UUID, :'n306_s9'::UUID, :'n306_s10'::UUID, :'n306_s11'::UUID, :'n306_s12'::UUID,
      :'n306_s13'::UUID)),
  'fixture: the twelve cases of organization 1 exist');
SELECT pg_temp.n306_assert((SELECT bool_and(s.state = 'pending' AND s.current_curator_membership_id IS NULL)
  FROM platform.student_cases s WHERE s.id IN (:'n306_s9'::UUID, :'n306_s12'::UUID)), 'fixture: Waiting and Waiting Too are curator-less pending cases');
-- The parent phone is stored by the real path in one canonical form.
SELECT pg_temp.n306_assert((SELECT array_agg(f.field_key || '=' || f.value ORDER BY f.field_key)
    FROM platform.student_profile_fields f WHERE f.student_case_id = :'n306_s1'::UUID AND f.field_key LIKE '%mobile_phone')
  = ARRAY['mobile_phone=+996555302001', 'mother_mobile_phone=+996777302100'], 'fixture: the real path stores +996…');

-- Spellings other intakes leave (fixtures written as the owner; the portal анкета
-- keeps the digits a student typed, normalize_student_profile_field_value, 160):
-- Three: the mother typed «0777 302 100»; One: the father too, as «996 777 302 100».
UPDATE platform.student_profile_fields
  SET value = platform_private.normalize_student_profile_field_value('mother_mobile_phone', '0777 302 100')
  WHERE student_case_id = :'n306_s3'::UUID AND field_key = 'mother_mobile_phone';
INSERT INTO platform.student_profile_fields(organization_id, student_case_id, student_profile_id, field_key, value,
  review_state, profile_revision)
  SELECT f.organization_id, f.student_case_id, f.student_profile_id, 'father_mobile_phone',
    platform_private.normalize_student_profile_field_value('father_mobile_phone', '996 777 302 100'), f.review_state, f.profile_revision
  FROM platform.student_profile_fields f WHERE f.student_case_id = :'n306_s1'::UUID AND f.field_key = 'mother_mobile_phone';
SELECT pg_temp.n306_assert((SELECT array_agg(f.value ORDER BY f.student_case_id = :'n306_s3'::UUID, f.field_key)
    FROM platform.student_profile_fields f
    WHERE f.student_case_id IN (:'n306_s1'::UUID, :'n306_s3'::UUID) AND f.field_key IN ('father_mobile_phone', 'mother_mobile_phone'))
  = ARRAY['996777302100', '+996777302100', '0777302100'], 'fixture: digits-only spellings as a portal student leaves them');

-- ---------------------------------------------------------------------------
-- Leads: through the real manual command (Sales Manager owns them) and the
-- website receiver (service_role, as the site route calls it).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n306_sales_manager';
SET LOCAL ROLE authenticated;
SELECT platform.create_manual_sales_lead(pg_temp.n306_id(1), pg_temp.n306_id(7201), 'N306 Mother Lead', '0777 302 100', NULL,
  'office', pg_temp.n306_id(302)) ->> 'lead_id' AS n306_l1 \gset
SELECT platform.create_manual_sales_lead(pg_temp.n306_id(1), pg_temp.n306_id(7202), 'N306 Near Miss Lead', '+996 777 302 101', NULL,
  'office', pg_temp.n306_id(302)) ->> 'lead_id' AS n306_l6 \gset
SELECT platform.create_manual_sales_lead(pg_temp.n306_id(1), pg_temp.n306_id(7203), 'N306 Nobody Lead', '0555 302 999', NULL,
  'office', pg_temp.n306_id(302)) ->> 'lead_id' AS n306_l3 \gset
SELECT platform.create_manual_sales_lead(pg_temp.n306_id(1), pg_temp.n306_id(7204), 'N306 Email Lead', NULL, 'n306-email@example.invalid',
  'office', pg_temp.n306_id(302)) ->> 'lead_id' AS n306_l4 \gset
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT platform.receive_website_lead(pg_temp.n306_id(1), pg_temp.n306_id(302), pg_temp.n306_id(7205), 'N306 Father Lead',
  '0705302300', NULL, NULL, 'Malaysia', TRUE, repeat('a', 64)) ->> 'status' AS n306_web \gset
RESET ROLE;
SELECT r.lead_id AS n306_l2 FROM platform_private.website_lead_receipts r WHERE r.request_id = pg_temp.n306_id(7205) \gset
SELECT pg_temp.n306_assert(:'n306_web' = 'accepted' AND :'n306_l2' <> '', 'fixture: the website enquiry is accepted');
-- Nothing merged at intake: the mother's lead has its own client (the issue's point: a parent phone does not match a client).
SELECT pg_temp.n306_assert((SELECT l.client_id NOT IN (:'n306_s1_client'::UUID, :'n306_s5_client'::UUID)
    AND l.source_key = 'office' AND l.lifecycle_state = 'open'
  FROM platform.leads l WHERE l.id = :'n306_l1'::UUID), 'fixture: the mother''s lead is its own open lead on its own client');

CREATE TEMP TABLE n306_before AS SELECT
  (SELECT count(*) FROM platform.clients) AS clients, (SELECT count(*) FROM platform.leads) AS leads,
  (SELECT count(*) FROM platform.student_cases) AS cases, (SELECT count(*) FROM platform.student_profile_fields) AS fields,
  (SELECT count(*) FROM platform.audit_events) AS audit,
  (SELECT count(*) FROM platform_private.client_duplicate_candidates) AS candidates,
  (SELECT md5(string_agg(c.id::TEXT || coalesce(c.normalized_phone, ''), ',' ORDER BY c.id)) FROM platform.clients c) AS client_digest,
  (SELECT md5(string_agg(f.student_case_id::TEXT || f.field_key || coalesce(f.value, ''), ',' ORDER BY f.student_case_id, f.field_key))
    FROM platform.student_profile_fields f) AS field_digest;

-- ---------------------------------------------------------------------------
-- H1/H4. The Admin reads every match of a lead (typed 0777 302 100).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n306_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL) AS n306_admin_l1 \gset
SELECT pg_temp.n306_assert(:'n306_admin_l1'
  = 'mother:N306 Waiting|father:N306 Student Six|mother:N306 Student Three|both:N306 Student One',
  'H1: the lead typed 0777 302 100 finds the +996, digits-only and 996 spellings; relations mother, father, both; waiting case first (newest), then by age: ' || :'n306_admin_l1');
-- A lead on the neighbouring number finds only its own family; the website lead the father number of family C.
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l6'::UUID, NULL) = 'mother:N306 Student Seven',
  'H1: a number one digit away matches only its own case');
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l2'::UUID, NULL) = 'father:N306 Student Thirteen',
  'H1: a website lead typed 0705302300 finds the father number stored as +996705302300');
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l3'::UUID, NULL) = '',
  'H1: an unrelated number has no hint');
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l4'::UUID, NULL) = '',
  'H1: a lead without a phone has no hint');
-- The case page of the applicant who gave the mother's number as its own phone.
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID)
  = 'mother:N306 Waiting Too|mother:N306 Student Eleven|father:N306 Student Ten|father:N306 Student Two',
  'H1: a case whose own phone is a parent number of family B lists the four cases of that family');
-- A case with a normal phone has no hint; the answer carries ids, names and a relation only.
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s1'::UUID) = '',
  'H1: a case whose phone is nobody''s parent phone has no hint');
SELECT pg_temp.n306_assert((SELECT bool_and(ARRAY(SELECT jsonb_object_keys(e) ORDER BY 1) = ARRAY['relation', 'studentCaseId', 'studentName'])
    FROM jsonb_array_elements(pg_temp.n306_raw(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL)) e)
  AND jsonb_array_length(pg_temp.n306_raw(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL)) = 4
  AND pg_temp.n306_raw(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL)::TEXT !~ '(777|700|555)[ ]?302[ ]?[0-9]{3}',
  'H1/H6: three keys per element and no phone number in the answer');
-- H3: the same person is no lookalike.
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s4'::UUID) = ''
  AND pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_s4_lead'::UUID, NULL) = '',
  'H3: a parent phone equal to the student''s own number, from its case and from its own lead, returns nothing');
RESET ROLE;

-- Sales Manager: reads the lead (it owns it), reads no case in full: nothing, and no error.
SET LOCAL request.jwt.claims TO :'n306_sales_manager';
SELECT pg_temp.n306_assert(private.platform_can_read_canonical_lead(pg_temp.n306_id(1), :'n306_l1'::UUID)
    AND NOT private.platform_can_read_student_case(pg_temp.n306_id(1), :'n306_s1'::UUID)
    AND NOT platform_private.staff_can_access_for_actor(pg_temp.n306_id(1), 'profile.read.full', 'student_case', :'n306_s1'::UUID),
  'fixture: Sales reads its lead, not the case and not its анкета');
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL) = '',
  'H4: the Sales Manager gets an empty answer for its own lead (no case or анкета right)');
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID) LIKE 'ERR 42501:%',
  'H4: the Sales Manager cannot ask about a case');
RESET ROLE;

-- The profile reader holds lead.read and profile.read.full in the whole organization but no case.read.full:
-- it reads the lead and the анкеты, not the cases, so it is shown no match (the case gate is its own, not only the анкета gate).
SET LOCAL request.jwt.claims TO :'n306_profile_reader';
SELECT pg_temp.n306_assert(private.platform_can_read_canonical_lead(pg_temp.n306_id(1), :'n306_l1'::UUID)
    AND NOT private.platform_can_read_student_case(pg_temp.n306_id(1), :'n306_s1'::UUID)
    AND platform_private.staff_can_access_for_actor(pg_temp.n306_id(1), 'profile.read.full', 'student_case', :'n306_s1'::UUID),
  'fixture: the profile reader reads the lead and the анкета of One, not the case');
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l1'::UUID, NULL) = ''
  AND pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID) = 'ERR 42501:parent_phone_lookalikes_forbidden',
  'H4: a member who reads the lead and the анкеты but not the cases gets no match, and cannot ask about a case');
RESET ROLE;

-- Members who cannot read the lead (the lead is owned by the Sales department).
SELECT pg_temp.n306_assert((SELECT bool_and(pg_temp.n306_as('authenticated', v.claims, pg_temp.n306_id(1), :'n306_l1'::UUID, NULL)
      = 'ERR 42501:parent_phone_lookalikes_forbidden')
  FROM (VALUES (:'n306_manager'), (:'n306_a'), (:'n306_b'), (:'n306_c'), (:'n306_own_manager'), (:'n306_student'), (:'n306_no_member')) v(claims)),
  'H4: an Admissions Manager, curators A, B, C, an own-scoped manager, the Student and a session without a membership cannot read the sales lead: 42501');

-- Case subject S5 (curator A, department Admissions): who reads it, and what each reads of the matches.
SET LOCAL request.jwt.claims TO :'n306_manager';
SELECT pg_temp.n306_assert(private.platform_can_read_student_case(pg_temp.n306_id(1), :'n306_s12'::UUID)
    AND NOT platform_private.staff_can_access_for_actor(pg_temp.n306_id(1), 'profile.read.full', 'student_case', :'n306_s12'::UUID),
  'fixture: the Manager reads the waiting case (281) but not its анкета');
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID)
  = 'mother:N306 Student Eleven|father:N306 Student Two',
  'H4: the Manager of the department sees Eleven and Two, not Ten (department 2) and not the waiting case (анкета unreadable): ' ||
    pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID));
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n306_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID) = 'mother:N306 Student Eleven',
  'H4: curator A sees only its own case Eleven among the matches: ' || pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID));
RESET ROLE;
SELECT pg_temp.n306_assert((SELECT bool_and(pg_temp.n306_as('authenticated', v.claims, pg_temp.n306_id(1), NULL, :'n306_s5'::UUID)
      = 'ERR 42501:parent_phone_lookalikes_forbidden')
  FROM (VALUES (:'n306_b'), (:'n306_c'), (:'n306_own_manager'), (:'n306_sales_manager'), (:'n306_student'), (:'n306_no_member')) v(claims)),
  'H4: curators B and C, the own-scoped manager, Sales, the Student and a session without a membership cannot read the case: 42501');

-- Unknown ids, anon, service_role and the other organization.
SET LOCAL request.jwt.claims TO :'n306_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), pg_temp.n306_id(9999), NULL) = 'ERR 42501:parent_phone_lookalikes_forbidden'
  AND pg_temp.n306_hint(pg_temp.n306_id(1), NULL, pg_temp.n306_id(9999)) = 'ERR 42501:parent_phone_lookalikes_forbidden',
  'H4: an unknown lead or case answers like an unreadable one');
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(2), :'n306_l1'::UUID, NULL) = 'ERR 42501:parent_phone_lookalikes_forbidden'
  AND pg_temp.n306_hint(pg_temp.n306_id(2), NULL, :'n306_o2_x'::UUID) = 'ERR 42501:parent_phone_lookalikes_forbidden',
  'H4/H5: an Admin of organization 1 has no actor in organization 2');
RESET ROLE;
SELECT pg_temp.n306_assert(pg_temp.n306_as('anon', '{}', pg_temp.n306_id(1), :'n306_l1'::UUID, NULL) LIKE 'ERR 42501:%'
  AND pg_temp.n306_as('service_role', '{"role":"service_role"}', pg_temp.n306_id(1), :'n306_l1'::UUID, NULL) LIKE 'ERR 42501:%',
  'H4: anon and service_role cannot execute');

-- H5: the other organization's Admin sees its own matches only, and never organization 1's.
SET LOCAL request.jwt.claims TO :'n306_org2_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(2), NULL, :'n306_o2_x'::UUID) = 'mother:N306 Other Org Child',
  'H5: organization 2 lists its own child only, not the four of organization 1: ' ||
    pg_temp.n306_hint(pg_temp.n306_id(2), NULL, :'n306_o2_x'::UUID));
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, :'n306_s5'::UUID) = 'ERR 42501:parent_phone_lookalikes_forbidden'
  AND pg_temp.n306_hint(pg_temp.n306_id(2), NULL, :'n306_s5'::UUID) = 'ERR 42501:parent_phone_lookalikes_forbidden',
  'H5: the Admin of organization 2 cannot read organization 1''s case under either organization id');
RESET ROLE;
-- And organization 1's answer for the family number never names organization 2's child (checked for L1 above: four names).
SELECT pg_temp.n306_assert(:'n306_admin_l1' NOT LIKE '%Other Org%', 'H5: organization 1''s answer has no organization 2 name');

-- H6: exactly one subject; constant messages.
SET LOCAL request.jwt.claims TO :'n306_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n306_assert(pg_temp.n306_hint(pg_temp.n306_id(1), NULL, NULL) = 'ERR 22023:parent_phone_lookalikes_invalid'
  AND pg_temp.n306_hint(pg_temp.n306_id(1), :'n306_l1'::UUID, :'n306_s1'::UUID) = 'ERR 22023:parent_phone_lookalikes_invalid'
  AND pg_temp.n306_hint(NULL, :'n306_l1'::UUID, NULL) = 'ERR 22023:parent_phone_lookalikes_invalid',
  'H6: no subject, two subjects and no organization are invalid');
RESET ROLE;

-- H2: nothing was written by any call above (counts and digests of the tables a merge would touch).
SELECT pg_temp.n306_assert((SELECT b.clients = (SELECT count(*) FROM platform.clients)
    AND b.leads = (SELECT count(*) FROM platform.leads) AND b.cases = (SELECT count(*) FROM platform.student_cases)
    AND b.fields = (SELECT count(*) FROM platform.student_profile_fields) AND b.audit = (SELECT count(*) FROM platform.audit_events)
    AND b.candidates = (SELECT count(*) FROM platform_private.client_duplicate_candidates)
    AND b.client_digest = (SELECT md5(string_agg(c.id::TEXT || coalesce(c.normalized_phone, ''), ',' ORDER BY c.id)) FROM platform.clients c)
    AND b.field_digest = (SELECT md5(string_agg(f.student_case_id::TEXT || f.field_key || coalesce(f.value, ''), ',' ORDER BY f.student_case_id, f.field_key))
      FROM platform.student_profile_fields f)
  FROM n306_before b),
  'H2: the calls changed no client, lead, case, анкета value, candidate or journal row');
SELECT pg_temp.n306_assert((SELECT l.client_id <> (SELECT c.canonical_client_id FROM platform.student_cases c WHERE c.id = :'n306_s1'::UUID)
    AND l.lifecycle_state = 'open' FROM platform.leads l WHERE l.id = :'n306_l1'::UUID)
  AND (SELECT count(*) = 1 FROM platform.clients WHERE organization_id = pg_temp.n306_id(1) AND normalized_phone = '0777302100')
  AND (SELECT count(*) = 1 FROM platform.clients WHERE organization_id = pg_temp.n306_id(1) AND normalized_phone = '+996700302200'),
  'H2: the mother''s lead keeps its own client (family A is on no client), the applicant is the one client on family B''s number');

-- H6: the contract of the routine.
SELECT pg_temp.n306_assert((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""']
    AND p.prosrc !~* 'RAISE\s+(NOTICE|LOG|WARNING|INFO|DEBUG)' AND p.prosrc !~* 'INSERT\s+INTO|UPDATE\s+platform|DELETE\s+FROM'
  FROM pg_catalog.pg_proc p WHERE p.oid = 'platform.read_parent_phone_lookalikes_v1(uuid,uuid,uuid)'::REGPROCEDURE),
  'H6: SECURITY DEFINER, STABLE, empty search_path, no log statements and no writes in the body');
SELECT pg_temp.n306_assert((SELECT bool_and(has_function_privilege(r, 'platform.read_parent_phone_lookalikes_v1(uuid,uuid,uuid)', 'EXECUTE') = (r = 'authenticated'))
  FROM unnest(ARRAY['authenticated', 'anon', 'service_role', 'supabase_auth_admin', 'evo_ai_agent', 'public']) r),
  'H6: EXECUTE for authenticated only');
SELECT pg_temp.n306_assert((SELECT count(*) = 1 FROM pg_catalog.pg_proc p
    WHERE p.pronamespace = 'platform'::REGNAMESPACE AND p.proname = 'read_parent_phone_lookalikes_v1'),
  'H6: one signature');

SELECT 'N306_PARENT_PHONE_LOOKALIKES_SUITE_PASSED' AS n306_suite_marker;
ROLLBACK;
