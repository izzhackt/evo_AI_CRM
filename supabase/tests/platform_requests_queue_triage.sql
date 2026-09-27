\set ON_ERROR_STOP on
-- Boundary suite for migration 250 (Э3 «Заявки»: platform.staff_requests_queue_v2).
-- Members are modelled like production, with the fixtures of 244/248: invited
-- staff have organization_memberships.current_role NULL and
-- current_bundle_id NULL (current_actor_authority().platform_role is NULL, the
-- JWT says 'staff'); permissions come only from scoped role assignments with
-- the production permission keys (26.09 read-only audit): Sales Manager
-- (department scope), Admissions Manager (department), Admissions (own) and
-- the two «общие разделы» roles (organization). Only the system Admin carries
-- the coarse role. One member (9) holds Sales Manager with ORGANIZATION scope:
-- no invited member has that shape in production (only the Admin), it proves
-- that «take» follows permissions and scope, not the Admin flag.
-- Proves: v2 rows and counts equal v1 for «Все»; each tab's count equals its
-- rows; «Ждут разбора» is exactly the lead with no owner that is not handed
-- off, the pending application and the open consultation; «take» appears
-- exactly where the real platform.mutate_sales_lead_workflow accepts the
-- actor as the new owner (the Admin and the organization-scoped Sales Manager
-- take; a department Sales Manager sees no unowned lead and the command
-- refuses it; a stale take is a version conflict); an unreadable kind has no
-- count; paging; students, callers without a membership and anon refused.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action. Style follows platform_access_by_permissions.sql.
BEGIN;

DO $n250_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n250_auth_role$;

CREATE FUNCTION pg_temp.n250_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('25000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n250_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N250: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n250_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
CREATE FUNCTION pg_temp.n250_key(kind TEXT, n INTEGER) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT kind || ':' || pg_temp.n250_id(n)::TEXT
$$;
CREATE FUNCTION pg_temp.n250_keys(VARIADIC keys TEXT[]) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) FROM unnest(keys) AS k
$$;
-- Sorted kind:id of a queue page.
CREATE FUNCTION pg_temp.n250_rows(page JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'kind') || ':' || (r ->> 'id') ORDER BY (r ->> 'kind') || ':' || (r ->> 'id')), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(page -> 'rows') AS r
$$;
-- Sorted lead keys whose row carries «take».
CREATE FUNCTION pg_temp.n250_takes(page JSONB) RETURNS TEXT[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg('lead:' || (r ->> 'id') ORDER BY r ->> 'id'), ARRAY[]::TEXT[])
  FROM jsonb_array_elements(page -> 'rows') AS r WHERE r -> 'take' IS NOT NULL AND r -> 'take' <> 'null'::JSONB
$$;
CREATE FUNCTION pg_temp.n250_row(page JSONB, n INTEGER) RETURNS JSONB LANGUAGE SQL IMMUTABLE AS $$
  SELECT r FROM jsonb_array_elements(page -> 'rows') AS r WHERE r ->> 'id' = pg_temp.n250_id(n)::TEXT
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n250_id(INTEGER), pg_temp.n250_assert(BOOLEAN, TEXT), pg_temp.n250_error(TEXT),
  pg_temp.n250_key(TEXT, INTEGER), pg_temp.n250_keys(TEXT[]), pg_temp.n250_rows(JSONB), pg_temp.n250_takes(JSONB),
  pg_temp.n250_row(JSONB, INTEGER)
  TO authenticated, anon, service_role;

SELECT 'N250_REQUESTS_QUEUE_TRIAGE_SUITE_START' AS n250_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL: 2 Sales
-- Manager A (sales department A), 3 Admissions Manager, 4 Admissions A
-- (admissions department), 7 Sales Manager B (sales department B), 9 Sales
-- Manager with organization scope; 5 Student.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n250_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n250_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (7, NULL), (9, NULL);
GRANT SELECT ON n250_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n250_id(1), 'N250 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n250_id(100 + n), 'n250-' || n || '@example.invalid', '{}'::JSONB FROM n250_actors;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n250_id(199), 'n250-none@example.invalid', '{}'::JSONB),
  (pg_temp.n250_id(181), 'n250-applicant-1@example.invalid', '{}'::JSONB),
  (pg_temp.n250_id(182), 'n250-applicant-2@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n250_id(200 + n), pg_temp.n250_id(100 + n), 'N250 Actor ' || n, 'active', 1 FROM n250_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n250_id(300 + n), pg_temp.n250_id(1), pg_temp.n250_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n250_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n250_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n250_id(401), pg_temp.n250_id(1), 'organization', pg_temp.n250_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n250_id(1), pg_temp.n250_id(301), pg_temp.n250_id(401), 1, 1, TRUE, 'system',
    'N250 synthetic organization scope', pg_temp.n250_id(601)),
  (pg_temp.n250_id(1), pg_temp.n250_id(305), pg_temp.n250_id(401), 1, 1, TRUE, 'system',
    'N250 synthetic Student organization scope', pg_temp.n250_id(604));

INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n250_id(901), pg_temp.n250_id(1), 'N250 Sales A'),
  (pg_temp.n250_id(902), pg_temp.n250_id(1), 'N250 Admissions'),
  (pg_temp.n250_id(903), pg_temp.n250_id(1), 'N250 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n250_id(1), pg_temp.n250_id(302), pg_temp.n250_id(901)),
  (pg_temp.n250_id(1), pg_temp.n250_id(303), pg_temp.n250_id(902)),
  (pg_temp.n250_id(1), pg_temp.n250_id(304), pg_temp.n250_id(902)),
  (pg_temp.n250_id(1), pg_temp.n250_id(307), pg_temp.n250_id(903)),
  (pg_temp.n250_id(1), pg_temp.n250_id(309), pg_temp.n250_id(901));

-- Leads (created_at orders the queue; Bishkek +06):
--   711 website, no owner, new                       -> waiting
--   712 whatsapp, no owner, contacting (next action below, through the command) -> waiting
--   713 website, owner Sales Manager A, qualified     -> taken
--   714 website, owner Sales Manager B               -> taken
--   715 website, no owner, handed off to case 504    -> not waiting, not takeable
--   716 other (manual), no owner                     -> never a request
--   717 website, no owner, closed                    -> never a request
-- Case 504 (pending) carries 715's completed handoff.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n250_id(424), pg_temp.n250_id(1), 'student_case', pg_temp.n250_id(504), 1);
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage)
VALUES (pg_temp.n250_id(504), pg_temp.n250_id(1), pg_temp.n250_id(302), NULL, 'synthetic:n250:4', 'N250 Student 504',
  'MY', 'Bachelor', 'contract_confirmed', 'pending', NULL, pg_temp.n250_id(424), 1, 'new');
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name, email)
  SELECT pg_temp.n250_id(1000 + k), pg_temp.n250_id(1), 'N250 Client ' || k,
    platform_private.normalize_person_name('N250 Client ' || k), 'n250-client-' || k || '@example.invalid'
  FROM generate_series(711, 717) AS k;
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key,
  lifecycle_state, created_at, updated_at)
SELECT pg_temp.n250_id(f.k), pg_temp.n250_id(1), pg_temp.n250_id(1000 + f.k),
  CASE WHEN f.owner IS NULL THEN NULL ELSE pg_temp.n250_id(f.owner) END, f.stage, f.source,
  f.lifecycle::platform.lead_lifecycle_state, f.created::TIMESTAMPTZ, f.created::TIMESTAMPTZ
FROM (VALUES
  (711, NULL, 'new', 'website', 'open', '2026-09-20 09:00+06'),
  (712, NULL, 'contacting', 'whatsapp', 'open', '2026-09-21 10:00+06'),
  (713, 302, 'qualified', 'website', 'open', '2026-09-22 11:00+06'),
  (714, 307, 'new', 'website', 'open', '2026-09-23 12:00+06'),
  (715, NULL, 'qualified', 'website', 'open', '2026-09-19 08:00+06'),
  (716, NULL, 'new', 'other', 'open', '2026-09-24 08:00+06'),
  (717, NULL, 'contacting', 'website', 'disqualified', '2026-09-25 08:00+06')) AS f(k, owner, stage, source, lifecycle, created);
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links, handed_off_at)
VALUES (pg_temp.n250_id(1), pg_temp.n250_id(715), pg_temp.n250_id(1715), pg_temp.n250_id(504),
  'canonical-lead:' || pg_temp.n250_id(715)::TEXT, 'normal', 'N250 synthetic handoff',
  pg_temp.n250_id(302), pg_temp.n250_id(202), pg_temp.n250_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB, '2026-09-19 12:00+06');
-- Applications: 801 pending (24.09), 802 rejected (18.09). Direction CN.
INSERT INTO platform_private.student_applications(id, organization_id, auth_user_id, normalized_email, questionnaire,
  status, submitted_at, decided_at, decided_by_membership_id, decision_reason)
SELECT pg_temp.n250_id(f.k), pg_temp.n250_id(1), pg_temp.n250_id(f.auth_user), 'n250-applicant-' || f.k || '@example.invalid',
  jsonb_build_object('schemaVersion', 1, 'requestId', pg_temp.n250_id(f.k + 10)::TEXT, 'firstName', 'N250',
    'lastName', 'Applicant ' || f.k, 'phone', '+996555000' || f.k, 'destinationCountries', jsonb_build_array('CN'),
    'intakeSeason', 'autumn', 'intakeYear', 2027, 'educationLevel', 'high_school', 'averageGrade', 4.5,
    'gradeScale', '5', 'studyFields', jsonb_build_array('Инженерия'), 'studyLevels', jsonb_build_array('bachelor'),
    'nationality', 'KG', 'english', jsonb_build_object('mode', 'self', 'level', 'beginner'),
    'tuitionBudget', 'under_5000', 'fundingSource', 'family', 'consent', TRUE, 'consentVersion', '2026-09-18'),
  f.status, f.submitted::TIMESTAMPTZ,
  CASE WHEN f.status = 'rejected' THEN f.submitted::TIMESTAMPTZ + INTERVAL '1 day' END,
  CASE WHEN f.status = 'rejected' THEN pg_temp.n250_id(301) END,
  CASE WHEN f.status = 'rejected' THEN 'N250 synthetic decline' END
FROM (VALUES (801, 181, 'pending', '2026-09-24 12:00+06'), (802, 182, 'rejected', '2026-09-18 12:00+06'))
  AS f(k, auth_user, status, submitted);
-- Consultations from the Student's cabinet: 851 open (25.09), 852 handled (17.09).
INSERT INTO platform_private.portal_consultation_requests(id, organization_id, membership_id, request_id, note, status,
  created_at, handled_at, handled_by_membership_id)
VALUES (pg_temp.n250_id(851), pg_temp.n250_id(1), pg_temp.n250_id(305), pg_temp.n250_id(861), 'N250 synthetic note',
    'requested', '2026-09-25 09:00+06', NULL, NULL),
  (pg_temp.n250_id(852), pg_temp.n250_id(1), pg_temp.n250_id(305), pg_temp.n250_id(862), NULL,
    'handled', '2026-09-17 09:00+06', '2026-09-17 15:00+06', pg_temp.n250_id(301));
SET LOCAL session_replication_role = origin;

-- Roles with the EXACT production permission keys (26.09 read-only audit, as in 244's suite).
CREATE TEMP TABLE n250_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n250_roles VALUES
 (pg_temp.n250_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n250_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n250_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n250_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n250_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n250_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n250_grants VALUES
 (302, pg_temp.n250_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n250_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n250_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n250_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n250_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n250_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n250_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n250_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n250_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n250_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n250_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL)),
 (309, pg_temp.n250_id(1103), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL)),
 (309, pg_temp.n250_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n250_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n250_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n250_id(1);
GRANT SELECT ON n250_roles, n250_grants, n250_versions TO authenticated;

SELECT pg_temp.n250_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n250_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n250_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n250_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n250_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n250_admin_setup';
SET LOCAL ROLE authenticated;
DO $n250_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n250_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n250_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N250 ' || r.label, 'description', 'Migration 250 synthetic role',
        'permissionKeys', r.keys), 'N250 create role', pg_temp.n250_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n250_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n250_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N250 publish role', pg_temp.n250_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n250_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n250_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n250_id(1), pg_temp.n250_id(m),
      (SELECT access_version FROM n250_versions WHERE membership_id = pg_temp.n250_id(m)), items, bindings,
      'N250 grant roles', pg_temp.n250_id(2000 + m));
  END LOOP;
END
$n250_roles$;
RESET ROLE;

UPDATE n250_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n250_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n250_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n250_admin FROM n250_actors WHERE n = 1 \gset
SELECT claims AS n250_sales_manager FROM n250_actors WHERE n = 2 \gset
SELECT claims AS n250_admissions_manager FROM n250_actors WHERE n = 3 \gset
SELECT claims AS n250_admissions_a FROM n250_actors WHERE n = 4 \gset
SELECT claims AS n250_student FROM n250_actors WHERE n = 5 \gset
SELECT claims AS n250_sales_manager_b FROM n250_actors WHERE n = 7 \gset
SELECT claims AS n250_sales_manager_org FROM n250_actors WHERE n = 9 \gset
SELECT jsonb_build_object('sub', pg_temp.n250_id(199), 'role', 'authenticated')::TEXT AS n250_no_member \gset
SELECT pg_temp.n250_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n250_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n250_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n250_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL),
  'invited members have coarse role and bundle NULL');

-- 712's next action is written by the real command (a receipt keeps the 111
-- guard of the lead reads consistent); the owner stays empty.
SET LOCAL request.jwt.claims TO :'n250_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert((platform.mutate_sales_lead_workflow(pg_temp.n250_id(712), 1, pg_temp.n250_id(3001),
  'contacting', NULL, 'N250 перезвонить', DATE '2026-09-30', FALSE, NULL) ->> 'workflow_version') = '2',
  'setup: the next action of 712 is recorded through the command, owner still empty');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1. Rows, counts and «take» per actor; v2 equals v1 for «Все».
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n250_expected(n INTEGER, all_rows TEXT[], waiting_rows TEXT[], takes TEXT[], application_ready BOOLEAN);
INSERT INTO n250_expected VALUES
  (1, pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712), pg_temp.n250_key('lead', 713),
      pg_temp.n250_key('lead', 714), pg_temp.n250_key('lead', 715), pg_temp.n250_key('application', 801),
      pg_temp.n250_key('application', 802), pg_temp.n250_key('consultation', 851), pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712), pg_temp.n250_key('application', 801),
      pg_temp.n250_key('consultation', 851)),
    pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712)), TRUE),
  -- Department Sales Manager A: only the lead of its department's member; a
  -- lead with no owner is outside a department scope (155), so none to take.
  (2, pg_temp.n250_keys(pg_temp.n250_key('lead', 713), pg_temp.n250_key('consultation', 851), pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('consultation', 851)), ARRAY[]::TEXT[], FALSE),
  (3, pg_temp.n250_keys(pg_temp.n250_key('consultation', 851), pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('consultation', 851)), ARRAY[]::TEXT[], FALSE),
  (4, pg_temp.n250_keys(pg_temp.n250_key('consultation', 851), pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('consultation', 851)), ARRAY[]::TEXT[], FALSE),
  (7, pg_temp.n250_keys(pg_temp.n250_key('lead', 714), pg_temp.n250_key('consultation', 851), pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('consultation', 851)), ARRAY[]::TEXT[], FALSE),
  (9, pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712), pg_temp.n250_key('lead', 713),
      pg_temp.n250_key('lead', 714), pg_temp.n250_key('lead', 715), pg_temp.n250_key('consultation', 851),
      pg_temp.n250_key('consultation', 852)),
    pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712), pg_temp.n250_key('consultation', 851)),
    pg_temp.n250_keys(pg_temp.n250_key('lead', 711), pg_temp.n250_key('lead', 712)), FALSE);
GRANT SELECT ON n250_expected TO authenticated;

CREATE FUNCTION pg_temp.n250_check(p_n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e RECORD; org UUID := pg_temp.n250_id(1); v2 JSONB; v1 JSONB; waiting JSONB; tab RECORD; page JSONB;
  label TEXT := 'actor ' || p_n;
BEGIN
  SELECT * INTO STRICT e FROM n250_expected WHERE n = p_n;
  v2 := platform.staff_requests_queue_v2(org, 'all', 'all', 50);
  v1 := platform.staff_requests_queue_v1(org, 'all', 'all', 'all', 50);
  PERFORM pg_temp.n250_assert(pg_temp.n250_rows(v2) = e.all_rows, label || ': «Все» rows are the expected set');
  PERFORM pg_temp.n250_assert(pg_temp.n250_rows(v2) = pg_temp.n250_rows(v1), label || ': «Все» rows equal v1 (no widening)');
  PERFORM pg_temp.n250_assert((v2 -> 'counts' ->> 'website')::INTEGER + (v2 -> 'counts' ->> 'whatsapp')::INTEGER
      = (v1 -> 'counts' ->> 'lead')::INTEGER, label || ': website + WhatsApp equal v1 leads');
  PERFORM pg_temp.n250_assert((v2 -> 'counts' -> 'application') = (v1 -> 'counts' -> 'application')
      AND (v2 -> 'counts' -> 'consultation') = (v1 -> 'counts' -> 'consultation'), label || ': application and consultation counts equal v1');
  PERFORM pg_temp.n250_assert((v2 -> 'states' ->> 'application' = 'ready') = e.application_ready
      AND ((v2 -> 'counts' -> 'application') = 'null'::JSONB) = NOT e.application_ready,
    label || ': an unreadable kind has no count, never zero');
  PERFORM pg_temp.n250_assert(pg_temp.n250_takes(v2) = e.takes, label || ': «take» exactly on the leads the command accepts');
  waiting := platform.staff_requests_queue_v2(org, 'all', 'waiting', 50);
  PERFORM pg_temp.n250_assert(pg_temp.n250_rows(waiting) = e.waiting_rows, label || ': «Ждут разбора» is exactly the untaken');
  PERFORM pg_temp.n250_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(waiting -> 'rows') r
      WHERE r ->> 'kind' = 'lead' AND (r -> 'owner' <> 'null'::JSONB OR (r ->> 'handedOff')::BOOLEAN)),
    label || ': a waiting lead has no owner and was not handed off');
  -- Every tab under both states: its count equals its rows.
  FOR tab IN SELECT * FROM (VALUES ('website', 'website'), ('whatsapp', 'whatsapp'),
      ('platform_application', 'application'), ('portal_consultation', 'consultation')) x(source, count_key),
      (VALUES ('waiting'), ('all')) y(status) LOOP
    page := platform.staff_requests_queue_v2(org, tab.source, tab.status, 50);
    IF page -> 'counts' -> tab.count_key = 'null'::JSONB THEN
      PERFORM pg_temp.n250_assert(jsonb_array_length(page -> 'rows') = 0, label || ': unreadable ' || tab.source || ' has no rows');
    ELSE
      PERFORM pg_temp.n250_assert(jsonb_array_length(page -> 'rows') = (page -> 'counts' ->> tab.count_key)::INTEGER,
        label || ': ' || tab.source || '/' || tab.status || ' count equals rows');
      PERFORM pg_temp.n250_assert((page -> 'counts') = ((CASE WHEN tab.status = 'all' THEN v2 ELSE waiting END) -> 'counts'),
        label || ': tab counts do not depend on the selected tab');
    END IF;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n250_check(INTEGER) TO authenticated;

SET LOCAL request.jwt.claims TO :'n250_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(1);
-- Row shape: owner name, handoff flag, «take» with the fields the command needs.
SELECT platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'all', 'all', 50)::TEXT AS n250_admin_all \gset
SELECT pg_temp.n250_assert(pg_temp.n250_row(:'n250_admin_all'::JSONB, 713) -> 'owner'
  = jsonb_build_object('membershipId', pg_temp.n250_id(302), 'name', 'N250 Actor 2'), 'a taken lead names its owner');
SELECT pg_temp.n250_assert((pg_temp.n250_row(:'n250_admin_all'::JSONB, 715) ->> 'handedOff')::BOOLEAN
  AND pg_temp.n250_row(:'n250_admin_all'::JSONB, 715) -> 'owner' = 'null'::JSONB
  AND pg_temp.n250_row(:'n250_admin_all'::JSONB, 715) -> 'take' = 'null'::JSONB, 'a handed-off lead is flagged and not takeable');
SELECT pg_temp.n250_assert(pg_temp.n250_row(:'n250_admin_all'::JSONB, 712) -> 'take' = jsonb_build_object('workflowVersion', '2',
  'stageKey', 'contacting', 'nextActionText', 'N250 перезвонить', 'nextActionDueDate', '2026-09-30'),
  '«take» carries the version, stage and next action the command requires');
SELECT pg_temp.n250_assert(pg_temp.n250_row(:'n250_admin_all'::JSONB, 711) -> 'take' = jsonb_build_object('workflowVersion', '1',
  'stageKey', 'new', 'nextActionText', NULL, 'nextActionDueDate', NULL), '«take» of a lead without a next action');
SELECT pg_temp.n250_assert((:'n250_admin_all'::JSONB -> 'counts') = jsonb_build_object('website', 4, 'whatsapp', 1,
  'application', 2, 'consultation', 2), 'Admin «Все» counts per tab');
SELECT pg_temp.n250_assert((platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'all', 'waiting', 50) -> 'counts')
  = jsonb_build_object('website', 1, 'whatsapp', 1, 'application', 1, 'consultation', 1), 'Admin «Ждут разбора» counts per tab');
-- The newest request of the source in any state.
SELECT pg_temp.n250_assert(:'n250_admin_all'::JSONB ->> 'latestAt' = '2026-09-25T03:00:00.000000Z'
  AND platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'website', 'waiting', 50) ->> 'latestAt' = '2026-09-23T06:00:00.000000Z',
  'latestAt is the newest request of the selected source, whatever the state');
-- Paging: pages of 2 visit every row once in the queue order, and back.
DO $n250_paging$
DECLARE org UUID := pg_temp.n250_id(1); page JSONB; seen TEXT[] := ARRAY[]::TEXT[]; whole JSONB; guard INTEGER := 0;
BEGIN
  whole := platform.staff_requests_queue_v2(org, 'all', 'all', 50);
  page := platform.staff_requests_queue_v2(org, 'all', 'all', 2);
  LOOP
    seen := seen || ARRAY(SELECT (r ->> 'kind') || ':' || (r ->> 'id') FROM jsonb_array_elements(page -> 'rows') WITH ORDINALITY AS x(r, i) ORDER BY i);
    EXIT WHEN page -> 'nextCursor' = 'null'::JSONB;
    guard := guard + 1;
    PERFORM pg_temp.n250_assert(guard < 10, 'paging terminates');
    page := platform.staff_requests_queue_v2(org, 'all', 'all', 2, page -> 'nextCursor');
  END LOOP;
  PERFORM pg_temp.n250_assert(seen = ARRAY(SELECT (r ->> 'kind') || ':' || (r ->> 'id')
    FROM jsonb_array_elements(whole -> 'rows') WITH ORDINALITY AS x(r, i) ORDER BY i), 'pages of 2 equal the full queue in order');
  page := platform.staff_requests_queue_v2(org, 'all', 'all', 2, page -> 'previousCursor');
  PERFORM pg_temp.n250_assert(jsonb_array_length(page -> 'rows') = 2 AND page -> 'nextCursor' <> 'null'::JSONB,
    'the previous page comes back with a route forward');
  PERFORM pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.staff_requests_queue_v2(%L, 'all', 'waiting', 2, %L::JSONB)$q$,
    org, page -> 'nextCursor')) = '22023:requests_queue_invalid_cursor', 'a cursor is bound to its state');
END
$n250_paging$;
SELECT pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.staff_requests_queue_v2(%L, 'all', 'pending', 50)$q$,
  pg_temp.n250_id(1))) = '22023:requests_queue_invalid_filter', 'an unknown state is refused');
RESET ROLE;

SET LOCAL request.jwt.claims TO :'n250_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(2);
SELECT pg_temp.n250_assert(platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'whatsapp', 'all', 50) -> 'latestAt' = 'null'::JSONB,
  'no request of the source: no «last came» time');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(3);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(4);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(7);
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_sales_manager_org';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_check(9);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. «Взять себе» is the existing command with the fields «take» carried.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n250_take(p_lead INTEGER, p_request INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE page JSONB; take JSONB; me UUID;
BEGIN
  SELECT membership_id INTO me FROM platform.current_actor_authority();
  page := platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'all', 'all', 50);
  take := pg_temp.n250_row(page, p_lead) -> 'take';
  IF take IS NULL OR take = 'null'::JSONB THEN RETURN 'no-take'; END IF;
  RETURN pg_temp.n250_error(format($q$SELECT platform.mutate_sales_lead_workflow(%L, %s, %L, %L, %L, %L, %L, %L, NULL)$q$,
    pg_temp.n250_id(p_lead), take ->> 'workflowVersion', pg_temp.n250_id(p_request), take ->> 'stageKey', me,
    take ->> 'nextActionText', take ->> 'nextActionDueDate', (take ->> 'nextActionText') IS NULL));
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n250_take(INTEGER, INTEGER) TO authenticated;

-- A department Sales Manager: no «take», and the command itself refuses.
SET LOCAL request.jwt.claims TO :'n250_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_take(711, 3101) = 'no-take', 'Sales Manager A is offered no take');
SELECT pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.mutate_sales_lead_workflow(%L, 1, %L, 'new', %L, NULL, NULL, TRUE, NULL)$q$,
  pg_temp.n250_id(711), pg_temp.n250_id(3102), pg_temp.n250_id(302))) = '42501:workflow_not_found_or_forbidden',
  'the command refuses Sales Manager A the unowned lead, as the read said');
RESET ROLE;
-- Admissions (lead.read only): nothing to take, the command refuses.
SET LOCAL request.jwt.claims TO :'n250_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.mutate_sales_lead_workflow(%L, 1, %L, 'new', %L, NULL, NULL, TRUE, NULL)$q$,
  pg_temp.n250_id(711), pg_temp.n250_id(3103), pg_temp.n250_id(304))) = '42501:workflow_not_found_or_forbidden',
  'the command refuses Admissions A');
RESET ROLE;

-- The Admin takes 711; the organization-scoped Sales Manager takes 712.
SET LOCAL request.jwt.claims TO :'n250_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_take(711, 3201) = 'ok', 'the Admin takes 711 with the fields «take» carried');
SELECT platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'all', 'all', 50)::TEXT AS n250_after_admin \gset
SELECT pg_temp.n250_assert(pg_temp.n250_row(:'n250_after_admin'::JSONB, 711) -> 'owner'
    = jsonb_build_object('membershipId', pg_temp.n250_id(301), 'name', 'N250 Actor 1')
  AND pg_temp.n250_row(:'n250_after_admin'::JSONB, 711) -> 'take' = 'null'::JSONB, '711 now names the Admin and offers no take');
SELECT pg_temp.n250_assert((platform.staff_requests_queue_v2(pg_temp.n250_id(1), 'all', 'waiting', 50) -> 'counts' ->> 'website') = '0',
  'a taken lead leaves «Ждут разбора»');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_sales_manager_org';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_take(712, 3202) = 'ok', 'the organization-scoped Sales Manager takes 712');
-- The stale «take» of 711 (version 1, before the Admin took it) is a version conflict.
SELECT pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.mutate_sales_lead_workflow(%L, 1, %L, 'new', %L, NULL, NULL, TRUE, NULL)$q$,
  pg_temp.n250_id(711), pg_temp.n250_id(3203), pg_temp.n250_id(309))) = 'PT409:workflow_version_conflict',
  'a stale take is refused as a version conflict, not applied');
RESET ROLE;
SELECT pg_temp.n250_assert((SELECT array_agg(id::TEXT || '=' || COALESCE(current_owner_membership_id::TEXT, '-') || '/'
    || stage_key || '/' || COALESCE(next_action_text, '-') || '/' || COALESCE(next_action_due_date::TEXT, '-') ORDER BY id)
  FROM platform.leads WHERE id IN (pg_temp.n250_id(711), pg_temp.n250_id(712)))
  = ARRAY[pg_temp.n250_id(711)::TEXT || '=' || pg_temp.n250_id(301)::TEXT || '/new/-/-',
    pg_temp.n250_id(712)::TEXT || '=' || pg_temp.n250_id(309)::TEXT || '/contacting/N250 перезвонить/2026-09-30'],
  'taking changes only the owner: stage and next action stay');
SELECT pg_temp.n250_assert((SELECT count(*) FROM platform.audit_events WHERE action = 'lead.sales.workflow.changed'
    AND request_id IN (pg_temp.n250_id(3201), pg_temp.n250_id(3202))) = 2
  AND (SELECT count(*) FROM platform_private.sales_lead_workflow_receipts
    WHERE request_id IN (pg_temp.n250_id(3201), pg_temp.n250_id(3202))) = 2, 'each take is journaled once with its receipt');

-- ---------------------------------------------------------------------------
-- 3. Refusals, and the function's posture.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n250_read() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n250_error(format($q$SELECT platform.staff_requests_queue_v2(%L, 'all', 'waiting', 50)$q$, pg_temp.n250_id(1)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n250_read() TO authenticated, anon;
SET LOCAL request.jwt.claims TO :'n250_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_read() = '42501:requests_queue_forbidden', 'the Student is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_read() = '42501:requests_queue_forbidden', 'an authenticated user without membership is refused');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n250_assert(pg_temp.n250_read() LIKE '42501:permission denied for %', 'anon cannot execute');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n250_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n250_assert(pg_temp.n250_error(format($q$SELECT platform.staff_requests_queue_v2(%L, 'all', 'waiting', 50)$q$,
  pg_temp.n250_id(2))) = '42501:requests_queue_forbidden', 'another organization is refused');
RESET ROLE;

SELECT pg_temp.n250_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND p.provolatile = 's'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND p.prosrc !~ 'platform_role\s*(NOT\s+)?IN\s*\(' AND p.prosrc !~ 'platform_role\s*<>' AND p.prosrc !~ 'platform_role\s*='
  FROM pg_proc p WHERE p.oid = 'platform.staff_requests_queue_v2(uuid,text,text,integer,jsonb)'::REGPROCEDURE),
  'SECURITY DEFINER, empty search_path, STABLE, authenticated-only EXECUTE, no coarse-role gate');
SELECT pg_temp.n250_assert(has_function_privilege('authenticated',
    'platform.staff_requests_queue_v1(uuid,text,text,text,integer,jsonb)'::REGPROCEDURE, 'EXECUTE'),
  'v1 stays for the previous release');

SELECT 'N250_REQUESTS_QUEUE_TRIAGE_SUITE_PASS' AS n250_suite_marker;
ROLLBACK;
