\set ON_ERROR_STOP on
-- Boundary suite for migration 281 («Добавить студента» без отдела продаж и
-- импорт клиентов). Members are modelled like production after 155 (as in
-- 244's suite): invited staff have coarse role NULL and get permissions only
-- from scoped role assignments with the production keys — Admissions (35 keys,
-- own scope), Admissions Manager (36 keys, department scope), Sales Manager (23
-- keys, department scope), «общие разделы» (organization scope). The roles are
-- created without case.create.direct and the migration's own publication
-- function adds it, exactly as it did on the live roles.
-- Proves: who may create (a curator only for itself, the manager for a curator
-- of its department or without a curator, the Admin for anyone; Sales, the
-- Student, no membership and anon refused; a refused curator named as such),
-- idempotency, stage, profile and money correctness, «Ждут куратора» and the
-- assignment of a curator-less case (the e1 activation fix), the service-only
-- import (refused to authenticated and anon, idempotent by external
-- reference), and that nothing of sales (register, handoffs, open leads,
-- marketing cohort) is touched.
-- Review fix round 1 (PR #1194), each failing before its fix:
--  R1 one person, one card: an open sales lead with the same phone or e-mail
--     refuses the command (PT409 admissions_direct_lead_exists, the lead id in
--     DETAIL) and the import reports the row (lead_exists / case_exists) and
--     creates nothing; client and lead carry external identifiers and subject
--     provenance (staff_recorded / imported); an e-mail twin becomes a
--     duplicate candidate; an exact e-mail+phone match reuses the client;
--  R2 анкета values equal their normalize_student_profile_field_value form, no
--     desired_start_date row;
--  R3 a curator-less case authored by the Admin or the import is read and
--     assigned by the Admissions Manager of the department (not by curators,
--     Sales or an own-scoped holder of the same keys);
--  R5 admissions_direct_curator_options_v1 lists only the curators the actor
--     may name; a refused curator is admissions_direct_curator_forbidden;
--  R6 a payment dated tomorrow is refused, one dated today is accepted;
--  R7 (documented, docs/runbooks/admissions-direct-import.md) the import's
--     case.curator.set row is written by the shared e1 as auth:<Admin>, tied
--     to the import request by its v5 request id.
-- Delta review round 1 (PR #1194), each failing before its fix:
--  D1 one phone form: with an open sales lead on +996…, the spellings 996…,
--     0…, «+996 0…» and 00996… are refused (lead_exists) and the import
--     reports them; a sales lead stored as 0… is found from +996…; a case is
--     found under another spelling; an ambiguous number without «+» is
--     refused; client, анкета and parent phone are stored as +996…; a client
--     with the same number in another spelling is a phone duplicate candidate;
--  D4 a contract signed tomorrow is refused, one signed today is accepted, a
--     payment before the signing day (an advance) is accepted.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.n281_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('28100000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n281_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N281: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n281_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- One create call as the current role; payload as a literal.
-- DETAIL of a failing statement, or NULL.
CREATE FUNCTION pg_temp.n281_error_detail(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE detail TEXT;
BEGIN
  EXECUTE sql; RETURN NULL;
EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS detail = PG_EXCEPTION_DETAIL; RETURN detail;
END
$$;
CREATE FUNCTION pg_temp.n281_create(p_request INTEGER, p_payload JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n281_error(format('SELECT platform.create_admissions_student_case_v1(%L, %L, %L::JSONB)',
    pg_temp.n281_id(1), pg_temp.n281_id(p_request), p_payload::TEXT))
$$;
CREATE FUNCTION pg_temp.n281_import(p_actor INTEGER, p_ref TEXT, p_payload JSONB) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n281_error(format('SELECT platform.import_admissions_student_case_v1(%L, %L, %L, %L, %L::JSONB, %L)',
    pg_temp.n281_id(1), pg_temp.n281_id(p_actor), 'n281-amocrm-test', p_ref, p_payload::TEXT,
    'Импорт клиентов из amoCRM по поручению владельца'))
$$;
-- A minimal valid payload for a named student with a curator (or none).
CREATE FUNCTION pg_temp.n281_payload(p_name TEXT, p_curator INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'student', jsonb_build_object('name', p_name),
    'route', jsonb_build_object('country', 'MY'),
    'curatorMembershipId', CASE WHEN p_curator IS NULL THEN NULL ELSE pg_temp.n281_id(p_curator)::TEXT END))
$$;
-- The import's request id (as import_admissions_student_case_v1 derives it).
CREATE FUNCTION pg_temp.n281_import_request(p_ref TEXT) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT public.uuid_generate_v5('6ba7b811-9dad-11d1-80b4-00c04fd430c8'::UUID,
    'evo:admissions-direct-import:' || pg_temp.n281_id(1)::TEXT || ':n281-amocrm-test:' || p_ref)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n281_id(INTEGER), pg_temp.n281_assert(BOOLEAN, TEXT), pg_temp.n281_error(TEXT),
  pg_temp.n281_error_detail(TEXT), pg_temp.n281_create(INTEGER, JSONB), pg_temp.n281_import(INTEGER, TEXT, JSONB),
  pg_temp.n281_payload(TEXT, INTEGER), pg_temp.n281_import_request(TEXT)
  TO authenticated, anon, service_role;

SELECT 'N281_ADMISSIONS_DIRECT_STUDENT_SUITE_START' AS n281_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager (sales department), 3 Admissions Manager, 4 Admissions A and
-- 6 Admissions B (admissions department), 7 Admissions C (a second admissions
-- department), 8 the Admissions Manager keys in an «own» scope (admissions
-- department); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n281_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n281_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, NULL);
GRANT SELECT ON n281_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n281_id(1), 'N281 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n281_id(100 + n), 'n281-' || n || '@example.invalid', '{}'::JSONB FROM n281_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n281_id(199), 'n281-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n281_id(200 + n), pg_temp.n281_id(100 + n), 'N281 Actor ' || n, 'active', 1 FROM n281_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n281_id(300 + n), pg_temp.n281_id(1), pg_temp.n281_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n281_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n281_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n281_id(401), pg_temp.n281_id(1), 'organization', pg_temp.n281_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n281_id(1), pg_temp.n281_id(301), pg_temp.n281_id(401), 1, 1, TRUE, 'system',
    'N281 synthetic organization scope', pg_temp.n281_id(601)),
  (pg_temp.n281_id(1), pg_temp.n281_id(305), pg_temp.n281_id(401), 1, 1, TRUE, 'system',
    'N281 synthetic Student organization scope', pg_temp.n281_id(605));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n281_id(901), pg_temp.n281_id(1), 'N281 Sales'),
  (pg_temp.n281_id(902), pg_temp.n281_id(1), 'N281 Admissions'),
  (pg_temp.n281_id(903), pg_temp.n281_id(1), 'N281 Admissions 2');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n281_id(1), pg_temp.n281_id(302), pg_temp.n281_id(901)),
  (pg_temp.n281_id(1), pg_temp.n281_id(303), pg_temp.n281_id(902)),
  (pg_temp.n281_id(1), pg_temp.n281_id(304), pg_temp.n281_id(902)),
  (pg_temp.n281_id(1), pg_temp.n281_id(306), pg_temp.n281_id(902)),
  (pg_temp.n281_id(1), pg_temp.n281_id(307), pg_temp.n281_id(903)),
  (pg_temp.n281_id(1), pg_temp.n281_id(308), pg_temp.n281_id(902));

-- Roles with the EXACT production permission keys (as 244's suite), without
-- case.create.direct: the migration's publication adds it.
CREATE TEMP TABLE n281_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n281_roles VALUES
 (pg_temp.n281_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n281_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n281_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n281_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n281_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n281_grants VALUES
 (302, pg_temp.n281_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n281_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n281_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n281_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n281_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n281_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n281_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (307, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL)),
 (308, pg_temp.n281_id(1102), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (308, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n281_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n281_id(1);
GRANT SELECT ON n281_roles, n281_grants, n281_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n281_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n281_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n281_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n281_admin_setup';
SET LOCAL ROLE authenticated;
DO $n281_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n281_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n281_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N281 ' || r.label, 'description', 'Migration 281 synthetic role',
        'permissionKeys', r.keys), 'N281 create role', pg_temp.n281_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n281_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n281_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N281 publish role', pg_temp.n281_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n281_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n281_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n281_id(1), pg_temp.n281_id(m),
      (SELECT access_version FROM n281_versions WHERE membership_id = pg_temp.n281_id(m)), items, bindings,
      'N281 grant roles', pg_temp.n281_id(2000 + m));
  END LOOP;
END
$n281_roles$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0. The migration's publication: the two roles that may curate get the key,
-- Sales and «общие разделы» do not; a second run changes nothing.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n281_assert(NOT platform_private.staff_has_permission(pg_temp.n281_id(1), pg_temp.n281_id(304), 'case.create.direct'),
  'fixture: before the publication Admissions A lacks case.create.direct');
SELECT platform_private.admissions_direct_grant_curator_roles('N281 publication') AS n281_grant_first \gset
SELECT pg_temp.n281_assert((SELECT array_agg((r ->> 'roleId')::UUID ORDER BY (r ->> 'roleId'))
    FROM jsonb_array_elements(:'n281_grant_first'::JSONB -> 'roles') r
    WHERE (r ->> 'organizationId')::UUID = pg_temp.n281_id(1))
  = ARRAY[pg_temp.n281_id(1101), pg_temp.n281_id(1102)], 'only Admissions and Admissions Manager are published');
SELECT pg_temp.n281_assert(jsonb_array_length(:'n281_grant_first'::JSONB -> 'skipped') = 0, 'no role skipped');
SELECT pg_temp.n281_assert(jsonb_array_length(platform_private.admissions_direct_grant_curator_roles('N281 again') -> 'roles') = 0,
  'a second publication changes nothing');
SELECT pg_temp.n281_assert((SELECT array_agg(n ORDER BY n) FROM unnest(ARRAY[301, 302, 303, 304, 306, 307, 308]) n
    WHERE platform_private.staff_has_permission(pg_temp.n281_id(1), pg_temp.n281_id(n), 'case.create.direct'))
  = ARRAY[301, 303, 304, 306, 307, 308], 'Admin, the two managers and the three curators hold case.create.direct; Sales does not');
SELECT pg_temp.n281_assert((SELECT bool_and(a.bundle_id = r.current_bundle_id) FROM platform.staff_role_assignments a
    JOIN platform.staff_role_definitions r ON r.id = a.role_id
    WHERE a.organization_id = pg_temp.n281_id(1) AND a.revoked_at IS NULL),
  'every active assignment moved to its role''s current bundle');
SELECT pg_temp.n281_assert((SELECT count(*) = 2 FROM platform.audit_events
    WHERE organization_id = pg_temp.n281_id(1) AND action = 'staff.roles.migrated' AND actor_principal = 'migration:281'),
  'each publication is journaled once');

-- Claims from live rows after the publication bumped access versions.
UPDATE n281_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n281_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n281_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n281_admin FROM n281_actors WHERE n = 1 \gset
SELECT claims AS n281_sales_manager FROM n281_actors WHERE n = 2 \gset
SELECT claims AS n281_manager FROM n281_actors WHERE n = 3 \gset
SELECT claims AS n281_a FROM n281_actors WHERE n = 4 \gset
SELECT claims AS n281_student FROM n281_actors WHERE n = 5 \gset
SELECT claims AS n281_b FROM n281_actors WHERE n = 6 \gset
SELECT claims AS n281_c FROM n281_actors WHERE n = 7 \gset
SELECT claims AS n281_own_manager FROM n281_actors WHERE n = 8 \gset
SELECT jsonb_build_object('sub', pg_temp.n281_id(199), 'role', 'authenticated')::TEXT AS n281_no_member \gset
SELECT pg_temp.n281_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n281_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'staff'], 'claims: admin, staff and student');

-- R1 fixtures, through the canonical identity path as every intake: an open
-- sales lead; a client known only by an e-mail and phone (no lead, no case);
-- a client for an exact e-mail+phone match.
SELECT platform_private.create_or_link_client(pg_temp.n281_id(1), 'N281 Sales Person', 'n281-sales@example.invalid',
  '+996 555 281 999', 'n281-fixture', 'client', 'sales-1', 'staff_recorded', statement_timestamp()) AS n281_sales_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.n281_id(1), :'n281_sales_client'::UUID, NULL, 'new', 'office',
  'n281-fixture', 'lead', 'sales-1', 'staff_recorded', statement_timestamp()) AS n281_sales_lead \gset
SELECT platform_private.create_or_link_client(pg_temp.n281_id(1), 'N281 Old Email', 'n281-old@example.invalid',
  '+996 555 281 777', 'n281-fixture', 'client', 'old-1', 'staff_recorded', statement_timestamp()) AS n281_old_client \gset
SELECT platform_private.create_or_link_client(pg_temp.n281_id(1), 'N281 Old Pair', 'n281-pair@example.invalid',
  '+996 555 281 888', 'n281-fixture', 'client', 'old-2', 'staff_recorded', statement_timestamp()) AS n281_pair_client \gset
SELECT pg_temp.n281_assert((SELECT l.lifecycle_state = 'open' FROM platform.leads l WHERE l.id = :'n281_sales_lead'::UUID),
  'fixture: the sales lead is open');
-- D1 fixtures: a manual sales lead typed in the national spelling (stored as
-- 143 stores it, normalize_person_phone: «0555281666»), and a client known
-- only under a national-spelling number (no lead, no case).
SELECT platform_private.create_or_link_client(pg_temp.n281_id(1), 'N281 Local Sales', NULL,
  '0555 281 666', 'n281-fixture', 'client', 'sales-2', 'staff_recorded', statement_timestamp()) AS n281_local_sales_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.n281_id(1), :'n281_local_sales_client'::UUID, NULL, 'new', 'office',
  'n281-fixture', 'lead', 'sales-2', 'staff_recorded', statement_timestamp()) AS n281_local_sales_lead \gset
SELECT platform_private.create_or_link_client(pg_temp.n281_id(1), 'N281 Old Local', NULL,
  '0555 281 444', 'n281-fixture', 'client', 'old-3', 'staff_recorded', statement_timestamp()) AS n281_old_local_client \gset
SELECT pg_temp.n281_assert((SELECT array_agg(c.normalized_phone ORDER BY c.display_name) FROM platform.clients c
    WHERE c.id IN (:'n281_local_sales_client'::UUID, :'n281_old_local_client'::UUID))
  = ARRAY['0555281666', '0555281444'], 'fixture: the national spelling is what other intakes store');

CREATE TEMP TABLE n281_before AS SELECT
  (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.n281_id(1)) AS register_rows,
  (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n281_id(1)) AS handoffs,
  (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n281_id(1) AND lifecycle_state = 'open') AS open_leads;

-- ---------------------------------------------------------------------------
-- 1. A curator creates a student for itself, with profile and money.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n281_payloads(k TEXT PRIMARY KEY, payload JSONB);
INSERT INTO n281_payloads VALUES ('a_full', jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 Student One', 'firstName', 'N281', 'lastName', 'One',
    'phone', '+996 555 281 001', 'email', 'N281-One@Example.INVALID', 'birthDate', '2008-05-01'),
  'parent', jsonb_build_object('relation', 'mother', 'firstName', 'N281 Mother', 'phone', '+996 555 281 101'),
  'route', jsonb_build_object('country', 'CN', 'degree', 'Бакалавриат', 'program', 'Computer Science', 'intake', 'Сентябрь 2027'),
  'education', jsonb_build_object('current', '11 класс', 'english', 'IELTS 6.0', 'chinese', 'HSK 3'),
  'curatorMembershipId', pg_temp.n281_id(304)::TEXT,
  'pipelineStage', 'documents',
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 150000, 'currency', 'USD'), 'signedOn', '2026-09-01',
    'payments', jsonb_build_array(
      jsonb_build_object('amountMinor', 50000, 'currency', 'USD', 'paidOn', '2026-09-05'),
      jsonb_build_object('amountMinor', '2000000', 'currency', 'KGS', 'paidOn', '2026-09-10'))),
  'note', 'N281 synthetic note'));
GRANT SELECT ON n281_payloads TO authenticated, anon, service_role;

SET LOCAL request.jwt.claims TO :'n281_a';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5001),
  (SELECT payload FROM n281_payloads WHERE k = 'a_full')) AS n281_a_receipt \gset
SELECT pg_temp.n281_assert(:'n281_a_receipt'::JSONB ->> 'state' = 'active'
  AND :'n281_a_receipt'::JSONB ->> 'curator_membership_id' = pg_temp.n281_id(304)::TEXT
  AND :'n281_a_receipt'::JSONB ->> 'pipeline_stage' = 'documents'
  AND NOT (:'n281_a_receipt'::JSONB ->> 'replayed')::BOOLEAN
  AND NOT (:'n281_a_receipt'::JSONB ->> 'client_reused')::BOOLEAN, 'Admissions A creates an active case for itself');
SELECT pg_temp.n281_assert(private.platform_can_read_student_case(pg_temp.n281_id(1), (:'n281_a_receipt'::JSONB ->> 'student_case_id')::UUID),
  'Admissions A reads the new case');
SELECT pg_temp.n281_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_admissions_pipeline_board_v1() -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n281_a_receipt'::JSONB ->> 'student_case_id' AND r ->> 'pipeline_stage' = 'documents'),
  'the case is on the board in its column');
SELECT platform.staff_case_agreement_v1((:'n281_a_receipt'::JSONB ->> 'student_case_id')::UUID) AS n281_a_agreement \gset
SELECT pg_temp.n281_assert(:'n281_a_agreement'::JSONB ->> 'cost_minor' = '150000'
  AND :'n281_a_agreement'::JSONB ->> 'cost_currency' = 'USD'
  AND jsonb_array_length(:'n281_a_agreement'::JSONB -> 'tranches') = 2
  AND jsonb_array_length(:'n281_a_agreement'::JSONB -> 'payments') = 2
  AND (:'n281_a_agreement'::JSONB ->> 'currency_mismatch')::BOOLEAN,
  '«Договор и оплата» shows the cost, two tranches, two payments and the honest currency mismatch');
RESET ROLE;

SELECT (:'n281_a_receipt'::JSONB ->> 'student_case_id') AS n281_case_a, (:'n281_a_receipt'::JSONB ->> 'lead_id') AS n281_lead_a,
  (:'n281_a_receipt'::JSONB ->> 'client_id') AS n281_client_a \gset
SELECT pg_temp.n281_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n281_id(304)
    AND c.responsible_sales_membership_id IS NULL AND c.source_key = 'admissions-direct:' || :'n281_lead_a'
    AND c.canonical_lead_id = :'n281_lead_a'::UUID AND c.canonical_client_id = :'n281_client_a'::UUID
    AND c.public_application_id IS NULL AND c.student_membership_id IS NULL AND c.portal_activated_at IS NULL
    AND c.handoff_at IS NOT NULL AND c.target_country = 'CN' AND c.admissions_direction = 'CN'
    AND c.target_degree = 'Бакалавриат' AND c.program_direction = 'Computer Science' AND c.intake = 'Сентябрь 2027'
    AND c.language_assumption = 'IELTS 6.0; HSK 3' AND c.operational_stage = 'intake' AND c.pipeline_stage = 'documents'
    AND c.admissions_playbook_version_id IS NULL AND c.current_scope_version = 2
  FROM platform.student_cases c WHERE c.id = :'n281_case_a'::UUID), 'the case row has the direct origin, route and stage');
SELECT pg_temp.n281_assert((SELECT l.source_key = 'admissions_direct' AND l.lifecycle_state = 'converted'
    AND l.current_owner_membership_id IS NULL AND l.interest_direction = 'CN' AND l.client_id = :'n281_client_a'::UUID
  FROM platform.leads l WHERE l.id = :'n281_lead_a'::UUID), 'the lead is a converted admissions_direct lead without a sales owner');
SELECT pg_temp.n281_assert((SELECT cl.display_name = 'N281 Student One' AND cl.normalized_phone = '+996555281001'
    AND cl.normalized_email = 'n281-one@example.invalid' FROM platform.clients cl WHERE cl.id = :'n281_client_a'::UUID),
  'the client carries the contacts');
SELECT pg_temp.n281_assert((SELECT p.date_of_birth = DATE '2008-05-01' AND p.consent_status = 'not_recorded'
    AND p.current_education_summary = '11 класс' AND p.language_summary = 'IELTS 6.0; HSK 3'
  FROM platform.student_profiles p WHERE p.student_case_id = :'n281_case_a'::UUID), 'the profile carries the canonical facts');
-- R2: canonical анкета values, no intake text in the date field.
SELECT pg_temp.n281_assert((SELECT array_agg(f.field_key || '=' || COALESCE(f.value, '∅') ORDER BY f.field_key)
  FROM platform.student_profile_fields f WHERE f.student_case_id = :'n281_case_a'::UUID AND f.review_state = 'needs_review')
  = ARRAY['chinese_level_hsk=HSK 3', 'current_study_status=11 класс', 'date_of_birth=∅',
    'english_level=IELTS 6.0', 'field_major=Computer Science', 'mobile_phone=+996555281001',
    'mother_first_name=N281 Mother', 'mother_mobile_phone=+996555281101', 'program_level=Бакалавриат',
    'student_email=n281-one@example.invalid', 'student_first_name=N281', 'student_last_name=One'],
  'R2: the анкета fields are written for review in their canonical form, without desired_start_date');
SELECT pg_temp.n281_assert((SELECT bool_and(f.value IS NULL
    OR f.value = platform_private.normalize_student_profile_field_value(f.field_key, f.value))
  FROM platform.student_profile_fields f WHERE f.organization_id = pg_temp.n281_id(1)),
  'R2: every анкета value equals its normalized form');
-- R1: the canonical identity path with provenance.
SELECT pg_temp.n281_assert((SELECT count(*) = 2 FROM platform.external_identifiers e
    WHERE e.organization_id = pg_temp.n281_id(1) AND e.source_system = 'evo_admissions'
      AND e.external_identifier = pg_temp.n281_id(5001)::TEXT
      AND ((e.external_object_type = 'client' AND e.client_id = :'n281_client_a'::UUID)
        OR (e.external_object_type = 'lead' AND e.lead_id = :'n281_lead_a'::UUID))),
  'R1: client and lead carry their evo_admissions external identifiers');
SELECT pg_temp.n281_assert((SELECT count(*) = 2 AND bool_and(p.evidence_type = 'staff_recorded' AND p.imported_at IS NULL)
  FROM platform.subject_provenance p WHERE p.organization_id = pg_temp.n281_id(1) AND p.source_system = 'evo_admissions'
    AND (p.client_id = :'n281_client_a'::UUID OR p.lead_id = :'n281_lead_a'::UUID)),
  'R1: client and lead carry staff_recorded provenance');
SELECT pg_temp.n281_assert((SELECT s.fields ->> 'service_cost_minor' = '150000' AND s.fields ->> 'service_cost_currency' = 'USD'
    AND s.fields ->> 'signing_date' = '2026-09-01' AND s.updated_by_membership_id = pg_temp.n281_id(304)
  FROM platform_private.lead_sale_conditions s WHERE s.lead_id = :'n281_lead_a'::UUID), 'the contract cost and date sit on the lead');
SELECT pg_temp.n281_assert((SELECT array_agg(o.label || ':' || o.amount_minor || ' ' || o.currency || ' paid ' || o.total_paid_minor
    ORDER BY o.label = 'Оплата по договору' DESC, o.currency)
  FROM platform.payment_obligations o WHERE o.student_case_id = :'n281_case_a'::UUID)
  = ARRAY['Оплата по договору:150000 USD paid 50000', 'Получено в KGS:2000000 KGS paid 2000000'],
  'one tranche for the cost, one paid tranche for the other currency');
SELECT pg_temp.n281_assert((SELECT count(*) = 2 AND bool_and(e.source_key = 'admissions_direct' AND e.event_type = 'payment')
  FROM platform.payment_events e WHERE e.student_case_id = :'n281_case_a'::UUID), 'two payment events');
SELECT pg_temp.n281_assert((SELECT count(*) = 2 FROM platform.payment_evidence v WHERE v.student_case_id = :'n281_case_a'::UUID),
  'each payment has its evidence');
SELECT pg_temp.n281_assert((SELECT array_agg(n.body) FROM platform.case_notes n WHERE n.student_case_id = :'n281_case_a'::UUID)
  = ARRAY['N281 synthetic note'], 'the note is the first case note (no age line with a birth date)');
SELECT pg_temp.n281_assert((SELECT array_agg(a.action ORDER BY a.action) FROM platform.audit_events a
    WHERE a.organization_id = pg_temp.n281_id(1) AND a.actor_profile_id = pg_temp.n281_id(204))
  = ARRAY['case.create', 'case.curator.set', 'case.tranche.save', 'case.tranche.save', 'finance.payment.record', 'finance.payment.record'],
  'the creation is journaled: case, curator, two tranches, two payments');
SELECT pg_temp.n281_assert((SELECT a.actor_principal = 'auth:' || pg_temp.n281_id(104)::TEXT
    AND a.resource_id = :'n281_case_a'::UUID AND a.reason = 'Студент добавлен поступлением без отдела продаж'
    AND a.after_state ->> 'origin' = 'admissions_direct'
  FROM platform.audit_events a WHERE a.request_id = pg_temp.n281_id(5001)), 'case.create carries the actor and the reason');
SELECT pg_temp.n281_assert(NOT ('awaiting_ack' = ANY (platform_private.admissions_attention_flags(:'n281_case_a'::UUID))),
  'a direct case does not wait for an acceptance');

-- A curator creates only for itself.
SET LOCAL request.jwt.claims TO :'n281_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5002, pg_temp.n281_payload('N281 For B', 306)) = '42501:admissions_direct_curator_forbidden',
  'Admissions A cannot create a case for Admissions B (the curator is named as the reason)');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5003, pg_temp.n281_payload('N281 No curator', NULL)) = '42501:admissions_direct_curator_forbidden',
  'Admissions A cannot create a case without a curator');
-- Idempotency: the same request replays, another payload under it is refused.
SELECT pg_temp.n281_assert((platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5001),
    (SELECT payload FROM n281_payloads WHERE k = 'a_full')) - 'replayed') = (:'n281_a_receipt'::JSONB - 'replayed')
  AND (platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5001),
    (SELECT payload FROM n281_payloads WHERE k = 'a_full')) ->> 'replayed')::BOOLEAN,
  'an exact replay returns the same receipt, marked replayed');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5001, pg_temp.n281_payload('N281 Other', 304)) = '22023:admissions_direct_request_conflict',
  'another payload under the same request id is refused');
RESET ROLE;
SELECT pg_temp.n281_assert((SELECT count(*) = 1 FROM platform.student_cases WHERE organization_id = pg_temp.n281_id(1)),
  'the replays created nothing');
SET LOCAL request.jwt.claims TO :'n281_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_a'::UUID),
  'Admissions B does not read the case of Admissions A');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. The Admissions Manager: a curator of its department, or none.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5101),
  pg_temp.n281_payload('N281 Manager For B', 306)) AS n281_m_b \gset
SELECT pg_temp.n281_assert(:'n281_m_b'::JSONB ->> 'state' = 'active'
  AND :'n281_m_b'::JSONB ->> 'curator_membership_id' = pg_temp.n281_id(306)::TEXT
  AND :'n281_m_b'::JSONB ->> 'pipeline_stage' = 'new', 'the manager creates for a curator of its department (stage new by default)');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5102, pg_temp.n281_payload('N281 Manager For C', 307)) = '42501:admissions_direct_curator_forbidden',
  'the manager cannot create for a curator outside its department');
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5103), jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 Waiting', 'age', 17),
  'route', jsonb_build_object('country', 'MY'), 'pipelineStage', 'shortlist',
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 900000, 'currency', 'KGS')),
  'note', 'N281 waits for a curator')) AS n281_m_none \gset
SELECT pg_temp.n281_assert(:'n281_m_none'::JSONB ->> 'state' = 'pending'
  AND :'n281_m_none'::JSONB -> 'curator_membership_id' = 'null'::JSONB, 'the manager creates a case without a curator');
SELECT pg_temp.n281_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_student_case_queue_v1('needs_curator', 100) -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n281_m_none'::JSONB ->> 'student_case_id'),
  'the manager sees it in «Ждут куратора»');
SELECT pg_temp.n281_assert((platform.staff_student_case_queue_counts_v1('needs_curator') -> 'views' ->> 'needs_curator')::INTEGER = 1,
  'the «Ждут куратора» count is 1');
RESET ROLE;
SELECT (:'n281_m_none'::JSONB ->> 'student_case_id') AS n281_case_wait \gset
SELECT pg_temp.n281_assert(platform_private.admissions_attention_flags(:'n281_case_wait'::UUID) = ARRAY['needs_curator'],
  'the pending direct case carries needs_curator');
SELECT pg_temp.n281_assert((SELECT c.state = 'pending' AND c.current_curator_membership_id IS NULL AND c.handoff_at IS NULL
    AND c.pipeline_stage = 'shortlist' AND c.admissions_direction = 'MY' FROM platform.student_cases c WHERE c.id = :'n281_case_wait'::UUID),
  'the case waits in its stage');
SELECT pg_temp.n281_assert((SELECT array_agg(n.body) FROM platform.case_notes n WHERE n.student_case_id = :'n281_case_wait'::UUID)
  = ARRAY['Возраст: 17 (на ' || to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, 'DD.MM.YYYY') || E')\n\nN281 waits for a curator'],
  'the age without a birth date and the note form the first case note');
SELECT pg_temp.n281_assert((SELECT count(*) = 1 AND bool_and(o.amount_minor = 900000 AND o.currency = 'KGS' AND o.total_paid_minor = 0)
  FROM platform.payment_obligations o WHERE o.student_case_id = :'n281_case_wait'::UUID), 'an unpaid tranche for the cost');

-- Curators read nothing of it; the Admin does.
SET LOCAL request.jwt.claims TO :'n281_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_wait'::UUID),
  'Admissions B does not read the waiting case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_c';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_wait'::UUID),
  'Admissions C does not read the waiting case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_wait'::UUID),
  'the Admin reads the waiting case');
RESET ROLE;

-- The manager assigns a curator: the case becomes active without a portal
-- activation (no Student yet — the e1 fix; before 281 this failed with 23514).
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT platform.assign_case_curator_v1(pg_temp.n281_id(1), pg_temp.n281_id(5104), :'n281_case_wait'::UUID,
  pg_temp.n281_id(306), 'N281 assign curator') AS n281_assigned \gset
SELECT pg_temp.n281_assert(:'n281_assigned'::JSONB ->> 'case_state' = 'active'
  AND :'n281_assigned'::JSONB -> 'portal_activated_at' = 'null'::JSONB, 'the manager assigns Admissions B');
SELECT pg_temp.n281_assert(pg_temp.n281_error(format($q$SELECT platform.assign_case_curator_v1(%L, %L, %L, %L, 'N281 again')$q$,
  pg_temp.n281_id(1), gen_random_uuid(), :'n281_case_wait', pg_temp.n281_id(304))) = '55000:Case does not need a curator assignment',
  'an assigned case no longer needs a curator');
RESET ROLE;
SELECT pg_temp.n281_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n281_id(306)
    AND c.portal_activated_at IS NULL AND c.handoff_at IS NOT NULL AND c.pipeline_stage = 'shortlist'
  FROM platform.student_cases c WHERE c.id = :'n281_case_wait'::UUID), 'active with Admissions B, still in its stage');
SELECT pg_temp.n281_assert(NOT ('needs_curator' = ANY (platform_private.admissions_attention_flags(:'n281_case_wait'::UUID)))
  AND NOT ('awaiting_ack' = ANY (platform_private.admissions_attention_flags(:'n281_case_wait'::UUID))),
  'no needs_curator and no awaiting_ack after the assignment');
SET LOCAL request.jwt.claims TO :'n281_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_wait'::UUID),
  'Admissions B now reads its case');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2b. R1 One person, one card (the manager).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5111, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Same Sales Phone', 'phone', '+996555281999'), 'route', jsonb_build_object('country', 'MY')))
  = 'PT409:admissions_direct_lead_exists', 'R1: a person with an open sales lead (same phone) is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5112, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Same Sales Email', 'email', 'N281-SALES@example.invalid'), 'route', jsonb_build_object('country', 'MY')))
  = 'PT409:admissions_direct_lead_exists', 'R1: a person with an open sales lead (same e-mail) is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_error_detail(format('SELECT platform.create_admissions_student_case_v1(%L, %L, %L::JSONB)',
    pg_temp.n281_id(1), pg_temp.n281_id(5113), jsonb_build_object('student',
      jsonb_build_object('name', 'N281 Same Sales Detail', 'phone', '+996 555 281 999'), 'route', jsonb_build_object('country', 'MY'))::TEXT))
  = :'n281_sales_lead', 'R1: the refusal names the open lead in DETAIL');
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5114), jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 Email Twin', 'email', 'n281-old@example.invalid', 'phone', '+996 555 281 701'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n281_id(306)::TEXT)) AS n281_twin \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5115), jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 Old Pair', 'email', 'n281-pair@example.invalid', 'phone', '+996555281888'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n281_id(306)::TEXT)) AS n281_pair \gset
RESET ROLE;
SELECT pg_temp.n281_assert(NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.organization_id = pg_temp.n281_id(1)
    AND c.display_name LIKE 'N281 Same Sales%')
  AND NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_receipts r
    WHERE r.request_id IN (pg_temp.n281_id(5111), pg_temp.n281_id(5112), pg_temp.n281_id(5113))),
  'R1: the refused requests created nothing');
SELECT pg_temp.n281_assert((SELECT l.lifecycle_state = 'open' AND l.current_owner_membership_id IS NULL
  FROM platform.leads l WHERE l.id = :'n281_sales_lead'::UUID), 'R1: the sales lead stays open with sales');
SELECT pg_temp.n281_assert(NOT (:'n281_twin'::JSONB ->> 'client_reused')::BOOLEAN
  AND (:'n281_twin'::JSONB ->> 'client_id')::UUID <> :'n281_old_client'::UUID
  AND EXISTS (SELECT 1 FROM platform_private.client_duplicate_candidates d
    WHERE d.organization_id = pg_temp.n281_id(1) AND d.status = 'open' AND d.match_basis = 'email'
      AND d.left_client_id = LEAST((:'n281_twin'::JSONB ->> 'client_id')::UUID, :'n281_old_client'::UUID)
      AND d.right_client_id = GREATEST((:'n281_twin'::JSONB ->> 'client_id')::UUID, :'n281_old_client'::UUID)),
  'R1: an e-mail twin is a new client and an open duplicate candidate');
SELECT pg_temp.n281_assert((:'n281_pair'::JSONB ->> 'client_reused')::BOOLEAN
  AND (:'n281_pair'::JSONB ->> 'client_id')::UUID = :'n281_pair_client'::UUID,
  'R1: an exact e-mail+phone match reuses the client');
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5116, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Pair Again', 'email', 'n281-pair@example.invalid'), 'route', jsonb_build_object('country', 'MY')))
  = 'PT409:admissions_direct_case_exists', 'R1: the reused client now has its case: a second card is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2c. D1 One phone form (delta review): every spelling of the same number.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n281_assert(platform_private.admissions_direct_phone('+996 777 281 999') = '+996777281999'
  AND platform_private.admissions_direct_phone('996 777 281 999') = '+996777281999'
  AND platform_private.admissions_direct_phone('0777 281 999') = '+996777281999'
  AND platform_private.admissions_direct_phone('+996 0777 281 999') = '+996777281999'
  AND platform_private.admissions_direct_phone('00996 777 281 999') = '+996777281999'
  AND platform_private.admissions_direct_phone('+7 701 123 45 67') = '+77011234567'
  AND platform_private.admissions_direct_phone('777 281 999') IS NULL
  AND platform_private.admissions_direct_phone('8 701 123 45 67') IS NULL
  AND platform_private.admissions_direct_phone('+996 777 28 19') IS NULL
  AND platform_private.admissions_direct_phone('+0 555 123 456') IS NULL,
  'D1: one E.164 form; the Kyrgyz spellings become +996…, an ambiguous number without «+» is refused');
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert((SELECT array_agg(pg_temp.n281_create((5120 + x.i)::INTEGER, jsonb_build_object('student',
      jsonb_build_object('name', 'N281 Spelling ' || x.i, 'phone', x.p), 'route', jsonb_build_object('country', 'MY'))) ORDER BY x.i)
    FROM unnest(ARRAY['996555281999', '0555 281 999', '996 555 281 999', '+996 0555 281 999', '00996555281999'])
      WITH ORDINALITY AS x(p, i))
  = ARRAY['PT409:admissions_direct_lead_exists', 'PT409:admissions_direct_lead_exists', 'PT409:admissions_direct_lead_exists',
    'PT409:admissions_direct_lead_exists', 'PT409:admissions_direct_lead_exists'],
  'D1: the open sales lead on +996555281999 refuses every other spelling of its number');
SELECT pg_temp.n281_assert(pg_temp.n281_error_detail(format('SELECT platform.create_admissions_student_case_v1(%L, %L, %L::JSONB)',
    pg_temp.n281_id(1), pg_temp.n281_id(5126), jsonb_build_object('student',
      jsonb_build_object('name', 'N281 Spelling Local', 'phone', '+996 555 281 666'), 'route', jsonb_build_object('country', 'MY'))::TEXT))
  = :'n281_local_sales_lead', 'D1: a sales lead stored as 0555281666 is found from +996 555 281 666');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5127, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Spelling Case', 'phone', '0555 281 001'), 'route', jsonb_build_object('country', 'MY')))
  = 'PT409:admissions_direct_case_exists', 'D1: the case on +996555281001 is found from 0555 281 001');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5128, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Spelling Bare', 'phone', '555 281 001'), 'route', jsonb_build_object('country', 'MY')))
  = '22023:admissions_direct_invalid:phone', 'D1: a number without «+» and without a Kyrgyz prefix is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5129, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Spelling Short', 'phone', '+996 555 28 10'), 'route', jsonb_build_object('country', 'MY')))
  = '22023:admissions_direct_invalid:phone', 'D1: a Kyrgyz number needs 9 digits after +996');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5130, jsonb_build_object('student', jsonb_build_object('name', 'N281 Spelling Parent'),
    'parent', jsonb_build_object('relation', 'mother', 'phone', '8 701 123 45 67'), 'route', jsonb_build_object('country', 'MY')))
  = '22023:admissions_direct_invalid:parentPhone', 'D1: the parent phone follows the same rule');
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5131), jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 Local Created', 'phone', '0700 281 301'),
  'parent', jsonb_build_object('relation', 'father', 'phone', '996 700 281 302'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n281_id(306)::TEXT)) AS n281_local_created \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5132), jsonb_build_object(
  'student', jsonb_build_object('name', 'N281 New Local', 'phone', '+996 555 281 444'),
  'route', jsonb_build_object('country', 'MY'), 'curatorMembershipId', pg_temp.n281_id(306)::TEXT)) AS n281_new_local \gset
RESET ROLE;
SELECT pg_temp.n281_assert(NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.organization_id = pg_temp.n281_id(1)
    AND c.display_name LIKE 'N281 Spelling%')
  AND (SELECT count(*) = 2 FROM platform.leads l WHERE l.organization_id = pg_temp.n281_id(1) AND l.lifecycle_state = 'open'
    AND l.id IN (:'n281_sales_lead'::UUID, :'n281_local_sales_lead'::UUID)),
  'D1: the refused spellings created nothing; both sales leads stay open');
SELECT pg_temp.n281_assert((SELECT cl.phone = '+996700281301' AND cl.normalized_phone = '+996700281301'
  FROM platform.clients cl WHERE cl.id = (:'n281_local_created'::JSONB ->> 'client_id')::UUID),
  'D1: the client is stored as +996… (the WhatsApp form)');
SELECT pg_temp.n281_assert((SELECT array_agg(f.field_key || '=' || f.value ORDER BY f.field_key)
    FROM platform.student_profile_fields f WHERE f.student_case_id = (:'n281_local_created'::JSONB ->> 'student_case_id')::UUID
      AND f.field_key LIKE '%phone')
  = ARRAY['father_mobile_phone=+996700281302', 'mobile_phone=+996700281301'], 'D1: the анкета phones are +996… too');
SELECT pg_temp.n281_assert(EXISTS (SELECT 1 FROM platform_private.client_duplicate_candidates d
    WHERE d.organization_id = pg_temp.n281_id(1) AND d.status = 'open' AND d.match_basis = 'phone'
      AND d.left_client_id = LEAST((:'n281_new_local'::JSONB ->> 'client_id')::UUID, :'n281_old_local_client'::UUID)
      AND d.right_client_id = GREATEST((:'n281_new_local'::JSONB ->> 'client_id')::UUID, :'n281_old_local_client'::UUID)),
  'D1: a client holding the same number as 0555281444 is a phone duplicate candidate');

-- ---------------------------------------------------------------------------
-- 3. The Admin: any curator, or none.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n281_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert((platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5201),
  pg_temp.n281_payload('N281 Admin For C', 307)) ->> 'curator_membership_id') = pg_temp.n281_id(307)::TEXT,
  'the Admin creates for a curator of any department');
SELECT platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5202),
  pg_temp.n281_payload('N281 Admin Waiting', NULL)) AS n281_admin_none \gset
SELECT pg_temp.n281_assert(:'n281_admin_none'::JSONB ->> 'state' = 'pending', 'the Admin creates without a curator');
-- R6: received money is paid today at the latest (Bishkek).
SELECT pg_temp.n281_assert(pg_temp.n281_create(5210, jsonb_build_object('student', jsonb_build_object('name', 'N281 Tomorrow'),
    'route', jsonb_build_object('country', 'MY'),
    'money', jsonb_build_object('payments', jsonb_build_array(jsonb_build_object('amountMinor', 100, 'currency', 'USD',
      'paidOn', to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1, 'YYYY-MM-DD'))))))
  = '22023:admissions_direct_invalid:paidOn', 'R6: a payment dated tomorrow is refused');
-- D4: the contract is signed today at the latest; a payment before it is an advance.
SELECT pg_temp.n281_assert(pg_temp.n281_create(5213, jsonb_build_object('student', jsonb_build_object('name', 'N281 Signed Tomorrow'),
    'route', jsonb_build_object('country', 'MY'),
    'money', jsonb_build_object('signedOn', to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1, 'YYYY-MM-DD'))))
  = '22023:admissions_direct_invalid:signedOn', 'D4: a contract signed tomorrow is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5214, jsonb_build_object('student', jsonb_build_object('name', 'N281 Signed 2099'),
    'route', jsonb_build_object('country', 'MY'), 'money', jsonb_build_object('signedOn', '2099-01-01')))
  = '22023:admissions_direct_invalid:signedOn', 'D4: the review''s 2099 contract is refused');
SELECT pg_temp.n281_assert((platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5215),
    jsonb_build_object('student', jsonb_build_object('name', 'N281 Signed Today'), 'route', jsonb_build_object('country', 'TR'),
      'curatorMembershipId', pg_temp.n281_id(307)::TEXT,
      'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 1000, 'currency', 'USD'),
        'signedOn', to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, 'YYYY-MM-DD'),
        'payments', jsonb_build_array(jsonb_build_object('amountMinor', 100, 'currency', 'USD',
          'paidOn', to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 10, 'YYYY-MM-DD'))))))
  ->> 'state') = 'active', 'D4: a contract signed today with an advance paid before it is accepted');
SELECT pg_temp.n281_assert((platform.create_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(5211),
    jsonb_build_object('student', jsonb_build_object('name', 'N281 Paid Today'), 'route', jsonb_build_object('country', 'TR'),
      'curatorMembershipId', pg_temp.n281_id(307)::TEXT,
      'money', jsonb_build_object('payments', jsonb_build_array(jsonb_build_object('amountMinor', 100, 'currency', 'USD',
        'paidOn', to_char((statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE, 'YYYY-MM-DD'))))))
  ->> 'state') = 'active', 'R6: a payment dated today is accepted');
-- Validation: money, stage, unknown keys, curator.
SELECT pg_temp.n281_assert(pg_temp.n281_create(5203, jsonb_build_object('student', jsonb_build_object('name', 'N281 Over'),
    'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 100, 'currency', 'USD'),
      'payments', jsonb_build_array(jsonb_build_object('amountMinor', 200, 'currency', 'USD', 'paidOn', '2026-09-01')))))
  = '22023:admissions_direct_invalid:paymentsExceedCost', 'payments above the cost are refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5204, jsonb_build_object('student', jsonb_build_object('name', 'N281 Stage'),
    'pipelineStage', 'bogus')) = '22023:admissions_direct_invalid:pipelineStage', 'an unknown stage is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5205, jsonb_build_object('student', jsonb_build_object('name', 'N281 Key'),
    'salesOwner', 'x')) = '22023:admissions_direct_invalid:payload', 'an unknown key is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5206, jsonb_build_object('student', jsonb_build_object('name', 'N281 Rub'),
    'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 100, 'currency', 'RUB'))))
  = '22023:admissions_direct_invalid:costCurrency', 'a currency outside USD/EUR/KGS is refused');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5207, pg_temp.n281_payload('N281 Sales curator', 302))
  = '22023:admissions_direct_invalid:curator', 'a Sales Manager is not an eligible curator');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5208, jsonb_build_object('student', jsonb_build_object('name', ' ')))
  = '22023:admissions_direct_invalid:name', 'a name is required');
-- One person, one card: the phone of a student with an open case.
SELECT pg_temp.n281_assert(pg_temp.n281_create(5209, jsonb_build_object('student',
    jsonb_build_object('name', 'N281 Same phone', 'phone', '+996555281001'))) = 'PT409:admissions_direct_case_exists',
  'a person with an open case is refused');
RESET ROLE;
SELECT (:'n281_admin_none'::JSONB ->> 'student_case_id') AS n281_case_admin_wait \gset
-- R3: what the Admin leaves without a curator, the Admissions Manager of the
-- department reads and distributes; curators, Sales and an «own» scope do not.
SET LOCAL request.jwt.claims TO :'n281_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID),
  'R3: Admissions B does not read the Admin''s waiting case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_c';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID),
  'R3: Admissions C does not read the Admin''s waiting case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID),
  'R3: the Sales Manager (department scope without the keys) does not read it');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_own_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID)
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_student_case_queue_v1('needs_curator', 100) -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n281_case_admin_wait'),
  'R3: the same keys in an «own» scope do not cover the Admin''s case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID),
  'R3: the manager reads the waiting case authored by the Admin');
SELECT pg_temp.n281_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_student_case_queue_v1('needs_curator', 100) -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n281_case_admin_wait'), 'R3: the manager sees it in «Ждут куратора»');
SELECT pg_temp.n281_assert((platform.assign_case_curator_v1(pg_temp.n281_id(1), pg_temp.n281_id(5212), :'n281_case_admin_wait'::UUID,
  pg_temp.n281_id(304), 'N281 manager distributes the Admin''s case') ->> 'case_state') = 'active',
  'R3: the manager assigns a curator to it');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. Refused: Sales Manager, Student, no membership, anon.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n281_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5301, pg_temp.n281_payload('N281 Sales', NULL)) = '42501:admissions_direct_forbidden',
  'the Sales Manager cannot create');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5302, pg_temp.n281_payload('N281 Sales for A', 304)) = '42501:admissions_direct_forbidden',
  'the Sales Manager cannot create for a curator');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5303, pg_temp.n281_payload('N281 Student', NULL)) = '42501:admissions_direct_forbidden',
  'the Student cannot create');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5304, pg_temp.n281_payload('N281 None', NULL)) = '42501:admissions_direct_forbidden',
  'an authenticated user without membership cannot create');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n281_assert(pg_temp.n281_create(5305, pg_temp.n281_payload('N281 Anon', NULL)) LIKE '42501:permission denied for %',
  'anon cannot execute the command');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. The service-only import: same path, explicit actor, idempotent by ref.
-- ---------------------------------------------------------------------------
INSERT INTO n281_payloads VALUES
  ('import_1', jsonb_build_object('student', jsonb_build_object('name', 'N281 Imported One', 'phone', '+996 700 281 201'),
    'route', jsonb_build_object('country', 'CN'), 'curatorMembershipId', pg_temp.n281_id(304)::TEXT, 'pipelineStage', 'visa',
    'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 150000, 'currency', 'USD'),
      'payments', jsonb_build_array(jsonb_build_object('amountMinor', 150000, 'currency', 'USD', 'paidOn', '2026-08-20'))))),
  ('import_2', jsonb_build_object('student', jsonb_build_object('name', 'N281 Imported Two'),
    'route', jsonb_build_object('country', 'MY'), 'pipelineStage', 'new'));
SET LOCAL request.jwt.claims TO :'n281_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_import(301, 'amo-1', (SELECT payload FROM n281_payloads WHERE k = 'import_1'))
  LIKE '42501:permission denied for function import_admissions_student_case_v1', 'authenticated (even the Admin) cannot import');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n281_assert(pg_temp.n281_import(301, 'amo-1', (SELECT payload FROM n281_payloads WHERE k = 'import_1'))
  LIKE '42501:permission denied for %', 'anon cannot import');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-1',
  (SELECT payload FROM n281_payloads WHERE k = 'import_1'), 'Импорт клиентов из amoCRM по поручению владельца') AS n281_imp_1 \gset
SELECT platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-2',
  (SELECT payload FROM n281_payloads WHERE k = 'import_2'), 'Импорт клиентов из amoCRM по поручению владельца') AS n281_imp_2 \gset
SELECT pg_temp.n281_assert(:'n281_imp_1'::JSONB ->> 'state' = 'active' AND :'n281_imp_1'::JSONB ->> 'pipeline_stage' = 'visa'
  AND :'n281_imp_2'::JSONB ->> 'state' = 'pending', 'the service imports two rows (with and without a curator)');
SELECT pg_temp.n281_assert((platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-1',
    (SELECT payload FROM n281_payloads WHERE k = 'import_1'), 'Импорт клиентов из amoCRM по поручению владельца') - 'replayed')
  = (:'n281_imp_1'::JSONB - 'replayed')
  AND (platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-2',
    (SELECT payload FROM n281_payloads WHERE k = 'import_2'), 'Импорт клиентов из amoCRM по поручению владельца') ->> 'replayed')::BOOLEAN,
  'importing the same rows again replays them');
SELECT pg_temp.n281_assert(pg_temp.n281_import(301, 'amo-2', pg_temp.n281_payload('N281 Changed', NULL))
  = 'PT409:admissions_direct_import_conflict', 'a changed row under the same reference is a conflict');
SELECT pg_temp.n281_assert(pg_temp.n281_import(302, 'amo-3', pg_temp.n281_payload('N281 Via sales', NULL))
  = '42501:admissions_direct_forbidden', 'a Sales Manager membership cannot be the import actor');
SELECT pg_temp.n281_assert(pg_temp.n281_import(305, 'amo-4', pg_temp.n281_payload('N281 Via student', NULL))
  = '42501:admissions_direct_forbidden', 'a Student membership cannot be the import actor');
-- R1: a person already in work is reported, not created.
SELECT platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-6',
  jsonb_build_object('student', jsonb_build_object('name', 'N281 Imported Sales', 'phone', '+996 555 281 999'),
    'route', jsonb_build_object('country', 'MY')), 'Импорт клиентов из amoCRM по поручению владельца') AS n281_imp_lead \gset
SELECT pg_temp.n281_assert(:'n281_imp_lead'::JSONB ->> 'status' = 'lead_exists'
  AND :'n281_imp_lead'::JSONB ->> 'lead_id' = :'n281_sales_lead'
  AND :'n281_imp_lead'::JSONB ->> 'external_ref' = 'amo-6' AND NOT (:'n281_imp_lead'::JSONB ? 'student_case_id'),
  'R1: the import reports a row whose person has an open sales lead');
SELECT platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301), 'n281-amocrm-test', 'amo-7',
  jsonb_build_object('student', jsonb_build_object('name', 'N281 Imported Twin', 'phone', '+996555281001'),
    'route', jsonb_build_object('country', 'CN')), 'Импорт клиентов из amoCRM по поручению владельца') AS n281_imp_case \gset
SELECT pg_temp.n281_assert(:'n281_imp_case'::JSONB ->> 'status' = 'case_exists'
  AND :'n281_imp_case'::JSONB ->> 'student_case_id' = :'n281_case_a',
  'R1: the import reports a row whose person already has a case');
RESET ROLE;
-- D1: the import reports every spelling of a number in work.
SELECT pg_temp.n281_assert((SELECT array_agg((platform.import_admissions_student_case_v1(pg_temp.n281_id(1), pg_temp.n281_id(301),
      'n281-amocrm-test', x.ref, jsonb_build_object('student', jsonb_build_object('name', 'N281 Imported Spelling', 'phone', x.p),
        'route', jsonb_build_object('country', 'MY')), 'Импорт клиентов из amoCRM по поручению владельца')) ->> 'lead_id' ORDER BY x.n)
    FROM (VALUES (1, 'amo-8', '996 555 281 999'), (2, 'amo-9', '0555281999'), (3, 'amo-10', '+996 555 281 666')) AS x(n, ref, p))
  = ARRAY[:'n281_sales_lead', :'n281_sales_lead', :'n281_local_sales_lead'],
  'D1: the import reports lead_exists for 996…, 0… and for a lead stored in the national spelling');
SELECT pg_temp.n281_assert(NOT EXISTS (SELECT 1 FROM platform_private.admissions_direct_case_receipts r
    WHERE r.import_source = 'n281-amocrm-test' AND r.external_ref IN ('amo-6', 'amo-7', 'amo-8', 'amo-9', 'amo-10'))
  AND NOT EXISTS (SELECT 1 FROM platform.clients c WHERE c.organization_id = pg_temp.n281_id(1)
    AND c.display_name IN ('N281 Imported Sales', 'N281 Imported Twin', 'N281 Imported Spelling')),
  'R1: the reported rows created nothing');
SELECT pg_temp.n281_assert((SELECT count(*) = 2 AND bool_and(p.evidence_type = 'imported' AND p.source_ref = 'amo-1'
    AND p.imported_at IS NOT NULL)
  FROM platform.subject_provenance p WHERE p.organization_id = pg_temp.n281_id(1) AND p.source_system = 'evo_admissions'
    AND (p.client_id = (:'n281_imp_1'::JSONB ->> 'client_id')::UUID OR p.lead_id = (:'n281_imp_1'::JSONB ->> 'lead_id')::UUID)),
  'R1: an imported client and lead carry imported provenance with the external reference');
SET LOCAL request.jwt.claims TO :'n281_admin';
SET LOCAL ROLE service_role;
SELECT pg_temp.n281_assert(pg_temp.n281_import(301, 'amo-5', pg_temp.n281_payload('N281 With a user token', NULL))
  = '42501:admissions_direct_forbidden', 'the import refuses a call carrying a user identity');
RESET ROLE;
SELECT pg_temp.n281_assert((SELECT count(*) = 2 AND bool_and(r.actor_membership_id = pg_temp.n281_id(301))
  FROM platform_private.admissions_direct_case_receipts r WHERE r.import_source = 'n281-amocrm-test'),
  'two import receipts, attributed to the Admin membership');
SELECT pg_temp.n281_assert((SELECT a.actor_principal = 'service:admissions-import' AND a.actor_profile_id = pg_temp.n281_id(201)
    AND a.reason = 'Импорт клиентов из amoCRM по поручению владельца' AND a.after_state ->> 'external_ref' = 'amo-1'
  FROM platform.audit_events a WHERE a.action = 'case.create' AND a.resource_id = (:'n281_imp_1'::JSONB ->> 'student_case_id')::UUID),
  'the import is journaled as the service path for the Admin with the owner''s reason');
SELECT pg_temp.n281_assert((SELECT o.total_paid_minor = o.amount_minor FROM platform.payment_obligations o
  WHERE o.student_case_id = (:'n281_imp_1'::JSONB ->> 'student_case_id')::UUID), 'the imported payment closes the tranche');
-- R7 (documented in docs/runbooks/admissions-direct-import.md): the curator
-- assignment of an import is written by the shared e1 as the Admin's auth
-- principal; its request id ties it to the import request.
SELECT pg_temp.n281_assert((SELECT array_agg(a.action || '|' || a.actor_principal ORDER BY a.action)
    FROM platform.audit_events a WHERE a.organization_id = pg_temp.n281_id(1)
      AND (a.request_id = pg_temp.n281_import_request('amo-1')
        OR a.request_id = public.uuid_generate_v5(pg_temp.n281_import_request('amo-1'), 'admissions-direct:assign')
        OR (a.action IN ('case.tranche.save', 'finance.payment.record')
          AND a.after_state ->> 'student_case_id' = :'n281_imp_1'::JSONB ->> 'student_case_id')))
  = ARRAY['case.create|service:admissions-import', 'case.curator.set|auth:' || pg_temp.n281_id(101)::TEXT,
    'case.tranche.save|service:admissions-import', 'finance.payment.record|service:admissions-import'],
  'R7: import journal principals as documented');
-- R3: an imported row without a curator is the manager's to distribute.
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(private.platform_can_read_student_case(pg_temp.n281_id(1), (:'n281_imp_2'::JSONB ->> 'student_case_id')::UUID)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(platform.staff_student_case_queue_v1('needs_curator', 100) -> 'rows') r
    WHERE r ->> 'student_case_id' = :'n281_imp_2'::JSONB ->> 'student_case_id'),
  'R3: the manager reads an imported waiting case and sees it in «Ждут куратора»');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n281_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), (:'n281_imp_2'::JSONB ->> 'student_case_id')::UUID),
  'R3: a curator does not read the imported waiting case');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5b. R5 The curator options of «Добавить студента».
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT platform.admissions_direct_curator_options_v1(pg_temp.n281_id(1)) AS n281_opt_manager \gset
RESET ROLE;
SELECT pg_temp.n281_assert((:'n281_opt_manager'::JSONB ->> 'without_curator')::BOOLEAN
  AND (SELECT array_agg((o ->> 'membership_id')::UUID ORDER BY (o ->> 'membership_id'))
    FROM jsonb_array_elements(:'n281_opt_manager'::JSONB -> 'owners') o)
    = ARRAY[pg_temp.n281_id(303), pg_temp.n281_id(304), pg_temp.n281_id(306), pg_temp.n281_id(308)],
  'R5: the manager is offered the curators of its department (not the Admin, Sales or another department) and «Без куратора»');
SET LOCAL request.jwt.claims TO :'n281_a';
SET LOCAL ROLE authenticated;
SELECT platform.admissions_direct_curator_options_v1(pg_temp.n281_id(1)) AS n281_opt_a \gset
RESET ROLE;
SELECT pg_temp.n281_assert(NOT (:'n281_opt_a'::JSONB ->> 'without_curator')::BOOLEAN
  AND :'n281_opt_a'::JSONB -> 'owners' = jsonb_build_array(jsonb_build_object('membership_id', pg_temp.n281_id(304),
    'display_name', 'N281 Actor 4')), 'R5: a curator is offered only itself, never «Без куратора»');
SET LOCAL request.jwt.claims TO :'n281_admin';
SET LOCAL ROLE authenticated;
SELECT platform.admissions_direct_curator_options_v1(pg_temp.n281_id(1)) AS n281_opt_admin \gset
RESET ROLE;
SELECT pg_temp.n281_assert((:'n281_opt_admin'::JSONB ->> 'without_curator')::BOOLEAN
  AND (SELECT array_agg((o ->> 'membership_id')::UUID) FROM jsonb_array_elements(:'n281_opt_admin'::JSONB -> 'owners') o)
    @> ARRAY[pg_temp.n281_id(304), pg_temp.n281_id(306), pg_temp.n281_id(307)],
  'R5: the Admin is offered every eligible curator and «Без куратора»');
SET LOCAL request.jwt.claims TO :'n281_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(pg_temp.n281_error(format('SELECT platform.admissions_direct_curator_options_v1(%L)', pg_temp.n281_id(1)))
  = '42501:admissions_direct_forbidden', 'R5: Sales reads no options');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n281_assert(pg_temp.n281_error(format('SELECT platform.admissions_direct_curator_options_v1(%L)', pg_temp.n281_id(1)))
  LIKE '42501:permission denied for %', 'R5: anon cannot read the options');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Nothing of sales is touched; posture of the new objects.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n281_assert((SELECT
    (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.n281_id(1)) = b.register_rows
    AND (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n281_id(1)) = b.handoffs
    AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n281_id(1) AND lifecycle_state = 'open') = b.open_leads
  FROM n281_before b), 'no sales record, no sales handoff, no open lead');
SELECT pg_temp.n281_assert((SELECT count(*) = (SELECT count(*) FROM platform_private.admissions_direct_case_receipts r
      WHERE r.organization_id = pg_temp.n281_id(1))
    AND count(*) = 13
    AND bool_and(l.lifecycle_state = 'converted' AND l.current_owner_membership_id IS NULL)
  FROM platform.leads l WHERE l.organization_id = pg_temp.n281_id(1) AND l.source_key = 'admissions_direct'),
  'thirteen created leads, one per receipt, all converted and without a sales owner');
SELECT pg_temp.n281_assert((SELECT count(*) = 13 FROM platform.student_cases c JOIN platform_private.admissions_direct_case_receipts r
    ON r.student_case_id = c.id AND r.lead_id = c.canonical_lead_id AND r.client_id = c.canonical_client_id
    WHERE c.organization_id = pg_temp.n281_id(1)), 'thirteen cases, each with its receipt');
SELECT pg_temp.n281_assert((SELECT bool_and(c.normalized_phone ~ '^\+[1-9][0-9]{6,14}$') FROM platform.clients c
    JOIN platform_private.admissions_direct_case_receipts r ON r.client_id = c.id
    WHERE c.organization_id = pg_temp.n281_id(1) AND c.normalized_phone IS NOT NULL),
  'D1: every client created here holds an E.164 phone');
SELECT pg_temp.n281_assert(NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.n281_id(1),
    (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1, (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1) m
    WHERE m.source_key = 'admissions_direct'),
  'the marketing cohort does not count them');
SELECT pg_temp.n281_assert((SELECT bool_and(f.value IS NULL
    OR f.value = platform_private.normalize_student_profile_field_value(f.field_key, f.value))
    AND NOT bool_or(f.field_key = 'desired_start_date')
  FROM platform.student_profile_fields f WHERE f.organization_id = pg_temp.n281_id(1)),
  'R2: every анкета value of every created case is canonical; no desired_start_date');
SELECT pg_temp.n281_assert(
  has_function_privilege('authenticated', 'platform.create_admissions_student_case_v1(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.create_admissions_student_case_v1(uuid,uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'platform.admissions_direct_curator_options_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.admissions_direct_curator_options_v1(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'platform_private.admissions_direct_case_receipts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'platform_private.admissions_direct_case_receipts', 'SELECT'),
  'grants: the command for authenticated, the import for service_role only, nothing else');
SELECT pg_temp.n281_assert((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
  FROM pg_proc p WHERE p.oid IN ('platform.create_admissions_student_case_v1(uuid,uuid,jsonb)'::regprocedure,
    'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)'::regprocedure,
    'platform_private.create_admissions_student_case(uuid,uuid,uuid,jsonb,text,text,text)'::regprocedure)),
  'SECURITY DEFINER with the empty search_path');
SELECT pg_temp.n281_assert((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid = 'platform_private.admissions_direct_case_receipts'::regclass), 'receipts: forced RLS');
SELECT pg_temp.n281_assert(pg_temp.n281_error(format('UPDATE platform_private.admissions_direct_case_receipts SET external_ref = %L WHERE request_id = %L',
    'n281-forged', pg_temp.n281_id(5001))) <> 'ok'
  AND pg_temp.n281_error(format('DELETE FROM platform_private.admissions_direct_case_receipts WHERE request_id = %L',
    pg_temp.n281_id(5001))) <> 'ok'
  AND (SELECT external_ref IS NULL FROM platform_private.admissions_direct_case_receipts WHERE request_id = pg_temp.n281_id(5001)),
  'receipts are append-only');

SELECT 'N281_ADMISSIONS_DIRECT_STUDENT_SUITE_PASSED' AS n281_suite_marker;
ROLLBACK;
