\set ON_ERROR_STOP on
-- Boundary suite for migration 246 («Закрыть лид» и «Завершить дело», owner
-- decision 26.09.2026). Members are modelled like production after 155 and
-- 244 (the fixture of platform_access_by_permissions.sql): invited staff have
-- organization_memberships.current_role NULL and current_bundle_id NULL, so
-- current_actor_authority().platform_role is NULL; permissions come only from
-- scoped role assignments with the production permission keys — Admissions
-- (own scope), Admissions Manager and Sales Manager (department scope). Only
-- the system Admin carries the coarse role; the Student has an own case.
-- Proves:
--  * a Sales Manager closes a lead of the own department with a reason and
--    returns it; the lead leaves the board, its stage column, the due chips
--    and the funnel and comes back at its previous stage with its step; a
--    lead of another department, a handed-off lead (a sale), Admissions
--    (lead.read only), the Student, a caller without membership and anon are
--    refused; exact replay, request-id reuse, stale version and state
--    conflicts; the closed list is scoped by lead.read and pages newest first;
--  * the curator finishes the own case with an outcome and returns it; the
--    case leaves the active views, counts and board and appears in
--    «Закрытые»; another curator, Sales, the Student, no membership and anon
--    are refused; a department Admissions Manager and the Admin pass; exact
--    replay, request-id reuse, stale version, state conflicts; a 137
--    playbook case keeps its guard (cancelled/active outcome);
--  * definer, empty search_path and authenticated-only grants.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

DO $n246_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n246_auth_role$;

CREATE FUNCTION pg_temp.n246_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24600000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n246_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N246: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n246_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Sorted case ids of a JSONB rows array.
CREATE FUNCTION pg_temp.n246_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n246_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.n246_id(x) ORDER BY pg_temp.n246_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n246_id(INTEGER), pg_temp.n246_assert(BOOLEAN, TEXT),
  pg_temp.n246_error(TEXT), pg_temp.n246_case_ids(JSONB), pg_temp.n246_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N246_ACCESS_BY_PERMISSIONS_SUITE_START' AS n246_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (sales department A), 3 Admissions Manager, 4 Admissions A,
-- 6 Admissions B (admissions department), 7 Sales Manager (sales department
-- B); 5 Student (case 505), 8 Student B (the declined case 504).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n246_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n246_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, 'student');
GRANT SELECT ON n246_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n246_id(1), 'N246 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n246_id(100 + n), 'n246-' || n || '@example.invalid', '{}'::JSONB FROM n246_actors;
-- An authenticated identity with no membership at all.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n246_id(199), 'n246-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n246_id(200 + n), pg_temp.n246_id(100 + n), 'N246 Actor ' || n, 'active', 1 FROM n246_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n246_id(300 + n), pg_temp.n246_id(1), pg_temp.n246_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n246_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n246_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n246_id(401), pg_temp.n246_id(1), 'organization', pg_temp.n246_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n246_id(1), pg_temp.n246_id(301), pg_temp.n246_id(401), 1, 1, TRUE, 'system',
    'N246 synthetic organization scope', pg_temp.n246_id(601));

-- Departments in the production shape: sales A (2), sales B (7), admissions (3, 4, 6).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n246_id(901), pg_temp.n246_id(1), 'N246 Sales A'),
  (pg_temp.n246_id(902), pg_temp.n246_id(1), 'N246 Admissions'),
  (pg_temp.n246_id(903), pg_temp.n246_id(1), 'N246 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n246_id(1), pg_temp.n246_id(302), pg_temp.n246_id(901)),
  (pg_temp.n246_id(1), pg_temp.n246_id(303), pg_temp.n246_id(902)),
  (pg_temp.n246_id(1), pg_temp.n246_id(304), pg_temp.n246_id(902)),
  (pg_temp.n246_id(1), pg_temp.n246_id(306), pg_temp.n246_id(902)),
  (pg_temp.n246_id(1), pg_temp.n246_id(307), pg_temp.n246_id(903));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin (outside the admissions department); 504 pending after a sale
-- whose curator declined (handoff evidence, portal already activated for
-- Student B, needs a curator); 505 active, curator A, the Student's own case
-- with an activated portal.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n246_id(420 + k), pg_temp.n246_id(1), 'student_case', pg_temp.n246_id(500 + k), 1
  FROM generate_series(1, 5) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.n246_id(500 + f.k), pg_temp.n246_id(1), pg_temp.n246_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n246_id(f.curator) END,
  'synthetic:n246:' || f.k, 'N246 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  pg_temp.n246_id(420 + f.k), 1, 'new',
  CASE f.k WHEN 5 THEN pg_temp.n246_id(305) WHEN 4 THEN pg_temp.n246_id(308) END,
  CASE WHEN f.k IN (4, 5) THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, NULL, 'pending'), (5, 304, 'active'))
  AS f(k, curator, state);
-- 506: active, curator A, bound to the published MY playbook of 137 (its
-- admissions_case_command_guard ties the playbook outcome to the state).
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n246_id(426), pg_temp.n246_id(1), 'student_case', pg_temp.n246_id(506), 1);
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, admissions_direction, admissions_playbook_version_id,
  admissions_version, admissions_outcome)
VALUES (pg_temp.n246_id(506), pg_temp.n246_id(1), pg_temp.n246_id(302), pg_temp.n246_id(304),
  'synthetic:n246:6', 'N246 Student 506', 'MY', 'Bachelor', 'intake', 'active', clock_timestamp(),
  pg_temp.n246_id(426), 1, 'new', 'MY',
  (SELECT id FROM platform_private.admissions_playbook_versions WHERE direction = 'MY' ORDER BY published_at DESC LIMIT 1),
  1, 'active');
-- Clients and leads: 702 owned by Sales Manager A (2), 704 owned by Sales
-- Manager B (7), 706 (A) carries the sale of the pending case 504.
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.n246_id(701), pg_temp.n246_id(1), 'N246 Client A', platform_private.normalize_person_name('N246 Client A')),
  (pg_temp.n246_id(703), pg_temp.n246_id(1), 'N246 Client B', platform_private.normalize_person_name('N246 Client B')),
  (pg_temp.n246_id(705), pg_temp.n246_id(1), 'N246 Client C', platform_private.normalize_person_name('N246 Client C'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.n246_id(702), pg_temp.n246_id(1), pg_temp.n246_id(701), pg_temp.n246_id(302), 'new', 'website'),
  (pg_temp.n246_id(704), pg_temp.n246_id(1), pg_temp.n246_id(703), pg_temp.n246_id(307), 'new', 'website'),
  (pg_temp.n246_id(706), pg_temp.n246_id(1), pg_temp.n246_id(705), pg_temp.n246_id(302), 'new', 'website');
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links)
VALUES (pg_temp.n246_id(1), pg_temp.n246_id(706), pg_temp.n246_id(705), pg_temp.n246_id(504),
  'canonical-lead:' || pg_temp.n246_id(706)::TEXT, 'normal', 'N246 synthetic sale handoff',
  pg_temp.n246_id(302), pg_temp.n246_id(202), pg_temp.n246_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB);
SET LOCAL session_replication_role = origin;
-- The Student signs in to the organization and reads only the own case
-- (student_case scope of 505), the provisioned portal shape.
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n246_id(1), pg_temp.n246_id(305), pg_temp.n246_id(401), 1, 1, TRUE, 'system',
    'N246 synthetic Student organization scope', pg_temp.n246_id(604)),
  (pg_temp.n246_id(1), pg_temp.n246_id(305), pg_temp.n246_id(425), 1, 1, TRUE, 'system',
    'N246 synthetic Student case scope', pg_temp.n246_id(605));

-- Roles with the EXACT production permission keys (26.09 read-only audit).
CREATE TEMP TABLE n246_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n246_roles VALUES
 (pg_temp.n246_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n246_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n246_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n246_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n246_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n246_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n246_grants VALUES
 (302, pg_temp.n246_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n246_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n246_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n246_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n246_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n246_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n246_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n246_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n246_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n246_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n246_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n246_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n246_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n246_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n246_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n246_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n246_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n246_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n246_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n246_id(1);
GRANT SELECT ON n246_roles, n246_grants, n246_versions TO authenticated;

SELECT pg_temp.n246_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n246_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n246_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n246_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n246_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n246_admin_setup';
SET LOCAL ROLE authenticated;
DO $n246_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n246_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n246_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N246 ' || r.label, 'description', 'Migration 246 synthetic role',
        'permissionKeys', r.keys), 'N246 create role', pg_temp.n246_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n246_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n246_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N246 publish role', pg_temp.n246_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n246_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n246_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n246_id(1), pg_temp.n246_id(m),
      (SELECT access_version FROM n246_versions WHERE membership_id = pg_temp.n246_id(m)), items, bindings,
      'N246 grant roles', pg_temp.n246_id(2000 + m));
  END LOOP;
END
$n246_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions, all minted
-- by the installed token hook (staff and Student).
UPDATE n246_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n246_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n246_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n246_admin FROM n246_actors WHERE n = 1 \gset
SELECT claims AS n246_sales_manager FROM n246_actors WHERE n = 2 \gset
SELECT claims AS n246_admissions_manager FROM n246_actors WHERE n = 3 \gset
SELECT claims AS n246_admissions_a FROM n246_actors WHERE n = 4 \gset
SELECT claims AS n246_student FROM n246_actors WHERE n = 5 \gset
SELECT claims AS n246_admissions_b FROM n246_actors WHERE n = 6 \gset
SELECT claims AS n246_sales_manager_b FROM n246_actors WHERE n = 7 \gset
SELECT jsonb_build_object('sub', pg_temp.n246_id(199), 'role', 'authenticated')::TEXT AS n246_no_member \gset
SELECT pg_temp.n246_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n246_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'student'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n246_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n246_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n246_ids(302, 303, 304, 306, 307))), 'invited members have coarse role and bundle NULL');

-- Each invited member resolves with coarse role NULL.
SET LOCAL request.jwt.claims TO :'n246_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert((SELECT count(*) = 1 AND bool_and(platform_role IS NULL AND membership_id = pg_temp.n246_id(304))
  FROM platform.current_actor_authority()), 'Admissions A resolves with platform_role NULL');
RESET ROLE;
-- Helpers over the four new functions (SQLSTATE:message or 'ok').
CREATE FUNCTION pg_temp.n246_lead(p_lead INTEGER, p_version BIGINT, p_closed BOOLEAN, p_reason TEXT, p_note TEXT, p_request UUID)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n246_error(format('SELECT platform.set_lead_closed_v1(%L, %L, %s, %L, %L, %L, %L)',
    pg_temp.n246_id(1), pg_temp.n246_id(p_lead), p_version, p_closed, p_reason, p_note, p_request))
$$;
CREATE FUNCTION pg_temp.n246_case(p_case INTEGER, p_version BIGINT, p_closed BOOLEAN, p_outcome TEXT, p_note TEXT, p_request UUID)
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n246_error(format('SELECT platform.set_student_case_closed_v1(%L, %L, %s, %L, %L, %L, %L)',
    pg_temp.n246_id(1), pg_temp.n246_id(p_case), p_version, p_closed, p_outcome, p_note, p_request))
$$;
CREATE FUNCTION pg_temp.n246_board_ids() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg(lead_id ORDER BY lead_id), ARRAY[]::UUID[]) FROM platform.staff_sales_lead_page(101)
$$;
CREATE FUNCTION pg_temp.n246_closed_ids() RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT COALESCE(array_agg((r ->> 'lead_id')::UUID ORDER BY (r ->> 'lead_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(platform.staff_closed_leads_v1() -> 'rows') AS r
$$;
CREATE FUNCTION pg_temp.n246_queue(p_view TEXT) RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT pg_temp.n246_case_ids(platform.staff_student_case_queue_v1(p_view, 100) -> 'rows')
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n246_lead(INTEGER, BIGINT, BOOLEAN, TEXT, TEXT, UUID),
  pg_temp.n246_case(INTEGER, BIGINT, BOOLEAN, TEXT, TEXT, UUID), pg_temp.n246_board_ids(),
  pg_temp.n246_closed_ids(), pg_temp.n246_queue(TEXT) TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. «Закрыть лид»: Sales Manager A closes the own department lead; it leaves
-- the board, the chips and the funnel, keeps its stage and next step.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n246_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_board_ids() = pg_temp.n246_ids(702, 706), 'SM A board reads the department leads');
SELECT pg_temp.n246_assert(pg_temp.n246_closed_ids() = ARRAY[]::UUID[], 'no closed lead before');
-- The stage the lead must come back to: «contacting» with a next step.
SELECT platform.mutate_sales_lead_workflow(pg_temp.n246_id(702), 1, pg_temp.n246_id(4001), 'contacting',
  pg_temp.n246_id(302), 'N246 call back', DATE '2026-10-01', FALSE, NULL) ->> 'workflow_version' AS n246_v702 \gset
SELECT (platform.current_sales_funnel(pg_temp.n246_id(1)) ->> 'lead_count')::INTEGER AS n246_funnel_before \gset
SELECT count(*) AS n246_scheduled_before FROM platform.staff_sales_lead_page(101, NULL, NULL, 'all', NULL, 'all', NULL, 'scheduled') \gset
SELECT pg_temp.n246_assert(:n246_v702 = 2 AND :n246_funnel_before = 2 AND :n246_scheduled_before = 1,
  'baseline: 702 at version 2, two open leads, one with a dated step');

SELECT platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(702), :n246_v702, TRUE, 'no_response', NULL,
  pg_temp.n246_id(4002)) AS n246_close_702 \gset
SELECT pg_temp.n246_assert(:'n246_close_702'::JSONB ->> 'lifecycle' = 'closed'
  AND :'n246_close_702'::JSONB ->> 'reason' = 'no_response'
  AND :'n246_close_702'::JSONB -> 'note' = 'null'::JSONB
  AND :'n246_close_702'::JSONB ->> 'stage_key' = 'contacting'
  AND :'n246_close_702'::JSONB ->> 'workflow_version' = '2'
  AND :'n246_close_702'::JSONB ->> 'lead_id' = pg_temp.n246_id(702)::TEXT
  AND :'n246_close_702'::JSONB ->> 'request_id' = pg_temp.n246_id(4002)::TEXT,
  'SM A closes the own department lead with a reason; the receipt is the committed row');
SELECT pg_temp.n246_assert(platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(702), :n246_v702, TRUE,
  'no_response', NULL, pg_temp.n246_id(4002)) = :'n246_close_702'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(702, :n246_v702, TRUE, 'budget', NULL, pg_temp.n246_id(4002))
  = '22023:lead_lifecycle_request_conflict', 'the same request id with another reason is refused');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(702, :n246_v702, TRUE, 'budget', NULL, gen_random_uuid())
  = 'PT409:lead_lifecycle_state_conflict', 'closing an already closed lead is a conflict');
SELECT pg_temp.n246_assert(pg_temp.n246_board_ids() = pg_temp.n246_ids(706), 'the closed lead leaves the board');
SELECT pg_temp.n246_assert((SELECT count(*) FROM platform.staff_sales_lead_page(101, NULL, NULL, 'all', NULL, 'all', NULL, 'scheduled')) = 0
  AND (SELECT count(*) FROM platform.staff_sales_lead_page(101, NULL, NULL, 'all', 'contacting')) = 0,
  'the closed lead leaves its stage column and the due chips');
SELECT pg_temp.n246_assert((platform.current_sales_funnel(pg_temp.n246_id(1)) ->> 'lead_count')::INTEGER = :n246_funnel_before - 1
  AND (SELECT (s ->> 'count')::INTEGER FROM jsonb_array_elements(platform.current_sales_funnel(pg_temp.n246_id(1)) -> 'stages') s
    WHERE s ->> 'key' = 'contacting') = 0, 'the funnel counts exclude the closed lead');
SELECT pg_temp.n246_assert(pg_temp.n246_error(format(
  $q$SELECT platform.mutate_sales_lead_workflow(%L, 2, %L, 'qualified', %L, NULL, NULL, TRUE, NULL)$q$,
  pg_temp.n246_id(702), gen_random_uuid(), pg_temp.n246_id(302))) = '42501:workflow_not_found_or_forbidden',
  'the stage form refuses a closed lead (086, unchanged)');
SELECT platform.staff_closed_leads_v1() AS n246_closed_sm_a \gset
SELECT pg_temp.n246_assert(jsonb_array_length(:'n246_closed_sm_a'::JSONB -> 'rows') = 1
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'lead_id' = pg_temp.n246_id(702)::TEXT
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'reason' = 'no_response'
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'client_display_name' = 'N246 Client A'
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'closed_by_display_name' = 'N246 Actor 2'
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'stage_key' = 'contacting'
  AND :'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'workflow_version' = '2'
  AND (:'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'closed_at') IS NOT NULL
  AND (:'n246_closed_sm_a'::JSONB -> 'rows' -> 0 ->> 'can_manage')::BOOLEAN
  AND :'n246_closed_sm_a'::JSONB -> 'next_cursor' = 'null'::JSONB,
  'the closed list names the reason, date, who closed and the manage hint');
SELECT pg_temp.n246_assert(jsonb_array_length(platform.staff_closed_leads_v1(50, NULL, pg_temp.n246_id(702)) -> 'rows') = 1
  AND jsonb_array_length(platform.staff_closed_leads_v1(50, NULL, pg_temp.n246_id(706)) -> 'rows') = 0,
  'p_lead_id narrows the list to one closed lead; an open lead is not in it');
SELECT pg_temp.n246_assert(pg_temp.n246_error('SELECT platform.staff_closed_leads_v1(0)') = '22023:closed_leads_invalid'
  AND pg_temp.n246_error($q$SELECT platform.staff_closed_leads_v1(10, 'bogus')$q$) = '22023:closed_leads_invalid',
  'a bad page size or cursor is refused');

-- Refusals for Sales Manager A: another department, a sale, bad input.
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 1, TRUE, 'budget', NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden',
  'SM A cannot close a lead of another department');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(706, 1, TRUE, 'duplicate', NULL, gen_random_uuid()) = '55000:lead_lifecycle_handed_off',
  'a handed-off lead is a sale and cannot be closed as lost');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(706, 1, TRUE, 'other', NULL, gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, 'other', '   ', gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, 'budget', 'N246 extra', gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, 'lost', NULL, gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, NULL, NULL, gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(702, 2, FALSE, 'budget', NULL, gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, 'other', 'N246 two' || chr(10) || 'lines', gen_random_uuid()) = '22023:lead_lifecycle_invalid'
  AND pg_temp.n246_lead(706, 1, TRUE, 'other', repeat('x', 501), gen_random_uuid()) = '22023:lead_lifecycle_invalid',
  '«Другое» needs one line of text up to 500 characters; only «Другое» carries text; return carries none');
SELECT pg_temp.n246_assert((SELECT lifecycle_state = 'open' FROM platform.leads WHERE id = pg_temp.n246_id(706)),
  'the refused commands left the handed-off lead open');
RESET ROLE;

SELECT pg_temp.n246_assert((SELECT lifecycle_state = 'disqualified' AND stage_key = 'contacting'
    AND next_action_text = 'N246 call back' AND next_action_due_date = DATE '2026-10-01' AND workflow_version = 2
  FROM platform.leads WHERE id = pg_temp.n246_id(702)),
  'closing stores disqualified and keeps the stage, the next step and the workflow version');

-- Sales Manager B: does not see A's closed lead; stale version is a conflict.
SET LOCAL request.jwt.claims TO :'n246_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_closed_ids() = ARRAY[]::UUID[], 'SM B does not read the closed lead of department A');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(702, 2, FALSE, NULL, NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden',
  'SM B cannot return a lead of department A');
SELECT pg_temp.n246_assert((platform.mutate_sales_lead_workflow(pg_temp.n246_id(704), 1, pg_temp.n246_id(4011), 'qualified',
  pg_temp.n246_id(307), NULL, NULL, TRUE, NULL) ->> 'workflow_version') = '2', 'SM B moves the own lead (version 2)');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 1, TRUE, 'other_agency', NULL, gen_random_uuid()) = 'PT409:lead_lifecycle_version_conflict',
  'a stale workflow version is a conflict');
SELECT pg_temp.n246_assert(platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(704), 2, TRUE, 'other', '  N246 moved abroad  ',
  pg_temp.n246_id(4012)) ->> 'note' = 'N246 moved abroad', 'SM B closes the own lead with «Другое» and trimmed text');
SELECT pg_temp.n246_assert(pg_temp.n246_closed_ids() = pg_temp.n246_ids(704), 'SM B reads only the own department closed lead');
RESET ROLE;

-- Admissions A (lead.read only), the Student, no membership, anon: refused.
SET LOCAL request.jwt.claims TO :'n246_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 2, FALSE, NULL, NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden'
  AND pg_temp.n246_lead(706, 1, TRUE, 'budget', NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden',
  'Admissions (no lead.sales.workflow.manage) cannot close or return a lead');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 2, FALSE, NULL, NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden'
  AND pg_temp.n246_error('SELECT platform.staff_closed_leads_v1()') = '42501:closed_leads_forbidden',
  'the Student cannot change or list leads');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 2, FALSE, NULL, NULL, gen_random_uuid()) = '42501:lead_lifecycle_forbidden'
  AND pg_temp.n246_error('SELECT platform.staff_closed_leads_v1()') = '42501:closed_leads_forbidden',
  'an authenticated user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n246_assert(pg_temp.n246_lead(704, 2, FALSE, NULL, NULL, gen_random_uuid()) LIKE '42501:permission denied for %'
  AND pg_temp.n246_error('SELECT platform.staff_closed_leads_v1()') LIKE '42501:permission denied for %',
  'anon cannot execute the lead command or the list');
RESET ROLE;

-- The Admin reads both closed leads and returns B's lead.
SET LOCAL request.jwt.claims TO :'n246_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_closed_ids() = pg_temp.n246_ids(702, 704), 'the Admin reads every closed lead');
SELECT platform.staff_closed_leads_v1(1) AS n246_page1 \gset
SELECT pg_temp.n246_assert(jsonb_array_length(:'n246_page1'::JSONB -> 'rows') = 1
  AND :'n246_page1'::JSONB -> 'rows' -> 0 ->> 'lead_id' = pg_temp.n246_id(704)::TEXT
  AND (platform.staff_closed_leads_v1(1, :'n246_page1'::JSONB ->> 'next_cursor') -> 'rows' -> 0 ->> 'lead_id') = pg_temp.n246_id(702)::TEXT,
  'newest closure first; the cursor pages to the older one');
SELECT pg_temp.n246_assert(platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(704), 2, FALSE, NULL, NULL,
  pg_temp.n246_id(4021)) ->> 'lifecycle' = 'open', 'the Admin returns any lead to work');
RESET ROLE;

-- Sales Manager A returns 702: open again at «contacting» with its step.
SET LOCAL request.jwt.claims TO :'n246_sales_manager';
SET LOCAL ROLE authenticated;
SELECT platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(702), 2, FALSE, NULL, NULL, pg_temp.n246_id(4031)) AS n246_reopen_702 \gset
SELECT pg_temp.n246_assert(:'n246_reopen_702'::JSONB ->> 'lifecycle' = 'open'
  AND :'n246_reopen_702'::JSONB ->> 'stage_key' = 'contacting'
  AND :'n246_reopen_702'::JSONB -> 'reason' = 'null'::JSONB, '«Вернуть в работу» restores the lead open at its previous stage');
SELECT pg_temp.n246_assert(platform.set_lead_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(702), 2, FALSE, NULL, NULL,
  pg_temp.n246_id(4031)) = :'n246_reopen_702'::JSONB, 'an exact replay of the return is the same receipt');
SELECT pg_temp.n246_assert(pg_temp.n246_lead(702, 2, FALSE, NULL, NULL, gen_random_uuid()) = 'PT409:lead_lifecycle_state_conflict',
  'returning an open lead is a conflict');
SELECT pg_temp.n246_assert(pg_temp.n246_board_ids() = pg_temp.n246_ids(702, 706)
  AND (platform.current_sales_funnel(pg_temp.n246_id(1)) ->> 'lead_count')::INTEGER = :n246_funnel_before
  AND (SELECT count(*) FROM platform.staff_sales_lead_page(101, NULL, NULL, 'all', NULL, 'all', NULL, 'scheduled')) = 1
  AND pg_temp.n246_closed_ids() = ARRAY[]::UUID[],
  'the returned lead is back on the board, in the chips and the funnel, and out of the closed list');
SELECT pg_temp.n246_assert((platform.mutate_sales_lead_workflow(pg_temp.n246_id(702), 2, pg_temp.n246_id(4032), 'qualified',
  pg_temp.n246_id(302), 'N246 meet', DATE '2026-10-02', FALSE, NULL) ->> 'workflow_version') = '3',
  'the stage form works again on the returned lead (the 111 evidence stays consistent)');
SELECT pg_temp.n246_assert(pg_temp.n246_board_ids() = pg_temp.n246_ids(702, 706), 'the board read still passes its integrity check');
RESET ROLE;
SELECT pg_temp.n246_assert((SELECT array_agg(actor_membership_id::TEXT || ':' || (after_state ->> 'lifecycle') ORDER BY request_id)
  FROM platform.audit_events WHERE action = 'lead.lifecycle.change' AND organization_id = pg_temp.n246_id(1))
  = ARRAY[pg_temp.n246_id(302)::TEXT || ':closed', pg_temp.n246_id(307)::TEXT || ':closed',
    pg_temp.n246_id(301)::TEXT || ':open', pg_temp.n246_id(302)::TEXT || ':open'],
  'each allowed lead command is journaled once under its actor');

-- ---------------------------------------------------------------------------
-- 2. «Завершить дело»: the curator finishes the own case; it leaves the active
-- views and the board and appears in «Закрытые».
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n246_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_queue('active') = pg_temp.n246_ids(501, 505, 506)
  AND pg_temp.n246_queue('closed') = ARRAY[]::UUID[], 'Admissions A: three own active cases, none closed');
SELECT platform.staff_student_case_closure_v1(pg_temp.n246_id(1), pg_temp.n246_id(501)) AS n246_c501 \gset
SELECT pg_temp.n246_assert(:'n246_c501'::JSONB ->> 'state' = 'active' AND :'n246_c501'::JSONB ->> 'admissions_version' = '0'
  AND (:'n246_c501'::JSONB ->> 'can_change')::BOOLEAN AND :'n246_c501'::JSONB -> 'outcome' = 'null'::JSONB
  AND :'n246_c501'::JSONB -> 'closed_at' = 'null'::JSONB, 'the closure read of an active own case offers the change');
SELECT platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(501), 0, TRUE, 'enrolled', NULL,
  pg_temp.n246_id(5001)) AS n246_close_501 \gset
SELECT pg_temp.n246_assert(:'n246_close_501'::JSONB ->> 'state' = 'closed'
  AND :'n246_close_501'::JSONB ->> 'outcome' = 'enrolled'
  AND :'n246_close_501'::JSONB ->> 'admissions_version' = '1'
  AND (:'n246_close_501'::JSONB ->> 'closed_at') IS NOT NULL
  AND :'n246_close_501'::JSONB ->> 'request_id' = pg_temp.n246_id(5001)::TEXT,
  'Admissions A finishes the own case with an outcome (version 0 -> 1)');
SELECT pg_temp.n246_assert(platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(501), 0, TRUE, 'enrolled', NULL,
  pg_temp.n246_id(5001)) = :'n246_close_501'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n246_assert(pg_temp.n246_case(501, 0, TRUE, 'declined', NULL, pg_temp.n246_id(5001)) = '22023:case_closure_request_conflict',
  'the same request id with another outcome is refused');
SELECT pg_temp.n246_assert(pg_temp.n246_case(501, 1, TRUE, 'declined', NULL, gen_random_uuid()) = 'PT409:case_closure_state_conflict',
  'finishing a closed case is a conflict');
SELECT pg_temp.n246_assert(pg_temp.n246_queue('active') = pg_temp.n246_ids(505, 506)
  AND pg_temp.n246_queue('mine') = pg_temp.n246_ids(505, 506)
  AND NOT (pg_temp.n246_id(501) = ANY (pg_temp.n246_queue('needs_action')))
  AND pg_temp.n246_queue('closed') = pg_temp.n246_ids(501), 'the case leaves the active views and appears in «Закрытые»');
SELECT platform.staff_student_case_queue_counts_v1('active') AS n246_counts \gset
SELECT pg_temp.n246_assert((:'n246_counts'::JSONB -> 'views' ->> 'active')::INTEGER = 2
  AND (:'n246_counts'::JSONB -> 'views' ->> 'closed')::INTEGER = 1
  AND (:'n246_counts'::JSONB -> 'views' ->> 'mine')::INTEGER = 2, 'the tab counts move the case from active to closed');
SELECT pg_temp.n246_assert(NOT (pg_temp.n246_id(501) = ANY (pg_temp.n246_case_ids(platform.staff_admissions_pipeline_board_v1() -> 'rows'))),
  'the closed case leaves the admissions board');
SELECT platform.staff_student_case_closure_v1(pg_temp.n246_id(1), pg_temp.n246_id(501)) AS n246_c501 \gset
SELECT pg_temp.n246_assert(:'n246_c501'::JSONB ->> 'state' = 'closed' AND :'n246_c501'::JSONB ->> 'outcome' = 'enrolled'
  AND :'n246_c501'::JSONB ->> 'closed_by_display_name' = 'N246 Actor 4' AND :'n246_c501'::JSONB ->> 'admissions_version' = '1'
  AND (:'n246_c501'::JSONB ->> 'closed_at') IS NOT NULL AND (:'n246_c501'::JSONB ->> 'can_change')::BOOLEAN,
  'the closure read names the outcome, date and who finished it');
SELECT pg_temp.n246_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(
    platform.staff_student_case_activity(pg_temp.n246_id(501)) -> 'events') e WHERE e ->> 'action' = 'case.lifecycle.change'),
  'the case «История» shows the change');
-- Another curator's case, a stale version, bad input.
SELECT pg_temp.n246_assert(pg_temp.n246_case(502, 0, TRUE, 'declined', NULL, gen_random_uuid()) = '42501:Student case is unavailable',
  'Admissions A cannot finish the case of Admissions B');
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 7, TRUE, 'declined', NULL, gen_random_uuid()) = 'PT409:case_closure_version_conflict',
  'a stale case version is a conflict');
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 0, TRUE, 'other', NULL, gen_random_uuid()) = '22023:case_closure_invalid'
  AND pg_temp.n246_case(505, 0, TRUE, 'enrolled', 'N246 extra', gen_random_uuid()) = '22023:case_closure_invalid'
  AND pg_temp.n246_case(505, 0, TRUE, 'arrived', NULL, gen_random_uuid()) = '22023:case_closure_invalid'
  AND pg_temp.n246_case(501, 1, FALSE, 'enrolled', NULL, gen_random_uuid()) = '22023:case_closure_invalid',
  '«Другое» needs text, only «Другое» carries text, a return carries no outcome');
RESET ROLE;
SELECT pg_temp.n246_assert((SELECT state = 'closed' AND closed_at IS NOT NULL AND admissions_version = 1
  FROM platform.student_cases WHERE id = pg_temp.n246_id(501))
  AND (SELECT state = 'active' AND admissions_version = 0 FROM platform.student_cases WHERE id = pg_temp.n246_id(505))
  AND (SELECT array_agg(event_type || ':' || actor_membership_id::TEXT) FROM platform.student_case_lifecycle_events
    WHERE student_case_id = pg_temp.n246_id(501)) = ARRAY['closed:' || pg_temp.n246_id(304)::TEXT],
  'one closed lifecycle event under the curator; the refused commands changed nothing');

SET LOCAL request.jwt.claims TO :'n246_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_case(501, 1, FALSE, NULL, NULL, gen_random_uuid()) = '42501:Student case is unavailable'
  AND pg_temp.n246_error(format('SELECT platform.staff_student_case_closure_v1(%L, %L)', pg_temp.n246_id(1), pg_temp.n246_id(501)))
    = '42501:Student case is unavailable', 'Admissions B cannot read or return the case of Admissions A');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 0, TRUE, 'declined', NULL, gen_random_uuid()) = '42501:Student case is unavailable'
  AND pg_temp.n246_error(format('SELECT platform.staff_student_case_closure_v1(%L, %L)', pg_temp.n246_id(1), pg_temp.n246_id(505)))
    = '42501:Student case is unavailable', 'Sales Manager (no case.read.full) cannot finish or read, even the case it sold');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 0, TRUE, 'declined', NULL, gen_random_uuid()) = '42501:Student case is unavailable'
  AND pg_temp.n246_error(format('SELECT platform.staff_student_case_closure_v1(%L, %L)', pg_temp.n246_id(1), pg_temp.n246_id(505)))
    = '42501:Student case is unavailable', 'the Student cannot finish or read the own case');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 0, TRUE, 'declined', NULL, gen_random_uuid()) = '42501:Student case is unavailable',
  'an authenticated user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n246_assert(pg_temp.n246_case(505, 0, TRUE, 'declined', NULL, gen_random_uuid()) LIKE '42501:permission denied for %'
  AND pg_temp.n246_error(format('SELECT platform.staff_student_case_closure_v1(%L, %L)', pg_temp.n246_id(1), pg_temp.n246_id(505)))
    LIKE '42501:permission denied for %', 'anon cannot execute the case command or read');
RESET ROLE;

-- The curator returns the case to work.
SET LOCAL request.jwt.claims TO :'n246_admissions_a';
SET LOCAL ROLE authenticated;
SELECT platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(501), 1, FALSE, NULL, NULL,
  pg_temp.n246_id(5011)) AS n246_reopen_501 \gset
SELECT pg_temp.n246_assert(:'n246_reopen_501'::JSONB ->> 'state' = 'active' AND :'n246_reopen_501'::JSONB ->> 'admissions_version' = '2'
  AND :'n246_reopen_501'::JSONB -> 'closed_at' = 'null'::JSONB AND :'n246_reopen_501'::JSONB -> 'outcome' = 'null'::JSONB,
  '«Вернуть в работу» reopens the case (version 1 -> 2)');
SELECT pg_temp.n246_assert(pg_temp.n246_case(501, 2, FALSE, NULL, NULL, gen_random_uuid()) = 'PT409:case_closure_state_conflict',
  'returning an active case is a conflict');
SELECT pg_temp.n246_assert(pg_temp.n246_queue('active') = pg_temp.n246_ids(501, 505, 506) AND pg_temp.n246_queue('closed') = ARRAY[]::UUID[]
  AND pg_temp.n246_id(501) = ANY (pg_temp.n246_case_ids(platform.staff_admissions_pipeline_board_v1() -> 'rows')),
  'the returned case is back in the active views and on the board');
SELECT pg_temp.n246_assert((platform.staff_student_case_closure_v1(pg_temp.n246_id(1), pg_temp.n246_id(501)) -> 'outcome') = 'null'::JSONB,
  'a returned case has no current outcome');
SELECT pg_temp.n246_assert(platform.set_case_next_action_v1(pg_temp.n246_id(1), pg_temp.n246_id(501), 2, 'N246 next', NULL,
  pg_temp.n246_id(5012)) ->> 'admissions_version' = '3', 'the next-step editor works on the returned case with the new version');
-- A case bound to the 137 playbook: the playbook outcome follows the state.
SELECT pg_temp.n246_assert(platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(506), 1, TRUE, 'not_admitted', NULL,
  pg_temp.n246_id(5021)) ->> 'admissions_version' = '2', 'a playbook case is finished through the same command');
RESET ROLE;
SELECT pg_temp.n246_assert((SELECT state = 'closed' AND admissions_outcome = 'cancelled' AND admissions_version = 2
  FROM platform.student_cases WHERE id = pg_temp.n246_id(506)), 'the playbook outcome of a finished case is cancelled');
SET LOCAL request.jwt.claims TO :'n246_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(506), 2, FALSE, NULL, NULL,
  pg_temp.n246_id(5022)) ->> 'state' = 'active', 'the playbook case is returned to work');
RESET ROLE;
SELECT pg_temp.n246_assert((SELECT state = 'active' AND admissions_outcome = 'active' AND admissions_version = 3 AND closed_at IS NULL
  FROM platform.student_cases WHERE id = pg_temp.n246_id(506)), 'the returned playbook case is active again');

-- Admissions Manager (department) and the Admin (any case).
SET LOCAL request.jwt.claims TO :'n246_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(502), 0, TRUE, 'declined', NULL,
  pg_temp.n246_id(5031)) ->> 'outcome' = 'declined', 'Admissions Manager finishes a department case (permission, not coarse role)');
SELECT pg_temp.n246_assert(pg_temp.n246_case(503, 0, TRUE, 'declined', NULL, gen_random_uuid()) = '42501:Student case is unavailable',
  'Admissions Manager cannot finish a case outside the department');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n246_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n246_assert(platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(503), 0, TRUE, 'other', 'N246 moved abroad',
  pg_temp.n246_id(5041)) ->> 'note' = 'N246 moved abroad', 'the Admin finishes a case with «Другое» and text');
SELECT pg_temp.n246_assert((platform.staff_student_case_closure_v1(pg_temp.n246_id(1), pg_temp.n246_id(503)) ->> 'note') = 'N246 moved abroad',
  'the closure read returns the note');
SELECT pg_temp.n246_assert(pg_temp.n246_case(504, 0, TRUE, 'declined', NULL, gen_random_uuid()) = 'PT409:case_closure_state_conflict'
  AND NOT (platform.staff_student_case_closure_v1(pg_temp.n246_id(1), pg_temp.n246_id(504)) ->> 'can_change')::BOOLEAN,
  'a pending case cannot be finished and the read says so');
SELECT pg_temp.n246_assert((platform.set_student_case_closed_v1(pg_temp.n246_id(1), pg_temp.n246_id(502), 1, FALSE, NULL, NULL,
  pg_temp.n246_id(5042)) ->> 'state') = 'active', 'the Admin returns any case to work');
RESET ROLE;
SELECT pg_temp.n246_assert((SELECT array_agg(action || ':' || (after_state ->> 'case_state') || ':' || actor_membership_id::TEXT ORDER BY request_id)
  FROM platform.audit_events WHERE action = 'case.lifecycle.change' AND organization_id = pg_temp.n246_id(1))
  = ARRAY['case.lifecycle.change:closed:' || pg_temp.n246_id(304)::TEXT, 'case.lifecycle.change:active:' || pg_temp.n246_id(304)::TEXT,
    'case.lifecycle.change:closed:' || pg_temp.n246_id(304)::TEXT, 'case.lifecycle.change:active:' || pg_temp.n246_id(304)::TEXT,
    'case.lifecycle.change:closed:' || pg_temp.n246_id(303)::TEXT, 'case.lifecycle.change:closed:' || pg_temp.n246_id(301)::TEXT,
    'case.lifecycle.change:active:' || pg_temp.n246_id(301)::TEXT],
  'each allowed case command is journaled once under its actor');

-- ---------------------------------------------------------------------------
-- 3. Definer, search_path and grants of the four functions.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n246_assert((SELECT count(*) = 4 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.oid IN (
    'platform.set_lead_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)'::REGPROCEDURE,
    'platform.staff_closed_leads_v1(integer,text,uuid)'::REGPROCEDURE,
    'platform.set_student_case_closed_v1(uuid,uuid,bigint,boolean,text,text,uuid)'::REGPROCEDURE,
    'platform.staff_student_case_closure_v1(uuid,uuid)'::REGPROCEDURE)),
  'SECURITY DEFINER, empty search_path, authenticated-only EXECUTE');

SELECT 'N246_LEAD_CASE_CLOSURE_SUITE_PASS' AS n246_suite_marker;
ROLLBACK;
