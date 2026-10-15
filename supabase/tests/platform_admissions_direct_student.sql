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
-- Student, no membership and anon refused), idempotency, stage, profile and
-- money correctness, «Ждут куратора» and the assignment of a curator-less
-- case (the e1 activation fix), the service-only import (refused to
-- authenticated and anon, idempotent by external reference), and that nothing
-- of sales (register, handoffs, open leads, marketing cohort) is touched.
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
GRANT EXECUTE ON FUNCTION pg_temp.n281_id(INTEGER), pg_temp.n281_assert(BOOLEAN, TEXT), pg_temp.n281_error(TEXT),
  pg_temp.n281_create(INTEGER, JSONB), pg_temp.n281_import(INTEGER, TEXT, JSONB), pg_temp.n281_payload(TEXT, INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N281_ADMISSIONS_DIRECT_STUDENT_SUITE_START' AS n281_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager (sales department), 3 Admissions Manager, 4 Admissions A and
-- 6 Admissions B (admissions department), 7 Admissions C (a second admissions
-- department); 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n281_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n281_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL);
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
  (pg_temp.n281_id(1), pg_temp.n281_id(307), pg_temp.n281_id(903));

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
 (307, pg_temp.n281_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n281_id(1), 'resourceKind', NULL));
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
SELECT pg_temp.n281_assert((SELECT array_agg(n ORDER BY n) FROM unnest(ARRAY[301, 302, 303, 304, 306, 307]) n
    WHERE platform_private.staff_has_permission(pg_temp.n281_id(1), pg_temp.n281_id(n), 'case.create.direct'))
  = ARRAY[301, 303, 304, 306, 307], 'Admin, Admissions Manager and the three curators hold case.create.direct; Sales does not');
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
SELECT jsonb_build_object('sub', pg_temp.n281_id(199), 'role', 'authenticated')::TEXT AS n281_no_member \gset
SELECT pg_temp.n281_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n281_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff'], 'claims: admin, staff and student');

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
    'phone', '+996 555 281 001', 'email', 'n281-one@example.invalid', 'birthDate', '2008-05-01'),
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
SELECT pg_temp.n281_assert((SELECT array_agg(f.field_key || '=' || COALESCE(f.value, '∅') ORDER BY f.field_key)
  FROM platform.student_profile_fields f WHERE f.student_case_id = :'n281_case_a'::UUID AND f.review_state = 'needs_review')
  = ARRAY['chinese_level_hsk=HSK 3', 'current_study_status=11 класс', 'date_of_birth=∅', 'desired_start_date=Сентябрь 2027',
    'english_level=IELTS 6.0', 'field_major=Computer Science', 'mobile_phone=+996 555 281 001',
    'mother_first_name=N281 Mother', 'mother_mobile_phone=+996 555 281 101', 'program_level=Бакалавриат',
    'student_email=n281-one@example.invalid', 'student_first_name=N281', 'student_last_name=One'],
  'the анкета fields are written for review');
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
SELECT pg_temp.n281_assert(pg_temp.n281_create(5002, pg_temp.n281_payload('N281 For B', 306)) = '42501:admissions_direct_forbidden',
  'Admissions A cannot create a case for Admissions B');
SELECT pg_temp.n281_assert(pg_temp.n281_create(5003, pg_temp.n281_payload('N281 No curator', NULL)) = '42501:admissions_direct_forbidden',
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
SELECT pg_temp.n281_assert(pg_temp.n281_create(5102, pg_temp.n281_payload('N281 Manager For C', 307)) = '42501:admissions_direct_forbidden',
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
SET LOCAL request.jwt.claims TO :'n281_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n281_assert(NOT private.platform_can_read_student_case(pg_temp.n281_id(1), :'n281_case_admin_wait'::UUID),
  'a waiting case authored by the Admin (outside the department) is not the manager''s');
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
RESET ROLE;
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

-- ---------------------------------------------------------------------------
-- 6. Nothing of sales is touched; posture of the new objects.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n281_assert((SELECT
    (SELECT count(*) FROM platform_private.sales_register WHERE organization_id = pg_temp.n281_id(1)) = b.register_rows
    AND (SELECT count(*) FROM platform.sales_admissions_handoffs WHERE organization_id = pg_temp.n281_id(1)) = b.handoffs
    AND (SELECT count(*) FROM platform.leads WHERE organization_id = pg_temp.n281_id(1) AND lifecycle_state = 'open') = b.open_leads
  FROM n281_before b), 'no sales record, no sales handoff, no open lead');
SELECT pg_temp.n281_assert((SELECT count(*) = 7 AND bool_and(l.lifecycle_state = 'converted' AND l.current_owner_membership_id IS NULL)
  FROM platform.leads l WHERE l.organization_id = pg_temp.n281_id(1) AND l.source_key = 'admissions_direct'),
  'seven created leads, all converted and without a sales owner');
SELECT pg_temp.n281_assert((SELECT count(*) = 7 FROM platform.student_cases c JOIN platform_private.admissions_direct_case_receipts r
    ON r.student_case_id = c.id WHERE c.organization_id = pg_temp.n281_id(1)), 'seven cases, each with its receipt');
SELECT pg_temp.n281_assert(NOT EXISTS (SELECT 1 FROM platform_private.marketing_cohort(pg_temp.n281_id(1),
    (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE - 1, (statement_timestamp() AT TIME ZONE 'Asia/Bishkek')::DATE + 1)),
  'the marketing cohort does not count them');
SELECT pg_temp.n281_assert(
  has_function_privilege('authenticated', 'platform.create_admissions_student_case_v1(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'platform.create_admissions_student_case_v1(uuid,uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'platform.import_admissions_student_case_v1(uuid,uuid,text,text,jsonb,text)', 'EXECUTE')
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
