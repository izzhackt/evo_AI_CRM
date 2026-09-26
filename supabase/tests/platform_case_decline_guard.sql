\set ON_ERROR_STOP on
-- Boundary suite for migration 249 (a curator's decline commits; owner
-- decision 26.09.2026). Members are modelled EXACTLY like production, with
-- the fixtures of the 244 suite (supabase/tests/platform_access_by_permissions.sql):
-- invited staff have organization_memberships.current_role NULL, so
-- current_actor_authority().platform_role is NULL and the JWT says 'staff';
-- permissions come only from scoped role assignments with the production
-- permission keys: Admissions (35 keys, own scope), Admissions Manager (36 keys,
-- department scope), Sales Manager (23 keys, department scope) and the two
-- «общие разделы» roles (organization scope). Only the system Admin carries
-- the coarse role.
-- Proves:
--  1. the real 182 command (platform.respond_student_case_handoff) commits a
--     curator's decline: the case is pending without curator and handoff
--     time, the scope rotated one step, the curator lost access, the Sales
--     owner and the Student kept it, the response, the 'declined' lifecycle
--     event and the audit row are written, «Ждут куратора» shows the case;
--     only the current curator can decline; a retry after the commit writes
--     nothing;
--  2. the Admissions Manager of the curator's department then sees and
--     assigns the case by migration 248's rule when 248 is in the chain, and
--     does not see it when it is not (the unchanged pre-248 boundary); a
--     second decline commits too;
--  3. every other illegal transition stays refused with its 042 error: a
--     revert without a recorded decline, with a stale decline of an earlier
--     assignment, with another curator's decline, after an acceptance, and
--     every deviation from the exact decline shape; the guard accepts the
--     exact shape only with the current curator's recorded decline; a decline
--     after an acceptance commits;
--  4. a case bound to a country playbook is still refused (137, PT409),
--     atomically;
--  5. the guard keeps SECURITY DEFINER, search_path, owner, grants and its
--     trigger.
-- Isolated synthetic SQL fixtures only -- no Auth invitation, real person,
-- provider or production action.
BEGIN;

DO $n249_auth_role$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE SQL STABLE SET search_path = '' AS
      'SELECT NULLIF(current_setting(''request.jwt.claims'', TRUE), '''')::JSONB ->> ''role'''$fn$;
  END IF;
END
$n249_auth_role$;

CREATE FUNCTION pg_temp.n249_id(n INTEGER) RETURNS UUID LANGUAGE SQL IMMUTABLE AS $$
  SELECT ('24900000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
$$;
CREATE FUNCTION pg_temp.n249_assert(ok BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'N249: %', message; END IF;
END
$$;
-- SQLSTATE and message of a failing statement, or 'ok'.
CREATE FUNCTION pg_temp.n249_error(sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql; RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
END
$$;
-- Sorted case ids of a JSONB rows array.
CREATE FUNCTION pg_temp.n249_case_ids(rows JSONB) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(array_agg((r ->> 'student_case_id')::UUID ORDER BY (r ->> 'student_case_id')), ARRAY[]::UUID[])
  FROM jsonb_array_elements(rows) AS r
$$;
CREATE FUNCTION pg_temp.n249_ids(VARIADIC n INTEGER[]) RETURNS UUID[] LANGUAGE SQL IMMUTABLE AS $$
  SELECT array_agg(pg_temp.n249_id(x) ORDER BY pg_temp.n249_id(x)) FROM unnest(n) AS x
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n249_id(INTEGER), pg_temp.n249_assert(BOOLEAN, TEXT),
  pg_temp.n249_error(TEXT), pg_temp.n249_case_ids(JSONB), pg_temp.n249_ids(INTEGER[])
  TO authenticated, anon, service_role;

SELECT 'N249_CASE_DECLINE_GUARD_SUITE_START' AS n249_suite_marker;

-- ---------------------------------------------------------------------------
-- Fixture. 1 Admin (system); invited staff with coarse role NULL:
-- 2 Sales Manager (sales department A), 3 Admissions Manager, 4 Admissions A,
-- 6 Admissions B (admissions department), 7 Sales Manager (sales department
-- B); 5 Student (case 505), 8 Student B (case 504), 9 Student C (case 506).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n249_actors(n INTEGER, coarse platform.business_role, claims TEXT);
INSERT INTO n249_actors(n, coarse) VALUES (1, 'admin'), (2, NULL), (3, NULL), (4, NULL), (5, 'student'), (6, NULL), (7, NULL),
  (8, 'student'), (9, 'student');
GRANT SELECT ON n249_actors TO authenticated, anon;

INSERT INTO platform.organizations(id, name) VALUES (pg_temp.n249_id(1), 'N249 Fictional organization');
INSERT INTO auth.users(id, email, raw_user_meta_data)
  SELECT pg_temp.n249_id(100 + n), 'n249-' || n || '@example.invalid', '{}'::JSONB FROM n249_actors;
-- An authenticated identity with no membership at all.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES (pg_temp.n249_id(199), 'n249-none@example.invalid', '{}'::JSONB);
INSERT INTO platform.profiles(id, auth_user_id, display_name, status, access_version)
  SELECT pg_temp.n249_id(200 + n), pg_temp.n249_id(100 + n), 'N249 Actor ' || n, 'active', 1 FROM n249_actors;
INSERT INTO platform.organization_memberships(id, organization_id, profile_id, status, "current_role", current_bundle_id)
  SELECT pg_temp.n249_id(300 + n), pg_temp.n249_id(1), pg_temp.n249_id(200 + n), 'active', a.coarse,
    CASE WHEN a.coarse IS NULL THEN NULL ELSE (SELECT id FROM platform.role_bundle_versions
      WHERE role = a.coarse AND status = 'published' ORDER BY version DESC LIMIT 1) END
  FROM n249_actors a;
UPDATE platform.organization_memberships SET is_system_admin = TRUE WHERE id = pg_temp.n249_id(301);
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  VALUES (pg_temp.n249_id(401), pg_temp.n249_id(1), 'organization', pg_temp.n249_id(1), 1);
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n249_id(1), pg_temp.n249_id(301), pg_temp.n249_id(401), 1, 1, TRUE, 'system',
    'N249 synthetic organization scope', pg_temp.n249_id(601));

-- Departments in the production shape: sales A (2), sales B (7), admissions (3, 4, 6).
INSERT INTO platform.staff_departments(id, organization_id, name) VALUES
  (pg_temp.n249_id(901), pg_temp.n249_id(1), 'N249 Sales A'),
  (pg_temp.n249_id(902), pg_temp.n249_id(1), 'N249 Admissions'),
  (pg_temp.n249_id(903), pg_temp.n249_id(1), 'N249 Sales B');
INSERT INTO platform.staff_organizational_details(organization_id, membership_id, department_id) VALUES
  (pg_temp.n249_id(1), pg_temp.n249_id(302), pg_temp.n249_id(901)),
  (pg_temp.n249_id(1), pg_temp.n249_id(303), pg_temp.n249_id(902)),
  (pg_temp.n249_id(1), pg_temp.n249_id(304), pg_temp.n249_id(902)),
  (pg_temp.n249_id(1), pg_temp.n249_id(306), pg_temp.n249_id(902)),
  (pg_temp.n249_id(1), pg_temp.n249_id(307), pg_temp.n249_id(903));

-- Cases: 501 active, curator A (4); 502 active, curator B (6); 503 active,
-- curator Admin; 504 and 506 pending after a sale (handoff evidence; portals
-- already activated for Students B and C) -- the suite hands them to a
-- curator, the only way into a decline; 505 active, curator A, the Student's
-- own case.
INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version)
  SELECT pg_temp.n249_id(420 + k), pg_temp.n249_id(1), 'student_case', pg_temp.n249_id(500 + k), 1
  FROM generate_series(1, 6) AS k;
SET LOCAL session_replication_role = replica;
INSERT INTO platform.student_cases(id, organization_id, responsible_sales_membership_id, current_curator_membership_id,
  source_key, student_display_name, target_country, target_degree, operational_stage, state, handoff_at,
  current_scope_id, current_scope_version, pipeline_stage, student_membership_id, portal_activated_at)
SELECT pg_temp.n249_id(500 + f.k), pg_temp.n249_id(1), pg_temp.n249_id(302),
  CASE WHEN f.curator IS NULL THEN NULL ELSE pg_temp.n249_id(f.curator) END,
  'synthetic:n249:' || f.k, 'N249 Student ' || (500 + f.k), 'MY', 'Bachelor', 'contract_confirmed',
  f.state::platform.student_case_state, CASE WHEN f.state = 'pending' THEN NULL ELSE clock_timestamp() END,
  pg_temp.n249_id(420 + f.k), 1, 'new',
  CASE f.k WHEN 5 THEN pg_temp.n249_id(305) WHEN 4 THEN pg_temp.n249_id(308) WHEN 6 THEN pg_temp.n249_id(309) END,
  CASE WHEN f.k IN (4, 5, 6) THEN clock_timestamp() END
FROM (VALUES (1, 304, 'active'), (2, 306, 'active'), (3, 301, 'active'), (4, NULL, 'pending'), (5, 304, 'active'),
  (6, NULL, 'pending'))
  AS f(k, curator, state);
-- Clients and leads owned by Sales Manager A (2); 706 and 710 carry the
-- sales of the pending cases 504 and 506.
INSERT INTO platform.clients(id, organization_id, display_name, normalized_name) VALUES
  (pg_temp.n249_id(705), pg_temp.n249_id(1), 'N249 Client C', platform_private.normalize_person_name('N249 Client C')),
  (pg_temp.n249_id(709), pg_temp.n249_id(1), 'N249 Client E', platform_private.normalize_person_name('N249 Client E'));
INSERT INTO platform.leads(id, organization_id, client_id, current_owner_membership_id, stage_key, source_key) VALUES
  (pg_temp.n249_id(706), pg_temp.n249_id(1), pg_temp.n249_id(705), pg_temp.n249_id(302), 'new', 'website'),
  (pg_temp.n249_id(710), pg_temp.n249_id(1), pg_temp.n249_id(709), pg_temp.n249_id(302), 'new', 'website');
INSERT INTO platform.sales_admissions_handoffs(organization_id, lead_id, client_id, student_case_id, source_key,
  handoff_mode, reason, actor_membership_id, actor_profile_id, admissions_owner_membership_id, gate_version,
  gate_state, workflow_version, sales_context, client_context, provenance, conversation_links)
SELECT pg_temp.n249_id(1), pg_temp.n249_id(h.lead), pg_temp.n249_id(h.client), pg_temp.n249_id(h.student_case),
  'canonical-lead:' || pg_temp.n249_id(h.lead)::TEXT, 'normal', 'N249 synthetic sale handoff',
  pg_temp.n249_id(302), pg_temp.n249_id(202), pg_temp.n249_id(301), 1, 'satisfied', 1,
  '{}'::JSONB, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB
FROM (VALUES (706, 705, 504), (710, 709, 506)) AS h(lead, client, student_case);
SET LOCAL session_replication_role = origin;
-- The Students sign in to the organization and read only their own case
-- (student_case scope), the provisioned portal shape.
INSERT INTO platform.membership_scope_assignments(organization_id, membership_id, scope_id, scope_version,
  assignment_version, granted, actor_kind, reason, request_id)
  VALUES (pg_temp.n249_id(1), pg_temp.n249_id(305), pg_temp.n249_id(401), 1, 1, TRUE, 'system',
    'N249 synthetic Student organization scope', pg_temp.n249_id(604)),
  (pg_temp.n249_id(1), pg_temp.n249_id(305), pg_temp.n249_id(425), 1, 1, TRUE, 'system',
    'N249 synthetic Student case scope', pg_temp.n249_id(605)),
  (pg_temp.n249_id(1), pg_temp.n249_id(308), pg_temp.n249_id(401), 1, 1, TRUE, 'system',
    'N249 synthetic Student B organization scope', pg_temp.n249_id(606)),
  (pg_temp.n249_id(1), pg_temp.n249_id(308), pg_temp.n249_id(424), 1, 1, TRUE, 'system',
    'N249 synthetic Student B case scope', pg_temp.n249_id(607));

-- Roles with the EXACT production permission keys (26.09 read-only audit).
CREATE TEMP TABLE n249_roles(role_id UUID, label TEXT, keys JSONB, request_base INTEGER);
INSERT INTO n249_roles VALUES
 (pg_temp.n249_id(1101), 'Admissions', '["ai.draft.request","ai.draft.review","application.manage","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1110),
 (pg_temp.n249_id(1102), 'Admissions Manager', '["ai.draft.request","ai.draft.review","application.manage","case.curator.assign","case.lifecycle.change","case.read.full","case.read.summary","case.route.manage","case.update.append","case.workflow.read","client.read","communication.manual.send","communication.read.full","decision.manage","decision.read","document.download","document.extract","document.manage","document.read.full","document.review","document.upload","finance.read.summary","finance.stop.create","lead.read","notification.create","post.contract.manage","profile.manage","profile.read.full","staff.task.complete","staff.task.edit","staff.task.read","task.assign","task.create","task.manage","task.visibility.manage","visa.manage"]', 1120),
 (pg_temp.n249_id(1103), 'Sales Manager', '["ai.draft.request","ai.draft.review","case.read.summary","case.workflow.read","client.read","communication.manual.send","communication.read.full","communication.read.summary","contract.draft.manage","contract.evidence.confirm","document.read.sales","finance.event.confirm","finance.first.payment.confirm","finance.read.summary","lead.read","lead.sales.owner.assign","lead.sales.workflow.manage","sales.register.manage","sales.register.read","staff.task.complete","staff.task.edit","staff.task.read","task.create"]', 1130),
 (pg_temp.n249_id(1104), 'Sales common', '["catalog.read","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.all","reply.snippet.manage","reply.snippet.sales","staff.assistant.use","staff.task.create","team.chat.general","team.chat.sales","workflow.contract.read"]', 1140),
 (pg_temp.n249_id(1105), 'Admissions common', '["catalog.read","company.file.download","company.file.manage","company.file.read","company.file.upload","contract.template.read","knowledge.read.approved","organization.read","reply.snippet.admissions","reply.snippet.all","reply.snippet.manage","staff.assistant.use","staff.task.create","team.chat.admissions","team.chat.general","workflow.contract.read"]', 1150);
CREATE TEMP TABLE n249_grants(membership INTEGER, role_id UUID, scope JSONB);
INSERT INTO n249_grants VALUES
 (302, pg_temp.n249_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n249_id(901), 'resourceKind', NULL)),
 (302, pg_temp.n249_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n249_id(1), 'resourceKind', NULL)),
 (303, pg_temp.n249_id(1102), jsonb_build_object('kind', 'department', 'key', pg_temp.n249_id(902), 'resourceKind', NULL)),
 (303, pg_temp.n249_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n249_id(1), 'resourceKind', NULL)),
 (304, pg_temp.n249_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (304, pg_temp.n249_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n249_id(1), 'resourceKind', NULL)),
 (306, pg_temp.n249_id(1101), jsonb_build_object('kind', 'own', 'key', NULL, 'resourceKind', NULL)),
 (306, pg_temp.n249_id(1105), jsonb_build_object('kind', 'organization', 'key', pg_temp.n249_id(1), 'resourceKind', NULL)),
 (307, pg_temp.n249_id(1103), jsonb_build_object('kind', 'department', 'key', pg_temp.n249_id(903), 'resourceKind', NULL)),
 (307, pg_temp.n249_id(1104), jsonb_build_object('kind', 'organization', 'key', pg_temp.n249_id(1), 'resourceKind', NULL));
CREATE TEMP TABLE n249_versions AS SELECT m.id AS membership_id, p.access_version
  FROM platform.organization_memberships m JOIN platform.profiles p ON p.id = m.profile_id
  WHERE m.organization_id = pg_temp.n249_id(1);
GRANT SELECT ON n249_roles, n249_grants, n249_versions TO authenticated;

SELECT pg_temp.n249_assert((SELECT array_agg(jsonb_array_length(keys) ORDER BY request_base) FROM n249_roles)
  = ARRAY[35, 36, 23, 12, 16], 'role bundles have the production key counts 35/36/23/12/16');

SELECT (platform_private.custom_access_token_hook(jsonb_build_object('user_id', pg_temp.n249_id(101),
  'claims', jsonb_build_object('sub', pg_temp.n249_id(101), 'role', 'authenticated'))) -> 'claims')::TEXT AS n249_admin_setup \gset
SET LOCAL request.jwt.claims TO :'n249_admin_setup';
SET LOCAL ROLE authenticated;
DO $n249_roles$
DECLARE r RECORD; published JSONB; m INTEGER; items JSONB; bindings JSONB; bundles JSONB := '{}'::JSONB;
BEGIN
  FOR r IN SELECT * FROM n249_roles ORDER BY request_base LOOP
    PERFORM platform.staff_role_command(pg_temp.n249_id(1), r.role_id, 0, 'create',
      jsonb_build_object('label', 'N249 ' || r.label, 'description', 'Migration 249 synthetic role',
        'permissionKeys', r.keys), 'N249 create role', pg_temp.n249_id(r.request_base + 1));
    published := platform.staff_role_publish(pg_temp.n249_id(1), r.role_id, 1,
      platform.staff_role_impact(pg_temp.n249_id(1), r.role_id, 1) ->> 'impactFingerprint',
      'N249 publish role', pg_temp.n249_id(r.request_base + 2));
    bundles := bundles || jsonb_build_object(r.role_id::TEXT, published ->> 'bundleId');
  END LOOP;
  FOR m IN SELECT DISTINCT membership FROM n249_grants ORDER BY 1 LOOP
    SELECT jsonb_agg(jsonb_build_object('roleId', g.role_id, 'scope', g.scope) ORDER BY g.role_id),
      jsonb_agg(jsonb_build_object('roleId', g.role_id, 'roleVersion', 2,
        'bundleId', (bundles ->> g.role_id::TEXT)::UUID, 'bundleVersion', 1) ORDER BY g.role_id)
      INTO items, bindings FROM n249_grants g WHERE g.membership = m;
    PERFORM platform.staff_role_assignments_save(pg_temp.n249_id(1), pg_temp.n249_id(m),
      (SELECT access_version FROM n249_versions WHERE membership_id = pg_temp.n249_id(m)), items, bindings,
      'N249 grant roles', pg_temp.n249_id(2000 + m));
  END LOOP;
END
$n249_roles$;
RESET ROLE;

-- Claims from live rows after the grants bumped access versions, all minted
-- by the installed token hook (staff and Student).
UPDATE n249_actors a SET claims = (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', pg_temp.n249_id(100 + a.n),
  'claims', jsonb_build_object('sub', pg_temp.n249_id(100 + a.n), 'role', 'authenticated'))) -> 'claims')::TEXT;
SELECT jsonb_build_object('sub', pg_temp.n249_id(199), 'role', 'authenticated')::TEXT AS n249_no_member \gset
SELECT pg_temp.n249_assert((SELECT array_agg(claims::JSONB ->> 'platform_role' ORDER BY n) FROM n249_actors)
  = ARRAY['admin', 'staff', 'staff', 'staff', 'student', 'staff', 'staff', 'student', 'student'],
  'the JWT carries staff for invited members and admin only for the system Admin');
SELECT pg_temp.n249_assert((SELECT count(*) = 5 FROM platform.organization_memberships
  WHERE organization_id = pg_temp.n249_id(1) AND "current_role" IS NULL AND current_bundle_id IS NULL
    AND id = ANY (pg_temp.n249_ids(302, 303, 304, 306, 307))), 'invited members have coarse role and bundle NULL');

-- Every actor switch below uses claims minted by the installed token hook
-- from the live rows at that moment, as a client does after its token
-- refresh: assignments and declines move scope grants and access versions,
-- and a stale token must not make a refusal pass for the wrong reason.
CREATE FUNCTION pg_temp.n249_as(n INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
    'user_id', pg_temp.n249_id(100 + n),
    'claims', jsonb_build_object('sub', pg_temp.n249_id(100 + n), 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
END
$$;

SELECT pg_temp.n249_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(platform_role IS NULL AND membership_id = pg_temp.n249_id(306))
  FROM platform.current_actor_authority()), 'Admissions B resolves with platform_role NULL');
RESET ROLE;

-- Helpers. The queue view ids and number as the current actor, the staff
-- case read, the real assignment command, the latest assignment and response
-- of a case (read as the owner, before switching role), the real 182 command
-- and a direct write as the table owner (every row trigger still fires).
CREATE FUNCTION pg_temp.n249_view(p_view TEXT) RETURNS UUID[] LANGUAGE SQL AS $$
  SELECT pg_temp.n249_case_ids(platform.staff_student_case_queue_v1(p_view, 100) -> 'rows')
$$;
CREATE FUNCTION pg_temp.n249_view_count(p_view TEXT) RETURNS INTEGER LANGUAGE SQL AS $$
  SELECT (platform.staff_student_case_queue_counts_v1(p_view) -> 'views' ->> p_view)::INTEGER
$$;
CREATE FUNCTION pg_temp.n249_can_read(p_case INTEGER) RETURNS BOOLEAN LANGUAGE SQL AS $$
  SELECT private.platform_can_read_student_case(pg_temp.n249_id(1), pg_temp.n249_id(p_case))
$$;
CREATE FUNCTION pg_temp.n249_assign(p_case INTEGER, p_curator INTEGER, p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n249_error(format($q$SELECT platform.assign_case_curator_v1(%L, %L, %L, %L, 'N249 assign curator')$q$,
    pg_temp.n249_id(1), pg_temp.n249_id(p_request), pg_temp.n249_id(p_case), pg_temp.n249_id(p_curator)))
$$;
CREATE FUNCTION pg_temp.n249_assignment(p_case INTEGER) RETURNS UUID LANGUAGE SQL AS $$
  SELECT e.id FROM platform.student_case_assignment_events e
  WHERE e.organization_id = pg_temp.n249_id(1) AND e.student_case_id = pg_temp.n249_id(p_case)
  ORDER BY e.new_scope_version DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.n249_response(p_assignment UUID) RETURNS UUID LANGUAGE SQL AS $$
  SELECT r.id FROM platform.student_case_handoff_acknowledgements r
  WHERE r.assignment_event_id = p_assignment ORDER BY r.revision DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.n249_respond(p_case INTEGER, p_assignment UUID, p_expected UUID, p_decision TEXT,
  p_request INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n249_error(format(
    $q$SELECT platform.respond_student_case_handoff(%L, %L, %L, %L, %L, %L, NULL, %L)$q$,
    pg_temp.n249_id(1), pg_temp.n249_id(p_case), p_assignment, p_expected, p_decision,
    CASE WHEN p_decision = 'accepted' THEN NULL ELSE 'N249 synthetic decline' END, pg_temp.n249_id(p_request)))
$$;
-- As the table owner: rotate the case scope by p_steps versions (0 = keep),
-- then write the given state, curator (NULL = none) and handoff time
-- (cleared or kept).
CREATE FUNCTION pg_temp.n249_write(p_case INTEGER, p_state TEXT, p_curator INTEGER, p_clear_handoff BOOLEAN,
  p_steps INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE c platform.student_cases%ROWTYPE; next_scope UUID := gen_random_uuid();
BEGIN
  SELECT * INTO STRICT c FROM platform.student_cases
    WHERE organization_id = pg_temp.n249_id(1) AND id = pg_temp.n249_id(p_case);
  IF p_steps > 0 THEN
    UPDATE platform.record_scopes SET is_active = FALSE WHERE id = c.current_scope_id;
    INSERT INTO platform.record_scopes(id, organization_id, scope_kind, scope_key, scope_version, is_active)
      VALUES (next_scope, c.organization_id, 'student_case', c.id, c.current_scope_version + p_steps, TRUE);
  END IF;
  UPDATE platform.student_cases SET
    state = p_state::platform.student_case_state,
    current_curator_membership_id = CASE WHEN p_curator IS NULL THEN NULL ELSE pg_temp.n249_id(p_curator) END,
    handoff_at = CASE WHEN p_clear_handoff THEN NULL ELSE handoff_at END,
    current_scope_id = CASE WHEN p_steps > 0 THEN next_scope ELSE current_scope_id END,
    current_scope_version = c.current_scope_version + p_steps
  WHERE organization_id = c.organization_id AND id = c.id;
END
$$;
CREATE FUNCTION pg_temp.n249_write_error(p_case INTEGER, p_state TEXT, p_curator INTEGER, p_clear_handoff BOOLEAN,
  p_steps INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n249_error(format('SELECT pg_temp.n249_write(%s, %L, %s, %L, %s)',
    p_case, p_state, COALESCE(p_curator::TEXT, 'NULL'), p_clear_handoff, p_steps))
$$;
-- The exact 182 decline shape, written as the table owner.
CREATE FUNCTION pg_temp.n249_revert_error(p_case INTEGER) RETURNS TEXT LANGUAGE SQL AS $$
  SELECT pg_temp.n249_write_error(p_case, 'pending', NULL, TRUE, 1)
$$;
-- A curator response written as the table owner (append-only table).
CREATE FUNCTION pg_temp.n249_owner_response(p_case INTEGER, p_assignment UUID, p_curator INTEGER, p_decision TEXT,
  p_request INTEGER) RETURNS VOID LANGUAGE SQL AS $$
  INSERT INTO platform.student_case_handoff_acknowledgements(organization_id, student_case_id, handoff_id,
    assignment_event_id, curator_membership_id, revision, decision, clarification, request_id)
  SELECT pg_temp.n249_id(1), pg_temp.n249_id(p_case), h.id, p_assignment, pg_temp.n249_id(p_curator),
    COALESCE((SELECT max(r.revision) FROM platform.student_case_handoff_acknowledgements r
      WHERE r.assignment_event_id = p_assignment), 0) + 1,
    p_decision, CASE WHEN p_decision = 'accepted' THEN NULL ELSE 'N249 owner-written response' END,
    pg_temp.n249_id(p_request)
  FROM platform.sales_admissions_handoffs h
  WHERE h.organization_id = pg_temp.n249_id(1) AND h.student_case_id = pg_temp.n249_id(p_case)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.n249_view(TEXT), pg_temp.n249_view_count(TEXT), pg_temp.n249_can_read(INTEGER),
  pg_temp.n249_assign(INTEGER, INTEGER, INTEGER), pg_temp.n249_respond(INTEGER, UUID, UUID, TEXT, INTEGER)
  TO authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. The real 182 command commits a curator's decline.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n249_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_assign(504, 306, 3001) = 'ok', 'the Admin hands 504 to Admissions B');
RESET ROLE;
SELECT pg_temp.n249_assignment(504) AS n249_a1 \gset
SELECT current_scope_id AS n249_s1, portal_activated_at AS n249_portal FROM platform.student_cases
  WHERE id = pg_temp.n249_id(504) \gset
SELECT pg_temp.n249_assert((SELECT state = 'active' AND current_curator_membership_id = pg_temp.n249_id(306)
    AND handoff_at IS NOT NULL AND current_scope_version = 2
  FROM platform.student_cases WHERE id = pg_temp.n249_id(504)), '504 is active under Admissions B on scope v2');

SELECT pg_temp.n249_as(8);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(case_state = 'active')
  FROM platform.student_portal_cases() WHERE case_id = pg_temp.n249_id(504)),
  'the Student reads the own case in the portal before the decline');
RESET ROLE;

-- Only the current curator declines (182's gate, unchanged).
SELECT pg_temp.n249_as(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3002) LIKE '42501:%',
  'Admissions A (not the curator) cannot decline');
RESET ROLE;
SELECT pg_temp.n249_as(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3003) LIKE '42501:%',
  'the Sales Manager cannot decline');
RESET ROLE;
SELECT pg_temp.n249_as(8);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3004) LIKE '42501:%',
  'the case''s own Student cannot decline');
RESET ROLE;
SET LOCAL request.jwt.claims TO :'n249_no_member';
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3005) LIKE '42501:%',
  'an authenticated user without membership cannot decline');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3006) LIKE '42501:%',
  'an anonymous caller cannot decline');
RESET ROLE;

SELECT pg_temp.n249_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_can_read(504), 'the curator reads the case before declining');
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3010) = 'ok',
  'the curator''s decline commits through the real 182 command (55000 before 249)');
SELECT pg_temp.n249_assert(NOT pg_temp.n249_can_read(504), 'the curator who declined loses the case');
-- A retry of the same request after the commit: 182 checks the current
-- curator before its replay lookup, so the retry is refused and writes nothing.
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a1', NULL, 'declined', 3010) LIKE '42501:%',
  'a retry after the committed decline is refused');
RESET ROLE;

SELECT pg_temp.n249_assert((SELECT state = 'pending' AND current_curator_membership_id IS NULL AND handoff_at IS NULL
    AND closed_at IS NULL AND current_scope_version = 3 AND current_scope_id <> :'n249_s1'::UUID
    AND portal_activated_at = :'n249_portal'::TIMESTAMPTZ AND student_membership_id = pg_temp.n249_id(308)
    AND responsible_sales_membership_id = pg_temp.n249_id(302)
  FROM platform.student_cases WHERE id = pg_temp.n249_id(504)),
  '504 is pending without curator and handoff time, scope v3, portal activation and Student kept');
SELECT pg_temp.n249_assert((SELECT is_active FROM platform.record_scopes WHERE id = :'n249_s1'::UUID) = FALSE
  AND (SELECT is_active AND scope_version = 3 FROM platform.record_scopes s JOIN platform.student_cases c
    ON c.current_scope_id = s.id WHERE c.id = pg_temp.n249_id(504)),
  'the old case scope is retired and the new one is the exact active scope');
SELECT pg_temp.n249_assert((SELECT array_agg(m.membership_id::TEXT || ':' || m.scope_version || ':' || m.granted
    ORDER BY m.membership_id, m.scope_version)
  FROM platform.membership_scope_assignments m WHERE m.request_id = pg_temp.n249_id(3010))
  = ARRAY[pg_temp.n249_id(302)::TEXT || ':3:true', pg_temp.n249_id(306)::TEXT || ':2:false',
    pg_temp.n249_id(308)::TEXT || ':3:true'],
  'the curator is revoked on the old scope; the Sales owner and the Student are granted the new one');
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(decision = 'declined' AND revision = 1
    AND curator_membership_id = pg_temp.n249_id(306) AND assignment_event_id = :'n249_a1'::UUID)
  FROM platform.student_case_handoff_acknowledgements WHERE student_case_id = pg_temp.n249_id(504)),
  'one declined response of the curator to the assignment');
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(previous_state = 'active' AND new_state = 'pending'
    AND actor_membership_id = pg_temp.n249_id(306))
  FROM platform.student_case_lifecycle_events WHERE student_case_id = pg_temp.n249_id(504) AND event_type = 'declined'
    AND request_id = pg_temp.n249_id(3010)), 'the declined lifecycle event of the curator');
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(action = 'case.handoff.decline'
    AND after_state ->> 'case_state' = 'pending')
  FROM platform.audit_events WHERE request_id = pg_temp.n249_id(3010)), 'one audit row of the decline');
SELECT pg_temp.n249_assert((SELECT count(*) FROM platform.audit_events WHERE request_id = ANY (pg_temp.n249_ids(3002, 3003,
    3004, 3005, 3006))) = 0 AND (SELECT count(*) FROM platform.student_case_handoff_acknowledgements
    WHERE student_case_id = pg_temp.n249_id(504)) = 1, 'refused callers and the retry wrote nothing');

-- The Student keeps the case in the portal; the Admin sees «Ждут куратора».
SELECT pg_temp.n249_as(8);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert((SELECT count(*) = 1 AND bool_and(case_state = 'pending')
  FROM platform.student_portal_cases() WHERE case_id = pg_temp.n249_id(504)),
  'the Student still reads the own case in the portal');
RESET ROLE;
SELECT pg_temp.n249_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_id(504) = ANY (pg_temp.n249_view('needs_curator'))
  AND pg_temp.n249_view_count('needs_curator') = cardinality(pg_temp.n249_view('needs_curator')),
  '«Ждут куратора» shows 504 to the Admin, and the number equals the rows');
SELECT pg_temp.n249_assert(platform.staff_case_attention_flags_v1(pg_temp.n249_id(504)) = ARRAY['needs_curator'],
  'the case header reads «нужен куратор»');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. The Admissions Manager and migration 248's rule.
-- ---------------------------------------------------------------------------
SELECT to_regprocedure('platform_private.needs_curator_case_last_curator(uuid,uuid)') IS NOT NULL AS n249_has_248 \gset
\if :n249_has_248
SELECT 'N249_WITH_248_RULE' AS n249_chain;
SELECT pg_temp.n249_assert(platform_private.needs_curator_case_last_curator(pg_temp.n249_id(1), pg_temp.n249_id(504))
  = pg_temp.n249_id(306), 'the last curator of 504 is Admissions B, from the event the real command wrote');
SELECT pg_temp.n249_as(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_can_read(504), 'the manager reads the declined case');
SELECT pg_temp.n249_assert(pg_temp.n249_view('needs_curator') = pg_temp.n249_ids(504)
  AND pg_temp.n249_view_count('needs_curator') = 1, '«Ждут куратора»: 504, and the number equals the rows');
SELECT pg_temp.n249_assert(pg_temp.n249_assign(504, 304, 3020) = 'ok', 'the manager hands 504 to Admissions A');
RESET ROLE;
\else
SELECT 'N249_WITHOUT_248_RULE' AS n249_chain;
SELECT pg_temp.n249_as(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(NOT pg_temp.n249_can_read(504) AND pg_temp.n249_view('needs_curator') = ARRAY[]::UUID[],
  'without 248 the manager does not see the declined case (the pre-248 boundary)');
SELECT pg_temp.n249_assert(pg_temp.n249_assign(504, 304, 3020) LIKE '42501:%',
  'without 248 the manager cannot assign it');
RESET ROLE;
SELECT pg_temp.n249_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_assign(504, 304, 3021) = 'ok', 'the Admin hands 504 to Admissions A');
RESET ROLE;
\endif

-- A second decline, by the next curator, commits the same way.
SELECT pg_temp.n249_assignment(504) AS n249_a2 \gset
SELECT pg_temp.n249_as(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a2', NULL, 'declined', 3030) = 'ok',
  'Admissions A declines 504 as well');
RESET ROLE;
SELECT pg_temp.n249_assert((SELECT state = 'pending' AND current_curator_membership_id IS NULL AND current_scope_version = 5
  FROM platform.student_cases WHERE id = pg_temp.n249_id(504)), '504 is pending again on scope v5');
\if :n249_has_248
SELECT pg_temp.n249_assert(platform_private.needs_curator_case_last_curator(pg_temp.n249_id(1), pg_temp.n249_id(504))
  = pg_temp.n249_id(304), 'the last curator of 504 is now Admissions A');
SELECT pg_temp.n249_as(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_can_read(504) AND pg_temp.n249_view('needs_curator') = pg_temp.n249_ids(504),
  'the manager still sees the case after the second decline');
RESET ROLE;
SELECT pg_temp.n249_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(NOT pg_temp.n249_can_read(504), 'Admissions B (own scope) does not get it back');
RESET ROLE;
\endif

-- ---------------------------------------------------------------------------
-- 3. Every other transition the guard refused stays refused.
-- ---------------------------------------------------------------------------
-- 501: active, no sale, no response. The exact decline shape without a
-- recorded decline, and each other move off the active state.
SELECT pg_temp.n249_assert(pg_temp.n249_revert_error(501) = '55000:First student-case handoff timestamp is immutable',
  'the decline shape without a recorded decline is refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(501, 'pending', NULL, FALSE, 1)
  = '55000:Unsupported student-case transition active to pending', 'active -> pending keeping handoff_at is refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(501, 'active', NULL, FALSE, 1)
  = '55000:Curator change requires one-step scope rotation and valid handoff state',
  'clearing the curator of an active case is refused');
SELECT pg_temp.n249_assert(pg_temp.n249_error($q$UPDATE platform.student_cases SET handoff_at = handoff_at + interval '1 day'
  WHERE id = pg_temp.n249_id(501)$q$) = '55000:First student-case handoff timestamp is immutable',
  'moving the handoff time is refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(501, 'closed', 304, FALSE, 0)
  = '55000:Closing a student case requires closed_at', 'closing without closed_at is refused');
-- 504: pending after the declines. Pending leaves only to active, with a
-- curator and a rotation.
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'closed', NULL, TRUE, 0)
  = '55000:Unsupported student-case transition pending to closed', 'pending -> closed is refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'active', NULL, TRUE, 0)
  = '55000:Pending activation requires curator and scope rotation', 'pending -> active without a curator is refused');

-- 504 handed to Admissions B again: B's decline of an EARLIER assignment is
-- recorded, but not of the current one.
SELECT pg_temp.n249_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_assign(504, 306, 3040) = 'ok', 'the Admin hands 504 to Admissions B again');
RESET ROLE;
SELECT pg_temp.n249_assignment(504) AS n249_a3 \gset
SELECT pg_temp.n249_assert(pg_temp.n249_revert_error(504) = '55000:First student-case handoff timestamp is immutable',
  'a stale decline of an earlier assignment does not open the revert');
SAVEPOINT n249_evidence;
-- Another curator's decline on B's current assignment does not count.
SELECT pg_temp.n249_owner_response(504, :'n249_a3', 304, 'declined', 3041);
SELECT pg_temp.n249_assert(pg_temp.n249_revert_error(504) = '55000:First student-case handoff timestamp is immutable',
  'a decline by another curator does not open the revert');
ROLLBACK TO SAVEPOINT n249_evidence;
-- B's recorded decline of the current assignment opens exactly the 182 shape.
SELECT pg_temp.n249_owner_response(504, :'n249_a3', 306, 'declined', 3042);
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'pending', NULL, TRUE, 0)
  = '55000:First student-case handoff timestamp is immutable', 'no scope rotation: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'pending', NULL, TRUE, 2)
  = '55000:First student-case handoff timestamp is immutable', 'a two-step scope rotation: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'pending', 306, TRUE, 1)
  = '55000:First student-case handoff timestamp is immutable', 'curator kept: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'pending', NULL, FALSE, 1)
  = '55000:Unsupported student-case transition active to pending', 'handoff_at kept: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'active', NULL, TRUE, 1)
  = '55000:First student-case handoff timestamp is immutable', 'staying active with the curator cleared: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_write_error(504, 'closed', NULL, TRUE, 1)
  = '55000:First student-case handoff timestamp is immutable', 'closing instead of pending: refused');
SELECT pg_temp.n249_assert(pg_temp.n249_revert_error(504) = 'ok',
  'the exact decline shape passes the guard with the current curator''s recorded decline');
ROLLBACK TO SAVEPOINT n249_evidence;
SELECT pg_temp.n249_assert((SELECT state = 'active' AND current_curator_membership_id = pg_temp.n249_id(306)
  FROM platform.student_cases WHERE id = pg_temp.n249_id(504)), '504 is back under Admissions B');

-- B accepts: the latest response is no longer a decline.
SELECT pg_temp.n249_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a3', NULL, 'accepted', 3050) = 'ok', 'Admissions B accepts 504');
RESET ROLE;
SELECT pg_temp.n249_response(:'n249_a3') AS n249_accepted \gset
SELECT pg_temp.n249_assert(pg_temp.n249_revert_error(504) = '55000:First student-case handoff timestamp is immutable',
  'after an acceptance the revert is refused');
-- A decline after the acceptance (182 allows it) commits.
SELECT pg_temp.n249_as(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_respond(504, :'n249_a3', :'n249_accepted', 'declined', 3051) = 'ok',
  'Admissions B declines after accepting');
RESET ROLE;
SELECT pg_temp.n249_assert((SELECT state = 'pending' AND current_curator_membership_id IS NULL
  FROM platform.student_cases WHERE id = pg_temp.n249_id(504))
  AND (SELECT array_agg(actor_membership_id ORDER BY created_at, id) FROM platform.student_case_lifecycle_events
    WHERE student_case_id = pg_temp.n249_id(504) AND event_type = 'declined') = ARRAY[pg_temp.n249_id(306),
    pg_temp.n249_id(304), pg_temp.n249_id(306)],
  '504 is pending; three declined events B, A, B');

-- ---------------------------------------------------------------------------
-- 4. A case bound to a country playbook: still refused (137), atomically.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n249_as(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_assign(506, 304, 3060) = 'ok', 'the Admin hands 506 to Admissions A');
RESET ROLE;
SELECT pg_temp.n249_assignment(506) AS n249_a506 \gset
SELECT admissions_version AS n249_v506 FROM platform.student_cases WHERE id = pg_temp.n249_id(506) \gset
SELECT id AS n249_cn_playbook FROM platform_private.admissions_playbook_versions WHERE direction = 'CN'
  ORDER BY published_at DESC, id LIMIT 1 \gset
SELECT pg_temp.n249_as(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.n249_assert(pg_temp.n249_error(format(
  $q$SELECT platform.configure_case_admissions_v1(%L, %s, 'CN', %L, 'N249 next step', DATE '2026-10-01', %L)$q$,
  pg_temp.n249_id(506), :'n249_v506', :'n249_cn_playbook', pg_temp.n249_id(3061))) = 'ok',
  'Admissions A binds 506 to the China playbook');
SELECT pg_temp.n249_assert(pg_temp.n249_respond(506, :'n249_a506', NULL, 'declined', 3062)
  = 'PT409:Use versioned admissions command for configured case',
  'the decline of a playbook-bound case is refused by 137''s guard');
RESET ROLE;
SELECT pg_temp.n249_assert((SELECT state = 'active' AND current_curator_membership_id = pg_temp.n249_id(304)
    AND handoff_at IS NOT NULL AND current_scope_version = 2
  FROM platform.student_cases WHERE id = pg_temp.n249_id(506))
  AND NOT EXISTS (SELECT 1 FROM platform.student_case_handoff_acknowledgements WHERE student_case_id = pg_temp.n249_id(506))
  AND NOT EXISTS (SELECT 1 FROM platform.student_case_lifecycle_events WHERE student_case_id = pg_temp.n249_id(506)
    AND event_type = 'declined')
  AND NOT EXISTS (SELECT 1 FROM platform.audit_events WHERE request_id = pg_temp.n249_id(3062)),
  'nothing of the refused decline is written');

-- ---------------------------------------------------------------------------
-- 5. The guard keeps definer, search_path, owner, grants and its trigger.
-- ---------------------------------------------------------------------------
SELECT pg_temp.n249_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'platform_private.guard_student_case_transition()'::REGPROCEDURE),
  'the guard: SECURITY DEFINER, empty search_path, owner postgres, no EXECUTE grants');
SELECT pg_temp.n249_assert((SELECT count(*) = 1 FROM pg_trigger t
  WHERE t.tgrelid = 'platform.student_cases'::REGCLASS AND t.tgname = 'student_cases_transition_guard'
    AND t.tgfoid = 'platform_private.guard_student_case_transition()'::REGPROCEDURE
    AND t.tgenabled = 'O' AND t.tgtype = 23), 'the BEFORE INSERT OR UPDATE row trigger is unchanged');
SELECT pg_temp.n249_assert((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.oid = 'private.respond_student_case_handoff(uuid,uuid,uuid,uuid,text,text,date,uuid)'::REGPROCEDURE),
  'the 182 command keeps its definer, search_path and grants');

SELECT 'N249_CASE_DECLINE_GUARD_SUITE_PASS' AS n249_suite_marker;
ROLLBACK;
