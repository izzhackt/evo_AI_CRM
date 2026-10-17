\set ON_ERROR_STOP on
-- Boundary suite for migration 290 («Данные продажи» и направление на деле
-- прямого студента). Members are modelled like production after 155 (as in 244
-- and 281): invited staff have coarse role NULL and get permissions only from
-- scoped role assignments with the production keys.
-- Proves:
--  S snapshot: staff_student_case_read_snapshot keeps its 33 columns in order
--    and gains admissions_direction LAST; the direction equals the case row and
--    the page projection it wraps; it is returned in `full` access only (the
--    Admissions Manager who reads a needs-curator case still gets the row); the
--    function keeps SECURITY DEFINER, empty search_path, STABLE and EXECUTE for
--    authenticated only.
--  R read: staff_student_case_sale_conditions_v1 answers the Admin and the case's
--    own curator with the 32-key shape of staff_lead_sale_conditions_v1 (cost,
--    currency, signing day from the creation); a case created without money
--    returns the blank card (revision 0); a sales-origin case (lead-cabinet)
--    returns NULL even for the Admin, so its lead conditions stay behind the lead
--    right; the money keys are blank for a case reader without finance.read.*
--    while the signing day stays.
--  D denial (42501, nothing leaked): another curator, Sales, the Student, a user
--    without membership, the Admin of another organization, the organization id
--    of another organization, an unknown case, NULL arguments, and the reader of
--    a needs-curator case (248) who lacks case.read.full on the case; anon and
--    service_role have no EXECUTE.
--  P posture: owner, definer, empty search_path, STABLE, ACL.
-- Isolated synthetic SQL fixtures only.
BEGIN;

CREATE FUNCTION pg_temp.n290_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('29000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n290_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N290: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n290_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- The sale-conditions read as the current role.
CREATE FUNCTION pg_temp.n290_read(p_organization UUID, p_case UUID) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n290_error(format('SELECT platform.staff_student_case_sale_conditions_v1(%L, %L)', p_organization, p_case))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n290_id(INTEGER), pg_temp.n290_assert(BOOLEAN, TEXT), pg_temp.n290_error(TEXT),
  pg_temp.n290_read(UUID, UUID) TO authenticated, anon, service_role;

SELECT 'N290_CASE_SALE_CONDITIONS_SUITE_START' AS n290_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture: organization 1 with 1 Admin (system); invited staff with coarse
-- role NULL: 2 Sales Manager, 3 Admissions A (finance.read.summary), 4 Admissions
-- B, 6 Admissions N (no finance key), 7 Admissions Manager (department);
-- 5 Student. Organization 2 has its own Admin (8).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n290_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n290_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, 'admin');
GRANT SELECT ON n290_actors TO authenticated, anon, service_role;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n290_id(1), 'N290 Fictional organization'),
  (pg_temp.n290_id(2), 'N290 Other organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n290_id(100 + n), 'n290-' || n || '@example.invalid', '{}'::JSONB FROM n290_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n290_id(199), 'n290-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n290_id(200 + n), pg_temp.n290_id(100 + n), 'N290 Actor ' || n, 'active', 1 FROM n290_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n290_id(300 + n), CASE WHEN a.n = 8 THEN pg_temp.n290_id(2) ELSE pg_temp.n290_id(1) END,
    pg_temp.n290_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n290_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE
  WHERE id IN (pg_temp.n290_id(301), pg_temp.n290_id(308));
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version) VALUES
  (pg_temp.n290_id(401), pg_temp.n290_id(1), 'organization', pg_temp.n290_id(1), 1),
  (pg_temp.n290_id(402), pg_temp.n290_id(2), 'organization', pg_temp.n290_id(2), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n290_id(1), pg_temp.n290_id(301), pg_temp.n290_id(401), 1, 1, TRUE, 'system',
    'N290 synthetic organization scope', pg_temp.n290_id(601)),
  (pg_temp.n290_id(1), pg_temp.n290_id(305), pg_temp.n290_id(401), 1, 1, TRUE, 'system',
    'N290 synthetic Student organization scope', pg_temp.n290_id(605)),
  (pg_temp.n290_id(2), pg_temp.n290_id(308), pg_temp.n290_id(402), 1, 1, TRUE, 'system',
    'N290 synthetic other-organization scope', pg_temp.n290_id(608));
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n290_id(901), pg_temp.n290_id(1), 'N290 Sales'),
  (pg_temp.n290_id(902), pg_temp.n290_id(1), 'N290 Admissions');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n290_id(1), pg_temp.n290_id(302), pg_temp.n290_id(901)),
  (pg_temp.n290_id(1), pg_temp.n290_id(303), pg_temp.n290_id(902)),
  (pg_temp.n290_id(1), pg_temp.n290_id(304), pg_temp.n290_id(902)),
  (pg_temp.n290_id(1), pg_temp.n290_id(306), pg_temp.n290_id(902)),
  (pg_temp.n290_id(1), pg_temp.n290_id(307), pg_temp.n290_id(902));

-- Roles with the EXACT production permission keys (as 244's suite). Role 1104
-- is Admissions without finance.read.summary and finance.stop.create.
CREATE TEMP TABLE n290_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n290_roles VALUES
 (pg_temp.n290_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n290_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n290_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n290_id(1104), 'Admissions no finance', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1140),
 (pg_temp.n290_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n290_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n290_grants VALUES
 (302, pg_temp.n290_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n290_id(901), 'resourceKind', NULL)),
 (303, pg_temp.n290_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (303, pg_temp.n290_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n290_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n290_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n290_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n290_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n290_id(1104), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n290_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n290_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n290_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n290_id(902), 'resourceKind', NULL)),
 (307, pg_temp.n290_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n290_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n290_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n290_id(1);
GRANT SELECT ON n290_roles, n290_grants, n290_versions TO authenticated;

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n290_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n290_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n290_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n290_admin_setup';
SET LOCAL ROLE authenticated;
DO $n290_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n290_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n290_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N290 ' || r.label, 'description', 'Migration 290 synthetic role',
        'permissionKeys', r.keys), 'N290 create role', pg_temp.n290_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n290_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n290_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N290 publish role', pg_temp.n290_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n290_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n290_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n290_id(1), pg_temp.n290_id(m),
      (SELECT access_version FROM n290_versions WHERE membership_id = pg_temp.n290_id(m)), items, bindings,
      'N290 grant roles', pg_temp.n290_id(2000 + m));
  END LOOP;
END
$n290_roles$;
RESET ROLE;

UPDATE n290_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n290_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n290_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n290_admin FROM n290_actors WHERE n = 1 \gset
SELECT claims AS n290_sales FROM n290_actors WHERE n = 2 \gset
SELECT claims AS n290_a FROM n290_actors WHERE n = 3 \gset
SELECT claims AS n290_b FROM n290_actors WHERE n = 4 \gset
SELECT claims AS n290_student FROM n290_actors WHERE n = 5 \gset
SELECT claims AS n290_n FROM n290_actors WHERE n = 6 \gset
SELECT claims AS n290_manager FROM n290_actors WHERE n = 7 \gset
SELECT claims AS n290_other_admin FROM n290_actors WHERE n = 8 \gset
SELECT jsonb_build_object('sub', pg_temp.n290_id(199), 'role', 'authenticated')::TEXT AS n290_no_member \gset

-- ---------------------------------------------------------------------------
-- Cases, through the real 281 command as the Admin: 1 CN with curator A, cost
-- and a payment; 2 MY with curator N and a cost; 3 MY with no curator and no money.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n290_admin';
SET LOCAL ROLE authenticated;
SELECT platform.create_admissions_student_case_v1(pg_temp.n290_id(1), pg_temp.n290_id(5001), jsonb_build_object(
  'student', jsonb_build_object('name', 'N290 Student One', 'phone', '+996 555 290 001'),
  'route', jsonb_build_object('country', 'CN'),
  'curatorMembershipId', pg_temp.n290_id(303)::TEXT,
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 150000, 'currency', 'USD'), 'signedOn', '2026-09-01',
    'payments', jsonb_build_array(jsonb_build_object('amountMinor', 50000, 'currency', 'USD', 'paidOn', '2026-09-05'))))) AS n290_r1 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n290_id(1), pg_temp.n290_id(5002), jsonb_build_object(
  'student', jsonb_build_object('name', 'N290 Student Two', 'phone', '+996 555 290 002'),
  'route', jsonb_build_object('country', 'MY'),
  'curatorMembershipId', pg_temp.n290_id(306)::TEXT,
  'money', jsonb_build_object('cost', jsonb_build_object('amountMinor', 99000, 'currency', 'USD'), 'signedOn', '2026-09-02'))) AS n290_r2 \gset
SELECT platform.create_admissions_student_case_v1(pg_temp.n290_id(1), pg_temp.n290_id(5003), jsonb_build_object(
  'student', jsonb_build_object('name', 'N290 Student Three', 'phone', '+996 555 290 003'),
  'route', jsonb_build_object('country', 'MY'))) AS n290_r3 \gset
RESET ROLE;
SELECT :'n290_r1'::JSONB ->> 'student_case_id' AS n290_case1, :'n290_r1'::JSONB ->> 'lead_id' AS n290_lead1 \gset
SELECT :'n290_r2'::JSONB ->> 'student_case_id' AS n290_case2, :'n290_r2'::JSONB ->> 'lead_id' AS n290_lead2 \gset
SELECT :'n290_r3'::JSONB ->> 'student_case_id' AS n290_case3, :'n290_r3'::JSONB ->> 'lead_id' AS n290_lead3 \gset
SELECT pg_temp.n290_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n290_id(303)
    AND c.admissions_direction = 'CN' FROM platform.student_cases c WHERE c.id = :'n290_case1'::UUID),
  'fixture: case 1 is active with curator A and direction CN');
SELECT pg_temp.n290_assert((SELECT c.state = 'active' AND c.current_curator_membership_id = pg_temp.n290_id(306)
    AND c.admissions_direction = 'MY' FROM platform.student_cases c WHERE c.id = :'n290_case2'::UUID),
  'fixture: case 2 is active with curator N and direction MY');
SELECT pg_temp.n290_assert((SELECT c.state = 'pending' AND c.current_curator_membership_id IS NULL
    AND c.admissions_direction = 'MY' FROM platform.student_cases c WHERE c.id = :'n290_case3'::UUID),
  'fixture: case 3 waits for a curator with direction MY');
SELECT pg_temp.n290_assert(NOT EXISTS (SELECT 1 FROM platform_private.lead_sale_conditions WHERE lead_id = :'n290_lead3'::UUID),
  'fixture: case 3 has no stored conditions');

-- A sales-origin case (the lead-cabinet origin of 184) with an OPEN lead and
-- stored conditions: the new read must not serve it.
SELECT platform_private.create_or_link_client(pg_temp.n290_id(1), 'N290 Sales Person', 'n290-sales@example.invalid',
  '+996 555 290 999', 'n290-fixture', 'client', 'sales-1', 'staff_recorded', statement_timestamp()) AS n290_sales_client \gset
SELECT platform_private.create_or_link_lead(pg_temp.n290_id(1), :'n290_sales_client'::UUID, NULL, 'new', 'office',
  'n290-fixture', 'lead', 'sales-1', 'staff_recorded', statement_timestamp()) AS n290_sales_lead \gset
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n290_id(411), pg_temp.n290_id(1), 'student_case', pg_temp.n290_id(7001), 1);
INSERT INTO platform.student_cases(id, organization_id, source_key, student_display_name, state, current_scope_id,
  current_scope_version, canonical_client_id, canonical_lead_id)
  VALUES (pg_temp.n290_id(7001), pg_temp.n290_id(1), 'lead-cabinet:' || :'n290_sales_lead', 'N290 Sales Student', 'pending',
    pg_temp.n290_id(411), 1, :'n290_sales_client'::UUID, :'n290_sales_lead'::UUID);
INSERT INTO platform_private.lead_sale_conditions(lead_id, organization_id, fields, revision, updated_by_membership_id)
  VALUES (:'n290_sales_lead'::UUID, pg_temp.n290_id(1), platform_private.lead_sale_condition_fields(jsonb_build_object(
    'service_label', 'N290 sales service', 'service_cost_minor', '777700', 'service_cost_currency', 'USD')), 3, pg_temp.n290_id(302));

-- ---------------------------------------------------------------------------
-- S. The snapshot.
-- ---------------------------------------------------------------------------
SELECT pg_get_function_result('platform.staff_student_case_read_snapshot(uuid)'::regprocedure) AS n290_snapshot_result \gset
SELECT pg_temp.n290_assert(:'n290_snapshot_result' = 'TABLE(access_mode text, sort_at timestamp with time zone, organization_id uuid, student_case_id uuid, student_display_name text, target_country text, target_degree text, program_direction text, intake text, language_assumption text, funding_assumption text, route_approval_status platform.route_approval_status, operational_stage text, state platform.student_case_state, created_at timestamp with time zone, updated_at timestamp with time zone, handoff_at timestamp with time zone, next_action text, responsible_sales_display_name text, current_curator_display_name text, applied_ozo_workflow_contract_version_id uuid, overdue_task_count bigint, overdue_obligation_count bigint, rejected_document_count bigint, student_case_op_handoff_id uuid, op_workflow_contract_version_id uuid, approved_commercial_fields jsonb, unresolved_questions jsonb, promises jsonb, handoff_next_step text, handoff_due_at timestamp with time zone, handoff_responsible_role platform.business_role, handoff_created_at timestamp with time zone, admissions_direction text)',
  'S: the snapshot keeps its 33 columns in order and gains admissions_direction last');

SET LOCAL request.jwt.claims TO :'n290_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert((SELECT s.access_mode = 'full' AND s.admissions_direction = 'CN'
    AND s.student_display_name = 'N290 Student One' AND s.state = 'active' AND s.operational_stage = 'intake'
    AND s.current_curator_display_name = 'N290 Actor 3'
  FROM platform.staff_student_case_read_snapshot(:'n290_case1'::UUID) s), 'S: the Admin reads case 1 with direction CN');
SELECT pg_temp.n290_assert((SELECT s.admissions_direction = 'MY' FROM platform.staff_student_case_read_snapshot(:'n290_case2'::UUID) s),
  'S: case 2 reads with direction MY');
SELECT pg_temp.n290_assert((SELECT s.admissions_direction IS NOT DISTINCT FROM p.admissions_direction
    AND s.sort_at = p.sort_at AND s.target_country = p.target_country AND s.next_action IS NOT DISTINCT FROM p.next_action
  FROM platform.staff_student_case_read_snapshot(:'n290_case1'::UUID) s
  JOIN platform.staff_student_case_page(1, NULL, NULL, NULL, NULL, :'n290_case1'::UUID) p ON p.student_case_id = s.student_case_id),
  'S: the snapshot equals the page projection it wraps');
-- A case without a direction reads NULL, not a guess (sales-origin fixture).
SELECT pg_temp.n290_assert((SELECT s.access_mode = 'full' AND s.admissions_direction IS NULL
  FROM platform.staff_student_case_read_snapshot(pg_temp.n290_id(7001)) s), 'S: a case with no direction reads NULL');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert((SELECT s.access_mode = 'full' AND s.admissions_direction = 'MY'
  FROM platform.staff_student_case_read_snapshot(:'n290_case3'::UUID) s),
  'S: the Admissions Manager reads the needs-curator case 3 in full mode with its direction');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(NOT EXISTS (SELECT 1 FROM platform.staff_student_case_read_snapshot(:'n290_case1'::UUID)),
  'S: Sales without a handoff sees no row of a direct case');
RESET ROLE;
SELECT pg_temp.n290_assert(position('CASE WHEN page.access_mode = ''full'' THEN page.admissions_direction END'
    IN (SELECT prosrc FROM pg_proc WHERE oid = 'platform.staff_student_case_read_snapshot(uuid)'::regprocedure)) > 0,
  'S: the direction is returned in full access only (NULL in sales_summary)');

-- ---------------------------------------------------------------------------
-- R. The read: the Admin and the case's own curator.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n290_keys(k TEXT);
INSERT INTO n290_keys SELECT unnest(ARRAY['organization_id', 'lead_id', 'revision', 'service_label', 'signing_date',
  'service_cost_raw', 'service_cost_minor', 'service_cost_currency', 'paid_raw', 'paid_minor', 'paid_currency',
  'payment_note', 'wishes_countries', 'wishes_study_fields', 'wishes_education_level', 'wishes_intake_year',
  'wishes_intake_season', 'wishes_universities', 'education_current', 'education_grade', 'education_marks',
  'education_english', 'education_certificates', 'conditions_budget_raw', 'conditions_budget_minor',
  'conditions_budget_currency', 'conditions_budget_period', 'conditions_scholarship', 'conditions_note',
  'updated_by_membership_id', 'updated_at', 'linked_sales_register']);
GRANT SELECT ON n290_keys TO authenticated;

SET LOCAL request.jwt.claims TO :'n290_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_student_case_sale_conditions_v1(pg_temp.n290_id(1), :'n290_case1'::UUID) AS n290_admin_c1 \gset
SELECT platform.staff_student_case_sale_conditions_v1(pg_temp.n290_id(1), :'n290_case3'::UUID) AS n290_admin_c3 \gset
SELECT platform.staff_student_case_sale_conditions_v1(pg_temp.n290_id(1), pg_temp.n290_id(7001)) IS NULL AS n290_admin_sales_null \gset
SELECT platform.staff_lead_sale_conditions_v1(pg_temp.n290_id(1), :'n290_lead1'::UUID) AS n290_lead_read \gset
RESET ROLE;
SELECT pg_temp.n290_assert(:'n290_admin_sales_null' = 't',
  'R: a sales-origin case returns NULL even to the Admin, who can read the case');
SELECT pg_temp.n290_assert(NOT EXISTS (SELECT 1 FROM n290_keys k WHERE NOT (:'n290_admin_c1'::JSONB ? k.k))
    AND (SELECT count(*) = 32 FROM jsonb_object_keys(:'n290_admin_c1'::JSONB)),
  'R: the answer has exactly the 32 keys of staff_lead_sale_conditions_v1');
SELECT pg_temp.n290_assert(
    :'n290_admin_c1'::JSONB ->> 'organization_id' = pg_temp.n290_id(1)::TEXT
    AND :'n290_admin_c1'::JSONB ->> 'lead_id' = :'n290_lead1'
    AND :'n290_admin_c1'::JSONB ->> 'revision' = '1'
    AND (:'n290_admin_c1'::JSONB ->> 'service_cost_minor')::BIGINT = 150000
    AND :'n290_admin_c1'::JSONB ->> 'service_cost_currency' = 'USD'
    AND :'n290_admin_c1'::JSONB ->> 'signing_date' = '2026-09-01'
    AND :'n290_admin_c1'::JSONB ->> 'updated_by_membership_id' = pg_temp.n290_id(301)::TEXT
    AND :'n290_admin_c1'::JSONB -> 'linked_sales_register' = 'null'::JSONB
    AND :'n290_admin_c1'::JSONB ->> 'paid_raw' = '' AND :'n290_admin_c1'::JSONB -> 'paid_minor' = 'null'::JSONB,
  'R: the creation''s cost, currency and signing day come back for the Admin (payments are events, not conditions)');
SELECT pg_temp.n290_assert((SELECT bool_and(v = '""'::JSONB OR v = 'null'::JSONB)
    FROM jsonb_each(:'n290_admin_c1'::JSONB) AS e(k, v)
    WHERE e.k IN ('wishes_countries', 'wishes_study_fields', 'wishes_education_level', 'wishes_intake_year', 'wishes_intake_season',
      'wishes_universities', 'education_current', 'education_grade', 'education_marks', 'education_english',
      'education_certificates', 'conditions_budget_raw', 'conditions_budget_minor', 'conditions_budget_currency',
      'conditions_budget_period', 'conditions_scholarship', 'conditions_note')),
  'R: the keys nobody filled are blank or null');
SELECT pg_temp.n290_assert(:'n290_admin_c1'::JSONB - 'updated_at' = :'n290_lead_read'::JSONB - 'updated_at' - 'linked_sales_register'
    || '{"linked_sales_register": null}'::JSONB,
  'R: the shape and values equal what staff_lead_sale_conditions_v1 returns for the same lead');
SELECT pg_temp.n290_assert(:'n290_admin_c3'::JSONB ->> 'revision' = '0'
    AND :'n290_admin_c3'::JSONB ->> 'lead_id' = :'n290_lead3' AND :'n290_admin_c3'::JSONB -> 'signing_date' = 'null'::JSONB
    AND :'n290_admin_c3'::JSONB ->> 'service_label' = '' AND (SELECT count(*) = 32 FROM jsonb_object_keys(:'n290_admin_c3'::JSONB)),
  'R: a case created without money returns the blank card (revision 0) in the same shape');

SET LOCAL request.jwt.claims TO :'n290_a';
SET LOCAL ROLE authenticated;
SELECT platform.staff_student_case_sale_conditions_v1(pg_temp.n290_id(1), :'n290_case1'::UUID) AS n290_a_c1 \gset
RESET ROLE;
SELECT pg_temp.n290_assert(:'n290_a_c1'::JSONB = :'n290_admin_c1'::JSONB,
  'R: the case''s own curator with finance.read.summary gets the same answer as the Admin');

-- The curator without finance keys: cost and payment stay blank, the signing day stays.
SET LOCAL request.jwt.claims TO :'n290_n';
SET LOCAL ROLE authenticated;
SELECT platform.staff_student_case_sale_conditions_v1(pg_temp.n290_id(1), :'n290_case2'::UUID) AS n290_n_c2 \gset
SELECT platform.staff_case_access_snapshot(pg_temp.n290_id(1), :'n290_case2'::UUID) AS n290_n_access \gset
RESET ROLE;
SELECT pg_temp.n290_assert(NOT (:'n290_n_access'::JSONB ->> 'finance')::BOOLEAN,
  'R: fixture: curator N has no finance section on its case');
SELECT pg_temp.n290_assert(:'n290_n_c2'::JSONB -> 'service_cost_minor' = 'null'::JSONB
    AND :'n290_n_c2'::JSONB -> 'service_cost_currency' = 'null'::JSONB AND :'n290_n_c2'::JSONB ->> 'service_cost_raw' = ''
    AND :'n290_n_c2'::JSONB -> 'paid_minor' = 'null'::JSONB AND :'n290_n_c2'::JSONB ->> 'paid_raw' = ''
    AND :'n290_n_c2'::JSONB ->> 'payment_note' = ''
    AND :'n290_n_c2'::JSONB ->> 'signing_date' = '2026-09-02' AND :'n290_n_c2'::JSONB ->> 'revision' = '1'
    AND (SELECT count(*) = 32 FROM jsonb_object_keys(:'n290_n_c2'::JSONB)),
  'R: without a finance section the money keys are blank; the signing day and the shape stay');

-- ---------------------------------------------------------------------------
-- D. Denials: 42501, nothing leaked.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n290_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: another curator (own scope, not this case) is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_sales';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: the Sales Manager (case.read.summary only) is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: the Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: a user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_other_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: the Admin of another organization is refused for this organization');
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(2), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: the Admin of another organization is refused with its own organization id');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n290_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(2), :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden',
  'D: the Admin asking with another organization id is refused');
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), pg_temp.n290_id(9999)) = '42501:case_sale_conditions_forbidden',
  'D: an unknown case is refused like any other, no existence leak');
SELECT pg_temp.n290_assert(pg_temp.n290_read(NULL, :'n290_case1'::UUID) = '42501:case_sale_conditions_forbidden'
    AND pg_temp.n290_read(pg_temp.n290_id(1), NULL) = '42501:case_sale_conditions_forbidden',
  'D: NULL arguments are refused');
RESET ROLE;
-- The reader of a needs-curator case (248): reads the case, has no case.read.full on it.
SET LOCAL request.jwt.claims TO :'n290_manager';
SET LOCAL ROLE authenticated;
SELECT private.platform_can_read_student_case(pg_temp.n290_id(1), :'n290_case3'::UUID) AS n290_manager_reads \gset
SELECT pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case3'::UUID) AS n290_manager_sale \gset
RESET ROLE;
SELECT platform_private.staff_can_access_for_actor(pg_temp.n290_id(1), 'case.read.full', 'student_case', :'n290_case3'::UUID)
  AS n290_manager_full \gset
SELECT pg_temp.n290_assert(:'n290_manager_reads' = 't' AND :'n290_manager_full' = 'f',
  'D: fixture: the manager reads case 3 through the 248 rule, not through case.read.full');
SELECT pg_temp.n290_assert(:'n290_manager_sale' = '42501:case_sale_conditions_forbidden',
  'D: the needs-curator reader gets no sale conditions (the case page closes its finance and contract sections)');
-- anon and service_role cannot even call it.
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SET LOCAL ROLE anon;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) LIKE '42501:permission denied for %',
  'D: anon has no EXECUTE');
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SET LOCAL ROLE service_role;
SELECT pg_temp.n290_assert(pg_temp.n290_read(pg_temp.n290_id(1), :'n290_case1'::UUID) LIKE '42501:permission denied for %',
  'D: service_role has no EXECUTE');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- P. Posture of the two functions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n290_assert((SELECT bool_and(p.proowner = 'postgres'::regrole AND p.prosecdef AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=""'] AND p.proacl::TEXT = '{postgres=X/postgres,authenticated=X/postgres}'
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    FROM pg_proc p WHERE p.oid IN ('platform.staff_student_case_read_snapshot(uuid)'::regprocedure,
      'platform.staff_student_case_sale_conditions_v1(uuid,uuid)'::regprocedure)),
  'P: both functions are postgres-owned SECURITY DEFINER STABLE with an empty search_path, EXECUTE for authenticated only');
SELECT pg_temp.n290_assert((SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'platform_private', 'private') AND p.proname = 'staff_student_case_sale_conditions_v1'),
  'P: the client-callable read lives only in platform');
SELECT pg_temp.n290_assert((SELECT count(*) = 0 FROM pg_proc p WHERE p.proname = 'staff_student_case_read_snapshot'
    AND p.oid <> 'platform.staff_student_case_read_snapshot(uuid)'::regprocedure),
  'P: no second overload of the snapshot appeared');

SELECT 'N290_CASE_SALE_CONDITIONS_SUITE_PASSED' AS n290_suite_marker;
ROLLBACK;
