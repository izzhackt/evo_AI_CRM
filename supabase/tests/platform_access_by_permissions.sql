\set ON_ERROR_STOP on
-- Boundary suite for migration 244 (access by role permissions for invited
-- staff). Members are modelled EXACTLY like production after 155: invited
-- staff have organization_memberships.current_role NULL and current_bundle_id
-- NULL, so current_actor_authority().platform_role is NULL and the JWT says
-- 'staff'; permissions come only from scoped role assignments with the
-- production permission keys (26.09 read-only audit): Admissions (35 keys, own
-- scope), Admissions Manager (36 keys, department scope), Sales Manager
-- (23 keys, department scope) and the two «общие разделы» roles
-- (organization scope). Only the system Admin carries the coarse role.
-- Proves: board moves by permission and per case, curator assignment works
-- again for the Admin only, requirements save for document.manage holders,
-- lead cabinet preparation for the Sales Manager on accessible leads only,
-- deletion requests for the Admin only, and board/queue/counts/summary reads
-- unchanged for staff and refused for students and anonymous callers.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action. Style follows
-- platform_case_next_action_queue.sql (241).
BEGIN;

DO $n244_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n244_auth_role$;

CREATE FUNCTION pg_temp.n244_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24400000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n244_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N244: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n244_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Sorted case ids of a JSONB rows array.
CREATE FUNCTION pg_temp.n244_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n244_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.n244_id(x) ORDER BY pg_temp.n244_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_id(INTEGER), pg_temp.n244_assert(BOOLEAN, TEXT),
  pg_temp.n244_error(TEXT), pg_temp.n244_case_ids(JSONB), pg_temp.n244_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N244_ACCESS_BY_PERMISSIONS_SUITE_START' AS n244_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (sales department A), 3 Admissions Manager, 4 Admissions A,
-- 6 Admissions B (admissions department), 7 Sales Manager (sales department
-- B); 5 Student (case 505), 8 Student B (the declined case 504).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n244_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n244_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, 'student');
GRANT SELECT ON n244_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n244_id(1), 'N244 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n244_id(100 + n), 'n244-' || n || '@example.invalid', '{}'::JSONB FROM n244_actors;
-- An authenticated identity with no membership at all.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n244_id(199), 'n244-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n244_id(200 + n), pg_temp.n244_id(100 + n), 'N244 Actor ' || n, 'active', 1 FROM n244_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n244_id(300 + n), pg_temp.n244_id(1), pg_temp.n244_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n244_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n244_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n244_id(401), pg_temp.n244_id(1), 'organization', pg_temp.n244_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n244_id(1), pg_temp.n244_id(301), pg_temp.n244_id(401), 1, 1, TRUE, 'system',
    'N244 synthetic organization scope', pg_temp.n244_id(601));

-- Departments in the production shape: sales A (2), sales B (7), admissions (3, 4, 6).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n244_id(901), pg_temp.n244_id(1), 'N244 Sales A'),
  (pg_temp.n244_id(902), pg_temp.n244_id(1), 'N244 Admissions'),
  (pg_temp.n244_id(903), pg_temp.n244_id(1), 'N244 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n244_id(1), pg_temp.n244_id(302), pg_temp.n244_id(901)),
  (pg_temp.n244_id(1), pg_temp.n244_id(303), pg_temp.n244_id(902)),
  (pg_temp.n244_id(1), pg_temp.n244_id(304), pg_temp.n244_id(902)),
  (pg_temp.n244_id(1), pg_temp.n244_id(306), pg_temp.n244_id(902)),
  (pg_temp.n244_id(1), pg_temp.n244_id(307), pg_temp.n244_id(903));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin (outside the admissions department); 504 pending after a sale
-- whose curator declined (handoff evidence, portal already activated for
-- Student B, needs a curator); 505 active, curator A, the Student's own case
-- with an activated portal.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n244_id(420 + k), pg_temp.n244_id(1), 'student_case', pg_temp.n244_id(500 + k), 1
  FROM generate_series(1, 5) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.n244_id(500 + f.k), pg_temp.n244_id(1), pg_temp.n244_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n244_id(f.curator) END,
  'synthetic:n244:' || f.k, 'N244 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  pg_temp.n244_id(420 + f.k), 1, 'new',
  CASE f.k WHEN 5 THEN pg_temp.n244_id(305) WHEN 4 THEN pg_temp.n244_id(308) END,
  CASE WHEN f.k IN (4, 5) THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, NULL, 'pending'), (5, 304, 'active'))
  AS f(k, curator, state);
-- Clients and leads: 702 owned by Sales Manager A (2), 704 owned by Sales
-- Manager B (7), 706 (A) carries the sale of the pending case 504.
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.n244_id(701), pg_temp.n244_id(1), 'N244 Client A', platform_private.normalize_person_name('N244 Client A')),
  (pg_temp.n244_id(703), pg_temp.n244_id(1), 'N244 Client B', platform_private.normalize_person_name('N244 Client B')),
  (pg_temp.n244_id(705), pg_temp.n244_id(1), 'N244 Client C', platform_private.normalize_person_name('N244 Client C'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.n244_id(702), pg_temp.n244_id(1), pg_temp.n244_id(701), pg_temp.n244_id(302), 'new', 'website'),
  (pg_temp.n244_id(704), pg_temp.n244_id(1), pg_temp.n244_id(703), pg_temp.n244_id(307), 'new', 'website'),
  (pg_temp.n244_id(706), pg_temp.n244_id(1), pg_temp.n244_id(705), pg_temp.n244_id(302), 'new', 'website');
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links)
VALUES (pg_temp.n244_id(1), pg_temp.n244_id(706), pg_temp.n244_id(705), pg_temp.n244_id(504),
  'canonical-lead:' || pg_temp.n244_id(706)::TEXT, 'normal', 'N244 synthetic sale handoff',
  pg_temp.n244_id(302), pg_temp.n244_id(202), pg_temp.n244_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB);
-- A catalogue-bound application in preparation on 505 for the requirements editor.
INSERT INTO platform.catalog_institutions(id, organization_id, institution_kind, institution_name, country_code,
  city, source_registry_id, source_revision, import_batch_id, source_record_key, approved_by_membership_id)
VALUES (pg_temp.n244_id(801), pg_temp.n244_id(1), 'university', 'N244 University', 'MY', NULL,
  pg_temp.n244_id(821), 'synthetic-n244-rev', pg_temp.n244_id(831), 'rec_' || repeat('d', 32), pg_temp.n244_id(301));
INSERT INTO platform_private.university_catalog_publications(id, organization_id, institution_id, base_version, version,
  content, source_registry_id, status, reason, created_by_membership_id, reviewed_by_membership_id, reviewed_at)
VALUES (pg_temp.n244_id(811), pg_temp.n244_id(1), pg_temp.n244_id(801), 0, 1, jsonb_build_object(
    'name', 'N244 University', 'country', 'MY', 'city', NULL, 'overview', 'N244 synthetic overview',
    'websiteUrl', 'https://university.example-n244.edu', 'sourceUrl', 'https://university.example-n244.edu/admissions',
    'verifiedOn', '2026-09-26', 'notes', '', 'photoKey', NULL,
    'programs', jsonb_build_array(jsonb_build_object(
      'id', 'cs', 'title', 'N244 computer science', 'level', 'bachelor', 'duration', NULL, 'language', NULL,
      'summary', 'N244 synthetic program', 'sourceUrl', 'https://university.example-n244.edu/programs/cs',
      'intakes', jsonb_build_array(jsonb_build_object(
        'id', pg_temp.n244_id(841)::TEXT, 'label', 'September intake', 'startDate', '2027-09-01',
        'startMonth', '2027-09', 'applicationDeadline', '2027-06-30', 'deadlineTime', NULL, 'timezone', NULL,
        'status', 'open', 'note', '', 'sourceUrl', 'https://university.example-n244.edu/admissions',
        'verifiedOn', '2026-09-26'))))),
  pg_temp.n244_id(821), 'published', 'N244 synthetic review', pg_temp.n244_id(301), pg_temp.n244_id(301), clock_timestamp());
INSERT INTO platform.university_applications(id, organization_id, student_case_id, institution_name, program_name,
  status, created_by_membership_id, catalog_institution_id, version, is_primary, university_deadline_on, country, degree)
VALUES (pg_temp.n244_id(851), pg_temp.n244_id(1), pg_temp.n244_id(505), 'N244 University', 'N244 computer science',
  'preparation', pg_temp.n244_id(301), pg_temp.n244_id(801), 1, FALSE, DATE '2027-06-30', 'MY', 'bachelor');
INSERT INTO platform_private.catalog_preparation_bindings(organization_id, student_case_id, application_id,
  institution_id, publication_id, program_id, intake_id, selected_at, deadline_state_at_selection)
VALUES (pg_temp.n244_id(1), pg_temp.n244_id(505), pg_temp.n244_id(851), pg_temp.n244_id(801),
  pg_temp.n244_id(811), 'cs', pg_temp.n244_id(841), clock_timestamp(), 'confirmed');
SET LOCAL session_replication_role = origin;
-- The Student signs in to the organization and reads only the own case
-- (student_case scope of 505), the provisioned portal shape.
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n244_id(1), pg_temp.n244_id(305), pg_temp.n244_id(401), 1, 1, TRUE, 'system',
    'N244 synthetic Student organization scope', pg_temp.n244_id(604)),
  (pg_temp.n244_id(1), pg_temp.n244_id(305), pg_temp.n244_id(425), 1, 1, TRUE, 'system',
    'N244 synthetic Student case scope', pg_temp.n244_id(605));

-- Roles with the EXACT production permission keys (26.09 read-only audit).
CREATE TEMP TABLE n244_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n244_roles VALUES
 (pg_temp.n244_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n244_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n244_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n244_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n244_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n244_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n244_grants VALUES
 (302, pg_temp.n244_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n244_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n244_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n244_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n244_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n244_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n244_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n244_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n244_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n244_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n244_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n244_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n244_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n244_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n244_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n244_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n244_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n244_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n244_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n244_id(1);
GRANT SELECT ON n244_roles, n244_grants, n244_versions TO authenticated;

SELECT pg_temp.n244_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n244_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n244_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n244_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n244_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n244_admin_setup';
SET LOCAL ROLE authenticated;
DO $n244_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n244_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n244_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N244 ' || r.label, 'description', 'Migration 244 synthetic role',
        'permissionKeys', r.keys), 'N244 create role', pg_temp.n244_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n244_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n244_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N244 publish role', pg_temp.n244_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n244_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n244_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n244_id(1), pg_temp.n244_id(m),
      (SELECT access_version FROM n244_versions WHERE membership_id = pg_temp.n244_id(m)), items, bindings,
      'N244 grant roles', pg_temp.n244_id(2000 + m));
  END LOOP;
END
$n244_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions, all minted
-- by the installed token hook (staff and Student).
UPDATE n244_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n244_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n244_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n244_admin FROM n244_actors WHERE n = 1 \gset
SELECT claims AS n244_sales_manager FROM n244_actors WHERE n = 2 \gset
SELECT claims AS n244_admissions_manager FROM n244_actors WHERE n = 3 \gset
SELECT claims AS n244_admissions_a FROM n244_actors WHERE n = 4 \gset
SELECT claims AS n244_student FROM n244_actors WHERE n = 5 \gset
SELECT claims AS n244_admissions_b FROM n244_actors WHERE n = 6 \gset
SELECT claims AS n244_sales_manager_b FROM n244_actors WHERE n = 7 \gset
SELECT jsonb_build_object('sub', pg_temp.n244_id(199), 'role', 'authenticated')::TEXT AS n244_no_member \gset
SELECT pg_temp.n244_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n244_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'student'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n244_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n244_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n244_ids(302, 303, 304, 306, 307))), 'invited members have coarse role and bundle NULL');

-- Each invited member resolves with coarse role NULL.
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((SELECT count(*) = 1 AND bool_and(platform_role IS NULL AND membership_id = pg_temp.n244_id(304))
  FROM platform.current_actor_authority()), 'Admissions A resolves with platform_role NULL');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. Reads stay as they were for staff; students and anonymous are refused.
-- Visibility is the per-row case.read.full scope, compared with the helper.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n244_expected_board(n INTEGER, ids UUID[]);
INSERT INTO n244_expected_board VALUES
  (1, pg_temp.n244_ids(501, 502, 503, 505)),
  (3, pg_temp.n244_ids(501, 502, 505)),
  (4, pg_temp.n244_ids(501, 505)),
  (6, pg_temp.n244_ids(502));
GRANT SELECT ON n244_expected_board TO authenticated;
CREATE FUNCTION pg_temp.n244_reads_unchanged(p_n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE expected UUID[] := (SELECT ids FROM n244_expected_board WHERE n = p_n);
  by_helper UUID[]; board JSONB; queue JSONB; counts JSONB; summary JSONB;
BEGIN
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), ARRAY[]::UUID[]) INTO by_helper FROM platform.student_cases c
    WHERE c.organization_id = pg_temp.n244_id(1) AND c.state = 'active' AND c.pipeline_hidden_at IS NULL
      AND private.platform_can_read_student_case(c.organization_id, c.id);
  PERFORM pg_temp.n244_assert(by_helper = expected, 'actor ' || p_n || ': fixture visibility is the expected set');
  board := platform.staff_admissions_pipeline_board_v1();
  PERFORM pg_temp.n244_assert(pg_temp.n244_case_ids(board -> 'rows') = expected, 'actor ' || p_n || ': board rows = visible active cases');
  queue := platform.staff_student_case_queue_v1('active', 100);
  PERFORM pg_temp.n244_assert(pg_temp.n244_case_ids(queue -> 'rows') = expected, 'actor ' || p_n || ': queue rows = visible active cases');
  counts := platform.staff_student_case_queue_counts_v1('active');
  PERFORM pg_temp.n244_assert((counts -> 'views' ->> 'active')::INTEGER = cardinality(expected),
    'actor ' || p_n || ': active count equals rows');
  summary := platform.admissions_direction_summary_v1();
  PERFORM pg_temp.n244_assert((SELECT COALESCE(sum((s ->> 'active')::INTEGER), 0) FROM jsonb_array_elements(summary -> 'stock') s)
    = cardinality(expected), 'actor ' || p_n || ': direction summary counts the visible active cases');
END
$$;
CREATE FUNCTION pg_temp.n244_reads_refused(p_label TEXT, p_expected TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.n244_assert(pg_temp.n244_error('SELECT platform.staff_admissions_pipeline_board_v1()') LIKE p_expected,
    p_label || ': board read refused');
  PERFORM pg_temp.n244_assert(pg_temp.n244_error($q$SELECT platform.staff_student_case_queue_v1('active', 100)$q$) LIKE p_expected,
    p_label || ': queue read refused');
  PERFORM pg_temp.n244_assert(pg_temp.n244_error($q$SELECT platform.staff_student_case_queue_counts_v1('active')$q$) LIKE p_expected,
    p_label || ': counts read refused');
  PERFORM pg_temp.n244_assert(pg_temp.n244_error('SELECT platform.admissions_direction_summary_v1()') LIKE p_expected,
    p_label || ': direction summary refused');
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_reads_unchanged(INTEGER), pg_temp.n244_reads_refused(TEXT, TEXT)
  TO authenticated, anon;

SET LOCAL request.jwt.claims TO :'n244_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_unchanged(1);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_unchanged(3);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_unchanged(4);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_unchanged(6);
RESET ROLE;
-- Sales Manager: no case.read.full, refused before and after 244.
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_refused('Sales Manager', '42501:Staff admissions authority required');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((SELECT count(*) = 1 AND bool_and(platform_role = 'student')
  FROM platform.current_actor_authority()), 'the Student resolves as student');
SELECT pg_temp.n244_reads_refused('Student', '42501:Staff admissions authority required');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_reads_refused('authenticated without membership', '42501:Staff admissions authority required');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n244_reads_refused('anon', '42501:permission denied for %');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Board moves: staff with case.update.append on the case.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT platform.move_case_pipeline_v1(pg_temp.n244_id(1), pg_temp.n244_id(501), 'documents', FALSE,
  pg_temp.n244_id(3001)) AS n244_move_a \gset
SELECT pg_temp.n244_assert(:'n244_move_a'::JSONB = jsonb_build_object('student_case_id', pg_temp.n244_id(501),
  'pipeline_stage', 'documents', 'pipeline_hidden', FALSE, 'request_id', pg_temp.n244_id(3001)),
  'Admissions A moves the own case (was case_pipeline_forbidden before 244)');
SELECT pg_temp.n244_assert(platform.move_case_pipeline_v1(pg_temp.n244_id(1), pg_temp.n244_id(501), 'documents', FALSE,
  pg_temp.n244_id(3001)) = :'n244_move_a'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(502), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'Admissions A cannot move the case of Admissions B (own scope)');
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(503), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'Admissions A cannot move the Admin''s case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((platform.move_case_pipeline_v1(pg_temp.n244_id(1), pg_temp.n244_id(502), 'shortlist', FALSE,
  pg_temp.n244_id(3002)) ->> 'pipeline_stage') = 'shortlist', 'Admissions Manager moves a department case');
SELECT pg_temp.n244_assert((platform.move_case_pipeline_v1(pg_temp.n244_id(1), pg_temp.n244_id(505), NULL, TRUE,
  pg_temp.n244_id(3003)) ->> 'pipeline_hidden')::BOOLEAN, 'Admissions Manager removes a department case from the board');
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(503), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'Admissions Manager cannot move a case outside the department');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(501), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'Sales Manager cannot move (no case.update.append), even the case it sold');
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'bogus', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(501), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'Sales Manager is refused before input validation, as before 244');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(505), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'the Student cannot move the own case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(501), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'an authenticated user without membership cannot move');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n244_id(1), pg_temp.n244_id(501), gen_random_uuid())) LIKE '42501:permission denied for %',
  'anon cannot execute the move');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((platform.move_case_pipeline_v1(pg_temp.n244_id(1), pg_temp.n244_id(503), 'visa', FALSE,
  pg_temp.n244_id(3004)) ->> 'pipeline_stage') = 'visa', 'the Admin still moves any case');
RESET ROLE;
SELECT pg_temp.n244_assert((SELECT array_agg(pipeline_stage || ':' || (pipeline_hidden_at IS NOT NULL)::TEXT ORDER BY id)
  FROM platform.student_cases WHERE id = ANY (pg_temp.n244_ids(501, 502, 503, 505)))
  = ARRAY['documents:false', 'shortlist:false', 'visa:false', 'new:true'], 'only the allowed moves changed the board');
SELECT pg_temp.n244_assert((SELECT array_agg(actor_profile_id ORDER BY request_id) FROM platform.audit_events
  WHERE action = 'case.pipeline.move' AND organization_id = pg_temp.n244_id(1))
  = ARRAY[pg_temp.n244_id(204), pg_temp.n244_id(203), pg_temp.n244_id(203), pg_temp.n244_id(201)],
  'each allowed move is journaled once under its actor');

-- ---------------------------------------------------------------------------
-- 3. Curator assignment works again, still for the Admin only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n244_assign(p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n244_error(format($q$SELECT platform.assign_case_curator_v1(%L, %L, %L, %L, 'N244 assign curator')$q$,
    pg_temp.n244_id(1), pg_temp.n244_id(p_request), pg_temp.n244_id(504), pg_temp.n244_id(304)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_assign(INTEGER) TO authenticated, anon;
SELECT pg_temp.n244_assert(platform_private.staff_has_permission(pg_temp.n244_id(1), pg_temp.n244_id(303), 'case.curator.assign'),
  'fixture: Admissions Manager holds case.curator.assign');
SET LOCAL request.jwt.claims TO :'n244_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3101) = '42501:System Admin is required',
  'Admissions Manager is not widened to assign (owner decision B)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3102) = '42501:System Admin is required', 'Admissions cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3103) = '42501:System Admin is required', 'Sales Manager cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3104) = '42501:System Admin is required', 'the Student cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3105) LIKE '42501:permission denied for %', 'anon cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admin';
SET LOCAL ROLE authenticated;
SELECT platform.assign_case_curator_v1(pg_temp.n244_id(1), pg_temp.n244_id(3106), pg_temp.n244_id(504),
  pg_temp.n244_id(304), 'N244 assign curator') AS n244_assign_receipt \gset
SELECT pg_temp.n244_assert(:'n244_assign_receipt'::JSONB ->> 'assignment_type' = 'assigned'
  AND :'n244_assign_receipt'::JSONB ->> 'case_state' = 'active'
  AND :'n244_assign_receipt'::JSONB ->> 'curator_membership_id' = pg_temp.n244_id(304)::TEXT,
  'the Admin assigns an invited Admissions member as curator (was 42883 before 244)');
SELECT pg_temp.n244_assert(platform.assign_case_curator_v1(pg_temp.n244_id(1), pg_temp.n244_id(3106), pg_temp.n244_id(504),
  pg_temp.n244_id(304), 'N244 assign curator') = :'n244_assign_receipt'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n244_assert(pg_temp.n244_assign(3107) = '55000:Case does not need a curator assignment',
  'an assigned case no longer needs a curator');
RESET ROLE;
SELECT pg_temp.n244_assert((SELECT state = 'active' AND current_curator_membership_id = pg_temp.n244_id(304)
  FROM platform.student_cases WHERE id = pg_temp.n244_id(504)), 'the case is active with the assigned curator');
SELECT pg_temp.n244_assert((SELECT count(*) = 1 FROM platform.audit_events
  WHERE action = 'case.curator.set' AND resource_id = pg_temp.n244_id(504)), 'the assignment is journaled once');

-- ---------------------------------------------------------------------------
-- 4. Requirements editor save for document.manage holders (the real save).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n244_requirements_save(p_request INTEGER) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE context JSONB;
BEGIN
  context := platform.staff_application_requirements_editor_v1(pg_temp.n244_id(505), pg_temp.n244_id(851));
  PERFORM pg_temp.n244_assert((context ->> 'canSave')::BOOLEAN, 'the editor offers save');
  RETURN platform.staff_save_application_requirements_v1(pg_temp.n244_id(505), pg_temp.n244_id(851),
    pg_temp.n244_id(p_request), jsonb_build_object(
      'expectedContextHash', context ->> 'contextHash',
      'expectedApplicationVersion', context ->> 'applicationVersion',
      'expectedRevisionId', context -> 'requirements' -> 'revisionId',
      'expectedRevisionVersion', context -> 'requirements' -> 'revisionVersion',
      'changeReason', 'N244 synthetic requirement',
      'sourceDecisions', '[]'::JSONB,
      'items', jsonb_build_array(jsonb_build_object(
        'requirementKey', 'r.' || pg_temp.n244_id(p_request + 50)::TEXT, 'required', TRUE,
        'label', 'N244 passport copy', 'groupLabel', 'N244 identity', 'instructions', 'N244 colour scan',
        'deadline', NULL,
        'material', jsonb_build_object('kind', 'new', 'label', 'N244 passport copy', 'groupLabel', 'N244 identity'),
        'provenance', jsonb_build_object('kind', 'staff_entry', 'sourceKey', NULL, 'basis', 'N244 staff entry')))));
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_requirements_save(INTEGER) TO authenticated;

SAVEPOINT n244_requirements_a;
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_requirements_save(3201) AS n244_requirements_a \gset
SELECT pg_temp.n244_assert(:'n244_requirements_a'::JSONB ->> 'revisionVersion' = '1'
  AND jsonb_array_length(:'n244_requirements_a'::JSONB -> 'items') = 1
  AND :'n244_requirements_a'::JSONB ->> 'requestId' = pg_temp.n244_id(3201)::TEXT,
  'Admissions A (document.manage, own case) saves the requirements (was refused before 244)');
RESET ROLE;
SELECT pg_temp.n244_assert((SELECT created_by_membership_id = pg_temp.n244_id(304)
  FROM platform_private.application_requirement_revisions WHERE application_id = pg_temp.n244_id(851)),
  'the revision is authored by Admissions A');
ROLLBACK TO SAVEPOINT n244_requirements_a;

SAVEPOINT n244_requirements_manager;
SET LOCAL request.jwt.claims TO :'n244_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_requirements_save(3202) ->> 'revisionVersion' = '1',
  'Admissions Manager (document.manage, department case) saves the requirements');
RESET ROLE;
ROLLBACK TO SAVEPOINT n244_requirements_manager;

CREATE FUNCTION pg_temp.n244_requirements_refusal(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n244_error(format($q$SELECT platform.staff_save_application_requirements_v1(%L, %L, %L, '{}'::JSONB)$q$,
    pg_temp.n244_id(p_case), pg_temp.n244_id(851), gen_random_uuid()))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_requirements_refusal(INTEGER) TO authenticated;
SET LOCAL request.jwt.claims TO :'n244_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_requirements_refusal(505) = '42501:application_requirements_unavailable',
  'Admissions B cannot save the requirements of another curator''s case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_requirements_refusal(505) = '42501:application_requirements_unavailable',
  'Sales Manager (no document.manage) cannot save the requirements');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_requirements_refusal(505) = '42501:application_requirements_unavailable',
  'the Student cannot use the staff requirements save');
RESET ROLE;
SELECT pg_temp.n244_assert(NOT EXISTS (SELECT 1 FROM platform_private.application_requirement_revisions
  WHERE organization_id = pg_temp.n244_id(1)), 'no refused or rolled-back save left a revision');

-- ---------------------------------------------------------------------------
-- 5. «Подготовить кабинет»: lead.sales.workflow.manage on the lead decides.
-- ---------------------------------------------------------------------------
SELECT count(*) AS n244_memberships_before FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n244_id(1) \gset
SELECT pg_temp.n244_assert(platform_private.staff_can_access(pg_temp.n244_id(1), pg_temp.n244_id(302),
    'lead.sales.workflow.manage', 'lead', pg_temp.n244_id(702))
  AND NOT platform_private.staff_can_access(pg_temp.n244_id(1), pg_temp.n244_id(302),
    'lead.sales.workflow.manage', 'lead', pg_temp.n244_id(704)),
  'fixture: Sales Manager A reaches the own department lead only');
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT platform.prepare_lead_cabinet_v1(pg_temp.n244_id(1), pg_temp.n244_id(3301), pg_temp.n244_id(702)) AS n244_cabinet \gset
SELECT pg_temp.n244_assert(:'n244_cabinet'::JSONB ->> 'state' = 'pending'
  AND :'n244_cabinet'::JSONB ->> 'lead_id' = pg_temp.n244_id(702)::TEXT
  AND :'n244_cabinet'::JSONB ->> 'actor_membership_id' = pg_temp.n244_id(302)::TEXT,
  'Sales Manager prepares the cabinet of an accessible lead (was lead_cabinet_forbidden before 244)');
SELECT pg_temp.n244_assert(platform.prepare_lead_cabinet_v1(pg_temp.n244_id(1), pg_temp.n244_id(3301),
  pg_temp.n244_id(702)) = :'n244_cabinet'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n244_assert(pg_temp.n244_error(format('SELECT platform.prepare_lead_cabinet_v1(%L, %L, %L)',
  pg_temp.n244_id(1), gen_random_uuid(), pg_temp.n244_id(704))) = '42501:lead_cabinet_forbidden',
  'Sales Manager cannot prepare the cabinet of a lead in another department');
RESET ROLE;
SELECT pg_temp.n244_assert((SELECT source_key = 'lead-cabinet:' || pg_temp.n244_id(702)::TEXT AND state = 'pending'
    AND responsible_sales_membership_id = pg_temp.n244_id(302) AND current_curator_membership_id IS NULL
    AND student_membership_id IS NULL
  FROM platform.student_cases WHERE id = (:'n244_cabinet'::JSONB ->> 'student_case_id')::UUID),
  'the prepared cabinet is the pending, curator-less case without a portal member');
SELECT pg_temp.n244_assert((SELECT count(*) FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n244_id(1)) = :n244_memberships_before,
  'preparing a cabinet provisions no portal membership (invites stay separate, owner decision C)');
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format('SELECT platform.prepare_lead_cabinet_v1(%L, %L, %L)',
  pg_temp.n244_id(1), gen_random_uuid(), pg_temp.n244_id(704))) = '42501:lead_cabinet_forbidden',
  'Admissions (lead.read only) cannot prepare a cabinet');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format('SELECT platform.prepare_lead_cabinet_v1(%L, %L, %L)',
  pg_temp.n244_id(1), gen_random_uuid(), pg_temp.n244_id(704))) = '42501:lead_cabinet_forbidden',
  'the Student cannot prepare a cabinet');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n244_assert(pg_temp.n244_error(format('SELECT platform.prepare_lead_cabinet_v1(%L, %L, %L)',
  pg_temp.n244_id(1), gen_random_uuid(), pg_temp.n244_id(704))) LIKE '42501:permission denied for %',
  'anon cannot prepare a cabinet');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((platform.prepare_lead_cabinet_v1(pg_temp.n244_id(1), pg_temp.n244_id(3302),
  pg_temp.n244_id(704)) ->> 'state') = 'pending', 'Sales Manager B prepares the cabinet of the own department lead');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. Deletion requests: the Admin only (NULL no longer passes).
-- ---------------------------------------------------------------------------
INSERT INTO platform_private.account_deletion_requests(organization_id, membership_id, request_id)
  VALUES (pg_temp.n244_id(1), pg_temp.n244_id(305), pg_temp.n244_id(3401));
CREATE FUNCTION pg_temp.n244_deletions() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n244_error('SELECT platform.staff_account_deletion_requests_v1()')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n244_deletions() TO authenticated, anon;
SET LOCAL request.jwt.claims TO :'n244_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert((SELECT jsonb_array_length(platform.staff_account_deletion_requests_v1()) = 1
  AND platform.staff_account_deletion_requests_v1() -> 0 ->> 'requestId' = pg_temp.n244_id(3401)::TEXT),
  'the Admin lists the deletion request');
RESET ROLE;
SELECT pg_temp.n244_assert((SELECT bool_and(platform_private.staff_has_permission(pg_temp.n244_id(1), m, 'organization.read'))
  FROM unnest(pg_temp.n244_ids(302, 303, 304)) AS m), 'fixture: the «общие разделы» roles grant organization.read');
SET LOCAL request.jwt.claims TO :'n244_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() = '42501:Deletion requests unavailable',
  'Admissions Manager with organization.read is refused (listed student names before 244)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() = '42501:Deletion requests unavailable', 'Admissions is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() = '42501:Deletion requests unavailable', 'Sales Manager is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() = '42501:Deletion requests unavailable', 'the Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n244_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() = '42501:Deletion requests unavailable',
  'an authenticated user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n244_assert(pg_temp.n244_deletions() LIKE '42501:permission denied for %', 'anon is refused');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 7. Definer, search_path and grants of the nine functions are unchanged.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n244_assert((SELECT count(*) = 9 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND p.prosrc !~ 'platform_role\s*(NOT\s+)?IN\s*\(' AND p.prosrc !~ 'platform_role\s*<>')
  FROM pg_proc p WHERE p.oid IN (
    'platform.move_case_pipeline_v1(uuid,uuid,text,boolean,uuid)'::REGPROCEDURE,
    'private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)'::REGPROCEDURE,
    'platform.staff_save_application_requirements_v1(uuid,uuid,uuid,jsonb)'::REGPROCEDURE,
    'platform.prepare_lead_cabinet_v1(uuid,uuid,uuid)'::REGPROCEDURE,
    'platform.staff_account_deletion_requests_v1()'::REGPROCEDURE,
    'platform.staff_admissions_pipeline_board_v1(uuid,text,text,text)'::REGPROCEDURE,
    'platform.staff_student_case_queue_v1(text,integer,text,text,text,uuid,text,text)'::REGPROCEDURE,
    'platform.staff_student_case_queue_counts_v1(text,text,uuid,text,text)'::REGPROCEDURE,
    'platform.admissions_direction_summary_v1(text,uuid,date,date)'::REGPROCEDURE)),
  'SECURITY DEFINER, empty search_path, authenticated-only EXECUTE, no coarse-role gate');
SELECT pg_temp.n244_assert(NOT has_function_privilege('authenticated',
    'platform_private.require_case_assignment_operator_locked(uuid,uuid)'::REGPROCEDURE, 'EXECUTE'),
  'the assignment helper stays private');

SELECT 'N244_ACCESS_BY_PERMISSIONS_SUITE_PASS' AS n244_suite_marker;
ROLLBACK;
