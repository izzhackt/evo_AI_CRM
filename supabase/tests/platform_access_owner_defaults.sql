\set ON_ERROR_STOP on
-- Boundary suite for migration 248 (owner decisions B and C of 26.09.2026).
-- Members are modelled EXACTLY like production, with the fixtures of the 244
-- suite (supabase/tests/platform_access_by_permissions.sql): invited staff
-- have organization_memberships.current_role NULL, so
-- current_actor_authority().platform_role is NULL and the JWT says 'staff';
-- permissions come only from scoped role assignments with the production
-- permission keys: Admissions (35 keys, own scope), Admissions Manager (36 keys,
-- department scope), Sales Manager (23 keys, department scope) and the two
-- «общие разделы» roles (organization scope). Only the system Admin carries
-- the coarse role.
-- Proves, both ways:
--  B) a case a curator declined reads and is assigned by the Admissions
--     Manager of that curator's department (queue views, counts, case read,
--     curator options, assignment, reassignment after a second decline), and
--     by nobody else new: not the curator who declined, not Admissions, not
--     the Sales Manager, not the Student, not anonymous callers; a case
--     declined by a curator outside the department and a pre-sale cabinet
--     stay out of the manager's reach; the widening is read-only.
--  C) the Sales Manager prepares, dispatches, reissues and finalizes the
--     student-cabinet invite of its own department's lead; the other
--     department's Sales Manager, Admissions, the Admissions Manager, the
--     Student and anonymous callers are refused; email, replay and
--     reservation checks hold; the Admin-only invite shapes stay Admin-only.
-- A decline itself cannot be committed through 182's command today: 042's
-- case guard refuses active -> pending (section 1 shows the 55000; a
-- pre-existing defect recorded separately, not changed by 248), so the
-- fixture writes the state that command is designed to leave.
-- Isolated synthetic SQL fixtures only -- no Auth invitation email, real
-- person, provider or production action.
BEGIN;

-- The disposable Auth schema has no confirmation columns; the invite dispatch
-- and finalize read them, so add them transaction-locally (as the 185 suite
-- does) and let ROLLBACK discard the DDL with every row.
ALTER TABLE auth.users
  ADD COLUMN confirmation_sent_at TIMESTAMPTZ,
  ADD COLUMN email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN confirmed_at TIMESTAMPTZ;

DO $n248_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n248_auth_role$;

CREATE FUNCTION pg_temp.n248_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24800000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n248_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N248: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n248_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Sorted case ids of a JSONB rows array.
CREATE FUNCTION pg_temp.n248_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n248_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.n248_id(x) ORDER BY pg_temp.n248_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n248_id(INTEGER), pg_temp.n248_assert(BOOLEAN, TEXT),
  pg_temp.n248_error(TEXT), pg_temp.n248_case_ids(JSONB), pg_temp.n248_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N248_ACCESS_OWNER_DEFAULTS_SUITE_START' AS n248_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (sales department A), 3 Admissions Manager, 4 Admissions A,
-- 6 Admissions B (admissions department), 7 Sales Manager (sales department
-- B); 5 Student (case 505), 8 Student B (case 504), 9 Student C (case 506).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n248_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n248_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, 'student'), (9, 'student');
GRANT SELECT ON n248_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n248_id(1), 'N248 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n248_id(100 + n), 'n248-' || n || '@example.invalid', '{}'::JSONB FROM n248_actors;
-- An authenticated identity with no membership at all.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n248_id(199), 'n248-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n248_id(200 + n), pg_temp.n248_id(100 + n), 'N248 Actor ' || n, 'active', 1 FROM n248_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n248_id(300 + n), pg_temp.n248_id(1), pg_temp.n248_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n248_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n248_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n248_id(401), pg_temp.n248_id(1), 'organization', pg_temp.n248_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n248_id(1), pg_temp.n248_id(301), pg_temp.n248_id(401), 1, 1, TRUE, 'system',
    'N248 synthetic organization scope', pg_temp.n248_id(601));

-- Departments in the production shape: sales A (2), sales B (7), admissions (3, 4, 6).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n248_id(901), pg_temp.n248_id(1), 'N248 Sales A'),
  (pg_temp.n248_id(902), pg_temp.n248_id(1), 'N248 Admissions'),
  (pg_temp.n248_id(903), pg_temp.n248_id(1), 'N248 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n248_id(1), pg_temp.n248_id(302), pg_temp.n248_id(901)),
  (pg_temp.n248_id(1), pg_temp.n248_id(303), pg_temp.n248_id(902)),
  (pg_temp.n248_id(1), pg_temp.n248_id(304), pg_temp.n248_id(902)),
  (pg_temp.n248_id(1), pg_temp.n248_id(306), pg_temp.n248_id(902)),
  (pg_temp.n248_id(1), pg_temp.n248_id(307), pg_temp.n248_id(903));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin (outside the admissions department); 504 and 506 pending
-- after a sale (handoff evidence; portals already activated for Students B
-- and C) — the suite hands them to a curator and lets the curator decline, the
-- only way a case needs a curator; 505 active, curator A, the Student's own
-- case with an activated portal.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n248_id(420 + k), pg_temp.n248_id(1), 'student_case', pg_temp.n248_id(500 + k), 1
  FROM generate_series(1, 6) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.n248_id(500 + f.k), pg_temp.n248_id(1), pg_temp.n248_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n248_id(f.curator) END,
  'synthetic:n248:' || f.k, 'N248 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  pg_temp.n248_id(420 + f.k), 1, 'new',
  CASE f.k WHEN 5 THEN pg_temp.n248_id(305) WHEN 4 THEN pg_temp.n248_id(308) WHEN 6 THEN pg_temp.n248_id(309) END,
  CASE WHEN f.k IN (4, 5, 6) THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, NULL, 'pending'), (5, 304, 'active'),
  (6, NULL, 'pending'))
  AS f(k, curator, state);
-- Clients and leads: 702 and 708 owned by Sales Manager A (2), 704 owned by
-- Sales Manager B (7); 706 and 710 (A) carry the sales of the pending cases
-- 504 and 506.
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.n248_id(701), pg_temp.n248_id(1), 'N248 Client A', platform_private.normalize_person_name('N248 Client A')),
  (pg_temp.n248_id(703), pg_temp.n248_id(1), 'N248 Client B', platform_private.normalize_person_name('N248 Client B')),
  (pg_temp.n248_id(705), pg_temp.n248_id(1), 'N248 Client C', platform_private.normalize_person_name('N248 Client C')),
  (pg_temp.n248_id(707), pg_temp.n248_id(1), 'N248 Client D', platform_private.normalize_person_name('N248 Client D')),
  (pg_temp.n248_id(709), pg_temp.n248_id(1), 'N248 Client E', platform_private.normalize_person_name('N248 Client E'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.n248_id(702), pg_temp.n248_id(1), pg_temp.n248_id(701), pg_temp.n248_id(302), 'new', 'website'),
  (pg_temp.n248_id(704), pg_temp.n248_id(1), pg_temp.n248_id(703), pg_temp.n248_id(307), 'new', 'website'),
  (pg_temp.n248_id(706), pg_temp.n248_id(1), pg_temp.n248_id(705), pg_temp.n248_id(302), 'new', 'website'),
  (pg_temp.n248_id(708), pg_temp.n248_id(1), pg_temp.n248_id(707), pg_temp.n248_id(302), 'new', 'website'),
  (pg_temp.n248_id(710), pg_temp.n248_id(1), pg_temp.n248_id(709), pg_temp.n248_id(302), 'new', 'website');
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links)
SELECT pg_temp.n248_id(1), pg_temp.n248_id(h.lead), pg_temp.n248_id(h.client), pg_temp.n248_id(h.student_case),
  'canonical-lead:' || pg_temp.n248_id(h.lead)::TEXT, 'normal', 'N248 synthetic sale handoff',
  pg_temp.n248_id(302), pg_temp.n248_id(202), pg_temp.n248_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB
FROM (VALUES (706, 705, 504), (710, 709, 506)) AS h(lead, client, student_case);
SET LOCAL session_replication_role = origin;
-- The Student signs in to the organization and reads only the own case
-- (student_case scope of 505), the provisioned portal shape.
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n248_id(1), pg_temp.n248_id(305), pg_temp.n248_id(401), 1, 1, TRUE, 'system',
    'N248 synthetic Student organization scope', pg_temp.n248_id(604)),
  (pg_temp.n248_id(1), pg_temp.n248_id(305), pg_temp.n248_id(425), 1, 1, TRUE, 'system',
    'N248 synthetic Student case scope', pg_temp.n248_id(605));

-- Roles with the EXACT production permission keys (26.09 read-only audit).
CREATE TEMP TABLE n248_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n248_roles VALUES
 (pg_temp.n248_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n248_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n248_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n248_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n248_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n248_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n248_grants VALUES
 (302, pg_temp.n248_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n248_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n248_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n248_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n248_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n248_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n248_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n248_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n248_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n248_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n248_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n248_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n248_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n248_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n248_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n248_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n248_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n248_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n248_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n248_id(1);
GRANT SELECT ON n248_roles, n248_grants, n248_versions TO authenticated;

SELECT pg_temp.n248_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n248_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n248_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n248_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n248_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n248_admin_setup';
SET LOCAL ROLE authenticated;
DO $n248_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n248_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n248_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N248 ' || r.label, 'description', 'Migration 248 synthetic role',
        'permissionKeys', r.keys), 'N248 create role', pg_temp.n248_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n248_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n248_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N248 publish role', pg_temp.n248_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n248_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n248_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n248_id(1), pg_temp.n248_id(m),
      (SELECT access_version FROM n248_versions WHERE membership_id = pg_temp.n248_id(m)), items, bindings,
      'N248 grant roles', pg_temp.n248_id(2000 + m));
  END LOOP;
END
$n248_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions, all minted
-- by the installed token hook (staff and Student).
UPDATE n248_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n248_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n248_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT claims AS n248_admin FROM n248_actors WHERE n = 1 \gset
SELECT claims AS n248_sales_manager FROM n248_actors WHERE n = 2 \gset
SELECT claims AS n248_admissions_manager FROM n248_actors WHERE n = 3 \gset
SELECT claims AS n248_admissions_a FROM n248_actors WHERE n = 4 \gset
SELECT claims AS n248_student FROM n248_actors WHERE n = 5 \gset
SELECT claims AS n248_admissions_b FROM n248_actors WHERE n = 6 \gset
SELECT claims AS n248_sales_manager_b FROM n248_actors WHERE n = 7 \gset
SELECT claims AS n248_student_b FROM n248_actors WHERE n = 8 \gset
SELECT jsonb_build_object('sub', pg_temp.n248_id(199), 'role', 'authenticated')::TEXT AS n248_no_member \gset
SELECT pg_temp.n248_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n248_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'student', 'student'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n248_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n248_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n248_ids(302, 303, 304, 306, 307))), 'invited members have coarse role and bundle NULL');

-- Each invited member resolves with coarse role NULL.
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert((SELECT count(*) = 1 AND bool_and(platform_role IS NULL AND membership_id = pg_temp.n248_id(304))
  FROM platform.current_actor_authority()), 'Admissions A resolves with platform_role NULL');

RESET ROLE;

-- Helpers: the case ids of one «Студенты» view and its number, both read by
-- the current actor through the real queue reads.
CREATE FUNCTION pg_temp.n248_view(p_view TEXT) RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT pg_temp.n248_case_ids(platform.staff_student_case_queue_v1(p_view, 100) -> 'rows')
$$;
CREATE FUNCTION pg_temp.n248_view_count(p_view TEXT) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (platform.staff_student_case_queue_counts_v1(p_view) -> 'views' ->> p_view)::INTEGER
$$;
CREATE FUNCTION pg_temp.n248_can_read(p_case INTEGER) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT private.platform_can_read_student_case(pg_temp.n248_id(1), pg_temp.n248_id(p_case))
$$;
CREATE FUNCTION pg_temp.n248_assign(p_case INTEGER, p_curator INTEGER, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format($q$SELECT platform.assign_case_curator_v1(%L, %L, %L, %L, 'N248 assign curator')$q$,
    pg_temp.n248_id(1), pg_temp.n248_id(p_request), pg_temp.n248_id(p_case), pg_temp.n248_id(p_curator)))
$$;
CREATE FUNCTION pg_temp.n248_options() RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format('SELECT platform.staff_student_portal_curator_options(%L)', pg_temp.n248_id(1)))
$$;
-- The curator declines. 182's command (private.respond_student_case_handoff)
-- cannot commit a decline today: 042's trigger
-- platform_private.guard_student_case_transition refuses both the
-- active -> pending transition and clearing a set handoff_at, so the command
-- fails with 55000 for every caller (shown below; a pre-existing defect of
-- 182, recorded separately and not changed by 248). The fixture therefore
-- writes, as the table owner, exactly the state 182's decline is designed to
-- leave (182:392-436): the case pending without curator and handoff time, and
-- the 'declined' lifecycle event of the curator. Everything 248 changes is
-- then exercised through the real commands and reads.
CREATE FUNCTION pg_temp.n248_decline(p_case INTEGER, p_curator INTEGER, p_request INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE platform.student_cases SET state = 'pending', current_curator_membership_id = NULL, handoff_at = NULL
    WHERE organization_id = pg_temp.n248_id(1) AND id = pg_temp.n248_id(p_case) AND state = 'active'
      AND current_curator_membership_id = pg_temp.n248_id(p_curator);
  PERFORM pg_temp.n248_assert(FOUND, 'fixture decline: the curator holds the active case');
  INSERT INTO platform.student_case_lifecycle_events(organization_id, student_case_id, event_type, previous_state,
    new_state, actor_membership_id, reason, request_id)
  VALUES (pg_temp.n248_id(1), pg_temp.n248_id(p_case), 'declined', 'active', 'pending', pg_temp.n248_id(p_curator),
    'N248 synthetic decline', pg_temp.n248_id(p_request));
  SET LOCAL session_replication_role = origin;
END
$$;
-- The real 182 command, to show the defect above.
CREATE FUNCTION pg_temp.n248_decline_command(p_case INTEGER, p_request INTEGER) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE assignment_id UUID;
BEGIN
  SELECT e.id INTO assignment_id FROM platform.student_case_assignment_events e
    WHERE e.organization_id = pg_temp.n248_id(1) AND e.student_case_id = pg_temp.n248_id(p_case)
    ORDER BY e.new_scope_version DESC LIMIT 1;
  RETURN pg_temp.n248_error(format($q$SELECT platform.respond_student_case_handoff(%L, %L, %L, NULL, 'declined', 'N248 synthetic decline', NULL, %L)$q$,
    pg_temp.n248_id(1), pg_temp.n248_id(p_case), assignment_id, pg_temp.n248_id(p_request)));
END
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n248_view(TEXT), pg_temp.n248_view_count(TEXT), pg_temp.n248_can_read(INTEGER),
  pg_temp.n248_assign(INTEGER, INTEGER, INTEGER), pg_temp.n248_options(), pg_temp.n248_decline_command(INTEGER, INTEGER)
  TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. A curator of the admissions department declines a sold case.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 306, 3001) = 'ok', 'the Admin hands 504 to Admissions B');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_can_read(504), 'while 504 is active under Admissions B the manager reads it (department)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_decline_command(504, 3002) = '55000:First student-case handoff timestamp is immutable',
  'the 182 decline command is refused by the 042 case guard (pre-existing, recorded separately)');
RESET ROLE;
SELECT pg_temp.n248_decline(504, 306, 3003);
SELECT pg_temp.n248_assert((SELECT state = 'pending' AND current_curator_membership_id IS NULL
  FROM platform.student_cases WHERE id = pg_temp.n248_id(504)), '504 is pending without a curator again');
SELECT pg_temp.n248_assert(platform_private.needs_curator_case_last_curator(pg_temp.n248_id(1), pg_temp.n248_id(504))
  = pg_temp.n248_id(306), 'the last curator of 504 is Admissions B, who declined it');
SELECT pg_temp.n248_assert(platform_private.needs_curator_case_last_curator(pg_temp.n248_id(1), pg_temp.n248_id(501)) IS NULL
  AND platform_private.needs_curator_case_last_curator(pg_temp.n248_id(1), pg_temp.n248_id(506)) IS NULL,
  'an active case and a never-declined pending case have no last curator');
SELECT pg_temp.n248_assert(NOT platform_private.staff_can_access(pg_temp.n248_id(1), pg_temp.n248_id(303),
  'case.read.full', 'student_case', pg_temp.n248_id(504)),
  'the department scope alone does not cover the declined case (its owner is the Sales member)');

-- ---------------------------------------------------------------------------
-- 2. B: the Admissions Manager sees the declined case of its department.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_can_read(504), 'the manager reads the declined case (empty before 248)');
SELECT pg_temp.n248_assert(pg_temp.n248_view('pending') = pg_temp.n248_ids(504)
  AND pg_temp.n248_view_count('pending') = 1, '«Ожидает начала»: 504, and the number equals the rows');
SELECT pg_temp.n248_assert(pg_temp.n248_view('needs_curator') = pg_temp.n248_ids(504)
  AND pg_temp.n248_view_count('needs_curator') = 1, '«Ждут куратора»: 504, and the number equals the rows');
SELECT pg_temp.n248_assert(pg_temp.n248_id(504) = ANY (pg_temp.n248_view('needs_action')),
  '«Требуют действия» includes the case that needs a curator');
SELECT pg_temp.n248_assert(pg_temp.n248_view('active') = pg_temp.n248_ids(501, 502, 505),
  'the active cases the manager reads are unchanged');
SELECT pg_temp.n248_assert((SELECT count(*) = 1 AND bool_and(access_mode = 'full')
  FROM platform.staff_student_case_read_snapshot(pg_temp.n248_id(504))), 'the case page opens in full');
SELECT pg_temp.n248_assert(platform.staff_case_attention_flags_v1(pg_temp.n248_id(504)) = ARRAY['needs_curator'],
  'the case header reads «нужен куратор»');
-- Read-only: a case write checks its own permission on the case.
SELECT pg_temp.n248_assert(pg_temp.n248_error(format($q$SELECT platform.move_case_pipeline_v1(%L, %L, 'shortlist', FALSE, %L)$q$,
  pg_temp.n248_id(1), pg_temp.n248_id(504), gen_random_uuid())) = '42501:case_pipeline_forbidden',
  'the manager cannot write to the declined case through the read rule');
RESET ROLE;

-- Nobody else gains the case.
SET LOCAL request.jwt.claims TO :'n248_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504) AND pg_temp.n248_view('pending') = ARRAY[]::UUID[],
  'the curator who declined does not get the case back');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504) AND pg_temp.n248_view('needs_curator') = ARRAY[]::UUID[],
  'Admissions A (own scope, no case.curator.assign) does not read it');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_error($q$SELECT platform.staff_student_case_queue_v1('pending', 100)$q$)
  = '42501:Staff admissions authority required', 'the Sales Manager still has no case queue');
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504), 'the Sales Manager does not read the case in full');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_student_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504), 'the case''s own Student does not pass the staff read');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504), 'an authenticated user without membership does not read it');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
-- (506 carries a sale while pending and no curator ever held it — a state
-- only a fixture makes; the flag counts it, the rule does not: nobody
-- declined it.)
SELECT pg_temp.n248_assert(pg_temp.n248_can_read(504) AND pg_temp.n248_view('needs_curator') = pg_temp.n248_ids(504, 506),
  'the Admin reads it as before');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3. B: curator options for holders of case.curator.assign.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT platform.staff_student_portal_curator_options(pg_temp.n248_id(1)) AS n248_admin_options \gset
RESET ROLE;
SELECT pg_temp.n248_assert((SELECT array_agg((o ->> 'membership_id')::UUID ORDER BY (o ->> 'membership_id'))
  FROM jsonb_array_elements(:'n248_admin_options'::JSONB -> 'owners') o) = pg_temp.n248_ids(301, 303, 304, 306),
  'the eligible curators are the Admin and the three admissions members');
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(platform.staff_student_portal_curator_options(pg_temp.n248_id(1)) = :'n248_admin_options'::JSONB,
  'the manager lists the same curators (Admin only before 248)');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_options() = '42501:Active Platform permission is required',
  'Admissions (no case.curator.assign) cannot list curators');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_options() = '42501:Active Platform permission is required',
  'the Sales Manager cannot list curators');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_options() = '42501:Active Platform permission is required',
  'the Student cannot list curators');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n248_assert(pg_temp.n248_options() LIKE '42501:permission denied for %', 'anon cannot list curators');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4. B: the manager assigns and, after another decline, reassigns.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 304, 3101) = '42501:Active Platform permission is required',
  'Admissions cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 304, 3102) = '42501:Active Platform permission is required',
  'the curator who declined cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 304, 3103) = '42501:Active Platform permission is required',
  'the Sales Manager cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 304, 3104) = '42501:Active Platform permission is required',
  'the Student cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 304, 3105) LIKE '42501:permission denied for %', 'anon cannot assign');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT platform.assign_case_curator_v1(pg_temp.n248_id(1), pg_temp.n248_id(3107), pg_temp.n248_id(504),
  pg_temp.n248_id(304), 'N248 assign curator') AS n248_manager_assign \gset
SELECT pg_temp.n248_assert(:'n248_manager_assign'::JSONB ->> 'assignment_type' = 'assigned'
  AND :'n248_manager_assign'::JSONB ->> 'case_state' = 'active'
  AND :'n248_manager_assign'::JSONB ->> 'curator_membership_id' = pg_temp.n248_id(304)::TEXT,
  'the manager assigns Admissions A (System Admin was required before 248)');
SELECT pg_temp.n248_assert(platform.assign_case_curator_v1(pg_temp.n248_id(1), pg_temp.n248_id(3107), pg_temp.n248_id(504),
  pg_temp.n248_id(304), 'N248 assign curator') = :'n248_manager_assign'::JSONB, 'an exact replay returns the same receipt');
SELECT pg_temp.n248_assert(pg_temp.n248_assign(504, 306, 3108) = '55000:Case does not need a curator assignment',
  'an assigned case no longer needs a curator');
SELECT pg_temp.n248_assert(pg_temp.n248_can_read(504) AND pg_temp.n248_view('needs_curator') = ARRAY[]::UUID[],
  'the case is in work in the manager''s department and no longer waits');
RESET ROLE;
SELECT pg_temp.n248_assert((SELECT actor_profile_id = pg_temp.n248_id(203) FROM platform.audit_events
  WHERE action = 'case.curator.set' AND request_id = pg_temp.n248_id(3107)), 'the assignment is journaled under the manager');

-- Admissions A declines too; the manager reassigns within the department.
SELECT pg_temp.n248_decline(504, 304, 3109);
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504), 'Admissions A loses the case it declined');
RESET ROLE;
SELECT pg_temp.n248_assert(platform_private.needs_curator_case_last_curator(pg_temp.n248_id(1), pg_temp.n248_id(504))
  = pg_temp.n248_id(304), 'the latest decline decides the last curator');
SET LOCAL request.jwt.claims TO :'n248_admissions_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(504), 'an earlier decliner does not read it either');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_view('needs_curator') = pg_temp.n248_ids(504), 'the manager sees it waiting again');
SELECT pg_temp.n248_assert(platform.assign_case_curator_v1(pg_temp.n248_id(1), pg_temp.n248_id(3110), pg_temp.n248_id(504),
  pg_temp.n248_id(306), 'N248 reassign curator') ->> 'curator_membership_id' = pg_temp.n248_id(306)::TEXT,
  'the manager reassigns 504 to Admissions B');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5. B boundary: a curator outside the department declined (the Admin as
-- curator); a pre-sale cabinet (section 6) is checked there.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(506, 301, 3201) = 'ok', 'the Admin takes 506 as its curator');
RESET ROLE;
SELECT pg_temp.n248_decline(506, 301, 3202);
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_can_read(506), 'the Admin still reads 506');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT pg_temp.n248_can_read(506) AND pg_temp.n248_view('needs_curator') = ARRAY[]::UUID[],
  'a case declined outside the department stays out of the manager''s reach');
SELECT pg_temp.n248_assert(pg_temp.n248_assign(506, 304, 3203) = '42501:Student case is unavailable',
  'and the manager cannot assign it');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_assign(506, 304, 3204) = 'ok', 'the Admin assigns it organization-wide');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 6. C: the Sales Manager runs the cabinet invite of its department's lead.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.n248_prepare(p_case UUID, p_email TEXT, p_shape TEXT, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format($q$SELECT platform.prepare_student_portal_provisioning(%L, %L, %L, 'N248 Cabinet Student', %L, NULL, 'N248 cabinet invite', %L)$q$,
    pg_temp.n248_id(1), p_case, p_email, p_shape, pg_temp.n248_id(p_request)))
$$;
CREATE FUNCTION pg_temp.n248_origin(p_case UUID) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format('SELECT platform.staff_student_case_cabinet_origin_v1(%L, %L)', pg_temp.n248_id(1), p_case))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n248_prepare(UUID, TEXT, TEXT, INTEGER), pg_temp.n248_origin(UUID) TO authenticated, anon;

SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT (platform.prepare_lead_cabinet_v1(pg_temp.n248_id(1), pg_temp.n248_id(3301), pg_temp.n248_id(702))
  ->> 'student_case_id') AS n248_cabinet_one \gset
SELECT (platform.prepare_lead_cabinet_v1(pg_temp.n248_id(1), pg_temp.n248_id(3302), pg_temp.n248_id(708))
  ->> 'student_case_id') AS n248_cabinet_two \gset
SELECT pg_temp.n248_assert(platform.staff_student_case_cabinet_origin_v1(pg_temp.n248_id(1), :'n248_cabinet_one'),
  'the lead card of the Sales Manager learns the case is its lead''s cabinet (42501 before 248)');
SELECT pg_temp.n248_assert(pg_temp.n248_origin(pg_temp.n248_id(504)) = '42501:portal_case_unreadable',
  'the Sales Manager learns nothing about a case that is not its lead''s cabinet');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT (platform.prepare_lead_cabinet_v1(pg_temp.n248_id(1), pg_temp.n248_id(3303), pg_temp.n248_id(704))
  ->> 'student_case_id') AS n248_cabinet_other \gset
SELECT pg_temp.n248_assert(pg_temp.n248_origin(:'n248_cabinet_one') = '42501:portal_case_unreadable',
  'the other department''s Sales Manager does not read the cabinet origin');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(platform.staff_student_case_cabinet_origin_v1(pg_temp.n248_id(1), :'n248_cabinet_one'),
  'the Admin reads the cabinet origin as before');
RESET ROLE;
-- B boundary: a pre-sale cabinet is Sales' — the manager never reads it.
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(NOT private.platform_can_read_student_case(pg_temp.n248_id(1), :'n248_cabinet_one')
  AND pg_temp.n248_view('pending') = ARRAY[]::UUID[]
  AND pg_temp.n248_origin(:'n248_cabinet_one') = '42501:portal_case_unreadable',
  'the Admissions Manager does not read a pre-sale cabinet');
RESET ROLE;

-- Refusals first: nothing below may leave a receipt.
SET LOCAL request.jwt.claims TO :'n248_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3310)
  = '42501:portal_admin_authority_changed', 'the other department''s Sales Manager cannot prepare the invite');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3310)
  = '42501:portal_admin_authority_changed', 'Admissions cannot prepare the invite');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3310)
  = '42501:portal_admin_authority_changed', 'the Admissions Manager cannot prepare the invite');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_student';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3310)
  = '42501:portal_admin_authority_changed', 'the Student cannot prepare the invite');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3310)
  = '42501:portal_admin_authority_changed', 'an authenticated user without membership cannot prepare the invite');
RESET ROLE;
SET LOCAL request.jwt.claims TO '';
SET LOCAL ROLE anon;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-refused@example.invalid', 'cabinet_pending', 3311)
  LIKE '42501:permission denied for %', 'anon cannot prepare the invite');
RESET ROLE;
SELECT pg_temp.n248_assert(NOT EXISTS (SELECT 1 FROM platform_private.student_portal_provisioning_receipts
  WHERE organization_id = pg_temp.n248_id(1)), 'no refused call left a receipt');

SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'not-an-email', 'cabinet_pending', 3312)
  = '22023:invalid student portal provisioning input', 'the email check holds');
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(pg_temp.n248_id(501), 'n248-u6@example.invalid', 'normal_u6', 3313)
  = '42501:System Admin is required', 'the post-handoff invite of an active case stays Admin-only');
SELECT platform.prepare_student_portal_provisioning(pg_temp.n248_id(1), :'n248_cabinet_one', 'N248-One@Example.invalid',
  'N248 Cabinet Student', 'cabinet_pending', NULL, 'N248 cabinet invite', pg_temp.n248_id(3314)) AS n248_prepared_one \gset
SELECT pg_temp.n248_assert(:'n248_prepared_one'::JSONB ->> 'case_shape' = 'cabinet_pending'
  AND :'n248_prepared_one'::JSONB ->> 'provisioning_state' = 'prepared'
  AND (:'n248_prepared_one'::JSONB ->> 'replayed')::BOOLEAN = FALSE,
  'the Sales Manager prepares the invite (portal_admin_authority_changed before 248)');
SELECT pg_temp.n248_assert(platform.prepare_student_portal_provisioning(pg_temp.n248_id(1), :'n248_cabinet_one',
  'N248-One@Example.invalid', 'N248 Cabinet Student', 'cabinet_pending', NULL, 'N248 cabinet invite',
  pg_temp.n248_id(3314)) ->> 'receipt_id' = :'n248_prepared_one'::JSONB ->> 'receipt_id',
  'an exact replay returns the same receipt');
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_one', 'n248-other@example.invalid', 'cabinet_pending', 3314)
  = 'PT409:request_replay_conflict', 'the same request with another email is a conflict');
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_two', 'n248-one@example.invalid', 'cabinet_pending', 3315)
  = 'PT409:portal_email_already_reserved', 'an email already invited is not invited twice');
SELECT platform.prepare_student_portal_provisioning(pg_temp.n248_id(1), :'n248_cabinet_two', 'n248-two@example.invalid',
  'N248 Cabinet Student', 'cabinet_pending', NULL, 'N248 cabinet invite', pg_temp.n248_id(3316)) AS n248_prepared_two \gset
RESET ROLE;
SELECT pg_temp.n248_assert((SELECT authorizing_membership_id = pg_temp.n248_id(302)
    AND required_permission_keys = ARRAY['lead.sales.workflow.manage']::TEXT[] AND normalized_email = 'n248-one@example.invalid'
  FROM platform_private.student_portal_provisioning_receipts WHERE id = (:'n248_prepared_one'::JSONB ->> 'receipt_id')::UUID),
  'the receipt records the Sales Manager with the lead permission only');
SET LOCAL request.jwt.claims TO :'n248_admin';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_prepare(:'n248_cabinet_other', 'n248-admin@example.invalid', 'cabinet_pending', 3317) = 'ok',
  'the Admin still prepares any cabinet invite');
RESET ROLE;

-- Dispatch (service role), then reissue after expiry by the Sales Manager.
SET LOCAL ROLE service_role;
SELECT platform.claim_student_portal_invite((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID, pg_temp.n248_id(3401), 1, 0)
  ->> 'provisioning_state' AS n248_claim_two \gset
RESET ROLE;
INSERT INTO auth.users(id, email, raw_user_meta_data, confirmation_sent_at)
  VALUES (pg_temp.n248_id(191), 'n248-two@example.invalid', '{}'::JSONB, statement_timestamp() - INTERVAL '3 hours');
SET LOCAL ROLE service_role;
SELECT platform.record_student_portal_invite_success((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID,
  pg_temp.n248_id(3401), 2, 1, pg_temp.n248_id(191), 3600) ->> 'invite_delivery_status' AS n248_issued_two \gset
RESET ROLE;
SELECT pg_temp.n248_assert(:'n248_claim_two' = 'dispatching' AND :'n248_issued_two' = 'issued'
  AND (SELECT invite_expires_at < statement_timestamp() FROM platform_private.student_portal_provisioning_receipts
    WHERE id = (:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID), 'the invite was issued and has expired');
CREATE FUNCTION pg_temp.n248_reissue(p_receipt UUID, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format($q$SELECT platform.authorize_student_portal_invite_reissue(%L, 3, 1, %L, 'N248 reissue')$q$,
    p_receipt, pg_temp.n248_id(p_request)))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n248_reissue(UUID, INTEGER) TO authenticated;
SET LOCAL request.jwt.claims TO :'n248_sales_manager_b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_reissue((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID, 3402)
  = '42501:portal_admin_authority_changed', 'the other department''s Sales Manager cannot reissue');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_admissions_manager';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n248_assert(pg_temp.n248_reissue((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID, 3403)
  = '42501:portal_admin_authority_changed', 'the Admissions Manager cannot reissue');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n248_sales_manager';
SET LOCAL ROLE authenticated;
SELECT platform.authorize_student_portal_invite_reissue((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID, 3, 1,
  pg_temp.n248_id(3404), 'N248 reissue') AS n248_reissued \gset
SELECT pg_temp.n248_assert(:'n248_reissued'::JSONB ->> 'invite_delivery_status' = 'expired'
  AND :'n248_reissued'::JSONB ->> 'reissue_request_id' = pg_temp.n248_id(3404)::TEXT,
  'the Sales Manager authorizes the reissue of its expired invite');
SELECT pg_temp.n248_assert(platform.authorize_student_portal_invite_reissue((:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID,
  3, 1, pg_temp.n248_id(3404), 'N248 reissue') ->> 'replayed' = 'true', 'the reissue request replays');
RESET ROLE;
SELECT pg_temp.n248_assert((SELECT reissue_authorized_by_membership_id = pg_temp.n248_id(302)
  FROM platform_private.student_portal_provisioning_receipts WHERE id = (:'n248_prepared_two'::JSONB ->> 'receipt_id')::UUID),
  'the reissue records the Sales Manager');

-- Acceptance: finalize re-checks the preparer's live lead permission.
SET LOCAL ROLE service_role;
SELECT platform.claim_student_portal_invite((:'n248_prepared_one'::JSONB ->> 'receipt_id')::UUID, pg_temp.n248_id(3501), 1, 0)
  ->> 'provisioning_state' AS n248_claim_one \gset
RESET ROLE;
INSERT INTO auth.users(id, email, raw_user_meta_data, confirmation_sent_at)
  VALUES (pg_temp.n248_id(192), 'n248-one@example.invalid', '{}'::JSONB, statement_timestamp());
SET LOCAL ROLE service_role;
SELECT platform.record_student_portal_invite_success((:'n248_prepared_one'::JSONB ->> 'receipt_id')::UUID,
  pg_temp.n248_id(3501), 2, 1, pg_temp.n248_id(192), 3600) ->> 'receipt_version' AS n248_issued_one \gset
SELECT platform.finalize_student_portal_authority((:'n248_prepared_one'::JSONB ->> 'receipt_id')::UUID, 3, 1)
  AS n248_finalized_one \gset
RESET ROLE;
-- Since 193 an invite goes through the анкета: finalize binds the Student
-- membership and returns before activation (account pending).
SELECT pg_temp.n248_assert(:'n248_claim_one' = 'dispatching' AND :'n248_issued_one' = '3'
  AND :'n248_finalized_one'::JSONB ->> 'provisioning_state' = 'invite_succeeded'
  AND :'n248_finalized_one'::JSONB ->> 'authority_activated' = 'false'
  AND :'n248_finalized_one'::JSONB ->> 'student_membership_id' IS NOT NULL,
  'finalize accepts the invite the Sales Manager prepared (42501 at its preparer check before 248)');
SELECT pg_temp.n248_assert((SELECT state = 'pending' AND current_curator_membership_id IS NULL AND handoff_at IS NULL
    AND student_membership_id = (:'n248_finalized_one'::JSONB ->> 'student_membership_id')::UUID
  FROM platform.student_cases WHERE id = :'n248_cabinet_one'), 'the cabinet is bound to the Student; no curator, no handoff');

-- The stored preparer check: only a live holder of the lead permission.
CREATE FUNCTION pg_temp.n248_stored(p_membership INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n248_error(format('SELECT platform_private.assert_student_portal_cabinet_membership_e1(%L, %L, %L)',
    pg_temp.n248_id(1), pg_temp.n248_id(p_membership), pg_temp.n248_id(702)))
$$;
SELECT pg_temp.n248_assert(pg_temp.n248_stored(302) = 'ok' AND pg_temp.n248_stored(301) = 'ok',
  'the Sales Manager of the lead and the Admin pass the stored check');
SELECT pg_temp.n248_assert(pg_temp.n248_stored(307) = '42501:portal_admin_authority_changed'
  AND pg_temp.n248_stored(303) = '42501:portal_admin_authority_changed'
  AND pg_temp.n248_stored(305) = '42501:portal_admin_authority_changed',
  'the other department''s Sales Manager, the Admissions Manager and a Student fail the stored check');

-- ---------------------------------------------------------------------------
-- 7. Definer, search_path and grants.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n248_assert((SELECT count(*) = 5 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.oid IN (
    'private.platform_can_read_student_case(uuid,uuid)'::REGPROCEDURE,
    'private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)'::REGPROCEDURE,
    'platform.staff_student_portal_curator_options(uuid)'::REGPROCEDURE,
    'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'::REGPROCEDURE,
    'platform.staff_student_case_cabinet_origin_v1(uuid,uuid)'::REGPROCEDURE)),
  'SECURITY DEFINER, empty search_path, authenticated-only EXECUTE');
SELECT pg_temp.n248_assert((SELECT count(*) = 5 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
  FROM pg_proc p WHERE p.oid IN (
    'platform_private.needs_curator_case_last_curator(uuid,uuid)'::REGPROCEDURE,
    'platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)'::REGPROCEDURE,
    'platform_private.require_case_curator_assigner_locked(uuid,uuid)'::REGPROCEDURE,
    'platform_private.require_student_portal_cabinet_actor_e1(uuid,uuid)'::REGPROCEDURE,
    'platform_private.assert_student_portal_cabinet_membership_e1(uuid,uuid,uuid)'::REGPROCEDURE)),
  'the private helpers stay private');

SELECT 'N248_ACCESS_OWNER_DEFAULTS_SUITE_PASS' AS n248_suite_marker;
ROLLBACK;
